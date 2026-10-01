/**
 * kit/japan/joinery.ts — `Joinery`, the carpentry of a small temple building
 * under a curved tiled hip: the words the temple gate and the bell tower
 * both build with, and the order it walks the sides and corners in.
 * Invariants: everything is cut to one `RoofSpec` through `roofHeight`, so a
 * member hangs under the sheet wherever the sheet is; emits no colliders.
 */
import {
  Build,
  type Point3,
  type Side,
  HIDE_UNDER,
  StoneBatch,
  convexSolid,
  orient,
  outward,
  runsAlongX,
} from "../core";
import { BRONZE, CEDAR, KAWARA, KAWARA_DARK, SHIKKUI } from "./palette";
import { curvedRoof, roofHeight, type RoofSpec } from "./roof";

/**
 * The CARPENTRY of a small temple building under a curved tiled HIP — the
 * words the temple gate and the bell tower both build with, and why they
 * are here rather than in either builder: members laid on a face or from
 * point to point, a beam's slant-cut end, a bracket's arm, bearing blocks and
 * small blocks, purlins cut to the rafters over them, two layers of rafters
 * under a board lining, the hip beams with their wind bells, and the tiles —
 * round-tile rows on an eave lip, a ridge banded in white with a demon tile
 * at each end, and a hip ridge down each corner.
 *
 * Everything is cut to one `RoofSpec`, a hip whose ridge runs along X
 * (`tx` its half length, `tz` 0), through `roofHeight`, so a rafter hangs
 * under the lining and a tile lies on the sheet wherever the sheet is. The
 * laid members go into `sb`, which the builder flushes when it has emitted
 * what they hide; the slant-cut ends, the arms, the bells and the ridge's
 * round cap are parts of their own, emitted as they are called, exactly as
 * they were when this was the gate's own closures.
 */
export class Joinery {
  readonly sb = new StoneBatch();
  /** The ridge's half length, and the eave ring's half extents. */
  readonly rx: number;
  readonly ex: number;
  readonly ez: number;
  /** A base rafter's depth, a flying rafter's, and a purlin's. */
  readonly RB = 0.15;
  readonly RF = 0.12;
  readonly KD = 0.26;

  constructor(
    private readonly b: Build,
    private readonly color: string,
    readonly roof: RoofSpec,
  ) {
    this.rx = roof.tx;
    this.ex = roof.ex;
    this.ez = roof.ez;
  }

  /** Plan point `n` out from the centre on side `s`, `u` along it. */
  at = (s: Side, u: number, n: number): [number, number] => (runsAlongX(s) ? [u, outward(s) * n] : [outward(s) * n, u]);

  /** A member centred `out` off plane `plane` of side `s`. */
  on = (s: Side, plane: number, u: number, y: number, along: number, tall: number, thick: number, out: number, c: string, tilt = 0, hide = 0): void =>
    this.sb.onFace(s, plane, u, y, along, tall, thick, out, c, tilt, 0, hide);

  member = (a: Point3, c: Point3, wide: number, deep: number, col: string, hide = 0): void => {
    const o = orient(a, c);
    this.sb.box(wide, deep, o.len, o.mid[0], o.mid[1], o.mid[2], col, o.rot, hide);
  };

  /** An end face 1.5 cm past `c`, square to the member from `a` — a tile's, or a rafter's paint. */
  endFace = (a: Point3, c: Point3, wide: number, deep: number, col: string): void => {
    const o = orient(a, c);
    const k = 0.015 / o.len;
    this.sb.box(wide, deep, 0.01, c[0] + (c[0] - a[0]) * k, c[1] + (c[1] - a[1]) * k, c[2] + (c[2] - a[2]) * k, col, o.rot, 63 & ~J_END);
  };

