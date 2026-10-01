/**
 * kit/structures/shed.ts — buildShed: the boarded pent shed.
 * Part of the structures set: follows the contract in kit/core.ts, and the
 * cover heights and round-collider rule in `./index.ts`.
 */
import { Scene } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import { mulberry32 } from "../../rng";
import {
  Build,
  carve,
  convexSolid,
  onFace,
  outward,
  slab,
  type BuildCtx,
  type BuildParams,
  type Structure,
  type Point3,
  type Hole,
  type Side,
  streetSeed,
  CASEMENT,
  DARK_STONE,
  DOOR_PAINTS,
  IRON,
  PITCH,
  PLANK,
  RUST,
  STONE,
  THATCH,
  TIMBER,
} from "../core";

/**
 * Pent shed: a boarded outbuilding under a single-pitch roof, its door in
 * the tall front (local -Z) and the roof falling to the back. Solid, never
 * enterable.
 *
 * **It is built the way one is built.** The shed it replaces was a plank box
 * with a post at each corner and a flat lid tipped over it, which left a
 * wedge of sky between the lid and the box at both ends. So: a rubble footing
 * with its joints drawn and a sole plate on it; walls of boards with a batten
 * over every joint and a board on every corner, the ends boarded up to the
 * roof's own line; rafters on the wall heads with their tails bare under both
 * eaves, a deck on them, and over it corrugated iron in lapped sheets or
 * tarred felt in strips with a roll batten at every lap, a fascia along the
 * high eave and a barge board down each verge; a ledged-and-braced door — two
 * leaves on a long shed — on strap hinges with a padlocked hasp, a stone step
 * in front of it, and a four-light window beside it and maybe in an end. Then
 * what a shed has on it: a gutter and a downpipe, a ladder on hooks along the
 * back, a spade and a coil of rope on an end.
 *
 * **The collider is the box it has always been**, w x h x d, first and alone,
 * and the solid under all the boarding is that box to its own height with
 * the roof's wedge over it, so no round stops on air. Everything else is flat
 * on a face (the proudest thing is the hung ladder, 9 cm), low enough to walk
 * over (the step, the downpipe's shoe) or over the wall heads: the low eave's
 * lowest point is 2.5 m up at the default height.
 *
 * Seeded off where it stands (`streetSeed`) — whether it is tarred, which
 * roof, which hand the door hangs, its paint and what hangs on the walls —
 * and its footing is cut to the ground under each wall, which puts `shed` in
 * `CONFORMS_TO_TERRAIN`.
 */
