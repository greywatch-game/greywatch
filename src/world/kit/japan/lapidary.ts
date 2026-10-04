/**
 * kit/japan/lapidary.ts — `Lapidary`, the garden's mason: the carving words
 * the stone lantern, the stone pagoda, the bell tower and the arched bridge
 * share, batched into one surface per colour.
 * Invariants: draws in the model's own units and scales once by `s` as it
 * emits; emits no colliders.
 */
import { Build, Mesher, StoneBatch, type V3 } from "../core";
import { GRANITE, KAKI, MOMIJI } from "./palette";

export const TAU = Math.PI * 2;

/** A lotus petal's outline: (along its length from the base, across its width). */
const LOTUS_LEAF = [
  [0.04, -0.42],
  [0.04, 0.42],
  [0.5, 0.49],
  [0.96, 0],
  [0.5, -0.49],
] as const;

/** A tube's path point: (R, y) in a vertical plane through the axis, and the section's width and height. */
export type TubePoint = [number, number, number, number];

/** A maple leaf's five lobes, the middle one longest. */
const LEAF_LOBES = [1, 0.82, 0.5, 0.5, 0.82];

/**
 * The garden's mason: the carving words the stone lantern and the stone
 * pagoda share. Everything is drawn in the model's own units and scaled once
 * by `s` as it is emitted, into ONE surface per colour — a `Mesher` per
 * colour for the carved solids and a `StoneBatch` for the laid boxes —
 * because a granite ornament is hundreds of small parts, and as parts that is
 * hundreds of meshes for the merge to build and throw away. The methods are
 * arrow properties, so a builder destructures the ones it uses.
 */
export class Lapidary {
  readonly sb = new StoneBatch();
  private readonly meshers = new Map<string, Mesher>();

  constructor(private readonly s: number) {}

  mesher = (color: string): Mesher => {
    let m = this.meshers.get(color);
    if (!m) this.meshers.set(color, (m = new Mesher()));
    return m;
  };

  scaled = (q: V3): V3 => [q[0] * this.s, q[1] * this.s, q[2] * this.s];

  /**
   * `convexSolid`, into one surface per colour: every face wound against the
   * solid's centroid. `bedded` leaves out the `from` face, which lies in
   * the stone it was laid on.
   */
  solid = (color: string, from: V3[], to: V3[], bedded = false): void => {
    const m = this.mesher(color);
    const A = from.map(this.scaled);
    const B = to.map(this.scaled);
    const all = [...A, ...B];
    const c = [0, 1, 2].map((i) => all.reduce((t, q) => t + q[i], 0) / all.length);
    const face = (pts: V3[]): void => {
      const f = [0, 1, 2].map((i) => pts.reduce((t, q) => t + q[i], 0) / pts.length);
      const out: V3 = [f[0] - c[0], f[1] - c[1], f[2] - c[2]];
      for (let i = 1; i + 1 < pts.length; i++) m.tri(pts[0], pts[i], pts[i + 1], out);
    };
    if (!bedded) face(A);
    face(B);
    for (let i = 0; i < A.length; i++) {
      const j = (i + 1) % A.length;
      face([A[i], A[j], B[j], B[i]]);
    }
  };

  /**
   * A turned solid: `prof` is (radius, height) walked from the bottom up
   * over the OUTSIDE, closed by starting and ending on the axis. Vertices
   * stand at `phase + k/n` of a turn, so a facet's centre is half a step on.
   * Four facets at an eighth of a turn is a square, the radius its corner's.
   * `at` stands the axis somewhere other than the origin — the bridge's
   * finials; left out, the arithmetic is exactly what it always was.
   */
  lathe = (color: string, prof: [number, number][], n: number, phase: number, at?: V3): void => {
    const m = this.mesher(color);
    const s = this.s;
    const P = at
      ? (r: number, y: number, a: number): V3 => [(at[0] + r * Math.cos(a)) * s, (at[1] + y) * s, (at[2] + r * Math.sin(a)) * s]
      : (r: number, y: number, a: number): V3 => [r * Math.cos(a) * s, y * s, r * Math.sin(a) * s];
    for (let i = 0; i + 1 < prof.length; i++) {
      const [r0, y0] = prof[i];
      const [r1, y1] = prof[i + 1];
      for (let k = 0; k < n; k++) {
        const a0 = phase + (k / n) * TAU;
        const a1 = phase + ((k + 1) / n) * TAU;
        const am = (a0 + a1) / 2;
        const out: V3 = [(y1 - y0) * Math.cos(am), r0 - r1, (y1 - y0) * Math.sin(am)];
        m.quad(P(r0, y0, a0), P(r0, y0, a1), P(r1, y1, a1), P(r1, y1, a0), out);
      }
    }
  };

