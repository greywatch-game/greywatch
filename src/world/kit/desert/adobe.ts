/**
 * kit/desert/adobe.ts — buildAdobeHouse: the courtyard house of the river
 * towns — mud brick under mud render on a plinth, palm joists under a flat
 * walked roof behind a parapet, a stair in its own lane — nine buildings in
 * ten. Its hardware (door, window joinery, spouts, meter, and the tank, dish,
 * aerial and cooler on its roofline) is `./fittings.ts`'s, laid in a batch of
 * its own; the masonry round it is drawn here. Part of the desert-town set:
 * follows the contract in kit/core.ts and the set's rules in `./index.ts`.
 * Invariants: every collider byte for byte and in the set's order (plinth,
 * flights and landings, slabs, walls, roof, parapet; a ruin's unreachable
 * roof after everything walked, its rubble last), restated at the top;
 * variation is seeded off where it stands, never `Math.random()`. Never
 * imports another builder.
 */
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import { mulberry32 } from "../../rng";
import {
  IRON,
  Build,
  carve,
  hideBack,
  streetSeed,
  type BuildCtx,
  type BuildParams,
  type Side,
  type Structure,
} from "../core";
import {
  CLOTH,
  MUDBRICK,
  MUDBRICK_DARK,
  ROOF_MUD,
  PALM_BEAM,
  SANDBAG,
  SCORCH,
  WINDOW_VOID,
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
} from "./shared";
import { HIDE_DOWN, Lay, blob, fp, log, opp, pocks, spall, streak, type Bond } from "./lay";
import {
  DOOR,
  DOOR_W,
  SPOUT,
  TANK,
  WIN,
  WINDOW_H,
  WINDOW_W,
  fit,
  type Fitting,
  type FittingKind,
} from "./fittings";

/** A fitting's turn on each face: local -Z out of the wall. See `Fitting`. */
const YAW: Record<Side, number> = { "-z": 0, "+z": Math.PI, "-x": Math.PI / 2, "+x": -Math.PI / 2 };
/**
 * The bearing every dish in the town is turned to, in the world: they all
 * look at one satellite, and a roofline whose dishes agree reads as a town
 * rather than as scattered props.
 */
const DISH_AIM = 2.25;
/**
 * Sun-dried brick, which is what is under the render: bigger than the fired
 * brick `BRICK` lays — a course of 12 cm, a unit of 36 — so a scar shows
 * fewer, larger units, and costs a house half the boxes.
 */
