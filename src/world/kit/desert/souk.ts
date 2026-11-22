/**
 * kit/desert/souk.ts — buildSouk: the souk arcade, a market hall of
 * mud-brick piers carrying palm girders and a ceiling of poles and reed
 * mats under a walked mud roof, open to the street under framed awnings
 * and blind at its back behind the stair lane. Part of the desert-town set:
 * follows the contract in kit/core.ts and the set's rules in `./index.ts`.
 * Invariants: every collider byte for byte and in its order — the plinth,
 * the flight, the piers, the blind wall, the roof, the parapets — restated
 * at the top; variation comes from the params, never `Math.random()`.
 * Never imports another builder.
 */
import { CONFIG } from "../../../config";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import { mulberry32 } from "../../rng";
import { marksSway } from "../../sway";
import {
  ALLOY,
  AWNING,
  Build,
  IRON,
  TEAK,
  hideBack,
  type BuildParams,
  type Side,
  type Structure,
  type V3,
} from "../core";
import {
  MUDBRICK,
  MUDBRICK_DARK,
  ROOF_MUD,
  PALM_BEAM,
  SANDBAG,
  SCORCH,
  CLOTH,
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
import {
  HIDE_DOWN,
  Lay,
  TAU,
  band,
  blindBay,
  cornice,
  disc,
  eye,
  lobe,
  log,
  pocks,
  socle,
  spout,
  triangles,
} from "./lay";

/** The awnings' two cloths, taken in turn down the arcade. */
const AWNING_CLOTHS = ["#a8703f", "#8d6a4a"] as const;
/** Only the up face of a box: a joint drawn on a floor. */
const TOP_ONLY = 0b111011;
/** A pole's faces against the mat over it and the girders at its ends. */
const POLE_HIDE = (1 << 2) | (1 << 4) | (1 << 5);

/**
 * The souk arcade: a market hall with a walked roof, running along Z.
 *
 * ## What it is FOR
 *
 * It runs along Z because the STAIR does — `Build.flight` climbs in Z, and a
 * market hall wide enough to hold a flight across its width would be a hall
 * rather than an arcade. The layout turns it.
 *
 * Open on its long front and its two ends at ground level, so the arcade is
 * a covered street you shoot along and across, with one of the best
 * positions in the town over it. The awnings between the piers are
 * `translucentBox` — the one place on this map the sun comes THROUGH
 * something, which is most of what makes a market read as a market.
 *
 * ## What it is drawn as
 *
 * A market hall of the late Ottoman town, built as the river provinces built
 * anything that had to span: mud-brick piers on dark footings, each under an
 * impost and a stepped palm-wood bolster, carrying a palm beam down each row;
 * a girder across the hall at every pair of piers, its end showing through
 * the front beam between two iron straps; and between the girders the
 * ceiling of the region — dark poles laid close under a reed mat, under the
 * mud of the roof. The floor is flagged, and the hall is in TRADE: reed mats
 * with baskets of grain and spice heaped over their rims, sacks, folded and
 * rolled carpets and copper ware, carpets hung on the piers, and brass
 * lanterns from the ceiling.
 *
 * The front: a dog-tooth cornice on the roof's edge, a parapet pierced with
 * a row of triangles, palm-log spouts over two piers, and an awning in every
 * bay — a cloth on a timber frame hung off the front beam, held by two iron
 * stays, with a valance of tabs along its edge that the wind takes. The back
 * is the street the lane turns its shoulder to: a socle of dressed stone, a
 * blind arcade of two pointed bays to every bay of the hall with a grilled
 * window through every other pair, the cornice carried round, and the town's
 * one luxury — a power line on insulators with its meter, and a dish on the
 * parapet. The plinth is faced in stone all round.
 *
 * ## The colliders, which are unchanged
 *
 * The plinth, the flight and its landing (`laneFlight`, still called), the
 * piers pair by pair, the blind wall, the roof, the +X parapet over the
 * blind wall, then `parapetOpenX`'s three runs — restated below exactly as
 * they were first emitted. Everything after that block is DRAWING and keeps
 * to the three rules: on a face (the carpets, the blind arcade, the cornice,
 * the cable), low enough to step over (the flags, the mats and everything on
 * them, the pier footings), or overhead or standing on a collider (the
 * girders, ceiling and lanterns, every lantern's foot over 2.4 m of floor;
 * the awnings, whose valance stops 2.4 m over the street; the bolsters on
 * the piers' heads, which reach half a metre past each pier at 2.3 m, as
 * the khan's riwaq brackets do). The roof is drawn without its underside,
 * which the ceiling covers, and the ceiling is emitted after it. The
 * flags are JOINTS on the plinth's own top, 6 mm proud, so the Souk flag's
 * capture ring, which crosses two of these plinths, still lies over them.
 */
export function buildSouk(
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(mats, "souk");
  const len = p.length ?? 30;
  const w = p.width ?? 11;
  const ys = levels(1, STOREY);
  const roofY = ys[1];
  const wallTop = roofY - SLAB;
  const { plateW, plateX } = laneGeom(w);
  const side = (p.rampSide ?? -1) === 1 ? 1 : -1;
  assertClimbable("souk", len, roofY - ys[0]);
  const rnd = mulberry32(Math.floor(clothHash(len, w, side, 5) * 0x7fffffff));

  // --- the colliders, restated in their order ----------------------------------
  b.block({ w: w + 0.6, h: PLINTH, d: len + 0.6, x: 0, y: PLINTH / 2, z: 0 });
  laneFlight(b, w, len, ys[0], roofY, side, PALM_BEAM);
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
  const pierZ: number[] = [];
  const rowX = [-1, 1].map((sx) => plateX + (sx * (plateW - 0.7)) / 2);
  for (let i = 0; i <= bays; i++) {
    const z = -len / 2 + (i / bays) * len;
    pierZ.push(z);
    for (const x of rowX) b.block({ w: 0.7, h: pierH, d: 0.7, x, y: PLINTH + pierH / 2, z });
  }
  b.block({ w: T, h: pierH, d: len, x: (w - T) / 2, y: PLINTH + pierH / 2, z: 0 });
  b.block({ w: plateW, h: SLAB, d: len, x: plateX, y: roofY - SLAB / 2, z: 0 });
  b.block({ w: PARAPET_T, h: PARAPET, d: len, x: (w - PARAPET_T) / 2, y: roofY - SLAB + PARAPET / 2, z: 0 });
  // `parapetOpenX`'s three: the two ends, then the front.
  for (const sz of [-1, 1] as const) {
    b.block({ w: plateW, h: PARAPET, d: PARAPET_T, x: plateX, y: roofY + PARAPET / 2, z: (sz * (len - PARAPET_T)) / 2 });
  }
  const runD = len - 2 * PARAPET_T;
  const frontX = plateX - (plateW - PARAPET_T) / 2;
  b.block({ w: PARAPET_T, h: PARAPET, d: runD, x: frontX, y: roofY + PARAPET / 2, z: 0 });

  // --- the drawing ---------------------------------------------------------------
  const k: Souk = {
    len,
    w,
    roofY,
    wallTop,
    beamLo: roofY - SLAB - 0.22 - 0.225,
    xo: rowX[0],
    xi: rowX[1],
    edge: plateX + plateW / 2,
    pierZ,
    rnd,
  };
  const lay = new Lay();
  piers(lay, k);
  floor(lay, k);
  front(lay, k);
  back(lay, k);
  ends(lay, k);
  roof(lay, k);
  awnings(b, lay, k);
  lay.flush(b);
  dish(b, k);
  // Washing over one end's parapet, the set's one moving colour.
  const dz = rnd() < 0.5 ? -1 : 1;
  const dx = -w / 2 + 1.2 + rnd() * (k.edge - (-w / 2) - 3.2);
  drape(b, 1.6, 0.95, dx, roofY + PARAPET, dz * (len / 2), dz as 1 | -1, clothHash(len, w, side, 9));

  // --- the masses, after what is laid on them ------------------------------------
  b.box(w + 0.6, PLINTH, len + 0.6, 0, PLINTH / 2, 0, MUDBRICK_DARK);
  for (const z of pierZ) for (const x of rowX) b.box(0.7, pierH, 0.7, x, PLINTH + pierH / 2, z, MUDBRICK);
  b.box(T, pierH, len, (w - T) / 2, PLINTH + pierH / 2, 0, MUDBRICK);
  // The beam the roof sits on down each row of piers.
  for (const x of rowX) b.box(0.9, 0.45, len, x, roofY - SLAB - 0.22, 0, PALM_BEAM);
  // The roof, without its underside: the ceiling covers every metre of it,
  // and is emitted LAST, so from the roof it is the ceiling the depth test
  // rejects rather than the slab that is drawn over a shaded ceiling.
  const slab = new Lay();
  slab.sb.box(plateW, SLAB, len, plateX, roofY - SLAB / 2, 0, ROOF_MUD, undefined, HIDE_DOWN);
  slab.flush(b);
  b.box(PARAPET_T, PARAPET, len, (w - PARAPET_T) / 2, roofY - SLAB + PARAPET / 2, 0, MUDBRICK);
  b.box(PARAPET_T + 0.16, 0.14, len, (w - PARAPET_T) / 2, roofY - SLAB + PARAPET + 0.07, 0, MUDBRICK_DARK);
  for (const sz of [-1, 1] as const) {
    const z = (sz * (len - PARAPET_T)) / 2;
    b.box(plateW, PARAPET, PARAPET_T, plateX, roofY + PARAPET / 2, z, MUDBRICK);
    b.box(plateW + 0.16, 0.14, PARAPET_T + 0.16, plateX, roofY + PARAPET + 0.07, z, MUDBRICK_DARK);
  }
  b.box(PARAPET_T, PARAPET, runD, frontX, roofY + PARAPET / 2, 0, MUDBRICK);
  b.box(PARAPET_T + 0.16, 0.14, runD, frontX, roofY + PARAPET + 0.07, 0, MUDBRICK_DARK);
  const under = new Lay();
  ceiling(under, k);
  under.flush(b);
  return b;
}

/** What the drawing's parts are measured by. */
interface Souk {
  len: number;
  w: number;
  roofY: number;
  /** The roof slab's soffit, and every pier's head. */
  wallTop: number;
  /** The underside of the beam down each row of piers. */
  beamLo: number;
  /** The front (-X) and back (+X) rows of piers. */
  xo: number;
  xi: number;
  /** The roof's +X edge, where the stair lane begins. */
  edge: number;
  pierZ: number[];
  rnd: () => number;
}

// --- the structure ----------------------------------------------------------------

/**
 * Every pier: a dark footing with a step on it, an impost under its head,
 * and a palm-wood bolster in two steps under the beam, cut short where the
 * beam ends. A pier proud of the roof's end gets a dark cap where nothing
 * stands on it.
 */
function piers(lay: Lay, k: Souk): void {
  const hl = k.len / 2;
  for (const x of [k.xo, k.xi]) {
    for (const z of k.pierZ) {
      lay.sb.box(0.86, 0.3, 0.86, x, PLINTH + 0.15, z, MUDBRICK_DARK, undefined, HIDE_DOWN);
      lay.sb.box(0.78, 0.07, 0.78, x, PLINTH + 0.335, z, MUDBRICK_DARK, undefined, HIDE_DOWN);
      lay.sb.box(0.84, 0.1, 0.84, x, k.beamLo - 0.21, z, MUDBRICK_DARK);
      const z0 = Math.max(-hl, z - 0.55);
      const z1 = Math.min(hl, z + 0.55);
      lay.sb.box(0.5, 0.08, z1 - z0, x, k.beamLo - 0.12, (z0 + z1) / 2, PALM_BEAM);
      const z2 = Math.max(-hl, z - 0.85);
      const z3 = Math.min(hl, z + 0.85);
      lay.sb.box(0.56, 0.08, z3 - z2, x, k.beamLo - 0.04, (z2 + z3) / 2, PALM_BEAM);
      if (Math.abs(z) + 0.35 > hl) {
        const sz = Math.sign(z);
        lay.sb.box(0.8, 0.12, 0.4, x, k.wallTop + 0.06, sz * (hl + 0.2), MUDBRICK_DARK, undefined, HIDE_DOWN);
      }
    }
  }
}

/**
 * Where each girder stands: on its pair of piers, the end ones flush with
 * the roof's ends — the roof has no underside, and they close it.
 */
function girderZ(k: Souk): number[] {
  return k.pierZ.map((z) => Math.max(-k.len / 2 + 0.15, Math.min(k.len / 2 - 0.15, z)));
}

/**
 * The ceiling: a palm girder across the hall at every pair of piers, framed
 * into both beams, its ends showing through them; and in every bay the poles
 * laid close under a reed mat — the ceiling of every mud roof between the
 * rivers, and dark against light, which is what reads from the floor.
 * Lanterns hang from it in brass with dark glass, their feet over 2.4 m.
 */
function ceiling(lay: Lay, k: Souk): void {
  const { wallTop, rnd } = k;
  const gx0 = k.xo + 0.45;
  const gx1 = k.xi - 0.45;
  const gm = (gx0 + gx1) / 2;
  const gz = girderZ(k);
  for (const z of gz) {
    lay.sb.box(gx1 - gx0, 0.32, 0.3, gm, wallTop - 0.16, z, PALM_BEAM, undefined, 1 << 2);
    // Its ends through the beams: into the street, and into the lane.
    lay.sb.onFace("-x", -(k.xo - 0.45), z, wallTop - 0.17, 0.26, 0.28, 0.16, 0.08, PALM_BEAM, 0, 0, hideBack("-x"));
    lay.sb.onFace("+x", k.xi + 0.45, z, wallTop - 0.17, 0.26, 0.28, 0.16, 0.08, PALM_BEAM, 0, 0, hideBack("+x"));
  }
  const n = Math.round((gx1 - gx0) / 0.27);
  for (let i = 0; i + 1 < gz.length; i++) {
    const za = gz[i] + 0.15;
    const zb = gz[i + 1] - 0.15;
    const zm = (za + zb) / 2;
    lay.sb.box(gx1 - gx0, 0.014, zb - za, gm, wallTop - 0.007, zm, SANDBAG, undefined, 1 << 2);
    for (let j = 0; j < n; j++) {
      const d = 0.085 + rnd() * 0.04;
      const x = gx0 + ((j + 0.5) * (gx1 - gx0)) / n + (rnd() - 0.5) * 0.03;
      lay.sb.box(d, d, zb - za, x, wallTop - 0.014 - d / 2, zm, TEAK, undefined, POLE_HIDE);
    }
    if (i % 2 === 0) lantern(lay, gm + (rnd() - 0.5) * 1.2, wallTop - 0.014, zm + (rnd() - 0.5) * 0.8);
  }
}

/** A brass lantern on a chain from the ceiling at `y`, its foot 0.48 m under it. */
function lantern(lay: Lay, x: number, y: number, z: number): void {
  const foot = y - 0.48;
  lay.sb.box(0.025, 0.2, 0.025, x, y - 0.1, z, IRON, undefined, HIDE_DOWN);
  lay.sb.box(0.16, 0.06, 0.16, x, foot + 0.27, z, ALLOY, { y: Math.PI / 4 });
  lay.sb.box(0.2, 0.025, 0.2, x, foot + 0.235, z, ALLOY);
  lay.sb.box(0.16, 0.18, 0.16, x, foot + 0.13, z, WINDOW_VOID, undefined, (1 << 2) | (1 << 3));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) lay.sb.box(0.025, 0.2, 0.025, x + sx * 0.085, foot + 0.13, z + sz * 0.085, ALLOY, undefined, (1 << 2) | (1 << 3));
  lay.sb.box(0.2, 0.03, 0.2, x, foot + 0.025, z, ALLOY);
}

