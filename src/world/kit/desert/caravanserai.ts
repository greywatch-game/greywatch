/**
 * kit/desert/caravanserai.ts — buildCaravanserai: a khan of the Ottoman
 * centuries on the caravan roads of the river provinces — four ranges of
 * rooms round a paved court with a well in it, one gate through a tall framed
 * portal between two towers, and a walked terrace over the whole of it — and
 * `arcade`, the punched wall run its inner faces are made of. Part of the
 * desert-town set: follows the contract in kit/core.ts and the set's rules in
 * `./index.ts`. Invariants: colliders in the set's order, restated at the top
 * of the builder, and the masses over them drawn after everything laid on
 * them; variation is seeded off where it stands (`streetSeed`), never
 * `Math.random()`. Never imports another builder.
 */
import { CONFIG } from "../../../config";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import { mulberry32 } from "../../rng";
import {
  Build,
  IRON,
  carve,
  convexSolid,
  hideBack,
  runsAlongX,
  streetSeed,
  type BuildCtx,
  type BuildParams,
  type Side,
  type Structure,
} from "../core";
import {
  MUDBRICK,
  MUDBRICK_DARK,
  ROOF_MUD,
  PALM_BEAM,
  PLINTH,
  SANDBAG,
  SCORCH,
  SLAB,
  STOREY,
  PARAPET,
  PARAPET_T,
  GRADE,
  WINDOW_VOID,
  levels,
  clothHash,
  drape,
} from "./shared";
import {
  HIDE_DOWN,
  Lay,
  TAU,
  above,
  archRing,
  band,
  blindBay,
  disc,
  kufic,
  merlons,
  pocks,
  pointed,
  slabOn,
  star,
} from "./lay";

/** A collider and the mass drawn over it, as one record. */
interface Mass {
  w: number;
  h: number;
  d: number;
  x: number;
  y: number;
  z: number;
}

/** The gate's clear width, through the outer wall. */
const GATE = 4.6;
/** An inner arcade's openings: width and clear height. */
const GAP_W = 2.3;
const GAP_H = 2.35;
/** The gate passage's two walls stand this far either side of the axis. */
const PASSAGE = 2.85;
/** The portal's half width on the front, and its height over the parapet. */
const PISH = 4.0;
const SCREEN = 2.0;
/** The four outer elevations. */
const SIDES = ["-z", "+z", "-x", "+x"] as const;

/**
 * A wall run punched with evenly spaced openings, along X or along Z.
 *
 * The third form of wall this set needs, and the one `doorWall` cannot be:
 * that one puts ONE gap in the middle of a run along X, which is what a house's
 * front is. An arcade is a row of them, and the building below that has a
 * courtyard is defined by the fact that its inner face is more opening than
 * wall — a range you can enter anywhere is a building a squad flows through,
 * and a range with one door is a building they queue at.
 *
 * The lintels over the gaps are colliders and not drawing, which is the
 * honest answer for mud brick: a lintel course at head height stops a round
 * fired at the roof line from the far side of the court, and leaving it
 * visual would let one through a wall that visibly has none.
 *
 * It DECLARES nothing: it hands back the boxes, piers first and then lintels,
 * for the caller to declare in its order and draw after its detail, and the
 * centre of each opening along the run.
 */
function arcade(
  alongZ: boolean,
  len: number,
  h: number,
  t: number,
  cx: number,
  y: number,
  cz: number,
  gaps: number,
  gapW = GAP_W,
  gapH = GAP_H,
): { boxes: Mass[]; at: number[] } {
  const seg = (len - gaps * gapW) / (gaps + 1);
  const boxes: Mass[] = [];
  const put = (span: number, height: number, at: number, cy: number): void => {
    if (span <= 0.06 || height <= 0.06) return;
    const x = alongZ ? cx : cx + at;
    const z = alongZ ? cz + at : cz;
    boxes.push({ w: alongZ ? t : span, h: height, d: alongZ ? span : t, x, y: cy, z });
  };
  for (let i = 0; i <= gaps; i++) {
    put(seg, h, -len / 2 + i * (seg + gapW) + seg / 2, y);
  }
  const lintel = h - gapH;
  const at: number[] = [];
  for (let i = 0; i < gaps; i++) {
    const u = -len / 2 + seg + i * (seg + gapW) + gapW / 2;
    at.push(u);
    put(gapW, lintel, u, y + h / 2 - lintel / 2);
  }
  return { boxes, at };
}

/** What every part of the drawing is measured from. */
interface Khan {
  w: number;
  d: number;
  t: number;
  courtW: number;
  courtD: number;
  roofY: number;
  wallTop: number;
  skin: string;
  /** The brick under the render, where the render has gone. */
  brick: string;
  rnd: () => number;
}

/** The flight's numbers, as `Build.flight` takes them. */
interface Flight {
  x: number;
  w: number;
  topZ: number;
  topY: number;
  run: number;
  rise: number;
  steps: number;
}

/**
 * The caravanserai: a khan of the Ottoman centuries on the caravan roads of
 * the river provinces — an inn built as a fort, four ranges of rooms round a
 * court, one gate, and a walked terrace over the whole of it.
 *
 * ## What it is FOR, and why a map wants one rather than ten
 *
 * Every other enclosure in this town is a COMPOUND — a wall with one side left
 * open, which the nav graph routes through and a squad walks into without
 * slowing down. This is the opposite object and the only one on the map: a
 * closed rectangle with a single passage through it, ranges you fight along,
 * and a terrace all the way round the top that overlooks its own court and the
 * streets outside it in the same breath.
 *
 * So it plays as the one place the fight has a DOOR. Holding the terrace is
 * holding the gate; taking it is either eight metres of passage and a door
 * the width of one man at its end, or getting onto a range roof off a
 * neighbouring house and dropping in. Both are on purpose, and the second is
 * why the terrace is at an ordinary storey rather than two — a fort with no
 * way in but the gate is a fort that is never taken, which is a boring flag.
 *
 * ## The construction, and the three things that are not obvious
 *
 * **The terrace is FOUR slabs and not one.** Two span the full width along ±Z
 * and two fill what is left along ±X, which is what leaves the court open; the
 * corners belong to the ±Z pair, so nothing is drawn twice and nothing is
 * missing. The parapets come in pairs for the same reason: an outer one
 * standing on the outer wall, which costs no walked cell (`parapet`'s
 * argument), and an inner one on the court's edge, which costs one and is worth
 * it — a terrace you can be shot off from inside your own court is not a
 * terrace.
 *
 * **The stair is a straight flight in the court**, `Build.flight` rather than
 * the lane every other climbed building here uses. There is no lane because
 * there is no plate to cut one out of: the walked surface is a RING, and a ring
 * has an inside edge a flight can land on anywhere — provided the inner
 * parapet is OPEN where it lands, which it is: the +Z run is two, either side
 * of the flight's head. It runs along Z because `flight` does.
 *
 * **The gate passage ENDS in a door**: the -Z inner arcade is punched three
 * times like the others, and its middle opening is on the passage's axis.
 * The passage is wider than that door on purpose — the gate is a cart's
 * width and the way into the court is a man's.
 *
 * `width` and `depth` are the OUTER footprint and the court is what is left
 * after `RANGE` off each side, so a serai under about 28 m has no court at all
 * and one under about 32 m of depth has no room for its own stair. The DEV
 * throw below says which rather than emitting a solid block with a terrace
 * nothing reaches.
 *
 * ## The colliders
 *
 * The plinth, the flight, the outer walls round the gate, the passage's two
 * walls, the four inner arcades, the side ranges' cross walls, the four
 * terrace slabs, the outer and inner parapets, the two gate towers and the
 * court's twelve piers, in that order — then two more: the portal's screen,
 * standing on the parapet over the gate (a wall of brick a man on the terrace
 * stands behind, so it stops a round), and the well's curb in the middle of
 * the court, the one piece of cover in it.
 *
 * ## The drawing
 *
 * Everything after the colliders is laid into one `Lay` and keeps to the
 * three rules: on a face, low enough to step over, or standing on a collider
 * or overhead. Outside: a dark footing, buttress pilasters with corner
 * pilasters that read as towers, a slit vent in every bay, a string course at
 * the terrace, a band of brick lozenges under the parapet's cap, a low stepped
 * crest along it with a horn at each corner, timber spouts and their stains,
 * shell scars down to the brick, a bricked-up postern at the back. The gate is
 * a portal (a pishtaq): a frame standing proud of the wall to over the
 * parapet, a pointed arch over the flat-headed gate with a palm-wood grille in
 * its tympanum, lozenge brick in its spandrels, a niche on each jamb, an
 * inscription in brick, and a crest; the studded leaves stand open against the
 * passage's walls, under a palm-log ceiling and over a guard's bench each
 * side. The court is paved, and every inner face is a dado, pilasters, a blind
 * arch with a grilled window in every bay, and a pointed head over every door;
 * the side ranges' piers carry a palm beam on timber brackets, joists back to
 * the wall and the awnings; the stair is brick, solid where nothing passes
 * under it and on two palm logs where something does; the well has its
 * gallows, pulley and bucket and a trough beside it. The towers are slit,
 * banded and crenellated; the terrace has its roof lights; the rooms have
 * their ceilings.
 */