const MUD_BOND: Bond = { ground: MUDBRICK_DARK, unit: MUDBRICK, course: 0.12, len: 0.36, pitch: 0.38 };
/** A box drawn by its top face alone: a mat on a floor. */
const TOP_ONLY = 0b111011;
/** The top of a thing whose top is another thing's to draw: a joist under a slab. */
const HIDE_UP = 1 << 2;

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
 * - `tint` — the render: a limewashed house among the mud ones, or one
 *   re-rendered darker. The reveals round its openings are a shade off it.
 *
 * ## What it is drawn as
 *
 * The common house of the Euphrates towns in the last century, as it was
 * lived in and then fought over. Mud brick under mud render on a plinth of
 * the same, the render lost back to the sun-dried courses in a scar or two
 * and pocked by small arms; palm-log joist ends through the front under a
 * string course, and the floor's between the storeys; a palm lintel over
 * every opening. Every house has a DOOR: an open doorway is one you can walk
 * through — its leaves folded back inside, or one torn off and lying on the
 * floor — and a house you cannot enter has one shut on its hasp, a sheet-
 * steel one, or a doorway filled with new brick. The windows are small and
 * high, a reveal returned in the render round each: grilled, shuttered, shut,
 * sandbagged into a firing slit or torn out, and over some the scorch of a
 * room that burned. The meter by the door with its cable up to the string
 * course. On the roof, spouts through the parapet's foot and the wash under
 * them; and the roofline a town like this is told by from a distance — a
 * galvanised tank on a stand over a corner, a dish aimed where every other
 * dish is aimed, an aerial strapped up the parapet, an evaporative cooler
 * hung on the face with its duct over the cap — and nothing on the deck,
 * which is ground a fight crosses. Inside an enterable house, palm joists under the ceiling, a mat,
 * bedding along the back wall, and every window's niche.
 *
 * ## The hardware is separable, and that is the design
 *
 * Four hundred and ninety of these stand on one map, so what is fitted to a
 * house is kept apart from what the house IS: every fitting is a `Fitting`
 * — a kind, a variant and a frame — gathered into one list and laid into a
 * `Lay` of its own, flushed before the masonry's. A fitting's drawing depends
 * on its kind and its variant alone (`./fittings.ts`'s invariant), so the
 * list is a set of instance transforms over a few dozen fixed drawings, and
 * the batch is a run of surfaces the masonry's never shares. Anything sized
 * off the house — a reveal, the cable's run, a streak's length, the joists
 * — is the masonry's.
 *
 * ## Seeded, and in `CONFORMS_TO_TERRAIN`
 *
 * Which door, which windows, which roof furniture, where the scars and pocks
 * fall and which way the dish looks are seeded off where the house stands
 * (`streetSeed` with its `BuildCtx`), and its plinth's face is carried down
 * to the ground where the ground falls away — which is what puts it in
 * `CONFORMS_TO_TERRAIN`. The washing still hangs off the params
 * (`clothHash`), as it always has.
 *
 * ## The colliders, which are unchanged
 *
 * The plinth, the flights and their landings (`laneFlight`, still called),
 * the slabs, the front wall round its door (`doorWall`'s arithmetic spelled
 * out), the back and side walls (a ruin's stub), the roof, the parapet
 * (`parapet`'s and `parapetOpenX`'s spelled out) — and a ruin's kept roof
 * and its two rubble mounds — restated below exactly as they were emitted.
 * Everything after that block is DRAWING and keeps to the three rules: on a
 * face (every fitting on a wall, the reveals, the joist ends, the scars), low
 * enough to step over (the threshold, the step, the mat and bedding, a
 * torn leaf, the rubble), overhead or standing on a collider (the
 * joists inside, 2.7 m over the floor; the tank's legs on the parapet's caps
 * and its body 2.4 m over the deck; the dish on a cap; the cooler's duct over
 * one). The side walls of a terrace stand half a metre from the next house's,
 * so nothing that projects more than a sill goes on a ±X face.
 */
export function buildAdobeHouse(
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(mats, "adobe");
  const w = p.width ?? 10;
  const d = p.depth ?? 9;
  const floors = Math.max(1, Math.min(2, p.floors ?? 1));
  const ruined = p.ruined === true;
  const enterable = p.enterable === true;
  const climbs = p.rampSide !== undefined && !ruined;
  const ys = levels(floors, STOREY);
  const roofY = ys[floors];
  const wallTop = roofY - SLAB;
  const skin = p.tint ?? MUDBRICK;
  const { plateW, plateX } = laneGeom(w);
  const roofW = climbs ? plateW : w;
  const roofX = climbs ? plateX : 0;
  const sideD = d - 2 * T;

  if (climbs) assertClimbable("adobeHouse", d, ys[1] - ys[0]);

  // --- the colliders, restated in their order ----------------------------------
  // 1 — the plinth. Under `stepHeight`, so it merges with the ground in the nav
  // grid rather than spending a slot, and a body steps onto it.
  b.block({ w: w + 0.5, h: PLINTH, d: d + 0.5, x: 0, y: PLINTH / 2, z: 0 });
  // 2 — the flights, and 3 — the intermediate slabs. Both before the walls and
  // before the roof: see the set's collider order.
  if (climbs) {
    const dir0: 1 | -1 = (p.rampSide ?? -1) === 1 ? 1 : -1;
    for (let k = 1; k <= floors; k++) {
      const dir: 1 | -1 = k % 2 === 1 ? dir0 : ((-dir0) as 1 | -1);
      laneFlight(b, w, d, ys[k - 1], ys[k], dir, PALM_BEAM);
    }
  }
  for (let k = 1; k < floors; k++) {
    b.block({ w: roofW, h: SLAB, d: d - 2 * T, x: roofX, y: ys[k] - SLAB / 2, z: 0 });
  }
  // 4 — the walls. The -Z one carries the door, as `doorWall` cut it; the +X
  // one is the wall a ruin loses, because the lane is behind it and its loss
  // opens the house to the street.
  const mid = wallTop / 2;
  const zF = -(d - T) / 2;
  const jamb = (w - DOOR_W) / 2;
  const off = DOOR_W / 2 + jamb / 2;
  const lintel = wallTop - 2.2;
  if (enterable) {
    if (jamb > 0.05) {
      b.block({ w: jamb, h: wallTop, d: T, x: 0 - off, y: mid, z: zF });
      b.block({ w: jamb, h: wallTop, d: T, x: 0 + off, y: mid, z: zF });
    }
    if (lintel > 0.05) b.block({ w: DOOR_W, h: lintel, d: T, x: 0, y: mid + wallTop / 2 - lintel / 2, z: zF });
  } else {
    b.block({ w, h: wallTop, d: T, x: 0, y: mid, z: zF });
  }
  b.block({ w, h: wallTop, d: T, x: 0, y: mid, z: (d - T) / 2 });
  b.block({ w: T, h: wallTop, d: sideD, x: -(w - T) / 2, y: mid, z: 0 });
  const stub = { w: T, h: 1.25, d: sideD * 0.62, x: (w - T) / 2, y: 0.625 + PLINTH, z: -sideD * 0.19 };
  if (ruined) b.block(stub);
  else b.block({ w: T, h: wallTop, d: sideD, x: (w - T) / 2, y: mid, z: 0 });
  // 5 — the roof, and 6 — the parapet standing on it; or a ruin's broken
  // roof, after every walked surface because nothing climbs to it, and the
  // rubble that came out of it last.
  const kept = roofW * 0.56;
  const kx = roofX - (roofW - kept) / 2;
  const runD = d - 2 * PARAPET_T;
  const rubble = [
    { w: 2.2, h: 0.75, d: 1.9, x: w * 0.18, y: PLINTH + 0.37, z: -d * 0.16 },
    { w: 1.7, h: 0.6, d: 1.5, x: w * 0.3, y: PLINTH + 0.3, z: d * 0.22 },
  ];
  if (ruined) {
    b.block({ w: kept, h: SLAB, d: d - 2 * T, x: kx, y: roofY - SLAB / 2, z: 0 });
    for (const r of rubble) b.block(r);
  } else {
    b.block({ w: roofW, h: SLAB, d, x: roofX, y: roofY - SLAB / 2, z: 0 });
    if (climbs) {
      b.block({ w: PARAPET_T, h: PARAPET, d, x: (w - PARAPET_T) / 2, y: wallTop + PARAPET / 2, z: 0 });
      for (const sz of [-1, 1] as const) {
        const z = (sz * (d - PARAPET_T)) / 2;
        b.block({ w: roofW, h: PARAPET, d: PARAPET_T, x: roofX, y: roofY + PARAPET / 2, z });
      }
      const x = roofX - (roofW - PARAPET_T) / 2;
      b.block({ w: PARAPET_T, h: PARAPET, d: runD, x, y: roofY + PARAPET / 2, z: 0 });
    } else {
      for (const sz of [-1, 1] as const) {
        const z = (sz * (d - PARAPET_T)) / 2;
        b.block({ w, h: PARAPET, d: PARAPET_T, x: 0, y: roofY + PARAPET / 2, z });
      }
      for (const sx of [-1, 1] as const) {
        const x = (sx * (w - PARAPET_T)) / 2;
        b.block({ w: PARAPET_T, h: PARAPET, d: runD, x, y: roofY + PARAPET / 2, z: 0 });
      }
    }
  }

  // --- the drawing -----------------------------------------------------------------
  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };
  const h: House = {
    w,
    d,
    floors,
    ruined,
    enterable,
    climbs,
    ys,
    roofY,
    wallTop,
    skin,
    trim: skin === MUDBRICK_DARK ? MUDBRICK : MUDBRICK_DARK,
    edge: roofX + roofW / 2,
    roofX,
    roofW,
    rnd: mulberry32(streetSeed(w, d, roofY, ctx)),
    fits: [],
    hung: ruined ? 0 : clothHash(w, d, floors, enterable ? 1 : 0),
  };
  const wins = windows(h);
  const lay = new Lay();
  for (const wn of wins) windowAt(lay, h, wn);
  door(lay, h);
  elevations(lay, h, wins, ground);
  if (!ruined) roofline(lay, h, wins, ctx?.rotY ?? 0);
  if (enterable) interior(lay, h, wins, kx + kept / 2);
  if (ruined) ruin(lay, h, stub, ground);

  // The hardware first, in a batch of its own; then the masonry laid on the
  // faces; then the masses they hide.
  const hw = new Lay();
  for (const f of h.fits) fit(hw, f);
  hw.flush(b);
  lay.flush(b);

  // 7 — the washing, and it is the only thing on this house the wind reaches.
  //
  // Hung over the ±Z parapet, whose runs are the full width of the roof plate
  // in both parapet forms. The top sits at `roofY + PARAPET`, which is the
  // UNDERSIDE of the coping: the cap oversails its wall by 0.08 on each face,
  // so the one edge that is fixed is the one edge nothing can see, from the
  // street below or from the roof next door. See `drape` and `CONFIG.wind`'s
  // `cloth` layer for why 0.08 is enough. A ruin gets none: the houses still
  // being lived in are the ones with washing on them.
  if (h.hung > 0.42) {
    const sz: 1 | -1 = h.hung > 0.71 ? 1 : -1;
    const span = roofW - 2.4;
    const n = span > 5 && h.hung > 0.72 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const jitter = clothHash(h.hung, i);
      drape(b, 0.62 + jitter * 0.46, 0.8 + jitter * 0.32, roofX - span / 2 + t * span, roofY + PARAPET, (sz * d) / 2, sz, h.hung + i);
    }
  }

  // --- the masses, after what is laid on them ------------------------------------
  b.box(w + 0.5, PLINTH, d + 0.5, 0, PLINTH / 2, 0, MUDBRICK_DARK);
  for (let k = 1; k < floors; k++) b.box(roofW, SLAB, d - 2 * T, roofX, ys[k] - SLAB / 2, 0, ROOF_MUD);
  if (enterable) {
    if (jamb > 0.05) {
      b.box(jamb, wallTop, T, 0 - off, mid, zF, skin);
      b.box(jamb, wallTop, T, 0 + off, mid, zF, skin);
    }
    if (lintel > 0.05) b.box(DOOR_W, lintel, T, 0, mid + wallTop / 2 - lintel / 2, zF, skin);
  } else {
    b.box(w, wallTop, T, 0, mid, zF, skin);
  }
  b.box(w, wallTop, T, 0, mid, (d - T) / 2, skin);
  b.box(T, wallTop, sideD, -(w - T) / 2, mid, 0, skin);
  if (ruined) b.box(stub.w, stub.h, stub.d, stub.x, stub.y, stub.z, SCORCH);
  else b.box(T, wallTop, sideD, (w - T) / 2, mid, 0, skin);
  // The string course at the wall head: a ring round the walls, never a plate
  // across the house, which would lid the stair shaft. A ruin's has lost its
  // +X run with the wall under it.
  const sc = T + 0.15;
  for (const sz of [-1, 1] as const) b.box(w + 0.3, 0.16, sc, 0, wallTop - 0.08, sz * (d / 2 + 0.15 - sc / 2), MUDBRICK_DARK);
  for (const sx of ruined ? ([-1] as const) : ([-1, 1] as const)) {
    b.box(sc, 0.16, d - 2 * T, sx * (w / 2 + 0.15 - sc / 2), wallTop - 0.08, 0, MUDBRICK_DARK);
  }
  if (ruined) {
    b.box(kept, SLAB, d - 2 * T, kx, roofY - SLAB / 2, 0, ROOF_MUD);
    // The joists that held the rest, sticking out over the gap.
    for (let i = 0; i < 4; i++) {
      const z = -(d / 2) + 1.4 + (i / 3) * (d - 2.8);
      b.box(2.6, 0.16, 0.18, kx + kept / 2 + 1.1, roofY - 0.3, z, PALM_BEAM);
    }
    for (const r of rubble) b.box(r.w, r.h, r.d, r.x, r.y, r.z, MUDBRICK_DARK);
    return b;
  }
  b.box(roofW, SLAB, d, roofX, roofY - SLAB / 2, 0, ROOF_MUD);
  const cap = 0.14;
  if (climbs) {
    b.box(PARAPET_T, PARAPET, d, (w - PARAPET_T) / 2, wallTop + PARAPET / 2, 0, skin);
    b.box(PARAPET_T + 0.16, cap, d + 0.16, (w - PARAPET_T) / 2, wallTop + PARAPET + cap / 2, 0, MUDBRICK_DARK);
    for (const sz of [-1, 1] as const) {
      const z = (sz * (d - PARAPET_T)) / 2;
      b.box(roofW, PARAPET, PARAPET_T, roofX, roofY + PARAPET / 2, z, skin);
      b.box(roofW + 0.16, cap, PARAPET_T + 0.16, roofX, roofY + PARAPET + cap / 2, z, MUDBRICK_DARK);
    }
    const x = roofX - (roofW - PARAPET_T) / 2;
    b.box(PARAPET_T, PARAPET, runD, x, roofY + PARAPET / 2, 0, skin);
    b.box(PARAPET_T + 0.16, cap, runD, x, roofY + PARAPET + cap / 2, 0, MUDBRICK_DARK);
  } else {
    for (const sz of [-1, 1] as const) {
      const z = (sz * (d - PARAPET_T)) / 2;
      b.box(w, PARAPET, PARAPET_T, 0, roofY + PARAPET / 2, z, skin);
      b.box(w + 0.16, cap, PARAPET_T + 0.16, 0, roofY + PARAPET + cap / 2, z, MUDBRICK_DARK);
    }
    for (const sx of [-1, 1] as const) {
      const x = (sx * (w - PARAPET_T)) / 2;
      b.box(PARAPET_T, PARAPET, runD, x, roofY + PARAPET / 2, 0, skin);
      b.box(PARAPET_T + 0.16, cap, runD, x, roofY + PARAPET + cap / 2, 0, MUDBRICK_DARK);
    }
  }
  return b;
}