/**
 * The flagged floor of the hall: joints, never slabs — a second floor layer
 * is a second fill wherever the hall is seen — courses run down the street
 * and broken at random; and the plinth faced in stone all round.
 */
function floor(lay: Lay, k: Souk): void {
  const { rnd, len, w } = k;
  const x0 = k.xo + 0.35;
  const x1 = k.xi - 0.35;
  const cn = Math.round((x1 - x0) / 0.62);
  const cw = (x1 - x0) / cn;
  const y = PLINTH + 0.003;
  for (let c = 1; c < cn; c++) lay.sb.box(0.025, 0.006, len, x0 + c * cw, y, 0, SCORCH, undefined, TOP_ONLY);
  for (let c = 0; c < cn; c++) {
    let z = -len / 2 + rnd() * 0.5;
    while (z < len / 2 - 0.2) {
      lay.sb.box(cw - 0.03, 0.006, 0.025, x0 + (c + 0.5) * cw, y, z, SCORCH, undefined, TOP_ONLY);
      z += 0.7 + rnd() * 0.5;
    }
  }
  // The plinth's facing, stones lighter than the mortar they are bedded in.
  const sides: { s: Side; plane: number; half: number }[] = [
    { s: "-x", plane: w / 2 + 0.3, half: len / 2 + 0.3 },
    { s: "+x", plane: w / 2 + 0.3, half: len / 2 + 0.3 },
    { s: "-z", plane: len / 2 + 0.3, half: w / 2 + 0.3 },
    { s: "+z", plane: len / 2 + 0.3, half: w / 2 + 0.3 },
  ];
  for (const { s, plane, half } of sides) {
    let u = -half + 0.02;
    while (u < half - 0.1) {
      const l = Math.min(half - u - 0.02, 0.6 + rnd() * 0.5);
      if (l > 0.1) lay.sb.onFace(s, plane, u + l / 2, 0.115, l, 0.2, 0.03, 0.012, MUDBRICK, 0, 0, hideBack(s) | HIDE_DOWN);
      u += l + 0.025;
    }
  }
  goods(lay, k);
}

