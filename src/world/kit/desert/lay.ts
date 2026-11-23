/**
 * kit/desert/lay.ts — The drawing's words the desert set's detailed
 * buildings share: an elevation's points and outlines (`fp`, `fdir`, `slabOn`, `pointed`,
 * `above`); the arch ring and its striped `ring`, the star, square kufic,
 * the blind bay, the stepped merlons, a parapet's pierced `triangles` and the
 * pocks and a pasted `poster`; a wall's `socle` and its dog-tooth `cornice`; render, stains
 * and water (`spall` over a `Bond`, `blob`, `within`, `spout` and its `streak`); a `lobe` laid on a level
 * surface; and a `ragged` outline for a hole or a burn. It RE-EXPORTS what
 * kit/core.ts holds for every set: `Lay`, the one batch a building's drawing
 * is laid into, the round solids (`band`, `disc`, `drum`, and a dome's
 * `domeProfile` laid in `courses`) and round members on any axis (`log`,
 * `eye`, and a bar, `rod`). Part of the
 * desert-town set: follows the contract in kit/core.ts
 * and the set's rules in `./index.ts`. Invariants: VISUAL only — nothing here
 * declares a collider; every face is planar, as the cel shader's per-facet
 * light needs. Never builds a building, and never imports one.
 */
import {
  AWNING,
  IRON,
  Mesher,
  archArc,
  hideBack,
  outward,
  runsAlongX,
  type Side,
  type V3,
} from "../core";
import { MUDBRICK, MUDBRICK_DARK, PALM_BEAM, PLINTH, SCORCH, WHITEWASH, WINDOW_VOID } from "./shared";
import { HIDE_DOWN, Lay, TAU } from "../core";

// The round solids, the bars and the batch live in core.ts, which the
// structures set shares them from; the set's builders still name them here.
export { HIDE_DOWN, Lay, NO_ENDS, TAU, band, courses, disc, domeProfile, drum, eye, log, rod } from "../core";

/** The face looking the other way across the same wall. */
export const opp = (s: Side): Side => (s === "-z" ? "+z" : s === "+z" ? "-z" : s === "-x" ? "+x" : "-x");

/** A point on an elevation: `u` along it, `y` up it, `out` past its plane. */
export function fp(s: Side, plane: number, u: number, y: number, out: number): V3 {
  const c = outward(s) * (plane + out);
  return runsAlongX(s) ? [u, y, c] : [c, y, u];
}

/** A direction on an elevation, in the same three terms. */
export function fdir(s: Side, du: number, dy: number, dout: number): V3 {
  return runsAlongX(s) ? [du, dy, outward(s) * dout] : [outward(s) * dout, dy, du];
}

/**
 * An outline in an elevation's `(u, y)` laid on it from `out0` to `out1`:
 * its front face and every edge's side, and its back when it is seen from
 * both (a spandrel standing in an arcade). The outline must be STAR-SHAPED
 * from its first point, which is what it is fanned from — a convex one is,
 * and so is a spandrel walked from its outer top corner.
 */
export function slabOn(
  lay: Lay,
  s: Side,
  plane: number,
  pts: readonly (readonly [number, number])[],
  out0: number,
  out1: number,
  color: string,
  back = false,
): void {
  const m = lay.m(color);
  const n = pts.length;
  const f = pts.map(([u, y]) => fp(s, plane, u, y, out1));
  const r = pts.map(([u, y]) => fp(s, plane, u, y, out0));
  const fwd = fdir(s, 0, 0, 1);
  const bwd = fdir(s, 0, 0, -1);
  for (let i = 1; i + 1 < n; i++) {
    m.tri(f[0], f[i], f[i + 1], fwd);
    if (back) m.tri(r[0], r[i], r[i + 1], bwd);
  }
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  const sign = area > 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const du = pts[j][0] - pts[i][0];
    const dy = pts[j][1] - pts[i][1];
    m.quad(r[i], r[j], f[j], f[i], fdir(s, sign * dy, -sign * du, 0));
  }
}

/**
 * A pointed opening's outline, walked anticlockwise from its left sill
 * corner: the jambs to `spring` over the sill, then the two arcs of
 * `archArc` to the apex. Convex, so it is any `slabOn`'s.
 */
