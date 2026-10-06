/**
 * kit/city/shophouse.ts — buildShophouse: a shop with flats over it and a
 * passage beside it, drawn by `drawShophouse` with its sashes in a
 * `REVEAL`. Part of the downtown set: follows the contract in kit/core.ts and
 * the set's rules in `./index.ts`.
 */
import { Scene } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import { mulberry32 } from "../../rng";
import {
  Build,
  type BuildParams,
  type Structure,
  ALLOY,
  ASPHALT,
  AWNING,
  BRICK,
  CASEMENT,
  CITY_BRICK,
  CONCRETE,
  DARK_CONCRETE,
  IRON,
  PLANK,
  PLASTER,
  RENDER,
  ROAD_PAINT,
  ROOM_GLOW,
  TEAK,
  WINDOW_LIGHT,
  StoneBatch,
  carve,
  streetSeed,
  HIDE_UNDER,
  hideBack,
  runsAlongX,
  type Hole,
  type Side,
} from "../core";
import {
  STOREY,
  SLAB,
  WALL,
  GRADE,
  GROUND,
  DOORWAY,
  levelY,
  laneFlight,
  HIDE_TOP,
  hideEnds,
} from "./shared";

/**
 * The shophouse: a shop at the pavement with flats over it, and the piece that
 * puts something other than a tower between the towers.
 *
 * ## Why a city needs one, given it already has an office
 *
 * `buildOffice` is a plate you fight ACROSS — one room per storey, cover in
 * the middle of it, and three bearings of window band to shoot out of. This is
 * the opposite building at a quarter of the footprint: 13 m of frontage, a
 * shop at the bottom with one glazed wall and no other opening, and flats over
 * it cut into rooms by partitions. What you get is the close-quarters space
 * the downtown had none of — a fight measured in doorways rather than in
 * sightlines — and a terrace of them gives a block face a grain that a row of
 * 26 m towers cannot.
 *
 * It shares the office's CIRCULATION and nothing else, because the lane
 * arrangement is the set's header's answer to stacking floors rather than one
 * building's idea: a flight in a lane at one X edge, the lane alternating
 * storey by storey so the slab above a flight is never the one that would
 * blank it out of the nav graph, and `laneFlight` emitting both halves. At
 * this width the lane is a third of the plate, so what is left of each upper
 * floor is a 9.6 m room — which is a flat, and is why the same arrangement
 * reads as a tenement stair here and as an atrium there.
 *
 * ## What the ground floor is
 *
 * Two spaces, not one, and that is the whole of its design. The SHOP is the
 * glazed frontage and takes the width the lane does not; the CLOSE is the
 * stairwell over the lane, entered by its own street door beside the shopfront,
 * with the foot of the stair three metres inside it. So a squad holding the
 * shop is not holding the flats, and somebody can be on the first floor while
 * somebody else is behind the counter — which is the thing a single-volume
 * building can never do.
 *
 * **The two are joined at one end and not the other, and the geometry does it
 * rather than a rule.** The stair climbs -Z, so the close's rear is under the
 * landing at the far end and opens into the shop's back room; the middle of the
 * close is under the flight itself, where the headroom falls below `NavGrid`'s
 * 1.7 m about a third of the way along and the graph stops. So you can step
 * from the shop into the back of the close and you cannot get to the stair that
 * way — the way up is the close's own door, off the street. Nothing enforces
 * that; a flight with a 3.6 m rise over ten metres of run enforces it.
 *
 * A lane is void at the level its flight climbs to and covered by the slab two
 * floors up, so the close is open from the pavement to the SECOND floor's
 * soffit — two storeys of stairwell to shoot up and down, which is
 * `buildOffice`'s atrium at a quarter of the width. On a two-storey unit there
 * is no slab to close it and it runs to the roof.
 *
 * ## The glass, and the two sheets that break
 *
 * The shopfront is the case `PaneSpec.breakable` exists for and passes its
 * test outright: there is a room behind it and the pane is the only thing in
 * the way. It is cut into TWO bays by its piers rather than glazed as one
 * sheet, for `buildOffice`'s reasons — a round takes out a bay and leaves the
 * frame, and 12 m² is a burst of shards can account for.
 *
 * Nothing else here is glass at all. The sash windows upstairs are drawn at
 * the back of a reveal in the shell, whose collider stops a round 12 cm in
 * front of them, and breaking one would open nothing — so they are `CASEMENT`,
 * the kit's glazing for a window with nobody behind it, like the townhouse's,
 * rather than sheets. See `drawShophouse`.
 *
 * ## The elevation is chosen by the storey count
 *
 * Three storeys is later, taller stock in brick; two is older and rendered.
 * One number, two elevations, exactly as `buildTower` picks its skin off its
 * own height — so a terrace written as a run of placements comes out mixed
 * without a layout ever naming a material, and there is no way to ask for a
 * rendered five-storey block by accident.
 */
