/**
 * harrowmead/layout.ts — THE MAP, as data: structure placements, scatter
 * regions, control points, spawns, the hardstandings, the water and the grass.
 * The floor's shape is generated data and lives in heights.ts. Consumed by
 * MapBuilder; nothing here is code to special-case.
 * Gotchas that have already cost time: collider top faces within
 * CONFIG.nav.stepHeight of adjacent ground or bots treat decks as walls; a
 * control point's pos must NOT sit inside a PLACEMENT's collider; scatter
 * knows nothing about water, so every grove below was checked dry by the
 * generator; terrain steeper than a 0.4 gradient severs its own nav links.
 *
 * **SEEDED by `scripts/generate-harrowmead.mjs`, and owned by the editor after
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
  VehicleSpawnDef,
  WaterRect,
} from "../layout";

/**
 * HARROWMEAD — a farming village in a broad green vale, high summer.
 *
 * **400 x 400 m**, origin at the market green, +Z is north. The ground
 * between flags is country rather than street: lanes, hedged fields and
 * rolling hills a hull can mean something on — and one does (see `vehicles`).
 *
 * ```
 *                              N
 *   +---------------------------------------------------------+
 *   | ~ knoll wood ~          north farm           x T1 HOME  |
 *   |  millpond                           [D] ORCHARD HILL    |
 *   | ~~~~\  [A] THE MILL   mill lane      (104,100)  orchard |
 *   |     \~~ (-91,60)        fordside  ~~~~~~~~ east ford ~~~|
 *   |    mill ford  ~~~~~ church  inn ~~~~~~~            ~~~~~ |
 *   |   Brookside       [C] THE MARKET GREEN   Eastfield       |
 *   |                  ===== Main Street =====                 |
 *   |  [B] THE GRANGE      south track      [E] THE KILN YARD |
 *   |    (-94,-94)         Southfield          (98,-62)        |
 *   | x T0 HOME                               ~ SE wood ~     |
 *   +---------------------------------------------------------+
 * ```
 *
 * ## A village, and why it reads as one
 *
 * The village grew where the valley road meets the brook's crossing, and it
 * is laid out the way one is: a GREEN with the well at its top and the market
 * on it, framed by four cobbled streets; the church and the coaching inn
 * across North Street from it, the church's tower to the brook and its
 * churchyard walled; terraces down West Lane and East Lane and along both
 * sides of Main Street, every one of them turned to its street; the smithy on
 * East Lane with its forge open to the green. Bridge Street runs north out of
 * the green to the WATERSPLASH — the lane fords the brook, and a footbridge
 * carries anybody on foot beside it — and on the north bank a few cottages
 * stand at the fork where the mill lane leaves the north road. Out of the
 * village the lanes run to the four other flags and to a farm between each
 * pair, and every one of them that meets the brook fords it.
 *
 * ## The vale, which is what the size buys
 *
 * The fog wall is gone (`fogEnd` 520 — see environment.ts) and
 * `bots.perception.engageRange` (55) did not move with it, so this layout is
 * built knowing the two disagree. What breaks the sightlines is GROUND and
 * FIELDS: the vale rolls a metre or two everywhere, the orchard hill stands
 * eight metres over the green, knolls stand in the fields between the flags,
 * and the brook runs a metre below its banks — so a 300 m lane is really a
 * chain of 50-70 m bounds between crests, and the field boundaries mark where
 * those bounds are, each with a line of hedgerow ash over it.
 *
 * ## Design intent per flag
 *
 * - **A The Mill** — the yard between the mill and the miller's house. The
 *   brook bends round it on the west and the south, so every approach but
 *   the mill lane from the east is a wade (or the mill ford, which is one).
 * - **B The Grange** — the big barn farm: one huge building with a loft to
 *   hold, the farmhouse across the yard, twin silos at the gate, ricks and
 *   paddocks behind.
 * - **C The Market Green** — the village: stalls round the flag, the well,
 *   and a ring of houses whose doors all open onto it. The buildings are the
 *   cover and every street is a lane of fire.
 * - **D Orchard Hill** — the high ground: a farm on the crown, a look-out on
 *   its east edge, and the orchard's rows down the slopes inside its walls.
 * - **E The Kiln Yard** — the brickworks: kilns, drying sheds and stacks of
 *   fuel, a close brawl in a map of long looks.
 *
 * ## Layout hygiene
 *
 * - Everything below is emitted by the generator, which REFUSES a building on
 *   a road, in the water, on a slope or with its door onto nothing, and a
 *   road in the water anywhere but a declared ford. Hand edits keep to those.
 * - Structures are axis-aligned (`rotY` in multiples of π/2). A builder's
 *   front is its local -Z: turn 0 faces south, π/2 west, π north, -π/2 east.
 * - Field walls and fences are cut at every lane, which is where the gates are.
 * - No lamps: the sun is still up, and a carried flame would spend one of the
 *   sixteen light slots proving nothing (Greyfen's rule).
 * - The ORDER of the scatter array is load-bearing: every region draws from
 *   one seeded stream, so a region added anywhere but the end re-rolls every
 *   field below it.
 */

/** Team 0's livery — harvest gold on the south-west gatehouse. */
const HARVEST = "#d8a53f";
/** Team 1's livery — drover oxblood on the north-east gatehouse. */
const DROVE = "#8c3f34";

