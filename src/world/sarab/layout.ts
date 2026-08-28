/**
 * sarab/layout.ts — THE MAP, as data: structure placements, scatter regions,
 * control points, spawns, the hardstandings and the scrub. The wadi is DRY
 * and this file declares no water at all — see scripts/generate-sarab.mjs,
 * which carries the argument.
 * The floor's shape is generated data and lives in heights.ts. Consumed by
 * MapBuilder; nothing here is code to special-case.
 * Gotchas that have already cost time: collider top faces within
 * CONFIG.nav.stepHeight of adjacent ground or bots treat decks as walls; a
 * control point's pos must NOT sit inside a PLACEMENT's collider (surfaceAt
 * returns -1 — scatter is held off flags and spawns by `MapBuilder.keepClear`,
 * placements are not); scatter regions must dodge the roads by hand, because a
 * road is visual-only and rejects nothing; terrain steeper than a 0.4 gradient
 * severs its own nav links.
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
 * and it is DRY: there is no `water` on this map at all.
 * **The SHELF** stands 7 m over the town in the north-east and the Martyrs'
 * Quarter is on it — a 0.082 gradient up an 85 m skirt, which is a slope you
 * climb without noticing and a quarter that looks down every street in the old
 * town. **Everything else is dunes**, a couple of metres of swell, flattened
 * dead level under each quarter because a placement samples the ground once at
 * its own centre and a building on a grade floats at one corner.
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
 *   in `placements` and their extents are what the generator claimed.
 * - The ORDER of the scatter array is load-bearing: every region draws from one
 *   seeded stream, so a region added anywhere but the end re-rolls every field
 *   below it.
 *
 * 625 placements, 80 scatter regions.
 */