export function buildShophouse(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "shophouse");
  const w = p.width ?? 13;
  const d = p.depth ?? 16;
  const floors = Math.max(2, p.floors ?? 3);
  const top = levelY(floors);
  /** Stair lane width, and the flight's width with it. `buildOffice`'s. */
  const lane = 3.4;
  const laneSide = (s: number): -1 | 1 => (s % 2 === 0 ? -1 : 1);
  const laneX = (s: number): number => (laneSide(s) * (w - lane)) / 2;
  /** Where the slab is, at a level whose flight came up the other edge. */
  const slabX = (s: number): number => (-laneSide(s - 1) * lane) / 2;
  const slabW = w - lane;
  /** See the header: the storey count picks the elevation, nothing else does. */
  const brick = floors >= 3;
  const skin = brick ? CITY_BRICK : RENDER;
  const blind = p.tint ?? AWNING;
  /** Ground-floor clear height, under the first floor's slab. */
  const gh = STOREY - SLAB - GROUND;

  // The shopfront's plan and the street elevation's one real window, read by
  // the colliders below and by the drawing alike — see where each is spent.
  const shopW = slabW;
  const shopX0 = -w / 2 + lane;
  const pier = 0.6;
  const bays = shopW >= 9 ? 2 : 1;
  const bay = (shopW - pier * (bays + 2) - DOORWAY) / bays;
  const openW = 1.9;
  const jamb = (w - openW) / 2;

  // --- the drawing, FIRST ---------------------------------------------------
  //
  // Everything that is not a mass or a collider, emitted before the masses it
  // lies on so the depth test rejects what it hides — see `drawShophouse`.
  drawShophouse(b, {
    w,
    d,
    floors,
    top,
    lane,
    laneX,
    laneSide,
    slabX,
    slabW,
    brick,
    skin,
    blind,
    shopX0,
    shopW,
    pier,
    bays,
    bay,
    openW,
    jamb,
    sign: p.sign,
    litWindows: p.litWindows,
  });

  // --- walked surfaces first (set's header, first rule) ---------------------

  b.box(w, SLAB, d, 0, GROUND - SLAB / 2, 0, DARK_CONCRETE);
  b.block({ w, h: SLAB, d, x: 0, y: GROUND - SLAB / 2, z: 0 });

  // Upper slabs, each one box, each missing the lane its flight climbed. The
  // slab is PLASTER rather than the city's concrete because its underside is
  // the ceiling of the room below — the parkade's deck argument, indoors — and
  // the boards laid on top are what the room above walks on.
  for (let s = 1; s < floors; s++) {
    const y = levelY(s);
    b.box(slabW, SLAB, d, slabX(s), y - SLAB / 2, 0, PLASTER);
    b.block({ w: slabW, h: SLAB, d, x: slabX(s), y: y - SLAB / 2, z: 0 });
    b.box(slabW - 0.5, 0.06, d - 0.5, slabX(s), y - 0.03, 0, PLANK);
  }

  // The stair climbs -Z, which is the one thing about this building's
  // circulation that is not the office's — see `laneFlight`. The close's own
  // street door is on +Z, so the FOOT has to be at +Z; with the office's
  // direction the door opened two metres from the blind end of the flight, and
  // the way up was a 3.4 m wall you could see the underside of.
  for (let s = 0; s + 1 < floors; s++) {
    laneFlight({
      b,
      tag: "shophouse",
      x: laneX(s),
      lane,
      depth: d,
      from: levelY(s),
      to: levelY(s + 1),
      dir: -1,
      tread: PLANK,
      landing: PLASTER,
    });
  }

  // --- the ground floor: the shop, and the close beside it ------------------

  const g0 = GROUND;
  const gy = g0 + gh / 2;
  // Back and sides. The sides are PARTY WALLS and stay blank at every level —
  // a terrace is written as a run of these standing shoulder to shoulder, so
  // anything drawn on them is drawn inside the neighbour.
  b.doorWall(w, gh, WALL, 0, gy, -d / 2, skin, DOORWAY, 2.3);
  b.wall(WALL, gh, d, -w / 2, gy, 0, skin);
  b.wall(WALL, gh, d, w / 2, gy, 0, skin);

  // The close's street door, over the lane and beside the shopfront. Its own
  // way in, which is what makes the flats a separate building to fight for.
  //
  // **`DOORWAY` wide, and that is a NAV GRID number rather than a taste one.**
  // `NavGrid.severLinks` cuts every link a wall's box crosses, so an opening
  // survives only where a link between two cell centres passes through it — and
  // cell centres are `cellSize` (1.5 m) apart, so a gap narrower than that can
  // fall entirely between two of them and seal the room with nothing to see.
  // The cottage's 1.6 m door is the shipped example of the smallest that works;
  // this is measured, and 1.3 m read as a door and was a wall.
  b.doorWall(lane, gh, WALL, laneX(0), gy, d / 2, skin, DOORWAY, 2.3);

  // The shopfront: piers, breakable bays between them, and the shop's own door
  // at the +X end. The piers are ordinary `wall`s so the corner of the building
  // is never glass, and a bay is a pane rather than the frontage being one —
  // see the header. Everything ON them — the pilasters, the frames, the fascia
  // and the blind — is `drawShophouse`'s.
  //
  // **The bay count is derived from the width**, so a narrow unit gets one big
  // window and a wide one gets two, and neither ends up with a sheet outside
  // the band a burst of twelve shards can account for — measured, these come
  // out at 7.8 and 11.6 m² against the offices' 11.5 and 12.5 (see
  // `docs/world.md` on panes). It also keeps the pane budget honest: the map
  // grew from twelve breakable sheets to twenty-four, and this is what stops a
  // terrace adding three apiece.
  let cursor = shopX0;
  for (let i = 0; i < bays; i++) {
    b.wall(pier, gh, WALL, cursor + pier / 2, gy, d / 2, skin);
    cursor += pier;
    const x = cursor + bay / 2;
    b.pane(bay, gh, 0.12, x, gy, d / 2, { breakable: true });
    cursor += bay;
  }
  b.wall(pier, gh, WALL, cursor + pier / 2, gy, d / 2, skin);
  cursor += pier;
  {
    // The shop door: a lintel over an opening, the leaf drawn standing open
    // inside it.
    const dx = cursor + DOORWAY / 2;
    b.wall(DOORWAY, gh - 2.3, WALL, dx, g0 + 2.3 + (gh - 2.3) / 2, d / 2, skin);
    cursor += DOORWAY;
  }
  b.wall(pier, gh, WALL, cursor + pier / 2, gy, d / 2, skin);

  // The partition between the close and the shop, stopping short of the back
  // wall: the shop's own back room opens onto the foot of the stair, so the
  // two spaces are connected at the far end from both doors.
  const closeLen = d - 3.4;
  b.wall(0.22, gh, closeLen, -w / 2 + lane, gy, d / 2 - closeLen / 2, PLASTER);

  // The counter and the stock shelving: the shop's cover. 1.05 m is under
  // `CoverMap`'s 1.7 m hard-cover line and reads as low cover to a bot, the
  // shelving above it is over that line and reads as hard.
  b.wall(4.6, 1.05, 0.6, shopX0 + 4.2, g0 + 0.525, d * 0.08, PLANK);
  b.box(4.4, 0.08, 0.7, shopX0 + 4.2, g0 + 1.09, d * 0.08, TEAK);
  b.wall(0.6, 2.0, 4.6, w / 2 - 0.5, g0 + 1.0, -d * 0.12, PLANK);
  for (let i = 1; i < 4; i++) {
    b.box(0.68, 0.06, 4.4, w / 2 - 0.5, g0 + i * 0.5, -d * 0.12, TEAK);
  }

  // --- the flats ------------------------------------------------------------

  // One shell for every storey above the shop rather than a ring per floor:
  // the sashes on the rear and the sides are punched into it and drawn on it,
  // so three boxes carry those elevations whatever the storey count, and the
  // floors inside them are the slabs already emitted. The street elevation is
  // the exception and is cut per storey — see below.
  //
  // The rear's COLLIDER is the whole wall and its drawn mass stops `REVEAL`
  // short of the outer face: the brick in front of that is laid by
  // `drawShophouse` round the windows, so a sash sits at the back of a real
  // reveal rather than painted on the face. A recess is free (`buildTower`'s
  // header): the round stops on the box's own plane, a hand in front of the
  // glass.
  const uy0 = levelY(1) - SLAB;
  const uh = top - SLAB - uy0;
  const ucy = uy0 + uh / 2;
  b.block({ w, h: uh, d: WALL, x: 0, y: ucy, z: -d / 2 });
  b.box(w, uh, WALL - REVEAL, 0, ucy, -d / 2 + REVEAL / 2, skin);
  b.wall(WALL, uh, d, -w / 2, ucy, 0, skin);
  b.wall(WALL, uh, d, w / 2, ucy, 0, skin);

  // The STREET elevation is the exception, and it is a gameplay decision rather
  // than an architectural one: one window per storey is a real OPENING, cut
  // storey by storey instead of being part of the shell.
  //
  // A flat whose windows are all drawn on a solid wall is a room you can hide
  // in and cannot fight from — the round stops on the render 6 cm behind the
  // glass, so a player who has just cleared two floors to get up there finds
  // they cannot shoot at the street they climbed off. One opening per storey
  // fixes that and costs four boxes a floor instead of a share of one.
  //
  // It is a WINDOW and not a french door, which is `buildOffice`'s rule about
  // its window band and matters for the same reason: the spandrel under it
  // stands 0.9 m over the floor, so a body cannot walk out of it and the nav
  // graph is never asked whether a 0.3 m ledge three storeys up is somewhere to
  // be. What it is instead is chest-high cover at a firing position, with the
  // juliet balcony's rail drawn in front of it.
  //
  // The two jambs either side of it carry the drawn sashes, and are the rear
  // wall's case: the whole jamb is the collider, its drawn mass stops `REVEAL`
  // short, and the face is laid round the sash.
  for (let s = 1; s < floors; s++) {
    const y = levelY(s);
    const wy0 = y - SLAB;
    const wy1 = (s + 1 < floors ? levelY(s + 1) : top) - SLAB;
    for (const sx of [-1, 1]) {
      const jx = (sx * (openW + jamb)) / 2;
      b.block({ w: jamb, h: wy1 - wy0, d: WALL, x: jx, y: (wy0 + wy1) / 2, z: d / 2 });
      b.box(jamb, wy1 - wy0, WALL - REVEAL, jx, (wy0 + wy1) / 2, d / 2 - REVEAL / 2, skin);
    }
    b.wall(openW, y + 0.9 - wy0, WALL, 0, (wy0 + y + 0.9) / 2, d / 2, skin);
    if (wy1 > y + 2.5 + 0.05) {
      b.wall(openW, wy1 - (y + 2.5), WALL, 0, (y + 2.5 + wy1) / 2, d / 2, skin);
    }
  }

  // The flats' own partition: one wall across the plate with a doorway in it,
  // which is what makes an upper storey rooms rather than a gallery. Emitted
  // after the shell so a perimeter cell spends its last nav slot on a wall
  // head rather than on the roof — the set's header's first rule.
  //
  // **It stops short of the lane the NEXT flight climbs, and that is the whole
  // of it.** A storey's slab covers the lane the flight LEAVING it stands in —
  // that is what the flight's foot rests on — so a partition run across the
  // full slab stands squarely across the stairs, from the floor to the ceiling,
  // a metre in front of the bottom tread. `severLinks` then cuts every link on
  // the flight and the storey above is drawn, slabbed, stair-served and
  // unreachable, with nothing anywhere saying so. Measured before and after
  // with a route probe from both home spawns: level 2 went from standable-but-
  // unreached to reached, and it is the same failure `buildOffice`'s service
  // core had for the same reason.
  for (let s = 1; s < floors; s++) {
    const ph = STOREY - SLAB;
    const climbs = s + 1 < floors;
    const pw = climbs ? slabW - lane : slabW;
    const px = climbs ? slabX(s) - (laneSide(s) * lane) / 2 : slabX(s);
    b.doorWall(pw, ph, 0.22, px, levelY(s) + ph / 2, -d * 0.08, PLASTER, DOORWAY, 2.1);
  }

  // What is in the rooms: a table in the front one and a bed in the back. Two
  // colliders a storey, and both of them are COVER first — 0.95 m and 0.6 m sit
  // under both of `CoverMap`'s protecting lines (1.3 crouched, 1.7 standing),
  // so what a bot reads is `soft`: something to fight from beside rather than
  // across, which is the only move there is in a room this size. An
  // unfurnished flat is a box with a doorway in it and plays like one.
  //
  // Nothing here is `strut`: a chair a round goes through would be the fence's
  // trick used on a thing that is not mostly air. The chairs themselves are
  // visual, and small enough that walking through one is the cheaper lie.
  for (let s = 1; s < floors; s++) {
    const y = levelY(s);
    const cx = slabX(s);
    b.wall(2.0, 0.78, 1.0, cx, y + 0.39, d * 0.24, PLANK);
    b.box(2.2, 0.09, 1.2, cx, y + 0.82, d * 0.24, TEAK);
    for (const sx of [-1, 1]) {
      b.box(0.5, 0.08, 0.5, cx + sx * 1.5, y + 0.44, d * 0.24, TEAK);
      b.box(0.5, 0.9, 0.09, cx + sx * 1.7, y + 0.45, d * 0.24, TEAK);
      for (const sz of [-1, 1]) {
        b.box(0.07, 0.44, 0.07, cx + sx * 1.5, y + 0.22, d * 0.24 + sz * 0.2, TEAK);
      }
    }
    b.wall(2.0, 0.55, 1.9, cx - 2.4, y + 0.275, -d * 0.3, PLANK);
    b.box(1.9, 0.16, 1.8, cx - 2.4, y + 0.62, -d * 0.3, PLASTER);
    b.box(1.9, 0.7, 0.14, cx - 2.4, y + 0.35, -d * 0.3 - 0.95, TEAK);
  }

  // --- the roof, LAST -------------------------------------------------------
  //
  // Its one collider. The cornice, the parapet, the stack and the tank over it
  // are `drawShophouse`'s.
  b.box(w + 0.4, SLAB, d + 0.4, 0, top - SLAB / 2, 0, ASPHALT);
  b.block({ w: w + 0.4, h: SLAB, d: d + 0.4, x: 0, y: top - SLAB / 2, z: 0 });

  if (p.litWindows) {
    // The shop, the close and the first floor. Three rather than the office's
    // two, and the third one is the CLOSE — which is a 3.4 m passage under a
    // landing with no opening in it but the door at each end, and comes out as
    // the one space on the map with no readable geometry at all. The point
    // lights here are unshadowed, so the shop's own lamp does reach it through
    // the partition; it is 7 m away by then and the corridor is still black.
    //
    // Every fixture spends one of the sixteen shader slots, so this is not
    // free and `litWindows` is deliberately set on half the terrace — see the
    // set's header on the budget these share with the eight lit lamp columns.
    b.light(WINDOW_LIGHT, 14, 0.65, 0.02, lane / 2, g0 + 2.2, d * 0.2);
    // Hung at the FRONT of the close, under the landing rather than under the
    // flight: for most of its length this passage has a staircase for a
    // ceiling, so a lamp at head height in the middle of it is a lamp above
    // the treads lighting the underside of nothing. Here it lights the street
    // door, the head of the stair and the far end of the shop through the
    // partition's opening, and leaves the run under the stair dark, which is
    // what a passage under a stair is.
    b.light(WINDOW_LIGHT, 11, 0.55, 0.02, laneX(0), g0 + 2.2, d * 0.34);
    b.light(WINDOW_LIGHT, 13, 0.6, 0.02, slabX(1), levelY(1) + 1.9, d * 0.2);
  }
  return b;
}