/** What the drawing's parts are measured by. */
interface House {
  w: number;
  d: number;
  floors: number;
  ruined: boolean;
  enterable: boolean;
  climbs: boolean;
  ys: number[];
  roofY: number;
  wallTop: number;
  skin: string;
  /** The reveals' colour: a shade off the render, whichever way it can go. */
  trim: string;
  /** The deck's +X edge: the stair shaft's inner side when the house climbs. */
  edge: number;
  roofX: number;
  roofW: number;
  rnd: () => number;
  /** The hardware, gathered as it is placed and drawn in one batch. */
  fits: Fitting[];
  /** The washing's hash: over 0.42 it hangs, and over 0.71 on the back. */
  hung: number;
}

/** Fits a fitting on face `s` at `u` along it and `y` up it. */
function fitOn(h: House, kind: FittingKind, v: number, s: Side, plane: number, u: number, y: number): void {
  const [x, , z] = fp(s, plane, u, y, 0);
  h.fits.push({ kind, v, x, y, z, yaw: YAW[s] });
}

/** One window: its face, its centre along it, its sill, its storey. */
interface Win {
  s: Side;
  plane: number;
  u: number;
  sill: number;
  storey: number;
}

/** Whether a face is a street's: the ±X faces of a terrace stand half a metre from the next house. */
const street = (s: Side): boolean => s === "-z" || s === "+z";

