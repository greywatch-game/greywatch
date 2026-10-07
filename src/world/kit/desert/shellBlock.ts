/**
 * kit/desert/shellBlock.ts — buildShellBlock: the shelled reinforced-concrete
 * apartment slab, three walked floors with an open window band on each and
 * its top corner taken off — and `STOREY_RC`, the concrete frame's storey,
 * which nothing else uses. Part of the desert-town set: follows the contract
 * in kit/core.ts and the set's rules in `./index.ts`. Invariants: colliders
 * in the set's order. Never imports another builder.
 */
import { Scene } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import {
  Build,
  CONCRETE,
  DARK_CONCRETE,
  IRON,
  type BuildParams,
  type Structure,
} from "../core";
import {
  SCORCH,
  T,
  PLINTH,
  SLAB,
  PARAPET,
  PARAPET_T,
  levels,
  laneGeom,
  assertClimbable,
  laneFlight,
} from "./shared";

/** Storey height for a reinforced-concrete frame. */
const STOREY_RC = 3.2;

/**
 * The shelled block: a reinforced-concrete apartment slab with its top corner
 * taken off, three walked floors, and an open window band on every one of them.
 *
 * ## What it is FOR, against the house next to it
 *
 * The house is a roof; this is a BUILDING you fight inside. Three plates, a
 * stair shaft joining them, no glass anywhere and a chest-high spandrel under
 * every opening — so every floor shoots every street around it and is shot back
 * at from the floors above and below. It is `buildOffice`'s shape with the
 * glazing taken out and one corner blown off, and it is deliberately the only
 * thing on this map carrying that much interior: the rest of the town is walls.
 *
 * **No glass at all, and that is a rule rather than a saving.**
 * `PaneSpec.breakable` is for glass with enterable space behind it, and a
 * shelled block is enterable space behind every opening on it — so every window
 * here would qualify, and a dozen buildings' worth would be hundreds of entries
 * in `GameMap.panes`, which is identity on the wire. A town this size gets to
 * have its breakable glazing somewhere it is worth naming; here the windows are
 * already gone, which is both cheaper and truer.
 *
 * ## The sheared corner, which is not decoration
 *
 * The top floor keeps a little over half its plate and a spur along one side;
 * the rest, and the spandrels that stood on it, are in a heap at the foot of
 * that corner. What it buys is a building whose top floor is a different SHAPE
 * from the two under it — an open edge with a two-storey drop off it, which is
 * a place worth holding and a place worth not standing on. A block shelled
 * uniformly is a block with three identical floors, which is the thing this
 * whole file is trying not to build.
 *
 * `depth` carries the stair exactly as the house's does, and at `STOREY_RC` the
 * flights are longer — 10.9 m of run, so 14 m is the least depth that works and
 * `assertClimbable` says so.
 */