  /**
   * A beam's end run on past a post, its underside cut up on a slant to the
   * tip (a kibana): from `a0` along the beam's axis for `len` the way `sgn`
   * says, the beam centred `c` across it.
   */
  nose = (alongX: boolean, c: number, a0: number, sgn: number, len: number, yb: number, yt: number, th: number): void => {
    const a1 = a0 + sgn * len;
    const prof = (q: number): Point3[] => {
      const P = (a: number, y: number): Point3 => (alongX ? [a, y, q] : [q, y, a]);
      return [P(a0, yb), P(a1 - sgn * 0.14, yb), P(a1, yb + (yt - yb) * 0.45), P(a1, yt), P(a0, yt)];
    };
    convexSolid(this.b, prof(c - th / 2), prof(c + th / 2), this.color);
  };

  /** A bracket arm (hijiki): a beam `len` long centred at `uc` along its axis, its ends' undersides rounded up. */
  arm = (alongX: boolean, uc: number, c: number, len: number, yb: number, yt: number, th: number): void => {
    const dy = yt - yb;
    const L = len / 2;
    const prof = (q: number): Point3[] => {
      const P = (a: number, y: number): Point3 => (alongX ? [uc + a, y, q] : [q, y, uc + a]);
      return [P(-L, yt), P(L, yt), P(L, yt - dy * 0.45), P(L - 0.16, yb), P(-L + 0.16, yb), P(-L, yt - dy * 0.45)];
    };
    convexSolid(this.b, prof(c - th / 2), prof(c + th / 2), this.color);
  };

  /** A bearing block of `size` on a post head at (x, z), from `y0` to `y1`. */
  block = (x: number, z: number, size: number, y0: number, y1: number): void => {
    this.sb.box(size, y1 - y0 - 0.04, size, x, (y0 + y1 - 0.04) / 2, z, this.color, undefined, HIDE_UNDER);
    this.sb.box(size - 0.08, 0.04, size - 0.08, x, y1 - 0.02, z, this.color, undefined, HIDE_UNDER);
  };

  /** Three small blocks along an arm, from `y0` to `y1`. */
  makito = (alongX: boolean, x: number, z: number, spread: number, y0: number, y1: number): void => {
    for (const du of [-spread, 0, spread]) {
      if (alongX) this.sb.box(0.22, y1 - y0, 0.22, x + du, (y0 + y1) / 2, z, this.color, undefined, J_TOP);
      else this.sb.box(0.22, y1 - y0, 0.22, x, (y0 + y1) / 2, z + du, this.color, undefined, J_TOP);
    }
  };

  /** The underside of the board lining, which the rafters hang under. */
  soffit = (x: number, z: number): number => roofHeight(this.roof, x, z, true) - 0.03;

  /** The underside of the base rafters over (u, n) on side `s`. */
  underAt = (s: Side, u: number, n: number): number => {
    const [x, z] = this.at(s, u, n);
    return this.soffit(x, z) - this.RB;
  };

  /** Where the hip crosses the row `u` of side `s`, as a distance out from the centre. */
  nHip = (s: Side, u: number): number => {
    const { rx, ex, ez } = this;
    return runsAlongX(s) ? (ez * (Math.abs(u) - rx)) / (ex - rx) : ex - ((ex - rx) * (ez - Math.abs(u))) / ez;
  };

  /**
   * A purlin along side `s`, `n` out and `half` either way, its top at
   * `top(u)` — cut to the rafters over it, so it follows the eave where the
   * hip comes down over its run-on end.
   */
  purlin = (s: Side, n: number, half: number, top: (u: number) => number): void => {
    const NS = 8;
    const KD = this.KD;
    for (let i = 0; i < NS; i++) {
      const ua = -half + (2 * half * i) / NS;
      const uc = -half + (2 * half * (i + 1)) / NS;
      const [xa, za] = this.at(s, ua, n);
      const [xc, zc] = this.at(s, uc, n);
      this.member([xa, top(ua) - KD / 2, za], [xc, top(uc) - KD / 2, zc], 0.24, KD, this.color, (i > 0 ? J_START : 0) | (i < NS - 1 ? J_END : 0));
    }
  };