export function buildCaravanserai(
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(mats, "serai");
  const w = p.width ?? 44;
  const d = p.depth ?? 38;
  const skin = p.tint ?? MUDBRICK;
  /** How deep a range of rooms is. One number: the four ranges are the same. */
  const RANGE = 7.5;
  const t = 0.55;
  const ys = levels(1, STOREY);
  const roofY = ys[1];
  const wallTop = roofY - SLAB;
  const courtW = w - 2 * RANGE;
  const courtD = d - 2 * RANGE;
  const rise = roofY - ys[0];
  const run = rise / GRADE;

  if (import.meta.env.DEV && (courtW < 9 || courtD < run + 3)) {
    throw new Error(
      `caravanserai: ${w} x ${d} leaves a ${courtW.toFixed(1)} x ${courtD.toFixed(1)} m ` +
        `court, which cannot hold the ${run.toFixed(1)} m flight up to its own ` +
        "terrace. Widen it; see kit/desert/caravanserai.ts.",
    );
  }

  // --- the colliders, restated in their order ----------------------------------
  const masses: [Mass, string][] = [];
  const wall = (m: Mass, color: string): void => {
    b.block(m);
    masses.push([m, color]);
  };

  // 1 — the plinth: the whole footprint, gate passage included.
  const plinth: Mass = { w: w + 0.6, h: PLINTH, d: d + 0.6, x: 0, y: PLINTH / 2, z: 0 };
  b.block(plinth);
  masses.push([plinth, MUDBRICK_DARK]);

  // 2 — the flight, in the court, landing on the +Z range's inner edge. Its
  // collider only: the brick stair is drawn below.
  const flight: Flight = {
    x: -courtW * 0.22,
    w: 3.0,
    topZ: courtD / 2,
    topY: roofY,
    run,
    rise,
    steps: Math.max(10, Math.round(rise / 0.19)),
  };
  b.flight({ ...flight, dir: 1, color: PALM_BEAM, drawn: false });

  // 4 — the walls. Outer first, then the four inner faces onto the court.
  const h = wallTop - PLINTH;
  const mid = PLINTH + h / 2;
  // The gate: `doorWall(w, h, t, 0, mid, -(d - t) / 2, skin, 4.6, 3.0)` spelled
  // out. Its lintel course would be `h - 3.0` deep, under the 0.05 it is
  // emitted from, so there is none: the terrace slab is the gate's head.
  const jamb = (w - GATE) / 2;
  const off = GATE / 2 + jamb / 2;
  const zF = -(d - t) / 2;
  wall({ w: jamb, h, d: t, x: 0 - off, y: mid, z: zF }, skin);
  wall({ w: jamb, h, d: t, x: 0 + off, y: mid, z: zF }, skin);
  wall({ w, h, d: t, x: 0, y: mid, z: (d - t) / 2 }, skin);
  for (const sx of [-1, 1] as const) {
    wall({ w: t, h, d: d - 2 * t, x: (sx * (w - t)) / 2, y: mid, z: 0 }, skin);
  }
  // The passage's own two walls, which is what makes it a passage rather than a
  // hole: seven metres of corridor with the court's door at the end of it.
  for (const sx of [-1, 1] as const) {
    wall({ w: t, h, d: RANGE, x: sx * PASSAGE, y: mid, z: -(d - RANGE) / 2 }, skin);
  }
  // The inner faces: all four arcades — a range you enter anywhere — and the
  // -Z one's middle opening is the passage's mouth.
  const inner = [
    arcade(false, courtW + 2 * t, h, t, 0, mid, (courtD + t) / 2, 3),
    arcade(false, courtW + 2 * t, h, t, 0, mid, -(courtD + t) / 2, 3),
  ];
  for (const sx of [-1, 1] as const) {
    inner.push(arcade(true, courtD, h, t, (sx * (courtW + t)) / 2, mid, 0, 3));
  }
  for (const a of inner) for (const m of a.boxes) wall(m, skin);
  // The cross walls that make the side ranges into ROOMS rather than one
  // corridor each. Two per range, so a body can still get down one.
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      wall({ w: RANGE - t, h, d: t, x: (sx * (w - RANGE)) / 2, y: mid, z: (sz * courtD) / 3 }, skin);
    }
  }

  // 5 — the terrace, four slabs. See `buildCaravanserai`'s header.
  for (const sz of [-1, 1] as const) {
    wall({ w, h: SLAB, d: RANGE, x: 0, y: roofY - SLAB / 2, z: (sz * (d - RANGE)) / 2 }, ROOF_MUD);
  }
  for (const sx of [-1, 1] as const) {
    wall({ w: RANGE, h: SLAB, d: courtD, x: (sx * (w - RANGE)) / 2, y: roofY - SLAB / 2, z: 0 }, ROOF_MUD);
  }

  // 6 — the parapets, outer (shared `parapet`'s arithmetic) then inner.
  const py = roofY + PARAPET / 2;
  for (const sz of [-1, 1] as const) {
    wall({ w, h: PARAPET, d: PARAPET_T, x: 0, y: py, z: (sz * (d - PARAPET_T)) / 2 }, skin);
  }
  const runD = d - 2 * PARAPET_T;
  for (const sx of [-1, 1] as const) {
    wall({ w: PARAPET_T, h: PARAPET, d: runD, x: (sx * (w - PARAPET_T)) / 2, y: py, z: 0 }, skin);
  }
  // The +Z inner run is two, either side of where the flight lands: a stair
  // that arrives at a parapet arrives nowhere.
  const landing: [number, number] = [flight.x - flight.w / 2 - 0.1, flight.x + flight.w / 2 + 0.1];
  for (const sz of [-1, 1] as const) {
    const z = (sz * (courtD + PARAPET_T)) / 2;
    const runs = sz < 0 ? [[-courtW / 2, courtW / 2]] : carve(-courtW / 2, courtW / 2, [landing]);
    for (const [a, c] of runs) wall({ w: c - a, h: PARAPET, d: PARAPET_T, x: (a + c) / 2, y: py, z }, skin);
  }
  for (const sx of [-1, 1] as const) {
    wall({ w: PARAPET_T, h: PARAPET, d: courtD, x: (sx * (courtW + PARAPET_T)) / 2, y: py, z: 0 }, skin);
  }

  // 7 — the two gate towers, flanking the passage and standing off the terrace.
  // They are the silhouette from outside and the strongest position on it from
  // inside: everything else up here is chest cover, and these are a wall.
  const TOWER = 2.9;
  const towerZ = -(d - RANGE) / 2;
  for (const sx of [-1, 1] as const) {
    wall({ w: 3.5, h: TOWER, d: 3.5, x: sx * 5.8, y: roofY + TOWER / 2, z: towerZ }, skin);
  }

  // The court's piers, in front of the two side ranges, carrying a beam and the
  // awnings: `buildSouk`'s construction, and the reuse is deliberate — the two
  // are the same street furniture in different plans.
  const bays = Math.max(3, Math.round(courtD / 4.2));
  const pierZ: number[] = [];
  for (let i = 0; i <= bays; i++) pierZ.push(-courtD / 2 + (i / bays) * courtD);
  for (const sx of [-1, 1] as const) {
    const px = (sx * (courtW - 1.6)) / 2;
    for (const z of pierZ) wall({ w: 0.7, h: 2.5, d: 0.7, x: px, y: PLINTH + 1.25, z }, MUDBRICK);
  }

  // 8 — the portal's screen, on the parapet over the gate: the frame rises
  // SCREEN over the parapet, and a man on the terrace behind it is behind brick.
  const capY = roofY + PARAPET;
  wall({ w: 2 * PISH, h: SCREEN, d: PARAPET_T, x: 0, y: capY + SCREEN / 2, z: -(d - PARAPET_T) / 2 }, skin);
  // 9 — the well's curb, in the middle of the court: the one piece of cover in
  // twenty-nine metres of open paving, low enough to fight over.
  const WELL = 0.8;
  b.block({ w: 1.9, h: WELL, d: 1.9, x: 0, y: PLINTH + WELL / 2, z: 0 });

  // --- the drawing -----------------------------------------------------------------
  const k: Khan = {
    w,
    d,
    t,
    courtW,
    courtD,
    roofY,
    wallTop,
    skin,
    brick: skin === MUDBRICK ? ROOF_MUD : MUDBRICK,
    rnd: mulberry32(streetSeed(w, d, STOREY, ctx)),
  };
  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };
  const lay = new Lay();
  exterior(lay, k, ground);
  portal(lay, k);
  passage(lay, k);
  const stair = stairOf(flight);
  paving(lay, k, stair);
  court(lay, k, inner.map((a) => a.at));
  riwaq(lay, k, pierZ);
  drawStair(lay, k, flight, stair);
  well(lay, k);
  terrace(lay, k, landing);
  towers(lay, k, towerZ, TOWER);
  ceilings(lay, k);
  lay.flush(b);

  // The ramp up onto the plinth in front of the gate, carried to the ground.
  const rz0 = -(d + 0.6) / 2;
  const rz1 = rz0 - 1.3;
  const g = Math.min(0, ground(-GATE / 2, rz1), ground(GATE / 2, rz1));
  const prof = (x: number): [number, number, number][] => [
    [x, PLINTH, rz0],
    [x, g, rz1],
    [x, g, rz0],
  ];
  convexSolid(b, prof(-GATE / 2 - 0.3), prof(GATE / 2 + 0.3), MUDBRICK_DARK);

  // --- the masses, after what is laid on them ------------------------------------
  for (const [m, color] of masses) b.box(m.w, m.h, m.d, m.x, m.y, m.z, color);

  // The awnings between the piers.
  for (const sx of [-1, 1] as const) {
    const px = (sx * (courtW - 1.6)) / 2;
    for (let i = 0; i < bays; i++) {
      b.translucentBox(
        1.9,
        0.08,
        courtD / bays - 0.5,
        px - sx * 1.35,
        PLINTH + 2.42,
        -courtD / 2 + ((i + 0.5) / bays) * courtD,
        i % 2 === 0 ? "#a8703f" : "#8d6a4a",
        CONFIG.graphics.translucency.awning,
        { z: -sx * 0.11 },
      );
    }
  }

  // The washing over the court, on the -Z range's inner parapet. ONE drape and
  // not a line of them: this is the biggest thing in the town and the point of
  // cloth on it is that the eye finds the one thing moving, which a row of six
  // is not.
  const hung = clothHash(w, d);
  drape(b, 0.9 + hung * 0.4, 1.0, courtW * 0.2, roofY + PARAPET, -(courtD + PARAPET_T) / 2, -1, hung);
  return b;
}

