/**
 * WorldCulling.ts — What the frame's own mesh walk was allowed to see, and
 * what our renderer's culls are handed in its place.
 * **The mesh walk is gone** (`BABYLON_EXIT.md` X5.4f): the scene is never
 * rendered (`core/SceneFrame.ts`), so `Scene.getActiveMeshCandidates` is never
 * asked, and the candidate list this file handed Babylon every frame — the
 * `eligible` list and its per-frame `candidates`, the emissive exemption, a
 * loose mesh's size gate — was retired with it. The prose below argues the
 * design the cells, the gate and the pools still carry; where it speaks of
 * the candidate list, read it as the history of the numbers this file still
 * decides.
 * Owns: the map's cull CELLS, one a block,
 * each cell's box grown from the RECORDS of every surface filed under its
 * block (`SurfaceRecord.bounds`, X3.7a) — a surface our renderer draws, which
 * has no mesh since X3.7b, as much as one Babylon draws — and Babylon's
 * block-keyed meshes filed into them (none on a shipped build); and the reach
 * and the size gate this file decides, handed to our
 * renderer's GPU cull as numbers (`reachGate`) with the box each of its
 * surfaces is measured to (`reachBoxOf`, by the BLOCK) — and, since
 * `BABYLON_EXIT.md` X4.4d, whether a cell's block-keyed surfaces are offered
 * this frame (`offersBlock`), which our renderer's FIRES are drawn by.
 * Two answers run on different clocks: what a cell OFFERS (`offersBlock`) is
 * snapshotted only when a cell crosses its threshold (`rebuildList`), and the
 * pools' verdicts and the gate's numbers are taken every frame (`offer`).
 * Invariants: it NEVER writes `setEnabled`, `isVisible`, `isPickable` or any
 * other property on a mesh — the whole of what it does is decide answers our
 * renderer's DRAWS read and nothing else does: the reach and the size gate
 * (`reachGate`, `reachBoxOf`), whether a cell's block-keyed surfaces are
 * offered (`offersBlock`), each pooled body's verdict and fade (`drawsBody`,
 * `bodyFade`) and the gate asked of a sphere or a hull (`keepsSphere`,
 * `keepsDetail`, `hullFade`). Until `BABYLON_EXIT.md` X5.4f it also decided
 * which meshes Babylon was offered as candidates for the ACTIVE-MESH pass;
 * that list is gone with the walk, and nothing of Babylon's reads anything
 * here. So every ray, every collision,
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
 * **Three classes of mesh, and which class a mesh is in is the whole design.**
 * What our renderer draws (below) is in none of them: it has no mesh. (A
 * fourth, **hidden**, was the map's collider proxies — invisible boxes the
 * walk paid full price for and rejected on `isVisible`, 5,929 of 9,002 scene
 * meshes on the 900/300 proving ground, never candidates at any distance and
 * most of this file's first win. No collider is a mesh since
 * `BABYLON_EXIT.md` X5.3e, so there is nothing left to hide.)
 *
 * - **Blocked** — drawn map geometry carrying `metadata.block`, filed one cull
 *   cell per map block — 48 m on every shipped map, `MapLayout.blockSize` where
 *   one states otherwise — and offered only while the camera is inside `reach`
 *   of that cell's own bounds. On a shipped build NOTHING is filed here since
 *   `BABYLON_EXIT.md` X4.6e: the merged glazing was the last of it, and every
 *   block surface is our renderer's (below); the cell's box is still grown
 *   from all of it, every STRUCTURE on the map. The world's FIRES (since
 *   X4.4d) and the GLAZING (since X4.6e) are no mesh: our renderer draws each
 *   (`render/FlameDraw.ts`, `render/GlassDraw.ts`) while its block's cell is
 *   offered, read back by the block (`offersBlock`) — the same cell, the same
 *   reach and the same hysteresis a filed mesh is offered by — a pane through
 *   the size gate as a filed mesh was, off its record's sphere
 *   (`keepsSphere`), and a fire, a light source, through none.
 * - **Pooled** — what was a body's rig, fourteen meshes the walk paid for
 *   whether or not the body was in the round. Since `BABYLON_EXIT.md` X4.1d no
 *   body is a mesh: our renderer draws every one as an instance of its kit
 *   (`render/BodyDraw.ts`), so a pool files NOTHING into the list. What stays
 *   here is the body's half of the size gate — measured ONCE, off the body's
 *   own measure, dropping the body whole (`drawsBody`), which is what this
 *   class always was the one class to get — handed to the drawing as a
 *   verdict, as `reachGate` hands the world's numbers to its cull. Since
 *   X4.1e the verdict has a FADE (`bodyFade`): the same measure ramps a body
 *   out at the size gate and short of `bodyDrawDistance`, and the drawing
 *   spends it as a screen door, so a body leaves at either edge without a
 *   pop.
 * - **Loose** — everything else in the scene: the terrain, the roads, the rim,
 *   the effect pools Babylon drew (every one our renderer's and no mesh now —
 *   the sparks, the dust discs, the scorch and the blob shadows since X4.6e,
 *   asked `keepsSphere` of this frame's sphere but the emissive two, which the
 *   gate never dropped; the tracers, the marks, the brass and the thrown and laid bodies are our
 *   renderer's and no mesh since `BABYLON_EXIT.md` X4.4b, the size gate
 *   reaching their cel parts through `keepsSphere`; the blast's billows, the
 *   shards and the rubble since X4.4c, a billow emissive and so never gated,
 *   a shard and a chunk asked `keepsSphere` of the sphere it is drawn with
 *   this frame, `poseView`) (the viewmodel is our renderer's whole since
 *   `BABYLON_EXIT.md` X4.3d — the optics' glass and the kit card the last of
 *   it — and no candidate; the sky since X4.5, the grass since X4.6c, the
 *   field's one sphere asked of `keepsSphere` by `Game.drawGrass`, and the water
 *   since X4.6d, each body's by `Game.drawWater`). The HULLS were
 *   loose until `BABYLON_EXIT.md` X4.2b and are no mesh now: our renderer
 *   draws each as an instance of its kind's kit, and the size gate reaches
 *   its segments one by one through `keepsSphere` — the test a loose mesh
 *   gets, asked of a sphere its caller composed this frame. Since X4.2c the
 *   hull's DETAIL tier asks one more question of the same arithmetic, once a
 *   hull, of its whole MEASURE (`keepsDetail`): whether its detail segments
 *   are drawn at all — a swap on top of the per-segment gate, never a drop
 *   of the hull. Since X4.2d the same measure is asked how much of the hull
 *   is drawn at all (`hullFade`): a ramp over the last tenth of the map's
 *   `hullDrawDistance`, which the drawing spends as the bodies' screen door
 *   — the DISTANCE only, no hull ever dropped by its size.
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
 * this offers every mesh it is handed.
 */