  /**
   * A frog-leg strut (kaerumata) in the middle of side `s`'s bay, `n` out: a
   * sill on the tie at `y0`, two splayed legs with a boss between them, a
   * block, and an arm under the purlin whose underside is `y1`.
   */
  frogLeg = (s: Side, n: number, y0: number, y1: number): void => {
    const { on, color } = this;
    const legH = (y1 - y0) * 0.5;
    on(s, n, 0, y0 + 0.05, 0.86, 0.1, 0.18, 0, color, 0, J_TOP);
    for (const e of [-1, 1]) on(s, n, e * 0.24, y0 + 0.1 + legH / 2, 0.1, legH, 0.15, 0, color, e * 0.62);
    on(s, n, 0, y0 + 0.1 + legH * 0.42, 0.18, 0.24, 0.11, 0, color);
    const yb = y0 + 0.1 + legH;
    on(s, n, 0, yb + 0.06, 0.42, 0.12, 0.2, 0, color);
    on(s, n, 0, yb + 0.12 + (y1 - 0.2 - yb - 0.12) / 2, 0.24, y1 - 0.2 - yb - 0.12, 0.22, 0, color, 0, J_TOP);
    this.arm(runsAlongX(s), 0, outward(s) * n, 1.1, y1 - 0.2, y1, 0.2);
  };

  /**
   * The eave's rafters in two layers on every side: the base rafters from
   * `from` out (or the hip) to 0.9 past the side's purlin line `purlinAt(s)`,
   * the flying rafters from 0.7 past it to the eave, their ends painted white.
   */
  rafters = (purlinAt: (s: Side) => number, from = 0.14): void => {
    const { ex, ez } = this;
    for (const s of J_SIDES) {
      const along = runsAlongX(s) ? ex : ez;
      const nEave = runsAlongX(s) ? ez : ex;
      const N = purlinAt(s);
      const nB = N + 0.9;
      const nF = N + 0.7;
      const SP = 0.32;
      const K = Math.floor((along - 0.15) / SP);
      for (let k = -K; k <= K; k++) {
        const u = k * SP;
        const n0 = Math.max(from, this.nHip(s, u) + 0.12);
        const lay = (na: number, nc: number, wide: number, deep: number, cap: string | null): void => {
          if (nc - na < 0.15) return;
          const [xa, za] = this.at(s, u, na);
          const [xc, zc] = this.at(s, u, nc);
          const a: Point3 = [xa, this.soffit(xa, za) - deep / 2, za];
          const c: Point3 = [xc, this.soffit(xc, zc) - deep / 2, zc];
          this.member(a, c, wide, deep, this.color, J_TOP | J_START);
          if (cap) this.endFace(a, c, wide + 0.01, deep + 0.01, cap);
        };
        lay(n0, nB, 0.12, this.RB, null);
        lay(Math.max(nF, n0), nEave - 0.04, 0.1, this.RF, SHIKKUI);
      }
    }
  };

  /** A hip beam into each corner, its end capped in bronze and a wind bell hung from it. */
  hipBeams = (): void => {
    const { rx, ex, ez, sb } = this;
    J_CORNERS.forEach(([sx, sz]) => {
      const H = (f: number, deep: number): Point3 => {
        const x = sx * (rx + f * (ex - rx));
        const z = sz * f * ez;
        return [x, this.soffit(x, z) - deep / 2, z];
      };
      this.member(H(0.03, 0.3), H(0.82, 0.3), 0.26, 0.3, this.color, J_TOP | J_START);
      const a = H(0.74, 0.24);
      const c = H(0.995, 0.24);
      this.member(a, c, 0.22, 0.24, this.color, J_TOP | J_START);
      this.endFace(a, c, 0.24, 0.26, BRONZE);
      const [bx, by0, bz] = c;
      const by = by0 - 0.12;
      sb.box(0.025, 0.16, 0.025, bx, by - 0.08, bz, BRONZE);
      this.b.cyl(0.28, 0.12, 0.22, 8, bx, by - 0.3, bz, BRONZE);
      sb.box(0.02, 0.16, 0.02, bx, by - 0.52, bz, BRONZE);
      sb.box(0.13, 0.2, 0.012, bx, by - 0.7, bz, BRONZE, { y: Math.atan2(sx, sz) + Math.PI / 2 });
    });
  };

