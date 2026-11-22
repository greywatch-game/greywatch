/**
 * kit/desert/windTower.ts — buildWindTower: a merchant's house of the old
 * town in the late Ottoman manner — mud-rendered brick on a stone socle,
 * grilled windows below and shuttered ones above, a timber shanasheel oriel
 * hung over the door, a dog-tooth cornice under a parapet pierced with
 * triangles — and the barjeel standing off its roof: a panelled shaft with
 * its putlog poles still in it, an open head of slots round an X-shaped
 * partition, and a crenellated crest. The one piece of cover in the middle
 * of a deck. Part of the desert-town set: follows the contract in
 * kit/core.ts and the set's rules in `./index.ts`. Invariants: every
 * collider byte for byte and in its order — the plinth, the flights, the
 * floor slab, the walls, the roof, the parapet and the tower's shaft —
 * restated at the top; variation comes from the params, never
 * `Math.random()`. Never imports another builder.
 */
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import { mulberry32 } from "../../rng";
import {
  ALLOY,
  Build,
  IRON,
  TEAK,
  carve,
  hideBack,
  streetSeed,
  type BuildParams,
  type Side,
  type Structure,
} from "../core";
import {
  MUDBRICK,
  MUDBRICK_DARK,
  ROOF_MUD,
  WINDOW_VOID,
  PALM_BEAM,
  SANDBAG,
  SCORCH,
  CLOTH,
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
import {
  HIDE_DOWN,
  Lay,
  archRing,
  band,
  blob,
  cornice,
  disc,
  fp,
  kufic,
  lobe,
  log,
  merlons,
  opp,
  pocks,
  slabOn,
  socle,
  spall,
  spout,
  triangles,
} from "./lay";

/** The top of a thing whose top is another thing's to draw. */
const HIDE_UP = 1 << 2;
/** A box drawn by its top face alone: a rug, a mat, a joint on a floor. */
const TOP_ONLY = 0b111011;
/** The face of a box looking +Z: the back of anything hung on the front. */
const HIDE_PZ = 1 << 4;
/** The pitch of a parapet's pierced triangles: a little wider than the souk's, on a house with four faces of parapet. */
const TRI = 0.7;

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
 * ## What it is drawn as
 *
 * A merchant's house of the river provinces in the last Ottoman century, of
 * a piece with the khan and the hammam. Its walls are mud render over brick
 * on a socle of dressed stone, shelled back to the courses in patches, with a
 * dog-tooth cornice on the string course at the wall head, palm-joist ends
 * through the end wall, palm spouts through the parapet's foot and a parapet
 * pierced with triangles, stepped pinnacles on its corners. The windows are
 * framed in palm boards in a returned reveal under a palm lintel — grilled on
 * the ground floor, shuttered upstairs, some shutters closed and some burnt
 * over. The door has a boarded frame, a lintel, a plaque of kufic over it and
 * a meter beside it; on a two-storey house a SHANASHEEL hangs over it, the
 * timber oriel of Baghdad and Basra, on struts — a panelled kick, a lattice
 * screen under sashes, a dentilled hood. On the roof the household sleeps
 * out, and the pots stand in a corner. Inside: palm joists over girders, a
 * rug with a tray on it, cushions along the end wall, every window's niche,
 * and the door's leaves folded back.
 *
 * The barjeel is the Gulf's: a shaft panelled in pilasters with a pointed
 * head to every panel, a band at two fifths, the putlog holes and the poles
 * still standing in some; at the head three slots a face between corner
 * piers and two mullions, the X-shaped partition that decides which face the
 * wind comes down showing through them, a band over them with a frieze of
 * niches and poles through it, and a cap with merlons and four pinnacles.
 * An aerial is strapped to its back.
 *
 * ## The head is open, and the collider stops under it
 *
 * A barjeel is a chimney run backwards — the shaft is solid for most of its
 * height and the head is open — so the collider is the SHAFT and stops where
 * the openings start: a round fired at the head goes between the piers, which
 * is what a hollow head is, and it costs one box rather than five to say so.
 * The shaft is drawn TO that box, its pilasters 6 cm proud of it, so a round
 * stopping on the tower stops on its face; the head and its crest stand on
 * the box's top and are a metre taller than the first drawing's flat lid.
 *
 * ## The colliders, which are unchanged
 *
 * The plinth, the flights and their landings (`laneFlight`, still called),
 * the floor slab, the front wall round its door (`doorWall`'s arithmetic
 * spelled out), the back and side walls, the roof, the parapet and the shaft
 * — restated below exactly as they were first emitted. Everything after that
 * block is DRAWING and keeps to the three rules: on a face (the socle, the
 * cornice, the frames, the shutters, the plaque), low enough to step over
 * (the rugs, the mattress, the bedding, the pots, the patches of new mud),
 * or overhead (the shanasheel, whose struts start 2.7 m over the street, the
 * joists and girders inside, every one at least 2.4 m over its floor) or
 * standing on a collider (the pinnacles, the barjeel's head and crest).
 *
 * Everything else is `buildAdobeHouse`'s, the stair lane included — see the
 * set's header — so `depth` carries the same 12.7 m floor and
 * `assertClimbable` says so in a DEV build. The tower stands on the roof PLATE
 * and never over the lane: a stair well with a wind tower on top of it is a
 * stair to a wall.
 */
export function buildWindTower(
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(mats, "windtower");
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
  const roofW = climbs ? plateW : w;
  const roofX = climbs ? plateX : 0;
  const sideD = d - 2 * T;

  if (climbs) assertClimbable("windTower", d, ys[1] - ys[0]);

  // --- the colliders, restated in their order ----------------------------------
  // 1 — the plinth.
  b.block({ w: w + 0.5, h: PLINTH, d: d + 0.5, x: 0, y: PLINTH / 2, z: 0 });
  // 2 — the flights, 3 — the slabs. The set's order, and the same lane.
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
  // 4 — the walls. The front round its door is `doorWall`'s arithmetic.
  const mid = wallTop / 2;
  const zF = -(d - T) / 2;
  const doorW = 1.4;
  const doorH = 2.2;
  const jamb = (w - doorW) / 2;
  const off = doorW / 2 + jamb / 2;
  const lintel = wallTop - doorH;
  const enterable = !!p.enterable;
  if (enterable) {
    if (jamb > 0.05) {
      b.block({ w: jamb, h: wallTop, d: T, x: 0 - off, y: mid, z: zF });
      b.block({ w: jamb, h: wallTop, d: T, x: 0 + off, y: mid, z: zF });
    }
    if (lintel > 0.05) b.block({ w: doorW, h: lintel, d: T, x: 0, y: mid + wallTop / 2 - lintel / 2, z: zF });
  } else {
    b.block({ w, h: wallTop, d: T, x: 0, y: mid, z: zF });
  }
  b.block({ w, h: wallTop, d: T, x: 0, y: mid, z: (d - T) / 2 });
  for (const sx of [-1, 1] as const) {
    b.block({ w: T, h: wallTop, d: sideD, x: (sx * (w - T)) / 2, y: mid, z: 0 });
  }
  // 5 — the roof, 6 — the parapet: `parapetOpenX`'s three and the run over
  // the shaft, or `parapet`'s four.
  b.block({ w: roofW, h: SLAB, d, x: roofX, y: roofY - SLAB / 2, z: 0 });
  const runD = d - 2 * PARAPET_T;
  if (climbs) {
    b.block({ w: PARAPET_T, h: PARAPET, d, x: (w - PARAPET_T) / 2, y: wallTop + PARAPET / 2, z: 0 });
    for (const sz of [-1, 1] as const) {
      b.block({ w: roofW, h: PARAPET, d: PARAPET_T, x: roofX, y: roofY + PARAPET / 2, z: (sz * (d - PARAPET_T)) / 2 });
    }
    b.block({ w: PARAPET_T, h: PARAPET, d: runD, x: roofX - (roofW - PARAPET_T) / 2, y: roofY + PARAPET / 2, z: 0 });
  } else {
    for (const sz of [-1, 1] as const) {
      b.block({ w, h: PARAPET, d: PARAPET_T, x: 0, y: roofY + PARAPET / 2, z: (sz * (d - PARAPET_T)) / 2 });
    }
    for (const sx of [-1, 1] as const) {
      b.block({ w: PARAPET_T, h: PARAPET, d: runD, x: (sx * (w - PARAPET_T)) / 2, y: roofY + PARAPET / 2, z: 0 });
    }
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
  b.block({
    w: side + 0.34,
    h: shaft + 0.3,
    d: side + 0.34,
    x: tx,
    y: roofY + (shaft + 0.3) / 2,
    z: tz,
  });

  // --- the drawing -----------------------------------------------------------------
  const k: House = {
    w,
    d,
    floors,
    skin,
    climbs,
    enterable,
    ys,
    roofY,
    wallTop,
    edge: roofX + roofW / 2,
    doorW,
    doorH,
    tx,
    tz,
    S: side + 0.34,
    head: roofY + shaft + 0.3,
    rnd: mulberry32(streetSeed(w, d, towerH)),
  };
  const wins = windows(k);
  const lay = new Lay();
  for (const wn of wins) windowAt(lay, k, wn);
  slits(lay, k);
  elevations(lay, k, wins);
  if (enterable) door(lay, k);
  if (floors > 1) shanasheel(lay, k);
  tower(lay, k);
  deck(lay, k);
  interior(lay, k, wins);
  lay.flush(b);
  // The shaft's core, after the pilasters and bands laid on it.
  const late = new Lay();
  late.sb.box(k.S, k.head - roofY, k.S, tx, (roofY + k.head) / 2, tz, skin, undefined, HIDE_DOWN | HIDE_UP);
  late.flush(b);
  // The washing, over the back parapet: the set's one moving colour.
  const { rnd } = k;
  const hang = 1 + (rnd() < 0.5 ? 1 : 0);
  const wx0 = -w / 2 + 1.4;
  const wx1 = k.edge - 1.4;
  for (let i = 0; i < hang; i++) {
    const x = wx0 + ((i + 0.2 + rnd() * 0.6) / hang) * (wx1 - wx0);
    drape(b, 1.5 + rnd() * 0.6, 0.7, x, roofY + PARAPET, d / 2, 1, clothHash(w, d, towerH, i));
  }

  // --- the masses, after what is laid on them ------------------------------------
  b.box(w + 0.5, PLINTH, d + 0.5, 0, PLINTH / 2, 0, MUDBRICK_DARK);
  for (let f = 1; f < floors; f++) b.box(roofW, SLAB, d - 2 * T, roofX, ys[f] - SLAB / 2, 0, ROOF_MUD);
  if (enterable) {
    if (jamb > 0.05) {
      b.box(jamb, wallTop, T, 0 - off, mid, zF, skin);
      b.box(jamb, wallTop, T, 0 + off, mid, zF, skin);
    }
    if (lintel > 0.05) b.box(doorW, lintel, T, 0, mid + wallTop / 2 - lintel / 2, zF, skin);
  } else {
    b.box(w, wallTop, T, 0, mid, zF, skin);
  }
  b.box(w, wallTop, T, 0, mid, (d - T) / 2, skin);
  for (const sx of [-1, 1] as const) b.box(T, wallTop, sideD, (sx * (w - T)) / 2, mid, 0, skin);
  // The string course at the wall head: a ring round the walls, never a plate
  // across the house, which would lid the stair shaft.
  const sc = T + 0.15;
  for (const sz of [-1, 1] as const) b.box(w + 0.3, 0.16, sc, 0, wallTop - 0.08, sz * (d / 2 + 0.15 - sc / 2), MUDBRICK_DARK);
  for (const sx of [-1, 1] as const) b.box(sc, 0.16, d - 2 * T, sx * (w / 2 + 0.15 - sc / 2), wallTop - 0.08, 0, MUDBRICK_DARK);
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
  skin: string;
  climbs: boolean;
  enterable: boolean;
  ys: number[];
  roofY: number;
  wallTop: number;
  /** The deck's +X edge: the stair shaft's inner side when the house climbs. */
  edge: number;
  doorW: number;
  doorH: number;
  /** The barjeel: its centre, the side of its shaft and the shaft's head. */
  tx: number;
  tz: number;
  S: number;
  head: number;
  rnd: () => number;
}

/** One window: its face, its centre along it, its sill, its size, its storey. */
interface Win {
  s: Side;
  plane: number;
  u: number;
  sill: number;
  ww: number;
  wh: number;
  upper: boolean;
}

/** The shanasheel's width, which the front's upper windows stand clear of. */
const orielW = (w: number): number => Math.min(3.6, w * 0.3);

/**
 * Where every window is. The front's ground floor keeps its middle for the
 * door and its first floor for the shanasheel; the back and the -X end are
 * rows; the +X end is the stair shaft's wall and gets slits of its own.
 */
function windows(k: House): Win[] {
  const { w, d, ys, floors, enterable } = k;
  const out: Win[] = [];
  const across = Math.max(1, Math.round(w / 4.5));
  for (let f = 0; f < floors; f++) {
    const upper = f > 0;
    const ww = upper ? 0.9 : 0.8;
    const wh = upper ? 1.25 : floors === 1 ? 1.1 : 1.0;
    const sill = upper ? ys[f] + 0.85 : PLINTH + (floors === 1 ? 1.2 : 1.35);
    const row = (s: Side, plane: number, span: number, n: number): void => {
      for (let i = 0; i < n; i++) out.push({ s, plane, u: -span / 2 + ((i + 0.5) / n) * span, sill, ww, wh, upper });
    };
    if (upper && floors > 1) {
      const u = Math.max(orielW(w) / 2 + 1.6, Math.min(w * 0.34, w / 2 - 1.3));
      for (const e of [-1, 1]) out.push({ s: "-z", plane: d / 2, u: e * u, sill, ww, wh, upper });
    } else if (enterable) {
      for (const e of [-1, 1]) out.push({ s: "-z", plane: d / 2, u: e * Math.min(w * 0.3, w / 2 - 1.3), sill, ww, wh, upper });
    } else {
      row("-z", d / 2, w - 2.4, across);
    }
    row("+z", d / 2, w - 2.4, across);
    row("-x", w / 2, d - 2 * T - 2.0, Math.max(1, Math.round(d / 5)));
  }
  return out;
}

// --- the windows -------------------------------------------------------------------

/**
 * One window: the dark room behind a casement of palm boards, a reveal of
 * render returned round it, a sill and a palm lintel. On the ground floor an
 * iron grille; upstairs two board shutters — open back on the wall, one or
 * both shut, or one gone — and now and then the scorch of a room that burned.
 */
function windowAt(lay: Lay, k: House, wn: Win): void {
  const { s, plane, u, sill, ww, wh, upper } = wn;
  const { rnd } = k;
  const back = hideBack(s);
  const sb = lay.sb;
  const yc = sill + wh / 2;
  const fw = 0.11;
  sb.onFace(s, plane, u, yc, ww, wh, 0.02, 0.01, WINDOW_VOID, 0, 0, back);
  // The casement: its stiles and a mullion; the reveal's head and the sill
  // stand over its rails.
  const cf = 0.05;
  for (const e of [-1, 0, 1]) sb.onFace(s, plane, u + e * (ww / 2 - cf / 2), yc, e ? cf : cf * 0.7, wh, 0.03, 0.03, PALM_BEAM, 0, 0, back);
  // The reveal, the sill and the lintel.
  for (const e of [-1, 1]) sb.onFace(s, plane, u + e * (ww / 2 + fw / 2), yc + fw / 2, fw, wh + fw, 0.07, 0.035, MUDBRICK_DARK, 0, 0, back);
  sb.onFace(s, plane, u, sill + wh + fw / 2, ww, fw, 0.07, 0.035, MUDBRICK_DARK, 0, 0, back);
  sb.onFace(s, plane, u, sill - 0.04, ww + 0.36, 0.08, 0.15, 0.075, MUDBRICK_DARK, 0, 0, back);
  sb.onFace(s, plane, u, sill + wh + fw + 0.08, ww + 0.62, 0.16, 0.1, 0.05, PALM_BEAM, 0, 0, back);

  if (!upper) {
    // The grille: three bars up and two across, set in the reveal.
    for (const e of [-1, 0, 1]) sb.onFace(s, plane, u + (e * ww) / 4, yc, 0.03, wh - 0.04, 0.03, 0.055, IRON, 0, 0, back);
    for (const t of [1 / 3, 2 / 3]) sb.onFace(s, plane, u, sill + t * wh, ww - 0.06, 0.03, 0.03, 0.06, IRON, 0, 0, back);
    return;
  }
  // The shutters.
  const st = rnd();
  // Both open, one shut, both shut, or one open and the other gone.
  const shut = st < 0.45 ? 0 : st < 0.7 ? (rnd() < 0.5 ? -1 : 1) : st < 0.85 ? 2 : 0;
  const gone = st >= 0.85 ? (rnd() < 0.5 ? -1 : 1) : 0;
  const lw = ww / 2;
  for (const e of [-1, 1]) {
    if (e === gone) continue;
    const closed = shut === 2 || shut === e;
    const uc = closed ? u + (e * lw) / 2 : u + e * (ww / 2 + fw + lw / 2 + 0.02);
    const o = closed ? 0.06 : 0.025;
    const nb = 3;
    for (let j = 0; j < nb; j++) {
      sb.onFace(s, plane, uc - lw / 2 + (j + 0.5) * (lw / nb), yc, lw / nb - 0.012, wh - 0.03, 0.03, o, PALM_BEAM, 0, 0, back);
    }
    for (const t of [0.22, 0.78]) sb.onFace(s, plane, uc, sill + t * wh, lw - 0.05, 0.06, 0.02, o + 0.025, TEAK, 0, 0, back);
  }
  // A room that burned: the tongue its fire left up the wall over the lintel.
  if (rnd() < 0.2) {
    const y0 = sill + wh + fw + 0.17;
    const top = y0 + 0.55 + rnd() * 0.35;
    const hw = ww / 2 + 0.1;
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

/** The stair shaft's light: two slits a storey in the +X end, high on the wall, and their reveals inside. */
function slits(lay: Lay, k: House): void {
  const { w, d, ys, floors } = k;
  const s: Side = "+x";
  const back = hideBack(s);
  for (let f = 0; f < floors; f++) {
    for (const e of [-1, 1]) {
      const u = e * d * 0.22;
      const sill = ys[f] + 1.75;
      lay.sb.onFace(s, w / 2, u, sill + 0.3, 0.22, 0.6, 0.02, 0.01, WINDOW_VOID, 0, 0, back);
      for (const q of [-1, 1]) lay.sb.onFace(s, w / 2, u + q * 0.16, sill + 0.3, 0.1, 0.7, 0.06, 0.03, MUDBRICK_DARK, 0, 0, back);
      lay.sb.onFace(s, w / 2, u, sill - 0.03, 0.42, 0.07, 0.12, 0.06, MUDBRICK_DARK, 0, 0, back);
      lay.sb.onFace(s, w / 2, u, sill + 0.68, 0.5, 0.12, 0.08, 0.04, PALM_BEAM, 0, 0, back);
      lay.sb.onFace("-x", -(w / 2 - T), u, sill + 0.3, 0.3, 0.66, 0.02, 0.01, WINDOW_VOID, 0, 0, hideBack("-x"));
    }
  }
}

// --- the elevations ----------------------------------------------------------------

/**
 * The four outer faces: the socle, the cornice on the string course and the
 * render over the slab's edge, the parapet's pierced triangles on both its
 * faces, the spouts, the joist ends through the -X end, the patches of lost
 * render and the pocks — all kept off the windows and the door.
 */
function elevations(lay: Lay, k: House, wins: Win[]): void {
  const { w, d, wallTop, roofY, skin, rnd, climbs, edge, floors, ys } = k;
  const zRoof: [number, number] = [-w / 2, edge];
  const faces: { s: Side; plane: number; half: number; roof: [number, number] | null }[] = [
    { s: "-z", plane: d / 2, half: w / 2, roof: zRoof },
    { s: "+z", plane: d / 2, half: w / 2, roof: zRoof },
    { s: "-x", plane: w / 2, half: d / 2, roof: [-d / 2, d / 2] },
    { s: "+x", plane: w / 2, half: d / 2, roof: climbs ? null : [-d / 2, d / 2] },
  ];
  const doorCut: [number, number] = [-1.05, 1.05];
  for (const f of faces) {
    const { s, plane, half } = f;
    const back = hideBack(s);
    const front = s === "-z";
    const mine = wins.filter((wn) => wn.s === s);
    const hasDoor = front && k.enterable;

    // The socle, stopping at the door.
    for (const [a, c] of carve(-half, half, hasDoor ? [doorCut] : [])) socle(lay, s, plane, a, c, rnd);

    // The cornice on the string course, the render over the slab's edge, and
    // the parapet's triangles — or, over the stair shaft, the parapet run that
    // stands on the wall head itself.
    const ext = 0.12;
    if (f.roof) {
      const [a, c] = f.roof;
      const a2 = s === "-z" || s === "+z" ? a - ext : a;
      const c2 = (s === "-z" || s === "+z") && !climbs ? c + ext : c;
      cornice(lay, s, plane, a2, c2, wallTop);
      const fy = wallTop + 0.38;
      lay.sb.onFace(s, plane, (a + c) / 2, (fy + roofY) / 2, c - a, roofY - fy, 0.02, 0.01, skin, 0, 0, back);
      triangles(lay, s, plane, a + 0.6, c - 0.6, roofY + 0.42, TRI);
      const ic = s === "-z" || s === "+z" ? (climbs ? c - 0.6 : c - PARAPET_T - 0.4) : c - PARAPET_T - 0.4;
      triangles(lay, opp(s), -(plane - PARAPET_T), a + PARAPET_T + 0.4, ic, roofY + 0.42, TRI);
    } else {
      cornice(lay, s, plane, -half - ext, half + ext, wallTop);
      triangles(lay, s, plane, -half + 0.6, half - 0.6, wallTop + 0.42, TRI);
      triangles(lay, opp(s), -(plane - PARAPET_T), -half + 0.6, half - 0.6, wallTop + 0.42, TRI);
    }

    // The spouts through the parapet's foot, kept off the windows' heads,
    // their streaks a storey long whatever the height of the wall.
    if (f.roof) {
      const [a, c] = f.roof;
      const fracs = s === "-x" ? [0.27, 0.73] : [0.2, 0.62];
      const foot = floors > 1 ? ys[1] + 1.2 : 2.15;
      for (const fr of fracs) {
        const u = a + (c - a) * fr;
        if (mine.some((wn) => Math.abs(wn.u - u) < wn.ww / 2 + 0.55)) continue;
        if (front && floors > 1 && Math.abs(u) < orielW(w) / 2 + 0.6) continue;
        spout(lay, s, plane, u, roofY + 0.08, wallTop - 0.1, rnd, foot);
        lay.sb.onFace(opp(s), -(plane - PARAPET_T), u, roofY + 0.09, 0.2, 0.14, 0.02, 0.01, WINDOW_VOID, 0, 0, hideBack(opp(s)));
      }
    }

    // The joists' ends through the -X end, under the string course and at the
    // first floor: palm logs, and the one thing that says what holds a mud
    // roof up.
    if (s === "-x") {
      const rows = [wallTop - 0.28];
      if (floors > 1) rows.push(ys[1] - SLAB / 2);
      for (const y of rows) {
        for (let u = -half + 0.7; u < half - 0.6; u += 0.58) {
          if (mine.some((wn) => Math.abs(wn.u - u) < wn.ww / 2 + 0.42 && y > wn.sill - 0.2 && y < wn.sill + wn.wh + 0.4)) continue;
          lay.sb.onFace(s, plane, u, y, 0.15, 0.15, 0.16, 0.08, PALM_BEAM, (rnd() - 0.5) * 0.2, 0, back);
        }
      }
    }

    // The render lost to the brick: one patch low between the windows, and on
    // a two-storey wall one more in the band between its storeys.
    const keep: [number, number][] = mine.map((wn) => [wn.u - wn.ww / 2 - 0.7, wn.u + wn.ww / 2 + 0.7]);
    if (hasDoor) keep.push([-1.5, 1.5]);
    if (hasDoor) keep.push([1.8, 2.5]);
    if (s === "+x") for (const e of [-1, 1]) keep.push([e * d * 0.22 - 0.5, e * d * 0.22 + 0.5]);
    const gaps = carve(-half + 0.5, half - 0.5, keep).filter(([a, c]) => c - a > 1.9);
    if (gaps.length && (front || rnd() < 0.45)) {
      const [a, c] = gaps[Math.floor(rnd() * gaps.length)];
      const hu = Math.min(0.55, (c - a) / 3.6);
      spall(lay, s, plane, a + 1.5 * hu + rnd() * Math.max(0, c - a - 3 * hu), 1.65 + rnd() * 0.25, hu, 0.24 + rnd() * 0.08, skin, rnd);
    }
    if (floors > 1 && rnd() < 0.4) {
      const clear = front ? carve(-half + 1.2, half - 1.2, [[-orielW(w) / 2 - 1.0, orielW(w) / 2 + 1.0]]) : [[-half + 1.2, half - 1.2] as [number, number]];
      const [a, c] = clear[Math.floor(rnd() * clear.length)];
      if (c - a > 1.6) spall(lay, s, plane, a + 0.8 + rnd() * (c - a - 1.6), ys[1] - 0.15 + rnd() * 0.3, 0.45 + rnd() * 0.2, 0.26 + rnd() * 0.08, skin, rnd);
    }

    // The pocks, in the runs between the windows.
    const pk: [number, number][] = mine.map((wn) => [wn.u - wn.ww / 2 - 0.2, wn.u + wn.ww / 2 + 0.2]);
    if (hasDoor) pk.push([-0.95, 0.95]);
    for (const [a, c] of carve(-half + 0.4, half - 0.4, pk)) {
      const n = Math.round((c - a) * (s === "-z" || s === "-x" ? 1.1 : 0.6));
      if (n > 0) pocks(lay, s, plane, a, c, PLINTH + 0.8, wallTop - 0.3, n, rnd);
    }
  }

  // The parapet's corners: a stepped pinnacle on each, standing on the cap.
  const capY = roofY + PARAPET + 0.14;
  const xs = [-w / 2 + PARAPET_T / 2, climbs ? edge - PARAPET_T / 2 : w / 2 - PARAPET_T / 2];
  for (const x of xs) {
    for (const sz of [-1, 1]) {
      const z = sz * (d / 2 - PARAPET_T / 2);
      lay.sb.box(0.52, 0.26, 0.52, x, capY + 0.13, z, skin, undefined, HIDE_DOWN);
      lay.sb.box(0.32, 0.2, 0.32, x, capY + 0.36, z, skin, undefined, HIDE_DOWN);
      lay.sb.box(0.38, 0.06, 0.38, x, capY + 0.49, z, MUDBRICK_DARK, undefined, HIDE_DOWN);
    }
  }
}

// --- the door --------------------------------------------------------------------

/**
 * The door: a frame of palm boards, their lining in the reveal, a threshold,
 * a lintel and a plaque of kufic over it; the meter on the wall beside it
 * with its conduit up to the wall head; and inside, the two leaves folded
 * back against the wall — boards, straps and a field of studs.
 */
function door(lay: Lay, k: House): void {
  const s: Side = "-z";
  const plane = k.d / 2;
  const back = hideBack(s);
  const dw = k.doorW / 2;
  const top = k.doorH;
  const { skin, rnd, wallTop } = k;
  const sb = lay.sb;
  for (const e of [-1, 1]) sb.onFace(s, plane, e * (dw + 0.07), (PLINTH + top) / 2, 0.14, top - PLINTH, 0.06, 0.03, PALM_BEAM, 0, 0, back);
  sb.onFace(s, plane, 0, top + 0.07, 2 * dw + 0.28, 0.14, 0.06, 0.03, PALM_BEAM, 0, 0, back);
  for (const e of [-1, 1]) {
    sb.box(0.03, top - PLINTH, T, e * (dw - 0.015), (PLINTH + top) / 2, -(plane - T / 2), PALM_BEAM, undefined, e < 0 ? 1 << 1 : 1);
  }
  sb.box(k.doorW, 0.04, T + 0.25, 0, PLINTH + 0.02, -(plane + 0.25) + (T + 0.25) / 2, MUDBRICK, undefined, HIDE_DOWN);
  sb.onFace(s, plane, 0, top + 0.24, 2 * dw + 0.8, 0.2, 0.12, 0.06, PALM_BEAM, 0, 0, back);
  // The plaque: kufic in the render's colour on a dark ground in a frame —
  // the blessing a house is given over its door.
  const py0 = top + 0.38;
  const py1 = Math.min(py0 + 0.3, wallTop - 0.26);
  if (py1 - py0 > 0.18) {
    const pw = 1.0;
    slabOn(lay, s, plane, [[-pw / 2, py0], [pw / 2, py0], [pw / 2, py1], [-pw / 2, py1]], 0, 0.012, MUDBRICK_DARK);
    for (const e of [-1, 1]) sb.onFace(s, plane, (e * (pw + 0.05)) / 2, (py0 + py1) / 2, 0.05, py1 - py0 + 0.1, 0.04, 0.02, skin, 0, 0, back);
    for (const yy of [py0 - 0.025, py1 + 0.025]) sb.onFace(s, plane, 0, yy, pw + 0.1, 0.05, 0.04, 0.02, skin, 0, 0, back);
    const put = (u: number, yy: number, along: number, tall: number): void => sb.onFace(s, plane, u, yy, along, tall, 0.012, 0.018, skin, 0, 0, back);
    kufic(put, -pw / 2 + 0.05, pw / 2 - 0.05, py0 + 0.02, py1 - py0 - 0.04, rnd);
  }
  // The meter and its conduit.
  const mu = 2.1;
  sb.onFace(s, plane, mu, 1.75, 0.3, 0.42, 0.14, 0.07, ALLOY, 0, 0, back);
  sb.onFace(s, plane, mu, 1.75, 0.12, 0.1, 0.02, 0.15, WINDOW_VOID, 0, 0, back);
  sb.onFace(s, plane, mu, (1.96 + wallTop - 0.16) / 2, 0.04, wallTop - 0.16 - 1.96, 0.04, 0.02, IRON, 0, 0, back);
  // The leaves, folded back against the wall inside.
  const s2: Side = "+z";
  const inner = -(k.d / 2 - T);
  const b2 = hideBack(s2);
  const leafH = top - PLINTH - 0.06;
  for (const e of [-1, 1]) {
    const hinge = e * dw;
    const uc = hinge + e * (dw / 2 + 0.02);
    const nB = 5;
    for (let j = 0; j < nB; j++) {
      sb.onFace(s2, inner, hinge + e * (0.03 + (j + 0.5) * (dw / nB)), PLINTH + 0.03 + leafH / 2, dw / nB - 0.016, leafH, 0.07, 0.035, PALM_BEAM, 0, 0, b2);
    }
    for (const yy of [0.5, 1.15, 1.8]) sb.onFace(s2, inner, uc, PLINTH + yy, dw - 0.04, 0.07, 0.02, 0.08, IRON, 0, 0, b2);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 3; c++) {
        sb.onFace(s2, inner, hinge + e * (0.16 + c * ((dw - 0.3) / 2)), PLINTH + 0.36 + r * 0.4, 0.045, 0.045, 0.03, 0.085, IRON, 0, 0, b2);
      }
    }
  }
}

// --- the shanasheel --------------------------------------------------------------

/**
 * The shanasheel over the door: a timber oriel 0.62 m out of the first
 * floor, carried on four joists and four struts whose feet stand 2.7 m over
 * the street. A panelled kick, then the dark room behind a lattice screen
 * with sashes over it, a frieze of dentils and a hood. Visual only — it
 * overhangs a street a body walks under, and from inside it is the room's
 * one big opening, drawn as a niche.
 */
function shanasheel(lay: Lay, k: House): void {
  const { w, d, ys, wallTop, rnd } = k;
  const OW = orielW(w);
  const P = 0.62;
  const F = -d / 2;
  const zO = (o: number): number => F - o;
  const yb = ys[1] - 0.05;
  const yt = Math.min(wallTop - 0.42, yb + 2.5);
  const sb = lay.sb;
  const beam = lay.m(PALM_BEAM);
  // Its floor, the joists carrying it out of the wall, the struts under them.
  sb.box(OW + 0.1, 0.14, P, 0, yb - 0.07, zO(P / 2), PALM_BEAM, undefined, HIDE_PZ);
  for (const x of [-(OW / 2 - 0.2), -OW * 0.2, OW * 0.2, OW / 2 - 0.2]) {
    sb.box(0.12, 0.14, P + 0.1, x, yb - 0.21, zO((P + 0.1) / 2), PALM_BEAM, undefined, HIDE_PZ);
    log(beam, [x, yb - 0.9, F - 0.01], [x, yb - 0.27, zO(P - 0.02)], 0.05, 4);
    sb.onFace("-z", d / 2, x, yb - 0.93, 0.18, 0.1, 0.07, 0.035, MUDBRICK_DARK, 0, 0, hideBack("-z"));
  }
  // The kick: a panel across the front and the two ends, raised panels on it.
  const yk = yb + 0.62;
  sb.box(OW, yk - yb, 0.05, 0, (yb + yk) / 2, zO(P - 0.025), PALM_BEAM, undefined, HIDE_PZ | HIDE_DOWN);
  for (const e of [-1, 1]) sb.box(0.05, yk - yb, P - 0.05, e * (OW / 2 - 0.025), (yb + yk) / 2, zO((P - 0.05) / 2), PALM_BEAM, undefined, HIDE_DOWN);
  const nb = Math.max(3, Math.round(OW / 0.6));
  const bay = (OW - 0.08) / nb;
  for (let i = 0; i < nb; i++) {
    sb.box(bay - 0.14, yk - yb - 0.2, 0.02, -OW / 2 + 0.04 + (i + 0.5) * bay, (yb + yk) / 2, zO(P + 0.01), TEAK, undefined, HIDE_PZ);
  }
  // The band: the room behind, its posts, the rail, lattice under, sashes over.
  const yh = yt - 0.42;
  const bh = yh - yk;
  const yr = yk + bh * 0.58;
  sb.box(OW - 0.1, bh, P - 0.12, 0, (yk + yh) / 2, zO((P - 0.12) / 2), WINDOW_VOID, undefined, HIDE_PZ | HIDE_DOWN | HIDE_UP);
  for (let i = 0; i <= nb; i++) {
    sb.box(0.08, bh, 0.08, -OW / 2 + 0.04 + i * bay, (yk + yh) / 2, zO(P - 0.04), PALM_BEAM, undefined, HIDE_DOWN | HIDE_UP);
  }
  for (const e of [-1, 1]) sb.box(0.08, bh, 0.08, e * (OW / 2 - 0.04), (yk + yh) / 2, zO(0.04), PALM_BEAM, undefined, HIDE_DOWN | HIDE_UP);
  sb.box(OW, 0.07, 0.07, 0, yr, zO(P - 0.035), PALM_BEAM);
  const lost = Math.floor(rnd() * nb * 2);
  const nh = Math.max(2, Math.round((yr - yk) / 0.1));
  for (let i = 0; i < nb; i++) {
    const x0 = -OW / 2 + 0.08 + i * bay;
    const x1 = x0 + bay - 0.08;
    if (i !== lost) {
      const nv = Math.max(2, Math.round((x1 - x0) / 0.1));
      for (let j = 1; j < nv; j++) sb.box(0.022, yr - yk - 0.035, 0.02, x0 + (j * (x1 - x0)) / nv, (yk + yr) / 2, zO(P - 0.05), TEAK, undefined, HIDE_PZ);
      for (let j = 1; j < nh; j++) sb.box(x1 - x0, 0.022, 0.02, (x0 + x1) / 2, yk + (j * (yr - yk)) / nh, zO(P - 0.07), TEAK, undefined, HIDE_PZ);
    }
    sb.box(0.035, yh - yr, 0.03, (x0 + x1) / 2, (yr + yh) / 2, zO(P - 0.05), PALM_BEAM, undefined, HIDE_PZ);
    sb.box(x1 - x0, 0.035, 0.03, (x0 + x1) / 2, (yr + yh) / 2, zO(P - 0.05), PALM_BEAM, undefined, HIDE_PZ);
  }
  // Its ends: a screen of the same, three uprights and the rails.
  for (const e of [-1, 1]) {
    const x = e * (OW / 2 - 0.03);
    for (const o of [0.2, 0.32, 0.44]) sb.box(0.02, yr - yk - 0.035, 0.022, x, (yk + yr) / 2, zO(o), TEAK);
    for (let j = 1; j < nh; j++) sb.box(0.02, 0.022, P - 0.12, x, yk + (j * (yr - yk)) / nh, zO(P / 2), TEAK);
    sb.box(0.03, 0.035, P - 0.1, x, (yr + yh) / 2, zO(P / 2), PALM_BEAM);
  }
  // The frieze, its dentils and the hood.
  sb.box(OW, 0.2, 0.05, 0, yh + 0.1, zO(P - 0.025), PALM_BEAM, undefined, HIDE_PZ);
  for (const e of [-1, 1]) sb.box(0.05, 0.2, P - 0.05, e * (OW / 2 - 0.025), yh + 0.1, zO((P - 0.05) / 2), PALM_BEAM);
  const nd = Math.round(OW / 0.16);
  for (let i = 0; i < nd; i++) sb.box(0.06, 0.07, 0.06, -OW / 2 + (i + 0.5) * (OW / nd), yh + 0.165, zO(P + 0.03), TEAK, undefined, HIDE_PZ);
  sb.box(OW + 0.36, 0.09, P + 0.24, 0, yh + 0.245, zO((P + 0.24) / 2), PALM_BEAM, undefined, HIDE_PZ);
  sb.box(OW + 0.36, 0.12, 0.03, 0, yh + 0.14, zO(P + 0.225), PALM_BEAM, undefined, HIDE_PZ);
  for (const e of [-1, 1]) sb.box(0.03, 0.12, P + 0.24, e * (OW / 2 + 0.165), yh + 0.14, zO((P + 0.24) / 2), PALM_BEAM);
  // From inside: the opening into it.
  const s2: Side = "+z";
  const inner = -(d / 2 - T);
  const b2 = hideBack(s2);
  sb.onFace(s2, inner, 0, ys[1] + 1.05, OW - 0.3, 1.9, 0.02, 0.01, WINDOW_VOID, 0, 0, b2);
  for (const e of [-1, 1]) sb.onFace(s2, inner, (e * (OW - 0.2)) / 2, ys[1] + 1.05, 0.1, 1.9, 0.05, 0.025, PALM_BEAM, 0, 0, b2);
  sb.onFace(s2, inner, 0, ys[1] + 2.05, OW, 0.14, 0.08, 0.04, PALM_BEAM, 0, 0, b2);
}

// --- the barjeel -----------------------------------------------------------------

/** The barjeel's four faces as elevations of the house: each one's plane and centre along it. */
function towerFaces(k: House): { s: Side; plane: number; u: number }[] {
  const h = k.S / 2;
  return [
    { s: "-z", plane: h - k.tz, u: k.tx },
    { s: "+z", plane: h + k.tz, u: k.tx },
    { s: "-x", plane: h - k.tx, u: k.tz },
    { s: "+x", plane: h + k.tx, u: k.tz },
  ];
}

/**
 * The barjeel. The shaft: a foot course, corner and middle pilasters with a
 * pointed head to each panel, a band at two fifths, putlog holes, the poles
 * still standing in some, a vent low on two faces and the sill course at the
 * collider's head. The head over it: corner piers and two mullions a face —
 * three slots — the X-shaped partition between them, a palm lintel over the
 * slots, a band with a frieze of niches and a row of poles, the cap, the
 * merlons and the pinnacles. An aerial strapped up its back.
 */
function tower(lay: Lay, k: House): void {
  const { tx, tz, S, head, roofY, skin, rnd } = k;
  const sb = lay.sb;
  const h = S / 2;
  const beam = lay.m(PALM_BEAM);
  sb.box(S + 0.12, 0.3, S + 0.12, tx, roofY + 0.15, tz, MUDBRICK_DARK, undefined, HIDE_DOWN);
  const pil = 0.4;
  const mul = 0.22;
  const yA = roofY + 0.3;
  const yB = head - 0.22;
  const pw = (S - 2 * pil - mul) / 2;
  const yM = yA + (yB - yA) * 0.42;
  const yP = yA + (yB - yA) * 0.66;
  for (const f of towerFaces(k)) {
    const back = hideBack(f.s);
    for (const e of [-1, 1]) sb.onFace(f.s, f.plane, f.u + e * (h - pil / 2), (yA + yB) / 2, pil, yB - yA, 0.06, 0.03, skin, 0, 0, back);
    sb.onFace(f.s, f.plane, f.u, (yA + yB) / 2, mul, yB - yA, 0.06, 0.03, skin, 0, 0, back);
    for (const e of [-1, 1]) {
      const uc = f.u + e * (mul / 2 + pw / 2);
      const span = pw - 0.1;
      const rise = span * 0.62;
      const spring = yB - 0.06 - rise - 0.05;
      archRing(lay, f.s, f.plane, uc, spring, span, rise, 0.1, 0.06, 0.03, skin);
      // The putlog holes the scaffold left, one or two a lift.
      for (let y = yA + 1.3; y < spring - 0.25; y += 0.92) {
        if (Math.abs(y - yM) < 0.2 || Math.abs(y - yP) < 0.2) continue;
        sb.onFace(f.s, f.plane, uc + (rnd() - 0.5) * 0.3, y, 0.09, 0.09, 0.01, 0.005, WINDOW_VOID, 0, 0, back);
      }
    }
    // The poles still in it, through the pilasters.
    for (const e of [-1, 1]) {
      if (rnd() < 0.3) continue;
      const u = f.u + e * (h - pil / 2);
      log(beam, fp(f.s, f.plane, u, yP, -0.1), fp(f.s, f.plane, u + (rnd() - 0.5) * 0.04, yP + (rnd() - 0.5) * 0.04, 0.3 + rnd() * 0.12), 0.05, 4);
    }
    // A vent low on the two ends, where the cool air came out into the room
    // below before the roof was laid over it.
    if (f.s === "-x" || f.s === "+x") {
      const uc = f.u - (mul / 2 + pw / 2);
      const vy = roofY + 0.95;
      sb.onFace(f.s, f.plane, uc, vy, 0.4, 0.58, 0.02, 0.01, WINDOW_VOID, 0, 0, back);
      for (const e of [-1, 1]) sb.onFace(f.s, f.plane, uc + e * 0.25, vy + 0.04, 0.1, 0.66, 0.06, 0.03, MUDBRICK_DARK, 0, 0, back);
      sb.onFace(f.s, f.plane, uc, vy - 0.33, 0.6, 0.08, 0.12, 0.06, MUDBRICK_DARK, 0, 0, back);
      for (const e of [-1, 1]) sb.onFace(f.s, f.plane, uc + e * 0.1, vy, 0.03, 0.56, 0.03, 0.04, IRON, 0, 0, back);
    }
    pocks(lay, f.s, f.plane, f.u - h + 0.3, f.u + h - 0.3, yA + 0.4, yB - 0.3, 5, rnd);
  }
  sb.box(S + 0.16, 0.12, S + 0.16, tx, yM, tz, MUDBRICK_DARK);
  // The sill course at the collider's head, standing 2 cm over it so the
  // slots' sills are not a plane shared with anything.
  sb.box(S + 0.14, 0.24, S + 0.14, tx, head - 0.1, tz, MUDBRICK_DARK);
  const hb = head + 0.02;
  sb.box(S - 0.3, 0.01, S - 0.3, tx, hb + 0.005, tz, WINDOW_VOID, undefined, TOP_ONLY);

  // The head: corner piers, mullions, the partition, the lintels.
  const OH = 1.2;
  const cw = 0.42;
  for (const ex of [-1, 1]) {
    for (const ez of [-1, 1]) {
      sb.box(cw, OH, cw, tx + ex * (h - cw / 2), hb + OH / 2, tz + ez * (h - cw / 2), skin, undefined, HIDE_DOWN);
    }
  }
  for (const f of towerFaces(k)) {
    for (const e of [-1, 1]) sb.onFace(f.s, f.plane, f.u + e * S * 0.13, hb + OH / 2, 0.15, OH, 0.3, -0.15, skin, 0, 0, HIDE_DOWN);
    sb.onFace(f.s, f.plane, f.u, hb + OH - 0.06, S - 2 * cw, 0.12, 0.3, -0.15, PALM_BEAM, 0, 0, 0);
  }
  const L = (S - cw) * Math.SQRT2;
  for (const a of [Math.PI / 4, -Math.PI / 4]) sb.box(0.08, OH, L, tx, hb + OH / 2, tz, skin, { y: a }, HIDE_DOWN);

  // The band, its niches and its poles; the cap; the crest.
  const hc = hb + OH;
  const BH = 0.28;
  sb.box(S + 0.06, BH, S + 0.06, tx, hc + BH / 2, tz, skin);
  for (const f of towerFaces(k)) {
    const pl = f.plane + 0.03;
    for (const t of [-0.3, -0.1, 0.1, 0.3]) {
      const uu = f.u + t * S;
      slabOn(lay, f.s, pl, [[uu - 0.06, hc + 0.07], [uu + 0.06, hc + 0.07], [uu + 0.06, hc + 0.15], [uu, hc + 0.22], [uu - 0.06, hc + 0.15]], 0, 0.012, WINDOW_VOID);
    }
    for (const t of [-0.2, 0, 0.2]) {
      const uu = f.u + t * S;
      log(beam, fp(f.s, pl, uu, hc + 0.15, -0.1), fp(f.s, pl, uu + (rnd() - 0.5) * 0.04, hc + 0.15 + (rnd() - 0.5) * 0.03, 0.3 + rnd() * 0.1), 0.045, 4);
    }
  }
  const hk = hc + BH;
  sb.box(S + 0.26, 0.1, S + 0.26, tx, hk + 0.05, tz, MUDBRICK_DARK);
  for (const f of towerFaces(k)) merlons(lay, f.s, f.plane + 0.13, f.u, S - 0.4, hk + 0.1, 0.08, skin);
  for (const ex of [-1, 1]) {
    for (const ez of [-1, 1]) {
      const x = tx + ex * (h - 0.02);
      const z = tz + ez * (h - 0.02);
      sb.box(0.32, 0.44, 0.32, x, hk + 0.1 + 0.22, z, skin, undefined, HIDE_DOWN);
      sb.box(0.2, 0.22, 0.2, x, hk + 0.54 + 0.11, z, skin, undefined, HIDE_DOWN);
      sb.box(0.26, 0.05, 0.26, x, hk + 0.785, z, MUDBRICK_DARK);
    }
  }

  // The aerial, strapped up the back face by the +X corner: a mast, its two
  // straps, a boom over the crest and its elements.
  const ax = tx + h - 0.24;
  const az = tz + h + 0.2;
  const a0 = yM + 0.2;
  const a1 = hk + 1.5;
  sb.box(0.04, a1 - a0, 0.04, ax, (a0 + a1) / 2, az, IRON);
  for (const y of [yM + 0.4, yB - 0.3]) sb.onFace("+z", h + tz, ax, y, 0.12, 0.06, 0.22, 0.11, IRON, 0, 0, hideBack("+z"));
  const yaw = (rnd() - 0.5) * 0.8;
  sb.box(1.0, 0.03, 0.03, ax, a1 - 0.08, az, IRON, { y: yaw });
  for (let i = 0; i < 5; i++) {
    const t = -0.42 + i * 0.21;
    sb.box(0.02, 0.02, 0.52 - i * 0.06, ax + Math.cos(yaw) * t, a1 - 0.08, az - Math.sin(yaw) * t, IRON, { y: yaw });
  }
}

// --- the deck ----------------------------------------------------------------------

/**
 * The roof as a yard: the household's bedding on a mat along the back
 * parapet, where it sleeps out the summer — a mattress, a pillow and a
 * rolled quilt, none higher than a step — two water pots in a corner, and
 * lobes of new mud where it has been patched over the shelling.
 */
function deck(lay: Lay, k: House): void {
  const { rnd, roofY, d, w, climbs, edge, tx, tz, S } = k;
  const x0 = -w / 2 + PARAPET_T + 0.35;
  const x1 = climbs ? edge - 0.35 : edge - PARAPET_T - 0.35;
  const z0 = -d / 2 + PARAPET_T + 0.35;
  const z1 = d / 2 - PARAPET_T - 0.35;
  const clear = (x: number, z: number, r: number): boolean => Math.abs(x - tx) > S / 2 + 0.2 + r || Math.abs(z - tz) > S / 2 + 0.2 + r;
  const sb = lay.sb;
  // The bedding.
  const bz = z1 - 0.6;
  const bx = x0 + 1.2 + rnd() * Math.max(0, x1 - x0 - 2.4);
  sb.box(2.2, 0.015, 1.2, bx, roofY + 0.0075, bz, SANDBAG, undefined, HIDE_DOWN);
  sb.box(1.9, 0.1, 0.8, bx, roofY + 0.065, bz, CLOTH, undefined, HIDE_DOWN);
  sb.box(0.32, 0.09, 0.6, bx - 0.7, roofY + 0.16, bz, CLOTH, undefined, HIDE_DOWN);
  log(lay.m(SANDBAG), [bx + 0.72, roofY + 0.2, bz - 0.36], [bx + 0.72, roofY + 0.2, bz + 0.36], 0.085, 6);
  // The pots, in whichever front corner the tower leaves free.
  const corner = clear(x0 + 0.3, z0 + 0.3, 0.3) ? [x0 + 0.3, z0 + 0.3] : [x1 - 0.3, z1 - 1.6];
  const pm = lay.m(MUDBRICK);
  for (const [dx, dz, s] of [
    [0, 0, 1],
    [0.42, 0.1, 0.85],
  ] as const) {
    const cx = corner[0] + dx;
    const cz = corner[1] + dz;
    band(pm, 7, 0.2, 0.13 * s, roofY, 0.19 * s, roofY + 0.14 * s, cx, cz);
    band(pm, 7, 0.2, 0.19 * s, roofY + 0.14 * s, 0.09 * s, roofY + 0.26 * s, cx, cz);
    band(pm, 7, 0.2, 0.1 * s, roofY + 0.26 * s, 0.1 * s, roofY + 0.29 * s, cx, cz);
    disc(pm, 7, 0.2, 0.1 * s, 0.07 * s, roofY + 0.29 * s, true, cx, cz);
    disc(lay.m(WINDOW_VOID), 7, 0.2, 0.07 * s, 0, roofY + 0.27 * s, true, cx, cz);
  }
  // The patches, kept off the bedding and the tower.
  const m = lay.m(MUDBRICK_DARK);
  const n = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const cx = x0 + 0.9 + rnd() * Math.max(0, x1 - x0 - 1.8);
    const cz = z0 + 0.9 + ((i + rnd()) / n) * Math.max(0, z1 - z0 - 1.8);
    if (!clear(cx, cz, 0.9)) continue;
    if (Math.abs(cx - bx) < 2.0 && cz > bz - 1.5) continue;
    const lobes = 2 + Math.floor(rnd() * 2);
    for (let j = 0; j < lobes; j++) {
      const r = 0.3 + rnd() * 0.35;
      lobe(m, cx + (rnd() - 0.5) * 0.7, roofY + 0.025 + j * 0.002, cz + (rnd() - 0.5) * 0.7, r * (1.1 + rnd() * 0.5), r, rnd() * Math.PI * 2, rnd);
    }
  }
}

// --- inside ----------------------------------------------------------------------

/**
 * Inside: under every slab its palm joists on two girders — and a trimmer
 * along the stair shaft — every one at least 2.4 m over its floor; on every
 * floor a rug with a tray on it and a run of cushions along the -X end; and
 * every window's niche, so a room has the windows its walls have outside.
 */
function interior(lay: Lay, k: House, wins: Win[]): void {
  const { w, d, floors, ys, climbs, edge, rnd } = k;
  const sb = lay.sb;
  const xi0 = -w / 2 + T;
  const xi1 = climbs ? edge : w / 2 - T;
  const zi = d / 2 - T;
  for (let f = 1; f <= floors; f++) {
    const under = ys[f] - SLAB;
    for (let z = -zi + 0.35; z < zi - 0.2; z += 0.56) {
      sb.box(xi1 - xi0, 0.13, 0.13, (xi0 + xi1) / 2, under - 0.065, z, PALM_BEAM, { x: (rnd() - 0.5) * 0.02 }, HIDE_UP);
    }
    for (const t of [1 / 3, 2 / 3]) sb.box(0.26, 0.28, 2 * zi, xi0 + (xi1 - xi0) * t, under - 0.13 - 0.14, 0, TEAK, undefined, HIDE_UP);
    if (climbs) sb.box(0.22, 0.3, 2 * zi, edge - 0.11, under - 0.15, 0, TEAK, undefined, HIDE_UP);
  }
  for (let f = 0; f < floors; f++) {
    const fy = ys[f];
    // A rug, off the door's path on the ground floor, and a tray on it.
    const rx = (xi0 + xi1) / 2 - 0.6 + rnd() * 1.2;
    const rz = f === 0 ? zi * 0.35 + rnd() * zi * 0.2 : (rnd() - 0.5) * zi * 0.6;
    const ra = 2.2 + rnd() * 0.6;
    const rb = 1.5 + rnd() * 0.3;
    rug(lay, rx, fy, rz, ra, rb);
    const tm = lay.m(PALM_BEAM);
    band(tm, 6, 0, 0.16, fy + 0.016, 0.1, fy + 0.2, rx, rz);
    band(lay.m(ALLOY), 12, 0, 0.36, fy + 0.2, 0.38, fy + 0.24, rx, rz);
    disc(lay.m(ALLOY), 12, 0, 0.38, 0, fy + 0.24, true, rx, rz);
    // The cushions along the -X end: a mattress a hand high, the bolsters
    // against the wall no deeper than a body keeps from it.
    const len = Math.min(4.2, 2 * zi - 2.4);
    const cz = (rnd() - 0.5) * (2 * zi - 2.4 - len);
    sb.box(0.62, 0.1, len, xi0 + 0.33, fy + 0.05, cz, CLOTH, undefined, HIDE_DOWN);
    const nc = Math.max(3, Math.round(len / 0.7));
    for (let i = 0; i < nc; i++) {
      sb.box(0.18, 0.4, len / nc - 0.04, xi0 + 0.1, fy + 0.1 + 0.2, cz - len / 2 + (i + 0.5) * (len / nc), SANDBAG, { z: 0.08 }, HIDE_DOWN);
    }
  }
  for (const wn of wins) innerWindow(lay, k, wn);
}

/** A rug: a field, a border and a medallion, each a few millimetres over the last. */
function rug(lay: Lay, x: number, y: number, z: number, a: number, b: number): void {
  const sb = lay.sb;
  sb.box(a, 0.01, b, x, y + 0.005, z, SANDBAG, undefined, TOP_ONLY);
  for (const e of [-1, 1]) {
    sb.box(a, 0.004, 0.1, x, y + 0.012, z + e * (b / 2 - 0.08), PALM_BEAM, undefined, TOP_ONLY);
    sb.box(0.1, 0.004, b - 0.26, x + e * (a / 2 - 0.08), y + 0.012, z, PALM_BEAM, undefined, TOP_ONLY);
  }
  sb.box(0.5, 0.004, 0.5, x, y + 0.012, z, PALM_BEAM, { y: Math.PI / 4 }, TOP_ONLY);
  sb.box(0.24, 0.004, 0.24, x, y + 0.016, z, SCORCH, { y: Math.PI / 4 }, TOP_ONLY);
}

/**
 * A window's inside: its niche in the wall's inner face, a sill board and a
 * lintel — none in the stair shaft, which has no room behind it.
 */
function innerWindow(lay: Lay, k: House, wn: Win): void {
  if (k.climbs && wn.s !== "-x" && wn.u + wn.ww / 2 > k.edge - 0.3) return;
  const s = opp(wn.s);
  const pl = -(wn.plane - T);
  const back = hideBack(s);
  const sb = lay.sb;
  const yc = wn.sill + wn.wh / 2;
  sb.onFace(s, pl, wn.u, yc, wn.ww + 0.1, wn.wh + 0.1, 0.02, 0.01, WINDOW_VOID, 0, 0, back);
  sb.onFace(s, pl, wn.u, wn.sill - 0.08, wn.ww + 0.3, 0.06, 0.12, 0.06, PALM_BEAM, 0, 0, back);
  sb.onFace(s, pl, wn.u, wn.sill + wn.wh + 0.13, wn.ww + 0.5, 0.14, 0.08, 0.04, PALM_BEAM, 0, 0, back);
}
