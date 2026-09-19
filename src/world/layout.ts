/**
 * layout.ts — The map-data vocabulary: Placement, ScatterSpec, TerrainRect,
 * MapLayout.
 * Owns: the shape a level file must take, and nothing about any level.
 *
 * These live here rather than beside Hollowmere's data so that "a second map is
 * one new layout file" stays literally true — a new map imports its types from
 * this file, not from its predecessor. MapBuilder consumes a MapLayout and an
 * EnvironmentSpec passed in as arguments; nothing in the world layer reaches for
 * a named map.
 *
 * The remaining pieces of the vocabulary (ControlPointDef, SpawnPointDef,
 * WaterRect, GrassRect) are declared in MapBuilder.ts next to the GameMap they
 * end up inside, and re-exported here so a layout file has one import.
 */
import { CONFIG } from "../config";
import type { BuildParams, BuilderKind } from "./BuildingKit";
import type {
  ControlPointDef,
  GrassRect,
  SpawnPointDef,
  VehicleSpawnDef,
  WaterRect,
} from "./MapBuilder";

export type {
  ControlPointDef,
  GrassRect,
  SpawnPointDef,
  VehicleSpawnDef,
  WaterRect,
};

/** One placed structure. Built at the origin, then rotated and moved here. */
export interface Placement {
  kind: BuilderKind;
  x: number;
  z: number;
  /**
   * Height above the ground beneath it — set when a structure stands on a
   * terrace or embankment. Terrain the placement sits in is added on top, so
   * this stays meaningful when the floor under it moves.
   */
  y?: number;
  rotY?: number;
  params?: BuildParams;
}

/** Everything a scatter region carries whatever shape it is. */
interface ScatterBase {
  prop:
    | "deadTree"
    | "pine"
    // The temperate broadleaf, and the first prop added for a map that was
    // already shipped: a valley dressed in one conifer reads as a plantation.
    | "ashTree"
    | "jungleTree"
    | "fernClump"
    | "buttressLog"
    | "carvedStele"
    | "gravestone"
    | "log"
    | "fungus"
    | "rubble"
    | "fireDrum"
    | "boulder"
    | "bramble"
    | "barrel"
    // The city's own, and the first props in this list that are not rural.
    // Three carry a body and two carry nothing at all — see `PROP_BODIES`,
    // and note that a non-blocking prop emits no collider, no `WorldBox` and
    // nothing to any ray, which is what makes urban clutter affordable at a
    // density the ray budget could never buy in cover.
    | "skip"
    | "binPair"
    | "palletStack"
    | "trafficCone"
    | "litter"
    // The desert's own, and the only tree that grows on a map with no water in
    // it: a bole that screens nothing at head height and a crown that screens
    // everything at fifteen metres. See `buildPalm`.
    | "palm";
  x: number;
  z: number;
  count: number;
  y?: number;
  scale?: [number, number];
  /** Blocking scatter gets a collider and punches a hole in the nav grid. */
  blocking?: boolean;
  /**
   * Rejection-sampling pad: how far this prop's centre must stay from anything
   * already placed. NOT the collider — that comes from `PROP_BODIES` in
   * MapBuilder, measured against the prop's own geometry. The two are
   * deliberately different numbers, because clearance is a spacing rule and is
   * generous on purpose: sizing a collider from it once gave a 0.24 m headstone
   * a box that stopped rounds through 1.2 m of air.
   */
  clearance?: number;
}

/** Loose dressing sprinkled inside a disc of `radius` around (x, z). */
export interface ScatterCircle extends ScatterBase {
  /** Region radius. */
  radius: number;
}

/**
 * The same dressing sprinkled inside an oriented rectangle centred on (x, z):
 * `width` along the region's local X, `depth` along its local Z, the whole
 * thing turned by `rotY`.
 *
 * A belt of trees down one side of a road is a rectangle, and spelling it as a
 * chain of overlapping discs is both tedious to author and uneven where the
 * discs meet. Rotation is what makes it usable — Hollowmere's streets do not
 * run along the axes.
 */
export interface ScatterRect extends ScatterBase {
  /** Extent along the region's local X, before rotation. */
  width: number;
  /** Extent along the region's local Z, before rotation. */
  depth: number;
  rotY?: number;
}

