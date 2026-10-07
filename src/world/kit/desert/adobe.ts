/**
 * kit/desert/adobe.ts — buildAdobeHouse: the courtyard house — mud-brick
 * walls, a flat walked roof behind a parapet and a stair in its own lane;
 * nine buildings in ten. Part of the desert-town set: follows the contract in
 * kit/core.ts and the set's rules in `./index.ts`. Invariants: colliders in
 * the set's order (plinth, flights and landings, slabs, walls, roof,
 * parapet), a ruin's unreachable roof after everything walked. Never imports
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
  ROOF_MUD,
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
  clothHash,
  drape,
  parapet,
  parapetOpenX,
  windowRow,
} from "./shared";

/**
 * The courtyard house: mud-brick walls, a flat WALKED roof with a parapet, and
 * a stair in its own lane. The workhorse of the town, and the reason this set
 * exists.
 *
 * ## What it is FOR
 *
 * A second storey of ground. A terrace of these is a roofscape a squad moves
 * along, a parapet is chest cover the whole way, and the alley below is a
 * different fight three metres down. Nothing else in the kit gives a map that,
 * and it is what a town of these is worth over a town of `cottage`.
 *
 * ## Parameters, and which of them a layout has to think about
 *
 * - `width` / `depth` — the footprint. **`depth` is the one that can be wrong**:
 *   a house with `rampSide` needs `LANDING` plus a flight's run inside its own
 *   walls, which is 12.7 m at one storey and no less at two (the flights are
 *   the same rise). `assertClimbable` throws below it in a DEV build, so the
 *   town's stair houses are all 13 m and deeper.
 * - `floors` — 1 or 2. Two puts a second flight in the same lane running the
 *   other way; see the set's header.
 * - `rampSide` — which Z end the lowest flight's FOOT is at, and its presence
 *   is what gives the house roof access at all. A house without one still has
 *   its roof drawn and still stops a round on it; what it does not have is a
 *   walked surface anything can reach.
 * - `enterable` — a doorway punched in the -Z wall, and the ground floor left
 *   hollow. The roof slab IS the ceiling, so an enterable house is one room
 *   with `STOREY` of headroom.
 * - `ruined` — the +X wall down to a stub, the roof broken back to a little
 *   over half, and the rubble that came out of both. A ruin never gets a stair:
 *   its roof is a shelf, not a floor.
 * - `tint` — a limewashed house among the brick ones. Nothing else reads it.
 */
