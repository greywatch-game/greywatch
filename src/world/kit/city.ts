/**
 * kit/city.ts — The downtown builders: tower, office, shophouse, depot,
 * parkade, and the street furniture that makes a roadway read as one.
 * All follow the contract in kit/core.ts (origin-local geometry, no
 * solid/pickable/collisions metadata, colliders declared not created).
 *
 * ## The five buildings, and what each one is FOR
 *
 * A downtown that is all one kind of building is a downtown with one kind of
 * fight in it, so each of these answers a different question and none of them
 * is a variation on another:
 *
 * - **`tower`** — not enterable, and the stock the skyline is made of. What it
 *   contributes is silhouette and a wall to a sightline, and both are three
 *   colliders. The others are worth entering partly because it is not.
 * - **`office`** — a plate you fight ACROSS: one room per storey, cover in the
 *   middle of it, a window band on three bearings.
 * - **`shophouse`** — the opposite at a quarter of the footprint. A shop with
 *   one glazed wall, flats over it cut into rooms, and a passage beside the
 *   shop with a street door of its own. Doorway-scale, and a terrace of them
 *   gives a block face a grain a row of 26 m towers cannot.
 * - **`depot`** — one volume with a gallery round the back of it, so the whole
 *   interior is visible from the whole interior and the only thing that
 *   changes is whether you are four metres up.
 * - **`parkade`** — the same trick with the walls off: three open decks that
 *   all shoot each other.
 *
 * ## What is different about a city block, and why it is a file of its own
 *
 * Everything else in the kit is ONE walked surface with a roof over it. A
 * downtown is the first thing here that stacks them — three floors and a stair
 * between each pair — and stacking is where the world layer's quiet limits
 * live. Four rules come out of it, and every builder below obeys all four:
 *
 * - **A walked surface costs a `NavGrid` slot in every cell of its footprint**,
 *   and the grid keeps `maxSurfaces` of them per cell with the overflow
 *   DROPPED rather than sorted in. So the order colliders are declared in is
 *   part of the design: floors and ramps first, cover and parapets next, roofs
 *   LAST. That is `kit/manor.ts`'s rule generalised — it emits its roofs last
 *   for exactly this reason — and it is what lets a three-storey block keep all
 *   three of its storeys in the graph while spending its last slot on a
 *   spandrel rather than on a roof nothing can reach. Measured on Coldharbour:
 *   with this order the default 3 already keeps every storey, and the map
 *   states 4 for a slot of margin rather than out of need — see
 *   `MapLayout.surfaces` there. Get the order wrong and the map loses a floor
 *   with the slab still drawn and the stair still climbable.
 * - **A flight is 3.6 m of rise at `MAX_WALKABLE_GRADE`, so it is ten metres
 *   long**, and the slab it climbs to may not cover it — the ceiling would
 *   blank the flight out of the graph and strand the storey. Rather than cut a
 *   void around each flight, every building here puts its flights in a LANE at
 *   one edge and leaves that whole lane out of the slab above: the void is then
 *   one rectangle, the slab is one box, and the lane ALTERNATES between the
 *   two edges storey by storey, so the two voids never stack. The head end of
 *   the lane is floored back to the elevation, which is the LANDING and is what
 *   keeps a flight from arriving at a drop; the void is what is left behind it.
 *   What you get for free is an offset atrium on each side — a hole to shoot up
 *   and down through, which is most of what makes a building worth entering.
 * - **A walked slab needs real depth behind its top face.** `renderOutline`
 *   draws its shell with a slope-scaled negative depth offset, and at the
 *   grazing angle a floor is seen from, a thin slab's shell wins the depth test
 *   and paints the whole floor in its own ink. `SLAB` is 0.5 m for the reason
 *   `WALK_DECK_T` is 0.64 and the manor's board deck was raised off 0.14.
 * - **Mullions and railings are `strut`s, not walls.** A 0.24 m fin is a shape
 *   `NavGrid` can only get wrong, and it is exactly the fence's problem: it has
 *   to stop a round where it is drawn and be no body at all. `MapBuilder`
 *   merges a placement's struts into one collider mesh, which is what makes a
 *   glazed elevation affordable.
 *
 * ## What an enterable building COSTS, which is the budget for the next one
 *
 * Colliders, and they are paid by every ray in the game. A pick costs per MESH
 * — predicate, matrix inverse, bounding test — so the whole solid set is on the
 * bill for `Player.probeGround` every frame and for `CombatSystem.fire` every
 * shot, wherever on the map the ray is (see `MapBuilder.struts`'s header, which
 * measured 161 loose boxes at ~17% of every ray on Hollowmere).
 *
 * A tower is 3 boxes. `office` is ~50, `parkade` ~35, `shophouse` ~42 and
 * `depot` ~35 — an order of magnitude each, and that is the trade an interior
 * IS. Measured on Coldharbour when the eight shophouses and two depots went in:
 * the map went from **425 solid meshes to 783**, and an A/B in one session
 * (flipping `metadata.solid` on the new meshes, which is the only way to take
 * one out of the loop — Babylon skips its own enabled/visible checks whenever a
 * pick predicate is supplied) put the ground probe at **91 to 180 µs** and a
 * 120 m shot at **93 to 180 µs** over the same 196-ray spray. Call it +95% on
 * every ray, exactly linear in the mesh count.
 *
 * **The ceiling that buys is Hollowmere's 863**, which is what ships and what
 * FINDINGS #6's 2.45 ms `probeGround` was measured against. Coldharbour at 783
 * is still under it, so this changed how expensive the cheap map is and not how
 * expensive the game's worst map is. Another two of these would not be, and
 * that is the number to check before adding them rather than the building count.
 *
 * ## The glass, and where it is allowed to matter
 *
 * Six thousand sheets are drawn here and TWENTY-FOUR of them break, and which
 * twenty-four is answered by what is behind the glass rather than by what is in
 * front of it: a pane is `breakable` where there is enterable space behind it,
 * and is glazing everywhere else.
 *
 * **Glass hung on a solid mass is decoration, and breaking decoration is worse
 * than leaving it alone.** A tower's curtain wall hangs 4 cm off a solid shaft,
 * so a round has always stopped on the concrete behind it, and the brick
 * variant's punched windows are drawn on that shaft too. Shooting either out
 * changes nothing you can play with and costs the elevation its word: a
 * street-level shopfront that shatters into a blank grey shaft is a building
 * admitting it is a box. So it stays whole, the round sparks on the concrete
 * 4 cm behind it, and the sheet is never in `GameMap.panes`, the sweep, the
 * collision bake or the wire at all — see `PaneSpec.breakable`.
 *
 * The places glass is the ONLY thing in the way are the two SHOPFRONTS —
 * `buildOffice`'s +Z elevation and `buildShophouse`'s, twelve bays each across
 * the map. Both are a wall until somebody shoots them and a way in afterwards,
 * which is why both face the street and why the doorways are on the other
 * sides: a squad holding the doors has an opening they can hear go in behind
 * them. Piers between the bays are ordinary `wall`s so the corners are never
 * glass and the elevation still reads as a building, and each bay is its own
 * pane so one round takes out a bay rather than a frontage.
 *
 * The shophouse cuts its frontage into ONE bay or two depending on its width,
 * which keeps a narrow unit off a sheet too small to be worth a pane and a wide
 * one off a sheet a burst of twelve shards cannot cover: its bays measure 7.8
 * and 11.6 m² against the offices' 11.5 and 12.5. It also holds the line on the
 * count — a terrace of eight added twelve breakable sheets and not twenty-four.
 *
 * The tower's glazing is split one storey band by one BAY for what is now a
 * reason about the LOOK alone: a band is what sits between two collars and a
 * bay is what sits between two fins, so the elevation reads as panels in a
 * frame rather than as one mirror hung on a block. It was a sheet per
 * elevation first — the same triangles either way, and every one of them
 * merged into the same mesh, so the unit costs nothing and buys the reveal.
 *
 * ## The light budget, which is what decides what is drawn here
 *
 * **A LENS is free and a LIGHT is one of sixteen, and almost everything in this
 * file follows from that.** `Build.glow` is an emissive box: it takes the
 * GlowLayer's bloom and `EmissiveFog`'s per-pixel fade for nothing and spends
 * no shader slot at all. `Build.light` spends one, `LightingSystem` uploads the
 * sixteen nearest, and there is no arbitration beyond distance — so an
 * unbudgeted fixture is not a fixture that costs a little, it is an interior
 * somewhere going dark.
 *
 * This file used to say there were no street fixtures at all, and under the
 * afternoon sun the map shipped with that was right: a lamp had nothing to do.
 * The map moved its hour (see `coldharbour/environment.ts`) and the rule became
 * a split rather than a refusal — **every street light carries a lens and only
 * the ones a layout marks `lit` carry a light**, which on Coldharbour is eight
 * of twenty. Shop signs are lenses only, for the same arithmetic: a `flicker`
 * is visible on a light and not on an emissive, so `LightSpec`'s anticipated
 * "neon ~.9" stays unused until something can afford a slot for it.
 *
 * `litWindows` is the other spender, and every enterable building here takes
 * it: two lights for an office or a depot, three for a shophouse. **An interior
 * on a daylit map is lit by the ambient and the sky term, and the sky term is
 * applied by `n.y`** — so it lands in full on a floor and not at all on a
 * ceiling, and a room with no fixture in it comes out as a bright plate under a
 * black lid. That is also why the depot's hall lamp hangs
 * at the trusses rather than at head height, and why its gallery's hangs
 * mid-span: everything above and beyond a point light in an enclosed room is on
 * the ambient term alone, because the key is shadowed out by the roof.
 *
 * The count is the thing to watch rather than any one lamp. Coldharbour carries
 * about two dozen interior fixtures and eight outdoor ones against the shader's
 * sixteen slots. **`LightingSystem` scores by `distance - range` and never
 * culls by range**, so a fixture well out of its own reach still takes a slot
 * ahead of a nearer-to-nothing one — which means the budget is about where
 * fixtures are CLUSTERED, not how many there are. Coldharbour's worst case is
 * a firefight on the civic square with all eight lamps in contention, four
 * muzzle flashes and a grenade: thirteen of sixteen. Lighting all twenty
 * columns is what the budget refuses, not lighting any.
 */
