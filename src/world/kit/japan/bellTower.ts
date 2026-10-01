/**
 * kit/japan/bellTower.ts — buildBellTower: the temple's bell tower (shōrō).
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
  convexSolid,
  hideBack,
  runsAlongX,
  streetSeed,
} from "../core";
import { J_CORNERS, J_SIDES, Joinery } from "./joinery";
import { Lapidary, TAU, type TubePoint } from "./lapidary";
import {
  BRONZE,
  CEDAR,
  GRANITE,
  GRANITE_DARK,
  HINOKI,
  KAWARA_DARK,
  KAYA,
  SHIKKUI,
  SUMI,
} from "./palette";
import type { RoofSpec, V3 } from "./roof";

/**
 * The BELL TOWER — a SHŌRŌ, the open bell house an Edo temple stands in its
 * precinct: four splayed posts on a stone platform under a tiled pyramid,
 * the great bronze bell hung in the middle and the striking log hung beside
 * it. After the hall and the pagoda it is the precinct's third silhouette,
 * and the one of the three a player walks under and looks up into.
 *
 * **It was four posts on a slab under a smooth grey hat**, with a bronze
 * tube for a bell and a slotted block for a ridge. It is drawn as one is
 * built:
 *
 * - **The platform (kidan)**: face stones in two courses carried down to the
 *   ground, a coping round the top, flags in running bond inside it, a step
 *   before the front and one on the side facing the hall, and maple leaves
 *   blown onto it.
 * - **The posts**: chamfered square cypress, splayed out toward the foot
 *   (uchikorobi) as a bell house's are, each on a round granite base in a
 *   bronze root sleeve.
 * - **The frame**: a flying tie through the posts each way — the two at
 *   different heights, so they pass — and a head tie over them, every end run
 *   on and cut on a slant; a bracket set both ways on every post head; a
 *   frog-leg strut in the middle of every side; and between the head tie and
 *   the purlins a band of white plaster (kokabe) the brackets are half buried
 *   in, as a temple's are.
 * - **Inside**: a coffered ceiling, black ribs over cedar boards inside a
 *   cornice, and under it the bell beam resting on the side head ties.
 * - **The eave and the roof**: two layers of rafters under a board lining,
 *   hip beams with wind bells, and a PYRAMID (hōgyō) of round-tile rows on an
 *   eave lip with a hip ridge and a demon tile down each corner, capped by a
 *   bronze dew basin, an inverted bowl and the jewel. **It is a pyramid and
 *   not a hip because the plan is square**: `curvedRoof` lerps its rings, so
 *   a ridge over a square plan pitches its ends steeper than its sides and no
 *   purlin under them can run level.
 * - **The bell (bonshō)**: cast with a rolled lip, its upper, middle and
 *   lower bands and the four vertical ones (kesa-dasuki); eighty nipples
 *   (chi) in four framed panels under the upper band; a lotus striking seat
 *   (tsukiza) either side where the middle band crosses a vertical one; and a
 *   crown (ryūzu) of two dragons back to back with the jewel between them,
 *   hung on an iron hook from the bell beam.
 * - **The striking log (shumoku)**: bound in iron at both ends, hung level in
 *   two rope slings from the bell beam, its end tethered to a post with the
 *   tail of the rope run down the post's face; and on the front post a board
 *   of the hours under a little roof.
 *
 * It is in `CONFORMS_TO_TERRAIN`: the lengths of the stones, the flags and
 * the steps, where the leaves lie and the characters on the board are seeded
 * off where it stands, and the platform's face and both steps are carried
 * down to the ground.
 *
 * **The colliders are the ones it always had, in the same order**: the
 * platform, the four posts, the bell and the roof slab at the eave.
 * Everything drawn obeys the kit's three rules. The steps are under 0.3 m;
 * the bases, the sleeves and the board hug their posts; the rope's tail is
 * on a post's face. Everything between the posts is overhead: the lowest tie
 * clears the floor by 2.7 m and the log and its tether by 2.4, and the old
 * waist tie — a beam a metre over the floor between two posts, where nothing
 * stopped a body walking through it — is gone. The bell fills its box, and
 * the ceiling is drawn at the roof slab's underside, so a round fired
 * straight up inside stops on the ceiling it strikes.
 */
