/**
 * kit/japan/torii.ts — buildTorii: the myōjin gate, and the votive gate an
 * Inari approach is tunnelled with.
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
  type Point3,
  type Structure,
  StoneBatch,
  convexSolid,
  hideBack,
  rope,
  streetSeed,
} from "../core";
import { BRONZE, GRANITE, GRANITE_DARK, KAYA, PAPER, SHU, SUMI } from "./palette";

/**
 * A TORII — a myōjin gate, the shape every shrine in the valley uses and the
 * one on this map that tells a player they have crossed from the town into
 * the sacred without a word on screen.
 *
 * It is drawn as the gate is built. Each post stands in a black lacquered
 * sleeve (kamaki) on a granite mound (kamebara) on a plinth stone carried
 * down to the ground. The tie beam (nuki) runs through both posts and out
 * past them, locked by a wedge (kusabi) beside each post; a short king post
 * (gakuzuka) stands on it in the middle. Over the posts lies the straight
 * lower lintel (shimaki) in the gate's colour, and on that the great black
 * lintel (kasagi): a crowned section, flat between the posts and sweeping up
 * past them, with each end cut on a slant so its top overhangs.
 *
 * What it carries says what kind of gate it is. **The gate that marks a
 * precinct** hangs the shrine's name on the king post — a framed black
 * plaque (gaku) with its characters in bronze on the FRONT, which is local
 * -Z and faces the approach — and a sacred rope (shimenawa) under the tie
 * beam: two strands of straw twisted together, thick in the middle, hung with
 * zig-zag paper (shide) and straw tassels. **A `votive` gate** is one of the
 * close-set run up an Inari approach, given by a donor: it wears the Inari
 * collar (daiwa) at the head of each post, has no plaque and no rope, and
 * carries the donor's inscription in black down the BACK of both posts —
 * which is the side a walker coming back down the tunnel sees.
 *
 * Solid posts (a body walks into one and a round stops on it); the tie, the
 * lower lintel and the black lintel are `rayOnly` boxes — ray geometry and
 * nothing else, because they are four metres over anybody's head and a nav
 * surface up there is one nobody can reach. The drawing keeps to them: the
 * shimaki is exactly its box, and the kasagi's curve lifts only its TOP over
 * the collider and its bottom only past the collider's end. Everything low —
 * the plinth, the mound, the sleeve's band — is under a stride, and the
 * rope's paper and tassels hang no lower than 2.8 m.
 *
 * `width` is the span between the posts, `height` the lintel's underside;
 * `tint` recolours the timber, and the sleeve and the black lintel stay black
 * whatever it is. It is in `CONFORMS_TO_TERRAIN`: the characters and the
 * rope's twist are seeded off where it stands, and each post's plinth is
 * carried down to the ground under that post.
 */
