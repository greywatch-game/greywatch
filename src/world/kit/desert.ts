/**
 * kit/desert.ts — The desert-town builders: the flat-roofed courtyard house,
 * the compound wall, the shelled apartment block, the mosque and its minaret,
 * the souk arcade, and the two pieces of hard furniture a contested town grows
 * — the T-wall run and the sandbag emplacement.
 * All follow the contract in kit/core.ts (origin-local geometry, no
 * solid/pickable/collisions metadata, colliders declared not created) and the
 * four rules in kit/city.ts's header about buildings that stack walked floors.
 *
 * ## Why a file rather than parameters on the village kit
 *
 * The kit had three vernaculars in it — a wet northern village, a jungle and a
 * downtown — and a fifth map wanted a fourth. Every one of the existing
 * builders is a shape as much as a palette: a `cottage` is a pitched roof over
 * a rectangle and a `townhouse` is two of them, and no colour makes either read
 * as a courtyard house on a hot plain. What actually distinguishes this
 * vernacular is the ROOF: it is flat, it is WALKED, and it is where half the
 * town lives. Nothing else in the kit has a walked roof at all.
 *
 * So the file exists for one geometric reason and the rest follows from it. A
 * flat roof is a second storey of ground; a parapet is the cover on it; a stair
 * is what makes it reachable; and a town of them is a second surface over the
 * whole map that a fight moves through vertically as well as along.
 *
 * ## THE STAIR LANE, which is the one thing to understand before editing
 *
 * `kit/city.ts` derives it and this file uses it unchanged: a flight is
 * `rise / MAX_WALKABLE_GRADE` long, the slab it climbs to may not cover it, and
 * cutting a void around each flight is worse than leaving a LANE out of the
 * slab. So every building here that is climbed has a lane down its +X edge, the
 * full depth of the footprint and `LANE` wide; the slab above stops short of
 * it; and the flight and its landing live in it.
 *
 * **The lane is why these buildings are DEEP.** A flight is `rise / GRADE` —
 * 10.0 m for a mud-brick storey and 10.9 for a concrete one — and the landing
 * at its head is another `LANDING`. `assertClimbable` throws in a DEV build
 * rather than letting a layout ask for a house too short to get onto its own
 * roof: the failure otherwise is a flight the nav graph declines to link, which
 * reads as bots ignoring a roof rather than as a geometry error.
 *
 * **A single lane is enough for two storeys**, which the office's alternating
 * pair is not needed for here: consecutive flights run in OPPOSITE directions
 * inside the same lane, and the lane has no slab over it at any level, so the
 * whole of it is one open shaft from the ground to the sky. That is what a
 * courtyard house's stair well is, and it costs one rectangle of roof.
 *
 * ## The collider order, which is the design and not the tidying
 *
 * `NavGrid` keeps `MapLayout.surfaces` surfaces per cell and DROPS the overflow
 * in arrival order, so every builder here emits in this order and must go on
 * doing so: **plinth, flights and landings, floor slabs, walls, roof,
 * parapet.** The roof is a walked surface and comes before the parapet standing
 * on it; the parapet is cover and comes last. A ruin's roof is the one
 * exception and it is the rule restated — it is unreachable, so it is emitted
 * after everything a body can stand on.
 *
 * ## The palette
 *
 * Nine colours, and the count is the point. A map's albedo palette is 128
 * entries shared with every other builder it uses, and a vernacular that reads
 * needs a small number of tones differing in VALUE rather than a large number
 * differing in hue: mud brick, its own shade, its limewashed variant, a roof, a
 * beam, a window with nothing behind it, poured concrete's two greys borrowed
 * from `kit/core.ts`, sandbag hessian, scorch — and one saturated accent, the
 * dome, which is the only chroma on the map and the thing you navigate by from
 * four hundred metres.
 */
import { Scene } from "@babylonjs/core";
import { CONFIG } from "../../config";
import type { CelMaterialFactory } from "../../shaders/CelShader";
import {
  ALLOY,
  Build,
  CONCRETE,
  DARK_CONCRETE,
  IRON,
  TEAK,
  TIMBER,
  type BuildParams,
  type Structure,
} from "./core";

// --- the palette -------------------------------------------------------------

/** Sun-baked mud brick: the wall of nine buildings in ten. */
export const MUDBRICK = "#8d7757";
/** The same wall in its own shade — the plinth, the coping, every reveal. */
export const MUDBRICK_DARK = "#6d5b41";
/** Limewash over brick: the mosque, and the odd house on a corner. */
export const WHITEWASH = "#b6a98f";
/** A roof: mud over palm beams, greyer and flatter than the wall under it. */
export const ROOF_MUD = "#7b6a51";
/**
 * A window with nothing behind it.
 *
 * Drawn as a box standing two centimetres PROUD of the wall rather than as an
 * opening cut in it, and that is a budget decision rather than a shortcut: a
 * real opening is four boxes and a collider each, where this is one visual, and
 * a town has some thousands of windows in it. The openings that are REAL — the
 * ones a round goes through — are the doorways and the shelled blocks' window
 * bands, and both are where a fight actually reaches.
 */
export const WINDOW_VOID = "#2b2620";
/** Split and bleached palm log: lintels, joists, stair treads, shutters. */
export const PALM_BEAM = "#6a583d";
/** Hessian, and the sand piled against anything that has stood a while. */
export const SANDBAG = "#8a7d5e";
/** Scorch: the wall beside a window that burned, a shelled block's stains. */
export const SCORCH = "#3d3730";
/**
 * The dome's glazed tile, and the one saturated colour in the town.
 *
 * It is the map's landmark by construction: the environment lays a bleached
 * warm haze over everything out to `fogEnd`, and a cool chroma is the only
 * thing that survives it. Nothing else in this file is allowed any.
 */
