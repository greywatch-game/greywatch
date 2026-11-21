/**
 * props/sharedDraws.ts — What each scatter builder takes from the REGION's
 * shared stream, replayed without building it (`BABYLON_EXIT.md` X3.4a).
 * Owns: `SHARED_DRAWS`, one replay per scatter kind.
 * Invariants: a kind's replay takes from the stream EXACTLY the numbers its
 * builder takes, at every seed and every foliage rung — the same count,
 * decided by the same values — and nothing else; it is stated a second time
 * beside the builder, so `npm run kit:hash` builds every kind over its seeds
 * and rungs and fails if the two counts ever differ.
 * Never: draws from `sub` (the prop's own stream reaches only its own
 * drawing, which no longer exists per placement); builds a part; reads the
 * values it spends for anything but how many more it must spend.
 *
 * WHY A REPLAY. Since X3.4a a placement no longer BUILDS its prop: it wears
 * one of its kind's variants (`world/scatterVariants.ts`). But the stream it
 * would have built from is the build's ONE scatter stream, and the yaw and the
 * next prop's spot come off it straight after — so a placement that drew a
 * number fewer would move every prop after it on the map, and re-roll the
 * collision bake with them. The replay is what keeps the field where it was.
 * Maple's was the first (`mapleSharedDraws`, for a crown whose slab
 * predecessor took a varying count); this is that promise for every kind.
 *
 * A kind whose builder takes a FIXED count states it once, as a constant
 * beside the builder (`PINE_SHARED_DRAWS`), and is replayed off it. A kind
 * whose count depends on what it drew (a bramble's cane count) replays the
 * draws that decide the count and spends the rest, in the builder's order.
 */
import type { ScatterSpec } from "../layout";
import { ASH_SHARED_DRAWS } from "./ash";
import { BOULDER_SHARED_DRAWS } from "./boulder";
import { mapleSharedDraws } from "./maple";
import { PINE_SHARED_DRAWS } from "./pine";

type Replay = (rng: () => number) => void;

/** Spends `n` numbers. */
function spend(rng: () => number, n: number): void {
  for (let i = 0; i < n; i++) rng();
}

/** A builder that takes a fixed `n`. */
const fixed =
  (n: number): Replay =>
  (rng) =>
    spend(rng, n);

/**
 * `buildJungleTree`: the lean, the fins' turn, three fins' rise, the crown's
 * turn, and the 42 its slab crown took and the frond crown throws away.
 */
const JUNGLE_SHARED_DRAWS = 1 + 1 + 3 + 1 + 42;

export const SHARED_DRAWS: Record<ScatterSpec["prop"], Replay> = {
  // The lean, then the pole's branch count and five a branch.
  deadTree: (rng) => {
    rng();
    spend(rng, (4 + Math.floor(rng() * 3)) * 5);
  },
  pine: fixed(PINE_SHARED_DRAWS),
  ashTree: fixed(ASH_SHARED_DRAWS),
  jungleTree: fixed(JUNGLE_SHARED_DRAWS),
  // The plank count, then one and four a plank.
  fernClump: (rng) => spend(rng, 1 + (7 + Math.floor(rng() * 4)) * 4),
  // The trunk's roll.
  buttressLog: fixed(1),
  // The slab's two leans.
  carvedStele: fixed(2),
  gravestone: fixed(2),
  // Four stalks: angle, reach, height, the cap's diameter.
  fungus: fixed(16),
  log: fixed(1),
  // The cane count, then four a cane: angle, height and two leans.
  bramble: (rng) => spend(rng, (6 + Math.floor(rng() * 4)) * 4),
  // The heap's turn, then three chunks: two offsets and three angles.
  rubble: fixed(1 + 3 * 5),
  // Its variation is all `sub`.
  fireDrum: fixed(0),
  boulder: fixed(BOULDER_SHARED_DRAWS),
  // Its variation is all `sub`.
  barrel: fixed(0),
  // The body's turn.
  skip: fixed(1),
  // The pair's turn, the mate's offset and its turn.
  binPair: fixed(3),
  // The stack's turn, the pallet count, then three a pallet.
  palletStack: (rng) => {
    rng();
    spend(rng, (4 + Math.floor(rng() * 2)) * 3);
  },
  // The cone's turn and whether it is knocked over.
  trafficCone: fixed(2),
  // The pile's turn, the scrap count, seven a scrap (two sizes, three
  // offsets, a turn, a colour), then the can's two offsets and its turn.
  litter: (rng) => {
    rng();
    spend(rng, (2 + Math.floor(rng() * 3)) * 7 + 3);
  },
  // Height, two leans, six rings' turns, the frond count, three a frond
  // (bearing, length, droop), and the two bunches' bearings.
  palm: (rng) => {
    spend(rng, 1 + 2 + 6);
    spend(rng, (9 + Math.floor(rng() * 4)) * 3 + 2);
  },
  maple: (rng) => {
    mapleSharedDraws(rng);
  },
  // The root chip's five (two sizes, a colour, two angles), the chip count,
  // then eight a chip after it (its five and three for where it lies).
  leafLitter: (rng) => {
    spend(rng, 5);
    spend(rng, (24 + Math.floor(rng() * 14) - 1) * 8);
  },
  // The culm count, then sixteen a culm (height, bearing, diameter, colour
  // and three tufts' four) and the bearing off the root culm for every culm
  // after the first.
  bamboo: (rng) => {
    const culms = 8 + Math.floor(rng() * 4);
    spend(rng, culms * 16 + (culms - 1));
  },
};
