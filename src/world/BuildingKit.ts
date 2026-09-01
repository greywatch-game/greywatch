/**
 * BuildingKit.ts — Facade for the parametric structure builders. Re-exports
 * the shared types and the BUILDERS registry; the implementation lives in
 * kit/ (core.ts = Build accumulator + palette + contract, buildings.ts,
 * city.ts, manor.ts, structures.ts, terrain.ts).
 * Invariants: builders assemble AT THE ORIGIN, UNROTATED and NEVER set
 * metadata.solid, checkCollisions, or isPickable — MapBuilder owns the
 * visual/collider split. A builder may take a BuildCtx to read the world it is
 * about to land in (the road bends onto the ground), but still returns
 * origin-local geometry. Collider top faces must stay within
 * CONFIG.nav.stepHeight of adjacent ground; ramp colliders need rotX.
 * New builders: write them in the kit/ file they belong to, register here.
 * No Hollowmere special-casing.
 */
export type {
  BoxSpec,
  BuildCtx,
  BuildParams,
  LocalLight,
  PaneSpec,
  Structure,
} from "./kit/core";

import {
  buildCottage,
  buildTownhouse,
  buildTavern,
  buildSmithy,
  buildRuin,
  buildWatchtower,
  buildChapel,
  buildBarn,
  buildMill,
  buildBoathouse,
  buildGatehouse,
  buildStiltHut,
  buildJungleRuin,
} from "./kit/buildings";
import {
  buildBarrier,
  buildCar,
  buildDepot,
  buildMonument,
  buildOffice,
  buildParkade,
  buildPlanter,
  buildShophouse,
  buildStreetLight,
  buildTower,
} from "./kit/city";
import {
  buildAdobeHouse,
  buildBlastWall,
  buildCaravanserai,
  buildCompoundWall,
  buildGranary,
  buildHammam,
  buildMinaret,
  buildMosque,
  buildPylon,
  buildSandbags,
  buildShellBlock,
  buildSouk,
  buildWindTower,
} from "./kit/desert";
import { buildJungleManor } from "./kit/manor";
import {
  buildSilo,
  buildWell,
  buildStall,
  buildFence,
  buildStoneWall,
  buildBridge,
  buildTrestleBridge,
  buildTempleRuin,
  buildHaystack,
  buildLampPost,
  buildCart,
  buildCrates,
  buildWoodpile,
  buildShed,
  buildTrough,
  buildShrine,
  buildKiln,
} from "./kit/structures";
import {
  buildTerrace,
  buildRamp,
  buildRoad,
  buildJetty,
  buildBoardwalk,
  buildStairs,
} from "./kit/terrain";

/** Every builder, keyed by the name the layout data uses. */
export const BUILDERS = {
  cottage: buildCottage,
  townhouse: buildTownhouse,
  tavern: buildTavern,
  smithy: buildSmithy,
  ruin: buildRuin,
  watchtower: buildWatchtower,
  chapel: buildChapel,
  barn: buildBarn,
  silo: buildSilo,
  mill: buildMill,
  boathouse: buildBoathouse,
  gatehouse: buildGatehouse,
  manor: buildJungleManor,
  stiltHut: buildStiltHut,
  jungleRuin: buildJungleRuin,
  well: buildWell,
  stall: buildStall,
  fence: buildFence,
  stoneWall: buildStoneWall,
  bridge: buildBridge,
  trestleBridge: buildTrestleBridge,
  templeRuin: buildTempleRuin,
  terrace: buildTerrace,
  ramp: buildRamp,
  road: buildRoad,
  jetty: buildJetty,
  boardwalk: buildBoardwalk,
  stairs: buildStairs,
  haystack: buildHaystack,
  lamp: buildLampPost,
  cart: buildCart,
  crates: buildCrates,
  woodpile: buildWoodpile,
  shed: buildShed,
  trough: buildTrough,
  shrine: buildShrine,
  kiln: buildKiln,
  // The downtown set — see kit/city.ts, whose header owns the four rules a
  // building that stacks walked floors has to obey.
  tower: buildTower,
  office: buildOffice,
  shophouse: buildShophouse,
  depot: buildDepot,
  parkade: buildParkade,
  planter: buildPlanter,
  barrier: buildBarrier,
  car: buildCar,
  streetLight: buildStreetLight,
  monument: buildMonument,
  // The desert-town set — see kit/desert.ts, whose header owns the stair lane
  // every building in it that is climbed is built around.
  adobeHouse: buildAdobeHouse,
  compoundWall: buildCompoundWall,
  shellBlock: buildShellBlock,
  mosque: buildMosque,
  minaret: buildMinaret,
  souk: buildSouk,
  windTower: buildWindTower,
  caravanserai: buildCaravanserai,
  hammam: buildHammam,
  granary: buildGranary,
  blastWall: buildBlastWall,
  sandbags: buildSandbags,
  pylon: buildPylon,
} as const;

export type BuilderKind = keyof typeof BUILDERS;

/**
 * Kinds whose geometry is a function of the ground under them, so moving one
 * is a rebuild rather than a translate. The editor's drag path patches meshes
 * in place, which is correct for everything else and stale for these.
 */
export const CONFORMS_TO_TERRAIN: ReadonlySet<BuilderKind> = new Set([
  "road",
] as const);
