/**
 * kurenai/layout.ts — THE MAP, as data: structure placements, scatter regions,
 * control points, spawns, the grass and the three bodies of water. The water
 * rects are MEASURED off the floor by the generator.
 * The floor's shape is generated data and lives in heights.ts. Consumed by
 * MapBuilder; nothing here is code to special-case.
 * Gotchas that have already cost time: collider top faces within
 * CONFIG.nav.stepHeight of adjacent ground or bots treat decks as walls; a
 * control point's pos must NOT sit inside a PLACEMENT's collider; scatter
 * knows nothing about water, so every grove below was checked dry by the
 * generator; terrain steeper than a 0.4 gradient severs its own nav links;
 * a bridge's local zero is BANK grade, so its `y` is minus the bed under it.
 *
 * **SEEDED by `scripts/generate-kurenai.mjs`, and owned by the editor after
 * that.** The design is authored in that script and this file is the
 * transcription: flat arrays of one-line entries, which is what
 * `src/editor/sourceScan.ts` requires. Re-running the generator discards
 * editor edits.
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
 * KURENAI — a temple town in a mountain valley, in the last week of the
 * maples, an hour before sunset.
 *
 * **240 x 240 m of PLAY inside 440 m of ground**, origin at the arch
 * bridge, +Z north. Hollowmere's footprint, infantry only, eight a side.
 *
 * ```
 *                                N
 *   +-----------------------------------------------------+  z 120
 *   | temple hill                           x T1 HOME YARD |
 *   |  [A] KOYO-JI (-74,72) +3m        [E] THE INN (72,66) |
 *   |   pagoda, hall, koi pond  cross st  hot spring       |
 *   |            -- middle st --                           |
 *   |              [C] HASHIMOTO (0,28)                    |
 *   |  ~~ bridge ~~~~~~~~~ ARCH BRIDGE ~~~~~~~~~ bridge ~~ |  the river
 *   |               -- south lane --        torii stair    |
 *   |  [B] THE BREWERY (-72,-66)      [D] INARI SHRINE +5m |
 *   | x T0 HOME YARD          farm          (72,-80)       |
 *   +-----------------------------------------------------+  z -120
 * ```
 *
 * ## The ground, which is what makes it read
 *
 * **The RIVER** runs west to east across the middle, a shallow stream in a
 * channel 18 m lip to lip, cut to one bed so a single rect is wet the whole
 * way: waded anywhere, and crossed dry at three bridges — the vermilion ARCH
 * on the main street, and two plank bridges on the lines between the flags
 * either side of it. It separates the three northern flags from the two
 * southern ones without walling them off. **The TEMPLE's terrace** stands
 * three metres over the town in front of its hill in the
 * north-west, and **the SHRINE's** five up the south-east hill's flank, at the
 * top of a tunnel of vermilion torii climbing straight from the east bridge.
 *
 * ## Design intent per flag
 *
 * - **A Koyo-ji Temple** — a walled court behind a gate, a torii on the lane
 *   before it, the pagoda on one side and the bell on the other, the hall at
 *   the back and the koi pond beside it. The reference frame is its garden.
 *   The pagoda is the map's landmark and is not climbable.
 * - **B The Sake Brewery** — eight white storehouses round a working yard: the
 *   flag in the open between two rows of solid cover, with the brewer's house
 *   and the shop at the ends. The closest flag to T0's yard.
 * - **C Hashimoto** — the plaza at the north end of the arch bridge, in the
 *   middle of the town and the middle of the map; lattice-fronted townhouses
 *   on both banks of the river and down every street.
 * - **D Inari Shrine** — five metres up, at the top of a stone stair under a
 *   tunnel of torii. The high ground on the south side.
 * - **E The Hot Spring Inn** — an inn and its teahouses round a hot spring
 *   behind a garden wall, the closest flag to T1 as the brewery is to T0.
 */