// --- the trade ----------------------------------------------------------------------

/** What a basket of grain or spice is heaped with. */
const HEAPS = [SANDBAG, AWNING, MUDBRICK_DARK, CLOTH, SCORCH] as const;
/** A carpet's ground. */
const GROUNDS = [AWNING, SCORCH, MUDBRICK_DARK, AWNING] as const;

/**
 * The pitches: in most bays a reed mat by the front row of piers with
 * baskets and sacks on it, and one by the back row with carpets folded,
 * rolled, or copper ware. Everything on the floor stops under 0.3 m, so the
 * hall is still a street a body runs straight through.
 */
function goods(lay: Lay, k: Souk): void {
  const { rnd, pierZ } = k;
  const y0 = PLINTH + 0.012;
  for (let i = 0; i + 1 < pierZ.length; i++) {
    const zc = (pierZ[i] + pierZ[i + 1]) / 2;
    const bay = pierZ[i + 1] - pierZ[i];
    if (rnd() < 0.8) {
      // The grain and spice seller's, by the street.
      const mx = k.xo + 0.35 + 0.85;
      const mz = zc + (rnd() - 0.5) * (bay - 2.4);
      lay.sb.box(1.3, 0.012, 1.9, mx, PLINTH + 0.006, mz, SANDBAG, { y: (rnd() - 0.5) * 0.1 }, HIDE_DOWN);
      const nb = 2 + Math.floor(rnd() * 3);
      for (let j = 0; j < nb; j++) basket(lay, mx + (j % 2 ? 0.27 : -0.27), y0, mz - 0.6 + (Math.floor(j / 2) + 0.5) * 0.55 + (rnd() - 0.5) * 0.08, 0.17 + rnd() * 0.05, HEAPS[Math.floor(rnd() * HEAPS.length)]);
      const ns = Math.floor(rnd() * 3);
      for (let j = 0; j < ns; j++) {
        lay.sb.box(0.46, 0.22, 0.32, mx + (rnd() - 0.5) * 0.6, y0 + 0.1, mz + 0.65 + j * 0.3, SANDBAG, { y: rnd() * 0.6, z: (rnd() - 0.5) * 0.12 }, HIDE_DOWN);
      }
    }
    if (rnd() < 0.75) {
      // The carpet seller's, against the back row.
      const mx = k.xi - 0.35 - 0.8;
      const mz = zc + (rnd() - 0.5) * (bay - 2.4);
      const kind = rnd();
      if (kind < 0.45) {
        let y = PLINTH;
        const n = 3 + Math.floor(rnd() * 3);
        for (let j = 0; j < n; j++) {
          const h = 0.04;
          lay.sb.box(1.0 - j * 0.04, h, 0.7 - j * 0.03, mx, y + h / 2, mz, j % 2 ? CLOTH : GROUNDS[Math.floor(rnd() * GROUNDS.length)], { y: (rnd() - 0.5) * 0.25 }, HIDE_DOWN);
          y += h;
        }
        const r = 0.1;
        log(lay.m(GROUNDS[Math.floor(rnd() * GROUNDS.length)]), [mx + 0.15, PLINTH + r, mz + 0.55], [mx + 0.15, PLINTH + r, mz + 1.85], r, 7);
      } else if (kind < 0.8) {
        for (let j = 0; j < 3; j++) {
          const r = 0.09 + rnd() * 0.03;
          const x = mx - 0.3 + j * 0.25;
          log(lay.m(GROUNDS[Math.floor(rnd() * GROUNDS.length)]), [x, PLINTH + r, mz - 0.75], [x, PLINTH + r, mz + 0.75], r, 7);
        }
      } else {
        lay.sb.box(1.1, 0.012, 1.4, mx, PLINTH + 0.006, mz, SANDBAG, undefined, HIDE_DOWN);
        const m = lay.m(ALLOY);
        for (let j = 0; j < 4; j++) {
          const r = 0.1 + rnd() * 0.06;
          const x = mx + (j % 2 ? 0.25 : -0.25);
          const z = mz + (j < 2 ? -0.35 : 0.3);
          band(m, 8, 0, r, y0, r * 1.15, y0 + 0.12, x, z);
          band(m, 8, 0, r * 1.15, y0 + 0.12, r * 0.6, y0 + 0.2, x, z);
          disc(m, 8, 0, r * 0.6, 0, y0 + 0.2, true, x, z);
        }
        band(m, 12, 0, 0.3, y0, 0.32, y0 + 0.03, mx, mz + 0.0);
        disc(m, 12, 0, 0.32, 0, y0 + 0.03, true, mx, mz + 0.0);
      }
    }
  }
}

