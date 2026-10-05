/**
 * generate-coldharbour.mjs — SEEDS Coldharbour, the town on the bay: writes
 * `src/world/coldharbour/{layout,heights}.ts`.
 *
 * Run with `npm run coldharbour`, and owe `npm run collision -- coldharbour`
 * and `npm run parity` after it. Committed output, like every `heights.ts` and
 * every collision bake, and re-running it with the tree unchanged must produce
 * the same bytes.
 *
 * Flags: `--probe` prints the floor as a plan and writes nothing,
 * `--refusals` lists every plot that was refused and what refused it,
 * `--claims <file>` dumps the claims, the placements and the floor as JSON,
 * and `--dry` runs everything and writes nothing.
 *
 * ## Why it is seeded now, when it was typed
 *
 * Coldharbour was typed as a business district on a dead-level 5 x 5 grid of
 * 16 m avenues: forty-four towers, every street 300 m long and straight, and a
 * coast that was one quay laid along the southern edge after the fact. It
 * played as lanes of fire between boxes and it read as a diagram of a city
 * rather than as a place anybody lived. This re-lays it as a TOWN ON A BAY —
 * the harbour cut into the middle of the southern side, the town wrapped round
 * its head and climbing the hill behind it — and that is a change to the
 * ground, the water and the streets at once, which is exactly what a typed
 * layout cannot keep in step. So the DESIGN is authored here and the
 * TRANSCRIPTION is mechanical and CHECKED:
 *
 * - **Nothing stands in the water**, sampled on the floor the game draws.
 * - **Nothing stands on a road**, the network's own footprint being imported
 *   from `src/world/roadPaths.ts` so the test is the one the game makes.
 * - **Nothing is built on a slope**: a placement samples the ground ONCE at
 *   its centre, so a plot that falls more than `FLAT` across its footprint is
 *   refused rather than left floating at one corner.
 * - **Every door opens onto somewhere.** The city kit's street front is its
 *   local +Z (the shopfront, the lobby, the loading bays) — the reverse of the
 *   village kit's — and each kind states which of its faces carry a way in
 *   (`DOOR_FACES`). One of them has to reach a street, a square or a yard
 *   before it meets anything solid.
 * - **No road runs into the water**, and every quay stands on the line the
 *   floor's own cliff is cut on, because a quay hangs DOWN from the ground it
 *   is placed on.
 *
 * ## The floor
 *
 * Four passes, in order: a hill that rises from the harbour to the north edge
 * (the town is an amphitheatre round its water, which is what a harbour town
 * is), every district levelled toward its own height by a weighted average
 * (Sarab's `land`), the harbour cut to its bed with a natural foreshore where
 * nothing is built against it, and the open sea past the pier and the docks.
 *
 * **The harbour is WADEABLE, and that is a rule about this engine rather than
 * a look.** There is no swimming here: a body walks on the bed wherever the
 * bed is, so water deeper than a body is a body under the surface. So the
 * whole harbour inside the pier is cut to a low-water bed — 0.7 m at the head,
 * 1.1 m at the mouth — and the boats lie over on the mud beside the quays,
 * which is what a tidal harbour at low water looks like and is the strongest
 * thing on the map saying where it is. Only past the pier and off the docks,
 * against the play square's own edge, is the sea deep.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { roadNetwork } from "../src/world/roadPaths.ts";
import { onRoad } from "../src/world/roads.ts";
import {
  bracketKind,
  f1,
  makeFloorAt,
  makeFootWet,
  makeGrade,
  makeMust,
  makeOverlaps,
  makeRelief,
  makeScatter,
  makeWorldFoot,
  n2,
  printProbe,
  printRefusals,
  printTally,
  rectDist,
  section,
  seeded,
  smooth,
  tally,
  TURN,
  turnOf,
  vnoise,
} from "./lib/mapgen.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = join(root, "src", "world", "coldharbour");

// --- the extent --------------------------------------------------------------

/** The PLAY square. */
const PLAY = 320;
/** Metres per heightfield cell. `CELLS * CELL` must equal `PLAY`. */
const CELL = 4;
const CELLS = PLAY / CELL;
const HALF = PLAY / 2;
/** The steepest step between two vertices the nav graph still links, per metre. */
const MAX_GRADE = 0.4;
/**
 * How far the floor may fall across a building's footprint before the plot is
 * refused. The city kit is placed LEVEL — no builder here reads the ground —
 * and its plinths are 0.3..0.4 m, so this is the daylight under one corner.
 */
const FLAT = 0.32;

// --- the seeded stream -------------------------------------------------------

const { rng, rand, chance, pick } = seeded(0x43484152);

// --- the floor ---------------------------------------------------------------

const mix = (a, b, t) => a + (b - a) * t;

/**
 * The hill the town is built on, before anything is levelled: the waterfront
 * at the datum, rising north to the High Town and the ridge road, and rising
 * west into the old town's own shoulder. The east — the docks and the goods
 * yards round the station — stays low, because a railway and a dock are both
 * built on the flattest ground a town has.
 */
function natural(x, z) {
  let h = 3.6 * smooth(z / 130);
  h += 0.9 * smooth((-x - 50) / 70) * smooth((z + 100) / 70);
  h -= 0.8 * smooth((x - 40) / 60) * (1 - smooth((z - 40) / 60));
  h += 0.35 * vnoise(x, z, 48, 11) + 0.12 * vnoise(x, z, 20, 12);
  return h;
}

// --- the places that have to be level -----------------------------------------

/**
 * `level` is what the ground reads inside the core and `skirt` how far it takes
 * to get back to the hill. `weight` makes one district win where two meet:
 * the waterfront is weighted so the quays' own line is EXACTLY the datum, since
 * a quay hangs from the ground at its own origin and the street behind it has
 * to be the deck continuing.
 */
const DISTRICTS = [
  // The waterfront, all at the datum.
  { name: "harbour head", x0: -64, x1: 56, z0: -40, z1: -24, level: 0, skirt: 8, weight: 4 },
  { name: "west quay", x0: -57, x1: -40, z0: -100, z1: -24, level: 0, skirt: 8, weight: 4 },
  { name: "docks", x0: 32, x1: 160, z0: -160, z1: -24, level: 0, skirt: 10, weight: 4 },
  { name: "pier", x0: -160, x1: -60, z0: -160, z1: -136, level: 0, skirt: 6, weight: 4 },
  { name: "the ness", x0: -160, x1: -96, z0: -136, z1: -100, level: 0.3, skirt: 10 },
  // C — the civic square at the head of the harbour, a step up off the quay,
  // and the frontages round it.
  { name: "the square", x0: -46, x1: 42, z0: -20, z1: 30, level: 0.6, skirt: 10, weight: 2 },
  // B's quarter: the old town behind the west quay.
  { name: "old town", x0: -118, x1: -57, z0: -94, z1: 24, level: 0.3, skirt: 10 },
  // The Mariners' Church on its own rise at the top of Ship Lane.
  { name: "churchyard", x0: -118, x1: -99, z0: 6, z1: 34, level: 1.2, skirt: 8, weight: 2 },
  { name: "old town west", x0: -128, x1: -118, z0: -94, z1: -34, level: 0.3, skirt: 8 },
  { name: "west edge south", x0: -160, x1: -138, z0: -96, z1: -36, level: 0.6, skirt: 10 },
  { name: "west edge north", x0: -160, x1: -130, z0: -22, z1: 40, level: 1.2, skirt: 10 },
  // A — the High Town, and the Exchange on its square.
  { name: "high town", x0: -160, x1: -62, z0: 50, z1: 96, level: 3.0, skirt: 10 },
  { name: "midtown", x0: -54, x1: 42, z0: 40, z1: 104, level: 1.8, skirt: 10 },
  // D — the station and its forecourt, and the east town under it.
  { name: "station", x0: 50, x1: 160, z0: 44, z1: 96, level: 2.0, skirt: 10 },
  { name: "east town", x0: 50, x1: 160, z0: -12, z1: 36, level: 0.6, skirt: 10 },
  // The ridge road's north side and the home yard on the Heights.
  { name: "north row west", x0: -128, x1: -62, z0: 105, z1: 160, level: 3.8, skirt: 10 },
  { name: "north row middle", x0: -52, x1: 40, z0: 113, z1: 160, level: 3.0, skirt: 10 },
  { name: "north row east", x0: 50, x1: 160, z0: 105, z1: 160, level: 3.0, skirt: 10 },
  { name: "the heights", x0: -160, x1: -128, z0: 100, z1: 160, level: 4.0, skirt: 10 },
];

/** The ground before the water: the hill, then every district, averaged. */
function land(x, z) {
  const base = natural(x, z);
  let wsum = 0;
  let hsum = 0;
  for (const d of DISTRICTS) {
    const w = (1 - smooth(rectDist(x, z, d) / d.skirt)) * (d.weight ?? 1);
    if (w <= 0) continue;
    wsum += w;
    hsum += w * d.level;
  }
  if (wsum <= 0) return base;
  return base + (hsum / wsum - base) * Math.min(1, wsum);
}

// --- the water ---------------------------------------------------------------

/** The surface of the harbour and the sea. Every rect agrees on it. */
const WATER_Y = -2.2;
/** The open sea past the pier and off the docks, and the edge row under it. */
const SEA_BED = -6;
/** How steeply a natural foreshore climbs out of the harbour, per metre. */
const SHORE = 0.25;

/**
 * The harbour's floor: low water over mud, 0.7 m at the head and deepening to
 * 1.1 m toward the mouth, then falling away to the open sea in the last two
 * cells before the play square's edge.
 */
function harbourBed(x, z) {
  let b = -2.9 - 0.4 * smooth((-z - 80) / 60);
  b = mix(b, SEA_BED, smooth((-z - 150) / 10));
  return b;
}

/**
 * THE HARBOUR, as the polygon its bed is flat inside. Quayed round the head
 * and down both sides — each edge there being the quay's LAND line less the
 * 4 m deck that hangs over the cliff — and natural in its two lower corners:
 * the Strand on the west, where the foreshore runs down from the old town to
 * the pier, and the Hard on the east, where boats are hauled out below the
 * docks. **The Hard is a balance decision as much as a picture**: a quay is a
 * cliff the nav graph severs, so a harbour walled all the way down its east
 * side would be a moat between team 1 and the old town, and every bot bound
 * for B would walk round the head. Two foreshores make the mouth of the
 * harbour a wade.
 */
const HARBOUR = [
  [-36, -40],
  [28, -40],
  [28, -108],
  [34, -124],
  [42, -140],
  [46, -170],
  [-56, -170],
  [-56, -124],
  [-96, -124],
  [-76, -116],
  [-56, -110],
  [-36, -104],
];

function inPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function polyDist(poly, x, z) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j];
    const [bx, bz] = poly[i];
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
  }
  return best;
}

/**
 * Every quay wall on the map, as the LINE its land edge stands on, the axis it
 * runs along, the span it covers and which way the water is. The floor is cut
 * against these — land on the line, bed one cell out — and the placements are
 * laid from them, so the wall and the cliff it is built into cannot disagree.
 *
 * `water` is the world direction the water lies in; the quay builder's water
 * side is its local -Z, so that is also the placement's turn.
 */
const QUAYS = [
  // The harbour head, under the square.
  { name: "the head", axis: "x", at: -36, from: -36, to: 28, water: "south", ext: 10 },
  // The west quay, under the old town, as far as the Strand.
  { name: "the west quay", axis: "z", at: -40, from: -96, to: -36, water: "east" },
  // The east quay, down the docks as far as the Hard.
  { name: "the east quay", axis: "z", at: 32, from: -108, to: -36, water: "west" },
  // The pier's seaward face, and the head it ends in.
  { name: "the pier", axis: "x", at: -152, from: -160, to: -56, water: "south", reach: 14 },
  { name: "the pier head", axis: "z", at: -60, from: -152, to: -140, water: "east", reach: 10 },
  // The docks' seaward face.
  { name: "the dock front", axis: "x", at: -152, from: 60, to: 160, water: "south" },
];

/** True where a point stands on a quay's land side, behind its line and within reach of it. */
function quayLand(x, z) {
  for (const q of QUAYS) {
    const along = q.axis === "x" ? x : z;
    // Past either end by `ext`: where two walls meet at a corner, the ground
    // behind the corner is both walls' and neither may grade it away.
    if (along < q.from - 0.01 - (q.ext ?? 0) || along > q.to + 0.01 + (q.ext ?? 0)) continue;
    const across = q.axis === "x" ? z : x;
    const back = { south: across - q.at, north: q.at - across, west: across - q.at, east: q.at - across }[q.water];
    if (back >= -0.01 && back <= (q.reach ?? 20)) return true;
  }
  return false;
}

/** True where a point lies in the strip a quay's deck hangs over. */
function underDeck(x, z, pad = 0) {
  for (const q of QUAYS) {
    const along = q.axis === "x" ? x : z;
    if (along < q.from - pad || along > q.to + pad) continue;
    const across = q.axis === "x" ? z : x;
    const out = { south: q.at - across, north: across - q.at, west: q.at - across, east: across - q.at }[q.water];
    if (out >= -pad && out <= 4 + pad) return true;
  }
  return false;
}