const placements: Placement[] = [
  // ===== roads =====================================================================
  // Visual only: a road carries no collider, stops no round and is in no
  // baked structure. The town's streets are COBBLE — the reference frame's
  // stone path is exactly this texture — and everything that leaves the
  // town is a dirt lane. No road crosses the river: the bridges do, and
  // anybody fords it anywhere, the banks being a gentle grade the whole run.
  { kind: "road", x: 0, z: -37.58, params: { length: 34.85, width: 7, surface: "cobble" } },
  { kind: "road", x: 0, z: 63, params: { length: 42, width: 7, surface: "cobble" } },
  { kind: "road", x: 0, z: 28.09, rotY: Math.PI / 2, params: { length: 32, width: 27.82, surface: "cobble" } },
  { kind: "road", x: 0, z: 58, rotY: Math.PI / 2, params: { length: 66, width: 6, surface: "cobble" } },
  { kind: "road", x: 0, z: 84, rotY: Math.PI / 2, params: { length: 70, width: 7, surface: "cobble" } },
  { kind: "road", x: -44, z: 34, params: { path: [[28, -2], [10, -1], [-10, 1], [-28, 2]], width: 6, surface: "dirt" } },
  { kind: "road", x: 39, z: 41, params: { path: [[-23, -9], [-5, -6], [11, 1], [23, 9]], width: 6, surface: "dirt" } },
  { kind: "road", x: -72.5, z: 18.06, params: { path: [[0.5, -17.94], [-0.5, -0.06], [0.5, 17.94]], width: 5, surface: "dirt" } },
  { kind: "road", x: -72, z: -36.94, params: { path: [[0, 13.06], [0, -3.06], [0, -13.06]], width: 5, surface: "dirt" } },
  { kind: "road", x: 67, z: 29.98, params: { path: [[5, -20.02], [4, 0.02], [-5, 20.02]], width: 5, surface: "dirt" } },
  { kind: "road", x: 14, z: -51, params: { path: [[-52, -7], [-44, -1], [16, -1], [38, 5], [52, 7]], width: 6, surface: "dirt" } },
  { kind: "road", x: -64, z: -78, params: { path: [[-30, -20], [20, -18], [30, -2], [26, 20]], width: 6, surface: "dirt" } },
  { kind: "road", x: 88, z: 86, params: { path: [[8, 10], [2, -6], [-8, -10]], width: 6, surface: "dirt" } },
  { kind: "road", x: 0, z: -70.5, params: { path: [[0, 15.5], [0, -15.5]], width: 4, surface: "dirt" } },
  { kind: "road", x: 72, z: -40.02, params: { length: 51.96, width: 3.6, surface: "cobble" } },
  { kind: "road", x: -74, z: 44, params: { length: 12, width: 5, surface: "cobble" } },
  { kind: "road", x: -74, z: 55, params: { length: 8, width: 4, surface: "cobble" } },
  // ===== A: Koyo-ji Temple =========================================================
  { kind: "torii", x: -74, z: 40, params: { width: 4.8, height: 6 } },
  { kind: "templeGate", x: -74, z: 50 },
  { kind: "gardenWall", x: -85.9, z: 50, params: { length: 13.4 } },
  { kind: "gardenWall", x: -99.3, z: 50, params: { length: 13.4 } },
  { kind: "gardenWall", x: -61.85, z: 50, params: { length: 13.9 } },
  { kind: "gardenWall", x: -47.95, z: 50, params: { length: 13.9 } },
  { kind: "gardenWall", x: -106, z: 63.5, rotY: Math.PI / 2, params: { length: 25 } },
  { kind: "gardenWall", x: -106, z: 94.5, rotY: Math.PI / 2, params: { length: 25 } },
  { kind: "gardenWall", x: -41, z: 63.5, rotY: Math.PI / 2, params: { length: 25 } },
  { kind: "gardenWall", x: -41, z: 94.5, rotY: Math.PI / 2, params: { length: 25 } },
  { kind: "gardenWall", x: -91.25, z: 108, params: { length: 29.5 } },
  { kind: "gardenWall", x: -55.75, z: 108, params: { length: 29.5 } },
  { kind: "templeHall", x: -74, z: 96, params: { width: 16, depth: 12, litWindows: true } },
  { kind: "pagoda", x: -96, z: 70 },
  { kind: "bellTower", x: -52, z: 62 },
  { kind: "stonePagoda", x: -57, z: 79 },
  { kind: "teahouse", x: -97, z: 96, rotY: -Math.PI / 2, params: { width: 7, depth: 6, litWindows: true } },
  { kind: "toro", x: -78.2, z: 55, params: { litWindows: true } },
  { kind: "toro", x: -69.8, z: 55, params: { litWindows: true } },
  { kind: "toro", x: -78.2, z: 58.5, params: { litWindows: true } },
  { kind: "toro", x: -69.8, z: 58.5, params: { litWindows: true } },
  { kind: "toro", x: -86, z: 90, params: { litWindows: true } },
  { kind: "toro", x: -96, z: 82, params: { litWindows: true } },
  { kind: "toro", x: -88, z: 56, params: { litWindows: true } },
  { kind: "toro", x: -60, z: 56, params: { litWindows: true } },
  { kind: "toro", x: -45, z: 84, params: { litWindows: true } },
  // ===== B: The Sake Brewery =======================================================
  { kind: "kura", x: -98, z: -48, params: { width: 6.4, depth: 5.2, height: 5.6 } },
  { kind: "kura", x: -88, z: -48, params: { width: 6.4, depth: 5.2, height: 5.6 } },
  { kind: "kura", x: -62, z: -48, params: { width: 6.4, depth: 5.2, height: 5.6 } },
  { kind: "kura", x: -52, z: -48, params: { width: 6.4, depth: 5.2, height: 5.6 } },
  { kind: "kura", x: -93, z: -84, rotY: Math.PI, params: { width: 7, depth: 5.6, height: 6.2 } },
  { kind: "kura", x: -82, z: -84, rotY: Math.PI, params: { width: 7, depth: 5.6, height: 6.2 } },
  { kind: "kura", x: -71, z: -84, rotY: Math.PI, params: { width: 7, depth: 5.6, height: 6.2 } },
  { kind: "kura", x: -60, z: -84, rotY: Math.PI, params: { width: 7, depth: 5.6, height: 6.2 } },
  { kind: "minka", x: -100, z: -66, rotY: -Math.PI / 2, params: { width: 14, depth: 9, enterable: true, litWindows: true } },
  { kind: "machiya", x: -46, z: -75, rotY: Math.PI / 2, params: { width: 7, depth: 11, enterable: true, litWindows: true } },
  { kind: "well", x: -88, z: -74 },
  { kind: "woodpile", x: -56, z: -56 },
  { kind: "cart", x: -89, z: -57, rotY: Math.PI / 2 },
  { kind: "crates", x: -57, z: -77 },
  { kind: "toro", x: -77, z: -52, params: { litWindows: true } },
  { kind: "toro", x: -67, z: -52, params: { litWindows: true } },
  // ===== C: Hashimoto ==============================================================
  { kind: "archBridge", x: 0, z: -2.99, y: 1.2, params: { length: 18, width: 3.2 } },
  { kind: "bridge", x: -72, z: -11.88, y: 1.2, params: { length: 22, width: 3.2 } },
  { kind: "bridge", x: 72, z: -2.04, y: 1.2, params: { length: 22, width: 3.2 } },
  { kind: "torii", x: 0, z: 15.68, params: { width: 5.4, height: 5.4 } },
  { kind: "toro", x: -14, z: 16.18, params: { litWindows: true } },
  { kind: "toro", x: 14, z: 16.18, params: { litWindows: true } },
  { kind: "toro", x: -14, z: 40, params: { litWindows: true } },
  { kind: "toro", x: 14, z: 40, params: { litWindows: true } },
  // ===== D: Inari Shrine ===========================================================
  { kind: "templeHall", x: 72, z: -100, rotY: Math.PI, params: { width: 12, depth: 9, litWindows: true } },
  { kind: "torii", x: 72, z: -17.04, params: { width: 3.4, height: 4.2 } },
  { kind: "torii", x: 72, z: -20.24, params: { width: 3.4, height: 4.2 } },
  { kind: "torii", x: 72, z: -23.44, params: { width: 3.4, height: 4.2 } },
  { kind: "torii", x: 72, z: -26.64, params: { width: 3.4, height: 4.2 } },
  { kind: "torii", x: 72, z: -29.84, params: { width: 3.4, height: 4.2 } },
  { kind: "torii", x: 72, z: -33.04, params: { width: 3.4, height: 4.2 } },
  { kind: "torii", x: 72, z: -36.24, params: { width: 3.4, height: 4.2 } },
  { kind: "torii", x: 72, z: -39.44, params: { width: 3.4, height: 4.2 } },
  { kind: "torii", x: 72, z: -42.64, params: { width: 3.4, height: 4.2 } },
  { kind: "torii", x: 72, z: -45.84, params: { width: 3.4, height: 4.2 } },
  { kind: "torii", x: 72, z: -49.04, params: { width: 3.4, height: 4.2 } },
  { kind: "torii", x: 72, z: -52.24, params: { width: 3.4, height: 4.2 } },
  { kind: "torii", x: 72, z: -55.44, params: { width: 3.4, height: 4.2 } },
  { kind: "torii", x: 72, z: -58.64, params: { width: 3.4, height: 4.2 } },
  { kind: "torii", x: 72, z: -61.84, params: { width: 3.4, height: 4.2 } },
  { kind: "torii", x: 72, z: -67.5, params: { width: 5.2, height: 6.4 } },
  { kind: "toro", x: 66, z: -71, params: { litWindows: true } },
  { kind: "toro", x: 78, z: -71, params: { litWindows: true } },
  { kind: "toro", x: 63, z: -89, params: { litWindows: true } },
  { kind: "toro", x: 81, z: -89, params: { litWindows: true } },
  { kind: "teahouse", x: 93, z: -84, rotY: -Math.PI / 2, params: { width: 7, depth: 6, litWindows: true } },
  { kind: "stonePagoda", x: 56, z: -88 },
  { kind: "kura", x: 52, z: -74, rotY: Math.PI / 2 },
  // ===== E: The Hot Spring Inn =====================================================
  { kind: "minka", x: 72, z: 93, params: { width: 18, depth: 11, height: 3.2, enterable: true, litWindows: true } },
  { kind: "teahouse", x: 94, z: 68, rotY: Math.PI / 2, params: { width: 8, depth: 7, litWindows: true, lit: true } },
  { kind: "teahouse", x: 44, z: 76, rotY: Math.PI, params: { width: 6, depth: 6, litWindows: true } },
  { kind: "kura", x: 104, z: 86 },
  { kind: "gardenWall", x: 70, z: 104, params: { length: 30, tint: "#b3aa97" } },
  { kind: "toro", x: 55, z: 94, params: { litWindows: true } },
  { kind: "toro", x: 33, z: 90, params: { litWindows: true } },
  { kind: "toro", x: 63, z: 83, params: { litWindows: true } },
  { kind: "toro", x: 81, z: 83, params: { litWindows: true } },
  // ===== the town ==================================================================
  { kind: "machiya", x: -41, z: 18.85, params: { width: 6, depth: 9.1 } },
  { kind: "machiya", x: -34.16, z: 19.45, params: { width: 6.8, depth: 10.3, enterable: true, litWindows: true } },
  { kind: "machiya", x: -26.98, z: 19.4, params: { width: 6.4, depth: 10.2, litWindows: true } },
  { kind: "machiya", x: 21.05, z: 19.1, params: { width: 6.1, depth: 9.6, enterable: true } },
  { kind: "machiya", x: 28.39, z: 19.25, params: { width: 7, depth: 9.9, litWindows: true } },
  { kind: "machiya", x: 35.49, z: 18.9, params: { width: 6.2, depth: 9.2, litWindows: true } },
  { kind: "machiya", x: -40.8, z: -22.8, rotY: Math.PI, params: { width: 6.4, depth: 9, litWindows: true } },
  { kind: "machiya", x: -33.45, z: -23.75, rotY: Math.PI, params: { width: 6.8, depth: 10.9, litWindows: true, tint: "#a39478" } },
  { kind: "machiya", x: -25.67, z: -23.6, rotY: Math.PI, params: { width: 7.2, depth: 10.6, litWindows: true } },
  { kind: "machiya", x: -17.9, z: -23.55, rotY: Math.PI, params: { width: 6.9, depth: 10.5, enterable: true } },
  { kind: "machiya", x: 11.75, z: -23.35, rotY: Math.PI, params: { width: 7.5, depth: 10.1, litWindows: true, tint: "#8f7552" } },
  { kind: "machiya", x: 19.81, z: -23.3, rotY: Math.PI, params: { width: 7.1, depth: 10, tint: "#a39478" } },
  { kind: "machiya", x: 27.78, z: -22.9, rotY: Math.PI, params: { width: 7.5, depth: 9.2, enterable: true } },
  { kind: "machiya", x: 35.37, z: -23.35, rotY: Math.PI, params: { width: 6.8, depth: 10.1, litWindows: true } },
  { kind: "machiya", x: -11.1, z: 46.25, rotY: -Math.PI / 2, params: { width: 6.1, depth: 12.6, litWindows: true } },
  { kind: "machiya", x: 9.85, z: 46.6, rotY: Math.PI / 2, params: { width: 6.8, depth: 10.1, enterable: true, tint: "#a39478" } },
  { kind: "machiya", x: -10, z: 65.3, rotY: -Math.PI / 2, params: { width: 6.2, depth: 10.4, litWindows: true } },
  { kind: "machiya", x: -9.8, z: 72.11, rotY: -Math.PI / 2, params: { width: 6.6, depth: 10, litWindows: true } },
  { kind: "machiya", x: 10.95, z: 65.8, rotY: Math.PI / 2, params: { width: 7.2, depth: 12.3, litWindows: true } },
  { kind: "machiya", x: 11.15, z: 72.97, rotY: Math.PI / 2, params: { width: 6.4, depth: 12.7, litWindows: true } },
  { kind: "machiya", x: -10.05, z: -44.8, rotY: -Math.PI / 2, params: { width: 6.8, depth: 10.5, enterable: true, litWindows: true } },
  { kind: "machiya", x: -10.2, z: -37.69, rotY: -Math.PI / 2, params: { width: 6.6, depth: 10.8, litWindows: true } },
  { kind: "machiya", x: 10.6, z: -44.95, rotY: Math.PI / 2, params: { width: 6.5, depth: 11.6, enterable: true, litWindows: true } },
  { kind: "machiya", x: 10.8, z: -38.14, rotY: Math.PI / 2, params: { width: 6.4, depth: 12, enterable: true } },
  { kind: "machiya", x: -29.5, z: 68.6, params: { width: 7, depth: 12.6 } },
  { kind: "machiya", x: -22.48, z: 68.4, params: { width: 6.2, depth: 12.2, litWindows: true } },
  { kind: "machiya", x: 21.65, z: 68.1, params: { width: 7, depth: 11.6, enterable: true, tint: "#8f7552" } },
  { kind: "machiya", x: 29.14, z: 67.9, params: { width: 7, depth: 11.2, enterable: true } },
  { kind: "machiya", x: -29.9, z: 47.4, rotY: Math.PI, params: { width: 6.2, depth: 12.6, enterable: true, litWindows: true } },
  { kind: "machiya", x: -22.88, z: 47.7, rotY: Math.PI, params: { width: 6.8, depth: 12, litWindows: true } },
  { kind: "machiya", x: 21.43, z: 48.35, rotY: Math.PI, params: { width: 6.8, depth: 10.7, litWindows: true, tint: "#a39478" } },
  { kind: "machiya", x: 29.09, z: 48.65, rotY: Math.PI, params: { width: 7.2, depth: 10.1, litWindows: true, tint: "#8f7552" } },
  { kind: "machiya", x: -15.75, z: 94.8, params: { width: 6.5, depth: 12 } },
  { kind: "machiya", x: -8.87, z: 95.05, params: { width: 6.5, depth: 12.5, litWindows: true, tint: "#a39478" } },
  { kind: "machiya", x: -1.48, z: 94.05, params: { width: 6.8, depth: 10.5, enterable: true, litWindows: true } },
  { kind: "machiya", x: 6.33, z: 94.05, params: { width: 7.3, depth: 10.5, litWindows: true, tint: "#a39478" } },
  { kind: "machiya", x: 13.83, z: 94, params: { width: 6.3, depth: 10.4, enterable: true, litWindows: true } },
  { kind: "machiya", x: 20.89, z: 95, params: { width: 6.5, depth: 12.4, litWindows: true } },
  { kind: "machiya", x: 28.29, z: 94.1, params: { width: 7.6, depth: 10.6, enterable: true, litWindows: true } },
  { kind: "machiya", x: -27.05, z: -41.8, params: { width: 5.9, depth: 11.8 } },
  { kind: "machiya", x: -19.86, z: -42.4, params: { width: 7, depth: 10.6, tint: "#a39478" } },
  { kind: "machiya", x: 21.56, z: -41.75, params: { width: 7.1, depth: 11.9, litWindows: true, tint: "#a39478" } },
  { kind: "machiya", x: -24.3, z: -62.4, rotY: Math.PI, params: { width: 7.4, depth: 12.2, enterable: true, litWindows: true } },
  { kind: "machiya", x: -16.91, z: -62.6, rotY: Math.PI, params: { width: 6.5, depth: 12.6, enterable: true, tint: "#a39478" } },
  { kind: "machiya", x: -9.35, z: -62.35, rotY: Math.PI, params: { width: 7.1, depth: 12.1, litWindows: true } },
  { kind: "machiya", x: 7.01, z: -62.05, rotY: Math.PI, params: { width: 6.6, depth: 11.5, litWindows: true } },
  { kind: "machiya", x: 14.56, z: -62.6, rotY: Math.PI, params: { width: 7.6, depth: 12.6, tint: "#a39478" } },
  { kind: "machiya", x: 22, z: -61.5, rotY: Math.PI, params: { width: 6, depth: 10.4, enterable: true, litWindows: true, tint: "#8f7552" } },
  { kind: "kura", x: -35.2, z: -42.9 },
  { kind: "kura", x: -9.8, z: -19.3, rotY: -Math.PI / 2 },
  { kind: "kura", x: -21.6, z: 10.1, rotY: Math.PI },
  { kind: "kura", x: 36, z: -40.1, rotY: Math.PI },
  { kind: "kura", x: -6.6, z: 8.3 },
  { kind: "kura", x: -39.1, z: 8.8, rotY: Math.PI / 2 },
  { kind: "toro", x: -30, z: 11.2, params: { litWindows: true } },
  { kind: "toro", x: -20, z: -15.2, params: { litWindows: true } },
  { kind: "toro", x: -10, z: -15.2, params: { litWindows: true } },
  { kind: "toro", x: 10, z: 11.2, params: { litWindows: true } },
  { kind: "toro", x: 10, z: -15.2, params: { litWindows: true } },
  { kind: "toro", x: 20, z: 11.2, params: { litWindows: true } },
  { kind: "toro", x: 20, z: -15.2, params: { litWindows: true } },
  { kind: "toro", x: 30, z: 11.2, params: { litWindows: true } },
  { kind: "toro", x: 30, z: -15.2, params: { litWindows: true } },
  { kind: "toro", x: 40, z: 11.2, params: { litWindows: true } },
  { kind: "toro", x: 40, z: -15.2, params: { litWindows: true } },
  // ===== the farm ==================================================================
  { kind: "minka", x: -6, z: -100, params: { width: 12, depth: 8, enterable: true, litWindows: true } },
  { kind: "kura", x: 12, z: -100, rotY: Math.PI / 2 },
  { kind: "woodpile", x: -16, z: -92, rotY: Math.PI / 2 },
  { kind: "cart", x: 7, z: -89 },
  // ===== the hamlets ===============================================================
  { kind: "minka", x: -102.3, z: 15, params: { width: 12.1, depth: 8.5, enterable: true, litWindows: true } },
  { kind: "minka", x: -86.5, z: 14.3, rotY: Math.PI / 2, params: { width: 11.4, depth: 8.1, litWindows: true } },
  { kind: "kura", x: -103.7, z: 43.5, rotY: Math.PI },
  { kind: "kura", x: -86.2, z: 42.5 },
  { kind: "kura", x: 85.4, z: 10.1 },
  { kind: "cart", x: 79.76, z: 15.44, rotY: Math.PI },
  { kind: "minka", x: 100.9, z: 11.4, rotY: Math.PI / 2, params: { width: 10, depth: 7.4 } },
  { kind: "kura", x: 87, z: 26.7, rotY: -Math.PI / 2 },
  { kind: "kura", x: 102.5, z: 24.7, rotY: -Math.PI / 2 },
  { kind: "kura", x: 87.4, z: 42, rotY: -Math.PI / 2 },
  { kind: "kura", x: 103.3, z: 39.2, rotY: Math.PI / 2 },
  { kind: "kura", x: -40.7, z: -104.9 },
  { kind: "torii", x: -40, z: 33.5, rotY: Math.PI / 2, params: { width: 5.4, height: 4.6 } },
  { kind: "torii", x: 40, z: 37, rotY: Math.PI / 2, params: { width: 5.4, height: 4.6 } },
  // ===== the home yards ============================================================
];

