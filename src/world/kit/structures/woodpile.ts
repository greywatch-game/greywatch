/**
 * kit/structures/woodpile.ts — buildWoodpile: a cord of split firewood.
 * Part of the structures set: follows the contract in kit/core.ts, and the
 * cover heights and round-collider rule in `./index.ts`.
 */
import { Scene, VertexData } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import { mulberry32 } from "../../rng";
import {
  Build,
  type BuildCtx,
  type BuildParams,
  type Structure,
  type Point3,
  streetSeed,
  IRON,
  PITCH,
  PLANK,
  STONE,
  STRAW,
  THATCH,
  TIMBER,
} from "../core";

/**
 * Woodpile: a cord of split firewood in two rows, stacked ends-out on a pair
 * of bearers and held at each end — cover to stand behind in a yard or behind
 * a house. Long along X; both long faces (±Z) show end grain.
 *
 * **It is built the way one is stacked.** The pile it replaces was six 5 m
 * poles between two posts: three courses of telegraph pole, the one thing a
 * woodpile never is. So: two bearer poles on flat stones to keep the wood off
 * the damp, and on them two rows of billets laid ACROSS the pile, so every
 * one shows its sawn end on a face — rounds, halves and split quarters in
 * courses that do not quite line up, each end cut at its own angle and
 * standing out of the face by its own few centimetres, weathered grey most of
 * them and a few fresh-cut and pale. Behind the ends is the dark of the stack
 * itself, which is what the gaps between them are drawn in. Each end is held
 * either by a pair of posts with a batten across their heads or by a crib — a
 * square tower of billets laid crosswise course by course, which is how a
 * pile is ended with nothing but the wood it is made of. On top it is left
 * open with a few billets thrown on (and sometimes an axe in one), or covered
 * against the rain with boards or lapped iron sheets weighted with stones,
 * pitched to shed the water off one face. Some piles have lost a few billets
 * onto the ground in front.
 *
 * **Billets are one surface per colour, not a part each**: a billet is its
 * sawn end and a ring of sides carrying the bark, with no far end, because
 * the far end is inside the stack — three vertices per corner. That is what
 * keeps some three hundred billets inside a structure's budget on a prop
 * Cinderhaven places fifty-one times.
 *
 * **The collider is the box it has always been**, len x 1.9 x 1.3, first and
 * alone. The sawn ends stand from flush to 4 cm proud of its faces, so a
 * round stops on wood and never short of it, and the dark of the stack is
 * 5 cm behind the faces. The top course fills to the box's top, and the
 * cover, the posts' heads and whatever is thrown on stand on it; the bearers,
 * the pads and the fallen billets are under 0.2 m and walked over.
 *
 * Seeded off where it stands (`streetSeed`) — how it is ended and covered,
 * and every billet — and its posts and pads are carried down to the ground,
 * which puts `woodpile` in `CONFORMS_TO_TERRAIN`.
 */
