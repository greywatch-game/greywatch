/**
 * kit/structures/cart.ts — buildCart: the farm wagon, whole or with a wheel
 * off.
 * Part of the structures set: follows the contract in kit/core.ts, and the
 * cover heights and round-collider rule in `./index.ts`.
 */
import { Matrix, Scene, Vector3, type Mesh } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import {
  Build,
  type BuildCtx,
  type BuildParams,
  type Structure,
  streetSeed,
  BRICK,
  ENAMEL,
  IRON,
  PLANK,
  STRAW,
  TIMBER,
} from "../core";
import { reframe, about, cartWheel, cartSack, cartFork, cartCask } from "./cartParts";

/**
 * Farm wagon, bed along X, shafts to +X. Chest-high cover with a readable
 * silhouette — spoked wheels, a flared box on a turned front carriage, and the
 * shafts run out along the ground — so it never reads as a crate. `ruined`
 * has lost its near hind wheel and sits down on that corner, for ground that
 * has already been fought over.
 *
 * **It is built the way one is built, and that is the whole of the brief.**
 * The cart it replaces was a plank box on four discs with its shafts hanging in
 * the air, and every one of those three was a thing a player standing beside it
 * could see was not a cart. So: big wheels behind and small ones in front, the
 * front pair on a turntable under the bed so they can lock round, and locked
 * round a little, because nobody leaves a wagon with its wheels dead straight;
 * a perch coupling the two axles, hounds bracing each; a floor of boards on
 * bearers between two sills; sides that flare outward on staked standards
 * to a rave; a headboard and a pinned tailboard on chains; and the shafts,
 * unhitched, resting their tips on the ground — which is where a pair of
 * timbers pinned at one end goes when the horse walks out of them.
 *
 * **Everything that is not the collider is drawing**, and the collider is the
 * one box it has always been: 3.4 x 1.7 x 2.0, hard cover, in the same order.
 * The shafts, the naves, a load heaped over the rave and anything spilled on
 * the ground stand outside it, as the old shafts did — a round through a
 * shaft's tip or a tuft of hay is a round through dressing.
 *
 * **What it carries, and how it is kept, are seeded off where it stands**
 * (`streetSeed`), which is what puts it in `CONFORMS_TO_TERRAIN`: loose straw
 * and a fork, sacks, a heaped load of hay or casks; bare weathered timber or
 * the painted body and red running gear a wagon was sold in; which way the
 * front wheels are locked; and whether a chock sits behind a hind wheel. And it
 * SITS on the ground under its four wheels rather than on the one sample under
 * its middle — pitched and rolled to it, within reason — so a wagon on a slope
 * has all four tyres on the road.
 */