export const TILE_BLUE = "#2f6f83";

// --- the shared geometry -----------------------------------------------------

/** Wall thickness. Mud brick is thick, and 0.45 m is what reads as thick. */
const T = 0.45;
/** The plinth every building stands on. Under `stepHeight`, so it merges. */
const PLINTH = 0.25;
/**
 * A walked slab's thickness, and `kit/city.ts`'s third rule: below about this,
 * the outline shell wins the depth test at the grazing angle a floor is seen
 * from and paints the whole storey in its own ink.
 */
const SLAB = 0.5;
/** Storey height for mud brick — low, which is what a hot climate builds. */
const STOREY = 2.9;
/** Storey height for a reinforced-concrete frame. */
const STOREY_RC = 3.2;
/** The stair lane's width. See the header. */
const LANE = 2.0;
/** The least floor between a flight's top tread and the wall it climbs to. */
const LANDING = 1.8;
/** Parapet height and thickness: chest cover on every roof in the town. */
const PARAPET = 0.95;
const PARAPET_T = 0.4;
/**
 * The grade every flight here is built to, against `MAX_WALKABLE_GRADE`'s 0.4.
 *
 * The margin is not politeness. A flight's collider is a pitched slab and the
 * nav graph links its cells by comparing heights SAMPLED a cell apart, so a run
 * built exactly at the limit fails on rounding wherever a sample lands near a
 * cell boundary — and it fails silently, as a storey the bots never enter.
 */
const GRADE = 0.34;

/**
 * Where each walked level of a building sits, given how many storeys it has.
 *
 * Level 0 is the ground — the plinth's top, which is what a body stands on
 * inside — and level `k` is the top face of the k-th slab. The roof is level
 * `floors`, so a single-storey house has two walked surfaces and a two-storey
 * house three.
 */
function levels(floors: number, storey: number): number[] {
  const out = [PLINTH];
  for (let k = 1; k <= floors; k++) out.push(PLINTH + k * (storey + SLAB));
  return out;
}

/**
 * The lane and the plate it is cut out of, for a footprint `w` wide.
 *
 * One function so that the flight, the slab, the roof and the parapet cannot
 * disagree about where the shaft is — the lane is measured from the INSIDE face
 * of the +X wall, so a slab that stopped at `w / 2 - LANE` would overlap it by
 * a wall thickness and put a floor across the top of the stair.
 */
function laneGeom(w: number): { laneX: number; plateW: number; plateX: number } {
  return {
    laneX: w / 2 - T - LANE / 2,
    plateW: w - T - LANE,
    plateX: -(T + LANE) / 2,
  };
}

/**
 * Refuses, in a DEV build, a footprint too short for the flight it must hold.
 *
 * The alternative is not a visible error: a flight steeper than
 * `MAX_WALKABLE_GRADE` still draws, still collides and can still be walked up
 * by a player, and the only thing that changes is that `NavGrid.link` declines
 * to join its cells — so the storey is drawn, reachable, and empty of bots
 * forever. That is the failure this throw exists to make loud.
 */
function assertClimbable(kind: string, depth: number, rise: number): void {
  if (!import.meta.env.DEV) return;
  const run = depth - 2 * T - LANDING;
  if (run <= 0 || rise / run > GRADE + 1e-6) {
    throw new Error(
      `${kind}: depth ${depth} leaves ${run.toFixed(1)} m of run for a ` +
        `${rise.toFixed(2)} m rise — grade ${(rise / run).toFixed(3)} against ` +
        `${GRADE}. Deepen the footprint or drop a storey; see kit/desert.ts.`,
    );
  }
}

/**
 * One flight and its landing, in the +X lane of a footprint `w` x `d`.
 *
 * `dir` is which way the flight climbs, and consecutive levels alternate it, so
 * the two flights of a two-storey house pass each other in the same shaft
 * rather than one landing on top of the other.
 */
function laneFlight(
  b: Build,
  w: number,
  d: number,
  fromY: number,
  toY: number,
  dir: 1 | -1,
  color: string,
): void {
  const { laneX } = laneGeom(w);
  const hd = d / 2 - T;
  const rise = toY - fromY;
  const run = rise / GRADE;
  const topZ = dir * (hd - LANDING);
  b.flight({
    x: laneX,
    w: LANE - 0.3,
    topZ,
    topY: toY,
    run,
    rise,
    dir,
    steps: Math.max(6, Math.round(rise / 0.19)),
    color,
  });
  // The landing at the head, filling the lane from the top tread to the wall.
  // Part of the walked group and not an afterthought: a flight arriving level
  // with a slab it does not reach ends over nothing at all.
  const landZ = dir * (hd - LANDING / 2);
  b.box(LANE, SLAB, LANDING, laneX, toY - SLAB / 2, landZ, color);
  b.block({ w: LANE, h: SLAB, d: LANDING, x: laneX, y: toY - SLAB / 2, z: landZ });
}

/**
 * A parapet around a whole roof, standing on the WALLS rather than on the deck.
 *
 * Its outer face is flush with the building's, so the walked deck is the roof
 * minus the wall thickness it was already minus — a parapet costs no nav cell.
 * That is `Build.guard`'s argument arrived at from the other side: it stands a
 * rail outboard of the surface for exactly this reason, and here the wall below
 * is already outboard.
 */