export function buildAdobeHouse(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "adobe");
  const w = p.width ?? 10;
  const d = p.depth ?? 9;
  const floors = Math.max(1, Math.min(2, p.floors ?? 1));
  const ruined = p.ruined === true;
  const climbs = p.rampSide !== undefined && !ruined;
  const ys = levels(floors, STOREY);
  const roofY = ys[floors];
  const wallTop = roofY - SLAB;
  const skin = p.tint ?? MUDBRICK;
  const { plateW, plateX } = laneGeom(w);

  if (climbs) assertClimbable("adobeHouse", d, ys[1] - ys[0]);

  // 1 — the plinth. Under `stepHeight`, so it merges with the ground in the nav
  // grid rather than spending a slot, and a body steps onto it.
  b.box(w + 0.5, PLINTH, d + 0.5, 0, PLINTH / 2, 0, MUDBRICK_DARK);
  b.block({ w: w + 0.5, h: PLINTH, d: d + 0.5, x: 0, y: PLINTH / 2, z: 0 });

  // 2 — the flights, and 3 — the intermediate slabs. Both before the walls and
  // before the roof: see the set's collider order.
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

  // 4 — the walls. The -Z one carries the door; the +X one is the wall a ruin
  // loses, because it is the one the lane is behind and so the one whose loss
  // opens the inside of the house to the street.
  const mid = wallTop / 2;
  if (p.enterable) {
    b.doorWall(w, wallTop, T, 0, mid, -(d - T) / 2, skin, 1.3, 2.2);
  } else {
    b.wall(w, wallTop, T, 0, mid, -(d - T) / 2, skin);
  }
  b.wall(w, wallTop, T, 0, mid, (d - T) / 2, skin);
  const sideD = d - 2 * T;
  b.wall(T, wallTop, sideD, -(w - T) / 2, mid, 0, skin);
  if (ruined) {
    b.wall(T, 1.25, sideD * 0.62, (w - T) / 2, 0.625 + PLINTH, -sideD * 0.19, SCORCH);
  } else {
    b.wall(T, wallTop, sideD, (w - T) / 2, mid, 0, skin);
  }

  // The elevation: a lintel course, and windows on every storey.
  b.box(w + 0.3, 0.16, d + 0.3, 0, wallTop - 0.08, 0, MUDBRICK_DARK);
  const rows = ruined ? 1 : floors;
  for (let k = 0; k < rows; k++) {
    const y = PLINTH + k * (STOREY + SLAB) + 1.75;
    const across = Math.max(1, Math.round(w / 4.5));
    windowRow(b, w - 2.4, y, -(d / 2) + 0.02, false, across);
    windowRow(b, w - 2.4, y, d / 2 - 0.02, false, across);
    if (!ruined) {
      windowRow(b, sideD - 2.0, y, -(w / 2) + 0.02, true, Math.max(1, Math.round(d / 5)));
    }
  }
  if (p.enterable) {
    b.box(1.6, 0.22, 0.5, 0, 2.32 + PLINTH, -(d / 2) - 0.1, PALM_BEAM);
  }

  // 5 — the roof, and 6 — the parapet standing on it.
  if (ruined) {
    // Broken back to a little over half, with the joists that held the rest
    // sticking out over the gap. Emitted after every walked surface, because
    // this one is not: nothing climbs a ruin.
    const kept = roofW * 0.56;
    const kx = roofX - (roofW - kept) / 2;
    b.box(kept, SLAB, d - 2 * T, kx, roofY - SLAB / 2, 0, ROOF_MUD);
    b.block({ w: kept, h: SLAB, d: d - 2 * T, x: kx, y: roofY - SLAB / 2, z: 0 });
    for (let i = 0; i < 4; i++) {
      const z = -(d / 2) + 1.4 + (i / 3) * (d - 2.8);
      b.box(2.6, 0.16, 0.18, kx + kept / 2 + 1.1, roofY - 0.3, z, PALM_BEAM);
    }
    b.wall(2.2, 0.75, 1.9, w * 0.18, PLINTH + 0.37, -d * 0.16, MUDBRICK_DARK);
    b.wall(1.7, 0.6, 1.5, w * 0.3, PLINTH + 0.3, d * 0.22, MUDBRICK_DARK);
    return b;
  }
  b.box(roofW, SLAB, d, roofX, roofY - SLAB / 2, 0, ROOF_MUD);
  b.block({ w: roofW, h: SLAB, d, x: roofX, y: roofY - SLAB / 2, z: 0 });
  if (climbs) {
    // The lane's outer wall carries a parapet of its own; the roof's +X edge is
    // the shaft, and stays open.
    b.wall(PARAPET_T, PARAPET, d, (w - PARAPET_T) / 2, wallTop + PARAPET / 2, 0, skin);
    parapetOpenX(b, roofW, d, roofX, roofY, skin, MUDBRICK_DARK);
  } else {
    parapet(b, w, d, roofY, skin, MUDBRICK_DARK);
  }
  // A roof is where a house keeps its water. Visual: the parapet already stops
  // everything at this height, and a cistern is not cover worth a collider.
  b.cyl(0.9, 0.8, 0.8, 8, roofX + roofW * 0.28, roofY + 0.45, d * 0.3, ALLOY);

  // 7 — the washing, and it is the only thing on this house the wind reaches.
  //
  // Hung over the ±Z parapet, whose runs are the full width of the roof plate
  // in both parapet forms — so this needs no branch on `climbs` beyond the
  // plate it is already given. The top sits at `roofY + PARAPET`, which is the
  // UNDERSIDE of the coping: the cap oversails its wall by 0.08 on each face,
  // so the one edge that is fixed is the one edge nothing can see, from the
  // street below or from the roof next door. See `drape` and `CONFIG.wind`'s
  // `cloth` layer for why 0.08 is enough.
  //
  // A ruin gets none — it returned above, before the roof — which is right on
  // its own terms: the houses still being lived in are the ones with washing
  // on them, and on a map months into being fought over that is a thing worth
  // being able to read off a roofline at two hundred metres.
  const hung = clothHash(w, d, floors, p.enterable === true ? 1 : 0);
  if (hung > 0.42) {
    const sz: 1 | -1 = hung > 0.71 ? 1 : -1;
    const span = roofW - 2.4;
    const n = span > 5 && hung > 0.72 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const jitter = clothHash(hung, i);
      drape(
        b,
        0.62 + jitter * 0.46,
        0.8 + jitter * 0.32,
        roofX - span / 2 + t * span,
        roofY + PARAPET,
        (sz * d) / 2,
        sz,
        hung + i,
      );
    }
  }
  return b;
}