/** The pierhead the lighthouse stands on. */
const PIER = { x0: -160, x1: -60, z0: -152, z1: -136 };

function heightAt(x, z) {
  let h = land(x, z);
  // The open sea: everything south of the pier and the dock front, and the
  // edge row the borderland extrudes, deep enough that `borderRoll` cannot
  // lift it into a shoal.
  if (z <= -155.9 && !inPoly(HARBOUR, x, z)) h = z <= -159.9 ? SEA_BED : SEA_BED + 1;
  if (inPoly(HARBOUR, x, z)) {
    h = harbourBed(x, z);
  } else if (!quayLand(x, z)) {
    // The foreshore: the Strand, the pier's harbour side and the ends of the
    // quay walls, graded so a body walks up out of the harbour anywhere.
    h = Math.min(h, harbourBed(x, z) + SHORE * polyDist(HARBOUR, x, z));
  }
  return h;
}

// The floor as the GAME has it: the vertex grid, rounded as written, and
// blended bilinearly — every test below reads this rather than `heightAt`.
const ROW = CELLS + 1;
const V = new Float64Array(ROW * ROW);
for (let j = 0; j < ROW; j++) {
  for (let i = 0; i < ROW; i++) {
    V[j * ROW + i] = Math.round(heightAt(-HALF + i * CELL, -HALF + j * CELL) * 100) / 100;
  }
}

const floorAt = makeFloorAt((i, j) => V[j * ROW + i], CELLS, CELL, HALF);

/** The steeper of the two axial slopes at a point. */
const grade = makeGrade(floorAt, 1.5);

/** True where the floor is under the water (plus a margin of bank). */
const wet = (x, z, margin = 0.3) => floorAt(x, z) < WATER_Y + margin;

if (process.argv.includes("--probe")) {
  printProbe({ half: HALF, step: 8, height: floorAt, grade, wet });
  process.exit(0);
}

// --- the output, and the placement vocabulary --------------------------------

const DIRS = { north: [0, 1], east: [1, 0], south: [0, -1], west: [-1, 0] };
/**
 * The turn that points a local face at a world direction. **The two kits face
 * opposite ways**: the city kit's street front is its local +Z (the shopfront,
 * the lobby, the loading bays), the village and harbour kits' is -Z.
 */
function turnFacing(dir, localFace = "+z") {
  const [wx, wz] = DIRS[dir];
  const [lx, lz] = { "+z": [0, 1], "-z": [0, -1], "+x": [1, 0], "-x": [-1, 0] }[localFace];
  for (const t of [0, 1, 2, 3]) {
    const [ox, oz] = turnOf(lx, lz, t);
    if (Math.abs(ox - wx) < 1e-9 && Math.abs(oz - wz) < 1e-9) return t;
  }
  throw new Error(`turnFacing: ${dir} ${localFace}`);
}

/**
 * The ground each kind takes, in its own frame: `[x0, x1, z0, z1]`. Measured
 * off the builders — a plinth, a dock bumper, a doorstep and a hull's shores
 * are all ground nothing else may stand on. Overhead canopies, blinds and jibs
 * are not, so a neighbour may stand under them.
 */
const FOOT = {
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
  lighthouse: () => [-5.7, 5.7, -11.2, 5.7],
  crane: () => [-4.2, 4.2, -4.0, 5.6],
  fishRack: (p) => [-(p.length ?? 9) / 2, (p.length ?? 9) / 2, -1.0, 1.0],
  careenedHull: (p) => [-2.9, 2.9, -(p.length ?? 11) / 2 - 0.75, (p.length ?? 11) / 2 + 0.75],
  netLoft: (p) => [-(p.width ?? 9) / 2 - 0.45, (p.width ?? 9) / 2 + 0.45, -(p.depth ?? 7) / 2 - 0.45, (p.depth ?? 7) / 2 + 0.45],
  chapel: () => [-7.4, 7.4, -11.6, 16.6],
  tavern: () => [-7.1, 7.1, -9.2, 5.6],
  townhouse: (p) => [-(p.width ?? 6.5) / 2 - 0.5, (p.width ?? 6.5) / 2 + 0.5, -(p.depth ?? 6.5) / 2 - 0.7, (p.depth ?? 6.5) / 2 + 0.6],
  cottage: (p) => [-(p.width ?? 7) / 2 - 0.8, (p.width ?? 7) / 2 + 0.8, -(p.depth ?? 6) / 2 - 0.9, (p.depth ?? 6) / 2 + 0.8],
  stall: () => [-2.0, 2.0, -1.15, 1.15],
  crates: () => [-1.6, 1.8, -1.45, 1.3],
  jetty: (p) => [-1.9, 1.9, -(p.length ?? 18) / 2 - 0.4, (p.length ?? 18) / 2 + 0.4],
};

/**
 * The faces a body walks in through, by kind; the FIRST is the one that has
 * to reach a street, a square or a yard (`doorway`), and every other is only
 * held clear for a couple of metres. A tower has no way in, but its lobby is
 * still a FRONT and still owes the street.
 */
const DOOR_FACES = {
  tower: ["+z"],
  office: ["-z", "+x"],
  shophouse: ["+z", "-z"],
  depot: ["+z", "-x"],
  netLoft: ["-z"],
  lighthouse: ["-z"],
  chapel: ["-z"],
  tavern: ["-z"],
  townhouse: ["-z"],
  cottage: ["-z"],
};
/** Small things a yard or a flag's ring may hold. */
const PROPS = new Set(["planter", "barrier", "car", "streetLight", "stall", "crates", "fishRack"]);

const worldFoot = makeWorldFoot(FOOT);

const placements = [];
const scatter = [];
/** The same placements and regions as objects, for the network and the render. */
const placed = [];
const regions = [];

const note = (list, ...lines) => list.push(...lines.map((l) => `  // ${l}`.trimEnd()));

