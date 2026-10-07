/**
 * kit/harbour/small.ts — The three small pieces of the working waterfront:
 * buildFishRack (the catch hung to dry), buildCareenedHull (an open boat up
 * on the hard) and buildSaltPan (a walled evaporation pan and its heap). Part
 * of the volcanic-coast set: follows the contract in kit/core.ts and the
 * set's rules in `./index.ts`. Invariants: fixed geometry, so nothing is
 * seeded. Never imports another builder.
 */
import { Scene } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import {
  Build,
  type BuildParams,
  type Structure,
  BASALT,
  BASALT_PALE,
  PITCH,
  PLANK,
  SAILCLOTH,
  SLAG,
  TEAK,
  TIMBER,
} from "../core";
import { TRANSLUCENCY } from "./shared";

/**
 * A DRYING RACK: A-frames carrying three poles, with the catch hung on them
 * and a net over one end. Runs along local X.
 *
 * **Netstrand's racks were a run of `woodpile`s** — the only thing in the kit
 * that was long, low and timber without also being a fence — and a woodpile is
 * a solid 1.9 m block, which is exactly the wrong shape. A rack is a thing you
 * see a body THROUGH at forty metres and cannot walk through at two.
 *
 * That is the `porous` + `strut` pair the fence exists for, used a second time
 * and for the reason `BoxSpec.porous` states: the coarse box owns the BODY,
 * the timber owns the ROUND. A round aimed between two poles goes through, one
 * aimed at a pole stops on it, and `CoverMap` never offers a rack as cover —
 * which is right, because it is not cover.
 */
export function buildFishRack(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "fishrack");
  const len = p.length ?? 9;
  const h = 2.6;
  /** Half the splay of an A-frame's feet. */
  const half = 0.85;
  const legLen = Math.hypot(half, h);
  const lean = Math.atan2(half, h);
  const frames = Math.max(2, Math.round(len / 3) + 1);

  for (let i = 0; i < frames; i++) {
    const x = -len / 2 + (i * len) / (frames - 1);
    for (const sz of [-1, 1] as const) {
      // Feet at ±half, heads meeting on the centreline: the top of a box
      // rotated about X by `a` moves to `+sin a` in Z, so the leg standing at
      // +Z takes a NEGATIVE angle to lean back over the middle.
      b.strut(0.17, legLen, 0.17, x, h / 2, (sz * half) / 2, TIMBER, {
        x: -sz * lean,
      });
    }
    b.strut(0.14, 0.14, half, x, 1.3, 0, TIMBER);
  }
  // The poles the catch hangs from, running the whole length.
  for (const y of [1.5, 2.0, 2.42]) {
    b.strut(len, 0.13, 0.13, 0, y, 0, TIMBER);
  }
  // The catch: split fish over the top two poles, alternating so that a rack
  // does not read as a comb.
  const hung = Math.max(2, Math.floor(len / 0.9));
  for (let i = 0; i < hung; i++) {
    const x = -len / 2 + 0.5 + (i * (len - 1)) / (hung - 1);
    const y = i % 2 === 0 ? 2.42 : 2.0;
    b.box(0.13, 0.52, 0.1, x, y - 0.3, 0, i % 3 === 0 ? SAILCLOTH : PITCH);
  }
  // One net over the end, and the one thing here the key light comes through.
  b.translucentBox(
    len * 0.38,
    1.5,
    0.06,
    -len * 0.22,
    1.72,
    0.24,
    SAILCLOTH,
    TRANSLUCENCY.awning,
    { z: 0.05 },
  );

  // The coarse box: the whole run, at the height a body walks into it.
  b.block({ w: len, h: 1.95, d: half * 2 + 0.3, x: 0, y: 0.975, z: 0, porous: true });
  return b;
}

/**
 * A CAREENED HULL: an open boat up on the hard, chocked on keel blocks with
 * four shores holding her upright and a tarpaulin over the after half.
 *
 * **There is no boat in this game and this is not waiting to be one.** It
 * answers a question every waterfront on this map raised and none of them
 * answered: eleven boat sheds, eight jetties, three slipways, and nothing
 * anywhere that had ever been in the water. A hull on the hard is what a
 * fishing town looks like between tides, and it is the piece that makes the
 * jetties read as jetties rather than as decking.
 *
 * It is also the only real hard cover on an open strand — 2.9 m, over
 * `CONFIG.bots.cover.hardHeight`, so it stops a round at a body standing up —
 * which is why the collider is one honest box from the ground to the sheer
 * rather than a shell you could shoot underneath. The shores are `strut`s, so
 * a round that hits one stops on it.
 */