/**
 * Where every window is: high in the wall, a storey apart. The front's ground
 * floor has one either side of the door; the front's upper floors, the back
 * and the -X end are rows, as the house always had them; the +X end is the
 * stair's. A ruin keeps its ground floor's front and back.
 */
function windows(h: House): Win[] {
  const { w, d, ys, floors, ruined } = h;
  const out: Win[] = [];
  const across = Math.max(1, Math.round(w / 4.5));
  const rows = ruined ? 1 : floors;
  const row = (s: Side, plane: number, span: number, n: number, sill: number, storey: number): void => {
    for (let i = 0; i < n; i++) out.push({ s, plane, u: -span / 2 + ((i + 0.5) / n) * span, sill, storey });
  };
  for (let k = 0; k < rows; k++) {
    const sill = ys[k] + 1.2;
    if (k === 0) {
      const u = Math.min(w * 0.3, w / 2 - 1.3);
      for (const e of [-1, 1]) out.push({ s: "-z", plane: d / 2, u: e * u, sill, storey: k });
    } else {
      row("-z", d / 2, w - 2.4, across, sill, k);
    }
    row("+z", d / 2, w - 2.4, across, sill, k);
    if (!ruined) row("-x", w / 2, d - 2 * T - 2.0, Math.max(1, Math.round(d / 5)), sill, k);
  }
  return out;
}