export function buildBellTower(scene: Scene, mats: CelMaterialFactory, _p: BuildParams = {}, ctx?: BuildCtx): Structure {
  const b = new Build(scene, mats, "shoro");
  const plinthH = 0.55;
  const postH = 4.4;
  const bellY = plinthH + postH - 1.9;
  const eave = plinthH + postH + 0.1;

  // --- colliders, exactly as they were: the platform, the posts, the bell, the roof slab.
  b.block({ w: 5.2, h: plinthH, d: 5.2, x: 0, y: plinthH / 2, z: 0 });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * 1.55;
      const z = sz * 1.55;
      b.block({ w: 0.36, h: postH, d: 0.36, x, y: plinthH + postH / 2, z });
    }
  }
  b.block({ w: 1.1, h: 1.7, d: 1.1, x: 0, y: bellY, z: 0 });
  b.block({ w: 6.6, h: 0.3, d: 6.6, x: 0, y: eave, z: 0 });

  // --- everything below is drawing -------------------------------------------
  const rnd = mulberry32(streetSeed(5.2, 5.2, postH, ctx));
  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };
  const color = HINOKI;
  /** The floor, and the platform's half width. */
  const F = plinthH;
  const P = 2.6;
  let foot = 0;
  for (const gx of [-1, -0.5, 0, 0.5, 1]) {
    for (const gz of [-1, -0.5, 0, 0.5, 1]) foot = Math.min(foot, ground(gx * (P + 0.5), gz * (P + 0.5)));
  }
  foot -= 0.08;

  const roof: RoofSpec = { y: eave, ex: 3.3, ez: 3.3, tx: 0, tz: 0, rise: 2.5, curve: 1.6, upturn: 0.55, thick: 0.24, rings: 6, seg: 8 };
  const j = new Joinery(b, color, roof);
  const { sb, at, on, member, nose, arm, block, underAt, KD } = j;
  const lap = new Lapidary(1);
  const TOP = 1 << 2;

  // --- the heights of the frame ---------------------------------------------------
  /** The post line at the head: the purlins, the plaster and the brackets stand on it. */
  const N = 1.5;
  /** The posts' drawn head; the bearing blocks stand on it. */
  const PTOP = 4.6;
  /** Where a post's axis stands at height `y`: 10 cm further out at the floor than at the head. */
  const postAt = (y: number): number => N + (0.1 * (PTOP - y)) / (PTOP - F);
  /** A post's half width at height `y`, tapering a centimetre to its head. */
  const halfAt = (y: number): number => 0.16 - (0.01 * (y - F)) / (PTOP - F);
  const BASE = F + 0.1;
  /** The flying ties, along X and (lower, to pass them) along Z; then the head ties. */
  const XT0 = 3.52;
  const XT1 = 3.72;
  const ZT0 = 3.28;
  const ZT1 = 3.48;
  const KT0 = 4.32;
  const KT1 = 4.56;
  /** A bracket set: block, arm, small blocks; the second arm is cut to its purlin. */
  const DAI = PTOP + 0.2;
  const ARM1 = DAI + 0.16;
  const MAK = ARM1 + 0.12;
  /** A purlin's underside along side `s`, held level past the corner posts. */
  const clampU = (u: number): number => Math.max(-N, Math.min(N, u));
  const ketaBot = (s: Side, u: number): number => underAt(s, clampU(u), N) - KD;
  /** The roof slab's underside, which the ceiling is drawn at. */
  const CEIL = eave - 0.15;
  /** The bell beam, on the side head ties. */
  const BB0 = KT1;
  const BB1 = KT1 + 0.28;
  /** The plaster's inner face. */
  const C = N - 0.07;

  // --- the platform: two courses of face stones, a coping, flags, two steps --------
  {
    const KW = 0.22;
    const CW = 0.34;
    /** A course of face stones along side `s`, `run` either way, from `y0` (the ground, if null) to `y1`. */
    const course = (s: Side, run: number, y0: number | null, y1: number, first: number): void => {
      let u = -run;
      let len = first;
      while (run - u > 0.05) {
        if (run - (u + len) < 0.45) len = run - u;
        const c = u + len / 2;
        let yb = y0 ?? 0;
        if (y0 === null) {
          const [gx, gz] = at(s, c, P);
          yb = Math.min(foot, ground(gx, gz) - 0.1);
        }
        on(s, P, c, (yb + y1) / 2, len - 0.02, y1 - yb, KW, -KW / 2, GRANITE, 0, hideBack(s));
        u += len;
        len = 0.8 + rnd() * 0.6;
      }
    };
    /** The coping along side `s`, `run` either way, standing 3 cm proud of the face. */
    const coping = (s: Side, run: number): void => {
      let u = -run;
      while (run - u > 0.05) {
        let len = 0.9 + rnd() * 0.5;
        if (run - (u + len) < 0.5) len = run - u;
        on(s, P, u + len / 2, F - 0.0375, len - 0.02, 0.075, CW, -CW / 2 + 0.03, GRANITE, 0, HIDE_UNDER);
        u += len;
      }
    };
    for (const s of J_SIDES) {
      const run = runsAlongX(s) ? P : P - KW;
      course(s, run, null, 0.29, 0.8 + rnd() * 0.6);
      course(s, run, 0.31, 0.455, 0.35 + rnd() * 0.4);
      coping(s, runsAlongX(s) ? P + 0.03 : P + 0.03 - CW);
    }
    // The flags inside the coping, in running bond.
    const IN = P + 0.03 - CW;
    const rows = 10;
    const rw = (2 * IN) / rows;
    for (let r = 0; r < rows; r++) {
      const z = -IN + (r + 0.5) * rw;
      let x = -IN;
      let len = r % 2 ? 0.3 + rnd() * 0.3 : 0.6 + rnd() * 0.4;
      while (IN - x > 0.05) {
        if (IN - (x + len) < 0.35) len = IN - x;
        sb.box(len - 0.02, 0.06, rw - 0.02, x + len / 2, F - 0.03, z, GRANITE, undefined, HIDE_UNDER);
        x += len;
        len = 0.6 + rnd() * 0.4;
      }
    }
    // A step before the front and on the side toward the hall: two stones
    // on a darker core carried down to the ground.
    const flat =
      (y: number) =>
      (f: number, u: number, w: number): V3 => [f, y + w, u];
    for (const s of ["-z", "-x"] as const) {
      const top = 0.29;
      const split = -0.95 + 0.7 + rnd() * 0.5;
      for (const [a, c] of [
        [-0.95, split],
        [split, 0.95],
      ]) {
        on(s, P, (a + c) / 2, top - 0.05, c - a - 0.02, 0.1, 0.46, 0.23, GRANITE, 0, HIDE_UNDER);
      }
      let bot = foot;
      for (const u of [-0.9, 0, 0.9]) {
        const [gx, gz] = at(s, u, P + 0.4);
        bot = Math.min(bot, ground(gx, gz) - 0.05);
      }
      const [cx, cz] = at(s, 0, P + 0.23);
      b.box(runsAlongX(s) ? 1.86 : 0.42, top - 0.1 - bot, runsAlongX(s) ? 0.42 : 1.86, cx, (top - 0.1 + bot) / 2, cz, GRANITE_DARK);
      {
        const [lx, lz] = at(s, (rnd() - 0.5) * 1.6, P + 0.1 + rnd() * 0.26);
        lap.leaf(rnd, flat(top), 1, lx, lz, 0.04 + rnd() * 0.02, rnd() * TAU, -0.002);
      }
    }
    // Leaves blown in over the flags.
    for (let k = 0; k < 9; k++) {
      const lx = (rnd() * 2 - 1) * (IN - 0.12);
      const lz = (rnd() * 2 - 1) * (IN - 0.12);
      lap.leaf(rnd, flat(F), 1, lx, lz, 0.045 + rnd() * 0.02, rnd() * TAU, -0.002);
    }
  }

  // --- the posts' bases and root sleeves --------------------------------------------
  /** A chamfered square section of half width `h` round (cx, cz) at height `y`. */
  const oct = (cx: number, cz: number, y: number, h: number, ch: number): Point3[] => [
    [cx + h, y, cz - h + ch],
    [cx + h, y, cz + h - ch],
    [cx + h - ch, y, cz + h],
    [cx - h + ch, y, cz + h],
    [cx - h, y, cz + h - ch],
    [cx - h, y, cz - h + ch],
    [cx - h + ch, y, cz - h],
    [cx + h - ch, y, cz - h],
  ];
  /** Post (sx, sz)'s section at height `y`, grown by `grow`. */
  const section = (sx: number, sz: number, y: number, grow: number): Point3[] =>
    oct(sx * postAt(y), sz * postAt(y), y, halfAt(y) + grow, 0.04 + grow * 0.5);
  for (const [sx, sz] of J_CORNERS) {
    b.cyl(0.1, 0.56, 0.64, 12, sx * postAt(F), F + 0.05, sz * postAt(F), GRANITE);
    convexSolid(b, section(sx, sz, BASE, 0.03), section(sx, sz, BASE + 0.04, 0.03), BRONZE);
    convexSolid(b, section(sx, sz, BASE + 0.04, 0.018), section(sx, sz, BASE + 0.27, 0.018), BRONZE);
    convexSolid(b, section(sx, sz, BASE + 0.27, 0.03), section(sx, sz, BASE + 0.31, 0.03), BRONZE);
  }

  // --- the ties ----------------------------------------------------------------------
  /** A tie through the posts on both rows along X (or Z), run on past them and cut on a slant. */
  const tie = (alongX: boolean, y0: number, y1: number, run: number): void => {
    const c = postAt((y0 + y1) / 2);
    for (const e of [-1, 1]) {
      if (alongX) sb.box(2 * c, y1 - y0, 0.18, 0, (y0 + y1) / 2, e * c, color);
      else sb.box(0.18, y1 - y0, 2 * c, e * c, (y0 + y1) / 2, 0, color);
      for (const g of [-1, 1]) nose(alongX, e * c, g * c, g, run, y0, y1, 0.18);
    }
  };
  tie(true, XT0, XT1, 0.36);
  tie(false, ZT0, ZT1, 0.36);
  tie(true, KT0, KT1, 0.42);
  tie(false, KT0, KT1, 0.42);

  // --- the bracket sets, the purlins, the frog-leg struts, the plaster -------------
  for (const [sx, sz] of J_CORNERS) {
    const x = sx * N;
    const z = sz * N;
    const sX: Side = sz < 0 ? "-z" : "+z";
    const sZ: Side = sx < 0 ? "-x" : "+x";
    block(x, z, 0.42, PTOP, DAI);
    arm(true, x, z, 1.3, DAI, ARM1, 0.2);
    arm(false, z, x, 1.3, DAI, ARM1, 0.2);
    j.makito(true, x, z, 0.4, ARM1, MAK);
    j.makito(false, x, z, 0.4, ARM1, MAK);
    arm(true, x, z, 1.3, MAK, ketaBot(sX, x), 0.2);
    arm(false, z, x, 1.3, MAK, ketaBot(sZ, z), 0.2);
  }
  for (const s of J_SIDES) {
    j.purlin(s, N, N + 0.3, (u) => underAt(s, clampU(u), N));
    j.frogLeg(s, N, KT1, ketaBot(s, 0));
    // The plaster band, in strips so its head follows the purlin's sweep.
    const half = N - 0.21;
    const K = 5;
    for (let k = 0; k < K; k++) {
      const ua = -half + (2 * half * k) / K;
      const uc = ua + (2 * half) / K;
      const top = Math.max(ketaBot(s, ua), ketaBot(s, uc)) + 0.04;
      on(s, N, (ua + uc) / 2, (KT1 + top) / 2, uc - ua, top - KT1, 0.06, -0.04, SHIKKUI);
    }
  }

  // --- the ceiling and the bell beam --------------------------------------------------
  sb.box(2 * C, 0.02, 2 * C, 0, CEIL + 0.07, 0, CEDAR, undefined, TOP);
  {
    const cells = 6;
    for (let k = 0; k <= cells; k++) {
      const u = -C + 0.06 + ((2 * C - 0.12) * k) / cells;
      sb.box(0.06, 0.06, 2 * C, u, CEIL + 0.03, 0, SUMI, undefined, TOP);
      sb.box(2 * C, 0.06, 0.06, 0, CEIL + 0.03, u, SUMI, undefined, TOP);
    }
  }
  for (const s of J_SIDES) on(s, C, 0, CEIL + 0.02, 2 * C, 0.12, 0.1, -0.05, SUMI, 0, TOP);
  sb.box(2 * C, BB1 - BB0, 0.28, 0, (BB0 + BB1) / 2, 0, color);

  // --- the bell -------------------------------------------------------------------
  /** The lip, and the bell's profile over it: down the inside, round the lip, up the outside. */
  const Y0 = bellY - 0.85;
  const BELL: [number, number][] = [
    [0, 1.58],
    [0.3, 1.56],
    [0.42, 1.49],
    [0.455, 1.36],
    [0.462, 0.08],
    [0.472, 0],
    [0.545, 0],
    [0.556, 0.035],
    [0.556, 0.095],
    [0.532, 0.135],
    [0.518, 0.22],
    [0.506, 0.6],
    [0.5, 1.0],
    [0.497, 1.4],
    [0.49, 1.5],
    [0.462, 1.585],
    [0.4, 1.645],
    [0.3, 1.69],
    [0.16, 1.715],
    [0, 1.725],
  ];
  lap.lathe(
    BRONZE,
    BELL.map(([r, y]) => [r, Y0 + y]),
    32,
    0,
  );
  /** The body's radius `y` over the lip, from the lower band to the shoulder. */
  const BODY = BELL.slice(9, 15);
  const rAt = (y: number): number => {
    for (let i = 0; i + 1 < BODY.length; i++) {
      const [ra, ya] = BODY[i];
      const [rc, yc] = BODY[i + 1];
      if (y <= yc || i + 2 === BODY.length) return ra + ((rc - ra) * (y - ya)) / (yc - ya);
    }
    return BODY[0][0];
  };
  /** A band round the body from `y0` to `y1` over the lip, standing `proud`. */
  const band = (y0: number, y1: number, proud: number): void => {
    const r = rAt((y0 + y1) / 2);
    const prof: [number, number][] = [
      [r - 0.006, Y0 + y0],
      [r + proud, Y0 + y0],
      [r + proud, Y0 + y1],
      [r - 0.006, Y0 + y1],
    ];
    lap.lathe(BRONZE, prof, 32, 0);
  };
  band(0.14, 0.26, 0.022);
  band(0.835, 0.853, 0.016);
  band(0.885, 0.903, 0.016);
  band(1.12, 1.14, 0.014);
  band(1.38, 1.46, 0.022);
  /** A line down the body at bearing `a`, `u` round from it, from `y0` to `y1` over the lip. */
  const line = (a: number, u: number, y0: number, y1: number): void => {
    const ym = (y0 + y1) / 2;
    lap.onFace(a, rAt(ym), u, Y0 + ym, 0.006, 0.02, y1 - y0, 0.02, BRONZE);
  };
  for (let q = 0; q < 4; q++) {
    const a = (q * Math.PI) / 2;
    for (const [y0, y1] of [
      [0.26, 0.55],
      [0.55, 0.835],
      [0.903, 1.12],
      [1.14, 1.38],
    ]) {
      for (const e of [-1, 1]) line(a, e * 0.035, y0, y1);
    }
  }
  /**
   * A round boss on the body at bearing `a`, `y` high and `du` round from it:
   * `r0` at its foot, `r1` at its face, standing `h` out of a foot sunk
   * `sink` into the bronze.
   */
  const boss = (a: number, y: number, du: number, r0: number, r1: number, h: number, n: number, sink: number): void => {
    const m = lap.mesher(BRONZE);
    const R = rAt(y - Y0) - sink;
    const d: V3 = [Math.cos(a), 0, Math.sin(a)];
    const t: V3 = [-Math.sin(a), 0, Math.cos(a)];
    const c0: V3 = [R * d[0] + du * t[0], y, R * d[2] + du * t[2]];
    const Q = (r: number, off: number, k: number): V3 => {
      const ph = (k / n) * TAU;
      const ct = Math.cos(ph) * r;
      return [c0[0] + d[0] * off + t[0] * ct, c0[1] + Math.sin(ph) * r, c0[2] + d[2] * off + t[2] * ct];
    };
    const face: V3 = [c0[0] + d[0] * h, c0[1], c0[2] + d[2] * h];
    for (let k = 0; k < n; k++) {
      const ph = ((k + 0.5) / n) * TAU;
      const out: V3 = [t[0] * Math.cos(ph), Math.sin(ph), t[2] * Math.cos(ph)];
      m.quad(Q(r0, 0, k), Q(r0, 0, k + 1), Q(r1, h, k + 1), Q(r1, h, k), out);
      m.tri(face, Q(r1, h, k), Q(r1, h, k + 1), d);
    }
  };
  // The nipples: four panels of four rows of five under the upper band, each framed.
  for (let q = 0; q < 4; q++) {
    const a0 = Math.PI / 4 + (q * Math.PI) / 2;
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 5; col++) boss(a0 + (col - 2) * 0.14, Y0 + 1.175 + row * 0.05, 0, 0.02, 0.01, 0.034, 6, 0.004);
    }
    for (const e of [-1, 1]) line(a0 + e * 0.37, 0, 1.14, 1.38);
  }
  // The striking seats: a lotus on a disc where the middle band crosses a vertical one.
  for (const a of [0, Math.PI]) {
    const y = Y0 + 0.87;
    boss(a, y, 0, 0.125, 0.12, 0.04, 16, 0.018);
    for (let k = 0; k < 8; k++) {
      const ph = (k / 8) * TAU;
      boss(a, y + Math.sin(ph) * 0.078, Math.cos(ph) * 0.078, 0.03, 0.02, 0.05, 6, 0.012);
    }
    boss(a, y, 0, 0.045, 0.032, 0.066, 10, 0.004);
  }
  // The crown: a collar, two dragons' bodies arched back to back across the
  // bell, their heads biting the shoulder, and the jewel between them.
  const TOPY = Y0 + 1.725;
  lap.lathe(
    BRONZE,
    [
      [0, TOPY - 0.01],
      [0.21, TOPY - 0.01],
      [0.19, TOPY + 0.045],
      [0, TOPY + 0.045],
    ],
    16,
    0,
  );
  const loop: TubePoint[] = [[0.15, TOPY + 0.03, 0.07, 0.085]];
  for (let k = 0; k <= 10; k++) {
    const th = (k / 10) * Math.PI;
    loop.push([0.15 * Math.cos(th), TOPY + 0.07 + 0.24 * Math.sin(th), 0.07, 0.085]);
  }
  loop.push([-0.15, TOPY + 0.03, 0.07, 0.085]);
  lap.tube(BRONZE, loop, Math.PI / 2);
  for (const e of [-1, 1]) {
    lap.sb.box(0.12, 0.1, 0.16, 0, TOPY + 0.1, e * 0.21, BRONZE, { x: e * 0.35 });
    lap.sb.box(0.08, 0.06, 0.13, 0, TOPY + 0.055, e * 0.3, BRONZE, { x: e * 0.55 });
    lap.sb.box(0.1, 0.04, 0.1, 0, TOPY + 0.155, e * 0.19, BRONZE, { x: -e * 0.3 });
    for (const g of [-1, 1]) lap.sb.box(0.02, 0.13, 0.02, g * 0.04, TOPY + 0.2, e * 0.15, BRONZE, { x: -e * 0.55 });
  }
  lap.lathe(
    BRONZE,
    [
      [0, TOPY + 0.34],
      [0.045, TOPY + 0.35],
      [0.06, TOPY + 0.39],
      [0.05, TOPY + 0.43],
      [0.02, TOPY + 0.47],
      [0, TOPY + 0.49],
    ],
    10,
    0,
  );
  // The iron hook, down from a plate under the bell beam and through the crown.
  {
    const HX = 0.13;
    const hy = TOPY + 0.2425;
    sb.box(0.05, BB0 - 0.03 - hy, 0.05, HX, (BB0 - 0.03 + hy) / 2, 0, SUMI);
    sb.box(HX + 0.125, 0.05, 0.05, (HX - 0.1) / 2, hy, 0, SUMI);
    sb.box(0.05, 0.1, 0.05, -0.1, hy + 0.045, 0, SUMI);
    sb.box(0.2, 0.03, 0.3, HX, BB0 - 0.015, 0, SUMI);
  }

  // --- the striking log, its slings and its tether; the board of the hours --------
  {
    const LOG_Y = 3.08;
    const L0 = 0.62;
    const L1 = 1.95;
    b.cyl(L1 - L0, 0.24, 0.24, 8, (L0 + L1) / 2, LOG_Y, 0, CEDAR, { z: Math.PI / 2 });
    for (const x of [L0 + 0.06, L1 - 0.06]) b.cyl(0.05, 0.256, 0.256, 8, x, LOG_Y, 0, SUMI, { z: Math.PI / 2 });
    for (const x of [0.9, 1.3]) {
      b.cyl(0.05, 0.27, 0.27, 8, x, LOG_Y, 0, KAYA, { z: Math.PI / 2 });
      for (const e of [-1, 1]) member([x, LOG_Y + 0.1, e * 0.1], [x, BB0, e * 0.06], 0.035, 0.035, KAYA);
    }
    // The tether: from the log's end to the post on its right, twice round
    // it, and the tail run down the post's outer face to a knot.
    const pY = 2.99;
    const pc = postAt(pY);
    const ph = halfAt(pY) + 0.018;
    member([L1 - 0.1, LOG_Y - 0.05, -0.1], [pc, pY, -pc + ph], 0.035, 0.035, KAYA);
    for (const y of [pY, pY - 0.045]) {
      for (const e of [-1, 1]) {
        sb.box(2 * ph + 0.035, 0.035, 0.035, pc, y, -pc + e * ph, KAYA);
        sb.box(0.035, 0.035, 2 * ph + 0.035, pc + e * ph, y, -pc, KAYA);
      }
    }
    const tail = (y: number): Point3 => [postAt(y) + halfAt(y) + 0.018, y, -postAt(y) + 0.06];
    member(tail(pY - 0.06), tail(F + 1.3), 0.035, 0.035, KAYA);
    const [kx, ky, kz] = tail(F + 1.28);
    sb.box(0.06, 0.07, 0.06, kx, ky, kz, KAYA);
    sb.box(0.03, 0.14, 0.03, kx, ky - 0.1, kz, KAYA);

    // The board of the hours on the front of the front left post.
    const y0 = F + 1.05;
    const y1 = F + 1.7;
    const ym = (y0 + y1) / 2;
    const bx = -postAt(ym);
    const bz = -(postAt(ym) + halfAt(ym)) - 0.0085;
    sb.box(0.26, y1 - y0, 0.025, bx, ym, bz, CEDAR);
    for (const e of [-1, 1]) sb.box(0.17, 0.02, 0.07, bx + e * 0.068, y1 + 0.04, bz - 0.02, SUMI, { z: -e * 0.45 });
    const front = bz - 0.0145;
    // Two columns of brushed characters, the first of each larger: every
    // character a handful of strokes, some of them dots, none quite square.
    for (let col = 0; col < 2; col++) {
      for (let ch = 0; ch < 6; ch++) {
        const size = ch === 0 ? 0.07 : 0.045;
        const cy = y1 - 0.07 - (ch === 0 ? 0 : 0.03 + ch * 0.083);
        const cx = bx + (col === 0 ? 0.055 : -0.055);
        const strokes = 4 + Math.floor(rnd() * 3);
        for (let k = 0; k < strokes; k++) {
          const dot = rnd() < 0.2;
          const horiz = rnd() < 0.5;
          const len = dot ? 0.016 : size * (0.3 + rnd() * 0.7);
          const x = cx + (rnd() - 0.5) * (horiz ? size * 0.4 : size * 0.9);
          const y = cy + (rnd() - 0.5) * (horiz ? size * 0.9 : size * 0.4);
          const slant = dot ? 0.8 : (rnd() - 0.5) * 0.7;
          sb.box(horiz ? len : 0.009, horiz ? 0.009 : len, 0.004, x, y, front, SUMI, { z: slant });
        }
      }
    }
  }

  // --- the eave, the tiles and the finial -----------------------------------------------
  j.rafters(() => N, 1.35);
  j.hipBeams();
  j.tiles(false);
  {
    const A = eave + roof.rise;
    sb.box(0.62, 0.5, 0.62, 0, A - 0.05, 0, KAWARA_DARK, undefined, HIDE_UNDER);
    sb.box(0.56, 0.18, 0.56, 0, A + 0.29, 0, BRONZE, undefined, HIDE_UNDER);
    sb.box(0.62, 0.04, 0.62, 0, A + 0.4, 0, BRONZE, undefined, HIDE_UNDER);
    lap.lathe(
      BRONZE,
      [
        [0, A + 0.42],
        [0.22, A + 0.42],
        [0.21, A + 0.5],
        [0.16, A + 0.57],
        [0.08, A + 0.61],
        [0, A + 0.62],
      ],
      12,
      0,
    );
    lap.lathe(
      BRONZE,
      [
        [0, A + 0.61],
        [0.05, A + 0.62],
        [0.05, A + 0.66],
        [0.14, A + 0.69],
        [0.17, A + 0.76],
        [0.16, A + 0.84],
        [0.11, A + 0.92],
        [0.05, A + 0.99],
        [0, A + 1.04],
      ],
      12,
      0,
    );
  }

  sb.flush(b);
  lap.flush(b);

  // --- the cores, emitted after what hides them -----------------------------------------
  for (const [sx, sz] of J_CORNERS) convexSolid(b, section(sx, sz, BASE, 0), section(sx, sz, PTOP, 0), color);
  b.box(2 * (P - 0.05), F - 0.06 - foot, 2 * (P - 0.05), 0, (F - 0.06 + foot) / 2, 0, GRANITE_DARK);

  // --- the roof: the lining under the rafters, then the sheet ---------------------------
  j.sheet();
  return b;
}
