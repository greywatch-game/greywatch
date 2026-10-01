/**
 * kit/japan/stonePagoda.ts — buildStonePagoda: the five-storey granite pagoda
 * of a Kamakura garden.
 * Part of the temple-town set: follows the contract in kit/core.ts and the
 * set's rules in `./index.ts`.
 */
import { Scene } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import { mulberry32 } from "../../rng";
import {
  Build,
  type BuildCtx,
  type BuildParams,
  type Structure,
  HIDE_UNDER,
  streetSeed,
} from "../core";
import { Lapidary, TAU, type TubePoint } from "./lapidary";
import { GRANITE, GRANITE_DARK } from "./palette";
import type { V3 } from "./roof";

/**
 * A STONE PAGODA (sekitō): a GOJŪ-NO-TŌ in granite, the five-storey tower of
 * a Kamakura garden, standing where the reference frame's is — the thing the
 * eye lands on first in the temple garden, as the big pagoda is the valley's.
 * A stone pagoda is a timber one said in stone, and every part is the stone
 * name for the wooden part it copies:
 *
 * - **The kerb (kiso-ishi)**: a course of dressed stones round the foot with
 *   open joints, each carried down to the ground under it.
 * - **The base (kidan)**: a block with two cusped panels (kōzama) sunk in
 *   each face between stiles, under a coping, and on it a square lotus with
 *   its petals turned down (kaeribana-za) round the seat of the shaft.
 * - **The first storey's shaft (shoju jikubu)**: the Buddhas of the four
 *   quarters, each seated on a lotus in a round niche with a roll round it,
 *   hands in the lap and a halo behind the head — the healing Buddha of the
 *   east holding his jar.
 * - **Five roof stones (kasa)**: each a thick eave cut plumb with its
 *   corners swept up and its underside swept with them, a slope steepening
 *   to a seat for the storey above, a hip ridge down each corner and the two
 *   steps under the eave that stand for the rafters; pale lichen on the
 *   slopes.
 * - **Four upper shafts (jikubu)**: a post at every corner, a sill and a head
 *   rail, a two-leaved door front and back and a barred window at each side.
 * - **The spire (sōrin)**: dew basin, inverted bowl, lotus, the nine rings,
 *   a second lotus and the jewel.
 *
 * Maple leaves lie on the kerb and on the lowest roofs.
 *
 * **The collider is unchanged**: the old block, a metre square to 3.2 m. The
 * drawing stands inside it but for three things, each of which the old
 * drawing already did: the base and the kerb (knee high), the roofs' eaves
 * (overhead from the second storey up, and a stone's thickness at the first),
 * and the upper storeys and the spire over the block's top. The first shaft
 * is the block's own face, its niches 3 cm into it and its figures 2 cm out.
 *
 * Drawn in the 4.4 m pagoda's own units and scaled once by `height` as it is
 * emitted — the spire's jewel stands at 4.8 of them, as the old finial stood
 * at 4.75 — and batched into one surface per colour through `Lapidary`. In
 * `CONFORMS_TO_TERRAIN`: the kerb's stones, the lichen and the leaves are
 * seeded off where it stands, and the kerb is carried down to the ground.
 */