export function pointed(u: number, sill: number, span: number, spring: number, rise: number, n = 5): [number, number][] {
  const left = archArc(u, sill + spring, span, rise, 0, n);
  const pts: [number, number][] = [
    [u - span / 2, sill],
    [u + span / 2, sill],
  ];
  for (const [lu, ly] of left) pts.push([2 * u - lu, ly]);
  for (let i = left.length - 2; i >= 0; i--) pts.push(left[i]);
  return pts;
}

/** The part of a convex outline above `y`: a tympanum over a flat lintel. */
export function above(pts: readonly [number, number][], y: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (a[1] >= y) out.push(a);
    if (a[1] >= y !== b[1] >= y) {
      const t = (y - a[1]) / (b[1] - a[1]);
      out.push([a[0] + (b[0] - a[0]) * t, y]);
    }
  }
  return out;
}

/** Folds a lean into (-90°, 90°], which is what a member's tilt means. */
const lean = (a: number): number => (a > Math.PI / 2 ? a - Math.PI : a <= -Math.PI / 2 ? a + Math.PI : a);

/**
 * The ring of an arch, laid as stones along both arcs: a pointed frame round
 * a recess or an opening. It sits OUTSIDE the arc it is struck on (`grow` is
 * half its width), so it never narrows the opening it frames.
 */
export function archRing(
  lay: Lay,
  s: Side,
  plane: number,
  u: number,
  ys: number,
  span: number,
  rise: number,
  width: number,
  thick: number,
  out: number,
  color: string,
): void {
  const pts = archArc(u, ys, span, rise, width / 2, 4);
  for (const k of [-1, 1]) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ua, ya] = pts[i];
      const [ub, yb] = pts[i + 1];
      const u0 = k < 0 ? ua : 2 * u - ua;
      const u1 = k < 0 ? ub : 2 * u - ub;
      lay.sb.onFace(s, plane, (u0 + u1) / 2, (ya + yb) / 2, Math.hypot(u1 - u0, yb - ya) + 0.04, width, thick, out, color, lean(Math.atan2(yb - ya, u1 - u0)), 0, hideBack(s));
    }
  }
}

/**
 * A ring of voussoirs round a pointed arch struck from `ys`, in `colors`
 * taken in turn — two of them is the ablaq a portal is striped in, one is a
 * plain ring. Like `archRing`, it sits outside the arc it is struck on.
 */
export function ring(
  lay: Lay,
  s: Side,
  plane: number,
  u: number,
  ys: number,
  span: number,
  rise: number,
  width: number,
  thick: number,
  out: number,
  colors: readonly string[],
): void {
  const pts = archArc(u, ys, span, rise, width / 2, 4);
  for (const side of [-1, 1]) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ua, ya] = pts[i];
      const [ub, yb] = pts[i + 1];
      const u0 = side < 0 ? ua : 2 * u - ua;
      const u1 = side < 0 ? ub : 2 * u - ub;
      const col = colors[i % colors.length];
      lay.sb.onFace(s, plane, (u0 + u1) / 2, (ya + yb) / 2, Math.hypot(u1 - u0, yb - ya) + 0.03, width, thick, out, col, lean(Math.atan2(yb - ya, u1 - u0)), 0, hideBack(s));
    }
  }
}

/**
 * An eight-pointed star — two squares, one turned on its corner — the khatam
 * that a tympanum's tile is set round.
 */
export function star(lay: Lay, s: Side, plane: number, u: number, y: number, size: number, out: number, color: string): void {
  lay.sb.onFace(s, plane, u, y, size, size, 0.03, out, color, 0, 0, hideBack(s));
  lay.sb.onFace(s, plane, u, y, size, size, 0.03, out, color, Math.PI / 4, 0, hideBack(s));
}

/**
 * Square kufic along a band: the script laid on a grid, which is the one
 * calligraphy that IS boxes. A baseline under every word, an upright stroke
 * every second column one to four cells tall, a hook off some of their heads
 * and a gap between words. `put` lays one stroke at its centre `(u, y)`.
 *
 * It says nothing, and is not meant to: at the distance a player reads it,
 * what tells a mosque's frieze from a stripe is the RHYTHM of the uprights.
 */