function paramText(params) {
  if (!params) return "";
  return Object.entries(params)
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}: [${v.map((q) => `[${q.map(n2).join(", ")}]`).join(", ")}]`;
      const lit = typeof v === "string" ? `"${v}"` : typeof v === "boolean" ? String(v) : n2(v);
      return `${k}: ${lit}`;
    })
    .join(", ");
}

function emit(kind, x, z, turn, params, y) {
  const ps = paramText(params);
  const yy = y !== undefined ? `, y: ${n2(y)}` : "";
  placements.push(
    `  { kind: "${kind}", x: ${n2(x)}, z: ${n2(z)}${yy}${TURN[turn]}` + (ps ? `, params: { ${ps} }` : "") + " },",
  );
  placed.push({ kind, x, z, y, rotY: [0, Math.PI / 2, Math.PI, -Math.PI / 2][turn], params: params ?? {}, turn });
}

// --- the roads, first, because everything else dodges them -------------------

/**
 * The street plan, as names: every line the network is laid on, so the rows
 * and the set pieces below are written against the street they face rather
 * than against a number.
 *
 * The town is a HORSESHOE round the harbour: the Harbour Road runs the three
 * quays, and everything else climbs away from it. Nothing runs straight for
 * long — the cross-town line jogs at Fore Street and at Quay Street, High
 * Street jogs at both, Fore Street bends where it reaches the High Town, and
 * the two home roads each jog twice — because a street that runs the width of
 * the map is a lane of fire, and this map used to be eight of them.
 */
const S = {
  /** The Harbour Road's three legs: the west quay, the head, the east quay. */
  harbourW: -50,
  harbourHead: -26,
  harbourE: 46,
  /** Under the old town, along the top of the Strand. */
  strand: -96,
  /** The docks' back road, behind the cranes. */
  dock: -116,
  /** The two home roads. */
  west: -132,
  station: 120,
  /** The old town's lanes. */
  ship: -96,
  fish: -50,
  chapel: 0,
  /** Up from the harbour head to the High Town. */
  fore: -50,
  foreTop: -58,
  /** Up from the east quay past the square. */
  quay: 46,
  /** North out of the square. */
  queen: 0,
  /** The cross-town line: Exchange Street, Market Street, Station Approach. */
  exchange: 40,
  market: 34,
  approach: 40,
  /** Across the docks, and across the east town. */
  warehouse: -80,
  rope: -8,
  /** The ridge road along the top of the town. */
  highW: 100,
  highMid: 108,
  highE: 100,
};

/** The civic square: the lawn, its paths and the monument. */
const SQ = { x0: -22, x1: 22, z0: -18, z1: 26 };

section(placements, "roads");
note(
  placements,
  "Visual only: a road carries no collider, stops no round and is in no",
  "baked structure. The through roads are asphalt and the old town's lanes",
  "and the square's paths are cobble. Every street is a PATH, so where two",
  "meet the network paves the junction itself.",
);

const roadDefs = [];

/** An axis-aligned rectangle road. `turn` 0 runs along Z, 1 along X. */
function rectRoad(x, z, turn, len, w, surface) {
  const params = { length: len, width: w };
  if (surface) params.surface = surface;
  roadDefs.push({ kind: "road", x, z, rotY: turn ? Math.PI / 2 : 0, params });
  emit("road", x, z, turn, params);
}

/** A path road through world points; the network bends and joins it. */
function pathRoad(comment, points, w, surface, radius) {
  if (comment) note(placements, comment);
  const xs = points.map((p) => p[0]);
  const zs = points.map((p) => p[1]);
  const cx = Number(((Math.min(...xs) + Math.max(...xs)) / 2).toFixed(2));
  const cz = Number(((Math.min(...zs) + Math.max(...zs)) / 2).toFixed(2));
  const path = points.map((p) => [Number((p[0] - cx).toFixed(2)), Number((p[1] - cz).toFixed(2))]);
  const params = { path, width: w, surface };
  if (radius !== undefined) params.radius = radius;
  roadDefs.push({ kind: "road", x: cx, z: cz, params });
  emit("road", cx, cz, 0, params);
}

const MAIN = 11;
const STREET = 9;
const LANE = 6;

pathRoad(
  "The Harbour Road: up the west quay from the Strand, round the head under the square and down the east quay to the docks.",
  [[S.harbourW, S.strand], [S.harbourW, S.harbourHead], [S.harbourE, S.harbourHead], [S.harbourE, S.dock]],
  MAIN,
  "asphalt",
  12,
);
pathRoad("The Strand Road, along the top of the foreshore to the old town's west end.", [[S.harbourW, S.strand], [S.west, S.strand]], STREET, "asphalt");
pathRoad("The Dock Road, behind the cranes, out to the goods yard.", [[S.harbourE, S.dock], [S.station, S.dock]], MAIN, "asphalt");
pathRoad(
  "The West Road: down from the Heights past the High Town and the old town to the Strand. Team 0's road.",
  [[S.west, 124], [S.west, 62], [-124, 52], [-124, -24], [S.west, -34], [S.west, S.strand]],
  MAIN,
  "asphalt",
  14,
);
pathRoad(
  "The Station Road: up from the goods yard past the docks and the east town to the station. Team 1's road.",
  [[S.station, S.dock], [S.station, -44], [112, -34], [112, 26], [S.station, 36], [S.station, 124]],
  MAIN,
  "asphalt",
  14,
);
pathRoad(
  "Fore Street, the old town's high street: up from the harbour head, bending into the High Town.",
  [[S.fore, S.harbourHead], [S.fore, S.market], [S.foreTop, 46], [S.foreTop, S.highW]],
  STREET,
  "asphalt",
  10,
);
pathRoad("Quay Street, up from the east quay past the square to High Street.", [[S.quay, S.harbourHead], [S.quay, S.highMid]], STREET, "asphalt");
pathRoad("Queen Street, north out of the square to High Street.", [[S.queen, SQ.z1], [S.queen, S.highMid]], STREET, "asphalt");
pathRoad("Exchange Street, across the High Town's foot from the West Road to Fore Street.", [[-124, S.exchange], [S.fore, S.exchange]], STREET, "asphalt");
pathRoad("Market Street, along the top of the square.", [[S.fore, S.market], [S.quay, S.market]], STREET, "asphalt");
pathRoad("Station Approach, from Quay Street to the Station Road past the forecourt.", [[S.quay, S.approach], [S.station, S.approach]], STREET, "asphalt");
pathRoad(
  "High Street, the ridge road along the top of the town, jogging at Fore Street and Quay Street.",
  [[S.west, S.highW], [S.foreTop, S.highW], [-48, S.highMid], [36, S.highMid], [S.quay, S.highE], [S.station, S.highE]],
  STREET,
  "asphalt",
  8,
);
pathRoad("Warehouse Lane, across the docks behind the Harbour Board.", [[S.harbourE, S.warehouse], [S.station, S.warehouse]], STREET, "asphalt");
pathRoad("Rope Street, across the east town.", [[S.quay, S.rope], [112, S.rope]], STREET, "asphalt");
pathRoad("Ship Lane, the old town's back lane, from the Strand up to Exchange Street.", [[S.ship, S.strand], [S.ship, S.exchange]], LANE, "cobble");
pathRoad("Fish Lane and Chapel Lane, across the old town.", [[-124, S.fish], [S.fore, S.fish]], LANE, "cobble");
pathRoad(null, [[-124, S.chapel], [S.fore, S.chapel]], LANE, "cobble");

note(placements, "The square's four paths, out from the monument to the kerbs.");
// They stop a hand short of the memorial's bottom step (it reaches 5.5 m).
const STEP = 5.7;
rectRoad(0, (SQ.z1 + STEP) / 2, 0, SQ.z1 - STEP, 4, "cobble");
rectRoad(0, (SQ.z0 - STEP) / 2, 0, -STEP - SQ.z0, 4, "cobble");
rectRoad((SQ.x1 + STEP) / 2, 0, 1, SQ.x1 - STEP, 4, "cobble");
rectRoad((SQ.x0 - STEP) / 2, 0, 1, -STEP - SQ.x0, 4, "cobble");

const network = roadNetwork(roadDefs);
const ROADS = network.footprint;
const onRoadAt = (x, z, pad = 0) => onRoad(ROADS, x, z, pad);

// No road runs into the water.
for (let x = -HALF; x <= HALF; x += 1) {
  for (let z = -HALF; z <= HALF; z += 1) {
    if (onRoadAt(x, z) && wet(x, z, 0)) throw new Error(`road: a carriageway runs into the water at (${x}, ${z})`);
  }
}

// --- what is already there ---------------------------------------------------

/**
 * Everything that has claimed ground, as axis-aligned rectangles. `solid` is
 * a building or a prop, `low` a spawn or a hardstanding (refuses everything),
 * `flag` a flag's ground, and `open` a yard or a square — which refuses a
 * building and nothing else, and which is what a door is allowed to open onto.
 */
const claimed = [];
const refused = [];
const open = [];

const overlaps = makeOverlaps(claimed);

function claim(r, type = "solid", why = "") {
  claimed.push({ ...r, type, note: why });
}

function yard(x0, x1, z0, z1, why) {
  const r = { x0, x1, z0, z1 };
  open.push(r);
  claim(r, "open", why);
}

/**
 * How far the floor falls across a footprint, from its centre's own height —
 * on a 5x5 sample, where the other maps take 3x3.
 */
const relief = makeRelief(floorAt, [0, 0.25, 0.5, 0.75, 1]);

function footOnRoad(r) {
  // Evenly from edge to edge, so the far corners are always sampled.
  const nx = Math.max(2, Math.ceil(r.x1 - r.x0));
  const nz = Math.max(2, Math.ceil(r.z1 - r.z0));
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= nz; j++) {
      if (onRoadAt(r.x0 + ((r.x1 - r.x0) * i) / nx, r.z0 + ((r.z1 - r.z0) * j) / nz, 0.2)) return true;
    }
  }
  return false;
}

const footWet = makeFootWet(wet, 0.35);

const inOpen = (x, z) => open.some((o) => x >= o.x0 && x <= o.x1 && z >= o.z0 && z <= o.z1);
const solidAt = (x, z, self) =>
  claimed.find((c) => c !== self && c.type === "solid" && x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1);

/** The world direction a local face points under a turn, and where its middle is. */
function faceRay(kind, x, z, turn, params, face) {
  const [a, b, c, d] = FOOT[kind](params ?? {});
  const local = { "+z": [[0, 1], [(a + b) / 2, d]], "-z": [[0, -1], [(a + b) / 2, c]], "+x": [[1, 0], [b, (c + d) / 2]], "-x": [[-1, 0], [a, (c + d) / 2]] }[face];
  const [fx, fz] = turnOf(local[0][0], local[0][1], turn);
  const [sx, sz] = turnOf(local[1][0], local[1][1], turn);
  return { fx, fz, sx: x + sx, sz: z + sz };
}

/**
 * Whether a building's ways in open onto somewhere. The FIRST door face has to
 * reach a road, a square or a yard within `reach` before anything solid or the
 * water; every other door face only has to be clear for two metres, which is
 * what stops a back door opening into the back wall of the next row. Null
 * when it does, the reason when it does not.
 */
function doorway(kind, x, z, turn, params, self, reach = 16) {
  const faces = DOOR_FACES[kind];
  if (!faces) return null;
  for (const [i, face] of faces.entries()) {
    const { fx, fz, sx, sz } = faceRay(kind, x, z, turn, params, face);
    const far = i === 0 ? reach : 2;
    let ok = i !== 0;
    for (let t = 0.3; t <= far; t += 0.5) {
      const px = sx + fx * t;
      const pz = sz + fz * t;
      if (i === 0 && (onRoadAt(px, pz) || inOpen(px, pz))) {
        ok = true;
        break;
      }
      const hit = solidAt(px, pz, self);
      if (hit) return `${face} door blocked by ${hit.note || "a claim"} at (${px.toFixed(0)}, ${pz.toFixed(0)})`;
      if (wet(px, pz, 0)) return `${face} door opens onto the water at (${px.toFixed(0)}, ${pz.toFixed(0)})`;
    }
    if (!ok) return `${face} door opens onto nothing`;
  }
  return null;
}

/**
 * Emit one placement, claiming its footprint first. Refused on a claim, on a
 * road, in the water, on a slope and — for a building — on a door that opens
 * onto nothing, unless an option says otherwise.
 */
function place(kind, x, z, turn, params, opts = {}) {
  const r = worldFoot(kind, x, z, turn, params);
  const pad = opts.pad ?? 0.6;
  const why = (() => {
    if (!opts.edgeOk && Math.max(Math.abs(r.x0), Math.abs(r.x1), Math.abs(r.z0), Math.abs(r.z1)) > HALF - 2) return "the edge";
    if (opts.force) return null;
    const prop = PROPS.has(kind);
    const hit = overlaps(r, pad, opts.skip ?? ((c) => (c.type === "open" && prop) || (c.type === "flag" && prop)));
    if (hit) return `a ${hit.type} claim (${hit.note || "?"}) x ${hit.x0.toFixed(1)}..${hit.x1.toFixed(1)} z ${hit.z0.toFixed(1)}..${hit.z1.toFixed(1)}`;
    if (!opts.roadOk && footOnRoad(r)) return "a road";
    if (!opts.wetOk && footWet(r)) return "the water";
    if (!opts.anySlope && relief(r) > (opts.flat ?? (prop ? 0.5 : FLAT))) return `a slope of ${relief(r).toFixed(2)}`;
    return null;
  })();
  if (why) {
    refused.push(`${opts.note ?? kind} (${kind}) at (${x.toFixed(1)}, ${z.toFixed(1)}) turn ${turn}: ${why}`);
    return false;
  }
  const self = opts.noClaim ? null : { ...r, type: "solid", note: opts.note ?? kind };
  if (self) claimed.push(self);
  if (!opts.noDoor && !opts.force) {
    const bad = doorway(kind, x, z, turn, params, self);
    if (bad) {
      if (self) claimed.splice(claimed.indexOf(self), 1);
      refused.push(`${opts.note ?? kind} (${kind}) at (${x.toFixed(1)}, ${z.toFixed(1)}) turn ${turn}: ${bad}`);
      return false;
    }
  }
  emit(kind, x, z, turn, params, opts.y);
  return true;
}

/** A named set piece: place it, and refuse to write the map if it did not fit. */
const must = makeMust(place, refused);

/**
 * A street light on the kerb, its arm (the builder's local +X) out over the
 * carriageway on side `toward`. `lit` spends one of the sixteen light slots;
 * every column carries a lens either way.
 */
function lamp(x, z, toward, lit = false, why = "a street light") {
  const turn = { east: 0, south: 1, west: 2, north: 3 }[toward];
  return place("streetLight", x, z, turn, lit ? { height: 7.5, lit: true } : { height: 7.5 }, {
    pad: 0.2,
    roadOk: true,
    note: why,
    skip: (c) => c.type === "open" || c.type === "flag",
  });
}

/** A car parked against a kerb, nose along the street. */
function car(x, z, alongX, tint) {
  return place("car", x, z, alongX ? (chance(0.5) ? 0 : 2) : chance(0.5) ? 1 : 3, { tint }, {
    pad: 0.3,
    roadOk: true,
    note: "a parked car",
    skip: (c) => c.type === "open" || c.type === "flag",
  });
}

const CAR_PAINT = ["#3f4b52", "#4a4f45", "#6b463a", "#2f3338", "#2f5f9c", "#a8352e", "#c2762a", "#3f7d5a", "#8d3f7a", "#b8a63c", "#d8d4c8", "#5c5340"];

/**
 * A line of cars parked along a street's kerb: `axis` is the street's own
 * direction, `at` the line the cars' centres stand on, `a..b` the run.
 * `fill` is the share of bays taken.
 */
function parking(axis, at, a, b, fill = 0.55) {
  for (let t = Math.min(a, b) + 3; t < Math.max(a, b) - 3; t += 6.2) {
    if (!chance(fill)) continue;
    const [x, z] = axis === "x" ? [t, at] : [at, t];
    car(Number(x.toFixed(1)), Number(z.toFixed(1)), axis === "x", pick(CAR_PAINT));
  }
}

// --- the flags, the homes and the yards claim before any building does -------

/**
 * The five objectives. A, B and E stand INSIDE a building on its walked ground
 * floor, as they always have, and are checked clear of its service core, its
 * stair lanes and its columns by construction (each stands at its building's
 * centre, which every one of those builders leaves open). C stands on the
 * monument's top tier, and D in the open forecourt.
 */
const FLAGS = [
  { id: "A", name: "Alpha", x: -90, z: 66, r: 15, lift: 0.2, inside: true },
  { id: "B", name: "Bravo", x: -74, z: -72, r: 14, lift: 0.2, inside: true },
  // On the monument's top tier, 3.5 m out from the shaft on the line x = z.
  { id: "C", name: "Charlie", x: 2.5, z: 2.5, r: 16, lift: 1.02, inside: true },
  { id: "D", name: "Delta", x: 72, z: 58, r: 14, lift: 0 },
  { id: "E", name: "Echo", x: 82, z: -45, r: 15, lift: 0.2, inside: true },
];
const byId = Object.fromEntries(FLAGS.map((f) => [f.id, f]));
for (const f of FLAGS) {
  if (f.inside) continue;
  claim({ x0: f.x - f.r * 0.5, x1: f.x + f.r * 0.5, z0: f.z - f.r * 0.5, z1: f.z + f.r * 0.5 }, "flag", `flag ${f.id}`);
}

/**
 * The two homes, each in its own corner yard as before: the Valeguard on the
 * Heights at the top of the town, where the West Road starts down the hill,
 * and the Redline in the goods yard at the end of the docks, where the Station
 * Road starts up it. The line between them is the NW-SE diagonal the sun's
 * azimuth is chosen against (`environment.ts`), so neither moved off it.
 */
const HOMES = [
  { team: 0, spawns: [[-145, 134], [-137, 142], [-152, 126]], yaw: "(Math.PI * 3) / 4", hull: [-150, 114], hullYaw: "Math.PI / 2" },
  { team: 1, spawns: [[144, -140], [136, -146], [152, -132]], yaw: "-Math.PI / 4", hull: [138, -126], hullYaw: "-Math.PI / 4" },
];
const spawns = [];
const vehicles = [];
for (const h of HOMES) {
  for (const [x, z] of h.spawns) {
    if (onRoadAt(x, z, 1.2)) throw new Error(`spawn: T${h.team}'s home spawn at (${x}, ${z}) is on a road`);
    claim({ x0: x - 2.5, x1: x + 2.5, z0: z - 2.5, z1: z + 2.5 }, "low", "a home spawn");
    spawns.push(`  { team: ${h.team}, pos: new Vector3(${n2(x)}, ${n2(floorAt(x, z))}, ${n2(z)}), yaw: ${h.yaw} },`);
  }
  const [hx, hz] = h.hull;
  claim({ x0: hx - 5, x1: hx + 5, z0: hz - 5, z1: hz + 5 }, "low", "a hardstanding");
  vehicles.push(`  { team: ${h.team}, pos: new Vector3(${n2(hx)}, ${n2(floorAt(hx, hz))}, ${n2(hz)}), yaw: ${h.hullYaw} },`);
}

/**
 * One spawn per objective, outside its ring, on the side of it that faces the
 * fight it feeds — each on the bearing the old map's spawn had from its flag,
 * because a flag's spawn is where every reinforcement for the NEXT flag starts.
 * C's is on the perpendicular bisector of the two homes, so the flag every
 * round turns on is the same walk back from both.
 */
const FLAG_SPAWNS = [
  ["A", 10, -20, "0"],
  ["B", 0, 22, "Math.PI"],
  ["C", 13.5, 15.4, "(-Math.PI * 3) / 4"],
  ["D", -12, -17, "0.54"],
  ["E", 0, 22, "Math.PI"],
];
const flagSpawns = [];
for (const [id, dx, dz, yaw] of FLAG_SPAWNS) {
  const f = byId[id];
  const x = f.x + dx;
  const z = f.z + dz;
  claim({ x0: x - 2.5, x1: x + 2.5, z0: z - 2.5, z1: z + 2.5 }, "low", `${id}'s spawn`);
  if (wet(x, z)) throw new Error(`spawn: ${id}'s spawn at (${x}, ${z}) is in the water`);
  if (Math.hypot(dx, dz) <= f.r) throw new Error(`spawn: ${id}'s spawn is inside its own ring`);
  flagSpawns.push(`  { team: null, controlPoint: "${id}", pos: new Vector3(${n2(x)}, ${n2(floorAt(x, z))}, ${n2(z)}), yaw: ${yaw} },`);
}

