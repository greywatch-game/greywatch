/**
 * kit/city/office.ts — buildOffice: the plate you fight ACROSS, one room per
 * storey with a window band on three bearings and the shopfront on the
 * fourth, and the window-band dimensions only it uses. Part of the downtown
 * set: follows the contract in kit/core.ts and the set's rules in
 * `./index.ts`.
 */
import { Scene } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import { mulberry32 } from "../../rng";
import {
  Build,
  type BuildParams,
  type Structure,
  ALLOY,
  ASHLAR,
  ASPHALT,
  CONCRETE,
  DARK_CONCRETE,
  ENAMEL,
  WINDOW_LIGHT,
  StoneBatch,
  carve,
  streetSeed,
  HIDE_UNDER,
  hideBack,
  outward,
  runsAlongX,
  type Side,
} from "../core";
import {
  STOREY,
  SLAB,
  WALL,
  GRADE,
  GROUND,
  levelY,
  laneFlight,
} from "./shared";

/** Spandrel height above a floor: chest-high cover at every window. */
const SPANDREL = 1.0;
/** Head height of a window band above its floor. */
const HEAD = 2.5;
/** Metres between mullions. */
const MULLION_PITCH = 2.6;

/**
 * The office block: three walked floors, two flights, and the building this
 * whole set exists for.
 *
 * ## The shape, and why it is this shape
 *
 * A rectangle with a stair LANE down each of two opposite edges. The flight to
 * level 1 climbs the -X lane, the flight to level 2 the +X lane, and so on
 * alternating; each slab is a single box that stops short of the lane the
 * flight to it came up. So the void over a flight is the lane itself, never a
 * hole cut round it, and because consecutive lanes alternate, the slab
 * immediately above a flight is never the one that would cover it. (The one two
 * floors up does cover it, and clears its top by `STOREY - SLAB`, which is
 * 3.1 m against `NavGrid`'s 1.7 m `HEADROOM`.) Standing on
 * level 1 you can see the street through the -X void and the roof through the
 * +X one, which is the atrium a real building of this size has and the
 * vertical sightline a fight in it needs.
 *
 * **What the lane keeps back from the void is the LANDING at the head of each
 * flight** — the lane's full width, running from the top tread to the +Z
 * elevation, and part of the walked group rather than an afterthought. A flight
 * climbs into a lane that has no floor in it, so without one the top tread ends
 * level with the slab beside it and over nothing at all in front; with a landing
 * that stopped short of the wall, the same drop stood 2.4 m further on and the
 * stair still ended in a hole. So the void is all at the FOOT end, which is the
 * end you meet across open floor. The slab two floors up covers a landing
 * exactly as it covers the flight, at the same 3.1 m.
 *
 * The ground floor is ENCLOSED — two doorways, no windows — and every floor
 * above it is a continuous window band over a chest-high spandrel. That is a
 * gameplay gradient rather than an architectural one: the way in is a fight
 * through a dark room with two entrances, and what you win is a firing gallery
 * on three bearings with cover the whole way round.
 *
 * ## What must not be moved without re-deriving it
 *
 * The lane width IS the flight width. A void wider than its flight leaves a
 * strip of cells between the treads and the slab edge with no surface in them,
 * and the nav graph cannot step across a gap it has nothing to stand on — the
 * storey then reads as reachable from the stair and is not.
 *
 * The plate has to be DEEP enough for a flight and its landing: the circulation
 * runs from `run / 2 + 0.6` short of the -Z elevation to the +Z one itself, and
 * `LANDING` is the least that may be left between the top tread and that wall,
 * so `depth` is what has to hold it. DEV throws rather than landing a stair on
 * a ledge.
 */