function parapet(
  b: Build,
  w: number,
  d: number,
  y: number,
  color: string,
  cap: string,
): void {
  for (const sz of [-1, 1] as const) {
    const z = (sz * (d - PARAPET_T)) / 2;
    b.wall(w, PARAPET, PARAPET_T, 0, y + PARAPET / 2, z, color);
    b.box(w + 0.16, 0.14, PARAPET_T + 0.16, 0, y + PARAPET + 0.07, z, cap);
  }
  const runD = d - 2 * PARAPET_T;
  for (const sx of [-1, 1] as const) {
    const x = (sx * (w - PARAPET_T)) / 2;
    b.wall(PARAPET_T, PARAPET, runD, x, y + PARAPET / 2, 0, color);
    b.box(PARAPET_T + 0.16, 0.14, runD, x, y + PARAPET + 0.07, 0, cap);
  }
}

/**
 * The three-sided parapet a roof with an open stair shaft gets: everything but
 * the +X edge, which is the shaft and is deliberately left open — a stair well
 * with a wall across the top of it is a stair to nowhere.
 *
 * Split out of `parapet` rather than parameterised because the two differ in
 * their WIDTH as well as in their runs: a lane roof is `plateW` across and its
 * +X parapet would sit on the slab's own edge rather than on a wall, which is
 * the one place the "it costs no nav cell" argument above does not hold.
 */
function parapetOpenX(
  b: Build,
  plateW: number,
  d: number,
  cx: number,
  y: number,
  color: string,
  cap: string,
): void {
  for (const sz of [-1, 1] as const) {
    const z = (sz * (d - PARAPET_T)) / 2;
    b.wall(plateW, PARAPET, PARAPET_T, cx, y + PARAPET / 2, z, color);
    b.box(plateW + 0.16, 0.14, PARAPET_T + 0.16, cx, y + PARAPET + 0.07, z, cap);
  }
  const runD = d - 2 * PARAPET_T;
  const x = cx - (plateW - PARAPET_T) / 2;
  b.wall(PARAPET_T, PARAPET, runD, x, y + PARAPET / 2, 0, color);
  b.box(PARAPET_T + 0.16, 0.14, runD, x, y + PARAPET + 0.07, 0, cap);
}

/**
 * A row of punched windows drawn on one wall face. See `WINDOW_VOID` for why
 * these are proud boxes rather than openings.
 *
 * `alongZ` says which face: false is a ±Z elevation with the row running along
 * X, true is a ±X elevation with it running along Z. `face` is the coordinate
 * of the elevation on the other axis.
 */
function windowRow(
  b: Build,
  span: number,
  y: number,
  face: number,
  alongZ: boolean,
  count: number,
): void {
  for (let i = 0; i < count; i++) {
    const c = -span / 2 + ((i + 0.5) / count) * span;
    const x = alongZ ? face : c;
    const z = alongZ ? c : face;
    // The reveal first — a shallow frame in the wall's own shade, which is what
    // makes an opening read as a hole rather than as a dark sticker.
    b.box(alongZ ? 0.1 : 1.18, 1.34, alongZ ? 1.18 : 0.1, x, y, z, MUDBRICK_DARK);
    b.box(alongZ ? 0.14 : 0.94, 1.1, alongZ ? 0.94 : 0.14, x, y, z, WINDOW_VOID);
  }
}

// --- the buildings -----------------------------------------------------------

/**
 * The courtyard house: mud-brick walls, a flat WALKED roof with a parapet, and
 * a stair in its own lane. The workhorse of the town, and the reason this file
 * exists.
 *
 * ## What it is FOR
 *
 * A second storey of ground. A terrace of these is a roofscape a squad moves
 * along, a parapet is chest cover the whole way, and the alley below is a
 * different fight three metres down. Nothing else in the kit gives a map that,
 * and it is what a town of these is worth over a town of `cottage`.
 *
 * ## Parameters, and which of them a layout has to think about
 *
 * - `width` / `depth` — the footprint. **`depth` is the one that can be wrong**:
 *   a house with `rampSide` needs `LANDING` plus a flight's run inside its own
 *   walls, which is 12.7 m at one storey and no less at two (the flights are
 *   the same rise). `assertClimbable` throws below it in a DEV build, so the
 *   town's stair houses are all 13 m and deeper.
 * - `floors` — 1 or 2. Two puts a second flight in the same lane running the
 *   other way; see the header.
 * - `rampSide` — which Z end the lowest flight's FOOT is at, and its presence
 *   is what gives the house roof access at all. A house without one still has
 *   its roof drawn and still stops a round on it; what it does not have is a
 *   walked surface anything can reach.
 * - `enterable` — a doorway punched in the -Z wall, and the ground floor left
 *   hollow. The roof slab IS the ceiling, so an enterable house is one room
 *   with `STOREY` of headroom.
 * - `ruined` — the +X wall down to a stub, the roof broken back to a little
 *   over half, and the rubble that came out of both. A ruin never gets a stair:
 *   its roof is a shelf, not a floor.
 * - `tint` — a limewashed house among the brick ones. Nothing else reads it.
 */
