/**
 * candyland/layout.ts — THE MAP, as data: structure placements, scatter
 * regions, control points, spawns, the grass and the Ice Cream Sea. The sea's
 * rect is MEASURED off the floor by the generator.
 * The floor's shape is generated data and lives in heights.ts. Consumed by
 * MapBuilder; nothing here is code to special-case.
 * Gotchas that have already cost time: collider top faces within
 * CONFIG.nav.stepHeight of adjacent ground or bots treat decks as walls; a
 * control point's pos must NOT sit inside a PLACEMENT's collider; scatter
 * knows nothing about water, so every region below was checked dry by the
 * generator; terrain steeper than a 0.4 gradient severs its own nav links; an
 * ice cream float's `y` puts its waterline at the sea's surface.
 *
 * **SEEDED by `scripts/generate-candyland.mjs`, and owned by the editor
 * after that.** The design is authored in that script and this file is the
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
 * CANDY LAND — the 1962 board game's board, on a bright spring afternoon.
 *
 * **300 x 300 m of PLAY inside 500 m of ground**, +Z up the board
 * (north), infantry only, eight a side.
 *
 * ```
 *                                  N
 *   +--------------------------------------------------------+  z 150
 *   | MOLASSES    [A] HOME SWEET HOME (20,86)    ICE CREAM SEA |
 *   |  SWAMP ~~     ======== the path =========   ~~ floats ~~  |
 *   |  =========================================  LOLLYPOP     |
 *   | [B] PEANUT BRITTLE    [C] PLUM TREE (-3,-8)   WOODS  x T1 |
 *   |  HOUSE (-101,12)   =====================     [D] GUMDROP  |
 *   |  ==============  =============================  MOUNTAINS |
 *   |   rainbow trail  ============================  (88,-22)  |
 *   | x T0 START  ============================     PEPPERMINT  |
 *   |              [E] CANDY HEARTS (45,-134)       STICK FOREST|
 *   +--------------------------------------------------------+  z -150
 * ```
 *
 * ## The board, which is the whole design
 *
 * The rainbow path is the 1962 board's own, traced off a photograph of it
 * (see the generator) and laid across the lawn as one 1657 m road of
 * 230 spaces: purple, yellow, blue, orange, green, red and round again,
 * lavender where the board has a picture, a black dot on its two cherry
 * pitfalls and its molasses space. The Rainbow Trail and the Mountain Pass are
 * its two short cuts. Every landmark stands where the board draws it.
 *
 * ## Design intent per flag
 *
 * - **A Home Sweet Home** — the gingerbread house the path ends at, iced pink,
 *   enterable, in a front yard behind a peppermint fence. The closest flag to
 *   T1 but for D.
 * - **B Peanut Brittle House** — the crooked old cottage on the left, and its
 *   yard in the bend of the path. The closest flag to T0.
 * - **C Gingerbread Plum Tree** — the board's middle and the map's landmark,
 *   twenty-six metres of tree on a low knoll with lawns all round it.
 * - **D Gumdrop Mountains** — a plateau three metres up among gumdrops as big
 *   as houses, the Mountain Pass climbing through. The high ground, on T1's
 *   side.
 * - **E Candy Hearts** — conversation hearts along the bottom of the board,
 *   the Peppermint Stick Forest beside them. On T0's side.
 */

