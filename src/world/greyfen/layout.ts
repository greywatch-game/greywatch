/**
 * greyfen/layout.ts — THE MAP, as data: structure placements, scatter
 * regions, control points, spawns, water rects, grass rects. The floor's shape
 * is generated data and lives in heights.ts. Consumed by MapBuilder; nothing
 * here is code to special-case.
 * Gotchas that have already cost time: collider top faces within
 * CONFIG.nav.stepHeight of adjacent ground or bots treat decks as walls; a
 * control point's pos must NOT sit inside a PLACEMENT's collider; scatter
 * knows nothing about water, so every stand below was checked dry by the
 * generator; terrain steeper than a 0.4 gradient severs its own nav links.
 *
 * **SEEDED by `scripts/generate-greyfen.mjs`, and owned by the editor after
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
 * GREYFEN — a drowned jungle valley with a plantation rotting at its heart.
 *
 * 240 x 240 m, origin at the manor, +Z is north. A river comes in off the north
 * edge and splits at the confluence into a Y whose arms leave through the west
 * and east edges; five flags in a ring round the manor, with the two
 * uncapturable home spawns diagonally opposed so neither side starts next to C.
 *
 * ```
 *                                    N
 *    +---------------------------------------------------------+
 *    | VALEGUARD *   ~~~~ the lagoon ~~~~      ~ |    back       |
 *    |  outpost     A: THE STILT VILLAGE   hump ~|   country     |
 *    |  sandbags    walks a storey up     bridge=~= back road    |
 *    |    |     ____village track______ THE      ~ \             |
 *    |   fork  (-60,+76)             LANDING    ~   \ precinct   |
 *    |  sawmill                boathouse, market ~  D: THE TEMPLE |
 *    |  kilns                   causeway ~marsh~   (80,+34) hill |
 *    |    |                  \   lawn   /     \~~  processional |
 *    |  west road   kitchen   C: THE MANOR  trestle=== way   /   |
 *    |    |          yard    (0,-4) garden     \~~  river track  |
 *    | B: THE FERRY ~~  ferry track _____ drive  \~~~~~~ east    |
 *    |  (-97,-28)  ~~  landing       crossroads  foot-  ~~~~~~~~~|
 *    |  mission   ~~  ___ THE SPINE ___   /     bridge           |
 *    |  burial    ~~   OLD CITY       camp track   knoll         |
 *    |  ground  ~~~   (hollow)  ____ E: THE CAMP  look-out       |
 *    |~~~~~~~~~~~              path   (40,-84)  Redline road ___ |
 *    |                                           outpost REDLINE*|
 *    +---------------------------------------------------------+
 * ```
 *
 * ## A valley with places in it
 *
 * The forest is the default state of the ground — a trunk every six metres in
 * the deep parts, a canopy you cannot find a hole in — and it was all this map
 * had: between the five flags the valley was one texture. Now the forest is
 * what the PLACES are cut out of. The plantation built the manor at the
 * confluence, its landing on the bank below and a trestle east over the river
 * to the old temple on the hill; a village of stilt huts stands on the lagoon
 * upstream, a ferry crosses the west arm to the mission, the company's sawmill
 * burns charcoal on the west road, and under the ridge south of the manor lie
 * the courts of a town older than all of it. Somebody has dug a camp into the
 * deepest forest since. Every one of those is somewhere to find, a different
 * fight, and a thing to steer by.
 *
 * ## The ground
 *
 * The flood plain lies along the three arms, held low by the water; the manor
 * stands a metre over it on its terrace; the TEMPLE'S HILL rises nearly five
 * metres in the north-east and is the one place that stands clear of the mist.
 * THE SPINE — a wooded ridge from the ferry track to the camp's knoll — is what
 * stops C and E being one long lane; the drive crosses it on a saddle, and the
 * old city lies in the hollow under its south face where the mist is thickest.
 *
 * Design intent per flag:
 * - **A The Stilt Village** — huts a storey up on a walk eight metres north of
 *   the flag: a firing line over the clearing, a covered way under it, and two
 *   stairs on the flag's side as the only ways up.
 * - **B The Ferry** — the open bank between the ferry landing and the mission:
 *   still the most exposed flag on the map, its cover at its edges.
 * - **C The Manor** — the great hall, a gallery a storey up; approached by the
 *   drive through the walled garden, the causeway over the marsh, the trestle,
 *   and the kitchen yard.
 * - **D The Temple** — the flag you climb for, inside a broken precinct wall
 *   with a gate where each of its three roads arrives.
 * - **E The Camp** — dark and close under the deepest canopy, ringed by sandbag
 *   lines, with a look-out on the knoll to the east.
 *
 * Layout hygiene (the generator holds these; hand edits keep to them):
 * - Structures are axis-aligned (`rotY` in multiples of π/2). A builder's
 *   front is its local -Z: turn 0 faces south, π/2 west, π north, -π/2 east,
 *   and every front door opens onto a track, a yard or a flag's clearing.
 * - Nothing stands on a road, in the water, or on a slope, unless it is built
 *   to (a jetty, a bridge, the boathouse's water doors, the ferryman's hut).
 * - Roads are PATHS and end at junctions the network finds, at a yard, or at a
 *   crossing. Walls are cut wherever a track crosses them, which is where the
 *   gates are.
 * - The raised decks are authored as ABSOLUTE heights — the village walk at
 *   the district's level plus two metres, the causeway at +0.85 — and every
 *   stair is derived from the ground under its own foot. Move one and re-run
 *   the generator rather than nudging it here.
 * - The ORDER of the scatter array is load-bearing: every region draws from
 *   one seeded stream, so a region added anywhere but the end re-rolls every
 *   field below it — and adding a PLACEMENT re-rolls all of it.
 */

