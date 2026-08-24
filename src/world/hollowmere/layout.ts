/**
 * hollowmere/layout.ts — THE MAP, as data: structure placements, scatter
 * regions, control points, spawns, water rects, grass rects. The floor's shape
 * is generated data and lives in heights.ts. Consumed by MapBuilder; nothing
 * here is code to special-case.
 * Gotchas that have already cost time: collider top faces within
 * CONFIG.nav.stepHeight of adjacent ground or bots treat decks as walls;
 * a control point's pos must NOT sit inside a collider (surfaceAt returns -1);
 * scatter clearance values must match prop collider extents; terrain steeper
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
import { HollowmereHeights } from "./heights";

/**
 * HOLLOWMERE — the authored layout.
 *
 * 240 x 240 m, origin at the village square, +Z is north. Five flags in a rough
 * ring around the centre, with the two uncapturable home spawns diagonally
 * opposed so neither side starts next to C.
 *
 * ```
 *                             N
 *    +---------------------------------------------------+
 *    |  * VALEGUARD GATEHOUSE       ~ ASHWOOD ~           |
 *    |        (-100,+110)         logging camp, kilns,    |
 *    |                            watchtower (+34,+75)    |
 *    |     [A] CHAPEL              [D] FARMSTEAD          |
 *    |       (-60,+80)                (+80,+30)           |
 *    |       on a terrace   ~ NORTH   barn + hayloft      |
 *    |                       CROFTS ~                     |
 *    |  [B] MILL          [C] SQUARE          ~ EAST      |
 *    |    (-85,-20)          (0,0)              HOLDINGS ~|
 *    |    sunken creek    tavern, smithy,      silo, lane |
 *    |                    townhouse rows       (+86,-50)  |
 *    |   ~ THE MOOR ~      ~ BURYING                      |
 *    |  mire (-56,-96)       GROUND ~      [E] BOG DOCKS  |
 *    |  crofts, kilns       (-24,-52)          (+40,-85)  |
 *    |                                    * REDLINE CAMP  |
 *    |                                      (+105,-110)   |
 *    +---------------------------------------------------+
 * ```
 *
 * The village is deliberately *dense*: the districts above exist so that no
 * approach to a flag is a walk across open ground. When adding to a region,
 * check it against the emptiness it is meant to fill rather than dropping
 * another cottage next to the last one — the ground between districts is what
 * makes flanking readable.
 *
 * Design intent per flag:
 * - **A Chapel** — raised terrace, one ramp, enclosed nave. Easy to hold, slow
 *   to reach. The bell tower overlooks the north half.
 * - **B Mill** — sits *in* the creek, 1.5 m below the embankments on either
 *   side. Whoever holds the banks shoots down into it.
 * - **C Square** — four road approaches and no cover taller than a stall. The
 *   flag nobody keeps.
 * - **D Farmstead** — long sightlines over open paddocks; the barn hayloft is
 *   the map's best perch and the ramp to it is exposed.
 * - **E Bog Docks** — thick mist, tight boathouse, jetties with no cover. A
 *   short-range brawl by construction.
 *
 * Layout hygiene (keep to these when editing):
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

const VALEGUARD = "#c9a15e";
const REDLINE = "#ff3b3b";

/** Bank top height — the creek floor is the ground plane, 1.5 m below. */
const BANK_H = 1.5;
/** Chapel terrace height. */
const TERRACE_H = 2;