export function buildAdobeHouse(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "adobe");
  const w = p.width ?? 10;
  const d = p.depth ?? 9;
  const floors = Math.max(1, Math.min(2, p.floors ?? 1));
  const ruined = p.ruined === true;
  const climbs = p.rampSide !== undefined && !ruined;
  const ys = levels(floors, STOREY);
  const roofY = ys[floors];
  const wallTop = roofY - SLAB;
  const skin = p.tint ?? MUDBRICK;
  const { plateW, plateX } = laneGeom(w);

  if (climbs) assertClimbable("adobeHouse", d, ys[1] - ys[0]);

  // 1 — the plinth. Under `stepHeight`, so it merges with the ground in the nav
  // grid rather than spending a slot, and a body steps onto it.
  b.box(w + 0.5, PLINTH, d + 0.5, 0, PLINTH / 2, 0, MUDBRICK_DARK);
  b.block({ w: w + 0.5, h: PLINTH, d: d + 0.5, x: 0, y: PLINTH / 2, z: 0 });

  // 2 — the flights, and 3 — the intermediate slabs. Both before the walls and
  // before the roof: see the header's collider order.
  const roofW = climbs ? plateW : w;
  const roofX = climbs ? plateX : 0;
  if (climbs) {
    const dir0: 1 | -1 = (p.rampSide ?? -1) === 1 ? 1 : -1;
    for (let k = 1; k <= floors; k++) {
      const dir: 1 | -1 = k % 2 === 1 ? dir0 : ((-dir0) as 1 | -1);
      laneFlight(b, w, d, ys[k - 1], ys[k], dir, PALM_BEAM);
    }
  }
  for (let k = 1; k < floors; k++) {
    b.box(roofW, SLAB, d - 2 * T, roofX, ys[k] - SLAB / 2, 0, PALM_BEAM);
    b.block({ w: roofW, h: SLAB, d: d - 2 * T, x: roofX, y: ys[k] - SLAB / 2, z: 0 });
  }

  // 4 — the walls. The -Z one carries the door; the +X one is the wall a ruin
  // loses, because it is the one the lane is behind and so the one whose loss
  // opens the inside of the house to the street.
  const mid = wallTop / 2;
  if (p.enterable) {
    b.doorWall(w, wallTop, T, 0, mid, -(d - T) / 2, skin, 1.3, 2.2);
  } else {
    b.wall(w, wallTop, T, 0, mid, -(d - T) / 2, skin);
  }
  b.wall(w, wallTop, T, 0, mid, (d - T) / 2, skin);
  const sideD = d - 2 * T;
  b.wall(T, wallTop, sideD, -(w - T) / 2, mid, 0, skin);
  if (ruined) {
    b.wall(T, 1.25, sideD * 0.62, (w - T) / 2, 0.625 + PLINTH, -sideD * 0.19, SCORCH);
  } else {
    b.wall(T, wallTop, sideD, (w - T) / 2, mid, 0, skin);
  }

  // The elevation: a lintel course, and windows on every storey.
  b.box(w + 0.3, 0.16, d + 0.3, 0, wallTop - 0.08, 0, MUDBRICK_DARK);
  const rows = ruined ? 1 : floors;
  for (let k = 0; k < rows; k++) {
    const y = PLINTH + k * (STOREY + SLAB) + 1.75;
    const across = Math.max(1, Math.round(w / 4.5));
    windowRow(b, w - 2.4, y, -(d / 2) + 0.02, false, across);
    windowRow(b, w - 2.4, y, d / 2 - 0.02, false, across);
    if (!ruined) {
      windowRow(b, sideD - 2.0, y, -(w / 2) + 0.02, true, Math.max(1, Math.round(d / 5)));
    }
  }
  if (p.enterable) {
    b.box(1.6, 0.22, 0.5, 0, 2.32 + PLINTH, -(d / 2) - 0.1, PALM_BEAM);
  }

  // 5 — the roof, and 6 — the parapet standing on it.
  if (ruined) {
    // Broken back to a little over half, with the joists that held the rest
    // sticking out over the gap. Emitted after every walked surface, because
    // this one is not: nothing climbs a ruin.
    const kept = roofW * 0.56;
    const kx = roofX - (roofW - kept) / 2;
    b.box(kept, SLAB, d - 2 * T, kx, roofY - SLAB / 2, 0, ROOF_MUD);
    b.block({ w: kept, h: SLAB, d: d - 2 * T, x: kx, y: roofY - SLAB / 2, z: 0 });
    for (let i = 0; i < 4; i++) {
      const z = -(d / 2) + 1.4 + (i / 3) * (d - 2.8);
      b.box(2.6, 0.16, 0.18, kx + kept / 2 + 1.1, roofY - 0.3, z, PALM_BEAM);
    }
    b.wall(2.2, 0.75, 1.9, w * 0.18, PLINTH + 0.37, -d * 0.16, MUDBRICK_DARK);
    b.wall(1.7, 0.6, 1.5, w * 0.3, PLINTH + 0.3, d * 0.22, MUDBRICK_DARK);
    return b;
  }
  b.box(roofW, SLAB, d, roofX, roofY - SLAB / 2, 0, ROOF_MUD);
  b.block({ w: roofW, h: SLAB, d, x: roofX, y: roofY - SLAB / 2, z: 0 });
  if (climbs) {
    // The lane's outer wall carries a parapet of its own; the roof's +X edge is
    // the shaft, and stays open.
    b.wall(PARAPET_T, PARAPET, d, (w - PARAPET_T) / 2, wallTop + PARAPET / 2, 0, skin);
    parapetOpenX(b, roofW, d, roofX, roofY, skin, MUDBRICK_DARK);
  } else {
    parapet(b, w, d, roofY, skin, MUDBRICK_DARK);
  }
  // A roof is where a house keeps its water. Visual: the parapet already stops
  // everything at this height, and a cistern is not cover worth a collider.
  b.cyl(0.9, 0.8, 0.8, 8, roofX + roofW * 0.28, roofY + 0.45, d * 0.3, ALLOY);
  return b;
}

/**
 * A compound wall run along X: the thing a desert town is actually made of.
 *
 * Head-high and opaque, so it breaks a sightline rather than only a walking
 * line — `buildStoneWall`'s argument in a different vernacular, and the reason
 * this is not that builder is that a dry-stone field wall is 1.5 m and this is
 * 2.6: you cannot see over a compound wall, and a town of them is a maze at eye
 * level and a plain from any roof. That relationship IS the map.
 *
 * **Author it in runs with gaps.** A sealed compound is a wall the nav grid
 * routes bots the whole way around, and a layout has no way to say "there is a
 * gate here" other than two runs with a space between them.
 */