import { Scene } from "@babylonjs/core";
import { CONFIG } from "../../config";
import type { CelMaterialFactory } from "../../shaders/CelShader";
import {
  Build,
  type BuildParams,
  type Structure,
  ALLOY,
  ASPHALT,
  AWNING,
  BRICK,
  CITY_BRICK,
  CONCRETE,
  DARK_CONCRETE,
  ENAMEL,
  IRON,
  LAMP_RED,
  LAMP_SODIUM,
  PLANK,
  PLASTER,
  RENDER,
  ROAD_PAINT,
  SLATE,
  TEAK,
  WINDOW_LIGHT,
} from "./core";

/**
 * Floor-to-floor height, and the one number the rest of this file is derived
 * from. 3.6 m leaves 3.1 m clear under a `SLAB`, which is an office rather
 * than a crawlspace, and it is what a flight at `GRADE` can climb in 10.3 m —
 * short enough to fit inside a building with room to walk round it.
 */
const STOREY = 3.6;
/**
 * Floor slab thickness. Placed by its TOP face, so the walked surface is exact
 * however this moves. Deep for the outline-shell reason in the header, not
 * because a floor is thick.
 */
const SLAB = 0.5;
/** Wall thickness, all four elevations. */
const WALL = 0.4;
/**
 * Stair and ramp grade. `CONFIG.nav.stepHeight / cellSize` is 0.4 and severs
 * its own links at exactly that, so this is the same margin under it that
 * `buildStairs` keeps.
 */
const GRADE = 0.35;
/** Riser aimed for; the tread count is rounded off it. `buildStairs`'s. */
const RISER = 0.18;
/**
 * The LEAST a landing at the head of a flight may be — not how deep one is,
 * which is whatever is left of the lane past the top tread.
 *
 * A lane is void at the level its flight climbs to (see `buildOffice`), so
 * without a landing the top tread is merely FLUSH with the slab beside it: the
 * way on is sideways, and walking off the stair in the direction you climbed it
 * drops you a storey. Nothing said so — the nav graph links the top tread to
 * the slab across the lane edge, so bots route through it and every reachability
 * probe passes while the player still runs off a cliff at the top of the stairs.
 *
 * **A landing of a FIXED depth only moved that cliff back, and the measurement
 * is why it is not one any more.** At 2.4 m the void resumed on the far side of
 * it, so the failure was the same failure two and a half metres later: on the
 * shipped plates an office landing had 4.5 m of open lane in front of it over a
 * 3.4 m drop and a parkade apron 6.1 m, and a shophouse's — where the back wall
 * falls 0.54 m past the landing edge against a body radius of 0.45 — put the
 * player's centre 9 cm out over a slot, which is all `probeGround`'s one ray
 * needs to miss the floor and drop them into the close. So a landing runs from
 * the top tread to the ENCLOSURE: the way on is still sideways, and the
 * direction you climbed is floor until a wall. What is left of the lane is the
 * atrium and it is all at the FOOT end — 16.6 m of it on an office plate, over
 * the flight and the floor below — which is the hole the whole lane arrangement
 * exists to leave, approached across open floor with the drop in front of you
 * rather than met at a run off a stair.
 *
 * The number survives as the minimum a plate has to leave: 2.4 m is over
 * `NavGrid`'s 1.5 m cell, so a landing is never rounded out of the graph, and
 * long enough to stop a sprint on. A flight overruns its own foot by 0.6 m and
 * needs 2.4 m past its head, so `d` is still what has to hold `run + 3.0`. Both
 * builders check it.
 */
const LANDING = 2.4;
/**
 * The ground floor's walked height, above the street outside.
 *
 * Inside `HEIGHT_EPS` (0.35), so `NavGrid.addSurface` MERGES it with the
 * terrain underneath instead of spending a second slot on it, and inside
 * `stepHeight` (0.6), so every doorway links to the pavement without a ramp.
 * It exists at all so the interior has a floor of its own colour and so the
 * slab is not coplanar with the ground — which is the tavern's flicker.
 */
const GROUND = 0.2;
/** Spandrel height above a floor: chest-high cover at every window. */
const SPANDREL = 1.0;
/** Head height of a window band above its floor. */
const HEAD = 2.5;
/** Metres between mullions. */
const MULLION_PITCH = 2.6;
/**
 * The narrowest opening this file will cut, and a NAV GRID number rather than
 * an architectural one.
 *
 * `NavGrid.severLinks` cuts every link whose segment crosses a wall's box, and
 * those segments run between CELL CENTRES — 1.5 m apart. So an opening keeps
 * its links only if a cell centre falls inside it, and a gap under `cellSize`
 * can land entirely between two and seal the room behind it. Nothing reports
 * it: the doorway is drawn, a player walks through it, and the flood fill has
 * simply never been to the other side.
 *
 * 1.8 m is `cellSize` plus a cell's worth of margin, so an opening survives
 * wherever the grid's origin happens to fall relative to the wall. Measured:
 * at 1.0 m a flat's back room came back standable-but-unreached from both home
 * fields, and at 1.8 m both rooms of every unit on the map are reached. The
 * cottage's 1.6 m door is the shipped precedent and is the smallest that has
 * ever worked; do not go under it, and prefer this.
 */
const DOORWAY = 1.8;

/** Walked height of level `s`, 0 being the ground floor. */
const levelY = (s: number): number => (s === 0 ? GROUND : s * STOREY);

/**
 * One storey's circulation in a stair LANE: the flight, and the landing at its
 * head. Every enterable building in this file climbs on this, and it is one
 * function because the two halves are one decision — a flight whose grade moved
 * takes its landing with it, and `Build.flight`'s own header is about the copy
 * of a flight that drifts from the original.
 *
 * A lane runs the plate's depth and alternates between the two X edges storey
 * by storey (see the file header), so which EDGE a storey climbs is always the
 * caller's. Which END it climbs toward is the caller's too, and it matters for
 * one reason: **the landing is at the head, so `dir` decides which end of the
 * lane the way UP is at, and that has to be the end the building's own door
 * for it is at.** Get it backwards and the door opens into the blind side of a
 * flight — 3.4 m of concrete two metres inside a doorway, with the graph
 * perfectly happy because the stair is still reachable from the other end.
 * `office` climbs +Z (its doorways are on -Z and +X, and the whole plate is one
 * room, so either end serves); `shophouse` climbs -Z, because its stair has a
 * street door of its own at +Z and the foot has to be inside it.
 *
 * Three things are folded in here rather than left to each caller:
 *
 * - **The overrun at the foot.** 0.6 m past the bottom tread, so the joint at
 *   the floor is buried rather than floating; `Build.flight` drops every tread
 *   under the local ground line, which is what makes an overrun free.
 * - **The landing at the head, and it runs to the ENCLOSURE.** The lane's full
 *   width, and from the top tread to the inner face of the elevation the flight
 *   climbs toward — whatever depth that comes to, never a fixed one. The lane
 *   is VOID at the level the flight climbs to, so a landing that stopped short
 *   of the wall would leave the drop it exists to remove sitting two and a half
 *   metres further on. See `LANDING`, which is what may not be left.
 * - **The DEV check that the plate can hold both.** The circulation runs from
 *   `run / 2 + 0.6` short of the -Z elevation to the +Z one, so a plate too
 *   shallow leaves a landing under `LANDING` deep — a lip rather than a floor,
 *   and under `NavGrid`'s own cell. It throws rather than building it, because
 *   the symptom otherwise is a storey that is drawn and reachable and whose
 *   stair arrives on a ledge.
 */
function laneFlight(o: {
  b: Build;
  /** The builder's name, for the DEV message. */
  tag: string;
  /** Lane centre on X, and the lane's width — which IS the flight's. */
  x: number;
  lane: number;
  /** The plate's depth, which is what has to hold the run and the landing. */
  depth: number;
  /** Walked heights this flight runs between. */
  from: number;
  to: number;
  /** Which end of the lane the head — and so the way up — is at. */
  dir?: 1 | -1;
  tread: string;
  landing: string;
}): void {
  const { b } = o;
  const dir = o.dir ?? 1;
  const rise = o.to - o.from;
  const run = rise / GRADE;
  if (import.meta.env.DEV && run / 2 + LANDING > o.depth / 2 - WALL / 2) {
    throw new Error(
      `${o.tag}: a ${o.depth} m plate cannot hold a ${run.toFixed(1)} m flight and ` +
        `leave the ${LANDING} m its landing needs between the top tread and the ` +
        "elevation — the stair would arrive on a ledge. See laneFlight, and LANDING.",
    );
  }
  b.flight({
    x: o.x,
    w: o.lane,
    topZ: (dir * run) / 2,
    topY: o.to,
    run: run + 0.6,
    rise: rise + 0.6 * GRADE,
    dir,
    steps: Math.max(4, Math.round(rise / RISER)),
    color: o.tread,
  });
  // From the top tread to the inner face of the elevation ahead: the lane's
  // head end is floor, and the void is the whole of what is left behind it.
  const head = (dir * run) / 2;
  const far = dir * (o.depth / 2 - WALL / 2);
  const deep = Math.abs(far - head);
  const lz = (head + far) / 2;
  b.box(o.lane, SLAB, deep, o.x, o.to - SLAB / 2, lz, o.landing);
  b.block({ w: o.lane, h: SLAB, d: deep, x: o.x, y: o.to - SLAB / 2, z: lz });
}

/**
 * A tower: the solid stock a downtown is mostly made of, and the thing that
 * turns a street into a canyon.
 *
 * **Not enterable, on purpose.** Sixteen bots and a player do not need sixty
 * rooms; what a skyline needs is silhouette and a wall to a sightline, and both
 * are three colliders. The enterable buildings are `office` and `parkade`, and
 * they are worth entering partly because their neighbours are not.
 *
 * Its skin is chosen by its own HEIGHT rather than by a parameter, so a layout
 * gets the two kinds of building a real block holds without stating which:
 * under `BRICK_CEILING` it is older low stock in brick with punched windows,
 * over it a banded curtain wall. One number, two silhouettes, and no way to ask
 * for a fifty-metre brick warehouse by accident.
 *
 * The floor bands are COLLARS — one box wrapping all four elevations per floor
 * line — rather than four boxes a side. A tower is twelve floor lines and the
 * saving is 36 meshes each before the merge; what it costs is that a band is
 * continuous round the corners, which is what a spandrel band actually does.
 */
