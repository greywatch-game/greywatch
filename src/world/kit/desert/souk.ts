/**
 * kit/desert/souk.ts — buildSouk: the souk arcade, a colonnade with a walked
 * roof, running along Z because its stair does. Part of the desert-town set:
 * follows the contract in kit/core.ts and the set's rules in `./index.ts`.
 * Invariants: colliders in the set's order. Never imports another builder.
 */
import { Scene } from "@babylonjs/core";
import { CONFIG } from "../../../config";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import {
  Build,
  type BuildParams,
  type Structure,
} from "../core";
import {
  MUDBRICK,
  MUDBRICK_DARK,
  ROOF_MUD,
  PALM_BEAM,
  T,
  PLINTH,
  SLAB,
  STOREY,
  PARAPET,
  PARAPET_T,
  levels,
  laneGeom,
  assertClimbable,
  laneFlight,
  parapetOpenX,
} from "./shared";

/**
 * The souk arcade: a colonnade with a walked roof, running along Z.
 *
 * It runs along Z because the STAIR does — `Build.flight` climbs in Z, and a
 * market hall wide enough to hold a flight across its width would be a hall
 * rather than an arcade. The layout turns it.
 *
 * Open on both long sides at ground level, so the arcade is a covered street
 * you shoot along and across, with one of the best positions in the town over
 * it. The awnings between the piers are `translucentBox` — the one place on
 * this map the sun comes THROUGH something, which is most of what makes a
 * market read as a market.
 */
export function buildSouk(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "souk");
  const len = p.length ?? 30;
  const w = p.width ?? 11;
  const ys = levels(1, STOREY);
  const roofY = ys[1];
  const { plateW, plateX } = laneGeom(w);
  assertClimbable("souk", len, roofY - ys[0]);

  b.box(w + 0.6, PLINTH, len + 0.6, 0, PLINTH / 2, 0, MUDBRICK_DARK);
  b.block({ w: w + 0.6, h: PLINTH, d: len + 0.6, x: 0, y: PLINTH / 2, z: 0 });

  laneFlight(b, w, len, ys[0], roofY, (p.rampSide ?? -1) === 1 ? 1 : -1, PALM_BEAM);

  // The piers, in pairs down both long sides of the covered street — and the
  // BLIND WALL behind the +X row, which is the lane's outer face.
  //
  // The wall is not decoration and it is not optional: the lane is a stair well
  // with a landing at the head of it, and without a wall on its outer edge the
  // parapet below would stand on nothing at all and the landing would be a
  // shelf in mid-air. It is also what an arcade built against a street IS —
  // open on one side, blind on the other — which is why the awnings are all on
  // the -X face.
  const bays = Math.max(3, Math.round(len / 4.2));
  const pierH = roofY - PLINTH - SLAB;
  for (let i = 0; i <= bays; i++) {
    const z = -len / 2 + (i / bays) * len;
    for (const sx of [-1, 1] as const) {
      const x = plateX + (sx * (plateW - 0.7)) / 2;
      b.wall(0.7, pierH, 0.7, x, PLINTH + pierH / 2, z, MUDBRICK);
    }
  }
  b.wall(T, pierH, len, (w - T) / 2, PLINTH + pierH / 2, 0, MUDBRICK);
  // The awnings, stretched off the open side between the piers.
  for (let i = 0; i < bays; i++) {
    const z = -len / 2 + ((i + 0.5) / bays) * len;
    b.translucentBox(
      2.4,
      0.08,
      len / bays - 0.5,
      plateX - plateW / 2 - 1.3,
      PLINTH + 2.35,
      z,
      i % 2 === 0 ? "#a8703f" : "#8d6a4a",
      CONFIG.graphics.translucency.awning,
      { z: 0.12 },
    );
  }
  // The lintel course the roof sits on, then the roof, then its parapet.
  for (const sx of [-1, 1] as const) {
    b.box(0.9, 0.45, len, plateX + (sx * (plateW - 0.7)) / 2, roofY - SLAB - 0.22, 0, PALM_BEAM);
  }
  b.box(plateW, SLAB, len, plateX, roofY - SLAB / 2, 0, ROOF_MUD);
  b.block({ w: plateW, h: SLAB, d: len, x: plateX, y: roofY - SLAB / 2, z: 0 });
  b.wall(PARAPET_T, PARAPET, len, (w - PARAPET_T) / 2, roofY - SLAB + PARAPET / 2, 0, MUDBRICK);
  b.box(PARAPET_T + 0.16, 0.14, len, (w - PARAPET_T) / 2, roofY - SLAB + PARAPET + 0.07, 0, MUDBRICK_DARK);
  parapetOpenX(b, plateW, len, plateX, roofY, MUDBRICK, MUDBRICK_DARK);
  return b;
}
