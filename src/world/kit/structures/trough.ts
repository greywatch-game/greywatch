/**
 * kit/structures/trough.ts — buildTrough: the stone cattle trough and its
 * hitching rail. Part of the structures set: follows the contract in
 * kit/core.ts, and the cover heights and round-collider rule in `./index.ts`.
 */
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import { mulberry32 } from "../../rng";
import {
  Build,
  type BuildCtx,
  type BuildParams,
  type Point3,
  type Structure,
  type V3,
  Lay,
  AWNING,
  DARK_STONE,
  IRON,
  MOSS_STONE,
  PITCH,
  PLANK,
  RUST,
  SAILCLOTH,
  STONE,
  STRAW,
  TAU,
  TIMBER,
  band,
  convexSolid,
  disc,
  log,
  rod,
  rope,
  streetSeed,
} from "../core";

/** The trough's outer length and breadth, and its rim: the collider's. */
const LEN = 3.0;
const DEEP = 1.1;
const TOP = 1.0;
/** The plinth course's head, which the slabs stand on. */
const BASE = 0.12;
/** The slabs' thickness, so the inside is `LEN - 2 * SLAB` by `DEEP - 2 * SLAB`. */
const SLAB = 0.14;
/** The standing water's surface. */
const WATER = 0.8;
/** Where the hitching rail runs, and its posts. */
const RAIL_Z = 1.6;
const RAIL_Y = 1.25;
const POST_X = 1.3;

/** A post's octagon: 0.16 square with its arrises taken off. */
function octagon(x: number, y: number, z: number, half: number, cut: number): Point3[] {
  const c = half - cut;
  return [
    [x - c, y, z - half],
    [x + c, y, z - half],
    [x + half, y, z - c],
    [x + half, y, z + c],
    [x + c, y, z + half],
    [x - c, y, z + half],
    [x - half, y, z + c],
    [x - half, y, z - c],
  ];
}

/**
 * Stone water trough and hitching rail. Low cover — cross it, don't hide.
 *
 * **The two colliders are what they always were, declared first and in the
 * same order**: the trough's box a metre high, and the rail's 1.4 m box
 * behind it. Everything after them is drawing, and every drawn part is
 * inside one of them, low enough to walk over (the plinth's toe), or on top
 * of one (the cramps, the chamber's lid and its ring).
 *
 * **It is a village trough of the waterworks' age, built as one**: two long
 * side slabs and two end slabs of dressed stone stood on a plinth course,
 * each joint a step the ink finds (the ends set a centimetre back from the
 * sides' arrises), the corners tied across the rim with iron cramps whose
 * rust runs down the faces under them. A sunk panel framed in a raised
 * margin is dressed into both long faces, on a dark ground because a margin
 * two centimetres proud is otherwise invisible (craft.md). The rim is worn
 * hollow where buckets and muzzles have rested on it, and the hollow is a
 * real dip in the slab's head rather than a stain. One end is boxed off
 * under a stone lid with a lifting ring — the chamber the ball valve sits in
 * — fed by a pipe up its end face out of the plinth, and the other end lets
 * the water go through an overflow spout, the face under it streaked green.
 * Inside, slime marks the water line and a few leaves float.
 *
 * **What it is NOT drawn with is moss outside or a date on its panel**: one
 * builder stands in a wet village and in a desert town, and only what any
 * standing water does to stone it stands in — the line, the damp foot, the
 * streak under the overflow — reads true in both.
 *
 * **The rail is oak posts with their arrises off**, weathered to a point on
 * top, rotting at the foot and carried down to the ground, with the rail
 * through them pegged and strapped, its top worn pale, and tethering rings on
 * staples along its face. Seeded, on some: a lead rope left on a ring, a
 * blanket thrown over the rail, a bucket stood under it — all inside the
 * rail's box.
 *
 * **Seeded off where it stands** (`streetSeed`, which is why it is in
 * `CONFORMS_TO_TERRAIN`): which end the chamber is at, where the rim is worn
 * and on which side, a mended crack, the overflow's place, the leaves, the
 * rings, and what is left at the rail. The plinth, the posts and the bucket
 * are carried down to the ground. Nothing seeded reaches a collider.
 */
