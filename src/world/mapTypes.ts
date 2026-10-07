/**
 * mapTypes.ts — The shapes a built map is described in: what a layout's flags,
 * spawns, hardstandings, water and grass are once `MapBuilder` has read them,
 * the collider box and the pane every query and the collision bake carry, the
 * editor's per-item index, and `GameMap` itself.
 * Owns: types and nothing else — no value, no Babylon object, no code path.
 * Every import here is `import type`, so a module that reads a `GameMap`
 * pulls nothing in at runtime by naming one.
 * Invariants: `MapBuilder` re-exports every name here, so the readers that
 * import them from it are unaffected and either path names the same type.
 * `GameMap.colliderAlbedo` stays parallel to `colliderBoxes`, and an index
 * into `colliderBoxes` or `panes` is an IDENTITY on both sides of the wire —
 * both are rules about how `MapBuilder` fills these, stated where the field is.
 * Must NOT grow a function: what builds or moves one of these lives in
 * `MapBuilder.ts` (`collider()`, `recordBox`, `repositionItem`) or in
 * `merge.ts` (`PaneBlocks`), never beside the shape.
 */
import type { Mesh, Vector3 } from "@babylonjs/core";
import type { WaterAmbienceId } from "../core/Sfx";
import type { VehicleKind } from "../entities/vehicleKinds";
import type { BoxSpec } from "./BuildingKit";
import type { CollisionField } from "./CollisionField";
import type { CoverMap } from "./CoverMap";
import type { NavGrid } from "./NavGrid";
import type { ObstacleField } from "./ObstacleField";
import type { RayWorld } from "./RayWorld";
import type { RoadFootprint } from "./roads";
import type { TerrainField } from "./TerrainField";

/** A capturable flag. */
export interface ControlPointDef {
  /** Single letter shown on the HUD strip: A..E. */
  id: string;
  name: string;
  pos: Vector3;
  radius: number;
  /**
   * Metres the flag's pole is moved up (or, negative, down) from where
   * `CaptureZoneSystem` stands it — on the floor, or on the roof its one
   * downward cast found. A correction for when that cast finds a collider a
   * little off the drawn roof, and nothing else: the ring, the capture test
   * and the flow field all ignore it. Absent is 0.
   */
  poleLift?: number;
}

/** A place a combatant can deploy to. */
export interface SpawnPointDef {
  /** Owning team, or null for a spawn tied to a control point. */
  team: 0 | 1 | null;
  /** Set when this spawn belongs to a control point. */
  controlPoint?: string;
  pos: Vector3;
  yaw: number;
}

/**
 * Where one team's vehicle stands at the start of a round, and where a fresh
 * one is put after the last was destroyed.
 *
 * **A hardstanding, not a spawn point.** It is deliberately not a
 * `SpawnPointDef` with a flag on it: a soldier's spawn is one of a set the
 * deploy screen offers and the conquest rules hand out, and this is a single
 * fixed place that belongs to a team for the whole round whatever they hold.
 * Sharing the type would have put a `vehicle?: true` on every infantry spawn on
 * every map and given `ConquestSystem.spawnFor` something to skip.
 *
 * The MapBuilder does one thing with these and it is not building anything:
 * they join `keepClear`, so blocking scatter cannot be sown on top of a
 * hardstanding. What stands here is `VehicleSystem`'s, from `GameMap`.
 */
export interface VehicleSpawnDef {
  team: 0 | 1;
  /** Absolute, like a control point's — the ground here is where the hull rests. */
  pos: Vector3;
  /** Which way the hull faces when it arrives. */
  yaw: number;
  /**
   * WHAT stands here, or nothing for a tank.
   *
   * Optional so that the maps written before there was a second kind say
   * nothing at all and are unaffected — the default is stated once, in
   * `entities/vehicleKinds.ts`, and the two readers (`MapBuilder.keepClear` and
   * `VehicleSystem.build`) both go through it rather than repeating it.
   *
   * **A team may have as many hardstandings as the layout states, of any mix
   * of kinds**: the respawn clock is per hardstanding, so what this list is is
   * exactly the vehicles that side can ever have on the field at once.
   */
  kind?: VehicleKind;
}

/**
 * A rectangular body of shallow surface water. Purely visual: no collider,
 * no nav cost — combatants wade across the ground beneath. Consumed by the
 * WaterSystem, not by the MapBuilder (water is never merged or frozen).
 */
