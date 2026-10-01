/**
 * kit/japan/templeHall.ts — buildTempleHall: the temple's main hall (hondō).
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
  hideBack,
  limb,
  orient,
  outward,
  rope,
  runsAlongX,
  streetSeed,
} from "../core";
import {
  BRONZE,
  CEDAR,
  GILT_GLOW,
  GRANITE,
  GRANITE_DARK,
  HINOKI,
  KAWARA,
  KAWARA_DARK,
  KAYA,
  NOREN,
  PAPER,
  SHIKKUI,
  SHOJI_GLOW,
  SUMI,
  TRANSLUCENCY,
} from "./palette";
import { Mesher, curvedRoof, roofHeight, type RoofSpec, type V3 } from "./roof";

/**
 * The TEMPLE HALL (hondō): the main hall of an Edo-period temple in the
 * native (wayō) manner — a paper-walled hall on a granite base, ringed by a
 * veranda of pillars carrying a hipped roof that is taller than the hall
 * under it, with the altar's gilt glowing in the dark at the back.
 *
 * The plinth is walked at 0.55 and is the whole veranda — nineteen pillars on
 * it and the hall's walls set 1.6 m in from its edge — so it is a place to
 * fight along as well as a way in. The front has THREE doorways and each side
 * one, because a flag hall with one door is a corridor to die in. Everything
 * inside is one surface: a hall is one room, and the altar is cover.
 *
 * **It was a box of glowing grids ringed by bare posts under one smooth grey
 * hip**: a slab where the brackets should be, a slotted block for a ridge, a
 * plaster band round the top and a black box with a gilt rectangle over it
 * for an altar. What makes a hall one is that its FRAME is its ornament and
 * its EAVE is carried, so that is where this spends its vertices:
 *
 * - **The base (kidan)** is dan-jō granite — a ground course, posts with sunk
 *   panels between them and a coping — carried down to the ground, with the
 *   veranda's edge beam on it and boards laid along each side inside it. A
 *   granite step before the front doors and before each side door.
 * - **The hall's walls are a frame**: posts on a sill, a waist rail, the
 *   door-head nageshi with a bronze nail cover at every post, plaster over it
 *   to a head tie, and a plate. The paper bays are two lapped sashes of
 *   lattice over a board waist; the back is lapped boards with a shut
 *   boarded door in its middle bay. Over the plate the wall carries on up to
 *   the rafters in white plaster between the posts, which is what the veranda
 *   looks up at.
 * - **The doors** stand open, their panelled leaves folded back against the
 *   wall inside, with linings and a threshold in every opening.
 * - **The veranda's pillars** are tied through their heads (kashiranuki, its
 *   ends run on past the corners), and each carries a BRACKET SET — a bearing
 *   block, an arm along the tie and an arm out from it carrying small blocks,
 *   the plate along the pillar line and the eave purlin one step out — with a
 *   frog-leg strut (kaerumata) in every bay. A cambered tie beam runs in from
 *   each pillar to the hall's plate, and white plaster fills the pillar line
 *   from the plate up to the rafters.
 * - **The eave is two layers of parallel rafters** (base and flying, the
 *   flying ends capped in bronze) under a board lining, cut against a hip
 *   beam into each corner, which carries a wind bell.
 * - **The roof** is tiled in rows of round tiles with end tiles on an eave
 *   lip, under a ridge of courses banded in white with a demon tile at each
 *   end, and a hip ridge down each corner ending on its own demon tile.
 * - **The front** has a plaque on the bracket band, a curtain along the
 *   pillar line under the tie with the temple's mark in each bay, a gong
 *   before the middle door with a rope to ring it by, and bronze lanterns
 *   hung in the veranda.
 * - **Inside**: board floors, a coffered ceiling, a nageshi ringing the four
 *   inner pillars, and the altar drawn as a Sumeru dais (shumidan) — lacquer
 *   with bronze mouldings, gilt openings round its waist and a railing on it
 *   — carrying a seated Buddha on a lotus against a gilt halo and mandorla,
 *   two standing attendants, a canopy, candles, an incense burner and lotus
 *   vases, with a desk, a bowl and a drum on the floor before it.
 *
 * Seeded by where it stands (`streetSeed`), which is why it is in
 * `CONFORMS_TO_TERRAIN`: the stone and board lengths, the glyphs on the plaque
 * and the lanterns at the back vary, and the base and the steps are carried
 * down to the ground.
 *
 * **The colliders are the ones it always had, in the same order**: the
 * plinth, the walls (the retired `wall` calls spelled out as blocks), the four
 * inner pillars, the altar, the nineteen veranda pillars, then the roof slab.
 * Everything drawn is on a face (none more than 0.14 m proud), under 0.3 m
 * (the boards, the steps, the bases, the desk), overhead (everything from the
 * nageshi up clears the floor by 3.4 m, the gong's rope by a metre), or on a
 * collider (the altar's railing and figures, the upper walls on the hall's).
 */