// --- arches --------------------------------------------------------------------

/** How far a pointed arch of span `S` and rise `R` is above its springing at `x` off its axis. */
function archY(S: number, R: number, x: number): number {
  const c = Math.max(0, (R * R - (S * S) / 4) / S);
  const r = c + S / 2;
  const q = Math.abs(x) + c;
  return q >= r ? 0 : Math.sqrt(r * r - q * q);
}

/**
 * Half the width of the same arch `dy` over its springing, struck `grow`
 * outside its intrados — 0 above the apex.
 */
function chord(S: number, R: number, dy: number, grow = 0): number {
  const c = Math.max(0, (R * R - (S * S) / 4) / S);
  const r = c + S / 2 + grow;
  if (dy <= 0) return S / 2 + grow;
  if (dy >= r) return 0;
  return Math.max(0, Math.sqrt(r * r - dy * dy) - c);
}

/**
 * A slit vent: a pointed slot a hand wide in a dark pointed reveal — the only
 * opening a khan's outer wall has, high enough that nothing is handed through
 * it.
 */
function slit(lay: Lay, s: Side, plane: number, u: number, sill: number, tall: number): void {
  slabOn(lay, s, plane, pointed(u, sill, 0.5, tall, 0.28), 0, 0.03, MUDBRICK_DARK);
  slabOn(lay, s, plane, pointed(u, sill + 0.1, 0.16, tall - 0.12, 0.1), 0.03, 0.045, WINDOW_VOID);
  lay.sb.onFace(s, plane, u, sill - 0.04, 0.66, 0.08, 0.1, 0.05, MUDBRICK_DARK, 0, 0, hideBack(s));
}

/**
 * Where the render has come off a face: two or three overlapping lobes of the
 * wall's shade, and the courses of brick showing in the biggest, with what
 * fell lying on the plinth under it.
 */
function scar(lay: Lay, k: Khan, s: Side, plane: number, u: number, y: number, r: number): void {
  const { rnd } = k;
  const back = hideBack(s);
  const lobes = 2 + Math.floor(rnd() * 2);
  let first: { cu: number; cy: number; ru: number; ry: number } | null = null;
  for (let i = 0; i < lobes; i++) {
    const cu = u + (i === 0 ? 0 : (rnd() - 0.5) * r * 1.3);
    const cy = y + (i === 0 ? 0 : (rnd() - 0.5) * r * 0.7);
    const ru = r * (i === 0 ? 0.85 : 0.45 + rnd() * 0.3);
    const ry = ru * (0.62 + rnd() * 0.25);
    const ph = rnd() * TAU;
    const pts: [number, number][] = [];
    for (let j = 0; j < 9; j++) {
      const a = ph + (j / 9) * TAU;
      pts.push([cu + Math.cos(a) * ru, cy + Math.sin(a) * ry]);
    }
    slabOn(lay, s, plane, pts, 0, 0.012, MUDBRICK_DARK);
    if (!first) first = { cu, cy, ru, ry };
  }
  if (!first) return;
  const { cu, cy, ru, ry } = first;
  let row = 0;
  for (let yy = cy - ry * 0.72; yy <= cy + ry * 0.72; yy += 0.13, row++) {
    const q = (yy - cy) / ry;
    const hw = ru * Math.sqrt(Math.max(0, 1 - q * q)) * 0.82;
    for (let x = -hw + (row % 2) * 0.19; x + 0.3 <= hw; x += 0.38) {
      lay.sb.onFace(s, plane, cu + x + 0.17, yy, 0.34, 0.075, 0.02, 0.02, k.brick, 0, 0, back);
    }
  }
  // What came down, on the plinth.
  for (let i = 0; i < 4; i++) {
    const sz = 0.1 + rnd() * 0.14;
    lay.sb.onFace(s, plane, cu + (rnd() - 0.5) * ru * 1.6, PLINTH + sz * 0.3, sz, sz * 0.6, sz * 0.9, 0.08 + rnd() * 0.16, i % 2 ? k.skin : k.brick, 0, rnd() * 1.4, HIDE_DOWN);
  }
}

// --- outside -----------------------------------------------------------------------

/**
 * The four elevations: a footing, buttress pilasters and corner pilasters, a
 * slit in every bay, the string course at the terrace and the lozenge band
 * under the cap, spouts, pocks and a scar or two — and at the back, a postern
 * bricked up. The portal's stretch of the front is `portal`'s.
 */