export function buildCareenedHull(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "hull");
  const len = p.length ?? 11;

  // The cradle: two keel blocks and four raking shores.
  for (const sz of [-1, 1] as const) {
    b.wall(1.3, 0.7, 1.1, 0, 0.35, sz * len * 0.25, BASALT);
    for (const sx of [-1, 1] as const) {
      b.strut(0.26, 2.2, 0.26, sx * 2.15, 0.85, sz * len * 0.28, TIMBER, {
        z: sx * 0.688,
      });
    }
  }

  // The hull, four strakes deepening to the sheer. Boxes cannot taper, so what
  // makes this a boat rather than a crate is the raked stem and stern posts
  // and one pale boot-topping line across a tarred body.
  b.box(0.42, 0.5, len, 0, 0.95, 0, PITCH);
  b.box(1.9, 0.75, len * 0.93, 0, 1.4, 0, PITCH);
  b.box(2.7, 0.7, len * 0.97, 0, 2.0, 0, PITCH);
  b.box(3.16, 0.11, len * 0.995, 0, 2.29, 0, SAILCLOTH);
  b.box(3.1, 0.52, len, 0, 2.6, 0, PLANK);
  b.box(3.26, 0.16, len + 0.2, 0, 2.9, 0, TEAK);
  for (const sz of [-1, 1] as const) {
    b.box(0.38, 2.7, 0.38, 0, 1.95, sz * (len / 2 + 0.34), PITCH, { x: sz * 0.28 });
  }
  for (const dz of [-0.22, 0, 0.22]) {
    b.box(2.7, 0.1, 0.36, 0, 2.55, dz * len, PLANK);
  }
  b.box(0.27, 3.6, 0.27, 0, 4.3, -len * 0.12, TIMBER, { x: -0.05 });
  b.box(3.0, 0.13, len * 0.42, 0, 3.0, len * 0.2, SAILCLOTH, { x: 0.03 });

  b.block({ w: 3.3, h: 2.9, d: len, x: 0, y: 1.45, z: 0 });
  return b;
}

/**
 * A SALT PAN: a shallow walled evaporation pan with the crust round its lip
 * and a heap of what came out of it.
 *
 * **There is nothing to farm on a lava island and no river on it**, so what
 * the flat ground behind a strand is for is taking salt out of the sea. That
 * is the third industry this map needed and the one that explains a settlement
 * standing on ground which grows nothing.
 *
 * **The coping is DRAWN and not collided, and that is the design rather than a
 * shortcut.** It is 0.45 m: a collider there would be a surface `NavGrid` has
 * to stand a body on and a wall every `moveWithCollisions` candidate is tested
 * against, for a kerb a player steps over without noticing. What leaving it
 * out buys is that a field of pans is as free as a field of road slabs —
 * twenty of them cost the ray budget nothing at all — and a pan is read from
 * the AIR, which on the one map in the tree with a helicopter on it is where
 * most people will see it from.
 *
 * The heap is the exception and is a real obstacle: it is 1.1 m of salt, and a
 * round ought to stop in it.
 */
export function buildSaltPan(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "saltpan");
  const w = p.width ?? 22;
  const d = p.depth ?? 14;
  const kerb = 0.45;
  const t = 0.55;

  // The brine: dark packed floor, a hand under the coping.
  b.box(w - t * 2, 0.12, d - t * 2, 0, 0.06, 0, SLAG);
  // The crust that gathers round the inside of the lip.
  for (const sz of [-1, 1] as const) {
    b.box(w - t * 2, 0.06, 0.5, 0, 0.14, sz * (d / 2 - t - 0.25), SAILCLOTH);
  }
  for (const sx of [-1, 1] as const) {
    b.box(0.5, 0.06, d - t * 2 - 1.0, sx * (w / 2 - t - 0.25), 0.14, 0, SAILCLOTH);
  }
  // The coping. Visual only — see `buildSaltPan`'s header.
  for (const sz of [-1, 1] as const) {
    b.box(w, kerb, t, 0, kerb / 2, (sz * (d - t)) / 2, BASALT_PALE);
  }
  for (const sx of [-1, 1] as const) {
    b.box(t, kerb, d - t * 2, (sx * (w - t)) / 2, kerb / 2, 0, BASALT_PALE);
  }
  // The sluice in the seaward lip: two posts and the paddle between them.
  for (const sx of [-1, 1] as const) {
    b.box(0.2, 1.4, 0.2, sx * 0.75, 0.7, -(d - t) / 2, TIMBER);
  }
  b.box(1.5, 0.9, 0.14, 0, 0.75, -(d - t) / 2 - 0.16, PLANK);

  // The heap, and the board they rake it up with: the one thing here a round
  // stops in.
  const hx = w / 2 - 3.4;
  const hz = d / 2 - 2.8;
  b.cyl(1.1, 0.5, 3.4, 8, hx, kerb + 0.55, hz, SAILCLOTH);
  b.block({ w: 3.0, h: 1.1, d: 3.0, x: hx, y: kerb + 0.55, z: hz });
  b.box(0.12, 1.7, 0.7, hx - 2.2, 0.85, hz - 0.6, TIMBER, { z: -0.22 });
  return b;
}