/** A palm basket with a heap of `heap` over its rim; 0.3 m at the crown. */
function basket(lay: Lay, x: number, y: number, z: number, r: number, heap: string): void {
  const m = lay.m(PALM_BEAM);
  band(m, 8, 0, r * 0.9, y, r, y + 0.19, x, z);
  disc(m, 8, 0, r + 0.02, r * 0.86, y + 0.19, true, x, z);
  band(m, 8, 0, r + 0.02, y + 0.17, r + 0.02, y + 0.19, x, z);
  const h = lay.m(heap);
  band(h, 8, 0, r * 0.88, y + 0.185, r * 0.2, y + 0.27, x, z);
  disc(h, 8, 0, r * 0.2, 0, y + 0.27, true, x, z);
}

/**
 * A carpet hung on a face from a rod: its ground, a border round it, a
 * lozenge medallion in two colours, guard stripes, and a fringe at its foot.
 */
function carpet(lay: Lay, s: Side, plane: number, u: number, top: number, wd: number, ht: number, rnd: () => number): void {
  const back = hideBack(s);
  const ground = GROUNDS[Math.floor(rnd() * GROUNDS.length)];
  const trim = ground === SCORCH ? MUDBRICK_DARK : SCORCH;
  const mid = top - ht / 2;
  lay.sb.onFace(s, plane, u, top + 0.02, wd + 0.14, 0.035, 0.035, 0.06, IRON, 0, 0, back);
  lay.sb.onFace(s, plane, u, mid, wd, ht, 0.016, 0.01, ground, 0, 0, back);
  const bw = 0.055;
  for (const e of [-1, 1]) {
    lay.sb.onFace(s, plane, u + e * (wd / 2 - 0.04 - bw / 2), mid, bw, ht - 0.08, 0.012, 0.022, CLOTH, 0, 0, back);
    lay.sb.onFace(s, plane, u, mid + e * (ht / 2 - 0.04 - bw / 2), wd - 0.08, bw, 0.012, 0.022, CLOTH, 0, 0, back);
    lay.sb.onFace(s, plane, u, mid + e * ht * 0.3, wd - 0.24, 0.03, 0.01, 0.022, trim, 0, 0, back);
  }
  const md = Math.min(wd, ht) * 0.42;
  lay.sb.onFace(s, plane, u, mid, md, md, 0.01, 0.022, trim, Math.PI / 4, 0, back);
  lay.sb.onFace(s, plane, u, mid, md * 0.5, md * 0.5, 0.01, 0.03, CLOTH, Math.PI / 4, 0, back);
  const nf = Math.round(wd / 0.07);
  for (let i = 0; i < nf; i++) {
    lay.sb.onFace(s, plane, u - wd / 2 + (i + 0.5) * (wd / nf), top - ht - 0.035, 0.022, 0.07, 0.008, 0.012, CLOTH, 0, 0, back);
  }
}