export function buildTower(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "tower");
  const w = p.width ?? 18;
  const d = p.depth ?? 16;
  const h = p.height ?? 34;
  /** Above this a building is a curtain wall; below it, brick. */
  const BRICK_CEILING = 17;
  const brick = h < BRICK_CEILING;
  const skin = brick ? CITY_BRICK : CONCRETE;

  // The plinth. 0.3 m so it MERGES with the ground in the nav grid rather than
  // spending a slot (see `GROUND`), and so a body steps onto it: a kerb around
  // a tower is cover you can back into, and a 0.4 m one would be a separate
  // surface nothing links to at the corners.
  b.box(w + 0.7, 0.3, d + 0.7, 0, 0.15, 0, DARK_CONCRETE);
  b.block({ w: w + 0.7, h: 0.3, d: d + 0.7, x: 0, y: 0.15, z: 0 });

  // The shaft, and the setback above it. Two masses rather than one is what
  // stops a row of these reading as a row of crates: the upper one is inset,
  // so the skyline steps.
  const setback = brick ? 0 : Math.round(h * 0.34);
  const lower = h - setback;
  const sw = w * 0.76;
  const sd = d * 0.76;
  b.box(w, lower, d, 0, lower / 2, 0, skin);
  b.block({ w, h: lower, d, x: 0, y: lower / 2, z: 0 });
  if (setback > 0) {
    b.box(sw, setback, sd, 0, lower + setback / 2, 0, skin);
    b.block({ w: sw, h: setback, d: sd, x: 0, y: lower + setback / 2, z: 0 });
  }

  /**
   * Glazing, standing PROUD of each elevation rather than recessed into it.
   *
   * This was inset first and the panels were invisible: a shaft is one solid
   * box from `-d/2` to `+d/2`, so a 0.12 m sheet set 0.14 m back is entirely
   * inside it and never drawn — forty towers of blank concrete, with nothing
   * wrong anywhere and no way to tell from the numbers. What makes the recess
   * read instead is the COLLARS below, which stand further out again: 0.04 m of
   * glass over the wall, 0.2 m of band over the glass, so the storeys are a
   * shadow line and the bands are the thing catching the sun.
   *
   * **It is glazed one PANEL at a time — a storey tall and a bay wide — and
   * both units are the building's own**: a band is what sits between two
   * collars, a bay is what sits between two FINS, and the sheet stops short of
   * each so the frame is drawn around the glass rather than over it. The
   * elevation was a single sheet first and a storey ribbon after that, and both
   * read as one mirror hung on a block, because a curtain wall's whole
   * appearance is the grid it is divided by.
   *
   * The panel is FREE, which is what lets it be chosen for the look alone: none
   * of this glass breaks (it hangs on a solid shaft — see the file header), so
   * a panel is not a unit anything at runtime holds. It is the same triangles
   * as a ribbon, merged into the same mesh by `MapBuilder.paneGroup`, and it is
   * in no pane list, no sweep and no bake. The shopfront below is the opposite
   * case and is cut per bay for the opposite reason: there, a pane is what
   * BREAKS.
   */
  const glaze = (mw: number, md: number, y0: number, y1: number): void => {
    const tall = y1 - y0 - 0.6;
    if (tall <= 0) return;
    const t = 0.14;
    // Bands, aligned with the collars by construction: both are keyed to
    // `STOREY`, so a band is what is between two of them however tall the mass.
    const rows = Math.max(1, Math.round(tall / STOREY));
    const band = tall / rows;
    // The bays, and the fins that stand between them. ONE count, read twice —
    // the glass below is cut on it and the fins further down are drawn on it,
    // so a panel is bounded by mullions rather than merely near them.
    const fin = 0.26;
    const bays = (span: number) => Math.max(2, Math.round(span / 5.5));
    const nx = bays(mw);
    const nz = bays(md);
    /**
     * One elevation's glass for one band, cut into its bays.
     *
     * `span` is the mass's own width along that elevation and `n` its bay
     * count; `place` turns a bay's centre and width into a pane, which is all
     * the two elevations disagree about. The glass stops 0.6 m short of the
     * mass's corners and half a fin short of an interior mullion, so no panel
     * is ever drawn behind the thing that frames it.
     */
    const cut = (span: number, n: number, place: (c: number, w: number) => void): void => {
      const pitch = span / n;
      for (let i = 0; i < n; i++) {
        const lo = i === 0 ? 0.6 : fin / 2 + 0.04;
        const hi = i === n - 1 ? 0.6 : fin / 2 + 0.04;
        const w = pitch - lo - hi;
        if (w <= 0.2) continue;
        place(-span / 2 + i * pitch + lo + w / 2, w);
      }
    };
    for (let r = 0; r < rows; r++) {
      // A hair short of the pitch, so the collar line still reads between two
      // bands rather than the glass meeting itself.
      const h = band - 0.08;
      const cy = y0 + 0.3 + band * (r + 0.5);
      for (const sx of [-1, 1]) {
        const x = (sx * (mw + t)) / 2 - sx * 0.04;
        cut(md, nz, (cz, w) => b.pane(t, h, w, x, cy, cz, { backed: skin }));
      }
      for (const sz of [-1, 1]) {
        const z = (sz * (md + t)) / 2 - sz * 0.04;
        cut(mw, nx, (cx, w) => b.pane(w, h, t, cx, cy, z, { backed: skin }));
      }
    }
    const mid = (y0 + y1) / 2;
    // Vertical fins between the bays. A curtain wall reads as vertical and the
    // collars are all horizontal, so without these a tower is a stack of
    // stripes; they also stand the one shadow line a flat elevation can have.
    for (const sz of [-1, 1]) {
      for (let i = 1; i < nx; i++) {
        const x = -mw / 2 + (i / nx) * mw;
        b.box(fin, tall, fin, x, mid, (sz * (md + fin)) / 2 - sz * 0.06, skin);
      }
    }
    for (const sx of [-1, 1]) {
      for (let i = 1; i < nz; i++) {
        const z = -md / 2 + (i / nz) * md;
        b.box(fin, tall, fin, (sx * (mw + fin)) / 2 - sx * 0.06, mid, z, skin);
      }
    }
  };
  if (brick) {
    // Punched openings rather than a wall of glass: a grid of small panes,
    // two elevations only. The other two are blank brick, which is what the
    // party walls of a terrace are and costs nothing to draw.
    const rows = Math.max(1, Math.floor((h - 1.6) / STOREY));
    const cols = Math.max(2, Math.round(w / 3.2));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = -w / 2 + ((c + 0.5) / cols) * w;
        const y = 1.5 + r * STOREY;
        for (const sz of [-1, 1]) {
          b.pane(1.3, 1.5, 0.14, x, y, (sz * d) / 2, { backed: skin });
        }
      }
    }
  } else {
    glaze(w, d, 0.3, lower);
    if (setback > 0) glaze(sw, sd, lower, h - 0.4);
    // Floor-line collars. One box each, wrapping the whole mass — and standing
    // proud of the glazing above, which is what turns a flat elevation into a
    // storey rhythm. See `glaze` for the three depths this is one of.
    for (let y = STOREY; y < lower - 0.4; y += STOREY) {
      b.box(w + 0.4, 0.42, d + 0.4, 0, y, 0, skin);
    }
    for (let y = lower + STOREY; y < h - 0.6; y += STOREY) {
      b.box(sw + 0.4, 0.42, sd + 0.4, 0, y, 0, skin);
    }
  }

  // The cap: a parapet collar, the plant housing behind it, and a mast. Emitted
  // last for the header's first rule — a roof is a surface nothing can reach
  // and must never take a slot a floor needs. Visual only; the shaft's own
  // collider already stops everything at this height.
  const topW = setback > 0 ? sw : w;
  const topD = setback > 0 ? sd : d;
  b.box(topW + 0.5, 0.9, topD + 0.5, 0, h + 0.15, 0, DARK_CONCRETE);
  b.box(topW * 0.5, 1.8, topD * 0.5, topW * 0.12, h + 0.9, 0, ALLOY);
  if (!brick) {
    b.cyl(6, 0.16, 0.3, 5, -topW * 0.3, h + 3.6, topD * 0.24, ALLOY);
    // An obstruction light. Emissive, so it reads at any hour and at any
    // distance — on a map with no fog the far side of the skyline is a
    // silhouette, and this is the one thing on it that is not.
    b.glow(0.34, 0.34, 0.34, -topW * 0.3, h + 6.7, topD * 0.24, "#ff5a4a");
  }
  return b;
}