/**
 * One region of loose dressing, placed by rejection sampling.
 *
 * The two shapes are distinguished by which extent fields are present, not by
 * a tag: a region with a `width` is a rectangle and one with a `radius` is a
 * disc. That keeps the shipped layout lines exactly as they were — every
 * existing region is a circle and gains nothing — and gives the editor a
 * discriminated union to narrow on.
 */
export type ScatterSpec = ScatterCircle | ScatterRect;

/** True when a region is the rectangular kind. See `ScatterSpec`. */
export function isScatterRect(s: ScatterSpec): s is ScatterRect {
  return (s as ScatterRect).width !== undefined;
}

/**
 * The shape of the valley floor: a regular grid of vertex heights.
 *
 * Unlike a `terrace` placement — a solid box standing ON the floor, which can
 * only ever go up — this *is* the floor, so it digs below zero as happily as it
 * rises. That is what lets a pool sit in the ground with a bank around it
 * instead of hovering over a flat plane.
 *
 * Authored by the editor's terrain mode and written to its own generated file,
 * NOT into the hand-written layout: a grid of several thousand numbers has no
 * business sitting next to the ASCII village map.
 *
 * **It is not ON the layout, and that is the whole of what it costs to keep it
 * out of the bundle.** The layout used to import its heights module and carry
 * the result as a field, which put every map's grid in the main chunk to be
 * parsed on boot whether or not it was ever played — 51 KB for Harrowmead's
 * 100 x 100, and ~700 KB for the 375 x 375 a 1500 m map at the same 4 m cell
 * would need. It arrives through `MapDef.heights` instead, a lazy `import()`
 * beside `MapDef.collision` and for that field's reason, and everything that
 * needs the floor is HANDED one: `MapBuilder.build` takes it as an argument,
 * `buildServerWorld` awaits it, and `Game` holds the standing map's. See
 * ENGINE_UPGRADE.md S7.
 *
 * What that gives up is the pair being checkable by the compiler. `size *
 * cell` must still equal the MAP's size, and nothing in the type system says
 * so now that the two halves are in different files — so `MapBuilder.build`
 * asserts it in a DEV build rather than leaving a mismatched pair to read as
 * a floor sampled against the wrong origin.
 *
 * Placements, scatter and grass rects read their `y` as an offset ABOVE the
 * terrain, so dropping a building into a basin needs no bookkeeping. Control
 * points and spawns stay absolute: they are single authored points, and the
 * editor snaps their height to the nav surface, which the terrain feeds. Water
 * is absolute too — a pool's surface is level whatever its bed does — but a
 * rect with no `y` defaults to ankle-deep over its own bed.
 */
export interface Heightfield {
  /** Cells per side. There are `(size + 1) ^ 2` vertices. */
  size: number;
  /**
   * Metres per cell. `size * cell` must equal the MAP's size — `MapLayout.size`
   * where the layout states one, `CONFIG.map.size` where it does not. The field
   * is the one place that product is written down twice, which is why
   * `TerrainField` takes its own half-extent from here rather than from
   * `CONFIG`: a map larger than the shipped 240 m would otherwise sample its
   * floor against the wrong origin and read the wrong row of heights.
   */
  cell: number;
  /**
   * Vertex heights in metres, row-major from the -X/-Z corner: index
   * `j * (size + 1) + i` is the vertex at `(-half + i * cell, -half + j * cell)`.
   */
  heights: number[];
}

/**
 * A gap in the rim where something leaves the valley — a road, a track, a dry
 * watercourse. Positioned by the world point it should sit above; `Ridge` finds
 * the nearest station on the boundary ring, so `(x, z)` only has to be near the
 * edge, not exactly on it.
 */
export interface RidgePass {
  x: number;
  z: number;
  /** How wide the saddle is, in metres of boundary. */
  width: number;
  /**
   * How far the crest drops through it, 0..1 of the local height. The result is
   * re-clamped against the rim's minimum slope, so a pass is always a saddle
   * and can never open a hole in the sky — see Ridge.ts.
   */
  depth?: number;
}

