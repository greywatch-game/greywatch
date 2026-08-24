/**
 * greyfen/layout.ts — THE MAP, as data: structure placements, scatter
 * regions, control points, spawns, water rects, grass rects. The floor's shape
 * is generated data and lives in heights.ts. Consumed by MapBuilder; nothing
 * here is code to special-case.
 * Gotchas that have already cost time: collider top faces within
 * CONFIG.nav.stepHeight of adjacent ground or bots treat decks as walls;
 * a control point's pos must NOT sit inside a PLACEMENT's collider (surfaceAt
 * returns -1 — scatter is held off flags and spawns by `MapBuilder.keepClear`,
 * placements are not); scatter regions must dodge the roads by hand, because a
 * road is visual-only and rejects nothing; terrain steeper
 * than a 0.4 gradient severs its own nav links. A second map is one new file
 * shaped like this plus an EnvironmentSpec.
 */
import { Vector3 } from "@babylonjs/core";
import type {
  ControlPointDef,
  GrassRect,
  MapLayout,
  Placement,
  ScatterSpec,
  SpawnPointDef,
  WaterRect,
} from "../layout";
import { GreyfenHeights } from "./heights";

/**
 * GREYFEN — a jungle valley, being built around its centrepiece.
 *
 * It was once a fork of Hollowmere's village, was cleared back to nothing, and
 * is now growing again as something else: a drowned tropical valley with a
 * colonial manor rotting in the middle of it. What is standing so far is the
 * skeleton a Conquest round cannot run without — five control points in a ring
 * around the centre and the spawns that serve them, with the two uncapturable
 * home spawns diagonally opposed so neither side starts next to C — plus the
 * manor itself on C.
 *
 * 240 x 240 m, origin at the map centre, +Z is north. The flags keep the
 * positions the village put them at, so the ring is still a playable spacing to
 * build around; move them as the map takes a shape of its own.
 *
 * Everything below is authored through the editor (F2) and patched back into
 * this file line by line, so keep to the shape it reads: one array entry per
 * line, and each array delimited by its own `const name: Type = [` and a `];`
 * at column 0. The empty arrays are written open for exactly that reason — the
 * editor's scanner anchors on those two lines, and `= []` on one line gives it
 * nowhere to add an entry.
 *
 * Layout hygiene (keep to these when building it back up):
 * - Structures are axis-aligned (`rotY` in multiples of π/2). Organic tilt
 *   belongs to scatter props, not buildings.
 * - Roads end at junctions, wall faces, or ramp feet — never under a building,
 *   an embankment, or a fence line.
 * - Lamps stand at road corners, and fences split with a gate wherever a road
 *   or ramp passes through them.
 * - Scatter regions stay clear of buildings, spawn points, and the valley
 *   ridge. `MapBuilder.findSpot` rejects any spot buried in a collider, but a
 *   region that blankets a structure just wastes its count on rejects.
 */

/**
 * The treeline hamlet's deck level: the height its walks and hut platforms are
 * authored at, rather than five copies of the same number. Named for
 * Hollowmere's constant of the same name, which is a coincidence of value and
 * not a shared thing — the two maps share no module in either direction.
 *
 * Raising a boardwalk is not free, and the two consequences are why this has a
 * comment at all. The deck's underside lands at 1.86 m, which clears `NavGrid`'s
 * 1.7 m `HEADROOM` — so the ground beneath the hamlet stays open and linked, and
 * you fight under the walks as well as on them. But every link ONTO the deck is
 * gone at this height (`buildBoardwalk`'s whole design is a deck inside
 * `stepHeight`), so the walks are reachable only by what is built to reach
 * them: the `stairs` at the south end. Delete that flight and the hamlet becomes
 * three huts nothing can climb to.
 */
const TERRACE_H = 2;

