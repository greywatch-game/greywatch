/**
 * kit/buildings/ruin.ts — buildRuin: the stone cottage that burnt and was never
 * rebuilt.
 * Part of the buildings set: follows the contract in kit/core.ts; the set's
 * files are listed in `./index.ts`.
 */
import { Scene } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import { mulberry32 } from "../../rng";
import {
  Build,
  type BuildCtx,
  type BuildParams,
  type Structure,
  streetSeed,
  StoneBatch,
  onFace,
  outward,
  type Hole,
  type Side,
  CASEMENT,
  slab,
  BRICK,
  DARK_STONE,
  IRON,
  PLANK,
  STONE,
  TIMBER,
} from "../core";
import {
  RUBBLE_BACK,
  rubbleCourses,
  rubbleFace,
  ashlarFace,
  dressedEdge,
  rubbleHead,
  rubbleTeeth,
  rubbleFooting,
  rubbleScatter,
  rubbleHeap,
  ivy,
} from "./rubble";

/**
 * A stone cottage that burnt, roof and floors, and was never rebuilt: rubble
 * walls broken down to different heights, one corner still standing to the
 * eaves with its chimney breast, and the stack still up above it all — the bit
 * of a burnt house that always survives. Fills ground that would otherwise be
 * empty with somewhere to *fight*, which a solid building never does — every
 * wall here is cover on both sides and none of them reaches the eaves.
 *
 * ## The masses are the colliders' and the detail is the drawing
 *
 * The block at the top is every collider this ruin has ever had, in the order
 * it has always emitted them — each `wall` restated as the `block` it pushed —
 * so a change below that block owes no `npm run collision`, and one inside it
 * does. Everything else is drawing and obeys one of three rules: it is flat on
 * a face, it is low enough to walk over, or it stands on top of a collider. A
 * broken head and the teeth at a break stand a course or several past the box
 * that answers for them — the jungle ruin's trade: a round through the top
 * course passes.
 *
 * ## What it is drawn as
 *
 * - **Random rubble in courses** on every face of every wall, over a dark core
 *   set back four centimetres (`RUBBLE_BACK`), so each joint is a step the ink
 *   draws; each stone stands its own distance proud and leans a little, which
 *   is what makes a face a field of stones under the bands rather than a
 *   plane. Both faces of a wall share one list of courses.
 * - **Broken heads and broken ends.** A head is through-stones a course or
 *   several high standing on the collider, torn along a slow wave; the north
 *   front breaks down to the low wall in a staircase of courses on top of it;
 *   a wall that broke off has teeth down its end; and where a wall has gone
 *   altogether its footing is still there, a course or two, so the line of the
 *   house survives.
 * - **What says it was built.** The one corner still standing (the north-east)
 *   is quoined in dressed stone crossing at the arris, and so is the doorway's
 *   surviving jamb, with its reveal, its two hinge pintles and a threshold and
 *   step. A window in the east gable was blocked long before the fire: a
 *   dressed sill, jambs and lintel outside and a timber lintel inside, both
 *   round smaller stones laid later.
 * - **The chimney breast** is rubble to the eaves with a fireplace in its
 *   face — a charred timber bressummer on dressed jambs over a sooted fireback,
 *   an iron crane with its pot, a hearthstone, and soot fanning up the breast
 *   above it — and ashlar above the eaves under a drip course, an oversailing
 *   cap and two pots, one broken off.
 * - **The fire.** Every inside face is blackened in proportion to its height,
 *   which is where a burning roof puts it; the loft floor's joists have left a
 *   row of pockets in the north wall, some with a charred stub still in them.
 *   The two heaps are mounds of rubble with rafters out of them, a purlin lies
 *   from the larger across the room, a rafter leans on the east head, and the
 *   door lies flat inside where it fell.
 * - **Ivy** up the north front, and moss on the heads.
 *
 * **All of it is seeded off where it stands** (`streetSeed`), and the first
 * course of every face, the footings, the heaps and the threshold are carried
 * to the ground under them, which is what puts `ruin` in `CONFORMS_TO_TERRAIN`.
 */