// The open ground every door may open onto: the square, the quaysides, the
// set pieces' yards and the two home yards.
yard(SQ.x0, SQ.x1, SQ.z0, SQ.z1, "the square");
yard(-118, -63, 44.5, 53, "Exchange Square");
yard(-104, -64, 79, 95, "the Exchange garden");
yard(52, 100, 44.5, 72, "the station forecourt");
yard(52, 94, -31.5, -12.5, "the Harbour Board plaza");
yard(52, 114, -75.5, -59, "the Harbour Board's yard");
yard(-160, -60, -152, -136, "the pier");
yard(-132, -96, -136, -111, "the fish quay");
yard(-157, -137.5, 110, 157, "the Heights");
yard(125.5, 157, -152, -121, "the goods yard");
yard(60, 120, -152, -121, "the dock apron");

// --- the waterfront ------------------------------------------------------------

section(placements, "the waterfront");
note(
  placements,
  "**Every quay stands on the line the floor's own cliff is cut on** (`QUAYS`",
  "in the generator, which the heightfield is cut against): a quay hangs DOWN",
  "from the ground at its origin, so the street runs on over the drop. The",
  "runs touch end to end, and where two walls meet the deck of one covers the",
  "corner. The parapet is 1.0 m, under `cover.crouchHeight` — it steers a body",
  "and stops nothing, and a player can hop it into the harbour, which is",
  "wadeable everywhere inside the pier.",
);
for (const q of QUAYS) {
  const len = q.to - q.from;
  const n = Math.ceil(len / 40 - 1e-9);
  const each = len / n;
  const turn = turnFacing(q.water, "-z");
  for (let i = 0; i < n; i++) {
    const along = q.from + each * (i + 0.5);
    const [x, z] = q.axis === "x" ? [along, q.at] : [q.at, along];
    must("quay", Number(x.toFixed(2)), Number(z.toFixed(2)), turn, { length: Number(each.toFixed(2)) }, {
      force: true,
      edgeOk: true,
      note: q.name,
    });
    claim(worldFoot("quay", x, z, turn, { length: each }), "solid", q.name);
  }
}

note(
  placements,
  "THE HARBOUR LIGHT, on the pier head with its keeper's cottage turned back",
  "along the pier toward the town. Not climbable (see `kit/harbour.ts`): a",
  "gallery over a harbour every flag can see is a perch with no counter. It is",
  "one of the sixteen light slots, always, and the one every bearing in the",
  "town has a line to.",
);
must("lighthouse", -71, -145, turnFacing("west", "-z"), null, { note: "the harbour light", skip: (c) => c.type === "open" });

note(
  placements,
  "The boats, lying over on the mud at low water — the strongest thing on the",
  "map saying what the map is. Each one is solid and is cover a body wading",
  "the harbour can reach.",
);
for (const [x, z, turn, len] of [
  [-28, -66, 0, 11],
  [-27, -86, 0, 9],
  [-8, -48, 1, 12],
  [16, -62, 0, 10],
  [20, -92, 0, 11],
  [-14, -112, 1, 12],
  [-50, -122, 1, 9],
  [8, -130, 0, 10],
]) {
  place("careenedHull", x, z, turn, { length: len }, { wetOk: true, anySlope: true, note: "a boat on the mud" });
}
// Two hauled out on the Hard, above the waterline.
place("careenedHull", 52, -134, 0, { length: 12 }, { anySlope: true, wetOk: true, note: "a boat on the Hard" });
place("careenedHull", 46, -146, 1, { length: 10 }, { anySlope: true, wetOk: true, note: "a boat on the Hard" });

note(placements, "Jetties off the two foreshores, their decks level with the beach top.");
{
  // The deck stands 0.57 over the placement's own ground, and `y` lifts it to
  // the beach's level so the shore end steps on and the head stands over water.
  const jetty = (x, z, turn, len, deck, why) => {
    const y = Number((deck - 0.57 - floorAt(x, z)).toFixed(2));
    return place("jetty", x, z, turn, { length: len }, { wetOk: true, anySlope: true, y, note: why, pad: 0.3 });
  };
  jetty(-66, -111, 0, 18, floorAt(-66, -101.5), "the Strand jetty");
  jetty(-84, -118, 0, 14, floorAt(-84, -110), "the Strand jetty");
}

// --- the square ----------------------------------------------------------------

section(placements, "C: the civic square");
note(
  placements,
  "The square at the head of the harbour: a lawn with four paths to the",
  "memorial in the middle of it, four stands of trees for cover, and the Town",
  "Hall and two terraces of shops turned to face it. It opens onto the",
  "harbour on its fourth side, so the quay is part of the fight for it.",
);
must("monument", 0, 0, 0, { width: 11 }, { force: true, note: "the memorial" });
for (const [x, z, t] of [[-15, 5.5, 0], [15, -6.5, 0], [6, 15, 1], [-6.5, -14, 1]]) {
  place("planter", x, z, t, { width: 2.6, depth: 1.4 }, { note: "a planter", pad: 0.2 });
}
place("barrier", -12.5, -11, 1, { length: 6 }, { note: "a barrier", pad: 0.2 });
place("barrier", 11, 12, 1, { length: 6 }, { note: "a barrier", pad: 0.2 });
lamp(-3.2, 21.5, "east", true, "the square's lamp");
lamp(3.2, -14.5, "west", true, "the square's lamp");
lamp(-20.5, 3.2, "south", true, "the square's lamp");
lamp(20.5, -3.2, "north", true, "the square's lamp");

// --- the rows -------------------------------------------------------------------

/**
 * A row of buildings along a street, every one turned to it. `kerb` is the
 * kerb's coordinate (or a square's edge), `a..b` the run along it, and `face`
 * the world direction the row's fronts look in — toward the street. `recipe`
 * is `[kind, weight, params(depth)]` entries; `depth`, when given, is the
 * deepest a building in this row may be, which is how a block's four rows are
 * fitted back to back. `gap` is what is left between neighbours (0 is a
 * terrace, party wall to party wall).
 */
function row(kerb, a, b, face, recipe, opts = {}) {
  const alongX = face === "north" || face === "south";
  const setback = opts.setback ?? 1.4;
  const total = recipe.reduce((s, k) => s + k[1], 0);
  let t = Math.min(a, b);
  const end = Math.max(a, b);
  let n = 0;
  let misses = 0;
  let depthUsed = 0;
  while (t < end - 4 && misses < 40) {
    let roll = rng() * total;
    let spec = recipe[0];
    for (const k of recipe) {
      roll -= k[1];
      if (roll <= 0) {
        spec = k;
        break;
      }
    }
    let [kind, , make] = spec;
    let params = make(opts.depth);
    // A shophouse's stair needs a 15 m plate (`laneFlight`); a plot too
    // shallow for one gets the low brick commercial block instead.
    if (kind === "shophouse" && params.depth < SHOP_MIN_DEPTH) {
      kind = "tower";
      params = { width: params.width, depth: Number(Math.max(8, params.depth).toFixed(1)), height: Number(rand(9, 15).toFixed(0)) };
    }
    const front = kind === "townhouse" || kind === "cottage" || kind === "netLoft" || kind === "tavern" ? "-z" : "+z";
    const turn = turnFacing(face, front);
    let r = worldFoot(kind, 0, 0, turn, params);
    let w = alongX ? r.x1 - r.x0 : r.z1 - r.z0;
    if (t + w > end + 0.01) {
      // The last plot in a row is cut to the room left, as a real terrace's
      // end house is, rather than leaving the corner empty.
      const narrowest = MIN_WIDTH[kind];
      const cut = params.width !== undefined && narrowest !== undefined ? params.width - (t + w - end) : -1;
      if (cut < (narrowest ?? Infinity)) {
        t += 1;
        misses++;
        continue;
      }
      params.width = Number(cut.toFixed(1));
      r = worldFoot(kind, 0, 0, turn, params);
      w = alongX ? r.x1 - r.x0 : r.z1 - r.z0;
    }
    const along = t - (alongX ? r.x0 : r.z0);
    const sb = setback + (opts.jitter ? rand(0, opts.jitter) : 0);
    let across;
    if (face === "south") across = kerb + sb - r.z0;
    else if (face === "north") across = kerb - sb - r.z1;
    else if (face === "west") across = kerb + sb - r.x0;
    else across = kerb - sb - r.x1;
    const [x, z] = alongX ? [along, across] : [across, along];
    if (place(kind, Number(x.toFixed(2)), Number(z.toFixed(2)), turn, params, { pad: opts.pad ?? 0.05, note: opts.note ?? kind })) {
      n++;
      depthUsed = Math.max(depthUsed, alongX ? r.z1 - r.z0 : r.x1 - r.x0);
      t += w + (opts.gap ?? 0) + (opts.gaps ? rand(0, opts.gaps) : 0);
      misses = 0;
    } else {
      t += 1;
      misses++;
    }
  }
  return depthUsed;
}

/**
 * The shallowest plate a shophouse's stair fits in: a 10.3 m flight and the
 * 2.4 m landing have to fit inside half the depth less a wall
 * (`laneFlight`), which the builder THROWS on in a dev build.
 */
const SHOP_MIN_DEPTH = 15.6;

/** The narrowest a row's end plot may be cut to, by kind. */
const MIN_WIDTH = { shophouse: 9, tower: 12, townhouse: 5.4, cottage: 5.8 };

/**
 * A BLOCK: the ground between four kerbs, lined on every side it is given a
 * recipe for, every building turned to its own street. **The corners belong
 * to the north and south rows**, which run the block's full width; the east
 * and west rows run between them, so no corner is two buildings backing onto
 * each other. Each row's buildings are held to a depth that leaves `yard`
 * metres of back court between it and the row behind, which is where the bins
 * and the skips go.
 */
function block(name, b, sides, opts = {}) {
  const sb = opts.setback ?? 1.4;
  const yardGap = opts.yard ?? 4;
  const halfZ = (b.z1 - b.z0) / 2 - sb - yardGap / 2;
  const halfX = (b.x1 - b.x0) / 2 - sb - yardGap / 2;
  const deep = (max) => Math.min(max ?? 99, sides.north && sides.south ? halfZ : b.z1 - b.z0 - sb - yardGap);
  const wide = (max) => Math.min(max ?? 99, sides.east && sides.west ? halfX : b.x1 - b.x0 - sb - yardGap);
  const common = { setback: sb, note: name, gap: opts.gap ?? 0, gaps: opts.gaps };
  // The end rows start past the depth the long rows actually reached.
  const sDepth = sides.south ? row(b.z0, b.x0, b.x1, "south", sides.south, { ...common, depth: deep(sides.southDepth ?? opts.depth) }) : 0;
  const nDepth = sides.north ? row(b.z1, b.x0, b.x1, "north", sides.north, { ...common, depth: deep(sides.northDepth ?? opts.depth) }) : 0;
  const za = b.z0 + (sDepth ? sDepth + sb + 0.4 : 0);
  const zb = b.z1 - (nDepth ? nDepth + sb + 0.4 : 0);
  const wDepth = sides.west ? row(b.x0, za, zb, "west", sides.west, { ...common, depth: wide(sides.westDepth ?? opts.depth) }) : 0;
  const eDepth = sides.east ? row(b.x1, za, zb, "east", sides.east, { ...common, depth: wide(sides.eastDepth ?? opts.depth) }) : 0;
  // What is left in the middle is the block's back court.
  courts.push({
    name,
    x0: b.x0 + (wDepth ? wDepth + sb : 0),
    x1: b.x1 - (eDepth ? eDepth + sb : 0),
    z0: b.z0 + (sDepth ? sDepth + sb : 0),
    z1: b.z1 - (nDepth ? nDepth + sb : 0),
  });
}
/** Every block's back court, for the bins and the skips. */
const courts = [];

const BLINDS = ["#5c5340", "#7c4a3f", "#4a5a4a", "#3f4b52", "#6b4a2f", "#2f4a5c", "#6a3a3a", "#55603c"];
const SIGNS = ["#ff5f7a", "#4fd6ff", "#ffc63c", "#7dff9e", "#ff7a3c", "#c46cff", "#39e0d0", "#ff4f4f"];
/** How many shophouses may still light their windows: three slots each. */
let litShops = 4;
/**
 * A shophouse, at most `depth` deep. Two storeys is the older rendered stock
 * and three the later brick (`buildShophouse` picks the skin off the count),
 * so a terrace written as a run of these comes out mixed by itself.
 */