/**
 * The office block: three walked floors, two flights, and the building this
 * whole file exists for.
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
  // `kit/manor.ts`'s reason — one entrance is a choke a squad can hold with a
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
    const bays = Math.max(3, Math.round(w / 5));
    const pier = 0.6;
    const span = (w - pier * (bays + 1)) / bays;
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
  for (let s = 1; s < floors; s++) {
    const y = levelY(s);
    const ceil = (s + 1) * STOREY - SLAB;
    const headH = ceil - (y + HEAD);
    const sides: [number, number, number, number][] = [
      // [width along X, depth along Z, x, z]
      [w, WALL, 0, -d / 2],
      [w, WALL, 0, d / 2],
      [WALL, d, -w / 2, 0],
      [WALL, d, w / 2, 0],
    ];
    for (const [bw, bd, bx, bz] of sides) {
      b.wall(bw, SPANDREL, bd, bx, y + SPANDREL / 2, bz, CONCRETE);
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
  const coreW = 4.6;
  const coreD = 4.2;
  const coreZ = -d * 0.26;
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
    // all outdoors (see the file header) — the sixteen shader slots are
    // otherwise entirely unspent.
    for (let s = 1; s < floors; s++) {
      b.light(WINDOW_LIGHT, 19, 0.8, 0.02, 0, levelY(s) + 2.1, d * 0.12);
    }
  }
  return b;
}

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
 * arrangement is the file header's answer to stacking floors rather than one
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
 * Everything else glazed here is decoration on a solid wall: the sash windows
 * upstairs are drawn on the shell, which stops a round 6 cm behind them, and
 * breaking one would open nothing. They are the brick tower's punched openings
 * at domestic scale.
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

  // --- walked surfaces first (file header, first rule) ----------------------

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
  // see the header.
  //
  // **The bay count is derived from the width**, so a narrow unit gets one big
  // window and a wide one gets two, and neither ends up with a sheet outside
  // the band a burst of twelve shards can account for — measured, these come
  // out at 7.8 and 11.6 m² against the offices' 11.5 and 12.5 (see
  // `docs/world.md` on panes). It also keeps the pane budget honest: the map
  // grew from twelve breakable sheets to twenty-four, and this is what stops a
  // terrace adding three apiece.
  const shopW = slabW;
  const shopX0 = -w / 2 + lane;
  const pier = 0.6;
  const bays = shopW >= 9 ? 2 : 1;
  const bay = (shopW - pier * (bays + 2) - DOORWAY) / bays;
  let cursor = shopX0;
  for (let i = 0; i < bays; i++) {
    b.wall(pier, gh, WALL, cursor + pier / 2, gy, d / 2, skin);
    cursor += pier;
    const x = cursor + bay / 2;
    b.pane(bay, gh, 0.12, x, gy, d / 2, { breakable: true });
    // The frame, standing proud of the glass so it survives the break: a
    // shopfront that has lost a bay should read as an empty frame rather than
    // as a hole in a wall. Visual only — the pane's own collider is what holds
    // a body out, and it is the thing that goes.
    for (const sx of [-1, 1]) {
      b.box(0.14, gh, 0.3, x + (sx * bay) / 2, gy, d / 2 + 0.1, ALLOY);
    }
    b.box(bay, 0.14, 0.3, x, g0 + 2.4, d / 2 + 0.1, ALLOY);
    b.box(bay, 0.2, 0.3, x, g0 + 0.1, d / 2 + 0.1, DARK_CONCRETE);
    cursor += bay;
  }
  b.wall(pier, gh, WALL, cursor + pier / 2, gy, d / 2, skin);
  cursor += pier;
  {
    // The shop door: a lintel over an opening, and the leaf standing open
    // against the reveal inside it. Drawn open rather than shut because it IS
    // open — a closed-looking door on a doorway a body walks through is the
    // one thing an elevation must not say.
    const dx = cursor + DOORWAY / 2;
    b.wall(DOORWAY, gh - 2.3, WALL, dx, g0 + 2.3 + (gh - 2.3) / 2, d / 2, skin);
    b.box(DOORWAY + 0.3, 0.22, 0.34, dx, g0 + 2.42, d / 2 + 0.12, ALLOY);
    b.box(0.09, 2.2, DOORWAY - 0.5, dx + DOORWAY / 2 - 0.16, g0 + 1.1, d / 2 - 0.9, TEAK);
    b.box(DOORWAY + 0.2, 0.1, 0.5, dx, g0 + 0.05, d / 2 - 0.1, DARK_CONCRETE);
    cursor += DOORWAY;
  }
  b.wall(pier, gh, WALL, cursor + pier / 2, gy, d / 2, skin);

  // The fascia over the shopfront, the blind under it, and the bracket sign.
  // A blind is the one warm thing on the elevation and the reason `tint` is
  // read here at all; a row of these is told apart by its blinds at a hundred
  // metres, long before its brick is.
  b.box(shopW + 0.3, 0.7, 0.36, shopX0 + shopW / 2, STOREY - 0.55, d / 2 + 0.14, DARK_CONCRETE);
  b.box(shopW - 0.4, 0.24, 0.1, shopX0 + shopW / 2, STOREY - 0.55, d / 2 + 0.34, ROAD_PAINT);
  b.box(shopW, 0.1, 2.0, shopX0 + shopW / 2, STOREY - 1.35, d / 2 + 0.9, blind, { x: -0.26 });
  b.box(shopW, 0.34, 0.12, shopX0 + shopW / 2, STOREY - 1.62, d / 2 + 1.86, blind);
  for (const sx of [-1, 1]) {
    b.box(0.1, 0.62, 1.9, shopX0 + shopW / 2 + sx * (shopW / 2 - 0.2), STOREY - 1.6, d / 2 + 0.9, ALLOY);
  }
  b.box(0.12, 0.12, 1.1, shopX0 + 0.4, STOREY - 0.2, d / 2 + 0.6, ALLOY);
  // The bracket sign. It hangs either way — what `sign` changes is whether its
  // FACE is lit, which is why the param is a colour and not a flag: an unlit
  // sign is a board and a lit one is a board with a lamp behind it, and the
  // only thing that differs is what comes off the front of it.
  //
  // Drawn as a board with a face rather than as one emissive box, because a
  // box glowing on all six sides is a lamp rather than a sign — the back of a
  // projecting sign is the back of a projecting sign. The board is 0.1 deep in
  // the blind's colour and the face is 0.02 proud of it on the far side from
  // the wall, which is the side the street reads.
  b.box(0.1, 0.8, 0.66, shopX0 + 0.4, STOREY - 0.72, d / 2 + 1.0, blind);
  if (p.sign) {
    b.glow(0.02, 0.66, 0.54, shopX0 + 0.46, STOREY - 0.72, d / 2 + 1.0, p.sign);
  }

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
  const uy0 = levelY(1) - SLAB;
  const uh = top - SLAB - uy0;
  const ucy = uy0 + uh / 2;
  b.wall(w, uh, WALL, 0, ucy, -d / 2, skin);
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
  const openW = 1.9;
  const jamb = (w - openW) / 2;
  for (let s = 1; s < floors; s++) {
    const y = levelY(s);
    const wy0 = y - SLAB;
    const wy1 = (s + 1 < floors ? levelY(s + 1) : top) - SLAB;
    for (const sx of [-1, 1]) {
      b.wall(jamb, wy1 - wy0, WALL, (sx * (openW + jamb)) / 2, (wy0 + wy1) / 2, d / 2, skin);
    }
    b.wall(openW, y + 0.9 - wy0, WALL, 0, (wy0 + y + 0.9) / 2, d / 2, skin);
    if (wy1 > y + 2.5 + 0.05) {
      b.wall(openW, wy1 - (y + 2.5), WALL, 0, (y + 2.5 + wy1) / 2, d / 2, skin);
    }
    // The reveal round the opening: the same trim a drawn sash gets, so the two
    // read as the same window and only one of them is a hole.
    b.box(openW + 0.4, 0.16, 0.3, 0, y + 0.82, d / 2 + 0.1, CONCRETE);
    b.box(openW + 0.4, 0.2, 0.26, 0, y + 2.6, d / 2 + 0.1, CONCRETE);
    for (const sx of [-1, 1]) {
      b.box(0.14, 1.8, 0.24, (sx * (openW + 0.14)) / 2, y + 1.7, d / 2 + 0.08, CONCRETE);
    }
  }

  // A sash window: the pane straddles the wall's outer plane so half of it
  // stands proud and is drawn at all (the tower's lesson — a sheet set back
  // into a solid mass is inside it and invisible), with the sill and the head
  // standing further out again so the opening reads as punched rather than
  // painted on.
  const sash = (x: number, y: number, z: number, sz: -1 | 1, ww: number): void => {
    const h = 1.6;
    const cy = y + 0.9 + h / 2;
    b.pane(ww, h, 0.12, x, cy, z, { backed: skin });
    b.box(ww + 0.36, 0.16, 0.26, x, y + 0.82, z + sz * 0.1, CONCRETE);
    b.box(ww + 0.36, 0.2, 0.22, x, y + 2.6, z + sz * 0.1, CONCRETE);
    for (const s of [-1, 1]) {
      b.box(0.12, h + 0.2, 0.2, x + (s * (ww + 0.12)) / 2, cy, z + sz * 0.08, CONCRETE);
    }
    b.box(ww - 0.1, 0.07, 0.14, x, cy, z + sz * 0.07, ALLOY);
  };

  for (let s = 1; s < floors; s++) {
    const y = levelY(s);
    // Two drawn sashes on the street elevation, either side of the opening cut
    // above, and two on the rear. Glazing on a solid shell: the brick tower's
    // punched openings at domestic scale, and none of it breaks.
    for (const sx of [-1, 1]) {
      sash(sx * (openW / 2 + jamb / 2), y, d / 2, 1, Math.min(1.15, jamb - 0.7));
    }
    for (let i = 0; i < 2; i++) {
      sash(-w / 2 + ((i + 0.5) / 2) * w, y, -d / 2, -1, 0.95);
    }
    // The juliet balcony, on the one window that is a hole. A rail and nothing
    // to stand on: the spandrel behind it is what stops a body, so this is a
    // silhouette rather than a surface — the planter's argument, one floor up —
    // and the nav graph is never asked about a 0.3 m ledge three storeys up.
    b.box(openW, 0.12, 0.5, 0, y + 0.72, d / 2 + 0.24, CONCRETE);
    b.box(openW, 0.09, 0.09, 0, y + 1.72, d / 2 + 0.42, ALLOY);
    for (let i = 0; i <= 6; i++) {
      b.box(0.06, 1.0, 0.06, -openW / 2 + (i / 6) * openW, y + 1.25, d / 2 + 0.42, ALLOY);
    }
  }

  // The flats' own partition: one wall across the plate with a doorway in it,
  // which is what makes an upper storey rooms rather than a gallery. Emitted
  // after the shell so a perimeter cell spends its last nav slot on a wall
  // head rather than on the roof — the file header's first rule.
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
  b.box(w + 0.4, SLAB, d + 0.4, 0, top - SLAB / 2, 0, ASPHALT);
  b.block({ w: w + 0.4, h: SLAB, d: d + 0.4, x: 0, y: top - SLAB / 2, z: 0 });
  // A moulded cornice under the parapet, and the parapet over it. Two bands
  // rather than one is the whole difference between a terrace and a stack of
  // boxes: the cornice throws the one horizontal shadow the elevation has.
  b.box(w + 0.7, 0.3, d + 0.7, 0, top - 0.65, 0, CONCRETE);
  for (const sz of [-1, 1]) {
    b.box(w + 0.5, 0.8, 0.36, 0, top + 0.4, (sz * (d + 0.4)) / 2, skin);
  }
  for (const sx of [-1, 1]) {
    b.box(0.36, 0.8, d + 0.4, (sx * (w + 0.4)) / 2, top + 0.4, 0, skin);
  }
  // The stack and the tank: the two things on a roof at this scale that read
  // from the street, and what keeps a terrace's skyline from being a ruled
  // line. Visual — the shell below already stops everything at this height.
  b.box(1.1, 2.3, 1.3, -w / 2 + 1.6, top + 1.15, -d * 0.24, brick ? CITY_BRICK : BRICK);
  b.box(1.4, 0.24, 1.6, -w / 2 + 1.6, top + 2.3, -d * 0.24, DARK_CONCRETE);
  for (const sx of [-1, 1]) {
    b.cyl(0.5, 0.3, 0.34, 6, -w / 2 + 1.6 + sx * 0.3, top + 2.6, -d * 0.24, DARK_CONCRETE);
  }
  b.cyl(1.5, 1.6, 1.6, 8, w / 2 - 2.0, top + 1.7, d * 0.18, ALLOY);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box(0.14, 1.0, 0.14, w / 2 - 2.0 + sx * 0.5, top + 0.5, d * 0.18 + sz * 0.5, ALLOY);
    }
  }
  // The rainwater goods, which is the one detail that says the wall is masonry
  // and not a painted box.
  for (const sx of [-1, 1]) {
    b.cyl(top - 0.4, 0.16, 0.16, 6, sx * (w / 2 + 0.1), (top - 0.4) / 2, d / 2 - 0.5, ALLOY);
  }

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
    // file header on the budget these share with the eight lit lamp columns.
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
 * emission order are `office`'s, for the reasons in this file's header and in
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
    // **Both boxes are `noOutline`, and between them that is what makes the
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
    slab.metadata = { ...(slab.metadata ?? {}), noOutline: true };
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
    ).metadata = { noOutline: true };
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
    for (const sx of [-1, 1]) {
      // Cut short on the side the ramp climbs, or the upstand walls the ramp in
      // at exactly the point a body has to leave it.
      const open = laneSide(s - 1) === sx;
      const len = open ? d - lane - 1.0 : d;
      const off = open ? (lane + 1.0) / 2 : 0;
      b.wall(0.35, 0.95, len, (sx * w) / 2, y + 0.475, off, CONCRETE);
    }
  }

  // Columns, full height, one box each. See the header.
  const cols = Math.max(2, Math.round(w / 7.5));
  const rows = Math.max(2, Math.round(d / 7.5));
  for (let i = 0; i <= cols; i++) {
    for (let j = 0; j <= rows; j++) {
      const x = -w / 2 + (i / cols) * w;
      const z = -d / 2 + (j / rows) * d;
      // Nothing in a ramp lane: a column in one is a pillar in the road. Both
      // lanes are at `±(w - lane) / 2` (see `laneX`), and the margin is half a
      // lane plus a column, so a column ON the lane edge goes too.
      if (Math.abs(Math.abs(x) - (w - lane) / 2) < lane / 2 + 0.4) continue;
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
    const open = laneSide(decks - 2) === sx;
    const len = open ? d - lane - 1.0 : d;
    const off = open ? (lane + 1.0) / 2 : 0;
    b.wall(0.35, 1.05, len, (sx * w) / 2, topY + 0.525, off, CONCRETE);
  }
  b.box(4.0, 2.4, 3.4, w * 0.18, topY + 1.2, -d * 0.3, DARK_CONCRETE);
  return b;
}

/**
 * The goods depot: one big brick shed with a gallery round the back of it, and
 * the third kind of interior this map has.
 *
 * ## What it is FOR, given the office and the parkade
 *
 * The three enterable buildings on Coldharbour are three different questions.
 * The office is a stack of rooms you clear one storey at a time. The parkade
 * is three open platforms that all shoot each other. This is neither: it is
 * ONE VOLUME 28 m across with a mezzanine along the back of it, so the whole
 * interior is visible from the whole interior and the only thing that changes
 * is whether you are eight metres up. Cover is the crates and the columns and
 * nothing else, and the mezzanine is a firing platform over the lot of it with
 * exactly one stair to it.
 *
 * What that makes it is a room worth throwing a grenade into, which is a thing
 * the map otherwise has none of.
 *
 * ## The ways in, and why there are three
 *
 * The loading elevation faces +Z and is mostly opening: a run of roller bays
 * between brick piers, tall enough and wide enough that a body walks straight
 * in without a doorway ever being mentioned. One bay is shuttered, which is
 * what stops the frontage reading as a colonnade and gives the elevation
 * somewhere for a round to stop.
 *
 * The third is a personnel door in the -X gable, standing beside the FOOT of
 * the stair. That is deliberate and it is the building's one asymmetry: the
 * bays put you on the floor in front of everybody on the gallery, and the side
 * door puts you on the stair before anyone on the gallery can see you.
 *
 * ## The mezzanine, and the one number the plate has to hold
 *
 * `MEZZ_D` deep along the -Z wall, spanning the full width, with the flight
 * climbing toward it up a lane at the -X end. It climbs **-Z**, which is the
 * one flight in this file that does — the loading front has to stay clear, so
 * the stair runs back from it — and that is why this does not go through
 * `laneFlight`, whose whole contract is that a lane climbs +Z.
 *
 * So the depth is what has to hold `MEZZ_D + run + 0.6`, and DEV throws rather
 * than pushing a stair through the loading elevation. There is no landing at
 * the head, and there does not need to be one: the mezzanine slab IS the
 * landing, because the flight arrives at its front edge rather than into a
 * void the way a lane's does.
 *
 * ## The roof is a sawtooth, and it is the silhouette that does the work
 *
 * Three teeth, each a pitched slab with a glazed face standing up at its high
 * end. It is the one roof shape in the kit that is neither flat nor gabled,
 * which is most of why this reads as industry from four hundred metres away on
 * a map with no fog to hide the far side of. The glazing is decoration on the
 * same terms as a tower's curtain wall — there is a roof void behind it and
 * nothing anybody can get to — so none of it breaks.
 *
 * The gable walls run past the eaves to the tops of the teeth, which is what
 * closes the triangles at each end. Cut them at the eaves instead and the shed
 * has three slots in it you can see the sky through from inside.
 */
