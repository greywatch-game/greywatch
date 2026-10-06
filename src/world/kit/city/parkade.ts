/**
 * kit/city/parkade.ts — buildParkade: three open decks that all shoot each
 * other, drawn by `drawParkade`. Part of the downtown set: follows the
 * contract in kit/core.ts and the set's rules in `./index.ts`.
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
  CONCRETE,
  DARK_CONCRETE,
  ROAD_PAINT,
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
  SLAB,
  GRADE,
  LANDING,
  GROUND,
  HIDE_TOP,
} from "./shared";

/**
 * The multi-storey car park: three open decks and the ramps between them.
 *
 * ## Why a downtown wants one of these more than another office
 *
 * It is the only building on the map you can see INTO from outside and shoot
 * out of from every bearing, because its elevations are a 0.95 m upstand and
 * then nothing until the deck above. So it plays as three stacked open
 * platforms rather than as rooms: cover is the columns and the upstand, the
 * ramps are the choke, and every level is contested from every other. The
 * office is a building you clear; this is a building you fight across.
 *
 * The top deck is OPEN SKY and reachable, which makes it the only roof on the
 * map anything can stand on. That is the whole reason the ramps are ramps and
 * not stairs — a ramp is a surface `NavGrid` rasterises without any special
 * case, so bots contest the roof the same way they contest the street.
 *
 * Lane alternation, the slab voids, the apron at the head of each ramp and the
 * emission order are `office`'s, for the reasons in the set's header and in
 * `LANDING`. What differs is that the columns run the
 * building's FULL height in one box each: a column is solid at every level, so
 * one box blocks all three, and its top face lands flush with the top deck
 * where `HEIGHT_EPS` merges it into a surface that is already there.
 */
