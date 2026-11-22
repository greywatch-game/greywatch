/**
 * kit/desert/tent.ts — buildTent: a Bedouin black tent (bayt al-sha'r), woven
 * goat-hair strips over three lines of poles, its back and ends walled to the
 * ground, its front open, guyed out to stakes. Part of the desert-town set:
 * follows the contract in kit/core.ts and the set's rules in `./index.ts`.
 * Invariants: ONE porous collider for the whole tent (cloth stops a body,
 * never a round); every pole, stake and wall foot carried to its own ground;
 * seeded off where it stands (`streetSeed`), never `Math.random()`. Never
 * imports another builder.
 */
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import { mulberry32 } from "../../rng";
import {
  ALLOY,
  AWNING,
  Build,
  limb,
  streetSeed,
  type BuildCtx,
  type BuildParams,
  type Structure,
} from "../core";
import {
  GOAT_HAIR,
  MUDBRICK_DARK,
  PALM_BEAM,
  ROOF_MUD,
  SANDBAG,
  SCORCH,
  WHITEWASH,
} from "./shared";

/** The ridge, where the middle line of poles lifts the roof. */
const RIDGE = 2.3;
/** The front eave, raised on its poles so the front stands open. */
const FRONT = 1.75;
/** The back eave, where the back wall is pinned to the roof. */
const BACK = 1.25;
/** How far the guy ropes reach past the roof's edge to their stakes. */
const GUY = 1.0;
/** One woven strip's width: the loom's, sewn side by side into the roof. */
const STRIP = 0.68;

/**
 * The black tent.
 *
 * ## What it is FOR
 *
 * **It says "herders" where nothing else in the kit can**, and a desert town
 * has them: the families who graze the open ground round it and pitch beside
 * the cisterns and the pens. A walled farmstead is the town reaching out into
 * the desert; this is the desert coming in, and the two together are what
 * make the outskirts somewhere people live rather than a band of empty walls.
 *
 * In play it is a SCREEN: a long low silhouette that hides a crouching body
 * from the next dune and stops nothing — one porous box, so a body walks
 * round it and a round goes through it, as through a fence. It is too low and
 * too soft to be anything else, and a tent that stopped a rifle round would be
 * the lie the porous flag exists to avoid.
 *
 * ## How it is built, which is how it reads
 *
 * The roof is woven in long strips run along the tent and sewn edge to edge,
 * so it is drawn as strips: each a box along X, a centimetre or two proud of
 * its neighbour so the ink finds the seams, and each one SAGGING between the
 * poles that hold it up. The sag is the whole read — a flat black lid is a
 * shed roof; a lid that dips between its poles is cloth. The back and the ends
 * are walls of the same cloth pegged to the ground; one end is rolled up for
 * the air now and then; the front is open, and part of it is screened by a
 * side curtain let half down. Inside, the dividing curtain (qata') — the one
 * patterned thing — splits the men's side with its hearth and coffee from the
 * family's with its sacks.
 */
