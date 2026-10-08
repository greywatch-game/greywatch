/**
 * kit/harbour/index.ts — The working coast: smelter, lighthouse, harbour
 * crane, drying rack, careened hull, net loft, salt pan. All follow the
 * contract in kit/core.ts (origin-local geometry, no solid/pickable/collisions
 * metadata, a front on local -Z).
 *
 * This file is the set's contract and its barrel: `BuildingKit.ts` imports
 * the seven builders from here, and each building is a file of its own beside
 * it (`smelter.ts`, `lighthouse.ts`, `crane.ts`, `netLoft.ts`, `hull.ts`),
 * with the two small waterfront pieces together in `small.ts`. What more than one of
 * them is drawn with — the straight member, the broken-jointed run, the
 * tarred boarding and the window cut into it, the net loft's paints — is
 * `shared.ts`. A builder never imports another builder.
 *
 * ## What this set is, and why it is a set rather than seven more props
 *
 * Coldharbour got `kit/city/` and Sarab got `kit/desert/`; the island got
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
 * ## The rules this set adds to the kit contract
 *
 * - **A gantry, a gallery and a stair are WALKED, and everything walked here
 *   owes what kit/terrain.ts's header states**: a collider top face within
 *   `CONFIG.nav.stepHeight` of adjacent ground, `rotX` on the COLLIDER of
 *   anything pitched and not merely on the visual, and `Build.guard` — never a
 *   bare box — at the edge of anything a body stands on.
 * - **A flight is built to `GRADE`, not to `MAX_WALKABLE_GRADE`**, for the
 *   reason kit/desert/shared.ts's `GRADE` gives: the nav graph links cells by
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
export { buildSmelter } from "./smelter";
export { buildLighthouse } from "./lighthouse";
export { buildHarbourCrane } from "./crane";
export { buildNetLoft } from "./netLoft";
export { buildCareenedHull } from "./hull";
export { buildFishRack, buildSaltPan } from "./small";