export function buildParkade(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "parkade");
  const w = p.width ?? 32;
  const d = p.depth ?? 24;
  const decks = Math.max(2, p.floors ?? 3);
  /** Deck-to-deck. Lower than a storey — nothing here has a ceiling to clear. */
  const DECK = 3.2;
  const lane = 6.0;
  const laneSide = (s: number): -1 | 1 => (s % 2 === 0 ? -1 : 1);
  const laneX = (s: number): number => (laneSide(s) * (w - lane)) / 2;
  const deckY = (s: number): number => (s === 0 ? GROUND : s * DECK);
  const topY = deckY(decks - 1);
  const grid = parkadeColumns(w, d, lane);
  /** The stair bulkhead on the top deck: x, z and its three sizes. */
  const head = { x: w * 0.18, z: -d * 0.3, w: 4.0, h: 2.4, d: 3.4 };

  // Drawn FIRST: it emits no collider, and the merge keeps emission order, so
  // the panels, the paint and the fittings go down before the masses they hide.
  drawParkade(b, { w, d, decks, lane, laneSide, deckY, grid, head });

  // --- walked surfaces first ------------------------------------------------

  // The decks are CONCRETE rather than blacktop, and the reason is that a slab
  // is ONE BOX: its underside wears whatever its top does, and the underside of
  // a deck is the ceiling of the deck below — a downward normal, where the sky
  // term contributes nothing at all and the AO bake takes another 55% off the
  // ambient that is left. So the tone has to earn its keep on a surface getting
  // the least light on the map. Measured on the middle deck under a daylit sky:
  // the walked surface reads 44/255 in concrete against 17 in blacktop, which
  // is the difference between a shaded deck and a hole. It is also what a car
  // park deck is actually made of; the blacktop stays on the office ROOF, which
  // is bitumen and has nobody standing under it.
  b.box(w, SLAB, d, 0, GROUND - SLAB / 2, 0, CONCRETE);
  b.block({ w, h: SLAB, d, x: 0, y: GROUND - SLAB / 2, z: 0 });

  for (let s = 1; s < decks; s++) {
    const y = deckY(s);
    const sw = w - lane;
    const cx = (-laneSide(s - 1) * lane) / 2;
    const slab = b.box(sw, SLAB, d, cx, y - SLAB / 2, 0, CONCRETE);
    b.block({ w: sw, h: SLAB, d, x: cx, y: y - SLAB / 2, z: 0 });
    // A painted edge line along the void, so the drop reads before you take it.
    // It stops where the void does — the apron at the ramp's head is floor, and
    // a line drawn past it would be marking a drop that is not there.
    //
    // **Both boxes are `noInk`, and between them that is what makes the
    // line exist at all.** A deck carrying paint is `buildRoad`'s case exactly
    // — read the long note there for the mechanism — so the same two rules
    // apply: the surface underneath gives up its ink, because an outline's
    // second pass stamps the hull's DEPTH 5 cm above the deck across the whole
    // of it and the line is drawn 6 cm up into that; and the line gives up its
    // own, because a 5 cm shell around a 6 cm box is most of the box and comes
    // out as a dark scratch where a pale mark was wanted. What the deck loses
    // is the ink along its edge over the void — which is the same edge the
    // line is here to call out, drawn dark instead of pale. The other three
    // sides keep theirs from the upstand and the columns standing on them, and
    // the deck below keeps its own ink for the ceiling this slab's underside
    // makes.
    slab.metadata = { ...(slab.metadata ?? {}), noInk: true };
    const open = (deckY(s) - deckY(s - 1)) / GRADE / 2;
    const lineD = d / 2 + open;
    b.box(
      0.3,
      0.06,
      lineD,
      cx + (laneSide(s - 1) * (sw - 0.3)) / 2,
      y + 0.03,
      (open - d / 2) / 2,
      ROAD_PAINT,
    ).metadata = { noInk: true };
  }

  // The ramps. A plain pitched slab rather than `Build.flight`: treads on a car
  // ramp would be wrong to look at, and the collider is the same one box with
  // `rotX` either way — which is the thing a ramp must not be missing (see
  // kit/core.ts, and `buildRamp` next door, which is this shape already).
  for (let s = 0; s + 1 < decks; s++) {
    const from = deckY(s);
    const to = deckY(s + 1);
    const rise = to - from;
    const run = rise / GRADE;
    const pitch = Math.atan(GRADE);
    const x = laneX(s);
    const mid = (from + to) / 2;
    const thick = 0.4;
    if (import.meta.env.DEV && run / 2 + LANDING > d / 2) {
      throw new Error(
        `parkade: a ${d} m plate cannot hold a ${run.toFixed(1)} m ramp and leave ` +
          `the ${LANDING} m its apron needs between the ramp head and the deck ` +
          "edge. See buildParkade, and LANDING.",
      );
    }
    // Placed by its TOP face, whose half-thickness is measured VERTICALLY —
    // `h / 2 / cos`, the mistake `Build.flight`'s header names.
    const y = mid - thick / 2 / Math.cos(pitch);
    b.box(lane, thick, Math.hypot(run, rise), x, y, 0, CONCRETE, { x: -pitch });
    b.block({
      w: lane,
      h: thick,
      d: Math.hypot(run, rise),
      x,
      y,
      z: 0,
      rotX: -pitch,
    });
    // The apron at the head of the ramp, which is `office`'s landing on the
    // same rule: the deck the ramp climbs to omits this lane over its whole
    // depth, so the top of the ramp is otherwise the lip of a two-storey drop
    // with the deck reachable only sideways off it.
    //
    // It runs to the deck's own +Z edge, where the upstand is, rather than
    // stopping at `LANDING` — a fixed apron left 6.1 m of open lane in front of
    // it, which is the same drop with two and a half metres of concrete before
    // it. There is no elevation to run to here, so the edge is the deck's.
    const deep = d / 2 - run / 2;
    const lz = run / 2 + deep / 2;
    b.box(lane, SLAB, deep, x, to - SLAB / 2, lz, CONCRETE);
    b.block({ w: lane, h: SLAB, d: deep, x, y: to - SLAB / 2, z: lz });
  }

  // --- cover and enclosure --------------------------------------------------

  // The upstand around every raised deck: the whole elevation of the building,
  // and the only cover on it. At 0.95 m it is under both of `CoverMap`'s
  // protecting lines (1.3 crouched, 1.7 standing), so what it buys a bot is
  // `soft` — the steering preference that walks it along the edge rather than
  // across the open middle — and what it buys anybody is the low half of a
  // body. Raise it past 1.3 and it becomes something to genuinely duck behind.
  for (let s = 1; s < decks; s++) {
    const y = deckY(s);
    for (const sz of [-1, 1]) {
      b.wall(w, 0.95, 0.35, 0, y + 0.475, (sz * d) / 2, CONCRETE);
    }
    // The full depth on both flanks. It used to stop `lane + 1` short of -Z on
    // the side the ramp arrives, so as not to wall the ramp in where a body
    // leaves it — but a ramp leaves at its HEAD, at +Z, onto the apron, and
    // under the -Z end it is still a storey down. What the cut left was a gap
    // in the elevation with a beam drawn across the lane to carry its end.
    for (const sx of [-1, 1]) {
      b.wall(0.35, 0.95, d, (sx * w) / 2, y + 0.475, 0, CONCRETE);
    }
  }

  // Columns, full height, one box each. See the header.
  for (const x of grid.xs) {
    for (const z of grid.zs) {
      b.box(0.55, topY, 0.55, x, topY / 2, z, DARK_CONCRETE);
      b.block({ w: 0.55, h: topY, d: 0.55, x, y: topY / 2, z });
    }
  }

  // The top deck's own parapet, and the stair bulkhead beside it. Emitted after
  // the decks for the header's first rule, though nothing here is a surface:
  // the parapet's top is 1.05 m over a deck that already has a slot.
  for (const sz of [-1, 1]) {
    b.wall(w, 1.05, 0.35, 0, topY + 0.525, (sz * d) / 2, CONCRETE);
  }
  for (const sx of [-1, 1]) {
    b.wall(0.35, 1.05, d, (sx * w) / 2, topY + 0.525, 0, CONCRETE);
  }
  b.box(head.w, head.h, head.d, head.x, topY + head.h / 2, head.z, DARK_CONCRETE);
  return b;
}