const placements: Placement[] = [
  // ===== roads =================================================================
  // Visual only; they sit on the ground plane and carry no collider. Each one
  // ends at a junction, a wall face, or a ramp foot.
  { kind: "road", x: 0, z: 0, params: { length: 130, width: 9 } },
  { kind: "road", x: 1, z: 0, rotY: Math.PI / 2, params: { length: 128, width: 9 } },
  // North to the chapel terrace — ends at the ramp foot.
  { kind: "road", x: -60, z: 44, params: { length: 15, width: 8 } },
  { kind: "road", x: -51, z: 40, rotY: Math.PI / 2, params: { length: 100, width: 7 } },
  // East to the farmstead — ends at the barn's west wall, under the loft ramp.
  { kind: "road", x: 31.5, z: 30, rotY: Math.PI / 2, params: { length: 54, width: 8 } },
  // South to the bog docks — ends at the boathouse ramp foot.
  { kind: "road", x: 40, z: -48.5, params: { length: 41, width: 8 } },
  { kind: "road", x: 22, z: -30, rotY: Math.PI / 2, params: { length: 44, width: 7 } },
  { kind: "road", x: -30, z: -20, rotY: Math.PI / 2, params: { length: 64, width: 7 } },
  { kind: "road", x: 95, z: -104, rotY: Math.PI / 2, params: { length: 25, width: 8, surface: "dirt" } },
  // Short stubs through the gatehouse arches — the barricades flank these.
  { kind: "road", x: -100, z: 76.5, params: { length: 80, width: 6.5 } },
  { kind: "road", x: 105, z: -106, params: { length: 12, width: 6.5, surface: "dirt" } },

  // ===== C — the square ========================================================
  { kind: "well", x: 0, z: 0 },
  // Market stalls in a tidy ring off the crossroads, counters square to the
  // well. Waist-high cover is all the flag gets.
  { kind: "stall", x: 13.5, z: 7.5 },
  { kind: "stall", x: 8.5, z: 7.5 },
  { kind: "stall", x: -8.5, z: -7.5, rotY: Math.PI },
  { kind: "stall", x: 8.5, z: -7.5, rotY: Math.PI },
  // Lamps at the four road corners, never in the driving line.
  { kind: "lamp", x: -6, z: 6 },
  { kind: "lamp", x: 6, z: 6, rotY: Math.PI },
  { kind: "lamp", x: -6, z: -6 },
  { kind: "lamp", x: 6, z: -6, rotY: Math.PI },
  // The ring of houses that makes the square a square — all square to the roads.
  { kind: "cottage", x: -29, z: 28.5, rotY: Math.PI, params: { litWindows: true } },
  { kind: "cottage", x: 17, z: 17, params: { width: 8, litWindows: true } },
  { kind: "cottage", x: 21, z: -8.5, rotY: Math.PI / 2, params: { depth: 8 } },
  { kind: "cottage", x: -21, z: -9, rotY: -Math.PI / 2, params: { enterable: true } },
  { kind: "cottage", x: 9, z: -21, rotY: Math.PI, params: { ruined: true } },
  { kind: "cottage", x: -9, z: 19.5, rotY: -Math.PI / 2, params: { width: 9, enterable: true, litWindows: true } },
  // The two trades that make the square a town rather than a crossroads. The
  // tavern's porch and the smithy's open front both face the road, so each is
  // a piece of cover you fight *through*.
  { kind: "tavern", x: -30, z: 11 },
  { kind: "smithy", x: -10.5, z: -29, rotY: Math.PI },
  // Townhouses: taller than they are wide, jettied over the lane. A row of
  // them is what gives the square a skyline instead of a ring of sheds.
  { kind: "townhouse", x: -11, z: 8, params: { enterable: true, litWindows: true } },
  { kind: "townhouse", x: 13, z: -14, params: { litWindows: true } },
  // Market clutter — chest-high, so C keeps its "no cover taller than a
  // stall" character while no longer being a car park.
  { kind: "cart", x: -22.5, z: 3 },
  { kind: "cart", x: 5, z: 11, rotY: Math.PI / 2, params: { ruined: true } },
  { kind: "crates", x: 12, z: -3 },
  { kind: "trough", x: -8.5, z: -11 },

  // ===== A — the chapel ========================================================
  // Terrace first: the chapel and its graveyard stand on top of it.
  { kind: "terrace", x: -60, z: 80, params: { width: 40, depth: 38, height: TERRACE_H, rampSide: -1 } },
  { kind: "chapel", x: -60, z: 74, y: TERRACE_H },
  // Graveyard fence, split at the ramp — an unbroken fence here sealed the
  // terrace's only way in.
  { kind: "fence", x: -71, z: 62.5, y: TERRACE_H, params: { length: 16 } },
  { kind: "fence", x: -49, z: 62.5, y: TERRACE_H, params: { length: 16 } },
  { kind: "fence", x: -79, z: 80, y: TERRACE_H, rotY: Math.PI / 2, params: { length: 34 } },
  { kind: "fence", x: -41, z: 80, y: TERRACE_H, rotY: Math.PI / 2, params: { length: 34 } },
  { kind: "lamp", x: -74, z: 65, y: TERRACE_H },
  { kind: "lamp", x: -46, z: 65, y: TERRACE_H },
  { kind: "cottage", x: -34, z: 92, params: { ruined: true } },
  { kind: "cottage", x: -90, z: 72, rotY: Math.PI / 2, params: { width: 8, litWindows: true } },

  // ===== B — the mill and the creek ===========================================
  // Two embankments 1.5 m high with a 6 m sunken lane between them. The creek
  // floor is the ground plane; the flag sits down in it.
  { kind: "terrace", x: -97, z: -10, params: { width: 18, depth: 76, height: BANK_H, rampSide: -1 } },
  { kind: "terrace", x: -73, z: -10, params: { width: 18, depth: 76, height: BANK_H, rampSide: -1 } },
  // Unrotated so the waterwheel faces west, turning over the creek lane
  // instead of hanging off the mill's north face. x places the stone base
  // flush with the lane's edge so nothing floats over the drop; only the
  // wheel straddles the water.
  { kind: "mill", x: -76.7, z: 12, y: BANK_H },
  { kind: "bridge", x: -85, z: 22, y: 2.34, rotY: Math.PI / 2, params: { length: 26 } },
  { kind: "bridge", x: -85, z: -44, y: 2.19, rotY: Math.PI / 2, params: { length: 26 } },
  // Ramps in and out of the lane. A 1.5 m trench is right at the edge of a
  // standing jump, so without these the creek is a one-way trap for bots.
  { kind: "lamp", x: -73, z: -22, y: BANK_H },
  { kind: "cottage", x: -58, z: -38, params: { ruined: true } },
  { kind: "cottage", x: -60, z: 32, params: { width: 8 } },

  // ===== filler: the open ground between flags ================================
  // Cover on the long approaches, so crossing C -> D and C -> E isn't a walk
  // across a car park.
  { kind: "cottage", x: 36, z: 12, params: { width: 8, ruined: true } },
  { kind: "cottage", x: 46, z: 40, params: { litWindows: true } },
  { kind: "haystack", x: 30, z: 24 },
  // Roadside fence lines flanking the east road out of the square.
  { kind: "fence", x: 34, z: 7, params: { length: 16 } },
  { kind: "fence", x: 33.5, z: -5, params: { length: 16 } },
  { kind: "cottage", x: 16, z: -40, params: { width: 8 } },
  { kind: "cottage", x: 31, z: -45, rotY: Math.PI / 2, params: { ruined: true } },
  { kind: "fence", x: 26, z: -50, rotY: Math.PI / 2, params: { length: 26 } },
  { kind: "cottage", x: -38.5, z: -10, rotY: Math.PI, params: { enterable: true } },
  { kind: "cottage", x: -44, z: 20, params: { width: 8, ruined: true } },
  { kind: "cottage", x: -30, z: 47.52, params: { litWindows: true } },
  { kind: "lamp", x: -46, z: -7, rotY: -Math.PI / 2 },
  { kind: "lamp", x: 40, z: 20 },
  { kind: "haystack", x: -40, z: 46 },

  // ===== the west street: C -> B =============================================
  // The old road out to the mill, built up on both sides so the crossing is a
  // street fight rather than sixty metres of nothing.
  { kind: "townhouse", x: -44, z: 9, params: { litWindows: true } },
  { kind: "townhouse", x: -52, z: -10.5, rotY: -Math.PI, params: { litWindows: true } },
  { kind: "shed", x: -49.5, z: 9, rotY: Math.PI / 2 },
  { kind: "woodpile", x: -22, z: 10.5, rotY: Math.PI / 2, params: { length: 6 } },
  { kind: "cart", x: -26, z: -8.5, rotY: Math.PI / 2 },
  { kind: "stoneWall", x: -52.5, z: 14.5, rotY: Math.PI, params: { length: 22 } },
  { kind: "ruin", x: -53, z: 28, params: { width: 9, depth: 7 } },
  { kind: "trough", x: -32, z: -8.5 },

  // ===== the north crofts: C -> A ============================================
  // Smallholdings on the road north, walled into paddocks. The stone walls
  // matter more than the buildings: they break the sightline from the square
  // to the chapel terrace, which used to be one unbroken lane.
  { kind: "shrine", x: 4, z: 40 },
  { kind: "townhouse", x: 24, z: 41.5, rotY: Math.PI / 2, params: { width: 7 } },
  { kind: "townhouse", x: -10, z: 31, rotY: -Math.PI / 2, params: { litWindows: true } },
  { kind: "townhouse", x: 10, z: 44 },
  { kind: "cottage", x: 9, z: 52, params: { width: 8, litWindows: true } },
  { kind: "ruin", x: 2, z: 74 },
  { kind: "shed", x: 14, z: 58 },
  { kind: "woodpile", x: -6, z: 60, rotY: Math.PI / 2 },
  { kind: "haystack", x: 17, z: 48 },
  { kind: "cart", x: -4, z: 47 },
  { kind: "stoneWall", x: 8, z: 66, params: { length: 20 } },
  { kind: "stoneWall", x: -8, z: 52, rotY: Math.PI / 2, params: { length: 16 } },

  // ===== ASHWOOD — the logging camp (north-east) =============================
  // Dirt lanes off the farmstead road into the felled woods: charcoal kilns,
  // stacked cordwood, and the Valeguard watchtower looking north.
  { kind: "road", x: 34, z: 61.5, params: { length: 55, width: 7, surface: "dirt" } },
  { kind: "road", x: 28, z: 90, rotY: Math.PI / 2, params: { length: 30, width: 7, surface: "dirt" } },
  { kind: "watchtower", x: 20, z: 82 },
  { kind: "kiln", x: 44, z: 68 },
  { kind: "kiln", x: 22, z: 100 },
  { kind: "shed", x: 41, z: 56 },
  { kind: "shed", x: 45, z: 60, rotY: Math.PI / 2 },
  { kind: "woodpile", x: 27, z: 66, params: { length: 6 } },
  { kind: "woodpile", x: 40, z: 80, rotY: Math.PI / 2, params: { length: 7 } },
  { kind: "woodpile", x: 52, z: 92, params: { length: 6 } },
  { kind: "ruin", x: 56, z: 62, params: { width: 9, depth: 8 } },
  { kind: "ruin", x: 34, z: 104, params: { width: 8, depth: 7 } },
  { kind: "cart", x: 30, z: 76 },
  { kind: "cart", x: 47, z: 98, params: { ruined: true } },
  { kind: "crates", x: 38, z: 97 },
  { kind: "trough", x: 44, z: 62 },
  // Field walls, split where the lane runs through — a sealed run is a wall
  // the flow field routes bots all the way around.
  { kind: "stoneWall", x: 24, z: 72, params: { length: 12 } },
  { kind: "stoneWall", x: 44, z: 72, params: { length: 12 } },
  { kind: "stoneWall", x: 50, z: 84, rotY: Math.PI / 2, params: { length: 18 } },
  { kind: "lamp", x: 29, z: 85 },
  { kind: "shrine", x: 37, z: 46 },

  // ===== the north-east fields: D -> ASHWOOD =================================
  { kind: "ruin", x: 68, z: 76, params: { width: 10, depth: 8 } },
  { kind: "stoneWall", x: 76, z: 64, params: { length: 22 } },
  { kind: "woodpile", x: 60, z: 72, rotY: Math.PI / 2 },
  { kind: "shed", x: 84, z: 72 },
  { kind: "cart", x: 88, z: 62, params: { ruined: true } },

  // ===== the east holdings ===================================================
  // A dirt lane from the Redline gatehouse up the map's east side, with the
  // outbuildings that give their approach cover it never had.
  { kind: "road", x: 86, z: -50, params: { length: 100, width: 7, surface: "dirt" } },
  { kind: "watchtower", x: 106, z: -29.991, rotY: 1.566 },
  { kind: "silo", x: 69.5, z: -17.5 },
  { kind: "cottage", x: 94.5, z: 0, rotY: Math.PI / 2, params: { width: 8, ruined: true } },
  { kind: "shed", x: 92, z: -20 },
  { kind: "shed", x: 96, z: -25, rotY: Math.PI / 2 },
  { kind: "shed", x: 74, z: -50 },
  { kind: "ruin", x: 72, z: -28, params: { width: 10, depth: 8 } },
  { kind: "ruin", x: 72, z: -66, params: { width: 8, depth: 7 } },
  { kind: "kiln", x: 66, z: -44 },
  { kind: "stoneWall", x: 76, z: -12, rotY: Math.PI / 2, params: { length: 22 } },
  { kind: "stoneWall", x: 98, z: -46, params: { length: 14 } },
  { kind: "woodpile", x: 69.5, z: -10, rotY: 0.53 },
  { kind: "cart", x: 79, z: -18 },
  { kind: "cart", x: 92.893, z: -81.949, rotY: 0.466 },
  { kind: "crates", x: 92, z: -44 },
  { kind: "crates", x: 78, z: -84 },
  { kind: "trough", x: 92, z: -12 },
  { kind: "shrine", x: 80, z: -60 },

  // ===== THE BURYING GROUND (south of the square) ===========================
  // A walled churchyard on the moor road. Walls are split at the corners and
  // the gate is 7 m wide: enclosed ground has to stay reachable or the flood
  // fill writes the whole plot off.
  { kind: "road", x: -43.5, z: -70, rotY: Math.PI / 2, params: { length: 90, width: 7, surface: "dirt" } },
  { kind: "road", x: 0, z: -77, params: { length: 24, width: 7, surface: "dirt" } },
  { kind: "stoneWall", x: -24, z: -42, params: { length: 22 } },
  { kind: "stoneWall", x: -35, z: -52, rotY: Math.PI / 2, params: { length: 18 } },
  { kind: "stoneWall", x: -13, z: -52, rotY: Math.PI / 2, params: { length: 18 } },
  { kind: "stoneWall", x: -31, z: -62, params: { length: 7 } },
  { kind: "stoneWall", x: -17, z: -62, params: { length: 7 } },
  { kind: "ruin", x: -29, z: -50, params: { width: 8, depth: 6 } },
  { kind: "shrine", x: -24, z: -65 },
  { kind: "lamp", x: -20, z: -44 },

  // ===== the moor road (C -> E, C -> the mire) ==============================
  { kind: "cottage", x: 9, z: -50.5, rotY: -Math.PI / 2, params: { width: 8, ruined: true } },
  { kind: "townhouse", x: -11, z: -58 },
  { kind: "ruin", x: 10, z: -66, params: { width: 9, depth: 7 } },
  { kind: "ruin", x: -20, z: -80, params: { width: 9, depth: 7 } },
  { kind: "shed", x: -6, z: -80 },
  { kind: "kiln", x: 8, z: -84 },
  { kind: "cart", x: -8, z: -68, params: { ruined: true } },
  { kind: "stoneWall", x: -12, z: -88, params: { length: 18 } },
  { kind: "haystack", x: -14, z: -34 },
  { kind: "cottage", x: -22, z: -28, params: { width: 8 } },
  { kind: "ruin", x: -32, z: -34, params: { width: 8, depth: 6 } },
  { kind: "woodpile", x: -10, z: -49.5, rotY: Math.PI / 2 },

  // ===== THE MOOR and THE MIRE (south-west) =================================
  // Flooded crofts around a second pool of standing water, with a jetty out
  // into it. The far south-west used to be seventy metres of bare ground.
  { kind: "road", x: -85, z: -61, params: { length: 24, width: 7, surface: "dirt" } },
  { kind: "cottage", x: -52, z: -60, params: { ruined: true } },
  { kind: "ruin", x: -64, z: -78, params: { width: 10, depth: 8 } },
  { kind: "ruin", x: -112.5, z: -102, rotY: -Math.PI / 2, params: { width: 10, depth: 8 } },
  { kind: "jetty", x: -56, z: -90, params: { length: 14 } },
  { kind: "watchtower", x: -101.236, z: -80.288, rotY: -2.363 },
  { kind: "kiln", x: -70, z: -62 },
  { kind: "shed", x: -44, z: -80 },
  { kind: "shed", x: -78, z: -104 },
  { kind: "woodpile", x: -56, z: -52, params: { length: 6 } },
  { kind: "cart", x: -40, z: -60 },
  { kind: "crates", x: -49, z: -76 },
  { kind: "stoneWall", x: -53.5, z: -47.5, params: { length: 20 } },
  { kind: "stoneWall", x: -82, z: -92, params: { length: 16 } },
  { kind: "lamp", x: -60, z: -66 },

  // ===== D — the farmstead ====================================================
  { kind: "barn", x: 80, z: 34, rotY: Math.PI },
  { kind: "silo", x: 98, z: 16 },
  { kind: "haystack", x: 64, z: 18 },
  { kind: "haystack", x: 70, z: 10 },
  { kind: "haystack", x: 92, z: 40 },
  { kind: "fence", x: 78, z: 6, params: { length: 40 } },
  // West paddock fence, split where the road runs in to the barn ramp.
  { kind: "fence", x: 58, z: 15, rotY: Math.PI / 2, params: { length: 18 } },
  { kind: "fence", x: 58, z: 44, rotY: Math.PI / 2, params: { length: 16 } },
  { kind: "fence", x: 104, z: 34, rotY: Math.PI / 2, params: { length: 36 } },
  { kind: "lamp", x: 62, z: 22 },
  { kind: "cottage", x: 64, z: 54, params: { litWindows: true } },
  { kind: "cottage", x: 96, z: 54, params: { width: 8, enterable: true } },

  // ===== E — the bog docks ====================================================
  { kind: "boathouse", x: 40, z: -80, rotY: Math.PI },
  // The deck stands 0.73 m over the mud — too tall to step onto, so the door
  // gets a ramp or the whole flag is unreachable.
  { kind: "ramp", x: 40, z: -71, y: -0.346, rotY: Math.PI, params: { length: 5, width: 4, height: 0.73 } },
  { kind: "jetty", x: 24.5, z: -83.5, y: 0.142, rotY: Math.PI / 2, params: { length: 20 } },
  { kind: "jetty", x: 21.5, z: -95, y: 0.18, params: { length: 20 } },
  // Shore fence, split at the ramp — an unbroken fence here blocked the only
  // door the ramp serves.
  { kind: "fence", x: 31, z: -70, params: { length: 10 } },
  { kind: "fence", x: 49, z: -70, params: { length: 10 } },
  { kind: "lamp", x: 30, z: -68 },
  { kind: "cottage", x: 22, z: -62, params: { ruined: true } },
  { kind: "cottage", x: 56, z: -60, params: { width: 8, litWindows: true } },

  // ===== home spawns ==========================================================
  { kind: "gatehouse", x: -100, z: 110, params: { teamColor: VALEGUARD } },
  { kind: "gatehouse", x: 105, z: -110, rotY: Math.PI, params: { teamColor: REDLINE } },
  { kind: "barn", x: 104, z: -70.746, y: -0.17, rotY: -Math.PI / 2 },
  { kind: "fence", x: 25.285, z: -19.321, rotY: Math.PI / 2, params: { length: 14 } },
  { kind: "woodpile", x: 20.478, z: -47.91, y: 0.05, rotY: 0.495 },
  { kind: "trough", x: 19.011, z: -51.848, y: 0.083 },
];