export interface WaterRect {
  x: number;
  z: number;
  /** Extents along X and Z. */
  width: number;
  depth: number;
  /** Surface height; defaults to CONFIG.water.surfaceY. */
  y?: number;
  /**
   * What it SOUNDS like, and the third thing in the game to carry a sound by
   * ID beside `Build.sound` and `SCATTER_AMBIENCE`.
   *
   * **Defaults to `"shore"`, which is the one place in this interface a
   * default is not "unaffected".** Every other optional field on a layout
   * means a map that says nothing gets what it always had; here that would
   * mean silence, and silent water is a bug rather than a neutral choice. A
   * map states `"stream"` for water that RUNS — Hollowmere's creek, a mill
   * race — because that is the half of the distinction geometry cannot make:
   * the creek is 6.6 m wide and Sarab's birkat is 54, but the wadi's pools are
   * 75 m of standing water and a mountain beck would be narrower than either.
   * Flow is not a shape.
   *
   * Where it is HEARD is not stated here at all and could not usefully be:
   * see `MapBuilder.waterEmitters`, which marches the finished floor to find
   * where this rect actually meets the land.
   */
  sound?: WaterAmbienceId;
}

/**
 * A rectangular grass field. Purely visual: no collider, no nav cost —
 * combatants walk straight through (the shader bends the blades around
 * them). Consumed by the GrassSystem, not by the MapBuilder: the rects are
 * baked into one mask (`world/grassMask.ts`), which refuses a collider's
 * footprint, a structure's drawn parts standing in it (`GameMap.partBoxes`)
 * and a carriageway and frays the fields' joint edge, and the
 * blades are placed around the eye. A rect states how LUSH, never how many.
 */
export interface GrassRect {
  x: number;
  z: number;
  /** Extents along X and Z. */
  width: number;
  depth: number;
  /** Base height — set for fields on a terrace or embankment. */
  y?: number;
  /**
   * How thick it grows, 0..1: a share of the quality rung's full density
   * (`CONFIG.grass.tiers`). Absent is 1 — a field says how lush it is, never
   * how many blades that costs, because the field is drawn around the eye and
   * its AREA is not a price. Overlapping rects add, capped at 1.
   */
  density?: number;
  /**
   * How tall, as a multiplier on `CONFIG.grass.heightMin..heightMax`. Absent
   * is 1; a mown green is ~0.45, reeds and a neglected paddock ~1.3.
   */
  height?: number;
  /**
   * How many metres of ragged edge the field thins out over where nothing
   * carries it on (`CONFIG.grass.edge` when absent). 0 is a clean cut: a
   * tended lawn against its path. It is the edge of all the fields together,
   * so two rects laid side by side meet without a seam whatever this says.
   */
  edge?: number;
  /**
   * True for a field that STOPS at the water's edge rather than growing on
   * into it as reeds (`CONFIG.grass.reeds`): a meadow that happens to cross a
   * pool, as opposed to a rect laid over one for its reed fringe. Absent is
   * false, which is every reed bed in the tree. Where a dry rect and a wet
   * one overlap under water, only the wet one's density grows.
   */
  dry?: boolean;
}

/**
 * A collider's world-space geometry, kept alongside the mesh so the nav grid
 * can compute surface heights analytically instead of firing 25,600 rays.
 */
export interface WorldBox {
  w: number;
  h: number;
  d: number;
  cx: number;
  cy: number;
  cz: number;
  rotX: number;
  rotY: number;
  /**
   * Stops a body, not a round — see `BoxSpec.porous`, which is where a builder
   * declares it. Carried here because the box outlives the spec: `CoverMap`
   * bakes off these, and the server rebuilds its whole world from them.
   */
  porous?: true;
  /**
   * A breakable pane's collider — `porous` until `GlassSystem` breaks it, and
   * nothing at all afterwards. See `BoxSpec.glass`.
   *
   * Carried here for the readers that must skip a pane rather than merely
   * treat it as porous: `CoverMap` and the AO bake. The bake carries it to the
   * server, which needs to break the same box this one names.
   */
  glass?: true;
}

/**
 * A pane of glass in world space: the rect a round has to cross to break it,
 * and the two places breaking it has to reach.
 *
 * **Only a `breakable` pane is one of these.** Most of a city's glazing is
 * hung on something solid and never goes, and none of it is here — a sheet
 * that cannot be taken away has nothing to say to the sweep, the wire or the
 * authority, and is a mesh and nothing else (see `PaneSpec.breakable`).
 *
 * **The index into `GameMap.panes` IS the pane's identity**, on the client and
 * on the authority alike, exactly as an index into `colliderBoxes` is. Both
 * sides build the list in the same order — placements in layout order, and each
 * placement's breakable panes in the order its builder declared them — which is
 * what lets one number on the wire name one sheet of glass.
 */
