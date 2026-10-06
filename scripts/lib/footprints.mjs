/**
 * footprints.mjs — The ground each kit kind takes, and which of its faces are
 * ways in: ONE table for every map generator (`scripts/generate-<map>.mjs`)
 * and the map-layout skill's audit and plan scripts, which re-export it.
 *
 * Owns: `FOOT`, `DOOR_FACES` and `FRONTS`, and the two sets derived from the
 * door table. Nothing here decides where anything goes — which kinds a map
 * door-checks, and how hard, is still that map's generator.
 *
 * **A footprint is MEASURED off the builder and may not understate it.** It is
 * the plan of what the builder draws, in its own frame — walls, plinth,
 * doorstep, porch, ramp, a wheel, and the EAVES, because an eave over a
 * neighbour's wall is two roofs in one place — with two kinds of exception,
 * each stated beside the kind it applies to: ground a footprint takes BEYOND
 * the drawing on purpose (a stair's landing, a ruin's forecourt, a bridge's
 * approaches), and a street-level canopy, blind or jib a body walks under,
 * which a neighbour may stand under too.
 *
 * **`npm run kit:hash -- --feet` is the check.** It builds every placement of
 * every kind in this table across every layout and prints where the drawing
 * reaches past its entry. A builder rework that moves an eave owes that run
 * and an edit HERE, and the edit owes a re-seed of every map that places the
 * kind (`npm run <map>`), the collision rebake and `npm run parity` — a
 * footprint is half of every claim a generator makes, so it moves layouts.
 *
 * Invariants:
 * - `[x0, x1, z0, z1]` in the builder's own frame, front at local -Z for
 *   every kind but those whose first door face says otherwise (`FRONT_PLUS_Z`).
 * - Defaults inside an entry are the BUILDER's defaults; an entry whose
 *   builder reads a param must read the same one with the same default.
 * - Node loads this as plain JS and the generators load `src/world/*.ts` by
 *   type stripping beside it, so nothing here may import the game.
 *
 * Never: name a map, or hold a value one map needs and another does not — a
 * per-map difference is an option on that generator's `place`, not a second
 * row here (four copies of this table drifted apart before it existed).
 */

/** Metres of run per metre of rise on every stair (`STAIR_GRADE` in kit/terrain.ts). */
const STAIR_GRADE = 0.35;
/** The run of a flight `h` high: the `stairs` builder's own arithmetic, which a generator laying one needs too. */
export const stairRun = (h) => h / STAIR_GRADE;