  /**
   * The tiles: round-tile rows, end tiles, the eave lip, the ridges and the
   * demon tiles. A pyramid (`tx` 0) has no main `ridge`, and whoever builds
   * one caps its apex instead.
   */
  tiles = (ridge = true): void => {
    const { roof, rx, ex, ez, sb, member, endFace, at } = this;
    const eave = roof.y;
    const RSP = 0.42;
    const RH = 0.12;
    const segLen = 0.9;
    const topAt = (x: number, z: number): number => roofHeight(roof, x, z);
    const row = (s: Side, u: number, n0: number, n1: number): void => {
      if (n1 - n0 < 0.2) return;
      const segs = Math.max(1, Math.ceil((n1 - n0) / segLen));
      for (let j = 0; j < segs; j++) {
        const na = n0 + ((n1 - n0) * j) / segs - (j > 0 ? 0.03 : 0);
        const nb = n0 + ((n1 - n0) * (j + 1)) / segs + (j < segs - 1 ? 0.03 : 0);
        const [xa, za] = at(s, u, na);
        const [xc, zc] = at(s, u, nb);
        const a: Point3 = [xa, topAt(xa, za) + RH / 2 - 0.025, za];
        const c: Point3 = [xc, topAt(xc, zc) + RH / 2 - 0.025, zc];
        const last = j === segs - 1;
        member(a, c, 0.15, RH, KAWARA_DARK, HIDE_UNDER | J_START | (last ? 0 : J_END));
        if (last) endFace(a, c, 0.17, 0.17, KAWARA_DARK);
      }
    };
    // The eave tiles' lip along every eave, swept up with the corners.
    for (const s of J_SIDES) {
      const half = runsAlongX(s) ? ex : ez;
      const nEave = runsAlongX(s) ? ez : ex;
      const NL = 14;
      const pt = (i: number): Point3 => {
        const [x, z] = at(s, -half + (2 * half * i) / NL, nEave);
        return [x, topAt(x, z) - 0.02, z];
      };
      for (let i = 0; i < NL; i++) member(pt(i), pt(i + 1), 0.05, 0.11, KAWARA_DARK, (i > 0 ? J_START : 0) | (i < NL - 1 ? J_END : 0));
    }
    for (const s of J_SIDES) {
      const along = runsAlongX(s) ? ex : ez;
      const nEave = runsAlongX(s) ? ez : ex;
      const K = Math.floor((along - 0.3) / RSP - 0.5);
      for (let k = -K - 1; k <= K; k++) {
        const u = (k + 0.5) * RSP;
        const n0 = runsAlongX(s) && Math.abs(u) <= rx - 0.1 ? 0.32 : this.nHip(s, u) + 0.2;
        row(s, u, n0, nEave + 0.02);
      }
    }
    /** A demon tile of scale `k` standing at `p0`, turned to `yaw`. */
    const oni = (p0: Point3, yaw: number, k: number): void => {
      sb.box(0.5 * k, 0.6 * k, 0.14 * k, p0[0], p0[1] + 0.3 * k, p0[2], KAWARA_DARK, { y: yaw });
      sb.box(0.34 * k, 0.32 * k, 0.22 * k, p0[0], p0[1] + 0.3 * k, p0[2], KAWARA_DARK, { y: yaw });
      sb.box(0.16 * k, 0.16 * k, 0.12 * k, p0[0], p0[1] + 0.66 * k, p0[2], KAWARA_DARK, { y: yaw, z: Math.PI / 4 });
      const c = Math.cos(yaw);
      const sn = Math.sin(yaw);
      for (const e of [-1, 1]) {
        sb.box(0.1 * k, 0.3 * k, 0.1 * k, p0[0] + e * 0.2 * k * c, p0[1] + 0.68 * k, p0[2] - e * 0.2 * k * sn, KAWARA_DARK, { y: yaw, z: -e * 0.35 });
      }
    };
    if (ridge) {
      // The main ridge: a base, courses banded in white, a round cap, a demon tile each end.
      const RL = 2 * rx + 0.6;
      const ry0 = eave + roof.rise - 0.05;
      sb.box(RL, 0.32, 0.72, 0, ry0 - 0.1, 0, KAWARA_DARK, undefined, HIDE_UNDER);
      let ridgeY = ry0 + 0.06;
      for (let i = 0; i < 3; i++) {
        const depth = 0.64 - i * 0.07;
        sb.box(RL, 0.1, depth, 0, ridgeY + 0.05, 0, KAWARA_DARK, undefined, HIDE_UNDER);
        ridgeY += 0.1;
        if (i < 2) {
          sb.box(RL - 0.05, 0.03, depth - 0.06, 0, ridgeY + 0.015, 0, SHIKKUI, undefined, HIDE_UNDER);
          ridgeY += 0.03;
        }
      }
      this.b.cyl(RL, 0.32, 0.32, 8, 0, ridgeY + 0.1, 0, KAWARA_DARK, { z: Math.PI / 2 });
      for (const sx of [-1, 1]) {
        oni([sx * (RL / 2 + 0.04), ry0 - 0.16, 0], Math.PI / 2, 1.5);
        sb.box(0.24, 0.24, 0.24, sx * (RL / 2 - 0.2), ridgeY + 0.3, 0, KAWARA_DARK, { y: Math.PI / 4 });
      }
    }
    /** A ridge from `a` to `c`: a body, a white band and a cap. */
    const ridgeRun = (a: Point3, c: Point3): void => {
      const up = (p0: Point3, dy: number): Point3 => [p0[0], p0[1] + dy, p0[2]];
      member(up(a, 0.12), up(c, 0.12), 0.38, 0.26, KAWARA_DARK, HIDE_UNDER | J_START | J_END);
      member(up(a, 0.11), up(c, 0.11), 0.42, 0.03, SHIKKUI, J_START | J_END | J_TOP | HIDE_UNDER);
      member(up(a, 0.3), up(c, 0.3), 0.22, 0.12, KAWARA_DARK, HIDE_UNDER | J_START | J_END);
    };
    for (const [sx, sz] of J_CORNERS) {
      const Hp = (f: number, lift: number): Point3 => {
        const x = sx * (rx + f * (ex - rx));
        const z = sz * f * ez;
        return [x, topAt(x, z) + lift, z];
      };
      const f0 = 0.06;
      const fOni = 1 - 0.8 / Math.hypot(ex - rx, ez);
      const nr = 4;
      for (let j = 0; j < nr; j++) ridgeRun(Hp(f0 + ((fOni - f0) * j) / nr, 0), Hp(f0 + ((fOni - f0) * (j + 1)) / nr, 0));
      oni(Hp(fOni + 0.01, 0), Math.atan2(sx * (ex - rx), sz * ez), 1.05);
      const a = Hp(fOni + 0.02, 0.07);
      const c = Hp(1.0, 0.07);
      member(a, c, 0.22, 0.18, KAWARA_DARK, HIDE_UNDER | J_START);
      endFace(a, c, 0.24, 0.22, KAWARA_DARK);
    }
  };

  /** The roof itself: the board lining the rafters hang under, then the sheet. */
  sheet = (): void => {
    const TH = this.roof.thick ?? 0.3;
    curvedRoof(this.b, CEDAR, { ...this.roof, raise: -TH - 0.004, thick: 0.02 });
    curvedRoof(this.b, KAWARA, this.roof);
  };
}

/** The four sides and the four corners, in the order `Joinery` walks them. */
export const J_SIDES: readonly Side[] = ["-z", "+z", "-x", "+x"];
export const J_CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const;
/** The faces a member laid from `a` to `c` along its own Z may hide. */
const J_TOP = 1 << 2;
export const J_START = 1 << 5;
export const J_END = 1 << 4;