/**
 * One window: the reveal returned round it in the render and its sill, both
 * the house's; and its joinery, which is a fitting — grilled, shuttered, shut,
 * sandbagged or torn out, by its storey and its face — with now and then the
 * scorch of a room that burned over its lintel.
 */
function windowAt(lay: Lay, h: House, wn: Win): void {
  const { s, plane, u, sill, storey } = wn;
  const { rnd, trim } = h;
  const back = hideBack(s);
  const r = rnd();
  let v: number;
  if (h.ruined) v = r < 0.6 ? WIN.broken : r < 0.8 ? WIN.shut : WIN.grille;
  else if (storey === 0) v = r < 0.45 ? WIN.grille : r < 0.7 ? WIN.shut : r < 0.86 && street(s) ? WIN.sandbagged : WIN.broken;
  else v = r < 0.38 ? WIN.open : r < 0.72 ? WIN.shut : r < 0.86 ? WIN.grille : WIN.broken;
  fitOn(h, "window", v, s, plane, u, sill);
  const half = WINDOW_W / 2;
  for (const e of [-1, 1]) lay.sb.onFace(s, plane, u + e * (half + 0.05), sill + (WINDOW_H + 0.1) / 2, 0.1, WINDOW_H + 0.1, 0.07, 0.035, trim, 0, 0, back);
  lay.sb.onFace(s, plane, u, sill - 0.04, WINDOW_W + 0.3, 0.08, 0.12, 0.06, trim, 0, 0, back);
  if (rnd() < (v === WIN.broken ? 0.75 : 0.1)) {
    const y0 = sill + WINDOW_H + 0.26;
    const top = Math.min(y0 + 0.5 + rnd() * 0.35, h.ys[storey + 1] - SLAB - 0.2);
    if (top - y0 > 0.25) {
      const hw = half + 0.1;
      blob(lay, s, plane, [u, (y0 + top) / 2], [
        [u - hw, y0],
        [u + hw, y0],
        [u + hw * 0.75, y0 + (top - y0) * 0.5],
        [u + hw * 0.2, top],
        [u - hw * 0.15, top - 0.12],
        [u - hw * 0.7, y0 + (top - y0) * 0.55],
      ], 0, 0.006, SCORCH);
    }
  }
}

/**
 * The door — open in an enterable house, shut, steel or bricked up in one
 * that is not — and the meter beside it, whose cable climbs to the string
 * course and runs under it to the +X corner.
 */