/** `kind -> params -> [x0, x1, z0, z1]`, the builder's own frame. */
export const FOOT = {
  // --- the village kit (Harrowmead, Hollowmere, Coldharbour's old town) -----
  cottage: (p) => {
    const w = p.width ?? 7;
    const d = p.depth ?? 6;
    return [-w / 2 - 0.8, w / 2 + 0.8, -d / 2 - 1.0, d / 2 + 0.8];
  },
  townhouse: (p) => {
    const w = p.width ?? 6.5;
    const d = p.depth ?? 6.5;
    return [-w / 2 - 0.5, w / 2 + 0.5, -d / 2 - 1.1, d / 2 + 0.6];
  },
  tavern: () => [-7.1, 7.1, -9.2, 5.6],
  smithy: () => [-5.2, 5.2, -6.6, 4.8],
  chapel: () => [-7.4, 7.4, -11.6, 16.6],
  barn: () => [-8.9, 11.9, -11.8, 11.8],
  mill: () => [-7.2, 5.4, -5.8, 5.0],
  boathouse: () => [-6.0, 7.2, -7.0, 7.0],
  silo: () => [-3.2, 3.2, -3.2, 3.2],
  watchtower: () => [-2.8, 2.8, -18.2, 2.8],
  gatehouse: () => [-11.3, 11.3, -8.2, 2.6],
  shed: (p) => {
    const w = p.width ?? 3.4;
    const d = p.depth ?? 2.8;
    return [-w / 2 - 0.3, w / 2 + 0.3, -d / 2 - 0.3, d / 2 + 0.3];
  },
  haystack: () => [-1.6, 1.6, -1.6, 1.6],
  cart: () => [-1.8, 3.8, -1.1, 1.1],
  // The cask stood against the stack is inside this; an open one's lost hoop,
  // 4.5 cm of iron lying up to 1.4 m off, is litter and is not.
  crates: () => [-1.6, 1.7, -1.3, 1.3],
  woodpile: (p) => {
    const len = p.length ?? 5;
    return [-len / 2 - 0.2, len / 2 + 0.2, -0.7, 0.7];
  },
  trough: () => [-1.6, 1.6, -0.6, 0.6],
  well: () => [-1.7, 1.7, -1.7, 1.7],
  // The customer's side (-Z) stands under the canvas, which is a canopy; the
  // stallholder's (+Z) has what is stored on the ground behind the counter.
  stall: () => [-2, 2, -1.1, 1.45],
  kiln: () => [-2, 2, -2.2, 2],
  shrine: () => [-0.8, 0.8, -0.8, 0.8],
  lamp: () => [-0.4, 1.1, -0.4, 0.4],
  ruin: (p) => {
    const w = p.width ?? 10;
    const d = p.depth ?? 8;
    return [-w / 2 - 0.3, w / 2 + 0.3, -d / 2 - 0.3, d / 2 + 0.3];
  },
  stoneWall: (p) => [-(p.length ?? 12) / 2, (p.length ?? 12) / 2, -0.4, 0.4],
  fence: (p) => [-(p.length ?? 10) / 2, (p.length ?? 10) / 2, -0.25, 0.25],
  bridge: (p) => [-(p.width ?? 3.2) / 2 - 0.3, (p.width ?? 3.2) / 2 + 0.3, -(p.length ?? 12) / 2, (p.length ?? 12) / 2],
  // The pile heads stand outboard of the deck; the shore end's step and the
  // head's laid ladder stand off either end, whichever the ground makes the head.
  jetty: (p) => [-1.9, 1.9, -(p.length ?? 18) / 2 - 0.5, (p.length ?? 18) / 2 + 0.5],
  ramp: (p) => [-(p.width ?? 5) / 2, (p.width ?? 5) / 2, -(p.length ?? 8) / 2, (p.length ?? 8) / 2],

  // --- the jungle kit (Greyfen) ----------------------------------------------
  manor: () => [-14.5, 18, -18.4, 7.4],
  stiltHut: () => [-5, 5, -4.4, 4.4],
  jungleRuin: (p) => {
    const w = p.width ?? 12;
    const d = p.depth ?? 9;
    return [-w / 2 - 1.8, w / 2 + 1.8, -d / 2 - 3.0, d / 2 + 0.6];
  },
  templeRuin: (p) => [-(p.width ?? 26) / 2 - 0.5, (p.width ?? 26) / 2 + 0.5, -(p.depth ?? 22) / 2 - 6, (p.depth ?? 22) / 2 + 0.5],
  trestleBridge: (p) => [-(p.width ?? 3.2) / 2 - 0.4, (p.width ?? 3.2) / 2 + 0.4, -(p.length ?? 26) / 2 - 7, (p.length ?? 26) / 2 + 7],
  boardwalk: (p) => [-(p.width ?? 2.4) / 2 - 0.2, (p.width ?? 2.4) / 2 + 0.2, -(p.length ?? 14) / 2, (p.length ?? 14) / 2],
  // Front (-Z) is the FOOT of the flight, with 0.6 m of landing before it.
  stairs: (p) => [-1.4, 1.4, -stairRun(p.height ?? 2.5) / 2 - 0.6, stairRun(p.height ?? 2.5) / 2],
  sandbags: (p) => [-(p.length ?? 6) / 2 - 0.1, (p.length ?? 6) / 2 + 0.1, -0.5, 0.5],

  // --- the city kit (Coldharbour). Overhead canopies, blinds and jibs are not
  // ground: a neighbour may stand under them. -----------------------------------
  tower: (p) => [-(p.width ?? 18) / 2 - 0.4, (p.width ?? 18) / 2 + 0.4, -(p.depth ?? 16) / 2 - 0.4, (p.depth ?? 16) / 2 + 0.4],
  office: (p) => [-(p.width ?? 22) / 2 - 0.3, (p.width ?? 22) / 2 + 0.3, -(p.depth ?? 18) / 2 - 0.3, (p.depth ?? 18) / 2 + 0.3],
  shophouse: (p) => [-(p.width ?? 13) / 2 - 0.2, (p.width ?? 13) / 2 + 0.2, -(p.depth ?? 16) / 2 - 0.2, (p.depth ?? 16) / 2 + 0.4],
  depot: (p) => [-(p.width ?? 28) / 2 - 0.45, (p.width ?? 28) / 2 + 0.45, -(p.depth ?? 16) / 2 - 0.35, (p.depth ?? 16) / 2 + 0.4],
  parkade: (p) => [-(p.width ?? 32) / 2 - 0.3, (p.width ?? 32) / 2 + 0.3, -(p.depth ?? 24) / 2 - 0.3, (p.depth ?? 24) / 2 + 0.3],
  monument: (p) => [-(p.width ?? 11) / 2, (p.width ?? 11) / 2, -(p.width ?? 11) / 2, (p.width ?? 11) / 2],
  planter: (p) => [-(p.width ?? 2.6) / 2, (p.width ?? 2.6) / 2, -(p.depth ?? 1.4) / 2, (p.depth ?? 1.4) / 2],
  barrier: (p) => [-0.31, 0.31, -(p.length ?? 6) / 2, (p.length ?? 6) / 2],
  car: () => [-2.25, 2.25, -1.0, 1.0],
  streetLight: () => [-0.3, 0.3, -0.3, 0.3],
  quay: (p) => [-(p.length ?? 40) / 2, (p.length ?? 40) / 2, -4.44, 0],

  // --- the harbour kit (Coldharbour, Greyfen's waterside) ---------------------
  lighthouse: () => [-5.7, 5.7, -11.2, 5.7],
  crane: () => [-4.2, 4.2, -4.0, 5.6],
  netLoft: (p) => [-(p.width ?? 9) / 2 - 0.45, (p.width ?? 9) / 2 + 0.45, -(p.depth ?? 7) / 2 - 0.45, (p.depth ?? 7) / 2 + 0.45],
  fishRack: (p) => [-(p.length ?? 9) / 2 - 0.2, (p.length ?? 9) / 2 + 0.2, -1.1, 1.1],
  // Lying over on its bilge with its shores out to both sides; the stem and
  // the stern rise clear of the ground off either end and are not.
  careenedHull: (p) => [-2.95, 2.95, -(p.length ?? 11) / 2 - 0.3, (p.length ?? 11) / 2 + 0.3],
};

