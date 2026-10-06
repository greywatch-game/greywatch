/**
 * hollowmere/layout.ts — THE MAP, as data: structure placements, scatter
 * regions, control points, spawns, water rects, grass rects. The floor's shape
 * is generated data and lives in heights.ts. Consumed by MapBuilder; nothing
 * here is code to special-case.
 * Gotchas that have already cost time: collider top faces within
 * CONFIG.nav.stepHeight of adjacent ground or bots treat decks as walls; a
 * control point's pos must NOT sit inside a PLACEMENT's collider; scatter
 * knows nothing about water, so every stand below was checked dry by the
 * generator; terrain steeper than a 0.4 gradient severs its own nav links.
 *
 * **SEEDED by `scripts/generate-hollowmere.mjs`, and owned by the editor after
 * that.** The design is authored in that script and this file is the
 * transcription: flat arrays of one-line entries, which is what
 * `src/editor/sourceScan.ts` requires. Re-running the generator discards
 * editor edits — and its header says what it checks that hand-editing did not.
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
 * HOLLOWMERE — a burnt village in a dead valley, at night.
 *
 * 240 x 240 m, origin at the market square, +Z is north. Five flags in a ring
 * round the square, with the two uncapturable home spawns diagonally opposed
 * so neither side starts next to C.
 *
 * ```
 *                              N
 *    +---------------------------------------------------+
 *    | * VALEGUARD           :    |    ~ ASHWOOD ~         |
 *    |   (-100,+112)         :    |  kilns     look-out  NE|
 *    |           [A] THE CHAPEL   |  north road      wood  |
 *    |    ~~~~~   (-60,+84)  :   / \__ Wood Lane __        |
 *    |   creek \  churchyard :  /                \ farm    |
 *    |          ~   glebe  Church St.  Cooper's   \ lane   |
 *    |          ~  Beck  \_____|____ Lane _______  [D] THE |
 *    |   mill   ~   Row    inn |                 FARMSTEAD |
 *    | [B] THE MILL ==High St.=[C] THE SQUARE==  (86,+36)  |
 *    |   (-80,-27)  ~ Weavers  (0,-3)  Tanners     east    |
 *    |   in the dell ~  Lane   South St.  Lane   holdings  |
 *    |    moor road ~\______/    \_____ dock road  |       |
 *    |  ~ THE MIRE ~  [burying      [E] THE BOG DOCKS |    |
 *    |  moor look-out   ground]       (40,-75)        |    |
 *    |            ~          ~~~~~ the bog ~~~~~ * REDLINE |
 *    |            ~          ~~~~~~~~~~~~~~~~~~~  (+100,   |
 *    +---------------------------------------------------+-112)
 * ```
 *
 * ## A village, and why it reads as one
 *
 * It grew where the valley road crosses the way down to the mill, and it is
 * laid out the way one is: a paved market square with the well at its head,
 * the coaching inn on its north side and the forge on its south; High Street
 * through it east and west, North Street and South Street through it north and
 * south, and every house on every street turned to face it. Behind High Street
 * run the back lanes — Cooper's Lane to the north-east, Tanners and Weavers
 * Lanes south — and out of the village the lanes run on to the flags with
 * crofts strung along them. North Street climbs to Church Street, and Church
 * Lane climbs on up the hill to the chapel door; High Street drops west down
 * the bank as Mill Lane into the creek's dell.
 *
 * **It burned.** The fire came up from the bog and took the south-east — most
 * of Tanners Lane, the south quarter, the crofts on the dock and moor roads —
 * and the north of the village is where the lamps are still lit. About half the
 * houses are shells: a burnt cottage (`ruined`) where the roof went and the
 * walls stood, a rubble ruin where they did not, rubble in the yard behind,
 * carts overturned in the street.
 *
 * ## The ground, which the first version never had
 *
 * The valley falls from the Ashwood in the north to the moor and the bog in
 * the south. The chapel stands on the one real hill, five metres over the
 * square; the creek runs in a dell two metres under the village's west edge;
 * the farm stands on its own rise; and the moor, the mire and the bog shore
 * are low ground below the mist's datum, where the fog pools thickest. Every
 * sightline across the map now crosses a crest or drops into a hollow.
 *
 * Design intent per flag:
 * - **A The Chapel** — the high ground, inside a walled churchyard with a
 *   gate where each lane arrives. Easy to hold, slow to reach, and the one
 *   flag that stands clear of the mist.
 * - **B The Mill** — down in the creek's dell, where three lanes meet in the
 *   mill yard. The bank rises two metres to the village behind a crest wall,
 *   so whoever holds the crest shoots down into it; the footbridge and the
 *   ford are the way round.
 * - **C The Square** — four streets in and no cover taller than a stall. The
 *   flag nobody keeps.
 * - **D The Farmstead** — the barn on the farm's rise: the hayloft is the
 *   map's best perch and the ramp up to it is exposed.
 * - **E The Bog Docks** — the boathouse on the shore, jetties either side,
 *   and the thickest mist on the map. A short-range brawl by construction.
 *
 * Layout hygiene (the generator holds these; hand edits keep to them):
 * - Structures are axis-aligned (`rotY` in multiples of π/2). A builder's
 *   front is its local -Z: turn 0 faces south, π/2 west, π north, -π/2 east,
 *   and every front door opens onto a street, the square or a yard.
 * - Nothing stands on a road, in the water, or on ground that falls more than
 *   0.3 m across its footprint.
 * - Roads are PATHS and end at junctions the network finds, at a yard, or at
 *   a door. Walls and fences are cut wherever a lane crosses them, which is
 *   where the gates are.
 * - The ORDER of the scatter array is load-bearing: every region draws from
 *   one seeded stream, so a region added anywhere but the end re-rolls every
 *   field below it.
 */

const VALEGUARD = "#c9a15e";
const REDLINE = "#ff3b3b";