function exterior(lay: Lay, k: Khan, ground: (lx: number, lz: number) => number): void {
  const { w, d, skin, rnd } = k;
  const capLo = k.roofY + PARAPET;
  for (const s of SIDES) {
    const along = runsAlongX(s);
    const len = along ? w : d;
    const plane = along ? d / 2 : w / 2;
    const back = hideBack(s);
    const front = s === "-z";
    const runs = carve(-len / 2, len / 2, front ? [[-PISH, PISH]] : []);
    /** A run's ends, carried round the corner by `by` where it reaches one. */
    const ext = (a: number, c: number, by: number): [number, number, number] => {
      const a1 = a <= -len / 2 + 1e-6 ? a - by : a;
      const c1 = c >= len / 2 - 1e-6 ? c + by : c;
      return [(a1 + c1) / 2, c1 - a1, 0];
    };
    for (const [a, c] of runs) {
      const [fu, fl] = ext(a, c, 0.1);
      lay.sb.onFace(s, plane, fu, PLINTH + 0.3, fl, 0.6, 0.1, 0.05, MUDBRICK_DARK, 0, 0, back);
      const [su, sl] = ext(a, c, 0.16);
      lay.sb.onFace(s, plane, su, k.wallTop + 0.03, sl, 0.18, 0.16, 0.08, MUDBRICK_DARK, 0, 0, back);
    }
    // The plinth's face carried down to the ground, where the ground falls away.
    let low = 0;
    for (let i = 0; i <= 8; i++) {
      const u = -len / 2 + (i / 8) * len;
      const o = plane + 0.35;
      const lx = along ? u : (s === "+x" ? o : -o);
      const lz = along ? (s === "+z" ? o : -o) : u;
      low = Math.min(low, ground(lx, lz));
    }
    if (low < -0.03) lay.sb.onFace(s, plane, 0, low / 2, len + 0.6, -low, 0.3, 0.15, MUDBRICK_DARK, 0, 0, back);

    // Pilasters: buttresses between the bays, and a broader one at each corner
    // that meets its neighbour round the arris.
    const nb = Math.max(3, Math.round(len / 5.5));
    const bw = len / nb;
    const pilaster = (u: number, wide: number): void => {
      lay.sb.onFace(s, plane, u, (PLINTH + capLo) / 2, wide, capLo - PLINTH, 0.14, 0.07, skin, 0, 0, back);
      lay.sb.onFace(s, plane, u, PLINTH + 0.45, wide + 0.2, 0.9, 0.24, 0.12, MUDBRICK_DARK, 0, 0, back);
      lay.sb.onFace(s, plane, u, capLo + 0.07, wide + 0.1, 0.14, 0.22, 0.11, MUDBRICK_DARK, 0, 0, back);
    };
    for (let i = 1; i < nb; i++) {
      const u = -len / 2 + i * bw;
      if (front && Math.abs(u) < PISH + 0.6) continue;
      pilaster(u, 0.9);
    }
    for (const e of [-1, 1]) pilaster(e * (len / 2 - 0.6 + 0.12), 1.44);

    // The bays.
    const postern = s === "+z" ? 1 + Math.floor(rnd() * (nb - 2)) : -1;
    const scarred = 1 + Math.floor(rnd() * (nb - 2));
    for (let i = 0; i < nb; i++) {
      const uc = -len / 2 + (i + 0.5) * bw;
      if (front && Math.abs(uc) < PISH + 0.5) continue;
      const a = -len / 2 + i * bw + (i === 0 ? 1.4 : 0.5);
      const c = -len / 2 + (i + 1) * bw - (i === nb - 1 ? 1.4 : 0.5);
      // The lozenge band on the parapet's face.
      const fy = capLo - 0.5;
      for (const y of [fy - 0.22, fy + 0.22]) lay.sb.onFace(s, plane, (a + c) / 2, y, c - a, 0.045, 0.03, 0.015, MUDBRICK_DARK, 0, 0, back);
      const n = Math.floor((c - a - 0.1) / 0.42);
      for (let j = 0; j < n; j++) {
        lay.sb.onFace(s, plane, (a + c) / 2 + (j - (n - 1) / 2) * 0.42, fy, 0.2, 0.2, 0.04, 0.02, MUDBRICK_DARK, Math.PI / 4, 0, back);
      }
      if (i === postern) {
        bricked(lay, k, s, plane, uc);
        continue;
      }
      slit(lay, s, plane, uc, 1.55, 0.95);
      if (rnd() < 0.22) {
        // A burn out of the vent, up the wall over it.
        slabOn(lay, s, plane, [[uc - 0.2, 2.7], [uc + 0.22, 2.7], [uc + 0.12, 3.0], [uc - 0.05, 3.05], [uc - 0.16, 2.95]], 0.004, 0.009, SCORCH);
      }
      if (rnd() < 0.5) {
        // A spout through the parapet's foot, and what its water left.
        const su = uc + (rnd() < 0.5 ? -1 : 1) * bw * 0.27;
        lay.sb.onFace(s, plane, su, k.roofY + 0.12, 0.14, 0.12, 0.62, 0.31, PALM_BEAM, 0, 0, back);
        const st = 0.6 + rnd() * 0.6;
        lay.sb.onFace(s, plane, su, k.roofY + 0.03 - 0.22, 0.17, 0.44, 0.02, 0.012, MUDBRICK_DARK, 0, 0, back);
        lay.sb.onFace(s, plane, su, k.wallTop - 0.08 - st / 2, 0.15 + rnd() * 0.08, st, 0.02, 0.012, MUDBRICK_DARK, 0, 0, back);
      }
      if (i === scarred) scar(lay, k, s, plane, uc + (rnd() - 0.5) * bw * 0.4, 0.9 + rnd() * 0.5, 0.7 + rnd() * 0.35);
      pocks(lay, s, plane, a + 0.1, c - 0.1, 0.8, 2.9, 4, rnd);
    }
  }
}

/** A postern, bricked up: its arch and jambs still in the wall, the blocking in other brick. */
function bricked(lay: Lay, k: Khan, s: Side, plane: number, u: number): void {
  const back = hideBack(s);
  const span = 1.7;
  const rise = 0.95;
  const ys = 2.0;
  slabOn(lay, s, plane, pointed(u, PLINTH, span, ys - PLINTH, rise), 0, 0.02, k.brick);
  for (let y = PLINTH + 0.22; y < ys + rise - 0.25; y += 0.22) {
    const hw = chord(span, rise, y - ys) - 0.08;
    if (hw > 0.1) lay.sb.onFace(s, plane, u, y, 2 * hw, 0.03, 0.02, 0.025, MUDBRICK_DARK, 0, 0, back);
  }
  archRing(lay, s, plane, u, ys, span, rise, 0.24, 0.1, 0.05, MUDBRICK_DARK);
  for (const e of [-1, 1]) lay.sb.onFace(s, plane, u + e * (span / 2 + 0.12), (PLINTH + ys) / 2, 0.24, ys - PLINTH, 0.1, 0.05, MUDBRICK_DARK, 0, 0, back);
  lay.sb.onFace(s, plane, u, PLINTH + 0.04, span + 0.5, 0.08, 0.2, 0.1, MUDBRICK_DARK, 0, 0, back);
}

/**
 * The portal on the front: a frame standing 0.16 proud from the plinth to the
 * screen's top, a pointed arch in a dark ring over the gate's flat head, the
 * lintel, a palm-wood grille with a star in it filling the tympanum, lozenge
 * brick in the spandrels, a niche on each jamb, a dark border round it all,
 * an inscription in brick above, a cornice and a crest.
 */