export function buildCompoundWall(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "compound");
  const len = p.length ?? 14;
  const h = p.height ?? 2.6;
  const skin = p.tint ?? MUDBRICK;
  b.wall(len, h, 0.4, 0, h / 2, 0, skin);
  // The coping, and a pier every few metres. The silhouette is what sells mud
  // brick, since the shader gives it no texture: a wall with a stepped head and
  // buttresses reads as built, and a bare slab reads as a fence.
  b.box(len, 0.16, 0.56, 0, h + 0.08, 0, MUDBRICK_DARK);
  const piers = Math.max(1, Math.round(len / 5));
  for (let i = 0; i <= piers; i++) {
    const x = -len / 2 + (i / piers) * len;
    b.box(0.62, h + 0.3, 0.62, x, (h + 0.3) / 2, 0, skin);
  }
  return b;
}

/**
 * The shelled block: a reinforced-concrete apartment slab with its top corner
 * taken off, three walked floors, and an open window band on every one of them.
 *
 * ## What it is FOR, against the house next to it
 *
 * The house is a roof; this is a BUILDING you fight inside. Three plates, a
 * stair shaft joining them, no glass anywhere and a chest-high spandrel under
 * every opening — so every floor shoots every street around it and is shot back
 * at from the floors above and below. It is `buildOffice`'s shape with the
 * glazing taken out and one corner blown off, and it is deliberately the only
 * thing on this map carrying that much interior: the rest of the town is walls.
 *
 * **No glass at all, and that is a rule rather than a saving.**
 * `PaneSpec.breakable` is for glass with enterable space behind it, and a
 * shelled block is enterable space behind every opening on it — so every window
 * here would qualify, and a dozen buildings' worth would be hundreds of entries
 * in `GameMap.panes`, which is identity on the wire. A town this size gets to
 * have its breakable glazing somewhere it is worth naming; here the windows are
 * already gone, which is both cheaper and truer.
 *
 * ## The sheared corner, which is not decoration
 *
 * The top floor keeps a little over half its plate and a spur along one side;
 * the rest, and the spandrels that stood on it, are in a heap at the foot of
 * that corner. What it buys is a building whose top floor is a different SHAPE
 * from the two under it — an open edge with a two-storey drop off it, which is
 * a place worth holding and a place worth not standing on. A block shelled
 * uniformly is a block with three identical floors, which is the thing this
 * whole file is trying not to build.
 *
 * `depth` carries the stair exactly as the house's does, and at `STOREY_RC` the
 * flights are longer — 10.9 m of run, so 14 m is the least depth that works and
 * `assertClimbable` says so.
 */
export function buildShellBlock(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "shell");
  const w = p.width ?? 20;
  const d = p.depth ?? 15;
  const floors = Math.max(2, Math.min(4, p.floors ?? 3));
  const ys = levels(floors, STOREY_RC);
  const { plateW, plateX } = laneGeom(w);
  const plateD = d - 2 * T;
  /** What is left of the top plate after the shear. */
  const topW = plateW * 0.58;
  const topX = plateX - (plateW - topW) / 2;
  const SPANDREL = 0.95;
  assertClimbable("shellBlock", d, ys[1] - ys[0]);

  // 1 — the plinth.
  b.box(w + 0.8, PLINTH, d + 0.8, 0, PLINTH / 2, 0, DARK_CONCRETE);
  b.block({ w: w + 0.8, h: PLINTH, d: d + 0.8, x: 0, y: PLINTH / 2, z: 0 });

  // 2 — the flights, alternating in the one lane.
  const dir0: 1 | -1 = (p.rampSide ?? -1) === 1 ? 1 : -1;
  for (let k = 1; k <= floors; k++) {
    const dir: 1 | -1 = k % 2 === 1 ? dir0 : ((-dir0) as 1 | -1);
    laneFlight(b, w, d, ys[k - 1], ys[k], dir, DARK_CONCRETE);
  }

  // 3 — the slabs, the last of them sheared.
  for (let k = 1; k <= floors; k++) {
    const top = k === floors;
    const pw = top ? topW : plateW;
    const px = top ? topX : plateX;
    b.box(pw, SLAB, plateD, px, ys[k] - SLAB / 2, 0, CONCRETE);
    b.block({ w: pw, h: SLAB, d: plateD, x: px, y: ys[k] - SLAB / 2, z: 0 });
    if (top) {
      // The spur left on the -Z side of the break, so the shear runs across the
      // floor at an angle rather than cutting it straight in two.
      const rw = plateW - topW;
      b.box(rw, SLAB, plateD * 0.46, px + topW / 2 + rw / 2, ys[k] - SLAB / 2, -plateD * 0.27, CONCRETE);
      b.block({
        w: rw,
        h: SLAB,
        d: plateD * 0.46,
        x: px + topW / 2 + rw / 2,
        y: ys[k] - SLAB / 2,
        z: -plateD * 0.27,
      });
    }
  }

  // 4 — the frame. The ground floor is enclosed with two doorways and every
  // floor above it is a spandrel under an open band, which is the gradient this
  // building is: a dark room to get into, a gallery to hold.
  for (let k = 0; k < floors; k++) {
    const y = ys[k];
    const shear = k === floors - 1;
    const spanW = shear ? topW : w;
    const spanX = shear ? topX : 0;
    if (k === 0) {
      b.doorWall(w, STOREY_RC, T, 0, y + STOREY_RC / 2, -(d - T) / 2, CONCRETE, 1.8, 2.4);
      b.doorWall(w, STOREY_RC, T, 0, y + STOREY_RC / 2, (d - T) / 2, CONCRETE, 1.8, 2.4);
      for (const sx of [-1, 1] as const) {
        b.wall(T, STOREY_RC, plateD, (sx * (w - T)) / 2, y + STOREY_RC / 2, 0, CONCRETE);
      }
      continue;
    }
    for (const sz of [-1, 1] as const) {
      const z = (sz * (d - T)) / 2;
      b.wall(spanW, SPANDREL, T, spanX, y + SPANDREL / 2, z, CONCRETE);
      // The lintel band over the opening — what the floor above stands on.
      b.wall(spanW, 0.42, T, spanX, y + STOREY_RC - 0.21, z, DARK_CONCRETE);
    }
    b.wall(T, SPANDREL, plateD, -(w - T) / 2, y + SPANDREL / 2, 0, CONCRETE);
    b.wall(T, 0.42, plateD, -(w - T) / 2, y + STOREY_RC - 0.21, 0, DARK_CONCRETE);
    if (!shear) {
      b.wall(T, SPANDREL, plateD, (w - T) / 2, y + SPANDREL / 2, 0, CONCRETE);
      b.wall(T, 0.42, plateD, (w - T) / 2, y + STOREY_RC - 0.21, 0, DARK_CONCRETE);
    }
    // The piers between the bays: the frame the spandrels hang off, and the
    // only thing standing at the corners of an open floor.
    const bays = Math.max(2, Math.round(spanW / 5.0));
    for (let i = 0; i <= bays; i++) {
      const x = spanX - spanW / 2 + (i / bays) * spanW;
      for (const sz of [-1, 1] as const) {
        b.box(0.44, STOREY_RC, 0.5, x, y + STOREY_RC / 2, (sz * (d - T)) / 2, DARK_CONCRETE);
      }
    }
  }

  // 5 — what is left of the roof parapet, the scorch over the shear, and the
  // heap the corner came down in. All of it after every walked surface.
  const roofY = ys[floors];
  for (const sz of [-1, 1] as const) {
    b.wall(topW, PARAPET, PARAPET_T, topX, roofY + PARAPET / 2, (sz * (d - PARAPET_T)) / 2, CONCRETE);
  }
  b.wall(PARAPET_T, PARAPET, plateD, topX - (topW - PARAPET_T) / 2, roofY + PARAPET / 2, 0, CONCRETE);
  b.box(w * 0.26, 0.06, d * 0.66, w * 0.29, roofY - 0.1, 0, SCORCH);
  b.wall(3.6, 1.15, 3.0, w * 0.3, PLINTH + 0.575, d * 0.24, DARK_CONCRETE);
  b.wall(2.6, 0.8, 2.4, w * 0.36, PLINTH + 0.4, -d * 0.1, CONCRETE);
  for (let i = 0; i < 5; i++) {
    b.strut(0.08, 1.5, 0.08, w * 0.3 + (i - 2) * 0.5, PLINTH + 1.6, d * 0.24 + (i % 2) * 0.4, IRON);
  }
  return b;
}

