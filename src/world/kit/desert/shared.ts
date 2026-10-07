/**
 * kit/desert/shared.ts — What every building in the desert-town set is
 * measured and dressed by: the ten-colour palette; the wall, the plinth, the
 * slab, the storey, the stair lane and its landing, the parapet and `GRADE`;
 * the lane's helpers (`levels`, `laneGeom`, `assertClimbable`,
 * `laneFlight`); `clothHash` and the `drape` it varies; the two parapets and
 * `windowRow`. Part of the desert-town set: follows the contract in
 * kit/core.ts and the set's rules in `./index.ts`, which these numbers are
 * where they bite. Invariants: geometry constants, deliberately not in
 * CONFIG; variation comes from a builder's params, never `Math.random()`.
 * Never builds a building, and never imports one.
 */
import { CONFIG } from "../../../config";
import { marksSway } from "../../sway";
import { Build } from "../core";

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
 * thing that survives it. Nothing else in this set is allowed any.
 */
export const TILE_BLUE = "#2f6f83";

/**
 * Bleached cloth: everything in the town that hangs and moves.
 *
 * **A tenth colour in a set whose header makes a point of there being nine,
 * so it owes an argument.** The town was built and then left static: 194
 * houses and 298 wall runs of geometry with nothing on any of it that the wind
 * reaches, on a map whose only other moving thing is eleven palms. What a
 * hung sheet buys is the one cue a midday desert cannot get from its light —
 * that the air is going somewhere — and it buys it at one material for the
 * whole town, because every drape in this set is this colour and merges into
 * one group per block.
 *
 * **It is pale and it is not chroma, and both halves are rules.** Pale,
 * because it hangs on `MUDBRICK` and has to separate from it in VALUE — the
 * ladder this palette is — and low chroma because the map's saturation budget
 * is spent: `TILE_BLUE` above and the two liveries are what a player navigates
 * and identifies by out to `fogEnd`, and washing that competed with either
 * would be spending a gameplay signal on dressing.
 */
export const CLOTH = "#c9bda3";

// --- the shared geometry -----------------------------------------------------

/** Wall thickness. Mud brick is thick, and 0.45 m is what reads as thick. */
export const T = 0.45;
/** The plinth every building stands on. Under `stepHeight`, so it merges. */
export const PLINTH = 0.25;
/**
 * A walked slab's thickness, and `kit/city/index.ts`'s third rule: below
 * about this, the outline shell wins the depth test at the grazing angle a
 * floor is seen from and paints the whole storey in its own ink.
 */
export const SLAB = 0.5;
/** Storey height for mud brick — low, which is what a hot climate builds. */
export const STOREY = 2.9;

/** The stair lane's width. See the set's header. */
const LANE = 2.0;
/** The least floor between a flight's top tread and the wall it climbs to. */
const LANDING = 1.8;
/** Parapet height and thickness: chest cover on every roof in the town. */
export const PARAPET = 0.95;
export const PARAPET_T = 0.4;
/**
 * The grade every flight here is built to, against `MAX_WALKABLE_GRADE`'s 0.4.
 *
 * The margin is not politeness. A flight's collider is a pitched slab and the
 * nav graph links its cells by comparing heights SAMPLED a cell apart, so a run
 * built exactly at the limit fails on rounding wherever a sample lands near a
 * cell boundary — and it fails silently, as a storey the bots never enter.
 */
export const GRADE = 0.34;

/**
 * Where each walked level of a building sits, given how many storeys it has.
 *
 * Level 0 is the ground — the plinth's top, which is what a body stands on
 * inside — and level `k` is the top face of the k-th slab. The roof is level
 * `floors`, so a single-storey house has two walked surfaces and a two-storey
 * house three.
 */
