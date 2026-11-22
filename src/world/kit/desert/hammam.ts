/**
 * kit/desert/hammam.ts — buildHammam: an Ottoman provincial bathhouse of
 * lime-rendered brick on a stone socle — a framed portal with a joggled
 * lintel, a striped relieving arch and its foundation inscription, a
 * dog-tooth cornice, steam vents and the furnace stack at its back — and
 * the one roof in the town you pick your way across rather than run, under
 * five domes studded with the glass eyes that light the rooms below. Part
 * of the desert-town set: follows the contract in kit/core.ts and the set's
 * rules in `./index.ts`. Invariants: every collider byte for byte and in its
 * order — the plinth, the flight, the walls, the columns, the deck, its
 * parapet, the domes standing on it and the stack — restated at the top;
 * variation comes from the params, never `Math.random()`. Never imports
 * another builder.
 */
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import { mulberry32 } from "../../rng";
import {
  ALLOY,
  Build,
  IRON,
  Mesher,
  archArc,
  carve,
  hideBack,
  type BuildParams,
  type Side,
  type Structure,
  type V3,
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
  clothHash,
  drape,
} from "./shared";
import {
  HIDE_DOWN,
  Lay,
  TAU,
  band,
  courses,
  disc,
  domeProfile,
  fdir,
  fp,
  kufic,
  merlons,
  pocks,
  pointed,
  slabOn,
  star,
} from "./lay";

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
 * ## What it is drawn as
 *
 * A bathhouse of the Ottoman centuries in the river provinces, of a piece
 * with the mosque and the khan. Outside: a socle of dressed stone under
 * limewashed brick, broken where shelling has taken the render back to the
 * courses; a dog-tooth cornice under the deck's edge; steam vents high on
 * the walls with the stain each one leaves; palm-log spouts through the
 * parapet's foot. On the front, a frontispiece standing proud of the wall: a
 * door framed in striped stone under a joggled lintel, a pointed relieving
 * arch over it with a star in its tympanum, the foundation inscription in
 * square kufic above, and a stepped crest over the parapet. At the back the
 * furnace — its stoking arch black with soot, the ash raked out in front of
 * it, fuel stacked by the wall — and a stack with a vented head. On the roof
 * the domes rise each off a square base and an octagon with its broaches,
 * laid in courses and studded with the glass EYES (`eye`) that are the one
 * thing on the skyline nobody mistakes for a mosque; the big one wears a
 * lantern. The bath's towels dry over the back parapet. Inside: a floor of
 * stone flags, the heated platform between the columns, basins along the
 * walls under soap niches, and the door's studded leaves folded back
 * against the wall.
 *
 * ## The colliders, which are unchanged
 *
 * The plinth, the flight and its landing (`laneFlight`, still called), the
 * front wall's three pieces round the door, the back wall, the two side
 * walls, the two columns, the deck, the parapet's runs, the five domes and
 * the stack — restated below exactly as they were first emitted. Everything
 * after that block is DRAWING and keeps to the three rules: on a face (the
 * frontispiece stands 0.24 proud and a round passes it as it passes the
 * mosque's spandrels), low enough to step over (the flags, the platform, the
 * threshold, the ash and the fuel), or overhead or standing on a collider
 * (the cornice, the spouts, the crest, the domes, the lantern, the stack's
 * head). Each dome's square base is drawn to its block's footprint, so the
 * corners of the box a round stops on are masonry rather than air.
 *
 * ## The domes are courses, as every dome in the set is
 *
 * The cel shader bands light, so a smooth hemisphere bands into contour
 * rings and a dome laid in courses bands into what reads as courses
 * (`courses`, `./lay.ts`). The eyes are limewash collars with a dark glass
 * bell in each — NOT `TILE_BLUE`, which is the mosque's and the one
 * saturated thing on the map; a bathhouse borrowing it would spend the
 * landmark. See the palette in `./shared.ts`.
 *
 * `depth` carries the stair lane and its 12.7 m floor exactly as the house's
 * does. A hammam with no `rampSide` still gets its domes; what it does not get
 * is anything able to stand between them.
 */