export function buildDepot(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "depot");
  const w = p.width ?? 28;
  const d = p.depth ?? 16;
  /** Wall head, where the sawtooth springs from. */
  const eaves = p.height ?? 8;
  /** How far a tooth climbs above the eaves. */
  const TOOTH = 1.9;
  /** The gallery's walked height, and how far it reaches out from the back. */
  const MEZZ = 3.8;
  const MEZZ_D = 4.0;
  /** Stair lane at the -X end. `buildOffice`'s width, for its reason. */
  const lane = 3.4;
  /** Clear opening of a roller bay. */
  const OPEN = 4.6;

  const zBack = -d / 2 + WALL / 2;
  const zFront = d / 2 - WALL / 2;
  /** The gallery's front edge — where the flight arrives. */
  const zMezz = zBack + MEZZ_D;
  const laneCx = -w / 2 + WALL / 2 + lane / 2;
  const laneInner = -w / 2 + WALL / 2 + lane;
  const rise = MEZZ - GROUND;
  const run = rise / GRADE;
  const pitch = Math.atan(GRADE);

  if (import.meta.env.DEV && zMezz + run + 0.6 > zFront) {
    throw new Error(
      `depot: a ${d} m plate cannot hold a ${MEZZ_D} m gallery and the ` +
        `${run.toFixed(1)} m flight up to it — the stair would run out through ` +
        "the loading elevation. See buildDepot.",
    );
  }

  // --- walked surfaces first (file header, first rule) ----------------------

  // The floor. Inside `HEIGHT_EPS` of the street, so the nav grid merges it
  // with the ground rather than spending a slot, and inside `stepHeight`, so
  // every roller bay links to the pavement without a ramp. See `GROUND`.
  b.box(w, SLAB, d, 0, GROUND - SLAB / 2, 0, DARK_CONCRETE);
  b.block({ w, h: SLAB, d, x: 0, y: GROUND - SLAB / 2, z: 0 });

  // The gallery: one slab the full width, so the flight arrives on it at its
  // front edge and there is no landing to get right.
  b.box(w - WALL, SLAB, MEZZ_D, 0, MEZZ - SLAB / 2, zBack + MEZZ_D / 2, CONCRETE);
  b.block({ w: w - WALL, h: SLAB, d: MEZZ_D, x: 0, y: MEZZ - SLAB / 2, z: zBack + MEZZ_D / 2 });

  // The flight, climbing -Z. Overrunning its own foot by 0.6 m, which
  // `Build.flight` buries: every tread under the ground line is skipped.
  b.flight({
    x: laneCx,
    w: lane,
    topZ: zMezz,
    topY: MEZZ,
    run: run + 0.6,
    rise: rise + 0.6 * GRADE,
    dir: -1,
    steps: Math.max(4, Math.round(rise / RISER)),
    color: ALLOY,
  });

  // --- cover and enclosure --------------------------------------------------

  // The gallery's rail, and the stair's. Both are `guard`s rather than boxes
  // on the edge: a rail has to stop a body (a rail you walk through is a
  // three-metre fall) and has to stand OFF the surface it guards, or the nav
  // grid loses the cell it samples. The run stops at the lane, which is where
  // the stair arrives and the one place the gallery is meant to be open.
  const railLen = w / 2 - WALL / 2 - laneInner;
  b.guard("+z", zMezz, laneInner + railLen / 2, railLen, MEZZ, { color: ALLOY });
  b.guard("+x", laneInner, zMezz + run / 2, run, MEZZ - (run / 2) * GRADE, {
    pitch: -pitch,
    color: ALLOY,
  });

  // The back and the +X gable, solid. The gables run past the eaves to the top
  // of the teeth — see the header, or the shed has slots of sky in it.
  const gableH = eaves + TOOTH;
  b.wall(w, eaves, WALL, 0, eaves / 2, -d / 2, CITY_BRICK);
  b.wall(WALL, gableH, d, w / 2, gableH / 2, 0, CITY_BRICK);

  // The -X gable, with the personnel door cut by hand: this wall runs along Z
  // and `doorWall` runs along X, so it is the two jambs and the lintel that
  // method would emit. The doorway stands beside the foot of the stair.
  {
    const gap = DOORWAY;
    const at = d * 0.24;
    const lo = -d / 2;
    const hi = d / 2;
    const back = at - gap / 2 - lo;
    const front = hi - (at + gap / 2);
    b.wall(WALL, gableH, back, -w / 2, gableH / 2, lo + back / 2, CITY_BRICK);
    b.wall(WALL, gableH, front, -w / 2, gableH / 2, hi - front / 2, CITY_BRICK);
    b.wall(WALL, gableH - 2.4, gap, -w / 2, 2.4 + (gableH - 2.4) / 2, at, CITY_BRICK);
  }

  // The loading elevation: brick piers, a header over the lot of them, and one
  // bay shuttered. The bays are left as OPENINGS rather than doorways — at
  // 4.6 m of clear height there is nothing for a lintel to do that the header
  // above is not already doing.
  const bays = Math.max(2, Math.round(w / 7));
  const pierW = 1.6;
  const bayW = (w - pierW * (bays + 1)) / bays;
  for (let i = 0; i <= bays; i++) {
    b.wall(pierW, eaves, WALL, -w / 2 + pierW / 2 + i * (pierW + bayW), eaves / 2, d / 2, CITY_BRICK);
  }
  b.wall(w, eaves - OPEN, WALL, 0, OPEN + (eaves - OPEN) / 2, d / 2, CITY_BRICK);
  {
    // The shut bay. Corrugated: eight ribs drawn on one sheet, which is the
    // cheapest thing on this elevation that says "steel" rather than "panel".
    const x = -w / 2 + pierW + bayW / 2;
    b.wall(bayW, OPEN, 0.18, x, OPEN / 2, d / 2 + 0.1, ENAMEL);
    const ribs = Math.max(4, Math.round(bayW / 0.6));
    for (let i = 0; i < ribs; i++) {
      b.box(0.1, OPEN - 0.2, 0.1, x - bayW / 2 + ((i + 0.5) / ribs) * bayW, OPEN / 2, d / 2 + 0.22, DARK_CONCRETE);
    }
  }
  // Shutter boxes over the open bays, and the guides down each pier: the three
  // things that say a bay HAS a shutter rolled up rather than being a hole.
  for (let i = 0; i < bays; i++) {
    const x = -w / 2 + pierW + bayW / 2 + i * (pierW + bayW);
    if (i > 0) b.box(bayW, 0.62, 0.5, x, OPEN + 0.31, d / 2 + 0.2, ENAMEL);
    for (const sx of [-1, 1]) {
      b.box(0.18, OPEN, 0.3, x + (sx * bayW) / 2, OPEN / 2, d / 2 + 0.16, ALLOY);
    }
    // Dock bumpers at the jambs, which is what a lorry has been hitting.
    for (const sx of [-1, 1]) {
      b.box(0.3, 0.5, 0.28, x + (sx * (bayW + 0.3)) / 2, 0.85, d / 2 + 0.24, IRON);
    }
  }

  // Columns, full height and one box each: a column is solid at every level,
  // so one box blocks the floor and the roof void together. The parkade's
  // argument, in a building with one floor to block.
  const cols = Math.max(1, Math.round(w / 13));
  for (let i = 1; i <= cols; i++) {
    const x = -w / 2 + (i / (cols + 1)) * w;
    const z = d * 0.16;
    b.wall(0.5, eaves, 0.5, x, eaves / 2, z, ALLOY);
    b.box(0.9, 0.16, 0.9, x, 0.28, z, DARK_CONCRETE);
    for (const sz of [-1, 1]) {
      b.box(0.34, 0.9, 0.34, x, eaves - 0.7, z + sz * 0.3, ALLOY);
    }
  }

  // The site office, tucked under the gallery. One box and a strip of glazing
  // — it is cover in the middle of an otherwise empty floor, and the only
  // thing under the mezzanine worth walking behind.
  {
    const ox = w * 0.24;
    const oz = zBack + MEZZ_D / 2;
    b.wall(5.0, 2.7, 3.2, ox, GROUND + 1.35, oz, ENAMEL);
    b.box(5.2, 0.16, 3.4, ox, GROUND + 2.78, oz, DARK_CONCRETE);
    b.pane(3.0, 1.1, 0.1, ox - 0.6, GROUND + 1.9, oz + 1.6, { backed: ENAMEL });
    b.box(1.0, 2.2, 0.12, ox + 1.8, GROUND + 1.1, oz + 1.6, TEAK);
  }

  // Pallets and crates: the floor's cover, and what stops 28 m of concrete
  // being a shooting gallery. Under `CoverMap`'s 1.7 m line except the tall
  // stack, which is over it on purpose — one piece of hard cover in the room.
  const stacks: [number, number, number, number, number][] = [
    // [w, h, d, x, z]
    [2.6, 1.5, 2.2, -w * 0.24, d * 0.26],
    [3.2, 1.2, 2.4, w * 0.3, d * 0.3],
    [2.2, 2.1, 2.2, w * 0.04, -d * 0.06],
  ];
  for (const [cw, ch, cd, cx, cz] of stacks) {
    b.wall(cw, ch, cd, cx, GROUND + ch / 2, cz, PLANK);
    for (let i = 1; i * 0.75 < ch; i++) {
      b.box(cw + 0.08, 0.1, cd + 0.08, cx, GROUND + i * 0.75, cz, TEAK);
    }
  }

  // --- the elevations, as drawn ---------------------------------------------

  // Brick pilasters on the back and the gables, and a corbelled cornice at the
  // eaves. Both are what makes a 28 m brick wall read as bays rather than as a
  // painted plane, and the cornice is the one horizontal on the building.
  const pilasters = Math.max(2, Math.round(w / 5));
  for (let i = 1; i < pilasters; i++) {
    b.box(0.5, eaves - 0.4, 0.3, -w / 2 + (i / pilasters) * w, (eaves - 0.4) / 2, -d / 2 - 0.2, CITY_BRICK);
  }
  const ribsZ = Math.max(2, Math.round(d / 5));
  for (const sx of [-1, 1]) {
    for (let i = 1; i < ribsZ; i++) {
      b.box(0.3, eaves - 0.4, 0.5, (sx * (w + 0.6)) / 2, (eaves - 0.4) / 2, -d / 2 + (i / ribsZ) * d, CITY_BRICK);
    }
  }
  b.box(w + 0.7, 0.42, d + 0.7, 0, eaves - 0.2, 0, DARK_CONCRETE);

  // Clerestory glazing: a strip under the eaves on the back and both gables.
  // Drawn on a solid wall, so a round stops on the brick 6 cm behind it and
  // none of it is a `breakable` pane — the tower's punched windows, lying
  // down. It is what puts light on the gallery from outside.
  const clerY = eaves - 1.5;
  const clerH = 1.5;
  {
    const n = Math.max(3, Math.round(w / 4.5));
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + ((i + 0.5) / n) * w;
      b.pane(w / n - 0.7, clerH, 0.12, x, clerY, -d / 2, { backed: CITY_BRICK });
      for (const sx of [-1, 1]) {
        b.box(0.16, clerH + 0.24, 0.26, x + (sx * (w / n - 0.5)) / 2, clerY, -d / 2 - 0.06, DARK_CONCRETE);
      }
    }
    const m = Math.max(2, Math.round(d / 4.5));
    for (const sx of [-1, 1]) {
      for (let i = 0; i < m; i++) {
        const z = -d / 2 + ((i + 0.5) / m) * d;
        b.pane(0.12, clerH, d / m - 0.7, (sx * w) / 2, clerY, z, { backed: CITY_BRICK });
        for (const sz of [-1, 1]) {
          b.box(0.26, clerH + 0.24, 0.16, (sx * (w + 0.12)) / 2, clerY, z + (sz * (d / m - 0.5)) / 2, DARK_CONCRETE);
        }
      }
    }
  }

  // The hoist beam over the middle of the loading front, and the sign band on
  // the header. The beam is the one thing that projects from this building and
  // is most of its silhouette from the street.
  b.box(0.34, 0.5, 2.6, 0, OPEN + 1.5, d / 2 + 1.0, ALLOY);
  b.box(0.7, 0.3, 0.7, 0, OPEN + 1.5, d / 2 + 2.1, DARK_CONCRETE);
  b.cyl(0.9, 0.1, 0.1, 5, 0, OPEN + 0.9, d / 2 + 2.1, IRON);
  b.box(w * 0.42, 0.9, 0.16, 0, eaves - 1.1, d / 2 + 0.28, DARK_CONCRETE);
  b.box(w * 0.34, 0.34, 0.1, 0, eaves - 1.1, d / 2 + 0.4, ROAD_PAINT);
  // Rainwater goods down the gable corners.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.cyl(eaves - 0.4, 0.18, 0.18, 6, (sx * (w + 0.5)) / 2, (eaves - 0.4) / 2, (sz * (d - 0.8)) / 2, DARK_CONCRETE);
    }
  }

  // --- the roof, LAST -------------------------------------------------------
  // A sawtooth: a pitched slab per tooth with its glazed face standing up at
  // the high end. The collider is ONE flat slab at the eaves rather than three
  // rotated planes — `gableRoof`'s call, for `gableRoof`'s reason: nothing
  // walks up there and a round only has to stop.
  const teeth = Math.max(2, Math.round(d / 5.5));
  const pitchZ = d / teeth;
  const toothPitch = Math.atan(TOOTH / pitchZ);
  for (let i = 0; i < teeth; i++) {
    const z0 = -d / 2 + i * pitchZ;
    // CONCRETE and not `SLATE`, and it is the parkade's deck argument on a
    // roof: a slab is ONE BOX, so its underside wears whatever its top does,
    // and this underside is the ceiling of the only room in the building. A
    // downward normal gets nothing from the sky term and the AO bake takes
    // more off what is left, so slate came back as a black lid over a lit
    // floor. It is also what a north-light shed's soffit actually is — pale,
    // so the daylight the teeth let in bounces off it.
    b.box(
      w - WALL,
      0.26,
      Math.hypot(pitchZ, TOOTH),
      0,
      eaves + TOOTH / 2,
      z0 + pitchZ / 2,
      CONCRETE,
      { x: -toothPitch },
    );
    // The ridge cap, which is what keeps a pale roof from reading as one plane
    // from the towers above it.
    b.box(w - WALL + 0.2, 0.2, 0.34, 0, eaves + TOOTH + 0.06, z0 + pitchZ * 0.02, SLATE);
    // The north light. Glazing on a roof void, so it is decoration by the same
    // test the curtain walls pass — see the header.
    const gw = w - 1.4;
    b.pane(gw, TOOTH - 0.5, 0.12, 0, eaves + TOOTH / 2, z0 + pitchZ);
    b.box(w - WALL, 0.22, 0.3, 0, eaves + TOOTH - 0.12, z0 + pitchZ, ALLOY);
    b.box(w - WALL, 0.22, 0.3, 0, eaves + 0.12, z0 + pitchZ, ALLOY);
    const mull = Math.max(2, Math.round(gw / 3.4));
    for (let j = 1; j < mull; j++) {
      b.box(0.14, TOOTH - 0.4, 0.22, -gw / 2 + (j / mull) * gw, eaves + TOOTH / 2, z0 + pitchZ, ALLOY);
    }
    // A ridge vent on every other tooth, so the roofscape is not a repeat.
    if (i % 2 === 0) {
      b.cyl(0.9, 0.7, 0.9, 6, w * 0.3, eaves + TOOTH + 0.4, z0 + pitchZ * 0.75, ALLOY);
    }
    // The truss under it: a tie beam across the width at the eaves, with
    // hangers up to the slab.
    //
    // **This is the only thing that makes the roof void READ, and a colour
    // could not have done it.** The soffit is a downward normal, where the sky
    // term contributes nothing at all and the AO bake takes most of the
    // ambient that is left — so a pale slab up there is still near black, and
    // the parkade's fix (choose a lighter tone) is about a walked surface in
    // shade rather than about a ceiling. What answers it is geometry with
    // UPWARD and SIDE faces in the light: the tie beam catches the sky term on
    // its top, the hangers catch the key on one cheek, and the void stops
    // being a lid with nothing in it. It is also just what a north-light shed
    // has in it. Visual only — nothing up here has to stop anything, and the
    // roof's own collider already caps the building.
    b.box(w - WALL, 0.3, 0.3, 0, eaves - 0.25, z0 + 0.2, ALLOY);
    b.box(w - WALL, 0.16, 0.16, 0, eaves + 0.55, z0 + 0.2, ALLOY);
    const hangers = Math.max(3, Math.round(w / 4));
    for (let j = 0; j <= hangers; j++) {
      const hx = -(w - WALL) / 2 + (j / hangers) * (w - WALL);
      b.box(0.14, 0.9, 0.14, hx, eaves + 0.15, z0 + 0.2, ALLOY);
      if (j < hangers) {
        b.box((w - WALL) / hangers, 0.1, 0.1, hx + (w - WALL) / hangers / 2, eaves + 0.3, z0 + 0.2, ALLOY);
      }
    }
    // Purlins running back up the pitch, spaced so the slab above reads as
    // sheeting on a frame rather than as one plane.
    for (let j = 1; j < 3; j++) {
      const t = j / 3;
      b.box(w - WALL, 0.14, 0.14, 0, eaves + TOOTH * t - 0.22, z0 + pitchZ * t, ALLOY);
    }
  }
  b.block({ w: w + 0.4, h: 0.4, d: d + 0.4, x: 0, y: eaves + 0.2, z: 0 });

  if (p.litWindows) {
    // Two, for `buildOffice`'s reason: this is a deep enclosed room on a
    // daylit map, and the sky term lands on the floor and not at all on the
    // ceiling — so an unlit shed reads as a bright plate under a black lid.
    // One over the floor and one over the gallery, which is the storey the
    // clerestory is furthest from.
    //
    // **The hall's one hangs AT THE TRUSSES rather than over head height**, and
    // that is what makes the roof void read at all. Everything above the point
    // lights is on the ambient term alone in here: the sky term is zero on a
    // downward normal and the key is shadowed out by the roof, so the soffit
    // and the steelwork are lit by this lamp or by nothing. Hung at 5.6 m it
    // lit the floor and left a black lid four metres over the gallery; hung
    // under the tie beam it lights both, which is also where a high bay
    // actually goes.
    b.light(WINDOW_LIGHT, 24, 0.75, 0.02, 0, eaves - 1.1, d * 0.16);
    // The gallery's own, and it hangs mid-span rather than off to one side for
    // the same reason: a 27 m gallery lit from one end is a gallery whose far
    // half is on the ambient term. High, so it reaches the soffit too.
    b.light(WINDOW_LIGHT, 20, 0.6, 0.02, 0, MEZZ + 3.2, zBack + MEZZ_D / 2);
  }
  return b;
}

