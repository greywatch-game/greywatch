/**
 * BuildingKit.ts — Facade for the parametric structure builders. Re-exports
 * the shared types and the BUILDERS registry; the implementation lives in
 * kit/ (core.ts = Build accumulator + palette + contract, buildings.ts,
 * city.ts, desert.ts, harbour.ts, japan/, manor.ts, structures.ts,
 * terrain.ts).
 * Invariants: builders assemble AT THE ORIGIN, UNROTATED and NEVER set
 * metadata.solid, checkCollisions, or isPickable — MapBuilder owns the
 * visual/collider split. A builder may take a BuildCtx to read the world it is
 * about to land in (the road bends onto the ground), but still returns
 * origin-local geometry. Collider top faces must stay within
 * CONFIG.nav.stepHeight of adjacent ground; ramp colliders need rotX.
 * New builders: write them in the kit/ file (or set directory) they belong
 * to, register here.
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
  // The temple town — see kit/japan/index.ts, whose header owns the curved roof and
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
 * seeds its load, its paint and its lock off where it stands. The jungle
 * ruin cuts its plinth, its steps, its veranda and its rubble to the ground
 * under them, and seeds its decay off where it stands. The temple carries its
 * lowest terrace's facing, its south stair and its causeway down to the
 * ground, and seeds its decay the same way. The market stall seeds its trade,
 * its front and its canvas off where it stands, and cuts its posts and boarding
 * to the ground under them. The shed seeds its cladding, its roof, its door and
 * what hangs on it off where it stands, and carries its footing down to the
 * ground under each wall. The burnt cottage (`ruin`) seeds its stonework, its
 * breaks and its debris off where it stands, and carries the first course of
 * every face, its footings, its heaps and its threshold down to the ground. The woodpile seeds how it is ended, how it is
 * covered and every billet off where it stands, and carries its posts and the
 * stones under its bearers down to the ground. The watchtower cuts its legs,
 * its pads and its ramp's bents to the ground under each, and seeds its board
 * ends, its joints and the billets by its fire off where it stands. The well
 * carries the flags round its foot down to the ground under each, and seeds
 * its stonework, which half its lid covers and which side its crank is on.
 * The footbridge seeds its planks, its boarding and its stones off where it
 * stands, stands its bank seats where the bank falls away under it and cuts
 * each pile into the bed. The jetty seeds its planks, its piles' heads and
 * what lies at its head off where it stands, finds its head as the end the
 * ground falls away under, and cuts each pile, brace, sill and step to the
 * ground under it.
 * The kiln seeds which of its fire mouths are firing, where its bonts are
 * tightened, its weathered brickwork and what lies at its foot off where it
 * stands, and carries its plinth down to the lowest ground round the drum.
 * The kura seeds its crest, which of its doors and shutters are open, which
 * windows it has and where its plaster has spalled off where it stands, and
 * carries its granite plinth and its door step down to the ground. The machiya
 * seeds its lattice, what stands before each bay, its signboard, its Shōki,
 * its loft window, its smoke vent, its back door and the mark on its noren
 * off where it stands, and carries its plinth, its step and its bamboo fence
 * down to the ground. The minka seeds which end is stacked with firewood,
 * whether persimmons are drying over it, whether its smoke gables are open or
 * plastered with the fire charm, its back door's bay and its door's wicket off
 * where it stands, and carries its plinth, the stones under its engawa and its
 * two steps down to the ground. The pagoda seeds the lengths of its podium's
 * stones and its flags off where it stands, and carries its podium and the
 * flight on each face down to the ground. The teahouse seeds which end has
 * the round window, its gable's finish, its tokonoma's bay, its lanterns, its
 * blinds, its wind bell, the sandals on its step and the mark on its noren off
 * where it stands, and carries its footings, its underfloor, its step and its
 * stepping stones down to the ground. The temple hall seeds the lengths of its
 * stones and boards, the characters on its plaque and whether lanterns hang at
 * its back off where it stands, and carries its granite base and its steps
 * down to the ground. The temple gate seeds the lengths of its kerb stones
 * and flags, the first two characters on its plaque and the pilgrims' slips
 * on its posts off where it stands, and carries its platform and its
 * two steps down to the ground. The torii seeds the characters on its plaque
 * or its posts and the twist of its rope off where it stands, and carries each
 * post's plinth down to the ground under it. The garden wall seeds the lengths
 * of its kerb stones off where it stands, and carries each stone down to the
 * ground under it. The stone lantern seeds the characters on its shaft, which
 * of its deer is the stag and where lichen grows on its cap off where it
 * stands, and carries its foundation stone down to the ground. The stone
 * pagoda seeds the lengths of its kerb stones, the lichen on its roofs and
 * the maple leaves lying on it off where it stands, and carries its kerb down
 * to the ground. The bell tower seeds the lengths of its platform's stones,
 * flags and steps, the leaves blown onto it and the characters on its board
 * of the hours, and carries its platform's face and its steps down to the
 * ground. The arched bridge seeds its planks, its stones and the leaves blown
 * onto it off where it stands, and carries its abutments, its footings
 * and its wing stones down to the ground.
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
  "jungleRuin",
  "templeRuin",
  "cart",
  "stall",
  "shed",
  "ruin",
  "woodpile",
  "watchtower",
  "well",
  "bridge",
  "jetty",
  "kiln",
  "kura",
  "machiya",
  "minka",
  "pagoda",
  "teahouse",
  "templeHall",
  "templeGate",
  "torii",
  "gardenWall",
  "toro",
  "stonePagoda",
  "bellTower",
  "archBridge",
] as const);
