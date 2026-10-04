/**
 * kit/harbour.ts — The working coast: smelter, lighthouse, harbour crane,
 * drying rack, careened hull, net loft, salt pan. All follow the contract in
 * kit/core.ts (origin-local geometry, no solid/pickable/collisions metadata,
 * a front on local -Z).
 *
 * ## What this set is, and why it is a set rather than seven more props
 *
 * Coldharbour got `kit/city.ts` and Sarab got `kit/desert.ts`; the island got
 * hand-me-downs. Cinderhaven was built out of the village kit — cottage,
 * townhouse, barn, mill, boathouse — which is most of why a volcanic harbour
 * town read as Hollowmere with more water in it. **A map does not feel like a
 * place because of how MANY buildings are on it. It feels like a place because
 * the buildings are the ones that place would have built** — and a harbour on
 * a lava island under a sulphur works would have built exactly these:
 * something to smelt the ore in, something to warn a ship off the rock,
 * something to lift a cargo out of a boat, somewhere to dry the catch,
 * somewhere to keep the nets out of the wet, a hull up on the hard, and pans
 * to take salt out of the sea because there is no river and nothing to farm.
 *
 * Everything here is made of three materials and nothing else, which is the
 * other half of what makes it a set: `BASALT` (the rock the island IS),
 * `PITCH`ed timber (everything that arrived by sea and was tarred against the
 * salt the week it landed) and `RUST` (every piece of iron, on the same
 * schedule). What the two industries stain them with — `SULPHUR` and `SLAG` —
 * is the rest of the palette and the whole of it.
 *
 * ## The rules this file adds to the kit contract
 *
 * - **A gantry, a gallery and a stair are WALKED, and everything walked here
 *   owes what kit/terrain.ts's header states**: a collider top face within
 *   `CONFIG.nav.stepHeight` of adjacent ground, `rotX` on the COLLIDER of
 *   anything pitched and not merely on the visual, and `Build.guard` — never a
 *   bare box — at the edge of anything a body stands on.
 * - **A flight is built to `GRADE`, not to `MAX_WALKABLE_GRADE`**, for the
 *   reason kit/desert.ts's `GRADE` gives: the nav graph links cells by
 *   comparing heights sampled a cell apart, so a run built at the limit fails
 *   on rounding — silently, as a deck the bots never reach.
 * - **Nothing tall here is CLIMBABLE except the smelter's charging deck**, and
 *   that is the decision `buildMinaret` already writes down. A lighthouse
 *   gallery at eighteen metres, on a map whose fog wall is 1,250, is a
 *   position that sees every flag with no counter to it, because there is one
 *   way up. The smelter's deck is six metres, is overlooked by the works' own
 *   ground on three sides and has a stair anyone can walk up: that is a
 *   position rather than a perch.
 */
import { Scene } from "@babylonjs/core";
import { CONFIG } from "../../config";
import type { CelMaterialFactory } from "../../shaders/CelShader";
import {
  Build,
  type BuildCtx,
  type BuildParams,
  type Point3,
  type Side,
  type Structure,
  HIDE_UNDER,
  StoneBatch,
  carve,
  convexSolid,
  hideBack,
  orient,
  outward,
  runsAlongX,
  slab,
  streetSeed,
  BASALT,
  BASALT_PALE,
  EMBER,
  FLAME,
  IRON,
  PITCH,
  PLANK,
  RUST,
  SAILCLOTH,
  SLAG,
  SLATE,
  SULPHUR,
  TEAK,
  TIMBER,
} from "./core";
import { mulberry32 } from "../rng";

const TRANSLUCENCY = CONFIG.graphics.translucency;

/**
 * The grade every flight in this file is built to, against
 * `MAX_WALKABLE_GRADE`'s 0.4. kit/desert.ts's `GRADE` owns the argument; it is
 * restated rather than imported, because importing it would make the desert
 * town's stair geometry a dependency of the island's and the two are only
 * incidentally the same number.
 */
const GRADE = 0.34;

// =============================================================================
// The Cinderworks: the landmark
// =============================================================================

/**
 * THE SMELTER — an ore hall, a furnace block and the stack over them, and the
 * one structure in this kit built to be recognised from the far side of a map.
 *
 * **A landmark has two jobs: be legible at a distance nothing else survives,
 * and be worth walking into when you get there.** Sarab's minaret does the
 * first and explicitly refuses the second. This does both, and what lets it is
 * that its height is a CHIMNEY rather than a room — forty metres of tapering
 * basalt over a hall you fight inside costs three collider boxes to be a
 * horizon line and gives away no ground at all, because there is nothing at
 * the top of it to hold.
 *
 * Four masses, each doing a different job:
 *
 * - **The HALL is hollow and has a cart arch in its -Z gable**, so the flag it
 *   stands on has an interior. Six piers down the middle are the only cover in
 *   it, which makes it a room you cross rather than a room you own — the
 *   deliberate counterweight to the old town's five-metre lanes at the other
 *   end of the island. The arch is 6.4 m so that armour drives THROUGH the
 *   works rather than merely up to it.
 * - **The FURNACE BLOCK is solid and is the light.** Three tap arches on its
 *   -Z face carry the one `LocalLight` this structure spends, at head height
 *   where a body is lit by it, rather than at the top of the stack where it
 *   would light nothing at all. Everything else that glows here — the
 *   clerestory, the ridge lantern, the ring under the crown — is `Build.glow`,
 *   which takes the bloom and the fog fade for free and spends no slot.
 * - **The STACK is the silhouette**: three drums and two iron collars, because
 *   thirty metres of bare taper has no scale at eight hundred.
 * - **The CHARGING DECK is the gameplay** — six metres over the yard along the
 *   hall's whole +Z flank, one stone flight up at the west end, a rail on the
 *   outboard edge and a rust hopper at the far end so that two players on it
 *   have something between them.
 *
 * Fixed geometry, for `buildJungleManor`'s reason: the deck, the flight that
 * reaches it and the three charging doors it serves are solved against one
 * plan, and a `width` that moved any of the three would move the other two
 * wrong and say nothing.
 */