function portal(lay: Lay, k: Khan): void {
  const s: Side = "-z";
  const P = k.d / 2;
  const back = hideBack(s);
  const O = 0.16;
  const top = k.roofY + PARAPET + SCREEN;
  const head = k.wallTop;
  const half = GATE / 2;
  // The frame: two jambs to the gate's head, and the head over it.
  for (const e of [-1, 1]) {
    lay.sb.onFace(s, P, e * (half + (PISH - half) / 2), (PLINTH + head) / 2, PISH - half, head - PLINTH, O, O / 2, k.skin, 0, 0, back);
    lay.sb.onFace(s, P, e * (half + (PISH - half) / 2), PLINTH + 0.275, PISH - half + 0.02, 0.55, 0.06, O + 0.03, MUDBRICK_DARK, 0, 0, back);
  }
  lay.sb.onFace(s, P, 0, (head + top) / 2, 2 * PISH, top - head, O, O / 2, k.skin, 0, 0, back);

  // The arch over the gate, and its legs down the jambs.
  const S = GATE + 0.3;
  const R = 2.6;
  const Y0 = 2.95;
  const ring = 0.32;
  archRing(lay, s, P, 0, Y0, S, R, ring, 0.12, O + 0.06, MUDBRICK_DARK);
  for (const e of [-1, 1]) lay.sb.onFace(s, P, e * (S / 2 + ring / 2), (PLINTH + Y0) / 2, ring, Y0 - PLINTH, 0.12, O + 0.06, MUDBRICK_DARK, 0, 0, back);
  // The lintel, and the grille over it.
  const L = head + 0.2;
  lay.sb.onFace(s, P, 0, head + 0.1, S, 0.2, 0.14, O + 0.07, PALM_BEAM, 0, 0, back);
  const tym = above(pointed(0, Y0 - 0.1, S, 0.1, R), L);
  if (tym.length >= 3) slabOn(lay, s, P, tym, O, O + 0.015, WINDOW_VOID);
  for (let x = -S / 2 + 0.32; x <= S / 2 - 0.3; x += 0.35) {
    const yt = Y0 + archY(S, R, x) - 0.03;
    if (yt - L > 0.1) lay.sb.onFace(s, P, x, (L + yt) / 2, 0.06, yt - L, 0.04, O + 0.035, PALM_BEAM, 0, 0, back);
  }
  for (const y of [3.85, 4.4, 4.95]) {
    const hw = chord(S, R, y - Y0) - 0.03;
    if (hw > 0.1) lay.sb.onFace(s, P, 0, y, 2 * hw, 0.06, 0.04, O + 0.035, PALM_BEAM, 0, 0, back);
  }
  star(lay, s, P, 0, 4.4, 0.46, O + 0.07, PALM_BEAM);

  // The border round it all, and the lozenges between it and the arch.
  const bx = PISH - 0.3;
  const by = Y0 + R + ring + 0.1;
  for (const e of [-1, 1]) lay.sb.onFace(s, P, e * bx, (PLINTH + 0.55 + by) / 2, 0.16, by - PLINTH - 0.55, 0.06, O + 0.03, MUDBRICK_DARK, 0, 0, back);
  lay.sb.onFace(s, P, 0, by, 2 * bx + 0.16, 0.14, 0.06, O + 0.03, MUDBRICK_DARK, 0, 0, back);
  for (let row = 0, y = 3.55; y < by - 0.2; row++, y += 0.36) {
    const hw = chord(S, R, y - Y0, ring + 0.12);
    for (let x = -bx + 0.26 + (row % 2) * 0.18; x <= bx - 0.26; x += 0.36) {
      if (Math.abs(x) < hw) continue;
      lay.sb.onFace(s, P, x, y, 0.17, 0.17, 0.03, O + 0.015, MUDBRICK_DARK, Math.PI / 4, 0, back);
    }
  }
  // A niche on each jamb, between the arch's leg and the border.
  const nu = (S / 2 + ring + bx - 0.08) / 2;
  for (const e of [-1, 1]) {
    slabOn(lay, s, P, pointed(e * nu, 1.0, 0.56, 1.0, 0.34), O, O + 0.012, MUDBRICK_DARK);
    lay.sb.onFace(s, P, e * nu, 0.97, 0.74, 0.07, 0.1, O + 0.05, PALM_BEAM, 0, 0, back);
  }
  // The inscription, the cornice and the crest.
  const ky = by + 0.1;
  const KH = Math.min(0.4, top - 0.18 - ky);
  lay.sb.onFace(s, P, 0, ky + KH / 2, 2 * bx + 0.16, KH + 0.04, 0.02, O + 0.01, MUDBRICK_DARK, 0, 0, back);
  kufic((u, y, along, tall) => lay.sb.onFace(s, P, u, y, along, tall, 0.04, O + 0.04, k.skin, 0, 0, back), -bx + 0.1, bx - 0.1, ky, KH, k.rnd);
  lay.sb.onFace(s, P, 0, top - 0.07, 2 * PISH + 0.3, 0.14, 0.42, O, MUDBRICK_DARK);
  merlons(lay, s, P, 0, 2 * PISH, top, 0.12, k.skin);
  for (const e of [-1, 1]) pocks(lay, s, P + O, e < 0 ? -PISH + 0.2 : half + 0.5, e < 0 ? -half - 0.5 : PISH - 0.2, 0.8, 3.0, 5, k.rnd);
}

// --- the passage -------------------------------------------------------------------

/**
 * The gate passage: a palm-log ceiling on a girder down each side, a dark dado,
 * a guard's bench and two lamp niches each side, the studded leaves standing
 * open against its walls, the wicket in one of them, and the court's door at
 * its end framed as the court frames it.
 */
function passage(lay: Lay, k: Khan): void {
  const xi = PASSAGE - k.t / 2;
  const z0 = -k.d / 2;
  const z1 = -(k.courtD / 2 + k.t);
  const head = k.wallTop;
  for (let z = z0 + 0.3; z <= z1 - 0.12; z += 0.48) {
    lay.sb.box(2 * xi, 0.14, 0.15, 0, head - 0.07, z, PALM_BEAM, undefined, 1 << 2);
  }
  for (const e of [-1, 1]) {
    lay.sb.box(0.22, 0.22, z1 - z0, e * (xi - 0.11), head - 0.25, (z0 + z1) / 2, PALM_BEAM, undefined, 1 << 2);
  }
  const hinge = z0 + 0.25;
  const LEAF = GATE / 2;
  const benchZ0 = hinge + LEAF + 0.25;
  for (const e of [-1, 1] as const) {
    const s: Side = e < 0 ? "+x" : "-x";
    const plane = -xi;
    const back = hideBack(s);
    for (const [a, c] of carve(z0 + 0.55, z1, [[hinge - 0.05, hinge + LEAF + 0.05]])) {
      lay.sb.onFace(s, plane, (a + c) / 2, PLINTH + 0.35, c - a, 0.7, 0.06, 0.03, MUDBRICK_DARK, 0, 0, back);
    }
    // The bench.
    lay.sb.box(0.55, 0.28, z1 - benchZ0, e * (xi - 0.275), PLINTH + 0.14, (benchZ0 + z1) / 2, k.skin, undefined, HIDE_DOWN);
    lay.sb.box(0.06, 0.05, z1 - benchZ0, e * (xi - 0.56), PLINTH + 0.265, (benchZ0 + z1) / 2, MUDBRICK_DARK);
    // Two niches over it.
    for (const f of [0.3, 0.75]) {
      const u = benchZ0 + (z1 - benchZ0) * f;
      slabOn(lay, s, plane, pointed(u, 1.15, 0.6, 0.75, 0.32), 0.06, 0.072, WINDOW_VOID);
      lay.sb.onFace(s, plane, u, 1.12, 0.78, 0.06, 0.12, 0.06, PALM_BEAM, 0, 0, back);
      archRing(lay, s, plane, u, 1.9, 0.6, 0.32, 0.12, 0.08, 0.04, MUDBRICK_DARK);
    }
    // The leaf: boards, three iron straps and a field of studs.
    const uc = hinge + LEAF / 2;
    const H = 2.82;
    const nB = 8;
    const bwid = LEAF / nB;
    for (let i = 0; i < nB; i++) {
      lay.sb.onFace(s, plane, hinge + (i + 0.5) * bwid, PLINTH + 0.03 + H / 2, bwid - 0.018, H, 0.1, 0.05, PALM_BEAM, 0, 0, back);
    }
    for (const y of [0.72, 1.76, 2.8]) lay.sb.onFace(s, plane, uc, y, LEAF - 0.06, 0.09, 0.025, 0.112, IRON, 0, 0, back);
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 4; c++) {
        lay.sb.onFace(s, plane, hinge + 0.3 + c * ((LEAF - 0.6) / 3), PLINTH + 0.45 + r * 0.45, 0.05, 0.05, 0.03, 0.115, IRON, 0, 0, back);
      }
    }
    if (e < 0) {
      // The wicket: a door in the door, its outline a dark crack.
      const ww = 0.8;
      const wh = 1.6;
      for (const du of [-ww / 2, ww / 2]) lay.sb.onFace(s, plane, uc + du, PLINTH + 0.1 + wh / 2, 0.025, wh, 0.008, 0.104, WINDOW_VOID, 0, 0, back);
      lay.sb.onFace(s, plane, uc, PLINTH + 0.1 + wh, ww, 0.025, 0.008, 0.104, WINDOW_VOID, 0, 0, back);
      lay.sb.onFace(s, plane, uc + ww / 2 - 0.12, PLINTH + 1.0, 0.07, 0.07, 0.04, 0.12, IRON, 0, 0, back);
    }
  }
  // The court's door, seen from the passage.
  courtDoor(lay, k, "-z", -z1, 0, true);
}

