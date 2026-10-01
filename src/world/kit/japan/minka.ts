/**
 * kit/japan/minka.ts — buildMinka: the thatched farmhouse.
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
  type Side,
  type Structure,
  HIDE_UNDER,
  StoneBatch,
  carve,
  convexSolid,
  hideBack,
  orient,
  outward,
  runsAlongX,
  streetSeed,
} from "../core";
import {
  CEDAR,
  GRANITE,
  GRANITE_DARK,
  HINOKI,
  KAKI,
  KAWARA_DARK,
  KAYA,
  KAYA_DARK,
  PAPER,
  SHIKKUI,
  SHOJI_GLOW,
  SUMI,
  TSUCHI,
} from "./palette";
import { curvedRoof, type RoofSpec } from "./roof";

/**
 * A MINKA: an Edo farmhouse under a thatched roof as tall as the walls under
 * it — which is most of the building from any distance and is what makes a
 * farm read as a farm.
 *
 * **It was a mud box ringed by thin posts under a smooth brown hip of
 * thatch**: one seamless sheet with a bar along its top and five pairs of
 * sticks on it, the walls a plaster block with a post every bay, two grids of
 * shoji, a deck slab laid on nothing, and nothing on the back or the ends at
 * all. What makes a minka one is the THATCH — how thick it is, how it is cut
 * and how it is closed at the top — and the timber frame the mud is laid in,
 * so that is where this spends its vertices:
 *
 * - **The roof is a hip under a GABLE** (irimoya): the hip is the old roof
 *   exactly, and at each end of the ridge a vertical triangle stands on the
 *   hip, where the long slopes run on past the ridge's end as a thick verge of
 *   thatch cut plumb. `gx` is where that triangle stands, and it is where the
 *   plane of the triangle's two edges is the plane of the long slopes, so the
 *   verge slab lies ON the roof over its whole length and only floats where it
 *   crosses the hip — which is the gable roof. Half the farms keep the smoke
 *   gable open behind a lattice of slats; the other half plaster it white and
 *   write 水 on it, the fire charm a thatched house was never without.
 * - **The eave is CUT in tiers**, a dark bottom course standing furthest out
 *   and a middle one between it and the sheet, so the cut face reads as three
 *   layers of reed, and a course lies proud of the slope a third of the way up
 *   it — each a band of `curvedRoof` with `grow`/`raise` and, where its top
 *   edge is seen, a riser (`closeTop`). Rafters run under the eave from the
 *   wall to the cut, a pole ties them under their ends, and a heavier rafter
 *   runs out under each hip.
 * - **The ridge is bound**: a flared bundle of thatch with a bamboo rail
 *   along each shoulder, lashed every half metre, and pairs of crossed
 *   timbers (umanori) riding it with a pole laid in their crotches.
 * - **The walls are a FRAME**: a sill on the plinth, posts, a tie at door
 *   height and the wall plate, a board wainscot under battens round the back
 *   and the ends, and the mud between. The front is an engawa — sliding shoji
 *   between posts, lapped in two tracks over board kick panels, a box for the
 *   storm shutters at each end, the deck's boards laid lengthways on a front
 *   beam carried on short posts on stones. A boarded door with a wicket where
 *   the house is shut, the doorway where it is not, and a stone to step up by.
 * - **The back** has the kitchen door under a board hood and bamboo-barred
 *   windows in bays either side; one **end** has a window and the other a
 *   stack of firewood under a straw mat — and, on most, strings of persimmons
 *   drying under its eave (`KAKI`).
 * - **Inside** an enterable one, the roof slab the rounds already stop on is a
 *   boarded loft floor on joists and beams, and a hearth is let into the floor.
 *
 * Seeded by where it stands (`streetSeed`), which is why it is in
 * `CONFORMS_TO_TERRAIN`: which gable is open, which end is stacked, whether
 * the persimmons are up, the back door's bay and the wicket's leaf — and the
 * plinth, the deck's stones and the steps are carried down to the ground.
 *
 * **The colliders are unchanged, byte for byte and in the same order**: the
 * walls (the old `doorWall` and `wall` calls) or the mass, the deck, and the
 * flat roof slab at the eave. Everything drawn is on a face (none more than
 * 0.6 m proud — the firewood, as far out as the kura's leaves), ankle high (the plinth's lip, the hearth, the
 * steps), overhead (the roof, the loft's beams at 2.45 m), or ON the deck's
 * own collider, whose drawn top is its top. The repeated work is laid through
 * `StoneBatch` as one surface per colour.
 */
