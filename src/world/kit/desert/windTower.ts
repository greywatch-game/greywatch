/**
 * kit/desert/windTower.ts — buildWindTower: a courtyard house with a barjeel
 * standing off its roof, the one piece of cover in the middle of a deck. Part
 * of the desert-town set: follows the contract in kit/core.ts and the set's
 * rules in `./index.ts`. Invariants: colliders in the set's order. Never
 * imports another builder.
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
  ROOF_MUD,
  WINDOW_VOID,
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
  parapet,
  parapetOpenX,
  windowRow,
} from "./shared";

/**
 * The wind-tower house: a courtyard house with a `barjeel` standing off its
 * roof — a hollow shaft, open on all four faces at the head, which is how a hot
 * town cooled itself before there was anything to plug in.
 *
 * ## What it is FOR, against the house it is a variant of
 *
 * **A town of flat roofs is a second surface with nothing on it.**
 * `buildAdobeHouse` gives a squad a terrace to move along and a parapet to
 * shoot over, and the moment two squads are both up there the fight is two
 * lines of men lying against opposite parapets with thirty metres of bare deck
 * between them. Every piece of cover in this kit — the parapet, the sandbags,
 * the T-wall — is on the GROUND or is a roof's own edge. This is the only thing
 * that stands in the MIDDLE of a deck: 2.8 m square of solid mud brick, six
 * metres of it, with four ways round.
 *
 * It is also the town's second landmark, and its distance from the minaret is
 * the design rather than a budget. The minaret is ONE object at 27 m that every
 * quarter can see, and what it gives a player is absolute position. These are
 * ten metres and they come in numbers, so what they mark is a NEIGHBOURHOOD:
 * you cannot navigate by one, and you can tell the old town's skyline from the
 * north town's by how many are in it.
 *
 * ## The head is open, and the collider stops under it
 *
 * A barjeel is a chimney run backwards — the shaft is solid for most of its
 * height and the top metre and a half is four corner posts under a cap, with
 * the cross-fin inside that decides which face the wind comes down. So the
 * collider is the SHAFT and stops where the openings start: a round fired at
 * the head goes between the posts, which is what a hollow head is, and it costs
 * one box rather than five to say so.
 *
 * Everything else is `buildAdobeHouse`'s, the stair lane included — see the
 * set's header — so `depth` carries the same 12.7 m floor and
 * `assertClimbable` says so in a DEV build. The tower stands on the roof PLATE
 * and never over the lane: a stair well with a wind tower on top of it is a
 * stair to a wall.
 */
