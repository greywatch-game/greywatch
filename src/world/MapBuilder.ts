/**
 * MapBuilder.ts — Turns layout data into a GameMap: merges visual meshes per
 * material (frozen, unpickable) and then again per map block (BlockMerge —
 * neighbouring structures share a draw call), emits collider proxies,
 * registers fixture lights, builds NavGrid + CoverMap + ObstacleField.
 * Invariants: collider() is the ONLY place colliders are created — invisible,
 * pickable, checkCollisions, metadata.solid === true, never merged — and it
 * records the WorldBox for navigation. It sets no `metadata.surface`, and that
 * absence is meaningful: it is what makes every box read as "hard" to the
 * impact effects. The terrain floor's clone is the one collider that says
 * otherwise ("ground"). Geometry added by any other path is
 * invisible to rays AND bots. Colliders must line up with the visuals they
 * stand in for (sparks land on colliders). Visuals must never be pickable or
 * solid. Builders arrive at identity transform; merging then transforming is
 * what makes MergeMeshes safe. Must NOT special-case Hollowmere — a second map
 * is one new layout file, and build() takes the layout and environment as
 * arguments precisely so nothing here can reach for a named one.
 * Scatter runs off the layout's seeded RNG, never Math.random: blocking props
 * emit colliders, and colliders decide navigation.
 * The floor comes from a TerrainField, not a flat box, and every authored `y`
 * in the layout is an offset ABOVE it — so a building dropped into a basin
 * needs no bookkeeping. The floor mesh is the one place a visual and a
 * collider share vertices (an invisible clone per block); a heightfield has no
 * box to stand in for it, and splitting it per block is what keeps ray picks
 * rejecting it as cheaply as the old flat box did.
 * `build(..., { editor: true })` keeps geometry per layout item, tags it with
 * metadata.editorRef and indexes it — at the cost of the BlockMerge pass and
 * roughly 10x the draw calls. Authoring only; never measure frame cost there.
 */