export function buildHammam(
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(mats, "hammam");
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
  const rnd = mulberry32(Math.floor(clothHash(w, d, p.rampSide ?? 0, 3) * 0x7fffffff));

  if (climbs) assertClimbable("hammam", d, ys[1] - ys[0]);

  // --- the colliders, restated in their order ----------------------------------
  b.block({ w: w + 0.7, h: PLINTH, d: d + 0.7, x: 0, y: PLINTH / 2, z: 0 });
  if (climbs) {
    laneFlight(b, w, d, ys[0], ys[1], (p.rampSide ?? -1) === 1 ? 1 : -1, PALM_BEAM);
  }
  // The front wall round the door: `doorWall`'s arithmetic, spelled out. The
  // doorway is the only opening below head height on the whole building.
  const mid = wallTop / 2;
  const zF = -(d - T) / 2;
  const doorW = 1.5;
  const doorH = 2.2;
  const jamb = (w - doorW) / 2;
  const off = doorW / 2 + jamb / 2;
  const lintel = wallTop - doorH;
  b.block({ w: jamb, h: wallTop, d: T, x: 0 - off, y: mid, z: zF });
  b.block({ w: jamb, h: wallTop, d: T, x: 0 + off, y: mid, z: zF });
  b.block({ w: doorW, h: lintel, d: T, x: 0, y: mid + wallTop / 2 - lintel / 2, z: zF });
  b.block({ w, h: wallTop, d: T, x: 0, y: mid, z: (d - T) / 2 });
  for (const sx of [-1, 1] as const) {
    b.block({ w: T, h: wallTop, d: sideD, x: (sx * (w - T)) / 2, y: mid, z: 0 });
  }
  // The two columns in the hot room: the only cover inside, and thick enough
  // for `NavGrid` to represent — the mosque's rule, one building over.
  const colH = wallTop - 0.3;
  for (const sx of [-1, 1] as const) {
    b.block({ w: 0.8, h: colH, d: 0.8, x: sx * w * 0.22, y: PLINTH + colH / 2, z: 0 });
  }
  // The deck, then its parapet, then the domes standing on it — the set's
  // order, and the domes are the parapet's own case: cover, emitted last.
  b.block({ w: roofW, h: SLAB, d, x: roofX, y: roofY - SLAB / 2, z: 0 });
  const runD = d - 2 * PARAPET_T;
  if (climbs) {
    // The +X run over the shaft, then `parapetOpenX`'s three.
    b.block({ w: PARAPET_T, h: PARAPET, d, x: (w - PARAPET_T) / 2, y: wallTop + PARAPET / 2, z: 0 });
    for (const sz of [-1, 1] as const) {
      b.block({ w: roofW, h: PARAPET, d: PARAPET_T, x: roofX, y: roofY + PARAPET / 2, z: (sz * (d - PARAPET_T)) / 2 });
    }
    b.block({ w: PARAPET_T, h: PARAPET, d: runD, x: roofX - (roofW - PARAPET_T) / 2, y: roofY + PARAPET / 2, z: 0 });
  } else {
    // `parapet`'s four.
    for (const sz of [-1, 1] as const) {
      b.block({ w, h: PARAPET, d: PARAPET_T, x: 0, y: roofY + PARAPET / 2, z: (sz * (d - PARAPET_T)) / 2 });
    }
    for (const sx of [-1, 1] as const) {
      b.block({ w: PARAPET_T, h: PARAPET, d: runD, x: (sx * (w - PARAPET_T)) / 2, y: roofY + PARAPET / 2, z: 0 });
    }
  }
  const big = Math.min(roofW, sideD) * 0.26;
  const domes: { cx: number; cz: number; r: number; top: number }[] = [];
  const domeAt = (cx: number, cz: number, r: number): void => {
    // The head of the collider, accumulated exactly as the drum and three
    // shells it was first measured off were stacked.
    let y = roofY + 0.55;
    y += r * 0.44;
    y += r * 0.38;
    y += r * 0.3;
    b.block({ w: r * 1.9, h: y - roofY, d: r * 1.9, x: cx, y: (roofY + y) / 2, z: cz });
    domes.push({ cx, cz, r, top: y });
  };
  domeAt(roofX, 0, big);
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      domeAt(roofX + sx * roofW * 0.3, sz * sideD * 0.3, big * 0.46);
    }
  }
  // The furnace stack on the -X elevation. It is the one part of a bathhouse
  // anybody outside can read AS a bathhouse, and it is a collider because it
  // stands off the wall far enough to be cover at the corner of the building.
  const stackH = roofY + 2.6;
  const stX = -(w / 2) - 0.5;
  const stZ = sideD * 0.26;
  b.block({ w: 1.15, h: stackH, d: 1.15, x: stX, y: stackH / 2, z: stZ });

  // --- the drawing ---------------------------------------------------------------
  const k: Hammam = { w, d, skin, climbs, roofY, wallTop, roofW, roofX, doorW, doorH, rnd };
  const lay = new Lay();
  const portalHalf = 2.1;
  elevations(lay, k, portalHalf);
  portal(lay, k, portalHalf);
  furnace(lay, k, stX, stZ, stackH);
  for (const dm of domes) dome(lay, k, dm.cx, dm.cz, dm.r, dm.top, dm.r === big);
  interior(lay, k);
  lay.flush(b);
  // The bath's towels, drying over the back parapet: the set's one moving
  // colour, and a bathhouse is where a town's washing would be.
  const towelTop = roofY + PARAPET;
  const pz = d / 2;
  drape(b, 1.9, 1.0, roofX - roofW * 0.22, towelTop, pz, 1, clothHash(w, d, 11));
  drape(b, 1.5, 0.9, roofX + roofW * 0.34, towelTop, pz, 1, clothHash(w, d, 12));

  // --- the masses, after what is laid on them ------------------------------------
  b.box(w + 0.7, PLINTH, d + 0.7, 0, PLINTH / 2, 0, MUDBRICK_DARK);
  b.box(jamb, wallTop, T, 0 - off, mid, zF, skin);
  b.box(jamb, wallTop, T, 0 + off, mid, zF, skin);
  b.box(doorW, lintel, T, 0, mid + wallTop / 2 - lintel / 2, zF, skin);
  b.box(w, wallTop, T, 0, mid, (d - T) / 2, skin);
  for (const sx of [-1, 1] as const) b.box(T, wallTop, sideD, (sx * (w - T)) / 2, mid, 0, skin);
  for (const sx of [-1, 1] as const) b.box(0.8, colH, 0.8, sx * w * 0.22, PLINTH + colH / 2, 0, skin);
  // The string course at the wall head, under the cornice.
  b.box(w + 0.34, 0.16, d + 0.34, 0, wallTop - 0.08, 0, MUDBRICK_DARK);
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
  b.box(1.15, stackH, 1.15, stX, stackH / 2, stZ, MUDBRICK);
  return b;
}

/** What the drawing's parts are measured by. */
interface Hammam {
  w: number;
  d: number;
  skin: string;
  climbs: boolean;
  roofY: number;
  wallTop: number;
  roofW: number;
  roofX: number;
  doorW: number;
  doorH: number;
  rnd: () => number;
}

/** The four outer faces: each one's plane and the run of `u` along it. */
function faces(k: Hammam): { s: Side; plane: number; u0: number; u1: number }[] {
  const ze = k.climbs ? k.roofX + k.roofW / 2 : k.w / 2;
  return [
    { s: "-z", plane: k.d / 2, u0: -k.w / 2, u1: ze },
    { s: "+z", plane: k.d / 2, u0: -k.w / 2, u1: ze },
    { s: "-x", plane: k.w / 2, u0: -k.d / 2, u1: k.d / 2 },
    { s: "+x", plane: k.w / 2, u0: -k.d / 2, u1: k.d / 2 },
  ];
}

// --- the elevations ---------------------------------------------------------------

/** One course of brick where the render has come away. */
const COURSE = 0.09;

/**
 * The four outer faces: the stone socle, the dog-tooth cornice under the
 * deck's edge, the steam vents and their stains, the spouts, the patches of
 * lost render and the shell pocks. On the front, all of it stops at the
 * frontispiece.
 */
