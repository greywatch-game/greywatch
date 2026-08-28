/**
 * WorldCulling.ts — What the frame's own mesh walk is allowed to see.
 * Owns: `Scene.getActiveMeshCandidates`, the map's meshes filed into cull
 * cells, and the list handed back to Babylon each frame.
 * Invariants: it NEVER writes `setEnabled`, `isVisible`, `isPickable` or any
 * other property on a mesh — the whole of what it does is decide which meshes
 * Babylon is offered as candidates for the ACTIVE-MESH pass, and nothing else
 * in Babylon or in this game reads that list. So every ray, every collision,
 * every shadow caster, every cube probe and every vertex range into a pane is
 * indifferent to it BY CONSTRUCTION. It must stay that way: the moment this
 * disables a mesh it acquires all four of those problems at once.
 *
 * **The frame walks the SCENE, and the scene is the map.**
 * `_evaluateActiveMeshes` iterates every candidate every frame — a Map get for
 * the LOD, `isBlocked`, `getTotalVertices`, `isReady`, `isEnabled` — before it
 * has decided anything, and the walk is `O(candidates)` whatever the camera can
 * see. Measured (`FINDINGS.md` 19): **1.10 us per mesh in the scene per
 * frame**, 23.0 ms of a 30.3 ms frame on a 1500 m map and still 7.6 of 10.1 ms
 * on the 900/300 one. Frustum culling does not help — it is the decision this
 * walk REACHES, not the walk. `ENGINE_UPGRADE.md` wall 1 is this, and this file
 * is S1.
 *
 * **Disabling a mesh is the wrong lever and a candidate list is the right one.**
 * `setEnabled(false)` leaves the mesh in the walk and merely shortens what the
 * walk does with it — which is what made finding 18's 0.67 us and finding 19's
 * 1.10 us disagree about the same number — and it costs the four indifferences
 * above: a disabled mesh is out of the shadow map's render list, out of a cube
 * probe's bake, and out of anything picking with Babylon's own default filter.
 * `Scene.getActiveMeshCandidates` is the supported extension point (it is what
 * `createOrUpdateSelectionOctree` replaces), it is read in exactly one place,
 * and a mesh left out of it is skipped ENTIRELY rather than skipped cheaply.
 *
 * **Three classes of mesh, and which class a mesh is in is the whole design.**
 *
 * - **Hidden** — the map's collider proxies, `map.colliders`. Invisible by
 *   construction (`MapBuilder.boxMesh` sets `isVisible = false` and nothing
 *   ever turns one back on), so they can never draw and are never candidates at
 *   ANY distance. This is most of the win and it is exact rather than a trade:
 *   on the 900/300 proving ground 5,929 of 9,002 scene meshes are collider
 *   boxes the walk pays full price for and rejects on `isVisible` after it has
 *   already done everything expensive.
 * - **Blocked** — drawn map geometry carrying `metadata.block`, filed one cull
 *   cell per 48 m map block and offered only while the camera is inside `reach`
 *   of that cell's own bounds. That is `BlockMerge`'s output, the ink twins of
 *   it and the merged glazing, which between them are every STRUCTURE on the
 *   map.
 * - **Loose** — everything else in the scene, always offered: the terrain, the
 *   roads, the rim, every pool (rigs, tracers, shards, ragdolls, grenades,
 *   rubble), the sky, the water, the grass, the viewmodel, the hulls, and every
 *   visual an EDITOR build makes, which is keyed per placement and carries no
 *   block at all.
 *
 * **The landform is deliberately loose and that is not an oversight.** A
 * structure past the fog wall draws exactly `fogColor` and stands in front of
 * ground that draws exactly `fogColor`, so dropping it cannot move a pixel. The
 * terrain and the rim are what the SKY is behind, and `SkySpec.horizonColor` is
 * only required to sit CLOSE to the fog — so a hole cut in the rim is a hole
 * onto a gradient, and the further up the dome it is the less it is fogColor.
 * They are also a few hundred meshes against several thousand structures.
 *
 * The reach is the map's own `fogEnd` plus `CONFIG.graphics.culling.pad`, and
 * on a map whose fog never closes — `fogEnd` past its own diagonal, which the
 * proving ground states on purpose — that is a reach nothing is outside and
 * this degrades to the hidden-collider half alone.
 */