// --- the court ------------------------------------------------------------------------

/**
 * A door from the court into a range: the opening the arcade leaves, framed in
 * a dark pointed ring whose legs are its jambs, a palm lintel across at the
 * opening's head, and over it either a fanlight with three bars or a plain
 * tympanum with a lozenge vent.
 */
function courtDoor(lay: Lay, k: Khan, s: Side, plane: number, u: number, fan: boolean): void {
  const back = hideBack(s);
  const span = GAP_W + 0.04;
  const ring = 0.2;
  const rise = span / 2 + 0.06;
  const ys = k.wallTop - 0.07 - rise - ring;
  archRing(lay, s, plane, u, ys, span, rise, ring, 0.1, 0.05, MUDBRICK_DARK);
  for (const e of [-1, 1]) lay.sb.onFace(s, plane, u + e * (span / 2 + ring / 2), (PLINTH + ys) / 2, ring, ys - PLINTH, 0.1, 0.05, MUDBRICK_DARK, 0, 0, back);
  const lin = PLINTH + GAP_H;
  lay.sb.onFace(s, plane, u, lin + 0.06, span, 0.12, 0.12, 0.06, PALM_BEAM, 0, 0, back);
  const tym = above(pointed(u, ys - 0.1, span, 0.1, rise), lin + 0.12);
  if (tym.length < 3) return;
  if (fan) {
    slabOn(lay, s, plane, tym, 0, 0.012, WINDOW_VOID);
    for (const du of [-0.42, 0, 0.42]) {
      const yt = ys + archY(span, rise, du) - 0.02;
      if (yt - lin - 0.12 > 0.06) lay.sb.onFace(s, plane, u + du, (lin + 0.12 + yt) / 2, 0.04, yt - lin - 0.12, 0.03, 0.03, PALM_BEAM, 0, 0, back);
    }
  } else {
    slabOn(lay, s, plane, tym, 0, 0.01, k.skin);
    lay.sb.onFace(s, plane, u, (lin + 0.12 + ys + rise) / 2, 0.13, 0.13, 0.02, 0.02, WINDOW_VOID, Math.PI / 4, 0, back);
  }
}

/**
 * The court's four faces: a dado, the string course at the terrace, a pointed
 * head over every door, and between the doors pilasters and a blind arch in
 * each bay with a grilled window in it; spouts from the terrace, and pocks.
 * `at` is each arcade's opening centres, in `buildCaravanserai`'s order.
 */
function court(lay: Lay, k: Khan, at: number[][]): void {
  const { rnd } = k;
  const faces: { s: Side; plane: number; vis: number; at: number[] }[] = [
    { s: "-z", plane: -k.courtD / 2, vis: k.courtW / 2, at: at[0] },
    { s: "+z", plane: -k.courtD / 2, vis: k.courtW / 2, at: at[1] },
    { s: "+x", plane: -k.courtW / 2, vis: k.courtD / 2, at: at[2] },
    { s: "-x", plane: -k.courtW / 2, vis: k.courtD / 2, at: at[3] },
  ];
  const lo = PLINTH + 0.54;
  for (const { s, plane, vis, at: doors } of faces) {
    const back = hideBack(s);
    const segs = carve(-vis, vis, doors.map((u) => [u - GAP_W / 2 - 0.26, u + GAP_W / 2 + 0.26] as [number, number]));
    lay.sb.onFace(s, plane, 0, k.wallTop + 0.03, 2 * vis, 0.18, 0.14, 0.07, MUDBRICK_DARK, 0, 0, back);
    for (const u of doors) courtDoor(lay, k, s, plane, u, rnd() < 0.7);
    for (const [a, c] of segs) {
      lay.sb.onFace(s, plane, (a + c) / 2, PLINTH + 0.27, c - a, 0.54, 0.06, 0.03, MUDBRICK_DARK, 0, 0, back);
      const nb = Math.max(1, Math.round((c - a) / 2.9));
      const bw = (c - a) / nb;
      for (let i = 0; i <= nb; i++) {
        const u = Math.max(a + 0.18, Math.min(c - 0.18, a + i * bw));
        lay.sb.onFace(s, plane, u, (PLINTH + k.wallTop - 0.06) / 2, 0.36, k.wallTop - 0.06 - PLINTH, 0.1, 0.05, k.skin, 0, 0, back);
      }
      for (let i = 0; i < nb; i++) blindBay(lay, s, plane, a + (i + 0.5) * bw, bw - 0.36, lo, k.wallTop - 0.08, k.skin, true, MUDBRICK_DARK);
      pocks(lay, s, plane, a + 0.2, c - 0.2, 0.7, 2.9, Math.round((c - a) * 0.8), rnd);
    }
    // Two spouts from the terrace into the court.
    for (const [a, c] of [segs[0], segs[segs.length - 1]]) {
      const u = (a + c) / 2 + (rnd() - 0.5) * (c - a) * 0.3;
      lay.sb.onFace(s, plane, u, k.roofY + 0.12, 0.14, 0.12, 0.62, 0.31, PALM_BEAM, 0, 0, back);
      lay.sb.onFace(s, plane, u, k.wallTop - 0.4, 0.16, 0.6, 0.02, 0.13, MUDBRICK_DARK, 0, 0, back);
    }
  }
}

/** Where the stair's brick is solid to the ground, and where it is carried. */
interface StairPlan {
  footZ: number;
  /** The last z the brick stands on the ground; past it the flight is on logs. */
  solidZ: number;
}

function stairOf(f: Flight): StairPlan {
  const footZ = f.topZ - f.run;
  const tread = f.run / f.steps;
  let solidZ = footZ;
  for (let i = 0; i < f.steps; i++) {
    const zc = footZ + (i + 0.5) * tread;
    const yT = f.topY - (f.topZ - zc) * (f.rise / f.run) + 0.02;
    if (yT - 0.36 - PLINTH >= 1.0) break;
    solidZ = zc + tread / 2;
  }
  return { footZ, solidZ };
}

/**
 * The court's paving: square slabs on the plinth's top, a slab's gap between
 * them, a few gone and a shell's crater where more are — and the passage's
 * floor, laid the same.
 */