function elevations(lay: Lay, k: Hammam, portalHalf: number): void {
  const { rnd, skin, wallTop } = k;
  const cut = portalHalf + 0.04;
  for (const f of faces(k)) {
    const { s, plane } = f;
    const back = hideBack(s);
    const front = s === "-z";
    const wallEnd = s === "-z" || s === "+z" ? k.w / 2 : k.d / 2;
    const runs = front ? carve(-wallEnd, wallEnd, [[-cut, cut]]) : [[-wallEnd, wallEnd] as [number, number]];

    // The socle: two courses of dressed stone over a mortar ground, and a
    // chamfered weathering course on them. Stones lighter than their joints.
    for (const [a, c] of runs) {
      lay.sb.onFace(s, plane, (a + c) / 2, PLINTH + 0.31, c - a, 0.62, 0.04, 0.012, MUDBRICK_DARK, 0, 0, back);
      for (let row = 0; row < 2; row++) {
        const y0 = PLINTH + row * 0.31;
        let u = a + (row ? 0.0 : 0.02);
        while (u < c - 0.1) {
          const len = Math.min(c - u - 0.02, 0.48 + rnd() * 0.42);
          if (len > 0.12) lay.sb.onFace(s, plane, u + len / 2, y0 + 0.155, len, 0.285, 0.04, 0.034, MUDBRICK, 0, 0, back);
          u += len + 0.025;
        }
      }
      lay.sb.onFace(s, plane, (a + c) / 2, PLINTH + 0.66, c - a + 0.04, 0.08, 0.1, 0.05, MUDBRICK_DARK, 0, 0, back);
    }

    // The cornice under the deck's edge: a course, a band of bricks laid on
    // their corners — the dog-tooth every brick wall head in the province
    // wears — and a corbelled course over it, all standing on the string
    // course at the wall head.
    const cRuns = front ? carve(f.u0, f.u1, [[-cut, cut]]) : [[f.u0, f.u1] as [number, number]];
    for (const [a, c] of cRuns) {
      if (c - a < 0.3) continue;
      lay.sb.onFace(s, plane, (a + c) / 2, wallTop + 0.045, c - a, 0.09, 0.12, 0.0, MUDBRICK, 0, 0, back);
      const n = Math.max(1, Math.floor((c - a - 0.1) / 0.3));
      const step = (c - a) / n;
      for (let i = 0; i < n; i++) {
        lay.sb.onFace(s, plane, a + (i + 0.5) * step, wallTop + 0.19, 0.16, 0.17, 0.16, 0.0, MUDBRICK, 0, Math.PI / 4, back);
      }
      lay.sb.onFace(s, plane, (a + c) / 2, wallTop + 0.33, c - a + 0.06, 0.1, 0.2, 0.04, MUDBRICK, 0, 0, back);
    }

    // The vents: small pointed slits high on the wall, each with the stain
    // the steam has left over it. None on the front's frontispiece.
    const span = wallEnd * 2;
    const n = Math.max(3, Math.round(span / 3.4));
    for (let i = 0; i < n; i++) {
      const u = -wallEnd + 1.4 + (i / (n - 1)) * (span - 2.8);
      if (front && Math.abs(u) < cut + 0.4) continue;
      if (s === "-x" || s === "+x") {
        if (i % 2 === 0) continue;
      }
      vent(lay, s, plane, u, wallTop - 1.0, rnd);
    }

    // The spouts through the parapet's foot, and what their water left.
    if (s === "-z" || s === "+z") {
      for (const fu of [-0.62, 0.3]) {
        const u = f.u0 + (f.u1 - f.u0) * (0.5 + fu * 0.5);
        if (front && Math.abs(u) < cut + 0.5) continue;
        spout(lay, s, plane, u, k.roofY + 0.08, wallTop - 0.1, rnd);
      }
    }

    // Lost render: a patch or two a face, low where a shell's splinters
    // reached and high where the cornice shed its water.
    // Each in a share of the face of its own, so two never land as one.
    const bays = front ? [[-wallEnd + 1.0, -cut - 0.9], [cut + 0.9, wallEnd - 1.0]] : [[-wallEnd + 1.0, -0.6], [0.6, wallEnd - 1.0]];
    for (const [a, c] of bays) {
      if (!front && rnd() < 0.35) continue;
      const hu = 0.5 + rnd() * 0.4;
      const u = a + hu + rnd() * Math.max(0, c - a - 2 * hu);
      spall(lay, s, plane, u, 1.45 + rnd() * 0.15, hu, 0.24 + rnd() * 0.1, skin, rnd);
    }
    for (const [a, c] of runs) pocks(lay, s, plane, a + 0.4, c - 0.4, PLINTH + 0.8, wallTop - 0.3, Math.round(((c - a) / (2 * wallEnd)) * (front || s === "-x" ? 14 : 8)), rnd);
  }
}

/** A steam vent: a pointed slit in a dark ring on a sill, and its stain up the wall. */
function vent(lay: Lay, s: Side, plane: number, u: number, sill: number, rnd: () => number): void {
  const back = hideBack(s);
  const ww = 0.3;
  slabOn(lay, s, plane, pointed(u, sill, ww, 0.32, 0.22), 0.0, 0.03, WINDOW_VOID);
  ring(lay, s, plane, u, sill + 0.32, ww, 0.22, 0.09, 0.06, 0.03, [MUDBRICK_DARK]);
  lay.sb.onFace(s, plane, u, sill - 0.04, ww + 0.2, 0.08, 0.1, 0.05, MUDBRICK_DARK, 0, 0, back);
  // The stain: wider than the slit at its head, fading out to a tip.
  const top = sill + 0.66 + rnd() * 0.15;
  const half = 0.16 + rnd() * 0.06;
  const y0 = sill + 0.6;
  blob(lay, s, plane, [u, (y0 + top) / 2], [
    [u - half * 0.6, y0],
    [u + half * 0.6, y0],
    [u + half, (y0 + top) / 2],
    [u + half * 1.2, top],
    [u - half * 1.1, top],
    [u - half, (y0 + top) / 2],
  ], 0, 0.006, MUDBRICK_DARK);
}

/** A palm-log spout through the parapet's foot, and the streak under it. */
function spout(lay: Lay, s: Side, plane: number, u: number, y: number, streakTop: number, rnd: () => number): void {
  lay.sb.onFace(s, plane, u, y, 0.16, 0.14, 0.62, 0.27, PALM_BEAM, 0, 0, hideBack(s));
  // The wash it leaves: broad under the string course, spreading as it runs
  // and stopping in a ragged foot well above the socle.
  const lo = 2.15 + rnd() * 0.3;
  const wa = 0.13 + rnd() * 0.06;
  blob(lay, s, plane, [u, (streakTop + lo) / 2], [
    [u - wa, streakTop],
    [u + wa, streakTop],
    [u + wa + 0.1, lo + 0.22],
    [u + 0.16, lo + 0.04],
    [u + 0.02, lo + 0.14],
    [u - 0.14, lo],
    [u - wa - 0.06, lo + 0.18],
  ], 0, 0.006, MUDBRICK_DARK);
}

/**
 * A ring of voussoirs round a pointed arch struck from `ys`, in `colors`
 * taken in turn — two of them is the ablaq a portal is striped in, one is a
 * plain ring. Like `archRing`, it sits outside the arc it is struck on.
 */
function ring(
  lay: Lay,
  s: Side,
  plane: number,
  u: number,
  ys: number,
  span: number,
  rise: number,
  width: number,
  thick: number,
  out: number,
  colors: readonly string[],
): void {
  const pts = archArc(u, ys, span, rise, width / 2, 4);
  for (const side of [-1, 1]) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ua, ya] = pts[i];
      const [ub, yb] = pts[i + 1];
      const u0 = side < 0 ? ua : 2 * u - ua;
      const u1 = side < 0 ? ub : 2 * u - ub;
      let a = Math.atan2(yb - ya, u1 - u0);
      if (a > Math.PI / 2) a -= Math.PI;
      else if (a <= -Math.PI / 2) a += Math.PI;
      const col = colors[i % colors.length];
      lay.sb.onFace(s, plane, (u0 + u1) / 2, (ya + yb) / 2, Math.hypot(u1 - u0, yb - ya) + 0.03, width, thick, out, col, a, 0, hideBack(s));
    }
  }
}

