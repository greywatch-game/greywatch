/**
 * generate-harrowmead.mjs — SEEDS Harrowmead, the farming vale: writes
 * `src/world/harrowmead/{layout,heights}.ts`.
 *
 * Run with `npm run harrowmead`, and owe `npm run collision -- harrowmead` and
 * `npm run parity` after it. Committed output, like every `heights.ts` and
 * every collision bake, and re-running it with the tree unchanged must produce
 * the same bytes.
 *
 * Three flags for iterating on it: `--probe` prints the floor as a plan and
 * writes nothing, `--refusals` lists every plot that was refused and what
 * refused it, and `--claims <file>` dumps the claim list as JSON for a plan
 * render.
 *
 * ## Why it is seeded now, when it was typed for four years
 *
 * Harrowmead was a hand-authored layout over a hand-sculpted floor, and the
 * two had drifted apart the way two hand-kept copies of one idea do: the
 * church stood across the stream with its floor drawn under the water, a
 * cottage stood in the bank, the High Street and the north road ran straight
 * through the brook with nothing to carry them, and half the houses in the
 * village turned their front doors to a hedge. None of that is a crash, so
 * nothing caught it. The fix is the one Sarab, Cinderhaven and Kurenai already
 * took: the DESIGN is authored here — the brook's course, the
 * village's streets, every set piece and the recipe the fields are laid out
 * from — and the TRANSCRIPTION is mechanical and CHECKED:
 *
 * - **Nothing stands in the water.** A building's footprint is sampled on the
 *   floor the game draws and refused if any of it is under the brook.
 * - **Nothing stands on a road**, the network's own footprint being imported
 *   from `src/world/roadPaths.ts` so the test is the one the game makes.
 * - **Nothing is built on a slope**: a placement samples the ground ONCE at
 *   its centre, so a plot that falls more than `FLAT` across its footprint is
 *   refused rather than left floating at one corner.
 * - **Every door opens onto somewhere.** A building's front is its local -Z
 *   face, and the ray out of it has to reach a street, a yard or the green
 *   before it reaches another building — which is what "a house not facing
 *   the street" was, mechanically.
 * - **A road crosses the brook only where the design says it FORDS**, and
 *   beside every ford in the village there is a footbridge.
 *
 * ## What lives here rather than in the layout's own header
 *
 * - **The floor is four passes, in order**: rolling ground and the named
 *   hills; every district (the village, each flag's yard, the farms and the
 *   home yards) levelled toward its own height by a weighted AVERAGE (Sarab's
 *   `land`); the brook's corridor levelled to the vale floor; and the channel
 *   and the millpond cut last, to one bed, so one water rect is wet along the
 *   whole run. The gradient of the result is checked and the script REFUSES to
 *   write a floor it cannot walk.
 * - **The fields are LINES first and dressing second.** A field boundary is a
 *   long line across the vale; it is cut into runs wherever a road, a yard, a
 *   flag or the water crosses it — so a gate is where a lane is, rather than
 *   where somebody remembered to leave one — and each run gets its wall or
 *   fence, its line of hedgerow ash and its fern understory together.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { roadNetwork } from "../src/world/roadPaths.ts";
import { onRoad } from "../src/world/roads.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = join(root, "src", "world", "harrowmead");

// --- the extent --------------------------------------------------------------

/** The PLAY square. */
const PLAY = 400;
/** Metres per heightfield cell. `CELLS * CELL` must equal `PLAY`. */
const CELL = 4;
const CELLS = PLAY / CELL;
const HALF = PLAY / 2;
/** The steepest step between two vertices the nav graph still links, per metre. */
const MAX_GRADE = 0.4;
/** How far the floor may fall across a building's footprint before the plot is refused. */
const FLAT = 0.45;

// --- the seeded stream -------------------------------------------------------

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(0x48524d44);
const rand = (lo, hi) => lo + rng() * (hi - lo);
const chance = (p) => rng() < p;
const pick = (list) => list[Math.floor(rng() * list.length)];

// --- the floor ---------------------------------------------------------------

const smooth = (t) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};