// --- the elevations ---------------------------------------------------------------

/**
 * The street front: the cornice on the roof's edge, iron straps on the front
 * beam each side of every girder's end, the pierced parapet on both its
 * faces, spouts over two piers, and carpets hung on the piers.
 */
function front(lay: Lay, k: Souk): void {
  const { len, w, wallTop, roofY, rnd, pierZ } = k;
  const s: Side = "-x";
  const plane = w / 2;
  cornice(lay, s, plane, -len / 2, len / 2, wallTop);
  const beamPlane = -(k.xo - 0.45);
  for (const z of girderZ(k)) {
    for (const e of [-1, 1]) {
      const zz = z + e * 0.3;
      if (Math.abs(zz) > len / 2 - 0.05) continue;
      lay.sb.onFace(s, beamPlane, zz, (k.beamLo + wallTop) / 2, 0.06, 0.47, 0.02, 0.0, IRON, 0, 0, hideBack(s));
    }
  }
  triangles(lay, s, plane, -len / 2 + 0.6, len / 2 - 0.6, roofY + 0.42);
  triangles(lay, "+x", -(plane - PARAPET_T), -len / 2 + 0.6, len / 2 - 0.6, roofY + 0.42);
  const nb = pierZ.length - 1;
  for (const i of [1, nb - 1]) spout(lay, s, plane, pierZ[i], roofY + 0.08, k.beamLo, rnd);
  // The carpets: on the street face of the front row, and the hall's face
  // of the back row; never on an end pier, which stands half outside.
  for (let i = 1; i < nb; i++) {
    if (rnd() < 0.5) carpet(lay, s, plane, pierZ[i], 2.25, 0.6, 1.25 + rnd() * 0.2, rnd);
    if (rnd() < 0.55) carpet(lay, "-x", -(k.xi - 0.35), pierZ[i], 2.25, 0.6, 1.2 + rnd() * 0.25, rnd);
  }
}