import type { AbstractMesh, Scene, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import { type BlockBox, F32_MAX, type ReachGate } from "../render/ClusterCull";
import type { GameMap } from "../world/MapBuilder";
import type { SurfaceRecord } from "../world/worldGeometry";

/**
 * The reach box of the LANDFORM — the floor, the rim and the road merge, which
 * our renderer draws (`reachBoxOf`): every point is inside it, so no
 * reach is ever short of it, and the GPU cull keeps the landform's clusters
 * to the size gate and the frustum, exactly as `rebuildList` keeps a loose
 * mesh. **The sky is behind the landform** — see "The landform is
 * deliberately loose" in the header — so a reach cut into it would be a hole
 * onto a gradient rather than onto `fogColor`. FINITE, near the largest `f32`
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
 * The cell holds no meshes. Until `BABYLON_EXIT.md` X5.4f a map pointed the
 * other way, from a mesh to its cell, because the candidate list was rebuilt
 * by walking the scene in ORDER rather than by concatenating cells; the walk
 * and the list are gone, and what is left of the filing is `filed`, a set
 * that only dedupes a block-keyed mesh and counts it (`stats.blocked`).
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
  /** Whether the cell is within reach right now, as `evaluate` last decided (with its hysteresis). */
  on: boolean;
  /**
   * Whether what is filed here is OFFERED — `on`, snapshotted where
   * `rebuildList` runs, which is where the candidate list was built until
   * `BABYLON_EXIT.md` X5.4f, so it changes exactly when a filed mesh's
   * candidacy did (`offersBlock`). False until the first rebuild after
   * `setMap`, as a filed mesh was no candidate until then.
   */
  offered: boolean;
}