function door(lay: Lay, h: House): void {
  const { rnd, d, w, wallTop } = h;
  const r = rnd();
  let v: number;
  if (h.enterable) v = h.ruined ? DOOR.torn : r < 0.6 ? DOOR.back : r < 0.82 ? DOOR.torn : DOOR.steelBack;
  else v = h.ruined ? (r < 0.5 ? DOOR.bricked : DOOR.shut) : r < 0.52 ? DOOR.shut : r < 0.8 ? DOOR.steelShut : DOOR.bricked;
  fitOn(h, "door", v, "-z", d / 2, 0, PLINTH);
  if (h.ruined) return;
  const mu = 1.2;
  fitOn(h, "meter", 0, "-z", d / 2, mu, 1.75);
  const back = hideBack("-z");
  const y0 = 2.26;
  // Up to the string course; on a two-storey house only to the floor, clear
  // of the windows over it, and along under the floor joists.
  const y1 = h.floors > 1 ? h.ys[1] - SLAB / 2 - 0.25 : wallTop - 0.2;
  lay.sb.onFace("-z", d / 2, mu, (y0 + y1) / 2, 0.03, y1 - y0, 0.03, 0.02, IRON, 0, 0, back);
  const u1 = w / 2 - 0.12;
  lay.sb.onFace("-z", d / 2, (mu + u1) / 2, y1 + 0.015, u1 - mu, 0.03, 0.03, 0.02, IRON, 0, 0, back);
}

// --- the elevations ----------------------------------------------------------------

/**
 * The four outer faces: the plinth carried to the ground, the joist ends
 * through the front under the string course and at the floor between the
 * storeys, the scars where the render is lost back to the brick, and the
 * pocks — all kept off the windows and the door.
 */
function elevations(lay: Lay, h: House, wins: Win[], ground: (lx: number, lz: number) => number): void {
  const { w, d, ys, floors, wallTop, skin, rnd, ruined, edge } = h;
  const faces: { s: Side; plane: number; half: number }[] = [
    { s: "-z", plane: d / 2, half: w / 2 },
    { s: "+z", plane: d / 2, half: w / 2 },
    { s: "-x", plane: w / 2, half: d / 2 },
    { s: "+x", plane: w / 2, half: d / 2 },
  ];
  for (const f of faces) {
    const { s, plane, half } = f;
    const back = hideBack(s);
    const front = s === "-z";
    const mine = wins.filter((wn) => wn.s === s);

    // The plinth's face, down to the ground where it falls away.
    let low = 0;
    for (let i = 0; i <= 6; i++) {
      const u = -half - 0.25 + (i / 6) * (2 * half + 0.5);
      const o = (half === w / 2 ? d / 2 : w / 2) + 0.25;
      const oo = s === "+z" || s === "+x" ? o : -o;
      low = Math.min(low, s === "-z" || s === "+z" ? ground(u, oo) : ground(oo, u));
    }
    if (low < -0.03) lay.sb.onFace(s, plane, 0, low / 2, 2 * half + 0.5, -low, 0.25, 0.125, MUDBRICK_DARK, 0, 0, back);

    if (s === "+x" && ruined) continue;

    // The joists' ends through the front: the roof's under the string
    // course, and the floor's between the storeys. Palm logs, and the one
    // thing that says what holds a mud roof up.
    if (front && !ruined) {
      const rows = [wallTop - 0.3];
      if (floors > 1) rows.push(ys[1] - SLAB / 2);
      for (const y of rows) {
        for (let u = -half + 0.55; u < edge - 0.5; u += 0.8) {
          if (mine.some((wn) => Math.abs(wn.u - u) < WINDOW_W / 2 + 0.4 && y > wn.sill - 0.2 && y < wn.sill + WINDOW_H + 0.45)) continue;
          if (y < 3.0 && Math.abs(u) < 1.35) continue;
          lay.sb.onFace(s, plane, u, y, 0.15, 0.15, 0.16, 0.08, PALM_BEAM, (rnd() - 0.5) * 0.2, 0, back);
        }
      }
    }

    // Where the render has come away, low between the windows: likelier on
    // the front, and on a ruin.
    const keep: [number, number][] = mine.map((wn) => [wn.u - WINDOW_W / 2 - 0.6, wn.u + WINDOW_W / 2 + 0.6]);
    if (front) keep.push([-1.4, 1.5]);
    const chance = (front ? 0.55 : street(s) ? 0.3 : 0.1) + (ruined ? 0.35 : 0);
    const gaps = carve(-half + 0.5, half - 0.5, keep).filter(([a, c]) => c - a > 1.7);
    if (gaps.length && rnd() < chance) {
      const [a, c] = gaps[Math.floor(rnd() * gaps.length)];
      const hu = Math.min(0.5, (c - a) / 3.4);
      spall(lay, s, plane, a + 1.5 * hu + rnd() * Math.max(0, c - a - 3 * hu), 1.0 + rnd() * 0.5, hu, 0.26 + rnd() * 0.08, skin, rnd, MUD_BOND, { n: 9, extra: 1 });
    }

    // The pocks, in the runs between the openings.
    const pk: [number, number][] = mine.map((wn) => [wn.u - WINDOW_W / 2 - 0.2, wn.u + WINDOW_W / 2 + 0.2]);
    if (front) pk.push([-0.95, 0.95]);
    const per = (front ? 0.55 : street(s) ? 0.3 : 0.08) * (ruined ? 1.8 : 1);
    for (const [a, c] of carve(-half + 0.4, half - 0.4, pk)) {
      const n = Math.round((c - a) * per);
      if (n > 0) pocks(lay, s, plane, a, c, PLINTH + 0.6, wallTop - 0.35, n, rnd);
    }
  }
}