export interface WorldPane {
  /** Centre, extents and turn: the sheet as an oriented box. */
  w: number;
  h: number;
  d: number;
  cx: number;
  cy: number;
  cz: number;
  rotY: number;
  /**
   * Where this pane's 24 positions live in `PaneGroup.mesh`'s vertex buffer.
   * Collapsing them to the pane's own centre is what takes it off the screen.
   */
  vertexStart: number;
  vertexCount: number;
  /** Which `paneGroups` entry holds those vertices. */
  group: number;
  /**
   * Position in `colliderBoxes` of the box that stops a body until this pane
   * goes. Every pane in the list has one — that is what `PaneSpec.breakable`
   * means — and it is a number rather than a mesh because it has to survive
   * the collision bake and name the same box on the authority.
   */
  box: number;
}

/**
 * One placement's glazing: the merged mesh, and the breakable panes with
 * vertices in it — usually none, because most glass never goes anywhere.
 *
 * Merged per placement and kept out of `BlockMerge`, so a building's glass is
 * one draw call and the panes in it that CAN break are still individually
 * reachable. That is the trade the whole feature rests on — see
 * `MapBuilder.paneGroup`.
 */
export interface PaneGroup {
  mesh: Mesh;
  /** Indices into `GameMap.panes`. */
  panes: number[];
  /**
   * Which map block this glazing was merged under — the key `PaneBlocks` filed
   * it against, opaque to everyone but useful for one thing: telling two groups
   * that are the SAME BUILDING apart from two that merely stand near each
   * other.
   *
   * There is more than one group per block whenever a building glazes in more
   * than one material, which `backed` glazing made ordinary rather than
   * hypothetical (see `Build.pane`). `ReflectionSystem` bakes one cube per
   * block and not per group, because a cube is a picture of the street rather
   * than of the sheet — this is what lets it do that without measuring
   * distances and guessing.
   *
   * **Written by `PaneBlocks.finish` and empty before it**, exactly as
   * `WorldPane.group` is -1 until the same pass fills it: the per-placement
   * groups `MapBuilder.paneGroup` returns have no block yet and never reach
   * `GameMap`.
   */
  block: string;
}

/**
 * Which layout item a mesh came from. Present in `metadata.editorRef` only on
 * editor builds — the shipped path merges across placements, so a mesh there
 * belongs to a whole map block rather than to any one item.
 */
export interface EditorRef {
  list: "placements" | "scatter";
  index: number;
}

/** One layout item's geometry, so the editor can move or rebuild it alone. */
export interface EditorItem {
  visuals: Mesh[];
  colliders: Mesh[];
  /** Positions in `GameMap.colliderBoxes` of this item's boxes. */
  boxes: number[];
  /**
   * The builder's own collider specs, in the structure's local space, in the
   * same order as `colliders`/`boxes`. Kept so a move or rotate can be
   * recomputed exactly — `repositionItem` needs the pre-transform boxes, and
   * the world-space ones have already had the placement baked into them.
   */
  localBoxes: BoxSpec[];
}

/**
 * Per-item geometry index. Built only when `build()` is given `editor: true`;
 * that mode also skips the BlockMerge pass, because merging across placements
 * is exactly what makes a single placement unrecoverable afterwards.
 */
export interface EditorIndex {
  placements: EditorItem[];
  scatter: EditorItem[];
}

/** Opt-in build behaviour. Absent in the shipped path. */
export interface BuildOptions {
  /**
   * Keep geometry per layout item and tag it, at the cost of the block merge:
   * ~1740 draws against ~150. Fine for authoring, never for play.
   */
  editor?: boolean;
  /**
   * How full a tree's crown is, 0..1 — the player's `Settings.foliage`
   * resolved through `CONFIG.graphics.foliage`, handed to every scatter
   * builder as its fifth argument. Absent is 1, the full crown. It moves no
   * prop and no collider: what it thins is drawn from streams the shared
   * scatter stream never sees (`buildAshTree`, `buildMaple`,
   * `buildJungleTree`).
   */
  foliage?: number;
}

