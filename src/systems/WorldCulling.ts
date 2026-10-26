/**
 * WorldCulling.ts — What the frame's own mesh walk is allowed to see.
 * Owns: `Scene.getActiveMeshCandidates`; the map's cull CELLS, one a block,
 * each cell's box grown from the RECORDS of every surface filed under its
 * block (`SurfaceRecord.bounds`, X3.7a) — a surface our renderer draws, which
 * has no mesh since X3.7b, as much as one Babylon draws — and Babylon's
 * block-keyed meshes filed into them; the list handed back to Babylon each
 * frame; and the reach and the size gate this file decides, handed to our
 * renderer's GPU cull as numbers (`reachGate`) with the box each of its
 * surfaces is measured to (`reachBoxOf`, by the BLOCK).
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
 * disables a mesh it acquires all four of those problems at once. And every
 * mesh it files in a cell is one of the map's VISUALS with a RECORD naming
 * it — each index of `GameMap.visuals` named by exactly one record of
 * `world.surfaces` (`SurfaceRecord.visual`) — which `setMap` REFUSES a map
 * for in every build, as it does a block-keyed mesh that is no map visual:
 * those are the build's own contract broken rather than a state a map can
 * be in, and a cell grown from anything else would be a box nobody measured.
 * A refusal files nothing and is handed back as its reason, which `Game`
 * spends on `worldFailed` (the menu and a toast, `BABYLON_EXIT.md` X3.7b) —
 * and a reach asked for a block no cell was grown for answers null rather
 * than a box (`reachBoxOf`), which the handover refuses the same way.
 * Never: writes a property on a mesh; grows a cell's box off a mesh's
 * bounding info rather than its record's; files a block-keyed mesh that has
 * no record, or a map whose visuals and records disagree — it refuses the
 * map instead; throws for a build's broken contract.
 *
 * **The frame walks the SCENE, and the scene is the map.**
 * `_evaluateActiveMeshes` iterates every candidate every frame — a Map get for
 * the LOD, `isBlocked`, `getTotalVertices`, `isReady`, `isEnabled` — before it
 * has decided anything, and the walk is `O(candidates)` whatever the camera can
 * see. Measured (`ENGINE_UPGRADE.md` S0): **1.10 us per mesh in the scene per
 * frame**, 23.0 ms of a 30.3 ms frame on a 1500 m map and still 7.6 of 10.1 ms
 * on the 900/300 one. Frustum culling does not help — it is the decision this
 * walk REACHES, not the walk. `ENGINE_UPGRADE.md` wall 1 is this, and this file
 * is S1.
 *
 * **Disabling a mesh is the wrong lever and a candidate list is the right one.**
 * `setEnabled(false)` leaves the mesh in the walk and merely shortens what the
 * walk does with it — which is why the 0.67 us and the 1.10 us that
 * `ENGINE_UPGRADE.md` S0 sets side by side disagree about the same number —
 * and it costs the four indifferences above: a disabled mesh is out of the
 * shadow map's render list, out of a cube probe's bake, and out of anything
 * picking with Babylon's own default filter.
 * `Scene.getActiveMeshCandidates` is the supported extension point (it is what
 * `createOrUpdateSelectionOctree` replaces), it is read in exactly one place,
 * and a mesh left out of it is skipped ENTIRELY rather than skipped cheaply.
 *
 * **Four classes of mesh, and which class a mesh is in is the whole design.**
 * What our renderer draws (below) is in none of them: it has no mesh.
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
 *   of that cell's own bounds. On a shipped build that is the merged glazing
 *   and the fires, the rest of `BlockMerge`'s output being our renderer's
 *   (below); the cell's box is grown from all of it, every STRUCTURE on the
 *   map.
 * - **Pooled** — a body's rig, filed under the rig ROOT whose `setEnabled` the
 *   roster already writes, and offered only while that root is enabled. A pool
 *   is built once per roster and re-posed forever, so a rig that is not in the
 *   round is fourteen
 *   meshes and a root the walk pays full price for and rejects — and a roster is the one
 *   thing on a map that a LAYOUT may triple (`MapLayout.perTeam`, 24 on Sarab
 *   against the shipped 8), which turns 336 of these nodes into **1,008**. See
 *   `setPools`. It is also the one class the size gate measures ONCE, off the
 *   root, dropping the body whole rather than mesh by mesh — see `gateOf`.
 * - **Loose** — everything else in the scene: the terrain, the roads, the rim,
 *   the other pools (tracers, shards, ragdolls, grenades, rubble), the sky, the
 *   water, the grass, the viewmodel, the hulls, and every visual an EDITOR
 *   build makes, which is keyed per placement and carries no block at all.
 *   Always ELIGIBLE — and `offer` still drops the ones that are
 *   switched off, which is what reaches the effect pools: they are built once
 *   and idled with `isVisible = false`, and were most of a candidate list the
 *   frame could not draw from.
 *
 * **The landform is deliberately loose and that is not an oversight.** A
 * structure past the fog wall draws exactly `fogColor` and stands in front of
 * ground that draws exactly `fogColor`, so dropping it cannot move a pixel. The
 * terrain and the rim are what the SKY is behind, and `SkySpec.horizonColor` is
 * only required to sit CLOSE to the fog — so a hole cut in the rim is a hole
 * onto a gradient, and the further up the dome it is the less it is fogColor.
 * They are also a few hundred meshes against several thousand structures.
 * Drawn by our renderer (X3.5), they keep that answer: no reach, the size
 * gate per surface, the frustum (`reachBoxOf`).
 *
 * **What our renderer draws is no mesh at all** (`systems/BlockHandover.ts`,
 * `BABYLON_EXIT.md` X3.3, X3.5, X3.6e, X3.7b): every BLOCK surface — the
 * emissive PALETTE's merges among them — is measured to the box of its
 * block's cell, which its RECORD helped grow, and the LANDFORM to a box no
 * reach is ever short of (`reachBoxOf`). The main pass's mesh walk never
 * sees any of it, and nothing else of Babylon's does either: our renderer
 * draws it in every pass. What this file decides for the candidates — the
 * reach, and the size gate's scale this frame — it states as numbers in
 * `reachGate`, so the GPU cull decides our clusters as this decides a
 * candidate, and reads no node to do it.
 *
 * The reach is the map's own `fogEnd` plus `CONFIG.graphics.culling.pad`, and
 * on a map whose fog never closes — `fogEnd` past its own diagonal, which the
 * proving ground states on purpose — that is a reach nothing is outside and
 * this degrades to the hidden-collider half alone.
 */
