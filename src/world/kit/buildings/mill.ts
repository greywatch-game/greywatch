/**
 * kit/buildings/mill.ts — buildMill: the stone and weatherboard mill under a
 * slate roof.
 * Part of the buildings set: follows the contract in kit/core.ts; the set's
 * files are listed in `./index.ts`.
 */
import { Scene } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import {
  Build,
  type Point3,
  type Structure,
  carve,
  convexSolid,
  onFace,
  outward,
  runsAlongX,
  type Hole,
  type Side,
  CASEMENT,
  DARK_STONE,
  FLAME,
  IRON,
  MOSS_STONE,
  PLANK,
  SAILCLOTH,
  SLATE,
  STONE,
  THATCH,
  TIMBER,
} from "../core";
import { LAMPLIT, SHOPLIT, offFace, casement, ROOF_PITCH, WEATHERBOARD } from "./village";

/**
 * The mill: a stone ground storey under two weatherboarded ones, a steep slate
 * roof with its gables to the lane and the back, a lucam over the loading doors,
 * and a breastshot wheel on the west face turning in a stone pit. The ground
 * floor is the MEAL floor, entered by the lane door: the gearing the wheel
 * drives, the spouts the stones above deliver into, and the sacks.
 *
 * **The shell's colliders are the ones it has always had, in the order it has
 * always emitted them** — the doorway's jambs and head, the three other walls,
 * the roof's flat slab at the eaves (`gableRoof`'s, stated by hand now) and the
 * wheel's block. The tavern's rule, whose header argues it.
 *
 * **What was wrong was that it read as a plaster box with a disc on the side.**
 * Nine metres of plaster to the eaves with a timber post at each corner, a
 * shallow thatch, a "stone base" that was one box stood in front of the doorway
 * the colliders had always left open — so the room behind was walked into
 * through a wall — and a waterwheel that was a flat cylinder with eight boards
 * on its face, standing on nothing. It is now the things a watermill is
 * recognised by:
 *
 * - **Stone below and weatherboard above**, the stone storey turning its
 *   corners in quoins with dressed openings, an offset course and a sole plate
 *   at the change, and the boards LAPPED — each one tipped out at its foot, so
 *   every course is a shading band and a bend for the ink rather than a stripe.
 * - **A roof that sheds water**: slate at `ROOF_PITCH`, cut plumb at the eave
 *   (the smithy's construction) and carried past the gables on bargeboards.
 * - **The lucam**: a boarded hoist housing hung off the lane gable on brackets,
 *   the loading doors stacked under it and the chain hanging off its beam.
 * - **A wheel that is built**: two shrouds, the soaling and the buckets between
 *   them, eight arms a side off a hooped nave, and the axle carried through the
 *   wall on one side and onto a bearing on a stone pier on the other. It turns
 *   in a stone pit with a sluice at its head, and is heard.
 *
 * **The meal floor is FLOORED and its furniture is solid.** Five colliders
 * after the shell's, so its prefix of the bake is unchanged: the walked floor
 * (the tavern's, for its reasons), the gear pit's railing — `porous`, since it
 * is a rail round machinery, stops a body and is no cover — a meal bin under
 * the lane window, the sacks stood against the east wall, and the foot of the
 * stair. Everything overhead is drawing: the pit wheel on the axle, the
 * wallower, the upright shaft, the great spur wheel and the stone nuts whose
 * spindles go up to the stones, the spouts that bring the meal back down, and
 * the joists, the beams and the traps of the floor above. The way from the
 * door into the room is kept clear.
 *
 * **Everything outside the walls is inside the wheel's block or is drawing**:
 * the pier, the pit and the sluice stand within that collider, so the lane the
 * wheel turns over — Hollowmere's creek — gains nothing a body can walk into.
 */