const placements: Placement[] = [
  // ===== roads =====================================================================
  // Visual only: a road carries no collider, stops no round and is in no
  // baked structure. The village's streets round the green are COBBLE and
  // everything that leaves the village is a dirt lane. A lane crosses the
  // brook only at a FORD — the road dips through the water and a hull takes
  // it — and the village's ford has a footbridge beside it; the banks grade
  // at under 0.25 the whole run, so anybody wades it anywhere.
  { kind: "road", x: 0, z: -18.5, rotY: Math.PI / 2, params: { length: 124, width: 7, surface: "cobble" } },
  { kind: "road", x: 0, z: 18, rotY: Math.PI / 2, params: { length: 56, width: 6, surface: "cobble" } },
  { kind: "road", x: -25, z: 0, params: { length: 43, width: 6, surface: "cobble" } },
  { kind: "road", x: 25, z: 0, params: { length: 43, width: 6, surface: "cobble" } },
  { kind: "road", x: 0, z: 33, params: { length: 30, width: 6, surface: "cobble" } },
  { kind: "road", x: 48, z: 76, params: { path: [[-48, -30], [-48, 24], [-8, 30], [22, 28], [48, 26]], width: 6, surface: "dirt", radius: 12 } },
  { kind: "road", x: -39.5, z: 81, params: { path: [[36.5, 19], [9.5, 21], [-16.5, 11], [-28.5, -5], [-36.5, -21]], width: 5.5, surface: "dirt", radius: 30 } },
  { kind: "road", x: 139, z: 159, params: { path: [[-21, -47], [1, -25], [21, -9], [21, 47]], width: 6, surface: "dirt", radius: 30 } },
  { kind: "road", x: -76, z: -48.25, params: { path: [[16, 29.75], [4, 29.75], [-8, 14.25], [-14, -13.75], [-16, -29.75]], width: 6, surface: "dirt", radius: 30 } },
  { kind: "road", x: -132, z: -156, params: { path: [[28, 50], [0, 28], [-28, 6], [-28, -50]], width: 6, surface: "dirt", radius: 30 } },
  { kind: "road", x: 76, z: -32.25, params: { path: [[-16, 13.75], [-4, 13.75], [8, 0.25], [16, -13.75]], width: 6, surface: "dirt", radius: 30 } },
  { kind: "road", x: 2, z: -51, params: { path: [[-2, 31], [-2, -7], [2, -31]], width: 4.5, surface: "dirt", radius: 30 } },
  { kind: "road", x: -98, z: -6, params: { path: [[6, 58], [4, 34], [-2, 6], [-6, -28], [-2, -58]], width: 4.5, surface: "dirt", radius: 30 } },
  { kind: "road", x: 112, z: 19, params: { path: [[-8, 65], [6, 43], [12, 15], [6, -15], [-4, -45], [-12, -65]], width: 4.5, surface: "dirt", radius: 30 } },
  { kind: "road", x: -61.25, z: 16, params: { path: [[35.25, 2], [-0.75, 2], [-18.75, -1], [-35.25, -2]], width: 5, surface: "dirt", radius: 30 } },
  { kind: "road", x: 73.25, z: 20, params: { path: [[-47.25, -2], [-11.25, -2], [10.75, 2], [47.25, 0]], width: 5, surface: "dirt", radius: 30 } },
  // ===== home yards ================================================================
  // Each gatehouse arches over its home road where it leaves the map; the
  // barricades face out, toward the country the side came in from.
  { kind: "gatehouse", x: -160, z: -172, params: { teamColor: HARVEST } },
  { kind: "gatehouse", x: 160, z: 172, rotY: Math.PI, params: { teamColor: DROVE } },
  // ===== C: The Market Green =======================================================
  // The green is the middle of the village and of the map: a well at its
  // top, the market stalls round the flag, and every house round it turned
  // to face it — the church and the inn across North Street, a terrace down
  // each side lane, and Main Street's two frontages below.
  { kind: "well", x: 0, z: 9 },
  { kind: "stall", x: -12, z: -6 },
  { kind: "stall", x: 12, z: -6 },
  { kind: "stall", x: -10, z: 6, rotY: Math.PI },
  { kind: "stall", x: 11, z: 5, rotY: Math.PI },
  { kind: "trough", x: -17, z: 9, rotY: Math.PI / 2 },
  { kind: "trough", x: 17, z: -10, rotY: Math.PI / 2 },
  { kind: "cart", x: -16, z: -11 },
  { kind: "chapel", x: -15, z: 35 },
  { kind: "tavern", x: 14.5, z: 31 },
  { kind: "shed", x: 22, z: 43, rotY: Math.PI, params: { width: 6, depth: 3.4 } },
  { kind: "cart", x: 10, z: 42, rotY: Math.PI / 2 },
  { kind: "woodpile", x: 4.6, z: 40, rotY: Math.PI / 2, params: { length: 4 } },
  { kind: "smithy", x: 35.4, z: 6, rotY: Math.PI / 2 },
  { kind: "townhouse", x: -32.9, z: -9.8, rotY: -Math.PI / 2, params: { width: 6.4, depth: 6.3, litWindows: true } },
  { kind: "cottage", x: -33.2, z: -0.5, rotY: -Math.PI / 2, params: { width: 8.7, depth: 6.1, enterable: true } },
  { kind: "townhouse", x: -33, z: 10.1, rotY: -Math.PI / 2, params: { width: 6.7, depth: 6.4, enterable: true } },
  { kind: "townhouse", x: 33.6, z: -9.6, rotY: Math.PI / 2, params: { width: 6.8, depth: 6.9, litWindows: true } },
  { kind: "townhouse", x: -54.1, z: -27.5, rotY: Math.PI, params: { width: 6.7, depth: 6.6, enterable: true } },
  { kind: "townhouse", x: -46.1, z: -27.4, rotY: Math.PI, params: { width: 6.7, depth: 6.9 } },
  { kind: "townhouse", x: -38.4, z: -27.8, rotY: Math.PI, params: { width: 6.1, depth: 7 } },
  { kind: "townhouse", x: -30.8, z: -27.5, rotY: Math.PI, params: { width: 6.4, depth: 6.4, litWindows: true } },
  { kind: "townhouse", x: -22.8, z: -27.3, rotY: Math.PI, params: { width: 6.4, depth: 6.4, enterable: true, litWindows: true } },
  { kind: "townhouse", x: -14.8, z: -27.4, rotY: Math.PI, params: { width: 6.4, depth: 7, litWindows: true } },
  { kind: "townhouse", x: 7.5, z: -27.8, rotY: Math.PI, params: { width: 6, depth: 6.4 } },
  { kind: "townhouse", x: 15.3, z: -28, rotY: Math.PI, params: { width: 6.7, depth: 6.7, litWindows: true } },
  { kind: "townhouse", x: 23.1, z: -27.7, rotY: Math.PI, params: { width: 6.2, depth: 6.9, enterable: true } },
  { kind: "townhouse", x: 30.9, z: -27.7, rotY: Math.PI, params: { width: 6.7, depth: 6.5, litWindows: true } },
  { kind: "townhouse", x: 39, z: -27.8, rotY: Math.PI, params: { width: 6.6, depth: 6.7, enterable: true } },
  { kind: "townhouse", x: 47, z: -28.1, rotY: Math.PI, params: { width: 6.1, depth: 7, litWindows: true } },
  { kind: "cottage", x: -54.9, z: -8.8, params: { width: 8.7, depth: 6, litWindows: true } },
  { kind: "cottage", x: -42.5, z: -8.8, params: { width: 7.8, depth: 5.7 } },
  { kind: "cottage", x: 42.5, z: -9, params: { width: 7.3, depth: 6, litWindows: true } },
  { kind: "cottage", x: 55.3, z: -9.6, params: { width: 7.3, depth: 5.7 } },
  { kind: "cottage", x: -59.7, z: 26.5, params: { width: 7, depth: 5.9, enterable: true, litWindows: true } },
  { kind: "townhouse", x: -49.5, z: 26.6, params: { width: 6.6, depth: 6.8, enterable: true, litWindows: true } },
  { kind: "cottage", x: -39.9, z: 26.9, params: { width: 8.4, depth: 5.8, enterable: true } },
  { kind: "cottage", x: -59.8, z: 9.4, rotY: Math.PI, params: { width: 6.9, depth: 6.5 } },
  { kind: "cottage", x: -47.5, z: 9.5, rotY: Math.PI, params: { width: 6.8, depth: 6, litWindows: true } },
  { kind: "cottage", x: 34.9, z: 27.6, params: { width: 8.1, depth: 6.5, litWindows: true } },
  { kind: "cottage", x: 46.7, z: 26.6, params: { width: 7.3, depth: 5.8, enterable: true, litWindows: true } },
  { kind: "townhouse", x: 46, z: 8.6, rotY: Math.PI, params: { width: 7, depth: 6.6, litWindows: true } },
  { kind: "cottage", x: 55.5, z: 9.3, rotY: Math.PI, params: { width: 8.6, depth: 5.7 } },
  { kind: "cottage", x: -8.9, z: -51.7, rotY: -Math.PI / 2, params: { width: 7, depth: 6.1 } },
  { kind: "cottage", x: -8.2, z: -40, rotY: -Math.PI / 2, params: { width: 6.6, depth: 5.7, litWindows: true } },
  { kind: "townhouse", x: 8.6, z: -52, rotY: Math.PI / 2, params: { width: 7.1, depth: 6.4, litWindows: true } },
  { kind: "townhouse", x: 9.5, z: -43.5, rotY: Math.PI / 2, params: { width: 7, depth: 6.5 } },
  { kind: "shed", x: -39.5, z: 35.2, rotY: Math.PI / 2, params: { width: 3.4, depth: 2.9 } },
  { kind: "shed", x: -34.9, z: -49.2, params: { width: 3.1, depth: 3 } },
  { kind: "crates", x: -31.7, z: 37.4, rotY: Math.PI },
  { kind: "haystack", x: -45.5, z: -35.5, rotY: -Math.PI / 2 },
  { kind: "haystack", x: 25.8, z: 29.4, rotY: Math.PI },
  { kind: "haystack", x: 41, z: -39.1, rotY: Math.PI / 2 },
  { kind: "shed", x: 65.4, z: -8.4, rotY: -Math.PI / 2, params: { width: 3.3, depth: 2.8 } },
  { kind: "crates", x: -57.7, z: -43.9 },
  { kind: "shed", x: -37.9, z: -38.1, rotY: Math.PI, params: { width: 3.5, depth: 2.7 } },
  { kind: "woodpile", x: 17.6, z: -47.7 },
  { kind: "crates", x: 54, z: 2.1 },
  { kind: "shed", x: 24.8, z: -43.4, params: { width: 3.2, depth: 2.7 } },
  { kind: "shed", x: -4.1, z: -26.9, rotY: Math.PI / 2, params: { width: 4, depth: 2.8 } },
  { kind: "crates", x: 35.4, z: 34.8, rotY: Math.PI },
  { kind: "crates", x: -25.6, z: -38.5, rotY: Math.PI / 2 },
  { kind: "shed", x: 18.2, z: -36.6, rotY: -Math.PI / 2, params: { width: 3.8, depth: 2.7 } },
  { kind: "crates", x: -30.3, z: -38.8, rotY: -Math.PI / 2 },
  { kind: "woodpile", x: 37.1, z: -43.5, rotY: -Math.PI / 2 },
  { kind: "crates", x: -53.4, z: 2 },
  { kind: "haystack", x: 52.9, z: 40.7, rotY: -Math.PI / 2 },
  // ===== the fordside ==============================================================
  { kind: "bridge", x: 6.8, z: 72.5, y: 1.18, params: { length: 22, width: 2.4 } },
  { kind: "cottage", x: -9.9, z: 87.4, rotY: -Math.PI / 2, params: { width: 7.2, depth: 5.9, enterable: true } },
  { kind: "cottage", x: -27.9, z: 111.4, params: { width: 6.7, depth: 6.3, litWindows: true } },
  { kind: "cottage", x: -16.5, z: 110.9, params: { width: 8.2, depth: 5.7, litWindows: true } },
  { kind: "shrine", x: -7, z: 106 },
  // ===== A: The Mill ===============================================================
  // The mill stands on the brook's east bank where it runs south out of the
  // millpond, its wheel over the water and its lane door to the yard. The
  // brook bends round the yard's west and south sides, so every way in but
  // the mill lane from the east is a wade.
  { kind: "mill", x: -105.8, z: 70 },
  { kind: "cottage", x: -88, z: 77, params: { width: 9, depth: 6.5, enterable: true, litWindows: true } },
  { kind: "shed", x: -97, z: 79, params: { width: 5, depth: 3.2 } },
  { kind: "cart", x: -86, z: 66 },
  { kind: "crates", x: -99, z: 60 },
  { kind: "trough", x: -80, z: 60, rotY: Math.PI / 2 },
  { kind: "woodpile", x: -75, z: 56, rotY: Math.PI / 2, params: { length: 4 } },
  // ===== B: The Grange =============================================================
  // The big barn farm: the barn's cart doors to the yard and the rickyard,
  // its loft ramp up the east side, the farmhouse facing the yard across it,
  // twin silos at its gate and the paddocks south.
  { kind: "barn", x: -122, z: -92 },
  { kind: "townhouse", x: -76, z: -94, rotY: Math.PI / 2, params: { width: 9, depth: 7, enterable: true, litWindows: true } },
  { kind: "silo", x: -80, z: -76 },
  { kind: "silo", x: -72, z: -84 },
  { kind: "cottage", x: -104, z: -72, params: { width: 7, depth: 6, litWindows: true } },
  { kind: "shed", x: -96, z: -114, rotY: Math.PI, params: { width: 7, depth: 3.6 } },
  { kind: "haystack", x: -110, z: -120 },
  { kind: "haystack", x: -124, z: -110 },
  { kind: "cart", x: -100, z: -86, rotY: Math.PI / 2 },
  { kind: "cart", x: -88, z: -104, params: { ruined: true } },
  { kind: "trough", x: -86, z: -86, rotY: Math.PI / 2 },
  { kind: "woodpile", x: -104, z: -80 },
  { kind: "crates", x: -90, z: -83 },
  // ===== D: Orchard Hill ===========================================================
  // The farm on the hill's crown, the look-out over the vale on its east
  // edge, and the orchard down the south and west slopes inside its walls.
  { kind: "cottage", x: 106, z: 119, params: { width: 10, depth: 7, enterable: true, litWindows: true } },
  { kind: "watchtower", x: 128, z: 96, rotY: Math.PI },
  { kind: "shed", x: 94, z: 118, params: { width: 5, depth: 3.4 } },
  { kind: "cart", x: 116, z: 92, rotY: Math.PI / 2 },
  { kind: "haystack", x: 96, z: 90 },
  { kind: "trough", x: 104, z: 110 },
  { kind: "crates", x: 110, z: 90 },
  // ===== E: The Kiln Yard ==========================================================
  // A brickworks: three kilns in a row with their stoke holes to the yard,
  // the drying sheds, the stacks of fuel, and the kiln master's cottage at
  // the gate. A close brawl in a map of long looks.
  { kind: "kiln", x: 88, z: -77, rotY: Math.PI },
  { kind: "kiln", x: 98, z: -77, rotY: Math.PI },
  { kind: "kiln", x: 108, z: -77, rotY: Math.PI },
  { kind: "cottage", x: 74.5, z: -62, rotY: -Math.PI / 2, params: { width: 7.5, depth: 6, enterable: true, litWindows: true } },
  { kind: "shed", x: 114, z: -56, rotY: Math.PI / 2, params: { width: 10, depth: 4 } },
  { kind: "shed", x: 84, z: -84, rotY: Math.PI, params: { width: 10, depth: 4 } },
  { kind: "shed", x: 104, z: -84, rotY: Math.PI, params: { width: 8, depth: 4 } },
  { kind: "woodpile", x: 90, z: -56, rotY: Math.PI / 2, params: { length: 6 } },
  { kind: "woodpile", x: 108, z: -64, params: { length: 6 } },
  { kind: "woodpile", x: 118, z: -72, rotY: Math.PI / 2, params: { length: 5 } },
  { kind: "crates", x: 104, z: -52 },
  { kind: "cart", x: 84, z: -64, rotY: Math.PI / 2 },
  { kind: "ruin", x: 122, z: -86, params: { width: 9, depth: 7 } },
  // ===== the farms =================================================================
  // A farmhouse on each lane between the flags, facing its lane, with its
  // yard, a shed and its ricks: the cover a flank route is fought through.
  { kind: "cottage", x: -112, z: -4, rotY: -Math.PI / 2, params: { width: 9, depth: 6.5, enterable: true, litWindows: true } },
  { kind: "shed", x: -124, z: 4, params: { width: 6, depth: 3.4 } },
  { kind: "haystack", x: -126, z: -10 },
  { kind: "haystack", x: -120, z: -14 },
  { kind: "cart", x: -112, z: 8 },
  { kind: "woodpile", x: -122, z: -2, rotY: Math.PI / 2 },
  { kind: "cottage", x: 132, z: -4, rotY: Math.PI / 2, params: { width: 9, depth: 6.5, enterable: true, litWindows: true } },
  { kind: "shed", x: 144, z: 6, params: { width: 6, depth: 3.4 } },
  { kind: "haystack", x: 146, z: -8 },
  { kind: "haystack", x: 140, z: -12 },
  { kind: "cart", x: 134, z: 8 },
  { kind: "woodpile", x: 144, z: -2, rotY: Math.PI / 2 },
  { kind: "cottage", x: 4, z: -90, rotY: Math.PI, params: { width: 9, depth: 6.5, enterable: true, litWindows: true } },
  { kind: "shed", x: -8, z: -94, rotY: -Math.PI / 2, params: { width: 6, depth: 3.4 } },
  { kind: "haystack", x: 14, z: -96 },
  { kind: "haystack", x: 16, z: -88 },
  { kind: "cart", x: -6, z: -84, rotY: Math.PI / 2 },
  { kind: "trough", x: 12, z: -82 },
  { kind: "cottage", x: 30, z: 114, params: { width: 9, depth: 6.5, enterable: true, litWindows: true } },
  { kind: "shed", x: 40, z: 123, params: { width: 6, depth: 3.4 } },
  { kind: "haystack", x: 18, z: 122 },
  { kind: "haystack", x: 22, z: 126 },
  { kind: "cart", x: 41, z: 113, rotY: Math.PI / 2 },
  { kind: "woodpile", x: 18, z: 114, rotY: Math.PI / 2 },
  { kind: "cottage", x: -95, z: -44, rotY: -Math.PI / 2, params: { width: 7.5, depth: 6, litWindows: true } },
  { kind: "cottage", x: 78, z: -40, rotY: -Math.PI / 2, params: { width: 7.5, depth: 6, litWindows: true } },
  { kind: "shrine", x: -68, z: -27 },
  { kind: "shrine", x: 68, z: -27 },
  // ===== the fields ================================================================
  // Every field boundary, cut into runs wherever a lane, a yard, a flag or
  // the brook crosses it — so the gates are where the lanes are. Dry stone
  // stops a round; post and rail stops only a body.
  { kind: "stoneWall", x: -26, z: 31.1, rotY: Math.PI / 2, params: { length: 14.3 } },
  { kind: "stoneWall", x: -26, z: 45.9, rotY: Math.PI / 2, params: { length: 14.3 } },
  { kind: "stoneWall", x: -13.6, z: 56, params: { length: 15.9 } },
  { kind: "stoneWall", x: -5.6, z: 31.9, rotY: Math.PI / 2, params: { length: 15.8 } },
  { kind: "stoneWall", x: -70, z: 121.6, rotY: Math.PI / 2, params: { length: 16.8 } },
  { kind: "stoneWall", x: -98.9, z: 130, params: { length: 22.3 } },
  { kind: "stoneWall", x: -53.8, z: 130, params: { length: 22 } },
  { kind: "stoneWall", x: -31.1, z: 130, params: { length: 22.3 } },
  { kind: "stoneWall", x: 10, z: 119.9, rotY: Math.PI / 2, params: { length: 19.8 } },
  { kind: "stoneWall", x: 10, z: 140, rotY: Math.PI / 2, params: { length: 19.5 } },
  { kind: "stoneWall", x: 10, z: 160.1, rotY: Math.PI / 2, params: { length: 19.8 } },
  { kind: "stoneWall", x: 33.2, z: 140, params: { length: 22.4 } },
  { kind: "stoneWall", x: 56, z: 140, params: { length: 22.2 } },
  { kind: "stoneWall", x: 78.8, z: 140, params: { length: 22.4 } },
  { kind: "stoneWall", x: 43.6, z: 78, params: { length: 18.3 } },
  { kind: "stoneWall", x: 80.9, z: 78, params: { length: 18.3 } },
  { kind: "stoneWall", x: 88.1, z: 60, params: { length: 16.3 } },
  { kind: "stoneWall", x: 104.9, z: 60, params: { length: 16.3 } },
  { kind: "stoneWall", x: 129.5, z: 60, params: { length: 13 } },
  { kind: "stoneWall", x: 136, z: 91.3, rotY: Math.PI / 2, params: { length: 20.3 } },
  { kind: "stoneWall", x: 136, z: 112.2, rotY: Math.PI / 2, params: { length: 20.6 } },
  { kind: "fence", x: 149.4, z: 80, params: { length: 18.8 } },
  { kind: "fence", x: 168.5, z: 80, params: { length: 18.5 } },
  { kind: "stoneWall", x: 150, z: 49.9, rotY: Math.PI / 2, params: { length: 19.8 } },
  { kind: "stoneWall", x: 150, z: 70, rotY: Math.PI / 2, params: { length: 19.5 } },
  { kind: "stoneWall", x: 150, z: 90, rotY: Math.PI / 2, params: { length: 19.5 } },
  { kind: "stoneWall", x: 150, z: 110.1, rotY: Math.PI / 2, params: { length: 19.8 } },
  { kind: "stoneWall", x: 125, z: -20, params: { length: 20 } },
  { kind: "stoneWall", x: 145.4, z: -20, params: { length: 19.8 } },
  { kind: "stoneWall", x: 165.6, z: -20, params: { length: 19.8 } },
  { kind: "stoneWall", x: 186, z: -20, params: { length: 20 } },
  { kind: "stoneWall", x: 134.9, z: -44, params: { length: 17.8 } },
  { kind: "stoneWall", x: 171.1, z: -44, params: { length: 17.8 } },
  { kind: "stoneWall", x: 47, z: -60, params: { length: 14 } },
  { kind: "stoneWall", x: 61.5, z: -60, params: { length: 14 } },
  { kind: "fence", x: 48, z: -90.1, rotY: Math.PI / 2, params: { length: 19.8 } },
  { kind: "stoneWall", x: 69.9, z: -120, params: { length: 19.8 } },
  { kind: "stoneWall", x: 90, z: -120, params: { length: 19.5 } },
  { kind: "stoneWall", x: 110, z: -120, params: { length: 19.5 } },
  { kind: "stoneWall", x: 130.1, z: -120, params: { length: 19.8 } },
  { kind: "stoneWall", x: -47.6, z: -60, params: { length: 24.8 } },
  { kind: "stoneWall", x: -22.4, z: -60, params: { length: 24.8 } },
  { kind: "stoneWall", x: -18.5, z: -120, params: { length: 23.1 } },
  { kind: "stoneWall", x: 5, z: -120, params: { length: 22.8 } },
  { kind: "stoneWall", x: 28.5, z: -120, params: { length: 23.1 } },
  { kind: "stoneWall", x: -68, z: -150, params: { length: 24 } },
  { kind: "stoneWall", x: -19.3, z: -150, params: { length: 23.8 } },
  { kind: "stoneWall", x: 5, z: -150, params: { length: 23.8 } },
  { kind: "stoneWall", x: 53.6, z: -150, params: { length: 23.8 } },
  { kind: "stoneWall", x: 78, z: -150, params: { length: 24 } },
  { kind: "stoneWall", x: -113.3, z: -50, params: { length: 13.5 } },
  { kind: "stoneWall", x: -71.6, z: -50, params: { length: 20.8 } },
  { kind: "stoneWall", x: -50.4, z: -50, params: { length: 20.8 } },
  { kind: "fence", x: -66, z: -120.1, rotY: Math.PI / 2, params: { length: 19.8 } },
  { kind: "fence", x: -66, z: -100, rotY: Math.PI / 2, params: { length: 19.5 } },
  { kind: "fence", x: -66, z: -80, rotY: Math.PI / 2, params: { length: 19.5 } },
  { kind: "stoneWall", x: -180.1, z: -30, params: { length: 19.8 } },
  { kind: "stoneWall", x: -160, z: -30, params: { length: 19.5 } },
  { kind: "stoneWall", x: -140, z: -30, params: { length: 19.5 } },
  { kind: "stoneWall", x: -119.9, z: -30, params: { length: 19.8 } },
  { kind: "stoneWall", x: -179.5, z: 10, params: { length: 21.1 } },
  { kind: "stoneWall", x: -158, z: 10, params: { length: 20.8 } },
  { kind: "fence", x: -179.8, z: 60, params: { length: 20.4 } },
  { kind: "fence", x: -159, z: 60, params: { length: 20.2 } },
  { kind: "fence", x: -138.2, z: 60, params: { length: 20.4 } },
  { kind: "stoneWall", x: -180.2, z: -120, params: { length: 19.6 } },
  { kind: "stoneWall", x: -160.3, z: -120, params: { length: 19.3 } },
  { kind: "stoneWall", x: -140.3, z: -120, params: { length: 19.6 } },
  { kind: "fence", x: -120, z: -180.1, rotY: Math.PI / 2, params: { length: 19.8 } },
  { kind: "fence", x: -120, z: -160, rotY: Math.PI / 2, params: { length: 19.5 } },
  { kind: "fence", x: -120, z: -139.9, rotY: Math.PI / 2, params: { length: 19.8 } },
  { kind: "fence", x: 110, z: 139.9, rotY: Math.PI / 2, params: { length: 19.8 } },
  { kind: "fence", x: 110, z: 160, rotY: Math.PI / 2, params: { length: 19.5 } },
  { kind: "fence", x: 110, z: 180.1, rotY: Math.PI / 2, params: { length: 19.8 } },
  { kind: "stoneWall", x: 155, z: 130, params: { length: 23 } },
  { kind: "stoneWall", x: 178.5, z: 130, params: { length: 23 } },
  { kind: "haystack", x: -52, z: -80 },
  { kind: "haystack", x: -48, z: -84 },
  { kind: "haystack", x: 34, z: -132 },
  { kind: "haystack", x: 140, z: -98 },
  { kind: "haystack", x: -150, z: -60 },
  { kind: "haystack", x: -52, z: 112 },
  { kind: "haystack", x: 36, z: 150 },
  { kind: "haystack", x: 170, z: 100 },
  { kind: "trough", x: 30, z: -80 },
  { kind: "trough", x: -130, z: -40, rotY: Math.PI / 2 },
  { kind: "trough", x: 170, z: -30 },
  { kind: "trough", x: -90, z: 112 },
  { kind: "ruin", x: -150, z: 44, params: { width: 8, depth: 7 } },
  { kind: "cart", x: -150, z: -96, params: { ruined: true } },
  { kind: "cart", x: -20, z: 120 },
];