/**
 * Where the parkade's columns stand, as the two lines of a grid — and the one
 * place that is decided, because the collider loop and the drawing both walk
 * it: a column is ON a bay line, under a capital and between two panels.
 *
 * Nothing in a ramp lane: a column in one is a pillar in the road. Both lanes
 * are at `±(w - lane) / 2`, and the margin is half a lane plus a column, so a
 * column ON the lane edge goes too. The arithmetic is the loop's it replaced,
 * float for float, and so is the order (`xs` outer).
 */
function parkadeColumns(
  w: number,
  d: number,
  lane: number,
): { xs: number[]; zs: number[]; pitch: number } {
  const cols = Math.max(2, Math.round(w / 7.5));
  const rows = Math.max(2, Math.round(d / 7.5));
  const xs: number[] = [];
  const zs: number[] = [];
  for (let i = 0; i <= cols; i++) {
    const x = -w / 2 + (i / cols) * w;
    if (Math.abs(Math.abs(x) - (w - lane) / 2) < lane / 2 + 0.4) continue;
    xs.push(x);
  }
  for (let j = 0; j <= rows; j++) zs.push(-d / 2 + (j / rows) * d);
  return { xs, zs, pitch: w / cols };
}

/**
 * Everything on the parkade that is DRAWING, and what it draws it as: a
 * nineteen-seventies multi-storey car park — an in-situ frame of columns and
 * downstand beams, a precast spandrel panel hung on every deck edge, and the
 * paint, the kerbs and the fittings that say what the decks are for. It read
 * as three bare slabs on posts: a blank edge band, a black ceiling, and a box
 * on the roof. It emits no collider (`npm run kit:hash`).
 *
 * Every part obeys one of the three rules a drawing on a collider may take
 * (`model-detail` skill):
 *
 * - **FLAT on a face** — the panels, their ribs and copings, the sign, the
 *   downpipes on the edge columns, the crash barrier inside the upstand, the
 *   bulkhead's door and louvre. A panel stands 6 cm off the upstand and its
 *   ribs 4 cm more; a downpipe 13 cm off its column and the barrier 12 cm off
 *   the upstand's inner face, inside the trim budget the rest of the set
 *   keeps.
 * - **LOW** — the paint at 12 mm, under a capture ring's 18 (this is B on
 *   Coldharbour, and the ring crosses the ground deck); the wheel stops at
 *   10 cm, the ramp kerbs at 14 and their anti-skid ribs at 12 mm.
 * - **OVERHEAD** — the soffit's beams and fittings, which leave exactly 2.4 m
 *   under deck 1 (the shortest storey, its floor being `GROUND` up), and the
 *   capitals, which come lower but never further than 0.43 m from a column's
 *   centre: inside the column plus a body's radius, where no head can be.
 *
 * **The soffit is what the inside of a car park is**, and the set's header's
 * "bright plate under a black lid" is the reason it is drawn at all: a
 * downward face gets no sky term, so a ceiling is black whatever is on it —
 * but a black ceiling ruled into bays by beams and hung with lit battens
 * reads as a structure with lamps in it, where a bare one reads as a hole.
 * The battens are LENSES, so they spend no light slot (header).
 *
 * **The panels are what the outside of one is.** Pale against the dark
 * columns (`ASHLAR`, the downtown's value read), jointed into units between
 * columns, ribbed vertically with a plain margin top and bottom, capped by a
 * coping that stands 6 cm on the upstand. They drop 12 cm under the slab,
 * which turns the upstand that bridges the ramp lane's void at its -Z end into
 * what it then reads as — an edge beam — and two beams across the lane carry
 * it back to the deck.
 *
 * Seeded off the params (`streetSeed`), as the office is: which tubes are
 * dead, which bays have lost their wheel stop, where the rain has run down a
 * panel. Not in `CONFORMS_TO_TERRAIN` — nothing here reaches the ground but
 * the plinth, and the ground slab it faces is level by construction.
 *
 * **One colour is new to the parkade** beyond its own three: `ASHLAR`, plus
 * the `ALLOY` and `WINDOW_LIGHT` lens every office and tower block already
 * carries.
 */