export function buildMill(scene: Scene, mats: CelMaterialFactory): Structure {
  const b = new Build(scene, mats, "mill");
  const w = 10;
  const d = 9;
  const h = 9;
  const t = 0.45;
  const wheelR = 3.2;
  const wx = -w / 2 - 0.9;
  const wy = wheelR - 0.6;

  // ------------------------------------------------------------ the masses
  //
  // Every collider the shell has. See the header before adding to it. The
  // lane wall is the three boxes `doorWall` laid, stated by hand because the
  // wall drawn over them is stone below and board above.
  const gap = 1.8;
  const gapH = 2.3;
  const side = (w - gap) / 2;
  for (const k of [-1, 1]) b.block({ w: side, h, d: t, x: k * (gap / 2 + side / 2), y: h / 2, z: -d / 2 });
  b.block({ w: gap, h: h - gapH, d: t, x: 0, y: h - (h - gapH) / 2, z: -d / 2 });
  b.block({ w, h, d: t, x: 0, y: h / 2, z: d / 2 });
  b.block({ w: t, h, d, x: -w / 2, y: h / 2, z: 0 });
  b.block({ w: t, h, d, x: w / 2, y: h / 2, z: 0 });
  // The roof's collider: exactly the slab `gableRoof` laid at the eaves.
  b.block({ w: w + 0.7, h: 0.3, d: d + 0.7, x: 0, y: h, z: 0 });
  b.block({ w: 2, h: wheelR * 2, d: wheelR * 2, x: wx, y: wy, z: 0 });

  // ----------------------------------------------------------- the drawing
  /** The walls' outer faces, and the meal floor's inner ones. */
  const gx = w / 2 + t / 2;
  const gz = d / 2 + t / 2;
  const ix = w / 2 - t / 2;
  const iz = d / 2 - t / 2;
  /** The meal floor, and the first floor, which is where the stone stops. */
  const F = 0.2;
  const S = 4.6;
  /** How far the stone runs down past the placement, as a footing. */
  const foot = -1.2;

  // ---- the stone storey: the walls' own boxes, stopped at `S`, and the lane
  // wall round its doorway.
  {
    const sH = S - foot;
    const sY = (S + foot) / 2;
    for (const k of [-1, 1]) b.box(side, sH, t, k * (gap / 2 + side / 2), sY, -d / 2, STONE);
    b.box(gap, S - gapH, t, 0, (S + gapH) / 2, -d / 2, STONE);
    b.box(gap, -foot, t, 0, foot / 2, -d / 2, STONE);
    b.box(w, sH, t, 0, sY, d / 2, STONE);
    for (const k of [-1, 1]) b.box(t, sH, d, (k * w) / 2, sY, 0, STONE);
    // A plinth course, cut at the doorway.
    const pH = 0.5 - foot;
    const pY = (0.5 + foot) / 2;
    for (const k of [-1, 1]) b.box(side + 0.16, pH, 0.2, k * (gap / 2 + (side + 0.16) / 2), pY, -gz + 0.02, DARK_STONE);
    b.box(w + 0.16, pH, 0.2, 0, pY, gz - 0.02, DARK_STONE);
    for (const k of [-1, 1]) b.box(0.2, pH, d + 0.16, k * (gx - 0.02), pY, 0, DARK_STONE);
  }
  // Quoins at the four corners, long and short, standing proud of both faces.
  {
    const QN = 11;
    const QH = (S - 0.5) / QN;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (let i = 0; i < QN; i++) {
          const [lx, lz] = i % 2 === 0 ? [0.62, 0.38] : [0.36, 0.64];
          b.box(lx, QH, lz, sx * (gx + 0.06 - lx / 2), 0.5 + (i + 0.5) * QH, sz * (gz + 0.06 - lz / 2), DARK_STONE);
        }
      }
    }
  }
  // The offset course where the stone stops, and the sole plate the timber
  // storeys stand on.
  b.box(w + 0.3, 0.16, d + 0.3, 0, S - 0.08, 0, DARK_STONE);
  b.box(w + 0.22, 0.22, d + 0.22, 0, S + 0.11, 0, TIMBER);

  // ---- the doorway: dressed jambs through the wall, an oak lintel, a worn
  // stone threshold and a step, and the leaves hung open against the inside.
  {
    const JN = 7;
    const JH = (gapH - F) / JN;
    for (const sx of [-1, 1]) {
      for (let i = 0; i < JN; i++) {
        const lx = i % 2 === 0 ? 0.5 : 0.3;
        b.box(lx, JH, t + 0.08, sx * (gap / 2 + lx / 2 - 0.03), F + (i + 0.5) * JH, -d / 2, DARK_STONE);
      }
    }
    b.box(gap + 0.9, 0.34, t + 0.1, 0, gapH + 0.17, -d / 2, TIMBER);
    // A datestone over it.
    onFace(b, "-z", gz, 0, 3.35, 0.7, 0.45, 0.08, 0.02, DARK_STONE);
    // The threshold stands proud of the boards it meets — the tavern's note on
    // two coplanar floors of two colours.
    b.box(gap, F + 0.03, t + 0.1, 0, (F + 0.03) / 2, -d / 2, DARK_STONE);
    b.box(gap + 0.5, 0.3, 0.5, 0, -0.05, -gz - 0.22, DARK_STONE);
    for (const k of [-1, 1]) {
      const u = k * (gap / 2 + 0.47);
      const mid = F + (gapH - F) / 2;
      onFace(b, "+z", -iz, u, mid, 0.9, gapH - F - 0.05, 0.06, 0.03, PLANK);
      for (let j = 1; j < 3; j++) onFace(b, "+z", -iz, u - 0.45 + j * 0.3, mid, 0.025, gapH - F - 0.1, 0.02, 0.065, TIMBER);
      for (const y of [F + 0.45, gapH - 0.45]) onFace(b, "+z", -iz, u, y, 0.82, 0.12, 0.03, 0.07, TIMBER);
    }
  }

  /** A window in the stone storey: a casement under a dressed lintel over a stone sill, glazed on both faces. */
  const stoneWindow = (s: Side, u: number, sill: number, ww: number, wh: number, lit?: string): void => {
    const plane = runsAlongX(s) ? gz : gx;
    const inner = runsAlongX(s) ? iz : ix;
    casement(b, s, plane, u, sill, ww, wh, { lit });
    onFace(b, s, plane, u, sill + wh + 0.27, ww + 0.6, 0.3, 0.2, 0.06, DARK_STONE);
    onFace(b, s, plane, u, sill - 0.18, ww + 0.4, 0.12, 0.3, 0.1, DARK_STONE);
    const back: Side = s === "-z" ? "+z" : s === "+z" ? "-z" : s === "-x" ? "+x" : "-x";
    casement(b, back, -inner, u, sill, ww, wh);
  };
  for (const k of [-1, 1]) stoneWindow("-z", k * 3.0, 1.3, 0.9, 1.0, SHOPLIT);
  stoneWindow("+x", 1.8, 1.3, 0.9, 1.0, SHOPLIT);
  stoneWindow("+x", -1.9, 1.3, 0.9, 1.0);
  stoneWindow("+z", -1.0, 1.4, 0.9, 1.0);

  // ---- the timber storeys: a backing in each wall's own box, the gables
  // carried up under the roof, and the boards LAPPED over them.
  const kP = ROOF_PITCH;
  const pitch = Math.atan(kP);
  const cosP = Math.cos(pitch);
  /** The slate's underside at `x` from the ridge. */
  const under = (x: number): number => h - 0.02 + (gx - x) * kP;
  for (const k of [-1, 1]) b.box(t, h - S, d, (k * w) / 2, (S + h) / 2, 0, WEATHERBOARD);
  for (const sz of [-1, 1]) {
    const zc = (sz * d) / 2;
    const face = (z: number): Point3[] => [
      [-gx, S, z],
      [gx, S, z],
      [gx, under(gx), z],
      [0, under(0), z],
      [-gx, under(gx), z],
    ];
    convexSolid(b, face(zc - t / 2), face(zc + t / 2), WEATHERBOARD);
  }
  /** One course's pitch, and how far each board is tipped out at its foot. */
  const BP = 0.26;
  const LAP = 0.1;
  const board = (s: Side, plane: number, u: number, y: number, len: number, tall: number): void => {
    const n = outward(s);
    const c = n * (plane + 0.035);
    if (runsAlongX(s)) b.box(len, tall, 0.03, u, y, c, WEATHERBOARD, { x: -n * LAP });
    else b.box(0.03, tall, len, c, y, u, WEATHERBOARD, { z: n * LAP });
  };
  /**
   * Courses up a face from `y0` to `y1`, each as long as `span` allows at its
   * middle — so a gable's board ends step either side of the rake, into the
   * slate above and under the trim below — and stopped at every opening.
   */
  const clad = (s: Side, plane: number, span: (y: number) => [number, number], y0: number, y1: number, holes: Hole[]): void => {
    for (let yb = y0; yb < y1 - 0.06; yb += BP) {
      const yt = Math.min(yb + BP, y1);
      const [a0, a1] = span((yb + yt) / 2);
      if (a1 - a0 < 0.2) break;
      const cuts = holes.filter((o) => yt > o.y0 && yb < o.y1).map((o): [number, number] => [o.u0, o.u1]);
      for (const [a, c] of carve(a0, a1, cuts)) {
        if (c - a > 0.1) board(s, plane, (a + c) / 2, (yb + yt) / 2, c - a, yt - yb + 0.04);
      }
    }
  };
  /** The half-width of a gable at height `y`: the wall's, until the rake takes it in. */
  const gableHalf = (y: number): number => Math.min(gx, gx - (y - (h - 0.02)) / kP - 0.05);
  const boardFoot = S + 0.22;
  /** Openings in the boards stand their frames on the boards, not on the backing. */
  const onBoards = 0.05;

  /** A pair of ledged loading doors in a frame, shut: the loading stack under the lucam. */
  const hatch = (s: Side, plane: number, u: number, y0: number, dw: number, dh: number): Hole => {
    const p = plane + onBoards;
    const mid = y0 + dh / 2;
    for (const k of [-1, 1]) {
      onFace(b, s, p, u + (k * dw) / 4, mid, dw / 2 - 0.02, dh, 0.06, 0.02, PLANK);
      for (const y of [y0 + 0.25, mid, y0 + dh - 0.25]) onFace(b, s, p, u + (k * dw) / 4, y, dw / 2 - 0.1, 0.1, 0.03, 0.06, TIMBER);
      for (const y of [y0 + 0.25, y0 + dh - 0.25]) onFace(b, s, p, u + k * (dw / 2 - 0.2), y, 0.36, 0.05, 0.02, 0.085, IRON);
      onFace(b, s, p, u + k * (dw / 2 + 0.07), mid + 0.05, 0.14, dh + 0.1, 0.14, 0.04, TIMBER);
    }
    onFace(b, s, p, u, y0 + dh + 0.08, dw + 0.3, 0.16, 0.16, 0.04, TIMBER);
    onFace(b, s, p, u, y0 - 0.07, dw + 0.3, 0.14, 0.24, 0.08, TIMBER);
    return { u0: u - dw / 2 - 0.16, u1: u + dw / 2 + 0.16, y0: y0 - 0.14, y1: y0 + dh + 0.16 };
  };
  /** A casement in the boards. */
  const boardWindow = (s: Side, u: number, sill: number, ww: number, wh: number, lit?: string): Hole => {
    const plane = (runsAlongX(s) ? gz : gx) + onBoards;
    return casement(b, s, plane, u, sill, ww, wh, { lit });
  };

  // The lucam's footprint on the lane gable, and the doors stacked under it.
  const L0 = 8.75;
  const L1 = 10.85;
  const LW = 1.25;
  const LD = 1.2;
  const front: Hole[] = [
    hatch("-z", gz, 0, S + 0.4, 1.1, 1.6),
    hatch("-z", gz, 0, 7.0, 1.1, 1.45),
    boardWindow("-z", -3.1, S + 0.6, 0.9, 1.0, LAMPLIT),
    boardWindow("-z", 3.1, S + 0.6, 0.9, 1.0),
    boardWindow("-z", -3.1, 7.2, 0.9, 0.9),
    boardWindow("-z", 3.1, 7.2, 0.9, 0.9),
    { u0: -LW - 0.05, u1: LW + 0.05, y0: L0 - 0.1, y1: L1 },
  ];
  const back: Hole[] = [
    boardWindow("+z", 2.5, S + 0.6, 0.9, 1.0),
    boardWindow("+z", -2.5, 7.2, 0.9, 0.9),
  ];
  // The owl hole in the back gable's apex.
  {
    const y = under(0) - 1.0;
    onFace(b, "+z", gz + onBoards, 0, y, 0.34, 0.34, 0.04, 0.01, CASEMENT);
    for (const k of [-1, 1]) {
      onFace(b, "+z", gz + onBoards, k * 0.24, y, 0.12, 0.6, 0.14, 0.05, TIMBER);
      onFace(b, "+z", gz + onBoards, 0, y + k * 0.24, 0.6, 0.12, 0.14, 0.05, TIMBER);
    }
    back.push({ u0: -0.32, u1: 0.32, y0: y - 0.32, y1: y + 0.32 });
  }
  const east: Hole[] = [
    boardWindow("+x", 2.4, S + 0.6, 0.9, 1.0),
    boardWindow("+x", -2.4, S + 0.6, 0.9, 1.0),
    boardWindow("+x", 2.4, 7.2, 0.9, 0.9),
    boardWindow("+x", -2.4, 7.2, 0.9, 0.9),
  ];
  // The wheel side: clear of the wheel's top, which reaches the first floor.
  const west: Hole[] = [
    boardWindow("-x", -2.7, S + 0.6, 0.9, 1.0),
    boardWindow("-x", 2.7, 7.2, 0.9, 0.9),
  ];
  const gableSpan = (y: number): [number, number] => [-gableHalf(y), gableHalf(y)];
  const sideSpan = (): [number, number] => [-gz, gz];
  clad("-z", gz, gableSpan, boardFoot, under(0), front);
  clad("+z", gz, gableSpan, boardFoot, under(0), back);
  clad("+x", gx, sideSpan, boardFoot, h - 0.02, east);
  clad("-x", gx, sideSpan, boardFoot, h - 0.02, west);
  // Corner boards, lapping both faces at every corner.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box(0.22, h - boardFoot, 0.22, sx * (gx - 0.01), (boardFoot + h) / 2, sz * (gz - 0.01), TIMBER);
      // A trim board up each rake on the gable's face, over the stepped ends
      // of the courses under it.
      const trim = (z: number): Point3[] => [
        [0, under(0) + 0.05, z],
        [sx * (gx + 0.1), under(gx + 0.1) + 0.05, z],
        [sx * (gx + 0.1), under(gx + 0.1) - 0.3, z],
        [0, under(0) - 0.3, z],
      ];
      convexSolid(b, trim(sz * (gz - 0.02)), trim(sz * (gz + 0.09)), TIMBER);
    }
  }

  // ---- the roof, described by its UNDERSIDE and cut plumb at the eave — the
  // smithy's construction, carried past the gables as a verge.
  const T = 0.24;
  const verge = 0.4;
  const xe = gx + 0.5;
  const topAt = (x: number): number => under(x) + T / cosP;
  const ridgeTop = topAt(0);
  const vz = gz + verge;
  /** A slab in the roof plane on side `sx`: see the smithy's `slope`. */
  const slope = (sx: number, x0: number, x1: number, o0: number, o1: number, z0: number, z1: number, color: string): void => {
    const section = (z: number): Point3[] => [
      [sx * x0, under(x0) + o0 / cosP, z],
      [sx * x1, under(x1) + o0 / cosP, z],
      [sx * x1, under(x1) + o1 / cosP, z],
      [sx * x0, under(x0) + o1 / cosP, z],
    ];
    convexSolid(b, section(z0), section(z1), color);
  };
  for (const sx of [-1, 1]) {
    slope(sx, 0, xe, 0, T, -vz, vz, SLATE);
    for (const f of [0.14, 0.27, 0.4, 0.53, 0.66, 0.79, 0.91]) {
      const xc = xe * f;
      slope(sx, xc - 0.04, xc + 0.04, T - 0.01, T + 0.035, -vz + 0.05, vz - 0.05, IRON);
    }
    for (let z = -gz + 0.3; z < gz; z += 0.6) {
      slope(sx, gx - 0.05, xe - 0.06, -0.15, 0, z - 0.05, z + 0.05, TIMBER);
    }
    b.box(0.05, 0.22, 2 * vz, sx * (xe + 0.025), under(xe) + 0.07, 0, TIMBER);
  }
  b.box(0.3, 0.3, 2 * vz - 0.1, 0, ridgeTop + 0.02, 0, DARK_STONE, { z: Math.PI / 4 });
  // Bargeboards down each rake, and a pendant where each pair meets.
  for (const sz of [-1, 1]) {
    const zb = sz * (vz + 0.02);
    for (const sx of [-1, 1]) {
      const plank = (z: number): Point3[] => [
        [0, topAt(0) + 0.03, z],
        [sx * (xe + 0.05), topAt(xe) + 0.03, z],
        [sx * (xe + 0.05), under(xe) - 0.22, z],
        [0, under(0) - 0.22, z],
      ];
      convexSolid(b, plank(zb - 0.03), plank(zb + 0.03), TIMBER);
    }
    b.box(0.16, 0.45, 0.16, 0, under(0) - 0.3, zb, TIMBER);
  }

  // ---- the lucam: a boarded box hung off the lane gable on two brackets, a
  // roof of its own with its ridge running out over the lane, doors in its
  // face and the hoist beam out of its apex with the chain hanging off it.
  {
    const z0 = -gz - 0.02;
    const z1 = z0 - LD;
    const zc = (z0 + z1) / 2;
    b.box(2 * LW, L1 - L0, LD, 0, (L0 + L1) / 2, zc, WEATHERBOARD);
    const lk = kP;
    const lUnder = (x: number): number => L1 - 0.02 + (LW - x) * lk;
    const lTop = lUnder(0);
    const gable = (z: number): Point3[] => [
      [-LW, L1 - 0.02, z],
      [LW, L1 - 0.02, z],
      [0, lTop, z],
    ];
    convexSolid(b, gable(z1 + 0.05), gable(z1 + LD - 0.2), WEATHERBOARD);
    const lHoles: Hole[] = [hatch("-z", -z1, 0, L0 + 0.3, 1.2, 1.5)];
    clad("-z", -z1, (y) => {
      const r = Math.min(LW, LW - (y - (L1 - 0.02)) / lk - 0.05);
      return [-r, r];
    }, L0 + 0.02, lTop, lHoles);
    for (const s of ["-x", "+x"] as const) clad(s, LW, () => [z1, z0], L0 + 0.02, L1 - 0.02, []);
    for (const sx of [-1, 1]) {
      const trim = (z: number): Point3[] => [
        [0, lTop + 0.04, z],
        [sx * LW, L1 + 0.02, z],
        [sx * LW, L1 - 0.24, z],
        [0, lTop - 0.22, z],
      ];
      convexSolid(b, trim(z1 + 0.02), trim(z1 - 0.08), TIMBER);
    }
    // Its roof, cut plumb, with a verge over the doors.
    const lT = 0.16;
    const lcos = Math.cos(Math.atan(lk));
    const lxe = LW + 0.2;
    for (const sx of [-1, 1]) {
      const sec = (z: number): Point3[] => [
        [0, lUnder(0), z],
        [sx * lxe, lUnder(lxe), z],
        [sx * lxe, lUnder(lxe) + lT / lcos, z],
        [0, lUnder(0) + lT / lcos, z],
      ];
      convexSolid(b, sec(z0), sec(z1 - 0.3), SLATE);
      const barge = (z: number): Point3[] => [
        [0, lUnder(0) + lT / lcos + 0.02, z],
        [sx * (lxe + 0.03), lUnder(lxe) + lT / lcos + 0.02, z],
        [sx * (lxe + 0.03), lUnder(lxe) - 0.16, z],
        [0, lUnder(0) - 0.16, z],
      ];
      convexSolid(b, barge(z1 - 0.33), barge(z1 - 0.28), TIMBER);
    }
    b.box(0.2, 0.2, z0 - z1 + 0.3, 0, lTop + lT / lcos + 0.05, (z0 + z1 - 0.3) / 2, DARK_STONE, { z: Math.PI / 4 });
    // Corner boards, its floor and the brackets under it.
    for (const sx of [-1, 1]) b.box(0.16, L1 - L0, 0.16, sx * (LW - 0.02), (L0 + L1) / 2, z1 + 0.06, TIMBER);
    b.box(2 * LW + 0.1, 0.16, LD + 0.06, 0, L0 - 0.06, zc, TIMBER);
    for (const sx of [-1, 1]) offFace(b, "-z", gz, sx * (LW - 0.2), 0.16, L0 - 1.3, L0 - 0.16, 0, LD - 0.15, 0.16, TIMBER);
    // The hoist beam, its sheave, and the chain down past the loading doors.
    const beamY = lTop - 0.35;
    const beamZ = z1 - 0.45;
    b.box(0.2, 0.22, 1.5, 0, beamY, z1 + 0.25, TIMBER);
    b.cyl(0.08, 0.34, 0.34, 10, 0, beamY - 0.2, beamZ, IRON, { z: Math.PI / 2 });
    for (const k of [-1, 1]) b.box(0.03, 0.34, 0.1, k * 0.06, beamY - 0.12, beamZ, IRON);
    const chainFoot = 5.3;
    b.box(0.035, beamY - 0.36 - chainFoot, 0.035, 0, (beamY - 0.36 + chainFoot) / 2, beamZ - 0.17, IRON);
    b.box(0.05, 0.14, 0.05, 0, chainFoot - 0.05, beamZ - 0.17, IRON);
    b.box(0.04, 0.04, 0.16, 0, chainFoot - 0.13, beamZ - 0.1, IRON);
  }

  // ---- the lantern by the door, on its bracket: `buildLampPost`'s fixture
  // hung off the stone, and the mill's outside light. It lands on the door and
  // the yard, which is where a lamp on this wall would throw it.
  {
    const lx = gap / 2 + 0.85;
    const lampY = 3.0;
    const lampZ = -gz - 0.55;
    b.box(0.1, 0.1, 0.6, lx, lampY + 0.3, -gz - 0.3, IRON);
    b.box(0.06, 0.4, 0.06, lx, lampY + 0.1, -gz - 0.05, IRON);
    b.cyl(0.62, 0.42, 0.3, 6, lx, lampY, lampZ, IRON);
    b.glow(0.3, 0.3, 0.3, lx, lampY, lampZ, FLAME);
    b.cyl(0.18, 0.1, 0.5, 6, lx, lampY + 0.4, lampZ, IRON);
    b.light(FLAME, 20, 1.8, 0.3, lx, lampY, lampZ);
  }

  // A worn runner stone stood against the east wall, face out, its eye dark.
  {
    const beta = 0.2;
    const R = 0.65;
    const cx = gx + 0.47 - R * Math.sin(beta);
    const cy = R * Math.cos(beta);
    const cz = 3.3;
    b.cyl(0.26, 2 * R, 2 * R, 18, cx, cy, cz, STONE, { z: -(Math.PI / 2 - beta) });
    b.cyl(0.28, 0.24, 0.24, 8, cx, cy, cz, CASEMENT, { z: -(Math.PI / 2 - beta) });
  }

  // --------------------------------------------------------------- the wheel
  //
  // A breastshot wheel: two shrouds with the soaling between them and the
  // buckets across it, eight arms a side off a hooped nave, on an axle carried
  // through the wall and onto a bearing on the pier. All of it — and the pit
  // and the sluice — inside the wheel's collider.
  {
    const WW = 1.1;
    const N = 24;
    const phase = 0.13;
    const depth = 0.5;
    const step = (2 * Math.PI) / N;
    const ring = (r: number): number => 2 * r * Math.sin(step / 2) + 0.03;
    for (const sh of [-1, 1]) {
      const xs = wx + (sh * WW) / 2;
      for (let i = 0; i < N; i++) {
        const a = phase + i * step;
        const r = wheelR - depth / 2;
        b.box(0.08, ring(r), depth, xs, wy + Math.sin(a) * r, Math.cos(a) * r, TIMBER, { x: -a });
        // An iron tie across each shroud joint.
        const aj = a + step / 2;
        const rj = wheelR - 0.1;
        b.box(0.1, 0.06, 0.12, xs + sh * 0.02, wy + Math.sin(aj) * rj, Math.cos(aj) * rj, IRON, { x: -aj });
      }
      for (let i = 0; i < 8; i++) {
        const a = phase + (i * Math.PI) / 4;
        const r0 = 0.45;
        const r1 = wheelR - depth;
        const rm = (r0 + r1) / 2;
        b.box(0.12, 0.15, r1 - r0 + 0.1, xs - sh * 0.1, wy + Math.sin(a) * rm, Math.cos(a) * rm, TIMBER, { x: -a });
      }
    }
    for (let i = 0; i < N; i++) {
      const a = phase + i * step;
      const rs = wheelR - depth + 0.03;
      b.box(WW, ring(rs), 0.05, wx, wy + Math.sin(a) * rs, Math.cos(a) * rs, PLANK, { x: -a });
      // Each bucket leans back from the radial, which is what a breast wheel's
      // buckets do and what lets them hold the water they are given.
      const ab = a + step / 2;
      const rb = wheelR - depth / 2 + 0.02;
      b.box(WW - 0.04, 0.05, depth, wx, wy + Math.sin(ab) * rb, Math.cos(ab) * rb, PLANK, { x: -ab - 0.35 });
    }
    b.cyl(WW + 0.2, 0.95, 0.95, 12, wx, wy, 0, TIMBER, { z: Math.PI / 2 });
    for (const k of [-1, 1]) b.cyl(0.07, 0.99, 0.99, 12, wx + k * (WW / 2 + 0.05), wy, 0, IRON, { z: Math.PI / 2 });
    // The axle, from the pier's bearing into the wall and on to the pit wheel.
    const ax0 = -w / 2 - 1.95;
    const ax1 = -ix + 0.65;
    b.cyl(ax1 - ax0, 0.34, 0.34, 10, (ax0 + ax1) / 2, wy, 0, TIMBER, { z: Math.PI / 2 });
    for (const x of [-ix + 0.1]) b.cyl(0.06, 0.38, 0.38, 10, x, wy, 0, IRON, { z: Math.PI / 2 });
    // The pier, standing on the pit's outer wall, with a plummer block on it.
    const px = -w / 2 - 1.74;
    b.box(0.34, wy - 0.2 - (foot - 0.6), 0.9, px, (wy - 0.2 + foot - 0.6) / 2, 0, STONE);
    b.box(0.42, 0.12, 1.0, px, wy - 0.26, 0, DARK_STONE);
    b.box(0.3, 0.16, 0.5, px, wy - 0.12, 0, IRON);
    b.box(0.34, 0.08, 0.3, px, wy + 0.2, 0, IRON);
    // Where the axle goes through the stone: a dressed surround.
    for (const k of [-1, 1]) {
      onFace(b, "-x", gx, k * 0.42, wy, 0.22, 0.9, 0.12, 0.03, DARK_STONE);
      onFace(b, "-x", gx, 0, wy + k * 0.42, 0.62, 0.22, 0.12, 0.03, DARK_STONE);
    }

    // The pit: its outer wall under the pier, an end wall downstream, dark
    // water, and the sluice at its head.
    const pz = 3.12;
    const pitX0 = -w / 2 - 1.9;
    const pitX1 = -gx;
    const wallTop = 0.15;
    b.box(0.28, wallTop - (foot - 0.6), 2 * pz, pitX0 + 0.14, (wallTop + foot - 0.6) / 2, 0, STONE);
    b.box(0.36, 0.12, 2 * pz + 0.08, pitX0 + 0.14, wallTop + 0.06, 0, MOSS_STONE);
    b.box(pitX1 - pitX0, wallTop - (foot - 0.6), 0.26, (pitX0 + pitX1) / 2, (wallTop + foot - 0.6) / 2, -pz + 0.13, STONE);
    b.box(pitX1 - pitX0, 0.12, 0.34, (pitX0 + pitX1) / 2, wallTop + 0.06, -pz + 0.13, MOSS_STONE);
    b.box(pitX1 - pitX0 - 0.28, 0.04, 2 * pz - 0.3, (pitX0 + 0.28 + pitX1) / 2, -0.42, (0.26 - 0.04) / 2, CASEMENT);
    {
      // Low, because the wheel fills its block to within a few centimetres of
      // the end: anything standing over a metre at the pit's head is in the
      // buckets.
      const sz = pz - 0.08;
      const x0 = pitX0 + 0.16;
      const x1 = pitX1 - 0.12;
      for (const x of [x0, x1]) b.box(0.16, 1.6, 0.16, x, 0.1, sz, TIMBER);
      b.box(x1 - x0 + 0.3, 0.18, 0.2, (x0 + x1) / 2, 0.95, sz, TIMBER);
      b.box(x1 - x0 - 0.12, 0.9, 0.08, (x0 + x1) / 2, -0.1, sz, PLANK);
      b.box(x1 - x0 - 0.12, 0.08, 0.1, (x0 + x1) / 2, 0.31, sz, TIMBER);
      const rx = (x0 + x1) / 2;
      b.box(0.05, 1.0, 0.05, rx, 0.8, sz, IRON);
      b.box(0.2, 0.2, 0.24, rx, 1.12, sz + 0.02, IRON);
      b.cyl(0.04, 0.45, 0.45, 10, rx, 1.22, sz + 0.14, IRON, { x: Math.PI / 2 });
    }
    b.sound("stream", wx, -0.3, 0);
  }

  // ------------------------------------------------------------ the meal floor
  //
  // The walked floor, over the whole footprint and the threshold: the tavern's
  // collider, for its reasons. Then the room's four solid things.
  b.box(2 * ix, F, 2 * iz, 0, F / 2, 0, PLANK);
  b.block({ w, h: 1.3, d: d + t, x: 0, y: F - 0.65, z: 0 });

  // ---- the floor above, seen from below: two beams across the room on stone
  // corbels, joists over them, and the boards — the joists trimmed round the
  // two traps, the sack trap's and the stair's, whose leaves are shut.
  const beamX = [-1.2, 2.2];
  const beamY = S - 0.44;
  /** The sack trap, over the middle of the room. */
  const sackTrap = { x0: -0.05, x1: 1.25, z0: -0.6, z1: 0.6 };
  /** The stair's trap, in the back corner. */
  const stairTrap = { x0: 3.35, x1: ix, z0: iz - 1.05, z1: iz };
  b.box(2 * ix, 0.06, 2 * iz, 0, S - 0.03, 0, PLANK);
  for (let z = -iz + 0.3; z < iz; z += 0.6) {
    const cuts = [sackTrap, stairTrap]
      .filter((o) => z + 0.06 > o.z0 && z - 0.06 < o.z1)
      .map((o): [number, number] => [o.x0, o.x1]);
    for (const [a, c] of carve(-ix, ix, cuts)) b.box(c - a, 0.2, 0.12, (a + c) / 2, S - 0.16, z, TIMBER);
  }
  for (const x of beamX) {
    b.box(0.32, 0.36, 2 * iz, x, beamY, 0, TIMBER);
    for (const k of [-1, 1]) b.box(0.44, 0.2, 0.3, x, beamY - 0.28, k * (iz - 0.15), DARK_STONE);
  }
  for (const o of [sackTrap, stairTrap]) {
    for (const x of [o.x0, o.x1]) if (Math.abs(x) < ix - 0.05) b.box(0.12, 0.2, o.z1 - o.z0, x, S - 0.16, (o.z0 + o.z1) / 2, TIMBER);
    for (const z of [o.z0, o.z1]) if (Math.abs(z) < iz - 0.05) b.box(o.x1 - o.x0, 0.2, 0.12, (o.x0 + o.x1) / 2, S - 0.16, z, TIMBER);
  }
  {
    const o = sackTrap;
    const tx = (o.x0 + o.x1) / 2;
    for (const k of [-1, 1]) {
      const lz = (k * (o.z1 - o.z0)) / 4;
      b.box(o.x1 - o.x0 - 0.1, 0.04, (o.z1 - o.z0) / 2 - 0.08, tx, S - 0.08, lz, PLANK);
      for (const x of [tx - 0.35, tx + 0.35]) b.box(0.05, 0.03, 0.4, x, S - 0.11, lz + k * 0.05, IRON);
    }
    // The hoist chain let down through it, its hook clear of a head.
    const hook = 2.35;
    b.box(0.035, S - 0.1 - hook, 0.035, tx + 0.3, (S - 0.1 + hook) / 2, 0.02, IRON);
    b.box(0.05, 0.14, 0.05, tx + 0.3, hook - 0.05, 0.02, IRON);
    b.box(0.16, 0.04, 0.04, tx + 0.36, hook - 0.13, 0.02, IRON);
  }

  // ---- the gearing, in the pit by the wheel wall. The axle comes through the
  // wall onto the PIT WHEEL; that drives the WALLOWER on the UPRIGHT SHAFT, and
  // the GREAT SPUR WHEEL at its head drives a STONE NUT under each pair of
  // stones, whose spindle goes up through the floor to them. The meal comes
  // back down the SPOUTS. A rail round the pit is the collider.
  const shaftX = -3.55;
  {
    const pwX = -ix + 0.52;
    const pwR = 1.1;
    const n = 16;
    const st = (2 * Math.PI) / n;
    for (let i = 0; i < n; i++) {
      const a = i * st + 0.1;
      const r = pwR - 0.11;
      b.box(0.16, 2 * r * Math.sin(st / 2) + 0.03, 0.22, pwX, wy + Math.sin(a) * r, Math.cos(a) * r, TIMBER, { x: -a });
    }
    for (let i = 0; i < 32; i++) {
      const a = (i * Math.PI) / 16;
      const r = pwR - 0.1;
      b.box(0.12, 0.08, 0.14, pwX + 0.14, wy + Math.sin(a) * r, Math.cos(a) * r, PLANK, { x: -a });
    }
    // Clasp arms: two pairs of bars either side of the axle, a square round it.
    const ca = 0.2;
    const reach = 2 * Math.sqrt((pwR - 0.18) ** 2 - ca * ca);
    for (const k of [-1, 1]) {
      b.box(0.12, 0.14, reach, pwX - 0.03, wy + k * ca, 0, TIMBER);
      b.box(0.12, reach, 0.14, pwX + 0.03, wy, k * ca, TIMBER);
    }
    // The inner bearing on its stone.
    b.box(0.36, wy - 0.2 - F, 0.6, -ix + 0.18, (wy - 0.2 + F) / 2, 0, DARK_STONE);
    b.box(0.3, 0.16, 0.5, -ix + 0.16, wy - 0.12, 0, IRON);

    // The wallower meshing the pit wheel's top.
    const wlY = wy + pwR + 0.16;
    b.cyl(0.16, 1.0, 1.0, 16, shaftX, wlY, 0, TIMBER);
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8;
      b.box(0.06, 0.12, 0.1, shaftX + 0.5 * Math.cos(a), wlY - 0.13, 0.5 * Math.sin(a), PLANK, { y: -a });
    }
    // The upright shaft, octagonal, on its footstep and banded.
    b.box(0.6, 0.3, 0.6, shaftX, F + 0.15, 0, DARK_STONE);
    b.box(0.3, 0.12, 0.3, shaftX, F + 0.36, 0, IRON);
    b.cyl(S - F - 0.4, 0.34, 0.34, 8, shaftX, (S + F + 0.4) / 2, 0, TIMBER);
    for (const y of [1.2, wlY + 0.15, 4.0]) b.cyl(0.05, 0.38, 0.38, 8, shaftX, y, 0, IRON);

    // The great spur wheel under the floor, and a stone nut at each side.
    const gsY = S - 0.47;
    const gsR = 1.0;
    const m = 20;
    const gst = (2 * Math.PI) / m;
    for (let i = 0; i < m; i++) {
      const a = i * gst;
      const r = gsR - 0.1;
      b.box(0.2, 0.16, 2 * r * Math.sin(gst / 2) + 0.03, shaftX + Math.cos(a) * r, gsY, Math.sin(a) * r, TIMBER, { y: -a });
    }
    for (let i = 0; i < 40; i++) {
      const a = (i * Math.PI) / 20;
      b.box(0.1, 0.13, 0.06, shaftX + Math.cos(a) * (gsR + 0.04), gsY, Math.sin(a) * (gsR + 0.04), PLANK, { y: -a });
    }
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3 + 0.26;
      const r = (gsR - 0.2 + 0.2) / 2;
      b.box(gsR - 0.3, 0.13, 0.13, shaftX + Math.cos(a) * r, gsY, Math.sin(a) * r, TIMBER, { y: -a });
    }
    for (const k of [-1, 1]) {
      const nz = k * (gsR + 0.36);
      b.cyl(0.18, 0.56, 0.56, 12, shaftX, gsY, nz, TIMBER);
      for (let i = 0; i < 12; i++) {
        const a = (i * Math.PI) / 6;
        b.box(0.1, 0.13, 0.06, shaftX + Math.cos(a) * 0.3, gsY, nz + Math.sin(a) * 0.3, PLANK, { y: -a });
      }
      b.cyl(S - 3.3, 0.07, 0.07, 6, shaftX, (S + 3.3) / 2, nz, IRON);
      // The bridge tree the spindle's foot rests on, and its tentering rod.
      b.box(ix + shaftX + 0.95, 0.18, 0.2, (-ix + shaftX + 0.95) / 2, 3.2, nz, TIMBER);
      b.box(0.04, 1.2, 0.04, shaftX + 0.85, 2.65, nz, IRON);
      // The meal spout from the stones above, out over the rail to a sack.
      const top: [number, number] = [shaftX + 0.55, S - 0.06];
      const bot: [number, number] = [-1.75, 1.35];
      const dx = top[0] - bot[0];
      const dy = top[1] - bot[1];
      b.box(0.16, Math.hypot(dx, dy), 0.16, (top[0] + bot[0]) / 2, (top[1] + bot[1]) / 2, nz, PLANK, { z: Math.atan2(-dx, dy) });
      b.box(0.2, 0.1, 0.2, bot[0], bot[1] - 0.02, nz, TIMBER);
      b.cyl(0.9, 0.46, 0.56, 7, bot[0], F + 0.45, nz, SAILCLOTH);
      b.cyl(0.1, 0.38, 0.46, 7, bot[0], F + 0.95, nz, SAILCLOTH);
    }
  }
  // The rail round the pit: posts and two rails, and one porous box for all of it.
  {
    const x1 = -2.25;
    const zr = 1.8;
    b.block({ w: ix + x1, h: 1.1, d: 2 * zr, x: (-ix + x1) / 2, y: F + 0.55, z: 0, porous: true });
    for (const y of [F + 0.55, F + 1.05]) {
      b.box(0.08, 0.1, 2 * zr + 0.1, x1, y, 0, TIMBER);
      for (const k of [-1, 1]) b.box(ix + x1, 0.1, 0.08, (-ix + x1) / 2, y, k * zr, TIMBER);
    }
    for (const [x, z] of [
      [x1, -zr],
      [x1, 0],
      [x1, zr],
      [-3.5, -zr],
      [-3.5, zr],
    ] as const) {
      b.box(0.12, 1.1, 0.12, x, F + 0.55, z, TIMBER);
    }
  }

  // A meal bin in the corner under the lane window, lidded, a scoop on it.
  {
    const bx0 = -ix;
    const bx1 = -3.0;
    const bz0 = -iz;
    const bz1 = -3.35;
    const top = F + 0.95;
    const cx = (bx0 + bx1) / 2;
    const cz = (bz0 + bz1) / 2;
    b.block({ w: bx1 - bx0, h: top, d: bz1 - bz0, x: cx, y: top / 2, z: cz });
    b.box(bx1 - bx0, top - F - 0.06, bz1 - bz0, cx, (F + top - 0.06) / 2, cz, PLANK);
    b.box(bx1 - bx0 + 0.06, 0.06, bz1 - bz0 + 0.06, cx, top - 0.03, cz, TIMBER);
    for (const x of [bx0 + 0.06, bx1 - 0.06]) b.box(0.1, top - F, 0.1, x, (F + top) / 2, bz1 - 0.02, TIMBER);
    b.box(0.34, 0.12, 0.2, cx + 0.2, top + 0.06, cz, TIMBER, { y: 0.4 });
  }

  // The sacks against the east wall, filled and tied and stood in two rows,
  // which is how a mill keeps them and what reads as a sack from across the
  // room — laid down in a stack, they read as cut logs.
  {
    const x0 = 3.35;
    const z0 = -3.4;
    const z1 = -0.4;
    const top = F + 1.0;
    b.block({ w: ix - x0, h: top, d: z1 - z0, x: (x0 + ix) / 2, y: top / 2, z: (z0 + z1) / 2 });
    /** A body drawn in at the foot and the shoulder, a tie, and the ears above it. */
    const sack = (x: number, z: number, tall: number, yaw: number): void => {
      b.cyl(tall, 0.48, 0.5, 8, x, F + tall / 2, z, SAILCLOTH, { y: yaw });
      b.cyl(0.08, 0.44, 0.48, 8, x, F + 0.04, z, SAILCLOTH, { y: yaw });
      b.cyl(0.12, 0.32, 0.48, 8, x, F + tall + 0.06, z, SAILCLOTH, { y: yaw });
      b.cyl(0.07, 0.15, 0.15, 6, x, F + tall + 0.15, z, PLANK);
      b.box(0.24, 0.1, 0.08, x, F + tall + 0.22, z, SAILCLOTH, { y: yaw * 3, z: 0.2 });
    };
    const TALL = [0.8, 0.74, 0.78, 0.82, 0.76, 0.79, 0.73];
    let q = 0;
    for (const x of [x0 + 0.36, x0 + 0.98]) {
      for (let i = 0; i < 5; i++) {
        sack(x + (q % 2) * 0.04, z0 + 0.3 + i * 0.6, TALL[q % 7], q * 0.37);
        q++;
      }
    }
    // A sack truck stood at the end of the stack.
    const tz = z1 + 0.5;
    const tx = ix - 0.35;
    for (const k of [-1, 1]) {
      b.box(0.05, 1.3, 0.05, tx + 0.12, F + 0.72, tz + k * 0.2, TIMBER, { z: 0.12 });
      b.cyl(0.05, 0.3, 0.3, 10, tx - 0.05, F + 0.15, tz + k * 0.27, IRON, { x: Math.PI / 2 });
    }
    b.box(0.3, 0.03, 0.46, tx - 0.12, F + 0.04, tz, IRON);
  }

  // The stair to the floor above: a steep flight along the back wall to a trap
  // that is shut, stringers, treads and a handrail — and a collider over its
  // foot, so the flight is something a body walks into rather than through.
  {
    const x0 = 1.9;
    const x1 = ix - 0.25;
    const z0 = iz - 0.95;
    const z1 = iz - 0.04;
    const run = x1 - x0;
    const rise = S - F;
    const ang = Math.atan2(rise, run);
    const len = Math.hypot(run, rise);
    b.block({ w: ix - x0, h: 1.5, d: iz - z0 + 0.05, x: (x0 + ix) / 2, y: 0.75, z: (z0 + iz) / 2 });
    for (const z of [z0 + 0.04, z1 - 0.04]) b.box(len, 0.26, 0.07, (x0 + x1) / 2, (F + S) / 2, z, TIMBER, { z: ang });
    const n = 14;
    for (let i = 1; i < n; i++) {
      const f = i / n;
      b.box(0.24, 0.05, z1 - z0 - 0.16, x0 + f * run - 0.02, F + f * rise, (z0 + z1) / 2, PLANK);
    }
    b.box(len + 0.2, 0.06, 0.06, (x0 + x1) / 2 - 0.1, (F + S) / 2 + 0.9, z0 - 0.02, TIMBER, { z: ang });
    b.box(0.07, 0.95, 0.07, x0 + 0.05, F + 0.47, z0 - 0.02, TIMBER);
    // The leaf of the trap it arrives at, shut, with its ring.
    const o = stairTrap;
    b.box(o.x1 - o.x0 - 0.1, 0.04, o.z1 - o.z0 - 0.1, (o.x0 + o.x1) / 2, S - 0.08, (o.z0 + o.z1) / 2, PLANK);
    b.cyl(0.02, 0.14, 0.14, 8, o.x0 + 0.2, S - 0.11, (o.z0 + o.z1) / 2, IRON);
  }

  // A lantern hung off the beam over the pit rail: the room's own light, which
  // is what the lane windows show at night.
  {
    const lx = beamX[0];
    const lz = -1.2;
    const ly = 2.85;
    b.box(0.03, beamY - 0.18 - ly - 0.35, 0.03, lx, (beamY - 0.18 + ly + 0.35) / 2, lz, IRON);
    b.cyl(0.5, 0.34, 0.26, 6, lx, ly, lz, IRON);
    b.glow(0.22, 0.26, 0.22, lx, ly, lz, FLAME);
    b.cyl(0.14, 0.08, 0.4, 6, lx, ly + 0.32, lz, IRON);
    b.light(FLAME, 11, 1.4, 0.25, lx, ly, lz);
  }

  // Things left about: a bushel measure and a broom by the door.
  b.cyl(0.4, 0.5, 0.5, 10, 1.6, F + 0.2, -3.6, PLANK);
  b.cyl(0.05, 0.52, 0.52, 10, 1.6, F + 0.38, -3.6, IRON);
  b.cyl(1.3, 0.035, 0.035, 5, -1.55, F + 0.7, -iz + 0.2, TIMBER, { x: -0.12 });
  b.box(0.3, 0.2, 0.08, -1.55, F + 0.08, -iz + 0.28, THATCH, { x: -0.12 });

  return b;
}