import {
  Color3,
  Material,
  Mesh,
  MeshBuilder,
  Scene,
  Vector3,
  VertexBuffer,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import {
  addOutline,
  MAX_PALETTE,
  type CelMaterialFactory,
} from "../shaders/CelShader";
import { marksSway, type SwayLayer, swayLayerOf } from "./sway";
import { bakeVertexShading } from "./vertexShading";
import { begin as beginProfile, record, since } from "./buildProfile";
import type { LightingSystem } from "../systems/LightingSystem";
import { BUILDERS, type BoxSpec, type Structure } from "./BuildingKit";
import type { EnvironmentSpec } from "./environment";
import { floorMaterial } from "./floorSurfaces";
import {
  isScatterRect,
  type MapLayout,
  type RidgeSpec,
  type ScatterSpec,
} from "./layout";
import { type LocalXZ, rotateToLocalXZ } from "./boxGeometry";
import {
  type BoxIndex,
  boxesNear,
  emptyBoxIndex,
  insertBox,
} from "./boxIndex";
import { ridgeSegments } from "./Ridge";
import { TerrainField, terrainPatches } from "./TerrainField";
import { NavGrid } from "./NavGrid";
import { CoverMap } from "./CoverMap";
import { ObstacleField } from "./ObstacleField";
import { mulberry32 } from "./rng";
import {
  buildAshTree,
  buildBarrel,
  buildBinPair,
  buildBoulder,
  buildBramble,
  buildButtressLog,
  buildCarvedStele,
  buildDeadTree,
  buildFernClump,
  buildFireDrum,
  buildFungus,
  buildGravestone,
  buildJungleTree,
  buildLitter,
  buildLog,
  buildPalletStack,
  buildPine,
  buildRubble,
  buildSkip,
  buildTrafficCone,
} from "./Props";

/** A capturable flag. */
export interface ControlPointDef {
  /** Single letter shown on the HUD strip: A..E. */
  id: string;
  name: string;
  pos: Vector3;
  radius: number;
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
}

/**
 * A rectangular grass field. Purely visual: no collider, no nav cost —
 * combatants walk straight through (the shader bends the blades around
 * them). Consumed by the GrassSystem, not by the MapBuilder (grass is never
 * merged or frozen here; tufts that would grow inside a collider are
 * rejected by the GrassSystem at build time).
 */
export interface GrassRect {
  x: number;
  z: number;
  /** Extents along X and Z. */
  width: number;
  depth: number;
  /** Base height — set for fields on a terrace or embankment. */
  y?: number;
  /** Tufts per m²; defaults to CONFIG.grass.density. */
  density?: number;
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
   * groups `paneGroup` returns have no block yet and never reach `GameMap`.
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
   * behind it (a heightfield is not a box — see the terrain section of
   * `build`), so anything that wants the whole solid world as geometry has to
   * take `colliderBoxes` for the boxes and these for the floor.
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
  /** Baked directional cover over the nav graph, for the AI. */
  cover: CoverMap;
  /** Shallow-water bodies from the layout; empty when the map is dry. */
  water: WaterRect[];
  /** Grass fields from the layout; empty when the map is bald. */
  grass: GrassRect[];
  /**
   * The floor's height, for everything that used to assume zero. Flat when the
   * layout declares no terrain, which is the whole of the old behaviour.
   */
  terrain: TerrainField;
  /** Per-item geometry. Editor builds only — undefined in play. */
  editor?: EditorIndex;
  dispose(): void;
}

/**
 * One scatter prop's factory.
 *
 * **Typed rather than inferred, and the fourth argument is why.** Only
 * `buildJungleTree` reads `sub`, and a `Record` of the builders as written
 * would be a UNION of their signatures — which a four-argument call cannot
 * satisfy, because most members declare three. Widening the whole table
 * instead is free: a builder that ignores the stream is assignable to a type
 * that offers it, and a builder that wants one now has a place to say so.
 */
type ScatterBuilder = (
  scene: Scene,
  mats: CelMaterialFactory,
  rng: () => number,
  sub: () => number,
) => Mesh;

/** Scatter props, keyed by the name the layout data uses. */
const SCATTER_BUILDERS: Record<ScatterSpec["prop"], ScatterBuilder> = {
  deadTree: buildDeadTree,
  pine: buildPine,
  ashTree: buildAshTree,
  jungleTree: buildJungleTree,
  fernClump: buildFernClump,
  buttressLog: buildButtressLog,
  carvedStele: buildCarvedStele,
  gravestone: buildGravestone,
  log: buildLog,
  fungus: buildFungus,
  rubble: buildRubble,
  fireDrum: buildFireDrum,
  boulder: buildBoulder,
  bramble: buildBramble,
  barrel: buildBarrel,
  skip: buildSkip,
  binPair: buildBinPair,
  palletStack: buildPalletStack,
  trafficCone: buildTrafficCone,
  litter: buildLitter,
};

/**
 * The side of the square a scatter region's colliders are merged over, metres.
 *
 * Sized like a fence rather than like a map: a few props across, so a cluster's
 * bounding box is small enough that most rays miss it outright and the ones
 * that hit have a handful of boxes to test. See `MapBuilder.clusterColliders`.
 */
const CLUSTER = 12;

/** Lights carried by scatter props. Kept sparse — every one costs a shader slot. */
const SCATTER_LIGHTS: Partial<
  Record<ScatterSpec["prop"], { color: string; range: number; intensity: number; y: number; flicker: number }>
> = {
  fungus: { color: "#5bffb0", range: 9, intensity: 1.0, y: 0.6, flicker: 0.12 },
  fireDrum: { color: "#ff8a2a", range: 19, intensity: 2.0, y: 1.1, flicker: 0.4 },
};

/** One scatter prop's measured body. See `PROP_BODIES`. */
interface PropBody {
  /** Collider footprint and height at scale 1 — the part that stops a bullet. */
  w: number;
  d: number;
  h: number;
  /**
   * Roughly how high the prop reaches, for `findSpot`'s burial check — a
   * different question from `h`, which stops at what is solid. A fire drum's
   * flame is 0.85 m of light that must not be planted inside a wall and 0 m of
   * anything a bullet can find.
   *
   * Approximate, and deliberately frozen at the values this table shipped
   * with: it feeds placement, so changing one rerolls the seeded dressing
   * field across the whole map for no gain.
   */
  visualTop: number;
}

/**
 * Every scatter prop's body at scale 1, measured off the builders in
 * `Props.ts`. The collider box is `w`/`d`/`h`, oriented with the prop.
 *
 * **This is deliberately not `ScatterSpec.clearance`, which is what it used to
 * be.** Clearance is a *placement* rule — how much room a prop wants around it
 * so a stand of trees doesn't grow into itself or into a wall — and it is
 * generous on purpose. Sizing the collider from it gave every blocking prop a
 * square box inflated by its own spacing margin, and square is the worst shape
 * for it: a headstone 0.24 m thick stopped rounds through 1.2 m of air, and a
 * dead tree ate a 1.74 m corridor at chest height around a 0.7 m trunk. Since
 * the same boxes are what `CombatSystem` caps a shot on, what `BattleSystem`
 * tests line of sight against and what `CameraSystem` pulls in on, one wrong
 * number was showing up as three unrelated-looking complaints.
 *
 * Keep these honest against `Props.ts`. Too small only costs a round clipping
 * through a silhouette; too large costs shots that visibly should have landed.
 */
const PROP_BODIES: Record<ScatterSpec["prop"], PropBody> = {
  // Trunk only, at roughly its width around chest height (it tapers 0.85 ->
  // 0.32 over 5.2 m). The branches are 4 cm twigs — nothing should stop on one.
  deadTree: { w: 0.7, d: 0.7, h: 5.2, visualTop: 5.4 },
  // Trunk only, same as the dead tree — the crown is 3.3 m of needles and
  // stopping rounds on it would give the map its one piece of cover you can see
  // daylight through. The builder keeps the lowest tier above the 1.7 m hit
  // sphere so nothing shootable hides in there. `visualTop` clears the tip.
  pine: { w: 0.62, d: 0.62, h: 6.4, visualTop: 7.0 },
  // Trunk only again, at its width around chest height rather than at the
  // flare it stands on: it tapers 0.76 -> 0.30 over 8.6 m, so 0.68 is what a
  // round arriving at 1.7 m actually meets. The crown is 5.8 m of leaf
  // starting at 3.9 and is deliberately outside this — the pine's rule, and
  // this tree has three times the leaf to get it wrong with. Full trunk
  // height, so a hedgerow standard bakes as hard cover (CoverMap's 1.7 m) the
  // way a wall does. `visualTop` clears the cap plate.
  ashTree: { w: 0.68, d: 0.68, h: 8.6, visualTop: 9.9 },
  // Trunk plus its buttress core: the fins reach 0.97 m from the axis at their
  // widest, so a 1.0 m box is the flare you can see rather than a margin around
  // it. The canopy is 4 m of frond starting nine metres up and is not in this —
  // there is nothing to shoot up there, and a box that held it would stop
  // rounds through open air across the whole stand. Full trunk height, so a
  // jungle tree bakes as hard cover (CoverMap's 1.7 m) the way a wall does.
  jungleTree: { w: 1.0, d: 1.0, h: 11.2, visualTop: 11.6 },
  // Never blocking, so w/d/h are never read — filled honestly anyway, because
  // this is a Record and a lie here would be believed the day someone sets
  // `blocking` on a fern. `visualTop` IS read: findSpot's burial check runs for
  // every prop, blocking or not. The reasoning for keeping ferns walk-through
  // is in buildFernClump.
  fernClump: { w: 1.7, d: 1.7, h: 1.0, visualTop: 1.2 },
  // TRUNK ONLY, and lying along its own local X like the log — 5.2 m one way
  // and 1.0 m the other is meaningless axis-aligned. The buttress fins (1.4 m)
  // and the root plate (1.9 m) are thin plates and are deliberately outside
  // this: a box that held them would stop rounds through a metre of daylight
  // down the whole prop. At 1.0 m it sits under CoverMap's 1.7 m hard-cover
  // line, so it bakes as low cover — which is what a fallen log is.
  buttressLog: { w: 5.2, d: 1.0, h: 1.0, visualTop: 1.9 },
  // Wide and thin and oriented, the gravestone's lesson at temple scale. The
  // only understory prop that clears the 1.7 m hit sphere, so the only one
  // CoverMap bakes as hard cover.
  carvedStele: { w: 1.0, d: 0.45, h: 2.3, visualTop: 2.6 },
  // Slab and plinth: wide, and *thin*. The one prop whose orientation matters
  // most — squared off, it blocked five times its own thickness.
  gravestone: { w: 1.15, d: 0.42, h: 1.6, visualTop: 1.7 },
  // Lies along its own local X, so the collider's rotation is load-bearing:
  // 3 m one way and 0.7 m the other is meaningless axis-aligned.
  log: { w: 3.0, d: 0.7, h: 0.75, visualTop: 0.9 },
  fungus: { w: 0.8, d: 0.8, h: 0.9, visualTop: 1.1 },
  // Heap plus the chunks piled on it. The rebar is a 6 cm rod sticking out to
  // 1.8 m and is not in this — you do not lose a round to a piece of wire.
  rubble: { w: 1.9, d: 1.7, h: 1.05, visualTop: 1.5 },
  // The drum. NOT the flame above it, which is emissive and 0.85 m tall.
  fireDrum: { w: 0.95, d: 0.95, h: 1.25, visualTop: 2.1 },
  // The one prop that was already too *small*, and stays generous: measured,
  // a boulder is 2.4 m across the waist and 2.2 m tall, because
  // `CreatePolyhedron`'s `size: 0.8` is not a radius — it yields a 2.26 m
  // shape before the builder's own 1.3-1.7x stretch. The old clearance-derived
  // 2.0 m box already let rounds through visible rock. Height stays near it so
  // a large boulder still bakes as hard cover (CoverMap's 1.7 m).
  boulder: { w: 2.1, d: 1.9, h: 1.45, visualTop: 1.4 },
  bramble: { w: 0.8, d: 0.8, h: 1.2, visualTop: 1.6 },
  barrel: { w: 0.88, d: 0.88, h: 1.25, visualTop: 1.3 },
  // The skip is the one prop in this table that needs no compromise: it IS a
  // rectangular prism, so the box is the shape rather than an approximation of
  // it. Oriented, per the gravestone lesson — 1.9 one way and 1.2 the other is
  // meaningless squared off. The flared rim (2.04 x 1.34) is deliberately
  // OUTSIDE this: 8 cm of proud lip is not worth stopping a round through.
  skip: { w: 1.9, d: 1.2, h: 1.1, visualTop: 1.25 },
  // The pair together, along its own local X — the mate stands at +0.56.
  binPair: { w: 1.14, d: 0.6, h: 1.04, visualTop: 1.1 },
  palletStack: { w: 1.2, d: 1.0, h: 0.99, visualTop: 1.05 },
  // Never blocking, so w/d/h are never read — filled honestly anyway, for the
  // reason the fern's entry states: this is a Record and a lie here would be
  // believed the day someone sets `blocking` on a cone. `visualTop` IS read,
  // because findSpot's burial check runs for every prop.
  trafficCone: { w: 0.42, d: 0.42, h: 0.65, visualTop: 0.7 },
  // Likewise never blocking. The scraps scatter about 0.55 m from the root in
  // each direction, so the footprint is wider than the root box suggests.
  litter: { w: 1.3, d: 1.3, h: 0.04, visualTop: 0.09 },
};

/**
 * Builds a map from the `MapLayout` and `EnvironmentSpec` it is handed — the
 * pair `world/maps.ts` keeps together. No map is named here.
 *
 * ## The visual / collider split
 *
 * Every ray test in the game runs against `metadata.solid === true` meshes:
 * `CameraSystem`'s occlusion pull-in (every frame), `CombatSystem`'s hitscan
 * (every shot), and the bots' line-of-sight checks. `Player.moveWithCollisions`
 * separately walks every mesh with `checkCollisions`. At village scale, letting
 * visual geometry carry those jobs means thousands of triangle-picked meshes in
 * the hot path.
 *
 * So the two roles are split, and nothing does both:
 *
 * - **Visual** meshes are merged per colour, unpickable, non-colliding, and
 *   frozen. They are only ever drawn.
 * - **Collider** proxies are invisible boxes, pickable, colliding, and tagged
 *   `solid`. They are only ever tested.
 *
 * Colliders must line up with the surfaces they stand in for, or bullet sparks
 * land off the visible geometry.
 *
 * Open-frame geometry is described TWICE rather than approximated once, which
 * is how it keeps that rule: a collider tagged `porous` is the solid world to a
 * BODY and not there at all to a ROUND, and the `rayOnly` colliders beside it
 * (`Build.strut`, merged by `struts()`) are the reverse — the timber a round
 * stops on, with no body behind it and no `WorldBox` at all. A fence is a 1.4 m
 * porous slab for walking into and nine merged posts and rails for shooting at.
 * See `BoxSpec.porous` / `BoxSpec.rayOnly`, and `solid.ts` for the two
 * predicates that split them.
 */
export class MapBuilder {
  constructor(
    private scene: Scene,
    private mats: CelMaterialFactory,
    private lighting: LightingSystem,
  ) {}

  /** World-space collider boxes, accumulated by `collider()` during a build. */
  private boxes: WorldBox[] = [];

  /**
   * The `strut` boxes, grouped by the placement whose collider mesh they were
   * merged into. Deliberately NOT in `boxes` — nothing derived from geometry
   * (nav, cover, obstacles, AO, scatter) may see them. See `struts()`.
   */
  private rayGroups: WorldBox[][] = [];
  private boxGroups: number[][] = [];
  /** Scatter boxes recorded but not yet given geometry — see `build`. */
  private pendingCluster: number[] = [];
  /**
   * Ground a BLOCKING scatter prop may not stand on, as discs — every control
   * point and every spawn on the layout. Rebuilt per `build`.
   *
   * **This is a rule rather than an authoring habit, and the difference is
   * what density costs.** A flag whose centre is inside a collider reports no
   * surface at all (`surfaceAt` returns -1): it cannot be captured, and
   * `buildField` sinks its flow field's goal into a cell nothing can reach, so
   * every bot on the map stops going there. That is the Flag-C-on-the-well
   * error, and the layout used to answer it by placing each blocking region
   * far enough off to one side that its own radius plus the prop's half-length
   * still cleared the nearest flag. That works while a region is a disc of
   * five headstones beside a district. It does not survive a jungle: Greyfen's
   * forest is rectangles that cover the valley, the flags are inside them on
   * purpose, and the odds of a trunk landing on any given point are simply the
   * density times the footprint — about one flag in seven at the density this
   * map now runs.
   *
   * A spawn is the same failure one step quieter: nothing reports it, and a
   * player deploys standing inside a tree.
   *
   * Non-blocking props are exempt and stay exempt. A fern over a capture point
   * is dressing, which is exactly what the layout's own note says.
   */
  private keepClear: { x: number; z: number; r: number }[] = [];

  /**
   * Every pane, in build order, and the merged meshes their vertices live in.
   * Fed by `paneGroup()` exactly as `boxes` is fed by `collider()`, which is
   * what keeps the index that names a pane the same on both sides of the wire.
   */
  private panes: WorldPane[] = [];
  private paneGroups: PaneGroup[] = [];

  /**
   * Scratch for `insideCollider`'s box-frame transform. Reused because scatter
   * placement runs it a great many times per build.
   */
  private readonly localScratch: LocalXZ = { lx: 0, lz: 0 };

  /**
   * `boxes`, bucketed, so scatter placement can ask which colliders are near a
   * candidate spot instead of walking all of them. Replaced at the top of every
   * `build` and fed by `collider()`, so it is never out of step with `boxes`.
   *
   * Its `pad` is the largest clearance any scatter region will query with, and
   * that is computed from the layout rather than guessed — a query wider than
   * the pad would miss boxes silently, which is the one way this can be wrong.
   */
  private boxIndex: BoxIndex = emptyBoxIndex(CONFIG.map.size, 0);

  /**
   * The layout item currently being built, on editor builds only. `collider()`
   * files its box index here so the editor can find one item's boxes again
   * without re-deriving them. Null in the shipped path and between items.
   */
  private item: EditorItem | null = null;

  /**
   * The layout's own seed, kept so `scatterRegion` can mint a SECOND stream
   * per placed prop. Set at the top of every `build`.
   *
   * The shared stream is why a scatter field is reproducible and also why it
   * is brittle: it is consumed in authored order, so one extra draw anywhere
   * moves every prop after it. That is a real cost — on Greyfen it is 354
   * trees, 149 fern clumps and a re-walk of all five flags — and it is what a
   * builder pays the moment it wants to randomise something new. A stream
   * keyed to (region, index) buys that back: it is just as reproducible, it is
   * independent of what any other prop drew, and adding one leaves the shared
   * stream untouched down to the draw. Today the jungle tree's liana veil is
   * the only thing that takes it.
   */
  private propSeed = 0;

  /**
   * This map's albedo palette: the colours the block merge collapsed, in the
   * order the shader indexes them. Reset at the top of every `build` and handed
   * to `CelMaterialFactory.setPalette` at the bottom of it.
   */
  private paletteColors: Color3[] = [];
  /** The same, as a lookup, so a colour asked for twice gets one slot. */
  private paletteSlots = new Map<string, number>();

  /**
   * The 1-based palette slot for a hex, or **0 meaning "keep your own
   * material"**.
   *
   * The zero is the whole overflow story and it is a graceful one by
   * construction rather than by a check downstream: 0 is what an unwritten
   * `uv2` gives, the shader already reads it as "use `baseColor`", and a caller
   * that gets it simply merges the way everything did before the palette
   * existed. So a map past `MAX_PALETTE` is a map with a few more meshes in it,
   * not a map that fails to build or draws in the wrong colours — see the
   * constant, where the headroom is argued.
   */
  private paletteIndex(hex: string): number {
    const known = this.paletteSlots.get(hex);
    if (known !== undefined) return known;
    if (this.paletteSlots.size >= MAX_PALETTE) return 0;
    const slot = this.paletteColors.push(Color3.FromHexString(hex));
    this.paletteSlots.set(hex, slot);
    return slot;
  }

  /**
   * Builds a map. The layout and environment are arguments, not imports: a
   * second map is a second layout file and nothing here changes.
   */
  build(layout: MapLayout, env: EnvironmentSpec, opts?: BuildOptions): GameMap {
    // Where the time behind the loading card goes. DEV-only, a no-op in a
    // production build, and an ATTRIBUTION rather than a partition: `build`
    // times itself whole and names the parts worth naming under it, so the
    // remainder is what is left over. See `buildProfile.ts`, and `FINDINGS.md`
    // 19 for what it found — 87% of a 1500 m build is the placement loop below.
    beginProfile();
    const buildStart = performance.now();
    // The map's own extent, not the global — a village and a downtown are not
    // the same size. Everything downstream already took it as an argument; it
    // reaches them from here and is carried on `GameMap.size` for the readers
    // (the minimap, the deploy map, the editor) that meet a built map instead.
    const size = layout.size ?? CONFIG.map.size;
    const visuals: Mesh[] = [];
    const colliders: Mesh[] = [];
    // A view onto the floor's own blocks within `colliders` — see GameMap.
    const terrainColliders: Mesh[] = [];
    this.boxes = [];
    this.rayGroups = [];
    this.boxGroups = [];
    this.pendingCluster = [];
    this.paletteColors = [];
    this.paletteSlots.clear();
    // A body's standing room plus a trunk's own half-width, which is all this
    // has to guarantee: the SHAPE of a flag's surroundings is the layout's to
    // decide (Bravo is a bare bank and Echo is a thicket), and what cannot be
    // left to authoring is whether the point itself is solid.
    this.keepClear = [
      ...layout.controlPoints.map((cp) => ({ x: cp.pos.x, z: cp.pos.z, r: 3.5 })),
      ...layout.spawns.map((sp) => ({ x: sp.pos.x, z: sp.pos.z, r: 3 })),
      // A hardstanding is cleared to the HULL's own half-length plus a body's
      // standing room, because the thing that arrives here is seven metres long
      // and does not walk around a bollard. A blocking prop sown on one is worse
      // than a prop on a flag: a flag inside a collider merely cannot be
      // captured, while a tank that materialises inside one is a hull the
      // ground probe puts on top of a skip.
      ...(layout.vehicles ?? []).map((v) => ({
        x: v.pos.x,
        z: v.pos.z,
        r: CONFIG.vehicles.tank.hull.length / 2 + 1.5,
      })),
    ];
    this.panes = [];
    this.paneGroups = [];
    // Sized to the widest burial test this layout will run. `findSpot` asks
    // about `(spec.clearance ?? 0.8) * scale`, and `scale` tops out at the
    // upper end of the spec's own range — so the layout knows the answer before
    // a single box exists, which is the only moment the index can be told.
    this.boxIndex = emptyBoxIndex(size, maxScatterClearance(layout));
    // One stream for the whole build, so scatter regions stay reproducible in
    // authored order. Seeding per region would be stabler under editing but
    // would let two regions with the same seed sample identically.
    const seed = layout.seed ?? 0x484c;
    const rng = mulberry32(seed);
    this.propSeed = seed;
    const forEditor = opts?.editor === true;
    const index: EditorIndex | undefined = forEditor
      ? { placements: [], scatter: [] }
      : undefined;
    this.item = null;

    // How far the ground carries on past the play square, and therefore where
    // the boundary actually is. Zero on every map closed by the rim, which is
    // every map but Harrowmead — see `MapLayout.borderland`.
    const margin = layout.borderland?.margin ?? 0;
    const terrain = new TerrainField(
      layout.terrain,
      margin,
      layout.borderland?.roll,
    );
    record("valley", () =>
      this.buildValley(
        size,
        margin,
        env,
        terrain,
        visuals,
        colliders,
        terrainColliders,
        layout.ridge,
      ),
    );

    // --- authored structures ---
    // Roads are merged into one draw call per material so overlapping junctions
    // (the central cross, etc.) don't z-fight between separate meshes.
    const roadParts: Mesh[] = [];
    const blocks = new BlockMerge();
    const paneBlocks = new PaneBlocks();
    const placementsStart = performance.now();
    for (const [i, p] of layout.placements.entries()) {
      const item = index ? newItem(index.placements) : null;
      this.item = item;
      // An authored y is an offset above the local floor, not an absolute
      // height, so a placement keeps its meaning when the ground under it moves.
      const origin = new Vector3(
        p.x,
        (p.y ?? 0) + terrain.heightAt(p.x, p.z),
        p.z,
      );
      const rotY = p.rotY ?? 0;
      const isRoad = p.kind === "road";
      // Where it lands is settled before it is built, because a builder may
      // need to read the ground under its footprint — one sample at the centre
      // is not enough for 130 m of road. The result is still origin-local.
      const builder = BUILDERS[p.kind];
      const s: Structure = builder(this.scene, this.mats, p.params ?? {}, {
        terrain,
        x: p.x,
        y: origin.y,
        z: p.z,
        rotY,
      });

      for (const merged of mergeByMaterial(s.meshes, p.kind)) {
        merged.rotation.y = rotY;
        merged.position.addInPlace(origin);
        if (item) {
          // The block merge is what makes a placement unrecoverable, so the
          // editor takes the draw-call hit and keeps its meshes separate.
          tag(merged, { list: "placements", index: i });
          item.visuals.push(merged);
          if (isRoad) {
            merged.metadata.noShadowCaster = true;
            // Roads are NOT outlined here. In play they are first merged into
            // one mesh, so the outline traces the road network's outer edge
            // once. Kept separate, each road's back-face shell is drawn over
            // whatever it overlaps — and roads overlap by design at every
            // junction, which paints a black patch across the crossing. The
            // selection highlight shows a road's extent instead.
          } else {
            addOutline(merged, 0.05);
          }
          visuals.push(merged);
        } else if (isRoad) {
          roadParts.push(merged);
        } else {
          blocks.add(p.x, p.z, merged);
        }
      }
      // Body boxes first, then the struts, so `item`'s three parallel arrays
      // agree on the order whichever kinds a structure declares.
      for (const box of s.colliders) {
        if (box.rayOnly) continue;
        const mesh = this.collider(`${p.kind}-col`, box, origin, rotY);
        if (item) {
          tag(mesh, { list: "placements", index: i });
          item.localBoxes.push(box);
        }
        colliders.push(mesh);
      }
      const strutSpecs = s.colliders.filter((box) => box.rayOnly);
      if (strutSpecs.length > 0) {
        const meshes = this.struts(
          `${p.kind}-timber`,
          strutSpecs,
          origin,
          rotY,
        );
        if (item) {
          // Unmerged in the editor, so these line up one for one with the
          // specs; the shipped build merges and has no item to keep.
          meshes.forEach((mesh, j) => {
            tag(mesh, { list: "placements", index: i });
            item.localBoxes.push(strutSpecs[j]);
          });
        }
        colliders.push(...meshes);
      }
      // Glazing LAST of the three, and for the same reason the body boxes come
      // first: `item`'s parallel arrays are written in this order on both
      // sides, so a breakable pane's collider lands at a known place in them
      // whichever kinds a structure declares.
      if (s.panes.length > 0) {
        const glazing = this.paneGroup(`${p.kind}-glass`, s, origin, rotY, i);
        for (const group of glazing.visuals) {
          paneBlocks.add(p.x, p.z, group, item, i);
        }
        colliders.push(...glazing.colliders);
      }
      for (const l of s.lights) {
        const at = rotateY(l.x, l.y, l.z, rotY).addInPlace(origin);
        this.lighting.add(at, l.color, l.range, l.intensity, l.flicker);
      }
    }
    this.item = null;
    since("placements", placementsStart);

    for (const merged of record("roadMerge", () =>
      mergeByMaterial(roadParts, "roads"),
    )) {
      // Flat ground sheets receive shadows, never cast them.
      merged.metadata = { ...(merged.metadata ?? {}), noShadowCaster: true };
      // A road that carries lane markings arrives with `noOutline` already on
      // it and keeps it through the merge key, because an ink shell over a flat
      // sheet stamps its own depth 5 cm above that sheet and the paint laid on
      // it is then behind a surface nobody can see. See `buildRoad`.
      if (!merged.metadata?.noOutline) addOutline(merged, 0.05);
      visuals.push(merged);
    }

    // --- scattered dressing ---
    const scatterStart = performance.now();
    for (const [i, spec] of layout.scatter.entries()) {
      const item = index ? newItem(index.scatter) : null;
      this.item = item;
      this.scatterRegion(spec, terrain, rng, blocks, colliders, item, i);
      if (item) for (const m of item.visuals) visuals.push(m);
    }
    this.item = null;
    since("scatter", scatterStart);
    // Every region's blocking props at once, and deliberately not region by
    // region: the regions OVERLAP (that is how the layout varies density), so
    // clustering each on its own would hand the same 12 m square one mesh per
    // region standing over it. Measured on Greyfen's forest, per-region
    // grouping left 1,412 props in ~500 meshes; all together it is ~180.
    colliders.push(
      ...record("scatterClusters", () =>
        this.clusterColliders("scatter", this.pendingCluster),
      ),
    );
    this.pendingCluster = [];

    // One more merge across neighbouring structures — see BlockMerge. This is
    // the ONE merge that paletteises, which is also what exempts the editor for
    // free: an editor build files its meshes on the item instead and never
    // reaches this pass at all (see the `item` branch in the placement loop).
    for (const merged of record("blockMerge", () =>
      blocks.finish({
        slot: (hex) => this.paletteIndex(hex),
        material: this.mats.getWorldCel(),
      }),
    )) {
      if (!merged.metadata?.noOutline) addOutline(merged, 0.05);
      visuals.push(merged);
    }
    // Published before anything draws and after the merge that discovers it —
    // see `CelMaterialFactory.setPalette`. Unconditional, so a rebuild that
    // paletteises nothing still clears the last map's colours out.
    this.mats.setPalette(this.paletteColors);
    // And the same pass over the glazing, which keeps its ranges — see
    // `PaneBlocks`. Its meshes join `visuals` for the AO bake and to be
    // disposed with the map, and they are the one entry in that list that is
    // NEITHER outlined NOR a shadow caster.
    //
    // **A pane is transparent, and both of those are things only an opaque
    // surface can afford.** A clear sheet laying a hard black shadow across
    // the pavement is the more obvious of the two, and it is what
    // `noShadowCaster` answers.
    //
    // The ink is the sharper one and it is mechanical rather than a matter of
    // taste. Babylon draws an outline as an inverted hull BEFORE the mesh
    // itself, and it keeps that hull out of a transparent mesh's own area with
    // a STENCIL pass — which this engine has no buffer for (`Game` builds it
    // with no stencil, deliberately). So the shell is not a ring around a pane
    // here, it is a dark plate drawn behind the whole of it, and every window
    // in the city goes back to being the opaque slate it was, correctly lit and
    // reflecting the sky onto something you cannot see through. Glass is
    // therefore the one visual in the world with no ink, and it loses nothing:
    // what draws a window's frame is the mullion, the collar and the reveal,
    // all of which are geometry with outlines of their own.
    for (const merged of record("paneMerge", () =>
      paneBlocks.finish(this.panes, this.paneGroups),
    )) {
      merged.metadata = {
        ...(merged.metadata ?? {}),
        noOutline: true,
        noShadowCaster: true,
      };
      visuals.push(merged);
    }

    // The vertex-colour bake — occlusion, the world mark and the wind's sway
    // weight — and the position in this method is the whole of it.
    //
    // AFTER every merge, because `VertexData.merge` throws on a group where
    // some meshes carry `colors` and some do not, and `mergeByMaterial`
    // disposes its sources — which is what turns Babylon's attribute-aligning
    // path off. Baking last cannot hit that.
    //
    // BEFORE `markVisual`, which freezes the world matrices the bake needs to
    // recompute, and before the nav graph, which wants `this.boxes` for its own
    // reasons and is not affected either way.
    //
    // `this.boxes` is complete here — every `collider()` has run — and it is
    // the whole input besides the terrain. See `world/vertexShading.ts` for
    // what each channel of the colour buffer carries and why.
    const bakeStart = performance.now();
    const bakedVerts = record("aoBake", () =>
      bakeVertexShading(visuals, this.boxes, terrain, size),
    );
    if (import.meta.env.DEV) {
      console.info(
        `[bake] ${bakedVerts} vertices in ${(performance.now() - bakeStart).toFixed(1)} ms`,
      );
    }

    // The ink for everything that sways, and it is built HERE — after the bake
    // and before the freeze — for two reasons that are both about the twin
    // SHARING its source's geometry rather than copying it.
    //
    // After the bake, because a shared `Geometry` means the colour buffer the
    // bake just wrote is already on the twin: it reads the same weights, sways
    // by the same amount, and cannot drift from the surface it wraps. Baking
    // afterwards would walk the same vertices a second time to write them the
    // same values.
    //
    // Before `markVisual`, because the twin needs the same freeze, the same
    // `isPickable = false` and the same disposal as every other visual — and
    // pushing it into `visuals` is what gets it all three. It is a VISUAL in
    // every sense the rest of this file means: no collider, no box, no pick.
    record("inkTwins", () => {
      for (const m of [...visuals]) {
        const twin = inkTwin(m, this.mats);
        if (twin) visuals.push(twin);
      }
    });

    record("markVisual", () => {
      for (const m of visuals) this.markVisual(m);
    });

    // Navigation is derived from the finished collider set, then a flow field
    // is precomputed per objective: five flags plus both home spawns. The map
    // is static, so this is the only time any of it is computed.
    const nav = record(
      "navGrid",
      () => new NavGrid(size, this.boxes, terrain, layout.surfaces),
    );
    for (const cp of layout.controlPoints) {
      record(`flowField:${cp.id}`, () =>
        nav.buildField(cp.id, cp.pos, cp.radius * 0.6),
      );
    }
    for (const team of [0, 1] as const) {
      const home = layout.spawns.find((s) => s.team === team);
      if (home) {
        record(`flowField:home${team}`, () =>
          nav.buildField(`home${team}`, home.pos, 6),
        );
      }
    }
    // Cover needs the finished graph as well as the finished colliders, so it
    // is built last. Baked once here and only read from then on. Both of these
    // are named rather than inlined into the returned object for one reason:
    // the build's own clock has to stop after them and before the object is
    // assembled, or the profile's total excludes two of its own phases.
    const cover = record("coverMap", () => new CoverMap(nav, this.boxes));
    const obstacles = record(
      "obstacleField",
      () => new ObstacleField(size, this.boxes),
    );
    since("build:total", buildStart);

    return {
      size,
      margin,
      nav,
      cover,
      obstacles,
      controlPoints: layout.controlPoints,
      spawns: layout.spawns,
      vehicleSpawns: layout.vehicles ?? [],
      colliders,
      colliderBoxes: this.boxes,
      rayGroups: this.rayGroups,
      boxGroups: this.boxGroups,
      panes: this.panes,
      paneGroups: this.paneGroups,
      terrainColliders,
      visuals,
      water: layout.water ?? [],
      grass: layout.grass ?? [],
      terrain,
      editor: index,
      dispose: () => {
        for (const m of visuals) m.dispose();
        for (const m of colliders) m.dispose();
        this.lighting.clear();
      },
    };
  }

  /** The valley floor plus the rim that bounds play. */
  private buildValley(
    size: number,
    /** `Borderland.margin`, or 0 on a map closed by the rim. */
    margin: number,
    env: EnvironmentSpec,
    terrain: TerrainField,
    visuals: Mesh[],
    colliders: Mesh[],
    /** The floor's blocks alone — see `GameMap.terrainColliders`. */
    terrainColliders: Mesh[],
    ridge: RidgeSpec | undefined,
  ): void {
    const floorMat = floorMaterial(
      this.mats,
      this.scene,
      env.floorColor,
      env.floorSurface,
    );
    for (const patch of record("terrainPatches", () =>
      terrainPatches(terrain, size, BLOCK_SIZE),
    )) {
      const ground = new Mesh(`terrain-${patch.key}`, this.scene);
      patch.data.applyToMesh(ground);
      ground.material = floorMat;
      // Receiver only: a floor casting into its own depth map is pure acne.
      ground.metadata = { noShadowCaster: true };
      visuals.push(ground);

      // The floor is the one place a collider shares the visual's vertices.
      // `collider()` builds boxes and records a WorldBox for the nav grid, and
      // a heightfield is neither — NavGrid reads the TerrainField directly
      // instead, so this deliberately bypasses it.
      const col = new Mesh(`terrain-${patch.key}-col`, this.scene);
      patch.data.applyToMesh(col);
      col.isVisible = false;
      col.isPickable = true;
      // Vertical placement is the ground probe's job and bots never touch the
      // collidable list, so the floor stays out of moveWithCollisions.
      col.checkCollisions = false;
      // `surface` is the impact channel, and this is the only place in the
      // world that sets it to anything: the clone IS the heightfield, so it
      // is the one collider that can honestly say "ground". `collider()`
      // leaves the field absent on every box it makes, and absent reads as
      // "hard" — see `ImpactKind` in `systems/CombatSystem.ts`. Splitting the
      // boxes into stone/timber/metal later is a `surface` argument on
      // `collider()` and a row in that table; nothing here has to move.
      col.metadata = { solid: true, surface: "ground" };
      col.freezeWorldMatrix();
      colliders.push(col);
      terrainColliders.push(col);
    }

    // The boundary itself: four boxes, and they are the ONLY thing stopping
    // anything leaving the map. Five other systems — NavGrid (rasterize,
    // severLinks, clearBlocked), ObstacleField, CoverMap, Minimap and
    // DeployScreen — identify the boundary by `w > 200 || d > 200` and skip it,
    // so these must stay longer than 200 m and must stay the only boundary
    // colliders. They are invisible: on a rim-closed map what you see instead is
    // the escarpment built below, whose basal band is flush with the inner face
    // at exactly ±half so sparks land on the rock rather than in front of it.
    //
    // **`extent` is the BOUNDARY's, and it is the play square's only on a map
    // closed by the rim.** With a `borderland` the boxes stand a margin further
    // out, past ground the player may legitimately be standing on, and what
    // stops them leaving on the way there is the leash rather than these — see
    // `world/leash.ts`. They stay, and they stay invisible, because a bound the
    // simulation can state is worth having even where nothing should ever reach
    // it: a body outside every box is a body with no floor, no nav cell and no
    // answer to `validateMove`. Growing the map only grows them, so the
    // `> 200 m` shape the seven sites read is untouched.
    const h = 20;
    const t = 2;
    const extent = size + margin * 2;
    const half = extent / 2;
    const sides: [string, number, number, number, number][] = [
      ["n", extent + t * 2, t, 0, half + t / 2],
      ["s", extent + t * 2, t, 0, -half - t / 2],
      ["e", t, extent + t * 2, half + t / 2, 0],
      ["w", t, extent + t * 2, -half - t / 2, 0],
    ];
    for (const [name, w, d, x, z] of sides) {
      colliders.push(
        this.collider(`ridge-${name}-col`, { w, h, d, x, y: h / 2, z }),
      );
    }

    // The rim, as landform. Built outward from the boundary only, so it costs
    // no playable area — see Ridge.ts, which owns the shape and its invariants.
    for (const seg of ridgeSegments(ridge, extent, terrain)) {
      const mesh = new Mesh(`ridge-${seg.key}`, this.scene);
      seg.data.applyToMesh(mesh);
      mesh.material = this.mats.get(
        seg.tone === "scree" ? env.ridgeScreeColor : env.ridgeColor,
      );
      // A 20-45 m crest throws 26-58 m of shadow at the moon's 38 deg, and the
      // shadow window is a fixed 110 m square that follows the player — so a
      // casting rim would end its shadow in a hard line that slides across open
      // ground as you walk. It is a receiver only.
      mesh.metadata = { noShadowCaster: true };
      addOutline(mesh, 0.05);
      visuals.push(mesh);
    }
  }

  /**
   * Sprinkles a prop through a region — a disc or an oriented rectangle — by
   * rejection sampling against what is already there. Counts are authored per
   * region rather than scaled from floor area the way the retired room
   * generator did it.
   *
   * Like a builder, this assembles **at the region's origin, unrotated**, and
   * the merged result is transformed into place afterwards. A rectangle is
   * therefore sampled in its own local frame and turned bodily by `rotY`, prop
   * yaws included, which is what lets the editor move and rotate a region by
   * writing one transform (`repositionItem`) instead of rebuilding it. The
   * rebuild then lands on the same offsets — bar the props whose new
   * surroundings reject them, which is the point of `findSpot`.
   *
   * Every instance in a region is merged into one mesh per colour. A stand of
   * sixteen dead trees becomes two draws instead of ninety-six — the trees do
   * not touch, so the outline pass still traces each trunk separately. The
   * cost is that the region culls as a unit, and is filed under the block its
   * CENTRE falls in: fine for a disc, and the reason to break a tree belt much
   * longer than the 78 m fog wall into a few rectangles rather than authoring
   * one that spans the map.
   */
  private scatterRegion(
    spec: ScatterSpec,
    terrain: TerrainField,
    rng: () => number,
    blocks: BlockMerge,
    colliders: Mesh[],
    item: EditorItem | null,
    index: number,
  ): void {
    const build = SCATTER_BUILDERS[spec.prop];
    const light = SCATTER_LIGHTS[spec.prop];
    const [minS, maxS] = scatterScale(spec);
    const placed: { x: number; z: number; r: number }[] = [];
    const parts: Mesh[] = [];
    // A disc has no orientation, so this is zero for every circular region —
    // which is every region on the shipped map.
    const rot = isScatterRect(spec) ? (spec.rotY ?? 0) : 0;
    const origin = new Vector3(
      spec.x,
      (spec.y ?? 0) + terrain.heightAt(spec.x, spec.z),
      spec.z,
    );

    for (let i = 0; i < spec.count; i++) {
      const scale = minS + rng() * (maxS - minS);
      const clearance = (spec.clearance ?? 0.8) * scale;
      const spot = this.findSpot(spec, rot, clearance, placed, rng);
      if (!spot) continue;
      placed.push({ x: spot.x, z: spot.z, r: clearance });

      // Sampled per prop, not per region: a stand of trees straddling a bank
      // should follow the bank rather than share one height and float. Stored
      // relative to the region's own floor, since that is what the transform
      // below adds back.
      const base = (spec.y ?? 0) + terrain.heightAt(spot.x, spot.z) - origin.y;

      // The prop's own stream, keyed to where it sits in the layout rather
      // than to how much has been drawn before it — see `propSeed`. Minted
      // per prop and not per region so that changing a region's `count`
      // leaves the props it still places drawing what they drew.
      const sub = mulberry32(this.propSeed ^ (index * 7919 + i));
      const prop = build(this.scene, this.mats, rng, sub);
      prop.scaling.setAll(scale);
      prop.position.x = spot.lx;
      prop.position.z = spot.lz;
      prop.position.y = prop.position.y * scale + base;
      // Drawn here and not a line earlier: `build` consumes the same seeded
      // stream, so moving this draw would reroll the whole dressing field.
      // Kept in a local because the collider below is oriented with the prop —
      // the only way a headstone or a fallen log gets a box that means anything.
      const yaw = rng() * Math.PI * 2;
      prop.rotation.y = yaw;
      // Bake the placement into the vertices, then hand the flattened
      // hierarchy to the merge — the same identity-transform trick the
      // structures use, applied one level up.
      parts.push(...flatten(prop));

      if (light) {
        this.lighting.add(
          new Vector3(spot.x, origin.y + base + light.y * scale, spot.z),
          light.color,
          light.range * scale,
          light.intensity,
          light.flicker,
        );
      }
      if (spec.blocking) {
        // The prop's measured body, oriented with it — not its placement
        // clearance squared off. See PROP_BODIES.
        const body = PROP_BODIES[spec.prop];
        const h = body.h * scale;
        const box = {
          w: body.w * scale,
          h,
          d: body.d * scale,
          x: spot.lx,
          y: base + h / 2,
          z: spot.lz,
          rotY: yaw,
        };
        // The region's own frame, so the editor can turn the field as a unit.
        if (item) item.localBoxes.push(box);
        if (item) {
          colliders.push(this.collider(`${spec.prop}-col`, box, origin, rot));
        } else {
          // Recorded now and given geometry at the end of the region: the
          // burial test the NEXT prop runs reads `boxIndex`, so the box cannot
          // wait, and a mesh per box is what `clusterColliders` exists to
          // avoid. Nothing between here and there touches meshes.
          this.pendingCluster.push(this.boxes.length);
          this.recordBox(box, origin, rot);
        }
      }
    }

    for (const merged of mergeByMaterial(parts, `${spec.prop}-field`)) {
      merged.rotation.y = rot;
      merged.position.addInPlace(origin);
      if (item) {
        tag(merged, { list: "scatter", index });
        addOutline(merged, 0.05);
        item.visuals.push(merged);
      } else {
        blocks.add(spec.x, spec.z, merged);
      }
    }
  }

  /**
   * A free spot inside the region: 14 tries, rejecting anything that overlaps
   * an earlier prop or lands inside a structure's collider. Returns null to
   * skip.
   *
   * Both shapes draw exactly two numbers per attempt, in the same order, so
   * adding rectangles left every existing region's dressing field untouched.
   *
   * Returns the spot twice over: `lx`/`lz` in the region's own unrotated frame,
   * which is where the geometry is assembled, and `x`/`z` in the world, which
   * is what the rejection tests and the terrain sample need.
   */
  private findSpot(
    spec: ScatterSpec,
    rot: number,
    clearance: number,
    placed: { x: number; z: number; r: number }[],
    rng: () => number,
  ): { x: number; z: number; lx: number; lz: number } | null {
    for (let attempt = 0; attempt < 14; attempt++) {
      let lx: number;
      let lz: number;
      if (isScatterRect(spec)) {
        lx = (rng() - 0.5) * spec.width;
        lz = (rng() - 0.5) * spec.depth;
      } else {
        // sqrt keeps the distribution even rather than clumped at the centre.
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * spec.radius;
        lx = Math.cos(a) * r;
        lz = Math.sin(a) * r;
      }
      const at = rotateY(lx, 0, lz, rot);
      const x = spec.x + at.x;
      const z = spec.z + at.z;

      let ok = true;
      for (const p of placed) {
        const dx = p.x - x;
        const dz = p.z - z;
        if (dx * dx + dz * dz < (p.r + clearance + 1.2) ** 2) {
          ok = false;
          break;
        }
      }
      if (ok && this.insideCollider(spec, x, z, clearance)) ok = false;
      // Only what a body would meet — see `keepClear`. A prop's own clearance
      // is in the test because the disc is about the ground being FREE, and a
      // trunk half a metre outside it still leans over the flag.
      if (ok && spec.blocking) {
        for (const c of this.keepClear) {
          const dx = c.x - x;
          const dz = c.z - z;
          if (dx * dx + dz * dz < (c.r + clearance) ** 2) {
            ok = false;
            break;
          }
        }
      }
      if (ok) return { x, z, lx, lz };
    }
    return null;
  }

  /**
   * True when a prop at (x, z) would end up buried inside an existing
   * collider box. Colliders below the prop's base don't count (gravestones
   * *stand on* the terrace), and neither do colliders clear above its top
   * (a log passes *under* a creek bridge). Ramps count as their full
   * footprint, so nothing spawns halfway into a slope.
   */
  private insideCollider(
    spec: ScatterSpec,
    x: number,
    z: number,
    clearance: number,
  ): boolean {
    const baseY = spec.y ?? 0;
    // The prop's visual reach, not its collider height: a lantern flame or a
    // spray of branches buried in a wall looks broken even though nothing
    // solid overlaps.
    const topY = baseY + PROP_BODIES[spec.prop].visualTop * scatterScale(spec)[1];
    // Padded by the placement clearance rather than by the prop's own
    // half-width, so a prop keeps visible daylight around it instead of merely
    // not intersecting.
    const pad = clearance;
    // The bucketed neighbours, then the two map-sized boxes the grid refuses.
    // The ridge is in that second list and it is load-bearing here: it is what
    // stops a prop being planted inside the valley wall.
    const near = boxesNear(this.boxIndex, x, z);
    if (
      near &&
      this.anyBuries(near, x, z, baseY, topY, pad)
    ) {
      return true;
    }
    return this.anyBuriesBoxes(this.boxIndex.oversized, x, z, baseY, topY, pad);
  }

  /** The burial test over indices into `boxIndex.boxes`. */
  private anyBuries(
    near: readonly number[],
    x: number,
    z: number,
    baseY: number,
    topY: number,
    pad: number,
  ): boolean {
    for (const i of near) {
      if (this.buries(this.boxIndex.boxes[i], x, z, baseY, topY, pad)) return true;
    }
    return false;
  }

  /** The same, over boxes held directly. */
  private anyBuriesBoxes(
    boxes: readonly WorldBox[],
    x: number,
    z: number,
    baseY: number,
    topY: number,
    pad: number,
  ): boolean {
    for (const b of boxes) {
      if (this.buries(b, x, z, baseY, topY, pad)) return true;
    }
    return false;
  }

  /** One box against one candidate spot. */
  private buries(
    b: WorldBox,
    x: number,
    z: number,
    baseY: number,
    topY: number,
    pad: number,
  ): boolean {
    // A tilted box (rotX ramps) spans a taller band than its thickness.
    let halfH = b.h / 2;
    if (b.rotX !== 0) halfH += (Math.abs(Math.sin(b.rotX)) * b.d) / 2;
    if (topY <= b.cy - halfH + 0.05 || baseY >= b.cy + halfH - 0.05) return false;
    // XZ overlap, tested in the box's local frame. The rotation is
    // `boxGeometry`'s rather than written out here — this call site had it
    // inverted, which mirrored the whole test across every yaw-rotated box
    // while carrying a comment describing the convention it was not using.
    // The extents test stays local because it pads by the placement
    // clearance, which `toLocalXZ` knows nothing about.
    const { lx, lz } = rotateToLocalXZ(b, x, z, this.localScratch);
    return Math.abs(lx) <= b.w / 2 + pad && Math.abs(lz) <= b.d / 2 + pad;
  }

  /**
   * Drawn, never tested. Unpickable and non-colliding so it stays out of every
   * ray pick and the collision broadphase; frozen because none of it moves.
   */
  private markVisual(mesh: Mesh): void {
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.freezeWorldMatrix();
    for (const child of mesh.getChildMeshes()) {
      child.isPickable = false;
      child.checkCollisions = false;
      child.freezeWorldMatrix();
    }
  }

  /** Where a builder's local `BoxSpec` lands once the placement is applied. */
  private worldBoxOf(
    box: BoxSpec,
    origin?: Vector3,
    parentRotY = 0,
  ): WorldBox {
    const local = rotateY(box.x, box.y, box.z, parentRotY);
    const at = origin ? local.addInPlace(origin) : local;
    const world: WorldBox = {
      w: box.w,
      h: box.h,
      d: box.d,
      cx: at.x,
      cy: at.y,
      cz: at.z,
      rotX: box.rotX ?? 0,
      rotY: (box.rotY ?? 0) + parentRotY,
    };
    // Set rather than always written, so a box that is not porous carries no
    // key at all: `worldFingerprint` and the bake both walk these, and an
    // explicit `porous: false` on 820-odd boxes is a field in every baked
    // tuple to say nothing.
    if (box.porous) world.porous = true;
    // **Glass IMPLIES porous, and on the box rather than only in the metadata.**
    // A pane is `porous` exactly — a body walks into it, a round goes through —
    // and `collider()` says so on the mesh, which is what the two pick
    // predicates read. But four things read the BOX and not the mesh, and every
    // one of them was wrong while this line was missing: `CoverMap` baked hard
    // cover behind a window, the AO bake was the only reader that had its own
    // term for glass, the collision bake carried neither flag, and the server
    // therefore rebuilt an intact pane as a solid wall — eating rounds the
    // shooter watched go through it, with `npm run parity` passing because both
    // sides agreed on the same wrong answer.
    if (box.glass) {
      world.porous = true;
      world.glass = true;
    }
    return world;
  }

  /** The box itself, placed. Flags are the caller's — the two kinds differ. */
  private boxMesh(name: string, world: WorldBox): Mesh {
    const mesh = MeshBuilder.CreateBox(
      name,
      { width: world.w, height: world.h, depth: world.d },
      this.scene,
    );
    mesh.position.set(world.cx, world.cy, world.cz);
    mesh.rotation.set(world.rotX, world.rotY, 0);
    mesh.isVisible = false;
    mesh.isPickable = true;
    return mesh;
  }

  /** Tested, never drawn. The only geometry that carries `solid`. */
  private collider(
    name: string,
    box: BoxSpec,
    origin?: Vector3,
    parentRotY = 0,
  ): Mesh {
    const world = this.recordBox(box, origin, parentRotY);
    const mesh = this.boxMesh(name, world);
    this.item?.colliders.push(mesh);
    mesh.checkCollisions = true;
    // `porous` rides in the metadata rather than being answered by leaving
    // `solid` off, because the two questions have different answers and both
    // are asked of this mesh: it IS the solid world to a body (movement, the
    // ground probe) and is not there at all to a round. `OPAQUE_ONLY` is the
    // reader; dropping `solid` instead would let the player fall through a
    // fence top their own capsule is still being held out of.
    //
    // A breakable pane is `porous` and says so twice: once for the predicates,
    // which need nothing new to get glass right, and once as `glass` for the
    // three readers that must skip a pane rather than merely pass a round
    // through it (`CoverMap`, the AO bake, and the bake that reaches the
    // server). The caller stamps the pane INDEX on top — see `paneGroup`.
    mesh.metadata = box.glass
      ? { solid: true, porous: true, glass: true }
      : box.porous
        ? { solid: true, porous: true }
        : { solid: true };
    mesh.freezeWorldMatrix();
    return mesh;
  }

  /**
   * Records one collider box in `boxes` and in the build-time index, and hands
   * back its world form — everything `collider()` does except mint the mesh.
   *
   * **Split out so a mesh can be made LATER, or made once for many boxes**, and
   * the order matters: `findSpot`'s burial test reads `boxIndex` as it places,
   * so a prop's box has to be indexed before the next prop is sampled, whatever
   * happens to its geometry afterwards. See `clusterColliders`.
   *
   * `collider()` is still the only place a collider MESH is made from a single
   * box, and this is still the only place a `WorldBox` enters `boxes` — which
   * is the property the bake, the nav grid and the AO all rest on.
   */
  private recordBox(box: BoxSpec, origin?: Vector3, parentRotY = 0): WorldBox {
    const world = this.worldBoxOf(box, origin, parentRotY);
    this.item?.boxes.push(this.boxes.length);
    this.boxes.push(world);
    // The scatter index rides along here because this is the only place a box
    // is ever recorded — the same property that makes `boxes` complete.
    // Feeding it anywhere else would leave the two able to disagree.
    insertBox(this.boxIndex, world);
    return world;
  }

  /**
   * Turns already-recorded boxes into collider meshes MERGED BY LOCALITY —
   * one mesh per `CLUSTER` square of ground rather than one per box.
   *
   * **This is the fence lesson at forest scale, and the numbers are the same
   * ones.** A `pickWithRay` costs per MESH before it costs per triangle: a
   * predicate call, a world-matrix inverse and a bounding test each, and the
   * game fires such rays every frame against every solid mesh on the map — the
   * hitscan on every shot, sixteen bots' LOS, the grenade, the death cam, a
   * tank's chase camera. (`Player.probeGround` was the largest of them when
   * FINDINGS #6 measured this and is no longer a ray; the merge is neutral for
   * it either way, because `colliderBoxes` keeps one entry per prop however the
   * meshes are grouped.) Greyfen's five belts were 354 loose tree boxes out of
   * 696 solid meshes, so half of every ray in the game was already being spent
   * on trees — and a jungle dense enough to be worth the name needs three
   * times that. Merged per 12 m square the same 950 trees are ~120 meshes, so
   * the map gets a forest and the ray budget gets *cheaper* than it was.
   *
   * **Locality is the whole of it.** `struts()` merges per fence for the
   * reason this merges per square: one mesh around every tree on the map would
   * wrap one bounding box around the whole valley, and then every ray fired
   * anywhere would test every trunk. A square is what a region has instead of a
   * placement — a belt is 78 x 40 m of scattered props with no natural unit
   * inside it — and 12 m is a few trees across, which is the same handful a
   * fence holds.
   *
   * The boxes stay in `boxes`, one per prop, because everything derived from
   * geometry reads that list and a cluster is not a shape: the nav grid, the
   * cover bake, the obstacle field and the AO all still see individual trunks.
   * What is merged is only what a ray meets. The grouping is carried on
   * `boxGroups` so the SERVER can rebuild the same meshes from the bake — a
   * flat list cannot say which boxes were one cluster, exactly as with
   * `rayGroups`.
   *
   * The editor never gets here: it needs one mesh per box so `repositionItem`
   * can walk colliders and boxes in step, which is the same reason it skips the
   * visual `BlockMerge` and the strut merge.
   */
  private clusterColliders(name: string, indices: readonly number[]): Mesh[] {
    const buckets = new Map<string, number[]>();
    for (const i of indices) {
      const box = this.boxes[i];
      const key = `${Math.floor(box.cx / CLUSTER)},${Math.floor(box.cz / CLUSTER)}`;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(i);
      else buckets.set(key, [i]);
    }
    const out: Mesh[] = [];
    for (const [key, group] of buckets) {
      const parts = group.map((i, j) =>
        this.boxMesh(`${name}-col${key}-${j}`, this.boxes[i]),
      );
      // A single box is a merge of one: cheaper to keep the mesh than to run
      // it through `MergeMeshes` for nothing.
      const mesh =
        parts.length === 1
          ? parts[0]
          : Mesh.MergeMeshes(parts, true, true, undefined, false, false);
      if (!mesh) continue;
      mesh.name = `${name}-cluster${key}`;
      mesh.isVisible = false;
      mesh.isPickable = true;
      mesh.checkCollisions = true;
      // Nothing clustered is porous or glass — see the caller, which refuses to
      // group anything whose metadata is not plain `solid`. One mesh cannot
      // carry two answers, and glass has to stay addressable one pane at a time.
      mesh.metadata = { solid: true };
      mesh.freezeWorldMatrix();
      this.boxGroups.push(group);
      out.push(mesh);
    }
    return out;
  }

  /**
   * One placement's glazing: the merged sheet meshes, plus a collider for each
   * pane that is `breakable`.
   *
   * **The merge is what makes a city's worth of glass affordable at all.**
   * Glazing is the one ALPHA-BLENDED thing in the world, and a transparent
   * mesh is sorted by distance and drawn on its own rather than batched — so
   * Coldharbour's six thousand sheets as a mesh each would be six thousand
   * unbatched draws against ~150 for the whole map. They merge per PLACEMENT
   * instead, exactly as `mergeByMaterial` merges a cottage's walls, and then
   * again per map block (`PaneBlocks`).
   *
   * **What survives both merges is the handful of panes that can be taken
   * away**, and they survive as a vertex RANGE rather than as a mesh: each
   * `breakable` pane's positions are a known span of the merged buffer, and
   * breaking one collapses that span onto its own first vertex. Every triangle
   * in it is then degenerate and rasterizes nothing, at a cost of one
   * `updateVerticesData` on one small buffer. That is why the second merge is
   * this file's own rather than `BlockMerge` — a block merge is what makes a
   * placement unrecoverable, and these ranges are carried through it by a
   * running vertex offset instead of being given up.
   *
   * What makes that collapse the whole of a break rather than the first half of
   * one is that a pane owns nothing else to take down with it. It casts no
   * shadow and carries no outline (see the `paneBlocks.finish` loop in `build`
   * for why glass has neither), so there is no second registration anywhere to
   * revoke — and `bakeVertexShading` writes the COLOUR buffer, so the bake is
   * untouched by a later position rewrite and may still run last.
   *
   * A breakable pane's collider is an ordinary `collider()` box, one mesh each,
   * which is affordable for the same reason the flag is rare: there is a room
   * behind twenty-four sheets on this map and behind none of the rest. Breaking one
   * is then two property writes rather than vertex surgery — see `GlassSystem`.
   */
  private paneGroup(
    name: string,
    s: Structure,
    origin: Vector3,
    parentRotY: number,
    placement: number,
  ): { visuals: PaneGroup[]; colliders: Mesh[] } {
    const visuals: PaneGroup[] = [];
    const colliders: Mesh[] = [];

    // Grouped by material and kept in declaration order within a group, because
    // the vertex ranges below are read off that order and nothing else records
    // it. Panes carry no exemptions, so unlike `mergeByMaterial` there is no
    // second key — a pane that ever needs one owes this method the same nesting.
    const groups = new Map<Material, number[]>();
    for (const [j, mesh] of s.paneMeshes.entries()) {
      const mat = mesh.material;
      if (!mat) continue;
      const group = groups.get(mat);
      if (group) group.push(j);
      else groups.set(mat, [j]);
    }

    for (const [mat, members] of groups) {
      // Vertex counts are read BEFORE the merge and never assumed. A box is 24
      // positions today and the arithmetic would be right, but `MergeMeshes`
      // disposes its sources — so a wrong guess here is unrecoverable and
      // silent, and it would break the wrong pane rather than throwing.
      const parts: Mesh[] = [];
      const ranges: { start: number; count: number }[] = [];
      let cursor = 0;
      for (const j of members) {
        const mesh = s.paneMeshes[j];
        const count = mesh.getTotalVertices();
        ranges.push({ start: cursor, count });
        cursor += count;
        parts.push(mesh);
      }
      const merged =
        parts.length === 1
          ? // The group-of-one exception `MergeMeshes` will not handle, and the
            // same hand-bake `mergeByMaterial` does: the caller composes a
            // transform onto what it gets back, so an unbaked mesh would have
            // its own position clobbered rather than added to.
            parts[0].bakeCurrentTransformIntoVertices()
          : Mesh.MergeMeshes(parts, true, true, undefined, false, false);
      if (!merged) continue;
      merged.name = `${name}-${mat.name}`;
      merged.material = mat;
      merged.rotation.y = parentRotY;
      merged.position.addInPlace(origin);

      const paneIndices: number[] = [];
      for (const [k, j] of members.entries()) {
        const spec = s.panes[j];
        // Fixed glazing stops here: it is drawn, it is merged, and no part of
        // the game beyond this mesh knows it exists. Only a `breakable` sheet
        // earns a `WorldPane` — an index on the wire, a row in the collision
        // bake, a bucket in `GlassSystem`'s sweep and a collider — and it earns
        // it by having somewhere behind it to get into. See `PaneSpec`.
        if (!spec.breakable) continue;
        const at = rotateY(spec.x, spec.y, spec.z, parentRotY).addInPlace(
          origin,
        );
        const pane: WorldPane = {
          w: spec.w,
          h: spec.h,
          d: spec.d,
          cx: at.x,
          cy: at.y,
          cz: at.z,
          rotY: (spec.rotY ?? 0) + parentRotY,
          // Relative to THIS merge for now. `PaneBlocks.finish` shifts both
          // fields when it folds this mesh into its block's, which is the one
          // place either is ever rewritten.
          vertexStart: ranges[k].start,
          vertexCount: ranges[k].count,
          group: -1,
          box: -1,
        };
        const index = this.panes.push(pane) - 1;
        paneIndices.push(index);
        // The collider comes with the pane rather than being a second choice
        // about it: a sheet worth breaking is one with a room behind it, which
        // is a body's barrier for as long as it stands.
        //
        // It records its own place in `colliderBoxes` on the pane,
        // which is what the server and the fingerprint name it by; the mesh
        // carries the pane index back the other way, which is what
        // `GlassSystem` finds it with. Neither side can be derived from the
        // other — `colliders` holds struts and terrain that `boxes` does not.
        const spawned: BoxSpec = {
          w: spec.w,
          h: spec.h,
          d: spec.d,
          x: spec.x,
          y: spec.y,
          z: spec.z,
          rotY: spec.rotY,
          glass: true,
        };
        pane.box = this.boxes.length;
        const mesh = this.collider(`${name}-col`, spawned, origin, parentRotY);
        mesh.metadata.pane = index;
        if (this.item) {
          tag(mesh, { list: "placements", index: placement });
          this.item.localBoxes.push(spawned);
        }
        colliders.push(mesh);
      }
      // `block` is empty here and filled by `PaneBlocks.finish`, the same way
      // this method leaves `WorldPane.group` at -1 for it: a placement does not
      // know which block it will be merged under, and these per-placement
      // groups never reach `GameMap` — only `finish`'s output does.
      visuals.push({ mesh: merged as Mesh, panes: paneIndices, block: "" });
    }
    return { visuals, colliders };
  }

  /**
   * One placement's `strut`s: the ray geometry that stands where the timber is
   * drawn — a fence's posts and rails — as ONE collider mesh.
   *
   * **The merge is the whole reason this can afford to be honest.** A pick
   * costs per MESH far more than it costs per triangle: it runs the predicate,
   * inverts a world matrix and tests a bounding box before a triangle is ever
   * considered. Measured against Hollowmere's fences, 161 loose post and rail
   * boxes cost every ray in the game about 17% — the ground probe included,
   * and that is the most expensive single call the game makes per frame —
   * while the same geometry merged per fence costs the probe 1.4%, a shot
   * 0.3%, and 7.4% on the rays that actually cross a fence and have triangles
   * to test. Fourteen meshes, not a hundred and sixty-one.
   *
   * These emit no `WorldBox` and are not in `boxes`: navigation, cover, the
   * obstacle field and the AO bake read a fence's coarse `porous` box instead,
   * which is the shape they can represent (see `BoxSpec.rayOnly`). They go in
   * `rayGroups` instead, grouped exactly as merged, because the SERVER has to
   * rebuild the same geometry from the bake and a flat list would leave it
   * merging by guesswork.
   *
   * The editor gets them unmerged, for the reason it also skips the visual
   * `BlockMerge`: `repositionItem` walks colliders, local specs and boxes in
   * step, and one mesh standing for eleven specs cannot be moved that way.
   */
  private struts(
    name: string,
    specs: BoxSpec[],
    origin: Vector3,
    parentRotY: number,
  ): Mesh[] {
    const worlds = specs.map((s) => this.worldBoxOf(s, origin, parentRotY));
    this.rayGroups.push(worlds);
    const parts = worlds.map((w, i) => this.boxMesh(`${name}${i}`, w));
    for (const part of parts) {
      part.checkCollisions = false;
      part.metadata = { solid: true, rayOnly: true };
    }
    if (this.item) {
      for (const part of parts) {
        part.freezeWorldMatrix();
        // No `WorldBox` behind a strut, so there is no index to record — but
        // the slot is kept, because `repositionItem` reads these three arrays
        // in parallel and `boxes[-1]` is the undefined its guard expects.
        this.item.boxes.push(-1);
        this.item.colliders.push(part);
      }
      return parts;
    }
    const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, false);
    if (!merged) return [];
    merged.name = name;
    merged.isVisible = false;
    merged.isPickable = true;
    merged.checkCollisions = false;
    merged.metadata = { solid: true, rayOnly: true };
    merged.freezeWorldMatrix();
    return [merged];
  }
}