export function levels(floors: number, storey: number): number[] {
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
export function laneGeom(w: number): { laneX: number; plateW: number; plateX: number } {
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
export function assertClimbable(kind: string, depth: number, rise: number): void {
  if (!import.meta.env.DEV) return;
  const run = depth - 2 * T - LANDING;
  if (run <= 0 || rise / run > GRADE + 1e-6) {
    throw new Error(
      `${kind}: depth ${depth} leaves ${run.toFixed(1)} m of run for a ` +
        `${rise.toFixed(2)} m rise — grade ${(rise / run).toFixed(3)} against ` +
        `${GRADE}. Deepen the footprint or drop a storey; see kit/desert/index.ts.`,
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
export function laneFlight(
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
 * A stable 0..1 from a builder's own parameters.
 *
 * **Cloth has to vary and world-building code may not call `Math.random()`** —
 * the nav graph would differ between page loads (`CLAUDE.md`). A structure
 * builder is also the one place in the world layer with no seed to hand:
 * scatter props are given one by `MapBuilder`, and a `BuilderKind` is handed
 * only its params, because everything else in this set is the same object
 * wherever it stands.
 *
 * So the variation is taken from the params themselves, which is honest rather
 * than a workaround: two houses with the same footprint, the same storeys and
 * the same door already ARE the same house, and giving them different washing
 * would be the only thing about them that was not. What separates them on the
 * ground is `rotY` and where the wind is coming from.
 */
export function clothHash(...ns: number[]): number {
  let h = 0x9e3779b9;
  for (const n of ns) {
    h ^= Math.round(n * 64) + 0x9e3779b9 + (h << 6) + (h >>> 2);
    h = h >>> 0;
  }
  return (h >>> 8) / 0x1000000;
}

/**
 * Cloth hung on a wall face: a rolled head and three strips under it, all
 * marked for the wind.
 *
 * `face` is the coordinate of the wall's outer surface on Z and `out` its
 * outward sign; the assembly hangs DOWN from `top`, which wants to be the
 * underside of whatever coping oversails that wall.
 *
 * **It is four boxes and not one, and the count is the whole design.** A sheet
 * drawn as a single box is a SLAB: a rectangle with a level hem, a constant
 * thickness, one flat face and nothing to catch the light differently anywhere
 * along it — and on this layer it also translates rigidly, because
 * `CONFIG.wind`'s `cloth` gives every vertex on one box very nearly the same
 * weight. Neither half of that reads as fabric. What does is the same argument
 * `buildCompoundWall` makes about mud brick one function down: **the shader
 * gives these surfaces no texture, so the SILHOUETTE is the whole of what a
 * material is.** So the strips differ in width, in drop, in how far they stand
 * proud of the wall and in how far they hang askew, and the hem they make
 * between them is ragged rather than level.
 *
 * **Everything including the head is marked, which is what leaves the assembly
 * no internal join.** The obvious construction — a fixed valance with moving
 * strips under it — buys a still anchor and pays for it with a shear line
 * across the top of every drape in the town, at exactly the place cloth is
 * least able to hide one. Marking the roll as well means the whole assembly
 * moves together and the only step anywhere is where the roll meets the wall,
 * which is under the coping's own 0.08 oversail and is why `cloth`'s `amount`
 * is pinned to that number rather than chosen.
 *
 * **Visual only, and it must stay that way.** `world/sway.ts` forbids marking
 * anything a collider stands in for, and a drape is exactly the safe case: it
 * emits no box, nothing was ever measured against it, and a body walks through
 * where it hangs — which is also what it should do, since the alternative on a
 * town's worth of washing is hundreds of `WorldBox` entries the nav grid, the
 * cover bake and the collision bake would all have to carry.
 */
export function drape(
  b: Build,
  w: number,
  drop: number,
  x: number,
  top: number,
  face: number,
  out: 1 | -1,
  seed: number,
): void {
  const trans = CONFIG.graphics.translucency.awning;
  // The head: cloth gathered over the coping, and the one part of the assembly
  // whose job is to be an EDGE. Wider than the strips under it so no strip's
  // top corner can swing out from behind it, and standing 0.11 proud so the
  // strips have something to emerge from rather than a plane to lie in.
  marksSway(
    b.translucentBox(w + 0.12, 0.17, 0.16, x, top - 0.085, face + out * 0.03, CLOTH, trans),
    "cloth",
  );
  const strips = 3;
  for (let i = 0; i < strips; i++) {
    const r = clothHash(seed, i);
    const r2 = clothHash(seed, i, 7);
    // Width, and the gap beside it. A strip narrower than its share of `w` is
    // what puts a vertical slot between one strip and the next, and the slot
    // is what a fold looks like from across a street.
    const sw = (w / strips) * (0.5 + r * 0.36);
    const sx = x - w / 2 + ((i + 0.5) / strips) * w + (r2 - 0.5) * 0.08;
    // The drop, and it is the ragged hem. The range is nearly THREE to one,
    // which is what a hem has to be to stop reading as an edge: at the 1.3:1
    // this started at, three strips of a similar length under one head still
    // made a rectangle, and a rectangle is the thing that was wrong with the
    // single box. Capped so the longest cannot reach past the lintel course
    // below a house's parapet, which it did — the tips came out under the
    // string course and z-fought it.
    const sh = Math.min(drop * (0.42 + r * 0.86), 1.05);
    // How far this strip stands off the wall. The spread is small — under
    // seven centimetres — and it is doing two things: it separates the strips
    // in DEPTH so the light bands them differently, and it keeps every one of
    // them clear of the wall face, which the old single sheet was not (it sat
    // 0.02 INSIDE, so it read as paint rather than as an object).
    const proud = 0.035 + r2 * 0.065;
    marksSway(
      b.translucentBox(
        sw,
        sh,
        0.045,
        sx,
        top - 0.1 - sh / 2,
        face + out * proud,
        CLOTH,
        trans,
        // Hanging askew, and turned a little out of the wall's plane. Both
        // stay small: a rag at 0.13 rad is cloth that was hung in a hurry, and
        // at three times that it is a mesh somebody rotated by mistake.
        { z: (r - 0.5) * 0.26, y: (r2 - 0.5) * 0.16 },
      ),
      "cloth",
    );
  }
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
export function parapet(
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
export function parapetOpenX(
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
export function windowRow(
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