/**
 * A concrete planter: the street's low cover, and the only green on the map.
 *
 * The shrub is drawn 0.3 m proud of the collider on purpose. A planter is cover
 * you crouch behind and a shrub is not, so the box stops at the rim and the
 * foliage above it is a silhouette a round goes through — the same call
 * `buildFernClump` makes, and the reason `PROP_BODIES` keeps a tree's collider
 * to its trunk.
 */
export function buildPlanter(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "planter");
  const w = p.width ?? 2.6;
  const d = p.depth ?? 1.4;
  const h = 0.95;
  b.box(w, h, d, 0, h / 2, 0, CONCRETE);
  b.block({ w, h, d, x: 0, y: h / 2, z: 0 });
  b.box(w - 0.34, 0.12, d - 0.34, 0, h, 0, "#3b3226");
  for (const sx of [-1, 1]) {
    b.box(w * 0.38, 0.9, d * 0.6, (sx * w) / 4.6, h + 0.42, 0, "#41552f");
  }
  return b;
}

/**
 * A run of jersey barrier: roadworks, a closed lane, a checkpoint that was.
 *
 * Chest-high cover you can put anywhere, and the one piece of city furniture
 * whose whole job is to break an avenue's sightline at the ground plane. The
 * taper is two boxes rather than a chamfered profile; at 0.9 m it is read as a
 * silhouette from eye height and never from the side.
 */
