/**
 * sarab/layout.ts — THE MAP, as data: structure placements, scatter regions,
 * control points, spawns, the hardstandings, the scrub and the four bodies of
 * water. Every number in `water` is MEASURED off the floor by the generator
 * rather than authored — see `waterBody` in scripts/generate-sarab.mjs, and
 * do not hand-tune a surface height here.
 * The floor's shape is generated data and lives in heights.ts. Consumed by
 * MapBuilder; nothing here is code to special-case.
 * Gotchas that have already cost time: collider top faces within
 * CONFIG.nav.stepHeight of adjacent ground or bots treat decks as walls; a
 * control point's pos must NOT sit inside a PLACEMENT's collider (surfaceAt
 * returns -1 — scatter is held off flags and spawns by `MapBuilder.keepClear`,
 * placements are not); a road holds off only what GROWS, so a region of rubble
 * or cones may cross a carriageway and one of palms is thinned where it does
 * (`PropBody.rooted`, `world/roads.ts`) — the regions below still dodge the
 * roads by hand, which is what keeps a grove even rather than merely legal;
 * terrain steeper than a 0.4 gradient severs its own nav links.
 *
 * **SEEDED by `scripts/generate-sarab.mjs`, and owned by the editor after
 * that.** The design — the flags, the quarters, the street pitch, the recipe
 * every block is drawn from, every set piece — is authored in that script; this
 * file is the transcription, and it is the transcription that is the map. It is
 * a normal layout file in every way the rest of the tree cares about: flat
 * arrays of one-line entries, which is what `src/editor/sourceScan.ts`
 * requires, so F2 edits it and Ctrl+S patches it exactly as it patches
 * Harrowmead's. Re-running the generator discards those edits.
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
 * SARAB — a town in a desert basin, an hour before noon, some months into being
 * fought over.
 *
 * **900 x 900 m of PLAY inside 1500 x 1500 m of ground**, origin at the souk,
 * +Z north. By a wide margin the biggest map in the tree — 5.1 times
 * Harrowmead's playable area and 3.8 times its extent — and the first whose
 * boundary is not merely open but a HORIZON: the desert carries on for 300 m
 * past the play square and what stops you leaving is the leash, a countdown
 * rather than a face of rock.
 *
 * ```
 *                                    N
 *   +--------------------------------------------------------------+  z 450
 *   | ~ smallholdings ~      ~ the north town ~      x T1 HOME YARD |
 *   |                                                    (318,318)  |
 *   |  ---------------------- north street ----------------------   |  z 208
 *   |  [A] GREAT MOSQUE       the old town    [D] MARTYRS' QUARTER  |
 *   |     (-192,150)                              (250,140)  +7 m   |
 *   |  ~ mosque quarter ~      [C] SOUK        ~ the shelf ~        |
 *   |                           (28,66)                             |
 *   |  ----------------------- cross road -----------------------   |  z 30
 *   |  ~~~ ford ~~~~~~~~~ THE WADI ~~~~~~ ford ~~~~~~~~~~~~~~~~~~   |
 *   |  [B] FUEL DEPOT      ~ the south bank ~   [E] THE CROSSING    |
 *   |     (-120,-180)                              (190,-114)       |
 *   |  ----------------------- south road -----------------------   |  z -230
 *   |  x T0 HOME YARD                                               |
 *   |     (-318,-318)              x = -66            x = 190       |
 *   +--------------------------------------------------------------+  z -450
 * ```
 *
 * The two vertical rules are the ASPHALT: highways at x -66 and x 190, running
 * the whole length of the map and fording the wadi. The two outer dirt links at
 * x ±318 run out through the home yards and ford it as well, which is why there
 * are FOUR crossings on a map with no bridge.
 *
 * ## What the extent buys, and what it costs
 *
 * `MapLayout.size` is the PLAY square and `borderland.margin` is ground that
 * costs terrain and nothing else, so 900 m of play inside 1500 m of ground is
 * the split ENGINE_UPGRADE.md's S0 measured and chose: the nav grid, the flow
 * fields, the cover masks, the obstacle field and every structure are priced on
 * the square, and the margin is what makes the edge of the world a horizon.
 *
 * **It is also the first map in the tree that can be fogged.** Coldharbour and
 * Harrowmead both state a `fogEnd` past their own diagonal, so nothing on
 * either is ever culled by distance; 900 m of play has a 1,273 m diagonal and a
 * 560 m haze sits well inside it, which is what finally gives `WorldCulling`'s
 * block half something to cull. See environment.ts, which carries that
 * argument, and S8, which is the brief this map was laid out against.
 *
 * ## The ground, which is what makes 900 m readable
 *
 * Three features and nothing else. **The WADI** runs east to west across the
 * south, a dry bed 5.4 m down and 52 m across with banks over 40 m either side
 * — a 0.135 gradient, so it is waded and driven at every point along it and the
 * four fords are landmarks rather than the only ways over. It is what separates
 * the two southern flags from the three northern ones without walling them off,
 * and it runs DRY except in the three basins deep enough to have kept
 * something: standing pools between the fords, ~2.1 m at the middle of each,
 * which is water you wade round rather than through.
 * **The two banks are not the same height.** The southern one climbs 2.8 m out
 * of the bed and the northern 5.4, because the whole southern group — the south
 * bank, the Crossing and T0's yard — sits on a terrace 2.6 m below the town.
 * From the Souk's roofs you look DOWN at the Depot; from the Depot the old town
 * is a skyline.
 * **The SHELF** stands 7 m over the town in the north-east and the Martyrs'
 * Quarter is on it — a 0.082 gradient up an 85 m skirt, which is a slope you
 * climb without noticing and a quarter that looks down every street in the old
 * town. **Everything else is dunes**, flattened dead level under each quarter
 * because a placement samples the ground once at its own centre and a building
 * on a grade floats at one corner. It is TWO scales and the second is the one
 * a body on the ground can see: 5 m of long swell at 150 to 1,200 m, read from
 * a roof and from the air, and 0.85 m of wind DRIFT at 79 and 132 m, which is
 * the band the eye actually reaches across — without it a two-hundred-metre
 * walk between quarters crossed no feature at all and the sand read as a
 * table. Both are aligned to one prevailing wind. Then three knolls in the
 * only three places with room for one, and the BIRKAT: a 2.7 m basin dug into
 * the mosque quarter, which is the only ground in the town that is down and
 * the only water in it.
 *
 * ## Design intent per flag
 *
 * - **A The Great Mosque** — a walled precinct with the hall on one side and
 *   the minaret on the corner. The flag is in the open court, overlooked from
 *   every roof around it: a flag you can hold and cannot hide on. The minaret
 *   is the map's landmark and is deliberately NOT climbable.
 * - **B The Fuel Depot** — the one industrial site and the only flag with no
 *   roofs over it. Tanks, silos, two warehouses and T-walls on the wadi's south
 *   bank. It plays flat and long where the other four play vertical.
 * - **C The Souk** — the middle of the map in every sense: two arcades facing
 *   each other across the market square, both of them climbed, with the
 *   monument between. Every other flag is 200 to 290 m away, which is the
 *   whole of why it is where it is.
 * - **D The Martyrs' Quarter** — four shelled apartment blocks on the shelf,
 *   three walked floors each, and the only real interiors on the map. Holding
 *   it means being seen from four hundred metres of open approach.
 * - **E The Crossing** — the checkpoint on the east highway, on the flat twenty
 *   metres south of the wadi's bank. T-walls either side of the carriageway
 *   with the gap AT the road, sandbags in the gap, the pump compound behind.
 *   The narrowest flag here — a fight for fourteen metres of asphalt — and the
 *   only one a hull can sit outside and shell without ever entering.
 *
 * ## Layout hygiene (keep to these when editing)
 *
 * - Structures are axis-aligned (`rotY` in multiples of π/2). Organic tilt
 *   belongs to scatter props, not buildings.
 * - A house with `rampSide` has a stair and a WALKED roof; one without has a
 *   roof that stops rounds and nothing can stand on. The builder throws in a
 *   DEV build below 13 m of depth — see kit/desert.ts, whose header owns the
 *   stair lane every climbed building here is built around.
 * - Compound walls are authored in runs with GAPS. A sealed compound is a wall
 *   the nav grid routes bots the whole way around.
 * - No lamps: the sun is nearly overhead, and a carried flame would spend one
 *   of the sixteen light slots proving nothing. Harrowmead's rule and Greyfen's
 *   before it.
 * - Scatter regions dodge every road by hand — the roads are the first entries
 *   in `placements` and their extents are what the generator claimed. The
 *   builder refuses a ROOTED prop on a carriageway on its own now, so a region
 *   that strays is thinned rather than left growing out of the asphalt; the
 *   hand-dodging is what keeps a grove EVEN, and is still worth doing.
 * - The ORDER of the scatter array is load-bearing: every region draws from one
 *   seeded stream, so a region added anywhere but the end re-rolls every field
 *   below it.
 *
 * 738 placements, 216 scatter regions.
 */