const placements: Placement[] = [
  // ===== roads =====================================================================
  // Visual only: a road carries no collider and rejects nothing, so every
  // quarter and every scatter region below was generated against the
  // rectangles these claim. The two asphalt routes are the town's spine and
  // the rest are graded dirt.
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
  // ===== the mosque quarter ========================================================
  // The oldest fabric on the map: narrow plots on a 32 m pitch, walls
  // everywhere, and almost nothing you can see over. A squad crossing it on
  // the ground is blind; a squad crossing it on the roofs is not.
  { kind: "adobeHouse", x: -264, z: 74, rotY: Math.PI, params: { width: 19, depth: 20, floors: 2, enterable: true, rampSide: -1 } },
  { kind: "adobeHouse", x: -238.5, z: 67.5, rotY: Math.PI, params: { width: 8, depth: 8, floors: 2, enterable: true, tint: "#7b6a51" } },
  { kind: "adobeHouse", x: -238.5, z: 80.5, params: { width: 8, depth: 8, tint: "#6d5b41" } },
  { kind: "adobeHouse", x: -225.5, z: 67.5, rotY: Math.PI / 2, params: { width: 9, depth: 9, floors: 2, enterable: true, tint: "#b6a68f" } },
  { kind: "adobeHouse", x: -225.5, z: 80.5, rotY: Math.PI, params: { width: 8, depth: 9, enterable: true, tint: "#b6a68f" } },
  { kind: "adobeHouse", x: -200, z: 74, rotY: Math.PI, params: { width: 16, depth: 14, floors: 2, enterable: true, rampSide: -1 } },
  { kind: "adobeHouse", x: -170.38, z: 76.29, params: { width: 10, depth: 13, tint: "#7b6a51" } },
  { kind: "compoundWall", x: -175.38, z: 62, params: { length: 9.25 } },
  { kind: "compoundWall", x: -160.63, z: 62, params: { length: 9.25 } },
  { kind: "compoundWall", x: -156, z: 81.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -180, z: 81.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "adobeHouse", x: -136, z: 67, params: { width: 17, depth: 10, enterable: true } },
  { kind: "adobeHouse", x: -136, z: 81, params: { width: 17, depth: 10, floors: 2, enterable: true } },
  { kind: "adobeHouse", x: -104, z: 67, params: { width: 16, depth: 10, enterable: true } },
  { kind: "adobeHouse", x: -104, z: 81, params: { width: 16, depth: 10, floors: 2 } },
  { kind: "adobeHouse", x: -265.83, z: 104.31, params: { width: 14, depth: 10, ruined: true } },
  { kind: "compoundWall", x: -271.38, z: 94, params: { length: 9.25 } },
  { kind: "compoundWall", x: -256.63, z: 94, params: { length: 9.25 } },
  { kind: "compoundWall", x: -271.38, z: 118, params: { length: 9.25 } },
  { kind: "compoundWall", x: -256.63, z: 118, params: { length: 9.25 } },
  { kind: "adobeHouse", x: -200, z: 106, rotY: Math.PI, params: { width: 14, depth: 16, enterable: true, rampSide: 1, tint: "#7b6a51" } },
  { kind: "adobeHouse", x: -110.5, z: 99.5, params: { width: 8, depth: 9, enterable: true, tint: "#7b6a51" } },
  { kind: "adobeHouse", x: -110.5, z: 112.5, rotY: -Math.PI / 2, params: { width: 9, depth: 8 } },
  { kind: "adobeHouse", x: -97.5, z: 99.5, rotY: Math.PI / 2, params: { width: 9, depth: 9 } },
  { kind: "adobeHouse", x: -97.5, z: 112.5, rotY: Math.PI, params: { width: 8, depth: 8, enterable: true, tint: "#6d5b41" } },
  { kind: "compoundWall", x: -271.38, z: 126, params: { length: 9.25 } },
  { kind: "compoundWall", x: -256.63, z: 126, params: { length: 9.25 } },
  { kind: "compoundWall", x: -252, z: 145.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -271.38, z: 150, params: { length: 9.25 } },
  { kind: "crates", x: -265.96, z: 140.42, rotY: Math.PI },
  { kind: "compoundWall", x: -239.38, z: 126, params: { length: 9.25 } },
  { kind: "compoundWall", x: -224.63, z: 126, params: { length: 9.25 } },
  { kind: "compoundWall", x: -207.38, z: 126, params: { length: 9.25 } },
  { kind: "compoundWall", x: -192.63, z: 126, params: { length: 9.25 } },
  { kind: "compoundWall", x: -212, z: 145.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "adobeHouse", x: -142.5, z: 131.5, params: { width: 9, depth: 8 } },
  { kind: "adobeHouse", x: -142.5, z: 144.5, rotY: Math.PI / 2, params: { width: 8, depth: 9, floors: 2, tint: "#6d5b41" } },
  { kind: "adobeHouse", x: -129.5, z: 131.5, rotY: Math.PI / 2, params: { width: 9, depth: 8, enterable: true } },
  { kind: "adobeHouse", x: -129.5, z: 144.5, params: { width: 8, depth: 9 } },
  { kind: "adobeHouse", x: -110.5, z: 131.5, rotY: Math.PI / 2, params: { width: 8, depth: 8, enterable: true } },
  { kind: "adobeHouse", x: -110.5, z: 144.5, params: { width: 8, depth: 8, enterable: true, tint: "#7b6a51" } },
  { kind: "adobeHouse", x: -97.5, z: 131.5, params: { width: 9, depth: 9 } },
  { kind: "adobeHouse", x: -97.5, z: 144.5, rotY: Math.PI, params: { width: 8, depth: 8, enterable: true, tint: "#7b6a51" } },
  { kind: "adobeHouse", x: -264, z: 163, params: { width: 20, depth: 10, enterable: true, tint: "#7b6a51" } },
  { kind: "adobeHouse", x: -264, z: 177, params: { width: 20, depth: 10, floors: 2, enterable: true, tint: "#b6a68f" } },
  { kind: "compoundWall", x: -220, z: 177.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -239.38, z: 182, params: { length: 9.25 } },
  { kind: "crates", x: -229.67, z: 174.96 },
  { kind: "adobeHouse", x: -206.5, z: 176.5, params: { width: 8, depth: 9, floors: 2, enterable: true, tint: "#6d5b41" } },
  { kind: "adobeHouse", x: -193.5, z: 176.5, params: { width: 9, depth: 9, tint: "#b6a68f" } },
  { kind: "adobeHouse", x: -161.5, z: 176.5, params: { width: 8, depth: 8 } },
  { kind: "adobeHouse", x: -142.5, z: 176.5, rotY: -Math.PI / 2, params: { width: 8, depth: 9, floors: 2 } },
  { kind: "adobeHouse", x: -129.5, z: 163.5, rotY: -Math.PI / 2, params: { width: 9, depth: 8 } },
  { kind: "adobeHouse", x: -129.5, z: 176.5, rotY: -Math.PI / 2, params: { width: 9, depth: 8 } },
  { kind: "adobeHouse", x: -110.5, z: 163.5, params: { width: 8, depth: 8, enterable: true, tint: "#6d5b41" } },
  { kind: "adobeHouse", x: -110.5, z: 176.5, params: { width: 9, depth: 9, floors: 2, enterable: true, tint: "#6d5b41" } },
  { kind: "adobeHouse", x: -97.5, z: 163.5, rotY: Math.PI, params: { width: 8, depth: 8 } },
  { kind: "adobeHouse", x: -97.5, z: 176.5, rotY: Math.PI / 2, params: { width: 9, depth: 8, tint: "#7b6a51" } },
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
  { kind: "stall", x: 50.64, z: 88.16 },
  { kind: "stall", x: 18.96, z: 89.04, rotY: -Math.PI / 2 },
  { kind: "stall", x: -15.83, z: 66 },
  { kind: "stall", x: 6.35, z: 49.9, rotY: Math.PI / 2 },
  { kind: "stall", x: 37.27, z: 41.15 },
  { kind: "stall", x: 62.89, z: 46.59, rotY: Math.PI / 2 },
  { kind: "planter", x: 35.53, z: 87.41, rotY: -Math.PI / 2 },
  { kind: "planter", x: 16.52, z: 93.47 },
  { kind: "planter", x: 5.46, z: 67.62, rotY: Math.PI },
  { kind: "planter", x: 17.24, z: 41.28, rotY: Math.PI },
  { kind: "crates", x: 69.41, z: 98.58, rotY: Math.PI },
  { kind: "crates", x: 6.13, z: 71.1, rotY: -Math.PI / 2 },
  { kind: "car", x: -20.67, z: 103.01, params: { tint: "#6b463a" } },
  { kind: "barrier", x: 54, z: 112, params: { length: 6 } },
  { kind: "adobeHouse", x: -26, z: 118, rotY: Math.PI / 2, params: { width: 14, depth: 15, floors: 2, enterable: true, rampSide: 1, tint: "#b6a68f" } },
  { kind: "adobeHouse", x: 82, z: 118, params: { width: 14, depth: 15, floors: 2, enterable: true, rampSide: -1, tint: "#b6a68f" } },
  // ===== the old town ==============================================================
  // 30 m plots on a 7 m alley, which is a street you cannot drive a hull down
  // and can barely turn one in. The quarter is deliberately the densest thing
  // on the map and deliberately the one place armour is useless.
  { kind: "adobeHouse", x: -32.77, z: 72.59, rotY: Math.PI, params: { width: 10, depth: 13, enterable: true, rampSide: -1 } },
  { kind: "compoundWall", x: -22, z: 64.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -22, z: 79.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -41.38, z: 84, params: { length: 9.25 } },
  { kind: "compoundWall", x: -46, z: 64.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 42, z: 64.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 42, z: 79.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 22.63, z: 84, params: { length: 9.25 } },
  { kind: "compoundWall", x: 50, z: 64.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 50, z: 79.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "adobeHouse", x: 93.6, z: 72.77, rotY: Math.PI / 2, params: { width: 14, depth: 12, enterable: true, tint: "#b6a68f" } },
  { kind: "compoundWall", x: 86.63, z: 60, params: { length: 9.25 } },
  { kind: "compoundWall", x: 101.38, z: 60, params: { length: 9.25 } },
  { kind: "compoundWall", x: 106, z: 79.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 86.63, z: 84, params: { length: 9.25 } },
  { kind: "adobeHouse", x: 119, z: 72, rotY: Math.PI / 2, params: { width: 19, depth: 10 } },
  { kind: "adobeHouse", x: 133, z: 72, rotY: Math.PI / 2, params: { width: 19, depth: 10, tint: "#b6a68f" } },
  { kind: "adobeHouse", x: 151.5, z: 65.5, params: { width: 9, depth: 8, tint: "#6d5b41" } },
  { kind: "adobeHouse", x: 151.5, z: 78.5, params: { width: 9, depth: 9, enterable: true, tint: "#b6a68f" } },
  { kind: "adobeHouse", x: 164.5, z: 65.5, rotY: Math.PI / 2, params: { width: 9, depth: 8 } },
  { kind: "adobeHouse", x: 164.5, z: 78.5, rotY: Math.PI / 2, params: { width: 9, depth: 9, tint: "#6d5b41" } },
  { kind: "adobeHouse", x: -40.5, z: 97.5, rotY: Math.PI, params: { width: 8, depth: 9, floors: 2, tint: "#7b6a51" } },
  { kind: "adobeHouse", x: -40.5, z: 110.5, rotY: Math.PI, params: { width: 8, depth: 9, floors: 2, tint: "#6d5b41" } },
  { kind: "adobeHouse", x: -2, z: 104, rotY: -Math.PI / 2, params: { width: 18, depth: 14, enterable: true, rampSide: -1 } },
  { kind: "adobeHouse", x: 55.5, z: 97.5, rotY: Math.PI / 2, params: { width: 8, depth: 8 } },
  { kind: "adobeHouse", x: 68.5, z: 110.5, rotY: -Math.PI / 2, params: { width: 9, depth: 8, enterable: true } },
  { kind: "adobeHouse", x: 124.29, z: 103.72, params: { width: 10, depth: 10, ruined: true } },
  { kind: "compoundWall", x: 118.63, z: 92, params: { length: 9.25 } },
  { kind: "compoundWall", x: 133.38, z: 92, params: { length: 9.25 } },
  { kind: "compoundWall", x: 118.63, z: 116, params: { length: 9.25 } },
  { kind: "compoundWall", x: 133.38, z: 116, params: { length: 9.25 } },
  { kind: "adobeHouse", x: 155.45, z: 106.57, rotY: Math.PI, params: { width: 12, depth: 13, enterable: true, rampSide: -1, tint: "#6d5b41" } },
  { kind: "compoundWall", x: 150.63, z: 92, params: { length: 9.25 } },
  { kind: "compoundWall", x: 165.38, z: 92, params: { length: 9.25 } },
  { kind: "compoundWall", x: 170, z: 111.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 150.63, z: 116, params: { length: 9.25 } },
  { kind: "adobeHouse", x: -34, z: 136, rotY: Math.PI / 2, params: { width: 14, depth: 18, floors: 2, enterable: true, rampSide: -1, tint: "#7b6a51" } },
  { kind: "adobeHouse", x: -9, z: 136, rotY: Math.PI / 2, params: { width: 16, depth: 10 } },
  { kind: "adobeHouse", x: 5, z: 136, rotY: Math.PI / 2, params: { width: 16, depth: 10, floors: 2, enterable: true, tint: "#7b6a51" } },
  { kind: "adobeHouse", x: 30.13, z: 135.21, params: { width: 14, depth: 10, ruined: true, tint: "#6d5b41" } },
  { kind: "compoundWall", x: 22.63, z: 124, params: { length: 9.25 } },
  { kind: "compoundWall", x: 37.38, z: 124, params: { length: 9.25 } },
  { kind: "compoundWall", x: 42, z: 143.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 22.63, z: 148, params: { length: 9.25 } },
  { kind: "adobeHouse", x: 55.5, z: 129.5, params: { width: 8, depth: 8, floors: 2, enterable: true } },
  { kind: "adobeHouse", x: 55.5, z: 142.5, rotY: Math.PI / 2, params: { width: 8, depth: 8, enterable: true, tint: "#b6a68f" } },
  { kind: "adobeHouse", x: 68.5, z: 129.5, rotY: Math.PI, params: { width: 9, depth: 9, enterable: true } },
  { kind: "adobeHouse", x: 68.5, z: 142.5, params: { width: 8, depth: 9, enterable: true } },
  { kind: "adobeHouse", x: 86.5, z: 136, rotY: Math.PI / 2, params: { width: 17, depth: 11, enterable: true, tint: "#b6a68f" } },
  { kind: "adobeHouse", x: 101.5, z: 136, rotY: Math.PI / 2, params: { width: 17, depth: 11, enterable: true, tint: "#7b6a51" } },
  { kind: "adobeHouse", x: 127.91, z: 135.95, rotY: Math.PI / 2, params: { width: 11, depth: 12, floors: 2, ruined: true } },
  { kind: "compoundWall", x: 138, z: 128.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 138, z: 143.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 118.63, z: 148, params: { length: 9.25 } },
  { kind: "compoundWall", x: 114, z: 128.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "adobeHouse", x: 160.38, z: 135.44, rotY: Math.PI / 2, params: { width: 14, depth: 11, enterable: true } },
  { kind: "compoundWall", x: 150.63, z: 124, params: { length: 9.25 } },
  { kind: "compoundWall", x: 165.38, z: 124, params: { length: 9.25 } },
  { kind: "compoundWall", x: 170, z: 143.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 150.63, z: 148, params: { length: 9.25 } },
  { kind: "adobeHouse", x: -41.5, z: 168, rotY: Math.PI / 2, params: { width: 16, depth: 11, floors: 2, enterable: true } },
  { kind: "adobeHouse", x: -26.5, z: 168, rotY: Math.PI / 2, params: { width: 16, depth: 11, enterable: true, tint: "#7b6a51" } },
  { kind: "adobeHouse", x: -2, z: 160.5, params: { width: 18, depth: 11 } },
  { kind: "adobeHouse", x: -2, z: 175.5, params: { width: 18, depth: 11, tint: "#b6a68f" } },
  { kind: "adobeHouse", x: 22.5, z: 168, rotY: Math.PI / 2, params: { width: 18, depth: 11, enterable: true } },
  { kind: "adobeHouse", x: 37.5, z: 168, rotY: Math.PI / 2, params: { width: 18, depth: 11, floors: 2 } },
  { kind: "adobeHouse", x: 63.03, z: 169.44, rotY: Math.PI, params: { width: 13, depth: 9, ruined: true } },
  { kind: "compoundWall", x: 54.63, z: 156, params: { length: 9.25 } },
  { kind: "compoundWall", x: 69.38, z: 156, params: { length: 9.25 } },
  { kind: "compoundWall", x: 74, z: 175.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 54.63, z: 180, params: { length: 9.25 } },
  { kind: "adobeHouse", x: 87, z: 168, rotY: Math.PI / 2, params: { width: 17, depth: 10, enterable: true, tint: "#7b6a51" } },
  { kind: "adobeHouse", x: 101, z: 168, rotY: Math.PI / 2, params: { width: 17, depth: 10, tint: "#b6a68f" } },
  { kind: "adobeHouse", x: 126.32, z: 169.32, rotY: Math.PI / 2, params: { width: 13, depth: 12, ruined: true, tint: "#b6a68f" } },
  { kind: "compoundWall", x: 118.63, z: 156, params: { length: 9.25 } },
  { kind: "compoundWall", x: 133.38, z: 156, params: { length: 9.25 } },
  { kind: "compoundWall", x: 118.63, z: 180, params: { length: 9.25 } },
  { kind: "compoundWall", x: 133.38, z: 180, params: { length: 9.25 } },
  { kind: "adobeHouse", x: 158, z: 168, params: { width: 19, depth: 14, enterable: true, rampSide: -1, tint: "#b6a68f" } },
  // ===== the north town ============================================================
  // Newer, looser, and half of it never finished: bigger plots on a 36 m
  // pitch with a third of them walled and empty. The ground between the old
  // town and the north edge had to be worth crossing without being another
  // maze.
  { kind: "adobeHouse", x: -214.83, z: 247.25, rotY: Math.PI, params: { width: 10, depth: 10, ruined: true } },
  { kind: "compoundWall", x: -222.38, z: 235, params: { length: 9.25 } },
  { kind: "compoundWall", x: -207.63, z: 235, params: { length: 9.25 } },
  { kind: "compoundWall", x: -203, z: 254.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -227, z: 254.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "adobeHouse", x: -189.5, z: 240.5, params: { width: 8, depth: 9, floors: 2 } },
  { kind: "adobeHouse", x: -189.5, z: 253.5, rotY: Math.PI, params: { width: 9, depth: 9, tint: "#6d5b41" } },
  { kind: "adobeHouse", x: -176.5, z: 240.5, rotY: Math.PI / 2, params: { width: 8, depth: 8, floors: 2, enterable: true } },
  { kind: "adobeHouse", x: -176.5, z: 253.5, params: { width: 9, depth: 9, enterable: true } },
  { kind: "compoundWall", x: -158.38, z: 235, params: { length: 9.25 } },
  { kind: "compoundWall", x: -143.63, z: 235, params: { length: 9.25 } },
  { kind: "compoundWall", x: -158.38, z: 259, params: { length: 9.25 } },
  { kind: "well", x: -151, z: 247 },
  { kind: "compoundWall", x: -126.38, z: 235, params: { length: 9.25 } },
  { kind: "compoundWall", x: -111.63, z: 235, params: { length: 9.25 } },
  { kind: "compoundWall", x: -126.38, z: 259, params: { length: 9.25 } },
  { kind: "compoundWall", x: -111.63, z: 259, params: { length: 9.25 } },
  { kind: "adobeHouse", x: -86.43, z: 248.39, params: { width: 11, depth: 11, ruined: true } },
  { kind: "compoundWall", x: -94.38, z: 235, params: { length: 9.25 } },
  { kind: "compoundWall", x: -94.38, z: 259, params: { length: 9.25 } },
  { kind: "compoundWall", x: -43, z: 239.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -43, z: 254.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "well", x: -55, z: 247 },
  { kind: "adobeHouse", x: -30, z: 247, rotY: Math.PI / 2, params: { width: 16, depth: 10, tint: "#6d5b41" } },
  { kind: "adobeHouse", x: -16, z: 247, rotY: Math.PI / 2, params: { width: 16, depth: 10, floors: 2, tint: "#7b6a51" } },
  { kind: "adobeHouse", x: 9, z: 247, rotY: -Math.PI / 2, params: { width: 15, depth: 19, floors: 2, enterable: true, rampSide: -1, tint: "#7b6a51" } },
  { kind: "compoundWall", x: 53, z: 239.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 53, z: 254.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 33.63, z: 259, params: { length: 9.25 } },
  { kind: "compoundWall", x: 29, z: 239.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "adobeHouse", x: 66.5, z: 240.5, rotY: Math.PI / 2, params: { width: 9, depth: 9, floors: 2, tint: "#7b6a51" } },
  { kind: "adobeHouse", x: 66.5, z: 253.5, params: { width: 8, depth: 9, tint: "#7b6a51" } },
  { kind: "adobeHouse", x: 79.5, z: 240.5, rotY: -Math.PI / 2, params: { width: 9, depth: 8, floors: 2 } },
  { kind: "adobeHouse", x: 79.5, z: 253.5, rotY: -Math.PI / 2, params: { width: 9, depth: 9, floors: 2, tint: "#7b6a51" } },
  { kind: "adobeHouse", x: 98, z: 247, rotY: Math.PI / 2, params: { width: 19, depth: 10, floors: 2 } },
  { kind: "adobeHouse", x: 112, z: 247, rotY: Math.PI / 2, params: { width: 19, depth: 10 } },
  { kind: "adobeHouse", x: -221.5, z: 272.5, params: { width: 9, depth: 9 } },
  { kind: "adobeHouse", x: -221.5, z: 285.5, rotY: -Math.PI / 2, params: { width: 8, depth: 8, tint: "#b6a68f" } },
  { kind: "adobeHouse", x: -208.5, z: 272.5, rotY: Math.PI / 2, params: { width: 8, depth: 9, floors: 2, tint: "#7b6a51" } },
  { kind: "adobeHouse", x: -208.5, z: 285.5, rotY: Math.PI, params: { width: 8, depth: 8 } },
  { kind: "adobeHouse", x: -183, z: 279, rotY: -Math.PI / 2, params: { width: 18, depth: 17, floors: 2, enterable: true, rampSide: 1 } },
  { kind: "adobeHouse", x: -157.5, z: 272.5, rotY: Math.PI / 2, params: { width: 8, depth: 9 } },
  { kind: "adobeHouse", x: -157.5, z: 285.5, rotY: Math.PI, params: { width: 9, depth: 8, tint: "#7b6a51" } },
  { kind: "adobeHouse", x: -144.5, z: 285.5, rotY: Math.PI / 2, params: { width: 9, depth: 8, enterable: true } },
  { kind: "adobeHouse", x: -119, z: 271.5, params: { width: 20, depth: 11, floors: 2, enterable: true } },
  { kind: "adobeHouse", x: -119, z: 286.5, params: { width: 20, depth: 11, enterable: true } },
  { kind: "adobeHouse", x: -87, z: 279, rotY: -Math.PI / 2, params: { width: 18, depth: 20, enterable: true, rampSide: -1, tint: "#7b6a51" } },
  { kind: "compoundWall", x: -30.38, z: 267, params: { length: 9.25 } },
  { kind: "compoundWall", x: -15.63, z: 267, params: { length: 9.25 } },
  { kind: "compoundWall", x: -30.38, z: 291, params: { length: 9.25 } },
  { kind: "compoundWall", x: -15.63, z: 291, params: { length: 9.25 } },
  { kind: "adobeHouse", x: 9, z: 279, rotY: Math.PI, params: { width: 19, depth: 14, floors: 2, enterable: true, rampSide: -1, tint: "#6d5b41" } },
  { kind: "adobeHouse", x: 34.5, z: 272.5, rotY: Math.PI, params: { width: 9, depth: 9, tint: "#6d5b41" } },
  { kind: "adobeHouse", x: 34.5, z: 285.5, rotY: Math.PI / 2, params: { width: 9, depth: 8, enterable: true } },
  { kind: "adobeHouse", x: 47.5, z: 272.5, rotY: Math.PI, params: { width: 9, depth: 9, tint: "#7b6a51" } },
  { kind: "adobeHouse", x: 47.5, z: 285.5, params: { width: 9, depth: 9 } },
  { kind: "adobeHouse", x: 66.5, z: 272.5, params: { width: 8, depth: 8 } },
  { kind: "adobeHouse", x: 66.5, z: 285.5, rotY: Math.PI / 2, params: { width: 9, depth: 9, floors: 2, tint: "#7b6a51" } },
  { kind: "adobeHouse", x: 79.5, z: 272.5, params: { width: 9, depth: 8, tint: "#b6a68f" } },
  { kind: "adobeHouse", x: 79.5, z: 285.5, rotY: -Math.PI / 2, params: { width: 9, depth: 8, tint: "#7b6a51" } },
  { kind: "adobeHouse", x: 98.5, z: 272.5, rotY: Math.PI, params: { width: 8, depth: 8, enterable: true, tint: "#b6a68f" } },
  { kind: "adobeHouse", x: 98.5, z: 285.5, rotY: Math.PI, params: { width: 9, depth: 9, floors: 2, tint: "#7b6a51" } },
  { kind: "adobeHouse", x: 111.5, z: 272.5, rotY: Math.PI, params: { width: 8, depth: 8, tint: "#7b6a51" } },
  { kind: "adobeHouse", x: 111.5, z: 285.5, rotY: -Math.PI / 2, params: { width: 8, depth: 8, enterable: true } },
  { kind: "adobeHouse", x: -221.5, z: 304.5, params: { width: 8, depth: 9, tint: "#b6a68f" } },
  { kind: "adobeHouse", x: -221.5, z: 317.5, rotY: Math.PI, params: { width: 8, depth: 8, enterable: true, tint: "#6d5b41" } },
  { kind: "adobeHouse", x: -208.5, z: 304.5, rotY: Math.PI / 2, params: { width: 9, depth: 8 } },
  { kind: "adobeHouse", x: -208.5, z: 317.5, rotY: Math.PI, params: { width: 8, depth: 9, enterable: true, tint: "#b6a68f" } },
  { kind: "compoundWall", x: -190.38, z: 299, params: { length: 9.25 } },
  { kind: "compoundWall", x: -175.63, z: 299, params: { length: 9.25 } },
  { kind: "compoundWall", x: -171, z: 318.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -195, z: 318.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -158.38, z: 299, params: { length: 9.25 } },
  { kind: "compoundWall", x: -143.63, z: 299, params: { length: 9.25 } },
  { kind: "compoundWall", x: -158.38, z: 323, params: { length: 9.25 } },
  { kind: "compoundWall", x: -143.63, z: 323, params: { length: 9.25 } },
  { kind: "compoundWall", x: -126.38, z: 299, params: { length: 9.25 } },
  { kind: "compoundWall", x: -111.63, z: 299, params: { length: 9.25 } },
  { kind: "compoundWall", x: -126.38, z: 323, params: { length: 9.25 } },
  { kind: "compoundWall", x: -111.63, z: 323, params: { length: 9.25 } },
  { kind: "crates", x: -116.29, z: 310.51, rotY: -Math.PI / 2 },
  { kind: "adobeHouse", x: -93.5, z: 304.5, rotY: Math.PI / 2, params: { width: 8, depth: 9, enterable: true, tint: "#b6a68f" } },
  { kind: "adobeHouse", x: -93.5, z: 317.5, rotY: Math.PI, params: { width: 8, depth: 9 } },
  { kind: "adobeHouse", x: -80.5, z: 304.5, rotY: Math.PI, params: { width: 8, depth: 8, floors: 2, tint: "#7b6a51" } },
  { kind: "adobeHouse", x: -80.5, z: 317.5, rotY: Math.PI, params: { width: 8, depth: 8, tint: "#6d5b41" } },
  { kind: "adobeHouse", x: -47.5, z: 311, rotY: Math.PI / 2, params: { width: 16, depth: 11 } },
  { kind: "adobeHouse", x: -23, z: 304, params: { width: 17, depth: 10, tint: "#7b6a51" } },
  { kind: "adobeHouse", x: -23, z: 318, params: { width: 17, depth: 10, floors: 2, enterable: true } },
  { kind: "compoundWall", x: 21, z: 303.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 21, z: 318.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 1.63, z: 323, params: { length: 9.25 } },
  { kind: "compoundWall", x: -3, z: 303.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "adobeHouse", x: 40.7, z: 312.59, rotY: Math.PI / 2, params: { width: 13, depth: 11, ruined: true } },
  { kind: "compoundWall", x: 33.63, z: 299, params: { length: 9.25 } },
  { kind: "compoundWall", x: 48.38, z: 299, params: { length: 9.25 } },
  { kind: "compoundWall", x: 53, z: 318.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 29, z: 318.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 65.63, z: 299, params: { length: 9.25 } },
  { kind: "compoundWall", x: 80.38, z: 299, params: { length: 9.25 } },
  { kind: "compoundWall", x: 85, z: 318.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 61, z: 318.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "adobeHouse", x: 105.79, z: 310.69, rotY: Math.PI / 2, params: { width: 12, depth: 10, floors: 2, ruined: true } },
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
  { kind: "shellBlock", x: 222, z: 184, rotY: Math.PI, params: { width: 22, depth: 16, floors: 3, rampSide: -1 } },
  { kind: "shellBlock", x: 294, z: 186, rotY: Math.PI, params: { width: 22, depth: 16, floors: 3, rampSide: -1 } },
  { kind: "shellBlock", x: 216, z: 142, rotY: Math.PI / 2, params: { width: 26, depth: 15, floors: 2 } },
  { kind: "car", x: 282.8, z: 115.81, rotY: Math.PI / 2, params: { tint: "#2f3338" } },
  { kind: "car", x: 249.66, z: 109.42, rotY: -Math.PI / 2, params: { tint: "#4a4f45" } },
  { kind: "car", x: 267.84, z: 154.87, rotY: Math.PI / 2, params: { tint: "#4a4f45" } },
  { kind: "car", x: 286.61, z: 164.37, params: { tint: "#2f3338" } },
  { kind: "blastWall", x: 244, z: 70, params: { length: 26 } },
  { kind: "sandbags", x: 280, z: 74, params: { length: 8 } },
  // ===== the quarter's own streets =================================================
  // What is left of the streets around the blocks. Nearly half the plots up
  // here are ruins, which is the difference between this quarter and the old
  // town: down there the fabric is intact and the ground is a maze, and up
  // here the fabric is broken and the sightlines run.
  { kind: "adobeHouse", x: 221, z: 116, rotY: -Math.PI / 2, params: { width: 15, depth: 20, floors: 2, enterable: true, rampSide: 1 } },
  { kind: "adobeHouse", x: 259.5, z: 109.5, rotY: Math.PI, params: { width: 9, depth: 9, enterable: true } },
  { kind: "adobeHouse", x: 282.17, z: 149.57, params: { width: 11, depth: 11, ruined: true } },
  { kind: "adobeHouse", x: 252.99, z: 177.87, rotY: Math.PI / 2, params: { width: 12, depth: 10, ruined: true } },
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
  { kind: "shed", x: -162.87, z: -184.95, rotY: Math.PI / 2 },
  { kind: "shed", x: -171.75, z: -179.79, rotY: Math.PI / 2 },
  { kind: "shed", x: -155.88, z: -177.65, rotY: Math.PI / 2 },
  { kind: "blastWall", x: -120, z: -218, params: { length: 46 } },
  { kind: "sandbags", x: -136, z: -214, params: { length: 9 } },
  { kind: "crates", x: -140.22, z: -191.65, rotY: Math.PI / 2 },
  { kind: "crates", x: -149.18, z: -180.52, rotY: Math.PI / 2 },
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
  { kind: "car", x: 144.03, z: -152.97, rotY: -Math.PI / 2, params: { tint: "#4a4f45" } },
  { kind: "car", x: 161.11, z: -105.18, rotY: Math.PI / 2, params: { tint: "#5d4a3a" } },
  { kind: "car", x: 232.23, z: -104.73, rotY: -Math.PI / 2, params: { tint: "#2f3338" } },
  { kind: "barrier", x: 180, z: -80, rotY: Math.PI / 2, params: { length: 6 } },
  { kind: "barrier", x: 200, z: -158, rotY: Math.PI / 2, params: { length: 6 } },
  // ===== the south bank ============================================================
  // What is left of the suburb between the wadi and the desert: a third of it
  // walled plots with nothing in them, which is what a town looks like where
  // it was still being built when the fighting reached it.
  { kind: "adobeHouse", x: -240, z: -203, rotY: Math.PI, params: { width: 17, depth: 18, floors: 2, enterable: true, rampSide: -1 } },
  { kind: "compoundWall", x: -215.38, z: -215, params: { length: 9.25 } },
  { kind: "compoundWall", x: -200.63, z: -215, params: { length: 9.25 } },
  { kind: "compoundWall", x: -196, z: -195.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -220, z: -195.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "crates", x: -206.06, z: -203.94, rotY: Math.PI / 2 },
  { kind: "compoundWall", x: -183.38, z: -215, params: { length: 9.25 } },
  { kind: "compoundWall", x: -168.63, z: -215, params: { length: 9.25 } },
  { kind: "compoundWall", x: -183.38, z: -191, params: { length: 9.25 } },
  { kind: "compoundWall", x: -168.63, z: -191, params: { length: 9.25 } },
  { kind: "compoundWall", x: -151.38, z: -215, params: { length: 9.25 } },
  { kind: "compoundWall", x: -151.38, z: -191, params: { length: 9.25 } },
  { kind: "compoundWall", x: -119.38, z: -215, params: { length: 9.25 } },
  { kind: "compoundWall", x: -104.63, z: -215, params: { length: 9.25 } },
  { kind: "compoundWall", x: -40.63, z: -215, params: { length: 9.25 } },
  { kind: "compoundWall", x: -40.63, z: -191, params: { length: 9.25 } },
  { kind: "well", x: -48, z: -203 },
  { kind: "adobeHouse", x: -22.5, z: -209.5, rotY: Math.PI / 2, params: { width: 8, depth: 8, enterable: true } },
  { kind: "adobeHouse", x: -22.5, z: -196.5, rotY: Math.PI / 2, params: { width: 8, depth: 8, enterable: true, tint: "#b6a68f" } },
  { kind: "adobeHouse", x: -9.5, z: -209.5, rotY: Math.PI, params: { width: 9, depth: 9, floors: 2 } },
  { kind: "adobeHouse", x: -9.5, z: -196.5, rotY: Math.PI / 2, params: { width: 9, depth: 8 } },
  { kind: "adobeHouse", x: 16, z: -203, params: { width: 19, depth: 17, enterable: true, rampSide: 1 } },
  { kind: "adobeHouse", x: 41.5, z: -209.5, rotY: Math.PI / 2, params: { width: 9, depth: 8, enterable: true, tint: "#6d5b41" } },
  { kind: "adobeHouse", x: 41.5, z: -196.5, rotY: -Math.PI / 2, params: { width: 8, depth: 9, enterable: true, tint: "#6d5b41" } },
  { kind: "adobeHouse", x: 54.5, z: -209.5, params: { width: 9, depth: 9, enterable: true } },
  { kind: "adobeHouse", x: 54.5, z: -196.5, rotY: Math.PI / 2, params: { width: 8, depth: 8, enterable: true, tint: "#6d5b41" } },
  { kind: "adobeHouse", x: 72.5, z: -203, rotY: Math.PI / 2, params: { width: 18, depth: 11, enterable: true, tint: "#6d5b41" } },
  { kind: "adobeHouse", x: 87.5, z: -203, rotY: Math.PI / 2, params: { width: 18, depth: 11, tint: "#b6a68f" } },
  { kind: "compoundWall", x: 104.63, z: -215, params: { length: 9.25 } },
  { kind: "compoundWall", x: 119.38, z: -215, params: { length: 9.25 } },
  { kind: "compoundWall", x: 124, z: -195.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 100, z: -195.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "adobeHouse", x: 137.5, z: -209.5, rotY: Math.PI, params: { width: 8, depth: 9, floors: 2, enterable: true, tint: "#6d5b41" } },
  { kind: "adobeHouse", x: 137.5, z: -196.5, rotY: Math.PI / 2, params: { width: 9, depth: 8, tint: "#6d5b41" } },
  { kind: "adobeHouse", x: 150.5, z: -209.5, rotY: Math.PI / 2, params: { width: 8, depth: 8 } },
  { kind: "adobeHouse", x: 150.5, z: -196.5, rotY: -Math.PI / 2, params: { width: 8, depth: 9, enterable: true } },
  { kind: "adobeHouse", x: 169.5, z: -203, rotY: Math.PI / 2, params: { width: 16, depth: 9, tint: "#6d5b41" } },
  { kind: "compoundWall", x: 220, z: -210.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 220, z: -195.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 252, z: -210.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 252, z: -195.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 232.63, z: -191, params: { length: 9.25 } },
  { kind: "compoundWall", x: 228, z: -210.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "crates", x: 236.17, z: -203.25, rotY: -Math.PI / 2 },
  { kind: "adobeHouse", x: -240, z: -171, rotY: Math.PI, params: { width: 19, depth: 16, enterable: true, rampSide: 1 } },
  { kind: "adobeHouse", x: -206.13, z: -172.96, rotY: Math.PI, params: { width: 13, depth: 12 } },
  { kind: "compoundWall", x: -196, z: -178.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -196, z: -163.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -215.38, z: -159, params: { length: 9.25 } },
  { kind: "compoundWall", x: -220, z: -178.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -183.38, z: -183, params: { length: 9.25 } },
  { kind: "compoundWall", x: -183.38, z: -159, params: { length: 9.25 } },
  { kind: "crates", x: -175.52, z: -166.03, rotY: Math.PI },
  { kind: "compoundWall", x: -100, z: -178.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -100, z: -163.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "adobeHouse", x: -86.5, z: -164.5, rotY: Math.PI, params: { width: 9, depth: 8, enterable: true } },
  { kind: "adobeHouse", x: -41.5, z: -177.5, rotY: Math.PI, params: { width: 8, depth: 9, enterable: true, tint: "#7b6a51" } },
  { kind: "adobeHouse", x: -41.5, z: -164.5, params: { width: 9, depth: 9, tint: "#b6a68f" } },
  { kind: "compoundWall", x: -23.38, z: -183, params: { length: 9.25 } },
  { kind: "compoundWall", x: -8.63, z: -183, params: { length: 9.25 } },
  { kind: "compoundWall", x: -4, z: -163.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: -23.38, z: -159, params: { length: 9.25 } },
  { kind: "adobeHouse", x: 9.5, z: -177.5, rotY: Math.PI, params: { width: 8, depth: 8 } },
  { kind: "adobeHouse", x: 9.5, z: -164.5, rotY: Math.PI, params: { width: 9, depth: 9, enterable: true } },
  { kind: "adobeHouse", x: 22.5, z: -177.5, params: { width: 9, depth: 9, enterable: true, tint: "#b6a68f" } },
  { kind: "adobeHouse", x: 22.5, z: -164.5, rotY: -Math.PI / 2, params: { width: 9, depth: 8, tint: "#b6a68f" } },
  { kind: "compoundWall", x: 60, z: -178.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 60, z: -163.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 40.63, z: -159, params: { length: 9.25 } },
  { kind: "compoundWall", x: 36, z: -178.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 72.63, z: -183, params: { length: 9.25 } },
  { kind: "compoundWall", x: 87.38, z: -183, params: { length: 9.25 } },
  { kind: "compoundWall", x: 92, z: -163.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 68, z: -163.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 124, z: -178.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 124, z: -163.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 104.63, z: -159, params: { length: 9.25 } },
  { kind: "compoundWall", x: 100, z: -178.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "adobeHouse", x: 137.5, z: -177.5, rotY: Math.PI / 2, params: { width: 8, depth: 9, floors: 2, enterable: true } },
  { kind: "adobeHouse", x: 137.5, z: -164.5, rotY: Math.PI, params: { width: 8, depth: 9, enterable: true } },
  { kind: "adobeHouse", x: 150.5, z: -177.5, rotY: -Math.PI / 2, params: { width: 9, depth: 9, enterable: true, tint: "#7b6a51" } },
  { kind: "adobeHouse", x: 150.5, z: -164.5, rotY: Math.PI, params: { width: 8, depth: 8 } },
  { kind: "compoundWall", x: 168.63, z: -159, params: { length: 9.25 } },
  { kind: "compoundWall", x: 164, z: -178.38, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "compoundWall", x: 215.38, z: -183, params: { length: 9.25 } },
  { kind: "compoundWall", x: 220, z: -163.63, rotY: Math.PI / 2, params: { length: 9.25 } },
  { kind: "adobeHouse", x: 239.19, z: -173.39, rotY: -Math.PI / 2, params: { width: 12, depth: 10, enterable: true } },
  { kind: "compoundWall", x: 232.63, z: -183, params: { length: 9.25 } },
  { kind: "compoundWall", x: 247.38, z: -183, params: { length: 9.25 } },
  { kind: "compoundWall", x: 252, z: -163.63, rotY: Math.PI / 2, params: { length: 9.25 } },
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
  { kind: "compoundWall", x: 344.57, z: 98.21, params: { length: 17.72, height: 2.58 } },
  { kind: "compoundWall", x: 367.78, z: 98.21, params: { length: 17.72, height: 2.58 } },
  { kind: "compoundWall", x: 376.64, z: 117.73, rotY: Math.PI / 2, params: { length: 9.35, height: 2.58 } },
  { kind: "compoundWall", x: 344.57, z: 122.4, params: { length: 17.72, height: 2.58 } },
  { kind: "adobeHouse", x: 363.81, z: 107.46, rotY: -Math.PI / 2, params: { width: 12, depth: 10, ruined: true, tint: "#6d5b41" } },
  { kind: "adobeHouse", x: 345.98, z: 109.45, rotY: -Math.PI / 2, params: { width: 8, depth: 10, floors: 2 } },
  { kind: "compoundWall", x: -19.11, z: -323.26, params: { length: 12.43, height: 2.07 } },
  { kind: "compoundWall", x: -1.18, z: -323.26, params: { length: 12.43, height: 2.07 } },
  { kind: "compoundWall", x: -19.11, z: -288.05, params: { length: 12.43, height: 2.07 } },
  { kind: "compoundWall", x: -1.18, z: -288.05, params: { length: 12.43, height: 2.07 } },
  { kind: "adobeHouse", x: -12.45, z: -310.31, rotY: Math.PI / 2, params: { width: 10, depth: 9, floors: 2, ruined: true, tint: "#b6a68f" } },
  { kind: "compoundWall", x: 298.36, z: -186.37, rotY: Math.PI / 2, params: { length: 16.32, height: 2.24 } },
  { kind: "compoundWall", x: 298.36, z: -164.55, rotY: Math.PI / 2, params: { length: 16.32, height: 2.24 } },
  { kind: "compoundWall", x: 270.31, z: -156.39, params: { length: 15.03, height: 2.24 } },
  { kind: "compoundWall", x: 262.8, z: -186.37, rotY: Math.PI / 2, params: { length: 16.32, height: 2.24 } },
  { kind: "adobeHouse", x: 277.55, z: -179.5, rotY: -Math.PI / 2, params: { width: 8, depth: 10, floors: 2 } },
  { kind: "compoundWall", x: 237.36, z: -331.59, params: { length: 17.49, height: 2.31 } },
  { kind: "compoundWall", x: 260.35, z: -331.59, params: { length: 17.49, height: 2.31 } },
  { kind: "compoundWall", x: 269.09, z: -308.83, rotY: Math.PI / 2, params: { length: 11.5, height: 2.31 } },
  { kind: "compoundWall", x: 237.36, z: -303.08, params: { length: 17.49, height: 2.31 } },
  { kind: "adobeHouse", x: 244.17, z: -319.46, rotY: -Math.PI / 2, params: { width: 12, depth: 9 } },
  { kind: "compoundWall", x: -238, z: -342.44, params: { length: 19.2, height: 2.22 } },
  { kind: "compoundWall", x: -213.3, z: -342.44, params: { length: 19.2, height: 2.22 } },
  { kind: "compoundWall", x: -203.7, z: -311.22, rotY: Math.PI / 2, params: { length: 17.15, height: 2.22 } },
  { kind: "compoundWall", x: -247.59, z: -311.22, rotY: Math.PI / 2, params: { length: 17.15, height: 2.22 } },
  { kind: "adobeHouse", x: -235.75, z: -315.25, rotY: Math.PI, params: { width: 8, depth: 10, ruined: true, tint: "#b6a68f" } },
  { kind: "compoundWall", x: -270.43, z: 287.27, params: { length: 13.65, height: 2.12 } },
  { kind: "compoundWall", x: -251.28, z: 287.27, params: { length: 13.65, height: 2.12 } },
  { kind: "compoundWall", x: -244.46, z: 308.4, rotY: Math.PI / 2, params: { length: 10.42, height: 2.12 } },
  { kind: "compoundWall", x: -270.43, z: 313.61, params: { length: 13.65, height: 2.12 } },
  { kind: "adobeHouse", x: -259.57, z: 297.25, rotY: Math.PI / 2, params: { width: 9, depth: 11, enterable: true } },
  { kind: "compoundWall", x: -81.1, z: -308.67, rotY: Math.PI / 2, params: { length: 11.39, height: 2.43 } },
  { kind: "compoundWall", x: -81.1, z: -291.79, rotY: Math.PI / 2, params: { length: 11.39, height: 2.43 } },
  { kind: "compoundWall", x: -107.26, z: -286.09, params: { length: 13.78, height: 2.43 } },
  { kind: "compoundWall", x: -114.15, z: -308.67, rotY: Math.PI / 2, params: { length: 11.39, height: 2.43 } },
  { kind: "adobeHouse", x: -103.77, z: -304.5, rotY: Math.PI / 2, params: { width: 10, depth: 9, enterable: true, tint: "#7b6a51" } },
  { kind: "compoundWall", x: 97.4, z: 356.03, params: { length: 13.23, height: 2.35 } },
  { kind: "compoundWall", x: 116.13, z: 356.03, params: { length: 13.23, height: 2.35 } },
  { kind: "compoundWall", x: 122.75, z: 376.94, rotY: Math.PI / 2, params: { length: 10.27, height: 2.35 } },
  { kind: "compoundWall", x: 90.79, z: 376.94, rotY: Math.PI / 2, params: { length: 10.27, height: 2.35 } },
  { kind: "adobeHouse", x: 109.51, z: 365.71, rotY: Math.PI / 2, params: { width: 8, depth: 8, enterable: true } },
  { kind: "compoundWall", x: 390.74, z: 159.2, rotY: Math.PI / 2, params: { length: 16.01, height: 2.46 } },
  { kind: "compoundWall", x: 390.74, z: 180.72, rotY: Math.PI / 2, params: { length: 16.01, height: 2.46 } },
  { kind: "compoundWall", x: 367.7, z: 188.72, params: { length: 11.69, height: 2.46 } },
  { kind: "compoundWall", x: 361.85, z: 159.2, rotY: Math.PI / 2, params: { length: 16.01, height: 2.46 } },
  { kind: "adobeHouse", x: 381.95, z: 175.95, rotY: -Math.PI / 2, params: { width: 10, depth: 10, ruined: true } },
  { kind: "compoundWall", x: -345.26, z: 156.55, rotY: Math.PI / 2, params: { length: 15.23, height: 2.51 } },
  { kind: "compoundWall", x: -345.26, z: 177.29, rotY: Math.PI / 2, params: { length: 15.23, height: 2.51 } },
  { kind: "compoundWall", x: -369.26, z: 184.9, params: { length: 12.33, height: 2.51 } },
  { kind: "compoundWall", x: -375.43, z: 156.55, rotY: Math.PI / 2, params: { length: 15.23, height: 2.51 } },
  { kind: "adobeHouse", x: -367.25, z: 163.31, params: { width: 9, depth: 10, enterable: true, tint: "#b6a68f" } },
  { kind: "compoundWall", x: -44.49, z: 338.79, params: { length: 10.63, height: 2.37 } },
  { kind: "compoundWall", x: -28.36, z: 338.79, params: { length: 10.63, height: 2.37 } },
  { kind: "compoundWall", x: -23.04, z: 366.11, rotY: Math.PI / 2, params: { length: 14.55, height: 2.37 } },
  { kind: "compoundWall", x: -49.8, z: 366.11, rotY: Math.PI / 2, params: { length: 14.55, height: 2.37 } },
  { kind: "adobeHouse", x: -32.98, z: 355.51, rotY: -Math.PI / 2, params: { width: 12, depth: 11, floors: 2, enterable: true, tint: "#7b6a51" } },
  { kind: "compoundWall", x: 72.44, z: -314.67, params: { length: 11.42, height: 2.39 } },
  { kind: "compoundWall", x: 89.36, z: -314.67, params: { length: 11.42, height: 2.39 } },
  { kind: "compoundWall", x: 95.07, z: -291.49, rotY: Math.PI / 2, params: { length: 11.79, height: 2.39 } },
  { kind: "compoundWall", x: 66.73, z: -291.49, rotY: Math.PI / 2, params: { length: 11.79, height: 2.39 } },
  { kind: "adobeHouse", x: 75.69, z: -301.94, rotY: Math.PI, params: { width: 10, depth: 10 } },
  { kind: "compoundWall", x: 69.51, z: -412.81, params: { length: 11, height: 2.41 } },
  { kind: "compoundWall", x: 86.01, z: -412.81, params: { length: 11, height: 2.41 } },
  { kind: "compoundWall", x: 91.51, z: -382.72, rotY: Math.PI / 2, params: { length: 16.4, height: 2.41 } },
  { kind: "compoundWall", x: 64.01, z: -382.72, rotY: Math.PI / 2, params: { length: 16.4, height: 2.41 } },
  { kind: "adobeHouse", x: 78.87, z: -392.96, rotY: Math.PI, params: { width: 9, depth: 11, ruined: true } },
  { kind: "compoundWall", x: 35.96, z: 386.79, rotY: Math.PI / 2, params: { length: 11.9, height: 2.33 } },
  { kind: "compoundWall", x: 35.96, z: 404.2, rotY: Math.PI / 2, params: { length: 11.9, height: 2.33 } },
  { kind: "compoundWall", x: 7.86, z: 410.15, params: { length: 15.07, height: 2.33 } },
  { kind: "compoundWall", x: 0.33, z: 386.79, rotY: Math.PI / 2, params: { length: 11.9, height: 2.33 } },
  { kind: "adobeHouse", x: 18.62, z: 388.23, rotY: Math.PI, params: { width: 9, depth: 10, tint: "#b6a68f" } },
  { kind: "compoundWall", x: 374.33, z: 45.43, params: { length: 12.92, height: 2.29 } },
  { kind: "compoundWall", x: 392.75, z: 45.43, params: { length: 12.92, height: 2.29 } },
  { kind: "compoundWall", x: 374.33, z: 80.16, params: { length: 12.92, height: 2.29 } },
  { kind: "compoundWall", x: 392.75, z: 80.16, params: { length: 12.92, height: 2.29 } },
  { kind: "adobeHouse", x: 381.93, z: 67.72, rotY: Math.PI / 2, params: { width: 9, depth: 8, ruined: true } },
  { kind: "compoundWall", x: -275.93, z: -13.27, params: { length: 15.37, height: 2.16 } },
  { kind: "compoundWall", x: -255.06, z: -13.27, params: { length: 15.37, height: 2.16 } },
  { kind: "compoundWall", x: -247.38, z: 7.42, rotY: Math.PI / 2, params: { length: 10.13, height: 2.16 } },
  { kind: "compoundWall", x: -275.93, z: 12.48, params: { length: 15.37, height: 2.16 } },
  { kind: "adobeHouse", x: -265.26, z: -3.83, rotY: -Math.PI / 2, params: { width: 11, depth: 8, tint: "#7b6a51" } },
  { kind: "compoundWall", x: -26.89, z: -381.63, params: { length: 14.78, height: 2.12 } },
  { kind: "compoundWall", x: -6.61, z: -381.63, params: { length: 14.78, height: 2.12 } },
  { kind: "compoundWall", x: 0.78, z: -351.6, rotY: Math.PI / 2, params: { length: 16.35, height: 2.12 } },
  { kind: "compoundWall", x: -34.28, z: -351.6, rotY: Math.PI / 2, params: { length: 16.35, height: 2.12 } },
  { kind: "adobeHouse", x: -14.67, z: -361.59, rotY: Math.PI / 2, params: { width: 12, depth: 9, ruined: true } },
  { kind: "compoundWall", x: 8.55, z: 330.03, params: { length: 14.64, height: 2.44 } },
  { kind: "compoundWall", x: 28.7, z: 330.03, params: { length: 14.64, height: 2.44 } },
  { kind: "compoundWall", x: 8.55, z: 363.1, params: { length: 14.64, height: 2.44 } },
  { kind: "compoundWall", x: 28.7, z: 363.1, params: { length: 14.64, height: 2.44 } },
  { kind: "adobeHouse", x: 26.36, z: 338.32, rotY: Math.PI, params: { width: 8, depth: 9, enterable: true, tint: "#b6a68f" } },
  { kind: "compoundWall", x: -388.49, z: 45.52, params: { length: 14.77, height: 2.34 } },
  { kind: "compoundWall", x: -368.22, z: 45.52, params: { length: 14.77, height: 2.34 } },
  { kind: "compoundWall", x: -360.83, z: 70.45, rotY: Math.PI / 2, params: { length: 12.95, height: 2.34 } },
  { kind: "compoundWall", x: -388.49, z: 76.92, params: { length: 14.77, height: 2.34 } },
  { kind: "adobeHouse", x: -382.94, z: 65.09, rotY: Math.PI / 2, params: { width: 10, depth: 11 } },
  { kind: "compoundWall", x: 113.3, z: -319.84, params: { length: 13.82, height: 2.02 } },
  { kind: "compoundWall", x: 132.62, z: -319.84, params: { length: 13.82, height: 2.02 } },
  { kind: "compoundWall", x: 139.52, z: -289.37, rotY: Math.PI / 2, params: { length: 16.65, height: 2.02 } },
  { kind: "compoundWall", x: 113.3, z: -281.05, params: { length: 13.82, height: 2.02 } },
  { kind: "adobeHouse", x: 119.34, z: -300.98, params: { width: 9, depth: 11, enterable: true } },
  { kind: "compoundWall", x: -387.8, z: -196.45, params: { length: 17.75, height: 2.01 } },
  { kind: "compoundWall", x: -364.55, z: -196.45, params: { length: 17.75, height: 2.01 } },
  { kind: "compoundWall", x: -355.67, z: -171.82, rotY: Math.PI / 2, params: { length: 12.75, height: 2.01 } },
  { kind: "compoundWall", x: -396.67, z: -171.82, rotY: Math.PI / 2, params: { length: 12.75, height: 2.01 } },
  { kind: "adobeHouse", x: -381.48, z: -174.08, rotY: -Math.PI / 2, params: { width: 10, depth: 11, tint: "#b6a68f" } },
  { kind: "compoundWall", x: -138.39, z: -380.95, params: { length: 17.78, height: 2.4 } },
  { kind: "compoundWall", x: -115.12, z: -380.95, params: { length: 17.78, height: 2.4 } },
  { kind: "compoundWall", x: -106.23, z: -350.64, rotY: Math.PI / 2, params: { length: 16.54, height: 2.4 } },
  { kind: "compoundWall", x: -147.28, z: -350.64, rotY: Math.PI / 2, params: { length: 16.54, height: 2.4 } },
  { kind: "adobeHouse", x: -122.36, z: -364.4, params: { width: 8, depth: 9, ruined: true, tint: "#6d5b41" } },
  { kind: "compoundWall", x: -204.75, z: -276.5, params: { length: 10.78, height: 2.45 } },
  { kind: "compoundWall", x: -188.47, z: -276.5, params: { length: 10.78, height: 2.45 } },
  { kind: "compoundWall", x: -183.08, z: -256.03, rotY: Math.PI / 2, params: { length: 9.98, height: 2.45 } },
  { kind: "compoundWall", x: -204.75, z: -251.04, params: { length: 10.78, height: 2.45 } },
  { kind: "adobeHouse", x: -199.06, z: -269.22, params: { width: 8, depth: 10, ruined: true } },
  { kind: "compoundWall", x: 144.96, z: 227.2, params: { length: 10.44, height: 2.51 } },
  { kind: "compoundWall", x: 160.9, z: 227.2, params: { length: 10.44, height: 2.51 } },
  { kind: "compoundWall", x: 144.96, z: 263.93, params: { length: 10.44, height: 2.51 } },
  { kind: "compoundWall", x: 160.9, z: 263.93, params: { length: 10.44, height: 2.51 } },
  { kind: "adobeHouse", x: 155.04, z: 247.4, rotY: -Math.PI / 2, params: { width: 11, depth: 10 } },
  { kind: "compoundWall", x: 257.95, z: 323.68, rotY: Math.PI / 2, params: { length: 15.7, height: 2.22 } },
  { kind: "compoundWall", x: 257.95, z: 344.88, rotY: Math.PI / 2, params: { length: 15.7, height: 2.22 } },
  { kind: "compoundWall", x: 235.6, z: 352.74, params: { length: 11.23, height: 2.22 } },
  { kind: "compoundWall", x: 229.99, z: 323.68, rotY: Math.PI / 2, params: { length: 15.7, height: 2.22 } },
  { kind: "adobeHouse", x: 248.37, z: 327.16, params: { width: 10, depth: 8 } },
  { kind: "compoundWall", x: -140.19, z: 335.97, params: { length: 13.72, height: 2.57 } },
  { kind: "compoundWall", x: -120.97, z: 335.97, params: { length: 13.72, height: 2.57 } },
  { kind: "compoundWall", x: -140.19, z: 370.25, params: { length: 13.72, height: 2.57 } },
  { kind: "compoundWall", x: -120.97, z: 370.25, params: { length: 13.72, height: 2.57 } },
  { kind: "adobeHouse", x: -126.64, z: 352.04, rotY: Math.PI, params: { width: 10, depth: 8, ruined: true } },
  { kind: "compoundWall", x: 109.22, z: -364.53, params: { length: 11.54, height: 2.22 } },
  { kind: "compoundWall", x: 126.26, z: -364.53, params: { length: 11.54, height: 2.22 } },
  { kind: "compoundWall", x: 132.03, z: -342.57, rotY: Math.PI / 2, params: { length: 10.98, height: 2.22 } },
  { kind: "compoundWall", x: 109.22, z: -337.08, params: { length: 11.54, height: 2.22 } },
  { kind: "adobeHouse", x: 113.61, z: -345.74, rotY: Math.PI / 2, params: { width: 8, depth: 11, floors: 2, ruined: true, tint: "#b6a68f" } },
  { kind: "compoundWall", x: -207.54, z: 335.19, params: { length: 13.9, height: 2.59 } },
  { kind: "compoundWall", x: -188.15, z: 335.19, params: { length: 13.9, height: 2.59 } },
  { kind: "compoundWall", x: -181.2, z: 357.71, rotY: Math.PI / 2, params: { length: 11.35, height: 2.59 } },
  { kind: "compoundWall", x: -214.49, z: 357.71, rotY: Math.PI / 2, params: { length: 11.35, height: 2.59 } },
  { kind: "adobeHouse", x: -190.24, z: 344.69, rotY: -Math.PI / 2, params: { width: 10, depth: 9, ruined: true } },
  { kind: "compoundWall", x: 89.05, z: -354.12, rotY: Math.PI / 2, params: { length: 12.28, height: 2.53 } },
  { kind: "compoundWall", x: 89.05, z: -336.33, rotY: Math.PI / 2, params: { length: 12.28, height: 2.53 } },
  { kind: "compoundWall", x: 59.4, z: -330.19, params: { length: 16.1, height: 2.53 } },
  { kind: "compoundWall", x: 51.35, z: -354.12, rotY: Math.PI / 2, params: { length: 12.28, height: 2.53 } },
  { kind: "adobeHouse", x: 69.87, z: -348.48, rotY: Math.PI, params: { width: 12, depth: 8, floors: 2, tint: "#7b6a51" } },
  // ===== the roadside ==============================================================
  // Burnt-out vehicles along the two highways and the checkpoints between
  // them. Placed ON the verge rather than in the carriageway on purpose: a
  // wreck across a road is cover on the one line every hull on the map takes,
  // and this map already has four fords to be caught in.
  { kind: "car", x: 202.11, z: -198.74, rotY: -Math.PI / 2, params: { tint: "#4a4f45" } },
  { kind: "car", x: -78.12, z: 293.33, rotY: -Math.PI / 2, params: { tint: "#2f3338" } },
  { kind: "car", x: -52.8, z: 195.31, rotY: Math.PI / 2, params: { tint: "#3f4b52" } },
  { kind: "car", x: 202.12, z: 235.68, rotY: Math.PI / 2, params: { tint: "#4a4f45" } },
  { kind: "car", x: 174.06, z: -133.29, rotY: -Math.PI / 2, params: { tint: "#4a4f45" } },
  { kind: "car", x: 204.11, z: 399.3, rotY: Math.PI / 2, params: { tint: "#4a4f45" } },
  { kind: "car", x: -52.88, z: -27.81, params: { tint: "#2f3338" } },
  { kind: "car", x: 203.22, z: -279.06, rotY: Math.PI, params: { tint: "#4a4f45" } },
  { kind: "car", x: 203.24, z: 223.15, rotY: Math.PI, params: { tint: "#2f3338" } },
  { kind: "car", x: 202.81, z: -131.46, rotY: Math.PI / 2, params: { tint: "#3f4b52" } },
  { kind: "car", x: -81.83, z: -259.56, rotY: -Math.PI / 2, params: { tint: "#3f4b52" } },
  { kind: "car", x: -51.72, z: -149.59, rotY: Math.PI, params: { tint: "#3f4b52" } },
  { kind: "car", x: 177.98, z: -256.87, rotY: Math.PI / 2, params: { tint: "#2f3338" } },
  { kind: "car", x: -51.78, z: -240.28, rotY: Math.PI / 2, params: { tint: "#4a4f45" } },
  { kind: "car", x: 202.59, z: -285.51, rotY: Math.PI / 2, params: { tint: "#4a4f45" } },
  { kind: "car", x: -50.83, z: 238.48, rotY: Math.PI / 2, params: { tint: "#2f3338" } },
  { kind: "car", x: -78.25, z: 217.48, rotY: Math.PI / 2, params: { tint: "#6b463a" } },
  { kind: "barrier", x: 202.45, z: 359.73, rotY: Math.PI / 2, params: { length: 6 } },
  { kind: "barrier", x: 176.96, z: -364.44, rotY: Math.PI / 2, params: { length: 6 } },
  { kind: "barrier", x: 178.65, z: -194.13, rotY: Math.PI / 2, params: { length: 6 } },
  { kind: "barrier", x: -53.4, z: 100.06, rotY: Math.PI / 2, params: { length: 6 } },
  { kind: "barrier", x: -53.67, z: -123.54, rotY: Math.PI / 2, params: { length: 6 } },
  { kind: "barrier", x: 202.49, z: 305.81, rotY: Math.PI / 2, params: { length: 6 } },
  { kind: "barrier", x: 177.79, z: -275.43, rotY: Math.PI / 2, params: { length: 6 } },
  { kind: "barrier", x: -53.19, z: -379.2, rotY: Math.PI / 2, params: { length: 6 } },
  { kind: "barrier", x: -52.93, z: 279.96, rotY: Math.PI / 2, params: { length: 6 } },
];