/**
 * A scatter spec's scale range as a genuine `[min, max]`, whichever order it
 * was authored in.
 *
 * `spec.scale` is an interval, and nothing enforces which end is written
 * first: `scatterRegion` lerps between the two entries and reads the same
 * interval either way, and the editor writes the pair through two independent
 * number fields (`scale min` / `scale max` in `inspect.ts`) that can be left
 * crossed. Every reader that wants the TOP of the range has to sort for it —
 * taking `[1]` on faith is silently wrong on a descending pair, and both of
 * the readers below fail in the quiet direction: an under-padded `boxIndex`
 * misses boxes rather than reporting them (the failure its header names), and
 * an under-reaching `topY` clears a prop the wall would have buried.
 */
function scatterScale(spec: ScatterSpec): [number, number] {
  const [a, b] = spec.scale ?? [1, 1];
  return a <= b ? [a, b] : [b, a];
}

/**
 * The widest clearance any of this layout's scatter regions can ask about —
 * what `boxIndex` has to be padded by so no burial test can miss a box.
 *
 * `findSpot` queries with `(spec.clearance ?? 0.8) * scale` where `scale` is
 * drawn from the spec's own range, so the maximum is over the top of that
 * range. The `+ 1` is the same slack `findSpot` adds to its neighbour test and
 * costs nothing here: a wider pad is a slower index, never a wrong one.
 */