export function buildOffice(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "office");
  const w = p.width ?? 22;
  const d = p.depth ?? 18;
  const floors = Math.max(2, p.floors ?? 3);
  const top = floors * STOREY;
  /** Stair lane width, and the flight's width with it. See the header. */
  const lane = 3.4;
  /** Which edge level `s`'s flight climbs: -1 is the -X lane, +1 the +X. */
  const laneSide = (s: number): -1 | 1 => (s % 2 === 0 ? -1 : 1);
  /** Centre of that lane. */
  const laneX = (s: number): number => (laneSide(s) * (w - lane)) / 2;

  /** The shopfront's bays, and the piers between them. See the +Z elevation. */
  const shop = (() => {
    const bays = Math.max(3, Math.round(w / 5));
    const pier = 0.6;
    return { bays, pier, span: (w - pier * (bays + 1)) / bays };
  })();
  /** The service core's plan. See where it is emitted, and why it is central. */
  const coreW = 4.6;
  const coreD = 4.2;
  const coreZ = -d * 0.26;

  // --- the drawing, FIRST -----------------------------------------------------
  //
  // Everything on the office that is not a mass — see `drawOffice`. It emits
  // no colliders, so where it is called cannot move one; it is called before
  // the masses it lies on because the part merge keeps emission order, and a
  // facing drawn first is what lets the depth test reject the wall face behind
  // it rather than shade it twice.
  drawOffice(b, {
    w,
    d,
    floors,
    top,
    lane,
    laneSide,
    piers: Array.from({ length: shop.bays + 1 }, (_, i) => -w / 2 + shop.pier / 2 + i * (shop.pier + shop.span)),
    coreW,
    coreD,
    coreZ,
    sign: p.sign,
  });

  // --- walked surfaces first (header, first rule) --------------------------

  // The ground floor. Merges with the terrain in the nav grid; see GROUND.
  b.box(w, SLAB, d, 0, GROUND - SLAB / 2, 0, CONCRETE);
  b.block({ w, h: SLAB, d, x: 0, y: GROUND - SLAB / 2, z: 0 });

  // Upper slabs, each one box, each missing the lane its flight climbs.
  for (let s = 1; s < floors; s++) {
    const y = levelY(s);
    const sw = w - lane;
    // The slab sits on the side AWAY from the lane the flight to it used.
    const cx = (-laneSide(s - 1) * lane) / 2;
    b.box(sw, SLAB, d, cx, y - SLAB / 2, 0, CONCRETE);
    b.block({ w: sw, h: SLAB, d, x: cx, y: y - SLAB / 2, z: 0 });
  }

  // The flights and the landings they arrive on. One pair per storey, each in
  // its own lane, all climbing +Z so the building has a single circulation
  // direction and the landings line up. `laneFlight` owns both halves and the
  // check that the plate can hold them.
  for (let s = 0; s + 1 < floors; s++) {
    laneFlight({
      b,
      tag: "office",
      x: laneX(s),
      lane,
      depth: d,
      from: levelY(s),
      to: levelY(s + 1),
      tread: DARK_CONCRETE,
      landing: CONCRETE,
    });
  }

  // --- enclosure ------------------------------------------------------------

  // Ground floor: solid, with a doorway on -Z and one on +X. Two ways in, for
  // `kit/buildings/manor.ts`'s reason — one entrance is a choke a squad can hold with a
  // single body, and what makes a building worth taking is that it cannot be.
  const g0 = GROUND;
  const gh = STOREY - SLAB - g0;
  b.doorWall(w, gh, WALL, 0, g0 + gh / 2, -d / 2, CONCRETE, 3.2, 2.6);
  b.wall(WALL, gh, d, -w / 2, g0 + gh / 2, 0, CONCRETE);

  // The +Z elevation is a GLAZED SHOPFRONT, and it is the one place on the map
  // where glass is the only thing in the way.
  //
  // Every other pane in this kit is decoration and stays whole: a tower's
  // curtain wall hangs 4 cm off a solid shaft and its punched windows are drawn
  // on the same shaft, so breaking either would change nothing you can play
  // with. The bands upstairs go one further and carry no glass at all, over a
  // 1 m spandrel that already stops a body. A shopfront does — it is a wall until
  // somebody shoots it, and then it is a way in, which is why it is the
  // elevation that faces the street and why the two doorways are on the other
  // three sides. A squad holding both doors now has a third opening they can
  // hear go in behind them.
  //
  // Structurally it is piers and bays: the piers are ordinary `wall`s so the
  // elevation still reads as a building and so the corners are never glass, and
  // each bay between them is one BREAKABLE pane — twelve of the twenty-four on
  // the map, the other twelve being the shophouses', because these are the only
  // sheets with a room behind them. Per bay rather than one sheet across the
  // front, because a pane is what breaks — a single sheet would take the whole
  // elevation out on one round.
  {
    const { bays, pier, span } = shop;
    for (let i = 0; i <= bays; i++) {
      b.wall(pier, gh, WALL, -w / 2 + pier / 2 + i * (pier + span), g0 + gh / 2, d / 2, CONCRETE);
    }
    for (let i = 0; i < bays; i++) {
      const x = -w / 2 + pier + span / 2 + i * (pier + span);
      // Thinner than the piers and centred on the same plane, so a round that
      // stops on a pier sparks where the concrete is drawn and one through a
      // bay meets only the glass.
      b.pane(span, gh, 0.12, x, g0 + gh / 2, d / 2, { breakable: true });
    }
  }
  // The +X doorway is cut by hand: `doorWall` runs along X, and this wall runs
  // along Z. Two jambs and a lintel, the same three boxes it would emit.
  {
    const gap = 3.2;
    const jamb = (d - gap) / 2;
    for (const sz of [-1, 1]) {
      b.wall(WALL, gh, jamb, w / 2, g0 + gh / 2, (sz * (gap + jamb)) / 2, CONCRETE);
    }
    b.wall(WALL, gh - 2.6, gap, w / 2, g0 + 2.6 + (gh - 2.6) / 2, 0, CONCRETE);
  }

  // Upper floors: spandrel, window band, header. The spandrel is the cover the
  // gallery is for; the header is what stops the band reading as a missing
  // wall. Both are ordinary colliders — a body must not walk out of a window,
  // and the round that goes through the band is meant to.
  //
  // **The spandrel hangs from the SOFFIT, over the slab's edge, not from the
  // floor.** The slab stops at the wall's centreline, so a spandrel standing on
  // it left the floor line closed only by that edge — and over a stair lane
  // there is no slab: a 0.5 m slot through the elevation the length of the
  // void, open to the street and to rounds. Hung from the storey below's
  // header (the ground floor's wall head, for level 1), the elevation is
  // continuous whether a floor is behind it or not.
  for (let s = 1; s < floors; s++) {
    const y = levelY(s);
    const ceil = (s + 1) * STOREY - SLAB;
    const headH = ceil - (y + HEAD);
    const spanH = SPANDREL + SLAB;
    const sides: [number, number, number, number][] = [
      // [width along X, depth along Z, x, z]
      [w, WALL, 0, -d / 2],
      [w, WALL, 0, d / 2],
      [WALL, d, -w / 2, 0],
      [WALL, d, w / 2, 0],
    ];
    for (const [bw, bd, bx, bz] of sides) {
      b.wall(bw, spanH, bd, bx, y + SPANDREL - spanH / 2, bz, CONCRETE);
      if (headH > 0.05) {
        b.wall(bw, headH, bd, bx, y + HEAD + headH / 2, bz, CONCRETE);
      }
    }
    // Mullions across the band. Struts: they stop a round where they are drawn
    // and are no body at all, and MapBuilder merges the lot into one collider
    // mesh — see the header's fourth rule.
    const bandH = HEAD - SPANDREL;
    const bandY = y + SPANDREL + bandH / 2;
    const along = (span: number, place: (t: number) => [number, number]) => {
      const n = Math.max(1, Math.round(span / MULLION_PITCH));
      for (let i = 1; i < n; i++) {
        const [mx, mz] = place(i / n);
        b.strut(0.24, bandH, 0.24, mx, bandY, mz, ALLOY);
      }
    };
    for (const sz of [-1, 1]) {
      along(w, (t) => [-w / 2 + t * w, (sz * d) / 2]);
    }
    for (const sx of [-1, 1]) {
      along(d, (t) => [(sx * w) / 2, -d / 2 + t * d]);
    }
  }

  // The service core: lifts and risers, one box from the ground to the roof.
  // ONE collider for the whole height rather than one per storey — it is solid
  // at every level, so the cells inside it are blocked at every level by the
  // same box, and a stack of three would be three surfaces nothing stands on.
  //
  // **It stands in the MIDDLE of the plate, clear of both lanes, and that is
  // the fix for a bug rather than a plan.** It was offset toward one edge
  // first, which put it inside the lane the SECOND flight climbs — so that
  // flight ran into a solid column at its own foot, the third storey was
  // unreachable by anything that could not already stand on it, and nothing
  // said so: the floor was there, the slab was there, the treads were drawn,
  // and the flood fill simply never arrived. Measured before and after with a
  // route probe from both home spawns, which is the only thing that shows it.
  b.box(coreW, top, coreD, 0, top / 2, coreZ, DARK_CONCRETE);
  b.block({ w: coreW, h: top, d: coreD, x: 0, y: top / 2, z: coreZ });

  // Loose cover on each gallery: a counter run and a pair of low partitions.
  // 1.1 m is under `CoverMap`'s 1.7 m hard-cover line, so bots read it as low
  // cover and crouch behind it, which is the same thing the player does.
  for (let s = 1; s < floors; s++) {
    const y = levelY(s);
    const cx = (-laneSide(s - 1) * lane) / 2;
    b.box(5.4, 1.1, 0.5, cx + 3.0, y + 0.55, d * 0.2, ENAMEL);
    b.block({ w: 5.4, h: 1.1, d: 0.5, x: cx + 3.0, y: y + 0.55, z: d * 0.2 });
    b.box(0.5, 1.1, 4.2, cx - 4.4, y + 0.55, -d * 0.05, ENAMEL);
    b.block({ w: 0.5, h: 1.1, d: 4.2, x: cx - 4.4, y: y + 0.55, z: -d * 0.05 });
  }

  // --- the roof, LAST -------------------------------------------------------
  // The header's first rule: a roof is a surface nothing reaches, so it must be
  // the candidate that gets dropped when a perimeter cell runs out of slots
  // rather than the third floor.
  b.box(w + 0.4, SLAB, d + 0.4, 0, top - SLAB / 2, 0, ASPHALT);
  b.block({ w: w + 0.4, h: SLAB, d: d + 0.4, x: 0, y: top - SLAB / 2, z: 0 });
  for (const sz of [-1, 1]) {
    b.box(w + 0.6, 0.8, 0.4, 0, top + 0.4, (sz * (d + 0.4)) / 2, CONCRETE);
  }
  for (const sx of [-1, 1]) {
    b.box(0.4, 0.8, d + 0.4, (sx * (w + 0.4)) / 2, top + 0.4, 0, CONCRETE);
  }
  b.box(coreW + 1.2, 2.2, coreD + 1.0, 0, top + 1.1, coreZ, DARK_CONCRETE);
  b.box(3.2, 1.4, 3.0, w * 0.22, top + 0.7, d * 0.26, ALLOY);

  if (p.litWindows) {
    // One light per GALLERY, not one per building.
    //
    // An interior on a daylit map is lit by ambient and the sky term, and the
    // sky term is applied by `n.y`: it lands in full on the floor and not at
    // all on the ceiling above it, which the AO bake then darkens again. So a
    // storey with nothing in it reads as a bright plate under a black lid, and
    // one light hung between the first two floors leaves the top one exactly
    // that. Two lights are affordable here because this map has no fixtures at
    // all outdoors (see the set's header) — the sixteen shader slots are
    // otherwise entirely unspent.
    for (let s = 1; s < floors; s++) {
      b.light(WINDOW_LIGHT, 19, 0.8, 0.02, 0, levelY(s) + 2.1, d * 0.12);
    }
  }
  return b;
}