/**
 * The blind back: the socle; two pointed bays to every bay of the hall, the
 * middle pair of every other bay grilled through to the lane; the cornice
 * carried round under the parapet, pierced over it; a power line on
 * insulators down to a meter by the end; pocks.
 */
function back(lay: Lay, k: Souk): void {
  const { len, w, wallTop, rnd, pierZ } = k;
  const s: Side = "+x";
  const plane = w / 2;
  const bk = hideBack(s);
  socle(lay, s, plane, -len / 2, len / 2, rnd);
  const lo = PLINTH + 0.74;
  for (let i = 0; i + 1 < pierZ.length; i++) {
    const bw = (pierZ[i + 1] - pierZ[i]) / 2;
    for (let j = 0; j < 2; j++) {
      const u = pierZ[i] + (j + 0.5) * bw;
      blindBay(lay, s, plane, u, bw - 0.1, lo, wallTop, MUDBRICK, false, MUDBRICK_DARK);
      if (i % 2 === 1) {
        // A window through to the lane: drawn on both faces, a grille on the street's.
        const wy = 1.75;
        for (const [fs, fp] of [[s, plane], ["-x", -(plane - T)]] as const) {
          lay.sb.onFace(fs, fp, u, wy, 0.46, 0.62, 0.04, 0.02, WINDOW_VOID, 0, 0, hideBack(fs));
          lay.sb.onFace(fs, fp, u, wy - 0.36, 0.62, 0.08, 0.1, 0.04, MUDBRICK_DARK, 0, 0, hideBack(fs));
        }
        for (const e of [-1, 0, 1]) lay.sb.onFace(s, plane, u + e * 0.12, wy, 0.03, 0.62, 0.03, 0.05, IRON, 0, 0, bk);
        lay.sb.onFace(s, plane, u, wy, 0.46, 0.03, 0.03, 0.055, IRON, 0, 0, bk);
      }
    }
  }
  cornice(lay, s, plane, -len / 2, len / 2, wallTop);
  triangles(lay, s, plane, -len / 2 + 0.6, len / 2 - 0.6, wallTop + 0.58);
  // The power line, on brackets just under the parapet's cap.
  const cy = wallTop + PARAPET - 0.2;
  const cOut = 0.16;
  lay.sb.onFace(s, plane, 0, cy, len - 0.3, 0.022, 0.022, cOut, SCORCH, 0, 0, bk);
  for (let z = -len / 2 + 0.4; z < len / 2 - 0.2; z += 2.6) {
    lay.sb.onFace(s, plane, z, cy - 0.03, 0.04, 0.1, cOut, cOut / 2, IRON, 0, 0, bk);
    lay.sb.onFace(s, plane, z, cy + 0.015, 0.05, 0.05, 0.05, cOut, CLOTH, 0, 0, bk);
  }
  const mz = (rnd() < 0.5 ? -1 : 1) * (len / 2 - 0.15);
  lay.sb.onFace(s, plane, mz, (cy + 1.95) / 2, 0.022, cy - 1.95, 0.022, cOut, SCORCH, 0, 0, bk);
  const mu = mz - Math.sign(mz) * 0.25;
  lay.sb.onFace(s, plane, mu, 1.75, 0.34, 0.44, 0.14, cOut, ALLOY, 0, 0, bk);
  lay.sb.onFace(s, plane, mu, 1.75, 0.2, 0.12, 0.02, cOut + 0.075, WINDOW_VOID, 0, 0, bk);
  lay.sb.onFace(s, plane, (mu + mz) / 2, 1.97, Math.abs(mz - mu), 0.022, 0.022, cOut, SCORCH, 0, 0, bk);
  pocks(lay, s, plane, -len / 2 + 0.5, len / 2 - 0.5, PLINTH + 0.8, wallTop + 0.5, 22, rnd);
}