const scatter: ScatterSpec[] = [
  // Graveyard on the chapel terrace, kept to the strips either side of the
  // nave so headstones don't spawn inside the chapel.
  { prop: "gravestone", x: -72.5, z: 89, radius: 6, count: 12, y: TERRACE_H, scale: [0.8, 1.3], blocking: true, clearance: 0.6 },
  { prop: "gravestone", x: -47, z: 89, radius: 6, count: 12, y: TERRACE_H, scale: [0.8, 1.3], blocking: true, clearance: 0.6 },
  { prop: "deadTree", x: -72, z: 70, radius: 5, count: 3, y: TERRACE_H, scale: [1.0, 1.6], blocking: true, clearance: 0.55 },
  { prop: "deadTree", x: -47, z: 68, radius: 5, count: 3, y: TERRACE_H, scale: [1.0, 1.6], blocking: true, clearance: 0.55 },
  // The dead woods filling the map's corners — all inside the valley ridge.
  { prop: "deadTree", x: -82.5, z: 53, radius: 12, count: 13, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  { prop: "deadTree", x: -14, z: 102, radius: 13, count: 12, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  { prop: "deadTree", x: -46, z: 108, radius: 8, count: 6, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  { prop: "deadTree", x: 98, z: 88, radius: 18, count: 16, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  { prop: "deadTree", x: -102, z: -83, width: 34, depth: 60, count: 25, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  // Creek bed: fallen logs in the lane, clear of the ramps and the B spawn.
  { prop: "log", x: -85, z: 12, radius: 12, count: 5, scale: [0.8, 1.2], blocking: true, clearance: 1.4 },
  { prop: "log", x: -85, z: -14, radius: 12, count: 5, scale: [0.8, 1.2], blocking: true, clearance: 1.4 },
  { prop: "fungus", x: -85, z: -20, radius: 20, count: 5, scale: [0.7, 1.2] },
  // The bog: corpse-fungus is the only light down there.
  { prop: "fungus", x: 32, z: -88, radius: 16, count: 7, scale: [0.8, 1.4] },
  { prop: "log", x: 36, z: -93, radius: 7, count: 6, scale: [0.8, 1.2], blocking: true, clearance: 1.4 },
  { prop: "deadTree", x: 70, z: -86, radius: 11, count: 10, scale: [0.8, 1.4], blocking: true, clearance: 0.55 },
  // Rubble where the village has already fallen in.
  { prop: "rubble", x: 11, z: -21, radius: 8, count: 5, scale: [0.8, 1.2], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: -34, z: 92, radius: 8, count: 4, scale: [0.8, 1.2], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: 22, z: -62, radius: 9, count: 4, scale: [0.8, 1.2], blocking: true, clearance: 1.1 },
  { prop: "rubble", x: -58, z: -38, radius: 9, count: 4, scale: [0.8, 1.2], blocking: true, clearance: 1.1 },
  // Ashwood: what the loggers left standing, and the boulders they worked
  // around. Brambles are non-blocking on purpose — undergrowth that fills bare
  // ground without adding another thing for a bot to wedge itself in.
  { prop: "deadTree", x: 40, z: 88, radius: 14, count: 12, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  { prop: "deadTree", x: 58, z: 104, radius: 12, count: 10, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  { prop: "bramble", x: 30, z: 70, radius: 16, count: 12, scale: [0.8, 1.4] },
  { prop: "boulder", x: 52, z: 78, radius: 12, count: 6, scale: [0.8, 1.3], blocking: true, clearance: 1.0 },
  { prop: "barrel", x: 42, z: 66, radius: 6, count: 4, blocking: true, clearance: 0.55 },
  { prop: "bramble", x: 62, z: 46, radius: 14, count: 9, scale: [0.8, 1.4] },
  // The north crofts.
  { prop: "bramble", x: 4, z: 64, radius: 12, count: 8, scale: [0.8, 1.4] },
  { prop: "boulder", x: -6, z: 72, radius: 9, count: 4, scale: [0.8, 1.3], blocking: true, clearance: 1.0 },
  { prop: "bramble", x: -46, z: 34, radius: 14, count: 9, scale: [0.8, 1.4] },
  // The strip between the creek's west bank and the valley ridge.
  { prop: "deadTree", x: -113, z: -14, radius: 14, count: 9, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  { prop: "bramble", x: -112, z: 14, radius: 12, count: 7, scale: [0.8, 1.4] },
  // The burying ground, inside its walls.
  { prop: "gravestone", x: -18, z: -56, radius: 6, count: 12, scale: [0.8, 1.3], blocking: true, clearance: 0.6 },
  { prop: "gravestone", x: -30, z: -58, radius: 5, count: 8, scale: [0.8, 1.3], blocking: true, clearance: 0.6 },
  { prop: "deadTree", x: -24, z: -48, radius: 6, count: 3, scale: [1.0, 1.6], blocking: true, clearance: 0.55 },
  // The moor south of the village.
  { prop: "bramble", x: -30, z: -84, radius: 18, count: 14, scale: [0.8, 1.4] },
  { prop: "boulder", x: -14, z: -94, radius: 14, count: 7, scale: [0.8, 1.3], blocking: true, clearance: 1.0 },
  { prop: "deadTree", x: -6, z: -100, radius: 12, count: 10, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  { prop: "rubble", x: -20, z: -80, radius: 8, count: 4, scale: [0.8, 1.2], blocking: true, clearance: 1.1 },
  // The mire and the crofts drowned around it.
  { prop: "fungus", x: -56, z: -94, radius: 14, count: 5, scale: [0.8, 1.4] },
  { prop: "log", x: -50, z: -90, radius: 8, count: 4, scale: [0.8, 1.2], blocking: true, clearance: 1.4 },
  { prop: "deadTree", x: -70, z: -104, radius: 12, count: 9, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  { prop: "bramble", x: -66, z: -88, radius: 12, count: 8, scale: [0.8, 1.4] },
  { prop: "rubble", x: -64, z: -78, radius: 8, count: 4, scale: [0.8, 1.2], blocking: true, clearance: 1.1 },
  { prop: "barrel", x: -46, z: -80, radius: 6, count: 3, blocking: true, clearance: 0.55 },
  { prop: "boulder", x: -84, z: -58, radius: 12, count: 6, scale: [0.8, 1.3], blocking: true, clearance: 1.0 },
  // The east holdings, along the Redline lane.
  { prop: "boulder", x: 98, z: -30, radius: 13, count: 7, scale: [0.8, 1.3], blocking: true, clearance: 1.0 },
  { prop: "bramble", x: 78, z: -40, radius: 14, count: 10, scale: [0.8, 1.4] },
  { prop: "deadTree", x: 106, z: -16, radius: 12, count: 8, scale: [0.9, 1.7], blocking: true, clearance: 0.55 },
  { prop: "barrel", x: 90, z: -46, radius: 6, count: 3, blocking: true, clearance: 0.55 },
  { prop: "bramble", x: 100, z: 24, radius: 14, count: 10, scale: [0.8, 1.4] },
  { prop: "boulder", x: 108, z: 44, radius: 10, count: 5, scale: [0.8, 1.3], blocking: true, clearance: 1.0 },
  // Market spill in the square itself.
  { prop: "barrel", x: 9, z: -12, radius: 7, count: 5, blocking: true, clearance: 0.55 },
  { prop: "barrel", x: -14, z: 6, radius: 7, count: 4, blocking: true, clearance: 0.55 },
  // Braziers the defenders left burning. Sparse — each one costs a light slot.
  { prop: "fireDrum", x: -8, z: -14, radius: 3, count: 1, blocking: true, clearance: 0.6 },
  { prop: "fireDrum", x: 82, z: 22, radius: 4, count: 1, blocking: true, clearance: 0.6 },
  { prop: "fireDrum", x: -112, z: 100, radius: 3, count: 1, blocking: true, clearance: 0.6 },
  { prop: "fireDrum", x: 114, z: -102, radius: 2, count: 1, blocking: true, clearance: 0.6 },
  // The pinewood under the west ridge — the one stand the blight hasn't taken,
  // and the only green on the map. Appended rather than filed with the other
  // woods on purpose: one seeded stream serves the whole build, so inserting a
  // region rerolls the dressing of every region after it.
  { prop: "pine", x: -109.5, z: 61, width: 14, depth: 50, count: 12, scale: [0.9, 1.3], blocking: true, clearance: 1.2 },
  { prop: "deadTree", x: 111, z: -50.19, radius: 11, count: 10, y: -0.365, scale: [0.8, 1.4], blocking: true, clearance: 0.55 },
  { prop: "barrel", x: 98.794, z: -84.998, radius: 6, count: 3, blocking: true, clearance: 0.55 },
];

const controlPoints: ControlPointDef[] = [
  { id: "A", name: "The Chapel", pos: new Vector3(-60, TERRACE_H, 76), radius: 14 },
  { id: "B", name: "The Mill", pos: new Vector3(-97, TERRACE_H, -28), radius: 13 },
  // Just south of the well: standing the flag *on* the well would put its
  // centre inside a collider, where nothing can stand.
  { id: "C", name: "The Square", pos: new Vector3(0, 0, -4), radius: 14 },
  { id: "D", name: "The Farmstead", pos: new Vector3(80, 0, 34), radius: 13 },
  { id: "E", name: "The Bog Docks", pos: new Vector3(40, 0.73, -84), radius: 12 },
];

/**
 * Home spawns are uncapturable. Every control point also carries a spawn just
 * outside its capture zone, so deploying onto a flag you hold does not drop you
 * on top of whoever is contesting it.
 *
 * Home spawns deploy on the village side of the gatehouse barricades — a
 * spawn line drawn through the sandbags is not a safe place to materialise.
 */
const spawns: SpawnPointDef[] = [
  { team: 0, pos: new Vector3(-100, 0, 96), yaw: Math.PI },
  { team: 0, pos: new Vector3(-94, 0, 96), yaw: Math.PI },
  { team: 0, pos: new Vector3(-106, 0, 96), yaw: Math.PI },
  { team: 1, pos: new Vector3(105, 0, -96), yaw: 0 },
  { team: 1, pos: new Vector3(99, 0, -96), yaw: 0 },
  { team: 1, pos: new Vector3(111, 0, -96), yaw: 0 },
  { team: null, controlPoint: "A", pos: new Vector3(-60, TERRACE_H, 62), yaw: Math.PI },
  { team: null, controlPoint: "B", pos: new Vector3(-99, BANK_H, -24.5), yaw: Math.PI },
  { team: null, controlPoint: "C", pos: new Vector3(-2, 0, -18), yaw: Math.PI },
  { team: null, controlPoint: "D", pos: new Vector3(80, 0, 14), yaw: Math.PI },
  { team: null, controlPoint: "E", pos: new Vector3(40, 0, -66), yaw: 0 },
];

/**
 * Dug ground lives in `heights.ts`, generated by the editor's terrain mode —
 * the bog and the mire sit in shallow basins rather than on a level floor,
 * which is what makes the water read as sitting IN the valley with a bank
 * around it instead of hovering over it.
 *
 * The creek at B is deliberately NOT dug. Its depth is two 1.5 m terraces
 * either side of untouched floor, and those terraces carry the mill, both
 * footbridges and the flag's whole sightline — reshaping it is a change to how
 * B plays, not a change to how it looks.
 */

/**
 * Standing water. Ankle-deep everywhere (CONFIG.water.surfaceY) over the bed
 * beneath it, so bots and the player wade across — no swimming, and the nav
 * grid never hears about it. A rect over a dug basin therefore sits below the
 * surrounding ground: -0.6 m of bed puts the surface at -0.28.
 */
const water: WaterRect[] = [
  // The creek: fills the sunken lane between the two embankments, running
  // under both footbridges and the mill's waterwheel. A touch wider than the
  // lane so the edges tuck under the retaining walls instead of showing a seam.
  { x: -85, z: -10, width: 6.6, depth: 76, y: -0.246 },
  // The bog: the pool the boathouse and jetties stand in. Stops short of the
  // boathouse ramp foot in the north and the Redline road in the east.
  { x: 37, z: -95, width: 55, depth: 50 },
  // The mire: the moor's own pool, out where the south-west crofts drowned.
  // One jetty runs into it; everything else around it is ruin.
  { x: -56, z: -96, width: 34, depth: 26 },
];

/**
 * Grass fields. Pale, dead, knee-high — the valley's one crop that still
 * grows. Placement rules: rects dodge roads (roads are visual-only, so no
 * collider rejects a blade poking through the cobbles — that check is on the
 * author), while structures, fences, and props are cleared automatically by
 * the GrassSystem's collider rejection. Grass in the bog pool reads as
 * reeds: the blades outgrow the ankle-deep waterline on purpose.
 */
const grass: GrassRect[] = [
  // The chapel graveyard, on the terrace: strips either side of the nave.
  { x: -72, z: 81, width: 12, depth: 28, y: TERRACE_H },
  { x: -48, z: 81, width: 12, depth: 28, y: TERRACE_H },
  // The creek embankments, on the bank tops — reeds above the sunken lane.
  { x: -97, z: -10, width: 15, depth: 70, y: BANK_H, density: 0.7 },
  { x: -73, z: -10, width: 15, depth: 70, y: BANK_H, density: 0.7 },
  // The field west of the square, between the north road and the chapel road.
  { x: -13, z: 27, width: 16, depth: 18, density: 0.6 },
  // The farmstead paddocks — tall grass over the open sightlines at D.
  { x: 68, z: 16, width: 18, depth: 15, density: 3 },
  { x: 93, z: 44, width: 16, depth: 14, density: 3 },
  // The bog: the pool's shallows grow reeds around the jetties.
  { x: 40, z: -88, width: 36, depth: 20, density: 0.8 },
  // The dead woods in the north-east corner, sparse under the trees.
  { x: 98, z: 88, width: 30, depth: 30, density: 0.5 },
  // Ashwood's clearing, east of the logging lane.
  { x: 48, z: 80, width: 16, depth: 20, density: 0.5 },
  // The north crofts' paddock, east of the road out of the square.
  { x: 12, z: 60, width: 14, depth: 16, density: 0.7 },
  // The burying ground, inside its walls.
  { x: -24, z: -52, width: 20, depth: 16, density: 0.6 },
  // The moor, between the churchyard and the southern woods.
  { x: -30, z: -84, width: 40, depth: 20, density: 0.55 },
  // The mire's shallows — reeds, same trick as the bog.
  { x: -56, z: -94, width: 30, depth: 20, density: 0.8 },
  // The east holdings' rough grazing, east of the Redline lane.
  { x: 98, z: -20, width: 16, depth: 26, density: 0.5 },
  { x: 53.884, z: -15.486, width: 57, depth: 22, density: 2 },
  { x: 63.027, z: -48.428, width: 39, depth: 44, density: 2 },
];

export const HollowmereLayout: MapLayout = {
  placements,
  scatter,
  controlPoints,
  spawns,
  water,
  grass,
  terrain: HollowmereHeights,
  /**
   * The valley rim. Only the two cols are authored — everything else about the
   * escarpment falls out of Ridge.ts's defaults.
   *
   * Each col sits over the road that leaves the valley through a gatehouse, so
   * the two home spawns look out through a saddle in the crag rather than at a
   * blank rock face. Both roads run along Z, so the Valeguard gap is in the
   * north rim and Redline's is in the SOUTH rim — not the east, though its
   * gatehouse stands only 15 m off it.
   */
  ridge: {
    passes: [
      // Above the Valeguard road, which runs north to z ≈ 116.5.
      { x: -100, z: 120, width: 26 },
      // The Redline track south. Narrower: the corner massif is close.
      { x: 105, z: -120, width: 18 },
    ],
  },
  // Fixed so the dressing — and the colliders blocking scatter emits, and so
  // the nav graph — is identical on every boot. Changing it rerolls the whole
  // scatter field, which is a visible change to the level: re-walk the flags.
  seed: 0x484c,
};
