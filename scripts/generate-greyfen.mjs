/**
 * generate-greyfen.mjs — SEEDS Greyfen, the drowned jungle valley: writes
 * `src/world/greyfen/{layout,heights}.ts`.
 *
 * Run with `npm run greyfen`, and owe `npm run collision -- greyfen` and
 * `npm run parity` after it. Committed output, like every `heights.ts` and
 * every collision bake, and re-running it with the tree unchanged must produce
 * the same bytes.
 *
 * Flags for iterating on it: `--probe` prints the floor as a plan and writes
 * nothing, `--at x0,z0,x1,z1` prints it at a metre over one box and
 * `--point x,z` says what each pass made of one spot (both write nothing);
 * `--refusals` lists every plot that was refused and what refused it,
 * `--stands` how the forest's stands fitted and what refused the rest,
 * `--claims <file>` dumps the claims, the placements and the floor as JSON,
 * and `--dry` runs everything and writes nothing (and reports an unwalkable
 * floor as a warning rather than refusing).
 *
 * ## The light budget, which is the one this map can overspend
 *
 * Every lit fixture competes for `MAX_POINT_LIGHTS` (16) nearest-first with no
 * range cull, so each one on the map fills a slot EVERYWHERE until there are
 * sixteen, and every slot is paid per pixel. The first pass lit the new places
 * the way a village at night is lit — drive lamps, a drum at every yard,
 * wayside shrines, a kiln firing at the camp, a fire basket on each outpost's
 * look-out — and it cost 13-26% of the frame at every flag against the old
 * map's five lights (the manor's), measured and then taken back out one class
 * at a time. It is a MORNING: a lamp in daylight is a post. So what burns is
 * what the story needs burning — the manor's lanterns and hearths, the camp's
 * drum and its look-out's fire basket, one charcoal kiln at the sawmill and
 * the boathouse's lantern — ten, and a new one owes that measurement again.
 *
 * ## Why it is seeded now, when it was typed
 *
 * Greyfen was forked from Hollowmere's village, cleared back to a blank valley
 * and grown again in the editor a placement at a time: a manor, a temple, a
 * dozen stilt huts, and fourteen hundred trees over a floor that was flat but
 * for the river. The forest was right — dense, dark, a trunk every few metres
 * — and it was ALL there was. Between the five flags the valley was one
 * texture: trees, the odd ruin, a hut, trees. Nothing to find, nothing to
 * steer by, and nothing that made one stretch of forest a different place to
 * fight in from the next.
 *
 * So the forest stays and the valley gets its PLACES back, each one a thing a
 * river valley with a plantation in it would actually have, and each one a
 * different fight:
 *
 * - **The Landing** where the three arms meet — a boathouse, a slipped river
 *   boat, a market on the bank and the causeway over the marsh bar.
 * - **The manor's grounds** — a walled garden, the drive, the overseer's house
 *   and the kitchen yard.
 * - **The Stilt Village** on its lagoon, its walks a storey up.
 * - **The Ferry** on the west arm, with the mission and its burial ground.
 * - **The Sawmill** on the west road: kilns, cordwood, the sawyer's house.
 * - **The Old City** in a hollow south of the spine: broken courts of mossy
 *   stone, steles and boulders — older than everything else in the valley.
 * - **The Temple** on the one real hill, a processional way climbing to it
 *   past a stele avenue, and a broken precinct wall round the summit.
 * - **The Camp** in the deepest forest: sandbag lines, a look-out, stores.
 * - Each side's **outpost** at its home spawn.
 *
 * The DESIGN is authored here and the TRANSCRIPTION is mechanical and CHECKED:
 *
 * - **Nothing stands in the water**, sampled on the floor the game draws,
 *   except what is built to (a jetty, the boathouse's water doors, a bridge).
 * - **Nothing stands on a road** — the network's own footprint, imported from
 *   `src/world/roadPaths.ts`, so the test is the one the game makes.
 * - **Nothing is built on a slope** beyond what its plinth or its piles take.
 * - **Every door opens onto somewhere**: a track, a yard or a flag's clearing.
 * - **No road runs into the water.** The river is waded, or crossed by the
 *   causeway, the trestle and two footbridges.
 * - **The forest is sown against the finished floor and the finished claims**:
 *   a stand is a disc checked dry and clear of every building and yard, and a
 *   road cuts its own avenue through it (`PropBody.rooted`).
 *
 * ## The floor, which the map never had
 *
 * It was 4,906 vertices of exactly zero and a river. Now: a flood plain along
 * the three arms held low by the water's cone, the TEMPLE'S HILL rising four
 * and a half metres in the north-east, the SPINE — a wooded ridge between the
 * manor's garden and the southern forest, which is what stops C and E seeing
 * each other — the OLD CITY sunk in a hollow under it, the LAGOON behind the
 * stilt village, and a low rise under each home. Every district that has to be
 * level is levelled toward its own height by a weighted average, then the
 * water's cone, then the channels and the pools are cut to one bed.
 *
 * **Zero is the MIST's datum** (`mistHeight` is an absolute falloff): the flood
 * plain, the ferry and the old city's hollow sit at or under it and drown in
 * it, the manor stands a metre over it on its terrace, and the temple stands
 * clear of it on the hill.
 *
 * **The Y's three mouths are where they always were** — the north arm through
 * the north edge at x 27..42, the west through the west edge at z -93..-78, the
 * east through the east edge at z -45..-33 — because the borderland block
 * (appended verbatim at the end of the scatter array) was measured against
 * them, and `borderland.roll` is bounded by how deep they are (see the layout's
 * own note). The beds are cut to -1.34 as they were.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { roadNetwork } from "../src/world/roadPaths.ts";
import { onRoad } from "../src/world/roads.ts";
import { DOORS, FOOT, FRONTS, stairRun } from "./lib/footprints.mjs";
import {
  bell,
  bracketKind,
  cutRun,
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
  makePathRoad,
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
  segDist,
  smin,
  smooth,
  tally,
  TURN,
  turnOf,
  vnoise,
} from "./lib/mapgen.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = join(root, "src", "world", "greyfen");

// --- the extent --------------------------------------------------------------

const PLAY = 240;
const CELL = 3;
const CELLS = PLAY / CELL;
const HALF = PLAY / 2;
const MAX_GRADE = 0.4;
/** How far the floor may fall across a building's footprint before the plot is refused. */
const FLAT = 0.35;

// --- the seeded stream -------------------------------------------------------

const { rng, rand, chance, pick } = seeded(0x47524659);

// --- the floor ---------------------------------------------------------------

/**
 * The relief. A hill is a raised cosine and a ridge is one drawn along a
 * segment; peak over radius times π/2 is the steepest either makes — the
 * temple's 4.4 over 46 is 0.15, the spine's 2.6 over 15 is 0.27.
 */
const HILLS = [
  // The temple's hill — flag D's, and the one real height in the valley.
  { x: 84, z: 38, peak: 2.3, r: 56 },
  // The rises the two homes stand on.
  { x: -98, z: 100, peak: 1.2, r: 28 },
  { x: 98, z: -100, peak: 1.2, r: 28 },
  // The old city's hollow, sunk under the spine.
  { x: -44, z: -84, peak: -1.1, r: 28 },
  // The wooded hump between the lagoon and the north arm.
  { x: -14, z: 98, peak: 1.8, r: 22 },
  // The north-east woods, the temple's back country.
  { x: 96, z: 90, peak: 1.6, r: 26 },
  // The west bank's slope, the sawmill's.
  { x: -114, z: 22, peak: 1.1, r: 24 },
  // The camp's knoll, the look-out's.
  { x: 70, z: -66, peak: 2.2, r: 16 },
];
const RIDGES = [
  // THE SPINE: between the manor's garden and the southern forest. It is what
  // makes C and E two fights rather than one long lane.
  { a: [-70, -52], b: [-26, -56], peak: 2.6, r: 15 },
  { a: [14, -58], b: [34, -58], peak: 1.8, r: 12 },
];

/** The valley before anything is levelled or cut. */
function natural(x, z) {
  let h = 0.55 + 0.35 * vnoise(x, z, 56, 41) + 0.18 * vnoise(x, z, 24, 42) + 0.05 * vnoise(x, z, 10, 43);
  for (const k of HILLS) h += k.peak * bell(Math.hypot(x - k.x, z - k.z), k.r);
  for (const k of RIDGES) h += k.peak * bell(segDist(x, z, k.a[0], k.a[1], k.b[0], k.b[1]), k.r);
  return h;
}

// --- the water ---------------------------------------------------------------

/** The water's surface (the one rect's `y`), and the bed every channel is cut to. */
const WATER_Y = -0.52;
const BED = -1.34;
/** The marsh bar up the confluence, under 0.16 m of standing water. */
const BAR_Y = -0.68;
/** The lowest DRY ground: the flood plain at the water's lip. */
const BANK = -0.1;
/** Flat bed half-width, and where the bank reaches the flood plain. */
const BED_HW = 3;
const LIP = 9;
/** How steeply the ground may rise once it is clear of the water's lip. */
const VALE_GRADE = 0.12;

/**
 * The three arms of the Y, as Catmull-Rom control points, each run on past the
 * square so the channel meets the edge square to it (the floor past the grid is
 * the clamped edge row, and a channel crossing the edge at an angle would
 * extrude as a skewed trench).
 */
const ARM_PTS = {
  north: [[34, 200], [34, 121], [33, 104], [29, 86], [22, 70], [14, 56], [9, 46]],
  west: [[4, 32], [-8, 24], [-26, 19], [-44, 12], [-58, 2], [-66, -14], [-71, -32], [-78, -54], [-90, -72], [-106, -83], [-121, -86], [-200, -86]],
  east: [[13, 31], [26, 22], [40, 8], [53, -10], [67, -27], [84, -36], [102, -39], [121, -39], [200, -39]],
};

function spline(pts) {
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
}
const ARMS = Object.fromEntries(Object.entries(ARM_PTS).map(([k, v]) => [k, spline(v)]));
const RIVER = [...ARMS.north, ...ARMS.west, ...ARMS.east];

/** Distance to the nearest arm's centreline (the samples are 0.5 m apart). */
function riverDist(x, z) {
  let best = Infinity;
  for (const [bx, bz] of RIVER) {
    const dz = bz - z;
    if (dz > best || -dz > best) continue;
    const d = Math.hypot(bx - x, dz);
    if (d < best) best = d;
  }
  return best;
}

/** Where an arm's centreline crosses a line of constant z (the sample nearest it). */
function armX(arm, z) {
  let best = null;
  let bd = Infinity;
  for (const [bx, bz] of ARMS[arm]) {
    const d = Math.abs(bz - z);
    if (d < bd) {
      bd = d;
      best = bx;
    }
  }
  return best;
}
/** …and a line of constant x. */
function armZ(arm, x) {
  let best = null;
  let bd = Infinity;
  for (const [bx, bz] of ARMS[arm]) {
    const d = Math.abs(bx - x);
    if (d < bd) {
      bd = d;
      best = bz;
    }
  }
  return best;
}

/**
 * The pools, as ellipses cut to the bed with a bank `skirt` wide. The BASIN is
 * the confluence the three arms meet in; the LAGOON is the backwater the stilt
 * village stands over.
 */
const BASIN = { x: 7, z: 37, rx: 11, rz: 14, skirt: 7, hold: 2 };
const LAGOON = { x: -58, z: 106, seg: [[-73, 106], [-43, 106]], r: 4.5, skirt: 5.5, hold: 0 };
const POOLS = [BASIN, LAGOON];
/** The marsh bar: where the basin's bed is raised under the causeway. */
const BAR = { x0: -5, x1: 5, z0: 21, z1: 52 };

/**
 * How far outside a pool a point is (negative inside). The basin is near enough
 * round that scaling an ellipse by its short radius is a distance; the lagoon is
 * long and narrow, so it is a CAPSULE — a segment and a radius — where the same
 * scaling would stretch its bank four times over down its length.
 */
function poolDist(p, x, z) {
  if (p.seg) return segDist(x, z, p.seg[0][0], p.seg[0][1], p.seg[1][0], p.seg[1][1]) - p.r;
  const e = Math.hypot((x - p.x) / p.rx, (z - p.z) / p.rz);
  return (e - 1) * Math.min(p.rx, p.rz);
}

// --- the places that have to be level -----------------------------------------

/**
 * `level` is what the ground reads inside the core and `skirt` how far it takes
 * to get back to the valley; `null` is the district's own natural height at its
 * centre, rounded — a camp stands where it stands.
 */