const shop = (o = {}) => (depth) => {
  const d = Math.min(depth ?? 16, o.depth ?? 16);
  const p = {
    width: Number(rand(o.w0 ?? 11, o.w1 ?? 14).toFixed(1)),
    depth: Number((d >= SHOP_MIN_DEPTH ? Math.max(SHOP_MIN_DEPTH, d - rand(0, 1.2)) : d).toFixed(1)),
    floors: chance(o.tall ?? 0.5) ? 3 : 2,
    tint: pick(BLINDS),
  };
  if (chance(o.signs ?? 0.6)) p.sign = pick(SIGNS);
  if (litShops > 0 && chance(o.lit ?? 0)) {
    p.litWindows = true;
    litShops--;
  }
  return p;
};
const tower = (o = {}) => (depth) => ({
  width: Number(rand(o.w0 ?? 18, o.w1 ?? 26).toFixed(0)),
  depth: Number(Math.min(depth ?? 99, o.depth ?? rand(o.d0 ?? 16, o.d1 ?? 24)).toFixed(0)),
  height: Number(rand(o.h0 ?? 14, o.h1 ?? 40).toFixed(0)),
});
const townhouse = (o = {}) => () => ({
  width: Number(rand(6, 7.2).toFixed(1)),
  depth: Number(rand(6.2, 7).toFixed(1)),
  ...(chance(o.enterable ?? 0.45) ? { enterable: true } : {}),
  ...(chance(o.lit ?? 0.3) ? { litWindows: true } : {}),
});
const cottage = (o = {}) => () => ({
  width: Number(rand(6.5, 8).toFixed(1)),
  depth: Number(rand(5.6, 6.4).toFixed(1)),
  ...(chance(o.enterable ?? 0.4) ? { enterable: true } : {}),
  ...(chance(o.lit ?? 0.25) ? { litWindows: true } : {}),
});
/** The fishermen's houses of the old town: narrow, jettied, packed. */
const COTTAGES = [["townhouse", 4, townhouse()], ["cottage", 1, cottage()]];
const SHOPS = (o) => [["shophouse", 1, shop(o)]];
const TOWERS = (o) => [["tower", 1, tower(o)]];

// --- the square's frontages -------------------------------------------------------

note(placements, "The Town Hall, at the square's north-west corner, its lobby to the square.");
must("tower", -34.4, 13.5, turnFacing("east"), { width: 18, depth: 17, height: 24 }, { note: "the Town Hall" });
row(SQ.x0, -12, 4, "east", SHOPS({ tall: 0.6, lit: 0.4 }), { note: "the square, west side", depth: 16 });
row(SQ.x1, -12, SQ.z1, "west", SHOPS({ tall: 0.5, lit: 0.3 }), { note: "the square, east side", depth: 16, setback: 0.8 });

// --- the old town -------------------------------------------------------------------

section(placements, "B: the old town");
note(
  placements,
  "The oldest part of the town, behind the west quay: the car park on the old",
  "fish market's site, the Mariners' Church at the top of Ship Lane, the",
  "Anchor on the Strand, and lanes of fishermen's houses packed between them.",
  "B is the car park, and its approaches are covered on every side — the",
  "Strand's terrace, the lanes and the quay — which is what makes it the",
  "brawl the harbour's open water beside it is not.",
);
must("parkade", -74, -72, 0, { width: 32, depth: 22, floors: 3 }, { note: "the harbour car park", noDoor: true });
must("chapel", -108.75, 15.2, turnFacing("south", "-z"), null, { note: "the Mariners' Church", flat: 1.0 });
note(placements, "The Anchor, on the Strand, its door to the harbour across the road.");
must("tavern", -110, -81.6, turnFacing("south", "-z"), null, { note: "the Anchor" });

// The fishermen's quarter between the West Road and Ship Lane.
block("Fish Lane", { x0: -126.5, x1: -99, z0: -91.5, z1: -53 }, { north: COTTAGES, west: COTTAGES, east: COTTAGES }, { setback: 1.0, yard: 3, gaps: 0.5 });
block("Chapel Lane", { x0: -118.5, x1: -99, z0: -47, z1: -3 }, { north: COTTAGES, south: COTTAGES, west: COTTAGES, east: COTTAGES }, { setback: 1.0, yard: 2, gaps: 0.5 });
// The shops round the old town's middle block, Fore Street's lower end.
block("Fore Street", { x0: -93, x1: -54.5, z0: -47, z1: -3 }, {
  north: SHOPS({ tall: 0.4, lit: 0.3 }),
  south: SHOPS({ tall: 0.4 }),
  west: COTTAGES,
  east: SHOPS({ tall: 0.6, lit: 0.3 }),
}, { yard: 4 });
block("Chapel Lane", { x0: -93, x1: -54.5, z0: 3, z1: 24 }, { south: SHOPS({ tall: 0.5 }), east: SHOPS({ tall: 0.6 }) }, { yard: 3 });
// The West Road's west side, outside the old town.
row(-137.5, -90, -38, "east", COTTAGES, { note: "the West Road", setback: 1.4, gaps: 1.2 });
row(-129.5, -18, 40, "east", SHOPS({ tall: 0.4 }), { note: "the West Road", depth: 16 });
row(-137.5, 64, 106, "east", SHOPS({ tall: 0.6 }), { note: "the West Road", depth: 16 });

// --- the Ness: the fish quay and the pier ---------------------------------------

section(placements, "the Ness");
note(
  placements,
  "The working end of the harbour, on the low ground between the Strand and",
  "the pier: net lofts along the Strand Road, drying racks on the fish quay,",
  "the boat shed at the pier root, and the boats drawn up on the shingle.",
);
row(-100.5, -130, -100, "north", [["netLoft", 1, () => ({ width: Number(rand(8, 10).toFixed(1)), depth: 7 })]], { note: "a net loft", setback: 2.5, gap: 2.5 });
must("depot", -141, -122, turnFacing("east"), { width: 20, depth: 16, height: 7 }, { note: "the boat shed" });
for (const [x, z, t] of [[-118, -114, 0], [-118, -120, 0], [-130, -116, 0], [-128, -126, 0]]) {
  place("fishRack", x, z, t, { length: 9 }, { note: "a drying rack", pad: 0.6 });
}
for (const [x, z] of [[-128, -114], [-111, -132], [-96, -138]]) place("crates", x, z, 0, null, { note: "crates", pad: 0.5 });

// --- the High Town ------------------------------------------------------------------

section(placements, "A: the Exchange");
note(
  placements,
  "The Exchange, on its own square at the top of Fore Street: three walked",
  "floors and a window band on three bearings over the High Town, with the",
  "square in front of it and the garden behind. Every street into the High",
  "Town climbs to it.",
);
must("office", -90, 66, 0, { width: 30, depth: 24, floors: 3, litWindows: true }, { note: "the Exchange" });
row(-126.5, 62, 96, "west", TOWERS({ w0: 12, w1: 16, depth: 14, h0: 12, h1: 24 }), { note: "the High Town", gap: 2 });
row(-62.5, 56, 94, "west", SHOPS({ depth: 9, w0: 10, w1: 12, tall: 0.7 }), { note: "Fore Street", setback: 1.2 });

// --- midtown ------------------------------------------------------------------------

section(placements, "midtown");
note(
  placements,
  "The commercial blocks between the square and High Street: the tall stock,",
  "on the hill, so the skyline climbs away from the water. Every block is",
  "lined on all four sides, the corners to the long streets.",
);
block("Market Street", { x0: -53.5, x1: -4.5, z0: 41, z1: 103.5 }, {
  south: [["tower", 2, tower({ w0: 18, w1: 24, h0: 22, h1: 44 })], ["shophouse", 1, shop({ tall: 0.8 })]],
  north: TOWERS({ w0: 18, w1: 24, h0: 24, h1: 46 }),
  west: SHOPS({ tall: 0.7 }),
  east: SHOPS({ tall: 0.7, lit: 0.2 }),
}, { yard: 4, gap: 1.2 });
block("Queen Street", { x0: 4.5, x1: 41.5, z0: 41, z1: 103.5 }, {
  south: [["tower", 2, tower({ w0: 16, w1: 20, h0: 18, h1: 40 })], ["shophouse", 1, shop({ tall: 0.8 })]],
  north: TOWERS({ w0: 16, w1: 20, h0: 20, h1: 38 }),
  west: SHOPS({ tall: 0.7 }),
  east: SHOPS({ tall: 0.7 }),
}, { yard: 4, gap: 1.2 });

// --- the station ----------------------------------------------------------------

section(placements, "D: the Terminal");
note(
  placements,
  "The railway terminus at the top of the docks: the train shed with its",
  "arches to the forecourt, the taxi rank, and no interior to the flag at all.",
  "The fast flag, and the open one.",
);
must("depot", 83, 84, turnFacing("south"), { width: 44, depth: 20, height: 9, litWindows: true }, { note: "the train shed" });
row(114.5, 46, 72, "east", SHOPS({ depth: 12 }), { note: "the Station Road" });
for (const [x, z, t] of [[60, 66, 0], [86, 52, 0], [96, 64, 1]]) place("planter", x, z, t, { width: 2.6, depth: 1.4 }, { note: "a planter", pad: 0.3 });
place("barrier", 78, 47, 1, { length: 9 }, { note: "a barrier", pad: 0.3 });
for (const [x, z, t] of [[64, 50, 0], [70, 50, 0], [103, 54, 1], [103, 61, 1]]) {
  place("car", x, z, t, { tint: pick(CAR_PAINT) }, { note: "a taxi", pad: 0.3 });
}
lamp(56, 70, "east", true, "the forecourt's lamp");
lamp(98, 50, "west", true, "the forecourt's lamp");

// --- the east town ----------------------------------------------------------------

section(placements, "the east town");
block("Rope Street", { x0: 50.5, x1: 106.5, z0: -3.5, z1: 35.5 }, {
  north: [["shophouse", 3, shop({ tall: 0.6, lit: 0.3 })], ["tower", 1, tower({ w0: 16, w1: 20, h0: 12, h1: 30 })]],
  south: [["shophouse", 3, shop({ tall: 0.5 })], ["tower", 1, tower({ w0: 16, w1: 20, h0: 12, h1: 26 })]],
  west: SHOPS({ tall: 0.5 }),
  east: SHOPS({ tall: 0.5 }),
}, { yard: 4 });

// --- the docks ------------------------------------------------------------------------

section(placements, "E: the Harbour Board");
note(
  placements,
  "The Harbour Board's offices at the head of the docks: three walked floors",
  "over its plaza on Rope Street, its yard on Warehouse Lane and the quay. The",
  "flag is in the building; the plaza in front of it is the open ground an",
  "attacker from the town has to cross.",
);
must("office", 82, -45, 0, { width: 28, depth: 24, floors: 3, litWindows: true }, { note: "the Harbour Board" });
// The plaza's furniture: the cover an attacker from the town crosses between.
for (const [x, z, t] of [[60, -26, 0], [74, -20, 1], [88, -27, 0], [66, -16, 0]]) {
  place("planter", x, z, t, { width: 2.6, depth: 1.4 }, { note: "a planter", pad: 0.3 });
}
place("barrier", 81, -18, 1, { length: 6 }, { note: "a barrier", pad: 0.3 });
row(106.5, -32, -14, "east", SHOPS({ depth: 10, w0: 10, w1: 11 }), { note: "the Station Road" });
row(51.5, -58, -33, "west", TOWERS({ w0: 22, w1: 24, depth: 11, h0: 12, h1: 16 }), { note: "the bonded store", setback: 1 });

section(placements, "the docks");
note(placements, "Warehouses on the Dock Road, their loading bays to the cranes.");
must("depot", 67, -98, turnFacing("south"), { width: 28, depth: 16, litWindows: true }, { note: "a warehouse" });
must("depot", 99, -98, turnFacing("south"), { width: 26, depth: 16 }, { note: "a warehouse" });
must("crane", 76, -146, 0, null, { note: "a dock crane", skip: (c) => c.type === "open" });
must("crane", 108, -146, 0, null, { note: "a dock crane", skip: (c) => c.type === "open" });
for (const [x, z] of [[62, -132], [88, -128], [94, -142], [122, -132], [57, -142]]) {
  place("crates", x, z, Math.floor(rng() * 4), null, { note: "cargo", pad: 0.6, skip: (c) => c.type === "open" });
}
// The east edge, facing the Station Road from outside it.
row(125.5, -108, -46, "west", [["depot", 1, () => ({ width: Number(rand(20, 26).toFixed(0)), depth: 16 })]], { note: "a goods shed", gap: 4 });
row(117.5, -6, 24, "west", TOWERS({ w0: 16, w1: 22, depth: 18, h0: 12, h1: 30 }), { note: "the Station Road", gap: 3 });
row(125.5, 40, 100, "west", TOWERS({ w0: 16, w1: 22, depth: 18, h0: 14, h1: 34 }), { note: "the Station Road", gap: 3 });

// --- the ridge --------------------------------------------------------------------

section(placements, "the ridge");
note(placements, "High Street's north side, the tallest stock on the highest ground.");
row(104.5, -124, -62, "south", TOWERS({ w0: 18, w1: 24, d0: 18, d1: 26, h0: 16, h1: 36 }), { note: "High Street", gap: 3 });
row(112.5, -46, 36, "south", TOWERS({ w0: 18, w1: 26, d0: 18, d1: 26, h0: 18, h1: 42 }), { note: "High Street", gap: 3 });
row(104.5, 50, 113, "south", TOWERS({ w0: 18, w1: 24, d0: 18, d1: 26, h0: 14, h1: 34 }), { note: "High Street", gap: 3 });
row(125.5, 106, 128, "west", TOWERS({ w0: 16, w1: 22, depth: 20, h0: 14, h1: 30 }), { note: "the Station Road", gap: 3 });

