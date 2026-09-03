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
  type BuildParams,
  type Structure,
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
  // drum rather than off its circumdiameter — kit/structures.ts's rule, and a
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
 * A LIGHTHOUSE: a battered basalt tower, a corbelled gallery, a glazed lantern
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
 * be both.
 *
 * The lantern carries a `LocalLight`, which is a real spend out of sixteen —
 * so a map lights the ones standing where somebody has to walk and lets the
 * rest be lights you can see rather than lights that light you.
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

  // The battered base: splayed, because that is what a tower taking a sea on
  // it is built like, and it is half the silhouette read from below.
  b.cyl(baseH, 9.6, 11.4, 12, 0, baseH / 2, 0, BASALT);
  b.block({ w: 9.8, h: baseH, d: 9.8, x: 0, y: baseH / 2, z: 0 });

  // Three drums with two salt-bleached bands between them — the smelter's
  // iron-collar argument, in stone.
  const dia = [8.6, 7.6, 6.6, 5.8];
  const seg = shaft / 3;
  for (let i = 0; i < 3; i++) {
    const y = baseH + i * seg;
    b.cyl(seg, dia[i + 1], dia[i], 12, 0, y + seg / 2, 0, BASALT);
    if (i < 2) b.cyl(0.5, dia[i + 1] + 0.35, dia[i + 1] + 0.35, 12, 0, y + seg, 0, BASALT_PALE);
  }
  b.block({ w: 6.9, h: shaft, d: 6.9, x: 0, y: baseH + shaft / 2, z: 0 });

  // The gallery: a corbel course, a deck ring and an iron rail. Drawn, and
  // walked by nothing — see the header.
  b.cyl(0.7, 8.6, 6.0, 12, 0, galleryY + 0.35, 0, BASALT_PALE);
  b.cyl(0.24, 8.4, 8.4, 12, 0, galleryY + 1.9, 0, IRON);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    b.box(0.14, 1.5, 0.14, Math.cos(a) * 3.9, galleryY + 1.2, Math.sin(a) * 3.9, IRON);
  }
  b.block({ w: 8.6, h: 2.2, d: 8.6, x: 0, y: galleryY + 1.1, z: 0 });

  // The lantern: eight astragals round an emissive drum. The colour is a warm
  // WHITE rather than the `FLAME` a fire gets — this is the one thing on the
  // island meant to be picked out from the far shore of the bay, and a lamp
  // that reads as a bonfire reads as somewhere to go rather than a warning.
  const lampY = galleryY + 2.5;
  b.glow(3.2, 2.4, 3.2, 0, lampY + 1.2, 0, "#ffe6b0");
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    b.box(0.16, 2.6, 0.16, Math.cos(a) * 1.9, lampY + 1.2, Math.sin(a) * 1.9, IRON);
  }
  b.cyl(0.35, 4.4, 4.4, 8, 0, lampY + 2.6, 0, IRON);
  b.cyl(1.7, 0.5, 4.4, 8, 0, lampY + 3.6, 0, IRON);
  b.cyl(0.9, 0.12, 0.34, 6, 0, lampY + 4.9, 0, IRON);
  b.block({ w: 4.2, h: 3.0, d: 4.2, x: 0, y: lampY + 1.4, z: 0 });
  b.light("#ffe2a8", 44, 2.0, 0.03, 0, lampY + 1.2, 0);

  // The keeper's cottage against the tower's -Z face: what turns a light into
  // somewhere somebody lives, on a headland otherwise made of rock.
  const cw = 7.4;
  const cd = 5.4;
  const ch = 3.2;
  const cz = -(5.4 + cd / 2);
  b.doorWall(cw, ch, 0.35, 0, ch / 2, cz - cd / 2, BASALT_PALE, 1.5, 2.2);
  b.wall(cw, ch, 0.35, 0, ch / 2, cz + cd / 2, BASALT_PALE);
  for (const sx of [-1, 1] as const) {
    b.wall(0.35, ch, cd, (sx * cw) / 2, ch / 2, cz, BASALT_PALE);
    b.glow(0.1, 0.8, 1.1, (sx * cw) / 2 - sx * 0.12, 1.9, cz, FLAME);
  }
  b.gableRoof(cw, cd, 1.3, 0, ch, cz, SLATE, 0.4);
  b.box(0.7, 1.8, 0.7, cw / 2 - 1.2, ch + 1.6, cz, BASALT_PALE);
  return b;
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
 * A NET LOFT: an open undercroft on stone piers with a boarded loft over it, a
 * hoist beam out of the gable and the nets hung underneath.
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
 */
export function buildNetLoft(
  scene: Scene,
  mats: CelMaterialFactory,
  p: BuildParams = {},
): Structure {
  const b = new Build(scene, mats, "netloft");
  const w = p.width ?? 9;
  const d = p.depth ?? 7;
  /** Clear headroom under the loft floor. */
  const clear = 2.5;
  const loftH = p.height ?? 3.1;
  const slab = 0.4;
  const floorY = clear + slab;

  // Six piers — the corners and the middle of each long side. Nothing else at
  // ground level, which is the whole point of the building.
  for (const sx of [-1, 1] as const) {
    for (const dz of [-1, 0, 1]) {
      b.wall(0.85, clear, 0.85, sx * (w / 2 - 0.6), clear / 2, dz * (d / 2 - 0.6), BASALT);
    }
  }
  b.box(w, slab, d, 0, clear + slab / 2, 0, PLANK);
  b.block({ w, h: slab, d, x: 0, y: clear + slab / 2, z: 0 });

  // The loft: tarred boarding, a loading door in the -Z gable at the head of
  // the hoist, and shuttered lights on the flanks.
  const t = 0.28;
  b.doorWall(w, loftH, t, 0, floorY + loftH / 2, -(d - t) / 2, PITCH, 1.7, 2.2);
  b.wall(w, loftH, t, 0, floorY + loftH / 2, (d - t) / 2, PITCH);
  for (const sx of [-1, 1] as const) {
    b.wall(t, loftH, d - t * 2, (sx * (w - t)) / 2, floorY + loftH / 2, 0, PITCH);
    for (const dz of [-0.22, 0.22]) {
      b.box(0.1, 1.0, 0.8, (sx * w) / 2 - sx * 0.08, floorY + loftH * 0.55, dz * d, PLANK);
      if (p.litWindows) {
        b.glow(0.06, 0.85, 0.66, (sx * w) / 2 + sx * 0.02, floorY + loftH * 0.55, dz * d, FLAME);
      }
    }
  }
  b.gableRoof(w, d, 1.5, 0, floorY + loftH, 0, SLATE, 0.45);

  // The hoist: a beam out of the gable, a sheave, and the fall still rove.
  const beamY = floorY + loftH + 0.5;
  b.strut(0.28, 0.28, 2.6, 0, beamY, -(d / 2 + 1.1), TIMBER);
  b.cyl(0.14, 0.55, 0.55, 8, 0, beamY - 0.4, -(d / 2 + 2.1), RUST, { z: Math.PI / 2 });
  b.box(0.08, beamY - 2.0, 0.08, 0, (beamY - 0.4 + 1.6) / 2, -(d / 2 + 2.1), TIMBER);

  // The nets hung under the loft between the piers — the one place the key
  // light comes through a building on this map.
  for (const sz of [-1, 1] as const) {
    b.translucentBox(
      w * 0.5,
      1.5,
      0.06,
      sz * w * 0.15,
      1.55,
      sz * (d / 2 - 0.95),
      SAILCLOTH,
      TRANSLUCENCY.awning,
    );
  }
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
