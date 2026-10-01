/**
 * kit/buildings/render.ts — The jungle ruin's drawing: brick under lime render,
 * spalled where it has come away, the broken wall heads, the toothing and the
 * quoins — the words `buildJungleRuin` is drawn in.
 * Invariants: VISUAL only — the block at the top of `buildJungleRuin` is every
 * collider the ruin has, and nothing here may add one.
 */
import {
  Build,
  carve,
  onFace,
  outward,
  type Hole,
  type Side,
  BRICK,
  CREEPER,
  MOSS_STONE,
  PLASTER,
  STUCCO,
} from "../core";

// The words the ruin is drawn in. Everything they make is VISUAL: the block at
// the top of `buildJungleRuin` is every collider the ruin has, and nothing
// here may add one.

/**
 * Brick in the body of a wall, and so the colour a joint reads as wherever the
 * render has come away. A step darker than `BRICK`, which is what the courses
 * laid over it are drawn in: the core is only ever seen BETWEEN bricks, or in
 * the shadowed end of a break, and at `BRICK` a spall read as a flat red patch
 * with nothing in it.
 */
export const RUIN_CORE = "#46332d";
/**
 * The floor, in two firings laid as a checker: the one thing inside the walls
 * that says this was a house somebody furnished rather than a shed. Both are
 * dark for the reason every up-facing colour in the kit is — the sky term
 * lifts a floor a stop and a half — and the pair differ in HUE far more than
 * in value, so the checker is a pattern you find when you look down and not a
 * chessboard across the room.
 */
export const TILE = "#5b4536";
export const TILE_SLATE = "#4a4c46";

/** One course of brick. Every head, tooth and exposed patch is laid in it. */
export const COURSE = 0.075;
const BRICK_LEN = 0.23;
/**
 * How deep the render is, and so the step a spall reads by. The ink finds an
 * edge where depth steps, and a patch of brick flush with the stucco round it
 * is a stain; three and a half centimetres is a hole in the plaster.
 */
export const RENDER_T = 0.035;
/** How far the render's face stands proud of the collider's. */
const RENDER_PROUD = 0.01;
/** How far the brick core's face stands BEHIND the collider's. */
export const CORE_BACK = RENDER_T - RENDER_PROUD;

/**
 * One lobe of a patch of lost render: an ellipse in the face's (u, y), leaning
 * by `tilt` (metres of rise per metre along). A patch is two or three lobes
 * overlapping, which is what keeps its outline from being an ellipse drawn in
 * steps — the thing that made the first cut of this read as pixel art.
 */
export interface Spall {
  u: number;
  y: number;
  hu: number;
  hy: number;
  tilt: number;
  /**
   * Where the torn edge's own waviness starts, below and above. The edge is a
   * slow wave along the face with a little noise on it, so neighbouring strips
   * agree about where the render broke: independent noise per strip reads as
   * a staircase, which is what made the first cut look like pixel art.
   */
  lo: number;
  hi: number;
}

/** A patch of lost render round (u, y): a main lobe and one or two satellites. */
export function patch(u: number, y: number, hu: number, hy: number, rnd: () => number): Spall[] {
  const tilt = (rnd() - 0.5) * 0.5;
  const out: Spall[] = [{ u, y, hu, hy, tilt, lo: rnd() * 6.3, hi: rnd() * 6.3 }];
  const n = rnd() < 0.7 ? 1 : 2;
  for (let i = 0; i < n; i++) {
    out.push({
      u: u + (rnd() - 0.5) * hu * 1.4,
      y: y + (rnd() - 0.5) * hy * 1.2,
      // Never narrower than a couple of strips: a lobe one strip wide is a
      // rectangle of brick, which reads as a window bricked up.
      hu: Math.max(0.2, hu * (0.45 + rnd() * 0.3)),
      hy: hy * (0.35 + rnd() * 0.3),
      tilt: tilt + (rnd() - 0.5) * 0.4,
      lo: rnd() * 6.3,
      hi: rnd() * 6.3,
    });
  }
  return out;
}

/** One rendered face of a standing wall, and what is cut out of it. */
export interface RenderFace {
  s: Side;
  /** The collider's face, as a signed coordinate on the side's own axis. */
  at: number;
  u0: number;
  u1: number;
  y0: number;
  /** The wall head, which is the collider's top. */
  top: number;
  /** Exact openings — a window, a door, a joist pocket, a lintel. */
  holes: Hole[];
  spalls: Spall[];
  /**
   * How far short of the head the render may stop: a broken head loses it.
   * At 0.06 or under the head is treated as whole, and unbroken render is
   * painted as one run rather than strip by strip.
   */
  fray: number;
  /** An inside face: painted darker below this line, with a moulding on it. */
  dado?: number;
  /** An outside face: a raised band of render along its foot. */
  skirting?: boolean;
  /** An outside face: the green-black runs a wet season leaves under a head. */
  streaks?: boolean;
}