export function buildShed(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "shed");
  const w = p.width ?? 3.4;
  const d = p.depth ?? 2.8;
  const h = p.height ?? 2.6;
  // ---- the collider: the box it has always been.
  b.block({ w, h, d, x: 0, y: h / 2, z: 0 });

  const seed = streetSeed(w, d, h, ctx);
  const rnd = mulberry32(seed);
  /** A tarred shed is black all over and always roofed in iron: felt on tar is one blot. */
  const tarred = (seed >>> 3) % 3 === 0;
  const ironRoof = tarred || (seed >>> 5) % 2 === 0;
  /** Which end of the front a single door keeps to, and so which end everything else takes. */
  const hand = (seed >>> 7) % 2 === 0 ? -1 : 1;
  const CLAD = tarred ? PITCH : PLANK;
  const DOOR = [CLAD, CLAD, ...DOOR_PAINTS][(seed >>> 9) % (DOOR_PAINTS.length + 2)];
  const gutter = (seed >>> 12) % 5 < 3;
  const ladder = w >= 3 && (seed >>> 14) % 2 === 0;
  const endWindow = d >= 2.6 && (seed >>> 16) % 3 === 0;
  const tools = (seed >>> 18) % 2 === 0;

  /** The floor under a local point, as a local height — the stall's reading. */
  const ground = (lx: number, lz: number): number => {
    if (!ctx || Math.abs(ctx.y - ctx.floor) > 0.05) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    const g = ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
    return Math.max(-0.6, Math.min(0.4, g));
  };

  // ---- the numbers everything hangs off.
  /** The footing's top, and the sole plate's: where the boarding starts. */
  const FOOT = 0.2;
  const SILL = FOOT + 0.08;
  /** A quarter pitch whatever the depth, so a deep shed is a taller front. */
  const rise = d * 0.25;
  /** The roof line over a point on plan: h + rise at the front face, h at the back. */
  const top = (z: number): number => h + rise * (0.5 - z / d);
  const pitch = Math.atan2(rise, d);
  const ca = Math.cos(pitch);
  const sa = Math.sin(pitch);
  /** A point `off` out from the roof line, square to it, over (x, z) on plan. */
  const onRoof = (x: number, z: number, off: number): Point3 => [x, top(z) + off * ca, z + off * sa];
  /** The eaves' reach past the front and the back, and the verges' past the ends. */
  const zF = -d / 2 - 0.22;
  const zB = d / 2 + 0.32;
  const xE = w / 2 + 0.2;
  const holes: Record<Side, Hole[]> = { "-z": [], "+z": [], "-x": [], "+x": [] };

  // ================================================================= the door
  const double = w >= 5.5;
  const leafW = double ? 0.95 : 0.86;
  const doorW = double ? 2 * leafW : leafW;
  const dh = double ? 2.0 : 1.88;
  const doorX = double ? 0 : hand * Math.max(0, Math.min(w / 4, w / 2 - doorW / 2 - 0.35));
  const y0 = SILL;
  const y1 = SILL + dh;
  holes["-z"].push({ u0: doorX - doorW / 2 - 0.07, u1: doorX + doorW / 2 + 0.07, y0: FOOT, y1: y1 + 0.07 });
  // The casing: two jambs and a head.
  for (const s of [-1, 1]) {
    onFace(b, "-z", d / 2, doorX + s * (doorW / 2 + 0.035), (y0 + y1 + 0.07) / 2, 0.07, dh + 0.07, 0.03, 0.015, TIMBER);
  }
  onFace(b, "-z", d / 2, doorX, y1 + 0.035, doorW + 0.14, 0.07, 0.03, 0.015, TIMBER);
  // Each leaf: upright boards, alternately a few millimetres proud, three
  // ledges across them, a brace between each pair with its foot on the hinge
  // side where it is in compression, and a strap hinge along the top and
  // bottom ledge onto a pintle in the jamb.
  const leaves: [number, number][] = double
    ? [
        [doorX - leafW / 2, -1],
        [doorX + leafW / 2, 1],
      ]
    : [[doorX, hand]];
  for (const [cx, hs] of leaves) {
    const nb = 5;
    const bw = leafW / nb;
    for (let i = 0; i < nb; i++) {
      onFace(b, "-z", d / 2, cx - leafW / 2 + bw * (i + 0.5), (y0 + y1) / 2, bw - 0.006, dh, 0.024, 0.012 + (i % 2) * 0.004, DOOR);
    }
    const ly = [y0 + 0.22, (y0 + y1) / 2, y1 - 0.22];
    for (const y of ly) onFace(b, "-z", d / 2, cx, y, leafW - 0.08, 0.1, 0.022, 0.037, DOOR);
    const z = -(d / 2 + 0.037);
    for (let k = 0; k < 2; k++) {
      const xa = cx + hs * (leafW / 2 - 0.1);
      const xc = cx - hs * (leafW / 2 - 0.1);
      slab(b, [xa, ly[k] + 0.03, z], [xc, ly[k + 1] - 0.03, z], 0.022, 0.09, DOOR);
    }
    for (const y of [ly[0], ly[2]]) {
      onFace(b, "-z", d / 2, cx + hs * leafW * 0.2, y, leafW * 0.6, 0.035, 0.008, 0.052, IRON);
      onFace(b, "-z", d / 2, cx + hs * (leafW / 2 + 0.035), y, 0.045, 0.07, 0.02, 0.04, IRON);
    }
  }
  // The hasp and its padlock where the door shuts, and a pull beside them.
  {
    const lx = double ? doorX : doorX - hand * (leafW / 2 - 0.09);
    const ly = y0 + 1.12;
    onFace(b, "-z", d / 2, lx, ly, 0.17, 0.035, 0.01, 0.031, IRON);
    onFace(b, "-z", d / 2, lx, ly - 0.05, 0.045, 0.06, 0.025, 0.048, IRON);
    const px = double ? doorX + 0.2 : lx + hand * 0.12;
    onFace(b, "-z", d / 2, px, ly - 0.02, 0.025, 0.16, 0.02, 0.05, IRON);
    for (const s of [-1, 1]) onFace(b, "-z", d / 2, px, ly - 0.02 + s * 0.07, 0.025, 0.02, 0.03, 0.035, IRON);
  }
  // A stone step in front of it, its top under the sill and no higher than a
  // stride over the ground.
  {
    const gz = -d / 2 - 0.21;
    const gs = [ground(doorX - doorW / 2, gz), ground(doorX, gz), ground(doorX + doorW / 2, gz)];
    const stepTop = Math.min(FOOT - 0.03, Math.max(...gs) + 0.14);
    const stepBottom = Math.min(...gs) - 0.08;
    if (stepTop > Math.max(...gs) + 0.04) {
      b.box(doorW + 0.3, stepTop - stepBottom, 0.42, doorX, (stepTop + stepBottom) / 2, gz, DARK_STONE, { y: (rnd() - 0.5) * 0.04 });
    }
  }

  // ============================================================== the windows
  // Four lights in a frame, bars across them, a sill board to throw the rain
  // off and the dark glass behind all of it.
  const shedWindow = (s: Side, plane: number, u: number): void => {
    const ww = 0.62;
    const wh = 0.5;
    const sill = 1.25;
    holes[s].push({ u0: u - ww / 2 - 0.06, u1: u + ww / 2 + 0.06, y0: sill - 0.1, y1: sill + wh + 0.06 });
    for (const k of [-1, 1]) {
      onFace(b, s, plane, u + k * (ww / 2 + 0.0275), sill + wh / 2, 0.055, wh + 0.11, 0.03, 0.015, TIMBER);
      onFace(b, s, plane, u, sill + wh / 2 + k * (wh / 2 + 0.0275), ww, 0.055, 0.03, 0.015, TIMBER);
    }
    onFace(b, s, plane, u, sill + wh / 2, 0.025, wh, 0.02, 0.01, TIMBER);
    onFace(b, s, plane, u, sill + wh / 2, ww, 0.025, 0.02, 0.01, TIMBER);
    onFace(b, s, plane, u, sill - 0.075, ww + 0.2, 0.04, 0.08, 0.04, TIMBER);
    onFace(b, s, plane, u, sill + wh / 2, ww, wh, 0.006, 0.003, CASEMENT);
  };
  if (double) {
    const u = (doorW / 2 + 0.2 + w / 2) / 2;
    if (w >= 7) for (const s of [-1, 1]) shedWindow("-z", d / 2, s * u);
    else shedWindow("-z", d / 2, -hand * u);
  } else {
    const far = (-hand * w) / 2;
    const near = doorX - hand * (doorW / 2 + 0.07);
    if (Math.abs(near - far) >= 0.95) shedWindow("-z", d / 2, (far + near) / 2);
  }
  /** The end the door keeps away from takes the window; the other takes the tools. */
  const windowEnd: Side = hand > 0 ? "-x" : "+x";
  const toolEnd: Side = hand > 0 ? "+x" : "-x";
  if (endWindow) shedWindow(windowEnd, w / 2, -0.15);

  // ============================================================= the boarding
  // A batten over every board joint, cut round the openings and, on the ends,
  // to the roof's line; a board down every corner; a sole plate round the foot.
  {
    const BW = 0.06;
    const BT = 0.022;
    const battens = (s: Side, plane: number, run: number, topAt: (u: number) => number): void => {
      const n = Math.max(2, Math.round(run / 0.3));
      for (let i = 1; i < n; i++) {
        const u = -run / 2 + (i * run) / n;
        const cuts = holes[s]
          .filter((o) => u + BW / 2 > o.u0 && u - BW / 2 < o.u1)
          .map((o): [number, number] => [o.y0, o.y1]);
        for (const [a, c] of carve(SILL, topAt(u), cuts)) {
          if (c - a < 0.08) continue;
          onFace(b, s, plane, u, (a + c) / 2, BW, c - a, BT, BT / 2, CLAD);
        }
      }
    };
    battens("-z", d / 2, w, () => h + rise);
    battens("+z", d / 2, w, () => h - 0.01);
    for (const s of ["-x", "+x"] as const) battens(s, w / 2, d, (u) => top(u + BW / 2));
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const yT = sz < 0 ? h + rise : h - 0.01;
        b.box(0.11, yT - SILL, 0.026, sx * (w / 2 - 0.029), (yT + SILL) / 2, sz * (d / 2 + 0.013), CLAD);
        const zc = sz * (d / 2 - 0.055);
        const yE = top(zc + 0.055);
        b.box(0.026, yE - SILL, 0.11, sx * (w / 2 + 0.013), (yE + SILL) / 2, zc, CLAD);
      }
    }
    for (const sz of [-1, 1]) b.box(w + 0.07, 0.08, 0.035, 0, FOOT + 0.04, sz * (d / 2 + 0.0175), TIMBER);
    for (const sx of [-1, 1]) b.box(0.035, 0.08, d, sx * (w / 2 + 0.0175), FOOT + 0.04, 0, TIMBER);
  }

  // ============================================================== the footing
  // Rubble stones of mixed lengths laid 3 cm apart over a dark core set back
  // behind them, each standing a little prouder or less than the last, so
  // every joint is a step the ink finds; carried down to the lowest ground
  // under each wall.
  {
    const course = (s: Side, plane: number, run: number, samples: number[]): void => {
      const base = Math.min(0, ...samples) - 0.1;
      let u = -run / 2;
      while (u < run / 2 - 0.01) {
        let len = 0.45 + rnd() * 0.4;
        if (run / 2 - u - len < 0.25) len = run / 2 - u;
        const t = FOOT - rnd() * 0.015;
        onFace(b, s, plane, u + len / 2, (t + base) / 2, len - 0.03, t - base, 0.07, -0.005 + rnd() * 0.012, STONE);
        u += len;
      }
      onFace(b, s, plane, 0, (FOOT - 0.01 + base) / 2, run, FOOT - 0.01 - base, 0.06, -0.02, DARK_STONE);
    };
    for (const s of ["-z", "+z"] as const) {
      const z = (s === "-z" ? -1 : 1) * (d / 2);
      course(s, d / 2, w + 0.06, [ground(-w / 2, z), ground(0, z), ground(w / 2, z)]);
    }
    for (const s of ["-x", "+x"] as const) {
      const x = (s === "-x" ? -1 : 1) * (w / 2);
      course(s, w / 2, d, [ground(x, -d / 2), ground(x, 0), ground(x, d / 2)]);
    }
  }

  // ================================================================= the roof
  // The covering first, since it hides the deck and the deck the rafters.
  if (ironRoof) {
    // Sheets laid down the slope, alternately a few millimetres up so every
    // side lap is a step, three ribs on each; a deep roof takes two courses,
    // the upper lapped over the lower. One in six has been replaced and is
    // still dark from the galvanising.
    const ns = Math.max(2, Math.ceil((2 * xE) / 0.78));
    const sw = (2 * xE) / ns;
    const mid = (zF + zB) / 2;
    const runs: [number, number][] =
      (zB - zF) / ca > 2.6
        ? [
            [mid - 0.075, zB + 0.03],
            [zF - 0.02, mid + 0.075],
          ]
        : [[zF - 0.02, zB + 0.03]];
    runs.forEach(([z0, z1], c) => {
      for (let i = 0; i < ns; i++) {
        const x = -xE + sw * (i + 0.5);
        const off = 0.131 + c * 0.014 + (i % 2) * 0.004;
        const col = rnd() < 0.17 ? IRON : RUST;
        slab(b, onRoof(x, z0, off), onRoof(x, z1, off), sw + 0.03, 0.008, col);
        for (let r = 0; r < 3; r++) {
          const rx = x - sw / 2 + (sw * (r + 0.5)) / 3;
          slab(b, onRoof(rx, z0, off + 0.014), onRoof(rx, z1, off + 0.014), 0.035, 0.02, col);
        }
      }
    });
  } else {
    // Felt in strips down the slope, a roll batten over every lap and at both
    // verges, and the felt dressed down over the high eave.
    const ns = Math.max(2, Math.ceil((2 * xE) / 0.9));
    const sw = (2 * xE) / ns;
    for (let i = 0; i < ns; i++) {
      const x = -xE + sw * (i + 0.5);
      const off = 0.131 + (i % 2) * 0.003;
      slab(b, onRoof(x, zF - 0.015, off), onRoof(x, zB + 0.015, off), sw + 0.02, 0.01, PITCH);
    }
    for (let i = 0; i <= ns; i++) {
      const x = Math.max(-xE + 0.025, Math.min(xE - 0.025, -xE + sw * i));
      slab(b, onRoof(x, zF - 0.015, 0.155), onRoof(x, zB + 0.015, 0.155), 0.045, 0.04, PITCH);
    }
    const [, yf, zf] = onRoof(0, zF - 0.015, 0.131);
    b.box(2 * xE + 0.02, 0.07, 0.012, 0, yf - 0.03, zf - 0.006 - 0.015 * sa, PITCH);
  }
  // The fascia along the high eave and a barge board down each verge, their
  // tops at the deck's.
  {
    const [, yf, zf] = onRoof(0, zF, 0.125);
    b.box(2 * xE + 0.05, 0.2, 0.025, 0, yf - 0.1, zf - 0.0125, TIMBER);
    for (const sx of [-1, 1]) {
      const x = sx * (xE + 0.0125);
      slab(b, onRoof(x, zF - 0.025, 0.035), onRoof(x, zB, 0.035), 0.025, 0.2, TIMBER);
    }
  }
  // The deck, and the rafters under it on the wall heads.
  slab(b, onRoof(0, zF, 0.1125), onRoof(0, zB, 0.1125), 2 * xE, 0.025, PLANK);
  {
    const nr = Math.max(3, Math.round(w / 0.6) + 1);
    for (let i = 0; i < nr; i++) {
      const x = -w / 2 + 0.03 + (i * (w - 0.06)) / (nr - 1);
      slab(b, onRoof(x, zF + 0.03, 0.05), onRoof(x, zB - 0.02, 0.05), 0.05, 0.1, TIMBER);
    }
  }
  // A gutter on the low eave, and the downpipe off its end: a swan neck back
  // to the wall, down the boarding on two clips, and a shoe at the foot.
  if (gutter) {
    const [, ye, ze] = onRoof(0, zB, 0.12);
    const gy = ye - 0.075;
    const gz = ze + 0.06;
    b.box(2 * xE - 0.08, 0.075, 0.11, 0, gy, gz, IRON);
    const px = hand * (w / 2 - 0.18);
    const pz = d / 2 + 0.05;
    const neck = gy - 0.34;
    slab(b, [px, gy - 0.02, gz], [px, neck, pz], 0.065, 0.065, IRON);
    b.box(0.065, neck - 0.36, 0.065, px, (neck + 0.36) / 2, pz, IRON);
    slab(b, [px, 0.4, pz], [px, 0.3, pz + 0.1], 0.065, 0.065, IRON);
    for (const y of [0.9, neck - 0.3]) onFace(b, "+z", d / 2, px, y, 0.1, 0.03, 0.05, 0.025, IRON);
  }

  // ======================================================= what hangs on it
  // A ladder on two hooks along the back, away from the downpipe.
  if (ladder) {
    const len = Math.min(w - 0.8, 3.0);
    const lx = -hand * (w / 2 - 0.3 - len / 2);
    const z = d / 2 + 0.07;
    for (const y of [1.45, 1.83]) onFace(b, "+z", d / 2, lx, y, len, 0.07, 0.045, 0.07, TIMBER);
    const n = Math.round(len / 0.3);
    for (let i = 0; i < n; i++) b.cyl(0.33, 0.032, 0.032, 6, lx - len / 2 + ((i + 0.5) * len) / n, 1.64, z, TIMBER);
    for (const k of [-1, 1]) onFace(b, "+z", d / 2, lx + k * len * 0.3, 1.4, 0.03, 0.08, 0.09, 0.045, IRON);
  }
  // A spade hung by its handle and a coil of rope on a nail, on the end the
  // window is not.
  if (tools) {
    const n = outward(toolEnd);
    const x = n * (w / 2);
    // The spade: a shaft, a D handle over the nail, the blade at the foot.
    const su = 0.45;
    b.cyl(0.78, 0.036, 0.036, 6, x + n * 0.04, 1.18, su, TIMBER);
    onFace(b, toolEnd, w / 2, su, 1.63, 0.14, 0.025, 0.03, 0.04, TIMBER);
    for (const k of [-1, 1]) onFace(b, toolEnd, w / 2, su + k * 0.06, 1.58, 0.025, 0.1, 0.03, 0.04, TIMBER);
    onFace(b, toolEnd, w / 2, su, 0.67, 0.19, 0.28, 0.012, 0.03, IRON);
    onFace(b, toolEnd, w / 2, su, 1.66, 0.02, 0.02, 0.06, 0.03, IRON);
    // The rope: two turns proud of each other, dark in the middle.
    const ru = -0.4;
    b.cyl(0.05, 0.36, 0.36, 10, x + n * 0.035, 1.45, ru, THATCH, { z: Math.PI / 2 });
    b.cyl(0.05, 0.3, 0.3, 10, x + n * 0.06, 1.47, ru + 0.02, THATCH, { z: Math.PI / 2 });
    b.cyl(0.052, 0.17, 0.17, 8, x + n * 0.062, 1.47, ru + 0.02, CLAD, { z: Math.PI / 2 });
    onFace(b, toolEnd, w / 2, ru, 1.62, 0.02, 0.02, 0.06, 0.03, IRON);
  }

  // ================================================== the body behind it all
  // The collider's box and the roof's wedge over it, emitted after everything
  // it is hidden by.
  {
    const sec = (x: number): Point3[] => [
      [x, FOOT - 0.01, -d / 2],
      [x, FOOT - 0.01, d / 2],
      [x, h, d / 2],
      [x, h + rise, -d / 2],
    ];
    convexSolid(b, sec(-w / 2), sec(w / 2), CLAD);
  }
  return b;
}