  /**
   * A point on the slope from (r0, y0) to (r1, y1) — walked bottom to top — at
   * bearing `a`: `f` up the slope, `u` across it, `w` out of it.
   */
  slope = (r0: number, y0: number, r1: number, y1: number, a: number) => {
    const L = Math.hypot(r1 - r0, y1 - y0);
    const nr = (y1 - y0) / L;
    const ny = -(r1 - r0) / L;
    return (f: number, u: number, w: number): V3 => {
      const R = r0 + (r1 - r0) * f + nr * w;
      const y = y0 + (y1 - y0) * f + ny * w;
      return [R * Math.cos(a) - u * Math.sin(a), y, R * Math.sin(a) + u * Math.cos(a)];
    };
  };

  /**
   * A ring of lotus petals on a turned cone of `n` facets, one petal per
   * facet, its tip toward the `tip` end of the slope (0 the bottom, 1 the
   * top). Each is a pointed leaf bedded on its facet and bevelled to a
   * smaller face standing proud, so the ink finds both its edge and its crown.
   */
  petals = (r0: number, y0: number, r1: number, y1: number, n: number, phase: number, tip: 0 | 1): void => {
    const facet = 2 * Math.sin(Math.PI / n);
    const sink = 1 - Math.cos(Math.PI / n);
    const proud = Math.max(0.012, Math.abs(r1 - r0) * 0.12);
    for (let k = 0; k < n; k++) {
      const at = this.slope(r0, y0, r1, y1, phase + ((k + 0.5) / n) * TAU);
      const outline = (w: number, shrink: number): V3[] =>
        LOTUS_LEAF.map(([q0, v]): V3 => {
          const q = 0.5 + (q0 - 0.5) * shrink;
          const f = tip ? q : 1 - q;
          const r = r0 + (r1 - r0) * f;
          return at(f, v * shrink * facet * r, w - r * sink);
        });
      this.solid(GRANITE, outline(-0.004, 1), outline(proud, 0.78), true);
    }
  };

  /**
   * `per` lotus petals side by side across one PLANE slope (`at`), whose half
   * width at `f` is `halfAt(f)` — the petals of a square lotus, where
   * `petals`' offset from a facet's corners to its middle is a quarter of
   * the radius and would bury them.
   */
  leafRow = (at: (f: number, u: number, w: number) => V3, halfAt: (f: number) => number, per: number, tip: 0 | 1, proud: number): void => {
    for (let j = 0; j < per; j++) {
      const across = (j + 0.5) / per - 0.5;
      const outline = (w: number, shrink: number): V3[] =>
        LOTUS_LEAF.map(([q0, v]): V3 => {
          const q = 0.5 + (q0 - 0.5) * shrink;
          const f = tip ? q : 1 - q;
          return at(f, 2 * halfAt(f) * (across + (v * shrink) / per), w);
        });
      this.solid(GRANITE, outline(-0.004, 1), outline(proud, 0.78), true);
    }
  };

  /** A point on the face whose normal bears `th`, its outer plane standing `plane` out. */
  faceAt =
    (th: number, plane: number) =>
    (u: number, y: number, w: number): V3 => [
      (plane + w) * Math.cos(th) - u * Math.sin(th),
      y,
      (plane + w) * Math.sin(th) + u * Math.cos(th),
    ];

  /**
   * A stone laid on face `th`: `along` across it, `tall` up it, `thick` out of
   * it, its centre `w` out of the plane. `lift` raises its +u end.
   */
  onFace = (
    th: number,
    plane: number,
    u: number,
    y: number,
    w: number,
    along: number,
    tall: number,
    thick: number,
    color: string,
    lift = 0,
    hide = 0,
  ): void => {
    const s = this.s;
    const c = this.faceAt(th, plane)(u, y, w);
    this.sb.box(along * s, tall * s, thick * s, c[0] * s, c[1] * s, c[2] * s, color, { y: Math.PI / 2 - th, z: -lift }, hide);
  };