/**
 * The mosque: one hall under a tiled dome, a portico of five bays, and the only
 * chroma on the map.
 *
 * Enterable, and enterable as ONE volume — no floors, no stair, nothing to
 * climb. That is deliberate against the shelled block: a fight over the mosque
 * is a fight through a portico and three doors into a room with four columns in
 * it, and the columns are the only cover in it; the block is a fight up a
 * stair. Two flags that play the same way are one flag.
 *
 * The dome is a stack of drums rather than a sphere for the reason everything
 * else here is a box: the cel shader bands light, and a smooth surface bands
 * into visible contour rings. Stepped drums band into what reads as courses of
 * tile, which is what a dome is made of anyway.
 */
export function buildMosque(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "mosque");
  const w = p.width ?? 26;
  const d = p.depth ?? 20;
  const h = p.height ?? 7.4;
  const t = 0.7;
  const base = PLINTH + 0.2;

  b.box(w + 2.4, base, d + 5.2, 0, base / 2, -1.4, WHITEWASH);
  b.block({ w: w + 2.4, h: base, d: d + 5.2, x: 0, y: base / 2, z: -1.4 });

  // The hall: a wide doorway on -Z and one in each side wall. `doorWall` runs
  // along X, so the side walls are laid out here rather than reusing it.
  b.doorWall(w, h, t, 0, base + h / 2, -(d - t) / 2, WHITEWASH, 3.2, 3.6);
  b.wall(w, h, t, 0, base + h / 2, (d - t) / 2, WHITEWASH);
  for (const sx of [-1, 1] as const) {
    const x = (sx * (w - t)) / 2;
    const run = (d - 2 * t - 2.2) / 2;
    for (const sz of [-1, 1] as const) {
      b.wall(t, h, run, x, base + h / 2, (sz * (run + 2.2)) / 2, WHITEWASH);
    }
    b.wall(t, h - 2.6, 2.2, x, base + 2.6 + (h - 2.6) / 2, 0, WHITEWASH);
  }
  // The four columns: the only cover in the hall, and thick enough that
  // `NavGrid` can represent them.
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      b.wall(0.8, h - 0.4, 0.8, sx * w * 0.24, base + (h - 0.4) / 2, sz * d * 0.2, WHITEWASH);
    }
  }
  // The roof. Walked in the sense that a round stops on it and nothing else —
  // there is no way up, which is the point of the minaret standing beside it.
  b.box(w + 0.8, SLAB, d + 0.8, 0, base + h + SLAB / 2, 0, ROOF_MUD);
  b.block({ w: w + 0.8, h: SLAB, d: d + 0.8, x: 0, y: base + h + SLAB / 2, z: 0 });

  const domeY = base + h + SLAB;
  const drum = Math.min(w, d) * 0.42;
  b.cyl(1.9, drum, drum + 0.5, 12, 0, domeY + 0.95, 0, WHITEWASH);
  const shells: [number, number, number][] = [
    [1.7, drum * 0.98, drum],
    [1.5, drum * 0.84, drum * 0.98],
    [1.2, drum * 0.6, drum * 0.84],
    [0.8, drum * 0.24, drum * 0.6],
  ];
  let dy = domeY + 1.9;
  for (const [sh, top, bottom] of shells) {
    b.cyl(sh, top, bottom, 12, 0, dy + sh / 2, 0, TILE_BLUE);
    dy += sh;
  }
  b.cyl(1.1, 0.1, 0.42, 8, 0, dy + 0.55, 0, ALLOY);
  b.block({ w: drum, h: 6.5, d: drum, x: 0, y: domeY + 3.25, z: 0 });

  // The portico: six piers carrying a flat canopy across the entrance.
  const pz = -(d / 2) - 3.0;
  for (let i = 0; i <= 5; i++) {
    const x = -w / 2 + (i / 5) * w;
    b.wall(0.8, h - 2.2, 0.8, x, base + (h - 2.2) / 2, pz, WHITEWASH);
  }
  b.box(w + 1.6, 0.55, 3.4, 0, base + h - 1.9, pz + 0.4, WHITEWASH);
  b.block({ w: w + 1.6, h: 0.55, d: 3.4, x: 0, y: base + h - 1.9, z: pz + 0.4 });
  b.box(w + 1.9, 0.3, 3.8, 0, base + h - 1.5, pz + 0.4, MUDBRICK_DARK);
  return b;
}