const placements: Placement[] = [
  // ===== tracks ====================================================================
  // Visual only: a track carries no collider, stops no round and is in no
  // baked structure. Every track is DIRT but the temple's processional way,
  // which is the one paved road in the valley and was laid before any of the
  // rest. Each is a PATH, so where two meet the network paves the junction.
  // The manor drive, from the portico down through the garden gate to the crossroads on the spine.
  { kind: "road", x: 0, z: -38.8, params: { path: [[0, 15.2], [0, -1.2], [0, -15.2]], width: 5, surface: "dirt" } },
  // The camp track, over the saddle and down into the camp.
  { kind: "road", x: 15, z: -63, params: { path: [[-15, 9], [-7, 1], [3, -5], [15, -9]], width: 4.5, surface: "dirt", radius: 12 } },
  // The ferry track, west along the spine's north flank to the east landing.
  { kind: "road", x: -28.5, z: -39.5, params: { path: [[28.5, -14.5], [14.5, -10.5], [4.5, -6.5], [-9.5, 1.5], [-19.5, 7.5], [-28.5, 14.5]], width: 4.5, surface: "dirt", radius: 14 } },
  // The old city path, off the ferry track over the spine and down into the hollow.
  { kind: "road", x: -34, z: -62.5, params: { path: [[10, 16.5], [6, 4.5], [-4, -7.5], [-10, -16.5]], width: 3.5, surface: "dirt", radius: 10 } },
  // …and out of it east along the foot of the spine to the camp.
  { kind: "road", x: -9, z: -84.5, params: { path: [[-35, 5.5], [-19, -3.5], [1, -5.5], [21, -3.5], [35, -0.5]], width: 3.5, surface: "dirt", radius: 12 } },
  // The north road: in off the north edge, round the Valeguard outpost and down to the village fork.
  { kind: "road", x: -106, z: 129, params: { path: [[-12, 61], [-12, -25], [-4, -45], [12, -61]], width: 5, surface: "dirt", radius: 18 } },
  // The west road, south from the fork past the sawmill to the ferry.
  { kind: "road", x: -100, z: 28, params: { path: [[6, 40], [-4, 24], [-6, 2], [-2, -20], [1, -40]], width: 5, surface: "dirt", radius: 18 } },
  // The village track, east along the stilt village's clearing to the Landing.
  { kind: "road", x: -52, z: 64.5, params: { path: [[-42, 3.5], [-26, -2.5], [-8, -3.5], [10, -1.5], [26, -1.5], [42, -0.5]], width: 4.5, surface: "dirt", radius: 14 } },
  // The bridge track, out of the Landing to the north footbridge.
  { kind: "road", x: 8.5, z: 84, params: { path: [[-12.5, -14], [-10.5, -2], [-2.5, 10], [12.5, 14]], width: 3.5, surface: "dirt", radius: 8 } },
  // The temple's back road, off the north footbridge and up the hill to the precinct's north gate.
  { kind: "road", x: 59.5, z: 78, params: { path: [[-16.5, 20], [-7.5, 12], [2.5, -4], [16.5, -20]], width: 3.5, surface: "dirt", radius: 12 } },
  // The processional way — the one paved road in the valley — from the trestle's east foot up to the temple's causeway.
  { kind: "road", x: 68.45, z: 12.75, params: { path: [[-11.55, -0.75], [-4.45, 0.25], [11.55, 0.75]], width: 5, surface: "cobble", radius: 10 } },
  // The south road: in off the south edge, round the Redline outpost and up to the fork — the north road's mirror.
  { kind: "road", x: 106, z: -129, params: { path: [[12, -61], [12, 25], [4, 45], [-12, 61]], width: 5, surface: "dirt", radius: 18 } },
  // The camp road, west from the fork down into the camp.
  { kind: "road", x: 73.5, z: -74, params: { path: [[20.5, 6], [6.5, 0], [-7.5, -6], [-20.5, -4]], width: 4.5, surface: "dirt", radius: 14 } },
  // The river track, north from the fork to the east footbridge and on up to the processional way.
  { kind: "road", x: 95, z: -58.75, params: { path: [[-1, -9.25], [1, 9.25]], width: 3.5, surface: "dirt", radius: 12 } },
  { kind: "road", x: 84, z: -7.05, params: { path: [[12, -20.45], [12, -6.95], [6, 9.05], [-12, 20.45]], width: 3.5, surface: "dirt", radius: 12 } },
  // The manor's service track, from the kitchen yard round to the north lawn and the trestle.
  { kind: "road", x: -6.95, z: 0, params: { path: [[-23.05, -12], [-19.05, 6], [-11.05, 10.8], [10.95, 10.8], [23.05, 12]], width: 3.5, surface: "dirt", radius: 8 } },
  // ===== C: The Manor ==============================================================
  // The plantation house on its terrace at the confluence, front to the south:
  // the flag in its great hall, the gallery a storey up, and a lawn running down
  // its north side to the causeway over the marsh. Its garden is walled below
  // the portico, the drive running down through it to the crossroads on the
  // spine; the kitchen yard stands off its west flank, and the overseer's house
  // on a terrace cut into the spine over the ferry track.
  { kind: "manor", x: 0, z: -4, params: { litWindows: true } },
  { kind: "trestleBridge", x: 36.5, z: 12, y: 1.61, rotY: Math.PI / 2 },
  { kind: "well", x: -8, z: -41 },
  { kind: "shed", x: -20, z: -36, rotY: -Math.PI / 2, params: { width: 4.4, depth: 3 } },
  { kind: "shed", x: 21, z: -45, rotY: Math.PI / 2, params: { width: 4.4, depth: 3 } },
  { kind: "cart", x: 4.5, z: -44, rotY: Math.PI / 2 },
  { kind: "jungleRuin", x: -46, z: -49.5, rotY: Math.PI, params: { width: 11, depth: 8 } },
  { kind: "shed", x: -40, z: -4, rotY: -Math.PI / 2, params: { width: 5, depth: 3.2 } },
  { kind: "woodpile", x: -26, z: -20, rotY: Math.PI / 2, params: { length: 4 } },
  { kind: "crates", x: -40, z: -24 },
  { kind: "shed", x: 18, z: -30, rotY: Math.PI / 2, params: { width: 6, depth: 3.4 } },
  { kind: "cart", x: 26, z: -30, params: { ruined: true } },
  // ===== The Landing ===============================================================
  // Where the three arms meet. The causeway runs up the marsh bar from the
  // manor's lawn to the north bank, two fishermen's huts on piles beside it;
  // on the bank the Landing — the boathouse on the north arm, a river boat
  // slipped on the shore, the market stalls and the company's store.
  { kind: "boardwalk", x: 0, z: 20.844, y: 1.016, params: { length: 10.688, railSide: "none" } },
  { kind: "boardwalk", x: 0, z: 31.531, y: 1.03, params: { length: 10.688, railSide: "none" } },
  { kind: "boardwalk", x: 0, z: 42.219, y: 1.03, params: { length: 10.688, railSide: "none" } },
  { kind: "boardwalk", x: 0, z: 52.906, y: 1.011, params: { length: 10.688, railSide: "none" } },
  { kind: "stairs", x: 0, z: 14.429, y: 0.157, params: { height: 0.749, railSide: "none" } },
  { kind: "stairs", x: 0, z: 59.639, y: 0.044, rotY: Math.PI, params: { height: 0.973, railSide: "none" } },
  { kind: "stiltHut", x: 5.45, z: 29.75, y: 1.119, rotY: Math.PI / 2, params: { litWindows: true } },
  { kind: "stiltHut", x: -5.45, z: 44, y: 1.07, rotY: -Math.PI / 2, params: { litWindows: true } },
  { kind: "boathouse", x: 16, z: 80, rotY: Math.PI / 2 },
  { kind: "careenedHull", x: -12, z: 86, rotY: Math.PI / 2, params: { length: 10 } },
  { kind: "stall", x: -4, z: 60, rotY: Math.PI / 2 },
  { kind: "crates", x: 3, z: 64 },
  { kind: "fishRack", x: 4, z: 70, rotY: Math.PI / 2, params: { length: 7 } },
  { kind: "shed", x: -13, z: 74, rotY: -Math.PI / 2, params: { width: 6.6, depth: 4 } },
  { kind: "bridge", x: 32, z: 98, y: 1.132, rotY: Math.PI / 2, params: { length: 20, width: 2.6 } },
  // ===== A: The Stilt Village ======================================================
  // A village of stilt huts on the lagoon's south shore, a storey up: one walk
  // runs east-west eight metres north of the flag with the huts off its north
  // side and one at each end, so the walks are a firing line over the clearing
  // and the ground under them a covered way in. Two stairs, both on the flag's
  // side, are the only ways up — taking the height means crossing open ground
  // under it first. Fish racks on the shore and a jetty into the lagoon behind.
  { kind: "boardwalk", x: -74.667, z: 84, y: 2, rotY: Math.PI / 2, params: { length: 14.667, railSide: "none" } },
  { kind: "boardwalk", x: -60, z: 84, y: 2, rotY: Math.PI / 2, params: { length: 14.667, railSide: "none" } },
  { kind: "boardwalk", x: -45.333, z: 84, y: 2, rotY: Math.PI / 2, params: { length: 14.667, railSide: "none" } },
  { kind: "stiltHut", x: -75, z: 89.4, y: 2, params: { litWindows: false } },
  { kind: "stiltHut", x: -62.6, z: 89.4, y: 2, params: { litWindows: false } },
  { kind: "stiltHut", x: -50.2, z: 89.4, y: 2, params: { litWindows: true } },
  { kind: "stiltHut", x: -86.2, z: 84, y: 2, rotY: -Math.PI / 2, params: { litWindows: true } },
  { kind: "stiltHut", x: -33.8, z: 84, y: 2, rotY: Math.PI / 2 },
  { kind: "stairs", x: -71, z: 79.229, params: { height: 2.5 } },
  { kind: "stairs", x: -46, z: 79.229, params: { height: 2.5 } },
  { kind: "stiltHut", x: -79, z: 72, rotY: -Math.PI / 2, params: { litWindows: true } },
  { kind: "stiltHut", x: -37, z: 73, rotY: Math.PI / 2 },
  { kind: "well", x: -70, z: 68 },
  { kind: "stall", x: -48, z: 68 },
  { kind: "fishRack", x: -34, z: 96, params: { length: 8 } },
  { kind: "jetty", x: -42, z: 101.5, y: 0.577, rotY: Math.PI, params: { length: 12 } },
  // ===== B: The Ferry ==============================================================
  // The ferry over the west arm: a landing on each bank facing the other, the
  // ferry itself slipped on the west shore, and the ferryman's hut half over
  // the water. The flag is the open bank between the landing and the mission —
  // still the most exposed flag on the map, now with its cover at its edges
  // rather than none at all. The mission stands on the rise south of it, with
  // its burial ground walled beside it.
  { kind: "jetty", x: -73.9, z: -24, y: 0.295, rotY: Math.PI / 2, params: { length: 9 } },
  { kind: "jetty", x: -63.9, z: -24, y: 0.286, rotY: Math.PI / 2, params: { length: 9 } },
  { kind: "stiltHut", x: -76.9, z: -12, rotY: Math.PI / 2, params: { litWindows: true } },
  { kind: "careenedHull", x: -88, z: -40, params: { length: 11 } },
  { kind: "crates", x: -88, z: -16 },
  { kind: "shed", x: -114, z: -30, rotY: -Math.PI / 2, params: { width: 4.4, depth: 3 } },
  { kind: "stall", x: -104, z: -40, rotY: Math.PI },
  { kind: "jungleRuin", x: -110, z: -54, rotY: Math.PI, params: { width: 12, depth: 9 } },
  { kind: "well", x: -94, z: -50 },
  // ===== the sawmill ===============================================================
  // On the west road between the village and the ferry: the charcoal kilns
  // with their mouths to the yard, the cordwood stacked round them, the
  // sawyer's house and his sheds.
  { kind: "kiln", x: -97, z: 48, rotY: Math.PI / 2 },
  { kind: "woodpile", x: -96, z: 38, rotY: Math.PI / 2, params: { length: 6 } },
  { kind: "stiltHut", x: -113.5, z: 44, rotY: -Math.PI / 2, params: { litWindows: true } },
  { kind: "woodpile", x: -112, z: 56, params: { length: 6 } },
  { kind: "woodpile", x: -113, z: 30, rotY: Math.PI / 2, params: { length: 6 } },
  { kind: "woodpile", x: -92, z: 56, rotY: Math.PI / 2, params: { length: 5 } },
  { kind: "shed", x: -92, z: 30, rotY: Math.PI / 2, params: { width: 5, depth: 3.2 } },
  { kind: "cart", x: -98, z: 28, rotY: Math.PI / 2 },
  { kind: "crates", x: -91.5, z: 43.5 },
  // ===== D: The Temple =============================================================
  // The temple on the crown of the hill, three terraces of it with the flag in
  // the sanctuary's socket; the processional way climbs to its south stair from
  // the trestle, the back road to its north court from the footbridge, and the
  // river track up from Redline's side. A broken precinct wall rings the summit,
  // with its gates where the roads come in, and steles line the paved way.
  { kind: "templeRuin", x: 80, z: 34 },
  // ===== E: The Camp ===============================================================
  // A camp dug in under the deepest canopy on the map: huts round the clearing,
  // sandbag lines at its edges, the stores and the cookhouse, the look-out on
  // the knoll east of it. Dark and close, and every approach ends at a wall of
  // bags.
  { kind: "stiltHut", x: 48, z: -67, params: { litWindows: true } },
  { kind: "stiltHut", x: 29, z: -99, rotY: Math.PI },
  { kind: "stiltHut", x: 50, z: -99, rotY: Math.PI },
  { kind: "sandbags", x: 40, z: -75, params: { length: 6 } },
  { kind: "sandbags", x: 40, z: -93, params: { length: 6 } },
  { kind: "sandbags", x: 31, z: -84, rotY: Math.PI / 2, params: { length: 5 } },
  { kind: "sandbags", x: 49, z: -84, rotY: Math.PI / 2, params: { length: 5 } },
  { kind: "sandbags", x: 58, z: -90, rotY: Math.PI / 2, params: { length: 6 } },
  { kind: "sandbags", x: 22, z: -80, rotY: Math.PI / 2, params: { length: 6 } },
  { kind: "sandbags", x: 34, z: -69, params: { length: 5 } },
  { kind: "crates", x: 62, z: -74 },
  { kind: "crates", x: 41, z: -104, rotY: Math.PI / 2 },
  { kind: "shed", x: 60, z: -100, rotY: -Math.PI / 2, params: { width: 5, depth: 3.2 } },
  { kind: "shed", x: 60, z: -68, rotY: Math.PI / 2, params: { width: 4.4, depth: 3 } },
  { kind: "watchtower", x: 72, z: -54 },
  { kind: "bridge", x: 96, z: -38.5, y: 1.13, params: { length: 20, width: 2.6 } },
  // ===== the old city ==============================================================
  // Older than the temple and far older than the manor: the courts of a town
  // nobody names, sunk in the hollow under the spine where the mist lies
  // thickest. Broken walls of mossy stone at every height from a kerb to a
  // man's head, laid as courts and lanes and cut wherever the path goes
  // through them; steles and boulders in the courts between them.
  // ===== the outposts ==============================================================
  // Each side's home: a sandbagged picket either side of its road with its
  // stores, and the side deploying in the lee of the bags.
  { kind: "sandbags", x: -100, z: 90, params: { length: 6 } },
  { kind: "sandbags", x: -111, z: 99, rotY: Math.PI / 2, params: { length: 5 } },
  { kind: "sandbags", x: -89, z: 99, rotY: Math.PI / 2, params: { length: 5 } },
  { kind: "crates", x: -88, z: 105 },
  { kind: "shed", x: -104, z: 106, params: { width: 5, depth: 3.2 } },
  { kind: "sandbags", x: 100, z: -90, params: { length: 6 } },
  { kind: "sandbags", x: 111, z: -99, rotY: Math.PI / 2, params: { length: 5 } },
  { kind: "sandbags", x: 89, z: -99, rotY: Math.PI / 2, params: { length: 5 } },
  { kind: "crates", x: 88, z: -105 },
  { kind: "shed", x: 104, z: -106, rotY: Math.PI, params: { width: 5, depth: 3.2 } },
  // ===== the walls =================================================================
  // Every wall line cut into runs wherever a track, a building or the water
  // crosses it, so the gates are where the tracks are. Mossy dry stone: it
  // stops a round, and it is never the same height twice.
  { kind: "stoneWall", x: -26, z: -37, rotY: Math.PI / 2, params: { length: 6.3, height: 0.6 } },
  { kind: "stoneWall", x: -26, z: -29.5, rotY: Math.PI / 2, params: { length: 6.3, height: 0.6 } },
  { kind: "stoneWall", x: 26, z: -47.6, rotY: Math.PI / 2, params: { length: 8, height: 1.63 } },
  { kind: "stoneWall", x: 26, z: -38.4, rotY: Math.PI / 2, params: { length: 8, height: 0.6 } },
  { kind: "stoneWall", x: -20.5, z: -52, params: { length: 2.3, height: 1.29 } },
  { kind: "stoneWall", x: 8.9, z: -52, params: { length: 9.1, height: 1.68 } },
  { kind: "stoneWall", x: 19.1, z: -52, params: { length: 9, height: 1.68 } },
  { kind: "stoneWall", x: 60, z: 6, rotY: Math.PI / 2, params: { length: 3.3, height: 1.11 } },
  { kind: "stoneWall", x: 60, z: 20.7, rotY: Math.PI / 2, params: { length: 7.7, height: 1.39 } },
  { kind: "stoneWall", x: 60, z: 38.3, rotY: Math.PI / 2, params: { length: 7.5, height: 1.43 } },
  { kind: "stoneWall", x: 100, z: 8.5, rotY: Math.PI / 2, params: { length: 8.4, height: 1.13 } },
  { kind: "stoneWall", x: 100, z: 27.3, rotY: Math.PI / 2, params: { length: 8.1, height: 1.26 } },
  { kind: "stoneWall", x: 100, z: 36.7, rotY: Math.PI / 2, params: { length: 8.1, height: 1.22 } },
  { kind: "stoneWall", x: 100, z: 46, rotY: Math.PI / 2, params: { length: 8.1, height: 0.89 } },
  { kind: "stoneWall", x: 65, z: 60, params: { length: 9.3, height: 1.04 } },
  { kind: "stoneWall", x: 66.5, z: 4, params: { length: 8.3, height: 0.99 } },
  { kind: "stoneWall", x: -112, z: 10, params: { length: 9.3, height: 0.98 } },
  { kind: "stoneWall", x: -107, z: -2.6, rotY: Math.PI / 2, params: { length: 6.1, height: 1.13 } },
  { kind: "stoneWall", x: -107, z: 4.6, rotY: Math.PI / 2, params: { length: 6.1, height: 1.25 } },
  { kind: "stoneWall", x: -113, z: -6, params: { length: 7.3, height: 1.13 } },
  { kind: "stoneWall", x: -58.3, z: -66, params: { length: 6.7, height: 2.15 } },
  { kind: "stoneWall", x: -50.5, z: -66, params: { length: 6.5, height: 2.1 } },
  { kind: "stoneWall", x: -42.7, z: -66, params: { length: 6.7, height: 1.98 } },
  { kind: "stoneWall", x: -27.3, z: -66, params: { length: 5.8, height: 2.41 } },
  { kind: "stoneWall", x: -62, z: -96.1, rotY: Math.PI / 2, params: { length: 7.1, height: 1.88 } },
  { kind: "stoneWall", x: -62, z: -88, rotY: Math.PI / 2, params: { length: 6.8, height: 1.4 } },
  { kind: "stoneWall", x: -62, z: -80, rotY: Math.PI / 2, params: { length: 6.8, height: 1.71 } },
  { kind: "stoneWall", x: -62, z: -71.9, rotY: Math.PI / 2, params: { length: 7.1, height: 0.6 } },
  { kind: "stoneWall", x: -24, z: -96, rotY: Math.PI / 2, params: { length: 7.3, height: 1.34 } },
  { kind: "stoneWall", x: -24, z: -80.9, rotY: Math.PI / 2, params: { length: 7.6, height: 1.54 } },
  { kind: "stoneWall", x: -24, z: -72.1, rotY: Math.PI / 2, params: { length: 7.6, height: 1.23 } },
  { kind: "stoneWall", x: -55.9, z: -100, params: { length: 7.5, height: 1.3 } },
  { kind: "stoneWall", x: -47.3, z: -100, params: { length: 7.3, height: 0.6 } },
  { kind: "stoneWall", x: -38.8, z: -100, params: { length: 7.3, height: 1.13 } },
  { kind: "stoneWall", x: -30.1, z: -100, params: { length: 7.5, height: 1.06 } },
  { kind: "stoneWall", x: -54, z: -84.1, rotY: Math.PI / 2, params: { length: 7.1, height: 1.47 } },
  { kind: "stoneWall", x: -54, z: -75.9, rotY: Math.PI / 2, params: { length: 7.1, height: 1.65 } },
  { kind: "stoneWall", x: -34, z: -76.5, rotY: Math.PI / 2, params: { length: 8.3, height: 1.9 } },
  { kind: "stoneWall", x: -53.5, z: -94, params: { length: 8.4, height: 0.77 } },
  { kind: "stoneWall", x: -44, z: -94, params: { length: 8.1, height: 0.91 } },
  { kind: "stoneWall", x: -34.5, z: -94, params: { length: 8.4, height: 0.82 } },
  { kind: "stoneWall", x: -64.9, z: -58, params: { length: 7.6, height: 1.64 } },
  { kind: "stoneWall", x: -56.1, z: -58, params: { length: 7.5, height: 0.6 } },
];