export function buildSmelter(scene: Scene, mats: CelMaterialFactory): Structure {
  const b = new Build(scene, mats, "smelter");

  // --- the plan ---------------------------------------------------------
  /** Wall thickness. Masonry carrying a roof this wide has to READ thick. */
  const T = 0.9;
  /** The apron every mass stands on. Under `stepHeight`, so it merges. */
  const PLINTH = 0.5;
  const HALL_X = -6;
  const HALL_W = 32;
  const HALL_D = 20;
  const EAVES = 10.5;
  const FURN_X = 16;
  const FURN_W = 12;
  const FURN_D = 14;
  const FURN_H = 8.6;
  /** Walked height of the charging deck, and the rise its flight climbs to. */
  const DECK_Y = 6.2;
  const DECK_X0 = -28;
  const DECK_X1 = 20;
  const DECK_Z0 = 10.0;
  const DECK_Z1 = 14.6;
  const STAIR_X = -25.5;
  const STAIR_W = 3.4;

  const hallZ0 = -HALL_D / 2;
  const hallZ1 = HALL_D / 2;
  const hallX0 = HALL_X - HALL_W / 2;
  const hallX1 = HALL_X + HALL_W / 2;
  const floor = PLINTH;

  // --- the apron --------------------------------------------------------
  // One slab under the hall, the furnace, the deck's piers and the foot of the
  // stair, so the casting floor, the tap floor and the yard outside are one
  // surface the nav graph never has to step between.
  b.box(56, PLINTH, 32, 0, PLINTH / 2, 0, SLAG);
  b.block({ w: 56, h: PLINTH, d: 32, x: 0, y: PLINTH / 2, z: 0 });

  // --- the hall ---------------------------------------------------------
  b.doorWall(HALL_W, EAVES, T, HALL_X, floor + EAVES / 2, hallZ0 + T / 2, BASALT, 6.4, 7.2);
  b.wall(HALL_W, EAVES, T, HALL_X, floor + EAVES / 2, hallZ1 - T / 2, BASALT);
  // The -X gable's own doorway, laid out by hand: `doorWall` runs along X, so a
  // wall running along Z cannot use it (the mosque's side walls, for the same
  // reason and in the same shape).
  {
    const run = (HALL_D - 3.4) / 2;
    for (const sz of [-1, 1] as const) {
      b.wall(T, EAVES, run, hallX0 + T / 2, floor + EAVES / 2, (sz * (run + 3.4)) / 2, BASALT);
    }
    b.wall(T, EAVES - 3.6, 3.4, hallX0 + T / 2, floor + 3.6 + (EAVES - 3.6) / 2, 0, BASALT);
  }
  b.wall(T, EAVES, HALL_D - T * 2, hallX1 - T / 2, floor + EAVES / 2, 0, BASALT);

  // The buttresses, on the YARD flank only — the other flank carries the deck,
  // and a buttress standing where a gantry pier stands is two masses in one
  // place with nothing to say which the collider belongs to.
  for (let i = 0; i < 5; i++) {
    const x = hallX0 + 3.2 + i * ((HALL_W - 6.4) / 4);
    const z = hallZ0 - 0.55;
    b.wall(1.6, EAVES - 1.8, 1.4, x, floor + (EAVES - 1.8) / 2, z, BASALT);
    b.box(2.0, 0.5, 1.8, x, floor + EAVES - 1.8, z, BASALT_PALE);
  }

  // The clerestory: louvred slots under the eaves, glowing with what is going
  // on inside. `Build.glow` and not glazing — a smelter's upper wall is open
  // to let the heat out, and an emissive slot costs no pane, no alpha-blended
  // draw and no light slot while being the thing that reads across the bay.
  for (let i = 0; i < 7; i++) {
    const x = hallX0 + 2.6 + i * ((HALL_W - 5.2) / 6);
    for (const sz of [-1, 1] as const) {
      const z = sz * (HALL_D / 2 - 0.08);
      b.glow(1.8, 1.1, 0.16, x, floor + EAVES - 0.9, z, EMBER);
      b.box(2.2, 0.26, 0.42, x, floor + EAVES - 0.25, z, BASALT_PALE);
    }
  }

  // The casting floor and the piers over it. Six is what leaves two aisles a
  // body can move down and no corner it can hold both of them from.
  b.box(HALL_W - T * 2, 0.16, HALL_D - T * 2, HALL_X, floor + 0.08, 0, SLAG);
  for (const dx of [-9, 0, 9]) {
    for (const sz of [-1, 1] as const) {
      b.wall(1.1, EAVES - 0.6, 1.1, HALL_X + dx, floor + (EAVES - 0.6) / 2, sz * 5.2, BASALT);
    }
  }
  // The tap channels running out of the furnace end: the one hot thing in here
  // at a height a body is lit by.
  for (const dz of [-4.4, 0, 4.4]) {
    b.box(7.4, 0.22, 1.1, 6.5, floor + 0.05, dz, SLAG);
    b.glow(7.0, 0.14, 0.42, 6.5, floor + 0.2, dz, EMBER);
  }
  // The SECOND light, and the only one this structure spends indoors. A
  // hollow hall lit by nothing but three emissive channels is a black room
  // with three orange lines on the floor: a `Build.glow` takes the bloom for
  // free and lights NOTHING, which is exactly the trade `BuildParams.lit`
  // states — so a room a player is meant to fight inside has to pay a slot for
  // it. The works gave up two of its four kilns to afford this and the tap
  // arches together, which is what a light budget looks like when it is spent
  // rather than assumed.
  b.light(EMBER, 26, 1.5, 0.45, 8, floor + 2.4, 0);

  // A 5.4 m rise over a 32 m span — an 18-degree pitch, where the first
  // attempt was 12. **A shallow roof on a mass this wide reads as a LID**, and
  // at three hundred metres that is the difference between a hall and a
  // shipping container: the silhouette is most of what a landmark is, and the
  // roof is a third of the silhouette.
  b.gableRoof(HALL_W, HALL_D, 5.4, HALL_X, floor + EAVES, 0, SLATE, 0.7);
  // The ridge lantern: the louvred vent a hall this hot is topped with, and
  // the reason the roof is not one flat grey lid seen from a helicopter.
  b.box(4.2, 1.6, HALL_D - 6, HALL_X, floor + EAVES + 5.3, 0, TIMBER);
  b.glow(3.4, 1.0, HALL_D - 6.6, HALL_X, floor + EAVES + 5.2, 0, EMBER);
  b.box(5.0, 0.3, HALL_D - 5.2, HALL_X, floor + EAVES + 6.2, 0, SLATE);

  // --- the furnace block ------------------------------------------------
  // Battered: two courses, the lower one wider. That is how a mass which has
  // to hold heat is built, and it is what stops twelve metres of basalt from
  // reading as a packing crate.
  b.wall(FURN_W + 1.6, 2.2, FURN_D + 1.6, FURN_X, floor + 1.1, 0, BASALT);
  b.wall(FURN_W, FURN_H - 2.2, FURN_D, FURN_X, floor + 2.2 + (FURN_H - 2.2) / 2, 0, BASALT);
  b.box(FURN_W + 1.2, 0.5, FURN_D + 1.2, FURN_X, floor + FURN_H + 0.25, 0, BASALT_PALE);

  // The three tap arches, and the ONE light this structure spends — at head
  // height, on the face the yard is, because a furnace lighting only its own
  // chimney would be a picture rather than somewhere to fight.
  for (const dx of [-4.2, 0, 4.2]) {
    const x = FURN_X + dx;
    const z = -FURN_D / 2 - 0.85;
    b.glow(1.7, 2.0, 0.3, x, floor + 1.0, z, EMBER);
    b.box(2.5, 0.6, 0.5, x, floor + 2.3, z, BASALT_PALE);
    for (const sx of [-1, 1] as const) {
      b.box(0.5, 2.6, 0.5, x + sx * 1.35, floor + 1.3, z, BASALT_PALE);
    }
  }
  b.light(EMBER, 34, 2.1, 0.5, FURN_X, floor + 1.8, -FURN_D / 2 - 2.4);
  // The tap floor: a spill of clinker on the ground the arches open onto, and
  // the sulphur crust down the block's lee side.
  b.box(FURN_W + 6, 0.14, 8, FURN_X, floor + 0.08, -11.7, SLAG);
  b.box(0.5, 3.4, FURN_D - 3, FURN_X + FURN_W / 2 + 0.2, floor + 1.7, 0, SULPHUR);

  // --- the stack --------------------------------------------------------
  const stackY = floor + FURN_H + 0.5;
  const drums: [number, number, number][] = [
    [11, 6.6, 7.6],
    [10, 5.4, 6.6],
    [9, 4.2, 5.4],
  ];
  let sy = stackY;
  for (const [h, top, bot] of drums) {
    b.cyl(h, top, bot, 8, FURN_X, sy + h / 2, 0, BASALT);
    sy += h;
    // The iron collar at each lift. Two bands crossing a taper is the whole of
    // what gives it scale from the far shore; a bare cone has none.
    if (sy < stackY + 30) b.cyl(0.7, top + 0.35, top + 0.35, 8, FURN_X, sy, 0, RUST);
  }
  // The crown, and the ring of fire under its lip: what the middle of this map
  // is navigated by at night.
  b.glow(4.9, 0.6, 4.9, FURN_X, sy - 0.7, 0, EMBER);
  b.cyl(1.0, 4.9, 4.4, 8, FURN_X, sy + 0.5, 0, RUST);
  // ONE box for the whole shaft, sized off the SILHOUETTE across the middle
  // drum rather than off its circumdiameter — kit/structures/'s rule, and a
  // box taking the 7.6 at the foot would stop rounds a metre off drawn stone.
  b.block({ w: 5.8, h: sy + 1 - stackY, d: 5.8, x: FURN_X, y: (stackY + sy + 1) / 2, z: 0 });

  // --- the charging deck ------------------------------------------------
  const deckLen = DECK_X1 - DECK_X0;
  const deckX = (DECK_X0 + DECK_X1) / 2;
  const deckD = DECK_Z1 - DECK_Z0;
  const deckZ = (DECK_Z0 + DECK_Z1) / 2;
  b.box(deckLen, 0.5, deckD, deckX, DECK_Y - 0.25, deckZ, PLANK);
  b.block({ w: deckLen, h: 0.5, d: deckD, x: deckX, y: DECK_Y - 0.25, z: deckZ });
  for (let i = 0; i <= 6; i++) {
    const x = DECK_X0 + 2.5 + i * ((deckLen - 5) / 6);
    b.wall(1.2, DECK_Y - 0.5, 1.2, x, (DECK_Y - 0.5) / 2, DECK_Z1 - 1.2, BASALT);
  }
  // The rail on the outboard edge and on both ends. Not on the hall side:
  // that edge is a ten-metre wall, which is a better rail than a rail.
  b.guard("+z", DECK_Z1, deckX, deckLen, DECK_Y);
  b.guard("-x", DECK_X0, deckZ, deckD, DECK_Y);
  b.guard("+x", DECK_X1, deckZ, deckD, DECK_Y);

  // The three charging doors the deck serves. They do not open — what is
  // behind them is the roof void — and they are what says the deck is a
  // working floor rather than a balcony somebody hung on the building.
  for (const dx of [-9, 0, 9]) {
    const x = HALL_X + dx;
    b.box(2.6, 2.8, 0.3, x, DECK_Y + 1.4, hallZ1 - 0.05, RUST);
    b.glow(2.2, 0.18, 0.14, x, DECK_Y + 0.16, hallZ1 + 0.06, EMBER);
    b.box(3.2, 0.4, 0.5, x, DECK_Y + 3.0, hallZ1, BASALT_PALE);
  }

  // The tramway down the deck and the tipper standing on it: two rails and
  // four boxes, the cheapest thing in this file and most of what makes six
  // metres of planking read as somewhere people work.
  for (const dz of [-0.9, 0.9]) {
    b.box(deckLen - 1.5, 0.12, 0.16, deckX, DECK_Y + 0.06, deckZ + dz, RUST);
  }
  b.wall(2.4, 1.5, 2.0, DECK_X0 + 9, DECK_Y + 0.75, deckZ, RUST);
  b.box(2.6, 0.3, 2.2, DECK_X0 + 9, DECK_Y + 1.5, deckZ, SLAG);
  // The hopper at the head of the tramway: cover on a deck that would
  // otherwise be a shooting gallery from either end.
  b.wall(4.4, 3.6, 3.2, DECK_X1 - 3.6, DECK_Y + 1.8, deckZ, RUST);
  b.box(4.8, 0.4, 3.6, DECK_X1 - 3.6, DECK_Y + 3.8, deckZ, RUST);

  // --- the flight up to it ----------------------------------------------
  // The rise is measured from the APRON and not from zero: the flight stands
  // on the same slab everything else here does, and `Build.flight` buries
  // whatever falls below its own local ground line rather than knowing that.
  const rise = DECK_Y - PLINTH;
  const run = rise / GRADE;
  const topZ = DECK_Z0 + 0.9;
  b.flight({
    x: STAIR_X,
    w: STAIR_W,
    topZ,
    topY: DECK_Y,
    run,
    rise,
    dir: 1,
    // 24 rather than `rise / 0.19`: that would be thirty treads and sixty
    // boxes for one flight, and a 0.24 riser is what an industrial stair has.
    steps: 24,
    color: BASALT,
  });
  const pitch = Math.atan(GRADE);
  for (const sx of [-1, 1] as const) {
    b.guard(
      sx > 0 ? "+x" : "-x",
      STAIR_X + (sx * STAIR_W) / 2,
      topZ - run / 2,
      run,
      (PLINTH + DECK_Y) / 2,
      { pitch, color: IRON },
    );
  }
  return b;
}

// =============================================================================
// The light on the point
// =============================================================================

/**
 * A LIGHTHOUSE: a coursed basalt tower on a rusticated plinth, a corbelled
 * gallery with a lattice rail, a helically glazed lantern under a ribbed dome,
 * and the keeper's cottage at its foot.
 *
 * **This is what stopped seven watchtowers standing in for the one thing a
 * coast actually builds.** A timber watchtower on a headland says somebody is
 * looking out; a light says this water is dangerous and people come here
 * anyway, which is the whole read of an island with a harbour cut into it. It
 * also answers something the map needed at night and had no piece for: a
 * 1,500 m square with a wadeable bay across the middle of it wants a thing you
 * can steer by from the water, and a lamp on a lamp post is invisible at three
 * hundred metres.
 *
 * **Not climbable**, for `buildMinaret`'s reason: one way up to a gallery at
 * eighteen metres, on a map whose fog wall is 1,250, is a position with no
 * counter. It is a landmark and a light, and it costs four collider boxes to
 * be both — plus the cottage's seven, which make it a room you can walk into.
 *
 * The lantern carries a `LocalLight`, which is a real spend out of sixteen —
 * so a map lights the ones standing where somebody has to walk and lets the
 * rest be lights you can see rather than lights that light you.
 *
 * ## What it is drawn as
 *
 * A Stevenson rock tower brought ashore: what a lighthouse board built on a
 * headland of the island's own rock in the 1850s.
 *
 * - **The PLINTH is square and battered**, four courses of rock-faced basalt
 *   between pale quoins, on a footing carried below the ground so a slope
 *   cannot show under it, under a pale coping. Square, because the collider
 *   it stands over is — the round splay it replaced stood 0.8 m outside that
 *   box at the foot and inside it at the corners.
 * - **The SHAFT is ashlar**, laid as it was built: a ring of dressed stones a
 *   course, every other course turned half a stone so the joints break, over a
 *   dark core set back far enough that every joint is a step the ink finds.
 *   Its profile is the slight concave of a tower built to shed a sea. Two pale
 *   string courses give it scale, and stair windows climb it in pale margins.
 * - **The GALLERY is carried on twenty stepped corbels**, a soffit and a deck
 *   with a drip, and railed with stanchions braced by a diagonal lattice.
 * - **The LANTERN stands on a panelled iron pedestal with its door onto the
 *   gallery**, glazed between helical astragals — the one detail that says
 *   "lighthouse" from anywhere — under a ribbed RUST dome, a ventilator ball, a
 *   rod and a vane. The glow is a twelve-sided drum of panes, still one colour.
 * - **The COTTAGE is harled pale with dark dressed margins**, as a keeper's
 *   cottage was: quoins, a base course, sash windows in margins with sills, a
 *   slate roof thick enough to read as a roof, its gables in WALL colour with
 *   skews, skewputts and an apex stone, a wall-head stack with its cans, iron
 *   rainwater goods, a doorstep, the door standing open against the inside of
 *   the front wall and a fireplace on the inside of the +X wall.
 *
 * The windows used to be drawn centred in the walls they lit, so nothing of
 * them showed; they are on the faces now. Everything that varies here is
 * fixed by the plan, so nothing is seeded, and the footings are carried below
 * the ground rather than conformed to it — every placement stands on a pad.
 */
