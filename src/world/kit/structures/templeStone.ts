/**
 * kit/structures/templeStone.ts — The temple ruin's stone: the sandstone it is
 * faced in and the moss on it, and the words it is laid, weathered and carved
 * in — a flat member on a face, courses, a stone's tone, hanging roots, moss, a
 * fallen block and a devata.
 * Invariants: VISUAL only — every collider the temple has is
 * `buildTempleRuin`'s own.
 */
import {
  Build,
  CREEPER,
  FIG_LEAF_LIT,
  MOSS_STONE,
  STONE,
} from "../core";

/**
 * Sandstone as the temple was faced in it: warmer than the village's `STONE`
 * and a step lighter than `MOSS_STONE`, so a terrace laid in the three reads as
 * one stone that has weathered three ways rather than as three materials.
 */
export const SANDSTONE = "#5d5a4e";
/**
 * Laterite, the rust-coloured rock a temple like this is FILLED with behind
 * its facing. It is only ever seen where the sandstone has fallen away, and
 * that is what it is for: a hole in the facing that shows a different rock in
 * coarse courses says the terrace was BUILT, where one that shows the joint
 * colour says it is a box with stones drawn on it. Ochre rather than the red
 * of `BRICK`, so nobody reads a colonial wall inside a Khmer terrace.
 */
export const LATERITE = "#5e4a37";
/**
 * Moss on the paving: `CREEPER`'s own green a step darker, because a level
 * surface takes the sky term in full and `CREEPER` laid flat came back as
 * lily pads — bright coins on grey stone.
 */
const TEMPLE_MOSS = "#374528";

/**
 * A member laid flat on a face. `alongX` faces run along X and look down ±Z;
 * `plane` is the face's own coordinate and `sgn` which way is out of it. `tilt`
 * leans it in the face's plane, rising toward +u — with the opposite rotation
 * sign on each axis for the same lean, which is `onFace`'s argument in
 * core.ts.
 */
export function flat(
  b: Build,
  alongX: boolean,
  plane: number,
  sgn: number,
  u: number,
  y: number,
  along: number,
  tall: number,
  thick: number,
  out: number,
  color: string,
  tilt = 0,
): void {
  const c = plane + sgn * out;
  if (alongX) b.box(along, tall, thick, u, y, c, color, tilt ? { z: tilt } : undefined);
  else b.box(thick, tall, along, c, y, u, color, tilt ? { x: -tilt } : undefined);
}

/**
 * Cuts `[u0, u1]` into stones of `min`..`max` length and hands each to `put`.
 * A remnant too short to be a stone is given to the last one, so no run ends
 * in a sliver.
 */
export function courses(
  u0: number,
  u1: number,
  min: number,
  max: number,
  rnd: () => number,
  put: (a: number, c: number) => void,
): void {
  for (let u = u0; u < u1 - 0.04; ) {
    let len = Math.min(u1 - u, min + rnd() * (max - min));
    if (u1 - u - len < min * 0.45) len = u1 - u;
    put(u, u + len);
    u += len;
  }
}

/** The stone one facing block is cut from: more of it green the damper it sits. */
export function templeTone(rnd: () => number, damp: number): string {
  const r = rnd();
  return r < damp ? MOSS_STONE : r < damp + (1 - damp) * 0.45 ? STONE : SANDSTONE;
}

/**
 * Creeper hanging off a lip: strands of irregular length, longest in the
 * middle of the run, leafed alternately down their length and stopping at
 * `floor`. The same drawing as the jungle ruin's `curtain`, on a face given as
 * a plane rather than a side.
 */