/**
 * Up to `n` patches of lost render on a face, kept clear of `avoid` — the
 * mouldings, which would otherwise stand in front of bare brick.
 */
export function spallsOn(
  f: { u0: number; u1: number; y0: number; top: number },
  n: number,
  rnd: () => number,
  avoid: Hole[],
): Spall[] {
  const out: Spall[] = [];
  let placed = 0;
  for (let i = 0; i < n * 4 && placed < n; i++) {
    const hu = 0.18 + rnd() * 0.32;
    const hy = 0.14 + rnd() * 0.24;
    if (f.u1 - f.u0 < hu * 2 || f.top - f.y0 < hy * 2 + 0.2) continue;
    const u = f.u0 + hu + rnd() * (f.u1 - f.u0 - hu * 2);
    const y = f.y0 + 0.1 + hy + rnd() * (f.top - f.y0 - 0.2 - hy * 2);
    const m = 1.4;
    const clash = avoid.some(
      (a) => u + hu * m > a.u0 && u - hu * m < a.u1 && y + hy * m > a.y0 && y - hy * m < a.y1,
    );
    if (clash) continue;
    out.push(...patch(u, y, hu, hy, rnd));
    placed++;
  }
  return out;
}

/**
 * The render on one face: vertical strips of uneven width, each carved round
 * the openings exactly and round the spalls raggedly — a spall's extent is
 * jittered per strip, so its edge is a torn outline rather than a curve, and
 * the head of a broken wall has lost its render to a different depth in every
 * strip. Strips nothing touches are painted as one run.
 *
 * What the render has lost shows the brick under it, laid a course at a time
 * across the whole face rather than strip by strip, so the bond runs on under
 * a strip's edge and a brick is only cut where the render still covers it.
 */