// --- the street, as furnished ---------------------------------------------------

section(placements, "the street, as furnished");
note(
  placements,
  "**Every column carries a LENS and only the ones marked `lit` carry a",
  "LIGHT** — the sixteen-slot budget made concrete, not a statement about",
  "which lamps are on. The lit ones are where a body stands at a flag: the",
  "square's four, the forecourt's two, and one each at A, B and E. Each",
  "stands on the kerb with its arm out over the carriageway.",
);
// The flags' own lit lamps.
lamp(-63.2, 52, "east", true, "the Exchange's lamp");
lamp(-56.4, -86, "east", true, "the car park's lamp");
lamp(78, -13.2, "north", true, "the Harbour Board's lamp");
// Along the quays, on the water side of the Harbour Road.
for (const z of [-86, -62, -40]) lamp(-43.6, z, "west", false, "a quay lamp");
for (const x of [-30, -6, 18]) lamp(x, -34, "north", false, "a quay lamp");
for (const z of [-40, -66, -92]) lamp(39.4, z, "east", false, "a quay lamp");
for (const x of [66, 96]) lamp(x, -122.4, "north", false, "a dock lamp");
for (const x of [-118, -80]) lamp(x, -90.6, "south", false, "a lamp on the Strand");
// Up through the town.
for (const z of [-4, 22]) lamp(-44.6, z, "west", false, "a lamp on Fore Street");
for (const z of [62, 86]) lamp(-52.6, z, "west", false, "a lamp on Fore Street");
for (const z of [50, 78]) lamp(5.4, z, "west", false, "a lamp on Queen Street");
for (const z of [6, 60, 92]) lamp(51.4, z, "west", false, "a lamp on Quay Street");
for (const x of [-100, -78]) lamp(x, 104.6, "south", false, "a lamp on High Street");
for (const x of [-20, 16]) lamp(x, 112.6, "south", false, "a lamp on High Street");
for (const x of [70, 100]) lamp(x, 104.6, "south", false, "a lamp on High Street");
for (const z of [-90, -60, 0, 60, 96]) lamp(z < -40 || z > 30 ? 126.1 : 118.1, z, "west", false, "a lamp on the Station Road");
for (const z of [-80, -50, 10, 80, 110]) lamp(z > -30 && z < 50 ? -130.1 : -138.1, z, "east", false, "a lamp on the West Road");

note(placements, "Parked cars, nose along the kerb: one side of a through road only, so a hull still has the other.");
parking("x", -21.6, -40, 40, 0.5);
parking("z", -53.4, -16, 28, 0.5);
parking("z", 42.6, -16, 28, 0.45);
parking("z", 42.6, 46, 100, 0.5);
parking("z", -3.4, 30, 100, 0.45);
parking("x", 30.6, -44, 40, 0.45);
parking("x", 104.6, -44, 32, 0.4);
parking("z", 124.4, -104, -50, 0.4);
parking("z", 124.4, 46, 96, 0.45);
parking("z", -127.6, 66, 96, 0.45);
parking("x", -4.6, 54, 104, 0.4);
parking("x", -76.6, 54, 114, 0.45);
parking("x", 43.4, -118, -64, 0.45);
parking("x", 36.6, 54, 112, 0.45);
parking("x", -92.6, -126, -100, 0.4);

note(placements, "The fish market on the head quay, its counters to the road.");
for (const x of [-28, -18, 10, 20]) place("stall", x, -33.6, 2, null, { note: "a fish stall", pad: 0.4, roadOk: false });
for (const [x, z] of [[-42.4, -50], [-42.6, -76], [38.6, -58], [38.4, -100], [-4, -33.4]]) {
  place("crates", x, z, 1, null, { note: "cargo on the quay", pad: 0.4 });
}

// --- the dressing ---------------------------------------------------------------

/**
 * Whether a region may be sown at (x, z): its whole extent dry, clear of every
 * building and yard it should not fill, and under `maxGrade`.
 */
function rectOk(x, z, w, d, maxGrade = 0.3, skip = (c) => c.type === "open" || c.type === "flag" || c.type === "low") {
  const box = { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 };
  if (Math.max(Math.abs(box.x0), Math.abs(box.x1), Math.abs(box.z0), Math.abs(box.z1)) > HALF - 2) return "the edge";
  const hit = overlaps(box, 0.6, skip);
  if (hit) return hit.note || hit.type;
  for (const fx of [0, 0.25, 0.5, 0.75, 1]) {
    for (const fz of [0, 0.25, 0.5, 0.75, 1]) {
      const px = box.x0 + fx * w;
      const pz = box.z0 + fz * d;
      if (wet(px, pz, 0.4)) return "the water";
      if (grade(px, pz) > maxGrade) return "a slope";
    }
  }
  return null;
}
const { disc, rectRegion } = makeScatter(scatter, regions);
/** A region checked first; a refusal is reported, never silently dropped. */
function sow(prop, x, z, w, d, count, extra, opts = {}) {
  const why = rectOk(x, z, w, d, opts.grade ?? 0.3, opts.skip);
  if (!why) rectRegion(prop, x, z, w, d, count, extra);
  else if (!opts.quiet) console.log(`  WARNING: ${prop} at (${x}, ${z}) refused: ${why}`);
}
const ASH = ", scale: [0.85, 1.15], blocking: true, clearance: 4";
const LITTER = ", scale: [0.8, 1.3], clearance: 3.5";

section(scatter, "the square's trees");
note(
  scatter,
  "One stand per quarter of the lawn, clear of the paths and the memorial —",
  "the only cover on C that is not furniture, and the reason the square is",
  "crossable at all. Ash, not the pines the business district planted:",
  "this is a harbour town's municipal square.",
);
/**
 * What dressing may be sown among: everything but a BUILDING. A prop, a lamp
 * or a parked car is a claim the builder's own burial test already steps a
 * scattered prop round, so refusing a whole region for one is a refusal of the
 * look rather than a guard.
 */
const loose = (c) => c.type !== "solid" || (c.x1 - c.x0) * (c.z1 - c.z0) < 30;
for (const [x, z, w, d] of [[13.5, 15.5, 15, 15], [-13.5, 15.5, 15, 15], [-14.5, -11.5, 14, 9], [14.5, -11.5, 14, 9]]) {
  sow("ashTree", x, z, w, d, 4, ASH, { skip: loose });
}

section(scatter, "the gardens and the churchyard");
sow("ashTree", -84, 87, 34, 12, 7, ASH);
sow("ashTree", 73, -24, 34, 10, 4, ASH, { skip: loose });
sow("ashTree", -152, -104, 8, 6, 2, ASH);
sow("gravestone", -108.75, 34, 12, 2, 6, ", scale: [0.8, 1.2], blocking: true, clearance: 0.7");

section(scatter, "the working waterfront");
note(
  scatter,
  "Barrels on the quaysides and pallets on the dock apron: what a working",
  "harbour leaves lying about, and what a body crossing one ducks behind.",
);
sow("barrel", -42.2, -66, 3, 20, 4, ", scale: [0.9, 1.1], blocking: true, clearance: 0.6", { skip: loose });
sow("barrel", 36, -82, 3, 20, 4, ", scale: [0.9, 1.1], blocking: true, clearance: 0.6", { skip: loose });
sow("barrel", -116, -128, 10, 6, 5, ", scale: [0.9, 1.1], blocking: true, clearance: 0.6", { skip: loose });
sow("palletStack", 92, -134, 10, 6, 4, ", scale: [0.9, 1.2], blocking: true, clearance: 1.6", { skip: loose });
sow("barrel", 64, -138, 10, 8, 6, ", scale: [0.9, 1.1], blocking: true, clearance: 0.6", { skip: loose });
sow("palletStack", 118, -142, 10, 10, 4, ", scale: [0.9, 1.2], blocking: true, clearance: 1.6", { skip: loose });
sow("palletStack", 140, -114, 12, 8, 3, ", scale: [0.9, 1.2], blocking: true, clearance: 1.6", { skip: loose });
sow("barrel", 70, -86.5, 26, 2.5, 4, ", scale: [0.9, 1.1], blocking: true, clearance: 0.6", { skip: loose });

section(scatter, "the back closes");
note(scatter, "Skips and bins behind the rows, where a town actually accumulates.");
const BINS = ", scale: [0.9, 1.15], blocking: true, clearance: 1.4";
const SKIP = ", scale: [0.9, 1.1], blocking: true, clearance: 2.4";
for (const c of courts) {
  // A metre in from the backs, so a bin is never against a back door. A court
  // with a set piece standing in it (the Anchor's yard) is refused quietly.
  const w = c.x1 - c.x0 - 2;
  const d = c.z1 - c.z0 - 2;
  if (w < 2.5 || d < 2.5) continue;
  const x = (c.x0 + c.x1) / 2;
  const z = (c.z0 + c.z1) / 2;
  const area = w * d;
  sow("binPair", Number(x.toFixed(1)), Number(z.toFixed(1)), Number(w.toFixed(1)), Number(d.toFixed(1)), Math.max(1, Math.min(4, Math.round(area / 60))), BINS, { skip: loose, quiet: true });
  if (area > 120) sow("skip", Number(x.toFixed(1)), Number(z.toFixed(1)), Number(w.toFixed(1)), Number(d.toFixed(1)), 1, SKIP, { skip: loose, quiet: true });
}

section(scatter, "litter");
note(
  scatter,
  "Banked against the kerbs and blown into the corners: no collider, no nav",
  "cost and nothing to any ray, laid straight over the flags where it falls.",
);
for (const [x, z, w, d, n] of [
  [-50, -60, 12, 60, 12],
  [-2, -26, 80, 10, 14],
  [46, -70, 12, 80, 12],
  [-50, 4, 10, 56, 8],
  [0, 66, 10, 70, 8],
  [46, 66, 10, 70, 8],
  [80, -116, 70, 10, 8],
  [-90, -96, 80, 9, 10],
  [0, 4, 44, 40, 10],
  [80, 40, 60, 9, 6],
  [-90, 40, 60, 9, 6],
]) {
  rectRegion("litter", x, z, w, d, n, LITTER);
}

// --- the country beyond the play square -------------------------------------------

const BORDERLAND = `
  // ===== THE COUNTRY OUTSIDE THE TOWN ========================================
  // Appended LAST, and the order is mechanical: every region draws from one
  // seeded stream in array order, so a region spliced in above re-rolls every
  // one below it.
  //
  // **This is the borderland, and it is here because a flat margin reads as a
  // backdrop rather than as distance** — Harrowmead's finding. The hills are
  // the horizon, but a \`downs\` face is ONE unbroken surface a hundred metres
  // tall, and the 180 m of plain in front of it is another; trees sown in
  // front of a slope are what give the slope a scale.
  //
  // **None of it BLOCKS, and that is a rule rather than a saving.** Out here a
  // collider would be geometry outside the nav grid that the bots can neither
  // see nor route around, and something to catch a player sprinting home
  // against the leash's countdown. Non-blocking scatter emits no collider and
  // no \`WorldBox\`, so the baked collision set is unchanged by every tree here.
  //
  // **It is not a RING**, for Greyfen's reason: a continuous belt round a town
  // is a town in a clearing. Each side gets two or three stands with open
  // ground between them, starting about forty metres past the play square.
  // The southern quadrant gets none at all: it is the sea.
  { prop: "pine", x: -232, z: 268, width: 150, depth: 96, count: 80, scale: [0.9, 1.4], clearance: 1.2 },
  { prop: "pine", x: -40, z: 292, width: 170, depth: 84, count: 70, scale: [0.9, 1.4], clearance: 1.2 },
  { prop: "pine", x: 196, z: 276, width: 190, depth: 104, count: 95, scale: [0.9, 1.4], clearance: 1.2 },
  { prop: "pine", x: -288, z: 96, width: 92, depth: 210, count: 85, scale: [0.9, 1.4], clearance: 1.2 },
  { prop: "pine", x: -274, z: -86, width: 110, depth: 106, count: 55, scale: [0.9, 1.4], clearance: 1.2 },
  { prop: "pine", x: 286, z: 30, width: 96, depth: 250, count: 100, scale: [0.9, 1.4], clearance: 1.2 },
  { prop: "pine", x: 268, z: -94, width: 120, depth: 92, count: 50, scale: [0.9, 1.4], clearance: 1.2 },
  { prop: "pine", x: 96, z: 236, radius: 24, count: 15, scale: [0.85, 1.25], clearance: 1.2 },
  { prop: "pine", x: -150, z: 228, radius: 20, count: 11, scale: [0.85, 1.25], clearance: 1.2 },
  // Broadleaf on the near ground, where the town's own gardens run out into
  // the country: the same ash the square is planted with.
  { prop: "ashTree", x: -226, z: -20, radius: 30, count: 12, scale: [0.9, 1.3], clearance: 3 },
  { prop: "ashTree", x: 214, z: 150, radius: 32, count: 12, scale: [0.9, 1.3], clearance: 3 },
  { prop: "ashTree", x: -214, z: 176, radius: 26, count: 9, scale: [0.9, 1.3], clearance: 3 },`;

