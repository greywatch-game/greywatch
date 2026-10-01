/**
 * kit/japan/archBridge.ts — buildArchBridge: the vermilion arched shrine bridge
 * (taikobashi).
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
  GUARD_THICKNESS,
  guardSpec,
  streetSeed,
} from "../core";
import { Lapidary, TAU } from "./lapidary";
import { BRONZE, CEDAR, GRANITE, GRANITE_DARK, HINOKI, SHU, SUMI } from "./palette";
import type { V3 } from "./roof";

/** Walked height of the arch's crown over LOCAL ZERO, which is bank grade. */
const ARCH_CROWN = 1.7;
/** Approach grade — the trestle's argument, under `MAX_WALKABLE_GRADE`. */
const ARCH_GRADE = 0.3;
/** How far each approach runs on into the bank to be buried. */
const ARCH_DROP = 0.6;

/**
 * 擬宝珠, the bronze finial on a main post of a sacred bridge — a collar on the
 * post head, a neck, a ring, the onion bulb and its point — as (radius,
 * height over the post head).
 */
const GIBOSHI: [number, number][] = [
  [0, 0],
  [0.15, 0],
  [0.15, 0.05],
  [0.11, 0.07],
  [0.105, 0.13],
  [0.135, 0.145],
  [0.135, 0.175],
  [0.1, 0.19],
  [0.115, 0.21],
  [0.16, 0.27],
  [0.178, 0.33],
  [0.165, 0.39],
  [0.12, 0.46],
  [0.065, 0.52],
  [0.03, 0.57],
  [0.022, 0.6],
  [0.034, 0.625],
  [0, 0.67],
];

/**
 * The ARCHED BRIDGE (taikobashi): a vermilion shrine bridge of the Edo
 * period, lacquered, with bronze fittings, on granite abutments.
 *
 * **It is `buildTrestleBridge` in everything that is walked**, and the same
 * placement rule applies: local zero is BANK grade, so a placement over the
 * channel states `y` as minus the bed's depth at its centre. The deck is flat
 * over the water span and the approaches are straight ramps at 0.3 either
 * side — a curve would be steeper than the nav graph links at its ends — so
 * the ARCH is in the drawing.
 *
 * **The colliders are the nine it has always had, first and in order**: the
 * deck, the two ramps, and a rail each side of each of the three. They are
 * restated at the top rather than drawn by `wall` and `guard`, because the
 * drawing is no longer the colliders' own boxes:
 *
 * - **The railing (kōran)** is BOARDED because its guard is solid — an open
 *   rail would stop rounds on the air between its bars (the footbridge's
 *   argument). So it is drawn as a kōran whose bays are filled: a bottom rail
 *   on the deck, a lacquered board up to a flat middle rail, and over that a
 *   band of short struts on a black ground, which reads as open at any range
 *   and is the timber a round stops on. A round top rail rides over the
 *   guard's head, posts stand at every bay, and a taller MAIN POST at each
 *   end of each run carries a bronze GIBOSHI — the finial that says the
 *   bridge belongs to a shrine — with bronze bands at its foot and its rail.
 *   Past the end posts the guard runs on down into the bank, so a granite
 *   WING STONE covers it there, its top sloping with the rail's.
 * - **The deck** is planks across, of seeded widths with a gap the ink finds
 *   and a few worn hollow, their tops the colliders' tops; cleats across the
 *   approaches, which a 0.3 grade needs under a wet sandal; and the deck's
 *   thickness under them as a dark core, so the underside is where a round
 *   from the river stops.
 * - **The side**: a fascia of two lapped boards down the deck's edge with
 *   bronze plates at its joints, the cross-beams under the deck running out past it with
 *   bronze caps on their ends, and under that on each side the ARCH — a
 *   curved girder springing from the abutments at the foot of the banks and
 *   rising to the crown, with struts up to the fascia wherever it falls
 *   away from it.
 * - **What holds it up**: a granite abutment at each bank — a coping over a
 *   course of dressed stones carried down to the ground — with the end bent's
 *   posts standing on it, and under each approach a bent of posts on footing stones wherever
 *   the ramp is high enough over the bank to need one. A granite sill lies
 *   across each ramp's toe.
 *
 * **Nothing under the deck comes down into the deep water**: under the flat
 * span everything but the outboard girders is inside the deck's own
 * collider or the cross-beams just under it, and a girder is under 1.8 m of
 * clearance only in the margins where the bed has risen to meet it — the
 * same margins the old fascia arc crossed. None of it needs a collider: a
 * pile's would give a body in the river something to wedge on.
 *
 * Seeded off where it stands (`streetSeed`) — the planks, the stones and the
 * leaves blown onto the deck — and cut to the ground: every stone, footing and
 * post under an approach is carried down to the floor under it. That is what
 * puts `archBridge` in `CONFORMS_TO_TERRAIN`. Without a `BuildCtx` (a
 * preview) it is drawn over a nominal channel 1.2 m deep.
 */
