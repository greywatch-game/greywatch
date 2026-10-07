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
 * is one new layout file, and build() takes the layout, the environment and the
 * heightfield as arguments precisely so nothing here can reach for a named one.
 * Scatter runs off the layout's seeded RNG, never Math.random: blocking props
 * emit colliders, and colliders decide navigation.
 * The floor comes from a TerrainField built over the heightfield the CALLER
 * hands in — it is fetched rather than bundled and is no longer a field on the
 * layout (see `MapDef.heights`) — not a flat box, and every authored `y`
 * in the layout is an offset ABOVE it — so a building dropped into a basin
 * needs no bookkeeping. The floor mesh is the one place a visual and a
 * collider share vertices (an invisible clone per block); a heightfield has no
 * box to stand in for it, and splitting it per block is what keeps ray picks
 * rejecting it as cheaply as the old flat box did.
 * Builders arrive with PARTS (world/parts.ts) rather than ordinary meshes: no
 * device buffer under them, because uploading geometry a merge throws away was
 * half of a 1500 m build. So every path out of a merge that KEEPS its source
 * owes uploadPart() — the group-of-one hand-bake in mergeByMaterial and in
 * paneGroup, and the material-less mesh both of them skip. A part that reaches
 * the scene without it draws nothing and throws nothing. collider() is
 * deliberately NOT on that path: a part has no submeshes and moveWithCollisions
 * walks them.
 * `build(..., { editor: true })` keeps geometry per layout item, tags it with
 * metadata.editorRef and indexes it — at the cost of the BlockMerge pass and
 * roughly 10x the draw calls. Authoring only; never measure frame cost there.
 * The shapes it builds are `mapTypes.ts` and the merge passes it runs are
 * `merge.ts`; both are re-exported from here, so a reader may name either.
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
import { kindOf } from "../entities/vehicleKinds";
import { MAX_PALETTE, type CelMaterialFactory } from "../shaders/CelShader";
import { bakeVertexShading } from "./vertexShading";
import { begin as beginProfile, record, since } from "./buildProfile";
import type { LightingSystem } from "../systems/LightingSystem";
import type { AmbienceSystem } from "../systems/AmbienceSystem";
import type { AmbienceId, AmbienceKind } from "../core/Sfx";
import { BUILDERS, type BoxSpec, type Structure } from "./BuildingKit";
import type { EnvironmentSpec } from "./environment";
import { floorMaterial } from "./floorSurfaces";
import {
  isScatterRect,
  type Heightfield,
  type MapLayout,
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
import { roadNetwork, type RoadNetwork } from "./roadPaths";
import { MAX_HEIGHT_SCALE } from "./grassMask";
import { onRoad, type RoadFootprint, roadFootprint, roadTopAt } from "./roads";
import { TerrainField, terrainPatches, waterY } from "./TerrainField";
import { NavGrid } from "./NavGrid";
import { RayWorld } from "./RayWorld";
import { CollisionField } from "./CollisionField";
import { CoverMap } from "./CoverMap";
import { ObstacleField } from "./ObstacleField";
import { uploadPart } from "./parts";
import {
  BLOCK_SIZE,
  BlockMerge,
  flatten,
  mergeByMaterial,
  PaneBlocks,
  tag,
} from "./merge";
import type {
  BuildOptions,
  EditorIndex,
  EditorItem,
  GameMap,
  PaneGroup,
  WaterRect,
  WorldBox,
  WorldPane,
} from "./mapTypes";
import { mulberry32 } from "./rng";
import {
  buildAshTree,
  buildBamboo,
  buildLeafLitter,
  buildMaple,
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
  buildPalm,
  buildLog,
  buildPalletStack,
  buildPine,
  buildRubble,
  buildSkip,
  buildTrafficCone,
  RIM_WOOD,
} from "./props";

export type {
  BuildOptions,
  ControlPointDef,
  EditorIndex,
  EditorItem,
  EditorRef,
  GameMap,
  GrassRect,
  PaneGroup,
  SpawnPointDef,
  VehicleSpawnDef,
  WaterRect,
  WorldBox,
  WorldPane,
} from "./mapTypes";
export { BLOCK_SIZE } from "./merge";

/**
 * One scatter prop's factory.
 *
 * **Typed rather than inferred, and the fourth argument is why.** Only
 * `buildJungleTree` reads `sub`, and a `Record` of the builders as written
 * would be a UNION of their signatures — which a four-argument call cannot
 * satisfy, because most members declare three. The fifth is the same story
 * for `buildAshTree`, `buildMaple` and `buildJungleTree`, the readers of
 * `foliage`. Widening the whole table instead is free: a builder that ignores
 * the stream is assignable to a type that offers it, and a builder that wants
 * one now has a place to say so.
 */
type ScatterBuilder = (
  scene: Scene,
  mats: CelMaterialFactory,
  rng: () => number,
  sub: () => number,
  foliage: number,
) => Mesh;

/**
 * Scatter props, keyed by the name the layout data uses. Exported for
 * `npm run kit:hash`, which fingerprints every one of them; nothing in the
 * game reaches for it outside this file.
 */
export const SCATTER_BUILDERS: Record<ScatterSpec["prop"], ScatterBuilder> = {
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
  palm: buildPalm,
  maple: buildMaple,
  leafLitter: buildLeafLitter,
  bamboo: buildBamboo,
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

/**
 * Sustained SOUNDS carried by scatter props, and the twin of `SCATTER_LIGHTS`
 * directly above it in every way that matters — a side table keyed by prop
 * kind, so a prop that makes a noise says so in one place and nothing about
 * the placement, the seeding or the collider has to be told.
 *
 * **Kept sparse for a different reason than the lights are.** A light costs a
 * shader slot and the nearest sixteen win; a fire costs a held-open audio
 * graph and the nearest THREE win (`CONFIG.audio.ambience.maxVoices`), so the
 * budget is tighter and the ranking that spends it is `AmbienceSystem`'s. What
 * a row here decides is only which props are CANDIDATES.
 *
 * `y` is metres above the prop's base, scaled with it: the drum's flame rather
 * than the drum, which is a metre of fire rooted in the coals of a 1.2 m barrel.
 */
const SCATTER_AMBIENCE: Partial<
  Record<ScatterSpec["prop"], { kind: AmbienceId; y: number }>
> = {
  fireDrum: { kind: "fire", y: 0.9 },
};

/**
 * What each ambience id actually sounds like — the ONE place the world layer
 * and the audio config meet.
 *
 * A `Record` over the id union rather than a lookup that could miss, for the
 * reason `ViewModel`'s `WEAPON_BUILDERS` and the optics table are: a second
 * kind does not compile half-added. It is here rather than in `Sfx` because
 * this is the file that already reads `CONFIG` on the world's behalf, and it
 * is what lets a building kit say `b.sound("fire", …)` without knowing the
 * audio config exists.
 */
const AMBIENCE_KINDS: Record<AmbienceId, AmbienceKind> = {
  fire: CONFIG.audio.ambience.fire,
  stream: CONFIG.audio.ambience.stream,
  shore: CONFIG.audio.ambience.shore,
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
  /**
   * This prop GROWS out of the ground, so it may not be sown on a road.
   *
   * The line is what a thing IS, not how big it is and not whether it blocks:
   * a tree, a shrub, a fern, a toadstool. Everything else in the table is
   * something people PUT there — rubble, a barrel, a cone, a skip, a drifted
   * boulder, a headstone in a graveyard — and a street is exactly where half
   * of those belong, which is why this is a per-PROP fact and not a per-region
   * flag. A belt of trees down one side of a road wants to be held off the
   * carriageway; the litter region over the same junction wants nothing of the
   * sort, and neither should have to say so.
   *
   * Read by `findSpot` against the layout's roads, padded by the prop's own
   * half-footprint so a crown may overhang what a bole may not stand in. See
   * `world/roads.ts`.
   */
  rooted?: true;
}

/**
 * Every scatter prop's body at scale 1, measured off the builders in
 * `world/props/`. The collider box is `w`/`d`/`h`, oriented with the prop.
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
 * Keep these honest against `world/props/`. Too small only costs a round
 * clipping through a silhouette; too large costs shots that visibly should have
 * landed.
 *
 * Exported for `npm run kit:hash`, whose COLLIDER half of a scatter kind's
 * fingerprint is this row — the box is the table's, not the builder's.
 */
export const PROP_BODIES: Record<ScatterSpec["prop"], PropBody> = {
  // Trunk only, at roughly its width around chest height (a 0.26 m radius,
  // furrows and lean inside the box to head height — see `buildDeadTree`).
  // The limbs leave it overhead and the twigs are a centimetre or two thick —
  // nothing should stop on one.
  deadTree: { w: 0.7, d: 0.7, h: 5.2, visualTop: 5.4, rooted: true },
  // The bole only, at the width it presents around chest height — it tapers
  // 0.68 -> 0.44 over 7.6 to 9.2 m, and the frond scars stand 0.05 m proud of
  // that. The crown is five metres of frond starting at eight and is
  // deliberately outside this, harder than for any other tree in the table: a
  // grove is meant to screen a roof and not a body, and a box that held the
  // crown would stop rounds through the open air a palm grove IS. Full bole
  // height, so it bakes as hard cover (CoverMap's 1.7 m) the way a wall does.
  // `visualTop` clears a frond arching over the head of the bole.
  palm: { w: 0.66, d: 0.66, h: 7.6, visualTop: 10.4, rooted: true },
  // Trunk only, same as the dead tree — the crown is 3.3 m of needles and
  // stopping rounds on it would give the map its one piece of cover you can see
  // daylight through. The builder keeps the lowest tier above the 1.7 m hit
  // sphere so nothing shootable hides in there. `visualTop` clears the tip.
  pine: { w: 0.62, d: 0.62, h: 6.4, visualTop: 7.0, rooted: true },
  // Trunk only again, at its width around chest height rather than at the
  // flare it stands on: it tapers 0.76 -> 0.30 over 8.6 m, so 0.68 is what a
  // round arriving at 1.7 m actually meets. The crown is 5.8 m of leaf
  // starting at 3.9 and is deliberately outside this — the pine's rule, and
  // this tree has three times the leaf to get it wrong with. Full trunk
  // height, so a hedgerow standard bakes as hard cover (CoverMap's 1.7 m) the
  // way a wall does. `visualTop` clears the cap plate.
  ashTree: { w: 0.68, d: 0.68, h: 8.6, visualTop: 9.9, rooted: true },
  // The bole to the fork, at its width around chest height (0.42 -> 0.38 from
  // 0.25 to 1.6 m, inside the box with its lean). The crown is three and a
  // half metres of leaf from 2.6 m up and is outside this for the ash's reason;
  // the limbs leave the box at the fork, over every head. 3.4 m clears
  // CoverMap's 1.7 m, so a maple bakes as hard cover the way every other tree
  // does.
  maple: { w: 0.46, d: 0.46, h: 3.4, visualTop: 7.2, rooted: true },
  // Never blocking — a drift of leaves is 3 cm deep — so w/d/h are never read
  // and are filled honestly for the fern's reason. `visualTop` IS read. NOT
  // rooted: leaves are something that LANDS, and a stone path under the
  // maples with the leaves on it is the reference frame's whole foreground.
  leafLitter: { w: 1.7, d: 1.7, h: 0.04, visualTop: 0.05 },
  // Never blocking: a clump is ten-centimetre culms and air (see
  // `buildBamboo`). Filled honestly for the fern's reason.
  bamboo: { w: 1.6, d: 1.6, h: 8, visualTop: 10.5, rooted: true },
  // Trunk plus its buttress core: the bole, its flare and flutes stay inside
  // the box's 0.5 m half-width from 0.4 m up, and what of the buttresses is
  // outside it is LOW — under a metre at the box's corner and a surface root
  // under 0.3 m past it, out to ~1.6 m (see `buildJungleTree`). The crown is
  // fronds from ~11.35 m down to ~6.5 m and six out, and is not in this —
  // there is nothing to shoot up there, and a box that held it would stop
  // rounds through open air across the whole stand. Full trunk height, so a
  // jungle tree bakes as hard cover (CoverMap's 1.7 m) the way a wall does.
  jungleTree: { w: 1.0, d: 1.0, h: 11.2, visualTop: 11.6, rooted: true },
  // Never blocking, so w/d/h are never read — filled honestly anyway, because
  // this is a Record and a lie here would be believed the day someone sets
  // `blocking` on a fern. `visualTop` IS read: findSpot's burial check runs for
  // every prop, blocking or not. The reasoning for keeping ferns walk-through
  // is in buildFernClump.
  fernClump: { w: 1.7, d: 1.7, h: 1.0, visualTop: 1.2, rooted: true },
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
  fungus: { w: 0.8, d: 0.8, h: 0.9, visualTop: 1.1, rooted: true },
  // Heap plus the chunks piled on it. The rebar is a 6 cm rod sticking out to
  // 1.8 m and is not in this — you do not lose a round to a piece of wire.
  rubble: { w: 1.9, d: 1.7, h: 1.05, visualTop: 1.5 },
  // The drum. NOT the flame above it, which is emissive and stands 0.9 m over
  // the rim, nor the billets, flap and woodpile drawn round it (`buildFireDrum`).
  fireDrum: { w: 0.95, d: 0.95, h: 1.25, visualTop: 2.1 },
  // Oriented, along the stone's own X and Z. The stone is DRAWN to this box
  // rather than the box measured off the stone (see `buildBoulder`): its
  // chiselled waist is ON these half-widths at the median and past them by
  // under 0.16 m in nine in ten (the octahedron stood 0.15 m past them every
  // time), and its top is held at or over `h`, so a round stops on rock and
  // never on air over it. Height stays where it was so a large boulder still bakes as hard
  // cover (CoverMap's 1.7 m).
  boulder: { w: 2.1, d: 1.9, h: 1.45, visualTop: 1.4 },
  bramble: { w: 0.8, d: 0.8, h: 1.2, visualTop: 1.6, rooted: true },
  // The cask's bilge, to a centimetre. NOT the hoop an open one has lost,
  // lying 4.5 cm high on the ground beside it (`buildBarrel`).
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
 * What a collider box bounces when nothing it stands in for has a single
 * colour to read — mid grey, claiming nothing about the structure.
 */
const NEUTRAL_ALBEDO: readonly [number, number, number] = [0.5, 0.5, 0.5];

/**
 * What one `build` hands its phases: what they read, and the lists they fill.
 * Lives for one call and is never kept — every field that outlasts a build is
 * on the `GameMap` it returns.
 */
interface BuildRun {
  layout: MapLayout;
  terrain: TerrainField;
  /** Becomes `GameMap.visuals`. */
  visuals: Mesh[];
  /** Becomes `GameMap.colliders`. */
  colliders: Mesh[];
  /** The opaque block merge, fed by the placements and the scatter. */
  blocks: BlockMerge;
  /** The glazing's own, fed by the placements. See `PaneBlocks`. */
  paneBlocks: PaneBlocks;
  /** Per-item geometry, on editor builds only — `GameMap.editor`. */
  index: EditorIndex | undefined;
}

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
    private ambience: AmbienceSystem,
  ) {}

  /** World-space collider boxes, accumulated by `collider()` during a build. */
  private boxes: WorldBox[] = [];
  /**
   * `r, g, b` per entry of `boxes`, pushed by `recordBox` beside it — see
   * `GameMap.colliderAlbedo`. `albedoHint` is what the NEXT box recorded is
   * painted: set per structure and per scatter prop from its own meshes, so
   * a box answers with the colour of what it stands in for.
   */
  private boxAlbedo: number[] = [];
  private albedoHint: [number, number, number] = [...NEUTRAL_ALBEDO];
  /** Every placement's visual parts near the ground — see `GameMap.partBoxes`. */
  private partBoxes: WorldBox[] = [];

  /**
   * The `strut` boxes, grouped by the placement whose collider mesh they were
   * merged into. Deliberately NOT in `boxes` — nothing derived from geometry
   * (nav, cover, obstacles, AO, scatter) may see them. See `struts()`.
   */
  private rayGroups: WorldBox[][] = [];
  private boxGroups: number[][] = [];
  /** Scatter boxes recorded, not yet given geometry — see `placeScatter`. */
  private pendingCluster: number[] = [];
  /**
   * Ground a ROOTED scatter prop may not grow out of: every road on the
   * layout. Rebuilt per `build`, and read only by `findSpot`.
   */
  private roads: RoadFootprint = roadFootprint([], []);
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
   * How full a tree's crown is in this build — `BuildOptions.foliage`, set
   * at the top of every `build` and handed to every scatter builder.
   */
  private foliage = 1;

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
   * Drops everything the last build left in this builder's own fields — the
   * boxes, the panes, the groups, the roads, the box index — which `build`
   * hands to the `GameMap` and would otherwise keep until the next one resets
   * them, which it does by calling this (`reset`). `Game.teardownMap`, for
   * the menu.
   */
  release(): void {
    this.boxes = [];
    this.boxAlbedo = [];
    this.partBoxes = [];
    this.rayGroups = [];
    this.boxGroups = [];
    this.pendingCluster = [];
    this.paletteColors = [];
    this.paletteSlots.clear();
    this.keepClear = [];
    this.panes = [];
    this.paneGroups = [];
    this.roads = roadFootprint([], []);
    this.boxIndex = emptyBoxIndex(CONFIG.map.size, 0);
    this.item = null;
  }

  /**
   * Builds a map. The layout, the environment and the FLOOR are arguments, not
   * imports: a second map is a second layout file and nothing here changes.
   *
   * `heights` is separate from `layout` because it no longer travels on one —
   * it is fetched rather than bundled (`MapDef.heights`), so the caller is the
   * one holding it by the time there is anything to build. `undefined` is a
   * level floor, exactly as an absent field always was.
   *
   * The phases run in a load-bearing order, one method each: the floor, the
   * placements, the scatter, the merges, the bake, then everything derived from
   * the finished collider set.
   */
  build(
    layout: MapLayout,
    env: EnvironmentSpec,
    heights: Heightfield | undefined,
    opts?: BuildOptions,
  ): GameMap {
    // Where the time behind the loading card goes. DEV-only, a no-op in a
    // production build, and an ATTRIBUTION rather than a partition: `build`
    // times itself whole and names the parts worth naming under it, so the
    // remainder is what is left over. See `buildProfile.ts`, and
    // `ENGINE_UPGRADE.md` S0 for what it found — 87% of a 1500 m build was the
    // placement loop in `placeStructures`, before the flatten in `parts.ts`.
    beginProfile();
    const buildStart = performance.now();
    // The map's own extent, not the global — a village and a downtown are not
    // the same size. Everything downstream already took it as an argument; it
    // reaches them from here and is carried on `GameMap.size` for the readers
    // (the minimap, the deploy map, the editor) that meet a built map instead.
    const size = layout.size ?? CONFIG.map.size;
    // How the map is CUT, and it is two numbers rather than one. `blockSize`
    // is what the second merge groups structures over — draw calls and cull
    // granularity — and `terrainBlock` is what the floor is tessellated over,
    // which is a question about the heightfield's cell and the triangles in a
    // patch. They were the same constant until a 1500 m map made 48 m mean
    // 1,024 blocks; they default to it independently now, so a map that states
    // neither builds exactly what it always did. See `MapLayout.blockSize`.
    const blockSize = layout.blockSize ?? BLOCK_SIZE;
    const terrainBlock = layout.terrainBlock ?? BLOCK_SIZE;
    // A view onto the floor's own blocks within `colliders` — see GameMap.
    const terrainColliders: Mesh[] = [];
    // The carriageways, derived before anything is built because `findSpot`
    // asks about them and the scatter pass runs after the placement loop that
    // draws them. Nothing else about a road changes: it is still visual-only,
    // still emits no collider, and is still invisible to every ray, to the nav
    // grid and to cover. See `world/roads.ts`.
    //
    // A road with a `path` is resolved as a NETWORK first, because where it
    // stops depends on what it meets: the strip each such placement draws and
    // the junctions it owns are handed to its builder in `placeStructures`,
    // and the footprint of all of it is what `findSpot` and the grass ask. See
    // `world/roadPaths.ts`.
    const network: RoadNetwork = roadNetwork(layout.placements);
    this.reset(layout, env, size, network, opts);
    // One stream for the whole build, so scatter regions stay reproducible in
    // authored order. Seeding per region would be stabler under editing but
    // would let two regions with the same seed sample identically.
    const rng = mulberry32(this.propSeed);

    // How far the ground carries on past the play square, and therefore where
    // the boundary actually is. Zero on a map closed by the rim, which no
    // shipped map is any more — see `MapLayout.borderland`.
    const margin = layout.borderland?.margin ?? 0;
    const terrain = this.floorFor(layout, heights, size, margin);
    const run: BuildRun = {
      layout,
      terrain,
      visuals: [],
      colliders: [],
      // One size, handed to both, because `ReflectionSystem.encloses` asks a
      // glazing group and the wall behind it whether they are the same
      // building by comparing the two keys. See `PaneBlocks`.
      blocks: new BlockMerge(blockSize),
      paneBlocks: new PaneBlocks(blockSize),
      index:
        opts?.editor === true ? { placements: [], scatter: [] } : undefined,
    };
    const { visuals, colliders, index } = run;
    record("valley", () =>
      this.buildValley(run, size, margin, terrainBlock, env, terrainColliders),
    );

    this.placeStructures(run, network);
    this.placeScatter(run, rng);

    // What the water sounds like, and where from. Off the FLOOR rather than
    // off the rect, and after everything else because it consumes no RNG and
    // touches nothing — see `waterAmbience`. The reach handed to it is all the
    // ground there is: the play square plus whatever borderland continues it.
    record("waterAmbience", () =>
      this.waterAmbience(layout.water ?? [], terrain, size / 2 + terrain.margin),
    );

    this.mergeBlocks(run);
    this.bake(run, size);
    const { nav, cover, obstacles, rays, collidables } = this.derive(run, size);
    since("build:total", buildStart);

    return {
      size,
      margin,
      blockSize,
      terrainBlock,
      nav,
      cover,
      obstacles,
      rays,
      collidables,
      controlPoints: layout.controlPoints,
      spawns: layout.spawns,
      vehicleSpawns: layout.vehicles ?? [],
      colliders,
      colliderBoxes: this.boxes,
      colliderAlbedo: Float32Array.from(this.boxAlbedo),
      partBoxes: this.partBoxes,
      rayGroups: this.rayGroups,
      boxGroups: this.boxGroups,
      panes: this.panes,
      paneGroups: this.paneGroups,
      terrainColliders,
      visuals,
      water: layout.water ?? [],
      grass: layout.grass ?? [],
      roads: this.roads,
      terrain,
      editor: index,
      dispose: () => {
        for (const m of visuals) m.dispose();
        for (const m of colliders) m.dispose();
        this.lighting.clear();
        this.ambience.clear();
      },
    };
  }

  /**
   * Puts every per-build field back to a fresh map's, and seeds the ones this
   * layout decides. `release` is the empty half, so the list of what a build
   * resets is the list of what a teardown drops and cannot drift from it.
   */
  private reset(
    layout: MapLayout,
    env: EnvironmentSpec,
    size: number,
    network: RoadNetwork,
    opts: BuildOptions | undefined,
  ): void {
    this.release();
    // The rim and the ground plane's stand-ins are the floor as far as a
    // bounce is concerned, so the valley pass records its boxes in its colour.
    this.setAlbedoHint(Color3.FromHexString(env.floorColor));
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
      // …and the radius is the hull's OWN half-length, so a truck's
      // hardstanding is cleared to a truck and not to a tank. Deriving it from
      // whatever kind stands here rather than from the biggest is what keeps a
      // small vehicle's pad from rejecting scatter candidates it has no reason
      // to — which on a seeded field is not a tidiness point: one extra
      // rejection re-rolls every prop drawn after it.
      ...(layout.vehicles ?? []).map((v) => ({
        x: v.pos.x,
        z: v.pos.z,
        r: kindOf(v.kind).spec.hull.length / 2 + 1.5,
      })),
    ];
    this.roads = network.footprint;
    // Sized to the widest burial test this layout will run. `findSpot` asks
    // about `(spec.clearance ?? 0.8) * scale`, and `scale` tops out at the
    // upper end of the spec's own range — so the layout knows the answer before
    // a single box exists, which is the only moment the index can be told.
    this.boxIndex = emptyBoxIndex(size, maxScatterClearance(layout));
    this.propSeed = layout.seed ?? 0x484c;
    this.foliage = opts?.foliage ?? 1;
  }

  /** The floor this build stands everything on — see `TerrainField`. */
  private floorFor(
    layout: MapLayout,
    heights: Heightfield | undefined,
    size: number,
    margin: number,
  ): TerrainField {
    // The one thing the two halves of a map owe each other that the compiler
    // can no longer see. `Heightfield.cell`'s contract is that `size * cell`
    // IS the map's extent, and `TerrainField` takes its own half-extent from
    // the grid for exactly that reason — so a pair that disagrees samples the
    // floor against the wrong origin, reads the wrong row of heights
    // everywhere, and throws nothing. It used to be unmissable because the
    // layout imported its own heights module; they are separate files reaching
    // here by separate routes now (see `MapDef.heights`), so it is asserted.
    if (import.meta.env.DEV && heights) {
      const span = heights.size * heights.cell;
      if (Math.abs(span - size) > 1e-6) {
        throw new Error(
          `heightfield is ${heights.size} x ${heights.cell} m = ${span} m over ` +
            `a ${size} m map — see Heightfield.cell. The wrong map's heights?`,
        );
      }
    }
    return new TerrainField(
      heights,
      margin,
      layout.borderland?.roll,
      layout.borderland?.ease,
    );
  }

  /**
   * The authored structures: every placement built, merged per material and
   * filed under its map block, with its colliders, struts, glazing, lights and
   * sounds — then the roads, merged on their own.
   */
  private placeStructures(run: BuildRun, network: RoadNetwork): void {
    const { layout, terrain, visuals, colliders, blocks, paneBlocks, index } =
      run;
    // Roads are merged into one draw call per material so overlapping junctions
    // (the central cross, etc.) don't z-fight between separate meshes.
    const roadParts: Mesh[] = [];
    const placementsStart = performance.now();
    for (const [i, p] of layout.placements.entries()) {
      const item = index ? newItem(index.placements) : null;
      this.item = item;
      // An authored y is an offset above the local floor, not an absolute
      // height, so a placement keeps its meaning when the ground under it moves.
      const floor = terrain.heightAt(p.x, p.z);
      const origin = new Vector3(p.x, (p.y ?? 0) + floor, p.z);
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
        floor,
        z: p.z,
        rotY,
        road:
          isRoad && p.params?.path
            ? { strip: network.strips.get(i), joins: network.joins.get(i) ?? [] }
            : undefined,
        roads: isRoad ? network.footprint : undefined,
      });
      // What light bounces off this structure's boxes: the average of what it
      // is painted, weighted by how much of each there is. Taken HERE, before
      // the merge below disposes these meshes — what it hands back wears the
      // palette material, which has no single colour to read.
      this.albedoFromMeshes(s.meshes);
      // …and where its parts stand, for the same reason and against the same
      // deadline: after the merge there is no part left to ask. A road is not
      // asked at all — its footprint is `this.roads`, which feathers the grass
      // into the verge where a box would cut it off square.
      if (!isRoad) this.recordParts(s, origin, rotY, terrain);

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
            // Roads are NOT outlined, here or in play — see the road merge
            // below for the whole of why. The editor found it first and for a
            // narrower reason (unmerged, each road's shell is drawn over
            // whatever it overlaps, which is a black patch at every junction);
            // the selection highlight shows a road's extent instead.
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
      // …and whatever the structure makes a noise about, through the same
      // rotation and the same origin. A placement can be turned, so a sound
      // hung off one is a LOCAL point exactly as a light is — the brazier on
      // the far side of a watchtower has to end up on the far side of it.
      for (const snd of s.sounds) {
        const at = rotateY(snd.x, snd.y, snd.z, rotY).addInPlace(origin);
        this.ambience.add(at.x, at.y, at.z, AMBIENCE_KINDS[snd.kind]);
      }
    }
    this.item = null;
    since("placements", placementsStart);

    for (const merged of record("roadMerge", () =>
      mergeByMaterial(roadParts, "roads"),
    )) {
      // Flat ground sheets receive shadows, never cast them.
      merged.metadata = { ...(merged.metadata ?? {}), noShadowCaster: true };
      // **AND NO ROAD IS INKED**, which is the same sentence one line up rather
      // than a second exemption: a sheet lying on the ground has no silhouette
      // to cast a shadow from and none to draw a line round either. Nothing has
      // to ENFORCE that now — `CelInk` finds an edge where depth steps or
      // bends, and two coplanar sheets do neither — but it was enforced here,
      // and the reason is worth keeping because it is what a per-mesh ink costs
      // on flat ground. A shell expanded 5 cm along its own normals and drawn
      // with depth write ON puts a road's ink in the depth buffer 5 cm above
      // its own carriageway, so anything else at road height is BEHIND a
      // surface nobody can see. Lane markings hit that first and were given
      // `noInk` for it (see `buildRoad`); a road CROSSING a road was the same
      // fact, and it painted every junction between two surfaces solid black —
      // measured on Sarab, where the ink of whichever mesh the front-to-back
      // sort drew second covered the whole intersection, and no amount of lift
      // fixed it because the shell rode with the slab.
      visuals.push(merged);
    }
  }

  /**
   * The scattered dressing, region by region off the one shared stream — then
   * every region's blocking props clustered into collider meshes at once.
   */
  private placeScatter(run: BuildRun, rng: () => number): void {
    const { layout, terrain, visuals, colliders, blocks, index } = run;
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
  }

  /**
   * The second merge pass, over the opaque world and then over the glazing,
   * and the palette the first of them discovers.
   */
  private mergeBlocks(run: BuildRun): void {
    const { visuals, blocks, paneBlocks } = run;
    // One more merge across neighbouring structures — see BlockMerge. This is
    // the ONE merge that paletteises, which is also what exempts the editor for
    // free: an editor build files its meshes on the item instead and never
    // reaches this pass at all (see the `item` branch in `placeStructures`).
    for (const merged of record("blockMerge", () =>
      blocks.finish({
        slot: (hex) => this.paletteIndex(hex),
        material: this.mats.getWorldCel(),
      }),
    )) {
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
        noInk: true,
        noShadowCaster: true,
      };
      visuals.push(merged);
    }
  }

  /**
   * The vertex-colour bake and the freeze, over every visual the merges left.
   */
  private bake(run: BuildRun, size: number): void {
    const { terrain, visuals } = run;
    // The vertex-colour bake — occlusion, the world mark and the wind's sway
    // weight — and its position in `build` is the whole of it.
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
    record("markVisual", () => {
      for (const m of visuals) this.markVisual(m);
    });
  }

  /**
   * Everything derived from the finished collider set: the nav graph and its
   * flow fields, cover, the obstacle field, and the two query indexes.
   */
  private derive(
    run: BuildRun,
    size: number,
  ): Pick<GameMap, "nav" | "cover" | "obstacles" | "rays" | "collidables"> {
    const { layout, terrain, colliders } = run;
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
    // And the same collider set indexed for a LINE. It reads `rayGroups` as
    // well as `boxes`, so it is built after the placements rather than beside
    // them — a strut group added later would be geometry no round could find.
    const rays = record(
      "rayWorld",
      () => new RayWorld(size, this.boxes, this.rayGroups, terrain),
    );
    // …and the same set indexed for a SWEEP. Off the finished MESHES rather
    // than off `boxes`, which is the one thing here that cannot be derived from
    // geometry: what `moveWithCollisions` walks is the merged collider meshes,
    // and a cluster of a scatter region's props is one of those and twelve of
    // the other. The floor and the struts are in `colliders` and carry no
    // `checkCollisions`, so the constructor drops them for free.
    const collidables = record(
      "collisionField",
      () => new CollisionField(colliders),
    );
    return { nav, cover, obstacles, rays, collidables };
  }

  /** The valley floor plus the rim that bounds play. */
  private buildValley(
    run: BuildRun,
    size: number,
    /** `Borderland.margin`, or 0 on a map closed by the rim. */
    margin: number,
    /** `MapLayout.terrainBlock`, or `BLOCK_SIZE` — the floor's own cut. */
    terrainBlock: number,
    env: EnvironmentSpec,
    /** The floor's blocks alone — see `GameMap.terrainColliders`. */
    terrainColliders: Mesh[],
  ): void {
    const { terrain, visuals, colliders } = run;
    const ridge = run.layout.ridge;
    const floorMat = floorMaterial(
      this.mats,
      this.scene,
      env.floorColor,
      env.floorSurface,
    );
    for (const patch of record("terrainPatches", () =>
      terrainPatches(terrain, size, terrainBlock),
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
      if (seg.tone === "scree" || seg.tone === "rock") {
        mesh.material = this.mats.get(
          seg.tone === "scree" ? env.ridgeScreeColor : env.ridgeColor,
        );
      } else {
        // The woods on a rolling rim, in the near trees' own paint. They go
        // into `visuals` like the rock, so the vertex bake gives them the same
        // colour buffer the merged pines carry — which is what makes sharing
        // the pines' cached material safe (see `CelMaterialFactory.remember`).
        const wood = RIM_WOOD[seg.tone];
        mesh.material =
          wood.trans === null
            ? this.mats.get(wood.hex)
            : this.mats.getTranslucent(
                wood.hex,
                CONFIG.graphics.translucency[wood.trans],
              );
      }
      // A 20-45 m crest throws 26-58 m of shadow at the moon's 38 deg, and the
      // shadow window is a fixed 110 m square that follows the player — so a
      // casting rim would end its shadow in a hard line that slides across open
      // ground as you walk. It is a receiver only.
      mesh.metadata = { noShadowCaster: true };
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
  /**
   * Registers what every body of water on the map sounds like, and WHERE FROM.
   *
   * **A lake makes no noise in the middle of itself.** What is audible is its
   * edge, so an emitter at a rect's centre is wrong in a way that gets worse
   * the bigger the rect is: Cinderhaven's bay rect is 1,380 m across and its
   * centre is four hundred metres of open water from any beach, while the rect
   * CONTAINS the island, so a listener standing in the middle of the town
   * would be at zero distance from it. Both failures are the same failure — a
   * `WaterRect` is an EXTENT and the edge is not in it anywhere.
   *
   * **So the waterline is derived from the FLOOR, which is the rule
   * Cinderhaven's own generator already runs on** (`docs/world.md`: a
   * waterfront is derived from the floor rather than authored against it).
   * Each rect is marched on a `CONFIG.audio.ambience.shorelineStep` grid, and
   * a flooded cell with an unflooded four-neighbour is a point on the line.
   * The consequences all fall out rather than being coded: a 6.6 m creek is
   * waterline along its whole length because every cell of it is within a step
   * of a bank, a basin dug in flat ground gives its rim, and a sheet laid on
   * flat moor gives the rectangle it actually stops at.
   *
   * **FLOODED IS ASKED OF THE WHOLE LIST AND NOT OF ONE RECT, and both halves
   * of that were found by getting it wrong.** Asked of the terrain alone, a
   * pool whose surrounding moor lies below its own surface has no edge
   * anywhere and falls silent — Hollowmere's mire did. Asked of one rect's
   * bounds, the SEAM between two rects of one sea reads as a shore, and
   * Cinderhaven's water is a pinwheel of eight whose inner four meet in open
   * water. Water is the UNION of the rects, and its edge is where that union
   * ends — whether because the bed rises out of it or because the sheet
   * simply stops.
   *
   * **And past the floor there is no edge, only the end of the world.** Beyond
   * `reach` — the play square plus its borderland, which is all the ground
   * there is — an unflooded neighbour is not a shore, it is a query
   * `TerrainField` answered by clamping. Without that rule Cinderhaven's outer
   * ring of ocean, which exists only to put a horizon past the fog, would
   * contribute some 1,300 points of waterline at 2,300 m from anything that
   * can hear, to be scanned every frame for the life of the map.
   *
   * **A BODY of water is one emitter, and a body is a CONNECTED GROUP of
   * rects rather than a rect.** How water is drawn and what it is are
   * different questions: Cinderhaven's sea is eight rects because a rect's bed
   * map is 512 texels a side however big it is and because each one stands a
   * reflection probe, and none of that makes it eight seas. Left as eight it
   * would also spend the budget as eight — two or three of them win the
   * ranking together anywhere near the island's west coast, where their edges
   * meet, and a brazier on the quay behind you loses its slot to a second copy
   * of the same water. Rects are joined when they touch AND agree about what
   * they sound like, so a mill race running into a pond stays two things you
   * can hear at once while a partitioned sea is one.
   *
   * A point sits at the water's SURFACE rather than on the bed, because that
   * is where the noise is made: a wadi pool six metres down is heard from six
   * metres down.
   *
   * It runs after everything else in `build`, takes no RNG and writes nothing
   * but the registry, so it cannot move a prop or a collider by existing —
   * which is what keeps it out of `npm run collision`'s business.
   */
  private waterAmbience(
    rects: readonly WaterRect[],
    terrain: TerrainField,
    reach: number,
  ): void {
    const step = CONFIG.audio.ambience.shorelineStep;
    // Each rect's surface height, resolved once: `waterY` is a `heightAt` and
    // the predicate below runs five times per sampled cell.
    const surfaces = rects.map((r) => waterY(r, terrain));
    const flooded = (x: number, z: number): boolean => {
      if (Math.abs(x) > reach || Math.abs(z) > reach) return true;
      for (let i = 0; i < rects.length; i++) {
        const o = rects[i];
        if (Math.abs(x - o.x) > o.width / 2) continue;
        if (Math.abs(z - o.z) > o.depth / 2) continue;
        if (terrain.heightAt(x, z) < surfaces[i]) return true;
      }
      return false;
    };
    // Which body each rect belongs to, by union-find over "touches, and
    // agrees about what it sounds like". `step` of slack because Cinderhaven's
    // rects abut exactly and a float comparison on a shared edge is a coin
    // toss.
    const body = rects.map((_, i) => i);
    const find = (i: number): number => {
      while (body[i] !== i) i = body[i] = body[body[i]];
      return i;
    };
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        if ((a.sound ?? "shore") !== (b.sound ?? "shore")) continue;
        if (Math.abs(a.x - b.x) > (a.width + b.width) / 2 + step) continue;
        if (Math.abs(a.z - b.z) > (a.depth + b.depth) / 2 + step) continue;
        const ra = find(i);
        const rb = find(j);
        if (ra !== rb) body[rb] = ra;
      }
    }

    const lines = new Map<number, number[]>();
    for (let k = 0; k < rects.length; k++) {
      const r = rects[k];
      const surface = surfaces[k];
      const root = find(k);
      let line = lines.get(root);
      if (!line) lines.set(root, (line = []));
      // Cell CENTRES, so a rect narrower than one step still gets its middle
      // line sampled rather than nothing — Hollowmere's creek is 6.6 m wide.
      const nx = Math.max(1, Math.round(r.width / step));
      const nz = Math.max(1, Math.round(r.depth / step));
      for (let i = 0; i < nx; i++) {
        const x = r.x - r.width / 2 + ((i + 0.5) * r.width) / nx;
        if (Math.abs(x) > reach) continue;
        for (let j = 0; j < nz; j++) {
          const z = r.z - r.depth / 2 + ((j + 0.5) * r.depth) / nz;
          if (Math.abs(z) > reach) continue;
          if (terrain.heightAt(x, z) >= surface) continue;
          if (
            flooded(x - step, z) &&
            flooded(x + step, z) &&
            flooded(x, z - step) &&
            flooded(x, z + step)
          ) {
            continue;
          }
          line.push(x, surface, z);
        }
      }
    }
    // In the layout's own order, so an emitter's INDEX — which is the key
    // `Sfx` holds a graph on — is a property of the file rather than of a Map's
    // iteration.
    for (let k = 0; k < rects.length; k++) {
      if (find(k) !== k) continue;
      this.ambience.addRun(lines.get(k) ?? [], AMBIENCE_KINDS[rects[k].sound ?? "shore"]);
    }
  }

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
    const sound = SCATTER_AMBIENCE[spec.prop];
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
      const spot = this.findSpot(spec, terrain, rot, clearance, scale, placed, rng);
      if (!spot) continue;
      placed.push({ x: spot.x, z: spot.z, r: clearance });

      // Sampled per prop, not per region: a stand of trees straddling a bank
      // should follow the bank rather than share one height and float. Stored
      // relative to the region's own floor, since that is what the transform
      // below adds back.
      //
      // **A prop sown on a road stands on the ROAD.** The floor is what
      // `TerrainField` answers with and a carriageway is a sheet lying on top
      // of it, so without the lift a scrap of blown litter — twelve millimetres
      // tall — is half buried in the first street it lands in, and the surface
      // RANKS (`world/roads.ts`) that settle a junction would bury it outright.
      // Nothing rooted can be here at all: `findSpot` keeps that off the
      // carriageway, and what is left is exactly the dressing a street is for.
      const base =
        (spec.y ?? 0) +
        terrain.heightAt(spot.x, spot.z) +
        roadTopAt(this.roads, spot.x, spot.z) -
        origin.y;

      // The prop's own stream, keyed to where it sits in the layout rather
      // than to how much has been drawn before it — see `propSeed`. Minted
      // per prop and not per region so that changing a region's `count`
      // leaves the props it still places drawing what they drew.
      const sub = mulberry32(this.propSeed ^ (index * 7919 + i));
      const prop = build(this.scene, this.mats, rng, sub, this.foliage);
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
      const flat = flatten(prop);
      // Its box, if it gets one, bounces light in its own colours.
      if (spec.blocking) this.albedoFromMeshes(flat);
      parts.push(...flat);

      if (light) {
        this.lighting.add(
          new Vector3(spot.x, origin.y + base + light.y * scale, spot.z),
          light.color,
          light.range * scale,
          light.intensity,
          light.flicker,
        );
      }
      // Beside the light and on the same terms: the prop's own position, taken
      // here because nothing downstream still has one. `flatten` above bakes
      // this placement into the vertices and the merge then takes the mesh
      // away entirely, so an emitter that is not recorded on this line has no
      // second chance to be — see `AmbienceSystem`.
      if (sound) {
        this.ambience.add(
          spot.x,
          origin.y + base + sound.y * scale,
          spot.z,
          AMBIENCE_KINDS[sound.kind],
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
   * **A new REJECTION is not free that way and never can be**: an attempt that
   * now fails takes two more numbers out of a stream shared by the whole build,
   * so every region authored after the first prop a rule turns away is redrawn.
   * That is the price of the road test below, it was paid once, and it is why
   * a rule like it belongs here rather than in fourteen hand-dodged layouts.
   *
   * Returns the spot twice over: `lx`/`lz` in the region's own unrotated frame,
   * which is where the geometry is assembled, and `x`/`z` in the world, which
   * is what the rejection tests and the terrain sample need.
   */
  private findSpot(
    spec: ScatterSpec,
    terrain: TerrainField,
    rot: number,
    clearance: number,
    /** This prop's own draw from the region's range — see `scatterRegion`. */
    scale: number,
    placed: { x: number; z: number; r: number }[],
    rng: () => number,
  ): { x: number; z: number; lx: number; lz: number } | null {
    const body = PROP_BODIES[spec.prop];
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
      if (ok && this.insideCollider(spec, terrain, x, z, clearance)) ok = false;
      // Nothing GROWS out of a carriageway. Padded by the prop's own
      // half-footprint rather than by its placement clearance, which is the
      // difference between a tree that may lean over a street and one that may
      // stand in it — a palm's `clearance` is 2.6 m and holding a grove that far
      // back from every kerb would leave a bald verge down both sides of the
      // road it is supposed to be shading. See `PropBody.rooted`.
      if (ok && body.rooted && (this.roads.rects.length > 0 || this.roads.pieces.length > 0)) {
        const half = (Math.max(body.w, body.d) / 2) * scale;
        if (onRoad(this.roads, x, z, half)) ok = false;
      }
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
   *
   * **The base is where the prop will STAND, in world height** — the region's
   * `y`, the floor at the spot and the road over it, the same sum
   * `scatterRegion` places the prop at. It used to be the region's `y` alone,
   * which is only right on a floor at zero: the boxes are world-space, so on a
   * hill a headstone read as standing metres below a wall's footing and was
   * sown inside it, and in a hollow a low prop read as over a wall it was
   * buried in. Tall props mostly escaped, because their band reached up into
   * the box anyway.
   */
  private insideCollider(
    spec: ScatterSpec,
    terrain: TerrainField,
    x: number,
    z: number,
    clearance: number,
  ): boolean {
    const baseY = (spec.y ?? 0) + terrain.heightAt(x, z) + roadTopAt(this.roads, x, z);
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
    // ground probe) and is not there at all to a round. The flag is carried onto
    // the `WorldBox`, which is what `RayWorld` reads; dropping `solid` instead
    // would let the player fall through a fence top their own capsule is still
    // being held out of.
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
    // Beside the box and never anywhere else, which is what keeps the two
    // lists parallel — see `GameMap.colliderAlbedo`.
    this.boxAlbedo.push(this.albedoHint[0], this.albedoHint[1], this.albedoHint[2]);
    // The scatter index rides along here because this is the only place a box
    // is ever recorded — the same property that makes `boxes` complete.
    // Feeding it anywhere else would leave the two able to disagree.
    insertBox(this.boxIndex, world);
    return world;
  }

  /**
   * Records each of a placed structure's visual parts that stands where grass
   * grows as a box in world space — `GameMap.partBoxes`.
   *
   * The box is the part's own vertex bounds carried through its transform, so
   * whatever a builder did to a part after `Build` made it (a `reframe`, a
   * `scaling.x`) is what is recorded. A part turned only about the vertical
   * keeps its shape as an oriented box; one tilted out of it is recorded as
   * the upright box that contains it, which is the collider test's own
   * approximation for a ramp. `Structure.freeform` parts are skipped — their
   * bounds are a batch's, not a shape's.
   *
   * Only parts that can reach into a blade are kept: the ground under the
   * box's centre and corners, against the tallest blade a rect can grow. The
   * mask repeats the test exactly, per texel; this is only what keeps a
   * 900 m town's roofs and upper floors out of the list.
   */
  private recordParts(
    s: Structure,
    origin: Vector3,
    rotY: number,
    terrain: TerrainField,
  ): void {
    const reach = CONFIG.grass.heightMax * MAX_HEIGHT_SCALE;
    for (const m of s.meshes) {
      if (s.freeform.has(m)) continue;
      const pos = m.getVerticesData(VertexBuffer.PositionKind);
      if (!pos || pos.length < 3) continue;
      let x0 = Infinity;
      let y0 = Infinity;
      let z0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      let z1 = -Infinity;
      for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i];
        const y = pos[i + 1];
        const z = pos[i + 2];
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        if (z < z0) z0 = z;
        if (z > z1) z1 = z;
      }
      // Row-vector convention: a point is `v * M`, so rows 0-2 are the part's
      // own axes (scaled) in the structure's frame and row 3 its position.
      const M = m.computeWorldMatrix(true).m;
      const lx = (x0 + x1) / 2;
      const ly = (y0 + y1) / 2;
      const lz = (z0 + z1) / 2;
      const ex = (x1 - x0) / 2;
      const ey = (y1 - y0) / 2;
      const ez = (z1 - z0) / 2;
      const sx = lx * M[0] + ly * M[4] + lz * M[8] + M[12];
      const sy = lx * M[1] + ly * M[5] + lz * M[9] + M[13];
      const sz = lx * M[2] + ly * M[6] + lz * M[10] + M[14];
      const axx = M[0] * ex;
      const axy = M[1] * ex;
      const axz = M[2] * ex;
      const ayx = M[4] * ey;
      const ayy = M[5] * ey;
      const ayz = M[6] * ey;
      const azx = M[8] * ez;
      const azy = M[9] * ez;
      const azz = M[10] * ez;
      const flatX = Math.hypot(axx, axz);
      const flatZ = Math.hypot(azx, azz);
      let w: number;
      let h: number;
      let d: number;
      let yaw: number;
      const upright =
        Math.abs(axy) <= 1e-3 * flatX &&
        Math.abs(azy) <= 1e-3 * flatZ &&
        Math.abs(ayx) + Math.abs(ayz) <= 1e-3 * Math.abs(ayy);
      if (upright) {
        w = 2 * flatX;
        h = 2 * Math.abs(ayy);
        d = 2 * flatZ;
        // Babylon's `RotationY(t)` has rows (cos, 0, -sin) and (sin, 0, cos),
        // so either horizontal axis says the turn; the longer says it better.
        yaw = flatX >= flatZ ? Math.atan2(-axz, axx) : Math.atan2(azx, azz);
      } else {
        w = 2 * (Math.abs(axx) + Math.abs(ayx) + Math.abs(azx));
        h = 2 * (Math.abs(axy) + Math.abs(ayy) + Math.abs(azy));
        d = 2 * (Math.abs(axz) + Math.abs(ayz) + Math.abs(azz));
        yaw = 0;
      }
      const at = rotateY(sx, sy, sz, rotY).addInPlace(origin);
      const turn = rotY + yaw;
      const bottom = at.y - h / 2;
      const top = at.y + h / 2;
      const c = Math.cos(turn);
      const sn = Math.sin(turn);
      let lo = terrain.heightAt(at.x, at.z);
      let hi = lo;
      for (const [u, v] of CORNERS) {
        const du = (u * w) / 2;
        const dv = (v * d) / 2;
        const g = terrain.heightAt(at.x + du * c + dv * sn, at.z - du * sn + dv * c);
        if (g < lo) lo = g;
        if (g > hi) hi = g;
      }
      if (bottom >= hi + reach || top <= lo + 0.05) continue;
      this.partBoxes.push({ w, h, d, cx: at.x, cy: at.y, cz: at.z, rotX: 0, rotY: turn });
    }
  }

  private setAlbedoHint(c: Color3): void {
    this.albedoHint = [c.r, c.g, c.b];
  }

  /**
   * Sets the albedo the next boxes are recorded in to the average paint of
   * `meshes`, each weighted by its bounding box's surface — a stand-in for
   * how much of the structure it is, and plenty for light that is about to be
   * averaged over a whole hemisphere. A mesh with no single colour (a ground
   * texture, glazing) says nothing; a structure where nothing says anything
   * is `NEUTRAL_ALBEDO`. It must never KEEP the hint, which is whatever the
   * last structure or prop was painted — or the floor, for the first one.
   */
  private albedoFromMeshes(meshes: readonly Mesh[]): void {
    let r = 0;
    let g = 0;
    let b = 0;
    let total = 0;
    for (const m of meshes) {
      const c = this.mats.albedoOf(m.material);
      if (!c) continue;
      const e = m.getBoundingInfo().boundingBox.extendSize;
      const sx = Math.abs(m.scaling.x) * e.x;
      const sy = Math.abs(m.scaling.y) * e.y;
      const sz = Math.abs(m.scaling.z) * e.z;
      const area = sx * sy + sy * sz + sx * sz + 1e-4;
      r += c.r * area;
      g += c.g * area;
      b += c.b * area;
      total += area;
    }
    this.albedoHint =
      total > 0 ? [r / total, g / total, b / total] : [...NEUTRAL_ALBEDO];
  }

  /**
   * Turns already-recorded boxes into collider meshes MERGED BY LOCALITY —
   * one mesh per `CLUSTER` square of ground rather than one per box.
   *
   * **This is the fence lesson at forest scale, and the numbers are the same
   * ones.** A `pickWithRay` costs per MESH before it costs per triangle: a
   * predicate call, a world-matrix inverse and a bounding test each, and the
   * game used to fire such rays every frame against every solid mesh on the map
   * — the hitscan on every shot, sixteen bots' LOS, the grenade, the death cam,
   * a tank's chase camera.
   *
   * **NONE OF THOSE IS A PICK ANY MORE** (`RayWorld`, `ENGINE_UPGRADE.md` wall
   * 2), so the frame no longer cares how these are grouped. Three things do,
   * and they are why this stays: the editor still picks meshes, the server
   * still stands them up, and the grouping rides to it as
   * `MapCollision.boxGroups` — a decision this side made that the other side
   * has to reproduce. `colliderBoxes` keeps one entry per prop however the
   * meshes are grouped, which is why nothing derived from geometry — the ray
   * queries now included — can tell either way. Greyfen's five belts were 354
   * loose tree boxes out of
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
   * shadow and carries no outline (see the `paneBlocks.finish` loop in
   * `mergeBlocks` for why glass has neither), so there is no second
   * registration anywhere to revoke — and `bakeVertexShading` writes the COLOUR buffer, so the bake is
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
      // As in `mergeByMaterial`: skipped means kept, and a kept part owes the
      // upload the merge would have done for it.
      if (!mat) {
        uploadPart(mesh);
        continue;
      }
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
            uploadPart(parts[0]).bakeCurrentTransformIntoVertices()
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

/** A box's four corners, as signs on its two horizontal half-extents. */
const CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const;

/** Rotates a local offset about the Y axis. */
function rotateY(x: number, y: number, z: number, angle: number): Vector3 {
  if (angle === 0) return new Vector3(x, y, z);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new Vector3(x * c + z * s, y, -x * s + z * c);
}