export function hang(
  b: Build,
  alongX: boolean,
  plane: number,
  sgn: number,
  u0: number,
  u1: number,
  yTop: number,
  reach: number,
  floor: number,
  out: number,
  rnd: () => number,
): void {
  if (u1 - u0 < 0.25) return;
  for (let u = u0 + rnd() * 0.08; u < u1; u += 0.13 + rnd() * 0.16) {
    const q = (u - u0) / (u1 - u0);
    const env = Math.sqrt(Math.max(0, Math.sin(Math.PI * q)));
    const bottom = Math.max(yTop - reach * env * (0.3 + 0.7 * rnd()), floor);
    if (yTop - bottom < 0.1) continue;
    flat(b, alongX, plane, sgn, u, (yTop + bottom) / 2, 0.022 + rnd() * 0.02, yTop - bottom, 0.03, out, CREEPER, (rnd() - 0.5) * 0.05);
    let side = rnd() < 0.5 ? -1 : 1;
    for (let y = yTop - 0.04 - rnd() * 0.06; y > bottom + 0.03; y -= 0.09 + rnd() * 0.09) {
      const lu = u + side * (0.03 + rnd() * 0.03);
      flat(b, alongX, plane, sgn, lu, y, 0.09 + rnd() * 0.05, 0.055 + rnd() * 0.035, 0.02, out + 0.015 + rnd() * 0.015, rnd() < 0.18 ? FIG_LEAF_LIT : CREEPER, side * (0.35 + rnd() * 0.5));
      side = -side;
    }
  }
}

/**
 * Moss lying on a level surface at `y`: a few low lobes overlapping, each
 * drawn out along its own bearing and a few millimetres off the last so no
 * two share a plane — which is what keeps its outline from being a coin.
 */
export function moss(b: Build, x: number, y: number, z: number, r: number, rnd: () => number): void {
  const n = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const o = i === 0 ? 0 : r * (0.35 + rnd() * 0.45);
    const dia = r * (i === 0 ? 1.2 : 0.6 + rnd() * 0.5);
    const lobe = b.cyl(0.016, dia, dia * 1.05, 6, x + Math.cos(a) * o, y + 0.003 + i * 0.003, z + Math.sin(a) * o, TEMPLE_MOSS, { y: rnd() * Math.PI });
    lobe.scaling.x = 1.4 + rnd() * 0.8;
  }
}

/** A fallen block lying at ground height `gy`: bedded a little, never standing. */
export function fallen(b: Build, x: number, gy: number, z: number, s: number, rnd: () => number, color: string): void {
  const w = s * (0.55 + rnd() * 0.4);
  const h = Math.min(0.3, s * (0.28 + rnd() * 0.14));
  const d = s * (0.35 + rnd() * 0.25);
  const pitch = (rnd() - 0.5) * 0.25;
  b.box(w, h, d, x, gy + h / 2 - 0.03, z, color, { x: pitch, y: rnd() * Math.PI, z: (rnd() - 0.5) * 0.25 });
}

/**
 * A devata — a temple dancer carved in low relief — handed to `f` a part at a
 * time, in the face's own (u, up) from her feet. Every part is a slab a few
 * centimetres proud, so what draws her is the ink finding each step, the only
 * fidelity a cel band can carry. `whole` false has lost her head, which is how
 * most of them are found.
 */
export function devata(
  f: (du: number, dy: number, along: number, tall: number, tilt?: number) => void,
  whole: boolean,
): void {
  f(0, 0.025, 0.28, 0.05); // the lotus she stands on
  f(0, 0.1, 0.27, 0.1); // the hem, flared
  f(0, 0.33, 0.21, 0.38); // the skirt
  f(0, 0.55, 0.23, 0.06); // the sash
  f(0, 0.72, 0.15, 0.28); // the body
  for (const s of [-1, 1]) f(s * 0.11, 0.66, 0.045, 0.28, s * 0.3); // arms
  if (whole) {
    f(0, 0.92, 0.1, 0.12); // head
    f(0, 1.03, 0.06, 0.1); // the tiara's spire
    for (const s of [-1, 1]) f(s * 0.06, 1.08, 0.05, 0.1, s * -0.5); // its flames
  }
}