  /**
   * A member bending in the vertical plane at bearing `v` — a ridge down a
   * cap's corner, running out into its scroll: one tube of sections, each
   * square to the path, so a ridge and a curl are one member bending rather
   * than two things meeting. Capped at its ends only: a chain of capped
   * solids spent a third of its vertices on faces buried in the next link.
   */
  tube = (color: string, path: TubePoint[], v: number): void => {
    const m = this.mesher(color);
    const P = (R: number, y: number, u: number): V3 => [R * Math.cos(v) - u * Math.sin(v), y, R * Math.sin(v) + u * Math.cos(v)];
    const secs = path.map(([R, y, w, h], i) => {
      const a = path[Math.max(0, i - 1)];
      const c = path[Math.min(path.length - 1, i + 1)];
      const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const nR = -(c[1] - a[1]) / L;
      const ny = (c[0] - a[0]) / L;
      return [
        P(R - (nR * h) / 2, y - (ny * h) / 2, -w / 2),
        P(R - (nR * h) / 2, y - (ny * h) / 2, w / 2),
        P(R + (nR * h) / 2, y + (ny * h) / 2, w / 2),
        P(R + (nR * h) / 2, y + (ny * h) / 2, -w / 2),
      ];
    });
    /** A section's centre: the middle of its diagonal. */
    const mid = (q: V3[]): V3 => [(q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2, (q[0][2] + q[2][2]) / 2];
    for (let i = 0; i + 1 < secs.length; i++) {
      const A = secs[i].map(this.scaled);
      const B = secs[i + 1].map(this.scaled);
      const c = mid([mid(A), A[0], mid(B)]);
      for (let e = 0; e < 4; e++) {
        const f = (e + 1) % 4;
        const q = [0, 1, 2].map((j) => (A[e][j] + A[f][j] + B[e][j] + B[f][j]) / 4);
        m.quad(A[e], A[f], B[f], B[e], [q[0] - c[0], q[1] - c[1], q[2] - c[2]]);
      }
    }
    for (const [end, next] of [
      [secs[0], secs[1]],
      [secs[secs.length - 1], secs[secs.length - 2]],
    ]) {
      const E = end.map(this.scaled);
      const a = mid(E);
      const n = mid(next.map(this.scaled));
      m.quad(E[0], E[1], E[2], E[3], [a[0] - n[0], a[1] - n[1], a[2] - n[2]]);
    }
  };

  /**
   * A patch of pale lichen on a slope (`at`, `L` long): three or four jittered
   * lobes, each stepping off the last across the slope from (`f0`, `u0`), so a
   * patch is a drawn-out run of them and never one polygon — a single lobe
   * read as a coin. `halfAt(f)` is the slope's half width at `f`, which keeps
   * every lobe off the corners; `back` is how deep its bed sinks.
   */
  lichen = (
    rnd: () => number,
    at: (f: number, u: number, w: number) => V3,
    L: number,
    f0: number,
    u0: number,
    halfAt: (f: number) => number,
    back = -0.004,
  ): void => {
    const lobes = 3 + Math.floor(rnd() * 2);
    let u = u0;
    let fm = f0;
    const step = rnd() < 0.5 ? -1 : 1;
    for (let j = 0; j < lobes; j++) {
      const ru = 0.035 + rnd() * 0.03;
      const rf = (0.022 + rnd() * 0.018) / L;
      const fc = Math.min(0.85, Math.max(0.12, fm));
      const lim = Math.max(0, halfAt(fc) - ru - 0.02);
      const uc = Math.max(-lim, Math.min(lim, u));
      u += step * (0.04 + rnd() * 0.035);
      fm += ((rnd() - 0.5) * 0.05) / L;
      const edge = Array.from({ length: 7 }, () => 0.8 + rnd() * 0.3);
      const ring = (w: number): V3[] =>
        edge.map((k, q): V3 => {
          const a = (q / 7) * TAU;
          return at(fc + rf * k * Math.sin(a), uc + ru * k * Math.cos(a), w);
        });
      this.solid(GRANITE, ring(back), ring(0.005 + j * 0.002), true);
    }
  };

  /**
   * A fallen maple leaf lying on a slope (`at`, `L` long) at (`d` along it,
   * `u` across): five lobes, the middle one longest, turned by `turn`, in the
   * litter's red or its orange.
   */
  leaf = (
    rnd: () => number,
    at: (f: number, u: number, w: number) => V3,
    L: number,
    d: number,
    u: number,
    size: number,
    turn: number,
    w0: number,
  ): void => {
    const color = rnd() < 0.55 ? MOMIJI : KAKI;
    const P = (r: number, a: number, w: number): V3 => at((d + r * Math.cos(a)) / L, u + r * Math.sin(a), w);
    for (let k = 0; k < 5; k++) {
      const a = turn + (k * TAU) / 5;
      const half = TAU / 10;
      const r = size * LEAF_LOBES[k];
      const outline = (w: number): V3[] => [P(0, 0, w), P(size * 0.3, a - half, w), P(r, a, w), P(size * 0.3, a + half, w)];
      this.solid(color, outline(w0), outline(w0 + 0.005), true);
    }
  };

  /** Every colour's surface, then the laid boxes. */
  flush = (b: Build): void => {
    for (const [color, m] of this.meshers) b.surface(m.data(), color);
    this.sb.flush(b);
  };
}