export function kufic(
  put: (u: number, y: number, along: number, tall: number) => void,
  u0: number,
  u1: number,
  y0: number,
  H: number,
  rnd: () => number,
): void {
  const c = H / 5.4;
  const sw = c * 0.66;
  const lo = y0 + c * 0.2;
  const end = u1 - c * 0.4;
  let word = u0 + c * 0.4;
  let u = word;
  while (u + c <= end) {
    if (u > word + 3 * c && rnd() < 0.16) {
      put((word + u) / 2, lo + sw / 2, u - word, sw);
      u += c * 1.4;
      word = u;
      continue;
    }
    const k = 1 + Math.floor(rnd() * 4);
    const tall = k * c + sw;
    put(u + sw / 2, lo + tall / 2, sw, tall);
    if (k > 1 && rnd() < 0.34 && u + 2 * c < end) put(u + c, lo + k * c + sw / 2, c * 2 - sw * 0.2, sw);
    else if (k === 2 && rnd() < 0.5) put(u + c * 0.5, lo + c + sw / 2, c, sw);
    u += c * 2;
  }
  if (u > word + c) put((word + u - c) / 2, lo + sw / 2, u - c - word, sw);
}

/** Bullet and splinter pocks on a face: small dark chips where the render has gone. */
export function pocks(lay: Lay, s: Side, plane: number, u0: number, u1: number, y0: number, y1: number, count: number, rnd: () => number): void {
  for (let i = 0; i < count; i++) {
    const sz = 0.05 + rnd() * 0.09;
    const u = u0 + rnd() * (u1 - u0);
    const y = y0 + rnd() * (y1 - y0);
    lay.sb.onFace(s, plane, u, y, sz * (0.8 + rnd() * 0.5), sz, 0.02, 0.01, SCORCH, rnd() * 1.2, 0, hideBack(s));
  }
}

/** A poster pasted on a face at `out`: a sheet, a portrait on it and two lines under that. */
export function poster(lay: Lay, s: Side, plane: number, u: number, y: number, out: number, rnd: () => number): void {
  const back = hideBack(s);
  const tilt = (rnd() - 0.5) * 0.08;
  lay.sb.onFace(s, plane, u, y, 0.44, 0.6, 0.008, out + 0.004, WHITEWASH, tilt, 0, back);
  lay.sb.onFace(s, plane, u, y + 0.08, 0.22, 0.28, 0.008, out + 0.012, SCORCH, tilt, 0, back);
  lay.sb.onFace(s, plane, u, y - 0.17, 0.34, 0.05, 0.008, out + 0.012, AWNING, tilt, 0, back);
  lay.sb.onFace(s, plane, u, y - 0.24, 0.26, 0.03, 0.008, out + 0.012, SCORCH, tilt, 0, back);
}

/**
 * One blind bay: a pointed arch frame round a recess with a grilled window
 * low in it and a lancet over that, from `lo` (the dado's head) to `hi`
 * (the cornice's foot). Spans narrower than a window's worth get the frame
 * alone. `ground` is the recess's back, a shade under the wall it is cut in.
 */