export function buildMinka(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "minka");
  const w = p.width ?? 12;
  const d = p.depth ?? 8;
  const h = p.height ?? 3.0;
  const t = 0.32;
  const lit = !!p.litWindows;
  const ex = w / 2 + 1.3;
  const ez = d / 2 + 1.3;

  // --- colliders, exactly as they were: the walls (the old `doorWall` and
  // `wall` calls) or the mass, the deck, then the roof slab at the eave.
  if (p.enterable) {
    const side = (w - 2.4) / 2;
    const off = 2.4 / 2 + side / 2;
    const lintel = h - 2.3;
    const fz = -d / 2 + t / 2;
    b.block({ w: side, h, d: t, x: 0 - off, y: h / 2, z: fz });
    b.block({ w: side, h, d: t, x: 0 + off, y: h / 2, z: fz });
    b.block({ w: 2.4, h: lintel, d: t, x: 0, y: h / 2 + h / 2 - lintel / 2, z: fz });
    b.block({ w, h, d: t, x: 0, y: h / 2, z: d / 2 - t / 2 });
    b.block({ w: t, h, d, x: -w / 2 + t / 2, y: h / 2, z: 0 });
    b.block({ w: t, h, d, x: w / 2 - t / 2, y: h / 2, z: 0 });
  } else {
    b.block({ w, h, d, x: 0, y: h / 2, z: 0 });
  }
  b.block({ w, h: 0.45, d: 1.2, x: 0, y: 0.225, z: -d / 2 - 0.6 });
  b.block({ w: ex * 2, h: 0.3, d: ez * 2, x: 0, y: h, z: 0 });

  // --- everything below is drawing -------------------------------------------
  const rnd = mulberry32(streetSeed(w, d, h, ctx));
  const woodEnd: Side = rnd() < 0.5 ? "-x" : "+x";
  const winEnd: Side = woodEnd === "-x" ? "+x" : "-x";
  const charm = rnd() < 0.5;
  const kaki = rnd() < 0.65;
  const wicket = rnd() < 0.5 ? -1 : 1;
  const bays = Math.max(3, Math.round(w / 1.8));
  const bayW = w / bays;
  const doorBay = 1 + Math.floor(rnd() * (bays - 2));
  const hearthX = (rnd() < 0.5 ? -1 : 1) * w * 0.22;

  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };
  const F = -d / 2;
  const foot =
    Math.min(
      0,
      ground(-w / 2 - 0.25, F - 1.2),
      ground(w / 2 + 0.25, F - 1.2),
      ground(-w / 2 - 0.25, d / 2 + 0.25),
      ground(w / 2 + 0.25, d / 2 + 0.25),
    ) - 0.08;

  const sb = new StoneBatch();
  const PL = 0.3;
  const DECK = 0.45;
  const KAMOI = 2.3;
  const KOSHI = 1.05;
  const NUKI = 2.0;
  const wallFace = (s: Side): number => (runsAlongX(s) ? d / 2 : w / 2);
  const faceLen = (s: Side): number => (runsAlongX(s) ? w : d);
  /** A member on side `s`'s face, `out` from the face to its own centre. */
  const on = (
    s: Side,
    u: number,
    y: number,
    along: number,
    tall: number,
    thick: number,
    out: number,
    color: string,
  ): void => sb.onFace(s, wallFace(s), u, y, along, tall, thick, out, color, 0, 0, hideBack(s));
  /** A glow on side `s`, `out` from the face to its centre. */
  const glowOn = (s: Side, u: number, y: number, along: number, tall: number, out: number): void => {
    const c = outward(s) * (wallFace(s) + out);
    if (runsAlongX(s)) b.glow(along, tall, 0.02, u, y, c, SHOJI_GLOW);
    else b.glow(0.02, tall, along, c, y, u, SHOJI_GLOW);
  };
  /** A square member from `a` to `c`. */
  const member = (a: Point3, c: Point3, size: number, color: string, hide = 0): void => {
    const o = orient(a, c);
    sb.box(size, size, o.len, o.mid[0], o.mid[1], o.mid[2], color, o.rot, hide);
  };

  // --- the roof's own geometry, which everything under the eave is cut to ------
  const y0 = h - 0.1;
  const rise = d * 0.62;
  const CURVE = 1.12;
  const TH = 0.7;
  const rx = Math.max(0.6, (w - d) / 2 + 0.8);
  const ry = y0 + rise;
  const T = (tt: number): number => y0 + rise * Math.pow(Math.min(1, Math.max(0, tt)), CURVE);
  /** How far up the slope (x, z) is: the ring it lies on. */
  const tAt = (x: number, z: number): number =>
    Math.min(1 - Math.abs(z) / ez, (ex - Math.abs(x)) / (ex - rx));
  /** The underside of the thatch over (x, z). */
  const under = (x: number, z: number): number => T(tAt(x, z)) - TH;
  // The smoke gable: its half base, where it stands, and how high its base is.
  const hz0 = ez * 0.3;
  const gx = rx + (hz0 * (ex - rx)) / ez;
  const H0 = T(1 - hz0 / ez);
  const k = (ry - H0) / hz0;

  // --- the plinth: dressed granite round a dark core, down to the ground ------
  const plinthH = PL - foot;
  for (const s of ["+z", "-x", "+x"] as const) {
    const run = runsAlongX(s) ? w / 2 + 0.23 : d / 2 + 0.15;
    let u = -run;
    while (run - u > 0.05) {
      let len = 0.9 + rnd() * 0.6;
      if (run - (u + len) < 0.5) len = run - u;
      sb.onFace(s, wallFace(s) + 0.15, u + len / 2, foot + plinthH / 2 + 0.005, len - 0.022, plinthH + 0.01, 0.16, 0.0, GRANITE, 0, 0, hideBack(s));
      u += len;
    }
  }

  // --- the frame on the back and the ends: sill, wainscot, posts, tie, plate ----
  const endN = 2 * Math.round((d / 2.4 - 1) / 2) + 1;
  const backDoorU = -w / 2 + (doorBay + 0.5) * bayW;
  const backWins: number[] = [];
  for (let i = 0; i < bays; i++) {
    const gap = i - doorBay;
    if (Math.abs(gap) >= 2 && gap % 3 === 0) backWins.push(-w / 2 + (i + 0.5) * bayW);
  }
  if (!backWins.length) backWins.push(-w / 2 + ((doorBay + Math.floor(bays / 2)) % bays + 0.5) * bayW);
  const doorCut: [number, number][] = [[backDoorU - 0.55, backDoorU + 0.55]];
  for (const s of ["+z", "-x", "+x"] as const) {
    const L = faceLen(s);
    const cuts = s === "+z" ? doorCut : [];
    on(s, 0, PL + 0.07, L + 0.02, 0.14, 0.1, 0.05, SUMI);
    // The wainscot: boards under battens, capped.
    for (const [a, c] of carve(-L / 2, L / 2, cuts)) {
      on(s, (a + c) / 2, (PL + 0.14 + KOSHI) / 2, c - a, KOSHI - PL - 0.14, 0.03, 0.015, HINOKI);
      on(s, (a + c) / 2, KOSHI + 0.03, c - a, 0.06, 0.07, 0.035, SUMI);
      const nb = Math.max(1, Math.round((c - a) / 0.45));
      for (let i = 1; i < nb; i++) {
        on(s, a + (i / nb) * (c - a), (PL + 0.14 + KOSHI) / 2, 0.05, KOSHI - PL - 0.14, 0.03, 0.045, SUMI);
      }
    }
    // Posts, the tie between them at door height, and the plate.
    const n = runsAlongX(s) ? bays : endN;
    for (let i = 0; i <= n; i++) {
      const u = -L / 2 + (i / n) * L;
      on(s, u, (PL + 0.14 + h - 0.26) / 2, 0.22, h - 0.26 - PL - 0.14, 0.12, 0.06, SUMI);
    }
    for (const [a, c] of carve(-L / 2, L / 2, cuts)) on(s, (a + c) / 2, NUKI, c - a, 0.1, 0.05, 0.025, SUMI);
  }
  for (const s of ["-z", "+z", "-x", "+x"] as const) on(s, 0, h - 0.13, faceLen(s) + 0.2, 0.26, 0.14, 0.07, SUMI);

  /** A bamboo-barred window (renji-mado) in a timber frame. */
  const barWindow = (s: Side, u: number, ww: number): void => {
    const wy = 1.55;
    const wh = 0.62;
    if (lit) glowOn(s, u, wy, ww, wh, 0.01);
    else on(s, u, wy, ww, wh, 0.02, 0.01, SUMI);
    const n = Math.round(ww / 0.1);
    for (let i = 1; i < n; i++) on(s, u - ww / 2 + (i / n) * ww, wy, 0.035, wh, 0.035, 0.05, HINOKI);
    for (const e of [-1, 1]) on(s, u + e * (ww / 2 + 0.04), wy, 0.08, wh + 0.16, 0.08, 0.04, HINOKI);
    on(s, u, wy + wh / 2 + 0.05, ww + 0.2, 0.1, 0.08, 0.04, HINOKI);
    on(s, u, wy - wh / 2 - 0.05, ww + 0.3, 0.1, 0.14, 0.07, HINOKI);
  };
  for (const u of backWins) barWindow("+z", u, Math.min(1.2, bayW - 0.6));
  barWindow(winEnd, 0, Math.min(1.3, d / endN - 0.7));

  // The kitchen door: a boarded leaf on ledges in a frame, under a board hood,
  // a stone before it.
  {
    const u = backDoorU;
    const top = PL + 1.85;
    on("+z", u, (PL + top) / 2, 0.9, top - PL, 0.03, 0.015, HINOKI);
    const nb = 5;
    for (let i = 1; i < nb; i++) on("+z", u - 0.45 + (i / nb) * 0.9, (PL + top) / 2, 0.012, top - PL, 0.012, 0.034, SUMI);
    for (const yl of [PL + 0.3, PL + 0.95, top - 0.3]) on("+z", u, yl, 0.84, 0.1, 0.03, 0.045, SUMI);
    for (const e of [-1, 1]) on("+z", u + e * 0.5, (PL + top + 0.1) / 2, 0.1, top + 0.1 - PL, 0.08, 0.04, SUMI);
    on("+z", u, top + 0.05, 1.1, 0.1, 0.08, 0.04, SUMI);
    sb.box(1.5, 0.06, 0.7, u, top + 0.45, d / 2 + 0.34, HINOKI, { x: 0.32 });
    for (let i = 0; i < 6; i++) sb.box(0.02, 0.02, 0.66, u - 0.625 + i * 0.25, top + 0.49, d / 2 + 0.33, SUMI, { x: 0.32 }, HIDE_UNDER);
    for (const e of [-1, 1]) {
      member([u + e * 0.62, top + 0.1, d / 2 + 0.02], [u + e * 0.62, top + 0.36, d / 2 + 0.6], 0.07, SUMI);
    }
    const sg = ground(u, d / 2 + 0.4);
    const sTop = Math.min(PL - 0.04, sg + 0.18);
    const sBot = Math.min(sg, foot) - 0.05;
    sb.box(1.0, sTop - sBot, 0.42, u, (sTop + sBot) / 2, d / 2 + 0.4, GRANITE, { y: (rnd() - 0.5) * 0.1 });
  }

  // --- the front: posts, the engawa's shoji, the shutter boxes, the door ----
  const JAMB = 1.3;
  const runA = JAMB + 0.1;
  const runB = w / 2 - 0.24 - 0.62;
  const postF = (u: number, wide: number): void =>
    on("-z", u, (DECK + h - 0.26) / 2, wide, h - 0.26 - DECK, 0.14, 0.07, SUMI);
  for (const sx of [-1, 1]) {
    postF(sx * (w / 2 - 0.12), 0.24);
    postF(sx * JAMB, 0.2);
    // The shoji, lapped in two tracks, over board kick panels.
    const L = runB - runA;
    const nP = Math.max(2, Math.round(L / 0.9));
    const pw = L / nP;
    const y0p = DECK + 0.36;
    const y1p = KAMOI - 0.04;
    for (let i = 0; i < nP; i++) {
      const u = sx * (runA + (i + 0.5) * pw);
      const lap = (i % 2) * 0.035;
      if (lit) glowOn("-z", u, (y0p + y1p) / 2, pw - 0.06, y1p - y0p, 0.02);
      else on("-z", u, (y0p + y1p) / 2, pw - 0.06, y1p - y0p, 0.03, 0.015, PAPER);
      on("-z", u, (DECK + 0.06 + y0p) / 2, pw - 0.06, y0p - DECK - 0.06, 0.03, 0.03 + lap, HINOKI);
      for (const e of [-1, 1]) on("-z", u + e * (pw / 2 - 0.03), (DECK + 0.05 + y1p) / 2, 0.06, y1p - DECK - 0.05, 0.05, 0.055 + lap, SUMI);
      for (const yr of [DECK + 0.08, y0p, y1p]) on("-z", u, yr, pw - 0.06, 0.05, 0.05, 0.055 + lap, SUMI);
      for (let c = 1; c < 3; c++) on("-z", u - pw / 2 + (c / 3) * pw, (y0p + y1p) / 2, 0.022, y1p - y0p, 0.03, 0.05 + lap, SUMI);
      for (let r = 1; r < 6; r++) on("-z", u, y0p + (r / 6) * (y1p - y0p), pw - 0.1, 0.022, 0.03, 0.05 + lap, SUMI);
      if (i > 0 && i % 2 === 0) postF(sx * (runA + i * pw), 0.16);
    }
    // The storm shutters' box, at the outer end of the run.
    const tu = sx * (runB + 0.32);
    const tTop = KAMOI + 0.12;
    on("-z", tu, (DECK + tTop) / 2, 0.6, tTop - DECK, 0.2, 0.1, HINOKI);
    for (const e of [-1, 1]) on("-z", tu + e * 0.28, (DECK + tTop) / 2, 0.05, tTop - DECK, 0.04, 0.22, SUMI);
    for (const yr of [DECK + 0.6, DECK + 1.3]) on("-z", tu, yr, 0.52, 0.04, 0.03, 0.215, SUMI);
    on("-z", tu, tTop + 0.03, 0.66, 0.06, 0.26, 0.13, SUMI);
  }
  // The head track over everything, and the sill track on the deck.
  on("-z", 0, KAMOI + 0.05, w - 0.1, 0.1, 0.1, 0.05, SUMI);
  on("-z", 0, DECK + 0.025, w - 0.1, 0.05, 0.1, 0.05, SUMI);
  if (!p.enterable) {
    // The great door, shut: two leaves of boards over a dark back, battened,
    // one with a wicket in it.
    on("-z", 0, (DECK + KAMOI) / 2, 2.4, KAMOI - DECK, 0.01, 0.005, SUMI);
    for (const e of [-1, 1]) {
      const lc = e * 0.6;
      const lap = e > 0 ? 0.035 : 0;
      for (let i = 0; i < 6; i++) {
        on("-z", lc - 0.6 + 0.1 + i * 0.2, (DECK + KAMOI) / 2, 0.185, KAMOI - DECK - 0.02, 0.03, 0.025 + lap, HINOKI);
      }
      for (const yr of [DECK + 0.25, DECK + 1.1, KAMOI - 0.2]) on("-z", lc, yr, 1.16, 0.1, 0.03, 0.055 + lap, SUMI);
      for (const e2 of [-1, 1]) on("-z", lc + e2 * 0.57, (DECK + KAMOI) / 2, 0.06, KAMOI - DECK, 0.03, 0.055 + lap, SUMI);
      if (e === wicket) {
        const wy0 = DECK + 0.3;
        const wy1 = DECK + 1.35;
        for (const e2 of [-1, 1]) on("-z", lc + e2 * 0.3, (wy0 + wy1) / 2, 0.05, wy1 - wy0, 0.02, 0.08 + lap, SUMI);
        on("-z", lc, wy1, 0.65, 0.05, 0.02, 0.08 + lap, SUMI);
        on("-z", lc + 0.2, (wy0 + wy1) / 2, 0.08, 0.05, 0.03, 0.09 + lap, KAWARA_DARK);
      }
    }
  }

  // --- the engawa: boards laid lengthways on a front beam, on posts on stones --
  {
    const nb = 6;
    const bw = 1.2 / nb;
    for (let j = 0; j < nb; j++) {
      const z = F - (j + 0.5) * bw;
      let u = -w / 2;
      while (w / 2 - u > 0.05) {
        let len = 2.6 + rnd() * 1.6;
        if (w / 2 - (u + len) < 1.2) len = w / 2 - u;
        sb.box(len - 0.008, 0.05, bw - 0.012, u + len / 2, DECK - 0.025, z, CEDAR, undefined, HIDE_UNDER);
        u += len;
      }
    }
    sb.box(w, 0.16, 0.14, 0, DECK - 0.05 - 0.08, F - 1.2 + 0.07, SUMI);
    const nPost = Math.max(3, Math.round(w / 1.8));
    for (let i = 0; i <= nPost; i++) {
      const x = -w / 2 + 0.12 + (i / nPost) * (w - 0.24);
      const sg = ground(x, F - 1.13);
      const sTop = Math.min(DECK - 0.3, sg + 0.08);
      const sBot = Math.min(sg, foot) - 0.05;
      sb.box(0.28, sTop - sBot, 0.28, x, (sTop + sBot) / 2, F - 1.13, GRANITE);
      const pTop = DECK - 0.21;
      if (pTop - sTop > 0.03) sb.box(0.12, pTop - sTop, 0.12, x, (pTop + sTop) / 2, F - 1.13, SUMI);
    }
    // The stone to step up by, before the door.
    const sg = ground(0, F - 1.55);
    const sTop = sg + 0.2;
    const sBot = Math.min(sg, foot) - 0.05;
    sb.box(1.05, sTop - sBot, 0.55, 0, (sTop + sBot) / 2, F - 1.55, GRANITE, { y: (rnd() - 0.5) * 0.12 });
  }

  // --- the firewood, stacked against one end under a straw mat ------------------
  const WL = Math.min(d - 1.8, 3.2);
  {
    const sgn = outward(woodEnd);
    const xf = sgn * (w / 2 + 0.15);
    const gw = Math.min(ground(xf + sgn * 0.25, -WL / 2), ground(xf + sgn * 0.25, WL / 2), ground(xf + sgn * 0.25, 0));
    const base = gw + 0.1;
    for (const e of [-1, 1]) sb.box(0.1, 0.1 + (gw - foot), WL, xf + sgn * (0.2 + e * 0.12), (base + foot) / 2, 0, SUMI);
    const rows = 9;
    const cols = Math.round(WL / 0.15);
    const cw = WL / cols;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const z = -WL / 2 + (i + 0.5 + (j % 2) * 0.35) * cw;
        if (z > WL / 2 - cw * 0.4) continue;
        const bh = 0.115 + rnd() * 0.03;
        const bz = cw - 0.03 - rnd() * 0.02;
        sb.box(0.42, bh, bz, xf + sgn * (0.22 + (rnd() - 0.5) * 0.03), base + (j + 0.5) * 0.14, z, rnd() < 0.2 ? CEDAR : HINOKI, { x: rnd() * 1.5 }, sgn > 0 ? 1 << 1 : 1);
      }
    }
    const top = base + rows * 0.14;
    sb.box(0.55, 0.06, WL + 0.2, xf + sgn * 0.22, top + 0.02, 0, KAYA, { z: -sgn * 0.12 });
    sb.box(0.36, 0.05, WL + 0.16, xf + sgn * 0.44, top - 0.1, 0, KAYA, { z: -sgn * 0.9 });
    // Persimmons drying on strings from a pole tied under the eave.
    if (kaki) {
      const px = sgn * (w / 2 + 0.3);
      const py = h + 0.04;
      sb.box(0.05, 0.05, WL + 0.3, px, py, 0, HINOKI);
      const ns = Math.round(WL / 0.32);
      for (let i = 0; i < ns; i++) {
        const z = -WL / 2 + (i + 0.5) * (WL / ns);
        const nf = 4 + Math.floor(rnd() * 2);
        sb.box(0.012, nf * 0.11 + 0.06, 0.012, px, py - (nf * 0.11 + 0.06) / 2, z, KAYA);
        for (let f = 0; f < nf; f++) {
          sb.box(0.075, 0.085, 0.075, px, py - 0.1 - f * 0.11, z + (rnd() - 0.5) * 0.02, KAKI, { y: rnd() });
        }
      }
    }
  }

  // --- under the eave: rafters from the wall to the cut, a pole under their ends --
  for (const sz of [-1, 1]) {
    const n = Math.round(w / 0.55);
    for (let i = 0; i <= n; i++) {
      const x = -w / 2 + 0.1 + (i / n) * (w - 0.2);
      const za = sz * (d / 2 + 0.05);
      const zb = sz * (ez - 0.12);
      const zm = (za + zb) / 2;
      const m: Point3 = [x, under(x, zm) - 0.1, zm];
      member([x, under(x, za) - 0.1, za], m, 0.08, SUMI, 1 << 2);
      member(m, [x, under(x, zb) - 0.1, zb], 0.08, SUMI, 1 << 2);
    }
    const zp = sz * (ez - 0.45);
    const px = w / 2 + 0.3;
    sb.box(2 * px, 0.07, 0.07, 0, under(0, zp) - 0.175, zp, HINOKI);
  }
  for (const sx of [-1, 1]) {
    const n = Math.round(d / 0.55);
    for (let i = 0; i <= n; i++) {
      const z = -d / 2 + 0.1 + (i / n) * (d - 0.2);
      const xa = sx * (w / 2 + 0.05);
      const xb = sx * (ex - 0.12);
      const xm = (xa + xb) / 2;
      const m: Point3 = [xm, under(xm, z) - 0.1, z];
      member([xa, under(xa, z) - 0.1, z], m, 0.08, SUMI, 1 << 2);
      member(m, [xb, under(xb, z) - 0.1, z], 0.08, SUMI, 1 << 2);
    }
    const xp = sx * (ex - 0.45);
    sb.box(0.07, 0.07, d + 0.6, xp, under(xp, 0) - 0.175, 0, HINOKI);
    for (const sz of [-1, 1]) {
      const a: Point3 = [sx * w / 2, 0, sz * d / 2];
      const c: Point3 = [sx * (ex - 0.15), 0, sz * (ez - 0.15)];
      member([a[0], under(a[0], a[2]) - 0.08, a[2]], [c[0], under(c[0], c[2]) - 0.08, c[2]], 0.12, SUMI, 1 << 2);
    }
  }

  // --- the smoke gables' faces --------------------------------------------------
  for (const s of ["-x", "+x"] as const) {
    const R = ry - H0;
    /** A member on the gable's face; `u` is to the viewer's right. */
    const g = (u: number, y: number, along: number, tall: number, thick: number, out: number, color: string): void =>
      sb.onFace(s, gx, s === "+x" ? u : -u, y, along, tall, thick, out, color, 0, 0, hideBack(s));
    g(0, H0 + 0.03, 2 * hz0 + 0.1, 0.12, 0.1, 0.05, SUMI);
    if (charm) {
      // 水, the charm against fire, in the plaster: five strokes.
      const c = Math.min(0.95, R * 0.45);
      const cy = H0 + R * 0.4;
      const stroke = (u1: number, v1: number, u2: number, v2: number): void => {
        const len = Math.hypot(u2 - u1, v2 - v1) + 0.08;
        const a = Math.atan2(u2 - u1, v2 - v1) * (s === "+x" ? 1 : -1);
        const x = outward(s) * (gx + 0.012);
        const z = (s === "+x" ? 1 : -1) * ((u1 + u2) / 2) * c;
        sb.box(0.025, len * c, 0.085 * c * 1.4, x, cy + ((v1 + v2) / 2) * c, z, SUMI, { x: a }, hideBack(s));
      };
      stroke(0, 0.5, 0, -0.44);
      stroke(0, -0.44, -0.13, -0.34);
      stroke(-0.38, 0.14, -0.06, 0.14);
      stroke(-0.06, 0.14, -0.42, -0.36);
      stroke(0.36, 0.3, 0.06, 0.02);
      stroke(0.06, 0.02, 0.44, -0.42);
    } else {
      // The smoke vent: a lattice of slats over the dark of the roof space.
      const vy0 = H0 + 0.18;
      const vh = Math.min(0.75, R * 0.45);
      const vw = 0.8 * 2 * hz0 * ((ry - vy0 - vh) / R);
      g(0, vy0 + vh / 2, vw, vh, 0.02, 0.01, SUMI);
      const n = Math.max(4, Math.round(vw / 0.11));
      for (let i = 1; i < n; i++) g(-vw / 2 + (i / n) * vw, vy0 + vh / 2, 0.035, vh, 0.03, 0.035, HINOKI);
      for (const e of [-1, 1]) g(e * (vw / 2 + 0.04), vy0 + vh / 2, 0.08, vh + 0.12, 0.06, 0.03, HINOKI);
      for (const e of [-1, 1]) g(0, vy0 + vh / 2 + e * (vh / 2 + 0.03), vw + 0.16, 0.06, 0.06, 0.03, HINOKI);
    }
  }

  // --- the ridge's binding and its crossed timbers -------------------------------
  const RL = gx + 0.45;
  const yt = ry + 0.42;
  const yShoulder = ry + 0.2;
  for (const e of [-1, 1]) {
    sb.box(2 * RL - 0.1, 0.06, 0.06, 0, yt + 0.03, e * 0.26, HINOKI);
    sb.box(2 * RL - 0.1, 0.06, 0.06, 0, yShoulder, e * 0.54, HINOKI);
  }
  for (let x = -RL + 0.25; x < RL - 0.2; x += 0.5) sb.box(0.05, 0.09, 0.6, x, yt + 0.025, 0, SUMI, undefined, HIDE_UNDER);
  const nU = Math.max(3, Math.round((2 * RL - 1) / 1.05));
  for (let i = 0; i <= nU; i++) {
    const x = -RL + 0.5 + (i / nU) * (2 * RL - 1);
    for (const e of [-1, 1]) sb.box(0.09, 1.15, 0.09, x, yt + 0.12, 0, SUMI, { x: e * 0.62 });
  }
  sb.box(2 * RL - 0.8, 0.08, 0.08, 0, yt + 0.12 + 0.13, 0, HINOKI);

  // --- inside an enterable one: the loft floor on joists and beams, the hearth ----
  if (p.enterable) {
    const ix = w / 2 - t;
    const iz = d / 2 - t;
    const CEIL = h - 0.15;
    sb.box(2 * ix, 0.04, 2 * iz, 0, CEIL + 0.02, 0, HINOKI, undefined, 1 << 2);
    const nj = Math.round((2 * iz) / 0.5);
    for (let j = 0; j <= nj; j++) sb.box(2 * ix, 0.08, 0.07, 0, CEIL - 0.04, -iz + 0.05 + (j / nj) * (2 * iz - 0.1), SUMI, undefined, 1 << 2);
    const nBeam = Math.max(2, Math.round((2 * ix) / 2.6));
    for (let i = 1; i < nBeam; i++) sb.box(0.24, 0.3, 2 * iz, -ix + (i / nBeam) * 2 * ix, CEIL - 0.08 - 0.15, 0, SUMI, undefined, 1 << 2);
    // Posts on the inner faces.
    for (let i = 0; i <= bays; i++) {
      const x = -ix + 0.1 + (i / bays) * (2 * ix - 0.2);
      if (Math.abs(x) > 1.1) sb.box(0.2, CEIL - 0.08 - 0.4, 0.08, x, (0.4 + CEIL - 0.08) / 2, -iz + 0.04, SUMI);
      sb.box(0.2, CEIL - 0.08 - 0.4, 0.08, x, (0.4 + CEIL - 0.08) / 2, iz - 0.04, SUMI);
    }
    for (const sx of [-1, 1]) {
      for (let i = 0; i <= endN; i++) {
        sb.box(0.08, CEIL - 0.08 - 0.4, 0.2, sx * (ix - 0.04), (0.4 + CEIL - 0.08) / 2, -iz + 0.1 + (i / endN) * (2 * iz - 0.2), SUMI);
      }
    }
    // The hearth let into the floor: a frame round a bed of ash, the ends of a fire.
    const hz = 0.4;
    sb.box(1.3, 0.02, 1.3, hearthX, 0.41, hz, GRANITE_DARK, undefined, HIDE_UNDER);
    for (const e of [-1, 1]) {
      sb.box(1.6, 0.05, 0.15, hearthX, 0.425, hz + e * 0.725, SUMI, undefined, HIDE_UNDER);
      sb.box(0.15, 0.05, 1.3, hearthX + e * 0.725, 0.425, hz, SUMI, undefined, HIDE_UNDER);
    }
    for (let i = 0; i < 3; i++) {
      const a = 0.4 + (i * 2 * Math.PI) / 3;
      sb.box(0.07, 0.06, 0.45, hearthX + Math.sin(a) * 0.26, 0.44, hz + Math.cos(a) * 0.26, SUMI, { y: a });
    }
  }

  sb.flush(b);

  // --- the cores, emitted after what hides them -----------------------------------
  b.box(w + 0.3, plinthH - 0.01, d + 0.3, 0, foot + (plinthH - 0.01) / 2, 0, GRANITE_DARK);
  b.box(w - 0.02, 0.1, 1.16, 0, DECK - 0.05 - 0.05, F - 0.6, SUMI);
  b.box(w - 0.3, DECK - 0.21 - foot, 1.06, 0, (DECK - 0.21 + foot) / 2, F - 0.53, SUMI);
  // The dark between the plate and the thatch, closed along every wall line.
  for (const sz of [-1, 1]) {
    const top = Math.max(under(0, d / 2), under(w / 2, d / 2)) + 0.06;
    b.box(w, top - h + 0.05, t, 0, (top + h - 0.05) / 2, sz * (d / 2 - t / 2), SUMI);
  }
  for (const sx of [-1, 1]) {
    const top = Math.max(under(w / 2, 0), under(w / 2, d / 2)) + 0.06;
    b.box(t, top - h + 0.05, d, sx * (w / 2 - t / 2), (top + h - 0.05) / 2, 0, SUMI);
  }
  if (p.enterable) {
    const side = (w - 2.4) / 2;
    const off = 2.4 / 2 + side / 2;
    const lintel = h - 2.3;
    b.box(w - 0.2, 0.2, d - 0.2, 0, 0.3, 0, CEDAR);
    b.box(side, h, t, -off, h / 2, F + t / 2, TSUCHI);
    b.box(side, h, t, off, h / 2, F + t / 2, TSUCHI);
    b.box(2.4, lintel, t, 0, h - lintel / 2, F + t / 2, TSUCHI);
    b.box(w, h, t, 0, h / 2, d / 2 - t / 2, TSUCHI);
    b.box(t, h, d, -w / 2 + t / 2, h / 2, 0, TSUCHI);
    b.box(t, h, d, w / 2 - t / 2, h / 2, 0, TSUCHI);
  } else {
    b.box(w, h, d, 0, h / 2, 0, TSUCHI);
  }

  // --- the roof: the hip, its courses and tiers, the smoke gables, the ridge ------
  const roof: RoofSpec = { y: y0, ex, ez, tx: rx, tz: 0, rise, curve: CURVE, upturn: 0.05, seg: 4 };
  curvedRoof(b, KAYA, { ...roof, thick: TH });
  curvedRoof(b, KAYA, { ...roof, to: 0.32, raise: 0.07, thick: 0.3, rings: 3, closeTop: true });
  curvedRoof(b, KAYA, { ...roof, to: 0.07, raise: -0.2, grow: 0.05, thick: 0.26, rings: 1 });
  curvedRoof(b, KAYA_DARK, { ...roof, to: 0.1, raise: -0.44, grow: 0.1, thick: 0.32, rings: 2, closeTop: true });
  for (const sx of [-1, 1]) {
    const tri = (x: number): Point3[] => [
      [x, H0 - 0.06, -hz0],
      [x, H0 - 0.06, hz0],
      [x, ry + 0.05, 0],
    ];
    convexSolid(b, tri(sx * (gx - 0.3)), tri(sx * gx), charm ? SHIKKUI : TSUCHI);
  }
  const X1 = gx + 0.35;
  const zE = hz0 + 0.35;
  for (const sz of [-1, 1]) {
    const prof = (x: number): Point3[] => [
      [x, ry + 0.1, 0],
      [x, H0 - 0.35 * k + 0.1, sz * zE],
      [x, H0 - 0.35 * k - 0.25, sz * zE],
      [x, ry - 0.25, 0],
    ];
    convexSolid(b, prof(-X1), prof(X1), KAYA);
  }
  const yb = ry + 0.05 - 0.55 * k;
  const rprof = (x: number): Point3[] => [
    [x, yb, -0.55],
    [x, yb, 0.55],
    [x, yShoulder, 0.52],
    [x, yt, 0.3],
    [x, yt, -0.3],
    [x, yShoulder, -0.52],
  ];
  convexSolid(b, rprof(-RL), rprof(RL), KAYA_DARK);
  return b;
}