/**
 * The built valley, by district.
 *
 * **C — the manor.** Placed so flag C stands in the middle of its great hall:
 * the builder's origin is the core block's centre, and C is at (0, -4). Its own
 * geometry runs from x -14 to +17.5 (the service stair breaks out of the east
 * flank) and from z -16.6 to +7 in local terms, so at this placement it occupies
 * roughly x ±16, z -20 to +3 — well inside the capture ring, and clear of C's
 * own deploy point, which was moved south to make room.
 *
 * **A — the treeline hamlet.** Three stilt huts and two walks, set NORTH of the
 * flag so A's own centre stays open ground and the huts are what you fight
 * through to reach it rather than what you fight from on top of it. Two of them
 * stand inside the 14 m ring on purpose. The whole hamlet stands at
 * `TERRACE_H`, a storey up, which makes the walks a firing line over the flag
 * and the ground beneath them a covered approach to it — and which is why one
 * stair carries the only way up, on the flag's own side, so taking the height
 * means crossing open ground under it first.
 *
 * **B — the west bank.** The most exposed flag on the map: flat, treeless, and
 * with the nearest cover 25 m away across the river. It gets a ruin for corners
 * and two huts on the bank, one of which is the stilt hut doing what it was
 * built for — see `buildStiltHut`, whose worked example is this placement. It
 * stayed treeless when the rest of the valley became forest, and that took
 * authoring rather than luck: the scatter regions stop short of it on three
 * sides and the fourth is the water. It is the one flag on the map you cross
 * open ground to reach.
 *
 * **D — the temple.** A stepped platform on the raised north-east quadrant: the
 * only high ground east of the manor, visible from it, and the one flag you
 * have to climb for. Its control point carries the summit height for that
 * reason. The forest around it is thinner than the south's on purpose — a flag
 * you climb for wants its approach readable — and the platform itself is the
 * one place with open sky and no water under it.
 *
 * **E — the canopy camp.** The deepest forest on the map stands over it — the
 * southern floor plus a thicket of its own — so it is dark and close, which the
 * layout claimed long before it was true. Two huts on a walk, and a ruin
 * standing between the deploy point and the flag so the approach is a fight
 * rather than a stroll.
 *
 * **The trestle** crosses the east branch where the straight line from C to D
 * meets it — the manor's own approach, and far enough from both flags (25 m and
 * 46 m) to belong to neither. Its `y` is the one authored number the builder
 * cannot derive: see `buildTrestleBridge` on why local zero has to be BANK
 * grade when MapBuilder samples the ground at a placement's centre and that
 * centre is over a river bed.
 *
 * **The causeway** runs up the marsh bar in the confluence, north of the manor
 * and inside nobody's ring. Three segments rather than one 35 m walk, because a
 * placement height-samples once at its own centre and a long deck over
 * anything but level ground floats at one end.
 *
 * Everything is axis-aligned, per the hygiene note above.
 */