/**
 * Dressing. Every grove below was checked by the generator against the
 * finished floor — dry, clear of every building and yard, and under a grade a
 * tree stands on. A road rejects what grows by itself (`world/roads.ts`), and
 * blocking props are held off every flag and spawn by `MapBuilder.keepClear`.
 *
 * The vale has TWO trees and they divide the work. The pines are the planted
 * ones — the hilltop woods — and the ash is the farm's own: hedgerow standards
 * over the walls and fences, copses in the open fields, a line along the
 * brook, and, at half size, the orchard. Between them their trunks are the only
 * scatter cover that stops a round above knee height. The ferns are the
 * understory, non-blocking on purpose: ground the eye reads as a field
 * boundary that a body and a bullet both pass.
 */
const scatter: ScatterSpec[] = [
  // ===== the hedgerows =============================================================
  // A line of standards over every field boundary and a fern understory
  // under it: the wall stops a round at chest height, and the trunks are the
  // same boundary saying so from the far end of the look it breaks.
  { prop: "ashTree", x: -26, z: 31.1, width: 5, depth: 14.3, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -26, z: 31.1, width: 5, depth: 15.3, count: 4, scale: [0.9, 1.5] },
  { prop: "ashTree", x: -26, z: 45.9, width: 5, depth: 14.3, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -26, z: 45.9, width: 5, depth: 15.3, count: 4, scale: [0.9, 1.5] },
  { prop: "ashTree", x: -13.6, z: 56, width: 15.9, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -13.6, z: 56, width: 15.9, depth: 6, count: 5, scale: [0.9, 1.5] },
  { prop: "ashTree", x: -5.6, z: 31.9, width: 5, depth: 15.8, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -5.6, z: 31.9, width: 5, depth: 16.8, count: 5, scale: [0.9, 1.5] },
  { prop: "ashTree", x: -101.3, z: 96, width: 17.4, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -101.3, z: 96, width: 17.4, depth: 6, count: 7, scale: [0.9, 1.5] },
  { prop: "bramble", x: -101.3, z: 96, width: 17.4, depth: 2, count: 4, scale: [0.9, 1.4] },
  { prop: "ashTree", x: -83.5, z: 96, width: 17.2, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -83.5, z: 96, width: 17.2, depth: 6, count: 7, scale: [0.9, 1.5] },
  { prop: "bramble", x: -83.5, z: 96, width: 17.2, depth: 2, count: 4, scale: [0.9, 1.4] },
  { prop: "ashTree", x: -65.7, z: 96, width: 17.4, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -65.7, z: 96, width: 17.4, depth: 6, count: 7, scale: [0.9, 1.5] },
  { prop: "bramble", x: -65.7, z: 96, width: 17.4, depth: 2, count: 4, scale: [0.9, 1.4] },
  { prop: "ashTree", x: -70, z: 121.6, width: 5, depth: 16.8, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -70, z: 121.6, width: 5, depth: 17.8, count: 5, scale: [0.9, 1.5] },
  { prop: "ashTree", x: -98.9, z: 130, width: 22.3, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -98.9, z: 130, width: 22.3, depth: 6, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: -53.8, z: 130, width: 22, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -53.8, z: 130, width: 22, depth: 6, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: -31.1, z: 130, width: 22.3, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -31.1, z: 130, width: 22.3, depth: 6, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: -30, z: 125.5, width: 5, depth: 16, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -30, z: 125.5, width: 5, depth: 17, count: 6, scale: [0.9, 1.5] },
  { prop: "bramble", x: -30, z: 125.5, width: 2, depth: 16, count: 4, scale: [0.9, 1.4] },
  { prop: "ashTree", x: -30, z: 142, width: 5, depth: 16, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -30, z: 142, width: 5, depth: 17, count: 6, scale: [0.9, 1.5] },
  { prop: "bramble", x: -30, z: 142, width: 2, depth: 16, count: 4, scale: [0.9, 1.4] },
  { prop: "ashTree", x: 10, z: 119.9, width: 5, depth: 19.8, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 10, z: 119.9, width: 5, depth: 20.8, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 10, z: 140, width: 5, depth: 19.5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 10, z: 140, width: 5, depth: 20.5, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 10, z: 160.1, width: 5, depth: 19.8, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 10, z: 160.1, width: 5, depth: 20.8, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 33.2, z: 140, width: 22.4, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 33.2, z: 140, width: 22.4, depth: 6, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 56, z: 140, width: 22.2, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 56, z: 140, width: 22.2, depth: 6, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 78.8, z: 140, width: 22.4, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 78.8, z: 140, width: 22.4, depth: 6, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 70, z: 68.9, width: 5, depth: 17.8, count: 3, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 70, z: 68.9, width: 5, depth: 18.8, count: 7, scale: [0.9, 1.5] },
  { prop: "bramble", x: 70, z: 68.9, width: 2, depth: 17.8, count: 4, scale: [0.9, 1.4] },
  { prop: "ashTree", x: 70, z: 87.1, width: 5, depth: 17.8, count: 3, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 70, z: 87.1, width: 5, depth: 18.8, count: 7, scale: [0.9, 1.5] },
  { prop: "bramble", x: 70, z: 87.1, width: 2, depth: 17.8, count: 4, scale: [0.9, 1.4] },
  { prop: "ashTree", x: 43.6, z: 78, width: 18.3, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 43.6, z: 78, width: 18.3, depth: 6, count: 5, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 80.9, z: 78, width: 18.3, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 80.9, z: 78, width: 18.3, depth: 6, count: 5, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 88.1, z: 60, width: 16.3, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 88.1, z: 60, width: 16.3, depth: 6, count: 5, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 104.9, z: 60, width: 16.3, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 104.9, z: 60, width: 16.3, depth: 6, count: 5, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 129.5, z: 60, width: 13, depth: 5, count: 1, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 129.5, z: 60, width: 13, depth: 6, count: 4, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 136, z: 91.3, width: 5, depth: 20.3, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 136, z: 91.3, width: 5, depth: 21.3, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 136, z: 112.2, width: 5, depth: 20.6, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 136, z: 112.2, width: 5, depth: 21.6, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 149.4, z: 80, width: 18.8, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 149.4, z: 80, width: 18.8, depth: 6, count: 5, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 168.5, z: 80, width: 18.5, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 168.5, z: 80, width: 18.5, depth: 6, count: 5, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 150, z: 49.9, width: 5, depth: 19.8, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 150, z: 49.9, width: 5, depth: 20.8, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 150, z: 70, width: 5, depth: 19.5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 150, z: 70, width: 5, depth: 20.5, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 150, z: 90, width: 5, depth: 19.5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 150, z: 90, width: 5, depth: 20.5, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 150, z: 110.1, width: 5, depth: 19.8, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 150, z: 110.1, width: 5, depth: 20.8, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 125, z: -20, width: 20, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 125, z: -20, width: 20, depth: 6, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 145.4, z: -20, width: 19.8, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 145.4, z: -20, width: 19.8, depth: 6, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 165.6, z: -20, width: 19.8, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 165.6, z: -20, width: 19.8, depth: 6, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 186, z: -20, width: 20, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 186, z: -20, width: 20, depth: 6, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 160, z: -48.6, width: 5, depth: 22.8, count: 3, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 160, z: -48.6, width: 5, depth: 23.8, count: 9, scale: [0.9, 1.5] },
  { prop: "bramble", x: 160, z: -48.6, width: 2, depth: 22.8, count: 6, scale: [0.9, 1.4] },
  { prop: "ashTree", x: 160, z: -25.5, width: 5, depth: 22.5, count: 3, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 160, z: -25.5, width: 5, depth: 23.5, count: 9, scale: [0.9, 1.5] },
  { prop: "bramble", x: 160, z: -25.5, width: 2, depth: 22.5, count: 6, scale: [0.9, 1.4] },
  { prop: "ashTree", x: 160, z: -2.4, width: 5, depth: 22.8, count: 3, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 160, z: -2.4, width: 5, depth: 23.8, count: 9, scale: [0.9, 1.5] },
  { prop: "bramble", x: 160, z: -2.4, width: 2, depth: 22.8, count: 6, scale: [0.9, 1.4] },
  { prop: "ashTree", x: 134.9, z: -44, width: 17.8, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 134.9, z: -44, width: 17.8, depth: 6, count: 5, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 171.1, z: -44, width: 17.8, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 171.1, z: -44, width: 17.8, depth: 6, count: 5, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 47, z: -60, width: 14, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 47, z: -60, width: 14, depth: 6, count: 4, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 61.5, z: -60, width: 14, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 61.5, z: -60, width: 14, depth: 6, count: 4, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 48, z: -90.1, width: 5, depth: 19.8, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 48, z: -90.1, width: 5, depth: 20.8, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 69.9, z: -120, width: 19.8, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 69.9, z: -120, width: 19.8, depth: 6, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 90, z: -120, width: 19.5, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 90, z: -120, width: 19.5, depth: 6, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 110, z: -120, width: 19.5, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 110, z: -120, width: 19.5, depth: 6, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 130.1, z: -120, width: 19.8, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 130.1, z: -120, width: 19.8, depth: 6, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: -47.6, z: -60, width: 24.8, depth: 5, count: 3, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -47.6, z: -60, width: 24.8, depth: 6, count: 7, scale: [0.9, 1.5] },
  { prop: "ashTree", x: -22.4, z: -60, width: 24.8, depth: 5, count: 3, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -22.4, z: -60, width: 24.8, depth: 6, count: 7, scale: [0.9, 1.5] },
  { prop: "ashTree", x: -40, z: -138.9, width: 5, depth: 22.3, count: 3, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -40, z: -138.9, width: 5, depth: 23.3, count: 9, scale: [0.9, 1.5] },
  { prop: "bramble", x: -40, z: -138.9, width: 2, depth: 22.3, count: 6, scale: [0.9, 1.4] },
  { prop: "ashTree", x: -40, z: -116.3, width: 5, depth: 22, count: 3, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -40, z: -116.3, width: 5, depth: 23, count: 9, scale: [0.9, 1.5] },
  { prop: "bramble", x: -40, z: -116.3, width: 2, depth: 22, count: 6, scale: [0.9, 1.4] },
  { prop: "ashTree", x: -40, z: -93.8, width: 5, depth: 22, count: 3, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -40, z: -93.8, width: 5, depth: 23, count: 9, scale: [0.9, 1.5] },
  { prop: "bramble", x: -40, z: -93.8, width: 2, depth: 22, count: 6, scale: [0.9, 1.4] },
  { prop: "ashTree", x: -40, z: -71.1, width: 5, depth: 22.3, count: 3, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -40, z: -71.1, width: 5, depth: 23.3, count: 9, scale: [0.9, 1.5] },
  { prop: "bramble", x: -40, z: -71.1, width: 2, depth: 22.3, count: 6, scale: [0.9, 1.4] },
  { prop: "ashTree", x: -18.5, z: -120, width: 23.1, depth: 5, count: 3, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -18.5, z: -120, width: 23.1, depth: 6, count: 7, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 5, z: -120, width: 22.8, depth: 5, count: 3, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 5, z: -120, width: 22.8, depth: 6, count: 7, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 28.5, z: -120, width: 23.1, depth: 5, count: 3, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 28.5, z: -120, width: 23.1, depth: 6, count: 7, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 20, z: -138.9, width: 5, depth: 22.3, count: 3, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 20, z: -138.9, width: 5, depth: 23.3, count: 9, scale: [0.9, 1.5] },
  { prop: "bramble", x: 20, z: -138.9, width: 2, depth: 22.3, count: 6, scale: [0.9, 1.4] },
  { prop: "ashTree", x: 20, z: -116.3, width: 5, depth: 22, count: 3, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 20, z: -116.3, width: 5, depth: 23, count: 9, scale: [0.9, 1.5] },
  { prop: "bramble", x: 20, z: -116.3, width: 2, depth: 22, count: 6, scale: [0.9, 1.4] },
  { prop: "ashTree", x: 20, z: -93.8, width: 5, depth: 22, count: 3, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 20, z: -93.8, width: 5, depth: 23, count: 9, scale: [0.9, 1.5] },
  { prop: "bramble", x: 20, z: -93.8, width: 2, depth: 22, count: 6, scale: [0.9, 1.4] },
  { prop: "ashTree", x: 20, z: -71.1, width: 5, depth: 22.3, count: 3, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 20, z: -71.1, width: 5, depth: 23.3, count: 9, scale: [0.9, 1.5] },
  { prop: "bramble", x: 20, z: -71.1, width: 2, depth: 22.3, count: 6, scale: [0.9, 1.4] },
  { prop: "ashTree", x: -68, z: -150, width: 24, depth: 5, count: 3, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -68, z: -150, width: 24, depth: 6, count: 7, scale: [0.9, 1.5] },
  { prop: "ashTree", x: -19.3, z: -150, width: 23.8, depth: 5, count: 3, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -19.3, z: -150, width: 23.8, depth: 6, count: 7, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 5, z: -150, width: 23.8, depth: 5, count: 3, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 5, z: -150, width: 23.8, depth: 6, count: 7, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 53.6, z: -150, width: 23.8, depth: 5, count: 3, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 53.6, z: -150, width: 23.8, depth: 6, count: 7, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 78, z: -150, width: 24, depth: 5, count: 3, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 78, z: -150, width: 24, depth: 6, count: 7, scale: [0.9, 1.5] },
  { prop: "ashTree", x: -113.3, z: -50, width: 13.5, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -113.3, z: -50, width: 13.5, depth: 6, count: 4, scale: [0.9, 1.5] },
  { prop: "ashTree", x: -71.6, z: -50, width: 20.8, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -71.6, z: -50, width: 20.8, depth: 6, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: -50.4, z: -50, width: 20.8, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -50.4, z: -50, width: 20.8, depth: 6, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: -66, z: -120.1, width: 5, depth: 19.8, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -66, z: -120.1, width: 5, depth: 20.8, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: -66, z: -100, width: 5, depth: 19.5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -66, z: -100, width: 5, depth: 20.5, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: -66, z: -80, width: 5, depth: 19.5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -66, z: -80, width: 5, depth: 20.5, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: -180.1, z: -30, width: 19.8, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -180.1, z: -30, width: 19.8, depth: 6, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: -160, z: -30, width: 19.5, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -160, z: -30, width: 19.5, depth: 6, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: -140, z: -30, width: 19.5, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -140, z: -30, width: 19.5, depth: 6, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: -119.9, z: -30, width: 19.8, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -119.9, z: -30, width: 19.8, depth: 6, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: -140, z: -69.1, width: 5, depth: 21.8, count: 3, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -140, z: -69.1, width: 5, depth: 22.8, count: 9, scale: [0.9, 1.5] },
  { prop: "bramble", x: -140, z: -69.1, width: 2, depth: 21.8, count: 5, scale: [0.9, 1.4] },
  { prop: "ashTree", x: -140, z: -47, width: 5, depth: 21.5, count: 3, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -140, z: -47, width: 5, depth: 22.5, count: 9, scale: [0.9, 1.5] },
  { prop: "bramble", x: -140, z: -47, width: 2, depth: 21.5, count: 5, scale: [0.9, 1.4] },
  { prop: "ashTree", x: -140, z: -25, width: 5, depth: 21.5, count: 3, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -140, z: -25, width: 5, depth: 22.5, count: 9, scale: [0.9, 1.5] },
  { prop: "bramble", x: -140, z: -25, width: 2, depth: 21.5, count: 5, scale: [0.9, 1.4] },
  { prop: "ashTree", x: -140, z: -3, width: 5, depth: 21.5, count: 3, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -140, z: -3, width: 5, depth: 22.5, count: 9, scale: [0.9, 1.5] },
  { prop: "bramble", x: -140, z: -3, width: 2, depth: 21.5, count: 5, scale: [0.9, 1.4] },
  { prop: "ashTree", x: -140, z: 19.1, width: 5, depth: 21.8, count: 3, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -140, z: 19.1, width: 5, depth: 22.8, count: 9, scale: [0.9, 1.5] },
  { prop: "bramble", x: -140, z: 19.1, width: 2, depth: 21.8, count: 5, scale: [0.9, 1.4] },
  { prop: "ashTree", x: -179.5, z: 10, width: 21.1, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -179.5, z: 10, width: 21.1, depth: 6, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: -158, z: 10, width: 20.8, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -158, z: 10, width: 20.8, depth: 6, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: -179.8, z: 60, width: 20.4, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -179.8, z: 60, width: 20.4, depth: 6, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: -159, z: 60, width: 20.2, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -159, z: 60, width: 20.2, depth: 6, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: -138.2, z: 60, width: 20.4, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -138.2, z: 60, width: 20.4, depth: 6, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: -180.2, z: -120, width: 19.6, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -180.2, z: -120, width: 19.6, depth: 6, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: -160.3, z: -120, width: 19.3, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -160.3, z: -120, width: 19.3, depth: 6, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: -140.3, z: -120, width: 19.6, depth: 5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -140.3, z: -120, width: 19.6, depth: 6, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: -120, z: -180.1, width: 5, depth: 19.8, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -120, z: -180.1, width: 5, depth: 20.8, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: -120, z: -160, width: 5, depth: 19.5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -120, z: -160, width: 5, depth: 20.5, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: -120, z: -139.9, width: 5, depth: 19.8, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -120, z: -139.9, width: 5, depth: 20.8, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 110, z: 139.9, width: 5, depth: 19.8, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 110, z: 139.9, width: 5, depth: 20.8, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 110, z: 160, width: 5, depth: 19.5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 110, z: 160, width: 5, depth: 20.5, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 110, z: 180.1, width: 5, depth: 19.8, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 110, z: 180.1, width: 5, depth: 20.8, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 155, z: 130, width: 23, depth: 5, count: 3, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 155, z: 130, width: 23, depth: 6, count: 7, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 178.5, z: 130, width: 23, depth: 5, count: 3, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 178.5, z: 130, width: 23, depth: 6, count: 7, scale: [0.9, 1.5] },
  // ===== the brook =================================================================
  // Ash along both banks, set back off the water; ferns on the wet edge.
  // Held off the fords, the footbridge and the mill's wheel.
  { prop: "ashTree", x: -185.6, z: 120.9, radius: 3.5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -188.6, z: 99, radius: 3, count: 3, scale: [0.8, 1.4] },
  { prop: "ashTree", x: -179, z: 89.4, radius: 3.5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -173.9, z: 112.6, radius: 3, count: 3, scale: [0.8, 1.4] },
  { prop: "ashTree", x: -157.2, z: 116.5, radius: 3.5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -125.5, z: 74.9, radius: 3, count: 3, scale: [0.8, 1.4] },
  { prop: "fernClump", x: -108.6, z: 63.1, radius: 3, count: 3, scale: [0.8, 1.4] },
  { prop: "ashTree", x: -70.5, z: 23.7, radius: 3.5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -75.9, z: 47, radius: 3, count: 3, scale: [0.8, 1.4] },
  { prop: "ashTree", x: -69.4, z: 57.4, radius: 3.5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -57.3, z: 37.5, radius: 3, count: 3, scale: [0.8, 1.4] },
  { prop: "fernClump", x: -53.7, z: 58.8, radius: 3, count: 3, scale: [0.8, 1.4] },
  { prop: "fernClump", x: -33.4, z: 51.7, radius: 3, count: 3, scale: [0.8, 1.4] },
  { prop: "fernClump", x: -27.7, z: 72.3, radius: 3, count: 3, scale: [0.8, 1.4] },
  { prop: "fernClump", x: 14.5, z: 64.1, radius: 3, count: 3, scale: [0.8, 1.4] },
  { prop: "ashTree", x: 23.9, z: 55.2, radius: 3.5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 31.3, z: 76.7, radius: 3, count: 3, scale: [0.8, 1.4] },
  { prop: "fernClump", x: 38.5, z: 56.6, radius: 3, count: 3, scale: [0.8, 1.4] },
  { prop: "fernClump", x: 58, z: 65, radius: 3, count: 3, scale: [0.8, 1.4] },
  { prop: "fernClump", x: 63.2, z: 44.2, radius: 3, count: 3, scale: [0.8, 1.4] },
  { prop: "fernClump", x: 82, z: 53.9, radius: 3, count: 3, scale: [0.8, 1.4] },
  { prop: "fernClump", x: 90.7, z: 34.7, radius: 3, count: 3, scale: [0.8, 1.4] },
  { prop: "ashTree", x: 102.5, z: 24.1, radius: 3.5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 108.1, z: 46.6, radius: 3, count: 3, scale: [0.8, 1.4] },
  { prop: "fernClump", x: 142.8, z: 18.3, radius: 3, count: 3, scale: [0.8, 1.4] },
  { prop: "ashTree", x: 152.4, z: 6.3, radius: 3.5, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 162.1, z: 27.5, radius: 3, count: 3, scale: [0.8, 1.4] },
  { prop: "fernClump", x: 168.7, z: 7.1, radius: 3, count: 3, scale: [0.8, 1.4] },
  { prop: "fernClump", x: 185.5, z: 18.3, radius: 3, count: 3, scale: [0.8, 1.4] },
  // ===== the orchard ===============================================================
  // Fruit trees in rows down the hill's south and west slopes, inside the
  // orchard walls: the ash at half size, which is what an old apple tree's
  // bole and crown read as at the far side of a field. One region a tree,
  // because a region scatters at random and an orchard is a grid.
  { prop: "ashTree", x: 86, z: 66, radius: 0.5, count: 1, scale: [0.5, 0.6], blocking: true, clearance: 1.0 },
  { prop: "ashTree", x: 95, z: 66, radius: 0.5, count: 1, scale: [0.5, 0.6], blocking: true, clearance: 1.0 },
  { prop: "ashTree", x: 104, z: 66, radius: 0.5, count: 1, scale: [0.5, 0.6], blocking: true, clearance: 1.0 },
  { prop: "ashTree", x: 113, z: 66, radius: 0.5, count: 1, scale: [0.5, 0.6], blocking: true, clearance: 1.0 },
  { prop: "ashTree", x: 122, z: 66, radius: 0.5, count: 1, scale: [0.5, 0.6], blocking: true, clearance: 1.0 },
  { prop: "ashTree", x: 131, z: 66, radius: 0.5, count: 1, scale: [0.5, 0.6], blocking: true, clearance: 1.0 },
  { prop: "ashTree", x: 90.5, z: 75, radius: 0.5, count: 1, scale: [0.5, 0.6], blocking: true, clearance: 1.0 },
  { prop: "ashTree", x: 99.5, z: 75, radius: 0.5, count: 1, scale: [0.5, 0.6], blocking: true, clearance: 1.0 },
  { prop: "ashTree", x: 108.5, z: 75, radius: 0.5, count: 1, scale: [0.5, 0.6], blocking: true, clearance: 1.0 },
  { prop: "ashTree", x: 117.5, z: 75, radius: 0.5, count: 1, scale: [0.5, 0.6], blocking: true, clearance: 1.0 },
  { prop: "ashTree", x: 126.5, z: 75, radius: 0.5, count: 1, scale: [0.5, 0.6], blocking: true, clearance: 1.0 },
  { prop: "ashTree", x: 86, z: 84, radius: 0.5, count: 1, scale: [0.5, 0.6], blocking: true, clearance: 1.0 },
  { prop: "ashTree", x: 95, z: 84, radius: 0.5, count: 1, scale: [0.5, 0.6], blocking: true, clearance: 1.0 },
  { prop: "ashTree", x: 104, z: 84, radius: 0.5, count: 1, scale: [0.5, 0.6], blocking: true, clearance: 1.0 },
  { prop: "ashTree", x: 113, z: 84, radius: 0.5, count: 1, scale: [0.5, 0.6], blocking: true, clearance: 1.0 },
  { prop: "ashTree", x: 122, z: 84, radius: 0.5, count: 1, scale: [0.5, 0.6], blocking: true, clearance: 1.0 },
  { prop: "ashTree", x: 131, z: 84, radius: 0.5, count: 1, scale: [0.5, 0.6], blocking: true, clearance: 1.0 },
  { prop: "ashTree", x: 90.5, z: 93, radius: 0.5, count: 1, scale: [0.5, 0.6], blocking: true, clearance: 1.0 },
  { prop: "ashTree", x: 86, z: 102, radius: 0.5, count: 1, scale: [0.5, 0.6], blocking: true, clearance: 1.0 },
  { prop: "ashTree", x: 90.5, z: 111, radius: 0.5, count: 1, scale: [0.5, 0.6], blocking: true, clearance: 1.0 },
  { prop: "ashTree", x: 86, z: 120, radius: 0.5, count: 1, scale: [0.5, 0.6], blocking: true, clearance: 1.0 },
  { prop: "ashTree", x: 113, z: 120, radius: 0.5, count: 1, scale: [0.5, 0.6], blocking: true, clearance: 1.0 },
  { prop: "ashTree", x: 122, z: 120, radius: 0.5, count: 1, scale: [0.5, 0.6], blocking: true, clearance: 1.0 },
  { prop: "ashTree", x: 131, z: 120, radius: 0.5, count: 1, scale: [0.5, 0.6], blocking: true, clearance: 1.0 },
  // ===== the green's trees =========================================================
  // The two the village has, and the only regions on the map allowed the top
  // of the scale: a green's tree is the biggest thing growing in a village.
  { prop: "ashTree", x: -18, z: 11, radius: 2, count: 1, scale: [1.2, 1.3], blocking: true, clearance: 2.4 },
  { prop: "ashTree", x: 38, z: 8, radius: 3, count: 1, scale: [1.1, 1.3], blocking: true, clearance: 2.4 },
  // ===== the churchyard ============================================================
  // Headstones, which a round passes over and a body crouches behind.
  { prop: "gravestone", x: -15, z: 53, width: 18, depth: 4, count: 9, scale: [0.85, 1.1] },
  { prop: "gravestone", x: -24, z: 38, width: 3, depth: 20, count: 6, scale: [0.85, 1.1] },
  { prop: "gravestone", x: -6, z: 38, width: 3, depth: 20, count: 6, scale: [0.85, 1.1] },
  // ===== the woods =================================================================
  // Pine on the hilltops and ash on their flanks, sown against the finished
  // floor: a grove is a disc checked dry, clear of every building and yard,
  // and under a grade a tree stands on.
  { prop: "ashTree", x: -186.3, z: -185.2, radius: 7, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: -167.2, z: -188.3, radius: 7, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: -140.2, z: -183.3, radius: 7, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: -124.8, z: -181.6, radius: 4, count: 1, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: -99.5, z: -186.2, radius: 7, count: 1, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: -72.3, z: -186.4, radius: 7, count: 1, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "pine", x: -54.9, z: -183.8, radius: 11, count: 4, scale: [0.9, 1.4], blocking: true, clearance: 1.2 },
  { prop: "pine", x: -27.4, z: -188, radius: 7, count: 2, scale: [0.9, 1.4], blocking: true, clearance: 1.2 },
  { prop: "pine", x: -9.1, z: -187.9, radius: 7, count: 2, scale: [0.9, 1.4], blocking: true, clearance: 1.2 },
  { prop: "pine", x: 15.4, z: -181.5, radius: 11, count: 4, scale: [0.9, 1.4], blocking: true, clearance: 1.2 },
  { prop: "ashTree", x: 30.4, z: -186.4, radius: 7, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: 56.6, z: -188.6, radius: 7, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: 82.1, z: -190.4, radius: 4, count: 1, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "pine", x: 103.6, z: -183.9, radius: 11, count: 3, scale: [0.9, 1.4], blocking: true, clearance: 1.2 },
  { prop: "ashTree", x: 118.3, z: -187.5, radius: 7, count: 1, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: 140, z: -182.9, radius: 11, count: 3, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "pine", x: 170.5, z: -184.8, radius: 11, count: 4, scale: [0.9, 1.4], blocking: true, clearance: 1.2 },
  { prop: "ashTree", x: 185.8, z: -188.8, radius: 7, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: -188.3, z: -160, radius: 7, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: -9.8, z: -165.5, radius: 11, count: 4, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "pine", x: 12, z: -167, radius: 11, count: 5, scale: [0.9, 1.4], blocking: true, clearance: 1.2 },
  { prop: "pine", x: 187.8, z: -159.2, radius: 7, count: 2, scale: [0.9, 1.4], blocking: true, clearance: 1.2 },
  { prop: "ashTree", x: -187.4, z: -141.5, radius: 7, count: 1, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "pine", x: 124.9, z: -138.2, radius: 11, count: 4, scale: [0.9, 1.4], blocking: true, clearance: 1.2 },
  { prop: "pine", x: 147.5, z: -145.3, radius: 11, count: 6, scale: [0.9, 1.4], blocking: true, clearance: 1.2 },
  { prop: "pine", x: 166, z: -144.1, radius: 11, count: 5, scale: [0.9, 1.4], blocking: true, clearance: 1.2 },
  { prop: "ashTree", x: 186.9, z: -144.2, radius: 7, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: 147.3, z: -121.2, radius: 4, count: 1, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: 167.8, z: -116.7, radius: 11, count: 4, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: 187.5, z: -121.8, radius: 7, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: -185.4, z: -96.4, radius: 11, count: 4, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: 191.9, z: -95, radius: 4, count: 1, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "pine", x: -187.7, z: -76.6, radius: 7, count: 2, scale: [0.9, 1.4], blocking: true, clearance: 1.2 },
  { prop: "ashTree", x: 192.8, z: -80.9, radius: 4, count: 1, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "pine", x: -183.5, z: -50.2, radius: 11, count: 4, scale: [0.9, 1.4], blocking: true, clearance: 1.2 },
  { prop: "ashTree", x: 191.4, z: -51.4, radius: 4, count: 1, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: 190.6, z: -36.8, radius: 4, count: 1, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "pine", x: -186.5, z: -9.1, radius: 7, count: 2, scale: [0.9, 1.4], blocking: true, clearance: 1.2 },
  { prop: "ashTree", x: 189, z: -7.1, radius: 4, count: 1, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: -188, z: 35.8, radius: 7, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: 191.7, z: 29.8, radius: 4, count: 1, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: 191.5, z: 55.8, radius: 4, count: 1, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: -183.6, z: 78.4, radius: 11, count: 3, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: 190.2, z: 82.2, radius: 4, count: 1, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "pine", x: 143.2, z: 103.9, radius: 4, count: 1, scale: [0.9, 1.4], blocking: true, clearance: 1.2 },
  { prop: "ashTree", x: 187.2, z: 104.6, radius: 7, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: 187.5, z: 124.9, radius: 4, count: 1, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "pine", x: -164.8, z: 148.4, radius: 11, count: 4, scale: [0.9, 1.4], blocking: true, clearance: 1.2 },
  { prop: "pine", x: -140.5, z: 141.4, radius: 11, count: 4, scale: [0.9, 1.4], blocking: true, clearance: 1.2 },
  { prop: "pine", x: 104.9, z: 141.9, radius: 4, count: 1, scale: [0.9, 1.4], blocking: true, clearance: 1.2 },
  { prop: "pine", x: 121.9, z: 143.6, radius: 11, count: 3, scale: [0.9, 1.4], blocking: true, clearance: 1.2 },
  { prop: "ashTree", x: 188.4, z: 144.6, radius: 7, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "pine", x: -187.4, z: 161.7, radius: 7, count: 1, scale: [0.9, 1.4], blocking: true, clearance: 1.2 },
  { prop: "pine", x: -162.6, z: 162.6, radius: 11, count: 4, scale: [0.9, 1.4], blocking: true, clearance: 1.2 },
  { prop: "ashTree", x: -139.1, z: 168.7, radius: 11, count: 4, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "pine", x: 77.7, z: 169.7, radius: 11, count: 3, scale: [0.9, 1.4], blocking: true, clearance: 1.2 },
  { prop: "ashTree", x: 189, z: 164.7, radius: 7, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: -186.8, z: 189.5, radius: 7, count: 1, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: -167, z: 184.4, radius: 11, count: 3, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: -146.2, z: 186.2, radius: 7, count: 1, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "pine", x: -115.8, z: 186.9, radius: 7, count: 2, scale: [0.9, 1.4], blocking: true, clearance: 1.2 },
  { prop: "ashTree", x: -102.8, z: 184.3, radius: 11, count: 4, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "pine", x: -76.9, z: 189.6, radius: 7, count: 2, scale: [0.9, 1.4], blocking: true, clearance: 1.2 },
  { prop: "pine", x: -58.1, z: 183.6, radius: 11, count: 5, scale: [0.9, 1.4], blocking: true, clearance: 1.2 },
  { prop: "ashTree", x: -32.3, z: 190.5, radius: 4, count: 1, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: -11.7, z: 184.5, radius: 11, count: 5, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: 13.3, z: 185.7, radius: 11, count: 4, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: 37.7, z: 187.9, radius: 7, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: 58.9, z: 188.9, radius: 7, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: 74.4, z: 189.4, radius: 7, count: 2, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: 95.4, z: 192.5, radius: 4, count: 1, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "pine", x: 119.8, z: 185.4, radius: 7, count: 1, scale: [0.9, 1.4], blocking: true, clearance: 1.2 },
  { prop: "ashTree", x: 149, z: 191.9, radius: 4, count: 1, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "pine", x: 164, z: 185.5, radius: 4, count: 1, scale: [0.9, 1.4], blocking: true, clearance: 1.2 },
  { prop: "pine", x: 188.4, z: 187.3, radius: 7, count: 2, scale: [0.9, 1.4], blocking: true, clearance: 1.2 },
  // ===== the copses ================================================================
  // A clump of three or four trees in the open fields: something to walk to.
  { prop: "ashTree", x: 150, z: -70, radius: 9, count: 4, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 150, z: -70, radius: 9, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 80, z: 150, radius: 9, count: 4, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 80, z: 150, radius: 9, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: -170, z: -80, radius: 9, count: 4, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -170, z: -80, radius: 9, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: -10, z: -140, radius: 9, count: 4, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -10, z: -140, radius: 9, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 70, z: -130, radius: 9, count: 4, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 70, z: -130, radius: 9, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: -80, z: -140, radius: 8, count: 4, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -80, z: -140, radius: 8, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: 130, z: 150, radius: 8, count: 4, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: 130, z: 150, radius: 8, count: 6, scale: [0.9, 1.5] },
  { prop: "ashTree", x: -160, z: 130, radius: 10, count: 4, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "fernClump", x: -160, z: 130, radius: 10, count: 6, scale: [0.9, 1.5] },
  // ===== the yards' spill ==========================================================
  { prop: "barrel", x: 22, z: 40, radius: 3, count: 3, blocking: true, clearance: 0.55 },
  { prop: "barrel", x: -96, z: 62, radius: 3, count: 3, blocking: true, clearance: 0.55 },
  { prop: "barrel", x: 100, z: -58, radius: 4, count: 3, blocking: true, clearance: 0.55 },
  { prop: "barrel", x: -92, z: -100, radius: 4, count: 3, blocking: true, clearance: 0.55 },
  { prop: "log", x: 116, z: -78, radius: 5, count: 3, scale: [0.8, 1.2], blocking: true, clearance: 1.4 },
  { prop: "boulder", x: -150, z: 150, radius: 18, count: 5, scale: [0.8, 1.3], blocking: true, clearance: 1.0 },
  { prop: "boulder", x: 6, z: -176, radius: 18, count: 5, scale: [0.8, 1.3], blocking: true, clearance: 1.0 },
  { prop: "boulder", x: 150, z: -150, radius: 16, count: 4, scale: [0.8, 1.3], blocking: true, clearance: 1.0 },
  { prop: "bramble", x: -60, z: -48, radius: 10, count: 6, scale: [0.9, 1.5] },
  { prop: "bramble", x: 60, z: -50, radius: 10, count: 6, scale: [0.9, 1.5] },
  // ===== THE COUNTRY BEYOND THE PLAY SQUARE ==================================
  // Appended LAST, and the order is mechanical: every region draws from one
  // seeded stream in array order, so a region spliced in above re-rolls every
  // field below it.
  //
  // The play square keeps a bare collar and the country resumes past it.
  // Nothing here is nearer than 90 m to the play edge, which is what makes
  // the whole block cost the FIGHT nothing: the leash is ten seconds and a
  // sprint is 6.9 m/s, so a living player reaches 69 m past the square and no
  // further, and a bot cannot reach the borderland at all (the nav graph stops
  // at the play square, and bots are never leashed). What it is for is the
  // HORIZON: 600 m of unbroken grass under `fogEnd` 520 is a flat plane
  // fading to `fogColor`, and what tells an eye that ground recedes is stuff
  // standing ON it at intervals — in farm country, woods and field boundaries.
  //
  // WHICH IS WHY NONE OF IT BLOCKS. A blocking prop is a collider, a
  // `WorldBox` and a row in the collision bake; out here it would be geometry
  // the bots can neither see nor route around, and something to CATCH a
  // player sprinting home against a countdown. Omit `blocking` and the props
  // emit nothing at all.
  //
  // AND IT IS NOT A RING, which would be the bowl the downs rim was removed
  // for. The north is the wooded side, the west and the east are where the
  // brook comes in and goes out — its ash line follows the channel on out,
  // since past the grid the floor is the clamped edge and the channel really
  // does run on out there — and the SOUTH is deliberately the thinnest.

  // NORTH — the wooded side.
  { prop: "pine", x: -320, z: 352, width: 130, depth: 104, count: 110, scale: [0.9, 1.4], clearance: 1.2 },
  { prop: "ashTree", x: -320, z: 300, width: 130, depth: 16, count: 14, scale: [0.8, 1.15], clearance: 2.0 },
  { prop: "ashTree", x: 112, z: 316, width: 276, depth: 12, count: 24, scale: [0.8, 1.15], clearance: 2.0 },
  { prop: "pine", x: 196, z: 432, width: 220, depth: 26, count: 34, scale: [0.9, 1.4], clearance: 1.2 },
  { prop: "ashTree", x: -80, z: 540, width: 376, depth: 14, count: 28, scale: [0.8, 1.15], clearance: 2.0 },

  // WEST — where the brook comes in, and the hanger the west wood runs into.
  { prop: "ashTree", x: -400, z: 126, width: 208, depth: 10, count: 14, scale: [0.8, 1.15], clearance: 2.0 },
  { prop: "ashTree", x: -400, z: 90, width: 208, depth: 10, count: 14, scale: [0.8, 1.15], clearance: 2.0 },
  { prop: "pine", x: -390, z: -58, width: 112, depth: 152, count: 118, scale: [0.9, 1.4], clearance: 1.2 },
  { prop: "ashTree", x: -326, z: -58, width: 14, depth: 152, count: 16, scale: [0.8, 1.15], clearance: 2.0 },
  { prop: "ashTree", x: -318, z: 220, width: 12, depth: 140, count: 12, scale: [0.8, 1.15], clearance: 2.0 },

  // EAST — where the brook leaves, and the south-east wood's country carrying on.
  { prop: "ashTree", x: 400, z: 26, width: 208, depth: 10, count: 14, scale: [0.8, 1.15], clearance: 2.0 },
  { prop: "ashTree", x: 400, z: -10, width: 208, depth: 10, count: 14, scale: [0.8, 1.15], clearance: 2.0 },
  { prop: "pine", x: 402, z: -222, width: 120, depth: 132, count: 108, scale: [0.9, 1.4], clearance: 1.2 },
  { prop: "ashTree", x: 336, z: -222, width: 14, depth: 132, count: 14, scale: [0.8, 1.15], clearance: 2.0 },
  { prop: "ashTree", x: 322, z: 160, width: 12, depth: 200, count: 18, scale: [0.8, 1.15], clearance: 2.0 },
  { prop: "pine", x: 544, z: 120, width: 26, depth: 200, count: 26, scale: [0.9, 1.4], clearance: 1.2 },

  // SOUTH — the open side, and kept open.
  { prop: "ashTree", x: -28, z: -322, width: 320, depth: 12, count: 26, scale: [0.8, 1.15], clearance: 2.0 },
  { prop: "pine", x: -398, z: -428, width: 110, depth: 96, count: 76, scale: [0.9, 1.4], clearance: 1.2 },
  { prop: "ashTree", x: 158, z: -404, radius: 26, count: 12, scale: [0.8, 1.15], clearance: 2.0 },
  { prop: "ashTree", x: 44, z: -536, width: 296, depth: 14, count: 22, scale: [0.8, 1.15], clearance: 2.0 },

  // THE CORNERS, which are the longest look out of this map: a corner is 283 m
  // from the middle against a side's 200, so these sit at the same 90 m collar
  // the sides do and are the nearest borderland there is.
  { prop: "pine", x: -330, z: -338, width: 104, depth: 92, count: 68, scale: [0.9, 1.4], clearance: 1.2 },
  { prop: "pine", x: 338, z: -330, width: 96, depth: 104, count: 66, scale: [0.9, 1.4], clearance: 1.2 },
  { prop: "ashTree", x: 352, z: 332, radius: 38, count: 22, scale: [0.8, 1.15], clearance: 2.0 },
];