/**
 * The minaret: a tapering octagonal shaft, a balcony, a tiled cap.
 *
 * **Not climbable, and that is the decision rather than an omission.** A tower
 * a player can get to the top of, on a map with a 560 m view, is a position
 * that sees every flag — and there is no counter to it, because there is only
 * one way up. What it is instead is the LANDMARK: the tallest thing in the
 * town, visible from every quarter, the thing a player orients on before they
 * have learned the streets. It costs three collider boxes to be that.
 */
export function buildMinaret(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "minaret");
  const h = p.height ?? 26;
  const base = 4.2;

  b.box(base + 1.2, 1.2, base + 1.2, 0, 0.6, 0, MUDBRICK_DARK);
  b.block({ w: base + 1.2, h: 1.2, d: base + 1.2, x: 0, y: 0.6, z: 0 });

  const lower = h * 0.62;
  b.cyl(lower, base * 0.82, base, 8, 0, 1.2 + lower / 2, 0, WHITEWASH);
  b.block({ w: base, h: lower, d: base, x: 0, y: 1.2 + lower / 2, z: 0 });
  // The banding a brick minaret is built in — three courses of the darker
  // brick, which is what gives sixteen metres of shaft any scale at all from
  // four hundred metres away.
  for (let i = 1; i <= 3; i++) {
    b.cyl(0.5, base * 0.94, base * 0.94, 8, 0, 1.2 + (i / 4) * lower, 0, MUDBRICK);
  }
  const bal = 1.2 + lower;
  b.cyl(0.42, base * 1.85, base * 1.5, 8, 0, bal + 0.21, 0, MUDBRICK_DARK);
  b.cyl(1.05, base * 1.7, base * 1.7, 8, 0, bal + 0.95, 0, WHITEWASH);
  const upper = h - lower - 2.7;
  b.cyl(upper, base * 0.5, base * 0.68, 8, 0, bal + 1.5 + upper / 2, 0, WHITEWASH);
  b.block({
    w: base * 0.68,
    h: upper + 1.5,
    d: base * 0.68,
    x: 0,
    y: bal + (upper + 1.5) / 2,
    z: 0,
  });
  b.cyl(2.0, 0.12, base * 0.66, 8, 0, bal + 1.5 + upper + 1.0, 0, TILE_BLUE);
  b.cyl(0.9, 0.06, 0.22, 6, 0, bal + 1.5 + upper + 2.4, 0, ALLOY);
  return b;
}

/**
 * The souk arcade: a colonnade with a walked roof, running along Z.
 *
 * It runs along Z because the STAIR does — `Build.flight` climbs in Z, and a
 * market hall wide enough to hold a flight across its width would be a hall
 * rather than an arcade. The layout turns it.
 *
 * Open on both long sides at ground level, so the arcade is a covered street
 * you shoot along and across, with one of the best positions in the town over
 * it. The awnings between the piers are `translucentBox` — the one place on
 * this map the sun comes THROUGH something, which is most of what makes a
 * market read as a market.
 */
