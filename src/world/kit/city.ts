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
 *   colliders. The others are worth entering partly because it is not. **What
 *   it is NOT allowed to be is a box with windows**, and its header is mostly
 *   about how a building that nothing may go into is given a front door, a
 *   lobby, a service bay and a crown without a fourth collider: a recess is
 *   free, a projection over reach is free, and a lens is free.
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
 *   LAST. That is `kit/buildings/manor.ts`'s rule generalised — it emits its roofs last
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
 * **What follows is HISTORY**: no ray picks a mesh any more — `RayWorld`
 * answers every one analytically off the boxes — so the per-mesh bill it
 * argues is what rays used to pay, kept for the reasoning behind the budget.
 *
 * Colliders, and they are paid by every ray in the game. A pick costs per MESH
 * — predicate, matrix inverse, bounding test — so the whole solid set is on the
 * bill for `CombatSystem.fire` on every shot, for sixteen bots' LOS, and for
 * every other pick in the game, wherever on the map the ray is (see
 * `MapBuilder.struts`'s header, which measured 161 loose boxes at ~17% of every
 * ray on Hollowmere). The measurements below were taken with the GROUND PROBE as
 * the instrument, because it was the cheapest whole-scene ray to trigger on
 * demand; it has since stopped being a ray, which retires the instrument and
 * changes nothing about what it measured — the cost is per mesh per pick, and
 * the shot path still pays it.
 *
 * A tower is 3 boxes. `office` is ~50, `parkade` ~35, `shophouse` ~42 and
 * `depot` ~35 — an order of magnitude each, and that is the trade an interior
 * IS. Measured on Coldharbour when the eight shophouses and two depots went in:
 * the map went from **425 solid meshes to 783**, and an A/B in one session
 * (flipping `metadata.solid` on the new meshes, which is the only way to take
 * one out of the loop — Babylon skips its own enabled/visible checks whenever a
 * pick predicate is supplied) put a whole-scene ray at **91 to 180 µs** and a
 * 120 m shot at **93 to 180 µs** over the same 196-ray spray. Call it +95% on
 * every ray, exactly linear in the mesh count.
 *
 * **The ceiling that buys is Hollowmere's 863**, which is what ships.
 * Coldharbour at 783 is
 * still under it, so this changed how expensive the cheap map is and not how
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
 * **One sheet on a tower is see-through and still does not break, and it is
 * the exception that keeps the rule readable.** `buildTower`'s lobby front has
 * a drawn room behind it rather than a shaft, so it is not `backed` — the room
 * is what it is there to show. It is not `breakable` either, because the test
 * has never been whether you can SEE something behind the glass: it is whether
 * you can GET there, and nothing can. A round stops on the podium's own box
 * where the sheet is drawn, exactly as it does on the curtain wall above.
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
 * The tower's glazing is one sheet per storey per side, and what divides it
 * is DRAWN: the mullions, fins and column covers of its curtain-wall system
 * stand over the sheet, so the elevation reads as panels in a frame rather
 * than as one mirror hung on a block. It was a sheet per bay before the
 * system was drawn, and that bought nothing but sheets — the same triangles
 * either way, every one of them merged into the same mesh.
 *
 * ## The light budget, which is what decides what is drawn here
 *
 * **A LENS is free and a LIGHT is one of sixteen, and almost everything in this
 * file follows from that.** `Build.glow` is an emissive box: it takes the
 * glow's bloom and `EmissiveFog`'s per-pixel fade for nothing and spends
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
 * it: two lights for an office or a depot, three for a shophouse, and one for
 * a tower's lobby — which is the one that is NOT an interior and is here
 * because thirty-seven towers could never each have had one. No placement
 * states it on a tower; what a tower's own floors are lit by is `Build.glow`,
 * which spends no slot at all. **An interior
 * on a daylit map is lit by the ambient and the sky term, and the sky term is
 * applied by `n.y`** — so it lands in full on a floor and not at all on a
 * ceiling, and a room with no fixture in it comes out as a bright plate under a
 * black lid. That is also why the depot's hall lamp hangs
 * at the girders rather than at head height, and why its gallery's hangs
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
import { mulberry32 } from "../rng";
import {
  Build,
  type BuildCtx,
  type BuildParams,
  type Structure,
  ALLOY,
  ASHLAR,
  ASPHALT,
  AWNING,
  BRICK,
  CASEMENT,
  CITY_BRICK,
  CONCRETE,
  DARK_CONCRETE,
  ENAMEL,
  CREEPER,
  FIG_BARK,
  FIG_LEAF,
  FIG_LEAF_LIT,
  IRON,
  KERB,
  KERB_WORN,
  LAMP_RED,
  LAMP_SODIUM,
  PLANK,
  PLASTER,
  RENDER,
  ROAD_PAINT,
  ROOM_GLOW,
  RUST,
  SLATE,
  STONE,
  STRAW,
  TEAK,
  WINDOW_LIGHT,
  StoneBatch,
  VERDIGRIS,
  convexSolid,
  Mesher,
  type V3,
  limb,
  rope,
  slab,
  type Point3,
  carve,
  streetSeed,
  HIDE_UNDER,
  hideBack,
  outward,
  runsAlongX,
  type Hole,
  type Side,
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
 * player's centre 9 cm out over a slot, which is all `probeGround` needs to miss
 * the floor and drop them into the close. (It is a POINT query at the body's
 * centre however it is answered — that was true of the ray and is true of the
 * bucket lookup that replaced it, so the geometry below is what fixes it.) So a landing runs from
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

/** `Build.glow`'s option for a lit room drawn over a `backed` pane. */
const OVER_GLASS = { overGlass: true } as const;

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
 * A stable 0..1 from a builder's own parameters, so a row of these is not a row
 * of one of these.
 *
 * **World-building code may not call `Math.random()`** — the nav graph would
 * differ between page loads (`CLAUDE.md`) — and a structure builder is the one
 * place in the world layer with no seed to hand: a scatter prop is given one by
 * `MapBuilder`, and a `BuilderKind` is handed only its params. So the variation
 * comes out of the params themselves. `kit/desert.ts`'s `clothHash` got there
 * first and its header owns the argument, which is that two buildings with the
 * same footprint and the same height ARE the same building, and what separates
 * them on the ground is `rotY` and what is standing next to them.
 *
 * It lands better here than anywhere else in the kit, because HEIGHT is already
 * the one thing a layout varies about a tower: Coldharbour's thirty-seven are
 * nearly all 26 x 26 and no two are the same height, so a number the layout was
 * choosing anyway for the skyline drives every roll below as well — which crown
 * it wears, which flank carries the fire escape, where the entrance sits along
 * its frontage, and which floors have their lights on.
 *
 * **The FINALISER is what makes that true, and for a long time it was
 * missing.** The combine step moves mostly LOW bits — a small integer XORed
 * and added in — and the result is read off the HIGH twenty-four, so without
 * a mix at the end nothing but the first input reached the answer: every
 * 26 x 26 tower rolled 0.89 for every salt at every height, and so wore the
 * same crown, the same entrance, the same spine flank, the same fire escape
 * and the same lit floors as every other. `fmix32` (MurmurHash3's) avalanches
 * every input bit across the whole word before the read.
 */
function towerRoll(...ns: number[]): number {
  let hash = 0x9e3779b9;
  for (const n of ns) {
    hash ^= Math.round(n * 64) + 0x9e3779b9 + (hash << 6) + (hash >>> 2);
    hash = hash >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return (hash >>> 8) / 0x1000000;
}

/** A box's top face, as `StoneBatch`'s `hide` names it; `HIDE_UNDER` is its bottom. */
const HIDE_TOP = 1 << 2;
/** The two faces of a member laid along face `s` that butt into what it spans between. */
const hideEnds = (s: Side): number => (runsAlongX(s) ? 1 | 2 : 16 | 32);

/**
 * A tower: the solid stock a downtown is mostly made of, and the thing that
 * turns a street into a canyon.
 *
 * **Not enterable, on purpose, and that has not changed.** Sixteen bots and a
 * player do not need sixty rooms; what a skyline needs is silhouette and a wall
 * to a sightline. The enterable buildings are `office`, `shophouse`, `depot`
 * and `parkade`, and they are worth entering partly because their neighbours
 * are not.
 *
 * ## The budget this is built inside, which is the whole of its design
 *
 * **It is still THREE colliders — two on a brick one — and every line below had
 * to be bought without a fourth.** The file header prices an interior at 35 to
 * 50 boxes and records what that did to every ray in the game: ~95% dearer,
 * exactly linear in the mesh count. There are THIRTY-SEVEN of these on
 * Coldharbour, against **800 collider boxes on the whole map** (`npm run
 * collision`; 821 solid meshes in a live round, Hollowmere's 828 and 720). One
 * more box each is +37, which is 4.6% on every shot, every bot's LOS and every
 * grenade — for a building nobody can go into, on a map whose next want is more
 * building KINDS rather than more boxes on the ones it has. So the rule for
 * anything added here is the one the glass already followed: **buy it with
 * drawing, and if it cannot be bought with drawing, do not buy it.**
 *
 * The bake is the check, and it is exact: `npm run collision` reports 800 both
 * sides of this redesign. What DID move is the proving ground's scatter, by
 * nine props — placement is seeded against the collider set, so a footprint
 * that changed shape re-rolls which dressing fits beside it. That is
 * `CLAUDE.md`'s rule about a placement change owing a re-bake, arriving from
 * the one direction it is easy to miss.
 *
 * What that forbids and what it allows are both counter-intuitive, so:
 *
 * - **A recess is free and a projection is not.** The collider is the plain
 *   mass; the DRAWING may be notched into it as deep as you like, because
 *   nothing picks a visual and a body is stopped at the mass's own plane. So
 *   the lobby below is a 2.6 m hole cut in the podium's elevation with no
 *   collider anywhere near it, and a player who walks up to it is stopped at
 *   the glass — which is what glass does. Standing something PROUD is the
 *   opposite case and stays inside the trim budget the rest of the kit works to
 *   (the shophouse's shopfront frames are 0.1 to 0.34), with one exemption:
 *   anything over reach — a canopy, a cornice, a fire escape — projects as far
 *   as it likes, because nothing walks through what it cannot touch.
 * - **A LENS is free and a LIGHT is one of sixteen**, and this is the builder
 *   that rule binds hardest: thirty-seven lobbies with a lamp in each is the
 *   shader's whole budget four times over, and what actually happens is that
 *   every interior on the map goes dark. So every warm thing on a tower — the
 *   lobby's soffit, the lift call panel, the lit floors, the entrance sign, the
 *   obstruction light — is a lens, which costs a mesh that block-merges
 *   with every other emissive in its 48 m block and no slot at all.
 *   `litWindows` is honoured and spends exactly one, for the two or three
 *   towers a layout wants a pool of light at the foot of; no placement states
 *   it, so the map's light budget is exactly where it was.
 *
 * ## The podium, which is where a tower meets a person
 *
 * A tower used to be a shaft on a 0.3 m plinth, glazed from the kerb to the
 * parapet on all four bearings, and what was wrong with it was not that it
 * lacked detail. It was that the only part of it a player ever stands next to —
 * the bottom four metres — was the part with nothing on it at all.
 *
 * So the plinth grew into a PODIUM: one or two storeys of a different material,
 * carrying the entrance, the service bay and the signage, with the curtain wall
 * starting at its coping rather than at the ground. **It costs no collider,
 * because it IS the plinth's box** — `w + 0.5` against the plinth's `w + 0.7`,
 * so no layout moves and no street narrows: the solid footprint at body height
 * grows by 0.25 a side, and the drawn base course still stands where the
 * plinth's outer face did. What is genuinely given up is that the plinth's top
 * was walkable (inside `HEIGHT_EPS`, so the nav grid merged it with the terrain
 * rather than spending a slot on it). A 0.3 m step is not cover — `CoverMap`'s
 * low line is over a metre — and no cell centre lands in a 0.35 m ring, so the
 * graph does not notice: what is lost is a step, and what stands there instead
 * is a doorway.
 *
 * ## A tower has a FRONT now, and its doors are shut
 *
 * The other half of reading as a prop was four-fold symmetry — the same
 * elevation on every bearing is the one thing no building has. A placement
 * already carries `rotY`, and the rest of this file already means +Z by "the
 * street" (`buildOffice`'s shopfront, `buildShophouse`'s frontage), so the
 * entrance goes on +Z, the service bay on -Z, and the shaft's own blind service
 * spine on whichever flank the roll picks.
 *
 * **The entrance doors are drawn SHUT, and that is the exact inverse of
 * `buildShophouse`'s rule rather than an exception to it.** There, a door on an
 * opening a body walks through is drawn open, because a shut-looking door on a
 * way in is the one thing an elevation must not say. Here there is no way in,
 * so a door standing open would be the lie.
 *
 * The lobby glass is not `breakable` for the same reason and by the same test
 * (`PaneSpec.breakable`): there is nothing behind it to get into. It is not
 * `backed` either, and it is the one sheet on a tower that is not — every other
 * pane here hangs on a solid mass and is drawn opaque over that mass's own
 * colour, while this one has a drawn room behind it and the room is what you
 * are meant to see. It costs no reflection probe: `ReflectionSystem` mints one
 * per glazed BLOCK, and the curtain wall already put one on every block a
 * tower stands in.
 *
 * ## The skin is still chosen by the HEIGHT, and now so is everything else
 *
 * Under `BRICK_CEILING` it is older low stock in brick; over it, a curtain wall
 * on a stone podium, with a plant floor of louvres somewhere up the shaft and a
 * crown the roll picks from three. One number, two kinds of building, and no
 * way to ask for a fifty-metre brick warehouse by accident. What each of them
 * is drawn AS — and that it is all drawing, emitted before the masses it lies
 * on and none of it a collider — is `drawTower`'s.
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
  /** This placement's stable variation. See `towerRoll`. */
  const roll = (salt: number): number => towerRoll(w, d, h, salt);

  /**
   * One storey under a brick block or a short shaft, two under a tall one, and
   * always a whole number of them, so the coping lands on a floor line and the
   * storeys above carry on the same rhythm. Clamped so a six-metre tower is not
   * all podium.
   */
  const podH = Math.min(
    (brick || h < 26 ? 1 : 2) * STOREY,
    Math.max(2.4, h - 2.4),
  );
  const pw = w + 0.5;
  const pd = d + 0.5;
  /**
   * Dressed stone under a curtain wall, a cooler stone course under brick —
   * and in both cases LIGHTER than what stands on it. See `ASHLAR`: a base in
   * the shaft's own dark grey is not a base, it is a hole across the whole
   * frontage at exactly the height a player's eye is.
   */
  const podSkin = brick ? STONE : ASHLAR;
  /** How deep the entrance is cut into the +Z elevation's DRAWING. */
  const recess = Math.min(2.8, Math.max(1.5, d * 0.14));
  /** The entrance bay: wide enough to read from across a street, never a slot. */
  const openW = Math.min(8.4, Math.max(4.2, pw * 0.34));
  const openH = Math.min(podH - 0.9, 4.2);
  /**
   * Where the entrance sits along the frontage. Centred on a narrow podium
   * because there is nowhere else for it to go; off-centre on a wide one, which
   * is what stops a block face of these reading as one building repeated with
   * all its doors in a line.
   */
  const ex = (roll(3) - 0.5) * Math.max(0, pw - openW - 5);
  /** The lobby's back wall, and the centre of the slice the piers stand in. */
  const zBack = pd / 2 - recess;
  const zFront = zBack + recess / 2;
  const pierL = ex - openW / 2 + pw / 2;
  const pierR = pw / 2 - (ex + openW / 2);
  /**
   * The shaft, and the setback above it. Two masses rather than one is what
   * stops a row of these reading as a row of crates: the upper one is inset, so
   * the skyline steps.
   */
  const setback = brick ? 0 : Math.round(h * 0.34);
  const lower = h - setback;
  const sw = w * 0.76;
  const sd = d * 0.76;
  const shaftH = Math.max(0.4, lower - podH);

  // --- the drawing, FIRST ---------------------------------------------------
  //
  // Everything on a tower that is not a mass. It emits no colliders, so where
  // it is called cannot move one; it is called before the masses it lies on
  // because the part merge keeps emission order, and a facing drawn first is
  // what lets the depth test reject the wall face behind it rather than shade
  // it twice.
  drawTower(b, {
    w,
    d,
    h,
    brick,
    skin,
    podSkin,
    podH,
    pw,
    pd,
    recess,
    openW,
    openH,
    ex,
    zBack,
    zFront,
    pierL,
    pierR,
    lower,
    sw,
    sd,
    setback,
    roll,
    sign: p.sign,
    litWindows: p.litWindows,
  });

  // --- the masses, and the three colliders ---------------------------------
  //
  // The podium's one collider is the plain mass, full depth, no notch;
  // everything else on the podium is drawn inside it. The drawn mass is drawn
  // back from the frontage by the lobby's depth, and the +Z elevation returned
  // round the opening as two piers and a head — four boxes where a podium would
  // be one, and the notch they leave between them is the room.
  b.block({ w: pw, h: podH, d: pd, x: 0, y: podH / 2, z: 0 });
  b.box(pw, podH, pd - recess, 0, podH / 2, -recess / 2, podSkin);
  if (pierL > 0.05) {
    b.box(pierL, podH, recess, -pw / 2 + pierL / 2, podH / 2, zFront, podSkin);
  }
  if (pierR > 0.05) {
    b.box(pierR, podH, recess, pw / 2 - pierR / 2, podH / 2, zFront, podSkin);
  }
  b.box(openW, podH - openH, recess, ex, openH + (podH - openH) / 2, zFront, podSkin);
  b.box(w, shaftH, d, 0, podH + shaftH / 2, 0, skin);
  b.block({ w, h: shaftH, d, x: 0, y: podH + shaftH / 2, z: 0 });
  if (setback > 0) {
    b.box(sw, setback, sd, 0, lower + setback / 2, 0, skin);
    b.block({ w: sw, h: setback, d: sd, x: 0, y: lower + setback / 2, z: 0 });
  }
  return b;
}

/** Everything `drawTower` reads off `buildTower`'s plan. */
interface TowerPlan {
  w: number;
  d: number;
  h: number;
  brick: boolean;
  skin: string;
  podSkin: string;
  podH: number;
  pw: number;
  pd: number;
  recess: number;
  openW: number;
  openH: number;
  ex: number;
  zBack: number;
  zFront: number;
  pierL: number;
  pierR: number;
  lower: number;
  sw: number;
  sd: number;
  setback: number;
  roll: (salt: number) => number;
  sign?: string;
  litWindows?: boolean;
}

/**
 * Everything on a tower that is DRAWING, and what it draws it as. It emits no
 * collider, so every box a tower is made of is exactly where it was (`npm run
 * kit:hash`); and every part obeys one of the three rules a drawing on a
 * collider may take (`model-detail` skill) — FLAT on a face (the cladding, the
 * frames, the doors), LOW enough to walk over (the base course, the wheel
 * guards), or OVER reach, which is everything from the podium's coping up.
 *
 * ## The curtain wall: three systems, because a skyline is what these are FOR
 *
 * It read as a sheet of graph paper on a box: panels between collars and fins,
 * the same on every tower, so thirty-seven of them were one texture. A curtain
 * wall is a SYSTEM — how its glass is held and what covers the floor edge —
 * and the roll picks one of the three a downtown is actually built of:
 *
 * - **Ribbon** — precast spandrel bands across the floor edges, ribbons of
 *   glass between them, slim mullions. Horizontal, and the pale band is the
 *   thing catching the sun.
 * - **Grid** — a stick system: continuous aluminium mullions standing proud,
 *   transoms set back from them, dark spandrel panels flush with the glass,
 *   and deeper fins on the structural bays. Vertical, and a dark glass box
 *   with a silver grid on it.
 * - **Columns** — an expressed frame: deep precast column covers on the bay
 *   lines, recessed spandrels between them, glass behind both.
 *
 * **Every one of them reads by DEPTH, which is the only thing the ink draws**:
 * glass 10 cm off the mass, a transom 8 cm off that, a mullion 14, a fin 32, a
 * column cover half a metre — so each layer is a step, and the system is
 * legible as how far out each member stands rather than as a colour. The
 * mullions are one box the height of the mass rather than one a floor, drawn
 * behind the bands and spandrels that cross them, so the module costs a few
 * dozen boxes a tower rather than a thousand.
 *
 * Three things still break each grid's own regularity: one band of LOUVRES
 * where the plant floor is, the blind service SPINE up one flank (its own
 * pilaster now, jointed per storey, with the stair's slot window in each), and
 * the storeys whose lights are on — lit a module at a time, a third of the
 * floors at two modules in five, which is the share that was photographed down
 * to in `ROOM_GLOW`.
 *
 * ## The podium: stone that is laid, not a slab that is painted
 *
 * Faced in big jointed slabs laid broken-joint over the mass, the bay piers
 * cased in the same stone 16 cm proud, and every window set in an architrave
 * with a deeper sill — the office's ground floor at a tower's scale, and the
 * same finding behind it: a joint is a step the ink draws, and a base with
 * none is a black rectangle at eye height. The entrance gets a portal, heavier
 * stone than anything round it; the canopy its downlights; the lobby its
 * panelling, its directory and a desk with something on it. The rear keeps its
 * four service things and is laid in the same stone round them.
 *
 * ## The brick stock: an interwar commercial block
 *
 * It read as a red box with framed rectangles on it. It is drawn now as what a
 * twelve-to-sixteen-metre brick building of that age is: brick piers rising
 * between wide steel windows — a grid of glazing bars, under a stone lintel
 * with a keystone and over a stone sill — brick spandrels with a stone tablet,
 * a frieze, a corbelled cornice on a course of dentils, and a parapet with a
 * raised name panel over the front. The storey height is fitted to the
 * building rather than to `STOREY`, which is what loft floors are. The party
 * walls get corner pilasters, tie plates, a downpipe, bricked-up openings and
 * the ghost sign; the fire escape, the windows it serves at every landing (a
 * fire escape on a blank wall is a stair to nowhere); and the shopfront under
 * all of it is painted timber on stone pilasters.
 *
 * ## The crowns
 *
 * The same three, each now dressed as what it is: the lift motor room with a
 * door, a lamp, a louvre and a ladder beside an air handler and its
 * condensers; the stepped crown with the system's fins carried up it and a lit
 * band under each cap; the water tank hooped and roofed on a braced frame. A
 * tall roof also carries its window-cleaning machine — a track round the
 * parapet, the carriage, the jib and the cradle parked beside it — which is
 * the thinnest thing on the skyline and the one a roof most obviously has. A
 * brick roof gets a timber water tank on a steel stand.
 *
 * ## What it is drawn WITH
 *
 * A couple of thousand boxes, every one of them written into one surface per
 * colour (`StoneBatch`); the lenses into one emissive per colour, the lit
 * floors into one more that is drawn over the glass (`flushGlow`'s
 * `overGlass`). **No colour is new**: everything is a colour a tower already
 * wore, so a block a tower stands in draws exactly the materials it drew
 * before. The base course and the masses stay ordinary parts, because the
 * grass mask records a structure's PARTS to keep blades out of it and skips
 * a batch, whose bounds are a batch's rather than a shape's.
 *
 * Variation is the tower's own rolls where they already decided something —
 * the crown, the entrance, the spine, the lit floors — plus one for the
 * system (`towerRoll` salt 41) and one for the cleaning machine, and a stream
 * off the params for the per-bay decisions nobody needs to find again.
 */
function drawTower(b: Build, t: TowerPlan): void {
  const { w, d, h, brick, skin, podSkin, podH, pw, pd, roll } = t;
  const { recess, openW, openH, ex, zBack, zFront, pierL, pierR } = t;
  const { lower, sw, sd, setback } = t;
  const sb = new StoneBatch();
  /** Lenses on something solid. */
  const lens = new StoneBatch();
  /** Lenses hung in front of a `backed` sheet, which owe `overGlass`. */
  const lensG = new StoneBatch();
  const rnd = mulberry32(streetSeed(w, d, h));
  const SIDES: readonly Side[] = ["+z", "-z", "-x", "+x"];
  /** The joint between two slabs, two panels or two segments. */
  const J = 0.025;

  /**
   * Which flank carries the shaft's service spine — the blind slot the lifts
   * and the risers are behind, and the one thing that stops a curtain wall
   * being the same elevation four times over.
   */
  const spine: -1 | 1 = roll(11) > 0.5 ? 1 : -1;
  /**
   * Whether this building's lights are on, which is a claim about the BUILDING
   * rather than about the hour: at dusk some towers are working and some are
   * shut, and a skyline with every window lit is the same mistake as one with
   * none. `litWindows: false` says "this one is dark" outright.
   */
  const lit = t.litWindows !== false && roll(12) > 0.34;

  /** The outer face plane of side `s` of a centred `mw` x `md` mass. */
  const planeOf = (s: Side, mw: number, md: number): number => (runsAlongX(s) ? md : mw) / 2;
  /** That side's length between its corners. */
  const lenOf = (s: Side, mw: number, md: number): number => (runsAlongX(s) ? mw : md);
  /** A box laid on face `s` at `plane`, its centre `out` off the plane. */
  const lay = (
    s: Side,
    plane: number,
    u: number,
    y: number,
    along: number,
    tall: number,
    thick: number,
    out: number,
    color: string,
    hide = 0,
  ): void => sb.onFace(s, plane, u, y, along, tall, thick, out, color, 0, 0, hide);
  /** A sheet of glass laid on a face. */
  const paneOn = (
    s: Side,
    plane: number,
    u: number,
    y: number,
    along: number,
    tall: number,
    thick: number,
    out: number,
    backed: string,
  ): void => {
    const c = outward(s) * (plane + out);
    if (runsAlongX(s)) b.pane(along, tall, thick, u, y, c, { backed });
    else b.pane(thick, tall, along, c, y, u, { backed });
  };
  /**
   * A louvre blade along face `s`, its outer edge tipped DOWN by `tip`. A blade
   * running along X turns about X and one along Z about Z, and the sign is the
   * face's: a positive x-turn tips +Z down, a positive z-turn tips -X down.
   */
  const blade = (
    s: Side,
    plane: number,
    u: number,
    y: number,
    along: number,
    wide: number,
    out: number,
    color: string,
    tip: number,
  ): void => {
    const n = outward(s);
    const c = n * (plane + out);
    // Its two ends are in the frame it spans.
    if (runsAlongX(s)) sb.box(along, 0.03, wide, u, y, c, color, { x: n * tip }, 1 | 2);
    else sb.box(wide, 0.03, along, c, y, u, color, { z: -n * tip }, 16 | 32);
  };
  /**
   * Coursed slabs over `[u0, u1] x [y0, y1]` of a face, laid broken-joint and
   * round the holes — a slab a hole cuts keeps the parts of itself beside, over
   * and under it, so a window lands on whatever course it lands on and the
   * stone still closes round it.
   */
  const ashlar = (
    s: Side,
    plane: number,
    u0: number,
    u1: number,
    y0: number,
    y1: number,
    holes: readonly Hole[],
    color: string,
    course = 1.45,
    long = 2.4,
    thick = 0.06,
  ): void => {
    if (u1 - u0 < 0.1 || y1 - y0 < 0.1) return;
    // A slab's back is in the wall and its underside on the one below; its
    // top is only ever seen from under the eye, so a slab over it leaves that
    // out too.
    const slab = (a: number, z: number, c0: number, c1: number): void => {
      if (z - a < 0.1 || c1 - c0 < 0.08) return;
      const hide = hideBack(s) | HIDE_UNDER | (c1 > 2.0 ? HIDE_TOP : 0);
      lay(s, plane, (a + z) / 2, (c0 + c1) / 2, z - a, c1 - c0, thick, thick / 2, color, hide);
    };
    const courses = Math.max(1, Math.round((y1 - y0) / course));
    const ch = (y1 - y0) / courses;
    for (let c = 0; c < courses; c++) {
      const a0 = y0 + c * ch;
      const a1 = a0 + ch - J;
      for (let u = u0 - (c % 2) * (long / 2); u < u1; u += long) {
        const s0 = Math.max(u, u0);
        const s1 = Math.min(u + long - J, u1);
        if (s1 - s0 < 0.1) continue;
        const hit = holes.filter((o) => o.u1 > s0 && o.u0 < s1 && o.y1 > a0 && o.y0 < a1);
        for (const [q0, q1] of carve(s0, s1, hit.map((o): [number, number] => [o.u0, o.u1]))) {
          slab(q0, q1, a0, a1);
        }
        for (const o of hit) {
          const q0 = Math.max(s0, o.u0);
          const q1 = Math.min(s1, o.u1);
          slab(q0, q1, a0, Math.min(a1, o.y0 - J));
          slab(q0, q1, Math.max(a0, o.y1 + J), a1);
        }
      }
    }
  };

  // === the podium ===========================================================

  // The base course: a dark plinth 0.15 proud of the podium, which is where
  // the old plinth's outer face was, and at ankle height a proud visual takes
  // the latitude a step does. A PART rather than a batched box, so the grass
  // mask still finds the tower's foot.
  b.box(pw + 0.3, 0.34, pd + 0.3, 0, 0.17, 0, DARK_CONCRETE);
  {
    const BASE = 0.34;
    /** The underside of the coping, where the stone stops. */
    const corn = podH - 0.15;
    const rib = 0.6;
    const pierOut = 0.16;
    const storeys = podH > STOREY * 1.5 ? 2 : 1;
    /** Bronze-dark frames in a stone base; a painted timber shopfront under brick. */
    const frameC = brick ? TEAK : DARK_CONCRETE;
    /** Storey `k`'s window head and sill. A shopfront is deeper and lower. */
    const win = (k: number): [number, number] => {
      const base = k * STOREY;
      const y0 = base + (k === 0 ? (brick ? 0.7 : 0.75) : 0.95);
      const y1 = Math.min(corn - (brick && k === 0 ? 0.75 : 0.35), base + (k === 0 ? 3.0 : STOREY - 0.5));
      return [y0, y1];
    };
    /** The entrance's portal, which every elevation's stone stops at. */
    const portal = 0.5;
    const portalHole: Hole = {
      u0: ex - openW / 2 - portal,
      u1: ex + openW / 2 + portal,
      y0: -1,
      y1: openH + 0.35,
    };

    // The service bay's plan, read twice: by the stone it stops, and by what
    // is drawn in it further down.
    const zs = -pd / 2;
    const shutW = Math.min(4.6, pw * 0.3);
    const shutH = Math.min(3.6, podH - 0.5);
    const sx = (roll(7) - 0.5) * Math.max(0, pw - shutW - 6);
    const away = sx > 0 ? -1 : 1;
    /** Nothing on the service elevation may hang off the end of it. */
    const onRear = (x: number, half: number): number =>
      Math.max(-pw / 2 + half, Math.min(pw / 2 - half, x));
    const sdx = onRear(sx + away * (shutW / 2 + 1.4), 0.8);
    const gx = onRear(sx - away * (shutW / 2 + 1.6), 2.5);
    const mx = onRear(sdx + away * 1.5, 0.6);
    const serviceHoles: Hole[] = [
      { u0: sx - shutW / 2 - 0.25, u1: sx + shutW / 2 + 0.25, y0: -1, y1: shutH + 0.3 },
      { u0: sdx - 0.75, u1: sdx + 0.75, y0: -1, y1: 2.55 },
      { u0: gx - 1.0, u1: gx + 1.0, y0: podH - 1.9, y1: podH - 0.5 },
      { u0: mx - 0.5, u1: mx + 0.5, y0: 0.5, y1: 1.7 },
    ];

    /**
     * A window in a stone bay: the sheet set back in its frame, the frame's
     * lights, an architrave of the same stone standing proud round it and a
     * deeper sill under it — four depths, so the opening reads as a hole in
     * the stone rather than a dark rectangle laid on it.
     */
    const stoneWindow = (s: Side, plane: number, u0: number, u1: number, y0: number, y1: number, k: number): void => {
      const um = (u0 + u1) / 2;
      const ym = (y0 + y1) / 2;
      const ow = u1 - u0;
      const oh = y1 - y0;
      const hb = hideBack(s);
      paneOn(s, plane, um, ym, ow, oh, 0.04, 0.02, podSkin);
      // A member that butts into another at both ends leaves those faces out:
      // a post its top and foot, a rail its two ends.
      const post = hb | HIDE_TOP | HIDE_UNDER;
      const rail = hb | hideEnds(s);
      for (const e of [-1, 1]) lay(s, plane, um + e * (ow / 2 + 0.09), ym + 0.04, 0.18, oh + 0.08, 0.12, 0.06, podSkin, post);
      lay(s, plane, um, y1 + 0.09, ow + 0.36, 0.18, 0.12, 0.06, podSkin, hb);
      lay(s, plane, um, y0 - 0.07, ow + 0.44, 0.14, 0.18, 0.09, podSkin);
      lay(s, plane, um, y1 - 0.04, ow, 0.08, 0.08, 0.04, frameC, rail);
      lay(s, plane, um, y0 + 0.05, ow, 0.1, 0.08, 0.04, frameC, rail);
      const lights = Math.max(1, Math.round(ow / 1.5));
      for (let j = 0; j <= lights; j++) {
        const u = Math.max(u0 + 0.04, Math.min(u1 - 0.04, u0 + (j / lights) * ow));
        lay(s, plane, u, ym, j === 0 || j === lights ? 0.08 : 0.06, oh, 0.08, 0.04, frameC, post);
      }
      if (k === 0 && oh > 1.8) lay(s, plane, um, y0 + oh * 0.76, ow, 0.07, 0.08, 0.04, frameC, rail);
    };

    for (const s of SIDES) {
      const span = lenOf(s, pw, pd);
      const plane = planeOf(s, pw, pd);
      const xs = runsAlongX(s);
      const front = s === "+z";
      const rear = s === "-z";
      const n = Math.max(2, Math.round(span / 5.5));
      const pitch = span / n;
      const holes: Hole[] = [];
      if (front) holes.push(portalHole);
      if (rear) holes.push(...serviceHoles);
      /**
       * Pier `i`'s span along the elevation. The corner piers on the two Z
       * elevations wrap the corner, over the thickness of the flank's own
       * corner pier, so the stone closes round it.
       */
      const pierAt = (i: number): [number, number] => {
        if (i === 0) return [-span / 2 - (xs ? pierOut : 0), -span / 2 + rib];
        if (i === n) return [span / 2 - rib, span / 2 + (xs ? pierOut : 0)];
        const c = -span / 2 + i * pitch;
        return [c - rib / 2, c + rib / 2];
      };
      const piers: [number, number][] = [];
      for (let i = 0; i <= n; i++) {
        const [u0, u1] = pierAt(i);
        if (front && u1 > portalHole.u0 - 0.3 && u0 < portalHole.u1 + 0.3) continue;
        if (rear && serviceHoles.some((o) => u1 > o.u0 - 0.1 && u0 < o.u1 + 0.1)) continue;
        piers.push([u0, u1]);
        holes.push({ u0, u1, y0: -1, y1: corn + 1 });
      }
      // The bays' windows, on the three public bearings. The back is the
      // service elevation and has its own four things on it; a building glazed
      // the whole way round at street level has no back.
      if (!rear) {
        for (let i = 0; i < n; i++) {
          const L = pierAt(i)[1];
          const R = pierAt(i + 1)[0];
          const u0 = L + 0.22;
          const u1 = R - 0.22;
          if (u1 - u0 < 1.0) continue;
          if (front && u1 + 0.5 > portalHole.u0 && u0 - 0.5 < portalHole.u1) continue;
          for (let k = 0; k < storeys; k++) {
            const [y0, y1] = win(k);
            if (y1 - y0 < 0.9) continue;
            stoneWindow(s, plane, u0, u1, y0, y1, k);
            holes.push({ u0: u0 - 0.18, u1: u1 + 0.18, y0: y0 - 0.14, y1: y1 + 0.18 });
            // A shopfront's FASCIA, the painted board a brick block's ground
            // floor carries its name on, between the head and the coping.
            if (brick && k === 0 && corn - y1 > 0.45) {
              const fy0 = y1 + 0.2;
              lay(s, plane, (L + R) / 2, (fy0 + corn - 0.04) / 2, R - L, corn - 0.04 - fy0, 0.1, 0.05, frameC, hideBack(s));
              lay(s, plane, (L + R) / 2, corn - 0.07, R - L, 0.06, 0.16, 0.08, frameC);
              holes.push({ u0: L, u1: R, y0: y1 + 0.18, y1: corn + 1 });
            }
          }
        }
      }
      // The stone itself, round everything above.
      ashlar(s, plane, -span / 2, span / 2, BASE, corn, holes, podSkin);
      // The piers, cased in the same stone 16 cm proud and jointed every
      // course; a shopfront's carry a capital at the fascia line.
      for (const [u0, u1] of piers) {
        const courses = Math.max(1, Math.round((corn - BASE) / 1.45));
        const ch = (corn - BASE) / courses;
        for (let c = 0; c < courses; c++) {
          const y = BASE + c * ch + (ch - J) / 2;
          const hide = hideBack(s) | HIDE_UNDER | (y + ch / 2 > 2.0 ? HIDE_TOP : 0);
          lay(s, plane, (u0 + u1) / 2, y, u1 - u0, ch - J, pierOut, pierOut / 2, podSkin, hide);
        }
        if (brick) lay(s, plane, (u0 + u1) / 2, corn - 0.2, u1 - u0 + 0.14, 0.24, pierOut + 0.07, (pierOut + 0.07) / 2, podSkin);
      }
    }

    // The string at the storey line, on a base deep enough to have one. It is
    // what turns a seven-metre mass into two courses, and it lands on `STOREY`
    // so the podium and the shaft above it are read on one rhythm.
    if (storeys > 1) sb.box(pw + 0.3, 0.26, pd + 0.3, 0, STOREY, 0, podSkin);
    // The coping, a metal flashing over it, and a dark reglet under it: the
    // ledge the shaft rises out of, and three lines where there was one.
    sb.box(pw + 0.24, 0.5, pd + 0.24, 0, podH + 0.1, 0, podSkin);
    sb.box(pw + 0.32, 0.05, pd + 0.32, 0, podH + 0.375, 0, ALLOY);
    sb.box(pw + 0.14, 0.08, pd + 0.14, 0, podH - 0.19, 0, DARK_CONCRETE, undefined, HIDE_UNDER);

    // --- the entrance: a portal, the screen, a shut door, a canopy ---------
    {
      const zf = pd / 2;
      const hb = hideBack("+z");
      // The portal: heavier stone than anything round it, 20 cm proud, so the
      // entrance is the deepest thing on the elevation as well as the widest.
      for (const k of [-1, 1]) {
        sb.box(portal, openH + 0.35, 0.2, ex + k * (openW / 2 + portal / 2), (openH + 0.35) / 2, zf + 0.1, podSkin, undefined, hb);
      }
      sb.box(openW + 2 * portal, 0.35, 0.2, ex, openH + 0.175, zf + 0.1, podSkin, undefined, hb);
      sb.box(openW + 2 * portal + 0.1, 0.06, 0.26, ex, openH + 0.38, zf + 0.13, ALLOY);

      const sill = 0.14;
      const gh = openH - sill - 0.24;
      const mull = 0.16;
      const bays = Math.max(2, Math.round(openW / 2.6));
      const pitch = openW / bays;
      // Unbacked — the one sheet on a tower that is. See `buildTower`.
      for (let i = 0; i < bays; i++) {
        const cx = ex - openW / 2 + (i + 0.5) * pitch;
        b.pane(pitch - mull, gh, 0.1, cx, sill + gh / 2, zf);
      }
      for (let i = 0; i <= bays; i++) {
        const cx = ex - openW / 2 + i * pitch;
        sb.box(mull, gh + 0.2, 0.2, cx, sill + gh / 2, zf + 0.03, ALLOY);
      }
      sb.box(openW + 0.4, 0.28, 0.3, ex, openH - 0.14, zf + 0.03, ALLOY);
      sb.box(openW + 0.4, 0.2, 0.42, ex, 0.1, zf + 0.04, DARK_CONCRETE);

      // The doors, SHUT — the inverse of the shophouse's rule, for the reason
      // in `buildTower`'s header. Two leaves with their meeting stiles together
      // in the middle, a transom over them, a kick plate and a pull on each.
      const dw = 2.3;
      const dh = Math.min(2.45, gh - 0.1);
      for (const s of [-1, 1]) {
        sb.box(0.1, dh, 0.14, ex + (s * dw) / 2, sill + dh / 2, zf + 0.06, ALLOY);
        sb.box(0.07, dh, 0.14, ex + s * 0.05, sill + dh / 2, zf + 0.06, ALLOY);
        sb.box(dw / 2 - 0.1, 0.09, 0.14, ex + (s * dw) / 4, sill + dh - 0.05, zf + 0.06, ALLOY);
        sb.box(dw / 2 - 0.1, 0.18, 0.14, ex + (s * dw) / 4, sill + 0.09, zf + 0.06, ALLOY);
        sb.box(dw / 2 - 0.2, 0.22, 0.02, ex + (s * dw) / 4, sill + 0.3, zf + 0.14, ALLOY);
        sb.box(0.05, 1.0, 0.05, ex + s * 0.26, sill + 1.06, zf + 0.15, ALLOY);
        for (const e of [-1, 1]) sb.box(0.04, 0.04, 0.1, ex + s * 0.26, sill + 1.06 + e * 0.42, zf + 0.1, ALLOY);
      }
      if (gh - dh > 0.4) sb.box(openW, 0.1, 0.16, ex, sill + dh + 0.05, zf + 0.04, ALLOY);
      // A mat inside the doors, 2 cm over the lobby floor.
      sb.box(dw + 0.6, 0.02, 1.2, ex, 0.15, zf - 0.75, DARK_CONCRETE);

      // The canopy — what says ENTRANCE from sixty metres, and the one thing on
      // the podium that projects. It hangs at `openH`, which is over reach, so
      // nothing walks through it. Two tie rods back to the wall, because a slab
      // standing two metres off a building with nothing holding it up reads as
      // a mistake; downlights under it, because a canopy is what lights a door.
      const proj = Math.min(2.1, recess + 0.7);
      const cy = openH + 0.46;
      sb.box(openW + 1.7, 0.22, proj, ex, cy, zf + proj / 2 - 0.15, ALLOY);
      sb.box(openW + 1.7, 0.42, 0.16, ex, cy - 0.06, zf + proj - 0.22, DARK_CONCRETE);
      sb.box(openW + 1.7, 0.08, 0.06, ex, cy + 0.19, zf + proj - 0.17, ALLOY);
      for (const s of [-1, 1]) sb.box(0.16, 0.42, proj - 0.16, ex + s * (openW / 2 + 0.77), cy - 0.06, zf + proj / 2 - 0.22, DARK_CONCRETE);
      {
        const lamps = Math.max(2, Math.round((openW + 1.2) / 1.6));
        for (let i = 0; i < lamps; i++) {
          const lx = ex - (openW + 1.2) / 2 + ((i + 0.5) * (openW + 1.2)) / lamps;
          lens.box(0.32, 0.02, 0.32, lx, cy - 0.12, zf + proj * 0.42, WINDOW_LIGHT);
        }
      }
      {
        // The ties end where there is WALL: on the podium's stone under its
        // coping, or over the coping on the face of the shaft above it.
        const rise = 1.35;
        const zt = cy + rise > podH - 0.15 ? d / 2 + 0.2 : zf + 0.06;
        const reach = zf + proj - 0.25 - zt;
        const len = Math.hypot(reach, rise);
        for (const s of [-1, 1]) {
          const tx = ex + s * (openW / 2 + 0.6);
          // Negative: a positive `rotation.x` tips local +Y toward +Z, and the
          // TOP of a tie is the end against the wall. Positive here draws a
          // strut rising to a point in mid-air off the canopy's outer edge,
          // which is the same three boxes and reads as a mistake.
          sb.box(0.07, len, 0.07, tx, cy + rise / 2, zt + reach / 2, ALLOY, { x: -Math.atan2(reach, rise) });
          sb.box(0.22, 0.22, 0.04, tx, cy + rise, zt + 0.02, ALLOY);
        }
      }
      // The name band on the fascia. A board either way; naming a colour is
      // what lights its FACE, which is `buildShophouse`'s reading of `sign` —
      // a `flicker` is only visible on a light, and this is a lens.
      if (t.sign) lens.box(openW * 0.66, 0.24, 0.03, ex, cy - 0.06, zf + proj - 0.125, t.sign);
      // The street number, on whichever pier is the wider of the two, on a
      // plate over the stone.
      if (Math.max(pierL, pierR) > 1.2) {
        const numX = pierL > pierR ? -pw / 2 + pierL / 2 : pw / 2 - pierR / 2;
        sb.box(0.5, 0.62, 0.04, numX, 2.5, zf + 0.08, ALLOY);
        sb.box(0.36, 0.44, 0.02, numX, 2.5, zf + 0.11, DARK_CONCRETE);
      }

      // One light, and only where a layout spends it. See the file header on
      // the budget: this is a pool of light on the pavement at a tower a round
      // is fought around, not something thirty-seven buildings each get.
      if (t.litWindows) {
        b.light(WINDOW_LIGHT, 13, 0.7, 0.02, ex, openH - 0.5, zBack + recess * 0.6);
      }
    }

    // --- the lobby, drawn in the notch -------------------------------------
    //
    // It takes NO occlusion from the mass it is standing inside: `occlusionAt`
    // skips an occluder its sample point is within (`r < SELF`), so a room cut
    // into a collider is shaded as though it were out on the pavement. That is
    // the file header's "bright plate under a black lid" with the lid missing
    // too, and the lit fittings are what answer it — one bright thing in a dark
    // hole is what a lobby looks like from a street at dusk anyway.
    {
      sb.box(openW, 0.14, recess, ex, 0.07, zFront, RENDER);
      // The soffit, and the FITTINGS in it rather than a lit ceiling: the
      // first cut glowed the whole soffit and the bloom took it to a flat white
      // rectangle with no lobby behind it. Two strips and the beams between
      // them read as downlighting because they are.
      sb.box(openW, 0.18, recess, ex, openH - 0.09, zFront, DARK_CONCRETE);
      for (let i = 1; i < 4; i++) {
        sb.box(0.12, 0.16, recess, ex - openW / 2 + (i / 4) * openW, openH - 0.26, zFront, DARK_CONCRETE);
      }
      for (const s of [-1, 1]) {
        lens.box(openW - 1.4, 0.05, 0.3, ex, openH - 0.21, zFront + s * recess * 0.22, WINDOW_LIGHT);
      }
      // The lift lobby on the back wall, which is the thing that says there is
      // a building over this rather than a shop: two cars in steel frames, a
      // call panel and the floor indicator over each.
      sb.box(openW, openH, 0.14, ex, openH / 2, zBack + 0.07, DARK_CONCRETE);
      const liftH = Math.min(2.3, openH - 0.5);
      for (const s of [-1, 1]) {
        const lx = ex + s * 0.92;
        sb.box(1.32, liftH + 0.12, 0.04, lx, (liftH + 0.12) / 2, zBack + 0.16, ALLOY);
        for (const e of [-1, 1]) sb.box(0.54, liftH, 0.04, lx + e * 0.28, liftH / 2, zBack + 0.2, ALLOY);
        lens.box(0.4, 0.08, 0.03, lx, liftH + 0.32, zBack + 0.16, ROOM_GLOW);
      }
      lens.box(0.08, 0.16, 0.05, ex, liftH * 0.5, zBack + 0.2, WINDOW_LIGHT);
      // Panelling on the back wall either side of the cars: timber battens, the
      // one warm material in the base, and what the lobby reads as from across
      // the street once it is lit.
      for (const s of [-1, 1]) {
        const a = ex + s * 1.7;
        const z = ex + (s * openW) / 2;
        const lo = Math.min(a, z);
        const hi = Math.max(a, z);
        for (let u = lo + 0.2; u < hi - 0.1; u += 0.32) {
          sb.box(0.16, openH - 0.5, 0.04, u, (openH - 0.5) / 2 + 0.14, zBack + 0.16, TEAK);
        }
      }
      // The directory on one side wall, which faces the doors.
      {
        const dx = ex - openW / 2 + 0.03;
        sb.box(0.04, 1.2, Math.min(1.1, recess - 0.5), dx, 1.5, zFront, ALLOY);
        for (let r = 0; r < 5; r++) sb.box(0.02, 0.1, Math.min(0.9, recess - 0.7), dx + 0.03, 1.15 + r * 0.18, zFront, podSkin);
      }
      // The desk, set back and to one side so that the way past it reads, with
      // a stone front, a screen and a lamp on it.
      const deskW = Math.max(2.2, openW * 0.4);
      const deskX = ex - openW * 0.16;
      sb.box(deskW, 1.02, 0.62, deskX, 0.65, zBack + 1.05, TEAK);
      sb.box(deskW - 0.1, 0.8, 0.03, deskX, 0.62, zBack + 1.375, podSkin);
      sb.box(deskW + 0.18, 0.08, 0.76, deskX, 1.2, zBack + 1.05, ALLOY);
      sb.box(0.5, 0.32, 0.04, deskX - deskW * 0.2, 1.42, zBack + 0.9, DARK_CONCRETE);
      lens.box(0.18, 0.06, 0.18, deskX + deskW * 0.3, 1.27, zBack + 0.95, WINDOW_LIGHT);
      // A bench against the far pier. It is the only thing in here at a
      // person's scale, which is what gives the rest of it one.
      sb.box(1.5, 0.1, 0.44, ex + openW * 0.3, 0.55, zBack + 0.75, TEAK);
      for (const s of [-1, 1]) {
        sb.box(0.08, 0.4, 0.4, ex + openW * 0.3 + s * 0.68, 0.34, zBack + 0.75, ALLOY);
      }
    }

    // --- the service side, on -Z -------------------------------------------
    //
    // The back of a building is the other half of it having a front. A shutter,
    // a door beside it, an extract grille and a riser, and a meter cupboard:
    // flat things on a wall, every one of them drawn on the elevation rather
    // than standing off it, and between them the reason a player who has
    // walked round the block knows which way they are facing.
    {
      const hb = hideBack("-z");
      // The shutter, drawn SHUT in its frame: guide channels, eight slats, and
      // a wheel guard either side at the foot, low enough to step over.
      sb.box(shutW + 0.4, shutH + 0.3, 0.16, sx, (shutH + 0.3) / 2, zs - 0.08, DARK_CONCRETE, undefined, hb);
      sb.box(shutW, shutH, 0.1, sx, shutH / 2, zs - 0.17, RUST, undefined, hb);
      for (let i = 1; i < 9; i++) sb.box(shutW, 0.06, 0.05, sx, (i / 9) * shutH, zs - 0.23, DARK_CONCRETE, undefined, hb);
      sb.box(shutW, 0.12, 0.06, sx, 0.1, zs - 0.24, ALLOY, undefined, hb);
      for (const k of [-1, 1]) {
        sb.box(0.1, shutH, 0.14, sx + k * (shutW / 2 + 0.03), shutH / 2, zs - 0.23, ALLOY, undefined, hb);
        sb.box(0.3, 0.24, 0.3, sx + k * (shutW / 2 + 0.35), 0.12, zs - 0.15, DARK_CONCRETE, undefined, HIDE_UNDER);
      }
      sb.box(shutW + 1.6, 0.06, 0.5, sx, 0.03, zs - 0.25, ASPHALT);
      // The service door in its frame, a vent in its foot, the step under it,
      // the lamp over it and the plate beside it.
      sb.box(1.5, 2.55, 0.1, sdx, 1.275, zs - 0.05, DARK_CONCRETE, undefined, hb);
      sb.box(1.1, 2.2, 0.12, sdx, 1.1, zs - 0.11, IRON, undefined, hb);
      for (let i = 0; i < 4; i++) sb.box(0.7, 0.04, 0.03, sdx, 0.3 + i * 0.1, zs - 0.18, DARK_CONCRETE);
      sb.box(0.07, 0.34, 0.06, sdx + 0.38, 1.05, zs - 0.2, ALLOY);
      sb.box(1.5, 0.16, 0.5, sdx, 0.08, zs - 0.25, DARK_CONCRETE);
      sb.box(0.4, 0.14, 0.18, sdx, 2.75, zs - 0.09, ALLOY, undefined, hb);
      lens.box(0.28, 0.04, 0.12, sdx, 2.66, zs - 0.1, WINDOW_LIGHT);
      sb.box(0.36, 0.24, 0.03, sdx - away * 0.95, 1.6, zs - 0.075, ALLOY, undefined, hb);
      // The meter cupboard.
      sb.box(0.9, 1.1, 0.12, mx, 1.1, zs - 0.08, ALLOY, undefined, hb);
      sb.box(0.04, 0.2, 0.05, mx + 0.32, 1.1, zs - 0.16, DARK_CONCRETE);
      // The grille and the riser beside it: the two pieces of plant that are
      // always on the back of a building and never on the front. The grille's
      // blades are tipped, so it is a louvre rather than a striped board.
      sb.box(1.8, 1.2, 0.14, gx, podH - 1.2, zs - 0.07, ALLOY, undefined, hb);
      for (let i = 0; i < 5; i++) blade("-z", pd / 2, gx, podH - 1.68 + i * 0.24, 1.66, 0.18, 0.2, DARK_CONCRETE, 0.6);
      b.cyl(podH - 0.4, 0.16, 0.16, 6, gx + 1.5, (podH - 0.4) / 2, zs - 0.16, RUST);
      for (let y = 0.9; y < podH - 0.6; y += 1.2) sb.box(0.22, 0.05, 0.18, gx + 1.5, y, zs - 0.09, DARK_CONCRETE);
    }
  }

  // === the shaft =============================================================

  if (!brick) {
    /**
     * The curtain wall's SYSTEM — see this function's header. 0 is ribbon, 1
     * grid, 2 expressed columns.
     */
    const system = Math.min(2, Math.floor(roll(41) * 3));
    /** The glass's outer face, off the mass. */
    const GF = 0.1;

    /**
     * One mass's curtain wall, from `y0` to `y1`, and its parapet up to `cap`.
     * The glazing's bands are keyed to `STOREY` as the collars were, so a band
     * is a storey however tall the mass; the bays to the fins' 5.5 m, and the
     * modules to 1.6 m inside a bay.
     */
    const curtain = (mw: number, md: number, y0: number, y1: number, cap: number): void => {
      const tall = y1 - y0 - 0.6;
      if (tall <= 0) return;
      const rows = Math.max(1, Math.round(tall / STOREY));
      const band = tall / rows;
      const foot = y0 + 0.3;
      const head = foot + tall;
      const bayCount = (span: number): number => Math.max(2, Math.round(span / 5.5));
      /**
       * The plant floor. A tower has one and it is never at the top: a band of
       * louvres two thirds of the way up is the cheapest thing there is that
       * says there is machinery in here, and it breaks the glazing's rhythm at
       * a height the eye is already reading.
       */
      const mech = rows >= 5 ? Math.max(1, Math.round(rows * (0.5 + roll(13) * 0.28))) : -1;
      /** Which bay of the spine flank is blind, all the way up. */
      const nzBays = bayCount(md);
      const spineBay = Math.min(nzBays - 1, Math.max(0, Math.round((nzBays - 1) * roll(14))));
      /** The spandrel at the foot of every band: the floor edge it covers. */
      const SP = Math.min(1.05, band * 0.3);
      const fin = 0.26;

      for (const [si, s] of SIDES.entries()) {
        const L = lenOf(s, mw, md);
        const plane = planeOf(s, mw, md);
        const xs = runsAlongX(s);
        const hb = hideBack(s);
        const n = bayCount(L);
        const pitch = L / n;
        const k = Math.max(1, Math.round(pitch / 1.6));
        const mod = pitch / k;
        const blind = !xs && outward(s) === spine ? spineBay : -1;
        /** Bay `i`'s glass, inset from the corners and from the fins. */
        const glassOf = (i: number): [number, number] => [
          -L / 2 + i * pitch + (i === 0 ? 0.6 : fin / 2 + 0.04),
          -L / 2 + (i + 1) * pitch - (i === n - 1 ? 0.6 : fin / 2 + 0.04),
        ];

        for (let r = 0; r < rows; r++) {
          const fb = foot + band * r;
          const vy0 = fb + SP;
          const vy1 = fb + band - 0.04;
          const vh = vy1 - vy0;
          const vm = (vy0 + vy1) / 2;
          // Whether this storey is working late, and how much of it is. Lit
          // floors rather than lit windows: an office keeps its lights on a
          // floor at a time, and scattered ones read as a fault in the drawing.
          const share = lit && towerRoll(w, h, r, 5) > 0.64 ? 0.4 : 0.06;

          if (r === mech) {
            // The plant floor: a dark void behind tipped blades, the whole
            // side's length, with the mullions and fins carried over it.
            lay(s, plane, 0, vm, L - 1.2, vh, 0.14, 0.03, DARK_CONCRETE, hb);
            const slats = Math.max(3, Math.round(vh / 0.3));
            for (let q = 0; q < slats; q++) {
              blade(s, plane, 0, vy0 + ((q + 0.5) / slats) * vh, L - 1.2, 0.24, GF + 0.06, ALLOY, 0.65);
            }
          } else {
            // The glass: one sheet per storey per side, broken only round the
            // spine. The mullions and fins drawn over it are what divide it,
            // so a sheet per bay bought nothing but sheets.
            const runs: [number, number][] =
              blind < 0
                ? [[-L / 2 + 0.6, L / 2 - 0.6]]
                : [
                    [-L / 2 + 0.6, glassOf(blind)[0] - 0.08],
                    [glassOf(blind)[1] + 0.08, L / 2 - 0.6],
                  ];
            for (const [g0, g1] of runs) {
              if (g1 - g0 > 0.2) paneOn(s, plane, (g0 + g1) / 2, vm, g1 - g0, vh, 0.14, 0.03, skin);
            }
            for (let i = 0; i < n; i++) {
              if (i === blind || !lit) continue;
              const [g0, g1] = glassOf(i);
              // The lit rooms, a module at a time, inset inside the module so
              // each keeps a frame of unlit glass round it: a glow filling its
              // own bay is a panel that HAS no bay, and the grid the elevation
              // is read by disappears wherever the lights are on.
              for (let j = 0; j < k; j++) {
                const m0 = Math.max(g0, -L / 2 + i * pitch + j * mod);
                const m1 = Math.min(g1, -L / 2 + i * pitch + (j + 1) * mod);
                if (m1 - m0 < 0.7) continue;
                const mu = (m0 + m1) / 2;
                if (towerRoll(mu, vm, si * 100 + i * 10 + j, 9) >= share) continue;
                lensG.onFace(s, plane, mu, vm, m1 - m0 - 0.4, vh - 0.6, 0.03, GF + 0.02, ROOM_GLOW);
              }
            }
          }

          // What covers this band's floor edge.
          if (system === 0) {
            // Ribbon: a precast band the length of the side, 24 cm off the
            // mass — proud of everything but the spine — and a drip on its
            // head. The Z elevations' bands return over the flanks'.
            lay(s, plane, 0, fb + SP / 2, L + (xs ? 0.48 : 0), SP, 0.24, 0.12, CONCRETE, hb);
            lay(s, plane, 0, fb + SP + 0.02, L + (xs ? 0.56 : 0), 0.04, 0.28, 0.14, ALLOY, hb);
          } else if (system === 1) {
            // Grid: a dark spandrel flush with the glass, and the transoms at
            // the sill and the head of the vision glass, set back from the
            // mullions so the mullions read as the continuous members they are.
            lay(s, plane, 0, fb + SP / 2, L, SP, 0.14, 0.03, DARK_CONCRETE, hb);
            for (const ty of [vy0 + 0.04, vy1 - 0.02]) lay(s, plane, 0, ty, L, 0.08, 0.08, GF + 0.04, ALLOY, hb | hideEnds(s));
          } else {
            // Columns: a recessed precast spandrel between each pair of
            // column covers, and a thin sill on it.
            for (let i = 0; i < n; i++) {
              const a = -L / 2 + i * pitch + 0.35;
              const z = -L / 2 + (i + 1) * pitch - 0.35;
              lay(s, plane, (a + z) / 2, fb + SP / 2, z - a, SP, 0.22, 0.11, CONCRETE, hb);
              lay(s, plane, (a + z) / 2, fb + SP + 0.02, z - a, 0.04, 0.26, 0.13, ALLOY, hb);
            }
          }
        }

        // The parapet zone over the glass, in the system's own cladding, and
        // its coping. NOT backed-off: above the mass its inner face is seen.
        const ph = cap - head;
        if (system === 0) {
          lay(s, plane, 0, head + ph / 2, L + (xs ? 0.48 : 0), ph, 0.24, 0.12, CONCRETE);
        } else if (system === 1) {
          lay(s, plane, 0, head + ph / 2, L + (xs ? 0.28 : 0), ph, 0.14, 0.07, DARK_CONCRETE);
        } else {
          lay(s, plane, 0, head + ph / 2, L + (xs ? 0.44 : 0), ph, 0.22, 0.11, CONCRETE);
        }
        const co = system === 2 ? 0.56 : system === 1 ? 0.46 : 0.34;
        lay(s, plane, 0, cap + 0.06, L + (xs ? 2 * co : 0), 0.12, co + 0.3, (co - 0.3) / 2, ALLOY);

        // The verticals, each one box the height of the mass, with their top
        // and foot left out — each runs from a coping to a coping.
        const post = hb | HIDE_TOP | HIDE_UNDER;
        const vTop = system === 0 ? head : cap;
        const vMid = (foot + vTop) / 2;
        const vH = vTop - foot;
        for (let m = 1; m < n * k; m++) {
          const u = -L / 2 + m * mod;
          const bay = Math.floor(m / k);
          const atFin = m % k === 0;
          if (!atFin && bay === blind) continue;
          if (system === 1) {
            if (atFin) {
              lay(s, plane, u, (foot + cap) / 2, 0.12, cap - foot, 0.32, GF + 0.16, ALLOY, post);
              lay(s, plane, u, (foot + cap) / 2, 0.05, cap - foot, 0.04, GF + 0.34, ALLOY, post);
            } else {
              lay(s, plane, u, (foot + head) / 2, 0.08, head - foot, 0.14, GF + 0.07, ALLOY, post);
            }
          } else if (system === 2 && atFin) {
            lay(s, plane, u, (foot - 0.3 + cap) / 2, 0.7, cap - foot + 0.3, 0.5, 0.25, skin, post);
          } else {
            lay(s, plane, u, (foot + head) / 2, atFin ? 0.12 : 0.07, head - foot, 0.08, GF + 0.04, ALLOY, post);
          }
        }
        // The corners.
        for (const e of [-1, 1]) {
          if (system === 0) {
            const a = xs ? L / 2 + 0.2 : L / 2;
            lay(s, plane, e * (a + L / 2 - 0.6) / 2, vMid, a - (L / 2 - 0.6), vH, 0.2, 0.1, skin, hb);
          } else if (system === 1) {
            const a = xs ? L / 2 + 0.1 : L / 2;
            lay(s, plane, e * (a + L / 2 - 0.6) / 2, (foot + head) / 2, a - (L / 2 - 0.6), head - foot, 0.14, 0.03, DARK_CONCRETE, hb);
            lay(s, plane, e * (L / 2 - 0.3), (foot + cap) / 2, 0.12, cap - foot, 0.32, GF + 0.16, ALLOY, hb);
          } else {
            const a = xs ? L / 2 + 0.5 : L / 2;
            lay(s, plane, e * (a + L / 2 - 0.7) / 2, (foot - 0.3 + cap) / 2, a - (L / 2 - 0.7), cap - foot + 0.3, 0.5, 0.25, skin, hb);
          }
        }

        // The spine: the blind bay, solid the height of the mass, and its
        // pilaster standing proud of it — jointed at every storey, with the
        // stair's slot window in each segment. A slot of solid wall in a
        // curtain reads as a mistake; the same slot with a rib on it, and the
        // stair lit up it a window at a time, reads as a core.
        if (blind >= 0) {
          const [g0, g1] = glassOf(blind);
          const bu = (g0 + g1) / 2;
          lay(s, plane, bu, (foot + head) / 2, g1 - g0 + 0.08, head - foot, 0.16, 0.04, skin, hb);
          const pwid = pitch * 0.62;
          for (let r = 0; r < rows; r++) {
            const fb = foot + band * r;
            lay(s, plane, bu, fb + band / 2, pwid, band - J, 0.3, 0.15, skin, hb);
            const sh = band - 1.3;
            if (sh < 0.8) continue;
            const sy = fb + 0.75 + sh / 2;
            paneOn(s, plane, bu, sy, 0.46, sh, 0.04, 0.32, skin);
            for (const e of [-1, 1]) lay(s, plane, bu + e * 0.27, sy, 0.08, sh + 0.08, 0.06, 0.33, ALLOY, hb);
            lay(s, plane, bu, sy - sh / 2 - 0.06, 0.66, 0.08, 0.1, 0.35, ALLOY);
            if (lit && towerRoll(bu, sy, si, 19) < 0.5) {
              lensG.onFace(s, plane, bu, sy, 0.3, sh - 0.2, 0.02, 0.35, ROOM_GLOW);
            }
          }
        }
      }
    };

    // The shaft from the podium's coping to the terrace, and the setback from
    // the terrace to the roof; each takes its parapet with it.
    curtain(w, d, podH, lower, lower + 0.75);
    if (setback > 0) curtain(sw, sd, lower, h - 0.4, h + 0.65);

    // The terrace the setback leaves, laid in a membrane 4 cm over the mass,
    // with a handrail on its parapet and the condensers on its back.
    if (setback > 0) {
      const y = lower + 0.01;
      for (const k of [-1, 1]) {
        sb.box(w, 0.06, (d - sd) / 2, 0, y, k * (sd / 2 + (d - sd) / 4), ASPHALT, undefined, HIDE_UNDER);
        sb.box((w - sw) / 2, 0.06, sd, k * (sw / 2 + (w - sw) / 4), y, 0, ASPHALT, undefined, HIDE_UNDER);
      }
      const ry = lower + 0.87;
      for (const s of SIDES) {
        const L = lenOf(s, w, d);
        const plane = planeOf(s, w, d) - 0.12;
        const posts = Math.max(2, Math.round(L / 4));
        for (let i = 0; i <= posts; i++) {
          lay(s, plane, -L / 2 + 0.15 + (i / posts) * (L - 0.3), ry + 0.5, 0.05, 1.0, 0.05, 0, ALLOY, HIDE_TOP | HIDE_UNDER);
        }
        lay(s, plane, 0, ry + 1.0, L - 0.2, 0.05, 0.06, 0, ALLOY, hideEnds(s));
        lay(s, plane, 0, ry + 0.5, L - 0.2, 0.03, 0.03, 0, ALLOY, hideEnds(s));
      }
      const ringZ = -(sd / 2 + (d - sd) / 4);
      const units = Math.max(1, Math.min(4, Math.floor(sw / 3.2)));
      for (let i = 0; i < units; i++) {
        const ux = -sw / 2 + ((i + 0.5) * sw) / units;
        sb.box(1.3, 0.9, 1.0, ux, lower + 0.49, ringZ, ALLOY);
        sb.box(1.36, 0.06, 1.06, ux, lower + 0.97, ringZ, DARK_CONCRETE);
        for (let q = 0; q < 4; q++) sb.box(1.2, 0.04, 0.02, ux, lower + 0.2 + q * 0.17, ringZ - 0.51, DARK_CONCRETE);
        b.cyl(0.06, 0.8, 0.8, 10, ux, lower + 1.03, ringZ, DARK_CONCRETE);
      }
    }
  } else {
    drawBrickStock({ b, sb, lens, lensG, rnd, w, d, h, podH, lit, lay, paneOn, roll });
  }

  // === the crown =============================================================
  //
  // Visual only; the shaft's own collider already stops everything at this
  // height. **Three crowns rather than one, chosen by the roll**, because the
  // skyline is what thirty-seven of these are FOR and a skyline of one
  // silhouette repeated is a texture rather than a city. Each is the same three
  // ideas in a different arrangement: something tall and off-centre (the lift
  // overrun), something low and wide (the plant), and something thin against
  // the sky.
  {
    const topW = setback > 0 ? sw : w;
    const topD = setback > 0 ? sd : d;
    const crown = brick ? 3 : Math.min(2, Math.floor(roll(31) * 3));
    const ox = topW * (roll(32) - 0.5) * 0.4;
    const oz = topD * (roll(33) - 0.5) * 0.4;
    // The roof's membrane, 4 cm over the mass and inside the parapet.
    sb.box(topW - (brick ? 0.6 : 0.02), 0.06, topD - (brick ? 0.6 : 0.02), 0, h + 0.01, 0, ASPHALT, undefined, HIDE_UNDER);

    /** A cat ladder up face `s` of a box centred at (cx, cz). */
    const ladder = (x: number, z: number, alongX: boolean, y0: number, y1: number, color: string): void => {
      for (const e of [-1, 1]) {
        if (alongX) sb.box(0.05, y1 - y0, 0.05, x + e * 0.22, (y0 + y1) / 2, z, color);
        else sb.box(0.05, y1 - y0, 0.05, x, (y0 + y1) / 2, z + e * 0.22, color);
      }
      for (let y = y0 + 0.3; y < y1 - 0.1; y += 0.3) {
        if (alongX) sb.box(0.44, 0.03, 0.03, x, y, z, color);
        else sb.box(0.03, 0.03, 0.44, x, y, z, color);
      }
    };

    if (crown === 0) {
      // The lift motor room and the plant beside it: the commonest roof in a
      // city, and the one that reads as a working building. The motor room
      // gets its door with the lamp over it, a louvre and a ladder to its own
      // roof; the plant is an air handler on a plinth, its panels seamed, its
      // condensers on top with their fan guards, and a duct across to the
      // motor room.
      const mw0 = topW * 0.3;
      const md0 = topD * 0.34;
      sb.box(mw0, 3.2, md0, ox, h + 1.6, oz, DARK_CONCRETE);
      sb.box(mw0 + 0.3, 0.2, md0 + 0.3, ox, h + 3.3, oz, ALLOY);
      sb.box(1.0, 2.1, 0.05, ox - mw0 * 0.2, h + 1.09, oz + md0 / 2 + 0.025, ALLOY);
      sb.box(0.05, 0.3, 0.05, ox - mw0 * 0.2 + 0.36, h + 1.05, oz + md0 / 2 + 0.07, DARK_CONCRETE);
      lens.box(0.3, 0.1, 0.08, ox - mw0 * 0.2, h + 2.4, oz + md0 / 2 + 0.05, WINDOW_LIGHT);
      sb.box(0.05, 1.1, md0 * 0.5, ox - mw0 / 2 - 0.025, h + 2.2, oz, ALLOY);
      for (let i = 0; i < 4; i++) blade("-x", -(ox - mw0 / 2), oz, h + 1.78 + i * 0.27, md0 * 0.46, 0.16, 0.06, DARK_CONCRETE, 0.6);
      ladder(ox + mw0 / 2 + 0.06, oz - md0 * 0.25, false, h, h + 3.4, ALLOY);

      const ax = -ox * 0.8;
      const az = -oz;
      const aw = topW * 0.42;
      const ad = topD * 0.24;
      sb.box(aw + 0.2, 0.15, ad + 0.2, ax, h + 0.075, az, DARK_CONCRETE);
      sb.box(aw, 1.35, ad, ax, h + 0.825, az, ALLOY);
      for (let u = -aw / 2 + 1.2; u < aw / 2 - 0.4; u += 1.2) {
        for (const e of [-1, 1]) sb.box(0.04, 1.2, 0.03, ax + u, h + 0.83, az + e * (ad / 2 + 0.015), DARK_CONCRETE);
      }
      for (let i = 0; i < 4; i++) blade("+x", ax + aw / 2, az, h + 0.4 + i * 0.26, ad * 0.8, 0.16, 0.06, DARK_CONCRETE, 0.6);
      for (let i = 0; i < 3; i++) {
        const fx = ax + (i - 1) * 1.3;
        sb.box(0.9, 0.85, 0.9, fx, h + 1.9, az, ALLOY);
        b.cyl(0.3, 0.8, 0.8, 8, fx, h + 2.45, az, DARK_CONCRETE);
        b.cyl(0.05, 0.86, 0.86, 8, fx, h + 2.62, az, ALLOY);
        sb.box(0.8, 0.03, 0.04, fx, h + 2.64, az, ALLOY);
        sb.box(0.04, 0.03, 0.8, fx, h + 2.64, az, ALLOY);
      }
      // The duct, at the motor room's height and clear of the condensers.
      {
        const [d0, d1] = ox >= 0 ? [ax + aw / 2, ox - mw0 / 2] : [ox + mw0 / 2, ax - aw / 2];
        if (d1 - d0 > 0.6 && Math.abs(az - oz) < md0 / 2 - 0.4) {
          sb.box(d1 - d0, 0.55, 0.55, (d0 + d1) / 2, h + 1.1, az, ALLOY);
        }
      }
    } else if (crown === 1) {
      // A stepped crown: two setbacks of the shaft's own skin over the
      // parapet, which is what pre-war stock did and what makes a tall one read
      // as tall. The system's fins are carried up both steps, a lit band runs
      // under each cap where the lights are on, and a spire stands on the top.
      const steps: [number, number, number][] = [
        [0.72, h, 2.4],
        [0.42, h + 2.65, 2.6],
      ];
      for (const [f, y0, hh] of steps) {
        const cw = topW * f;
        const cd = topD * f;
        sb.box(cw, hh, cd, 0, y0 + hh / 2, 0, skin);
        sb.box(cw + 0.2, 0.28, cd + 0.2, 0, y0 + hh + 0.12, 0, ALLOY);
        for (const s of SIDES) {
          const L = lenOf(s, cw, cd);
          const plane = planeOf(s, cw, cd);
          const fins = Math.max(2, Math.round(L / 1.6));
          for (let i = 1; i < fins; i++) {
            lay(s, plane, -L / 2 + (i / fins) * L, y0 + hh / 2 - 0.1, 0.1, hh - 0.4, 0.14, 0.07, ALLOY, hideBack(s));
          }
          if (lit) lens.onFace(s, plane, 0, y0 + hh - 0.16, L - 0.3, 0.12, 0.03, 0.015, ROOM_GLOW);
        }
      }
      sb.box(topW * 0.2, 1.4, topD * 0.2, ox * 0.4, h + 6.1, oz * 0.4, DARK_CONCRETE);
      sb.box(topW * 0.2 + 0.16, 0.12, topD * 0.2 + 0.16, ox * 0.4, h + 6.86, oz * 0.4, ALLOY);
      b.cyl(3.2, 0.06, 0.4, 6, ox * 0.4, h + 8.5, oz * 0.4, ALLOY);
    } else if (crown === 2) {
      // A water tank on a frame, and a gantry rail round the parapet: older
      // stock that got a lift and a tank bolted to the top of it later. The
      // tank is hooped and roofed; the frame braced, with a ring beam under
      // the tank and a ladder up one leg; the stair head has a door.
      const tankY = h + 2.9;
      b.cyl(2.6, 3.4, 3.4, 10, ox, tankY, oz, RUST);
      b.cyl(0.4, 3.6, 3.6, 10, ox, tankY + 1.5, oz, DARK_CONCRETE);
      b.cyl(0.5, 0.4, 3.5, 10, ox, tankY + 1.95, oz, DARK_CONCRETE);
      for (const hy of [-0.9, 0, 0.9]) b.cyl(0.06, 3.48, 3.48, 10, ox, tankY + hy, oz, DARK_CONCRETE);
      sb.box(2.7, 0.16, 2.7, ox, h + 1.52, oz, RUST);
      for (const sx2 of [-1, 1]) {
        for (const sz2 of [-1, 1]) {
          sb.box(0.16, 2.4, 0.16, ox + sx2 * 1.2, h + 1.2, oz + sz2 * 1.2, RUST);
          sb.box(0.3, 0.06, 0.3, ox + sx2 * 1.2, h + 0.03, oz + sz2 * 1.2, DARK_CONCRETE);
        }
        const brace = Math.hypot(2.4, 1.3);
        const ang = Math.atan2(2.4, 1.3);
        sb.box(0.06, brace, 0.06, ox + sx2 * 1.2, h + 0.8, oz, RUST, { x: ang });
        sb.box(0.06, brace, 0.06, ox, h + 0.8, oz + sx2 * 1.2, RUST, { z: ang });
      }
      ladder(ox + 1.88, oz + 0.6, false, h, h + 4.3, RUST);
      const bw = topW * 0.34;
      const bd = topD * 0.28;
      sb.box(bw, 1.6, bd, -ox, h + 0.8, -oz, DARK_CONCRETE);
      sb.box(bw + 0.2, 0.1, bd + 0.2, -ox, h + 1.65, -oz, ALLOY);
      sb.box(0.9, 1.4, 0.05, -ox, h + 0.72, -oz + bd / 2 + 0.025, ALLOY);
      // The gantry rail: a hairline round the coping, and what gives a flat top
      // a scale at all.
      for (const sz2 of [-1, 1]) {
        sb.box(topW + 0.4, 0.07, 0.07, 0, h + 1.9, (sz2 * (topD + 0.4)) / 2, ALLOY);
      }
      for (const sx2 of [-1, 1]) {
        sb.box(0.07, 0.07, topD + 0.4, (sx2 * (topW + 0.4)) / 2, h + 1.9, 0, ALLOY);
        for (let i = 0; i <= 3; i++) {
          sb.box(0.07, 1.1, 0.07, (sx2 * (topW + 0.4)) / 2, h + 1.35, -topD / 2 + (i / 3) * topD, ALLOY);
        }
      }
    } else {
      // Brick stock: a stair head and a stack of flues, which is what is on top
      // of a building of this age — and on some, the timber water tank on its
      // steel stand that a city of this age keeps on its roofs.
      sb.box(topW * 0.26, 2.0, topD * 0.3, ox, h + 0.9, oz, RENDER);
      sb.box(topW * 0.26 + 0.3, 0.2, topD * 0.3 + 0.3, ox, h + 2.0, oz, RENDER);
      sb.box(0.9, 1.7, 0.05, ox, h + 0.85, oz + topD * 0.15 + 0.025, IRON);
      lens.box(0.22, 0.1, 0.08, ox, h + 1.85, oz + topD * 0.15 + 0.05, WINDOW_LIGHT);
      sb.box(1.5, 2.6, 1.0, -ox, h + 1.2, -oz, CITY_BRICK);
      sb.box(1.8, 0.24, 1.3, -ox, h + 2.6, -oz, RENDER);
      sb.box(1.62, 0.1, 1.12, -ox, h + 2.0, -oz, RENDER);
      for (let i = 0; i < 3; i++) {
        b.cyl(0.5, 0.36, 0.42, 6, -ox - 0.5 + i * 0.5, h + 2.95, -oz, DARK_CONCRETE);
      }
      if (topW >= 10 && topD >= 10 && roll(36) > 0.35) {
        const tx = -Math.sign(ox || 1) * topW * 0.28;
        const tz = Math.sign(oz || 1) * topD * 0.28;
        const legH = 2.6;
        for (const sx2 of [-1, 1]) {
          for (const sz2 of [-1, 1]) {
            sb.box(0.14, legH, 0.14, tx + sx2 * 1.05, h + legH / 2, tz + sz2 * 1.05, RUST);
          }
          sb.box(2.3, 0.12, 0.12, tx, h + legH * 0.5, tz + sx2 * 1.05, RUST);
          sb.box(0.12, 0.12, 2.3, tx + sx2 * 1.05, h + legH * 0.5, tz, RUST);
        }
        sb.box(2.6, 0.12, 2.6, tx, h + legH + 0.06, tz, TEAK);
        const ty = h + legH + 0.12 + 1.4;
        b.cyl(2.8, 2.6, 2.7, 12, tx, ty, tz, TEAK);
        b.cyl(0.9, 0.14, 2.9, 12, tx, ty + 1.85, tz, DARK_CONCRETE);
        for (const hy of [-1.0, -0.3, 0.4, 1.0]) b.cyl(0.06, 2.72, 2.72, 12, tx, ty + hy, tz, RUST);
        ladder(tx + 1.45, tz, false, h, h + legH + 0.12, RUST);
      }
      b.cyl(0.9, 0.18, 0.18, 6, -ox + 1.4, h + 0.45, -oz, DARK_CONCRETE);
      b.cyl(0.08, 0.3, 0.3, 6, -ox + 1.4, h + 0.94, -oz, DARK_CONCRETE);
    }

    if (!brick) {
      // The window-cleaning machine on a tall roof: a track round the roof
      // inside the parapet, the carriage parked on it, its jib laid along the
      // track and the cradle parked beside it. The thinnest thing on the
      // skyline, and the one a tall roof most obviously has.
      const ti = 1.1;
      if (h > 26 && topW > 12 && topD > 12 && roll(35) > 0.3) {
        const tx = topW / 2 - ti;
        const tz = topD / 2 - ti;
        for (const k of [-1, 1]) {
          sb.box(topW - 2 * ti + 0.25, 0.14, 0.25, 0, h + 0.11, k * tz, DARK_CONCRETE);
          sb.box(topW - 2 * ti + 0.12, 0.04, 0.1, 0, h + 0.2, k * tz, ALLOY);
          sb.box(0.25, 0.14, topD - 2 * ti + 0.25, k * tx, h + 0.11, 0, DARK_CONCRETE);
          sb.box(0.1, 0.04, topD - 2 * ti + 0.12, k * tx, h + 0.2, 0, ALLOY);
        }
        const bx = (roll(37) - 0.5) * (topW - 2 * ti - 9);
        const bz = -tz;
        sb.box(2.4, 1.0, 1.4, bx, h + 0.72, bz, ALLOY);
        sb.box(2.5, 0.08, 1.5, bx, h + 1.26, bz, DARK_CONCRETE);
        b.cyl(1.4, 0.45, 0.5, 8, bx, h + 1.95, bz, ALLOY);
        const jl = Math.min(7, topW * 0.42);
        const up = 0.18;
        const dirX = bx > 0 ? -1 : 1;
        const jx = bx + dirX * (Math.cos(up) * jl) / 2;
        const jy = h + 2.6 + (Math.sin(up) * jl) / 2;
        for (const e of [-1, 1]) {
          sb.box(jl, 0.1, 0.1, jx, jy + e * 0.22, bz, ALLOY, { z: dirX * up });
        }
        for (let i = 1; i < 6; i++) {
          const f = i / 6;
          sb.box(0.05, 0.44, 0.05, bx + dirX * Math.cos(up) * jl * f, h + 2.6 + Math.sin(up) * jl * f, bz, ALLOY);
        }
        const tipX = bx + dirX * Math.cos(up) * jl;
        const tipY = h + 2.6 + Math.sin(up) * jl;
        sb.box(0.5, 0.5, 0.5, tipX, tipY, bz, DARK_CONCRETE);
        sb.box(0.03, tipY - h - 1.6, 0.03, tipX, (tipY + h + 1.6) / 2, bz, DARK_CONCRETE);
        // The cradle, parked behind the carriage between the track and the
        // parapet.
        const cz = bz - 0.6;
        const cx = bx - dirX * 2.8;
        sb.box(2.8, 0.08, 0.7, cx, h + 0.14, cz, DARK_CONCRETE);
        for (const sx2 of [-1, 1]) {
          for (const sz2 of [-1, 1]) sb.box(0.05, 1.0, 0.05, cx + sx2 * 1.37, h + 0.6, cz + sz2 * 0.32, ALLOY);
        }
        for (const sz2 of [-1, 1]) {
          sb.box(2.8, 0.05, 0.05, cx, h + 1.1, cz + sz2 * 0.32, ALLOY);
          sb.box(2.8, 0.18, 0.02, cx, h + 0.27, cz + sz2 * 0.34, ALLOY);
        }
        for (const sx2 of [-1, 1]) sb.box(0.05, 0.05, 0.7, cx + sx2 * 1.37, h + 1.1, cz, ALLOY);
      }

      // The mast, its stays, and a dish on the taller ones. Thin against the
      // sky is the third of the crown's three ideas, and the only one that is
      // the same on all of them.
      const mx = -topW * 0.3;
      const mz = topD * 0.24;
      b.cyl(6, 0.16, 0.3, 5, mx, h + 3.6, mz, ALLOY);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        sb.box(0.05, 3.4, 0.05, mx + Math.cos(a) * 0.55, h + 2.1, mz + Math.sin(a) * 0.55, ALLOY, {
          x: Math.sin(a) * 0.3,
          z: -Math.cos(a) * 0.3,
        });
      }
      if (h > 30) {
        b.cyl(0.24, 1.5, 0.5, 8, mx + 1.6, h + 2.4, mz, ALLOY, { x: Math.PI / 2.6 });
        sb.box(0.12, 1.6, 0.12, mx + 1.6, h + 1.6, mz, ALLOY);
      }
      // An obstruction light. Emissive, so it reads at any hour and at any
      // distance — on a map with no fog the far side of the skyline is a
      // silhouette, and this is the one thing on it that is not.
      lens.box(0.34, 0.34, 0.34, mx, h + 6.7, mz, "#ff5a4a");
    }
  }

  sb.flush(b);
  lens.flushGlow(b);
  lensG.flushGlow(b, OVER_GLASS);
}

/**
 * The brick stock's shaft: an interwar commercial block, drawn over the brick
 * mass from the podium's coping to the parapet — see `drawTower`'s header for
 * what it is and why. Its own function only because it is long; it shares the
 * tower's batches and words.
 */
function drawBrickStock(o: {
  b: Build;
  sb: StoneBatch;
  lens: StoneBatch;
  lensG: StoneBatch;
  rnd: () => number;
  w: number;
  d: number;
  h: number;
  podH: number;
  lit: boolean;
  lay: (s: Side, plane: number, u: number, y: number, along: number, tall: number, thick: number, out: number, color: string, hide?: number) => void;
  paneOn: (s: Side, plane: number, u: number, y: number, along: number, tall: number, thick: number, out: number, backed: string) => void;
  roll: (salt: number) => number;
}): void {
  const { b, sb, lensG, rnd, w, d, h, podH, lit, lay, paneOn, roll } = o;
  const J = 0.025;
  /** Where the brick starts: the podium coping's top. */
  const face0 = podH + 0.35;
  /** The frieze and the cornice, under the roof line. */
  const frieze = h - 1.15;
  /**
   * How many storeys, and how tall: fitted to the building rather than to
   * `STOREY`, so a short block gets two tall loft floors rather than two
   * ordinary ones and a blank band of brick over them.
   */
  const avail = frieze - face0;
  const rows = avail >= 2.4 ? Math.max(1, Math.round(avail / STOREY)) : 0;
  const st = rows > 0 ? avail / rows : 0;
  const cols = Math.max(2, Math.round(w / 3.2));
  const pitch = w / cols;
  const pier = 0.5;
  const corner = 0.8;

  // --- the street and rear elevations: piers, steel windows, spandrels -----
  for (const s of ["+z", "-z"] as const) {
    const plane = d / 2;
    const hb = hideBack(s);
    /** Pier `c`'s span; the corner ones wrap over the flank's pilaster. */
    const pierAt = (c: number): [number, number] => {
      if (c === 0) return [-w / 2 - 0.2, -w / 2 + corner];
      if (c === cols) return [w / 2 - corner, w / 2 + 0.2];
      const x = -w / 2 + c * pitch;
      return [x - pier / 2, x + pier / 2];
    };
    for (let c = 0; c <= cols; c++) {
      const [u0, u1] = pierAt(c);
      const um = (u0 + u1) / 2;
      lay(s, plane, um, (face0 + frieze) / 2, u1 - u0, frieze - face0, 0.2, 0.1, CITY_BRICK, hb | HIDE_TOP | HIDE_UNDER);
      lay(s, plane, um, face0 + 0.15, u1 - u0 + 0.08, 0.3, 0.24, 0.12, RENDER, hb);
      lay(s, plane, um, frieze - 0.15, u1 - u0 + 0.1, 0.3, 0.26, 0.13, RENDER, hb);
    }
    const front = s === "+z";
    // The spandrels: one course of brick across the whole elevation per
    // storey, recessed behind the piers drawn over it, and the brick over the
    // top storey's lintels to the frieze.
    {
      let prev = face0;
      for (let r = 0; r < rows; r++) {
        const sp1 = face0 + r * st + 0.85 - 0.12;
        if (sp1 - prev > 0.1) lay(s, plane, 0, (prev + sp1) / 2, w, sp1 - prev - J, 0.1, 0.05, CITY_BRICK, hb);
        prev = face0 + (r + 1) * st - 0.55 + 0.26 + J;
      }
      if (frieze - prev > 0.1) lay(s, plane, 0, (prev + frieze) / 2, w, frieze - prev, 0.1, 0.05, CITY_BRICK, hb);
    }
    // A member that butts into another at both ends leaves those faces out:
    // a post its top and foot, a rail its two ends.
    const post = hb | HIDE_TOP | HIDE_UNDER;
    const rail = hb | hideEnds(s);
    for (let c = 0; c < cols; c++) {
      const L = pierAt(c)[1];
      const R = pierAt(c + 1)[0];
      const ow = R - L;
      const bu = (L + R) / 2;
      for (let r = 0; r < rows; r++) {
        const fy = face0 + r * st;
        const y0 = fy + 0.85;
        const y1 = fy + st - 0.55;
        const oh = y1 - y0;
        const ym = (y0 + y1) / 2;
        // A stone tablet on the street front's spandrels, where one is deep
        // enough to carry it.
        const spH = r === 0 ? y0 - 0.12 - face0 : st - oh - 0.38;
        if (front && spH > 0.8) lay(s, plane, bu, y0 - 0.12 - spH / 2, Math.min(0.9, ow * 0.3), 0.3, 0.13, 0.065, RENDER, hb);
        // The window, pier to pier: the sheet set back in a steel frame with
        // its grid of glazing bars, a stone sill under it and a stone lintel
        // over it — with a keystone on the street front.
        paneOn(s, plane, bu, ym, ow, oh, 0.04, 0.02, CITY_BRICK);
        lay(s, plane, bu, y0 - 0.06, ow + 0.24, 0.12, 0.16, 0.08, RENDER);
        lay(s, plane, bu, y1 + 0.13, ow, 0.26, 0.12, 0.06, RENDER, rail);
        if (front) lay(s, plane, bu, y1 + 0.15, 0.32, 0.36, 0.16, 0.08, RENDER, hb);
        for (const e of [-1, 1]) lay(s, plane, bu + e * (ow / 2 - 0.03), ym, 0.06, oh, 0.05, 0.045, DARK_CONCRETE, post);
        for (const e of [-1, 1]) lay(s, plane, bu, ym + e * (oh / 2 - 0.03), ow - 0.12, 0.06, 0.05, 0.045, DARK_CONCRETE, rail);
        const vb = Math.max(1, Math.round(ow / 0.8));
        const hbars = Math.max(1, Math.round(oh / 0.75));
        for (let i = 1; i < vb; i++) lay(s, plane, bu - ow / 2 + (i / vb) * ow, ym, 0.035, oh - 0.12, 0.03, 0.055, DARK_CONCRETE, post);
        for (let i = 1; i < hbars; i++) lay(s, plane, bu, y0 + (i / hbars) * oh, ow - 0.12, 0.035, 0.03, 0.055, DARK_CONCRETE, rail);
        // A blind in some windows, behind the bars: down a little, or most of
        // the way where the room is lit, so a lit window is a lit room under a
        // blind rather than a lamp the size of the window.
        const on = lit && towerRoll(bu, ym, c + r * 7, 3) < 0.16;
        const drop = on ? 0.35 : rnd() < 0.3 ? 0.2 + rnd() * 0.4 : 0;
        // 2.5 cm off the glass, which is what survives the sheet's own bias.
        if (drop > 0) lay(s, plane, bu, y1 - (oh * drop) / 2, ow - 0.08, oh * drop, 0.01, 0.065, RENDER);
        if (on) {
          lensG.onFace(s, plane, bu, y0 + (oh * (1 - drop)) / 2, ow - 0.2, oh * (1 - drop) - 0.15, 0.01, 0.045, ROOM_GLOW);
        }
      }
    }
    // The frieze, and the dentils under the cornice: the street elevations'
    // and the rear's, which are the two a block's cornice is built for.
    lay(s, plane, 0, frieze + 0.2, w + 0.48, 0.4, 0.24, 0.12, CITY_BRICK, hb);
    for (let u = -w / 2 - 0.1; u <= w / 2 + 0.1; u += 0.45) {
      lay(s, plane, u, h - 0.67, 0.14, 0.16, 0.34, 0.17, CITY_BRICK, hb | HIDE_TOP);
    }
  }

  // --- the party walls: pilasters, tie plates, a downpipe, old openings ----
  /** Which flank the fire escape is on, if there is one. */
  const escape = rows >= 2 && roll(20) > 0.42;
  const fx: -1 | 1 = roll(21) > 0.5 ? 1 : -1;
  /** The ghost sign goes on the flank the escape is NOT on. */
  const ghost = roll(17) > 0.4;
  const gsx: -1 | 1 = escape ? (-fx as -1 | 1) : roll(18) > 0.5 ? 1 : -1;
  for (const sx of [-1, 1] as const) {
    const s: Side = sx > 0 ? "+x" : "-x";
    const plane = w / 2;
    const hb = hideBack(s);
    for (const e of [-1, 1]) {
      lay(s, plane, e * (d / 2 - corner / 2), (face0 + frieze) / 2, corner, frieze - face0, 0.2, 0.1, CITY_BRICK, hb);
    }
    lay(s, plane, 0, frieze + 0.2, d, 0.4, 0.24, 0.12, CITY_BRICK, hb);
    // Tie plates at every floor line: the ends of the rods that hold the
    // floors to the wall.
    for (let r = 1; r < rows; r++) {
      const y = face0 + r * st;
      const n = Math.max(2, Math.round((d - 2) / 3.2));
      for (let i = 0; i < n; i++) {
        lay(s, plane, -d / 2 + 1 + ((i + 0.5) * (d - 2)) / n, y, 0.3, 0.3, 0.04, 0.02, IRON, hb);
      }
    }
    // What the flank's middle is used for: the escape, or the sign, or the
    // openings a demolished neighbour once had and that were bricked up.
    const busy = (escape && sx === fx) || (ghost && sx === gsx);
    if (!busy) {
      for (let r = 0; r < rows; r++) {
        const fy = face0 + r * st;
        for (const u of [-d * 0.22, d * 0.22]) {
          if (rnd() < 0.4) continue;
          const y0 = fy + 0.9;
          const y1 = fy + st - 0.6;
          lay(s, plane, u, (y0 + y1) / 2, 1.3, y1 - y0, 0.04, 0.02, CITY_BRICK, hb);
          lay(s, plane, u, y0 - 0.05, 1.5, 0.1, 0.12, 0.06, RENDER);
          lay(s, plane, u, y1 + 0.1, 1.5, 0.2, 0.08, 0.04, RENDER, hb);
        }
      }
    }
    // The downpipe, off the gutter behind the parapet to the podium roof, and
    // its hopper and its brackets.
    {
      const u = -sx * (d / 2 - 1.2);
      const top = h - 0.8;
      b.cyl(top - face0, 0.14, 0.14, 6, sx * (plane + 0.12), (top + face0) / 2, u, DARK_CONCRETE);
      lay(s, plane, u, top + 0.15, 0.36, 0.34, 0.3, 0.15, DARK_CONCRETE);
      for (let y = face0 + 1.0; y < top - 0.4; y += 1.8) lay(s, plane, u, y, 0.22, 0.05, 0.12, 0.06, DARK_CONCRETE);
    }
  }

  // --- the cornice and the parapet ------------------------------------------
  //
  // A corona of stone over the dentils, a top course over that, then the
  // parapet in brick with a stone coping overhanging both faces, and over the
  // street front a raised panel carrying the building's name tablet. It is
  // what a brick block has instead of a parapet slab, and at this height it is
  // the whole of the silhouette.
  sb.box(w + 0.92, 0.24, d + 0.92, 0, h - 0.47, 0, RENDER);
  sb.box(w + 0.84, 0.12, d + 0.84, 0, h - 0.29, 0, RENDER);
  {
    const ph = 0.85;
    for (const k of [-1, 1]) {
      sb.box(w + 0.12, ph, 0.35, 0, h + ph / 2, k * (d / 2 + 0.06 - 0.175), CITY_BRICK, undefined, HIDE_UNDER);
      sb.box(0.35, ph, d - 0.58, k * (w / 2 + 0.06 - 0.175), h + ph / 2, 0, CITY_BRICK, undefined, HIDE_UNDER);
      sb.box(w + 0.28, 0.12, 0.51, 0, h + ph + 0.06, k * (d / 2 + 0.14 - 0.255), RENDER);
      sb.box(0.51, 0.12, d - 0.74, k * (w / 2 + 0.14 - 0.255), h + ph + 0.06, 0, RENDER);
    }
    const nw = Math.min(8, w / 3);
    const nz = d / 2 + 0.06 - 0.175;
    sb.box(nw, 0.9, 0.35, 0, h + ph + 0.12 + 0.45, nz, CITY_BRICK);
    sb.box(nw + 0.16, 0.12, 0.51, 0, h + ph + 0.12 + 0.96, d / 2 + 0.14 - 0.255, RENDER);
    sb.box(nw - 1.0, 0.5, 0.06, 0, h + ph + 0.57, nz + 0.2, RENDER);
    sb.box(nw - 1.3, 0.3, 0.03, 0, h + ph + 0.57, nz + 0.245, CITY_BRICK);
  }

  // --- the ghost sign --------------------------------------------------------
  //
  // A painted panel gone flat with age on the blank flank, the brick showing
  // through where the paint has gone — which is what the letters are drawn as,
  // in lines of words.
  if (ghost) {
    const s: Side = gsx > 0 ? "+x" : "-x";
    const gsh = Math.min(4.2, h - podH - 2.4);
    if (gsh > 1.6) {
      const gy = podH + 1.6 + gsh / 2;
      const gw = d * 0.52;
      const hb = hideBack(s);
      lay(s, w / 2, 0, gy, gw, gsh, 0.05, 0.025, RENDER, hb);
      // Its painted border, a hand inside the panel's edge.
      for (const e of [-1, 1]) {
        lay(s, w / 2, 0, gy + e * (gsh / 2 - 0.2), gw - 0.33, 0.07, 0.02, 0.06, CITY_BRICK, hb | hideEnds(s));
        lay(s, w / 2, e * (gw / 2 - 0.2), gy, 0.07, gsh - 0.33, 0.02, 0.06, CITY_BRICK, hb | HIDE_TOP | HIDE_UNDER);
      }
      // Two lines of lettering, a name in tall letters and a line of small
      // ones under it — each letter a stem, a stroke and sometimes a second
      // stem, which is what reads as words at the distance a ghost sign is
      // ever read from. Blocks of brick colour read as a brick pattern.
      const lines: [number, number, number][] = [
        [gy + gsh * 0.13, gsh * 0.34, 0.62],
        [gy - gsh * 0.25, gsh * 0.15, 0.3],
      ];
      // Letters are laid left to right as the face is LOOKED at: a face's u runs
      // from the viewer's right on -X, so there it is turned round.
      const fl = s === "-x" ? -1 : 1;
      for (const [ly, lh, lp] of lines) {
        const stroke = lp * 0.18;
        let u = -gw / 2 + 0.5;
        while (u < gw / 2 - 0.5 - lp) {
          const letters = 3 + Math.floor(rnd() * 5);
          for (let i = 0; i < letters && u < gw / 2 - 0.5 - lp; i++) {
            lay(s, w / 2, fl * (u + stroke / 2), ly, stroke, lh, 0.02, 0.06, CITY_BRICK, hb);
            const k = rnd();
            const by = k < 0.33 ? ly + lh / 2 - stroke / 2 : k < 0.66 ? ly : ly - lh / 2 + stroke / 2;
            lay(s, w / 2, fl * (u + lp * 0.33), by, lp * 0.48, stroke, 0.02, 0.06, CITY_BRICK, hb);
            if (rnd() < 0.5) lay(s, w / 2, fl * (u + lp * 0.6), ly, stroke, lh, 0.02, 0.06, CITY_BRICK, hb);
            u += lp;
          }
          u += lp * 0.8;
        }
      }
    }
  }

  // --- the fire escape ---------------------------------------------------------
  //
  // The character element of this stock. **A zigzag is landings that
  // ALTERNATE**, and the flight between them is the whole of what makes it read
  // as one: drawn first with every landing at the same end, each flight ran off
  // into the air beside the next landing rather than up to it — a stair to
  // nowhere on every storey, invisible in the numbers because each piece is
  // individually right. **And it serves WINDOWS**: one behind every landing,
  // because a fire escape on a blank wall is the same stair to nowhere a storey
  // at a time.
  //
  // It is honest rather than decorative in the one way that matters here: the
  // bottom ladder is DRAWN RETRACTED, which is what a real one does, and that is
  // what puts every member of the assembly over a standing body. So nothing
  // needs a collider to keep anyone out of it, and it takes the header's
  // exemption for what projects above reach.
  if (escape) {
    const s: Side = fx > 0 ? "+x" : "-x";
    const face = (fx * w) / 2;
    /** Half the zigzag's travel along the elevation: a landing sits at each. */
    const half = 1.5;
    const run = half * 2;
    /** The first landing, and what the ladder below it hangs from. */
    const foot = face0 + 0.55;
    const flights = Math.min(3, rows - 1);
    const landZ = (i: number): number => (i % 2 === 0 ? -half : half);
    for (let i = 0; i <= flights; i++) {
      const y = foot + i * st;
      const cz = landZ(i);
      // The window it serves.
      {
        const y0 = y + 0.5;
        const y1 = Math.min(y + st - 0.6, y + 2.4);
        const ym = (y0 + y1) / 2;
        paneOn(s, w / 2, cz, ym, 1.1, y1 - y0, 0.04, 0.02, CITY_BRICK);
        lay(s, w / 2, cz, y0 - 0.06, 1.34, 0.12, 0.16, 0.08, RENDER);
        lay(s, w / 2, cz, y1 + 0.12, 1.4, 0.24, 0.12, 0.06, RENDER, hideBack(s));
        for (const e of [-1, 1]) lay(s, w / 2, cz + e * 0.54, ym, 0.06, y1 - y0, 0.05, 0.045, DARK_CONCRETE, hideBack(s));
        lay(s, w / 2, cz, ym, 1.1, 0.04, 0.03, 0.055, DARK_CONCRETE, hideBack(s));
      }
      // The landing: a grating on a frame, a rail along its outer edge with
      // balusters, and a post and a rail at each end.
      for (const e of [-1, 1]) sb.box(1.5, 0.07, 0.06, face + fx * 0.75, y, cz + e * 0.92, RUST);
      sb.box(0.06, 0.07, 1.9, face + fx * 1.47, y, cz, RUST);
      for (let q = 0; q < 6; q++) sb.box(0.04, 0.05, 1.8, face + fx * (0.15 + q * 0.24), y + 0.01, cz, RUST);
      sb.box(0.06, 0.06, 1.9, face + fx * 1.46, y + 1.0, cz, RUST);
      for (let q = 1; q < 7; q++) sb.box(0.03, 1.0, 0.03, face + fx * 1.46, y + 0.5, cz - 0.92 + (q / 7) * 1.84, RUST);
      for (const e of [-1, 1]) {
        sb.box(0.06, 1.0, 0.06, face + fx * 1.46, y + 0.5, cz + e * 0.92, RUST);
        sb.box(1.5, 0.06, 0.06, face + fx * 0.75, y + 1.0, cz + e * 0.92, RUST);
        sb.box(0.04, 0.16, 0.16, face + fx * 0.02, y - 0.56, cz + e * 0.8, RUST);
        const brace = Math.hypot(1.2, 0.6);
        sb.box(0.04, brace, 0.04, face + fx * 0.6, y - 0.3, cz + e * 0.8, RUST, { z: -fx * Math.atan2(1.2, 0.6) });
      }
      // The flight up to the next landing: two stringers, seven treads and a
      // handrail, raked in the YZ plane so the run is ALONG the elevation
      // rather than out of it. A positive `rotation.x` tips local +Y toward +Z,
      // so the sign IS which way this flight climbs and it comes off the
      // landings.
      if (i < flights) {
        const dirZ = landZ(i + 1) > cz ? 1 : -1;
        const len = Math.hypot(run, st);
        const rake = dirZ * Math.atan2(run, st);
        for (const e of [-1, 1]) {
          sb.box(0.07, len, 0.07, face + fx * (0.75 + e * 0.55), y + st / 2, cz + dirZ * half, RUST, { x: rake });
        }
        sb.box(0.04, len, 0.04, face + fx * 1.3, y + st / 2 + 0.9, cz + dirZ * half, RUST, { x: rake });
        for (let q = 1; q <= 7; q++) {
          const f = q / 8;
          sb.box(1.1, 0.04, 0.22, face + fx * 0.75, y + f * st, cz + dirZ * f * run, RUST);
        }
      }
    }
    // The retracted counterweighted ladder, hung from the first landing so the
    // two cannot drift apart. Its lowest member sits 2 m under that landing,
    // which on the shallowest podium in the kit is over a standing body — the
    // clearance the whole assembly rests on.
    const lz = landZ(0);
    for (const e of [-1, 1]) {
      sb.box(0.06, 2.2, 0.06, face + fx * (0.75 + e * 0.4), foot - 1.0, lz, RUST);
    }
    for (let i = 0; i < 4; i++) {
      sb.box(0.86, 0.05, 0.05, face + fx * 0.75, foot - 1.8 + i * 0.5, lz, RUST);
    }
    sb.box(0.3, 0.3, 0.2, face + fx * 1.3, foot + 0.3, lz + 0.8, DARK_CONCRETE);
  }
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
    // all outdoors (see the file header) — the sixteen shader slots are
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
 * file header's budget). It is the builder header's gameplay gradient —
 * the fight in is through a dark room, what you win is a gallery — and it
 * answers the "bright plate under a black lid" the file header describes: the
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
 *   the upstand's inner face, inside the trim budget the rest of the file
 *   keeps.
 * - **LOW** — the paint at 12 mm, under a capture ring's 18 (this is B on
 *   Coldharbour, and the ring crosses the ground deck); the wheel stops at
 *   10 cm, the ramp kerbs at 14 and their anti-skid ribs at 12 mm.
 * - **OVERHEAD** — the soffit's beams and fittings, which leave exactly 2.4 m
 *   under deck 1 (the shortest storey, its floor being `GROUND` up), and the
 *   capitals, which come lower but never further than 0.43 m from a column's
 *   centre: inside the column plus a body's radius, where no head can be.
 *
 * **The soffit is what the inside of a car park is**, and the file header's
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
 * The third is a personnel door in the -X gable, opening UNDER the gallery.
 * That is deliberate and it is the building's one asymmetry: the bays put you
 * on the floor in front of everybody on the gallery, and the side door puts
 * you beneath them, where a gallery that faces the hall over a solid rail
 * cannot look.
 *
 * **It stands where the stair is NOT, and for a long time it did not.** The
 * stair's lane runs the whole -X gable, so a doorway anywhere along the flight
 * opens onto the side of it: the door stood at `d * 0.24`, where the flight is
 * 0.8-1.4 m up, a body walked 0.4 m into the wall's thickness and stopped, and
 * the nav graph never linked the doorway to the street — a door nobody and
 * nothing could use, said to stand at the stair's foot. The foot leaves only
 * 1.3 m of floor before the front wall, which no `DOORWAY` fits. Under the
 * gallery there is 3.1 m of headroom and no flight at all.
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
  const steps = Math.max(4, Math.round(rise / RISER));
  /** The gables run past the eaves to the top of the teeth — see the header. */
  const gableH = eaves + TOOTH;
  /**
   * Where along the -X gable the personnel door stands: under the middle of
   * the gallery, clear of the stair's lane — see the header.
   */
  const doorAt = zBack + MEZZ_D / 2;
  const bays = Math.max(2, Math.round(w / 7));
  const pierW = 1.6;
  const bayW = (w - pierW * (bays + 1)) / bays;
  const cols = Math.max(1, Math.round(w / 13));
  const colXs: number[] = [];
  for (let i = 1; i <= cols; i++) colXs.push(-w / 2 + (i / (cols + 1)) * w);
  const colZ = d * 0.16;
  const office = { x: w * 0.24, z: zBack + MEZZ_D / 2 };
  // Pallets and crates: the floor's cover, and what stops 28 m of concrete
  // being a shooting gallery. Under `CoverMap`'s 1.7 m line except the tall
  // stack, which is over it on purpose — one piece of hard cover in the room.
  const stacks: [number, number, number, number, number][] = [
    // [w, h, d, x, z]
    [2.6, 1.5, 2.2, -w * 0.24, d * 0.26],
    [3.2, 1.2, 2.4, w * 0.3, d * 0.3],
    [2.2, 2.1, 2.2, w * 0.04, -d * 0.06],
  ];
  const teeth = Math.max(2, Math.round(d / 5.5));

  if (import.meta.env.DEV && zMezz + run + 0.6 > zFront) {
    throw new Error(
      `depot: a ${d} m plate cannot hold a ${MEZZ_D} m gallery and the ` +
        `${run.toFixed(1)} m flight up to it — the stair would run out through ` +
        "the loading elevation. See buildDepot.",
    );
  }

  // Drawn FIRST: it emits no collider, and the merge keeps emission order, so
  // the brickwork, the steel and the fittings go down before the masses they
  // hide. Everything below this line is a collider and the box it wears.
  drawDepot(b, {
    w,
    d,
    eaves,
    tooth: TOOTH,
    mezz: MEZZ,
    mezzD: MEZZ_D,
    zBack,
    zMezz,
    lane,
    laneCx,
    laneInner,
    run,
    pitch,
    steps,
    open: OPEN,
    gableH,
    doorAt,
    bays,
    pierW,
    bayW,
    colXs,
    colZ,
    office,
    stacks,
    teeth,
    pitchZ: d / teeth,
    lit: !!p.litWindows,
  });

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
  // `drawn: false` — the steel stair over it is `drawDepot`'s.
  b.flight({
    x: laneCx,
    w: lane,
    topZ: zMezz,
    topY: MEZZ,
    run: run + 0.6,
    rise: rise + 0.6 * GRADE,
    dir: -1,
    steps,
    color: ALLOY,
    drawn: false,
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
  b.wall(w, eaves, WALL, 0, eaves / 2, -d / 2, CITY_BRICK);
  b.wall(WALL, gableH, d, w / 2, gableH / 2, 0, CITY_BRICK);

  // The -X gable, with the personnel door cut by hand: this wall runs along Z
  // and `doorWall` runs along X, so it is the two jambs and the lintel that
  // method would emit. The doorway opens under the gallery.
  {
    const gap = DOORWAY;
    const at = doorAt;
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
  for (let i = 0; i <= bays; i++) {
    b.wall(pierW, eaves, WALL, -w / 2 + pierW / 2 + i * (pierW + bayW), eaves / 2, d / 2, CITY_BRICK);
  }
  b.wall(w, eaves - OPEN, WALL, 0, OPEN + (eaves - OPEN) / 2, d / 2, CITY_BRICK);
  // The shut bay.
  b.wall(bayW, OPEN, 0.18, -w / 2 + pierW + bayW / 2, OPEN / 2, d / 2 + 0.1, ENAMEL);

  // Columns, full height and one box each: a column is solid at every level,
  // so one box blocks the floor and the roof void together. The parkade's
  // argument, in a building with one floor to block.
  for (const x of colXs) b.wall(0.5, eaves, 0.5, x, eaves / 2, colZ, ALLOY);

  // The site office, tucked under the gallery. One box — it is cover in the
  // middle of an otherwise empty floor, and the only thing under the
  // mezzanine worth walking behind.
  b.wall(5.0, 2.7, 3.2, office.x, GROUND + 1.35, office.z, ENAMEL);

  for (const [cw, ch, cd, cx, cz] of stacks) b.wall(cw, ch, cd, cx, GROUND + ch / 2, cz, PLANK);

  // --- the roof, LAST -------------------------------------------------------
  // The collider is ONE flat slab at the eaves rather than the teeth —
  // `gableRoof`'s call, for `gableRoof`'s reason: nothing walks up there and a
  // round only has to stop. Its underside is where `drawDepot` hangs the
  // ceiling, so a round fired up inside stops where it is seen to.
  b.block({ w: w + 0.4, h: 0.4, d: d + 0.4, x: 0, y: eaves + 0.2, z: 0 });

  if (p.litWindows) {
    // Two, for `buildOffice`'s reason: this is a deep enclosed room on a
    // daylit map, and the sky term lands on the floor and not at all on the
    // ceiling — so an unlit shed reads as a bright plate under a black lid.
    // One over the floor and one over the gallery, which is the storey the
    // clerestory is furthest from.
    //
    // **The hall's one hangs AT THE GIRDERS rather than over head height**,
    // and that is what makes the ceiling read at all. Everything above the
    // point lights is on the ambient term alone in here: the sky term is zero
    // on a downward normal and the key is shadowed out by the roof, so the
    // ceiling and the steelwork are lit by this lamp or by nothing. Hung at
    // 5.6 m it lit the floor and left a black lid four metres over the
    // gallery; hung under the girders it lights both, which is also where a
    // high bay actually goes — `drawDepot` draws its fittings there.
    b.light(WINDOW_LIGHT, 24, 0.75, 0.02, 0, eaves - 1.1, d * 0.16);
    // The gallery's own, and it hangs mid-span rather than off to one side for
    // the same reason: a 27 m gallery lit from one end is a gallery whose far
    // half is on the ambient term. High, so it reaches the ceiling too.
    b.light(WINDOW_LIGHT, 20, 0.6, 0.02, 0, MEZZ + 3.2, zBack + MEZZ_D / 2);
  }
  return b;
}

/**
 * Block letters and figures as strokes on a 3 x 5 grid, x to the right and y
 * up: `[x0, y0, x1, y1]` per stroke. Painted words and cast dates — what a
 * depot's fascia, its bay numbers and its datestone say. Only the characters
 * something here spells; a new word adds its letters.
 */
const STENCIL: Record<string, readonly (readonly [number, number, number, number])[]> = {
  G: [[0, 4, 3, 5], [0, 0, 1, 5], [0, 0, 3, 1], [2, 0, 3, 2.6], [1.6, 2, 3, 2.8]],
  O: [[0, 4, 3, 5], [0, 0, 3, 1], [0, 0, 1, 5], [2, 0, 3, 5]],
  D: [[0, 0, 1, 5], [0, 4, 2.1, 5], [0, 0, 2.1, 1], [2, 0.6, 3, 4.4]],
  S: [[0, 4, 3, 5], [0, 2, 1, 5], [0, 2, 3, 3], [2, 0, 3, 3], [0, 0, 3, 1]],
  E: [[0, 0, 1, 5], [0, 4, 3, 5], [0, 2, 2.3, 3], [0, 0, 3, 1]],
  P: [[0, 0, 1, 5], [0, 4, 3, 5], [0, 2, 3, 3], [2, 2, 3, 5]],
  T: [[0, 4, 3, 5], [1, 0, 2, 5]],
  F: [[0, 0, 1, 5], [0, 4, 3, 5], [0, 2, 2.3, 3]],
  I: [[1, 0, 2, 5], [0.3, 4, 2.7, 5], [0.3, 0, 2.7, 1]],
  C: [[0, 4, 3, 5], [0, 0, 1, 5], [0, 0, 3, 1]],
  "0": [[0, 4, 3, 5], [0, 0, 3, 1], [0, 0, 1, 5], [2, 0, 3, 5]],
  "1": [[1, 0, 2, 5], [0.2, 3.7, 1, 4.6], [0.3, 0, 2.7, 1]],
  "2": [[0, 4, 3, 5], [2, 2, 3, 5], [0, 2, 3, 3], [0, 0, 1, 3], [0, 0, 3, 1]],
  "3": [[0, 4, 3, 5], [0.7, 2, 3, 3], [0, 0, 3, 1], [2, 0, 3, 5]],
  "4": [[0, 2, 1, 5], [0, 2, 3, 3], [2, 0, 3, 5]],
  "5": [[0, 4, 3, 5], [0, 2, 1, 5], [0, 2, 3, 3], [2, 0, 3, 3], [0, 0, 3, 1]],
  "6": [[0, 4, 3, 5], [0, 0, 1, 5], [0, 2, 3, 3], [2, 0, 3, 3], [0, 0, 3, 1]],
  "7": [[0, 4, 3, 5], [2, 0, 3, 5]],
  "8": [[0, 4, 3, 5], [0, 2, 3, 3], [0, 0, 3, 1], [0, 0, 1, 5], [2, 0, 3, 5]],
  "9": [[0, 4, 3, 5], [0, 2, 3, 3], [0, 0, 3, 1], [0, 2, 1, 5], [2, 0, 3, 5]],
};

/**
 * `text` laid on face `s` in `STENCIL`'s strokes, centred on `(uc, yc)` with
 * `cell` the size of one grid square. Read left to right as the face is
 * LOOKED at: a face's u runs from the viewer's right on +Z and on -X, so there
 * the line is laid backwards (the tower's ghost sign found this first).
 */
function stencil(
  sb: StoneBatch,
  s: Side,
  plane: number,
  uc: number,
  yc: number,
  cell: number,
  text: string,
  thick: number,
  out: number,
  color: string,
  hide: number,
): void {
  const dir = s === "+z" || s === "-x" ? -1 : 1;
  const pitch = cell * 4.2;
  const total = text.length * pitch - cell * 1.2;
  let u0 = uc - (dir * total) / 2;
  for (const ch of text) {
    for (const [x0, y0, x1, y1] of STENCIL[ch] ?? []) {
      const ua = u0 + dir * x0 * cell;
      const ub = u0 + dir * x1 * cell;
      const yy = yc + ((y0 + y1) / 2 - 2.5) * cell;
      sb.onFace(s, plane, (ua + ub) / 2, yy, (x1 - x0) * cell, (y1 - y0) * cell, thick, out, color, 0, 0, hide);
    }
    u0 += dir * pitch;
  }
}

/** Everything `drawDepot` reads off `buildDepot`'s plan. */
interface DepotPlan {
  w: number;
  d: number;
  eaves: number;
  tooth: number;
  mezz: number;
  mezzD: number;
  zBack: number;
  zMezz: number;
  lane: number;
  laneCx: number;
  laneInner: number;
  /** The flight's horizontal run from the floor to the gallery, its pitch and treads. */
  run: number;
  pitch: number;
  steps: number;
  open: number;
  gableH: number;
  doorAt: number;
  bays: number;
  pierW: number;
  bayW: number;
  colXs: readonly number[];
  colZ: number;
  office: { x: number; z: number };
  stacks: readonly (readonly [number, number, number, number, number])[];
  teeth: number;
  pitchZ: number;
  lit: boolean;
}

/**
 * Everything on the depot that is DRAWING, and what it draws it as: an
 * interwar railway goods shed — a brick box on a tarred plinth, its walls
 * ruled into bays by pilasters and lit by steel windows under segmental brick
 * arches, a corbel table and a stone cornice at the eaves, a north-light roof
 * of sheeted teeth, and inside, a steel frame, a steel stair and the fittings
 * of a working floor. It read as a flat red box with holes in the front and a
 * strip of glass under the eaves — and the clerestory that strip was meant to
 * be was drawn centred in the wall, inside the brick, so none of it showed
 * from either side. It emits no collider (`npm run kit:hash`).
 *
 * - **The brick elevations** (the back and both gables) are bays: a pilaster
 *   on every bay line with a stone cap where it meets the corbel table, a
 *   steel window centred in every bay, a stone sill course tying the sills
 *   together, and a tarred plinth with an air brick per bay. The gables' bays
 *   are the ROOF's — a pilaster stands under every valley, where the gutter
 *   comes out, and the downpipe runs down beside it — and the back's are its
 *   own, four to five metres. Over the eaves a gable stands on as a parapet
 *   with a stone coping and a datestone with the year cast in it.
 * - **The windows** are small-paned steel lights at the BACK of a reveal: the
 *   glass on the wall face, the frame and bars standing on it, brick jambs
 *   and a segmental arch of voussoirs round it with a stone keystone, and a
 *   stone sill under it. About a third have one light hopped open. Each is
 *   drawn again on the inside face, with a concrete sill and lintel.
 * - **The corners** are FILLED and stand proud as piers: four walls meeting
 *   on their centre lines left a 0.2 m notch at each, and above the eaves the
 *   gable's end stood back from the face below it.
 * - **The loading front**: every bay gets its shutter box (the shut one had
 *   none), with its bay number painted on it; the shut shutter is slatted
 *   across as a roller shutter is, rather than ribbed down, with a bottom rail,
 *   lifting handles and a padlock; an open one shows its bottom rail under the
 *   box. The piers' feet are painted white with black bands for drivers, and
 *   carry a stone impost where the header springs; a gooseneck lamp hangs on
 *   each pier between bays. The fascia is lettered GOODS DEPOT in a painted
 *   border, and the hoist beam gets a wall plate, a strut under it and a hook.
 * - **The side door** is a pair of steel leaves folded back flat against the
 *   gable, in brick jambs under a stone lintel, under a steel hood on two
 *   brackets with a lamp under it, on a concrete step.
 * - **The roof**: the teeth sheeted in ribs, closer glazing bars on the north
 *   lights, the ridge caps on the RIDGES (they stood on the valleys, the first
 *   one floating 1.9 m over the back eaves), and the two ventilators stood on
 *   the slope on curbs (they hovered over it).
 * - **Inside**: a CEILING at the underside of the roof's collider, carried by
 *   a steel girder under every valley — bearing on stone padstones and, on the
 *   +X gable, on internal piers — and joists on the back's bay lines, with a
 *   high-bay lamp hung from each girder and a pendant over the gallery. The
 *   ceiling is where it is because the collider is: the roof stops a round at
 *   the eaves, and a round fired up inside must stop where it is SEEN to,
 *   which with the teeth open over the hall it would not. Before this the same
 *   lid was the cornice box, 0.41 m lower and black. The columns carry flange
 *   plates and painted feet. The gallery has a channel on its edge, downstand
 *   beams under it and posts and a capping rail on its guard; the stair is
 *   steel — two stringers, open treads with painted nosings, a capping rail
 *   on its guard and a handrail on the gable. The
 *   site office gets a framed window, a framed door with a vision panel and a
 *   kick plate, a sign over the door and a clock on the gallery over it. The
 *   floor is painted — the loading line, the gallery's edge and a hatched box
 *   at the stair's foot — and carries empty pallets; the crate stacks stand
 *   on pallets, with corner battens and a lot number; the back wall under the
 *   gallery has an electrical board with its conduit, a notice board and a
 *   pallet leaning on it.
 *
 * ## The rules the drawing keeps
 *
 * **The drawing moves no collider** — the one collider this rework moved is the
 * side door's, in `buildDepot` (see its header). Everything here is on a face —
 * trim within the kit's budget, the deepest being the pilasters at 14 cm, the
 * downpipes 24 cm, the door leaves folded flat at 13 cm — low enough to walk
 * over (the painted floor at 12 mm, a pallet at 14 cm, two stacked at 25 cm,
 * the door step at 10 cm), overhead (the lamps clear the floor by 2.6 m and
 * the gallery by 2.6 m, the gallery's beams leave 2.75 m under them, the clock
 * 2.5 m, the door's hood 2.7 m), or on top of a collider (the gable copings,
 * the rails' capping, the office's roof). Nothing stands in the doorway: the
 * stair is not in front of it, and the door's leaves fold back beside it.
 *
 * Seeded off the params (`streetSeed`) as the parkade is: which windows have a
 * light open, which lamps are dead, the year on the datestone, what is pinned
 * on the notice board and the lot numbers. Not in `CONFORMS_TO_TERRAIN` — the
 * one thing that reaches the ground outside is the door step, and the shed is
 * laid on made ground by every layout that places one.
 *
 * **One colour is new to the depot**, `ASHLAR`, for the stone dressings — the
 * downtown's one light value at street level, which is what a cornice and a
 * keystone are on a brick wall — plus the `WINDOW_LIGHT` lenses of a lit
 * placement. Everything else is a colour it already wore. Batched through
 * `StoneBatch` (lenses through `flushGlow`).
 */
function drawDepot(b: Build, t: DepotPlan): void {
  const { w, d, eaves, tooth, mezz, zBack, zMezz, open, gableH, teeth, pitchZ } = t;
  // Well over a thousand boxes, and as parts each is a mesh for the merge to
  // build and throw away (`drawOffice`'s reason). Lenses in a batch of their own.
  const sb = new StoneBatch();
  const lens = new StoneBatch();
  const rnd = mulberry32(streetSeed(w, d, eaves + (t.lit ? 0.5 : 0)));
  const HW = WALL / 2;
  /** How far face `s`'s wall stands from the centre: its centre line. */
  const half = (s: Side): number => (runsAlongX(s) ? d : w) / 2;
  /** Half the length of face `s`'s run, centre line to centre line. */
  const span = (s: Side): number => (runsAlongX(s) ? w : d) / 2;
  const opp = (s: Side): Side => (s === "-z" ? "+z" : s === "+z" ? "-z" : s === "-x" ? "+x" : "-x");
  /** A member laid on the OUTSIDE of wall `s`, its centre `out` past the face. */
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
    tilt = 0,
  ): void => sb.onFace(s, half(s) + HW, u, y, along, tall, thick, out, color, tilt, 0, hide);
  /** The same on wall `s`'s INSIDE face, `out` into the room. */
  const inside = (
    s: Side,
    u: number,
    y: number,
    along: number,
    tall: number,
    thick: number,
    out: number,
    color: string,
    hide = 0,
    tilt = 0,
  ): void => sb.onFace(opp(s), -(half(s) - HW), u, y, along, tall, thick, out, color, tilt, 0, hide);
  /** A lens where the placement is lit, and the same glass dark where it is not. */
  const lamp = (lw: number, lh: number, ld: number, x: number, y: number, z: number): void => {
    if (t.lit) lens.box(lw, lh, ld, x, y, z, WINDOW_LIGHT);
    else sb.box(lw, lh, ld, x, y, z, DARK_CONCRETE);
  };
  const doorLo = t.doorAt - DOORWAY / 2;
  const doorHi = t.doorAt + DOORWAY / 2;
  /** Within `m` of the -X doorway, along that gable. */
  const nearDoor = (s: Side, u: number, m: number): boolean => s === "-x" && u > doorLo - m && u < doorHi + m;

  // The elevations' bays. The back's are its own; the gables' are the roof's,
  // one per tooth, so every valley comes down on a pilaster.
  const backN = Math.max(3, Math.round(w / 4.7));
  const bayOf = (s: Side): { n: number; pitch: number } =>
    s === "-z" ? { n: backN, pitch: w / backN } : { n: teeth, pitch: pitchZ };
  const lines = (s: Side): number[] => {
    const { n, pitch } = bayOf(s);
    const out: number[] = [];
    for (let i = 1; i < n; i++) out.push(-span(s) + i * pitch);
    return out;
  };
  const centres = (s: Side): number[] => {
    const { n, pitch } = bayOf(s);
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(-span(s) + (i + 0.5) * pitch);
    return out;
  };
  /** A pilaster's line, unless it would stand in the side door or its leaves. */
  const pilasters = (s: Side): number[] => lines(s).filter((u) => !nearDoor(s, u, 1.5));

  const PLINTH = 0.9;
  /** The windows' sill and springing line, and the rise of the arch over them. */
  const winLo = eaves - 2.7;
  const winHi = eaves - 1.2;
  const ARCH = 0.22;
  const F = 0.06;

  /** A steel window at the back of its reveal, on the outside of wall `s`. */
  const steelWindow = (s: Side, u: number, ww: number): void => {
    const hb = hideBack(s);
    const wh = winHi - winLo;
    const R = (ww * ww) / 4 / (2 * ARCH) + ARCH / 2;
    const cy = winHi + ARCH - R;
    const tMax = Math.asin(ww / 2 / R);
    /** How high the arch's soffit stands `du` from the window's centre line. */
    const soffit = (du: number): number => cy + Math.sqrt(R * R - du * du);
    // The glass, on the wall face and up into the arch: the voussoirs lap its
    // top corners. `backed`, as the clerestory always was — brick behind it.
    const c = outward(s) * (half(s) + HW + 0.02);
    const gh = wh + ARCH;
    const gy = winLo + gh / 2;
    if (runsAlongX(s)) b.pane(ww, gh, 0.04, u, gy, c, { backed: CITY_BRICK });
    else b.pane(0.04, gh, ww, c, gy, u, { backed: CITY_BRICK });
    // The frame, three rows of lights and a fan of bars into the arch.
    for (const e of [-1, 1]) face(s, u + e * (ww / 2 - F / 2), gy, F, gh, 0.05, 0.065, IRON, hb);
    face(s, u, winLo + F / 2, ww, F, 0.05, 0.065, IRON, hb);
    for (const k of [1, 2, 3]) face(s, u, winLo + (k * wh) / 3, ww - 2 * F, 0.035, 0.04, 0.06, IRON, hb);
    const nv = Math.max(3, Math.round(ww / 0.55));
    for (let k = 1; k < nv; k++) {
      const du = -ww / 2 + (k * ww) / nv;
      const top = soffit(du);
      face(s, u + du, (winLo + top) / 2, 0.035, top - winLo, 0.04, 0.06, IRON, hb);
    }
    // One light in the middle row hopped open on about a third of them, hung
    // from its bottom rail and leaning out.
    if (rnd() < 0.35) {
      const k = 1 + Math.floor(rnd() * (nv - 2));
      const du = -ww / 2 + ((k + 0.5) * ww) / nv;
      const pw = ww / nv - 0.05;
      const ph = wh / 3 - 0.05;
      const a = 0.4;
      const o = outward(s) * (half(s) + HW + 0.09 + (Math.sin(a) * ph) / 2);
      const yc = winLo + wh / 3 + 0.025 + (Math.cos(a) * ph) / 2;
      if (runsAlongX(s)) sb.box(pw, ph, 0.03, u + du, yc, o, IRON, { x: outward(s) * a });
      else sb.box(0.03, ph, pw, o, yc, u + du, IRON, { z: -outward(s) * a });
    }
    // The reveal: brick jambs, a stone sill, and the arch — voussoirs on the
    // arc, the middle one a stone keystone standing proud of the rest.
    for (const e of [-1, 1]) face(s, u + e * (ww / 2 + 0.11), (winLo + winHi) / 2, 0.22, wh, 0.1, 0.05, CITY_BRICK, hb | HIDE_UNDER);
    face(s, u, winLo - 0.05, ww + 0.4, 0.1, 0.15, 0.075, ASHLAR, hb);
    const Rm = R + 0.15;
    const n = Math.max(7, 2 * Math.round((tMax * Rm) / 0.3) + 1);
    const step = (2 * tMax) / n;
    for (let k = 0; k < n; k++) {
      const th = -tMax + (k + 0.5) * step;
      const key = k === (n - 1) / 2;
      face(
        s,
        u + Rm * Math.sin(th),
        cy + Rm * Math.cos(th) + (key ? 0.03 : 0),
        step * Rm - 0.025,
        key ? 0.38 : 0.3,
        key ? 0.14 : 0.1,
        key ? 0.07 : 0.05,
        key ? ASHLAR : CITY_BRICK,
        hb,
        -th,
      );
    }
  };

  /** The same window from inside: glass, frame and bars, a sill and a lintel. */
  const innerWindow = (s: Side, u: number, ww: number): void => {
    const hb = hideBack(opp(s));
    const wh = winHi - winLo;
    const ym = (winLo + winHi) / 2;
    const c = outward(opp(s)) * (-(half(s) - HW) + 0.02);
    if (runsAlongX(s)) b.pane(ww, wh, 0.04, u, ym, c, { backed: CITY_BRICK });
    else b.pane(0.04, wh, ww, c, ym, u, { backed: CITY_BRICK });
    for (const e of [-1, 1]) inside(s, u + e * (ww / 2 - F / 2), ym, F, wh, 0.05, 0.065, IRON, hb);
    for (const e of [-1, 1]) inside(s, u, ym + e * (wh / 2 - F / 2), ww - 2 * F, F, 0.05, 0.065, IRON, hb);
    for (const k of [1, 2]) inside(s, u, winLo + (k * wh) / 3, ww - 2 * F, 0.035, 0.04, 0.06, IRON, hb);
    const nv = Math.max(3, Math.round(ww / 0.55));
    for (let k = 1; k < nv; k++) inside(s, u - ww / 2 + (k * ww) / nv, ym, 0.035, wh - 2 * F, 0.04, 0.06, IRON, hb);
    inside(s, u, winLo - 0.04, ww + 0.2, 0.08, 0.12, 0.06, CONCRETE, hb);
    inside(s, u, winHi + 0.15, ww + 0.4, 0.3, 0.05, 0.025, CONCRETE, hb);
  };

  // --- the brick elevations: the back and both gables ------------------------

  for (const s of ["-z", "-x", "+x"] as const) {
    const hb = hideBack(s);
    const h = span(s);
    const pils = pilasters(s);
    const door: [number, number][] = s === "-x" ? [[doorLo - 0.22, doorHi + 0.22]] : [];
    // The plinth: tarred, which is what the foot of a brick shed is, with a
    // set-back course on top so the step reads as a weathering.
    for (const [a, z] of carve(-h + HW, h - HW, door)) {
      face(s, (a + z) / 2, PLINTH / 2, z - a, PLINTH, 0.07, 0.035, DARK_CONCRETE, hb | HIDE_UNDER);
      face(s, (a + z) / 2, PLINTH + 0.03, z - a, 0.06, 0.035, 0.0175, DARK_CONCRETE, hb);
    }
    // Pilasters on the bay lines, each on a plinth block, under a stone cap
    // where it meets the corbel table.
    const pilTop = eaves - 0.64;
    for (const u of pils) {
      face(s, u, pilTop / 2, 0.56, pilTop, 0.14, 0.07, CITY_BRICK, hb | HIDE_UNDER);
      face(s, u, PLINTH / 2, 0.68, PLINTH, 0.2, 0.1, DARK_CONCRETE, hb | HIDE_UNDER);
      face(s, u, pilTop + 0.11, 0.66, 0.22, 0.2, 0.1, ASHLAR, hb);
    }
    // The sill course, between the pilasters, a hand under the sills.
    for (const [a, z] of carve(-h + HW, h - HW, pils.map((u): [number, number] => [u - 0.28, u + 0.28]))) {
      face(s, (a + z) / 2, winLo - 0.16, z - a, 0.1, 0.06, 0.03, ASHLAR, hb);
    }
    // A window in every bay, from both sides; an air brick in the plinth.
    const { pitch } = bayOf(s);
    for (const u of centres(s)) {
      steelWindow(s, u, pitch - 1.7);
      innerWindow(s, u, pitch - 1.7);
      if (!nearDoor(s, u, 0.4)) face(s, u, 0.45, 0.24, 0.16, 0.08, 0.04, IRON, hb);
    }
  }

  // Tie plates on the back, where the gallery's beams are anchored through it.
  for (const u of centres("-z")) {
    const hb = hideBack("-z");
    for (const a of [-Math.PI / 4, Math.PI / 4]) face("-z", u, mezz - 0.25, 0.46, 0.06, 0.025, 0.0125, IRON, hb, a);
    face("-z", u, mezz - 0.25, 0.09, 0.09, 0.06, 0.03, IRON, hb);
  }

  // The corbel table, the bed course over it and the stone cornice, round all
  // four sides. The dentils stop at the pilasters, which rise into the table.
  for (const s of ["-z", "+z", "-x", "+x"] as const) {
    const hb = hideBack(s);
    const h = span(s);
    const cuts = s === "+z" ? [] : pilasters(s).map((u): [number, number] => [u - 0.36, u + 0.36]);
    for (const [a, z] of carve(-h + HW + 0.05, h - HW - 0.05, cuts)) {
      const n = Math.floor((z - a) / 0.3);
      const u0 = (a + z) / 2 - ((n - 1) * 0.3) / 2;
      for (let k = 0; k < n; k++) face(s, u0 + k * 0.3, eaves - 0.49, 0.13, 0.14, 0.1, 0.05, CITY_BRICK, hb | HIDE_TOP);
    }
    face(s, 0, eaves - 0.36, 2 * (h + HW + 0.1), 0.12, 0.1, 0.05, CITY_BRICK, hb);
    face(s, 0, eaves - 0.15, 2 * (h + HW + 0.22), 0.3, 0.62, 0.22 - 0.31, ASHLAR);
  }

  // The corners: filled, and standing proud as piers. Above the eaves the
  // gable's own end is the wall's centre line, a hand back from the face
  // below, and it is closed up to the coping.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const top = eaves - 0.42;
      sb.box(0.48, top, 0.48, sx * (w / 2 + 0.04), top / 2, sz * (d / 2 + 0.04), CITY_BRICK, undefined, HIDE_UNDER);
      sb.box(0.52, PLINTH, 0.52, sx * (w / 2 + 0.07), PLINTH / 2, sz * (d / 2 + 0.07), DARK_CONCRETE, undefined, HIDE_UNDER);
      sb.box(WALL, gableH - eaves, HW, (sx * w) / 2, (eaves + gableH) / 2, sz * (d / 2 + HW / 2), CITY_BRICK);
    }
  }
  // The gable parapets: a coping, and a datestone with the year cast in it on
  // a dark ground — a figure flush with stone of its own colour does not read.
  const year = String(1904 + Math.floor(rnd() * 32));
  for (const s of ["-x", "+x"] as const) {
    const hb = hideBack(s);
    sb.box(0.56, 0.1, d + 0.52, outward(s) * (w / 2), gableH + 0.05, 0, ASHLAR);
    const y = eaves + 0.95;
    face(s, 0, y, 1.3, 0.66, 0.04, 0.02, DARK_CONCRETE, hb);
    for (const e of [-1, 1]) {
      face(s, 0, y + e * 0.36, 1.46, 0.1, 0.09, 0.045, ASHLAR, hb);
      face(s, e * 0.68, y, 0.1, 0.62, 0.09, 0.045, ASHLAR, hb);
    }
    stencil(sb, s, half(s) + HW, 0, y, 0.07, year, 0.05, 0.065, ASHLAR, hb);
  }

  // Rainwater goods on the gables: a hopper at every valley's outlet and at
  // the back eaves, the pipe beside its pilaster, brackets and a shoe.
  for (const s of ["-x", "+x"] as const) {
    const hb = hideBack(s);
    const zs = [-(d / 2 - 0.4)];
    for (let i = 1; i < teeth; i++) zs.push(-d / 2 + i * pitchZ - 0.45);
    for (const u of zs) {
      if (nearDoor(s, u, 1.4)) continue;
      const top = eaves - 0.95;
      b.cyl(top - 0.2, 0.15, 0.15, 6, outward(s) * (w / 2 + HW + 0.16), 0.2 + (top - 0.2) / 2, u, IRON);
      face(s, u, eaves - 0.8, 0.36, 0.3, 0.3, 0.16, IRON, hb);
      face(s, u, eaves - 0.98, 0.2, 0.08, 0.22, 0.13, IRON, hb);
      face(s, u, 0.12, 0.2, 0.18, 0.38, 0.19, IRON, hb);
      for (let y = 1.6; y < top - 0.3; y += 1.8) face(s, u, y, 0.24, 0.05, 0.16, 0.08, IRON, hb);
    }
  }

  // --- the loading front --------------------------------------------------------
  const hbF = hideBack("+z");
  const fz = d / 2 + HW;
  for (let i = 0; i <= t.bays; i++) {
    const px = -w / 2 + t.pierW / 2 + i * (t.pierW + t.bayW);
    // The pier's face between the shutter guides and clear of a corner pier.
    const a = i === 0 ? -w / 2 + HW + 0.02 : px - t.pierW / 2 + 0.1;
    const z = i === t.bays ? w / 2 - HW - 0.02 : px + t.pierW / 2 - 0.1;
    // Painted feet, for drivers: white, with two black bands.
    face("+z", (a + z) / 2, 0.6, z - a, 1.2, 0.012, 0.006, ROAD_PAINT, hbF | HIDE_UNDER);
    for (const y of [0.45, 1.05]) face("+z", (a + z) / 2, y, z - a, 0.3, 0.018, 0.009, IRON, hbF);
    // A stone impost where the header springs.
    face("+z", (a + z) / 2, open - 0.1, z - a, 0.2, 0.12, 0.06, ASHLAR, hbF);
    // A gooseneck lamp on each pier between two bays — but not under the hoist.
    if (i > 0 && i < t.bays && Math.abs(px) > 0.5) {
      const y = open + 0.42;
      face("+z", px, y + 0.1, 0.16, 0.3, 0.04, 0.02, IRON, hbF);
      sb.box(0.06, 0.06, 0.66, px, y + 0.2, fz + 0.35, ALLOY);
      sb.box(0.06, 0.2, 0.06, px, y + 0.1, fz + 0.68, ALLOY);
      sb.box(0.42, 0.12, 0.42, px, y - 0.04, fz + 0.68, ALLOY);
      sb.box(0.22, 0.08, 0.22, px, y + 0.06, fz + 0.68, ALLOY);
      lamp(0.32, 0.02, 0.32, px, y - 0.105, fz + 0.68);
    }
  }
  for (let i = 0; i < t.bays; i++) {
    const x = -w / 2 + t.pierW + t.bayW / 2 + i * (t.pierW + t.bayW);
    const bw = t.bayW;
    // The shutter box over every bay, its end plates, and its bay number,
    // counted from the left as the yard reads them.
    sb.box(bw, 0.62, 0.5, x, open + 0.31, d / 2 + 0.2, ENAMEL);
    for (const e of [-1, 1]) sb.box(0.05, 0.68, 0.54, x + e * (bw / 2 + 0.02), open + 0.31, d / 2 + 0.2, IRON);
    stencil(sb, "+z", d / 2 + 0.45, x, open + 0.31, 0.06, String(t.bays - i), 0.012, 0.006, ROAD_PAINT, hbF);
    // The guides down each jamb, and the dock bumpers a lorry has been hitting.
    for (const e of [-1, 1]) sb.box(0.18, open, 0.3, x + (e * bw) / 2, open / 2, d / 2 + 0.16, ALLOY);
    for (const e of [-1, 1]) sb.box(0.3, 0.5, 0.28, x + (e * (bw + 0.3)) / 2, 0.85, d / 2 + 0.24, IRON);
    if (i > 0) {
      // Rolled up: its bottom rail and handles under the box.
      sb.box(bw - 0.1, 0.1, 0.07, x, open - 0.04, d / 2 + 0.16, IRON);
      for (const e of [-1, 1]) sb.box(0.14, 0.04, 0.05, x + e * bw * 0.25, open - 0.12, d / 2 + 0.2, IRON);
    } else {
      // Rolled down: slats across the curtain as a roller shutter has them,
      // the bottom rail, two lifting handles and the padlock on its hasp.
      for (let y = 0.3; y < open - 0.05; y += 0.14) {
        sb.box(bw - 0.06, 0.03, 0.03, x, y, d / 2 + 0.205, ENAMEL, undefined, HIDE_UNDER);
      }
      sb.box(bw - 0.04, 0.16, 0.06, x, 0.12, d / 2 + 0.21, IRON);
      for (const e of [-1, 1]) sb.box(0.16, 0.05, 0.06, x + e * bw * 0.3, 0.3, d / 2 + 0.24, IRON);
      sb.box(0.08, 0.1, 0.05, x + bw * 0.3 + 0.14, 0.17, d / 2 + 0.26, ALLOY);
    }
  }
  // The fascia: lettered in a painted border.
  {
    const sw = w * 0.42;
    const sy = eaves - 1.1;
    face("+z", 0, sy, sw, 0.9, 0.16, 0.08, DARK_CONCRETE, hbF);
    for (const e of [-1, 1]) {
      face("+z", 0, sy + e * 0.36, sw - 0.16, 0.035, 0.015, 0.1675, ROAD_PAINT, hbF);
      face("+z", e * (sw / 2 - 0.08), sy, 0.035, 0.755, 0.015, 0.1675, ROAD_PAINT, hbF);
    }
    stencil(sb, "+z", fz + 0.16, 0, sy, 0.1, "GOODS DEPOT", 0.015, 0.0075, ROAD_PAINT, hbF);
  }
  // The hoist beam over the middle of the front — the one thing that projects
  // from this building and most of its silhouette from the street — on a wall
  // plate with a strut under it, its block, its chain and a hook.
  {
    sb.box(0.34, 0.5, 2.6, 0, open + 1.5, d / 2 + 1.0, ALLOY);
    sb.box(0.7, 0.3, 0.7, 0, open + 1.5, d / 2 + 2.1, DARK_CONCRETE);
    b.cyl(0.9, 0.1, 0.1, 5, 0, open + 0.9, d / 2 + 2.1, IRON);
    face("+z", 0, open + 1.05, 0.5, 0.8, 0.04, 0.02, IRON, hbF);
    const ang = Math.atan2(0.5, 1.2);
    sb.box(0.12, 0.12, Math.hypot(1.2, 0.5), 0, open + 1.0, fz + 0.6, ALLOY, { x: -ang });
    sb.box(0.2, 0.26, 0.14, 0, open + 0.33, d / 2 + 2.1, IRON);
    sb.box(0.05, 0.18, 0.05, 0, open + 0.12, d / 2 + 2.1, IRON);
    sb.box(0.16, 0.05, 0.05, 0, open + 0.04, d / 2 + 2.08, IRON);
  }

  // --- the side door ---------------------------------------------------------------
  {
    const s = "-x" as const;
    const hb = hideBack(s);
    const gx = -(w / 2 + HW);
    for (const e of [-1, 1]) face(s, t.doorAt + e * (DOORWAY / 2 + 0.11), 1.2, 0.22, 2.4, 0.08, 0.04, CITY_BRICK, hb | HIDE_UNDER);
    face(s, t.doorAt, 2.55, DOORWAY + 0.64, 0.3, 0.14, 0.07, ASHLAR, hb);
    // The leaves, folded back flat against the gable either side.
    for (const e of [-1, 1]) {
      const u = t.doorAt + e * (DOORWAY / 2 + 0.68);
      face(s, u, 1.2, 0.88, 2.3, 0.05, 0.11, ENAMEL, hb | HIDE_UNDER);
      for (const y of [0.55, 1.2, 1.85]) face(s, u, y, 0.8, 0.06, 0.02, 0.145, IRON, hb);
      face(s, u, 0.2, 0.8, 0.26, 0.012, 0.141, ALLOY, hb);
    }
    // The hood on its two brackets, a drip at its edge and a lamp under it.
    face(s, t.doorAt, 2.95, DOORWAY + 0.9, 0.08, 0.95, 0.475, ENAMEL, hb);
    face(s, t.doorAt, 3.01, DOORWAY + 0.9, 0.04, 0.12, 0.89, IRON, hb);
    const ang = Math.atan2(0.5, 0.8);
    for (const e of [-1, 1]) {
      sb.box(Math.hypot(0.8, 0.5), 0.06, 0.06, gx - 0.4, 2.66, t.doorAt + e * (DOORWAY / 2 + 0.35), IRON, { z: -ang });
    }
    lamp(0.18, 0.02, 0.3, gx - 0.5, 2.9, t.doorAt);
    sb.box(DOORWAY + 0.5, 0.1, 0.7, gx - 0.35, 0.05, t.doorAt, CONCRETE, undefined, HIDE_UNDER);
  }

  // --- the roof ----------------------------------------------------------------------
  // A sawtooth: a pitched slab per tooth with its glazed face standing up at
  // the high end. CONCRETE and not `SLATE`, which is the parkade's deck
  // argument: asbestos-cement sheeting is pale, and ribbed.
  const toothPitch = Math.atan(tooth / pitchZ);
  const slope = Math.hypot(pitchZ, tooth);
  /** A tooth's top face normal, as (y, z). */
  const ny = Math.cos(toothPitch);
  const nz = -Math.sin(toothPitch);
  const gw = w - 1.4;
  for (let i = 0; i < teeth; i++) {
    const z0 = -d / 2 + i * pitchZ;
    const zc = z0 + pitchZ / 2;
    const yc = eaves + tooth / 2;
    sb.box(w - WALL, 0.26, slope, 0, yc, zc, CONCRETE, { x: -toothPitch });
    const nr = Math.floor((w - WALL) / 1.0);
    for (let k = 0; k < nr; k++) {
      const x = -(w - WALL) / 2 + ((k + 0.5) * (w - WALL)) / nr;
      sb.box(0.06, 0.05, slope - 0.12, x, yc + 0.155 * ny, zc + 0.155 * nz, CONCRETE, { x: -toothPitch }, HIDE_UNDER);
    }
    // The ridge cap, on the ridge.
    sb.box(w - WALL + 0.2, 0.2, 0.34, 0, eaves + tooth + 0.06, z0 + pitchZ - 0.1, SLATE);
    // The north light. Glazing on a roof void, so it is decoration by the same
    // test the curtain walls pass — see the header. Barred as patent glazing.
    b.pane(gw, tooth - 0.5, 0.12, 0, eaves + tooth / 2, z0 + pitchZ);
    sb.box(w - WALL, 0.22, 0.3, 0, eaves + tooth - 0.12, z0 + pitchZ, ALLOY);
    sb.box(w - WALL, 0.22, 0.3, 0, eaves + 0.12, z0 + pitchZ, ALLOY);
    const nb = Math.round(gw / 0.9);
    for (let j = 1; j < nb; j++) sb.box(0.05, tooth - 0.4, 0.2, -gw / 2 + (j / nb) * gw, eaves + tooth / 2, z0 + pitchZ, ALLOY);
    // The purlins under the sheeting, seen through the glazing of the tooth
    // behind.
    for (let j = 1; j < 3; j++) {
      const f = j / 3;
      sb.box(w - WALL, 0.14, 0.14, 0, eaves + tooth * f - 0.22, z0 + pitchZ * f, ALLOY);
    }
    // A ventilator on every other tooth, on a curb on the slope.
    if (i % 2 === 0) {
      const zv = z0 + pitchZ * 0.6;
      const yr = eaves + (tooth * (zv - z0)) / pitchZ + 0.14;
      sb.box(0.9, 0.5, 0.9, w * 0.3, yr + 0.05, zv, ALLOY, undefined, HIDE_UNDER);
      b.cyl(0.6, 0.62, 0.7, 8, w * 0.3, yr + 0.6, zv, ALLOY);
      b.cyl(0.08, 0.95, 0.95, 8, w * 0.3, yr + 0.97, zv, ALLOY);
      b.cyl(0.12, 0.3, 0.6, 8, w * 0.3, yr + 1.07, zv, ALLOY);
    }
  }

  // --- inside ------------------------------------------------------------------------

  // The ceiling, at the underside of the roof's collider, and the steel that
  // carries it: a girder under every valley and a joist on every one of the
  // back's bay lines. See the header on why there is a ceiling at all.
  sb.box(w - WALL, 0.06, d - WALL, 0, eaves + 0.03, 0, CONCRETE);
  const valleys: number[] = [];
  for (let i = 1; i < teeth; i++) valleys.push(-d / 2 + i * pitchZ);
  for (const z of valleys) {
    sb.box(w - WALL, 0.45, 0.3, 0, eaves - 0.225, z, ALLOY, undefined, HIDE_TOP);
    for (const s of ["-x", "+x"] as const) inside(s, z, eaves - 0.55, 0.5, 0.2, 0.12, 0.06, ASHLAR, hideBack(opp(s)));
    inside("+x", z, (eaves - 0.65) / 2, 0.5, eaves - 0.65, 0.08, 0.04, CITY_BRICK, hideBack("-x"));
  }
  for (const u of lines("-z")) {
    sb.box(0.14, 0.2, d - WALL, u, eaves - 0.1, 0, ALLOY, undefined, HIDE_TOP);
    inside("-z", u, eaves / 2, 0.5, eaves, 0.08, 0.04, CITY_BRICK, hideBack("+z"));
  }
  /** A high-bay fitting hung from `top`: its rod, its gear tray, its reflector and the lamp. */
  const pendant = (x: number, y: number, z: number, top: number): void => {
    sb.box(0.03, top - y, 0.03, x, (top + y) / 2, z, IRON);
    sb.box(0.26, 0.12, 0.26, x, y + 0.13, z, ALLOY);
    sb.box(0.5, 0.18, 0.5, x, y - 0.02, z, ALLOY);
    if (rnd() < 0.12) sb.box(0.4, 0.02, 0.4, x, y - 0.12, z, DARK_CONCRETE);
    else lamp(0.4, 0.02, 0.4, x, y - 0.12, z);
  };
  for (const z of valleys) {
    if (z < zMezz + 0.5) continue;
    for (const x of [-w / 3, 0, w / 3]) pendant(x, eaves - 1.1, z, eaves - 0.45);
  }
  for (const x of [-w / 3, 0, w / 3]) {
    if (x < t.laneInner + 0.5) continue;
    pendant(x, Math.min(mezz + 3.2, eaves - 0.6), zBack + t.mezzD / 2, eaves);
  }

  // The columns: flange plates, the stanchion's brackets under the girder,
  // the pad, and the feet painted for the forklifts.
  for (const x of t.colXs) {
    const z = t.colZ;
    sb.box(0.9, 0.16, 0.9, x, 0.28, z, DARK_CONCRETE);
    const fh = eaves - 0.45 - 1.6;
    for (const sz of [-1, 1]) sb.box(0.6, fh, 0.03, x, 1.6 + fh / 2, z + sz * 0.265, ALLOY);
    for (const sz of [-1, 1]) sb.box(0.34, 0.6, 0.34, x, eaves - 0.75, z + sz * 0.3, ALLOY);
    sb.box(0.52, 1.2, 0.52, x, 0.96, z, ROAD_PAINT, undefined, HIDE_UNDER | HIDE_TOP);
    for (const y of [0.81, 1.41]) sb.box(0.53, 0.3, 0.53, x, y, z, IRON, undefined, HIDE_UNDER | HIDE_TOP);
  }

  // The gallery: a channel on its edge (stopping at the lane, where the
  // stair's head is), beams under it from the back wall clear of the office,
  // and posts and a capping rail on its guard.
  {
    const x0 = t.laneInner;
    const x1 = w / 2 - HW;
    sb.box(x1 - x0, SLAB + 0.12, 0.05, (x0 + x1) / 2, mezz - (SLAB + 0.12) / 2 - 0.01, zMezz + 0.025, ALLOY);
    for (const u of lines("-z")) {
      if (u < x0 + 0.3 || Math.abs(u - t.office.x) < 2.8) continue;
      sb.box(0.2, 0.35, t.mezzD, u, mezz - SLAB - 0.175, zBack + t.mezzD / 2, ALLOY, undefined, HIDE_TOP);
    }
    sb.box(x1 - x0 + 0.04, 0.06, 0.26, (x0 + x1) / 2, mezz + 1.13, zMezz + 0.08, ALLOY);
    const np = Math.max(2, Math.round((x1 - x0) / 1.6));
    for (let k = 0; k <= np; k++) {
      const x = x0 + (k / np) * (x1 - x0);
      for (const e of [-1, 1]) sb.box(0.07, 1.1, 0.02, x, mezz + 0.55, zMezz + 0.08 + e * 0.09, IRON);
    }
  }

  // The stair, as steel: two stringers on the pitch, open treads on the
  // flight's own lines with a painted nosing and the angle under it, and the
  // guard capped and posted. `Build.flight`'s tread arithmetic, restated.
  {
    const sAt = (z: number): number => mezz + (zMezz - z) * GRADE;
    const L = t.run / Math.cos(t.pitch);
    const zc = zMezz + t.run / 2;
    for (const x of [-w / 2 + HW + 0.06, t.laneInner - 0.08]) {
      sb.box(0.1, 0.36, L, x, sAt(zc) - 0.08, zc, ALLOY, { x: t.pitch });
    }
    const runO = t.run + 0.6;
    const tread = runO / t.steps;
    const footZ = zMezz + runO;
    for (let i = 0; i < t.steps; i++) {
      const z = footZ - (i + 0.5) * tread;
      const y = sAt(z);
      if (y < 0.12) continue;
      sb.box(t.lane - 0.2, 0.05, tread + 0.03, t.laneCx, y - 0.005, z, ALLOY);
      sb.box(t.lane - 0.2, 0.012, 0.05, t.laneCx, y + 0.026, z + tread / 2 - 0.01, ROAD_PAINT);
      sb.box(t.lane - 0.2, 0.08, 0.04, t.laneCx, y - 0.06, z + tread / 2, IRON);
    }
    const gx = t.laneInner + 0.08;
    sb.box(0.26, 0.06, L, gx, sAt(zc) + 1.1 + 0.03 / Math.cos(t.pitch), zc, ALLOY, { x: t.pitch });
    const np = Math.max(2, Math.round(t.run / 1.6));
    for (let k = 0; k <= np; k++) {
      const z = zMezz + (k / np) * t.run;
      for (const e of [-1, 1]) sb.box(0.02, 1.1, 0.07, gx + e * 0.09, sAt(z) + 0.55, z, IRON);
    }
    // The handrail on the gable, broken for the door should one ever stand
    // along the flight.
    for (const [a, z] of carve(zMezz, zMezz + t.run, [[doorLo - 0.15, doorHi + 0.15]])) {
      if (z - a < 0.4) continue;
      const m = (a + z) / 2;
      inside("-x", m, sAt(m) + 0.9, (z - a) / Math.cos(t.pitch), 0.05, 0.05, 0.11, ALLOY, 0, -t.pitch);
      for (let q = a + 0.2; q < z; q += 1.4) inside("-x", q, sAt(q) + 0.86, 0.04, 0.1, 0.08, 0.04, IRON);
    }
  }

  // The site office: its roof, a framed window of three lights, a framed door
  // with a vision panel, a handle and a kick plate, the sign over it, and a
  // clock hung under the gallery's edge above.
  {
    const { x: ox, z: oz } = t.office;
    const of = oz + 1.6;
    const hb = hideBack("+z");
    const on = (u: number, y: number, a: number, h: number, th: number, out: number, color: string): void =>
      sb.onFace("+z", of, u, y, a, h, th, out, color, 0, 0, hb);
    sb.box(5.2, 0.16, 3.4, ox, GROUND + 2.78, oz, DARK_CONCRETE);
    b.pane(3.0, 1.1, 0.1, ox - 0.6, GROUND + 1.9, of, { backed: ENAMEL });
    on(ox - 0.6, GROUND + 2.47, 3.1, 0.06, 0.04, 0.07, IRON);
    on(ox - 0.6, GROUND + 1.33, 3.1, 0.06, 0.04, 0.07, IRON);
    for (const e of [-1, 1]) on(ox - 0.6 + e * 1.52, GROUND + 1.9, 0.06, 1.2, 0.04, 0.07, IRON);
    for (const e of [-1, 1]) on(ox - 0.6 + e * 0.5, GROUND + 1.9, 0.04, 1.1, 0.03, 0.065, IRON);
    on(ox - 0.6, GROUND + 1.28, 3.2, 0.05, 0.14, 0.07, ALLOY);
    const dx = ox + 1.8;
    on(dx, GROUND + 1.1, 1.0, 2.2, 0.06, 0.03, TEAK);
    for (const e of [-1, 1]) on(dx + e * 0.53, GROUND + 1.13, 0.06, 2.26, 0.08, 0.04, IRON);
    on(dx, GROUND + 2.23, 1.12, 0.06, 0.08, 0.04, IRON);
    on(dx, GROUND + 1.6, 0.3, 0.45, 0.01, 0.065, IRON);
    on(dx - 0.36, GROUND + 1.05, 0.14, 0.04, 0.05, 0.085, ALLOY);
    on(dx, GROUND + 0.13, 0.9, 0.22, 0.01, 0.065, ALLOY);
    on(dx, GROUND + 2.5, 0.95, 0.24, 0.02, 0.01, ROAD_PAINT);
    stencil(sb, "+z", of + 0.02, dx, GROUND + 2.5, 0.032, "OFFICE", 0.008, 0.004, DARK_CONCRETE, hb);
    // The clock.
    const cz = zMezz + 0.05;
    const cy = mezz - 0.85;
    sb.box(0.04, 0.26, 0.04, ox, mezz - 0.6, cz + 0.03, IRON);
    sb.box(0.44, 0.44, 0.05, ox, cy, cz + 0.045, IRON);
    sb.box(0.38, 0.38, 0.02, ox, cy, cz + 0.075, ROAD_PAINT);
    for (const [len, a] of [
      [0.1, rnd() * Math.PI * 2],
      [0.15, rnd() * Math.PI * 2],
    ] as const) {
      sb.onFace("+z", cz, ox + (Math.sin(a) * len) / 2, cy + (Math.cos(a) * len) / 2, 0.022, len, 0.01, 0.09, IRON, -a);
    }
  }

  // The back wall under the gallery: the electrical board and its conduit up
  // to the gallery's soffit, a pallet leaned on the wall and a notice board.
  {
    const cs = centres("-z");
    const hb = hideBack("+z");
    const soffit = mezz - SLAB;
    if (cs.length > 1) {
      const u = cs[1];
      inside("-z", u, 1.55, 0.7, 0.9, 0.12, 0.06, ENAMEL, hb);
      inside("-z", u, 1.55, 0.01, 0.84, 0.01, 0.125, IRON, hb);
      inside("-z", u + 0.22, 1.85, 0.12, 0.08, 0.01, 0.125, ROAD_PAINT, hb);
      for (const k of [-1, 0, 1]) inside("-z", u + k * 0.2, (2.0 + soffit) / 2, 0.04, soffit - 2.0, 0.04, 0.02, ALLOY, hb);
    }
    if (cs.length > 2) {
      const u = cs[2];
      for (let k = 0; k < 5; k++) inside("-z", u, GROUND + 0.16 + k * 0.22, 1.2, 0.12, 0.025, 0.125, PLANK, hb);
      for (const e of [-1, 0, 1]) inside("-z", u + e * 0.55, GROUND + 0.6, 0.1, 1.0, 0.1, 0.05, TEAK, hb);
    }
    if (cs.length > 3) {
      const u = cs[3];
      inside("-z", u, 1.6, 1.2, 0.8, 0.03, 0.015, PLANK, hb);
      for (let k = 0; k < 5; k++) {
        const pu = u - 0.45 + rnd() * 0.9;
        const py = 1.35 + rnd() * 0.5;
        inside("-z", pu, py, 0.18, 0.25, 0.01, 0.035, ROAD_PAINT, hb, (rnd() - 0.5) * 0.15);
      }
    }
  }

  // The crate stacks: each on a pallet, with corner battens, the bands it was
  // strapped with and a lot number on the face to the bays.
  for (const [cw, ch, cd, cx, cz] of t.stacks) {
    for (let i = 1; i * 0.75 < ch; i++) sb.box(cw + 0.08, 0.1, cd + 0.08, cx, GROUND + i * 0.75, cz, TEAK);
    sb.box(cw + 0.02, 0.07, cd + 0.02, cx, GROUND + 0.065, cz, DARK_CONCRETE, undefined, HIDE_UNDER | HIDE_TOP);
    sb.box(cw + 0.03, 0.03, cd + 0.03, cx, GROUND + 0.125, cz, PLANK, undefined, HIDE_UNDER | HIDE_TOP);
    for (const e of [-1, 0, 1]) {
      for (const f of [-1, 1]) {
        sb.box(0.14, 0.07, 0.03, cx + e * (cw / 2 - 0.08), GROUND + 0.065, cz + f * (cd / 2 + 0.01), TEAK);
        sb.box(0.03, 0.07, 0.14, cx + f * (cw / 2 + 0.01), GROUND + 0.065, cz + e * (cd / 2 - 0.08), TEAK);
      }
    }
    for (const ex of [-1, 1]) {
      for (const ez of [-1, 1]) {
        sb.box(0.1, ch - 0.16, 0.1, cx + ex * (cw / 2 - 0.04), GROUND + 0.16 + (ch - 0.16) / 2, cz + ez * (cd / 2 - 0.04), TEAK);
      }
    }
    const lot = String(10 + Math.floor(rnd() * 89));
    stencil(sb, "+z", cz + cd / 2, cx, GROUND + 0.55, 0.04, lot, 0.01, 0.005, ROAD_PAINT, hideBack("+z"));
  }

  // The floor, painted: the loading line, the gallery's edge, and a hatched
  // box at the stair's foot — 12 mm, so nothing trips and nothing strobes.
  {
    const paint = (len: number, wid: number, x: number, z: number, rotY = 0): void =>
      sb.box(len, 0.012, wid, x, GROUND + 0.006, z, ROAD_PAINT, rotY ? { y: rotY } : undefined, HIDE_UNDER);
    const x0 = t.laneInner + 0.4;
    const x1 = w / 2 - HW - 0.6;
    paint(x1 - x0, 0.1, (x0 + x1) / 2, d / 2 - 3.2);
    paint(x1 - x0, 0.1, (x0 + x1) / 2, zMezz + 0.7);
    const z0 = zMezz + t.run + 0.15;
    const z1 = Math.min(d / 2 - HW - 0.15, z0 + 1.4);
    if (z1 - z0 > 0.6) {
      const hw = (t.lane - 0.2) / 2;
      const D = z1 - z0;
      for (const e of [-1, 1]) {
        paint(2 * hw, 0.08, t.laneCx, (z0 + z1) / 2 + e * (D / 2 - 0.04));
        paint(0.08, D, t.laneCx + e * (hw - 0.04), (z0 + z1) / 2);
      }
      for (let xk = t.laneCx - hw + D / 2; xk <= t.laneCx + hw - D / 2 + 1e-6; xk += 0.5) {
        paint(0.08, D * Math.SQRT2 - 0.12, xk, (z0 + z1) / 2, Math.PI / 4);
      }
    }
    // Empty pallets, lying where a forklift left them — two of them stacked.
    const pallet = (x: number, y: number, z: number): void => {
      for (const e of [-1, 0, 1]) sb.box(0.1, 0.1, 1.0, x + e * 0.55, y + 0.05, z, TEAK, undefined, HIDE_UNDER);
      for (let k = 0; k < 5; k++) sb.box(1.2, 0.025, 0.12, x, y + 0.1125, z - 0.44 + k * 0.22, PLANK, undefined, HIDE_UNDER);
    };
    pallet(w * 0.04 + 2.2, GROUND, zMezz + 1.6);
    pallet(-w * 0.08, GROUND, d / 2 - 1.6);
    pallet(-w * 0.08, GROUND + 0.125, d / 2 - 1.6);
    pallet(w * 0.36, mezz, zBack + 0.8);
    pallet(-w * 0.04, mezz, zBack + 0.8);
  }

  sb.flush(b);
  lens.flushGlow(b);
}