const controlPoints: ControlPointDef[] = [
  { id: "A", name: "The Mill", pos: new Vector3(-88, 0.77, 58.5), radius: 11 },
  { id: "B", name: "The Grange", pos: new Vector3(-94, 2, -94), radius: 13 },
  { id: "C", name: "The Market Green", pos: new Vector3(0, 0.8, -2), radius: 14 },
  { id: "D", name: "Orchard Hill", pos: new Vector3(104, 8.9, 100), radius: 13 },
  { id: "E", name: "The Kiln Yard", pos: new Vector3(98, 0.75, -62), radius: 13 },
];

/**
 * Home spawns are uncapturable. Every control point also carries a spawn just
 * outside its capture zone, so deploying onto a flag you hold does not drop
 * you on top of whoever is contesting it. The home yards face each other down
 * the NE-SW diagonal — the bearing the sun was set perpendicular to.
 */
const spawns: SpawnPointDef[] = [
  { team: 0, pos: new Vector3(-170, 2.2, -150), yaw: Math.PI / 4 },
  { team: 0, pos: new Vector3(-164, 2.2, -144), yaw: Math.PI / 4 },
  { team: 0, pos: new Vector3(-172, 2.2, -160), yaw: Math.PI / 4 },
  { team: 1, pos: new Vector3(170, 2, 150), yaw: -Math.PI * 0.75 },
  { team: 1, pos: new Vector3(164, 2, 144), yaw: -Math.PI * 0.75 },
  { team: 1, pos: new Vector3(172, 2, 160), yaw: -Math.PI * 0.75 },
  { team: null, controlPoint: "A", pos: new Vector3(-70, 0.77, 62.5), yaw: -Math.PI / 2 },
  { team: null, controlPoint: "B", pos: new Vector3(-90, 2, -76), yaw: Math.PI },
  { team: null, controlPoint: "C", pos: new Vector3(0, 0.8, -32), yaw: 0 },
  { team: null, controlPoint: "D", pos: new Vector3(86, 7.71, 96), yaw: Math.PI / 2 },
  { team: null, controlPoint: "E", pos: new Vector3(94, 0.76, -44), yaw: Math.PI },
];

