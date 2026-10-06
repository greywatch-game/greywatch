/**
 * generate-hollowmere.mjs — SEEDS Hollowmere, the drowned village: writes
 * `src/world/hollowmere/{layout,heights}.ts`.
 *
 * Run with `npm run hollowmere`, and owe `npm run collision -- hollowmere` and
 * `npm run parity` after it. Committed output, like every `heights.ts` and
 * every collision bake, and re-running it with the tree unchanged must produce
 * the same bytes.
 *
 * Four flags for iterating on it: `--probe` prints the floor as a plan and
 * writes nothing, `--refusals` lists every plot that was refused and what
 * refused it, `--claims <file>` dumps the claims, the placements and the
 * floor as JSON for a plan render, and `--dry` runs everything and writes
 * nothing (and reports an unwalkable floor as a warning rather than
 * refusing, so a plan can still be rendered of it).
 *
 * ## Why it is seeded now, when it was typed
 *
 * Hollowmere was the first map and was typed a placement at a time over a
 * floor that was flat but for two scraped basins, and it had grown the way a
 * typed layout does: a grid of streets that stopped in fields, houses turned
 * whichever way the last edit left them — front doors opening onto a
 * neighbour's back wall or into a field — and every piece of relief
 * the fights were built round (the chapel's terrace, the creek's two
 * embankments) a BOX, because there was no ground to put it in. Harrowmead took
 * the same road for the same reason; this is that generator's construction at
 * this map's scale. The DESIGN is authored here — the creek's course, the
 * hills, the village's streets, every set piece — and the TRANSCRIPTION is
 * mechanical and CHECKED:
 *
 * - **Nothing stands in the water**, sampled on the floor the game draws.
 * - **Nothing stands on a road**, the network's own footprint being imported
 *   from `src/world/roadPaths.ts` so the test is the one the game makes.
 * - **Nothing is built on a slope**: a placement samples the ground ONCE at
 *   its centre, so a plot that falls more than `FLAT` across its footprint is
 *   refused rather than left floating at one corner.
 * - **Every door opens onto somewhere.** A building's front is its local -Z
 *   face, and the ray out of it has to reach a street, the square or a yard
 *   before it meets anything solid. That is what "a house not facing the
 *   street" was, mechanically — and a ruin is held to it too, because a burnt
 *   house still stands where it was built to face.
 * - **No road runs into the water**, and the creek is crossed on foot by two
 *   footbridges and waded everywhere else.
 *
 * ## The floor, which is what the map never had
 *
 * Four passes, in order: a valley that falls gently from the Ashwood in the
 * north to the moor and the bog in the south, with named hills on it; every
 * district levelled toward its own height by a weighted AVERAGE (Sarab's
 * `land`); the water's corridors held under a cone so the creek and the two
 * pools sit in low ground rather than in trenches; and the channel and the
 * basins cut last, to one bed, so each water rect is wet exactly where the
 * floor is under it. The gradient of the result is checked and the script
 * REFUSES to write a floor it cannot walk.
 *
 * **The datum is chosen for the MIST.** `EnvironmentSpec.mistHeight` is an
 * absolute falloff (`exp(-max(y, 0) / h)`), so where zero sits is a decision
 * about the look: the village stands at +0.3..+1.5 and keeps the mist it has
 * always had, the creek's dell, the moor and the bog shore are BELOW zero and
 * drown in it, and the chapel's hill stands out of it at +5.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { roadNetwork } from "../src/world/roadPaths.ts";
import { onRoad } from "../src/world/roads.ts";
import {
  bell,
  bracketKind,
  f1,
  FACES,
  makeClaim,
  makeFloorAt,
  makeFootOnRoad,
  makeFootWet,
  makeFrontClear,
  makeGrade,
  makeMust,
  makeOverlaps,
  makeRelief,
  makeScatter,
  makeWorldFoot,
  makeYard,
  n2,
  printProbe,
  printRefusals,
  printTally,
  rectDist,
  section,
  seeded,
  smin,
  smooth,
  tally,
  TURN,
  turnOf,
  vnoise,
} from "./lib/mapgen.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = join(root, "src", "world", "hollowmere");

// --- the extent --------------------------------------------------------------

/** The PLAY square. */
const PLAY = 240;
/** Metres per heightfield cell. `CELLS * CELL` must equal `PLAY`. */
const CELL = 3;
const CELLS = PLAY / CELL;
const HALF = PLAY / 2;
/** The steepest step between two vertices the nav graph still links, per metre. */
const MAX_GRADE = 0.4;
/**
 * How far the floor may fall across a building's footprint before the plot is
 * refused. Tighter than Harrowmead's 0.45: a cottage's plinth is 0.3 m, and a
 * plot that falls more than that shows daylight under one corner.
 */
const FLAT = 0.3;

// --- the seeded stream -------------------------------------------------------

const { rng, rand, chance, pick } = seeded(0x484c4d52);

// --- the floor ---------------------------------------------------------------

/**
 * The hills. Peak over radius times π/2 is the steepest a bell makes: the
 * chapel's 4.4 over 44 is 0.16, well under what the nav graph severs at.
 */
const HILLS = [
  // Chapel Hill — flag A's, and the one piece of high ground in the village.
  { x: -60, z: 84, peak: 3.6, r: 50 },
  // The Valeguard upland the north-west gatehouse stands on.
  { x: -104, z: 110, peak: 1.8, r: 34 },
  // The Ashwood knoll, where the logging camp's look-out stands.
  { x: 62, z: 110, peak: 2.6, r: 30 },
  // The north-east hill, the thickest of the dead woods.
  { x: 102, z: 96, peak: 3.2, r: 40 },
  // The rise the farmstead stands on.
  { x: 86, z: 40, peak: 1.4, r: 46 },
  // The east holdings' swell, the Redline look-out's.
  { x: 108, z: -30, peak: 1.5, r: 34 },
  // The moor's one knoll, over the mire.
  { x: -104, z: -104, peak: 1.3, r: 26 },
  // The creek's west bank, a low wooded rise.
  // The rise north of the square the north street climbs.
  { x: -8, z: 56, peak: 1.2, r: 34 },
];

/** The valley before anything is levelled or cut: north high, south low. */
function natural(x, z) {
  let h = 0.5 + 0.009 * z + 0.6 * vnoise(x, z, 64, 41) + 0.16 * vnoise(x, z, 30, 42) + 0.04 * vnoise(x, z, 12, 43);
  // The moor's hummocks: the south is low, and low ground this flat is a floor.
  h += 0.45 * smooth((-z - 40) / 30) * vnoise(x, z, 18, 44);
  for (const k of HILLS) h += k.peak * bell(Math.hypot(x - k.x, z - k.z), k.r);
  return h;
}

// --- the water ---------------------------------------------------------------

/** The surface of every pool and the creek, and the bed they are cut to. */
const WATER_Y = -1.3;
const BED = -2.0;
/** The dell floor and the shores: the lowest DRY ground on the map. */
const BANK = -0.55;
/** Flat bed half-width, and where the bank reaches the dell floor. */
const BED_HW = 2.5;
const LIP = 8;
/** How far from the water the ground is held low, and how steeply it rises past that. */
const VALE_GRADE = 0.14;

/**
 * The creek's centreline, as the points a Catmull-Rom spline is run through.
 * It comes in off the west edge under the chapel's hill, turns south down the
 * west side of the map past the mill, and runs out into the mire and off the
 * south edge. Both ends run on past the square so the channel meets each edge
 * square to it: past the grid the floor is the clamped edge (`TerrainField`),
 * and a channel crossing the edge at an angle continues as a skewed trench.
 */
const CREEK_PTS = [
  [-170, 30], [-121, 30], [-110, 29], [-101, 24], [-96, 14], [-94, 0], [-94, -16],
  [-94, -32], [-91, -48], [-84, -62], [-74, -76], [-66, -90], [-60, -104], [-57, -120], [-56, -170],
];