/**
 * How far a drawn sash is set back into the brick: about a brick's width,
 * which is what a reveal is. The rear wall and the street jambs stop their
 * drawn mass this far short of their colliders' faces and the face is laid
 * back over it round the windows.
 */
const REVEAL = 0.12;

/** Everything `drawShophouse` reads off `buildShophouse`'s plan. */
interface ShophousePlan {
  w: number;
  d: number;
  floors: number;
  top: number;
  lane: number;
  laneX: (s: number) => number;
  laneSide: (s: number) => -1 | 1;
  slabX: (s: number) => number;
  slabW: number;
  brick: boolean;
  skin: string;
  blind: string;
  shopX0: number;
  shopW: number;
  pier: number;
  bays: number;
  bay: number;
  openW: number;
  jamb: number;
  sign?: string;
  litWindows?: boolean;
}

/**
 * The shophouse as what it is: a late-Victorian shop with two or three
 * storeys of flats over it, standing in a terrace.
 *
 * ## What it read as, and what it is drawn as now
 *
 * It read as a brick box with two balconied holes in it and a blind over a
 * dark shopfront: the sashes were drawn INSIDE the wall (the pane centred on
 * the wall's own centre line rather than its face), so nothing of them showed
 * but a sill and a head; the downpipes were buried in the party walls the
 * same way; and the shopfront was a row of grey frames under a grey band.
 *
 * - **The shopfront** is painted joinery in the shop's own colour, `tint`,
 *   which until now only reached the blind: pilasters cased over the piers,
 *   the two at the ends carrying CONSOLE brackets that hold up the fascia and
 *   its cornice, a stallriser under each bay, the bay frames with a transom
 *   and a row of toplights over it, and the shop door glazed and standing open
 *   under a fanlight. The fascia is a dark board with the shop's name lettered
 *   on it, and the blind is a roller box under the fascia with the cloth
 *   either run out on its arms or rolled away — the roll is seeded, so a
 *   terrace does not wear one blind position.
 * - **The close door** is the house's door rather than the shop's: a door case
 *   of pilaster strips and a hood, a fan over it, a panelled leaf standing open
 *   and a bell plate. Both doors stand on a stone step at the street.
 * - **The sashes** are two-over-two box sashes at the back of a reveal: the
 *   glass on the drawn mass, a painted frame round it, two sashes on two
 *   planes with a meeting rail and a glazing bar each, and a blind or a pair
 *   of curtains behind some of them. On brick they sit on a stone sill under a
 *   stone lintel with a keystone; on render, in an architrave under a hood on
 *   two consoles. Some are lit, more where the placement is.
 * - **The street's real window** is a pair of glazed casements under a
 *   fanlight, the leaves folded back against the room's own wall so the
 *   opening stays a firing position, behind a cast-iron balcony on two stone
 *   brackets.
 * - **The face**: a band at the first floor and a sill band at every storey on
 *   brick; brick pilasters at the corners of a brick front and long-and-short
 *   quoins at a rendered one; dentils under the cornice on brick, two
 *   mouldings on render; a plinth course; tie plates on the party walls at
 *   every floor; the outer corners FILLED, which the shell never closed (four
 *   walls meeting at their centre lines leave a 0.2 m notch at each corner).
 * - **The roof**: the parapet coped; over a brick front, seeded, a raised
 *   panel in the parapet with a stone tablet; the stack with oversailing
 *   courses under its cap and two or three pots; a roof hatch, a vent and the
 *   tank.
 * - **The rear**: the yard door framed and standing open on a step, a barred
 *   window to the shop's back room, the soil stack and two downpipes with
 *   their hoppers and brackets — the rainwater goods moved here from the
 *   party walls they had been buried in.
 * - **Inside**, only what is seen through the glass and in the rooms: a
 *   handrail and a wall string up every flight, architraves round the flats'
 *   doorways, a pendant lamp in each front room and two in the shop, goods
 *   on the shop's shelves and on a shelf along its back wall, and a till on
 *   the counter.
 *
 * ## The rules the drawing keeps
 *
 * **No collider moved.** The rear wall and the street jambs keep their
 * colliders exactly and give up `REVEAL` of their DRAWN mass, which is the
 * recess the windows sit in; everything else here is on a face (trim within
 * the kit's budget of a few centimetres), low enough to walk over (the steps,
 * the plinths, the stallrisers), or over every head (the blind's valance
 * clears the pavement by 2.4 m, the lamps hang 2.4 m over their floors).
 * Nothing new may stand on the breakable panes' line: what is drawn across a
 * bay — the frame, the transom and the toplight bars — is at or over 2.4 m or
 * at its edges, so a shot-out bay is an empty frame a body walks through, as
 * before. **Nothing stands on a party wall** further out than a tie plate.
 *
 * **One new colour, CASEMENT**, the kit's own glass for a window with nobody
 * behind it, and IRON for the balconies, the sign's bracket and the tie
 * plates; both are already drawn in every block the town's houses and its
 * brick towers stand in. Everything else is a colour the shophouse already
 * wore — the shop's tint on its joinery is the reason the tint exists.
 *
 * Batched through `StoneBatch` (lenses through `flushGlow`), and seeded off
 * the footprint, the storey count, the tint and the sign, because nothing else
 * separates the terrace's units — a layout repeats the same width and depth.
 */