/**
 * One hardstanding a side, in the home yard beside the spawns, heading down
 * the same diagonal they face so the first thing a driver does is drive at the
 * map. The vale is what earns armour here: a 400 m map whose flags are 150 m
 * apart across open pasture is one where crossing the ground is the problem a
 * hull exists to answer, and the brook is wadeable its whole length, so a
 * hull crosses it anywhere and the fords are only the easy line.
 *
 * **Two, and exactly two.** The respawn is per hardstanding, so the number of
 * entries here IS how many tanks a side can ever have on the field at once —
 * and it is also what turns the kit's third slot on (`Game.armourOffered`).
 */
const vehicles: VehicleSpawnDef[] = [
  { team: 0, pos: new Vector3(-146, 2.2, -160), yaw: Math.PI / 4 },
  { team: 1, pos: new Vector3(146, 2, 160), yaw: -Math.PI * 0.75 },
];

/**
 * The brook is cut in `heights.ts` to a constant bed, so this single rect is
 * wet along the whole run and dry everywhere the ground stands above it —
 * Greyfen's construction. The generator checks that every wet point inside it
 * is the brook's own channel or the millpond. The emitter is derived from
 * where the floor actually crosses the surface rather than from these four
 * numbers (`MapBuilder.waterEmitters`).
 */