/**
 * A planter's soil: dark, because the bed is an up-facing surface and the sky
 * term brings every one of those back a stop and a half lighter than its hex.
 */
const PLANTER_SOIL = "#3b3226";
/**
 * Leaves in one planter's crown, the whole of its vertex budget bar ~2 k: six
 * vertices a leaf (two facets, one face), so this is ~5.4 k a placement and
 * the planter ~8 k — a structure's share, on the map that places eleven.
 */
const PLANTER_LEAVES = 900;

/**
 * A concrete planter: the street's low cover, and the only green on the map.
 *
 * The shrub is drawn 0.3 m proud of the collider on purpose. A planter is cover
 * you crouch behind and a shrub is not, so the box stops at the rim and the
 * foliage above it is a silhouette a round goes through — the same call
 * `buildFernClump` makes, and the reason `PROP_BODIES` keeps a tree's collider
 * to its trunk.
 *
 * What it is drawn as is the precast trough every council of the period set
 * along a precinct — and later along a frontage it wanted kept clear of a
 * lorry, which is the cover it is here:
 *
 * - **A body cast in one piece**, its four vertical arrises chamfered, standing
 *   on a TOE set back into a shadow gap so the unit reads as set down on the
 *   paving rather than growing out of it. The toe is carried down to the
 *   lowest ground under the four corners.
 * - **Fluted faces**: vertical ribs 3.5 cm proud between a plain margin at the
 *   foot and one under the coping — a step the ink draws, where a board-marked
 *   or exposed-aggregate finish would only be a texture this look cannot draw.
 * - **A coping** overhanging the ribs, its inner edge a real rim with the soil
 *   sunk 7 cm below it, so the bed reads as filled rather than as a lid. One
 *   corner of it is sometimes knocked off, and the piece lies at the foot.
 * - **Bark mulch** on the soil, and **one of three plantings**, seeded:
 *   clipped box balls; a loose evergreen shrub on visible stems; or a bed
 *   nobody has tended — the bare frame of a shrub, a third of it dead, its
 *   last leaves bunched at the living tips, dead leaves and weeds on the soil.
 *   Every leaf is a plate laid tangent to a billow over a dark core, so the
 *   gaps between leaves read as depth rather than as sky.
 * - **Ivy** spilling over the coping and down a face or two, seeded.
 *
 * The collider is unchanged. Everything drawn is flat on a face (ribs, coping,
 * ivy — at most 7 cm proud), low (the toe, the fallen piece), or above the
 * collider's top (the bed and what grows in it). The chipped corner takes 5 cm
 * off the coping over a 0.25 m run, which is as far as a round stops on air.
 * It seeds off where it stands, so it is in `CONFORMS_TO_TERRAIN`.
 */