/**
 * An outline laid on a face, fanned from `centre` (from which it must be
 * star-shaped) rather than from its first point, as `slabOn` is: a lobe with
 * a wave in its edge is not convex.
 */
function blob(
  lay: Lay,
  s: Side,
  plane: number,
  centre: readonly [number, number],
  pts: readonly (readonly [number, number])[],
  out0: number,
  out1: number,
  color: string,
): void {
  const m = lay.m(color);
  const fwd = fdir(s, 0, 0, 1);
  const c = fp(s, plane, centre[0], centre[1], out1);
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = pts[i];
    const b = pts[j];
    m.tri(c, fp(s, plane, a[0], a[1], out1), fp(s, plane, b[0], b[1], out1), fwd);
    // The edge's side, facing away from the centre.
    const du = b[0] - a[0];
    const dy = b[1] - a[1];
    const mu = (a[0] + b[0]) / 2 - centre[0];
    const my = (a[1] + b[1]) / 2 - centre[1];
    const sg = dy * mu - du * my > 0 ? 1 : -1;
    m.quad(fp(s, plane, a[0], a[1], out0), fp(s, plane, b[0], b[1], out0), fp(s, plane, b[0], b[1], out1), fp(s, plane, a[0], a[1], out1), fdir(s, sg * dy, -sg * du, 0));
  }
}

/** Whether `(u, y)` is inside a closed outline. */
function within(pts: readonly (readonly [number, number])[], u: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ui, yi] = pts[i];
    const [uj, yj] = pts[j];
    if (yi > y !== yj > y && u < ((uj - ui) * (y - yi)) / (yj - yi) + ui) inside = !inside;
  }
  return inside;
}

/**
 * Render lost back to the brick: two or three overlapping lobes, each with a
 * slow wave in its edge, a dark mortar ground with courses of brick laid
 * across it, and a lip of render standing round the outside, which is the
 * step that makes it a HOLE in the plaster rather than a brown stain on it.
 */
function spall(lay: Lay, s: Side, plane: number, u: number, y: number, hu: number, hy: number, skin: string, rnd: () => number): void {
  const back = hideBack(s);
  const lobes: { c: [number, number]; pts: [number, number][] }[] = [];
  const lobe = (lu: number, ly: number, a: number, b: number): void => {
    const p1 = rnd() * TAU;
    const p2 = rnd() * TAU;
    const N = 16;
    const pts: [number, number][] = [];
    for (let i = 0; i < N; i++) {
      const t = (i / N) * TAU;
      const k = 1 + 0.2 * Math.sin(2 * t + p1) + 0.1 * Math.sin(3 * t + p2) + (rnd() - 0.5) * 0.08;
      pts.push([lu + Math.cos(t) * a * k, ly + Math.sin(t) * b * k]);
    }
    lobes.push({ c: [lu, ly], pts });
  };
  lobe(u, y, hu, hy);
  const extra = 1 + Math.floor(rnd() * 2);
  for (let i = 0; i < extra; i++) {
    const side = i % 2 ? -1 : 1;
    lobe(u + side * hu * (0.55 + rnd() * 0.35), y + (rnd() - 0.5) * hy * 0.7, hu * (0.4 + rnd() * 0.3), hy * (0.55 + rnd() * 0.3));
  }
  lobes.forEach((l, li) => {
    blob(lay, s, plane, l.c, l.pts, 0, 0.006, MUDBRICK_DARK);
    // The lip, where no other lobe has taken the render away.
    const n = l.pts.length;
    for (let i = 0; i < n; i++) {
      const [ua, ya] = l.pts[i];
      const [ub, yb] = l.pts[(i + 1) % n];
      const mu = (ua + ub) / 2;
      const my = (ya + yb) / 2;
      if (lobes.some((o, oi) => oi !== li && within(o.pts, mu, my))) continue;
      const a = Math.atan2(yb - ya, ub - ua);
      const tilt = a > Math.PI / 2 ? a - Math.PI : a <= -Math.PI / 2 ? a + Math.PI : a;
      lay.sb.onFace(s, plane, mu, my, Math.hypot(ub - ua, yb - ya) + 0.03, 0.045, 0.035, 0.0175, skin, tilt, 0, back);
    }
  });
  // The courses: each row the union of where it crosses the lobes.
  const ys = lobes.flatMap((l) => l.pts.map((q) => q[1]));
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  let row = 0;
  for (let yc = lo + COURSE * 0.7; yc < hi - COURSE * 0.5; yc += COURSE, row++) {
    const spans: [number, number][] = [];
    for (const l of lobes) {
      const xs: number[] = [];
      const n = l.pts.length;
      for (let i = 0; i < n; i++) {
        const [ua, ya] = l.pts[i];
        const [ub, yb] = l.pts[(i + 1) % n];
        if (ya > yc !== yb > yc) xs.push(ua + ((ub - ua) * (yc - ya)) / (yb - ya));
      }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        if (xs[i + 1] - xs[i] > 0.14) spans.push([xs[i] + 0.035, xs[i + 1] - 0.035]);
      }
    }
    spans.sort((p, q) => p[0] - q[0]);
    const merged: [number, number][] = [];
    for (const sp of spans) {
      const last = merged[merged.length - 1];
      if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]);
      else merged.push([sp[0], sp[1]]);
    }
    for (const [a, c] of merged) {
      // Bricks in stretcher bond, the joints staggered course to course.
      let uu = a - (row % 2 ? 0.13 : 0) + ((a * 7.3) % 0.26);
      while (uu < c) {
        const b0 = Math.max(a, uu);
        const b1 = Math.min(c, uu + 0.24);
        if (b1 - b0 > 0.05) lay.sb.onFace(s, plane, (b0 + b1) / 2, yc, b1 - b0, COURSE - 0.022, 0.02, 0.014, MUDBRICK, 0, 0, back);
        uu += 0.26;
      }
    }
  }
}

// --- the portal -------------------------------------------------------------------

/**
 * The front: a frontispiece standing 0.24 proud of the wall from the socle
 * to the parapet's head, with the door in it. Its piers' inner sides are the
 * door's reveal; the jambs are striped stone, the lintel joggled, a pointed
 * relieving arch over it is striped too, with a star in its tympanum; over
 * that the foundation inscription in square kufic in a moulded cartouche; and
 * on the parapet a stepped crest. Behind the door, the leaves stand folded
 * back against the wall inside, boards and iron.
 */
