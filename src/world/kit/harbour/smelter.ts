/**
 * kit/harbour/smelter.ts — buildSmelter: the Cinderworks, the island's
 * landmark — an ore hall you fight inside, the furnace block that is its one
 * light, the stack that is its silhouette and the charging deck that is the
 * one climbable height in the set — and `GRADE`, the grade its flight is
 * built to. Part of the volcanic-coast set: follows the contract in
 * kit/core.ts and the set's rules in `./index.ts`. Invariants: fixed
 * geometry, so nothing is seeded. Never imports another builder.
 */
import { Scene } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../../shaders/CelShader";
import {
  Build,
  type Structure,
  BASALT,
  BASALT_PALE,
  EMBER,
  IRON,
  PLANK,
  RUST,
  SLAG,
  SLATE,
  SULPHUR,
  TIMBER,
} from "../core";

/**
 * The grade every flight in this set is built to, against
 * `MAX_WALKABLE_GRADE`'s 0.4. kit/desert/shared.ts's `GRADE` owns the argument; it is
 * restated rather than imported, because importing it would make the desert
 * town's stair geometry a dependency of the island's and the two are only
 * incidentally the same number.
 */
const GRADE = 0.34;

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
  // four boxes, the cheapest thing in this set and most of what makes six
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