export function buildPlanter(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "planter");
  const w = p.width ?? 2.6;
  const d = p.depth ?? 1.4;
  const h = 0.95;
  // ---- the collider, as it always was ----------------------------------------
  b.block({ w, h, d, x: 0, y: h / 2, z: 0 });

  const rnd = mulberry32(streetSeed(w, d, h, ctx));
  const sb = new StoneBatch();
  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };
  const TOE = 0.07; // the shadow gap's height
  const GAP = 0.03; // and its set-back
  const CAP = 0.09; // the coping's depth
  const OVER = 0.05; // the coping's overhang past the body face, clear of the ribs
  const RIB = 0.035; // a flute's projection
  const CH = 0.05; // the chamfer on a vertical arris
  const RIM = 0.17; // body wall plus coping, inner edge to outer face of the body
  const hw = w / 2;
  const hd = d / 2;
  const iw = hw - RIM; // the bed's half-extents
  const id = hd - RIM;
  const soil = h - 0.07;

  // The toe, down to the lowest corner: a planter on a fall is bedded level.
  const low = Math.min(0, ground(-hw, -hd), ground(hw, -hd), ground(-hw, hd), ground(hw, hd)) - 0.03;
  b.box(w - 2 * GAP, TOE - low, d - 2 * GAP, 0, (TOE + low) / 2, 0, DARK_CONCRETE);

  // The body, chamfered at its four arrises; its top is under the coping and the bed.
  const ring = (y: number): Point3[] => [
    [-hw + CH, y, -hd],
    [hw - CH, y, -hd],
    [hw, y, -hd + CH],
    [hw, y, hd - CH],
    [hw - CH, y, hd],
    [-hw + CH, y, hd],
    [-hw, y, hd - CH],
    [-hw, y, -hd + CH],
  ];
  convexSolid(b, ring(TOE), ring(h - CAP), CONCRETE);

  // The flutes, between a plain margin at the foot and one under the coping.
  const fy0 = TOE + 0.1;
  const fy1 = h - CAP - 0.09;
  for (const s of ["-z", "+z", "-x", "+x"] as const) {
    const half = runsAlongX(s) ? hw : hd;
    const plane = runsAlongX(s) ? hd : hw;
    const span = half - CH - 0.12;
    const n = Math.max(2, Math.round((2 * span) / 0.2) + 1);
    for (let i = 0; i < n; i++) {
      const u = -span + (i * 2 * span) / (n - 1);
      sb.onFace(s, plane, u, (fy0 + fy1) / 2, 0.075, fy1 - fy0, RIB, RIB / 2, CONCRETE, 0, 0, hideBack(s));
    }
  }

  // The coping: the long sides own the corners. One corner may be knocked off.
  const chip = rnd() < 0.55 ? { sx: rnd() < 0.5 ? -1 : 1, sz: rnd() < 0.5 ? -1 : 1, len: 0.16 + rnd() * 0.09 } : null;
  const band = OVER + RIM;
  const capY = h - CAP / 2;
  for (const sz of [-1, 1]) {
    const zc = sz * (hd + OVER - band / 2);
    let x0 = -hw - OVER;
    let x1 = hw + OVER;
    if (chip && chip.sz === sz) {
      if (chip.sx < 0) x0 += chip.len;
      else x1 -= chip.len;
      // What is left of the corner: the stub of the coping, broken lower.
      const cx = chip.sx * (hw + OVER - chip.len / 2);
      const drop = 0.05;
      sb.box(chip.len, CAP - drop, band, cx, h - CAP + (CAP - drop) / 2, zc, CONCRETE, undefined, HIDE_UNDER);
      sb.box(chip.len * 0.55, 0.035, band * 0.6, cx - chip.sx * chip.len * 0.18, h - drop + 0.01, zc - sz * band * 0.12, CONCRETE, { y: 0.4, z: chip.sx * 0.25 }, HIDE_UNDER);
      // And the piece, where it fell.
      const fx = chip.sx * (hw + 0.25 + rnd() * 0.3);
      const fz = sz * (hd + 0.15 + rnd() * 0.35);
      sb.box(0.16, 0.06, 0.11, fx, ground(fx, fz) + 0.025, fz, CONCRETE, { y: rnd() * Math.PI, z: 0.3 }, HIDE_UNDER);
    }
    sb.box(x1 - x0, CAP, band, (x0 + x1) / 2, capY, zc, CONCRETE);
  }
  for (const sx of [-1, 1]) {
    sb.box(band, CAP, 2 * id, sx * (hw + OVER - band / 2), capY, 0, CONCRETE);
  }
  sb.flush(b);

  // ---- the bed -----------------------------------------------------------------
  const chips = new StoneBatch();
  for (let i = 0, n = Math.round(iw * id * 30); i < n; i++) {
    const x = (rnd() * 2 - 1) * (iw - 0.04);
    const z = (rnd() * 2 - 1) * (id - 0.04);
    chips.box(0.05 + rnd() * 0.06, 0.016, 0.025 + rnd() * 0.03, x, soil + 0.006, z, TEAK, { y: rnd() * Math.PI, z: (rnd() - 0.5) * 0.3 }, HIDE_UNDER);
  }

  // A leaf is a pointed blade folded down its midrib, laid tangent to what it
  // grows on and turned about its own normal by `spin`. The fold is a bend the
  // ink finds and two facets the bands shade apart, which is what keeps a
  // crown of them from reading as confetti. Only its outer face is drawn on a
  // billow: nothing sees a leaf from inside its own crown, and what casts is
  // the billow's closed core, which is the shape the shadow map has to be
  // given. A leaf on an open branch is seen from both sides and casts by
  // itself, so it is drawn `both` ways — a closed shell (the back face is
  // culled, never fought).
  const unit = (x: number, y: number, z: number): V3 => {
    const m = Math.hypot(x, y, z);
    return [x / m, y / m, z / m];
  };
  /** Two unit vectors across normal `n`, which a leaf's `spin` turns between. */
  const frame = (n: V3): [V3, V3] => {
    const ref = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const t0 = unit(ref[1] * n[2] - ref[2] * n[1], ref[2] * n[0] - ref[0] * n[2], ref[0] * n[1] - ref[1] * n[0]);
    return [t0, [n[1] * t0[2] - n[2] * t0[1], n[2] * t0[0] - n[0] * t0[2], n[0] * t0[1] - n[1] * t0[0]]];
  };
  /** The spin that points a leaf on `n` straight down it, as ivy hangs. */
  const downSpin = (n: V3): number => {
    const [t0, b0] = frame(n);
    return Math.atan2(-b0[1], -t0[1]);
  };
  const meshers = new Map<string, Mesher>();
  const leaf = (p: V3, n: V3, spin: number, len: number, wid: number, color: string, both = false): void => {
    let m = meshers.get(color);
    if (!m) meshers.set(color, (m = new Mesher()));
    const [t0, b0] = frame(n);
    const c = Math.cos(spin);
    const s = Math.sin(spin);
    const t: V3 = [t0[0] * c + b0[0] * s, t0[1] * c + b0[1] * s, t0[2] * c + b0[2] * s];
    const q: V3 = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]];
    const at = (a: number, b: number, h: number): V3 => [
      p[0] + t[0] * a + q[0] * b + n[0] * h,
      p[1] + t[1] * a + q[1] * b + n[1] * h,
      p[2] + t[2] * a + q[2] * b + n[2] * h,
    ];
    const fold = -wid * 0.24;
    const base = at(-len * 0.42, 0, 0);
    const tip = at(len * 0.58, 0, 0);
    const left = at(-len * 0.04, wid / 2, fold);
    const right = at(-len * 0.04, -wid / 2, fold);
    m.tri(base, left, tip, n);
    m.tri(base, tip, right, n);
    if (!both) return;
    const back: V3 = [-n[0], -n[1], -n[2]];
    m.tri(base, tip, left, back);
    m.tri(base, right, tip, back);
  };
  /** Mostly the creeper's green, the lit one picked more often on what faces up. */
  const tone = (ny: number): string => (rnd() < 0.1 + Math.max(0, ny) * 0.12 ? FIG_LEAF_LIT : CREEPER);
  /**
   * A billow of foliage: a dark core of three octagonal bands inside an
   * ellipsoid, skinned in leaves on a golden spiral down to where the bed or
   * the billow's own underside hides them. `shag` jitters the leaf normals —
   * low for a clipped box, high for a loose shrub.
   */
  interface Billow {
    cx: number;
    cy: number;
    cz: number;
    rx: number;
    ry: number;
    rz: number;
    shag: number;
  }
  const crown: Billow[] = [];
  /** The skinned share of a billow's ellipsoid: everything above the bed. */
  const skin = (o: Billow): number => ((4 * Math.PI * (o.rx * o.ry + o.ry * o.rz + o.rx * o.rz)) / 3) * 0.75;
  const billow = ({ cx, cy, cz, rx, ry, rz, shag }: Billow, n: number, size: number): void => {
    const turn = rnd() * Math.PI;
    const hoop = (u: number): Point3[] => {
      const r = Math.sqrt(1 - u * u) * 0.88;
      return Array.from({ length: 8 }, (_, k): Point3 => {
        const a = turn + (k / 8) * Math.PI * 2;
        return [cx + Math.cos(a) * rx * r, cy + u * ry * 0.88, cz + Math.sin(a) * rz * r];
      });
    };
    const hoops = [-0.55, 0.05, 0.6, 0.92].map(hoop);
    for (let k = 0; k + 1 < hoops.length; k++) convexSolid(b, hoops[k], hoops[k + 1], FIG_LEAF);
    for (let i = 0; i < n; i++) {
      const uy = 1 - ((i + 0.5) / n) * 1.5;
      const r = Math.sqrt(Math.max(0, 1 - uy * uy));
      const a = i * 2.39996 + (rnd() - 0.5) * 0.5;
      const ux = Math.cos(a) * r;
      const uz = Math.sin(a) * r;
      const y = cy + uy * ry;
      if (y < soil + 0.03) continue;
      const nn = unit(ux / rx + (rnd() - 0.5) * shag, uy / ry + (rnd() - 0.5) * shag, uz / rz + (rnd() - 0.5) * shag);
      const sz = size * (0.8 + rnd() * 0.4);
      leaf([cx + ux * rx, y, cz + uz * rz], nn, rnd() * Math.PI * 2, sz, sz * 0.55, tone(nn[1]));
    }
  };

  /**
   * What is left of a shrub nobody has cut back or watered: no crown at all,
   * but the frame of one — stems leaning out of the soil and kinked where
   * they forked, a third of them dead and grey, a twig fork at each dead end
   * — with the leaf it still has bunched toward the living tips, a few gone
   * yellow, and last year's lying on the bed. A mound of billows thinned out
   * still read as a mound, and its core as a faceted egg; what makes a shrub
   * read as neglected is that you can see what holds it up.
   */
  const neglectedShrubs = (): void => {
    const live: [Point3, Point3][] = [];
    const count = Math.max(2, Math.round(iw * 2));
    const stepOut = (p: Point3, bearing: number, lean: number, l: number): Point3 => {
      const x = Math.max(-iw - 0.12, Math.min(iw + 0.12, p[0] + Math.sin(bearing) * Math.sin(lean) * l));
      const z = Math.max(-id - 0.12, Math.min(id + 0.12, p[2] + Math.cos(bearing) * Math.sin(lean) * l));
      return [x, p[1] + Math.cos(lean) * l, z];
    };
    const deadFork = (p: Point3, bearing: number, lean: number): void => {
      for (const side of [-1, 1]) {
        limb(b, p, stepOut(p, bearing + side * (0.4 + rnd() * 0.4), lean + 0.2, 0.07 + rnd() * 0.07), 0.01, 0.005, FIG_BARK, 4);
      }
    };
    for (let i = 0; i < count; i++) {
      const q = i / (count - 1);
      const x = (q * 2 - 1) * iw * 0.55 + (rnd() - 0.5) * 0.15;
      const z = (rnd() - 0.5) * id * 0.3;
      const stems = 4 + Math.floor(rnd() * 3);
      const turn = rnd() * Math.PI * 2;
      for (let j = 0; j < stems; j++) {
        const bearing = turn + (j / stems) * Math.PI * 2 + (rnd() - 0.5) * 0.7;
        const lean = 0.45 + rnd() * 0.5;
        const len = 0.55 + rnd() * 0.4;
        const dead = rnd() < 0.3;
        const p0: Point3 = [x + (rnd() - 0.5) * 0.06, soil - 0.02, z + (rnd() - 0.5) * 0.06];
        const p1 = stepOut(p0, bearing, lean * 0.6, len * 0.5);
        const p2 = stepOut(p1, bearing + (rnd() - 0.5) * 0.5, lean * 1.3, len * 0.5);
        rope(b, [p0, p1, p2], 0.035, 0.012, dead ? FIG_BARK : TEAK, 5);
        const sideBearing = bearing + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.5);
        const p3 = stepOut(p1, sideBearing, lean * 1.6 + 0.2, 0.2 + rnd() * 0.18);
        const sideDead = dead || rnd() < 0.2;
        limb(b, p1, p3, 0.018, 0.008, sideDead ? FIG_BARK : TEAK, 4);
        if (dead) deadFork(p2, bearing, lean * 1.3);
        else live.push([p1, p2]);
        if (sideDead) deadFork(p3, sideBearing, lean * 1.6 + 0.2);
        else live.push([p1, p3]);
      }
    }
    // The leaf it has left, shared along the living wood by length and bunched
    // toward each tip, standing off the stem on every side of it.
    const length = (g: [Point3, Point3]): number => Math.hypot(g[1][0] - g[0][0], g[1][1] - g[0][1], g[1][2] - g[0][2]);
    const total = live.reduce((sum, g) => sum + length(g), 0);
    const budget = Math.round(PLANTER_LEAVES * 0.5 * Math.min(2, (w * d) / (2.6 * 1.4)));
    for (const g of live) {
      const [a, c] = g;
      const dir = unit(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
      const [u0, u1] = frame(dir);
      for (let k = 0, n = Math.round((budget * length(g)) / Math.max(total, 1e-3)); k < n; k++) {
        const t = 0.35 + 0.65 * Math.sqrt(rnd());
        const th = rnd() * Math.PI * 2;
        const ct = Math.cos(th);
        const st = Math.sin(th);
        const radial: V3 = [u0[0] * ct + u1[0] * st, u0[1] * ct + u1[1] * st, u0[2] * ct + u1[2] * st];
        const off = 0.02 + t * 0.05;
        const p: V3 = [
          a[0] + (c[0] - a[0]) * t + radial[0] * off,
          a[1] + (c[1] - a[1]) * t + radial[1] * off,
          a[2] + (c[2] - a[2]) * t + radial[2] * off,
        ];
        if (p[1] < soil + 0.05) continue;
        const nn = unit(radial[0] + dir[0] * 0.3, radial[1] + 0.6 + dir[1] * 0.3, radial[2] + dir[2] * 0.3);
        const sz = 0.1 + rnd() * 0.05;
        leaf(p, nn, rnd() * Math.PI * 2, sz, sz * 0.55, rnd() < 0.12 ? STRAW : tone(nn[1]), true);
      }
    }
    // Last year's leaves, lying where they dropped.
    for (let k = 0; k < 16; k++) {
      const nn = unit((rnd() - 0.5) * 0.4, 1, (rnd() - 0.5) * 0.4);
      const p: V3 = [(rnd() * 2 - 1) * (iw - 0.06), soil + 0.022, (rnd() * 2 - 1) * (id - 0.06)];
      leaf(p, nn, rnd() * Math.PI * 2, 0.1 + rnd() * 0.04, 0.055, rnd() < 0.6 ? STRAW : FIG_BARK);
    }
    // Weeds where the bed meets the rim: rosettes of blades lying out over
    // the soil, the way a dandelion or a plantain claims bare ground.
    for (let k = 0; k < 4; k++) {
      const wx = (rnd() < 0.5 ? -1 : 1) * (iw - 0.08 - rnd() * 0.25);
      const wz = (rnd() * 2 - 1) * (id - 0.08);
      const blades = 5 + Math.floor(rnd() * 3);
      const turn = rnd() * Math.PI * 2;
      for (let j = 0; j < blades; j++) {
        const a = turn + (j / blades) * Math.PI * 2;
        const l = 0.11 + rnd() * 0.07;
        const lift = 0.35 + rnd() * 0.35;
        const nn = unit(-Math.sin(a) * lift, 1, -Math.cos(a) * lift);
        const p: V3 = [wx + Math.sin(a) * l * 0.45, soil + 0.02 + lift * l * 0.25, wz + Math.cos(a) * l * 0.45];
        leaf(p, nn, downSpin(nn) + Math.PI, l, l * 0.4, CREEPER);
      }
    }
  };

  const kind = rnd();
  if (kind < 0.4) {
    // Clipped box, in balls along the bed: small leaves, close and even.
    const count = iw > 0.85 ? (rnd() < 0.5 ? 2 : 3) : 1;
    const r = Math.min(id * 0.95, count === 3 ? iw * 0.42 : iw * 0.55);
    for (let i = 0; i < count; i++) {
      const x = count === 1 ? 0 : -iw * 0.62 + (i * 2 * iw * 0.62) / (count - 1);
      const s = r * (0.92 + rnd() * 0.12);
      crown.push({ cx: x + (rnd() - 0.5) * 0.06, cy: soil + s * 0.8, cz: (rnd() - 0.5) * 0.06, rx: s, ry: s * 0.9, rz: s, shag: 0.35 });
    }
  } else if (kind < 0.8) {
    // A loose evergreen shrub: a mound of billows sat down on the bed, the
    // stems showing only where it lifts off the soil.
    const count = Math.max(2, Math.round(iw * 2.6));
    for (let i = 0; i < count; i++) {
      const q = i / (count - 1);
      const x = (q * 2 - 1) * iw * 0.62 + (rnd() - 0.5) * 0.12;
      const z = (rnd() - 0.5) * id * 0.4;
      const s = 0.4 + rnd() * 0.12 + (1 - Math.abs(q * 2 - 1)) * 0.08;
      const ry = s * (0.8 + rnd() * 0.2);
      const cy = soil + ry * 0.7 + rnd() * 0.06;
      const rz = Math.min(s, id * 0.95);
      crown.push({ cx: x, cy, cz: z, rx: s * 1.1, ry, rz, shag: 1.0 });
      for (let k = 0; k < 2; k++) {
        const fx = x + (rnd() - 0.5) * s * 0.8;
        const fz = z + (rnd() - 0.5) * rz * 0.6;
        limb(b, [fx, soil - 0.02, fz], [x + (fx - x) * 0.3, cy, z + (fz - z) * 0.3], 0.04, 0.025, TEAK, 5);
      }
    }
  } else {
    neglectedShrubs();
  }
  // The leaves are a BUDGET, shared out by area, and a leaf's size follows
  // from its share: two balls or three, a shrub or a clipped one, a planter
  // costs the same, where a fixed leaf size made a third ball a third more.
  // Sized so the skin is just covered — the dark core showing between is
  // depth, not a hole. A neglected bed has no billows and has spent its own
  // half-budget on its branches already.
  const total = crown.reduce((sum, o) => sum + skin(o), 0);
  const leaves = Math.round(PLANTER_LEAVES * Math.min(2, (w * d) / (2.6 * 1.4)));
  for (const o of crown) {
    const n = Math.max(12, Math.round((leaves * skin(o)) / total));
    billow(o, n, Math.sqrt((skin(o) * 0.95) / (n * 0.275)));
  }

  // Ivy, rooted along the bed's edge, over the coping and down the face.
  for (const s of ["-z", "+z", "-x", "+x"] as const) {
    if (rnd() > (runsAlongX(s) ? 0.35 : 0.2)) continue;
    const half = runsAlongX(s) ? hw : hd;
    const plane = runsAlongX(s) ? hd : hw;
    const runLen = Math.min(2 * half - 0.4, 0.5 + rnd() * 0.8);
    const u0 = -half + 0.2 + rnd() * (2 * half - 0.4 - runLen);
    const u1 = u0 + runLen;
    const o = outward(s);
    // A point `out` past this face's plane at `u` along it, as local x/z.
    const at = (u: number, out: number): [number, number] => (runsAlongX(s) ? [u, o * (plane + out)] : [o * (plane + out), u]);
    const nOut = (side: number, ny: number): V3 => (runsAlongX(s) ? unit(side * 0.35, ny, o) : unit(o, ny, side * 0.35));
    for (let u = u0 + rnd() * 0.06; u < u1; u += 0.1 + rnd() * 0.12) {
      const q = (u - u0) / (u1 - u0);
      const env = Math.sqrt(Math.max(0, Math.sin(Math.PI * q)));
      const bottom = Math.max(h - 0.08 - (0.25 + rnd() * 0.45) * env, fy0 + 0.08);
      // Over the coping: the runner from the bed to the lip, leafed.
      const [rx, rz] = at(u, OVER / 2 - RIM / 2);
      const runner = band + 0.02;
      if (runsAlongX(s)) chips.box(0.022, 0.02, runner, rx, h + 0.008, rz, CREEPER, undefined, HIDE_UNDER);
      else chips.box(runner, 0.02, 0.022, rx, h + 0.008, rz, CREEPER, undefined, HIDE_UNDER);
      for (let k = 0; k < 2; k++) {
        const [lx, lz] = at(u + (rnd() - 0.5) * 0.1, -RIM + rnd() * band);
        const nn = unit((rnd() - 0.5) * 1.1, 1, (rnd() - 0.5) * 1.1);
        leaf([lx, h + 0.03, lz], nn, rnd() * Math.PI * 2, 0.12, 0.08, CREEPER);
      }
      // Down the face, in front of the flutes, its leaves hanging tip down.
      const out = OVER + 0.02;
      if (h - bottom > 0.1) {
        chips.onFace(s, plane, u, (h + bottom) / 2, 0.02, h - bottom, 0.02, out, CREEPER, (rnd() - 0.5) * 0.06, 0, hideBack(s));
      }
      let side = rnd() < 0.5 ? -1 : 1;
      for (let y = h - 0.05 - rnd() * 0.05; y > bottom + 0.03; y -= 0.09 + rnd() * 0.07) {
        const [lx, lz] = at(u + side * (0.04 + rnd() * 0.03), out + 0.03 + rnd() * 0.015);
        const nn = nOut(side, -0.2 + rnd() * 0.3);
        leaf([lx, y, lz], nn, downSpin(nn) + side * (0.4 + rnd() * 0.4), 0.13 + rnd() * 0.04, 0.09 + rnd() * 0.03, tone(0));
        side = -side;
      }
    }
  }
  chips.flush(b);
  for (const [color, m] of meshers) b.surface(m.data(), color);

  // The soil, after everything laid on it.
  b.box(2 * iw, 0.1, 2 * id, 0, soil - 0.05, 0, PLANTER_SOIL);
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
 * A QUAY: the retaining mass a waterfront city stands on, the parapet along its
 * edge and the bollards behind it. Runs along local X with the WATER on local
 * -Z, which is the kit's front.
 *
 * **It is a RETAINING wall, so the thing it is built against is the floor and
 * not the water.** The mass hangs DOWN from the placement's own ground plane —
 * the deck's top face is y = 0 — and a map lays it exactly where its
 * heightfield falls away, so the street carries on over the drop instead of
 * stopping at a lip. That is the whole reason this is a structure rather than
 * a terrace: a terrace stands ON the ground and this one stands IN a hole in
 * it, and everything below the coping is there to be seen from a boat.
 *
 * **The parapet is a `Build.guard` and it is load-bearing in the literal
 * sense**: there is no swimming in this game, so a frontage a body can walk
 * off is a body underwater on the seabed with the leash counting down. It is
 * also the one thing here that has to be CONTINUOUS — a 40 m run with a gap
 * between it and the next one is a gap somebody finds — so a caller lays these
 * end to end at exactly `length` apart and the pedestals fall where they fall.
 *
 * **The bollards are `strut`s and the coping and the pedestals are neither.**
 * A bollard is iron a round stops on and no part of a body's problem, which is
 * the pair `Build.strut` exists for; a coping cap is 14 cm of stone on top of
 * a rail whose collider already owns that line, and giving it one of its own
 * would put a second box round the thing the guard is already standing off the
 * edge to avoid.
 */