import type { AbstractMesh, Mesh, Scene, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { GameMap } from "../world/MapBuilder";

/**
 * One cull cell: a map block's own world box, and whether what was filed under
 * it is in the frame.
 *
 * The cell does not hold its meshes — `cellOf` points the other way, from a
 * mesh to its cell, because the list is rebuilt by walking the scene in ORDER
 * rather than by concatenating cells (see `rebuildList`).
 *
 * The bounds are the MESHES' rather than the block's nominal 48 m square,
 * because the key is a name and not an alignment claim — a merged block's
 * geometry can hang over its own seam, and a mesh filed by its key can be much
 * bigger than the square it was filed under. Measuring what is there cannot be
 * wrong in the direction that matters.
 */
interface Cell {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  /** Whether what was filed here is in the candidate list right now. */
  on: boolean;
}

export class WorldCulling {
  /**
   * The list Babylon is handed. An `ISmartArrayLike`, which is `{ data, length
   * }` and nothing else — written as a plain object rather than a `SmartArray`
   * so this file imports no Babylon value at all.
   */
  private readonly candidates: { data: AbstractMesh[]; length: number } = {
    data: [],
    length: 0,
  };

  /** The map's collider proxies: never candidates, at any distance. */
  private hidden = new Set<AbstractMesh>();
  /** Every drawn map mesh that carries a block, and the cell it was filed in. */
  private cellOf = new Map<AbstractMesh, Cell>();
  private cells: Cell[] = [];

  /** Set when the candidate list no longer matches the state above. */
  private listDirty = true;

  /** Squared distances a cell switches at. Infinite reach culls nothing. */
  private onSq = Number.POSITIVE_INFINITY;
  private offSq = Number.POSITIVE_INFINITY;

  /** Where the camera stood when the cells were last re-evaluated. */
  private evalX = Number.POSITIVE_INFINITY;
  private evalY = 0;
  private evalZ = Number.POSITIVE_INFINITY;

  /**
   * What the last rebuild produced, for the harness that measures this. There
   * is no behaviour behind it and nothing in the game reads it.
   */
  readonly stats = {
    scene: 0,
    hidden: 0,
    blocked: 0,
    loose: 0,
    cells: 0,
    cellsOn: 0,
    candidates: 0,
  };

  constructor(private scene: Scene) {
    // The one hook. Babylon calls this from `_evaluateActiveMeshes` and from
    // nowhere else that matters here — picking walks `scene.meshes`, a render
    // target with an explicit `renderList` walks that list, and the collision
    // coordinator walks the collidable meshes. All three are why this is safe.
    scene.getActiveMeshCandidates = () => this.candidates;
    // A flag rather than any real work, because these fire for every part mesh
    // a build creates and destroys — of the order of a million on a 1500 m map
    // (`FINDINGS.md` 19, wall 4) — and the rebuild they ask for is owed once.
    scene.onNewMeshAddedObservable.add(() => {
      this.listDirty = true;
    });
    scene.onMeshRemovedObservable.add(() => {
      this.listDirty = true;
    });
  }

  /**
   * Files a freshly built map. Called from `Game.installMap` and from nowhere
   * else, exactly as `ShadowSystem.setCasters` and `ReflectionSystem.build`
   * are: last build's meshes are disposed by now, and a cell still holding one
   * would hand Babylon a dead mesh.
   *
   * `fogEnd` is the MAP's (`EnvironmentSpec.fogEnd`) rather than `CONFIG`'s —
   * it is the fourth thing `installMap` pushes that number into, and for the
   * same reason as the other three: past it there is nothing to see.
   */
  setMap(map: GameMap | null, fogEnd: number): void {
    this.hidden = new Set();
    this.cellOf = new Map();
    this.cells = [];
    this.listDirty = true;
    this.evalX = Number.POSITIVE_INFINITY;
    this.evalZ = Number.POSITIVE_INFINITY;
    this.stats.hidden = 0;
    this.stats.blocked = 0;
    this.stats.cells = 0;
    if (!map) {
      this.onSq = Number.POSITIVE_INFINITY;
      this.offSq = Number.POSITIVE_INFINITY;
      return;
    }

    const c = CONFIG.graphics.culling;
    // Clamped at zero because the reach is SQUARED below, and a negative one
    // squares back to an enormous positive — which would turn a map claiming
    // no view distance at all into a map that culls nothing. Zero is the
    // honest reading of it: only the cell the camera is standing in.
    const on = Math.max(0, fogEnd + c.pad + c.step);
    const off = on + c.hysteresis;
    this.onSq = on * on;
    this.offSq = off * off;

    for (const mesh of map.colliders) {
      // The invariant this rests on, written as a test rather than as a
      // comment: a collider that could DRAW is not one this may drop. Nothing
      // in `MapBuilder` makes one, and if something ever does it falls through
      // to `loose` and costs a walk rather than disappearing.
      if (mesh.isVisible) continue;
      this.hidden.add(mesh);
      this.stats.hidden++;
    }

    const byKey = new Map<string, Cell>();
    const file = (mesh: Mesh): void => {
      const key: unknown = mesh.metadata?.block;
      if (typeof key !== "string" || key === "") return;
      if (this.cellOf.has(mesh) || this.hidden.has(mesh)) return;
      // A frozen world matrix is already computed and the bounding info with
      // it, so this is a read rather than a recompute — see `markVisual`.
      const box = mesh.getBoundingInfo().boundingBox;
      const lo = box.minimumWorld;
      const hi = box.maximumWorld;
      let cell = byKey.get(key);
      if (cell) {
        if (lo.x < cell.minX) cell.minX = lo.x;
        if (lo.y < cell.minY) cell.minY = lo.y;
        if (lo.z < cell.minZ) cell.minZ = lo.z;
        if (hi.x > cell.maxX) cell.maxX = hi.x;
        if (hi.y > cell.maxY) cell.maxY = hi.y;
        if (hi.z > cell.maxZ) cell.maxZ = hi.z;
      } else {
        cell = {
          minX: lo.x,
          minY: lo.y,
          minZ: lo.z,
          maxX: hi.x,
          maxY: hi.y,
          maxZ: hi.z,
          on: true,
        };
        byKey.set(key, cell);
        this.cells.push(cell);
      }
      this.cellOf.set(mesh, cell);
      this.stats.blocked++;
    };

    for (const mesh of map.visuals) file(mesh);
    // The glazing is filed under the same key its block is, which is the key
    // `PaneBlocks` writes it under — a curtain wall and the shaft behind it go
    // out of the frame together, or the tower is a sheet of glass hanging in
    // the fog with nothing behind it.
    for (const group of map.paneGroups) file(group.mesh);
    this.stats.cells = this.cells.length;
  }

  /**
   * Picks this frame's candidate list. Called from `Game.tick` in EVERY state,
   * beside `CelMaterialFactory.updateCamera` and for the same reason: every
   * state renders and only some of them simulate, so a menu or a deploy screen
   * with a live view behind it would otherwise be looking at whatever
   * neighbourhood the last live frame stood in.
   *
   * Cheap when nothing has moved — the cells are re-evaluated only once the
   * camera has travelled `CONFIG.graphics.culling.step`, and the list is
   * rebuilt only when the answer changes.
   */
  update(eye: Vector3): void {
    const step = CONFIG.graphics.culling.step;
    const dx = eye.x - this.evalX;
    const dy = eye.y - this.evalY;
    const dz = eye.z - this.evalZ;
    if (dx * dx + dy * dy + dz * dz >= step * step) {
      this.evalX = eye.x;
      this.evalY = eye.y;
      this.evalZ = eye.z;
      this.evaluate(eye.x, eye.y, eye.z);
    }
    if (this.listDirty) this.rebuildList();
  }

  /**
   * Which cells are within reach, with a band of hysteresis so a camera
   * standing on a boundary does not rebuild the list every step it takes.
   *
   * The `on` threshold already carries `step` on top of the reach, so a cell
   * that came inside the fog wall between two evaluations was admitted at the
   * last one: the list is early and never late.
   */
  private evaluate(x: number, y: number, z: number): void {
    for (const cell of this.cells) {
      const dx = Math.max(cell.minX - x, 0, x - cell.maxX);
      const dy = Math.max(cell.minY - y, 0, y - cell.maxY);
      const dz = Math.max(cell.minZ - z, 0, z - cell.maxZ);
      const d2 = dx * dx + dy * dy + dz * dz;
      const on = cell.on ? d2 <= this.offSq : d2 <= this.onSq;
      if (on === cell.on) continue;
      cell.on = on;
      this.listDirty = true;
    }
  }

  /**
   * The candidate list, and it is `scene.meshes` MINUS things rather than a
   * list of its own — which is a full walk of the scene, on purpose.
   *
   * **The order is the reason, and it was measured rather than assumed.** A
   * list assembled as `loose` then `cells` holds exactly the same meshes and
   * hands them over in a different order, and the order reaches the picture:
   * `_activeMeshes` is what the `GlowLayer` accumulates over and what the
   * transparent queue's distance sort breaks ties by, and neither is exact in
   * eight bits. Measured on the reference bank: two of Hollowmere's four
   * vantages moved by 0.0004 and 0.0012 mean/255 — nothing a player could see,
   * three orders below the 0.02 tolerance, and still a picture change this
   * step has no business making. In scene order fourteen of the fifteen banked
   * vantages come back to four decimal places, and the fifteenth moves by
   * 0.0001 for an unrelated reason that is the BLOCK cull rather than this —
   * see finding 21, which locates it.
   *
   * The walk is `O(scene)` and the per-mesh work is one `Map.get` — against
   * `_evaluateActiveMeshes`, which is `O(candidates)` and does an order of
   * magnitude more per mesh, EVERY frame. This runs only when the answer
   * changes: a cell crossing its threshold, or a mesh entering or leaving the
   * scene.
   */
  private rebuildList(): void {
    const data = this.candidates.data;
    data.length = 0;
    let loose = 0;
    for (const mesh of this.scene.meshes) {
      const cell = this.cellOf.get(mesh);
      if (cell) {
        if (cell.on) data.push(mesh);
        continue;
      }
      if (this.hidden.has(mesh)) continue;
      loose++;
      data.push(mesh);
    }
    this.candidates.length = data.length;
    this.listDirty = false;
    let cellsOn = 0;
    for (const cell of this.cells) if (cell.on) cellsOn++;
    this.stats.scene = this.scene.meshes.length;
    this.stats.loose = loose;
    this.stats.cellsOn = cellsOn;
    this.stats.candidates = data.length;
  }
}