const DISTRICTS = [
  // C — the manor's terrace and the walled garden below its front.
  { name: "manor terrace", x0: -22, x1: 20, z0: -26, z1: 8, level: 0.8, skirt: 12, weight: 2, hard: 7 },
  { name: "garden", x0: -26, x1: 26, z0: -50, z1: -26, level: 0.7, skirt: 10 },
  { name: "kitchen yard", x0: -46, x1: -22, z0: -24, z1: 2, level: 0.6, skirt: 8 },
  // The overseer's terrace, cut into the spine's north flank over the ferry track.
  { name: "overseer", x0: -54, x1: -38, z0: -56, z1: -42, level: 1.2, skirt: 8 },
  // A — the stilt village, on the lagoon's south shore.
  { name: "stilt village", x0: -92, x1: -30, z0: 58, z1: 95, level: 0.55, skirt: 10, weight: 1.5 },
  // B — the ferry's bank, and the mission above it.
  { name: "ferry", x0: -118, x1: -86, z0: -46, z1: -8, level: 0.3, skirt: 8 },
  { name: "mission", x0: -118, x1: -98, z0: -66, z1: -48, level: 0.5, skirt: 8 },
  { name: "burial ground", x0: -118, x1: -106, z0: -6, z1: 10, level: null, skirt: 8 },
  // The Landing, on the north bank over the confluence.
  { name: "landing", x0: -16, x1: 12, z0: 57, z1: 76, level: 0.4, skirt: 8 },
  // D — the temple's summit, cut level for the platform and its court.
  { name: "temple summit", x0: 66, x1: 94, z0: 22, z1: 48, level: null, skirt: 18 },
  // E — the camp.
  { name: "camp", x0: 20, x1: 60, z0: -102, z1: -66, level: null, skirt: 12 },
  // The sawmill on the west road.
  { name: "sawmill", x0: -120, x1: -96, z0: 26, z1: 58, level: null, skirt: 10 },
  // The two outposts.
  { name: "valeguard", x0: -118, x1: -88, z0: 88, z1: 116, level: null, skirt: 12 },
  { name: "redline", x0: 88, x1: 118, z0: -116, z1: -86, level: null, skirt: 12 },
];
for (const d of DISTRICTS) {
  if (d.level === null) d.level = Math.round(natural((d.x0 + d.x1) / 2, (d.z0 + d.z1) / 2) * 4) / 4;
}

/** How far a point is from the edge of the ground the water holds low. */
function waterReach(x, z) {
  let r = riverDist(x, z) - (LIP + 3);
  for (const p of POOLS) r = Math.min(r, Math.max(0, poolDist(p, x, z)) - (p.skirt + p.hold));
  return r;
}

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
  // The cone rises gently off the lip and faster once it is clear of the flood
  // plain, so it holds the banks low without planing the temple's hill away.
  const reach = Math.max(0, waterReach(x, z));
  const cone = BANK + VALE_GRADE * reach + 0.24 * Math.max(0, reach - 8);
  h = smin(h, cone, 1.2);
  // A HARD district is levelled again after the cone, over a skirt of its own:
  // the manor stands on its terrace even where the water's cone would have
  // taken the corner of it down to the bank.
  for (const d of DISTRICTS) {
    if (!d.hard) continue;
    const w = 1 - smooth(rectDist(x, z, d) / d.hard);
    if (w > 0) h += (d.level - h) * w;
  }
  return Math.max(h, BANK - 0.05);
}

function heightAt(x, z) {
  let h = land(x, z);
  const rd = riverDist(x, z);
  if (rd < LIP) {
    const w = rd <= BED_HW ? 1 : 1 - (rd - BED_HW) / (LIP - BED_HW);
    h = Math.min(h, h + (BED - h) * w);
  }
  for (const p of POOLS) {
    const pd = poolDist(p, x, z);
    if (pd < p.skirt) {
      const w = pd <= 0 ? 1 : 1 - pd / p.skirt;
      h = Math.min(h, h + (BED - h) * w);
    }
  }
  // The marsh bar: the basin's bed raised to a shelf under the causeway, eased
  // back down over a cell at its edges.
  const bd = rectDist(x, z, BAR);
  if (bd < 4) h = Math.max(h, BAR_Y - (bd / 4) * (BAR_Y - BED));
  return h;
}

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

const wet = (x, z, margin = 0.2) => floorAt(x, z) < WATER_Y + margin;

// `--point x,z`: what each pass made of one spot — for a plot the slope check refuses.
if (process.argv.includes("--point")) {
  const [x, z] = process.argv[process.argv.indexOf("--point") + 1].split(",").map(Number);
  console.log(
    `river ${riverDist(x, z).toFixed(2)} m, reach ${waterReach(x, z).toFixed(2)}, natural ${natural(x, z).toFixed(2)}, ` +
      `land ${land(x, z).toFixed(2)}, floor ${floorAt(x, z).toFixed(2)}, grade ${grade(x, z).toFixed(3)}`,
  );
  process.exit(0);
}
// `--at x0,z0,x1,z1`: the floor over a box at one metre, north at the top.
if (process.argv.includes("--at")) {
  const [x0, z0, x1, z1] = process.argv[process.argv.indexOf("--at") + 1].split(",").map(Number);
  for (let z = z1; z >= z0; z -= 1) {
    let l = String(z).padStart(5);
    for (let x = x0; x <= x1; x += 1) l += floorAt(x, z).toFixed(2).padStart(6);
    console.log(l);
  }
  process.exit(0);
}
if (process.argv.includes("--probe")) {
  printProbe({ half: HALF, step: 6, height: floorAt, grade, wet });
  process.exit(0);
}

// --- the output, and the placement vocabulary --------------------------------

const n3 = (v) => {
  const r = Number(v.toFixed(3));
  return Object.is(r, -0) ? "0" : String(r);
};

/** Small things a yard or a flag's clearing may hold. */
const PROPS = new Set(["cart", "crates", "woodpile", "stall", "well", "shrine", "lamp", "fishRack", "sandbags", "careenedHull"]);

const worldFoot = makeWorldFoot(FOOT);

const placements = [];
const scatter = [];
const placed = [];
const regions = [];

const note = (list, ...lines) => list.push(...lines.map((l) => `  // ${l}`));

function paramText(params) {
  if (!params) return "";
  return Object.entries(params)
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}: [${v.map((q) => `[${q.map(n2).join(", ")}]`).join(", ")}]`;
      const lit = typeof v === "string" ? `"${v}"` : typeof v === "boolean" ? String(v) : n3(v);
      return `${k}: ${lit}`;
    })
    .join(", ");
}

function emit(kind, x, z, turn, params, y) {
  const ps = paramText(params);
  const yy = y !== undefined ? `, y: ${n3(y)}` : "";
  placements.push(
    `  { kind: "${kind}", x: ${n3(x)}, z: ${n3(z)}${yy}${TURN[turn]}` + (ps ? `, params: { ${ps} }` : "") + " },",
  );
  placed.push({ kind, x, z, y, rotY: [0, Math.PI / 2, Math.PI, -Math.PI / 2][turn], params: params ?? {}, turn });
}

// --- the flags ---------------------------------------------------------------

/**
 * The five flags keep the positions the valley has always had them at — the
 * ring's balance lives in those distances — and gain the names of the places
 * that now stand at them.
 */
const TEMPLE = { x: 80, z: 34 };
const FLAGS = [
  { id: "A", name: "The Stilt Village", x: -60, z: 76, r: 14 },
  { id: "B", name: "The Ferry", x: -97, z: -28, r: 13 },
  // In the manor's great hall; the pole is lifted through the gallery.
  { id: "C", name: "The Manor", x: 0, z: -4, r: 14, poleLift: 6, inside: true },
  // On the temple's summit: `pos.y` is the summit's tread, 1.35 over its foot.
  { id: "D", name: "The Temple", x: TEMPLE.x, z: TEMPLE.z, r: 13, inside: true },
  { id: "E", name: "The Camp", x: 40, z: -84, r: 12 },
];
const byId = Object.fromEntries(FLAGS.map((f) => [f.id, f]));

// --- the roads, first, because everything else dodges them -------------------

section(placements, "tracks");
note(
  placements,
  "Visual only: a track carries no collider, stops no round and is in no",
  "baked structure. Every track is DIRT but the temple's processional way,",
  "which is the one paved road in the valley and was laid before any of the",
  "rest. Each is a PATH, so where two meet the network paves the junction.",
);

const roadDefs = [];
const layPathRoad = makePathRoad(roadDefs, emit);
function pathRoad(text, points, w, surface, radius) {
  if (text) placements.push(`  // ${text}`);
  layPathRoad(points, w, surface, radius);
}

/**
 * The crossings, derived from the river rather than typed: each is laid
 * square across its arm where the arm crosses the line the track wants.
 */
const TRESTLE_Z = 12;
const TRESTLE_X = Number(armX("east", TRESTLE_Z).toFixed(1));
const TRESTLE_SPAN = 26;
const TRESTLE_REACH = TRESTLE_SPAN / 2 + 6.9;
const NBRIDGE_Z = 98;
const NBRIDGE_X = Number(armX("north", NBRIDGE_Z).toFixed(1));
const EBRIDGE_X = 96;
const EBRIDGE_Z = Number(armZ("east", EBRIDGE_X).toFixed(1));
const FOOT_LEN = 2 * (LIP + 1);

// Junctions.
const XROADS = [0, -54]; // below the garden gate, on the spine's saddle
const VG_FORK = [-94, 68]; // where the north road meets the village track
const OLD_FORK = [-24, -46]; // where the old city path leaves the ferry track

pathRoad("The manor drive, from the portico down through the garden gate to the crossroads on the spine.", [[0, -23.6], [0, -40], XROADS], 5, "dirt");
pathRoad("The camp track, over the saddle and down into the camp.", [XROADS, [8, -62], [18, -68], [30, -72]], 4.5, "dirt", 12);
pathRoad("The ferry track, west along the spine's north flank to the east landing.", [XROADS, [-14, -50], OLD_FORK, [-38, -38], [-48, -32], [-57, -25]], 4.5, "dirt", 14);
pathRoad("The old city path, off the ferry track over the spine and down into the hollow.", [OLD_FORK, [-28, -58], [-38, -70], [-44, -79]], 3.5, "dirt", 10);
pathRoad("…and out of it east along the foot of the spine to the camp.", [[-44, -79], [-28, -88], [-8, -90], [12, -88], [26, -85]], 3.5, "dirt", 12);
pathRoad(
  "The north road: in off the north edge, round the Valeguard outpost and down to the village fork.",
  [[-118, 190], [-118, 104], [-110, 84], VG_FORK],
  5,
  "dirt",
  18,
);
pathRoad("The west road, south from the fork past the sawmill to the ferry.", [VG_FORK, [-104, 52], [-106, 30], [-102, 8], [-99, -12]], 5, "dirt", 18);
pathRoad("The village track, east along the stilt village's clearing to the Landing.", [VG_FORK, [-78, 62], [-60, 61], [-42, 63], [-26, 63], [-10, 64]], 4.5, "dirt", 14);
pathRoad(
  "The bridge track, out of the Landing to the north footbridge.",
  [[-4, 70], [-2, 82], [6, 94], [NBRIDGE_X - FOOT_LEN / 2 - 1, NBRIDGE_Z]],
  3.5,
  "dirt",
  8,
);
pathRoad(
  "The temple's back road, off the north footbridge and up the hill to the precinct's north gate.",
  [[NBRIDGE_X + FOOT_LEN / 2 + 1, NBRIDGE_Z], [52, 90], [62, 74], [76, 58]],
  3.5,
  "dirt",
  12,
);
pathRoad(
  "The processional way — the one paved road in the valley — from the trestle's east foot up to the temple's causeway.",
  [[TRESTLE_X + TRESTLE_REACH + 0.5, TRESTLE_Z], [64, 13], [TEMPLE.x, 13.5]],
  5,
  "cobble",
  10,
);
const RL_FORK = [94, -68]; // the north road's mirror
pathRoad(
  "The south road: in off the south edge, round the Redline outpost and up to the fork — the north road's mirror.",
  [[118, -190], [118, -104], [110, -84], RL_FORK],
  5,
  "dirt",
  18,
);
pathRoad("The camp road, west from the fork down into the camp.", [RL_FORK, [80, -74], [66, -80], [53, -78]], 4.5, "dirt", 14);
pathRoad(
  "The river track, north from the fork to the east footbridge and on up to the processional way.",
  [RL_FORK, [EBRIDGE_X, EBRIDGE_Z - FOOT_LEN / 2 - 1]],
  3.5,
  "dirt",
  12,
);
pathRoad(null, [[EBRIDGE_X, EBRIDGE_Z + FOOT_LEN / 2 + 1], [96, -14], [90, 2], [72, 13.4]], 3.5, "dirt", 12);
pathRoad(
  "The manor's service track, from the kitchen yard round to the north lawn and the trestle.",
  [[-30, -12], [-26, 6], [-18, 10.8], [4, 10.8], [TRESTLE_X - TRESTLE_REACH - 0.5, TRESTLE_Z]],
  3.5,
  "dirt",
  8,
);