export function buildQuay(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "quay");
  const len = p.length ?? 40;
  /** How far the deck reaches out over the water from the ground's own edge. */
  const deck = p.depth ?? 4;
  /** How far the face reaches below the deck — under the bed, not down to it. */
  const drop = p.height ?? 6;
  /** Chest-high, and deliberately under `cover.crouchHeight` — see the layout. */
  const PARAPET = 1.0;

  // The mass. Top face at y = 0, so it is the street continuing rather than a
  // step onto something; one collider, because a body only ever meets its top.
  b.box(len, drop, deck, 0, -drop / 2, -deck / 2, CONCRETE);
  b.block({ w: len, h: drop, d: deck, x: 0, y: -drop / 2, z: -deck / 2 });

  // The parapet, standing outboard of the seaward face for `Build.guard`'s own
  // reason, and the coping cap over it — wider than the rail, which is what
  // stops 0.16 m of collider reading as a sheet of card on edge.
  b.guard("-z", -deck, 0, len, 0, { height: PARAPET, color: CONCRETE });
  b.box(len, 0.16, 0.72, 0, PARAPET + 0.08, -deck - 0.08, KERB_WORN);

  // Pedestals at the quarter points: the parapet's own rhythm, and the thing
  // that makes a 40 m run read as built rather than extruded.
  for (let i = 1; i < 4; i++) {
    const x = -len / 2 + (i * len) / 4;
    b.box(0.72, PARAPET + 0.3, 0.66, x, (PARAPET + 0.3) / 2, -deck - 0.08, CONCRETE);
    b.box(0.86, 0.16, 0.8, x, PARAPET + 0.38, -deck - 0.08, KERB_WORN);
  }

  // Mooring bollards, set back a metre and a half so there is room to work a
  // rope round one, and a course of kerb along the back of the deck where the
  // paving changes.
  for (let i = 0; i < 4; i++) {
    const x = -len / 2 + (i + 0.5) * (len / 4);
    b.strut(0.3, 0.62, 0.3, x, 0.31, -deck + 1.5, ALLOY);
    b.cyl(0.17, 0.52, 0.38, 8, x, 0.7, -deck + 1.5, ALLOY);
  }
  b.box(len, 0.06, 0.5, 0, 0.03, -0.25, KERB);
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
 * argument that the head should still read at distance — and the glow
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
  // glow's bloom, and is faded per pixel by `EmissiveFog` like everything
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
 * Cast bronze after fifty years out of doors: a dark patina, green only a
 * little. `VERDIGRIS` is the colour of the streak and read as painted tin over
 * a whole figure — the up-facing surfaces of a statue against the sky come
 * back the stop and a half lighter every level face does — so the casting is
 * this and the streak stays where it is, on the rolls of honour's raised
 * letters.
 */