export function buildBarrier(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "barrier");
  const len = p.length ?? 6;
  const h = 0.9;
  const units = Math.max(1, Math.round(len / 3));
  for (let i = 0; i < units; i++) {
    const z = -len / 2 + (i + 0.5) * (len / units);
    const unit = len / units - 0.1;
    b.box(0.62, 0.34, unit, 0, 0.17, z, CONCRETE);
    b.box(0.36, h - 0.34, unit, 0, 0.34 + (h - 0.34) / 2, z, CONCRETE);
  }
  b.block({ w: 0.62, h, d: len, x: 0, y: h / 2, z: 0 });
  return b;
}

/**
 * A parked car, along its own local X, nose at +X.
 *
 * Its collider is the BODY and not the silhouette: one box a metre high, and
 * 1.0 m of steel is something to fight from beside — under `cover.crouchHeight`
 * (1.3), so it steers a bot without protecting one — while the cabin above it
 * is glass a round goes through. That is the gravestone's lesson — a box squared off to
 * the silhouette stops rounds through the parts of it that are not there — and
 * the box here is EXACTLY the one this model replaced, which is what makes all
 * of the below a drawing change: the cover, the nav graph, the cover bake and
 * every ray in the game see what they saw before. The greenhouse, the door
 * mirrors and two centimetres of rub strip are the only geometry outside it,
 * and the first two are above it rather than beside it. Everything else is
 * inside on purpose: the bumpers are the ENDS of the car rather than proud of
 * it, so the spark lands where the panel is.
 *
 * **The shape is three volumes and a step, and the step is the wheel arch.**
 * Below `arch` the body is 26 cm narrower than it is above, which leaves a
 * channel down each side for the tyres to stand in with the full-width panel
 * over them; the bonnet and the boot are lower than the beltline between them,
 * which is the profile that stops a car reading as a brick. A box kit cannot
 * cut an arc, so the arch is a change of WIDTH rather than a cut-out, and that
 * is the one trick the whole model rests on.
 *
 * **The windscreen and the backlight are raked, and they are the reason
 * `Build.pane` has a `rotZ` at all.** A sloped sheet lands in a different cel
 * band from the flat panels either side of it, which is what a cabin reads as;
 * upright, the same glass is a box on a box, which is what this was. Both are
 * spanned between two points on the profile by `span()` so the pillars drawn
 * along their edges cannot disagree with them — the A- and C-pillars take the
 * screen's own centre, length and tilt.
 *
 * **The greenhouse is glazing rather than `breakable` panes**, and at four
 * sheets a car that argument is now four times as strong. A cabin is empty but
 * it is not somewhere anybody gets into: a round already crosses it and comes
 * out the far side, so breaking it would buy an effect and nothing else — and
 * it would put a hundred-odd sheets in the pane list, the sweep, the bake and
 * the wire to do it. See `PaneSpec.breakable`. It is also why `rotZ` and
 * `breakable` are mutually exclusive and nothing here is inconvenienced by it.
 *
 * **Five materials, and one colour the map did not already have.** The tyres,
 * the underbody, the grille and the exhaust are `ASPHALT` — the roadway's own
 * colour; the hubs, the lamps and the plate are `ROAD_PAINT`, the lane
 * markings'; the bumpers and the rub strip are `DARK_CONCRETE`. All three are
 * drawn already in any block with a street in it, so a car merges into meshes
 * the block was going to draw anyway and only `LAMP_RED` is a group of its
 * own. Measured over Coldharbour's twenty-six: the whole model costs the map
 * **eighteen** merged meshes and 21k vertices, and not one solid mesh — 783
 * before and 783 after.
 */