/** Integer lattice hash in [0, 1). */
function hash2(i, j, seed) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [-1, 1] at `scale` metres a lattice cell. */
function vnoise(x, z, scale, seed) {
  const fx = x / scale;
  const fz = z / scale;
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const u = smooth(fx - i);
  const v = smooth(fz - j);
  const a = hash2(i, j, seed);
  const b = hash2(i + 1, j, seed);
  const c = hash2(i, j + 1, seed);
  const d = hash2(i + 1, j + 1, seed);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

/** A raised cosine: 1 at the centre, 0 at `radius` and beyond. */
const bell = (d, radius) => (d >= radius ? 0 : (Math.cos((Math.PI * d) / radius) + 1) / 2);

/**
 * The hills. Peak over radius is the steepest a bell makes (times π/2): the
 * orchard's 9 over 74 is 0.19, half what the nav graph severs at, so every one
 * of these is ground a body and a hull both climb.
 */
const HILLS = [
  // Orchard Hill, flag D's, and the high ground on the map.
  { x: 114, z: 110, peak: 7.5, r: 80 },
  // The knoll the north-west wood stands on.
  { x: -150, z: 154, peak: 9, r: 70 },
  // The south-east wood's hill.
  { x: 150, z: -134, peak: 8, r: 70 },
  // The south downs.
  { x: 6, z: -172, peak: 7, r: 70 },
  // The west rise and the east rise.
  { x: -184, z: -36, peak: 6, r: 56 },
  { x: 186, z: -40, peak: 5, r: 52 },
  // The north rise over the mill's water meadows.
  { x: 30, z: 172, peak: 5, r: 62 },
  // The home yards stand on low rises of their own.
  { x: -156, z: -156, peak: 3, r: 48 },
  { x: 158, z: 158, peak: 2, r: 40 },
  // Knolls in the fields — what turns a 150 m look into two 70 m ones.
  { x: -44, z: -112, peak: 3, r: 40 },
  { x: 52, z: -104, peak: 2.5, r: 38 },
  { x: -58, z: 118, peak: 3, r: 40 },
  { x: -150, z: 24, peak: 2.5, r: 36 },
  { x: 158, z: 50, peak: 2.5, r: 36 },
];

/** Rolling ground and the hills, before anything is levelled. */
function natural(x, z) {
  let h = 0.9 + 1.2 * vnoise(x, z, 120, 21) + 0.5 * vnoise(x, z, 48, 22) + 0.2 * vnoise(x, z, 19, 23);
  for (const k of HILLS) h += k.peak * bell(Math.hypot(x - k.x, z - k.z), k.r);
  return h;
}

// --- the brook ---------------------------------------------------------------

/**
 * The brook's centreline, west to east, as the points a Catmull-Rom spline is
 * run through. It comes in off the west edge, fills the millpond, turns south
 * past the mill's wheel and round the mill yard's south side, runs east behind
 * the village's churchyard, and leaves off the east edge. Both ends run on past
 * the square so the channel crosses each edge square to it: past the grid the
 * floor is the clamped edge (`TerrainField`), and a channel meeting the edge
 * at an angle continues out there as a skewed trench.
 */
const BROOK_PTS = [
  [-260, 108], [-200, 108], [-172, 104], [-152, 98], [-136, 94], [-124, 88],
  [-118, 78], [-117, 66], [-114, 52], [-104, 42], [-88, 38], [-68, 41],
  [-46, 54], [-22, 66], [0, 72], [22, 71], [46, 62], [72, 49], [98, 41],
  [124, 34], [150, 24], [176, 13], [200, 8], [260, 6],
];

/** Dense samples along the spline, ~0.5 m apart. */
const BROOK = (() => {
  const pts = BROOK_PTS;
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

/** Distance to the brook's centreline, near enough (the samples are 0.5 m apart). */
function brookDist(x, z) {
  let best = Infinity;
  for (const [bx, bz] of BROOK) {
    const dx = bx - x;
    if (dx > best || -dx > best) continue;
    const d = Math.hypot(dx, bz - z);
    if (d < best) best = d;
  }
  return best;
}

/** The brook's centreline z at a given x, for an east-west reach. */
function brookZ(x) {
  let best = null;
  let bd = Infinity;
  for (const [bx, bz] of BROOK) {
    const d = Math.abs(bx - x);
    if (d < bd) {
      bd = d;
      best = bz;
    }
  }
  return best;
}

/** The surface of the water, and the bed the channel is cut to. */
const WATER_Y = -0.3;
const BED = -0.95;
/** Flat bed half-width, and where the bank reaches the vale floor. */
const BED_HW = 3;
const LIP = 10;
/**
 * The vale floor either side of the brook, how far out it stays there, and the
 * steepest the vale's sides may rise from it: the ground is held under a
 * cone of that grade out of the corridor, so a hill beside the brook is cut
 * back into a slope rather than squeezed into a step.
 */
const BANK = 0.45;
const CORRIDOR = 12;
const VALE_GRADE = 0.2;

/**
 * The mill race: the reach past the wheel, where the bank is a revetment
 * rather than a slope, so the wheel stands over the water and the mill's west
 * wall on its pad. The 4 m grid cannot draw a bank steeper than one cell, so
 * what this changes is where the ramp STARTS, and the grade check still holds.
 */
const MILL_RACE = { x0: -122, x1: -104, z0: 62, z1: 78, lip: 6 };

/** The millpond: dug into the corridor where the brook comes in. */
const POND = { x: -140, z: 96, rx: 15, rz: 9, skirt: 10, bed: -1.25 };

/** How far outside the millpond's ellipse a point is, near enough (0 inside). */
function pondDist(x, z) {
  const e = Math.hypot((x - POND.x) / POND.rx, (z - POND.z) / POND.rz);
  return Math.max(0, (e - 1) * Math.min(POND.rx, POND.rz));
}

// --- the places that have to be level -----------------------------------------

/**
 * `level` is what the ground reads inside the core, `skirt` how far it takes
 * to get back to the hills. A district's level of `null` is its own natural
 * height at the centre, rounded — a farm stands where it stands.
 */
const DISTRICTS = [
  // C — the village, south of the brook.
  { name: "village", x0: -70, x1: 70, z0: -50, z1: 44, level: 0.8, skirt: 28 },
  // A — the mill yard, in the brook's bend.
  { name: "mill", x0: -110, x1: -72, z0: 50, z1: 88, level: 0.8, skirt: 16 },
  // The mill's own pad, which wins over the brook's corridor: a mill is built
  // on a platform at the water's edge, and its race is walled (`MILL_RACE`).
  { name: "mill pad", x0: -110, x1: -97, z0: 63, z1: 77, level: 0.8, skirt: 6, weight: 4 },
  // The north bank at the ford, where the mill lane leaves the north road.
  { name: "fordside", x0: -24, x1: 26, z0: 84, z1: 104, level: 0.9, skirt: 20 },
  // B — the grange.
  { name: "grange", x0: -132, x1: -68, z0: -124, z1: -70, level: null, skirt: 22 },
  // E — the kiln yard.
  { name: "kilns", x0: 74, x1: 122, z0: -86, z1: -40, level: null, skirt: 20 },
  // D — the orchard hill's crown.
  { name: "crown", x0: 92, x1: 130, z0: 86, z1: 124, level: null, skirt: 38 },
  // The farms along the flank lanes and the south track.
  { name: "brookside", x0: -134, x1: -104, z0: -18, z1: 10, level: null, skirt: 26 },
  { name: "eastfield", x0: 124, x1: 152, z0: -14, z1: 12, level: null, skirt: 26 },
  { name: "southfield", x0: -16, x1: 20, z0: -104, z1: -80, level: null, skirt: 26 },
  { name: "northfarm", x0: 14, x1: 42, z0: 108, z1: 128, level: null, skirt: 26 },
  // The home yards, flattened for the spawns and the hardstandings.
  { name: "home sw", x0: -174, x1: -138, z0: -176, z1: -138, level: 2.2, skirt: 26 },
  { name: "home ne", x0: 138, x1: 174, z0: 138, z1: 176, level: 2.0, skirt: 26 },
];
for (const d of DISTRICTS) {
  if (d.level === null) {
    d.level = Math.round(natural((d.x0 + d.x1) / 2, (d.z0 + d.z1) / 2) * 4) / 4;
  }
}

function rectDist(x, z, r) {
  const dx = Math.max(r.x0 - x, 0, x - r.x1);
  const dz = Math.max(r.z0 - z, 0, z - r.z1);
  return Math.hypot(dx, dz);
}

/** A smooth minimum, so the vale's cone meets the hills without a crease. */
function smin(a, b, k) {
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
  return b + (a - b) * h - k * h * (1 - h);
}

/** The ground before any cut: the vale's sides, then every district, averaged. */
function land(x, z) {
  const cone = BANK + VALE_GRADE * Math.max(0, Math.min(brookDist(x, z), pondDist(x, z) + BED_HW) - CORRIDOR);
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
  // The vale's sides LAST, so a district beside the brook is held under the
  // cone like a hill is — except the mill's pad, which stands on its race.
  const pad = DISTRICTS.find((d) => d.name === "mill pad");
  const lift = (pad.level - BANK) * (1 - smooth(rectDist(x, z, pad) / pad.skirt));
  h = smin(h, cone + lift, 1.5);
  // A vale floor never falls below the brook's banks: the one water rect is
  // drawn wherever the ground is under it, so dry land has to be dry.
  return Math.max(h, BANK - 0.1);
}

function heightAt(x, z) {
  let h = land(x, z);
  // The channel: a flat bed and a straight bank, which a 4 m grid samples
  // better than any curve — the bank's grade is (h - BED) / (LIP - BED_HW).
  const rd = brookDist(x, z);
  const race = x > MILL_RACE.x0 && x < MILL_RACE.x1 && z > MILL_RACE.z0 && z < MILL_RACE.z1;
  const lip = race ? MILL_RACE.lip : LIP;
  if (rd < lip) {
    const w = rd <= BED_HW ? 1 : 1 - (rd - BED_HW) / (lip - BED_HW);
    h += (BED - h) * w;
  }
  // The millpond.
  const e = Math.hypot((x - POND.x) / POND.rx, (z - POND.z) / POND.rz);
  const pd = (e - 1) * Math.min(POND.rx, POND.rz);
  if (pd < POND.skirt) {
    const w = pd <= 0 ? 1 : 1 - pd / POND.skirt;
    h = Math.min(h, h + (POND.bed - h) * w);
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

function floorAt(x, z) {
  const fx = Math.max(0, Math.min(CELLS - 1e-9, (x + HALF) / CELL));
  const fz = Math.max(0, Math.min(CELLS - 1e-9, (z + HALF) / CELL));
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const tx = fx - i;
  const tz = fz - j;
  const v = (a, c) => V[c * ROW + a];
  return (
    (v(i, j) * (1 - tx) + v(i + 1, j) * tx) * (1 - tz) +
    (v(i, j + 1) * (1 - tx) + v(i + 1, j + 1) * tx) * tz
  );
}

/** The steeper of the two axial slopes at a point. */
function grade(x, z) {
  const e = 2;
  return Math.max(
    Math.abs(floorAt(x + e, z) - floorAt(x - e, z)) / (2 * e),
    Math.abs(floorAt(x, z + e) - floorAt(x, z - e)) / (2 * e),
  );
}

/** True where the floor is under the water (plus a margin of bank). */
const wet = (x, z, margin = 0.3) => floorAt(x, z) < WATER_Y + margin;

if (process.argv.includes("--probe")) {
  const step = 10;
  const cols = [];
  for (let x = -HALF; x <= HALF; x += step) cols.push(String(x).padStart(5));
  console.log("  z|x " + cols.join(""));
  for (let z = HALF; z >= -HALF; z -= step) {
    let line = String(z).padStart(5) + " ";
    for (let x = -HALF; x <= HALF; x += step) {
      const g = grade(x, z);
      line += (floorAt(x, z).toFixed(1) + (wet(x, z, 0) ? "~" : g > 0.3 ? "!" : " ")).padStart(5);
    }
    console.log(line);
  }
  process.exit(0);
}

// --- the output, and the placement vocabulary --------------------------------

const n2 = (v) => {
  const r = Number(v.toFixed(2));
  return Object.is(r, -0) ? "0" : String(r);
};
const TURN = ["", ", rotY: Math.PI / 2", ", rotY: Math.PI", ", rotY: -Math.PI / 2"];
/**
 * Turn 0 faces SOUTH (a builder's front is its local -Z), 1 faces WEST, 2
 * NORTH and 3 EAST — `rotY` of π/2 takes local -Z to world -X.
 */
const FACES = { south: 0, west: 1, north: 2, east: 3 };
/** The world offset of a local one under a turn: `MapBuilder`'s `rotateY`. */
function turnOf(lx, lz, turn) {
  switch (turn) {
    case 1: return [lz, -lx];
    case 2: return [-lx, -lz];
    case 3: return [-lz, lx];
    default: return [lx, lz];
  }
}

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
  ruin: (p) => {
    const w = p.width ?? 10;
    const d = p.depth ?? 8;
    return [-w / 2 - 0.3, w / 2 + 0.3, -d / 2 - 0.3, d / 2 + 0.3];
  },
  stoneWall: (p) => [-(p.length ?? 12) / 2, (p.length ?? 12) / 2, -0.4, 0.4],
  fence: (p) => [-(p.length ?? 10) / 2, (p.length ?? 10) / 2, -0.25, 0.25],
  bridge: (p) => [-(p.width ?? 3.2) / 2 - 0.3, (p.width ?? 3.2) / 2 + 0.3, -(p.length ?? 12) / 2, (p.length ?? 12) / 2],
};

/** Small things a yard or a flag's ring may hold. */
const PROPS = new Set(["cart", "crates", "woodpile", "trough", "haystack", "stall", "well", "shrine"]);

/** Kinds with a front door, whose front the door check holds to a street or a yard. */
const DOORS = new Set(["cottage", "townhouse", "tavern", "smithy", "chapel", "mill", "barn"]);

function worldFoot(kind, x, z, turn, params) {
  const [a, b, c, d] = FOOT[kind](params ?? {});
  const p = [turnOf(a, c, turn), turnOf(b, d, turn)];
  return {
    x0: Math.min(p[0][0], p[1][0]) + x,
    x1: Math.max(p[0][0], p[1][0]) + x,
    z0: Math.min(p[0][1], p[1][1]) + z,
    z1: Math.max(p[0][1], p[1][1]) + z,
  };
}

const placements = [];
const scatter = [];
/** The same placements as objects, for the road network and the render. */
const placed = [];

function section(list, title) {
  const bar = "=".repeat(Math.max(4, 74 - title.length));
  list.push(`  // ===== ${title} ${bar}`);
}

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
  placed.push({ kind, x, z, rotY: [0, Math.PI / 2, Math.PI, -Math.PI / 2][turn], params: params ?? {}, turn });
}

// --- the roads, first, because everything else dodges them -------------------

section(placements, "roads");
placements.push(
  "  // Visual only: a road carries no collider, stops no round and is in no",
  "  // baked structure. The village's streets round the green are COBBLE and",
  "  // everything that leaves the village is a dirt lane. A lane crosses the",
  "  // brook only at a FORD — the road dips through the water and a hull takes",
  "  // it — and the village's ford has a footbridge beside it; the banks grade",
  "  // at under 0.25 the whole run, so anybody wades it anywhere.",
);

const roadDefs = [];
/** Where a road is allowed into the water: the fords, by centre and radius. */
const FORDS = [];

/** An axis-aligned rectangle road. `turn` 0 runs along Z, 1 along X. */
function rectRoad(x, z, turn, len, w, surface) {
  const params = { length: len, width: w, surface };
  roadDefs.push({ kind: "road", x, z, rotY: turn ? Math.PI / 2 : 0, params });
  emit("road", x, z, turn, params);
}

/** A path road through world points; the network bends and joins it. */
function pathRoad(points, w, surface, radius = 30) {
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

// The green and the streets that frame it. The green is x -22..22, z -15..15.
const GREEN = { x0: -22, x1: 22, z0: -15, z1: 15 };
const MAIN_Z = -18.5; // Main Street, the valley road through the village
const NORTH_Z = 18; // North Street, the green's top side
const WEST_X = -25; // West Lane
const EAST_X = 25; // East Lane
rectRoad(0, MAIN_Z, 1, 124, 7, "cobble");
rectRoad(0, NORTH_Z, 1, 56, 6, "cobble");
rectRoad(WEST_X, 0, 0, 43, 6, "cobble");
rectRoad(EAST_X, 0, 0, 43, 6, "cobble");
// Bridge Street, from the green to the watersplash.
rectRoad(0, 33, 0, 30, 6, "cobble");

// The north road: through the ford, past the mill lane's end, and up the
// orchard hill to flag D's yard.
const FORD_C = { x: 0, z: brookZ(0), r: 14 };
FORDS.push(FORD_C);
pathRoad([[0, 46], [0, 100], [40, 106], [70, 104], [96, 102]], 6, "dirt", 12);
// The mill lane, along the north bank to flag A's yard.
pathRoad([[-3, 100], [-30, 102], [-56, 92], [-68, 76], [-76, 60]], 5.5, "dirt");
// T1's road: out of the orchard yard's back, down to the home yard, and on
// through the gatehouse off the north edge.
pathRoad([[118, 112], [140, 134], [160, 150], [160, 206]], 6, "dirt");
// The grange lane: off the west end of Main Street, south-west to flag B.
pathRoad([[-60, MAIN_Z], [-72, MAIN_Z], [-84, -34], [-90, -62], [-92, -78]], 6, "dirt");
// T0's road: out of the grange's yard, down to the home yard, and on through
// the gatehouse off the south edge.
pathRoad([[-104, -106], [-132, -128], [-160, -150], [-160, -206]], 6, "dirt");
// The kiln lane: off the east end of Main Street, south-east to flag E.
pathRoad([[60, MAIN_Z], [72, MAIN_Z], [84, -32], [92, -46]], 6, "dirt");
// The south track: off Main Street's middle to Southfield Farm.
pathRoad([[0, -20], [0, -58], [4, -82]], 4.5, "dirt");
// The west flank lane, A to B: out of the mill yard's south side, through
// the mill ford, and down the west fields past Brookside Farm.
const FORD_W = { x: -94, z: 39, r: 14 };
FORDS.push(FORD_W);
pathRoad([[-92, 52], [-94, 28], [-100, 0], [-104, -34], [-100, -64]], 4.5, "dirt");
// The east flank lane, D to E: down the orchard hill's south slope, through
// the east ford, past Eastfield Farm and into the kiln yard from the north.
const FORD_E = { x: 124, z: brookZ(124), r: 14 };
FORDS.push(FORD_E);
pathRoad([[104, 84], [118, 62], [124, 34], [118, 4], [108, -26], [100, -46]], 4.5, "dirt");

// Church Lane and Brook Lane: North Street's two ends run on out of the
// village, west to the mill ford's lane and east to the east ford's, behind
// the church and the inn.
pathRoad([[-26, NORTH_Z], [-62, NORTH_Z], [-80, 15], [-96.5, 14]], 5, "dirt");
pathRoad([[26, NORTH_Z], [62, NORTH_Z], [84, 22], [120.5, 20]], 5, "dirt");

const network = roadNetwork(roadDefs);
const ROADS = network.footprint;
const onRoadAt = (x, z, pad = 0) => onRoad(ROADS, x, z, pad);

// Every road stays dry except at a declared ford.
for (let x = -HALF; x <= HALF; x += 1) {
  for (let z = -HALF; z <= HALF; z += 1) {
    if (!onRoadAt(x, z) || !wet(x, z, 0)) continue;
    if (FORDS.some((f) => Math.hypot(x - f.x, z - f.z) < f.r)) continue;
    throw new Error(`road: a carriageway runs into the brook at (${x}, ${z}) with no ford declared there`);
  }
}

// --- what is already there ---------------------------------------------------

/**
 * Everything that has claimed ground, as axis-aligned rectangles. `solid` is
 * a building or a prop, `low` a flag ring or a spawn (refuses everything),
 * and `open` a yard or the green — which refuses a building and nothing else,
 * and which is what a door is allowed to open onto.
 */
const claimed = [];
const refused = [];
const open = [];

function overlaps(r, pad, skip) {
  for (const c of claimed) {
    if (skip && skip(c)) continue;
    if (r.x1 + pad > c.x0 && r.x0 - pad < c.x1 && r.z1 + pad > c.z0 && r.z0 - pad < c.z1) return c;
  }
  return null;
}

function claim(r, type = "solid", note = "") {
  claimed.push({ ...r, type, note });
}

function yard(x0, x1, z0, z1, note) {
  const r = { x0, x1, z0, z1 };
  open.push(r);
  claim(r, "open", note);
}

/** How far the floor falls across a footprint, from its centre's own height. */
function relief(r) {
  const cx = (r.x0 + r.x1) / 2;
  const cz = (r.z0 + r.z1) / 2;
  const h0 = floorAt(cx, cz);
  let worst = 0;
  for (const fx of [0, 0.5, 1]) {
    for (const fz of [0, 0.5, 1]) {
      worst = Math.max(worst, Math.abs(floorAt(r.x0 + fx * (r.x1 - r.x0), r.z0 + fz * (r.z1 - r.z0)) - h0));
    }
  }
  return worst;
}

function footOnRoad(r) {
  for (let x = r.x0; x <= r.x1 + 1e-9; x += Math.min(1, (r.x1 - r.x0) / 2 || 1)) {
    for (let z = r.z0; z <= r.z1 + 1e-9; z += Math.min(1, (r.z1 - r.z0) / 2 || 1)) {
      if (onRoadAt(x, z, 0.2)) return true;
    }
  }
  return false;
}

function footWet(r, margin = 0.35) {
  for (const fx of [0, 0.25, 0.5, 0.75, 1]) {
    for (const fz of [0, 0.25, 0.5, 0.75, 1]) {
      if (wet(r.x0 + fx * (r.x1 - r.x0), r.z0 + fz * (r.z1 - r.z0), margin)) return true;
    }
  }
  return false;
}

const inOpen = (x, z) => open.some((o) => x >= o.x0 && x <= o.x1 && z >= o.z0 && z <= o.z1);

/**
 * Whether a door opens onto somewhere: walk out of the front face's middle up
 * to `reach` metres and find a road, a yard or the green before anything
 * solid. Returns null when it does, and the reason when it does not.
 */
function doorway(kind, x, z, turn, params, self, reach = 16) {
  const [, , z0] = FOOT[kind](params ?? {});
  const [fx, fz] = turnOf(0, -1, turn);
  const [sx, sz] = turnOf(0, z0, turn);
  for (let t = 0.3; t <= reach; t += 0.5) {
    const px = x + sx + fx * t;
    const pz = z + sz + fz * t;
    if (onRoadAt(px, pz) || inOpen(px, pz)) return null;
    const hit = claimed.find((c) => c !== self && c.type === "solid" && px >= c.x0 && px <= c.x1 && pz >= c.z0 && pz <= c.z1);
    if (hit) return `door blocked by ${hit.note || "a claim"} at (${px.toFixed(0)}, ${pz.toFixed(0)})`;
    if (wet(px, pz, 0)) return `door opens onto the brook at (${px.toFixed(0)}, ${pz.toFixed(0)})`;
  }
  return "door opens onto nothing";
}

/**
 * Emit one placement, claiming its footprint first. Refused on a claim, on a
 * road, in the water, on a slope and — for a building — on a door that opens
 * onto nothing, unless an option says otherwise.
 */
function place(kind, x, z, turn, params, opts = {}) {
  const r = worldFoot(kind, x, z, turn, params);
  const pad = opts.pad ?? 0.8;
  const why = (() => {
    if (Math.max(Math.abs(r.x0), Math.abs(r.x1), Math.abs(r.z0), Math.abs(r.z1)) > HALF - 4) return "the edge";
    if (!opts.force) {
      // A yard refuses a building and takes anything else: that is what a
      // yard is. A flag's ring takes the same props — a cart and a stack of
      // crates are the cover a flag is fought over — but never on the flag.
      const prop = PROPS.has(kind);
      const hit = overlaps(r, pad, opts.skip ?? ((c) => (c.type === "open" && !DOORS.has(kind)) || (c.type === "flag" && prop)));
      if (prop && FLAGS.some((f) => f.x > r.x0 - 3 && f.x < r.x1 + 3 && f.z > r.z0 - 3 && f.z < r.z1 + 3)) return "a flag's own ground";
      if (hit) return `a ${hit.type} claim (${hit.note || "?"}) x ${hit.x0.toFixed(1)}..${hit.x1.toFixed(1)} z ${hit.z0.toFixed(1)}..${hit.z1.toFixed(1)}`;
      if (!opts.roadOk && footOnRoad(r)) return "a road";
      // A piece that reaches over the water on purpose (the mill's wheel) states
      // the part of it that must be dry, in its own frame.
      const dry = opts.dry
        ? (() => {
            const [a, b, c, d] = opts.dry;
            const q = [turnOf(a, c, turn), turnOf(b, d, turn)];
            return { x0: Math.min(q[0][0], q[1][0]) + x, x1: Math.max(q[0][0], q[1][0]) + x, z0: Math.min(q[0][1], q[1][1]) + z, z1: Math.max(q[0][1], q[1][1]) + z };
          })()
        : r;
      if (!opts.wetOk && footWet(dry)) return "the water";
      if (!opts.anySlope && relief(dry) > (opts.flat ?? FLAT)) return `a slope of ${relief(dry).toFixed(2)}`;
    }
    return null;
  })();
  if (why) {
    refused.push(`${kind} at (${x.toFixed(0)}, ${z.toFixed(0)}) turn ${turn}: ${why}`);
    return false;
  }
  const self = opts.noClaim ? null : { ...r, type: "solid", note: opts.note ?? kind };
  if (self) claimed.push(self);
  if (DOORS.has(kind) && !opts.noDoor) {
    const bad = doorway(kind, x, z, turn, params, self);
    if (bad) {
      if (self) claimed.splice(claimed.indexOf(self), 1);
      refused.push(`${kind} at (${x.toFixed(0)}, ${z.toFixed(0)}) turn ${turn}: ${bad}`);
      return false;
    }
  }
  emit(kind, x, z, turn, params, opts.y);
  return true;
}

/** A named set piece: place it, and refuse to write the map if it did not fit. */
function must(kind, x, z, turn, params, opts = {}) {
  if (place(kind, x, z, turn, params, opts)) return;
  throw new Error(`set piece: ${refused[refused.length - 1]}. Move the piece.`);
}

// --- the flags, the homes and the yards claim before any building does -------

const FLAGS = [
  { id: "A", name: "The Mill", x: -88, z: 58.5, r: 11 },
  { id: "B", name: "The Grange", x: -94, z: -94, r: 13 },
  { id: "C", name: "The Market Green", x: 0, z: -2, r: 14 },
  { id: "D", name: "Orchard Hill", x: 104, z: 100, r: 13 },
  { id: "E", name: "The Kiln Yard", x: 98, z: -62, r: 13 },
];
const byId = Object.fromEntries(FLAGS.map((f) => [f.id, f]));
for (const f of FLAGS) {
  claim({ x0: f.x - f.r * 0.8, x1: f.x + f.r * 0.8, z0: f.z - f.r * 0.8, z1: f.z + f.r * 0.8 }, "flag", `flag ${f.id}`);
}

// The green, and every yard a door may open onto.
yard(GREEN.x0, GREEN.x1, GREEN.z0, GREEN.z1, "the green");
yard(-110, -74, 47, 62.5, "the mill yard");
yard(-108, -82, -110, -80, "the grange's yard");
yard(-126, -104, -126, -106, "the grange's rickyard");
yard(80, 116, -78, -48, "the kiln yard");
yard(94, 124, 88, 112, "the orchard farm's yard");
yard(6, 26, 37.5, 48, "the inn yard");

const HOMES = [
  { team: 0, x: -156, z: -156, y: 2.2, yaw: "Math.PI / 4", s: 1 },
  { team: 1, x: 156, z: 156, y: 2.0, yaw: "-Math.PI * 0.75", s: -1 },
];
const spawns = [];
for (const h of HOMES) {
  // Three spawns on the yard's inner half, clear of the road through it.
  for (const [dx, dz] of [[-14, 6], [-8, 12], [-16, -4]]) {
    const x = h.x + h.s * dx;
    const z = h.z + h.s * dz;
    if (onRoadAt(x, z, 1.5)) throw new Error(`spawn: T${h.team}'s home spawn at (${x}, ${z}) is on the road`);
    claim({ x0: x - 3, x1: x + 3, z0: z - 3, z1: z + 3 }, "low", "a home spawn");
    spawns.push(`  { team: ${h.team}, pos: new Vector3(${n2(x)}, ${n2(floorAt(x, z))}, ${n2(z)}), yaw: ${h.yaw} },`);
  }
}
const VEHICLES = HOMES.map((h) => ({ team: h.team, x: h.x + h.s * 10, z: h.z - h.s * 4, yaw: h.yaw }));
for (const v of VEHICLES) {
  if (onRoadAt(v.x, v.z, 2)) throw new Error(`vehicle: T${v.team}'s hardstanding at (${v.x}, ${v.z}) is on the road`);
  claim({ x0: v.x - 5.5, x1: v.x + 5.5, z0: v.z - 5.5, z1: v.z + 5.5 }, "low", "a hardstanding");
}

// --- the home yards ----------------------------------------------------------

section(placements, "home yards");
placements.push(
  "  // Each gatehouse arches over its home road where it leaves the map; the",
  "  // barricades face out, toward the country the side came in from.",
);
must("gatehouse", -160, -172, 0, { teamColor: "@HARVEST" }, { force: true });
must("gatehouse", 160, 172, 2, { teamColor: "@DROVE" }, { force: true });
for (const h of HOMES) {
  const s = h.s;
  place("cart", h.x - s * 14, h.z + s * 10, 1, null);
  place("crates", h.x - s * 16, h.z + s * 2, 0, null);
  place("woodpile", h.x + s * 2, h.z - s * 13, 0, null);
  place("trough", h.x - s * 6, h.z + s * 16, 0, null);
  place("shed", h.x - s * 16, h.z - s * 6, s > 0 ? 3 : 1, { width: 4.4, depth: 3.2 }, { note: "home shed" });
}

// --- C — the village ---------------------------------------------------------

section(placements, "C: The Market Green");
placements.push(
  "  // The green is the middle of the village and of the map: a well at its",
  "  // top, the market stalls round the flag, and every house round it turned",
  "  // to face it — the church and the inn across North Street, a terrace down",
  "  // each side lane, and Main Street's two frontages below.",
);
must("well", 0, 9, 0, null, { force: true });
for (const [x, z, t] of [[-12, -6, 0], [12, -6, 0], [-10, 6, 2], [11, 5, 2]]) {
  must("stall", x, z, t, null, { force: true });
}
must("trough", -17, 9, 1, null, { force: true });
must("trough", 17, -10, 1, null, { force: true });
must("cart", -16, -11, 0, null, { force: true });
// The church, across North Street from the green, its door to the green and
// its tower to the brook. The churchyard wall is laid below with the fields.
const CHURCH = { x: -15, z: 35 };
must("chapel", CHURCH.x, CHURCH.z, 0, null, { note: "the church" });
// The coaching inn, across Bridge Street from the church: porch to the green,
// yard behind.
must("tavern", 14.5, 31, 0, null, { note: "the inn" });
place("shed", 22, 43, 2, { width: 6, depth: 3.4 }, { note: "the inn's stable" });
place("cart", 10, 42, 1, null);
place("woodpile", 4.6, 40, 1, { length: 4 });
place("crates", 18, 38.5, 0, null);

/**
 * A row of houses along a street. `edge` is the kerb's coordinate, `a..b` the
 * run along it, and `face` the side of the house the street is on — so every
 * house in a row faces its street by construction. `kinds` is the row's
 * recipe: each entry `[kind, weight, params]`.
 */
function houseRow(edge, a, b, face, kinds, opts = {}) {
  const alongX = face === "north" || face === "south";
  const turn = FACES[face];
  const back = { south: 1, north: -1, west: 1, east: -1 }[face];
  const setback = opts.setback ?? [1.2, 2.5];
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
    const [kind, , base] = spec;
    const params = { ...(typeof base === "function" ? base() : base) };
    const [x0, x1, z0, z1] = FOOT[kind](params);
    const w = x1 - x0;
    const front = -z0;
    const deep = z1 - z0;
    if (t + w > end) break;
    const mid = t + w / 2 - (x0 + x1) / 2;
    const off = edge + back * (rand(setback[0], setback[1]) + front);
    const [x, z] = alongX ? [mid, off] : [off, mid];
    void deep;
    if (place(kind, Number(x.toFixed(1)), Number(z.toFixed(1)), turn, params, { pad: opts.pad ?? 0.3, note: opts.note ?? kind })) {
      placedHere++;
      t += w + (kind === "townhouse" ? rand(0.3, 0.8) : rand(1.5, 4));
    } else {
      t += 1;
    }
  }
  return placedHere;
}

const cottage = () => ({
  width: Number(rand(6.5, 9).toFixed(1)),
  depth: Number(rand(5.6, 6.6).toFixed(1)),
  ...(chance(0.35) ? { enterable: true } : {}),
  ...(chance(0.5) ? { litWindows: true } : {}),
});
const townhouse = () => ({
  width: Number(rand(6, 7.2).toFixed(1)),
  depth: Number(rand(6.2, 7).toFixed(1)),
  ...(chance(0.35) ? { enterable: true } : {}),
  ...(chance(0.55) ? { litWindows: true } : {}),
});
const TOWN = [["townhouse", 3, townhouse], ["cottage", 1, cottage]];
const VILLAGE = [["cottage", 3, cottage], ["townhouse", 1, townhouse]];

// The smithy, on East Lane facing the green across it.
must("smithy", EAST_X + 3 + 0.8 + 6.6, 6, 1, null, { note: "the smithy" });
// West Lane's terrace, facing east across the lane to the green.
houseRow(WEST_X - 3, -13.5, 15, "east", TOWN, { setback: [0.6, 1.2], note: "west terrace" });
// East Lane, below the smithy.
houseRow(EAST_X + 3, -13.5, -1, "west", TOWN, { setback: [0.6, 1.2], note: "east terrace" });
// Main Street's south side, the whole length of the village, gapped for the
// south track.
houseRow(MAIN_Z - 3.5, -58, -4, "north", TOWN, { setback: [0.6, 1.6], note: "Main Street south" });
houseRow(MAIN_Z - 3.5, 4, 58, "north", TOWN, { setback: [0.6, 1.6], note: "Main Street south" });
// Main Street's north side, either side of the green's lanes.
houseRow(MAIN_Z + 3.5, -60, -30, "south", VILLAGE, { setback: [1.2, 2.5], note: "Main Street north" });
houseRow(MAIN_Z + 3.5, 30, 60, "south", VILLAGE, { setback: [1.2, 2.5], note: "Main Street north" });
// North Street's corners, beyond the church and the inn.
houseRow(NORTH_Z + 3, -28, -24, "south", VILLAGE, { note: "North Street" });
houseRow(NORTH_Z + 3, 24, 28, "south", VILLAGE, { note: "North Street" });
// Church Lane and Brook Lane, both sides.
houseRow(NORTH_Z + 2.5, -64, -30, "south", VILLAGE, { setback: [1.5, 3], note: "Church Lane" });
houseRow(NORTH_Z - 2.5, -64, -32, "north", VILLAGE, { setback: [1.5, 3], note: "Church Lane" });
houseRow(NORTH_Z + 2.5, 30, 64, "south", VILLAGE, { setback: [1.5, 3], note: "Brook Lane" });
houseRow(NORTH_Z - 2.5, 42, 64, "north", VILLAGE, { setback: [1.5, 3], note: "Brook Lane" });
// The south track's two cottages.
houseRow(-2.25, -56, -30, "east", VILLAGE, { setback: [2, 3], note: "south track" });
houseRow(2.25, -56, -30, "west", VILLAGE, { setback: [2, 3], note: "south track" });

// Back plots: a shed, a woodpile or a haystack behind the rows.
for (let i = 0; i < 70; i++) {
  const x = rand(-66, 66);
  const z = rand(-50, 44);
  const kind = pick(["shed", "shed", "woodpile", "haystack", "crates"]);
  const params = kind === "shed" ? { width: Number(rand(3, 4.4).toFixed(1)), depth: Number(rand(2.6, 3.2).toFixed(1)) } : null;
  // Every claim refuses these, the green and the yards included: a back plot
  // is behind a house, never on the ground the village is laid out round.
  place(kind, Number(x.toFixed(1)), Number(z.toFixed(1)), Math.floor(rng() * 4), params, { pad: 1.4, skip: () => false });
}

section(placements, "the fordside");
// The footbridge beside the watersplash, bank to bank, so nobody on foot
// wades the ford. A bridge samples the ground once, at its centre — the
// brook's bed — so `y` lifts its local zero back to the lower bank, and the
// deck (0.14 over local zero) lands on both. Laid before the cottages, with
// a landing claimed off each end, so nothing is built across its approach.
{
  const bx = 6.8;
  const bz = Number(brookZ(bx).toFixed(1));
  const len = 2 * (LIP + 1);
  const ends = Math.min(floorAt(bx, bz - len / 2), floorAt(bx, bz + len / 2));
  must("bridge", bx, bz, 0, { length: len, width: 2.4 }, { force: true, y: Number((ends - floorAt(bx, bz)).toFixed(2)), note: "the footbridge" });
  for (const s of [-1, 1]) {
    const lz = bz + s * (len / 2 + 2.5);
    claim({ x0: bx - 1.6, x1: bx + 1.6, z0: lz - 2.5, z1: lz + 2.5 }, "open", "the footbridge's landing");
  }
}
// The cottages at the ford, on the north bank.
houseRow(3, 83, 93, "west", VILLAGE, { setback: [2, 3], note: "fordside" });
houseRow(-3, 83, 93, "east", VILLAGE, { setback: [2, 3], note: "fordside" });
houseRow(105, -32, -10, "south", VILLAGE, { setback: [1.5, 2.5], note: "mill lane" });
place("shrine", -7, 106, 0, null, { pad: 0.3 });

// --- A — the mill ------------------------------------------------------------

section(placements, "A: The Mill");
placements.push(
  "  // The mill stands on the brook's east bank where it runs south out of the",
  "  // millpond, its wheel over the water and its lane door to the yard. The",
  "  // brook bends round the yard's west and south sides, so every way in but",
  "  // the mill lane from the east is a wade.",
);
{
  // Twelve metres off the brook's centreline puts the wheel (local -X) at the
  // water's edge and the walls on the level bank.
  const mz = 70;
  let bx = -200;
  for (const [x, z] of BROOK) if (Math.abs(z - mz) < 0.6 && x > -130 && x < -100) bx = Math.max(bx, x);
  must("mill", Number((bx + 11.5).toFixed(1)), mz, 0, null, { note: "the mill", dry: [-4, 5, -4.5, 4.5] });
  must("cottage", -88, 77, 0, { width: 9, depth: 6.5, enterable: true, litWindows: true }, { note: "the miller's house" });
  place("cottage", -71.5, 81, 3, { width: 7.5, depth: 6, litWindows: true }, { note: "the mill cottage" });
  place("shed", -97, 79, 0, { width: 5, depth: 3.2 }, { note: "the mill store" });
  place("cart", -86, 66, 0, null, { force: true });
  place("crates", -99, 60, 0, null);
  place("trough", -80, 60, 1, null);
  place("woodpile", -75, 56, 1, { length: 4 });
  place("haystack", -104, 54, 0, null);
}

// --- B — the grange ----------------------------------------------------------

section(placements, "B: The Grange");
placements.push(
  "  // The big barn farm: the barn's cart doors to the yard and the rickyard,",
  "  // its loft ramp up the east side, the farmhouse facing the yard across it,",
  "  // twin silos at its gate and the paddocks south.",
);
{
  must("barn", -122, -92, 0, null, { note: "the barn", noDoor: true });
  must("townhouse", -76, -94, 1, { width: 9, depth: 7, enterable: true, litWindows: true }, { note: "the grange farmhouse" });
  must("silo", -80, -76, 0, null, { note: "a silo" });
  must("silo", -72, -84, 0, null, { note: "a silo" });
  place("cottage", -104, -72, 0, { width: 7, depth: 6, litWindows: true }, { note: "the cowman's cottage", noDoor: true });
  place("shed", -96, -114, 2, { width: 7, depth: 3.6 }, { note: "the cart shed" });
  for (const [x, z] of [[-114, -112], [-120, -118], [-110, -120], [-124, -110]]) place("haystack", x, z, 0, null);
  place("cart", -100, -86, 1, null);
  place("cart", -88, -104, 0, { ruined: true });
  place("trough", -86, -86, 1, null);
  place("woodpile", -104, -80, 0, null);
  place("crates", -90, -83, 0, null);
}

// --- D — orchard hill --------------------------------------------------------

section(placements, "D: Orchard Hill");
placements.push(
  "  // The farm on the hill's crown, the look-out over the vale on its east",
  "  // edge, and the orchard down the south and west slopes inside its walls.",
);
{
  must("cottage", 106, 119, 0, { width: 10, depth: 7, enterable: true, litWindows: true }, { note: "the orchard farmhouse" });
  must("watchtower", 128, 96, 2, null, { note: "the look-out", anySlope: true });
  place("shed", 94, 118, 0, { width: 5, depth: 3.4 }, { note: "the apple store" });
  place("cart", 116, 92, 1, null);
  place("haystack", 96, 90, 0, null);
  place("trough", 104, 110, 0, null);
  place("crates", 110, 90, 0, null);
}

// --- E — the kiln yard -------------------------------------------------------

section(placements, "E: The Kiln Yard");
placements.push(
  "  // A brickworks: three kilns in a row with their stoke holes to the yard,",
  "  // the drying sheds, the stacks of fuel, and the kiln master's cottage at",
  "  // the gate. A close brawl in a map of long looks.",
);
{
  for (const x of [88, 98, 108]) must("kiln", x, -77, 2, null, { note: "a kiln" });
  must("cottage", 74.5, -62, 3, { width: 7.5, depth: 6, enterable: true, litWindows: true }, { note: "the kiln master's cottage" });
  place("shed", 114, -56, 1, { width: 10, depth: 4 }, { note: "a drying shed" });
  place("shed", 84, -84, 2, { width: 10, depth: 4 }, { note: "a drying shed" });
  place("shed", 104, -84, 2, { width: 8, depth: 4 }, { note: "a drying shed" });
  place("woodpile", 90, -56, 1, { length: 6 });
  place("woodpile", 108, -64, 0, { length: 6 });
  place("woodpile", 118, -72, 1, { length: 5 });
  place("crates", 94, -66, 0, null);
  place("crates", 104, -52, 0, null);
  place("cart", 84, -64, 1, null);
  place("cart", 112, -80, 0, { ruined: true });
  place("ruin", 122, -86, 0, { width: 9, depth: 7 }, { note: "the old kiln house" });
}

// --- the farms ---------------------------------------------------------------

section(placements, "the farms");
placements.push(
  "  // A farmhouse on each lane between the flags, facing its lane, with its",
  "  // yard, a shed and its ricks: the cover a flank route is fought through.",
);
/** A farmstead: a house facing the lane, and its yard behind. */
function farm(name, hx, hz, turn, extras) {
  must("cottage", hx, hz, turn, { width: 9, depth: 6.5, enterable: true, litWindows: true }, { note: name });
  for (const [kind, x, z, t, p] of extras) place(kind, x, z, t, p ?? null, { note: `${name}'s ${kind}` });
}
farm("Brookside Farm", -112, -4, 3, [
  ["shed", -124, 4, 0, { width: 6, depth: 3.4 }],
  ["haystack", -126, -10, 0],
  ["haystack", -120, -14, 0],
  ["cart", -112, 8, 0],
  ["woodpile", -122, -2, 1],
]);
farm("Eastfield Farm", 132, -4, 1, [
  ["shed", 144, 6, 0, { width: 6, depth: 3.4 }],
  ["haystack", 146, -8, 0],
  ["haystack", 140, -12, 0],
  ["cart", 134, 8, 0],
  ["woodpile", 144, -2, 1],
]);
farm("Southfield Farm", 4, -90, 2, [
  ["shed", -8, -94, 3, { width: 6, depth: 3.4 }],
  ["haystack", 14, -96, 0],
  ["haystack", 16, -88, 0],
  ["cart", -6, -84, 1],
  ["trough", 12, -82, 0],
]);
farm("North Farm", 30, 114, 0, [
  ["shed", 40, 123, 0, { width: 6, depth: 3.4 }],
  ["haystack", 18, 122, 0],
  ["haystack", 22, 126, 0],
  ["cart", 41, 113, 1],
  ["woodpile", 18, 114, 1],
]);
// Wayside cottages along the lanes out of the village.
place("cottage", -95, -44, 3, { width: 7.5, depth: 6, litWindows: true }, { note: "the lane cottage" });
place("cottage", 78, -40, 3, { width: 7.5, depth: 6, litWindows: true }, { note: "the lane cottage" });
place("shrine", -68, -27, 0, null, { pad: 0.3 });
place("shrine", 68, -27, 0, null, { pad: 0.3 });

// --- the fields --------------------------------------------------------------

/**
 * The field boundaries, as long lines across the vale: `[x0, z0, x1, z1,
 * kind]`, axis-aligned: `wall` for dry stone (stops a round), `fence` for
 * post and rail (stops a body) and `hedge` for a hedgerow with nothing built
 * in it (stops neither — its trunks are the cover). Each is cut into runs wherever it meets a
 * road, a claim or the water, so the gates are where the lanes are; a run
 * shorter than `MIN_RUN` is dropped, and a long one split into lengths the
 * builder steps well on a slope.
 */
const BOUNDARIES = [
  // The churchyard, walled on its three open sides.
  [-26, 24, -26, 56, "wall"],
  [-26, 56, -5.6, 56, "wall"],
  [-5.6, 24, -5.6, 56, "wall"],
  // The mill's water meadows, north of the mill lane.
  [-110, 96, -30, 96, "hedge"],
  [-70, 96, -70, 130, "wall"],
  [-110, 130, -20, 130, "wall"],
  [-30, 96, -30, 150, "hedge"],
  // North of the village, between the north road and the orchard.
  [10, 110, 10, 170, "wall"],
  [22, 140, 90, 140, "wall"],
  [70, 60, 70, 96, "hedge"],
  [30, 78, 90, 78, "wall"],
  // The orchard's walls.
  [80, 60, 80, 96, "wall"],
  [80, 60, 136, 60, "wall"],
  [136, 60, 136, 126, "wall"],
  // East of the orchard, down to the brook.
  [140, 80, 200, 80, "fence"],
  [150, 40, 150, 120, "wall"],
  // The east fields, E to the brook.
  [110, -20, 196, -20, "wall"],
  [160, -60, 160, 10, "hedge"],
  [126, -44, 180, -44, "wall"],
  // Between the village and the kiln yard.
  [40, -60, 76, -60, "wall"],
  [48, -40, 48, -100, "fence"],
  [60, -120, 140, -120, "wall"],
  // The south fields.
  [-60, -60, -10, -60, "wall"],
  [-40, -60, -40, -150, "hedge"],
  [-30, -120, 40, -120, "wall"],
  [20, -60, 20, -150, "hedge"],
  [-80, -150, 90, -150, "wall"],
  // Between the village and the grange.
  [-120, -50, -40, -50, "wall"],
  [-66, -50, -66, -130, "fence"],
  // The west fields, B to the brook.
  [-190, -30, -110, -30, "wall"],
  [-140, -80, -140, 30, "hedge"],
  [-190, 10, -126, 10, "wall"],
  // North of the brook, west of the mill.
  [-190, 60, -128, 60, "fence"],
  // Round the home yards' approaches.
  [-190, -120, -110, -120, "wall"],
  [-120, -190, -120, -130, "fence"],
  [110, 130, 110, 190, "fence"],
  [130, 130, 190, 130, "wall"],
];
const MIN_RUN = 6;
const MAX_RUN = 26;

/** Whether a point on a boundary line may carry a run. */
function runnable(x, z) {
  if (Math.abs(x) > HALF - 3 || Math.abs(z) > HALF - 3) return false;
  if (onRoadAt(x, z, 2.2)) return false;
  if (wet(x, z, 0.5)) return false;
  if (grade(x, z) > 0.3) return false;
  for (const c of claimed) {
    const pad = c.type === "low" ? 2 : 1.8;
    if (x > c.x0 - pad && x < c.x1 + pad && z > c.z0 - pad && z < c.z1 + pad) return false;
  }
  return true;
}

const runs = [];
for (const [x0, z0, x1, z1, kind] of BOUNDARIES) {
  const alongX = z0 === z1;
  const a = alongX ? Math.min(x0, x1) : Math.min(z0, z1);
  const b = alongX ? Math.max(x0, x1) : Math.max(z0, z1);
  const at = alongX ? z0 : x0;
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
        runs.push({ alongX, at, s0, s1, kind });
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
}

section(placements, "the fields");
placements.push(
  "  // Every field boundary, cut into runs wherever a lane, a yard, a flag or",
  "  // the brook crosses it — so the gates are where the lanes are. Dry stone",
  "  // stops a round; post and rail stops only a body.",
);
for (const r of runs) {
  const len = Number((r.s1 - r.s0).toFixed(1));
  const mid = (r.s0 + r.s1) / 2;
  const [x, z] = r.alongX ? [mid, r.at] : [r.at, mid];
  // A hedge is dressing only — its trees and its understory, below — so it
  // claims its line without emitting a placement.
  if (r.kind === "hedge") {
    const [w, d] = r.alongX ? [len, 1.2] : [1.2, len];
    claim({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 }, "solid", "a hedge");
    r.placed = true;
    continue;
  }
  const kind = r.kind === "wall" ? "stoneWall" : "fence";
  const params = { length: len };
  if (place(kind, Number(x.toFixed(1)), Number(z.toFixed(1)), r.alongX ? 0 : 1, params, { anySlope: true, pad: 0, note: "a field boundary" })) {
    r.placed = true;
  }
}

// Field furniture: haystacks and troughs out in the fields, a ruin or two.
for (const [kind, x, z, t, p] of [
  ["haystack", -52, -80, 0], ["haystack", -48, -84, 0], ["haystack", 34, -132, 0], ["haystack", 140, -98, 0],
  ["haystack", -150, -60, 0], ["haystack", -52, 112, 0], ["haystack", 36, 150, 0], ["haystack", 170, 100, 0],
  ["trough", 30, -80, 0], ["trough", -130, -40, 1], ["trough", 170, -30, 0], ["trough", -90, 112, 0],
  ["ruin", 36, -38, 0, { width: 9, depth: 7 }], ["ruin", -150, 44, 0, { width: 8, depth: 7 }],
  ["ruin", 172, 60, 0, { width: 8, depth: 7 }], ["ruin", -40, -140, 0, { width: 10, depth: 8 }],
  ["cart", -150, -96, 0, { ruined: true }], ["cart", 60, 70, 1], ["cart", -20, 120, 0],
]) {
  place(kind, x, z, t, p ?? null, { note: `a field ${kind}` });
}

// --- the dressing -------------------------------------------------------------

/**
 * Whether a grove of radius `r` may be sown at (x, z): its whole disc dry,
 * clear of every claim but a road (a road already refuses what grows), under
 * `maxGrade`, and inside the square.
 */
function groveOk(x, z, r, maxGrade = 0.3, skipOpen = false) {
  if (Math.abs(x) + r > HALF - 3 || Math.abs(z) + r > HALF - 3) return false;
  const box = { x0: x - r, x1: x + r, z0: z - r, z1: z + r };
  if (overlaps(box, 0.5, (c) => skipOpen && c.type === "open")) return false;
  const ring = r > 8 ? 16 : 8;
  for (let k = 0; k <= ring; k++) {
    const a = (k / ring) * Math.PI * 2;
    const f = k === ring ? 0 : 1;
    const px = x + f * Math.cos(a) * (r + 1.5);
    const pz = z + f * Math.sin(a) * (r + 1.5);
    if (wet(px, pz, 0.5)) return false;
    if (grade(px, pz) > maxGrade) return false;
  }
  return true;
}

const ASH = ", scale: [0.8, 1.15], blocking: true, clearance: 2.0";
const PINE = ", scale: [0.9, 1.4], blocking: true, clearance: 1.2";
let trees = 0;
const f1 = (v) => n2(Number(v.toFixed(1)));
function disc(prop, x, z, r, count, extra = "") {
  scatter.push(`  { prop: "${prop}", x: ${f1(x)}, z: ${f1(z)}, radius: ${n2(r)}, count: ${count}${extra} },`);
}
function rectRegion(prop, x, z, w, d, count, extra = "") {
  scatter.push(`  { prop: "${prop}", x: ${f1(x)}, z: ${f1(z)}, width: ${f1(w)}, depth: ${f1(d)}, count: ${count}${extra} },`);
}

section(scatter, "the hedgerows");
scatter.push(
  "  // A line of standards over every field boundary and a fern understory",
  "  // under it: the wall stops a round at chest height, and the trunks are the",
  "  // same boundary saying so from the far end of the look it breaks.",
);
for (const r of runs) {
  if (!r.placed) continue;
  const len = r.s1 - r.s0;
  const mid = (r.s0 + r.s1) / 2;
  const [x, z] = r.alongX ? [mid, r.at] : [r.at, mid];
  const [w, d] = r.alongX ? [len, 5] : [5, len];
  // A hedge with nothing built under it is thicker: more standards, and
  // bramble through the fern, so it still reads as a boundary.
  const hedge = r.kind === "hedge";
  const n = Math.max(1, Math.round(len / (hedge ? 7 : 9)));
  rectRegion("ashTree", x, z, w, d, n, ASH);
  rectRegion("fernClump", x, z, w, d + 1, Math.max(2, Math.round(len / (hedge ? 2.5 : 3.5))), ", scale: [0.9, 1.5]");
  if (hedge) rectRegion("bramble", x, z, r.alongX ? len : 2, r.alongX ? 2 : len, Math.max(2, Math.round(len / 4)), ", scale: [0.9, 1.4]");
  trees += n;
}

section(scatter, "the brook");
scatter.push(
  "  // Ash along both banks, set back off the water; ferns on the wet edge.",
  "  // Held off the fords, the footbridge and the mill's wheel.",
);
{
  let k = 0;
  for (let i = 0; i < BROOK.length; i += 28) {
    const [x, z] = BROOK[i];
    if (Math.abs(x) > HALF - 8 || Math.abs(z) > HALF - 8) continue;
    const [nx, nz] = BROOK[Math.min(BROOK.length - 1, i + 2)];
    const dx = nx - x;
    const dz = nz - z;
    const len = Math.hypot(dx, dz) || 1;
    const side = k++ % 2 === 0 ? 1 : -1;
    const off = LIP + 3 + rand(0, 3);
    const px = x + (-dz / len) * off * side;
    const pz = z + (dx / len) * off * side;
    if (FORDS.some((f) => Math.hypot(px - f.x, pz - f.z) < f.r + 8)) continue;
    if (groveOk(px, pz, 3.5, 0.3)) {
      disc("ashTree", px, pz, 3.5, 2, ASH);
      trees += 2;
    }
    const fx = x + (-dz / len) * (LIP - 2) * -side;
    const fz = z + (dx / len) * (LIP - 2) * -side;
    if (!onRoadAt(fx, fz, 3) && !wet(fx, fz, 0.1)) disc("fernClump", fx, fz, 3, 3, ", scale: [0.8, 1.4]");
  }
  // Ferns round the millpond.
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    const px = POND.x + Math.cos(ang) * (POND.rx + 6);
    const pz = POND.z + Math.sin(ang) * (POND.rz + 6);
    if (!wet(px, pz, 0.1)) disc("fernClump", px, pz, 3, 3, ", scale: [0.8, 1.4]");
  }
}

section(scatter, "the orchard");
scatter.push(
  "  // Fruit trees in rows down the hill's south and west slopes, inside the",
  "  // orchard walls: the ash at half size, which is what an old apple tree's",
  "  // bole and crown read as at the far side of a field. One region a tree,",
  "  // because a region scatters at random and an orchard is a grid.",
);
{
  let fruit = 0;
  for (let z = 66; z <= 120; z += 9) {
    for (let x = 86; x <= 132; x += 9) {
      const px = x + (Math.floor((z - 66) / 9) % 2 ? 4.5 : 0);
      if (px > 132) continue;
      if (!groveOk(px, z, 0.6, 0.3)) continue;
      scatter.push(`  { prop: "ashTree", x: ${n2(px)}, z: ${n2(z)}, radius: 0.5, count: 1, scale: [0.5, 0.6], blocking: true, clearance: 1.0 },`);
      fruit++;
    }
  }
  trees += fruit;
}

section(scatter, "the green's trees");
scatter.push(
  "  // The two the village has, and the only regions on the map allowed the top",
  "  // of the scale: a green's tree is the biggest thing growing in a village.",
);
disc("ashTree", -18, 11, 2, 1, ", scale: [1.2, 1.3], blocking: true, clearance: 2.4");
disc("ashTree", 38, 8, 3, 1, ", scale: [1.1, 1.3], blocking: true, clearance: 2.4");
trees += 2;
section(scatter, "the churchyard");
scatter.push("  // Headstones, which a round passes over and a body crouches behind.");
rectRegion("gravestone", -15, 53, 18, 4, 9, ", scale: [0.85, 1.1]");
rectRegion("gravestone", -24, 38, 3, 20, 6, ", scale: [0.85, 1.1]");
rectRegion("gravestone", -6, 38, 3, 20, 6, ", scale: [0.85, 1.1]");

/** How wooded a point is meant to be, 0..1 — the hills and the edges. */
function woodiness(x, z) {
  let w = smooth((natural(x, z) - 4.5) / 4) * 0.9;
  const edge = Math.max(Math.abs(x), Math.abs(z));
  w = Math.max(w, smooth((edge - 160) / 30) * 0.7);
  w += 0.35 * vnoise(x, z, 44, 31);
  // The village, the flags and the fields between them stay open ground.
  if (Math.abs(x) < 80 && z > -60 && z < 100) w -= 0.6;
  // The orchard is planted in rows, and a wood sown over it is not an orchard.
  if (x > 76 && x < 140 && z > 56 && z < 130) w = 0;
  return Math.max(0, Math.min(1, w));
}

section(scatter, "the woods");
scatter.push(
  "  // Pine on the hilltops and ash on their flanks, sown against the finished",
  "  // floor: a grove is a disc checked dry, clear of every building and yard,",
  "  // and under a grade a tree stands on.",
);
for (let gz = -HALF + 14; gz < HALF - 8; gz += 22) {
  for (let gx = -HALF + 14; gx < HALF - 8; gx += 22) {
    const x = gx + rand(-5, 5);
    const z = gz + rand(-5, 5);
    const w = woodiness(x, z);
    if (w < 0.35) continue;
    let r = 0;
    for (const tryR of [11, 7, 4]) {
      if (groveOk(x, z, tryR, 0.3)) {
        r = tryR;
        break;
      }
    }
    if (!r) continue;
    const high = natural(x, z) > 6;
    const count = Math.max(1, Math.round((0.25 + w * 0.75) * (r * r) / 22));
    const pine = high ? chance(0.75) : chance(0.2);
    disc(pine ? "pine" : "ashTree", x, z, r, count, pine ? PINE : ASH);
    trees += count;
  }
}

section(scatter, "the copses");
scatter.push("  // A clump of three or four trees in the open fields: something to walk to.");
for (const [x, z, r] of [
  [-50, -30, 9], [50, -36, 8], [-130, 40, 9], [150, -70, 9], [-40, 150, 10], [80, 150, 9],
  [-170, -80, 9], [176, 20, 9], [-10, -140, 9], [70, -130, 9], [-80, -140, 8], [130, 150, 8],
  [-160, 130, 10], [40, 60, 6], [-40, 70, 6],
]) {
  if (groveOk(x, z, r, 0.3)) {
    disc("ashTree", x, z, r, 4, ASH);
    disc("fernClump", x, z, r, 6, ", scale: [0.9, 1.5]");
    trees += 4;
  }
}

section(scatter, "the yards' spill");
for (const [prop, x, z, r, n, extra] of [
  ["barrel", 22, 40, 3, 3, ", blocking: true, clearance: 0.55"],
  ["barrel", -96, 62, 3, 3, ", blocking: true, clearance: 0.55"],
  ["barrel", 100, -58, 4, 3, ", blocking: true, clearance: 0.55"],
  ["barrel", -92, -100, 4, 3, ", blocking: true, clearance: 0.55"],
  ["log", 116, -78, 5, 3, ", scale: [0.8, 1.2], blocking: true, clearance: 1.4"],
  ["boulder", -150, 150, 18, 5, ", scale: [0.8, 1.3], blocking: true, clearance: 1.0"],
  ["boulder", 6, -176, 18, 5, ", scale: [0.8, 1.3], blocking: true, clearance: 1.0"],
  ["boulder", 150, -150, 16, 4, ", scale: [0.8, 1.3], blocking: true, clearance: 1.0"],
  ["bramble", -60, -48, 10, 6, ", scale: [0.9, 1.5]"],
  ["bramble", 60, -50, 10, 6, ", scale: [0.9, 1.5]"],
]) {
  scatter.push(`  { prop: "${prop}", x: ${n2(x)}, z: ${n2(z)}, radius: ${n2(r)}, count: ${n}${extra} },`);
}

// --- the country beyond the play square ---------------------------------------

const zOutW = brookZ(-HALF);
const zOutE = brookZ(HALF);
const BORDERLAND = `
  // ===== THE COUNTRY BEYOND THE PLAY SQUARE ==================================
  // Appended LAST, and the order is mechanical: every region draws from one
  // seeded stream in array order, so a region spliced in above re-rolls every
  // field below it.
  //
  // The play square keeps a bare collar and the country resumes past it.
  // Nothing here is nearer than 90 m to the play edge, which is what makes
  // the whole block cost the FIGHT nothing: the leash is ten seconds and a
  // sprint is 6.9 m/s, so a living player reaches 69 m past the square and no
  // further, and a bot cannot reach the borderland at all (the nav graph stops
  // at the play square, and bots are never leashed). What it is for is the
  // HORIZON: 600 m of unbroken grass under \`fogEnd\` 520 is a flat plane
  // fading to \`fogColor\`, and what tells an eye that ground recedes is stuff
  // standing ON it at intervals — in farm country, woods and field boundaries.
  //
  // WHICH IS WHY NONE OF IT BLOCKS. A blocking prop is a collider, a
  // \`WorldBox\` and a row in the collision bake; out here it would be geometry
  // the bots can neither see nor route around, and something to CATCH a
  // player sprinting home against a countdown. Omit \`blocking\` and the props
  // emit nothing at all.
  //
  // AND IT IS NOT A RING, which would be the bowl the downs rim was removed
  // for. The north is the wooded side, the west and the east are where the
  // brook comes in and goes out — its ash line follows the channel on out,
  // since past the grid the floor is the clamped edge and the channel really
  // does run on out there — and the SOUTH is deliberately the thinnest.

  // NORTH — the wooded side.
  { prop: "pine", x: -320, z: 352, width: 130, depth: 104, count: 110, scale: [0.9, 1.4], clearance: 1.2 },
  { prop: "ashTree", x: -320, z: 300, width: 130, depth: 16, count: 14, scale: [0.8, 1.15], clearance: 2.0 },
  { prop: "ashTree", x: 112, z: 316, width: 276, depth: 12, count: 24, scale: [0.8, 1.15], clearance: 2.0 },
  { prop: "pine", x: 196, z: 432, width: 220, depth: 26, count: 34, scale: [0.9, 1.4], clearance: 1.2 },
  { prop: "ashTree", x: -80, z: 540, width: 376, depth: 14, count: 28, scale: [0.8, 1.15], clearance: 2.0 },

  // WEST — where the brook comes in, and the hanger the west wood runs into.
  { prop: "ashTree", x: -400, z: ${n2(zOutW + 18)}, width: 208, depth: 10, count: 14, scale: [0.8, 1.15], clearance: 2.0 },
  { prop: "ashTree", x: -400, z: ${n2(zOutW - 18)}, width: 208, depth: 10, count: 14, scale: [0.8, 1.15], clearance: 2.0 },
  { prop: "pine", x: -390, z: -58, width: 112, depth: 152, count: 118, scale: [0.9, 1.4], clearance: 1.2 },
  { prop: "ashTree", x: -326, z: -58, width: 14, depth: 152, count: 16, scale: [0.8, 1.15], clearance: 2.0 },
  { prop: "ashTree", x: -318, z: 220, width: 12, depth: 140, count: 12, scale: [0.8, 1.15], clearance: 2.0 },

  // EAST — where the brook leaves, and the south-east wood's country carrying on.
  { prop: "ashTree", x: 400, z: ${n2(zOutE + 18)}, width: 208, depth: 10, count: 14, scale: [0.8, 1.15], clearance: 2.0 },
  { prop: "ashTree", x: 400, z: ${n2(zOutE - 18)}, width: 208, depth: 10, count: 14, scale: [0.8, 1.15], clearance: 2.0 },
  { prop: "pine", x: 402, z: -222, width: 120, depth: 132, count: 108, scale: [0.9, 1.4], clearance: 1.2 },
  { prop: "ashTree", x: 336, z: -222, width: 14, depth: 132, count: 14, scale: [0.8, 1.15], clearance: 2.0 },
  { prop: "ashTree", x: 322, z: 160, width: 12, depth: 200, count: 18, scale: [0.8, 1.15], clearance: 2.0 },
  { prop: "pine", x: 544, z: 120, width: 26, depth: 200, count: 26, scale: [0.9, 1.4], clearance: 1.2 },

  // SOUTH — the open side, and kept open.
  { prop: "ashTree", x: -28, z: -322, width: 320, depth: 12, count: 26, scale: [0.8, 1.15], clearance: 2.0 },
  { prop: "pine", x: -398, z: -428, width: 110, depth: 96, count: 76, scale: [0.9, 1.4], clearance: 1.2 },
  { prop: "ashTree", x: 158, z: -404, radius: 26, count: 12, scale: [0.8, 1.15], clearance: 2.0 },
  { prop: "ashTree", x: 44, z: -536, width: 296, depth: 14, count: 22, scale: [0.8, 1.15], clearance: 2.0 },

  // THE CORNERS, which are the longest look out of this map: a corner is 283 m
  // from the middle against a side's 200, so these sit at the same 90 m collar
  // the sides do and are the nearest borderland there is.
  { prop: "pine", x: -330, z: -338, width: 104, depth: 92, count: 68, scale: [0.9, 1.4], clearance: 1.2 },
  { prop: "pine", x: 338, z: -330, width: 96, depth: 104, count: 66, scale: [0.9, 1.4], clearance: 1.2 },
  { prop: "ashTree", x: 352, z: 332, radius: 38, count: 22, scale: [0.8, 1.15], clearance: 2.0 },`;

// --- the water ---------------------------------------------------------------

/**
 * The one rect: the whole run of the brook and the millpond. Every point in it
 * that is under the surface has to be the brook's own channel — the floor is
 * held at `BANK - 0.1` everywhere else, so this checks that promise rather
 * than assuming it.
 */
let wz0 = Infinity;
let wz1 = -Infinity;
for (const [x, z] of BROOK) {
  if (Math.abs(x) > HALF + 2) continue;
  wz0 = Math.min(wz0, z);
  wz1 = Math.max(wz1, z);
}
wz0 = Math.floor(wz0 - LIP - 4);
wz1 = Math.ceil(Math.max(wz1, POND.z + POND.rz + POND.skirt) + LIP - 2);
const WATER = { x: 0, z: (wz0 + wz1) / 2, width: PLAY + 4, depth: wz1 - wz0, y: WATER_Y };
let deepest = 0;
for (let x = -HALF; x <= HALF; x += 1) {
  for (let z = wz0; z <= wz1; z += 1) {
    const d = WATER_Y - floorAt(x, z);
    if (d <= 0) continue;
    deepest = Math.max(deepest, d);
    const pond = Math.hypot((x - POND.x) / (POND.rx + POND.skirt), (z - POND.z) / (POND.rz + POND.skirt)) < 1.05;
    if (!pond && brookDist(x, z) > LIP + 2) {
      throw new Error(`water: the rect covers wet ground off the brook at (${x}, ${z})`);
    }
  }
}

// --- the grass ---------------------------------------------------------------

const grass = [];
let tufts = 0;
function turf(x, z, w, d, density, note) {
  if (note) grass.push(`  // ${note}`);
  grass.push(`  { x: ${f1(x)}, z: ${f1(z)}, width: ${f1(w)}, depth: ${f1(d)}, density: ${n2(density)} },`);
  tufts += w * d * density;
}
turf(0, 0, 44, 30, 1.15, "The green, mown closest and walked barest.");
turf(-88, 63, 26, 26, 0.7, "The yards.");
turf(-95, -95, 26, 30, 0.7);
turf(98, -63, 36, 30, 0.6);
turf(109, 100, 30, 24, 0.9);
turf(-156, -156, 36, 36, 0.5);
turf(156, 156, 36, 36, 0.5);
grass.push(
  "  // The fields, on a lattice: the ground BETWEEN the flags is most of what a",
  "  // player crosses, and a vale dressed only where the buildings are reads as",
  "  // a green table with farms on it. Thinner than the yards on purpose — this",
  "  // is grazed pasture seen mostly at fifty metres and up. Kept off the water:",
  "  // a wet rect is a lawn growing underwater.",
);
for (let gz = -HALF + 22; gz < HALF - 10; gz += 40) {
  for (let gx = -HALF + 22; gx < HALF - 10; gx += 40) {
    const x = gx + rand(-4, 4);
    const z = gz + rand(-4, 4);
    if (Math.abs(x) < 66 && z > -46 && z < 42) continue;
    if (woodiness(x, z) > 0.7) continue;
    let dry = true;
    for (const fx of [-1, 0, 1]) for (const fz of [-1, 0, 1]) if (wet(x + fx * 17, z + fz * 15, 0.1)) dry = false;
    if (!dry) continue;
    turf(x, z, 30, 26, Number(rand(0.3, 0.42).toFixed(2)));
  }
}
grass.push("  // The brook's banks, under the ash line: the wet edge grows thickest.");
for (let i = 0; i < BROOK.length; i += 60) {
  const [x, z] = BROOK[i];
  if (Math.abs(x) > HALF - 12) continue;
  for (const side of [-1, 1]) {
    const pz = z + side * (LIP + 5);
    if (!wet(x, pz, 0.1) && !wet(x, pz - side * 3, 0.05)) turf(x, pz, 22, 7, 0.65);
  }
}

// --- the flags' own spawns ---------------------------------------------------

const NAMED = FLAGS.map(
  (f) => `  { id: "${f.id}", name: "${f.name}", pos: new Vector3(${n2(f.x)}, ${n2(floorAt(f.x, f.z))}, ${n2(f.z)}), radius: ${f.r} },`,
);
for (const f of FLAGS) {
  for (const c of claimed) {
    if (c.type !== "solid") continue;
    if (f.x > c.x0 && f.x < c.x1 && f.z > c.z0 && f.z < c.z1) throw new Error(`flag ${f.id} stands in ${c.note}`);
  }
}

/** One spawn per objective, outside its ring, on open ground. */
const FLAG_SPAWNS = [
  ["A", 18, 4, "-Math.PI / 2"],
  ["B", 4, 18, "Math.PI"],
  ["C", 0, -30, "0"],
  ["D", -18, -4, "Math.PI / 2"],
  ["E", -4, 18, "Math.PI"],
];
for (const [id, dx, dz, yaw] of FLAG_SPAWNS) {
  const f = byId[id];
  const x = f.x + dx;
  const z = f.z + dz;
  const hit = claimed.find((c) => c.type === "solid" && x > c.x0 - 1 && x < c.x1 + 1 && z > c.z0 - 1 && z < c.z1 + 1);
  if (hit) throw new Error(`spawn: ${id}'s spawn at (${x}, ${z}) stands in ${hit.note}`);
  if (wet(x, z)) throw new Error(`spawn: ${id}'s spawn at (${x}, ${z}) is in the water`);
  spawns.push(`  { team: null, controlPoint: "${id}", pos: new Vector3(${n2(x)}, ${n2(floorAt(x, z))}, ${n2(z)}), yaw: ${yaw} },`);
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
if (worstGrade > MAX_GRADE * 0.9) {
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
    JSON.stringify({ claimed, placed, flags: FLAGS, fords: FORDS, vehicles: VEHICLES, water: WATER }),
  );
}

// --- writing it out ------------------------------------------------------------

const heightRows = [];
for (let j = 0; j < ROW; j++) {
  const line = [];
  for (let i = 0; i < ROW; i++) line.push(String(V[j * ROW + i]));
  heightRows.push("    " + line.join(",") + ",");
}

mkdirSync(out, { recursive: true });

writeFileSync(
  join(out, "heights.ts"),
  `/**
 * harrowmead/heights.ts — GENERATED by \`scripts/generate-harrowmead.mjs\`
 * (\`npm run harrowmead\`), and editable afterwards with the map editor's
 * terrain mode (F2, then T). Do not hand-edit: both the script and the editor
 * rewrite this file wholesale.
 *
 * The floor of the vale — one height per grid vertex, row-major from the -X/-Z
 * corner. A lazy \`import()\` (\`MapDef.heights\`), so it reaches a browser only
 * when this map is built.
 *
 * ${CELLS}x${CELLS} cells of ${CELL} m over the ${PLAY} m map, so ${ROW}x${ROW} vertices.
 * Keep any single-cell step under ${(MAX_GRADE * CELL).toFixed(2)} m or the nav graph stops
 * linking across it and whatever is beyond becomes an island; the generator
 * refuses anything over ${(MAX_GRADE * CELL * 0.9).toFixed(2)}.
 *
 * **The shape is four passes laid over one another IN ORDER** (see
 * \`heightAt\` in the generator): rolling ground and the named hills; every
 * district levelled toward its own height by a weighted average; the brook's
 * corridor levelled to the vale floor; and the channel and the millpond cut
 * last. The channel is cut to a constant ${BED} m bed (${POND.bed} in the millpond)
 * so the single water rect at ${WATER_Y} is wet along its whole run, and dry
 * ground is held at ${(BANK - 0.1).toFixed(2)} or over everywhere else so the same rect is
 * dry everywhere the brook is not. Every bank grades at ${((BANK - BED) / (LIP - BED_HW)).toFixed(2)} or
 * under, so the whole brook is wadeable and no ford is the only crossing.
 */
import type { Heightfield } from "../layout";

export const HarrowmeadHeights: Heightfield = {
  size: ${CELLS},
  cell: ${CELL},
  // Row-major, +Z per row.
  heights: [
${heightRows.join("\n")}
  ],
};

// Default too, because \`MapDef.heights\` is a lazy \`import()\` and a default
// is the one export name a generic signature can be written against.
export default HarrowmeadHeights;
`,
);

const vehicleLines = VEHICLES.map(
  (v) => `  { team: ${v.team}, pos: new Vector3(${n2(v.x)}, ${n2(floorAt(v.x, v.z))}, ${n2(v.z)}), yaw: ${v.yaw} },`,
);

const layoutHeader = readTemplate();
writeFileSync(
  join(out, "layout.ts"),
  layoutHeader
    .replace("%PLACEMENTS%", placements.join("\n"))
    .replace("%SCATTER%", scatter.join("\n") + BORDERLAND)
    .replace("%FLAGS%", NAMED.join("\n"))
    .replace("%SPAWNS%", spawns.join("\n"))
    .replace("%VEHICLES%", vehicleLines.join("\n"))
    .replace(
      "%WATER%",
      `  { x: ${n2(WATER.x)}, z: ${n2(WATER.z)}, width: ${n2(WATER.width)}, depth: ${n2(WATER.depth)}, y: ${n2(WATER.y)}, sound: "stream" },`,
    )
    .replace("%GRASS%", grass.join("\n"))
    .replace("%TUFTS%", String(Math.round(tufts / 100) * 100)),
);

const byKind = {};
for (const p of placed) byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
const refusedByKind = {};
for (const r of refused) {
  const k = r.split(" ")[0];
  refusedByKind[k] = (refusedByKind[k] ?? 0) + 1;
}
console.log("  placed:  " + JSON.stringify(byKind));
console.log("  refused: " + JSON.stringify(refusedByKind));
if (process.argv.includes("--refusals")) for (const r of refused) console.log("    " + r);
console.log(
  `harrowmead: ${PLAY} m square\n` +
    `  ${placed.length} placements, ${scatter.filter((l) => l.includes("{ prop:")).length} scatter regions (~${trees} trees in play), ${runs.filter((r) => r.placed).length} field runs\n` +
    `  ${ROW}x${ROW} height vertices, ground ${lo.toFixed(2)}..${hi.toFixed(2)} m\n` +
    `  water rect z ${wz0}..${wz1}, deepest ${deepest.toFixed(2)} m; grass ~${Math.round(tufts)} tufts\n` +
    `  steepest cell step ${worstStep.toFixed(2)} m (grade ${worstGrade.toFixed(3)}) at ${worstAt}\n` +
    `  wrote src/world/harrowmead/{layout,heights}.ts`,
);

// --- the layout file's prose ---------------------------------------------------

function readTemplate() {
  return `/**
 * harrowmead/layout.ts — THE MAP, as data: structure placements, scatter
 * regions, control points, spawns, the hardstandings, the water and the grass.
 * The floor's shape is generated data and lives in heights.ts. Consumed by
 * MapBuilder; nothing here is code to special-case.
 * Gotchas that have already cost time: collider top faces within
 * CONFIG.nav.stepHeight of adjacent ground or bots treat decks as walls; a
 * control point's pos must NOT sit inside a PLACEMENT's collider; scatter
 * knows nothing about water, so every grove below was checked dry by the
 * generator; terrain steeper than a 0.4 gradient severs its own nav links.
 *
 * **SEEDED by \`scripts/generate-harrowmead.mjs\`, and owned by the editor after
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
  VehicleSpawnDef,
  WaterRect,
} from "../layout";

/**
 * HARROWMEAD — a farming village in a broad green vale, high summer.
 *
 * **400 x 400 m**, origin at the market green, +Z is north. The ground
 * between flags is country rather than street: lanes, hedged fields and
 * rolling hills a hull can mean something on — and one does (see \`vehicles\`).
 *
 * \`\`\`
 *                              N
 *   +---------------------------------------------------------+
 *   | ~ knoll wood ~          north farm           x T1 HOME  |
 *   |  millpond                           [D] ORCHARD HILL    |
 *   | ~~~~\\  [A] THE MILL   mill lane      (104,100)  orchard |
 *   |     \\~~ (-91,60)        fordside  ~~~~~~~~ east ford ~~~|
 *   |    mill ford  ~~~~~ church  inn ~~~~~~~            ~~~~~ |
 *   |   Brookside       [C] THE MARKET GREEN   Eastfield       |
 *   |                  ===== Main Street =====                 |
 *   |  [B] THE GRANGE      south track      [E] THE KILN YARD |
 *   |    (-94,-94)         Southfield          (98,-62)        |
 *   | x T0 HOME                               ~ SE wood ~     |
 *   +---------------------------------------------------------+
 * \`\`\`
 *
 * ## A village, and why it reads as one
 *
 * The village grew where the valley road meets the brook's crossing, and it
 * is laid out the way one is: a GREEN with the well at its top and the market
 * on it, framed by four cobbled streets; the church and the coaching inn
 * across North Street from it, the church's tower to the brook and its
 * churchyard walled; terraces down West Lane and East Lane and along both
 * sides of Main Street, every one of them turned to its street; the smithy on
 * East Lane with its forge open to the green. Bridge Street runs north out of
 * the green to the WATERSPLASH — the lane fords the brook, and a footbridge
 * carries anybody on foot beside it — and on the north bank a few cottages
 * stand at the fork where the mill lane leaves the north road. Out of the
 * village the lanes run to the four other flags and to a farm between each
 * pair, and every one of them that meets the brook fords it.
 *
 * ## The vale, which is what the size buys
 *
 * The fog wall is gone (\`fogEnd\` 520 — see environment.ts) and
 * \`bots.perception.engageRange\` (55) did not move with it, so this layout is
 * built knowing the two disagree. What breaks the sightlines is GROUND and
 * FIELDS: the vale rolls a metre or two everywhere, the orchard hill stands
 * eight metres over the green, knolls stand in the fields between the flags,
 * and the brook runs a metre below its banks — so a 300 m lane is really a
 * chain of 50-70 m bounds between crests, and the field boundaries mark where
 * those bounds are, each with a line of hedgerow ash over it.
 *
 * ## Design intent per flag
 *
 * - **A The Mill** — the yard between the mill and the miller's house. The
 *   brook bends round it on the west and the south, so every approach but
 *   the mill lane from the east is a wade (or the mill ford, which is one).
 * - **B The Grange** — the big barn farm: one huge building with a loft to
 *   hold, the farmhouse across the yard, twin silos at the gate, ricks and
 *   paddocks behind.
 * - **C The Market Green** — the village: stalls round the flag, the well,
 *   and a ring of houses whose doors all open onto it. The buildings are the
 *   cover and every street is a lane of fire.
 * - **D Orchard Hill** — the high ground: a farm on the crown, a look-out on
 *   its east edge, and the orchard's rows down the slopes inside its walls.
 * - **E The Kiln Yard** — the brickworks: kilns, drying sheds and stacks of
 *   fuel, a close brawl in a map of long looks.
 *
 * ## Layout hygiene
 *
 * - Everything below is emitted by the generator, which REFUSES a building on
 *   a road, in the water, on a slope or with its door onto nothing, and a
 *   road in the water anywhere but a declared ford. Hand edits keep to those.
 * - Structures are axis-aligned (\`rotY\` in multiples of π/2). A builder's
 *   front is its local -Z: turn 0 faces south, π/2 west, π north, -π/2 east.
 * - Field walls and fences are cut at every lane, which is where the gates are.
 * - No lamps: the sun is still up, and a carried flame would spend one of the
 *   sixteen light slots proving nothing (Greyfen's rule).
 * - The ORDER of the scatter array is load-bearing: every region draws from
 *   one seeded stream, so a region added anywhere but the end re-rolls every
 *   field below it.
 */

/** Team 0's livery — harvest gold on the south-west gatehouse. */
const HARVEST = "#d8a53f";
/** Team 1's livery — drover oxblood on the north-east gatehouse. */
const DROVE = "#8c3f34";

const placements: Placement[] = [
%PLACEMENTS%
];

/**
 * Dressing. Every grove below was checked by the generator against the
 * finished floor — dry, clear of every building and yard, and under a grade a
 * tree stands on. A road rejects what grows by itself (\`world/roads.ts\`), and
 * blocking props are held off every flag and spawn by \`MapBuilder.keepClear\`.
 *
 * The vale has TWO trees and they divide the work. The pines are the planted
 * ones — the hilltop woods — and the ash is the farm's own: hedgerow standards
 * over the walls and fences, copses in the open fields, a line along the
 * brook, and, at half size, the orchard. Between them their trunks are the only
 * scatter cover that stops a round above knee height. The ferns are the
 * understory, non-blocking on purpose: ground the eye reads as a field
 * boundary that a body and a bullet both pass.
 */
const scatter: ScatterSpec[] = [
%SCATTER%
];

const controlPoints: ControlPointDef[] = [
%FLAGS%
];

/**
 * Home spawns are uncapturable. Every control point also carries a spawn just
 * outside its capture zone, so deploying onto a flag you hold does not drop
 * you on top of whoever is contesting it. The home yards face each other down
 * the NE-SW diagonal — the bearing the sun was set perpendicular to.
 */
const spawns: SpawnPointDef[] = [
%SPAWNS%
];

/**
 * One hardstanding a side, in the home yard beside the spawns, heading down
 * the same diagonal they face so the first thing a driver does is drive at the
 * map. The vale is what earns armour here: a 400 m map whose flags are 150 m
 * apart across open pasture is one where crossing the ground is the problem a
 * hull exists to answer, and the brook is wadeable its whole length, so a
 * hull crosses it anywhere and the fords are only the easy line.
 *
 * **Two, and exactly two.** The respawn is per hardstanding, so the number of
 * entries here IS how many tanks a side can ever have on the field at once —
 * and it is also what turns the kit's third slot on (\`Game.armourOffered\`).
 */
const vehicles: VehicleSpawnDef[] = [
%VEHICLES%
];

/**
 * The brook is cut in \`heights.ts\` to a constant bed, so this single rect is
 * wet along the whole run and dry everywhere the ground stands above it —
 * Greyfen's construction. The generator checks that every wet point inside it
 * is the brook's own channel or the millpond. The emitter is derived from
 * where the floor actually crosses the surface rather than from these four
 * numbers (\`MapBuilder.waterEmitters\`).
 */
const water: WaterRect[] = [
%WATER%
];

/**
 * Summer pasture — a budget rather than a blanket. The field is one mesh of
 * thin instances with no culling inside it, so the cost is the tuft COUNT
 * wherever the camera stands: these sum to ~%TUFTS% tufts (density x area),
 * against Greyfen's 16,900. Structures and roads clear themselves (the
 * GrassSystem's collider rejection, and a road refuses what grows).
 */
const grass: GrassRect[] = [
%GRASS%
];

export const HarrowmeadLayout: MapLayout = {
  placements,
  scatter,
  controlPoints,
  spawns,
  vehicles,
  water,
  grass,
  /**
   * \`terrain.size * terrain.cell\` equals it (100 x 4), the rim's boundary
   * boxes stay over 200 m (they are the BOUNDARY's extent plus 4, and the
   * boundary is this plus twice the borderland below — 1604), and the
   * heightfield grew with the square rather than getting coarser.
   */
  size: 400,
  // \`surfaces\` stays at the default 3: a farm stacks like a village (brook
  // bed, bank, hayloft), not like an office block.
  /**
   * Twice the default, and it is the borderland below that asks for it: the
   * floor is cut into patches of this, and with 600 m of pasture on every side
   * the default 48 would cut the ground into 193 meshes, two thirds of them
   * country nobody fights over, every one of them walked by the frame. At 96
   * it is 57, and the play floor's own share falls from 81 draws to 25.
   */
  terrainBlock: 96,
  /**
   * Four times the default, which is DRAW CALLS and nothing else: under a
   * 520 m fog the whole square is in view from anywhere in it, so a merge
   * block never leaves the frame for being far away and a fine grid buys the
   * cull nothing, while every block carries a draw per material. The village
   * and the fields put most of the kit's materials in most blocks, so the
   * count of blocks IS the draw count. Measured uncapped on the Windows box
   * with a body walking a circle from T0's yard: 48 m ran 122 fps on 588
   * active meshes, 134 m 202 on 360, and 200 m 244 on 301 — against 165 for
   * the hand-laid layout this replaced at 48. There is no see-through glass
   * on this map, so no probe drops its own block from a bake
   * (\`ReflectionSystem.encloses\`); this is the play square in 2 x 2.
   */
  blockSize: 200,
  /**
   * **No wall.** The vale is not closed by anything you can walk up to: the
   * fields carry on for six hundred metres past the play square and what
   * stops you is the leash, a countdown rather than a face of rock. See
   * \`Borderland\`, and \`world/leash.ts\` for the rule.
   *
   * **The margin is the HORIZON's and not the leash's.** The furthest a living
   * player gets is the play edge plus the leash's 69 m, and the far edge has
   * to be \`fogEnd\` (520) from there, so 520 + 69 rounded up; the cel fog is
   * linear, so a margin short of that draws a green line round the world.
   * Reduce it and the line comes back.
   *
   * \`roll\` is Sarab's — over 600 m of open country a metre of swing reads as
   * a table — and \`ease\` puts full amplitude back 40 m out, where a player
   * meets it, rather than a third of the margin out, which would flatten the
   * whole visible borderland into a smear of the map's own edge.
   */
  borderland: { margin: 600, roll: 3.2, ease: 40 },
  /**
   * **No rim at all.** The vale ends in more vale, and what closes the horizon
   * is the fog rather than a landform. \`Ridge.ts\` states the one condition on
   * taking \`form: "none"\`: a map may only draw nothing over its own boundary
   * if it has already laid something out there that reaches past \`fogEnd\` on
   * every bearing — which this map pays with the 600 m borderland above, so
   * the two fields are one decision. \`EnvironmentSpec.ridgeColor\` and
   * \`ridgeScreeColor\` are still set and read by nothing here.
   */
  ridge: {
    form: "none",
  },
  // Fixed so the dressing — and the colliders blocking scatter emits, and so
  // the nav graph — is identical on every boot. Changing it rerolls the whole
  // scatter field, which is a visible change to the level: re-walk the flags.
  seed: 0x48415257,
};
`;
}