function maxScatterClearance(layout: MapLayout): number {
  let max = 0;
  for (const spec of layout.scatter ?? []) {
    max = Math.max(max, (spec.clearance ?? 0.8) * scatterScale(spec)[1]);
  }
  return max + 1;
}

/** Appends a fresh, empty item to an editor list and returns it. */
function newItem(into: EditorItem[]): EditorItem {
  const item: EditorItem = {
    visuals: [],
    colliders: [],
    boxes: [],
    localBoxes: [],
  };
  into.push(item);
  return item;
}

/**
 * Moves and rotates a built item to a new placement, in place — visuals,
 * collider proxies, and the WorldBoxes the nav grid reads.
 *
 * No rebuild is needed for this: a builder assembles at the origin and
 * MapBuilder transforms the result, so a placement's transform is the only
 * thing that changes. Re-running the builder would give the same geometry at a
 * different transform, one hundred times more slowly.
 *
 * Editor-only. It leaves `nav` and `obstacles` stale — they are derived from
 * the boxes at build time and must be rebuilt by the caller when it wants
 * navigation to agree with what is on screen again.
 */
export function repositionItem(
  item: EditorItem,
  boxes: WorldBox[],
  origin: Vector3,
  rotY: number,
): void {
  for (const m of item.visuals) {
    m.unfreezeWorldMatrix();
    m.position.copyFrom(origin);
    m.rotation.y = rotY;
    m.freezeWorldMatrix();
  }
  for (let i = 0; i < item.colliders.length; i++) {
    const spec = item.localBoxes[i];
    const mesh = item.colliders[i];
    if (!spec || !mesh) continue;
    const at = rotateY(spec.x, spec.y, spec.z, rotY).addInPlace(origin);
    const rotX = spec.rotX ?? 0;
    const ry = (spec.rotY ?? 0) + rotY;
    mesh.unfreezeWorldMatrix();
    mesh.position.copyFrom(at);
    mesh.rotation.set(rotX, ry, 0);
    mesh.freezeWorldMatrix();
    const box = boxes[item.boxes[i]];
    if (box) {
      box.cx = at.x;
      box.cy = at.y;
      box.cz = at.z;
      box.rotX = rotX;
      box.rotY = ry;
    }
  }
}