const placements: Placement[] = [
  // ===== roads =====================================================================
  // Visual only: a road carries no collider, stops no round and is in no
  // baked structure. The square and the village's streets are COBBLE and
  // every lane out of the village is dirt. Each street is a PATH, so where two
  // meet the network paves the junction itself; the square is the one
  // rectangle, and the four streets out of it end inside its paving.
  // The square — the one paved rectangle on the map.
  { kind: "road", x: 0, z: -2, params: { length: 30, width: 36, surface: "cobble" } },
  // High Street west, down the bank to the mill as Mill Lane.
  { kind: "road", x: -38.5, z: -3.5, params: { path: [[21.5, 1.5], [-15.5, 1.5], [-21.5, -1.5]], width: 7, surface: "cobble" } },
  { kind: "road", x: -68.5, z: -13.5, params: { path: [[8.5, 8.5], [0.5, 0.5], [-8.5, -8.5]], width: 5.5, surface: "dirt" } },
  // High Street east, and the farm lane on out of it up to the farmstead.
  { kind: "road", x: 40, z: 0, params: { path: [[-23, -2], [18, -2], [23, 2]], width: 7, surface: "cobble" } },
  { kind: "road", x: 68.5, z: 29, params: { path: [[-5.5, -27], [-1.5, -17], [-0.5, 1], [-0.5, 17], [5.5, 27]], width: 5.5, surface: "dirt" } },
  // North Street, and on up through the Ashwood and out of the valley.
  { kind: "road", x: 1, z: 31, params: { path: [[0, -19], [0, 19]], width: 6, surface: "cobble" } },
  { kind: "road", x: 14.5, z: 120, params: { path: [[-13.5, -70], [-10.5, -60], [-0.5, -46], [7.5, -30], [11.5, 0], [13.5, 70]], width: 5.5, surface: "dirt", radius: 26 } },
  // Cooper's Lane, the back street behind High Street east, out to the farm lane.
  { kind: "road", x: 34.4, z: 26, params: { path: [[-33.4, 0], [33.4, 0]], width: 5, surface: "cobble" } },
  // Church Street, and Church Lane up the hill to the chapel door.
  { kind: "road", x: -18.5, z: 34, params: { path: [[19.5, 0], [-19.5, 0]], width: 6, surface: "cobble" } },
  { kind: "road", x: -49, z: 49.5, params: { path: [[11, -15.5], [7, -3.5], [-1, 5.5], [-11, 7.5], [-11, 15.5]], width: 5, surface: "dirt", radius: 8 } },
  // South Street, to where the dock road and the moor road fork.
  { kind: "road", x: 1, z: -27, params: { path: [[0, 11], [0, -11]], width: 6, surface: "cobble" } },
  { kind: "road", x: 19.5, z: -51, params: { path: [[-18.5, 13], [-5.5, 3], [10.5, -7], [18.5, -13]], width: 5.5, surface: "dirt", radius: 14 } },
  { kind: "road", x: -38, z: -41, params: { path: [[39, 3], [24, -7], [4, -15], [-20, -19], [-34, -9], [-38, 5], [-39, 19]], width: 5, surface: "dirt", radius: 14 } },
  // Tanners Lane and Weavers Lane, the back streets of the south quarters.
  { kind: "road", x: 36, z: -32.25, params: { path: [[0, 30.25], [0, -30.25]], width: 5, surface: "cobble" } },
  { kind: "road", x: -36, z: -29.4, params: { path: [[0, 27.4], [0, -27.4]], width: 5, surface: "cobble" } },
  // The Valeguard road: through the north-west gatehouse, round the chapel's hill and down the creek's east bank to the mill as Beck Lane.
  { kind: "road", x: -82.75, z: 89.4, params: { path: [[-17.25, 100.6], [-17.25, 2.6], [-7.25, -8.4], [-1.25, -17.4], [2.75, -41.4], [8.75, -65.4], [14.75, -83.4], [17.25, -100.6]], width: 5.5, surface: "dirt", radius: 20 } },
  // The glebe path, off the Valeguard road to the churchyard's west gate.
  { kind: "road", x: -82, z: 76, params: { path: [[-2, -4], [2, 4]], width: 4, surface: "dirt" } },
  // The Redline road: through the south-east gatehouse and up the east side to the farmstead.
  { kind: "road", x: 83.8, z: -85, params: { path: [[16.2, -105], [16.2, -7], [8.2, 5], [1.2, 25], [2.2, 55], [4.2, 85], [-5.8, 99], [-16.2, 105]], width: 5.5, surface: "dirt", radius: 20 } },
  // Bog Lane, off the Redline road along the bog's shore to the docks.
  { kind: "road", x: 61.7, z: -63, params: { path: [[-23.7, -1], [-1.7, -5], [23.7, 5]], width: 5, surface: "dirt" } },
  // The burying ground's gate path, off the moor road.
  { kind: "road", x: -30, z: -63.2, params: { path: [[0, 8.8], [0, -8.8]], width: 4, surface: "dirt" } },
  // Wood Lane, from the farmyard over the fields to the logging camp.
  { kind: "road", x: 47.5, z: 71, params: { path: [[26.5, -15], [18.5, 1], [0.5, 13], [-26.5, 15]], width: 5, surface: "dirt", radius: 18 } },
  // ===== home yards ================================================================
  // Each gatehouse arches over its home road where it comes in off the edge
  // of the map; the barricades face the village, and the side deploys on
  // the village side of them.
  { kind: "gatehouse", x: -100, z: 112, params: { teamColor: VALEGUARD } },
  { kind: "gatehouse", x: 100, z: -112, rotY: Math.PI, params: { teamColor: REDLINE } },
  { kind: "cart", x: -114, z: 86 },
  { kind: "crates", x: -108, z: 91 },
  { kind: "woodpile", x: -104, z: 84, params: { length: 4 } },
  { kind: "shed", x: -86, z: 90, rotY: Math.PI / 2, params: { width: 4, depth: 3 } },
  { kind: "lamp", x: -96, z: 101, rotY: Math.PI },
  { kind: "cart", x: 112, z: -86 },
  { kind: "crates", x: 108, z: -91 },
  { kind: "woodpile", x: 104, z: -84, params: { length: 4 } },
  { kind: "shed", x: 86, z: -90, rotY: -Math.PI / 2, params: { width: 4, depth: 3 } },
  { kind: "lamp", x: 96, z: -101 },
  // ===== C: The Square =============================================================
  // The market square at the crossing of High Street and North Street: the
  // well at its head, stalls round the flag, and every building round it
  // turned to face it — the inn on the north side, the forge on the south,
  // townhouses down the other two. No cover taller than a stall inside the
  // paving, and four streets in: the flag nobody keeps.
  { kind: "well", x: 0, z: 7 },
  { kind: "stall", x: -10, z: 4 },
  { kind: "stall", x: 10, z: 4 },
  { kind: "stall", x: -11, z: -10, rotY: Math.PI },
  { kind: "stall", x: 11, z: -10, rotY: Math.PI },
  { kind: "cart", x: -12.5, z: -14, params: { ruined: true } },
  { kind: "crates", x: 14.5, z: 8.5 },
  { kind: "trough", x: -14.5, z: 9, rotY: Math.PI / 2 },
  { kind: "tavern", x: -10.5, z: 22.6 },
  { kind: "smithy", x: -9.5, z: -24, rotY: Math.PI },
  { kind: "townhouse", x: 8.5, z: 18.2, params: { width: 7.2, depth: 6.4, enterable: true } },
  { kind: "townhouse", x: 17.5, z: 18.2, params: { width: 6.3, depth: 6.5 } },
  { kind: "cottage", x: 9.4, z: -22, rotY: Math.PI, params: { width: 8.3, depth: 6.3, enterable: true } },
  { kind: "ruin", x: 22.4, z: -22.1, rotY: Math.PI, params: { width: 8.8, depth: 6.8 } },
  { kind: "townhouse", x: -23.3, z: 5.9, rotY: -Math.PI / 2, params: { width: 6.8, depth: 6.9 } },
  { kind: "cottage", x: -22.9, z: -12.3, rotY: -Math.PI / 2, params: { width: 7.7, depth: 6, litWindows: true } },
  { kind: "cottage", x: 22.6, z: 6.6, rotY: Math.PI / 2, params: { width: 7.6, depth: 6, enterable: true } },
  { kind: "ruin", x: 22.9, z: -12.7, rotY: Math.PI / 2, params: { width: 7, depth: 6.2 } },
  { kind: "lamp", x: -16.8, z: 11.8 },
  { kind: "lamp", x: 16.8, z: 11.8, rotY: Math.PI },
  { kind: "lamp", x: -16.8, z: -15.8 },
  { kind: "lamp", x: 16.8, z: -15.8, rotY: Math.PI },
  // ===== the streets ===============================================================
  // Every house on a street faces it. The fire came up from the south-east
  // and took most of Tanners Lane and the south quarter; the north of the
  // village is where the lamps are still lit.
  { kind: "townhouse", x: -49.9, z: 6.9, params: { width: 7.2, depth: 6.9, enterable: true, litWindows: true } },
  { kind: "ruin", x: -40.5, z: 6.7, params: { width: 7.9, depth: 6.5 } },
  { kind: "townhouse", x: -50.3, z: -10.5, rotY: Math.PI, params: { width: 6.4, depth: 6.2, litWindows: true } },
  { kind: "townhouse", x: 32.4, z: 6.6, params: { width: 6.7, depth: 6.6, litWindows: true } },
  { kind: "townhouse", x: 40.6, z: 6.7, params: { width: 6.9, depth: 6.7, enterable: true } },
  { kind: "townhouse", x: 48.8, z: 7, params: { width: 6.7, depth: 6.9, litWindows: true } },
  { kind: "cottage", x: 43.6, z: -10.2, rotY: Math.PI, params: { width: 7.7, depth: 6 } },
  { kind: "townhouse", x: 53.8, z: -11.2, rotY: Math.PI, params: { width: 6.7, depth: 6.9 } },
  { kind: "townhouse", x: 9.8, z: 34.5, rotY: Math.PI / 2, params: { width: 7, depth: 6.9 } },
  { kind: "townhouse", x: 9.4, z: 42.8, rotY: Math.PI / 2, params: { width: 6.5, depth: 6.4, litWindows: true } },
  { kind: "cottage", x: 19.4, z: 33.7, params: { width: 7.3, depth: 6.3, litWindows: true } },
  { kind: "cottage", x: 31.2, z: 33.5, params: { width: 7.7, depth: 6.6, ruined: true } },
  { kind: "ruin", x: 42.9, z: 33.1, params: { width: 7.6, depth: 6.2 } },
  { kind: "cottage", x: 53.2, z: 33.5, params: { width: 7.1, depth: 5.7 } },
  { kind: "townhouse", x: 26.6, z: 18, rotY: Math.PI, params: { width: 6.3, depth: 6.8, enterable: true, litWindows: true } },
  { kind: "cottage", x: 34.7, z: 18.3, rotY: Math.PI, params: { width: 6.5, depth: 6 } },
  { kind: "townhouse", x: 45.3, z: 18.1, rotY: Math.PI, params: { width: 6.9, depth: 6.2 } },
  { kind: "cottage", x: 54.6, z: 18, rotY: Math.PI, params: { width: 8, depth: 6.3, litWindows: true } },
  { kind: "townhouse", x: -7.3, z: 42.9, rotY: -Math.PI / 2, params: { width: 6.8, depth: 6.4, enterable: true } },
  { kind: "ruin", x: -31.4, z: 41.8, params: { width: 7.6, depth: 6.5 } },
  { kind: "cottage", x: -21.5, z: 42.3, params: { width: 6.6, depth: 6 } },
  { kind: "cottage", x: -32.1, z: 25.7, rotY: Math.PI, params: { width: 8.1, depth: 6.2, enterable: true, litWindows: true } },
  { kind: "cottage", x: 28.5, z: -43.2, rotY: -Math.PI / 2, params: { width: 8, depth: 6.3, ruined: true } },
  { kind: "cottage", x: 43.4, z: -43.9, rotY: Math.PI / 2, params: { width: 6.7, depth: 6.2, ruined: true } },
  { kind: "cottage", x: 43.7, z: -31.1, rotY: Math.PI / 2, params: { width: 8.2, depth: 5.7, enterable: true } },
  { kind: "cottage", x: 44.2, z: -20.1, rotY: Math.PI / 2, params: { width: 7.1, depth: 6.6, ruined: true } },
  { kind: "cottage", x: -43.2, z: -43.1, rotY: -Math.PI / 2, params: { width: 8.2, depth: 5.7, ruined: true } },
  { kind: "ruin", x: -43.6, z: -31.3, rotY: -Math.PI / 2, params: { width: 8.3, depth: 6.2 } },
  { kind: "townhouse", x: -43.8, z: -20.3, rotY: -Math.PI / 2, params: { width: 6.5, depth: 6.2 } },
  { kind: "cottage", x: -28.7, z: -43.3, rotY: Math.PI / 2, params: { width: 7.9, depth: 6.4, ruined: true } },
  { kind: "cottage", x: -28.4, z: -31.4, rotY: Math.PI / 2, params: { width: 7.9, depth: 5.8, enterable: true, litWindows: true } },
  { kind: "lamp", x: -29, z: 2, rotY: Math.PI / 2 },
  { kind: "lamp", x: 57, z: 2, rotY: Math.PI / 2 },
  { kind: "lamp", x: 29, z: -6, rotY: -Math.PI / 2 },
  { kind: "lamp", x: -2.6, z: 30.2 },
  { kind: "lamp", x: -37, z: 37.6, rotY: Math.PI / 2 },
  // ===== A: The Chapel =============================================================
  // The parish church on the crown of the hill, its door to the south and
  // Church Lane climbing to it; the churchyard walled round it, with a gate
  // where each lane arrives. The high ground over the village, and the one
  // flag that stands clear of the mist.
  { kind: "chapel", x: -60, z: 82 },
  { kind: "cottage", x: -57, z: 46, rotY: Math.PI, params: { width: 8.5, depth: 6.4, enterable: true, litWindows: true } },
  { kind: "lamp", x: -64.5, z: 62 },
  { kind: "lamp", x: -71.5, z: 22, rotY: Math.PI },
  // ===== B: The Mill ===============================================================
  // The mill stands on the creek's east bank down in the dell, its wheel over
  // the water and its door to the yard. Three lanes meet in the yard and the
  // bank rises two metres to the village behind it, so whoever holds the
  // crest shoots down into the flag.
  { kind: "mill", x: -82.4, z: -10 },
  { kind: "cottage", x: -76, z: 1, rotY: -Math.PI / 2, params: { width: 8, depth: 6.2, enterable: true, litWindows: true } },
  { kind: "shed", x: -80, z: -45, rotY: Math.PI, params: { width: 5, depth: 3.2 } },
  { kind: "cart", x: -84, z: -20 },
  { kind: "crates", x: -84, z: -34 },
  { kind: "lamp", x: -80, z: -41, rotY: -Math.PI / 2 },
  // ===== D: The Farmstead ==========================================================
  // The barn on the farm's rise, its cart doors to the farmyard on the north
  // and its loft ramp up the west side to the lane: the map's best perch,
  // and an exposed climb to it. The farmhouse faces the yard across it.
  { kind: "barn", x: 86, z: 36, rotY: Math.PI },
  { kind: "cottage", x: 94, z: 69, params: { width: 9, depth: 6.5, enterable: true, litWindows: true } },
  { kind: "silo", x: 101, z: 30 },
  { kind: "shed", x: 78, z: 67, params: { width: 6, depth: 3.4 } },
  { kind: "haystack", x: 106, z: 20 },
  { kind: "haystack", x: 96, z: 18 },
  { kind: "haystack", x: 106, z: 48 },
  { kind: "cart", x: 100, z: 56, rotY: Math.PI / 2 },
  { kind: "trough", x: 88, z: 55 },
  { kind: "woodpile", x: 104, z: 64, rotY: Math.PI / 2, params: { length: 5 } },
  { kind: "lamp", x: 66, z: 50 },
  // ===== E: The Bog Docks ==========================================================
  // The boathouse on the bog's north shore, its boat door to the yard and its
  // water doors over the pool; two jetties out into the bog either side of
  // it, the fishermen's cottages round the yard. A brawl in the thickest
  // mist on the map.
  { kind: "boathouse", x: 40, z: -77.8, rotY: Math.PI },
  { kind: "jetty", x: 22, z: -88.3, y: 0.43, params: { length: 18 } },
  { kind: "jetty", x: 58, z: -90.5, y: 0.34, params: { length: 18 } },
  { kind: "cottage", x: 14, z: -60, rotY: -Math.PI / 2, params: { width: 7, depth: 6, ruined: true } },
  { kind: "ruin", x: 8, z: -70, rotY: -Math.PI / 2, params: { width: 8, depth: 6.5 } },
  { kind: "shed", x: 52, z: -60, rotY: Math.PI, params: { width: 5, depth: 3 } },
  { kind: "shed", x: 44, z: -57, rotY: Math.PI, params: { width: 4.4, depth: 3 } },
  { kind: "kiln", x: 7.5, z: -51.5, rotY: -Math.PI / 2 },
  { kind: "crates", x: 28, z: -73 },
  { kind: "crates", x: 51, z: -73, rotY: Math.PI / 2 },
  // ===== the Ashwood ===============================================================
  // The logging camp in the felled woods north of the village: the charcoal
  // kilns with their mouths to Wood Lane, the cordwood stacked round them,
  // the colliers' huts, and the look-out on its shelf over the north road.
  { kind: "kiln", x: 20, z: 71, rotY: Math.PI },
  { kind: "kiln", x: 30, z: 71, rotY: Math.PI },
  { kind: "kiln", x: 40, z: 71, rotY: Math.PI },
  { kind: "woodpile", x: 8, z: 80, rotY: Math.PI / 2, params: { length: 6 } },
  { kind: "woodpile", x: 40, z: 96, params: { length: 7 } },
  { kind: "woodpile", x: 36, z: 66, params: { length: 5 } },
  { kind: "shed", x: 12, z: 98, rotY: -Math.PI / 2, params: { width: 5, depth: 3.2 } },
  { kind: "shed", x: 50, z: 91, params: { width: 4, depth: 3 } },
  { kind: "cart", x: 38, z: 80 },
  { kind: "crates", x: 26, z: 79 },
  { kind: "watchtower", x: 32, z: 108 },
  { kind: "lamp", x: 24.5, z: 81, rotY: Math.PI },
  // ===== the east holdings =========================================================
  // Outlying farms along the Redline road: the tithe barn with its doors to
  // the road, a silo, the look-out on the swell, and the burnt-out steadings
  // between them.
  { kind: "barn", x: 104, z: -52, rotY: Math.PI / 2 },
  { kind: "silo", x: 110, z: -74 },
  { kind: "watchtower", x: 108, z: -26, rotY: Math.PI / 2 },
  { kind: "cottage", x: 104, z: -6, rotY: Math.PI / 2, params: { width: 8, depth: 6.2, litWindows: true } },
  { kind: "cottage", x: 76, z: -44, rotY: -Math.PI / 2, params: { width: 7.5, depth: 6, ruined: true } },
  { kind: "haystack", x: 100, z: -34 },
  { kind: "cart", x: 80, z: -74, params: { ruined: true } },
  { kind: "shrine", x: 82, z: -6 },
  // ===== the burying ground and the moor ===========================================
  // The plague ground on the moor road, walled, with the charnel house's
  // shell inside it; and past it the drowned crofts round the mire, with a
  // jetty out into it and the moor's look-out.
  { kind: "ruin", x: -30, z: -84, rotY: Math.PI, params: { width: 8, depth: 6 } },
  { kind: "shrine", x: -22, z: -69 },
  { kind: "cottage", x: -56, z: -68, rotY: Math.PI, params: { width: 7.5, depth: 6, ruined: true } },
  { kind: "cottage", x: -8, z: -58, rotY: Math.PI, params: { width: 7, depth: 6, ruined: true } },
  { kind: "kiln", x: -54, z: -80, rotY: Math.PI },
  { kind: "watchtower", x: -104, z: -84, rotY: Math.PI },
  { kind: "jetty", x: -58, z: -87.5, y: 0.4, params: { length: 14 } },
  // ===== the creek's west bank =====================================================
  // Two footbridges over the creek, bank to bank: one at the mill and one
  // under the chapel's hill where it comes in off the edge. Everywhere else
  // the creek is waded. A bridge samples the ground once, at its centre —
  // the creek's bed — so `y` lifts its local zero back to the lower bank.
  { kind: "bridge", x: -94.1, z: -30, y: 1.27, rotY: Math.PI / 2, params: { length: 18, width: 2.6 } },
  { kind: "bridge", x: -110, z: 29, y: 1.34, params: { length: 18, width: 2.6 } },
  { kind: "shed", x: -112, z: -56, rotY: Math.PI / 2, params: { width: 4, depth: 3 } },
  { kind: "ruin", x: -110, z: 50, params: { width: 8, depth: 6 } },
  // ===== the lanes =================================================================
  // Crofts strung out along the lanes where the village runs out into the
  // country, each turned to its lane. The further from the square, the more
  // of them are shells.
  { kind: "ruin", x: 11, z: 52.8, rotY: Math.PI / 2, params: { width: 7.9, depth: 6.6 } },
  { kind: "ruin", x: -16.4, z: -39, params: { width: 8.4, depth: 6.8 } },
  { kind: "cottage", x: -64.6, z: 21.9, rotY: Math.PI / 2, params: { width: 7.1, depth: 5.6, ruined: true } },
  { kind: "shed", x: 10, z: -32.9, params: { width: 3.4, depth: 3.1 } },
  { kind: "woodpile", x: -51.1, z: -33.2, params: { length: 4.3 } },
  { kind: "cart", x: -31.6, z: 11.1, rotY: -Math.PI / 2 },
  { kind: "crates", x: -51.7, z: 29.8, rotY: Math.PI },
  { kind: "crates", x: -31.5, z: -19.2 },
  { kind: "woodpile", x: -23.2, z: 19.2, rotY: Math.PI / 2, params: { length: 4.1 } },
  { kind: "shed", x: 26.9, z: -31.1, rotY: -Math.PI / 2, params: { width: 4, depth: 2.8 } },
  { kind: "shed", x: -45.5, z: 20.2, rotY: Math.PI, params: { width: 3.5, depth: 3.1 } },
  { kind: "woodpile", x: -52, z: -24.7, rotY: Math.PI, params: { length: 5 } },
  { kind: "cart", x: 20.6, z: 44.7, params: { ruined: true } },
  { kind: "woodpile", x: 15.3, z: -30, rotY: Math.PI / 2, params: { length: 3.8 } },
  // ===== the fields ================================================================
  // Every wall and fence line, cut into runs wherever a lane, a building or
  // the water crosses it — so the gates are where the lanes are. Dry stone
  // stops a round; post and rail stops only a body.
  { kind: "stoneWall", x: -70.8, z: 60, params: { length: 11.8 } },
  { kind: "stoneWall", x: -47.5, z: 60, params: { length: 10.3 } },
  { kind: "stoneWall", x: -78, z: 70, rotY: Math.PI / 2, params: { length: 11.3 } },
  { kind: "stoneWall", x: -78, z: 87, rotY: Math.PI / 2, params: { length: 10.3 } },
  { kind: "stoneWall", x: -78, z: 98.5, rotY: Math.PI / 2, params: { length: 10.3 } },
  { kind: "stoneWall", x: -42, z: 72.4, rotY: Math.PI / 2, params: { length: 20.1 } },
  { kind: "stoneWall", x: -42, z: 93.6, rotY: Math.PI / 2, params: { length: 20.1 } },
  { kind: "stoneWall", x: -68.1, z: 104, params: { length: 15.1 } },
  { kind: "stoneWall", x: -51.9, z: 104, params: { length: 15 } },
  { kind: "stoneWall", x: -60, z: -39, rotY: Math.PI / 2, params: { length: 17.3 } },
  { kind: "stoneWall", x: -60, z: -20.5, rotY: Math.PI / 2, params: { length: 17.3 } },
  { kind: "stoneWall", x: -60, z: 8, rotY: Math.PI / 2, params: { length: 13.3 } },
  { kind: "fence", x: 90.9, z: 14, params: { length: 13.6 } },
  { kind: "fence", x: 105.1, z: 14, params: { length: 13.6 } },
  { kind: "fence", x: 112, z: 24.9, rotY: Math.PI / 2, params: { length: 17.5 } },
  { kind: "fence", x: 112, z: 43, rotY: Math.PI / 2, params: { length: 17.3 } },
  { kind: "fence", x: 112, z: 61.1, rotY: Math.PI / 2, params: { length: 17.6 } },
  { kind: "fence", x: 60, z: 40, rotY: Math.PI / 2, params: { length: 18.8 } },
  { kind: "fence", x: 60, z: 61.3, rotY: Math.PI / 2, params: { length: 5.3 } },
  { kind: "stoneWall", x: 74.8, z: 76, params: { length: 13.9 } },
  { kind: "stoneWall", x: 89.8, z: 76, params: { length: 13.6 } },
  { kind: "stoneWall", x: 104.7, z: 76, params: { length: 13.9 } },
  { kind: "stoneWall", x: 80, z: 86.4, rotY: Math.PI / 2, params: { length: 16.1 } },
  { kind: "stoneWall", x: 80, z: 103.6, rotY: Math.PI / 2, params: { length: 16.1 } },
  { kind: "stoneWall", x: 67, z: 100, params: { length: 21.3 } },
  { kind: "stoneWall", x: 89.4, z: 100, params: { length: 14.1 } },
  { kind: "stoneWall", x: 104.6, z: 100, params: { length: 14.1 } },
  { kind: "stoneWall", x: -1.5, z: 64, params: { length: 4.3 } },
  { kind: "stoneWall", x: 22, z: 64, params: { length: 18.3 } },
  { kind: "stoneWall", x: 47.3, z: 64, params: { length: 12.8 } },
  { kind: "stoneWall", x: -10, z: 71.5, rotY: Math.PI / 2, params: { length: 14.4 } },
  { kind: "stoneWall", x: -10, z: 87, rotY: Math.PI / 2, params: { length: 14.1 } },
  { kind: "stoneWall", x: -10, z: 102.5, rotY: Math.PI / 2, params: { length: 14.4 } },
  { kind: "stoneWall", x: -1.1, z: 110, params: { length: 13.1 } },
  { kind: "stoneWall", x: 13.1, z: 110, params: { length: 13 } },
  { kind: "stoneWall", x: -30.1, z: 66, params: { length: 11 } },
  { kind: "stoneWall", x: -17.9, z: 66, params: { length: 11 } },
  { kind: "stoneWall", x: -28, z: 78.9, rotY: Math.PI / 2, params: { length: 21.1 } },
  { kind: "stoneWall", x: -28, z: 101.1, rotY: Math.PI / 2, params: { length: 21.1 } },
  { kind: "stoneWall", x: 70, z: -76.5, rotY: Math.PI / 2, params: { length: 14.3 } },
  { kind: "stoneWall", x: 70, z: -50.6, rotY: Math.PI / 2, params: { length: 16 } },
  { kind: "stoneWall", x: 70, z: -33.5, rotY: Math.PI / 2, params: { length: 15.8 } },
  { kind: "stoneWall", x: 70, z: -16.4, rotY: Math.PI / 2, params: { length: 16 } },
  { kind: "fence", x: 97, z: -40, params: { length: 12.8 } },
  { kind: "fence", x: 110.5, z: -40, params: { length: 12.8 } },
  { kind: "stoneWall", x: 83.3, z: -86, params: { length: 13.8 } },
  { kind: "stoneWall", x: 47.3, z: -52, params: { length: 12.8 } },
  { kind: "stoneWall", x: 61.3, z: -52, params: { length: 12.8 } },
  { kind: "stoneWall", x: -40, z: -64, params: { length: 11.3 } },
  { kind: "stoneWall", x: -21, z: -64, params: { length: 9.3 } },
  { kind: "stoneWall", x: -46, z: -76.5, rotY: Math.PI / 2, params: { length: 20.3 } },
  { kind: "stoneWall", x: -16, z: -85.6, rotY: Math.PI / 2, params: { length: 12.1 } },
  { kind: "stoneWall", x: -16, z: -72.4, rotY: Math.PI / 2, params: { length: 12.1 } },
  { kind: "stoneWall", x: -36.1, z: -92, params: { length: 11 } },
  { kind: "stoneWall", x: -23.9, z: -92, params: { length: 11 } },
  { kind: "stoneWall", x: -105, z: -60, params: { length: 21.3 } },
  { kind: "stoneWall", x: -33.8, z: -100, params: { length: 14.8 } },
  { kind: "stoneWall", x: -17.8, z: -100, params: { length: 14.8 } },
  { kind: "fence", x: -10, z: -109, rotY: Math.PI / 2, params: { length: 13.8 } },
  { kind: "fence", x: -10, z: -89.5, rotY: Math.PI / 2, params: { length: 16.8 } },
  { kind: "fence", x: -10, z: -72, rotY: Math.PI / 2, params: { length: 16.8 } },
  { kind: "stoneWall", x: -110.3, z: 76, params: { length: 10.8 } },
  { kind: "stoneWall", x: -98.3, z: 76, params: { length: 10.8 } },
  { kind: "fence", x: -84, z: 105, rotY: Math.PI / 2, params: { length: 21.8 } },
  { kind: "haystack", x: 66, z: 84 },
  { kind: "haystack", x: 92, z: 84 },
  { kind: "haystack", x: 100, z: 90 },
  { kind: "haystack", x: 78, z: -68 },
  { kind: "haystack", x: -4, z: -76 },
  { kind: "trough", x: 70, z: 90 },
  { kind: "trough", x: -104, z: 66, rotY: Math.PI / 2 },
  { kind: "ruin", x: -4, z: 72, rotY: -Math.PI / 2, params: { width: 9, depth: 7 } },
  { kind: "cart", x: -20, z: 100, params: { ruined: true } },
  { kind: "cart", x: -96, z: -70, params: { ruined: true } },
  { kind: "shrine", x: 58, z: -40 },
  { kind: "shrine", x: -86, z: 40 },
];