export function buildTrough(
  mats: CelMaterialFactory,
  _p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(mats, "trough");

  // --- the colliders, as they always were ------------------------------------
  b.block({ w: 3.0, h: 1.0, d: 1.1, x: 0, y: 0.5, z: 0 });
  b.block({ w: 3.0, h: 1.4, d: 0.4, x: 0, y: 0.7, z: 1.6 });

  const rnd = mulberry32(streetSeed(LEN, DEEP, TOP, ctx));
  const lay = new Lay();
  const sb = lay.sb;
  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };

  const xo = LEN / 2;
  const xi = xo - SLAB;
  const zo = DEEP / 2;
  const zi = zo - SLAB;
  /** The ends' outer faces, set back from the sides' arrises so the joint is a step. */
  const xe = xo - 0.01;
  /** The chamber's end (the other lets the water go). */
  const chamber = rnd() < 0.5 ? -1 : 1;
  const spill = -chamber;

  /**
   * A point on one of the four outer faces: `side` is the face's outward
   * axis (`"-z"` the front), `u` runs to the right as you face it, `off`
   * stands it proud.
   */
  type Side = "-z" | "+z" | "-x" | "+x";
  const at = (s: Side, u: number, y: number, off: number): V3 => {
    switch (s) {
      case "-z":
        return [u, y, -zo - off];
      case "+z":
        return [-u, y, zo + off];
      case "+x":
        return [xe + off, y, u];
      case "-x":
        return [-xe - off, y, -u];
    }
  };
  const normal: Record<Side, V3> = { "-z": [0, 0, -1], "+z": [0, 0, 1], "+x": [1, 0, 0], "-x": [-1, 0, 0] };
  /** A star-shaped patch laid on a face, fanned from its centre. */
  const patch = (s: Side, pts: readonly (readonly [number, number])[], off: number, color: string): void => {
    const m = lay.m(color);
    let cu = 0;
    let cy = 0;
    for (const [u, y] of pts) {
      cu += u / pts.length;
      cy += y / pts.length;
    }
    const c = at(s, cu, cy, off);
    for (let i = 0; i < pts.length; i++) {
      const [u0, y0] = pts[i];
      const [u1, y1] = pts[(i + 1) % pts.length];
      m.tri(c, at(s, u0, y0, off), at(s, u1, y1, off), normal[s]);
    }
  };
  /** A box laid flat on a face: `along` by `tall`, `thick` deep, its back `off` proud. */
  const onFace = (s: Side, u: number, y: number, along: number, tall: number, thick: number, off: number, color: string): void => {
    const [x, , z] = at(s, u, y, off + thick / 2);
    if (s === "-z" || s === "+z") sb.box(along, tall, thick, x, y, z, color);
    else sb.box(thick, tall, along, x, y, z, color);
  };
  const sides: Side[] = ["-z", "+z", "-x", "+x"];
  const halfOf = (s: Side): number => (s === "-z" || s === "+z" ? xo : zo);

  // --- the plinth course, carried down to the ground --------------------------
  const px = 1.57;
  const pz = 0.59;
  let deepest = 0;
  for (const [x0, x1] of [
    [-px, -0.528],
    [-0.513, 0.513],
    [0.528, px],
  ]) {
    let low = 0;
    for (const x of [x0, x1]) for (const z of [-pz, pz]) low = Math.min(low, ground(x, z));
    deepest = Math.min(deepest, low);
    const y0 = low - 0.04;
    sb.box(x1 - x0, BASE - y0, 2 * pz, (x0 + x1) / 2, (BASE + y0) / 2, 0, STONE);
  }

  // --- the damp foot, and the stains ------------------------------------------
  for (const s of sides) {
    const h = halfOf(s) - 0.02;
    const ph = rnd() * TAU;
    const n = s === "-z" || s === "+z" ? 12 : 5;
    const m = lay.m(DARK_STONE);
    const head = (u: number): number => 0.25 + 0.05 * Math.sin(u * 2.3 + ph) + 0.025 * Math.sin(u * 6.1 + ph * 3);
    for (let k = 0; k < n; k++) {
      const ua = -h + (2 * h * k) / n;
      const ub = -h + (2 * h * (k + 1)) / n;
      m.quad(at(s, ua, BASE, 0.003), at(s, ub, BASE, 0.003), at(s, ub, head(ub), 0.003), at(s, ua, head(ua), 0.003), normal[s]);
    }
  }

  // --- the sunk panels in the long faces --------------------------------------
  for (const s of ["-z", "+z"] as Side[]) {
    const pu = 0.86;
    const y0 = 0.36;
    const y1 = 0.8;
    const w = 0.055;
    onFace(s, 0, y1 - w / 2, 2 * pu, w, 0.022, 0, STONE);
    onFace(s, 0, y0 + w / 2, 2 * pu, w, 0.022, 0, STONE);
    onFace(s, -pu + w / 2, (y0 + y1) / 2, w, y1 - y0 - 2 * w, 0.022, 0, STONE);
    onFace(s, pu - w / 2, (y0 + y1) / 2, w, y1 - y0 - 2 * w, 0.022, 0, STONE);
    onFace(s, 0, (y0 + y1) / 2, 2 * (pu - w), y1 - y0 - 2 * w, 0.006, 0, DARK_STONE);
    if (s === "-z") {
      // A boss on the front's ground, where a donor's roundel would go.
      const c = at(s, 0, (y0 + y1) / 2, 0.006);
      log(lay.m(STONE), c, [c[0], c[1], c[2] - 0.018], 0.085, 10);
    }
  }

  // --- the cramps across the corner joints, and their rust ----------------------
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * (xi + SLAB / 2);
      sb.box(0.03, 0.012, 0.22, x, TOP + 0.006, sz * (zi + 0.02), IRON);
      const s: Side = sz < 0 ? "-z" : "+z";
      const u = s === "-z" ? x : -x;
      patch(s, [
        [u - 0.018, TOP - 0.01],
        [u + 0.018, TOP - 0.01],
        [u + 0.006 + (rnd() - 0.5) * 0.02, TOP - 0.22 - rnd() * 0.15],
        [u - 0.006, TOP - 0.2 - rnd() * 0.1],
      ], 0.003, RUST);
    }
  }

  // --- a mended crack, on some ------------------------------------------------
  if (rnd() < 0.45) {
    const s: Side = rnd() < 0.5 ? "-z" : "+z";
    const u0 = (rnd() < 0.5 ? -1 : 1) * (0.98 + rnd() * 0.25);
    let p: V3 = at(s, u0, TOP - 0.005, 0.002);
    let u = u0;
    for (let y = TOP - 0.005; y > 0.42; ) {
      const dy = 0.07 + rnd() * 0.06;
      u += (rnd() - 0.5) * 0.06;
      y -= dy;
      const q = at(s, u, y, 0.002);
      rod(lay, p, q, 0.011, DARK_STONE);
      p = q;
    }
    // The strap a mason leaded across it, and the rust under the strap.
    onFace(s, u0, 0.88, 0.32, 0.045, 0.008, 0, IRON);
    for (const k of [-1, 1]) onFace(s, u0 + k * 0.13, 0.88, 0.026, 0.026, 0.012, 0.008, IRON);
    patch(s, [
      [u0 - 0.1, 0.857],
      [u0 + 0.1, 0.857],
      [u0 + 0.03, 0.62],
      [u0 - 0.02, 0.66],
    ], 0.003, RUST);
  }

  // --- the overflow, and the water it lets go -----------------------------------
  {
    const s: Side = spill > 0 ? "+x" : "-x";
    const zs = (rnd() - 0.5) * 0.4;
    const u = s === "+x" ? zs : -zs;
    const y = WATER - 0.03;
    log(lay.m(IRON), [spill * (xe - 0.01), y, zs], [spill * (xe + 0.012), y, zs], 0.045, 8);
    log(lay.m(IRON), [spill * (xe - 0.02), y, zs], [spill * (xe + 0.075), y - 0.006, zs], 0.022, 8);
    // Wet stone a stop darker, and the weed the trickle keeps alive down its middle.
    patch(s, [
      [u - 0.035, y - 0.03],
      [u + 0.04, y - 0.03],
      [u + 0.07, (y + BASE) / 2],
      [u + 0.1, BASE + 0.005],
      [u - 0.085, BASE + 0.005],
      [u - 0.055, (y + BASE) / 2],
    ], 0.004, DARK_STONE);
    patch(s, [
      [u - 0.012, y - 0.035],
      [u + 0.014, y - 0.035],
      [u + 0.03, (y + BASE) / 2],
      [u + 0.035, BASE + 0.005],
      [u - 0.03, BASE + 0.005],
      [u - 0.02, (y + BASE) / 2],
    ], 0.007, MOSS_STONE);
    // Wet on the plinth's head under it.
    sb.box(0.06, 0.008, 0.2, spill * (xe + 0.035), BASE + 0.004, zs, DARK_STONE);
  }

  // --- the chamber's feed: a pipe up out of the plinth, into the end slab ------
  {
    const zp = (rnd() < 0.5 ? -1 : 1) * (0.18 + rnd() * 0.12);
    const xp = chamber * (xe + 0.03);
    const m = lay.m(IRON);
    log(m, [xp, BASE - 0.02, zp], [xp, 0.9, zp], 0.026, 8);
    log(m, [xp, 0.9, zp], [chamber * (xe - 0.02), 0.9, zp], 0.026, 8);
    for (const y of [0.35, 0.7]) sb.box(0.065, 0.03, 0.065, xp, y, zp, IRON);
    log(m, [xp, BASE - 0.005, zp], [xp, BASE + 0.03, zp], 0.045, 8);
  }

  // --- inside: the water line, the chamber's wall, what floats -------------------
  {
    const line = (y0: number, y1: number): void => {
      const t = 0.004;
      sb.box(2 * xi, y1 - y0, t, 0, (y0 + y1) / 2, -zi + t / 2, MOSS_STONE);
      sb.box(2 * xi, y1 - y0, t, 0, (y0 + y1) / 2, zi - t / 2, MOSS_STONE);
      sb.box(t, y1 - y0, 2 * zi, -xi + t / 2, (y0 + y1) / 2, 0, MOSS_STONE);
      sb.box(t, y1 - y0, 2 * zi, xi - t / 2, (y0 + y1) / 2, 0, MOSS_STONE);
    };
    line(WATER - 0.01, WATER + 0.028);
    // The chamber's dividing slab, standing in the water.
    const xw = chamber * (xi - 0.3);
    sb.box(0.06, TOP - 0.004 - (WATER - 0.05), 2 * zi, xw, (TOP - 0.004 + WATER - 0.05) / 2, 0, STONE);
    // Leaves, and once in a while a scum of weed in a corner.
    const leaves = 2 + Math.floor(rnd() * 6);
    for (let k = 0; k < leaves; k++) {
      const x = (rnd() - 0.5) * 2 * (xi - 0.4) - chamber * 0.15;
      const z = (rnd() - 0.5) * 2 * (zi - 0.06);
      sb.box(0.065, 0.004, 0.04, x, WATER + 0.004, z, rnd() < 0.6 ? STRAW : PLANK, { y: rnd() * TAU });
    }
    if (rnd() < 0.5) {
      const m = lay.m(MOSS_STONE);
      const cx = spill * (xi - 0.18);
      const cz = (rnd() < 0.5 ? -1 : 1) * (zi - 0.16);
      const n = 12;
      const ph = rnd() * TAU;
      for (let k = 0; k < n; k++) {
        const t0 = (k / n) * TAU;
        const t1 = ((k + 1) / n) * TAU;
        const r = (t: number): number => 0.13 * (1 + 0.25 * Math.sin(3 * t + ph));
        m.tri([cx, WATER + 0.006, cz], [cx + Math.cos(t0) * r(t0) * 1.3, WATER + 0.006, cz + Math.sin(t0) * r(t0)], [cx + Math.cos(t1) * r(t1) * 1.3, WATER + 0.006, cz + Math.sin(t1) * r(t1)], [0, 1, 0]);
      }
    }
  }

  // --- the chamber's lid, and its ring -----------------------------------------
  {
    const xa = chamber * (xi - 0.33);
    const xb = chamber * xo;
    const x0 = Math.min(xa, xb);
    const x1 = Math.max(xa, xb);
    const lz = zo - 0.025;
    const rect = (y: number, inset: number): Point3[] => [
      [x0 + inset, y, -lz + inset],
      [x1 - inset, y, -lz + inset],
      [x1 - inset, y, lz - inset],
      [x0 + inset, y, lz - inset],
    ];
    sb.box(x1 - x0, 0.045, 2 * lz, (x0 + x1) / 2, TOP + 0.0225, 0, STONE);
    convexSolid(b, rect(TOP + 0.045, 0), rect(TOP + 0.068, 0.022), STONE);
    const cx = (x0 + x1) / 2;
    const r = 0.05;
    const n = 10;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * TAU;
      const a1 = ((k + 1) / n) * TAU;
      rod(lay, [cx + Math.cos(a0) * r, TOP + 0.074, 0.09 + Math.sin(a0) * r], [cx + Math.cos(a1) * r, TOP + 0.074, 0.09 + Math.sin(a1) * r], 0.012, IRON);
    }
    sb.box(0.03, 0.014, 0.04, cx, TOP + 0.074, 0.09 - r - 0.015, IRON);
  }

  // --- the hitching rail ---------------------------------------------------------
  const blanket = rnd() < 0.35;
  const posts: (() => void)[] = [];
  for (const sx of [-1, 1]) {
    const x = sx * POST_X;
    const g = ground(x, RAIL_Z);
    posts.push(() => {
      convexSolid(b, octagon(x, g - 0.05, RAIL_Z, 0.08, 0.025), octagon(x, 1.36, RAIL_Z, 0.08, 0.025), TIMBER);
      convexSolid(b, octagon(x, 1.36, RAIL_Z, 0.08, 0.025), octagon(x, 1.42, RAIL_Z, 0.03, 0.009), TIMBER);
    });
    // Rot at the foot, where the ground keeps it wet.
    convexSolid(b, octagon(x, g - 0.02, RAIL_Z, 0.083, 0.026), octagon(x, g + 0.14 + rnd() * 0.08, RAIL_Z, 0.083, 0.026), PITCH);
    // Straps above and below the rail, and the peg through the joint.
    for (const y of [RAIL_Y - 0.085, RAIL_Y + 0.085]) {
      convexSolid(b, octagon(x, y - 0.013, RAIL_Z, 0.086, 0.027), octagon(x, y + 0.013, RAIL_Z, 0.086, 0.027), IRON);
    }
    sb.box(0.032, 0.032, 0.014, x, RAIL_Y, RAIL_Z - 0.087, TIMBER);
  }
  {
    // The rail: a 140 x 120 section with its top arrises off, its ends cut back.
    const sec = (x: number, inset: number): Point3[] => [
      [x, RAIL_Y - 0.07 + inset, RAIL_Z - 0.06 + inset],
      [x, RAIL_Y - 0.07 + inset, RAIL_Z + 0.06 - inset],
      [x, RAIL_Y + 0.05, RAIL_Z + 0.06 - inset],
      [x, RAIL_Y + 0.07 - inset, RAIL_Z + 0.04],
      [x, RAIL_Y + 0.07 - inset, RAIL_Z - 0.04],
      [x, RAIL_Y + 0.05, RAIL_Z - 0.06 + inset],
    ];
    const e = LEN / 2;
    posts.push(() => {
      convexSolid(b, sec(-e, 0.015), sec(-e + 0.02, 0), TIMBER);
      convexSolid(b, sec(-e + 0.02, 0), sec(e - 0.02, 0), TIMBER);
      convexSolid(b, sec(e - 0.02, 0), sec(e, 0.015), TIMBER);
    });
    // Worn pale along its top where ropes and hands go.
    sb.box(2.1, 0.005, 0.055, 0, RAIL_Y + 0.0725, RAIL_Z, PLANK);
  }
  {
    // Tethering rings on staples along the rail's face.
    const spots = blanket ? [-0.95, 0.95] : [-0.8, -0.05, 0.75];
    const roped = rnd() < 0.5 ? Math.floor(rnd() * spots.length) : -1;
    spots.forEach((sx0, k) => {
      const x = sx0 + (rnd() - 0.5) * 0.14;
      const zf = RAIL_Z - 0.06;
      const ys = RAIL_Y - 0.035;
      rod(lay, [x - 0.025, ys, zf + 0.01], [x - 0.025, ys, zf - 0.02], 0.012, IRON);
      rod(lay, [x + 0.025, ys, zf + 0.01], [x + 0.025, ys, zf - 0.02], 0.012, IRON);
      rod(lay, [x - 0.031, ys, zf - 0.02], [x + 0.031, ys, zf - 0.02], 0.012, IRON);
      const r = 0.048;
      const lean = 0.15 + rnd() * 0.2;
      const e2: V3 = [0, -Math.cos(lean), -Math.sin(lean)];
      const top: V3 = [x, ys, zf - 0.02];
      const c: V3 = [top[0] + e2[0] * r, top[1] + e2[1] * r, top[2] + e2[2] * r];
      const ring = (t: number): V3 => [c[0] + Math.cos(t) * r, c[1] + Math.sin(t) * e2[1] * r, c[2] + Math.sin(t) * e2[2] * r];
      for (let i = 0; i < 10; i++) rod(lay, ring((i / 10) * TAU), ring(((i + 1) / 10) * TAU), 0.013, IRON);
      if (k === roped) {
        // A lead rope left knotted on the ring, its end hanging.
        const foot: V3 = [c[0] + e2[0] * r, c[1] + e2[1] * r, c[2] + e2[2] * r];
        sb.box(0.05, 0.045, 0.04, foot[0], foot[1] - 0.005, foot[2], STRAW, { z: 0.3 });
        const drift = (rnd() - 0.5) * 0.12;
        const end = 0.55 + rnd() * 0.2;
        const pts: Point3[] = [
          [foot[0] + 0.02, foot[1] - 0.02, foot[2]],
          [foot[0] + 0.04 + drift * 0.3, foot[1] - 0.2, foot[2] - 0.012],
          [foot[0] + 0.03 + drift, (foot[1] + end) / 2 - 0.05, foot[2] - 0.02],
          [foot[0] + drift * 0.6, end, foot[2] - 0.01],
        ];
        rope(b, pts, 0.026, 0.02, STRAW, 5);
        const tip = pts[pts.length - 1];
        for (let j = 0; j < 3; j++) {
          const a = (j / 3) * TAU + rnd();
          sb.box(0.006, 0.05, 0.006, tip[0] + Math.cos(a) * 0.008, tip[1] - 0.025, tip[2] + Math.sin(a) * 0.008, STRAW, { x: Math.sin(a) * 0.3, z: Math.cos(a) * 0.3 });
        }
      }
    });
  }
  if (blanket) {
    // A blanket thrown over the rail, longer on the side it was thrown from.
    const color = rnd() < 0.6 ? AWNING : SAILCLOTH;
    const m = lay.m(color);
    const w = 0.85 + rnd() * 0.15;
    const bx = (rnd() - 0.5) * 0.4;
    const n = 9;
    const yTop = RAIL_Y + 0.085;
    const hem = [0.74 + rnd() * 0.1, 0.86 + rnd() * 0.08];
    const skew = (rnd() - 0.5) * 0.08;
    for (const [sd, i] of [
      [-1, 0],
      [1, 1],
    ] as const) {
      const zt = RAIL_Z + sd * 0.066;
      const col = (k: number): [V3, V3] => {
        const x = bx - w / 2 + (w * k) / n;
        const fold = k % 2 ? 0.026 : 0.004;
        const yb = hem[i] + skew * (k / n - 0.5) + 0.02 * Math.sin(k * 1.7);
        return [
          [x, yTop, zt],
          [x + (rnd() - 0.5) * 0.02, yb, zt + sd * fold],
        ];
      };
      let [ta, ba] = col(0);
      for (let k = 1; k <= n; k++) {
        const [tb, bb] = col(k);
        m.quad(ta, tb, bb, ba, [0, 0, sd]);
        const inn = (p: V3): V3 => [p[0], p[1], p[2] - sd * 0.004];
        m.quad(inn(ta), inn(tb), inn(bb), inn(ba), [0, 0, -sd]);
        ta = tb;
        ba = bb;
      }
    }
    for (let k = 0; k < n; k++) {
      const xa = bx - w / 2 + (w * k) / n;
      const xb = bx - w / 2 + (w * (k + 1)) / n;
      m.quad([xa, yTop, RAIL_Z - 0.066], [xb, yTop, RAIL_Z - 0.066], [xb, yTop, RAIL_Z + 0.066], [xa, yTop, RAIL_Z + 0.066], [0, 1, 0]);
    }
  }
  const bucket = rnd() < 0.5;
  if (bucket) {
    // A bucket stood under the rail: staves, two hoops, a bail laid over.
    const x = (rnd() < 0.5 ? -1 : 1) * (0.3 + rnd() * 0.65);
    const z = RAIL_Z - 0.06;
    const g = ground(x, z);
    const ph = rnd() * TAU;
    const r0 = 0.122;
    const r1 = 0.142;
    const h = 0.3;
    const rAt = (y: number): number => r0 + ((r1 - r0) * y) / h;
    band(lay.m(PLANK), 12, ph, r0, g - 0.02, r1, g + h, x, z);
    for (const y of [0.05, 0.22]) band(lay.m(IRON), 12, ph, rAt(y) + 0.006, g + y, rAt(y + 0.03) + 0.006, g + y + 0.03, x, z);
    disc(lay.m(PLANK), 12, ph, r1, r1 - 0.014, g + h, true, x, z);
    disc(lay.m(DARK_STONE), 12, ph, r1 - 0.012, 0, g + h - 0.004, true, x, z);
    const ear = (sgn: number): V3 => [x + Math.sin(ph) * sgn * (r1 + 0.008), g + h - 0.03, z + Math.cos(ph) * sgn * (r1 + 0.008)];
    const e1: V3 = [Math.sin(ph), 0, Math.cos(ph)];
    const fall = 1.1 + rnd() * 0.3;
    const e2: V3 = [Math.cos(ph) * Math.sin(fall), Math.cos(fall), -Math.sin(ph) * Math.sin(fall)];
    const R = r1 + 0.008;
    const bail = (t: number): V3 => [x + e1[0] * Math.cos(t) * R + e2[0] * Math.sin(t) * R, g + h - 0.03 + e2[1] * Math.sin(t) * R, z + e1[2] * Math.cos(t) * R + e2[2] * Math.sin(t) * R];
    for (let k = 0; k < 7; k++) rod(lay, bail((k / 7) * Math.PI), bail(((k + 1) / 7) * Math.PI), 0.01, IRON);
    for (const sgn of [-1, 1]) {
      const e = ear(sgn);
      sb.box(0.02, 0.05, 0.03, e[0], e[1], e[2], IRON, { y: ph });
    }
  }

  // The drawing laid on the faces first, the slabs it covers after (craft.md).
  lay.flush(b);
  for (const post of posts) post();

  // --- the slabs ------------------------------------------------------------------
  // The long sides run the full length; the rim's head is chamfered both
  // ways, and on one side it is worn hollow where buckets and muzzles rest.
  const worn = rnd() < 0.5 ? -1 : 1;
  const xm = (rnd() - 0.5) * 1.1;
  const dip = 0.02 + rnd() * 0.012;
  const stations: [number, number][] = [
    [-xo, 0],
    [xm - 0.45, 0],
    [xm - 0.12, dip],
    [xm + 0.12, dip],
    [xm + 0.45, 0],
    [xo, 0],
  ];
  for (const sz of [-1, 1]) {
    const prof = (x: number, d: number): Point3[] => [
      [x, BASE, sz * zo],
      [x, TOP - 0.04 - d, sz * zo],
      [x, TOP - d, sz * (zo - 0.03)],
      [x, TOP - d, sz * (zi + 0.02)],
      [x, TOP - 0.02 - d, sz * zi],
      [x, BASE, sz * zi],
    ];
    const st = sz === worn ? stations : [stations[0], stations[stations.length - 1]];
    for (let i = 0; i + 1 < st.length; i++) convexSolid(b, prof(st[i][0], st[i][1]), prof(st[i + 1][0], st[i + 1][1]), STONE);
  }
  // The ends, between the sides and a centimetre behind their arrises.
  for (const sx of [-1, 1]) {
    const prof = (z: number): Point3[] => [
      [sx * xi, BASE, z],
      [sx * xe, BASE, z],
      [sx * xe, TOP - 0.035, z],
      [sx * (xe - 0.03), TOP, z],
      [sx * xi, TOP, z],
    ];
    convexSolid(b, prof(-zi), prof(zi), STONE);
  }
  // The water, and the trough's floor under it.
  sb.box(2 * xi, WATER - BASE, 2 * zi, 0, (WATER + BASE) / 2, 0, DARK_STONE);
  // What the plinth's joints are seen against.
  sb.box(2 * px - 0.04, BASE - deepest + 0.02, 2 * pz - 0.04, 0, (BASE + deepest - 0.04) / 2, 0, DARK_STONE);
  lay.flush(b);
  return b;
}