function portal(lay: Lay, k: Hammam, half: number): void {
  const s: Side = "-z";
  const plane = k.d / 2;
  const back = hideBack(s);
  const PP = 0.24;
  const head = k.roofY + PARAPET;
  const dw = k.doorW / 2;
  const top = k.doorH;
  const { skin, rnd } = k;
  // The frontispiece: two piers and the piece over the door.
  const pierW = half - dw;
  for (const e of [-1, 1]) {
    lay.sb.onFace(s, plane, e * (dw + pierW / 2), (PLINTH + head) / 2, pierW, head - PLINTH, PP, PP / 2, skin, 0, 0, back);
  }
  lay.sb.onFace(s, plane, 0, (top + head) / 2, 2 * dw, head - top, PP, PP / 2, skin, 0, 0, back);
  // Its cap, level with the parapet's, and the crest standing on it.
  lay.sb.onFace(s, plane, 0, head + 0.07, 2 * half + 0.16, 0.14, PP + 0.24, PP / 2 - 0.04, MUDBRICK_DARK, 0, 0, back);
  merlons(lay, s, plane + PP, 0, 2 * half - 0.1, head + 0.14, 0.12, skin);

  // The outer moulding: a roll round three sides of the panel.
  const fo = PP + 0.03;
  const fx = half - 0.2;
  const fTop = head - 0.3;
  for (const e of [-1, 1]) lay.sb.onFace(s, plane, e * fx, (PLINTH + 0.7 + fTop) / 2, 0.1, fTop - PLINTH - 0.7, 0.06, fo, MUDBRICK_DARK, 0, 0, back);
  lay.sb.onFace(s, plane, 0, fTop, 2 * fx + 0.1, 0.1, 0.06, fo, MUDBRICK_DARK, 0, 0, back);
  // The panel's socle: a course of the wall's, carried across the piers.
  for (const e of [-1, 1]) {
    lay.sb.onFace(s, plane, e * (dw + pierW / 2), PLINTH + 0.33, pierW, 0.62, 0.04, PP + 0.02, MUDBRICK, 0, 0, back);
    lay.sb.onFace(s, plane, e * (dw + pierW / 2), PLINTH + 0.66, pierW + 0.04, 0.08, 0.1, PP + 0.04, MUDBRICK_DARK, 0, 0, back);
  }

  // The jambs: stones of two colours in turn, each side of the door.
  const jw = 0.3;
  const jy0 = PLINTH + 0.7;
  const nJ = Math.max(2, Math.round((top - jy0) / 0.3));
  const hgt = (top - jy0) / nJ;
  for (let i = 0; i < nJ; i++) {
    for (const e of [-1, 1]) {
      lay.sb.onFace(s, plane, e * (dw + jw / 2 + 0.02), jy0 + (i + 0.5) * hgt, jw, hgt - 0.02, 0.04, PP + 0.02, i % 2 ? MUDBRICK_DARK : MUDBRICK, 0, 0, back);
    }
  }
  // The lintel, joggled: five stones of two colours, the middle one a key.
  const lh = 0.28;
  const lw = 2 * (dw + jw + 0.02);
  const nL = 5;
  for (let j = 0; j < nL; j++) {
    const u = -lw / 2 + ((j + 0.5) * lw) / nL;
    const key = j === 2;
    lay.sb.onFace(s, plane, u, top + lh / 2 + (key ? 0.02 : 0), lw / nL - 0.02, lh + (key ? 0.04 : 0), 0.05, PP + 0.025, j % 2 ? MUDBRICK : MUDBRICK_DARK, 0, 0, back);
  }
  // The relieving arch over it, striped, with a star in the tympanum.
  const span = k.doorW + 0.1;
  const spring = top + lh + 0.06;
  const rise = 0.6;
  slabOn(lay, s, plane, pointed(0, spring - 0.06, span, 0.06, rise), PP, PP + 0.012, MUDBRICK_DARK);
  ring(lay, s, plane, 0, spring, span, rise, 0.17, 0.05, PP + 0.025, [MUDBRICK, MUDBRICK_DARK]);
  star(lay, s, plane, 0, spring + rise * 0.42, 0.3, PP + 0.03, skin);
  // The inscription: kufic in the render's colour on a dark ground, in a
  // moulded cartouche.
  const cy0 = spring + rise + 0.18;
  const cy1 = fTop - 0.14;
  const cw = 2 * fx - 0.34;
  if (cy1 - cy0 > 0.3) {
    slabOn(lay, s, plane, [[-cw / 2, cy0], [cw / 2, cy0], [cw / 2, cy1], [-cw / 2, cy1]], PP, PP + 0.012, MUDBRICK_DARK);
    for (const e of [-1, 1]) lay.sb.onFace(s, plane, e * (cw / 2 + 0.04), (cy0 + cy1) / 2, 0.08, cy1 - cy0 + 0.16, 0.05, PP + 0.025, MUDBRICK, 0, 0, back);
    for (const yy of [cy0 - 0.04, cy1 + 0.04]) lay.sb.onFace(s, plane, 0, yy, cw + 0.16, 0.08, 0.05, PP + 0.025, MUDBRICK, 0, 0, back);
    // Two lines of it, a rule between, which is the density a foundation
    // text is cut at; one line this tall reads as letters of a script it is not.
    const lineH = (cy1 - cy0 - 0.1) / 2;
    const put = (u: number, yy: number, along: number, tall: number): void =>
      lay.sb.onFace(s, plane, u, yy, along, tall, 0.03, PP + 0.025, skin, 0, 0, back);
    kufic(put, -cw / 2 + 0.06, cw / 2 - 0.06, cy0 + 0.03, lineH, rnd);
    kufic(put, -cw / 2 + 0.06, cw / 2 - 0.06, cy0 + lineH + 0.07, lineH, rnd);
    lay.sb.onFace(s, plane, 0, cy0 + lineH + 0.05, cw - 0.1, 0.035, 0.03, PP + 0.025, MUDBRICK, 0, 0, back);
  }
  // The threshold: one worn stone across the opening.
  lay.sb.box(k.doorW, 0.05, T + PP, 0, PLINTH + 0.025, -(plane - T + (T + PP) / 2), MUDBRICK, undefined, HIDE_DOWN);

  // The leaves, folded back against the wall inside: boards, three straps
  // and a field of studs.
  const s2: Side = "+z";
  const inner = -(k.d / 2 - T);
  const b2 = hideBack(s2);
  const leafH = top - PLINTH - 0.06;
  for (const e of [-1, 1]) {
    const hinge = e * dw;
    const uc = hinge + e * (dw / 2 + 0.02);
    const nB = 5;
    for (let j = 0; j < nB; j++) {
      lay.sb.onFace(s2, inner, hinge + e * (0.03 + (j + 0.5) * (dw / nB)), PLINTH + 0.03 + leafH / 2, dw / nB - 0.016, leafH, 0.07, 0.035, PALM_BEAM, 0, 0, b2);
    }
    for (const yy of [0.6, 1.3, 2.0]) lay.sb.onFace(s2, inner, uc, PLINTH + yy, dw - 0.04, 0.07, 0.02, 0.08, IRON, 0, 0, b2);
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 3; c++) {
        lay.sb.onFace(s2, inner, hinge + e * (0.16 + c * ((dw - 0.3) / 2)), PLINTH + 0.4 + r * 0.38, 0.045, 0.045, 0.03, 0.085, IRON, 0, 0, b2);
      }
    }
  }
}