export function buildArchBridge(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "taikobashi");
  const len = p.length ?? 10;
  const w = p.width ?? 3.0;
  const rise = ARCH_CROWN + ARCH_DROP;
  const run = rise / ARCH_GRADE;
  const pitch = Math.atan(ARCH_GRADE);
  const slab = Math.hypot(run, rise);
  const deckT = 0.45;
  const rampT = 0.4;
  /** The guards' height over the walked line. */
  const RAIL = 0.95;

  // --- the colliders: unchanged, and in this order --------------------------------
  b.block({ w, h: deckT, d: len, x: 0, y: ARCH_CROWN - deckT / 2, z: 0 });
  for (const s of [-1, 1]) {
    const midZ = s * (len / 2 + run / 2);
    const surface = ARCH_CROWN - rise / 2;
    const y = surface - rampT / 2 / Math.cos(pitch);
    b.block({ w, h: rampT, d: slab, x: 0, y, z: midZ, rotX: s * pitch });
  }
  for (const side of ["-x", "+x"] as const) {
    const sx = side === "+x" ? 1 : -1;
    const edge = (sx * w) / 2;
    b.block(guardSpec(side, edge, 0, len, ARCH_CROWN, { height: RAIL }));
    for (const s of [-1, 1]) {
      b.block(
        guardSpec(side, edge, s * (len / 2 + run / 2), run, ARCH_CROWN - rise / 2, {
          pitch: -s * pitch,
          height: RAIL,
        }),
      );
    }
  }

  // --- everything after this is drawing -------------------------------------------
  const rnd = mulberry32(streetSeed(w, len, ARCH_CROWN, ctx));
  const half = len / 2;
  const foot = half + run;
  /** Where each approach comes down to bank grade; past it, it is buried. */
  const toe = half + ARCH_CROWN / ARCH_GRADE;
  /**
   * The end posts, most of the way down the buried run: the railing carries on
   * past the toe into the bank, and what is left of the guard past them is
   * short enough for a wing stone to cover.
   */
  const zEnd = foot - 0.9;
  /** The walked height at `z`, straight on along an approach past its foot. */
  const walked = (z: number): number => {
    const a = Math.abs(z);
    return a <= half ? ARCH_CROWN : ARCH_CROWN - ARCH_GRADE * (a - half);
  };
  const ground = (lx: number, lz: number): number => {
    if (!ctx) {
      // A preview: a channel 1.2 m deep, its banks falling over the last 6 m.
      const a = Math.abs(lz);
      return a < half - 6 ? -1.2 : a < half ? (-1.2 * (half - a)) / 6 : 0;
    }
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };

  const lap = new Lapidary(1);
  const { sb } = lap;
  /** A member from (zA, yA) to (zB, yB) in the plane at `x`: `t` across, `h` deep, square to its run. */
  const member = (
    x: number,
    zA: number,
    yA: number,
    zB: number,
    yB: number,
    t: number,
    h: number,
    color: string,
    over = 0,
  ): void => {
    const ang = Math.atan2(yB - yA, zB - zA);
    sb.box(t, h, Math.hypot(zB - zA, yB - yA) + over, x, (yA + yB) / 2, (zA + zB) / 2, color, { x: -ang });
  };
  /**
   * A member laid along the walked line from `zA` to `zB` — both on ONE
   * straight piece of it — between `a` and `c` over it, measured plumb.
   */
  const along = (zA: number, zB: number, a: number, c: number, x: number, t: number, color: string, over = 0): void => {
    const cos = Math.cos(Math.atan2(walked(zB) - walked(zA), zB - zA));
    const m = (a + c) / 2;
    member(x, zA, walked(zA) + m, zB, walked(zB) + m, t, (c - a) * cos, color, over);
  };
  /** An eight-sided rod from (zA, yA) to (zB, yB) at `x`. */
  const rod = (x: number, zA: number, yA: number, zB: number, yB: number, r: number, color: string): void => {
    const L = Math.hypot(zB - zA, yB - yA);
    const ny = (zB - zA) / L;
    const nz = -(yB - yA) / L;
    const ring = (z: number, y: number): V3[] =>
      Array.from({ length: 8 }, (_, k): V3 => {
        const t = ((k + 0.5) / 8) * TAU;
        return [x + r * Math.cos(t), y + r * Math.sin(t) * ny, z + r * Math.sin(t) * nz];
      });
    lap.solid(color, ring(zA, yA), ring(zB, yB));
  };

  /** The walked line's three straight pieces, the approaches cut at the end posts. */
  const pieces: [number, number][] = [
    [-zEnd, -half],
    [-half, half],
    [half, zEnd],
  ];
  /** Where a piece's bays divide: no bay over 1.8 m. */
  const stationsOf = (zA: number, zB: number): number[] => {
    const n = Math.ceil((zB - zA) / 1.8 - 1e-6);
    return Array.from({ length: n - 1 }, (_, i) => zA + ((zB - zA) * (i + 1)) / n);
  };
  const mains = [-zEnd, -half, half, zEnd];
  const railX = (sx: number): number => sx * (w / 2 + GUARD_THICKNESS / 2);
  /** The side's plane — fascia and girder — outboard of the guard. */
  const sideX = (sx: number): number => sx * (w / 2 + GUARD_THICKNESS + 0.04);
  const FASCIA = 0.46;

  // The railing's members: a bottom rail on the deck, a flat middle rail, a
  // round top rail riding over the guard's head, a post at every bay and
  // struts in the band over the middle rail.
  for (const sx of [-1, 1]) {
    const x = railX(sx);
    for (const [zA, zB] of pieces) {
      along(zA, zB, 0, 0.12, x, 0.21, SHU, 0.02);
      along(zA, zB, 0.5, 0.6, x, 0.2, SHU, 0.02);
      rod(x, zA, walked(zA) + 0.97, zB, walked(zB) + 0.97, 0.075, SHU);
      const posts = [zA + 0.13, ...stationsOf(zA, zB), zB - 0.13];
      for (let i = 0; i < posts.length; i++) {
        const z = posts[i];
        if (i > 0 && i < posts.length - 1) sb.box(0.22, 1.0, 0.15, x, walked(z) + 0.49, z, SHU);
        if (i === posts.length - 1) break;
        // Struts across the bay to the next post, never more than 0.45 apart.
        const z1 = posts[i + 1];
        const n = Math.max(2, Math.round((z1 - z) / 0.42));
        for (let j = 1; j < n; j++) {
          const zs = z + ((z1 - z) * j) / n;
          sb.box(0.15, 0.36, 0.06, x, walked(zs) + 0.76, zs, SHU);
        }
      }
    }
    // The main posts, in bronze at the foot, at the rail and at the head, and
    // a giboshi on each. The end posts stand on stones of their own and carry
    // the bridge's name plate.
    for (const z of mains) {
      const px = x + sx * 0.02;
      const atEnd = Math.abs(z) > half + 0.01;
      const g = ground(px, z);
      let y0 = walked(z) - 0.02;
      if (atEnd) {
        sb.box(0.44, 0.22, 0.44, px, g + 0.02, z, GRANITE);
        y0 = g + 0.13;
      }
      const base = Math.max(walked(z), g);
      const yTop = base + 1.3;
      sb.box(0.26, yTop - y0, 0.26, px, (y0 + yTop) / 2, z, SHU);
      sb.box(0.3, 0.13, 0.3, px, y0 + 0.065, z, BRONZE);
      sb.box(0.3, 0.17, 0.3, px, base + 0.97, z, BRONZE);
      sb.box(0.3, 0.07, 0.3, px, yTop - 0.035, z, BRONZE);
      lap.lathe(BRONZE, GIBOSHI, 12, 0, [px, yTop, z]);
      if (atEnd) {
        sb.box(0.02, 0.42, 0.16, px + sx * 0.14, base + 0.62, z, BRONZE);
        sb.box(0.012, 0.34, 0.1, px + sx * 0.156, base + 0.62, z, SUMI);
      }
    }
    // Past the end posts the guard runs on into the bank: a wing stone over it
    // under a coping sloping with the rail, its far end rounded off.
    for (const s of [-1, 1]) {
      const zi = zEnd + 0.12;
      const zo = foot + 0.12;
      const gw = Math.min(ground(x, s * zi), ground(x, s * zo)) - 0.12;
      const top = (a: number): number => walked(a) + RAIL + 0.03;
      const stone = (xf: number): V3[] => [
        [xf, gw, s * zi],
        [xf, top(zi) - 0.13, s * zi],
        [xf, top(zo) - 0.13, s * zo],
        [xf, gw, s * zo],
      ];
      lap.solid(GRANITE_DARK, stone(x - 0.12), stone(x + 0.12));
      const coping = (xf: number, lo: number): V3[] => [
        [xf, top(zi) - 0.14, s * (zi - 0.01)],
        [xf, top(zi) - lo, s * (zi - 0.01)],
        [xf, top(zo - 0.1) + 0.005 - lo, s * (zo - 0.1)],
        [xf, top(zo) - 0.05, s * (zo + 0.02)],
        [xf, top(zo) - 0.14, s * (zo + 0.02)],
      ];
      lap.solid(GRANITE, coping(x - 0.14, 0.02), coping(x + 0.14, 0.02));
    }
  }

  // The deck: planks across, their tops the colliders', of seeded widths and a
  // few worn hollow. What the toe buries is not laid.
  const deckW = w + GUARD_THICKNESS * 2;
  for (const [zA, zB] of pieces) {
    for (let z = zA; z < zB - 0.05; ) {
      let pw = 0.24 + rnd() * 0.06;
      if (z + pw > zB - 0.12) pw = zB - z;
      const z0 = z;
      const z1 = z + pw - 0.016;
      z += pw;
      const sink = rnd() < 0.2 ? 0.004 + rnd() * 0.006 : 0;
      const trim = rnd() * 0.03;
      if (Math.max(walked(z0), walked(z1)) < 0.01) continue;
      along(z0, z1, -0.07 - sink, -sink, 0, deckW - trim, CEDAR);
    }
  }
  // Cleats across the approaches.
  for (const s of [-1, 1]) {
    for (let d = 0.4; half + d < toe - 0.15; d += 0.42) {
      const z = s * (half + d);
      along(z - 0.03, z + 0.03, 0, 0.028, 0, w - 0.3, HINOKI);
    }
  }

  // Leaves blown onto the deck, most of them against the rails.
  const rampAt =
    (s: number) =>
    (f: number, u: number, v: number): V3 => {
      const z = s * (half + f * (toe - half));
      return [u, walked(z) + v, z];
    };
  const flatAt = (f: number, u: number, v: number): V3 => [u, ARCH_CROWN + v, -half + f * len];
  const across = (): number =>
    rnd() < 0.6 ? (rnd() < 0.5 ? -1 : 1) * (w / 2 - 0.09 - rnd() * 0.35) : (rnd() - 0.5) * (w - 0.5);
  for (let i = 0; i < Math.round(len * 2.2); i++) {
    const u = across();
    lap.leaf(rnd, flatAt, len, 0.2 + rnd() * (len - 0.4), u, 0.06 + rnd() * 0.04, rnd() * TAU, 0.003);
  }
  for (const s of [-1, 1]) {
    for (let i = 0; i < 9; i++) {
      const u = across();
      lap.leaf(rnd, rampAt(s), toe - half, 0.3 + rnd() * (toe - half - 0.8), u, 0.05 + rnd() * 0.035, rnd() * TAU, 0.032);
    }
  }

  // The side. A fascia of two boards down the deck's edge, the upper lapped
  // over the lower, with a batten along its foot and
  // bronze plates over its joints; the cross-beams run out under it with
  // bronze on their ends.
  for (const sx of [-1, 1]) {
    for (const [zA, zB] of pieces) {
      along(zA, zB, -0.2, 0.005, sideX(sx) + sx * 0.015, 0.08, SHU, 0.02);
      along(zA, zB, -FASCIA, -0.19, sideX(sx), 0.08, SHU, 0.02);
      along(zA, zB, -FASCIA, -FASCIA + 0.07, sideX(sx) + sx * 0.03, 0.06, SHU, 0.02);
    }
    for (const z of [-half, 0, half]) {
      const y = walked(z) - FASCIA / 2;
      const px = sideX(sx) + sx * 0.05;
      sb.box(0.02, FASCIA + 0.04, 0.36, px, y, z, BRONZE);
      for (const dy of [-0.16, 0, 0.16]) {
        for (const dz of [-0.12, 0.12]) sb.box(0.03, 0.035, 0.035, px + sx * 0.02, y + dy, z + dz, BRONZE);
      }
    }
  }
  const beamL = w + 2 * (GUARD_THICKNESS + 0.08 + 0.18);
  /** A cross-beam under the deck at `z`, where it clears the ground. */
  const beam = (z: number): boolean => {
    const y = walked(z) - 0.52;
    if (y - 0.07 < ground(0, z) + 0.04) return false;
    sb.box(beamL, 0.14, 0.16, 0, y, z, SHU);
    for (const sx of [-1, 1]) sb.box(0.02, 0.15, 0.17, sx * (beamL / 2 + 0.01), y, z, BRONZE);
    return true;
  };

  // The abutments: a coping over a course of dressed stones, each carried down
  // to the ground under it.
  const faceZ = half - 1.0;
  const backZ = half + 0.8;
  const wa = w / 2 + 0.7;
  const cope = 0.25;
  /** Seeded lengths from `a` to `c`, each `lo` to `lo + vary` long, as (start, end). */
  const lengths = (a: number, c: number, lo: number, vary: number): [number, number][] => {
    const out: [number, number][] = [];
    for (let u = a; u < c - 0.05; ) {
      let l = lo + rnd() * vary;
      if (u + l > c - lo * 0.5) l = c - u;
      out.push([u, u + l]);
      u += l;
    }
    return out;
  };
  for (const s of [-1, 1]) {
    // The coping, oversailing the face.
    for (const [u0, u1] of lengths(-wa - 0.05, wa + 0.05, 0.6, 0.3)) {
      sb.box(u1 - u0 - 0.02, 0.14, backZ - faceZ + 0.06, (u0 + u1) / 2, cope - 0.07, s * ((faceZ - 0.06 + backZ) / 2), GRANITE);
    }
    // The face, course by course down to the ground under each stone.
    const courseTop = cope - 0.16;
    for (const [u0, u1] of lengths(-wa, wa, 0.45, 0.3)) {
      const um = (u0 + u1) / 2;
      const g = ground(um, s * faceZ) - 0.12;
      let yt = courseTop;
      let k = 0;
      while (yt > g + 0.02 && k < 6) {
        const yb = Math.max(g, yt - 0.34);
        const nudge = k % 2 ? 0.12 : 0;
        const a = Math.max(-wa, u0 + nudge);
        const c = Math.min(wa, u1 + nudge);
        sb.box(c - a - 0.02, yt - yb - 0.02, 0.26, (a + c) / 2, (yt + yb) / 2, s * (faceZ + 0.13), GRANITE);
        yt = yb;
        k++;
      }
    }
    // Its ends, where the stones return along the bank.
    for (const sx of [-1, 1]) {
      for (const [v0, v1] of lengths(faceZ + 0.28, backZ, 0.5, 0.3)) {
        const g = ground(sx * wa, s * ((v0 + v1) / 2)) - 0.1;
        if (courseTop - g < 0.04) continue;
        sb.box(0.24, courseTop - g - 0.02, v1 - v0 - 0.02, sx * (wa - 0.12), (courseTop + g) / 2, s * ((v0 + v1) / 2), GRANITE);
      }
    }
    // A few leaves caught on the coping.
    const copeAt = (f: number, u: number, v: number): V3 => [u, cope + v, s * (faceZ + f * (backZ - faceZ))];
    for (let i = 0; i < 4; i++) {
      const u = (rnd() < 0.5 ? -1 : 1) * (w / 2 + 0.25 + rnd() * 0.35);
      lap.leaf(rnd, copeAt, backZ - faceZ, 0.1 + rnd() * 0.5, u, 0.05 + rnd() * 0.03, rnd() * TAU, 0.003);
    }
    // A sill across the toe.
    sb.box(deckW + 0.2, 0.18, 0.42, 0, ground(0, s * (toe + 0.22)) - 0.07, s * (toe + 0.22), GRANITE);
  }

  // The ARCH: a curved girder each side, springing from the coping at the
  // foot of each bank and rising to the fascia at the crown, with a bronze
  // shoe at each foot.
  const springZ = faceZ + 0.4;
  const GD = 0.26;
  const c0 = ARCH_CROWN - FASCIA - GD / 2;
  const c1 = cope + 0.02 + GD / 2;
  const Rg = (springZ * springZ + (c0 - c1) * (c0 - c1)) / (2 * (c0 - c1));
  const girderAt = (z: number): number => c0 - (Rg - Math.sqrt(Rg * Rg - z * z));
  const chords = 20;
  for (const sx of [-1, 1]) {
    const x = sideX(sx);
    for (let i = 0; i < chords; i++) {
      const z0 = -springZ + (2 * springZ * i) / chords;
      const z1 = -springZ + (2 * springZ * (i + 1)) / chords;
      member(x, z0, girderAt(z0), z1, girderAt(z1), 0.15, GD, SHU, 0.02);
    }
    for (const s of [-1, 1]) sb.box(0.22, 0.03, 0.4, x, cope + 0.01, s * (springZ - 0.08), BRONZE);
  }

  // The bents: a cross-beam at every station of the railing's that clears the
  // ground; over the span a strut from the girder up to the fascia each side
  // wherever the girder has fallen away from it, over each abutment the end
  // bent's posts standing on the coping, and under each approach posts on
  // footing stones.
  const beamStations = [...pieces.flatMap(([zA, zB]) => stationsOf(zA, zB)), -half, half].sort((a, c) => a - c);
  for (const z of beamStations) {
    const a = Math.abs(z);
    if (!beam(z)) continue;
    const under = walked(z) - 0.59;
    if (a < springZ - 0.3) {
      for (const sx of [-1, 1]) {
        const gt = girderAt(z) + GD / 2;
        const ft = ARCH_CROWN - FASCIA;
        if (ft - gt > 0.06) sb.box(0.12, ft - gt + 0.04, 0.1, sideX(sx), (ft + gt) / 2, z, SHU);
      }
    } else if (a <= half + 0.01) {
      const zp = z - Math.sign(z) * 0.1;
      for (const x of [-(w / 2 - 0.15), 0, w / 2 - 0.15]) {
        sb.box(0.18, under - cope, 0.18, x, (under + cope) / 2, zp, SHU);
        sb.box(0.21, 0.1, 0.21, x, cope + 0.05, zp, BRONZE);
      }
    } else if (a > backZ + 0.15) {
      for (const x of [-(w / 2 - 0.15), 0, w / 2 - 0.15]) {
        const g = ground(x, z);
        if (under - g < 0.3) continue;
        sb.box(0.34, 0.2, 0.34, x, g + 0.04, z, GRANITE);
        const yb = g + 0.14;
        sb.box(0.16, under - yb, 0.16, x, (under + yb) / 2, z, SHU);
      }
    }
  }

  // --- what all of that hides, emitted after it ------------------------------------
  for (const sx of [-1, 1]) {
    const x = railX(sx);
    for (const [zA, zB] of pieces) {
      along(zA, zB, 0.11, 0.51, x, 0.1, SHU);
      along(zA, zB, 0.59, 0.93, x, 0.09, SUMI);
    }
  }
  for (const [zA, zB] of pieces) {
    const depth = zA === -half ? deckT : rampT / Math.cos(pitch);
    along(zA, zB, -depth + 0.005, -0.07, 0, deckW - 0.04, HINOKI);
  }
  for (const s of [-1, 1]) {
    const gl = Math.min(ground(-wa, s * faceZ), ground(0, s * faceZ), ground(wa, s * faceZ)) - 0.2;
    sb.box(wa * 2 - 0.1, cope - 0.14 - gl, backZ - faceZ - 0.2, 0, (cope - 0.14 + gl) / 2, s * ((faceZ + 0.2 + backZ) / 2), GRANITE_DARK);
  }
  lap.flush(b);
  return b;
}