export function buildRuin(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "ruin");
  const w = p.width ?? 10;
  const d = p.depth ?? 8;
  const t = 0.5;

  // ---- the colliders: every one this ruin has ever had, in the order it
  // has always emitted them.
  // North wall: mostly standing, broken down at one end.
  b.block({ w: w * 0.62, h: 3.4, d: t, x: -w * 0.19, y: 1.7, z: d / 2 });
  b.block({ w: w * 0.38, h: 1.8, d: t, x: w * 0.31, y: 0.9, z: d / 2 });
  // East wall standing tall, west wall down to a stub.
  b.block({ w: t, h: 2.7, d: d * 0.72, x: w / 2, y: 1.35, z: d * 0.14 });
  b.block({ w: t, h: 1.2, d: d * 0.5, x: -w / 2, y: 0.6, z: -d * 0.1 });
  // South wall: two jambs either side of where the door was.
  for (const sx of [-1, 1]) {
    b.block({ w: w * 0.3, h: 1.5, d: t, x: sx * w * 0.35, y: 0.75, z: -d / 2 });
  }
  // The chimney breast.
  b.block({ w: 2.0, h: 5.2, d: 1.4, x: -w / 2 + 1.4, y: 2.6, z: d / 2 - 0.9 });
  // The two heaps the roof came down in.
  b.block({ w: 2.4, h: 0.7, d: 2.0, x: w * 0.22, y: 0.35, z: -d * 0.2 });
  b.block({ w: 1.8, h: 0.6, d: 1.6, x: -w * 0.28, y: 0.3, z: d * 0.22 });

  // ---- everything below is drawing.
  const rnd = mulberry32(streetSeed(w, d, 0, ctx));
  const sb = new StoneBatch();
  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };
  const along = (z: number) => (x: number) => ground(x, z);
  const across = (x: number) => (z: number) => ground(x, z);
  const pl = (s: Side, at: number): number => outward(s) * at;
  const h2 = t / 2;
  const [xW, xE, zS, zN] = [-w / 2, w / 2, -d / 2, d / 2];
  /** Where the north front steps down from the eaves to the low wall. */
  const xj = w * 0.12;
  /** Where the east wall broke off, and the west stub's two ends. */
  const eS = -d * 0.22;
  const [wS, wN] = [-d * 0.35, d * 0.15];
  /** The inner ends of the south wall; the one at -X is the doorway's jamb. */
  const sIn = w * 0.2;
  const jamb = -sIn;
  const dw = Math.min(1.0, w * 0.4 - 0.3);
  /** The chimney breast, and the hearth's centre. */
  const [bx0, bx1, bz0, bz1] = [-w / 2 + 0.4, -w / 2 + 2.4, d / 2 - 1.6, d / 2 - 0.2];
  const xc = -w / 2 + 1.4;
  const zc = d / 2 - 0.9;

  const low = rubbleCourses(0, 1.8, rnd);
  const north = [...low, ...rubbleCourses(1.8, 3.4, rnd)];
  const east = [...low, ...rubbleCourses(1.8, 2.7, rnd)];
  const west = rubbleCourses(0, 1.2, rnd);
  const south = rubbleCourses(0, 1.5, rnd);
  const breast = rubbleCourses(0, 3.4, rnd);
  const soot = (_u: number, y: number): number => Math.max(0, Math.min(1, (y - 1.3) / 2.2)) * 0.45;

  // ---- the north front, and the corner it turns with the east gable.
  const neN = dressedEdge(sb, "+z", zN + h2, xE + h2, -1, low, 0);
  const neE = dressedEdge(sb, "+x", xE + h2, zN + h2, -1, low, 1);
  rubbleFace(sb, {
    s: "+z",
    at: zN + h2,
    u0: xW,
    u1: xE + h2,
    courses: north,
    extent: (c1) => [xW, c1 > 1.8 + 1e-6 ? xj : xE + h2],
    cut: (k) => (k < low.length ? neN(k) : []),
    ground: along(zN + h2),
  }, rnd);
  const pockets: Hole[] = [];
  for (let x = bx1 + 0.5; x < xj - 0.3; x += 0.8 + rnd() * 0.2) {
    pockets.push({ u0: x - 0.11, u1: x + 0.11, y0: 2.47, y1: 2.74 });
  }
  rubbleFace(sb, {
    s: "-z",
    at: zN - h2,
    u0: xW,
    u1: xE - h2,
    courses: north,
    extent: (c1) => [xW, c1 > 1.8 + 1e-6 ? xj : xE - h2],
    holes: [{ u0: bx0 - 0.01, u1: bx1 + 0.01, y0: -1, y1: 6 }, ...pockets],
    soot,
    ground: along(zN - h2),
  }, rnd);
  for (const pk of pockets) {
    if (rnd() < 0.45) continue;
    const len = 0.12 + rnd() * 0.45;
    b.box(0.16, 0.22, len + 0.06, (pk.u0 + pk.u1) / 2, 2.6, zN - h2 - len / 2 + 0.03, TIMBER, { x: (rnd() - 0.5) * 0.08 });
  }
  rubbleTeeth(sb, true, zN, t, xW, -1, north, rnd);
  rubbleTeeth(sb, true, zN, t, xj, 1, north.slice(low.length), rnd);
  ivy(sb, "+z", zN + h2, xW + (xj - xW) * (0.3 + rnd() * 0.4), 1.4, 3.0, along(zN + h2), rnd);

  // ---- the east gable, with the window blocked long before the fire.
  const zw = d * 0.14;
  const win = d * 0.72 > 2.6;
  rubbleFace(sb, {
    s: "+x",
    at: xE + h2,
    u0: eS,
    u1: zN,
    courses: east,
    cut: (k) => (k < low.length ? neE(k) : []),
    holes: win
      ? [
          { u0: zw - 0.65, u1: zw + 0.65, y0: 1.95, y1: 2.2 },
          { u0: zw - 0.6, u1: zw + 0.6, y0: 0.95, y1: 1.95 },
          { u0: zw - 0.5, u1: zw + 0.5, y0: 0.87, y1: 0.95 },
        ]
      : [],
    ground: across(xE + h2),
  }, rnd);
  rubbleFace(sb, {
    s: "-x",
    at: xE - h2,
    u0: eS,
    u1: zN - h2,
    courses: east,
    holes: win
      ? [
          { u0: zw - 0.7, u1: zw + 0.7, y0: 1.95, y1: 2.15 },
          { u0: zw - 0.45, u1: zw + 0.45, y0: 0.95, y1: 1.95 },
        ]
      : [],
    soot,
    ground: across(xE - h2),
  }, rnd);
  if (win) {
    const po = pl("+x", xE + h2);
    onFace(b, "+x", po, zw, 0.91, 1.0, 0.08, 0.14, 0.05, STONE);
    for (const sg of [-1, 1]) {
      for (let i = 0; i < 3; i++) onFace(b, "+x", po, zw + sg * 0.5, 0.95 + (i + 0.5) / 3, 0.19, 1 / 3 - 0.012, 0.1, -0.015, STONE);
    }
    onFace(b, "+x", po, zw, 2.075, 1.28, 0.24, 0.1, -0.015, STONE);
    rubbleFace(sb, { s: "+x", at: xE + h2, u0: zw - 0.4, u1: zw + 0.4, courses: rubbleCourses(0.95, 1.95, rnd, 0.11, 0.06), small: true }, rnd);
    onFace(b, "-x", pl("-x", xE - h2), zw, 2.05, 1.4, 0.2, 0.12, 0.02, TIMBER);
    rubbleFace(sb, { s: "-x", at: xE - h2, u0: zw - 0.45, u1: zw + 0.45, courses: rubbleCourses(0.95, 1.95, rnd, 0.11, 0.06), small: true, soot }, rnd);
  }
  rubbleTeeth(sb, false, xE, t, eS, -1, east, rnd);
  rubbleTeeth(sb, false, xE, t, zN, 1, east.slice(low.length), rnd);

  // ---- the west stub.
  rubbleFace(sb, { s: "-x", at: xW - h2, u0: wS, u1: wN, courses: west, ground: across(xW - h2) }, rnd);
  rubbleFace(sb, { s: "+x", at: xW + h2, u0: wS, u1: wN, courses: west, soot, ground: across(xW + h2) }, rnd);
  rubbleTeeth(sb, false, xW, t, wS, -1, west, rnd);
  rubbleTeeth(sb, false, xW, t, wN, 1, west, rnd);

  // ---- the south front: the doorway's one jamb still dressed, the wall past
  // it down to its footing, and the far stretch broken off at both ends.
  const jOut = dressedEdge(sb, "-z", zS - h2, jamb, -1, south, 0, 0.4, 0.22);
  const jIn = dressedEdge(sb, "+z", zS + h2, jamb, -1, south, 1, 0.4, 0.22);
  for (const [c0, c1] of south) onFace(b, "+x", pl("+x", jamb), zS, (c0 + c1) / 2, t + 0.07, c1 - c0 - 0.012, 0.1, -0.03, STONE);
  for (const y of [0.35, 1.15]) onFace(b, "+x", pl("+x", jamb), zS - h2 + 0.09, y, 0.035, 0.035, 0.1, 0.05, IRON);
  for (const sx of [-1, 1]) {
    const [x0, x1] = sx < 0 ? [xW, jamb] : [sIn, xE];
    rubbleFace(sb, { s: "-z", at: zS - h2, u0: x0, u1: x1, courses: south, cut: sx < 0 ? jOut : undefined, ground: along(zS - h2) }, rnd);
    rubbleFace(sb, { s: "+z", at: zS + h2, u0: x0, u1: x1, courses: south, cut: sx < 0 ? jIn : undefined, soot, ground: along(zS + h2) }, rnd);
  }
  rubbleTeeth(sb, true, zS, t, xW, -1, south, rnd);
  rubbleTeeth(sb, true, zS, t, sIn, -1, south, rnd);
  rubbleTeeth(sb, true, zS, t, xE, 1, south, rnd);
  {
    const x = jamb + dw / 2;
    b.box(dw, 0.1, t + 0.06, x, ground(x, zS) + 0.03, zS, STONE);
    b.box(dw + 0.2, 0.08, 0.36, x, ground(x, zS - h2 - 0.2) - 0.01, zS - h2 - 0.2, STONE);
  }

  // ---- the chimney breast: rubble to the eaves round a fireplace, ashlar
  // above them, capped and potted.
  const fh = 1.1;
  const breastSoot = (u: number, y: number): number =>
    soot(u, y) + (y > fh + 0.3 ? 0.8 * Math.max(0, 1 - Math.abs(u - xc) / (0.9 - (y - fh - 0.3) * 0.2)) : 0);
  rubbleFace(sb, {
    s: "-z",
    at: bz0,
    u0: bx0,
    u1: bx1,
    courses: breast,
    holes: [
      { u0: xc - 0.85, u1: xc + 0.85, y0: fh, y1: fh + 0.3 },
      { u0: xc - 0.75, u1: xc + 0.75, y0: -1, y1: fh },
    ],
    soot: breastSoot,
    ground: along(bz0),
  }, rnd);
  rubbleFace(sb, { s: "-x", at: bx0, u0: bz0, u1: zN - h2, courses: breast, soot, ground: across(bx0) }, rnd);
  rubbleFace(sb, { s: "+x", at: bx1, u0: bz0, u1: zN - h2, courses: breast, soot, ground: across(bx1) }, rnd);
  {
    const ff = pl("-z", bz0);
    const gf = ground(xc, bz0 - 0.3);
    onFace(b, "-z", ff, xc, (fh + gf) / 2, 1.0, fh - gf, 0.02, 0, CASEMENT);
    for (const sg of [-1, 1]) {
      for (let i = 0; i < 3; i++) onFace(b, "-z", ff, xc + sg * 0.625, ((i + 0.5) * fh) / 3, 0.24, fh / 3 - 0.012, 0.12, -0.01, STONE);
    }
    onFace(b, "-z", ff, xc, fh + 0.15, 1.7, 0.3, 0.18, -0.01, TIMBER);
    // The crane: a pivot bar at one jamb, its arm and brace, and the pot on its hook.
    onFace(b, "-z", ff, xc - 0.4, 0.62, 0.035, 0.9, 0.035, 0.07, IRON);
    onFace(b, "-z", ff, xc - 0.1, 0.98, 0.62, 0.035, 0.035, 0.07, IRON);
    onFace(b, "-z", ff, xc - 0.25, 0.84, 0.36, 0.03, 0.03, 0.07, IRON, 0.6);
    onFace(b, "-z", ff, xc + 0.12, 0.83, 0.02, 0.3, 0.02, 0.07, IRON);
    b.cyl(0.24, 0.3, 0.22, 10, xc + 0.12, 0.56, bz0 - 0.2, IRON);
    b.box(1.6, 0.06, 0.6, xc, gf + 0.02, bz0 - 0.3, STONE);
  }
  const stackSoot = (y: number): number => Math.max(0, (y - 4.5) / 0.7) * 0.6;
  ashlarFace(sb, "-z", bz0, bx0, bx1, 3.4, 5.2, rnd, stackSoot);
  ashlarFace(sb, "+z", bz1, bx0, bx1, 3.4, 5.2, rnd, stackSoot);
  ashlarFace(sb, "-x", bx0, bz0, bz1, 3.4, 5.2, rnd, stackSoot);
  ashlarFace(sb, "+x", bx1, bz0, bz1, 3.4, 5.2, rnd, stackSoot);
  onFace(b, "-z", pl("-z", bz0), xc, 3.4, 2.12, 0.1, 0.08, 0.04, STONE);
  for (const [s, at] of [["-x", bx0], ["+x", bx1]] as const) onFace(b, s, pl(s, at), (bz0 - 0.06 + zN - h2) / 2, 3.4, zN - h2 - bz0 + 0.06, 0.1, 0.08, 0.04, STONE);
  b.box(2.12, 0.12, 1.52, xc, 5.26, zc, STONE);
  b.box(2.24, 0.1, 1.64, xc, 5.37, zc, STONE);
  b.box(1.7, 0.08, 1.05, xc, 5.46, zc, DARK_STONE);
  for (const [i, dx] of [-0.45, 0.45].entries()) {
    const hp = i === 0 ? 0.55 : 0.2 + rnd() * 0.12;
    b.cyl(hp, i === 0 ? 0.26 : 0.3, 0.32, 10, xc + dx, 5.5 + hp / 2, zc, BRICK);
    if (i === 0) b.cyl(0.06, 0.32, 0.32, 10, xc + dx, 5.5 + hp - 0.03, zc, BRICK);
    b.cyl(0.02, 0.2, 0.2, 10, xc + dx, 5.5 + hp, zc, CASEMENT);
  }

  // ---- the heads, broken along a slow wave; the north front's staircase
  // down to the low wall stands on the low wall's head.
  const wave = (a: number, f: number): ((u: number) => number) => {
    const ph = rnd() * 6.3;
    return (u) => a * (0.5 + 0.5 * Math.sin(u * f + ph)) + 0.25 * Math.sin(u * 3.1 + ph * 2);
  };
  const nLow = wave(0.9, 1.3);
  rubbleHead(sb, true, zN, xW, xj, 3.4, t, wave(2.2, 0.9), rnd);
  rubbleHead(sb, true, zN, xj, xE + h2, 1.8, t, (u) => Math.max(nLow(u), 2.6 * (1 - (u - xj) / 1.5)), rnd);
  rubbleHead(sb, false, xE, eS, zN, 2.7, t, wave(1.8, 1.1), rnd);
  rubbleHead(sb, false, xW, wS, wN, 1.2, t, wave(1.3, 1.2), rnd);
  rubbleHead(sb, true, zS, xW, jamb, 1.5, t, wave(1.2, 1.4), rnd);
  rubbleHead(sb, true, zS, sIn, xE, 1.5, t, wave(1.2, 1.4), rnd);

  // ---- the footings where a wall has gone, and what fell off the breaks.
  rubbleFooting(sb, false, xW, t, zS + h2, wS, across(xW), rnd);
  rubbleFooting(sb, false, xW, t, wN, zN - h2, across(xW), rnd);
  rubbleFooting(sb, false, xE, t, zS + h2, eS, across(xE), rnd);
  rubbleFooting(sb, true, zS, t, jamb + dw + 0.03, sIn, along(zS), rnd);
  rubbleScatter(sb, xE + 0.7, eS - 0.4, 0.8, 6, ground, rnd);
  rubbleScatter(sb, xW - 0.7, zN - 0.3, 0.8, 6, ground, rnd);
  rubbleScatter(sb, 0, zS - 0.8, 1.0, 5, ground, rnd);

  // ---- what came down inside: the two heaps, a purlin from the larger across
  // the room, a rafter leaning on the east head, and the door where it fell.
  rubbleHeap(b, sb, w * 0.22, -d * 0.2, 1.2, 1.0, 0.7, ground, rnd);
  rubbleHeap(b, sb, -w * 0.28, d * 0.22, 0.9, 0.8, 0.6, ground, rnd);
  {
    const [cx, cz] = [w * 0.22, -d * 0.2];
    const [tx, tz] = [cx - 2.9, cz + 2.0];
    slab(b, [cx - 0.7, 0.86, cz + 0.5], [tx, ground(tx, tz) + 0.12, tz], 0.22, 0.24, TIMBER);
    const zr = d * 0.3;
    const fx = xE - h2 - 0.55;
    slab(b, [fx, ground(fx, zr - 0.25), zr - 0.25], [xE - h2 + 0.06, 2.78, zr + 0.1], 0.1, 0.14, TIMBER);
  }
  {
    const cx = jamb + dw / 2 + 0.2;
    const cz = zS + h2 + 1.2;
    const a = 0.5 + rnd() * 0.4;
    const g = ground(cx, cz);
    const [ca, sa] = [Math.cos(a), Math.sin(a)];
    for (let i = 0; i < 4; i++) {
      const o = (i - 1.5) * 0.21;
      const l = i === 3 ? 1.35 : 1.75;
      b.box(0.2, 0.035, l, cx + o * ca + ((1.75 - l) / 2) * sa, g + 0.02, cz - o * sa + ((1.75 - l) / 2) * ca, PLANK, { y: a });
    }
    for (const o of [-0.55, 0.55]) b.box(0.8, 0.03, 0.14, cx + o * sa, g + 0.05, cz + o * ca, TIMBER, { y: a });
  }

  // ---- the cores, set back behind every face, emitted after what hides them.
  sb.flush(b);
  const gMin = (...pts: [number, number][]): number => Math.min(0, ...pts.map(([x, z]) => ground(x, z))) - 0.06;
  const core = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void => {
    b.box(x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, DARK_STONE);
  };
  const [n0, n1] = [zN - h2 + RUBBLE_BACK, zN + h2 - RUBBLE_BACK];
  core(xW, xj, gMin([xW, zN], [xj, zN]), 3.4, n0, n1);
  core(xj, xE + h2 - RUBBLE_BACK, gMin([xj, zN], [xE, zN]), 1.8, n0, n1);
  const [e0, e1] = [xE - h2 + RUBBLE_BACK, xE + h2 - RUBBLE_BACK];
  core(e0, e1, gMin([xE, eS], [xE, zN]), 2.7, eS, zN);
  core(xW - h2 + RUBBLE_BACK, xW + h2 - RUBBLE_BACK, gMin([xW, wS], [xW, wN]), 1.2, wS, wN);
  const [s0, s1] = [zS - h2 + RUBBLE_BACK, zS + h2 - RUBBLE_BACK];
  core(xW, jamb, gMin([xW, zS], [jamb, zS]), 1.5, s0, s1);
  core(sIn, xE, gMin([sIn, zS], [xE, zS]), 1.5, s0, s1);
  core(bx0 + RUBBLE_BACK, bx1 - RUBBLE_BACK, gMin([bx0, bz0], [bx1, bz0]), 3.4, bz0 + RUBBLE_BACK, zN - h2);
  core(bx0 + 0.03, bx1 - 0.03, 3.4, 5.2, bz0 + 0.03, bz1 - 0.03);
  return b;
}