export function blindBay(
  lay: Lay,
  s: Side,
  plane: number,
  u: number,
  bw: number,
  lo: number,
  hi: number,
  skin: string,
  windows: boolean,
  ground: string = MUDBRICK,
): void {
  const ring = 0.22;
  const span = bw - ring - 0.1;
  const rise = Math.max(span / 2, Math.min(span * 0.62, (hi - lo) * 0.42));
  const ys = hi - 0.12 - rise - ring / 2;
  archRing(lay, s, plane, u, ys, span, rise, ring, 0.12, 0.06, skin);
  for (const k of [-1, 1]) lay.sb.onFace(s, plane, u + k * (span / 2 + ring / 2), (lo + ys) / 2, ring, ys - lo, 0.12, 0.06, skin, 0, 0, hideBack(s));
  // The recess's ground: a shade darker, which is what the render does in a
  // reveal the sun only reaches at noon.
  slabOn(lay, s, plane, pointed(u, lo, span, ys - lo, rise), 0, 0.015, ground, false);
  if (!windows) return;
  const ww = Math.min(1.0, span * 0.4);
  const wh = Math.min(1.4, (ys - lo) * 0.62);
  const sill = lo + Math.max(0.45, (ys - lo) * 0.22);
  lay.sb.onFace(s, plane, u, sill + wh / 2, ww, wh, 0.04, 0.03, WINDOW_VOID, 0, 0, hideBack(s));
  // The grille: two bars up, three across, set in the reveal's face.
  for (const k of [-1, 1]) lay.sb.onFace(s, plane, u + (k * ww) / 6, sill + wh / 2, 0.04, wh, 0.04, 0.06, IRON, 0, 0, hideBack(s));
  for (let i = 1; i <= 3; i++) lay.sb.onFace(s, plane, u, sill + (i * wh) / 4, ww, 0.035, 0.04, 0.065, IRON, 0, 0, hideBack(s));
  lay.sb.onFace(s, plane, u, sill - 0.06, ww + 0.24, 0.1, 0.12, 0.06, MUDBRICK_DARK, 0, 0, hideBack(s));
  lay.sb.onFace(s, plane, u, sill + wh + 0.08, ww + 0.36, 0.14, 0.1, 0.05, PALM_BEAM, 0, 0, hideBack(s));
  // The lancet over it, if the arch has the height.
  const ls = sill + wh + 0.35;
  const lw = ww * 0.5;
  const lr = lw * 0.7;
  if (ys + rise - 0.25 - ls > lr + 0.35) {
    const spring = Math.min(0.7, ys + rise - 0.3 - ls - lr);
    slabOn(lay, s, plane, pointed(u, ls, lw, spring, lr), 0.015, 0.045, WINDOW_VOID);
    lay.sb.onFace(s, plane, u, ls - 0.04, lw + 0.16, 0.08, 0.1, 0.05, MUDBRICK_DARK, 0, 0, hideBack(s));
  }
}

/**
 * A parapet run along side `s`, its outer face `plane` out, centred at `u`
 * and `len` long, standing on `y`: a low band and a row of stepped merlons
 * on it — the crenellation every flat roof of consequence in the region
 * wears, and the only thing at roof height that hangs a shadow.
 */
export function merlons(lay: Lay, s: Side, plane: number, u: number, len: number, y: number, band: number, skin: string): void {
  lay.sb.onFace(s, plane, u, y + band / 2, len, band, 0.3, -0.15, skin, 0, 0, HIDE_DOWN);
  const n = Math.max(2, Math.round(len / 0.78));
  for (let i = 0; i < n; i++) {
    const uu = u - len / 2 + ((i + 0.5) * len) / n;
    lay.sb.onFace(s, plane, uu, y + band + 0.18, 0.36, 0.36, 0.28, -0.15, skin, 0, 0, HIDE_DOWN);
    lay.sb.onFace(s, plane, uu, y + band + 0.43, 0.18, 0.14, 0.28, -0.15, skin, 0, 0, HIDE_DOWN);
  }
}

/**
 * A row of triangles pierced through a parapet along side `s`, from `a` to
 * `c` with their bases on `y`, one every `pitch` or a little more: the holes
 * a mud parapet is lightened with and the wind cools a roof through.
 */
export function triangles(lay: Lay, s: Side, plane: number, a: number, c: number, y: number, pitch = 0.5): void {
  const n = Math.floor((c - a) / pitch);
  const step = (c - a) / n;
  for (let i = 0; i < n; i++) {
    const u = a + (i + 0.5) * step;
    slabOn(lay, s, plane, [[u - 0.11, y], [u + 0.11, y], [u, y + 0.22]], 0, 0.014, WINDOW_VOID);
  }
}

// --- render, stains and round members ----------------------------------------

/**
 * A socle along side `s` from `u = a` to `c`, standing on the plinth: two
 * courses of dressed stone over a mortar ground, the stones lighter than
 * their joints, and a chamfered weathering course on them.
 */