export function buildLighthouse(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "lighthouse");
  const h = p.height ?? 26;
  const baseH = 2.6;
  /** Where the gallery's corbel course sits. The shaft is everything under. */
  const galleryY = h - 8.0;
  const shaft = galleryY - baseH;
  const lampY = galleryY + 2.5;

  // --- the colliders, byte for byte and in the order they always were -----
  // The tower is four boxes, a landmark and a light; the cottage is its walls
  // and `gableRoof`'s slab, restated so the drawing over them is free.
  b.block({ w: 9.8, h: baseH, d: 9.8, x: 0, y: baseH / 2, z: 0 });
  b.block({ w: 6.9, h: shaft, d: 6.9, x: 0, y: baseH + shaft / 2, z: 0 });
  b.block({ w: 8.6, h: 2.2, d: 8.6, x: 0, y: galleryY + 1.1, z: 0 });
  b.block({ w: 4.2, h: 3.0, d: 4.2, x: 0, y: lampY + 1.4, z: 0 });
  // The colour is a warm WHITE rather than the `FLAME` a fire gets — this is
  // the one thing on the island meant to be picked out from the far shore of
  // the bay, and a lamp that reads as a bonfire reads as somewhere to go
  // rather than a warning.
  b.light("#ffe2a8", 44, 2.0, 0.03, 0, lampY + 1.2, 0);

  const cw = 7.4;
  const cd = 5.4;
  const ch = 3.2;
  const cz = -(5.4 + cd / 2);
  const overhang = 0.4;
  b.doorWall(cw, ch, 0.35, 0, ch / 2, cz - cd / 2, BASALT_PALE, 1.5, 2.2);
  b.wall(cw, ch, 0.35, 0, ch / 2, cz + cd / 2, BASALT_PALE);
  for (const sx of [-1, 1] as const) b.wall(0.35, ch, cd, (sx * cw) / 2, ch / 2, cz, BASALT_PALE);
  b.block({ w: cw + overhang * 2, h: 0.3, d: cd + overhang * 2, x: 0, y: ch, z: cz });

  // Everything below is drawing.
  const sb = new StoneBatch();
  const lamp = new StoneBatch();

  // --- the plinth ---------------------------------------------------------
  /** Top of the footing, top of the battered courses, and their half-widths. */
  const P0 = 0.25;
  const P1 = 2.4;
  const foot = 5.15;
  const head = 4.92;
  const pLean = Math.atan((foot - head) / (P1 - P0));
  const pCourses = 4;
  const ph = (P1 - P0) / pCourses;
  const plinthAt = (y: number): number => foot - ((foot - head) * (y - P0)) / (P1 - P0);
  /** The +Z face's doorway, as a cut out of its courses. */
  const DOOR = 0.95;
  for (let k = 0; k < pCourses; k++) {
    const ym = P0 + (k + 0.5) * ph;
    const a = plinthAt(ym);
    for (let f = 0; f < 4; f++) {
      const yaw = (f * Math.PI) / 2;
      // A long and a short stone round every corner, swapping each course, so
      // the quoins interlock — both ends of one face are the same length.
      const q = (k + f) % 2 === 0 ? 0.95 : 0.55;
      for (const e of [-1, 1] as const) {
        dressed(sb, yaw, a + 0.02, e * (a - q / 2), ym, q - 0.03, ph - 0.04, 0.34, pLean, BASALT_PALE);
      }
      const cuts: [number, number][] = f === 0 ? [[-DOOR, DOOR]] : [];
      for (const [u0, u1] of carve(-a + q, a - q, cuts)) {
        for (const [s0, s1] of splitRun(u0, u1, 1.15, k % 2 === 1)) {
          dressed(sb, yaw, a, (s0 + s1) / 2, ym, s1 - s0 - 0.05, ph - 0.05, 0.3, pLean, BASALT);
        }
      }
    }
  }
  // The tower door, on the face away from the cottage: jamb stones coursed
  // with the plinth, a recessed boarded leaf on iron straps, a lintel and a
  // keystone.
  for (let k = 0; k < pCourses; k++) {
    const ym = P0 + (k + 0.5) * ph;
    for (const e of [-1, 1] as const) {
      dressed(sb, 0, plinthAt(ym) + 0.03, e * 0.785, ym, 0.3, ph - 0.04, 0.34, pLean, BASALT_PALE);
    }
  }
  const leafY = P0 + 0.925;
  for (let i = 0; i < 5; i++) {
    dressed(sb, 0, plinthAt(leafY) - 0.05, -0.496 + i * 0.248, leafY, 0.24, 1.85, 0.1, pLean, PITCH);
  }
  for (const y of [0.65, 1.75]) dressed(sb, 0, plinthAt(y) - 0.02, -0.15, y, 0.85, 0.07, 0.05, pLean, IRON);
  dressed(sb, 0, plinthAt(2.25) + 0.05, 0, 2.25, 2.2, 0.3, 0.4, pLean, BASALT_PALE);
  dressed(sb, 0, plinthAt(2.25) + 0.09, 0, 2.25, 0.36, 0.42, 0.4, pLean, BASALT_PALE);
  // A barred vent in each flank, lighting the store under the stair.
  for (const yaw of [Math.PI / 2, -Math.PI / 2]) {
    const ym = P0 + 2.5 * ph;
    const a = plinthAt(ym);
    dressed(sb, yaw, a + 0.04, 0, ym, 0.34, 0.72, 0.1, pLean, IRON);
    for (const e of [-1, 1] as const) dressed(sb, yaw, a + 0.07, e * 0.26, ym, 0.18, 0.96, 0.14, pLean, BASALT_PALE);
    dressed(sb, yaw, a + 0.1, 0, ym - 0.42, 0.74, 0.1, 0.18, pLean, BASALT_PALE);
    dressed(sb, yaw, a + 0.08, 0, ym + 0.44, 0.7, 0.16, 0.16, pLean, BASALT_PALE);
  }

  // --- the shaft ----------------------------------------------------------
  /** The shaft's radius at its foot and its head; the profile between is concave. */
  const R0 = 4.3;
  const R1 = 2.9;
  const tAt = (y: number): number => Math.min(1, Math.max(0, (y - baseH) / shaft));
  const radius = (y: number): number => R1 + (R0 - R1) * Math.pow(1 - tAt(y), 1.25);
  const lean = (y: number): number => Math.atan(((R0 - R1) * 1.25 * Math.pow(1 - tAt(y), 0.25)) / shaft);
  /** Stones a course. */
  const N = 20;
  const courses = Math.max(8, Math.round(shaft / 0.55));
  const hc = shaft / courses;
  const bands = new Set([Math.round(courses / 3), Math.round((2 * courses) / 3)]);
  for (let k = 0; k < courses; k++) {
    const ym = baseH + (k + 0.5) * hc;
    const band = bands.has(k);
    const a = radius(ym) + (band ? 0.12 : 0);
    const side = 2 * a * Math.tan(Math.PI / N);
    const off = ((k % 2) * Math.PI) / N;
    for (let j = 0; j < N; j++) {
      const yaw = off + (j * 2 * Math.PI) / N;
      if (band) dressed(sb, yaw, a, 0, ym, side - 0.03, hc - 0.03, 0.42, lean(ym), BASALT_PALE);
      else dressed(sb, yaw, a, 0, ym, side - 0.035, hc - 0.035, 0.28, lean(ym), BASALT);
    }
  }
  // Stair windows, a quarter-turn and four courses apart: the stair inside
  // climbs, so its lights climb round the tower with it.
  for (let i = 0, k = 3; k + 2 < courses - 2; i++, k += 4) {
    if (bands.has(k) || bands.has(k + 1)) continue;
    const yaw = ((i * 5 + 3) * 2 * Math.PI) / N + ((k % 2) * Math.PI) / N;
    const y0 = baseH + k * hc + 0.06;
    const y1 = baseH + (k + 2) * hc - 0.06;
    const ym = (y0 + y1) / 2;
    const a = radius(ym) + 0.05;
    const tilt = lean(ym);
    dressed(sb, yaw, a, 0, ym, 0.42, y1 - y0 - 0.22, 0.12, tilt, IRON);
    for (const e of [-1, 1] as const) dressed(sb, yaw, a + 0.03, e * 0.31, ym, 0.2, y1 - y0, 0.16, tilt, BASALT_PALE);
    dressed(sb, yaw, a + 0.06, 0, y0 + 0.06, 0.9, 0.12, 0.22, tilt, BASALT_PALE);
    dressed(sb, yaw, a + 0.04, 0, y1 - 0.1, 0.82, 0.2, 0.18, tilt, BASALT_PALE);
  }

  // --- the gallery --------------------------------------------------------
  // Twenty corbels, each four stones stepping out, under a soffit and a deck.
  for (let j = 0; j < N; j++) {
    const yaw = ((j + 0.5) * 2 * Math.PI) / N;
    for (let i = 0; i < 4; i++) {
      const a = R1 + 0.33 * (i + 1);
      dressed(sb, yaw, a, 0, galleryY - 1.12 + 0.28 * i + 0.14, 0.4, 0.26, a - R1 + 0.3, 0, BASALT_PALE);
    }
  }
  b.cyl(0.3, 8.7, 8.7, N, 0, galleryY + 0.15, 0, BASALT_PALE);
  b.cyl(0.3, 9.1, 9.1, N, 0, galleryY + 0.45, 0, BASALT_PALE);
  /** The deck the rail and the lantern stand on. */
  const D = galleryY + 0.6;
  const railR = 4.3;
  const rail = (j: number, y: number): Point3 => {
    const a = (j * 2 * Math.PI) / N;
    return [Math.sin(a) * railR, y, Math.cos(a) * railR];
  };
  for (let j = 0; j < N; j++) {
    const [x, , z] = rail(j, 0);
    sb.box(0.07, 1.05, 0.07, x, D + 0.525, z, IRON, { y: (j * 2 * Math.PI) / N });
    bar(sb, rail(j, D + 1.05), rail(j + 1, D + 1.05), 0.07, 0.06, IRON);
    bar(sb, rail(j, D + 0.1), rail(j + 1, D + 0.1), 0.06, 0.05, IRON);
    bar(sb, rail(j, D + 0.1), rail(j + 1, D + 1.05), 0.035, 0.035, IRON);
    bar(sb, rail(j, D + 1.05), rail(j + 1, D + 0.1), 0.035, 0.035, IRON);
  }

  // --- the lantern --------------------------------------------------------
  /** Sides of the lantern, and the apothem of its pedestal and of its glass. */
  const L = 12;
  const pedA = 1.884;
  const glassA = 1.8;
  const facet = (j: number): number => (j * 2 * Math.PI) / L;
  for (let j = 0; j < L; j++) {
    const yaw = facet(j);
    const side = 2 * pedA * Math.tan(Math.PI / L);
    dressed(sb, yaw, pedA, 0, D + 0.575, side, 1.15, 0.14, 0, IRON);
    // A panel on every face but the one that is the door onto the gallery.
    if (j === 0) {
      dressed(sb, yaw, pedA + 0.05, 0, D + 0.5, 0.62, 0.95, 0.1, 0, IRON);
      dressed(sb, yaw, pedA + 0.09, 0.2, D + 0.55, 0.05, 0.12, 0.06, 0, BASALT_PALE);
    } else {
      dressed(sb, yaw, pedA + 0.03, 0, D + 0.6, side * 0.66, 0.7, 0.06, 0, IRON);
    }
    dressed(sb, yaw, 2.0, 0, D + 1.21, 2 * 2.0 * Math.tan(Math.PI / L) + 0.01, 0.12, 0.3, 0, IRON);
  }
  const G0 = D + 1.27;
  const G1 = D + 3.65;
  const GH = G1 - G0;
  const corner = (j: number, y: number, r = 1.89): Point3 => {
    const a = facet(j) + Math.PI / L;
    return [Math.sin(a) * r, y, Math.cos(a) * r];
  };
  for (let j = 0; j < L; j++) {
    dressed(lamp, facet(j), glassA, 0, (G0 + G1) / 2, 2 * glassA * Math.tan(Math.PI / L) + 0.01, GH, 0.06, 0, "#ffe6b0");
    const [x, , z] = corner(j, 0, 1.87);
    sb.box(0.13, GH, 0.11, x, (G0 + G1) / 2, z, IRON, { y: facet(j) + Math.PI / L });
    // The helical astragals: each bar climbs half the glazing across one pane
    // and the next carries on from where it stopped, so the bars wind round
    // the drum and no pane has a vertical edge of its own.
    bar(sb, corner(j, G0, 1.91), corner(j + 1, G0 + GH / 2, 1.91), 0.1, 0.07, IRON);
    bar(sb, corner(j, G0 + GH / 2, 1.91), corner(j + 1, G1, 1.91), 0.1, 0.07, IRON);
    bar(sb, corner(j, G0 + 0.04), corner(j + 1, G0 + 0.04), 0.09, 0.08, IRON);
    bar(sb, corner(j, G1 - 0.04), corner(j + 1, G1 - 0.04), 0.09, 0.08, IRON);
    dressed(sb, facet(j), 2.14, 0, G1 + 0.11, 2 * 2.14 * Math.tan(Math.PI / L) + 0.01, 0.22, 0.42, 0, RUST);
  }
  // The dome: a ribbed cone and a neck, a ventilator ball, the rod and vane.
  const dome0 = G1 + 0.22;
  b.cyl(1.0, 1.3, 4.1, L, 0, dome0 + 0.5, 0, RUST);
  b.cyl(0.35, 0.55, 1.3, L, 0, dome0 + 1.175, 0, RUST);
  for (let j = 0; j < L; j++) bar(sb, corner(j, dome0 + 0.02, 2.11), corner(j, dome0 + 1.02, 0.72), 0.07, 0.07, RUST);
  const ball = dome0 + 1.35;
  b.cyl(0.14, 0.62, 0.42, 8, 0, ball + 0.07, 0, IRON);
  b.cyl(0.2, 0.62, 0.62, 8, 0, ball + 0.24, 0, IRON);
  b.cyl(0.14, 0.38, 0.62, 8, 0, ball + 0.41, 0, IRON);
  b.cyl(1.25, 0.04, 0.07, 6, 0, ball + 1.1, 0, IRON);
  const vane = ball + 1.35;
  for (const yaw of [0, Math.PI / 2]) sb.box(0.6, 0.03, 0.03, 0, vane - 0.22, 0, IRON, { y: yaw });
  sb.box(0.95, 0.035, 0.035, 0, vane, 0, IRON);
  sb.box(0.04, 0.22, 0.3, -0.45, vane, 0, IRON);
  sb.box(0.14, 0.14, 0.03, 0.47, vane, 0, IRON, { z: Math.PI / 4 });

  // --- the keeper's cottage -----------------------------------------------
  // What turns a light into somewhere somebody lives, on a headland otherwise
  // made of rock: harled pale, dressed in dark stone.
  /** Where its faces are: the front wall's outer plane, and the flanks'. */
  const front = -cz + cd / 2 + 0.175;
  const flank = cw / 2 + 0.175;
  /** The rear wall's centre line, against the tower. */
  const rear = -cz - cd / 2;
  for (const [u0, u1] of carve(-flank, flank, [[-0.75, 0.75]])) {
    sb.onFace("-z", front, (u0 + u1) / 2, 0.075, u1 - u0, 0.75, 0.08, 0.02, BASALT);
  }
  for (const s of ["-x", "+x"] as const) {
    sb.onFace(s, flank, (-front - rear) / 2, 0.075, front - rear, 0.75, 0.08, 0.02, BASALT);
  }
  // Quoins round the two front corners, long on the front and short on the
  // flank course by course, which also closes the notch the walls leave there.
  const qh = (ch - 0.45) / 8;
  for (const sx of [-1, 1] as const) {
    for (let q = 0; q < 8; q++) {
      const y = 0.45 + (q + 0.5) * qh;
      if (q % 2 === 0) sb.box(0.62, qh - 0.03, 0.295, sx * (flank + 0.04 - 0.31), y, -front + 0.1075, BASALT);
      else sb.box(0.295, qh - 0.03, 0.62, sx * (flank + 0.04 - 0.1475), y, -front - 0.04 + 0.31, BASALT);
    }
  }
  // The door: margins, a doorstep, and the leaf standing open against the
  // inside of the front wall.
  for (const e of [-1, 1] as const) sb.onFace("-z", front, e * 0.85, 1.2, 0.2, 2.4, 0.06, 0.01, BASALT);
  sb.onFace("-z", front, 0, 2.3, 1.9, 0.2, 0.06, 0.01, BASALT);
  b.box(1.8, 0.12, 0.45, 0, 0.06, -front - 0.225, BASALT_PALE);
  const inner = front - 0.35;
  for (let i = 0; i < 4; i++) b.box(0.345, 2.15, 0.045, -0.75 - 0.175 - i * 0.35, 1.075, -inner + 0.0255, PITCH);
  for (const y of [0.35, 1.07, 1.8]) b.box(1.36, 0.12, 0.03, -1.45, y, -inner + 0.063, PITCH);
  // Sash windows: two in the front, one in each flank.
  sashWindow(b, sb, "-z", front, -2.225);
  sashWindow(b, sb, "-z", front, 2.225);
  sashWindow(b, sb, "-x", flank, cz - 0.8);
  sashWindow(b, sb, "+x", flank, cz - 0.8);
  // The fireplace on the inside of the +X wall, and its stack on the wall head
  // over it, rising through the eaves with two cans on the cope.
  const fz = -6.7;
  const room = -(cw / 2 - 0.175);
  sb.onFace("-x", room, fz, 0.4, 0.8, 0.75, 0.02, 0.01, IRON);
  for (const e of [-1, 1] as const) sb.onFace("-x", room, fz + e * 0.525, 0.525, 0.25, 1.05, 0.1, 0.05, BASALT);
  sb.onFace("-x", room, fz, 0.9, 1.3, 0.2, 0.1, 0.05, BASALT);
  sb.onFace("-x", room, fz, 1.11, 1.45, 0.08, 0.22, 0.11, BASALT);
  b.box(0.6, 0.04, 1.5, cw / 2 - 0.175 - 0.3, 0.02, fz, BASALT);
  b.box(0.8, 2.3, 1.0, cw / 2, ch + 1.05, fz, BASALT_PALE);
  b.box(0.95, 0.1, 1.15, cw / 2, ch + 2.25, fz, BASALT);
  for (const e of [-1, 1] as const) b.cyl(0.42, 0.2, 0.25, 8, cw / 2, ch + 2.51, fz + e * 0.26, RUST);

  // The roof: gables in WALL colour, then slate laid in lapped courses over
  // them, a ridge, skews up the front gable, and the eaves closed and guttered.
  const run = cw / 2 + overhang;
  const rise = 1.3;
  const pitch = Math.atan2(rise, run);
  const roofAt = (x: number): number => ch + (rise * (run - Math.abs(x))) / run;
  for (const [z0, z1] of [
    [-front, -front + 0.35],
    [-rear - 0.175, -rear + 0.175],
  ]) {
    const gable = (z: number): Point3[] => [
      [-flank, ch, z],
      [flank, ch, z],
      [flank, roofAt(flank), z],
      [0, ch + rise, z],
      [-flank, roofAt(flank), z],
    ];
    convexSolid(b, gable(z0), gable(z1), BASALT_PALE);
  }
  const slope = Math.hypot(run, rise);
  const slates = 8;
  const roofLen = front - (rear - 0.175) + 0.24;
  const nx = Math.sin(pitch);
  const ny = Math.cos(pitch);
  for (const s of [-1, 1] as const) {
    for (let i = 0; i < slates; i++) {
      const f = (i + 0.5) / slates;
      const x = s * run * (1 - f) + s * nx * 0.055;
      const y = ch + rise * f + ny * 0.055;
      sb.box(slope / slates + 0.1, 0.1, roofLen, x, y, cz, SLATE, { z: -s * (pitch - 0.06) });
    }
    // The eaves: a soffit back to the wall, a fascia and an iron gutter, and
    // a downpipe at the front corner run down the flank to the ground.
    b.box(0.25, 0.03, roofLen, s * (flank + 0.12), ch + 0.035, cz, BASALT);
    b.box(0.13, 0.11, roofLen, s * (run + 0.07), ch - 0.03, cz, IRON);
    b.box(0.3, 0.06, 0.08, s * (flank + 0.17), ch - 0.08, -front + 0.75, IRON);
    b.box(0.08, ch - 0.1, 0.08, s * (flank + 0.06), (ch - 0.1) / 2, -front + 0.75, IRON);
    // The skew up the front gable, on a skewputt at the eaves.
    const lo: Point3 = [s * (flank + 0.05), roofAt(flank + 0.05) + 0.2, -front + 0.175];
    const hi: Point3 = [0, ch + rise + 0.2, -front + 0.175];
    slab(b, lo, hi, 0.45, 0.16, BASALT);
    b.box(0.5, 0.45, 0.5, s * (flank - 0.05), ch + 0.2, -front + 0.175, BASALT);
  }
  b.box(0.3, 0.35, 0.45, 0, ch + rise + 0.32, -front + 0.175, BASALT);
  const ridge = (z: number): Point3[] => [
    [-0.25, ch + rise - 0.02, z],
    [0.25, ch + rise - 0.02, z],
    [0, ch + rise + 0.2, z],
  ];
  convexSolid(b, ridge(-front - 0.12), ridge(-rear + 0.175 + 0.12), BASALT);

  // The stones before what they hide, then the cores they hide.
  sb.flush(b);
  lamp.flushGlow(b);
  for (let k = 0; k < courses; k += 2) {
    const y0 = baseH + k * hc;
    const y1 = baseH + Math.min(courses, k + 2) * hc;
    b.cyl(y1 - y0, 2 * (radius(y1) - 0.07), 2 * (radius(y0) - 0.07), N, 0, (y0 + y1) / 2, 0, IRON);
  }
  const core = (y: number): Point3[] => {
    const a = plinthAt(y) - 0.08;
    return [
      [-a, y, -a],
      [a, y, -a],
      [a, y, a],
      [-a, y, a],
    ];
  };
  convexSolid(b, core(P0), core(P1), IRON);
  b.box(10.7, 0.85, 10.7, 0, P0 - 0.425, 0, BASALT);
  b.box(10.0, 0.08, 10.0, 0, P1 + 0.04, 0, BASALT_PALE);
  b.box(10.2, 0.12, 10.2, 0, P1 + 0.14, 0, BASALT_PALE);
  return b;
}