export function buildTorii(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "torii");
  const span = p.width ?? 4.6;
  const h = p.height ?? 6;
  const color = p.tint ?? SHU;
  const postD = Math.max(0.36, h * 0.075);
  const tie = h - Math.max(0.9, h * 0.19);
  const reach = span / 2 + postD * 2.4;

  // --- the colliders, exactly as they were and in the same order -----------------
  for (const sx of [-1, 1]) {
    b.block({ w: postD * 0.9, h, d: postD * 0.9, x: (sx * span) / 2, y: h / 2, z: 0 });
  }
  const beam = (w: number, bh: number, d: number, y: number): void =>
    b.block({ w, h: bh, d, x: 0, y, z: 0, rotX: undefined, rotY: undefined, rayOnly: true });
  beam(span + postD * 2.6, postD * 0.62, postD * 0.52, tie);
  beam(reach * 2 - 0.4, postD * 0.62, postD * 0.95, h + postD * 0.31);
  beam(reach * 2 - 1.2, postD * 0.62, postD * 1.15, h + postD * 0.93);

  // --- everything below is drawing -------------------------------------------
  const votive = p.votive === true;
  const rnd = mulberry32(streetSeed(span, h, postD, ctx));
  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };
  const sb = new StoneBatch();
  /** How much bigger than the 6 m gate's parts this gate's are. */
  const k = postD / 0.45;
  const nukiH = postD * 0.62;
  const nukiD = postD * 0.52;
  const nukiTop = tie + nukiH / 2;
  const foot = Math.min(0, ground(-span / 2, 0), ground(span / 2, 0)) - 0.08;
  /** The post's radius at `y`: the cylinder tapers from `postD` at its foot to 0.88 of it. */
  const radius = (y: number): number => (postD - postD * 0.12 * ((y - foot) / (h - foot))) / 2;

  // The posts, each on its plinth, mound and sleeve.
  for (const sx of [-1, 1]) {
    const x = (sx * span) / 2;
    b.cyl(h - foot, postD * 0.88, postD, 16, x, (h + foot) / 2, 0, color);
    const s = postD * 1.2;
    const corners = [-1, 1].flatMap((cx) => [-1, 1].map((cz) => ground(x + cx * s, cz * s)));
    const top = Math.max(...corners) + 0.03;
    const low = Math.min(...corners) - 0.22;
    b.box(s * 2, top - low, s * 2, x, (top + low) / 2, 0, GRANITE_DARK);
    // The mound: three bands, each narrower, a dome the ink finds as bends.
    let y = top;
    for (const [hh, d0, d1] of [
      [0.08, 1.95, 1.72],
      [0.07, 1.72, 1.42],
      [0.05, 1.42, 1.18],
    ]) {
      b.cyl(hh, postD * d1, postD * d0, 16, x, y + hh / 2, 0, GRANITE);
      y += hh;
    }
    const sleeve = 0.62 * k;
    b.cyl(sleeve, postD + 0.06, postD + 0.08, 16, x, y + sleeve / 2, 0, SUMI);
    b.cyl(0.05, postD + 0.13, postD + 0.13, 16, x, y + sleeve - 0.05, 0, SUMI);
    b.cyl(0.04, postD + 0.12, postD + 0.12, 16, x, y + 0.02, 0, SUMI);
    // The Inari collar at the head of the post, under the lintel.
    if (votive) b.cyl(postD * 0.26, postD * 1.18, postD * 1.18, 16, x, h - postD * 0.13, 0, color);
    // The wedge driven beside the post, outboard, standing on the tie.
    const wx = sx * (span / 2 + radius(nukiTop) + postD * 0.13);
    b.box(postD * 0.24, postD * 0.34, nukiD * 0.72, wx, nukiTop + postD * 0.17, 0, color);
  }

  // The tie beam, and the king post on it.
  b.box(span + postD * 2.6, nukiH, nukiD, 0, tie, 0, color);
  const kpD = postD * 0.4;
  b.box(postD * 0.62, h - nukiTop, kpD, 0, (h + nukiTop) / 2, 0, color);

  // The lower lintel: exactly its collider.
  b.box(reach * 2 - 0.4, postD * 0.62, postD * 0.95, 0, h + postD * 0.31, 0, color);

  // The great lintel. A crowned section, laid as convex solids between
  // stations: one flat run between the posts, then a sweep out to each tip.
  // Its top rises `sori` past the posts; its bottom stays on the lower lintel
  // to that beam's end and lifts only past it; the tip is cut on a slant.
  {
    const y0 = h + postD * 0.62;
    const kh = postD * 0.62;
    const kd = postD * 1.15;
    const sori = postD * 0.7;
    const xs = span / 2;
    const xe = reach - 0.2;
    const topAt = (x: number): number => {
      const t = Math.max(0, (Math.abs(x) - xs) / (reach - xs));
      return y0 + kh + sori * t * t;
    };
    const botAt = (x: number): number => {
      const u = Math.max(0, (Math.abs(x) - xe) / (reach - xe));
      return y0 + 0.12 * u * u;
    };
    const section = (x: number, slant = 0): Point3[] => {
      const lo = botAt(x);
      const hi = topAt(x);
      const shoulder = lo + (hi - lo) * 0.78;
      const at = (y: number): number => x + (slant * (y - lo)) / (hi - lo);
      return [
        [at(lo), lo, -kd * 0.44],
        [at(lo), lo, kd * 0.44],
        [at(shoulder), shoulder, kd * 0.5],
        [at(hi), hi, 0],
        [at(shoulder), shoulder, -kd * 0.5],
      ];
    };
    convexSolid(b, section(-xs), section(xs), SUMI);
    for (const sx of [-1, 1]) {
      const stations = [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6].map((f) => xs + (reach - xs) * f);
      stations.push(xe);
      stations.sort((a, c) => a - c);
      stations.push(reach);
      for (let i = 0; i + 1 < stations.length; i++) {
        const last = i + 2 === stations.length;
        convexSolid(b, section(sx * stations[i]), section(sx * stations[i + 1], last ? sx * postD * 0.3 : 0), SUMI);
      }
    }
  }

  if (!votive) {
    // The plaque on the king post, on the front: a black board in a frame
    // under a little hood, bronze at its corners and the name in bronze.
    const gap = h - nukiTop;
    const ph = gap * 0.74;
    const pw = Math.max(0.36, ph * 0.66);
    const yc = (h + nukiTop) / 2;
    const zb = -(kpD / 2 + 0.02);
    const fz = zb - 0.035;
    sb.box(pw - 0.08, ph - 0.08, 0.04, 0, yc, zb, SUMI);
    for (const e of [-1, 1]) {
      sb.box(pw, 0.07, 0.07, 0, yc + e * (ph / 2 - 0.035), fz, color);
      sb.box(0.07, ph - 0.14, 0.07, e * (pw / 2 - 0.035), yc, fz, color);
    }
    sb.box(pw + 0.12, 0.05, 0.16, 0, yc + ph / 2 + 0.025, zb - 0.04, SUMI);
    for (const e of [-1, 1]) {
      for (const f of [-1, 1]) sb.box(0.09, 0.09, 0.02, e * (pw / 2 - 0.045), yc + f * (ph / 2 - 0.045), fz - 0.04, BRONZE);
    }
    const cells = 3;
    const cell = (ph - 0.2) / cells;
    const gw = pw - 0.2;
    const stroke = Math.max(0.028, cell * 0.12);
    for (let g = 0; g < cells; g++) {
      const gy = yc + ph / 2 - 0.1 - (g + 0.5) * cell;
      for (let s = 0; s < 5; s++) {
        const horiz = rnd() < 0.55;
        const len = (horiz ? gw : cell) * (0.35 + rnd() * 0.55);
        const x = (rnd() - 0.5) * (horiz ? gw - len : gw * 0.8);
        const y = gy + (rnd() - 0.5) * (horiz ? cell * 0.8 : cell - len);
        const roll = rnd() < 0.25 ? (rnd() - 0.5) * 1.2 : 0;
        sb.box(horiz ? len : stroke, horiz ? stroke : len, 0.02, x, y, zb - 0.03, BRONZE, { z: roll }, hideBack("-z"));
      }
    }

    // The sacred rope under the tie beam: two strands twisted, thick in the
    // middle, hung with paper and tassels.
    const ry = tie - nukiH / 2 - 0.05 * k;
    const half = span / 2 - radius(ry) * 0.6;
    const sag = Math.min(0.28, span * 0.05);
    const thick = 0.25 * k;
    const thin = 0.075 * k;
    const ropeZ = -nukiD * 0.1;
    const twist = 5 + Math.floor(rnd() * 3);
    const phase = rnd() * Math.PI;
    const at = (s: number): Point3 => [s * half, ry - thick / 2 - sag * (1 - s * s), ropeZ];
    const girth = (s: number): number => thin + (thick - thin) * (1 - Math.abs(s));
    for (let strand = 0; strand < 2; strand++) {
      for (const side of [-1, 1]) {
        const pts: Point3[] = [];
        for (let i = 0; i <= 8; i++) {
          const s = side * (1 - i / 8);
          const a = s * Math.PI * twist + strand * Math.PI + phase;
          const r = girth(s) * 0.24;
          const c = at(s);
          pts.push([c[0], c[1] + Math.cos(a) * r, c[2] + Math.sin(a) * r]);
        }
        rope(b, pts, thin * 0.68, thick * 0.68, KAYA, 6);
      }
    }
    // Paper: four zig-zag strips; straw: three tassels between them.
    const pieceW = 0.075 * k;
    const pieceH = 0.1 * k;
    for (const s of [-0.62, -0.21, 0.21, 0.62]) {
      const c = at(s);
      const y = c[1] - girth(s) / 2 + 0.01;
      for (let i = 0; i < 4; i++) {
        const off = (i % 2 === 0 ? -1 : 1) * pieceW * 0.4;
        sb.box(pieceW, pieceH, 0.008, c[0] + off, y - pieceH * (i + 0.5), c[2] - girth(s) * 0.2, PAPER);
      }
    }
    for (const s of [-0.42, 0, 0.42]) {
      const c = at(s);
      const len = 0.3 * k * (s === 0 ? 1.25 : 1);
      b.cyl(len, girth(s) * 0.55, girth(s) * 0.18, 6, c[0], c[1] - girth(s) * 0.35 - len / 2, c[2], KAYA);
    }
  } else {
    // The donor's inscription down the back of each post: a longer column
    // on one post (the name) and a shorter one on the other (the date).
    for (const sx of [-1, 1]) {
      const x = (sx * span) / 2;
      const gs = postD * 0.4;
      const pitch = gs * 1.22;
      const yTop = nukiTop - nukiH - 0.25;
      const room = Math.floor((yTop - 1.1) / pitch);
      const n = sx > 0 ? room : Math.max(3, room - 2 - Math.floor(rnd() * 3));
      const t = gs * 0.13;
      const lay = (u: number, y: number, w: number, hh: number, roll: number): void => {
        const r = radius(y) * 0.985 + 0.004;
        const th = u / r;
        sb.box(w, hh, 0.012, x + Math.sin(th) * r, y, Math.cos(th) * r, SUMI, { y: th, z: roll }, hideBack("+z"));
      };
      for (let g = 0; g < n; g++) {
        const gy = yTop - (g + 0.5) * pitch;
        const strokes = 5 + Math.floor(rnd() * 3);
        for (let s = 0; s < strokes; s++) {
          const kind = rnd();
          if (kind < 0.5) {
            const len = gs * (0.4 + rnd() * 0.55);
            lay((rnd() - 0.5) * (gs - len), gy + (rnd() - 0.5) * gs * 0.85, len, t, 0);
          } else if (kind < 0.82) {
            const len = gs * (0.3 + rnd() * 0.7);
            lay((rnd() - 0.5) * gs * 0.8, gy + (rnd() - 0.5) * (gs - len), t, len, 0);
          } else {
            const len = gs * (0.3 + rnd() * 0.35);
            lay((rnd() - 0.5) * gs * 0.6, gy + (rnd() - 0.5) * gs * 0.5, t, len, (rnd() < 0.5 ? -1 : 1) * 0.7);
          }
        }
      }
    }
  }
  sb.flush(b);
  return b;
}