/**
 * A stretch of boundary the landform is NOT DRAWN OVER at all.
 *
 * **It is `form: "none"` scoped to an arc, and it rests on exactly the same
 * claim**: a map may draw nothing over its own boundary only where it has
 * already laid something out there that reaches past `fogEnd`, because the sky
 * dome is flat `fogColor` below the horizon and `Sky` culls the lowest 7.2 deg
 * of stars. `none` says that of every bearing at once; a mouth says it of one
 * side, and the map owes the same picture there that the whole-ring form owes
 * everywhere. Coldharbour is what it was added for — a sea laid off one side
 * and hills on the other three — and `Ridge.ts` carries the argument.
 *
 * **A mouth is NOT a deep `RidgePass`, and the difference is the one thing
 * that makes a pass safe.** A pass cuts the crest's ANGLE and is then
 * re-clamped against `MIN_SLOPE`, so it is always a saddle and can never open
 * a hole in the sky; that clamp is exactly what a mouth has to get past. So a
 * mouth does not touch the angle at all — it shrinks the whole landform, its
 * REACH along with its height, until the ring collapses onto its own toe and
 * emits nothing. What that buys beyond an on/off switch is the ENDS: the
 * hills grow back out of the ground over `ease` rather than stopping at a
 * face, which is what a headland running down into the sea looks like.
 */
/**
 * What turns a `downs` rim from one swept profile into COUNTRY: separate
 * summits and saddles along the skyline, knolls and hollows across the face,
 * and stands of trees on it.
 *
 * **It is all visual and all the rim's**, which is what lets it be stated on a
 * map at no cost to anything but the frame: the rim emits no collider, no
 * `WorldBox` and nothing in the collision bake, and neither do the trees —
 * they are built into the rim's own segments, so they are not scatter, draw
 * nothing from the map's seeded stream and cannot reroll a single prop inside
 * the play square. Every field has a default; `{}` is a sensible hillside.
 */
export interface RidgeRolling {
  /**
   * How far a summit rises over, and a saddle falls under, the crest the
   * slope alone would give — a fraction of it. 0.3 puts neighbouring tops
   * something like half again as high as the col between them. The crest is
   * still clamped against the sky's floor AFTER this, so a deep saddle can
   * never open a hole in the horizon.
   */
  relief?: number;
  /**
   * How many hills the whole ring is cut into — the lattice of the summit
   * noise, measured round the CREST's curve. The finest octave is half this
   * spacing, and it must stay a hill rather than a ripple: see `Ridge.ts` on
   * what a short wavelength does under a cel terminator.
   */
  summits?: number;
  /**
   * Knolls and hollows across the FACE, as a fraction of the crest: the
   * height a mid-slope point may swell or sink by. Zero at the toe and at the
   * crest, so neither the seam with the floor nor the skyline moves.
   */
  knolls?: number;
  /** The knolls' wavelength in metres of world. */
  knollSize?: number;
  /**
   * Tree cover, 0..1 — the share of the face that is wooded. The woods come in
   * STANDS with pasture between them rather than as an even pile, thin out
   * towards the tops, and are broadleaf low and conifer high.
   */
  woods?: number;
  /**
   * The lowest height a tree may stand at, for a rim that runs down into
   * water — below it is foreshore or sea. Absent, anywhere.
   */
  shore?: number;
}

export interface RidgeMouth {
  /**
   * A point on the boundary the mouth is centred on — the same convention
   * `RidgePass` uses, and placed by the nearest station for the same reason.
   */
  x: number;
  z: number;
  /**
   * How much boundary is fully open, in metres.
   *
   * **Measured along the CREST's own curve rather than along the boundary
   * square**, which is the one number here that has to be worked out rather
   * than eyeballed, and the reason is the corners. The crest stands `reach *
   * profile[CREST_RING]` metres outboard, so the curve it traces is the square
   * offset outward — four straight sides and a quarter circle at each corner —
   * and a corner therefore contributes `crestOut * pi / 2` of run that the
   * boundary itself contributes none of. On the downs that is 236 m a corner
   * against a 4 m square edge. A width authored against the square would put
   * the taper most of a side away from where it was meant to be.
   */
  width: number;
  /**
   * How far the landform takes to rise back out of the ground at each end, in
   * the same metres. Absent means a quarter of `width`.
   *
   * It is the whole shape of the thing at the ends: over the ramp the crest,
   * the reach and the shoulder all come up together, so the range grows from
   * nothing rather than being cut off, and where it crosses the waterline is
   * a headland. Short and the hills end in a wall standing in the sea; long
   * and the highest ground is a long way from the coast, which is what real
   * country tends to look like.
   */
  ease?: number;
}

