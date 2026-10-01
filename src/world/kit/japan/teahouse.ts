/**
 * kit/japan/teahouse.ts — buildTeahouse: the sukiya teahouse on its engawa.
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
import { KURA_CRESTS } from "./kura";
import {
  BRONZE,
  CEDAR,
  GRANITE,
  GRANITE_DARK,
  HINOKI,
  KAKI,
  KAWARA,
  KAWARA_DARK,
  KAYA,
  NOREN,
  PAPER,
  SHIKKUI,
  SHOJI_GLOW,
  SUMI,
  TRANSLUCENCY,
  TSUCHI,
} from "./palette";
import { curvedRoof, roofHeight, type RoofSpec } from "./roof";

/**
 * A TEAHOUSE: the sukiya-style teahouse of an Edo hot-spring inn — a paper
 * room on a raised engawa, under a tiled hip-and-gable roof whose eaves are
 * wide enough to stand under. The reference frame's hall on the right is this
 * building: every wall a lattice of glowing paper.
 *
 * The deck is walked at 0.55 — inside `stepHeight`, so it is stepped onto from
 * anywhere and the veranda is somewhere to fight from. The room is enterable
 * by one door on the front; its walls are paper and are drawn as paper, but
 * they are WALLS to a body and a round, because a room whose four sides stop
 * nothing is a gazebo. `lit` spends one light slot inside.
 *
 * **It was a box of glowing grids on a plank slab under one smooth grey
 * sheet**: a square lattice of big panes on every face, a slotted block for a
 * ridge, four sticks holding the eave up, and nothing inside at all. What
 * makes a sukiya teahouse one is that its FRAME is its ornament, so that is
 * where this spends its vertices:
 *
 * - **The elevations are bays between cypress posts**, on a sill, under a
 *   head rail and a plate: shoji in two lapped tracks over board kick panels,
 *   a low lattice transom over the front and back, and a plaster band under
 *   the eave. One bay of the back is earthen plaster — the tokonoma is behind
 *   it — and the middle bay of each end is plaster with a window in it: a
 *   ROUND window with a bamboo lattice on one end, and on the other the tea
 *   room's own window, a SHITAJI-MADO of bare reeds where the plaster was left
 *   off the lath.
 * - **The roof is a HIP-AND-GABLE (irimoya)**, the hip kept exactly as it was
 *   and a gable standing on it where the third ring of five meets the hips:
 *   the verge carried out over it as the z-faces' own slope, a tympanum of
 *   lattice or of plaster and timber under it, a barge board with a hanging
 *   ornament at its apex. Round-tile rows with end tiles down every face,
 *   a banded ridge with demon tiles, the gable's descending ridges and the
 *   four hip ridges each ending on a demon tile.
 * - **The eaves are CARRIED**: rafters over a board lining from the plate to
 *   the eave, a hip beam into each corner, a purlin swept up with the eave on
 *   the four veranda posts, and a tie from every wall post out to it.
 * - **The engawa** is boards laid along each side inside an edge beam, over a
 *   dark underfloor on short posts on stones cut to the ground, with a stone
 *   to step up by before the door — sandals left on it in most — and
 *   stepping stones out into the garden.
 * - **The door** has a noren split in three with the house's mark
 *   (`KURA_CRESTS`), and paper lanterns hung from the eave either side of it
 *   or on one. Rolled blinds hang under the purlin on some sides, a wind bell
 *   from one hip beam on most.
 * - **Inside**: tatami with their dark borders, a board ceiling on battens, a
 *   paper lining to every shoji bay, the tokonoma's board with a scroll and a
 *   sprig of maple in a bronze vase, a brazier with a kettle, two cushions.
 *
 * Seeded by where it stands (`streetSeed`), which is why it is in
 * `CONFORMS_TO_TERRAIN`: which end has the round window, the gable's finish,
 * the tokonoma's bay, the lanterns, the blinds, the bell, the sandals and the
 * mark on the noren all vary, and the footings, the underfloor, the step and
 * the stepping stones are carried down to the ground.
 *
 * **The colliders are unchanged, byte for byte and in the same order**: the
 * deck, the walls (the retired `doorWall` and `wall` calls spelled out), then
 * the roof slab at the eave. Everything drawn is on a face (none more than
 * 0.13 m proud), overhead (the purlin, the ties and the lanterns clear the
 * deck by 2.4 m or the ground by 2.5), or at the feet (the boards, the step,
 * the tatami, the tokonoma's board, the brazier).
 */