// --- the water ------------------------------------------------------------------

/**
 * SEVEN rects at one surface. The HARBOUR is the play square's own water,
 * from the head quay out to the play edge and across the whole width, so it
 * also carries the strip of sea under the pier's and the docks' outer faces —
 * one rect, so its probe stands in the harbour rather than out at sea, and its
 * 512-texel bed map is spent on the only shoreline anybody walks along. Past
 * the play edge are the FRONTAGE and the two coast strips that meet it
 * outside the square, and past those the western and eastern seas and the
 * ocean the map shipped with.
 */
const HARBOUR_RECT = { x: 0, z: -99, width: 320, depth: 122 };
const WATER_RECTS = [
  HARBOUR_RECT,
  { x: 0, z: -430, width: 1400, depth: 540 },
  { x: -430, z: -150, width: 540, depth: 20 },
  { x: 430, z: -150, width: 540, depth: 20 },
  { x: -1700, z: -420, width: 2000, depth: 560 },
  { x: 1700, z: -420, width: 2000, depth: 560 },
  { x: 0, z: -1700, width: 5400, depth: 2000 },
];
let deepest = 0;
for (let x = -HALF; x <= HALF; x += 1) {
  for (let z = -HALF; z <= HALF; z += 1) {
    if (!wet(x, z, 0)) continue;
    const inside = Math.abs(x - HARBOUR_RECT.x) <= HARBOUR_RECT.width / 2 && Math.abs(z - HARBOUR_RECT.z) <= HARBOUR_RECT.depth / 2;
    if (!inside) throw new Error(`water: dug ground under the surface at (${x}, ${z}) with no rect over it`);
    if (z > -150) deepest = Math.max(deepest, WATER_Y - floorAt(x, z));
  }
}
for (const [i, a] of WATER_RECTS.entries()) {
  for (const b of WATER_RECTS.slice(i + 1)) {
    const ox = Math.min(a.x + a.width / 2, b.x + b.width / 2) - Math.max(a.x - a.width / 2, b.x - b.width / 2);
    const oz = Math.min(a.z + a.depth / 2, b.z + b.depth / 2) - Math.max(a.z - a.depth / 2, b.z - b.depth / 2);
    if (ox > 0.01 && oz > 0.01) throw new Error(`water: two rects overlap (${JSON.stringify(a)} and ${JSON.stringify(b)})`);
  }
}
// The wade: nothing a body can stand in inside the pier is over its head.
if (deepest > 1.35) throw new Error(`water: the harbour is ${deepest.toFixed(2)} m deep somewhere inside the pier — over a body's wade`);

// --- the grass ----------------------------------------------------------------

const grass = [];
const grassObjs = [];
function turf(x, z, w, d, opts, comment) {
  if (comment) grass.push(`  // ${comment}`);
  const extra = Object.entries(opts).map(([k, v]) => `, ${k}: ${n2(v)}`).join("");
  grass.push(`  { x: ${f1(x)}, z: ${f1(z)}, width: ${f1(w)}, depth: ${f1(d)}${extra} },`);
  grassObjs.push({ x, z, width: w, depth: d });
}
turf(13, 15, 18, 18, { height: 0.75, edge: 0 }, "The square's lawn, one rect per quarter, mown and cut clean at the kerbs and the paths.");
turf(-13, 15, 18, 18, { height: 0.75, edge: 0 });
turf(-13, -11, 18, 10, { height: 0.75, edge: 0 });
turf(13, -11, 18, 10, { height: 0.75, edge: 0 });
turf(-84, 87, 38, 14, { height: 0.7, edge: 0 }, "The Exchange's garden.");
turf(-108.75, 33, 14, 4, { height: 0.6, edge: 0 }, "The churchyard behind the Mariners' Church.");
turf(-146, -116, 26, 30, { density: 0.7, height: 1.1 }, "The rough ground of the Ness, round the boat shed.");

// --- the flags --------------------------------------------------------------------

const NAMED = FLAGS.map(
  (f) => `  { id: "${f.id}", name: "${f.name}", pos: new Vector3(${n2(f.x)}, ${n2(floorAt(f.x, f.z) + f.lift)}, ${n2(f.z)}), radius: ${f.r} },`,
);

// --- the checks on the floor itself --------------------------------------------

/**
 * The gradient of every cell, against the nav graph's limit less a tenth. The
 * QUAY CLIFFS are exempt and are the only thing that is: each is a one-cell
 * drop of three metres under a quay deck (or past the deck's end, where the
 * wall turns into the foreshore), and the nav graph severing there is correct
 * — there is nothing to walk to off a quay but a two-metre drop into the
 * harbour.
 */
let worstStep = 0;
let worstAt = "";
let cliffs = 0;
for (let j = 0; j < ROW; j++) {
  for (let i = 0; i < ROW; i++) {
    const h = V[j * ROW + i];
    const x = -HALF + i * CELL;
    const z = -HALF + j * CELL;
    for (const [a, c, axis] of [[i + 1, j, "X"], [i, j + 1, "Z"]]) {
      if (a >= ROW || c >= ROW) continue;
      const s = Math.abs(V[c * ROW + a] - h);
      const mx = x + (a - i) * CELL * 0.5;
      const mz = z + (c - j) * CELL * 0.5;
      if (s / CELL > MAX_GRADE * 0.9 && (underDeck(mx, mz, 6) || mz < -150)) {
        cliffs++;
        continue;
      }
      if (s > worstStep) {
        worstStep = s;
        worstAt = `(${x}, ${z}) along ${axis}`;
      }
    }
  }
}
const worstGrade = worstStep / CELL;
const DRY = process.argv.includes("--dry");
if (worstGrade > MAX_GRADE * 0.9) {
  const msg = `terrain: a ${worstStep.toFixed(2)} m step over ${CELL} m at ${worstAt} is a ${worstGrade.toFixed(3)} gradient, against ${MAX_GRADE} less a tenth for margin.`;
  if (DRY) console.log(`  WARNING ${msg}`);
  else throw new Error(msg);
}
let lo = Infinity;
let hi = -Infinity;
for (const v of V) {
  lo = Math.min(lo, v);
  hi = Math.max(hi, v);
}

const claimsAt = process.argv.indexOf("--claims");
if (claimsAt > 0) {
  writeFileSync(
    process.argv[claimsAt + 1],
    JSON.stringify({ claimed, placements: placed, scatter: regions, cps: FLAGS, water: WATER_RECTS, grass: grassObjs }),
  );
}

// --- writing it out ------------------------------------------------------------

const heightRows = [];
for (let j = 0; j < ROW; j++) {
  const line = [];
  for (let i = 0; i < ROW; i++) line.push(String(V[j * ROW + i]));
  heightRows.push("    " + line.join(",") + ",");
}

if (!DRY) mkdirSync(out, { recursive: true });

if (!DRY) writeFileSync(
  join(out, "heights.ts"),
  `/**
 * coldharbour/heights.ts — GENERATED by \`scripts/generate-coldharbour.mjs\`
 * (\`npm run coldharbour\`), and editable afterwards with the map editor's
 * terrain mode (F2, then T). Do not hand-edit: both the script and the editor
 * rewrite this file wholesale.
 *
 * The ground under the town — one height per grid vertex, row-major from the
 * -X/-Z corner. A lazy \`import()\` (\`MapDef.heights\`), so it reaches a
 * browser only when this map is built.
 *
 * ${CELLS}x${CELLS} cells of ${CELL} m over the ${PLAY} m map, so ${ROW}x${ROW} vertices.
 * Keep any single-cell step under ${(MAX_GRADE * CELL).toFixed(2)} m or the nav graph stops
 * linking across it; the generator refuses anything over ${(MAX_GRADE * CELL * 0.9).toFixed(2)} except
 * the quay cliffs, which are meant to sever.
 *
 * **The town is an AMPHITHEATRE round its harbour, built in level TERRACES.**
 * Every building in the city kit is placed level — its height is sampled once,
 * at its own centre — so the hill the town climbs is laid as districts, each
 * flat under its own buildings, with the streets between them carrying the
 * climb: the quays at the datum, the square at +0.6, the old town at +0.3,
 * the High Town at +3.4, midtown at +2.4 and the ridge road's north side at
 * +3.0..+3.8, with the Heights the Valeguard deploy on at +4.2.
 *
 * **The harbour is cut to LOW WATER**: a bed of ${harbourBed(0, -60).toFixed(1)} m at the head and
 * ${harbourBed(0, -140).toFixed(1)} at the mouth under a surface at ${WATER_Y}, so the whole of it inside the
 * pier is a wade of 0.7..${deepest.toFixed(2)} m. There is no swimming in this engine, so
 * water deeper than a body inside the play square would be a body walking on
 * the seabed under the surface. The quays stand on one-cell cliffs cut along
 * their own land lines (\`QUAYS\` in the generator); the Strand and the Hard
 * are natural foreshores at ${SHORE} a metre, so a body walks up out of the
 * harbour at either. Only the last two rows — past the pier and the dock front
 * — fall to the open sea at ${SEA_BED}, which is what the borderland extrudes and
 * the ocean is drawn over.
 */
import type { Heightfield } from "../layout";

export const ColdharbourHeights: Heightfield = {
  size: ${CELLS},
  cell: ${CELL},
  // Row-major, +Z per row.
  heights: [
${heightRows.join("\n")}
  ],
};

// Default too, because \`MapDef.heights\` is a lazy \`import()\` and a default
// is the one export name a generic signature can be written against.
export default ColdharbourHeights;
`,
);

const waterLines = [
  "  // The harbour: the play square's own water, from the head quay to the play",
  "  // edge and across the whole width, so it also carries the strip of sea",
  "  // under the pier's and the docks' outer faces. ONE rect, so its probe",
  "  // stands in the harbour rather than out at sea, and its bed map is spent",
  "  // on the only shoreline anybody walks along.",
  ...WATER_RECTS.slice(0, 1).map((r) => `  { x: ${n2(r.x)}, z: ${n2(r.z)}, width: ${n2(r.width)}, depth: ${n2(r.depth)}, y: ${n2(WATER_Y)} },`),
  "  // The frontage: the open sea south of the play square out past both",
  "  // headlands, and the two strips that close it against the coast either",
  "  // side of the square. Seams stand on the play edge, along the foot of the",
  "  // quays' outer faces, except across the harbour mouth.",
  ...WATER_RECTS.slice(1, 4).map((r) => `  { x: ${n2(r.x)}, z: ${n2(r.z)}, width: ${n2(r.width)}, depth: ${n2(r.depth)}, y: ${n2(WATER_Y)} },`),
  "  // The western and eastern seas, and the ocean that is the southern horizon.",
  ...WATER_RECTS.slice(4).map((r) => `  { x: ${n2(r.x)}, z: ${n2(r.z)}, width: ${n2(r.width)}, depth: ${n2(r.depth)}, y: ${n2(WATER_Y)} },`),
];

if (!DRY) writeFileSync(
  join(out, "layout.ts"),
  readTemplate()
    .replace("%PLACEMENTS%", placements.join("\n"))
    .replace("%SCATTER%", scatter.join("\n") + BORDERLAND)
    .replace("%FLAGS%", NAMED.join("\n"))
    .replace("%SPAWNS%", [...spawns, ...flagSpawns].join("\n"))
    .replace("%VEHICLES%", vehicles.join("\n"))
    .replace("%WATER%", waterLines.join("\n"))
    .replace("%GRASS%", grass.join("\n")),
);

const lit =
  placed.filter((p) => p.kind === "streetLight" && p.params.lit).length +
  placed.filter((p) => p.kind === "lighthouse" || p.kind === "chapel").length +
  placed.filter((p) => p.params.litWindows).reduce((s, p) => s + ({ shophouse: 3, office: 2, depot: 2 }[p.kind] ?? 0), 0);
printTally(tally(placed, (p) => p.kind), refused, bracketKind);
if (process.argv.includes("--refusals")) printRefusals(refused);
console.log(
  `coldharbour: ${PLAY} m square\n` +
    `  ${placed.length} placements, ${regions.length} scatter regions, ${lit} light slots spent by fixtures\n` +
    `  ${ROW}x${ROW} height vertices, ground ${lo.toFixed(2)}..${hi.toFixed(2)} m\n` +
    `  harbour deepest ${deepest.toFixed(2)} m inside the pier\n` +
    `  steepest cell step ${worstStep.toFixed(2)} m (grade ${worstGrade.toFixed(3)}) at ${worstAt}; ${cliffs} quay-cliff steps exempt\n` +
    (DRY ? "  dry run: nothing written" : `  wrote src/world/coldharbour/{layout,heights}.ts`),
);

// --- the layout file's prose ---------------------------------------------------