const BRONZE = "#33413b";

/**
 * The civic monument at the middle of a square: an interwar war memorial.
 *
 * The steps are 0.34 m, inside `CONFIG.nav.stepHeight`, so the whole thing
 * links to the pavement from every bearing and needs no ramp — a plinth a bot
 * cannot climb is a plinth that makes the flag on it uncapturable, which is a
 * failure with nothing to see. Each tier is its own collider for that reason
 * and not for the look.
 *
 * A control point may stand on the top tier, but its `pos` must NOT be inside
 * the shaft: `surfaceAt` returns -1 inside a collider, and a flag whose centre
 * is in one cannot be captured at all. Coldharbour's does, at (2.5, 2.5), so
 * **nothing drawn on the top tier may stand taller than a wreath** — the flag
 * and its ring are the tier's, and every tread is drawn with its top on its
 * collider's top so the ring's paint (18 mm over the box) is never buried.
 *
 * What it is drawn as, and it is one building on three maps, so it is the
 * kind of memorial every town of the period put up rather than any one town's:
 *
 * - **Three granite steps** laid as stones rather than poured: a course of
 *   step blocks round each edge with a NOSING standing 2.5 cm proud of the
 *   riser, flags filling the tread behind them, every joint 16 mm open over a
 *   core set back, so the ink draws the bond for free.
 * - **A pale ashlar die** on a granite plinth course, its four faces framed by
 *   corner blocks and rails round a sunk field, under a moulded cap. The front
 *   field is INSCRIBED — real letters, a stroke font below, cut dark into the
 *   pale stone — and the other three carry bronze rolls of honour, raised
 *   bronze on a dark patinated ground, since bronze on bronze has no value to
 *   read by.
 * - **A shaft of ashlar laid in a pinwheel bond**, the long stones turning a
 *   quarter every course so the corner joints break, carrying a bronze sword
 *   point-down on the two broad faces, a laurel wreath and the two wars' dates
 *   on the other two, and a frieze of small wreaths under the cornice.
 * - **A bronze soldier at rest on arms reversed** on an attic over the
 *   cornice, head bowed over the butt of his rifle — the finial the old shaft
 *   had was a spike, and a memorial's silhouette is the figure.
 * - **Poppy wreaths** laid against the die, seeded one or two.
 *
 * The colliders are unchanged and in the same order (a block per tier, the
 * die, the shaft). Everything else is drawing and obeys one of the three
 * rules: flat on a face (the plinth, rails, nosings, the bronze — at most 6 cm
 * proud), low (the wreaths, under 0.5 m and against the die), or standing on a
 * collider's top (the shaft's own plinth on the die, the cornice, the attic
 * and the figure on the shaft). Nothing is drawn INSIDE a collider's faces by
 * more than the 3 cm a sunk field or a joint needs.
 *
 * Colours are the city's own — granite in `CONCRETE`, the pale stone in
 * `ASHLAR`, cores in `DARK_CONCRETE` — plus `BRONZE` for the casting, the one
 * colour this adds (see its comment), `VERDIGRIS` for the tablets' raised
 * letters, and `LAMP_RED` and `IRON` for the poppies and the tablets' ground.
 * Every stone, letter and leaf is one `StoneBatch` surface per colour: ~28 k
 * vertices, placed once a map.
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
  // ---- the colliders, as they always were and in the same order ----------
  for (let i = 0; i < 3; i++) {
    const s = w - i * 2.2;
    const y = (i + 1) * step;
    b.block({ w: s, h: step, d: s, x: 0, y: y - step / 2, z: 0 });
  }
  const base = 3 * step;
  b.block({ w: 2.4, h: 1.0, d: 2.4, x: 0, y: base + 0.5, z: 0 });
  b.block({ w: 1.3, h: 8.0, d: 1.3, x: 0, y: base + 5.0, z: 0 });

  // ---- the drawing ---------------------------------------------------------
  const rnd = mulberry32(streetSeed(w, w, 10));
  const sb = new StoneBatch();
  const SIDES: readonly Side[] = ["-z", "+z", "-x", "+x"];
  /** The joint between two stones. */
  const g = 0.016;

  // The three steps. A ring of step blocks round each edge, nosed; flags
  // behind them out to the next riser; the top tier flagged in two courses
  // round the die.
  for (let i = 0; i < 3; i++) {
    const half = (w - i * 2.2) / 2;
    const top = (i + 1) * step;
    const ring = 0.55;
    monumentCourse(sb, half - ring, half, top, step, CONCRETE, 1.0, 1.8, rnd, true);
    const inner = i < 2 ? (w - (i + 1) * 2.2) / 2 : 1.2;
    const flags = half - ring - g - inner;
    const courses = Math.max(1, Math.round(flags / 0.8));
    for (let c = 0; c < courses; c++) {
      const hOut = half - ring - g - (c * flags) / courses;
      monumentCourse(sb, hOut - flags / courses, hOut, top, 0.08, CONCRETE, 0.6, 1.1, rnd, false);
    }
  }

  // The die: a granite plinth course, corner blocks and rails round a sunk
  // field on each face, and a moulded cap.
  const die = 1.2;
  const field = die - 0.03;
  monumentCourse(sb, die - 0.3, die + 0.06, base + 0.2, 0.2, CONCRETE, 0.7, 1.0, rnd, false);
  const dy0 = base + 0.2;
  const dy1 = base + 0.86;
  for (const cx of [-1, 1]) {
    for (const cz of [-1, 1]) {
      sb.box(0.3, dy1 - dy0, 0.3, cx * (die - 0.15), (dy0 + dy1) / 2, cz * (die - 0.15), ASHLAR, undefined, HIDE_UNDER);
    }
  }
  for (const s of SIDES) {
    const hb = hideBack(s) | HIDE_UNDER;
    const along = 2 * (die - 0.3) - 2 * g;
    sb.onFace(s, die, 0, dy0 + 0.05, along, 0.1, 0.08, -0.04, ASHLAR, 0, 0, hb);
    sb.onFace(s, die, 0, dy1 - 0.05, along, 0.1, 0.08, -0.04, ASHLAR, 0, 0, hb);
  }
  // The cap: a sloped bed mould, then a corona 6 cm over the die's faces. A
  // slope rather than a second step: two steps of 2-3 cm each are under what
  // the ink can hold at ten metres, and broke into dashes along the die.
  const square = (h: number, y: number): Point3[] => [[-h, y, -h], [h, y, -h], [h, y, h], [-h, y, h]];
  convexSolid(b, square(die, dy1), square(die + 0.06, dy1 + 0.07), ASHLAR);
  sb.box(2.52, 0.07, 2.52, 0, base + 1.0 - 0.035, 0, ASHLAR);

  // The front field is cut: three lines, dark in the pale stone.
  const lines = ["THEIR NAME", "LIVETH FOR", "EVERMORE"];
  lines.forEach((t, k) => monumentInscribe(sb, "-z", field, t, base + 0.66 - k * 0.15, 0.1, DARK_CONCRETE));
  // The other three carry the names, cast: a dark ground, a raised border,
  // a heading and two columns of names in bronze.
  for (const s of ["+z", "-x", "+x"] as const) {
    const hb = hideBack(s);
    const yc = (dy0 + dy1) / 2;
    sb.onFace(s, field, 0, yc, 1.56, 0.42, 0.02, 0.01, IRON, 0, 0, hb);
    for (const e of [-1, 1]) {
      sb.onFace(s, field, 0, yc + e * 0.195, 1.56, 0.03, 0.026, 0.013, VERDIGRIS, 0, 0, hb);
      sb.onFace(s, field, e * 0.765, yc, 0.03, 0.42, 0.026, 0.013, VERDIGRIS, 0, 0, hb);
    }
    sb.onFace(s, field, 0, yc + 0.135, 0.5 + rnd() * 0.2, 0.03, 0.026, 0.013, VERDIGRIS, 0, 0, hb);
    // Ranged left as the face is read, which on two of the three is -u.
    const read = s === "+x" ? 1 : -1;
    for (const col of [-1, 1]) {
      for (let r = 0; r < 5; r++) {
        const len = 0.3 + rnd() * 0.32;
        const u0 = col * 0.36 - 0.33;
        sb.onFace(s, field, read * (u0 + len / 2), yc + 0.07 - r * 0.052, len, 0.02, 0.024, 0.012, VERDIGRIS, 0, 0, hb);
      }
    }
  }

  // The shaft: its own plinth standing on the die, a chamfer, then ten
  // courses of ashlar in a pinwheel bond up to a string course.
  const sh = 0.65;
  sb.box(1.56, 0.4, 1.56, 0, base + 1.2, 0, ASHLAR, undefined, HIDE_UNDER);
  convexSolid(b, square(0.78, base + 1.4), square(sh, base + 1.5), ASHLAR);
  const s0 = base + 1.5;
  const s1 = base + 8.38;
  const nCourse = 10;
  const ch = (s1 - s0) / nCourse;
  for (let k = 0; k < nCourse; k++) {
    const y = s0 + (k + 0.5) * ch - g / 2;
    for (const s of SIDES) {
      const long = runsAlongX(s) === (k % 2 === 0);
      const along = long ? 2 * sh : 2 * sh - 0.4 - 2 * g;
      sb.onFace(s, sh, 0, y, along, ch - g, 0.2, -0.1, ASHLAR, 0, 0, hideBack(s) | HIDE_UNDER);
    }
  }
  // A sword point-down on each broad face.
  for (const s of ["-z", "+z"] as const) {
    const hb = hideBack(s);
    const bronze = (u: number, y: number, along: number, tall: number, thick: number, tilt = 0): void =>
      sb.onFace(s, sh, u, y, along, tall, thick, thick / 2, BRONZE, tilt, 0, hb);
    const tip = base + 2.75;
    const hilt = base + 5.45;
    bronze(0, (tip + hilt) / 2, 0.15, hilt - tip, 0.035);
    bronze(0, (tip + hilt) / 2 + 0.02, 0.03, hilt - tip - 0.12, 0.045);
    bronze(0, tip, 0.106, 0.106, 0.035, Math.PI / 4);
    bronze(0, hilt + 0.05, 0.7, 0.1, 0.06);
    for (const e of [-1, 1]) bronze(e * 0.37, hilt + 0.05, 0.09, 0.09, 0.07, Math.PI / 4);
    bronze(0, hilt + 0.3, 0.07, 0.4, 0.05);
    for (let r = 0; r < 3; r++) bronze(0, hilt + 0.18 + r * 0.12, 0.085, 0.022, 0.06);
    bronze(0, hilt + 0.57, 0.11, 0.11, 0.065, Math.PI / 4);
  }
  // A wreath and the dates on each narrow face.
  const dates: Record<"-x" | "+x", [string, string]> = { "+x": ["1914", "1918"], "-x": ["1939", "1945"] };
  for (const s of ["-x", "+x"] as const) {
    monumentLaurel(sb, s, sh, 0, base + 6.55, 0.33, BRONZE);
    monumentInscribe(sb, s, sh, dates[s][0], base + 4.85, 0.2, DARK_CONCRETE);
    monumentInscribe(sb, s, sh, "-", base + 4.55, 0.2, DARK_CONCRETE);
    monumentInscribe(sb, s, sh, dates[s][1], base + 4.25, 0.2, DARK_CONCRETE);
  }

  // The head of the shaft: a string course, a frieze with a small wreath on
  // each face, and the cornice — a bed mould, a corona and a sloped cymatium.
  sb.box(1.36, 0.06, 1.36, 0, s1 + 0.03, 0, ASHLAR);
  for (const s of SIDES) monumentLaurel(sb, s, sh, 0, s1 + 0.3, 0.12, BRONZE);
  sb.box(1.44, 0.12, 1.44, 0, base + 8.94, 0, ASHLAR);
  sb.box(1.72, 0.18, 1.72, 0, base + 9.09, 0, ASHLAR);
  convexSolid(b, square(0.86, base + 9.18), square(0.58, base + 9.32), ASHLAR);
  // The attic the figure stands on, and its cap.
  sb.box(1.04, 0.56, 1.04, 0, base + 9.6, 0, ASHLAR, undefined, HIDE_UNDER);
  sb.box(1.18, 0.1, 1.18, 0, base + 9.93, 0, ASHLAR);

  // Poppy wreaths laid against the die: one at a corner of the front, and a
  // second there or round the back. Under the inscription's last line, which
  // is narrower than the field, so nothing cut is hidden.
  const lean = 0.2;
  const wr = 0.21;
  const wy = base + 0.03 + wr * Math.cos(lean);
  const first = rnd() < 0.5 ? -1 : 1;
  monumentPoppies(sb, first * 0.8, wy, -(die + 0.03 + wr * Math.sin(lean)), wr, lean, rnd);
  if (rnd() < 0.5) monumentPoppies(sb, -first * 0.8, wy, -(die + 0.03 + wr * Math.sin(lean)), wr, lean, rnd);
  else monumentPoppies(sb, 0, wy, die + 0.03 + wr * Math.sin(lean), wr, -lean, rnd);

  // The stones, and only then the cores they hide.
  sb.flush(b);
  for (let i = 0; i < 3; i++) {
    const s = w - i * 2.2 - 0.1;
    const top = (i + 1) * step - 0.04;
    const bot = i === 0 ? -0.2 : i * step;
    b.box(s, top - bot, s, 0, (top + bot) / 2, 0, DARK_CONCRETE);
  }
  b.box(2 * field, dy1 - dy0, 2 * field, 0, (dy0 + dy1) / 2, 0, ASHLAR);
  b.box(2 * sh - 0.06, s1 - s0, 2 * sh - 0.06, 0, (s0 + s1) / 2, 0, CONCRETE);
  b.box(2 * sh, 0.44, 2 * sh, 0, s1 + 0.28, 0, ASHLAR);

  monumentSoldier(b, base + 9.98);
  return b;
}

