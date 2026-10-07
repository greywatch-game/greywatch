/**
 * kit/harbour/crane.ts — buildHarbourCrane: the quay crane — a laid quay
 * block, a built mast, a jib trussed back to its counterweight, the boarded
 * winch house the back-stays come down through and the crab winch inside it.
 * Part of the volcanic-coast set: follows the contract in kit/core.ts and the
 * set's rules in `./index.ts`. Invariants: the colliders are restated byte for
 * byte in the order they always were, with the winch appended last; what
 * varies is seeded off where it stands (`streetSeed`), never
 * `Math.random()`. Never imports another builder.
 */
import { Scene } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
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
  BASALT,
  BASALT_PALE,
  FLAME,
  IRON,
  PITCH,
  PLANK,
  RUST,
  SAILCLOTH,
  SLAG,
  SLATE,
  TIMBER,
} from "../core";
import { mulberry32 } from "../../rng";
import {
  bar,
  splitRun,
  type Cut,
  lapCourse,
  boardedWindow,
  NET_PAINTS,
} from "./shared";

/**
 * A QUAY CRANE: a timber mast stepped in an iron shoe on a basalt quay block,
 * a raking jib fixed at its head and trussed back over a king post to the tail
 * that carries its counterweight, two back-stays from the cross-trees down
 * through the roof of a boarded winch house, and the crab winch in there whose
 * chain runs out under the door head, up the mast and along the jib to the
 * hook.
 *
 * **A quay without one is a promenade.** Every cargo on this island arrived
 * over a gunwale and nothing in the kit could lift it: the depot said there
 * was a warehouse, the jetties said there were boats, and the twenty metres
 * between them said nothing at all. It is also the only tall thin silhouette
 * on the harbour front, which is what stops five hundred metres of shed roof
 * from reading as one shed.
 *
 * The jib and the stays are `Build.strut` — timber a round stops on, eleven
 * metres in the air, and no part of a body's problem. The winch house is an
 * ordinary collider and is the one piece of hard cover on an open quay.
 *
 * ## What it is drawn as
 *
 * - **The quay block is laid**: a kerb of long pale dressed stones round a
 *   floor of flags whose joints sink to a dark bed, iron mooring rings on the
 *   water side, and a footing carried down to the ground where it falls away.
 * - **The mast is a built spar**: two lengths fished together half way up,
 *   iron bands, a shoe bolted through a flange to the quay, and at its head a
 *   pair of cross-trees clasping it, braced from below, whose ends take the
 *   back-stays' heads between them. The stays always stood 2.4 m out either
 *   side of the mast; until now nothing up there held them.
 * - **What balances the jib is named.** Its line carries on back past the
 *   mast as a tail; the counterweight is a cage of basalt blocks in iron
 *   angles hung under that on four rods, where it used to hang in the air on
 *   nothing; a king post stood on the heel trusses both arms with tie rods,
 *   and a spur under the jib takes it back to the mast.
 * - **The winch house is a boarded engine shed on a stone base**: two
 *   courses of basalt, a sill, lapped boarding tipped at the foot with corner
 *   boards, gables in the WALL's colour, slate in runs over rafter feet, a
 *   gutter and a downpipe each side, its door standing open and its windows
 *   framed. The stays come down through its roof under iron collars and stand
 *   on sills on its floor.
 * - **The winch is a crab**: a ribbed barrel between two cast A-frames, a
 *   spur wheel and pinion, a crank either side, a ratchet and pawl and a brake
 *   lever. Its chain is the one line on the crane — off the barrel, under a
 *   roller and out beneath the door head, round a lead sheave at the mast's
 *   foot, up the mast on stand-offs, over a sheave at the head, along the jib
 *   on rollers and over the head sheave to the fall — and the fall is drawn
 *   link by link down to a hook block with its hook clear of every head.
 *
 * **What varies is seeded off where it stands** (`streetSeed`): the door's
 * paint, whether its windows are shuttered, the slate runs, the jitter in the
 * stones and what was put down on the quay; and the quay block's footing is
 * carried down to the ground, which is what puts `crane` in
 * `CONFORMS_TO_TERRAIN`. Without a `BuildCtx` it stands on level ground.
 *
 * The colliders are restated by hand at the top, byte for byte and in the
 * order they always were — the quay block, the house's base, `doorWall`'s
 * jambs and lintel, the back wall, the flanks, `gableRoof`'s slab, the mast,
 * the jib, the counterweight and the stays — and ONE is appended after them,
 * the winch: the base is a metre high, a body can jump in at the door, and a
 * machine it walked through would be the one thing in the room not there.
 * Everything else is drawing, laid on a face, low enough to walk over,
 * overhead, or standing on a collider.
 */
