/**
 * kit/japan/templeGate.ts — buildTempleGate: the four-legged gate in the
 * precinct wall, and `TERA`, the character its plaque ends in.
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
  type Side,
  type Structure,
  HIDE_UNDER,
  carve,
  hideBack,
  runsAlongX,
  streetSeed,
} from "../core";
import { J_CORNERS, J_END, J_START, Joinery } from "./joinery";
import { BRONZE, CEDAR, GRANITE, GRANITE_DARK, HINOKI, PAPER, SHIKKUI, SUMI } from "./palette";
import type { RoofSpec } from "./roof";

/**
 * 寺, "temple" — the last character of every temple's name — as strokes in
 * glyph units, x to the right and y up in the square ±0.5: a gate's plaque
 * ends in it and its lantern carries it.
 */
const TERA: readonly (readonly [number, number, number, number])[] = [
  [-0.26, 0.36, 0.26, 0.36],
  [0, 0.5, 0, 0.16],
  [-0.42, 0.16, 0.42, 0.16],
  [-0.48, -0.04, 0.48, -0.04],
  [0.18, 0.1, 0.18, -0.46],
  [0.18, -0.46, 0.04, -0.37],
  [-0.24, -0.17, -0.12, -0.29],
];

/**
 * The TEMPLE GATE — the SHIKYAKUMON, the "four-legged gate" an Edo temple
 * sets in its precinct wall: two great pillars in the wall's line carrying
 * the ridge, four lesser posts before and behind them carrying the eaves, and
 * a plastered side bay either way for the precinct wall to run into. It is
 * the one door into Koyo-ji, and everybody who takes the flag in there comes
 * through it or over the wall beside it.
 *
 * **It was a plaster box with a doorway cut through it under one smooth grey
 * hip**: a plank slab where the brackets should be and a slotted block for a
 * ridge. What makes a gate one is that it is ALL frame and nothing hides it —
 * there is no ceiling, so everything overhead is looked up at by everyone who
 * walks through — and that is where this spends its vertices:
 *
 * - **The base** is a granite platform: a kerb of dressed stones round it,
 *   carried down to the ground, flags laid in running bond inside it, and a
 *   granite step before and behind the passage.
 * - **The posts**: the two main pillars are round, on granite bases, in
 *   bronze root sleeves; the four lesser posts are chamfered square on bases
 *   of their own. Paper pilgrim slips (senja-fuda) are pasted up them.
 * - **The frame**: a tie through the posts along each row and through each
 *   post line, its ends run on past the posts and cut on a slant; the main
 *   row's head beam runs on over the side bays. On each lesser post a
 *   bracket set — a bearing block, an arm, three small blocks, a second arm
 *   — carries the eave purlin, and a frog-leg strut stands in the middle of
 *   the front and back bays. On each main pillar a cambered beam runs out to
 *   both purlins, and a king strut braced on it carries the ridge beam. Each
 *   side bay's end post carries an outrigger that the purlins' ends and an
 *   end purlin rest on, and a hip beam runs into each corner with a wind bell
 *   hung at its end.
 * - **The eave** is two layers of rafters, base and flying, their ends
 *   painted white, under a board lining — seen whole from underneath.
 * - **The roof** is the hip it always was, tiled in rows of round tiles on an
 *   eave lip, under a ridge banded in white with a demon tile at each end and
 *   a hip ridge down each corner ending on its own.
 * - **The side bays** are plaster in a frame of sill, waist rail and head
 *   rails over a skirt of boards, with a barred window (renji) in the front;
 *   on the back, the gate's two plank leaves stand folded back flat against
 *   them.
 * - **The front** hangs the temple's name on a framed plaque before the
 *   frog-leg strut, and the passage hangs a great paper lantern (chōchin)
 *   under the main row's head beam, its foot 2.4 m over the platform.
 *
 * `tint` recolours the timber (vermilion for a shrine, cypress for a temple —
 * the default); the plaster, the stone and the tile stay what they are. It is
 * in `CONFORMS_TO_TERRAIN`: the stones' and flags' lengths, the plaque's
 * first two characters (the third is always 寺, as the lantern's is) and
 * the pilgrim slips are seeded off where it stands, and the platform and
 * both steps are carried down to the ground.
 *
 * **The colliders are the ones it always had, in the same order**: the six
 * posts and each side bay (its retired `wall` spelled out as a block), then
 * the roof slab at the eave. Everything drawn obeys the kit's three rules:
 * the skirt, the rails, the window and the folded leaves are on a side bay's
 * face (none more than 0.13 m proud); the platform and the steps are under
 * 0.3 m; the bases hug their posts; and everything from the ties up is
 * overhead — the lowest, the ties through the post lines, clear the platform
 * by 3.4 m, and the lantern by 2.4.
 */