function drawShophouse(b: Build, t: ShophousePlan): void {
  const { w, d, floors, top, lane, laneX, laneSide, slabX, brick, skin, blind } = t;
  const { shopX0, shopW, pier, bays, bay, openW, jamb } = t;
  const sb = new StoneBatch();
  const lens = new StoneBatch();
  let salt = 7;
  for (const c of `${blind}${t.sign ?? ""}`) salt = (Math.imul(salt, 31) + c.charCodeAt(0)) >>> 0;
  const rnd = mulberry32((streetSeed(w, d, floors) ^ salt) >>> 0);
  const lit = t.litWindows === true;
  const R = REVEAL;
  const g0 = GROUND;
  /** The outer face planes: the street and the rear, and the two flanks. */
  const PZ = d / 2 + WALL / 2;
  const PX = w / 2 + WALL / 2;
  const planeOf = (s: Side): number => (runsAlongX(s) ? PZ : PX);
  /** A box laid on face `s`, its centre `out` past the face plane. */
  const lay = (
    s: Side,
    u: number,
    y: number,
    along: number,
    tall: number,
    thick: number,
    out: number,
    color: string,
    hide = hideBack(s),
  ): void => sb.onFace(s, planeOf(s), u, y, along, tall, thick, out, color, 0, 0, hide);
  /** Stone on brick; on render the dressings are the render, standing proud. */
  const dress = brick ? RENDER : skin;
  /** Painted timber: the sashes, the casements, the fan bars. */
  const paint = ROAD_PAINT;
  const post = (s: Side): number => hideBack(s) | HIDE_TOP | HIDE_UNDER;
  const rail = (s: Side): number => hideBack(s) | hideEnds(s);

  /**
   * The outer `REVEAL` of a face over `[u0, u1] x [y0, y1]`, laid in bands
   * round the holes. Where the drawn mass behind stops short, this is what
   * stands in front of it, and what is left in a hole is the reveal.
   */
  const skinFace = (s: Side, u0: number, u1: number, y0: number, y1: number, holes: readonly Hole[]): void => {
    const ys = [y0, y1];
    for (const o of holes) ys.push(o.y0, o.y1);
    const cuts = [...new Set(ys.filter((v) => v >= y0 && v <= y1))].sort((a, z) => a - z);
    for (let i = 0; i + 1 < cuts.length; i++) {
      const a = cuts[i];
      const z = cuts[i + 1];
      if (z - a < 0.005) continue;
      const hit = holes.filter((o) => o.y0 < z - 1e-4 && o.y1 > a + 1e-4);
      for (const [q0, q1] of carve(u0, u1, hit.map((o): [number, number] => [o.u0, o.u1]))) {
        if (q1 - q0 > 0.005) lay(s, (q0 + q1) / 2, (a + z) / 2, q1 - q0, z - a, R, -R / 2, skin);
      }
    }
  };

  /**
   * What frames an opening `ww` wide from `y0` to `y1`: on brick a stone sill,
   * and a flat stone lintel with a keystone; on render an architrave and a
   * hood on two consoles over a plain frieze. `sill` is false where a balcony
   * stands in for one.
   */
  const dressing = (s: Side, u: number, y0: number, y1: number, ww: number, sill: boolean): void => {
    const hb = hideBack(s);
    if (sill) lay(s, u, y0 - 0.045, ww + 0.24, 0.12, R + 0.07, (0.07 - R) / 2, dress, hb);
    if (brick) {
      lay(s, u, y1 + 0.12, ww + 0.32, 0.24, 0.03, 0.015, dress, hb);
      lay(s, u, y1 + 0.14, 0.2, 0.3, 0.06, 0.03, dress, hb);
      return;
    }
    for (const e of [-1, 1]) lay(s, u + e * (ww / 2 + 0.05), (y0 + y1) / 2, 0.1, y1 - y0, 0.035, 0.0175, dress, post(s));
    lay(s, u, y1 + 0.05, ww + 0.2, 0.1, 0.035, 0.0175, dress, hb);
    lay(s, u, y1 + 0.2, ww + 0.2, 0.2, 0.02, 0.01, dress, hb);
    lay(s, u, y1 + 0.36, ww + 0.5, 0.12, 0.16, 0.08, dress, hb);
    for (const e of [-1, 1]) lay(s, u + e * (ww / 2 + 0.16), y1 + 0.18, 0.09, 0.24, 0.11, 0.055, dress, hb);
  };

  /**
   * A two-over-two box sash at the back of its reveal, and its dressing.
   * Returns the hole `skinFace` lays the face round.
   */
  const sash = (s: Side, u: number, y0: number, ww: number, wh: number): Hole => {
    const y1 = y0 + wh;
    const ym = (y0 + y1) / 2;
    const F = 0.07;
    const iw = ww - 2 * F;
    // The glass, on the drawn mass at the back of the reveal.
    lay(s, u, ym, ww, wh, 0.02, -R + 0.01, CASEMENT);
    // What hangs behind it: a blind part-drawn, a pair of curtains, or
    // nothing — and in some rooms the light is on.
    const k = rnd();
    let drop = 0;
    if (k < 0.3) {
      drop = 0.2 + rnd() * 0.4;
      const bh = (wh - 2 * F) * drop;
      lay(s, u, y1 - F - bh / 2, iw, bh, 0.01, -R + 0.036, PLASTER);
    } else if (k < 0.6) {
      for (const e of [-1, 1]) lay(s, u + e * (iw / 2 - 0.1), ym, 0.2, wh - 2 * F, 0.01, -R + 0.036, PLASTER);
    }
    if (rnd() < (lit ? 0.55 : 0.22)) {
      const lh = (wh - 2 * F) * (1 - drop);
      lens.onFace(s, planeOf(s), u, y0 + F + lh / 2, iw, lh, 0.01, -R + 0.025, ROOM_GLOW);
    }
    // The box frame, bedded in the reveal.
    for (const e of [-1, 1]) lay(s, u + e * (ww / 2 - F / 2), ym, F, wh, 0.08, -R + 0.06, paint, post(s));
    for (const e of [-1, 1]) lay(s, u, ym + e * (wh / 2 - F / 2), iw, F, 0.08, -R + 0.06, paint, rail(s));
    // Two sashes on two planes, the lower one in front of the upper: the step
    // between them is what the ink finds.
    const S = 0.045;
    const yb = y0 + F;
    const yt = y1 - F;
    for (const lower of [false, true]) {
      const out = lower ? -R + 0.0825 : -R + 0.0575;
      const a = lower ? yb : ym;
      const z = lower ? ym : yt;
      for (const e of [-1, 1]) lay(s, u + e * (iw / 2 - S / 2), (a + z) / 2, S, z - a, 0.025, out, paint, post(s));
      const r0 = lower ? 0.09 : 0.05;
      const r1 = 0.05;
      lay(s, u, a + r0 / 2, iw - 2 * S, r0, 0.025, out, paint, rail(s));
      lay(s, u, z - r1 / 2, iw - 2 * S, r1, 0.025, out, paint, rail(s));
      lay(s, u, (a + r0 + z - r1) / 2, 0.03, z - r1 - a - r0, 0.02, out, paint, post(s));
    }
    dressing(s, u, y0, y1, ww, true);
    return { u0: u - ww / 2, u1: u + ww / 2, y0, y1 };
  };

  // === the street elevation, upstairs =======================================

  const frontSashW = Math.min(1.15, jamb - 0.7);
  for (let s = 1; s < floors; s++) {
    const y = levelY(s);
    const wy0 = y - SLAB;
    const wy1 = (s + 1 < floors ? levelY(s + 1) : top) - SLAB;
    for (const sx of [-1, 1]) {
      const hole = sash("+z", sx * (openW / 2 + jamb / 2), y + 0.9, frontSashW, 1.6);
      skinFace("+z", sx > 0 ? openW / 2 : -w / 2, sx > 0 ? w / 2 : -openW / 2, wy0, wy1, [hole]);
    }

    // The real window: a pair of casements and a fanlight, the frame set back
    // in the opening and the leaves folded flat against the room's own wall —
    // open, because it is open, and clear of the opening a body fires from.
    const fz = PZ - 0.18;
    for (const sx of [-1, 1]) {
      sb.box(0.07, 1.6, 0.08, sx * (openW / 2 - 0.035), y + 1.7, fz, paint, undefined, HIDE_TOP | HIDE_UNDER);
    }
    sb.box(openW - 0.14, 0.07, 0.08, 0, y + 2.15, fz, paint, undefined, 1 | 2);
    sb.box(openW - 0.14, 0.07, 0.08, 0, y + 2.465, fz, paint, undefined, 1 | 2);
    sb.box(openW - 0.14, 0.25, 0.02, 0, y + 2.31, fz - 0.03, CASEMENT, undefined, 1 | 2);
    for (let i = 1; i < 3; i++) {
      sb.box(0.03, 0.25, 0.03, -openW / 2 + 0.07 + (i * (openW - 0.14)) / 3, y + 2.31, fz, paint, undefined, HIDE_TOP | HIDE_UNDER);
    }
    sb.box(openW, 0.03, WALL + 0.02, 0, y + 0.915, d / 2, TEAK, undefined, HIDE_UNDER);
    {
      // The inner face of the street wall faces -Z; a leaf is laid on it.
      const zi = d / 2 - WALL / 2;
      const hb = 1 << 4;
      for (const sx of [-1, 1]) {
        const lx = sx * (openW / 2 + 0.46);
        const ly = y + 1.53;
        sb.box(0.8, 1.1, 0.02, lx, ly, zi - 0.03, CASEMENT, undefined, hb);
        for (const e of [-1, 1]) {
          sb.box(0.06, 1.18, 0.05, lx + e * 0.43, ly, zi - 0.03, paint, undefined, hb);
          sb.box(0.8, 0.06, 0.05, lx, ly + e * 0.56, zi - 0.03, paint, undefined, hb);
        }
        sb.box(0.8, 0.04, 0.04, lx, ly, zi - 0.04, paint, undefined, hb);
      }
    }
    dressing("+z", 0, y + 0.9, y + 2.5, openW, false);

    // The balcony: a stone slab on two brackets and a cast-iron front, its
    // rail returned to the wall at both ends. Still a silhouette and not a
    // surface — the spandrel is what stops a body.
    {
      const by = y + 0.78;
      const rz = PZ + 0.34;
      const rw = openW + 0.2;
      sb.box(openW + 0.36, 0.12, 0.42, 0, by, PZ + 0.19, dress);
      for (const sx of [-1, 1]) {
        sb.box(0.12, 0.16, 0.34, sx * (openW / 2 + 0.06), by - 0.14, PZ + 0.15, dress, undefined, HIDE_TOP);
        sb.box(0.1, 0.16, 0.18, sx * (openW / 2 + 0.06), by - 0.3, PZ + 0.07, dress, undefined, HIDE_TOP);
      }
      sb.box(rw + 0.04, 0.05, 0.06, 0, y + 1.82, rz, IRON);
      sb.box(rw, 0.035, 0.035, 0, y + 1.66, rz, IRON, undefined, 1 | 2);
      sb.box(rw, 0.035, 0.035, 0, y + 0.88, rz, IRON, undefined, 1 | 2);
      const n = Math.round(rw / 0.11);
      for (let i = 0; i <= n; i++) {
        sb.box(0.022, 0.94, 0.022, -rw / 2 + (i * rw) / n, y + 1.33, rz, IRON, undefined, HIDE_TOP | HIDE_UNDER);
        if (i < n && i % 2 === 0) {
          sb.box(0.06, 0.06, 0.016, -rw / 2 + ((i + 0.5) * rw) / n, y + 1.74, rz, IRON, { z: Math.PI / 4 });
        }
      }
      for (const sx of [-1, 1]) {
        sb.box(0.035, 0.05, 0.34, (sx * rw) / 2, y + 1.82, PZ + 0.17, IRON, undefined, 16 | 32);
        for (const z of [PZ + 0.12, PZ + 0.24]) {
          sb.box(0.022, 0.94, 0.022, (sx * rw) / 2, y + 1.33, z, IRON, undefined, HIDE_TOP | HIDE_UNDER);
        }
      }
    }
  }

  // === the rear: sashes, and the yard door under them =======================

  {
    const holes: Hole[] = [];
    for (let s = 1; s < floors; s++) {
      for (const i of [0, 1]) holes.push(sash("-z", -w / 2 + ((i + 0.5) / 2) * w, levelY(s) + 0.9, 0.95, 1.6));
    }
    skinFace("-z", -w / 2, w / 2, levelY(1) - SLAB, top - SLAB, holes);

    // The yard door: a frame, a ledged and braced leaf standing open inside
    // against the reveal, a step.
    const hb = hideBack("-z");
    for (const e of [-1, 1]) lay("-z", e * (DOORWAY / 2 + 0.06), g0 + 1.18, 0.12, 2.36, 0.05, 0.025, dress, post("-z"));
    lay("-z", 0, g0 + 2.36, DOORWAY + 0.24, 0.14, 0.06, 0.03, dress, hb);
    lay("-z", 0, 0.1, DOORWAY + 0.4, 0.2, 0.42, 0.01, DARK_CONCRETE, hb);
    {
      const lx = DOORWAY / 2 - 0.05;
      const lz = -d / 2 + WALL / 2 + 0.45;
      sb.box(0.05, 2.2, 0.86, lx, g0 + 1.1, lz, PLANK);
      for (const ly of [0.35, 1.1, 1.85]) sb.box(0.09, 0.14, 0.82, lx, g0 + ly, lz, PLANK, undefined, 16 | 32);
      for (const k of [0, 1]) {
        sb.box(0.08, 0.92, 0.1, lx, g0 + 0.725 + k * 0.75, lz, PLANK, { x: 0.85 });
      }
    }
    // A barred window to the back of the close, on the wall beside the door
    // away from the soil stack: drawn on the solid wall, so no reveal.
    const side = (w - DOORWAY) / 2;
    if (side > 2.2) {
      const u = -(DOORWAY / 2 + side / 2);
      const y0 = g0 + 1.2;
      const ww = 0.9;
      const wh = 1.0;
      lay("-z", u, y0 + wh / 2, ww, wh, 0.02, 0.01, CASEMENT, hb);
      for (const e of [-1, 1]) lay("-z", u + e * (ww / 2 + 0.03), y0 + wh / 2, 0.06, wh + 0.12, 0.05, 0.025, paint, post("-z"));
      lay("-z", u, y0 - 0.06, ww + 0.24, 0.12, 0.12, 0.06, dress, hb);
      lay("-z", u, y0 + wh + 0.1, ww + 0.24, 0.2, 0.04, 0.02, dress, hb);
      for (let i = 0; i < 5; i++) lay("-z", u - ww / 2 + ((i + 0.5) * ww) / 5, y0 + wh / 2, 0.025, wh, 0.025, 0.07, IRON, post("-z"));
      lay("-z", u, y0 + wh - 0.05, ww, 0.03, 0.025, 0.07, IRON, rail("-z"));
      lay("-z", u, y0 + 0.05, ww, 0.03, 0.025, 0.07, IRON, rail("-z"));
    }
    // A plinth course along the back, round the door.
    for (const [a, z] of carve(-PX, PX, [[-DOORWAY / 2 - 0.12, DOORWAY / 2 + 0.12]])) {
      lay("-z", (a + z) / 2, 0.24, z - a, 0.48, 0.03, 0.015, DARK_CONCRETE, hb);
    }
    // The rainwater goods and the soil stack, which the shell's corners had
    // been swallowing: two downpipes off hoppers under the cornice, and the
    // stack off the yard's drain.
    const zp = -(PZ + 0.09);
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - 0.75);
      b.cyl(top - 1.1, 0.13, 0.13, 6, x, (top - 1.1) / 2, zp, DARK_CONCRETE);
      lay("-z", x, top - 0.98, 0.3, 0.26, 0.26, 0.13, DARK_CONCRETE, hb);
      lay("-z", x, 0.06, 0.24, 0.12, 0.2, 0.1, DARK_CONCRETE, hb);
      for (let y = 1.2; y < top - 1.4; y += 1.8) lay("-z", x, y, 0.2, 0.05, 0.1, 0.05, DARK_CONCRETE, hb);
    }
    const xs = w / 4 + 0.95;
    b.cyl(top - 1.2, 0.17, 0.17, 6, xs, (top - 1.2) / 2, -(PZ + 0.11), DARK_CONCRETE);
    for (let y = 1.0; y < top - 1.4; y += 1.8) lay("-z", xs, y, 0.24, 0.06, 0.12, 0.06, DARK_CONCRETE, hb);
  }

  // === the shopfront ==========================================================
  //
  // Painted timber in the shop's own colour over the brick piers, which is
  // what a shopfront is: the piers and the panes are the builder's, and none of
  // this stands across a bay below 2.4 m except at its edges, so a bay that
  // has been shot out is still a frame a body walks through.
  {
    const s: Side = "+z";
    const hb = hideBack(s);
    const paintShop = blind;
    /** The fascia's foot, which everything on the front stops under. */
    const fasc0 = 2.92;
    const cx = shopX0 + shopW / 2;
    const pierX: number[] = [];
    const bayX: number[] = [];
    let cursor = shopX0;
    for (let i = 0; i < bays; i++) {
      pierX.push(cursor + pier / 2);
      cursor += pier;
      bayX.push(cursor + bay / 2);
      cursor += bay;
    }
    pierX.push(cursor + pier / 2);
    cursor += pier;
    const doorX = cursor + DOORWAY / 2;
    cursor += DOORWAY;
    pierX.push(cursor + pier / 2);

    // The pilasters: cased over every pier, with a panel down each and a base
    // block standing to the pavement. The two at the ends are wider and carry
    // the CONSOLES the fascia hangs between.
    pierX.forEach((x, i) => {
      const end = i === 0 || i === pierX.length - 1;
      const cw = end ? 0.56 : 0.46;
      lay(s, x, (g0 + fasc0) / 2, cw, fasc0 - g0, 0.07, 0.035, paintShop, hb | HIDE_UNDER);
      lay(s, x, (g0 + 0.65 + fasc0 - 0.3) / 2, cw - 0.18, fasc0 - 0.3 - g0 - 0.65, 0.02, 0.08, paintShop, hb);
      lay(s, x, 0.26, cw + 0.08, 0.52, 0.31, -0.045, paintShop, hb);
      if (end) {
        lay(s, x, 3.36, 0.42, 0.3, 0.3, 0.15, paintShop, hb);
        lay(s, x, 3.06, 0.36, 0.3, 0.22, 0.11, paintShop, hb);
        lay(s, x, 2.82, 0.3, 0.18, 0.13, 0.065, paintShop, hb);
        lay(s, x, 2.67, 0.16, 0.12, 0.09, 0.045, paintShop, hb);
      } else {
        lay(s, x, fasc0 - 0.06, cw + 0.08, 0.12, 0.11, 0.055, paintShop, hb);
      }
    });

    // The bays: a frame in front of the glass, a stallriser on a granite
    // plinth, the transom and the toplights over it.
    for (const bx of bayX) {
      const fz = -0.09;
      for (const e of [-1, 1]) lay(s, bx + e * (bay / 2 - 0.05), (g0 + fasc0) / 2, 0.1, fasc0 - g0, 0.1, fz, paintShop, post(s));
      lay(s, bx, fasc0 - 0.04, bay - 0.2, 0.08, 0.1, fz, paintShop, rail(s));
      lay(s, bx, g0 + 2.4, bay - 0.2, 0.08, 0.12, fz + 0.01, paintShop, rail(s));
      const tl = Math.max(2, Math.round((bay - 0.2) / 0.42));
      for (let i = 1; i < tl; i++) {
        lay(s, bx - (bay - 0.2) / 2 + (i * (bay - 0.2)) / tl, (g0 + 2.44 + fasc0 - 0.08) / 2, 0.03, fasc0 - 0.08 - g0 - 2.44, 0.04, -0.12, paintShop, post(s));
      }
      lay(s, bx, g0 + 0.13, bay, 0.26, 0.12, -0.08, paintShop, hb);
      lay(s, bx, g0 + 0.285, bay, 0.05, 0.17, -0.065, paintShop, rail(s));
      const pn = Math.max(1, Math.round(bay / 1.4));
      for (let i = 0; i < pn; i++) {
        lay(s, bx - bay / 2 + ((i + 0.5) * bay) / pn, g0 + 0.13, bay / pn - 0.16, 0.14, 0.02, -0.01, paintShop, hb);
      }
      lay(s, bx, 0.1, bay + 0.02, 0.2, 0.2, -0.1, DARK_CONCRETE, hb);
    }

    // The fascia, lettered, and its cornice; the blind's box under it.
    lay(s, cx, (fasc0 + 3.46) / 2, shopW - 0.2, 3.46 - fasc0, 0.12, 0.06, DARK_CONCRETE, hb);
    lay(s, cx, 3.49, shopW - 0.1, 0.06, 0.16, 0.08, paintShop, hb);
    lay(s, cx, 3.58, shopW + 0.7, 0.12, 0.42, 0.21, paintShop, hb);
    lay(s, cx, 3.655, shopW + 0.7, 0.03, 0.42, 0.21, DARK_CONCRETE, hb | HIDE_UNDER);
    {
      // The shop's name: words of strokes, each letter a stem, a bar and
      // sometimes a second stem, which is what reads as lettering from across
      // a street. Centred on the board.
      const lh = 0.28;
      const lp = 0.22;
      const stroke = 0.045;
      const span = shopW - 1.8;
      const word: number[] = [];
      let used = 0;
      while (word.length < 3) {
        const n = 3 + Math.floor(rnd() * 5);
        const add = n * lp + (word.length ? lp : 0);
        if (used + add > span) break;
        word.push(n);
        used += add;
      }
      // Laid as the street reads them: from the face's own right, which on
      // +Z is -X.
      const at = (v: number): number => 2 * cx - v;
      let u = cx - used / 2;
      const ly = (fasc0 + 3.46) / 2;
      for (const [k, n] of word.entries()) {
        if (k) u += lp;
        for (let i = 0; i < n; i++) {
          lay(s, at(u + stroke / 2), ly, stroke, lh, 0.02, 0.13, ROAD_PAINT, hb);
          const r = rnd();
          const by = r < 0.33 ? ly + lh / 2 - stroke / 2 : r < 0.66 ? ly : ly - lh / 2 + stroke / 2;
          lay(s, at(u + lp * 0.3), by, lp * 0.5, stroke, 0.02, 0.13, ROAD_PAINT, hb);
          if (rnd() < 0.55) lay(s, at(u + lp * 0.6), ly, stroke, lh, 0.02, 0.13, ROAD_PAINT, hb);
          u += lp;
        }
      }
    }
    {
      // The blind: run out on its arms over the pavement, or rolled into the
      // box. Its valance clears the pavement by 2.4 m.
      const bw = shopW - 1.0;
      lay(s, cx, fasc0 - 0.07, bw + 0.1, 0.14, 0.18, 0.09, DARK_CONCRETE, hb);
      if (rnd() < 0.7) {
        const L = 1.6;
        const th = 0.14;
        const z0 = PZ + 0.16;
        const y0 = fasc0 - 0.06;
        const zc = z0 + (L / 2) * Math.cos(th);
        const yc = y0 - (L / 2) * Math.sin(th);
        const zf = z0 + L * Math.cos(th);
        const yf = y0 - L * Math.sin(th);
        sb.box(bw, 0.03, L, cx, yc, zc, blind, { x: th });
        sb.box(bw, 0.2, 0.03, cx, yf - 0.1, zf, blind);
        sb.box(bw, 0.04, 0.04, cx, yf - 0.01, zf - 0.03, ALLOY, undefined, 1 | 2);
        for (const e of [-1, 1]) {
          sb.box(0.035, 0.035, L, cx + e * (bw / 2 - 0.1), yc - 0.05, zc, ALLOY, { x: th }, 16 | 32);
        }
      }
    }

    // The shop door: a frame in the opening, a fanlight over the transom,
    // the leaf glazed and standing open inside against the reveal, a step and
    // a tiled threshold.
    for (const e of [-1, 1]) sb.box(0.06, 2.3, 0.14, doorX + e * (DOORWAY / 2 - 0.03), g0 + 1.15, PZ - 0.09, paintShop);
    lay(s, doorX, g0 + 2.34, DOORWAY, 0.08, 0.12, -0.04, paintShop, rail(s));
    lay(s, doorX, (g0 + 2.38 + fasc0 - 0.14) / 2, DOORWAY - 0.12, fasc0 - 0.14 - g0 - 2.38, 0.02, 0.01, CASEMENT, hb);
    for (let i = 1; i < 4; i++) {
      lay(s, doorX - DOORWAY / 2 + (i * DOORWAY) / 4, (g0 + 2.38 + fasc0 - 0.14) / 2, 0.03, fasc0 - 0.14 - g0 - 2.38, 0.03, 0.025, paintShop, post(s));
    }
    {
      const lx = doorX + DOORWAY / 2 - 0.16;
      const lz = d / 2 - 0.9;
      sb.box(0.06, 2.2, 1.3, lx, g0 + 1.1, lz, paintShop);
      sb.box(0.08, 1.1, 1.0, lx, g0 + 1.45, lz, CASEMENT);
      sb.box(0.08, 0.2, 1.0, lx, g0 + 0.25, lz, ALLOY);
    }
    sb.box(DOORWAY + 0.2, 0.1, 0.5, doorX, g0 + 0.05, d / 2 - 0.1, DARK_CONCRETE);
    lay(s, doorX, 0.1, DOORWAY + 0.2, 0.2, 0.45, -0.025, DARK_CONCRETE, hb);
    sb.box(DOORWAY - 0.3, 0.012, 0.26, doorX, 0.206, PZ + 0.06, CONCRETE, undefined, HIDE_UNDER);

    // The bracket sign, over the cornice where it clears the blind, and over
    // the shop's door between the corner and the nearest sash — the one stretch
    // of brick every width of front leaves clear: an iron arm and a stay, and
    // the board on two hooks. It is lit from both faces where `sign` is set —
    // a projecting sign is read along the street, from either end.
    {
      const x = w / 2 - 0.7;
      const sy = 4.05;
      sb.box(0.1, 0.42, 0.04, x, sy + 0.61, PZ + 0.02, IRON);
      sb.box(0.04, 0.04, 1.0, x, sy + 0.42, PZ + 0.5, IRON);
      sb.box(0.03, 0.03, 0.67, x, sy + 0.61, PZ + 0.275, IRON, { x: 0.6 });
      for (const z of [PZ + 0.35, PZ + 0.85]) sb.box(0.02, 0.07, 0.02, x, sy + 0.37, z, IRON);
      sb.box(0.08, 0.66, 0.66, x, sy, PZ + 0.6, blind);
      sb.box(0.1, 0.04, 0.7, x, sy + 0.35, PZ + 0.6, IRON);
      if (t.sign) {
        for (const e of [-1, 1]) lens.box(0.02, 0.54, 0.54, x + e * 0.05, sy, PZ + 0.6, t.sign);
      }
    }
  }

  // === the close door ===========================================================
  //
  // The house's door rather than the shop's, and dressed as one: pilaster
  // strips and a hood, a fan over it, a panelled leaf standing open.
  {
    const s: Side = "+z";
    const hb = hideBack(s);
    const x = laneX(0);
    for (const e of [-1, 1]) {
      lay(s, x + e * (DOORWAY / 2 + 0.12), g0 + 1.2, 0.22, 2.4, 0.05, 0.025, dress, post(s));
      lay(s, x + e * (DOORWAY / 2 + 0.12), 0.1, 0.3, 0.2, 0.09, 0.045, dress, hb);
    }
    lay(s, x, 2.97, DOORWAY + 0.56, 0.14, 0.06, 0.03, dress, hb);
    lay(s, x, 3.1, DOORWAY + 0.8, 0.12, 0.22, 0.11, dress, hb);
    {
      // The fan: a light over the door with its bars spread from a hub.
      const fy0 = g0 + 2.32;
      const fh = 2.9 - fy0;
      lay(s, x, fy0 + fh / 2, DOORWAY - 0.1, fh, 0.02, 0.01, CASEMENT, hb);
      lay(s, x, fy0 + 0.03, DOORWAY - 0.1, 0.06, 0.04, 0.02, paint, rail(s));
      lay(s, x, fy0 + 0.06, 0.24, 0.12, 0.04, 0.03, paint, hb);
      for (const a of [-1.2, -0.6, 0, 0.6, 1.2]) {
        const r = Math.min(fh - 0.08, 0.5) / 2;
        sb.onFace(s, PZ, x + Math.sin(a) * r, fy0 + 0.06 + Math.cos(a) * r, 0.025, 2 * r, 0.02, 0.03, paint, -a, 0, hb);
      }
    }
    // The leaf, open inside against the reveal it hangs on.
    {
      const lx = x - DOORWAY / 2 + 0.05;
      const lz = d / 2 - WALL / 2 - 0.44;
      sb.box(0.05, 2.2, 0.86, lx, g0 + 1.1, lz, TEAK);
      for (const ly of [0.6, 1.62]) {
        for (const e of [-1, 1]) sb.box(0.07, ly < 1 ? 0.7 : 0.9, 0.28, lx, g0 + ly, lz + e * 0.19, TEAK);
      }
      sb.box(0.09, 0.05, 0.05, lx, g0 + 1.05, lz + 0.35, ALLOY);
    }
    // The bell plate, and the step.
    lay(s, x + DOORWAY / 2 + 0.42, 1.45, 0.16, 0.34, 0.02, 0.01, ALLOY, hb);
    lay(s, x, 0.1, DOORWAY, 0.2, 0.45, -0.025, DARK_CONCRETE, hb);
  }

  // === the face =================================================================

  for (const s of ["+z", "-z"] as const) {
    const hb = hideBack(s);
    // A band at the first floor over the shop's cornice and the close's hood,
    // and on brick a sill band at every storey.
    lay(s, 0, 3.76, 2 * PX, 0.16, 0.05, 0.025, dress, hb);
    if (brick) {
      for (let k = 1; k < floors; k++) lay(s, 0, levelY(k) + 0.82, 2 * PX, 0.12, 0.04, 0.02, dress, hb);
    }
    // The corners: brick pilasters up a brick front, quoins up a render one.
    for (const sx of [-1, 1]) {
      if (brick) {
        lay(s, sx * (PX - 0.25), (3.84 + top - 0.92) / 2, 0.5, top - 0.92 - 3.84, 0.06, 0.03, skin, hb);
        continue;
      }
      let k = 0;
      for (let y = 3.84 + 0.15; y < top - 1.0; y += 0.34) {
        const long = k++ % 2 === 0;
        const qw = long ? 0.5 : 0.32;
        lay(s, sx * (PX - qw / 2), y, qw, 0.3, 0.035, 0.0175, skin, hb);
        const side: Side = sx > 0 ? "+x" : "-x";
        const qd = long ? 0.32 : 0.5;
        lay(side, (s === "+z" ? 1 : -1) * (PZ - qd / 2), y, qd, 0.3, 0.035, 0.0175, skin, hideBack(side));
      }
    }
    // Under the cornice: dentils on brick, two mouldings on render.
    if (brick) {
      const n = Math.round((2 * PX) / 0.36);
      for (let i = 0; i < n; i++) {
        lay(s, -PX + ((i + 0.5) * 2 * PX) / n, top - 0.86, 0.15, 0.12, 0.1, 0.05, skin, hb | HIDE_TOP);
      }
    } else {
      lay(s, 0, top - 0.86, 2 * PX + 0.1, 0.12, 0.09, 0.045, skin, hb);
      lay(s, 0, top - 0.98, 2 * PX, 0.12, 0.045, 0.0225, skin, hb);
    }
  }
  for (const s of ["-x", "+x"] as const) {
    const hb = hideBack(s);
    // A plinth course, and the tie plates at every floor: the ends of the rods
    // that hold the floors to the party walls. Nothing on a party wall stands
    // further out than these, because a terrace stands its neighbour against it.
    lay(s, 0, 0.24, 2 * PZ, 0.48, 0.03, 0.015, DARK_CONCRETE, hb);
    for (let k = 1; k < floors; k++) {
      const y = levelY(k) - SLAB / 2;
      for (const u of [-d * 0.25, d * 0.25]) {
        for (const a of [-Math.PI / 4, Math.PI / 4]) sb.onFace(s, PX, u, y, 0.34, 0.05, 0.03, 0.015, IRON, a, 0, hb);
        lay(s, u, y, 0.08, 0.08, 0.05, 0.025, IRON, hb);
      }
    }
  }
  // The four outer corners: four walls meeting on their centre lines leave a
  // notch a wall's half-thickness square at each, from the pavement to the roof.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      sb.box(WALL / 2, top - SLAB, WALL / 2, sx * (w / 2 + WALL / 4), (top - SLAB) / 2, sz * (d / 2 + WALL / 4), skin, undefined, HIDE_UNDER);
    }
  }

  // === the roof =================================================================
  //
  // A moulded cornice under the parapet, and the parapet over it, coped. Two
  // bands rather than one is the whole difference between a terrace and a
  // stack of boxes: the cornice throws the one horizontal shadow the elevation
  // has.
  b.box(w + 0.7, 0.3, d + 0.7, 0, top - 0.65, 0, CONCRETE);
  for (const sz of [-1, 1]) {
    b.box(w + 0.5, 0.8, 0.36, 0, top + 0.4, (sz * (d + 0.4)) / 2, skin);
    sb.box(w + 0.62, 0.08, 0.5, 0, top + 0.84, (sz * (d + 0.4)) / 2, CONCRETE);
  }
  for (const sx of [-1, 1]) {
    b.box(0.36, 0.8, d + 0.4, (sx * (w + 0.4)) / 2, top + 0.4, 0, skin);
    sb.box(0.5, 0.08, d + 0.5, (sx * (w + 0.4)) / 2, top + 0.84, 0, CONCRETE);
  }
  // Over a brick front, seeded, a raised panel in the parapet carrying the
  // terrace's date stone: what puts a step in a terrace's skyline at street
  // level, where the stacks are behind the parapet.
  if (brick && rnd() < 0.65) {
    const pw = Math.min(4.2, w * 0.36);
    const zf = (d + 0.4) / 2;
    sb.box(pw, 0.62, 0.36, 0, top + 0.88 + 0.31, zf, skin, undefined, HIDE_UNDER);
    sb.box(pw * 0.45, 0.32, 0.36, 0, top + 1.5 + 0.16, zf, skin, undefined, HIDE_UNDER);
    sb.box(pw + 0.14, 0.08, 0.5, 0, top + 1.54, zf, CONCRETE);
    sb.box(pw * 0.45 + 0.14, 0.08, 0.5, 0, top + 1.86, zf, CONCRETE);
    sb.box(pw - 0.9, 0.34, 0.04, 0, top + 1.2, zf + 0.2, dress);
    for (const sx of [-1, 1]) sb.box(0.2, 0.2, 0.2, (sx * (pw + 0.04)) / 2, top + 1.68, zf, CONCRETE);
  }
  // The stack, with two oversailing courses under its cap and two or three
  // pots; the tank on its stand; a hatch over the stair; a vent. The things on
  // a roof at this scale that read from the street, and what keeps a terrace's
  // skyline from being a ruled line. Visual — the shell below already stops
  // everything at this height.
  {
    const kx = -w / 2 + 1.6;
    const kz = -d * 0.24;
    const kc = brick ? CITY_BRICK : BRICK;
    b.box(1.1, 2.3, 1.3, kx, top + 1.15, kz, kc);
    sb.box(1.22, 0.1, 1.42, kx, top + 1.92, kz, kc);
    sb.box(1.32, 0.1, 1.52, kx, top + 2.04, kz, kc);
    sb.box(1.4, 0.24, 1.6, kx, top + 2.3, kz, DARK_CONCRETE);
    const pots = rnd() < 0.5 ? 3 : 2;
    for (let i = 0; i < pots; i++) {
      const pz = kz + (pots === 3 ? (i - 1) * 0.42 : (i - 0.5) * 0.6);
      b.cyl(0.5, 0.26, 0.32, 6, kx, top + 2.67, pz, DARK_CONCRETE);
      sb.box(0.3, 0.06, 0.3, kx, top + 2.88, pz, DARK_CONCRETE);
    }
  }
  b.cyl(1.5, 1.6, 1.6, 8, w / 2 - 2.0, top + 1.7, d * 0.18, ALLOY);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box(0.14, 1.0, 0.14, w / 2 - 2.0 + sx * 0.5, top + 0.5, d * 0.18 + sz * 0.5, ALLOY);
    }
  }
  sb.box(1.0, 0.04, 1.0, w / 2 - 2.0, top + 2.47, d * 0.18, ALLOY);
  sb.box(0.9, 0.3, 0.9, 0.6, top + 0.15, -d * 0.3, DARK_CONCRETE, undefined, HIDE_UNDER);
  sb.box(1.0, 0.06, 1.0, 0.6, top + 0.33, -d * 0.3, ALLOY);
  b.cyl(0.8, 0.1, 0.1, 6, w / 4 + 0.95, top + 0.4, -d * 0.36, DARK_CONCRETE);

  // === inside ===================================================================
  //
  // What is seen through the glass and in the rooms, and nothing a body is
  // asked to walk round: everything is on a face, or under a ceiling, or on
  // something that is already a collider.

  // Up every flight, a handrail on its brackets and a wall string, both along
  // the pitch on the lane's outer wall.
  for (let s = 0; s + 1 < floors; s++) {
    const from = levelY(s);
    const to = levelY(s + 1);
    const run = (to - from) / GRADE;
    const len = Math.hypot(run, to - from);
    const pitch = Math.atan(GRADE);
    const xw = laneSide(s) * (w / 2 - WALL / 2);
    const mid = (from + to) / 2;
    sb.box(0.05, 0.06, len, xw - laneSide(s) * 0.08, mid + 0.92, 0, TEAK, { x: pitch });
    sb.box(0.03, 0.26, len, xw - laneSide(s) * 0.015, mid + 0.06, 0, TEAK, { x: pitch });
    for (const f of [-0.35, 0, 0.35]) {
      sb.box(0.06, 0.04, 0.04, xw - laneSide(s) * 0.03, mid + 0.86 - f * run * GRADE, f * run, IRON);
    }
  }
  // The flats: architraves round the partition's doorway on both faces, and a
  // pendant lamp over the front room's table.
  for (let s = 1; s < floors; s++) {
    const y = levelY(s);
    const climbs = s + 1 < floors;
    const px = climbs ? slabX(s) - (laneSide(s) * lane) / 2 : slabX(s);
    const pz = -d * 0.08;
    for (const e of [-1, 1]) {
      const z = pz + e * 0.12;
      for (const sx of [-1, 1]) sb.box(0.1, 2.15, 0.02, px + sx * (DOORWAY / 2 + 0.05), y + 1.075, z, TEAK, undefined, HIDE_TOP | HIDE_UNDER);
      sb.box(DOORWAY + 0.2, 0.1, 0.02, px, y + 2.15, z, TEAK);
    }
    const lx = slabX(s);
    const lz = d * 0.24;
    sb.box(0.015, 0.5, 0.015, lx, y + 2.85, lz, IRON);
    b.cyl(0.14, 0.12, 0.4, 8, lx, y + 2.53, lz, ALLOY);
    if (lit && s === 1) lens.box(0.1, 0.06, 0.1, lx, y + 2.47, lz, WINDOW_LIGHT);
  }
  // The shop: two pendants, a till on the counter, and the goods on the
  // shelving's face and on a shelf along the back wall.
  for (const [lx, lz] of [[shopX0 + shopW * 0.35, d * 0.24], [shopX0 + shopW * 0.62, -d * 0.2]] as const) {
    sb.box(0.015, 0.35, 0.015, lx, 2.92, lz, IRON);
    b.cyl(0.16, 0.12, 0.44, 8, lx, 2.67, lz, ALLOY);
    if (lit) lens.box(0.1, 0.06, 0.1, lx, 2.6, lz, WINDOW_LIGHT);
  }
  {
    const tx = shopX0 + 3.0;
    sb.box(0.4, 0.22, 0.34, tx, g0 + 1.24, d * 0.08, ALLOY);
    sb.box(0.36, 0.06, 0.2, tx, g0 + 1.38, d * 0.08 + 0.1, DARK_CONCRETE, { x: -0.5 });
  }
  const goods = [blind, ROAD_PAINT, ALLOY, PLASTER, CONCRETE, TEAK] as const;
  /** Goods faced along a shelf: boxes on a face, standing on the shelf's lip. */
  const stock = (s: Side, plane: number, u0: number, u1: number, y: number, room: number): void => {
    for (let u = u0; u < u1 - 0.1; ) {
      const gw = 0.12 + rnd() * 0.2;
      if (u + gw > u1) break;
      if (rnd() > 0.15) {
        const h = 0.1 + rnd() * (room - 0.1);
        sb.onFace(s, plane, u + gw / 2, y + h / 2, gw - 0.02, h, 0.05, 0.025, goods[Math.floor(rnd() * goods.length)], 0, 0, hideBack(s));
      }
      u += gw;
    }
  };
  for (let i = 1; i < 4; i++) {
    // The shelving's open face is its -X face, 0.8 in from the flank.
    stock("-x", -(w / 2 - 0.8), -d * 0.12 - 2.15, -d * 0.12 + 2.15, g0 + i * 0.5 + 0.03, 0.38);
  }
  {
    const zb = -d / 2 + WALL / 2;
    const u0 = DOORWAY / 2 + 0.4;
    const u1 = w / 2 - 1.0;
    if (u1 - u0 > 0.8) {
      for (const y of [1.3, 1.85]) {
        sb.box(u1 - u0, 0.04, 0.28, (u0 + u1) / 2, y, zb + 0.14, TEAK);
        stock("+z", zb, u0 + 0.05, u1 - 0.05, y + 0.02, 0.4);
      }
    }
  }

  sb.flush(b);
  lens.flushGlow(b);
}
