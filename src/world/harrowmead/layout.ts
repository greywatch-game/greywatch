/**
 * harrowmead/layout.ts — THE MAP, as data: structure placements, scatter
 * regions, control points, spawns, water rects, grass rects. The floor's shape
 * is generated data and lives in heights.ts. Consumed by MapBuilder; nothing
 * here is code to special-case.
 * Gotchas that have already cost time: collider top faces within
 * CONFIG.nav.stepHeight of adjacent ground or bots treat decks as walls;
 * a control point's pos must NOT sit inside a PLACEMENT's collider (surfaceAt
 * returns -1 — scatter is held off flags and spawns by `MapBuilder.keepClear`,
 * placements are not); scatter regions must dodge the roads by hand, because a
 * road is visual-only and rejects nothing; terrain steeper than a 0.4 gradient
 * severs its own nav links. A second map is one new file shaped like this plus
 * an EnvironmentSpec.
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
import { HarrowmeadHeights } from "./heights";

/**
 * HARROWMEAD — a farming town in a broad green vale, high summer.
 *
 * **400 x 400 m**, origin at the market green, +Z is north — the largest map
 * yet, laid out at a scale where the ground between flags is country rather
 * than street: long lanes, hedged fields and rolling hills that a vehicle can
 * mean something on — and one does: this is the second map with armour on it,
 * a hardstanding a side in the home yards (see `vehicles` below).
 * `MapLayout.size` states the extent and everything downstream takes it as an
 * argument; the heightfield is 100 cells of 4 m (Coldharbour's cell at half
 * again the area) so the slope limit stays an authorable number.
 *
 * ```
 *                              N
 *   +---------------------------------------------------------+
 *   | ~ KNOLL WOOD ~                          x NE HOME YARD  |
 *   |   (-140,132)      stream                  (160,160)     |
 *   |        ~~~~~~~ in from NW            [D] ORCHARD HILL   |
 *   | [A] THE MILL ~~~~ pond                  (110,95)        |
 *   |   (-98,40)      ~~~~~~~~ ford ~~~~ ford ~~~~ out E      |
 *   |                    [C] MARKET GREEN                     |
 *   |    ~ hay meadows ~   (0,-6)        ~ hedged fields ~    |
 *   |                        |                                |
 *   | [B] THE GRANGE      south road        [E] KILN YARD     |
 *   |   (-88,-110)           |                 (90,-90)       |
 *   |  x SW HOME YARD     ~ south meadow ~    ~ SE WOOD ~     |
 *   |    (-160,-160)                                          |
 *   +---------------------------------------------------------+
 * ```
 *
 * ## The vale, which is what the size buys
 *
 * The fog wall is gone (`fogEnd` 520 — see environment.ts) and
 * `bots.perception.engageRange` (55) did not move with it, so like Coldharbour
 * this layout is built knowing the two disagree. What breaks the sightlines
 * here is not frontage but GROUND: the vale rolls a metre or two everywhere,
 * the orchard hill stands eight metres over the green, and the stream runs a
 * metre below its banks — so a 300 m lane is really a chain of 50-70 m bounds
 * between crests, and the stone field walls (a fence is porous and a fern
 * stops nothing) mark where those bounds are — with a line of hedgerow ash
 * standing over each one, which is the second thing on a boundary that stops a
 * round and the only one legible from the far end of the field it breaks.
 * Expect open ground to stay dangerous; that is the map.
 *
 * ## Design intent per flag
 *
 * - **A The Mill** — the yard between the millpond and the lane. The stream
 *   bends around it on two sides, so every approach but the east one is a
 *   wade below the bank line.
 * - **B The Grange** — the big barn farm: one huge building to hold, twin
 *   silos, and paddock fences that shape movement without stopping a round.
 * - **C The Market Green** — the town: a crossroads, a well, stalls and a
 *   ring of cottages. Four roads feed it and the buildings are the cover.
 * - **D Orchard Hill** — the high ground, walled. Taking it means climbing
 *   open pasture; holding it means owning the best view on the map.
 * - **E The Kiln Yard** — the workyard: kilns, drying sheds and woodpiles, a
 *   close brawl in a map of long looks.
 *
 * ## Layout hygiene (keep to these when editing)
 *
 * - Structures are axis-aligned (`rotY` in multiples of π/2). Organic tilt
 *   belongs to scatter props, not buildings.
 * - Roads end at junctions, wall faces, or yard mouths — never under a
 *   building, an embankment, or a fence line. Two roads FORD the stream on
 *   purpose (they conform to the terrain and dip through the water); the banks
 *   grade under 0.25 the whole run, so a ford is a line a hull takes rather
 *   than the only place one can cross.
 * - Fences and stone walls split with a gate wherever a road or lane passes
 *   through them, and enclosure corners are left open.
 * - No lamps: the sun is still up, and a carried flame would spend
 *   one of the sixteen light slots proving nothing (Greyfen's rule).
 * - Scatter regions dodge every road by hand — the road extents are listed
 *   above the scatter array.
 * - The ORDER of the scatter array is load-bearing: every region draws from
 *   one seeded stream, so a region added anywhere but the end re-rolls every
 *   field below it. The greening is appended in a block at the bottom for
 *   exactly that reason, and its comment carries the argument.
 */

/** Team 0's livery — harvest gold on the south-west gatehouse. */
const HARVEST = "#d8a53f";
/** Team 1's livery — drover oxblood on the north-east gatehouse. */
const DROVE = "#8c3f34";