function readTemplate() {
  return `/**
 * coldharbour/layout.ts — THE MAP, as data: structure placements, scatter
 * regions, control points, spawns, the two vehicle hardstandings, the lawns and
 * the water. GENERATED by \`scripts/generate-coldharbour.mjs\`
 * (\`npm run coldharbour\`) — the design is authored there and transcribed here
 * mechanically, with every placement checked against the floor, the roads and
 * its own front door. The editor opens, patches and saves this file like any
 * other; re-running the generator DISCARDS those edits.
 *
 * Consumed by MapBuilder; nothing here is code to special-case.
 * Gotchas that have already cost time: collider top faces within
 * CONFIG.nav.stepHeight of adjacent ground or bots treat decks as walls;
 * a control point's pos must NOT sit inside a collider (surfaceAt returns -1);
 * scatter clearance values must match prop collider extents.
 */
import { Vector3 } from "@babylonjs/core";
import type {
  ControlPointDef,
  GrassRect,
  MapLayout,
  Placement,
  ScatterSpec,
  SpawnPointDef,
  VehicleSpawnDef,
  WaterRect,
} from "../layout";

/**
 * COLDHARBOUR — a harbour town on a bay, an hour before dusk, with the
 * fighting in its streets.
 *
 * **320 x 320 m**, origin at the map centre, +Z is north. The town is a
 * horseshoe round its harbour: the quays at the bottom, the civic square at
 * the harbour's head, the old town and the fish quay on the west shore, the
 * docks and the goods yard on the east, and the commercial town climbing the
 * hill behind to the ridge road along the top.
 *
 *      z=+160  +---------------------------------------------------------+
 *              | HEIGHTS (T0) |   the ridge: High Street's tall stock   NE |
 *              |   home yard  |============ High Street ================|
 *              |  West   A  the Exchange    midtown     D  the Terminal  |
 *              |  Road   (+3.4)            (+2.4)        (train shed)    |
 *      z= +40  |  ====== Exchange St == Market St ===== Station Approach |
 *              |  old town   chapel   C  the square    east town  Station|
 *              |  (+0.3)     Fore St    the memorial   (+0.6)      Road  |
 *      z= -26  |  ....... Harbour Road (head) ......................     |
 *              |  B the car park |  ~~~~~ THE HARBOUR ~~~~~ |  E  the    |
 *              |   Ship Lane     |  ~~ boats on the mud ~~  |  Harbour   |
 *              |  ===== Strand ==|  ~~~~~~~~~~~~~~~~~~~~~~~ |  Board     |
 *              |  the Ness, net  |~~~~ wadeable at low ~~~~ | docks,     |
 *              |  lofts, racks   ~~~~~ water ~~~~~~~~~~~~~~ ~the Hard     |
 *      z=-152  |  ====== the pier =====[light]   mouth     ==== dock front|
 *              |~~~~~~~~~~~~~~~~~~~~~~~~ THE SEA ~~~~~~~~~~~~~~~~~ (T1) ~~~|
 *             x=-160          -50            0             46          +160
 *
 * **It was a business district on a 5 x 5 grid of 16 m avenues**, every one
 * of them 300 m long and dead straight, with a quay laid along the southern
 * edge after the fact. It played as eight lanes of fire between boxes and it
 * read as a diagram of a city. Everything about it that was a decision has
 * been kept — the five objectives and what each one is, the two home corners
 * on the NW-SE diagonal the sun's azimuth is chosen against, the hour, the
 * hills on three sides and the sea on the fourth — and the ground, the water
 * and the streets under them are new.
 *
 * ## The harbour, which is what the map is about now
 *
 * The bay cuts into the middle of the southern side: sixty metres across at
 * its head under the square, a hundred at the mouth and a hundred and ten from
 * one to the other, quayed round its head and down both sides, with the pier
 * and the harbour light on its head closing it from the west. **It is
 * WADEABLE everywhere inside the pier** — this engine has no swimming, so the
 * whole harbour is cut to low water, 0.7 m at the head and 1.1 at the mouth —
 * and the boats lie over on the mud beside the quays, which is the strongest
 * single thing on the map saying where it is.
 *
 * **What the water does to the fight is the point of it.** It is the one
 * stretch of open ground on the map a body crosses slowly and with nothing
 * but the boats for cover, overlooked from three quays, the square and the
 * car park's decks — and it is the short way between the two halves of the
 * town. Team 1 wades it from the Hard to reach B; team 0 walks round the
 * head for E or wades it the other way. The quays are cliffs the nav graph
 * severs, which is why the Strand and the Hard are natural foreshores: two
 * places a body walks out of the water, and the mouth between them a wade.
 *
 * ## What each flag is, and why they are five different things
 *
 * - **A, the Exchange** — a three-storey office on its own square at the top
 *   of Fore Street, with a garden behind. Three walked floors and a window band
 *   on three bearings over the High Town, approached up the West Road, up Fore
 *   Street or down from High Street.
 * - **B, the car park** — three open decks on the old fish market's site,
 *   between the west quay and Ship Lane. Every deck shoots every other, and
 *   the top one looks across the harbour at E. Covered on every side — the
 *   Strand's terrace, the lanes, the quay — so it is the brawl the open water
 *   beside it is not.
 * - **C, the civic square** — a lawn at the head of the harbour with four
 *   paths to the memorial, four stands of trees and the Town Hall on its
 *   corner. Five ways in, one of them the quay, and the trees are the only
 *   cover that is not furniture: the one you take last and lose first.
 * - **D, the Terminal** — the station forecourt under the train shed's arches,
 *   taxis on the rank and no interior at all. The fast flag.
 * - **E, the Harbour Board** — three walked floors at the head of the docks,
 *   its plaza onto Rope Street and its yard onto Warehouse Lane, overlooking
 *   the east quay and the harbour.
 *
 * ## The sightlines
 *
 * **No street runs the width of the map.** The cross-town line jogs at Fore
 * Street and at Quay Street, High Street jogs at both, Fore Street bends where
 * it reaches the High Town, and the two home roads jog twice each — so the
 * longest look down a street is about a hundred metres, against the three
 * hundred every avenue used to be. The long looks left are ACROSS the harbour
 * and down it to the sea, which is what a DMR on this map is for now.
 * \`bots.perception.engageRange\` is 55 m and did not move with the fog, so a
 * bot will not open up across the harbour the way a player will.
 *
 * ## What it costs
 *
 * **The collision bake roughly doubled — 800 boxes to 1,764 — and the frame
 * did not notice**, because no ray in the game walks the scene any more
 * (\`RayWorld\` answers analytically off bucketed boxes): measured uncapped on
 * the Windows box at the same five standing vantages before and after, the
 * square 370 -> 362 fps, the Exchange 250 -> 272, the car park 319 -> 373,
 * the forecourt 279 -> 249 and the Harbour Board 254 -> 246, with the build
 * 6.9 -> 8.2 s. What spent it is the old town: forty-odd jettied houses, an
 * inn and a church, each a handful of colliders, where the old map had
 * forty-four three-box towers. The light budget is twenty-two fixtures' worth
 * against the sixteen slots, spread so that no flag has more than its own:
 * the square's four lamps, the forecourt's two, one lamp each at A, B and E,
 * the two offices', the train shed's and a warehouse's windows, four lit
 * shops, the Anchor, the church and the harbour light.
 *
 * ## Layout hygiene (keep to these)
 *
 * - Structures are axis-aligned (\`rotY\` in multiples of pi/2), and the CITY
 *   kit's street front is its local +Z — the reverse of the village kit's.
 * - Nothing but kerb furniture stands in a carriageway, and a through road
 *   keeps one side clear of parked cars so a hull still has the other.
 * - Every quay stands on the line the floor's cliff is cut on; move one and
 *   the cliff stays where it was. Re-lay them in the generator.
 */

const placements: Placement[] = [
%PLACEMENTS%
];

/**
 * The town's dressing, the harbour's working clutter and the country beyond
 * the play square. What blocks is cover and is on the bill for every ray;
 * what does not is dressing and costs nothing but the merge. Every region is
 * checked against the finished floor and the claims by the generator.
 *
 * ADDING A PLACEMENT REROLLS ALL OF THIS — \`findSpot\` draws from the shared
 * stream once per attempt, and placements build before scatter.
 */
const scatter: ScatterSpec[] = [
%SCATTER%
];

/**
 * The five objectives. A, B and E stand INSIDE a building at ground-floor
 * height and the capture zone is a cylinder, so every storey above the flag
 * is inside the zone too; each is at its building's centre, which every one of
 * those builders leaves clear of its core, its stair lanes and its columns. C
 * stands ON the memorial's top tier, 3.5 m out from the shaft, because a flag
 * at the exact centre would be inside it. \`pos.y\` is the walked height.
 */
const controlPoints: ControlPointDef[] = [
%FLAGS%
];

/**
 * Home spawns in the two corner yards, and one spawn per objective outside
 * its ring on the side that faces the fight it feeds — each on the bearing the
 * old map's had from its flag. C's is on the perpendicular bisector of the two
 * homes, so the flag every round turns on is the same walk back from both.
 */
const spawns: SpawnPointDef[] = [
%SPAWNS%
];

/**
 * One hardstanding per side, in the yard that side deploys into, clear of the
 * infantry spawns and headed for its own home road: the Valeguard's down the
 * West Road from the Heights, the Redline's up the Station Road from the goods
 * yard. **Two, and exactly two** — the respawn is per hardstanding, so the
 * number of entries IS how many tanks a side can field.
 */
const vehicles: VehicleSpawnDef[] = [
%VEHICLES%
];

/**
 * THE WATER, as seven rectangles at one surface. \`y\` is -2.2 on all of them
 * and they must go on agreeing, for the drawing and for the sound:
 * \`MapBuilder.waterAmbience\` joins rects into one BODY when they touch and
 * agree, and one harbour shelved into seven seas would be seven emitters.
 *
 * **A rect's bed map is 512 texels a side however big it is**, so the harbour
 * is its own rect and is no wider than the play square; the open sea is laid
 * round it, its far edges past \`fogEnd\` from anywhere a living player can
 * stand, and its seams on the play edge at the foot of the quays' outer faces.
 */
const water: WaterRect[] = [
%WATER%
];

/**
 * The lawns: the civic square's four quarters, the Exchange's garden, the
 * churchyard and the rough ground of the Ness. Purely visual — no collider, no
 * nav cost — and a tuft that lands inside a collider is dropped at build time.
 */
const grass: GrassRect[] = [
%GRASS%
];

export const ColdharbourLayout: MapLayout = {
  placements,
  scatter,
  controlPoints,
  spawns,
  vehicles,
  water,
  grass,
  /**
   * Not \`CONFIG.map.size\`. Everything downstream takes the extent as an
   * argument; what a larger map owes is stated on \`MapLayout.size\`, and the
   * one that bites is that \`terrain.size * terrain.cell\` must equal this —
   * ${CELLS} x ${CELL}.
   */
  size: ${PLAY},
  /**
   * Three floors, a roof, a spandrel at every window and a wall head under
   * every ceiling stack six or seven candidates into one perimeter cell, and
   * \`NavGrid\` DROPS the overflow rather than sorting it in. The city kit's
   * builders emit their walked surfaces FIRST, so at the default 3 the floors
   * fill the slots and it is the spandrels and the roof that are dropped —
   * measured on this map before the re-lay, every storey of every enterable
   * building was reachable at 3, 4 and 5. Four is one slot of margin over a
   * value that already works, bought because the guarantee rests on emission
   * order inside a builder and the failure is a storey quietly missing from
   * the graph.
   */
  surfaces: 4,
  /**
   * Twice the default, for the \`borderland\` below: with 180 m of ground on
   * every side the default 48 cuts the floor into 61 patches, every one walked
   * by the frame at every distance because the floor carries no
   * \`metadata.block\`. At 96 it is 24.
   */
  terrainBlock: 96,
  /**
   * No wall and no rim: the ground carries on for 180 m past the play square
   * on every side and what stops a player leaving is the leash. **The margin
   * is the LANDFORM's here** — this map draws hills on three sides (see
   * \`ridge\`), and at 300 m the fog ate them; 180 puts their crest 330 m from
   * the nearest street at 93 m high. The roll is low because a third of the
   * borderland is SEABED, and at the default the bed's high points would come
   * up into the shallows and show a shoal through the open sea. \`ease\` is 30
   * because the leash's 69 m is the shorter of the two tests.
   */
  borderland: { margin: 180, roll: 1.8, ease: 30 },
  /**
   * **HILLS on three sides and the OPEN SEA on the fourth.** \`downs\` with
   * rolling summits and woods on them, and a \`mouth\` across the whole
   * southern side and both southern corners — \`form: "none"\` asked of one
   * arc, allowed because there IS something out there past \`fogEnd\`: the sea.
   * The mouth's width is arithmetic (the southern side, 680 m, plus a quarter
   * circle of crest at each corner: 680 + 2 x 150 x pi / 2 = 1151), and its
   * \`ease\` is what a headland IS — over 300 m of the crest's curve each range
   * grows out of the sea at its corner, so the bay the town stands on is held
   * between two headlands.
   */
  ridge: {
    form: "downs",
    slope: 0.19,
    slopeVariance: 0.06,
    mouth: [{ x: 0, z: -340, width: 1151, ease: 300 }],
    rolling: {
      relief: 0.3,
      summits: 16,
      knolls: 0.14,
      knollSize: 110,
      woods: 0.6,
      shore: 0.5,
    },
    seed: 0x43484252,
  },
  // Fixed so the dressing — and the colliders blocking scatter emits, and so
  // the nav graph — is identical on every boot.
  seed: 0x434f4c44,
};
`;
}