/** The two ends: the cornice on the roof's edge and the pierced parapet over it. */
function ends(lay: Lay, k: Souk): void {
  const { len, w, wallTop, roofY } = k;
  for (const s of ["-z", "+z"] as const) {
    cornice(lay, s, len / 2, -w / 2, k.edge, wallTop);
    triangles(lay, s, len / 2, -w / 2 + 0.6, k.edge - 0.5, roofY + 0.42);
    triangles(lay, s === "-z" ? "+z" : "-z", -(len / 2 - PARAPET_T), -w / 2 + PARAPET_T + 0.4, k.edge - 0.5, roofY + 0.42);
  }
}

/**
 * The roof: patches of fresh mud where it has been made good after rain or
 * a shell, each two or three wavy lobes 2.5 cm proud of the old; a mat of
 * peppers drying; a bundle of fronds by the parapet. All under 0.1 m.
 */
function roof(lay: Lay, k: Souk): void {
  const { rnd, len, roofY } = k;
  const x0 = -k.w / 2 + PARAPET_T + 0.4;
  const x1 = k.edge - 0.4;
  const n = 3 + Math.floor(rnd() * 3);
  const m = lay.m(MUDBRICK_DARK);
  for (let i = 0; i < n; i++) {
    const cx = x0 + 0.9 + rnd() * (x1 - x0 - 1.8);
    const cz = -len / 2 + 1.5 + ((i + rnd()) / n) * (len - 3);
    const lobes = 2 + Math.floor(rnd() * 2);
    for (let j = 0; j < lobes; j++) {
      const r = 0.35 + rnd() * 0.4;
      lobe(m, cx + (rnd() - 0.5) * 0.8, roofY + 0.025 + j * 0.002, cz + (rnd() - 0.5) * 0.8, r * (1.1 + rnd() * 0.5), r, rnd() * TAU, rnd);
    }
  }
  // A reed mat of peppers drying in the sun, 1.5 cm on the deck — the roof
  // is a yard as well as a firing step.
  const mx = x0 + 1.0 + rnd() * (x1 - x0 - 2.0);
  const mz = (rnd() < 0.5 ? -1 : 1) * (len / 4 + rnd() * (len / 4 - 2));
  const yaw = (rnd() - 0.5) * 0.3;
  lay.sb.box(1.3, 0.015, 2.0, mx, roofY + 0.0075, mz, SANDBAG, { y: yaw }, HIDE_DOWN);
  for (let i = 0; i < 46; i++) {
    const u = (rnd() - 0.5) * 1.1;
    const v = (rnd() - 0.5) * 1.8;
    const px = mx + u * Math.cos(yaw) + v * Math.sin(yaw);
    const pz = mz - u * Math.sin(yaw) + v * Math.cos(yaw);
    lay.sb.box(0.05, 0.035, 0.12, px, roofY + 0.032, pz, i % 7 ? AWNING : SCORCH, { y: rnd() * TAU }, HIDE_DOWN);
  }
  // A bundle of palm fronds laid along the front parapet's foot.
  const fz = (rnd() - 0.5) * (len - 6);
  for (let i = 0; i < 6; i++) {
    lay.sb.box(0.07, 0.05, 2.4 + rnd() * 0.6, x0 - 0.15 + i * 0.07, roofY + 0.025 + (i % 2) * 0.035, fz + (rnd() - 0.5) * 0.3, PALM_BEAM, { y: (rnd() - 0.5) * 0.1 }, HIDE_DOWN);
  }
}