// --- the furnace ------------------------------------------------------------------

/**
 * The külhan at the back: the stack's courses and soot, its vented head, the
 * stoking arch in its foot with the ash raked out of it, and fuel stacked
 * along the wall — two bundles of thorn scrub, low enough to step over.
 */
function furnace(lay: Lay, k: Hammam, x: number, z: number, H: number): void {
  const half = 0.575;
  const { rnd } = k;
  // The bands, a course proud every metre or so, and the soot at the head.
  for (let y = 1.3; y < H - 1.4; y += 0.95) {
    lay.sb.box(2 * half + 0.08, 0.09, 2 * half + 0.08, x, y, z, MUDBRICK_DARK);
  }
  lay.sb.box(2 * half + 0.04, 1.1, 2 * half + 0.04, x, H - 0.55, z, SCORCH, undefined, HIDE_DOWN);
  const sides: Side[] = ["-x", "+z", "-z"];
  for (const s of sides) {
    const plane = s === "-x" ? -x + half : s === "+z" ? z + half : -(z - half);
    const uc = s === "-x" ? z : x;
    for (let t = 0; t < 2; t++) {
      const u = uc + (t - 0.5) * 0.5 + (rnd() - 0.5) * 0.1;
      const hw = 0.14 + rnd() * 0.1;
      const len = 0.2 + rnd() * 0.45;
      slabOn(lay, s, plane, [[u - hw, H - 1.1], [u + hw, H - 1.1], [u + hw * 0.7, H - 1.1 - len * 0.7], [u + hw * 0.1, H - 1.1 - len], [u - hw * 0.6, H - 1.1 - len * 0.85]], 0.02, 0.026, SCORCH);
    }
  }
  // The head: a corbelled cap, four piers and a slab over the flue.
  lay.sb.box(1.45, 0.18, 1.45, x, H + 0.09, z, MUDBRICK_DARK);
  for (const ex of [-1, 1]) {
    for (const ez of [-1, 1]) {
      lay.sb.box(0.24, 0.42, 0.24, x + ex * 0.5, H + 0.18 + 0.21, z + ez * 0.5, MUDBRICK, undefined, HIDE_DOWN);
    }
  }
  lay.sb.box(0.86, 0.4, 0.86, x, H + 0.18 + 0.2, z, SCORCH, undefined, HIDE_DOWN);
  lay.sb.box(1.5, 0.12, 1.5, x, H + 0.66, z, MUDBRICK_DARK);
  lay.sb.box(1.1, 0.08, 1.1, x, H + 0.76, z, MUDBRICK_DARK, undefined, HIDE_DOWN);

  // The stoking arch in the stack's outer face.
  const s: Side = "-x";
  const plane = -x + half;
  slabOn(lay, s, plane, pointed(z, 0.04, 0.72, 0.55, 0.4), 0, 0.03, WINDOW_VOID);
  ring(lay, s, plane, z, 0.59, 0.72, 0.4, 0.14, 0.07, 0.035, [MUDBRICK_DARK]);
  for (const e of [-1, 1]) lay.sb.onFace(s, plane, z + e * 0.43, 0.32, 0.14, 0.56, 0.07, 0.035, MUDBRICK_DARK, 0, 0, hideBack(s));
  blob(lay, s, plane, [z, 1.7], [
    [z - 0.36, 1.02],
    [z + 0.36, 1.02],
    [z + 0.5, 1.6],
    [z + 0.45, 2.3],
    [z + 0.15, 2.05],
    [z - 0.12, 2.45],
    [z - 0.42, 2.1],
    [z - 0.5, 1.5],
  ], 0, 0.008, SCORCH);
  // The ash raked out of it: a low heap on the ground.
  const ash = lay.m(SCORCH);
  const ax = x - half - 0.45;
  band(ash, 7, 0.3, 0.58, -0.06, 0.22, 0.09, ax, z - 0.05);
  disc(ash, 7, 0.3, 0.22, 0, 0.09, true, ax, z - 0.05);
  band(ash, 6, 1.1, 0.42, -0.06, 0.12, 0.05, ax - 0.45, z + 0.3);
  disc(ash, 6, 1.1, 0.12, 0, 0.05, true, ax - 0.45, z + 0.3);
  // The fuel: bundles of thorn scrub along the wall beside the stack.
  for (const [dx, dz, len] of [
    [0.22, 1.45, 1.4],
    [0.5, 1.6, 1.2],
  ] as const) {
    const bx = x - 0.12 - (dx - 0.22);
    const bz = z + half + dz;
    log(lay.m(PALM_BEAM), [bx, 0.1, bz - len / 2], [bx + (rnd() - 0.5) * 0.08, 0.1, bz + len / 2], 0.11, 6);
    lay.sb.box(0.25, 0.04, 0.05, bx, 0.2, bz - len * 0.25, IRON, undefined, HIDE_DOWN);
    lay.sb.box(0.25, 0.04, 0.05, bx, 0.2, bz + len * 0.25, IRON, undefined, HIDE_DOWN);
  }
}

/** A round member from `a` to `c` with planar facets and closed ends. */
function log(m: Mesher, a: V3, c: V3, r: number, n: number): void {
  eye(m, a, [c[0] - a[0], c[1] - a[1], c[2] - a[2]], r, r, Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]), n, true, true);
}

/**
 * A frustum along an arbitrary axis: from radius `r0` at `at` to `r1` at
 * `len` along `dir`, `n` planar sides, and a cap on its far end (and its
 * near one, when asked). A dome's glass eye is two of them.
 */