const water: WaterRect[] = [
  { x: 0, z: 58, width: 404, depth: 130, y: -0.3, sound: "stream" },
];

/**
 * Summer pasture — a budget rather than a blanket. The field is one mesh of
 * thin instances with no culling inside it, so the cost is the tuft COUNT
 * wherever the camera stands: these sum to ~26900 tufts (density x area),
 * against Greyfen's 16,900. Structures and roads clear themselves (the
 * GrassSystem's collider rejection, and a road refuses what grows).
 */
const grass: GrassRect[] = [
  // The green, mown closest and walked barest.
  { x: 0, z: 0, width: 44, depth: 30, density: 1.15 },
  // The yards.
  { x: -88, z: 63, width: 26, depth: 26, density: 0.7 },
  { x: -95, z: -95, width: 26, depth: 30, density: 0.7 },
  { x: 98, z: -63, width: 36, depth: 30, density: 0.6 },
  { x: 109, z: 100, width: 30, depth: 24, density: 0.9 },
  { x: -156, z: -156, width: 36, depth: 36, density: 0.5 },
  { x: 156, z: 156, width: 36, depth: 36, density: 0.5 },
  // The fields, on a lattice: the ground BETWEEN the flags is most of what a
  // player crosses, and a vale dressed only where the buildings are reads as
  // a green table with farms on it. Thinner than the yards on purpose — this
  // is grazed pasture seen mostly at fifty metres and up. Kept off the water:
  // a wet rect is a lawn growing underwater.
  { x: -180.8, z: -180, width: 30, depth: 26, density: 0.32 },
  { x: -140.6, z: -181.6, width: 30, depth: 26, density: 0.32 },
  { x: -99, z: -178.1, width: 30, depth: 26, density: 0.37 },
  { x: -54.6, z: -175.2, width: 30, depth: 26, density: 0.32 },
  { x: 20.6, z: -179, width: 30, depth: 26, density: 0.39 },
  { x: 65.6, z: -176.3, width: 30, depth: 26, density: 0.4 },
  { x: 102.5, z: -179.7, width: 30, depth: 26, density: 0.39 },
  { x: 139.9, z: -180, width: 30, depth: 26, density: 0.4 },
  { x: 182.2, z: -174.3, width: 30, depth: 26, density: 0.31 },
  { x: -175.1, z: -136.6, width: 30, depth: 26, density: 0.35 },
  { x: -134, z: -137.8, width: 30, depth: 26, density: 0.39 },
  { x: -97.9, z: -135.2, width: 30, depth: 26, density: 0.31 },
  { x: -62, z: -140.7, width: 30, depth: 26, density: 0.37 },
  { x: -15.4, z: -140.3, width: 30, depth: 26, density: 0.39 },
  { x: 25.7, z: -141.3, width: 30, depth: 26, density: 0.41 },
  { x: 58.3, z: -141.2, width: 30, depth: 26, density: 0.33 },
  { x: 105.4, z: -134.6, width: 30, depth: 26, density: 0.4 },
  { x: -176.4, z: -101.9, width: 30, depth: 26, density: 0.31 },
  { x: -141.5, z: -98.1, width: 30, depth: 26, density: 0.4 },
  { x: -98.8, z: -96.8, width: 30, depth: 26, density: 0.34 },
  { x: -54.3, z: -97.3, width: 30, depth: 26, density: 0.31 },
  { x: -20.6, z: -97.6, width: 30, depth: 26, density: 0.33 },
  { x: 25.6, z: -101.8, width: 30, depth: 26, density: 0.37 },
  { x: 62.7, z: -95, width: 30, depth: 26, density: 0.36 },
  { x: 102.3, z: -98, width: 30, depth: 26, density: 0.35 },
  { x: 144.4, z: -99.5, width: 30, depth: 26, density: 0.35 },
  { x: 181.6, z: -97.3, width: 30, depth: 26, density: 0.39 },
  { x: -174.4, z: -60.7, width: 30, depth: 26, density: 0.33 },
  { x: -135.3, z: -59.8, width: 30, depth: 26, density: 0.34 },
  { x: -97.1, z: -58.5, width: 30, depth: 26, density: 0.37 },
  { x: -55.9, z: -57.6, width: 30, depth: 26, density: 0.41 },
  { x: -14.7, z: -61.1, width: 30, depth: 26, density: 0.4 },
  { x: 25.2, z: -60.7, width: 30, depth: 26, density: 0.38 },
  { x: 64.7, z: -61.9, width: 30, depth: 26, density: 0.42 },
  { x: 99, z: -58.8, width: 30, depth: 26, density: 0.32 },
  { x: 141, z: -55.2, width: 30, depth: 26, density: 0.33 },
  { x: 186, z: -60, width: 30, depth: 26, density: 0.32 },
  { x: -175.6, z: -17.8, width: 30, depth: 26, density: 0.3 },
  { x: -135.8, z: -19.6, width: 30, depth: 26, density: 0.4 },
  { x: -99.2, z: -17.7, width: 30, depth: 26, density: 0.36 },
  { x: 104.8, z: -17.5, width: 30, depth: 26, density: 0.39 },
  { x: 140.8, z: -21, width: 30, depth: 26, density: 0.37 },
  { x: 184.7, z: -18.7, width: 30, depth: 26, density: 0.36 },
  { x: -177.2, z: 21.1, width: 30, depth: 26, density: 0.39 },
  { x: -138.8, z: 23.2, width: 30, depth: 26, density: 0.41 },
  { x: -174.2, z: 60.2, width: 30, depth: 26, density: 0.31 },
  { x: 142.1, z: 62.9, width: 30, depth: 26, density: 0.42 },
  { x: 179.2, z: 59.6, width: 30, depth: 26, density: 0.37 },
  { x: -54.3, z: 99, width: 30, depth: 26, density: 0.38 },
  { x: -14.2, z: 99.8, width: 30, depth: 26, density: 0.37 },
  { x: 23.3, z: 102.8, width: 30, depth: 26, density: 0.34 },
  { x: 60.2, z: 102, width: 30, depth: 26, density: 0.35 },
  { x: 102.1, z: 103.8, width: 30, depth: 26, density: 0.41 },
  { x: 184.1, z: 104.9, width: 30, depth: 26, density: 0.37 },
  { x: -176.8, z: 142.6, width: 30, depth: 26, density: 0.38 },
  { x: -99.5, z: 140.2, width: 30, depth: 26, density: 0.34 },
  { x: -55.1, z: 140.3, width: 30, depth: 26, density: 0.41 },
  { x: -15.6, z: 140.3, width: 30, depth: 26, density: 0.35 },
  { x: 18.2, z: 145.1, width: 30, depth: 26, density: 0.36 },
  { x: 63, z: 144.5, width: 30, depth: 26, density: 0.34 },
  { x: 98.4, z: 141.1, width: 30, depth: 26, density: 0.38 },
  { x: 143.5, z: 145.9, width: 30, depth: 26, density: 0.37 },
  { x: -175.8, z: 180.7, width: 30, depth: 26, density: 0.31 },
  { x: -141.9, z: 184, width: 30, depth: 26, density: 0.31 },
  { x: -14.3, z: 180.3, width: 30, depth: 26, density: 0.41 },
  { x: 25.6, z: 183.5, width: 30, depth: 26, density: 0.4 },
  { x: 138.9, z: 183.2, width: 30, depth: 26, density: 0.34 },
  { x: 181.3, z: 179.6, width: 30, depth: 26, density: 0.39 },
  // The brook's banks, under the ash line: the wet edge grows thickest.
  { x: -170.3, z: 88.6, width: 22, depth: 7, density: 0.65 },
  { x: -170.3, z: 118.6, width: 22, depth: 7, density: 0.65 },
  { x: -113.3, z: 35.8, width: 22, depth: 7, density: 0.65 },
  { x: -87.6, z: 23, width: 22, depth: 7, density: 0.65 },
  { x: -87.6, z: 53, width: 22, depth: 7, density: 0.65 },
  { x: -59.8, z: 30.3, width: 22, depth: 7, density: 0.65 },
  { x: -59.8, z: 60.3, width: 22, depth: 7, density: 0.65 },
  { x: -33.5, z: 45.7, width: 22, depth: 7, density: 0.65 },
  { x: -33.5, z: 75.7, width: 22, depth: 7, density: 0.65 },
  { x: -5.7, z: 56.1, width: 22, depth: 7, density: 0.65 },
  { x: -5.7, z: 86.1, width: 22, depth: 7, density: 0.65 },
  { x: 23.3, z: 55.7, width: 22, depth: 7, density: 0.65 },
  { x: 23.3, z: 85.7, width: 22, depth: 7, density: 0.65 },
  { x: 50.7, z: 44.8, width: 22, depth: 7, density: 0.65 },
  { x: 50.7, z: 74.8, width: 22, depth: 7, density: 0.65 },
  { x: 77.7, z: 31.9, width: 22, depth: 7, density: 0.65 },
  { x: 77.7, z: 61.9, width: 22, depth: 7, density: 0.65 },
  { x: 106.2, z: 23.8, width: 22, depth: 7, density: 0.65 },
  { x: 106.2, z: 53.8, width: 22, depth: 7, density: 0.65 },
  { x: 134.7, z: 15.2, width: 22, depth: 7, density: 0.65 },
  { x: 134.7, z: 45.2, width: 22, depth: 7, density: 0.65 },
  { x: 162.4, z: 3.5, width: 22, depth: 7, density: 0.65 },
  { x: 162.4, z: 33.5, width: 22, depth: 7, density: 0.65 },
  { x: 187.9, z: -5.5, width: 22, depth: 7, density: 0.65 },
  { x: 187.9, z: 24.5, width: 22, depth: 7, density: 0.65 },
];