/**
 * Records which layout item a mesh belongs to. The editor picks with a
 * predicate on this, which is why visuals can stay `isPickable = false`:
 * Babylon skips the isPickable test entirely when a pick supplies a predicate,
 * so the visual/collider split survives the editor untouched.
 */
function tag(mesh: Mesh, ref: EditorRef): void {
  mesh.metadata = { ...(mesh.metadata ?? {}), editorRef: ref };
}

/**
 * Side of a merge block, in metres. 48 m over a 240 m map gives a 5x5 grid of
 * blocks — coarse enough that the whole village collapses into a few dozen
 * draws, fine enough that frustum culling still throws away most of the map.
 * Well under the 78 m fog wall, so a block is never half-visible for long.
 */
export const BLOCK_SIZE = 48;

/**
 * The second merge pass: collapses every structure and scatter field into one
 * mesh per (map block, material).
 *
 * The per-structure merge in `mergeByMaterial` already turns a cottage into
 * four meshes, but a dense village is ~200 structures and the outline pass
 * draws each mesh twice. Grouping neighbours by block takes the map from ~670
 * draws to ~150 without giving up culling: buildings are static, so the extra
 * vertices cost nothing that the draw calls weren't already costing more of.
 *
 * Merging across placements is safe for the same reason it is safe within one:
 * `MergeMeshes` bakes world matrices. Outlines still trace each building,
 * because `renderOutline` expands vertices along their own normals and the
 * buildings in a block are disjoint.
 */