/** The built world: geometry is in the scene, this is the queryable part. */
export interface GameMap {
  /**
   * The PLAY square's side, centred on the origin. Everything authored, every
   * flag, every spawn, the nav grid and the obstacle field are inside it, and
   * it is what a body leaving is measured against.
   */
  size: number;
  /**
   * How far the floor carries on past that square, in metres — the map's
   * `Borderland.margin`, or 0 on a map closed by the rim.
   *
   * Two readers and they want it for opposite reasons. `Game` asks whether
   * there is a borderland at all, because that is what decides whether the
   * leash runs. `server/validate.ts` asks how wide it is, because `size / 2`
   * used to be the edge of everywhere a player could legitimately be and on
   * this kind of map it is the edge of where they may legitimately STAY.
   */
  margin: number;
  /**
   * The side of the square the structures were merged over — the map's
   * `MapLayout.blockSize`, or `BLOCK_SIZE`.
   *
   * Carried for the reason `size` is: it is the map's, and the readers that
   * meet a built map rather than a layout would otherwise take the default and
   * cut a different lattice from the one the merge actually used. Nothing that
   * reads `metadata.block` needs it — a block key is a name, and both readers
   * take it as one — so this is for whoever has to ask the question the merge
   * asked, in the units it asked it in.
   */
  blockSize: number;
  /**
   * The side of the square the FLOOR was tessellated over — the map's
   * `MapLayout.terrainBlock`, or `BLOCK_SIZE`, and independent of `blockSize`.
   *
   * The editor's terrain brush is the reader: a stroke names the patches it
   * moved by the same arithmetic `terrainPatches` cut them with, and a brush
   * that assumed 48 on a map that states otherwise re-tessellates the wrong
   * meshes and silently leaves the ones under the cursor stale.
   */
  terrainBlock: number;
  controlPoints: ControlPointDef[];
  spawns: SpawnPointDef[];
  /**
   * The vehicle hardstandings, one per team on a map that has them and empty on
   * every map that does not — which is two of the four shipped.
   *
   * Carried on the built map rather than read off the layout by whoever wants
   * it, for the reason everything else here is: `VehicleSystem` is handed a
   * `GameMap` by `installMap` and must never reach for a named map's own
   * modules. See `VehicleSpawnDef`.
   */
  vehicleSpawns: VehicleSpawnDef[];
  /** Invisible collider proxies — the only pickable, collidable geometry. */
  colliders: Mesh[];
  /** The same colliders as plain boxes, for the nav grid. */
  colliderBoxes: WorldBox[];
  /**
   * An ALBEDO per `colliderBoxes` entry, as `r, g, b` triples in the same
   * order: the average colour of whatever the box stands in for, which is what
   * the irradiance volume's trace bounces light off (`systems/GiVolume.ts`).
   *
   * **Client-only and absent on the authority**, which builds its world from
   * the collision bake and has no materials to average — so this is kept off
   * `WorldBox` and out of the bake, and neither `npm run collision` nor
   * `npm run parity` has heard of it. It must stay PARALLEL to
   * `colliderBoxes`: `MapBuilder.recordBox` is the one place either grows.
   */
  colliderAlbedo?: Float32Array;
  /**
   * Every placed structure's VISUAL parts that stand where grass grows, as
   * boxes in world space — the plank floor of a barn, a plinth, a doorstep, a
   * manger. What stands on them is refused by the grass mask exactly as the
   * inside of a collider is, because most of a building that meets the ground
   * is drawn and not solid: the barn's floor never had a collider, and every
   * blade under it grew straight up through the boards.
   *
   * **Client-only, like `colliderAlbedo`, and it decides nothing.** It is not
   * a collider, not in the nav grid, not on the wire and not in the bake; the
   * one thing that reads it is `GrassSystem`. Roads are not in it — their
   * footprint is `roads`, which feathers where a box would cut.
   */
  partBoxes?: WorldBox[];
  /**
   * The `strut` boxes — ray geometry with no body behind it — grouped by the
   * collider mesh each group was merged into.
   *
   * Not in `colliderBoxes` on purpose: everything derived from geometry reads
   * that list, and none of it can represent a 0.1 m rail (see
   * `BoxSpec.rayOnly`). The grouping is carried rather than flattened because
   * the server has to rebuild and merge the same meshes from the bake, and it
   * cannot recover from a flat list which boxes were one fence.
   */
  rayGroups: WorldBox[][];
  /**
   * The `colliderBoxes` indices that were merged into one collider mesh each,
   * one entry per merged mesh — a scatter region's props, grouped by locality.
   *
   * Unlike `rayGroups` these boxes ARE in `colliderBoxes` and everything
   * derived from geometry still sees them one at a time; the grouping is about
   * nothing but what a ray meets. Boxes named by no group are their own mesh,
   * which is every collider a structure builder makes.
   *
   * Carried rather than recomputed for the same reason `rayGroups` is: the
   * server rebuilds these meshes from the bake, and the grouping is a decision
   * the client made rather than a property of the boxes.
   * See `MapBuilder.clusterColliders`.
   */
  boxGroups: number[][];
  /**
   * Every pane of glass on the map that can BREAK, in build order — and the
   * index into this list is the pane's identity everywhere, including on the
   * wire.
   *
   * Not every sheet of glass: a building's glazing is in `paneGroups` whether
   * or not anything can take it away, and only the panes with somewhere to get
   * into behind them are here. Coldharbour draws ~6,100 and lists twenty-four.
   *
   * Empty on a map whose builders declare none, which is every map but
   * Coldharbour today. See `WorldPane`, and `systems/GlassSystem.ts` for the
   * one thing that writes through it.
   */
  panes: WorldPane[];
  /**
   * The merged glazing meshes — all of the map's glass, not only the panes
   * above, which hold their vertices in these.
   */
  paneGroups: PaneGroup[];
  /**
   * The floor's collider blocks, a SUBSET of `colliders`.
   *
   * They are called out because they are the one collider with no `WorldBox`
   * behind it (a heightfield is not a box — see `MapBuilder.buildValley`), so
   * anything that wants the whole solid world as geometry has to take
   * `colliderBoxes` for the boxes and these for the floor.
   * `RagdollSystem` is the caller: it needs the real mesh to rest a body on.
   * Picking them out of `colliders` by name would work and is exactly the sort
   * of string-sniffing that breaks silently when a name changes.
   */
  terrainColliders: Mesh[];
  /** Drawn geometry, merged per colour. */
  visuals: Mesh[];
  /** Walkable-surface graph with one precomputed flow field per objective. */
  nav: NavGrid;
  /** Sub-cell collision the nav grid is too coarse to express. */
  obstacles: ObstacleField;
  /**
   * The segment query every ray in the game asks — the same collider set as
   * `colliderBoxes` and `rayGroups`, plus the floor, indexed for a LINE rather
   * than for a point.
   *
   * Here beside `nav`, `cover` and `obstacles` rather than built by whoever
   * wants one, for the reason all three are: it is derived from the finished
   * collider set, it is built once per map, and the authority gets the same
   * object off `buildServerWorld` without a server-only variant. See
   * `world/RayWorld.ts`, and `ENGINE_UPGRADE.md` wall 2 for what it replaced.
   */
  rays: RayWorld;
  /**
   * The same collider set indexed for a SWEEP — which meshes a moving body's
   * collision sphere could touch — so `moveWithCollisions` walks a street
   * rather than the map.
   *
   * `rays`' counterpart and here for the identical reason, one question later:
   * that one answers a LINE analytically and took every pick off the scene,
   * and this one narrows the last whole-scene walk left behind, which no
   * analytic query can replace because it MOVES a body rather than asking
   * about one. See `world/CollisionField.ts` for what it measured and for the
   * superset rule a caller owes it.
   */
  collidables: CollisionField;
  /** Baked directional cover over the nav graph, for the AI. */
  cover: CoverMap;
  /** Shallow-water bodies from the layout; empty when the map is dry. */
  water: WaterRect[];
  /** Grass fields from the layout; empty when the map is bald. */
  grass: GrassRect[];
  /**
   * The carriageways, derived from the layout's `road` placements.
   *
   * A road is still visual-only — no collider, no `WorldBox`, invisible to
   * navigation, to cover and to every ray — and this list is not a step back
   * from that. It answers one question, "is this ground paved", for the two
   * things that GROW: `MapBuilder.findSpot` holds rooted props off it and
   * `GrassSystem` holds every tuft off it. Carried on the map rather than
   * re-derived by each because the authority builds one too, off the same
   * layout, so a rule that reads it cannot mean different ground on the two
   * sides. See `world/roads.ts`, and `world/roadPaths.ts` for a road that
   * bends.
   */
  roads: RoadFootprint;
  /**
   * The floor's height, for everything that used to assume zero. Flat when the
   * layout declares no terrain, which is the whole of the old behaviour.
   */
  terrain: TerrainField;
  /** Per-item geometry. Editor builds only — undefined in play. */
  editor?: EditorIndex;
  dispose(): void;
}
