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
 * - Scatter regions stay clear of buildings and spawn points.
 *   `MapBuilder.findSpot` rejects any spot buried in a collider, but a region
 *   that blankets a structure just wastes its count on rejects. There is no
 *   valley rim to stay clear of any more — the last block of the scatter array
 *   is the country PAST the play square, and it is the one place on this map
 *   where a region deliberately stands outside it.
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

  // ===== THE COUNTRY PAST THE PLAY SQUARE ====================================
  // Thirty-nine regions, 718 trees and 115 pieces of understory, APPENDED
  // for the reason the note at the top of this array gives: one seeded stream
  // serves the whole build in authored order, so a region spliced in above
  // this line rerolls every field below it and moves every tree in the valley.
  // This is the END of the stream. Append, never insert.
  //
  // WHY IT IS HERE AT ALL. `borderland` takes the rim away, and a margin with
  // nothing standing on it is not "the valley keeps going" — it is a plane
  // fading to `fogColor`, which reads as a backdrop. What tells an eye that
  // ground RECEDES is stuff standing ON it at intervals.
  //
  // NONE OF IT BLOCKS, and that is the load-bearing line rather than a saving.
  // A blocking prop is a collider, a `WorldBox` and a row in the collision
  // bake; out here it would be geometry the bots can neither see nor route
  // around — the nav graph stops at the play square — and, the sharp one,
  // something to CATCH a player sprinting home against a countdown. Omitting
  // `blocking` emits nothing at all, so every tree below leaves the baked
  // collision set byte-identical. The two props that carry a body inside the
  // square (`buttressLog`, `carvedStele`) are sown WITHOUT it out here and are
  // pictures.
  //
  // …AND NOTHING IS A PLACEMENT. A structure would be a collider too, and
  // worse: placements build BEFORE scatter off the same stream, so one ruin
  // out here would move all 1,396 trees inside the map. The ruins' motif
  // carries on as non-blocking steles instead.
  //
  // THE COLLAR ARGUMENT, WHICH THIS MAP MAKES WITH DENSITY RATHER THAN WITH
  // ITS PROP. Harrowmead keeps 90 m of bare ground past its square because its
  // hedges and walls genuinely stop there, so the dressing thinning out is a
  // cue the HUD cannot give, and because 90 m is past the leash's 69 so
  // nothing alive ever stands in a non-blocking wood. Hollowmere gives the
  // collar up and pays for it with the PROP — a bare blighted trunk 0.7 m
  // across, nothing to hide behind. Greyfen can do neither. It has no cue to
  // protect (the forest is sown to z = ±120 on three sides, so a bare ring
  // would be a firebreak cut round a jungle that has not got one, and against
  // a 78 m fog wall it would put the whole block out of sight), and its tree
  // is 0.91 m of bole at eye height with a buttress flare wider than that. So
  // what this map spends instead is the DENSITY, and the number it is spent
  // against is the fog:
  //
  //   a sightline's mean free path through randomly placed trunks is
  //   1 / (trees-per-m² × trunk width). Inside the square the deep forest runs
  //   35 m² a tree, which is 38 m — HALF the fog wall, so a stand inside the
  //   map is a screen and is meant to be. The stands below run 110–173 m² a
  //   tree in the near band a living player reaches (121–190 m) and 216–240
  //   past it: a sightline out here reaches the fog before it reaches a trunk,
  //   everywhere, by half again at the worst of it.
  //
  // So the borderland is the one wood on Greyfen you can see through further
  // than you can see, and the concealment a collar exists to prevent is not
  // available in it. What makes that safe rather than merely true is that the
  // forest two metres back INSIDE the line stops rounds and this does not, so
  // stepping out of the map to fight from it is a trade DOWN — which is the
  // argument this map has and Hollowmere's moor did not.
  //
  // AND IT STILL READS AS JUNGLE, because on this tree the canopy and the bole
  // are different arguments. The crown is 7.6 m plates at 10 m with fronds
  // past them, so about 50 m² of sky each: at 110–155 m² a tree that is 32–45%
  // closure — gallery forest along a flood plain, which is exactly what the
  // banks of a tropical river are, against the >100% closure of the valley you
  // are standing in. The thing that says "jungle" at 40 m through this fog is
  // the canopy line, and this has one.
  //
  // WHERE THE TREES ARE NOT. Nothing is sown past 150 m from the square. From
  // the leash limit at 69 m out, 150 m is 81 m away and the fog wall is 78, so
  // the last 30 m of margin is fog insurance rather than country, and sowing it
  // would be paying for geometry nobody can be standing anywhere to see. The
  // three channel mouths are left open for the same kind of reason the other
  // way round: what carries the north, west and east bearings out of the map
  // is the RIVER, and a stand across a channel is a stand standing in it.
  //
  // IT IS NOT A RING, which is the bowl a rim would have been at one notch
  // quieter. Each side is given the country the valley already has on it: the
  // SOUTH is the deepest forest on the map, simply carried on, and is the
  // thickest side; the NORTH is the hamlet's treeline west of the channel and
  // the temple shelf's thinner woods east of it, with the river coming down
  // between them; the WEST is Bravo's open bank, the thinnest side, with the
  // west branch running out through it; the EAST is the temple's own country,
  // and the steles say there is more of it. The CORNERS get TWO regions each,
  // an inner and an outer, because a side is 120 m of square from the middle
  // and a corner is 170: lay four sides as sides and the diagonal out of a
  // home spawn is left with the far tails of two of them, and one corner stand
  // far enough out to close the diagonal is too far out to close the near half
  // of it.
  //
  // WHICH WAS MEASURED, and it is the test worth copying rather than the
  // numbers. For every place a living player can stand — the play edge, 30 m
  // out and the leash limit, every 20 m along all four sides — sweep the
  // OUTWARD half-horizon two degrees at a time and ask how much of it finds a
  // stand inside `fogEnd`. The first pass put twenty-five regions out here and
  // read 88.9% mean with a worst of 14%, and the worst was not a corner: it
  // was the west side between z 60 and 120, which is what the Valeguard home
  // spawn looks out at, where half the horizon was open ground. At thirty-nine
  // it is 97.7% mean, 100% median and a worst of 75.6% — and the places still
  // under 80 are the three river mouths and the far ends of the leash strip,
  // which are openings on purpose. A screenshot finds the hole you happen to
  // photograph; this finds the one nobody stood in.

  // SOUTH — the canopy camp's forest carrying on, and the thickest side.
  { prop: "jungleTree", x: -80, z: -152, width: 72, depth: 60, count: 39, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: -4, z: -150, width: 68, depth: 56, count: 33, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: 72, z: -152, width: 68, depth: 60, count: 37, scale: [0.85, 1.3], clearance: 0.95 },
  // The understory in the near verge, where it is read from twenty metres
  // rather than from sixty. Ferns are the map's own non-blocking prop and are
  // already sown this way inside the fight; the logs are not, and are pictures
  // out here.
  { prop: "fernClump", x: 26, z: -140, radius: 20, count: 24, scale: [0.8, 1.4] },
  { prop: "buttressLog", x: -46, z: -142, radius: 16, count: 5, scale: [0.85, 1.2] },
  // The two southern corners' INNER halves — see the corner note above.
  { prop: "jungleTree", x: -116, z: -172, width: 56, depth: 60, count: 28, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: 114, z: -172, width: 56, depth: 60, count: 28, scale: [0.85, 1.3], clearance: 0.95 },
  // The far line, aimed at a player who is already dying: from the leash limit
  // at z = -189 the fog reaches -267, and without these the last thing anybody
  // sees on the way out is a plane. Thin, because it is only ever read through
  // most of a fog wall.
  { prop: "jungleTree", x: -42, z: -216, width: 76, depth: 56, count: 19, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: 44, z: -220, width: 76, depth: 56, count: 19, scale: [0.85, 1.3], clearance: 0.95 },

  // NORTH — Alpha's treeline west of the channel, the shelf's woods east of
  // it. Both stop short of x 19..49, which is the channel and its banks.
  { prop: "jungleTree", x: -86, z: 152, width: 68, depth: 60, count: 30, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: -20, z: 144, width: 48, depth: 44, count: 14, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: 84, z: 150, width: 66, depth: 56, count: 27, scale: [0.85, 1.3], clearance: 0.95 },
  // The channel's own banks, and the only thing standing between the two
  // woods: a river is a hole in the canopy and the light comes down it, which
  // is the argument the reed-bed grass rects below are laid on as well.
  { prop: "fernClump", x: 34, z: 156, width: 30, depth: 64, count: 28, scale: [0.8, 1.4] },
  { prop: "buttressLog", x: 28, z: 140, radius: 14, count: 5, scale: [0.85, 1.2] },
  { prop: "jungleTree", x: -116, z: 172, width: 56, depth: 60, count: 24, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: 114, z: 172, width: 56, depth: 60, count: 24, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: -64, z: 212, width: 72, depth: 56, count: 18, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: 24, z: 218, width: 72, depth: 56, count: 18, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: 96, z: 208, width: 64, depth: 52, count: 15, scale: [0.85, 1.3], clearance: 0.95 },

  // WEST — Bravo's bank is the most exposed flag on the map and the forest
  // stops short of it on three sides; this is that, carried on. The thinnest
  // side, and the west branch leaves through the middle of it.
  { prop: "jungleTree", x: -152, z: 26, width: 60, depth: 68, count: 29, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: -148, z: -28, width: 52, depth: 40, count: 12, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "fernClump", x: -150, z: -86, width: 56, depth: 26, count: 22, scale: [0.8, 1.4] },
  { prop: "carvedStele", x: -142, z: -56, radius: 13, count: 4, scale: [0.85, 1.25] },
  { prop: "jungleTree", x: -152, z: -122, width: 60, depth: 52, count: 22, scale: [0.85, 1.3], clearance: 0.95 },
  // The north half of this side, which is what the Valeguard home spawn looks
  // out at — measured, and it was the worst hole on the map before it: half of
  // the outward horizon from x = -120, z = 60..120 was open ground.
  { prop: "jungleTree", x: -152, z: 96, width: 60, depth: 72, count: 33, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: -212, z: 6, width: 60, depth: 72, count: 20, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: -216, z: -104, width: 60, depth: 60, count: 16, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: -214, z: 96, width: 64, depth: 72, count: 21, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: -214, z: -172, width: 64, depth: 60, count: 16, scale: [0.85, 1.3], clearance: 0.95 },

  // EAST — the temple's country. The stelae are why this side gets a motif of
  // its own: Delta is the one flag with worked stone around it, and a few more
  // of them standing out in the forest are the cheapest thing on this map that
  // says the valley had more in it than the five places you fight over.
  { prop: "jungleTree", x: 152, z: 52, width: 60, depth: 72, count: 31, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "carvedStele", x: 146, z: 30, radius: 15, count: 5, scale: [0.85, 1.25] },
  { prop: "jungleTree", x: 150, z: -4, width: 56, depth: 40, count: 14, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "fernClump", x: 152, z: -39, width: 60, depth: 24, count: 22, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 152, z: -96, width: 60, depth: 68, count: 29, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: 152, z: 106, width: 60, depth: 68, count: 29, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: 214, z: 40, width: 64, depth: 72, count: 21, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: 216, z: -70, width: 64, depth: 64, count: 18, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: 214, z: 140, width: 64, depth: 64, count: 18, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: 216, z: -170, width: 64, depth: 60, count: 16, scale: [0.85, 1.3], clearance: 0.95 },
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
 * What is cut into it is a Y-shaped river. One channel enters through the
 * NORTH edge at x 27..42 and runs south-south-west into a wide confluence
 * basin above the manor, where it splits: a west branch running down the left
 * flank and out through the WEST edge at z -93..-78, and an east branch
 * running south-east and then out through the EAST edge at z -45..-33. Beds
 * bottom at -0.89 and -1.34; a shallow rise of +0.15 blankets the north-east
 * quadrant, which is relief rather than a feature.
 *
 * **All three mouths now RUN, which is what the map losing its rim is for.**
 * There is no landform at the boundary any more (`ridge: { form: "none" }`),
 * `TerrainField` clamps the field's edge row outward, and the water rect is
 * the whole floor — so each channel extrudes its own cross-section straight
 * out through the margin and keeps carrying water the whole 180 m. What
 * bounds `Borderland.roll` is exactly that: see the export at the foot of this
 * file, because the roll is added on top of the clamped bed and a big enough
 * swell lifts a river out of its own trench.
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
 *
 * **ONE rect, and it is the whole FLOOR rather than the whole valley now** —
 * 600 m on a side, which is `size` plus twice the `borderland`'s margin, so
 * the water stops exactly where the ground does. A rect is an EXTENT and not a
 * shore: the bed decides what is wet, and at this size 7.5% of it is.
 *
 * **What it buys is that the river LEAVES.** The Y has three mouths in the
 * boundary — the north-east channel through the north edge at x 27..42, the
 * west branch through the west edge at z -93..-78 and the east branch through
 * the east edge at z -45..-33 — and `TerrainField` clamps its edge row
 * outward, so the trench is out there on all three bearings whether the water
 * is or not. It was not: the old rect was 250 m centred at (1.7, -6.0), whose
 * north edge stood at z = 119 — one metre SHORT of the map, and short on the
 * one side a channel runs out through. That was invisible while an escarpment
 * stood at z = 120 and is a river ending in a straight line across its own bed
 * now that one does not. **A map losing its rim should look for what the rim
 * was standing in front of**; on this one it was that.
 *
 * **It stays ONE rect for the reason Hollowmere's bog does, and here the
 * reason is three times over.** A seam between two rects is where the MIRROR
 * changes — each carries its own cube probe, stood at the depth-weighted
 * centroid of its own wet cells — and a channel arm out in the borderland
 * would have to be seamed to the valley's water straight across the bearing a
 * player looks down as they leave. Three arms, three seams, all three laid
 * across a sightline somebody stands on.
 *
 * **What it costs is bed-map resolution, and that was MEASURED rather than
 * assumed, because the assumption was wrong.** The bed is
 * `CONFIG.water.depthTexelsMax` (512) texels a side however large the rect is,
 * so widening 250 m to 600 takes a texel from 0.50 m to 1.17 — which sounds
 * like a coarser shoreline and is not one, for two reasons. The waterline's
 * POSITION was never in this map: where the water's edge falls is where the
 * terrain MESH crosses the plane, and that is exact geometry at any texel
 * size. And the depth the shader reads is smooth over a bank graded at 0.22,
 * so resampling it costs almost nothing: rebuilding both bakes and sampling
 * them against the true bed over all 27,754 wet half-metre cells inside the
 * play square, the error goes from 0.4 cm mean / 1.9 p95 / 5.6 worst to
 * **1.0 / 4.1 / 11.8**, on depths averaging 62 cm. Through `foamWidth` (0.45)
 * and `foamDepth` (0.05) that moves the mean shoreline foam over the wet
 * square from 0.004 to 0.001 and over the marsh bar — the shallowest water on
 * the map, 16 cm over its own bar, and therefore the place this should have
 * hurt — from 0.012 to 0.008.
 *
 * **What DOES visibly change is the reflection probe, and it is a fix rather
 * than a cost.** The centroid of the old rect's wet cells was (-2.5, 0.8) —
 * inside the manor's great hall, half a metre under its floor, which is
 * Cinderhaven's failure (a probe baked from inside a building) sitting on this
 * map since it was dug. The three arms and the swale pools pull it to
 * (12.3, 25.9), the confluence basin: open water, open sky, and the one place
 * on Greyfen that looks like what the rest of the water should be mirroring.
 * The river reads brighter for it, and it is the first time its surface has
 * had visible relief on it at all — a mirror of a dark interior returned the
 * same value whichever way a ripple turned.
 */
