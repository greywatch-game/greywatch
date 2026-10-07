/**
 * kit/desert/granary.ts — buildGranary: three or four tapering mud silos on a
 * shared plinth, coiled by hand and none of them the same — solid mud
 * standing in an alley of walls. Part of the desert-town set: follows the
 * contract in kit/core.ts and the set's rules in `./index.ts`. Invariants:
 * variation comes from the params, never `Math.random()`. Never imports
 * another builder.
 */
import { Scene } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import {
  Build,
  type BuildParams,
  type Structure,
} from "../core";
import {
  MUDBRICK,
  MUDBRICK_DARK,
  WINDOW_VOID,
  PALM_BEAM,
  PLINTH,
  clothHash,
} from "./shared";

/**
 * The granary: three or four tapering mud silos on a shared plinth, coiled by
 * hand and none of them the same.
 *
 * ## What it is FOR
 *
 * It is the smallest thing in this set and the only one that is not a
 * building: nothing goes in it, nothing stands on it, and it is eight metres
 * across. What it does is stand in an ALLEY. The old town is 30 m plots on a
 * 7 m pitch, and what makes it a maze is that you cannot see OVER a compound
 * wall — but you can see along an alley, the whole length of one, so a quarter
 * of nothing but walls is a quarter of long straight looks at knee-to-eye
 * height. This is what a layout puts in one to break it: five metres of solid
 * mud in a footprint that still leaves room to walk past.
 *
 * It is also the only piece of this vernacular with no straight line in its
 * silhouette, which is worth something on a map made of boxes.
 *
 * ## No random numbers, and the variation is real anyway
 *
 * World-building code may not call `Math.random()` — the nav graph would differ
 * between page loads (`CLAUDE.md`) — and a structure builder has no seed of its
 * own. So every silo's height, taper, banding and cap is drawn from `clothHash`
 * over the params, which is this set's existing answer and the honest one: two
 * granaries with the same footprint ARE the same granary, and what separates
 * them on the ground is `rotY` and what is standing next to them.
 */
export function buildGranary(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "granary");
  const w = p.width ?? 8;
  const d = p.depth ?? 7;
  const tall = p.height ?? 5.2;
  const skin = p.tint ?? MUDBRICK;

  b.box(w, PLINTH, d, 0, PLINTH / 2, 0, MUDBRICK_DARK);
  b.block({ w, h: PLINTH, d, x: 0, y: PLINTH / 2, z: 0 });

  // Four positions on the plinth, the fourth dropped on about half of them,
  // which is what makes a row of these read as a store somebody kept adding to
  // rather than as a fitting placed four at a time.
  const spots: [number, number][] = [
    [-w * 0.24, -d * 0.2],
    [w * 0.22, -d * 0.22],
    [-w * 0.2, d * 0.24],
    [w * 0.25, d * 0.2],
  ];
  const n = clothHash(w, d, tall) > 0.45 ? 4 : 3;
  for (let i = 0; i < n; i++) {
    const [x, z] = spots[i];
    const r = clothHash(w, d, tall, i);
    const r2 = clothHash(tall, i, 11);
    const h = tall * (0.68 + r * 0.42);
    const bot = Math.min(w, d) * (0.3 + r2 * 0.09);
    const top = bot * (0.68 + r * 0.14);
    b.cyl(h, top, bot, 10, x, PLINTH + h / 2, z, skin);
    b.block({ w: bot * 0.82, h, d: bot * 0.82, x, y: PLINTH + h / 2, z });
    // The courses a mud silo is coiled in — the only thing giving a smooth
    // taper any scale, and `buildMinaret`'s banding at a tenth the height.
    const bands = 2 + (i % 2);
    for (let k = 1; k <= bands; k++) {
      const f = k / (bands + 1);
      const dia = bot + 0.1 - f * (bot - top);
      b.cyl(0.13, dia, dia, 10, x, PLINTH + f * h, z, MUDBRICK_DARK);
    }
    // The cap: a domed lid with a lip, and the hatch under it.
    b.cyl(0.34, top * 0.72, top * 1.14, 10, x, PLINTH + h + 0.17, z, MUDBRICK_DARK);
    b.cyl(0.3, top * 0.2, top * 0.72, 10, x, PLINTH + h + 0.49, z, skin);
    b.box(0.36, 0.44, 0.1, x, PLINTH + h * 0.78, z - bot * 0.45, WINDOW_VOID);
    // The pegs the ladder is: split palm driven through the wall while it was
    // still wet. Visual only — an 11 cm peg is a shape `NavGrid` cannot hold,
    // and three rays a silo is a cost nobody wants (see `Build.guard`).
    for (let k = 0; k < 3; k++) {
      b.box(
        0.62,
        0.11,
        0.11,
        x - bot * 0.42,
        PLINTH + 0.9 + (k * (h - 1.4)) / 2,
        z + (k % 2 ? 0.16 : -0.16),
        PALM_BEAM,
      );
    }
  }
  return b;
}