/**
 * Everything on the office that is DRAWING, and what it draws it as: a
 * nineteen-sixties speculative office block, in-situ frame, precast spandrel
 * panels hung on it, a ribbon of steel windows in each storey, and a ground
 * floor faced in stone because that is the part the street touches. It read as
 * a concrete box with three slots cut in it — a blank ground floor, bare
 * bands, two boxes on an empty roof — and nothing here moves what it IS: it
 * emits no collider, so every box the office is made of is exactly where it
 * was (`npm run kit:hash`).
 *
 * Every part obeys one of the three rules a drawing on a collider may take
 * (`model-detail` skill): FLAT on a face (cladding, frames, the leaves pinned
 * back, the shutter), LOW enough to walk over (the base course, the kick of a
 * broken shopfront bay), or OVERHEAD (canopies, blinds, fittings, the
 * sun-shade shelves) — and nothing is drawn where a body or a round could
 * meet it and find nothing there. Three consequences that were decided rather
 * than fallen into:
 *
 * - **No furniture on a floor without a box under it.** A desk a round goes
 *   through and a body walks through is cover that lies, so the only
 *   furniture is ON the two cover boxes each gallery already has — the counter
 *   run is drawn as a row of filing cabinets, the partition as a screen
 *   system — and nothing on top of either stands more than 8 cm proud.
 * - **The blinds stop at 2.0 m.** They hang inside the band, which is a
 *   sightline bots see straight through, so nothing drawn in it may come down
 *   to where a head is. A blind is pulled up or hangs askew in the top half
 *   metre of the window, and never below.
 * - **The canopies project 1.3 m and no further.** An upper storey cannot see
 *   the pavement within about four metres of its own wall — the spandrel is in
 *   the way — so a canopy inside that is hiding nothing a gallery could
 *   otherwise have seen, while a deeper one would hide a body a bot can shoot.
 *
 * **The ground floor stays DARK and every storey above it is lit**, by lenses
 * on the ceiling rather than lamps (emissive, which spends no light slot; the
 * set's header's budget). It is the builder header's gameplay gradient —
 * the fight in is through a dark room, what you win is a gallery — and it
 * answers the "bright plate under a black lid" the set's header describes: the
 * lid is still black, but it is a lid with fittings in it.
 *
 * Variation is seeded off the params, as the tower's is: which bays have a
 * blind down, which a radiator, where the service shutter sits along its
 * flank, what is lying on the cabinets.
 *
 * **Two colours are new to the office and no more**: `ASHLAR` for the stone and
 * the blinds, and the `WINDOW_LIGHT` lens — both already in every block a tower
 * stands in. Everything else is the office's own five. A merged block draws
 * once per colour, and the first cut's shutter rust, extinguisher red, timber
 * worktop and iron put a dozen draws on the proving ground's twenty-eight.
 */