const placements: Placement[] = [
  { kind: "manor", x: 0, z: -4, params: { litWindows: true } },
  { kind: "stiltHut", x: -70, z: 84, y: TERRACE_H, rotY: Math.PI / 2 },
  { kind: "stiltHut", x: -56, z: 86, y: TERRACE_H, rotY: -Math.PI / 2 },
  { kind: "stiltHut", x: -66, z: 96, y: TERRACE_H },
  { kind: "boardwalk", x: -63, z: 84.5, y: TERRACE_H, rotY: Math.PI / 2, params: { length: 11, railSide: "none" } },
  { kind: "boardwalk", x: -63, z: 88.758, y: TERRACE_H, params: { length: 6, railSide: "none" } },
  // The hamlet's only way up, landing on the walk's south edge at z 83.3. Its
  // run is derived (rise / 0.35 = 7.143 m), so the placement sits half of that
  // south of the joint and nothing here may be nudged without re-deriving it.
  { kind: "stairs", x: -63, z: 79.729, params: { height: 2.5 } },
  { kind: "jungleRuin", x: -50, z: 70, rotY: Math.PI, params: { width: 11, depth: 8 } },
  { kind: "jungleRuin", x: -105, z: -40, rotY: Math.PI / 2, params: { width: 13, depth: 9 } },
  { kind: "stiltHut", x: -87, z: -24, rotY: Math.PI / 2 },
  { kind: "stiltHut", x: -76, z: -29.96, y: 0.437 },
  { kind: "boardwalk", x: -77.727, z: -24.5, y: 0.002, rotY: Math.PI / 2, params: { length: 10, railSide: "-x" } },
  { kind: "templeRuin", x: 80, z: 34 },
  { kind: "stiltHut", x: 30, z: -88, rotY: Math.PI / 2 },
  { kind: "stiltHut", x: 48, z: -90 },
  // Runs 33..43.2, abutting the east hut's deck rather than lapping 1.8 m over
  // it — same rule as the channel causeway below, and at 80 m2 of coincident
  // deck it was the larger of the two overlaps.
  { kind: "boardwalk", x: 38.1, z: -88, rotY: Math.PI / 2, params: { length: 10.2, railSide: "none" } },
  { kind: "jungleRuin", x: 46, z: -76, rotY: Math.PI, params: { width: 12, depth: 9 } },
  { kind: "trestleBridge", x: 36, z: 15, y: 1.34, rotY: Math.PI / 2 },
  // The channel causeway, authored as a chain so each length samples its own
  // ground (see `buildBoardwalk`). **Adjacent decks must ABUT, never overlap.**
  // A deck is one box placed by its top face, so half a metre of overlap is
  // half a metre of two boxes occupying the same space — four coincident planes
  // (both tops at 0.82, both bottoms at 0.18, both sides at x +/-1.2), and a
  // coincident plane across two meshes is a depth-test tie broken per pixel,
  // which strobes into a line as you walk. Abutting costs nothing: decks within
  // `HEIGHT_EPS` merge into one nav surface either way.
  //
  // 19..31, 31..43, 43..53.5. The last one's NORTH end is load-bearing — the
  // stairs at z 54.967 land on it — so the overlap comes out of its length
  // rather than out of its position.
  { kind: "boardwalk", x: 0, z: 25, y: 1, params: { length: 12, railSide: "none" } },
  { kind: "boardwalk", x: 0, z: 37, y: 1, params: { length: 12, railSide: "none" } },
  { kind: "boardwalk", x: 0, z: 48.25, y: 1, params: { length: 10.5, railSide: "none" } },
  { kind: "stiltHut", x: 5.456, z: 31, y: 1, rotY: Math.PI / 2 },
  { kind: "stiltHut", x: -5.447, z: 42, y: 1, rotY: -Math.PI / 2 },
  { kind: "road", x: -102.37, z: 33.852, params: { surface: "dirt", length: 78 } },
  { kind: "road", x: -52.241, z: 60.715, rotY: Math.PI / 2, params: { surface: "dirt", length: 100 } },
  { kind: "stairs", x: 0.023, z: 54.967, y: -0.112, rotY: -Math.PI, params: { height: 1, railSide: "none" } },
  { kind: "stairs", x: -0.013, z: 17.635, y: -0.122, params: { height: 1, railSide: "none" } },
];