export function buildCar(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "car");
  const paint = p.tint ?? ENAMEL;
  const len = 4.4;
  const wide = 1.86;

  // The three heights everything hangs off. `belt` is the top of the steel AND
  // the top of the collider — the panel a round stops on is the panel the box
  // is measured to — `arch` is the tyre's top plus clearance, and `sill` is
  // where the bodywork stops and the shadow under the car starts.
  const sill = 0.42;
  const arch = 0.74;
  const belt = 1.1;
  const glassTop = 1.46;
  const roofTop = 1.54;

  // The X profile: where the bumper takes over from the panel, where the
  // windscreen stands up off the beltline, and where the backlight comes down.
  const nose = len / 2 - 0.18;
  const cowl = 0.55;
  const backlight = -1.32;
  const wheelX = 1.42;
  const wheelZ = 0.8;
  const tyre = 0.68;
  // Between the wheels the body is this wide and no wider: the tyres stand in
  // the 13 cm it leaves each side and come out flush with the panel above.
  const waist = 1.6;

  /** A sheet spanning two points of the X/Y profile: centre, length and rake. */
  const span = (x0: number, y0: number, x1: number, y1: number) => ({
    x: (x0 + x1) / 2,
    y: (y0 + y1) / 2,
    len: Math.hypot(x1 - x0, y1 - y0),
    rot: { z: Math.atan2(y1 - y0, x1 - x0) },
  });
  const screen = span(cowl, belt, 0.1, glassTop);
  const rear = span(backlight, belt, -0.92, glassTop);

  // --- the steel, bottom up -------------------------------------------------
  b.box(nose * 2, arch - sill, waist, 0, (sill + arch) / 2, 0, paint);
  b.box(
    cowl - backlight,
    belt - arch,
    wide,
    (cowl + backlight) / 2,
    (arch + belt) / 2,
    0,
    paint,
  );
  // The bonnet falls 6 cm over its length. Tilting the whole box rather than
  // stepping it is what puts a lit face on the nose: two flat tops at two
  // heights are the same cel band twice.
  b.box(nose - cowl, 0.28, wide, (nose + cowl) / 2, 0.85, 0, paint, {
    z: -0.04,
  });
  // The boot is a step down and not a slope — a saloon's tail is flat.
  b.box(nose + backlight, 0.3, wide, (backlight - nose) / 2, 0.89, 0, paint);
  b.box(
    screen.x - rear.x + 0.04,
    roofTop - glassTop,
    1.68,
    (screen.x + rear.x) / 2,
    (glassTop + roofTop) / 2,
    0,
    paint,
  );

  // --- the greenhouse -------------------------------------------------------
  // What is INSIDE it comes first, and it is not a detail: glass is
  // see-through, so an empty greenhouse is a window onto whatever stands on
  // the far side of the street and the whole cabin reads as an open frame with
  // a plank over it.
  //
  // It is THREE masses and not one, and that is the whole of what makes them
  // an interior. A single box at seat height fills the windscreen and the
  // backlight with its own end face — a flat wall a hand behind the glass,
  // which is a solid block in the window rather than a car with somebody's
  // seats in it. So the dash and the parcel shelf are one low plane that stops
  // 23 cm above the beltline, and the seat backs are two thin masses standing
  // off it: what you see through the screen is a surface, a seat, and daylight
  // over the top of it, which is what looking into a car looks like.
  b.box(1.8, 0.13, 1.42, -0.4, 1.165, 0, ASPHALT);
  b.box(0.13, 0.21, 1.24, -0.1, 1.285, 0, ASPHALT);
  b.box(0.13, 0.19, 1.24, -0.8, 1.275, 0, ASPHALT);
  // Two raked sheets and a flank each side, inset 12 cm from the body so the
  // pillars have something to stand on. The side glass runs the whole cabin
  // and the B-pillar is drawn over it: one sheet with a post in front of it is
  // the same picture as two sheets, at half the glazing.
  b.pane(screen.len, 0.05, 1.62, screen.x, screen.y, 0, { rotZ: screen.rot.z });
  b.pane(rear.len, 0.05, 1.62, rear.x, rear.y, 0, { rotZ: rear.rot.z });
  // The rear quarter is a PANEL and not a post. A saloon's C-pillar is sheet
  // metal a hand wide, and a bar there left the cabin reading as a frame with
  // a plank across it — glass on three sides and daylight through all of them.
  // It is pushed half its width forward off the backlight's own line so its
  // back face IS that line, rather than hanging out over the boot; the side
  // glass runs on underneath and is simply inside the panel, which the depth
  // test hides for nothing.
  const quarter = 0.22;
  const qx = rear.x + (Math.sin(rear.rot.z) * quarter) / 2;
  const qy = rear.y - (Math.cos(rear.rot.z) * quarter) / 2;
  for (const sz of [-1, 1]) {
    b.pane(
      1.39,
      glassTop - belt,
      0.05,
      -0.395,
      (belt + glassTop) / 2,
      sz * 0.81,
    );
    b.box(
      screen.len,
      0.1,
      0.07,
      screen.x,
      screen.y,
      sz * 0.815,
      paint,
      screen.rot,
    );
    b.box(rear.len, quarter, 0.07, qx, qy, sz * 0.815, paint, rear.rot);
    b.box(
      0.1,
      glassTop - belt,
      0.07,
      -0.36,
      (belt + glassTop) / 2,
      sz * 0.815,
      paint,
    );
    // Door mirrors. They are the one thing here outside the collider in Z, and
    // they get away with it by being above it: at 1.16 m they are in the same
    // air the cabin is, which a round has always crossed.
    b.box(0.1, 0.09, 0.16, cowl - 0.14, belt + 0.11, sz * 0.96, paint);
  }

  // --- wheels ---------------------------------------------------------------
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.cyl(0.24, tyre, tyre, 12, sx * wheelX, tyre / 2, sz * wheelZ, ASPHALT, {
        x: Math.PI / 2,
      });
      b.cyl(
        0.26,
        0.34,
        0.34,
        8,
        sx * wheelX,
        tyre / 2,
        sz * wheelZ,
        ROAD_PAINT,
        {
          x: Math.PI / 2,
        },
      );
    }
  }
  // Closes the gap under the sill: without it a car is a shape standing on
  // four legs with the road visible through it from twenty metres away.
  b.box(3.4, 0.16, waist - 0.06, 0, 0.34, 0, ASPHALT);

  // --- the ends -------------------------------------------------------------
  for (const sx of [-1, 1]) {
    b.box(
      len / 2 - nose,
      0.28,
      1.8,
      (sx * (len / 2 + nose)) / 2,
      0.57,
      0,
      DARK_CONCRETE,
    );
    b.box(3.0, 0.05, 0.04, -0.15, 0.83, sx * 0.93, DARK_CONCRETE);
  }
  b.box(0.05, 0.16, 0.74, nose, 0.85, 0, ASPHALT);
  b.box(0.04, 0.13, 0.4, -nose - 0.02, 0.86, 0, ROAD_PAINT);
  b.cyl(0.12, 0.09, 0.09, 6, -nose - 0.04, 0.34, -0.5, ASPHALT, {
    z: Math.PI / 2,
  });
  // Lamps, unlit metal and a flat lens rather than a glow, and this stays true
  // at any hour: a PARKED car does not have its lights on. Twenty-six of them
  // that did would be fifty-two emissive meshes in the bloom saying nothing —
  // which is a different argument from the street lamps' overhead, and it is
  // why they gained a lens when the map's hour dropped and these did not.
  for (const sz of [-1, 1]) {
    b.box(0.06, 0.18, 0.42, nose, 0.85, sz * 0.6, ROAD_PAINT);
    b.box(0.06, 0.2, 0.36, -nose, 0.87, sz * 0.62, LAMP_RED);
  }

  b.block({ w: len, h: 1.1, d: wide, x: 0, y: 0.55, z: 0 });
  return b;
}

/**
 * A street lamp: an alloy column with a cantilevered head over the roadway.
 *
 * It carries NO light, and that is the file header's argument rather than an
 * omission — under a daylit sky there is nothing for one to do, and a fixture
 * light always wins one of the sixteen shader slots whether or not it is
 * adding anything.
 *
 * **The lens is not emissive either, and that was a fix rather than a
 * simplification.** It was a `glow` at a tenth of a lantern's strength, on the
 * argument that the head should still read at distance — and the `GlowLayer`
 * does not scale with the sky: a pale emissive against a bright afternoon
 * blooms to a hard white disc, so every junction on the map had a lamp burning
 * in broad daylight. What reads at distance instead is the SILHOUETTE, which is
 * what a cantilevered arm against the sky already is.
 */
export function buildStreetLight(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "streetlight");
  const h = p.height ?? 7.5;
  const reach = 2.2;
  b.cyl(h, 0.16, 0.3, 8, 0, h / 2, 0, ALLOY);
  b.box(reach, 0.16, 0.16, reach / 2, h - 0.1, 0, ALLOY);
  b.box(0.9, 0.18, 0.42, reach, h - 0.24, 0, ALLOY);
  // The lens, and it is `glow` rather than a flat tone for the reason the whole
  // fixture argument turns on: an emissive box costs no light slot, takes the
  // GlowLayer's bloom, and is faded per pixel by `EmissiveFog` like everything
  // else `getEmissive` hands out. Sodium orange rather than a pale white — a
  // pale lens against a lit sky blooms to a hard white disc, which is why the
  // lens was left off this model in the first place; a saturated one reads as a
  // lamp at any hour and goes to the fog with the rest of the skyline.
  b.glow(0.7, 0.06, 0.3, reach, h - 0.35, 0, LAMP_SODIUM);
  // And the light itself, only where the map asks. See `BuildParams.lit`: the
  // lens says the lamp is on and this says the shader can afford to prove it.
  // Steady — a sodium lamp does not flicker, and the term exists for flame.
  if (p.lit) b.light(LAMP_SODIUM, 16, 0.9, 0, reach, h - 0.5, 0);
  b.block({ w: 0.4, h, d: 0.4, x: 0, y: h / 2, z: 0 });
  return b;
}

/**
 * The civic monument at the middle of a square: three steps and a shaft.
 *
 * The steps are 0.34 m, inside `CONFIG.nav.stepHeight`, so the whole thing
 * links to the pavement from every bearing and needs no ramp — a plinth a bot
 * cannot climb is a plinth that makes the flag on it uncapturable, which is a
 * failure with nothing to see. Each tier is its own collider for that reason
 * and not for the look.
 *
 * A control point may stand on the top tier, but its `pos` must NOT be inside
 * the shaft: `surfaceAt` returns -1 inside a collider, and a flag whose centre
 * is in one cannot be captured at all.
 */
export function buildMonument(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "monument");
  const w = p.width ?? 11;
  const step = 0.34;
  if (import.meta.env.DEV && step > CONFIG.nav.stepHeight) {
    throw new Error(
      `monument: a ${step} m tier is over stepHeight (${CONFIG.nav.stepHeight}) ` +
        "and would strand its own top — see buildMonument.",
    );
  }
  for (let i = 0; i < 3; i++) {
    const s = w - i * 2.2;
    const y = (i + 1) * step;
    b.box(s, step, s, 0, y - step / 2, 0, CONCRETE);
    b.block({ w: s, h: step, d: s, x: 0, y: y - step / 2, z: 0 });
  }
  const base = 3 * step;
  b.box(2.4, 1.0, 2.4, 0, base + 0.5, 0, DARK_CONCRETE);
  b.block({ w: 2.4, h: 1.0, d: 2.4, x: 0, y: base + 0.5, z: 0 });
  b.box(1.3, 8.0, 1.3, 0, base + 5.0, 0, CONCRETE);
  b.block({ w: 1.3, h: 8.0, d: 1.3, x: 0, y: base + 5.0, z: 0 });
  b.box(1.7, 0.3, 1.7, 0, base + 9.15, 0, DARK_CONCRETE);
  b.cyl(1.6, 0.1, 0.7, 6, 0, base + 10.1, 0, ALLOY);
  return b;
}
