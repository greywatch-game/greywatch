/**
 * BuildingKit.ts — Facade for the parametric structure builders. Re-exports
 * the shared types and the BUILDERS registry; the implementation lives in
 * kit/ (core.ts = Build accumulator + palette + contract, buildings.ts,
 * city.ts, desert.ts, harbour.ts, japan.ts, manor.ts, structures.ts,
 * terrain.ts).
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
  buildQuay,
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
import {
  buildCareenedHull,
  buildFishRack,
  buildHarbourCrane,
  buildLighthouse,
  buildNetLoft,
  buildSaltPan,
  buildSmelter,
} from "./kit/harbour";
import {
  buildArchBridge,
  buildBellTower,
  buildGardenWall,
  buildKura,
  buildMachiya,
  buildMinka,
  buildPagoda,
  buildStonePagoda,
  buildTeahouse,
  buildTempleGate,
  buildTempleHall,
  buildToro,
  buildTorii,
} from "./kit/japan";
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
  quay: buildQuay,
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
  // The volcanic-coast set — see kit/harbour.ts, whose header owns the rule
  // that everything walked in it (the smelter's deck and its flight) obeys
  // kit/terrain.ts, and the argument for why nothing else in it is climbed.
  smelter: buildSmelter,
  lighthouse: buildLighthouse,
  crane: buildHarbourCrane,
  fishRack: buildFishRack,
  careenedHull: buildCareenedHull,
  netLoft: buildNetLoft,
  saltPan: buildSaltPan,
  // The temple town — see kit/japan.ts, whose header owns the curved roof and
  // the rule that vermilion is spent on the sacred and the crossed alone.
  pagoda: buildPagoda,
  templeHall: buildTempleHall,
  templeGate: buildTempleGate,
  bellTower: buildBellTower,
  machiya: buildMachiya,
  minka: buildMinka,
  teahouse: buildTeahouse,
  kura: buildKura,
  torii: buildTorii,
  toro: buildToro,
  stonePagoda: buildStonePagoda,
  gardenWall: buildGardenWall,
  archBridge: buildArchBridge,
} as const;

export type BuilderKind = keyof typeof BUILDERS;

/**
 * Kinds whose geometry is a function of the ground under them, so moving one
 * is a rebuild rather than a translate. The editor's drag path patches meshes
 * in place, which is correct for everything else and stale for these.
 *
 * **Declaring a `BuildCtx` parameter on a builder is what puts it here**: a
 * builder that reads the ground and is missing from this set is drawn against
 * the floor it was dragged away from until the next full rebuild. The road is
 * contoured, the three runs step (`groundRun`), and the pylon's span is drawn
 * to the ground under the next pole. The townhouse and the cottage read no
 * ground at all and are here for the same reason: their doors, their studding
 * and the rest of their dressing are seeded off where they stand
 * (`streetSeed`). The chapel lays its floor a step over the highest ground
 * under its nave and carries its footings down to the lowest. The stilt hut
 * cuts each pile to the ground under it, and seeds its dressing as the
 * cottage does. The cart sits down on the ground under its four wheels, and
 * seeds its load, its paint and its lock off where it stands.
 */
export const CONFORMS_TO_TERRAIN: ReadonlySet<BuilderKind> = new Set([
  "road",
  "stoneWall",
  "fence",
  "compoundWall",
  "pylon",
  "townhouse",
  "cottage",
  "chapel",
  "stiltHut",
  "cart",
] as const);