export function buildShellBlock(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "shell");
  const w = p.width ?? 20;
  const d = p.depth ?? 15;
  const floors = Math.max(2, Math.min(4, p.floors ?? 3));
  const ys = levels(floors, STOREY_RC);
  const { plateW, plateX } = laneGeom(w);
  const plateD = d - 2 * T;
  /** What is left of the top plate after the shear. */
  const topW = plateW * 0.58;
  const topX = plateX - (plateW - topW) / 2;
  const SPANDREL = 0.95;
  assertClimbable("shellBlock", d, ys[1] - ys[0]);

  // 1 — the plinth.
  b.box(w + 0.8, PLINTH, d + 0.8, 0, PLINTH / 2, 0, DARK_CONCRETE);
  b.block({ w: w + 0.8, h: PLINTH, d: d + 0.8, x: 0, y: PLINTH / 2, z: 0 });

  // 2 — the flights, alternating in the one lane.
  const dir0: 1 | -1 = (p.rampSide ?? -1) === 1 ? 1 : -1;
  for (let k = 1; k <= floors; k++) {
    const dir: 1 | -1 = k % 2 === 1 ? dir0 : ((-dir0) as 1 | -1);
    laneFlight(b, w, d, ys[k - 1], ys[k], dir, DARK_CONCRETE);
  }

  // 3 — the slabs, the last of them sheared.
  for (let k = 1; k <= floors; k++) {
    const top = k === floors;
    const pw = top ? topW : plateW;
    const px = top ? topX : plateX;
    b.box(pw, SLAB, plateD, px, ys[k] - SLAB / 2, 0, CONCRETE);
    b.block({ w: pw, h: SLAB, d: plateD, x: px, y: ys[k] - SLAB / 2, z: 0 });
    if (top) {
      // The spur left on the -Z side of the break, so the shear runs across the
      // floor at an angle rather than cutting it straight in two.
      const rw = plateW - topW;
      b.box(rw, SLAB, plateD * 0.46, px + topW / 2 + rw / 2, ys[k] - SLAB / 2, -plateD * 0.27, CONCRETE);
      b.block({
        w: rw,
        h: SLAB,
        d: plateD * 0.46,
        x: px + topW / 2 + rw / 2,
        y: ys[k] - SLAB / 2,
        z: -plateD * 0.27,
      });
    }
  }

  // 4 — the frame. The ground floor is enclosed with two doorways and every
  // floor above it is a spandrel under an open band, which is the gradient this
  // building is: a dark room to get into, a gallery to hold.
  for (let k = 0; k < floors; k++) {
    const y = ys[k];
    const shear = k === floors - 1;
    const spanW = shear ? topW : w;
    const spanX = shear ? topX : 0;
    if (k === 0) {
      b.doorWall(w, STOREY_RC, T, 0, y + STOREY_RC / 2, -(d - T) / 2, CONCRETE, 1.8, 2.4);
      b.doorWall(w, STOREY_RC, T, 0, y + STOREY_RC / 2, (d - T) / 2, CONCRETE, 1.8, 2.4);
      for (const sx of [-1, 1] as const) {
        b.wall(T, STOREY_RC, plateD, (sx * (w - T)) / 2, y + STOREY_RC / 2, 0, CONCRETE);
      }
      continue;
    }
    for (const sz of [-1, 1] as const) {
      const z = (sz * (d - T)) / 2;
      b.wall(spanW, SPANDREL, T, spanX, y + SPANDREL / 2, z, CONCRETE);
      // The lintel band over the opening — what the floor above stands on.
      b.wall(spanW, 0.42, T, spanX, y + STOREY_RC - 0.21, z, DARK_CONCRETE);
    }
    b.wall(T, SPANDREL, plateD, -(w - T) / 2, y + SPANDREL / 2, 0, CONCRETE);
    b.wall(T, 0.42, plateD, -(w - T) / 2, y + STOREY_RC - 0.21, 0, DARK_CONCRETE);
    if (!shear) {
      b.wall(T, SPANDREL, plateD, (w - T) / 2, y + SPANDREL / 2, 0, CONCRETE);
      b.wall(T, 0.42, plateD, (w - T) / 2, y + STOREY_RC - 0.21, 0, DARK_CONCRETE);
    }
    // The piers between the bays: the frame the spandrels hang off, and the
    // only thing standing at the corners of an open floor.
    const bays = Math.max(2, Math.round(spanW / 5.0));
    for (let i = 0; i <= bays; i++) {
      const x = spanX - spanW / 2 + (i / bays) * spanW;
      for (const sz of [-1, 1] as const) {
        b.box(0.44, STOREY_RC, 0.5, x, y + STOREY_RC / 2, (sz * (d - T)) / 2, DARK_CONCRETE);
      }
    }
  }

  // 5 — what is left of the roof parapet, the scorch over the shear, and the
  // heap the corner came down in. All of it after every walked surface.
  const roofY = ys[floors];
  for (const sz of [-1, 1] as const) {
    b.wall(topW, PARAPET, PARAPET_T, topX, roofY + PARAPET / 2, (sz * (d - PARAPET_T)) / 2, CONCRETE);
  }
  b.wall(PARAPET_T, PARAPET, plateD, topX - (topW - PARAPET_T) / 2, roofY + PARAPET / 2, 0, CONCRETE);
  b.box(w * 0.26, 0.06, d * 0.66, w * 0.29, roofY - 0.1, 0, SCORCH);
  b.wall(3.6, 1.15, 3.0, w * 0.3, PLINTH + 0.575, d * 0.24, DARK_CONCRETE);
  b.wall(2.6, 0.8, 2.4, w * 0.36, PLINTH + 0.4, -d * 0.1, CONCRETE);
  for (let i = 0; i < 5; i++) {
    b.strut(0.08, 1.5, 0.08, w * 0.3 + (i - 2) * 0.5, PLINTH + 1.6, d * 0.24 + (i % 2) * 0.4, IRON);
  }
  return b;
}