const placements: Placement[] = [
  // ===== the path ==================================================================
  // The board's own rainbow path, traced off the 1962 board START to HOME.
  // Visual only, like every road: no collider, no nav, no cover — but it is in
  // the road footprint, so nothing grows through it. `tiles` is the spaces in
  // order, the board's colour cycle with its picture spaces in lavender (`l`)
  // and its sticky spaces carrying a black dot (a capital).
  { kind: "road", x: 0.12, z: 0.62, params: { path: [[-76.07, -124.34], [-73.87, -123.97], [-70.71, -123.47], [-67.17, -122.78], [-63.82, -121.89], [-60.7, -120.78], [-57.54, -119.46], [-54.46, -117.95], [-51.57, -116.26], [-48.95, -114.26], [-46.52, -112], [-44.16, -109.72], [-41.77, -107.68], [-38.59, -105.29], [-35.42, -103.18], [-31.97, -101.56], [-29.08, -100.72], [-26, -100.16], [-22.84, -99.87], [-19.72, -99.84], [-16.55, -100.12], [-13.32, -100.7], [-10.22, -101.46], [-7.47, -102.29], [-4.58, -103.48], [-2.19, -104.86], [0.37, -106.46], [3.26, -108.4], [6.3, -110.57], [9.68, -112.59], [12.54, -113.94], [15.62, -115.22], [18.8, -116.41], [21.93, -117.48], [24.99, -118.43], [28.05, -119.27], [31.12, -120.02], [34.18, -120.67], [37.24, -121.27], [40.3, -121.81], [43.37, -122.2], [46.43, -122.39], [49.52, -122.35], [52.63, -122.13], [55.7, -121.73], [58.68, -121.16], [62.54, -120.14], [66.26, -118.83], [69.71, -117.24], [72.88, -115.41], [75.79, -113.3], [78.28, -110.87], [80.41, -108], [82.14, -104.81], [83.18, -101.56], [83.43, -98.24], [82.99, -94.86], [81.96, -91.76], [80.34, -89.03], [78.13, -86.57], [75.34, -84.41], [72.83, -83.01], [69.97, -81.78], [66.85, -80.7], [63.58, -79.76], [60.11, -78.94], [56.41, -78.24], [52.62, -77.7], [48.88, -77.31], [45.21, -77.11], [41.53, -77.08], [37.85, -77.17], [34.18, -77.31], [30.5, -77.56], [26.83, -77.92], [23.15, -78.28], [19.48, -78.53], [15.81, -78.63], [12.13, -78.65], [8.46, -78.61], [4.78, -78.53], [1.02, -78.44], [-2.8, -78.31], [-6.5, -78.11], [-9.92, -77.79], [-14.02, -77.25], [-17.71, -76.53], [-20.94, -75.34], [-23.89, -73.45], [-26.37, -71.11], [-27.8, -68.73], [-27.45, -65.04], [-25.11, -61.87], [-22.79, -60.64], [-19.75, -59.89], [-16.04, -59.42], [-12.7, -59.28], [-8.89, -59.36], [-4.86, -59.47], [-0.85, -59.42], [2.4, -59.19], [5.77, -58.86], [9.14, -58.49], [12.37, -58.16], [15.32, -57.95], [19.45, -57.88], [23.06, -58.01], [26.83, -58.19], [29.97, -58.32], [33.22, -58.48], [36.52, -58.68], [39.82, -58.93], [43.15, -59.25], [46.54, -59.64], [49.87, -60.03], [53.04, -60.4], [56.91, -60.87], [60.56, -61.31], [64.32, -61.62], [67.31, -61.72], [70.38, -61.74], [73.48, -61.7], [76.57, -61.62], [79.69, -61.53], [82.85, -61.41], [85.93, -61.21], [88.82, -60.89], [92.27, -60.29], [95.44, -59.5], [98.61, -58.44], [101.84, -57.04], [105.07, -55.37], [108.41, -53.54], [111.11, -52.07], [113.94, -50.51], [116.7, -48.87], [119.19, -47.17], [122.13, -44.86], [124.72, -42.43], [126.79, -39.82], [128.22, -37.01], [129.12, -34], [129.73, -30.75], [130.09, -27.1], [130.15, -23.21], [129.97, -19.48], [129.55, -16.05], [128.89, -12.78], [128.01, -9.68], [127.02, -6.78], [125.82, -4.04], [124.1, -1.35], [121.68, 1.38], [118.73, 4.05], [115.52, 6.48], [112.96, 8.13], [110.23, 9.67], [107.39, 11.02], [104.49, 12.12], [101.5, 12.91], [98.4, 13.45], [95.28, 13.81], [92.24, 14.08], [88.31, 14.29], [84.47, 14.28], [80.73, 14.08], [77.15, 13.72], [73.69, 13.16], [70.19, 12.36], [66.5, 11.33], [62.78, 10.06], [59.41, 8.44], [56.57, 6.48], [54.09, 4.17], [51.82, 1.34], [50.29, -1.3], [48.92, -4.32], [47.59, -7.46], [46.18, -10.42], [44.68, -13.2], [43.15, -15.92], [41.55, -18.53], [39.82, -20.96], [37.38, -24.03], [34.74, -26.82], [31.73, -29.04], [28.14, -30.48], [24.17, -31.35], [20.22, -31.98], [16.57, -32.39], [12.94, -32.55], [8.94, -32.71], [5.39, -32.82], [1.5, -32.88], [-2.34, -33.04], [-5.75, -33.45], [-9.38, -34.46], [-12.47, -35.82], [-15.56, -37.37], [-18.85, -39.14], [-22.14, -41.1], [-25.35, -43], [-28.37, -44.74], [-31.31, -46.43], [-34.42, -48.15], [-37.79, -50.27], [-41.32, -52.42], [-44.96, -53.54], [-48.76, -52.91], [-52.67, -51.25], [-56.47, -49.62], [-59.99, -48.18], [-63.41, -46.78], [-67.01, -45.94], [-69.97, -45.84], [-73.07, -46.08], [-76.21, -46.62], [-79.26, -47.42], [-82.19, -48.57], [-85.06, -50.05], [-87.91, -51.68], [-90.77, -53.29], [-93.65, -54.91], [-96.54, -56.62], [-99.42, -58.25], [-102.28, -59.67], [-106.07, -61.28], [-109.83, -62.6], [-113.56, -63.34], [-117.46, -63.47], [-121.33, -63.02], [-124.58, -61.87], [-127.07, -59.82], [-128.93, -57.06], [-129.97, -54.03], [-130.15, -50.64], [-129.52, -46.97], [-128.01, -43.74], [-125.43, -41.22], [-121.98, -39.13], [-118.21, -37.37], [-115.19, -36.28], [-111.92, -35.41], [-108.6, -34.66], [-105.47, -33.94], [-101.81, -33.1], [-98.33, -32.36], [-94.45, -31.49], [-91.01, -30.69], [-87.25, -29.81], [-83.43, -28.85], [-79.75, -27.82], [-76.23, -26.71], [-72.75, -25.52], [-69.4, -24.25], [-66.27, -22.91], [-62.29, -21.09], [-58.63, -19.13], [-55.74, -16.79], [-53.54, -13.74], [-52.11, -10.32], [-52.06, -7.24], [-53.88, -4.83], [-57.1, -2.78], [-60.88, -0.86], [-64.11, 0.49], [-67.8, 1.74], [-71.52, 2.97], [-74.84, 4.28], [-78.61, 6.09], [-81.91, 7.99], [-84.64, 10.16], [-86.8, 12.73], [-88.39, 15.57], [-89.3, 18.49], [-89.48, 21.53], [-88.98, 24.66], [-87.83, 27.56], [-85.98, 30.13], [-83.47, 32.48], [-80.48, 34.66], [-77.86, 36.26], [-74.91, 37.81], [-71.8, 39.19], [-68.72, 40.29], [-65.69, 41.02], [-62.63, 41.46], [-59.54, 41.74], [-56.47, 42.01], [-53.41, 42.27], [-50.35, 42.46], [-47.28, 42.61], [-44.22, 42.75], [-41.16, 42.89], [-38.1, 43.01], [-35.03, 43.12], [-31.97, 43.23], [-28.87, 43.36], [-25.74, 43.49], [-22.66, 43.61], [-19.72, 43.72], [-16.14, 43.82], [-12.76, 43.9], [-9.18, 43.97], [-6.2, 44.07], [-3.07, 44.2], [0.07, 44.28], [3.07, 44.22], [6.69, 43.91], [10.14, 43.41], [13.84, 42.75], [16.97, 42.09], [20.29, 41.31], [23.63, 40.5], [26.83, 39.8], [30.79, 39.06], [34.58, 38.44], [38.34, 37.84], [42.11, 37.24], [45.84, 36.67], [49.61, 36.13], [53.43, 35.57], [57.28, 35.03], [61.13, 34.66], [64.98, 34.5], [68.83, 34.5], [72.65, 34.66], [76.41, 34.98], [80.15, 35.46], [83.91, 36.13], [87.73, 37.01], [91.58, 38.08], [95.43, 39.32], [98.35, 40.31], [101.29, 41.35], [104.18, 42.55], [106.94, 43.97], [109.62, 45.58], [112.25, 47.35], [114.67, 49.4], [116.74, 51.81], [118.54, 54.78], [120.11, 58.21], [121.23, 61.74], [121.65, 65.04], [121.27, 68.1], [120.22, 71.09], [118.66, 73.87], [116.74, 76.31], [114.29, 78.32], [111.29, 79.99], [108.14, 81.47], [105.23, 82.93], [101.84, 84.71], [98.63, 86.35], [95.43, 88.32], [92.91, 90.16], [90.33, 92.21], [87.86, 94.4], [85.63, 96.65], [83.25, 99.82], [81.21, 103.16], [79.02, 106.44], [77.18, 108.9], [75.28, 111.39], [73.23, 113.73], [70.93, 115.76], [68.31, 117.6], [65.44, 119.28], [62.44, 120.49], [59.41, 120.9], [56.15, 120.31], [52.67, 118.92], [49.45, 117.06], [46.92, 115.02], [45.03, 111.94], [44.13, 108.38], [43.25, 104.73], [42.26, 101.02], [41.3, 97.23], [39.82, 93.71], [37.47, 90.64], [34.6, 87.84], [31.73, 85.13], [29.1, 82.36], [26.47, 79.68], [23.65, 77.29], [20.57, 75.41], [17.3, 73.84], [13.84, 72.15], [11.08, 70.6], [8.19, 68.92], [5.25, 67.32], [2.33, 66.02], [-1.52, 64.93], [-5.36, 64.25], [-9.18, 63.57], [-12.92, 62.71], [-16.64, 61.85], [-20.46, 61.12], [-23.47, 60.71], [-26.57, 60.39], [-29.68, 60.13], [-32.71, 59.9], [-36.57, 59.64], [-40.36, 59.47], [-44.22, 59.4], [-47.23, 59.44], [-50.3, 59.54], [-53.39, 59.7], [-56.47, 59.9], [-59.53, 60.15], [-62.59, 60.45], [-65.66, 60.78], [-68.72, 61.12], [-71.78, 61.45], [-74.84, 61.78], [-77.91, 62.15], [-80.97, 62.59], [-84.09, 63.06], [-87.25, 63.57], [-90.33, 64.2], [-93.22, 65.04], [-96.62, 66.56], [-99.75, 68.42], [-103.02, 70.43], [-105.75, 71.98], [-108.62, 73.6], [-111.45, 75.35], [-114.04, 77.29], [-116.48, 79.48], [-118.83, 81.89], [-120.87, 84.38], [-122.37, 86.85], [-123.29, 90.12], [-123.39, 93.41], [-123.35, 96.65], [-123.58, 99.79], [-123.67, 102.88], [-123.11, 105.96], [-121.61, 109.15], [-119.46, 112.34], [-116.98, 115.26], [-114.27, 117.9], [-111.23, 120.28], [-107.92, 122.13], [-104.25, 123.35], [-100.31, 124.06], [-96.4, 124.33], [-92.61, 124.15], [-88.85, 123.53], [-85.14, 122.61], [-81.53, 121.42], [-77.96, 119.94], [-74.35, 118.21], [-71.57, 116.69], [-68.76, 114.98], [-65.93, 113.23], [-63.08, 111.59], [-60.18, 110.08], [-57.23, 108.64], [-54.33, 107.26], [-51.57, 105.96], [-48.24, 104.41], [-45.1, 103], [-41.77, 101.54], [-38.9, 100.31], [-35.83, 99.02], [-32.84, 97.76], [-30.25, 96.65], [-26.56, 94.84], [-23.39, 93.46], [-19.83, 92.22], [-16.02, 91.98], [-13.11, 93.14], [-10.04, 95], [-7.12, 96.78], [-2.81, 99.13], [0.38, 100.88]], width: 7, surface: "candy", tiles: "pybogrpyboglpybogrpybogrpybogrpybogrpybogrpyboglpybogrpybogrpybogrpyboglpybogrpybBgrpybogrpybogrpybogrpybogrpybogrpybogrpyboglpybogrpybogrpybogrpybRgrpybogrpybogrplbogrpybogrpyblgrpybogrpybogrpybogrpybogrpyBogrpybogrpybogrpybogrpy" } },
  // ===== the short cuts ============================================================
  // The Rainbow Trail — bands of colour laid the length of it — and the
  // Mountain Pass, a track up through the gumdrops. Both end ON the path, so
  // the network paves each end as a junction in the path's own cream.
  { kind: "road", x: -48.27, z: -79.01, params: { path: [[6.13, -26.34], [5.72, -24.2], [5.15, -21.13], [4.45, -17.61], [3.68, -14.09], [2.98, -11.29], [2.19, -8.33], [1.36, -5.3], [0.54, -2.29], [-0.24, 0.61], [-0.97, 3.4], [-1.69, 6.15], [-2.39, 8.85], [-3.05, 11.49], [-3.67, 14.09], [-4.41, 17.53], [-5.11, 21.06], [-5.7, 24.17], [-6.12, 26.34]], width: 4.2, surface: "candy", stripes: "roygbp" } },
  { kind: "road", x: 72.67, z: -23.64, params: { path: [[-10.93, -34.18], [-10.17, -32.44], [-9.08, -29.94], [-7.81, -27.11], [-6.52, -24.38], [-5.19, -21.8], [-3.77, -19.16], [-2.31, -16.49], [-0.89, -13.84], [0.46, -11.19], [1.77, -8.53], [3.11, -5.89], [4.5, -3.31], [6.15, -0.87], [7.98, 1.48], [9.6, 3.88], [10.63, 6.49], [10.93, 9.47], [10.71, 12.69], [10.15, 15.88], [9.41, 18.74], [7.96, 21.93], [6.09, 24.72], [4.5, 27.31], [2.97, 31.28], [2.05, 34.18]], width: 5, surface: "dirt" } },
  // ===== A: Home Sweet Home ========================================================
  { kind: "gingerbreadHouse", x: 5, z: 114.5, params: { width: 18, depth: 13, enterable: true, text: "HOME|SWEET|HOME" } },
  { kind: "candyFence", x: -12, z: 104, params: { length: 10 } },
  { kind: "candyFence", x: 22, z: 104, params: { length: 14 } },
  { kind: "iceCreamCone", x: 18.5, z: 108.5, params: { height: 3.4, tint: "#ee8da4" } },
  { kind: "iceCreamCone", x: 21, z: 112, params: { height: 3.4, tint: "#6e3f22" } },
  { kind: "iceCreamCone", x: 18.5, z: 115.5, params: { height: 3.4, tint: "#bfe6c2" } },
  { kind: "cupcake", x: -9, z: 109, params: { height: 2.8 } },
  { kind: "cupcake", x: 26, z: 100.5, params: { height: 2.4, tint: "#f39ab5" } },
  { kind: "chocolateBar", x: 4.2, z: 77.8, params: { length: 6 } },
  { kind: "candyCorn", x: 34, z: 70 },
  { kind: "gingerbreadMan", x: -18, z: 84 },
  { kind: "signpost", x: -28, z: 76, params: { text: "16 MILES" } },
  // ===== B: Peanut Brittle House ===================================================
  { kind: "brittleHouse", x: -118, z: 22, rotY: -Math.PI / 2, params: { width: 10, depth: 9, enterable: true } },
  { kind: "chocolateBar", x: -104, z: 30, rotY: Math.PI / 2, params: { length: 5, tint: "#a8642a" } },
  { kind: "chocolateBar", x: -108, z: -4, params: { length: 6, tint: "#a8642a" } },
  { kind: "gumdrop", x: -128, z: 2, params: { height: 3.8, tint: "#efbd2a" } },
  { kind: "gumdrop", x: -131, z: 42, params: { height: 4.6, tint: "#3d9e48" } },
  { kind: "cupcake", x: -122, z: 8, params: { height: 2.4, tint: "#f6d27a" } },
  { kind: "signpost", x: -66, z: 22, params: { text: "59 MILES" } },
  // ===== C: Gingerbread Plum Tree ==================================================
  { kind: "plumTree", x: -3, z: 4 },
  { kind: "gingerbreadMan", x: -24, z: 12 },
  { kind: "gingerbreadMan", x: 22, z: 0, rotY: -Math.PI / 2 },
  { kind: "chocolateBar", x: -20.8, z: -14.2, params: { length: 6 } },
  { kind: "chocolateBar", x: 16, z: 18, rotY: Math.PI / 2, params: { length: 6 } },
  { kind: "chocolateBar", x: 14, z: -20, params: { length: 5, tint: "#4a2918" } },
  { kind: "cupcake", x: -28, z: -4, params: { height: 2.6, tint: "#f39ab5" } },
  { kind: "cupcake", x: 26, z: 22, params: { height: 2.4 } },
  { kind: "candyCorn", x: 30, z: -12, params: { height: 2.8 } },
  { kind: "candyCorn", x: -32, z: 24, params: { height: 2.4 } },
  { kind: "iceCreamCone", x: -12, z: 28, params: { height: 3, tint: "#6e3f22" } },
  { kind: "signpost", x: 10, z: -44, params: { text: "76 MILES" } },
  { kind: "gingerbreadMan", x: -0.7, z: -66.6, params: { height: 2.6 } },
  // ===== D: Gumdrop Mountains ======================================================
  { kind: "gumdrop", x: 60, z: -19.6, params: { height: 11, tint: "#d3263a" } },
  { kind: "gumdrop", x: 73.5, z: -11.8, params: { height: 9, tint: "#3d9e48" } },
  { kind: "gumdrop", x: 96.3, z: -12.3, params: { height: 10, tint: "#7a3aa6" } },
  { kind: "gumdrop", x: 91.9, z: -31.4, params: { height: 9.5, tint: "#3d9e48" } },
  { kind: "gumdrop", x: 110.3, z: -29.4, params: { height: 11, tint: "#d3263a" } },
  { kind: "gumdrop", x: 104.3, z: -43, params: { height: 8.5, tint: "#efbd2a" } },
  { kind: "gumdrop", x: 81.7, z: -41.6, params: { height: 10, tint: "#d3263a" } },
  { kind: "gumdrop", x: 99.2, z: 1.2, params: { height: 7, tint: "#efbd2a" } },
  { kind: "gumdrop", x: 63.7, z: -31.8, params: { height: 7.5, tint: "#7a3aa6" } },
  { kind: "gumdrop", x: 116.4, z: -13.5, params: { height: 7, tint: "#ef7b22" } },
  { kind: "signpost", x: 122, z: 22, params: { text: "98 MILES" } },
  { kind: "candyCorn", x: 113.9, z: -1.2, params: { height: 3 } },
  // ===== E: Candy Hearts ===========================================================
  { kind: "candyHeart", x: 16, z: -134, rotY: -2.11, params: { width: 3.4, tint: "#f28bb0", text: "I|LOVE|YOU" } },
  { kind: "candyHeart", x: 29, z: -141, rotY: -2.51, params: { width: 3.4, tint: "#f4d257", text: "BE|MINE" } },
  { kind: "candyHeart", x: 63, z: -140, rotY: -2.16, params: { width: 3.4, tint: "#8fdc98", text: "SWEET|HEART" } },
  { kind: "candyHeart", x: 76, z: -131, rotY: -2.66, params: { width: 3.4, tint: "#c3a0ee", text: "HUG|ME" } },
  { kind: "candyHeart", x: 38, z: -96, rotY: -2.01, params: { width: 3.4, tint: "#f9ad74", text: "XOXO" } },
  { kind: "candyHeart", x: 58, z: -104, rotY: -2.56, params: { width: 3.4, tint: "#f28bb0", text: "MY|LOVE" } },
  { kind: "candyHeart", x: -8, z: -134, rotY: -2.26, params: { width: 3.4, tint: "#f7f1ec", text: "KISS|ME" } },
  { kind: "signpost", x: 20, z: -103, params: { text: "127 MILES" } },
  { kind: "candyCane", x: 100, z: -72, rotY: 3.08, params: { height: 11 } },
  { kind: "candyCane", x: 113, z: -80, rotY: 4.44, params: { height: 9 } },
  { kind: "candyCane", x: 127, z: -70, rotY: 0.37, params: { height: 12 } },
  { kind: "candyCane", x: 104, z: -94, rotY: 1.97, params: { height: 10 } },
  { kind: "candyCane", x: 120, z: -99, rotY: 2.37, params: { height: 12.5 } },
  { kind: "candyCane", x: 134, z: -88, rotY: 0.93, params: { height: 9 } },
  { kind: "candyCane", x: 110, z: -115, rotY: 4.22, params: { height: 11 } },
  { kind: "candyCane", x: 127, z: -121, rotY: 4.81, params: { height: 9.5 } },
  { kind: "candyCane", x: 96, z: -128, rotY: 2.87, params: { height: 8 } },
  { kind: "candyCane", x: 138, z: -108, rotY: 3.72, params: { height: 10.5 } },
  { kind: "candyCane", x: 117, z: -136, rotY: 4.85, params: { height: 9 } },
  // ===== START =====================================================================
  { kind: "signpost", x: -84, z: -112, params: { text: "START" } },
  { kind: "gingerbreadMan", x: -92, z: -128, rotY: 1.06, params: { height: 3, tint: "#c8323a" } },
  { kind: "gingerbreadMan", x: -98, z: -124, rotY: 0.9, params: { height: 3, tint: "#3d9e48" } },
  { kind: "gingerbreadMan", x: -93, z: -134, rotY: 1.25, params: { height: 3, tint: "#efbd2a" } },
  { kind: "gingerbreadMan", x: -99, z: -131, rotY: 1.1, params: { height: 3, tint: "#3a6fd0" } },
  { kind: "chocolateBar", x: -120, z: -100, rotY: Math.PI / 2, params: { length: 6 } },
  { kind: "gumdrop", x: -134, z: -96, params: { height: 3.4, tint: "#7a3aa6" } },
  // ===== the Ice Cream Sea =========================================================
  { kind: "iceCreamFloat", x: 98, z: 120, y: -0.34, rotY: 0.3, params: { length: 8 } },
  { kind: "iceCreamFloat", x: 122, z: 108, y: -0.29, rotY: -0.5, params: { length: 6 } },
  { kind: "iceCreamFloat", x: 90, z: 132, y: -0.33, rotY: 0.1, params: { length: 6.5 } },
  { kind: "iceCreamFloat", x: 130, z: 132, y: -0.17, rotY: 0.9, params: { length: 5.5 } },
  { kind: "iceCreamFloat", x: 110, z: 132, y: -0.21, rotY: -0.2, params: { length: 5 } },
  { kind: "popsicle", x: 122, z: 100, y: 0.65, rotY: 0.6, params: { height: 6.5 } },
  // ===== the Molasses Swamp ========================================================
  { kind: "molasses", x: -95, z: 93, y: 0.54, params: { width: 30, depth: 26 } },
  // ===== the lawns =================================================================
  { kind: "chocolateBar", x: -60, z: 54, params: { length: 6 } },
  { kind: "cupcake", x: -38.2, z: 49.8, params: { height: 2.6, tint: "#f39ab5" } },
  { kind: "chocolateBar", x: -79.8, z: 54.2, rotY: Math.PI / 2, params: { length: 6 } },
  { kind: "chocolateBar", x: -56.2, z: -38.2, rotY: Math.PI / 2, params: { length: 6 } },
  { kind: "gingerbreadMan", x: -34.2, z: -39.8 },
  { kind: "chocolateBar", x: -116.8, z: -56.8, params: { length: 6 } },
  { kind: "gumdrop", x: -100, z: -75, params: { height: 3.9, tint: "#3d9e48" } },
  { kind: "chocolateBar", x: -40, z: -72, params: { length: 6 } },
  { kind: "chocolateBar", x: 30, z: -66, params: { length: 6 } },
  { kind: "cupcake", x: 60, z: -70, params: { height: 2.6, tint: "#7cc5e8" } },
  { kind: "chocolateBar", x: -10, z: -88, rotY: Math.PI / 2, params: { length: 6 } },
  { kind: "chocolateBar", x: 40, z: 30, params: { length: 6 } },
  { kind: "gingerbreadMan", x: 60, z: 22, rotY: Math.PI / 2 },
  { kind: "cupcake", x: 30, z: 48, params: { height: 2.6, tint: "#f6d27a" } },
  { kind: "chocolateBar", x: -130, z: -20, rotY: Math.PI / 2, params: { length: 6 } },
  { kind: "gumdrop", x: -60, z: 98, params: { height: 3.5, tint: "#efbd2a" } },
  { kind: "chocolateBar", x: -37.5, z: 110, rotY: Math.PI / 2, params: { length: 6 } },
  { kind: "gumdrop", x: -130, z: 135, params: { height: 4.2, tint: "#3d9e48" } },
  { kind: "cupcake", x: -60, z: 132, params: { height: 2.6, tint: "#f39ab5" } },
  { kind: "chocolateBar", x: 60, z: -40, rotY: Math.PI / 2, params: { length: 6 } },
];

