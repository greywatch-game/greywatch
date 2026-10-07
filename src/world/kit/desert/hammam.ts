/**
 * kit/desert/hammam.ts — buildHammam: the bathhouse, and the one roof in the
 * town you pick your way across rather than run. Part of the desert-town set:
 * follows the contract in kit/core.ts and the set's rules in `./index.ts`.
 * Invariants: colliders in the set's order — the deck, its parapet, then the
 * domes standing on it. Never imports another builder.
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
  WINDOW_VOID,
  PALM_BEAM,
  SCORCH,
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
  parapet,
  parapetOpenX,
} from "./shared";

/**
 * The hammam: a bathhouse, and the one roof in this town you cannot run across.
 *
 * ## What it is FOR
 *
 * `kit/desert/` exists because a flat roof is a second storey of ground, and
 * a few hundred of them is a second surface over the whole map. This is the
 * building that argues with that. Its roof is a walked deck with a cluster of
 * DOMES standing on it — one big, four small, every one a collider — so the
 * terrace is somewhere you take cover and pick your way through rather than a
 * lane you sprint down. A roofscape that is uniformly crossable is a second
 * flat map, and one obstacle on it is worth more than another parapet.
 *
 * Underneath, it is the only single-room INTERIOR in the kit that is not a
 * house: one hot room with two columns in it, a door on -Z, and no window below
 * head height anywhere — which is what a bathhouse is, and also what makes it
 * the darkest place on a map lit from almost directly overhead.
 *
 * ## The domes
 *
 * Stacked drums, `buildMosque`'s construction and its argument: the cel shader
 * bands light, so a smooth hemisphere bands into visible contour rings and a
 * stack of short cylinders bands into what reads as courses. The oculus on each
 * is `ALLOY` and NOT `TILE_BLUE` — the blue is the mosque's dome and the one
 * saturated thing on the map, and a bathhouse borrowing it would spend the
 * landmark. See the palette in `./shared.ts`.
 *
 * `depth` carries the stair lane and its 12.7 m floor exactly as the house's
 * does. A hammam with no `rampSide` still gets its domes; what it does not get
 * is anything able to stand between them.
 */
export function buildHammam(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "hammam");
  const w = p.width ?? 18;
  const d = p.depth ?? 14;
  const skin = p.tint ?? WHITEWASH;
  const climbs = p.rampSide !== undefined;
  const ys = levels(1, STOREY);
  const roofY = ys[1];
  const wallTop = roofY - SLAB;
  const { plateW, plateX } = laneGeom(w);
  const roofW = climbs ? plateW : w;
  const roofX = climbs ? plateX : 0;
  const sideD = d - 2 * T;

  if (climbs) assertClimbable("hammam", d, ys[1] - ys[0]);

  b.box(w + 0.7, PLINTH, d + 0.7, 0, PLINTH / 2, 0, MUDBRICK_DARK);
  b.block({ w: w + 0.7, h: PLINTH, d: d + 0.7, x: 0, y: PLINTH / 2, z: 0 });

  if (climbs) {
    laneFlight(b, w, d, ys[0], ys[1], (p.rampSide ?? -1) === 1 ? 1 : -1, PALM_BEAM);
  }

  // The walls. The doorway on -Z is the only opening below head height on the
  // whole building.
  const mid = wallTop / 2;
  b.doorWall(w, wallTop, T, 0, mid, -(d - T) / 2, skin, 1.5, 2.2);
  b.wall(w, wallTop, T, 0, mid, (d - T) / 2, skin);
  for (const sx of [-1, 1] as const) {
    b.wall(T, wallTop, sideD, (sx * (w - T)) / 2, mid, 0, skin);
  }
  // The two columns in the hot room: the only cover inside, and thick enough
  // for `NavGrid` to represent — the mosque's rule, one building over.
  for (const sx of [-1, 1] as const) {
    b.wall(0.8, wallTop - 0.3, 0.8, sx * w * 0.22, PLINTH + (wallTop - 0.3) / 2, 0, skin);
  }
  // The vent slots high on the long walls, and the beam over the door.
  for (const sz of [-1, 1] as const) {
    const n = Math.max(3, Math.round(w / 3.4));
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + 1.4 + (i / (n - 1)) * (w - 2.8);
      b.box(0.42, 0.5, 0.1, x, wallTop - 0.78, (sz * d) / 2 + sz * 0.02, WINDOW_VOID);
    }
  }
  b.box(2.6, 0.24, 0.7, 0, 2.36 + PLINTH, -(d / 2) - 0.2, PALM_BEAM);
  b.box(w + 0.34, 0.16, d + 0.34, 0, wallTop - 0.08, 0, MUDBRICK_DARK);

  // The deck, then its parapet, then the domes standing on it — the set's
  // order, and the domes are the parapet's own case: cover, emitted last.
  b.box(roofW, SLAB, d, roofX, roofY - SLAB / 2, 0, ROOF_MUD);
  b.block({ w: roofW, h: SLAB, d, x: roofX, y: roofY - SLAB / 2, z: 0 });
  if (climbs) {
    b.wall(PARAPET_T, PARAPET, d, (w - PARAPET_T) / 2, wallTop + PARAPET / 2, 0, skin);
    parapetOpenX(b, roofW, d, roofX, roofY, skin, MUDBRICK_DARK);
  } else {
    parapet(b, w, d, roofY, skin, MUDBRICK_DARK);
  }

  /** One dome: a drum, three shells over it, and an alloy oculus on top. */
  const dome = (cx: number, cz: number, r: number): void => {
    const drumH = 0.55;
    b.cyl(drumH, r * 2, r * 2.1, 12, cx, roofY + drumH / 2, cz, MUDBRICK_DARK);
    let y = roofY + drumH;
    const shells: [number, number, number][] = [
      [r * 0.44, r * 1.88, r * 2],
      [r * 0.38, r * 1.42, r * 1.88],
      [r * 0.3, r * 0.5, r * 1.42],
    ];
    for (const [sh, top, bottom] of shells) {
      b.cyl(sh, top, bottom, 12, cx, y + sh / 2, cz, skin);
      y += sh;
    }
    b.cyl(0.34, 0.2, 0.44, 8, cx, y + 0.17, cz, ALLOY);
    b.block({ w: r * 1.9, h: y - roofY, d: r * 1.9, x: cx, y: (roofY + y) / 2, z: cz });
  };

  const big = Math.min(roofW, sideD) * 0.26;
  dome(roofX, 0, big);
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      dome(roofX + sx * roofW * 0.3, sz * sideD * 0.3, big * 0.46);
    }
  }

  // The furnace stack on the -X elevation, scorched at the head. It is the one
  // part of a bathhouse anybody outside can read AS a bathhouse, and it is a
  // collider because it stands off the wall far enough to be cover at the
  // corner of the building.
  const stackH = roofY + 2.6;
  b.wall(1.15, stackH, 1.15, -(w / 2) - 0.5, stackH / 2, sideD * 0.26, MUDBRICK);
  b.box(1.3, 0.9, 1.3, -(w / 2) - 0.5, stackH - 0.45, sideD * 0.26, SCORCH);
  b.box(1.45, 0.18, 1.45, -(w / 2) - 0.5, stackH + 0.09, sideD * 0.26, MUDBRICK_DARK);
  return b;
}