export function socle(lay: Lay, s: Side, plane: number, a: number, c: number, rnd: () => number): void {
  const back = hideBack(s);
  lay.sb.onFace(s, plane, (a + c) / 2, PLINTH + 0.31, c - a, 0.62, 0.04, 0.012, MUDBRICK_DARK, 0, 0, back);
  for (let row = 0; row < 2; row++) {
    const y0 = PLINTH + row * 0.31;
    let u = a + (row ? 0.0 : 0.02);
    while (u < c - 0.1) {
      const len = Math.min(c - u - 0.02, 0.48 + rnd() * 0.42);
      if (len > 0.12) lay.sb.onFace(s, plane, u + len / 2, y0 + 0.155, len, 0.285, 0.04, 0.034, MUDBRICK, 0, 0, back);
      u += len + 0.025;
    }
  }
  lay.sb.onFace(s, plane, (a + c) / 2, PLINTH + 0.66, c - a + 0.04, 0.08, 0.1, 0.05, MUDBRICK_DARK, 0, 0, back);
}

/**
 * The cornice of a brick wall head along side `s`, from `u = a` to `c`,
 * standing on `y`: a course, a band of bricks laid on their corners — the
 * dog-tooth every brick wall head in the province wears — and a corbelled
 * course over it. Runs shorter than 0.3 m get none.
 */
export function cornice(lay: Lay, s: Side, plane: number, a: number, c: number, y: number): void {
  if (c - a < 0.3) return;
  const back = hideBack(s);
  lay.sb.onFace(s, plane, (a + c) / 2, y + 0.045, c - a, 0.09, 0.12, 0.0, MUDBRICK, 0, 0, back);
  const n = Math.max(1, Math.floor((c - a - 0.1) / 0.3));
  const step = (c - a) / n;
  for (let i = 0; i < n; i++) {
    lay.sb.onFace(s, plane, a + (i + 0.5) * step, y + 0.19, 0.16, 0.17, 0.16, 0.0, MUDBRICK, 0, Math.PI / 4, back);
  }
  lay.sb.onFace(s, plane, (a + c) / 2, y + 0.33, c - a + 0.06, 0.1, 0.2, 0.04, MUDBRICK, 0, 0, back);
}

/** One course of brick where the render has come away. */
export const COURSE = 0.09;

/** What a wall is laid in under its render: the joint's colour, the unit's, a course, a unit and its pitch along the course. */
export interface Bond {
  ground: string;
  unit: string;
  course: number;
  len: number;
  pitch: number;
}

/** Brick, which the mud and limewashed walls are laid in. */
export const BRICK: Bond = { ground: MUDBRICK_DARK, unit: MUDBRICK, course: COURSE, len: 0.24, pitch: 0.26 };

/**
 * A palm-log spout through the parapet's foot, and the streak under it,
 * running down to a ragged foot `foot` (and up to 0.3 m more) over the ground
 * — a storey's worth on a one-storey wall, raised on a taller one.
 */
export function spout(lay: Lay, s: Side, plane: number, u: number, y: number, streakTop: number, rnd: () => number, foot = 2.15): void {
  lay.sb.onFace(s, plane, u, y, 0.16, 0.14, 0.62, 0.27, PALM_BEAM, 0, 0, hideBack(s));
  streak(lay, s, plane, u, streakTop, rnd, foot);
}

/**
 * The wash a spout leaves down the wall under it: broad under the string
 * course at `streakTop`, spreading as it runs and stopping in a ragged foot
 * at `foot` (and up to 0.3 m more) over the ground, well above the socle.
 * Apart from `spout` for a builder that draws the spout itself.
 */
export function streak(lay: Lay, s: Side, plane: number, u: number, streakTop: number, rnd: () => number, foot = 2.15): void {
  const lo = foot + rnd() * 0.3;
  const wa = 0.13 + rnd() * 0.06;
  blob(lay, s, plane, [u, (streakTop + lo) / 2], [
    [u - wa, streakTop],
    [u + wa, streakTop],
    [u + wa + 0.1, lo + 0.22],
    [u + 0.16, lo + 0.04],
    [u + 0.02, lo + 0.14],
    [u - 0.14, lo],
    [u - wa - 0.06, lo + 0.18],
  ], 0, 0.006, MUDBRICK_DARK);
}