const scatter: ScatterSpec[] = [
  // ===== the Lollypop Woods ========================================================
  { prop: "lollipop", x: 22.9, z: 40.9, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 30.8, z: 37.9, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 43.6, z: 38.8, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 53.6, z: 42.1, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 67.8, z: 42.7, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 77.4, z: 39.5, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 86.6, z: 42.3, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 98.7, z: 39.1, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 112.1, z: 39, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 120.1, z: 41.1, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 24.3, z: 52, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 35.7, z: 48.5, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 44.9, z: 49.4, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 56.6, z: 48.6, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 64.8, z: 48.9, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 78.2, z: 51.5, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 90.8, z: 53.1, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 100.4, z: 50.6, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 112.1, z: 53.2, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 122.6, z: 52.8, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 22.6, z: 63.8, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 33.3, z: 61.4, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 43.1, z: 61.5, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 54.7, z: 62.4, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 66.3, z: 59, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 78.1, z: 64.6, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 87.3, z: 63.5, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 100.4, z: 59.1, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 112.8, z: 59.3, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 118.8, z: 60, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 41.9, z: 72.4, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 55.1, z: 74.8, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 66.5, z: 71.2, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 79.2, z: 73, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 88.1, z: 70, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 101.7, z: 73.7, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 109.9, z: 72.7, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 43.2, z: 85.8, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 56.2, z: 82.9, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 65.3, z: 84.5, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 78.7, z: 81.7, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 88.7, z: 85.1, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 101.1, z: 85.8, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 107.7, z: 85.9, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 45.3, z: 92.1, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 75.6, z: 97.7, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  { prop: "lollipop", x: 90.5, z: 92.6, radius: 7, count: 4, scale: [0.85, 1.2], blocking: true, clearance: 1.7 },
  // ===== the Peppermint Stick Forest ===============================================
  { prop: "peppermint", x: 97.9, z: -138.2, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 97.9, z: -138.2, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 108.2, z: -137.3, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 108.2, z: -137.3, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 120.9, z: -139.8, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 120.9, z: -139.8, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 131.5, z: -139, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 131.5, z: -139, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 88.9, z: -127.4, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 88.9, z: -127.4, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 100.9, z: -127.2, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 100.9, z: -127.2, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 109.1, z: -132.7, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 109.1, z: -132.7, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 121.5, z: -132.4, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 121.5, z: -132.4, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 130.9, z: -129.9, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 130.9, z: -129.9, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 139.8, z: -129, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 139.8, z: -129, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 90.7, z: -122.9, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 90.7, z: -122.9, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 101.6, z: -119.3, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 101.6, z: -119.3, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 110.3, z: -119.8, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 110.3, z: -119.8, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 121.7, z: -118.6, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 121.7, z: -118.6, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 129.6, z: -119.8, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 129.6, z: -119.8, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 137.8, z: -122.4, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 137.8, z: -122.4, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 40.4, z: -109.3, radius: 6, count: 3, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 40.4, z: -109.3, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 51.4, z: -109.1, radius: 6, count: 3, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 51.4, z: -109.1, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 59.8, z: -110.3, radius: 6, count: 3, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 59.8, z: -110.3, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 71.5, z: -109, radius: 6, count: 3, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 71.5, z: -109, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 77.6, z: -111.3, radius: 6, count: 3, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 77.6, z: -111.3, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 88.3, z: -110.9, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 88.3, z: -110.9, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 100.2, z: -109.1, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 100.2, z: -109.1, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 108.2, z: -112.1, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 108.2, z: -112.1, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 121, z: -109.6, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 121, z: -109.6, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 129.5, z: -112.8, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 129.5, z: -112.8, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 140, z: -109.5, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 140, z: -109.5, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 41.5, z: -101.1, radius: 6, count: 3, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 41.5, z: -101.1, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 48.3, z: -100.9, radius: 6, count: 3, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 48.3, z: -100.9, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 59.6, z: -102.2, radius: 6, count: 3, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 59.6, z: -102.2, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 72.3, z: -102.4, radius: 6, count: 3, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 72.3, z: -102.4, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 89.6, z: -100.7, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 89.6, z: -100.7, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 100.6, z: -97.4, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 100.6, z: -97.4, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 110.9, z: -103, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 110.9, z: -103, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 121, z: -100.2, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 121, z: -100.2, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 132.9, z: -99.6, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 132.9, z: -99.6, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 140.3, z: -100.3, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 140.3, z: -100.3, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 42, z: -92.4, radius: 6, count: 3, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 42, z: -92.4, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 50, z: -87.6, radius: 6, count: 3, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 50, z: -87.6, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 61.3, z: -88.6, radius: 6, count: 3, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 61.3, z: -88.6, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 67.4, z: -92, radius: 6, count: 3, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 67.4, z: -92, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 91.5, z: -89.1, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 91.5, z: -89.1, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 101, z: -91, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 101, z: -91, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 107.9, z: -88.8, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 107.9, z: -88.8, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 119.9, z: -88.9, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 119.9, z: -88.9, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 130.8, z: -90.7, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 130.8, z: -90.7, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 88.6, z: -79.5, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 88.6, z: -79.5, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 98.9, z: -80.3, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 98.9, z: -80.3, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 109.4, z: -80.1, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 109.4, z: -80.1, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 121.8, z: -82.8, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 121.8, z: -82.8, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 131.5, z: -80.6, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 131.5, z: -80.6, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 138.9, z: -82, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 138.9, z: -82, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 92.2, z: -72.1, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 92.2, z: -72.1, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 100.8, z: -71.7, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 100.8, z: -71.7, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 112.1, z: -71.3, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 112.1, z: -71.3, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 121.3, z: -68.5, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 121.3, z: -68.5, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 127.2, z: -71.3, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 127.2, z: -71.3, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  { prop: "peppermint", x: 138.1, z: -72.4, radius: 6, count: 4, scale: [0.85, 1.25], blocking: true, clearance: 1.3 },
  { prop: "mintLeaf", x: 138.1, z: -72.4, radius: 6, count: 4, scale: [0.9, 1.4], clearance: 0.8 },
  // ===== Gumdrop Mountains =========================================================
  { prop: "gumdropSmall", x: 100, z: -21.9, radius: 4, count: 3, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "gumdropSmall", x: 97, z: -18.1, radius: 4, count: 3, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "gumdropSmall", x: 100.8, z: -15, radius: 4, count: 3, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "gumdropSmall", x: 99.6, z: -3.6, radius: 4, count: 3, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "gumdropSmall", x: 69.5, z: -14, radius: 4, count: 3, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "gumdropSmall", x: 62.6, z: -29.6, radius: 4, count: 3, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "gumdropSmall", x: 81.6, z: -42.9, radius: 4, count: 3, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "gumdropSmall", x: 87.9, z: -37.3, radius: 4, count: 3, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "gumdropSmall", x: 95.6, z: -37.6, radius: 4, count: 3, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "gumdropSmall", x: 96.6, z: -33.8, radius: 4, count: 3, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  // ===== the Molasses Swamp ========================================================
  { prop: "cattail", x: -78.3, z: 96.4, radius: 2.5, count: 3, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "cattail", x: -84.5, z: 104.4, radius: 2.5, count: 3, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "cattail", x: -93.3, z: 107.7, radius: 2.5, count: 3, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "cattail", x: -102.5, z: 106.3, radius: 2.5, count: 3, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "cattail", x: -110.2, z: 100, radius: 2.5, count: 3, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "cattail", x: -111.7, z: 89.6, radius: 2.5, count: 3, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "cattail", x: -105.5, z: 81.6, radius: 2.5, count: 3, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "cattail", x: -96.7, z: 78.6, radius: 2.5, count: 3, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "cattail", x: -87.6, z: 79.9, radius: 2.5, count: 3, scale: [0.9, 1.3], clearance: 0.6 },
  { prop: "cattail", x: -80, z: 86.1, radius: 2.5, count: 3, scale: [0.9, 1.3], clearance: 0.6 },
  // ===== the lawns =================================================================
  { prop: "gumdropSmall", x: -114.9, z: -138.9, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: -116.6, z: -137.6, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: -81.1, z: -137.9, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "gumdropSmall", x: -57.3, z: -133.7, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: -52.5, z: -129.9, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: -28.8, z: -137.5, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: -29, z: -130.7, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: 16.8, z: -134.6, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: 21.2, z: -133.2, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: 70.5, z: -135.6, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: 65.4, z: -130, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: 98, z: -136.3, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "gumdropSmall", x: -139.9, z: -114.7, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: -137.7, z: -121.6, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: -79.3, z: -108, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: -86.4, z: -115, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: -56.2, z: -117.5, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: -24.8, z: -111.3, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: -8.6, z: -107.7, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: 11.7, z: -107.2, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: 47.5, z: -104.9, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: 54.3, z: -100.2, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: 77.2, z: -113.2, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: 103.5, z: -105.1, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: 101.6, z: -112, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: 119.3, z: -109.9, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: 113.6, z: -116.6, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: -136.4, z: -79.7, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: -135.8, z: -73.9, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: -109.9, z: -78.7, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: -117.1, z: -81.8, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: -80.2, z: -79, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: -85.6, z: -76.2, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: -57, z: -78.4, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: -26.9, z: -87.2, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: -3.9, z: -81.2, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: 21.6, z: -90.6, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: 44.2, z: -81.3, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: 66.8, z: -87.6, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: 100.7, z: -79.7, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: 105.6, z: -85, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: 121.4, z: -84.7, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: 125.6, z: -91.9, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: -137.8, z: -54.2, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: -108.5, z: -47.3, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: -82, z: -62.1, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: -53.4, z: -60, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: -43.7, z: -53.3, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: -6.9, z: -57.9, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: 16.7, z: -61, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: 46.6, z: -60.6, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: 69.6, z: -66, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: 127.2, z: -62, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: 134.3, z: -57, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: -135.8, z: -29.1, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: -140.8, z: -24.4, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: -106, z: -22.6, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: -83.5, z: -24.6, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: -53, z: -25.2, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: -24, z: -30.5, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: -3.6, z: -31.7, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: 27, z: -30.9, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: 39.5, z: -32.8, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: 133.3, z: -21.7, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: -132.3, z: -5.1, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: -138.9, z: -13.1, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: -113.5, z: -5.1, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: -117.6, z: -5.7, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: -78.6, z: -7.9, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: -72.1, z: -14.2, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: -56.1, z: -4.7, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: -28.6, z: -4, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: -26.8, z: -4.4, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: 23.6, z: -10.6, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: 17.3, z: -10.2, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: 42.5, z: 3.6, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: 101, z: -9.5, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: 125.3, z: -0.8, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: -140.2, z: 26, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: -111.1, z: 31.2, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: -76.9, z: 9.7, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: -61.3, z: 14.6, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: -68.9, z: 17.8, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: -33.6, z: 14.4, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: -33.8, z: 15.5, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: -11.4, z: 16.5, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: -7.5, z: 23, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: 17.8, z: 24.9, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: 21.8, z: 32.4, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: 40.2, z: 22.9, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: 47.9, z: 19.1, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: 73.4, z: 14.4, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: 98.4, z: 22.9, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: 128.6, z: 17.1, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: 129.3, z: 17.6, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: -136.9, z: 44, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: -137, z: 48.4, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: -107.4, z: 47.9, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: -109, z: 43.6, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: -79, z: 50.6, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: -75.1, z: 45.8, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: -56.2, z: 38.9, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: -27.5, z: 49.5, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: -14, z: 54.1, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: 18, z: 42.4, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: 48.9, z: 51.3, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: 42.7, z: 56.1, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: 68.8, z: 47.5, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: 90.1, z: 57.9, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: -131.3, z: 72.5, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: -125.8, z: 73.7, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: -95.3, z: 69.2, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: -59.8, z: 76.5, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: -59.9, z: 69.5, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: -35.2, z: 73.6, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: -31.2, z: 72.9, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: -2.9, z: 72.5, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: 41.8, z: 72.2, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: 47.8, z: 70.9, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: 76.7, z: 73.3, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: 70, z: 65.8, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: 101, z: 77.9, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: -137.9, z: 95.9, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: -138, z: 92.1, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: -59.6, z: 101.6, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: -32.6, z: 94.6, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: -4, z: 103.6, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: 40, z: 104.9, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: -138.1, z: 120.5, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: -132.5, z: 116.3, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: -112.1, z: 127.6, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "jellyBeans", x: -82.8, z: 125.5, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: -58.3, z: 127, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: -65, z: 133, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: -35.8, z: 127.2, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: -34.3, z: 124.3, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: -2.3, z: 127.6, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: -5.7, z: 125.4, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
  { prop: "gumdropSmall", x: 25.2, z: 121.7, radius: 6, count: 2, scale: [0.8, 1.35], blocking: true, clearance: 1.4 },
  { prop: "jellyBeans", x: 32.6, z: 129.5, radius: 6, count: 2, scale: [0.9, 1.2], clearance: 1.2 },
];

const controlPoints: ControlPointDef[] = [
  { id: "A", name: "Home Sweet Home", pos: new Vector3(20, 0.45, 86), radius: 12 },
  { id: "B", name: "Peanut Brittle House", pos: new Vector3(-101, 0.19, 12), radius: 11 },
  { id: "C", name: "Gingerbread Plum Tree", pos: new Vector3(-3, 1.24, -8), radius: 13 },
  { id: "D", name: "Gumdrop Mountains", pos: new Vector3(88, 3.47, -22), radius: 12 },
  { id: "E", name: "Candy Hearts", pos: new Vector3(45, 0.6, -134), radius: 11 },
];

/**
 * Home spawns are uncapturable; every flag also carries a spawn just outside
 * its ring. T0 starts at START, as a player does.
 */
const spawns: SpawnPointDef[] = [
  { team: 0, pos: new Vector3(-112, 0.25, -118), yaw: Math.PI / 4 },
  { team: 0, pos: new Vector3(-106, 0.25, -112), yaw: Math.PI / 4 },
  { team: 0, pos: new Vector3(-118, 0.25, -124), yaw: Math.PI / 4 },
  { team: 1, pos: new Vector3(138, 0.5, 57), yaw: -Math.PI * 0.6 },
  { team: 1, pos: new Vector3(138, 0.5, 65), yaw: -Math.PI * 0.6 },
  { team: 1, pos: new Vector3(138, 0.5, 49), yaw: -Math.PI * 0.6 },
  { team: null, controlPoint: "A", pos: new Vector3(20, 0.39, 69), yaw: Math.PI },
  { team: null, controlPoint: "B", pos: new Vector3(-85, 0.17, 6), yaw: -Math.PI / 2 },
  { team: null, controlPoint: "C", pos: new Vector3(-3, 0.45, -26), yaw: 0 },
  { team: null, controlPoint: "D", pos: new Vector3(68, 2.17, -18), yaw: Math.PI / 2 },
  { team: null, controlPoint: "E", pos: new Vector3(45, 0.55, -121), yaw: Math.PI },
];

const water: WaterRect[] = [
  // THE ICE CREAM SEA: one rect over the basin the path runs along the shore
  // of. The floor decides where the water is; this is only where it may be.
  { x: 101.38, z: 107.13, width: 83.75, depth: 71.75, y: -0.35 },
];

const grass: GrassRect[] = [
  // A spring lawn: bright-tipped, and a BUDGET rather than a blanket (the
  // field is one mesh of thin instances with no culling inside it). It
  // never grows on the path — the road footprint refuses a tuft — so the
  // rects can lie across it.
  { x: -129.7, z: -128.6, width: 30, depth: 26, density: 0.1 },
  { x: -104.7, z: -134.9, width: 30, depth: 26, density: 0.12 },
  { x: -73, z: -130.4, width: 30, depth: 26, density: 0.11 },
  { x: -40.1, z: -132.9, width: 30, depth: 26, density: 0.1 },
  { x: -11.2, z: -130.4, width: 30, depth: 26, density: 0.13 },
  { x: 22, z: -128.1, width: 30, depth: 26, density: 0.12 },
  { x: 51.5, z: -130.9, width: 30, depth: 26, density: 0.1 },
  { x: 74.7, z: -129.6, width: 30, depth: 26, density: 0.13 },
  { x: 110.3, z: -128.5, width: 30, depth: 26, density: 0.11 },
  { x: 140, z: -132.2, width: 30, depth: 26, density: 0.1 },
  { x: -127.7, z: -97.4, width: 30, depth: 26, density: 0.11 },
  { x: -105.7, z: -99.4, width: 30, depth: 26, density: 0.12 },
  { x: -69.6, z: -106.5, width: 30, depth: 26, density: 0.13 },
  { x: -39.2, z: -99, width: 30, depth: 26, density: 0.11 },
  { x: -12.5, z: -97.1, width: 30, depth: 26, density: 0.12 },
  { x: 14.4, z: -100.5, width: 30, depth: 26, density: 0.1 },
  { x: 44.4, z: -100, width: 30, depth: 26, density: 0.11 },
  { x: 74.4, z: -104.9, width: 30, depth: 26, density: 0.13 },
  { x: 109.8, z: -107, width: 30, depth: 26, density: 0.12 },
  { x: 141, z: -99.4, width: 30, depth: 26, density: 0.11 },
  { x: -135.8, z: -69.6, width: 30, depth: 26, density: 0.1 },
  { x: -103.1, z: -68, width: 30, depth: 26, density: 0.12 },
  { x: -75.9, z: -72.2, width: 30, depth: 26, density: 0.11 },
  { x: -42.9, z: -75.2, width: 30, depth: 26, density: 0.11 },
  { x: -13.8, z: -68.7, width: 30, depth: 26, density: 0.09 },
  { x: 19.8, z: -71.9, width: 30, depth: 26, density: 0.13 },
  { x: 50.1, z: -76.4, width: 30, depth: 26, density: 0.11 },
  { x: 73.5, z: -69.4, width: 30, depth: 26, density: 0.13 },
  { x: 109.8, z: -71, width: 30, depth: 26, density: 0.12 },
  { x: 141.4, z: -72.5, width: 30, depth: 26, density: 0.09 },
  { x: -130.6, z: -37.9, width: 30, depth: 26, density: 0.13 },
  { x: -100.3, z: -43.6, width: 30, depth: 26, density: 0.12 },
  { x: -68.4, z: -39.1, width: 30, depth: 26, density: 0.1 },
  { x: -43.3, z: -45.2, width: 30, depth: 26, density: 0.13 },
  { x: -16.7, z: -39.4, width: 30, depth: 26, density: 0.11 },
  { x: 17.4, z: -39.9, width: 30, depth: 26, density: 0.13 },
  { x: 43.8, z: -38.7, width: 30, depth: 26, density: 0.1 },
  { x: 79.2, z: -40.9, width: 30, depth: 26, density: 0.11 },
  { x: 111.6, z: -46.2, width: 30, depth: 26, density: 0.13 },
  { x: 133.9, z: -37.1, width: 30, depth: 26, density: 0.12 },
  { x: -127.3, z: -14.5, width: 30, depth: 26, density: 0.09 },
  { x: -101.6, z: -10.8, width: 30, depth: 26, density: 0.12 },
  { x: -67.7, z: -7.6, width: 30, depth: 26, density: 0.11 },
  { x: -42.4, z: -11.1, width: 30, depth: 26, density: 0.09 },
  { x: -10.4, z: -15.3, width: 30, depth: 26, density: 0.11 },
  { x: 18.9, z: -16.9, width: 30, depth: 26, density: 0.12 },
  { x: 43.8, z: -7.5, width: 30, depth: 26, density: 0.09 },
  { x: 82.5, z: -14.1, width: 30, depth: 26, density: 0.11 },
  { x: 107.5, z: -14.2, width: 30, depth: 26, density: 0.1 },
  { x: 139.6, z: -10.9, width: 30, depth: 26, density: 0.11 },
  { x: -130.5, z: 21.7, width: 30, depth: 26, density: 0.1 },
  { x: -97.2, z: 20.1, width: 30, depth: 26, density: 0.1 },
  { x: -72.3, z: 16.4, width: 30, depth: 26, density: 0.11 },
  { x: -44.2, z: 17.8, width: 30, depth: 26, density: 0.12 },
  { x: -16.8, z: 17.8, width: 30, depth: 26, density: 0.12 },
  { x: 21.6, z: 18.8, width: 30, depth: 26, density: 0.1 },
  { x: 53, z: 16.8, width: 30, depth: 26, density: 0.1 },
  { x: 77.4, z: 17.8, width: 30, depth: 26, density: 0.12 },
  { x: 107.9, z: 18.9, width: 30, depth: 26, density: 0.1 },
  { x: 135.7, z: 13.1, width: 30, depth: 26, density: 0.11 },
  { x: -131.1, z: 43.5, width: 30, depth: 26, density: 0.11 },
  { x: -101.6, z: 44.5, width: 30, depth: 26, density: 0.12 },
  { x: -67.1, z: 52, width: 30, depth: 26, density: 0.13 },
  { x: -43.8, z: 51.3, width: 30, depth: 26, density: 0.09 },
  { x: -12.6, z: 51.7, width: 30, depth: 26, density: 0.12 },
  { x: 17.6, z: 46.3, width: 30, depth: 26, density: 0.09 },
  { x: 45.1, z: 45, width: 30, depth: 26, density: 0.1 },
  { x: 82.1, z: 52.6, width: 30, depth: 26, density: 0.09 },
  { x: 104.8, z: 50.6, width: 30, depth: 26, density: 0.11 },
  { x: 142.8, z: 47.2, width: 30, depth: 26, density: 0.1 },
  { x: -136.8, z: 78.7, width: 30, depth: 26, density: 0.12 },
  { x: -37.8, z: 82.3, width: 30, depth: 26, density: 0.11 },
  { x: -10.1, z: 76, width: 30, depth: 26, density: 0.12 },
  { x: 14.3, z: 74.9, width: 30, depth: 26, density: 0.13 },
  { x: 47.1, z: 77, width: 30, depth: 26, density: 0.1 },
  { x: 75.7, z: 73.5, width: 30, depth: 26, density: 0.09 },
  { x: -127.1, z: 108.7, width: 30, depth: 26, density: 0.12 },
  { x: -45.9, z: 106.6, width: 30, depth: 26, density: 0.09 },
  { x: -14.5, z: 109.9, width: 30, depth: 26, density: 0.1 },
  { x: 22.6, z: 105.2, width: 30, depth: 26, density: 0.12 },
  { x: 46.6, z: 104.1, width: 30, depth: 26, density: 0.09 },
  { x: -132, z: 141.9, width: 30, depth: 26, density: 0.11 },
  { x: -98.9, z: 138.3, width: 30, depth: 26, density: 0.12 },
  { x: -72.2, z: 135.2, width: 30, depth: 26, density: 0.11 },
  { x: -38.6, z: 133.1, width: 30, depth: 26, density: 0.12 },
  { x: -14.3, z: 133.7, width: 30, depth: 26, density: 0.1 },
  { x: 18.9, z: 134.2, width: 30, depth: 26, density: 0.12 },
];

export const CandylandLayout: MapLayout = {
  placements,
  scatter,
  controlPoints,
  spawns,
  water,
  grass,
  /** The play square. `heights.size * heights.cell` equals it (100 x 3). */
  size: 300,
  /**
   * Four: the ground, a house's plinth or table, its roof slab, and the
   * chimney over that — emitted in that order, so what overflows is a
   * chimney top nobody stands on.
   */
  surfaces: 4,
  /**
   * The play square in 2 x 2, Kurenai's measurement: under a haze that puts
   * the whole board in view from anywhere on it, the merge block is the draw
   * count and a fine grid buys the cull nothing.
   */
  blockSize: 150,
  /** Twenty cells, so the floor is five patches by five. */
  terrainBlock: 60,
  /**
   * No wall: the lawn carries on for 100 m past the board's edge and the
   * leash is what stops you. What closes the horizon is the rolling green
   * downs standing on it, soft in the pink haze.
   */
  borderland: { margin: 100, roll: 1.6, ease: 40 },
  /**
   * Round green downs — gumdrop hills, a dozen tops round the ring — and no
   * woods: a pine on Candy Land's horizon would be the one thing on the map
   * that is not a sweet.
   */
  ridge: {
    form: "downs",
    slope: 0.15,
    slopeVariance: 0.04,
    rolling: { relief: 0.45, summits: 12, knolls: 0.2, woods: 0 },
    seed: 0x43414e45,
  },
  seed: 0x43414e44,
};