/** A body's world bounding sphere, as `PooledBody.measure` writes it. */
export interface BodyMeasure {
  x: number;
  y: number;
  z: number;
  radius: number;
}

/**
 * What `setPools` is handed: a body that is switched, and its one measure.
 * `SoldierModel.pooledBody` makes one of a rig, which is why nothing here has
 * heard of a soldier — this file may not learn what a body is any more than it
 * has learned what a building is. It draws no mesh (`BABYLON_EXIT.md` X4.1d):
 * what this decides of it is read back by index (`drawsBody`).
 */
export interface PooledBody {
  /**
   * Whether the body is in the round — the switch `NetSoldier.setEnabled` and
   * the death cam already write, so there is no second answer to that here.
   */
  readonly enabled: boolean;
  /**
   * The body's world bounding sphere THIS frame, composed fresh — what the
   * rig ROOT's capsule answered under a forced `computeWorldMatrix` until the
   * root stopped being a mesh (`BABYLON_EXIT.md` X4.1a).
   */
  measure(out: BodyMeasure): void;
}

/**
 * One pooled body: the body the roster switches, and this frame's two answers
 * about it.
 */
interface Pool {
  body: PooledBody;
  /** Whether the body was switched on as this frame's list was offered. */
  on: boolean;
  /**
   * How much of this body is drawn THIS FRAME, 0 to 1 — the lesser of its
   * fade at the distance edge and at the size gate, taken off its measure in
   * `offer` once, the same answer for the whole body (`BABYLON_EXIT.md`
   * X4.1e). 0 is not drawn: projected under the size gate, or past the end
   * of the distance fade. On the pool because it is per body and per frame,
   * and the body is the thing that already exists.
   */
  fade: number;
}

export class WorldCulling {
  /**
   * Every Babylon map mesh that carries a block, filed once (none on a
   * shipped build). Read only to dedupe the filing and to count it
   * (`stats.blocked`): no list is built from it since the mesh walk went
   * (`BABYLON_EXIT.md` X5.4f).
   */
  private filed = new Set<AbstractMesh>();
  private cells: Cell[] = [];
  /** Each cell by its block key — what `reachBoxOf` answers our renderer's surfaces off. */
  private cellByKey = new Map<string, Cell>();

  /**
   * Every pooled body, in the order `setPools` was handed them — the index
   * `drawsBody` answers by. Kept apart from the cells, which `setMap` clears
   * on a path the ROSTER does not run (an install).
   */
  private pools: Pool[] = [];

  /**
   * The reach and the size gate as this file decides them THIS frame, for
   * our renderer's GPU cull (`render/ClusterCull.ts`): rewritten in place by
   * every `update`. The reach is the distance a cell switches ON at, from
   * the eye to the cell's box; the size gate is `offer`'s own.
   */
  readonly reachGate: ReachGate = {
    reach: Number.POSITIVE_INFINITY,
    sizeGate: false,
    perRad: 0,
    px2: 0,
  };