function drawOffice(
  b: Build,
  o: {
    w: number;
    d: number;
    floors: number;
    top: number;
    lane: number;
    laneSide: (s: number) => -1 | 1;
    /** The shopfront's pier centres on X. */
    piers: readonly number[];
    coreW: number;
    coreD: number;
    coreZ: number;
    sign?: string;
  },
): void {
  const { w, d, floors, top, lane, laneSide, piers, coreW, coreD, coreZ } = o;
  // A thousand-odd boxes a placement, and as parts each of them is a mesh for
  // the merge to build and throw away — 28 of these on the proving ground put
  // seconds on its install. So every box is written into one surface per
  // colour (`StoneBatch`) and every lens into one per colour of its own; the
  // cylinders, a score of them, stay parts.
  const sb = new StoneBatch();
  const lamps = new StoneBatch();
  // Seeded off the params, as `towerRoll` is and for its reason — but drawn
  // from a stream, because a few hundred per-bay decisions read in one fixed
  // order are what a stream is for, where a salt per bay is bookkeeping.
  const rnd = mulberry32(streetSeed(w, d, floors));
  const SIDES: readonly Side[] = ["-z", "+z", "-x", "+x"];
  /** An elevation's OUTER face plane, from the centre. */
  const plane = (s: Side): number => (runsAlongX(s) ? d : w) / 2 + WALL / 2;
  /** An elevation's length between its two outer corners. */
  const span = (s: Side): number => (runsAlongX(s) ? w : d) + WALL;
  const face = (
    s: Side,
    u: number,
    y: number,
    along: number,
    tall: number,
    thick: number,
    out: number,
    color: string,
    tilt = 0,
    hide = 0,
  ): void => sb.onFace(s, plane(s), u, y, along, tall, thick, out, color, tilt, 0, hide);
  /** `face`, for a lens. */
  const glowOn = (
    s: Side,
    u: number,
    y: number,
    along: number,
    tall: number,
    thick: number,
    out: number,
    color: string,
  ): void => lamps.onFace(s, plane(s), u, y, along, tall, thick, out, color);
  /** The joint between two precast units or two stones. */
  const JOINT = 0.025;

  // --- the ground floor: a stone storey ---------------------------------------
  //
  // Faced in ASHLAR, lighter than the concrete over it for the tower's reason (a
  // base in the frame's own grey is a hole at eye height), in three courses of
  // slabs laid broken-joint 3 cm proud of the wall, so every joint is a step
  // the ink draws. A dark base course under it and a string at its head.

  const DOOR_GAP = 3.2;
  const DOOR_TOP = GROUND + 2.6;
  const shutW = 3.6;
  const shutH = 2.5;
  /** Where the service shutter sits on -X — clear of both downpipes. */
  const shutZ = (rnd() - 0.5) * Math.max(0, d - shutW - 8);
  /** The openings each elevation's facing stops at, as [u0, u1, y0, y1]. */
  const openings: Record<Side, [number, number, number, number][]> = {
    "-z": [[-DOOR_GAP / 2 - 0.2, DOOR_GAP / 2 + 0.2, -1, DOOR_TOP + 0.2]],
    "+x": [[-DOOR_GAP / 2 - 0.2, DOOR_GAP / 2 + 0.2, -1, DOOR_TOP + 0.2]],
    "-x": [[shutZ - shutW / 2 - 0.22, shutZ + shutW / 2 + 0.22, -1, shutH + 0.25]],
    "+z": [],
  };
  /** A run along an elevation at [y0, y1], less the openings it crosses. */
  const runOf = (s: Side, u0: number, u1: number, y0: number, y1: number): [number, number][] =>
    carve(
      u0,
      u1,
      openings[s].filter(([, , c0, c1]) => c1 > y0 && c0 < y1).map(([a, z]) => [a, z]),
    );

  for (const s of ["-z", "-x", "+x"] as const) {
    // Past the corner by the facing's own thickness, so the two elevations'
    // facings close over the notch the walls leave between them.
    const L = span(s) + 0.06;
    for (const [a, z] of runOf(s, -L / 2, L / 2, -0.1, 0.42)) {
      face(s, (a + z) / 2, 0.16, z - a, 0.52, 0.1, 0.05, DARK_CONCRETE, 0, hideBack(s));
    }
    const c0 = 0.44;
    const courses = 3;
    const ch = (3.0 - c0) / courses;
    const len = 1.6;
    for (let c = 0; c < courses; c++) {
      const y0 = c0 + c * ch;
      const y1 = y0 + ch - JOINT;
      for (let u = -L / 2 - ((c % 2) * len) / 2; u < L / 2; u += len) {
        for (const [a, z] of runOf(s, Math.max(u, -L / 2), Math.min(u + len - JOINT, L / 2), y0, y1)) {
          if (z - a < 0.15) continue;
          face(s, (a + z) / 2, (y0 + y1) / 2, z - a, y1 - y0, 0.03, 0.015, ASHLAR, 0, hideBack(s) | HIDE_UNDER);
        }
      }
    }
  }
  // The string at the head of the stone, round all four sides — on the
  // shopfront it is the head the glass stands under.
  for (const s of SIDES) face(s, 0, 3.07, span(s) + 0.24, 0.14, 0.12, 0.06, ASHLAR);

  // --- the shopfront ----------------------------------------------------------
  //
  // The piers cased in the same stone and the bays framed at the head. Nothing
  // crosses a bay but at its foot and its head, because a bay is a way in the
  // moment somebody shoots it: the base course is a 6 cm kick over the floor
  // inside, and the head bar is overhead.
  {
    const zc = d / 2;
    face("+z", 0, 0.08, span("+z") + 0.06, 0.36, 0.1, 0.05, DARK_CONCRETE);
    for (let i = 0; i < piers.length; i++) {
      // The end piers wrap the corner, over the notch the flank's wall leaves.
      const x0 = i === 0 ? -(w / 2 + 0.23) : piers[i] - 0.33;
      const x1 = i === piers.length - 1 ? w / 2 + 0.23 : piers[i] + 0.33;
      // 2 cm under the pier's own top, which is concrete: two colours never
      // share an up-facing plane.
      sb.box(x1 - x0, 2.88, 0.46, (x0 + x1) / 2, GROUND + 1.44, zc, ASHLAR);
    }
    for (let i = 0; i + 1 < piers.length; i++) {
      const bw = piers[i + 1] - piers[i] - 0.6;
      sb.box(bw, 0.1, 0.16, (piers[i] + piers[i + 1]) / 2, 2.98, zc, ALLOY);
    }
  }

  // --- the two doorways -------------------------------------------------------

  /** An architrave, and the two leaves pinned back flat against the facing. */
  const doorway = (s: Side, u: number): void => {
    const g = DOOR_GAP / 2;
    const lw = g - 0.04;
    const lh = 2.4;
    const ly = GROUND + 0.02;
    face(s, u, DOOR_TOP + 0.1, DOOR_GAP + 0.36, 0.2, 0.1, 0.05, ALLOY);
    for (const k of [-1, 1]) {
      face(s, u + k * (g + 0.09), DOOR_TOP / 2, 0.18, DOOR_TOP, 0.1, 0.05, ALLOY);
      const lc = u + k * (g + 0.2 + lw / 2);
      face(s, lc, ly + lh / 2, lw - 0.1, lh - 0.3, 0.03, 0.13, DARK_CONCRETE);
      for (const e of [-1, 1]) face(s, lc + e * (lw / 2 - 0.05), ly + lh / 2, 0.1, lh, 0.06, 0.14, ALLOY);
      face(s, lc, ly + lh - 0.06, lw, 0.12, 0.06, 0.14, ALLOY);
      face(s, lc, ly + 0.14, lw, 0.28, 0.06, 0.14, ALLOY);
      face(s, lc - k * (lw / 2 - 0.26), ly + 1.05, 0.05, 0.5, 0.05, 0.19, ALLOY);
    }
  };

  /**
   * A cantilevered canopy at the head of the stone: a slab, a fascia, the
   * downlights under it (lenses) and tie rods back to the spandrel over it —
   * the tower's reason, a slab standing off a wall with nothing holding it up
   * reads as a mistake.
   */
  const canopy = (s: Side, u: number, len: number, proj: number, ties: readonly number[]): void => {
    const cy = 3.23;
    face(s, u, cy, len, 0.18, proj, proj / 2, ALLOY);
    face(s, u, cy - 0.06, len, 0.42, 0.14, proj - 0.07, DARK_CONCRETE);
    const lamps = Math.max(2, Math.round(len / 2.4));
    for (let i = 0; i < lamps; i++) {
      glowOn(s, u - len / 2 + ((i + 0.5) * len) / lamps, cy - 0.1, 0.34, 0.02, 0.34, proj * 0.5, WINDOW_LIGHT);
    }
    if (o.sign) glowOn(s, u, cy - 0.06, Math.min(len * 0.6, 7), 0.22, 0.03, proj + 0.015, o.sign);
    const reach = proj - 0.25;
    const rise = 1.25;
    const lean = Math.atan2(reach, rise);
    const n = outward(s);
    for (const ut of ties) {
      const c = n * (plane(s) + 0.05 + reach / 2);
      const long = Math.hypot(reach, rise);
      // A positive x-rotation tips +Y toward +Z and a positive z-rotation
      // toward -X; the TOP of a tie is the end against the wall.
      if (runsAlongX(s)) sb.box(0.07, long, 0.07, ut, cy + rise / 2, c, ALLOY, { x: -n * lean });
      else sb.box(0.07, long, 0.07, c, cy + rise / 2, ut, ALLOY, { z: n * lean });
    }
  };

  // The front door is -Z, under the deeper canopy and beside a name plate; the
  // side door on +X gets a hood of its own; the shopfront gets one canopy the
  // length of the street.
  doorway("-z", 0);
  canopy("-z", 0, DOOR_GAP + 2.4, 1.3, [-(DOOR_GAP / 2 + 0.9), DOOR_GAP / 2 + 0.9]);
  face("-z", -(DOOR_GAP / 2 + 2.5), 1.65, 0.7, 0.46, 0.04, 0.05, ALLOY);
  face("-z", -(DOOR_GAP / 2 + 2.5), 1.65, 0.58, 0.34, 0.02, 0.08, ASHLAR);
  doorway("+x", 0);
  canopy("+x", 0, DOOR_GAP + 1.2, 1.0, [-(DOOR_GAP / 2 + 0.4), DOOR_GAP / 2 + 0.4]);
  canopy(
    "+z",
    0,
    span("+z") + 0.2,
    1.3,
    piers.filter((_, i) => i > 0 && i < piers.length - 1 && i % 2 === 1),
  );

  // --- the service flank, -X --------------------------------------------------
  //
  // A shutter drawn SHUT — the tower's rule: there is no way in behind it, so a
  // door standing open would be the lie — a meter cupboard, and the two
  // downpipes, each standing in front of a mullion so the band behind it is no
  // narrower than it was.
  {
    const s: Side = "-x";
    for (const k of [-1, 1]) {
      face(s, shutZ + k * (shutW / 2 + 0.11), (shutH + 0.25) / 2, 0.22, shutH + 0.25, 0.16, 0.08, DARK_CONCRETE);
    }
    face(s, shutZ, shutH + 0.125, shutW + 0.44, 0.25, 0.16, 0.08, DARK_CONCRETE);
    face(s, shutZ, shutH / 2, shutW, shutH, 0.06, 0.05, ENAMEL);
    for (let i = 1; i < 8; i++) face(s, shutZ, (i / 8) * shutH, shutW, 0.05, 0.03, 0.09, DARK_CONCRETE);
    face(s, shutZ, shutH + 0.37, shutW + 0.3, 0.24, 0.3, 0.15, ALLOY);
    const away = shutZ > 0 ? -1 : 1;
    const mz = shutZ + away * (shutW / 2 + 1.3);
    face(s, mz, 1.0, 0.8, 1.1, 0.12, 0.06, ALLOY);
    face(s, mz + 0.3, 1.0, 0.04, 0.22, 0.04, 0.14, DARK_CONCRETE);

    const n = Math.max(1, Math.round(d / MULLION_PITCH));
    const fall = top - 0.45;
    for (const k of [-1, 1]) {
      const u = k * (d / 2 - d / n);
      b.cyl(fall, 0.14, 0.14, 8, -(plane(s) + 0.19), fall / 2, u, DARK_CONCRETE);
      face(s, u, top - 0.3, 0.36, 0.3, 0.3, 0.2, DARK_CONCRETE);
      face(s, u, 0.12, 0.2, 0.24, 0.3, 0.2, DARK_CONCRETE);
      for (let y = 1.2; y < fall - 0.4; y += 1.8) face(s, u, y, 0.22, 0.05, 0.19, 0.1, DARK_CONCRETE);
    }
  }

  // --- the storeys above: panels, sills, the band's frame, the shelves --------
  //
  // One precast panel per bay, jointed on the mullions and 5 cm proud, with a
  // drip at the floor line and a sill at the top — both a shading band and an
  // ink line, which is what a flat spandrel was not. The sill stands 2 cm over
  // the spandrel's collider, never more. The band's own frame is at the
  // mullions' plane; the shelf over it is a sun-shade blade on brackets, over
  // reach from inside and five metres up from out.
  //
  // Inside, a radiator under the window wherever a floor is under it — the
  // lane at the foot of each flight is a void — and a venetian blind in about
  // half the bays, which is what the band reads as occupied by from the street.
  /** Whether storey `s` has floor under (x, z): its slab, or the landing. */
  const floored = (s: number, x: number, z: number): boolean => {
    const cx = (-laneSide(s - 1) * lane) / 2;
    if (Math.abs(x - cx) <= (w - lane) / 2) return true;
    return z >= (levelY(s) - levelY(s - 1)) / GRADE / 2;
  };
  for (let s = 1; s < floors; s++) {
    const y = levelY(s);
    const ceil = (s + 1) * STOREY - SLAB;
    for (const [si, sd] of SIDES.entries()) {
      const L = span(sd);
      const inner = L - WALL;
      const n = Math.max(1, Math.round(inner / MULLION_PITCH));
      const bay = inner / n;
      for (let i = 0; i < n; i++) {
        const u0 = i === 0 ? -L / 2 - 0.05 : -inner / 2 + i * bay;
        const u1 = i === n - 1 ? L / 2 + 0.05 : -inner / 2 + (i + 1) * bay;
        face(sd, (u0 + u1) / 2, y + 0.5, u1 - u0 - JOINT, 0.78, 0.05, 0.025, CONCRETE, 0, hideBack(sd));
      }
      face(sd, 0, y + 0.06, L + 0.24, 0.12, 0.12, 0.06, DARK_CONCRETE);
      face(sd, 0, y + SPANDREL - 0.04, L + 0.28, 0.12, 0.18, 0.05, CONCRETE);
      face(sd, 0, y + SPANDREL + 0.015, inner, 0.03, 0.2, -WALL / 2, ALLOY);
      face(sd, 0, y + HEAD - 0.04, inner, 0.08, 0.2, -WALL / 2, ALLOY);
      face(sd, 0, y + HEAD + 0.03, L + 0.3, 0.06, 0.5, 0.25, ALLOY);
      for (let i = 0; i <= n; i++) {
        face(sd, -inner / 2 + i * bay, y + HEAD - 0.08, 0.06, 0.16, 0.44, 0.25, ALLOY);
      }
      // The header's corners, and the floor line's under the spandrel, over the
      // notch the two walls leave between them.
      if (si === 0 || si === 1) {
        for (const k of [-1, 1]) {
          const cx = k * (w / 2 + WALL / 4);
          const cz = outward(sd) * (d / 2 + WALL / 4);
          sb.box(WALL / 2, ceil - (y + HEAD), WALL / 2, cx, (ceil + y + HEAD) / 2, cz, CONCRETE);
          sb.box(WALL / 2, SLAB, WALL / 2, cx, y - SLAB / 2, cz, CONCRETE);
        }
      }

      for (let i = 0; i < n; i++) {
        const u = -inner / 2 + (i + 0.5) * bay;
        const r = rnd();
        const warm = rnd();
        if (r < 0.55) {
          // Pulled up, or down a little, or hanging off one cord — and the
          // lowest corner of the worst of them is still 2.0 m over the floor.
          const drop = 0.16 + r * 0.33;
          const tilt = r < 0.12 ? (r - 0.06) * 2 : 0;
          face(sd, u, y + HEAD - drop / 2, bay - 0.3, drop, 0.03, -WALL - 0.06, ASHLAR, tilt);
        }
        const inside = plane(sd) - WALL - 0.3;
        const [px, pz] = runsAlongX(sd) ? [u, outward(sd) * inside] : [outward(sd) * inside, u];
        if (warm > 0.3 && floored(s, px, pz)) {
          const rw = Math.min(1.6, bay - 0.5);
          face(sd, u, y + 0.42, rw, 0.5, 0.08, -WALL - 0.04, ALLOY);
          face(sd, u, y + 0.64, rw - 0.1, 0.03, 0.05, -WALL - 0.09, DARK_CONCRETE);
        }
      }
    }
  }

  // --- the ceilings, and what is on them -------------------------------------
  //
  // On every storey but the ground, a grid of recessed fittings on the soffit
  // — lenses, 1.2 m by 0.3, never a lit ceiling: the tower measured what a
  // whole lit soffit does under the bloom, which is a white rectangle. There is
  // no ceiling SHEET under them: a down-facing face takes no sky term, so a
  // pale one draws exactly as black as the slab, and it cost a second shading
  // of every ceiling pixel for it.
  for (let s = 1; s < floors; s++) {
    const under = (s + 1 < floors ? levelY(s + 1) : top) - SLAB;
    let x0 = -w / 2 + WALL / 2;
    let x1 = w / 2 - WALL / 2;
    if (s + 1 < floors) {
      const cx = (-laneSide(s) * lane) / 2;
      x0 = Math.max(x0, cx - (w - lane) / 2);
      x1 = Math.min(x1, cx + (w - lane) / 2);
    }
    const zin = d / 2 - WALL / 2;
    const nx = Math.max(1, Math.floor((x1 - x0 - 1.2) / 3.0));
    const nz = Math.max(1, Math.floor((zin * 2 - 1.2) / 3.0));
    for (let i = 0; i <= nx; i++) {
      for (let j = 0; j <= nz; j++) {
        const lx = (x0 + x1) / 2 + (i - nx / 2) * 3.0;
        const lz = (j - nz / 2) * 3.0;
        if (Math.abs(lx) < coreW / 2 + 0.8 && Math.abs(lz - coreZ) < coreD / 2 + 0.6) continue;
        lamps.box(1.2, 0.03, 0.3, lx, under - 0.015, lz, WINDOW_LIGHT);
      }
    }
  }

  // --- the core's faces --------------------------------------------------------
  //
  // Two lift cars on its +Z face at every storey, the call panel between them
  // and the storey's number over it; a riser door behind; and on the ground
  // floor, facing the front door, the building's directory.
  {
    const fz = coreZ + coreD / 2;
    const bz = coreZ - coreD / 2;
    for (let s = 0; s < floors; s++) {
      const fy = levelY(s);
      for (const k of [-1, 1]) {
        sb.box(1.3, 2.3, 0.03, k * 1.15, fy + 1.15, fz + 0.015, ALLOY);
        for (const e of [-1, 1]) sb.box(0.56, 2.1, 0.03, k * 1.15 + e * 0.29, fy + 1.05, fz + 0.045, ALLOY);
      }
      sb.box(0.2, 0.36, 0.03, 0, fy + 1.1, fz + 0.015, ALLOY);
      lamps.box(0.06, 0.06, 0.02, 0, fy + 1.16, fz + 0.035, WINDOW_LIGHT);
      sb.box(0.34, 0.34, 0.02, 0, fy + 2.55, fz + 0.01, ASHLAR);
      if (s === 0) {
        sb.box(1.7, 1.2, 0.04, 0, fy + 1.55, bz - 0.02, ALLOY);
        for (let r = 0; r < 5; r++) sb.box(1.4, 0.12, 0.02, 0, fy + 1.1 + r * 0.2, bz - 0.05, ASHLAR);
      } else {
        sb.box(0.9, 2.1, 0.04, coreW * 0.25, fy + 1.05, bz - 0.02, DARK_CONCRETE);
      }
    }
  }

  // --- the cover boxes, drawn as what they are -------------------------------
  //
  // The counter run is four steel filing cabinets under a laminate top, their
  // drawers on both long faces; the partition is a screen system on posts. The
  // top and the cap stand 3–4 cm over the collider; what is on the top, 5 cm.
  for (let s = 1; s < floors; s++) {
    const y = levelY(s);
    const cx = (-laneSide(s - 1) * lane) / 2;
    const rx = cx + 3.0;
    const rz = d * 0.2;
    sb.box(5.46, 0.03, 0.58, rx, y + 1.115, rz, ALLOY);
    sb.box(5.42, 0.08, 0.54, rx, y + 0.04, rz, DARK_CONCRETE);
    for (let i = 0; i < 4; i++) {
      const ux = rx - 2.7 + (i + 0.5) * 1.35;
      for (const k of [-1, 1]) {
        for (let j = 0; j < 3; j++) {
          const dy = y + 0.1 + (j + 0.5) * 0.32;
          sb.box(1.27, 0.29, 0.02, ux, dy, rz + k * 0.26, ENAMEL);
          sb.box(0.3, 0.035, 0.035, ux, dy + 0.08, rz + k * 0.285, ALLOY);
        }
      }
    }
    for (let k = 0; k < 3; k++) {
      const here = rnd();
      const jx = (rnd() - 0.5) * 0.9;
      if (here < 0.4) continue;
      sb.box(0.32, 0.05, 0.24, rx - 1.8 + k * 1.8 + jx, y + 1.155, rz + jx * 0.1, ASHLAR);
    }
    const qx = cx - 4.4;
    const qz = -d * 0.05;
    sb.box(0.56, 0.04, 4.26, qx, y + 1.12, qz, ALLOY);
    for (let i = 0; i <= 3; i++) {
      const pz = qz - 2.1 + i * 1.4;
      sb.box(0.54, 1.1, 0.06, qx, y + 0.55, pz, ALLOY);
      sb.box(0.7, 0.04, 0.1, qx, y + 0.02, pz, ALLOY);
    }
  }

  // --- the roof ---------------------------------------------------------------
  //
  // A metal coping on the parapet, the lift motor room dressed as one (a cap,
  // a door with a bulkhead lamp over it, a louvre and a ladder), the condenser
  // given its fans and its coil, a duct from it into the motor room, a tank on
  // a stand and three extract vents. **The middle stays clear**: a control
  // point stands at the centre of each office and its flag is flown from this
  // roof (`flagMount`), so nothing is drawn within three metres of it.
  for (const sz of [-1, 1]) sb.box(w + 0.72, 0.06, 0.5, 0, top + 0.83, (sz * (d + 0.4)) / 2, ALLOY);
  for (const sx of [-1, 1]) sb.box(0.5, 0.06, d + 0.72, (sx * (w + 0.4)) / 2, top + 0.83, 0, ALLOY);
  {
    const mw = coreW + 1.2;
    const md = coreD + 1.0;
    sb.box(mw + 0.2, 0.1, md + 0.2, 0, top + 2.25, coreZ, ALLOY);
    sb.box(1.0, 2.0, 0.05, -mw * 0.25, top + 1.0, coreZ + md / 2 + 0.025, DARK_CONCRETE);
    lamps.box(0.3, 0.12, 0.08, -mw * 0.25, top + 2.08, coreZ + md / 2 + 0.05, WINDOW_LIGHT);
    sb.box(0.05, 1.2, 2.2, mw / 2 + 0.025, top + 1.3, coreZ, ALLOY);
    for (let i = 0; i < 5; i++) sb.box(0.1, 0.05, 2.1, mw / 2 + 0.07, top + 0.84 + i * 0.23, coreZ, DARK_CONCRETE);
    for (const k of [-1, 1]) sb.box(0.05, 2.5, 0.05, -mw / 2 - 0.18, top + 1.25, coreZ + md * 0.3 + k * 0.22, ALLOY);
    for (let i = 0; i < 7; i++) sb.box(0.03, 0.03, 0.44, -mw / 2 - 0.18, top + 0.3 + i * 0.3, coreZ + md * 0.3, ALLOY);
    b.cyl(3.2, 0.08, 0.1, 6, mw * 0.3, top + 3.9, coreZ - md * 0.3, ALLOY);

    const ax = w * 0.22;
    const az = d * 0.26;
    for (const k of [-1, 1]) {
      b.cyl(0.14, 1.1, 1.1, 12, ax, top + 1.47, az + k * 0.72, DARK_CONCRETE);
      b.cyl(0.14, 0.9, 0.9, 12, ax, top + 1.48, az + k * 0.72, DARK_CONCRETE);
      b.cyl(0.08, 0.2, 0.2, 8, ax, top + 1.56, az + k * 0.72, ALLOY);
      for (let i = 0; i < 4; i++) sb.box(0.05, 0.06, 2.8, ax + k * 1.625, top + 0.35 + i * 0.25, az, DARK_CONCRETE);
    }
    const dy = top + 0.55;
    const zA = az - 1.5;
    sb.box(0.6, 0.45, zA - coreZ + 0.3, ax, dy, (zA + coreZ - 0.3) / 2, ALLOY);
    sb.box(ax + 0.3 - mw / 2, 0.45, 0.6, (ax + 0.3 + mw / 2) / 2, dy, coreZ, ALLOY);
    for (let z = coreZ + 1; z < zA - 0.5; z += 2.2) sb.box(0.08, 0.33, 0.5, ax, top + 0.165, z, DARK_CONCRETE);
    for (let x = mw / 2 + 1; x < ax - 0.5; x += 2.2) sb.box(0.5, 0.33, 0.08, x, top + 0.165, coreZ, DARK_CONCRETE);

    const tx = -w * 0.27;
    const tz = d * 0.2;
    for (const [lx, lz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) {
      sb.box(0.1, 0.9, 0.1, tx + lx, top + 0.45, tz + lz, DARK_CONCRETE);
    }
    sb.box(2.2, 0.1, 2.2, tx, top + 0.95, tz, DARK_CONCRETE);
    b.cyl(1.6, 1.9, 1.9, 14, tx, top + 1.8, tz, ALLOY);
    b.cyl(0.12, 1.5, 1.9, 14, tx, top + 2.66, tz, ALLOY);

    for (const [vx, vz] of [[-w * 0.32, -d * 0.3], [w * 0.35, -d * 0.2], [-w * 0.1, d * 0.34]]) {
      b.cyl(0.6, 0.32, 0.32, 8, vx, top + 0.3, vz, ALLOY);
      b.cyl(0.14, 0.72, 0.5, 8, vx, top + 0.67, vz, ALLOY);
    }
  }
  sb.flush(b);
  lamps.flushGlow(b);
}