/**
 * THE JUNGLE. Not belts any more — the valley is forest, and the clearings are
 * what is authored into it.
 *
 * ## What was wrong with belts
 *
 * This shipped as five rectangles of hardwood laid across an otherwise empty
 * valley, 368 trees over 57,600 m2. Measured rather than argued: that is one
 * trunk per 12.5 m of ground, and inside the THICKEST belt it was still one per
 * 10.8 m, with a median nearest neighbour of 6.6 m. A ray fired straight up
 * from head height inside that belt found leaf 24% of the time. Both halves of
 * that are the same fact — a stand thin enough to walk through without noticing
 * is a stand thin enough to see the sky through — and neither is jungle. Dense
 * tropical forest is a stem every 3-5 m with a roof you cannot find a hole in.
 *
 * ## What is here instead
 *
 * The forest is the default state of the ground and covers most of the map, at
 * roughly one trunk per 38-42 m2 in the deep parts (a median nearest neighbour
 * near 3.7 m) and one per 125 in the clearings — which are the second half of
 * the idea. **A clearing is authored as a SPARSE REGION rather than as a gap**,
 * because a rectangle with no region over it is bald and reads as a hole in
 * the level rather than as a place the forest thins. Bravo's bank, Alpha's
 * clearing and the manor's north lawn are all trees at a tenth the density,
 * not an absence of them.
 *
 * Density varies the way the grass rects vary it, and for the same reason:
 * **overlap is the density control.** A thicket is a disc of a few more trees
 * laid OVER the floor region it sits in, so Echo's camp is the southern floor's
 * count plus its own. Authoring a second, higher number for the same ground
 * would be a third thing to keep in step.
 *
 * The canopy starts nine metres up and the trunk is the whole collider (see
 * `PROP_BODIES`), so a stand is still cover in the sense that TRUNKS are cover.
 * What has changed is how much of it there is: at this spacing a level
 * sightline through deep forest runs about 30 m before a trunk is in it,
 * against 100 m before. That is the fight this map now has, and it is why the
 * clearings, the river and the roads are the only long lanes left.
 *
 * ## What a region may not do
 *
 * **It may not put a trunk on a flag or a spawn, and that is no longer the
 * author's problem.** A control point whose centre is inside a collider cannot
 * be captured and sinks its own flow field (`surfaceAt` returns -1 — the
 * Flag-C-on-the-well error), and a spawn inside one deploys a player into a
 * tree. The old layout answered that by placing every blocking region far
 * enough to one side that its radius plus the prop's half-length cleared the
 * nearest flag. That cannot survive a forest that covers the valley on
 * purpose, so `MapBuilder.keepClear` now refuses the spot outright — every
 * control point and every spawn, blocking props only. Ferns stay exempt and
 * may sit straight over a capture point.
 *
 * **It must dodge the two roads by hand.** Roads are visual-only, so no
 * collider rejects a trunk standing in one. The west road runs
 * x -106.4..-98.4 over z -5.2..72.9 and the north one runs z 56.7..64.7 over
 * x -102.2..-2.2; every region below clears both, and the margins are tight
 * enough (W4 stops at x -106.5) to be worth re-checking after a nudge.
 *
 * **A BLOCKING understory region still must not reach a flag's centre**, and
 * now cannot: it is the same `keepClear` rule. What is still the author's is
 * everything about the SHAPE — Bravo is a bare bank because the layout says
 * so, not because anything enforces it.
 *
 * The exception that proves the old rule is still here: the stele ring on D is
 * centred ON the flag and is safe by construction, because the temple's
 * colliders fill that footprint and `MapBuilder.findSpot` rejects any spot
 * buried in one. The steles can only land on the ground around the platform.
 *
 * **The MID-STORY is not in this array at all.** The liana veils hang off the
 * trees' own crowns — see `buildJungleTree`, which also carries why the share
 * of trees wearing one FELL when this forest thickened.
 *
 * Note that ADDING A PLACEMENT REROLLS ALL OF THIS. `findSpot` draws from the
 * shared stream once per attempt, accepted or rejected, and placements build
 * before scatter — so a new building anywhere moves every tree on the map.
 * Re-walk the flags after touching either array. **APPENDING a region does
 * not**, and neither does removing one from the end.
 *
 * The counts are REQUESTS, not placements: `findSpot` gives up after fourteen
 * attempts and the prop is dropped, which at this density is how roughly a
 * fifth of them end. That is deliberate — a count tuned so nothing is ever
 * refused is a count that stops short of the packing the clearance describes.
 */