/**
 * The faces a body walks in through, by kind. The FIRST is the FRONT — the one
 * a generator's door check holds to a street, a square or a yard — and any
 * other is only held clear for a couple of metres (Coldharbour's `doorway`).
 * A tower has no way in, but its lobby is still a front and still owes the
 * street.
 */
export const DOOR_FACES = {
  cottage: ["-z"],
  townhouse: ["-z"],
  tavern: ["-z"],
  smithy: ["-z"],
  chapel: ["-z"],
  mill: ["-z"],
  barn: ["-z"],
  boathouse: ["-z"],
  ruin: ["-z"],
  jungleRuin: ["-z"],
  stiltHut: ["-z"],
  tower: ["+z"],
  office: ["-z", "+x"],
  shophouse: ["+z", "-z"],
  depot: ["+z", "-x"],
  netLoft: ["-z"],
  lighthouse: ["-z"],
};

/** Kinds with a front door: the ones a door check holds to somewhere a body can walk. */
export const DOORS = new Set(Object.keys(DOOR_FACES));

/** Kinds whose street FRONT is local +Z rather than -Z: the city kit's shopfront, lobby and loading bays. */
export const FRONT_PLUS_Z = new Set(Object.keys(DOOR_FACES).filter((k) => DOOR_FACES[k][0] === "+z"));

/** Kinds with no door to check whose front only has to be CLEAR: a shed's door, a kiln's stoke hole. */
export const FRONTS = new Set(["shed", "kiln"]);