// --- the roofline ------------------------------------------------------------------

/**
 * Everything on and over the parapet: the spouts through its foot on the two
 * street faces and their wash down the wall; a tank on a stand over one of
 * the -X corners (either corner, where no stair lane is); a dish on the back
 * cap, turned to `DISH_AIM` in the world; an aerial up a face at the far end
 * from the tank; a cooler on whichever street face the washing is not; and
 * nothing else on the deck, which is ground a fight crosses.
 */
function roofline(lay: Lay, h: House, wins: Win[], rotY: number): void {
  const { w, d, roofY, wallTop, floors, ys, rnd, edge, roofX, roofW } = h;
  const capY = roofY + PARAPET + 0.14;
  const used: Record<"-z" | "+z", [number, number][]> = { "-z": [], "+z": [] };

  // The spouts, kept off the windows' heads.
  for (const s of ["-z", "+z"] as const) {
    for (const fr of [0.22, 0.68]) {
      const u = -w / 2 + (edge + w / 2) * fr;
      if (wins.some((wn) => wn.s === s && Math.abs(wn.u - u) < WINDOW_W / 2 + 0.55)) continue;
      fitOn(h, "spout", rnd() < 0.7 ? SPOUT.palm : SPOUT.tin, s, d / 2, u, roofY + 0.08);
      streak(lay, s, d / 2, u, wallTop - 0.1, rnd, floors > 1 ? ys[1] + 1.2 : 2.15);
      lay.sb.onFace(opp(s), -(d / 2 - PARAPET_T), u, roofY + 0.09, 0.2, 0.14, 0.02, 0.01, WINDOW_VOID, 0, 0, hideBack(opp(s)));
      used[s].push([u - 0.2, u + 0.2]);
    }
  }

  // The tank, over a -X corner; its frame turned so both runs go inboard.
  const tankAt = rnd() < 0.55 ? (rnd() < 0.5 ? -1 : 1) : 0;
  const cx = -w / 2 + PARAPET_T / 2;
  const cz = d / 2 - PARAPET_T / 2;
  if (tankAt) h.fits.push({ kind: "tank", v: rnd() < 0.6 ? TANK.round : TANK.box, x: cx, y: capY, z: tankAt * cz, yaw: tankAt < 0 ? Math.PI / 2 : Math.PI });

  // The dish, on the back cap, clear of a tank on that corner.
  if (rnd() < 0.4) {
    const lo = tankAt === 1 ? -w / 2 + 2.0 : -w / 2 + 0.8;
    const hi = edge - 0.8;
    if (hi > lo) h.fits.push({ kind: "dish", v: 0, x: lo + rnd() * (hi - lo), y: capY, z: cz, yaw: DISH_AIM - rotY });
  }

  // The aerial, up a street face at the plate's far end from the tank.
  if (rnd() < 0.25) {
    const s: "-z" | "+z" = rnd() < 0.5 ? "-z" : "+z";
    const u = edge - 0.7;
    fitOn(h, "aerial", 0, s, d / 2, u, capY);
    used[s].push([u - 0.25, u + 0.25]);
  }

  // The cooler, on the street face the washing does not hang on.
  if (rnd() < 0.3) {
    const s: "-z" | "+z" = h.hung > 0.42 ? (h.hung > 0.71 ? "-z" : "+z") : rnd() < 0.5 ? "-z" : "+z";
    const free = carve(roofX - roofW / 2 + 0.9, edge - 0.9, used[s].map(([a, c]) => [a - 0.45, c + 0.45] as [number, number])).filter(([a, c]) => c > a);
    if (free.length) {
      const [a, c] = free[Math.floor(rnd() * free.length)];
      fitOn(h, "cooler", 0, s, d / 2, a + rnd() * (c - a), roofY);
    }
  }
}

// --- inside --------------------------------------------------------------------------

/**
 * Inside the one room: palm joists front to back under its ceiling, every
 * one 2.7 m over the floor; a mat off the door's path and bedding along the
 * back wall, neither higher than a step; and every window's niche in the
 * wall's inside face. A ruin's joists stop where its roof does (`ceilingTo`).
 */