/**
 * Dressing. Every region below has been checked against the road extents at the
 * top of `placements`; a road rejects nothing on its own. Blocking props are
 * held off every flag, spawn and hardstanding by `MapBuilder.keepClear`, and
 * the clearances here come from `PROP_BODIES` rather than from these numbers.
 *
 * The town has ONE tree and it grows where the water is. Everything else that
 * stands up out here is dead: thorn scrub, drifted boulders, and the rubble
 * every shelled plot is dressed with.
 */
const scatter: ScatterSpec[] = [
  { prop: "gravestone", x: -186, z: 250, width: 84, depth: 40, count: 48, scale: [0.8, 1.25], blocking: true, clearance: 0.6 },
  { prop: "rubble", x: -264, z: 106, radius: 11, count: 4, scale: [0.8, 1.25], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: -232, z: 138, radius: 11, count: 4, scale: [0.8, 1.25], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: -200, z: 138, radius: 11, count: 4, scale: [0.8, 1.25], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: 30, z: 72, radius: 11, count: 4, scale: [0.8, 1.25], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: 126, z: 104, radius: 11, count: 4, scale: [0.8, 1.25], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: 30, z: 136, radius: 11, count: 4, scale: [0.8, 1.25], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: 126, z: 136, radius: 11, count: 4, scale: [0.8, 1.25], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: 62, z: 168, radius: 11, count: 4, scale: [0.8, 1.25], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: 126, z: 168, radius: 11, count: 4, scale: [0.8, 1.25], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: -215, z: 247, radius: 11, count: 4, scale: [0.8, 1.25], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: -119, z: 247, radius: 9, count: 3, scale: [0.8, 1.2], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: -87, z: 247, radius: 11, count: 4, scale: [0.8, 1.25], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: 41, z: 247, radius: 9, count: 3, scale: [0.8, 1.2], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: -23, z: 279, radius: 9, count: 3, scale: [0.8, 1.2], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: -183, z: 311, radius: 9, count: 3, scale: [0.8, 1.2], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: -151, z: 311, radius: 9, count: 3, scale: [0.8, 1.2], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: 41, z: 311, radius: 11, count: 4, scale: [0.8, 1.25], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: 105, z: 311, radius: 11, count: 4, scale: [0.8, 1.25], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: 253, z: 148, radius: 11, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: 285, z: 148, radius: 11, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: 253, z: 180, radius: 11, count: 4, scale: [0.85, 1.3], blocking: true, clearance: 1.1 },
  { prop: "barrel", x: -142, z: -178, radius: 14, count: 9, scale: [0.9, 1.15], blocking: true, clearance: 0.55 },
  { prop: "barrel", x: -94, z: -204, radius: 12, count: 7, scale: [0.9, 1.15], blocking: true, clearance: 0.55 },
  { prop: "fireDrum", x: -174, z: -192, radius: 3, count: 1, blocking: true, clearance: 0.6 },
  // ===== the palm groves ===========================================================
  // Along the wadi, where the water is. A palm screens nothing at head height
  // and everything at fifteen metres, so a grove is a place worth crossing
  // rather than a wall to walk around — and the only cover in the bed is the
  // boles, which is what makes the wadi a route and not a trench.
  { prop: "palm", x: -172, z: -80.2, width: 54, depth: 40, count: 10, scale: [0.85, 1.2], blocking: true, clearance: 2.6 },
  { prop: "palm", x: -110, z: -75, width: 54, depth: 40, count: 11, scale: [0.85, 1.2], blocking: true, clearance: 2.6 },
  { prop: "palm", x: -48, z: -67.1, width: 54, depth: 40, count: 8, scale: [0.85, 1.2], blocking: true, clearance: 2.6 },
  { prop: "palm", x: 14, z: -57.9, width: 54, depth: 40, count: 7, scale: [0.85, 1.2], blocking: true, clearance: 2.6 },
  { prop: "palm", x: 76, z: -49.1, width: 54, depth: 40, count: 8, scale: [0.85, 1.2], blocking: true, clearance: 2.6 },
  { prop: "palm", x: 138, z: -42.2, width: 54, depth: 40, count: 10, scale: [0.85, 1.2], blocking: true, clearance: 2.6 },
  { prop: "palm", x: 200, z: -38.5, width: 54, depth: 40, count: 8, scale: [0.85, 1.2], blocking: true, clearance: 2.6 },
  { prop: "palm", x: -175, z: -80.4, radius: 26, count: 8, scale: [0.85, 1.15], blocking: true, clearance: 2.6 },
  { prop: "palm", x: 196, z: -38.6, radius: 26, count: 8, scale: [0.85, 1.15], blocking: true, clearance: 2.6 },
  { prop: "palm", x: -174, z: 154, radius: 9, count: 3, scale: [1.0, 1.2], blocking: true, clearance: 3.0 },
  { prop: "palm", x: 32, z: 106, radius: 8, count: 3, scale: [1.0, 1.2], blocking: true, clearance: 3.0 },
  // ===== the dead ground ===========================================================
  // Dry scrub, thorn and drifted boulders on the open desert between the
  // quarters. Every blocking region here is held off the roads by hand — a
  // road is visual only and rejects nothing.
  { prop: "bramble", x: -300, z: 20, width: 70, depth: 60, count: 14, scale: [0.8, 1.4] },
  { prop: "bramble", x: -90, z: -290, width: 90, depth: 60, count: 17, scale: [0.8, 1.4] },
  { prop: "bramble", x: 120, z: 40, width: 80, depth: 70, count: 17, scale: [0.8, 1.4] },
  { prop: "bramble", x: 300, z: -60, width: 90, depth: 80, count: 16, scale: [0.8, 1.4] },
  { prop: "bramble", x: -60, z: 330, width: 110, depth: 60, count: 11, scale: [0.8, 1.4] },
  { prop: "bramble", x: 260, z: -280, width: 90, depth: 70, count: 14, scale: [0.8, 1.4] },
  { prop: "bramble", x: -330, z: 200, width: 80, depth: 70, count: 17, scale: [0.8, 1.4] },
  { prop: "bramble", x: 340, z: 120, width: 80, depth: 90, count: 10, scale: [0.8, 1.4] },
  { prop: "bramble", x: -260, z: -60, width: 70, depth: 80, count: 13, scale: [0.8, 1.4] },
  { prop: "bramble", x: 30, z: -350, width: 120, depth: 60, count: 11, scale: [0.8, 1.4] },
  { prop: "boulder", x: -290.96, z: 2.58, radius: 18, count: 5, scale: [0.8, 1.35], blocking: true, clearance: 1.0 },
  { prop: "boulder", x: -108.9, z: -282.31, radius: 18, count: 4, scale: [0.8, 1.35], blocking: true, clearance: 1.0 },
  { prop: "boulder", x: 121.35, z: 27.53, radius: 14, count: 5, scale: [0.8, 1.35], blocking: true, clearance: 1.0 },
  { prop: "boulder", x: 253.73, z: -262.37, radius: 20, count: 6, scale: [0.8, 1.35], blocking: true, clearance: 1.0 },
  { prop: "boulder", x: -317.36, z: 196.03, radius: 14, count: 4, scale: [0.8, 1.35], blocking: true, clearance: 1.0 },
  { prop: "boulder", x: 343.03, z: 113.04, radius: 14, count: 6, scale: [0.8, 1.35], blocking: true, clearance: 1.0 },
  { prop: "boulder", x: -274.5, z: -47.92, radius: 19, count: 5, scale: [0.8, 1.35], blocking: true, clearance: 1.0 },
  { prop: "boulder", x: 20.49, z: -369.83, radius: 16, count: 5, scale: [0.8, 1.35], blocking: true, clearance: 1.0 },
  { prop: "deadTree", x: -140, z: -300, radius: 22, count: 6, scale: [0.8, 1.2], blocking: true, clearance: 0.8 },
  { prop: "deadTree", x: 210, z: 320, radius: 20, count: 5, scale: [0.8, 1.2], blocking: true, clearance: 0.8 },
  { prop: "deadTree", x: -350, z: 60, radius: 22, count: 6, scale: [0.8, 1.2], blocking: true, clearance: 0.8 },
  // ===== the streets ===============================================================
  // Urban clutter, and almost all of it non-blocking on purpose: a prop with
  // no collider emits no `WorldBox` and costs no ray anything, which is what
  // makes a town this size dressable at all. See coldharbour/layout.ts, which
  // is where that argument was measured.
  { prop: "litter", x: 28, z: 66, radius: 60, count: 21, scale: [0.8, 1.3], clearance: 1.2 },
  { prop: "litter", x: -32, z: 106, radius: 46, count: 19, scale: [0.8, 1.3], clearance: 1.2 },
  { prop: "litter", x: 88, z: 26, radius: 46, count: 19, scale: [0.8, 1.3], clearance: 1.2 },
  { prop: "litter", x: -182, z: 150, radius: 50, count: 26, scale: [0.8, 1.3], clearance: 1.2 },
  { prop: "litter", x: 250, z: 140, radius: 66, count: 26, scale: [0.8, 1.3], clearance: 1.2 },
  { prop: "litter", x: 190, z: -114, radius: 40, count: 26, scale: [0.8, 1.3], clearance: 1.2 },
  { prop: "litter", x: -120, z: -180, radius: 46, count: 25, scale: [0.8, 1.3], clearance: 1.2 },
  { prop: "litter", x: -60, z: 200, radius: 50, count: 18, scale: [0.8, 1.3], clearance: 1.2 },
  { prop: "litter", x: 70, z: 220, radius: 50, count: 20, scale: [0.8, 1.3], clearance: 1.2 },
  { prop: "litter", x: -200, z: 210, radius: 44, count: 16, scale: [0.8, 1.3], clearance: 1.2 },
  { prop: "litter", x: -40, z: -200, radius: 46, count: 23, scale: [0.8, 1.3], clearance: 1.2 },
  { prop: "litter", x: 60, z: -190, radius: 42, count: 20, scale: [0.8, 1.3], clearance: 1.2 },
  { prop: "trafficCone", x: -32, z: 106, radius: 32.2, count: 4, scale: [0.9, 1.1], clearance: 1.1 },
  { prop: "trafficCone", x: 88, z: 26, radius: 32.2, count: 8, scale: [0.9, 1.1], clearance: 1.1 },
  { prop: "trafficCone", x: -120, z: -180, radius: 32.2, count: 7, scale: [0.9, 1.1], clearance: 1.1 },
  { prop: "trafficCone", x: 70, z: 220, radius: 35, count: 7, scale: [0.9, 1.1], clearance: 1.1 },
  { prop: "trafficCone", x: -40, z: -200, radius: 32.2, count: 8, scale: [0.9, 1.1], clearance: 1.1 },
  { prop: "trafficCone", x: 60, z: -190, radius: 29.4, count: 6, scale: [0.9, 1.1], clearance: 1.1 },
  { prop: "palletStack", x: -110, z: -162, radius: 16, count: 3, scale: [0.9, 1.2], blocking: true, clearance: 1.6 },
  { prop: "skip", x: 230, z: 160, radius: 22, count: 3, scale: [0.9, 1.1], blocking: true, clearance: 2.4 },
  { prop: "skip", x: 68, z: 96, radius: 18, count: 2, scale: [0.9, 1.1], blocking: true, clearance: 2.4 },
  { prop: "binPair", x: -16, z: 32, radius: 20, count: 4, scale: [0.9, 1.15], blocking: true, clearance: 1.4 },
  { prop: "binPair", x: -162, z: 110, radius: 18, count: 3, scale: [0.9, 1.15], blocking: true, clearance: 1.4 },
];