/**
 * The valley rim: the landform that closes the map off. SHAPE only — the rim's
 * colours are the environment's (`ridgeColor`/`ridgeScreeColor`), the same
 * split as the floor's `terrain` here against `floorColor` there. That is not
 * tidiness: `applyEnvironment` writes uniforms and nothing else, which is what
 * lets the editor's work light swap an EnvironmentSpec per keypress with no
 * rebuild. A shape living there would silently stop working.
 *
 * Every field is optional so a second map still costs one layout file plus an
 * EnvironmentSpec: omit it entirely and the rim builds with its defaults.
 */
export interface RidgeSpec {
  /**
   * Which LANDFORM the rim is. Absent means `escarpment`, which is what the
   * first three maps are.
   *
   * - `escarpment` — a vertical basal band flush with the collider plane, a
   *   ledged face above it and a flat crest cap. The band is not decoration:
   *   the boundary colliders stand at the player's feet, and a face that
   *   battered outward from the floor would put visible rock in front of the
   *   box at the height rounds arrive at. See `Ridge.ts`.
   * - `downs` — no band at all: the ground rises out of itself on a smooth
   *   shoulder and rounds over. It is only available to a map with a
   *   `borderland`, and that is a consequence rather than a rule anybody has
   *   to remember — the band exists to line up with a collider plane a player
   *   can stand against, and on an open boundary the rim stands a margin's
   *   width beyond anywhere a living player is.
   * - `none` — no landform at all: the map draws nothing over its own
   *   boundary, and what closes the horizon is whatever it has already laid
   *   out there. **A map may only take it if that something reaches past its
   *   own `fogEnd` from everywhere a player can be**, which is the one thing
   *   the other two forms guarantee by standing up: the sky dome is painted
   *   flat `fogColor` below the horizon and `Sky` culls its stars out of the
   *   lowest 7.2 deg, so a boundary with nothing over it and nothing beyond it
   *   is a band of empty sky under a starless one. Cinderhaven is the map it
   *   was added for — an island whose ocean runs out past the fog wall on
   *   every bearing — and `Ridge.ts` carries the argument in full.
   *
   * `mouth` below is this same choice taken one side at a time; a map whose
   * horizon is closed by a landform on three bearings and by water on the
   * fourth states `downs` here and a mouth there.
   */
  form?: "escarpment" | "downs" | "none";
  /**
   * Crest height as a tangent from the map centre — an ANGLE, not a height, so
   * the corners (further from the centre) rise higher than the sides on their
   * own, the way a valley actually looks. Ridge.ts clamps it from below against
   * what the sky needs; see its header.
   */
  slope?: number;
  /** How much `slope` wanders along the rim. */
  slopeVariance?: number;
  /** How far the landform reaches outward from the boundary, in metres. */
  reach?: number;
  passes?: RidgePass[];
  /**
   * Stretches of boundary the landform is not drawn over at all. See
   * `RidgeMouth`: a pass is a saddle in the rim and a mouth is the rim not
   * being there, and the two are different fields because they are different
   * claims — one about the shape of a crest, one about what closes the
   * horizon.
   */
  mouth?: RidgeMouth[];
  /**
   * Rolling COUNTRY on a `downs` rim, and woods on it. See `RidgeRolling`;
   * absent, the downs are the one smooth swell they always were and nothing
   * is sown on them. Ignored by the escarpment.
   */
  rolling?: RidgeRolling;
  /**
   * The rim's own seed. Deliberately separate from `seed` below: one stream
   * serves the whole map build in authored order, so drawing from it here would
   * reroll every scatter region on the map.
   */
  seed?: number;
}

/**
 * The ground PAST the play square, on a map whose boundary is open.
 *
 * Absent — which no shipped map is any more, Coldharbour having been the last
 * and given it up for a coast — and the boundary is the
 * rim: four colliders at `±size/2` and an escarpment drawn over them, and there
 * is nothing outside because nothing can get outside. Present, and the four
 * colliders move out to `±(size/2 + margin)`, the floor is tessellated the whole
 * way with them, and what stops a player leaving is the leash
 * (`CONFIG.map.leash`) rather than a box.
 *
 * **It changes what `size` means and nothing else about it.** `size` is still
 * the PLAY square — the nav grid, the obstacle field, the minimap, the deploy
 * map, scatter placement and the flags are all authored and built inside it,
 * exactly as before — and the margin is ground that exists so that the edge of
 * the world is a horizon rather than a face of rock. Bots never enter it: they
 * read `nav.steer()` and the graph stops at the square, which is why they need
 * no leash of their own.
 *
 * Two things a map that states one owes:
 *
 * - **The margin must outlast the leash.** `CONFIG.map.leash.seconds` at sprint
 *   is how far a player gets before it kills them, and the boundary colliders
 *   are that far out plus slack. Undersize it and they reach the boxes first,
 *   which is an invisible wall in an open field — the exact failure the open
 *   boundary exists to remove.
 * - **The rim is `form: "downs"`.** An escarpment's basal band is a vertical
 *   face flush with the collider plane, which is right where the plane is at
 *   the player's feet and is a cliff dropped in a field where it is not.
 */