export function buildStonePagoda(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "sekito");
  const s = p.height ? p.height / 4.4 : 1;

  // --- the collider, exactly as it was -------------------------------------------
  b.block({ w: 1.0 * s, h: 3.2 * s, d: 1.0 * s, x: 0, y: 1.6 * s, z: 0 });

  // --- everything below is drawing -------------------------------------------
  const rnd = mulberry32(streetSeed(1.5, 1.5, 4.4 * s, ctx));
  /** The ground under a local point, in the pagoda's own units. */
  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return (ctx.terrain.surfaceAt(ctx.x + (lx * cos + lz * sin) * s, ctx.z + (-lx * sin + lz * cos) * s) - ctx.y) / s;
  };
  const { sb, mesher, scaled, solid, lathe, slope, petals, leafRow, faceAt, onFace, tube, lichen, leaf, flush } = new Lapidary(s);
  const Q = Math.PI / 2;
  const SQ2 = Math.SQRT2;
  /** The faces' bearings: +X, the back (+Z), -X and the front (-Z). */
  const FACES = [0, Q, Math.PI, 3 * Q];
  const BACK = Q;
  const FRONT = 3 * Q;
  /** A box's faces are +x -x +y -y +z -z; a stone laid on a face has its back in -z. */
  const TOP = 1 << 2;
  const BURIED = 1 << 5;
  /** A square slab on the axis, half `h` a side. */
  const slab = (color: string, h: number, y0: number, y1: number, hide = 0): void =>
    sb.box(h * 2 * s, (y1 - y0) * s, h * 2 * s, 0, ((y0 + y1) / 2) * s, 0, color, undefined, hide);
  /**
   * An outline (u, y) carved on face `th` whose plane stands `plane` out: from
   * `w0` to `w1` off the plane, its front drawn in by `shrink` about its middle.
   */
  const relief = (
    th: number,
    plane: number,
    pts: [number, number][],
    w0: number,
    w1: number,
    color = GRANITE,
    shrink = 1,
    bedded = true,
  ): void => {
    const F = faceAt(th, plane);
    const cu = pts.reduce((t, q) => t + q[0], 0) / pts.length;
    const cy = pts.reduce((t, q) => t + q[1], 0) / pts.length;
    solid(
      color,
      pts.map(([u, y]) => F(u, y, w0)),
      pts.map(([u, y]) => F(cu + (u - cu) * shrink, cy + (y - cy) * shrink, w1)),
      bedded,
    );
  };
  const oval = (u: number, y: number, ru: number, ry: number, n = 8): [number, number][] =>
    Array.from({ length: n }, (_, i): [number, number] => [u + ru * Math.cos((i / n) * TAU), y + ry * Math.sin((i / n) * TAU)]);
  /**
   * The corner of a hole filled back to a quarter circle about (cu, cy) — the
   * corner is at (cu + su r, cy + sy r) — as a fan of flush stones.
   */
  const fillet = (th: number, plane: number, cu: number, cy: number, r: number, su: number, sy: number, depth: number, n = 6): void => {
    for (let i = 0; i < n; i++) {
      const b0 = (i / n) * Q;
      const b1 = ((i + 1) / n) * Q;
      relief(
        th,
        plane,
        [
          [cu + su * r, cy + sy * r],
          [cu + su * r * Math.cos(b0), cy + sy * r * Math.sin(b0)],
          [cu + su * r * Math.cos(b1), cy + sy * r * Math.sin(b1)],
        ],
        -depth,
        0,
        GRANITE,
        1,
        false,
      );
    }
  };

  const T = 0.03;

  // The base (kidan): a block with two cusped panels sunk in each face
  // between stiles, the panels showing its darker core — a relief needs a
  // dark ground to be seen at all (craft.md).
  const KH = 0.65;
  const KT = 0.12;
  const k1 = 0.27;
  for (const th of FACES) {
    onFace(th, KH, 0, KT + 0.0125, -T / 2, 2 * KH, 0.025, T, GRANITE, 0, BURIED);
    onFace(th, KH, 0, k1 - 0.015, -T / 2, 2 * KH, 0.03, T, GRANITE, 0, BURIED | TOP);
    const pb = KT + 0.025;
    const pt = k1 - 0.03;
    for (const [uc, wide] of [
      [-(KH - 0.035), 0.07],
      [0, 0.06],
      [KH - 0.035, 0.07],
    ]) {
      onFace(th, KH, uc, (pb + pt) / 2, -T / 2, wide, pt - pb, T, GRANITE, 0, BURIED);
    }
    for (const [ua, ub] of [
      [-(KH - 0.07), -0.03],
      [0.03, KH - 0.07],
    ]) {
      // The head rounded into the stiles, the feet curled, and a cusp hanging
      // from the middle of the head: the kōzama's outline.
      fillet(th, KH, ua + 0.04, pt - 0.04, 0.04, -1, 1, T);
      fillet(th, KH, ub - 0.04, pt - 0.04, 0.04, 1, 1, T);
      fillet(th, KH, ua + 0.018, pb + 0.018, 0.018, -1, -1, T, 3);
      fillet(th, KH, ub - 0.018, pb + 0.018, 0.018, 1, -1, T, 3);
      const um = (ua + ub) / 2;
      for (const e of [-1, 1]) {
        relief(th, KH, [[um, pt], [um + e * 0.075, pt], [um + e * 0.03, pt - 0.014]], -T, 0, GRANITE, 1, false);
        relief(th, KH, [[um, pt], [um + e * 0.03, pt - 0.014], [um, pt - 0.034]], -T, 0, GRANITE, 1, false);
      }
    }
  }
  slab(GRANITE_DARK, KH - T, KT, k1, TOP);
  slab(GRANITE, 0.675, k1, 0.3);
  // The downturned lotus: six broad petals a side on a square cone.
  {
    const [h0, y0, h1, y1] = [0.66, 0.3, 0.53, 0.36];
    lathe(GRANITE, [[0, y0], [h0 * SQ2, y0], [h1 * SQ2, y1], [0, y1]], 4, Math.PI / 4);
    for (const th of FACES) leafRow(slope(h0, y0, h1, y1, th), (f) => h0 + (h1 - h0) * f, 6, 0, 0.02);
  }
  slab(GRANITE, 0.53, 0.36, 0.375, TOP);

  // The first storey's shaft: a round niche in each face with a roll round
  // it, and in it the Buddha of that quarter seated on a lotus.
  const SH = 0.5;
  const S0 = 0.375;
  const S1 = 1.25;
  const NY = 0.81;
  const NR = 0.29;
  /** A seated Buddha, 2 cm proud of the face at its most: outlines about the niche's centre. */
  const buddha = (th: number, jar: boolean): void => {
    const carve = (pts: [number, number][], depth: number, shrink = 0.86): void =>
      relief(th, SH, pts.map(([u, y]): [number, number] => [u, NY + y]), -T - 0.004, -T + depth, GRANITE, shrink);
    carve(oval(0, 0.115, 0.1, 0.1, 16), 0.008, 0.97);
    carve([[-0.11, -0.26], [0.11, -0.26], [0.2, -0.19], [-0.2, -0.19]], 0.03, 0.92);
    for (let i = 0; i < 5; i++) {
      const u = -0.14 + i * 0.07;
      carve([[u - 0.028, -0.245], [u + 0.028, -0.245], [u + 0.03, -0.218], [u, -0.192], [u - 0.03, -0.218]], 0.04, 0.8);
    }
    carve([[-0.21, -0.19], [0.21, -0.19], [0.2, -0.14], [0.1, -0.11], [-0.1, -0.11], [-0.2, -0.14]], 0.04);
    carve([[-0.11, -0.13], [0.11, -0.13], [0.115, 0.02], [0.085, 0.05], [-0.085, 0.05], [-0.115, 0.02]], 0.042);
    for (const e of [-1, 1]) {
      carve([[e * 0.125, 0.03], [e * 0.095, 0.03], [e * 0.075, -0.125], [e * 0.165, -0.125]], 0.048);
      carve([[e * 0.05, 0.078], [e * 0.062, 0.084], [e * 0.062, 0.13], [e * 0.05, 0.136]], 0.036, 0.8);
    }
    carve(oval(0, -0.12, 0.065, 0.028), 0.052);
    if (jar) carve(oval(0, -0.098, 0.028, 0.026), 0.062);
    carve([[-0.03, 0.04], [0.03, 0.04], [0.03, 0.07], [-0.03, 0.07]], 0.038);
    carve(oval(0, 0.115, 0.05, 0.06, 10), 0.05);
    carve(oval(0, 0.178, 0.026, 0.022), 0.046);
  };
  for (const th of FACES) {
    for (const e of [-1, 1]) onFace(th, SH, (e * (SH + NR)) / 2, (S0 + S1) / 2, -T / 2, SH - NR, S1 - S0, T, GRANITE, 0, BURIED);
    onFace(th, SH, 0, (NY + NR + S1) / 2, -T / 2, 2 * NR, S1 - NY - NR, T, GRANITE, 0, BURIED);
    onFace(th, SH, 0, (S0 + NY - NR) / 2, -T / 2, 2 * NR, NY - NR - S0, T, GRANITE, 0, BURIED);
    for (const su of [-1, 1]) for (const sy of [-1, 1]) fillet(th, SH, 0, NY, NR, su, sy, T);
    for (let i = 0; i < 24; i++) {
      const a0 = (i / 24) * TAU;
      const a1 = ((i + 1) / 24) * TAU;
      const at = (r: number, a: number): [number, number] => [r * Math.cos(a), NY + r * Math.sin(a)];
      relief(th, SH, [at(NR - 0.005, a0), at(NR + 0.03, a0), at(NR + 0.03, a1), at(NR - 0.005, a1)], -0.004, 0.012, GRANITE, 1);
    }
    buddha(th, th === 0);
  }
  slab(GRANITE_DARK, SH - T, S0, S1, TOP);

  // The storeys: a roof stone on each shaft, and on each roof but the top
  // one the next shaft, a post at every corner and a door or a window in
  // every face.
  const BODY = [0.31, 0.275, 0.24, 0.205];
  const RISE = 0.12;
  const CURVE = 1.7;
  const UP = 0.055;
  const SEG = 8;
  /** The slope's rings, eave to top, as fractions of the way up it. */
  const SLOPE_T = [0, 0.12, 0.26, 0.42, 0.6, 0.8, 1];
  let under = SH;
  for (let i = 0; i < 5; i++) {
    const y = S1 + i * 0.6;
    const E = (1.55 - i * 0.15) / 2;
    const above = i < 4 ? BODY[i] : 0.165;
    const top = above + 0.06;
    const yu = y + 0.06;
    const ye = y + 0.135;
    const half = (t: number): number => E + (top - E) * t;
    const rise = (t: number): number => ye + RISE * Math.pow(t, CURVE);

    // The two steps under the eave, which stand for the rafters.
    slab(GRANITE_DARK, under + 0.05, y, y + 0.03, TOP);
    slab(GRANITE_DARK, under + 0.11, y + 0.03, yu, TOP);

    // The roof stone: a flat underside sweeping up into the corners, an eave
    // cut plumb, and a slope that steepens to the top — one closed solid,
    // wound against a point inside it.
    {
      const ring = (h: number, yy: number, lift: number): V3[] => {
        const pts: V3[] = [];
        for (let side = 0; side < 4; side++) {
          for (let j = 0; j < SEG; j++) {
            const u = -1 + (2 * j) / SEG;
            const [x, z] = side === 0 ? [u * h, -h] : side === 1 ? [h, u * h] : side === 2 ? [-u * h, h] : [-h, -u * h];
            pts.push([x, yy + UP * lift * Math.pow(Math.abs(u), 3), z]);
          }
        }
        return pts;
      };
      const rings = [
        ring(under + 0.11, yu, 0),
        ring(E - 0.09, yu, 0.15),
        ring(E, yu, 1),
        ...SLOPE_T.map((t) => ring(half(t), rise(t), (1 - t) * (1 - t))),
      ];
      const m = mesher(GRANITE_DARK);
      const C: V3 = [0, y + 0.12, 0];
      const hint = (...q: V3[]): V3 => [0, 1, 2].map((k) => q.reduce((t, v) => t + v[k], 0) / q.length - C[k]) as V3;
      const n = SEG * 4;
      for (let r = 0; r + 1 < rings.length; r++) {
        for (let j = 0; j < n; j++) {
          const a = rings[r][j];
          const c = rings[r][(j + 1) % n];
          const d = rings[r + 1][(j + 1) % n];
          const e = rings[r + 1][j];
          m.quad(scaled(a), scaled(c), scaled(d), scaled(e), hint(a, c, d, e));
        }
      }
      for (const [rg, cy] of [
        [rings[0], yu],
        [rings[rings.length - 1], rise(1)],
      ] as const) {
        const o: V3 = [0, cy, 0];
        for (let j = 0; j < n; j++) m.tri(scaled(o), scaled(rg[j]), scaled(rg[(j + 1) % n]), hint(o, rg[j], rg[(j + 1) % n]));
      }
    }
    // A hip ridge down each corner, flaring up off the eave's tip.
    {
      const path: TubePoint[] = SLOPE_T.slice()
        .reverse()
        .map((t): TubePoint => [half(t) * SQ2, rise(t) + UP * (1 - t) * (1 - t) + 0.009, 0.042, 0.026]);
      path.push([E * SQ2 + 0.014, ye + UP + 0.022, 0.036, 0.022]);
      for (let k = 0; k < 4; k++) tube(GRANITE_DARK, path, Math.PI / 4 + k * Q);
    }
    // The seat for what stands on it.
    slab(GRANITE_DARK, above + 0.035, y + 0.245, y + 0.275, i < 4 ? TOP : 0);
    // Lichen in a patch or two, on the slopes' middle, off the corners — laid
    // on a short chord of the curve so it neither floats nor sinks.
    {
      const patches = Math.floor(rnd() * 2.6);
      for (let j = 0; j < patches; j++) {
        const th = FACES[Math.floor(rnd() * 4)];
        const ta = 0.2 + rnd() * 0.35;
        const tb = ta + 0.3;
        const at = slope(half(ta), rise(ta), half(tb), rise(tb), th);
        const L = Math.hypot(half(tb) - half(ta), rise(tb) - rise(ta));
        const f0 = 0.3 + rnd() * 0.4;
        const u0 = (rnd() - 0.5) * 0.6 * half(ta);
        lichen(rnd, at, L, f0, u0, (f) => 0.45 * (half(ta) + (half(tb) - half(ta)) * f), -0.009);
      }
    }
    // Leaves come down on the two lowest roofs.
    if (i < 2) {
      const leaves = Math.floor(rnd() * (i === 0 ? 4 : 3));
      for (let j = 0; j < leaves; j++) {
        const th = FACES[Math.floor(rnd() * 4)];
        const at = slope(half(0.1), rise(0.1), half(0.45), rise(0.45), th);
        const L = Math.hypot(half(0.45) - half(0.1), rise(0.45) - rise(0.1));
        leaf(rnd, at, L, L * (0.25 + rnd() * 0.5), (rnd() - 0.5) * 0.8 * E, 0.04 + rnd() * 0.015, rnd() * TAU, -0.006);
      }
    }

    // The shaft of the storey above: corner posts, a sill and a head rail on
    // every face, a door of two leaves front and back and bars at the sides,
    // all on a dark core that the openings show.
    if (i < 4) {
      const yb = y + 0.275;
      const yt = y + 0.6;
      const hb = above;
      const cp = 0.05;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          sb.box(cp * s, (yt - yb) * s, cp * s, sx * (hb - cp / 2) * s, ((yb + yt) / 2) * s, sz * (hb - cp / 2) * s, GRANITE, undefined, TOP | HIDE_UNDER);
        }
      }
      const ow = hb - cp;
      const o0 = yb + 0.03;
      const o1 = yt - 0.04;
      const oh = o1 - o0;
      for (const th of FACES) {
        onFace(th, hb, 0, yt - 0.02, -0.01, 2 * ow, 0.04, 0.02, GRANITE, 0, BURIED | TOP);
        onFace(th, hb, 0, yb + 0.015, -0.01, 2 * ow, 0.03, 0.02, GRANITE, 0, BURIED | HIDE_UNDER);
        if (th === FRONT || th === BACK) {
          const lw = ow - 0.022;
          for (const e of [-1, 1]) {
            const u = e * (0.004 + lw / 2);
            onFace(th, hb, u, (o0 + o1) / 2, -0.012, lw, oh - 0.036, 0.014, GRANITE, 0, BURIED);
            onFace(th, hb, u, o0 + oh * 0.64, -0.003, lw - 0.024, 0.012, 0.006, GRANITE, 0, BURIED);
          }
        } else {
          for (let j = 0; j < 5; j++) onFace(th, hb, -ow + ((j + 0.5) * 2 * ow) / 5, (o0 + o1) / 2, -0.011, 0.022, oh, 0.018, GRANITE, 0, BURIED);
        }
      }
      slab(GRANITE_DARK, hb - 0.02, y + 0.24, yt, TOP);
    }
    under = above;
  }

  // The spire on the top roof's seat: the dew basin, the inverted bowl, a
  // lotus, the nine rings, a second lotus and the jewel.
  const Z = S1 + 4 * 0.6 + 0.275;
  slab(GRANITE, 0.165, Z, Z + 0.065, HIDE_UNDER);
  slab(GRANITE, 0.18, Z + 0.06, Z + 0.085);
  {
    const z = Z + 0.085;
    const ROUND = 12;
    const EIGHT = 8;
    const p12 = -Math.PI / 2 - Math.PI / ROUND;
    const p8 = -Math.PI / 2 - Math.PI / EIGHT;
    lathe(
      GRANITE,
      [
        [0, z],
        [0.15, z],
        [0.15, z + 0.015],
        [0.145, z + 0.035],
        [0.132, z + 0.058],
        [0.11, z + 0.078],
        [0.08, z + 0.09],
        [0.07, z + 0.09],
        [0.07, z + 0.105],
        [0, z + 0.105],
      ],
      ROUND,
      p12,
    );
    const u = z + 0.105;
    lathe(GRANITE, [[0, u], [0.06, u], [0.14, u + 0.055], [0.132, u + 0.065], [0, u + 0.065]], EIGHT, p8);
    petals(0.06, u, 0.14, u + 0.055, EIGHT, p8, 1);
    const r0 = u + 0.065;
    const rings: [number, number][] = [
      [0, r0],
      [0.068, r0],
    ];
    for (let k = 0; k < 9; k++) {
      const y0 = r0 + 0.01 + k * 0.05;
      const rs = 0.066 - k * 0.0022;
      const rr = rs + 0.028 - k * 0.001;
      rings.push([rs, y0], [rr, y0 + 0.012], [rr, y0 + 0.03], [rs, y0 + 0.042]);
    }
    const j0 = r0 + 0.46;
    rings.push([0.047, j0], [0, j0]);
    lathe(GRANITE, rings, 10, -Math.PI / 2 - Math.PI / 10);
    lathe(
      GRANITE,
      [
        [0, j0],
        [0.04, j0],
        [0.078, j0 + 0.028],
        [0.07, j0 + 0.036],
        [0.055, j0 + 0.038],
        [0.072, j0 + 0.06],
        [0.08, j0 + 0.082],
        [0.074, j0 + 0.105],
        [0.056, j0 + 0.128],
        [0.03, j0 + 0.148],
        [0, j0 + 0.165],
      ],
      EIGHT,
      p8,
    );
    petals(0.04, j0, 0.078, j0 + 0.028, EIGHT, p8, 1);
  }

  // The kerb: dressed stones with open joints round the foot, each carried
  // down to the lowest ground under it, on a core the joints show. The runs
  // at the ends butt between the front's and the back's.
  {
    const KERB = 0.78;
    const KD = 0.22;
    let low = 0;
    for (const th of FACES) {
      const end = th === 0 || th === Math.PI;
      const u0 = end ? -KERB + KD + 0.02 : -KERB;
      const u1 = -u0;
      const F = faceAt(th, KERB);
      let u = u0;
      while (u < u1 - 0.01) {
        let len = 0.36 + rnd() * 0.22;
        if (u1 - (u + len) < 0.24) len = u1 - u;
        const a = u === u0 ? u : u + 0.01;
        const c = u + len >= u1 - 1e-6 ? u1 : u + len - 0.01;
        const g =
          Math.min(
            ...[F(a, 0, 0), F(c, 0, 0), F(a, 0, -KD), F(c, 0, -KD)].map((q) => ground(q[0], q[2])),
          ) - 0.05;
        low = Math.min(low, g);
        const lid = KT + (rnd() - 0.5) * 0.006;
        onFace(th, KERB, (a + c) / 2, (g + lid) / 2, -KD / 2, c - a, lid - g, KD, GRANITE_DARK, 0, BURIED | HIDE_UNDER);
        u += len;
      }
    }
    slab(GRANITE_DARK, KERB - 0.05, low - 0.02, KT - 0.004, HIDE_UNDER);
    // Lichen on the kerb's ledge, and the maples' leaves come down on it.
    // The chord runs on in under the base, so a lobe that wanders inward is
    // hidden rather than hung off the kerb's front edge.
    const ledge = (th: number) => slope(KERB - 0.01, KT + 0.001, 0.52, KT + 0.001, th);
    const LL = KERB - 0.01 - 0.52;
    for (let j = Math.floor(rnd() * 3); j > 0; j--) {
      const th = FACES[Math.floor(rnd() * 4)];
      lichen(rnd, ledge(th), LL, 0.18 + rnd() * 0.12, (rnd() - 0.5) * 1.1, () => 0.62, -0.006);
    }
    for (let j = 5 + Math.floor(rnd() * 5); j > 0; j--) {
      const th = FACES[Math.floor(rnd() * 4)];
      leaf(rnd, ledge(th), LL, 0.04 + rnd() * 0.05, (rnd() - 0.5) * 1.4, 0.032 + rnd() * 0.014, rnd() * TAU, -0.002);
    }
  }

  flush(b);
  return b;
}