const placements: Placement[] = [
  // ===== roads ===============================================================
  // Visual only; they conform to the terrain (terrainSlab) and carry no
  // collider. Extents, for the scatter and grass arrays to dodge:
  //  R1 High Street      x -4..4,        z -66..66   (cobble)
  //  R2 Town cross       x -72..72,      z -10..-2   (cobble)
  //  R3 Mill lane        x -106..-14,    z 36.5..43.5
  //  R4 Mill connector   x -17.5..-10.5, z -6..40
  //  R5 South road       x -3.5..3.5,    z -110..-66
  //  R6 Grange lane      x -90..0,       z -113.5..-106.5
  //  R7 East road        x 66.5..73.5,   z -90..-6
  //  R8 Kiln stub        x 70..90,       z -93.5..-86.5
  //  R9 Northeast road   x 66.5..73.5,   z -6..86    (fords the stream)
  //  R10 Orchard lane    x 70..110,      z 82.5..89.5
  //  R11 NE spawn road   x 156.75..163.25, z 162..198
  //  R12 SW spawn road   x -163.25..-156.75, z -198..-162
  { kind: "road", x: 0, z: 0, params: { length: 132, width: 8 } },
  { kind: "road", x: 0, z: -6, rotY: Math.PI / 2, params: { length: 144, width: 8 } },
  { kind: "road", x: -60, z: 40, rotY: Math.PI / 2, params: { length: 92, width: 7, surface: "dirt" } },
  { kind: "road", x: -14, z: 17, params: { length: 46, width: 7, surface: "dirt" } },
  { kind: "road", x: 0, z: -88, params: { length: 44, width: 7, surface: "dirt" } },
  { kind: "road", x: -45, z: -110, rotY: Math.PI / 2, params: { length: 90, width: 7, surface: "dirt" } },
  { kind: "road", x: 70, z: -48, params: { length: 84, width: 7, surface: "dirt" } },
  { kind: "road", x: 80, z: -90, rotY: Math.PI / 2, params: { length: 20, width: 7, surface: "dirt" } },
  { kind: "road", x: 70, z: 40, params: { length: 92, width: 7, surface: "dirt" } },
  { kind: "road", x: 90, z: 86, rotY: Math.PI / 2, params: { length: 40, width: 7, surface: "dirt" } },
  { kind: "road", x: 160, z: 180, params: { length: 36, width: 6.5, surface: "dirt" } },
  { kind: "road", x: -160, z: -180, params: { length: 36, width: 6.5, surface: "dirt" } },

  // ===== C — the market green ================================================
  // The well stands at the crossroads (Hollowmere's pattern); the flag is just
  // south of it, on the green, because a flag centred on the well would put
  // its pos inside a collider where nothing can stand.
  { kind: "well", x: 0, z: 4 },
  { kind: "stall", x: 11, z: 3 },
  { kind: "stall", x: -11, z: 3 },
  { kind: "stall", x: 11, z: -14, rotY: Math.PI },
  { kind: "stall", x: -11, z: -14, rotY: Math.PI },
  { kind: "tavern", x: -26, z: 10 },
  { kind: "cottage", x: -14, z: 22, rotY: -Math.PI / 2, params: { enterable: true, litWindows: true } },
  { kind: "cottage", x: -40, z: 16, params: { width: 8 } },
  { kind: "shed", x: -34, z: 30, rotY: Math.PI / 2 },
  { kind: "chapel", x: 20, z: 26 },
  { kind: "townhouse", x: 10, z: 10, params: { litWindows: true } },
  { kind: "cottage", x: 34, z: 12, rotY: Math.PI / 2, params: { width: 8 } },
  { kind: "cottage", x: 14, z: 40, params: { litWindows: true } },
  { kind: "townhouse", x: -16, z: -18, params: { litWindows: true } },
  { kind: "smithy", x: -32, z: -20 },
  { kind: "cottage", x: -14, z: -36, rotY: Math.PI },
  { kind: "woodpile", x: -26, z: -32, rotY: Math.PI / 2 },
  { kind: "townhouse", x: 18, z: -18 },
  { kind: "cottage", x: 30, z: -16, rotY: Math.PI / 2, params: { width: 8, enterable: true } },
  { kind: "cottage", x: 16, z: -34, rotY: Math.PI, params: { enterable: true } },
  { kind: "crates", x: 26, z: -28 },
  { kind: "trough", x: 9, z: -13 },
  { kind: "trough", x: 8, z: 3 },
  { kind: "cart", x: -22, z: -13, rotY: Math.PI / 2 },
  { kind: "cart", x: 20, z: 7 },
  { kind: "cart", x: -14, z: 34 },

  // ===== A — the mill ========================================================
  // The mill stands at the pond's east lip, unrotated so the waterwheel (on
  // its west face) turns over the water. Its centre samples the yard, not the
  // pond bed — nudging it west sinks the whole building, so re-check the
  // sampled ground after any move.
  { kind: "mill", x: -108, z: 46 },
  { kind: "cottage", x: -98, z: 58, params: { litWindows: true } },
  { kind: "cottage", x: -94, z: 32, rotY: Math.PI, params: { width: 8 } },
  { kind: "shed", x: -110, z: 62, rotY: Math.PI / 2 },
  { kind: "trough", x: -100, z: 48 },
  { kind: "cart", x: -104, z: 34, rotY: Math.PI / 2 },
  { kind: "woodpile", x: -96, z: 42 },
  // Yard fences, split where the mill lane (R3) runs in.
  { kind: "fence", x: -86, z: 53, rotY: Math.PI / 2, params: { length: 14 } },
  { kind: "fence", x: -86, z: 30, rotY: Math.PI / 2, params: { length: 12 } },
  { kind: "fence", x: -96, z: 64, params: { length: 20 } },

  // ===== B — the grange ======================================================
  { kind: "barn", x: -102, z: -102, rotY: Math.PI / 2 },
  { kind: "silo", x: -72, z: -102 },
  { kind: "silo", x: -72, z: -114 },
  { kind: "cottage", x: -74, z: -88, rotY: Math.PI, params: { litWindows: true } },
  { kind: "shed", x: -104, z: -122 },
  { kind: "haystack", x: -84, z: -126 },
  { kind: "haystack", x: -98, z: -130 },
  { kind: "haystack", x: -106, z: -94 },
  { kind: "trough", x: -84, z: -118 },
  { kind: "cart", x: -94, z: -96, rotY: Math.PI / 2 },
  { kind: "woodpile", x: -108, z: -112 },
  { kind: "crates", x: -80, z: -98 },
  // The south paddock. Corners open, and the east run gapped at the yard.
  { kind: "fence", x: -90, z: -132, params: { length: 36 } },
  { kind: "fence", x: -108, z: -121, rotY: Math.PI / 2, params: { length: 22 } },
  { kind: "fence", x: -72, z: -126, rotY: Math.PI / 2, params: { length: 12 } },

  // ===== D — orchard hill ====================================================
  // Stone walls ring the top. Kept short and near the flattened crown — a
  // long wall on the blend ring floats at one end (a placement samples the
  // ground once, at its centre). Gate on the west run where the lane (R10)
  // climbs in; corners open.
  { kind: "cottage", x: 98, z: 108, params: { litWindows: true } },
  { kind: "shed", x: 122, z: 108, rotY: Math.PI / 2 },
  { kind: "watchtower", x: 124, z: 82 },
  { kind: "haystack", x: 98, z: 84 },
  { kind: "cart", x: 116, z: 102, rotY: Math.PI / 2 },
  { kind: "trough", x: 104, z: 98 },
  { kind: "stoneWall", x: 110, z: 116, params: { length: 32 } },
  { kind: "stoneWall", x: 108, z: 74, params: { length: 28 } },
  { kind: "stoneWall", x: 90, z: 104, rotY: Math.PI / 2, params: { length: 16 } },
  { kind: "stoneWall", x: 90, z: 78, rotY: Math.PI / 2, params: { length: 10 } },
  { kind: "stoneWall", x: 130, z: 96, rotY: Math.PI / 2, params: { length: 24 } },

  // ===== E — the kiln yard ===================================================
  { kind: "kiln", x: 78, z: -80 },
  { kind: "kiln", x: 78, z: -100 },
  { kind: "shed", x: 104, z: -80 },
  { kind: "shed", x: 108, z: -96, rotY: Math.PI / 2 },
  { kind: "shed", x: 96, z: -108, rotY: Math.PI },
  { kind: "woodpile", x: 84, z: -98 },
  { kind: "woodpile", x: 100, z: -72, rotY: Math.PI / 2 },
  { kind: "woodpile", x: 94, z: -114 },
  { kind: "crates", x: 98, z: -86 },
  { kind: "crates", x: 84, z: -68 },
  { kind: "cart", x: 70, z: -102 },
  { kind: "cart", x: 104, z: -104, rotY: Math.PI / 2, params: { ruined: true } },
  { kind: "ruin", x: 64, z: -74, params: { width: 9, depth: 7 } },
  // West boundary fence, gapped at the yard mouth.
  { kind: "fence", x: 60, z: -100, rotY: Math.PI / 2, params: { length: 12 } },
  { kind: "fence", x: 60, z: -78, rotY: Math.PI / 2, params: { length: 12 } },

  // ===== the hedged fields (the middle ground) ===============================
  // Stone walls are the one field boundary that stops a round, so each one is
  // placed to break a specific long lane at chest height; the fences shape
  // movement only, and the brambles (scatter) are dressing on both.
  { kind: "stoneWall", x: -24, z: -70, params: { length: 24 } },
  { kind: "stoneWall", x: 24, z: -78, params: { length: 20 } },
  { kind: "stoneWall", x: 44, z: -46, rotY: Math.PI / 2, params: { length: 22 } },
  { kind: "stoneWall", x: 50, z: 52, params: { length: 24 } },
  { kind: "stoneWall", x: -56, z: 58, params: { length: 24 } },
  { kind: "stoneWall", x: 120, z: 130, rotY: Math.PI / 2, params: { length: 24 } },
  { kind: "stoneWall", x: 120, z: -40, params: { length: 28 } },
  { kind: "fence", x: -30, z: -92, rotY: Math.PI / 2, params: { length: 18 } },
  { kind: "fence", x: 30, z: 22, params: { length: 18 } },
  { kind: "fence", x: -52, z: -18, params: { length: 20 } },
  { kind: "fence", x: 114, z: 4, rotY: Math.PI / 2, params: { length: 20 } },
  { kind: "fence", x: -120, z: 100, params: { length: 20 } },
  { kind: "shrine", x: 8, z: -46 },
  { kind: "shrine", x: -40, z: 32 },
  { kind: "haystack", x: -40, z: -60 },
  { kind: "haystack", x: 36, z: 58 },
  { kind: "haystack", x: -64, z: 96 },
  { kind: "haystack", x: 140, z: -136 },
  { kind: "haystack", x: -134, z: -66 },
  { kind: "ruin", x: 34, z: -34, params: { width: 9, depth: 7 } },
  { kind: "ruin", x: -52, z: 74, params: { width: 10, depth: 8 } },
  { kind: "ruin", x: 150, z: 52, params: { width: 8, depth: 7 } },
  { kind: "cart", x: -44, z: -84, rotY: Math.PI / 2 },
  { kind: "trough", x: 28, z: -74 },
  { kind: "cart", x: 128, z: 134 },

  // ===== home yards ==========================================================
  // Each gatehouse arches over the spawn road out; its pass through the rim
  // sits directly behind it.
  { kind: "gatehouse", x: -160, z: -168, params: { teamColor: HARVEST } },
  { kind: "cart", x: -150, z: -166 },
  { kind: "crates", x: -168, z: -158 },
  { kind: "woodpile", x: -152, z: -146 },
  { kind: "trough", x: -166, z: -148 },
  { kind: "gatehouse", x: 160, z: 168, rotY: Math.PI, params: { teamColor: DROVE } },
  { kind: "cart", x: 170, z: 158, rotY: Math.PI / 2 },
  { kind: "crates", x: 150, z: 166 },
  { kind: "woodpile", x: 166, z: 148 },
  { kind: "trough", x: 154, z: 146 },
];