const network = roadNetwork(roadDefs);
const ROADS = network.footprint;
const onRoadAt = (x, z, pad = 0) => onRoad(ROADS, x, z, pad);

for (let x = -HALF; x <= HALF; x += 1) {
  for (let z = -HALF; z <= HALF; z += 1) {
    if (onRoadAt(x, z) && wet(x, z, 0)) throw new Error(`road: a carriageway runs into the water at (${x}, ${z})`);
  }
}

// --- claims ------------------------------------------------------------------

/**
 * Everything that has claimed ground: `solid` a building or a prop, `low` a
 * spawn (refuses everything), `flag` a flag's clearing, and `open` a yard — which
 * refuses a building and nothing else, and is what a door may open onto.
 */
const claimed = [];
const refused = [];
const open = [];

const overlaps = makeOverlaps(claimed);
const claim = makeClaim(claimed);
/** A yard. A WOODED one (the camp, the old city's court) is a yard the forest still stands in. */
function yard(x0, x1, z0, z1, text, wooded = false) {
  const r = { x0, x1, z0, z1 };
  open.push(r);
  claimed.push({ ...r, type: "open", note: text, wooded });
}

/** How far the floor falls across a footprint, from its centre's own height. */
const relief = makeRelief(floorAt);
const footOnRoad = makeFootOnRoad(onRoadAt);
const footWet = makeFootWet(wet, 0.3);
const inOpen = (x, z) => open.some((o) => x >= o.x0 && x <= o.x1 && z >= o.z0 && z <= o.z1);
const inClearing = (x, z) => FLAGS.some((f) => !f.inside && Math.hypot(x - f.x, z - f.z) < f.r);