import type { AbstractMesh, Mesh, Scene, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import { type BlockBox, F32_MAX, type ReachGate } from "../render/ClusterCull";
import type { GameMap } from "../world/MapBuilder";
import type { SurfaceBounds, SurfaceRecord } from "../world/worldGeometry";

/**
 * The reach box of the LANDFORM — the floor, the rim and the road merge, which
 * our renderer draws (`reachBoxOf`): every point is inside it, so no
 * reach is ever short of it, and the GPU cull keeps the landform's clusters
 * to the size gate and the frustum, exactly as `rebuildList` keeps a loose
 * mesh. **The sky is behind the landform** — see "The landform is
 * deliberately loose" in the header — so a reach cut into it would be a hole
 * onto a gradient rather than onto `fogColor`. Its one other user is
 * `BlockHandover`: a caster held for the shadow maps alone, which no main
 * pass draws, is cut with it too. FINITE, near the largest `f32`
 * (`F32_MAX`, 3e38), never Infinity: the cull's arithmetic may assume there
 * is none, and a box from minus to plus the largest float leaves every
 * distance to it 0.
 */
export const NO_REACH: BlockBox = {
  minX: -F32_MAX,
  minY: -F32_MAX,
  minZ: -F32_MAX,
  maxX: F32_MAX,
  maxY: F32_MAX,
  maxZ: F32_MAX,
};

/**
 * One cull cell: a map block's own world box, and whether what was filed under
 * it is in the frame.
 *
 * The cell does not hold its meshes — `cellOf` points the other way, from a
 * mesh to its cell, because the list is rebuilt by walking the scene in ORDER
 * rather than by concatenating cells (see `rebuildList`).
 *
 * The bounds are the SURFACES' rather than the block's nominal square — read
 * off each one's record (`SurfaceRecord.bounds`), mesh or none — which is
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
 * The root rather than a flag of our own, because it is what
 * `NetSoldier.setEnabled` already writes and there must not be a second
 * answer to "is this body in the round". `isEnabled(false)` — the mesh's OWN
 * flag, no ancestor walk — because a rig root is parented to nothing and both
 * of those callers set it directly; asking for the inherited answer would walk
 * a chain to learn what the first byte already said.
 */
interface Pool {
  root: AbstractMesh;
  /** Whether what was filed here is in the candidate list right now. */
  on: boolean;
  /**
   * Whether this body projected under the size gate THIS FRAME — one test
   * taken off the root in `offer`, read by every mesh filed under it.
   *
   * On the pool rather than in a set of its own because it is per body and
   * per frame, and the body is the thing that already exists: a set would be
   * rebuilt every frame for the one bit it carries. It runs on a different
   * clock from `on` — that one is the ROSTER's and marks the list dirty, this
   * one is the CAMERA's and never does, because a body going too small to see
   * changes nothing structural.
   */
  small: boolean;
}

/**
 * Whether a mesh's paint EMITS light, which is the one thing a size gate must
 * never drop.
 *
 * Exact rather than a name test: a material carrying an `emissiveColor` is a
 * light source — `CelMaterialFactory.getEmissive`'s unlit `StandardMaterial`,
 * or the fire (`FlameMaterial`), which declares one for this test and the
 * glow's (the map's emissive palette, `EmissiveWorldMaterial`, declares one
 * too, and is worn by no mesh: our renderer draws it).
 * Every lit surface wears a plain `ShaderMaterial`, which has no such property
 * to read.
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
   * How `offer`'s size gate treats a mesh, where the plain per-mesh test is
   * not the answer — decided once when the list is built rather than per
   * frame, and ABSENT for the ordinary case.
   *
   * Two classes, and each was found by looking at what a naive gate removed.
   *
   * **A POOLED BODY maps to its `Pool`, and is gated WITH the body.** A rig is
   * fourteen meshes and a per-mesh verdict takes the head off a soldier at
   * 300 m while leaving his torso, which is what the exemption this replaced
   * was for; measuring the ROOT instead asks the question once and answers it
   * the same way for every mesh of that body, so the failure it guarded
   * against cannot occur and the body can still be dropped. It is the same
   * thing `bodyDrawDistanceOf` does, in SCREEN space rather than in metres —
   * so it needs no per-map number, and it loosens by itself when a sight goes
   * up and the body gets bigger.
   *
   * **Anything EMISSIVE maps to `null` and is never gated at all**, because
   * the glow makes a sub-pixel emitter visible well past its own geometry and
   * dropping one puts a lit window out on a night map. The test is exact
   * rather than a guess at a name: only a light source HAS an `emissiveColor`
   * at all — see `glows`.
   *
   * **A body's own emissive is the POOL's and not the exemption's**, which is
   * the one place the two classes meet and the order below is what decides it.
   * A visor is the only emissive on a rig; it belongs to a body that is being
   * dropped whole, and an exemption would leave a pair of eyes hanging in the
   * air where the soldier was.
   *
   * **A mesh filed in a CELL maps to its record's bounds** (`SurfaceRecord.
   * bounds`), and is tested off that sphere rather than its mesh's, because
   * X3.7 asks the size gate to read the record wherever the cells do
   * (`BABYLON_EXIT.md` X3.7a). A candidate is still a mesh; the record and the
   * mesh hold the same numbers bit for bit (`npm run merge:hash` checks every
   * visual), so the verdict is the one the mesh's own sphere gave. Every
   * other mesh — a loose one, an editor build's, an effect — is absent and
   * tested off its own bounding info, which an editor move rewrites under it.
   */
  private gateOf = new Map<AbstractMesh, Pool | SurfaceBounds | null>();

  /** Every mesh filed in a cell, and the bounds its record holds — see `gateOf`. */
  private filedBounds = new Map<AbstractMesh, SurfaceBounds>();

  /** The map's collider proxies: never candidates, at any distance. */
  private hidden = new Set<AbstractMesh>();
  /** Every drawn map mesh that carries a block, and the cell it was filed in. */
  private cellOf = new Map<AbstractMesh, Cell>();
  private cells: Cell[] = [];
  /** Each cell by its block key — what `reachBoxOf` answers our renderer's surfaces off. */
  private cellByKey = new Map<string, Cell>();

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

  /**
   * The reach and the size gate as this file decides them THIS frame, for
   * our renderer's GPU cull (`render/ClusterCull.ts`): rewritten in place by
   * every `update`. The reach is the distance a cell switches ON at, from
   * the eye to the cell's box, and Infinity while everything is offered; the
   * size gate is `offer`'s own, off under the warm-up.
   */
  readonly reachGate: ReachGate = {
    reach: Number.POSITIVE_INFINITY,
    sizeGate: false,
    perRad: 0,
    px2: 0,
  };

  /** Set when the candidate list no longer matches the state above. */
  private listDirty = true;

  /**
   * Whether this frame offers EVERYTHING — every cell, every pool and no size
   * gate — for the building card's pipeline warm-up (`core/PipelineWarmup.ts`).
   * See `setWarm`.
   */
  private warm = false;

  /** Squared distances a cell switches at. Infinite reach culls nothing. */
  private on = Number.POSITIVE_INFINITY;
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
    // A flag rather than any real work, because these fire for every mesh a
    // build creates and destroys — of the order of a million on a 1500 m map
    // while every part was a mesh (`ENGINE_UPGRADE.md`, wall 4), thousands of
    // colliders still — and the rebuild they ask for is owed once.
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
   *
   * Null once filed; else the build's contract it found broken — a visual
   * no record names, or two do, a record naming no visual, a block-keyed
   * mesh that is no map visual — with nothing filed, as `setMap(null)`
   * leaves it: the caller fails the world on it (`Game.worldFailed`).
   */
  setMap(map: GameMap | null, fogEnd: number): string | null {
    this.hidden = new Set();
    this.cellOf = new Map();
    this.cellByKey = new Map();
    this.filedBounds = new Map();
    this.cells = [];
    this.listDirty = true;
    this.evalX = Number.POSITIVE_INFINITY;
    this.evalZ = Number.POSITIVE_INFINITY;
    this.stats.hidden = 0;
    this.stats.blocked = 0;
    this.stats.cells = 0;
    // The lists handed to Babylon, emptied rather than only marked dirty:
    // `offer` rewrites `candidates` by LENGTH, so everything past it is last
    // build's meshes, disposed and kept alive by this array alone.
    this.candidates.data.length = 0;
    this.candidates.length = 0;
    this.eligible.length = 0;
    this.gateOf = new Map();
    if (!map) {
      this.on = Number.POSITIVE_INFINITY;
      this.onSq = Number.POSITIVE_INFINITY;
      this.offSq = Number.POSITIVE_INFINITY;
      return null;
    }
    const refused = this.file(map, fogEnd);
    if (refused) this.setMap(null, 0);
    return refused;
  }

  /** `setMap`'s filing: null once done, else what the build broke (see `setMap`). */
  private file(map: GameMap, fogEnd: number): string | null {
    const c = CONFIG.graphics.culling;
    // Clamped at zero because the reach is SQUARED below, and a negative one
    // squares back to an enormous positive — which would turn a map claiming
    // no view distance at all into a map that culls nothing. Zero is the
    // honest reading of it: only the cell the camera is standing in.
    const on = Math.max(0, fogEnd + c.pad + c.step);
    const off = on + c.hysteresis;
    this.on = on;
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

    // Each visual's RECORD (`GameMap.world`, one a surface, each naming its
    // mesh if it has one): every index of `visuals` named exactly once.
    const surfaces = map.world.surfaces;
    const recordOfVisual = new Array<SurfaceRecord | undefined>(map.visuals.length);
    for (const record of surfaces) {
      const v = record.visual;
      if (v < 0) continue;
      if (v >= map.visuals.length) return `the record "${record.name}" names visual ${v} of ${map.visuals.length}`;
      const named = recordOfVisual[v];
      if (named) return `visual ${v} is named by both "${named.name}" and "${record.name}"`;
      recordOfVisual[v] = record;
    }
    const recordByMesh = new Map<AbstractMesh, SurfaceRecord>();
    for (let v = 0; v < map.visuals.length; v++) {
      const record = recordOfVisual[v];
      if (!record) return `the visual "${map.visuals[v].name}" has no surface record`;
      recordByMesh.set(map.visuals[v], record);
    }
    // The cells, grown from EVERY record filed under a block — mesh or none:
    // its bounds were taken off its arrays before they were released, the
    // numbers its mesh's bounding info holds where it has one. In list
    // order; a box is a min and a max, which no order moves.
    for (const record of surfaces) {
      const key = blockOf(record.metadata);
      if (key === null) continue;
      const b = record.bounds;
      let cell = this.cellByKey.get(key);
      if (cell) {
        if (b.minX < cell.minX) cell.minX = b.minX;
        if (b.minY < cell.minY) cell.minY = b.minY;
        if (b.minZ < cell.minZ) cell.minZ = b.minZ;
        if (b.maxX > cell.maxX) cell.maxX = b.maxX;
        if (b.maxY > cell.maxY) cell.maxY = b.maxY;
        if (b.maxZ > cell.maxZ) cell.maxZ = b.maxZ;
      } else {
        cell = {
          minX: b.minX,
          minY: b.minY,
          minZ: b.minZ,
          maxX: b.maxX,
          maxY: b.maxY,
          maxZ: b.maxZ,
          on: true,
        };
        this.cellByKey.set(key, cell);
        this.cells.push(cell);
      }
    }
    // Babylon's block-keyed meshes, each into its cell: the glazing and the
    // fires on a shipped build, and on an editor's none (it carries no
    // block). The glazing is filed under the same key its block is, which is
    // the key `PaneBlocks` writes it under — a curtain wall and the shaft
    // behind it go out of the frame together, or the tower is a sheet of
    // glass hanging in the fog with nothing behind it.
    const fileMesh = (mesh: Mesh): string | null => {
      const key = blockOf(mesh.metadata);
      if (key === null || this.cellOf.has(mesh) || this.hidden.has(mesh)) return null;
      const record = recordByMesh.get(mesh);
      if (!record) return `"${mesh.name}" carries a block but is no map visual`;
      // Its own record is filed under the same key, so the cell exists.
      this.cellOf.set(mesh, this.cellByKey.get(key)!);
      this.filedBounds.set(mesh, record.bounds);
      this.stats.blocked++;
      return null;
    };
    for (const mesh of map.visuals) {
      const refused = fileMesh(mesh);
      if (refused) return refused;
    }
    for (const group of map.paneGroups) {
      const refused = fileMesh(group.mesh);
      if (refused) return refused;
    }
    this.stats.cells = this.cells.length;
    return null;
  }

  /**
   * Files the round's pooled bodies. Called from `Game.installBodyPools` and
   * from nowhere else, on the same terms `setMap` is called on: whatever was
   * filed last time has been disposed by now, and a pool still holding one
   * would hand Babylon a dead mesh.
   *
   * Every pooled body is handed over, whether or not this round enables it:
   * a rig built and never enabled is exactly the case this exists for — a
   * body of pure walk.
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
      const pool: Pool = {
        root: body.root,
        on: body.root.isEnabled(false),
        small: false,
      };
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
   * The box our renderer's cull measures a surface's reach to, by the BLOCK
   * its record is filed under (`metadata.block`): that block's cell — the
   * bounds of every surface of it, glazing included, what a candidate of it
   * is offered by — and for `null`, the LANDFORM, `NO_REACH`, which the
   * reach never cuts, as it never cuts a loose mesh. Surfaces of one block
   * share the object, and every landform surface shares the one box. A key
   * no cell was grown for — a record filed under a block grows one, so the
   * build's contract is broken — answers null, which the caller REFUSES as
   * it refuses `setMap`'s reasons: the world fails (`BlockHandover.install`,
   * `Game.worldFailed`), never an uncaught throw inside `installMap`.
   */
  reachBoxOf(block: string | null): BlockBox | null {
    if (block === null) return NO_REACH;
    return this.cellByKey.get(block) ?? null;
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
    // switched by DISTANCE from the camera (`NetRoster`'s LOD gate)
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
   * Offers every mesh this file would otherwise hold back, for as long as it is
   * on: every cell whatever its distance, every pool whether or not its root
   * is in the round, and no size gate. What is switched OFF is still dropped by
   * `offer`, because Babylon would drop it too; what warm changes for our
   * renderer's surfaces, which are no candidates, is `reachGate` — no reach
   * and no size gate — handed to its cull, which keeps its own frustum.
   *
   * It exists for one caller — the warm-up under the building card, which
   * draws the whole map once from each vantage so that every pipeline the
   * round will need is compiled before the round can see the cost — and that
   * caller turns it on and back off around a single render, so a wait that is
   * abandoned between frames cannot leave the map unculled. It is still a
   * claim about the LIST and nothing else: no mesh is written, which is this
   * file's first invariant.
   */
  setWarm(on: boolean): void {
    if (on === this.warm) return;
    this.warm = on;
    this.listDirty = true;
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
   * `_activeMeshes` is what the glow's mask is built from and what the
   * transparent queue's distance sort breaks ties by, and neither is exact in
   * eight bits. Measured on the reference bank: two of Hollowmere's four
   * vantages moved by 0.0004 and 0.0012 mean/255 — nothing a player could see,
   * three orders below the 0.02 tolerance, and still a picture change this
   * step has no business making. In scene order fourteen of the fifteen banked
   * vantages come back to four decimal places, and the fifteenth moves by
   * 0.0001 for an unrelated reason that is the BLOCK cull rather than this —
   * see `ENGINE_UPGRADE.md` S1, which locates it.
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
        if (cell.on || this.warm) data.push(mesh);
        continue;
      }
      if (this.hidden.has(mesh)) continue;
      const pool = this.poolOf.get(mesh);
      if (pool) {
        if (pool.on || this.warm) data.push(mesh);
        continue;
      }
      loose++;
      data.push(mesh);
    }
    // The pool FIRST, because a rig's visor is both and the body wins — see
    // `gateOf` — then the emissive exemption, then a filed mesh's record,
    // which the size gate reads where the cells do (X3.7a).
    // Everything the gate tests off its own mesh is left out, so that case is
    // a miss rather than an entry.
    this.gateOf = new Map();
    for (const mesh of data) {
      const pool = this.poolOf.get(mesh);
      if (pool) this.gateOf.set(mesh, pool);
      else if (glows(mesh)) this.gateOf.set(mesh, null);
      else {
        const bounds = this.filedBounds.get(mesh);
        if (bounds) this.gateOf.set(mesh, bounds);
      }
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
   * It was measured at the WRONG viewport first and very nearly thrown away;
   * `VERIFYING.md` carries that trap.
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
    //
    // **In CSS pixels, and the scaling level is what makes it CSS.**
    // `getRenderHeight` is the BACKING STORE, which is not a fixed unit: the
    // render-scale setting is a `setHardwareScalingLevel` and moves it under
    // this gate, so a threshold left in backing pixels is a different
    // threshold per rung — at 0.5 it drops everything under 6 CSS px, twice
    // the threshold it was tuned at, so a hull holds off until half the range
    // the measurement chose. It fails the other way just as quietly: anything
    // that oversamples the CSS grid shrinks the gate instead and hands back
    // the CPU `FINDINGS.md` 39 bought (3 px is -0.51 ms there, 2 px -0.11). The
    // level already carries `devicePixelRatio`, since `Game.applyRenderScale`
    // is what built it from one, and it is 1 at every default install — so this
    // is arithmetically the shipped gate on the reference machine and on a
    // fresh install of any density, and only moves once the player has moved
    // the slider.
    const cam = this.scene.activeCamera;
    const minPx = CONFIG.graphics.culling.minPixels;
    const gate = !this.warm && minPx > 0 && cam !== null;
    const engine = this.scene.getEngine();
    const perRad = gate
      ? (engine.getRenderHeight() * engine.getHardwareScalingLevel()) /
        (cam!.fov || 1)
      : 0;
    const px2 = minPx * minPx;
    const reachGate = this.reachGate;
    reachGate.reach = this.warm ? Number.POSITIVE_INFINITY : this.on;
    reachGate.sizeGate = gate;
    reachGate.perRad = perRad;
    reachGate.px2 = px2;
    // **A BODY is measured ONCE, off its root, and drops whole.** One test per
    // body rather than per mesh, taken before the walk so that the walk reads
    // an answer instead of computing fourteen of them — and, far more
    // importantly, so that every mesh of a body gets the SAME answer. See
    // `gateOf` for why a per-mesh verdict cannot be allowed near a rig.
    for (let i = 0; i < this.pools.length; i++) {
      const pool = this.pools[i];
      if (!gate || !pool.on) {
        pool.small = false;
        continue;
      }
      // **The root's matrix is FORCED, and without this the drop LATCHES.**
      // Babylon computes a world matrix inside `_evaluateActiveMeshes` and
      // only for CANDIDATES, and that is what refreshes the world bounding
      // sphere `tooSmall` reads — so a body dropped on stale bounds is never
      // handed the matrix that would correct them and can never come back,
      // however close it walks. A rig ROOT is worse off than the meshes that
      // failure was first found on (`docs/rendering.md`): it is invisible, so
      // `offer` has always dropped it on the line above and the walk has
      // never computed it at all — it was reached only incidentally, as the
      // parent of a child that WAS a candidate, which is exactly the thread
      // this gate would cut. One forced compose per body per frame, 48 on the
      // densest map in the tree, also makes the measurement this frame's
      // rather than last frame's.
      pool.root.computeWorldMatrix(true);
      pool.small = tooSmallMesh(pool.root, eye, perRad, px2);
    }
    let k = 0;
    for (let i = 0; i < n; i++) {
      const mesh = src[i];
      if (!mesh.isVisible || !mesh.isEnabled()) continue;
      // **The gate is about WORLD geometry and only rendering group 0 holds
      // any.** Everything above it is drawn against the EYE rather than
      // standing in the map — the viewmodel — and
      // their world bounding info is not what this reads: the viewmodel hangs
      // off the camera and Babylon bakes its matrix inside the render, so at
      // this point in the frame the gun's bounds are still sitting at the
      // ORIGIN. Asked for its size, it answered "1.8 px at 726 m" — the
      // distance from the origin to the player — and the gate deleted the
      // weapon out of the player's hands. `infiniteDistance` is the same
      // argument for the sky, which is nowhere at all.
      if (gate && mesh.renderingGroupId === 0 && !mesh.infiniteDistance) {
        // ONE lookup, which is why the two answers share a map: this runs on
        // every candidate every frame, and the emissive exemption used to be
        // the only question here.
        const how = this.gateOf.get(mesh);
        if (how === undefined) {
          if (tooSmallMesh(mesh, eye, perRad, px2)) continue;
        } else if (how !== null) {
          // A body's verdict, taken once off its root; else a filed surface's
          // record, the same sphere its mesh holds — see `gateOf`.
          const small =
            "root" in how
              ? how.small
              : tooSmall(how.centerX, how.centerY, how.centerZ, how.radius, eye, perRad, px2);
          if (small) continue;
        }
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

/** `tooSmall` off a mesh's own world bounding sphere. */
function tooSmallMesh(mesh: AbstractMesh, eye: Vector3, perRad: number, px2: number): boolean {
  const sphere = mesh.getBoundingInfo().boundingSphere;
  const c = sphere.centerWorld;
  return tooSmall(c.x, c.y, c.z, sphere.radiusWorld, eye, perRad, px2);
}

/**
 * Whether a world bounding sphere projects smaller than the gate, in CSS
 * pixels of the frame.
 *
 * The one place a projected size is measured, because `offer` asks the
 * question of three different things — a loose mesh, a body's ROOT and a
 * filed surface's record — and two copies of this arithmetic is two answers
 * that can drift apart.
 *
 * `d2 > 1` is the guard on standing inside a thing: the projection diverges
 * at zero distance and a metre is nearer than anything this should be
 * dropping.
 */
function tooSmall(
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  eye: Vector3,
  perRad: number,
  px2: number,
): boolean {
  const dx = cx - eye.x;
  const dy = cy - eye.y;
  const dz = cz - eye.z;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 <= 1) return false;
  // Projected diameter is `2r / dist * perRad`; compared SQUARED, so the
  // per-candidate cost is multiplies and no square root. Taking the root
  // instead measured as a LOSS at the thresholds that drop little.
  const w = 2 * radius * perRad;
  return w * w < px2 * d2;
}

/** The block a surface or a mesh is filed under (`metadata.block`), or null for none. */
export function blockOf(metadata: { block?: unknown } | null | undefined): string | null {
  const key = metadata?.block;
  return typeof key === "string" && key !== "" ? key : null;
}