const scatter: ScatterSpec[] = [
  // ===== the precincts =============================================================
  { prop: "maple", x: -100, z: 58, radius: 3, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -88, z: 102, radius: 4, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -48, z: 70, radius: 4, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -45, z: 55, radius: 3, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -108, z: 30, radius: 7, count: 4, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -88, z: 30, radius: 6, count: 3, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -56, z: 22, radius: 6, count: 3, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 64.5, z: -18, radius: 4, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 79.5, z: -18, radius: 4, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 64.5, z: -26, radius: 4, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 79.5, z: -26, radius: 4, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 64.5, z: -34, radius: 4, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 79.5, z: -34, radius: 4, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 64.5, z: -42, radius: 4, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 79.5, z: -42, radius: 4, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 64.5, z: -50, radius: 4, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 79.5, z: -50, radius: 4, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 64.5, z: -58, radius: 4, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 79.5, z: -58, radius: 4, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 56, z: -98, radius: 5, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 90, z: -98, radius: 5, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 56, z: -64, radius: 4, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 92, z: 84, radius: 4, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "bamboo", x: 104, z: -40, radius: 7, count: 5, scale: [0.85, 1.15], clearance: 0.9 },
  // ===== the woods =================================================================
  { prop: "maple", x: -110, z: -105.8, radius: 6, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -85.7, z: -109.3, radius: 3.5, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -69.6, z: -109, radius: 6, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -44.6, z: -109.2, radius: 6, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -30.9, z: -107.7, radius: 6, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -6.4, z: -110.1, radius: 6, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 12, z: -108.9, radius: 6, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 35.8, z: -110.2, radius: 6, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 55.1, z: -110.6, radius: 6, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 74.7, z: -110.4, radius: 6, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 94.9, z: -106.3, radius: 10, count: 6, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "pine", x: 111.8, z: -105.4, radius: 3.5, count: 1, scale: [0.95, 1.4], blocking: true, clearance: 1.3 },
  { prop: "maple", x: -109.6, z: -84.6, radius: 3.5, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -86.9, z: -91, radius: 6, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -66.9, z: -91.6, radius: 10, count: 3, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -47.6, z: -87.1, radius: 10, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -31.5, z: -85.3, radius: 10, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -5.7, z: -90.7, radius: 10, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 8.2, z: -86.7, radius: 10, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 30, z: -86.3, radius: 10, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 51.3, z: -91.7, radius: 6, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 91.2, z: -86.2, radius: 6, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 108.2, z: -89.1, radius: 6, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -108.7, z: -71.4, radius: 6, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -90.7, z: -64.6, radius: 6, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -44.4, z: -65.7, radius: 10, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -24.5, z: -66.8, radius: 10, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -6.4, z: -67.3, radius: 10, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 15.1, z: -70.1, radius: 10, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 35.6, z: -70.5, radius: 10, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 55.2, z: -67.5, radius: 3.5, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 91.3, z: -69.2, radius: 6, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 112.2, z: -64.4, radius: 3.5, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -112, z: -46, radius: 3.5, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -88.8, z: -49, radius: 3.5, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -67.5, z: -49, radius: 3.5, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -50.1, z: -51.8, radius: 6, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -28.6, z: -44.2, radius: 10, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -10.3, z: -47.5, radius: 10, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 8.2, z: -47.7, radius: 10, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 34.7, z: -46.1, radius: 10, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 55.4, z: -47.2, radius: 10, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 70.3, z: -49.7, radius: 10, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 92.2, z: -51.8, radius: 10, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 108.4, z: -48.1, radius: 6, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -107.7, z: -31.3, radius: 6, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -84.2, z: -25.3, radius: 3.5, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -65.5, z: -25, radius: 3.5, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -48.8, z: -27, radius: 6, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -26.5, z: -28.4, radius: 10, count: 4, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -9, z: -24.5, radius: 10, count: 4, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 9.6, z: -31.7, radius: 10, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 33.8, z: -25.8, radius: 10, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 50.7, z: -24.9, radius: 10, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 72.5, z: -29.2, radius: 10, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 93, z: -29.3, radius: 10, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 111.3, z: -24.1, radius: 3.5, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -105.3, z: 8.1, radius: 6, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -92, z: 11.5, radius: 10, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -64.6, z: 9.8, radius: 10, count: 6, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -46, z: 16, radius: 10, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -24.5, z: 8.3, radius: 3.5, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 54.3, z: 15.2, radius: 6, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 68.6, z: 15.2, radius: 6, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 91.3, z: 10.5, radius: 3.5, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 110.3, z: 13.7, radius: 6, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -109.5, z: 35.5, radius: 6, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -88.4, z: 29.5, radius: 10, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -70.3, z: 30.3, radius: 10, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -47, z: 31.5, radius: 10, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -27.3, z: 29.5, radius: 10, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 34.5, z: 34.2, radius: 10, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 49.4, z: 28.9, radius: 10, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 74.3, z: 30.7, radius: 10, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 92, z: 28.6, radius: 10, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -109.3, z: 54.1, radius: 6, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -89.5, z: 51.4, radius: 6, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -69.7, z: 52.6, radius: 6, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -49.3, z: 49.6, radius: 10, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -29.1, z: 54.8, radius: 10, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -10.7, z: 54.9, radius: 10, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 12, z: 49.8, radius: 6, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 31.4, z: 53.8, radius: 10, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 53, z: 48.5, radius: 6, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 90.9, z: 50.1, radius: 6, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 108.5, z: 52.7, radius: 6, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -108.8, z: 75.4, radius: 6, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -91.6, z: 75.7, radius: 3.5, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -48.8, z: 71.7, radius: 10, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -26.6, z: 71.4, radius: 10, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -4.8, z: 75.6, radius: 10, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 12.7, z: 69.2, radius: 10, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 33.6, z: 72.8, radius: 10, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 51.7, z: 69, radius: 6, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 91.8, z: 70.2, radius: 6, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 112.9, z: 73.5, radius: 3.5, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -111, z: 96, radius: 6, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -85.5, z: 94.8, radius: 10, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -69.9, z: 94, radius: 3.5, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -27.3, z: 88.8, radius: 10, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -6.4, z: 91.1, radius: 10, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 10, z: 89.9, radius: 10, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 75.6, z: 88.3, radius: 10, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 95.3, z: 88.7, radius: 6, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -87.3, z: 110.2, radius: 6, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -65.5, z: 109, radius: 3.5, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: -10.2, z: 110.3, radius: 6, count: 2, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 32.3, z: 111.1, radius: 3.5, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 53.9, z: 111.8, radius: 3.5, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 69.5, z: 111.3, radius: 3.5, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  { prop: "maple", x: 112.5, z: 110.1, radius: 3.5, count: 1, scale: [1.1, 1.55], blocking: true, clearance: 1.8 },
  // ===== the fallen leaves =========================================================
  { prop: "leafLitter", x: -51.3, z: -109.1, radius: 7, count: 8, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: -16.9, z: -108.5, radius: 7, count: 8, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: 13, z: -110.2, radius: 7, count: 8, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: -108.7, z: -90.9, radius: 7, count: 8, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: -95.6, z: -89.7, radius: 7, count: 8, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: 89.1, z: -89.3, radius: 7, count: 8, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: -37.5, z: -35.6, radius: 7, count: 8, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: -24, z: -34.4, radius: 7, count: 8, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: -3.8, z: -38.4, radius: 7, count: 8, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: 15.2, z: -33.8, radius: 7, count: 8, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: 2, z: -24.8, radius: 7, count: 8, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: 48.9, z: -20.3, radius: 7, count: 8, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: 84, z: -23.1, radius: 7, count: 8, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: -16.1, z: 19.7, radius: 7, count: 8, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: -6.1, z: 14.1, radius: 7, count: 8, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: 11, z: 16.1, radius: 7, count: 8, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: 53.7, z: 18, radius: 7, count: 8, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: 70.6, z: 18.8, radius: 7, count: 8, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: 104.7, z: 11.7, radius: 7, count: 8, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: 0.1, z: 30.9, radius: 7, count: 8, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: 14.5, z: 30.8, radius: 7, count: 8, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: -92.1, z: 56, radius: 7, count: 8, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: -5.2, z: 52.1, radius: 7, count: 8, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: 11.1, z: 56.2, radius: 7, count: 8, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: -96.5, z: 69.8, radius: 7, count: 8, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: -4.8, z: 66, radius: 7, count: 8, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: 15.4, z: 65.8, radius: 7, count: 8, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: -6.1, z: 89.5, radius: 7, count: 8, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: 20.4, z: 91.3, radius: 7, count: 8, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: -3.4, z: 108.5, radius: 7, count: 8, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: 11.7, z: 107.1, radius: 7, count: 8, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: 92.5, z: 102.9, radius: 7, count: 8, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: 101.7, z: 102.8, radius: 7, count: 8, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: -74, z: 44, radius: 4, count: 3, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: -74, z: 55, radius: 4, count: 3, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: 0, z: 20, radius: 4, count: 3, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: 0, z: 36, radius: 4, count: 3, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: -8, z: 50, radius: 4, count: 3, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: 6, z: -30, radius: 4, count: 3, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: 0, z: 70, radius: 4, count: 3, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: 72, z: -30, radius: 4, count: 3, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: 72, z: -50, radius: 4, count: 3, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: 72, z: 60, radius: 4, count: 3, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: -72, z: -56, radius: 4, count: 3, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: -96, z: 90, radius: 4, count: 3, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: -90, z: 58, radius: 4, count: 3, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: -56, z: 70, radius: 4, count: 3, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: -86, z: 84, radius: 4, count: 3, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: -60, z: 86, radius: 4, count: 3, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: -100, z: 60, radius: 4, count: 3, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: 60, z: -92, radius: 4, count: 3, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: 86, z: -70, radius: 4, count: 3, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: 58, z: 80, radius: 4, count: 3, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: 88, z: 76, radius: 4, count: 3, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: -86, z: -60, radius: 4, count: 3, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: -58, z: -72, radius: 4, count: 3, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: -14, z: 34, radius: 4, count: 3, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: 14, z: 18, radius: 4, count: 3, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: 24, z: 58, radius: 4, count: 3, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "leafLitter", x: -24, z: 84, radius: 4, count: 3, scale: [0.9, 1.3], clearance: 0.6 },
  // ===== the riverbanks ============================================================
  { prop: "boulder", x: -114, z: -4.1, radius: 3, count: 2, scale: [0.5, 0.9], blocking: true, clearance: 1.0 },
  { prop: "boulder", x: -98, z: -15.3, radius: 3, count: 2, scale: [0.5, 0.9], blocking: true, clearance: 1.0 },
  { prop: "boulder", x: -50, z: -4.7, radius: 3, count: 2, scale: [0.5, 0.9], blocking: true, clearance: 1.0 },
  { prop: "boulder", x: -34, z: -14.2, radius: 3, count: 2, scale: [0.5, 0.9], blocking: true, clearance: 1.0 },
  { prop: "boulder", x: 30, z: 4.7, radius: 3, count: 2, scale: [0.5, 0.9], blocking: true, clearance: 1.0 },
  { prop: "boulder", x: 46, z: -4.3, radius: 3, count: 2, scale: [0.5, 0.9], blocking: true, clearance: 1.0 },
  { prop: "boulder", x: 94, z: 0.2, radius: 3, count: 2, scale: [0.5, 0.9], blocking: true, clearance: 1.0 },
  { prop: "boulder", x: 110, z: -14.4, radius: 3, count: 2, scale: [0.5, 0.9], blocking: true, clearance: 1.0 },
  { prop: "boulder", x: -42.6, z: 97.1, radius: 1.2, count: 1, scale: [0.45, 0.75], blocking: true, clearance: 0.4 },
  { prop: "boulder", x: -48.5, z: 101.6, radius: 1.2, count: 1, scale: [0.45, 0.75], blocking: true, clearance: 0.4 },
  { prop: "boulder", x: -55, z: 102, radius: 1.2, count: 1, scale: [0.45, 0.75], blocking: true, clearance: 0.4 },
  { prop: "boulder", x: -61.2, z: 98.6, radius: 1.2, count: 1, scale: [0.45, 0.75], blocking: true, clearance: 0.4 },
  { prop: "boulder", x: -62.4, z: 90.9, radius: 1.2, count: 1, scale: [0.45, 0.75], blocking: true, clearance: 0.4 },
  { prop: "boulder", x: -56.5, z: 86.4, radius: 1.2, count: 1, scale: [0.45, 0.75], blocking: true, clearance: 0.4 },
  { prop: "boulder", x: -50, z: 86, radius: 1.2, count: 1, scale: [0.45, 0.75], blocking: true, clearance: 0.4 },
  { prop: "boulder", x: -43.8, z: 89.4, radius: 1.2, count: 1, scale: [0.45, 0.75], blocking: true, clearance: 0.4 },
  { prop: "boulder", x: 53.9, z: 95.1, radius: 1.2, count: 1, scale: [0.45, 0.75], blocking: true, clearance: 0.4 },
  { prop: "boulder", x: 48, z: 99.6, radius: 1.2, count: 1, scale: [0.45, 0.75], blocking: true, clearance: 0.4 },
  { prop: "boulder", x: 41.5, z: 100, radius: 1.2, count: 1, scale: [0.45, 0.75], blocking: true, clearance: 0.4 },
  { prop: "boulder", x: 34.4, z: 97.1, radius: 1.2, count: 1, scale: [0.45, 0.75], blocking: true, clearance: 0.4 },
  { prop: "boulder", x: 24.3, z: 85.9, radius: 1.2, count: 1, scale: [0.45, 0.75], blocking: true, clearance: 0.4 },
  { prop: "boulder", x: 39.6, z: 83.7, radius: 1.2, count: 1, scale: [0.45, 0.75], blocking: true, clearance: 0.4 },
  { prop: "boulder", x: 46.5, z: 84, radius: 1.2, count: 1, scale: [0.45, 0.75], blocking: true, clearance: 0.4 },
  { prop: "boulder", x: 52.7, z: 87.4, radius: 1.2, count: 1, scale: [0.45, 0.75], blocking: true, clearance: 0.4 },
  // ===== the borderland ============================================================
  { prop: "maple", x: -160, z: 177.8, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: -160, z: -167.6, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: 175.2, z: -160, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: -152.9, z: -160, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: -135.4, z: 150.4, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: -135.4, z: -173.5, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: 133.1, z: -135.4, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: -141.9, z: -135.4, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: -110.8, z: 144.7, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: -110.8, z: -155.8, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: 147.5, z: -110.8, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: -178.4, z: -110.8, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: -86.2, z: 161.8, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: -86.2, z: -178.2, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: 139.5, z: -86.2, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: -160.2, z: -86.2, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: -61.5, z: 177.4, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: -61.5, z: -145.6, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: 162.4, z: -61.5, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: -165.3, z: -61.5, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: -36.9, z: 134.1, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: -36.9, z: -175, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: 138.3, z: -36.9, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: -161.3, z: -36.9, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: -12.3, z: 161.7, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: -12.3, z: -162.1, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: 12.3, z: 170.3, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: 12.3, z: -156.2, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: 158.2, z: 12.3, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: 36.9, z: 173.6, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: 36.9, z: -136.7, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: 150.7, z: 36.9, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: -170.8, z: 36.9, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: 61.5, z: 147.5, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: 61.5, z: -137.3, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: 139.5, z: 61.5, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: -169.4, z: 61.5, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: 86.2, z: 146, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: 86.2, z: -144.1, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: 163.4, z: 86.2, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: -144.6, z: 86.2, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: 110.8, z: 156.3, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: 110.8, z: -145, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: 136.7, z: 110.8, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: -138.3, z: 110.8, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: 135.4, z: 148.4, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: 135.4, z: -157.5, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: 135, z: 135.4, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: -166.5, z: 135.4, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: 160, z: 178, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: 160, z: -152.6, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: 138.8, z: 160, radius: 12, count: 5, scale: [0.9, 1.3] },
  { prop: "maple", x: -137.4, z: 160, radius: 12, count: 5, scale: [0.9, 1.3] },
];

const controlPoints: ControlPointDef[] = [
  { id: "A", name: "Koyo-ji Temple", pos: new Vector3(-74, 3, 72), radius: 13 },
  { id: "B", name: "The Sake Brewery", pos: new Vector3(-72, 0.5, -66), radius: 13 },
  { id: "C", name: "Hashimoto", pos: new Vector3(0, 0, 28), radius: 13 },
  { id: "D", name: "Inari Shrine", pos: new Vector3(72, 5, -80), radius: 12 },
  { id: "E", name: "The Hot Spring Inn", pos: new Vector3(72, 1, 66), radius: 13 },
];

/**
 * Home spawns are uncapturable; every flag also carries a spawn just outside
 * its ring. The home yards face each other down the SW-NE diagonal.
 */
const spawns: SpawnPointDef[] = [
  { team: 0, pos: new Vector3(-106, 0.5, -94), yaw: Math.PI / 4 },
  { team: 0, pos: new Vector3(-100, 0.5, -100), yaw: Math.PI / 4 },
  { team: 0, pos: new Vector3(-94, 0.5, -106), yaw: Math.PI / 4 },
  { team: 1, pos: new Vector3(106, 1, 94), yaw: -Math.PI * 0.75 },
  { team: 1, pos: new Vector3(100, 1, 100), yaw: -Math.PI * 0.75 },
  { team: 1, pos: new Vector3(94, 1, 106), yaw: -Math.PI * 0.75 },
  { team: null, controlPoint: "A", pos: new Vector3(-74, 3, 55), yaw: 0 },
  { team: null, controlPoint: "B", pos: new Vector3(-72, 0.5, -49), yaw: Math.PI },
  { team: null, controlPoint: "C", pos: new Vector3(0, 0, 46), yaw: Math.PI },
  { team: null, controlPoint: "D", pos: new Vector3(72, 4.67, -63), yaw: Math.PI },
  { team: null, controlPoint: "E", pos: new Vector3(60, 1, 54), yaw: Math.PI / 4 },
];

const water: WaterRect[] = [
  // The river, one rect the whole run: the channel is cut to one bed so a
  // single level surface is wet along all of it (Harrowmead's stream), and
  // it runs out through the borderland into the hills. A rect this deep is
  // mostly dry bank — the floor decides where the water is, and the rect is
  // only where it may be.
  { x: 0, z: -6, width: 440, depth: 38, y: -0.5, sound: "stream" },
  // The temple's koi pond, dug into the court beside the hall.
  { x: -50.88, z: 91.38, width: 27.75, depth: 24.75, y: 2.7 },
  // The inn's hot spring, dug into its garden.
  { x: 42.25, z: 92, width: 28.5, depth: 30, y: 0.7 },
];

const grass: GrassRect[] = [
  // Autumn grass: gold-tipped, and a BUDGET rather than a blanket (the
  // field is one mesh of thin instances with no culling inside it). What it
  // is for is the ground that is not wood or town — the meadows between the
  // flags, the riverbanks and the courts' margins.
  { x: -97, z: -95.4, width: 30, depth: 26, density: 0.21 },
  { x: 7.2, z: -98.1, width: 30, depth: 26, density: 0.17 },
  { x: 82, z: -100.2, width: 30, depth: 26, density: 0.15 },
  { x: -105.6, z: -61.5, width: 30, depth: 26, density: 0.21 },
  { x: -62.6, z: -69.1, width: 30, depth: 26, density: 0.18 },
  { x: 7.5, z: -69.5, width: 30, depth: 26, density: 0.18 },
  { x: 49, z: -61.6, width: 30, depth: 26, density: 0.2 },
  { x: 77.7, z: -67.3, width: 30, depth: 26, density: 0.18 },
  { x: -96.9, z: -25.8, width: 30, depth: 26, density: 0.19 },
  { x: -104, z: 44.4, width: 30, depth: 26, density: 0.19 },
  { x: 79.3, z: 47.2, width: 30, depth: 26, density: 0.16 },
  { x: -101.5, z: 81.4, width: 30, depth: 26, density: 0.21 },
  { x: -67.9, z: 83.5, width: 30, depth: 26, density: 0.2 },
  { x: 46.5, z: 85.2, width: 30, depth: 26, density: 0.22 },
  { x: 79, z: 76, width: 30, depth: 26, density: 0.2 },
  { x: -104, z: -10.8, width: 26, depth: 30, density: 0.28 },
  { x: -78, z: -12, width: 26, depth: 30, density: 0.28 },
  { x: -52, z: -10.5, width: 26, depth: 30, density: 0.28 },
  { x: 52, z: -0.3, width: 26, depth: 30, density: 0.28 },
  { x: 78, z: -2.8, width: 26, depth: 30, density: 0.28 },
  { x: 104, z: -6.7, width: 26, depth: 30, density: 0.28 },
];

export const KurenaiLayout: MapLayout = {
  placements,
  scatter,
  controlPoints,
  spawns,
  water,
  grass,
  /** The play square. `heights.size * heights.cell` equals it (80 x 3). */
  size: 240,
  /**
   * Four: the ground, a plinth or a deck, and the roof slabs over them — the
   * pagoda stacks five roofs over one plinth, and its colliders are emitted
   * walked-first so what overflows is a roof nobody stands on.
   */
  surfaces: 4,
  /**
   * Two and a half times the default, which is DRAW CALLS and nothing else:
   * under a 280 m haze the whole square is in view from anywhere in it, so a
   * merge block never leaves the frame for being far away and a fine grid
   * buys the cull nothing. Every block carries a draw per material — the
   * maples alone are eight — so the count of blocks in view is the draw
   * count. Measured warm at the centre flag: 48 m ran 118 fps on 445 draws,
   * 96 m 148, 120 m 154, 160 m 160; this is the play square in 2 x 2.
   */
  blockSize: 120,
  /**
   * No wall: the valley carries on for 100 m past the play square and the
   * leash is what stops you. The margin is the leash's floor with room over,
   * and no more, because what closes this horizon is the MOUNTAINS standing
   * on it — the rim below — and a landform closes a horizon at any distance
   * (Coldharbour's argument). Kept short so the ridges' feet stand inside the
   * haze rather than past it: seen from the play square they are the
   * reference frame's pale mountains, a silhouette most of the way into the
   * fog. `roll` is bounded by the river running out through the margin
   * (Greyfen's rule): its bed is 1.2 m down and the roll may not lift it dry.
   */
  borderland: { margin: 100, roll: 1.2, ease: 40 },
  /**
   * Mountains: rolling downs with summits and saddles along the crest and
   * woods on the lower slopes, steep enough (an angle of 0.19 from the map's
   * centre) to stand over the valley as ranges rather than as a bank. Two
   * passes where the river leaves.
   */
  ridge: {
    form: "downs",
    slope: 0.19,
    slopeVariance: 0.04,
    passes: [
      { x: -220, z: -8.9, width: 80, depth: 0.7 },
      { x: 220, z: -9.1, width: 80, depth: 0.7 },
    ],
    rolling: { relief: 0.35, summits: 10, knolls: 0.18, woods: 0.55 },
    seed: 0x4b555246,
  },
  seed: 0x4b555245,
};