function doorway(kind, x, z, turn, params, self, reach = 14) {
  const [, , z0] = FOOT[kind](params ?? {});
  const [fx, fz] = turnOf(0, -1, turn);
  const [sx, sz] = turnOf(0, z0, turn);
  for (let t = 0.3; t <= reach; t += 0.5) {
    const px = x + sx + fx * t;
    const pz = z + sz + fz * t;
    if (onRoadAt(px, pz) || inOpen(px, pz) || inClearing(px, pz)) return null;
    const hit = claimed.find((c) => c !== self && c.type === "solid" && px >= c.x0 && px <= c.x1 && pz >= c.z0 && pz <= c.z1);
    if (hit) return `door blocked by ${hit.note || "a claim"} at (${px.toFixed(0)}, ${pz.toFixed(0)})`;
    if (wet(px, pz, 0)) return `door opens onto the water at (${px.toFixed(0)}, ${pz.toFixed(0)})`;
  }
  return "door opens onto nothing";
}
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
    if (Math.max(Math.abs(r.x0), Math.abs(r.x1), Math.abs(r.z0), Math.abs(r.z1)) > HALF - 2) return "the edge";
    if (!opts.force) {
      const prop = PROPS.has(kind);
      const hit = overlaps(r, pad, opts.skip ?? ((c) => (c.type === "open" && !DOORS.has(kind)) || (c.type === "flag" && prop)));
      if (prop && FLAGS.some((f) => !f.inside && f.x > r.x0 - 3 && f.x < r.x1 + 3 && f.z > r.z0 - 3 && f.z < r.z1 + 3)) return "a flag's own ground";
      if (hit) return `a ${hit.type} claim (${hit.note || "?"}) x ${hit.x0.toFixed(1)}..${hit.x1.toFixed(1)} z ${hit.z0.toFixed(1)}..${hit.z1.toFixed(1)}`;
      if (!opts.roadOk && footOnRoad(r)) return "a road";
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
  const check = opts.noDoor || opts.force ? null : DOORS.has(kind) ? doorway : FRONTS.has(kind) ? frontClear : null;
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

/** A lamp on the kerb, its arm (the builder's local +X) out over the track. */
function lamp(x, z, toward, text) {
  const turn = { east: 0, south: 1, west: 2, north: 3 }[toward];
  return place("lamp", x, z, turn, null, { pad: 0.3, roadOk: true, note: text ?? "a lamp" });
}

/** The turn whose front looks most squarely at a point. */
function facing(x, z, tx, tz) {
  const dx = tx - x;
  const dz = tz - z;
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? FACES.east : FACES.west;
  return dz > 0 ? FACES.north : FACES.south;
}

// The flags' clearings: nothing solid on a flag's own ground.
for (const f of FLAGS) {
  if (f.inside) continue;
  const k = f.r * 0.45;
  claim({ x0: f.x - k, x1: f.x + k, z0: f.z - k, z1: f.z + k }, "flag", `flag ${f.id}`);
}

// --- the spawns --------------------------------------------------------------

const HOMES = [
  { team: 0, xs: [-100, -94, -106], z: 96, yaw: "Math.PI" },
  { team: 1, xs: [100, 106, 94], z: -96, yaw: "0" },
];
const spawns = [];
for (const h of HOMES) {
  for (const x of h.xs) {
    if (onRoadAt(x, h.z, 2.6)) throw new Error(`spawn: T${h.team}'s home spawn at (${x}, ${h.z}) is on the road`);
    claim({ x0: x - 2.5, x1: x + 2.5, z0: h.z - 2.5, z1: h.z + 2.5 }, "low", "a home spawn");
    spawns.push(`  { team: ${h.team}, pos: new Vector3(${n2(x)}, ${n2(floorAt(x, h.z))}, ${n2(h.z)}), yaw: ${h.yaw} },`);
  }
}
/** One spawn per objective, outside its ring, on open ground. */
const FLAG_SPAWNS = [
  ["A", 0, -16, "Math.PI"],
  ["B", 13, 6, "Math.PI / 2"],
  ["C", -8, -23, "0"],
  ["D", 0, -21.5, "0"],
  ["E", -14, 12, "Math.PI / 2"],
];
for (const [id, dx, dz, yaw] of FLAG_SPAWNS) {
  const f = byId[id];
  const x = f.x + dx;
  const z = f.z + dz;
  claim({ x0: x - 2.5, x1: x + 2.5, z0: z - 2.5, z1: z + 2.5 }, "low", `${id}'s spawn`);
  if (wet(x, z)) throw new Error(`spawn: ${id}'s spawn at (${x}, ${z}) is in the water`);
  if (Math.hypot(dx, dz) <= f.r + 1) throw new Error(`spawn: ${id}'s spawn is inside its own ring`);
  if (onRoadAt(x, z, 2.6)) console.log(`  note: ${id}'s spawn stands on a track`);
  spawns.push(`  { team: null, controlPoint: "${id}", pos: new Vector3(${n2(x)}, ${n2(floorAt(x, z))}, ${n2(z)}), yaw: ${yaw} },`);
}

// --- the yards ---------------------------------------------------------------

yard(-12, 12, -52, -30, "the garden", true);
yard(-44, -24, -22, 0, "the kitchen yard", true);
yard(-14, 10, 58, 72, "the Landing");
yard(-116, -86, -44, -12, "the ferry yard", true);
yard(-64, -52, -30, -18, "the east landing");
yard(-107.5, -96, 30, 54, "the sawmill yard");
yard(-53, -35, -90, -71, "the old city's court", true);
yard(22, 58, -98, -70, "the camp", true);
yard(64, 96, 50, 60, "the temple's north court");
yard(-114, -86, 88, 104, "the Valeguard outpost");
yard(88, 116, -104, -88, "the Redline outpost");

// --- C — the manor -----------------------------------------------------------

section(placements, "C: The Manor");
note(
  placements,
  "The plantation house on its terrace at the confluence, front to the south:",
  "the flag in its great hall, the gallery a storey up, and a lawn running down",
  "its north side to the causeway over the marsh. Its garden is walled below",
  "the portico, the drive running down through it to the crossroads on the",
  "spine; the kitchen yard stands off its west flank, and the overseer's house",
  "on a terrace cut into the spine over the ferry track.",
);
must("manor", 0, -4, 0, { litWindows: true }, { note: "the manor", noDoor: true, skip: (c) => c.type === "flag" || c.type === "open" });
{
  // The trestle — the manor's way east over the east arm, and the start of the
  // processional way. Local zero is BANK grade: `y` is minus the bed depth.
  const bank = Math.min(floorAt(TRESTLE_X - TRESTLE_REACH, TRESTLE_Z), floorAt(TRESTLE_X + TRESTLE_REACH, TRESTLE_Z));
  const y = bank - floorAt(TRESTLE_X, TRESTLE_Z);
  must("trestleBridge", TRESTLE_X, TRESTLE_Z, 1, null, { force: true, y, note: "the trestle" });
  claim(worldFoot("trestleBridge", TRESTLE_X, TRESTLE_Z, 1, {}), "solid", "the trestle");
}
// The garden: a well for a fountain, the gardener's sheds against the walls,
// and a cart left on the drive's verge.
place("well", -8, -41, 0, null, { note: "the garden well" });
place("shed", -20, -36, 3, { width: 4.4, depth: 3 }, { note: "the gardener's shed" });
place("shed", 21, -45, 1, { width: 4.4, depth: 3 }, { note: "the potting shed" });
place("cart", 4.5, -44, 1, null, { note: "a cart on the drive" });
// The kitchen yard and the overseer's house on the manor's west flank.
place("jungleRuin", -46, -49.5, 2, { width: 11, depth: 8 }, { note: "the overseer's house", flat: 0.6 });
place("shed", -40, -4, 3, { width: 5, depth: 3.2 }, { note: "the kitchen store" });
place("woodpile", -26, -20, 1, { length: 4 });
place("crates", -40, -24, 0, null);
// The stable yard on the east flank, over the east arm.
place("shed", 18, -30, 1, { width: 6, depth: 3.4 }, { note: "the carriage shed" });
place("cart", 26, -30, 0, { ruined: true }, { note: "a cart" });

// --- the causeway and the Landing ------------------------------------------------

section(placements, "The Landing");
note(
  placements,
  "Where the three arms meet. The causeway runs up the marsh bar from the",
  "manor's lawn to the north bank, two fishermen's huts on piles beside it;",
  "on the bank the Landing — the boathouse on the north arm, a river boat",
  "slipped on the shore, the market stalls and the company's store.",
);
{
  // The causeway: deck ABSOLUTE at CAUSE_DECK, laid as abutting lengths each
  // sampling its own ground, with a stair at either end.
  const CAUSE_DECK = 0.85;
  let z0 = null;
  let z1 = null;
  for (let z = 0; z < 70; z += 0.25) {
    if (floorAt(0, z) < WATER_Y + 0.25) {
      if (z0 === null) z0 = z;
      z1 = z;
    }
  }
  z0 -= 1;
  z1 += 1;
  const pieces = Math.ceil((z1 - z0) / 12.5);
  const each = (z1 - z0) / pieces;
  for (let k = 0; k < pieces; k++) {
    const cz = z0 + each * (k + 0.5);
    const y = CAUSE_DECK - 0.5 - floorAt(0, cz);
    must("boardwalk", 0, cz, 0, { length: Number(each.toFixed(3)), railSide: "none" }, { force: true, y, note: "the causeway" });
    claim(worldFoot("boardwalk", 0, cz, 0, { length: each }), "solid", "the causeway");
  }
  // The stairs: each foot on dry ground, each head butted against the deck end.
  for (const [end, dir] of [[z0, -1], [z1, 1]]) {
    let foot = end + dir * 2;
    let h = CAUSE_DECK - floorAt(0, foot);
    for (let i = 0; i < 6; i++) {
      foot = end + dir * stairRun(h);
      h = CAUSE_DECK - floorAt(0, foot);
    }
    const run = stairRun(h);
    const cz = end + dir * (run / 2);
    const y = floorAt(0, end + dir * run) - floorAt(0, cz);
    must("stairs", 0, cz, dir < 0 ? 0 : 2, { height: Number(h.toFixed(3)), railSide: "none" }, { force: true, y, note: "the causeway stair" });
    claim(worldFoot("stairs", 0, cz, dir < 0 ? 0 : 2, { height: h }), "solid", "the causeway stair");
  }
  // Two fishermen's huts on piles beside it, their platforms at the deck.
  for (const [x, z, turn] of [[5.45, (z0 * 2 + z1) / 3, 1], [-5.45, (z0 + z1 * 2) / 3, 3]]) {
    const y = CAUSE_DECK - 0.55 - floorAt(x, z);
    must("stiltHut", x, Number(z.toFixed(2)), turn, { litWindows: true }, { force: true, y, note: "a fisherman's hut" });
    claim(worldFoot("stiltHut", x, z, turn, {}), "solid", "a fisherman's hut");
  }
}
{
  // The boathouse stands on the north arm's west bank, found by marching east
  // from the Landing to the water's edge, so its deck (0.73 over the ground at
  // its centre) is a step over the yard, the boat door faces the yard and the
  // water doors stand over the arm.
  const bz = 80;
  let bx = 0;
  while (floorAt(bx, bz) > -0.2 && bx < 40) bx += 0.25;
  must("boathouse", Number(bx.toFixed(1)), bz, 1, null, { note: "the boathouse", dry: [-6, 7.2, -7, -3.5], flat: 1.8, skip: (c) => c.type === "open" });
}
// A slip slopes, which is what it is for. The footprint reaches the shores'
// feet, 2.95 m either side of the keel, and across that the slip falls 0.56 —
// past a prop's 0.5, and what this boat has always stood on: the table it was
// placed by stopped at 1.9 m and never sampled the feet.
place("careenedHull", -12, 86, 1, { length: 10 }, { note: "a river boat on the slip", flat: 0.6 });
place("stall", -4, 60, 1, null, { note: "a stall" });
place("crates", 3, 64, 0, null);
place("fishRack", 4, 70, 1, { length: 7 }, { note: "a fish rack" });
place("shed", -13, 74, 3, { width: 6.6, depth: 4 }, { note: "the company store" });
{
  // The north footbridge over the north arm, bank to bank.
  const ends = Math.min(floorAt(NBRIDGE_X - FOOT_LEN / 2, NBRIDGE_Z), floorAt(NBRIDGE_X + FOOT_LEN / 2, NBRIDGE_Z));
  must("bridge", NBRIDGE_X, NBRIDGE_Z, 1, { length: FOOT_LEN, width: 2.6 }, { force: true, y: ends - floorAt(NBRIDGE_X, NBRIDGE_Z), note: "the north footbridge" });
  claim(worldFoot("bridge", NBRIDGE_X, NBRIDGE_Z, 1, { length: FOOT_LEN, width: 2.6 }), "solid", "the north footbridge");
}

// --- A — the stilt village ---------------------------------------------------

section(placements, "A: The Stilt Village");
note(
  placements,
  "A village of stilt huts on the lagoon's south shore, a storey up: one walk",
  "runs east-west eight metres north of the flag with the huts off its north",
  "side and one at each end, so the walks are a firing line over the clearing",
  "and the ground under them a covered way in. Two stairs, both on the flag's",
  "side, are the only ways up — taking the height means crossing open ground",
  "under it first. Fish racks on the shore and a jetty into the lagoon behind.",
);
const LIFT = 2;
const WALK_Z = 84;
{
  // The walk, in three abutting lengths. Level ground (the district's), so one
  // `y` serves them all.
  const x0 = -82;
  const x1 = -38;
  const pieces = 3;
  const each = (x1 - x0) / pieces;
  for (let k = 0; k < pieces; k++) {
    const cx = x0 + each * (k + 0.5);
    must("boardwalk", cx, WALK_Z, 1, { length: Number(each.toFixed(3)), railSide: "none" }, { force: true, y: LIFT, note: "the village walk" });
    claim(worldFoot("boardwalk", cx, WALK_Z, 1, { length: each }), "solid", "the village walk");
  }
  // The huts off the walk's north side, their open south faces on it.
  for (const x of [-75, -62.6, -50.2]) {
    must("stiltHut", x, WALK_Z + 1.2 + 4.2, 0, { litWindows: chance(0.6) }, { force: true, y: LIFT, note: "a village hut" });
    claim(worldFoot("stiltHut", x, WALK_Z + 1.2 + 4.2, 0, {}), "solid", "a village hut");
  }
  // One at each end, turned so its open end meets the walk.
  must("stiltHut", x0 - 4.2, WALK_Z, 3, { litWindows: true }, { force: true, y: LIFT, note: "a village hut" });
  claim(worldFoot("stiltHut", x0 - 4.2, WALK_Z, 3, {}), "solid", "a village hut");
  must("stiltHut", x1 + 4.2, WALK_Z, 1, {}, { force: true, y: LIFT, note: "a village hut" });
  claim(worldFoot("stiltHut", x1 + 4.2, WALK_Z, 1, {}), "solid", "a village hut");
  // The two stairs, climbing north onto the walk's south edge.
  const h = LIFT + 0.5;
  for (const sx of [-71, -46]) {
    const cz = WALK_Z - 1.2 - stairRun(h) / 2;
    must("stairs", sx, cz, 0, { height: h }, { force: true, note: "a village stair" });
    claim(worldFoot("stairs", sx, cz, 0, { height: h }), "solid", "a village stair");
  }
}
// On the ground: huts either side of the clearing facing the flag, a well,
// the racks on the lagoon shore.
place("stiltHut", -79, 72, 3, { litWindows: true }, { note: "a hut on the clearing" });
place("stiltHut", -37, 73, 1, {}, { note: "a hut on the clearing" });
place("well", -70, 68, 0, null, { note: "the village well" });
place("stall", -48, 68, 0, null, { note: "a stall" });
place("fishRack", -34, 96, 0, { length: 8 }, { note: "a fish rack" });
{
  // The lagoon jetty, rooted on the shore behind the huts and run out north.
  const jx = -42;
  let root = 96;
  while (floorAt(jx, root) > -0.45 && root < 118) root += 0.25;
  const len = 12;
  const cz = root + len / 2 - 2;
  const y = -0.1 - 0.57 - floorAt(jx, cz);
  place("jetty", jx, Number(cz.toFixed(1)), 2, { length: len }, { force: true, y, note: "the lagoon jetty" });
  claim(worldFoot("jetty", jx, cz, 2, { length: len }), "solid", "a jetty");
}

// --- B — the ferry ------------------------------------------------------------

section(placements, "B: The Ferry");
note(
  placements,
  "The ferry over the west arm: a landing on each bank facing the other, the",
  "ferry itself slipped on the west shore, and the ferryman's hut half over",
  "the water. The flag is the open bank between the landing and the mission —",
  "still the most exposed flag on the map, now with its cover at its edges",
  "rather than none at all. The mission stands on the rise south of it, with",
  "its burial ground walled beside it.",
);
{
  // The two landings, each a jetty rooted on its own bank and run out toward
  // the other, the same z so they face across the water.
  const fz = -24;
  const ax = armX("west", fz);
  for (const [dir, text] of [[-1, "the west landing"], [1, "the east landing"]]) {
    let root = ax + dir * 14;
    while (floorAt(root, fz) > -0.45 && Math.abs(root - ax) > 1) root -= dir * 0.25;
    const len = 9;
    const cx = root - dir * (len / 2 - 2);
    const y = -0.1 - 0.57 - floorAt(cx, fz);
    place("jetty", Number(cx.toFixed(1)), fz, 1, { length: len }, { force: true, y, note: text });
    claim(worldFoot("jetty", cx, fz, 1, { length: len }), "solid", "a jetty");
  }
  // The ferryman's hut, on the west bank north of the landing, over the water's
  // edge — the stilt hut doing what it was built for.
  let hx = ax - 14;
  while (floorAt(hx + 3, -12) > -0.3 && hx < ax) hx += 0.25;
  place("stiltHut", Number(hx.toFixed(1)), -12, 1, { litWindows: true }, { note: "the ferryman's hut", noDoor: true, wetOk: true, flat: 1.4 });
}
place("careenedHull", -88, -40, 0, { length: 11 }, { note: "the ferry, slipped" });
place("crates", -88, -16, 0, null);
place("shed", -114, -30, 3, { width: 4.4, depth: 3 }, { note: "the ferry store" });
place("stall", -104, -40, 2, null, { note: "a stall" });
// The mission, on the rise south of the flag, its door to the ferry yard.
place("jungleRuin", -110, -54, 2, { width: 12, depth: 9 }, { note: "the mission" });
place("well", -94, -50, 0, null, { note: "the mission well" });

// --- the sawmill ---------------------------------------------------------------

section(placements, "the sawmill");
note(
  placements,
  "On the west road between the village and the ferry: the charcoal kilns",
  "with their mouths to the yard, the cordwood stacked round them, the",
  "sawyer's house and his sheds.",
);
place("kiln", -97, 48, 1, null, { note: "a charcoal kiln" });
place("woodpile", -96, 38, 1, { length: 6 });
place("stiltHut", -113.5, 44, 3, { litWindows: true }, { note: "the sawyer's house" });
place("woodpile", -112, 56, 0, { length: 6 });
place("woodpile", -113, 30, 1, { length: 6 });
place("woodpile", -92, 56, 1, { length: 5 });
place("shed", -92, 30, 1, { width: 5, depth: 3.2 }, { note: "the saw shed" });
place("cart", -98, 28, 1, null, { note: "a timber cart" });
place("crates", -91.5, 43.5, 0, null);

// --- D — the temple ------------------------------------------------------------

section(placements, "D: The Temple");
note(
  placements,
  "The temple on the crown of the hill, three terraces of it with the flag in",
  "the sanctuary's socket; the processional way climbs to its south stair from",
  "the trestle, the back road to its north court from the footbridge, and the",
  "river track up from Redline's side. A broken precinct wall rings the summit,",
  "with its gates where the roads come in, and steles line the paved way.",
);
must("templeRuin", TEMPLE.x, TEMPLE.z, 0, null, { note: "the temple", noDoor: true, skip: (c) => c.type === "flag", dry: [-13.5, 13.5, -11.5, 11.5], flat: 0.4 });


// --- E — the camp ---------------------------------------------------------------

section(placements, "E: The Camp");
note(
  placements,
  "A camp dug in under the deepest canopy on the map: huts round the clearing,",
  "sandbag lines at its edges, the stores and the cookhouse, the look-out on",
  "the knoll east of it. Dark and close, and every approach ends at a wall of",
  "bags.",
);
const CAMP_SKIP = (c) => c.type === "flag" || (c.type === "open" && c.wooded);
place("stiltHut", 48, -67, 0, { litWindows: true }, { note: "a camp hut", skip: CAMP_SKIP });
place("stiltHut", 29, -99, 2, {}, { note: "a camp hut", skip: CAMP_SKIP });
place("stiltHut", 50, -99, 2, {}, { note: "a camp hut", skip: CAMP_SKIP });
for (const [x, z, t, len] of [
  [40, -75, 0, 6], [40, -93, 0, 6], [31, -84, 1, 5], [49, -84, 1, 5],
  [58, -90, 1, 6], [22, -80, 1, 6], [34, -69, 0, 5],
]) {
  place("sandbags", x, z, t, { length: len }, { note: "a sandbag line", pad: 0.6 });
}
place("crates", 62, -74, 0, null);
place("crates", 41, -104, 1, null);
place("shed", 60, -100, 3, { width: 5, depth: 3.2 }, { note: "the camp store" });
place("shed", 60, -68, 1, { width: 4.4, depth: 3 }, { note: "the cookhouse" });
place("watchtower", 72, -54, 0, null, { note: "the camp look-out", noDoor: true, anySlope: true });
{
  // The east footbridge, where the river track crosses the east arm.
  const ends = Math.min(floorAt(EBRIDGE_X, EBRIDGE_Z - FOOT_LEN / 2), floorAt(EBRIDGE_X, EBRIDGE_Z + FOOT_LEN / 2));
  must("bridge", EBRIDGE_X, EBRIDGE_Z, 0, { length: FOOT_LEN, width: 2.6 }, { force: true, y: ends - floorAt(EBRIDGE_X, EBRIDGE_Z), note: "the east footbridge" });
  claim(worldFoot("bridge", EBRIDGE_X, EBRIDGE_Z, 0, { length: FOOT_LEN, width: 2.6 }), "solid", "the east footbridge");
}

// --- the old city -----------------------------------------------------------------

section(placements, "the old city");
note(
  placements,
  "Older than the temple and far older than the manor: the courts of a town",
  "nobody names, sunk in the hollow under the spine where the mist lies",
  "thickest. Broken walls of mossy stone at every height from a kerb to a",
  "man's head, laid as courts and lanes and cut wherever the path goes",
  "through them; steles and boulders in the courts between them.",
);

// --- the outposts ------------------------------------------------------------------

section(placements, "the outposts");
note(
  placements,
  "Each side's home: a sandbagged picket either side of its road with its",
  "stores, and the side deploying in the lee of the bags.",
);
for (const [sx, sz, f] of [[-100, 96, 1], [100, -96, -1]]) {
  place("sandbags", sx, sz - 6 * f, 0, { length: 6 }, { note: "a sandbag line" });
  place("sandbags", sx - 11 * f, sz + 3 * f, 1, { length: 5 }, { note: "a sandbag line" });
  place("sandbags", sx + 11 * f, sz + 3 * f, 1, { length: 5 }, { note: "a sandbag line" });
  place("crates", sx + 12 * f, sz + 9 * f, 0, null);
  place("shed", sx - 4 * f, sz + 10 * f, f > 0 ? 0 : 2, { width: 5, depth: 3.2 }, { note: "the outpost store" });
}

// --- walls: the garden, the precinct, the burial ground, the old city ----------------

/**
 * Lines of stone wall, `[x0, z0, x1, z1, height]`, axis-aligned. Each is cut
 * into runs wherever it meets a track, a claim or the water — which is where
 * the gates are — and laid one line at a time, so a line meeting one already
 * laid stops short of it.
 */
const WALLS = [
  // The manor's garden, walled on three sides below the terrace.
  [-26, -26, -26, -52, 1.6],
  [26, -26, 26, -52, 1.6],
  [-26, -52, 26, -52, 1.6],
  // The terrace wall along the lawn's foot, where the manor's ground drops to
  // the marsh: the north approach's cover, as the garden's walls are the
  // south's. Cut where the causeway lands and where the service track runs.
  [-22, 13, 22, 13, 1.3],
  [-28, 2, -28, -22, 1.2, 0.4],
  // The temple's precinct, broken, round the summit: the processional way
  // comes in through the west wall, the river track through the south and the
  // back road through the north, and a third of it has fallen besides.
  [60, 4, 60, 60, 1.3, 0.5],
  [100, 4, 100, 60, 1.1, 0.5],
  [60, 60, 100, 60, 1.2, 0.5],
  [60, 4, 100, 4, 1.0, 0.5],
  // The mission's burial ground, on the rise over the ferry beside the west road.
  [-118, -6, -118, 10, 1.2],
  [-118, 10, -107, 10, 1.2],
  [-107, -6, -107, 10, 1.2],
  [-118, -6, -107, -6, 1.2],
  // The old city: an outer circuit, two inner courts either side of the path,
  // a lane along its south side and a fragment out on the spine's flank.
  [-62, -66, -24, -66, 2.1],
  [-62, -66, -62, -100, 1.7],
  [-24, -66, -24, -100, 1.4],
  [-62, -100, -24, -100, 1.2],
  [-54, -72, -54, -88, 1.8],
  [-34, -72, -34, -88, 1.9],
  [-58, -94, -30, -94, 0.9],
  [-70, -58, -52, -58, 1.5],
];
const MIN_RUN = 3;
const MAX_RUN = 10;
/** How far a wall's end piers stand past its run's ends. */
const WALL_REACH = -FOOT.stoneWall({ length: 0 })[0];

function runnable(x, z) {
  if (Math.abs(x) > HALF - 3 || Math.abs(z) > HALF - 3) return false;
  if (onRoadAt(x, z, 1.4)) return false;
  // Dry across the wall's own thickness, as `place` will test it.
  for (const [dx, dz] of [[0, 0], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]]) if (wet(x + dx, z + dz, 0.3)) return false;
  if (grade(x, z) > 0.3) return false;
  for (const c of claimed) {
    if (c.type === "open" || c.type === "flag") continue;
    const pad = c.type === "low" ? 2 : 1.2;
    if (x > c.x0 - pad && x < c.x1 + pad && z > c.z0 - pad && z < c.z1 + pad) return false;
  }
  for (const f of FLAGS) if (Math.hypot(x - f.x, z - f.z) < 4) return false;
  return true;
}

