/**
 * kit/desert/mosque.ts — buildMosque and buildMinaret: one hall under a tiled
 * dome, which is the only chroma on the map, and the tapering shaft beside it
 * that nobody climbs. Part of the desert-town set: follows the contract in
 * kit/core.ts and the set's rules in `./index.ts`. Invariants: the minaret is
 * not climbable — that is the decision, not an omission. Never imports
 * another builder.
 */
import { Scene } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import {
  ALLOY,
  Build,
  type BuildParams,
  type Structure,
} from "../core";
import {
  MUDBRICK,
  MUDBRICK_DARK,
  WHITEWASH,
  ROOF_MUD,
  TILE_BLUE,
  PLINTH,
  SLAB,
} from "./shared";

/**
 * The mosque: one hall under a tiled dome, a portico of five bays, and the only
 * chroma on the map.
 *
 * Enterable, and enterable as ONE volume — no floors, no stair, nothing to
 * climb. That is deliberate against the shelled block: a fight over the mosque
 * is a fight through a portico and three doors into a room with four columns in
 * it, and the columns are the only cover in it; the block is a fight up a
 * stair. Two flags that play the same way are one flag.
 *
 * The dome is a stack of drums rather than a sphere for the reason everything
 * else here is a box: the cel shader bands light, and a smooth surface bands
 * into visible contour rings. Stepped drums band into what reads as courses of
 * tile, which is what a dome is made of anyway.
 */
export function buildMosque(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "mosque");
  const w = p.width ?? 26;
  const d = p.depth ?? 20;
  const h = p.height ?? 7.4;
  const t = 0.7;
  const base = PLINTH + 0.2;

  b.box(w + 2.4, base, d + 5.2, 0, base / 2, -1.4, WHITEWASH);
  b.block({ w: w + 2.4, h: base, d: d + 5.2, x: 0, y: base / 2, z: -1.4 });

  // The hall: a wide doorway on -Z and one in each side wall. `doorWall` runs
  // along X, so the side walls are laid out here rather than reusing it.
  b.doorWall(w, h, t, 0, base + h / 2, -(d - t) / 2, WHITEWASH, 3.2, 3.6);
  b.wall(w, h, t, 0, base + h / 2, (d - t) / 2, WHITEWASH);
  for (const sx of [-1, 1] as const) {
    const x = (sx * (w - t)) / 2;
    const run = (d - 2 * t - 2.2) / 2;
    for (const sz of [-1, 1] as const) {
      b.wall(t, h, run, x, base + h / 2, (sz * (run + 2.2)) / 2, WHITEWASH);
    }
    b.wall(t, h - 2.6, 2.2, x, base + 2.6 + (h - 2.6) / 2, 0, WHITEWASH);
  }
  // The four columns: the only cover in the hall, and thick enough that
  // `NavGrid` can represent them.
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      b.wall(0.8, h - 0.4, 0.8, sx * w * 0.24, base + (h - 0.4) / 2, sz * d * 0.2, WHITEWASH);
    }
  }
  // The roof. Walked in the sense that a round stops on it and nothing else —
  // there is no way up, which is the point of the minaret standing beside it.
  b.box(w + 0.8, SLAB, d + 0.8, 0, base + h + SLAB / 2, 0, ROOF_MUD);
  b.block({ w: w + 0.8, h: SLAB, d: d + 0.8, x: 0, y: base + h + SLAB / 2, z: 0 });

  const domeY = base + h + SLAB;
  const drum = Math.min(w, d) * 0.42;
  b.cyl(1.9, drum, drum + 0.5, 12, 0, domeY + 0.95, 0, WHITEWASH);
  const shells: [number, number, number][] = [
    [1.7, drum * 0.98, drum],
    [1.5, drum * 0.84, drum * 0.98],
    [1.2, drum * 0.6, drum * 0.84],
    [0.8, drum * 0.24, drum * 0.6],
  ];
  let dy = domeY + 1.9;
  for (const [sh, top, bottom] of shells) {
    b.cyl(sh, top, bottom, 12, 0, dy + sh / 2, 0, TILE_BLUE);
    dy += sh;
  }
  b.cyl(1.1, 0.1, 0.42, 8, 0, dy + 0.55, 0, ALLOY);
  b.block({ w: drum, h: 6.5, d: drum, x: 0, y: domeY + 3.25, z: 0 });

  // The portico: six piers carrying a flat canopy across the entrance.
  const pz = -(d / 2) - 3.0;
  for (let i = 0; i <= 5; i++) {
    const x = -w / 2 + (i / 5) * w;
    b.wall(0.8, h - 2.2, 0.8, x, base + (h - 2.2) / 2, pz, WHITEWASH);
  }
  b.box(w + 1.6, 0.55, 3.4, 0, base + h - 1.9, pz + 0.4, WHITEWASH);
  b.block({ w: w + 1.6, h: 0.55, d: 3.4, x: 0, y: base + h - 1.9, z: pz + 0.4 });
  b.box(w + 1.9, 0.3, 3.8, 0, base + h - 1.5, pz + 0.4, MUDBRICK_DARK);
  return b;
}

/**
 * The minaret: a tapering octagonal shaft, a balcony, a tiled cap.
 *
 * **Not climbable, and that is the decision rather than an omission.** A tower
 * a player can get to the top of, on a map with a 560 m view, is a position
 * that sees every flag — and there is no counter to it, because there is only
 * one way up. What it is instead is the LANDMARK: the tallest thing in the
 * town, visible from every quarter, the thing a player orients on before they
 * have learned the streets. It costs three collider boxes to be that.
 */
export function buildMinaret(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "minaret");
  const h = p.height ?? 26;
  const base = 4.2;

  b.box(base + 1.2, 1.2, base + 1.2, 0, 0.6, 0, MUDBRICK_DARK);
  b.block({ w: base + 1.2, h: 1.2, d: base + 1.2, x: 0, y: 0.6, z: 0 });

  const lower = h * 0.62;
  b.cyl(lower, base * 0.82, base, 8, 0, 1.2 + lower / 2, 0, WHITEWASH);
  b.block({ w: base, h: lower, d: base, x: 0, y: 1.2 + lower / 2, z: 0 });
  // The banding a brick minaret is built in — three courses of the darker
  // brick, which is what gives sixteen metres of shaft any scale at all from
  // four hundred metres away.
  for (let i = 1; i <= 3; i++) {
    b.cyl(0.5, base * 0.94, base * 0.94, 8, 0, 1.2 + (i / 4) * lower, 0, MUDBRICK);
  }
  const bal = 1.2 + lower;
  b.cyl(0.42, base * 1.85, base * 1.5, 8, 0, bal + 0.21, 0, MUDBRICK_DARK);
  b.cyl(1.05, base * 1.7, base * 1.7, 8, 0, bal + 0.95, 0, WHITEWASH);
  const upper = h - lower - 2.7;
  b.cyl(upper, base * 0.5, base * 0.68, 8, 0, bal + 1.5 + upper / 2, 0, WHITEWASH);
  b.block({
    w: base * 0.68,
    h: upper + 1.5,
    d: base * 0.68,
    x: 0,
    y: bal + (upper + 1.5) / 2,
    z: 0,
  });
  b.cyl(2.0, 0.12, base * 0.66, 8, 0, bal + 1.5 + upper + 1.0, 0, TILE_BLUE);
  b.cyl(0.9, 0.06, 0.22, 6, 0, bal + 1.5 + upper + 2.4, 0, ALLOY);
  return b;
}