/** The face of a `dressed` stone that is turned to the core: its local -Z. */
const TO_CORE = 1 << 5;

/**
 * A dressed stone in a round or battered face: its outer face centred `a` out
 * from the axis along bearing `yaw`, `u` along the face, at height `y`, and
 * leaning back by `lean` as the face it is laid in does. Local Z is the stone's
 * depth into the wall, so the underside and the back are left out — one is
 * bedded on the course below and the other on the core.
 */
function dressed(
  sb: StoneBatch,
  yaw: number,
  a: number,
  u: number,
  y: number,
  len: number,
  tall: number,
  deep: number,
  lean: number,
  color: string,
): void {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  const r = a - (deep / 2) * Math.cos(lean);
  sb.box(len, tall, deep, s * r + c * u, y - (deep / 2) * Math.sin(lean), c * r - s * u, color, { y: yaw, x: -lean }, HIDE_UNDER | TO_CORE);
}

/** A straight member from `a` to `c` into a batch: a rail, an astragal, a rib. */
function bar(sb: StoneBatch, a: Point3, c: Point3, wide: number, thick: number, color: string): void {
  const o = orient(a, c);
  sb.box(wide, thick, o.len, o.mid[0], o.mid[1], o.mid[2], color, o.rot);
}

/**
 * `[u0, u1]` cut into stones about `stone` long, every other course starting
 * on a half stone so the vertical joints break.
 */
function splitRun(u0: number, u1: number, stone: number, broken: boolean): [number, number][] {
  const n = Math.max(1, Math.round((u1 - u0) / stone));
  const len = (u1 - u0) / n;
  const at = [u0];
  for (let i = 1; i < n; i++) at.push(u0 + (i - (broken ? 0.5 : 0)) * len);
  if (broken && n > 1) at.push(u1 - len / 2);
  at.push(u1);
  const out: [number, number][] = [];
  for (let i = 1; i < at.length; i++) if (at[i] - at[i - 1] > 0.2) out.push([at[i - 1], at[i]]);
  return out;
}

/**
 * A keeper's sash window laid on a face: the lit pane, its bars, dark dressed
 * margins and a projecting sill. `plane` is the face's distance from the
 * origin along its axis and `u` the window's centre along the face.
 */
function sashWindow(b: Build, sb: StoneBatch, s: Side, plane: number, u: number): void {
  const sill = 1.0;
  const tall = 1.15;
  const wide = 0.85;
  const c = outward(s) * (plane + 0.01);
  if (runsAlongX(s)) b.glow(wide, tall, 0.02, u, sill + tall / 2, c, FLAME);
  else b.glow(0.02, tall, wide, c, sill + tall / 2, u, FLAME);
  sb.onFace(s, plane, u, sill + tall / 2, 0.045, tall, 0.03, 0.025, IRON);
  for (const f of [1 / 3, 2 / 3]) sb.onFace(s, plane, u, sill + tall * f, wide, 0.04, 0.03, 0.025, IRON);
  for (const e of [-1, 1] as const) sb.onFace(s, plane, u + e * (wide / 2 + 0.08), sill + tall / 2 + 0.08, 0.16, tall + 0.16, 0.05, 0.015, BASALT);
  sb.onFace(s, plane, u, sill + tall + 0.08, wide + 0.32, 0.16, 0.05, 0.015, BASALT);
  sb.onFace(s, plane, u, sill - 0.045, wide + 0.25, 0.09, 0.16, 0.06, BASALT);
}