const placements: Placement[] = [
  // ===== roads =====================================================================
  // Visual only: a road carries no collider, stops no round and is in no
  // baked structure. The one thing it rejects is something ROOTED sown on
  // top of it (see `world/roads.ts`), and every quarter and every scatter
  // region below was generated against the rectangles these claim anyway.
  // The two asphalt routes are the town's spine and the rest are graded
  // dirt.
  //
  // ALL FOUR N-S routes FORD the wadi, and that is the map's answer to a
  // watercourse across the middle of it: the bed is 3.6 m down over a 26 m
  // bank, a 0.14 gradient, so a hull takes any of them at speed and the
  // crossings are landmarks rather than the only ways over. A bridge would
  // have made four chokepoints out of a feature whose whole job is to be
  // crossable everywhere and unpleasant to be caught in.
  { kind: "road", x: -66, z: 0, params: { length: 860, width: 14, surface: "asphalt" } },
  { kind: "road", x: 190, z: 0, params: { length: 860, width: 14, surface: "asphalt" } },
  { kind: "road", x: 0, z: 30, rotY: Math.PI / 2, params: { length: 860, width: 12, surface: "asphalt" } },
  { kind: "road", x: 0, z: 208, rotY: Math.PI / 2, params: { length: 860, width: 8, surface: "dirt" } },
  { kind: "road", x: 0, z: -230, rotY: Math.PI / 2, params: { length: 860, width: 8, surface: "dirt" } },
  { kind: "road", x: -318, z: -50, params: { length: 700, width: 7, surface: "dirt" } },
  { kind: "road", x: 318, z: 50, params: { length: 700, width: 7, surface: "dirt" } },
  // ===== A - the Great Mosque ======================================================
  // The haram: a walled precinct with the prayer hall along its west side and
  // the minaret on the south-west corner. The flag stands in the open court,
  // which is the only large flat ground in the quarter and is overlooked from
  // every roof around it — a flag you can hold and cannot hide on. The
  // minaret is the map's landmark and is deliberately not climbable; see
  // kit/desert.ts.
  { kind: "mosque", x: -232, z: 150, rotY: Math.PI / 2, params: { width: 26, depth: 20, height: 7.4 } },
  { kind: "minaret", x: -232, z: 104, params: { height: 27 } },
  { kind: "compoundWall", x: -155.63, z: 100, params: { length: 55.25, height: 3, tint: "#b6a68f" } },
  { kind: "compoundWall", x: -216.38, z: 200, params: { length: 55.25, height: 3, tint: "#b6a68f" } },
  { kind: "compoundWall", x: -155.63, z: 200, params: { length: 55.25, height: 3, tint: "#b6a68f" } },
  { kind: "well", x: -166, z: 166 },
  { kind: "shrine", x: -162, z: 128 },
  { kind: "stall", x: -166.81, z: 118.1 },
  { kind: "stall", x: -170.72, z: 175.74, rotY: Math.PI },
  { kind: "stall", x: -158.01, z: 143.01, rotY: Math.PI / 2 },
  { kind: "stall", x: -164.48, z: 159.05, rotY: Math.PI },
  { kind: "stall", x: -182.66, z: 184.24 },
  { kind: "stall", x: -167.02, z: 131.33 },
  { kind: "stall", x: -146.39, z: 155.93, rotY: Math.PI },
  { kind: "planter", x: -171.63, z: 115.85 },
  { kind: "planter", x: -152.84, z: 169.68, rotY: Math.PI / 2 },
  { kind: "planter", x: -176.54, z: 147.99, rotY: Math.PI / 2 },
  { kind: "crates", x: -158, z: 184 },
  { kind: "car", x: -152, z: 116, rotY: Math.PI / 2, params: { tint: "#5d4a3a" } },
  { kind: "compoundWall", x: -210.38, z: 226, params: { length: 43.25, height: 1.9 } },
  { kind: "compoundWall", x: -161.63, z: 226, params: { length: 43.25, height: 1.9 } },
  { kind: "compoundWall", x: -140, z: 263.38, rotY: Math.PI / 2, params: { length: 21.25, height: 1.9 } },
  { kind: "compoundWall", x: -232, z: 263.38, rotY: Math.PI / 2, params: { length: 21.25, height: 1.9 } },
  // ===== the birkat - the quarter's reservoir, and its hammam ======================
  // The one open space in the oldest quarter on the map, and the only ground
  // in the town that is DOWN. The basin itself is terrain (see the
  // generator's `BIRKAT`) — water in this engine is a hole in the floor with
  // a plane over it — so what is placed here is only what stands on the lip:
  // the precinct wall along the north, the draw-well that feeds it, the
  // stalls a watering place grows, and the bathhouse on its east side, which
  // is the one building in the town that puts its plumbing where you can see
  // it.
  //
  // Nothing stands INSIDE the claimed rectangle and nothing may be added
  // there: it is the skirt as well as the water, and a placement samples the
  // floor once at its own centre.
  { kind: "compoundWall", x: -202.38, z: 42, params: { length: 27.25, height: 3, tint: "#b6a68f" } },
  { kind: "compoundWall", x: -169.63, z: 42, params: { length: 27.25, height: 3, tint: "#b6a68f" } },
  { kind: "compoundWall", x: -156, z: 85.38, rotY: Math.PI / 2, params: { length: 25.25, height: 3, tint: "#b6a68f" } },
  { kind: "compoundWall", x: -216, z: 85.38, rotY: Math.PI / 2, params: { length: 25.25, height: 3, tint: "#b6a68f" } },
  { kind: "well", x: -221, z: 76 },
  { kind: "shrine", x: -222, z: 52 },
  { kind: "stall", x: -207.64, z: 104, rotY: Math.PI },
  { kind: "stall", x: -159.63, z: 104, rotY: -Math.PI / 2 },
  { kind: "hammam", x: -143, z: 74, params: { width: 18, depth: 14, rampSide: -1 } },
  { kind: "granary", x: -145, z: 44, rotY: Math.PI / 2, params: { height: 5.4 } },
  // ===== the mosque quarter ========================================================
  // The oldest fabric on the map: narrow plots on a 32 m pitch, walls
  // everywhere, and almost nothing you can see over. A squad crossing it on
  // the ground is blind; a squad crossing it on the roofs is not.
  { kind: "adobeHouse", x: -262.88, z: 74.73, params: { width: 12, depth: 9, floors: 2, ruined: true } },
  { kind: "compoundWall", x: -271.38, z: 62, params: { length: 9.25 } },
  { kind: "compoundWall", x: -256.63, z: 62, params: { length: 9.25 } },
  { kind: "compoundWall", x: -271.38, z: 86, params: { length: 9.25 } },
  { kind: "compoundWall", x: -256.63, z: 86, params: { length: 9.25 } },
  { kind: "compoundWall", x: -156, z: 66.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "windTower", x: -104, z: 74, params: { width: 14, depth: 14, floors: 1, enterable: true, rampSide: 1, height: 5.58 } },
  { kind: "adobeHouse", x: -264, z: 99.5, params: { width: 17, depth: 9, enterable: true } },
  { kind: "adobeHouse", x: -264, z: 112.5, params: { width: 17, depth: 9, floors: 2, enterable: true } },
  { kind: "compoundWall", x: -220, z: 98.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -220, z: 113.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -239.38, z: 118, params: { length: 9.25 } },
  { kind: "compoundWall", x: -244, z: 98.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "adobeHouse", x: -206.5, z: 112.5, rotY: Math.PI, params: { width: 8, depth: 8, enterable: true, tint: "#7b6a51" } },
  { kind: "adobeHouse", x: -193.5, z: 112.5, params: { width: 9, depth: 9, floors: 2, enterable: true, tint: "#7b6a51" } },
  { kind: "compoundWall", x: -143.38, z: 94, params: { length: 9.25 } },
  { kind: "compoundWall", x: -128.63, z: 94, params: { length: 9.25 } },
  { kind: "compoundWall", x: -124, z: 113.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -148, z: 113.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "adobeHouse", x: -110.5, z: 99.5, params: { width: 9, depth: 9, enterable: true } },
  { kind: "adobeHouse", x: -110.5, z: 112.5, params: { width: 8, depth: 9, enterable: true } },
  { kind: "adobeHouse", x: -97.5, z: 99.5, rotY: Math.PI / 2, params: { width: 9, depth: 8 } },
  { kind: "adobeHouse", x: -97.5, z: 112.5, rotY: Math.PI, params: { width: 9, depth: 8, floors: 2, enterable: true, tint: "#6d5b41" } },
  { kind: "adobeHouse", x: -264, z: 130.5, params: { width: 17, depth: 11, floors: 2 } },
  { kind: "adobeHouse", x: -264, z: 145.5, params: { width: 17, depth: 11 } },
  { kind: "compoundWall", x: -207.38, z: 126, params: { length: 9.25 } },
  { kind: "compoundWall", x: -192.63, z: 126, params: { length: 9.25 } },
  { kind: "adobeHouse", x: -142.5, z: 131.5, rotY: Math.PI / 2, params: { width: 9, depth: 8, tint: "#6d5b41" } },
  { kind: "adobeHouse", x: -142.5, z: 144.5, rotY: Math.PI / 2, params: { width: 8, depth: 9, floors: 2, enterable: true, tint: "#b6a68f" } },
  { kind: "adobeHouse", x: -129.5, z: 131.5, rotY: Math.PI / 2, params: { width: 9, depth: 9, tint: "#b6a68f" } },
  { kind: "adobeHouse", x: -129.5, z: 144.5, rotY: Math.PI, params: { width: 8, depth: 9, floors: 2, enterable: true, tint: "#b6a68f" } },
  { kind: "compoundWall", x: -111.38, z: 126, params: { length: 9.25 } },
  { kind: "compoundWall", x: -96.63, z: 126, params: { length: 9.25 } },
  { kind: "compoundWall", x: -92, z: 145.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -111.38, z: 150, params: { length: 9.25 } },
  { kind: "crates", x: -99.04, z: 134.78, rotY: -Math.PI / 2 },
  { kind: "adobeHouse", x: -264, z: 162.5, params: { width: 20, depth: 11 } },
  { kind: "adobeHouse", x: -264, z: 177.5, params: { width: 20, depth: 11 } },
  { kind: "compoundWall", x: -188, z: 177.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -207.38, z: 182, params: { length: 9.25 } },
  { kind: "well", x: -200, z: 170 },
  { kind: "adobeHouse", x: -136, z: 170, rotY: Math.PI, params: { width: 19, depth: 18, floors: 2, enterable: true, rampSide: 1, tint: "#7b6a51" } },
  { kind: "windTower", x: -104, z: 170, rotY: Math.PI, params: { width: 20, depth: 15, floors: 2, enterable: true, rampSide: 1, height: 7.06 } },
  // ===== C - the Souk ==============================================================
  // The market square, and the centre of the map in every sense: four
  // quarters meet on it, both highways pass within seventy metres of it, and
  // every other flag is between 210 and 290 m away. Two arcades face each
  // other across the square with the monument to the north — both are
  // climbed, so the fight for the middle of this town is a fight for two
  // roofs and the ground between them.
  { kind: "souk", x: -4, z: 66, params: { length: 38, width: 11, rampSide: -1 } },
  { kind: "souk", x: 60, z: 70, rotY: Math.PI, params: { length: 34, width: 11, rampSide: 1 } },
  { kind: "monument", x: 28, z: 100, params: { width: 11 } },
  { kind: "well", x: 26, z: 46 },
  { kind: "stall", x: 49.75, z: 83.93, rotY: Math.PI / 2 },
  { kind: "stall", x: 40.24, z: 107.05 },
  { kind: "stall", x: 14, z: 92.09, rotY: Math.PI },
  { kind: "stall", x: 4.56, z: 90.04, rotY: -Math.PI / 2 },
  { kind: "stall", x: 2.96, z: 42.01, rotY: Math.PI },
  { kind: "stall", x: 52.88, z: 45.95 },
  { kind: "planter", x: 46.62, z: 79.22 },
  { kind: "planter", x: 36.01, z: 93.88 },
  { kind: "planter", x: 7.42, z: 66.83, rotY: Math.PI },
  { kind: "planter", x: 10.09, z: 52.05, rotY: Math.PI / 2 },
  { kind: "planter", x: 33.18, z: 48.19, rotY: -Math.PI / 2 },
  { kind: "crates", x: 24.55, z: 83.26 },
  { kind: "crates", x: -17.04, z: 92.24, rotY: -Math.PI / 2 },
  { kind: "car", x: 9.65, z: 17.75, params: { tint: "#6b463a" } },
  { kind: "car", x: 20.04, z: 110.39, params: { tint: "#3f4b52" } },
  { kind: "barrier", x: 54, z: 112, params: { length: 6 } },
  { kind: "adobeHouse", x: -26, z: 118, rotY: Math.PI / 2, params: { width: 14, depth: 15, floors: 2, enterable: true, rampSide: 1, tint: "#b6a68f" } },
  { kind: "windTower", x: 82, z: 118, params: { width: 14, depth: 15, floors: 2, enterable: true, rampSide: 1, height: 7.4, tint: "#b6a68f" } },
  { kind: "hammam", x: -30, z: 48, params: { width: 18, depth: 14, rampSide: 1 } },
  // ===== the old town ==============================================================
  // 30 m plots on a 7 m alley, which is a street you cannot drive a hull down
  // and can barely turn one in. The quarter is deliberately the densest thing
  // on the map and deliberately the one place armour is useless.
  { kind: "adobeHouse", x: -35.79, z: 74.95, params: { width: 11, depth: 13, enterable: true, tint: "#b6a68f" } },
  { kind: "compoundWall", x: -22, z: 64.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -22, z: 79.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -41.38, z: 84, params: { length: 9.25 } },
  { kind: "compoundWall", x: -46, z: 64.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -14, z: 64.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -14, z: 79.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "adobeHouse", x: 87.5, z: 65.5, rotY: Math.PI / 2, params: { width: 9, depth: 9, floors: 2 } },
  { kind: "adobeHouse", x: 87.5, z: 78.5, params: { width: 9, depth: 9, tint: "#6d5b41" } },
  { kind: "adobeHouse", x: 100.5, z: 65.5, rotY: Math.PI, params: { width: 9, depth: 9, floors: 2 } },
  { kind: "adobeHouse", x: 100.5, z: 78.5, params: { width: 8, depth: 9, enterable: true, tint: "#6d5b41" } },
  { kind: "compoundWall", x: 138, z: 64.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 138, z: 79.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 118.63, z: 84, params: { length: 9.25 } },
  { kind: "compoundWall", x: 114, z: 64.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "well", x: 126, z: 72 },
  { kind: "adobeHouse", x: 151, z: 72, rotY: Math.PI / 2, params: { width: 17, depth: 10 } },
  { kind: "adobeHouse", x: 165, z: 72, rotY: Math.PI / 2, params: { width: 17, depth: 10, enterable: true, tint: "#b6a68f" } },
  { kind: "adobeHouse", x: -41.5, z: 104, rotY: Math.PI / 2, params: { width: 16, depth: 11, tint: "#6d5b41" } },
  { kind: "adobeHouse", x: -0.04, z: 105.75, params: { width: 12, depth: 12, ruined: true } },
  { kind: "compoundWall", x: -9.38, z: 92, params: { length: 9.25 } },
  { kind: "compoundWall", x: 10, z: 96.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 10, z: 111.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -9.38, z: 116, params: { length: 9.25 } },
  { kind: "compoundWall", x: 22.63, z: 92, params: { length: 9.25 } },
  { kind: "compoundWall", x: 37.38, z: 92, params: { length: 9.25 } },
  { kind: "compoundWall", x: 22.63, z: 116, params: { length: 9.25 } },
  { kind: "compoundWall", x: 37.38, z: 116, params: { length: 9.25 } },
  { kind: "compoundWall", x: 54.63, z: 92, params: { length: 9.25 } },
  { kind: "compoundWall", x: 69.38, z: 92, params: { length: 9.25 } },
  { kind: "compoundWall", x: 74, z: 111.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 54.63, z: 116, params: { length: 9.25 } },
  { kind: "adobeHouse", x: 101, z: 104, rotY: Math.PI / 2, params: { width: 19, depth: 10, tint: "#b6a68f" } },
  { kind: "adobeHouse", x: 119.5, z: 97.5, params: { width: 9, depth: 8, tint: "#6d5b41" } },
  { kind: "adobeHouse", x: 119.5, z: 110.5, params: { width: 9, depth: 9, enterable: true, tint: "#b6a68f" } },
  { kind: "adobeHouse", x: 132.5, z: 97.5, rotY: Math.PI / 2, params: { width: 9, depth: 8 } },
  { kind: "adobeHouse", x: 132.5, z: 110.5, rotY: Math.PI / 2, params: { width: 9, depth: 9, tint: "#6d5b41" } },
  { kind: "adobeHouse", x: 151.5, z: 97.5, rotY: Math.PI, params: { width: 8, depth: 9, floors: 2, tint: "#7b6a51" } },
  { kind: "adobeHouse", x: 151.5, z: 110.5, rotY: Math.PI, params: { width: 8, depth: 9, floors: 2, tint: "#6d5b41" } },
  { kind: "adobeHouse", x: 164.5, z: 97.5, rotY: -Math.PI / 2, params: { width: 8, depth: 8, tint: "#b6a68f" } },
  { kind: "adobeHouse", x: 164.5, z: 110.5, rotY: Math.PI / 2, params: { width: 9, depth: 9 } },
  { kind: "adobeHouse", x: -34, z: 136, rotY: -Math.PI / 2, params: { width: 18, depth: 14, enterable: true, rampSide: 1, tint: "#7b6a51" } },
  { kind: "adobeHouse", x: -8.5, z: 129.5, rotY: -Math.PI / 2, params: { width: 9, depth: 9, tint: "#b6a68f" } },
  { kind: "adobeHouse", x: -8.5, z: 142.5, rotY: Math.PI, params: { width: 8, depth: 8, floors: 2, enterable: true, tint: "#b6a68f" } },
  { kind: "adobeHouse", x: 4.5, z: 129.5, rotY: Math.PI / 2, params: { width: 8, depth: 9, tint: "#7b6a51" } },
  { kind: "adobeHouse", x: 4.5, z: 142.5, rotY: Math.PI, params: { width: 8, depth: 8, tint: "#6d5b41" } },
  { kind: "adobeHouse", x: 30, z: 128.5, params: { width: 16, depth: 11, enterable: true } },
  { kind: "adobeHouse", x: 30, z: 143.5, params: { width: 16, depth: 11, tint: "#b6a68f" } },
  { kind: "compoundWall", x: 74, z: 128.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 74, z: 143.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 54.63, z: 148, params: { length: 9.25 } },
  { kind: "compoundWall", x: 50, z: 128.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "granary", x: 62, z: 136, rotY: Math.PI / 2, params: { height: 4.37 } },
  { kind: "adobeHouse", x: 94, z: 143.5, params: { width: 16, depth: 11, enterable: true } },
  { kind: "adobeHouse", x: 125.12, z: 133.13, params: { width: 11, depth: 10, floors: 2, enterable: true } },
  { kind: "compoundWall", x: 138, z: 128.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 138, z: 143.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 118.63, z: 148, params: { length: 9.25 } },
  { kind: "compoundWall", x: 114, z: 128.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "adobeHouse", x: 157.38, z: 136.67, rotY: Math.PI / 2, params: { width: 11, depth: 10, ruined: true, tint: "#6d5b41" } },
  { kind: "compoundWall", x: 150.63, z: 124, params: { length: 9.25 } },
  { kind: "compoundWall", x: 165.38, z: 124, params: { length: 9.25 } },
  { kind: "compoundWall", x: 170, z: 143.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 146, z: 143.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "windTower", x: -34, z: 168, rotY: -Math.PI / 2, params: { width: 19, depth: 15, floors: 1, enterable: true, rampSide: -1, height: 7.31 } },
  { kind: "adobeHouse", x: -2, z: 168, params: { width: 18, depth: 14, enterable: true, rampSide: 1, tint: "#b6a68f" } },
  { kind: "adobeHouse", x: 30.19, z: 169.7, rotY: -Math.PI / 2, params: { width: 10, depth: 9, floors: 2, ruined: true } },
  { kind: "compoundWall", x: 22.63, z: 156, params: { length: 9.25 } },
  { kind: "compoundWall", x: 37.38, z: 156, params: { length: 9.25 } },
  { kind: "compoundWall", x: 42, z: 175.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 18, z: 175.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "adobeHouse", x: 62, z: 168, params: { width: 19, depth: 16, enterable: true, rampSide: -1, tint: "#6d5b41" } },
  { kind: "adobeHouse", x: 87.5, z: 161.5, params: { width: 8, depth: 8, floors: 2, enterable: true } },
  { kind: "adobeHouse", x: 87.5, z: 174.5, rotY: Math.PI / 2, params: { width: 8, depth: 8, enterable: true, tint: "#b6a68f" } },
  { kind: "adobeHouse", x: 100.5, z: 161.5, rotY: Math.PI, params: { width: 9, depth: 9, enterable: true } },
  { kind: "adobeHouse", x: 100.5, z: 174.5, params: { width: 8, depth: 9, enterable: true } },
  { kind: "adobeHouse", x: 118.5, z: 168, rotY: Math.PI / 2, params: { width: 17, depth: 11, enterable: true, tint: "#b6a68f" } },
  { kind: "adobeHouse", x: 133.5, z: 168, rotY: Math.PI / 2, params: { width: 17, depth: 11, enterable: true, tint: "#7b6a51" } },
  { kind: "adobeHouse", x: 159.91, z: 167.95, rotY: Math.PI / 2, params: { width: 11, depth: 12, floors: 2, ruined: true } },
  { kind: "compoundWall", x: 170, z: 160.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 170, z: 175.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 150.63, z: 180, params: { length: 9.25 } },
  { kind: "compoundWall", x: 146, z: 160.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  // ===== the north town ============================================================
  // Newer, looser, and half of it never finished: bigger plots on a 36 m
  // pitch with a third of them walled and empty. The ground between the old
  // town and the north edge had to be worth crossing without being another
  // maze.
  { kind: "caravanserai", x: 66, z: 262, params: { width: 44, depth: 38 } },
  { kind: "granary", x: 66, z: 296, params: { height: 6 } },
  { kind: "well", x: 30, z: 234 },
  { kind: "adobeHouse", x: -221.5, z: 240.5, rotY: Math.PI / 2, params: { width: 8, depth: 9 } },
  { kind: "adobeHouse", x: -221.5, z: 253.5, rotY: Math.PI / 2, params: { width: 9, depth: 9, enterable: true, tint: "#6d5b41" } },
  { kind: "adobeHouse", x: -208.5, z: 240.5, params: { width: 8, depth: 8, enterable: true, tint: "#7b6a51" } },
  { kind: "adobeHouse", x: -208.5, z: 253.5, rotY: Math.PI, params: { width: 8, depth: 8, tint: "#7b6a51" } },
  { kind: "adobeHouse", x: -180.07, z: 247.06, rotY: Math.PI, params: { width: 14, depth: 12 } },
  { kind: "compoundWall", x: -171, z: 239.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -171, z: 254.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -190.38, z: 259, params: { length: 9.25 } },
  { kind: "compoundWall", x: -195, z: 239.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -158.38, z: 235, params: { length: 9.25 } },
  { kind: "compoundWall", x: -143.63, z: 235, params: { length: 9.25 } },
  { kind: "compoundWall", x: -163, z: 254.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -126.38, z: 235, params: { length: 9.25 } },
  { kind: "compoundWall", x: -111.63, z: 235, params: { length: 9.25 } },
  { kind: "compoundWall", x: -107, z: 254.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -126.38, z: 259, params: { length: 9.25 } },
  { kind: "adobeHouse", x: -87, z: 240, params: { width: 19, depth: 10, tint: "#b6a68f" } },
  { kind: "adobeHouse", x: -87, z: 254, params: { width: 19, depth: 10, enterable: true } },
  { kind: "compoundWall", x: -30.38, z: 235, params: { length: 9.25 } },
  { kind: "compoundWall", x: -15.63, z: 235, params: { length: 9.25 } },
  { kind: "compoundWall", x: -11, z: 254.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -30.38, z: 259, params: { length: 9.25 } },
  { kind: "adobeHouse", x: 2.5, z: 240.5, rotY: Math.PI, params: { width: 8, depth: 8, floors: 2 } },
  { kind: "adobeHouse", x: 2.5, z: 253.5, rotY: -Math.PI / 2, params: { width: 9, depth: 9, enterable: true, tint: "#b6a68f" } },
  { kind: "adobeHouse", x: 15.5, z: 240.5, rotY: Math.PI, params: { width: 9, depth: 8 } },
  { kind: "adobeHouse", x: 15.5, z: 253.5, rotY: Math.PI / 2, params: { width: 9, depth: 9, enterable: true } },
  { kind: "compoundWall", x: 48.38, z: 235, params: { length: 9.25 } },
  { kind: "compoundWall", x: 33.63, z: 259, params: { length: 9.25 } },
  { kind: "compoundWall", x: 65.63, z: 235, params: { length: 9.25 } },
  { kind: "compoundWall", x: 80.38, z: 235, params: { length: 9.25 } },
  { kind: "windTower", x: 105, z: 247, params: { width: 20, depth: 17, floors: 1, enterable: true, rampSide: 1, height: 7.11, tint: "#b6a68f" } },
  { kind: "adobeHouse", x: -216.24, z: 278.05, params: { width: 12, depth: 9, ruined: true } },
  { kind: "compoundWall", x: -222.38, z: 267, params: { length: 9.25 } },
  { kind: "compoundWall", x: -207.63, z: 267, params: { length: 9.25 } },
  { kind: "compoundWall", x: -222.38, z: 291, params: { length: 9.25 } },
  { kind: "compoundWall", x: -207.63, z: 291, params: { length: 9.25 } },
  { kind: "adobeHouse", x: -189.5, z: 272.5, rotY: -Math.PI / 2, params: { width: 8, depth: 8, enterable: true } },
  { kind: "adobeHouse", x: -189.5, z: 285.5, rotY: Math.PI / 2, params: { width: 9, depth: 9, enterable: true } },
  { kind: "adobeHouse", x: -176.5, z: 272.5, params: { width: 9, depth: 9, floors: 2, tint: "#7b6a51" } },
  { kind: "adobeHouse", x: -176.5, z: 285.5, rotY: Math.PI, params: { width: 8, depth: 9 } },
  { kind: "adobeHouse", x: -157.5, z: 272.5, params: { width: 8, depth: 8 } },
  { kind: "adobeHouse", x: -157.5, z: 285.5, rotY: Math.PI, params: { width: 9, depth: 8 } },
  { kind: "adobeHouse", x: -144.5, z: 285.5, rotY: Math.PI, params: { width: 8, depth: 8, enterable: true, tint: "#6d5b41" } },
  { kind: "adobeHouse", x: -120.8, z: 281.78, rotY: -Math.PI / 2, params: { width: 13, depth: 11 } },
  { kind: "compoundWall", x: -107, z: 271.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -107, z: 286.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -126.38, z: 291, params: { length: 9.25 } },
  { kind: "compoundWall", x: -131, z: 271.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "adobeHouse", x: -85.91, z: 279.39, params: { width: 12, depth: 12, floors: 2, ruined: true, tint: "#6d5b41" } },
  { kind: "compoundWall", x: -94.38, z: 267, params: { length: 9.25 } },
  { kind: "compoundWall", x: -94.38, z: 291, params: { length: 9.25 } },
  { kind: "compoundWall", x: -47.63, z: 267, params: { length: 9.25 } },
  { kind: "compoundWall", x: -43, z: 286.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -30.38, z: 267, params: { length: 9.25 } },
  { kind: "compoundWall", x: -15.63, z: 267, params: { length: 9.25 } },
  { kind: "compoundWall", x: -30.38, z: 291, params: { length: 9.25 } },
  { kind: "compoundWall", x: -15.63, z: 291, params: { length: 9.25 } },
  { kind: "windTower", x: 9, z: 279, params: { width: 20, depth: 20, floors: 1, enterable: true, rampSide: 1, height: 7.33 } },
  { kind: "compoundWall", x: 33.63, z: 267, params: { length: 9.25 } },
  { kind: "compoundWall", x: 53, z: 286.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 33.63, z: 291, params: { length: 9.25 } },
  { kind: "compoundWall", x: 85, z: 286.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 61, z: 286.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "adobeHouse", x: 105.87, z: 280.06, rotY: Math.PI, params: { width: 12, depth: 13, floors: 2, enterable: true } },
  { kind: "compoundWall", x: 97.63, z: 267, params: { length: 9.25 } },
  { kind: "compoundWall", x: 112.38, z: 267, params: { length: 9.25 } },
  { kind: "compoundWall", x: 117, z: 286.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 93, z: 286.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "adobeHouse", x: -215.39, z: 309.12, rotY: -Math.PI / 2, params: { width: 12, depth: 11 } },
  { kind: "compoundWall", x: -203, z: 303.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -203, z: 318.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -222.38, z: 323, params: { length: 9.25 } },
  { kind: "compoundWall", x: -227, z: 303.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -190.38, z: 299, params: { length: 9.25 } },
  { kind: "compoundWall", x: -175.63, z: 299, params: { length: 9.25 } },
  { kind: "compoundWall", x: -171, z: 318.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -190.38, z: 323, params: { length: 9.25 } },
  { kind: "compoundWall", x: -158.38, z: 299, params: { length: 9.25 } },
  { kind: "compoundWall", x: -143.63, z: 299, params: { length: 9.25 } },
  { kind: "compoundWall", x: -139, z: 318.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -158.38, z: 323, params: { length: 9.25 } },
  { kind: "adobeHouse", x: -126.5, z: 311, rotY: Math.PI / 2, params: { width: 20, depth: 11 } },
  { kind: "adobeHouse", x: -111.5, z: 311, rotY: Math.PI / 2, params: { width: 20, depth: 11, enterable: true, tint: "#6d5b41" } },
  { kind: "compoundWall", x: -94.38, z: 323, params: { length: 9.25 } },
  { kind: "compoundWall", x: -99, z: 303.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -47.63, z: 299, params: { length: 9.25 } },
  { kind: "compoundWall", x: -47.63, z: 323, params: { length: 9.25 } },
  { kind: "windTower", x: -23, z: 311, rotY: Math.PI, params: { width: 19, depth: 14, floors: 1, enterable: true, rampSide: -1, height: 7.54 } },
  { kind: "adobeHouse", x: 10.57, z: 310.61, rotY: -Math.PI / 2, params: { width: 14, depth: 11, enterable: true } },
  { kind: "compoundWall", x: 1.63, z: 299, params: { length: 9.25 } },
  { kind: "compoundWall", x: 16.38, z: 299, params: { length: 9.25 } },
  { kind: "compoundWall", x: 1.63, z: 323, params: { length: 9.25 } },
  { kind: "compoundWall", x: 16.38, z: 323, params: { length: 9.25 } },
  { kind: "compoundWall", x: 33.63, z: 299, params: { length: 9.25 } },
  { kind: "compoundWall", x: 48.38, z: 299, params: { length: 9.25 } },
  { kind: "compoundWall", x: 53, z: 318.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 29, z: 318.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "adobeHouse", x: 66.5, z: 311, rotY: Math.PI / 2, params: { width: 19, depth: 9, tint: "#b6a68f" } },
  { kind: "adobeHouse", x: 79.5, z: 311, rotY: Math.PI / 2, params: { width: 19, depth: 9 } },
  { kind: "adobeHouse", x: 104.25, z: 310.78, rotY: Math.PI / 2, params: { width: 12, depth: 10, ruined: true, tint: "#7b6a51" } },
  { kind: "compoundWall", x: 117, z: 303.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 117, z: 318.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 97.63, z: 323, params: { length: 9.25 } },
  { kind: "compoundWall", x: 93, z: 303.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  // ===== D - the Martyrs' Quarter ==================================================
  // Four shelled apartment blocks on the shelf that stands seven metres over
  // the town, and the only place on the map with three walked floors in one
  // building. Whoever holds it looks down every street in the old town — and
  // is looked at from a hundred and eighty metres of open slope, which is the
  // trade the whole quarter is. The approach from the west is deliberately
  // bare: there is nothing between the second highway and the yard wall.
  { kind: "shellBlock", x: 220, z: 94, params: { width: 22, depth: 16, floors: 3, rampSide: -1 } },
  { kind: "shellBlock", x: 292, z: 98, params: { width: 22, depth: 16, floors: 3, rampSide: -1 } },
  { kind: "shellBlock", x: 222, z: 184, rotY: Math.PI, params: { width: 22, depth: 16, floors: 3, rampSide: 1 } },
  { kind: "shellBlock", x: 294, z: 186, rotY: Math.PI, params: { width: 22, depth: 16, floors: 3, rampSide: -1 } },
  { kind: "windTower", x: 246, z: 174, params: { width: 15, depth: 16, floors: 2, enterable: true, rampSide: -1, height: 8.2, tint: "#b6a68f" } },
  { kind: "shellBlock", x: 216, z: 142, rotY: Math.PI / 2, params: { width: 26, depth: 15, floors: 2 } },
  { kind: "car", x: 248.41, z: 161.81, rotY: -Math.PI / 2, params: { tint: "#6b463a" } },
  { kind: "car", x: 276.51, z: 160.01, params: { tint: "#6b463a" } },
  { kind: "car", x: 294.35, z: 173.36, rotY: -Math.PI / 2, params: { tint: "#4a4f45" } },
  { kind: "car", x: 233.05, z: 143.86, rotY: Math.PI, params: { tint: "#4a4f45" } },
  { kind: "car", x: 296.03, z: 86.17, rotY: -Math.PI / 2, params: { tint: "#4a4f45" } },
  { kind: "blastWall", x: 244, z: 70, params: { length: 26 } },
  { kind: "sandbags", x: 280, z: 74, params: { length: 8 } },
  // ===== the quarter's own streets =================================================
  // What is left of the streets around the blocks. Nearly half the plots up
  // here are ruins, which is the difference between this quarter and the old
  // town: down there the fabric is intact and the ground is a maze, and up
  // here the fabric is broken and the sightlines run.
  { kind: "adobeHouse", x: 221, z: 116, params: { width: 16, depth: 18, enterable: true, rampSide: 1 } },
  { kind: "compoundWall", x: 265, z: 108.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 265, z: 123.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 241, z: 108.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "granary", x: 253, z: 116, rotY: Math.PI, params: { height: 4.33 } },
  { kind: "adobeHouse", x: 286.84, z: 115.01, rotY: Math.PI, params: { width: 12, depth: 11, ruined: true, tint: "#b6a68f" } },
  { kind: "adobeHouse", x: 283.41, z: 150.02, params: { width: 11, depth: 12, ruined: true, tint: "#7b6a51" } },
  // ===== B - the Fuel Depot ========================================================
  // The one industrial site on the map and the only flag with no roofs over
  // it: a fenced yard of tanks, sheds and hardstanding on the wadi's south
  // bank. It plays flat and long where every other flag plays vertical, which
  // is what earns it a place on a map whose other four are all rooms.
  { kind: "silo", x: -166, z: -160 },
  { kind: "silo", x: -153, z: -160 },
  { kind: "silo", x: -140, z: -160 },
  { kind: "silo", x: -127, z: -160 },
  { kind: "depot", x: -90, z: -190, rotY: Math.PI / 2, params: { width: 28, depth: 16, height: 8 } },
  { kind: "depot", x: -156, z: -206, params: { width: 28, depth: 16, height: 8 } },
  { kind: "shed", x: -168.12, z: -187.75, rotY: -Math.PI / 2 },
  { kind: "shed", x: -159.29, z: -186.68, rotY: Math.PI / 2 },
  { kind: "blastWall", x: -120, z: -218, params: { length: 46 } },
  { kind: "sandbags", x: -136, z: -214, params: { length: 9 } },
  { kind: "crates", x: -152.38, z: -175.45, rotY: Math.PI / 2 },
  { kind: "crates", x: -148.37, z: -186.82, rotY: -Math.PI / 2 },
  { kind: "crates", x: -164.12, z: -177.9, rotY: Math.PI / 2 },
  { kind: "car", x: -106, z: -210, rotY: Math.PI / 2, params: { tint: "#6b463a" } },
  { kind: "compoundWall", x: -78, z: -200.38, rotY: Math.PI / 2, params: { length: 35.25, height: 2.4 } },
  { kind: "compoundWall", x: -78, z: -159.63, rotY: Math.PI / 2, params: { length: 35.25, height: 2.4 } },
  { kind: "compoundWall", x: -142.38, z: -142, params: { length: 39.25, height: 2.4 } },
  // ===== E - the Crossing ==========================================================
  // The checkpoint on the east highway's ford, on the flat twenty metres
  // south of the bank: T-walls across the road, sandbags either side of the
  // gap, a watch position west of it and the pump compound behind. It is the
  // narrowest flag on the map — a fight for fourteen metres of road — and the
  // only one a hull can sit outside and shell without ever entering.
  { kind: "blastWall", x: 163, z: -96, params: { length: 24 } },
  { kind: "blastWall", x: 217, z: -96, params: { length: 24 } },
  { kind: "blastWall", x: 163, z: -140, params: { length: 24 } },
  { kind: "blastWall", x: 217, z: -140, params: { length: 24 } },
  { kind: "sandbags", x: 170, z: -110, params: { length: 9 } },
  { kind: "sandbags", x: 212, z: -126, params: { length: 9 } },
  { kind: "watchtower", x: 144, z: -110 },
  { kind: "shed", x: 236, z: -158 },
  { kind: "kiln", x: 142, z: -144 },
  { kind: "compoundWall", x: 215.63, z: -156, params: { length: 23.25, height: 2.4 } },
  { kind: "compoundWall", x: 256, z: -146.38, rotY: Math.PI / 2, params: { length: 19.25, height: 2.4 } },
  { kind: "compoundWall", x: 256, z: -121.63, rotY: Math.PI / 2, params: { length: 19.25, height: 2.4 } },
  { kind: "compoundWall", x: 215.63, z: -112, params: { length: 23.25, height: 2.4 } },
  { kind: "car", x: 162.48, z: -78.15, rotY: Math.PI / 2, params: { tint: "#2f3338" } },
  { kind: "car", x: 220.18, z: -131.28, rotY: Math.PI / 2, params: { tint: "#2f3338" } },
  { kind: "barrier", x: 180, z: -80, rotY: Math.PI / 2, params: { length: 6 } },
  { kind: "barrier", x: 200, z: -158, rotY: Math.PI / 2, params: { length: 6 } },
  // ===== the south bank ============================================================
  // What is left of the suburb between the wadi and the desert: a third of it
  // walled plots with nothing in them, which is what a town looks like where
  // it was still being built when the fighting reached it.
  { kind: "caravanserai", x: -215, z: -187, params: { width: 44, depth: 38, tint: "#b6a68f" } },
  { kind: "compoundWall", x: -183.38, z: -215, params: { length: 9.25 } },
  { kind: "compoundWall", x: -168.63, z: -215, params: { length: 9.25 } },
  { kind: "compoundWall", x: -183.38, z: -191, params: { length: 9.25 } },
  { kind: "compoundWall", x: -40.63, z: -215, params: { length: 9.25 } },
  { kind: "compoundWall", x: -36, z: -195.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -23.38, z: -215, params: { length: 9.25 } },
  { kind: "compoundWall", x: -8.63, z: -215, params: { length: 9.25 } },
  { kind: "compoundWall", x: -4, z: -195.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -28, z: -195.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "granary", x: -16, z: -203, params: { height: 4.4 } },
  { kind: "adobeHouse", x: 9.5, z: -203, rotY: Math.PI / 2, params: { width: 20, depth: 9, floors: 2, enterable: true, tint: "#7b6a51" } },
  { kind: "adobeHouse", x: 22.5, z: -203, rotY: Math.PI / 2, params: { width: 20, depth: 9, floors: 2, enterable: true, tint: "#7b6a51" } },
  { kind: "compoundWall", x: 40.63, z: -215, params: { length: 9.25 } },
  { kind: "compoundWall", x: 55.38, z: -215, params: { length: 9.25 } },
  { kind: "compoundWall", x: 40.63, z: -191, params: { length: 9.25 } },
  { kind: "compoundWall", x: 55.38, z: -191, params: { length: 9.25 } },
  { kind: "compoundWall", x: 92, z: -210.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 92, z: -195.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 72.63, z: -191, params: { length: 9.25 } },
  { kind: "compoundWall", x: 68, z: -210.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "windTower", x: 112, z: -203, params: { width: 14, depth: 19, floors: 1, enterable: true, rampSide: -1, height: 5.85 } },
  { kind: "adobeHouse", x: 137.5, z: -209.5, rotY: Math.PI, params: { width: 8, depth: 9, tint: "#6d5b41" } },
  { kind: "adobeHouse", x: 137.5, z: -196.5, rotY: Math.PI / 2, params: { width: 8, depth: 9, enterable: true } },
  { kind: "adobeHouse", x: 150.5, z: -209.5, params: { width: 8, depth: 9, enterable: true } },
  { kind: "adobeHouse", x: 150.5, z: -196.5, params: { width: 9, depth: 8, enterable: true, tint: "#7b6a51" } },
  { kind: "adobeHouse", x: 214.5, z: -209.5, rotY: -Math.PI / 2, params: { width: 8, depth: 8, floors: 2 } },
  { kind: "adobeHouse", x: 214.5, z: -196.5, params: { width: 9, depth: 8, floors: 2 } },
  { kind: "adobeHouse", x: 233.5, z: -209.5, rotY: Math.PI, params: { width: 9, depth: 9, tint: "#6d5b41" } },
  { kind: "adobeHouse", x: 233.5, z: -196.5, rotY: Math.PI / 2, params: { width: 9, depth: 8, tint: "#b6a68f" } },
  { kind: "adobeHouse", x: 246.5, z: -209.5, params: { width: 9, depth: 8, enterable: true, tint: "#7b6a51" } },
  { kind: "adobeHouse", x: 246.5, z: -196.5, rotY: -Math.PI / 2, params: { width: 9, depth: 8, enterable: true } },
  { kind: "compoundWall", x: -247.38, z: -183, params: { length: 9.25 } },
  { kind: "compoundWall", x: -247.38, z: -159, params: { length: 9.25 } },
  { kind: "compoundWall", x: -232.63, z: -159, params: { length: 9.25 } },
  { kind: "compoundWall", x: -215.38, z: -159, params: { length: 9.25 } },
  { kind: "compoundWall", x: -200.63, z: -159, params: { length: 9.25 } },
  { kind: "adobeHouse", x: -182.5, z: -177.5, rotY: -Math.PI / 2, params: { width: 9, depth: 8, tint: "#b6a68f" } },
  { kind: "adobeHouse", x: -182.5, z: -164.5, rotY: Math.PI, params: { width: 9, depth: 8, enterable: true, tint: "#b6a68f" } },
  { kind: "compoundWall", x: -151.38, z: -183, params: { length: 9.25 } },
  { kind: "granary", x: -144, z: -171, rotY: Math.PI / 2, params: { height: 5.69 } },
  { kind: "compoundWall", x: -104.63, z: -159, params: { length: 9.25 } },
  { kind: "compoundWall", x: -87.38, z: -159, params: { length: 9.25 } },
  { kind: "compoundWall", x: -40.63, z: -183, params: { length: 9.25 } },
  { kind: "compoundWall", x: -40.63, z: -159, params: { length: 9.25 } },
  { kind: "adobeHouse", x: -16, z: -171, params: { width: 20, depth: 17, enterable: true, rampSide: -1, tint: "#7b6a51" } },
  { kind: "compoundWall", x: 8.63, z: -183, params: { length: 9.25 } },
  { kind: "compoundWall", x: 23.38, z: -183, params: { length: 9.25 } },
  { kind: "compoundWall", x: 28, z: -163.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 4, z: -163.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 40.63, z: -183, params: { length: 9.25 } },
  { kind: "compoundWall", x: 55.38, z: -183, params: { length: 9.25 } },
  { kind: "compoundWall", x: 40.63, z: -159, params: { length: 9.25 } },
  { kind: "compoundWall", x: 55.38, z: -159, params: { length: 9.25 } },
  { kind: "adobeHouse", x: 80.59, z: -170.93, rotY: Math.PI / 2, params: { width: 13, depth: 10, floors: 2, ruined: true } },
  { kind: "compoundWall", x: 72.63, z: -183, params: { length: 9.25 } },
  { kind: "compoundWall", x: 87.38, z: -183, params: { length: 9.25 } },
  { kind: "compoundWall", x: 92, z: -163.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 72.63, z: -159, params: { length: 9.25 } },
  { kind: "compoundWall", x: 104.63, z: -183, params: { length: 9.25 } },
  { kind: "compoundWall", x: 119.38, z: -183, params: { length: 9.25 } },
  { kind: "compoundWall", x: 104.63, z: -159, params: { length: 9.25 } },
  { kind: "compoundWall", x: 119.38, z: -159, params: { length: 9.25 } },
  { kind: "adobeHouse", x: 137.5, z: -177.5, rotY: Math.PI / 2, params: { width: 9, depth: 8, enterable: true, tint: "#6d5b41" } },
  { kind: "adobeHouse", x: 137.5, z: -164.5, rotY: -Math.PI / 2, params: { width: 8, depth: 9, enterable: true, tint: "#6d5b41" } },
  { kind: "adobeHouse", x: 150.5, z: -177.5, params: { width: 9, depth: 9, enterable: true } },
  { kind: "adobeHouse", x: 150.5, z: -164.5, rotY: Math.PI / 2, params: { width: 8, depth: 8, enterable: true, tint: "#6d5b41" } },
  { kind: "adobeHouse", x: 168.5, z: -171, rotY: Math.PI / 2, params: { width: 18, depth: 11, enterable: true, tint: "#6d5b41" } },
  { kind: "compoundWall", x: 215.38, z: -183, params: { length: 9.25 } },
  { kind: "compoundWall", x: 220, z: -163.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "adobeHouse", x: 233.5, z: -177.5, rotY: Math.PI, params: { width: 8, depth: 9, floors: 2, enterable: true, tint: "#6d5b41" } },
  { kind: "adobeHouse", x: 246.5, z: -177.5, rotY: Math.PI / 2, params: { width: 8, depth: 8 } },
  { kind: "adobeHouse", x: 246.5, z: -164.5, rotY: -Math.PI / 2, params: { width: 8, depth: 9, enterable: true } },
  // ===== the home yards ============================================================
  // A staging area a side, walled, with the gatehouse that carries the team's
  // colour arching over the road out — Harrowmead's arrangement, and the one
  // placement on this map deliberately allowed to stand IN a road. The
  // hardstanding is on the inner edge of each yard and the three infantry
  // spawns are eight metres off it, which is Coldharbour's spacing and for
  // its reason: a hull arriving on the respawn timer must not land where
  // somebody has just deployed.
  { kind: "gatehouse", x: -318, z: -352, params: { teamColor: "#c8873a" } },
  { kind: "blastWall", x: -278, z: -326, rotY: Math.PI / 2, params: { length: 36 } },
  { kind: "blastWall", x: -342, z: -358, params: { length: 28 } },
  { kind: "sandbags", x: -348, z: -294, params: { length: 10 } },
  { kind: "shed", x: -352, z: -332 },
  { kind: "shed", x: -340, z: -344, rotY: Math.PI / 2 },
  { kind: "shed", x: -288, z: -288 },
  { kind: "crates", x: -334, z: -348 },
  { kind: "car", x: -282, z: -344, rotY: Math.PI / 2, params: { tint: "#4a4f45" } },
  { kind: "compoundWall", x: -366, z: -324, rotY: Math.PI / 2, params: { length: 34 } },
  { kind: "gatehouse", x: 318, z: 352, rotY: Math.PI, params: { teamColor: "#3f7f9c" } },
  { kind: "blastWall", x: 278, z: 326, rotY: Math.PI / 2, params: { length: 36 } },
  { kind: "blastWall", x: 342, z: 358, params: { length: 28 } },
  { kind: "sandbags", x: 348, z: 294, params: { length: 10 } },
  { kind: "shed", x: 352, z: 332 },
  { kind: "shed", x: 340, z: 344, rotY: Math.PI / 2 },
  { kind: "shed", x: 288, z: 288 },
  { kind: "crates", x: 334, z: 348 },
  { kind: "car", x: 282, z: 344, rotY: Math.PI / 2, params: { tint: "#4a4f45" } },
  { kind: "compoundWall", x: 366, z: 324, rotY: Math.PI / 2, params: { length: 34 } },
  // ===== the outskirts =============================================================
  // Walled smallholdings thinning out toward the borderland, and the last
  // thing there is to fight from before the ground opens. Deliberately
  // sparse: the country outside the town is TRANSIT, and 900 m of play needs
  // some of it to be ground you cross rather than ground you clear.
  { kind: "compoundWall", x: -130.75, z: -375.25, params: { length: 13.73, height: 2.13 } },
  { kind: "compoundWall", x: -111.52, z: -375.25, params: { length: 13.73, height: 2.13 } },
  { kind: "compoundWall", x: -130.75, z: -344.18, params: { length: 13.73, height: 2.13 } },
  { kind: "compoundWall", x: -111.52, z: -344.18, params: { length: 13.73, height: 2.13 } },
  { kind: "adobeHouse", x: -114.54, z: -354.87, params: { width: 10, depth: 10 } },
  { kind: "adobeHouse", x: -128.69, z: -353, params: { width: 10, depth: 11 } },
  { kind: "compoundWall", x: 348.32, z: -187.26, params: { length: 14.68, height: 2.5 } },
  { kind: "compoundWall", x: 368.5, z: -187.26, params: { length: 14.68, height: 2.5 } },
  { kind: "compoundWall", x: 348.32, z: -159.3, params: { length: 14.68, height: 2.5 } },
  { kind: "compoundWall", x: 368.5, z: -159.3, params: { length: 14.68, height: 2.5 } },
  { kind: "adobeHouse", x: 358.1, z: -172.1, rotY: Math.PI, params: { width: 11, depth: 11, floors: 2 } },
  { kind: "compoundWall", x: 60.23, z: 346.17, rotY: Math.PI / 2, params: { length: 11.53, height: 2.32 } },
  { kind: "compoundWall", x: 60.23, z: 363.2, rotY: Math.PI / 2, params: { length: 11.53, height: 2.32 } },
  { kind: "compoundWall", x: 31.38, z: 368.96, params: { length: 15.57, height: 2.32 } },
  { kind: "compoundWall", x: 23.59, z: 346.17, rotY: Math.PI / 2, params: { length: 11.53, height: 2.32 } },
  { kind: "adobeHouse", x: 49.85, z: 350.38, rotY: -Math.PI / 2, params: { width: 12, depth: 10, floors: 2, ruined: true, tint: "#b6a68f" } },
  { kind: "compoundWall", x: 133.24, z: 247.29, params: { length: 16.83, height: 2.12 } },
  { kind: "compoundWall", x: 155.57, z: 247.29, params: { length: 16.83, height: 2.12 } },
  { kind: "compoundWall", x: 133.24, z: 274.93, params: { length: 16.83, height: 2.12 } },
  { kind: "compoundWall", x: 155.57, z: 274.93, params: { length: 16.83, height: 2.12 } },
  { kind: "adobeHouse", x: 153.7, z: 264.6, rotY: -Math.PI / 2, params: { width: 9, depth: 8, enterable: true } },
  { kind: "granary", x: 135.03, z: 267.26, rotY: Math.PI, params: { height: 4.41 } },
  { kind: "compoundWall", x: 341.62, z: 97.29, params: { length: 17.72, height: 2.58 } },
  { kind: "compoundWall", x: 364.84, z: 97.29, params: { length: 17.72, height: 2.58 } },
  { kind: "compoundWall", x: 373.7, z: 116.82, rotY: Math.PI / 2, params: { length: 9.35, height: 2.58 } },
  { kind: "compoundWall", x: 341.62, z: 121.49, params: { length: 17.72, height: 2.58 } },
  { kind: "adobeHouse", x: 360.87, z: 106.55, rotY: -Math.PI / 2, params: { width: 12, depth: 10, ruined: true, tint: "#6d5b41" } },
  { kind: "adobeHouse", x: 343.04, z: 108.54, rotY: -Math.PI / 2, params: { width: 8, depth: 10, floors: 2 } },
  { kind: "compoundWall", x: 49.34, z: -367.58, params: { length: 16.15, height: 2.32 } },
  { kind: "compoundWall", x: 70.99, z: -367.58, params: { length: 16.15, height: 2.32 } },
  { kind: "compoundWall", x: 79.06, z: -341.84, rotY: Math.PI / 2, params: { length: 13.49, height: 2.32 } },
  { kind: "compoundWall", x: 41.26, z: -341.84, rotY: Math.PI / 2, params: { length: 13.49, height: 2.32 } },
  { kind: "adobeHouse", x: 55.19, z: -357.1, rotY: -Math.PI / 2, params: { width: 9, depth: 8, tint: "#b6a68f" } },
  { kind: "compoundWall", x: -18.66, z: -309.67, params: { length: 12.43, height: 2.07 } },
  { kind: "compoundWall", x: -0.73, z: -309.67, params: { length: 12.43, height: 2.07 } },
  { kind: "compoundWall", x: -18.66, z: -274.46, params: { length: 12.43, height: 2.07 } },
  { kind: "compoundWall", x: -0.73, z: -274.46, params: { length: 12.43, height: 2.07 } },
  { kind: "adobeHouse", x: -12, z: -296.72, rotY: Math.PI / 2, params: { width: 10, depth: 9, floors: 2, ruined: true, tint: "#b6a68f" } },
  { kind: "compoundWall", x: 336, z: 140.83, params: { length: 13.59, height: 2.32 } },
  { kind: "compoundWall", x: 355.1, z: 140.83, params: { length: 13.59, height: 2.32 } },
  { kind: "compoundWall", x: 336, z: 167.7, params: { length: 13.59, height: 2.32 } },
  { kind: "compoundWall", x: 355.1, z: 167.7, params: { length: 13.59, height: 2.32 } },
  { kind: "adobeHouse", x: 347.19, z: 154.02, rotY: -Math.PI / 2, params: { width: 10, depth: 11, enterable: true, tint: "#7b6a51" } },
  { kind: "compoundWall", x: 238.4, z: -332.91, params: { length: 17.49, height: 2.31 } },
  { kind: "compoundWall", x: 261.39, z: -332.91, params: { length: 17.49, height: 2.31 } },
  { kind: "compoundWall", x: 270.13, z: -310.16, rotY: Math.PI / 2, params: { length: 11.5, height: 2.31 } },
  { kind: "compoundWall", x: 238.4, z: -304.4, params: { length: 17.49, height: 2.31 } },
  { kind: "adobeHouse", x: 245.22, z: -320.79, rotY: -Math.PI / 2, params: { width: 12, depth: 9 } },
  { kind: "compoundWall", x: -164.84, z: 336.48, params: { length: 13.96, height: 2.33 } },
  { kind: "compoundWall", x: -145.37, z: 336.48, params: { length: 13.96, height: 2.33 } },
  { kind: "compoundWall", x: -138.39, z: 359.06, rotY: Math.PI / 2, params: { length: 11.39, height: 2.33 } },
  { kind: "compoundWall", x: -164.84, z: 364.76, params: { length: 13.96, height: 2.33 } },
  { kind: "adobeHouse", x: -161.11, z: 346.58, rotY: Math.PI, params: { width: 12, depth: 11, enterable: true } },
  { kind: "granary", x: -147.75, z: 351.61, params: { height: 5.54 } },
  { kind: "compoundWall", x: -270.98, z: 287.91, params: { length: 13.65, height: 2.12 } },
  { kind: "compoundWall", x: -251.84, z: 287.91, params: { length: 13.65, height: 2.12 } },
  { kind: "compoundWall", x: -245.02, z: 309.04, rotY: Math.PI / 2, params: { length: 10.42, height: 2.12 } },
  { kind: "compoundWall", x: -270.98, z: 314.25, params: { length: 13.65, height: 2.12 } },
  { kind: "adobeHouse", x: -260.12, z: 297.89, rotY: Math.PI / 2, params: { width: 9, depth: 11, enterable: true } },
  { kind: "compoundWall", x: -287.54, z: -10.03, params: { length: 12.66, height: 2.06 } },
  { kind: "compoundWall", x: -269.39, z: -10.03, params: { length: 12.66, height: 2.06 } },
  { kind: "compoundWall", x: -263.06, z: 10.21, rotY: Math.PI / 2, params: { length: 9.83, height: 2.06 } },
  { kind: "compoundWall", x: -293.87, z: 10.21, rotY: Math.PI / 2, params: { length: 9.83, height: 2.06 } },
  { kind: "adobeHouse", x: -283.12, z: 0.5, rotY: Math.PI / 2, params: { width: 9, depth: 10, floors: 2, tint: "#b6a68f" } },
  { kind: "compoundWall", x: 97.04, z: 354.78, params: { length: 13.23, height: 2.35 } },
  { kind: "compoundWall", x: 115.77, z: 354.78, params: { length: 13.23, height: 2.35 } },
  { kind: "compoundWall", x: 122.39, z: 375.69, rotY: Math.PI / 2, params: { length: 10.27, height: 2.35 } },
  { kind: "compoundWall", x: 90.43, z: 375.69, rotY: Math.PI / 2, params: { length: 10.27, height: 2.35 } },
  { kind: "adobeHouse", x: 109.14, z: 364.45, rotY: Math.PI / 2, params: { width: 8, depth: 8, enterable: true } },
  { kind: "compoundWall", x: -29.64, z: 362.73, params: { length: 14.17, height: 2.37 } },
  { kind: "compoundWall", x: -9.97, z: 362.73, params: { length: 14.17, height: 2.37 } },
  { kind: "compoundWall", x: -2.89, z: 389.34, rotY: Math.PI / 2, params: { length: 14.08, height: 2.37 } },
  { kind: "compoundWall", x: -29.64, z: 396.38, params: { length: 14.17, height: 2.37 } },
  { kind: "adobeHouse", x: -22.94, z: 374.95, rotY: Math.PI, params: { width: 10, depth: 9, floors: 2, ruined: true, tint: "#7b6a51" } },
  { kind: "compoundWall", x: -345.92, z: 156.86, rotY: Math.PI / 2, params: { length: 15.23, height: 2.51 } },
  { kind: "compoundWall", x: -345.92, z: 177.59, rotY: Math.PI / 2, params: { length: 15.23, height: 2.51 } },
  { kind: "compoundWall", x: -369.92, z: 185.21, params: { length: 12.33, height: 2.51 } },
  { kind: "compoundWall", x: -376.08, z: 156.86, rotY: Math.PI / 2, params: { length: 15.23, height: 2.51 } },
  { kind: "adobeHouse", x: -367.91, z: 163.62, params: { width: 9, depth: 10, enterable: true, tint: "#b6a68f" } },
  { kind: "granary", x: -357.28, z: 157.35, rotY: Math.PI, params: { height: 5.46 } },
  { kind: "compoundWall", x: 69.11, z: -302.31, params: { length: 11.42, height: 2.39 } },
  { kind: "compoundWall", x: 86.03, z: -302.31, params: { length: 11.42, height: 2.39 } },
  { kind: "compoundWall", x: 91.74, z: -279.13, rotY: Math.PI / 2, params: { length: 11.79, height: 2.39 } },
  { kind: "compoundWall", x: 63.39, z: -279.13, rotY: Math.PI / 2, params: { length: 11.79, height: 2.39 } },
  { kind: "adobeHouse", x: 72.36, z: -289.58, rotY: Math.PI, params: { width: 10, depth: 10 } },
  { kind: "compoundWall", x: 256.95, z: -290.45, rotY: Math.PI / 2, params: { length: 10.35, height: 2.47 } },
  { kind: "compoundWall", x: 256.95, z: -274.6, rotY: Math.PI / 2, params: { length: 10.35, height: 2.47 } },
  { kind: "compoundWall", x: 228.07, z: -269.43, params: { length: 15.59, height: 2.47 } },
  { kind: "compoundWall", x: 220.28, z: -290.45, rotY: Math.PI / 2, params: { length: 10.35, height: 2.47 } },
  { kind: "adobeHouse", x: 230.97, z: -277.37, rotY: Math.PI, params: { width: 11, depth: 11 } },
  { kind: "adobeHouse", x: 246.48, z: -286.44, rotY: -Math.PI / 2, params: { width: 11, depth: 8, ruined: true, tint: "#7b6a51" } },
  { kind: "compoundWall", x: 213.08, z: 272.74, params: { length: 13.71, height: 2.51 } },
  { kind: "compoundWall", x: 232.3, z: 272.74, params: { length: 13.71, height: 2.51 } },
  { kind: "compoundWall", x: 239.15, z: 300.8, rotY: Math.PI / 2, params: { length: 15.04, height: 2.51 } },
  { kind: "compoundWall", x: 206.23, z: 300.8, rotY: Math.PI / 2, params: { length: 15.04, height: 2.51 } },
  { kind: "adobeHouse", x: 226.66, z: 292.33, rotY: Math.PI / 2, params: { width: 12, depth: 9, enterable: true, tint: "#6d5b41" } },
  { kind: "compoundWall", x: 268.36, z: -191.57, params: { length: 11.83, height: 2.48 } },
  { kind: "compoundWall", x: 285.69, z: -191.57, params: { length: 11.83, height: 2.48 } },
  { kind: "compoundWall", x: 291.6, z: -166, rotY: Math.PI / 2, params: { length: 13.38, height: 2.48 } },
  { kind: "compoundWall", x: 268.36, z: -159.31, params: { length: 11.83, height: 2.48 } },
  { kind: "adobeHouse", x: 272.59, z: -180.18, rotY: Math.PI, params: { width: 9, depth: 8, ruined: true } },
  { kind: "compoundWall", x: -26.68, z: -377, params: { length: 14.78, height: 2.12 } },
  { kind: "compoundWall", x: -6.4, z: -377, params: { length: 14.78, height: 2.12 } },
  { kind: "compoundWall", x: 0.99, z: -346.96, rotY: Math.PI / 2, params: { length: 16.35, height: 2.12 } },
  { kind: "compoundWall", x: -34.07, z: -346.96, rotY: Math.PI / 2, params: { length: 16.35, height: 2.12 } },
  { kind: "adobeHouse", x: -14.46, z: -356.95, rotY: Math.PI / 2, params: { width: 12, depth: 9, ruined: true } },
  { kind: "compoundWall", x: 122.85, z: -389.95, params: { length: 17.04, height: 2.22 } },
  { kind: "compoundWall", x: 145.39, z: -389.95, params: { length: 17.04, height: 2.22 } },
  { kind: "compoundWall", x: 153.91, z: -366.94, rotY: Math.PI / 2, params: { length: 11.67, height: 2.22 } },
  { kind: "compoundWall", x: 114.33, z: -366.94, rotY: Math.PI / 2, params: { length: 11.67, height: 2.22 } },
  { kind: "adobeHouse", x: 138.9, z: -371.36, rotY: -Math.PI / 2, params: { width: 8, depth: 10, floors: 2 } },
  { kind: "compoundWall", x: -109.91, z: -318.26, params: { length: 15.57, height: 2.38 } },
  { kind: "compoundWall", x: -88.84, z: -318.26, params: { length: 15.57, height: 2.38 } },
  { kind: "compoundWall", x: -109.91, z: -286.01, params: { length: 15.57, height: 2.38 } },
  { kind: "compoundWall", x: -88.84, z: -286.01, params: { length: 15.57, height: 2.38 } },
  { kind: "adobeHouse", x: -106.74, z: -300.8, rotY: Math.PI / 2, params: { width: 9, depth: 10 } },
  { kind: "compoundWall", x: 142.37, z: 358.91, params: { length: 10.64, height: 2.13 } },
  { kind: "compoundWall", x: 158.51, z: 358.91, params: { length: 10.64, height: 2.13 } },
  { kind: "compoundWall", x: 163.83, z: 380.48, rotY: Math.PI / 2, params: { length: 10.71, height: 2.13 } },
  { kind: "compoundWall", x: 142.37, z: 385.84, params: { length: 10.64, height: 2.13 } },
  { kind: "adobeHouse", x: 152.06, z: 371.27, params: { width: 8, depth: 10, enterable: true } },
  { kind: "compoundWall", x: 296.6, z: 234.37, rotY: Math.PI / 2, params: { length: 11.09, height: 2.36 } },
  { kind: "compoundWall", x: 296.6, z: 250.95, rotY: Math.PI / 2, params: { length: 11.09, height: 2.36 } },
  { kind: "compoundWall", x: 275.29, z: 256.5, params: { length: 10.54, height: 2.36 } },
  { kind: "compoundWall", x: 270.02, z: 234.37, rotY: Math.PI / 2, params: { length: 11.09, height: 2.36 } },
  { kind: "adobeHouse", x: 279.02, z: 246.63, params: { width: 8, depth: 9, tint: "#6d5b41" } },
  { kind: "compoundWall", x: -387.06, z: 45.29, params: { length: 14.77, height: 2.34 } },
  { kind: "compoundWall", x: -366.79, z: 45.29, params: { length: 14.77, height: 2.34 } },
  { kind: "compoundWall", x: -359.41, z: 70.22, rotY: Math.PI / 2, params: { length: 12.95, height: 2.34 } },
  { kind: "compoundWall", x: -387.06, z: 76.69, params: { length: 14.77, height: 2.34 } },
  { kind: "adobeHouse", x: -381.51, z: 64.86, rotY: Math.PI / 2, params: { width: 10, depth: 11 } },
  { kind: "compoundWall", x: -391.32, z: -198.14, params: { length: 17.75, height: 2.01 } },
  { kind: "compoundWall", x: -368.07, z: -198.14, params: { length: 17.75, height: 2.01 } },
  { kind: "compoundWall", x: -359.2, z: -173.51, rotY: Math.PI / 2, params: { length: 12.75, height: 2.01 } },
  { kind: "compoundWall", x: -400.19, z: -173.51, rotY: Math.PI / 2, params: { length: 12.75, height: 2.01 } },
  { kind: "adobeHouse", x: -385.01, z: -175.78, rotY: -Math.PI / 2, params: { width: 10, depth: 11, tint: "#b6a68f" } },
  { kind: "compoundWall", x: 135.75, z: 285.43, params: { length: 16.21, height: 2.22 } },
  { kind: "compoundWall", x: 157.47, z: 285.43, params: { length: 16.21, height: 2.22 } },
  { kind: "compoundWall", x: 135.75, z: 313.87, params: { length: 16.21, height: 2.22 } },
  { kind: "compoundWall", x: 157.47, z: 313.87, params: { length: 16.21, height: 2.22 } },
  { kind: "adobeHouse", x: 137.71, z: 302.26, rotY: Math.PI, params: { width: 12, depth: 10, ruined: true, tint: "#6d5b41" } },
  { kind: "compoundWall", x: -192.22, z: -313.84, params: { length: 10.68, height: 2.54 } },
  { kind: "compoundWall", x: -176.04, z: -313.84, params: { length: 10.68, height: 2.54 } },
  { kind: "compoundWall", x: -192.22, z: -285.22, params: { length: 10.68, height: 2.54 } },
  { kind: "compoundWall", x: -176.04, z: -285.22, params: { length: 10.68, height: 2.54 } },
  { kind: "adobeHouse", x: -188.01, z: -293.81, params: { width: 10, depth: 11, tint: "#7b6a51" } },
  { kind: "compoundWall", x: -198.8, z: -268.52, params: { length: 10.78, height: 2.45 } },
  { kind: "compoundWall", x: -182.52, z: -268.52, params: { length: 10.78, height: 2.45 } },
  { kind: "compoundWall", x: -177.12, z: -248.04, rotY: Math.PI / 2, params: { length: 9.98, height: 2.45 } },
  { kind: "compoundWall", x: -198.8, z: -243.05, params: { length: 10.78, height: 2.45 } },
  { kind: "adobeHouse", x: -193.11, z: -261.23, params: { width: 8, depth: 10, ruined: true } },
  { kind: "compoundWall", x: 359.75, z: 62.14, params: { length: 17.01, height: 2.1 } },
  { kind: "compoundWall", x: 382.25, z: 62.14, params: { length: 17.01, height: 2.1 } },
  { kind: "compoundWall", x: 390.76, z: 84.15, rotY: Math.PI / 2, params: { length: 11, height: 2.1 } },
  { kind: "compoundWall", x: 359.75, z: 89.65, params: { length: 17.01, height: 2.1 } },
  { kind: "adobeHouse", x: 361.54, z: 79.96, rotY: Math.PI / 2, params: { width: 12, depth: 11, tint: "#7b6a51" } },
  { kind: "compoundWall", x: -208.23, z: 336.41, params: { length: 13.9, height: 2.59 } },
  { kind: "compoundWall", x: -188.84, z: 336.41, params: { length: 13.9, height: 2.59 } },
  { kind: "compoundWall", x: -181.89, z: 358.93, rotY: Math.PI / 2, params: { length: 11.35, height: 2.59 } },
  { kind: "compoundWall", x: -215.18, z: 358.93, rotY: Math.PI / 2, params: { length: 11.35, height: 2.59 } },
  { kind: "adobeHouse", x: -190.93, z: 345.91, rotY: -Math.PI / 2, params: { width: 10, depth: 9, ruined: true } },
  { kind: "compoundWall", x: 57.17, z: -419.37, params: { length: 16.81, height: 2 } },
  { kind: "compoundWall", x: 79.48, z: -419.37, params: { length: 16.81, height: 2 } },
  { kind: "compoundWall", x: 57.17, z: -381.64, params: { length: 16.81, height: 2 } },
  { kind: "compoundWall", x: 79.48, z: -381.64, params: { length: 16.81, height: 2 } },
  { kind: "adobeHouse", x: 63.31, z: -407.37, params: { width: 12, depth: 9, floors: 2 } },
  { kind: "compoundWall", x: -149.51, z: -393.55, rotY: Math.PI / 2, params: { length: 12.69, height: 2.14 } },
  { kind: "compoundWall", x: -149.51, z: -375.37, rotY: Math.PI / 2, params: { length: 12.69, height: 2.14 } },
  { kind: "compoundWall", x: -176.2, z: -369.02, params: { length: 14.12, height: 2.14 } },
  { kind: "compoundWall", x: -183.26, z: -393.55, rotY: Math.PI / 2, params: { length: 12.69, height: 2.14 } },
  { kind: "adobeHouse", x: -166.96, z: -389.78, params: { width: 12, depth: 9, floors: 2, ruined: true, tint: "#6d5b41" } },
  { kind: "compoundWall", x: -268.43, z: 245.78, params: { length: 13.26, height: 2.44 } },
  { kind: "compoundWall", x: -249.67, z: 245.78, params: { length: 13.26, height: 2.44 } },
  { kind: "compoundWall", x: -268.43, z: 273, params: { length: 13.26, height: 2.44 } },
  { kind: "compoundWall", x: -249.67, z: 273, params: { length: 13.26, height: 2.44 } },
  { kind: "adobeHouse", x: -253.01, z: 259.87, rotY: Math.PI / 2, params: { width: 10, depth: 11 } },
  { kind: "compoundWall", x: -243.68, z: -318.42, params: { length: 12.7, height: 2.13 } },
  { kind: "compoundWall", x: -225.48, z: -318.42, params: { length: 12.7, height: 2.13 } },
  { kind: "compoundWall", x: -219.13, z: -291.48, rotY: Math.PI / 2, params: { length: 14.29, height: 2.13 } },
  { kind: "compoundWall", x: -250.03, z: -291.48, rotY: Math.PI / 2, params: { length: 14.29, height: 2.13 } },
  { kind: "adobeHouse", x: -230.92, z: -305.84, rotY: -Math.PI / 2, params: { width: 10, depth: 10, floors: 2, tint: "#b6a68f" } },
  { kind: "compoundWall", x: 120.87, z: -323.94, params: { length: 13.89, height: 2.33 } },
  { kind: "compoundWall", x: 140.27, z: -323.94, params: { length: 13.89, height: 2.33 } },
  { kind: "compoundWall", x: 147.21, z: -298.73, rotY: Math.PI / 2, params: { length: 13.14, height: 2.33 } },
  { kind: "compoundWall", x: 113.93, z: -298.73, rotY: Math.PI / 2, params: { length: 13.14, height: 2.33 } },
  { kind: "adobeHouse", x: 128.85, z: -307.6, rotY: -Math.PI / 2, params: { width: 9, depth: 10, enterable: true, tint: "#7b6a51" } },
  // ===== the wayside ===============================================================
  // The half-dozen things standing on the open desert that are not a
  // smallholding, and they exist for a reason the dead ground's thorn and
  // stone cannot serve: a crossing needs somewhere to be GOING, not just
  // something to look at on the way. Every one of these is a shape you can
  // see from four hundred metres and get behind at four, put where the map
  // is otherwise nothing — the burial ground on the western flat, the three
  // cisterns the tracks out of town were dug for, the convoy that did not
  // make the ford, and the stock pens on the northern approach.
  //
  // Authored rather than lattice-generated, and that is the whole point of
  // them: what the grid is good at is TEXTURE, and a landmark is the thing
  // texture cannot be. The one piece placed with `must` is the shrine at the
  // head of the burial ground, because that is the piece the ground is FOR
  // and a silent refusal would leave a walled plot with nothing in it; every
  // other line here is dressing on ground that reads without it, and is
  // allowed to lose to something the fabric already grew.
  { kind: "shrine", x: -300, z: -90 },
  { kind: "compoundWall", x: -278, z: -117.38, rotY: Math.PI / 2, params: { length: 13.25, height: 1.5 } },
  { kind: "compoundWall", x: -278, z: -98.63, rotY: Math.PI / 2, params: { length: 13.25, height: 1.5 } },
  { kind: "well", x: 96, z: -318 },
  { kind: "trough", x: 101, z: -317, rotY: Math.PI / 2 },
  { kind: "crates", x: 92, z: -314, rotY: -Math.PI / 2 },
  { kind: "compoundWall", x: 96, z: -325, params: { length: 9, height: 1.6 } },
  { kind: "well", x: -156, z: 330 },
  { kind: "trough", x: -151, z: 331, rotY: Math.PI / 2 },
  { kind: "well", x: 330, z: -212 },
  { kind: "trough", x: 335, z: -211, rotY: Math.PI / 2 },
  { kind: "crates", x: 326, z: -208, rotY: -Math.PI / 2 },
  { kind: "compoundWall", x: 330, z: -219, params: { length: 9, height: 1.6 } },
  { kind: "car", x: 282.28, z: -78.06, rotY: -Math.PI / 2, params: { tint: "#4a4f45" } },
  { kind: "car", x: 254.21, z: -67.96, rotY: Math.PI / 2, params: { tint: "#2f3338" } },
  { kind: "car", x: 280.66, z: -62.87, rotY: Math.PI, params: { tint: "#2f3338" } },
  { kind: "car", x: 263.79, z: -49.99, rotY: Math.PI / 2, params: { tint: "#2f3338" } },
  { kind: "car", x: 268, z: -39.93, rotY: -Math.PI / 2, params: { tint: "#3f4b52" } },
  { kind: "blastWall", x: 256, z: -54, rotY: Math.PI / 2, params: { length: 14 } },
  { kind: "compoundWall", x: 17.13, z: 361, params: { length: 12.25, height: 1.7 } },
  { kind: "compoundWall", x: 34.88, z: 361, params: { length: 12.25, height: 1.7 } },
  { kind: "compoundWall", x: 17.13, z: 383, params: { length: 12.25, height: 1.7 } },
  { kind: "compoundWall", x: 34.88, z: 383, params: { length: 12.25, height: 1.7 } },
  { kind: "trough", x: 26, z: 372 },
  { kind: "compoundWall", x: 51.13, z: 371, params: { length: 12.25, height: 1.7 } },
  { kind: "compoundWall", x: 68.88, z: 371, params: { length: 12.25, height: 1.7 } },
  { kind: "compoundWall", x: 75, z: 388.88, rotY: Math.PI / 2, params: { length: 8.25, height: 1.7 } },
  { kind: "compoundWall", x: 45, z: 388.88, rotY: Math.PI / 2, params: { length: 8.25, height: 1.7 } },
  { kind: "trough", x: 60, z: 382 },
  { kind: "compoundWall", x: 85.13, z: 361, params: { length: 12.25, height: 1.7 } },
  { kind: "compoundWall", x: 109, z: 378.88, rotY: Math.PI / 2, params: { length: 8.25, height: 1.7 } },
  { kind: "compoundWall", x: 85.13, z: 383, params: { length: 12.25, height: 1.7 } },
  { kind: "trough", x: 94, z: 372 },
  { kind: "shed", x: 8, z: 376, rotY: Math.PI / 2 },
  // ===== the roadside ==============================================================
  // The power line, the burnt-out vehicles along the two highways and the
  // checkpoints between them. The wrecks are placed ON the verge rather
  // than in the carriageway on purpose: a wreck across a road is cover on
  // the one line every hull on the map takes, and this map already has four
  // fords to be caught in.
  //
  // THE POLES ARE THE MIDDLE DISTANCE and are worth more than they look.
  // 900 m of play square with quarters in it is 900 m of open ground
  // between them, and open ground with nothing standing on it reads as no
  // distance at all — there is nothing between the body and the haze for
  // the eye to measure against, which is exactly what made this map read as
  // sparse from the air. A line of poles at a known pitch is the cheapest
  // ruler there is: it states the scale of the ground it crosses and it says
  // which way the road goes from four hundred metres, and it costs no draw
  // call, because every part of it is in the map's own palette and merges
  // into whichever block it stands in. See `buildPylon`, which carries the
  // span AHEAD of each pole, and `poleRun`, which is what stops a refused
  // pole leaving a wire hanging in the air.
  { kind: "pylon", x: -80, z: -414, rotY: -Math.PI / 2, params: { height: 9.17, length: 46 } },
  { kind: "pylon", x: -80, z: -368, rotY: -Math.PI / 2, params: { height: 8, length: 46 } },
  { kind: "pylon", x: -80, z: -322, rotY: -Math.PI / 2, params: { height: 9.02, length: 46 } },
  { kind: "pylon", x: -80, z: -276, rotY: -Math.PI / 2, params: { height: 7.85, length: 56 } },
  { kind: "pylon", x: -80, z: -220, rotY: -Math.PI / 2, params: { height: 8.85 } },
  { kind: "pylon", x: -80, z: -138, rotY: -Math.PI / 2, params: { height: 9.07, length: 31 } },
  { kind: "pylon", x: -80, z: -107, rotY: -Math.PI / 2, params: { height: 8.71, length: 71 } },
  { kind: "pylon", x: -80, z: -36, rotY: -Math.PI / 2, params: { height: 8.38, length: 36 } },
  { kind: "pylon", x: -80, z: 0, rotY: -Math.PI / 2, params: { height: 7.85, length: 46 } },
  { kind: "pylon", x: -80, z: 46, rotY: -Math.PI / 2, params: { height: 8.62, length: 46 } },
  { kind: "pylon", x: -80, z: 92, rotY: -Math.PI / 2, params: { height: 8.25, length: 46 } },
  { kind: "pylon", x: -80, z: 138, rotY: -Math.PI / 2, params: { height: 8.96, length: 46 } },
  { kind: "pylon", x: -80, z: 184, rotY: -Math.PI / 2, params: { height: 8.15, length: 46 } },
  { kind: "pylon", x: -80, z: 230, rotY: -Math.PI / 2, params: { height: 8.57 } },
  { kind: "pylon", x: -80, z: 322, rotY: -Math.PI / 2, params: { height: 7.82, length: 46 } },
  { kind: "pylon", x: -80, z: 368, rotY: -Math.PI / 2, params: { height: 9.14, length: 46 } },
  { kind: "pylon", x: -80, z: 414, rotY: -Math.PI / 2, params: { height: 7.84 } },
  { kind: "pylon", x: 204, z: -414, rotY: -Math.PI / 2, params: { height: 9.09, length: 46 } },
  { kind: "pylon", x: 204, z: -368, rotY: -Math.PI / 2, params: { height: 7.98, length: 46 } },
  { kind: "pylon", x: 204, z: -322, rotY: -Math.PI / 2, params: { height: 7.83, length: 46 } },
  { kind: "pylon", x: 204, z: -276, rotY: -Math.PI / 2, params: { height: 9.05, length: 56 } },
  { kind: "pylon", x: 204, z: -220, rotY: -Math.PI / 2, params: { height: 8.69, length: 36 } },
  { kind: "pylon", x: 204, z: -184, rotY: -Math.PI / 2, params: { height: 8.99 } },
  { kind: "pylon", x: 204, z: 0, rotY: -Math.PI / 2, params: { height: 7.89, length: 46 } },
  { kind: "pylon", x: 204, z: 46, rotY: -Math.PI / 2, params: { height: 8.41, length: 46 } },
  { kind: "pylon", x: 204, z: 92, rotY: -Math.PI / 2, params: { height: 9.01, length: 46 } },
  { kind: "pylon", x: 204, z: 138, rotY: -Math.PI / 2, params: { height: 8.56, length: 46 } },
  { kind: "pylon", x: 204, z: 184, rotY: -Math.PI / 2, params: { height: 9.16, length: 46 } },
  { kind: "pylon", x: 204, z: 230, rotY: -Math.PI / 2, params: { height: 9.04, length: 46 } },
  { kind: "pylon", x: 204, z: 276, rotY: -Math.PI / 2, params: { height: 9.11, length: 46 } },
  { kind: "pylon", x: 204, z: 322, rotY: -Math.PI / 2, params: { height: 8.86, length: 46 } },
  { kind: "pylon", x: 204, z: 368, rotY: -Math.PI / 2, params: { height: 8.77, length: 46 } },
  { kind: "pylon", x: 204, z: 414, rotY: -Math.PI / 2, params: { height: 8.19 } },
  { kind: "pylon", x: -353, z: 44, params: { height: 9.12, length: 26 } },
  { kind: "pylon", x: -327, z: 44, params: { height: 8.47, length: 51 } },
  { kind: "pylon", x: -276, z: 44, params: { height: 7.92, length: 46 } },
  { kind: "pylon", x: -230, z: 44, params: { height: 8.46 } },
  { kind: "pylon", x: -138, z: 44, params: { height: 8.74, length: 46 } },
  { kind: "pylon", x: -92, z: 44, params: { height: 9.2, length: 46 } },
  { kind: "pylon", x: -46, z: 44, params: { height: 8.35 } },
  { kind: "pylon", x: 92, z: 44, params: { height: 8.07, length: 46 } },
  { kind: "pylon", x: 138, z: 44, params: { height: 9.12, length: 41 } },
  { kind: "pylon", x: 179, z: 44, params: { height: 7.93 } },
  { kind: "pylon", x: 230, z: 44, params: { height: 8.99, length: 46 } },
  { kind: "pylon", x: 276, z: 44, params: { height: 8.36, length: 51 } },
  { kind: "pylon", x: 327, z: 44, params: { height: 8.07, length: 41 } },
  { kind: "pylon", x: 368, z: 44, params: { height: 8.92, length: 46 } },
  { kind: "pylon", x: 414, z: 44, params: { height: 9 } },
  { kind: "car", x: 176.55, z: -70.31, rotY: Math.PI, params: { tint: "#6b463a" } },
  { kind: "car", x: -80.12, z: 168.63, params: { tint: "#3f4b52" } },
  { kind: "car", x: -80.49, z: -252.77, rotY: Math.PI / 2, params: { tint: "#4a4f45" } },
  { kind: "car", x: -51.97, z: 68.58, rotY: Math.PI, params: { tint: "#4a4f45" } },
  { kind: "car", x: 175.99, z: 306.79, rotY: Math.PI, params: { tint: "#3f4b52" } },
  { kind: "car", x: 205.74, z: -160.31, rotY: Math.PI, params: { tint: "#3f4b52" } },
  { kind: "car", x: 204.56, z: -143.63, rotY: Math.PI, params: { tint: "#2f3338" } },
  { kind: "car", x: -81.92, z: 102.33, rotY: Math.PI / 2, params: { tint: "#3f4b52" } },
  { kind: "car", x: 205.95, z: 83.24, rotY: Math.PI, params: { tint: "#2f3338" } },
  { kind: "car", x: 178.41, z: 393.5, rotY: Math.PI / 2, params: { tint: "#4a4f45" } },
  { kind: "car", x: -78.63, z: -264.8, params: { tint: "#5d4a3a" } },
  { kind: "car", x: -80.02, z: 289.42, params: { tint: "#2f3338" } },
  { kind: "car", x: -54.65, z: 275.25, rotY: -Math.PI / 2, params: { tint: "#3f4b52" } },
  { kind: "car", x: 174.48, z: 374.64, rotY: Math.PI / 2, params: { tint: "#5d4a3a" } },
  { kind: "car", x: 177.52, z: -261.17, rotY: -Math.PI / 2, params: { tint: "#4a4f45" } },
  { kind: "car", x: 177.8, z: -152.23, rotY: -Math.PI / 2, params: { tint: "#6b463a" } },
  { kind: "car", x: 204.16, z: -343.24, rotY: Math.PI / 2, params: { tint: "#5d4a3a" } },
  { kind: "car", x: -51.82, z: 137.91, rotY: Math.PI, params: { tint: "#2f3338" } },
  { kind: "barrier", x: -52.1, z: 108.2, rotY: Math.PI / 2, params: { length: 6 } },
  { kind: "barrier", x: 201.67, z: 160.1, rotY: Math.PI / 2, params: { length: 6 } },
  { kind: "barrier", x: -77.61, z: 338.69, rotY: Math.PI / 2, params: { length: 6 } },
  { kind: "barrier", x: 177.54, z: -143.7, rotY: Math.PI / 2, params: { length: 6 } },
  { kind: "barrier", x: 203.92, z: 175.25, rotY: Math.PI / 2, params: { length: 6 } },
  { kind: "barrier", x: 177.82, z: 270.53, rotY: Math.PI / 2, params: { length: 6 } },
  { kind: "barrier", x: -54.58, z: 146.11, rotY: Math.PI / 2, params: { length: 6 } },
  { kind: "barrier", x: 176.7, z: -191.14, rotY: Math.PI / 2, params: { length: 6 } },
  { kind: "barrier", x: 177.22, z: 325.15, rotY: Math.PI / 2, params: { length: 6 } },
];

/**
 * Dressing. Every region below has been checked against the road extents at the
 * top of `placements`; a road rejects only what is ROOTED, and rubble, cones
 * and litter are exactly what belongs on one. Blocking props are
 * held off every flag, spawn and hardstanding by `MapBuilder.keepClear`, and
 * the clearances here come from `PROP_BODIES` rather than from these numbers.
 *
 * The town has ONE tree and it grows where the water is. Everything else that
 * stands up out here is dead: thorn scrub, drifted boulders, and the rubble
 * every shelled plot is dressed with.
 */
const scatter: ScatterSpec[] = [
  { prop: "gravestone", x: -186, z: 250, width: 84, depth: 40, count: 48, scale: [0.8, 1.25], blocking: true, clearance: 0.6 },
  { prop: "rubble", x: -264, z: 74, radius: 11, count: 4, scale: [0.8, 1.25], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: -168, z: 74, radius: 11, count: 4, scale: [0.8, 1.25], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: -136, z: 106, radius: 11, count: 4, scale: [0.8, 1.25], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: -2, z: 104, radius: 11, count: 4, scale: [0.8, 1.25], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: 158, z: 136, radius: 11, count: 4, scale: [0.8, 1.25], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: 30, z: 168, radius: 11, count: 4, scale: [0.8, 1.25], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: 158, z: 168, radius: 11, count: 4, scale: [0.8, 1.25], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: -151, z: 247, radius: 9, count: 3, scale: [0.8, 1.2], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: 41, z: 247, radius: 11, count: 4, scale: [0.8, 1.25], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: 73, z: 247, radius: 9, count: 3, scale: [0.8, 1.2], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: -215, z: 279, radius: 11, count: 4, scale: [0.8, 1.25], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: -87, z: 279, radius: 11, count: 4, scale: [0.8, 1.25], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: -55, z: 279, radius: 11, count: 4, scale: [0.8, 1.25], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: 41, z: 279, radius: 11, count: 4, scale: [0.8, 1.25], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: -183, z: 311, radius: 9, count: 3, scale: [0.8, 1.2], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: -151, z: 311, radius: 9, count: 3, scale: [0.8, 1.2], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: -87, z: 311, radius: 9, count: 3, scale: [0.8, 1.2], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: -55, z: 311, radius: 9, count: 3, scale: [0.8, 1.2], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: 105, z: 311, radius: 11, count: 4, scale: [0.8, 1.25], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: 285, z: 116, radius: 11, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: 221, z: 148, radius: 11, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: 253, z: 148, radius: 11, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: 285, z: 148, radius: 11, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 1.1 },
  { prop: "barrel", x: -142, z: -178, radius: 14, count: 9, scale: [0.9, 1.15], blocking: true, clearance: 0.55 },
  { prop: "barrel", x: -94, z: -204, radius: 12, count: 7, scale: [0.9, 1.15], blocking: true, clearance: 0.55 },
  { prop: "fireDrum", x: -174, z: -192, radius: 3, count: 1, blocking: true, clearance: 0.6 },
  { prop: "rubble", x: 80, z: -171, radius: 11, count: 4, scale: [0.8, 1.25], blocking: true, clearance: 1.1 },
  { prop: "palm", x: 99, z: -310, radius: 9, count: 3, scale: [0.9, 1.15], blocking: true, clearance: 3.0 },
  { prop: "palm", x: -153, z: 338, radius: 9, count: 3, scale: [0.9, 1.15], blocking: true, clearance: 3.0 },
  { prop: "palm", x: 333, z: -204, radius: 9, count: 3, scale: [0.9, 1.15], blocking: true, clearance: 3.0 },
  { prop: "barrel", x: 268, z: -60, radius: 20, count: 9, scale: [0.9, 1.15], blocking: true, clearance: 1.2 },
  { prop: "rubble", x: 268, z: -60, radius: 24, count: 12, scale: [0.7, 1.2], clearance: 1.2 },
  // ===== the palm groves ===========================================================
  // Along the wadi, where the water is. A palm screens nothing at head height
  // and everything at fifteen metres, so a grove is a place worth crossing
  // rather than a wall to walk around — and the only cover in the bed is the
  // boles, which is what makes the wadi a route and not a trench.
  { prop: "palm", x: -172, z: -80.2, width: 54, depth: 40, count: 10, scale: [0.85, 1.2], blocking: true, clearance: 2.6 },
  { prop: "palm", x: -110, z: -75, width: 54, depth: 40, count: 11, scale: [0.85, 1.2], blocking: true, clearance: 2.6 },
  { prop: "palm", x: -48, z: -67.1, width: 54, depth: 40, count: 11, scale: [0.85, 1.2], blocking: true, clearance: 2.6 },
  { prop: "palm", x: 14, z: -57.9, width: 54, depth: 40, count: 9, scale: [0.85, 1.2], blocking: true, clearance: 2.6 },
  { prop: "palm", x: 76, z: -49.1, width: 54, depth: 40, count: 11, scale: [0.85, 1.2], blocking: true, clearance: 2.6 },
  { prop: "palm", x: 138, z: -42.2, width: 54, depth: 40, count: 8, scale: [0.85, 1.2], blocking: true, clearance: 2.6 },
  { prop: "palm", x: 200, z: -38.5, width: 54, depth: 40, count: 9, scale: [0.85, 1.2], blocking: true, clearance: 2.6 },
  { prop: "palm", x: -175, z: -80.4, radius: 26, count: 8, scale: [0.85, 1.15], blocking: true, clearance: 2.6 },
  { prop: "palm", x: 196, z: -38.6, radius: 26, count: 8, scale: [0.85, 1.15], blocking: true, clearance: 2.6 },
  { prop: "palm", x: -174, z: 154, radius: 9, count: 3, scale: [1.0, 1.2], blocking: true, clearance: 3.0 },
  { prop: "palm", x: 32, z: 106, radius: 8, count: 3, scale: [1.0, 1.2], blocking: true, clearance: 3.0 },
  // ===== the dead ground ===========================================================
  // The open desert between the quarters, and it is dressed on a GRID
  // rather than by hand for the reason every other bulk pass in this file
  // is: ten authored patches over 810,000 square metres is one patch every
  // three hundred metres, which from the ground is bare sand with an
  // occasional bush in it — and bare sand with an occasional bush in it is
  // what made this map read as unfinished. A 62 m lattice with a character
  // drawn per cell covers the same ground at a density the eye reads as
  // continuous while leaving one cell in eight EMPTY, which is what keeps a
  // desert a desert: what is wanted is ground that goes somewhere, not
  // ground that is full.
  //
  // **Almost all of it is non-blocking, and that is the budget.** A prop
  // with no collider emits no `WorldBox`, costs no ray, no nav cell and no
  // cover query, and its geometry merges into whichever 96 m block it
  // stands in — so the whole of this pass is VERTICES in meshes that were
  // already being drawn, and `WorldCulling` drops them past `fogEnd` with
  // the block they belong to. The one kind that does block is the stone
  // field, deliberately: an open crossing with nothing to get behind is a
  // crossing nobody makes twice, and the boulders are the only cover on it.
  //
  // Held off the carriageways by hand, because `blocking` and `boulder`
  // between them are the case the builder cannot cover: it sows nothing
  // ROOTED on a road, and a boulder is not rooted.
  { prop: "deadTree", x: -365, z: -369, radius: 18, count: 3, scale: [0.7, 1.15], blocking: true, clearance: 1.4 },
  { prop: "bramble", x: -370, z: -361, radius: 26, count: 17, scale: [0.75, 1.4] },
  { prop: "boulder", x: -375, z: -199, radius: 17, count: 6, scale: [0.95, 1.5], blocking: true, clearance: 1.0 },
  { prop: "boulder", x: -375, z: -199, radius: 44, count: 15, scale: [0.28, 0.62], clearance: 1.0 },
  { prop: "bramble", x: -383, z: -114, radius: 43, count: 27, scale: [0.7, 1.5] },
  { prop: "bramble", x: -382, z: -60, radius: 41, count: 30, scale: [0.7, 1.5] },
  { prop: "boulder", x: -372, z: 76, radius: 39, count: 18, scale: [0.28, 0.66], clearance: 1.0 },
  { prop: "bramble", x: -388, z: 80, radius: 24, count: 8, scale: [0.7, 1.35] },
  { prop: "boulder", x: -366, z: 131, radius: 36, count: 20, scale: [0.28, 0.66], clearance: 1.0 },
  { prop: "boulder", x: -370, z: 175, radius: 45, count: 19, scale: [0.28, 0.66], clearance: 1.0 },
  { prop: "deadTree", x: -358, z: 246, radius: 20, count: 5, scale: [0.7, 1.15], blocking: true, clearance: 1.4 },
  { prop: "bramble", x: -372, z: 232, radius: 28, count: 12, scale: [0.75, 1.4] },
  { prop: "boulder", x: -378, z: 307, radius: 36, count: 20, scale: [0.28, 0.66], clearance: 1.0 },
  { prop: "bramble", x: -365, z: 317, radius: 21, count: 10, scale: [0.7, 1.35] },
  { prop: "bramble", x: -386, z: 377, radius: 46, count: 27, scale: [0.7, 1.5] },
  { prop: "boulder", x: -299, z: -60, radius: 44, count: 22, scale: [0.28, 0.66], clearance: 1.0 },
  { prop: "bramble", x: -287, z: -52, radius: 21, count: 10, scale: [0.7, 1.35] },
  { prop: "boulder", x: -323, z: 321, radius: 44, count: 19, scale: [0.28, 0.66], clearance: 1.0 },
  { prop: "bramble", x: -317, z: 318, radius: 24, count: 14, scale: [0.7, 1.35] },
  { prop: "bramble", x: -320, z: 375, radius: 35, count: 19, scale: [0.7, 1.5] },
  { prop: "boulder", x: -236, z: -380, radius: 43, count: 25, scale: [0.28, 0.66], clearance: 1.0 },
  { prop: "boulder", x: -256, z: -302, radius: 21, count: 7, scale: [0.95, 1.5], blocking: true, clearance: 1.0 },
  { prop: "boulder", x: -256, z: -302, radius: 43, count: 18, scale: [0.28, 0.62], clearance: 1.0 },
  { prop: "boulder", x: -257, z: -255, radius: 16, count: 6, scale: [0.95, 1.5], blocking: true, clearance: 1.0 },
  { prop: "boulder", x: -257, z: -255, radius: 43, count: 18, scale: [0.28, 0.62], clearance: 1.0 },
  { prop: "boulder", x: -261, z: -177, radius: 37, count: 19, scale: [0.28, 0.66], clearance: 1.0 },
  { prop: "bramble", x: -242, z: -133, radius: 46, count: 26, scale: [0.7, 1.5] },
  { prop: "bramble", x: -248, z: -54, radius: 39, count: 24, scale: [0.7, 1.5] },
  { prop: "bramble", x: -238, z: 3, radius: 42, count: 22, scale: [0.7, 1.5] },
  { prop: "bramble", x: -257, z: 363, radius: 36, count: 24, scale: [0.7, 1.5] },
  { prop: "boulder", x: -185, z: -367, radius: 43, count: 17, scale: [0.28, 0.66], clearance: 1.0 },
  { prop: "deadTree", x: -184, z: -304, radius: 22, count: 4, scale: [0.7, 1.15], blocking: true, clearance: 1.4 },
  { prop: "bramble", x: -197, z: -302, radius: 27, count: 17, scale: [0.75, 1.4] },
  { prop: "boulder", x: -181, z: -136, radius: 23, count: 6, scale: [0.95, 1.5], blocking: true, clearance: 1.0 },
  { prop: "boulder", x: -181, z: -136, radius: 35, count: 18, scale: [0.28, 0.62], clearance: 1.0 },
  { prop: "boulder", x: -179, z: -61, radius: 40, count: 26, scale: [0.28, 0.66], clearance: 1.0 },
  { prop: "bramble", x: -195, z: -72, radius: 21, count: 13, scale: [0.7, 1.35] },
  { prop: "boulder", x: -201, z: 383, radius: 22, count: 4, scale: [0.95, 1.5], blocking: true, clearance: 1.0 },
  { prop: "boulder", x: -201, z: 383, radius: 38, count: 17, scale: [0.28, 0.62], clearance: 1.0 },
  { prop: "bramble", x: -133, z: -360, radius: 43, count: 28, scale: [0.7, 1.5] },
  { prop: "boulder", x: -134, z: -296, radius: 35, count: 18, scale: [0.28, 0.66], clearance: 1.0 },
  { prop: "bramble", x: -143, z: -302, radius: 24, count: 9, scale: [0.7, 1.35] },
  { prop: "bramble", x: -124, z: -256, radius: 41, count: 22, scale: [0.7, 1.5] },
  { prop: "boulder", x: -134, z: -138, radius: 37, count: 22, scale: [0.28, 0.66], clearance: 1.0 },
  { prop: "bramble", x: -124, z: -74, radius: 45, count: 22, scale: [0.7, 1.5] },
  { prop: "boulder", x: -125, z: -5, radius: 16, count: 7, scale: [0.95, 1.5], blocking: true, clearance: 1.0 },
  { prop: "boulder", x: -125, z: -5, radius: 35, count: 18, scale: [0.28, 0.62], clearance: 1.0 },
  { prop: "deadTree", x: -132, z: 364, radius: 20, count: 4, scale: [0.7, 1.15], blocking: true, clearance: 1.4 },
  { prop: "bramble", x: -130, z: 362, radius: 23, count: 10, scale: [0.75, 1.4] },
  { prop: "bramble", x: -12, z: -368, radius: 39, count: 28, scale: [0.7, 1.5] },
  { prop: "boulder", x: -6, z: -298, radius: 43, count: 17, scale: [0.28, 0.66], clearance: 1.0 },
  { prop: "boulder", x: -8, z: -250, radius: 21, count: 4, scale: [0.95, 1.5], blocking: true, clearance: 1.0 },
  { prop: "boulder", x: -8, z: -250, radius: 35, count: 14, scale: [0.28, 0.62], clearance: 1.0 },
  { prop: "boulder", x: 1, z: -116, radius: 37, count: 18, scale: [0.28, 0.66], clearance: 1.0 },
  { prop: "bramble", x: 1, z: -72, radius: 40, count: 30, scale: [0.7, 1.5] },
  { prop: "boulder", x: 14, z: -11, radius: 38, count: 17, scale: [0.28, 0.66], clearance: 1.0 },
  { prop: "bramble", x: 14, z: -4, radius: 22, count: 8, scale: [0.7, 1.35] },
  { prop: "boulder", x: 10, z: 191, radius: 20, count: 6, scale: [0.95, 1.5], blocking: true, clearance: 1.0 },
  { prop: "boulder", x: 10, z: 191, radius: 37, count: 15, scale: [0.28, 0.62], clearance: 1.0 },
  { prop: "deadTree", x: 56, z: -377, radius: 21, count: 3, scale: [0.7, 1.15], blocking: true, clearance: 1.4 },
  { prop: "bramble", x: 63, z: -374, radius: 27, count: 15, scale: [0.75, 1.4] },
  { prop: "boulder", x: 55, z: -304, radius: 42, count: 26, scale: [0.28, 0.66], clearance: 1.0 },
  { prop: "bramble", x: 70, z: -290, radius: 20, count: 15, scale: [0.7, 1.35] },
  { prop: "bramble", x: 74, z: -120, radius: 37, count: 17, scale: [0.7, 1.5] },
  { prop: "bramble", x: 48, z: -67, radius: 37, count: 21, scale: [0.7, 1.5] },
  { prop: "boulder", x: 50, z: 2, radius: 37, count: 21, scale: [0.28, 0.66], clearance: 1.0 },
  { prop: "bramble", x: 63, z: 2, radius: 23, count: 10, scale: [0.7, 1.35] },
  { prop: "boulder", x: 123, z: -361, radius: 34, count: 26, scale: [0.28, 0.66], clearance: 1.0 },
  { prop: "bramble", x: 131, z: -357, radius: 19, count: 11, scale: [0.7, 1.35] },
  { prop: "bramble", x: 134, z: -301, radius: 34, count: 27, scale: [0.7, 1.5] },
  { prop: "boulder", x: 134, z: -252, radius: 34, count: 19, scale: [0.28, 0.66], clearance: 1.0 },
  { prop: "bramble", x: 137, z: -50, radius: 35, count: 19, scale: [0.7, 1.5] },
  { prop: "boulder", x: 129, z: -9, radius: 36, count: 25, scale: [0.28, 0.66], clearance: 1.0 },
  { prop: "bramble", x: 113, z: -18, radius: 19, count: 9, scale: [0.7, 1.35] },
  { prop: "boulder", x: 249, z: -364, radius: 44, count: 14, scale: [0.28, 0.66], clearance: 1.0 },
  { prop: "bramble", x: 255, z: -356, radius: 25, count: 15, scale: [0.7, 1.35] },
  { prop: "bramble", x: 248, z: -318, radius: 36, count: 16, scale: [0.7, 1.5] },
  { prop: "boulder", x: 250, z: -110, radius: 41, count: 17, scale: [0.28, 0.66], clearance: 1.0 },
  { prop: "bramble", x: 258, z: -120, radius: 18, count: 13, scale: [0.7, 1.35] },
  { prop: "boulder", x: 253, z: -50, radius: 21, count: 7, scale: [0.95, 1.5], blocking: true, clearance: 1.0 },
  { prop: "boulder", x: 253, z: -50, radius: 34, count: 13, scale: [0.28, 0.62], clearance: 1.0 },
  { prop: "boulder", x: 237, z: -14, radius: 34, count: 25, scale: [0.28, 0.66], clearance: 1.0 },
  { prop: "bramble", x: 231, z: -29, radius: 21, count: 11, scale: [0.7, 1.35] },
  { prop: "boulder", x: 246, z: 189, radius: 41, count: 20, scale: [0.28, 0.66], clearance: 1.0 },
  { prop: "bramble", x: 248, z: 186, radius: 20, count: 11, scale: [0.7, 1.35] },
  { prop: "boulder", x: 238, z: 234, radius: 18, count: 6, scale: [0.95, 1.5], blocking: true, clearance: 1.0 },
  { prop: "boulder", x: 238, z: 234, radius: 34, count: 20, scale: [0.28, 0.62], clearance: 1.0 },
  { prop: "boulder", x: 242, z: 325, radius: 37, count: 14, scale: [0.28, 0.66], clearance: 1.0 },
  { prop: "boulder", x: 236, z: 379, radius: 38, count: 17, scale: [0.28, 0.66], clearance: 1.0 },
  { prop: "bramble", x: 246, z: 392, radius: 25, count: 12, scale: [0.7, 1.35] },
  { prop: "deadTree", x: 320, z: -375, radius: 18, count: 3, scale: [0.7, 1.15], blocking: true, clearance: 1.4 },
  { prop: "bramble", x: 323, z: -382, radius: 20, count: 12, scale: [0.75, 1.4] },
  { prop: "bramble", x: 300, z: -308, radius: 46, count: 27, scale: [0.7, 1.5] },
  { prop: "boulder", x: 300, z: 52, radius: 22, count: 4, scale: [0.95, 1.5], blocking: true, clearance: 1.0 },
  { prop: "boulder", x: 300, z: 52, radius: 43, count: 18, scale: [0.28, 0.62], clearance: 1.0 },
  { prop: "boulder", x: 381, z: -320, radius: 17, count: 7, scale: [0.95, 1.5], blocking: true, clearance: 1.0 },
  { prop: "boulder", x: 381, z: -320, radius: 36, count: 16, scale: [0.28, 0.62], clearance: 1.0 },
  { prop: "bramble", x: 374, z: -260, radius: 34, count: 30, scale: [0.7, 1.5] },
  { prop: "bramble", x: 370, z: -135, radius: 40, count: 29, scale: [0.7, 1.5] },
  { prop: "bramble", x: 358, z: -55, radius: 43, count: 24, scale: [0.7, 1.5] },
  { prop: "bramble", x: 369, z: -5, radius: 46, count: 16, scale: [0.7, 1.5] },
  { prop: "boulder", x: 367, z: 55, radius: 16, count: 6, scale: [0.95, 1.5], blocking: true, clearance: 1.0 },
  { prop: "boulder", x: 367, z: 55, radius: 43, count: 17, scale: [0.28, 0.62], clearance: 1.0 },
  { prop: "boulder", x: 383, z: 111, radius: 41, count: 17, scale: [0.28, 0.66], clearance: 1.0 },
  { prop: "bramble", x: 388, z: 96, radius: 23, count: 15, scale: [0.7, 1.35] },
  { prop: "boulder", x: 381, z: 241, radius: 34, count: 22, scale: [0.28, 0.66], clearance: 1.0 },
  { prop: "bramble", x: 386, z: 257, radius: 25, count: 14, scale: [0.7, 1.35] },
  { prop: "boulder", x: 364, z: 321, radius: 43, count: 18, scale: [0.28, 0.66], clearance: 1.0 },
  { prop: "bramble", x: 349, z: 307, radius: 26, count: 12, scale: [0.7, 1.35] },
  { prop: "deadTree", x: 380, z: 380, radius: 25, count: 4, scale: [0.7, 1.15], blocking: true, clearance: 1.4 },
  { prop: "bramble", x: 383, z: 375, radius: 25, count: 15, scale: [0.75, 1.4] },
  // ===== the wadi bed ==============================================================
  // Gravel bars and dry thorn down the whole run of the bed, and every
  // region here is NON-BLOCKING without exception. That is the wadi's own
  // rule restated rather than a budget: the bed is a ROUTE, its only cover
  // is the palm boles, and a watercourse you cannot be caught in is not the
  // feature this map put across its middle. What was missing was never
  // cover — it was that 900 m of dry channel had the same bare floor as the
  // open desert either side of it, so nothing said it was a channel at all
  // until you were standing in it.
  //
  // Small stone at a high count is what a bar of shingle is, and it is also
  // the cheapest thing in the prop table: two polyhedra, no collider, no
  // `WorldBox`, no ray and no nav cell.
  { prop: "boulder", x: -400, z: -68.5, width: 54, depth: 38, count: 21, scale: [0.22, 0.55], clearance: 0.9 },
  { prop: "bramble", x: -409.9, z: -79.4, radius: 21, count: 16, scale: [0.6, 1.15] },
  { prop: "boulder", x: -354, z: -72.2, width: 54, depth: 34, count: 30, scale: [0.22, 0.55], clearance: 0.9 },
  { prop: "bramble", x: -345.49, z: -69.5, radius: 22, count: 11, scale: [0.6, 1.15] },
  { prop: "boulder", x: -308, z: -72.6, width: 54, depth: 31, count: 21, scale: [0.22, 0.55], clearance: 0.9 },
  { prop: "boulder", x: -262, z: -74.5, width: 54, depth: 39, count: 26, scale: [0.22, 0.55], clearance: 0.9 },
  { prop: "bramble", x: -261.66, z: -92.2, radius: 24, count: 10, scale: [0.6, 1.15] },
  { prop: "boulder", x: -216, z: -73.1, width: 54, depth: 38, count: 25, scale: [0.22, 0.55], clearance: 0.9 },
  { prop: "bramble", x: -223.77, z: -89.5, radius: 19, count: 10, scale: [0.6, 1.15] },
  { prop: "boulder", x: -170, z: -88.3, width: 54, depth: 36, count: 31, scale: [0.22, 0.55], clearance: 0.9 },
  { prop: "boulder", x: -124, z: -73.8, width: 54, depth: 31, count: 31, scale: [0.22, 0.55], clearance: 0.9 },
  { prop: "boulder", x: -78, z: -63.2, width: 54, depth: 31, count: 33, scale: [0.22, 0.55], clearance: 0.9 },
  { prop: "bramble", x: -64.46, z: -61.8, radius: 17, count: 13, scale: [0.6, 1.15] },
  { prop: "boulder", x: -32, z: -57.9, width: 54, depth: 36, count: 33, scale: [0.22, 0.55], clearance: 0.9 },
  { prop: "bramble", x: -19.65, z: -79.7, radius: 24, count: 14, scale: [0.6, 1.15] },
  { prop: "boulder", x: 14, z: -56.5, width: 54, depth: 26, count: 24, scale: [0.22, 0.55], clearance: 0.9 },
  { prop: "bramble", x: 18.67, z: -63.4, radius: 23, count: 13, scale: [0.6, 1.15] },
  { prop: "boulder", x: 60, z: -47.7, width: 54, depth: 30, count: 20, scale: [0.22, 0.55], clearance: 0.9 },
  { prop: "bramble", x: 73.14, z: -37, radius: 21, count: 16, scale: [0.6, 1.15] },
  { prop: "boulder", x: 106, z: -53.6, width: 54, depth: 27, count: 25, scale: [0.22, 0.55], clearance: 0.9 },
  { prop: "bramble", x: 105.18, z: -50.5, radius: 22, count: 8, scale: [0.6, 1.15] },
  { prop: "boulder", x: 152, z: -45, width: 54, depth: 34, count: 25, scale: [0.22, 0.55], clearance: 0.9 },
  { prop: "bramble", x: 148.64, z: -48.8, radius: 23, count: 8, scale: [0.6, 1.15] },
  { prop: "boulder", x: 198, z: -31.5, width: 54, depth: 40, count: 29, scale: [0.22, 0.55], clearance: 0.9 },
  { prop: "boulder", x: 244, z: -37.4, width: 54, depth: 34, count: 32, scale: [0.22, 0.55], clearance: 0.9 },
  { prop: "boulder", x: 290, z: -38.2, width: 54, depth: 37, count: 24, scale: [0.22, 0.55], clearance: 0.9 },
  { prop: "bramble", x: 279.26, z: -23.5, radius: 16, count: 8, scale: [0.6, 1.15] },
  { prop: "boulder", x: 336, z: -42.7, width: 54, depth: 36, count: 25, scale: [0.22, 0.55], clearance: 0.9 },
  { prop: "bramble", x: 337.19, z: -43.3, radius: 19, count: 14, scale: [0.6, 1.15] },
  { prop: "boulder", x: 382, z: -36.3, width: 54, depth: 33, count: 25, scale: [0.22, 0.55], clearance: 0.9 },
  // ===== the streets ===============================================================
  // Urban clutter, and almost all of it non-blocking on purpose: a prop with
  // no collider emits no `WorldBox` and costs no ray anything, which is what
  // makes a town this size dressable at all. See coldharbour/layout.ts, which
  // is where that argument was measured.
  { prop: "litter", x: 28, z: 66, radius: 60, count: 18, scale: [0.8, 1.3], clearance: 1.2 },
  { prop: "litter", x: -32, z: 106, radius: 46, count: 21, scale: [0.8, 1.3], clearance: 1.2 },
  { prop: "litter", x: 88, z: 26, radius: 46, count: 19, scale: [0.8, 1.3], clearance: 1.2 },
  { prop: "litter", x: -182, z: 150, radius: 50, count: 24, scale: [0.8, 1.3], clearance: 1.2 },
  { prop: "litter", x: 250, z: 140, radius: 66, count: 26, scale: [0.8, 1.3], clearance: 1.2 },
  { prop: "litter", x: 190, z: -114, radius: 40, count: 21, scale: [0.8, 1.3], clearance: 1.2 },
  { prop: "litter", x: -120, z: -180, radius: 46, count: 18, scale: [0.8, 1.3], clearance: 1.2 },
  { prop: "litter", x: -60, z: 200, radius: 50, count: 17, scale: [0.8, 1.3], clearance: 1.2 },
  { prop: "litter", x: 70, z: 220, radius: 50, count: 19, scale: [0.8, 1.3], clearance: 1.2 },
  { prop: "litter", x: -200, z: 210, radius: 44, count: 17, scale: [0.8, 1.3], clearance: 1.2 },
  { prop: "litter", x: -40, z: -200, radius: 46, count: 24, scale: [0.8, 1.3], clearance: 1.2 },
  { prop: "litter", x: 60, z: -190, radius: 42, count: 16, scale: [0.8, 1.3], clearance: 1.2 },
  { prop: "trafficCone", x: -32, z: 106, radius: 32.2, count: 6, scale: [0.9, 1.1], clearance: 1.1 },
  { prop: "trafficCone", x: -182, z: 150, radius: 35, count: 7, scale: [0.9, 1.1], clearance: 1.1 },
  { prop: "trafficCone", x: 250, z: 140, radius: 46.2, count: 7, scale: [0.9, 1.1], clearance: 1.1 },
  { prop: "trafficCone", x: 190, z: -114, radius: 28, count: 7, scale: [0.9, 1.1], clearance: 1.1 },
  { prop: "trafficCone", x: -60, z: 200, radius: 35, count: 7, scale: [0.9, 1.1], clearance: 1.1 },
  { prop: "trafficCone", x: 70, z: 220, radius: 35, count: 7, scale: [0.9, 1.1], clearance: 1.1 },
  { prop: "trafficCone", x: -40, z: -200, radius: 32.2, count: 5, scale: [0.9, 1.1], clearance: 1.1 },
  { prop: "trafficCone", x: 60, z: -190, radius: 29.4, count: 8, scale: [0.9, 1.1], clearance: 1.1 },
  { prop: "palletStack", x: -110, z: -162, radius: 16, count: 3, scale: [0.9, 1.2], blocking: true, clearance: 1.6 },
  { prop: "skip", x: 230, z: 160, radius: 22, count: 3, scale: [0.9, 1.1], blocking: true, clearance: 2.4 },
  { prop: "skip", x: 68, z: 96, radius: 18, count: 2, scale: [0.9, 1.1], blocking: true, clearance: 2.4 },
  { prop: "binPair", x: -16, z: 32, radius: 20, count: 4, scale: [0.9, 1.15], blocking: true, clearance: 1.4 },
  { prop: "binPair", x: -162, z: 110, radius: 18, count: 3, scale: [0.9, 1.15], blocking: true, clearance: 1.4 },
  // ===== the water =================================================================
  // The dates, round the two places on this map where the water is at the
  // surface rather than six feet under it. Held OFF the wet ground by hand —
  // `scatterRegion` stands a prop on the floor and knows nothing about the
  // rects in `water`, so a region drawn across a pool puts palms in it.
  { prop: "palm", x: 216, z: -38.1, radius: 16, count: 6, scale: [0.85, 1.2], blocking: true, clearance: 2.6 },
  { prop: "palm", x: 302, z: -39.5, radius: 16, count: 6, scale: [0.85, 1.2], blocking: true, clearance: 2.6 },
  { prop: "palm", x: -212, z: 46, radius: 10, count: 4, scale: [1.0, 1.25], blocking: true, clearance: 3.0 },
  { prop: "palm", x: -160, z: 46, radius: 10, count: 5, scale: [1.0, 1.25], blocking: true, clearance: 3.0 },
  { prop: "palm", x: -212, z: 94, radius: 10, count: 3, scale: [1.0, 1.25], blocking: true, clearance: 3.0 },
  { prop: "palm", x: -160, z: 94, radius: 10, count: 3, scale: [1.0, 1.25], blocking: true, clearance: 3.0 },
];

const controlPoints: ControlPointDef[] = [
  { id: "A", name: "The Great Mosque", pos: new Vector3(-192, 0, 150), radius: 16 },
  { id: "B", name: "The Fuel Depot", pos: new Vector3(-120, -2.6, -180), radius: 15 },
  { id: "C", name: "The Souk", pos: new Vector3(28, 0, 66), radius: 17 },
  { id: "D", name: "Martyrs' Quarter", pos: new Vector3(250, 7, 140), radius: 16 },
  { id: "E", name: "The Crossing", pos: new Vector3(190, -2.6, -114), radius: 15 },
];

/**
 * Home spawns are uncapturable. Every control point also carries a spawn just
 * outside its capture zone, so deploying onto a flag you hold does not drop you
 * on top of whoever is contesting it. The home yards face each other down the
 * NE-SW diagonal.
 */
const spawns: SpawnPointDef[] = [
  { team: 0, pos: new Vector3(-308, -2.6, -302), yaw: Math.PI / 4 },
  { team: 0, pos: new Vector3(-300, -2.6, -311), yaw: Math.PI / 4 },
  { team: 0, pos: new Vector3(-292, -2.6, -320), yaw: Math.PI / 4 },
  { team: 1, pos: new Vector3(308, 0.02, 302), yaw: -Math.PI * 0.75 },
  { team: 1, pos: new Vector3(300, 0, 311), yaw: -Math.PI * 0.75 },
  { team: 1, pos: new Vector3(292, 0, 320), yaw: -Math.PI * 0.75 },
  { team: null, controlPoint: "A", pos: new Vector3(-156, 0, 140), yaw: -Math.PI / 2 },
  { team: null, controlPoint: "B", pos: new Vector3(-114, -2.6, -146), yaw: Math.PI },
  { team: null, controlPoint: "C", pos: new Vector3(22, 0.01, 28), yaw: 0 },
  { team: null, controlPoint: "D", pos: new Vector3(242, 7, 102), yaw: 0 },
  { team: null, controlPoint: "E", pos: new Vector3(184, -2.6, -154), yaw: 0 },
];

/**
 * THREE hardstandings a side, in each home yard: a tank on the inner edge, a
 * gun truck behind it and a helicopter across the yard from both.
 *
 * **The respawn is per hardstanding, so the number of entries here IS how many
 * vehicles a side can ever have on the field** — and it is also what turns the
 * kit's third slot on (`Game.armourOffered`), so this is the map's
 * launcher-and-mine map as well as its vehicle one.
 *
 * A 900 m play square is what earns them. The ground between the flags is
 * transit rather than fighting, which is exactly the problem a vehicle exists
 * to answer — and the town answers back: the old town's alleys are seven
 * metres wide and a TANK cannot turn in one, the wadi's fords are three places
 * a driver is committed and slow, and the Crossing is a flag a hull can shell
 * from outside and never take.
 *
 * **The TRUCK is the answer to the half of that the tank cannot have.** It is
 * 65 km/h against the tank's 40, so it crosses the transit ground in two
 * thirds of the time; it fits through 3.2 m against the tank's 4.4, so those
 * seven-metre alleys are open to it; and it climbs 0.55 m against 1.25, so the
 * rubble and the parked cars the tank drives over are things it has to go
 * round. What it pays is everything else: 520 points against 1200 at nine
 * times the small-arms damage, and no cannon at all.
 *
 * **Where the truck's pad is was decided by `crew.boardRadius` and not by the
 * geometry.** A bot is never given a vehicle as a destination, so a
 * hardstanding nobody walks within 18 m of never gets crewed — which the first
 * version of this was, and both trucks sat still for a whole round while the
 * tanks drove 200 m. It stands 14.6 m from the nearest infantry spawn and 31.6
 * from its own team's tank, so a reinforcement leaving the yard is inside one
 * circle or the other from the frame it deploys.
 *
 * The rest is what any hardstanding owes (see `docs/vehicles.md`): the ground
 * is level to 1.1 cm across the whole footprint — and dead level, to 0.0 cm,
 * across the helicopter's whole 10.4 m disc — the nearest structure over
 * 35 cm is 24 m away, and the departure bearing runs 90 m out of the yard
 * through a corridor never narrower than 9.1 m at a gradient never over 0.14 —
 * well inside `climbSlope`, and nearly three times `collideRadius * 2`.
 *
 * **The HELICOPTER is the answer to the half of it NEITHER ground vehicle can
 * have**, which on a 900 m square is the wadi and the high ground: the fords
 * are the three places a hull may cross and are therefore the three places
 * worth watching, and the ridges are ground no hull reaches at all. It crosses
 * both in a straight line at 32 m/s — nearly twice the truck's road speed — and
 * it puts a gun over the Crossing, which is the one flag a hull can shell from
 * outside and never take.
 *
 * What it pays is everything a fast thing pays and three things more. It has no
 * cannon and its only weapon is the CHIN gun the SECOND man lays, so a lone
 * pilot has flown a taxi to the fight. Its rotor disc is 10.4 m across, which
 * closes the old town to it outright — the alleys that are a truck's ground and
 * not a tank's are not an aircraft's either. And it is FRAGILE: a rifle does
 * 70% of its damage to it against the tank's 5%, and it cannot climb out of
 * trouble, because `flight.ceiling` is 40 m and the bots' own engagement range
 * is 55 — which is deliberate, and is the whole of what keeps a machine nothing
 * on the ground can catch from being one nothing on the ground can answer.
 *
 * **No bot will ever fly one**, so unlike the other four pads this one is idle
 * until a player walks to it. Its circle is sized for the other half of that
 * rule: a bot may take the DOOR GUN, but only once somebody is already at the
 * controls, so 23.3 m to the nearest infantry spawn is there to put a gunner in
 * the back of a machine that is about to leave rather than to get a parked one
 * crewed.
 *
 * **It is also the only thing on this map that costs the AUTHORITY anything
 * that grows with the extent.** A DRIVEN hull is a `moveWithCollisions`
 * against every collidable mesh in the map, measured at 0.40 ms a tick at this
 * size against 0.039 on Coldharbour (`FINDINGS.md` 31), and only the ones
 * somebody is actually driving cost anything at all. Measured over a whole
 * headless round with all four crewed for most of it, the tick's median went
 * from 0.27 ms to 0.64 — 3.8% of the 16.67 ms budget, with nothing over it.
 */
const vehicles: VehicleSpawnDef[] = [
  { team: 0, pos: new Vector3(-292, -2.6, -316), yaw: Math.PI / 4 },
  { team: 0, pos: new Vector3(-322, -2.6, -306), yaw: Math.PI / 4, kind: "truck" },
  { team: 0, pos: new Vector3(-312, -2.6, -332), yaw: Math.PI / 4, kind: "heli" },
  { team: 1, pos: new Vector3(292, 0, 316), yaw: -Math.PI * 0.75 },
  { team: 1, pos: new Vector3(322, 0, 306), yaw: -Math.PI * 0.75, kind: "truck" },
  { team: 1, pos: new Vector3(312, 0, 332), yaw: -Math.PI * 0.75, kind: "heli" },
];

const water: WaterRect[] = [
  // **The wadi is dry except where it is not**, which is what a dry
  // watercourse is and is the second answer this map gave to the question.
  // The first was Harrowmead's — one rect the length of the run, floated over
  // a carved bed — and it came back as a pale membrane, because everything
  // inside `CONFIG.water`'s shoreline band draws as shore and a sheet
  // stretched along a meander is nothing else. See `POOLS` in the generator,
  // which carries that argument and cuts the basins these sit in.
  //
  // Every number below is MEASURED off the floor rather than authored — the
  // surface is a stated depth over the deepest point of each basin and the
  // rect is the wet bounding box plus a margin of dry bed for the shoreline
  // to be drawn on. Re-running the generator re-derives them.
  { x: -199.5, z: -81.26, width: 75, depth: 40.5, y: -6 },
  { x: 59, z: -51.46, width: 78, depth: 40.5, y: -5.64 },
  { x: 259.75, z: -38.07, width: 52.5, depth: 39, y: -6.23 },
  // The birkat: the mosque quarter's reservoir, and the only water in the
  // town itself. Its basin is dug 2.7 m into flat district ground, so this is
  // the one body on the map whose whole area is out of the shore band.
  { x: -186.25, z: 70.25, width: 54.5, depth: 51.5, y: -0.45 },
];

const grass: GrassRect[] = [
  // Dry scrub, and a BUDGET rather than a blanket: the field is one mesh of
  // thin instances with NO culling inside it, so the cost is the whole tuft
  // count wherever the camera stands — which is the one thing on this map
  // that is not paid for by distance and is why the number is stated here.
  // ~17,400, against Harrowmead's ~23,000 on a fifth of the ground.
  //
  // A desert should be BARE, so what these are for is the ground that is
  // not: the wadi's whole run at two densities (see the loop — the middle
  // is where the pools are and the ends are drier), the birkat's margins,
  // and five low patches on the open desert. The rects along the bed run
  // straight over the three pools, which is deliberate: an opaque body
  // hides every tuft standing in it, so what is left of a rect crossing a
  // pool is the ring of it on the shore.
  { x: -358, z: -77.1, width: 58, depth: 46, density: 0.22 },
  { x: -296, z: -80.8, width: 58, depth: 46, density: 0.22 },
  { x: -234, z: -82.1, width: 58, depth: 46, density: 0.22 },
  { x: -172, z: -80.2, width: 58, depth: 46, density: 0.4 },
  { x: -110, z: -75, width: 58, depth: 46, density: 0.4 },
  { x: -48, z: -67.1, width: 58, depth: 46, density: 0.4 },
  { x: 14, z: -57.9, width: 58, depth: 46, density: 0.4 },
  { x: 76, z: -49.1, width: 58, depth: 46, density: 0.4 },
  { x: 138, z: -42.2, width: 58, depth: 46, density: 0.4 },
  { x: 200, z: -38.5, width: 58, depth: 46, density: 0.4 },
  { x: 262, z: -38.1, width: 58, depth: 46, density: 0.22 },
  { x: 324, z: -40.7, width: 58, depth: 46, density: 0.22 },
  { x: 386, z: -45, width: 58, depth: 46, density: 0.22 },
  { x: -186, z: 90, width: 50, depth: 16, density: 0.5 },
  { x: -186, z: 50, width: 50, depth: 16, density: 0.5 },
  { x: -198, z: 242, width: 80, depth: 44, density: 0.3 },
  { x: -300, z: 24, width: 70, depth: 60, density: 0.16 },
  { x: 120, z: 40, width: 80, depth: 70, density: 0.16 },
  { x: -60, z: 330, width: 110, depth: 60, density: 0.14 },
  { x: 300, z: -60, width: 90, depth: 80, density: 0.14 },
  { x: 30, z: -350, width: 120, depth: 60, density: 0.14 },
];

export const SarabLayout: MapLayout = {
  placements,
  scatter,
  controlPoints,
  spawns,
  vehicles,
  water,
  grass,
  /**
   * The play square. `heights.size * heights.cell` equals it (225 x 4), the
   * rim's boundary boxes stay well over 200 m, and the heightfield grew with
   * the square rather than getting coarser — the three things `MapLayout.size`
   * says a larger map owes.
   */
  size: 900,
  /**
   * Five, because this town genuinely stacks: the ground, two floors and a roof
   * inside a shelled block, and a parapet or a rubble heap over one of them.
   * Overflow is a SILENT drop in arrival order, which is why every builder in
   * kit/desert.ts emits plinth, flights, slabs, walls, roof, parapet — in that
   * order — and why the fifth slot here is margin rather than need.
   */
  surfaces: 5,
  /**
   * **Twenty-four a side — the one lever on this list that is BODIES rather
   * than metres**, and it is stated for CONTACT rather than for size. Sixteen
   * over 810,000 m^2 of play is one body per 51,000 of it, and
   * `ENGINE_UPGRADE.md` S10 measured what that does to a round: five of eleven
   * headless rounds ran the full 45-minute cap with tickets left on both
   * sides, against 13-18 minutes on every shipped map, at a peak contact of
   * 5-7 of 16 bots against 10-14. A bigger map does not need more bots because
   * it is bigger; it needs them because a round is made of contact and contact
   * is bodies per square metre.
   *
   * It is `CONFIG.bots.maxPerTeam` exactly, so it is the most a layout may ask
   * for, and what it buys is paid in RIGS on every frame of the round. Three
   * things follow it for free — six squads a side rather than two
   * (`CONFIG.bots.squadSize`), a launcher in each of them
   * (`antiTankBots.perSquad`) and a row per pool slot on the board — and
   * `CONFIG.conquest.tickets` deliberately does not, which is what makes this
   * a SHORTER round as well as a denser one. **It reaches a match too**:
   * `HeadlessGame.startRound` pushes it through `BattleSystem.setFielded`, so
   * Sarab is twenty-four a side online as well as off, while the SEATS stay at
   * sixteen on every map (`Roster.HUMANS_PER_TEAM`).
   */
  perTeam: 24,
  /**
   * **The two S6 numbers, and this is the map they were made the map's for.**
   * At the default 48 m a 1500 m map is a 32 x 32 grid of merge blocks — 1,024
   * meshes for `_evaluateActiveMeshes` to walk and `WorldCulling` to file a
   * cell for, and one cube probe per glazed block for the reflection bake to
   * drain through. Measured on the 900/300 proving ground, moving both to 96
   * was **33% of the frame and 42% of the install**: 1,597 drawn map meshes
   * became 653, and 265 glazed blocks became 94. What it costs is cull
   * granularity — a coarser block draws more that is off screen — and on a town
   * whose buildings are eight to twenty metres across, a 96 m block is still
   * a dozen of them rather than one. See `FINDINGS.md` 29 and S6.
   *
   * They are two fields because they answer different questions, and this map
   * happens to want the same answer to both: the merge's is draw calls, and the
   * floor's is triangles per patch over a 4 m heightfield cell.
   */
  blockSize: 96,
  terrainBlock: 96,
  /**
   * **No wall.** The desert carries on for 300 m past the play square and what
   * stops you is the leash — a countdown rather than a shape. See
   * `Borderland`, and `world/leash.ts` for the rule.
   *
   * 300 m is set by what it is FOR rather than by the leash, which is the
   * opposite of Harrowmead's 80. `CONFIG.map.leash.seconds` is ten and a
   * sprint is 6.9 m/s, so a player who turns and runs dies 69 m out — any
   * margin over about 80 is invisible to a living player and this is nearly
   * four times it. What the rest of it buys is the HORIZON: at 560 m of haze
   * the play square's own boundary is inside the view from every quarter, so
   * without ground past it the town would stand on a plate with the sky under
   * its edges. 300 m is what puts the fog wall out over open desert instead.
   *
   * It is deliberately BARE past the smallholdings — the outskirts stop at
   * about 415 m and nothing is authored outside the square at all — which buys
   * a cue the HUD cannot give: the dressing thinning out is the first thing you
   * notice about leaving, a beat before the countdown starts shouting.
   * Anything out there would also be a collider outside the nav grid, which is
   * geometry the bots can neither see nor route around.
   */
  borderland: { margin: 300, roll: 3.2 },
  /**
   * `form: "downs"` because `borderland` is stated, and the two are a pair
   * rather than a choice: an escarpment's basal band is a vertical face flush
   * with a collider plane, and on an open boundary there is nothing within a
   * margin's width for it to be flush with.
   *
   * What stands out there is the rim of the basin the town sits in — low, dry
   * hills at ±750, rising 60 to 90 m over 150 m of run. Gentler than
   * Harrowmead's downs and much further away, because the whole point of the
   * 300 m margin is that the boundary is scenery rather than architecture: at
   * this distance the rim is drawn almost entirely in `fogColor` and its job is
   * to be a horizon line rather than a landform.
   *
   * Four passes, one for each road that leaves the basin.
   */
  ridge: {
    form: "downs",
    slope: 0.115,
    slopeVariance: 0.028,
    passes: [
      { x: 0, z: -750, width: 44 },
      { x: 0, z: 750, width: 44 },
      { x: -750, z: 22, width: 40 },
      { x: 750, z: 22, width: 40 },
    ],
    seed: 0x53415242,
  },
  // Fixed so the dressing — and the colliders blocking scatter emits, and so
  // the nav graph — is identical on every boot. Changing it rerolls the whole
  // scatter field, which is a visible change to the level: re-walk the flags.
  seed: 0x53415241,
};