export function renderFace(b: Build, f: RenderFace, rnd: () => number): void {
  const plane = outward(f.s) * f.at;
  const skinOut = RENDER_PROUD - RENDER_T / 2;
  const whole = f.fray <= 0.06;
  const bare: [number, number, number, number][] = [];

  const paint = (ua: number, ub: number, p0: number, p1: number): void => {
    const um = (ua + ub) / 2;
    const sw = ub - ua + 0.002;
    const coat = (y0: number, y1: number, color: string): void =>
      onFace(b, f.s, plane, um, (y0 + y1) / 2, sw, y1 - y0, RENDER_T, skinOut, color);
    const dado = f.dado;
    if (dado !== undefined && p0 < dado - 0.03 && p1 > dado + 0.03) {
      coat(p0, dado, PLASTER);
      coat(dado, p1, STUCCO);
      onFace(b, f.s, plane, um, dado, sw, 0.05, 0.02, RENDER_PROUD + 0.006, STUCCO);
    } else {
      coat(p0, p1, dado !== undefined && p1 <= dado + 0.03 ? PLASTER : STUCCO);
    }
  };
  const skirt = (ua: number, ub: number, p1: number): void => {
    if (!f.skirting) return;
    const sk = Math.min(0.26, p1 - f.y0);
    onFace(b, f.s, plane, (ua + ub) / 2, f.y0 + sk / 2, ub - ua + 0.002, sk, 0.03, RENDER_PROUD + 0.004, STUCCO);
  };
  const streak = (ua: number, ub: number, p0: number, p1: number): void => {
    if (!f.streaks) return;
    const len = Math.min((p1 - p0) * 0.85, 0.35 + rnd() * 1.3);
    if (len < 0.2) return;
    const su = ua + (0.2 + rnd() * 0.6) * (ub - ua);
    onFace(b, f.s, plane, su, p1 - len / 2 - 0.02, 0.025 + rnd() * 0.035, len, 0.004, RENDER_PROUD + 0.002, MOSS_STONE);
  };

  /** Plain strips waiting to be painted as one. */
  let run: [number, number] | null = null;
  const flush = (): void => {
    if (!run) return;
    const [ua, ub] = run;
    const tp = f.top - f.fray * 0.5;
    paint(ua, ub, f.y0, tp);
    skirt(ua, ub, tp);
    for (let su = ua; su < ub - 0.1; su += 0.3) if (rnd() < 0.24) streak(su, Math.min(su + 0.3, ub), f.y0, tp);
    run = null;
  };

  const edges = [f.u0, f.u1];
  for (const h of f.holes) {
    for (const u of [h.u0, h.u1]) if (u > f.u0 + 0.02 && u < f.u1 - 0.02) edges.push(u);
  }
  edges.sort((a, c) => a - c);
  for (let e = 0; e + 1 < edges.length; e++) {
    const a = edges[e];
    const c = edges[e + 1];
    if (c - a < 0.02) continue;
    // Strips of uneven width: a hand to a forearm, the last one split if wide.
    const cuts = [a];
    const [lo, span] = whole ? [0.14, 0.26] : [0.22, 0.3];
    for (let u = a; c - u > lo + span + 0.1; ) {
      u += lo + rnd() * span;
      cuts.push(u);
    }
    const last = cuts[cuts.length - 1];
    if (c - last > lo + span) cuts.push((last + c) / 2);
    cuts.push(c);
    for (let i = 0; i + 1 < cuts.length; i++) {
      const ua = cuts[i];
      const ub = cuts[i + 1];
      const um = (ua + ub) / 2;
      const holes: [number, number][] = [];
      for (const h of f.holes) if (um > h.u0 && um < h.u1) holes.push([h.y0, h.y1]);
      const lost: [number, number][] = [];
      for (const sp of f.spalls) {
        const q = (um - sp.u) / sp.hu;
        if (Math.abs(q) >= 1) continue;
        const ext = sp.hy * Math.sqrt(1 - q * q);
        const yc = sp.y + (um - sp.u) * sp.tilt;
        const wave = (ph: number): number => 0.85 + 0.25 * Math.sin(um * 8.5 + ph) + 0.12 * Math.sin(um * 23 + ph * 2) + 0.1 * (rnd() - 0.5);
        const lo = yc - ext * wave(sp.lo);
        const hi = yc + ext * wave(sp.hi);
        if (hi - lo > 0.06) lost.push([lo, hi]);
      }
      if (whole && holes.length === 0 && lost.length === 0) {
        run = run ? [run[0], ub] : [ua, ub];
        continue;
      }
      flush();
      const top = f.top - f.fray * rnd();
      const pieces = carve(f.y0, top, [...holes, ...lost]).filter(([p0, p1]) => p1 - p0 > 0.03);
      for (const [p0, p1] of pieces) paint(ua, ub, p0, p1);
      if (pieces.length && pieces[0][0] <= f.y0 + 1e-6) skirt(ua, ub, pieces[0][1]);
      if (pieces.length && rnd() < 0.24) streak(ua, ub, ...pieces[pieces.length - 1]);
      for (const [s0, s1] of carve(f.y0, top, holes)) {
        for (const [g0, g1] of carve(s0, s1, pieces)) if (g1 - g0 > 0.05) bare.push([ua, ub, g0, g1]);
      }
    }
    flush();
  }

  // The brick, one course at a time across the whole face.
  const out = -CORE_BACK + 0.005;
  const courses = Math.floor((f.top - f.y0) / COURSE + 1e-6);
  for (let k = 0; k < courses; k++) {
    const c0 = f.y0 + k * COURSE;
    const c1 = c0 + COURSE;
    const spans = bare
      .filter((r) => r[2] <= c0 + 0.02 && r[3] >= c1 - 0.02)
      .map((r): [number, number] => [r[0], r[1]])
      .sort((p, q) => p[0] - q[0]);
    const merged: [number, number][] = [];
    for (const s of spans) {
      const prev = merged[merged.length - 1];
      if (prev && s[0] <= prev[1] + 1e-4) prev[1] = Math.max(prev[1], s[1]);
      else merged.push([s[0], s[1]]);
    }
    const off = ((k & 1) * BRICK_LEN) / 2;
    const y = c0 + COURSE / 2;
    for (const [ua, ub] of merged) {
      for (let j = Math.floor((ua - off) / BRICK_LEN); off + j * BRICK_LEN < ub; j++) {
        const s0 = Math.max(ua, off + j * BRICK_LEN + 0.006);
        const s1 = Math.min(ub, off + (j + 1) * BRICK_LEN - 0.006);
        if (s1 - s0 > 0.04) onFace(b, f.s, plane, (s0 + s1) / 2, y, s1 - s0, COURSE - 0.014, 0.01, out, BRICK);
      }
    }
  }
}

/** One stretch of a wall head as it was drawn, for whatever grows on it. */
export interface HeadSeg {
  u0: number;
  u1: number;
  top: number;
}