  /** Set when what a cell offers no longer matches the state above. */
  private listDirty = true;

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
    /**
     * `scene.meshes.length` as of the last `rebuildList` — refreshed there
     * and nowhere else, so it lags a mesh added or removed between rebuilds
     * (a cell crossing its threshold, or `setMap`). Nothing is filed from it
     * since the candidate list went (`BABYLON_EXIT.md` X5.4f).
     */
    scene: 0,
    blocked: 0,
    /** Pooled BODIES (`setPools`), none of them a mesh since X4.1d. */
    pooled: 0,
    cells: 0,
    cellsOn: 0,
    poolsOn: 0,
  };

  /**
   * No hook any more: `Scene.getActiveMeshCandidates` was replaced here, and
   * the scene's mesh-added and mesh-removed observables dirtied the list,
   * until the scene stopped rendering (`BABYLON_EXIT.md` X5.4f).
   */
  constructor(private scene: Scene) {}

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
    this.filed = new Set();
    this.cellByKey = new Map();
    this.cells = [];
    this.listDirty = true;
    this.evalX = Number.POSITIVE_INFINITY;
    this.evalZ = Number.POSITIVE_INFINITY;
    this.stats.blocked = 0;
    this.stats.cells = 0;
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
          offered: false,
        };
        this.cellByKey.set(key, cell);
        this.cells.push(cell);
      }
    }
    // Babylon's block-keyed meshes, each into its cell: none on a shipped
    // build (the fires are no mesh since X4.4d and the glazing since X4.6e:
    // `offersBlock`, by the same key `PaneBlocks` writes a group under — a
    // curtain wall and the shaft behind it go out of the frame together, or
    // the tower is a sheet of glass hanging in the fog with nothing behind it).
    for (const mesh of map.visuals) {
      const key = blockOf(mesh.metadata);
      if (key === null || this.filed.has(mesh)) continue;
      const record = recordByMesh.get(mesh);
      if (!record) return `"${mesh.name}" carries a block but is no map visual`;
      this.filed.add(mesh);
      this.stats.blocked++;
    }
    this.stats.cells = this.cells.length;
    return null;
  }

  /**
   * Files the round's pooled bodies. Called from `Game.installBodyPools` and
   * from nowhere else. Every pooled body is handed over, whether or not this
   * round enables it; none is a mesh (`BABYLON_EXIT.md` X4.1d), so nothing is
   * filed into the list — each is measured once a frame in `offer`, and its
   * verdict read back by its index here (`drawsBody`).
   */
  setPools(bodies: readonly PooledBody[]): void {
    this.pools = [];
    for (const body of bodies) this.pools.push({ body, on: body.enabled, fade: 1 });
    this.stats.pooled = this.pools.length;
  }

  /**
   * Whether pooled body `i` (`setPools`' order) is drawn THIS frame: switched
   * on as the list was offered, and with some of it left to draw
   * (`bodyFade` above 0) — not projected under the size gate, nor past the
   * end of its distance fade — measured once off its own measure and the
   * same answer for the whole body, its visor with it. What Babylon's mesh
   * walk decided for every mesh of a rig until our renderer drew bodies
   * (`BABYLON_EXIT.md` X4.1d); read by `Game.drawBodies` after `update`, the
   * same frame.
   */
  drawsBody(i: number): boolean {
    const pool = this.pools[i];
    return pool !== undefined && pool.on && pool.fade > 0;
  }

  /**
   * How much of pooled body `i` is drawn this frame, 0 to 1
   * (`BABYLON_EXIT.md` X4.1e): 1 is whole, between is the share of its
   * pixels a screen-door dither keeps (`render/BodyDraw.ts`), 0 is not
   * drawn (`drawsBody`). One number for the whole body, its visor with it,
   * read by `Game.drawBodies` after `update`, the same frame. See `offer`.
   */
  bodyFade(i: number): number {
    const pool = this.pools[i];
    return pool !== undefined && pool.on ? pool.fade : 0;
  }

  /**
   * The map's body draw distance (`bodyDrawDistanceOf`), which the roster's
   * switch and the ragdoll pool's refusal are handed too (`setViewDistance`):
   * here it is where a body's DISTANCE fade ends (`offer`), never a gate of
   * this file's own. Infinite — no distance fade — until a map pushes one.
   */
  setBodyDrawDistance(metres: number): void {
    this.bodyDraw = metres;
  }

  /** See `setBodyDrawDistance`. */
  private bodyDraw = Number.POSITIVE_INFINITY;

  /**
   * Whether the size gate KEEPS a world sphere this frame — a HULL's segment
   * (`BABYLON_EXIT.md` X4.2b), since X4.4b a pool's cel part and a bullet
   * mark (`Game.drawPieces`, `Game.drawMarks`), and since X4.6b a ring's batch
   * and a flag's surface (`Game.drawZones`), which our renderer draws and
   * which are no candidate: the test `offer` asks of a loose mesh (`tooSmall`, from the
   * eye and at the scale it was last handed, and true while the gate is off
   * — a gate of 0 px, no camera), asked of the sphere its caller
   * composed. A hull is gated PER SEGMENT, as its meshes were gated while
   * they were loose: dropping a hull whole would draw at range every part this
   * gate drops there now. The sphere is the caller's, composed this frame, so
   * the drop cannot latch on stale bounds (`docs/rendering.md`); read by
   * `Game.drawHulls` after `update`, the same frame.
   */
  keepsSphere(x: number, y: number, z: number, radius: number): boolean {
    const g = this.reachGate;
    if (!g.sizeGate) return true;
    return !tooSmall(x, y, z, radius, this.gateEye, g.perRad, g.px2);
  }

  /** The eye `offer` gated from last, copied: what `keepsSphere` and `keepsDetail` measure from. */
  private readonly gateEye = { x: 0, y: 0, z: 0 };

  /**
   * Whether a HULL draws its FULL set this frame — its DETAIL segments
   * with the rest (`BABYLON_EXIT.md` X4.2c, A3's detail tier) — asked of the
   * hull's whole MEASURE as its caller composed it this frame
   * (`vehicleRig.measureHull`): `tooSmall`, the size gate's own arithmetic,
   * from the same eye and at the same pixels a radian, against
   * `CONFIG.graphics.culling.hullDetail` instead of `minPixels`. True — the
   * full set — while the tier is off: a threshold of 0, no camera. It is a SWAP and nothing
   * else: no hull is dropped by it, and the per-segment gate
   * (`keepsSphere`) still answers for every segment drawn, the detail ones
   * of a hull drawn in full among them (decided 2026-10-31). It has NO
   * hysteresis band, as `keepsSphere` has none, and that is accepted (the
   * project owner, 2026-10-31): a hull held at its swap distance toggles its
   * reduced set on every crossing (`hullDetail`'s doc). Read by
   * `Game.drawHulls` after `update`, the same frame.
   */
  keepsDetail(x: number, y: number, z: number, radius: number): boolean {
    if (this.detailPerRad === 0) return true;
    return !tooSmall(x, y, z, radius, this.gateEye, this.detailPerRad, this.detailPx2);
  }

  /**
   * How much of a HULL is drawn this frame, 0 to 1 (`BABYLON_EXIT.md`
   * X4.2d): 1 is whole, between is the share of its pixels the screen door
   * keeps (`render/HullDraw.ts`), 0 is not drawn — asked once a hull, of
   * its whole MEASURE as its caller composed it this frame
   * (`vehicleRig.measureHull`), from the eye `offer` gated from. A ramp
   * over the last `CONFIG.graphics.culling.hullFade.distance` of the map's
   * `hullDrawDistance` (`setHullDrawDistance`), off the distance from that
   * eye to the measure's centre, ending AT the distance: a hull has no
   * switch at range for the fade to beat, as a body's roster switch is
   * (`offer`'s distance edge). The DISTANCE only — there is no whole-hull
   * size edge (decided 2026-10-31: the per-segment gate, `keepsSphere`,
   * still answers for every segment drawn, faded or not). 1 on a map
   * that states no distance (`Infinity`, every shipped map) — the literal 1,
   * so a reader multiplying by it changes nothing. Read by `Game.fadeHulls`
   * straight after `update`, the same frame, for the drawing and the rotor
   * wash both.
   */
  hullFade(x: number, y: number, z: number): number {
    const far = this.hullDraw;
    if (!Number.isFinite(far)) return 1;
    const e = this.gateEye;
    const dx = x - e.x;
    const dy = y - e.y;
    const dz = z - e.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return Math.min(1, Math.max(0, (far - d) / (far * CONFIG.graphics.culling.hullFade.distance)));
  }

  /**
   * The map's HULL draw distance (`hullDrawDistanceOf`: capped at the fog,
   * floored at a hull's gun reach, and infinite on a map that states none),
   * where a hull's fade ends (`hullFade`). Infinite — no fade and no cut,
   * every hull drawn whole at any range — until a map pushes one, and pushed
   * by every install (`Game.installMap`), so a map stating none puts it back.
   */
  setHullDrawDistance(metres: number): void {
    this.hullDraw = metres;
  }

  /** See `setHullDrawDistance`. */
  private hullDraw = Number.POSITIVE_INFINITY;

  /** The detail tier's pixels a radian this frame (`offer`); 0 while the tier is off. */
  private detailPerRad = 0;
  /** `CONFIG.graphics.culling.hullDetail`, squared, as `tooSmall` compares. */
  private detailPx2 = 0;

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
   * Whether the block-keyed surfaces of `block`'s cell are offered THIS
   * frame — what a mesh filed in that cell was a candidate by, as the list
   * was last built (`rebuildList`): its cell within reach, with its
   * hysteresis; false for a block no cell
   * was grown for, and from `setMap` until the first list after it. Read by
   * `Game.flamePull` for each world fire (`BABYLON_EXIT.md` X4.4d) and
   * `Game.glassPull` for each pane group (X4.6e), after
   * `update`, the same frame — so a fire or a pane is offered exactly when
   * its mesh was. No size gate here: a fire is a light source, which the gate
   * never dropped (`glows`), and a pane's is asked of its record's sphere
   * (`keepsSphere`).
   */
  offersBlock(block: string): boolean {
    return this.cellByKey.get(block)?.offered ?? false;
  }

  /**
   * Decides this frame's answers — the cells, the pools' verdicts and the
   * gate (a candidate list until `BABYLON_EXIT.md` X5.4f). Called from
   * `Game.tick` in EVERY state,
   * beside `CelMaterialFactory.updateCamera` and for the same reason: every
   * state renders and only some of them simulate, so a menu or a deploy screen
   * with a live view behind it would otherwise be looking at whatever
   * neighbourhood the last live frame stood in.
   *
   * Cheap when nothing has moved — the cells are re-evaluated only once the
   * camera has travelled `CONFIG.graphics.culling.step`, the pools are one
   * property read each, and the cells' offers are snapshotted again
   * (`rebuildList`) only when a cell crosses its threshold or a map is set.
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
    // distance this could hang off. One property read per BODY — 49 on the
    // densest roster — and nothing structural: no body is in the list.
    let poolsOn = 0;
    for (const pool of this.pools) if ((pool.on = pool.body.enabled)) poolsOn++;
    this.stats.poolsOn = poolsOn;
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
   * What each cell OFFERS (`offersBlock`), snapshotted when an answer
   * changes. **Until `BABYLON_EXIT.md` X5.4f this built the candidate list**,
   * which was `scene.meshes` MINUS things rather than a list of its own — a
   * full walk of the scene, on purpose; the rest of this comment is that
   * list's argument, kept as the history of the order it chose.
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
   * changes: a cell crossing its threshold or a mesh entering or leaving the
   * scene (a pooled body switched in or out was one until X4.1d; no body is
   * in the list now).
   */
  private rebuildList(): void {
    // What a filed surface of each cell is offered by, from now until the
    // next build — read back by the block (`offersBlock`). The candidate list
    // this built beside it (`eligible`: `scene.meshes` minus the cells out of
    // reach, in scene order, and the size gate's per-mesh answers) was
    // retired with the mesh walk (`BABYLON_EXIT.md` X5.4f).
    for (const cell of this.cells) cell.offered = cell.on;
    this.listDirty = false;
    let cellsOn = 0;
    for (const cell of this.cells) if (cell.on) cellsOn++;
    this.stats.scene = this.scene.meshes.length;
    this.stats.cellsOn = cellsOn;
  }

  /**
   * This frame's gate and the pools' verdicts — and until `BABYLON_EXIT.md`
   * X5.4f this frame's candidate LIST, the eligible meshes minus the ones
   * switched off right now, which the two paragraphs below argue and which
   * went with the mesh walk.
   *
   * **It drops exactly what `_evaluateActiveMeshes` would drop, and it drops it
   * before the expensive part rather than after.** That walk rejects a mesh on
   * `!isReady() || !isEnabled() || scaling.hasAZeroComponent` with a bare
   * `continue`, and it reaches the activation test only if `isVisible &&
   * visibility > 0` — where `alwaysSelectAsActiveMesh` bypasses the FRUSTUM
   * test and not this one. So neither of the two asked here can be a mesh
   * Babylon would have drawn, whatever else is true of it. It is the claim
   * the hidden class rested on for the collider proxies, once per map, until
   * no collider was a mesh (`BABYLON_EXIT.md` X5.3e), made per frame — which
   * is what reaches a POOL.
   *
   * **The pools are why it is worth a pass.** Every effect pool in the game is
   * built once and idled with `isVisible = false` — 96 tracers, 54 embers, 48
   * sparks, 48 shards, 40 impacts, 30 blast chunks, 40 grenade parts, 48 mine
   * parts, 49 blob shadows, when it was measured — and `rebuildList` filed all
   * of them as `loose`, so the frame was being offered a few hundred meshes it
   * could not draw. (Every one of those pools is our renderer's and no mesh
   * since `BABYLON_EXIT.md` X4.6e; the pass stands for any mesh switched off.)
   * Measured on Sarab at a real viewport and a real roster, this halves the
   * list (1,525 → 729) and is worth **+8.9%** of frame rate; the mesh walk is
   * a third of the tick there, so that is most of what the halving predicts.
   * It was measured at the WRONG viewport first and very nearly thrown away;
   * `VERIFYING.md` carries that trap.
   *
   * `isEnabled()` walks ancestors and `isVisible` does not. No body is a
   * candidate (`BABYLON_EXIT.md` X4.1d): a pooled body is gated before the
   * walk, by its own switch and measure (`drawsBody`).
   *
   * The order is a subsequence of `eligible`, which is scene order, so
   * `rebuildList`'s argument about `_activeMeshes` ordering survives intact.
   */
  private offer(eye: Vector3): void {
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
    const gate = minPx > 0 && cam !== null;
    const engine = this.scene.getEngine();
    const pixelsPerRad = cam !== null
      ? (engine.getRenderHeight() * engine.getHardwareScalingLevel()) /
        (cam.fov || 1)
      : 0;
    const perRad = gate ? pixelsPerRad : 0;
    // The hulls' detail tier (`keepsDetail`) on the same pixels a radian, and
    // with its own switch.
    const detailPx = CONFIG.graphics.culling.hullDetail;
    this.detailPerRad = detailPx > 0 ? pixelsPerRad : 0;
    this.detailPx2 = detailPx * detailPx;
    const px2 = minPx * minPx;
    const reachGate = this.reachGate;
    reachGate.reach = this.on;
    reachGate.sizeGate = gate;
    reachGate.perRad = perRad;
    reachGate.px2 = px2;
    // The eye a hull's segment is gated from later this frame (`keepsSphere`):
    // this one, as a loose mesh's was.
    const gateEye = this.gateEye;
    gateEye.x = eye.x;
    gateEye.y = eye.y;
    gateEye.z = eye.z;
    // **A BODY is measured ONCE, off its own measure, and drops whole.** One
    // test per body rather than per mesh — a per-mesh verdict took the head
    // off a soldier at 300 m while leaving his torso — so every segment of a
    // body, its visor among them, gets the SAME answer (`drawsBody`, which
    // our renderer's drawing reads: `BABYLON_EXIT.md` X4.1d). It is the same
    // thing `bodyDrawDistanceOf` does, in SCREEN space rather than in metres,
    // so it needs no per-map number and loosens by itself when a sight goes up.
    //
    // **And it LEAVES by a fade at both edges, never a pop** (X4.1e,
    // `CONFIG.graphics.culling.bodyFade`): the same measure answers how much
    // of the body is drawn, the lesser of two ramps, which the drawing spends
    // as a screen-door dither (`bodyFade`). A fade built for one gate misses
    // the other — on a phone the size gate is the NEARER one.
    const fadeBand = CONFIG.graphics.culling.bodyFade;
    const bodyDraw = this.bodyDraw;
    const distanceFade = Number.isFinite(bodyDraw);
    // Whole above `size` times the gate: compared squared, as `tooSmall` is.
    const wholePx2 = px2 * fadeBand.size * fadeBand.size;
    const sizeBand = minPx * (fadeBand.size - 1);
    for (let i = 0; i < this.pools.length; i++) {
      const pool = this.pools[i];
      if (!pool.on) {
        pool.fade = 0;
        continue;
      }
      if (!gate && !distanceFade) {
        pool.fade = 1;
        continue;
      }
      // **The measure is composed FRESH, and without that the drop LATCHES**
      // (`docs/rendering.md`): a body dropped on stale bounds was never
      // handed the matrix that would correct them. It is composed off the
      // body's joints on every call, one root compose per body per frame, so
      // it is this frame's by construction.
      pool.body.measure(bodySphere);
      const dx = bodySphere.x - eye.x;
      const dy = bodySphere.y - eye.y;
      const dz = bodySphere.z - eye.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      let fade = 1;
      // THE DISTANCE EDGE. The switch is the roster's (`NetRoster.update`,
      // past `bodyDrawDistance` off the body's POSITION, its feet), and this
      // fade must reach ZERO before that switch can turn the body off — a
      // fade above 0 only ever on a body whose switch is on — or the body
      // pops at the end of its own fade. The measure's centre is not the
      // feet, but the feet are inside the measure's sphere, so the two
      // distances from one eye differ by at most its RADIUS (the triangle
      // inequality): ending the fade one radius short of the distance makes
      // it zero wherever the switch could already be off, from an eye at any
      // height, with no second reading of the roster's point. (A corpse's
      // root stays where it fell, as its position does; it only sinks.)
      //
      // **It is ONE eye only up to a frame.** The roster reads the camera
      // inside `updateWorld`, before the frame's camera update moves it
      // (`NetSession.update`'s `cameraPos`), and this reads it after
      // (`Game.followEye`) — so at the frame the switch goes off, the fade
      // can be above zero by one frame of the eye's travel over the band: at
      // 60 fps ~0.004 sprinting on Sarab (6.9 m/s over its 30 m), ~0.014 on
      // the 78 m maps, ~0.02 in the helicopter at its 32 m/s and twice that
      // at 30 fps (measured, `BABYLON_EXIT.md` X4.1e: 0.0013 at most). The
      // screen door keeps no pixel at all below 1/32 (`bodyProgram.ts`), so
      // only the helicopter's worst can leave one pixel in a 4x4 tile.
      if (distanceFade) {
        const end = bodyDraw - bodySphere.radius;
        const d = Math.sqrt(d2);
        fade = Math.min(1, Math.max(0, (end - d) / (bodyDraw * fadeBand.distance)));
      }
      // THE SIZE EDGE: the same test as ever for the drop (`tooSmall`, so a
      // body is dropped exactly where it was), and between the gate and
      // `size` times it a ramp in projected PIXELS.
      if (gate && fade > 0) {
        if (tooSmall(bodySphere.x, bodySphere.y, bodySphere.z, bodySphere.radius, eye, perRad, px2)) {
          fade = 0;
        } else {
          const w = 2 * bodySphere.radius * perRad;
          if (w * w < wholePx2 * d2) {
            fade = Math.min(fade, Math.max(0, (w / Math.sqrt(d2) - minPx) / sizeBand));
          }
        }
      }
      pool.fade = fade;
    }
    // The candidate walk that followed — the eligible meshes switched on and
    // through the size gate, handed to Babylon — was retired with the mesh
    // walk (`BABYLON_EXIT.md` X5.4f): no Babylon mesh is drawn.
  }
}

/** `offer`'s scratch for a body's measure. */
const bodySphere: BodyMeasure = { x: 0, y: 0, z: 0, radius: 0 };

/**
 * Whether a world bounding sphere projects smaller than the gate, in CSS
 * pixels of the frame.
 *
 * The one place a projected size is measured, because `offer` asks the
 * question of three different things — a loose mesh, a body's measure and a
 * filed surface's record — `keepsSphere` a fourth, a hull's segment (and a pool's piece or mark), and
 * `keepsDetail` a fifth, a hull's whole measure against the detail tier's
 * own threshold; two copies of this arithmetic is two answers that can drift
 * apart.
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
  eye: { readonly x: number; readonly y: number; readonly z: number },
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