section(placements, "the walls");
note(
  placements,
  "Every wall line cut into runs wherever a track, a building or the water",
  "crosses it, so the gates are where the tracks are. Mossy dry stone: it",
  "stops a round, and it is never the same height twice.",
);
const runs = [];
for (const [x0, z0, x1, z1, height, gone = 0] of WALLS) {
  const alongX = z0 === z1;
  const a = alongX ? Math.min(x0, x1) : Math.min(z0, z1);
  const b = alongX ? Math.max(x0, x1) : Math.max(z0, z1);
  const at = alongX ? z0 : x0;
  const here = [];
  let start = null;
  const flush = (end) => {
    if (start === null) return;
    for (const [s0, s1] of cutRun(start, end, { minRun: MIN_RUN, maxRun: MAX_RUN, reach: WALL_REACH })) {
      here.push({ alongX, at, s0, s1, height });
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
  for (const r of here) {
    // A BROKEN line: some runs are simply not there any more, which is what
    // lets the precinct be crossed on a broad front rather than at its gates.
    if (gone > 0 && chance(gone)) continue;
    const len = Number((r.s1 - r.s0).toFixed(1));
    const mid = (r.s0 + r.s1) / 2;
    const [x, z] = r.alongX ? [mid, r.at] : [r.at, mid];
    // A broken wall: each run a little off the line's height, and one in five
    // knocked down to a kerb.
    const hh = chance(0.2) ? 0.6 : Number((r.height * rand(0.8, 1.15)).toFixed(2));
    if (place("stoneWall", Number(x.toFixed(1)), Number(z.toFixed(1)), r.alongX ? 0 : 1, { length: len, height: hh }, { anySlope: true, pad: 0, note: "a wall", skip: (c) => c.type === "open" || c.type === "flag" })) {
      runs.push(r);
    }
  }
}

// --- the dressing -------------------------------------------------------------

/**
 * Whether a stand of radius `r` may be sown at (x, z): dry round its rim and
 * at its centre, clear of every claim (a yard and a flag's clearing included),
 * under a grade a tree stands on, and inside the square.
 */
const WHY = {};
function groveOk(x, z, r, maxGrade = 0.34, throughSolid = false) {
  if (Math.abs(x) + r > HALF || Math.abs(z) + r > HALF) return (WHY.edge = (WHY.edge ?? 0) + 1), false;
  const box = { x0: x - r, x1: x + r, z0: z - r, z1: z + r };
  const hit = overlaps(box, 0.4, (c) => c.wooded || (throughSolid && c.type === "solid"));
  if (hit) return (WHY[hit.type] = (WHY[hit.type] ?? 0) + 1), false;
  const ring = r > 5 ? 12 : 8;
  for (let k = 0; k <= ring; k++) {
    const a = (k / ring) * Math.PI * 2;
    const f = k === ring ? 0 : 1;
    const px = x + f * Math.cos(a) * (r + 0.5);
    const pz = z + f * Math.sin(a) * (r + 0.5);
    if (wet(px, pz, 0.3)) return (WHY.wet = (WHY.wet ?? 0) + 1), false;
    if (grade(px, pz) > maxGrade) return (WHY.grade = (WHY.grade ?? 0) + 1), false;
  }
  return true;
}
let rectWhy = "";
function rectOk(x, z, w, d, maxGrade = 0.34, skipOpen = true) {
  const box = { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 };
  const hit = overlaps(box, 0.5, (c) => (skipOpen && c.type === "open") || c.type === "flag");
  if (hit) return (rectWhy = hit.note), false;
  for (const fx of [0, 0.25, 0.5, 0.75, 1]) {
    for (const fz of [0, 0.25, 0.5, 0.75, 1]) {
      const px = box.x0 + fx * w;
      const pz = box.z0 + fz * d;
      if (wet(px, pz, 0.3)) return (rectWhy = "wet"), false;
      if (grade(px, pz) > maxGrade) return (rectWhy = `grade ${grade(px, pz).toFixed(2)}`), false;
    }
  }
  rectWhy = "a road";
  return true;
}
/** For props a road does NOT refuse (stone, logs): the whole rect clear of every carriageway. */
function offRoad(x, z, w, d, pad = 1) {
  for (let px = x - w / 2; px <= x + w / 2 + 1e-9; px += 1) {
    for (let pz = z - d / 2; pz <= z + d / 2 + 1e-9; pz += 1) if (onRoadAt(px, pz, pad)) return false;
  }
  return true;
}

const { disc, rectRegion } = makeScatter(scatter, regions);

const TREE = ", scale: [0.85, 1.3], blocking: true, clearance: 0.95";
const FERN = ", scale: [0.8, 1.4]";
const STELE = ", scale: [0.85, 1.25], blocking: true, clearance: 0.7";
const BOULDER = ", scale: [0.8, 1.3], blocking: true, clearance: 1.0";
const LOG = ", scale: [0.85, 1.2], blocking: true, clearance: 1.6";
let trees = 0;

section(scatter, "the set pieces' dressing");
note(
  scatter,
  "Placed first, because each is a place's own and the forest is what is left.",
  "Stone does not grow, so a road does not refuse it: every region of it below",
  "was checked clear of the carriageways by the generator.",
);
// The processional way's stele avenue, both sides of the paving.
for (const [x, z, w, d, n] of [[52, 17.6, 10, 1.6, 3], [62.9, 8.2, 3.8, 2, 2], [62.9, 17.6, 3.8, 1.6, 2]]) {
  if (rectOk(x, z, w, d) && offRoad(x, z, w, d, 0.6)) rectRegion("carvedStele", x, z, w, d, n, STELE);
  else console.log(`  WARNING: steles at (${x}, ${z}) refused: ${rectWhy}`);
}
// Boulders and steles on the temple's hill.
for (const [prop, x, z, r, n, extra] of [
  ["boulder", 107, 40, 5, 3, BOULDER], ["boulder", 62.9, 44, 1.9, 1, BOULDER], ["carvedStele", 97, 18, 2, 1, STELE],
  ["carvedStele", 96.6, 44, 1.5, 1, STELE], ["boulder", 109, 24, 5, 3, BOULDER],
]) {
  if (groveOk(x, z, r, 0.42) && offRoad(x, z, 2 * r, 2 * r)) disc(prop, x, z, r, n, extra);
  else console.log(`  WARNING: ${prop} at (${x}, ${z}) refused: ${rectOk(x, z, 2 * r, 2 * r, 0.42) ? "a road" : rectWhy}`);
}
// The old city: steles in its courts, boulders fallen from its walls.
for (const [prop, x, z, w, d, n, extra] of [
  ["carvedStele", -58, -80, 4, 12, 3, STELE], ["carvedStele", -29, -76, 4, 8, 2, STELE],
  ["boulder", -44, -97, 24, 3, 3, BOULDER], ["boulder", -58, -62, 8, 3, 2, BOULDER],
  ["carvedStele", -50, -80, 5, 10, 2, STELE],
]) {
  if (rectOk(x, z, w, d, 0.34, true) && offRoad(x, z, w, d)) rectRegion(prop, x, z, w, d, n, extra);
  else console.log(`  WARNING: ${prop} at (${x}, ${z}) refused: ${rectWhy}`);
}
// The mission's burial ground.
if (rectOk(-112.5, 2, 8, 13) && offRoad(-112.5, 2, 8, 13)) rectRegion("gravestone", -112.5, 2, 8, 13, 12, ", scale: [0.8, 1.2], blocking: true, clearance: 0.6");
else console.log(`  WARNING: the mission's headstones refused: ${rectWhy}`);
// Barrels in the yards; one drum burning in the camp (see the light budget).
for (const [x, z, r, n] of [[-4, 66, 3, 3], [44, -78, 3, 3], [-92, -20, 2, 2], [-104, 50, 2, 2], [-34, -12, 2, 2]]) {
  disc("barrel", x, z, r, n, ", blocking: true, clearance: 0.55");
}
for (const [x, z] of [[36, -78]]) {
  disc("fireDrum", x, z, 1.5, 1, ", blocking: true, clearance: 0.6");
}
// The sawmill's logs.
if (offRoad(-110, 40, 10, 8)) disc("log", -110, 40, 4, 4, ", scale: [0.8, 1.2], blocking: true, clearance: 1.4");

/**
 * How wooded a point is meant to be, 0..1. The valley is forest by default;
 * what is authored is where it thins — a clearing is a SPARSE stand rather
 * than a hole, which is what keeps it reading as a gap in a jungle rather
 * than a bald patch in a level.
 */
function woodiness(x, z) {
  let w = 1;
  const thin = (cx, cz, r, floor) => {
    const d = Math.hypot(x - cx, z - cz);
    if (d < r) w = Math.min(w, floor + (1 - floor) * smooth((d - r * 0.6) / (r * 0.4)));
  };
  // The flags' clearings.
  thin(byId.A.x, byId.A.z, 16, 0.12);
  thin(byId.B.x, byId.B.z, 17, 0.08);
  thin(byId.E.x, byId.E.z, 13, 0.45);
  // The manor's lawn and garden, the Landing, the temple's summit.
  thin(0, 14, 16, 0.2);
  thin(0, -38, 12, 0.45);
  thin(-2, 66, 16, 0.1);
  thin(TEMPLE.x, TEMPLE.z, 24, 0.2);
  // The ferry's banks.
  thin(-72, -24, 14, 0.2);
  // The deep south and the camp's country: thicker.
  if (z < -60) w = Math.min(1, w * 1.1);
  w += 0.12 * vnoise(x, z, 26, 61);
  return Math.max(0, Math.min(1, w));
}

section(scatter, "the forest");
note(
  scatter,
  "The jungle, sown against the finished floor on a 12 m lattice: a stand is a",
  "disc checked dry, clear of every building and yard, and under a grade a",
  "tree stands on; where a stand does not fit, a smaller one is tried. A track",
  "cuts its own avenue through it — a jungle tree is ROOTED, so `findSpot`",
  "keeps it off every carriageway. About one trunk per 36 m² in the deep",
  "forest and a tenth of that in a clearing.",
);
const LATTICE = 12;
const STANDS = {};
function sow(x, z, r, w) {
  const area = Math.PI * r * r;
  const perTree = 360 - (360 - 31) * w;
  const count = Math.floor(area / perTree + rng());
  if (count > 0) {
    disc("jungleTree", x, z, r, count, TREE);
    trees += count;
  }
  // The floor under it: ferns where the canopy breaks, a fallen giant now and then.
  if (r >= 3 && chance(0.3 + 0.4 * (1 - w))) disc("fernClump", x, z, r, 1 + Math.floor(rng() * 3), FERN);
  // A fallen giant is five metres long, so unlike a trunk it is kept to a stand
  // clear of every structure: `findSpot`'s burial test is a point, and a log
  // lying half across a wall is not buried at its centre.
  if (r >= 5 && w > 0.6 && chance(0.12) && offRoad(x, z, 2 * r, 2 * r) && !overlaps({ x0: x - r, x1: x + r, z0: z - r, z1: z + r }, 1, (c) => c.type !== "solid")) {
    disc("buttressLog", x, z, r, 1, LOG);
  }
}
for (let gz = -HALF + LATTICE / 2; gz < HALF; gz += LATTICE) {
  for (let gx = -HALF + LATTICE / 2; gx < HALF; gx += LATTICE) {
    const x = gx + rand(-1.5, 1.5);
    const z = gz + rand(-1.5, 1.5);
    const w = woodiness(x, z);
    // One stand over the whole cell where it fits; where it does not, a stand
    // in each quarter that does, so the forest runs up to a wall or a bank
    // rather than stopping a cell short of it.
    if (groveOk(x, z, 6.8, 0.34, true)) {
      STANDS.whole = (STANDS.whole ?? 0) + 1;
      sow(x, z, 6.8, w);
      continue;
    }
    for (const [qx, qz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) {
      for (const r of [3.2, 2]) {
        if (!groveOk(x + qx, z + qz, r, 0.34, true)) continue;
        STANDS[r] = (STANDS[r] ?? 0) + 1;
        sow(x + qx, z + qz, r, woodiness(x + qx, z + qz));
        break;
      }
    }
  }
}
if (process.argv.includes("--stands")) console.log("  stands by radius:", JSON.stringify(STANDS), "refused:", JSON.stringify(WHY));
section(scatter, "the banks");
note(
  scatter,
  "Bamboo along the river where the light comes down it, and ferns on the",
  "banks — non-blocking both, so a bank is concealment and never a wall.",
);
for (let i = 0; i < RIVER.length; i += 36) {
  const [cx, cz] = RIVER[i];
  for (const side of [-1, 1]) {
    const [nx, nz] = (() => {
      const j = Math.min(RIVER.length - 1, i + 1);
      const dx = RIVER[j][0] - cx;
      const dz = RIVER[j][1] - cz;
      const l = Math.hypot(dx, dz) || 1;
      return [-dz / l, dx / l];
    })();
    const x = cx + nx * side * (LIP + 3);
    const z = cz + nz * side * (LIP + 3);
    if (Math.abs(x) > HALF - 6 || Math.abs(z) > HALF - 6) continue;
    if (!groveOk(x, z, 3)) continue;
    if (chance(0.45)) disc("bamboo", x, z, 3, 1 + Math.floor(rng() * 2), ", scale: [0.8, 1.2]");
    else if (chance(0.6)) disc("fernClump", x, z, 3, 3, FERN);
  }
}

// --- the country beyond the play square ---------------------------------------

const BORDERLAND = `  // ===== THE COUNTRY PAST THE PLAY SQUARE ====================================
  // Thirty-nine regions, 718 trees and 115 pieces of understory, APPENDED
  // for the reason the note at the top of this array gives: one seeded stream
  // serves the whole build in authored order, so a region spliced in above
  // this line rerolls every field below it and moves every tree in the valley.
  // This is the END of the stream. Append, never insert.
  //
  // WHY IT IS HERE AT ALL. \`borderland\` takes the rim away, and a margin with
  // nothing standing on it is not "the valley keeps going" — it is a plane
  // fading to \`fogColor\`, which reads as a backdrop. What tells an eye that
  // ground RECEDES is stuff standing ON it at intervals.
  //
  // NONE OF IT BLOCKS, and that is the load-bearing line rather than a saving.
  // A blocking prop is a collider, a \`WorldBox\` and a row in the collision
  // bake; out here it would be geometry the bots can neither see nor route
  // around — the nav graph stops at the play square — and, the sharp one,
  // something to CATCH a player sprinting home against a countdown. Omitting
  // \`blocking\` emits nothing at all, so every tree below leaves the baked
  // collision set byte-identical. The two props that carry a body inside the
  // square (\`buttressLog\`, \`carvedStele\`) are sown WITHOUT it out here and are
  // pictures.
  //
  // …AND NOTHING IS A PLACEMENT. A structure would be a collider too, and
  // worse: placements build BEFORE scatter off the same stream, so one ruin
  // out here would move all 1,396 trees inside the map. The ruins' motif
  // carries on as non-blocking steles instead.
  //
  // THE COLLAR ARGUMENT, WHICH THIS MAP MAKES WITH DENSITY RATHER THAN WITH
  // ITS PROP. Harrowmead keeps 90 m of bare ground past its square because its
  // hedges and walls genuinely stop there, so the dressing thinning out is a
  // cue the HUD cannot give, and because 90 m is past the leash's 69 so
  // nothing alive ever stands in a non-blocking wood. Hollowmere gives the
  // collar up and pays for it with the PROP — a bare blighted trunk 0.7 m
  // across, nothing to hide behind. Greyfen can do neither. It has no cue to
  // protect (the forest is sown to z = ±120 on three sides, so a bare ring
  // would be a firebreak cut round a jungle that has not got one, and against
  // a 78 m fog wall it would put the whole block out of sight), and its tree
  // is 0.91 m of bole at eye height with a buttress flare wider than that. So
  // what this map spends instead is the DENSITY, and the number it is spent
  // against is the fog:
  //
  //   a sightline's mean free path through randomly placed trunks is
  //   1 / (trees-per-m² × trunk width). Inside the square the deep forest runs
  //   35 m² a tree, which is 38 m — HALF the fog wall, so a stand inside the
  //   map is a screen and is meant to be. The stands below run 110–173 m² a
  //   tree in the near band a living player reaches (121–190 m) and 216–240
  //   past it: a sightline out here reaches the fog before it reaches a trunk,
  //   everywhere, by half again at the worst of it.
  //
  // So the borderland is the one wood on Greyfen you can see through further
  // than you can see, and the concealment a collar exists to prevent is not
  // available in it. What makes that safe rather than merely true is that the
  // forest two metres back INSIDE the line stops rounds and this does not, so
  // stepping out of the map to fight from it is a trade DOWN — which is the
  // argument this map has and Hollowmere's moor did not.
  //
  // AND IT STILL READS AS JUNGLE, because on this tree the canopy and the bole
  // are different arguments. The crown is 7.6 m plates at 10 m with fronds
  // past them, so about 50 m² of sky each: at 110–155 m² a tree that is 32–45%
  // closure — gallery forest along a flood plain, which is exactly what the
  // banks of a tropical river are, against the >100% closure of the valley you
  // are standing in. The thing that says "jungle" at 40 m through this fog is
  // the canopy line, and this has one.
  //
  // WHERE THE TREES ARE NOT. Nothing is sown past 150 m from the square. From
  // the leash limit at 69 m out, 150 m is 81 m away and the fog wall is 78, so
  // the last 30 m of margin is fog insurance rather than country, and sowing it
  // would be paying for geometry nobody can be standing anywhere to see. The
  // three channel mouths are left open for the same kind of reason the other
  // way round: what carries the north, west and east bearings out of the map
  // is the RIVER, and a stand across a channel is a stand standing in it.
  //
  // IT IS NOT A RING, which is the bowl a rim would have been at one notch
  // quieter. Each side is given the country the valley already has on it: the
  // SOUTH is the deepest forest on the map, simply carried on, and is the
  // thickest side; the NORTH is the hamlet's treeline west of the channel and
  // the temple shelf's thinner woods east of it, with the river coming down
  // between them; the WEST is Bravo's open bank, the thinnest side, with the
  // west branch running out through it; the EAST is the temple's own country,
  // and the steles say there is more of it. The CORNERS get TWO regions each,
  // an inner and an outer, because a side is 120 m of square from the middle
  // and a corner is 170: lay four sides as sides and the diagonal out of a
  // home spawn is left with the far tails of two of them, and one corner stand
  // far enough out to close the diagonal is too far out to close the near half
  // of it.
  //
  // WHICH WAS MEASURED, and it is the test worth copying rather than the
  // numbers. For every place a living player can stand — the play edge, 30 m
  // out and the leash limit, every 20 m along all four sides — sweep the
  // OUTWARD half-horizon two degrees at a time and ask how much of it finds a
  // stand inside \`fogEnd\`. The first pass put twenty-five regions out here and
  // read 88.9% mean with a worst of 14%, and the worst was not a corner: it
  // was the west side between z 60 and 120, which is what the Valeguard home
  // spawn looks out at, where half the horizon was open ground. At thirty-nine
  // it is 97.7% mean, 100% median and a worst of 75.6% — and the places still
  // under 80 are the three river mouths and the far ends of the leash strip,
  // which are openings on purpose. A screenshot finds the hole you happen to
  // photograph; this finds the one nobody stood in.

  // SOUTH — the canopy camp's forest carrying on, and the thickest side.
  { prop: "jungleTree", x: -80, z: -152, width: 72, depth: 60, count: 39, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: -4, z: -150, width: 68, depth: 56, count: 33, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: 72, z: -152, width: 68, depth: 60, count: 37, scale: [0.85, 1.3], clearance: 0.95 },
  // The understory in the near verge, where it is read from twenty metres
  // rather than from sixty. Ferns are the map's own non-blocking prop and are
  // already sown this way inside the fight; the logs are not, and are pictures
  // out here.
  { prop: "fernClump", x: 26, z: -140, radius: 20, count: 24, scale: [0.8, 1.4] },
  { prop: "buttressLog", x: -46, z: -142, radius: 16, count: 5, scale: [0.85, 1.2] },
  // The two southern corners' INNER halves — see the corner note above.
  { prop: "jungleTree", x: -116, z: -172, width: 56, depth: 60, count: 28, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: 114, z: -172, width: 56, depth: 60, count: 28, scale: [0.85, 1.3], clearance: 0.95 },
  // The far line, aimed at a player who is already dying: from the leash limit
  // at z = -189 the fog reaches -267, and without these the last thing anybody
  // sees on the way out is a plane. Thin, because it is only ever read through
  // most of a fog wall.
  { prop: "jungleTree", x: -42, z: -216, width: 76, depth: 56, count: 19, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: 44, z: -220, width: 76, depth: 56, count: 19, scale: [0.85, 1.3], clearance: 0.95 },

  // NORTH — Alpha's treeline west of the channel, the shelf's woods east of
  // it. Both stop short of x 19..49, which is the channel and its banks.
  { prop: "jungleTree", x: -86, z: 152, width: 68, depth: 60, count: 30, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: -20, z: 144, width: 48, depth: 44, count: 14, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: 84, z: 150, width: 66, depth: 56, count: 27, scale: [0.85, 1.3], clearance: 0.95 },
  // The channel's own banks, and the only thing standing between the two
  // woods: a river is a hole in the canopy and the light comes down it, which
  // is the argument the reed-bed grass rects below are laid on as well.
  { prop: "fernClump", x: 34, z: 156, width: 30, depth: 64, count: 28, scale: [0.8, 1.4] },
  { prop: "buttressLog", x: 28, z: 140, radius: 14, count: 5, scale: [0.85, 1.2] },
  { prop: "jungleTree", x: -116, z: 172, width: 56, depth: 60, count: 24, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: 114, z: 172, width: 56, depth: 60, count: 24, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: -64, z: 212, width: 72, depth: 56, count: 18, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: 24, z: 218, width: 72, depth: 56, count: 18, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: 96, z: 208, width: 64, depth: 52, count: 15, scale: [0.85, 1.3], clearance: 0.95 },

  // WEST — Bravo's bank is the most exposed flag on the map and the forest
  // stops short of it on three sides; this is that, carried on. The thinnest
  // side, and the west branch leaves through the middle of it.
  { prop: "jungleTree", x: -152, z: 26, width: 60, depth: 68, count: 29, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: -148, z: -28, width: 52, depth: 40, count: 12, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "fernClump", x: -150, z: -86, width: 56, depth: 26, count: 22, scale: [0.8, 1.4] },
  { prop: "carvedStele", x: -142, z: -56, radius: 13, count: 4, scale: [0.85, 1.25] },
  { prop: "jungleTree", x: -152, z: -122, width: 60, depth: 52, count: 22, scale: [0.85, 1.3], clearance: 0.95 },
  // The north half of this side, which is what the Valeguard home spawn looks
  // out at — measured, and it was the worst hole on the map before it: half of
  // the outward horizon from x = -120, z = 60..120 was open ground.
  { prop: "jungleTree", x: -152, z: 96, width: 60, depth: 72, count: 33, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: -212, z: 6, width: 60, depth: 72, count: 20, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: -216, z: -104, width: 60, depth: 60, count: 16, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: -214, z: 96, width: 64, depth: 72, count: 21, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: -214, z: -172, width: 64, depth: 60, count: 16, scale: [0.85, 1.3], clearance: 0.95 },

  // EAST — the temple's country. The stelae are why this side gets a motif of
  // its own: Delta is the one flag with worked stone around it, and a few more
  // of them standing out in the forest are the cheapest thing on this map that
  // says the valley had more in it than the five places you fight over.
  { prop: "jungleTree", x: 152, z: 52, width: 60, depth: 72, count: 31, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "carvedStele", x: 146, z: 30, radius: 15, count: 5, scale: [0.85, 1.25] },
  { prop: "jungleTree", x: 150, z: -4, width: 56, depth: 40, count: 14, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "fernClump", x: 152, z: -39, width: 60, depth: 24, count: 22, scale: [0.8, 1.4] },
  { prop: "jungleTree", x: 152, z: -96, width: 60, depth: 68, count: 29, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: 152, z: 106, width: 60, depth: 68, count: 29, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: 214, z: 40, width: 64, depth: 72, count: 21, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: 216, z: -70, width: 64, depth: 64, count: 18, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: 214, z: 140, width: 64, depth: 64, count: 18, scale: [0.85, 1.3], clearance: 0.95 },
  { prop: "jungleTree", x: 216, z: -170, width: 64, depth: 60, count: 16, scale: [0.85, 1.3], clearance: 0.95 },`;

// --- the water ---------------------------------------------------------------

/**
 * ONE rect, the whole floor: see the layout's own note. What is checked is the
 * promise that makes that safe — dry ground is held at `BANK - 0.05` or over
 * everywhere but the channels and the pools, so nothing inside the square is
 * wet that is not the river's own.
 */
const WATER_RECT = { x: 0, z: 0, width: 600, depth: 600, y: WATER_Y };
let deepest = 0;
let wetCells = 0;
for (let x = -HALF; x <= HALF; x += 1) {
  for (let z = -HALF; z <= HALF; z += 1) {
    const d = WATER_Y - floorAt(x, z);
    if (d <= 0) continue;
    wetCells++;
    deepest = Math.max(deepest, d);
    const own = riverDist(x, z) < LIP + 1 || POOLS.some((p) => poolDist(p, x, z) < p.skirt + 1);
    if (!own) throw new Error(`water: dug ground under the surface at (${x}, ${z}) off the river and the pools`);
  }
}

// --- the grass ---------------------------------------------------------------

const grass = [];
let grassArea = 0;
function turf(x, z, w, d, density, height, text) {
  if (text) grass.push(`  // ${text}`);
  const extra = (density === 1 ? "" : `, density: ${n2(density)}`) + (height === 1 ? "" : `, height: ${n2(height)}`);
  grass.push(`  { x: ${f1(x)}, z: ${f1(z)}, width: ${f1(w)}, depth: ${f1(d)}${extra} },`);
  grassArea += w * d;
}
turf(0, -90, 240, 60, 0.3, 0.7, "THE FOREST FLOOR — under a closed canopy almost no light reaches the ground, so it is litter, root and the odd fern. The whole valley gets a thin field; the gaps get more.");
turf(0, 0, 240, 120, 0.3, 0.7);
turf(0, 90, 240, 60, 0.3, 0.7);
turf(0, -38, 50, 26, 0.9, 1.2, "The manor's garden, nobody has cut it in a decade; the north lawn down to the marsh.");
turf(0, 12, 40, 14, 0.8, 1.15);
turf(byId.B.x, byId.B.z, 40, 44, 1, 1.2, "The ferry's bank: knee-high grass is concealment without cover, which is what the most exposed flag can be given without changing what it is.");
turf(byId.A.x, 72, 54, 20, 0.9, 1.1, "The stilt village's clearing, and the lagoon's reeds behind it.");
turf(-60, 106, 50, 16, 0.9, 1.2);
turf(TEMPLE.x, TEMPLE.z, 44, 44, 0.8, 1, "The temple's summit — open sky, so a real field.");
turf(-2, 66, 30, 20, 0.7, 1.0, "The Landing.");
turf(-44, -82, 44, 34, 0.7, 0.9, "The old city's courts.");
turf(7, 37, 30, 36, 0.9, 1.2, "The marsh bar and the basin's reeds.");
turf(-60, -10, 40, 50, 0.8, 1.2, "The banks: reeds in the water and the richest ground on the map beside it, because a river is a hole in the canopy.");
turf(66, -30, 44, 24, 0.8, 1.2);

// --- the flags' own spec -----------------------------------------------------

const flagY = (f) => {
  if (f.id === "D") return floorAt(f.x, f.z) + 1.35;
  return floorAt(f.x, f.z);
};
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
const DRY = process.argv.includes("--dry");
if (worstGrade > MAX_GRADE * 0.9 && DRY) {
  console.log(`  WARNING terrain: a ${worstStep.toFixed(2)} m step at ${worstAt}`);
} else if (worstGrade > MAX_GRADE * 0.9) {
  throw new Error(`terrain: a ${worstStep.toFixed(2)} m step over ${CELL} m at ${worstAt} is a ${worstGrade.toFixed(3)} gradient, against ${MAX_GRADE} less a tenth.`);
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
    JSON.stringify({ claimed, placements: placed, scatter: regions, heights: { size: CELLS, cell: CELL, heights: Array.from(V) } }),
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
 * greyfen/heights.ts — GENERATED by \`scripts/generate-greyfen.mjs\`
 * (\`npm run greyfen\`), and editable afterwards with the map editor's terrain
 * mode (F2, then T). Do not hand-edit: both the script and the editor rewrite
 * this file wholesale.
 *
 * The floor of the valley — one height per grid vertex, row-major from the
 * -X/-Z corner. A lazy \`import()\` (\`MapDef.heights\`), so it reaches a browser
 * only when this map is built.
 *
 * ${CELLS}x${CELLS} cells of ${CELL} m over the ${PLAY} m map, so ${ROW}x${ROW} vertices.
 * Keep any single-cell step under ${(MAX_GRADE * CELL).toFixed(2)} m or the nav graph stops
 * linking across it and whatever is beyond becomes an island; the generator
 * refuses anything over ${(MAX_GRADE * CELL * 0.9).toFixed(2)}.
 *
 * **The shape is four passes laid over one another IN ORDER** (see
 * \`heightAt\` in the generator): the valley with its named hills and the spine;
 * every district levelled toward its own height by a weighted average; the
 * ground held low round the three arms, the basin and the lagoon; and the
 * channels and the pools cut last to one ${BED} m bed, the marsh bar raised to
 * ${BAR_Y} under the causeway. Dry ground is held at ${(BANK - 0.05).toFixed(2)} or over, so
 * the one water rect at ${WATER_Y} is wet exactly where the river is.
 *
 * **Zero is the MIST's datum**: the flood plain, the ferry and the old city's
 * hollow sit at or under it and drown in it; the temple stands clear of it.
 */
import type { Heightfield } from "../layout";

export const GreyfenHeights: Heightfield = {
  size: ${CELLS},
  cell: ${CELL},
  // Row-major, +Z per row.
  heights: [
${heightRows.join("\n")}
  ],
};

// Default too, because \`MapDef.heights\` is a lazy \`import()\` and a default
// is the one export name a generic signature can be written against.
export default GreyfenHeights;
`,
);

const water = [
  `  { x: ${WATER_RECT.x}, z: ${WATER_RECT.z}, width: ${WATER_RECT.width}, depth: ${WATER_RECT.depth}, y: ${n2(WATER_RECT.y)}, sound: "stream" },`,
];

const layoutText = readTemplate()
  .replace("%PLACEMENTS%", placements.join("\n"))
  .replace("%SCATTER%", scatter.join("\n") + "\n\n" + BORDERLAND)
  .replace("%FLAGS%", NAMED.join("\n"))
  .replace("%SPAWNS%", spawns.join("\n"))
  .replace("%WATER%", water.join("\n"))
  .replace("%GRASS%", grass.join("\n"));
if (!DRY) writeFileSync(join(out, "layout.ts"), layoutText);

printTally(tally(placed, (p) => p.kind), refused, bracketKind);
if (process.argv.includes("--refusals")) printRefusals(refused);
console.log(
  `greyfen: ${PLAY} m square\n` +
    `  ${placed.length} placements, ${regions.length} scatter regions (~${trees} trees requested in play), ${runs.length} wall runs\n` +
    `  ${ROW}x${ROW} height vertices, ground ${lo.toFixed(2)}..${hi.toFixed(2)} m; districts ${DISTRICTS.map((d) => `${d.name} ${d.level}`).join(", ")}\n` +
    `  water deepest ${deepest.toFixed(2)} m over ${wetCells} m² in the square; grass ~${Math.round(grassArea)} m²\n` +
    `  steepest cell step ${worstStep.toFixed(2)} m (grade ${worstGrade.toFixed(3)}) at ${worstAt}\n` +
    (DRY ? "  dry run: nothing written" : `  wrote src/world/greyfen/{layout,heights}.ts`),
);

// --- the layout file's prose ---------------------------------------------------

function readTemplate() {
  return `/**
 * greyfen/layout.ts — THE MAP, as data: structure placements, scatter
 * regions, control points, spawns, water rects, grass rects. The floor's shape
 * is generated data and lives in heights.ts. Consumed by MapBuilder; nothing
 * here is code to special-case.
 * Gotchas that have already cost time: collider top faces within
 * CONFIG.nav.stepHeight of adjacent ground or bots treat decks as walls; a
 * control point's pos must NOT sit inside a PLACEMENT's collider; scatter
 * knows nothing about water, so every stand below was checked dry by the
 * generator; terrain steeper than a 0.4 gradient severs its own nav links.
 *
 * **SEEDED by \`scripts/generate-greyfen.mjs\`, and owned by the editor after
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
 * GREYFEN — a drowned jungle valley with a plantation rotting at its heart.
 *
 * 240 x 240 m, origin at the manor, +Z is north. A river comes in off the north
 * edge and splits at the confluence into a Y whose arms leave through the west
 * and east edges; five flags in a ring round the manor, with the two
 * uncapturable home spawns diagonally opposed so neither side starts next to C.
 *
 * \`\`\`
 *                                    N
 *    +---------------------------------------------------------+
 *    | VALEGUARD *   ~~~~ the lagoon ~~~~      ~ |    back       |
 *    |  outpost     A: THE STILT VILLAGE   hump ~|   country     |
 *    |  sandbags    walks a storey up     bridge=~= back road    |
 *    |    |     ____village track______ THE      ~ \\             |
 *    |   fork  (-60,+76)             LANDING    ~   \\ precinct   |
 *    |  sawmill                boathouse, market ~  D: THE TEMPLE |
 *    |  kilns                   causeway ~marsh~   (80,+34) hill |
 *    |    |                  \\   lawn   /     \\~~  processional |
 *    |  west road   kitchen   C: THE MANOR  trestle=== way   /   |
 *    |    |          yard    (0,-4) garden     \\~~  river track  |
 *    | B: THE FERRY ~~  ferry track _____ drive  \\~~~~~~ east    |
 *    |  (-97,-28)  ~~  landing       crossroads  foot-  ~~~~~~~~~|
 *    |  mission   ~~  ___ THE SPINE ___   /     bridge           |
 *    |  burial    ~~   OLD CITY       camp track   knoll         |
 *    |  ground  ~~~   (hollow)  ____ E: THE CAMP  look-out       |
 *    |~~~~~~~~~~~              path   (40,-84)  Redline road ___ |
 *    |                                           outpost REDLINE*|
 *    +---------------------------------------------------------+
 * \`\`\`
 *
 * ## A valley with places in it
 *
 * The forest is the default state of the ground — a trunk every six metres in
 * the deep parts, a canopy you cannot find a hole in — and it was all this map
 * had: between the five flags the valley was one texture. Now the forest is
 * what the PLACES are cut out of. The plantation built the manor at the
 * confluence, its landing on the bank below and a trestle east over the river
 * to the old temple on the hill; a village of stilt huts stands on the lagoon
 * upstream, a ferry crosses the west arm to the mission, the company's sawmill
 * burns charcoal on the west road, and under the ridge south of the manor lie
 * the courts of a town older than all of it. Somebody has dug a camp into the
 * deepest forest since. Every one of those is somewhere to find, a different
 * fight, and a thing to steer by.
 *
 * ## The ground
 *
 * The flood plain lies along the three arms, held low by the water; the manor
 * stands a metre over it on its terrace; the TEMPLE'S HILL rises nearly five
 * metres in the north-east and is the one place that stands clear of the mist.
 * THE SPINE — a wooded ridge from the ferry track to the camp's knoll — is what
 * stops C and E being one long lane; the drive crosses it on a saddle, and the
 * old city lies in the hollow under its south face where the mist is thickest.
 *
 * Design intent per flag:
 * - **A The Stilt Village** — huts a storey up on a walk eight metres north of
 *   the flag: a firing line over the clearing, a covered way under it, and two
 *   stairs on the flag's side as the only ways up.
 * - **B The Ferry** — the open bank between the ferry landing and the mission:
 *   still the most exposed flag on the map, its cover at its edges.
 * - **C The Manor** — the great hall, a gallery a storey up; approached by the
 *   drive through the walled garden, the causeway over the marsh, the trestle,
 *   and the kitchen yard.
 * - **D The Temple** — the flag you climb for, inside a broken precinct wall
 *   with a gate where each of its three roads arrives.
 * - **E The Camp** — dark and close under the deepest canopy, ringed by sandbag
 *   lines, with a look-out on the knoll to the east.
 *
 * Layout hygiene (the generator holds these; hand edits keep to them):
 * - Structures are axis-aligned (\`rotY\` in multiples of π/2). A builder's
 *   front is its local -Z: turn 0 faces south, π/2 west, π north, -π/2 east,
 *   and every front door opens onto a track, a yard or a flag's clearing.
 * - Nothing stands on a road, in the water, or on a slope, unless it is built
 *   to (a jetty, a bridge, the boathouse's water doors, the ferryman's hut).
 * - Roads are PATHS and end at junctions the network finds, at a yard, or at a
 *   crossing. Walls are cut wherever a track crosses them, which is where the
 *   gates are.
 * - The raised decks are authored as ABSOLUTE heights — the village walk at
 *   the district's level plus two metres, the causeway at +0.85 — and every
 *   stair is derived from the ground under its own foot. Move one and re-run
 *   the generator rather than nudging it here.
 * - The ORDER of the scatter array is load-bearing: every region draws from
 *   one seeded stream, so a region added anywhere but the end re-rolls every
 *   field below it — and adding a PLACEMENT re-rolls all of it.
 */

const placements: Placement[] = [
%PLACEMENTS%
];

/**
 * Dressing. Every stand inside the square was checked by the generator against
 * the finished floor — dry, clear of every building and yard, and under a
 * grade a tree stands on. A road rejects what grows by itself
 * (\`world/roads.ts\`), stone and logs were checked clear of the carriageways,
 * and blocking props are held off every flag and spawn by
 * \`MapBuilder.keepClear\`.
 *
 * The canopy starts nine metres up and the trunk is the whole collider (see
 * \`PROP_BODIES\`), so a stand is cover in the sense that TRUNKS are cover: a
 * level sightline through the deep forest runs about thirty metres before one
 * is in it. The clearings, the river and the tracks are the only long lanes.
 */
const scatter: ScatterSpec[] = [
%SCATTER%
];

const controlPoints: ControlPointDef[] = [
%FLAGS%
];

/**
 * Home spawns are uncapturable, and deploy in the lee of their outpost's
 * sandbags. Every control point also carries a spawn just outside its capture
 * zone, so deploying onto a flag you hold does not drop you on top of whoever
 * is contesting it.
 */
const spawns: SpawnPointDef[] = [
%SPAWNS%
];

/**
 * Standing water. Ankle-deep to knee-deep over the bed beneath it, so bots and
 * the player wade across — no swimming, and the nav grid never hears about it.
 *
 * **ONE rect, and it is the whole FLOOR rather than the whole valley** — 600 m
 * on a side, which is \`size\` plus twice the \`borderland\`'s margin, so the water
 * stops exactly where the ground does. A rect is an EXTENT and not a shore:
 * the bed decides what is wet. The generator holds dry ground at -0.15 or over
 * everywhere but the three arms, the basin and the lagoon, and checks it.
 *
 * **What it buys is that the river LEAVES.** The Y has three mouths in the
 * boundary — the north arm through the north edge at x 27..42, the west arm
 * through the west edge at z -93..-78 and the east arm through the east edge at
 * z -45..-33 — and \`TerrainField\` clamps its edge row outward, so the trench
 * runs on out on all three bearings with the water in it.
 *
 * **It stays ONE rect for the reason Hollowmere's bog does, three times
 * over.** A seam between two rects is where the MIRROR changes — each carries
 * its own cube probe, stood at the depth-weighted centroid of its own wet cells
 * — and each arm out in the borderland would have to be seamed to the valley's
 * water straight across the bearing a player looks down as they leave.
 *
 * **What it costs is bed-map resolution, and that was measured**: the bed is
 * \`CONFIG.water.depthTexelsMax\` (512) texels a side however large the rect, so
 * 600 m is a 1.17 m texel. The waterline's POSITION is not in the bed map at
 * all — it is where the terrain MESH crosses the plane, exact at any texel —
 * and the depth the shader reads is smooth over a bank graded at 0.2, so the
 * resampling error came to about a centimetre mean on depths of sixty.
 *
 * **Its probe stands over the confluence** — the depth-weighted centroid of the
 * wet cells is pulled there by the three arms and the basin, which is open
 * water and open sky. It was once inside the manor's great hall, a probe baked
 * from inside a building, which is Cinderhaven's failure: a river mirroring a
 * dark interior returns the same value whichever way a ripple turns.
 *
 * It RUNS, so it says so (\`WaterRect.sound\`): the river is heard from its
 * nearest bank, which is how a player in the forest knows which way it lies.
 */
const water: WaterRect[] = [
%WATER%
];

/**
 * Ground cover, and the thing about it that inverts under a canopy: a closed
 * canopy is the reason the forest floor is bare. Under 90% closure almost no
 * light reaches the ground, and what grows there is litter, roots and the odd
 * fern; the deep undergrowth of a jungle is at the EDGES, in the gaps and along
 * the water, which is exactly where the light is. So the whole valley gets a
 * thin field and the clearings, the banks and the reed beds get a rich one.
 *
 * \`density\` is how LUSH, 0..1 of the quality rung's field, and never a count:
 * the field is drawn around the eye, so a rect's area costs nothing. **Overlap
 * is a density control** — two rects over one patch grow both their fields.
 * Roads and colliders clear themselves (the grass mask refuses a carriageway
 * and a collider's footprint both), and a rect over a channel is a REED BED:
 * ground under a water rect's surface grows a share of the rect's density,
 * taller so it breaks the waterline, and lays no turf.
 */
const grass: GrassRect[] = [
%GRASS%
];

export const GreyfenLayout: MapLayout = {
  placements,
  scatter,
  controlPoints,
  spawns,
  water,
  grass,
  /**
   * **No wall.** The valley is not closed by anything you can walk up to: the
   * jungle and the river carry on for a hundred and eighty metres past the
   * play square and what stops you is the leash, a countdown rather than a
   * face of rock. See \`Borderland\`, and \`world/leash.ts\` for the rule.
   *
   * **The margin is the HORIZON's, and on this map the horizon is 78 m.** The
   * cel shader's fog is LINEAR between \`fogStart\` and \`fogEnd\`, so a surface
   * reaches exactly \`fogColor\` at \`fogEnd\` and not one metre before it, and
   * ground that stops any nearer arrives on screen at some fraction of its own
   * colour against a sky dome painted flat \`fogColor\` below the horizon — a
   * green line drawn round the world. So the edge has to be \`fogEnd\` from the
   * furthest an EYE gets: the play edge plus the leash's 69 m is 147, the death
   * cam's own orbit stands 3.4 m further out and a blast can throw that body
   * further still, and 180 is that rounded up. It is the same 180 Hollowmere
   * buys for the same \`fogEnd\`: what a margin has to beat is the FOG and
   * nothing about the map.
   *
   * **\`roll\` is 1.2, and it is the one number on this map the RIVER sets.**
   * Everywhere else a borderland's swell is chosen for shape; here it is
   * bounded. \`TerrainField\` continues the floor by clamping its edge row
   * outward, so the Y's three mouths extrude straight out of the map as
   * channels of their own cross-section — and then \`borderRoll\` is ADDED on
   * top, swinging ±roll/2. Each mouth's bed sits 0.82 m under the water plane
   * (the generator cuts all three to -1.34 against a surface at -0.52); at the
   * default 2.6 the roll lifts a bed 1.3 and the river runs dry inside the
   * readable band, and at 1.2 the worst place on the worst arm still holds
   * 0.22 m — a riffle, not a gravel bar. The valley's relief is all inside the
   * square, and what closes this horizon was never going to be a swell: it is
   * the canopy.
   *
   * **\`ease\` is stated at 30 for Hollowmere's reason.** A third of 180 is 60,
   * inside the leash's 69 — but on a map whose FOG is nearer than its leash the
   * borderland anybody ever sees is 78 m deep, so a 60 m ramp spends four
   * fifths of it flattening the swell into a radial smear of the map's own
   * edge. The number to beat is whichever of the leash and \`fogEnd\` is
   * SHORTER. The steepest gradient the roll can then add is
   * \`(roll / 2) * (0.026 + 1.5 / ease)\` = 0.046, against a
   * \`MAX_WALKABLE_GRADE\` of 0.4: a player being run out of the map is never
   * stopped by the ground on the way.
   *
   * **What stands out there is the forest, and it does not stop at the
   * square** — the scatter array's last block is that country and carries the
   * argument in full, including why it gives up the bare collar and what it
   * spends instead.
   */
  borderland: { margin: 180, roll: 1.2, ease: 30 },
  /**
   * **No rim at all.** The valley ends in more valley, and what closes the
   * horizon is the fog rather than a landform. \`Ridge.ts\` states the one
   * condition on taking \`form: "none"\`: a map may only draw nothing over its
   * own boundary if it has already laid something out there that reaches past
   * \`fogEnd\` on every bearing, because the sky dome is flat \`fogColor\` below
   * the horizon. This map pays it with the 180 m above, so the two fields are
   * one decision, and shrinking that margin without putting a landform back is
   * the thing not to do here. A crag ringing a jungle valley was the one
   * landform a drowned tropical basin has no business having, and it cut the
   * three river mouths off dead at the boundary.
   *
   * \`EnvironmentSpec.ridgeColor\` and \`ridgeScreeColor\` are still set and are
   * read by nothing on this map; they stay because they are required fields.
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