export function buildTempleGate(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "sanmon");
  const opening = 4.6;
  const wing = 2.4;
  const w = opening + wing * 2;
  const d = 4.2;
  const h = 4.6;
  const color = p.tint ?? HINOKI;

  // --- colliders, exactly as they were: the posts and each wing (the old
  // `wall` call), then the roof slab at the eave.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 0, 1]) {
      const x = (sx * opening) / 2;
      const z = (sz * (d - 0.8)) / 2;
      const dia = sz === 0 ? 0.62 : 0.44;
      b.block({ w: dia * 0.85, h, d: dia * 0.85, x, y: h / 2, z });
    }
    const wx = sx * (opening / 2 + wing / 2);
    b.block({ w: wing, h: h - 0.4, d: 0.5, x: wx, y: (h - 0.4) / 2, z: 0 });
  }
  const eave = h + 0.45;
  const ex = w / 2 + 1.3;
  const ez = d / 2 + 1.5;
  b.block({ w: ex * 2, h: 0.3, d: ez * 2, x: 0, y: eave, z: 0 });

  // --- everything below is drawing -------------------------------------------
  const rnd = mulberry32(streetSeed(w, d, h, ctx));
  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };
  /** The post lines, the front and back rows, and each side bay's end post. */
  const XP = opening / 2;
  const ZP = (d - 0.8) / 2;
  const XE = w / 2 - 0.15;
  /** The platform: its half extents and its top. */
  const PX = w / 2 + 0.15;
  const PZ = d / 2;
  const PT = 0.3;
  let foot = 0;
  for (const gx of [-1, -0.5, 0, 0.5, 1]) {
    for (const gz of [-1, 0, 1]) foot = Math.min(foot, ground(gx * PX, gz * PZ));
  }
  foot -= 0.08;

  // --- the roof's own geometry, which everything under and on it is cut to ------
  const RISE = 2.9;
  const TH = 0.32;
  const rx = w / 2 - 1.0;
  const roof: RoofSpec = { y: eave, ex, ez, tx: rx, tz: 0, rise: RISE, curve: 1.6, upturn: 0.55, thick: TH, rings: 6, seg: 8 };
  const j = new Joinery(b, color, roof);
  const { sb, at, on, member, nose, arm, block, underAt, KD } = j;
  // A member laid from `a` to `c` along its own Z hides these faces.
  const TOP = 1 << 2;
  // --- the heights of the frame --------------------------------------------------
  /** The ties along each post line, and along the front and back rows. */
  const ZT0 = h - 0.88;
  const ZT1 = h - 0.6;
  const NK0 = h - 0.58;
  const NK1 = h - 0.28;
  /** The main row's head beam, over the side bays too. */
  const MB0 = h - 0.38;
  const MB1 = h - 0.02;
  /** A bracket set, from the post's head up: block, arm, small blocks; the second arm is cut to its purlin. */
  const DAI = h + 0.22;
  const ARM1 = DAI + 0.18;
  const MAK = ARM1 + 0.13;
  /** The eave purlins' underside along the front and back rows. */
  const ketaBot = (s: Side, u: number): number => underAt(s, u, ZP) - KD;
  /** The end purlins, carried on each side bay's outrigger. */
  const XEP = XE + 0.15;
  const endBot = (s: Side, u: number): number => underAt(s, u, XEP) - KD;

  // --- the platform: a kerb of dressed stones, flags inside it, the two steps ----
  {
    const KW = 0.24;
    const kerb = (s: Side, run: number): void => {
      const plane = runsAlongX(s) ? PZ : PX;
      let u = -run;
      while (run - u > 0.05) {
        let len = 0.8 + rnd() * 0.6;
        if (run - (u + len) < 0.45) len = run - u;
        const c = u + len / 2;
        const [gx, gz] = at(s, c, plane);
        const yb = Math.min(foot, ground(gx, gz) - 0.1);
        on(s, plane, c, (yb + PT) / 2, len - 0.02, PT - yb, KW, -KW / 2 + 0.02, GRANITE, 0, hideBack(s));
        u += len;
      }
    };
    kerb("-z", PX + 0.02);
    kerb("+z", PX + 0.02);
    kerb("-x", PZ - KW + 0.02);
    kerb("+x", PZ - KW + 0.02);
    // The flags, in running bond across the passage, not laid under the side bays.
    const rows = Math.round((2 * (PZ - KW)) / 0.55);
    const rw = (2 * (PZ - KW)) / rows;
    for (let r = 0; r < rows; r++) {
      const z = -(PZ - KW) + (r + 0.5) * rw;
      const cuts: [number, number][] = Math.abs(z) < 0.25 + rw / 2 ? [[-PX, -XP], [XP, PX]] : [];
      for (const [a, c] of carve(-(PX - KW + 0.02), PX - KW + 0.02, cuts)) {
        let x = a + (r % 2 ? 0.35 : 0);
        if (r % 2) sb.box(0.33, 0.06, rw - 0.02, a + 0.165, PT - 0.03, z, GRANITE, undefined, HIDE_UNDER);
        while (c - x > 0.05) {
          let len = 0.7 + rnd() * 0.5;
          if (c - (x + len) < 0.35) len = c - x;
          sb.box(len - 0.02, 0.06, rw - 0.02, x + len / 2, PT - 0.03, z, GRANITE, undefined, HIDE_UNDER);
          x += len;
        }
      }
    }
    // A step before and behind the passage, its stones carried to the ground.
    for (const sz of [-1, 1]) {
      const z = sz * (PZ + 0.27);
      const sTop = PT / 2;
      const sBot = Math.min(foot, ground(0, z) - 0.05);
      let u = -1.9;
      while (1.9 - u > 0.05) {
        let len = 1.1 + rnd() * 0.7;
        if (1.9 - (u + len) < 0.6) len = 1.9 - u;
        sb.box(len - 0.02, 0.1, 0.5, u + len / 2, sTop - 0.05, z, GRANITE, undefined, HIDE_UNDER);
        u += len;
      }
      b.box(3.76, sTop - 0.1 - sBot, 0.46, 0, (sTop - 0.1 + sBot) / 2, z, GRANITE_DARK);
    }
  }

  // --- the posts: bases, root sleeves, the pilgrims' slips -------------------------
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 0, 1]) {
      const x = sx * XP;
      const z = sz * ZP;
      const main = sz === 0;
      const r = main ? 0.31 : 0.22 * Math.cos(Math.PI / 8);
      if (main) {
        b.cyl(0.12, 0.9, 0.96, 12, x, PT + 0.06, z, GRANITE);
        b.cyl(0.3, 0.68, 0.7, 12, x, PT + 0.27, z, BRONZE);
        b.cyl(0.04, 0.72, 0.72, 12, x, PT + 0.4, z, BRONZE);
      } else {
        b.cyl(0.1, 0.66, 0.72, 8, x, PT + 0.05, z, GRANITE, { y: Math.PI / 8 });
        b.cyl(0.2, 0.5, 0.5, 8, x, PT + 0.2, z, BRONZE, { y: Math.PI / 8 });
      }
      const n = Math.floor(rnd() * 4.2);
      for (let k = 0; k < n; k++) {
        let ang = rnd() * Math.PI * 2;
        if (!main) ang = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
        const y = 1.3 + rnd() * 1.4;
        sb.box(0.075, 0.21, 0.006, x + Math.sin(ang) * (r + 0.004), y, z + Math.cos(ang) * (r + 0.004), PAPER, { y: ang, z: (rnd() - 0.5) * 0.14 });
      }
    }
    // The side bay's end post, capping the plaster.
    sb.box(0.3, h - PT, 0.6, sx * XE, (PT + h) / 2, 0, color, undefined, HIDE_UNDER);
  }

  // --- the ties and the head beam ------------------------------------------------
  for (const sz of [-1, 1]) {
    // Along each row, through the lesser posts, run on past them.
    const z = sz * ZP;
    sb.box(2 * XP, NK1 - NK0, 0.2, 0, (NK0 + NK1) / 2, z, color);
    for (const sx of [-1, 1]) nose(true, z, sx * XP, sx, 0.5, NK0, NK1, 0.2);
  }
  for (const sx of [-1, 1]) {
    // Along each post line, through all three, run on past the front and back.
    const x = sx * XP;
    sb.box(0.2, ZT1 - ZT0, 2 * ZP, x, (ZT0 + ZT1) / 2, 0, color);
    for (const sz of [-1, 1]) nose(false, x, sz * ZP, sz, 0.5, ZT0, ZT1, 0.2);
  }
  sb.box(w, MB1 - MB0, 0.3, 0, (MB0 + MB1) / 2, 0, color);

  // --- the bracket sets and the purlins -------------------------------------------
  // On each lesser post: a block, an arm along the row, small blocks, a second arm under the purlin.
  for (const [sx, sz] of J_CORNERS) {
    const s: Side = sz < 0 ? "-z" : "+z";
    const x = sx * XP;
    const z = sz * ZP;
    block(x, z, 0.44, h, DAI);
    arm(true, x, z, 1.2, DAI, ARM1, 0.2);
    j.makito(true, x, z, 0.42, ARM1, MAK);
    arm(true, x, z, 1.8, MAK, ketaBot(s, x), 0.2);
  }
  // On each side bay's end post: a block, the outrigger along Z, and over its
  // ends and middle the second arms under the purlins.
  for (const sx of [-1, 1]) {
    const x = sx * XE;
    const se: Side = sx < 0 ? "-x" : "+x";
    block(x, 0, 0.36, h, DAI);
    sb.box(0.24, MAK - DAI, 2 * ZP, x, (DAI + MAK) / 2, 0, color, undefined, TOP);
    for (const sz of [-1, 1]) {
      nose(false, x, sz * ZP, sz, 0.42, DAI, MAK, 0.24);
      arm(true, x - sx * 0.2, sz * ZP, 1.0, MAK, ketaBot(sz < 0 ? "-z" : "+z", x), 0.2);
    }
    arm(false, 0, x + sx * 0.08, 1.4, MAK, endBot(se, 0), 0.2);
  }
  // The eave purlins along the front and back, and the end purlins along the
  // ends.
  for (const s of ["-z", "+z"] as const) j.purlin(s, ZP, XEP + 0.28, (u) => underAt(s, u, ZP));
  for (const s of ["-x", "+x"] as const) j.purlin(s, XEP, ZP + 0.24, (u) => underAt(s, u, XEP));

  // --- the frog-leg struts over the front and back bays ------------------------------
  for (const s of ["-z", "+z"] as const) j.frogLeg(s, ZP, NK1, ketaBot(s, 0));

  // --- the main pillars: the cambered beams, the king struts, the ridge beam -------
  const ridgeBot = underAt("-z", 0, 0) - 0.3;
  for (const sx of [-1, 1]) {
    const x = sx * XP;
    block(x, 0, 0.56, h, h + 0.26);
    const y0 = h + 0.26;
    const y1 = y0 + 0.4;
    const zE = ZP + 0.12;
    member([x, (y0 + y1) / 2, -zE], [x, (y0 + y1) / 2 + 0.07, 0], 0.24, y1 - y0, color, J_END);
    member([x, (y0 + y1) / 2 + 0.07, 0], [x, (y0 + y1) / 2, zE], 0.24, y1 - y0, color, J_START);
    for (const sz of [-1, 1]) nose(false, x, sz * zE, sz, 0.3, y0, y1, 0.24);
    // The king strut, braced from the beam, a block and an arm under the ridge beam.
    const sTop = ridgeBot - 0.34;
    const sBot = y1 + 0.07;
    sb.box(0.22, sTop - sBot, 0.22, x, (sTop + sBot) / 2, 0, color);
    for (const sz of [-1, 1]) member([x, sBot, sz * 0.62], [x, sBot + 0.62, sz * 0.1], 0.14, 0.14, color);
    block(x, 0, 0.34, sTop, sTop + 0.18);
    arm(false, 0, x, 1.2, sTop + 0.18, ridgeBot, 0.2);
  }
  sb.box(2 * rx + 0.1, 0.3, 0.26, 0, ridgeBot + 0.15, 0, color, undefined, TOP);

  // --- the eave: rafters in two layers, the hip beams, the wind bells ---------------
  j.rafters((s) => (runsAlongX(s) ? ZP : XEP));
  j.hipBeams();

  // --- the side bays: sill, rails, skirt, the window; the leaves folded back -------
  {
    const WF = 0.25;
    for (const sx of [-1, 1]) {
      const mid = sx * (XP + wing / 2);
      const a = XP + 0.32;
      const c = XE - 0.15;
      const uc = (sx * (a + c)) / 2;
      const uw = c - a;
      for (const s of ["-z", "+z"] as const) {
        const f = (u: number, y: number, along: number, tall: number, thick: number, out: number, col: string, tilt = 0): void =>
          on(s, WF, u, y, along, tall, thick, out, col, tilt, hideBack(s));
        f(mid, PT + 0.08, wing, 0.16, 0.1, 0.05, color);
        f(mid, 3.71, wing, 0.18, 0.1, 0.05, color);
        f(mid, MB0 - 0.08, wing, 0.14, 0.08, 0.04, color);
        if (s === "-z") {
          // A skirt of lapped boards under the waist rail.
          const nb = Math.max(3, Math.round(uw / 0.26));
          for (let k = 0; k < nb; k++) {
            f(uc - uw / 2 + ((k + 0.5) * uw) / nb, (PT + 0.16 + 1.35) / 2, uw / nb - 0.01, 1.35 - PT - 0.16, 0.03, 0.02 + (k % 2) * 0.014, color);
          }
          f(mid, 1.42, wing, 0.14, 0.1, 0.05, color);
          // The barred window: a dark ground, bars turned on the diagonal, a frame.
          const WW = 1.1;
          const WH = 1.25;
          const wy = 2.62;
          f(uc, wy, WW, WH, 0.02, 0.01, SUMI);
          const nBar = Math.round(WW / 0.12);
          for (let k = 1; k < nBar; k++) {
            sb.onFace(s, WF, uc - WW / 2 + (WW * k) / nBar, wy, 0.05, WH, 0.05, 0.04, color, 0, Math.PI / 4, TOP | HIDE_UNDER);
          }
          for (const e of [-1, 1]) f(uc + e * (WW / 2 + 0.05), wy, 0.1, WH + 0.2, 0.1, 0.05, color);
          f(uc, wy + WH / 2 + 0.05, WW, 0.1, 0.1, 0.05, color);
          f(uc, wy - WH / 2 - 0.06, WW + 0.24, 0.12, 0.13, 0.065, color);
        } else {
          // The leaf, folded back flat against the bay: boards on a dark
          // ground, battens across them studded in bronze, a stile each edge,
          // straps at the hinge and a ring pull.
          const y0 = PT + 0.17;
          const y1 = 3.6;
          const ym = (y0 + y1) / 2;
          f(uc, ym, uw, y1 - y0, 0.02, 0.02, SUMI);
          const nb = 5;
          for (let k = 0; k < nb; k++) f(uc - uw / 2 + ((k + 0.5) * uw) / nb, ym, uw / nb - 0.012, y1 - y0, 0.03, 0.045 + (k % 2) * 0.008, color);
          for (const e of [-1, 1]) f(uc + e * (uw / 2 - 0.05), ym, 0.1, y1 - y0, 0.05, 0.075, color);
          for (const fy of [0.08, 0.37, 0.64, 0.92]) {
            const y = y0 + (y1 - y0) * fy;
            f(uc, y, uw - 0.2, 0.12, 0.05, 0.085, color);
            for (let k = 0; k < nb; k++) f(uc - uw / 2 + ((k + 0.5) * uw) / nb, y, 0.045, 0.045, 0.02, 0.12, BRONZE);
          }
          const hinge = sx * a;
          for (const fy of [0.08, 0.92]) f(hinge + sx * 0.22, y0 + (y1 - y0) * fy, 0.42, 0.08, 0.02, 0.12, BRONZE);
          const pull = sx * (c - 0.28);
          b.cyl(0.02, 0.16, 0.16, 10, pull, y0 + (y1 - y0) * 0.5, WF + 0.12, BRONZE, { x: Math.PI / 2 });
          f(pull, y0 + (y1 - y0) * 0.5 + 0.09, 0.05, 0.05, 0.03, 0.115, BRONZE);
        }
      }
    }
  }

  // --- the plaque on the front, the lantern in the passage -----------------------
  {
    const PW = 0.9;
    const PHt = 0.94;
    const pzP = -(ZP + 0.3);
    const pyC = NK1 + 0.02 + PHt / 2;
    const kb = ketaBot("-z", 0);
    for (const e of [-1, 1]) {
      sb.box(0.05, kb - (pyC + PHt / 2) + 0.02, 0.04, e * 0.26, (kb + pyC + PHt / 2) / 2, pzP + 0.02, BRONZE);
      sb.box(0.05, 0.05, 0.2, e * 0.26, kb - 0.04, pzP + 0.14, BRONZE);
    }
    sb.box(PW - 0.1, PHt - 0.1, 0.05, 0, pyC, pzP, SUMI);
    for (const e of [-1, 1]) {
      sb.box(PW + 0.1, 0.1, 0.09, 0, pyC + e * (PHt / 2 - 0.02), pzP - 0.02, color);
      sb.box(0.1, PHt, 0.09, e * (PW / 2 - 0.02), pyC, pzP - 0.02, color);
    }
    // Three characters stacked down it in bronze, the temple's name ending in 寺.
    for (const [x0, y0, x1, y1] of TERA) {
      const S = 0.24;
      const len = Math.hypot(x1 - x0, y1 - y0) * S;
      const y = pyC - 0.27 + ((y0 + y1) / 2) * S;
      sb.box(len + 0.04, 0.04, 0.02, ((x0 + x1) / 2) * S, y, pzP - 0.035, BRONZE, { z: Math.atan2(y1 - y0, x1 - x0) });
    }
    for (let g = 0; g < 2; g++) {
      const gy = pyC + (1 - g) * 0.27;
      for (let k = 0; k < 5; k++) {
        const horiz = rnd() < 0.5;
        const len = 0.1 + rnd() * 0.2;
        const x = (rnd() - 0.5) * (horiz ? 0.16 : 0.34);
        const y = gy + (rnd() - 0.5) * (horiz ? 0.18 : 0.08);
        sb.box(horiz ? len : 0.04, horiz ? 0.04 : Math.min(len, 0.22), 0.02, x, y, pzP - 0.035, BRONZE, { z: (rnd() - 0.5) * 0.5 });
      }
    }
  }
  {
    // The great paper lantern, hung from the head beam over the passage: a
    // lacquered cap and foot, and between them paper on bamboo ribs, swelling
    // to its waist, with the temple's character 寺 painted on each face.
    const top = MB0;
    sb.box(0.04, 0.12, 0.04, 0, top - 0.06, 0, BRONZE);
    const capT = top - 0.12;
    b.cyl(0.12, 0.56, 0.62, 16, 0, capT - 0.06, 0, SUMI);
    /** The paper's profile, top to bottom: heights under the cap and diameters. */
    const prof: [number, number][] = [
      [0, 0.64],
      [0.2, 0.84],
      [0.5, 0.92],
      [0.8, 0.84],
      [1.0, 0.64],
    ];
    const b0 = capT - 0.12;
    const Y = (f: number): number => b0 - f * 1.1;
    for (let i = 0; i + 1 < prof.length; i++) {
      const [fa, da] = prof[i];
      const [fc, dc] = prof[i + 1];
      b.cyl(Y(fa) - Y(fc), da, dc, 16, 0, (Y(fa) + Y(fc)) / 2, 0, PAPER);
    }
    b.cyl(0.12, 0.62, 0.56, 16, 0, Y(1) - 0.06, 0, SUMI);
    /** The paper's radius at height `y`. */
    const radius = (y: number): number => {
      const f = Math.min(1, Math.max(0, (b0 - y) / 1.1));
      for (let i = 0; i + 1 < prof.length; i++) {
        const [fa, da] = prof[i];
        const [fc, dc] = prof[i + 1];
        if (f <= fc) return (da + ((dc - da) * (f - fa)) / (fc - fa)) / 2;
      }
      return prof[prof.length - 1][1] / 2;
    };
    // The ribs, a line round the paper every few centimetres.
    for (let k = 1; k < 12; k++) {
      const y = Y(k / 12);
      const dia = 2 * radius(y) + 0.008;
      b.cyl(0.012, dia, dia, 16, 0, y, 0, CEDAR);
    }
    // 寺, a stroke at a time, each laid on the paper in short pieces turned to
    // face out where they lie, so a stroke across the swell stays on it.
    const S = 0.54;
    const ym = Y(0.5);
    for (const sz of [-1, 1]) {
      for (const [x0, y0, x1, y1] of TERA) {
        // Seen from the back the character is mirrored in world X.
        const ax = -sz * x0 * S;
        const cx = -sz * x1 * S;
        const ay = ym + y0 * S;
        const cy = ym + y1 * S;
        const len = Math.hypot(cx - ax, cy - ay);
        const n = Math.max(1, Math.ceil(len / 0.07));
        const phi = Math.atan2(cy - ay, cx - ax);
        for (let k = 0; k < n; k++) {
          const f = (k + 0.5) / n;
          const x = ax + (cx - ax) * f;
          const y = ay + (cy - ay) * f;
          const r = radius(y);
          const z = Math.sqrt(Math.max(0, r * r - x * x)) - 0.004;
          sb.box(len / n + 0.012, 0.05, 0.03, x, y, sz * z, SUMI, { y: sz * Math.asin(x / r), z: phi });
        }
      }
    }
  }

  // --- the tiles: round-tile rows, end tiles, the ridges and demon tiles ------------
  j.tiles();

  sb.flush(b);

  // --- the cores, emitted after what hides them ------------------------------------
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 0, 1]) {
      const x = sx * XP;
      const z = sz * ZP;
      if (sz === 0) b.cyl(h - PT - 0.42, 0.6, 0.64, 12, x, (PT + 0.42 + h) / 2, z, color);
      else b.cyl(h - PT - 0.3, 0.44, 0.44, 8, x, (PT + 0.3 + h) / 2, z, color, { y: Math.PI / 8 });
    }
    b.box(wing, MB0 + 0.02, 0.5, sx * (opening / 2 + wing / 2), (MB0 + 0.02) / 2, 0, SHIKKUI);
  }
  b.box(2 * PX - 0.1, PT - 0.06 - foot, 2 * PZ - 0.1, 0, (PT - 0.06 + foot) / 2, 0, GRANITE_DARK);

  // --- the roof: the lining under the rafters, then the sheet ---------------------------
  j.sheet();
  return b;
}