/**
 * Dressing. Every stand below was checked by the generator against the
 * finished floor — dry, clear of every building and yard, and under a grade a
 * tree stands on. A road rejects what grows by itself (`world/roads.ts`), and
 * blocking props are held off every flag and spawn by `MapBuilder.keepClear`.
 */
const scatter: ScatterSpec[] = [
  // ===== the churchyard ============================================================
  // Headstones either side of the nave and behind it, and the yews — dead
  // like everything else here — in the corners. Kept off the paths.
  { prop: "gravestone", x: -72.5, z: 82, width: 8, depth: 30, count: 14, scale: [0.8, 1.3], blocking: true, clearance: 0.6 },
  { prop: "gravestone", x: -47.5, z: 82, width: 8, depth: 30, count: 14, scale: [0.8, 1.3], blocking: true, clearance: 0.6 },
  { prop: "gravestone", x: -60, z: 101, width: 14, depth: 3.5, count: 6, scale: [0.8, 1.3], blocking: true, clearance: 0.6 },
  { prop: "gravestone", x: -71, z: 64, width: 9, depth: 3, count: 4, scale: [0.8, 1.3], blocking: true, clearance: 0.6 },
  { prop: "gravestone", x: -50, z: 64, width: 10, depth: 3, count: 4, scale: [0.8, 1.3], blocking: true, clearance: 0.6 },
  // ===== the burying ground ========================================================
  { prop: "gravestone", x: -40, z: -76, width: 9, depth: 14, count: 13, scale: [0.8, 1.3], blocking: true, clearance: 0.6 },
  { prop: "gravestone", x: -20.5, z: -78, width: 5, depth: 14, count: 7, scale: [0.8, 1.3], blocking: true, clearance: 0.6 },
  // ===== the dead woods ============================================================
  // The blight's own woods, sown against the finished floor: a stand is a
  // disc checked dry, clear of every building and yard, and under a grade a
  // tree stands on. Thickest on the hills and at the edges; the village, the
  // flags and the fields between them are left open.
  { prop: "deadTree", x: -114, z: -110.5, radius: 3.5, count: 1, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  { prop: "bramble", x: -114, z: -110.5, radius: 3.5, count: 2, scale: [0.8, 1.4] },
  { prop: "deadTree", x: -98.8, z: -112.9, radius: 3.5, count: 1, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  { prop: "bramble", x: -98.8, z: -112.9, radius: 3.5, count: 2, scale: [0.8, 1.4] },
  { prop: "deadTree", x: -39.5, z: -113.4, radius: 3.5, count: 1, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  { prop: "bramble", x: -39.5, z: -113.4, radius: 3.5, count: 2, scale: [0.8, 1.4] },
  { prop: "deadTree", x: -21.5, z: -109.9, radius: 6, count: 4, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  { prop: "bramble", x: -21.5, z: -109.9, radius: 6, count: 3, scale: [0.8, 1.4] },
  { prop: "deadTree", x: -8.5, z: -108.9, radius: 9, count: 8, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  { prop: "bramble", x: -8.5, z: -108.9, radius: 9, count: 6, scale: [0.8, 1.4] },
  { prop: "deadTree", x: -113.5, z: -94, radius: 3.5, count: 1, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  { prop: "bramble", x: -113.5, z: -94, radius: 3.5, count: 2, scale: [0.8, 1.4] },
  { prop: "deadTree", x: -96.9, z: -98.4, radius: 3.5, count: 1, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  { prop: "deadTree", x: -35.9, z: -94.2, radius: 3.5, count: 1, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  { prop: "bramble", x: -35.9, z: -94.2, radius: 3.5, count: 2, scale: [0.8, 1.4] },
  { prop: "deadTree", x: -19.2, z: -99, radius: 6, count: 4, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  { prop: "bramble", x: -19.2, z: -99, radius: 6, count: 3, scale: [0.8, 1.4] },
  { prop: "deadTree", x: -3.8, z: -96.3, radius: 6, count: 3, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  { prop: "deadTree", x: 100.5, z: -93, radius: 3.5, count: 1, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  { prop: "deadTree", x: -112.7, z: -67.6, radius: 3.5, count: 1, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  { prop: "deadTree", x: -114.4, z: -2.8, radius: 3.5, count: 1, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  { prop: "deadTree", x: 102.9, z: 5.9, radius: 6, count: 4, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  { prop: "deadTree", x: -93.9, z: 40.3, radius: 6, count: 3, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  { prop: "bramble", x: -93.9, z: 40.3, radius: 6, count: 2, scale: [0.8, 1.4] },
  { prop: "deadTree", x: -96.4, z: 50.2, radius: 6, count: 3, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  { prop: "deadTree", x: -110.5, z: 70, radius: 3.5, count: 1, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  { prop: "bramble", x: -110.5, z: 70, radius: 3.5, count: 2, scale: [0.8, 1.4] },
  { prop: "deadTree", x: -99.3, z: 72, radius: 3.5, count: 1, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  { prop: "bramble", x: -99.3, z: 72, radius: 3.5, count: 2, scale: [0.8, 1.4] },
  { prop: "deadTree", x: -33.2, z: 99.4, radius: 6, count: 3, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  { prop: "bramble", x: -33.2, z: 99.4, radius: 6, count: 2, scale: [0.8, 1.4] },
  { prop: "deadTree", x: -7.7, z: 98.6, radius: 6, count: 3, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  { prop: "bramble", x: -7.7, z: 98.6, radius: 6, count: 2, scale: [0.8, 1.4] },
  { prop: "deadTree", x: 51, z: 99.8, radius: 6, count: 3, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  { prop: "bramble", x: 51, z: 99.8, radius: 6, count: 2, scale: [0.8, 1.4] },
  { prop: "deadTree", x: 68.8, z: 100, radius: 6, count: 3, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  { prop: "deadTree", x: 85.3, z: 99.4, radius: 9, count: 8, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  { prop: "bramble", x: 85.3, z: 99.4, radius: 9, count: 6, scale: [0.8, 1.4] },
  { prop: "deadTree", x: -50.6, z: 112.3, radius: 3.5, count: 1, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  { prop: "bramble", x: -50.6, z: 112.3, radius: 3.5, count: 2, scale: [0.8, 1.4] },
  { prop: "deadTree", x: -23.6, z: 110.6, radius: 6, count: 4, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  { prop: "bramble", x: -23.6, z: 110.6, radius: 6, count: 3, scale: [0.8, 1.4] },
  { prop: "deadTree", x: 6.7, z: 113.9, radius: 3.5, count: 1, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  { prop: "bramble", x: 6.7, z: 113.9, radius: 3.5, count: 2, scale: [0.8, 1.4] },
  { prop: "deadTree", x: 41.9, z: 112.7, radius: 3.5, count: 1, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  { prop: "bramble", x: 41.9, z: 112.7, radius: 3.5, count: 2, scale: [0.8, 1.4] },
  { prop: "deadTree", x: 56.4, z: 111.4, radius: 6, count: 4, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  { prop: "deadTree", x: 67.3, z: 110, radius: 6, count: 3, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  { prop: "deadTree", x: 100.1, z: 114.1, radius: 3.5, count: 1, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  // ===== the water's edges =========================================================
  // Fallen logs in the creek and the pools, and corpse-fungus on their banks —
  // the only light down there. Emissive, so each region is kept small.
  { prop: "log", x: -89.4, z: -52.1, radius: 3, count: 2, scale: [0.8, 1.2], blocking: true, clearance: 1.4 },
  { prop: "log", x: -64, z: -94, radius: 3, count: 2, scale: [0.8, 1.2], blocking: true, clearance: 1.4 },
  { prop: "fungus", x: -84, z: -48, radius: 6, count: 3, scale: [0.8, 1.4] },
  { prop: "fungus", x: -98, z: 8, radius: 6, count: 3, scale: [0.8, 1.4] },
  { prop: "fungus", x: -70, z: -86, radius: 8, count: 4, scale: [0.8, 1.4] },
  { prop: "fungus", x: 24, z: -84, radius: 8, count: 3, scale: [0.8, 1.4] },
  { prop: "fungus", x: 56, z: -84, radius: 8, count: 3, scale: [0.8, 1.4] },
  { prop: "fungus", x: 40, z: -96, radius: 8, count: 3, scale: [0.8, 1.4] },
  { prop: "log", x: 30, z: -92, radius: 6, count: 3, scale: [0.8, 1.2], blocking: true, clearance: 1.4 },
  { prop: "log", x: 50, z: -94, radius: 6, count: 3, scale: [0.8, 1.2], blocking: true, clearance: 1.4 },
  { prop: "log", x: -66, z: -94, radius: 6, count: 3, scale: [0.8, 1.2], blocking: true, clearance: 1.4 },
  // ===== the fire's leavings =======================================================
  // Rubble in the burnt quarters, where the houses came down into the street
  // behind them. Kept off the carriageways by the region, not the prop:
  // rubble is not rooted, so a road does not refuse it by itself.
  { prop: "rubble", x: 29.9, z: -12.7, radius: 2.5, count: 2, scale: [0.8, 1.2], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: -40.5, z: 13.7, radius: 2.5, count: 2, scale: [0.8, 1.2], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: 42.9, z: 40.1, radius: 2.5, count: 2, scale: [0.8, 1.2], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: -31.4, z: 48.8, radius: 2.5, count: 2, scale: [0.8, 1.2], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: 21.5, z: -43.2, radius: 2.5, count: 2, scale: [0.8, 1.2], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: 50.4, z: -43.9, radius: 2.5, count: 2, scale: [0.8, 1.2], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: -50.2, z: -43.1, radius: 2.5, count: 2, scale: [0.8, 1.2], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: 7, z: -60, radius: 2.5, count: 2, scale: [0.8, 1.2], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: 1, z: -70, radius: 2.5, count: 2, scale: [0.8, 1.2], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: -110, z: 57, radius: 2.5, count: 2, scale: [0.8, 1.2], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: 18, z: 52.8, radius: 2.5, count: 2, scale: [0.8, 1.2], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: -57.6, z: 21.9, radius: 2.5, count: 2, scale: [0.8, 1.2], blocking: true, clearance: 1.1 },
  // ===== the yards' spill ==========================================================
  { prop: "barrel", x: -15, z: -4, radius: 2, count: 2, blocking: true, clearance: 0.55 },
  { prop: "barrel", x: 15, z: -6, radius: 2, count: 2, blocking: true, clearance: 0.55 },
  { prop: "barrel", x: -84, z: -36, radius: 3, count: 3, blocking: true, clearance: 0.55 },
  { prop: "barrel", x: 92, z: 58, radius: 3, count: 3, blocking: true, clearance: 0.55 },
  { prop: "barrel", x: 44, z: -65, radius: 3, count: 3, blocking: true, clearance: 0.55 },
  { prop: "barrel", x: 26, z: 80, radius: 3, count: 3, blocking: true, clearance: 0.55 },
  { prop: "log", x: 50, z: 74, radius: 4, count: 3, scale: [0.8, 1.2], blocking: true, clearance: 1.4 },
  { prop: "boulder", x: -104, z: -104, radius: 7, count: 4, scale: [0.8, 1.3], blocking: true, clearance: 1.0 },
  // ===== the braziers ==============================================================
  // Fires the defenders left burning. Sparse: each one spends a light slot.
  { prop: "fireDrum", x: 6, z: -14, radius: 2, count: 1, blocking: true, clearance: 0.6 },
  { prop: "fireDrum", x: -70, z: -24, radius: 2, count: 1, blocking: true, clearance: 0.6 },
  { prop: "fireDrum", x: 80, z: 52, radius: 2, count: 1, blocking: true, clearance: 0.6 },
  { prop: "fireDrum", x: -94, z: 98, radius: 2, count: 1, blocking: true, clearance: 0.6 },
  { prop: "fireDrum", x: 94, z: -98, radius: 2, count: 1, blocking: true, clearance: 0.6 },
  { prop: "fireDrum", x: 34, z: -66, radius: 2, count: 1, blocking: true, clearance: 0.6 },
  // ===== the open ground ===========================================================
  // Brambles over the fields and the moor: undergrowth a body and a round both pass.
  { prop: "bramble", x: -20, z: 88, width: 26, depth: 30, count: 12, scale: [0.8, 1.4] },
  { prop: "bramble", x: -104, z: 70, width: 20, depth: 16, count: 7, scale: [0.8, 1.4] },
  { prop: "bramble", x: 86, z: 88, width: 30, depth: 20, count: 10, scale: [0.8, 1.4] },
  { prop: "bramble", x: -86, z: -84, width: 26, depth: 22, count: 10, scale: [0.8, 1.4] },
  { prop: "bramble", x: -2, z: -88, width: 20, depth: 20, count: 9, scale: [0.8, 1.4] },
  { prop: "bramble", x: 92, z: -40, width: 16, depth: 20, count: 7, scale: [0.8, 1.4] },
  { prop: "bramble", x: 40, z: -44, width: 26, depth: 10, count: 6, scale: [0.8, 1.4] },
  { prop: "bramble", x: -12, z: 58, width: 16, depth: 8, count: 5, scale: [0.8, 1.4] },
  { prop: "bramble", x: 70, z: -20, width: 10, depth: 30, count: 7, scale: [0.8, 1.4] },
  // ===== THE COUNTRY BEYOND THE PLAY SQUARE ==================================
  // Appended LAST, and the order is mechanical: every region draws from one
  // seeded stream in array order, so a region spliced in above re-rolls every
  // field below it.
  //
  // WHY IT IS HERE AT ALL. `borderland` takes the rim away, and a margin with
  // nothing standing on it is not "the valley keeps going" — it is a plane
  // fading to `fogColor`, which reads as a backdrop. What tells an eye that
  // ground recedes is stuff standing ON it at intervals, and in this valley
  // that is dead wood.
  //
  // THIS BLOCK IS READ FROM FORTY METRES, WHICH IS WHAT MAKES IT A DIFFERENT
  // PROBLEM FROM HARROWMEAD'S. That map's borderland is looked at from three
  // hundred metres through half a fog, so it holds nothing smaller than a tree
  // and nothing nearer than a 90 m collar. Here `fogEnd` is 78, so the
  // borderland anybody ever sees is the 78 m nearest them and the far three
  // fifths of the margin is fog insurance. Everything below is therefore at
  // READING distance, and there is NO BARE COLLAR: the dead woods fill the
  // map's edges, so a bare ring here would be a firebreak cut round a valley
  // that does not have one. The blight carries on instead.
  //
  // WHICH MEANS A LIVING PLAYER REACHES THIS, so none of it blocks: a blocking
  // prop out here would be a collider outside the nav grid, geometry the bots
  // can neither see nor route around, and something to CATCH a player
  // sprinting home against a countdown. The bare dead tree is 0.7 m across,
  // so there is nothing to hide behind; the boulders, which are opaque, are
  // held out past 25 m.
  //
  // IT IS NOT A RING. Each side is given the country the village already has
  // on it: the NORTH is the Ashwood the logging camp is cutting and is the
  // thickest, the WEST carries the creek's woods on, the EAST is the holdings'
  // rough grazing, and the SOUTH is the moor and the bog — the wet, open,
  // deliberately thinnest quarter, where what breaks the plane is standing
  // water rather than timber. The corners get their own: a side is 120 m of
  // square from the middle and a corner is 170.

  // NORTH — the Ashwood's own country, and the thickest side on the map.
  { prop: "deadTree", x: 88, z: 142, width: 64, depth: 40, count: 32, scale: [0.9, 1.7], clearance: 0.55 },
  { prop: "deadTree", x: 34, z: 172, width: 116, depth: 50, count: 68, scale: [0.9, 1.7], clearance: 0.55 },
  // Straddles the Valeguard track and the north road on purpose: `findSpot`
  // holds anything ROOTED off a carriageway, so each road cuts its own avenue
  // through the stand rather than the layout carving a gap by hand.
  { prop: "deadTree", x: -66, z: 148, width: 116, depth: 48, count: 56, scale: [0.9, 1.7], clearance: 0.55 },
  { prop: "boulder", x: -30, z: 158, width: 100, depth: 24, count: 10, scale: [0.8, 1.3], clearance: 1.0 },
  // The far line, aimed at a player who is already dying: from the leash
  // limit at z = 189 the fog reaches 267.
  { prop: "deadTree", x: 0, z: 214, width: 250, depth: 18, count: 28, scale: [0.9, 1.7], clearance: 0.55 },

  // WEST — the creek comes in under the chapel's hill at z = 30, and the
  // stands sit either side of where its channel runs on out.
  { prop: "deadTree", x: -150, z: 84, width: 50, depth: 80, count: 30, scale: [0.9, 1.5], clearance: 0.55 },
  { prop: "bramble", x: -138, z: -10, width: 20, depth: 60, count: 18, scale: [0.8, 1.4] },
  { prop: "deadTree", x: -154, z: -40, width: 50, depth: 80, count: 30, scale: [0.9, 1.7], clearance: 0.55 },

  // SOUTH — the moor and the bog going on. What the moor has that the woods do
  // not is WATER, so the timber out here stays thinner than the north's and
  // the pools do the work. Held off the two channels that run out of the
  // square: the creek at x = -56 and the bog between x = 13 and 63.
  { prop: "deadTree", x: -100, z: -140, width: 70, depth: 40, count: 26, scale: [0.9, 1.7], clearance: 0.55 },
  { prop: "deadTree", x: -18, z: -142, width: 50, depth: 36, count: 16, scale: [0.9, 1.7], clearance: 0.55 },
  { prop: "bramble", x: -60, z: -132, width: 110, depth: 22, count: 26, scale: [0.8, 1.4] },
  { prop: "boulder", x: -90, z: -164, width: 60, depth: 30, count: 8, scale: [0.8, 1.3], clearance: 1.0 },
  // Corpse-fungus on the bog's far shore — emissive, so six is a shore and
  // thirty would be a runway.
  { prop: "fungus", x: 38, z: -152, width: 56, depth: 30, count: 6, scale: [0.8, 1.4] },
  { prop: "deadTree", x: 94, z: -150, width: 54, depth: 44, count: 22, scale: [0.9, 1.7], clearance: 0.55 },

  // EAST — the holdings' rough grazing.
  { prop: "deadTree", x: 146, z: -34, width: 44, depth: 76, count: 26, scale: [0.8, 1.4], clearance: 0.55 },
  { prop: "bramble", x: 130, z: 40, width: 16, depth: 80, count: 18, scale: [0.8, 1.4] },
  { prop: "deadTree", x: 150, z: 60, width: 40, depth: 60, count: 20, scale: [0.9, 1.7], clearance: 0.55 },

  // THE CORNERS, wide enough to meet the two sides either side of them.
  { prop: "deadTree", x: 158, z: 156, radius: 34, count: 40, scale: [0.9, 1.7], clearance: 0.55 },
  { prop: "deadTree", x: -158, z: 152, radius: 30, count: 30, scale: [0.9, 1.7], clearance: 0.55 },
  { prop: "deadTree", x: -156, z: -154, radius: 34, count: 40, scale: [0.9, 1.7], clearance: 0.55 },
  { prop: "deadTree", x: 152, z: -152, radius: 30, count: 30, scale: [0.9, 1.7], clearance: 0.55 },
];

const controlPoints: ControlPointDef[] = [
  { id: "A", name: "The Chapel", pos: new Vector3(-60, 5, 84), radius: 14, poleLift: 5.4 },
  { id: "B", name: "The Mill", pos: new Vector3(-80, -0.61, -27), radius: 13 },
  { id: "C", name: "The Square", pos: new Vector3(0, 0.6, -3), radius: 14 },
  { id: "D", name: "The Farmstead", pos: new Vector3(86, 2.5, 36), radius: 13, poleLift: 3.4 },
  { id: "E", name: "The Bog Docks", pos: new Vector3(40, -0.3, -76.3), radius: 12, poleLift: 4.3 },
];

/**
 * Home spawns are uncapturable, and deploy on the village side of the
 * gatehouse barricades. Every control point also carries a spawn just outside
 * its capture zone, so deploying onto a flag you hold does not drop you on top
 * of whoever is contesting it.
 */
const spawns: SpawnPointDef[] = [
  { team: 0, pos: new Vector3(-107, 3.25, 96), yaw: Math.PI },
  { team: 0, pos: new Vector3(-93, 3.45, 96), yaw: Math.PI },
  { team: 0, pos: new Vector3(-113, 3.25, 96), yaw: Math.PI },
  { team: 1, pos: new Vector3(93, -0.5, -96), yaw: 0 },
  { team: 1, pos: new Vector3(107, -0.5, -96), yaw: 0 },
  { team: 1, pos: new Vector3(87, -0.5, -96), yaw: 0 },
  { team: null, controlPoint: "A", pos: new Vector3(-60, 4.86, 62), yaw: Math.PI },
  { team: null, controlPoint: "B", pos: new Vector3(-72, -0.45, -43), yaw: 0 },
  { team: null, controlPoint: "C", pos: new Vector3(1, 0.42, -21), yaw: 0 },
  { team: null, controlPoint: "D", pos: new Vector3(64, 2.38, 54), yaw: Math.PI / 2 },
  { team: null, controlPoint: "E", pos: new Vector3(26, -0.44, -64.3), yaw: Math.PI },
];

/**
 * Standing water, the creek and the bog, cut in `heights.ts` to one bed so
 * each rect is wet exactly where the water is and dry everywhere the floor
 * stands above it. Ankle-deep, so bots and the player wade across — no
 * swimming, and the nav grid never hears about it.
 */
const water: WaterRect[] = [
  // The creek, from where it comes in off the west edge under the chapel's
  // hill, down past the mill and through the mire, to where it leaves off the
  // south edge. It RUNS — it turns a waterwheel — which is why it is the one
  // body here that says so (`WaterRect.sound`).
  { x: -85, z: -62, width: 110, depth: 206, y: -1.3, sound: "stream" },
  // The bog: the pool the boathouse and the jetties stand in. It runs OUT of
  // the map to the south, and that is a fix rather than dressing: its south
  // edge on the play square would be a straight waterline cut across the
  // marsh, read from the docks at thirty-five metres. Past the square the bed
  // is the clamped edge row plus `borderRoll`, so the pool's far shore is
  // wherever the two happen to cross — and nobody sees it through the fog.
  { x: 38, z: -126, width: 66, depth: 104, y: -1.3 },
];

/**
 * Grass fields. Pale, dead, knee-high — the valley's one crop that still
 * grows. `density` is how LUSH, 0..1 of the quality rung's field, and never a
 * count: the field is drawn around the eye, so a rect's area costs nothing.
 * Roads, structures, fences and props clear themselves (the grass mask refuses
 * a carriageway and a collider's footprint both). Grass under a water rect's
 * surface grows thinner and taller as reeds, and lays no turf.
 */
const grass: GrassRect[] = [
  // The churchyard, grown rough between the stones but kept under them.
  { x: -60, z: 82, width: 38, depth: 46, density: 0.7, height: 0.55 },
  // The creek's dell: reeds in the water and long grass up both banks.
  { x: -85, z: -10, width: 34, depth: 80, density: 0.8 },
  // The mire and the bog: reeds through the shallows and round the jetties.
  { x: -66, z: -95, width: 40, depth: 30, height: 1.1 },
  { x: 38, z: -88, width: 56, depth: 30, height: 1.1 },
  // The farmstead's paddocks — tall grass over the open sightlines at D.
  { x: 86, z: 36, width: 52, depth: 48, density: 0.9, height: 1.3 },
  // The Ashwood's clearings.
  { x: 30, z: 84, width: 44, depth: 34, density: 0.7, height: 0.9 },
  // The burying ground and the moor round it.
  { x: -30, z: -78, width: 36, depth: 30, density: 0.8, height: 0.9 },
  // The Valeguard upland.
  { x: -98, z: 70, width: 34, depth: 36, density: 0.8 },
  // The east holdings' rough grazing.
  { x: 92, z: -40, width: 36, depth: 70, density: 0.75, height: 1.1 },
  // The fields under the chapel's hill.
  { x: -30, z: 84, width: 30, depth: 44, density: 0.75 },
  // The fields between the farm and the woods.
  { x: 80, z: 92, width: 50, depth: 40, density: 0.6, height: 0.9 },
  // The strip between the village and the bog.
  { x: 40, z: -44, width: 40, depth: 14, density: 0.7, height: 0.9 },
  // The moor.
  { x: -100, z: -70, width: 36, depth: 40, density: 0.8 },
];

export const HollowmereLayout: MapLayout = {
  placements,
  scatter,
  controlPoints,
  spawns,
  water,
  grass,
  /**
   * **No wall.** The valley is not closed by anything you can walk up to: the
   * blight carries on for a hundred and eighty metres past the play square and
   * what stops you is the leash, a countdown rather than a face of rock. See
   * `Borderland`, and `world/leash.ts` for the rule.
   *
   * **The margin is the HORIZON's, and on this map the horizon is 78 m.** The
   * cel shader's fog is LINEAR between `fogStart` and `fogEnd`, so a surface
   * reaches exactly `fogColor` at `fogEnd` and not one metre before it, and
   * ground that stops any nearer than that arrives on screen at some fraction
   * of its own colour against a sky dome painted flat `fogColor` below the
   * horizon — a line drawn round the world. So the edge has to be `fogEnd`
   * from the furthest an EYE gets: the play edge plus the leash's 69 m is 147,
   * the death cam's orbit stands 3.4 m further out and a blast can throw a body
   * further still, and 180 is that rounded up.
   *
   * **`roll` is left at its default 2.6.** The valley inside the square falls
   * a few metres north to south and rises to the chapel's hill, and the
   * borderland continues the field's own clamped edge — so the ground outside
   * already carries the valley's shape on out, and the two swells
   * `borderRoll` adds (about 370 m and 160 m) read as the same country going
   * on rather than as different country.
   *
   * **`ease` is stated**: the ramp defaults to a third of the margin, 60 m,
   * and on this map the leash strip and the VISIBLE borderland are nearly the
   * same 70-odd metres, so a 60 m ramp would spend four fifths of everything
   * anybody ever sees out here flattening it into a radial smear of the map's
   * own edge. 30 m puts full amplitude up while the ground is still only a
   * third fogged; the steepest gradient it can make is 0.10, against a
   * `MAX_WALKABLE_GRADE` of 0.4.
   */
  borderland: { margin: 180, ease: 30 },
  /**
   * **No rim at all.** The valley ends in more valley, and what closes the
   * horizon is the fog rather than a landform. `Ridge.ts` states the one
   * condition on taking `form: "none"`: a map may only draw nothing over its
   * own boundary if it has already laid something out there that reaches past
   * `fogEnd` on every bearing — which this map pays with the 180 m above, so
   * the two fields are one decision. `EnvironmentSpec.ridgeColor` and
   * `ridgeScreeColor` are still set and read by nothing here.
   */
  ridge: {
    form: "none",
  },
  // Fixed so the dressing — and the colliders blocking scatter emits, and so
  // the nav graph — is identical on every boot. Changing it rerolls the whole
  // scatter field, which is a visible change to the level: re-walk the flags.
  seed: 0x484c,
};
