/**
 * WorldCulling.ts — What the frame's own mesh walk is allowed to see.
 * Owns: `Scene.getActiveMeshCandidates`, the map's meshes filed into cull
 * cells, and the list handed back to Babylon each frame.
 * There are TWO lists and they run on different clocks: `eligible` is the
 * structural answer, rebuilt only when a cell, a pool or the scene's
 * membership moves, and `candidates` is that list minus whatever is switched
 * off THIS frame (`offer`, run every frame). The second exists because an
 * effect pool idles with `isVisible = false` several times a second and a
 * rebuild is `O(scene)`.
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
 *   cell per map block — 48 m on every shipped map, `MapLayout.blockSize` where
 *   one states otherwise — and offered only while the camera is inside `reach`
 *   of that cell's own bounds. That is `BlockMerge`'s output, the ink twins of
 *   it and the merged glazing, which between them are every STRUCTURE on the
 *   map.
 * - **Pooled** — a body's rig, filed under the rig ROOT whose `setEnabled` the
 *   roster already writes, and offered only while that root is enabled. This is
 *   the one class whose switch is not a distance: a pool is built once per
 *   roster and re-posed forever, so a rig that is not in the round is twenty
 *   meshes and a root the walk pays full price for and rejects — and a roster is the one
 *   thing on a map that a LAYOUT may triple (`MapLayout.perTeam`, 24 on Sarab
 *   against the shipped 8), which turns 336 of these nodes into **1,008**. See
 *   `setPools`.
 * - **Loose** — everything else in the scene: the terrain, the roads, the rim,
 *   the other pools (tracers, shards, ragdolls, grenades, rubble), the sky, the
 *   water, the grass, the viewmodel, the hulls, and every visual an EDITOR
 *   build makes, which is keyed per placement and carries no block at all.
 *   Always ELIGIBLE — but `offer` still drops the ones that are switched off,
 *   which is what reaches the effect pools: they are built once and idled with
 *   `isVisible = false`, and were most of a candidate list the frame could not
 *   draw from.
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
 * The bounds are the MESHES' rather than the block's nominal square, which is
 * also why nothing here has to be told how big a block IS on this map: the key
 * is a name and not an alignment claim — a merged block's
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

/**
 * What `setPools` is handed: something with a root that is switched and meshes
 * that hang off it. `SoldierRig` already IS this shape, which is why nothing
 * here has heard of a soldier — this file may not learn what a body is any more
 * than it has learned what a building is.
 */
export interface PooledBody {
  root: AbstractMesh;
  meshes: readonly AbstractMesh[];
}

/**
 * One pooled body: the rig root the roster switches, and whether what was filed
 * under it is in the candidate list right now.
 *
 * The root rather than a flag of our own, because it is what `Bot.setEnabled`
 * and `NetSoldier.setEnabled` already write and there must not be a second
 * answer to "is this body in the round". `isEnabled(false)` — the mesh's OWN
 * flag, no ancestor walk — because a rig root is parented to nothing and both
 * of those callers set it directly; asking for the inherited answer would walk
 * a chain to learn what the first byte already said.
 */
interface Pool {
  root: AbstractMesh;
  /** Whether what was filed here is in the candidate list right now. */
  on: boolean;
}

/**
 * Whether a mesh's paint EMITS light, which is the one thing a size gate must
 * never drop.
 *
 * Exact rather than a name test: `CelMaterialFactory.getEmissive` is the only
 * source of a `StandardMaterial` in this tree and it is the only material with
 * an `emissiveColor` — every lit surface wears a `ShaderMaterial`, which has no
 * such property to read.
 */