// =============================================================================
// The working waterfront
// =============================================================================

/**
 * A QUAY CRANE: a stone winch house, a mast, and a raking timber jib with the
 * hook still on the chain.
 *
 * **A quay without one is a promenade.** Every cargo on this island arrived
 * over a gunwale and nothing in the kit could lift it: the depot said there
 * was a warehouse, the jetties said there were boats, and the twenty metres
 * between them said nothing at all. It is also the only tall thin silhouette
 * on the harbour front, which is what stops five hundred metres of shed roof
 * from reading as one shed.
 *
 * The jib and the stays are `Build.strut` — timber a round stops on, eleven
 * metres in the air, and no part of a body's problem. The winch house is an
 * ordinary collider and is the one piece of hard cover on an open quay.
 */
export function buildHarbourCrane(scene: Scene, mats: CelMaterialFactory): Structure {
  const b = new Build(scene, mats, "crane");
  const plinth = 0.45;

  b.box(8.4, plinth, 9.6, 0, plinth / 2, 0.8, BASALT);
  b.block({ w: 8.4, h: plinth, d: 9.6, x: 0, y: plinth / 2, z: 0.8 });

  // The winch house: tarred boards over a basalt lower course, its door on the
  // mast side so the drum and the jib read as one machine.
  const hw = 6.2;
  const hd = 5.0;
  const hh = 3.4;
  const hz = 2.6;
  b.wall(hw, 1.0, hd, 0, plinth + 0.5, hz, BASALT);
  b.doorWall(hw, hh - 1.0, 0.3, 0, plinth + 1.0 + (hh - 1.0) / 2, hz - hd / 2, PITCH, 1.6, 2.2);
  b.wall(hw, hh - 1.0, 0.3, 0, plinth + 1.0 + (hh - 1.0) / 2, hz + hd / 2, PITCH);
  for (const sx of [-1, 1] as const) {
    b.wall(0.3, hh - 1.0, hd, (sx * hw) / 2, plinth + 1.0 + (hh - 1.0) / 2, hz, PITCH);
  }
  b.gableRoof(hw, hd, 1.15, 0, plinth + hh, hz, SLATE, 0.4);
  b.cyl(2.6, 1.0, 1.0, 10, 0, plinth + 1.3, hz - 0.7, RUST, { z: Math.PI / 2 });

  // The mast, out on the water side of the house. A body walks into it, so it
  // is a wall and not a strut.
  const mastTop = 12.7;
  b.wall(0.8, mastTop - plinth, 0.8, 0, plinth + (mastTop - plinth) / 2, -3.0, TIMBER);
  b.cyl(0.6, 1.3, 1.3, 8, 0, mastTop - 0.3, -3.0, RUST);

  // The jib raking out over the water, and the counterweight balancing it back
  // over the house.
  const tipY = 9.2;
  const tipZ = -11.5;
  const jib = Math.hypot(tipZ + 3.0, tipY - mastTop);
  b.strut(0.7, 0.7, jib, 0, (mastTop + tipY) / 2, (-3.0 + tipZ) / 2, TIMBER, {
    x: -Math.atan2(mastTop - tipY, -3.0 - tipZ),
  });
  b.strut(1.9, 1.7, 1.9, 0, mastTop - 1.6, -0.9, BASALT);

  // Two back-stays, kept in the YZ plane and offset in X: a stay skewed in two
  // axes is three lines of trigonometry for a 0.3 m baulk nobody will measure.
  const stayLen = Math.hypot(7.2, mastTop - plinth);
  for (const sx of [-1, 1] as const) {
    b.strut(0.3, stayLen, 0.3, sx * 2.4, (mastTop + plinth) / 2, 0.6, TIMBER, {
      x: -Math.atan2(7.2, mastTop - plinth),
    });
  }

  // The chain and the hook block, hanging where they were left. Visual only —
  // a chain that stopped a round would be the one piece of cover on this map
  // you could see straight through.
  b.box(0.16, 6.4, 0.16, 0, (tipY + 2.8) / 2, tipZ, RUST);
  b.box(0.55, 0.75, 0.55, 0, 2.5, tipZ, RUST);
  return b;
}

/**
 * A DRYING RACK: A-frames carrying three poles, with the catch hung on them
 * and a net over one end. Runs along local X.
 *
 * **Netstrand's racks were a run of `woodpile`s** — the only thing in the kit
 * that was long, low and timber without also being a fence — and a woodpile is
 * a solid 1.9 m block, which is exactly the wrong shape. A rack is a thing you
 * see a body THROUGH at forty metres and cannot walk through at two.
 *
 * That is the `porous` + `strut` pair the fence exists for, used a second time
 * and for the reason `BoxSpec.porous` states: the coarse box owns the BODY,
 * the timber owns the ROUND. A round aimed between two poles goes through, one
 * aimed at a pole stops on it, and `CoverMap` never offers a rack as cover —
 * which is right, because it is not cover.
 */
export function buildFishRack(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "fishrack");
  const len = p.length ?? 9;
  const h = 2.6;
  /** Half the splay of an A-frame's feet. */
  const half = 0.85;
  const legLen = Math.hypot(half, h);
  const lean = Math.atan2(half, h);
  const frames = Math.max(2, Math.round(len / 3) + 1);

  for (let i = 0; i < frames; i++) {
    const x = -len / 2 + (i * len) / (frames - 1);
    for (const sz of [-1, 1] as const) {
      // Feet at ±half, heads meeting on the centreline: the top of a box
      // rotated about X by `a` moves to `+sin a` in Z, so the leg standing at
      // +Z takes a NEGATIVE angle to lean back over the middle.
      b.strut(0.17, legLen, 0.17, x, h / 2, (sz * half) / 2, TIMBER, {
        x: -sz * lean,
      });
    }
    b.strut(0.14, 0.14, half, x, 1.3, 0, TIMBER);
  }
  // The poles the catch hangs from, running the whole length.
  for (const y of [1.5, 2.0, 2.42]) {
    b.strut(len, 0.13, 0.13, 0, y, 0, TIMBER);
  }
  // The catch: split fish over the top two poles, alternating so that a rack
  // does not read as a comb.
  const hung = Math.max(2, Math.floor(len / 0.9));
  for (let i = 0; i < hung; i++) {
    const x = -len / 2 + 0.5 + (i * (len - 1)) / (hung - 1);
    const y = i % 2 === 0 ? 2.42 : 2.0;
    b.box(0.13, 0.52, 0.1, x, y - 0.3, 0, i % 3 === 0 ? SAILCLOTH : PITCH);
  }
  // One net over the end, and the one thing here the key light comes through.
  b.translucentBox(
    len * 0.38,
    1.5,
    0.06,
    -len * 0.22,
    1.72,
    0.24,
    SAILCLOTH,
    TRANSLUCENCY.awning,
    { z: 0.05 },
  );

  // The coarse box: the whole run, at the height a body walks into it.
  b.block({ w: len, h: 1.95, d: half * 2 + 0.3, x: 0, y: 0.975, z: 0, porous: true });
  return b;
}

/**
 * A CAREENED HULL: an open boat up on the hard, chocked on keel blocks with
 * four shores holding her upright and a tarpaulin over the after half.
 *
 * **There is no boat in this game and this is not waiting to be one.** It
 * answers a question every waterfront on this map raised and none of them
 * answered: eleven boat sheds, eight jetties, three slipways, and nothing
 * anywhere that had ever been in the water. A hull on the hard is what a
 * fishing town looks like between tides, and it is the piece that makes the
 * jetties read as jetties rather than as decking.
 *
 * It is also the only real hard cover on an open strand — 2.9 m, over
 * `CONFIG.bots.cover.hardHeight`, so it stops a round at a body standing up —
 * which is why the collider is one honest box from the ground to the sheer
 * rather than a shell you could shoot underneath. The shores are `strut`s, so
 * a round that hits one stops on it.
 */
export function buildCareenedHull(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "hull");
  const len = p.length ?? 11;

  // The cradle: two keel blocks and four raking shores.
  for (const sz of [-1, 1] as const) {
    b.wall(1.3, 0.7, 1.1, 0, 0.35, sz * len * 0.25, BASALT);
    for (const sx of [-1, 1] as const) {
      b.strut(0.26, 2.2, 0.26, sx * 2.15, 0.85, sz * len * 0.28, TIMBER, {
        z: sx * 0.688,
      });
    }
  }

  // The hull, four strakes deepening to the sheer. Boxes cannot taper, so what
  // makes this a boat rather than a crate is the raked stem and stern posts
  // and one pale boot-topping line across a tarred body.
  b.box(0.42, 0.5, len, 0, 0.95, 0, PITCH);
  b.box(1.9, 0.75, len * 0.93, 0, 1.4, 0, PITCH);
  b.box(2.7, 0.7, len * 0.97, 0, 2.0, 0, PITCH);
  b.box(3.16, 0.11, len * 0.995, 0, 2.29, 0, SAILCLOTH);
  b.box(3.1, 0.52, len, 0, 2.6, 0, PLANK);
  b.box(3.26, 0.16, len + 0.2, 0, 2.9, 0, TEAK);
  for (const sz of [-1, 1] as const) {
    b.box(0.38, 2.7, 0.38, 0, 1.95, sz * (len / 2 + 0.34), PITCH, { x: sz * 0.28 });
  }
  for (const dz of [-0.22, 0, 0.22]) {
    b.box(2.7, 0.1, 0.36, 0, 2.55, dz * len, PLANK);
  }
  b.box(0.27, 3.6, 0.27, 0, 4.3, -len * 0.12, TIMBER, { x: -0.05 });
  b.box(3.0, 0.13, len * 0.42, 0, 3.0, len * 0.2, SAILCLOTH, { x: 0.03 });

  b.block({ w: 3.3, h: 2.9, d: len, x: 0, y: 1.45, z: 0 });
  return b;
}

/**
 * What a net loft paints its doors and shutters: red oxide, or the brown of
 * the teak and plank the kit already has, so a street of them spends no new
 * colour on it.
 */
const NET_PAINTS = [RUST, TEAK, PLANK] as const;