/**
 * Dressing. Every stand inside the square was checked by the generator against
 * the finished floor — dry, clear of every building and yard, and under a
 * grade a tree stands on. A road rejects what grows by itself
 * (`world/roads.ts`), stone and logs were checked clear of the carriageways,
 * and blocking props are held off every flag and spawn by
 * `MapBuilder.keepClear`.
 *
 * The canopy starts nine metres up and the trunk is the whole collider (see
 * `PROP_BODIES`), so a stand is cover in the sense that TRUNKS are cover: a
 * level sightline through the deep forest runs about thirty metres before one
 * is in it. The clearings, the river and the tracks are the only long lanes.
 */
const scatter: ScatterSpec[] = [
  // ===== the set pieces' dressing ==================================================
  // Placed first, because each is a place's own and the forest is what is left.
  // Stone does not grow, so a road does not refuse it: every region of it below
  // was checked clear of the carriageways by the generator.
  { prop: "carvedStele", x: 52, z: 17.6, width: 10, depth: 1.6, count: 3, scale: [0.85, 1.25], blocking: true, clearance: 0.7 },
  { prop: "carvedStele", x: 62.9, z: 8.2, width: 3.8, depth: 2, count: 2, scale: [0.85, 1.25], blocking: true, clearance: 0.7 },
  { prop: "carvedStele", x: 62.9, z: 17.6, width: 3.8, depth: 1.6, count: 2, scale: [0.85, 1.25], blocking: true, clearance: 0.7 },
  { prop: "boulder", x: 107, z: 40, radius: 5, count: 3, scale: [0.8, 1.3], blocking: true, clearance: 1.0 },
  { prop: "boulder", x: 62.9, z: 44, radius: 1.9, count: 1, scale: [0.8, 1.3], blocking: true, clearance: 1.0 },
  { prop: "carvedStele", x: 97, z: 18, radius: 2, count: 1, scale: [0.85, 1.25], blocking: true, clearance: 0.7 },
  { prop: "carvedStele", x: 96.6, z: 44, radius: 1.5, count: 1, scale: [0.85, 1.25], blocking: true, clearance: 0.7 },
  { prop: "boulder", x: 109, z: 24, radius: 5, count: 3, scale: [0.8, 1.3], blocking: true, clearance: 1.0 },
  { prop: "carvedStele", x: -58, z: -80, width: 4, depth: 12, count: 3, scale: [0.85, 1.25], blocking: true, clearance: 0.7 },
  { prop: "carvedStele", x: -29, z: -76, width: 4, depth: 8, count: 2, scale: [0.85, 1.25], blocking: true, clearance: 0.7 },
  { prop: "boulder", x: -44, z: -97, width: 24, depth: 3, count: 3, scale: [0.8, 1.3], blocking: true, clearance: 1.0 },
  { prop: "boulder", x: -58, z: -62, width: 8, depth: 3, count: 2, scale: [0.8, 1.3], blocking: true, clearance: 1.0 },
  { prop: "carvedStele", x: -50, z: -80, width: 5, depth: 10, count: 2, scale: [0.85, 1.25], blocking: true, clearance: 0.7 },
  { prop: "gravestone", x: -112.5, z: 2, width: 8, depth: 13, count: 12, scale: [0.8, 1.2], blocking: true, clearance: 0.6 },
  { prop: "barrel", x: -4, z: 66, radius: 3, count: 3, blocking: true, clearance: 0.55 },
  { prop: "barrel", x: 44, z: -78, radius: 3, count: 3, blocking: true, clearance: 0.55 },
  { prop: "barrel", x: -92, z: -20, radius: 2, count: 2, blocking: true, clearance: 0.55 },
  { prop: "barrel", x: -104, z: 50, radius: 2, count: 2, blocking: true, clearance: 0.55 },
  { prop: "barrel", x: -34, z: -12, radius: 2, count: 2, blocking: true, clearance: 0.55 },
  { prop: "fireDrum", x: 36, z: -78, radius: 1.5, count: 1, blocking: true, clearance: 0.6 },
  // ===== the forest ================================================================
  // The jungle, sown against the finished floor on a 12 m lattice: a stand is a
  // disc checked dry, clear of every building and yard, and under a grade a
  // tree stands on; where a stand does not fit, a smaller one is tried. A track
  // cuts its own avenue through it — a jungle tree is ROOTED, so `findSpot`
  // keeps it off every carriageway. About one trunk per 36 m² in the deep
  // forest and a tenth of that in a clearing.
  { prop: "jungleTree", x: -115.9, z: -112, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -109.9, z: -112, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -103.5, z: -111.2, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -103.5, z: -111.2, radius: 3.2, count: 3, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -97.5, z: -111.2, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -92.3, z: -112.3, radius: 3.2, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -86.3, z: -112.3, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -86.3, z: -112.3, radius: 3.2, count: 3, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -78, z: -113, radius: 6.8, count: 3, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "buttressLog", x: -78, z: -113, radius: 6.8, count: 1, scale: [0.85, 1.2], blocking: true, clearance: 1.6 },
  { prop: "jungleTree", x: -66, z: -113, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "buttressLog", x: -66, z: -113, radius: 6.8, count: 1, scale: [0.85, 1.2], blocking: true, clearance: 1.6 },
  { prop: "jungleTree", x: -55.5, z: -117.9, radius: 2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -55.5, z: -111.9, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -49.5, z: -111.9, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -42.5, z: -112.5, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -30.8, z: -112.8, radius: 6.8, count: 3, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -30.8, z: -112.8, radius: 6.8, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -22.3, z: -117.5, radius: 2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -16.3, z: -111.5, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -7.9, z: -112.1, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 6.1, z: -113.1, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 19.5, z: -117.4, radius: 2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 19.5, z: -111.4, radius: 3.2, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 26.4, z: -111.6, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 32.4, z: -111.6, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 32.4, z: -111.6, radius: 3.2, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 40.4, z: -111.7, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 46.4, z: -111.7, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 51, z: -116.6, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 57, z: -116.6, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 57, z: -116.6, radius: 3.2, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 51, z: -110.6, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 57, z: -110.6, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 67.2, z: -113.2, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 67.2, z: -113.2, radius: 6.8, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 77.3, z: -112.8, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 87.6, z: -116.2, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 93.6, z: -116.2, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 87.6, z: -110.2, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 87.6, z: -110.2, radius: 3.2, count: 3, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 97.6, z: -112.3, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 97.6, z: -112.3, radius: 3.2, count: 3, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 103.6, z: -112.3, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 117.3, z: -116.9, radius: 2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -111.3, z: -106, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -111.3, z: -106, radius: 3.2, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -117.3, z: -100, radius: 2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -111.3, z: -100, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -102.9, z: -100.9, radius: 6.8, count: 3, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -102.9, z: -100.9, radius: 6.8, count: 3, scale: [0.8, 1.4] },
  { prop: "buttressLog", x: -102.9, z: -100.9, radius: 6.8, count: 1, scale: [0.85, 1.2], blocking: true, clearance: 1.6 },
  { prop: "jungleTree", x: -88.6, z: -101.6, radius: 6.8, count: 2, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -77.8, z: -101.7, radius: 6.8, count: 3, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -64.6, z: -102.2, radius: 6.8, count: 3, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -64.6, z: -102.2, radius: 6.8, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -54.4, z: -101.7, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -42, z: -100.8, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -29.6, z: -101, radius: 6.8, count: 3, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -29.6, z: -101, radius: 6.8, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -18.1, z: -102.6, radius: 6.8, count: 3, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -5.7, z: -100.6, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -5.7, z: -100.6, radius: 6.8, count: 3, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 5.5, z: -102.8, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 17.2, z: -103.2, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 30, z: -102.3, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 42.6, z: -100.7, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 53.1, z: -100.6, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 53.1, z: -100.6, radius: 6.8, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 64.5, z: -102.9, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 79, z: -101.4, radius: 6.8, count: 3, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -93.5, z: -92, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -87.5, z: -92, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -87.5, z: -92, radius: 3.2, count: 3, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -87.5, z: -86, radius: 2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -78.1, z: -89.3, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -67.2, z: -89.1, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -53.3, z: -88.8, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -42.2, z: -90.3, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -31.2, z: -89.7, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -19.3, z: -89.6, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -5.5, z: -89.4, radius: 6.8, count: 3, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 6.6, z: -89.7, radius: 6.8, count: 3, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 16.8, z: -90.1, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 26.9, z: -92.6, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 26.9, z: -92.6, radius: 3.2, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 32.9, z: -92.6, radius: 2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 26.9, z: -86.6, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 44.2, z: -94.4, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 49.5, z: -92.4, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 55.5, z: -92.4, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 66.8, z: -90.8, radius: 6.8, count: 3, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 76.7, z: -89.3, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -79.9, z: -79.8, radius: 2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -73.9, z: -79.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -73.9, z: -73.8, radius: 3.2, count: 2, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -73.9, z: -73.8, radius: 3.2, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -66.5, z: -76.9, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -53, z: -77.2, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -41.2, z: -78, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -41.2, z: -78, radius: 6.8, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -30.3, z: -78.4, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -30.3, z: -78.4, radius: 6.8, count: 3, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -19.5, z: -77.6, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -5.6, z: -78.9, radius: 6.8, count: 3, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 7.1, z: -77.2, radius: 6.8, count: 3, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 16, z: -80.9, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 16, z: -80.9, radius: 3.2, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 26.3, z: -80.3, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 26.3, z: -80.3, radius: 3.2, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 32.3, z: -74.3, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 38.7, z: -74, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 38.7, z: -74, radius: 3.2, count: 3, scale: [0.8, 1.4] },
  { prop: "fernClump", x: 44.7, z: -74, radius: 3.2, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 53.6, z: -77.3, radius: 6.8, count: 2, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 66.6, z: -77.8, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 77.3, z: -77.4, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 90.6, z: -79.2, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 103.3, z: -76.7, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 103.3, z: -76.7, radius: 6.8, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 113.1, z: -79, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -116.4, z: -70.5, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -110.4, z: -70.5, radius: 2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -116.4, z: -64.5, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -110.4, z: -64.5, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -110.4, z: -64.5, radius: 3.2, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -106.1, z: -69.6, radius: 2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -106.1, z: -63.6, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -106.1, z: -63.6, radius: 3.2, count: 3, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -100.1, z: -63.6, radius: 2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -69.8, z: -70.5, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -69.8, z: -70.5, radius: 3.2, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -63.8, z: -70.5, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -63.8, z: -70.5, radius: 3.2, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -69.8, z: -64.5, radius: 2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -63.8, z: -64.5, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -52.7, z: -67.3, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -52.7, z: -67.3, radius: 6.8, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -42.6, z: -66, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -30.8, z: -67, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -16.6, z: -65.1, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -4.8, z: -64.9, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -4.8, z: -64.9, radius: 6.8, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 6.4, z: -65.1, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 14.7, z: -70.1, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 14.7, z: -64.1, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 20.7, z: -64.1, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 33.5, z: -67.6, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 33.5, z: -67.6, radius: 3.2, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 27.5, z: -61.6, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 27.5, z: -61.6, radius: 3.2, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 33.5, z: -61.6, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 42.2, z: -64.7, radius: 6.8, count: 3, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 42.2, z: -64.7, radius: 6.8, count: 3, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 53.3, z: -65.2, radius: 6.8, count: 3, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 53.3, z: -65.2, radius: 6.8, count: 3, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 67, z: -64.6, radius: 6.8, count: 3, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 78, z: -66.7, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 89.3, z: -65.9, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 89.3, z: -65.9, radius: 6.8, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 102.3, z: -64.7, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 112.3, z: -68.1, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 112.3, z: -62.1, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 112.3, z: -62.1, radius: 3.2, count: 3, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -111, z: -55.5, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -111, z: -49.5, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -103.4, z: -53.1, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -93.2, z: -50.9, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -93.2, z: -50.9, radius: 3.2, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -62.7, z: -57, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -62.7, z: -51, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -54.2, z: -53.7, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -54.2, z: -53.7, radius: 6.8, count: 3, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -41.7, z: -52.7, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -41.7, z: -52.7, radius: 6.8, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -29.3, z: -54.5, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -18.6, z: -53.6, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -18.6, z: -53.6, radius: 6.8, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -7.1, z: -55.4, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 5.1, z: -54.1, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 17.2, z: -54.6, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 28.6, z: -55.2, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 41.2, z: -54.8, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 55.5, z: -55.4, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 66.5, z: -54, radius: 6.8, count: 3, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 78.4, z: -53.4, radius: 6.8, count: 2, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 88.2, z: -56.2, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 88.2, z: -56.2, radius: 3.2, count: 3, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 101.9, z: -55.3, radius: 6.8, count: 3, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 109.6, z: -55.6, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 115.6, z: -55.6, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -112.3, z: -43.7, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -112.3, z: -37.7, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -101.7, z: -41.5, radius: 6.8, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -101.7, z: -41.5, radius: 6.8, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -93.5, z: -46.2, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -87.5, z: -40.2, radius: 3.2, count: 3, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -61.9, z: -46, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -54.8, z: -40.6, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -40.7, z: -42.8, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -28.9, z: -43.2, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -18.8, z: -43.2, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -6.9, z: -41, radius: 6.8, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -6.9, z: -41, radius: 6.8, count: 3, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 5.6, z: -40.5, radius: 6.8, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 17.7, z: -41.5, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 28.5, z: -43.1, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 41.8, z: -41.2, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 52.7, z: -42.3, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 52.7, z: -42.3, radius: 6.8, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 62.9, z: -44.9, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 68.9, z: -44.9, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 68.9, z: -44.9, radius: 3.2, count: 3, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -112.1, z: -32.6, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -112.1, z: -32.6, radius: 3.2, count: 1, scale: [0.8, 1.4] },
  { prop: "fernClump", x: -112.1, z: -26.6, radius: 3.2, count: 1, scale: [0.8, 1.4] },
  { prop: "fernClump", x: -86, z: -34.2, radius: 3.2, count: 3, scale: [0.8, 1.4] },
  { prop: "fernClump", x: -86, z: -28.2, radius: 3.2, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -42.8, z: -31.5, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -31.4, z: -30, radius: 6.8, count: 3, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -19.3, z: -28.6, radius: 6.8, count: 3, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -19.3, z: -28.6, radius: 6.8, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -7.9, z: -34.4, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -7.9, z: -34.4, radius: 3.2, count: 3, scale: [0.8, 1.4] },
  { prop: "fernClump", x: -1.9, z: -34.4, radius: 3.2, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 6.1, z: -29.1, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 19.3, z: -30.3, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 30.3, z: -28.8, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 43.4, z: -29.5, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 52.1, z: -32.7, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 52.1, z: -32.7, radius: 3.2, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 104.9, z: -27.4, radius: 2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -112.9, z: -19.1, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -103.6, z: -15.1, radius: 3.2, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -87.5, z: -13.6, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -87.5, z: -13.6, radius: 3.2, count: 3, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -81.2, z: -13.5, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -52.2, z: -13.9, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -40.6, z: -17.1, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -30.9, z: -16.7, radius: 6.8, count: 3, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -30.9, z: -16.7, radius: 6.8, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -16.8, z: -17.3, radius: 6.8, count: 3, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -10.1, z: -21.7, radius: 2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -4.1, z: -21.7, radius: 2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -10.1, z: -15.7, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -4.1, z: -15.7, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 5.7, z: -17.7, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 17.2, z: -19.3, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 28.8, z: -17, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 39, z: -19.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 45, z: -19.8, radius: 2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 39, z: -13.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 82.3, z: -22.4, radius: 2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 76.3, z: -16.4, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 76.3, z: -16.4, radius: 3.2, count: 3, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 82.3, z: -16.4, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 89.5, z: -17.4, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 102.6, z: -18.1, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 102.6, z: -18.1, radius: 6.8, count: 3, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 111, z: -20, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 117, z: -20, radius: 2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 111, z: -14, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 111, z: -14, radius: 3.2, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -117.3, z: -9.5, radius: 2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -111.3, z: -9.5, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -111.3, z: -3.5, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -111.3, z: -3.5, radius: 3.2, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -102.1, z: -6.1, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -89.8, z: -6.1, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -80.7, z: -8.3, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -80.7, z: -8.3, radius: 3.2, count: 3, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -80.7, z: -2.3, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -51, z: -9.1, radius: 2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -44.7, z: -8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -38.7, z: -8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -38.7, z: -2, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -38.7, z: -2, radius: 3.2, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -31.2, z: -5.4, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -18.7, z: -5.6, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -5.6, z: -6.8, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 7.2, z: -6.2, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 16.8, z: -5.5, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 16.8, z: -5.5, radius: 6.8, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 29.9, z: -7.3, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 29.9, z: -7.3, radius: 6.8, count: 3, scale: [0.8, 1.4] },
  { prop: "buttressLog", x: 29.9, z: -7.3, radius: 6.8, count: 1, scale: [0.85, 1.2], blocking: true, clearance: 1.6 },
  { prop: "jungleTree", x: 69.7, z: -9.8, radius: 3.2, count: 2, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 69.7, z: -9.8, radius: 3.2, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 69.7, z: -3.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 79.3, z: -7.5, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 89.6, z: -5.1, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 101.4, z: -6.7, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 113.1, z: -4.9, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -117.2, z: 2.9, radius: 2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -111.2, z: 2.9, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -111.2, z: 2.9, radius: 3.2, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -111.2, z: 8.9, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -101.4, z: 6, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -101.4, z: 6, radius: 6.8, count: 3, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -90.8, z: 4.7, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -79.2, z: 4.7, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -69.7, z: 7.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -69.7, z: 7.8, radius: 3.2, count: 3, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -28.1, z: 4.2, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -18.3, z: 6, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -18.3, z: 6, radius: 6.8, count: 3, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -5.9, z: 6.5, radius: 6.8, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -5.9, z: 6.5, radius: 6.8, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 19.1, z: 6.3, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 27.7, z: 2.4, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 57.8, z: 8.2, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 57.8, z: 8.2, radius: 3.2, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 66.7, z: 4.7, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 75, z: 1.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 81, z: 1.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 89.7, z: 5.8, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 102.5, z: 7.3, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 111.4, z: 2.1, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 117.4, z: 2.1, radius: 2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 111.4, z: 8.1, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 117.4, z: 8.1, radius: 2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -112.1, z: 13.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -112.1, z: 13.8, radius: 3.2, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -112.1, z: 19.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -102.3, z: 17.9, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -91, z: 18.9, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -78.7, z: 17.4, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -78.7, z: 17.4, radius: 6.8, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -66.2, z: 18.4, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -66.2, z: 18.4, radius: 6.8, count: 3, scale: [0.8, 1.4] },
  { prop: "buttressLog", x: -66.2, z: 18.4, radius: 6.8, count: 1, scale: [0.85, 1.2], blocking: true, clearance: 1.6 },
  { prop: "jungleTree", x: -57.2, z: 20.9, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -57.2, z: 20.9, radius: 3.2, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 46.3, z: 21.2, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 53.1, z: 18.5, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 65.2, z: 18.2, radius: 6.8, count: 2, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 65.2, z: 18.2, radius: 6.8, count: 3, scale: [0.8, 1.4] },
  { prop: "fernClump", x: 74.4, z: 19.8, radius: 3.2, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 92, z: 15.3, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 92, z: 15.3, radius: 3.2, count: 1, scale: [0.8, 1.4] },
  { prop: "fernClump", x: 86, z: 21.3, radius: 3.2, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 102.2, z: 18.8, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 102.2, z: 18.8, radius: 6.8, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 112.1, z: 16.4, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 112.1, z: 22.4, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -112, z: 27.9, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -112, z: 33.9, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -88, z: 34, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -88, z: 34, radius: 3.2, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -77.2, z: 30.9, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -65.3, z: 30.5, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -53.4, z: 31, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "buttressLog", x: -53.4, z: 31, radius: 6.8, count: 1, scale: [0.85, 1.2], blocking: true, clearance: 1.6 },
  { prop: "jungleTree", x: -41.5, z: 30.7, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -41.5, z: 30.7, radius: 6.8, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -33.9, z: 32.3, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -33.9, z: 32.3, radius: 3.2, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 33.9, z: 32.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 42.1, z: 29.9, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 55.2, z: 28.5, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 55.2, z: 28.5, radius: 6.8, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 65.9, z: 30.4, radius: 6.8, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 65.9, z: 30.4, radius: 6.8, count: 3, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 77, z: 30.8, radius: 6.8, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 91.5, z: 29.9, radius: 6.8, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 100.7, z: 29.9, radius: 6.8, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 100.7, z: 29.9, radius: 6.8, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 116.4, z: 26.5, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 116.4, z: 26.5, radius: 3.2, count: 1, scale: [0.8, 1.4] },
  { prop: "fernClump", x: 110.4, z: 32.5, radius: 3.2, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 116.4, z: 32.5, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -111.2, z: 38.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -117.2, z: 44.8, radius: 2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -111.2, z: 44.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -87.8, z: 39.4, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -87.8, z: 39.4, radius: 3.2, count: 3, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -87.8, z: 45.4, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -76.5, z: 41, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -64.9, z: 43, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -64.9, z: 43, radius: 6.8, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -54.3, z: 43, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -40.7, z: 41.5, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -40.7, z: 41.5, radius: 6.8, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -29.4, z: 43.1, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -19.7, z: 39.1, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -19.7, z: 39.1, radius: 3.2, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -19.7, z: 45.1, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 32.8, z: 39.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 32.8, z: 39.8, radius: 3.2, count: 3, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 32.8, z: 45.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 32.8, z: 45.8, radius: 3.2, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 42.5, z: 40.8, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "buttressLog", x: 42.5, z: 40.8, radius: 6.8, count: 1, scale: [0.85, 1.2], blocking: true, clearance: 1.6 },
  { prop: "jungleTree", x: 53.4, z: 41.3, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 66.7, z: 41.2, radius: 6.8, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 78.1, z: 41.2, radius: 6.8, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 91.4, z: 42.7, radius: 6.8, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 102.6, z: 41.2, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 112.2, z: 39.9, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 112.2, z: 45.9, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 112.2, z: 45.9, radius: 3.2, count: 3, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -112.3, z: 52.5, radius: 3.2, count: 2, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -112.3, z: 58.5, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -87.7, z: 51.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -93.7, z: 57.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -93.7, z: 57.8, radius: 3.2, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -87.7, z: 57.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -77.5, z: 53.8, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -69.9, z: 50.3, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -63.9, z: 50.3, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -63.9, z: 50.3, radius: 3.2, count: 3, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -69.9, z: 56.3, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -51.6, z: 52.2, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -51.6, z: 58.2, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -51.6, z: 58.2, radius: 3.2, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -43.5, z: 53.4, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -30, z: 55.1, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -20.4, z: 49.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -14.4, z: 49.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -20.4, z: 55.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 28.2, z: 50.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 34.2, z: 50.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 28.2, z: 56.8, radius: 2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 34.2, z: 56.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 34.2, z: 56.8, radius: 3.2, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 40.8, z: 54.3, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 52.6, z: 54.2, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 99.9, z: 51.5, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 105.9, z: 51.5, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 105.9, z: 51.5, radius: 3.2, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 99.9, z: 57.5, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 105.9, z: 57.5, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 105.9, z: 57.5, radius: 3.2, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 112.4, z: 49.5, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 112.4, z: 55.5, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -112.6, z: 67.3, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -112.6, z: 67.3, radius: 6.8, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -100.8, z: 66.3, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -90.9, z: 65, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -78.9, z: 65.3, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -69.3, z: 62.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -69.3, z: 68.8, radius: 2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -50.5, z: 63.2, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -50.5, z: 63.2, radius: 3.2, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -42.7, z: 64.7, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -30.5, z: 65, radius: 6.8, count: 3, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -20.1, z: 63.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -20.1, z: 69.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 42.4, z: 65.6, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 54.1, z: 65.6, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 67.4, z: 67.3, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 74.9, z: 64.1, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 80.9, z: 64.1, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 80.9, z: 64.1, radius: 3.2, count: 3, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 74.9, z: 70.1, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 74.9, z: 70.1, radius: 3.2, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 80.9, z: 70.1, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 88.5, z: 68.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 94.5, z: 68.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 98, z: 64.2, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 104, z: 64.2, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 98, z: 70.2, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 104, z: 70.2, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 104, z: 70.2, radius: 3.2, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 110.2, z: 61.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 116.2, z: 61.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 110.2, z: 67.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 116.2, z: 67.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -111.6, z: 75.4, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -117.6, z: 81.4, radius: 2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -111.6, z: 81.4, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -111.6, z: 81.4, radius: 3.2, count: 3, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -103.3, z: 77.2, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -90.3, z: 78.5, radius: 6.8, count: 3, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -90.3, z: 78.5, radius: 6.8, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -78.6, z: 78.3, radius: 6.8, count: 3, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -40.9, z: 77.7, radius: 6.8, count: 3, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -40.9, z: 77.7, radius: 6.8, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -31.3, z: 78.3, radius: 6.8, count: 3, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -19.9, z: 76.2, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -19.9, z: 76.2, radius: 3.2, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -13.9, z: 82.2, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -9.6, z: 81.2, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -9.6, z: 81.2, radius: 3.2, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -3.6, z: 81.2, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -3.6, z: 81.2, radius: 3.2, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 1.9, z: 79.6, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 1.9, z: 79.6, radius: 3.2, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 7.9, z: 79.6, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 44, z: 75.2, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 44, z: 75.2, radius: 3.2, count: 3, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 44, z: 81.2, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 52.8, z: 79.4, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 52.8, z: 79.4, radius: 6.8, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 65.9, z: 77, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 65.9, z: 77, radius: 6.8, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 77.4, z: 79.4, radius: 6.8, count: 3, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 91.3, z: 78.2, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 101.4, z: 79.3, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 110.7, z: 75.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 110.7, z: 75.8, radius: 3.2, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 116.7, z: 75.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 116.7, z: 75.8, radius: 3.2, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 110.7, z: 81.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 116.7, z: 81.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 116.7, z: 81.8, radius: 3.2, count: 3, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -117.1, z: 87.8, radius: 2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -117.1, z: 93.8, radius: 2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -81.8, z: 86.7, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -75.8, z: 86.7, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -75.8, z: 86.7, radius: 3.2, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -81.8, z: 92.7, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -75.8, z: 92.7, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -67.6, z: 86.9, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -61.6, z: 86.9, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -67.6, z: 92.9, radius: 2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -61.6, z: 92.9, radius: 2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -56.4, z: 86.1, radius: 3.2, count: 3, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -56.4, z: 92.1, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -50.4, z: 92.1, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -50.4, z: 92.1, radius: 3.2, count: 3, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -44.1, z: 86.9, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -38.1, z: 86.9, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -38.1, z: 92.9, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -31, z: 90.6, radius: 6.8, count: 3, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -16.7, z: 91, radius: 6.8, count: 3, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -4.6, z: 91.3, radius: 6.8, count: 3, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 7.1, z: 89.2, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 15.6, z: 87.4, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 15.6, z: 93.4, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 43.9, z: 87.3, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 43.9, z: 87.3, radius: 3.2, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 53.5, z: 90.2, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 65.1, z: 89, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 76.5, z: 89.3, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 91, z: 89.8, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "buttressLog", x: 91, z: 89.8, radius: 6.8, count: 1, scale: [0.85, 1.2], blocking: true, clearance: 1.6 },
  { prop: "jungleTree", x: 100.8, z: 88.7, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 100.8, z: 88.7, radius: 6.8, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 111.8, z: 87.2, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 111.8, z: 93.2, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 117.8, z: 93.2, radius: 2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -27.7, z: 105.3, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -16.9, z: 101.1, radius: 6.8, count: 3, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -16.9, z: 101.1, radius: 6.8, count: 2, scale: [0.8, 1.4] },
  { prop: "buttressLog", x: -16.9, z: 101.1, radius: 6.8, count: 1, scale: [0.85, 1.2], blocking: true, clearance: 1.6 },
  { prop: "jungleTree", x: -5.3, z: 102.2, radius: 6.8, count: 2, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 5.5, z: 102.4, radius: 6.8, count: 2, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 5.5, z: 102.4, radius: 6.8, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 14.4, z: 98.4, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 14.4, z: 98.4, radius: 3.2, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 54, z: 101.3, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 54, z: 101.3, radius: 6.8, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 66.2, z: 102.7, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "buttressLog", x: 66.2, z: 102.7, radius: 6.8, count: 1, scale: [0.85, 1.2], blocking: true, clearance: 1.6 },
  { prop: "jungleTree", x: 77.7, z: 102.5, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 89.5, z: 103.5, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 89.5, z: 103.5, radius: 6.8, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 101.7, z: 100.6, radius: 6.8, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 101.7, z: 100.6, radius: 6.8, count: 3, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 112.9, z: 101.5, radius: 6.8, count: 5, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -111.2, z: 112.2, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -98, z: 111.8, radius: 3.2, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -92.1, z: 110.3, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -86.1, z: 110.3, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -92.1, z: 116.3, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -86.1, z: 116.3, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -39.5, z: 117.7, radius: 2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -20.9, z: 110.3, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: -20.9, z: 110.3, radius: 3.2, count: 3, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: -14.9, z: 110.3, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -20.9, z: 116.3, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -14.9, z: 116.3, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -4, z: 111.7, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: -4, z: 117.7, radius: 2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 8.3, z: 110.6, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 2.3, z: 116.6, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 8.3, z: 116.6, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 16.1, z: 110, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 16.1, z: 116, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 50.1, z: 111.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 56.1, z: 111.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 62.2, z: 110.2, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 62.2, z: 110.2, radius: 3.2, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 68.2, z: 110.2, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 62.2, z: 116.2, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 68.2, z: 116.2, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 73.7, z: 111.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 73.7, z: 111.8, radius: 3.2, count: 3, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 79.7, z: 111.8, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 79.7, z: 111.8, radius: 3.2, count: 1, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 85.6, z: 111.6, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 85.6, z: 111.6, radius: 3.2, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 91.6, z: 111.6, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 85.6, z: 117.6, radius: 2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 98.2, z: 111.9, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 104.2, z: 111.9, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "fernClump", x: 104.2, z: 111.9, radius: 3.2, count: 2, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 104.2, z: 117.9, radius: 2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 111.1, z: 110.9, radius: 3.2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 117.1, z: 110.9, radius: 2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  { prop: "jungleTree", x: 117.1, z: 116.9, radius: 2, count: 1, scale: [0.85, 1.3], blocking: true, clearance: 0.95 },
  // ===== the banks =================================================================
  // Bamboo along the river where the light comes down it, and ferns on the
  // banks — non-blocking both, so a bank is concealment and never a wall.
  { prop: "bamboo", x: -25.5, z: 6.5, radius: 3, count: 1, scale: [0.8, 1.2] },

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
  { id: "A", name: "The Stilt Village", pos: new Vector3(-60, 0.55, 76), radius: 14 },
  { id: "B", name: "The Ferry", pos: new Vector3(-97, 0.3, -28), radius: 13 },
  { id: "C", name: "The Manor", pos: new Vector3(0, 0.8, -4), radius: 14, poleLift: 6 },
  { id: "D", name: "The Temple", pos: new Vector3(80, 4.1, 34), radius: 13 },
  { id: "E", name: "The Camp", pos: new Vector3(40, 0.25, -84), radius: 12 },
];

/**
 * Home spawns are uncapturable, and deploy in the lee of their outpost's
 * sandbags. Every control point also carries a spawn just outside its capture
 * zone, so deploying onto a flag you hold does not drop you on top of whoever
 * is contesting it.
 */
const spawns: SpawnPointDef[] = [
  { team: 0, pos: new Vector3(-100, 1.77, 96), yaw: Math.PI },
  { team: 0, pos: new Vector3(-94, 1.2, 96), yaw: Math.PI },
  { team: 0, pos: new Vector3(-106, 2, 96), yaw: Math.PI },
  { team: 1, pos: new Vector3(100, 1.5, -96), yaw: 0 },
  { team: 1, pos: new Vector3(106, 1.5, -96), yaw: 0 },
  { team: 1, pos: new Vector3(94, 1.5, -96), yaw: 0 },
  { team: null, controlPoint: "A", pos: new Vector3(-60, 0.55, 60), yaw: Math.PI },
  { team: null, controlPoint: "B", pos: new Vector3(-84, 0.02, -22), yaw: Math.PI / 2 },
  { team: null, controlPoint: "C", pos: new Vector3(-8, 0.8, -27), yaw: 0 },
  { team: null, controlPoint: "D", pos: new Vector3(80, 2.07, 12.5), yaw: 0 },
  { team: null, controlPoint: "E", pos: new Vector3(26, 0.25, -72), yaw: Math.PI / 2 },
];

/**
 * Standing water. Ankle-deep to knee-deep over the bed beneath it, so bots and
 * the player wade across — no swimming, and the nav grid never hears about it.
 *
 * **ONE rect, and it is the whole FLOOR rather than the whole valley** — 600 m
 * on a side, which is `size` plus twice the `borderland`'s margin, so the water
 * stops exactly where the ground does. A rect is an EXTENT and not a shore:
 * the bed decides what is wet. The generator holds dry ground at -0.15 or over
 * everywhere but the three arms, the basin and the lagoon, and checks it.
 *
 * **What it buys is that the river LEAVES.** The Y has three mouths in the
 * boundary — the north arm through the north edge at x 27..42, the west arm
 * through the west edge at z -93..-78 and the east arm through the east edge at
 * z -45..-33 — and `TerrainField` clamps its edge row outward, so the trench
 * runs on out on all three bearings with the water in it.
 *
 * **It stays ONE rect for the reason Hollowmere's bog does, three times
 * over.** A seam between two rects is where the MIRROR changes — each carries
 * its own cube probe, stood at the depth-weighted centroid of its own wet cells
 * — and each arm out in the borderland would have to be seamed to the valley's
 * water straight across the bearing a player looks down as they leave.
 *
 * **What it costs is bed-map resolution, and that was measured**: the bed is
 * `CONFIG.water.depthTexelsMax` (512) texels a side however large the rect, so
 * 600 m is a 1.17 m texel. The waterline's POSITION is not in the bed map at
 * all — it is where the terrain MESH crosses the plane, exact at any texel —
 * and the depth the shader reads is smooth over a bank graded at 0.2, so the
 * resampling error came to about a centimetre mean on depths of sixty.
 *
 * **Its probe stands over the confluence** — the depth-weighted centroid of the
 * wet cells is pulled there by the three arms and the basin, which is open
 * water and open sky. It was once inside the manor's great hall, a probe baked
 * from inside a building, which is Cinderhaven's failure: a river mirroring a
 * dark interior returns the same value whichever way a ripple turns.
 *
 * It RUNS, so it says so (`WaterRect.sound`): the river is heard from its
 * nearest bank, which is how a player in the forest knows which way it lies.
 */
const water: WaterRect[] = [
  { x: 0, z: 0, width: 600, depth: 600, y: -0.52, sound: "stream" },
];

/**
 * Ground cover, and the thing about it that inverts under a canopy: a closed
 * canopy is the reason the forest floor is bare. Under 90% closure almost no
 * light reaches the ground, and what grows there is litter, roots and the odd
 * fern; the deep undergrowth of a jungle is at the EDGES, in the gaps and along
 * the water, which is exactly where the light is. So the whole valley gets a
 * thin field and the clearings, the banks and the reed beds get a rich one.
 *
 * `density` is how LUSH, 0..1 of the quality rung's field, and never a count:
 * the field is drawn around the eye, so a rect's area costs nothing. **Overlap
 * is a density control** — two rects over one patch grow both their fields.
 * Roads and colliders clear themselves (the grass mask refuses a carriageway
 * and a collider's footprint both), and a rect over a channel is a REED BED:
 * ground under a water rect's surface grows a share of the rect's density,
 * taller so it breaks the waterline, and lays no turf.
 */
const grass: GrassRect[] = [
  // THE FOREST FLOOR — under a closed canopy almost no light reaches the ground, so it is litter, root and the odd fern. The whole valley gets a thin field; the gaps get more.
  { x: 0, z: -90, width: 240, depth: 60, density: 0.3, height: 0.7 },
  { x: 0, z: 0, width: 240, depth: 120, density: 0.3, height: 0.7 },
  { x: 0, z: 90, width: 240, depth: 60, density: 0.3, height: 0.7 },
  // The manor's garden, nobody has cut it in a decade; the north lawn down to the marsh.
  { x: 0, z: -38, width: 50, depth: 26, density: 0.9, height: 1.2 },
  { x: 0, z: 12, width: 40, depth: 14, density: 0.8, height: 1.15 },
  // The ferry's bank: knee-high grass is concealment without cover, which is what the most exposed flag can be given without changing what it is.
  { x: -97, z: -28, width: 40, depth: 44, height: 1.2 },
  // The stilt village's clearing, and the lagoon's reeds behind it.
  { x: -60, z: 72, width: 54, depth: 20, density: 0.9, height: 1.1 },
  { x: -60, z: 106, width: 50, depth: 16, density: 0.9, height: 1.2 },
  // The temple's summit — open sky, so a real field.
  { x: 80, z: 34, width: 44, depth: 44, density: 0.8 },
  // The Landing.
  { x: -2, z: 66, width: 30, depth: 20, density: 0.7 },
  // The old city's courts.
  { x: -44, z: -82, width: 44, depth: 34, density: 0.7, height: 0.9 },
  // The marsh bar and the basin's reeds.
  { x: 7, z: 37, width: 30, depth: 36, density: 0.9, height: 1.2 },
  // The banks: reeds in the water and the richest ground on the map beside it, because a river is a hole in the canopy.
  { x: -60, z: -10, width: 40, depth: 50, density: 0.8, height: 1.2 },
  { x: 66, z: -30, width: 44, depth: 24, density: 0.8, height: 1.2 },
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
   * green line drawn round the world. So the edge has to be `fogEnd` from the
   * furthest an EYE gets: the play edge plus the leash's 69 m is 147, the death
   * cam's own orbit stands 3.4 m further out and a blast can throw that body
   * further still, and 180 is that rounded up. It is the same 180 Hollowmere
   * buys for the same `fogEnd`: what a margin has to beat is the FOG and
   * nothing about the map.
   *
   * **`roll` is 1.2, and it is the one number on this map the RIVER sets.**
   * Everywhere else a borderland's swell is chosen for shape; here it is
   * bounded. `TerrainField` continues the floor by clamping its edge row
   * outward, so the Y's three mouths extrude straight out of the map as
   * channels of their own cross-section — and then `borderRoll` is ADDED on
   * top, swinging ±roll/2. Each mouth's bed sits 0.82 m under the water plane
   * (the generator cuts all three to -1.34 against a surface at -0.52); at the
   * default 2.6 the roll lifts a bed 1.3 and the river runs dry inside the
   * readable band, and at 1.2 the worst place on the worst arm still holds
   * 0.22 m — a riffle, not a gravel bar. The valley's relief is all inside the
   * square, and what closes this horizon was never going to be a swell: it is
   * the canopy.
   *
   * **`ease` is stated at 30 for Hollowmere's reason.** A third of 180 is 60,
   * inside the leash's 69 — but on a map whose FOG is nearer than its leash the
   * borderland anybody ever sees is 78 m deep, so a 60 m ramp spends four
   * fifths of it flattening the swell into a radial smear of the map's own
   * edge. The number to beat is whichever of the leash and `fogEnd` is
   * SHORTER. The steepest gradient the roll can then add is
   * `(roll / 2) * (0.026 + 1.5 / ease)` = 0.046, against a
   * `MAX_WALKABLE_GRADE` of 0.4: a player being run out of the map is never
   * stopped by the ground on the way.
   *
   * **What stands out there is the forest, and it does not stop at the
   * square** — the scatter array's last block is that country and carries the
   * argument in full, including why it gives up the bare collar and what it
   * spends instead.
   */
  borderland: { margin: 180, roll: 1.2, ease: 30 },
  /**
   * **No rim at all.** The valley ends in more valley, and what closes the
   * horizon is the fog rather than a landform. `Ridge.ts` states the one
   * condition on taking `form: "none"`: a map may only draw nothing over its
   * own boundary if it has already laid something out there that reaches past
   * `fogEnd` on every bearing, because the sky dome is flat `fogColor` below
   * the horizon. This map pays it with the 180 m above, so the two fields are
   * one decision, and shrinking that margin without putting a landform back is
   * the thing not to do here. A crag ringing a jungle valley was the one
   * landform a drowned tropical basin has no business having, and it cut the
   * three river mouths off dead at the boundary.
   *
   * `EnvironmentSpec.ridgeColor` and `ridgeScreeColor` are still set and are
   * read by nothing on this map; they stay because they are required fields.
   */
  ridge: {
    form: "none",
  },
  // Fixed so the dressing — and the colliders blocking scatter emits, and so
  // the nav graph — is identical on every boot. Changing it rerolls the whole
  // scatter field, which is a visible change to the level: re-walk the flags.
  seed: 0x484c,
};
