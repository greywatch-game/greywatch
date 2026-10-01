/**
 * kit/structures/index.ts — Small standalone structures and cover: silo, well,
 * stall, fence, stone wall, bridge, trestle bridge, temple ruin, haystack,
 * lamp post, cart, crates, woodpile, shed, trough, shrine, kiln. All follow
 * the contract in kit/core.ts (origin-local geometry, no
 * solid/pickable/collisions metadata).
 *
 * This file is the set's contract and its barrel: `BuildingKit.ts` imports
 * the seventeen builders from here. The ones big enough to argue for
 * themselves are a file each; the eight that are a few dozen lines apiece
 * share `small.ts`. Two files are words rather than builders:
 * `cartParts.ts` (the cart's wheel, sack, fork and cask, and `reframe`,
 * which the stall places its wares with) and `templeStone.ts` (the temple
 * ruin's stone and how it is laid, weathered and carved).
 *
 * Cover vocabulary, so a layout can pick the right height deliberately. A
 * prop's COLLIDER height is the whole of it, and `CONFIG.bots.cover` draws
 * three lines through the range: 0.9 (`softHeight` — a steering hint and
 * nothing more), 1.3 (`crouchHeight` — stops a round at a body that gets DOWN
 * behind it, and only within `crouchProbe` of it), and 1.7 (`hardHeight` —
 * stops one at a body standing up). Trough (1.0) and the fence's run (1.4, and
 * `porous`, so in no mask at all) are *low*: a step over with the eyes, not
 * the body. Cart (1.7), woodpile (1.9), haystack (2.2) and crates (2.3) are
 * all at or over the hard line — cover you stand and shoot from, not cover you
 * duck behind. Stone wall, shed, silo and kiln break sightlines outright. The
 * fence is the one thing here that is cover from nothing but its own timber —
 * its coarse box is `porous` and its posts and rails are `strut`s, so it turns
 * a route without turning a sightline, and stops only what actually hits wood.
 *
 * **A ROUND prop's collider is its body at the height rounds arrive at, not a
 * square drawn round its widest circle.** `b.cyl`'s diameter is a
 * CIRCUMdiameter — the polygon's vertices touch it and its silhouette does not
 * — so a box taking that number is already wider than what you can see, and a
 * box taking it at the widest course and then holding it to the top is wider
 * again everywhere the prop tapers. That is what the haystack and the kiln both
 * did, and it measured as rounds stopping on open air a metre off the drawn
 * surface. Size these off the silhouette across the middle of the solid part
 * and leave the cap, the neck and any hoop banding outside it — the same trade
 * `PROP_BODIES` in MapBuilder.ts argues for scatter, where too small costs a
 * round clipping a silhouette and too large costs shots that visibly should
 * have landed. The silo has always done this (its box is the nominal `dia`,
 * not the 1.06 it splays to at the foot); it is the pattern to copy. The well
 * goes one further, a dodecagon of six bars rather than one box, because a
 * square round a 3.3 m drum is 0.7 m of air on every diagonal.
 *
 * Two things here are walked ON rather than hidden behind — the two bridges and
 * the temple — so they additionally owe what kit/terrain.ts's header states:
 * collider top faces within CONFIG.nav.stepHeight of adjacent ground, and rotX
 * on the COLLIDER of anything pitched, not just on the visual.
 */
export {
  buildSilo,
  buildFence,
  buildStoneWall,
  buildHaystack,
  buildLampPost,
  buildCrates,
  buildTrough,
  buildShrine,
} from "./small";
export { buildWell } from "./well";
export { buildStall } from "./stall";
export { buildBridge } from "./bridge";
export { buildTrestleBridge } from "./trestleBridge";
export { buildTempleRuin } from "./templeRuin";
export { buildCart } from "./cart";
export { buildWoodpile } from "./woodpile";
export { buildShed } from "./shed";
export { buildKiln } from "./kiln";