/**
 * A NET LOFT: a sea loft of tarred weatherboard over an open undercroft on
 * coursed basalt piers, a loading door in the -Z gable under a hooded hoist
 * beam, and the nets hung to dry underneath.
 *
 * **The Netlofts quarter was built out of cottages** — a quarter named after a
 * building the map did not have. This is that building: gear is kept dry
 * upstairs and the boat's tackle is worked in the open underneath, which is
 * why the ground floor is six piers and no wall.
 *
 * That undercroft is why it is worth having on a shooter's map. It is a mass
 * you can see a body's legs through at forty metres and cannot shoot through
 * at chest height, standing in a row of houses that are solid to the ground —
 * so a street of them has sightlines a street of cottages does not, and the
 * piers are cover you fight AROUND rather than behind.
 *
 * **The loft is not reachable, and that is a decision rather than an
 * omission.** A flight to a 2.9 m floor is an 8.5 m run at `GRADE` — a stair
 * longer than the building, projecting into streets cut to five metres — and
 * what it would buy is one more upstairs room on a map that already has three
 * floors of shophouse on the Strand.
 *
 * ## What it is drawn as
 *
 * The black net shops of a shingle beach, built on a rock instead of a beach:
 *
 * - **The piers are laid, not poured** — five courses of basalt round a core
 *   set back for the joints, a long and a short stone round every corner
 *   swapping course by course, a pale dressed cap under the girder and a
 *   footing carried down to the ground, which on the ramp the quarter stands
 *   on is a different depth under each.
 * - **The floor is carpentry you can see from under it**: a girder across
 *   each pair of piers, joists along the bays between them, the boards over
 *   those, and a rim beam round the edge the boarding stands on. All of it is
 *   inside the deck's collider, so nothing hangs below where a round stops.
 * - **The walls are lapped boards tipped at their feet**, every course a
 *   shading band and a line for the ink, cut round each opening, with corner
 *   boards over the ends and a frieze closing the eaves.
 * - **The gables are boarded in the WALL's colour** and the roof is slate in
 *   lapped courses over sarking, laid in runs that do not quite agree, with
 *   rafter feet, a fascia, an iron gutter and a downpipe off each back corner
 *   that finds its way round the jetty to a pier and down it.
 * - **The loading door stands open**, both leaves flat back against the
 *   gable with their ledges and braces out; the hoist beam over it carries a
 *   board hood, a knee brace, a block and the fall with its hook clear of
 *   every head, and the hauling part runs back in through the door.
 * - **The windows are painted frames in the black**, each with a sill and a
 *   drip: a lit one has its shutters open flat beside it, a dark one has them
 *   shut or shows its glass. The back wall and its gable get a light and a
 *   louvred vent, because the back of a building you can walk round is seen.
 * - **The nets hang in folds** from poles hooked to the joists, corks along
 *   the head rope and the leads along the foot, and what was put down under
 *   them — a coil, a heap of net, a fish box, an anchor, oars against a pier
 *   — is all low enough to walk over.
 *
 * **What varies is seeded off where it stands** (`streetSeed`): the paint on
 * the doors and shutters, which dark windows are shuttered, the slate runs,
 * the jitter in the pier stones and what lies in the undercroft — and the
 * footings are cut to the ground, which is what puts `netLoft` in
 * `CONFORMS_TO_TERRAIN`. Without a `BuildCtx` it is drawn on level ground.
 *
 * The colliders are restated by hand at the top, byte for byte and in the
 * order they always were: six piers, the deck, `doorWall`'s jambs and lintel,
 * the back wall, the flanks, `gableRoof`'s slab and the hoist beam's strut.
 * Everything after them is drawing, and every drawn part is laid on a face,
 * low enough to walk over, overhead, or standing on a collider.
 */