export function buildWoodpile(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "woodpile");
  const len = p.length ?? 5;
  // ---- the collider: the box it has always been.
  b.block({ w: len, h: 1.9, d: 1.3, x: 0, y: 0.95, z: 0 });

  const seed = streetSeed(len, 1.3, 1.9, ctx);
  const rnd = mulberry32(seed);
  const crib = (seed >>> 3) % 5 < 2;
  const cover = (["open", "boards", "iron"] as const)[(seed >>> 6) % 3];
  const axe = cover === "open" && (seed >>> 9) % 2 === 0;
  /** Which face the fallen billets lie in front of, or 0 for none. */
  const spill = (seed >>> 11) % 4 === 0 ? 0 : (seed >>> 13) % 2 === 0 ? -1 : 1;

  /** The floor under a local point, as a local height — the shed's reading. */
  const ground = (lx: number, lz: number): number => {
    if (!ctx || Math.abs(ctx.y - ctx.floor) > 0.05) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    const g = ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
    return Math.max(-0.5, Math.min(0.3, g));
  };

  // ---- the numbers everything hangs off.
  /** The collider's top, which the top course fills to. */
  const H = 1.9;
  /** The stack's foot: the bearers' tops. */
  const BASE = 0.12;
  /** Where the dark of the stack stands behind the sawn ends. */
  const CORE = 0.6;
  /** Where the face billets stop at each end: short of the posts, or of the crib. */
  const xEnd = crib ? len / 2 - 0.5 : len / 2 - 0.13;
  /** The cover's slope across the pile, and which face it sheds onto. */
  const fall = (rnd() < 0.5 ? -1 : 1) * 0.06;

  // ---- the billets, accumulated per colour and emitted as one surface each.
  type Acc = { pos: number[]; nrm: number[]; uv: number[]; idx: number[] };
  const accs = new Map<string, Acc>();
  const acc = (c: string): Acc => {
    let a = accs.get(c);
    if (!a) accs.set(c, (a = { pos: [], nrm: [], uv: [], idx: [] }));
    return a;
  };
  const vert = (a: Acc, q: Point3, n: Point3): number => {
    a.pos.push(q[0], q[1], q[2]);
    a.nrm.push(n[0], n[1], n[2]);
    a.uv.push(q[0] + q[2], q[1]);
    return a.pos.length / 3 - 1;
  };
  /** One triangle, wound so its cross product points INTO the solid (see `convexSolid`). */
  const tri = (a: Acc, i: number, j: number, k: number, out: Point3): void => {
    const P = a.pos;
    const u = [P[j * 3] - P[i * 3], P[j * 3 + 1] - P[i * 3 + 1], P[j * 3 + 2] - P[i * 3 + 2]];
    const v = [P[k * 3] - P[i * 3], P[k * 3 + 1] - P[i * 3 + 1], P[k * 3 + 2] - P[i * 3 + 2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] > 0) a.idx.push(i, k, j);
    else a.idx.push(i, j, k);
  };
  const unit = (v: Point3): Point3 => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  /** `o + u x + v y + w t`: a point in a billet's own frame. */
  const at = (o: Point3, u: Point3, v: Point3, w: Point3, x: number, y: number, t: number): Point3 => [
    o[0] + u[0] * x + v[0] * y + w[0] * t,
    o[1] + u[1] * x + v[1] * y + w[1] * t,
    o[2] + u[2] * x + v[2] * y + w[2] * t,
  ];
  const ORIGIN: Point3 = [0, 0, 0];
  /**
   * A billet: `poly` (convex, in the u/v plane about `o`) run along `w` from
   * `t0` to `t1`. Its sides are the BARK, smooth round the corners; an end is
   * SAWN in the colour given, cut on a tilt (the cap's slope in u and v), and
   * an end given null is inside the stack and not drawn at all.
   */
  const billet = (
    o: Point3,
    u: Point3,
    v: Point3,
    w: Point3,
    poly: [number, number][],
    t0: number,
    t1: number,
    grain0: string | null,
    grain1: string | null,
    tilt0: [number, number] = [0, 0],
    tilt1: [number, number] = [0, 0],
  ): void => {
    const n = poly.length;
    const cx = poly.reduce((sum, q) => sum + q[0], 0) / n;
    const cy = poly.reduce((sum, q) => sum + q[1], 0) / n;
    const tAt = (end: 0 | 1, q: [number, number]): number => {
      const [tx, ty] = end ? tilt1 : tilt0;
      return (end ? t1 : t0) + tx * (q[0] - cx) + ty * (q[1] - cy);
    };
    /** Edge i's outward normal in the u/v plane. */
    const edgeN = (i: number): [number, number] => {
      const a = poly[i];
      const c = poly[(i + 1) % n];
      let nx = c[1] - a[1];
      let ny = a[0] - c[0];
      if (nx * ((a[0] + c[0]) / 2 - cx) + ny * ((a[1] + c[1]) / 2 - cy) < 0) [nx, ny] = [-nx, -ny];
      const l = Math.hypot(nx, ny) || 1;
      return [nx / l, ny / l];
    };
    // The bark: each corner's normal is the mean of its two edges'.
    const bark = acc(TIMBER);
    const ring: number[] = [];
    for (let i = 0; i < n; i++) {
      const e0 = edgeN((i + n - 1) % n);
      const e1 = edgeN(i);
      const nn = unit(at(ORIGIN, u, v, w, e0[0] + e1[0], e0[1] + e1[1], 0));
      const q = poly[i];
      ring.push(vert(bark, at(o, u, v, w, q[0], q[1], tAt(0, q)), nn));
      ring.push(vert(bark, at(o, u, v, w, q[0], q[1], tAt(1, q)), nn));
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const e = edgeN(i);
      const out = at(ORIGIN, u, v, w, e[0], e[1], 0);
      tri(bark, ring[i * 2], ring[j * 2], ring[j * 2 + 1], out);
      tri(bark, ring[i * 2], ring[j * 2 + 1], ring[i * 2 + 1], out);
    }
    // The sawn ends: flat, each on its own tilt.
    for (const end of [0, 1] as const) {
      const grain = end ? grain1 : grain0;
      if (!grain) continue;
      const [tx, ty] = end ? tilt1 : tilt0;
      const sg = end ? 1 : -1;
      const out = unit(at(ORIGIN, u, v, w, -tx * sg, -ty * sg, sg));
      const a = acc(grain);
      const ids = poly.map((q) => vert(a, at(o, u, v, w, q[0], q[1], tAt(end, q)), out));
      for (let i = 1; i + 1 < n; i++) tri(a, ids[0], ids[i], ids[i + 1], out);
    }
  };

  /**
   * One billet's end: a round, a half or a split quarter, turned any way and
   * fitted to a w x h cell. `kind` under 0.25 asks for a round.
   */
  const outline = (w: number, h: number, kind = rnd()): [number, number][] => {
    let pts: [number, number][];
    if (kind < 0.25) {
      pts = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + (rnd() - 0.5) * 0.3;
        const r = 0.9 + rnd() * 0.1;
        pts.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
    } else if (kind < 0.6) {
      pts = [0, 0.25, 0.5, 0.75, 1].map((f) => [Math.cos(f * Math.PI), Math.sin(f * Math.PI)]);
    } else {
      const spread = Math.PI * (0.45 + rnd() * 0.2);
      pts = [[0, 0], ...[0, 0.5, 1].map((f): [number, number] => [Math.cos(f * spread), Math.sin(f * spread)])];
    }
    const turn = rnd() * Math.PI * 2;
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    pts = pts.map(([x, y]) => [x * c - y * s, x * s + y * c]);
    const xs = pts.map((q) => q[0]);
    const ys = pts.map((q) => q[1]);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    const k = 0.86 + rnd() * 0.1;
    return pts.map(([x, y]) => [((x - (x0 + x1) / 2) / (x1 - x0)) * w * k, ((y - (y0 + y1) / 2) / (y1 - y0)) * h * k]);
  };
  /** Weathered grey most of it, some browner, a few fresh-cut and pale. */
  const endGrain = (): string => {
    const r = rnd();
    return r < 0.55 ? THATCH : r < 0.85 ? PLANK : STRAW;
  };
  const tilt = (): [number, number] => [(rnd() - 0.5) * 0.24, (rnd() - 0.5) * 0.24];
  const X: Point3 = [1, 0, 0];
  const Y: Point3 = [0, 1, 0];
  const Z: Point3 = [0, 0, 1];

  // ---- the two faces: a row of billets behind each, laid in courses that do not line up.
  for (const s of [-1, 1]) {
    const w: Point3 = [0, 0, s];
    let y = BASE;
    while (y < H - 0.05) {
      let ch = 0.2 + rnd() * 0.07;
      if (H - y - ch < 0.14) ch = H + 0.03 - y;
      let x = -xEnd;
      while (x < xEnd - 0.06) {
        let cw = 0.2 + rnd() * 0.12;
        const first = x === -xEnd;
        const last = xEnd - x - cw < 0.14;
        if (last) cw = xEnd - x;
        // The billet at either end of a course is its bark side on the pile's
        // END: a round or a half, pulled in by its own amount, or the end is
        // one flat face of bark and reads as boarding.
        const inset = first || last ? rnd() * 0.05 : 0;
        const cx = x + cw / 2 + (first ? inset / 2 : last ? -inset / 2 : (rnd() - 0.5) * 0.02);
        const o: Point3 = [cx, y + ch / 2 + (rnd() - 0.5) * 0.02, 0];
        const shape = outline(cw - inset, ch, first || last ? rnd() * 0.6 : rnd());
        billet(o, X, Y, w, shape, 0.02, 0.65 + rnd() * 0.04, null, endGrain(), undefined, tilt());
        x += cw;
      }
      y += ch;
    }
  }

  // ---- the ends.
  for (const s of [-1, 1]) {
    if (crib) {
      // A crib: courses of rounds laid crosswise, across the pile and then along it.
      let y = BASE;
      let across = true;
      while (y < H - 0.02) {
        const d = Math.min(0.17 + rnd() * 0.04, H + 0.03 - y);
        if (across) {
          for (const xc of [len / 2 - 0.02 - d / 2, len / 2 - 0.48 + d / 2]) {
            billet([s * xc, y + d / 2, 0], X, Y, Z, outline(d, d, 0), -0.67, 0.67, endGrain(), endGrain(), tilt(), tilt());
          }
        } else {
          for (const zc of [-1, 1]) {
            const o: Point3 = [s * (len / 2 - 0.25), y + d / 2, zc * (0.65 - d / 2)];
            billet(o, Z, Y, X, outline(d, d, 0), -0.27, 0.27, endGrain(), endGrain(), tilt(), tilt());
          }
        }
        y += d * 0.88;
        across = !across;
      }
    } else {
      // Posts at the two corners, driven in, with a batten nailed across their heads.
      for (const zc of [-1, 1]) {
        const foot = Math.min(0, ground(s * (len / 2 - 0.06), zc * 0.55)) - 0.05;
        const top = 2.12 + (rnd() - 0.5) * 0.08;
        b.box(0.12, top - foot, 0.12, s * (len / 2 - 0.06), (top + foot) / 2, zc * 0.55, PLANK, { y: (rnd() - 0.5) * 0.3 });
      }
      b.box(0.03, 0.08, 1.34, s * (len / 2 + 0.015), 2.0, 0, PLANK, { x: (rnd() - 0.5) * 0.04 });
    }
  }

  // ---- what is on top.
  /** The cover's underside over the middle of the pile: clear of the top course at its low edge. */
  const coverY = H + 0.035 + 0.75 * Math.abs(fall);
  if (cover === "boards") {
    // Boards laid across the pile, their ends out over both faces.
    let x = -len / 2 + 0.02;
    while (x < len / 2 - 0.12) {
      const bw = Math.min(0.2 + rnd() * 0.1, len / 2 - x);
      b.box(bw - 0.015, 0.03, 1.46 + rnd() * 0.08, x + bw / 2, coverY + 0.015 + rnd() * 0.012, (rnd() - 0.5) * 0.06, PLANK, {
        x: -Math.atan(fall),
        y: (rnd() - 0.5) * 0.04,
      });
      x += bw;
    }
  } else if (cover === "iron") {
    // Iron sheets across the pile, each lapped over the last, ribs running with the fall.
    const n = Math.max(2, Math.round(len / 0.85));
    const sw = (len + 0.1 * (n - 1)) / n;
    for (let i = 0; i < n; i++) {
      const xc = -len / 2 + sw / 2 + i * (sw - 0.1);
      const y = coverY + 0.006 + (i % 2) * 0.008;
      const rot = { x: -Math.atan(fall), y: (rnd() - 0.5) * 0.03 };
      b.box(sw, 0.012, 1.5, xc, y, 0, IRON, rot);
      for (let r = -2; r <= 2; r++) b.box(0.035, 0.02, 1.5, xc + r * (sw / 5.2), y + 0.012, 0, IRON, rot);
    }
  }
  if (cover !== "open") {
    // Stones to hold it down.
    const count = 2 + Math.floor(rnd() * 2);
    for (let i = 0; i < count; i++) {
      const x = (i / (count - 1) - 0.5) * (len - 1.2) + (rnd() - 0.5) * 0.4;
      b.box(0.26 + rnd() * 0.1, 0.14, 0.2 + rnd() * 0.08, x, coverY + 0.12, 0, STONE, { y: rnd() * 3 });
    }
  } else {
    // Left open, with a few billets thrown on top.
    const count = 3 + Math.floor(rnd() * 3);
    for (let i = 0; i < count; i++) {
      const d = 0.16 + rnd() * 0.06;
      const yaw = (rnd() - 0.5) * 0.9;
      const w: Point3 = [Math.cos(yaw), 0, Math.sin(yaw)];
      const u: Point3 = [-Math.sin(yaw), 0, Math.cos(yaw)];
      const o: Point3 = [(rnd() - 0.5) * (len - 1.4), H + 0.03 + d * 0.4, (rnd() - 0.5) * 0.6];
      billet(o, u, Y, w, outline(d, d * 0.85, rnd() * 0.6), -0.3, 0.3, endGrain(), endGrain(), tilt(), tilt());
    }
    if (axe) {
      // An axe left in the top of the pile, its head driven in.
      const x = (rnd() - 0.5) * (len - 1.6);
      const z = (rnd() - 0.5) * 0.5;
      const lean = 0.5 + rnd() * 0.25;
      const hl = 0.72;
      b.box(0.17, 0.1, 0.028, x, H + 0.02, z, IRON, { z: lean });
      b.box(0.036, hl, 0.03, x - Math.sin(lean) * (hl / 2 - 0.04), H + 0.02 + Math.cos(lean) * (hl / 2 - 0.04), z, STRAW, { z: lean });
    }
  }

  // ---- fallen billets, lying on the ground in front of one face.
  if (spill) {
    const count = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < count; i++) {
      const d = 0.13 + rnd() * 0.06;
      const x = (rnd() - 0.5) * (len - 1);
      const z = spill * (0.8 + rnd() * 0.5);
      const yaw = rnd() * Math.PI;
      const w: Point3 = [Math.cos(yaw), 0, Math.sin(yaw)];
      const u: Point3 = [-Math.sin(yaw), 0, Math.cos(yaw)];
      billet([x, ground(x, z) + d * 0.38, z], u, Y, w, outline(d * 1.2, d), -0.3, 0.3, endGrain(), endGrain(), tilt(), tilt());
    }
  }

  // ---- the bearers, each on a flat stone at both ends and in the middle.
  for (const zc of [-0.33, 0.33]) {
    b.cyl(len - 0.12, 0.12, 0.12, 6, 0, 0.06, zc, TIMBER, { z: Math.PI / 2 });
    for (const x of [-len / 2 + 0.3, 0, len / 2 - 0.3]) {
      const bottom = Math.min(0, ground(x, zc)) - 0.04;
      b.box(0.26, 0.004 - bottom, 0.22, x, (0.004 + bottom) / 2, zc, STONE, { y: (rnd() - 0.5) * 0.3 });
    }
  }

  // ---- the billets, then the dark of the stack they hide (last: see craft notes on emission order).
  for (const [colour, a] of accs) {
    const data = new VertexData();
    data.positions = a.pos;
    data.normals = a.nrm;
    data.uvs = a.uv;
    data.indices = a.idx;
    b.surface(data, colour);
  }
  const low = Math.min(0, ground(-len / 2, -0.6), ground(len / 2, -0.6), ground(-len / 2, 0.6), ground(len / 2, 0.6)) - 0.02;
  // Short of the end billets by most of their width, so their bark stands out of it.
  const coreW = 2 * (crib ? len / 2 - 0.12 : xEnd - 0.16);
  b.box(coreW, H - 0.005 - low, 2 * CORE, 0, (H - 0.005 + low) / 2, 0, PITCH);
  return b;
}