/** Dense samples along the spline, ~0.5 m apart. */
const CREEK = (() => {
  const pts = CREEK_PTS;
  const outPts = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(2, Math.ceil(len / 0.5));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const cr = (a, b, c, d) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      outPts.push([cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  outPts.push(pts[pts.length - 1]);
  return outPts;
})();

/** Distance to the creek's centreline, near enough (the samples are 0.5 m apart). */
function creekDist(x, z) {
  let best = Infinity;
  for (const [bx, bz] of CREEK) {
    const dz = bz - z;
    if (dz > best || -dz > best) continue;
    const d = Math.hypot(bx - x, dz);
    if (d < best) best = d;
  }
  return best;
}

/** The creek's centreline x at a given z, on its north-south reach. */
function creekX(z) {
  let best = null;
  let bd = Infinity;
  for (const [bx, bz] of CREEK) {
    if (bz > 20) continue;
    const d = Math.abs(bz - z);
    if (d < bd) {
      bd = d;
      best = bx;
    }
  }
  return best;
}

/** The creek's centreline z at a given x, on its east-west reach under the hill. */
function creekZ(x) {
  let best = null;
  let bd = Infinity;
  for (const [bx, bz] of CREEK) {
    if (bz < 18) continue;
    const d = Math.abs(bx - x);
    if (d < bd) {
      bd = d;
      best = bz;
    }
  }
  return best;
}

/**
 * The two pools, as ellipses cut to the bed with a bank `skirt` wide. The BOG
 * is flag E's and runs out off the south edge; the MIRE is the moor's, and the
 * creek runs through it on its way out.
 */
const BOG = { x: 38, z: -106, rx: 25, rz: 22, skirt: 9, hold: 5 };
const MIRE = { x: -66, z: -97, rx: 15, rz: 10, skirt: 8, hold: 8 };

/** How far outside a pool's ellipse a point is, near enough (0 inside). */
function poolDist(p, x, z) {
  const e = Math.hypot((x - p.x) / p.rx, (z - p.z) / p.rz);
  return (e - 1) * Math.min(p.rx, p.rz);
}

/**
 * The mill race: the reach past the wheel, where the east bank is a stone
 * revetment rather than a slope, so the wheel stands over the water and the
 * mill's body on its pad. The 3 m grid cannot draw a bank steeper than one
 * cell, so what this changes is where the ramp STARTS; the grade check below
 * still holds it to something a body climbs.
 */
const MILL_Z = -10;
const MILL_RACE = { z0: MILL_Z - 9, z1: MILL_Z + 9, lip: 6.5 };

// --- the places that have to be level -----------------------------------------

/**
 * `level` is what the ground reads inside the core and `skirt` how far it takes
 * to get back to the valley. A district's level of `null` is its own natural
 * height at the centre, rounded — a farm stands where it stands.
 */
const DISTRICTS = [
  // C — the square, and the four quarters round it at their own heights, so
  // every street out of the square climbs or falls a little.
  { name: "square", x0: -22, x1: 22, z0: -20, z1: 16, level: 0.6, skirt: 14 },
  { name: "west quarter", x0: -58, x1: -24, z0: -46, z1: 18, level: 1.0, skirt: 9 },
  { name: "north quarter", x0: -40, x1: 14, z0: 18, z1: 52, level: 1.4, skirt: 12 },
  { name: "east quarter", x0: 22, x1: 64, z0: -46, z1: 18, level: 0.8, skirt: 12 },
  { name: "south quarter", x0: -22, x1: 22, z0: -46, z1: -20, level: 0.25, skirt: 12 },
  // A — the chapel's crown, levelled for the nave and the churchyard.
  { name: "chapel crown", x0: -76, x1: -44, z0: 62, z1: 102, level: null, skirt: 22 },
  // B — the mill yard, down in the dell by the creek.
  { name: "mill yard", x0: -90, x1: -64, z0: -46, z1: 10, level: -0.45, skirt: 8 },
  { name: "mill pad", x0: -88, x1: -74, z0: MILL_Z - 7, z1: MILL_Z + 7, level: -0.45, skirt: 4, weight: 4 },
  // D — the farmstead's rise.
  { name: "farmstead", x0: 70, x1: 104, z0: 18, z1: 74, level: null, skirt: 16 },
  // E — the dock yard on the bog's north shore.
  { name: "dock yard", x0: 4, x1: 66, z0: -76, z1: -58, level: -0.4, skirt: 10 },
  // The Ashwood logging camp, and the knoll its look-out stands on.
  { name: "ashwood", x0: 8, x1: 50, z0: 68, z1: 112, level: null, skirt: 14 },
  // The two home yards.
  { name: "valeguard", x0: -116, x1: -84, z0: 86, z1: 116, level: null, skirt: 16 },
  { name: "redline", x0: 86, x1: 116, z0: -116, z1: -86, level: null, skirt: 16 },
  // The east holdings' farm, the burying ground and the moor crofts.
  { name: "holdings", x0: 90, x1: 118, z0: -80, z1: -40, level: null, skirt: 12 },
  { name: "burying ground", x0: -48, x1: -16, z0: -90, z1: -62, level: null, skirt: 12 },
  { name: "moor crofts", x0: -70, x1: -50, z0: -74, z1: -62, level: null, skirt: 10 },
  // The glebe, the vicarage's plot on the hill's south shoulder under the gate.
  { name: "glebe", x0: -64, x1: -50, z0: 41, z1: 52, level: 2.6, skirt: 10, weight: 1.5 },
  // Beck Row, the cottages along the crest over the mill's dell.
  // Cooper's Lane, between High Street east and the farm's rise.
  { name: "cooper's lane", x0: 4, x1: 62, z0: 14, z1: 40, level: 1.1, skirt: 10 },
  // The Ashwood look-out's shelf, and the Redline look-out's on the swell.
  { name: "swell look-out", x0: 88, x1: 114, z0: -30, z1: -22, level: null, skirt: 10 },
  // The steadings north of the swell.
  { name: "steadings", x0: 96, x1: 116, z0: -12, z1: 10, level: null, skirt: 8 },
  // The two crofts on the creek's far bank.
  { name: "west bank", x0: -117, x1: -106, z0: -36, z1: -24, level: -0.35, skirt: 6 },
  { name: "ferry", x0: -117, x1: -102, z0: 44, z1: 56, level: 0.4, skirt: 6 },
];
for (const d of DISTRICTS) {
  if (d.level === null) {
    d.level = Math.round(natural((d.x0 + d.x1) / 2, (d.z0 + d.z1) / 2) * 4) / 4;
  }
}

/** How far a point is from the edge of the ground the water holds low. */
function waterReach(x, z) {
  return Math.min(
    creekDist(x, z) - (LIP + 3),
    Math.max(0, poolDist(BOG, x, z)) - (BOG.skirt + BOG.hold),
    Math.max(0, poolDist(MIRE, x, z)) - (MIRE.skirt + MIRE.hold),
  );
}

/** The ground before any cut: the valley, then every district, averaged, then the water's cone. */
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
  let h = base;
  if (wsum > 0) h = base + (hsum / wsum - base) * Math.min(1, wsum);
  // The water's cone LAST, so a district beside the creek is held under it as
  // a hill is — except the mill's pad, which stands on its race.
  const cone = BANK + VALE_GRADE * Math.max(0, waterReach(x, z));
  const pad = DISTRICTS.find((d) => d.name === "mill pad");
  const lift = (pad.level - BANK) * (1 - smooth(rectDist(x, z, pad) / pad.skirt));
  h = smin(h, cone + lift, 1.2);
  // Dry ground is never below the dell floor: each water rect is drawn
  // wherever the ground is under it, so dry land has to be dry.
  return Math.max(h, BANK - 0.1);
}

function heightAt(x, z) {
  let h = land(x, z);
  // The channel: a flat bed and a straight bank, which a 3 m grid samples
  // better than any curve — the bank's grade is (h - BED) / (LIP - BED_HW).
  const rd = creekDist(x, z);
  const race = z > MILL_RACE.z0 && z < MILL_RACE.z1 && x > creekX(z);
  const lip = race ? MILL_RACE.lip : LIP;
  if (rd < lip) {
    const w = rd <= BED_HW ? 1 : 1 - (rd - BED_HW) / (lip - BED_HW);
    h = Math.min(h, h + (BED - h) * w);
  }
  // The pools.
  for (const p of [BOG, MIRE]) {
    const pd = poolDist(p, x, z);
    if (pd < p.skirt) {
      const w = pd <= 0 ? 1 : 1 - pd / p.skirt;
      h = Math.min(h, h + (BED - h) * w);
    }
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
  printProbe({ half: HALF, step: 6, height: floorAt, grade, wet });
  process.exit(0);
}

// --- the output, and the placement vocabulary --------------------------------

/**
 * The ground each kind takes, in its own frame: `[x0, x1, z0, z1]`, front at
 * -Z. Measured off the builders — the eaves, a porch, a ramp and a wheel are
 * all ground nothing else may stand on, whether or not a collider covers it.
 */
const FOOT = {
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
  crates: () => [-1.6, 1.7, -1.3, 1.3],
  woodpile: (p) => {
    const len = p.length ?? 5;
    return [-len / 2 - 0.2, len / 2 + 0.2, -0.7, 0.7];
  },
  trough: () => [-1.6, 1.6, -0.6, 0.6],
  well: () => [-1.7, 1.7, -1.7, 1.7],
  stall: () => [-2, 2, -1.1, 1.1],
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
  jetty: (p) => [-1.7, 1.7, -(p.length ?? 18) / 2, (p.length ?? 18) / 2],
};

/** Small things a yard or a flag's ring may hold. */
const PROPS = new Set(["cart", "crates", "woodpile", "trough", "haystack", "stall", "well", "shrine", "lamp"]);

/** Kinds with a front door, whose front the door check holds to a street or a yard. */
const DOORS = new Set(["cottage", "townhouse", "tavern", "smithy", "chapel", "mill", "barn", "boathouse", "ruin"]);
/** Kinds whose front only has to be CLEAR: a shed's door and a kiln's stoke hole. */
const FRONTS = new Set(["shed", "kiln"]);

const worldFoot = makeWorldFoot(FOOT);

const placements = [];
const scatter = [];
/** The same placements and regions as objects, for the network and the render. */
const placed = [];
const regions = [];

function paramText(params) {
  if (!params) return "";
  return Object.entries(params)
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}: [${v.map((q) => `[${q.map(n2).join(", ")}]`).join(", ")}]`;
      const lit = typeof v === "string" ? (v.startsWith("@") ? v.slice(1) : `"${v}"`) : typeof v === "boolean" ? String(v) : n2(v);
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

section(placements, "roads");
placements.push(
  "  // Visual only: a road carries no collider, stops no round and is in no",
  "  // baked structure. The square and the village's streets are COBBLE and",
  "  // every lane out of the village is dirt. Each street is a PATH, so where two",
  "  // meet the network paves the junction itself; the square is the one",
  "  // rectangle, and the four streets out of it end inside its paving.",
);

const roadDefs = [];

/** An axis-aligned rectangle road. `turn` 0 runs along Z, 1 along X. */
function rectRoad(x, z, turn, len, w, surface) {
  const params = { length: len, width: w, surface };
  roadDefs.push({ kind: "road", x, z, rotY: turn ? Math.PI / 2 : 0, params });
  emit("road", x, z, turn, params);
}

/** A path road through world points; the network bends and joins it. */
function pathRoad(note, points, w, surface, radius) {
  if (note) placements.push(`  // ${note}`);
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

// The square: x -18..18, z -17..13, and the streets that leave it.
const SQ = { x0: -18, x1: 18, z0: -17, z1: 13 };
const HIGH_Z = -2; // High Street, through the square east to west
const NORTH_X = 1; // North Street and South Street, through it north to south
const CHURCH_Z = 34; // Church Street, west off North Street
const TANNERS_X = 36; // Tanners Lane, south off High Street east
const WEST_X = -36; // Weavers Lane, south off High Street west
const COOPER_Z = 26; // Cooper's Lane, east off North Street to the farm lane

placements.push("  // The square — the one paved rectangle on the map.");
rectRoad((SQ.x0 + SQ.x1) / 2, (SQ.z0 + SQ.z1) / 2, 0, SQ.z1 - SQ.z0, SQ.x1 - SQ.x0, "cobble");

const MILL_YARD = [-77, -22];
pathRoad("High Street west, down the bank to the mill as Mill Lane.", [[SQ.x0 + 1, HIGH_Z], [-54, HIGH_Z], [-60, -5]], 7, "cobble");
pathRoad(null, [[-60, -5], [-68, -13], MILL_YARD], 5.5, "dirt");
pathRoad("High Street east, and the farm lane on out of it up to the farmstead.", [[SQ.x1 - 1, HIGH_Z], [58, HIGH_Z], [63, 2]], 7, "cobble");
const FARM_YARD = [74, 56];
pathRoad(null, [[63, 2], [67, 12], [68, 30], [68, 46], FARM_YARD], 5.5, "dirt");
pathRoad("North Street, and on up through the Ashwood and out of the valley.", [[NORTH_X, SQ.z1 - 1], [NORTH_X, 50]], 6, "cobble");
pathRoad(null, [[NORTH_X, 50], [4, 60], [14, 74], [22, 90], [26, 120], [28, 190]], 5.5, "dirt", 26);
pathRoad("Cooper's Lane, the back street behind High Street east, out to the farm lane.", [[NORTH_X, COOPER_Z], [67.8, COOPER_Z]], 5, "cobble");
pathRoad("Church Street, and Church Lane up the hill to the chapel door.", [[NORTH_X, CHURCH_Z], [-38, CHURCH_Z]], 6, "cobble");
pathRoad(null, [[-38, CHURCH_Z], [-42, 46], [-50, 55], [-60, 57], [-60, 65]], 5, "dirt", 8);
pathRoad("South Street, to where the dock road and the moor road fork.", [[NORTH_X, SQ.z0 + 1], [NORTH_X, -38]], 6, "cobble");
pathRoad(null, [[NORTH_X, -38], [14, -48], [30, -58], [38, -64]], 5.5, "dirt", 14);
pathRoad(null, [[NORTH_X, -38], [-14, -48], [-34, -56], [-58, -60], [-72, -50], [-76, -36], MILL_YARD], 5, "dirt", 14);
pathRoad("Tanners Lane and Weavers Lane, the back streets of the south quarters.", [[TANNERS_X, HIGH_Z], [TANNERS_X, -62.5]], 5, "cobble");
pathRoad(null, [[WEST_X, HIGH_Z], [WEST_X, -56.8]], 5, "cobble");
pathRoad(
  "The Valeguard road: through the north-west gatehouse, round the chapel's hill and down the creek's east bank to the mill as Beck Lane.",
  [[-100, 190], [-100, 92], [-90, 81], [-84, 72], [-80, 48], [-74, 24], [-68, 6], [-65.5, -11.2]],
  5.5,
  "dirt",
  20,
);
pathRoad("The glebe path, off the Valeguard road to the churchyard's west gate.", [[-84, 72], [-80, 80]], 4, "dirt");
pathRoad(
  "The Redline road: through the south-east gatehouse and up the east side to the farmstead.",
  [[100, -190], [100, -92], [92, -80], [85, -60], [86, -30], [88, 0], [78, 14], [67.6, 20]],
  5.5,
  "dirt",
  20,
);
pathRoad("Bog Lane, off the Redline road along the bog's shore to the docks.", [[38, -64], [60, -68], [85.4, -58]], 5, "dirt");
pathRoad("The burying ground's gate path, off the moor road.", [[-30, -54.4], [-30, -72]], 4, "dirt");
pathRoad("Wood Lane, from the farmyard over the fields to the logging camp.", [FARM_YARD, [66, 72], [48, 84], [21, 86]], 5, "dirt", 18);

const network = roadNetwork(roadDefs);
const ROADS = network.footprint;
const onRoadAt = (x, z, pad = 0) => onRoad(ROADS, x, z, pad);

// No road runs into the water: the creek is crossed on foot, and the pools'
// lanes stop on their shores.
for (let x = -HALF; x <= HALF; x += 1) {
  for (let z = -HALF; z <= HALF; z += 1) {
    if (onRoadAt(x, z) && wet(x, z, 0)) {
      throw new Error(`road: a carriageway runs into the water at (${x}, ${z})`);
    }
  }
}

// --- what is already there ---------------------------------------------------

/**
 * Everything that has claimed ground, as axis-aligned rectangles. `solid` is
 * a building or a prop, `low` a spawn (refuses everything), `flag` a flag's
 * ground, and `open` a yard or the square — which refuses a building and
 * nothing else, and which is what a door is allowed to open onto.
 */
const claimed = [];
const refused = [];
const open = [];

const overlaps = makeOverlaps(claimed);

const claim = makeClaim(claimed);

const yard = makeYard(open, claim);

/** How far the floor falls across a footprint, from its centre's own height. */
const relief = makeRelief(floorAt);

const footOnRoad = makeFootOnRoad(onRoadAt);

const footWet = makeFootWet(wet, 0.35);

const inOpen = (x, z) => open.some((o) => x >= o.x0 && x <= o.x1 && z >= o.z0 && z <= o.z1);

/**
 * Whether a door opens onto somewhere: walk out of the front face's middle up
 * to `reach` metres and find a road, a yard or the square before anything
 * solid. Returns null when it does, and the reason when it does not.
 */
function doorway(kind, x, z, turn, params, self, reach = 14) {
  const [, , z0] = FOOT[kind](params ?? {});
  const [fx, fz] = turnOf(0, -1, turn);
  const [sx, sz] = turnOf(0, z0, turn);
  for (let t = 0.3; t <= reach; t += 0.5) {
    const px = x + sx + fx * t;
    const pz = z + sz + fz * t;
    if (onRoadAt(px, pz) || inOpen(px, pz)) return null;
    const hit = claimed.find((c) => c !== self && c.type === "solid" && px >= c.x0 && px <= c.x1 && pz >= c.z0 && pz <= c.z1);
    if (hit) return `door blocked by ${hit.note || "a claim"} at (${px.toFixed(0)}, ${pz.toFixed(0)})`;
    if (wet(px, pz, 0)) return `door opens onto the water at (${px.toFixed(0)}, ${pz.toFixed(0)})`;
  }
  return "door opens onto nothing";
}

/** A shed's door or a kiln's mouth only has to be clear for a couple of metres. */
const frontClear = makeFrontClear(FOOT, claimed, wet);

/**
 * Emit one placement, claiming its footprint first. Refused on a claim, on a
 * road, in the water, on a slope and — for a building — on a door that opens
 * onto nothing, unless an option says otherwise.
 */
function place(kind, x, z, turn, params, opts = {}) {
  const r = worldFoot(kind, x, z, turn, params);
  const pad = opts.pad ?? 0.8;
  const why = (() => {
    if (Math.max(Math.abs(r.x0), Math.abs(r.x1), Math.abs(r.z0), Math.abs(r.z1)) > HALF - 3) return "the edge";
    if (!opts.force) {
      // A yard refuses a building and takes anything else: that is what a
      // yard is. A flag's ring takes the same props — a cart and a stack of
      // crates are the cover a flag is fought over — but never on the flag.
      const prop = PROPS.has(kind);
      const hit = overlaps(r, pad, opts.skip ?? ((c) => (c.type === "open" && !DOORS.has(kind)) || (c.type === "flag" && prop)));
      if (prop && FLAGS.some((f) => f.x > r.x0 - 3 && f.x < r.x1 + 3 && f.z > r.z0 - 3 && f.z < r.z1 + 3)) return "a flag's own ground";
      if (hit) return `a ${hit.type} claim (${hit.note || "?"}) x ${hit.x0.toFixed(1)}..${hit.x1.toFixed(1)} z ${hit.z0.toFixed(1)}..${hit.z1.toFixed(1)}`;
      if (!opts.roadOk && footOnRoad(r)) return "a road";
      // A piece that reaches over the water on purpose (the mill's wheel, the
      // boathouse's water doors) states the part of it that must be dry, in
      // its own frame.
      const dry = opts.dry
        ? (() => {
            const [a, b, c, d] = opts.dry;
            const q = [turnOf(a, c, turn), turnOf(b, d, turn)];
            return { x0: Math.min(q[0][0], q[1][0]) + x, x1: Math.max(q[0][0], q[1][0]) + x, z0: Math.min(q[0][1], q[1][1]) + z, z1: Math.max(q[0][1], q[1][1]) + z };
          })()
        : r;
      if (!opts.wetOk && footWet(dry)) return "the water";
      if (!opts.anySlope && relief(dry) > (opts.flat ?? (PROPS.has(kind) ? 0.5 : FLAT))) return `a slope of ${relief(dry).toFixed(2)}`;
    }
    return null;
  })();
  if (why) {
    refused.push(`${opts.note ?? kind} (${kind}) at (${x.toFixed(0)}, ${z.toFixed(0)}) turn ${turn}: ${why}`);
    return false;
  }
  const self = opts.noClaim ? null : { ...r, type: "solid", note: opts.note ?? kind };
  if (self) claimed.push(self);
  const check = opts.noDoor ? null : DOORS.has(kind) ? doorway : FRONTS.has(kind) ? frontClear : null;
  if (check) {
    const bad = check(kind, x, z, turn, params, self);
    if (bad) {
      if (self) claimed.splice(claimed.indexOf(self), 1);
      refused.push(`${opts.note ?? kind} (${kind}) at (${x.toFixed(0)}, ${z.toFixed(0)}) turn ${turn}: ${bad}`);
      return false;
    }
  }
  emit(kind, x, z, turn, params, opts.y);
  return true;
}

/** A named set piece: place it, and refuse to write the map if it did not fit. */
const must = makeMust(place, refused);

/**
 * A lamp at a street corner, its arm (the builder's local +X) out over the
 * carriageway. `toward` is the side the road is on.
 */
function lamp(x, z, toward, note) {
  const turn = { east: 0, south: 1, west: 2, north: 3 }[toward];
  return place("lamp", x, z, turn, null, { pad: 0.3, roadOk: true, note: note ?? "a lamp" });
}

/** The turn whose front looks at the nearest carriageway or yard, and how far it is. */
function faceRoad(x, z, reach = 24) {
  let best = null;
  for (const turn of [0, 1, 2, 3]) {
    const [fx, fz] = turnOf(0, -1, turn);
    for (let t = 2; t <= reach; t += 0.5) {
      if (onRoadAt(x + fx * t, z + fz * t) || inOpen(x + fx * t, z + fz * t)) {
        if (!best || t < best.t) best = { turn, t };
        break;
      }
    }
  }
  return best ? best.turn : 0;
}

// --- the flags, the homes and the yards claim before any building does -------

const CHAPEL = { x: -60, z: 82 };
const FLAGS = [
  // Inside the nave, two metres up the aisle from the door, as it always was.
  { id: "A", name: "The Chapel", x: CHAPEL.x, z: CHAPEL.z + 2, r: 14, poleLift: 5.4, inside: true },
  { id: "B", name: "The Mill", x: -80, z: -27, r: 13 },
  // Just south of the well: standing the flag on the well would put its centre
  // inside a collider, where nothing can stand.
  { id: "C", name: "The Square", x: 0, z: -3, r: 14 },
  { id: "D", name: "The Farmstead", x: 86, z: 36, r: 13, poleLift: 3.4, inside: true },
  { id: "E", name: "The Bog Docks", x: 40, z: -76, r: 12, poleLift: 4.3, inside: true },
];
const byId = Object.fromEntries(FLAGS.map((f) => [f.id, f]));

/**
 * The boathouse stands where the bog's shore puts it rather than where a
 * number says: march south from the yard until the floor is the deck's height
 * less the deck's own 0.725, so the deck lands a step over the yard and the
 * water doors stand over the pool whatever the shore does.
 */
const BOAT = { x: 40, deck: -0.3 };
{
  let bz = -66;
  while (floorAt(BOAT.x, bz) > BOAT.deck - 0.725 && bz > -100) bz -= 0.25;
  BOAT.z = Number(bz.toFixed(1));
  byId.E.x = BOAT.x;
  byId.E.z = BOAT.z + 1.5;
}
for (const f of FLAGS) {
  if (f.inside) continue;
  claim({ x0: f.x - f.r * 0.6, x1: f.x + f.r * 0.6, z0: f.z - f.r * 0.6, z1: f.z + f.r * 0.6 }, "flag", `flag ${f.id}`);
}

// The square, and every yard a door may open onto.
yard(SQ.x0, SQ.x1, SQ.z0, SQ.z1, "the square");
yard(-90, -66, -42, -18, "the mill yard");
yard(70, 104, 50, 62, "the farmyard");
yard(24, 58, -70, -60, "the dock yard");
yard(-44, -18, -90, -66, "the burying ground");
yard(14, 44, 76, 84, "the logging camp's yard");
yard(-78, -42, 60, 104, "the churchyard");

const HOMES = [
  { team: 0, x: -100, gz: 112, sz: 96, turn: 0, yaw: "Math.PI", color: "@VALEGUARD" },
  { team: 1, x: 100, gz: -112, sz: -96, turn: 2, yaw: "0", color: "@REDLINE" },
];
const spawns = [];
for (const h of HOMES) {
  // Three spawns on the village side of the barricades, clear of the road
  // through the arch.
  for (const dx of [-7, 7, -13]) {
    const x = h.x + dx;
    const z = h.sz;
    if (onRoadAt(x, z, 1.2)) throw new Error(`spawn: T${h.team}'s home spawn at (${x}, ${z}) is on the road`);
    claim({ x0: x - 2.5, x1: x + 2.5, z0: z - 2.5, z1: z + 2.5 }, "low", "a home spawn");
    spawns.push(`  { team: ${h.team}, pos: new Vector3(${n2(x)}, ${n2(floorAt(x, z))}, ${n2(z)}), yaw: ${h.yaw} },`);
  }
}

/** One spawn per objective, outside its ring, on open ground. */
const FLAG_SPAWNS = [
  ["A", 0, -22, "Math.PI"],
  ["B", 8, -16, "0"],
  ["C", 1, -18, "0"],
  ["D", -22, 18, "Math.PI / 2"],
  ["E", -14, 12, "Math.PI"],
];
for (const [id, dx, dz, yaw] of FLAG_SPAWNS) {
  const f = byId[id];
  const x = f.x + dx;
  const z = f.z + dz;
  claim({ x0: x - 2.5, x1: x + 2.5, z0: z - 2.5, z1: z + 2.5 }, "low", `${id}'s spawn`);
  if (wet(x, z)) throw new Error(`spawn: ${id}'s spawn at (${x}, ${z}) is in the water`);
  if (Math.hypot(dx, dz) <= f.r) throw new Error(`spawn: ${id}'s spawn is inside its own ring`);
  spawns.push(`  { team: null, controlPoint: "${id}", pos: new Vector3(${n2(x)}, ${n2(floorAt(x, z))}, ${n2(z)}), yaw: ${yaw} },`);
}

// --- the home yards ----------------------------------------------------------

section(placements, "home yards");
placements.push(
  "  // Each gatehouse arches over its home road where it comes in off the edge",
  "  // of the map; the barricades face the village, and the side deploys on",
  "  // the village side of them.",
);
for (const h of HOMES) {
  must("gatehouse", h.x, h.gz, h.turn, { teamColor: h.color }, { force: true, note: "a gatehouse" });
  claim(worldFoot("gatehouse", h.x, h.gz, h.turn, {}), "solid", "a gatehouse");
}
// Valeguard's yard: a picket's stores either side of the road.
place("cart", -114, 86, 0, null);
place("crates", -108, 91, 0, null);
place("woodpile", -104, 84, 0, { length: 4 });
place("shed", -86, 90, 1, { width: 4, depth: 3 }, { note: "the picket's store" });
lamp(-96, 101, "west");
// Redline's.
place("cart", 112, -86, 0, null);
place("crates", 108, -91, 0, null);
place("woodpile", 104, -84, 0, { length: 4 });
place("shed", 86, -90, 3, { width: 4, depth: 3 }, { note: "the picket's store" });
lamp(96, -101, "east");

// --- C — the square ----------------------------------------------------------

section(placements, "C: The Square");
placements.push(
  "  // The market square at the crossing of High Street and North Street: the",
  "  // well at its head, stalls round the flag, and every building round it",
  "  // turned to face it — the inn on the north side, the forge on the south,",
  "  // townhouses down the other two. No cover taller than a stall inside the",
  "  // paving, and four streets in: the flag nobody keeps.",
);
must("well", NORTH_X - 1, 7, 0, null, { force: true, note: "the well" });
// A stall's counter is its local -Z, so each is turned to face the flag.
for (const [x, z, t] of [[-10, 4, 0], [10, 4, 0], [-11, -10, 2], [11, -10, 2]]) {
  must("stall", x, z, t, null, { force: true, note: "a stall" });
}
must("cart", -14.5, -14, 0, { ruined: true }, { force: true, note: "a cart" });
must("crates", 14.5, 8.5, 0, null, { force: true, note: "crates" });
must("trough", -14.5, 9, 1, null, { force: true, note: "a trough" });
// The inn, on the north side of the square: its porch to the square, its yard
// behind to Church Street.
must("tavern", -10.5, SQ.z1 + 0.4 + 9.2, 0, null, { note: "the inn", pad: 0.3 });
// The forge, on the south side, its open front to the square.
must("smithy", -9.5, SQ.z0 - 0.4 - 6.6, 2, null, { note: "the forge", pad: 0.3 });

/**
 * A row of houses along a street. `edge` is the kerb's coordinate, `a..b` the
 * run along it, and `face` the side of the house the street is on — so every
 * house in a row faces its street by construction. `kinds` is the row's
 * recipe: each entry `[kind, weight, params]`, and `burnt` is the share of the
 * row the fire took.
 */
function houseRow(edge, a, b, face, kinds, opts = {}) {
  const alongX = face === "north" || face === "south";
  const turn = FACES[face];
  const back = { south: 1, north: -1, west: 1, east: -1 }[face];
  const setback = opts.setback ?? [0.6, 1.4];
  let t = Math.min(a, b);
  const end = Math.max(a, b);
  const total = kinds.reduce((s, k) => s + k[1], 0);
  let placedHere = 0;
  while (t < end) {
    let roll = rng() * total;
    let spec = kinds[0];
    for (const k of kinds) {
      roll -= k[1];
      if (roll <= 0) {
        spec = k;
        break;
      }
    }
    const [kind0, , base] = spec;
    let kind = kind0;
    let params = { ...(typeof base === "function" ? base(opts) : base) };
    // What the fire did to it: a cottage is burnt out under its own roof, and
    // a townhouse — which has no burnt state of its own — is a shell.
    if (chance(opts.burnt ?? 0)) {
      if (kind === "townhouse" || chance(0.4)) {
        kind = "ruin";
        params = { width: Number(rand(7, 9).toFixed(1)), depth: Number(rand(6, 7).toFixed(1)) };
      } else {
        params = { width: params.width, depth: params.depth, ruined: true };
      }
    }
    const [x0, x1, z0] = FOOT[kind](params);
    const w = x1 - x0;
    const front = -z0;
    if (t + w > end) {
      t += 1;
      if (t + 5 > end) break;
      continue;
    }
    const mid = t + w / 2 - (x0 + x1) / 2;
    const off = edge + back * (rand(setback[0], setback[1]) + front);
    const [x, z] = alongX ? [mid, off] : [off, mid];
    // Along the street a row runs in the world's direction and a building's
    // own +X points the other way on two of the four faces, which is what the
    // mid-point above corrects for.
    if (place(kind, Number(x.toFixed(1)), Number(z.toFixed(1)), turn, params, { pad: opts.pad ?? 0.3, note: opts.note ?? kind })) {
      placedHere++;
      t += w + (kind === "townhouse" ? rand(0.2, 0.6) : rand(1.2, 3.2));
    } else {
      t += 1;
    }
  }
  return placedHere;
}

const cottage = (o = {}) => ({
  width: Number(rand(6.5, 8.5).toFixed(1)),
  depth: Number(rand(5.6, 6.6).toFixed(1)),
  ...(chance(o.enterable ?? 0.35) ? { enterable: true } : {}),
  ...(chance(o.lit ?? 0.3) ? { litWindows: true } : {}),
});
const townhouse = (o = {}) => ({
  width: Number(rand(6, 7.2).toFixed(1)),
  depth: Number(rand(6.2, 7).toFixed(1)),
  ...(chance(o.enterable ?? 0.35) ? { enterable: true } : {}),
  ...(chance(o.lit ?? 0.35) ? { litWindows: true } : {}),
});
const TOWN = [["townhouse", 3, townhouse], ["cottage", 1, cottage]];
const VILLAGE = [["cottage", 3, cottage], ["townhouse", 1, townhouse]];
const CROFTS = [["cottage", 1, cottage]];

// The square's other two sides and the inn's and forge's neighbours. The
// north and south rows run on past the square's corners, so each corner is one
// house turned to the square rather than two backing onto each other.
const HW = 3.5; // High Street's half-width
houseRow(SQ.z1, NORTH_X + 3.4, 28, "south", TOWN, { note: "the square, north side", lit: 0.6, burnt: 0.1 });
houseRow(SQ.z0, NORTH_X + 3.4, 28, "north", TOWN, { note: "the square, south side", lit: 0.4, burnt: 0.35 });
houseRow(SQ.x0, HIGH_Z + HW + 0.5, SQ.z1, "east", TOWN, { note: "the square, west side", lit: 0.5, burnt: 0.15 });
houseRow(SQ.x0, SQ.z0, HIGH_Z - HW - 0.5, "east", TOWN, { note: "the square, west side", lit: 0.4, burnt: 0.3 });
houseRow(SQ.x1, HIGH_Z + HW + 0.5, SQ.z1, "west", TOWN, { note: "the square, east side", lit: 0.5, burnt: 0.15 });
houseRow(SQ.x1, SQ.z0, HIGH_Z - HW - 0.5, "west", TOWN, { note: "the square, east side", lit: 0.4, burnt: 0.3 });
lamp(-16.8, 11.8, "east", "a lamp on the square");
lamp(16.8, 11.8, "west", "a lamp on the square");
lamp(-16.8, -15.8, "east", "a lamp on the square");
lamp(16.8, -15.8, "west", "a lamp on the square");

// --- the streets -------------------------------------------------------------

section(placements, "the streets");
placements.push(
  "  // Every house on a street faces it. The fire came up from the south-east",
  "  // and took most of Tanners Lane and the south quarter; the north of the",
  "  // village is where the lamps are still lit.",
);
// High Street west, both sides, gapped for Weavers Lane.
houseRow(HIGH_Z + HW, -54, -28.5, "south", TOWN, { note: "High Street west", lit: 0.45, burnt: 0.3 });
houseRow(HIGH_Z - HW, -54, WEST_X - 3, "north", TOWN, { note: "High Street west", lit: 0.35, burnt: 0.35 });
// High Street east, gapped for Tanners Lane.
houseRow(HIGH_Z + HW, 28.5, 58, "south", TOWN, { note: "High Street east", lit: 0.4, burnt: 0.3 });
houseRow(HIGH_Z - HW, TANNERS_X + 3, 58, "north", TOWN, { note: "High Street east", lit: 0.2, burnt: 0.55 });
// North Street, both sides, up to Church Street and beyond it.
houseRow(NORTH_X + 3, COOPER_Z + 2.5, 54, "west", VILLAGE, { note: "North Street", lit: 0.55, burnt: 0.1 });
// Cooper's Lane, both sides.
houseRow(COOPER_Z + 2.5, NORTH_X + 3, 62, "south", VILLAGE, { note: "Cooper's Lane", lit: 0.4, burnt: 0.3 });
houseRow(COOPER_Z - 2.5, 22, 62, "north", VILLAGE, { note: "Cooper's Lane", lit: 0.4, burnt: 0.3 });
houseRow(NORTH_X - 3, CHURCH_Z + 3, 54, "east", VILLAGE, { note: "North Street", lit: 0.55, burnt: 0.1 });
// Church Street, both sides — the inn's yard takes the south side's east end.
houseRow(CHURCH_Z + 3, -36, -12, "south", VILLAGE, { note: "Church Street", lit: 0.5, burnt: 0.15 });
houseRow(CHURCH_Z - 3, -37, -18.5, "north", VILLAGE, { note: "Church Street", lit: 0.5, burnt: 0.15 });
// South Street, both sides, down to the fork.
houseRow(NORTH_X - 3, -34, -29.5, "east", VILLAGE, { note: "South Street", lit: 0.15, burnt: 0.55 });
houseRow(NORTH_X + 3, -34, -26, "west", VILLAGE, { note: "South Street", lit: 0.15, burnt: 0.55 });
// Tanners Lane, both sides: the worst of the fire.
houseRow(TANNERS_X - 2.5, -48, -26, "east", VILLAGE, { note: "Tanners Lane", lit: 0.05, burnt: 0.75 });
houseRow(TANNERS_X + 2.5, -48, -13.5, "west", VILLAGE, { note: "Tanners Lane", lit: 0.05, burnt: 0.7 });
// Weavers Lane, both sides.
houseRow(WEST_X - 2.5, -48, -13.5, "east", VILLAGE, { note: "Weavers Lane", lit: 0.25, burnt: 0.4 });
houseRow(WEST_X + 2.5, -48, -26, "west", VILLAGE, { note: "Weavers Lane", lit: 0.25, burnt: 0.4 });
// Street corners.
lamp(-29, HIGH_Z + 4, "south", "a lamp on High Street");
lamp(-53, HIGH_Z - 4, "north", "a lamp on High Street");
lamp(57, HIGH_Z + 4, "south", "a lamp on High Street");
lamp(29, HIGH_Z - 4, "north", "a lamp on High Street");
lamp(NORTH_X - 3.6, CHURCH_Z - 3.8, "east", "a lamp on North Street");
lamp(-37, CHURCH_Z + 3.6, "south", "a lamp on Church Street");

// --- A — the chapel ----------------------------------------------------------

section(placements, "A: The Chapel");
placements.push(
  "  // The parish church on the crown of the hill, its door to the south and",
  "  // Church Lane climbing to it; the churchyard walled round it, with a gate",
  "  // where each lane arrives. The high ground over the village, and the one",
  "  // flag that stands clear of the mist.",
);
must("chapel", CHAPEL.x, CHAPEL.z, 0, null, { note: "the chapel", noDoor: true, skip: (c) => c.type === "open" });
// The vicarage on the glebe below the gate, its door to the lane.
place("cottage", -57, 46, 2, { width: 8.5, depth: 6.4, enterable: true, litWindows: true }, { note: "the vicarage" });
lamp(-64.5, 62, "east", "a lamp at the lych gate");
lamp(-71.5, 22, "west", "a lamp on Beck Row");

// --- B — the mill ------------------------------------------------------------

section(placements, "B: The Mill");
placements.push(
  "  // The mill stands on the creek's east bank down in the dell, its wheel over",
  "  // the water and its door to the yard. Three lanes meet in the yard and the",
  "  // bank rises two metres to the village behind it, so whoever holds the",
  "  // crest shoots down into the flag.",
);
{
  const cx = creekX(MILL_Z);
  // Eleven and a half metres off the creek's centreline puts the wheel (local
  // -X) over the water and the walls on the pad.
  must("mill", Number((cx + 11.5).toFixed(1)), MILL_Z, 0, null, { note: "the mill", dry: [-4, 5, -4.5, 4.5] });
  place("cottage", -76, 1, 3, { width: 8, depth: 6.2, enterable: true, litWindows: true }, { note: "the miller's house" });
  place("shed", -80, -45, 2, { width: 5, depth: 3.2 }, { note: "the mill store" });
  place("cart", -84, -20, 0, null, { note: "a cart" });
  place("crates", -84, -34, 0, null);
  lamp(-80, -41, "north", "a lamp in the mill yard");
}

// --- D — the farmstead -------------------------------------------------------

section(placements, "D: The Farmstead");
placements.push(
  "  // The barn on the farm's rise, its cart doors to the farmyard on the north",
  "  // and its loft ramp up the west side to the lane: the map's best perch,",
  "  // and an exposed climb to it. The farmhouse faces the yard across it.",
);
must("barn", byId.D.x, byId.D.z, 2, null, { note: "the barn" });
must("cottage", 94, 69, 0, { width: 9, depth: 6.5, enterable: true, litWindows: true }, { note: "the farmhouse" });
must("silo", 101, 30, 0, null, { note: "the silo" });
place("shed", 78, 67, 0, { width: 6, depth: 3.4 }, { note: "the cart shed" });
place("haystack", 106, 20, 0, null);
place("haystack", 96, 18, 0, null);
place("haystack", 106, 48, 0, null);
place("cart", 100, 56, 1, null);
place("trough", 88, 55, 0, null);
place("woodpile", 104, 64, 1, { length: 5 });
lamp(66, 50, "east", "a lamp in the farmyard");

// --- E — the bog docks -------------------------------------------------------

section(placements, "E: The Bog Docks");
placements.push(
  "  // The boathouse on the bog's north shore, its boat door to the yard and its",
  "  // water doors over the pool; two jetties out into the bog either side of",
  "  // it, the fishermen's cottages round the yard. A brawl in the thickest",
  "  // mist on the map.",
);
must("boathouse", BOAT.x, BOAT.z, 2, null, { note: "the boathouse", dry: [-6, 7.2, -7, -2.5], flat: 1.8 });
// The jetties, rooted on the shore and run out over the pool.
for (const jx of [22, 58]) {
  let root = -66;
  while (floorAt(jx, root) > -0.9 && root > -100) root -= 0.25;
  const len = 18;
  const cz = root - len / 2 + 1;
  const deck = -0.85;
  const y = deck - 0.57 - floorAt(jx, cz);
  must("jetty", jx, Number(cz.toFixed(1)), 0, { length: len }, { force: true, y: Number(y.toFixed(2)), note: "a jetty" });
  claim(worldFoot("jetty", jx, cz, 0, { length: len }), "solid", "a jetty");
}
place("cottage", 14, -60, 3, { width: 7, depth: 6, ruined: true }, { note: "a fisherman's cottage" });
place("ruin", 8, -69.5, 3, { width: 8, depth: 6.5 }, { note: "the net loft" });
place("shed", 52, -60, 2, { width: 5, depth: 3 }, { note: "a net shed" });
place("shed", 44, -57, 2, { width: 4.4, depth: 3 }, { note: "a net shed" });
place("kiln", 8, -52, 3, null, { note: "the smokehouse" });
place("crates", 28, -73, 0, null);
place("crates", 51, -73, 1, null);
lamp(29.5, -72, "east", "a lamp in the dock yard");

// --- the Ashwood ---------------------------------------------------------------

section(placements, "the Ashwood");
placements.push(
  "  // The logging camp in the felled woods north of the village: the charcoal",
  "  // kilns with their mouths to Wood Lane, the cordwood stacked round them,",
  "  // the colliers' huts, and the look-out on its shelf over the north road.",
);
for (const x of [20, 30, 40]) place("kiln", x, 71, 2, null, { note: "a charcoal kiln" });
place("woodpile", 8, 80, 1, { length: 6 });
place("woodpile", 44, 78, 1, { length: 6 });
place("woodpile", 40, 96, 0, { length: 7 });
place("woodpile", 36, 66, 0, { length: 5 });
place("shed", 12, 98, 3, { width: 5, depth: 3.2 }, { note: "a collier's hut" });
place("shed", 50, 91, 0, { width: 4, depth: 3 }, { note: "a collier's hut" });
place("ruin", 8, 92, 3, { width: 8, depth: 6.5 }, { note: "the woodward's cottage" });
place("cart", 38, 80, 0, null);
place("crates", 26, 79, 0, null);
place("watchtower", 32, 108, 0, null, { note: "the Ashwood look-out", noDoor: true });
lamp(24.5, 81, "west", "a lamp at the camp");

// --- the east holdings ---------------------------------------------------------

section(placements, "the east holdings");
placements.push(
  "  // Outlying farms along the Redline road: the tithe barn with its doors to",
  "  // the road, a silo, the look-out on the swell, and the burnt-out steadings",
  "  // between them.",
);
place("barn", 104, -52, 1, null, { note: "the tithe barn" });
place("silo", 110, -74, 0, null, { note: "a silo" });
place("watchtower", 108, -26, 1, null, { note: "the Redline look-out", noDoor: true });
place("cottage", 104, -6, 1, { width: 8, depth: 6.2, litWindows: true }, { note: "a steading" });
place("cottage", 76, -44, 3, { width: 7.5, depth: 6, ruined: true }, { note: "a steading" });
place("ruin", 76, -20, 3, { width: 9, depth: 7 }, { note: "a steading" });
place("haystack", 100, -34, 0, null);
place("cart", 80, -74, 0, { ruined: true });
place("shrine", 82, -6, 0, null, { pad: 0.3 });

// --- the burying ground and the moor ------------------------------------------

section(placements, "the burying ground and the moor");
placements.push(
  "  // The plague ground on the moor road, walled, with the charnel house's",
  "  // shell inside it; and past it the drowned crofts round the mire, with a",
  "  // jetty out into it and the moor's look-out.",
);
place("ruin", -30, -84, 2, { width: 8, depth: 6 }, { note: "the charnel house", skip: (c) => c.type === "open" });
place("shrine", -22, -69, 0, null, { pad: 0.3 });
place("cottage", -56, -68, 2, { width: 7.5, depth: 6, ruined: true }, { note: "a drowned croft" });
place("ruin", -66, -67, 2, { width: 8, depth: 6.5 }, { note: "a drowned croft" });
place("cottage", -8, -58, 2, { width: 7, depth: 6, ruined: true }, { note: "a croft on the moor road" });
place("kiln", -54, -80, 2, null, { note: "a peat kiln" });
place("watchtower", -104, -84, 2, null, { note: "the moor look-out", noDoor: true, flat: 0.6 });
{
  // The mire's one jetty, from the crofts' shore.
  const jx = -58;
  let root = -80;
  while (floorAt(jx, root) > -0.9 && root > -110) root -= 0.25;
  const len = 14;
  const cz = root - len / 2 + 1;
  const y = -0.85 - 0.57 - floorAt(jx, cz);
  place("jetty", jx, Number(cz.toFixed(1)), 0, { length: len }, { force: true, y: Number(y.toFixed(2)), note: "the mire jetty" });
  claim(worldFoot("jetty", jx, cz, 0, { length: len }), "solid", "a jetty");
}

// --- the west bank -----------------------------------------------------------

section(placements, "the creek's west bank");
placements.push(
  "  // Two footbridges over the creek, bank to bank: one at the mill and one",
  "  // under the chapel's hill where it comes in off the edge. Everywhere else",
  "  // the creek is waded. A bridge samples the ground once, at its centre —",
  "  // the creek's bed — so `y` lifts its local zero back to the lower bank.",
);
{
  // The mill's footbridge, west across the creek from the yard.
  const bz = -30;
  const bx = creekX(bz);
  const len = 2 * (LIP + 1);
  const ends = Math.min(floorAt(bx - len / 2, bz), floorAt(bx + len / 2, bz));
  must("bridge", Number(bx.toFixed(1)), bz, 1, { length: len, width: 2.6 }, { force: true, y: Number((ends - floorAt(bx, bz)).toFixed(2)), note: "the mill footbridge" });
  claim(worldFoot("bridge", bx, bz, 1, { length: len, width: 2.6 }), "solid", "the mill footbridge");
  for (const s of [-1, 1]) {
    const lx = bx + s * (len / 2 + 2.5);
    claim({ x0: lx - 2.5, x1: lx + 2.5, z0: bz - 1.6, z1: bz + 1.6 }, "open", "the footbridge's landing");
    open.push({ x0: lx - 2.5, x1: lx + 2.5, z0: bz - 1.6, z1: bz + 1.6 });
  }
}
{
  // The hill footbridge, north across the creek's upper reach.
  const bx = -110;
  const bz = creekZ(bx);
  const len = 2 * (LIP + 1);
  const ends = Math.min(floorAt(bx, bz - len / 2), floorAt(bx, bz + len / 2));
  must("bridge", bx, Number(bz.toFixed(1)), 0, { length: len, width: 2.6 }, { force: true, y: Number((ends - floorAt(bx, bz)).toFixed(2)), note: "the hill footbridge" });
  claim(worldFoot("bridge", bx, bz, 0, { length: len, width: 2.6 }), "solid", "the hill footbridge");
  for (const s of [-1, 1]) {
    const lz = bz + s * (len / 2 + 2.5);
    claim({ x0: bx - 1.6, x1: bx + 1.6, z0: lz - 2.5, z1: lz + 2.5 }, "open", "the footbridge's landing");
    open.push({ x0: bx - 1.6, x1: bx + 1.6, z0: lz - 2.5, z1: lz + 2.5 });
  }
}
place("ruin", -111, -30, 3, { width: 8, depth: 6.5 }, { note: "the west bank croft" });
place("shed", -112, -56, 1, { width: 4, depth: 3 }, { note: "a turf shed" });
place("ruin", -110, 50, 0, { width: 8, depth: 6 }, { note: "the ferryman's cottage" });

// --- the lanes and the back plots ----------------------------------------------

/**
 * Cottages strung along a lane out of the village, one each side every `step`
 * metres, each turned to whichever of its four faces looks most squarely at the
 * lane — the way a village runs out along its roads. `side` is +1 for the
 * left of the direction of travel, -1 for the right, 0 for both.
 */
function laneside(points, step, side, kinds, opts = {}) {
  let n = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const [ax, az] = points[i];
    const [bx, bz] = points[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    for (let t = step / 2; t < len - 2; t += step) {
      for (const sd of side === 0 ? [1, -1] : [side]) {
        if (!chance(opts.fill ?? 0.8)) continue;
        // The lane's left is (-uz, ux).
        const nx = -uz * sd;
        const nz = ux * sd;
        const total = kinds.reduce((q, k) => q + k[1], 0);
        let roll = rng() * total;
        let spec = kinds[0];
        for (const k of kinds) {
          roll -= k[1];
          if (roll <= 0) {
            spec = k;
            break;
          }
        }
        let [kind, , base] = spec;
        let params = { ...(typeof base === "function" ? base(opts) : base) };
        if (chance(opts.burnt ?? 0)) {
          if (kind === "townhouse" || chance(0.4)) {
            kind = "ruin";
            params = { width: Number(rand(7, 9).toFixed(1)), depth: Number(rand(6, 7).toFixed(1)) };
          } else {
            params = { width: params.width, depth: params.depth, ruined: true };
          }
        }
        // The face whose front points back at the lane.
        let turn = 0;
        let best = -Infinity;
        for (const tt of [0, 1, 2, 3]) {
          const [fx, fz] = turnOf(0, -1, tt);
          const d = -(fx * nx + fz * nz);
          if (d > best) {
            best = d;
            turn = tt;
          }
        }
        const [, , z0, z1] = FOOT[kind](params);
        const off = (opts.hw ?? 2.75) + rand(1.2, 2.4) + (z1 - z0) / 2;
        const x = ax + ux * t + nx * off;
        const z = az + uz * t + nz * off;
        if (place(kind, Number(x.toFixed(1)), Number(z.toFixed(1)), turn, params, { pad: 1.0, note: opts.note ?? kind })) n++;
      }
    }
  }
  return n;
}

section(placements, "the lanes");
placements.push(
  "  // Crofts strung out along the lanes where the village runs out into the",
  "  // country, each turned to its lane. The further from the square, the more",
  "  // of them are shells.",
);
laneside([[NORTH_X, 50], [4, 60], [14, 74]], 11, 0, CROFTS, { note: "the north road", lit: 0.35, burnt: 0.3 });
laneside([[-38, CHURCH_Z], [-42, 46]], 10, -1, CROFTS, { note: "Church Lane", lit: 0.4, burnt: 0.2 });
laneside([[NORTH_X, -38], [14, -48], [30, -58]], 10, 0, CROFTS, { note: "the dock road", lit: 0.1, burnt: 0.6 });
laneside([[NORTH_X, -38], [-14, -48], [-34, -56], [-58, -60]], 10, 0, CROFTS, { note: "the moor road", lit: 0.1, burnt: 0.6 });
laneside([[63, 2], [67, 12], [68, 30]], 10, 0, CROFTS, { note: "the farm lane", lit: 0.3, burnt: 0.4 });
laneside([[-80, 48], [-74, 24], [-68, 6]], 10, 1, CROFTS, { note: "Beck Row", lit: 0.4, burnt: 0.3 });
laneside([[38, -64], [60, -68], [85.4, -58]], 10, 1, CROFTS, { note: "Bog Lane", lit: 0.1, burnt: 0.6 });
laneside([[88, 0], [86, -30]], 10, 0, CROFTS, { note: "the Redline road", lit: 0.2, burnt: 0.6 });

// Back plots: a shed, a woodpile or a haystack behind the rows.
for (let i = 0; i < 90; i++) {
  const x = rand(-54, 56);
  const z = rand(-46, 48);
  const kind = pick(["shed", "shed", "woodpile", "woodpile", "haystack", "crates", "cart"]);
  const params =
    kind === "shed"
      ? { width: Number(rand(3, 4.4).toFixed(1)), depth: Number(rand(2.6, 3.2).toFixed(1)) }
      : kind === "woodpile"
        ? { length: Number(rand(3, 5).toFixed(1)) }
        : kind === "cart" && chance(0.5)
          ? { ruined: true }
          : null;
  // Every claim refuses these, the square and the yards included: a back plot
  // is behind a house, never on the ground the village is laid out round.
  place(kind, Number(x.toFixed(1)), Number(z.toFixed(1)), Math.floor(rng() * 4), params, { pad: 1.2, skip: () => false, note: "a back plot" });
}

// --- the fields --------------------------------------------------------------

/**
 * The field boundaries, as long lines: `[x0, z0, x1, z1, kind]`, axis-aligned:
 * `wall` for dry stone (stops a round) and `fence` for post and rail (stops a
 * body). Each is cut into runs wherever it meets a road, a claim or the water,
 * so the gates are where the lanes are; a run shorter than `MIN_RUN` is
 * dropped, and a long one split into lengths the builder steps well on a
 * slope. Laid one line at a time, so a line meeting one already laid stops
 * short of it rather than running through it.
 */
const BOUNDARIES = [
  // The churchyard, walled round the crown, its gates where the lanes arrive.
  [-78, 60, -42, 60, "wall"],
  [-78, 60, -78, 104, "wall"],
  [-42, 60, -42, 104, "wall"],
  [-78, 104, -42, 104, "wall"],
  // The crest over the mill's dell — the wall the village holds B from.
  [-60, -48, -60, 16, "wall"],
  // The farmstead's paddocks.
  [60, 14, 112, 14, "fence"],
  [112, 14, 112, 70, "fence"],
  [60, 14, 60, 64, "fence"],
  // The fields between the farm and the Ashwood.
  [54, 76, 112, 76, "wall"],
  [80, 76, 80, 112, "wall"],
  [56, 100, 112, 100, "wall"],
  // The Ashwood's field walls.
  [-4, 64, 54, 64, "wall"],
  [-10, 64, -10, 110, "wall"],
  [-10, 110, 40, 110, "wall"],
  // North of the village, under the chapel's hill.
  [-36, 66, -12, 66, "wall"],
  [-28, 66, -28, 112, "wall"],
  // The east holdings.
  [70, -84, 70, -8, "wall"],
  [70, -40, 118, -40, "fence"],
  [76, -86, 118, -86, "wall"],
  // Between the village and the bog.
  [4, -52, 70, -52, "wall"],
  // The burying ground, walled on all four sides.
  [-46, -64, -16, -64, "wall"],
  [-46, -64, -46, -92, "wall"],
  [-16, -64, -16, -92, "wall"],
  [-46, -92, -16, -92, "wall"],
  // The moor.
  [-116, -60, -80, -60, "wall"],
  [-44, -100, -10, -100, "wall"],
  [-10, -60, -10, -116, "fence"],
  // The Valeguard upland.
  [-116, 76, -84, 76, "wall"],
  [-84, 76, -84, 116, "fence"],
];
const MIN_RUN = 5;
const MAX_RUN = 22;

/** Whether a point on a boundary line may carry a run. */
function runnable(x, z) {
  if (Math.abs(x) > HALF - 3 || Math.abs(z) > HALF - 3) return false;
  if (onRoadAt(x, z, 1.8)) return false;
  if (wet(x, z, 0.4)) return false;
  if (grade(x, z) > 0.3) return false;
  for (const c of claimed) {
    if (c.type === "open" || c.type === "flag") continue;
    const pad = c.type === "low" ? 2 : 1.4;
    if (x > c.x0 - pad && x < c.x1 + pad && z > c.z0 - pad && z < c.z1 + pad) return false;
  }
  for (const f of FLAGS) if (Math.hypot(x - f.x, z - f.z) < 3) return false;
  return true;
}

section(placements, "the fields");
placements.push(
  "  // Every wall and fence line, cut into runs wherever a lane, a building or",
  "  // the water crosses it — so the gates are where the lanes are. Dry stone",
  "  // stops a round; post and rail stops only a body.",
);
const runs = [];
for (const [x0, z0, x1, z1, kind] of BOUNDARIES) {
  const alongX = z0 === z1;
  const a = alongX ? Math.min(x0, x1) : Math.min(z0, z1);
  const b = alongX ? Math.max(x0, x1) : Math.max(z0, z1);
  const at = alongX ? z0 : x0;
  const here = [];
  let start = null;
  const flush = (end) => {
    if (start === null) return;
    const len = end - start;
    if (len >= MIN_RUN) {
      const pieces = Math.ceil(len / MAX_RUN);
      const each = len / pieces;
      for (let k = 0; k < pieces; k++) {
        const s0 = start + k * each + (k > 0 ? 0.25 : 0);
        const s1 = start + (k + 1) * each - (k < pieces - 1 ? 0.25 : 0);
        here.push({ alongX, at, s0, s1, kind });
      }
    }
    start = null;
  };
  for (let s = a; s <= b; s += 0.5) {
    const [x, z] = alongX ? [s, at] : [at, s];
    if (runnable(x, z)) {
      if (start === null) start = s;
    } else {
      flush(s - 0.5);
    }
  }
  flush(b);
  // Placed before the next line is cut, so the next one stops against it.
  for (const r of here) {
    const len = Number((r.s1 - r.s0).toFixed(1));
    const mid = (r.s0 + r.s1) / 2;
    const [x, z] = r.alongX ? [mid, r.at] : [r.at, mid];
    const wk = r.kind === "wall" ? "stoneWall" : "fence";
    if (place(wk, Number(x.toFixed(1)), Number(z.toFixed(1)), r.alongX ? 0 : 1, { length: len }, { anySlope: true, pad: 0, note: "a field boundary", skip: (c) => c.type === "open" || c.type === "flag" })) {
      r.placed = true;
      runs.push(r);
    }
  }
}

// Field furniture: haystacks in the paddocks, ruins and carts out in the fields.
for (const [kind, x, z, t, p] of [
  ["haystack", 66, 84, 0], ["haystack", 92, 84, 0], ["haystack", 100, 90, 0], ["haystack", 78, -68, 0],
  ["haystack", -4, -76, 0],
  ["trough", 70, 90, 0], ["trough", -104, 66, 1],
  ["ruin", -4, 72, 3, { width: 9, depth: 7 }],
  ["cart", 55, 40, 1, { ruined: true }], ["cart", -20, 100, 0, { ruined: true }], ["cart", -96, -70, 0, { ruined: true }],
  ["shrine", 58, -40, 0], ["shrine", -86, 40, 0],
]) {
  place(kind, x, z, t, p ?? null, { note: `a field ${kind}`, pad: 1 });
}

// --- the dressing -------------------------------------------------------------

/**
 * Whether a grove of radius `r` may be sown at (x, z): its whole disc dry,
 * clear of every claim but a road (a road already refuses what grows), under
 * `maxGrade`, and inside the square.
 *
 * Clear of every claim is a choice about the LOOK rather than a guard: the
 * builder's own burial test keeps each prop out of every collider, but a stand
 * sown over a yard or a building still spends its count on refusals and packs
 * what is left against the walls.
 */
function groveOk(x, z, r, maxGrade = 0.3, skipOpen = false, tall = false) {
  if (Math.abs(x) + r > HALF - 2 || Math.abs(z) + r > HALF - 2) return false;
  const box = { x0: x - r, x1: x + r, z0: z - r, z1: z + r };
  // A stand of trees may straddle a field wall: a trunk is taller than any
  // wall, so the burial test sees it, and a hedge of dead wood along a wall
  // is what a field boundary looks like here.
  const skip = (c) => (skipOpen && c.type === "open") || c.type === "flag" || (tall && c.note === "a field boundary");
  if (overlaps(box, 0.5, skip)) return false;
  for (const f of FLAGS) if (Math.hypot(x - f.x, z - f.z) < r + 4) return false;
  const ring = r > 8 ? 16 : 8;
  for (let k = 0; k <= ring; k++) {
    const a = (k / ring) * Math.PI * 2;
    const f = k === ring ? 0 : 1;
    const px = x + f * Math.cos(a) * (r + 1);
    const pz = z + f * Math.sin(a) * (r + 1);
    if (wet(px, pz, 0.4)) return false;
    if (grade(px, pz) > maxGrade) return false;
  }
  return true;
}

/** `groveOk` for a rectangular region: clear of every claim but a yard, dry and walkable. */
function rectOk(x, z, w, d, maxGrade = 0.3) {
  const box = { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 };
  if (overlaps(box, 0.6, (c) => c.type === "open" || c.type === "flag")) return false;
  for (const fx of [0, 0.25, 0.5, 0.75, 1]) {
    for (const fz of [0, 0.25, 0.5, 0.75, 1]) {
      const px = box.x0 + fx * w;
      const pz = box.z0 + fz * d;
      if (wet(px, pz, 0.4) || grade(px, pz) > maxGrade) return false;
    }
  }
  return true;
}

const { disc, rectRegion } = makeScatter(scatter, regions);

const TREE = ", scale: [0.9, 1.7], blocking: true, clearance: 0.55";
const STONE = ", scale: [0.8, 1.3], blocking: true, clearance: 0.6";
let trees = 0;

section(scatter, "the churchyard");
scatter.push(
  "  // Headstones either side of the nave and behind it, and the yews — dead",
  "  // like everything else here — in the corners. Kept off the paths.",
);
for (const [x, z, w, d, n] of [[-72.5, 82, 8, 30, 14], [-47.5, 82, 8, 30, 14], [-60, 101, 14, 3.5, 6], [-71, 64, 9, 3, 4], [-50, 64, 10, 3, 4]]) {
  if (rectOk(x, z, w, d)) rectRegion("gravestone", x, z, w, d, n, STONE);
  else console.log(`  WARNING: headstones at (${x}, ${z}) refused`);
}
for (const [x, z] of [[-75, 64], [-45, 64], [-75, 101], [-45, 101]]) {
  if (groveOk(x, z, 2.5, 0.3, true)) {
    disc("deadTree", x, z, 2.5, 1, ", scale: [1.2, 1.6], blocking: true, clearance: 0.55");
    trees++;
  }
}

section(scatter, "the burying ground");
for (const [x, z, w, d, n] of [[-40, -76, 9, 14, 13], [-20.5, -78, 5, 14, 7]]) {
  if (rectOk(x, z, w, d)) rectRegion("gravestone", x, z, w, d, n, STONE);
  else console.log(`  WARNING: headstones at (${x}, ${z}) refused`);
}
if (groveOk(-20, -70, 2, 0.3)) disc("deadTree", -20, -70, 2, 1, ", scale: [1.1, 1.5], blocking: true, clearance: 0.55");

/** How wooded a point is meant to be, 0..1 — the hills, the edges, and the creek's west bank. */
function woodiness(x, z) {
  const edge = Math.max(Math.abs(x), Math.abs(z));
  let w = smooth((edge - 80) / 24) * 0.85;
  w = Math.max(w, smooth((natural(x, z) - 2.4) / 2) * 0.7);
  if (x < -100 && z < 24 && z > -80) w = Math.max(w, 0.7);
  w += 0.35 * vnoise(x, z, 30, 51);
  // The village, the flags and the fields between them stay open ground.
  if (Math.abs(x) < 62 && z > -56 && z < 50) w -= 0.9;
  if (Math.hypot(x - CHAPEL.x, z - CHAPEL.z) < 30) w -= 0.9;
  if (x > 56 && x < 114 && z > 10 && z < 72) w -= 0.9;
  if (x > 10 && x < 70 && z < -52) w -= 0.6;
  return Math.max(0, Math.min(1, w));
}

section(scatter, "the dead woods");
scatter.push(
  "  // The blight's own woods, sown against the finished floor: a stand is a",
  "  // disc checked dry, clear of every building and yard, and under a grade a",
  "  // tree stands on. Thickest on the hills and at the edges; the village, the",
  "  // flags and the fields between them are left open.",
);
for (let gz = -HALF + 9; gz < HALF - 4; gz += 15) {
  for (let gx = -HALF + 9; gx < HALF - 4; gx += 15) {
    const x = gx + rand(-4, 4);
    const z = gz + rand(-4, 4);
    const w = woodiness(x, z);
    if (w < 0.3) continue;
    let r = 0;
    for (const tryR of [9, 6, 3.5]) {
      if (groveOk(x, z, tryR, 0.3, false, true)) {
        r = tryR;
        break;
      }
    }
    if (!r) continue;
    const count = Math.max(1, Math.round((0.3 + w * 0.7) * (r * r) / 9));
    disc("deadTree", x, z, r, count, TREE);
    trees += count;
    if (chance(0.5)) disc("bramble", x, z, r, Math.max(2, Math.round(count * 0.8)), ", scale: [0.8, 1.4]");
  }
}

section(scatter, "the water's edges");
scatter.push(
  "  // Fallen logs in the creek and the pools, and corpse-fungus on their banks —",
  "  // the only light down there. Emissive, so each region is kept small.",
);
for (let i = 0; i < CREEK.length; i += 50) {
  const [x, z] = CREEK[i];
  if (Math.abs(x) > HALF - 8 || Math.abs(z) > HALF - 8) continue;
  if (Math.hypot(x - byId.B.x, z - byId.B.z) < byId.B.r + 6) continue;
  if (Math.abs(z - MILL_Z) < 12 || Math.abs(z + 30) < 6 || Math.abs(x + 110) < 6) continue;
  if (i % 100 === 0) disc("log", x, z, 3, 2, ", scale: [0.8, 1.2], blocking: true, clearance: 1.4");
}
for (const [x, z, r, n] of [[-84, -48, 6, 3], [-98, 8, 6, 3], [-70, -86, 8, 4], [24, -84, 8, 3], [56, -84, 8, 3], [40, -96, 8, 3]]) {
  disc("fungus", x, z, r, n, ", scale: [0.8, 1.4]");
}
for (const [x, z, r, n] of [[30, -92, 6, 3], [50, -94, 6, 3], [-66, -94, 6, 3]]) {
  disc("log", x, z, r, n, ", scale: [0.8, 1.2], blocking: true, clearance: 1.4");
}

section(scatter, "the fire's leavings");
scatter.push(
  "  // Rubble in the burnt quarters, where the houses came down into the street",
  "  // behind them. Kept off the carriageways by the region, not the prop:",
  "  // rubble is not rooted, so a road does not refuse it by itself.",
);
for (const p of placed) {
  if (!(p.kind === "ruin" || p.params.ruined === true) || p.kind === "cart") continue;
  // The yard behind a burnt house, where its roof and its upper floor fell.
  const [bx, bz] = turnOf(0, 7, p.turn);
  const x = p.x + bx;
  const z = p.z + bz;
  if (onRoadAt(x, z, 3.5)) continue;
  if (!groveOk(x, z, 2.5, 0.35)) continue;
  disc("rubble", x, z, 2.5, 2, ", scale: [0.8, 1.2], blocking: true, clearance: 1.1");
}

section(scatter, "the yards' spill");
for (const [prop, x, z, r, n, extra] of [
  ["barrel", -15, -4, 2, 2, ", blocking: true, clearance: 0.55"],
  ["barrel", 15, -6, 2, 2, ", blocking: true, clearance: 0.55"],
  ["barrel", -84, -36, 3, 3, ", blocking: true, clearance: 0.55"],
  ["barrel", 92, 58, 3, 3, ", blocking: true, clearance: 0.55"],
  ["barrel", 44, -65, 3, 3, ", blocking: true, clearance: 0.55"],
  ["barrel", 26, 80, 3, 3, ", blocking: true, clearance: 0.55"],
  ["log", 30, 96, 5, 4, ", scale: [0.8, 1.2], blocking: true, clearance: 1.4"],
  ["log", 50, 74, 4, 3, ", scale: [0.8, 1.2], blocking: true, clearance: 1.4"],
  ["boulder", 40, 104, 8, 4, ", scale: [0.8, 1.3], blocking: true, clearance: 1.0"],
  ["boulder", -104, -104, 7, 4, ", scale: [0.8, 1.3], blocking: true, clearance: 1.0"],
  ["boulder", 106, 96, 10, 5, ", scale: [0.8, 1.3], blocking: true, clearance: 1.0"],
  ["boulder", -66, 96, 8, 3, ", scale: [0.8, 1.3], blocking: true, clearance: 1.0"],
]) {
  if (prop === "barrel" || groveOk(x, z, r, 0.35)) disc(prop, x, z, r, n, extra);
}

section(scatter, "the braziers");
scatter.push("  // Fires the defenders left burning. Sparse: each one spends a light slot.");
for (const [x, z, r] of [[6, -14, 2], [-70, -24, 2], [80, 52, 2], [-94, 98, 2], [94, -98, 2], [34, -66, 2]]) {
  disc("fireDrum", x, z, r, 1, ", blocking: true, clearance: 0.6");
}

section(scatter, "the open ground");
scatter.push("  // Brambles over the fields and the moor: undergrowth a body and a round both pass.");
for (const [x, z, w, d, n] of [
  [-20, 88, 26, 30, 12], [-104, 70, 20, 16, 7], [86, 88, 30, 20, 10], [-86, -84, 26, 22, 10],
  [-2, -88, 20, 20, 9], [92, -40, 16, 20, 7], [40, -44, 26, 10, 6], [-12, 58, 16, 8, 5], [70, -20, 10, 30, 7],
]) {
  rectRegion("bramble", x, z, w, d, n, ", scale: [0.8, 1.4]");
}

// --- the country beyond the play square ---------------------------------------

const BORDERLAND = `
  // ===== THE COUNTRY BEYOND THE PLAY SQUARE ==================================
  // Appended LAST, and the order is mechanical: every region draws from one
  // seeded stream in array order, so a region spliced in above re-rolls every
  // field below it.
  //
  // WHY IT IS HERE AT ALL. \`borderland\` takes the rim away, and a margin with
  // nothing standing on it is not "the valley keeps going" — it is a plane
  // fading to \`fogColor\`, which reads as a backdrop. What tells an eye that
  // ground recedes is stuff standing ON it at intervals, and in this valley
  // that is dead wood.
  //
  // THIS BLOCK IS READ FROM FORTY METRES, WHICH IS WHAT MAKES IT A DIFFERENT
  // PROBLEM FROM HARROWMEAD'S. That map's borderland is looked at from three
  // hundred metres through half a fog, so it holds nothing smaller than a tree
  // and nothing nearer than a 90 m collar. Here \`fogEnd\` is 78, so the
  // borderland anybody ever sees is the 78 m nearest them and the far three
  // fifths of the margin is fog insurance. Everything below is therefore at
  // READING distance, and there is NO BARE COLLAR: the dead woods fill the
  // map's edges, so a bare ring here would be a firebreak cut round a valley
  // that does not have one. The blight carries on instead.
  //
  // WHICH MEANS A LIVING PLAYER REACHES THIS, so none of it blocks: a blocking
  // prop out here would be a collider outside the nav grid, geometry the bots
  // can neither see nor route around, and something to CATCH a player
  // sprinting home against a countdown. The bare dead tree is 0.7 m across,
  // so there is nothing to hide behind; the boulders, which are opaque, are
  // held out past 25 m.
  //
  // IT IS NOT A RING. Each side is given the country the village already has
  // on it: the NORTH is the Ashwood the logging camp is cutting and is the
  // thickest, the WEST carries the creek's woods on, the EAST is the holdings'
  // rough grazing, and the SOUTH is the moor and the bog — the wet, open,
  // deliberately thinnest quarter, where what breaks the plane is standing
  // water rather than timber. The corners get their own: a side is 120 m of
  // square from the middle and a corner is 170.

  // NORTH — the Ashwood's own country, and the thickest side on the map.
  { prop: "deadTree", x: 88, z: 142, width: 64, depth: 40, count: 32, scale: [0.9, 1.7], clearance: 0.55 },
  { prop: "deadTree", x: 34, z: 172, width: 116, depth: 50, count: 68, scale: [0.9, 1.7], clearance: 0.55 },
  // Straddles the Valeguard track and the north road on purpose: \`findSpot\`
  // holds anything ROOTED off a carriageway, so each road cuts its own avenue
  // through the stand rather than the layout carving a gap by hand.
  { prop: "deadTree", x: -66, z: 148, width: 116, depth: 48, count: 56, scale: [0.9, 1.7], clearance: 0.55 },
  { prop: "boulder", x: -30, z: 158, width: 100, depth: 24, count: 10, scale: [0.8, 1.3], clearance: 1.0 },
  // The far line, aimed at a player who is already dying: from the leash
  // limit at z = 189 the fog reaches 267.
  { prop: "deadTree", x: 0, z: 214, width: 250, depth: 18, count: 28, scale: [0.9, 1.7], clearance: 0.55 },

  // WEST — the creek comes in under the chapel's hill at z = 30, and the
  // stands sit either side of where its channel runs on out.
  { prop: "deadTree", x: -150, z: 84, width: 50, depth: 80, count: 30, scale: [0.9, 1.5], clearance: 0.55 },
  { prop: "bramble", x: -138, z: -10, width: 20, depth: 60, count: 18, scale: [0.8, 1.4] },
  { prop: "deadTree", x: -154, z: -40, width: 50, depth: 80, count: 30, scale: [0.9, 1.7], clearance: 0.55 },

  // SOUTH — the moor and the bog going on. What the moor has that the woods do
  // not is WATER, so the timber out here stays thinner than the north's and
  // the pools do the work. Held off the two channels that run out of the
  // square: the creek at x = -56 and the bog between x = 13 and 63.
  { prop: "deadTree", x: -100, z: -140, width: 70, depth: 40, count: 26, scale: [0.9, 1.7], clearance: 0.55 },
  { prop: "deadTree", x: -18, z: -142, width: 50, depth: 36, count: 16, scale: [0.9, 1.7], clearance: 0.55 },
  { prop: "bramble", x: -60, z: -132, width: 110, depth: 22, count: 26, scale: [0.8, 1.4] },
  { prop: "boulder", x: -90, z: -164, width: 60, depth: 30, count: 8, scale: [0.8, 1.3], clearance: 1.0 },
  // Corpse-fungus on the bog's far shore — emissive, so six is a shore and
  // thirty would be a runway.
  { prop: "fungus", x: 38, z: -152, width: 56, depth: 30, count: 6, scale: [0.8, 1.4] },
  { prop: "deadTree", x: 94, z: -150, width: 54, depth: 44, count: 22, scale: [0.9, 1.7], clearance: 0.55 },

  // EAST — the holdings' rough grazing.
  { prop: "deadTree", x: 146, z: -34, width: 44, depth: 76, count: 26, scale: [0.8, 1.4], clearance: 0.55 },
  { prop: "bramble", x: 130, z: 40, width: 16, depth: 80, count: 18, scale: [0.8, 1.4] },
  { prop: "deadTree", x: 150, z: 60, width: 40, depth: 60, count: 20, scale: [0.9, 1.7], clearance: 0.55 },

  // THE CORNERS, wide enough to meet the two sides either side of them.
  { prop: "deadTree", x: 158, z: 156, radius: 34, count: 40, scale: [0.9, 1.7], clearance: 0.55 },
  { prop: "deadTree", x: -158, z: 152, radius: 30, count: 30, scale: [0.9, 1.7], clearance: 0.55 },
  { prop: "deadTree", x: -156, z: -154, radius: 34, count: 40, scale: [0.9, 1.7], clearance: 0.55 },
  { prop: "deadTree", x: 152, z: -152, radius: 30, count: 30, scale: [0.9, 1.7], clearance: 0.55 },`;

// --- the water ---------------------------------------------------------------

/**
 * Two rects at one surface. The CREEK's runs from where it comes in off the
 * west edge to where it leaves off the south one, taking the mire with it; the
 * BOG's is the pool flag E stands on, and runs out off the south edge as it
 * always has. Every wet point inside either has to be that water's own
 * channel or basin — the floor is held at `BANK - 0.1` everywhere else, so
 * this checks that promise rather than assuming it.
 */
const CREEK_RECT = { x: -85, z: -62, width: 110, depth: 206, y: WATER_Y };
const BOG_RECT = { x: 38, z: -126, width: 66, depth: 104, y: WATER_Y };
let deepest = 0;
for (const [r, owns] of [
  [CREEK_RECT, (x, z) => creekDist(x, z) < LIP + 1 || poolDist(MIRE, x, z) < MIRE.skirt + 1],
  [BOG_RECT, (x, z) => poolDist(BOG, x, z) < BOG.skirt + 1],
]) {
  for (let x = Math.max(-HALF, r.x - r.width / 2); x <= Math.min(HALF, r.x + r.width / 2); x += 1) {
    for (let z = Math.max(-HALF, r.z - r.depth / 2); z <= Math.min(HALF, r.z + r.depth / 2); z += 1) {
      const d = WATER_Y - floorAt(x, z);
      if (d <= 0) continue;
      deepest = Math.max(deepest, d);
      if (!owns(x, z)) throw new Error(`water: a rect covers wet ground off its own water at (${x}, ${z})`);
    }
  }
}
// And nothing wet lies outside both rects.
for (let x = -HALF; x <= HALF; x += 1) {
  for (let z = -HALF; z <= HALF; z += 1) {
    if (!wet(x, z, 0)) continue;
    const inside = [CREEK_RECT, BOG_RECT].some((r) => Math.abs(x - r.x) <= r.width / 2 && Math.abs(z - r.z) <= r.depth / 2);
    if (!inside) throw new Error(`water: dug ground under the surface at (${x}, ${z}) with no rect over it`);
  }
}

// --- the grass ---------------------------------------------------------------

const grass = [];
const grassObjs = [];
let grassArea = 0;
/**
 * One field. `density` is how lush, 0..1 of the quality rung's full field, and
 * `height` a multiplier on the config's blade range — both SHARES, never a
 * count: the field is drawn around the eye (`GrassSystem`), so its area is not
 * a price. Either is left out when it is 1.
 */
function turf(x, z, w, d, density, height, note) {
  if (note) grass.push(`  // ${note}`);
  const extra =
    (density === 1 ? "" : `, density: ${n2(density)}`) + (height === 1 ? "" : `, height: ${n2(height)}`);
  grass.push(`  { x: ${f1(x)}, z: ${f1(z)}, width: ${f1(w)}, depth: ${f1(d)}${extra} },`);
  grassObjs.push({ x, z, width: w, depth: d });
  grassArea += w * d;
}
turf(-60, 82, 38, 46, 0.7, 0.55, "The churchyard, grown rough between the stones but kept under them.");
turf(-85, -10, 34, 80, 0.8, 1.0, "The creek's dell: reeds in the water and long grass up both banks.");
turf(-66, -95, 40, 30, 1, 1.1, "The mire and the bog: reeds through the shallows and round the jetties.");
turf(38, -88, 56, 30, 1, 1.1);
turf(86, 36, 52, 48, 0.9, 1.3, "The farmstead's paddocks — tall grass over the open sightlines at D.");
turf(30, 84, 44, 34, 0.7, 0.9, "The Ashwood's clearings.");
turf(-30, -78, 36, 30, 0.8, 0.9, "The burying ground and the moor round it.");
turf(-98, 70, 34, 36, 0.8, 1, "The Valeguard upland.");
turf(92, -40, 36, 70, 0.75, 1.1, "The east holdings' rough grazing.");
turf(-30, 84, 30, 44, 0.75, 1, "The fields under the chapel's hill.");
turf(80, 92, 50, 40, 0.6, 0.9, "The fields between the farm and the woods.");
turf(40, -44, 40, 14, 0.7, 0.9, "The strip between the village and the bog.");
turf(-100, -70, 36, 40, 0.8, 1, "The moor.");

// --- the flags' own spawns ---------------------------------------------------

/** The walked height at a flag: the deck for one indoors on a deck, else the floor. */
const flagY = (f) => (f.id === "E" ? BOAT.deck : floorAt(f.x, f.z));
const NAMED = FLAGS.map(
  (f) =>
    `  { id: "${f.id}", name: "${f.name}", pos: new Vector3(${n2(f.x)}, ${n2(flagY(f))}, ${n2(f.z)}), radius: ${f.r}` +
    (f.poleLift ? `, poleLift: ${f.poleLift}` : "") +
    " },",
);
for (const f of FLAGS) {
  if (f.inside) continue;
  for (const c of claimed) {
    if (c.type !== "solid") continue;
    if (f.x > c.x0 && f.x < c.x1 && f.z > c.z0 && f.z < c.z1) throw new Error(`flag ${f.id} stands in ${c.note}`);
  }
}

// --- the checks on the floor itself ------------------------------------------

let worstStep = 0;
let worstAt = "";
for (let j = 0; j < ROW; j++) {
  for (let i = 0; i < ROW; i++) {
    const h = V[j * ROW + i];
    for (const [a, c, axis] of [[i + 1, j, "X"], [i, j + 1, "Z"]]) {
      if (a >= ROW || c >= ROW) continue;
      const s = Math.abs(V[c * ROW + a] - h);
      if (s > worstStep) {
        worstStep = s;
        worstAt = `(${-HALF + i * CELL}, ${-HALF + j * CELL}) along ${axis}`;
      }
    }
  }
}
const worstGrade = worstStep / CELL;
if (worstGrade > MAX_GRADE * 0.9 && process.argv.includes("--dry")) {
  console.log(`  WARNING terrain: a ${worstStep.toFixed(2)} m step at ${worstAt}`);
} else if (worstGrade > MAX_GRADE * 0.9) {
  throw new Error(
    `terrain: a ${worstStep.toFixed(2)} m step over ${CELL} m at ${worstAt} is a ${worstGrade.toFixed(3)} gradient, ` +
      `against ${MAX_GRADE} less a tenth for margin.`,
  );
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
    JSON.stringify({
      claimed,
      placements: placed,
      scatter: regions,
      cps: FLAGS.map((f) => ({ id: f.id, x: f.x, z: f.z, r: f.r })),
      spawns: [],
      water: [CREEK_RECT, BOG_RECT],
      grass: grassObjs,
      heights: { size: CELLS, cell: CELL, heights: Array.from(V) },
    }),
  );
}

// --- writing it out ------------------------------------------------------------

const heightRows = [];
for (let j = 0; j < ROW; j++) {
  const line = [];
  for (let i = 0; i < ROW; i++) line.push(String(V[j * ROW + i]));
  heightRows.push("    " + line.join(",") + ",");
}

const DRY = process.argv.includes("--dry");
if (!DRY) mkdirSync(out, { recursive: true });

if (!DRY) writeFileSync(
  join(out, "heights.ts"),
  `/**
 * hollowmere/heights.ts — GENERATED by \`scripts/generate-hollowmere.mjs\`
 * (\`npm run hollowmere\`), and editable afterwards with the map editor's
 * terrain mode (F2, then T). Do not hand-edit: both the script and the editor
 * rewrite this file wholesale.
 *
 * The floor of the valley — one height per grid vertex, row-major from the
 * -X/-Z corner. A lazy \`import()\` (\`MapDef.heights\`), so it reaches a
 * browser only when this map is built.
 *
 * ${CELLS}x${CELLS} cells of ${CELL} m over the ${PLAY} m map, so ${ROW}x${ROW} vertices.
 * Keep any single-cell step under ${(MAX_GRADE * CELL).toFixed(2)} m or the nav graph stops
 * linking across it and whatever is beyond becomes an island; the generator
 * refuses anything over ${(MAX_GRADE * CELL * 0.9).toFixed(2)}.
 *
 * **The shape is four passes laid over one another IN ORDER** (see
 * \`heightAt\` in the generator): a valley falling from the Ashwood to the moor
 * with its named hills; every district levelled toward its own height by a
 * weighted average; the ground held low round the creek and the two pools;
 * and the channel and the basins cut last. Both are cut to a constant ${BED} m
 * bed, so the two water rects at ${WATER_Y} are wet exactly where the water is,
 * and dry ground is held at ${(BANK - 0.1).toFixed(2)} or over everywhere else. Every
 * bank grades at ${((BANK - BED) / (LIP - BED_HW)).toFixed(2)} or under outside the mill race, so the
 * whole creek is wadeable.
 *
 * **Zero is the MIST's datum**, not the sea's: the village stands just above
 * it and keeps the mist it always had, the dell, the moor and the bog shore
 * are below it and drown, and the chapel's crown stands clear at +${DISTRICTS.find((d) => d.name === "chapel crown").level}.
 */
import type { Heightfield } from "../layout";

export const HollowmereHeights: Heightfield = {
  size: ${CELLS},
  cell: ${CELL},
  // Row-major, +Z per row.
  heights: [
${heightRows.join("\n")}
  ],
};

// Default too, because \`MapDef.heights\` is a lazy \`import()\` and a default
// is the one export name a generic signature can be written against.
export default HollowmereHeights;
`,
);

const water = [
  "  // The creek, from where it comes in off the west edge under the chapel's",
  "  // hill, down past the mill and through the mire, to where it leaves off the",
  "  // south edge. It RUNS — it turns a waterwheel — which is why it is the one",
  "  // body here that says so (`WaterRect.sound`).",
  `  { x: ${n2(CREEK_RECT.x)}, z: ${n2(CREEK_RECT.z)}, width: ${n2(CREEK_RECT.width)}, depth: ${n2(CREEK_RECT.depth)}, y: ${n2(WATER_Y)}, sound: "stream" },`,
  "  // The bog: the pool the boathouse and the jetties stand in. It runs OUT of",
  "  // the map to the south, and that is a fix rather than dressing: its south",
  "  // edge on the play square would be a straight waterline cut across the",
  "  // marsh, read from the docks at thirty-five metres. Past the square the bed",
  "  // is the clamped edge row plus `borderRoll`, so the pool's far shore is",
  "  // wherever the two happen to cross — and nobody sees it through the fog.",
  `  { x: ${n2(BOG_RECT.x)}, z: ${n2(BOG_RECT.z)}, width: ${n2(BOG_RECT.width)}, depth: ${n2(BOG_RECT.depth)}, y: ${n2(WATER_Y)} },`,
];

const layoutHeader = readTemplate();
if (!DRY) writeFileSync(
  join(out, "layout.ts"),
  layoutHeader
    .replace("%PLACEMENTS%", placements.join("\n"))
    .replace("%SCATTER%", scatter.join("\n") + BORDERLAND)
    .replace("%FLAGS%", NAMED.join("\n"))
    .replace("%SPAWNS%", spawns.join("\n"))
    .replace("%WATER%", water.join("\n"))
    .replace("%GRASS%", grass.join("\n")),
);

const burnt = placed.filter((p) => p.kind === "ruin" || (p.params.ruined && p.kind !== "cart")).length;
const houses = placed.filter((p) => ["cottage", "townhouse", "ruin"].includes(p.kind)).length;
printTally(tally(placed, (p) => p.kind), refused, bracketKind);
if (process.argv.includes("--refusals")) printRefusals(refused);
console.log(
  `hollowmere: ${PLAY} m square\n` +
    `  ${placed.length} placements (${houses} houses, ${burnt} of them burnt), ${regions.length} scatter regions (~${trees} trees in play), ${runs.filter((r) => r.placed).length} wall runs\n` +
    `  ${ROW}x${ROW} height vertices, ground ${lo.toFixed(2)}..${hi.toFixed(2)} m\n` +
    `  water deepest ${deepest.toFixed(2)} m; grass ~${Math.round(grassArea)} m²\n` +
    `  steepest cell step ${worstStep.toFixed(2)} m (grade ${worstGrade.toFixed(3)}) at ${worstAt}\n` +
    `  wrote src/world/hollowmere/{layout,heights}.ts`,
);

// --- the layout file's prose ---------------------------------------------------

function readTemplate() {
  return `/**
 * hollowmere/layout.ts — THE MAP, as data: structure placements, scatter
 * regions, control points, spawns, water rects, grass rects. The floor's shape
 * is generated data and lives in heights.ts. Consumed by MapBuilder; nothing
 * here is code to special-case.
 * Gotchas that have already cost time: collider top faces within
 * CONFIG.nav.stepHeight of adjacent ground or bots treat decks as walls; a
 * control point's pos must NOT sit inside a PLACEMENT's collider; scatter
 * knows nothing about water, so every stand below was checked dry by the
 * generator; terrain steeper than a 0.4 gradient severs its own nav links.
 *
 * **SEEDED by \`scripts/generate-hollowmere.mjs\`, and owned by the editor after
 * that.** The design is authored in that script and this file is the
 * transcription: flat arrays of one-line entries, which is what
 * \`src/editor/sourceScan.ts\` requires. Re-running the generator discards
 * editor edits — and its header says what it checks that hand-editing did not.
 */
import { Vector3 } from "@babylonjs/core";
import type {
  ControlPointDef,
  GrassRect,
  MapLayout,
  Placement,
  ScatterSpec,
  SpawnPointDef,
  WaterRect,
} from "../layout";

/**
 * HOLLOWMERE — a burnt village in a dead valley, at night.
 *
 * 240 x 240 m, origin at the market square, +Z is north. Five flags in a ring
 * round the square, with the two uncapturable home spawns diagonally opposed
 * so neither side starts next to C.
 *
 * \`\`\`
 *                              N
 *    +---------------------------------------------------+
 *    | * VALEGUARD           :    |    ~ ASHWOOD ~         |
 *    |   (-100,+112)         :    |  kilns     look-out  NE|
 *    |           [A] THE CHAPEL   |  north road      wood  |
 *    |    ~~~~~   (-60,+84)  :   / \\__ Wood Lane __        |
 *    |   creek \\  churchyard :  /                \\ farm    |
 *    |          ~   glebe  Church St.  Cooper's   \\ lane   |
 *    |          ~  Beck  \\_____|____ Lane _______  [D] THE |
 *    |   mill   ~   Row    inn |                 FARMSTEAD |
 *    | [B] THE MILL ==High St.=[C] THE SQUARE==  (86,+36)  |
 *    |   (-80,-27)  ~ Weavers  (0,-3)  Tanners     east    |
 *    |   in the dell ~  Lane   South St.  Lane   holdings  |
 *    |    moor road ~\\______/    \\_____ dock road  |       |
 *    |  ~ THE MIRE ~  [burying      [E] THE BOG DOCKS |    |
 *    |  moor look-out   ground]       (40,-75)        |    |
 *    |            ~          ~~~~~ the bog ~~~~~ * REDLINE |
 *    |            ~          ~~~~~~~~~~~~~~~~~~~  (+100,   |
 *    +---------------------------------------------------+-112)
 * \`\`\`
 *
 * ## A village, and why it reads as one
 *
 * It grew where the valley road crosses the way down to the mill, and it is
 * laid out the way one is: a paved market square with the well at its head,
 * the coaching inn on its north side and the forge on its south; High Street
 * through it east and west, North Street and South Street through it north and
 * south, and every house on every street turned to face it. Behind High Street
 * run the back lanes — Cooper's Lane to the north-east, Tanners and Weavers
 * Lanes south — and out of the village the lanes run on to the flags with
 * crofts strung along them. North Street climbs to Church Street, and Church
 * Lane climbs on up the hill to the chapel door; High Street drops west down
 * the bank as Mill Lane into the creek's dell.
 *
 * **It burned.** The fire came up from the bog and took the south-east — most
 * of Tanners Lane, the south quarter, the crofts on the dock and moor roads —
 * and the north of the village is where the lamps are still lit. About half the
 * houses are shells: a burnt cottage (\`ruined\`) where the roof went and the
 * walls stood, a rubble ruin where they did not, rubble in the yard behind,
 * carts overturned in the street.
 *
 * ## The ground, which the first version never had
 *
 * The valley falls from the Ashwood in the north to the moor and the bog in
 * the south. The chapel stands on the one real hill, five metres over the
 * square; the creek runs in a dell two metres under the village's west edge;
 * the farm stands on its own rise; and the moor, the mire and the bog shore
 * are low ground below the mist's datum, where the fog pools thickest. Every
 * sightline across the map now crosses a crest or drops into a hollow.
 *
 * Design intent per flag:
 * - **A The Chapel** — the high ground, inside a walled churchyard with a
 *   gate where each lane arrives. Easy to hold, slow to reach, and the one
 *   flag that stands clear of the mist.
 * - **B The Mill** — down in the creek's dell, where three lanes meet in the
 *   mill yard. The bank rises two metres to the village behind a crest wall,
 *   so whoever holds the crest shoots down into it; the footbridge and the
 *   ford are the way round.
 * - **C The Square** — four streets in and no cover taller than a stall. The
 *   flag nobody keeps.
 * - **D The Farmstead** — the barn on the farm's rise: the hayloft is the
 *   map's best perch and the ramp up to it is exposed.
 * - **E The Bog Docks** — the boathouse on the shore, jetties either side,
 *   and the thickest mist on the map. A short-range brawl by construction.
 *
 * Layout hygiene (the generator holds these; hand edits keep to them):
 * - Structures are axis-aligned (\`rotY\` in multiples of π/2). A builder's
 *   front is its local -Z: turn 0 faces south, π/2 west, π north, -π/2 east,
 *   and every front door opens onto a street, the square or a yard.
 * - Nothing stands on a road, in the water, or on ground that falls more than
 *   0.3 m across its footprint.
 * - Roads are PATHS and end at junctions the network finds, at a yard, or at
 *   a door. Walls and fences are cut wherever a lane crosses them, which is
 *   where the gates are.
 * - The ORDER of the scatter array is load-bearing: every region draws from
 *   one seeded stream, so a region added anywhere but the end re-rolls every
 *   field below it.
 */

const VALEGUARD = "#c9a15e";
const REDLINE = "#ff3b3b";

const placements: Placement[] = [
%PLACEMENTS%
];

/**
 * Dressing. Every stand below was checked by the generator against the
 * finished floor — dry, clear of every building and yard, and under a grade a
 * tree stands on. A road rejects what grows by itself (\`world/roads.ts\`), and
 * blocking props are held off every flag and spawn by \`MapBuilder.keepClear\`.
 */
const scatter: ScatterSpec[] = [
%SCATTER%
];

const controlPoints: ControlPointDef[] = [
%FLAGS%
];

/**
 * Home spawns are uncapturable, and deploy on the village side of the
 * gatehouse barricades. Every control point also carries a spawn just outside
 * its capture zone, so deploying onto a flag you hold does not drop you on top
 * of whoever is contesting it.
 */
const spawns: SpawnPointDef[] = [
%SPAWNS%
];

/**
 * Standing water, the creek and the bog, cut in \`heights.ts\` to one bed so
 * each rect is wet exactly where the water is and dry everywhere the floor
 * stands above it. Ankle-deep, so bots and the player wade across — no
 * swimming, and the nav grid never hears about it.
 */
const water: WaterRect[] = [
%WATER%
];

/**
 * Grass fields. Pale, dead, knee-high — the valley's one crop that still
 * grows. \`density\` is how LUSH, 0..1 of the quality rung's field, and never a
 * count: the field is drawn around the eye, so a rect's area costs nothing.
 * Roads, structures, fences and props clear themselves (the grass mask refuses
 * a carriageway and a collider's footprint both). Grass under a water rect's
 * surface grows thinner and taller as reeds, and lays no turf.
 */
const grass: GrassRect[] = [
%GRASS%
];

export const HollowmereLayout: MapLayout = {
  placements,
  scatter,
  controlPoints,
  spawns,
  water,
  grass,
  /**
   * **No wall.** The valley is not closed by anything you can walk up to: the
   * blight carries on for a hundred and eighty metres past the play square and
   * what stops you is the leash, a countdown rather than a face of rock. See
   * \`Borderland\`, and \`world/leash.ts\` for the rule.
   *
   * **The margin is the HORIZON's, and on this map the horizon is 78 m.** The
   * cel shader's fog is LINEAR between \`fogStart\` and \`fogEnd\`, so a surface
   * reaches exactly \`fogColor\` at \`fogEnd\` and not one metre before it, and
   * ground that stops any nearer than that arrives on screen at some fraction
   * of its own colour against a sky dome painted flat \`fogColor\` below the
   * horizon — a line drawn round the world. So the edge has to be \`fogEnd\`
   * from the furthest an EYE gets: the play edge plus the leash's 69 m is 147,
   * the death cam's orbit stands 3.4 m further out and a blast can throw a body
   * further still, and 180 is that rounded up.
   *
   * **\`roll\` is left at its default 2.6.** The valley inside the square falls
   * a few metres north to south and rises to the chapel's hill, and the
   * borderland continues the field's own clamped edge — so the ground outside
   * already carries the valley's shape on out, and the two swells
   * \`borderRoll\` adds (about 370 m and 160 m) read as the same country going
   * on rather than as different country.
   *
   * **\`ease\` is stated**: the ramp defaults to a third of the margin, 60 m,
   * and on this map the leash strip and the VISIBLE borderland are nearly the
   * same 70-odd metres, so a 60 m ramp would spend four fifths of everything
   * anybody ever sees out here flattening it into a radial smear of the map's
   * own edge. 30 m puts full amplitude up while the ground is still only a
   * third fogged; the steepest gradient it can make is 0.10, against a
   * \`MAX_WALKABLE_GRADE\` of 0.4.
   */
  borderland: { margin: 180, ease: 30 },
  /**
   * **No rim at all.** The valley ends in more valley, and what closes the
   * horizon is the fog rather than a landform. \`Ridge.ts\` states the one
   * condition on taking \`form: "none"\`: a map may only draw nothing over its
   * own boundary if it has already laid something out there that reaches past
   * \`fogEnd\` on every bearing — which this map pays with the 180 m above, so
   * the two fields are one decision. \`EnvironmentSpec.ridgeColor\` and
   * \`ridgeScreeColor\` are still set and read by nothing here.
   */
  ridge: {
    form: "none",
  },
  // Fixed so the dressing — and the colliders blocking scatter emits, and so
  // the nav graph — is identical on every boot. Changing it rerolls the whole
  // scatter field, which is a visible change to the level: re-walk the flags.
  seed: 0x484c,
};
`;
}