/**
 * A square course of stones between two half-widths, its top at `top`: a
 * square in each corner and runs between them in seeded lengths, each 16 mm
 * shy of the next so the core behind shows as a joint. A `nosed` course is a
 * flight's step blocks and stands a lip 2.5 cm proud along its top edge.
 */
function monumentCourse(
  sb: StoneBatch,
  hIn: number,
  hOut: number,
  top: number,
  t: number,
  color: string,
  min: number,
  max: number,
  rnd: () => number,
  nosed: boolean,
): void {
  const g = 0.016;
  const deep = hOut - hIn - g;
  const mid = hOut - deep / 2;
  const y = top - t / 2;
  for (const s of ["-z", "+z", "-x", "+x"] as const) {
    const hb = hideBack(s) | HIDE_UNDER;
    let u = -hIn;
    const runs: [number, number][] = [];
    while (hIn - u > max) {
      const l = min + rnd() * (max - min);
      runs.push([u, u + l]);
      u += l;
    }
    if (runs.length && hIn - u < min) runs[runs.length - 1][1] = hIn;
    else runs.push([u, hIn]);
    for (const [u0, u1] of runs) {
      const along = u1 - u0 - g;
      sb.onFace(s, hOut, (u0 + u1) / 2, y, along, t, deep, -deep / 2, color, 0, 0, hb);
      if (nosed) sb.onFace(s, hOut, (u0 + u1) / 2, top - 0.025, along, 0.05, 0.04, 0.005, color, 0, 0, hideBack(s));
    }
  }
  for (const cx of [-1, 1]) {
    for (const cz of [-1, 1]) {
      sb.box(deep, t, deep, cx * mid, y, cz * mid, color, undefined, HIDE_UNDER);
      if (!nosed) continue;
      const lip = deep + 0.025;
      sb.onFace(cz < 0 ? "-z" : "+z", hOut, cx * (mid + 0.0125), top - 0.025, lip, 0.05, 0.04, 0.005, color, 0, 0, 0);
      sb.onFace(cx < 0 ? "-x" : "+x", hOut, cz * (mid + 0.0125), top - 0.025, lip, 0.05, 0.04, 0.005, color, 0, 0, 0);
    }
  }
}

