/**
 * kit/japan/gardenWall.ts — buildGardenWall: the tile-capped earthen wall
 * (tsuijibei).
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
  streetSeed,
} from "../core";
import {
  GRANITE,
  GRANITE_DARK,
  HINOKI,
  KAWARA,
  KAWARA_DARK,
  SHIKKUI,
  SUMI,
  TSUCHI,
} from "./palette";

/**
 * A GARDEN WALL — a TSUIJIBEI, the tiled-coped wall an Edo temple and a good
 * inn put round their ground. Runs along X for `length`, the same on both
 * faces, because a precinct wall is looked at from the street and the garden
 * alike.
 *
 * It is drawn as one is built. A course of dressed granite kerb stones, set
 * with open joints over a darker core, is carried down to the ground under
 * each stone. On it stands a timber-framed wall of plaster, a post at each
 * end and every three metres or so, with a head rail along the top of each
 * face. **What the plaster SAYS is its colour**: the ochre earthen wall
 * (`TSUCHI`, the default) is a temple's SUJIBEI, and carries five raised
 * white lines — the highest of the ranks — run between the posts; the white
 * lime wall (`SHIKKUI`) is a house's, and wears a skirt of dark boards under
 * battens with a drip rail over it instead. Over the head rail, rafters on
 * both faces carry a board lining and the coping: a sheet of tile laid with
 * round-tile rows, an end tile on each at the eave over a straight eave lip,
 * a ridge banded in white on a base course with a demon tile at each end,
 * and at each end of the run a gable — the wall head carried up to the
 * tiles in plaster under barge boards and a roll of verge tiles.
 *
 * **The collider is exactly what it was**: one box, `length` by `height` by
 * 0.8, and the plaster is now drawn at its faces (it stood 5 cm inside them).
 * Everything else obeys the kit's three rules: posts, lines, the skirt and the
 * stones are applied on a face; the coping stands on the collider's top; the
 * eave's lowest point clears 2.35 m on a default wall and lies 0.72 m out of
 * the centre line, inside the 0.8 m a body's radius keeps it from the face,
 * so nobody walks under it.
 *
 * It is in `CONFORMS_TO_TERRAIN`: the stones' lengths are seeded off where it
 * stands, and each stone runs down to the ground under it — a run laid across
 * a fall shows a deeper course at its low end rather than a gap.
 */