function glows(mesh: AbstractMesh): boolean {
  const mat = mesh.material as { emissiveColor?: { r: number; g: number; b: number } } | null;
  const e = mat?.emissiveColor;
  return e !== undefined && e.r + e.g + e.b > 0.01;
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

  /**
   * What the list would be if nothing in it were switched off — the structural
   * answer, rebuilt only when a cell, a pool or the scene's membership moves.
   *
   * `candidates` is this list minus whatever is switched off THIS frame, and
   * the two are separate because they change on completely different clocks: a
   * cell crosses its threshold when the camera has walked twenty metres, and a
   * tracer goes out four frames after it was fired. Marking the list dirty for
   * the second would mean a full `O(scene)` rebuild many times a frame, which
   * is the wrong trade in the other direction — see `offer`.
   */
  private eligible: AbstractMesh[] = [];

  /**
   * The meshes `offer`'s size gate may NOT drop, decided once when the list is
   * built rather than per frame.
   *
   * Two classes, and each was found by looking at what a naive gate removed.
   * A POOLED BODY, because a rig is nineteen meshes and a per-mesh size test
   * takes the head off a soldier at 300 m while leaving his torso — the body is
   * already gated whole, by distance, through `bodyDrawDistanceOf`. And
   * anything EMISSIVE, because the glow makes a sub-pixel emitter visible well
   * past its own geometry, and dropping one puts a lit window out on a night
   * map.
   *
   * The emissive test is exact rather than a guess at a name:
   * `CelMaterialFactory.getEmissive` is the only thing in the tree that makes a
   * `StandardMaterial`, every lit cel material is a `ShaderMaterial`, and only
   * the first kind HAS an `emissiveColor` at all.
   */
  private sizeExempt = new Set<AbstractMesh>();

  /** The map's collider proxies: never candidates, at any distance. */
  private hidden = new Set<AbstractMesh>();
  /** Every drawn map mesh that carries a block, and the cell it was filed in. */
  private cellOf = new Map<AbstractMesh, Cell>();
  private cells: Cell[] = [];

  /**
   * Every mesh of every pooled body, and the pool it was filed in.
   *
   * A map of its own rather than a second kind of value in `cellOf`, and that
   * is ownership rather than tidiness: `setMap` clears the cells because last
   * build's meshes are gone, and it runs on a path the ROSTER does not — the
   * editor's rebuild — so a pool sharing that map would be silently unfiled by
   * a tier-3 rebuild and quietly become loose again.
   */
  private poolOf = new Map<AbstractMesh, Pool>();
  private pools: Pool[] = [];

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
    pooled: 0,
    loose: 0,
    cells: 0,
    cellsOn: 0,
    poolsOn: 0,
    /** The eligible list: what a rebuild produced. */
    candidates: 0,
    /** What Babylon was actually handed this frame — `candidates` minus the
     * meshes that are switched off right now. See `offer`. */
    offered: 0,
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
   * Files the round's pooled bodies. Called from `Game.installBodyPools` and
   * from nowhere else, on the same terms `setMap` is called on: whatever was
   * filed last time has been disposed by now, and a pool still holding one
   * would hand Babylon a dead mesh.
   *
   * **Both pools are handed over, not whichever one this round steps.** A
   * netplay round leaves `BattleSystem`'s rigs built and never enables one, so
   * they are exactly the case this exists for — sixteen bodies of pure walk —
   * and an offline round's `NetRoster` is empty and files nothing.
   *
   * The ROOT is filed alongside the drawn meshes on purpose: it is an
   * invisible capsule Babylon rejects late rather than early, and one per body
   * is one per body.
   */
  setPools(bodies: readonly PooledBody[]): void {
    this.poolOf = new Map();
    this.pools = [];
    this.listDirty = true;
    this.stats.pooled = 0;
    for (const body of bodies) {
      const pool: Pool = { root: body.root, on: body.root.isEnabled(false) };
      this.pools.push(pool);
      this.poolOf.set(body.root, pool);
      this.stats.pooled++;
      for (const mesh of body.meshes) {
        this.poolOf.set(mesh, pool);
        this.stats.pooled++;
      }
    }
  }

  /**
   * Picks this frame's candidate list. Called from `Game.tick` in EVERY state,
   * beside `CelMaterialFactory.updateCamera` and for the same reason: every
   * state renders and only some of them simulate, so a menu or a deploy screen
   * with a live view behind it would otherwise be looking at whatever
   * neighbourhood the last live frame stood in.
   *
   * Cheap when nothing has moved — the cells are re-evaluated only once the
   * camera has travelled `CONFIG.graphics.culling.step`, the pools are one
   * property read each, and the list is rebuilt only when one of the two
   * answers changes.
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
    // Unconditional, and it is the roster rather than the camera: a body is
    // switched by DISTANCE from the camera (`BattleSystem`'s three LOD gates)
    // and by being alive, benched, aside or crewed, so there is no travelled
    // distance this could hang off. It is one property read per BODY — 48 on
    // the densest map in the tree, against the 1,008 nodes a rebuild answers
    // for — and it marks the list dirty only on a transition.
    for (const pool of this.pools) {
      const on = pool.root.isEnabled(false);
      if (on === pool.on) continue;
      pool.on = on;
      this.listDirty = true;
    }
    if (this.listDirty) this.rebuildList();
    this.offer(eye);
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
   * The walk is `O(scene)` and the per-mesh work is one or two `Map.get`s —
   * against `_evaluateActiveMeshes`, which is `O(candidates)` and does an order
   * of magnitude more per mesh, EVERY frame. This runs only when the answer
   * changes: a cell crossing its threshold, a pooled body being switched in or
   * out of the round, or a mesh entering or leaving the scene.
   */
  private rebuildList(): void {
    const data = this.eligible;
    data.length = 0;
    let loose = 0;
    for (const mesh of this.scene.meshes) {
      const cell = this.cellOf.get(mesh);
      if (cell) {
        if (cell.on) data.push(mesh);
        continue;
      }
      if (this.hidden.has(mesh)) continue;
      const pool = this.poolOf.get(mesh);
      if (pool) {
        if (pool.on) data.push(mesh);
        continue;
      }
      loose++;
      data.push(mesh);
    }
    this.sizeExempt = new Set();
    for (const mesh of data) {
      if (this.poolOf.has(mesh) || glows(mesh)) this.sizeExempt.add(mesh);
    }
    this.listDirty = false;
    let cellsOn = 0;
    for (const cell of this.cells) if (cell.on) cellsOn++;
    let poolsOn = 0;
    for (const pool of this.pools) if (pool.on) poolsOn++;
    this.stats.scene = this.scene.meshes.length;
    this.stats.loose = loose;
    this.stats.cellsOn = cellsOn;
    this.stats.poolsOn = poolsOn;
    this.stats.candidates = data.length;
  }

  /**
   * This frame's list: the eligible meshes minus the ones that are switched
   * off right now.
   *
   * **It drops exactly what `_evaluateActiveMeshes` would drop, and it drops it
   * before the expensive part rather than after.** That walk rejects a mesh on
   * `!isReady() || !isEnabled() || scaling.hasAZeroComponent` with a bare
   * `continue`, and it reaches the activation test only if `isVisible &&
   * visibility > 0` — where `alwaysSelectAsActiveMesh` bypasses the FRUSTUM
   * test and not this one. So neither of the two asked here can be a mesh
   * Babylon would have drawn, whatever else is true of it. That is the same
   * claim `hidden` already rests on for the collider proxies; this is it made
   * per frame instead of once per map, which is what reaches a POOL.
   *
   * **The pools are why it is worth a pass.** Every effect pool in the game is
   * built once and idled with `isVisible = false` — 96 tracers, 54 embers, 48
   * sparks, 48 shards, 40 impacts, 30 blast chunks, 40 grenade parts, 48 mine
   * parts, 49 blob shadows — and `rebuildList` files all of them as `loose`,
   * so the frame was being offered a few hundred meshes it could not draw.
   * Measured on Sarab at a real viewport and a real roster, this halves the
   * list (1,525 → 729) and is worth **+8.9%** of frame rate; the mesh walk is
   * a third of the tick there, so that is most of what the halving predicts.
   * See `FINDINGS.md` 38, which measured it at the WRONG viewport first and
   * very nearly threw it away.
   *
   * `isEnabled()` walks ancestors and `isVisible` does not, which is the right
   * way round: a rig part is switched by its ROOT, and `setPools` only files
   * the bodies it is handed.
   *
   * The order is a subsequence of `eligible`, which is scene order, so
   * `rebuildList`'s argument about `_activeMeshes` ordering survives intact.
   */
  private offer(eye: Vector3): void {
    const src = this.eligible;
    const out = this.candidates.data;
    const n = src.length;
    // Pixels per radian, from the camera's own field of view and the height it
    // is rendering at — so the threshold is a size on the SCREEN and needs no
    // per-map tuning. Read once a frame: the FOV moves when a sight goes up.
    const cam = this.scene.activeCamera;
    const minPx = CONFIG.graphics.culling.minPixels;
    const gate = minPx > 0 && cam !== null;
    const perRad = gate ? this.scene.getEngine().getRenderHeight() / (cam!.fov || 1) : 0;
    const px2 = minPx * minPx;
    let k = 0;
    for (let i = 0; i < n; i++) {
      const mesh = src[i];
      if (!mesh.isVisible || !mesh.isEnabled()) continue;
      // **The gate is about WORLD geometry and only rendering group 0 holds
      // any.** Everything above it is drawn against the EYE rather than
      // standing in the map — the viewmodel, the sky shell, the moon — and
      // their world bounding info is not what this reads: the viewmodel hangs
      // off the camera and Babylon bakes its matrix inside the render, so at
      // this point in the frame the gun's bounds are still sitting at the
      // ORIGIN. Asked for its size, it answered "1.8 px at 726 m" — the
      // distance from the origin to the player — and the gate deleted the
      // weapon out of the player's hands. `infiniteDistance` is the same
      // argument for the sky, which is nowhere at all.
      if (
        gate &&
        mesh.renderingGroupId === 0 &&
        !mesh.infiniteDistance &&
        !this.sizeExempt.has(mesh)
      ) {
        const sphere = mesh.getBoundingInfo().boundingSphere;
        const c = sphere.centerWorld;
        const dx = c.x - eye.x;
        const dy = c.y - eye.y;
        const dz = c.z - eye.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        // Projected diameter is `2r / dist * perRad`; compared SQUARED, so the
        // per-candidate cost is multiplies and no square root. Taking the root
        // instead measured as a LOSS at the thresholds that drop little.
        const w = 2 * sphere.radiusWorld * perRad;
        if (d2 > 1 && w * w < px2 * d2) continue;
      }
      out[k++] = mesh;
    }
    // Length rather than truncation: the backing array is reused every frame
    // and Babylon reads `length`, so shrinking `data` would be a free-list
    // churn this is trying to avoid.
    out.length = k > out.length ? k : out.length;
    this.candidates.length = k;
    this.stats.offered = k;
  }
}