export function buildNetLoft(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
  ctx?: BuildCtx,
): Structure {
  const b = new Build(scene, mats, "netloft");
  const w = p.width ?? 9;
  const d = p.depth ?? 7;
  /** Clear headroom under the loft floor. */
  const clear = 2.5;
  const loftH = p.height ?? 3.1;
  const deck = 0.4;
  const floorY = clear + deck;
  const t = 0.28;
  const overhang = 0.45;
  const rise = 1.5;
  /** The wall head, and the hoist beam half a metre over it. */
  const top = floorY + loftH;
  const beamY = floorY + loftH + 0.5;

  // --- the colliders, byte for byte and in the order they always were -----
  // Six piers — the corners and the middle of each long side. Nothing else at
  // ground level, which is the whole point of the building.
  for (const sx of [-1, 1] as const) {
    for (const dz of [-1, 0, 1]) {
      b.block({ w: 0.85, h: clear, d: 0.85, x: sx * (w / 2 - 0.6), y: clear / 2, z: dz * (d / 2 - 0.6) });
    }
  }
  b.block({ w, h: deck, d, x: 0, y: clear + deck / 2, z: 0 });
  // `doorWall`'s two jambs and its lintel, the back wall, the flanks, and
  // `gableRoof`'s flat slab at the eaves.
  const midY = floorY + loftH / 2;
  const frontZ = -(d - t) / 2;
  const jamb = (w - 1.7) / 2;
  const off = 1.7 / 2 + jamb / 2;
  const lintel = loftH - 2.2;
  b.block({ w: jamb, h: loftH, d: t, x: 0 - off, y: midY, z: frontZ });
  b.block({ w: jamb, h: loftH, d: t, x: 0 + off, y: midY, z: frontZ });
  b.block({ w: 1.7, h: lintel, d: t, x: 0, y: midY + loftH / 2 - lintel / 2, z: frontZ });
  b.block({ w, h: loftH, d: t, x: 0, y: midY, z: (d - t) / 2 });
  for (const sx of [-1, 1] as const) {
    b.block({ w: t, h: loftH, d: d - t * 2, x: (sx * (w - t)) / 2, y: midY, z: 0 });
  }
  b.block({ w: w + overhang * 2, h: 0.3, d: d + overhang * 2, x: 0, y: top, z: 0 });
  // The hoist beam out of the gable: timber a round stops on, six metres over
  // the street, and nothing a body meets.
  b.strut(0.28, 0.28, 2.6, 0, beamY, -(d / 2 + 1.1), TIMBER);

  // Everything below is drawing.
  const rnd = mulberry32(streetSeed(w, d, loftH, ctx));
  const ground = (lx: number, lz: number): number => {
    if (!ctx) return 0;
    const cos = Math.cos(ctx.rotY);
    const sin = Math.sin(ctx.rotY);
    return ctx.terrain.surfaceAt(ctx.x + lx * cos + lz * sin, ctx.z - lx * sin + lz * cos) - ctx.y;
  };
  const sb = new StoneBatch();
  /** The doors' and shutters' paint, and the frames', which are always pale. */
  const paint = NET_PAINTS[Math.floor(rnd() * NET_PAINTS.length)];
  const FRAME = SAILCLOTH;
  const pierX = w / 2 - 0.6;
  const pierZ = d / 2 - 0.6;

  // --- the piers ----------------------------------------------------------
  const PH = 0.425;
  const pierCourses = 5;
  const pc = clear / pierCourses;
  const SIDES: Side[] = ["-z", "+z", "-x", "+x"];
  /** One stone of a pier at (px, pz): its outer face `a` out on side `s`, `u` along it. */
  const pierStone = (px: number, pz: number, s: Side, u: number, y: number, len: number, tall: number, a: number, color: string, hide: number): void => {
    const r = outward(s) * (a - 0.12);
    if (runsAlongX(s)) sb.box(len, tall, 0.24, px + u, y, pz + r, color, undefined, hide);
    else sb.box(0.24, tall, len, px + r, y, pz + u, color, undefined, hide);
  };
  for (const sx of [-1, 1] as const) {
    for (const dz of [-1, 0, 1]) {
      const px = sx * pierX;
      const pz = dz * pierZ;
      for (let k = 0; k < pierCourses; k++) {
        const cap = k === pierCourses - 1;
        const y = (k + 0.5) * pc;
        for (const s of SIDES) {
          // The long stone of a course runs out to the corner and shows its
          // end on the next face; the next course swaps which face that is.
          const long = (k + (runsAlongX(s) ? 0 : 1)) % 2 === 0;
          const a = PH + (cap ? 0.04 : 0.014 + rnd() * 0.014);
          const end = long ? a : a - 0.265;
          const at = [-end];
          if (!cap && !long && rnd() < 0.6) at.push(-end + 0.2 + rnd() * (2 * end - 0.4));
          else if (!cap && long && rnd() < 0.35) at.push(-end + 0.3 + rnd() * (2 * end - 0.6));
          at.push(end);
          for (let i = 1; i < at.length; i++) {
            pierStone(px, pz, s, (at[i - 1] + at[i]) / 2, y, at[i] - at[i - 1] - 0.025, pc - 0.025, a, cap ? BASALT_PALE : BASALT, cap ? hideBack(s) : hideBack(s) | HIDE_UNDER);
          }
        }
      }
      // The footing, carried down to the lowest ground under it.
      const g = Math.min(ground(px - 0.55, pz - 0.55), ground(px + 0.55, pz - 0.55), ground(px - 0.55, pz + 0.55), ground(px + 0.55, pz + 0.55));
      const fBot = Math.min(g, 0) - 0.15;
      sb.box(1.1, 0.14 - fBot, 1.1, px, (0.14 + fBot) / 2, pz, BASALT, undefined, HIDE_UNDER);
    }
  }

  // --- the floor, seen from under it --------------------------------------
  // All of it inside the deck's collider (2.5 to 2.9 m): the rim the walls
  // stand on, a girder across each pair of piers, and joists along the bays.
  for (const sz of [-1, 1] as const) sb.box(w + 0.04, deck, 0.1, 0, clear + deck / 2, sz * (d / 2 - 0.03), TIMBER);
  for (const sx of [-1, 1] as const) sb.box(0.1, deck, d - 0.12, sx * (w / 2 - 0.03), clear + deck / 2, 0, TIMBER);
  for (const dz of [-1, 0, 1]) sb.box(w - 0.16, 0.34, 0.3, 0, clear + 0.17, dz * pierZ, TIMBER, undefined, 1 << 2);
  const joists = Math.max(4, Math.round((w - 0.3) / 0.55));
  for (let i = 0; i < joists; i++) {
    const x = -(w - 0.3) / 2 + ((i + 0.5) * (w - 0.3)) / joists;
    sb.box(0.1, 0.2, d - 0.16, x, clear + 0.24, 0, TIMBER, undefined, 1 << 2);
  }

  // --- the boarding -------------------------------------------------------
  /** A rectangle cut out of a face's boarding: [u0, u1, y0, y1]. */
  type Cut = [number, number, number, number];
  const TIP = 0.075;
  const courses = Math.max(8, Math.round(loftH / 0.24));
  const cH = loftH / courses;
  /** One lapped board, its foot tipped out from the face. */
  const board = (s: Side, plane: number, u: number, y: number, len: number, tall: number): void => {
    const c = outward(s) * (plane + 0.022);
    if (runsAlongX(s)) sb.box(len, tall, 0.025, u, y, c, PITCH, { x: outward(s) * -TIP }, hideBack(s));
    else sb.box(0.025, tall, len, c, y, u, PITCH, { z: outward(s) * TIP }, hideBack(s));
  };
  const course = (s: Side, plane: number, u0: number, u1: number, yb: number, yt: number, cuts: Cut[]): void => {
    const hit = cuts.filter((c) => c[2] < yt && c[3] > yb).map((c): [number, number] => [c[0], c[1]]);
    for (const [a, c] of carve(u0, u1, hit)) {
      if (c - a > 0.05) board(s, plane, (a + c) / 2, (yb + yt) / 2 - 0.015, c - a, yt - yb + 0.03);
    }
  };

  // --- the windows --------------------------------------------------------
  const winY = floorY + loftH * 0.55;
  const FW = 0.07;
  /** A painted frame on a face, its sill and drip, and what is in it. Returns the boarding's cut. */
  const windowAt = (s: Side, plane: number, u: number, gw: number, gh: number, lit: boolean): Cut => {
    const shut = !lit && rnd() < 0.55;
    if (lit) {
      const c = outward(s) * (plane + 0.012);
      if (runsAlongX(s)) b.glow(gw, gh, 0.02, u, winY, c, FLAME);
      else b.glow(0.02, gh, gw, c, winY, u, FLAME);
    } else if (!shut) {
      sb.onFace(s, plane, u, winY, gw, gh, 0.02, 0.012, IRON);
    }
    sb.onFace(s, plane, u, winY + gh / 2 + FW / 2, gw + 2 * FW, FW, 0.05, 0.045, FRAME);
    sb.onFace(s, plane, u, winY - gh / 2 - FW / 2, gw + 2 * FW, FW, 0.05, 0.045, FRAME);
    for (const e of [-1, 1] as const) sb.onFace(s, plane, u + e * (gw / 2 + FW / 2), winY, FW, gh, 0.05, 0.045, FRAME);
    sb.onFace(s, plane, u, winY - gh / 2 - FW - 0.03, gw + 2 * FW + 0.14, 0.06, 0.15, 0.075, FRAME);
    sb.onFace(s, plane, u, winY + gh / 2 + FW + 0.03, gw + 2 * FW + 0.08, 0.06, 0.1, 0.05, FRAME);
    const leaf = gw / 2 + FW;
    if (shut) {
      // Shut: three boards in the opening on two ledges.
      for (let i = 0; i < 3; i++) sb.onFace(s, plane, u - gw / 3 + (i * gw) / 3, winY, gw / 3 - 0.012, gh, 0.03, 0.03, paint);
      for (const f of [-0.3, 0.3]) sb.onFace(s, plane, u, winY + f * gh, gw - 0.04, 0.08, 0.025, 0.055, paint);
    } else {
      sb.onFace(s, plane, u, winY, 0.03, gh, 0.025, 0.03, FRAME);
      sb.onFace(s, plane, u, winY, gw, 0.03, 0.025, 0.03, FRAME);
      if (lit) {
        // Open: each leaf flat back against the boarding beside the frame.
        for (const e of [-1, 1] as const) {
          const lu = u + e * (gw / 2 + FW + 0.01 + leaf / 2);
          for (let i = 0; i < 3; i++) sb.onFace(s, plane, lu - leaf / 3 + (i * leaf) / 3, winY, leaf / 3 - 0.01, gh + 2 * FW, 0.03, 0.06, paint);
          for (const f of [-0.32, 0.32]) sb.onFace(s, plane, lu, winY + f * gh, leaf - 0.03, 0.08, 0.025, 0.085, paint);
        }
      }
    }
    return [u - gw / 2 - FW - 0.01, u + gw / 2 + FW + 0.01, winY - gh / 2 - FW - 0.06, winY + gh / 2 + FW + 0.06];
  };
  const lit = p.litWindows === true;
  const flankCuts = new Map<Side, Cut[]>();
  for (const s of ["-x", "+x"] as const) {
    flankCuts.set(s, [-0.22, 0.22].map((f) => windowAt(s, w / 2, f * d, 0.66, 0.85, lit)));
  }
  const backCut = windowAt("+z", d / 2, 0, 0.5, 0.6, lit);

  // --- the loading door ---------------------------------------------------
  const DOOR = 0.85;
  for (const e of [-1, 1] as const) sb.onFace("-z", d / 2, e * (DOOR + 0.05), floorY + 1.15, 0.1, 2.3, 0.06, 0.05, FRAME);
  sb.onFace("-z", d / 2, 0, floorY + 2.25, 2 * DOOR + 0.2, 0.1, 0.06, 0.05, FRAME);
  sb.box(2 * DOOR + 0.2, 0.08, 0.22, 0, floorY, -(d / 2 + 0.07), TIMBER);
  // Both leaves stand open, flat back against the gable, ledges outward.
  for (const e of [-1, 1] as const) {
    const lu = e * (DOOR + 0.12 + DOOR / 2);
    for (let i = 0; i < 5; i++) sb.onFace("-z", d / 2, lu - (2 * DOOR) / 5 + (i * DOOR) / 5, floorY + 1.1, DOOR / 5 - 0.012, 2.15, 0.03, 0.06, paint);
    for (const y of [0.3, 1.1, 1.9]) sb.onFace("-z", d / 2, lu, floorY + y, DOOR - 0.06, 0.11, 0.03, 0.09, paint);
    for (const y0 of [0.3, 1.1]) {
      const rise0 = 0.8 - 0.11;
      const run0 = DOOR - 0.22;
      sb.onFace("-z", d / 2, lu, floorY + y0 + 0.4, Math.hypot(rise0, run0), 0.1, 0.03, 0.09, paint, e * Math.atan2(rise0, run0));
    }
    for (const y of [0.3, 1.9]) sb.onFace("-z", d / 2, e * (DOOR + 0.12 + 0.28), floorY + y, 0.56, 0.05, 0.015, 0.11, IRON);
  }
  // What the hauling part is made fast to, and the lamp the loft is worked by.
  if (lit) {
    b.glow(0.14, 0.22, 0.14, 0.55, floorY + 1.85, -d / 2 + 0.9, FLAME);
    sb.box(0.2, 0.05, 0.2, 0.55, floorY + 1.985, -d / 2 + 0.9, IRON);
    sb.box(0.02, top - floorY - 2.0, 0.02, 0.55, (top + floorY + 2.0) / 2, -d / 2 + 0.9, IRON);
  }

  // --- the walls' boarding, now every cut is known ------------------------
  const doorCut: Cut = [-(DOOR + 0.12), DOOR + 0.12, floorY - 1, floorY + 2.32];
  const ventY = top + rise * 0.42;
  const run = w / 2 + overhang;
  const pitch = Math.atan2(rise, run);
  const roofAt = (x: number): number => top + (rise * (run - Math.abs(x))) / run;
  const faces: [Side, number, number, Cut[]][] = [
    ["-z", d / 2, w / 2, [doorCut]],
    ["+z", d / 2, w / 2, [backCut]],
    ["-x", w / 2, d / 2, flankCuts.get("-x") ?? []],
    ["+x", w / 2, d / 2, flankCuts.get("+x") ?? []],
  ];
  for (const [s, plane, half, cuts] of faces) {
    for (let k = 0; k < courses; k++) course(s, plane, -half, half, floorY + k * cH, floorY + (k + 1) * cH, cuts);
    for (const e of [-1, 1] as const) sb.onFace(s, plane, e * (half - 0.07), midY - 0.015, 0.14, loftH + 0.03, 0.04, 0.055, PITCH);
  }
  // The gables, boarded on up to the roof, round the beam and the vent.
  const gableCuts: Record<"-z" | "+z", Cut[]> = {
    "-z": [[-0.2, 0.2, beamY - 0.18, beamY + 0.18]],
    "+z": [[-0.36, 0.36, ventY - 0.29, ventY + 0.29]],
  };
  for (const s of ["-z", "+z"] as const) {
    for (let j = 0; ; j++) {
      const yb = top + j * cH;
      const yt = yb + cH;
      const half = Math.min(w / 2, run - (((yb + yt) / 2 - top) * run) / rise);
      if (half < 0.12) break;
      course(s, d / 2, -half, half, yb, yt, gableCuts[s]);
    }
  }
  // The vent: a pale frame and three louvres.
  for (const e of [-1, 1] as const) sb.onFace("+z", d / 2, e * 0.31, ventY, 0.07, 0.5, 0.05, 0.045, FRAME);
  for (const e of [-1, 1] as const) sb.onFace("+z", d / 2, 0, ventY + e * 0.25, 0.69, 0.07, 0.05, 0.045, FRAME);
  for (const f of [-0.13, 0, 0.13]) sb.box(0.56, 0.12, 0.02, 0, ventY + f, d / 2 + 0.035, PITCH, { x: -0.55 });
  // The frieze closing the eaves over each flank.
  for (const s of ["-x", "+x"] as const) sb.onFace(s, w / 2, 0, top + 0.035, d + 0.1, 0.15, 0.03, 0.03, PITCH);
  // Tie beams and king posts, seen through the door.
  for (const sz of [-1, 1] as const) {
    sb.box(w - 2 * t, 0.16, 0.16, 0, top + 0.08, (sz * d) / 4, TIMBER);
    sb.box(0.12, rise - 0.35, 0.12, 0, top + 0.16 + (rise - 0.35) / 2, (sz * d) / 4, TIMBER);
  }

  // --- the roof -----------------------------------------------------------
  const roofLen = d + overhang * 2;
  const slope = Math.hypot(run, rise);
  const nx = Math.sin(pitch);
  const ny = Math.cos(pitch);
  const slates = 9;
  for (const s of [-1, 1] as const) {
    for (let i = 0; i < slates; i++) {
      const f = (i + 0.5) / slates;
      // Each course laid in runs that do not quite agree with each other.
      const at = [-roofLen / 2];
      while (at[at.length - 1] < roofLen / 2 - 1.2) at.push(at[at.length - 1] + 1.2 + rnd() * 1.8);
      at[at.length - 1] = roofLen / 2;
      for (let r = 1; r < at.length; r++) {
        const lift = 0.055 + (rnd() - 0.5) * 0.018;
        const x = s * run * (1 - f) + s * nx * lift;
        const y = top + rise * f + ny * lift;
        sb.box(slope / slates + 0.1, 0.1, at[r] - at[r - 1] - 0.01, x, y, (at[r] + at[r - 1]) / 2, SLATE, { z: -s * (pitch - 0.06) });
      }
    }
    // Rafter feet under the eaves, a fascia on their ends and the gutter.
    const rafters = Math.round(d / 0.6) + 1;
    const xm = (w / 2 + run) / 2;
    for (let j = 0; j < rafters; j++) {
      const z = -d / 2 + 0.1 + (j * (d - 0.2)) / (rafters - 1);
      sb.box((run - w / 2) / Math.cos(pitch) + 0.05, 0.1, 0.06, s * xm, roofAt(xm) - 0.03 - 0.05 / ny, z, TIMBER, { z: -s * pitch });
    }
    sb.box(0.04, 0.18, roofLen, s * (run + 0.02), top - 0.04, 0, TIMBER);
    sb.box(0.13, 0.1, roofLen - 0.1, s * (run + 0.11), top - 0.1, 0, IRON);
    // The downpipe off the back corner, down the boarding, round under the
    // jetty onto the back pier and down that to a shoe.
    const zp = d / 2 - 0.1;
    const zq = d / 2 - 0.4;
    const xw = s * (w / 2 + 0.1);
    const xq = s * (w / 2 - 0.175 + 0.075);
    const gq = ground(xq, zq);
    bar(sb, [s * (run + 0.11), top - 0.12, zp], [xw, top - 0.45, zp], 0.08, 0.08, IRON);
    sb.box(0.08, top - 0.45 - (clear + 0.05), 0.08, xw, (top - 0.45 + clear + 0.05) / 2, zp, IRON);
    bar(sb, [xw, clear + 0.05, zp], [xq, clear - 0.3, zq], 0.08, 0.08, IRON);
    sb.box(0.08, clear - 0.3 - (gq + 0.12), 0.08, xq, (clear - 0.3 + gq + 0.12) / 2, zq, IRON);
    sb.box(0.2, 0.07, 0.09, xq + s * 0.07, gq + 0.12, zq, IRON);
  }
  // Bargeboards up each verge, a finial at each apex, and the purlins' ends
  // carrying the verge out past the gable.
  for (const sz of [-1, 1] as const) {
    const z = sz * (d / 2 + overhang - 0.03);
    for (const s of [-1, 1] as const) bar(sb, [s * (run + 0.03), top - 0.01, z], [0, top + rise, z], 0.05, 0.24, TIMBER);
    sb.box(0.1, 0.55, 0.1, 0, top + rise + 0.2, z, TIMBER);
    for (const x of [-run * 0.5, 0, run * 0.5]) {
      sb.box(0.12, 0.18, overhang, x, roofAt(x) - 0.12, sz * (d / 2 + overhang / 2 - 0.03), TIMBER);
    }
  }

  // --- the hoist ----------------------------------------------------------
  const zs = -(d / 2 + 2.1);
  const sy = beamY - 0.5;
  sb.box(0.32, 0.32, 0.05, 0, beamY, -(d / 2 + 2.25), IRON);
  sb.box(0.06, 0.22, 0.06, 0, beamY - 0.24, zs, IRON);
  for (const e of [-1, 1] as const) sb.box(0.04, 0.54, 0.46, e * 0.08, sy, zs, TIMBER);
  b.cyl(0.1, 0.4, 0.4, 10, 0, sy, zs, RUST, { z: Math.PI / 2 });
  sb.box(0.22, 0.06, 0.06, 0, sy, zs, IRON);
  // The load fall to a hook block hung clear of every head, and the hauling
  // part back in through the door.
  const hookY = 2.69;
  sb.box(0.05, sy - (hookY + 0.13), 0.05, 0, (sy + hookY + 0.13) / 2, zs - 0.2, PLANK);
  sb.box(0.16, 0.26, 0.14, 0, hookY, zs - 0.2, TIMBER);
  sb.box(0.04, 0.14, 0.04, 0, hookY - 0.2, zs - 0.2, IRON);
  sb.box(0.04, 0.04, 0.16, 0, hookY - 0.25, zs - 0.14, IRON);
  sb.box(0.04, 0.09, 0.04, 0, hookY - 0.21, zs - 0.08, IRON);
  bar(sb, [0.08, sy + 0.2, zs + 0.15], [0.08, floorY + 1.9, -d / 2 + 0.25], 0.05, 0.05, PLANK);
  // The knee brace under the beam, and the board hood over it.
  bar(sb, [0, Math.max(top - 0.45, floorY + 2.45), -(d / 2 + 0.05)], [0, beamY - 0.14, -(d / 2 + 1.0)], 0.16, 0.16, TIMBER);
  const hood = 2.55;
  const hp = Math.atan2(0.28, 0.45);
  for (const s of [-1, 1] as const) {
    sb.box(Math.hypot(0.45, 0.28) + 0.04, 0.04, hood, s * 0.225 + s * Math.sin(hp) * 0.02, beamY + 0.3 + Math.cos(hp) * 0.02, -(d / 2 + hood / 2), PITCH, { z: -s * hp });
  }
  for (const z of [-(d / 2 + 1.2), -(d / 2 + hood - 0.1)]) sb.box(0.9, 0.05, 0.07, 0, beamY + 0.165, z, TIMBER);
  const hoodEnd = (z: number): Point3[] => [
    [-0.44, beamY + 0.15, z],
    [0.44, beamY + 0.15, z],
    [0, beamY + 0.43, z],
  ];

  // --- the nets -----------------------------------------------------------
  // Hung in folds from a pole hooked to the joists — the one place the key
  // light comes through a building on this map — corks along the head rope
  // and the leads along the foot.
  for (const sz of [-1, 1] as const) {
    const nw = w * 0.5;
    const cx = sz * w * 0.15;
    const z = sz * (d / 2 - 0.95);
    sb.box(nw + 0.4, 0.07, 0.07, cx, 2.45, z, TIMBER);
    for (const e of [-1, 1] as const) sb.box(0.02, 0.2, 0.02, cx + e * nw * 0.4, 2.56, z, IRON);
    // Separate drops of different widths and lengths, each folded once in
    // plan, so a pole of them reads as nets put up to dry and not a curtain.
    let x0 = cx - nw / 2 + rnd() * 0.15;
    while (x0 < cx + nw / 2 - 0.45) {
      const dw = Math.min(0.5 + rnd() * 0.45, cx + nw / 2 - x0);
      const tall = 1.15 + rnd() * 0.45;
      const fold = (rnd() < 0.5 ? 1 : -1) * (0.25 + rnd() * 0.15);
      const pw = dw / 2;
      const len = pw / Math.cos(fold);
      for (const e of [-1, 1] as const) {
        const x = x0 + pw / 2 + (e > 0 ? pw : 0);
        const yaw = e * fold;
        b.translucentBox(len, tall, 0.04, x, 2.31 - tall / 2, z, SAILCLOTH, TRANSLUCENCY.awning, { y: yaw });
        sb.box(len, 0.03, 0.03, x, 2.31, z, PLANK, { y: yaw });
        sb.box(len, 0.035, 0.035, x, 2.31 - tall, z, IRON, { y: yaw });
        sb.box(0.09, 0.07, 0.09, x, 2.31, z, TEAK, { y: yaw });
      }
      x0 += dw + 0.15 + rnd() * 0.25;
    }
  }

  // --- what was put down under it -----------------------------------------
  // All of it under 0.3 m, between the piers on each side.
  const slots: [number, number][] = [];
  for (const sx of [-1, 1] as const) for (const f of [-0.5, 0.5]) slots.push([sx * (pierX - 0.75), f * pierZ]);
  for (const [lx, lz] of slots) {
    const kind = Math.floor(rnd() * 6);
    const gy = ground(lx, lz);
    const yaw = rnd() * Math.PI;
    if (kind === 0) {
      b.cyl(0.14, 0.62, 0.68, 10, lx, gy + 0.07, lz, PLANK);
      b.cyl(0.16, 0.22, 0.22, 8, lx, gy + 0.08, lz, PITCH);
    } else if (kind === 1) {
      b.cyl(0.22, 0.9, 1.3, 7, lx, gy + 0.11, lz, TEAK);
      b.cyl(0.14, 0.45, 0.8, 7, lx + 0.25, gy + 0.27, lz - 0.1, TEAK);
      for (let c = 0; c < 3; c++) sb.box(0.09, 0.07, 0.09, lx - 0.3 + c * 0.22, gy + 0.24, lz + 0.35 - c * 0.15, TEAK, { y: yaw + c });
    } else if (kind === 2) {
      // A fish box: four sides on a bottom, so it is open.
      const fb = (u: number, v: number, bw: number, bh: number, bd: number, y: number): void => {
        sb.box(bw, bh, bd, lx + u * Math.cos(yaw) + v * Math.sin(yaw), gy + y, lz - u * Math.sin(yaw) + v * Math.cos(yaw), TIMBER, { y: yaw });
      };
      fb(0, 0, 0.9, 0.03, 0.55, 0.035);
      for (const e of [-1, 1] as const) fb(0, e * 0.26, 0.9, 0.24, 0.03, 0.14);
      for (const e of [-1, 1] as const) fb(e * 0.435, 0, 0.03, 0.24, 0.49, 0.14);
    } else if (kind === 3) {
      // An anchor lying flat: the shank, the stock across one end, the arms.
      const ax = (u: number): [number, number] => [lx + u * Math.sin(yaw), lz + u * Math.cos(yaw)];
      const [mx, mz] = ax(0);
      sb.box(0.07, 0.06, 1.1, mx, gy + 0.04, mz, IRON, { y: yaw });
      const [stx, stz] = ax(0.48);
      sb.box(0.9, 0.06, 0.06, stx, gy + 0.04, stz, IRON, { y: yaw });
      const [arx, arz] = ax(-0.5);
      for (const e of [-1, 1] as const) sb.box(0.06, 0.06, 0.55, arx, gy + 0.04, arz, IRON, { y: yaw + e * 0.9 });
    } else if (kind === 4) {
      for (let c = 0; c < 6; c++) sb.box(0.11, 0.08, 0.11, lx + (rnd() - 0.5) * 0.6, gy + 0.05, lz + (rnd() - 0.5) * 0.6, TEAK, { y: rnd() * 3 });
    }
    // kind 5: nothing — not every bay is full.
  }
  // A coil hung on the outer face of one front pier.
  if (rnd() < 0.6) {
    const px = (rnd() < 0.5 ? -1 : 1) * pierX;
    const pz = -(pierZ + PH + 0.07);
    b.cyl(0.08, 0.5, 0.5, 10, px, 1.6, pz, PLANK, { x: Math.PI / 2 });
    b.cyl(0.09, 0.18, 0.18, 8, px, 1.6, pz - 0.005, PITCH, { x: Math.PI / 2 });
  }
  // Oars stood blade up against the inner face of a middle pier.
  if (rnd() < 0.5) {
    const sx = rnd() < 0.5 ? -1 : 1;
    const ox = sx * (pierX - PH - 0.06);
    const gy = ground(ox, 0);
    for (const e of [-1, 1] as const) {
      const lean = e * 0.1;
      sb.box(0.06, 2.3, 0.06, ox, gy + 1.15, e * 0.18 + Math.sin(lean) * 1.15, PLANK, { x: lean });
      sb.box(0.03, 0.62, 0.15, ox, gy + 2.0, e * 0.18 + Math.sin(lean) * 2.0, PLANK, { x: lean });
    }
  }

  // The batch before what it hides, then the cores it hides.
  sb.flush(b);
  for (const sx of [-1, 1] as const) {
    for (const dz of [-1, 0, 1]) b.box(0.79, clear, 0.79, sx * pierX, clear / 2, dz * pierZ, PITCH);
  }
  b.box(w - 0.16, 0.06, d - 0.16, 0, floorY - 0.03, 0, PLANK);
  b.box(jamb, loftH, t, 0 - off, midY, frontZ, PITCH);
  b.box(jamb, loftH, t, 0 + off, midY, frontZ, PITCH);
  b.box(1.7, lintel, t, 0, midY + loftH / 2 - lintel / 2, frontZ, PITCH);
  b.box(w, loftH, t, 0, midY, (d - t) / 2, PITCH);
  for (const sx of [-1, 1] as const) b.box(t, loftH, d - t * 2, (sx * (w - t)) / 2, midY, 0, PITCH);
  for (const [z0, z1] of [
    [-d / 2, -d / 2 + t],
    [d / 2 - t, d / 2],
  ]) {
    const gable = (z: number): Point3[] => [
      [-w / 2, top, z],
      [w / 2, top, z],
      [w / 2, roofAt(w / 2), z],
      [0, top + rise, z],
      [-w / 2, roofAt(w / 2), z],
    ];
    convexSolid(b, gable(z0), gable(z1), PITCH);
  }
  convexSolid(b, hoodEnd(-(d / 2 + hood)), hoodEnd(-(d / 2 + hood) + 0.03), PITCH);
  for (const s of [-1, 1] as const) {
    b.box(slope + 0.02, 0.03, roofLen, (s * run) / 2 - s * nx * 0.015, top + rise / 2 - ny * 0.015, 0, PLANK, { z: -s * pitch });
  }
  const ridge = (z: number): Point3[] => [
    [-0.24, top + rise - 0.02, z],
    [0.24, top + rise - 0.02, z],
    [0, top + rise + 0.2, z],
  ];
  convexSolid(b, ridge(-roofLen / 2 - 0.04), ridge(roofLen / 2 + 0.04), BASALT);
  return b;
}