/**
 * The awnings: in every bay a cloth on a timber frame, hung off the front
 * beam and held out by two iron stays from under the cornice, with a batten
 * along its free edge and a valance of tabs in the other cloth — the tabs
 * marked for the wind, the sheet on its frame not. The sheet's foot and the
 * valance's both stand 2.4 m over the street.
 */
function awnings(b: Build, lay: Lay, k: Souk): void {
  const { pierZ, wallTop } = k;
  const trans = CONFIG.graphics.translucency.awning;
  const beamPlane = -(k.xo - 0.45);
  const a = 0.19;
  const reach = 2.3;
  const y0 = wallTop - 0.1;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const xe = -beamPlane - reach * ca;
  const ye = y0 - reach * sa;
  const ax = -(k.w / 2 + 0.1);
  const ay = wallTop + 0.1;
  const stay = Math.atan2(ay - ye, ax - xe);
  const sl = Math.hypot(ay - ye, ax - xe);
  for (let i = 0; i + 1 < pierZ.length; i++) {
    const zc = (pierZ[i] + pierZ[i + 1]) / 2;
    const bw = pierZ[i + 1] - pierZ[i] - 0.85;
    const cloth = AWNING_CLOTHS[i % 2];
    const other = AWNING_CLOTHS[(i + 1) % 2];
    b.translucentBox(reach, 0.05, bw, -beamPlane - (reach / 2) * ca, y0 - (reach / 2) * sa, zc, cloth, trans, { z: a });
    // The valance: tabs in the other cloth, long and short in turn.
    const nt = Math.max(4, Math.round(bw / 0.42));
    const tw = bw / nt;
    for (let j = 0; j < nt; j++) {
      const drop = j % 2 ? 0.15 : 0.2;
      marksSway(b.translucentBox(0.03, drop, tw - 0.03, xe - 0.035, ye - drop / 2 + 0.01, zc - bw / 2 + (j + 0.5) * tw, other, trans), "cloth");
    }
    // The frame: two rails under the sheet's edges, the batten, the stays.
    for (const e of [-1, 1]) {
      const z = zc + e * (bw / 2 - 0.03);
      lay.sb.box(reach, 0.05, 0.05, -beamPlane - (reach / 2) * ca, y0 - (reach / 2) * sa - 0.05, z, PALM_BEAM, { z: a });
      lay.sb.box(sl, 0.025, 0.025, (ax + xe) / 2, (ay + ye) / 2, z, IRON, { z: stay });
      lay.sb.onFace("-x", k.w / 2, z, ay, 0.06, 0.08, 0.04, 0.1, IRON, 0, 0, hideBack("-x"));
    }
    lay.sb.box(0.07, 0.07, bw + 0.1, xe - 0.005, ye - 0.01, zc, PALM_BEAM);
  }
}

/** A dish on a bracket on the back parapet, turned to the southern sky. */
function dish(b: Build, k: Souk): void {
  const { rnd, len, w, wallTop } = k;
  const lay = new Lay();
  const z = (rnd() - 0.5) * (len - 4);
  const x = w / 2 + 0.34;
  const y = wallTop + PARAPET - 0.3;
  lay.sb.onFace("+x", w / 2, z, y - 0.05, 0.1, 0.3, 0.04, 0.02, IRON, 0, 0, hideBack("+x"));
  lay.sb.box(0.3, 0.04, 0.04, w / 2 + 0.16, y - 0.05, z, IRON);
  const dir: V3 = [0.55, 0.7, (rnd() - 0.5) * 0.5];
  eye(lay.m(ALLOY), [x, y, z], dir, 0.05, 0.36, 0.13, 12, true, false);
  const l = Math.hypot(dir[0], dir[1], dir[2]);
  const f: V3 = [x + (dir[0] / l) * 0.5, y + (dir[1] / l) * 0.5, z + (dir[2] / l) * 0.5];
  lay.sb.box(0.06, 0.06, 0.06, f[0], f[1], f[2], IRON);
  lay.sb.box(0.018, 0.42, 0.018, (x + f[0]) / 2 - 0.03, (y + f[1]) / 2, (z + f[2]) / 2, IRON, { z: Math.atan2(dir[0], dir[1]) });
  lay.flush(b);
}
