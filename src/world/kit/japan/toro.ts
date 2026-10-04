/**
 * kit/japan/toro.ts — buildToro: the Kasuga stone lantern.
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
  streetSeed,
  type V3,
} from "../core";
import { Lapidary, TAU } from "./lapidary";
import { GRANITE, GRANITE_DARK, SHOJI_GLOW, SUMI } from "./palette";

/**
 * A STONE LANTERN (tōrō), drawn as the KASUGA lantern that lines every temple
 * approach in the country — granite, in six parts stacked on a foundation
 * stone, each part the shape its name says:
 *
 * - **The foundation (kiban)**: a flat dressed hexagon, carried down to the
 *   lowest ground under it.
 * - **The base (kiso)**: a hexagon with a sunk panel in each face between
 *   corner stiles, and on top of it a ring of LOTUS PETALS turned down
 *   (kaeribana) round the seat of the shaft.
 * - **The shaft (sao)**: round, tapering, with the three-ringed node (fushi)
 *   at its middle and a collar at its head — and the dedication cut into its
 *   front above the node and the donor's name into its back below it.
 * - **The middle platform (chūdai)**: lotus petals turned UP under it
 *   (ukebana), sunk panels round its six faces, and a step for the firebox.
 * - **The firebox (hibukuro)**: six panels between corner posts on a sill
 *   under a head. The front and the back are the light windows, a paper
 *   screen in a timber frame; the two front corners are the SUN, a round
 *   hole, and the MOON, a crescent; the two back corners are the DEER of
 *   Kasuga in relief on a sunk ground, a stag on one and a hind on the
 *   other, walking toward the front.
 * - **The cap (kasa)**: a broad six-sided eave slab under a roof that
 *   steepens toward the top, a ridge down each corner running out into a
 *   curled fern-frond scroll (warabite), pale lichen on its slopes; and on it
 *   a lotus cup carrying the jewel (hōju).
 *
 * Its collider is its body at chest height and it is 1.9 m tall, so it bakes
 * as hard cover — which a granite post two feet thick is. The drawing keeps
 * inside the old silhouette's reach but for the scrolls, which are overhead.
 * `lit` puts a glow in the firebox, seen through the screens, the sun and the
 * moon, and nothing else: a lantern at dusk is a thing you SEE, and a garden
 * of them spending light slots would evict every lit interior on the map.
 *
 * It is in `CONFORMS_TO_TERRAIN`: the characters on its shaft, which deer is
 * the stag and where the lichen grows are seeded off where it stands, and the
 * foundation stone is carried down to the ground. Everything is drawn in the
 * 2.3 m lantern's own units and scaled once by `height` as it is emitted, and
 * it is batched into one surface per colour, because 37 lanterns of loose
 * parts would be a merge of thousands.
 */