/**
 * An outline laid on a face, fanned from `centre` (from which it must be
 * star-shaped) rather than from its first point, as `slabOn` is: a lobe with
 * a wave in its edge is not convex.
 */
export function blob(
  lay: Lay,
  s: Side,
  plane: number,
  centre: readonly [number, number],
  pts: readonly (readonly [number, number])[],
  out0: number,
  out1: number,
  color: string,
): void {
  const m = lay.m(color);
  const fwd = fdir(s, 0, 0, 1);
  const c = fp(s, plane, centre[0], centre[1], out1);
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = pts[i];
    const b = pts[j];
    m.tri(c, fp(s, plane, a[0], a[1], out1), fp(s, plane, b[0], b[1], out1), fwd);
    // The edge's side, facing away from the centre.
    const du = b[0] - a[0];
    const dy = b[1] - a[1];
    const mu = (a[0] + b[0]) / 2 - centre[0];
    const my = (a[1] + b[1]) / 2 - centre[1];
    const sg = dy * mu - du * my > 0 ? 1 : -1;
    m.quad(fp(s, plane, a[0], a[1], out0), fp(s, plane, b[0], b[1], out0), fp(s, plane, b[0], b[1], out1), fp(s, plane, a[0], a[1], out1), fdir(s, sg * dy, -sg * du, 0));
  }
}

/**
 * A lobe of something laid on a level surface, its top at `y` and its sides
 * down 2.5 cm: an ellipse `a` by `b` turned `yaw`, with a slow wave in its
 * edge. Fanned from its centre, from which it is star-shaped.
 */
export function lobe(m: Mesher, x: number, y: number, z: number, a: number, b: number, yaw: number, rnd: () => number): void {
  const p1 = rnd() * TAU;
  const p2 = rnd() * TAU;
  const N = 14;
  const c = Math.cos(yaw);
  const sn = Math.sin(yaw);
  const pts: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * TAU;
    const kk = 1 + 0.18 * Math.sin(2 * t + p1) + 0.1 * Math.sin(3 * t + p2);
    const u = Math.cos(t) * a * kk;
    const v = Math.sin(t) * b * kk;
    pts.push([x + u * c - v * sn, z + u * sn + v * c]);
  }
  const up: V3 = [0, 1, 0];
  for (let i = 0; i < N; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[(i + 1) % N];
    m.tri([x, y, z], [ax, y, az], [bx, y, bz], up);
    m.quad([ax, y - 0.025, az], [bx, y - 0.025, bz], [bx, y, bz], [ax, y, az], [(ax + bx) / 2 - x, 0, (az + bz) / 2 - z]);
  }
}

/** A ragged outline round `(u, y)`, `a` by `bb`, for a hole or a burn on a face. */
export function ragged(u: number, y: number, a: number, bb: number, n: number, rnd: () => number): [number, number][] {
  const pts: [number, number][] = [];
  const p = rnd() * TAU;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU;
    const kk = 0.75 + 0.2 * Math.sin(3 * t + p) + rnd() * 0.3;
    pts.push([u + Math.cos(t) * a * kk, y + Math.sin(t) * bb * kk]);
  }
  return pts;
}

/** Whether `(u, y)` is inside a closed outline. */
export function within(pts: readonly (readonly [number, number])[], u: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ui, yi] = pts[i];
    const [uj, yj] = pts[j];
    if (yi > y !== yj > y && u < ((uj - ui) * (y - yi)) / (yj - yi) + ui) inside = !inside;
  }
  return inside;
}

/**
 * Render lost back to the brick: two or three overlapping lobes, each with a
 * slow wave in its edge, a dark mortar ground with courses of brick laid
 * across it, and a lip of render standing round the outside, which is the
 * step that makes it a HOLE in the plaster rather than a brown stain on it.
 * `bond` is what the wall is laid in: brick unless it says otherwise.
 * `shape` is for a building placed by the hundred: `n` points to each lobe's
 * edge rather than sixteen, and `extra` lobes rather than one or two drawn.
 */