const controlPoints: ControlPointDef[] = [
  { id: "A", name: "The Great Mosque", pos: new Vector3(-192, 0, 150), radius: 16 },
  { id: "B", name: "The Fuel Depot", pos: new Vector3(-120, 0, -180), radius: 15 },
  { id: "C", name: "The Souk", pos: new Vector3(28, 0, 66), radius: 17 },
  { id: "D", name: "Martyrs' Quarter", pos: new Vector3(250, 7, 140), radius: 16 },
  { id: "E", name: "The Crossing", pos: new Vector3(190, 0, -114), radius: 15 },
];

/**
 * Home spawns are uncapturable. Every control point also carries a spawn just
 * outside its capture zone, so deploying onto a flag you hold does not drop you
 * on top of whoever is contesting it. The home yards face each other down the
 * NE-SW diagonal.
 */
const spawns: SpawnPointDef[] = [
  { team: 0, pos: new Vector3(-308, 0, -302), yaw: Math.PI / 4 },
  { team: 0, pos: new Vector3(-300, 0, -311), yaw: Math.PI / 4 },
  { team: 0, pos: new Vector3(-292, 0, -320), yaw: Math.PI / 4 },
  { team: 1, pos: new Vector3(308, 0, 302), yaw: -Math.PI * 0.75 },
  { team: 1, pos: new Vector3(300, 0, 311), yaw: -Math.PI * 0.75 },
  { team: 1, pos: new Vector3(292, 0, 320), yaw: -Math.PI * 0.75 },
  { team: null, controlPoint: "A", pos: new Vector3(-156, 0, 140), yaw: -Math.PI / 2 },
  { team: null, controlPoint: "B", pos: new Vector3(-114, -0.01, -146), yaw: Math.PI },
  { team: null, controlPoint: "C", pos: new Vector3(22, 0.01, 28), yaw: 0 },
  { team: null, controlPoint: "D", pos: new Vector3(242, 7, 102), yaw: 0 },
  { team: null, controlPoint: "E", pos: new Vector3(184, 0, -154), yaw: 0 },
];