export function buildWindTower(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "windtower");
  const w = p.width ?? 13;
  const d = p.depth ?? 14;
  const floors = Math.max(1, Math.min(2, p.floors ?? 1));
  const towerH = p.height ?? 6.4;
  const climbs = p.rampSide !== undefined;
  const ys = levels(floors, STOREY);
  const roofY = ys[floors];
  const wallTop = roofY - SLAB;
  const skin = p.tint ?? MUDBRICK;
  const { plateW, plateX } = laneGeom(w);

  if (climbs) assertClimbable("windTower", d, ys[1] - ys[0]);

  // 1 — the plinth.
  b.box(w + 0.5, PLINTH, d + 0.5, 0, PLINTH / 2, 0, MUDBRICK_DARK);
  b.block({ w: w + 0.5, h: PLINTH, d: d + 0.5, x: 0, y: PLINTH / 2, z: 0 });

  // 2 — the flights, 3 — the slabs. The set's order, and the same lane.
  const roofW = climbs ? plateW : w;
  const roofX = climbs ? plateX : 0;
  if (climbs) {
    const dir0: 1 | -1 = (p.rampSide ?? -1) === 1 ? 1 : -1;
    for (let k = 1; k <= floors; k++) {
      const dir: 1 | -1 = k % 2 === 1 ? dir0 : ((-dir0) as 1 | -1);
      laneFlight(b, w, d, ys[k - 1], ys[k], dir, PALM_BEAM);
    }
  }
  for (let k = 1; k < floors; k++) {
    b.box(roofW, SLAB, d - 2 * T, roofX, ys[k] - SLAB / 2, 0, PALM_BEAM);
    b.block({ w: roofW, h: SLAB, d: d - 2 * T, x: roofX, y: ys[k] - SLAB / 2, z: 0 });
  }

  // 4 — the walls.
  const mid = wallTop / 2;
  if (p.enterable) {
    b.doorWall(w, wallTop, T, 0, mid, -(d - T) / 2, skin, 1.4, 2.2);
  } else {
    b.wall(w, wallTop, T, 0, mid, -(d - T) / 2, skin);
  }
  b.wall(w, wallTop, T, 0, mid, (d - T) / 2, skin);
  const sideD = d - 2 * T;
  for (const sx of [-1, 1] as const) {
    b.wall(T, wallTop, sideD, (sx * (w - T)) / 2, mid, 0, skin);
  }
  b.box(w + 0.3, 0.16, d + 0.3, 0, wallTop - 0.08, 0, MUDBRICK_DARK);
  for (let k = 0; k < floors; k++) {
    const y = PLINTH + k * (STOREY + SLAB) + 1.75;
    const across = Math.max(1, Math.round(w / 4.5));
    windowRow(b, w - 2.4, y, -(d / 2) + 0.02, false, across);
    windowRow(b, w - 2.4, y, d / 2 - 0.02, false, across);
    windowRow(b, sideD - 2.0, y, -(w / 2) + 0.02, true, Math.max(1, Math.round(d / 5)));
  }
  if (p.enterable) b.box(1.7, 0.22, 0.5, 0, 2.32 + PLINTH, -(d / 2) - 0.1, PALM_BEAM);

  // 5 — the roof, 6 — the parapet.
  b.box(roofW, SLAB, d, roofX, roofY - SLAB / 2, 0, ROOF_MUD);
  b.block({ w: roofW, h: SLAB, d, x: roofX, y: roofY - SLAB / 2, z: 0 });
  if (climbs) {
    b.wall(PARAPET_T, PARAPET, d, (w - PARAPET_T) / 2, wallTop + PARAPET / 2, 0, skin);
    parapetOpenX(b, roofW, d, roofX, roofY, skin, MUDBRICK_DARK);
  } else {
    parapet(b, w, d, roofY, skin, MUDBRICK_DARK);
  }

  // 7 — the tower, last, because it is the one thing here standing ON a walked
  // surface rather than under one. Inboard of the deck's corner by its own
  // width, so a body can pass on every side of it: a tower flush to two
  // parapets is a corner filled in, and the cover is worth having precisely
  // because you can be on the wrong side of it.
  const side = Math.min(2.8, roofW * 0.32);
  const tx = roofX - roofW * 0.24;
  const tz = -d * 0.16;
  const shaft = towerH - 1.55;
  b.box(side + 0.34, 0.3, side + 0.34, tx, roofY + 0.15, tz, MUDBRICK_DARK);
  b.box(side, shaft, side, tx, roofY + 0.3 + shaft / 2, tz, skin);
  b.block({
    w: side + 0.34,
    h: shaft + 0.3,
    d: side + 0.34,
    x: tx,
    y: roofY + (shaft + 0.3) / 2,
    z: tz,
  });
  // The courses that give six metres of blank shaft a scale, and the two vents
  // low on it — the shaft is hollow the whole way down, and a barjeel with no
  // opening at the bottom is a chimney with no fire.
  for (let i = 1; i <= 2; i++) {
    b.box(side + 0.2, 0.14, side + 0.2, tx, roofY + 0.3 + (i / 3) * shaft, tz, MUDBRICK_DARK);
  }
  for (const sx of [-1, 1] as const) {
    b.box(0.06, 0.62, 0.5, tx + (sx * side) / 2, roofY + 1.05, tz, WINDOW_VOID);
  }
  // The head: four posts, the cross-fin between them, and the cap over the lot.
  const headY = roofY + 0.3 + shaft;
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      b.box(
        0.52,
        1.2,
        0.52,
        tx + (sx * (side - 0.52)) / 2,
        headY + 0.6,
        tz + (sz * (side - 0.52)) / 2,
        skin,
      );
    }
  }
  b.box(0.24, 1.05, side - 0.9, tx, headY + 0.55, tz, MUDBRICK_DARK);
  b.box(side - 0.9, 1.05, 0.24, tx, headY + 0.55, tz, MUDBRICK_DARK);
  b.box(side + 0.5, 0.26, side + 0.5, tx, headY + 1.33, tz, MUDBRICK_DARK);
  b.box(side + 0.16, 0.14, side + 0.16, tx, headY + 1.53, tz, skin);
  return b;
}