export function spall(
  lay: Lay,
  s: Side,
  plane: number,
  u: number,
  y: number,
  hu: number,
  hy: number,
  skin: string,
  rnd: () => number,
  bond: Bond = BRICK,
  shape?: { n: number; extra: number },
): void {
  const back = hideBack(s);
  const lobes: { c: [number, number]; pts: [number, number][] }[] = [];
  const lobe = (lu: number, ly: number, a: number, b: number): void => {
    const p1 = rnd() * TAU;
    const p2 = rnd() * TAU;
    const N = shape?.n ?? 16;
    const pts: [number, number][] = [];
    for (let i = 0; i < N; i++) {
      const t = (i / N) * TAU;
      const k = 1 + 0.2 * Math.sin(2 * t + p1) + 0.1 * Math.sin(3 * t + p2) + (rnd() - 0.5) * 0.08;
      pts.push([lu + Math.cos(t) * a * k, ly + Math.sin(t) * b * k]);
    }
    lobes.push({ c: [lu, ly], pts });
  };
  lobe(u, y, hu, hy);
  const extra = shape ? shape.extra : 1 + Math.floor(rnd() * 2);
  for (let i = 0; i < extra; i++) {
    const side = i % 2 ? -1 : 1;
    lobe(u + side * hu * (0.55 + rnd() * 0.35), y + (rnd() - 0.5) * hy * 0.7, hu * (0.4 + rnd() * 0.3), hy * (0.55 + rnd() * 0.3));
  }
  lobes.forEach((l, li) => {
    blob(lay, s, plane, l.c, l.pts, 0, 0.006, bond.ground);
    // The lip, where no other lobe has taken the render away.
    const n = l.pts.length;
    for (let i = 0; i < n; i++) {
      const [ua, ya] = l.pts[i];
      const [ub, yb] = l.pts[(i + 1) % n];
      const mu = (ua + ub) / 2;
      const my = (ya + yb) / 2;
      if (lobes.some((o, oi) => oi !== li && within(o.pts, mu, my))) continue;
      const a = Math.atan2(yb - ya, ub - ua);
      const tilt = a > Math.PI / 2 ? a - Math.PI : a <= -Math.PI / 2 ? a + Math.PI : a;
      lay.sb.onFace(s, plane, mu, my, Math.hypot(ub - ua, yb - ya) + 0.03, 0.045, 0.035, 0.0175, skin, tilt, 0, back);
    }
  });
  // The courses: each row the union of where it crosses the lobes.
  const ys = lobes.flatMap((l) => l.pts.map((q) => q[1]));
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  let row = 0;
  for (let yc = lo + bond.course * 0.7; yc < hi - bond.course * 0.5; yc += bond.course, row++) {
    const spans: [number, number][] = [];
    for (const l of lobes) {
      const xs: number[] = [];
      const n = l.pts.length;
      for (let i = 0; i < n; i++) {
        const [ua, ya] = l.pts[i];
        const [ub, yb] = l.pts[(i + 1) % n];
        if (ya > yc !== yb > yc) xs.push(ua + ((ub - ua) * (yc - ya)) / (yb - ya));
      }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        if (xs[i + 1] - xs[i] > 0.14) spans.push([xs[i] + 0.035, xs[i + 1] - 0.035]);
      }
    }
    spans.sort((p, q) => p[0] - q[0]);
    const merged: [number, number][] = [];
    for (const sp of spans) {
      const last = merged[merged.length - 1];
      if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]);
      else merged.push([sp[0], sp[1]]);
    }
    for (const [a, c] of merged) {
      // Units in stretcher bond, the joints staggered course to course.
      let uu = a - (row % 2 ? bond.pitch / 2 : 0) + ((a * 7.3) % bond.pitch);
      while (uu < c) {
        const b0 = Math.max(a, uu);
        const b1 = Math.min(c, uu + bond.len);
        if (b1 - b0 > 0.05) lay.sb.onFace(s, plane, (b0 + b1) / 2, yc, b1 - b0, bond.course - 0.022, 0.02, 0.014, bond.unit, 0, 0, back);
        uu += bond.pitch;
      }
    }
  }
}