const scatter: ScatterSpec[] = [
  // THE SOUTHERN FLOOR — the deepest forest on the map, because the fight
  // between C and E crosses it and the two southern home spawns feed into it.
  { prop: "jungleTree", x: -58, z: -98, width: 108, depth: 44, count: 146, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 58, z: -100, width: 104, depth: 40, count: 128, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 0, z: -46, width: 118, depth: 56, count: 187, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 86, z: -44, width: 58, depth: 60, count: 90, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  // Echo's camp: a thicket over the southern floor rather than instead of it,
  // so this district is the densest ground in the valley. The layout has always
  // called it dark and close; between this and the closed canopy it now is.
  { prop: "jungleTree", x: 40, z: -80, radius: 26, count: 35, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -30, z: -62, radius: 18, count: 14, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 24, z: -30, radius: 16, count: 12, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  // THE WEST FLANK — B's district. The bank itself stays the most exposed flag
  // on the map, so the forest stops short of it on three sides and the fourth
  // is the river.
  { prop: "jungleTree", x: -86, z: -62, width: 62, depth: 40, count: 70, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  // The cover the layout note calls "25 m away across the river". It is the
  // same 25 m; what it has now is depth behind it.
  { prop: "jungleTree", x: -50, z: -26, width: 46, depth: 66, count: 93, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -76, z: 14, width: 42, depth: 40, count: 47, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  // West of the west road, which this stops 0.1 m short of.
  { prop: "jungleTree", x: -112, z: 30, width: 11, depth: 62, count: 16, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  // Bravo's bank: a handful of trees over 40 m of open ground, which is what
  // makes it read as a clearing rather than as a hole in the forest.
  { prop: "jungleTree", x: -97, z: -28, radius: 20, count: 6, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  // THE MANOR — forest crowding both flanks of the hall, and a thin lawn on
  // its north front so the approach from the causeway stays a lane.
  { prop: "jungleTree", x: -34, z: -4, width: 30, depth: 44, count: 38, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 36, z: -4, width: 34, depth: 44, count: 42, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 0, z: 14, width: 44, depth: 18, count: 10, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  // THE NORTH-WEST — A's district. Both roads are cleared by hand here.
  { prop: "jungleTree", x: -94, z: 89, width: 44, depth: 30, count: 38, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -22, z: 85, width: 44, depth: 38, count: 47, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -56, z: 110, width: 124, depth: 20, count: 70, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  // Alpha's clearing: the ground the hamlet's walks overlook. Sparse rather
  // than empty, and the huts reject whatever lands on them.
  { prop: "jungleTree", x: -60, z: 79, width: 36, depth: 26, count: 9, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  // Between the two roads.
  { prop: "jungleTree", x: -51, z: 44, width: 90, depth: 22, count: 47, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  // THE NORTH-EAST SHELF — D's quadrant, the raised ground. Sparser than the
  // south on purpose: this is the flag you climb for and its approach is meant
  // to stay readable.
  { prop: "jungleTree", x: 84, z: 92, width: 66, depth: 52, count: 97, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 84, z: 40, width: 66, depth: 48, count: 82, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 96, z: 62, radius: 18, count: 14, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 110, z: 8, width: 16, depth: 42, count: 16, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  // The wedge of bank between the north-east channel and the confluence. Thin,
  // because the marsh and the causeway along it are a landmark and want sky.
  { prop: "jungleTree", x: 14, z: 80, width: 26, depth: 44, count: 21, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 46, z: 48, radius: 18, count: 21, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  // THE UNDERSTORY — ferns, fallen logs and stelae. Small regions near the
  // districts rather than spread over the valley: this is dressing you fight
  // around rather than terrain. Ferns are non-blocking and may sit anywhere;
  // the logs and stelae carry colliders and are held off the flags by
  // `keepClear` like everything else that does.
  { prop: "fernClump", x: -62, z: 84, width: 34, depth: 30, count: 26, scale: [0.8, 1.4] },
  { prop: "buttressLog", x: -76, z: 92, radius: 12, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.6 },
  { prop: "carvedStele", x: 80, z: 34, radius: 20, count: 6, scale: [0.85, 1.25], blocking: true, clearance: 0.7 },
  { prop: "fernClump", x: 80, z: 34, radius: 22, count: 22, scale: [0.8, 1.4] },
  { prop: "fernClump", x: 40, z: -84, width: 40, depth: 30, count: 28, scale: [0.8, 1.4] },
  { prop: "buttressLog", x: 22, z: -72, radius: 12, count: 5, scale: [0.85, 1.2], blocking: true, clearance: 1.6 },
  { prop: "fernClump", x: -95, z: -30, radius: 16, count: 20, scale: [0.8, 1.4] },
  { prop: "carvedStele", x: -104, z: -42, radius: 9, count: 3, scale: [0.85, 1.25], blocking: true, clearance: 0.7 },
  { prop: "fernClump", x: -49.664, z: 40.272, radius: 15, count: 20, scale: [0.8, 1.4] },
  { prop: "fernClump", x: -29.664, z: 46.772, radius: 12, count: 14, scale: [0.8, 1.4] },
  { prop: "fernClump", x: 62.009, z: 5.057, radius: 12, count: 10, scale: [0.8, 1.4] },
  { prop: "fernClump", x: 49.92, z: 30.36, radius: 12, count: 9, scale: [0.8, 1.4] },
  // Two more where the forest is deepest, so the shaded floor has something on
  // it besides grass and litter.
  { prop: "fernClump", x: -20, z: -50, radius: 18, count: 22, scale: [0.8, 1.4] },
  { prop: "fernClump", x: 30, z: -104, radius: 18, count: 20, scale: [0.8, 1.4] },
  { prop: "fernClump", x: -66, z: -68, radius: 16, count: 18, scale: [0.8, 1.4] },
  { prop: "buttressLog", x: -46, z: -30, radius: 14, count: 5, scale: [0.85, 1.2], blocking: true, clearance: 1.6 },
  { prop: "buttressLog", x: 70, z: -52, radius: 14, count: 5, scale: [0.85, 1.2], blocking: true, clearance: 1.6 },
];

const controlPoints: ControlPointDef[] = [
  { id: "A", name: "Alpha", pos: new Vector3(-60, 0, 76), radius: 14 },
  { id: "B", name: "Bravo", pos: new Vector3(-97, 0, -28), radius: 13 },
  { id: "C", name: "Charlie", pos: new Vector3(0, 0, -4), radius: 14 },
  // On the temple's summit. Capture is horizontal only, so the ring is
  // unaffected by the height — but `pos.y` is what the flag marker and the
  // deploy map draw at, and a beacon at ground level inside a solid platform
  // is a column growing out of the stone.
  { id: "D", name: "Delta", pos: new Vector3(80, 1.35, 34), radius: 13 },
  { id: "E", name: "Echo", pos: new Vector3(40, 0, -84), radius: 12 },
];

/**
 * Home spawns are uncapturable. Every control point also carries a spawn just
 * outside its capture zone, so deploying onto a flag you hold does not drop you
 * on top of whoever is contesting it.
 */
const spawns: SpawnPointDef[] = [
  { team: 0, pos: new Vector3(-100, 0, 96), yaw: Math.PI },
  { team: 0, pos: new Vector3(-94, 0, 96), yaw: Math.PI },
  { team: 0, pos: new Vector3(-106, 0, 96), yaw: Math.PI },
  { team: 1, pos: new Vector3(105, 0, -96), yaw: 0 },
  { team: 1, pos: new Vector3(99, 0, -96), yaw: 0 },
  { team: 1, pos: new Vector3(111, 0, -96), yaw: 0 },
  { team: null, controlPoint: "A", pos: new Vector3(-60, 0, 62), yaw: Math.PI },
  { team: null, controlPoint: "B", pos: new Vector3(-99, 0, -24.5), yaw: Math.PI },
  // Pushed out to -28 so it clears the manor's front steps (which reach
  // z = -21.1) rather than dropping a squad onto them.
  { team: null, controlPoint: "C", pos: new Vector3(-2, 0, -28), yaw: 0 },
  { team: null, controlPoint: "D", pos: new Vector3(80, 0, 14), yaw: Math.PI },
  { team: null, controlPoint: "E", pos: new Vector3(40, 0, -66), yaw: 0 },
];

/**
 * Dug ground lives in `heights.ts`, generated by the editor's terrain mode.
 *
 * What is cut into it is a Y-shaped river. One channel enters the rim in the
 * north-east and runs south-south-west into a wide confluence basin above the
 * manor, where it splits: a west branch running down the left flank and out
 * through the south-west rim, and an east branch running south-east and then
 * out through the east rim. Beds bottom at -0.89 and -1.34; a shallow rise of
 * +0.15 blankets the north-east quadrant, which is relief rather than a
 * feature.
 *
 * THE RIVER IS NOT A BARRIER, and that is deliberate. Every bank on this map
 * is graded at about 0.66 m per 3 m terrain cell — a gradient of 0.22, well
 * inside the 0.4 at which `NavGrid.link` severs itself — so every crossing
 * already links, and both bots and the player wade the whole thing. The
 * crossings here are landmarks and raised firing lanes; nothing routes over
 * them because it has to. Deepening a channel past 0.4 would change that, and
 * would owe a re-walk of all five flags.
 *
 * One feature is worth knowing about before placing anything in the middle of
 * the map: a bar at -0.68 runs up the confluence from about z 21 to z 51,
 * twelve metres wide, under 0.16 m of standing water. It is the one stretch of
 * marsh on Greyfen, and it is what the causeway is laid along.
 */

/**
 * Standing water. Ankle-deep everywhere (CONFIG.water.surfaceY) over the bed
 * beneath it, so bots and the player wade across — no swimming, and the nav
 * grid never hears about it. A rect over a dug basin therefore sits below the
 * surrounding ground: -0.6 m of bed puts the surface at -0.28.
 */
const water: WaterRect[] = [
  { x: 1.693, z: -6.027, width: 250, depth: 250, y: -0.52 },
];

/**
 * Ground cover — and the thing about it that INVERTED when the canopy closed.
 *
 * It shipped empty, and the belts were why that was wrong: a jungle-tree belt
 * is a promise about foliage nine metres up and clear sight lines beneath it,
 * which on its own is a floor of bare soil under evenly spaced columns. So the
 * densest rects went where the belts were, and the note here read: the belts
 * own everything above nine metres and this owns everything under a knee.
 *
 * **That was right about the layer and wrong about where to spend it, and the
 * forest above is what proves it.** A closed canopy is not a roof over an
 * unchanged floor — it is the reason the floor is bare. Under 90% closure
 * almost no light reaches the ground, and what grows there is litter, roots and
 * the odd fern; the deep undergrowth of a jungle is at the EDGES, in the gaps,
 * and along the water, which is exactly where the light is. So the densities
 * below now run the other way round from how they shipped: the southern floor
 * and Echo's camp, which were the thickest ground on the map at 0.75 and 1.3,
 * are the thinnest at 0.28 and 0.35, and what stayed rich is Bravo's bank,
 * Alpha's clearing, the manor's north lawn and the reed beds — every one of
 * them somewhere the sky is still open.
 *
 * It is also the cheapest triangle this map has to give back, and it was worth
 * about 7,600 tufts. The field is one mesh of thin instances with a single
 * bounding box over the valley, so there is no culling inside it and the cost
 * is the tuft COUNT and nothing else — 15 triangles each, every frame, wherever
 * the camera is. The forest costs what it costs; this is where the budget for
 * it came from, and the change makes the picture better rather than worse,
 * which is the only kind of saving worth taking.
 *
 * Placement rules: rects dodge roads (roads are visual-only, so no collider
 * rejects a blade poking through them — that check is on the author), while
 * structures, props and the rim's boundary boxes are cleared automatically by
 * the GrassSystem's collider rejection. **Overlap is a density control, not a
 * mistake** — two rects over one patch grow both their fields.
 *
 * The two roads are the only hand-checked exclusions: the west road runs
 * x -106.4..-98.4 over z -5.2..72.9, and the north one runs z 56.7..64.7 over
 * x -102.2..-2.2. Nothing here may enter either.
 *
 * **A rect over a channel is a REED BED and is deliberately thin.** The water
 * surface is a flat plane at -0.52 and the beds bottom at -1.34, so a blade in
 * the deepest water stands 0.82 m in it and just breaks the surface. That is
 * the look the low-density bank rects are for; at field density the same rect
 * is a lawn growing underwater.
 */
const grass: GrassRect[] = [
  // THE FOREST FLOOR — the southern half, under 85-95% canopy closure. Thin on
  // purpose: this is litter and root, not undergrowth, and the ferns scattered
  // through it are what the eye reads at ankle height.
  { x: -34, z: -96, width: 74, depth: 44, density: 0.28 },
  { x: 54, z: -96, width: 76, depth: 44, density: 0.28 },
  { x: -4, z: -44, width: 78, depth: 58, density: 0.28 },
  { x: 76, z: -60, width: 76, depth: 24, density: 0.3 },
  // E, the canopy camp — the darkest ground on the map now, so the thinnest.
  // It was the thickest, back when the belt over it was forty trees.
  { x: 40, z: -82, width: 34, depth: 26, density: 0.35 },
  // C, the manor. The flanks are crowded by forest; the north front is a lawn
  // nobody has cut in a decade and still has sky over it, so it keeps its
  // density and the flanks give theirs up.
  { x: -28, z: -6, width: 24, depth: 42, density: 0.5 },
  { x: 30, z: -6, width: 26, depth: 42, density: 0.5 },
  { x: 0, z: 10, width: 40, depth: 14, density: 1.0 },
  // B, the west bank — the flag the layout note calls the most exposed on the
  // map, and now the clearing the forest stops short of. Knee-high grass gives
  // it CONCEALMENT without giving it cover, which is the one thing this layer
  // can offer a flag with nothing on it, and it does not move the 25 m of open
  // ground that makes B what it is.
  { x: -97, z: -30, width: 40, depth: 44, density: 1.3 },
  { x: -104, z: -46, width: 26, depth: 24, density: 0.9 },
  // A, the treeline hamlet: the clearing the stilts stand in and the open
  // ground south of it that the walks overlook. Both are gaps in the canopy, so
  // both stay rich. The western approach is forest now and thins with it.
  { x: -62, z: 88, width: 46, depth: 40, density: 1.2 },
  { x: -58, z: 74, width: 54, depth: 16, density: 1.1 },
  { x: -74, z: 36, width: 40, depth: 36, density: 0.4 },
  // D, the temple, on the raised north-east quadrant. The platform itself is
  // the one place on this map with open sky and no water, so it keeps a real
  // field; the woods either side of it do not.
  { x: 80, z: 34, width: 52, depth: 48, density: 0.6 },
  { x: 96, z: 76, width: 44, depth: 44, density: 0.3 },
  { x: 58, z: 12, width: 30, depth: 44, density: 0.4 },
  // THE BANKS — reeds, at the thin densities the note above explains, and the
  // one place the old array and this one agree. A river is a hole in the
  // canopy: the light comes down it, so the water's edge is the richest ground
  // in a real jungle and the only reason these are thin is that they are IN the
  // water. The first is the marsh bar itself, either side of the causeway.
  { x: 2, z: 36, width: 22, depth: 34, density: 0.7 },
  { x: -40, z: 26, width: 26, depth: 30, density: 0.5 },
  { x: -58, z: -10, width: 30, depth: 56, density: 0.45 },
  { x: 66, z: -32, width: 44, depth: 22, density: 0.45 },
];

export const GreyfenLayout: MapLayout = {
  placements,
  scatter,
  controlPoints,
  spawns,
  water,
  grass,
  terrain: GreyfenHeights,
  // Fixed so the dressing — and the colliders blocking scatter emits, and so
  // the nav graph — is identical on every boot. Changing it rerolls the whole
  // scatter field, which is a visible change to the level: re-walk the flags.
  seed: 0x484c,
};
