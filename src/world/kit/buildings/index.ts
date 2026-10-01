/**
 * kit/buildings/index.ts — The big enterable/landmark buildings: cottage,
 * townhouse, tavern, smithy, ruin, watchtower, chapel, barn, mill, boathouse,
 * gatehouse, stiltHut, jungleRuin, manor.
 * All follow the contract in kit/core.ts (origin-local geometry, no
 * solid/pickable/collisions metadata).
 *
 * This file is the set's barrel: `BuildingKit.ts` imports the fourteen
 * builders from here, and each is a file of its own beside it. The words
 * they are drawn in are files of their own too — `village.ts` (the
 * elevations' members, the lamplit colours, and the roof and board numbers
 * more than one house shares), `rubble.ts` (the burnt cottage's rubble),
 * `gothic.ts` (the chapel's pointed openings and buttresses, one of which
 * the stilt hut borrows) and `render.ts` (the jungle ruin's broken render).
 * A builder never imports another builder.
 */
export { buildCottage } from "./cottage";
export { buildTownhouse } from "./townhouse";
export { buildTavern } from "./tavern";
export { buildSmithy } from "./smithy";
export { buildRuin } from "./ruin";
export { buildWatchtower } from "./watchtower";
export { buildChapel } from "./chapel";
export { buildBarn } from "./barn";
export { buildMill } from "./mill";
export { buildBoathouse } from "./boathouse";
export { buildGatehouse } from "./gatehouse";
export { buildStiltHut } from "./stiltHut";
export { buildJungleRuin } from "./jungleRuin";
export { buildJungleManor } from "./manor";