/**
 * Capitals and figures as strokes on a grid three wide and four tall, for
 * cutting into stone. Only what the monument says is drawn; anything else is
 * a space.
 */
const MONUMENT_GLYPHS: Readonly<Record<string, readonly (readonly [number, number, number, number])[]>> = {
  A: [[0, 0, 1.5, 4], [1.5, 4, 3, 0], [0.7, 1.4, 2.3, 1.4]],
  E: [[0, 0, 0, 4], [0, 4, 2.6, 4], [0, 2, 2.1, 2], [0, 0, 2.6, 0]],
  F: [[0, 0, 0, 4], [0, 4, 2.6, 4], [0, 2, 2.1, 2]],
  H: [[0, 0, 0, 4], [3, 0, 3, 4], [0, 2, 3, 2]],
  I: [[0, 0, 0, 4]],
  L: [[0, 4, 0, 0], [0, 0, 2.6, 0]],
  M: [[0, 0, 0, 4], [0, 4, 1.75, 0.8], [1.75, 0.8, 3.5, 4], [3.5, 4, 3.5, 0]],
  N: [[0, 0, 0, 4], [0, 4, 3, 0], [3, 0, 3, 4]],
  O: [[1, 0, 2, 0], [2, 0, 3, 1], [3, 1, 3, 3], [3, 3, 2, 4], [2, 4, 1, 4], [1, 4, 0, 3], [0, 3, 0, 1], [0, 1, 1, 0]],
  R: [[0, 0, 0, 4], [0, 4, 2.2, 4], [2.2, 4, 3, 3.3], [3, 3.3, 3, 2.7], [3, 2.7, 2.2, 2], [2.2, 2, 0, 2], [1.4, 2, 3, 0]],
  T: [[0, 4, 3, 4], [1.5, 4, 1.5, 0]],
  V: [[0, 4, 1.5, 0], [1.5, 0, 3, 4]],
  "-": [[0.4, 2, 2.6, 2]],
  "1": [[0, 3.2, 1, 4], [1, 4, 1, 0]],
  "3": [[0, 3.4, 0.6, 4], [0.6, 4, 2.4, 4], [2.4, 4, 3, 3.4], [3, 3.4, 3, 2.6], [3, 2.6, 2.4, 2], [2.4, 2, 1, 2], [2.4, 2, 3, 1.4], [3, 1.4, 3, 0.6], [3, 0.6, 2.4, 0], [2.4, 0, 0.6, 0], [0.6, 0, 0, 0.6]],
  "4": [[2.2, 0, 2.2, 4], [2.2, 4, 0, 1.2], [0, 1.2, 3, 1.2]],
  "5": [[3, 4, 0.2, 4], [0.2, 4, 0, 2.2], [0, 2.2, 2.4, 2.2], [2.4, 2.2, 3, 1.6], [3, 1.6, 3, 0.6], [3, 0.6, 2.4, 0], [2.4, 0, 0.6, 0], [0.6, 0, 0, 0.6]],
  "8": [[0.6, 2, 2.4, 2], [0.6, 2, 0, 2.6], [0, 2.6, 0, 3.4], [0, 3.4, 0.6, 4], [0.6, 4, 2.4, 4], [2.4, 4, 3, 3.4], [3, 3.4, 3, 2.6], [3, 2.6, 2.4, 2], [0.6, 2, 0, 1.4], [0, 1.4, 0, 0.6], [0, 0.6, 0.6, 0], [0.6, 0, 2.4, 0], [2.4, 0, 3, 0.6], [3, 0.6, 3, 1.4], [3, 1.4, 2.4, 2]],
  "9": [[3, 2.2, 0.6, 2.2], [0.6, 2.2, 0, 2.8], [0, 2.8, 0, 3.4], [0, 3.4, 0.6, 4], [0.6, 4, 2.4, 4], [2.4, 4, 3, 3.4], [3, 3.4, 3, 0.6], [3, 0.6, 2.4, 0], [2.4, 0, 0.4, 0]],
};