function eye(m: Mesher, at: V3, dir: V3, r0: number, r1: number, len: number, n: number, cap = true, base = false): void {
  const l = Math.hypot(dir[0], dir[1], dir[2]);
  const ax: V3 = [dir[0] / l, dir[1] / l, dir[2] / l];
  const t: V3 = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const e1n: V3 = [ax[1] * t[2] - ax[2] * t[1], ax[2] * t[0] - ax[0] * t[2], ax[0] * t[1] - ax[1] * t[0]];
  const el = Math.hypot(e1n[0], e1n[1], e1n[2]);
  const e1: V3 = [e1n[0] / el, e1n[1] / el, e1n[2] / el];
  const e2: V3 = [ax[1] * e1[2] - ax[2] * e1[1], ax[2] * e1[0] - ax[0] * e1[2], ax[0] * e1[1] - ax[1] * e1[0]];
  const p = (a: number, r: number, h: number): V3 => {
    const c = Math.cos(a) * r;
    const s = Math.sin(a) * r;
    return [at[0] + ax[0] * h + e1[0] * c + e2[0] * s, at[1] + ax[1] * h + e1[1] * c + e2[1] * s, at[2] + ax[2] * h + e1[2] * c + e2[2] * s];
  };
  const tip: V3 = [at[0] + ax[0] * len, at[1] + ax[1] * len, at[2] + ax[2] * len];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * TAU;
    const a1 = ((i + 1) / n) * TAU;
    const am = (a0 + a1) / 2;
    const out: V3 = [e1[0] * Math.cos(am) + e2[0] * Math.sin(am), e1[1] * Math.cos(am) + e2[1] * Math.sin(am), e1[2] * Math.cos(am) + e2[2] * Math.sin(am)];
    m.quad(p(a0, r0, 0), p(a1, r0, 0), p(a1, r1, len), p(a0, r1, len), out);
    if (cap) m.tri(tip, p(a0, r1, len), p(a1, r1, len), ax);
    if (base) m.tri(at, p(a1, r0, 0), p(a0, r0, 0), [-ax[0], -ax[1], -ax[2]]);
  }
}

// --- the domes --------------------------------------------------------------------

/**
 * One dome: a square base drawn to its collider's footprint with a coping on
 * it, an octagon turning it with a broach at each corner, the shell in
 * courses, and the eyes set through it in rings — a limewash collar with a
 * glass bell in it. The big one is cut at its crown for a lantern; a small
 * one ends in a clay knob. Everything stands on the deck and inside the
 * block the round stops on, but for the lantern and the knob over its head,
 * where the old oculus stood.
 */
function dome(lay: Lay, k: Hammam, cx: number, cz: number, r: number, top: number, big: boolean): void {
  const { roofY, skin } = k;
  const sq = r * 1.9;
  const hb = big ? 0.55 : 0.45;
  const ho = big ? 0.4 : 0.3;
  const m = lay.m(skin);
  // The base, and its coping.
  lay.sb.box(sq, hb - 0.1, sq, cx, roofY + (hb - 0.1) / 2, cz, skin, undefined, HIDE_DOWN);
  lay.sb.box(sq + 0.1, 0.1, sq + 0.1, cx, roofY + hb - 0.05, cz, MUDBRICK_DARK, undefined, HIDE_DOWN);
  const yc = roofY + hb;
  // The octagon and its broaches.
  const ao = sq / 2 - 0.1;
  band(m, 8, 0, ao, yc, ao, yc + ho, cx, cz);
  disc(m, 8, 0, ao, 0, yc + ho, true, cx, cz);
  const k8 = 1 / Math.cos(Math.PI / 8);
  for (let q = 0; q < 4; q++) {
    const a = Math.PI / 4 + (q * Math.PI) / 2;
    const ca: V3 = [cx + Math.sin(a) * (sq / 2 - 0.02) * Math.SQRT2, yc, cz + Math.cos(a) * (sq / 2 - 0.02) * Math.SQRT2];
    const v = (ang: number): V3 => [cx + Math.sin(ang) * ao * k8, yc, cz + Math.cos(ang) * ao * k8];
    const p1 = v(a - Math.PI / 8);
    const p2 = v(a + Math.PI / 8);
    const apex: V3 = [cx + Math.sin(a) * ao, yc + ho * 0.9, cz + Math.cos(a) * ao];
    const outw: V3 = [Math.sin(a), 0.7, Math.cos(a)];
    m.tri(ca, p1, apex, outw);
    m.tri(ca, apex, p2, outw);
  }
  // A ledge round the octagon's head where the shell springs.
  const y0 = yc + ho;
  const R = ao * 0.95;
  band(lay.m(MUDBRICK_DARK), 16, 0, R + 0.02, y0, R + 0.08, y0 + 0.08, cx, cz);
  disc(lay.m(MUDBRICK_DARK), 16, 0, R + 0.08, R - 0.02, y0 + 0.08, true, cx, cz);
  // The shell, to the collider's head.
  const H = top - 0.04 - (y0 + 0.08);
  let prof = domeProfile(R, y0 + 0.08, H, big ? 0.1 : 0.06, big ? 9 : 6);
  let crown = 0;
  if (big) {
    // Cut at the course whose radius will take the lantern.
    const cutAt = prof.findIndex(([rad], i) => i > 1 && rad < 0.62);
    prof = prof.slice(0, cutAt);
    crown = prof[prof.length - 1][1];
  }
  courses(m, 16, 0, prof, big ? 0.045 : 0.035, cx, cz);

  // The eyes, in rings on the courses between the springing and the crown.
  const glass = lay.m(WINDOW_VOID);
  const rings = big ? [2, 4, 6] : [2, 4];
  const gap = big ? 0.78 : 0.62;
  const cr = big ? 0.12 : 0.1;
  for (const ri of rings) {
    if (ri + 1 >= prof.length) continue;
    const [ra, ya] = prof[ri];
    const [rb, yb] = prof[ri + 1];
    const rad = (ra + rb) / 2 - 0.02;
    const yy = (ya + yb) / 2;
    const nr0 = yb - ya;
    const ny0 = ra - rb;
    const nl = Math.hypot(nr0, ny0);
    const nr = nr0 / nl;
    const ny = ny0 / nl;
    const count = Math.max(4, Math.round((TAU * rad) / gap));
    const phase = (ri % 4 === 2 ? 0.5 : 0) * (TAU / count);
    for (let j = 0; j < count; j++) {
      const a = phase + (j * TAU) / count;
      const sa = Math.sin(a);
      const ca = Math.cos(a);
      const dir: V3 = [sa * nr, ny, ca * nr];
      const base: V3 = [cx + sa * (rad - nr * 0.05), yy - ny * 0.05, cz + ca * (rad - nr * 0.05)];
      eye(m, base, dir, cr, cr * 0.88, 0.1, 6, true);
      const lip: V3 = [base[0] + dir[0] * 0.07, base[1] + dir[1] * 0.07, base[2] + dir[2] * 0.07];
      eye(glass, lip, dir, cr * 0.6, cr * 0.32, 0.08, 6, true);
    }
  }

  if (big) {
    // The lantern: an octagon of piers with dark lights between, its cornice
    // and a little dome of its own, and a knob.
    const lr = 0.42;
    const lh = 0.5;
    const ly0 = crown;
    band(m, 8, 0, lr, ly0, lr, ly0 + lh, cx, cz);
    for (let q = 0; q < 8; q++) {
      const a = (q * TAU) / 8;
      const fw = 2 * lr * Math.tan(Math.PI / 8);
      lay.sb.box(fw * 0.5, lh * 0.6, 0.03, cx + Math.sin(a) * (lr + 0.005), ly0 + lh * 0.48, cz + Math.cos(a) * (lr + 0.005), WINDOW_VOID, { y: a });
    }
    const mc = lay.m(MUDBRICK_DARK);
    band(mc, 8, 0, lr + 0.02, ly0 + lh, lr + 0.1, ly0 + lh + 0.08, cx, cz);
    disc(mc, 8, 0, lr + 0.1, lr - 0.04, ly0 + lh + 0.08, true, cx, cz);
    const cap = domeProfile(lr - 0.04, ly0 + lh + 0.08, 0.36, 0.02, 4);
    courses(m, 8, 0, cap, 0.025, cx, cz);
    knob(lay, cx, cap[cap.length - 1][1] - 0.02, cz, 1);
  } else {
    knob(lay, cx, top - 0.06, cz, 0.7);
  }
}