export interface Borderland {
  /**
   * How far past `±size/2` the ground continues, in metres. Real ground: it is
   * tessellated, it carries the same clone collider the floor does, rounds
   * spark on it and a corpse lands on it.
   */
  margin: number;
  /**
   * How far the borderland's own undulation swings, peak to trough, in metres.
   * Absent means 2.6.
   *
   * The margin is not authored — there are no heights out there and no editor
   * to draw them — so `TerrainField` continues the field's own edge and rolls
   * it. This is how much: enough that the country reads as more of the same
   * fields, gentle enough that every gradient it makes stays walkable, because
   * a player being run out of the map must never be stopped by the ground on
   * the way.
   */
  roll?: number;
  /**
   * How far out the roll takes to reach full amplitude, in metres. Absent
   * means a third of the margin, which is what every map stating nothing here
   * gets and is bit-identical to what it got before this field existed.
   *
   * **It is stated by a map whose margin is sized by the HORIZON rather than
   * by the leash**, and the two want opposite numbers. The ramp exists so the
   * boundary has no crease; a third of eighty metres is twenty-seven, which is
   * inside the strip a player run out of the map walks through, so the country
   * out there rolls as the country inside does. A third of six hundred is two
   * hundred — four times as far as a leashed player can get — so the same
   * fraction would hand that player a radial smear out of the map's own edge
   * and save the shape for ground nobody can stand on. Harrowmead states forty
   * for that reason; Sarab's margin is the horizon too, but its roll reaches
   * full amplitude at a hundred metres against three hundred of borderland,
   * and it was authored looking at that.
   *
   * **Hollowmere states it for the MIRROR of Harrowmead's reason, which is
   * what the field is actually for.** Its `fogEnd` is 78, so its margin is
   * 180 and a third of that is 60 — INSIDE the leash's 69, which is where
   * Harrowmead's argument says the ramp belongs. What that argument does not
   * cover is a map whose fog is nearer than its leash: the borderland anybody
   * can SEE is 78 m deep and the strip they are run out through is 69, so a
   * 60 m ramp spends four fifths of everything ever seen out there flattening
   * it. 30 puts full amplitude up while the ground is still only a third
   * fogged. So the test is not the default's fraction and not the leash — it
   * is whichever of the leash and `fogEnd` is SHORTER, because that is the
   * borderland a player actually reads.
   */
  ease?: number;
}

