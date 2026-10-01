/**
 * kit/japan/index.ts — The temple town: pagoda, temple hall, temple gate, bell
 * tower, machiya, minka, teahouse, kura, torii, stone lantern, stone pagoda,
 * garden wall and the arched bridge. All follow the contract in kit/core.ts
 * (origin-local geometry, no solid/pickable/collisions metadata, a front on
 * local -Z).
 *
 * This file is the set's contract and its barrel: `BuildingKit.ts` imports
 * the thirteen builders from here, and each is a file of its own beside it.
 * What more than one of them builds with is a file of its own too:
 * `palette.ts` (the materials below), `roof.ts` (the curved roof),
 * `lapidary.ts` (the mason the stone ornaments share) and `joinery.ts` (the
 * carpenter the gate and the bell tower share). A builder never imports
 * another builder, but for `KURA_CRESTS`, which lives with the kura whose
 * crest it is and is borrowed by the machiya's and the teahouse's noren.
 *
 * ## What this set is, and why it is a set
 *
 * Kurenai is a temple town in a mountain valley in the last week of the
 * maples, and the rule `kit/harbour.ts` wrote down holds here unchanged: **a
 * map feels like a place because the buildings are the ones that place would
 * have built**, not because there are many of them. A valley like this one
 * built a temple with a pagoda for its landmark, a gate and a bell to go with
 * it, a street of narrow townhouses with lattice fronts, farmhouses under
 * thatch, storehouses in white plaster, a teahouse by the water, a shrine
 * reached through a tunnel of vermilion gates, and a bridge you walk UP.
 *
 * It is made of five materials and one accent: stained timber (`SUMI`) and
 * aged cypress (`HINOKI`), lime plaster (`SHIKKUI`) and earthen plaster
 * (`TSUCHI`), fired tile (`KAWARA`) — and vermilion (`SHU`), which is spent
 * only on what is SACRED or CROSSED: the torii, the bridge, the pagoda's
 * brackets. On a map where every tree is red, vermilion anywhere else stops
 * reading as a signal.
 *
 * ## The one new shape: a roof that curves
 *
 * Every roof in the older kits is straight slabs (`Build.gableRoof`), and a
 * Japanese roof is the one roof in the world that cannot be — the eave line
 * sweeping up at the corners and the pitch steepening toward the ridge is the
 * whole of what the silhouette says. `curvedRoof` (`roof.ts`) is that shape as
 * finished vertices: rings from the eave to the ridge, each ring higher and
 * tighter than the last on a power curve, the eave ring lifted at the corners,
 * a thickness under it and a band closing the edge. It is a CLOSED solid,
 * because the world's shadow map records back faces and every caster must be
 * one (`docs/rendering.md`), and every triangle is oriented against an outward
 * hint using Babylon's own face-normal formula, so the winding cannot come out
 * inside-out whichever way the rings are walked.
 *
 * Its COLLIDER is a flat slab at the eave, exactly `gableRoof`'s — nothing
 * walks on a roof in this town, and a curved ray shape would buy rounds a
 * centimetre of accuracy on a surface nobody stands behind.
 *
 * ## The rules this set adds to the kit contract
 *
 * - **Shoji glow, never shoji light.** A paper wall with a lamp behind it is a
 *   `Build.glow` panel with a `SUMI` lattice laid over its face — which is
 *   what the reference frame's hall is — and costs no light slot. Only a
 *   builder asked for `lit` spends one, and a layout should ask sparingly.
 * - **Everything walked obeys kit/terrain.ts's header**: the hall's plinth,
 *   the pagoda's plinth, the teahouse's deck and the bridge are all within
 *   `CONFIG.nav.stepHeight` of what is around them, and the bridge's ramps
 *   carry `rotX` on their colliders.
 * - **Colliders are emitted walked-first, roofs last**, because `NavGrid`
 *   drops surplus surfaces in ARRIVAL order (`docs/bots.md`) and a pagoda is
 *   five roofs stacked over one plinth.
 * - **Nothing tall is climbable.** The pagoda is the map's landmark and
 *   `buildMinaret`'s rule applies to it verbatim: a perch that sees every
 *   flag with one way up is not a position, it is a problem.
 */
export { buildTorii } from "./torii";
export { buildToro } from "./toro";
export { buildStonePagoda } from "./stonePagoda";
export { buildMachiya } from "./machiya";
export { buildMinka } from "./minka";
export { buildKura } from "./kura";
export { buildTeahouse } from "./teahouse";
export { buildTempleHall } from "./templeHall";
export { buildPagoda } from "./pagoda";
export { buildTempleGate } from "./templeGate";
export { buildBellTower } from "./bellTower";
export { buildGardenWall } from "./gardenWall";
export { buildArchBridge } from "./archBridge";