class BlockMerge {
  private blocks = new Map<string, Mesh[]>();

  /** Files a positioned, per-material merged mesh under its map block. */
  add(x: number, z: number, mesh: Mesh): void {
    const key = `${Math.floor(x / BLOCK_SIZE)},${Math.floor(z / BLOCK_SIZE)}`;
    const group = this.blocks.get(key);
    if (group) group.push(mesh);
    else this.blocks.set(key, [mesh]);
  }

  /**
   * Merges each block and returns the meshes the caller should draw.
   *
   * `palette` is what turns this from a merge per COLOUR into a merge per
   * block: hand it a hex and it hands back the slot to write into `uv2`, or 0
   * for a colour it has no room for. It is a callback rather than a map because
   * the slots are allocated in the order the merge meets them, and the merge is
   * the only thing that knows that order.
   */
  finish(palette: Palette): Mesh[] {
    const out: Mesh[] = [];
    for (const [key, group] of this.blocks) {
      for (const merged of mergeByMaterial(group, `block${key}`, palette)) {
        // The key travels ON the mesh, because `ReflectionSystem` has to ask
        // which building a merged mesh IS and the palette took the answer out
        // of the geometry — see `encloses` there. `PaneBlocks` files glazing
        // under this same key, which is what lets the two agree on "the same
        // building" without measuring a distance between two centres.
        merged.metadata = { ...(merged.metadata ?? {}), block: key };
        out.push(merged);
      }
    }
    return out;
  }
}