export interface MapLayout {
  placements: Placement[];
  scatter: ScatterSpec[];
  controlPoints: ControlPointDef[];
  spawns: SpawnPointDef[];
  water?: WaterRect[];
  grass?: GrassRect[];
  /**
   * Where each side's armour stands. Absent — which is two of the four
   * shipped maps — and the round is fought on foot exactly as it always was:
   * `VehicleSystem` builds nothing, costs nothing and is never asked anything.
   *
   * **A map that states one owes each side exactly one**, and it owes them
   * ground a seven-metre hull can get off: a hardstanding boxed in by its own
   * buildings is a tank that spends the round shooting down one street. What it
   * does NOT owe is anything about the nav graph — a vehicle is invisible to it
   * either way, for the reason a corpse is (see `docs/vehicles.md`).
   */
  vehicles?: VehicleSpawnDef[];
  /**
   * The playable square's side, in metres, centred on the origin. Absent means
   * `CONFIG.map.size` — the 240 m both shipped valleys are authored in.
   *
   * It lives here rather than in `CONFIG` because it is a statement about ONE
   * map: a village and a downtown are not the same size and never were. What
   * makes that affordable is that the extent was already carried on `GameMap`
   * (`map.size`) and passed to `NavGrid`, `ObstacleField`, the minimap and the
   * deploy map as an argument — the global was only ever the value handed in.
   * The remaining readers of `CONFIG.map.size` are the ones that take the size
   * from nothing at all, and each is now given it.
   *
   * Three things a larger map owes, none of which this field can check — the
   * first of them now checked by `MapBuilder.build` in a DEV build instead,
   * because the heightfield is no longer even in the same file:
   * `heights.size * heights.cell` must equal it (see `Heightfield.cell`), the
   * rim's four boundary boxes stay over 200 m and so stay recognisable to the
   * seven sites that identify the boundary by `w > 200 || d > 200`, and the
   * heightfield's own grid grows with the square rather than getting coarser.
   */
  size?: number;
  /**
   * How many standable surfaces `NavGrid` tracks per cell. Absent means
   * `CONFIG.nav.maxSurfaces` (3), which is what a village stacks: creek floor,
   * bank top, bridge deck.
   *
   * **A map raises this only because it stacks FLOORS**, and it is the one
   * number that decides whether a bot can use an upper storey. Overflow is
   * silent — `NavGrid.addSurface` drops the candidate that does not fit and
   * nothing says so — which is why the manor emits its roofs last and why a
   * three-storey block would otherwise lose its top floor to its own roof.
   * The cost is linear in the value and paid in memory at load: the link table
   * is `cells * value * 8` int32s and each flow field is `cells * value`
   * floats, so a 320 m map at 5 is ~7 MB of links against ~4 MB at 3.
   */
  surfaces?: number;
  /**
   * The side of the square the second merge pass collapses structures over, in
   * metres. Absent means `BLOCK_SIZE` (48) — the value every shipped map is
   * built at, so a map that says nothing is bit-identical.
   *
   * It is a statement about DRAW CALLS and CULL GRANULARITY and nothing else.
   * 48 m was chosen for a 240 m map with a 78 m fog wall: coarse enough that a
   * village collapses into a few dozen draws, fine enough that a block is
   * never half-visible for long. At 1500 m that same 48 m is a 32 x 32 grid —
   * 1,024 blocks, each of them a mesh `_evaluateActiveMeshes` walks every
   * frame and `WorldCulling` files a cell for. 96 m is 256 of them and 128 m
   * is 144, bought with coarser culling and larger merged buffers.
   *
   * **Raising it does not move the terrain**, which is the whole point of
   * there being two fields — see `terrainBlock`.
   *
   * Two things key off the block and both follow this for free, because they
   * read the KEY the merge wrote rather than a size: `ReflectionSystem.encloses`
   * (one cube probe per glazed block, and the pane groups that agree with it)
   * and `WorldCulling` (one cull cell per block, bounded by its meshes rather
   * than by the nominal square). What does NOT follow it is the world layer's
   * unit of LOCALITY — the physics buckets and the pane index — which is a
   * separate decision argued at `BLOCK_SIZE` itself.
   */
  blockSize?: number;
  /**
   * The side of the square the FLOOR is tessellated over, in metres. Absent
   * means `BLOCK_SIZE` (48), independently of `blockSize`.
   *
   * The two used to be one number because `terrainPatches` was called with
   * `BLOCK_SIZE`, and they answer different questions: this one is a function
   * of the heightfield's cell and the triangles per patch, `blockSize` is a
   * function of draw calls. A map that widens its merge to cut draws has said
   * nothing about how many triangles belong in one floor mesh, so this stays
   * where it is until the map moves it.
   *
   * It owes one thing nothing checks: **a whole number of terrain cells**.
   * `terrainPatches` takes `Math.round(terrainBlock / cell)` and cuts on grid
   * lines, so a value that is not a multiple simply cuts somewhere other than
   * where it says. The borderland is cut at four times this, for the reason
   * given there.
   *
   * The patch key is the floor mesh's NAME and nothing else — it has never
   * lined up with `blockSize`'s seams and never had to (see `terrainPatches`).
   * A floor mesh carries no `metadata.block` at all, which is what keeps the
   * landform out of both readers of one.
   */
  terrainBlock?: number;
  /** The rim's shape. Absent means the default escarpment. */
  ridge?: RidgeSpec;
  /**
   * How the map is CLOSED. Absent means the rim — four boundary colliders at
   * `±size/2` with the escarpment drawn over them, which is what a map has
   * always been. See `Borderland`.
   */
  borderland?: Borderland;
  /**
   * Seed for scatter placement. Fixed per map so the dressing — and therefore
   * the colliders blocking scatter emits, and therefore the nav graph — is
   * identical on every boot. Change it to reroll the whole scatter field.
   */
  seed?: number;
  /**
   * How many bodies a side fields. Absent means `CONFIG.bots.perTeam` (8),
   * which is what four of the five shipped maps are and what the game has
   * always been.
   *
   * **It is a statement about DENSITY, and it is the map's for the same reason
   * `size` is.** Sixteen bodies over a 240 m village is a fight in every
   * street; the same sixteen over Sarab's 900 m of play is one body per
   * 51,000 m^2, and `ENGINE_UPGRADE.md` S10 measured what that does to a round
   * — five of eleven headless rounds ran the full 45-minute cap with tickets
   * left on both sides, against 13-18 minutes on every shipped map, with a peak
   * contact of 5-7 of 16 bots against 10-14. A bigger map does not need more
   * bots because it is bigger; it needs them because a round is made of
   * CONTACT and contact is bodies per square metre.
   *
   * **What it costs is RIGS, and that is why it is bounded** by
   * `CONFIG.bots.maxPerTeam` (24) rather than being any number a layout likes:
   * a bot is nineteen merged meshes in the frame's own mesh walk whether it is
   * enabled or not, and `BattleSystem` rebuilds its pool to this value — a map
   * that says nothing pays exactly what it always paid, and a map that raises
   * it pays for every body it asked for on every frame of the round. Over the
   * bound is clamped, and says so in a DEV build.
   *
   * Three things follow it for free and one deliberately does not. The squads
   * (`CONFIG.bots.squadSize`, so 24 a side is six squads rather than two), the
   * launcher a squad's first body carries (`antiTankBots.perSquad`, so the
   * ratio of tubes to bodies is what it always was) and the scoreboard, which
   * is a row per pool slot either way. **The TICKETS do not**
   * (`CONFIG.conquest.tickets`): three times the bodies is roughly three times
   * the deaths, so a map that states this is choosing a shorter round as well
   * as a denser one — which on Sarab is the point of stating it.
   *
   * **It reaches a MATCH too, and what it moves there is the BOTS.** The
   * authority's slot table is fixed at `CONFIG.bots.maxPerTeam` a side — a
   * match rotates maps under one table and a table sized per map would
   * renumber every player on team 1 at every rotation — and this is how many
   * of each team's block a round actually fields, pushed by
   * `HeadlessGame.startRound` through `BattleSystem.setFielded`. So Sarab is
   * twenty-four a side online as well as off. **How many PEOPLE a match seats
   * does not follow it**: that stays at sixteen on every map, because it is
   * bounded by the SMALLEST roster in the rotation and a rotation may never
   * evict anybody. See `server/Roster.ts` and `docs/multiplayer.md`.
   */
  perTeam?: number;
}