export function buildTempleHall(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "hondo");
  const w = p.width ?? 20;
  const d = p.depth ?? 15;
  const plinthH = 0.55;
  const ring = 1.6;
  const pw = w + ring * 2;
  const pd = d + ring * 2;
  const wallH = 5.0;
  const t = 0.3;
  const top = plinthH + wallH;
  const doorH = 3.4;

  // --- colliders, exactly as they were: the plinth, the walls (the old `wall`
  // calls), the inner pillars, the altar, the veranda's pillars, the roof.
  b.block({ w: pw, h: plinthH, d: pd, x: 0, y: plinthH / 2, z: 0 });
  const wy = plinthH + wallH / 2;
  const segs: [number, number, boolean][] = [];
  {
    // Front: solid / door / solid / door / solid / door / solid, scaled to w.
    const unit = w / 20;
    const plan = [3, 3, 2, 4, 2, 3, 3];
    let x = -w / 2;
    plan.forEach((len, i) => {
      segs.push([x + (len * unit) / 2, len * unit, i % 2 === 1]);
      x += len * unit;
    });
  }
  const fz = -d / 2 + t / 2;
  for (const [cx, len, open] of segs) {
    if (open) b.block({ w: len, h: wallH - doorH, d: t, x: cx, y: plinthH + doorH + (wallH - doorH) / 2, z: fz });
    else b.block({ w: len, h: wallH, d: t, x: cx, y: wy, z: fz });
  }
  b.block({ w, h: wallH, d: t, x: 0, y: wy, z: d / 2 - t / 2 });
  const side = (d - 2.4) / 2;
  for (const sx of [-1, 1] as const) {
    const x = sx * (w / 2 - t / 2);
    for (const sz of [-1, 1]) b.block({ w: t, h: wallH, d: side, x, y: wy, z: sz * (1.2 + side / 2) });
    b.block({ w: t, h: wallH - doorH, d: 2.4, x, y: plinthH + doorH + (wallH - doorH) / 2, z: 0 });
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) b.block({ w: 0.42, h: wallH, d: 0.42, x: sx * w * 0.22, y: wy, z: sz * d * 0.18 });
  }
  b.block({ w: w * 0.4, h: 1.0, d: 2.2, x: 0, y: plinthH + 0.5, z: d / 2 - 2.0 });
  const pillarH = wallH + 0.9;
  const px = pw / 2 - 0.4;
  const pz = pd / 2 - 0.4;
  const colsX = Math.round((px * 2) / 3.6);
  const colsZ = Math.round((pz * 2) / 3.6);
  const pillars: [number, number][] = [];
  for (let i = 0; i <= colsX; i++) {
    const x = -px + (i / colsX) * px * 2;
    pillars.push([x, -pz], [x, pz]);
  }
  for (let i = 1; i < colsZ; i++) {
    const z = -pz + (i / colsZ) * pz * 2;
    pillars.push([-px, z], [px, z]);
  }
  for (const [x, z] of pillars) b.block({ w: 0.4, h: pillarH, d: 0.4, x, y: plinthH + pillarH / 2, z });
  const beamY = plinthH + pillarH;
  const eave = beamY + 0.7;
  const ex = pw / 2 + 2.4;
  const ez = pd / 2 + 2.4;
  // Roofs last (see the kit header).
  b.block({ w: ex * 2, h: 0.4, d: ez * 2, x: 0, y: eave, z: 0 });

  // --- everything below is drawing -------------------------------------------
  const rnd = mulberry32(streetSeed(pw, pd, top, ctx));
  const backLanterns = rnd() < 0.6;
  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };
  const PX = pw / 2;
  const PZ = pd / 2;
  let foot = Math.min(0, ground(0, -(PZ + 1.1)), ground(-(PX + 0.9), 0), ground(PX + 0.9, 0));
  for (const gx of [-1, 0, 1]) {
    for (const gz of [-1, 0, 1]) {
      if (gx || gz) foot = Math.min(foot, ground(gx * (PX + 0.3), gz * (PZ + 0.3)));
    }
  }
  foot -= 0.08;

  const sb = new StoneBatch();
  const SIDES: Side[] = ["-z", "+z", "-x", "+x"];
  const OPP: Record<Side, Side> = { "-z": "+z", "+z": "-z", "-x": "+x", "+x": "-x" };
  const CORNERS = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const;
  // A member laid from `a` to `c` along its own Z hides these faces.
  const TOP = 1 << 2;
  const START = 1 << 5;
  const END = 1 << 4;
  const wallFace = (s: Side): number => (runsAlongX(s) ? d / 2 : w / 2);
  const faceLen = (s: Side): number => (runsAlongX(s) ? w : d);
  /** The veranda's pillar line on side `s`. */
  const lineN = (s: Side): number => (runsAlongX(s) ? pz : px);
  /** Plan point `n` out from the centre on side `s`, `u` along it. */
  const at = (s: Side, u: number, n: number): [number, number] =>
    runsAlongX(s) ? [u, outward(s) * n] : [outward(s) * n, u];
  /** A member on side `s`'s outer wall face, `out` from the face to its own centre. */
  const on = (s: Side, u: number, y: number, along: number, tall: number, thick: number, out: number, color: string, tilt = 0): void =>
    sb.onFace(s, wallFace(s), u, y, along, tall, thick, out, color, tilt, 0, hideBack(s));
  /** The same on the wall's inner face, `out` into the hall. */
  const inner = (s: Side, u: number, y: number, along: number, tall: number, thick: number, out: number, color: string): void =>
    sb.onFace(s, wallFace(s) - t, u, y, along, tall, thick, -out, color, 0, 0, hideBack(OPP[s]));
  /** A member centred on plane `n` of side `s` — the pillar line's timbers. */
  const onLine = (s: Side, n: number, u: number, y: number, along: number, tall: number, thick: number, color: string, tilt = 0, hide = 0): void =>
    sb.onFace(s, n, u, y, along, tall, thick, 0, color, tilt, 0, hide);
  /** A glow on side `s` whose centre is `plane` out from the building's centre. */
  const glowAt = (s: Side, plane: number, u: number, y: number, along: number, tall: number, color = SHOJI_GLOW): void => {
    const c = outward(s) * plane;
    if (runsAlongX(s)) b.glow(along, tall, 0.02, u, y, c, color);
    else b.glow(0.02, tall, along, c, y, u, color);
  };
  const member = (a: Point3, c: Point3, wide: number, deep: number, color: string, hide = 0): void => {
    const o = orient(a, c);
    sb.box(wide, deep, o.len, o.mid[0], o.mid[1], o.mid[2], color, o.rot, hide);
  };
  /** An end face 1.5 cm past `c`, square to the member from `a` — a tile's, or a rafter's cap. */
  const endFace = (a: Point3, c: Point3, wide: number, deep: number, color: string): void => {
    const o = orient(a, c);
    const k = 0.015 / o.len;
    sb.box(wide, deep, 0.01, c[0] + (c[0] - a[0]) * k, c[1] + (c[1] - a[1]) * k, c[2] + (c[2] - a[2]) * k, color, o.rot, 63 & ~END);
  };
  /** A disc of gilt light facing along Z — a halo — `sy` stretching it upward. */
  const glowDisc = (dia: number, x: number, y: number, z: number, sy = 1): void => {
    const m = b.cyl(0.02, dia, dia, 20, x, y, z, BRONZE, { x: Math.PI / 2 });
    m.material = mats.getEmissive(GILT_GLOW);
    m.metadata = { noInk: true };
    m.scaling.z = sy;
  };

  // --- the heights of the frame --------------------------------------------------
  const F0 = plinthH;
  const SILL = F0 + 0.14;
  const KICK = F0 + 0.6;
  const P0 = KICK + 0.1;
  const KAMOI = F0 + doorH;
  const P1 = KAMOI - 0.2;
  const NAGE = KAMOI + 0.25;
  const TIE = top - 0.2;
  const PLATE = top + 0.2;
  const CEIL = top - 0.15;
  // The veranda's bracket band, from the pillar heads up.
  const KN0 = beamY - 0.35;
  const KN1 = beamY - 0.05;
  const DAI = beamY + 0.2;
  const ARM = DAI + 0.16;
  const MAK = ARM + 0.1;
  const PL1 = MAK + 0.2;

  // --- the roof's own geometry, which everything under and on it is cut to ------
  const RISE = 6.4;
  const CURVE = 1.75;
  const TH = 0.3;
  const rx = (w - d) / 2 + 3;
  const roof: RoofSpec = { y: eave, ex, ez, tx: rx, tz: 0, rise: RISE, curve: CURVE, upturn: 1.0, thick: TH, rings: 7, seg: 8 };
  /** The underside of the board lining, which the rafters hang under. */
  const soffit = (x: number, z: number): number => roofHeight(roof, x, z, true) - 0.03;
  const RB = 0.16;
  const RF = 0.12;
  /** The underside of the base rafters over (u, n) on side `s`. */
  const underAt = (s: Side, u: number, n: number): number => {
    const [x, z] = at(s, u, n);
    return soffit(x, z) - RB;
  };
  /** Where the hip crosses the row `u` of side `s`, as a distance out from the centre. */
  const nHip = (s: Side, u: number): number =>
    runsAlongX(s) ? (ez * (Math.abs(u) - rx)) / (ex - rx) : ex - ((ex - rx) * (ez - Math.abs(u))) / ez;

  // --- the elevations: which bay is which ----------------------------------------
  type Bay = { a: number; c: number; kind: "shoji" | "door" | "boards" | "itado" };
  const front: Bay[] = segs.map(([cx, len, open]) => ({ a: cx - len / 2, c: cx + len / 2, kind: open ? "door" : "shoji" }));
  const sideBays: Bay[] = [];
  for (const [a, c, kind] of [
    [-d / 2, -1.2, "shoji"],
    [-1.2, 1.2, "door"],
    [1.2, d / 2, "shoji"],
  ] as const) {
    if (kind === "door") sideBays.push({ a, c, kind });
    else for (let i = 0; i < 2; i++) sideBays.push({ a: a + ((c - a) * i) / 2, c: a + ((c - a) * (i + 1)) / 2, kind });
  }
  const bays: Record<Side, Bay[]> = {
    "-z": front,
    "+z": front.map((bay, i) => ({ a: bay.a, c: bay.c, kind: i === 3 ? "itado" : "boards" })),
    "-x": sideBays,
    "+x": sideBays,
  };
  /** The posts in a wall, a door's two stood off it onto the wall so none hangs in the opening. */
  const posts = (s: Side): number[] => {
    const bs = bays[s];
    return [bs[0].a, ...bs.map((bay, i) => bay.c + (bay.kind === "door" ? 0.14 : bs[i + 1]?.kind === "door" ? -0.14 : 0))];
  };

  // --- the base: dan-jō granite, carried to the ground, the veranda's edge ------
  const plinthFace = (s: Side): number => (runsAlongX(s) ? PZ : PX);
  const plinthLen = (s: Side): number => (runsAlongX(s) ? pw : pd);
  const kf = (s: Side, u: number, y: number, along: number, tall: number, thick: number, out: number, color: string): void =>
    sb.onFace(s, plinthFace(s), u, y, along, tall, thick, out, color, 0, 0, hideBack(s));
  const course = (s: Side, y0: number, y1: number, proud: number): void => {
    const run = plinthLen(s) / 2 + proud;
    let u = -run;
    while (run - u > 0.05) {
      let len = 1.1 + rnd() * 0.6;
      if (run - (u + len) < 0.5) len = run - u;
      kf(s, u + len / 2, (y0 + y1) / 2, len - 0.02, y1 - y0, proud * 2, 0, GRANITE);
      u += len;
    }
  };
  for (const s of SIDES) {
    const L = plinthLen(s);
    course(s, foot, 0.1, 0.04);
    const n = Math.max(4, Math.round(L / 1.9));
    for (let k = 0; k <= n; k++) {
      const u = k === 0 ? -L / 2 + 0.12 : k === n ? L / 2 - 0.12 : -L / 2 + (k * L) / n;
      kf(s, u, 0.21, 0.24, 0.22, 0.1, 0, GRANITE);
      if (k < n) kf(s, -L / 2 + ((k + 0.5) * L) / n, 0.21, L / n - 0.2, 0.22, 0.03, 0, GRANITE);
    }
    course(s, 0.32, 0.42, 0.07);
    kf(s, 0, (0.42 + F0 + 0.012) / 2, L + 0.08, F0 + 0.012 - 0.42, 0.16, -0.04, HINOKI);
  }
  // The steps: a broad one before the three front doors and one before each side door.
  const step = (x: number, z: number, along: number, deep: number, alongX: boolean): void => {
    const g = ground(x, z);
    const sTop = 0.28;
    const sBot = Math.min(g, foot) - 0.05;
    let u = -along / 2;
    while (along / 2 - u > 0.05) {
      let len = 1.3 + rnd() * 0.8;
      if (along / 2 - (u + len) < 0.6) len = along / 2 - u;
      const c = u + len / 2;
      if (alongX) sb.box(len - 0.02, 0.1, deep, x + c, sTop - 0.05, z, GRANITE, undefined, HIDE_UNDER);
      else sb.box(deep, 0.1, len - 0.02, x, sTop - 0.05, z + c, GRANITE, undefined, HIDE_UNDER);
      u += len;
    }
    if (alongX) b.box(along - 0.04, sTop - 0.1 - sBot, deep - 0.04, x, (sTop - 0.1 + sBot) / 2, z, GRANITE_DARK);
    else b.box(deep - 0.04, sTop - 0.1 - sBot, along - 0.04, x, (sTop - 0.1 + sBot) / 2, z, GRANITE_DARK);
  };
  const doorSpan = front[front.length - 2].c - front[1].a;
  step(0, -PZ - 0.55, doorSpan + 1.2, 1.1, true);
  for (const sx of [-1, 1]) step(sx * (PX + 0.45), 0, 3.6, 0.9, false);

  // --- the floors: the veranda's boards along each side, the hall's across it ---
  const boardRun = (alongX: boolean, lo: number, hi: number, fixed: number, bw: number, color: string): void => {
    let u = lo;
    while (hi - u > 0.05) {
      let len = 2.4 + rnd() * 1.6;
      if (hi - (u + len) < 1.0) len = hi - u;
      const mid = u + len / 2;
      if (alongX) sb.box(len - 0.008, 0.05, bw - 0.012, mid, F0 - 0.025, fixed, color, undefined, HIDE_UNDER);
      else sb.box(bw - 0.012, 0.05, len - 0.008, fixed, F0 - 0.025, mid, color, undefined, HIDE_UNDER);
      u += len;
    }
  };
  {
    const VB = 5;
    for (const e of [-1, 1]) {
      const bz = (PZ - 0.12 - d / 2) / VB;
      for (let j = 0; j < VB; j++) boardRun(true, -(PX - 0.12), PX - 0.12, e * (d / 2 + (j + 0.5) * bz), bz, CEDAR);
      const bx = (PX - 0.12 - w / 2) / VB;
      for (let j = 0; j < VB; j++) boardRun(false, -d / 2, d / 2, e * (w / 2 + (j + 0.5) * bx), bx, CEDAR);
    }
  }
  const IW = w - 2 * t;
  const ID = d - 2 * t;
  const AW = w * 0.2;
  const AZ0 = d / 2 - 3.1;
  const AZ1 = d / 2 - 0.9;
  {
    const nr = Math.round(ID / 0.3);
    const bw = ID / nr;
    for (let r = 0; r < nr; r++) {
      const z = -ID / 2 + (r + 0.5) * bw;
      const cuts: [number, number][] = z > AZ0 && z < AZ1 ? [[-AW, AW]] : [];
      for (const [a, c] of carve(-IW / 2, IW / 2, cuts)) boardRun(true, a, c, z, bw, HINOKI);
    }
  }

  // --- the hall's outer elevations ------------------------------------------------
  const lit = !!p.litWindows;
  /** A paper bay's lattice: sashes in two tracks, `dir` 1 outside and -1 in. */
  const sashes = (s: Side, a: number, c: number, dir: 1 | -1): void => {
    const put = dir > 0 ? on : inner;
    const np = Math.max(1, Math.round((c - a) / 1.0));
    const sw = (c - a) / np;
    const rows = Math.round((P1 - P0) / 0.34);
    for (let i = 0; i < np; i++) {
      const u = a + (i + 0.5) * sw;
      const lap = dir > 0 ? (i % 2) * 0.035 : 0;
      for (const e of [-1, 1]) put(s, u + e * (sw / 2 - 0.035), (P0 + P1) / 2, 0.07, P1 - P0, 0.05, 0.055 + lap, SUMI);
      for (const yr of [P0 + 0.035, P1 - 0.035]) put(s, u, yr, sw - 0.07, 0.07, 0.05, 0.055 + lap, SUMI);
      for (let k = 1; k < 3; k++) put(s, u - sw / 2 + 0.035 + (k * (sw - 0.07)) / 3, (P0 + P1) / 2, 0.03, P1 - P0 - 0.07, 0.03, 0.05 + lap, SUMI);
      for (let r = 1; r < rows; r++) put(s, u, P0 + (r * (P1 - P0)) / rows, sw - 0.1, 0.03, 0.03, 0.05 + lap, SUMI);
    }
  };
  for (const s of SIDES) {
    const L = faceLen(s);
    const pu = posts(s);
    const doors: [number, number][] = bays[s].filter((bay) => bay.kind === "door").map((bay) => [bay.a, bay.c]);
    for (const [a, c] of carve(-L / 2, L / 2, doors)) on(s, (a + c) / 2, (F0 + SILL) / 2, c - a, SILL - F0, 0.1, 0.05, HINOKI);
    pu.forEach((u, i) => {
      const corner = i === 0 || i === pu.length - 1;
      on(s, u, (F0 + top) / 2, corner ? 0.34 : 0.28, top - F0, 0.12, 0.06, HINOKI);
      on(s, u, (KAMOI + NAGE) / 2, 0.12, 0.12, 0.02, 0.14, BRONZE);
      on(s, u, (KAMOI + NAGE) / 2, 0.06, 0.06, 0.02, 0.155, BRONZE);
    });
    on(s, 0, (KAMOI + NAGE) / 2, L + 0.12, NAGE - KAMOI, 0.12, 0.07, HINOKI);
    for (const bay of bays[s]) on(s, (bay.a + bay.c) / 2, (NAGE + TIE) / 2, bay.c - bay.a, TIE - NAGE, 0.02, 0.01, SHIKKUI);
    on(s, 0, (TIE + top) / 2, L + 0.12, top - TIE, 0.1, 0.05, HINOKI);
    on(s, 0, (top + PLATE) / 2, L + 0.36, PLATE - top, 0.16, 0.08, HINOKI);

    for (const bay of bays[s]) {
      const a = bay.a + 0.14;
      const c = bay.c - 0.14;
      const cu = (a + c) / 2;
      if (bay.kind === "shoji") {
        const nb = Math.max(2, Math.round((c - a) / 0.3));
        for (let k = 0; k < nb; k++) {
          on(s, a + ((k + 0.5) * (c - a)) / nb, (SILL + KICK) / 2, (c - a) / nb - 0.01, KICK - SILL, 0.03, 0.02 + (k % 2) * 0.014, HINOKI);
        }
        on(s, cu, KICK + 0.05, c - a, 0.1, 0.08, 0.04, HINOKI);
        if (lit) glowAt(s, wallFace(s) + 0.015, cu, (P0 + P1) / 2, c - a, P1 - P0);
        else on(s, cu, (P0 + P1) / 2, c - a, P1 - P0, 0.02, 0.015, PAPER);
        on(s, cu, (P1 + KAMOI) / 2, c - a, KAMOI - P1, 0.08, 0.04, HINOKI);
        sashes(s, a, c, 1);
      } else if (bay.kind === "boards" || bay.kind === "itado") {
        const nb = Math.max(2, Math.round((c - a) / 0.32));
        for (let k = 0; k < nb; k++) {
          on(s, a + ((k + 0.5) * (c - a)) / nb, (SILL + KAMOI) / 2, (c - a) / nb - 0.01, KAMOI - SILL, 0.03, 0.02 + (k % 2) * 0.014, HINOKI);
        }
        if (bay.kind === "boards") {
          on(s, cu, F0 + 1.9, c - a, 0.12, 0.08, 0.06, HINOKI);
        } else {
          // A shut boarded door: two leaves strapped in bronze, ring pulls, a frame.
          const lw = (c - a - 0.3) / 2;
          for (const e of [-1, 1]) {
            on(s, cu + e * (lw + 0.1), (SILL + KAMOI) / 2, 0.1, KAMOI - SILL, 0.08, 0.06, HINOKI);
            const lu = cu + (e * lw) / 2;
            for (const yf of [0.2, 0.5, 0.8]) on(s, lu, SILL + (KAMOI - SILL) * yf, lw - 0.1, 0.07, 0.02, 0.06, BRONZE);
            on(s, cu + e * 0.1, SILL + (KAMOI - SILL) * 0.42, 0.07, 0.14, 0.03, 0.065, BRONZE);
          }
          on(s, cu, (SILL + KAMOI) / 2, 0.03, KAMOI - SILL, 0.04, 0.05, SUMI);
        }
      } else {
        // An open doorway: its linings and its threshold.
        const [jx, jz] = at(s, 0, wallFace(s) - t / 2);
        const lining = (u: number, y: number, along: number, tall: number, hide = 0): void => {
          if (runsAlongX(s)) sb.box(along, tall, t + 0.03, u, y, jz, HINOKI, undefined, hide);
          else sb.box(t + 0.03, tall, along, jx, y, u, HINOKI, undefined, hide);
        };
        for (const u of [bay.a + 0.05, bay.c - 0.05]) lining(u, (F0 + KAMOI) / 2, 0.1, KAMOI - F0);
        lining((bay.a + bay.c) / 2, KAMOI + 0.01, bay.c - bay.a, 0.04);
        lining((bay.a + bay.c) / 2, F0 - 0.01, bay.c - bay.a, 0.05, HIDE_UNDER);
      }
    }

    // Over the plate the wall carries on up to the rafters, in plaster between the posts.
    for (const bay of bays[s]) {
      const topA = Math.min(underAt(s, bay.a, wallFace(s) + 0.02), underAt(s, bay.c, wallFace(s) + 0.02), underAt(s, (bay.a + bay.c) / 2, wallFace(s) + 0.02));
      if (topA - PLATE < 0.1) continue;
      on(s, (bay.a + bay.c) / 2, (PLATE + topA) / 2, bay.c - bay.a, topA - PLATE, 0.02, 0.01, SHIKKUI);
      for (const band of [PLATE + 1.2, PLATE + 2.4]) {
        if (band + 0.2 < topA) on(s, (bay.a + bay.c) / 2, band, bay.c - bay.a, 0.16, 0.08, 0.04, HINOKI);
      }
    }
    for (const u of pu) {
      const up = underAt(s, u, wallFace(s) + 0.02) + 0.04;
      if (up > PLATE + 0.1) on(s, u, (PLATE + up) / 2, 0.24, up - PLATE, 0.1, 0.05, HINOKI);
    }
  }

  // --- the hall's inner elevations -------------------------------------------------
  for (const s of SIDES) {
    const L = faceLen(s) - 2 * t;
    const lim = L / 2 - 0.08;
    for (const u of posts(s)) {
      if (Math.abs(u) < lim) inner(s, u, (F0 + CEIL) / 2, 0.22, CEIL - F0, 0.05, 0.025, HINOKI);
    }
    inner(s, 0, (KAMOI + NAGE) / 2, L, NAGE - KAMOI, 0.08, 0.04, HINOKI);
    inner(s, 0, (NAGE + CEIL) / 2, L, CEIL - NAGE, 0.01, 0.005, SHIKKUI);
    for (const bay of bays[s]) {
      const a = Math.max(bay.a + 0.11, -L / 2);
      const c = Math.min(bay.c - 0.11, L / 2);
      const cu = (a + c) / 2;
      if (bay.kind === "shoji") {
        inner(s, cu, (F0 + KICK) / 2, c - a, KICK - F0, 0.02, 0.01, HINOKI);
        inner(s, cu, KICK + 0.05, c - a, 0.1, 0.06, 0.03, HINOKI);
        inner(s, cu, (P0 + P1) / 2, c - a, P1 - P0, 0.01, 0.012, PAPER);
        inner(s, cu, (P1 + KAMOI) / 2, c - a, KAMOI - P1, 0.06, 0.03, HINOKI);
        sashes(s, a, c, -1);
      } else if (bay.kind !== "door") {
        inner(s, cu, (F0 + KAMOI) / 2, c - a, KAMOI - F0, 0.02, 0.01, HINOKI);
        for (const yr of [F0 + 0.9, F0 + 2.2]) inner(s, cu, yr, c - a, 0.1, 0.06, 0.03, HINOKI);
      } else {
        // The door's panelled leaves, folded back against the wall either side.
        const lw = (bay.c - bay.a) / 2 - 0.06;
        for (const e of [-1, 1]) {
          const edge = e < 0 ? bay.a - 0.06 : bay.c + 0.06;
          const lu = edge + (e * lw) / 2;
          if (Math.abs(lu) + lw / 2 > L / 2) continue;
          const y0 = F0 + 0.03;
          const y1 = KAMOI - 0.04;
          const mid = y0 + (y1 - y0) * 0.4;
          inner(s, lu, (y0 + y1) / 2, lw, y1 - y0, 0.03, 0.075, HINOKI);
          for (const f of [-1, 1]) inner(s, lu + f * (lw / 2 - 0.05), (y0 + y1) / 2, 0.1, y1 - y0, 0.05, 0.115, HINOKI);
          for (const yr of [y0 + 0.07, mid, y1 - 0.06]) inner(s, lu, yr, lw - 0.2, 0.12, 0.05, 0.115, HINOKI);
          const g0 = mid + 0.06;
          const g1 = y1 - 0.12;
          inner(s, lu, (g0 + g1) / 2, lw - 0.2, g1 - g0, 0.01, 0.095, SUMI);
          for (let k = 1; k < 4; k++) inner(s, lu - (lw - 0.2) / 2 + ((lw - 0.2) * k) / 4, (g0 + g1) / 2, 0.03, g1 - g0, 0.03, 0.11, HINOKI);
          for (let k = 1; k < 7; k++) inner(s, lu, g0 + ((g1 - g0) * k) / 7, lw - 0.2, 0.03, 0.03, 0.11, HINOKI);
          inner(s, lu - e * (lw / 2 - 0.16), mid - 0.3, 0.08, 0.08, 0.03, 0.15, BRONZE);
        }
      }
    }
  }

  // --- the coffered ceiling, the inner pillars' nageshi -----------------------------
  sb.box(IW, 0.03, ID, 0, CEIL + 0.015, 0, CEDAR, undefined, TOP);
  {
    const nx = Math.max(4, Math.round(IW / 0.9));
    const nz = Math.max(4, Math.round(ID / 0.9));
    for (let i = 1; i < nx; i++) sb.box(0.07, 0.08, ID, -IW / 2 + (i * IW) / nx, CEIL - 0.04, 0, SUMI, undefined, TOP);
    for (let i = 1; i < nz; i++) sb.box(IW, 0.08, 0.07, 0, CEIL - 0.04, -ID / 2 + (i * ID) / nz, SUMI, undefined, TOP);
    for (const e of [-1, 1]) {
      sb.box(IW, 0.16, 0.14, 0, CEIL - 0.08, e * (ID / 2 - 0.07), HINOKI, undefined, TOP);
      sb.box(0.14, 0.16, ID, e * (IW / 2 - 0.07), CEIL - 0.08, 0, HINOKI, undefined, TOP);
    }
    const ix = w * 0.22;
    const iz = d * 0.18;
    for (const e of [-1, 1]) {
      sb.box(2 * ix, 0.25, 0.14, 0, (KAMOI + NAGE) / 2, e * iz, HINOKI);
      sb.box(0.14, 0.25, 2 * iz, e * ix, (KAMOI + NAGE) / 2, 0, HINOKI);
      sb.box(2 * ix, 0.2, 0.12, 0, CEIL - 0.26, e * iz, HINOKI);
      sb.box(0.12, 0.2, 2 * iz, e * ix, CEIL - 0.26, 0, HINOKI);
    }
    for (const [sx, sz] of CORNERS) b.cyl(0.05, 0.72, 0.76, 10, sx * ix, F0 + 0.025, sz * iz, GRANITE_DARK);
  }

  // --- the altar: a Sumeru dais, the figures on it, what is laid before them -------
  const AT = F0 + 1.0;
  const zA = (AZ0 + AZ1) / 2;
  {
    // The dais's faces: front and ends. Its back is 0.6 m from the wall, in the dark.
    for (const s of ["-z", "-x", "+x"] as const) {
      const half = runsAlongX(s) ? AW : 1.1;
      const plane = runsAlongX(s) ? 1.1 : AW;
      const cz = runsAlongX(s) ? 0 : zA;
      const A = (u: number, y: number, along: number, tall: number, thick: number, out: number, color: string): void => {
        if (runsAlongX(s)) sb.box(along, tall, thick, u, y, zA - (plane + out), color, undefined, hideBack(s));
        else sb.box(thick, tall, along, outward(s) * (plane + out), y, cz + u, color, undefined, hideBack(s));
      };
      const L = 2 * half;
      A(0, F0 + 0.08, L + 0.12, 0.16, 0.1, 0.03, SUMI);
      A(0, F0 + 0.19, L + 0.06, 0.06, 0.08, 0.02, BRONZE);
      A(0, AT - 0.2, L + 0.06, 0.06, 0.08, 0.02, BRONZE);
      A(0, AT - 0.08, L + 0.16, 0.14, 0.12, 0.04, SUMI);
      A(0, AT + 0.02, L + 0.2, 0.06, 0.14, 0.05, BRONZE);
      // The waist: panels between posts, a gilt opening in each.
      const n = Math.max(2, Math.round(L / 0.8));
      for (let k = 0; k <= n; k++) A(-half + (k * L) / n, (F0 + 0.22 + AT - 0.23) / 2, 0.1, AT - 0.45 - F0, 0.04, 0.01, BRONZE);
      for (let k = 0; k < n; k++) {
        const u = -half + ((k + 0.5) * L) / n;
        const gw = L / n - 0.3;
        A(u, (F0 + AT) / 2, gw, 0.24, 0.02, 0.01, BRONZE);
        A(u, (F0 + AT) / 2, gw - 0.09, 0.15, 0.02, 0.02, SUMI);
        for (const e of [-1, 1]) A(u + e * (gw / 2 - 0.08), (F0 + AT) / 2 + 0.05, 0.05, 0.05, 0.02, 0.025, BRONZE);
      }
    }
    // The railing round its top, open in the middle of the front.
    const RY = AT + 0.05;
    const railRun = (a: Point3, c: Point3): void => {
      member([a[0], RY + 0.28, a[2]], [c[0], RY + 0.28, c[2]], 0.05, 0.05, SUMI);
      member([a[0], RY + 0.12, a[2]], [c[0], RY + 0.12, c[2]], 0.03, 0.03, SUMI);
      const len = Math.hypot(c[0] - a[0], c[2] - a[2]);
      const n = Math.max(1, Math.round(len / 0.5));
      for (let k = 0; k <= n; k++) {
        const f = k / n;
        const x = a[0] + (c[0] - a[0]) * f;
        const z = a[2] + (c[2] - a[2]) * f;
        sb.box(0.05, 0.3, 0.05, x, RY + 0.15, z, SUMI, undefined, HIDE_UNDER);
        if (k === 0 || k === n) sb.box(0.08, 0.06, 0.08, x, RY + 0.33, z, BRONZE, undefined, HIDE_UNDER);
      }
    };
    const rX = AW - 0.02;
    const rZ0 = AZ0 + 0.04;
    const rZ1 = AZ1 - 0.04;
    railRun([-rX, 0, rZ0], [-0.75, 0, rZ0]);
    railRun([0.75, 0, rZ0], [rX, 0, rZ0]);
    railRun([-rX, 0, rZ0], [-rX, 0, rZ1]);
    railRun([rX, 0, rZ0], [rX, 0, rZ1]);
    railRun([-rX, 0, rZ1], [rX, 0, rZ1]);
  }
  const y0 = AT + 0.04;
  sb.box(2 * AW + 0.1, 0.05, 2.3, 0, AT + 0.015, zA, SUMI);
  /** A lotus pedestal of `r` at (x, z) from `yb`: a base, a waist, two rows of petals and a seat. Returns the seat. */
  const lotus = (x: number, z: number, yb: number, r: number, petals: number): number => {
    b.cyl(0.16 * r, 1.3 * r, 1.4 * r, 8, x, yb + 0.08 * r, z, SUMI);
    b.cyl(0.24 * r, 0.8 * r, 1.05 * r, 8, x, yb + 0.28 * r, z, BRONZE);
    b.cyl(0.16 * r, 1.45 * r, 0.9 * r, 16, x, yb + 0.48 * r, z, BRONZE);
    for (const [row, rr, yy] of [
      [0, 0.64, 0.5],
      [1, 0.54, 0.64],
    ] as const) {
      for (let k = 0; k < petals; k++) {
        const ang = ((k + row * 0.5) / petals) * Math.PI * 2;
        sb.box(0.34 * r, 0.26 * r, 0.04, x + Math.sin(ang) * rr * r, yb + yy * r, z + Math.cos(ang) * rr * r, BRONZE, { x: 0.5, y: ang });
      }
    }
    b.cyl(0.06 * r, 1.1 * r, 1.1 * r, 16, x, yb + 0.76 * r, z, BRONZE);
    return yb + 0.79 * r;
  };
  {
    // The seated Buddha, on a lotus, before a mandorla and a halo.
    const zB = zA + 0.25;
    const ys = lotus(0, zB, y0, 1, 16);
    // Crossed legs, a torso broader at the shoulders than the waist, the robe
    // over the shoulders, the arms down to the hands in the lap, a round head.
    b.cyl(0.34, 1.1, 1.18, 12, 0, ys + 0.17, zB, BRONZE).scaling.z = 0.74;
    b.cyl(0.6, 0.66, 0.52, 10, 0, ys + 0.64, zB + 0.08, BRONZE).scaling.z = 0.6;
    b.cyl(0.2, 0.3, 0.72, 10, 0, ys + 1.03, zB + 0.08, BRONZE).scaling.z = 0.6;
    for (const e of [-1, 1]) {
      const sh: Point3 = [e * 0.3, ys + 0.9, zB + 0.08];
      const el: Point3 = [e * 0.42, ys + 0.56, zB - 0.02];
      const hd: Point3 = [e * 0.1, ys + 0.42, zB - 0.22];
      limb(b, sh, el, 0.2, 0.17, BRONZE, 6);
      limb(b, el, hd, 0.16, 0.12, BRONZE, 6);
      sb.box(0.05, 0.2, 0.09, e * 0.165, ys + 1.3, zB + 0.06, BRONZE);
    }
    sb.box(0.3, 0.08, 0.18, 0, ys + 0.42, zB - 0.24, BRONZE);
    b.cyl(0.12, 0.17, 0.2, 8, 0, ys + 1.16, zB + 0.07, BRONZE);
    b.cyl(0.18, 0.33, 0.22, 10, 0, ys + 1.3, zB + 0.05, BRONZE);
    b.cyl(0.16, 0.24, 0.33, 10, 0, ys + 1.47, zB + 0.05, BRONZE);
    b.cyl(0.12, 0.1, 0.2, 8, 0, ys + 1.61, zB + 0.05, BRONZE);
    // The mandorla ringed in bronze, and the halo before it ringed the same way.
    b.cyl(0.03, 1.86, 1.86, 20, 0, ys + 1.0, zB + 0.62, BRONZE, { x: Math.PI / 2 }).scaling.z = 1.3;
    glowDisc(1.7, 0, ys + 1.0, zB + 0.58, 1.3);
    b.cyl(0.03, 0.98, 0.98, 20, 0, ys + 1.42, zB + 0.5, BRONZE, { x: Math.PI / 2 });
    glowDisc(0.86, 0, ys + 1.42, zB + 0.47);
    // The attendants, standing on smaller lotuses either side.
    for (const e of [-1, 1]) {
      const x = e * (AW - 0.95);
      const z = zB + 0.15;
      const ya = lotus(x, z, y0, 0.5, 12);
      // A robe falling to the feet, shoulders over it, the hands together.
      b.cyl(1.0, 0.34, 0.48, 10, x, ya + 0.5, z, BRONZE).scaling.z = 0.8;
      b.cyl(0.46, 0.44, 0.32, 10, x, ya + 1.22, z, BRONZE).scaling.z = 0.7;
      for (const f of [-1, 1]) {
        limb(b, [x + f * 0.19, ya + 1.36, z], [x + f * 0.22, ya + 1.08, z - 0.1], 0.11, 0.1, BRONZE, 5);
        limb(b, [x + f * 0.22, ya + 1.08, z - 0.1], [x + f * 0.02, ya + 1.2, z - 0.22], 0.1, 0.08, BRONZE, 5);
      }
      sb.box(0.06, 0.18, 0.08, x, ya + 1.26, z - 0.24, BRONZE);
      b.cyl(0.08, 0.1, 0.12, 8, x, ya + 1.49, z, BRONZE);
      b.cyl(0.14, 0.2, 0.15, 8, x, ya + 1.6, z, BRONZE);
      b.cyl(0.12, 0.15, 0.21, 8, x, ya + 1.73, z, BRONZE);
      b.cyl(0.14, 0.12, 0.18, 8, x, ya + 1.86, z, BRONZE);
      b.cyl(0.03, 0.6, 0.6, 16, x, ya + 1.7, z + 0.3, BRONZE, { x: Math.PI / 2 });
      glowDisc(0.52, x, ya + 1.7, z + 0.27);
    }
    // The canopy over the Buddha, hung from the ceiling on four rods.
    const cy = CEIL - 0.7;
    const cr = 1.0;
    for (const e of [-1, 1]) {
      sb.box(2 * cr, 0.14, 0.08, 0, cy, zB + e * cr, BRONZE);
      sb.box(0.08, 0.14, 2 * cr, e * cr, cy, zB, BRONZE);
    }
    sb.box(2 * cr, 0.03, 2 * cr, 0, cy + 0.08, zB, BRONZE, undefined, TOP);
    for (const [sx, sz] of CORNERS) {
      sb.box(0.02, CEIL - cy - 0.08, 0.02, sx * (cr - 0.1), (CEIL + cy + 0.08) / 2, zB + sz * (cr - 0.1), SUMI);
      sb.box(0.1, 0.1, 0.1, sx * cr, cy - 0.1, zB + sz * cr, BRONZE, { y: Math.PI / 4 });
    }
    const ns = 9;
    for (let k = 0; k < ns; k++) {
      const u = -cr + 0.1 + ((2 * cr - 0.2) * (k + 0.5)) / ns;
      const len = 0.28 + (k % 2) * 0.12;
      for (const e of [-1, 1]) {
        sb.box(0.02, len, 0.02, u, cy - 0.07 - len / 2, zB + e * (cr + 0.05), BRONZE);
        sb.box(0.02, len, 0.02, e * (cr + 0.05), cy - 0.07 - len / 2, zB + u, BRONZE);
      }
    }
  }
  {
    // Laid on the dais's front edge: candles, the incense burner, lotus vases.
    const zo = AZ0 + 0.35;
    b.cyl(0.16, 0.34, 0.26, 10, 0, y0 + 0.12, zo, BRONZE);
    b.cyl(0.08, 0.3, 0.34, 10, 0, y0 + 0.24, zo, BRONZE);
    b.cyl(0.06, 0.04, 0.1, 6, 0, y0 + 0.31, zo, BRONZE);
    for (const e of [-1, 1]) {
      const x = e * 0.95;
      b.cyl(0.05, 0.26, 0.26, 8, x, y0 + 0.025, zo, BRONZE);
      b.cyl(0.46, 0.05, 0.06, 6, x, y0 + 0.28, zo, BRONZE);
      b.cyl(0.03, 0.18, 0.18, 8, x, y0 + 0.52, zo, BRONZE);
      b.cyl(0.16, 0.05, 0.05, 6, x, y0 + 0.62, zo, PAPER);
      b.glow(0.04, 0.08, 0.04, x, y0 + 0.74, zo, SHOJI_GLOW);
      const vx = e * 1.65;
      b.cyl(0.3, 0.12, 0.22, 8, vx, y0 + 0.15, zo, BRONZE);
      limb(b, [vx, y0 + 0.28, zo], [vx + e * 0.05, y0 + 0.78, zo], 0.02, 0.015, BRONZE, 4);
      b.cyl(0.02, 0.3, 0.3, 10, vx + e * 0.12, y0 + 0.58, zo, BRONZE, { z: -e * 0.4 });
      b.cyl(0.02, 0.24, 0.24, 10, vx - e * 0.1, y0 + 0.5, zo, BRONZE, { z: e * 0.5 });
      b.cyl(0.16, 0.02, 0.1, 8, vx + e * 0.05, y0 + 0.86, zo, BRONZE);
    }
    // Before it on the floor: a sutra desk with a book on it, a bowl on a cushion and a drum on another.
    const zf = AZ0 - 0.9;
    sb.box(0.9, 0.04, 0.4, 0, F0 + 0.26, zf, SUMI);
    for (const e of [-1, 1]) sb.box(0.06, 0.24, 0.36, e * 0.4, F0 + 0.12, zf, SUMI, undefined, HIDE_UNDER);
    sb.box(0.3, 0.04, 0.22, 0.05, F0 + 0.3, zf, PAPER, { y: 0.1 });
    sb.box(0.56, 0.06, 0.56, 0, F0 + 0.03, zf - 0.75, NOREN, { y: 0.05 }, HIDE_UNDER);
    for (const e of [-1, 1]) sb.box(0.5, 0.08, 0.5, e * 1.0, F0 + 0.04, zf, NOREN, { y: e * 0.2 }, HIDE_UNDER);
    b.cyl(0.22, 0.44, 0.3, 12, 1.0, F0 + 0.19, zf, BRONZE);
    b.cyl(0.3, 0.3, 0.36, 10, -1.0, F0 + 0.23, zf, HINOKI, { z: Math.PI / 2 });
    sb.box(0.04, 0.02, 0.3, -1.0, F0 + 0.1, zf - 0.28, HINOKI, { y: 0.4 });
  }

  // --- the veranda: the pillar line's timbers and its bracket sets ------------------
  for (const s of SIDES) {
    const N = lineN(s);
    const us = runsAlongX(s)
      ? Array.from({ length: colsX + 1 }, (_, i) => -px + (i / colsX) * px * 2)
      : Array.from({ length: colsZ + 1 }, (_, i) => -pz + (i / colsZ) * pz * 2);
    const half = runsAlongX(s) ? px : pz;
    const NG = N + 0.55;
    // The head tie through the pillars, its ends run on past the corners.
    onLine(s, N, 0, (KN0 + KN1) / 2, 2 * half + 1.0, KN1 - KN0, 0.22, HINOKI);
    for (const e of [-1, 1]) onLine(s, N, e * (half + 0.42), KN0 - 0.04, 0.16, 0.08, 0.2, HINOKI, 0, TOP);
    // The plate along the pillar line, and the eave purlin one step out, swept with the eave.
    onLine(s, N, 0, (MAK + PL1) / 2, 2 * half + 0.9, PL1 - MAK, 0.2, HINOKI);
    const LG = half + 0.55 + 0.3;
    const gTop = (u: number): number => underAt(s, u, NG);
    const NS = 8;
    for (let i = 0; i < NS; i++) {
      const ua = -LG + (2 * LG * i) / NS;
      const uc = -LG + (2 * LG * (i + 1)) / NS;
      const [xa, za] = at(s, ua, NG);
      const [xc, zc] = at(s, uc, NG);
      member([xa, gTop(ua) - 0.11, za], [xc, gTop(uc) - 0.11, zc], 0.2, 0.22, HINOKI, (i > 0 ? START : 0) | (i < NS - 1 ? END : 0));
    }
    // White plaster up to the rafters over the plate, bay by bay.
    for (let i = 0; i + 1 < us.length; i++) {
      const ua = us[i] + 0.1;
      const uc = us[i + 1] - 0.1;
      const topK = Math.min(underAt(s, ua, N), underAt(s, uc, N), underAt(s, (ua + uc) / 2, N)) - 0.005;
      if (topK - PL1 > 0.05) onLine(s, N, (ua + uc) / 2, (PL1 + topK) / 2, uc - ua, topK - PL1, 0.06, SHIKKUI);
    }
    us.forEach((u, i) => {
      const corner = i === 0 || i === us.length - 1;
      // The bearing block, the arm along the tie with its small blocks, and the arm out.
      if (runsAlongX(s) || !corner) {
        const [x, z] = at(s, u, N);
        sb.box(0.5, DAI - beamY, 0.5, x, (beamY + DAI) / 2, z, HINOKI);
        sb.box(0.36, 0.06, 0.36, x, beamY - 0.03, z, HINOKI, undefined, TOP);
      }
      onLine(s, N, u, (DAI + ARM) / 2, 1.3, ARM - DAI, 0.2, HINOKI);
      for (const du of [-0.5, 0, 0.5]) onLine(s, N, u + du, (ARM + MAK) / 2, 0.24, MAK - ARM, 0.24, HINOKI, 0, TOP);
      if (!corner) {
        const [xa, za] = at(s, u, N - 0.4);
        const [xc, zc] = at(s, u, N + 0.72);
        member([xa, (DAI + ARM) / 2, za], [xc, (DAI + ARM) / 2, zc], 0.2, ARM - DAI, HINOKI);
        const [bx, bz] = at(s, u, NG);
        const bTop = gTop(u) - 0.22;
        sb.box(0.24, bTop - ARM, 0.24, bx, (ARM + bTop) / 2, bz, HINOKI, undefined, TOP);
      } else {
        // At a corner the arm along runs on out under the next side's purlin.
        const next: Side = runsAlongX(s) ? (u < 0 ? "-x" : "+x") : u < 0 ? "-z" : "+z";
        const bTop = underAt(next, outward(s) * N, lineN(next) + 0.55) - 0.22;
        const [bx, bz] = at(s, u + Math.sign(u) * 0.55, N);
        sb.box(0.24, bTop - ARM, 0.24, bx, (ARM + bTop) / 2, bz, HINOKI, undefined, TOP);
      }
    });
    // A frog-leg strut in every bay, a small block on it under the plate.
    for (let i = 0; i + 1 < us.length; i++) {
      const um = (us[i] + us[i + 1]) / 2;
      for (const e of [-1, 1]) onLine(s, N, um + e * 0.2, (KN1 + ARM) / 2 - 0.04, 0.09, 0.48, 0.14, HINOKI, e * 0.62);
      onLine(s, N, um, KN1 + 0.05, 0.62, 0.1, 0.16, HINOKI, 0, TOP);
      onLine(s, N, um, ARM - 0.06, 0.34, 0.12, 0.18, HINOKI);
      onLine(s, N, um, (ARM + MAK) / 2, 0.24, MAK - ARM, 0.24, HINOKI, 0, TOP);
    }
    // A cambered tie in from every pillar that faces the hall's wall.
    const wHalf = faceLen(s) / 2;
    for (const u of us) {
      if (Math.abs(u) > wHalf - 0.15) continue;
      const yT = PLATE + 0.17;
      const [xa, za] = at(s, u, N - 0.1);
      const [xm, zm] = at(s, u, (N + wallFace(s)) / 2);
      const [xc, zc] = at(s, u, wallFace(s) + 0.12);
      member([xa, yT, za], [xm, yT + 0.07, zm], 0.22, 0.34, HINOKI, END);
      member([xm, yT + 0.07, zm], [xc, yT, zc], 0.22, 0.34, HINOKI, START);
    }
  }
  // The pillars' own drawing: the round shafts and their granite bases.
  for (const [x, z] of pillars) {
    b.cyl(pillarH, 0.46, 0.5, 10, x, plinthH + pillarH / 2, z, HINOKI);
    b.cyl(0.2, 0.75, 0.8, 8, x, plinthH + 0.1, z, GRANITE_DARK);
  }

  // --- the eave: rafters in two layers, the hip beams, the wind bells ---------------
  for (const s of SIDES) {
    const along = runsAlongX(s) ? ex : ez;
    const nEave = runsAlongX(s) ? ez : ex;
    const halfW = faceLen(s) / 2;
    const N = lineN(s);
    const nB = N + 0.95;
    const nF = N + 0.75;
    const SP = 0.36;
    const K = Math.floor((along - 0.15) / SP);
    for (let k = -K; k <= K; k++) {
      const u = k * SP;
      const hip = nHip(s, u) + 0.12;
      const n0 = Math.abs(u) <= halfW - 0.06 ? Math.max(wallFace(s) + 0.02, hip) : hip;
      const lay = (na: number, nc: number, wide: number, deep: number, cap: string | null): void => {
        if (nc - na < 0.15) return;
        const [xa, za] = at(s, u, na);
        const [xc, zc] = at(s, u, nc);
        const a: Point3 = [xa, soffit(xa, za) - deep / 2, za];
        const c: Point3 = [xc, soffit(xc, zc) - deep / 2, zc];
        member(a, c, wide, deep, HINOKI, TOP | START);
        if (cap) endFace(a, c, wide + 0.01, deep + 0.01, cap);
      };
      lay(n0, nB, 0.12, RB, null);
      lay(Math.max(nF, n0), nEave - 0.04, 0.1, RF, BRONZE);
    }
  }
  {
    const fW = Math.max(0, (w / 2 - rx) / (ex - rx));
    CORNERS.forEach(([sx, sz]) => {
      const H = (f: number, deep: number): Point3 => {
        const x = sx * (rx + f * (ex - rx));
        const z = sz * f * ez;
        return [x, soffit(x, z) - deep / 2, z];
      };
      member(H(fW, 0.34), H(0.82, 0.34), 0.3, 0.34, HINOKI, TOP | START);
      const a = H(0.74, 0.26);
      const c = H(0.995, 0.26);
      member(a, c, 0.24, 0.26, HINOKI, TOP | START);
      endFace(a, c, 0.26, 0.28, BRONZE);
      const [bx, by0, bz] = c;
      const by = by0 - 0.13;
      sb.box(0.03, 0.18, 0.03, bx, by - 0.09, bz, BRONZE);
      b.cyl(0.34, 0.15, 0.26, 8, bx, by - 0.35, bz, BRONZE);
      sb.box(0.02, 0.18, 0.02, bx, by - 0.61, bz, BRONZE);
      sb.box(0.15, 0.24, 0.012, bx, by - 0.82, bz, BRONZE, { y: Math.atan2(sx, sz) + Math.PI / 2 });
    });
  }

  // --- the front: the plaque, the curtain, the gong; the lanterns in the veranda -----
  {
    // The plaque hung from the eave purlin over the middle door: a frame, a
    // black ground and three characters in bronze.
    const pzP = -(pz + 0.8);
    const PWd = 1.9;
    const PHt = 0.78;
    const gBot = underAt("-z", 0, pz + 0.55) - 0.22;
    const pyC = gBot - 0.03 - PHt / 2;
    for (const e of [-1, 1]) sb.box(0.05, 0.08, 0.3, e * 0.6, gBot - 0.03, -(pz + 0.68), BRONZE);
    sb.box(PWd - 0.1, PHt - 0.1, 0.05, 0, pyC, pzP, SUMI);
    for (const e of [-1, 1]) {
      sb.box(PWd, 0.09, 0.09, 0, pyC + e * (PHt / 2 - 0.045), pzP - 0.02, HINOKI);
      sb.box(0.09, PHt, 0.09, e * (PWd / 2 - 0.045), pyC, pzP - 0.02, HINOKI);
    }
    for (let g = 0; g < 3; g++) {
      const gx = (g - 1) * 0.56;
      for (let k = 0; k < 6; k++) {
        const horiz = rnd() < 0.5;
        const len = 0.14 + rnd() * 0.28;
        const x = gx + (rnd() - 0.5) * (horiz ? 0.2 : 0.34);
        const y = pyC + (rnd() - 0.5) * (horiz ? 0.4 : 0.2);
        sb.box(horiz ? len : 0.045, horiz ? 0.045 : len, 0.02, x, y, pzP - 0.035, BRONZE, { z: (rnd() - 0.5) * 0.5 });
      }
    }
    // The curtain along the front under the head tie, the temple's mark in each bay.
    const cz = -(pz + 0.28);
    const cyC = KN0 - 0.3;
    b.translucentBox(2 * px + 0.5, 0.58, 0.02, 0, cyC, cz, NOREN, TRANSLUCENCY.awning);
    sb.box(2 * px + 0.7, 0.04, 0.04, 0, KN0 - 0.02, cz, SUMI);
    for (let i = 0; i < colsX; i++) {
      const bx = -px + ((i + 0.5) / colsX) * px * 2;
      const r = 0.17;
      for (const [sx, sy] of CORNERS) sb.box(r * Math.SQRT2 + 0.03, 0.045, 0.012, bx + (sx * r) / 2, cyC + (sy * r) / 2, cz - 0.017, PAPER, { z: (-sx * sy * Math.PI) / 4 });
      sb.box(0.06, 0.06, 0.012, bx, cyC, cz - 0.017, PAPER, { z: Math.PI / 4 });
    }
    // The gong before the middle door on a bronze arm, and the rope to ring it by.
    const gz = -(pz + 0.5);
    const gy = KN0 - 0.95;
    sb.box(0.05, 0.05, 0.42, 0, KN0 + 0.1, -(pz + 0.3), BRONZE);
    for (const e of [-1, 1]) sb.box(0.02, KN0 + 0.08 - (gy + 0.4), 0.02, e * 0.18, (KN0 + 0.08 + gy + 0.4) / 2, gz, SUMI);
    b.cyl(0.24, 0.88, 0.88, 16, 0, gy, gz, BRONZE, { x: Math.PI / 2 });
    b.cyl(0.26, 0.3, 0.3, 12, 0, gy, gz, BRONZE, { x: Math.PI / 2 });
    sb.box(0.7, 0.05, 0.03, 0, gy - 0.15, gz - 0.13, SUMI);
    rope(
      b,
      [
        [0, gy - 0.46, gz - 0.06],
        [0.03, gy - 1.6, gz - 0.1],
        [-0.02, gy - 2.7, gz - 0.12],
        [0.02, F0 + 1.05, gz - 0.14],
      ],
      0.08,
      0.07,
      KAYA,
      6,
    );
    for (const e of [-1, 1]) b.translucentBox(0.1, 0.9, 0.012, e * 0.07, F0 + 1.4, gz - 0.2, NOREN, TRANSLUCENCY.awning);
    // Bronze lanterns hung in the veranda, two at the front and at the back on most.
    const lanternAt = (lx: number, lz: number): void => {
      const hy = soffit(lx, lz);
      const cy = PLATE - 0.4;
      sb.box(0.02, hy - (cy + 0.5), 0.02, lx, (hy + cy + 0.5) / 2, lz, BRONZE);
      b.cyl(0.18, 0.12, 0.66, 6, lx, cy + 0.44, lz, BRONZE);
      b.cyl(0.06, 0.46, 0.46, 6, lx, cy - 0.3, lz, BRONZE);
      b.cyl(0.14, 0.24, 0.42, 6, lx, cy - 0.4, lz, BRONZE);
      for (let k = 0; k < 6; k++) {
        const ang = (k / 6) * Math.PI * 2;
        sb.box(0.04, 0.6, 0.04, lx + Math.sin(ang) * 0.22, cy + 0.02, lz + Math.cos(ang) * 0.22, BRONZE);
      }
      for (const dy of [-0.18, 0.2]) b.cyl(0.03, 0.47, 0.47, 6, lx, cy + dy, lz, BRONZE);
      if (lit) b.glow(0.3, 0.52, 0.3, lx, cy + 0.02, lz, SHOJI_GLOW);
      else b.cyl(0.52, 0.34, 0.34, 6, lx, cy + 0.02, lz, PAPER);
    };
    // In the bay nearest a quarter of the way along the front, either side.
    let lx = 0;
    for (let i = 0; i < colsX; i++) {
      const c = Math.abs(-px + ((i + 0.5) / colsX) * px * 2);
      if (Math.abs(c - w / 4) < Math.abs(lx - w / 4)) lx = c;
    }
    for (const e of [-1, 1]) {
      const x = e * lx;
      lanternAt(x, -(pz - 0.55));
      if (backLanterns) lanternAt(x, pz - 0.55);
    }
  }

  // --- the tiles: round-tile rows, end tiles, the ridges and demon tiles ------------
  {
    const RSP = 0.5;
    const RH = 0.13;
    const segLen = 1.0;
    const topAt = (x: number, z: number): number => roofHeight(roof, x, z);
    const row = (s: Side, u: number, n0: number, n1: number): void => {
      if (n1 - n0 < 0.2) return;
      const segs = Math.max(1, Math.ceil((n1 - n0) / segLen));
      for (let j = 0; j < segs; j++) {
        const na = n0 + ((n1 - n0) * j) / segs - (j > 0 ? 0.03 : 0);
        const nb = n0 + ((n1 - n0) * (j + 1)) / segs + (j < segs - 1 ? 0.03 : 0);
        const [xa, za] = at(s, u, na);
        const [xc, zc] = at(s, u, nb);
        const a: Point3 = [xa, topAt(xa, za) + RH / 2 - 0.025, za];
        const c: Point3 = [xc, topAt(xc, zc) + RH / 2 - 0.025, zc];
        const last = j === segs - 1;
        member(a, c, 0.17, RH, KAWARA_DARK, HIDE_UNDER | START | (last ? 0 : END));
        if (last) endFace(a, c, 0.19, 0.19, KAWARA_DARK);
      }
    };
    // The eave tiles' lip along every eave, swept up with the corners.
    for (const s of SIDES) {
      const half = runsAlongX(s) ? ex : ez;
      const nEave = runsAlongX(s) ? ez : ex;
      const NL = 16;
      const pt = (i: number): Point3 => {
        const [x, z] = at(s, -half + (2 * half * i) / NL, nEave);
        return [x, topAt(x, z) - 0.02, z];
      };
      for (let i = 0; i < NL; i++) member(pt(i), pt(i + 1), 0.06, 0.12, KAWARA_DARK, (i > 0 ? START : 0) | (i < NL - 1 ? END : 0));
    }
    for (const s of SIDES) {
      const along = runsAlongX(s) ? ex : ez;
      const nEave = runsAlongX(s) ? ez : ex;
      const K = Math.floor((along - 0.3) / RSP - 0.5);
      for (let k = -K - 1; k <= K; k++) {
        const u = (k + 0.5) * RSP;
        const n0 = runsAlongX(s) && Math.abs(u) <= rx - 0.1 ? 0.36 : nHip(s, u) + 0.2;
        row(s, u, n0, nEave + 0.02);
      }
    }
    // The main ridge: a base, courses banded in white, a round cap, a demon tile each end.
    const RL = 2 * rx + 0.7;
    const ry0 = eave + RISE - 0.06;
    sb.box(RL, 0.36, 0.86, 0, ry0 - 0.12, 0, KAWARA_DARK, undefined, HIDE_UNDER);
    let ridgeY = ry0 + 0.06;
    for (let i = 0; i < 4; i++) {
      const depth = 0.78 - i * 0.07;
      sb.box(RL, 0.11, depth, 0, ridgeY + 0.055, 0, KAWARA_DARK, undefined, HIDE_UNDER);
      ridgeY += 0.11;
      if (i < 3) {
        sb.box(RL - 0.05, 0.035, depth - 0.06, 0, ridgeY + 0.0175, 0, SHIKKUI, undefined, HIDE_UNDER);
        ridgeY += 0.035;
      }
    }
    b.cyl(RL, 0.4, 0.4, 8, 0, ridgeY + 0.12, 0, KAWARA_DARK, { z: Math.PI / 2 });
    /** A demon tile of scale `k` standing at `p0`, turned to `yaw`. */
    const oni = (p0: Point3, yaw: number, k: number): void => {
      sb.box(0.5 * k, 0.6 * k, 0.14 * k, p0[0], p0[1] + 0.3 * k, p0[2], KAWARA_DARK, { y: yaw });
      sb.box(0.34 * k, 0.32 * k, 0.22 * k, p0[0], p0[1] + 0.3 * k, p0[2], KAWARA_DARK, { y: yaw });
      sb.box(0.16 * k, 0.16 * k, 0.12 * k, p0[0], p0[1] + 0.66 * k, p0[2], KAWARA_DARK, { y: yaw, z: Math.PI / 4 });
      for (const e of [-1, 1]) {
        const c = Math.cos(yaw);
        const sn = Math.sin(yaw);
        sb.box(0.1 * k, 0.3 * k, 0.1 * k, p0[0] + e * 0.2 * k * c, p0[1] + 0.68 * k, p0[2] - e * 0.2 * k * sn, KAWARA_DARK, { y: yaw, z: -e * 0.35 });
      }
    };
    for (const sx of [-1, 1]) {
      oni([sx * (RL / 2 + 0.04), ry0 - 0.2, 0], Math.PI / 2, 1.9);
      sb.box(0.3, 0.3, 0.3, sx * (RL / 2 - 0.2), ridgeY + 0.35, 0, KAWARA_DARK, { y: Math.PI / 4 });
    }
    /** A ridge from `a` to `c`: a body, a white band and a cap. */
    const ridgeRun = (a: Point3, c: Point3): void => {
      const up = (p0: Point3, dy: number): Point3 => [p0[0], p0[1] + dy, p0[2]];
      member(up(a, 0.13), up(c, 0.13), 0.44, 0.3, KAWARA_DARK, HIDE_UNDER | START | END);
      member(up(a, 0.12), up(c, 0.12), 0.48, 0.035, SHIKKUI, START | END | TOP | HIDE_UNDER);
      member(up(a, 0.34), up(c, 0.34), 0.26, 0.14, KAWARA_DARK, HIDE_UNDER | START | END);
    };
    for (const [sx, sz] of CORNERS) {
      const Hp = (f: number, lift: number): Point3 => {
        const x = sx * (rx + f * (ex - rx));
        const z = sz * f * ez;
        return [x, topAt(x, z) + lift, z];
      };
      const f0 = 0.05;
      const fOni = 1 - 1.0 / Math.hypot(ex - rx, ez);
      const nr = 6;
      for (let j = 0; j < nr; j++) ridgeRun(Hp(f0 + ((fOni - f0) * j) / nr, 0), Hp(f0 + ((fOni - f0) * (j + 1)) / nr, 0));
      oni(Hp(fOni + 0.01, 0), Math.atan2(sx * (ex - rx), sz * ez), 1.3);
      const a = Hp(fOni + 0.02, 0.08);
      const c = Hp(1.0, 0.08);
      member(a, c, 0.26, 0.2, KAWARA_DARK, HIDE_UNDER | START);
      endFace(a, c, 0.28, 0.24, KAWARA_DARK);
    }
  }

  sb.flush(b);

  // --- the cores, emitted after what hides them ------------------------------------
  for (const [cx, len, open] of segs) {
    if (open) b.box(len, wallH - doorH, t, cx, plinthH + doorH + (wallH - doorH) / 2, fz, SUMI);
    else b.box(len, wallH, t, cx, wy, fz, SUMI);
  }
  b.box(w, wallH, t, 0, wy, d / 2 - t / 2, SUMI);
  for (const sx of [-1, 1] as const) {
    const x = sx * (w / 2 - t / 2);
    for (const sz of [-1, 1]) b.box(t, wallH, side, x, wy, sz * (1.2 + side / 2), SUMI);
    b.box(t, wallH - doorH, 2.4, x, plinthH + doorH + (wallH - doorH) / 2, 0, SUMI);
  }
  // The walls over the plate, up into the roof: one surface, cut to the soffit.
  {
    const m = new Mesher();
    for (const s of SIDES) {
      const L = faceLen(s);
      const nP = Math.max(4, Math.round(L / 0.6));
      const P = (u: number, n: number, y: number): V3 => {
        const [x, z] = at(s, u, n);
        return [x, y, z];
      };
      const hTop = (u: number): number => {
        const [x, z] = at(s, u, wallFace(s) - t / 2);
        return soffit(x, z) + 0.12;
      };
      const out: V3 = runsAlongX(s) ? [0, 0, outward(s)] : [outward(s), 0, 0];
      const back: V3 = [-out[0], 0, -out[2]];
      for (let i = 0; i < nP; i++) {
        const ua = -L / 2 + (L * i) / nP;
        const uc = -L / 2 + (L * (i + 1)) / nP;
        const o = wallFace(s);
        const n = wallFace(s) - t;
        m.quad(P(ua, o, top), P(uc, o, top), P(uc, o, hTop(uc)), P(ua, o, hTop(ua)), out);
        m.quad(P(ua, n, top), P(uc, n, top), P(uc, n, hTop(uc)), P(ua, n, hTop(ua)), back);
        m.quad(P(ua, n, hTop(ua)), P(uc, n, hTop(uc)), P(uc, o, hTop(uc)), P(ua, o, hTop(ua)), [0, 1, 0]);
      }
    }
    b.surface(m.data(), SUMI);
  }
  b.box(w * 0.4, 1.0, 2.2, 0, plinthH + 0.5, d / 2 - 2.0, SUMI);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) b.cyl(wallH, 0.5, 0.52, 10, sx * w * 0.22, wy, sz * d * 0.18, HINOKI);
  }
  b.box(pw - 0.02, F0 - 0.05 - foot, pd - 0.02, 0, (F0 - 0.05 + foot) / 2, 0, GRANITE_DARK);

  // --- the roof: the lining under the rafters, then the sheet ---------------------------
  curvedRoof(b, CEDAR, { ...roof, raise: -TH - 0.004, thick: 0.02 });
  curvedRoof(b, KAWARA, roof);
  b.light("#ffb45a", 14, 1.2, 0.08, 0, plinthH + 2.6, d / 2 - 3.2);
  return b;
}