export function buildTent(
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(mats, "tent");
  const w = p.width ?? 9;
  const d = p.depth ?? 5;
  const hair = p.tint ?? GOAT_HAIR;
  const hw = w / 2;
  const hd = d / 2;
  const rnd = mulberry32(streetSeed(w, d, RIDGE, ctx));
  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };

  // --- the collider ----------------------------------------------------------
  b.block({ w, h: 2.0, d, x: 0, y: 1.0, z: 0, porous: true });

  // --- the poles -------------------------------------------------------------
  const bays = Math.max(2, Math.round(w / 3));
  const poleX: number[] = [];
  for (let i = 0; i <= bays; i++) poleX.push(-hw + (i / bays) * w);
  // The roof's height at a point across the tent, before any sag.
  const roofAt = (z: number): number =>
    z < 0 ? RIDGE - ((RIDGE - FRONT) * -z) / hd : RIDGE - ((RIDGE - BACK) * z) / hd;
  for (const px of poleX) {
    for (const [pz, ph] of [
      [-hd + 0.05, FRONT],
      [0, RIDGE],
      [hd - 0.1, BACK],
    ] as const) {
      const g = ground(px, pz);
      // The end poles of the ridge line stand inside the end walls, a hand in.
      const x = px === poleX[0] ? px + 0.12 : px === poleX[bays] ? px - 0.12 : px;
      b.cyl(ph - g + 0.15, 0.07, 0.09, 6, x, (ph + g - 0.15) / 2, pz, PALM_BEAM);
    }
  }

  // --- the roof ----------------------------------------------------------------
  // Strips along X, from the ridge down each slope, sagging between poles.
  const slope = (zEave: number, yEave: number, dir: -1 | 1): void => {
    const run = Math.abs(zEave);
    const fall = RIDGE - yEave;
    const span = Math.hypot(run, fall);
    const n = Math.max(2, Math.round(span / STRIP));
    const pitch = Math.atan2(fall, run);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const z = dir * t * run;
      const y0 = RIDGE - t * fall + (k % 2 ? 0.015 : 0);
      // Cloth sags more the further it is from the ridge pole holding it.
      const sag = 0.1 + 0.26 * t + rnd() * 0.05;
      for (let i = 0; i < bays; i++) {
        const xa = poleX[i];
        const xb = poleX[i + 1];
        const half = (xb - xa) / 2;
        const tilt = Math.atan2(sag, half);
        const len = Math.hypot(half, sag) + 0.04;
        for (const s of [-1, 1] as const) {
          // The half from one pole down to the bay's lowest point.
          const cx = (xa + xb) / 2 + (s * half) / 2;
          b.box(len, 0.05, span / n + 0.03, cx, y0 - sag / 2, z, hair, {
            z: s * tilt,
            x: dir < 0 ? -pitch : pitch,
          });
        }
      }
    }
  };
  slope(-hd, FRONT, -1);
  slope(hd, BACK, 1);
  // The ridge: the cloth gathered over the middle line, and the wooden saddle
  // under it on each pole that keeps a pole-top from wearing through.
  b.box(w + 0.1, 0.07, 0.36, 0, RIDGE + 0.02, 0, hair);
  for (const px of poleX.slice(1, -1)) {
    b.box(0.5, 0.08, 0.14, px, RIDGE + 0.08, 0, PALM_BEAM);
  }

  // --- the walls ----------------------------------------------------------------
  // The back: cloth from the back eave to the ground, in panels between the
  // poles, each pegged at its foot and bellying a little.
  for (let i = 0; i < bays; i++) {
    const xa = poleX[i];
    const xb = poleX[i + 1];
    const parts = Math.max(2, Math.round((xb - xa) / 1.2));
    for (let k = 0; k < parts; k++) {
      const x = xa + ((k + 0.5) * (xb - xa)) / parts;
      const g = ground(x, hd);
      const h = BACK - g + 0.08;
      b.box((xb - xa) / parts + 0.02, h, 0.05, x, g + h / 2 - 0.08, hd - 0.02 + (k % 2 ? 0.02 : 0), hair, { x: 0.05 });
    }
  }
  // The ends: cloth from the roof line to the ground, in vertical strips
  // across the depth. One end is rolled up to the eave for the air on about
  // one tent in three.
  const rolled = rnd() < 0.35 ? (rnd() < 0.5 ? -1 : 1) : 0;
  for (const sx of [-1, 1] as const) {
    const x = sx * (hw - 0.02);
    const cols = Math.max(5, Math.round(d / 0.42));
    for (let k = 0; k < cols; k++) {
      const z = -hd + ((k + 0.5) * d) / cols;
      const top = roofAt(z) - 0.04;
      if (sx === rolled) {
        // Rolled: a fat roll of cloth under the eave, and air under it.
        b.cyl(d / cols + 0.02, 0.22, 0.22, 6, x, top - 0.12, z, hair, { x: Math.PI / 2 });
        continue;
      }
      // The front column of each end is left open: the front stands open.
      if (k === 0) continue;
      const g = ground(x, z);
      const h = top - g + 0.08;
      b.box(0.05, h, d / cols + 0.02, x + (k % 2 ? sx * 0.02 : 0), g + h / 2 - 0.08, z, hair);
    }
  }
  // The side curtain (ruag) let half down across part of the front, the
  // family's end — its hem ragged, a strip at a time.
  const screen = rnd() < 0.5 ? -1 : 1;
  const sw = w * (0.3 + rnd() * 0.15);
  const sx0 = screen < 0 ? -hw : hw - sw;
  const drop = FRONT * (0.4 + rnd() * 0.35);
  const sstrips = Math.max(3, Math.round(sw / 0.6));
  for (let k = 0; k < sstrips; k++) {
    const x = sx0 + ((k + 0.5) * sw) / sstrips;
    const h = drop * (0.82 + rnd() * 0.3);
    b.box(sw / sstrips + 0.02, h, 0.05, x, FRONT - h / 2, -hd + 0.03 + (k % 2 ? 0.02 : 0), hair);
  }
  // The valance along the front eave: a band of the same weave with a white
  // stripe in it, the one decoration a tent's outside wears.
  b.box(w + 0.04, 0.22, 0.05, 0, FRONT - 0.08, -hd - 0.01, hair);
  b.box(w + 0.04, 0.05, 0.06, 0, FRONT - 0.13, -hd - 0.02, WHITEWASH);

  // --- the dividing curtain ------------------------------------------------------
  // The qata', on the first pole line in from the family's end: woven in bands
  // of red and white over the undyed wool, from the ground to the roof, short
  // of the front so a body walks round its end.
  const qx = screen < 0 ? poleX[1] : poleX[bays - 1];
  const qz0 = -hd + 0.9;
  const qz1 = hd - 0.1;
  const qcols = 4;
  for (let k = 0; k < qcols; k++) {
    const z = qz0 + ((k + 0.5) * (qz1 - qz0)) / qcols;
    const top = roofAt(z) - 0.06;
    const g = ground(qx, z);
    const h = top - g;
    b.box(0.04, h, (qz1 - qz0) / qcols + 0.01, qx + 0.08, g + h / 2, z, SANDBAG);
    for (const f of [0.22, 0.48, 0.74]) {
      b.box(0.05, 0.12, (qz1 - qz0) / qcols + 0.01, qx + 0.08, g + h * f, z, AWNING);
      b.box(0.05, 0.04, (qz1 - qz0) / qcols + 0.01, qx + 0.08, g + h * f + 0.1, z, WHITEWASH);
    }
  }

  // --- the guys ------------------------------------------------------------------
  // From the top of every front and back pole out to a stake, and from each
  // end of the ridge out past the end walls: the ropes are what make a tent
  // read as held up rather than set down.
  const guy = (from: [number, number, number], sx: number, sz: number): void => {
    const g = ground(sx, sz);
    limb(b, from, [sx, g + 0.12, sz], 0.035, 0.03, SANDBAG, 4);
    b.box(0.06, 0.32, 0.06, sx, g + 0.1, sz, PALM_BEAM, { x: (sz > 0 ? 1 : -1) * 0.35 });
  };
  for (const px of poleX) {
    guy([px, FRONT, -hd], px, -hd - GUY);
    guy([px, BACK, hd], px, hd + GUY);
  }
  guy([-hw, RIDGE - 0.05, 0], -hw - GUY, 0);
  guy([hw, RIDGE - 0.05, 0], hw + GUY, 0);

  // --- inside --------------------------------------------------------------------
  // The men's side: rugs, cushions against the back wall, and the hearth at
  // the open front with the coffee pot in its ashes. The family's side: sacks
  // of grain and flour against the back wall, and the bedding rolled.
  const menX0 = screen < 0 ? qx + 0.2 : -hw + 0.2;
  const menX1 = screen < 0 ? hw - 0.2 : qx - 0.2;
  const mx = (menX0 + menX1) / 2;
  const mw = menX1 - menX0;
  const rugY = ground(mx, 0) + 0.02;
  b.box(mw * 0.9, 0.025, d * 0.62, mx, rugY, hd * 0.1, AWNING);
  b.box(mw * 0.9 - 0.3, 0.03, d * 0.62 - 0.3, mx, rugY + 0.005, hd * 0.1, ROOF_MUD);
  b.box(mw * 0.9 - 0.6, 0.035, 0.12, mx, rugY + 0.01, hd * 0.1, WHITEWASH);
  const cushions = Math.max(2, Math.floor(mw / 1.1));
  for (let i = 0; i < cushions; i++) {
    const x = menX0 + ((i + 0.5) * mw) / cushions;
    const g = ground(x, hd - 0.45);
    b.box(0.85, 0.32, 0.38, x, g + 0.16, hd - 0.45, i % 2 ? AWNING : SANDBAG, { y: (rnd() - 0.5) * 0.15 });
  }
  // The hearth: a ring of stones, the ash in it, a coffee pot and its cups.
  const hx = mx + (rnd() - 0.5) * mw * 0.3;
  const hz = -hd + 0.7;
  const hg = ground(hx, hz);
  b.box(0.7, 0.02, 0.7, hx, hg + 0.01, hz, SCORCH, { y: rnd() });
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    b.box(0.18, 0.13, 0.14, hx + Math.cos(a) * 0.42, hg + 0.06, hz + Math.sin(a) * 0.42, MUDBRICK_DARK, { y: a });
  }
  b.cyl(0.24, 0.08, 0.17, 8, hx + 0.08, hg + 0.14, hz, ALLOY);
  b.cyl(0.08, 0.04, 0.08, 6, hx + 0.08, hg + 0.3, hz, ALLOY);
  b.box(0.1, 0.03, 0.03, hx + 0.2, hg + 0.24, hz, ALLOY, { z: 0.5 });
  // The family's side.
  const famX0 = screen < 0 ? -hw + 0.3 : qx + 0.3;
  const famX1 = screen < 0 ? qx - 0.3 : hw - 0.3;
  const sacks = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < sacks; i++) {
    const x = famX0 + rnd() * (famX1 - famX0);
    const z = hd - 0.4 - rnd() * 0.5;
    const g = ground(x, z);
    b.cyl(0.55, 0.36, 0.42, 7, x, g + 0.27, z, i % 3 ? SANDBAG : WHITEWASH, { y: rnd() * 2 });
  }
  const bx = (famX0 + famX1) / 2;
  b.cyl(Math.min(1.4, famX1 - famX0), 0.38, 0.38, 8, bx, ground(bx, 0.2) + 0.2, 0.2, AWNING, { z: Math.PI / 2 });
  return b;
}