export function buildTeahouse(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "teahouse");
  const w = p.width ?? 7;
  const d = p.depth ?? 6;
  const floorY = 0.55;
  const wallH = 2.5;
  const veranda = 1.2;
  const t = 0.18;
  const door = 1.5;
  const doorH = 2.0;

  // --- colliders, exactly as they were: the deck, the walls (the old
  // `doorWall` and `wall` calls), then the roof slab at the eave.
  b.block({ w: w + veranda * 2, h: floorY, d: d + veranda * 2, x: 0, y: floorY / 2, z: 0 });
  const wy = floorY + wallH / 2;
  const side = (w - door) / 2;
  const off = door / 2 + side / 2;
  const lintel = wallH - doorH;
  const fz = -d / 2 + t / 2;
  b.block({ w: side, h: wallH, d: t, x: 0 - off, y: wy, z: fz });
  b.block({ w: side, h: wallH, d: t, x: 0 + off, y: wy, z: fz });
  b.block({ w: door, h: lintel, d: t, x: 0, y: wy + wallH / 2 - lintel / 2, z: fz });
  b.block({ w, h: wallH, d: t, x: 0, y: wy, z: d / 2 - t / 2 });
  b.block({ w: t, h: wallH, d, x: -w / 2 + t / 2, y: wy, z: 0 });
  b.block({ w: t, h: wallH, d, x: w / 2 - t / 2, y: wy, z: 0 });
  const eave = floorY + wallH + 0.25;
  const ex = w / 2 + veranda + 0.7;
  const ez = d / 2 + veranda + 0.7;
  b.block({ w: ex * 2, h: 0.3, d: ez * 2, x: 0, y: eave, z: 0 });

  // --- everything below is drawing -------------------------------------------
  const lit = !!p.litWindows;
  const rnd = mulberry32(streetSeed(w, d, wallH, ctx));
  const roundEnd: Side = rnd() < 0.5 ? "-x" : "+x";
  const latticeGable = rnd() < 0.5;
  const lanterns = rnd() < 0.55 ? [-1, 1] : [rnd() < 0.5 ? -1 : 1];
  const geta = rnd() < 0.6;
  const bellCorner = rnd() < 0.7 ? Math.floor(rnd() * 4) : -1;
  const blinds = [rnd() < 0.45, rnd() < 0.45, rnd() < 0.45];
  const brazier = rnd() < 0.5 ? -1 : 1;
  const mark = KURA_CRESTS[Math.floor(rnd() * KURA_CRESTS.length)];
  const shitajiU = (rnd() - 0.5) * 0.3;
  const backBays = Math.max(2, Math.round(w / 1.8));
  const tokoBay = backBays >= 3 ? 1 + Math.floor(rnd() * (backBays - 2)) : Math.floor(rnd() * backBays);

  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };
  const DW = w / 2 + veranda;
  const DD = d / 2 + veranda;
  let foot = 0;
  for (const gi of [-1, 0, 1]) {
    for (const gj of [-1, 0, 1]) {
      if (gi || gj) foot = Math.min(foot, ground(gi * DW, gj * DD));
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
  /** Plan point `n` out from the centre on side `s`, `u` along it. */
  const at = (s: Side, u: number, n: number): [number, number] =>
    runsAlongX(s) ? [u, outward(s) * n] : [outward(s) * n, u];
  /** A member on side `s`'s outer face, `out` from the face to its own centre. */
  const on = (s: Side, u: number, y: number, along: number, tall: number, thick: number, out: number, color: string): void =>
    sb.onFace(s, wallFace(s), u, y, along, tall, thick, out, color, 0, 0, hideBack(s));
  /** The same on the wall's inner face, `out` into the room. */
  const inner = (s: Side, u: number, y: number, along: number, tall: number, thick: number, out: number, color: string): void =>
    sb.onFace(s, wallFace(s) - t, u, y, along, tall, thick, -out, color, 0, 0, hideBack(OPP[s]));
  /** A glow on side `s` whose centre is `plane` out from the building's centre. */
  const glowAt = (s: Side, plane: number, u: number, y: number, along: number, tall: number): void => {
    const c = outward(s) * plane;
    if (runsAlongX(s)) b.glow(along, tall, 0.02, u, y, c, SHOJI_GLOW);
    else b.glow(0.02, tall, along, c, y, u, SHOJI_GLOW);
  };
  const member = (a: Point3, c: Point3, wide: number, deep: number, color: string, hide = 0): void => {
    const o = orient(a, c);
    sb.box(wide, deep, o.len, o.mid[0], o.mid[1], o.mid[2], color, o.rot, hide);
  };
  /** An end tile: one face 1.5 cm past `c`, square to the member from `a`. */
  const endTile = (a: Point3, c: Point3, size: number): void => {
    const o = orient(a, c);
    const k = 0.015 / o.len;
    sb.box(size, size, 0.01, c[0] + (c[0] - a[0]) * k, c[1] + (c[1] - a[1]) * k, c[2] + (c[2] - a[2]) * k, KAWARA_DARK, o.rot, 63 & ~END);
  };

  // --- the heights of the frame --------------------------------------------------
  const F0 = floorY;
  const KICK = F0 + 0.34;
  const KAMOI = F0 + doorH;
  const PLATE = F0 + wallH - 0.15;
  const CEIL = F0 + wallH - 0.08;

  // --- the roof's own geometry, which everything under and on it is cut to ------
  const RISE = 2.6;
  const CURVE = 1.55;
  const TH = 0.28;
  const tx = Math.max(0.4, (w - d) / 2 + 0.6);
  const roof: RoofSpec = { y: eave, ex, ez, tx, tz: 0, rise: RISE, curve: CURVE, upturn: 0.4, thick: TH };
  const T = (tt: number): number => eave + RISE * Math.pow(Math.min(1, Math.max(0, tt)), CURVE);
  // The gable stands where the third ring of five meets the hips, so the
  // verge over it is the z-faces' own two top facets carried out past it —
  // coplanar with the roof where the roof is there, and its own slab where
  // the hip end falls away under it.
  const TG = 0.6;
  const n8 = 0.2 * ez;
  const n6 = 0.4 * ez;
  const nE = 0.44 * ez;
  const gx = ex + (tx - ex) * TG;
  const X1 = gx + 0.35;
  const H0 = T(TG);
  const slopeV = (T(0.8) - T(TG)) / (n6 - n8);
  /** The verge's top over `n` out from the ridge: the two facets, the lower one carried on. */
  const vergeTop = (n: number): number => {
    const a = Math.abs(n);
    if (a <= n8) return T(1) + (T(0.8) - T(1)) * (a / n8);
    return T(0.8) - slopeV * (a - n8);
  };
  /** Where a tile lies over (x, z): the verge over the gable, the curved sheet everywhere else. */
  const topAt = (x: number, z: number): number => {
    const ax = Math.abs(x);
    const az = Math.abs(z);
    if (ax <= X1 && (az <= n6 || (az <= nE && ax >= gx))) return Math.max(roofHeight(roof, x, z), vergeTop(az));
    return roofHeight(roof, x, z);
  };
  /** The underside of the board lining, which the rafters are hung under. */
  const soffit = (x: number, z: number): number => roofHeight(roof, x, z, true) - 0.03;

  // --- the elevations: which bay is which ----------------------------------------
  type Bay = { a: number; c: number; kind: "shoji" | "plaster" | "door" };
  const baysOf = (s: Side): Bay[] => {
    const out: Bay[] = [];
    const split = (a: number, c: number, n: number): void => {
      for (let i = 0; i < n; i++) out.push({ a: a + ((c - a) * i) / n, c: a + ((c - a) * (i + 1)) / n, kind: "shoji" });
    };
    if (s === "-z") {
      const j = door / 2 + 0.08;
      const n = Math.max(1, Math.round((w / 2 - j) / 1.8));
      split(-w / 2, -j, n);
      out.push({ a: -j, c: j, kind: "door" });
      split(j, w / 2, n);
    } else if (s === "+z") {
      split(-w / 2, w / 2, backBays);
      out[tokoBay].kind = "plaster";
    } else {
      const n = 2 * Math.round((d / 1.8 - 1) / 2) + 1;
      split(-d / 2, d / 2, n);
      out[(n - 1) / 2].kind = "plaster";
    }
    return out;
  };
  const bays: Record<Side, Bay[]> = { "-z": baysOf("-z"), "+z": baysOf("+z"), "-x": baysOf("-x"), "+x": baysOf("+x") };
  const posts = (s: Side): number[] => {
    const us = [bays[s][0].a];
    for (const bay of bays[s]) us.push(bay.c);
    return us;
  };

  /**
   * A window in a plaster bay: the panel laid round a hole, the paper glowing
   * behind it and, from outside, what is in the hole. `dir` is 1 on the
   * outer face and -1 on the inner. A ROUND hole is the square the frame's
   * ring is drawn round, its corners filled by diamonds of the same plaster
   * turned 45 degrees so the hole left is an octagon and the ring covers the
   * difference; a SQUARE one is the tea room's reed window.
   */
  const plasterWindow = (
    s: Side,
    dir: 1 | -1,
    a: number,
    c: number,
    cu: number,
    cy: number,
    hw: number,
    hh: number,
    round: boolean,
    dressed: boolean,
  ): void => {
    const plane = dir > 0 ? wallFace(s) : wallFace(s) - t;
    const hide = hideBack(dir > 0 ? s : OPP[s]);
    const P = (u: number, y: number, along: number, tall: number, thick: number, out: number, color: string, tilt = 0): void =>
      sb.onFace(s, plane, u, y, along, tall, thick, dir * out, color, tilt, 0, hide);
    const y0 = F0 + 0.06;
    const y1 = KAMOI;
    P((a + cu - hw) / 2, (y0 + y1) / 2, cu - hw - a, y1 - y0, 0.02, 0.02, TSUCHI);
    P((cu + hw + c) / 2, (y0 + y1) / 2, c - cu - hw, y1 - y0, 0.02, 0.02, TSUCHI);
    P(cu, (cy + hh + y1) / 2, 2 * hw, y1 - cy - hh, 0.02, 0.02, TSUCHI);
    P(cu, (y0 + cy - hh) / 2, 2 * hw, cy - hh - y0, 0.02, 0.02, TSUCHI);
    if (lit) glowAt(s, plane + dir * 0.008, cu, cy, 2 * hw, 2 * hh);
    else P(cu, cy, 2 * hw, 2 * hh, 0.01, 0.008, PAPER);
    if (round) {
      const k = hw * (Math.SQRT2 - 1) * Math.SQRT2;
      for (const [du, dv] of CORNERS) P(cu + du * hw, cy + dv * hh, k, k, 0.02, 0.02, TSUCHI, Math.PI / 4);
      // The ring, in sixteen pieces round the circle.
      const R = hw + 0.02;
      const n = outward(s) * (plane + dir * 0.045);
      const pt = (th: number): Point3 =>
        runsAlongX(s) ? [cu + R * Math.cos(th), cy + R * Math.sin(th), n] : [n, cy + R * Math.sin(th), cu + R * Math.cos(th)];
      for (let i = 0; i < 16; i++) {
        const th0 = (i * Math.PI) / 8 - 0.02;
        const th1 = ((i + 1) * Math.PI) / 8 + 0.02;
        member(pt(th0), pt(th1), 0.05, 0.09, HINOKI);
      }
      if (dressed) {
        // Bamboo across it, three up and two over.
        for (const f of [-0.5, 0, 0.5]) {
          const du = f * hw;
          P(cu + du, cy, 0.03, 2 * Math.sqrt(hw * hw - du * du), 0.03, 0.03, KAYA);
        }
        for (const f of [-0.3, 0.3]) {
          const dv = f * hw;
          P(cu, cy + dv, 2 * Math.sqrt(hw * hw - dv * dv), 0.03, 0.03, 0.035, KAYA);
        }
      }
    } else if (dressed) {
      // The lath left bare: reeds at odd spacings, lashed where they cross.
      const us = [-0.66, -0.2, 0.28, 0.7].map((f) => cu + f * hw + (rnd() - 0.5) * 0.04);
      const ys = [-0.5, 0.06, 0.56].map((f) => cy + f * hh + (rnd() - 0.5) * 0.04);
      for (const u of us) P(u, cy, 0.02, 2 * hh + 0.04, 0.02, 0.028, KAYA);
      for (const y of ys) P(cu, y, 2 * hw + 0.04, 0.02, 0.02, 0.042, KAYA);
      for (let i = 0; i < 4; i++) P(us[(i * 3) % 4], ys[i % 3], 0.035, 0.035, 0.02, 0.05, SUMI, Math.PI / 4);
    }
  };

  // --- the outer elevations -----------------------------------------------------
  for (const s of SIDES) {
    const L = faceLen(s);
    const pu = posts(s);
    const doorCut: [number, number][] = s === "-z" ? [[-door / 2, door / 2]] : [];
    for (const [a, c] of carve(-L / 2, L / 2, doorCut)) on(s, (a + c) / 2, F0 + 0.03, c - a, 0.06, 0.1, 0.05, HINOKI);
    on(s, 0, KAMOI + 0.04, L, 0.08, 0.1, 0.05, HINOKI);
    on(s, 0, (KAMOI + 0.08 + PLATE) / 2, L - 0.02, PLATE - KAMOI - 0.08, 0.02, 0.01, SHIKKUI);
    on(s, 0, PLATE + 0.075, L + 0.3, 0.15, 0.16, 0.08, HINOKI);
    for (let i = 0; i < pu.length; i++) {
      const corner = i === 0 || i === pu.length - 1;
      on(s, pu[i], (F0 + PLATE) / 2, corner ? 0.2 : 0.15, PLATE - F0, 0.12, 0.06, HINOKI);
    }
    for (const bay of bays[s]) {
      const a = bay.a + 0.075;
      const c = bay.c - 0.075;
      const cu = (a + c) / 2;
      if (bay.kind === "shoji") {
        // One sheet of paper behind two sashes in two tracks.
        if (lit) glowAt(s, wallFace(s) + 0.015, cu, (KICK + KAMOI) / 2, c - a, KAMOI - KICK);
        else on(s, cu, (KICK + KAMOI) / 2, c - a, KAMOI - KICK, 0.02, 0.015, PAPER);
        const np = Math.max(1, Math.round((c - a) / 0.95));
        const pw = (c - a) / np;
        for (let i = 0; i < np; i++) {
          const u = a + (i + 0.5) * pw;
          const lap = (i % 2) * 0.035;
          const y0 = F0 + 0.06;
          on(s, u, (y0 + KICK) / 2, pw - 0.06, KICK - y0, 0.03, 0.03 + lap, HINOKI);
          for (const e of [-1, 1]) on(s, u + e * (pw / 2 - 0.03), (y0 + KAMOI) / 2, 0.06, KAMOI - y0, 0.05, 0.055 + lap, SUMI);
          for (const yr of [y0 + 0.025, KICK, KAMOI - 0.025]) on(s, u, yr, pw - 0.06, 0.05, 0.05, 0.055 + lap, SUMI);
          for (let k = 1; k < 3; k++) on(s, u - pw / 2 + 0.03 + (k * (pw - 0.06)) / 3, (KICK + KAMOI) / 2, 0.022, KAMOI - KICK - 0.05, 0.03, 0.05 + lap, SUMI);
          for (let r = 1; r < 6; r++) on(s, u, KICK + (r * (KAMOI - 0.025 - KICK)) / 6, pw - 0.1, 0.022, 0.03, 0.05 + lap, SUMI);
        }
      } else if (bay.kind === "plaster") {
        const cy = F0 + 1.25;
        if (s === "+z") on(s, cu, (F0 + 0.06 + KAMOI) / 2, c - a, KAMOI - F0 - 0.06, 0.02, 0.02, TSUCHI);
        else if (s === roundEnd) plasterWindow(s, 1, a, c, cu, cy, 0.52, 0.52, true, true);
        else plasterWindow(s, 1, a, c, cu + shitajiU, cy, 0.34, 0.4, false, true);
      }
      // The lattice transom over the front's and the back's paper and door.
      if (runsAlongX(s) && bay.kind !== "plaster") {
        const r0 = KAMOI + 0.12;
        const r1 = PLATE - 0.04;
        if (lit) glowAt(s, wallFace(s) + 0.032, cu, (r0 + r1) / 2, c - a, r1 - r0);
        else on(s, cu, (r0 + r1) / 2, c - a, r1 - r0, 0.01, 0.03, PAPER);
        for (const yr of [r0, r1]) on(s, cu, yr, c - a, 0.03, 0.03, 0.05, SUMI);
        const nb = Math.round((c - a) / 0.14);
        for (let k = 1; k < nb; k++) on(s, a + (k / nb) * (c - a), (r0 + r1) / 2, 0.02, r1 - r0, 0.02, 0.05, SUMI);
      }
    }
  }

  // --- the door: its linings, the noren, the lanterns --------------------------
  sb.box(0.08, KAMOI - F0, t + 0.02, -(door / 2 + 0.02), (F0 + KAMOI) / 2, fz, HINOKI);
  sb.box(0.08, KAMOI - F0, t + 0.02, door / 2 + 0.02, (F0 + KAMOI) / 2, fz, HINOKI);
  sb.box(door, 0.04, t + 0.02, 0, KAMOI + 0.01, fz, HINOKI);
  sb.box(door, 0.03, t + 0.04, 0, F0 + 0.015, fz, HINOKI, undefined, HIDE_UNDER);
  {
    const nw = door + 0.12;
    const nz = -d / 2 - 0.13;
    const ny = KAMOI - 0.02 - 0.27;
    for (let i = 0; i < 3; i++) {
      b.translucentBox(nw / 3 - 0.02, 0.54, 0.02, -nw / 2 + (i + 0.5) * (nw / 3), ny, nz, NOREN, TRANSLUCENCY.awning);
    }
    sb.box(nw + 0.2, 0.03, 0.03, 0, KAMOI - 0.01, nz, SUMI);
    for (const e of [-1, 1]) sb.box(0.03, 0.06, 0.1, e * (nw / 2 + 0.05), KAMOI + 0.01, nz + 0.05, SUMI);
    for (const [du, dv, mw, mh] of mark) sb.box(mw * 0.3, mh * 0.3, 0.012, du * 0.3, ny + 0.04 + dv * 0.3, nz - 0.017, PAPER);
  }
  for (const e of lanterns) {
    const lx = e * (door / 2 + 0.55);
    const lz = -(DD + 0.3);
    const sy = soffit(lx, lz);
    const cy = sy - 0.18 - 0.2;
    sb.box(0.012, 0.18, 0.012, lx, sy - 0.09, lz, SUMI);
    for (const dy of [-0.22, 0.22]) {
      sb.box(0.19, 0.04, 0.19, lx, cy + dy, lz, SUMI);
      sb.box(0.19, 0.04, 0.19, lx, cy + dy, lz, SUMI, { y: Math.PI / 4 });
    }
    if (lit) {
      for (const turn of [0, Math.PI / 4]) b.glow(0.26, 0.3, 0.26, lx, cy, lz, SHOJI_GLOW).rotation.y = turn;
      for (const dy of [-0.17, 0.17]) b.glow(0.2, 0.06, 0.2, lx, cy + dy, lz, SHOJI_GLOW).rotation.y = Math.PI / 8;
    } else {
      for (const turn of [0, Math.PI / 4]) sb.box(0.26, 0.3, 0.26, lx, cy, lz, PAPER, { y: turn });
    }
  }

  // --- the inner elevations ------------------------------------------------------
  for (const s of SIDES) {
    const L = faceLen(s) - 2 * t;
    const lim = L / 2 - 0.06;
    for (const u of posts(s)) {
      if (Math.abs(u) < lim) inner(s, u, (F0 + CEIL) / 2, 0.12, CEIL - F0, 0.04, 0.02, HINOKI);
    }
    const doorCut: [number, number][] = s === "-z" ? [[-door / 2 - 0.06, door / 2 + 0.06]] : [];
    for (const [a, c] of carve(-L / 2, L / 2, doorCut)) inner(s, (a + c) / 2, KAMOI + 0.04, c - a, 0.08, 0.04, 0.02, HINOKI);
    inner(s, 0, (KAMOI + 0.08 + CEIL) / 2, L, CEIL - KAMOI - 0.08, 0.01, 0.005, TSUCHI);
    for (const bay of bays[s]) {
      const a = Math.max(bay.a + 0.06, -L / 2);
      const c = Math.min(bay.c - 0.06, L / 2);
      const cu = (a + c) / 2;
      if (bay.kind === "shoji") {
        const y0 = F0 + 0.3;
        if (lit) glowAt(s, wallFace(s) - t - 0.012, cu, (y0 + KAMOI) / 2, c - a, KAMOI - y0);
        else inner(s, cu, (y0 + KAMOI) / 2, c - a, KAMOI - y0, 0.01, 0.012, PAPER);
        inner(s, cu, (F0 + y0) / 2, c - a, y0 - F0, 0.02, 0.01, HINOKI);
        // The sashes seen from the room: stiles, rails and the lattice.
        const np = Math.max(1, Math.round((c - a) / 0.95));
        const pw = (c - a) / np;
        for (let i = 1; i < np; i++) inner(s, a + i * pw, (y0 + KAMOI) / 2, 0.05, KAMOI - y0, 0.03, 0.025, SUMI);
        for (const yr of [y0 + 0.02, KAMOI - 0.02]) inner(s, cu, yr, c - a, 0.04, 0.03, 0.025, SUMI);
        for (let r = 1; r < 6; r++) inner(s, cu, y0 + (r * (KAMOI - y0)) / 6, c - a, 0.02, 0.02, 0.02, SUMI);
        for (let i = 0; i < np; i++) {
          for (let k = 1; k < 3; k++) inner(s, a + i * pw + (k * pw) / 3, (y0 + KAMOI) / 2, 0.02, KAMOI - y0, 0.02, 0.02, SUMI);
        }
      } else if (bay.kind === "plaster") {
        const cy = F0 + 1.25;
        if (s === "+z") inner(s, cu, (F0 + KAMOI) / 2, c - a, KAMOI - F0, 0.01, 0.005, TSUCHI);
        else if (s === roundEnd) plasterWindow(s, -1, a, c, cu, cy, 0.52, 0.52, true, false);
        else plasterWindow(s, -1, a, c, cu + shitajiU, cy, 0.34, 0.4, false, false);
      }
    }
  }

  // --- inside: the tatami, the tokonoma, the brazier, the ceiling ---------------
  const IW = w - 2 * t;
  const ID = d - 2 * t;
  {
    const rz = Math.max(2, Math.round(ID / 0.95));
    const md = ID / rz;
    const cx = Math.max(1, Math.round(IW / 1.85));
    const ml = IW / cx;
    for (let r = 0; r < rz; r++) {
      const z = -ID / 2 + (r + 0.5) * md;
      const cuts: number[] = [-IW / 2];
      for (let i = 1; i < cx; i++) cuts.push(-IW / 2 + i * ml + (r % 2 ? -ml / 2 : 0));
      if (r % 2) cuts.push(IW / 2 - ml / 2);
      cuts.push(IW / 2);
      for (let i = 0; i + 1 < cuts.length; i++) {
        sb.box(cuts[i + 1] - cuts[i] - 0.012, 0.06, md - 0.012, (cuts[i] + cuts[i + 1]) / 2, F0 - 0.02, z, KAYA, undefined, HIDE_UNDER);
      }
    }
    for (let r = 0; r <= rz; r++) {
      const z = Math.max(-ID / 2 + 0.02, Math.min(ID / 2 - 0.02, -ID / 2 + r * md));
      sb.box(IW, 0.02, 0.035, 0, F0 + 0.012, z, SUMI, undefined, HIDE_UNDER);
    }
  }
  {
    // The tokonoma: a raised board with a lacquered edge, the scroll over it,
    // a sprig of maple in a bronze vase.
    const bay = bays["+z"][tokoBay];
    const a0 = Math.max(bay.a + 0.08, -IW / 2 + 0.02);
    const c0 = Math.min(bay.c - 0.08, IW / 2 - 0.02);
    const cu = (a0 + c0) / 2;
    const bw = c0 - a0;
    const zb = ID / 2 - 0.25;
    sb.box(bw, 0.1, 0.5, cu, F0 + 0.055, zb, HINOKI, undefined, HIDE_UNDER);
    sb.box(bw + 0.01, 0.115, 0.05, cu, F0 + 0.0575, ID / 2 - 0.5, SUMI, undefined, HIDE_UNDER);
    const sy = F0 + 1.35;
    inner("+z", cu, sy - 0.02, 0.5, 1.28, 0.012, 0.02, NOREN);
    inner("+z", cu, sy + 0.02, 0.38, 0.84, 0.01, 0.031, PAPER);
    for (let i = 0; i < 4; i++) {
      sb.onFace("+z", d / 2 - t, cu + (rnd() - 0.5) * 0.03, sy + 0.3 - i * 0.2, 0.035, 0.1 + rnd() * 0.06, 0.004, -0.038, SUMI, (rnd() - 0.5) * 0.5, 0, hideBack("-z"));
    }
    for (const yr of [sy - 0.66, sy + 0.64]) inner("+z", cu, yr, 0.58, 0.035, 0.035, 0.03, SUMI);
    const vx = cu + bw * 0.28;
    b.cyl(0.22, 0.09, 0.12, 8, vx, F0 + 0.105 + 0.11, zb, BRONZE);
    member([vx, F0 + 0.3, zb], [vx - 0.08, F0 + 0.62, zb - 0.02], 0.012, 0.012, SUMI);
    for (let i = 0; i < 5; i++) {
      const f = 0.35 + i * 0.15;
      sb.box(0.08, 0.012, 0.06, vx - 0.08 * f + (i % 2 ? 0.05 : -0.05), F0 + 0.3 + 0.32 * f, zb - 0.02 * f, KAKI, { y: rnd() * 3, z: (rnd() - 0.5) * 0.8 });
    }
  }
  {
    // A brazier with a kettle on it, and two cushions.
    const hx = brazier * (IW / 2 - 0.6);
    const hz = -(ID / 2 - 0.6);
    for (const e of [-1, 1]) {
      sb.box(0.46, 0.24, 0.05, hx, F0 + 0.12, hz + e * 0.205, HINOKI, undefined, HIDE_UNDER);
      sb.box(0.05, 0.24, 0.36, hx + e * 0.205, F0 + 0.12, hz, HINOKI, undefined, HIDE_UNDER);
    }
    sb.box(0.36, 0.02, 0.36, hx, F0 + 0.2, hz, GRANITE_DARK, undefined, HIDE_UNDER);
    b.cyl(0.14, 0.15, 0.2, 8, hx, F0 + 0.28, hz, SUMI);
    sb.box(0.05, 0.03, 0.05, hx, F0 + 0.365, hz, BRONZE);
    sb.box(0.1, 0.03, 0.03, hx - brazier * 0.12, F0 + 0.3, hz, SUMI, { z: brazier * 0.6 });
    sb.box(0.17, 0.015, 0.015, hx, F0 + 0.43, hz, SUMI);
    for (const e of [-1, 1]) sb.box(0.015, 0.08, 0.015, hx + e * 0.08, F0 + 0.39, hz, SUMI);
    const cushions: [number, number, number][] = [
      [hx - brazier * 0.7, hz + 0.15, 0.1],
      [hx - brazier * 0.1, hz + 0.75, -0.15],
    ];
    for (const [x, z, yaw] of cushions) sb.box(0.5, 0.06, 0.52, x, F0 + 0.04, z, NOREN, { y: yaw + (rnd() - 0.5) * 0.2 }, HIDE_UNDER);
  }
  // The board ceiling on its battens, a cornice round it.
  sb.box(IW, 0.03, ID, 0, CEIL + 0.015, 0, CEDAR, undefined, TOP);
  {
    const nb = Math.max(3, Math.round(ID / 0.45));
    for (let i = 1; i < nb; i++) sb.box(IW, 0.03, 0.03, 0, CEIL - 0.015, -ID / 2 + (i / nb) * ID, SUMI, undefined, TOP);
    for (const e of [-1, 1]) {
      sb.box(IW, 0.06, 0.06, 0, CEIL - 0.03, e * (ID / 2 - 0.03), HINOKI, undefined, TOP);
      sb.box(0.06, 0.06, ID, e * (IW / 2 - 0.03), CEIL - 0.03, 0, HINOKI, undefined, TOP);
    }
  }

  // --- the engawa: boards along each side, the edge beam, posts on stones -------
  {
    const nb = 6;
    const bw = veranda / nb;
    const run = (along: "x" | "z", lo: number, hi: number, fixed: number): void => {
      let u = lo;
      while (hi - u > 0.05) {
        let len = 2.4 + rnd() * 1.4;
        if (hi - (u + len) < 1.0) len = hi - u;
        const mid = u + len / 2;
        if (along === "x") sb.box(len - 0.008, 0.05, bw - 0.012, mid, F0 - 0.025, fixed, CEDAR, undefined, HIDE_UNDER);
        else sb.box(bw - 0.012, 0.05, len - 0.008, fixed, F0 - 0.025, mid, CEDAR, undefined, HIDE_UNDER);
        u += len;
      }
    };
    for (let j = 0; j < nb; j++) {
      for (const e of [-1, 1]) {
        run("x", -DW, DW, e * (d / 2 + (j + 0.5) * bw));
        run("z", -d / 2, d / 2, e * (w / 2 + (j + 0.5) * bw));
      }
    }
    for (const e of [-1, 1]) {
      sb.box(2 * DW + 0.12, 0.16, 0.12, 0, F0 + 0.012 - 0.08, e * (DD - 0.04), HINOKI, undefined, HIDE_UNDER);
      sb.box(0.12, 0.16, 2 * DD + 0.12, e * (DW - 0.04), F0 + 0.012 - 0.08, 0, HINOKI, undefined, HIDE_UNDER);
    }
    const postAt = (x: number, z: number): void => {
      const g = ground(x, z);
      const sTop = Math.min(F0 - 0.25, g + 0.08);
      const sBot = Math.min(g, foot) - 0.05;
      sb.box(0.28, sTop - sBot, 0.28, x, (sTop + sBot) / 2, z, GRANITE, { y: (rnd() - 0.5) * 0.3 });
      const pTop = F0 - 0.14;
      if (pTop - sTop > 0.03) sb.box(0.1, pTop - sTop, 0.1, x, (pTop + sTop) / 2, z, HINOKI);
    };
    const nx = Math.max(3, Math.round((2 * DW) / 1.5));
    const nzp = Math.max(3, Math.round((2 * DD) / 1.5));
    for (let i = 0; i <= nx; i++) {
      const x = -DW + 0.08 + (i / nx) * (2 * DW - 0.16);
      for (const e of [-1, 1]) postAt(x, e * (DD - 0.08));
    }
    for (let i = 1; i < nzp; i++) {
      const z = -DD + 0.08 + (i / nzp) * (2 * DD - 0.16);
      for (const e of [-1, 1]) postAt(e * (DW - 0.08), z);
    }
    // The stone to step up by, sandals on it, and stepping stones away.
    const zs = -(DD + 0.33);
    const g = ground(0, zs);
    const sTop = Math.min(F0 - 0.2, g + 0.24);
    const sBot = Math.min(g, foot) - 0.05;
    sb.box(1.0, sTop - sBot, 0.55, 0, (sTop + sBot) / 2, zs, GRANITE, { y: (rnd() - 0.5) * 0.1 });
    if (geta) {
      for (const e of [-1, 1]) {
        const gx0 = e * 0.12 + 0.05;
        sb.box(0.09, 0.025, 0.21, gx0, sTop + 0.057, zs - 0.03, HINOKI);
        for (const dz of [-0.06, 0.06]) sb.box(0.09, 0.045, 0.025, gx0, sTop + 0.0225, zs - 0.03 + dz, HINOKI, undefined, HIDE_UNDER);
        sb.box(0.012, 0.02, 0.09, gx0, sTop + 0.078, zs - 0.07, NOREN);
      }
    }
    let px = 0;
    for (let k = 0; k < 3; k++) {
      px += (rnd() - 0.5) * 0.5;
      const z = zs - 0.6 * (k + 1);
      const gk = ground(px, z);
      sb.box(0.46 + rnd() * 0.16, 0.14, 0.4 + rnd() * 0.12, px, gk - 0.03, z, GRANITE, { y: rnd() * 3 });
    }
  }

  // --- under the eave: the purlin on the veranda posts, the ties, the rafters ----
  const RD = 0.08;
  const PD = 0.15;
  const purlinN = (s: Side): number => wallFace(s) + veranda - 0.2;
  const purlinHalf = (s: Side): number => (runsAlongX(s) ? w / 2 : d / 2) + veranda - 0.2 + 0.28;
  const purlinAt = (s: Side, u: number): number => {
    const [x, z] = at(s, u, purlinN(s));
    return soffit(x, z) - RD - PD / 2;
  };
  /** The purlin's centre over `u`: four straight lengths swept up with the eave. */
  const purlinY = (s: Side, u: number): number => {
    const L = purlinHalf(s);
    const k = Math.max(0, Math.min(3.999, ((u + L) / (2 * L)) * 4));
    const i = Math.floor(k);
    const ya = purlinAt(s, -L + (i * L) / 2);
    const yb = purlinAt(s, -L + ((i + 1) * L) / 2);
    return ya + (yb - ya) * (k - i);
  };
  for (const s of SIDES) {
    const L = purlinHalf(s);
    const n = purlinN(s);
    for (let i = 0; i < 4; i++) {
      const ua = -L + (i * L) / 2;
      const uc = ua + L / 2;
      const [xa, za] = at(s, ua, n);
      const [xc, zc] = at(s, uc, n);
      member([xa, purlinY(s, ua), za], [xc, purlinY(s, uc), zc], 0.14, PD, HINOKI, (i > 0 ? START : 0) | (i < 3 ? END : 0));
    }
    // A tie from every post in the wall out to it.
    const pu = posts(s);
    for (let i = 1; i < pu.length - 1; i++) {
      const [xa, za] = at(s, pu[i], wallFace(s) + 0.12);
      const [xc, zc] = at(s, pu[i], n);
      member([xa, PLATE + 0.075, za], [xc, purlinY(s, pu[i]), zc], 0.1, 0.12, HINOKI, START | END);
    }
    // The rafters: from the plate to the eave, in two lengths under the lining.
    const along = runsAlongX(s) ? ex : ez;
    const other = runsAlongX(s) ? w / 2 : d / 2;
    const nEave = runsAlongX(s) ? ez : ex;
    const SP = 0.33;
    const K = Math.floor((along - 0.12) / SP);
    for (let k = -K; k <= K; k++) {
      const u = k * SP;
      const n0 = wallFace(s) + Math.max(0.02, Math.abs(u) - other + 0.09);
      const n1 = nEave - 0.05;
      if (n1 - n0 < 0.2) continue;
      const pt = (nn: number): Point3 => {
        const [x, z] = at(s, u, nn);
        return [x, soffit(x, z) - RD / 2, z];
      };
      const m = pt((n0 + n1) / 2);
      member(pt(n0), m, 0.065, RD, SUMI, TOP | START | END);
      member(m, pt(n1), 0.065, RD, SUMI, TOP | START);
    }
  }
  // The four veranda posts, a bearing block on each.
  for (const [sx, sz] of CORNERS) {
    const x = sx * (DW - 0.2);
    const z = sz * (DD - 0.2);
    const top = Math.min(purlinY(sz < 0 ? "-z" : "+z", x), purlinY(sx < 0 ? "-x" : "+x", z)) - PD / 2;
    sb.box(0.15, top - 0.06 - F0, 0.15, x, (F0 + top - 0.06) / 2, z, HINOKI);
    sb.box(0.21, 0.06, 0.21, x, top - 0.03, z, HINOKI);
  }
  // The hip beams, one into each corner, a wind bell hung from one.
  CORNERS.forEach(([sx, sz], i) => {
    const P = (f: number): Point3 => {
      const x = sx * (w / 2 + f * (ex - 0.06 - w / 2));
      const z = sz * (d / 2 + f * (ez - 0.06 - d / 2));
      return [x, soffit(x, z) - 0.075, z];
    };
    member(P(0), P(0.5), 0.11, 0.15, SUMI, TOP | START | END);
    member(P(0.5), P(1), 0.11, 0.15, SUMI, TOP | START);
    if (i === bellCorner) {
      const [bx, by, bz] = P(0.93);
      sb.box(0.01, 0.12, 0.01, bx, by - 0.135, bz, SUMI);
      b.cyl(0.12, 0.07, 0.15, 8, bx, by - 0.255, bz, BRONZE);
      sb.box(0.01, 0.14, 0.01, bx, by - 0.385, bz, SUMI);
      sb.box(0.06, 0.18, 0.005, bx, by - 0.54, bz, PAPER, { y: Math.atan2(sx, sz) + Math.PI / 2 });
    }
  });
  // Rolled blinds under the purlin on some sides.
  (["+z", "-x", "+x"] as const).forEach((s, i) => {
    if (!blinds[i]) return;
    const half = (runsAlongX(s) ? w / 2 : d / 2) + veranda - 0.2 - 0.3;
    const [x, z] = at(s, 0, purlinN(s) + 0.1);
    const y = purlinY(s, 0) - PD / 2 - 0.07;
    b.cyl(2 * half, 0.12, 0.12, 8, x, y, z, KAYA, runsAlongX(s) ? { z: Math.PI / 2 } : { x: Math.PI / 2 });
    for (const f of [-0.6, 0.6]) {
      const [tx0, tz0] = at(s, f * half, purlinN(s) + 0.1);
      sb.box(0.14, 0.16, 0.14, tx0, y + 0.03, tz0, SUMI);
    }
  });

  // --- the gables: the tympanum's facing, the barge boards, the hanging ornament -
  const U = (n: number): number => vergeTop(n) - TH - 0.01;
  const B = H0 - 0.08;
  const nc = n8 + ((U(n8) - B) / (U(n8) - U(n6))) * (n6 - n8);
  /** Half the tympanum's width at height `y`. */
  const halfAt = (y: number): number =>
    y >= U(n8) ? (n8 * (U(0) - y)) / (U(0) - U(n8)) : n8 + ((U(n8) - y) / (U(n8) - U(n6))) * (n6 - n8);
  for (const s of ["-x", "+x"] as const) {
    const sgn = outward(s);
    /** A member on the tympanum's face; `u` runs along Z. */
    const g = (u: number, y: number, along: number, tall: number, thick: number, out: number, color: string): void =>
      sb.onFace(s, gx, u, y, along, tall, thick, out, color, 0, 0, hideBack(s));
    if (latticeGable) {
      g(0, H0 + 0.05, 2 * nc, 0.1, 0.05, 0.025, HINOKI);
      for (let u = -nc + 0.06; u < nc - 0.05; u += 0.1) {
        const top = U(Math.abs(u) + 0.03) - 0.02;
        if (top - H0 > 0.12) g(u, (H0 + 0.1 + top) / 2, 0.045, top - H0 - 0.1, 0.03, 0.015, HINOKI);
      }
    } else {
      g(0, H0 + 0.09, 2 * nc, 0.14, 0.08, 0.04, HINOKI);
      g(0, (H0 + 0.16 + U(0)) / 2, 0.14, U(0) - H0 - 0.16, 0.07, 0.035, HINOKI);
      for (const f of [0.38, 0.68]) {
        const y = H0 + (U(0) - H0) * f;
        g(0, y, 2 * halfAt(y + 0.05) - 0.04, 0.09, 0.05, 0.025, HINOKI);
      }
    }
    // The barge boards down the verge, both ways from the apex.
    for (const sz of [-1, 1]) {
      const P = (n: number): Point3 => [sgn * (X1 + 0.025), vergeTop(n) - 0.03 - 0.17, sz * n];
      member(P(0), P(n8), 0.05, 0.34, HINOKI, END);
      member(P(n8), P(n6), 0.05, 0.34, HINOKI, START | END);
      member(P(n6), P(nE), 0.05, 0.34, HINOKI, START);
    }
    const ya = vergeTop(0) - 0.34;
    const plate = (x: number): Point3[] => [
      [x, ya + 0.02, 0],
      [x, ya - 0.06, 0.26],
      [x, ya - 0.42, 0.2],
      [x, ya - 0.5, 0],
      [x, ya - 0.42, -0.2],
      [x, ya - 0.06, -0.26],
    ];
    convexSolid(b, plate(sgn * (X1 + 0.045)), plate(sgn * (X1 + 0.085)), HINOKI);
    for (const e of [-1, 1]) sb.box(0.02, 0.06, 0.06, sgn * (X1 + 0.095), ya - 0.2, e * 0.1, BRONZE);
  }

  // --- the tiles: round-tile rows, end tiles, the ridges and demon tiles ----
  {
    const RSP = 0.5;
    const RH = 0.12;
    const segLen = 0.6;
    /** A row of round tiles from `n0` to `n1` on side `s`, `u` along it, ending on an end tile at the eave. */
    const row = (s: Side, u: number, n0: number, n1: number, eaveEnd: boolean): void => {
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
        member(a, c, 0.15, RH, KAWARA_DARK, HIDE_UNDER | START | (last && eaveEnd ? 0 : END));
        if (last && eaveEnd) endTile(a, c, 0.16);
      }
    };
    // The eave tiles' lip, one band along every eave the round ends stand on,
    // swept up with the corners — without it the ends read as battlements.
    for (const s of SIDES) {
      const half = runsAlongX(s) ? ex : ez;
      const nEave = runsAlongX(s) ? ez : ex;
      const N = 12;
      const pt = (i: number): Point3 => {
        const [x, z] = at(s, -half + (2 * half * i) / N, nEave);
        return [x, roofHeight(roof, x, z) - 0.02, z];
      };
      for (let i = 0; i < N; i++) member(pt(i), pt(i + 1), 0.05, 0.1, KAWARA_DARK, (i > 0 ? START : 0) | (i < N - 1 ? END : 0));
    }
    const tX = (ax: number): number => (ex - ax) / (ex - tx);
    for (const s of ["-z", "+z"] as const) {
      const K = Math.floor((ex - 0.25) / RSP - 0.5);
      for (let k = -K - 1; k <= K; k++) {
        const u = (k + 0.5) * RSP;
        const au = Math.abs(u);
        if (au <= gx - 0.1) row(s, u, 0.32, ez + 0.02, true);
        else row(s, u, Math.max(ez * (1 - tX(au)) + 0.14, nE + 0.1), ez + 0.02, true);
      }
    }
    for (const s of ["-x", "+x"] as const) {
      const K = Math.floor((ez - 0.25) / RSP - 0.5);
      for (let k = -K - 1; k <= K; k++) {
        const u = (k + 0.5) * RSP;
        const au = Math.abs(u);
        const hip = ex - (ex - tx) * (1 - au / ez) + 0.14;
        row(s, u, au <= nE + 0.05 ? Math.max(hip, X1 + 0.12) : hip, ex + 0.02, true);
      }
    }
    // The verge: a roll of tiles along each edge of it.
    for (const sgn of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const P = (n: number): Point3 => [sgn * (X1 - 0.04), vergeTop(n) + 0.05, sz * n];
        member(P(0.3), P(n8), 0.1, 0.1, KAWARA_DARK, HIDE_UNDER | START | END);
        member(P(n8), P(nE), 0.1, 0.1, KAWARA_DARK, HIDE_UNDER | START);
      }
    }
    // The main ridge: a base, courses banded in white, a round cap, a demon tile each end.
    const RL = 2 * (X1 + 0.06);
    const ry0 = T(1) - 0.05;
    sb.box(RL, 0.3, 0.62, 0, ry0 - 0.15, 0, KAWARA_DARK, undefined, HIDE_UNDER);
    let ridgeY = ry0;
    for (let i = 0; i < 3; i++) {
      const depth = 0.58 - i * 0.07;
      sb.box(RL, 0.08, depth, 0, ridgeY + 0.04, 0, KAWARA_DARK, undefined, HIDE_UNDER);
      ridgeY += 0.08;
      if (i < 2) {
        sb.box(RL - 0.04, 0.028, depth - 0.05, 0, ridgeY + 0.014, 0, SHIKKUI, undefined, HIDE_UNDER);
        ridgeY += 0.028;
      }
    }
    sb.box(RL, 0.16, 0.3, 0, ridgeY + 0.08, 0, KAWARA_DARK, undefined, HIDE_UNDER);
    for (const sx of [-1, 1]) {
      const ox = sx * (RL / 2 + 0.02);
      sb.box(0.14, 0.66, 0.74, ox, ry0 + 0.27, 0, KAWARA_DARK);
      sb.box(0.14, 0.3, 0.46, ox, ry0 + 0.74, 0, KAWARA_DARK);
      sb.box(0.14, 0.3, 0.13, ox + sx * 0.02, ry0 + 0.94, 0, KAWARA_DARK, { z: -sx * 0.35 });
    }
    /** A ridge from `a` to `c`: a body, a white band and a cap. */
    const ridgeRun = (a: Point3, c: Point3): void => {
      const up = (p0: Point3, dy: number): Point3 => [p0[0], p0[1] + dy, p0[2]];
      member(up(a, 0.1), up(c, 0.1), 0.3, 0.22, KAWARA_DARK, HIDE_UNDER | START | END);
      member(up(a, 0.09), up(c, 0.09), 0.33, 0.03, SHIKKUI, START | END | TOP | HIDE_UNDER);
      member(up(a, 0.26), up(c, 0.26), 0.18, 0.1, KAWARA_DARK, HIDE_UNDER | START | END);
    };
    const oni = (p0: Point3, yaw: number): void => {
      sb.box(0.5, 0.58, 0.14, p0[0], p0[1] + 0.28, p0[2], KAWARA_DARK, { y: yaw });
      sb.box(0.34, 0.3, 0.2, p0[0], p0[1] + 0.28, p0[2], KAWARA_DARK, { y: yaw });
      sb.box(0.15, 0.15, 0.12, p0[0], p0[1] + 0.62, p0[2], KAWARA_DARK, { y: yaw, z: Math.PI / 4 });
    };
    for (const [sx, sz] of CORNERS) {
      // The gable's descending ridge down the verge, a demon tile at its foot.
      const V = (n: number): Point3 => [sx * (X1 - 0.24), vergeTop(n), sz * n];
      const nFoot = nE - 0.24;
      ridgeRun(V(0.28), V(n8));
      ridgeRun(V(n8), V(nFoot));
      oni(V(nFoot + 0.02), 0);
      // The hip ridge from under it to the corner of the eave.
      const Hp = (f: number, lift: number): Point3 => {
        const x = sx * (tx + f * (ex - tx));
        const z = sz * f * ez;
        return [x, roofHeight(roof, x, z) + lift, z];
      };
      const f0 = 0.45;
      const fOni = 1 - 0.65 / Math.hypot(ex - tx, ez);
      for (let j = 0; j < 3; j++) {
        const fa = f0 + ((fOni - f0) * j) / 3;
        const fb = f0 + ((fOni - f0) * (j + 1)) / 3;
        ridgeRun(Hp(fa, 0), Hp(fb, 0));
      }
      oni(Hp(fOni + 0.01, 0), Math.atan2(sx * (ex - tx), sz * ez));
      const a = Hp(fOni + 0.02, 0.07);
      const c = Hp(1.0, 0.07);
      member(a, c, 0.22, 0.16, KAWARA_DARK, HIDE_UNDER | START);
      endTile(a, c, 0.22);
    }
  }

  sb.flush(b);

  // --- the cores, emitted after what hides them ------------------------------------
  b.box(side, wallH, t, -off, wy, fz, SUMI);
  b.box(side, wallH, t, off, wy, fz, SUMI);
  b.box(door, lintel, t, 0, wy + wallH / 2 - lintel / 2, fz, SUMI);
  b.box(w, wallH, t, 0, wy, d / 2 - t / 2, SUMI);
  b.box(t, wallH, d, -w / 2 + t / 2, wy, 0, SUMI);
  b.box(t, wallH, d, w / 2 - t / 2, wy, 0, SUMI);
  // The dark between the plate and the lining, closed along every wall line.
  const wallTop = F0 + wallH;
  for (const sz of [-1, 1]) {
    const top = Math.max(soffit(0, sz * d / 2), soffit(w / 2, sz * d / 2)) + 0.1;
    b.box(w, top - wallTop + 0.02, t, 0, (top + wallTop - 0.02) / 2, sz * (d / 2 - t / 2), SUMI);
  }
  for (const sx of [-1, 1]) {
    const top = Math.max(soffit(sx * w / 2, 0), soffit(sx * w / 2, d / 2)) + 0.1;
    b.box(t, top - wallTop + 0.02, d, sx * (w / 2 - t / 2), (top + wallTop - 0.02) / 2, 0, SUMI);
  }
  b.box(2 * DW - 0.2, F0 - 0.05 - foot, 2 * DD - 0.2, 0, (F0 - 0.05 + foot) / 2, 0, SUMI);

  // --- the roof: the lining, the verge and the gables, then the sheet --------------
  curvedRoof(b, CEDAR, { ...roof, raise: -TH - 0.004, thick: 0.02 });
  for (const sz of [-1, 1]) {
    const P = (x: number, n: number, drop: number): Point3 => [x, vergeTop(n) - drop, sz * n];
    const strip = (na: number, nb: number, x0: number, x1: number): void => {
      const prof = (x: number): Point3[] => [P(x, na, 0), P(x, nb, 0), P(x, nb, TH), P(x, na, TH)];
      convexSolid(b, prof(x0), prof(x1), KAWARA);
    };
    strip(0, n8, -X1, X1);
    strip(n8, n6, -X1, X1);
    for (const sx of [-1, 1]) strip(n6, nE, sx * gx, sx * X1);
  }
  const tymp = latticeGable ? SUMI : SHIKKUI;
  for (const sx of [-1, 1]) {
    const pent = (x: number): Point3[] => [
      [x, B, -n8],
      [x, U(n8), -n8],
      [x, U(0), 0],
      [x, U(n8), n8],
      [x, B, n8],
    ];
    convexSolid(b, pent(sx * (gx - 0.3)), pent(sx * gx), tymp);
    for (const sz of [-1, 1]) {
      const tri = (x: number): Point3[] => [
        [x, B, sz * n8],
        [x, U(n8), sz * n8],
        [x, B, sz * nc],
      ];
      convexSolid(b, tri(sx * (gx - 0.3)), tri(sx * gx), tymp);
    }
  }
  curvedRoof(b, KAWARA, roof);
  if (p.lit) b.light("#ffb866", 9, 1.1, 0.06, 0, floorY + 1.8, 0);
  return b;
}