/** The clay knob a bathhouse dome ends in, where a mosque's would wear an alem. */
function knob(lay: Lay, x: number, y: number, z: number, s: number): void {
  const m = lay.m(MUDBRICK_DARK);
  band(m, 6, 0, 0.09 * s, y, 0.12 * s, y + 0.1 * s, x, z);
  band(m, 6, 0, 0.12 * s, y + 0.1 * s, 0.05 * s, y + 0.24 * s, x, z);
  disc(m, 6, 0, 0.05 * s, 0, y + 0.24 * s, true, x, z);
}

// --- the hot room -----------------------------------------------------------------

/**
 * Inside: stone flags over the floor, the heated platform between the two
 * columns, a base and a capital on each column, and basins along the walls
 * each under a soap niche — none of it higher than a step where a body
 * walks, and the basins no deeper off the wall than a body keeps from it.
 */
function interior(lay: Lay, k: Hammam): void {
  const { w, d, skin, climbs, rnd } = k;
  const xi = w / 2 - T;
  const zi = d / 2 - T;
  const xMax = climbs ? xi - 2.0 : xi;
  const colX = w * 0.22;
  const plat = 1.45;
  // The platform: an octagon of stone a step high, on a dark base course.
  const pm = lay.m(skin);
  band(lay.m(MUDBRICK_DARK), 8, Math.PI / 8, plat, PLINTH, plat, PLINTH + 0.08);
  band(pm, 8, Math.PI / 8, plat + 0.04, PLINTH + 0.08, plat + 0.04, PLINTH + 0.26);
  disc(pm, 8, Math.PI / 8, plat + 0.04, 0, PLINTH + 0.26);
  // The flags: the plinth's own top is the stone, and what is drawn is its
  // JOINTS — dark lines a few millimetres proud, the long ones the courses
  // and the short ones staggered across them. Flags laid as slabs over it
  // would be a second floor the size of the room, paid for in fill from
  // every vantage that sees the building, the room hidden or not.
  const fl = 0.86;
  const jt = 0.035;
  const TOP_ONLY = 0b111011;
  const x0 = -xi;
  const x1 = xMax;
  let row = 0;
  for (let z = -zi + fl; z < zi - 0.2; z += fl) {
    lay.sb.box(x1 - x0, 0.008, jt, (x0 + x1) / 2, PLINTH + 0.002, z, SCORCH, undefined, TOP_ONLY);
  }
  for (let z = -zi; z < zi - 0.2; z += fl, row++) {
    const z1 = Math.min(zi, z + fl);
    for (let x = x0 + (row % 2 ? fl / 2 : fl) + (rnd() - 0.5) * 0.1; x < x1 - 0.2; x += fl) {
      lay.sb.box(jt, 0.008, z1 - z - jt, x, PLINTH + 0.002, (z + z1) / 2, SCORCH, undefined, TOP_ONLY);
    }
  }
  // The columns: a base a step high and a capital over every head.
  for (const sx of [-1, 1]) {
    const x = sx * colX;
    lay.sb.box(1.0, 0.16, 1.0, x, PLINTH + 0.08, 0, MUDBRICK_DARK, undefined, HIDE_DOWN);
    lay.sb.box(0.9, 0.08, 0.9, x, PLINTH + 0.2, 0, skin, undefined, HIDE_DOWN);
    lay.sb.box(0.94, 0.08, 0.94, x, k.wallTop - 0.52, 0, skin);
    lay.sb.box(1.06, 0.22, 1.06, x, k.wallTop - 0.32, 0, MUDBRICK_DARK);
  }
  // The basins and their niches, along three walls.
  const basins: [Side, number, number][] = [
    ["+z", -zi, -3.4],
    ["+z", -zi, 3.4],
    ["+z", -zi, -5.9],
    ["+z", -zi, Math.min(5.9, xMax - 0.5)],
    ["-z", -zi, -6.0],
    ["-z", -zi, -3.0],
    ["-z", -zi, 0],
    ["-z", -zi, Math.min(3.0, xMax - 0.5)],
    ["+x", -xi, -3.0],
    ["+x", -xi, 0.4],
  ];
  for (const [s, plane, u] of basins) basin(lay, s, plane, u, skin);
}

/** A stone basin on the wall with its brass tap, and a pointed soap niche over it. */
function basin(lay: Lay, s: Side, plane: number, u: number, skin: string): void {
  const back = hideBack(s);
  // An inner face is named for the way it LOOKS, so its plane is the wall's
  // inner face measured the other way: `-(d / 2 - T)` for all three.
  const pl = plane;
  lay.sb.onFace(s, pl, u, PLINTH + 0.3, 0.42, 0.5, 0.2, 0.1, skin, 0, 0, back);
  lay.sb.onFace(s, pl, u, PLINTH + 0.6, 0.66, 0.14, 0.3, 0.15, skin, 0, 0, back);
  lay.sb.onFace(s, pl, u, PLINTH + 0.674, 0.5, 0.01, 0.18, 0.15, WINDOW_VOID, 0, 0, back);
  lay.sb.onFace(s, pl, u, PLINTH + 0.88, 0.06, 0.12, 0.14, 0.07, ALLOY, 0, 0, back);
  slabOn(lay, s, pl, pointed(u, PLINTH + 1.15, 0.34, 0.3, 0.22), 0, 0.012, MUDBRICK_DARK);
}