function paving(lay: Lay, k: Khan, st: StairPlan): void {
  const { rnd } = k;
  const m = lay.m(ROOF_MUD);
  const y = PLINTH + 0.012;
  const G = 0.07;
  const hx = k.courtW / 2;
  const hz = k.courtD / 2;
  const sx0 = -k.courtW * 0.22 - 1.5;
  const sx1 = -k.courtW * 0.22 + 1.5;
  const ang = rnd() * TAU;
  const crater = { x: Math.sin(ang) * hx * 0.55, z: Math.cos(ang) * hz * 0.5, r: 1.3 + rnd() * 0.6 };
  if (Math.abs(crater.x - sx0 - 1.5) < 3 && crater.z > st.footZ - 2) crater.x = -crater.x;
  // Courses across the court, each of slabs of its own lengths: a running
  // bond, which is how slabs of a quarry's random lengths go down, and what
  // keeps thirty metres of joints from reading as squared paper.
  const lay1 = (x0: number, x1: number, z0: number, z1: number, course: number, keep: (cx: number, cz: number) => boolean): void => {
    const nz = Math.max(1, Math.round((z1 - z0) / course));
    const pz = (z1 - z0) / nz;
    for (let j = 0; j < nz; j++) {
      const e = z0 + j * pz + G / 2;
      const f = e + pz - G;
      let x = x0;
      while (x < x1 - 0.2) {
        const len = Math.min(x1 - x, 0.7 + rnd() * 0.8);
        const a = x + G / 2;
        const c = x + len - G / 2;
        x += len;
        if (!keep((a + c) / 2, (e + f) / 2) || rnd() < 0.025) continue;
        m.quad([a, y, e], [c, y, e], [c, y, f], [a, y, f], [0, 1, 0]);
      }
    }
  };
  lay1(-hx, hx, -hz, hz, 0.9, (cx, cz) => {
    if (Math.abs(cx) < 1.1 && Math.abs(cz) < 1.1) return false;
    if (cx > sx0 && cx < sx1 && cz > st.footZ && cz < st.solidZ) return false;
    return Math.hypot(cx - crater.x, cz - crater.z) > crater.r * (0.75 + rnd() * 0.4);
  });
  const xi = PASSAGE - k.t / 2 - 0.55;
  lay1(-xi, xi, -k.d / 2, -(k.courtD / 2 + k.t), 1.1, () => true);
  // The crater: a scorch on the bed, and broken slab round its lip.
  disc(lay.m(SCORCH), 9, rnd(), crater.r * 1.15, 0, PLINTH + 0.005, true, crater.x, crater.z);
  for (let i = 0; i < 7; i++) {
    const a = rnd() * TAU;
    const r = crater.r * (0.9 + rnd() * 0.6);
    const sz = 0.22 + rnd() * 0.3;
    lay.sb.box(sz, 0.05, sz * (0.5 + rnd() * 0.5), crater.x + Math.sin(a) * r, PLINTH + 0.04, crater.z + Math.cos(a) * r, ROOF_MUD, { y: rnd() * 3, x: (rnd() - 0.5) * 0.4 }, HIDE_DOWN);
  }
}

/**
 * The side ranges' riwaq: each pier on a dark base under a dark impost and a
 * timber bracket capital, the palm beam they carry, joists from it back to the
 * wall under a mud deck, a batten along the awnings' free edge, and a
 * tethering ring on every pier.
 */
function riwaq(lay: Lay, k: Khan, pierZ: number[]): void {
  const hz = k.courtD / 2;
  for (const sx of [-1, 1] as const) {
    const px = (sx * (k.courtW - 1.6)) / 2;
    const face = (sx * k.courtW) / 2;
    for (const z of pierZ) {
      lay.sb.box(0.92, 0.3, 0.92, px, PLINTH + 0.15, z, MUDBRICK_DARK, undefined, HIDE_DOWN);
      lay.sb.box(0.86, 0.1, 0.86, px, PLINTH + 2.25, z, MUDBRICK_DARK);
      const z0 = Math.max(-hz, z - 0.8);
      const z1 = Math.min(hz, z + 0.8);
      lay.sb.box(0.5, 0.18, z1 - z0, px, PLINTH + 2.41, (z0 + z1) / 2, PALM_BEAM);
      lay.sb.box(0.04, 0.13, 0.13, px - sx * 0.37, 1.15, z, IRON);
    }
    lay.sb.box(0.9, 0.4, k.courtD, px, PLINTH + 2.7, 0, PALM_BEAM);
    const j0 = px - sx * 0.55;
    for (let z = -hz + 0.25; z <= hz - 0.2; z += 0.45) {
      lay.sb.box(Math.abs(face - j0), 0.13, 0.13, (face + j0) / 2, k.wallTop + 0.065, z, PALM_BEAM, undefined, 1 << 2);
    }
    lay.sb.box(Math.abs(face - j0), 0.1, k.courtD, (face + j0) / 2, k.wallTop + 0.18, 0, ROOF_MUD);
    const edge = px - sx * (1.35 + 0.95 * Math.cos(0.11));
    lay.sb.box(0.07, 0.07, k.courtD - 0.4, edge, PLINTH + 2.42 + 0.95 * Math.sin(0.11) - 0.07, 0, PALM_BEAM);
  }
}

/**
 * The stair, in brick: every step a block to the ground where no body passes
 * under it, a block of its own riser's depth where one could, the two carried
 * on palm logs bedded in the last solid step and in the wall — and a dark
 * nosing on every tread.
 */
function drawStair(lay: Lay, k: Khan, f: Flight, st: StairPlan): void {
  const grade = f.rise / f.run;
  const tread = f.run / f.steps;
  const at = (z: number): number => f.topY - (f.topZ - z) * grade;
  for (let i = 0; i < f.steps; i++) {
    const zc = st.footZ + (i + 0.5) * tread;
    const yT = at(zc) + 0.02;
    if (yT < PLINTH + 0.06) continue;
    const solid = zc < st.solidZ;
    const y0 = solid ? PLINTH : yT - 0.36;
    lay.sb.box(f.w, yT - y0, tread + 0.004, f.x, (yT + y0) / 2, zc, k.skin, undefined, solid ? HIDE_DOWN : 0);
    lay.sb.box(f.w + 0.02, 0.045, 0.07, f.x, yT - 0.0125, zc - tread / 2 + 0.03, MUDBRICK_DARK);
  }
  const pitch = Math.atan(grade);
  const z0 = st.solidZ - 0.3;
  const z1 = f.topZ;
  const zm = (z0 + z1) / 2;
  const len = Math.hypot(z1 - z0, (z1 - z0) * grade);
  for (const e of [-1, 1]) {
    lay.sb.box(0.2, 0.2, len, f.x + e * (f.w / 2 - 0.28), at(zm) + 0.02 - 0.36 - 0.1 / Math.cos(pitch), zm, PALM_BEAM, { x: -pitch });
  }
}

/**
 * The well: an octagonal curb on a footing ring, its dark coping round the
 * water, a gallows of palm with a pulley, a rope and a bucket, and a trough
 * beside it — low enough to step over, as the curb is not.
 */
function well(lay: Lay, k: Khan): void {
  const top = PLINTH + 0.8;
  const R = 0.95;
  const dark = lay.m(MUDBRICK_DARK);
  band(dark, 8, 0, R + 0.05, PLINTH, R + 0.05, PLINTH + 0.18);
  disc(dark, 8, 0, R + 0.05, R - 0.04, PLINTH + 0.18);
  band(lay.m(k.skin), 8, 0, R - 0.04, PLINTH + 0.18, R - 0.04, top - 0.1);
  band(dark, 8, 0, R, top - 0.1, R, top);
  disc(dark, 8, 0, R, 0.62, top);
  disc(lay.m(WINDOW_VOID), 8, 0, 0.62, 0, top - 0.004);
  for (const e of [-1, 1]) lay.sb.box(0.13, 1.6, 0.13, e * 0.78, top + 0.8, 0, PALM_BEAM, undefined, HIDE_DOWN);
  lay.sb.box(1.86, 0.13, 0.13, 0, top + 1.56, 0, PALM_BEAM);
  for (const a of [0, Math.PI / 4]) lay.sb.box(0.32, 0.32, 0.07, 0, top + 1.36, 0, PALM_BEAM, { z: a });
  lay.sb.box(0.025, 0.86, 0.025, 0.15, top + 1.0, 0, SANDBAG);
  const bucket = lay.m(PALM_BEAM);
  band(bucket, 6, 0, 0.12, top + 0.3, 0.15, top + 0.58, 0.15, 0);
  disc(bucket, 6, 0, 0.15, 0, top + 0.58, true, 0.15, 0);
  lay.sb.box(0.62, 0.3, 2.0, 2.05, PLINTH + 0.15, 0, MUDBRICK_DARK, undefined, HIDE_DOWN);
  lay.sb.box(0.44, 0.02, 1.8, 2.05, PLINTH + 0.26, 0, WINDOW_VOID);
}

// --- the terrace -----------------------------------------------------------------------

/**
 * The parapets' caps (cut round the portal's screen and the stair's landing),
 * a low stepped crest along the outer ones with a horn at every corner, and
 * a roof light over every other room.
 */