/**
 * The same second pass for glazing, and it is a class of its own rather than a
 * caller of `BlockMerge` because the two want opposite things from a merge.
 *
 * `BlockMerge` exists to make a placement unrecoverable — that is the saving.
 * A breakable pane must survive it, so this one carries every such pane's
 * vertex range across by the running offset of the meshes ahead of it. Same
 * key, same reason (glass is unbatched alpha, so a mesh is a sorted draw of its
 * own), and measured on Coldharbour: 6,139 sheets across 82 glazed placements
 * (44 towers, 26 cars, 8 shophouses, 2 offices, 2 depots) come out as 40
 * meshes, eight of which hold a range anything will ever write.
 *
 * **The editor keys per placement instead**, so nothing merges across
 * placements there — the same exemption `BlockMerge` gets, for the same reason.
 * Running the pass either way keeps one code path, and the pass is where the
 * position buffer is made updatable.
 */
class PaneBlocks {
  private blocks = new Map<string, PaneGroup[]>();
  /** The layout item a block belongs to, on editor builds. See `add`. */
  private owners = new Map<string, { item: EditorItem; placement: number }>();

  /**
   * Files one placement's merged glazing under its map block.
   *
   * **On an editor build the key is the PLACEMENT**, so nothing merges across
   * placements and every block has exactly one owner — which is what lets the
   * merged mesh be handed back to that item's `visuals`. Without it a dragged
   * building leaves its own windows behind in the street, and nothing says so:
   * the glass is still drawn, still in `visuals`, and still disposed with the
   * map.
   */
  add(
    x: number,
    z: number,
    group: PaneGroup,
    item: EditorItem | null,
    placement: number,
  ): void {
    const key = item
      ? `item${placement}`
      : `${Math.floor(x / BLOCK_SIZE)},${Math.floor(z / BLOCK_SIZE)}`;
    if (item) this.owners.set(key, { item, placement });
    const existing = this.blocks.get(key);
    if (existing) existing.push(group);
    else this.blocks.set(key, [group]);
  }

  /**
   * Merges each block and rewrites the ranges it moved.
   *
   * `panes` is the map's list, written through: a pane's `vertexStart` shifts
   * by the vertices of every mesh merged ahead of its own, and its `group`
   * becomes the index of the mesh it ended up in. Nothing else may write either
   * field.
   */
  finish(panes: WorldPane[], out: PaneGroup[]): Mesh[] {
    const meshes: Mesh[] = [];
    for (const [key, group] of this.blocks) {
      // Split by material for the reason `mergeByMaterial` does: two materials
      // in one mesh would draw one of them wrong. Glass is one colour today, so
      // this is almost always a single group.
      const byMaterial = new Map<Material, PaneGroup[]>();
      for (const g of group) {
        const mat = g.mesh.material;
        if (!mat) continue;
        const list = byMaterial.get(mat);
        if (list) list.push(g);
        else byMaterial.set(mat, [g]);
      }

      for (const [mat, list] of byMaterial) {
        // Offsets are accumulated BEFORE the merge, because `MergeMeshes`
        // disposes its sources and `getTotalVertices()` afterwards is a read
        // off a dead mesh. It concatenates in array order, which is what makes
        // a running sum the right answer at all.
        let offset = 0;
        const indices: number[] = [];
        for (const g of list) {
          for (const p of g.panes) {
            panes[p].vertexStart += offset;
            indices.push(p);
          }
          offset += g.mesh.getTotalVertices();
        }
        const parts = list.map((g) => g.mesh);
        // **A group of one is taken AS IT STANDS, and must not be baked.** This
        // is where this pass differs from `mergeByMaterial`, which bakes a lone
        // mesh because its caller then composes a placement's transform onto
        // what it gets back. Nothing composes anything onto these: `paneGroup`
        // has already put each mesh where it belongs. Baking anyway flattens
        // that transform into the vertices and leaves the mesh at identity,
        // which the editor's `repositionItem` then reads as "no transform yet"
        // and applies the placement a second time — a dragged building whose
        // glass is at twice its own offset, drawn perfectly, with nothing in
        // the numbers to point at.
        const merged =
          parts.length === 1
            ? parts[0]
            : Mesh.MergeMeshes(parts, true, true, undefined, false, false);
        if (!merged) continue;
        merged.name = `paneblock${key}-${mat.name}`;
        merged.material = mat;
        // Updatable, which no merge can ask for: `MergeMeshes` writes a static
        // buffer and `bakeCurrentTransformIntoVertices` leaves whatever was
        // there. Without this the first break is a silent no-op — the array is
        // rewritten and never re-uploaded.
        //
        // Only where there is something to break. A block of pure glazing is
        // immutable for the life of the map — nothing holds a range into it and
        // nothing may write one — so it keeps the static buffer the merge gave
        // it, which is what almost every block on Coldharbour is.
        if (indices.length > 0) {
          const positions = merged.getVerticesData(VertexBuffer.PositionKind);
          if (positions) {
            merged.setVerticesData(VertexBuffer.PositionKind, positions, true);
          }
        }
        const groupIndex = out.length;
        for (const p of indices) panes[p].group = groupIndex;
        out.push({ mesh: merged as Mesh, panes: indices, block: key });
        meshes.push(merged as Mesh);
        // Editor builds only, and AFTER the merge rather than before it: a
        // merge of two or more disposes its sources, and `Node.dispose` nulls
        // their metadata — so a tag written on the way in survives only for a
        // group of one. That is every group here in editor mode, which is
        // exactly the kind of accident that holds until somebody gives a
        // building two colours of glass. Hand the mesh to the item that owns it
        // so a dragged building takes its glazing with it.
        const owner = this.owners.get(key);
        if (owner) {
          tag(merged as Mesh, { list: "placements", index: owner.placement });
          owner.item.visuals.push(merged as Mesh);
        }
      }
    }
    return meshes;
  }
}

/**
 * Flattens a prop hierarchy into a plain mesh list, unparenting each child so
 * its world transform survives the merge. `MergeMeshes` reads world matrices,
 * so the children have to be detached but left where they are.
 */
function flatten(root: Mesh): Mesh[] {
  const out: Mesh[] = [root];
  for (const child of root.getChildMeshes()) {
    const m = child as Mesh;
    m.computeWorldMatrix(true);
    m.setParent(null);
    out.push(m);
  }
  return out;
}

/** Rotates a local offset about the Y axis. */
function rotateY(x: number, y: number, z: number, angle: number): Vector3 {
  if (angle === 0) return new Vector3(x, y, z);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new Vector3(x * c + z * s, y, -x * s + z * c);
}

/**
 * The render exemptions a merged mesh may carry, and the reason they are part
 * of the merge KEY rather than something read off a member.
 *
 * `noOutline` could have been propagated from any one mesh safely, because it
 * tracks the MATERIAL: the kit's `glow()` reaches for `getEmissive`, so an
 * emissive group is unanimous by construction and the group key already
 * implies the flag. `noGlow` and `noShadowCaster` track a mesh's ROLE, which
 * is orthogonal to its colour — a flat sheet that must not cast stands in the
 * same paint as the wall behind it. Reading either off one member would hand
 * the whole colour group an exemption one mesh asked for, and through
 * `BlockMerge` that group is every structure within 48 m; requiring unanimity
 * instead would drop the exemption the one mesh genuinely needed. Both fail
 * silently. Keying splits a disagreeing group into one merged mesh per
 * exemption set, which costs a draw call exactly when there is a real
 * disagreement to represent and nothing at all otherwise.
 *
 * `solid` is deliberately NOT in the set — a merged VISUAL is never a
 * collider, and carrying it up would break the one rule the world layer cannot
 * bend.
 *
 * The sway mark is keyed beside these and is not one of them, because it is a
 * VALUE rather than a flag — a canopy leaf and a fern blade are both foliage
 * and lean by different amounts. It is in the key for the `noGlow` reason and
 * one further one: `vertexShading` reads the mark once per MESH and writes the
 * weight per vertex from it, so a group that disagreed would write one layer's
 * answer over both.
 */
const EXEMPTIONS = ["noOutline", "noGlow", "noShadowCaster"] as const;