export function buildHarbourCrane(
  scene: Scene,
  mats: CelMaterialFactory,
  _p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "crane");
  const plinth = 0.45;
  const hw = 6.2;
  const hd = 5.0;
  const hh = 3.4;
  const hz = 2.6;
  const mastTop = 12.7;
  const tipY = 9.2;
  const tipZ = -11.5;
  const jib = Math.hypot(tipZ + 3.0, tipY - mastTop);
  const stayLen = Math.hypot(7.2, mastTop - plinth);

  // --- the colliders, byte for byte and in the order they always were -----
  b.block({ w: 8.4, h: plinth, d: 9.6, x: 0, y: plinth / 2, z: 0.8 });
  // The winch house: its basalt base, `doorWall`'s two jambs and its lintel,
  // the back wall, the flanks, and `gableRoof`'s flat slab at the eaves.
  b.block({ w: hw, h: 1.0, d: hd, x: 0, y: plinth + 0.5, z: hz });
  const wallH = hh - 1.0;
  const wallY = plinth + 1.0 + (hh - 1.0) / 2;
  const frontZ = hz - hd / 2;
  const jamb = (hw - 1.6) / 2;
  const off = 1.6 / 2 + jamb / 2;
  const lintel = wallH - 2.2;
  b.block({ w: jamb, h: wallH, d: 0.3, x: 0 - off, y: wallY, z: frontZ });
  b.block({ w: jamb, h: wallH, d: 0.3, x: 0 + off, y: wallY, z: frontZ });
  b.block({ w: 1.6, h: lintel, d: 0.3, x: 0, y: wallY + wallH / 2 - lintel / 2, z: frontZ });
  b.block({ w: hw, h: wallH, d: 0.3, x: 0, y: wallY, z: hz + hd / 2 });
  for (const sx of [-1, 1] as const) b.block({ w: 0.3, h: wallH, d: hd, x: (sx * hw) / 2, y: wallY, z: hz });
  b.block({ w: hw + 0.4 * 2, h: 0.3, d: hd + 0.4 * 2, x: 0, y: plinth + hh, z: hz });
  // The mast, out on the water side of the house. A body walks into it, so it
  // is a wall and not a strut.
  b.wall(0.8, mastTop - plinth, 0.8, 0, plinth + (mastTop - plinth) / 2, -3.0, TIMBER);
  // The jib raking out over the water, the counterweight balancing it back
  // over the house, and the two back-stays — kept in the YZ plane and offset
  // in X, so each one's head stands 2.4 m out from the mast.
  b.strut(0.7, 0.7, jib, 0, (mastTop + tipY) / 2, (-3.0 + tipZ) / 2, TIMBER, {
    x: -Math.atan2(mastTop - tipY, -3.0 - tipZ),
  });
  b.block({ w: 1.9, h: 1.7, d: 1.9, x: 0, y: mastTop - 1.6, z: -0.9, rayOnly: true });
  for (const sx of [-1, 1] as const) {
    b.strut(0.3, stayLen, 0.3, sx * 2.4, (mastTop + plinth) / 2, 0.6, TIMBER, {
      x: -Math.atan2(7.2, mastTop - plinth),
    });
  }
  // Appended: the winch, which a body that has jumped in at the door now
  // meets rather than walks through.
  const floor = plinth + 1.0;
  b.block({ w: 3.4, h: 1.4, d: 1.4, x: 0, y: floor + 0.7, z: 1.95 });

  // Everything below is drawing.
  const rnd = mulberry32(streetSeed(8.4, 9.6, mastTop, ctx));
  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };
  const sb = new StoneBatch();
  const paint = NET_PAINTS[Math.floor(rnd() * NET_PAINTS.length)];
  const SIDES: Side[] = ["-z", "+z", "-x", "+x"];
  const top = plinth + hh;
  const MZ = -3.0;
  /** Where the chain runs up the mast and back along to the jib: beside the tail. */
  const CX = 0.33;
  const rotZ = { z: Math.PI / 2 };

  // --- the quay block -----------------------------------------------------
  const PX = 4.2;
  const Z0 = 0.8 - 4.8;
  const Z1 = 0.8 + 4.8;
  /** The kerb's depth on each side; the back one runs in to meet the house. */
  const kerb = (s: Side): number => (s === "+z" ? Z1 - (hz + hd / 2) : 0.4);
  /** One side's kerb stones from `u0` to `u1`, their outer face just proud of the block. */
  const kerbRun = (s: Side, u0: number, u1: number): void => {
    const k = kerb(s);
    const face = s === "-z" ? Z0 : s === "+z" ? Z1 : outward(s) * PX;
    const c = face + outward(s) * (0.012 - k / 2);
    const h = plinth + 0.06;
    let a = u0;
    while (a < u1 - 0.01) {
      let e = Math.min(u1, a + 0.8 + rnd() * 0.7);
      if (u1 - e < 0.45) e = u1;
      if (runsAlongX(s)) sb.box(e - a - 0.02, h, k, (a + e) / 2, plinth - h / 2, c, BASALT_PALE, undefined, hideBack(s) | HIDE_UNDER);
      else sb.box(k, h, e - a - 0.02, c, plinth - h / 2, (a + e) / 2, BASALT_PALE, undefined, hideBack(s) | HIDE_UNDER);
      a = e;
    }
  };
  kerbRun("-z", -PX - 0.012, PX + 0.012);
  kerbRun("+z", -PX - 0.012, PX + 0.012);
  for (const s of ["-x", "+x"] as const) kerbRun(s, Z0 + 0.4, Z1 - kerb("+z"));
  /** Flags in courses across `[x0, x1]` from `z0` to `z1`, cut round the mast's shoe. */
  const flags = (x0: number, x1: number, z0: number, z1: number): void => {
    let za = z0;
    while (za < z1 - 0.01) {
      let zb = Math.min(z1, za + 0.55 + rnd() * 0.25);
      if (z1 - zb < 0.3) zb = z1;
      const cuts: [number, number][] = zb > MZ - 0.75 && za < MZ + 0.75 ? [[-0.72, 0.72]] : [];
      for (const [ua, ub] of carve(x0, x1, cuts)) {
        let xa = ua;
        while (xa < ub - 0.01) {
          let xb = Math.min(ub, xa + 0.55 + rnd() * 0.6);
          if (ub - xb < 0.3) xb = ub;
          sb.box(xb - xa - 0.02, 0.08, zb - za - 0.02, (xa + xb) / 2, plinth - 0.04, (za + zb) / 2, BASALT, undefined, HIDE_UNDER);
          xa = xb;
        }
      }
      za = zb;
    }
  };
  const fx = PX - 0.4;
  flags(-fx, fx, Z0 + 0.4, frontZ - 0.03);
  flags(-fx, -(hw / 2 + 0.03), frontZ - 0.03, Z1 - kerb("+z"));
  flags(hw / 2 + 0.03, fx, frontZ - 0.03, Z1 - kerb("+z"));
  // Mooring rings let into the kerb on the water side.
  for (const x of [-2.7, 2.7]) {
    const rz = Z0 + 0.2;
    sb.box(0.12, 0.03, 0.07, x, plinth + 0.015, rz + 0.12, IRON);
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3;
      sb.box(0.13, 0.035, 0.035, x + 0.11 * Math.cos(a), plinth + 0.018, rz + 0.11 * Math.sin(a) - 0.02, RUST, { y: -a - Math.PI / 2 });
    }
  }
  // The footing, carried down to the lowest ground round the block.
  let low = 0;
  for (const lx of [-PX, 0, PX]) for (const lz of [Z0, 0.8, Z1]) low = Math.min(low, ground(lx, lz));
  if (low < -0.05) sb.box(2 * PX, -0.05 - (low - 0.15), Z1 - Z0, 0, (low - 0.15 - 0.05) / 2, 0.8, BASALT, undefined, 1 << 2);

  // --- what was put down on the quay --------------------------------------
  // All of it under 0.3 m, in the yard between the house and the edge.
  for (const [lx, lz] of [
    [-2.7, -2.3],
    [2.6, -2.6],
    [2.2, -0.8],
  ] as const) {
    const kind = Math.floor(rnd() * 5);
    const yaw = rnd() * Math.PI;
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    /** A point `u` across and `v` along the heap's own bearing. */
    const at = (u: number, v: number): [number, number] => [lx + u * cs + v * sn, lz - u * sn + v * cs];
    if (kind === 0) {
      // A sling chain thrown down in a loose S, its links lying flat and on edge.
      for (let k = 0; k < 9; k++) {
        const [x, z] = at(0.18 * Math.sin(k * 0.8), -0.55 + k * 0.13);
        const lyaw = yaw + 0.35 * Math.cos(k * 0.8);
        const flat = k % 2 === 0;
        const y = plinth + (flat ? 0.015 : 0.05);
        for (const e of [-1, 1] as const) {
          // The link's two sides and its two ends, flat or stood on edge.
          const sx = flat ? e * 0.035 * Math.cos(lyaw) : 0;
          const sz = flat ? -e * 0.035 * Math.sin(lyaw) : 0;
          sb.box(0.025, 0.025, 0.15, x + sx, y + (flat ? 0 : e * 0.035), z + sz, RUST, { y: lyaw });
          sb.box(flat ? 0.095 : 0.025, flat ? 0.025 : 0.095, 0.025, x + e * 0.0625 * Math.sin(lyaw), y, z + e * 0.0625 * Math.cos(lyaw), RUST, { y: lyaw });
        }
      }
    } else if (kind === 1) {
      b.cyl(0.12, 0.62, 0.66, 10, lx, plinth + 0.06, lz, PLANK);
      b.cyl(0.13, 0.22, 0.22, 8, lx, plinth + 0.065, lz, PITCH);
    } else if (kind === 2) {
      // Dunnage: three baulks laid ready for a load.
      for (const u of [-0.45, 0, 0.45]) {
        const [x, z] = at(u, 0);
        sb.box(0.12, 0.14, 1.3, x, plinth + 0.07, z, TIMBER, { y: yaw }, HIDE_UNDER);
      }
    } else if (kind === 3) {
      // A spare block lying on its cheek, its hook out to one side.
      sb.box(0.42, 0.1, 0.6, lx, plinth + 0.05, lz, RUST, { y: yaw }, HIDE_UNDER);
      b.cyl(0.12, 0.36, 0.36, 10, lx, plinth + 0.06, lz, IRON);
      const [hx, hk] = at(0, 0.45);
      sb.box(0.07, 0.07, 0.3, hx, plinth + 0.035, hk, RUST, { y: yaw }, HIDE_UNDER);
    }
    // kind 4: nothing.
  }

  // --- the mast -----------------------------------------------------------
  /** The plane of the mast's face on side `s`, `r` out from its axis, as `onFace` takes it. */
  const mastPlane = (s: Side, r: number): number => (s === "-z" ? r - MZ : s === "+z" ? MZ + r : r);
  const mastU = (s: Side): number => (runsAlongX(s) ? 0 : MZ);
  // The shoe: a flange bolted down through the flags, a box clasping the foot
  // and a rib out to the flange on each face.
  sb.box(1.3, 0.05, 1.3, 0, plinth + 0.025, MZ, RUST, undefined, HIDE_UNDER);
  sb.box(1.0, 0.32, 1.0, 0, plinth + 0.21, MZ, RUST, undefined, HIDE_UNDER);
  for (const s of SIDES) sb.onFace(s, mastPlane(s, 0.5), mastU(s), plinth + 0.2, 0.05, 0.3, 0.14, 0.07, RUST, 0, 0, HIDE_UNDER);
  for (const dx of [-0.55, 0, 0.55]) {
    for (const dz of [-0.55, 0, 0.55]) if (dx !== 0 || dz !== 0) sb.box(0.08, 0.05, 0.08, dx, plinth + 0.075, MZ + dz, IRON, undefined, HIDE_UNDER);
  }
  for (const y of [2.4, 5.2, 9.6]) sb.box(0.84, 0.1, 0.84, 0, y, MZ, RUST);
  // Fished half way up: a plate each side over the joint, bolted through.
  for (const sx of [-1, 1] as const) {
    sb.box(0.03, 1.5, 0.5, sx * 0.415, 7.1, MZ, RUST);
    for (const y of [6.55, 7.1, 7.65]) for (const dz of [-0.14, 0.14]) sb.box(0.03, 0.07, 0.07, sx * 0.44, y, MZ + dz, IRON);
  }

  // --- the masthead ---------------------------------------------------------
  // A pair of cross-trees clasping the head, the stays' heads packed between
  // their ends, and braced up from the mast.
  const XY = 12.575;
  for (const ez of [-1, 1] as const) {
    sb.box(5.5, 0.45, 0.28, 0, XY, MZ + ez * 0.54, TIMBER);
    for (const x of [-2.4, -0.25, 0.25, 2.4]) for (const dy of [-0.1, 0.1]) sb.box(0.07, 0.07, 0.03, x, XY + dy, MZ + ez * 0.695, IRON);
  }
  for (const sx of [-1, 1] as const) {
    sb.box(0.32, 0.45, 0.8, sx * 2.4, XY, MZ, TIMBER);
    for (const ez of [-1, 1] as const) bar(sb, [sx * 0.4, 10.9, MZ], [sx * 1.8, XY - 0.225, MZ + ez * 0.54], 0.18, 0.18, TIMBER);
    sb.box(0.03, 0.7, 0.8, sx * 0.415, mastTop - 0.3, MZ, RUST);
  }
  // The jib's line from its heel at the masthead: `t` along it toward the tip
  // (negative back along the tail), `lift` off its axis, `x` across.
  const dir: Point3 = [0, (tipY - mastTop) / jib, (tipZ - MZ) / jib];
  const nrm: Point3 = [0, -dir[2], dir[1]];
  const J = (t: number, lift = 0, x = 0): Point3 => [x, mastTop + dir[1] * t + nrm[1] * lift, MZ + dir[2] * t + nrm[2] * lift];
  const bolt = (p: Point3): void => sb.box(0.03, 0.07, 0.07, p[0], p[1], p[2], IRON);
  b.cyl(0.95, 0.24, 0.24, 8, 0, mastTop, MZ, RUST, rotZ);
  for (const sx of [-1, 1] as const) {
    bar(sb, J(0, 0, sx * 0.365), J(1.3, 0, sx * 0.365), 0.03, 0.62, RUST);
    bar(sb, J(0, 0, sx * 0.29), J(-1.0, 0, sx * 0.29), 0.03, 0.5, RUST);
    for (const t of [0.55, 1.05]) for (const l of [-0.17, 0.17]) bolt(J(t, l, sx * 0.39));
    for (const t of [-0.5, -0.85]) for (const l of [-0.13, 0.13]) bolt(J(t, l, sx * 0.315));
  }

  // --- the tail and the counterweight ---------------------------------------
  // The jib's line carried back past the mast, and the weight hung under it.
  const tail = (0.4 - MZ) / -dir[2];
  bar(sb, J(0), J(-tail), 0.55, 0.55, TIMBER);
  bar(sb, J(-tail), J(-tail - 0.04), 0.6, 0.6, RUST);
  const cz = -0.9;
  const cw = 0.95;
  const cBot = mastTop - 1.6 - 0.85;
  const cTop = cBot + 1.7;
  // A ballast box: stout boards round a core, the stones it was filled with
  // heaped over its rim. Laid stone in a frame read as a glazed lantern.
  const boards = 6;
  const ch = 1.7 / boards;
  for (let k = 0; k < boards; k++) {
    const y = cBot + (k + 0.5) * ch;
    for (const s of SIDES) {
      const r = outward(s) * (cw + 0.012 - 0.03);
      const len = 2 * (cw + 0.012) - (runsAlongX(s) ? 0 : 0.12);
      if (runsAlongX(s)) sb.box(len, ch - 0.018, 0.06, 0, y, cz + r, TIMBER, undefined, hideBack(s));
      else sb.box(0.06, ch - 0.018, len, r, y, cz, TIMBER, undefined, hideBack(s));
    }
  }
  for (let i = 0; i < 11; i++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * 0.62;
    const sz = 0.22 + rnd() * 0.2;
    const lift = (0.62 - d) * 0.35;
    sb.box(sz, sz * 0.7, sz * (0.8 + rnd() * 0.4), Math.cos(a) * d, cTop - sz * 0.15 + lift, cz + Math.sin(a) * d, BASALT, { x: rnd() * 0.6 - 0.3, y: rnd() * 3, z: rnd() * 0.6 - 0.3 }, HIDE_UNDER);
  }
  // The cage: an angle up each corner, two straps round, a frame top and foot.
  for (const sx of [-1, 1] as const) {
    for (const ez of [-1, 1] as const) sb.box(0.1, 1.76, 0.1, sx * (cw - 0.01), cBot + 0.85, cz + ez * (cw - 0.01), RUST);
  }
  for (const y of [cBot + 2 * ch, cBot + 4 * ch]) {
    for (const e of [-1, 1] as const) {
      sb.box(2 * cw + 0.06, 0.06, 0.025, 0, y, cz + e * (cw + 0.025), RUST);
      sb.box(0.025, 0.06, 2 * cw + 0.06, e * (cw + 0.025), y, cz, RUST);
    }
  }
  for (const y of [cBot - 0.02, cTop + 0.02]) {
    for (const e of [-1, 1] as const) {
      sb.box(2 * cw + 0.06, 0.1, 0.1, 0, y, cz + e * (cw - 0.02), RUST);
      sb.box(0.1, 0.1, 2 * cw + 0.06, e * (cw - 0.02), y, cz, RUST);
    }
  }
  // Four rods up from its corners to straps round the tail.
  for (const [zc, zt] of [
    [cz - 0.8, -1.5],
    [cz + 0.8, -0.3],
  ] as const) {
    const t = (zt - MZ) / dir[2];
    bar(sb, J(t - 0.05), J(t + 0.05), 0.6, 0.6, RUST);
    for (const sx of [-1, 1] as const) {
      bar(sb, J(t, -0.29, sx * 0.2), [sx * 0.8, cTop + 0.08, zc], 0.05, 0.05, RUST);
      sb.box(0.12, 0.1, 0.04, sx * 0.8, cTop + 0.1, zc, RUST);
    }
  }

  // --- the jib and the truss over it ----------------------------------------
  for (const t of [1.8, 3.0, 5.2, 7.4]) bar(sb, J(t - 0.05), J(t + 0.05), 0.74, 0.74, RUST);
  // The spur back to the mast, on a plate on the mast's face.
  bar(sb, [0, 8.6, MZ - 0.4], J(3.0, -0.35), 0.3, 0.3, TIMBER);
  sb.box(0.5, 0.5, 0.03, 0, 8.6, MZ - 0.415, RUST);
  // Rollers along the top that carry the chain out.
  for (const t of [1.2, 4.2, 7.0]) {
    for (const sx of [-1, 1] as const) bar(sb, J(t - 0.14, 0.42, sx * 0.12), J(t + 0.14, 0.42, sx * 0.12), 0.03, 0.16, RUST);
    const r = J(t, 0.45);
    b.cyl(0.21, 0.14, 0.14, 8, r[0], r[1], r[2], IRON, rotZ);
  }
  // The head: an iron fork over the end, its sheave, and the lamp under it.
  const head = jib + 0.4;
  const C = J(head);
  for (const sx of [-1, 1] as const) {
    bar(sb, J(jib - 0.7, 0, sx * 0.375), J(head, 0, sx * 0.375), 0.04, 0.66, RUST);
    for (const t of [jib - 0.5, jib - 0.2]) for (const l of [-0.2, 0.2]) bolt(J(t, l, sx * 0.405));
    b.cyl(0.04, 1.22, 1.22, 14, sx * 0.375, C[1], C[2], RUST, rotZ);
    b.cyl(0.05, 0.3, 0.3, 8, sx * 0.4, C[1], C[2], RUST, rotZ);
  }
  b.cyl(0.18, 1.04, 1.04, 16, C[0], C[1], C[2], IRON, rotZ);
  b.cyl(0.86, 0.18, 0.18, 8, C[0], C[1], C[2], RUST, rotZ);
  const lp = J(jib + 0.12, -0.6);
  sb.box(0.8, 0.05, 0.05, lp[0], lp[1], lp[2], IRON);
  sb.box(0.02, 0.3, 0.02, lp[0], lp[1] - 0.15, lp[2], IRON);
  sb.box(0.22, 0.06, 0.22, lp[0], lp[1] - 0.33, lp[2], IRON);
  b.glow(0.15, 0.22, 0.15, lp[0], lp[1] - 0.47, lp[2], FLAME);
  sb.box(0.2, 0.05, 0.2, lp[0], lp[1] - 0.605, lp[2], IRON);
  for (const dx of [-0.085, 0.085]) for (const dz of [-0.085, 0.085]) sb.box(0.02, 0.24, 0.02, lp[0] + dx, lp[1] - 0.47, lp[2] + dz, IRON);
  // The king post on the heel, and its tie rods out to the head and the tail,
  // each with a turnbuckle in it.
  const kpTop = 15.6;
  sb.box(0.3, kpTop - 12.9, 0.3, 0, (kpTop + 12.9) / 2, MZ, RUST);
  sb.box(0.44, 0.08, 0.44, 0, kpTop + 0.04, MZ, RUST);
  const tipEye = J(jib + 0.1, 0.62);
  const tailEye = J(-tail + 0.15, 0.3);
  for (const sx of [-1, 1] as const) {
    const ties: [Point3, Point3][] = [
      [
        [sx * 0.1, kpTop - 0.12, MZ - 0.1],
        [sx * 0.33, tipEye[1], tipEye[2]],
      ],
      [
        [sx * 0.1, kpTop - 0.12, MZ + 0.1],
        [sx * 0.2, tailEye[1], tailEye[2]],
      ],
    ];
    for (const [a, c] of ties) {
      bar(sb, a, c, 0.055, 0.055, RUST);
      const o = orient(a, c);
      const k = 0.18 / o.len;
      const dx = (c[0] - a[0]) * k;
      const dy = (c[1] - a[1]) * k;
      const dz = (c[2] - a[2]) * k;
      const m = o.mid;
      bar(sb, [m[0] - dx, m[1] - dy, m[2] - dz], [m[0] + dx, m[1] + dy, m[2] + dz], 0.1, 0.1, RUST);
    }
  }

  // --- the back-stays -------------------------------------------------------
  /** A point on a stay's axis, `f` of the way from its foot to its head. */
  const S = (sx: number, f: number): Point3 => [sx * 2.4, plinth + f * (mastTop - plinth), 4.2 - f * 7.2];
  const df = 0.085 / stayLen;
  const run = hw / 2 + 0.4;
  const rise = 1.15;
  const pitch = Math.atan2(rise, run);
  const roofAt = (x: number): number => top + (rise * (run - Math.abs(x))) / run;
  const fRoof = (roofAt(2.4) + 0.11 - plinth) / (mastTop - plinth);
  const fFloor = (floor + 0.16 - plinth) / (mastTop - plinth);
  for (const sx of [-1, 1] as const) {
    for (const f of [0.5, 0.72, 0.9]) bar(sb, S(sx, f - df / 2), S(sx, f + df / 2), 0.34, 0.34, RUST);
    // An iron sleeve where it comes through the roof, on a flashing laid to the slope.
    bar(sb, S(sx, fRoof - 1.5 * df), S(sx, fRoof + 1.5 * df), 0.38, 0.38, IRON);
    const r = S(sx, fRoof);
    sb.box(0.6, 0.03, 0.75, r[0], r[1] - 0.03, r[2], IRON, { z: -sx * pitch });
    // And its foot on a sill on the floor, in an iron shoe.
    sb.box(0.3, 0.16, 1.9, sx * 2.4, floor + 0.08, hz + hd / 2 - 0.15 - 0.95, TIMBER, undefined, HIDE_UNDER);
    bar(sb, S(sx, fFloor), S(sx, fFloor + 2.5 * df), 0.36, 0.36, RUST);
  }

  // --- the winch house's base -----------------------------------------------
  /** Where the base's face is on side `s`, along that side's own axis. */
  const baseFace = (s: Side): number => (s === "-z" ? frontZ : s === "+z" ? hz + hd / 2 : outward(s) * (hw / 2));
  for (let k = 0; k < 2; k++) {
    const y = plinth + (k + 0.5) * 0.5;
    for (const s of SIDES) {
      const along = runsAlongX(s);
      const long = (k + (along ? 0 : 1)) % 2 === 0;
      const end = (along ? hw / 2 : hd / 2) + (long ? 0.015 : -0.225);
      for (const [a, c] of splitRun(-end, end, 0.95, k === 1)) {
        const r = baseFace(s) + outward(s) * (0.012 + rnd() * 0.014 - 0.12);
        const u = (a + c) / 2;
        if (along) sb.box(c - a - 0.025, 0.475, 0.24, u, y, r, BASALT, undefined, hideBack(s) | HIDE_UNDER);
        else sb.box(0.24, 0.475, c - a - 0.025, r, y, hz + u, BASALT, undefined, hideBack(s) | HIDE_UNDER);
      }
    }
  }

  // --- the boarding ---------------------------------------------------------
  // The boarded faces' planes as `onFace` takes them, and the flanks' run.
  const fp = -(frontZ - 0.15);
  const bp = hz + hd / 2 + 0.15;
  const xp = hw / 2 + 0.15;
  const z0 = frontZ - 0.15;
  const z1 = hz + hd / 2 + 0.15;
  const DOOR = 0.8;
  const by0 = floor + 0.14;
  const bc = 9;
  const bH = (top - by0) / bc;
  // The sill the boarding stands on, flush with its face and out over the stone.
  for (const [a, c] of carve(-xp, xp, [[-DOOR, DOOR]])) sb.onFace("-z", fp, (a + c) / 2, floor + 0.07, c - a, 0.14, 0.2, -0.05, TIMBER);
  sb.onFace("+z", bp, 0, floor + 0.07, 2 * xp, 0.14, 0.2, -0.05, TIMBER);
  for (const s of ["-x", "+x"] as const) sb.onFace(s, xp, hz, floor + 0.07, z1 - z0, 0.14, 0.2, -0.05, TIMBER);
  // The windows, dark: shuttered, or glass behind bars.
  const winY = floor + 1.15;
  const cutL = boardedWindow(b, sb, rnd, "-x", xp, hz, winY, 0.6, 0.7, false, paint);
  const cutR = boardedWindow(b, sb, rnd, "+x", xp, hz, winY, 0.6, 0.7, false, paint);
  const backCut = boardedWindow(b, sb, rnd, "+z", bp, 1.3, winY + 0.05, 0.5, 0.6, false, paint);
  const doorCut: Cut = [-(DOOR + 0.12), DOOR + 0.12, floor - 1, floor + 2.37];
  const faces: [Side, number, number, number, Cut[]][] = [
    ["-z", fp, -xp, xp, [doorCut]],
    ["+z", bp, -xp, xp, [backCut]],
    ["-x", xp, z0, z1, [cutL]],
    ["+x", xp, z0, z1, [cutR]],
  ];
  for (const [s, plane, u0, u1, cuts] of faces) {
    for (let k = 0; k < bc; k++) lapCourse(sb, s, plane, u0, u1, by0 + k * bH, by0 + (k + 1) * bH, cuts);
    for (const u of [u0 + 0.07, u1 - 0.07]) sb.onFace(s, plane, u, (by0 + top) / 2, 0.14, top - by0, 0.04, 0.055, PITCH);
  }
  for (const s of ["-x", "+x"] as const) sb.onFace(s, xp, hz, top - 0.04, z1 - z0 + 0.1, 0.14, 0.03, 0.03, PITCH);
  // The gables, boarded on up to the roof in the wall's colour.
  for (const [s, plane] of [
    ["-z", fp],
    ["+z", bp],
  ] as const) {
    for (let j = 0; ; j++) {
      const yb = top + j * bH;
      const half = Math.min(xp, run - ((yb + bH / 2 - top) * run) / rise);
      if (half < 0.12) break;
      lapCourse(sb, s, plane, -half, half, yb, yb + bH, []);
    }
  }

  // --- the door -------------------------------------------------------------
  // A pale frame and a threshold, and both leaves standing open flat back
  // against the front, ledges and braces out.
  for (const e of [-1, 1] as const) sb.onFace("-z", fp, e * (DOOR + 0.05), floor + 1.1, 0.1, 2.2, 0.06, 0.05, SAILCLOTH);
  sb.onFace("-z", fp, 0, floor + 2.28, 2 * DOOR + 0.2, 0.16, 0.06, 0.05, SAILCLOTH);
  sb.box(2 * DOOR + 0.2, 0.04, 0.36, 0, floor + 0.02, frontZ, TIMBER, undefined, HIDE_UNDER);
  for (const e of [-1, 1] as const) {
    const lu = e * (DOOR + 0.12 + DOOR / 2);
    for (let i = 0; i < 4; i++) sb.onFace("-z", fp, lu - (3 * DOOR) / 8 + (i * DOOR) / 4, floor + 1.12, DOOR / 4 - 0.012, 2.15, 0.03, 0.06, paint);
    for (const y of [0.3, 1.12, 1.94]) sb.onFace("-z", fp, lu, floor + y, DOOR - 0.06, 0.11, 0.03, 0.09, paint);
    const r0 = 0.82 - 0.11;
    const w0 = DOOR - 0.22;
    for (const y0 of [0.3, 1.12]) sb.onFace("-z", fp, lu, floor + y0 + 0.41, Math.hypot(r0, w0), 0.1, 0.03, 0.09, paint, e * Math.atan2(r0, w0));
    for (const y of [0.3, 1.94]) sb.onFace("-z", fp, e * (DOOR + 0.12 + 0.28), floor + y, 0.56, 0.05, 0.015, 0.11, IRON);
  }

  // --- the roof -------------------------------------------------------------
  const roofLen = hd + 0.8;
  const slope = Math.hypot(run, rise);
  const nx = Math.sin(pitch);
  const ny = Math.cos(pitch);
  const rows = 7;
  for (const s of [-1, 1] as const) {
    for (let i = 0; i < rows; i++) {
      const f = (i + 0.5) / rows;
      // Each course laid in runs that do not quite agree with each other.
      const at = [hz - roofLen / 2];
      while (at[at.length - 1] < hz + roofLen / 2 - 1.1) at.push(at[at.length - 1] + 1.1 + rnd() * 1.6);
      at[at.length - 1] = hz + roofLen / 2;
      for (let r = 1; r < at.length; r++) {
        const lift = 0.055 + (rnd() - 0.5) * 0.018;
        sb.box(slope / rows + 0.1, 0.1, at[r] - at[r - 1] - 0.01, s * run * (1 - f) + s * nx * lift, top + rise * f + ny * lift, (at[r] + at[r - 1]) / 2, SLATE, { z: -s * (pitch - 0.06) });
      }
    }
    // Rafter feet under the eaves, a fascia on their ends and the gutter.
    const rafters = Math.round(hd / 0.6) + 1;
    const xm = (xp + run) / 2;
    for (let j = 0; j < rafters; j++) {
      const z = hz - hd / 2 + 0.1 + (j * (hd - 0.2)) / (rafters - 1);
      sb.box((run - xp) / Math.cos(pitch) + 0.05, 0.1, 0.06, s * xm, roofAt(xm) - 0.03 - 0.05 / ny, z, TIMBER, { z: -s * pitch });
    }
    sb.box(0.04, 0.18, roofLen, s * (run + 0.02), top - 0.04, hz, TIMBER);
    sb.box(0.13, 0.1, roofLen - 0.1, s * (run + 0.11), top - 0.1, hz, IRON);
    // The downpipe off the back of the gutter, down the boarding, in over the
    // sill to the stone and down that to a shoe.
    const zp = hz + hd / 2 - 0.1;
    const xw = s * (xp + 0.06);
    const xs = s * (hw / 2 + 0.07);
    bar(sb, [s * (run + 0.11), top - 0.12, zp], [xw, top - 0.4, zp], 0.08, 0.08, IRON);
    sb.box(0.08, top - 0.4 - (floor + 0.2), 0.08, xw, (top - 0.4 + floor + 0.2) / 2, zp, IRON);
    bar(sb, [xw, floor + 0.2, zp], [xs, floor - 0.15, zp], 0.08, 0.08, IRON);
    sb.box(0.08, floor - 0.15 - (plinth + 0.12), 0.08, xs, (floor - 0.15 + plinth + 0.12) / 2, zp, IRON);
    sb.box(0.09, 0.07, 0.2, xs, plinth + 0.12, zp - 0.07, IRON);
  }
  // Bargeboards up each verge and a finial at each apex.
  for (const sz of [-1, 1] as const) {
    const z = hz + sz * (roofLen / 2 - 0.03);
    for (const s of [-1, 1] as const) bar(sb, [s * (run + 0.03), top - 0.01, z], [0, top + rise, z], 0.05, 0.24, TIMBER);
    sb.box(0.1, 0.45, 0.1, 0, top + rise + 0.15, z, TIMBER);
  }

  // --- inside -----------------------------------------------------------
  // Seen through the door: a boarded floor and ceiling at the colliders'
  // faces, studs on the walls, and the lamp it is worked by.
  const ix = hw / 2 - 0.15;
  const iz0 = frontZ + 0.15;
  const iz1 = hz + hd / 2 - 0.15;
  const ceil = plinth + hh - 0.15;
  b.box(2 * ix, 0.04, iz1 - iz0, 0, floor - 0.02, (iz0 + iz1) / 2, PLANK);
  b.box(2 * ix, 0.05, iz1 - iz0, 0, ceil + 0.025, (iz0 + iz1) / 2, PLANK);
  for (const x of [-2.2, -0.55, 0.55, 2.2]) sb.onFace("-z", -iz1, x, (floor + ceil) / 2, 0.1, ceil - floor, 0.08, 0.04, TIMBER);
  for (const z of [1.4, 3.8]) {
    sb.onFace("+x", -ix, z, (floor + ceil) / 2, 0.1, ceil - floor, 0.08, 0.04, TIMBER);
    sb.onFace("-x", -ix, z, (floor + ceil) / 2, 0.1, ceil - floor, 0.08, 0.04, TIMBER);
  }
  b.glow(0.14, 0.22, 0.14, -1.65, floor + 1.4, iz1 - 0.17, FLAME);
  sb.box(0.2, 0.05, 0.2, -1.65, floor + 1.535, iz1 - 0.17, IRON);
  sb.box(0.18, 0.04, 0.18, -1.65, floor + 1.27, iz1 - 0.17, IRON);
  sb.box(0.03, 0.03, 0.22, -1.65, floor + 1.7, iz1 - 0.11, IRON);
  sb.box(0.02, 0.14, 0.02, -1.65, floor + 1.63, iz1 - 0.21, IRON);

  // --- the crab winch -------------------------------------------------------
  const wz = 1.95;
  const axle = floor + 0.6;
  const crank = axle + 0.55;
  for (const sx of [-1, 1] as const) {
    // A cast A-frame each side on a timber bed bolted down to the floor.
    sb.box(0.22, 0.14, 1.4, sx * 1.4, floor + 0.07, wz, TIMBER, undefined, HIDE_UNDER);
    for (const ez of [-1, 1] as const) bar(sb, [sx * 1.4, floor + 0.14, wz + ez * 0.6], [sx * 1.4, crank + 0.1, wz + ez * 0.06], 0.06, 0.12, RUST);
    bar(sb, [sx * 1.4, floor + 0.45, wz - 0.48], [sx * 1.4, floor + 0.45, wz + 0.48], 0.06, 0.1, RUST);
    b.cyl(0.14, 0.26, 0.26, 10, sx * 1.4, axle, wz, RUST, rotZ);
    b.cyl(0.12, 0.18, 0.18, 8, sx * 1.4, crank, wz, RUST, rotZ);
    for (const ez of [-1, 1] as const) sb.box(0.12, 0.05, 0.1, sx * 1.4, floor + 0.165, wz + ez * 0.6, IRON);
    // The crank, hanging.
    bar(sb, [sx * 1.6, crank, wz], [sx * 1.6, crank - 0.26, wz - 0.14], 0.04, 0.07, RUST);
    b.cyl(0.12, 0.05, 0.05, 6, sx * 1.66, crank - 0.26, wz - 0.14, IRON, rotZ);
  }
  // The barrel, ribbed where the chain lies on it, between its flanges.
  b.cyl(2.6, 0.7, 0.7, 16, 0, axle, wz, RUST, rotZ);
  for (const sx of [-1, 1] as const) b.cyl(0.05, 0.9, 0.9, 16, sx * 1.27, axle, wz, RUST, rotZ);
  for (let i = 0; i < 9; i++) b.cyl(0.035, 0.75, 0.75, 16, -1.1 + i * 0.275, axle, wz, IRON, rotZ);
  // The spur wheel on the barrel, and the pinion on the crank shaft meshing with it.
  b.cyl(0.07, 0.84, 0.84, 20, 1.52, axle, wz, RUST, rotZ);
  b.cyl(0.16, 0.22, 0.22, 10, 1.55, axle, wz, RUST, rotZ);
  for (let k = 0; k < 3; k++) sb.box(0.03, 0.06, 0.74, 1.57, axle, wz, RUST, { x: (k * Math.PI) / 3 });
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    sb.box(0.07, 0.06, 0.05, 1.52, axle + 0.445 * Math.sin(a), wz + 0.445 * Math.cos(a), RUST, { x: Math.PI / 2 - a });
  }
  b.cyl(0.1, 0.26, 0.26, 10, 1.52, crank, wz, IRON, rotZ);
  b.cyl(3.2, 0.06, 0.06, 6, 0, crank, wz, IRON, rotZ);
  // The ratchet and its pawl at the other end, and the brake lever.
  b.cyl(0.06, 0.5, 0.5, 14, -1.5, axle, wz, RUST, rotZ);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    sb.box(0.06, 0.05, 0.08, -1.5, axle + 0.26 * Math.sin(a), wz + 0.26 * Math.cos(a), RUST, { x: Math.PI / 2 - a + 0.4 });
  }
  bar(sb, [-1.5, axle + 0.5, wz + 0.35], [-1.5, axle + 0.28, wz + 0.12], 0.04, 0.05, IRON);
  b.cyl(0.08, 0.08, 0.08, 6, -1.5, axle + 0.5, wz + 0.35, RUST, rotZ);
  bar(sb, [-1.56, floor + 0.3, wz + 0.55], [-1.56, floor + 1.32, wz + 0.3], 0.05, 0.05, RUST);
  sb.box(0.07, 0.08, 0.07, -1.56, floor + 1.34, wz + 0.3, IRON);

  // --- the chain ------------------------------------------------------------
  // Off the barrel, down under a roller at the ceiling and out beneath the
  // door head — clear of a head out on the quay — round a lead sheave at the
  // mast's foot, up the mast on stand-offs and over a sheave beside the tail.
  const cy = floor + 2.08;
  const sheaveY = 13.3;
  bar(sb, [CX, axle + 0.37, wz], [CX, cy, iz0 + 0.9], 0.05, 0.05, RUST);
  b.cyl(0.3, 0.12, 0.12, 8, CX, cy + 0.085, iz0 + 0.9, IRON, rotZ);
  for (const e of [-1, 1] as const) sb.box(0.03, ceil - cy - 0.085, 0.03, CX + e * 0.13, (ceil + cy + 0.085) / 2, iz0 + 0.9, IRON);
  bar(sb, [CX, cy, iz0 + 0.9], [CX, cy, -1.95], 0.05, 0.05, RUST);
  sb.box(0.84, 0.14, 0.84, 0, cy + 0.25, MZ, RUST);
  for (const e of [-1, 1] as const) sb.box(0.03, 0.55, 0.9, CX + e * 0.08, cy + 0.25, -2.15, RUST);
  b.cyl(0.08, 0.5, 0.5, 12, CX, cy + 0.25, -1.95, IRON, rotZ);
  b.cyl(0.22, 0.08, 0.08, 6, CX, cy + 0.25, -1.95, RUST, rotZ);
  sb.box(0.05, sheaveY - (cy + 0.25), 0.05, CX, (sheaveY + cy + 0.25) / 2, -2.2, RUST);
  for (const y of [7.6, 11.0]) {
    bar(sb, [0.2, y, MZ + 0.4], [CX, y, -2.24], 0.05, 0.05, RUST);
    sb.box(0.11, 0.04, 0.11, CX, y, -2.2, RUST);
  }
  for (const x of [0.29, 0.39]) sb.box(0.03, 0.6, 0.65, x, sheaveY, -2.45, RUST);
  b.cyl(0.06, 0.5, 0.5, 12, CX + 0.01, sheaveY, -2.45, IRON, rotZ);
  // Then down to the jib, along its rollers, over the head and down the fall.
  bar(sb, [CX, sheaveY + 0.25, -2.45], J(1.0, 0.52), 0.05, 0.05, RUST);
  bar(sb, J(1.0, 0.52), J(head, 0.52), 0.05, 0.05, RUST);
  const phi0 = Math.atan2(nrm[1], nrm[2]);
  let prev = J(head, 0.52);
  for (let k = 1; k <= 3; k++) {
    const phi = phi0 + ((Math.PI - phi0) * k) / 3;
    const p: Point3 = [0, C[1] + 0.52 * Math.sin(phi), C[2] + 0.52 * Math.cos(phi)];
    bar(sb, prev, p, 0.05, 0.05, RUST);
    prev = p;
  }
  // The fall, link by link, each turned a quarter from the last.
  const fz = C[2] - 0.52;
  const blockTop = 3.78;
  const links = Math.floor((C[1] - blockTop) / 0.13);
  for (let k = 0; k < links; k++) {
    const y = C[1] - (k + 0.5) * 0.13;
    for (const e of [-1, 1] as const) {
      if (k % 2 === 0) {
        sb.box(0.03, 0.17, 0.03, 0, y, fz + e * 0.04, RUST);
        sb.box(0.03, 0.03, 0.11, 0, y + e * 0.07, fz, RUST);
      } else {
        sb.box(0.03, 0.17, 0.03, e * 0.04, y, fz, RUST);
        sb.box(0.11, 0.03, 0.03, e * 0.07, y, fz, RUST);
      }
    }
  }
  // The hook block: a swivel, two cheeks round a sheave, and the hook clear
  // of every head under it.
  sb.box(0.05, 0.16, 0.14, 0, blockTop - 0.08, fz, RUST);
  for (const e of [-1, 1] as const) sb.box(0.05, 0.6, 0.44, e * 0.12, 3.3, fz, RUST);
  b.cyl(0.14, 0.4, 0.4, 12, 0, 3.3, fz, IRON, rotZ);
  b.cyl(0.34, 0.1, 0.1, 6, 0, 3.3, fz, RUST, rotZ);
  sb.box(0.3, 0.08, 0.2, 0, 2.97, fz, RUST);
  const hook: Point3[] = [
    [0, 2.93, fz],
    [0, 2.64, fz],
    [0, 2.555, fz + 0.035],
    [0, 2.52, fz + 0.1],
    [0, 2.555, fz + 0.165],
    [0, 2.63, fz + 0.2],
    [0, 2.71, fz + 0.18],
  ];
  for (let i = 1; i < hook.length; i++) bar(sb, hook[i - 1], hook[i], 0.075 - i * 0.006, 0.075 - i * 0.006, RUST);

  // The batch before what it hides, then the cores it hides.
  sb.flush(b);
  b.box(2 * PX - 0.06, plinth - 0.04, Z1 - Z0 - 0.06, 0, (plinth - 0.04) / 2, 0.8, SLAG);
  b.box(hw - 0.08, 0.96, hd - 0.08, 0, plinth + 0.48, hz, SLAG);
  b.box(2 * cw - 0.08, 1.68, 2 * cw - 0.08, 0, cBot + 0.84, cz, SLAG);
  b.box(jamb, wallH, 0.3, 0 - off, wallY, frontZ, PITCH);
  b.box(jamb, wallH, 0.3, 0 + off, wallY, frontZ, PITCH);
  b.box(1.6, lintel, 0.3, 0, wallY + wallH / 2 - lintel / 2, frontZ, PITCH);
  b.box(hw, wallH, 0.3, 0, wallY, hz + hd / 2, PITCH);
  for (const sx of [-1, 1] as const) b.box(0.3, wallH, hd, (sx * hw) / 2, wallY, hz, PITCH);
  for (const zc of [frontZ, hz + hd / 2]) {
    const gable = (z: number): Point3[] => [
      [-xp, top, z],
      [xp, top, z],
      [xp, roofAt(xp), z],
      [0, top + rise, z],
      [-xp, roofAt(xp), z],
    ];
    convexSolid(b, gable(zc - 0.15), gable(zc + 0.15), PITCH);
  }
  for (const s of [-1, 1] as const) {
    b.box(slope + 0.02, 0.03, roofLen, (s * run) / 2 - s * nx * 0.015, top + rise / 2 - ny * 0.015, hz, PLANK, { z: -s * pitch });
  }
  const ridge = (z: number): Point3[] => [
    [-0.24, top + rise - 0.02, z],
    [0.24, top + rise - 0.02, z],
    [0, top + rise + 0.2, z],
  ];
  convexSolid(b, ridge(hz - roofLen / 2 - 0.04), ridge(hz + roofLen / 2 + 0.04), BASALT);
  return b;
}