/**
 * One line of cut letters, centred on face `s` with its foot at `y` and its
 * capitals `h` tall. Laid in the order the face is READ: looking at it from
 * outside, +X runs to the right on -Z, +Z on +X, -X on +Z and -Z on -X.
 */
function monumentInscribe(sb: StoneBatch, s: Side, plane: number, text: string, y: number, h: number, color: string): void {
  const unit = h / 4;
  const sw = h * 0.14;
  const gap = unit * 1.1;
  const sgn = s === "-z" || s === "+x" ? 1 : -1;
  const chars = [...text];
  const widths = chars.map((c) => {
    const k = MONUMENT_GLYPHS[c];
    return k ? Math.max(...k.flatMap((st) => [st[0], st[2]])) * unit : unit * 2;
  });
  let r = -(widths.reduce((a, v) => a + v, 0) + gap * (chars.length - 1)) / 2;
  chars.forEach((c, i) => {
    for (const [x0, y0, x1, y1] of MONUMENT_GLYPHS[c] ?? []) {
      const du = (x1 - x0) * unit;
      const dy = (y1 - y0) * unit;
      const u = sgn * (r + ((x0 + x1) / 2) * unit);
      const tilt = Math.atan2(dy, sgn * du);
      sb.onFace(s, plane, u, y + ((y0 + y1) / 2) * unit, Math.hypot(du, dy) + sw, sw, 0.012, 0.002, color, tilt, 0, hideBack(s));
    }
    r += widths[i] + gap;
  });
}

/**
 * A laurel wreath in relief on a face: two rings of leaves leaning opposite
 * ways round the circle, open at the foot where a knot ties it and two ribbon
 * tails hang.
 */
function monumentLaurel(sb: StoneBatch, s: Side, plane: number, uc: number, yc: number, r: number, color: string): void {
  const hb = hideBack(s);
  const leaf = r * 0.27;
  for (const [rr, n, out, lean] of [
    [r * 0.9, 32, 0.02, 0.6],
    [r * 1.06, 36, 0.014, -0.6],
    [r * 1.2, 40, 0.008, 0.6],
  ] as const) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      if (Math.abs(a - 1.5 * Math.PI) < 0.3) continue;
      sb.onFace(s, plane, uc + Math.cos(a) * rr, yc + Math.sin(a) * rr, leaf, leaf * 0.38, 0.02, out, color, a + Math.PI / 2 + lean, 0, hb);
    }
  }
  sb.onFace(s, plane, uc, yc - r, r * 0.22, r * 0.22, 0.03, 0.02, color, Math.PI / 4, 0, hb);
  for (const e of [-1, 1]) {
    sb.onFace(s, plane, uc + e * r * 0.26, yc - r * 1.45, r * 0.16, r * 0.85, 0.012, 0.01, color, e * 0.35, 0, hb);
  }
}

/**
 * A poppy wreath leaning against a face: two rings of flowers on a ring tipped
 * back by `lean` (its top toward +Z for a positive lean), each a red square
 * turned at random with a black heart, and a card tied in the middle.
 */
function monumentPoppies(sb: StoneBatch, x: number, y: number, z: number, r: number, lean: number, rnd: () => number): void {
  const nY = Math.abs(Math.sin(lean));
  const nZ = -Math.cos(lean) * Math.sign(lean || 1);
  for (const [rr, n] of [
    [r, 17],
    [r * 0.68, 12],
  ] as const) {
    for (let i = 0; i < n; i++) {
      const a = ((i + rnd() * 0.4) / n) * Math.PI * 2;
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr * Math.cos(lean);
      const pz = z + Math.sin(a) * rr * Math.sin(lean);
      const rot = { x: lean, z: rnd() * Math.PI };
      sb.box(0.075, 0.075, 0.028, px, py, pz, LAMP_RED, rot);
      sb.box(0.026, 0.026, 0.02, px + 0, py + nY * 0.014, pz + nZ * 0.014, IRON, rot);
    }
  }
  sb.box(0.12, 0.08, 0.006, x, y, z, ROAD_PAINT, { x: lean, z: (rnd() - 0.5) * 0.3 });
}

/**
 * The figure on the attic, feet at `y0`, facing -Z: a soldier in a greatcoat
 * and a steel helmet, head bowed, hands folded on the butt of a rifle grounded
 * muzzle-down in front of him. Bronze throughout — the ink and the key draw
 * the folds a modeller would have, and at ten metres up what reads is the
 * SILHOUETTE: the brim, the bowed head, the elbows out, the rifle's line.
 */
function monumentSoldier(b: Build, y0: number): void {
  const B = BRONZE;
  const P = (x: number, y: number, z: number): Point3 => [x, y0 + y, z];
  const oct = (rx: number, rz: number, y: number, cz: number): Point3[] =>
    Array.from({ length: 8 }, (_, k) => {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      return P(Math.cos(a) * rx, y, cz + Math.sin(a) * rz);
    });
  // The ground he stands on: a cast slab with a few stones in it.
  b.box(0.92, 0.08, 0.92, 0, y0 - 0.04, 0, B);
  b.box(0.22, 0.06, 0.16, 0.26, y0, 0.24, B, { y: 0.5 });
  b.box(0.16, 0.05, 0.14, -0.3, y0, -0.2, B, { y: -0.3 });
  // Boots and puttees.
  for (const e of [-1, 1]) {
    b.box(0.12, 0.1, 0.27, e * 0.11, y0 + 0.05, -0.04, B, { y: e * 0.12 });
    limb(b, P(e * 0.11, 0.08, 0), P(e * 0.115, 0.6, 0.01), 0.13, 0.15, B, 8);
  }
  // The greatcoat: the skirt to below the knee, the body, the shoulders.
  convexSolid(b, oct(0.34, 0.26, 0.5, 0.03), oct(0.2, 0.15, 1.15, 0), B);
  convexSolid(b, oct(0.2, 0.15, 1.13, 0), oct(0.27, 0.17, 1.55, -0.03), B);
  convexSolid(b, oct(0.27, 0.17, 1.55, -0.03), oct(0.17, 0.12, 1.72, -0.05), B);
  b.box(0.47, 0.07, 0.35, 0, y0 + 1.17, 0, B);
  for (let k = 0; k < 4; k++) b.box(0.035, 0.035, 0.02, 0.07, y0 + 1.28 + k * 0.09, -0.185, B);
  b.cyl(0.08, 0.15, 0.2, 8, 0, y0 + 1.75, -0.05, B);
  // The pack, its rolled blanket, a water bottle and the bayonet's scabbard.
  b.box(0.3, 0.26, 0.12, 0, y0 + 1.42, 0.21, B);
  b.cyl(0.34, 0.08, 0.08, 8, 0, y0 + 1.6, 0.2, B, { z: Math.PI / 2 });
  b.cyl(0.16, 0.08, 0.08, 8, 0.25, y0 + 1.05, 0.08, B);
  slab(b, P(-0.25, 1.12, 0.04), P(-0.28, 0.62, 0.12), 0.04, 0.025, B);
  // The head, bowed, and the helmet's broad brim over it.
  const bow = 0.62;
  const ax: Point3 = [0, Math.cos(bow), -Math.sin(bow)];
  const hc = P(0, 1.85, -0.11);
  const along = (d: number): Point3 => [hc[0] + ax[0] * d, hc[1] + ax[1] * d, hc[2] + ax[2] * d];
  b.cyl(0.21, 0.15, 0.16, 8, hc[0], hc[1], hc[2], B, { x: -bow });
  // A Brodie: a shallow bowl pressed out of one plate with the brim all round
  // it, so the dome is nearly as wide as the brim and barely taller than it.
  const brim = along(0.08);
  b.cyl(0.018, 0.33, 0.36, 12, brim[0], brim[1], brim[2], B, { x: -bow });
  const dome = along(0.115);
  b.cyl(0.06, 0.22, 0.29, 12, dome[0], dome[1], dome[2], B, { x: -bow });
  const crown = along(0.15);
  b.cyl(0.02, 0.12, 0.22, 12, crown[0], crown[1], crown[2], B, { x: -bow });
  // Arms down and forward, the hands folded one over the other on the butt.
  for (const e of [-1, 1]) {
    const sho = P(e * 0.25, 1.66, -0.03);
    const elb = P(e * 0.25, 1.36, -0.15);
    const wri = P(e * 0.08, 1.25, -0.31);
    limb(b, sho, elb, 0.15, 0.13, B, 8);
    limb(b, elb, wri, 0.13, 0.12, B, 8);
    limb(b, P(e * 0.11, 1.265, -0.27), wri, 0.155, 0.15, B, 8);
    b.box(0.1, 0.06, 0.11, e * 0.035, y0 + 1.24 + (e > 0 ? 0.035 : 0), -0.345, B, { y: e * 0.3 });
  }
  // The rifle, reversed: butt under the hands, muzzle on the ground.
  slab(b, P(0, 1.21, -0.345), P(0, 0.86, -0.36), 0.045, 0.13, B);
  slab(b, P(0, 0.86, -0.36), P(0, 0.74, -0.365), 0.04, 0.06, B);
  slab(b, P(0, 0.74, -0.365), P(0, 0.6, -0.37), 0.045, 0.075, B);
  b.box(0.035, 0.11, 0.05, 0, y0 + 0.64, -0.425, B);
  slab(b, P(0, 0.6, -0.37), P(0, 0.18, -0.39), 0.04, 0.05, B);
  limb(b, P(0, 0.18, -0.39), P(0, 0.03, -0.4), 0.024, 0.022, B, 6);
}