/**
 * A SALT PAN: a shallow walled evaporation pan with the crust round its lip
 * and a heap of what came out of it.
 *
 * **There is nothing to farm on a lava island and no river on it**, so what
 * the flat ground behind a strand is for is taking salt out of the sea. That
 * is the third industry this map needed and the one that explains a settlement
 * standing on ground which grows nothing.
 *
 * **The coping is DRAWN and not collided, and that is the design rather than a
 * shortcut.** It is 0.45 m: a collider there would be a surface `NavGrid` has
 * to stand a body on and a wall every `moveWithCollisions` candidate is tested
 * against, for a kerb a player steps over without noticing. What leaving it
 * out buys is that a field of pans is as free as a field of road slabs —
 * twenty of them cost the ray budget nothing at all — and a pan is read from
 * the AIR, which on the one map in the tree with a helicopter on it is where
 * most people will see it from.
 *
 * The heap is the exception and is a real obstacle: it is 1.1 m of salt, and a
 * round ought to stop in it.
 */
export function buildSaltPan(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "saltpan");
  const w = p.width ?? 22;
  const d = p.depth ?? 14;
  const kerb = 0.45;
  const t = 0.55;

  // The brine: dark packed floor, a hand under the coping.
  b.box(w - t * 2, 0.12, d - t * 2, 0, 0.06, 0, SLAG);
  // The crust that gathers round the inside of the lip.
  for (const sz of [-1, 1] as const) {
    b.box(w - t * 2, 0.06, 0.5, 0, 0.14, sz * (d / 2 - t - 0.25), SAILCLOTH);
  }
  for (const sx of [-1, 1] as const) {
    b.box(0.5, 0.06, d - t * 2 - 1.0, sx * (w / 2 - t - 0.25), 0.14, 0, SAILCLOTH);
  }
  // The coping. Visual only — see the header.
  for (const sz of [-1, 1] as const) {
    b.box(w, kerb, t, 0, kerb / 2, (sz * (d - t)) / 2, BASALT_PALE);
  }
  for (const sx of [-1, 1] as const) {
    b.box(t, kerb, d - t * 2, (sx * (w - t)) / 2, kerb / 2, 0, BASALT_PALE);
  }
  // The sluice in the seaward lip: two posts and the paddle between them.
  for (const sx of [-1, 1] as const) {
    b.box(0.2, 1.4, 0.2, sx * 0.75, 0.7, -(d - t) / 2, TIMBER);
  }
  b.box(1.5, 0.9, 0.14, 0, 0.75, -(d - t) / 2 - 0.16, PLANK);

  // The heap, and the board they rake it up with: the one thing here a round
  // stops in.
  const hx = w / 2 - 3.4;
  const hz = d / 2 - 2.8;
  b.cyl(1.1, 0.5, 3.4, 8, hx, kerb + 0.55, hz, SAILCLOTH);
  b.block({ w: 3.0, h: 1.1, d: 3.0, x: hx, y: kerb + 0.55, z: hz });
  b.box(0.12, 1.7, 0.7, hx - 2.2, 0.85, hz - 0.6, TIMBER, { z: -0.22 });
  return b;
}