export function buildCart(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "cart");
  const ruined = p.ruined ?? false;
  const seed = streetSeed(3.4, 2.0, 1.7, ctx);
  /**
   * Painted — a blue body over red-oxide running gear, faded to what the
   * palette already has — or bare timber gone grey.
   */
  const painted = !ruined && (seed >>> 3) % 3 === 0;
  const BODY = painted ? ENAMEL : PLANK;
  const GEAR = painted ? BRICK : TIMBER;
  /** 0 straw and a fork, 1 sacks, 2 a load of hay, 3 casks. */
  const load = (seed >>> 7) % 4;
  /** Which way, and how far, the front wheels are locked. */
  const lock = (((seed >>> 11) & 1) === 0 ? -1 : 1) * (0.1 + ((seed >>> 12) % 5) * 0.035);
  const chocked = ((seed >>> 17) & 1) === 0;

  // ---- the numbers everything hangs off. Bed along X, shafts to +X.
  /** Hind and fore axle stations, and their wheels' radii — the hind pair big. */
  const XR = -0.95;
  const XF = 1.05;
  const RR = 0.66;
  const RF = 0.5;
  /** Where the wheels' planes stand either side of the centreline. */
  const TRACK = 0.9;
  /** The sills' underside, the floor's top, and the body's length. */
  const SILL = 0.84;
  const SILL_TOP = SILL + 0.14;
  const FLOOR = SILL_TOP + 0.035;
  const L = 3.1;
  const HL = L / 2;
  /**
   * The sides: they rise from the floor's edge at `SIDE_Z` and lean OUT by
   * `LEAN` for `SLANT` metres, to a rave at about the collider's top. The flare
   * is what a wagon box is — it is also what keeps the hind wheels, which stand
   * above the floor, clear of the boarding.
   */
  const SIDE_Z = 0.63;
  const LEAN = 0.24;
  const SLANT = 0.7;
  const cosL = Math.cos(LEAN);
  const sinL = Math.sin(LEAN);
  /** A point `s` up the slope of the side at `sz`, stood `n` off its outer face. */
  const onSide = (sz: number, s: number, n: number): [number, number] => [
    SILL_TOP + s * cosL - n * sinL,
    sz * (SIDE_Z + s * sinL + n * cosL),
  ];

  /**
   * The floor under a local point, as a local height, or 0 with nothing to
   * read — and 0 for a placement lifted onto something `MapBuilder` does not
   * know about (see `BuildCtx.floor`). `MapBuilder`'s rotation: local +X lands
   * on (cos, -sin), +Z on (sin, cos).
   */
  const ground = (lx: number, lz: number): number => {
    if (!ctx || Math.abs(ctx.y - ctx.floor) > 0.05) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    const h = ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
    return Math.max(-0.4, Math.min(0.4, h));
  };

  // ================================================================ the body
  // Built level, on its own frame; the ruin sits it down afterwards.
  const bodyFrom = b.meshes.length;
  // Two sills the length of the bed, and the end rails and bearers between.
  for (const sz of [-1, 1]) b.box(L + 0.06, 0.14, 0.1, 0, SILL + 0.07, sz * 0.58, GEAR);
  for (const sx of [-1, 1]) b.box(0.1, 0.14, 1.26, sx * (HL - 0.05), SILL + 0.07, 0, GEAR);
  for (const x of [-0.95, -0.3, 0.35, 1.0]) b.box(0.08, 0.1, 1.06, x, SILL + 0.09, 0, GEAR);
  // The floor: six boards, a finger's gap apart.
  {
    const bw = 0.2;
    const gap = 0.012;
    for (let i = 0; i < 6; i++) {
      const z = -0.63 + bw / 2 + i * (bw + gap);
      b.box(L - 0.02 - (i % 2) * 0.03, 0.035, bw, (i % 2) * 0.015, SILL_TOP + 0.0175, z, BODY);
    }
  }
  // The sides: three boards up the flare, each leaned out by `LEAN`.
  //
  // **The boards LAP rather than butt**: each overlaps the one under it and
  // the middle one stands `LAP` proud, so every joint is a step the ink finds
  // on both faces. A gap between square boards drew the same line and let a
  // lit window across the street shine through the cart.
  const BOARD = 0.237;
  const LAP = 0.007;
  const boardS = (i: number): number => BOARD / 2 + i * BOARD;
  for (const sz of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const [y, z] = onSide(sz, boardS(i), 0.0175 + (i % 2) * LAP);
      b.box(L - 0.04, BOARD + 0.012, 0.035, 0, y, z, BODY, { x: sz * LEAN });
    }
    // Standards on the outer face, from the sill to the rave, with an iron
    // knee where each one meets the sill.
    for (const x of [-(HL - 0.05), -0.78, 0, 0.78, HL - 0.05]) {
      const [y, z] = onSide(sz, 0.29, 0.06);
      b.box(0.075, 0.86, 0.05, x, y, z, GEAR, { x: sz * LEAN });
      const [ky, kz] = onSide(sz, 0.02, 0.09);
      b.box(0.09, 0.14, 0.012, x, ky, kz, IRON, { x: sz * LEAN });
    }
    // The rave along the top, standing a little proud of the standards.
    {
      const [y, z] = onSide(sz, SLANT + 0.035, 0.035);
      b.box(L + 0.14, 0.075, 0.09, 0, y, z, GEAR, { x: sz * LEAN });
      // An iron cap over each end of it.
      for (const sx of [-1, 1]) {
        b.box(0.1, 0.085, 0.1, sx * (HL + 0.02), y, z, IRON, { x: sz * LEAN });
      }
    }
  }
  /** The body's half-width across the inside of its sides, at slope `s`. */
  const across = (s: number): number => 2 * (SIDE_Z + s * sinL);
  // The headboard, capped with a rail level with the raves. Its boards are
  // as tall as the sides' in plan, so their joints line through the corner.
  for (let i = 0; i < 3; i++) {
    const s = boardS(i);
    b.box(0.035, BOARD * cosL + 0.012, across(s), HL - 0.02 + (i % 2) * LAP, SILL_TOP + s * cosL, 0, BODY);
  }
  b.box(0.07, 0.07, across(SLANT) + 0.04, HL, SILL_TOP + 3 * BOARD * cosL + 0.02, 0, GEAR);
  for (const sz of [-1, 1]) {
    // Its two uprights, from the sill to the cap.
    b.box(0.075, 0.86, 0.05, HL + 0.035, SILL_TOP + 0.28, sz * 0.5, GEAR);
  }
  // The tailboard is its own piece: it comes out. On a ruin it has.
  const tailFrom = b.meshes.length;
  for (let i = 0; i < 3; i++) {
    const s = boardS(i);
    b.box(0.035, BOARD * cosL + 0.012, across(s) - 0.02, -(i % 2) * LAP, SILL_TOP + s * cosL, 0, BODY);
  }
  for (const sz of [-1, 1]) {
    b.box(0.012, 0.66, 0.06, -0.03, SILL_TOP + 0.34, sz * 0.4, IRON);
  }
  const tail = b.meshes.slice(tailFrom);
  if (!ruined) {
    reframe(tail, Matrix.Translation(-(HL - 0.02), 0, 0));
    // Pinned through the end standards, a chain from each top corner.
    for (const sz of [-1, 1]) {
      const [y, z] = onSide(sz, 0.62, 0.02);
      b.box(0.14, 0.022, 0.022, -(HL + 0.03), y, z, IRON);
      for (let k = 0; k < 4; k++) {
        b.box(0.02, 0.06, 0.035, -(HL + 0.06), y - 0.05 - k * 0.05, z - sz * 0.02 * k, IRON, {
          y: k % 2 ? Math.PI / 2 : 0,
        });
      }
    }
  }

  // ---- the hind carriage: fixed to the body, so it goes where the body goes.
  b.box(0.14, 0.14, 1.36, XR, RR, 0, GEAR);
  b.box(0.15, SILL - (RR + 0.07), 1.3, XR, (SILL + RR + 0.07) / 2, 0, GEAR);
  for (const sz of [-1, 1]) {
    b.box(0.17, 0.26, 0.03, XR, RR + 0.06, sz * 0.46, IRON);
  }
  // The perch, coupling the hind axle to the fore, and the hounds bracing it.
  b.box(XF - XR + 0.3, 0.09, 0.1, (XF + XR) / 2 + 0.05, RR - 0.08, 0, GEAR);
  {
    const x0 = XR;
    const x1 = XR + 0.95;
    const z0 = 0.42;
    const len = Math.hypot(x1 - x0, z0);
    for (const sz of [-1, 1]) {
      b.box(len, 0.07, 0.07, (x0 + x1) / 2, RR - 0.08, (sz * z0) / 2, GEAR, {
        y: sz * Math.atan2(z0, x1 - x0),
      });
    }
  }
  // The fore bolster under the body, and the turntable ring it bears on.
  b.box(0.14, 0.1, 1.2, XF, SILL - 0.05, 0, GEAR);
  b.cyl(0.03, 0.8, 0.8, 14, XF, SILL - 0.115, 0, IRON);
  // The hind wheels.
  for (const sz of [-1, 1]) {
    if (ruined && sz < 0) continue;
    const w = cartWheel(b, RR, 12, GEAR, 0.13 * sz + ((seed >>> 20) % 7) * 0.07);
    const flip = sz < 0 ? Matrix.RotationY(Math.PI) : Matrix.Identity();
    reframe(w, flip.multiply(Matrix.Translation(XR, RR, sz * TRACK)));
  }
  // A drag shoe hung on its chain from the near sill, ahead of the hind wheel,
  // as every wagon that ever went down a hill carried one.
  if (!ruined) {
    const x = XR + RR + 0.12;
    for (let k = 0; k < 5; k++) {
      b.box(0.035, 0.07, 0.02, x, SILL - 0.04 - k * 0.065, -0.66, IRON, { y: k % 2 ? Math.PI / 2 : 0 });
    }
    b.box(0.34, 0.05, 0.1, x - 0.1, SILL - 0.4, -0.66, IRON, { z: 0.35 });
    b.box(0.04, 0.1, 0.1, x - 0.26, SILL - 0.37, -0.66, IRON, { z: 0.35 });
  }
  // A step iron hung off the off-side sill by the front.
  b.box(0.03, 0.26, 0.03, XF - 0.45, SILL - 0.1, 0.66, IRON);
  b.box(0.18, 0.025, 0.1, XF - 0.45, SILL - 0.23, 0.69, IRON);

  // ---- the load, on the floor.
  const loadFrom = b.meshes.length;
  const onFloor = (meshes: Mesh[], x: number, z: number, yaw: number, lift = 0, roll = 0): void =>
    reframe(
      meshes,
      Matrix.RotationX(roll).multiply(Matrix.RotationY(yaw)).multiply(Matrix.Translation(x, FLOOR + lift, z)),
    );
  if (ruined) {
    // What is left of the sacks has slid to the low corner.
    onFloor(cartSack(b), -0.95, -0.22, 0.15, 0, -0.1);
    onFloor(cartSack(b), 0.1, -0.24, -0.1);
  } else if (load === 0) {
    // Loose straw left in drifts over the boards — low cones squashed flat,
    // since a slab of it is a plank — and a fork thrown in on top.
    for (const [x, z, d, h, sx] of [
      [-0.85, 0.15, 0.95, 0.16, 1.5],
      [0.25, -0.22, 0.8, 0.12, 1.7],
      [1.0, 0.25, 0.6, 0.1, 1.2],
      [-0.2, 0.3, 0.5, 0.08, 1.4],
    ] as const) {
      b.cyl(h, d * 0.3, d, 6, x, FLOOR + h / 2 - 0.01, z, STRAW, { y: x }).scaling.x = sx;
    }
    onFloor(cartFork(b), -0.7, -0.1, -0.35, 0.07, 0.05);
  } else if (load === 1) {
    // Sacks, laid two ways as they were thrown up.
    const SACKS: [number, number, number, number][] = [
      [-1.05, -0.3, 0.1, 0],
      [-1.05, 0.28, -0.05, 0],
      [-0.25, -0.28, 0.0, 0],
      [-0.25, 0.3, 0.12, 0],
      [0.6, -0.1, 1.5, 0],
      [-0.65, 0.0, 0.08, 0.24],
      [0.15, 0.02, -0.1, 0.24],
    ];
    for (const [x, z, yaw, lift] of SACKS) {
      if (lift > 0 && ((seed >>> 22) & 1) === 0 && x > 0) continue;
      onFloor(cartSack(b), x, z, yaw, lift);
    }
  } else if (load === 2) {
    // A load of hay heaped over the rave. The box fills the bed to the rave and
    // is all but hidden by it; what shows is a row of heaps over it, each a
    // shoulder and a crown stacked as the haystack's cap is, overlapping into
    // one ridge that rises and falls, and spread past the rave on both sides
    // the way a load is built. A single loaf drawn with seven facets read as a
    // lid; hanging wisps and loose stalks read as flaps and slots.
    b.box(L - 0.12, 0.62, 1.34, 0, FLOOR + 0.3, 0, STRAW);
    const HAY = FLOOR + 0.56;
    for (const [x, h, yaw] of [
      [-1.2, 0.34, 0.2],
      [-0.62, 0.48, 1.1],
      [-0.05, 0.42, 0.5],
      [0.5, 0.5, 1.6],
      [0.9, 0.32, 0.9],
    ] as const) {
      const sh = h * 0.5;
      b.cyl(sh, 1.3, 1.62, 7, x, HAY + sh / 2, 0, STRAW, { y: yaw }).scaling.x = 0.72;
      b.cyl(h - sh, 0.4, 1.3, 7, x, HAY + sh + (h - sh) / 2, 0, STRAW, { y: yaw + 0.45 }).scaling.x = 0.72;
    }
    const fork = cartFork(b);
    reframe(
      fork,
      Matrix.RotationZ(-0.75).multiply(Matrix.RotationY(0.5)).multiply(Matrix.Translation(-0.35, FLOOR + 1.02, 0.15)),
    );
  } else {
    // Casks stood on end and a crate, with a sack wedged against them.
    onFloor(cartCask(b, 0.78, 0.56), -0.95, -0.26, 0);
    onFloor(cartCask(b, 0.78, 0.56), -0.95, 0.3, 0.7);
    onFloor(cartCask(b, 0.62, 0.46), -0.3, 0.3, 0.2);
    b.box(0.7, 0.5, 0.56, 0.45, FLOOR + 0.25, -0.2, TIMBER, { y: 0.15 });
    for (const dx of [-0.33, 0.33]) {
      b.box(0.06, 0.52, 0.6, 0.45 + dx * Math.cos(0.15), FLOOR + 0.26, -0.2 - dx * Math.sin(0.15), PLANK, { y: 0.15 });
    }
    onFloor(cartSack(b), 0.45, 0.35, 0.1);
  }
  const loadMeshes = b.meshes.slice(loadFrom);
  const body = b.meshes.slice(bodyFrom, loadFrom).filter((m) => !tail.includes(m) || !ruined);

  // ====================================================== the fore carriage
  // Built square on its own axle, then turned on the kingpin by `lock`.
  const foreFrom = b.meshes.length;
  b.box(0.13, 0.13, 1.44, XF, RF, 0, GEAR);
  b.box(0.14, SILL - 0.13 - (RF + 0.065), 1.16, XF, (SILL - 0.13 + RF + 0.065) / 2, 0, GEAR);
  b.cyl(0.46, 0.05, 0.05, 6, XF, SILL - 0.16, 0, IRON);
  for (const sz of [-1, 1]) b.box(0.16, 0.24, 0.03, XF, RF + 0.05, sz * 0.44, IRON);
  // The fore hounds, from a slider bar under the perch out to the shaft pins.
  /** Where each shaft is pinned, and the height it is pinned at. */
  const PX = XF + 0.5;
  const PZ = 0.36;
  const PY = RF + 0.02;
  {
    const x0 = XF - 0.55;
    const z0 = 0.12;
    const len = Math.hypot(PX - x0, PZ - z0);
    for (const sz of [-1, 1]) {
      b.box(len, 0.075, 0.07, (x0 + PX) / 2, PY, (sz * (z0 + PZ)) / 2, GEAR, {
        y: -sz * Math.atan2(PZ - z0, PX - x0),
      });
    }
    b.box(0.07, 0.06, 0.5, x0, RR - 0.15, 0, GEAR);
  }
  for (const sz of [-1, 1]) {
    const w = cartWheel(b, RF, 10, GEAR, 0.21 * sz + ((seed >>> 24) % 5) * 0.09);
    const flip = sz < 0 ? Matrix.RotationY(Math.PI) : Matrix.Identity();
    reframe(w, flip.multiply(Matrix.Translation(XF, RF, sz * TRACK)));
  }
  // The shafts, unhitched: pinned at the hounds and resting their tips on the
  // ground ahead, which is where they fall when the horse walks out of them.
  // The ruin has snapped one and the rest of it lies where it fell.
  const SHAFT = 2.75;
  const tip = 0.05;
  const pitch = -Math.asin((PY - tip) / SHAFT);
  const along = (d: number): [number, number] => [PX + Math.cos(pitch) * d, PY + Math.sin(pitch) * d];
  for (const sz of [-1, 1]) {
    const snapped = ruined && sz > 0;
    const len = snapped ? 1.25 : SHAFT;
    const [x, y] = along(len / 2);
    b.box(len, 0.085, 0.07, x, y, sz * PZ, GEAR, { z: pitch });
    b.box(0.1, 0.11, 0.09, PX, PY, sz * PZ, IRON);
    if (!snapped) {
      const [tx, ty] = along(SHAFT - 0.05);
      b.box(0.1, 0.1, 0.085, tx, ty, sz * PZ, IRON, { z: pitch });
      const [hx, hy] = along(1.55);
      b.box(0.12, 0.05, 0.03, hx, hy + 0.05, sz * (PZ + 0.05), IRON, { z: pitch });
      b.box(0.03, 0.08, 0.03, hx + 0.05, hy + 0.08, sz * (PZ + 0.05), IRON, { z: pitch });
    }
  }
  {
    const [x, y] = along(0.35);
    b.box(0.07, 0.07, 2 * PZ + 0.1, x, y + 0.01, 0, GEAR, { z: pitch });
  }
  const fore = b.meshes.slice(foreFrom);
  reframe(fore, about(XF, 0, 0, Matrix.RotationY(lock)));

  // ================================================================ the ruin
  // The near hind wheel is off and the body has come down on that corner,
  // pitched back and rolled toward it about the turntable, with the axle's end
  // propped on a log somebody got under it.
  const loose: Mesh[] = [];
  if (ruined) {
    const sit = about(XF, SILL - 0.1, 0, Matrix.RotationZ(0.12).multiply(Matrix.RotationX(-0.26)));
    reframe([...body, ...loadMeshes], sit);
    // A log rolled under the axle-tree's end, wherever the sit put it.
    const stub = Vector3.TransformCoordinates(new Vector3(XR, RR, -0.62), sit);
    const propD = Math.max(0.12, stub.y - 0.07);
    b.cyl(0.6, propD, propD * 1.08, 7, stub.x, propD / 2, stub.z, TIMBER, { x: Math.PI / 2, y: 0.3 });
    // The wheel, face down where it came off and canted up on its nave.
    const w = cartWheel(b, RR, 12, GEAR, 0.4, true);
    reframe(
      w,
      Matrix.RotationX(Math.PI / 2)
        .multiply(Matrix.RotationZ(0.14))
        .multiply(Matrix.RotationY(0.6))
        .multiply(Matrix.Translation(XR - 0.35, 0.17 + ground(XR - 0.35, -1.75), -1.75)),
    );
    loose.push(...w);
    // The tailboard, flat on the ground behind, irons up.
    reframe(
      tail,
      Matrix.Translation(0, -(SILL_TOP + 0.35), 0)
        .multiply(Matrix.RotationZ(-Math.PI / 2))
        .multiply(Matrix.RotationY(0.25))
        .multiply(Matrix.Translation(-HL - 0.75, 0.02 + ground(-HL - 0.75, 0.2), 0.2)),
    );
    loose.push(...tail);
    // The broken half of the shaft, and a sack that went over the side.
    const brokenFrom = b.meshes.length;
    b.box(1.45, 0.085, 0.07, 0, 0.04, 0, GEAR);
    b.box(0.1, 0.1, 0.085, 0.68, 0.045, 0, IRON);
    reframe(
      b.meshes.slice(brokenFrom),
      Matrix.RotationY(-0.5).multiply(Matrix.Translation(PX + 2.0, ground(PX + 2.0, 1.0), 1.0)),
    );
    loose.push(...b.meshes.slice(brokenFrom));
    const sack = cartSack(b);
    reframe(
      sack,
      Matrix.RotationX(0.2).multiply(Matrix.RotationY(1.2)).multiply(Matrix.Translation(-0.6, ground(-0.6, -1.35), -1.35)),
    );
    loose.push(...sack);
  } else if (chocked) {
    // A chock behind a hind wheel.
    const x = XR - 0.34;
    const from = b.meshes.length;
    b.box(0.24, 0.13, 0.14, x, 0.05 + ground(x, TRACK), TRACK, TIMBER, { z: -0.3 });
    loose.push(...b.meshes.slice(from));
  }

  // ============================================================ the ground
  // Sit the whole cart down on the ground under its four wheels: the pitch
  // between the axles, the roll across them, and the lift that puts all four
  // tyres on the floor. Anything already lying on the ground found its own.
  const gF = (ground(XF, TRACK) + ground(XF, -TRACK)) / 2;
  const gR = (ground(XR, TRACK) + ground(XR, -TRACK)) / 2;
  const gP = (ground(XF, TRACK) + ground(XR, TRACK)) / 2;
  const gN = (ground(XF, -TRACK) + ground(XR, -TRACK)) / 2;
  const clamp = (v: number): number => Math.max(-0.18, Math.min(0.18, v));
  const pitchG = clamp(Math.atan2(gF - gR, XF - XR));
  const rollG = clamp(Math.atan2(gP - gN, 2 * TRACK));
  const lift = (gF + gR) / 2 - ((XF + XR) / 2) * Math.tan(pitchG);
  if (pitchG !== 0 || rollG !== 0 || lift !== 0) {
    const standing = b.meshes.filter((m) => !loose.includes(m));
    reframe(
      standing,
      Matrix.RotationZ(pitchG).multiply(Matrix.RotationX(-rollG)).multiply(Matrix.Translation(0, lift, 0)),
    );
  }

  b.block({ w: 3.4, h: 1.7, d: 2.0, x: 0, y: 0.85, z: 0 });
  return b;
}
