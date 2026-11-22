/**
 * kit/desert/lay.ts — The drawing's words the desert set's detailed
 * buildings share: `Lay`, the one batch a building's drawing is laid into;
 * an elevation's points and outlines (`fp`, `fdir`, `slabOn`, `pointed`,
 * `above`); the arch ring, the star, square kufic, the blind bay, the
 * stepped merlons and the pocks; and the round solids (`band`, `disc`,
 * `drum`). Part of the desert-town set: follows the contract in kit/core.ts
 * and the set's rules in `./index.ts`. Invariants: VISUAL only — nothing here
 * declares a collider; every face is planar, as the cel shader's per-facet
 * light needs. Never builds a building, and never imports one.
 */
import {
  Build,
  IRON,
  Mesher,
  StoneBatch,
  archArc,
  hideBack,
  outward,
  runsAlongX,
  type Side,
  type V3,
} from "../core";
import { MUDBRICK, MUDBRICK_DARK, PALM_BEAM, SCORCH, WINDOW_VOID } from "./shared";

/** A whole turn. */
export const TAU = Math.PI * 2;
/** The underside of a thing standing on a roof or a floor, which nothing sees. */
export const HIDE_DOWN = 1 << 3;

// --- the batch -----------------------------------------------------------------
//
// Everything after a builder's colliders is laid into ONE `StoneBatch` and
// one `Mesher` a colour, so the great mosque is a few dozen parts for the
// merge rather than some thousands, and `flush` hands them over BEFORE the
// wall boxes they are laid on — what is hidden is emitted after what hides it.

/** The batch every piece of a building drawn with these words is laid into. */
export class Lay {
  readonly sb = new StoneBatch();
  private readonly ms = new Map<string, Mesher>();

  m(color: string): Mesher {
    let m = this.ms.get(color);
    if (!m) this.ms.set(color, (m = new Mesher()));
    return m;
  }

  flush(b: Build): void {
    this.sb.flush(b);
    for (const [color, m] of this.ms) b.surface(m.data(), color);
    this.ms.clear();
  }
}

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


/**
 * The sides of an `n`-sided frustum from apothem `r0` at `y0` to `r1` at
 * `y1`, flat 0 facing `phase`. Every facet is a planar trapezoid, which is
 * what the cel shader's per-facet light needs from anything round.
 */
export function band(m: Mesher, n: number, phase: number, r0: number, y0: number, r1: number, y1: number, cx = 0, cz = 0): void {
  const k0 = 1 / Math.cos(Math.PI / n);
  const slope = (r0 - r1) / (y1 - y0);
  for (let k = 0; k < n; k++) {
    const a0 = phase + ((k - 0.5) * TAU) / n;
    const a1 = phase + ((k + 0.5) * TAU) / n;
    const am = phase + (k * TAU) / n;
    const p = (a: number, r: number, y: number): V3 => [cx + Math.sin(a) * r * k0, y, cz + Math.cos(a) * r * k0];
    m.quad(p(a0, r0, y0), p(a1, r0, y0), p(a1, r1, y1), p(a0, r1, y1), [Math.sin(am), slope, Math.cos(am)]);
  }
}

/** A flat ring between apothems `rOut` and `rIn` at `y`, facing up (or down). */
export function disc(m: Mesher, n: number, phase: number, rOut: number, rIn: number, y: number, up = true, cx = 0, cz = 0): void {
  const k0 = 1 / Math.cos(Math.PI / n);
  for (let k = 0; k < n; k++) {
    const a0 = phase + ((k - 0.5) * TAU) / n;
    const a1 = phase + ((k + 0.5) * TAU) / n;
    const p = (a: number, r: number): V3 => [cx + Math.sin(a) * r * k0, y, cz + Math.cos(a) * r * k0];
    m.quad(p(a0, rOut), p(a1, rOut), p(a1, rIn), p(a0, rIn), [0, up ? 1 : -1, 0]);
  }
}

/** A closed drum: its sides and its top. */
export function drum(m: Mesher, n: number, phase: number, r0: number, y0: number, r1: number, y1: number): void {
  band(m, n, phase, r0, y0, r1, y1);
  disc(m, n, phase, r1, 0, y1);
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