type Exemption = (typeof EXEMPTIONS)[number];

/** A mesh's exemptions, in a fixed order so the key is stable. */
function exemptionsOf(mesh: Mesh): Exemption[] {
  return EXEMPTIONS.filter((flag) => mesh.metadata?.[flag] === true);
}

/**
 * Collapses a structure's meshes into one per material.
 *
 * This is the whole draw-call budget for the village: a cottage goes from ~20
 * meshes to 4, and — because `renderOutline` draws a back-face shell per mesh —
 * from ~40 draws to 8. It also means the outline traces each colour group's
 * silhouette rather than every individual plank, which is the look the rifle
 * already uses.
 *
 * Merging is only safe because builders work at identity: `MergeMeshes` bakes
 * world matrices and hands back an identity-transform mesh, which the caller
 * then positions.
 */
function mergeByMaterial(
  meshes: Mesh[],
  tag: string,
  palette?: Palette,
): Mesh[] {
  // Material first, then sway layer and exemption set — see `EXEMPTIONS`.
  // Nested rather than keyed on a composed string, because two distinct
  // materials are free to share a name and a merge across them would draw one
  // of them wrong.
  const groups = new Map<Material, Map<string, Group>>();
  for (const m of meshes) {
    const mat0 = m.material;
    if (!mat0) continue;
    // **The palette is what takes the COLOUR out of this key.** A matte cel
    // material differs from another only in a uniform, so every one of them can
    // be answered by one material reading the albedo per vertex instead — which
    // is what collapses a block of a city from ten meshes to two. Only the
    // plain matte variant qualifies: gloss, translucency, glazing and emissive
    // are shader BEHAVIOUR and merging across them would draw one of them
    // wrong, which is the rule this function already states about two materials
    // sharing a name.
    const hex = palette ? plainCelHex(mat0.name) : null;
    const slot = hex ? palette!.slot(hex) : 0;
    if (slot > 0) writePaletteIndex(m, slot);
    const mat = slot > 0 ? palette!.material : mat0;
    let byExemption = groups.get(mat);
    if (!byExemption) groups.set(mat, (byExemption = new Map()));
    const flags = exemptionsOf(m);
    // The sway mark is in the key for the EXEMPTIONS' reason and one of its
    // own. It tracks a mesh's ROLE — a canopy tree's leaf plates sway and its
    // trunk does not, in the same palette green a fern's crown is — so reading
    // it off one member would hand a whole colour group a lean one mesh asked
    // for. The extra reason is that the BAKE reads it per mesh rather than per
    // vertex, so a group that disagreed would write one answer over both.
    const sway = swayLayerOf(m);
    const key = `${sway ?? ""}|${flags.join("-")}`;
    const group = byExemption.get(key);
    if (group) group.meshes.push(m);
    else byExemption.set(key, { flags, sway, meshes: [m] });
  }

  const out: Mesh[] = [];
  for (const [mat, byExemption] of groups) {
    for (const { flags, sway, meshes: group } of byExemption.values()) {
      const merged =
        group.length === 1
          ? // A merge of two or more bakes their world matrices; a group of one
            // has to be baked by hand or the promise above is a lie for exactly
            // the colours only one mesh uses — and the caller, which positions
            // and rotates what it gets back, would clobber that mesh's own
            // transform instead of composing with it.
            group[0].bakeCurrentTransformIntoVertices()
          : Mesh.MergeMeshes(group, true, true, undefined, false, false);
      if (!merged) continue;
      // Suffixed only where a group actually splits, so the common name is the
      // one the rest of the tree already reads in a profile.
      const suffix = flags.map((f) => `-${f}`).join("");
      merged.name = `${tag}-${mat.name}${sway ? `-${sway}` : ""}${suffix}`;
      merged.material = mat;
      // From the KEY, not from a member — and this half of it was not a
      // precaution, it was a live bug. The exemption used to be read back off
      // the group AFTER the merge, and `MergeMeshes` is called with
      // `disposeSource = true`, so by then Babylon's `Node.dispose` has set
      // every source's `metadata` to null and the read came back false for any
      // group of two or more. Only a group of ONE survived it, because that
      // path bakes in place and disposes nothing. Measured on Hollowmere: 19
      // of the map's 42 merged emissive meshes lost `noOutline` here and were
      // handed an outline shell by the caller — a black ring drawn around
      // every lantern, flame and sign dense enough to have a neighbour its own
      // colour. Grouping first means the flags are read while the meshes are
      // still alive, and the group is unanimous, so the key is what they said.
      for (const flag of flags) {
        merged.metadata = { ...(merged.metadata ?? {}), [flag]: true };
      }
      // **A swaying group carries the mark forward, and it is taken out of
      // BABYLON's outline pass — which is a mechanical consequence, not a
      // preference, and not the same thing as losing its ink.**
      // `OutlineRenderer.isReady` builds its hull's effect with a hardcoded
      // attribute list of position and normal (`const color = false`,
      // literally) and a hardcoded uniform list with no clock in it, so that
      // hull can see neither the wind nor the per-vertex weight. An outlined
      // leaf would lean out from under a shell left standing at the rest pose,
      // and a third of a metre against a five centimetre line is a dark ghost
      // of the still canopy hanging behind the moving one. What draws the line
      // instead is `inkTwin`, below: the same hull through the cel shader,
      // which has the wind and the weight already.
      if (sway) {
        markSwayMerged(merged as Mesh, sway);
      }
      // **A paletteised group comes out of Babylon's outline pass for the same
      // KIND of reason a swaying one does, and it is worth saying which.** The
      // sway group leaves because the hull cannot see the wind; this one leaves
      // because the hull is one flat colour per MESH and this mesh is now every
      // colour in the block. `OutlineRenderer` offers no hook to extend either
      // its attributes or its uniforms — `OutlineFog` had to bake literals into
      // its source for want of one — so there is nowhere to put an index or a
      // palette, and an ink resolved per mesh here would hand a dark plaster's
      // line to the pale stone beside it. Above the light term that is not a
      // wrong colour, it is a bright halo, which is the failure `inkState`
      // exists to make impossible.
      //
      // A group that was ALREADY exempt keeps its exemption and gets no twin:
      // an emissive fitting or a painted road asked not to be inked, and the
      // palette is not a reason to overrule it.
      if (mat === palette?.material && !flags.includes("noOutline")) {
        merged.metadata = {
          ...(merged.metadata ?? {}),
          noOutline: true,
          inkTwin: true,
        };
      }
      out.push(merged as Mesh);
    }
  }
  return out;
}

/** One merge group: the meshes, and the exemptions and sway they all agree on. */
type Group = { flags: Exemption[]; sway: SwayLayer | null; meshes: Mesh[] };

/**
 * What a merge needs in order to take the colour out of its key: somewhere to
 * put a hex, and the one material that answers for all of them.
 *
 * Passed in rather than reached for, because the SLOTS are allocated in the
 * order the merge meets a colour and only the merge knows that order, while the
 * material belongs to a factory this file's free functions cannot see.
 */
type Palette = {
  /** The 1-based slot for a hex, or 0 for "keep your own material". */
  slot(hex: string): number;
  /** The material every slotted mesh ends up wearing. */
  material: Material;
};

/**
 * The hex of a PLAIN matte cel material, or null for anything else.
 *
 * Deliberately stricter than `inkColorFor`'s regex, which also accepts the
 * gloss and translucent variants: those differ from this one in shader
 * BEHAVIOUR and not merely in a uniform, so they cannot share a material
 * however alike their colours are. The two regexes are not duplicates of each
 * other and must not be made into one — they are asking different questions of
 * the same name.
 */
function plainCelHex(materialName: string): string | null {
  const m = /^cel-(#[0-9a-fA-F]{6})$/.exec(materialName);
  return m ? m[1] : null;
}

/**
 * Stamps one source mesh's palette slot into `uv2.x`, before it is merged.
 *
 * **Before, because after is too late**: `MergeMeshes` concatenates vertex
 * buffers, so the index has to already be per vertex for the merge to carry it.
 * That is also what makes the whole scheme safe against interpolation — a merge
 * never re-triangulates, so every corner of a triangle keeps the index of the
 * mesh it came from.
 *
 * `uv2` and not the colour buffer, which has the room: the colour buffer is
 * written by `vertexShading.ts` AFTER every merge and from scratch, so a value
 * put there now would be overwritten by the bake, and teaching the bake to
 * preserve a channel would couple it to this. `uv2` is untouched by all of it.
 *
 * The all-or-nothing rule `CLAUDE.md` records for `colors` applies here too —
 * `VertexData.merge` throws when one mesh in a group has an attribute and
 * another does not — and it is kept by construction rather than by a check:
 * a mesh gets a slot exactly when it is going into the paletteised group, and
 * every mesh in that group got one.
 */
function writePaletteIndex(mesh: Mesh, slot: number): void {
  const count = mesh.getTotalVertices();
  const uv2 = new Float32Array(count * 2);
  // Only x is read. y is left at 0 rather than given a second meaning: the
  // slot's whole value is that it is the ONE thing this attribute says.
  for (let i = 0; i < count; i++) uv2[i * 2] = slot;
  mesh.setVerticesData(VertexBuffer.UV2Kind, uv2, false);
}

/**
 * Carries a merged group's sway mark onto the mesh, and takes Babylon's ink off
 * it.
 *
 * Both writes in one place because the second is a consequence of the first and
 * nothing must ever do one without the other — see the caller for why that
 * hull cannot follow a moving surface. What replaces it is `inkTwin`, below;
 * the mark is what both of them key on.
 */
function markSwayMerged(mesh: Mesh, layer: SwayLayer): void {
  marksSway(mesh, layer);
  mesh.metadata = { ...(mesh.metadata ?? {}), noOutline: true };
}

/**
 * The ink for one swaying mesh: an inverted hull sharing its geometry, drawn
 * through the cel shader's `CEL_INK` variant so it leans with the leaf.
 *
 * Returns null for everything that does not sway, which is the whole map bar
 * the foliage — Babylon's outline pass is still what draws the other 600-odd
 * meshes, and this is not a replacement for it.
 *
 * **The twin SHARES its source's `Geometry` rather than copying it**
 * (`Mesh.clone` hands the same instance to both), so eighty-odd of these cost
 * no vertex memory, no upload, and no second bake — and cannot fall out of step
 * with the surface, because there is only one buffer to fall out of step with.
 * What they do cost is one draw call each, which is still half of what the
 * outline pass was charging for the same meshes: Babylon renders an opaque
 * mesh's hull TWICE, once before it with depth-write off and once after with
 * colour-write off to repair the depth buffer.
 *
 * The four exemptions are not a precaution. A hull that cast a shadow would
 * lay a fattened copy of the canopy on the floor; one in the glow layer would
 * bloom the line; one carrying an outline of its own is the start of an
 * infinite regress; and one in a REFLECTION list is a room a cube probe is
 * parked inside, which comes back as six faces of flat ink — see
 * `ReflectionSystem`'s `opaqueWorld`, where the measurement is. That fourth one
 * was latent for as long as the foliage was the only thing twinned, because a
 * canopy is small and Greyfen glazes almost nothing; giving the whole village
 * twins is what made it the loudest thing in the frame.
 */
function inkTwin(mesh: Mesh, mats: CelMaterialFactory): Mesh | null {
  // Two callers now and one twin either way. A swaying mesh needs this because
  // Babylon's hull cannot see the wind; a paletteised one because that hull is
  // one colour per mesh and a merged block is many — see `mergeByMaterial`,
  // which sets the mark. A mesh that is both still gets exactly one twin, and
  // the twin's material is the same `getInk` answer in both cases.
  if (!swayLayerOf(mesh) && mesh.metadata?.inkTwin !== true) return null;
  const source = mesh.material;
  if (!source) return null;
  const twin = mesh.clone(`${mesh.name}-ink`, mesh.parent, true);
  if (!twin) return null;
  twin.material = mats.getInk(source.name);
  twin.metadata = {
    noOutline: true,
    noGlow: true,
    noShadowCaster: true,
    noReflect: true,
  };
  return twin;
}