/**
 * One hardstanding a side, on the inner edge of each home yard.
 *
 * **Two, and exactly two.** The respawn is per hardstanding, so the number of
 * entries here IS how many hulls a side can ever have on the field — and it is
 * also what turns the kit's third slot on (`Game.armourOffered`), so this is
 * the map's launcher-and-mine map as well as its armour one.
 *
 * A 900 m play square is what earns them. The ground between the flags is
 * transit rather than fighting, which is exactly the problem armour exists to
 * answer — and the town answers back: the old town's alleys are seven metres
 * wide and a hull cannot turn in one, the wadi's fords are three places a
 * driver is committed and slow, and the Crossing is a flag a hull can shell
 * from outside and never take.
 *
 * **It is also the only thing on this map that costs the AUTHORITY anything
 * that grows with the extent.** A DRIVEN hull is a `moveWithCollisions`
 * against every collidable mesh in the map, measured at 0.40 ms a tick at this
 * size against 0.039 on Coldharbour (`FINDINGS.md` 31). Two hulls is under 5%
 * of the server step.
 */
const vehicles: VehicleSpawnDef[] = [
  { team: 0, pos: new Vector3(-292, 0, -316), yaw: Math.PI / 4 },
  { team: 1, pos: new Vector3(292, 0, 316), yaw: -Math.PI * 0.75 },
];

const grass: GrassRect[] = [
  // Dry scrub, and a BUDGET rather than a blanket: the field is one mesh of
  // thin instances with no culling inside it, so the cost is the tuft count
  // wherever the camera stands. These sum to well under Harrowmead's ~23,000
  // because a desert should be bare — what the rects are for is the two
  // places that are not, the wadi's damp reaches and the shade of the
  // groves.
  { x: -172, z: -80.2, width: 58, depth: 46, density: 0.4 },
  { x: -110, z: -75, width: 58, depth: 46, density: 0.4 },
  { x: -48, z: -67.1, width: 58, depth: 46, density: 0.4 },
  { x: 14, z: -57.9, width: 58, depth: 46, density: 0.4 },
  { x: 76, z: -49.1, width: 58, depth: 46, density: 0.4 },
  { x: 138, z: -42.2, width: 58, depth: 46, density: 0.4 },
  { x: 200, z: -38.5, width: 58, depth: 46, density: 0.4 },
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