function drawParkade(
  b: Build,
  o: {
    w: number;
    d: number;
    decks: number;
    lane: number;
    laneSide: (s: number) => -1 | 1;
    deckY: (s: number) => number;
    grid: { xs: readonly number[]; zs: readonly number[]; pitch: number };
    head: { x: number; z: number; w: number; h: number; d: number };
  },
): void {
  const { w, d, decks, lane, laneSide, deckY, head } = o;
  const { xs, zs } = o.grid;
  const topY = deckY(decks - 1);
  // A thousand-odd boxes, and as parts each is a mesh for the merge to build
  // and throw away (`drawOffice`'s reason). Lenses in a batch of their own.
  const sb = new StoneBatch();
  const lamps = new StoneBatch();
  const rnd = mulberry32(streetSeed(w, d, decks));
  /** Half the upstand: an elevation's outer face is this past the plate edge. */
  const UP = 0.175;
  const PANEL = 0.06;
  const JOINT = 0.03;
  const plane = (s: Side): number => (runsAlongX(s) ? d : w) / 2 + UP;
  const face = (
    s: Side,
    u: number,
    y: number,
    along: number,
    tall: number,
    thick: number,
    out: number,
    color: string,
    hide = 0,
  ): void => sb.onFace(s, plane(s), u, y, along, tall, thick, out, color, 0, 0, hide);
  /** Deck `s`'s slab on X — the whole plate on the ground. */
  const deckX = (s: number): [number, number] => {
    if (s === 0) return [-w / 2, w / 2];
    const cx = (-laneSide(s - 1) * lane) / 2;
    return [cx - (w - lane) / 2, cx + (w - lane) / 2];
  };
  const edgeRow = (z: number): boolean => Math.abs(z) > d / 2 - 0.01;
  /** A painted arrow's head, as the widths of the bars it is stepped from. */
  const ARROW_HEAD = [1.0, 0.8, 0.6, 0.4, 0.2] as const;

  // --- the elevations: precast spandrel panels ----------------------------------
  for (let s = 1; s < decks; s++) {
    const y = deckY(s);
    // The top deck's band is its parapet, which stands over the upstand.
    const top = s === decks - 1 ? 1.05 : 0.95;
    const yb = y - SLAB - 0.12;
    const yt = y + top - 0.02;
    const ph = yt - yb;
    const runs: [Side, [number, number][]][] = [];
    for (const sd of ["-z", "+z"] as const) {
      // Past the corner by the panel, so the flank's panel closes behind it;
      // broken at every column, which stands 4 cm proud of the panels between.
      const L = w / 2 + UP + PANEL;
      runs.push([sd, carve(-L, L, xs.map((x): [number, number] => [x - 0.3, x + 0.3]))]);
    }
    for (const sd of ["-x", "+x"] as const) runs.push([sd, [[-d / 2 - UP, d / 2 + UP]]]);
    for (const [sd, segs] of runs) {
      for (const [a, z] of segs) {
        const n = Math.max(1, Math.round((z - a) / 2.7));
        const step = (z - a) / n;
        for (let k = 0; k < n; k++) {
          const u0 = a + k * step + (k > 0 ? JOINT / 2 : 0);
          const u1 = a + (k + 1) * step - (k < n - 1 ? JOINT / 2 : 0);
          const uc = (u0 + u1) / 2;
          // The back stays: under the slab it is seen from inside.
          face(sd, uc, (yb + yt) / 2, u1 - u0, ph, PANEL, PANEL / 2, ASHLAR);
          const nr = Math.max(1, Math.floor((u1 - u0 - 0.3) / 0.45));
          const rh = ph - 0.38;
          for (let r = 0; r < nr; r++) {
            const ru = uc + (r - (nr - 1) / 2) * 0.45;
            face(sd, ru, yb + 0.28 + rh / 2, 0.1, rh, 0.04, PANEL + 0.02, ASHLAR, hideBack(sd) | HIDE_UNDER);
          }
          // Where the rain has run off the coping: a stain down one gap
          // between two ribs on about a third of the units — in the GAP, or
          // the rib swallows it and what is left reads as a dotted line.
          if (nr > 1 && rnd() < 0.35) {
            const r = Math.floor(rnd() * (nr - 1));
            const len = 0.3 + rnd() * 0.8;
            const su = uc + (r + 0.5 - (nr - 1) / 2) * 0.45;
            face(sd, su, yt - len / 2, 0.07, len, 0.01, PANEL + 0.005, DARK_CONCRETE, hideBack(sd));
          }
        }
      }
      // The coping, standing on the upstand from its inner face to past the
      // panel's outer one. Same length as the run, closing the corner.
      const segA = segs[0][0];
      const segZ = segs[segs.length - 1][1];
      const T = 2 * UP + PANEL + 0.05;
      face(sd, (segA + segZ) / 2, y + top + 0.03, segZ - segA, 0.06, T, (PANEL + 0.02 - 2 * UP - 0.03) / 2, ASHLAR);
    }
    // A drain spout through the band at each end of both long sides.
    for (const sd of ["-z", "+z"] as const) {
      for (const k of [-1, 1]) face(sd, k * (w / 2 - 1.6), y - 0.05, 0.1, 0.1, 0.36, 0.18, ALLOY);
    }

    // What CARRIES the band over the ramp lane. A deck leaves the lane its
    // ramp arrives in open except for the apron, so the upstand along -Z
    // stands over nothing there — the collider's fact, and the panels hung on
    // it made it read. A beam across the lane at the slab's own depth, under
    // that upstand, is what a frame would have; it leaves the floor beneath it
    // the 2.4 m the soffit leaves everywhere (checked, or not drawn).
    {
      const lx = (laneSide(s - 1) * (w - lane - 0.4)) / 2;
      const bz = -d / 2 + 0.35;
      const run = (y - deckY(s - 1)) / GRADE;
      const ramp = deckY(s - 1) + Math.max(0, bz + run / 2) * GRADE;
      if (y - SLAB - ramp >= 2.4 - 1e-6) {
        sb.box(lane + 0.4, SLAB, 0.35, lx, y - SLAB / 2, bz, CONCRETE, undefined, HIDE_TOP);
      }
    }

    // The crash barrier on the upstand's inner face: a steel rail on posts at
    // bumper height, 12 cm off the wall, broken round every column.
    const rail = (sd: Side, a: number, z: number): void => {
      const n = outward(sd);
      const pl = (runsAlongX(sd) ? d : w) / 2 - UP;
      const at = (u: number, out: number): [number, number] => (runsAlongX(sd) ? [u, n * (pl - out)] : [n * (pl - out), u]);
      for (const [r0, r1] of carve(a, z, runsAlongX(sd) ? xs.map((x): [number, number] => [x - 0.32, x + 0.32]) : [])) {
        if (r1 - r0 < 0.4) continue;
        const [cx, cz] = at((r0 + r1) / 2, 0.09);
        const len = r1 - r0;
        sb.box(runsAlongX(sd) ? len : 0.06, 0.3, runsAlongX(sd) ? 0.06 : len, cx, y + 0.55, cz, ALLOY);
        const np = Math.max(1, Math.round(len / 2.4));
        for (let k = 0; k <= np; k++) {
          const [px, pz] = at(r0 + 0.1 + (k / np) * (len - 0.2), 0.04);
          sb.box(0.09, 0.62, 0.09, px, y + 0.31, pz, DARK_CONCRETE, undefined, HIDE_UNDER);
        }
      }
    };
    for (const sd of ["-z", "+z"] as const) rail(sd, -w / 2 + UP, w / 2 - UP);
    for (const sd of ["-x", "+x"] as const) rail(sd, -d / 2 + UP, d / 2 - UP);
  }

  // The ground slab's edge: a dark plinth course, 2 cm under the deck so the
  // two colours never share its plane.
  for (const sd of ["-z", "+z", "-x", "+x"] as const) {
    const along = (runsAlongX(sd) ? w : d) + (runsAlongX(sd) ? 0.08 : 0);
    sb.onFace(sd, (runsAlongX(sd) ? d : w) / 2, 0, 0.08, along, 0.2, 0.04, 0.02, DARK_CONCRETE, 0, 0, hideBack(sd));
  }

  // --- the sign: a lit P on the first band of each long side --------------------
  //
  // The LETTER is the lens and the plate is dark: a lit plate the size of a
  // window blooms into a lantern and takes the letter with it (craft notes).
  // Mirrored per side so the bowl is on the right from the street — this is a
  // left-handed frame, so a viewer outside -Z has +X on their right.
  for (const sd of ["-z", "+z"] as const) {
    const m = sd === "+z" ? -1 : 1;
    const uc = sd === "+z" ? (xs[xs.length - 2] + xs[xs.length - 1]) / 2 : (xs[0] + xs[1]) / 2;
    const yc = deckY(1) + 0.2;
    face(sd, uc, yc, 1.3, 1.3, 0.03, 0.115, ALLOY);
    face(sd, uc, yc, 1.16, 1.16, 0.03, 0.135, DARK_CONCRETE);
    const P: [number, number, number, number][] = [
      [-0.2, 0, 0.17, 0.86],
      [-0.035, 0.345, 0.5, 0.17],
      [-0.035, -0.015, 0.5, 0.15],
      [0.215, 0.165, 0.16, 0.51],
    ];
    for (const [px, py, pw, ph] of P) {
      lamps.onFace(sd, plane(sd), uc + m * px, yc + py, pw, ph, 0.02, 0.16, WINDOW_LIGHT);
    }
  }

  // --- the columns ----------------------------------------------------------------
  //
  // A painted foot on every storey a column stands in — pale, with two dark
  // bands, which is what a car park does to a column a driver must see — and a
  // capital under every deck it carries. The edge columns stand in the
  // upstand above the ground, so they get neither up there; on the elevation
  // they carry a downpipe instead, at the two outer columns of each long side.
  for (const x of xs) {
    for (const z of zs) {
      const edge = edgeRow(z);
      for (let s = 0; s + 1 < decks; s++) {
        if (edge && s > 0) continue;
        const fy = deckY(s);
        sb.box(0.57, 0.9, 0.57, x, fy + 0.45, z, ROAD_PAINT, undefined, HIDE_UNDER);
        for (const by of [0.3, 0.62]) sb.box(0.59, 0.1, 0.59, x, fy + by, z, DARK_CONCRETE, undefined, HIDE_UNDER);
      }
      if (edge) continue;
      for (let s = 1; s < decks; s++) {
        const [x0, x1] = deckX(s);
        if (x < x0 || x > x1) continue;
        sb.box(0.95, 0.22, 0.95, x, deckY(s) - SLAB - 0.11, z, DARK_CONCRETE, undefined, HIDE_TOP);
      }
    }
  }
  for (const sd of ["-z", "+z"] as const) {
    for (const x of [xs[0], xs[xs.length - 1]]) {
      // 0.1 is the column's face past the upstand's; the pipe is on it.
      const out = 0.1 + 0.065;
      const fall = topY + 0.9;
      face(sd, x, fall / 2 + 0.05, 0.13, fall - 0.1, 0.13, out, ALLOY, hideBack(sd));
      face(sd, x, fall - 0.05, 0.3, 0.3, 0.26, 0.1 + 0.13, ALLOY);
      face(sd, x, 0.14, 0.18, 0.18, 0.3, 0.1 + 0.15, ALLOY);
      for (let y = 1.2; y < fall - 0.4; y += 1.8) face(sd, x, y, 0.2, 0.05, 0.2, 0.1 + 0.1, DARK_CONCRETE);
    }
  }

  // --- the soffits: beams, the void's edge, and the battens ------------------------
  for (let s = 1; s < decks; s++) {
    const sy = deckY(s) - SLAB;
    const [x0, x1] = deckX(s);
    for (const z of zs) {
      if (edgeRow(z)) continue;
      sb.box(x1 - x0 - 0.1, 0.1, 0.5, (x0 + x1) / 2, sy - 0.05, z, CONCRETE, undefined, HIDE_TOP);
    }
    for (const x of xs) {
      if (x < x0 || x > x1) continue;
      sb.box(0.5, 0.1, d - 0.4, x, sy - 0.05, 0, CONCRETE, undefined, HIDE_TOP);
    }
    const vx = laneSide(s - 1) < 0 ? x0 + 0.175 : x1 - 0.175;
    sb.box(0.35, 0.1, d - 0.1, vx, sy - 0.05, 0, CONCRETE, undefined, HIDE_TOP);
    // A batten in the middle of each bay of the grid, two where a bay is
    // long; about one in eight is dead and shows only its housing.
    const stops = [x0, ...xs.filter((x) => x > x0 + 0.5 && x < x1 - 0.5), x1];
    for (let j = 0; j + 1 < zs.length; j++) {
      const z = (zs[j] + zs[j + 1]) / 2;
      for (let i = 0; i + 1 < stops.length; i++) {
        const n = Math.max(1, Math.round((stops[i + 1] - stops[i]) / 4));
        for (let k = 0; k < n; k++) {
          const x = stops[i] + ((k + 0.5) / n) * (stops[i + 1] - stops[i]);
          sb.box(1.3, 0.06, 0.2, x, sy - 0.03, z, ALLOY, undefined, HIDE_TOP);
          if (rnd() < 0.12) continue;
          lamps.box(1.15, 0.02, 0.09, x, sy - 0.07, z, WINDOW_LIGHT);
        }
      }
    }
  }

  // --- the decks: bays, wheel stops, a drain, the arrows ---------------------------
  //
  // Bays along both long edges, three to a column bay so every column stands on
  // a line, clear of both ramp lanes on every level. Paint is 12 mm proud, a
  // wheel stop 10 cm; the stair bulkhead's footprint on the top deck is left
  // bare.
  const bx0 = -w / 2 + lane + 0.4;
  const bx1 = -bx0;
  const bay = o.grid.pitch / 3;
  const onHead = (s: number, x: number, z: number, r: number): boolean =>
    s === decks - 1 && Math.abs(x - head.x) < head.w / 2 + r && Math.abs(z - head.z) < head.d / 2 + r;
  const PAINT = 0.012;
  for (let s = 0; s < decks; s++) {
    const fy = deckY(s);
    const e = s === 0 ? d / 2 - 0.3 : d / 2 - UP - 0.05;
    const lines: number[] = [];
    for (let x = -w / 2 + Math.ceil((bx0 + w / 2) / bay - 1e-6) * bay; x <= bx1 + 1e-6; x += bay) lines.push(x);
    for (const sz of [-1, 1]) {
      const zc = sz * (e - 2.4);
      for (const x of lines) {
        if (onHead(s, x, zc, 2.4)) continue;
        sb.box(0.1, PAINT, 4.8, x, fy + PAINT / 2, zc, ROAD_PAINT, undefined, HIDE_UNDER);
      }
      for (let i = 0; i + 1 < lines.length; i++) {
        const xm = (lines[i] + lines[i + 1]) / 2;
        const zs0 = sz * (e - 0.75);
        if (onHead(s, xm, zs0, 0.8) || rnd() < 0.15) continue;
        sb.box(1.5, 0.1, 0.16, xm, fy + 0.05, zs0, ASHLAR, undefined, HIDE_UNDER);
      }
    }
    // The aisle's drain, a grating along its middle.
    sb.box(bx1 - bx0, PAINT, 0.16, 0, fy + PAINT / 2, 0, ALLOY, undefined, HIDE_UNDER);
    // Arrows toward the ramp that leaves this deck — none on the roof.
    if (s + 1 < decks) {
      const dir = laneSide(s);
      for (const ax of [-bx1 * 0.45, bx1 * 0.45]) {
        const az = -2.4;
        sb.box(1.6, PAINT, 0.22, ax, fy + PAINT / 2, az, ROAD_PAINT, undefined, HIDE_UNDER);
        for (const [k, wd] of ARROW_HEAD.entries()) {
          sb.box(0.12, PAINT, wd, ax + dir * (0.86 + k * 0.12), fy + PAINT / 2, az, ROAD_PAINT, undefined, HIDE_UNDER);
        }
      }
    }
  }

  // --- the ramps: kerbs, anti-skid ribs and an arrow up --------------------------
  //
  // Everything here lies ON the pitched slab: a box at horizontal position `z`
  // is stood on the top plane through (x, mid, 0) and lifted along its normal.
  for (let s = 0; s + 1 < decks; s++) {
    const from = deckY(s);
    const to = deckY(s + 1);
    const rise = to - from;
    const run = rise / GRADE;
    const pitch = Math.atan(GRADE);
    const mid = (from + to) / 2;
    const x = (laneSide(s) * (w - lane)) / 2;
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const on = (lx: number, z: number, wl: number, h: number, len: number, color: string): void =>
      sb.box(wl, h, len, x + lx, mid + z * GRADE + (cp * h) / 2, z - (sp * h) / 2, color, { x: -pitch }, HIDE_UNDER);
    for (const k of [-1, 1]) on(k * (lane / 2 - 0.16), 0, 0.3, 0.14, Math.hypot(run, rise), ASHLAR);
    const az = -run * 0.3;
    // In the slab's own colour: a dark rib every half metre read as treads,
    // which is the one thing a car ramp must not look like.
    for (let z = -run / 2 + 0.6; z < run / 2 - 0.5; z += 0.45) {
      if (Math.abs(z - az - 0.3) < 1.3) continue;
      on(0, z, lane - 0.9, 0.018, 0.07, CONCRETE);
    }
    on(0, az, 0.22, PAINT, 1.4, ROAD_PAINT);
    for (const [k, wd] of ARROW_HEAD.entries()) on(0, az + 0.76 + k * 0.12, wd, PAINT, 0.12, ROAD_PAINT);
  }

  // --- the roof: lamps on the parapet, and the stair bulkhead ----------------------
  //
  // Four lamp standards bolted to the parapet's coping (standing ON the
  // collider), the lantern on an arm over the deck at 4.5 m. Lenses only.
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    const lx = sx * (w / 2 - 5);
    const lz = sz * (d / 2);
    const base = topY + 1.05 + 0.06;
    sb.box(0.32, 0.08, 0.32, lx, base + 0.04, lz, ALLOY, undefined, HIDE_UNDER);
    sb.box(0.14, 3.6, 0.14, lx, base + 1.8, lz, ALLOY, undefined, HIDE_UNDER);
    sb.box(0.1, 0.1, 1.1, lx, base + 3.55, lz - sz * 0.55, ALLOY);
    sb.box(0.34, 0.16, 0.6, lx, base + 3.45, lz - sz * 1.05, ALLOY);
    lamps.box(0.28, 0.02, 0.5, lx, base + 3.36, lz - sz * 1.05, WINDOW_LIGHT);
  }
  {
    const hy = topY;
    const fz = head.z + head.d / 2;
    const fx = head.x - head.w / 2;
    // The roof slab over it, overhanging a hand; a vent on it.
    sb.box(head.w + 0.3, 0.16, head.d + 0.3, head.x, hy + head.h + 0.08, head.z, CONCRETE);
    sb.box(0.5, 0.5, 0.5, head.x + 0.9, hy + head.h + 0.41, head.z - 0.4, ALLOY, undefined, HIDE_UNDER);
    sb.box(0.7, 0.06, 0.7, head.x + 0.9, hy + head.h + 0.69, head.z - 0.4, ALLOY);
    // The door, facing the deck: frame, leaf, push bar, vision panel; the
    // lamp over it and a plate beside it.
    const dx = head.x - 0.8;
    sb.box(1.3, 2.25, 0.05, dx, hy + 1.125, fz + 0.025, ASHLAR, undefined, HIDE_UNDER);
    sb.box(1.0, 2.05, 0.05, dx, hy + 1.035, fz + 0.05, ALLOY, undefined, HIDE_UNDER);
    sb.box(0.3, 0.5, 0.02, dx, hy + 1.55, fz + 0.08, DARK_CONCRETE);
    sb.box(0.6, 0.05, 0.06, dx, hy + 1.0, fz + 0.1, DARK_CONCRETE);
    sb.box(0.3, 0.14, 0.2, dx, hy + 2.32, fz + 0.1, ALLOY);
    lamps.box(0.24, 0.02, 0.14, dx, hy + 2.24, fz + 0.12, WINDOW_LIGHT);
    sb.box(0.5, 0.32, 0.03, head.x + 0.6, hy + 1.6, fz + 0.015, ROAD_PAINT);
    // A louvre on the flank, over the plant behind it.
    sb.box(0.05, 1.0, 1.4, fx - 0.025, hy + 1.5, head.z, ALLOY, undefined, HIDE_UNDER);
    for (let i = 0; i < 5; i++) {
      sb.box(0.12, 0.05, 1.3, fx - 0.07, hy + 1.12 + i * 0.18, head.z, DARK_CONCRETE, { z: 0.6 });
    }
  }

  sb.flush(b);
  lamps.flushGlow(b);
}