/**
 * Dressing. Every region below has been checked against the road extents
 * listed at the top of `placements` — a road rejects nothing on its own.
 * Blocking props are held off every flag and spawn by `MapBuilder.keepClear`;
 * the clearances come from `PROP_BODIES`, not from these numbers.
 *
 * The vale has TWO trees and they divide the work. The pines are the planted
 * ones — shelterbelts, the home yards' backdrops and two real woods — and the
 * ash is the farm's own: hedgerow standards over the walls and fences, copses
 * in the open fields, a line along the stream and the deciduous fringe on both
 * woods. Between them their trunks are the only scatter cover that stops a
 * round above knee height. The ferns are the understory that goes under both,
 * non-blocking on purpose: ground the eye reads as a field boundary that a
 * body and a bullet both pass.
 *
 * The greening is appended in a block at the END of this array rather than
 * filed under the flag it dresses, and the comment above it says why — the
 * order of this array is load-bearing.
 */
const scatter: ScatterSpec[] = [
  // THE KNOLL WOOD (north-west) — the biggest stand on the map.
  { prop: "pine", x: -140, z: 132, width: 66, depth: 52, count: 55, scale: [0.9, 1.4], blocking: true, clearance: 1.2 },
  // The west wood, along the rim between the mill and the grange meadows.
  { prop: "pine", x: -182, z: -50, width: 26, depth: 90, count: 28, scale: [0.9, 1.4], blocking: true, clearance: 1.2 },
  // THE SOUTH-EAST WOOD — cover on the long E-to-D flank.
  { prop: "pine", x: 152, z: -44, width: 64, depth: 72, count: 45, scale: [0.9, 1.4], blocking: true, clearance: 1.2 },
  // Streamside alders and field copses.
  { prop: "pine", x: -40, z: 2, radius: 10, count: 5, scale: [0.85, 1.25], blocking: true, clearance: 1.2 },
  { prop: "pine", x: 40, z: 66, radius: 14, count: 8, scale: [0.85, 1.3], blocking: true, clearance: 1.2 },
  { prop: "pine", x: -70, z: -46, radius: 16, count: 9, scale: [0.85, 1.3], blocking: true, clearance: 1.2 },
  { prop: "pine", x: 0, z: -160, radius: 18, count: 9, scale: [0.9, 1.4], blocking: true, clearance: 1.2 },
  // Orchard Hill's shelterbelts (outside the walls) and the orchard itself.
  { prop: "pine", x: 110, z: 126, width: 44, depth: 12, count: 12, scale: [0.85, 1.2], blocking: true, clearance: 1.2 },
  { prop: "pine", x: 142, z: 96, width: 12, depth: 40, count: 11, scale: [0.85, 1.2], blocking: true, clearance: 1.2 },
  { prop: "pine", x: 102, z: 106, width: 16, depth: 12, count: 5, scale: [0.8, 1.1], blocking: true, clearance: 1.2 },
  // The home yards' backdrops.
  { prop: "pine", x: 130, z: 178, width: 52, depth: 30, count: 20, scale: [0.9, 1.4], blocking: true, clearance: 1.2 },
  { prop: "pine", x: -128, z: -180, width: 52, depth: 28, count: 18, scale: [0.9, 1.4], blocking: true, clearance: 1.2 },
  // THE HEDGEROWS — green understory lines along the walls and fences.
  // Non-blocking: they fill the field boundaries without adding a single
  // collider. Ferns rather than brambles on purpose — the bramble is the dead
  // valley's prop and reads as burnt scrub against summer pasture.
  { prop: "fernClump", x: -24, z: -66, width: 30, depth: 6, count: 10, scale: [0.9, 1.5] },
  { prop: "fernClump", x: 50, z: 48, width: 28, depth: 6, count: 9, scale: [0.9, 1.5] },
  { prop: "fernClump", x: -56, z: 62, width: 28, depth: 6, count: 9, scale: [0.9, 1.5] },
  { prop: "fernClump", x: 120, z: -36, width: 30, depth: 6, count: 10, scale: [0.9, 1.5] },
  { prop: "fernClump", x: -34, z: -92, width: 6, depth: 20, count: 7, scale: [0.9, 1.5] },
  { prop: "fernClump", x: -120, z: 96, width: 24, depth: 6, count: 8, scale: [0.9, 1.5] },
  { prop: "bramble", x: 60, z: -60, radius: 16, count: 8, scale: [0.9, 1.5] },
  { prop: "bramble", x: -84, z: -2, radius: 12, count: 7, scale: [0.9, 1.5] },
  // Ferns along the water — the lush edge a stream cuts through a pasture.
  { prop: "fernClump", x: -110, z: 60, radius: 7, count: 6, scale: [0.8, 1.4] },
  { prop: "fernClump", x: -136, z: 52, radius: 7, count: 6, scale: [0.8, 1.4] },
  { prop: "fernClump", x: -20, z: 24, width: 40, depth: 14, count: 12, scale: [0.8, 1.4] },
  { prop: "fernClump", x: 100, z: 32, width: 44, depth: 12, count: 10, scale: [0.8, 1.4] },
  // Boulders on the open downs, logs at the wood edges.
  { prop: "boulder", x: -150, z: 60, radius: 18, count: 5, scale: [0.8, 1.3], blocking: true, clearance: 1.0 },
  { prop: "boulder", x: 160, z: 60, radius: 20, count: 5, scale: [0.8, 1.3], blocking: true, clearance: 1.0 },
  { prop: "boulder", x: -40, z: -140, radius: 18, count: 5, scale: [0.8, 1.3], blocking: true, clearance: 1.0 },
  { prop: "log", x: -140, z: 110, radius: 14, count: 4, scale: [0.8, 1.2], blocking: true, clearance: 1.4 },
  { prop: "log", x: 150, z: -60, radius: 14, count: 4, scale: [0.8, 1.2], blocking: true, clearance: 1.4 },
  { prop: "log", x: 30, z: 90, radius: 14, count: 3, scale: [0.8, 1.2], blocking: true, clearance: 1.4 },
  // Yard spill.
  { prop: "barrel", x: 26, z: -18, radius: 6, count: 4, blocking: true, clearance: 0.55 },
  { prop: "barrel", x: 74, z: -84, radius: 6, count: 3, blocking: true, clearance: 0.55 },
  { prop: "barrel", x: -96, z: -104, radius: 6, count: 3, blocking: true, clearance: 0.55 },

  // ===== THE HEDGEROW ASH ====================================================
  // APPENDED rather than interleaved, and that is mechanical rather than
  // tidiness. `MapBuilder.scatterRegion` draws every region out of ONE seeded
  // stream in array order, so a region inserted higher up reshuffles every
  // field below it. Everything above this line therefore places exactly what
  // it placed before — the knoll wood, both big woods, every fern line — and
  // everything the greening adds is below it. Keep it that way: a new region
  // spliced in among the pines re-rolls two hundred trees that were walked and
  // judged, and nothing warns you.
  //
  // WHY A SECOND TREE. The vale shipped dressed in one conifer, and a valley
  // with one tree in it reads as forestry rather than farmland: a shelterbelt,
  // a copse and a field boundary are the same dark cone at every distance, so
  // the ground between them reads as empty however much of it there is. The
  // ash is the tree a farm actually has — a bole you can see under, a round
  // crown over it, 9.9 m of it against the pine's 7 — and what carries to the
  // far side of a 400 m map is that SILHOUETTE rather than the colour. It is also
  // what a hedge is FOR here: a stone wall stops a round at chest height, and
  // a line of standards over it is the same boundary saying so from 200 m.
  //
  // WHAT IT COSTS. A trunk is a collider box, so this takes the map from 534
  // boxes to 748: 214 trees standing of the 226 the counts below ask for, the
  // dozen missing refused by the ground they drew. That is under Hollowmere's
  // 824 on a square 2.8 times the area, and under half Greyfen's 1,717. They are hard cover (`PROP_BODIES.h` is 8.6,
  // well over CoverMap's 1.7 m line), which is the half of this that is not
  // dressing: a field boundary that was a wall and a fern is now a wall, a
  // fern and a row of trunks, and the bots will fight from it.

  // The stream, which crosses the whole map and had nothing standing on it.
  // Banks only: the belts are held off the WATER PLANE (-0.3) rather than off
  // the water rect, which is 100 m deep and mostly dry field.
  { prop: "ashTree", x: -48, z: 50, width: 40, depth: 8, count: 8, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: 30, z: 47, width: 40, depth: 8, count: 8, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: 120, z: 46, width: 60, depth: 12, count: 12, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: 30, z: 13, width: 50, depth: 8, count: 9, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: 112, z: 6, width: 46, depth: 10, count: 9, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: -50, z: 62, width: 30, depth: 14, count: 7, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  // The lanes. Set back from the carriageway by a couple of metres, so the
  // crowns overhang the road the way a lane's trees do and the trunks do not
  // stand in it — the road extents at the top of `placements` are the line.
  { prop: "ashTree", x: 92, z: 77, width: 28, depth: 7, count: 5, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: 80, z: -40, width: 10, depth: 50, count: 9, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: -14, z: 56, width: 16, depth: 20, count: 5, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },

  // THE FIELD BOUNDARIES — one line per wall and fence in the middle ground,
  // laid over the boundary it belongs to rather than near it. This is the
  // greening that changes the FIGHT rather than the picture: every one of
  // these is a line the layout already drew to break a sightline, and a row of
  // trunks is what makes it legible from the far end of the look it breaks.
  { prop: "ashTree", x: -26, z: -70, width: 26, depth: 7, count: 5, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: 26, z: -78, width: 26, depth: 7, count: 5, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: 44, z: -46, width: 7, depth: 28, count: 5, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: 50, z: 52, width: 30, depth: 7, count: 6, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: -56, z: 58, width: 30, depth: 7, count: 6, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: 120, z: -40, width: 34, depth: 7, count: 6, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: 120, z: 130, width: 7, depth: 30, count: 6, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: -52, z: -18, width: 26, depth: 7, count: 5, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: 30, z: 19, width: 24, depth: 6, count: 4, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: 114, z: 4, width: 7, depth: 26, count: 5, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: -120, z: 100, width: 26, depth: 7, count: 5, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: -34, z: -92, width: 7, depth: 24, count: 4, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },

  // FIELD COPSES — the open ground between the flags, which is where the vale
  // read emptiest and where a clump of three or four trees is what a real
  // field has: something to walk to, something to lose a body behind.
  { prop: "ashTree", x: -30, z: 88, radius: 12, count: 7, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: 46, z: 96, radius: 12, count: 7, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: -110, z: -30, radius: 14, count: 8, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: 34, z: -112, radius: 12, count: 6, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: 150, z: -8, radius: 14, count: 8, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: -60, z: -74, radius: 12, count: 6, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: 112, z: -112, radius: 12, count: 6, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: 130, z: 150, radius: 14, count: 7, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: -132, z: -152, radius: 14, count: 7, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  // The two the town has, and the only regions on the map allowed the top of
  // the scale range: a green's tree is the biggest thing growing in a village
  // and is meant to be read as one tree rather than as a stand. `keepClear`
  // holds them out of flag C's ring on its own — that is what it is for.
  { prop: "ashTree", x: -38, z: 6, radius: 6, count: 3, scale: [1.0, 1.3], blocking: true, clearance: 2.4 },
  { prop: "ashTree", x: 42, z: -30, radius: 8, count: 3, scale: [1.0, 1.3], blocking: true, clearance: 2.4 },
  // The two big woods' deciduous fringe. A conifer stand with broadleaf along
  // its edge is what a planted wood in farm country looks like, and it is also
  // the cheapest way to stop 100 trees reading as one flat dark wall.
  { prop: "ashTree", x: -140, z: 104, width: 60, depth: 12, count: 12, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },
  { prop: "ashTree", x: 122, z: -44, width: 14, depth: 60, count: 12, scale: [0.8, 1.15], blocking: true, clearance: 2.0 },

  // The understory that goes with all of it — non-blocking, so it costs the
  // ray budget nothing at all (no collider, no `WorldBox`, invisible to every
  // pick in the game). A hedgerow is a line of scrub with trees standing in
  // it, and the six boundaries above that had no fern line are the ones here;
  // the copses get a floor for the same reason.
  { prop: "fernClump", x: 44, z: -46, width: 6, depth: 26, count: 8, scale: [0.9, 1.5] },
  { prop: "fernClump", x: 26, z: -78, width: 24, depth: 6, count: 8, scale: [0.9, 1.5] },
  { prop: "fernClump", x: -52, z: -18, width: 24, depth: 6, count: 8, scale: [0.9, 1.5] },
  { prop: "fernClump", x: 114, z: 4, width: 6, depth: 24, count: 8, scale: [0.9, 1.5] },
  { prop: "fernClump", x: 120, z: 130, width: 6, depth: 28, count: 8, scale: [0.9, 1.5] },
  { prop: "fernClump", x: -110, z: -30, radius: 12, count: 9, scale: [0.9, 1.5] },
  { prop: "fernClump", x: 150, z: -8, radius: 12, count: 9, scale: [0.9, 1.5] },
  { prop: "fernClump", x: -60, z: -74, radius: 10, count: 8, scale: [0.9, 1.5] },
  { prop: "fernClump", x: -30, z: 88, radius: 10, count: 8, scale: [0.9, 1.5] },
  { prop: "fernClump", x: 46, z: 96, radius: 10, count: 8, scale: [0.9, 1.5] },
  { prop: "fernClump", x: 30, z: 47, width: 40, depth: 10, count: 10, scale: [0.8, 1.4] },
  { prop: "fernClump", x: 30, z: 13, width: 50, depth: 10, count: 10, scale: [0.8, 1.4] },
  { prop: "fernClump", x: 120, z: 46, width: 56, depth: 12, count: 10, scale: [0.8, 1.4] },
];

const controlPoints: ControlPointDef[] = [
  { id: "A", name: "The Mill", pos: new Vector3(-98, 0, 40), radius: 13 },
  { id: "B", name: "The Grange", pos: new Vector3(-88, 0.8, -110), radius: 14 },
  { id: "C", name: "The Market Green", pos: new Vector3(0, 0, -6), radius: 15 },
  // On the flattened crown; `pos.y` is what the flag marker and the deploy
  // map draw at, and a beacon at 0 would grow out of the hillside.
  { id: "D", name: "Orchard Hill", pos: new Vector3(110, 8, 95), radius: 13 },
  { id: "E", name: "The Kiln Yard", pos: new Vector3(90, 1, -90), radius: 13 },
];

/**
 * Home spawns are uncapturable. Every control point also carries a spawn just
 * outside its capture zone, so deploying onto a flag you hold does not drop
 * you on top of whoever is contesting it. The home yards face each other down
 * the NE-SW diagonal — the bearing the sun was set perpendicular to.
 */
const spawns: SpawnPointDef[] = [
  { team: 0, pos: new Vector3(-166, 2.2, -154), yaw: Math.PI / 4 },
  { team: 0, pos: new Vector3(-159, 2.2, -150), yaw: Math.PI / 4 },
  { team: 0, pos: new Vector3(-152, 2.2, -157), yaw: Math.PI / 4 },
  { team: 1, pos: new Vector3(154, 2, 154), yaw: -Math.PI * 0.75 },
  { team: 1, pos: new Vector3(161, 2, 150), yaw: -Math.PI * 0.75 },
  { team: 1, pos: new Vector3(167, 2, 156), yaw: -Math.PI * 0.75 },
  { team: null, controlPoint: "A", pos: new Vector3(-82, 0, 40), yaw: -Math.PI / 2 },
  { team: null, controlPoint: "B", pos: new Vector3(-92, 0.8, -126), yaw: 0 },
  { team: null, controlPoint: "C", pos: new Vector3(-2, 0, -26), yaw: 0 },
  { team: null, controlPoint: "D", pos: new Vector3(110, 8, 78), yaw: 0 },
  { team: null, controlPoint: "E", pos: new Vector3(92, 1, -70), yaw: Math.PI },
];

/**
 * One hardstanding a side, standing in the home yard behind the gatehouse.
 * The second map to field armour, and the vale is what earns it: the header
 * above says these hills were laid out at a scale "a future vehicle can mean
 * something on", and a 400 m map whose flags are 150 m apart across open
 * pasture is one where crossing the ground is the problem armour exists to
 * answer. Coldharbour's tank is a thing that owns a street; this one is a
 * thing that owns a field.
 *
 * Each stands on the INNER edge of its yard's flat pad — the SW yard is level
 * at 2.2 over x -172..-140, z -172..-140 and the NE at 2.0 over x 140..172,
 * z 140..172, which is where the whole yard was flattened for the spawns — so
 * a hull arrives level and its ten track contacts all read the same plane.
 * Eight metres off the nearest infantry spawn, which is Coldharbour's spacing
 * and for its reason: a hull landing on the respawn timer must not be sitting
 * where somebody just deployed.
 *
 * **The heading is the yard's own**, the same NE-SW diagonal the three spawns
 * beside it face, so the first thing a driver does is drive at the map rather
 * than turn around in it. There is no avenue to roll onto here — that was the
 * city's answer — so what matters instead is the GROUND ahead, and both
 * bearings were walked: south-west's climbs the knoll at (-140,-132) at a
 * 0.28 gradient and crests it 25 m out with the vale laid open below;
 * north-east's runs up the orchard hill's north shoulder at 0.24, well inside
 * what `climbHeight` accepts a surface from. Neither is a wall, and neither
 * needs a road to not be one.
 *
 * Both spots are held clear of every blocking scatter region on the map by
 * more than `keepClear`'s radius (hull half-length plus a body's standing
 * room, 5.1 m), which is deliberate rather than lucky: a hardstanding whose
 * circle clipped the ash copse at (-132,-152) or the pine wood at (130,178)
 * would reject candidates out of a stream every field below it draws from,
 * and re-roll half the dressing on the map. Adding these two entries changes
 * the layout HASH and nothing else, so `npm run collision` is owed and
 * `npm run parity` still passes.
 *
 * **Two, and exactly two.** The respawn is per hardstanding, so the number of
 * entries here IS how many tanks a side can ever have on the field at once —
 * and it is also what turns the kit's third slot on (`Game.armourOffered`),
 * so this is the map's second launcher-and-mine map as well as its second
 * armour one.
 */
const vehicles: VehicleSpawnDef[] = [
  { team: 0, pos: new Vector3(-160, 2.2, -142), yaw: Math.PI / 4 },
  { team: 1, pos: new Vector3(160, 2, 142), yaw: -Math.PI * 0.75 },
];

/**
 * The stream is carved in `heights.ts` to a constant -0.95 bed (-1.25 in the
 * millpond), so this single rect at -0.3 is wet along the whole run and dry
 * everywhere the ground stands above it — Greyfen's construction. Banks grade
 * at ~0.25, well inside the 0.4 the nav graph severs at, so the entire stream
 * is wadeable: the two fords are landmarks and lines a vehicle can take, not
 * the only ways across.
 */
const water: WaterRect[] = [
  { x: 0, z: 57, width: 404, depth: 100, y: -0.3 },
];

/**
 * Summer pasture — the lushest fields in the game, and a budget rather than a
 * blanket. The field is one mesh of thin instances with no culling inside it,
 * so the cost is the tuft COUNT wherever the camera stands, and the number is
 * the thing to hold in mind when adding a rect: these sum to ~23,000 tufts
 * (density x area), against ~13,400 when the map shipped and Greyfen's 16,900,
 * which is the largest field in the game. What it buys at the far end is
 * 5 blades a tuft and 3 triangles a blade — ~350,000 triangles in ONE draw
 * call, vertex-shaded, on a map that spends nothing on dynamic light because
 * it has no lamps. That is the whole of the cost and it is why the raise was
 * affordable; it is not licence for the next one.
 *
 * **The raise is COVERAGE and not density**, and the distinction is what the
 * vale needed. Every rect below is somewhere between 0.4 and 1.15, near where
 * it always was — what changed is that the ground BETWEEN the flags has rects
 * at all. A 400 m map dressed only where the buildings are reads as a green
 * table with farms on it, and the fix for that is grass in the middle of the
 * fields rather than thicker grass around the edges of them.
 *
 * Rects dodge the roads by hand (extents listed above `placements`);
 * structures and props are cleared automatically by the GrassSystem's
 * collider rejection. Rects over the stream are reed beds and deliberately
 * thin — at field density a wet rect is a lawn growing underwater.
 */
const grass: GrassRect[] = [
  // The market green's four quarters, mown closest, walked barest — and the
  // only rects on the map raised rather than added, because the green is the
  // ground a round is actually fought over and a tuft is worth most there.
  { x: 24, z: 20, width: 32, depth: 24, density: 1.15 },
  { x: -24, z: 20, width: 32, depth: 24, density: 1.15 },
  { x: 26, z: -22, width: 28, depth: 20, density: 0.95 },
  { x: -26, z: -22, width: 28, depth: 20, density: 0.95 },
  // The mill's water meadows, either side of the pond.
  { x: -90, z: 78, width: 56, depth: 36, density: 0.7 },
  { x: -70, z: 20, width: 40, depth: 24, density: 0.6 },
  // The grange: hay meadow west, paddock south.
  { x: -135, z: -85, width: 50, depth: 46, density: 0.6 },
  { x: -90, z: -140, width: 44, depth: 24, density: 0.7 },
  // The hedged fields between C, E and B.
  { x: 28, z: -60, width: 40, depth: 28, density: 0.6 },
  { x: 94, z: -66, width: 40, depth: 20, density: 0.6 },
  // Orchard Hill: the crown either side of the lane, and the west slope.
  { x: 110, z: 104, width: 36, depth: 20, density: 0.9 },
  { x: 110, z: 76, width: 36, depth: 10, density: 1.0 },
  { x: 76, z: 106, width: 24, depth: 28, density: 0.7 },
  // The south meadow, the map's widest open ground.
  { x: 30, z: -140, width: 64, depth: 40, density: 0.55 },
  // The approaches to the two home yards.
  { x: -130, z: -140, width: 40, depth: 32, density: 0.5 },
  { x: 140, z: 124, width: 44, depth: 36, density: 0.55 },
  // The knoll's clearing.
  { x: -120, z: 108, width: 36, depth: 24, density: 0.6 },
  // Reed beds along the stream — thin on purpose (see above).
  { x: 24, z: 26, width: 32, depth: 14, density: 0.5 },
  { x: 54, z: 30, width: 20, depth: 12, density: 0.5 },
  { x: 105, z: 28, width: 40, depth: 14, density: 0.5 },
  { x: -112, z: 54, width: 16, depth: 16, density: 0.6 },

  // ===== the middle ground ===================================================
  // The fields BETWEEN the flags, which had no grass at all and are most of
  // what a player crosses. Thinner than the yards and the green (0.4-0.55
  // against 0.7-1.15) on purpose: this is grazed pasture seen mostly at fifty
  // metres and up, where what reads is whether the ground has anything growing
  // on it rather than how much.
  { x: -34, z: 70, width: 56, depth: 30, density: 0.55 },
  { x: 34, z: 70, width: 56, depth: 30, density: 0.55 },
  { x: 110, z: -20, width: 60, depth: 40, density: 0.45 },
  { x: -120, z: -20, width: 60, depth: 50, density: 0.45 },
  { x: 40, z: -30, width: 50, depth: 30, density: 0.5 },
  { x: 120, z: 60, width: 50, depth: 40, density: 0.45 },
  { x: -60, z: -80, width: 50, depth: 40, density: 0.45 },
  { x: 110, z: -110, width: 40, depth: 30, density: 0.5 },
  // The north basin — the vale's own floodplain, a metre under the fields
  // around it and dry (the water rect stops at z 107). Thinnest on the map:
  // it is 3,500 m2 of nothing else, and at 0.4 it is still 1,400 tufts.
  { x: -40, z: 130, width: 70, depth: 50, density: 0.4 },
  // The stream's north bank, under the new ash line — the wet edge is the one
  // place in a dry pasture that genuinely grows, so these two are thicker than
  // the fields they sit in and stop short of the water.
  { x: -36, z: 52, width: 40, depth: 12, density: 0.7 },
  { x: 34, z: 50, width: 40, depth: 12, density: 0.7 },
];

export const HarrowmeadLayout: MapLayout = {
  placements,
  scatter,
  controlPoints,
  spawns,
  vehicles,
  water,
  grass,
  terrain: HarrowmeadHeights,
  /**
   * The largest map yet. `terrain.size * terrain.cell` equals it (100 x 4),
   * the rim's boundary boxes stay over 200 m (they are size + 4), and the
   * heightfield grew with the square rather than getting coarser — the three
   * things `MapLayout.size` says a larger map owes.
   */
  size: 400,
  // `surfaces` stays at the default 3: a farm stacks like a village (stream
  // bed, bank, hayloft), not like an office block.
  /**
   * **No wall.** The vale is not closed by anything you can walk up to: the
   * fields carry on for eighty metres past the play square and what stops you
   * is the leash, a countdown rather than a face of rock. See `Borderland`, and
   * `world/leash.ts` for the rule.
   *
   * 80 m is set by the leash and not by taste. `CONFIG.map.leash.seconds` is
   * ten and a sprint is 6.9 m/s, so a player who turns and runs the instant the
   * warning starts dies 69 m out — inside this, with eleven metres of slack, so
   * the four boundary colliders at ±280 are a bound the simulation can state
   * rather than anything a living player can find. Shorten it and they find it,
   * which is an invisible wall in an open field: the one outcome worse than the
   * escarpment this replaced.
   *
   * The roll is a little under the default, because this vale is a floodplain
   * either side of a stream rather than hill country, and the country outside
   * it should read as more of the same fields rather than as the downs starting
   * early.
   *
   * **It is deliberately BARE, and that is the one part of it that is a
   * decision rather than a consequence.** Every scatter region, grass rect and
   * hedge line in this file stops at the play square, so the borderland is open
   * pasture and nothing else — no copses, no walls, nothing to fight from and
   * nothing to catch a player running back in. What that buys is a cue the HUD
   * cannot give: the map's dressing thinning out is the first thing you notice
   * about leaving it, a beat before the countdown starts shouting. Anything
   * added out here would also be a collider outside the nav grid, which is
   * geometry the bots can neither see nor route around.
   */
  borderland: { margin: 80, roll: 2.2 },
  /**
   * The downs around the vale — `form: "downs"`, which is the whole point of
   * the fourth map's boundary and the reason the form exists at all.
   *
   * It shipped as the standard escarpment, gentled to 0.16, and gentling was
   * never going to be enough: an escarpment's basal band is a vertical face at
   * the player's feet and its profile puts a 32 m crest 15 m behind that, so
   * what stood around a green farming vale was a flat-topped grey mesa with two
   * notches cut in it. The problem was the LANDFORM and not the number.
   *
   * What is here now is a hillside. It stands at ±280 rather than ±200 — the
   * borderland above is between — and it rises 58 to 88 m over 150 m of run,
   * which is 21 to 30 degrees: a chalk down you could walk up, seen across a
   * quarter mile of fields. The crest subtends 7.7 to 11.7 degrees from the centre of
   * the map, and the low end of that is what sets the pair: `slope` and
   * `slopeVariance` are chosen so the wander never reaches `MIN_SLOPE`, because
   * the clamp does not soften a dip, it FLATTENS one — a stretch of skyline
   * pinned to exactly the sky's own floor, which reads as a straight edge in
   * among the swells. 30 m of crest between the highest and the lowest is what
   * keeps this from being the mesa again in a different colour.
   *
   * The four passes move out with the ring, and they are the same four things
   * leaving the vale: the stream in from the north-west and out to the east,
   * and each home yard's road climbing out to its own corner. Wider than they
   * were, because a col has twice as much hill to notch.
   */
  ridge: {
    form: "downs",
    slope: 0.17,
    slopeVariance: 0.035,
    passes: [
      { x: -280, z: 95, width: 40 },
      { x: 280, z: 24, width: 40 },
      { x: 160, z: 280, width: 32 },
      { x: -160, z: -280, width: 32 },
    ],
    seed: 0x4d454144,
  },
  // Fixed so the dressing — and the colliders blocking scatter emits, and so
  // the nav graph — is identical on every boot. Changing it rerolls the whole
  // scatter field, which is a visible change to the level: re-walk the flags.
  seed: 0x48415257,
};