export function buildGardenWall(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "tsuijibei");
  const len = p.length ?? 12;
  const h = p.height ?? 2.4;
  const plaster = p.tint ?? TSUCHI;

  // --- the collider, exactly as it was ---------------------------------------------
  b.block({ w: len, h, d: 0.8, x: 0, y: h / 2, z: 0 });

  // --- everything below is drawing -------------------------------------------------
  const rnd = mulberry32(streetSeed(len, 0.8, h, ctx));
  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };
  const sb = new StoneBatch();
  const half = len / 2;
  /** The plaster's face, which is the collider's. */
  const FACE = 0.4;
  /** Top of the kerb course, where the plaster starts. */
  const BASE = 0.5;
  const SIDES_Z = [
    [-1, "-z"],
    [1, "+z"],
  ] as const;
  /** The end of a member laid down the slope on side `s` that is toward the ridge. */
  const inEnd = (s: number): number => (s < 0 ? 1 << 4 : 1 << 5);
  const TOP = 1 << 2;

  // --- the kerb course -----------------------------------------------------------
  // Dressed stones with a 2 cm joint, their faces 7.5 cm proud of the plaster
  // and 2.5 cm proud of a core behind them, so every joint is a step the ink
  // finds. An end stone turns each end of the run.
  const KERB = FACE + 0.075;
  const END_STONE = 0.14;
  let low = 0;
  for (const [s, side] of SIDES_Z) {
    let x = -half + END_STONE + 0.02;
    while (x < half - END_STONE - 0.3) {
      let l = 0.75 + rnd() * 0.6;
      if (half - END_STONE - 0.02 - (x + l) < 0.45) l = half - END_STONE - 0.02 - x;
      const x1 = x + l;
      const foot = Math.min(ground(x, s * KERB), ground(x1, s * KERB)) - 0.12;
      low = Math.min(low, foot);
      const top = BASE - 0.004 + (rnd() - 0.5) * 0.008;
      const out = (rnd() - 0.5) * 0.008;
      sb.box(l, top - foot, 0.12, x + l / 2, (top + foot) / 2, s * (KERB - 0.06 + out), GRANITE, undefined, (1 << 3) | hideBack(side));
      x = x1 + 0.02;
    }
  }
  for (const sx of [-1, 1]) {
    const foot = Math.min(ground(sx * half, -KERB), ground(sx * half, KERB)) - 0.12;
    low = Math.min(low, foot);
    sb.box(END_STONE, BASE - foot, KERB * 2, sx * (half - END_STONE / 2 + 0.005), (BASE + foot) / 2, 0, GRANITE, undefined, 1 << 3);
  }

  // --- the frame: posts and the head rail -------------------------------------------
  const bays = Math.max(1, Math.round(len / 3.3));
  const POST = 0.2;
  const posts: number[] = [];
  for (let i = 0; i <= bays; i++) posts.push(-half + (len * i) / bays);
  const wallH = h - BASE;
  const midY = BASE + wallH / 2;
  // The end posts are full depth and cap the plaster's end.
  for (const sx of [-1, 1]) {
    sb.box(POST, wallH, FACE * 2 + 0.07, sx * (half - POST / 2 + 0.005), midY, 0, SUMI, undefined, 1 << 3);
  }
  for (const [s, side] of SIDES_Z) {
    for (let i = 1; i < bays; i++) sb.onFace(side, FACE, posts[i], midY, POST, wallH, 0.035, 0.0175, SUMI, 0, 0, hideBack(side));
    // The head rail, on the plaster's top edge under the rafters.
    sb.box(len, 0.12, 0.1, 0, h + 0.06, s * (FACE + 0.02), SUMI, undefined, 1 << 3);
  }
  /** Each bay's clear run between post faces. */
  const bayRuns = posts.slice(0, -1).map((x0, i) => [x0 + POST / 2 + (i === 0 ? POST / 2 : 0), posts[i + 1] - POST / 2 - (i === bays - 1 ? POST / 2 : 0)] as const);

  if (plaster === TSUCHI) {
    // --- the five lines -------------------------------------------------------------
    for (const [, side] of SIDES_Z) {
      for (const [x0, x1] of bayRuns) {
        for (let i = 0; i < 5; i++) {
          sb.onFace(side, FACE, (x0 + x1) / 2, h - 0.34 - i * 0.13, x1 - x0, 0.045, 0.02, 0.01, SHIKKUI, 0, 0, hideBack(side));
        }
      }
    }
  } else {
    // --- the board skirt -----------------------------------------------------------
    const SKIRT = 0.85;
    for (const [, side] of SIDES_Z) {
      for (const [x0, x1] of bayRuns) {
        const u = (x0 + x1) / 2;
        const run = x1 - x0;
        sb.onFace(side, FACE, u, BASE + SKIRT / 2, run, SKIRT, 0.02, 0.01, SUMI, 0, 0, hideBack(side));
        const n = Math.max(1, Math.round(run / 0.45));
        for (let k = 1; k < n; k++) {
          sb.onFace(side, FACE, x0 + (run * k) / n, BASE + SKIRT / 2, 0.045, SKIRT, 0.02, 0.03, SUMI, 0, 0, hideBack(side) | (1 << 3));
        }
        sb.onFace(side, FACE, u, BASE + SKIRT + 0.03, run, 0.06, 0.05, 0.025, SUMI, 0, 0, hideBack(side));
      }
    }
  }

  // --- the coping -------------------------------------------------------------------
  // One pitch on both faces. `yTop(n)` is the tile sheet's top `n` out from
  // the centre line; `slope(s, n, lift)` is that point on side `s` lifted
  // `lift` along the sheet's normal.
  const E = 0.72;
  const OV = 0.12;
  const TAN = 0.45;
  const P = Math.atan(TAN);
  const cosP = Math.cos(P);
  const sinP = Math.sin(P);
  const SHEET = 0.08;
  const Y0 = h + 0.12 + E * TAN;
  const yTop = (n: number): number => Y0 - n * TAN;
  const slope = (s: number, n: number, lift: number): [number, number] => [yTop(n) + lift * cosP, s * (n + lift * sinP)];
  /** A member of section `wide` x `deep` laid down the slope on side `s` from `n0` to `n1`, its centre `lift` off the sheet. */
  const down = (s: number, x: number, n0: number, n1: number, lift: number, wide: number, deep: number, color: string, hide = 0): void => {
    const [y, z] = slope(s, (n0 + n1) / 2, lift);
    sb.box(wide, deep, (n1 - n0) / cosP, x, y, z, color, { x: s * P }, hide);
  };
  const RUN = len + OV * 2;
  const ROW = 0.28;
  const rows = Math.floor((RUN - 0.2) / ROW);
  const rowPitch = (RUN - 0.2) / rows;
  for (const [s] of SIDES_Z) {
    // Round-tile rows, each ending on an end tile, over a straight eave lip.
    for (let k = 0; k < rows; k++) {
      const x = -RUN / 2 + 0.1 + rowPitch * (k + 0.5);
      down(s, x, 0.14, E - 0.01, 0.035, 0.1, 0.08, KAWARA_DARK, (1 << 3) | (1 << 4) | (1 << 5));
      const [ey, ez] = slope(s, E - 0.015, 0.03);
      sb.box(0.13, 0.1, 0.04, x, ey, ez, KAWARA_DARK, { x: s * P }, (1 << 3) | inEnd(s));
    }
    const [ly, lz] = slope(s, E + 0.02, -0.01);
    sb.box(RUN + 0.02, 0.13, 0.04, 0, ly, lz, KAWARA_DARK, { x: s * P });
    // The verge: a roll of tiles down each end, and a barge board under it.
    for (const sx of [-1, 1]) {
      down(s, sx * (RUN / 2 - 0.05), 0.12, E + 0.01, 0.04, 0.1, 0.09, KAWARA_DARK, (1 << 3) | inEnd(s));
      down(s, sx * (RUN / 2 + 0.005), 0, E, -SHEET / 2 - 0.035, 0.03, 0.15, SUMI, inEnd(s));
    }
    // The sheet, then the lining under it and the rafters under that.
    down(s, 0, 0, E, -SHEET / 2, RUN, SHEET, KAWARA, inEnd(s));
    down(s, 0, 0.3, E - 0.02, -SHEET - 0.01, len + 0.1, 0.02, HINOKI, TOP | inEnd(s));
    const raft = Math.round(len / 0.33);
    for (let k = 0; k < raft; k++) {
      const x = -half + (len * (k + 0.5)) / raft;
      down(s, x, FACE, E - 0.06, -SHEET - 0.02 - 0.0275, 0.055, 0.055, SUMI, TOP | inEnd(s));
    }
  }
  // The ridge: a base course, a white band, a course and a round cap, and a
  // demon tile at each end.
  const RL = RUN - 0.06;
  let ry = Y0 + 0.08;
  sb.box(RL, 0.18, 0.36, 0, ry - 0.09, 0, KAWARA_DARK, undefined, 1 << 3);
  sb.box(RL - 0.04, 0.025, 0.32, 0, ry + 0.0125, 0, SHIKKUI, undefined, 1 << 3);
  ry += 0.025;
  sb.box(RL, 0.07, 0.28, 0, ry + 0.035, 0, KAWARA_DARK, undefined, 1 << 3);
  ry += 0.07;
  sb.box(RL, 0.09, 0.17, 0, ry + 0.045, 0, KAWARA_DARK, undefined, 1 << 3);
  for (const sx of [-1, 1]) {
    const ox = sx * (RL / 2 + 0.03);
    sb.box(0.08, 0.36, 0.44, ox, Y0 + 0.1, 0, KAWARA_DARK);
    sb.box(0.08, 0.16, 0.26, ox, Y0 + 0.36, 0, KAWARA_DARK);
    sb.box(0.08, 0.1, 0.1, ox, Y0 + 0.47, 0, KAWARA_DARK, { x: Math.PI / 4 });
  }
  sb.flush(b);

  // --- what all of that hides, emitted after it ------------------------------------
  b.box(len, wallH, FACE * 2, 0, midY, 0, plaster);
  // The wall head carried up under the lining: the gable at each end.
  const under = (n: number): number => yTop(n) - SHEET / cosP - 0.005;
  const head = (x: number): Point3[] => [
    [x, h, -FACE],
    [x, h, FACE],
    [x, under(FACE), FACE],
    [x, under(0), 0],
    [x, under(FACE), -FACE],
  ];
  convexSolid(b, head(-half), head(half), plaster);
  b.box(len - END_STONE * 2, BASE - 0.02 - low, (KERB - 0.025) * 2, 0, (BASE - 0.02 + low) / 2, 0, GRANITE_DARK);
  return b;
}