export const HarrowmeadLayout: MapLayout = {
  placements,
  scatter,
  controlPoints,
  spawns,
  vehicles,
  water,
  grass,
  /**
   * `terrain.size * terrain.cell` equals it (100 x 4), the rim's boundary
   * boxes stay over 200 m (they are the BOUNDARY's extent plus 4, and the
   * boundary is this plus twice the borderland below — 1604), and the
   * heightfield grew with the square rather than getting coarser.
   */
  size: 400,
  // `surfaces` stays at the default 3: a farm stacks like a village (brook
  // bed, bank, hayloft), not like an office block.
  /**
   * Twice the default, and it is the borderland below that asks for it: the
   * floor is cut into patches of this, and with 600 m of pasture on every side
   * the default 48 would cut the ground into 193 meshes, two thirds of them
   * country nobody fights over, every one of them walked by the frame. At 96
   * it is 57, and the play floor's own share falls from 81 draws to 25.
   */
  terrainBlock: 96,
  /**
   * Four times the default, which is DRAW CALLS and nothing else: under a
   * 520 m fog the whole square is in view from anywhere in it, so a merge
   * block never leaves the frame for being far away and a fine grid buys the
   * cull nothing, while every block carries a draw per material. The village
   * and the fields put most of the kit's materials in most blocks, so the
   * count of blocks IS the draw count. Measured uncapped on the Windows box
   * with a body walking a circle from T0's yard: 48 m ran 122 fps on 588
   * active meshes, 134 m 202 on 360, and 200 m 244 on 301 — against 165 for
   * the hand-laid layout this replaced at 48. There is no see-through glass
   * on this map, so no probe drops its own block from a bake
   * (`ReflectionSystem.encloses`); this is the play square in 2 x 2.
   */
  blockSize: 200,
  /**
   * **No wall.** The vale is not closed by anything you can walk up to: the
   * fields carry on for six hundred metres past the play square and what
   * stops you is the leash, a countdown rather than a face of rock. See
   * `Borderland`, and `world/leash.ts` for the rule.
   *
   * **The margin is the HORIZON's and not the leash's.** The furthest a living
   * player gets is the play edge plus the leash's 69 m, and the far edge has
   * to be `fogEnd` (520) from there, so 520 + 69 rounded up; the cel fog is
   * linear, so a margin short of that draws a green line round the world.
   * Reduce it and the line comes back.
   *
   * `roll` is Sarab's — over 600 m of open country a metre of swing reads as
   * a table — and `ease` puts full amplitude back 40 m out, where a player
   * meets it, rather than a third of the margin out, which would flatten the
   * whole visible borderland into a smear of the map's own edge.
   */
  borderland: { margin: 600, roll: 3.2, ease: 40 },
  /**
   * **No rim at all.** The vale ends in more vale, and what closes the horizon
   * is the fog rather than a landform. `Ridge.ts` states the one condition on
   * taking `form: "none"`: a map may only draw nothing over its own boundary
   * if it has already laid something out there that reaches past `fogEnd` on
   * every bearing — which this map pays with the 600 m borderland above, so
   * the two fields are one decision. `EnvironmentSpec.ridgeColor` and
   * `ridgeScreeColor` are still set and read by nothing here.
   */
  ridge: {
    form: "none",
  },
  // Fixed so the dressing — and the colliders blocking scatter emits, and so
  // the nav graph — is identical on every boot. Changing it rerolls the whole
  // scatter field, which is a visible change to the level: re-walk the flags.
  seed: 0x48415257,
};