const water: WaterRect[] = [
  { x: 0, z: 0, width: 600, depth: 600, y: -0.52 },
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
  /**
   * **No wall.** The valley is not closed by anything you can walk up to: the
   * jungle and the river carry on for a hundred and eighty metres past the
   * play square and what stops you is the leash, a countdown rather than a
   * face of rock. See `Borderland`, and `world/leash.ts` for the rule.
   *
   * **The margin is the HORIZON's, and on this map the horizon is 78 m.** The
   * cel shader's fog is LINEAR between `fogStart` and `fogEnd`, so a surface
   * reaches exactly `fogColor` at `fogEnd` and not one metre before it, and
   * ground that stops any nearer arrives on screen at some fraction of its own
   * colour against a sky dome painted flat `fogColor` below the horizon — a
   * green line drawn round the world, which is the dead band `Ridge.ts` says a
   * rim is there to cover. So the edge has to be `fogEnd` from the furthest an
   * EYE gets: the play edge plus the leash's 69 m is 147, the death cam's own
   * orbit stands 3.4 m further out than the body it frames and a blast can
   * throw that body further still, and 180 is that rounded up. Every bearing
   * is covered at once because a borderland is a square ring and not four
   * strips. It is the same 180 Hollowmere buys for the same `fogEnd`, which is
   * the point of the arithmetic: what a margin has to beat is the FOG and
   * nothing about the map.
   *
   * **`roll` is 1.2, and it is the one number on this map the RIVER sets.**
   * Everywhere else a borderland's swell is chosen for shape; here it is
   * bounded, and the bound is not obvious. `TerrainField` continues the floor
   * by clamping its edge row outward, so the Y's three mouths extrude straight
   * out of the map as channels of their own cross-section — and then
   * `borderRoll` is ADDED on top, swinging ±roll/2. The shallowest mouth is
   * the east branch, whose bed sits 0.82 m under the water plane; at the
   * default 2.6 the roll lifts it 1.3 and the river runs dry 22 m out and
   * stays dry for 63 m, which is inside the readable band and reads as a
   * riverbed rather than a river. Measured along all three centrelines out to
   * the boundary: 2.6 dries two of the three, 1.6 leaves 2 cm in the east
   * branch, and **1.2 leaves 0.22 m in the worst place on the worst arm** —
   * about a quarter of the channel's own depth, which is a riffle and not a
   * gravel bar. The valley has no shape to lose to it: 4,906 of the
   * heightfield's 6,561 vertices are exactly 0 and the whole authored range is
   * -1.34 to +0.16, so what closes this horizon was never going to be a swell.
   * It is the canopy.
   *
   * **`ease` is stated at 30 for Hollowmere's reason, which is the mirror of
   * Harrowmead's.** A third of 180 is 60 — inside the leash's 69, so by
   * Harrowmead's test the default lands in the right place and the field need
   * not be stated. What that test does not cover is a map whose FOG is nearer
   * than its leash: the borderland anybody ever sees is 78 m deep against a
   * 69 m strip they are run out through, so a 60 m ramp spends four fifths of
   * everything ever seen out there flattening it into a radial smear of the
   * map's own edge. The number to beat is whichever of the leash and `fogEnd`
   * is SHORTER. The steepest gradient the roll can then make is
   * `(roll / 2) * (0.026 + 1.5 / ease)` = 0.046, and measured over the whole
   * finished floor on a 4 m lattice the worst anywhere is 0.219 — which is the
   * river's own authored bank, inside the square, and was there before this.
   * `MAX_WALKABLE_GRADE` is 0.4: a player being run out of the map is never
   * stopped by the ground on the way.
   *
   * **What stands out there is the forest, and it does not stop at the
   * square** — the scatter array's last block is that country and carries the
   * argument in full, including the one this map has to make differently from
   * both of the others: why it gives up the bare collar, and what it spends
   * instead of the bare prop Hollowmere spends.
   */
  borderland: { margin: 180, roll: 1.2, ease: 30 },
  /**
   * **No rim at all.** The valley ends in more valley, and what closes the
   * horizon is the fog rather than a landform.
   *
   * `Ridge.ts` states the one condition on taking `form: "none"`: a map may
   * only draw nothing over its own boundary if it has already laid something
   * out there that reaches past `fogEnd` on every bearing, because the sky
   * dome is flat `fogColor` below the horizon, so a boundary with nothing
   * beyond it is a dead band of sky. Cinderhaven pays that with 2,300 m of
   * ocean, Harrowmead with 600 m of pasture and Hollowmere with 180 m of
   * blight; this map pays it with the 180 above. The furthest an eye gets is
   * 69 m past the square, which leaves 111 m of ground beyond it on an axis
   * and 185 on a diagonal, against a fog wall of 78. The two fields are one
   * decision, and shrinking that margin without putting a landform back is the
   * thing not to do here.
   *
   * What was here was the default `escarpment` — a crag ringing a jungle
   * valley, which is the one landform a drowned tropical basin has no business
   * having and which, at `fogEnd` 78 against a 240 m map, was only ever
   * visible from the outer band. From the middle of the square there is no
   * horizon to hold up at all. What the ring actually did was tell a player
   * standing at a flag that the world ends thirty metres behind it, and cut
   * the three river mouths off dead at the boundary.
   *
   * `EnvironmentSpec.ridgeColor` and `ridgeScreeColor` are still set and are
   * now read by nothing on this map: `MapBuilder` only asks for them per
   * segment and there are no segments. They stay because they are required
   * fields, and because a rim is one line from coming back.
   */
  ridge: {
    form: "none",
  },
  // Fixed so the dressing — and the colliders blocking scatter emits, and so
  // the nav graph — is identical on every boot. Changing it rerolls the whole
  // scatter field, which is a visible change to the level: re-walk the flags.
  seed: 0x484c,
};