function terrace(lay: Lay, k: Khan, landing: [number, number]): void {
  const { w, d, courtW, courtD, skin } = k;
  const capY = k.roofY + PARAPET + 0.07;
  const capTop = capY + 0.07;
  const CT = PARAPET_T + 0.16;
  for (const sz of [-1, 1]) {
    const z = (sz * (d - PARAPET_T)) / 2;
    const runs = sz < 0 ? carve(-w / 2 - 0.08, w / 2 + 0.08, [[-PISH, PISH]]) : [[-w / 2 - 0.08, w / 2 + 0.08]];
    for (const [a, c] of runs) lay.sb.box(c - a, 0.14, CT, (a + c) / 2, capY, z, MUDBRICK_DARK);
    const iz = (sz * (courtD + PARAPET_T)) / 2;
    const iruns = sz < 0 ? [[-courtW / 2 - 0.08, courtW / 2 + 0.08]] : carve(-courtW / 2 - 0.08, courtW / 2 + 0.08, [[landing[0] + 0.08, landing[1] - 0.08]]);
    for (const [a, c] of iruns) lay.sb.box(c - a, 0.14, CT, (a + c) / 2, capY, iz, MUDBRICK_DARK);
  }
  for (const sx of [-1, 1]) {
    lay.sb.box(CT, 0.14, d - 2 * PARAPET_T, (sx * (w - PARAPET_T)) / 2, capY, 0, MUDBRICK_DARK);
    lay.sb.box(CT, 0.14, courtD, (sx * (courtW + PARAPET_T)) / 2, capY, 0, MUDBRICK_DARK);
  }
  const crest = (s: Side, plane: number, u0: number, u1: number): void => {
    const n = Math.max(1, Math.round((u1 - u0) / 1.0));
    const step = (u1 - u0) / n;
    for (let i = 0; i < n; i++) {
      const u = u0 + (i + 0.5) * step;
      lay.sb.onFace(s, plane, u, capTop + 0.1, 0.44, 0.2, 0.3, -0.2, skin, 0, 0, HIDE_DOWN);
      lay.sb.onFace(s, plane, u, capTop + 0.25, 0.2, 0.1, 0.3, -0.2, skin, 0, 0, HIDE_DOWN);
    }
  };
  for (const s of SIDES) {
    const len = runsAlongX(s) ? w : d;
    const plane = runsAlongX(s) ? d / 2 : w / 2;
    const runs = s === "-z" ? carve(-len / 2 + 0.7, len / 2 - 0.7, [[-PISH - 0.1, PISH + 0.1]]) : [[-len / 2 + 0.7, len / 2 - 0.7]];
    for (const [a, c] of runs) crest(s, plane, a, c);
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * (w / 2 - 0.25);
      const z = sz * (d / 2 - 0.25);
      lay.sb.box(0.5, 0.5, 0.5, x, capTop + 0.25, z, skin, undefined, HIDE_DOWN);
      lay.sb.box(0.34, 0.18, 0.34, x, capTop + 0.59, z, skin, undefined, HIDE_DOWN);
      lay.sb.box(0.18, 0.16, 0.18, x, capTop + 0.76, z, skin, undefined, HIDE_DOWN);
    }
  }
  // Roof lights: a rim on the screed, the dark of the room under it and two
  // bars across.
  const light = (x: number, z: number): void => {
    const y = k.roofY;
    for (const e of [-1, 1]) {
      lay.sb.box(0.9, 0.22, 0.15, x, y + 0.11, z + e * 0.375, ROOF_MUD, undefined, HIDE_DOWN);
      lay.sb.box(0.15, 0.22, 0.6, x + e * 0.375, y + 0.11, z, ROOF_MUD, undefined, HIDE_DOWN);
    }
    lay.sb.box(0.6, 0.02, 0.6, x, y + 0.13, z, WINDOW_VOID, undefined, HIDE_DOWN);
    for (const e of [-1, 1]) lay.sb.box(0.05, 0.04, 0.66, x + e * 0.15, y + 0.21, z, PALM_BEAM, undefined, HIDE_DOWN);
  };
  const RANGE = (d - courtD) / 2;
  for (const sz of [-1, 1]) {
    const z = (sz * (d - RANGE)) / 2;
    for (let x = -w / 2 + 4; x <= w / 2 - 4; x += 6) {
      if (sz < 0 && Math.abs(x) < 8.2) continue;
      light(x, z);
    }
  }
  for (const sx of [-1, 1]) {
    for (const z of [-courtD / 3 - 2.2, 0, courtD / 3 + 2.2]) light((sx * (w - RANGE)) / 2, z);
  }
}

/**
 * The gate towers: the cap, a band round each, slits on the three faces that
 * look out, a shut door on the face the terrace sees, the stepped merlons of
 * the set round the top, and pocks.
 */
function towers(lay: Lay, k: Khan, tz: number, TOWER: number): void {
  const y0 = k.roofY;
  const y1 = y0 + TOWER;
  for (const sx of [-1, 1] as const) {
    const x = sx * 5.8;
    lay.sb.box(3.9, 0.2, 3.9, x, y1 + 0.1, tz, MUDBRICK_DARK);
    const faces: [Side, number, number][] = [
      ["-z", -(tz - 1.75), x],
      ["+z", tz + 1.75, x],
      ["-x", -(x - 1.75), tz],
      ["+x", x + 1.75, tz],
    ];
    for (const [s, plane, u] of faces) {
      const back = hideBack(s);
      lay.sb.onFace(s, plane, u, y0 + 2.2, 3.5 + 0.16, 0.12, 0.08, 0.04, MUDBRICK_DARK, 0, 0, back);
      const outward = s === "-z" || (s === "-x" && sx < 0) || (s === "+x" && sx > 0);
      if (outward) {
        for (const du of s === "-z" ? [-0.8, 0.8] : [0]) slit(lay, s, plane, u + du, y0 + 0.75, 0.85);
      } else if (s === "+z") {
        lay.sb.onFace(s, plane, u, y0 + 0.95, 0.9, 1.9, 0.08, 0.04, PALM_BEAM, 0, 0, back);
        lay.sb.onFace(s, plane, u, y0 + 1.95, 1.2, 0.14, 0.12, 0.06, PALM_BEAM, 0, 0, back);
        for (const e of [-1, 1]) lay.sb.onFace(s, plane, u + e * 0.52, y0 + 0.95, 0.14, 1.9, 0.1, 0.05, MUDBRICK_DARK, 0, 0, back);
      }
      pocks(lay, s, plane, u - 1.5, u + 1.5, y0 + 0.3, y1 - 0.3, 3, k.rnd);
    }
    const cap = 1.95;
    merlons(lay, "-z", -(tz - cap), x, 3.9, y1 + 0.2, 0.1, k.skin);
    merlons(lay, "+z", tz + cap, x, 3.9, y1 + 0.2, 0.1, k.skin);
    merlons(lay, "-x", -(x - cap), tz, 3.3, y1 + 0.2, 0.1, k.skin);
    merlons(lay, "+x", x + cap, tz, 3.3, y1 + 0.2, 0.1, k.skin);
  }
}

/** The rooms' ceilings: palm-log joists across every range, under the terrace's screed. */
function ceilings(lay: Lay, k: Khan): void {
  const { w, d, t, courtW, courtD } = k;
  const y = k.wallTop - 0.065;
  const zA = d / 2 - t;
  const zB = courtD / 2 + t;
  for (const sz of [-1, 1]) {
    for (let x = -w / 2 + t + 0.3; x <= w / 2 - t - 0.3; x += 0.6) {
      if (sz < 0 && Math.abs(x) < PASSAGE + t / 2) continue;
      lay.sb.box(0.13, 0.13, zA - zB, x, y, (sz * (zA + zB)) / 2, PALM_BEAM, undefined, 1 << 2);
    }
  }
  const xA = w / 2 - t;
  const xB = courtW / 2 + t;
  for (const sx of [-1, 1]) {
    for (let z = -courtD / 2 + 0.3; z <= courtD / 2 - 0.3; z += 0.6) {
      if (Math.abs(Math.abs(z) - courtD / 3) < 0.4) continue;
      lay.sb.box(xA - xB, 0.13, 0.13, (sx * (xA + xB)) / 2, y, z, PALM_BEAM, undefined, 1 << 2);
    }
  }
}