/**
 * How many bodies a side fields on this map — the layout's, bounded by
 * `CONFIG.bots.maxPerTeam`, defaulting to `CONFIG.bots.perTeam`.
 *
 * The resolver rather than the field is what everything reads, for the reason
 * `bodyDrawDistanceOf` is: the default and the bound are stated once here
 * instead of at each of the sites that ask (the offline pool, the client's
 * `NetRoster`, the authority's `setFielded`, the menu's deployment figure, and
 * the skill draw that is handed the pool).
 *
 * The clamp is silent in production and SAYS SO in a dev build, because the two
 * ways to write a roster past the bound — a layout that meant it and a layout
 * that typed a digit twice — are the same text, and the only thing the engine
 * can do about the second is put it where the author will see it.
 */
export function perTeamOf(layout: MapLayout): number {
  const stated = layout.perTeam;
  if (stated === undefined) return CONFIG.bots.perTeam;
  const capped = Math.max(1, Math.min(CONFIG.bots.maxPerTeam, Math.floor(stated)));
  if (import.meta.env.DEV && capped !== stated) {
    console.warn(
      `[layout] perTeam ${stated} is outside 1..${CONFIG.bots.maxPerTeam};` +
        ` a roster is rigs in the frame's own mesh walk. Clamping to ${capped}.`,
    );
  }
  return capped;
}