export function buildToro(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "toro");
  const s = p.height ? p.height / 2.3 : 1;

  // --- the collider, exactly as it was -------------------------------------------
  b.block({ w: 0.62 * s, h: 1.95 * s, d: 0.62 * s, x: 0, y: 0.975 * s, z: 0 });

  // --- everything below is drawing -------------------------------------------
  const rnd = mulberry32(streetSeed(0.62, 0.62, 2.3 * s, ctx));
  /** The ground under a local point, in the lantern's own units. */
  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return (ctx.terrain.surfaceAt(ctx.x + (lx * cos + lz * sin) * s, ctx.z + (-lx * sin + lz * cos) * s) - ctx.y) / s;
  };
  const HEX = Math.PI / 3;
  const { sb, solid, lathe, slope, petals, faceAt, onFace, tube, lichen, flush } = new Lapidary(s);
  /** A six-sided ring, vertices at `rot + k/6` of a turn — flats toward ±Z by default. */
  const hexRing = (R: number, y: number, rot = 0): V3[] =>
    Array.from({ length: 6 }, (_, k): V3 => [R * Math.cos(rot + k * HEX), y, R * Math.sin(rot + k * HEX)]);
  const hex = (color: string, R0: number, y0: number, R1: number, y1: number, rot = 0): void =>
    solid(color, hexRing(R0, y0, rot), hexRing(R1, y1, rot));
  /** A post standing on the corner at bearing `v`, its centre `rc` out. */
  const onCorner = (v: number, rc: number, y: number, wide: number, tall: number, deep: number): void =>
    sb.box(wide * s, tall * s, deep * s, rc * Math.cos(v) * s, y * s, rc * Math.sin(v) * s, GRANITE, { y: Math.PI / 2 - v });
  /** The bearing of face `k`'s normal: 1 is the back (+Z), 4 the front (-Z). */
  const faceTh = (k: number): number => Math.PI / 6 + k * HEX;
  /** A stone laid on a face keeps its back out of the batch: it is buried. */
  const BURIED = 1 << 5;

  /**
   * A hexagon with a sunk panel in each face: a band under and over a dark
   * core set `sunk` back, and a stile on every corner.
   */
  const panelled = (R: number, y0: number, band: number, core: number, sunk: number): void => {
    const y1 = y0 + band;
    const y2 = y1 + core;
    hex(GRANITE, R, y0, R, y1);
    hex(GRANITE, R, y2, R, y2 + band);
    const stile = R * 0.12;
    for (let k = 0; k < 6; k++) onCorner(k * HEX, R - stile / 2 + 0.008, (y1 + y2) / 2, stile, core, stile);
    const Rc = R - sunk / Math.cos(Math.PI / 6);
    hex(GRANITE_DARK, Rc, y1, Rc, y2);
  };

  // The foundation stone, carried down to the lowest ground under it.
  {
    const R = 0.6;
    const ring = hexRing(R, 0, Math.PI / 6);
    const low = Math.min(0, ...ring.map((q) => ground(q[0], q[2]))) - 0.06;
    hex(GRANITE_DARK, R, low, R, 0.05, Math.PI / 6);
  }

  // The base: a panelled hexagon and the downturned lotus round the shaft's seat.
  panelled(0.52, 0.05, 0.04, 0.1, 0.028);
  const LOTUS = 12;
  const lotusPhase = -Math.PI / 2 - Math.PI / LOTUS;
  lathe(GRANITE, [[0, 0.23], [0.44, 0.23], [0.25, 0.33], [0, 0.33]], LOTUS, lotusPhase);
  petals(0.44, 0.23, 0.25, 0.33, LOTUS, lotusPhase, 0);

  // The shaft: a seat, the taper, the three-ringed node and a collar. Ten
  // facets with one square to the front and one to the back, so the
  // inscriptions lie flat on stone.
  const SAO = 10;
  const saoPhase = (3 * Math.PI) / 2 - Math.PI / SAO;
  lathe(
    GRANITE,
    [
      [0, 0.33],
      [0.25, 0.33],
      [0.25, 0.37],
      [0.2, 0.37],
      [0.19, 0.7],
      [0.205, 0.715],
      [0.19, 0.73],
      [0.225, 0.745],
      [0.225, 0.755],
      [0.19, 0.77],
      [0.205, 0.785],
      [0.183, 0.8],
      [0.17, 1.13],
      [0.21, 1.14],
      [0.21, 1.17],
      [0, 1.17],
    ],
    SAO,
    saoPhase,
  );
  {
    const radius = (y: number): number =>
      y < 0.75 ? 0.2 + ((0.19 - 0.2) * (y - 0.37)) / 0.33 : 0.183 + ((0.17 - 0.183) * (y - 0.8)) / 0.33;
    const inscribe = (th: number, yTop: number, n: number, gs: number): void => {
      const pitch = gs * 1.25;
      const t = gs * 0.14;
      for (let g = 0; g < n; g++) {
        const gy = yTop - (g + 0.5) * pitch;
        const strokes = 5 + Math.floor(rnd() * 3);
        for (let k = 0; k < strokes; k++) {
          const horiz = rnd() < 0.55;
          const len = gs * (0.35 + rnd() * 0.6);
          const u = (rnd() - 0.5) * (horiz ? gs - len : gs * 0.8);
          const y = gy + (rnd() - 0.5) * (horiz ? gs * 0.85 : gs - len);
          const lift = rnd() < 0.25 ? (rnd() - 0.5) * 1.2 : 0;
          const plane = radius(y) * Math.cos(Math.PI / SAO);
          onFace(th, plane, u, y, 0.001, horiz ? len : t, horiz ? t : len, 0.012, GRANITE_DARK, lift, BURIED);
        }
      }
    };
    inscribe((3 * Math.PI) / 2, 1.1, 2, 0.09);
    inscribe(Math.PI / 2, 0.66, 2, 0.08);
  }

  // The middle platform: upturned lotus under it, panelled faces, a step.
  lathe(GRANITE, [[0, 1.17], [0.21, 1.17], [0.38, 1.27], [0, 1.27]], LOTUS, lotusPhase);
  petals(0.21, 1.17, 0.38, 1.27, LOTUS, lotusPhase, 1);
  panelled(0.46, 1.27, 0.03, 0.08, 0.025);
  hex(GRANITE, 0.37, 1.41, 0.37, 1.44);

  // The firebox: a sill, six panels between corner posts, a head.
  const Af = 0.29;
  const T = 0.05;
  const fy0 = 1.49;
  const fy1 = 1.85;
  const yc = 1.67;
  const half = Af * Math.tan(Math.PI / 6);
  hex(GRANITE, 0.36, 1.44, 0.36, fy0);
  hex(GRANITE, 0.37, fy1, 0.37, 1.9);
  for (let k = 0; k < 6; k++) onCorner(k * HEX, 0.33, (fy0 + fy1) / 2, 0.07, fy1 - fy0, 0.08);
  /** A face's stone round a hole `hw` by `hh` at the firebox's centre height. */
  const pierced = (th: number, hw: number, hh: number): void => {
    const sw = half - hw / 2;
    for (const e of [-1, 1]) onFace(th, Af, e * (half - sw / 2), (fy0 + fy1) / 2, -T / 2, sw, fy1 - fy0, T, GRANITE);
    const top = yc + hh / 2;
    const bot = yc - hh / 2;
    onFace(th, Af, 0, (top + fy1) / 2, -T / 2, hw, fy1 - top, T, GRANITE);
    onFace(th, Af, 0, (fy0 + bot) / 2, -T / 2, hw, bot - fy0, T, GRANITE);
  };
  /** A round hole: a square one with its corners filled back to a twelve-sided circle. */
  const round = (th: number, rh: number): void => {
    pierced(th, rh * 2, rh * 2);
    const F = faceAt(th, Af);
    for (const su of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          const b0 = (i / 3) * (Math.PI / 2);
          const b1 = ((i + 1) / 3) * (Math.PI / 2);
          const pts: [number, number][] = [
            [su * rh, yc + sy * rh],
            [su * rh * Math.cos(b0), yc + sy * rh * Math.sin(b0)],
            [su * rh * Math.cos(b1), yc + sy * rh * Math.sin(b1)],
          ];
          solid(GRANITE, pts.map(([u, y]) => F(u, y, -T)), pts.map(([u, y]) => F(u, y, 0)));
        }
      }
    }
  };
  // Front and back: the light windows, a screen's frame and bars in each.
  for (const th of [faceTh(4), faceTh(1)]) {
    const hw = 0.19;
    const hh = 0.21;
    pierced(th, hw, hh);
    const bar = 0.018;
    for (const e of [-1, 1]) {
      onFace(th, Af, e * (hw / 2 - bar / 2), yc, -0.035, bar, hh, 0.02, SUMI);
      onFace(th, Af, 0, yc + e * (hh / 2 - bar / 2), -0.035, hw - bar * 2, bar, 0.02, SUMI);
    }
    onFace(th, Af, 0, yc, -0.037, bar * 0.6, hh - bar * 2, 0.012, SUMI);
    onFace(th, Af, 0, yc + 0.012, -0.037, hw - bar * 2, bar * 0.6, 0.012, SUMI);
  }
  // The front corners: the sun on the east, the moon on the west — a round
  // hole with a disc set into its back, off centre, leaving a crescent.
  const RH = 0.085;
  round(faceTh(5), RH);
  round(faceTh(3), RH);
  {
    const F = faceAt(faceTh(3), Af);
    const disc = (w: number): V3[] =>
      Array.from({ length: 12 }, (_, i): V3 => {
        const a = (i / 12) * TAU;
        return F(-0.42 * RH + RH * 0.94 * Math.cos(a), yc + 0.22 * RH + RH * 0.94 * Math.sin(a), w);
      });
    solid(GRANITE, disc(-T + 0.004), disc(-0.012));
  }
  // The back corners: the deer on a sunk ground inside a frame, walking to
  // the front. The figure stands 2.4 cm off the ground and the frame 3 cm,
  // which is what a relief needs to be seen at all (craft.md).
  const stag = rnd() < 0.5 ? 0 : 2;
  for (const k of [0, 2]) {
    const th = faceTh(k);
    const dir = Math.cos(th) > 0 ? -1 : 1;
    const fw = 0.045;
    for (const e of [-1, 1]) {
      onFace(th, Af, e * (half - fw / 2), (fy0 + fy1) / 2, -T / 2, fw, fy1 - fy0, T, GRANITE);
      onFace(th, Af, 0, e > 0 ? fy1 - fw / 2 : fy0 + fw / 2, -T / 2, half * 2 - fw * 2, fw, T, GRANITE);
    }
    onFace(th, Af, 0, (fy0 + fy1) / 2, -0.045, half * 2 - fw * 2, fy1 - fy0 - fw * 2, 0.03, GRANITE_DARK);
    const part = (u: number, y: number, along: number, tall: number, lift: number): void =>
      onFace(th, Af, dir * u, yc + y, -0.02, along, tall, 0.028, GRANITE, dir * lift, BURIED);
    part(0, -0.005, 0.12, 0.052, 0.05);
    part(0.058, 0.035, 0.028, 0.07, -0.45);
    part(0.087, 0.068, 0.046, 0.026, -0.35);
    part(0.067, 0.085, 0.012, 0.024, 0.6);
    part(-0.066, 0.016, 0.02, 0.012, 0.5);
    for (const [u, lean] of [
      [0.052, 0.12],
      [0.036, -0.08],
      [-0.038, 0.1],
      [-0.053, -0.15],
    ] as const) {
      part(u, -0.066, 0.013, 0.075, lean);
    }
    if (k === stag) {
      part(0.064, 0.108, 0.01, 0.05, 0.35);
      part(0.08, 0.118, 0.008, 0.03, -0.3);
      part(0.056, 0.128, 0.008, 0.026, 0.9);
    }
  }
  if (p.litWindows) b.glow(0.32 * s, 0.34 * s, 0.32 * s, 0, yc * s, 0, SHOJI_GLOW);
  else b.box(0.32 * s, 0.34 * s, 0.32 * s, 0, yc * s, 0, SUMI);

  // The cap: a bed, the eave slab, a roof that steepens to the top.
  hex(GRANITE_DARK, 0.42, 1.9, 0.42, 1.93);
  hex(GRANITE_DARK, 0.66, 1.93, 0.66, 2.0);
  hex(GRANITE_DARK, 0.63, 2.0, 0.44, 2.05);
  hex(GRANITE_DARK, 0.44, 2.05, 0.15, 2.21);
  // A ridge down each corner, running out over the eave into its scroll. The
  // scroll is small and tight — drawn a hand high it read as a pair of horns.
  {
    const roofY = (R: number): number => (R > 0.44 ? 2.0 + ((0.63 - R) / 0.19) * 0.05 : 2.05 + ((0.44 - R) / 0.29) * 0.16);
    const path: [number, number, number, number][] = [
      [0.17, roofY(0.17) + 0.01, 0.034, 0.04],
      [0.44, roofY(0.44) + 0.012, 0.04, 0.044],
      [0.6, roofY(0.6) + 0.014, 0.044, 0.046],
      [0.645, 2.02, 0.046, 0.046],
      [0.675, 2.044, 0.044, 0.042],
      [0.686, 2.078, 0.04, 0.036],
      [0.67, 2.102, 0.036, 0.03],
      [0.649, 2.094, 0.032, 0.026],
      [0.647, 2.073, 0.028, 0.022],
    ];
    for (let k = 0; k < 6; k++) tube(GRANITE_DARK, path, k * HEX);
  }
  // Lichen on the slopes: three or four patches of overlapping pale lobes.
  {
    const c30 = Math.cos(Math.PI / 6);
    const t30 = Math.tan(Math.PI / 6);
    const patches = 3 + Math.floor(rnd() * 2);
    for (let i = 0; i < patches; i++) {
      const th = faceTh(Math.floor(rnd() * 6));
      const upper = rnd() < 0.6;
      const [a0, y0, a1, y1] = upper ? [0.44 * c30, 2.05, 0.15 * c30, 2.21] : [0.63 * c30, 2.0, 0.44 * c30, 2.05];
      const at = slope(a0, y0, a1, y1, th);
      const L = Math.hypot(a1 - a0, y1 - y0);
      const f0 = upper ? 0.15 + rnd() * 0.4 : 0.3 + rnd() * 0.4;
      const u0 = (rnd() - 0.5) * (a0 + (a1 - a0) * f0) * t30;
      lichen(rnd, at, L, f0, u0, (f) => (a0 + (a1 - a0) * f) * t30);
    }
  }
  // The jewel: a step, a neck, a lotus cup and the pointed pearl in it.
  const TOP = 8;
  const topPhase = -Math.PI / 2 - Math.PI / TOP;
  lathe(
    GRANITE,
    [
      [0, 2.195],
      [0.16, 2.195],
      [0.16, 2.25],
      [0.1, 2.25],
      [0.09, 2.27],
      [0.145, 2.335],
      [0.105, 2.335],
      [0.12, 2.37],
      [0.128, 2.41],
      [0.112, 2.45],
      [0.07, 2.495],
      [0.03, 2.54],
      [0, 2.585],
    ],
    TOP,
    topPhase,
  );
  petals(0.09, 2.27, 0.145, 2.335, TOP, topPhase, 1);

  flush(b);
  return b;
}