function interior(lay: Lay, h: House, wins: Win[], ceilingTo: number): void {
  const { w, d, floors, ys, climbs, edge, rnd, ruined, roofY } = h;
  const sb = lay.sb;
  const xi0 = -w / 2 + T;
  let xi1 = climbs ? edge : w / 2 - T;
  if (ruined && floors === 1) xi1 = Math.min(xi1, ceilingTo - 0.2);
  const zi = d / 2 - T;
  const under = (floors > 1 ? ys[1] : roofY) - SLAB;
  for (let x = xi0 + 0.35; x < xi1 - 0.25; x += 0.8) {
    sb.box(0.14, 0.14, 2 * zi, x, under - 0.07, 0, PALM_BEAM, { x: (rnd() - 0.5) * 0.02 }, HIDE_UP);
  }
  const fy = PLINTH;
  const roomX1 = (climbs ? edge : w / 2 - T) - 0.4;
  if (!ruined) {
    // The mat, off the door's path; the bedding along the back wall.
    const mx = xi0 + 1.3 + rnd() * Math.max(0, roomX1 - xi0 - 2.6) * 0.4;
    sb.box(2.0, 0.01, 1.4, mx, fy + 0.005, zi * 0.25, SANDBAG, undefined, TOP_ONLY);
    sb.box(1.6, 0.004, 0.08, mx, fy + 0.012, zi * 0.25 - 0.55, PALM_BEAM, undefined, TOP_ONLY);
    sb.box(1.6, 0.004, 0.08, mx, fy + 0.012, zi * 0.25 + 0.55, PALM_BEAM, undefined, TOP_ONLY);
    const bx = Math.min(roomX1 - 1.1, xi0 + 1.2 + rnd() * Math.max(0, roomX1 - xi0 - 2.4));
    sb.box(1.9, 0.1, 0.75, bx, fy + 0.05, zi - 0.45, CLOTH, undefined, HIDE_DOWN);
    sb.box(0.34, 0.08, 0.6, bx - 0.7, fy + 0.14, zi - 0.45, CLOTH, undefined, HIDE_DOWN);
    log(lay.m(SANDBAG), [bx + 0.72, fy + 0.2, zi - 0.78], [bx + 0.72, fy + 0.2, zi - 0.12], 0.085, 6);
  }
  for (const wn of wins) {
    if (wn.storey > 0) continue;
    if (climbs && wn.s !== "-x" && wn.u + WINDOW_W / 2 > edge - 0.3) continue;
    const s = opp(wn.s);
    const pl = -(wn.plane - T);
    const back = hideBack(s);
    sb.onFace(s, pl, wn.u, wn.sill + WINDOW_H / 2, WINDOW_W + 0.1, WINDOW_H + 0.1, 0.02, 0.01, WINDOW_VOID, 0, 0, back);
    sb.onFace(s, pl, wn.u, wn.sill - 0.08, WINDOW_W + 0.3, 0.06, 0.12, 0.06, PALM_BEAM, 0, 0, back);
  }
}

// --- the ruin --------------------------------------------------------------------------

/**
 * What a ruin adds: the stub of the +X wall broken in steps along its head,
 * standing on the collider's top; lumps of fallen brick round the two mounds
 * and along the stub's foot inside and out — on the plinth or, past it, on
 * the ground — none higher than a step; and two
 * of the roof's joists lying where they fell.
 */
function ruin(
  lay: Lay,
  h: House,
  stub: { w: number; h: number; d: number; x: number; y: number; z: number },
  ground: (lx: number, lz: number) => number,
): void {
  const { w, d, rnd } = h;
  const sb = lay.sb;
  const top = stub.y + stub.h / 2;
  const z0 = stub.z - stub.d / 2;
  for (const [t, len, hh] of [
    [0.06, 0.34, 0.34],
    [0.3, 0.42, 0.2],
    [0.62, 0.3, 0.1],
  ] as const) {
    sb.box(stub.w, hh, stub.d * len, stub.x, top + hh / 2, z0 + stub.d * (t + len / 2), SCORCH, undefined, HIDE_DOWN);
  }
  const colors = [MUDBRICK, MUDBRICK_DARK, SCORCH];
  for (let i = 0; i < 11; i++) {
    const x = w * 0.08 + rnd() * (w * 0.42 + 1.3);
    const z = (rnd() - 0.5) * d * 0.7;
    const s = 0.18 + rnd() * 0.24;
    const hh = Math.min(0.28, s * (0.5 + rnd() * 0.4));
    const base = x > w / 2 + 0.2 ? ground(x, z) : PLINTH;
    sb.box(s * (1 + rnd() * 0.5), hh, s, x, base + hh / 2 - 0.02, z, colors[i % 3], { y: rnd() * Math.PI, z: (rnd() - 0.5) * 0.3 }, HIDE_DOWN);
  }
  const beam = lay.m(PALM_BEAM);
  for (const e of [-1, 1]) {
    const x = w * 0.26 + e * 0.6;
    const z = e * d * 0.05;
    const a = rnd() * 0.6 - 0.3 + (e > 0 ? 0.4 : 1.9);
    log(beam, [x - Math.cos(a) * 1.4, PLINTH + 0.07, z - Math.sin(a) * 1.4], [x + Math.cos(a) * 1.4, PLINTH + 0.07, z + Math.sin(a) * 1.4], 0.07, 5);
  }
}