export function buildSouk(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "souk");
  const len = p.length ?? 30;
  const w = p.width ?? 11;
  const ys = levels(1, STOREY);
  const roofY = ys[1];
  const { plateW, plateX } = laneGeom(w);
  assertClimbable("souk", len, roofY - ys[0]);

  b.box(w + 0.6, PLINTH, len + 0.6, 0, PLINTH / 2, 0, MUDBRICK_DARK);
  b.block({ w: w + 0.6, h: PLINTH, d: len + 0.6, x: 0, y: PLINTH / 2, z: 0 });

  laneFlight(b, w, len, ys[0], roofY, (p.rampSide ?? -1) === 1 ? 1 : -1, PALM_BEAM);

  // The piers, in pairs down both long sides of the covered street — and the
  // BLIND WALL behind the +X row, which is the lane's outer face.
  //
  // The wall is not decoration and it is not optional: the lane is a stair well
  // with a landing at the head of it, and without a wall on its outer edge the
  // parapet below would stand on nothing at all and the landing would be a
  // shelf in mid-air. It is also what an arcade built against a street IS —
  // open on one side, blind on the other — which is why the awnings are all on
  // the -X face.
  const bays = Math.max(3, Math.round(len / 4.2));
  const pierH = roofY - PLINTH - SLAB;
  for (let i = 0; i <= bays; i++) {
    const z = -len / 2 + (i / bays) * len;
    for (const sx of [-1, 1] as const) {
      const x = plateX + (sx * (plateW - 0.7)) / 2;
      b.wall(0.7, pierH, 0.7, x, PLINTH + pierH / 2, z, MUDBRICK);
    }
  }
  b.wall(T, pierH, len, (w - T) / 2, PLINTH + pierH / 2, 0, MUDBRICK);
  // The awnings, stretched off the open side between the piers.
  for (let i = 0; i < bays; i++) {
    const z = -len / 2 + ((i + 0.5) / bays) * len;
    b.translucentBox(
      2.4,
      0.08,
      len / bays - 0.5,
      plateX - plateW / 2 - 1.3,
      PLINTH + 2.35,
      z,
      i % 2 === 0 ? "#a8703f" : "#8d6a4a",
      CONFIG.graphics.translucency.awning,
      { z: 0.12 },
    );
  }
  // The lintel course the roof sits on, then the roof, then its parapet.
  for (const sx of [-1, 1] as const) {
    b.box(0.9, 0.45, len, plateX + (sx * (plateW - 0.7)) / 2, roofY - SLAB - 0.22, 0, PALM_BEAM);
  }
  b.box(plateW, SLAB, len, plateX, roofY - SLAB / 2, 0, ROOF_MUD);
  b.block({ w: plateW, h: SLAB, d: len, x: plateX, y: roofY - SLAB / 2, z: 0 });
  b.wall(PARAPET_T, PARAPET, len, (w - PARAPET_T) / 2, roofY - SLAB + PARAPET / 2, 0, MUDBRICK);
  b.box(PARAPET_T + 0.16, 0.14, len, (w - PARAPET_T) / 2, roofY - SLAB + PARAPET + 0.07, 0, MUDBRICK_DARK);
  parapetOpenX(b, plateW, len, plateX, roofY, MUDBRICK, MUDBRICK_DARK);
  return b;
}

/**
 * A run of T-walls along X: the concrete a town grows once it is being fought
 * over, and the one piece of cover on this map nobody who lives here built.
 *
 * **One collider for the run, and the panels are visual.** This is the fence's
 * construction with the opposite verdict on `porous`: a T-wall run is three
 * metres of continuous reinforced concrete and a round stops on all of it, so
 * the coarse box is an ordinary collider and there is nothing for `strut` to
 * catch. The panels exist because a T-wall run's silhouette is its whole
 * appearance — the gap at the head between one panel and the next, and the feet
 * — and drawing it as one slab reads as a retaining wall.
 */
export function buildBlastWall(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "blastwall");
  const len = p.length ?? 12;
  const h = p.height ?? 3.4;
  const panels = Math.max(2, Math.round(len / 1.6));
  const pitch = len / panels;
  for (let i = 0; i < panels; i++) {
    const x = -len / 2 + (i + 0.5) * pitch;
    // Each panel stands a hair off its neighbour: a T-wall run is placed by
    // crane and never lines up, and the shadow between two panels is the only
    // vertical line a flat grey wall has.
    const jitter = ((i % 3) - 1) * 0.04;
    b.box(pitch - 0.09, h, 0.42, x, h / 2, jitter, CONCRETE, { y: jitter * 0.06 });
    b.box(pitch - 0.02, 0.34, 1.35, x, 0.17, jitter, DARK_CONCRETE);
    b.box(pitch - 0.5, 0.16, 0.55, x, h - 0.08, jitter, DARK_CONCRETE);
  }
  b.block({ w: len, h, d: 0.55, x: 0, y: h / 2, z: 0 });
  return b;
}

/**
 * A sandbag emplacement: staggered courses along X, chest-high to a crouch and
 * hip-high to a stand.
 *
 * Sized against `CoverMap`'s 1.7 m hard-cover line on purpose — it is LOW
 * cover, so a bot behind it crouches and shoots over rather than standing
 * behind it, and a body at one is exposed from the chest up. Anything taller
 * would be a wall, and this map has walls.
 */
export function buildSandbags(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "sandbags");
  const len = p.length ?? 6;
  const h = p.height ?? 1.15;
  const courses = Math.max(2, Math.round(h / 0.28));
  for (let c = 0; c < courses; c++) {
    const y = (c + 0.5) * (h / courses);
    const inset = (c / courses) * 0.22;
    const n = Math.max(2, Math.round(len / 0.62));
    for (let i = 0; i < n; i++) {
      const x = -len / 2 + ((i + 0.5) / n) * len + (c % 2 ? 0.14 : 0);
      b.box(len / n - 0.05, h / courses + 0.03, 0.78 - inset, x, y, 0, SANDBAG, {
        y: ((i * 7 + c * 3) % 5) * 0.012,
      });
    }
  }
  b.block({ w: len, h, d: 0.85, x: 0, y: h / 2, z: 0 });
  // The pickets and the wire a position gets once it has been there a while,
  // and the plank somebody put across the top of it to lean a rifle on.
  for (let i = 0; i <= 2; i++) {
    b.strut(0.09, 1.5, 0.09, -len / 2 + (i / 2) * len, h + 0.35, -0.55, IRON);
  }
  b.strut(len, 0.06, 0.06, 0, h + 0.9, -0.55, IRON);
  b.box(len * 0.6, 0.14, 0.4, len * 0.1, h + 0.07, 0.5, TIMBER);
  b.box(1.1, 0.3, 0.7, -len * 0.3, h + 0.15, 0.42, TEAK);
  return b;
}