/**
 * The top of a wall, laid in short stretches of brick a course or several
 * high, so a broken head is a stepped, torn edge rather than a ruled line —
 * and a coping of render, where one survives, on the head that was the eave.
 * `courses` is how high the broken masonry stands at a point along the run;
 * it is rounded with some noise, so two stretches side by side rarely agree.
 */
export function wallHead(
  b: Build,
  alongX: boolean,
  c: number,
  u0: number,
  u1: number,
  y: number,
  width: number,
  courses: (u: number) => number,
  rnd: () => number,
  o: { mossy?: number; coping?: (u: number) => boolean; grown?: [number, number][] } = {},
): HeadSeg[] {
  const segs: HeadSeg[] = [];
  const put = (len: number, hh: number, um: number, yc: number, wd: number, color: string): void => {
    if (alongX) b.box(len, hh, wd, um, yc, c, color);
    else b.box(wd, hh, len, c, yc, um, color);
  };
  let u = u0;
  while (u < u1 - 0.02) {
    const len = Math.min(u1 - u, 0.22 + rnd() * 0.4);
    const um = u + len / 2;
    let top = y;
    if (o.coping?.(um)) {
      put(len + 0.003, 0.07, um, y + 0.035, width + 0.11, STUCCO);
      top = y + 0.07;
    } else {
      const k = Math.max(0, Math.round(courses(um) + (rnd() - 0.5) * 1.4));
      if (k > 0) {
        put(len + 0.003, k * COURSE, um, y + (k * COURSE) / 2, width, BRICK);
        top = y + k * COURSE;
      }
    }
    const grown = o.grown?.some(([g0, g1]) => um > g0 && um < g1) ?? false;
    if (grown) {
      put(len + 0.02, 0.09, um, top + 0.035, width + 0.16, CREEPER);
      top += 0.08;
    } else if (rnd() < (o.mossy ?? 0.3)) {
      put(len * (0.5 + rnd() * 0.4), 0.025, um, top + 0.01, width * 0.8, CREEPER);
    } else if (rnd() < 0.12) {
      const [bx, bz] = alongX ? [um, c + (rnd() - 0.5) * 0.2] : [c + (rnd() - 0.5) * 0.2, um];
      b.box(BRICK_LEN, 0.065, 0.11, bx, top + 0.03, bz, BRICK, { y: rnd() * Math.PI, z: (rnd() - 0.5) * 0.3 });
    }
    segs.push({ u0: u, u1: u + len, top });
    u += len;
  }
  return segs;
}

/**
 * The free end of a broken wall: every other pair of courses runs on half a
 * brick past the break, the way a wall comes apart along its bond. The
 * collider's end is square and these stand past it, which is the honest side
 * of the trade: a round aimed at a tooth passes.
 */
export function toothing(
  b: Build,
  alongX: boolean,
  c: number,
  uEnd: number,
  dir: 1 | -1,
  y0: number,
  y1: number,
  width: number,
  rnd: () => number,
): void {
  const band = COURSE * 2;
  for (let i = 0, y = y0; y < y1 - 0.02; i++, y += band) {
    const hh = Math.min(band, y1 - y) - 0.006;
    const reach = (i % 2 === 0 ? BRICK_LEN / 2 : 0) + (rnd() < 0.3 ? 0.06 : 0);
    if (reach < 0.03 || hh < 0.03) continue;
    const u = uEnd + (dir * reach) / 2;
    if (alongX) b.box(reach, hh, width, u, y + hh / 2, c, BRICK);
    else b.box(width, hh, reach, c, y + hh / 2, u, BRICK);
  }
}

/** One face of a corner the quoins are laid on. */
interface QuoinFace {
  s: Side;
  plane: number;
  /** The arris, in this face's u. */
  corner: number;
  /** Which way along the face is away from the arris. */
  dir: 1 | -1;
  /** The longest block this face has room for. */
  max: number;
}

/**
 * Raised render blocks up a corner, long and short in turn on each face and
 * crossed at the arris — the one ornament a house like this has at a distance,
 * and what says this corner was a CORNER and not a break.
 */
export function quoins(b: Build, a: QuoinFace, c: QuoinFace, y0: number, y1: number): void {
  const QH = 0.3;
  for (let i = 0, y = y0; y + QH <= y1 + 1e-6; i++, y += QH) {
    for (const [f, long] of [
      [a, i % 2 === 0],
      [c, i % 2 !== 0],
    ] as const) {
      const len = Math.min(long ? 0.52 : 0.3, f.max);
      onFace(b, f.s, f.plane, f.corner + (f.dir * (len - 0.03)) / 2, y + QH / 2, len + 0.03, QH - 0.03, 0.03, RENDER_PROUD + 0.012, STUCCO);
    }
  }
}
