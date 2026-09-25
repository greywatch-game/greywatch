/**
 * generate-kurenai.mjs — SEEDS Kurenai, the temple valley: writes
 * `src/world/kurenai/{layout,heights}.ts`.
 *
 * Run with `npm run kurenai`, and owe `npm run collision -- kurenai` after it.
 * Committed output, like every `heights.ts` and every collision bake, and
 * re-running it with the tree unchanged must produce the same bytes.
 *
 * Three flags for iterating on it: `--probe` prints the floor as a plan and
 * writes nothing, `--plan` prints the claim list as a plan, and `--refusals`
 * lists every plot that was refused and what refused it.
 *
 * ## Why it is seeded, on Sarab's precedent
 *
 * The floor is a function — a river meandering through a 240 m square, two
 * hills, five terraces levelled into them — and the dressing is a few hundred
 * maples whose only interesting property is that none of them stands in the
 * river, on a road or through a roof. So the DESIGN is authored here — the
 * flags, the town's streets, every set piece, the recipe the woods are sown
 * from — and the TRANSCRIPTION is mechanical. The output is an ordinary layout
 * file the editor opens, patches and saves; re-running this discards those
 * edits.
 *
 * ## Why it is 240 m and not 750
 *
 * It was first built at 750 m with vehicles and twenty a side, and it read as
 * sparse and ran slowly for one reason: the same few hundred buildings spread
 * over 56 hectares (6 placements a hectare, against Hollowmere's 34), under a
 * 620 m fog that put nearly all of it — and 2,400 maples of thirty-odd leaf
 * plates each — in front of the camera every frame. Density and frame cost
 * both scale with AREA, so the map that fixes one fixes the other: the same
 * kit on Hollowmere's footprint, infantry only, eight a side.
 *
 * ## What lives here rather than in the layout's own header
 *
 * - **The floor is five passes, in order**: rolling ground; two hills (the
 *   temple's in the north-west corner, the shrine's in the south-east);
 *   every district flattened toward its own level by a weighted AVERAGE
 *   (Sarab's `land`, and for its reason — a sequence lets a later district
 *   lift an earlier one's core); the river's corridor flattened to the valley
 *   floor; and the channel, the temple's koi pond and the inn's hot spring cut
 *   last. The gradient of the result is checked against `MAX_WALKABLE_GRADE`
 *   and the script REFUSES to write a floor it cannot walk.
 * - **Nothing overlaps anything**, by the claim list Sarab's generator uses,
 *   and **nothing is built on a slope**: `place` samples the floor at the
 *   footprint's corners and refuses a plot that falls more than `FLAT` across
 *   it, because a placement samples the ground ONCE at its centre and a house
 *   on a grade floats at one corner.
 * - **The woods are sown against the finished floor.** A grove is a small
 *   scatter disc whose whole footprint was checked dry, clear of every claim
 *   but a road (a road already refuses what grows, `world/roads.ts`) and under
 *   a gradient a tree can stand on — because `MapBuilder.scatterRegion` knows
 *   nothing about water and will plant a maple in the middle of a river.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = join(root, "src", "world", "kurenai");

// --- the extent --------------------------------------------------------------

/** The PLAY square. */
const PLAY = 240;
/** Ground past it — the horizon's floor; see the layout's `borderland` note. */
const MARGIN = 100;
/** Metres per heightfield cell. `CELLS * CELL` must equal `PLAY`. */
const CELL = 3;
const CELLS = PLAY / CELL;
const HALF = PLAY / 2;
const MAX_GRADE = 0.4;
/** The merge block's side — see the layout's `blockSize` note. */
const BLOCK = 120;
/**
 * How far the floor may fall across a building's footprint before the plot is
 * refused. A plinth is 0.25-0.55 m; this is what it hides.
 */
const FLAT = 0.4;

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
const rng = mulberry32(0x4b555245);
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
 * The hills. The temple's stands in the north-west corner behind the
 * precinct's terrace, the shrine's in the south-east with the shrine on a
 * terrace on its flank. The home yards are in the other two corners, low.
 *
 * Peak over radius is the steepest the bell makes: 13 over 70 is 0.29.
 */
const HILLS = [
  { x: -130, z: 130, peak: 9, r: 66 },
  { x: 118, z: -118, peak: 10, r: 64 },
];

/** Rolling ground and the hills, before anything is levelled. */
function natural(x, z) {
  let h = 1.4 * vnoise(x, z, 120, 11) + 0.5 * vnoise(x, z, 48, 12) + 0.2 * vnoise(x, z, 19, 13);
  for (const k of HILLS) h += k.peak * bell(Math.hypot(x - k.x, z - k.z), k.r);
  return h;
}

// The river: a centreline, and the channel cut to a constant bed along it so
// ONE flat water rect is wet along its whole run (Harrowmead's mill stream).
const zr = (x) => -6 + 6 * Math.sin((x + 20) / 38);
const zrSlope = (x) => (6 / 38) * Math.cos((x + 20) / 38);
/** Perpendicular distance to the river's centreline, near enough. */
const riverDist = (x, z) => Math.abs(z - zr(x)) / Math.sqrt(1 + zrSlope(x) ** 2);
/** Flat bed half-width, and where the bank reaches the valley floor. */
const RIVER_BED = 3;
const RIVER_LIP = 9;
const RIVER_DEPTH = 1.2;
/** The river's surface. The bed is 0.7 m under it. */
const RIVER_Y = -0.5;
/** The flat valley floor either side of it, and its skirt. */
const CORRIDOR = 14;
const CORRIDOR_SKIRT = 16;

/**
 * The places that have to be LEVEL: every flag's precinct, the town, the home
 * yards and the farm. `level` is what the ground reads inside the core,
 * `skirt` how far it takes to get back to the hills.
 */
const DISTRICTS = [
  // C — the town, both banks.
  { name: "town", x: 0, z: 18, hw: 30, hd: 70, level: 0, skirt: 14 },
  // A — the temple precinct, a terrace in front of its hill.
  { name: "temple", x: -73, z: 77, hw: 33, hd: 31, level: 3, skirt: 26 },
  // B — the brewery.
  { name: "brewery", x: -72, z: -66, hw: 34, hd: 24, level: 0.5, skirt: 20 },
  // D — the shrine, on a terrace up the hill's flank.
  { name: "shrine", x: 72, z: -86, hw: 20, hd: 18, level: 5, skirt: 30 },
  // E — the inn.
  { name: "inn", x: 72, z: 80, hw: 32, hd: 26, level: 1, skirt: 20 },
  { name: "home sw", x: -102, z: -102, hw: 14, hd: 14, level: 0.5, skirt: 18 },
  { name: "home ne", x: 102, z: 102, hw: 14, hd: 14, level: 1, skirt: 18 },
];

/** The one farmstead, between the brewery and the shrine. */
const FARM = { x: 0, z: -96 };
DISTRICTS.push({
  name: "farm",
  x: FARM.x,
  z: FARM.z,
  hw: 18,
  hd: 12,
  level: Math.round(natural(FARM.x, FARM.z) * 4) / 4,
  skirt: 18,
});

function rectDist(x, z, r) {
  const dx = Math.max(Math.abs(x - r.x) - r.hw, 0);
  const dz = Math.max(Math.abs(z - r.z) - r.hd, 0);
  return Math.hypot(dx, dz);
}

/** The ground before any cut: hills levelled toward every district, averaged. */
function land(x, z) {
  const base = natural(x, z);
  let wsum = 0;
  let hsum = 0;
  for (const d of DISTRICTS) {
    const w = 1 - smooth(rectDist(x, z, d) / d.skirt);
    if (w <= 0) continue;
    wsum += w;
    hsum += w * d.level;
  }
  // The river's corridor is a district too, of a strange shape.
  const wc = 1 - smooth((riverDist(x, z) - CORRIDOR) / CORRIDOR_SKIRT);
  if (wc > 0) {
    wsum += wc;
    hsum += 0;
  }
  if (wsum <= 0) return base;
  return base + (hsum / wsum - base) * Math.min(1, wsum);
}

/** An elliptical basin: `depth` down inside, easing out over `skirt`. */
function basinCut(x, z, b) {
  const e = Math.hypot((x - b.x) / b.rx, (z - b.z) / b.rz);
  const r = Math.min(b.rx, b.rz);
  const d = (e - 1) * r;
  if (d >= b.skirt) return 0;
  if (d <= 0) return b.depth;
  return b.depth * (1 - smooth(d / b.skirt));
}

/** The temple's koi pond and the inn's hot spring, each with its surface level. */
const POND = { x: -52.5, z: 94, rx: 4, rz: 3, skirt: 6, depth: 1.5, level: 3 };
const ONSEN = { x: 44, z: 92, rx: 4, rz: 3, skirt: 6, depth: 1.5, level: 1 };
/** Ground a basin's claim covers: the water and its skirt. */
const basinW = (b) => b.rx * 2 + b.skirt * 2;
const basinD = (b) => b.rz * 2 + b.skirt * 2;

/**
 * How far past its claim (`basinW` x `basinD`) a basin's ground is held at its
 * `level`, and how far it then takes to ease back to the land. A BOX and not
 * the basin's ellipse, because what has to be dry is the water's RECT and its
 * corners: the rect is the wet box plus `waterRect`'s margin, and it is judged
 * on 3 m cells, so a vertex out on the ease drags the rect's edge under.
 * `waterRect` throws if this is too tight; the ease is what the walkable
 * gradient check holds it to.
 */
const BASIN_RIM = 2;
const BASIN_RIM_EASE = 5;

/**
 * The ground a basin is dug INTO: never below the basin's `level` out to the
 * rim. **A basin has to be dug into level ground or its water has no edge** —
 * both of these sit at the lip of their district's terrace, where the land
 * falls toward the town, and a surface 0.3 m under `level` was over the town
 * side's skirt as well as over the basin: the hot spring ran out west into the
 * garden and the koi pond stood a second sheet outside the precinct wall. Only
 * ever LIFTS, so inside a district already at `level` it changes nothing.
 */
function basinRim(h, x, z, b) {
  if (h >= b.level) return h;
  const box = { x: b.x, z: b.z, hw: basinW(b) / 2 + BASIN_RIM, hd: basinD(b) / 2 + BASIN_RIM };
  const d = rectDist(x, z, box);
  if (d >= BASIN_RIM_EASE) return h;
  const w = d <= 0 ? 1 : 1 - smooth(d / BASIN_RIM_EASE);
  return h + (b.level - h) * w;
}

function heightAt(x, z) {
  let h = land(x, z);
  const rd = riverDist(x, z);
  if (rd < RIVER_LIP) {
    const bed = -RIVER_DEPTH;
    const w = rd <= RIVER_BED ? 1 : 1 - smooth((rd - RIVER_BED) / (RIVER_LIP - RIVER_BED));
    h += (bed - h) * w;
  }
  h = basinRim(basinRim(h, x, z, POND), x, z, ONSEN);
  return h - basinCut(x, z, POND) - basinCut(x, z, ONSEN);
}

/**
 * The floor as the GAME has it: `heightAt` at the four surrounding vertices,
 * rounded as the heightfield is written, and blended bilinearly between them.
 * Inside the play square only — the vertex grid does not reach the margin.
 */
function floorAt(x, z) {
  const fx = Math.max(0, Math.min(CELLS - 1e-9, (x + HALF) / CELL));
  const fz = Math.max(0, Math.min(CELLS - 1e-9, (z + HALF) / CELL));
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const tx = fx - i;
  const tz = fz - j;
  const v = (a, c) => Math.round(heightAt(-HALF + a * CELL, -HALF + c * CELL) * 100) / 100;
  return (
    (v(i, j) * (1 - tx) + v(i + 1, j) * tx) * (1 - tz) +
    (v(i, j + 1) * (1 - tx) + v(i + 1, j + 1) * tx) * tz
  );
}

/** The steeper of the two axial slopes at a point. */
function grade(x, z) {
  const e = 2;
  return Math.max(
    Math.abs(heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e),
    Math.abs(heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e),
  );
}

/** True where the floor is under any water body's surface (plus a margin). */
function wet(x, z, margin = 0.25) {
  if (riverDist(x, z) < RIVER_LIP + 1 && heightAt(x, z) < RIVER_Y + margin) return true;
  for (const b of [POND, ONSEN]) {
    if (Math.hypot((x - b.x) / (b.rx + b.skirt), (z - b.z) / (b.rz + b.skirt)) < 1) {
      return true;
    }
  }
  return false;
}

// `--probe` prints the floor as a plan, one height every 8 m, and writes
// nothing: how the terraces meet the town is the thing that needs looking at.
if (process.argv.includes("--probe")) {
  const step = 8;
  const cols = [];
  for (let x = -HALF; x <= HALF; x += step) cols.push(String(x).padStart(5));
  console.log("  z|x " + cols.join(""));
  for (let z = HALF; z >= -HALF; z -= step) {
    let line = String(z).padStart(5) + " ";
    for (let x = -HALF; x <= HALF; x += step) {
      const g = grade(x, z);
      line += (heightAt(x, z).toFixed(1) + (g > 0.3 ? "!" : " ")).padStart(5);
    }
    console.log(line);
  }
  process.exit(0);
}

// --- what is already there ---------------------------------------------------

/**
 * Everything that has claimed ground, as axis-aligned rectangles. `type` is
 * "solid" for a building, "road" for a carriageway (which refuses a building
 * and nothing that grows, since a road already does that itself) and "low"
 * for a flag ring, a spawn or a basin — which refuse everything.
 */
const claimed = [];
const refused = [];

function overlaps(x0, x1, z0, z1, skip) {
  for (const c of claimed) {
    if (skip && skip(c)) continue;
    if (x1 > c.x0 && x0 < c.x1 && z1 > c.z0 && z0 < c.z1) return true;
  }
  return false;
}

function free(x, z, w, d, pad = 1.2) {
  const x0 = x - w / 2 - pad;
  const x1 = x + w / 2 + pad;
  const z0 = z - d / 2 - pad;
  const z1 = z + d / 2 + pad;
  if (Math.max(Math.abs(x0), Math.abs(x1)) > HALF - 6) return false;
  if (Math.max(Math.abs(z0), Math.abs(z1)) > HALF - 6) return false;
  return !overlaps(x0, x1, z0, z1);
}

function claim(x, z, w, d, pad = 0, type = "solid") {
  claimed.push({
    x0: x - w / 2 - pad,
    x1: x + w / 2 + pad,
    z0: z - d / 2 - pad,
    z1: z + d / 2 + pad,
    type,
  });
}

/** How far the floor falls across a footprint, from its centre's own height. */
function relief(x, z, w, d) {
  const h0 = heightAt(x, z);
  let worst = 0;
  for (const fx of [-0.5, 0, 0.5]) {
    for (const fz of [-0.5, 0, 0.5]) {
      worst = Math.max(worst, Math.abs(heightAt(x + fx * w, z + fz * d) - h0));
    }
  }
  return worst;
}

// --- the placement list ------------------------------------------------------

const placements = [];
const scatter = [];

const n2 = (v) => (Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2))));
const TURN = ["", ", rotY: Math.PI / 2", ", rotY: Math.PI", ", rotY: -Math.PI / 2"];

/**
 * Turn 0 faces SOUTH (a builder's front is its local -Z), 1 faces WEST, 2
 * NORTH and 3 EAST — `rotY` of π/2 takes local -Z to world -X.
 */
const FACES = { south: 0, west: 1, north: 2, east: 3 };

function paramText(params) {
  if (!params) return "";
  return Object.entries(params)
    .map(([k, v]) => {
      const lit = typeof v === "string" ? `"${v}"` : typeof v === "boolean" ? String(v) : n2(v);
      return `${k}: ${lit}`;
    })
    .join(", ");
}

/**
 * Emit one placement, claiming its footprint first. `w` and `d` are the
 * builder's local extents; an odd turn swaps them. Refused on a claim and on
 * a slope (`FLAT`) unless forced.
 */
function place(kind, x, z, turn, w, d, params, opts = {}) {
  const fw = turn % 2 === 0 ? w : d;
  const fd = turn % 2 === 0 ? d : w;
  const pad = opts.pad ?? 1.2;
  if (!opts.force) {
    if (!free(x, z, fw, fd, pad)) {
      const hit = claimed.find((c) => x + fw / 2 + pad > c.x0 && x - fw / 2 - pad < c.x1 && z + fd / 2 + pad > c.z0 && z - fd / 2 - pad < c.z1);
      const by = hit ? ` by a ${hit.type} claim x ${hit.x0.toFixed(1)}..${hit.x1.toFixed(1)} z ${hit.z0.toFixed(1)}..${hit.z1.toFixed(1)}` : " at the edge";
      refused.push(`${kind} at (${x.toFixed(0)}, ${z.toFixed(0)}) claim${by}`);
      return false;
    }
    if (!opts.anySlope && relief(x, z, fw, fd) > (opts.flat ?? FLAT)) {
      refused.push(`${kind} at (${x.toFixed(0)}, ${z.toFixed(0)}) slope`);
      return false;
    }
    if (!opts.wetOk && (wet(x, z) || wet(x - fw / 2, z - fd / 2) || wet(x + fw / 2, z + fd / 2) ||
        wet(x - fw / 2, z + fd / 2) || wet(x + fw / 2, z - fd / 2))) {
      refused.push(`${kind} at (${x.toFixed(0)}, ${z.toFixed(0)}) wet`);
      return false;
    }
  }
  if (!opts.noClaim) claim(x, z, fw, fd, 0, opts.type ?? "solid");
  const ps = paramText(params);
  const y = opts.y !== undefined ? `, y: ${n2(opts.y)}` : "";
  placements.push(
    `  { kind: "${kind}", x: ${n2(x)}, z: ${n2(z)}${y}${TURN[turn]}` +
      (ps ? `, params: { ${ps} }` : "") +
      " },",
  );
  return true;
}

/** A named set piece: place it, and refuse to write the map if it did not fit. */
function must(kind, x, z, turn, w, d, params, opts = {}) {
  if (place(kind, x, z, turn, w, d, params, opts)) return;
  throw new Error(
    `set piece: ${kind} at (${x.toFixed(0)}, ${z.toFixed(0)}) was refused — ` +
      refused[refused.length - 1] +
      ". Move the piece; the claim list is in authored order and the flags, " +
      "spawns and basins claim first.",
  );
}

function section(list, title) {
  const bar = "=".repeat(Math.max(4, 74 - title.length));
  list.push(`  // ===== ${title} ${bar}`);
}

// --- the flags and the homes -------------------------------------------------

const FLAGS = [
  { id: "A", name: "Koyo-ji Temple", x: -74, z: 72, r: 13 },
  { id: "B", name: "The Sake Brewery", x: -72, z: -66, r: 13 },
  { id: "C", name: "Hashimoto", x: 0, z: 28, r: 13 },
  { id: "D", name: "Inari Shrine", x: 72, z: -80, r: 12 },
  { id: "E", name: "The Hot Spring Inn", x: 72, z: 66, r: 13 },
];
const byId = Object.fromEntries(FLAGS.map((f) => [f.id, f]));

/** `s` points from the yard toward the middle of the map. */
const HOMES = [
  { team: 0, x: -104, z: -104, s: 1, yaw: "Math.PI / 4" },
  { team: 1, x: 104, z: 104, s: -1, yaw: "-Math.PI * 0.75" },
];

// --- the roads, first, because everything else dodges them -------------------

section(placements, "roads");
placements.push(
  "  // Visual only: a road carries no collider, stops no round and is in no",
  "  // baked structure. The town's streets are COBBLE — the reference frame's",
  "  // stone path is exactly this texture — and everything that leaves the",
  "  // town is a dirt lane. No road crosses the river: the bridges do, and",
  "  // anybody fords it anywhere, the banks being a gentle grade the whole run.",
);

/** An axis-aligned rectangle road. */
function rectRoad(x, z, turn, len, w, surface) {
  const fw = turn % 2 === 0 ? w : len;
  const fd = turn % 2 === 0 ? len : w;
  claim(x, z, fw, fd, 1.0, "road");
  placements.push(
    `  { kind: "road", x: ${n2(x)}, z: ${n2(z)}${TURN[turn]}, ` +
      `params: { length: ${n2(len)}, width: ${n2(w)}, surface: "${surface}" } },`,
  );
}

/**
 * A path road through world points. Claimed as small squares along its
 * centreline, which is what an axis-aligned claim list can say about a
 * diagonal — and the bend cuts corners by at most `ROAD_BEND_CUT`.
 */
function pathRoad(points, w, surface) {
  const xs = points.map((p) => p[0]);
  const zs = points.map((p) => p[1]);
  const cx = Number(((Math.min(...xs) + Math.max(...xs)) / 2).toFixed(2));
  const cz = Number(((Math.min(...zs) + Math.max(...zs)) / 2).toFixed(2));
  for (let i = 0; i + 1 < points.length; i++) {
    const [ax, az] = points[i];
    const [bx, bz] = points[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(len / 3));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      claim(ax + (bx - ax) * t, az + (bz - az) * t, w, w, 0.6, "road");
    }
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      if (wet(ax + (bx - ax) * t, az + (bz - az) * t, 0.05)) {
        throw new Error(`road: a ${surface} lane runs into water near (${ax}, ${az})`);
      }
    }
  }
  const local = points.map((p) => `[${n2(Number((p[0] - cx).toFixed(2)))}, ${n2(Number((p[1] - cz).toFixed(2)))}]`);
  placements.push(
    `  { kind: "road", x: ${n2(cx)}, z: ${n2(cz)}, ` +
      `params: { path: [${local.join(", ")}], width: ${n2(w)}, surface: "${surface}" } },`,
  );
}

// The bridges' landings, which the roads run to. The plank bridges stand on
// the straight lines between the flags either side of the water.
const BRIDGE_C = { x: 0, span: 18 };
const BRIDGE_W = { x: -72, span: 22 };
const BRIDGE_E = { x: 72, span: 22 };
/** Where an arch bridge's ramps meet the bank (`buildArchBridge`: 2.3 / 0.3). */
const ARCH_REACH = BRIDGE_C.span / 2 + (1.7 + 0.6) / 0.3;
const zC = zr(BRIDGE_C.x);
const zW = zr(BRIDGE_W.x);
const zE = zr(BRIDGE_E.x);

/** The plaza, north of the arch bridge's foot. */
const PLAZA = { z0: zC + ARCH_REACH + 0.5, z1: 42, hw: 16 };
/** The town's two east-west streets north of the plaza. */
const MIDDLE_Z = 58;
const CROSS_Z = 84;
/** The south lane, the south bank's one street. */
const SOUTH_Z = -52;

// The main street, both banks, stopping at the arch bridge's feet; north of
// the plaza it runs on to the cross street.
{
  const southEnd = zC - ARCH_REACH - 0.5;
  rectRoad(0, (SOUTH_Z - 3 + southEnd) / 2, 0, southEnd - SOUTH_Z + 3, 7, "cobble");
  rectRoad(0, (PLAZA.z1 + CROSS_Z) / 2, 0, CROSS_Z - PLAZA.z1, 7, "cobble");
}
// The plaza: paved, with the flag in it.
rectRoad(0, (PLAZA.z0 + PLAZA.z1) / 2, 1, PLAZA.hw * 2, PLAZA.z1 - PLAZA.z0, "cobble");
// The middle street and the cross street.
rectRoad(0, MIDDLE_Z, 1, 66, 6, "cobble");
rectRoad(0, CROSS_Z, 1, 70, 7, "cobble");

// The lanes out of town. Where a lane's end meets another's the network
// paves the junction (`world/roadPaths.ts`), so ends are stated to meet.
const TEMPLE_FOOT = [-72, 36];
const INN_FOOT = [62, 50];
pathRoad([[-16, 32], [-34, 33], [-54, 35], TEMPLE_FOOT], 6, "dirt"); // to the temple
pathRoad([[16, 32], [34, 35], [50, 42], INN_FOOT], 6, "dirt"); // to the inn
// The west bridge's two lanes: the temple's foot to the brewery's yard.
pathRoad([[BRIDGE_W.x, zW + BRIDGE_W.span / 2 + 1], [-73, 18], TEMPLE_FOOT], 5, "dirt");
pathRoad([[BRIDGE_W.x, zW - BRIDGE_W.span / 2 - 1], [-72, -40], [-72, -50]], 5, "dirt");
// The east bridge's north lane, to the inn's; its south end is the sando.
pathRoad([[BRIDGE_E.x, zE + BRIDGE_E.span / 2 + 1], [71, 30], INN_FOOT], 5, "dirt");
// The south lane: from the brewery's gate along the town's south edge to the
// foot of the shrine's stair.
const BREWERY_GATE = [-38, -58];
pathRoad([BREWERY_GATE, [-30, SOUTH_Z], [30, SOUTH_Z], [52, -46], [66, -44]], 6, "dirt");
// The home yards' lanes.
pathRoad([[-94, -98], [-44, -96], [-34, -80], BREWERY_GATE], 6, "dirt");
pathRoad([[96, 96], [90, 80], [80, 76]], 6, "dirt");
// The farm track.
pathRoad([[0, SOUTH_Z - 3], [0, -86]], 4, "dirt");
// The shrine's approach: a stone sando straight up the hill from the east
// bridge, under the torii.
const SANDO = { x: BRIDGE_E.x, z0: zE - BRIDGE_E.span / 2 - 1, z1: -66 };
rectRoad(SANDO.x, (SANDO.z0 + SANDO.z1) / 2, 0, SANDO.z0 - SANDO.z1, 3.6, "cobble");
// The temple's approach through its gate, and inside the court to the flag.
rectRoad(-74, 44, 0, 12, 5, "cobble");
rectRoad(-74, 55, 0, 8, 4, "cobble");

// The flags, the homes and the basins claim before any building does.
for (const f of FLAGS) claim(f.x, f.z, 24, 24, 0, "low");
for (const b of [POND, ONSEN]) claim(b.x, b.z, basinW(b), basinD(b), 0, "low");

const spawns = [];
for (const h of HOMES) {
  for (let i = 0; i < 3; i++) {
    const x = h.x + h.s * (i * 6 - 2);
    const z = h.z + h.s * (10 - i * 6);
    claim(x, z, 7, 7, 0, "low");
    spawns.push(
      `  { team: ${h.team}, pos: new Vector3(${n2(x)}, ` +
        `${n2(Number(heightAt(x, z).toFixed(2)))}, ${n2(z)}), yaw: ${h.yaw} },`,
    );
  }
}

// --- A — Koyo-ji, the temple ---------------------------------------------------

section(placements, "A: Koyo-ji Temple");
{
  const cx = -74;
  const gateZ = 50;
  // The gate on the precinct's south wall, the torii before it on the lane.
  must("torii", cx, 40, 0, 9, 1, { width: 4.8, height: 6 }, { force: true });
  must("templeGate", cx, gateZ, 0, 10, 4.4, null, { force: true });
  // The precinct wall: south either side of the gate, and round the other
  // three sides with a way through on each.
  const west = -106;
  const east = -41;
  const W = east - west;
  const north = 108;
  const D = north - gateZ;
  // One run: CLAIMED along [from, to] and DRAWN along [drawFrom, drawTo].
  // **The two differ only where a run meets the gate or a corner**, and there
  // the drawing has to go further than the claim: a run that stops where its
  // neighbour's claim starts leaves a slit a round and a look go through (the
  // gate's collider is 9.4 m wide against the 10 m it claims, and a side run
  // stopping at the end wall's claim left 0.6 m at every corner). The ground
  // it reaches into is its neighbour's claim, so nothing else can stand there;
  // the claims are the ones the precinct always made, so the rest of the
  // seeded layout is unmoved.
  const wall = (turn, at, from, to, drawFrom = from, drawTo = to) => {
    const span = (a, b) => (turn === 0 ? [(a + b) / 2, at] : [at, (a + b) / 2]);
    const foot = (len) => (turn === 0 ? [len, 1] : [1, len]);
    // Claimed a hair short, so two runs laid end to end do not collide in
    // the last bit of a float.
    const [x, z] = span(from, to);
    const [fw, fd] = foot(to - from - 0.05);
    const [dx, dz] = span(drawFrom, drawTo);
    const [dw, dd] = foot(drawTo - drawFrom);
    const len = drawTo - drawFrom;
    if (!free(x, z, fw, fd, 0) || relief(dx, dz, dw, dd) > 0.5 || wet(dx, dz)) {
      throw new Error(`set piece: the precinct wall at (${dx.toFixed(0)}, ${dz.toFixed(0)}) does not fit`);
    }
    claim(x, z, fw, fd, 0, "solid");
    place("gardenWall", dx, dz, turn, len, 1, { length: Number(len.toFixed(2)) }, { force: true, noClaim: true });
  };
  // What the claims leave clear of the gate, and what the gate's own collider
  // reaches: its wings end at half its width (`buildTempleGate`, 4.6 + 2 x 2.4).
  const gateClear = 5.2;
  const gateWing = 4.7;
  // Half a wall's collider (`buildGardenWall`), which a side run reaches past
  // an end wall's line to meet its outer face.
  const wallHalf = 0.4;
  {
    const wRun = (cx - gateClear - west) / 2;
    const eRun = (east - cx - gateClear) / 2;
    wall(0, gateZ, cx - gateClear - wRun, cx - gateClear, cx - gateClear - wRun, cx - gateWing);
    wall(0, gateZ, west, cx - gateClear - wRun);
    wall(0, gateZ, cx + gateClear, cx + gateClear + eRun, cx + gateWing, cx + gateClear + eRun);
    wall(0, gateZ, cx + gateClear + eRun, east);
  }
  for (const x of [west, east]) {
    // Two runs a side with a 6 m gap between them.
    const run = (D - 6) / 2;
    wall(1, x, gateZ + 1, gateZ + run, gateZ - wallHalf, gateZ + run);
    wall(1, x, north - run, north - 1, north - run, north + wallHalf);
  }
  {
    const run = (W - 6) / 2;
    wall(0, north, west, west + run);
    wall(0, north, east - run, east);
  }
  // The hall at the back of the court, facing the gate.
  must("templeHall", cx, 96, 0, 19.2, 15.2, { width: 16, depth: 12, litWindows: true }, { pad: 0.5 });
  // The pagoda on the west side of the court, the bell on the east.
  must("pagoda", -96, 70, 0, 10.6, 10.6, null, { pad: 0.5 });
  must("bellTower", -52, 62, 0, 5.2, 5.2, null, { pad: 0.5 });
  // The garden by the pond, with its own stone pagoda and lanterns.
  must("stonePagoda", -57, 79, 0, 1.6, 1.6, null, { pad: 0.3 });
  must("teahouse", -97, 96, 3, 9.4, 8.4, { width: 7, depth: 6, litWindows: true }, { pad: 0.3 });
  // Lanterns lining the court's path, in pairs.
  for (const z of [55, 58.5]) {
    for (const s of [-1, 1]) {
      place("toro", cx + s * 4.2, z, 0, 1.1, 1.1, { litWindows: true }, { pad: 0.2, flat: 0.3 });
    }
  }
  for (const [x, z] of [[-86, 90], [-62, 90], [-96, 82], [-88, 56], [-60, 56], [-45, 84]]) {
    place("toro", x, z, 0, 1.1, 1.1, { litWindows: true }, { pad: 0.2, flat: 0.3 });
  }
}

// --- B — the brewery -----------------------------------------------------------

section(placements, "B: The Sake Brewery");
{
  const { x: cx, z: cz } = byId.B;
  // The storehouses round the yard: a row on the north with the lane from the
  // bridge coming in through a gap in it, a row on the south.
  for (const dx of [-26, -16, 10, 20]) {
    must("kura", cx + dx, cz + 18, 0, 6.8, 5.6, { width: 6.4, depth: 5.2, height: 5.6 }, { pad: 0.3 });
  }
  for (const dx of [-21, -10, 1, 12]) {
    must("kura", cx + dx, cz - 18, 2, 7.2, 6, { width: 7, depth: 5.6, height: 6.2 }, { pad: 0.3 });
  }
  // The brewer's house on the west, the shop on the east.
  must("minka", cx - 28, cz, 3, 14.6, 10.9, { width: 14, depth: 9, enterable: true, litWindows: true }, { pad: 0.5 });
  must("machiya", cx + 26, cz - 9, 1, 7.2, 11.2, { width: 7, depth: 11, enterable: true, litWindows: true }, { pad: 0.3 });
  place("machiya", cx + 26, cz + 3, 1, 6.6, 11.2, { width: 6.4, depth: 11, litWindows: true }, { pad: 0.3 });
  place("well", cx - 16, cz - 8, 0, 2, 2, null, { pad: 0.3 });
  place("woodpile", cx + 16, cz + 10, 0, 3, 1.5, null, { pad: 0.3 });
  place("cart", cx - 17, cz + 9, 1, 1.8, 3.6, null, { pad: 0.3 });
  place("crates", cx + 15, cz - 11, 0, 2, 2, null, { pad: 0.3 });
  place("crates", cx - 5, cz - 13, 0, 2, 2, null, { pad: 0.3 });
  for (const [x, z] of [[cx - 5, cz + 14], [cx + 5, cz + 14]]) {
    place("toro", x, z, 0, 1.1, 1.1, { litWindows: true }, { pad: 0.2 });
  }
}

// --- C — Hashimoto, the bridge town -----------------------------------------------

section(placements, "C: Hashimoto");
{
  // The arch bridge over the river on the main street, and the two plank
  // bridges up and down stream. Local zero is BANK grade, so each states `y`
  // as minus the bed under its centre.
  must("archBridge", BRIDGE_C.x, zC, 0, 3.6, BRIDGE_C.span + 2 * (ARCH_REACH - BRIDGE_C.span / 2), { length: BRIDGE_C.span, width: 3.2 }, { force: true, y: -heightAt(BRIDGE_C.x, zC) });
  must("bridge", BRIDGE_W.x, zW, 0, 3.6, BRIDGE_W.span, { length: BRIDGE_W.span, width: 3.2 }, { force: true, y: -heightAt(BRIDGE_W.x, zW) });
  must("bridge", BRIDGE_E.x, zE, 0, 3.6, BRIDGE_E.span, { length: BRIDGE_E.span, width: 3.2 }, { force: true, y: -heightAt(BRIDGE_E.x, zE) });
  // The plaza's furniture: a torii at its river side and lanterns at the
  // corners.
  must("torii", 0, PLAZA.z0 + 1.5, 0, 7, 1, { width: 5.4, height: 5.4 }, { force: true });
  for (const [x, z] of [[-14, PLAZA.z0 + 2], [14, PLAZA.z0 + 2], [-14, PLAZA.z1 - 2], [14, PLAZA.z1 - 2]]) {
    must("toro", x, z, 0, 1.1, 1.1, { litWindows: true }, { force: true });
  }
}

// --- D — the Inari shrine ---------------------------------------------------------

section(placements, "D: Inari Shrine");
{
  const { x: cx, z: cz } = byId.D;
  // The shrine hall at the back of the terrace, facing down the sando.
  must("templeHall", cx, cz - 20, 2, 15.2, 12.2, { width: 12, depth: 9, litWindows: true }, { pad: 0.4 });
  // The tunnel of torii: close-set gates up the whole of the stone approach.
  // Each straddles the path across the slope, so both posts stand on one
  // contour whatever the grade is.
  for (let z = SANDO.z0 - 3; z >= SANDO.z1 + 1; z -= 3.2) {
    must("torii", cx, z, 0, 5.6, 0.8, { width: 3.4, height: 4.2 }, { force: true, noClaim: true });
  }
  must("torii", cx, SANDO.z1 - 1.5, 0, 9, 1, { width: 5.2, height: 6.4 }, { force: true });
  for (const [x, z] of [[cx - 6, cz + 9], [cx + 6, cz + 9], [cx - 9, cz - 9], [cx + 9, cz - 9]]) {
    must("toro", x, z, 0, 1.1, 1.1, { litWindows: true }, { force: true });
  }
  place("teahouse", cx + 21, cz - 4, 3, 8.4, 9.4, { width: 7, depth: 6, litWindows: true }, { pad: 0.3 });
  place("stonePagoda", cx - 16, cz - 8, 0, 1.6, 1.6, null, { pad: 0.3 });
  place("kura", cx - 20, cz + 6, 1, 6.8, 5.6, null, { pad: 0.3 });
}

// --- E — the hot spring inn -------------------------------------------------------

section(placements, "E: The Hot Spring Inn");
{
  const { x: cx, z: cz } = byId.E;
  must("minka", cx, cz + 27, 0, 18.6, 12.6, { width: 18, depth: 11, height: 3.2, enterable: true, litWindows: true }, { pad: 0.5 });
  must("teahouse", cx + 22, cz + 2, 1, 10.4, 9.4, { width: 8, depth: 7, litWindows: true, lit: true }, { pad: 0.3 });
  must("teahouse", ONSEN.x, ONSEN.z - 16, 2, 8.4, 8.4, { width: 6, depth: 6, litWindows: true }, { pad: 0.3 });
  place("kura", cx + 32, cz + 20, 0, 6.8, 5.6, null, { pad: 0.3 });
  // The garden wall round the back of the inn.
  must("gardenWall", cx - 2, cz + 38, 0, 30, 1, { length: 30, tint: "#b3aa97" }, { pad: 0, flat: 0.5 });
  for (const [x, z] of [[ONSEN.x + 11, ONSEN.z + 2], [ONSEN.x - 11, ONSEN.z - 2], [cx - 9, cz + 17], [cx + 9, cz + 17]]) {
    place("toro", x, z, 0, 1.1, 1.1, { litWindows: true }, { pad: 0.2 });
  }
}

// --- the town's fabric -----------------------------------------------------------

section(placements, "the town");

/**
 * A row of machiya along a street edge. `face` is the side of the house its
 * street is on; the row runs from `a` to `b` along the edge's own axis, and
 * each house is laid on the frontage line and turned to face its street.
 */
function machiyaRow(edge, a, b, face, opts = {}) {
  const alongX = face === "north" || face === "south";
  let t = Math.min(a, b);
  const end = Math.max(a, b);
  const [dLo, dHi] = opts.depth ?? [10, 13];
  while (t < end) {
    const w = Number(rand(5.8, 7.6).toFixed(1));
    const d = Number(rand(dLo, dHi).toFixed(1));
    const mid = t + w / 2;
    if (mid + w / 2 > end) break;
    // Depth is measured away from the street.
    const back = { south: 1, north: -1, west: 1, east: -1 }[face];
    const off = edge + back * (1.3 + d / 2);
    const [x, z] = alongX ? [mid, off] : [off, mid];
    const turn = FACES[face];
    const params = {
      width: w,
      depth: d,
      ...(chance(0.35) ? { enterable: true } : {}),
      ...(chance(0.55) ? { litWindows: true } : {}),
      ...(chance(0.3) ? { tint: pick(["#8f7552", "#a39478"]) } : {}),
    };
    if (opts.minka && chance(opts.minka)) {
      const mw = Number(rand(10, 13).toFixed(1));
      const md = Number(rand(7, 8.5).toFixed(1));
      const moff = edge + back * (2.5 + md / 2);
      const mmid = t + mw / 2;
      if (mmid + mw / 2 <= end) {
        const [mx, mz] = alongX ? [mmid, moff] : [moff, mmid];
        if (place("minka", mx, mz, turn, mw + 1.3, md + 2.6, { width: mw, depth: md, ...(chance(0.4) ? { enterable: true } : {}), ...(chance(0.5) ? { litWindows: true } : {}) }, { pad: 0.6 })) {
          t += mw + 3;
          continue;
        }
      }
    }
    // Row houses stand shoulder to shoulder: a claim a hair wider than the
    // house and a gap wider than two pads, or every other house is refused.
    if (place("machiya", x, z, turn, w + 0.2, d + 0.2, params, { pad: 0.05 })) {
      t += w + 0.2 + rand(0.15, 0.6);
    } else {
      t += 1;
    }
  }
}

// The riverside rows first — the town's face to the water on both banks, the
// reference frame's lattice fronts over the stream — then the streets.
machiyaRow(13, -44, -9, "south", { depth: [9, 11] });
machiyaRow(13, 9, 40, "south", { depth: [9, 11] });
machiyaRow(-17, -44, -8, "north", { depth: [9, 11] });
machiyaRow(-17, 8, 44, "north", { depth: [9, 11] });
// The plaza's two sides.
machiyaRow(-PLAZA.hw, PLAZA.z0, PLAZA.z1, "east");
machiyaRow(PLAZA.hw, PLAZA.z0, PLAZA.z1, "west");
// The main street, both sides, both banks, in the runs between the streets
// that cross it (each street's claim carries a metre's pad).
for (const [a, b] of [
  [PLAZA.z1 + 1.2, MIDDLE_Z - 4.2],
  [MIDDLE_Z + 4.2, CROSS_Z - 4.7],
  [SOUTH_Z + 3.8, zC - ARCH_REACH - 1],
]) {
  machiyaRow(-3.5, a, b, "east");
  machiyaRow(3.5, a, b, "west");
}
// The middle street and the cross street.
machiyaRow(MIDDLE_Z + 3, -33, 33, "south");
machiyaRow(MIDDLE_Z - 3, -33, 33, "north");
machiyaRow(CROSS_Z + 3.5, -35, 35, "south", { minka: 0.3 });
machiyaRow(CROSS_Z - 3.5, -35, 35, "north");
// The south lane.
machiyaRow(SOUTH_Z + 3, -30, 30, "south");
machiyaRow(SOUTH_Z - 3, -30, 30, "north", { minka: 0.35 });
// Kura in the back plots, where the rows left room.
for (let i = 0; i < 120; i++) {
  const x = rand(-40, 40);
  const z = rand(-66, 100);
  place("kura", Number(x.toFixed(1)), Number(z.toFixed(1)), Math.floor(rng() * 4), 6.8, 5.6, null, { pad: 1.2 });
}
// Lanterns along the riverside walks.
for (let x = -40; x <= 40; x += 10) {
  if (Math.abs(x) < 10) continue;
  place("toro", x, 11.2, 0, 1.1, 1.1, { litWindows: true }, { pad: 0.1, flat: 0.3 });
  place("toro", x, -15.2, 0, 1.1, 1.1, { litWindows: true }, { pad: 0.1, flat: 0.3 });
}

// --- the countryside ---------------------------------------------------------------

section(placements, "the farm");
{
  const { x, z } = FARM;
  must("minka", x - 6, z - 4, 0, 14.6, 11.8, { width: 12, depth: 8, enterable: true, litWindows: true }, { pad: 1 });
  place("kura", x + 12, z - 4, 1, 6.8, 5.6, null, { pad: 1 });
  place("woodpile", x - 16, z + 4, 1, 3, 1.5, null, { pad: 0.5 });
  place("cart", x + 7, z + 7, 0, 1.8, 3.6, null, { pad: 0.5 });
  place("toro", x - 2, z + 8, 0, 1.1, 1.1, { litWindows: true }, { pad: 0.5 });
}
// Two hamlets on the flanks, where the lanes from the plank bridges run up
// past them: a handful of farmhouses and storehouses each, the cover a flank
// route is fought through.
section(placements, "the hamlets");
/** A hamlet: a lattice of plots over a rectangle, each a farmhouse, a storehouse or a yard. */
function hamlet(x0, x1, z0, z1) {
  for (let z = z0; z <= z1; z += 14) {
    for (let x = x0; x <= x1; x += 16) {
      const px = Number((x + rand(-2, 2)).toFixed(1));
      const pz = Number((z + rand(-2, 2)).toFixed(1));
      const turn = Math.floor(rng() * 4);
      const w = Number(rand(10, 12.5).toFixed(1));
      const d = Number(rand(7, 8.5).toFixed(1));
      if (chance(0.6) && place("minka", px, pz, turn, w + 2.6, d + 3.8, { width: w, depth: d, ...(chance(0.5) ? { enterable: true } : {}), ...(chance(0.6) ? { litWindows: true } : {}) }, { pad: 1.2 })) {
        continue;
      }
      if (place("kura", px, pz, turn, 6.8, 5.6, null, { pad: 1.2 })) {
        place(pick(["woodpile", "cart", "crates"]), px + rand(-6, 6), pz + rand(-6, 6), Math.floor(rng() * 4), 3, 3, null, { pad: 0.6 });
      }
    }
  }
}
hamlet(-104, -86, 14, 42);
hamlet(86, 104, 12, 40);
hamlet(-56, -30, -104, -70);
hamlet(-34, 30, 100, 108);

// Wayside torii on the lanes out of town.
for (const [x, z, turn] of [[-40, 33.5, 1], [40, 37, 1]]) {
  place("torii", x, z, turn, 7, 1, { width: 5.4, height: 4.6 }, { force: true, noClaim: true });
}

// The home yards: a storehouse and a farmhouse each, clear of the spawns.
section(placements, "the home yards");
for (const h of HOMES) {
  place("kura", h.x + h.s * 16, h.z - h.s * 6, h.s > 0 ? 3 : 1, 6.8, 5.6, null, { pad: 1 });
  place("woodpile", h.x + h.s * 14, h.z + h.s * 2, 0, 3, 1.5, null, { pad: 0.5 });
}

// --- the woods ----------------------------------------------------------------------

/**
 * Whether a grove of radius `r` may be sown at (x, z): its whole disc dry,
 * clear of every claim that is not a road, and under `maxGrade`.
 */
function groveOk(x, z, r, maxGrade = 0.3, overBuildings = false) {
  if (Math.abs(x) + r > HALF - 3 || Math.abs(z) + r > HALF - 3) return false;
  // A big region may stand over buildings: `findSpot` keeps a trunk out of
  // every collider, and a crown over a roof is a garden. What it may not
  // stand over is a spawn, a basin or a flag's ring.
  const skip = overBuildings ? (c) => c.type !== "low" : (c) => c.type === "road";
  if (overlaps(x - r, x + r, z - r, z + r, skip)) return false;
  const ring = r > 8 ? 16 : 8;
  for (let k = 0; k <= ring; k++) {
    const a = (k / ring) * Math.PI * 2;
    const f = k === ring ? 0 : 1;
    const px = x + f * Math.cos(a) * (r + 1.5);
    const pz = z + f * Math.sin(a) * (r + 1.5);
    if (wet(px, pz, 0.4)) return false;
    if (grade(px, pz) > maxGrade) return false;
  }
  return true;
}

const GROVE = 10;
let trees = 0;
let drifts = 0;

function grove(prop, x, z, r, count, extra = "") {
  scatter.push(
    `  { prop: "${prop}", x: ${n2(Number(x.toFixed(1)))}, z: ${n2(Number(z.toFixed(1)))}, ` +
      `radius: ${n2(r)}, count: ${count}${extra} },`,
  );
}

const MAPLE = ", scale: [1.1, 1.55], blocking: true, clearance: 1.8";
const CEDAR = ", scale: [0.95, 1.4], blocking: true, clearance: 1.3";

/** How wooded a point is meant to be, 0..1 — the hills, the banks, the edges. */
function woodiness(x, z) {
  const h = natural(x, z);
  let w = smooth((h - 2) / 7) * 0.9;
  const rd = riverDist(x, z);
  if (rd > RIVER_LIP + 2 && rd < 22) w = Math.max(w, 0.7);
  // The margins of the square: woods closing the valley in.
  const edge = Math.max(Math.abs(x), Math.abs(z));
  w = Math.max(w, smooth((edge - 88) / 24) * 0.85);
  // A broken field of noise, so the woods come as stands.
  w += 0.3 * vnoise(x, z, 34, 31);
  return Math.max(0, Math.min(1, w));
}

section(scatter, "the precincts");
// The temple court and its gardens: maples round the pond and along the
// walls, where the reference frame's path runs under them.
for (const [x, z, r, n] of [
  [-100, 58, 3, 1], [-100, 84, 4, 2], [-88, 102, 4, 2], [-60, 102, 4, 2],
  [-48, 70, 4, 2], [-84, 58, 3, 1], [-64, 58, 3, 1], [-45, 55, 3, 1],
  [-108, 30, 7, 4], [-88, 30, 6, 3], [-56, 22, 6, 3],
]) {
  if (groveOk(x, z, r, 0.25)) {
    grove("maple", x, z, r, n, MAPLE);
    trees += n;
  }
}
// The sando's flanks, the length of the stair: maples tight to the gates.
for (let z = SANDO.z0 - 4; z > SANDO.z1 + 2; z -= 8) {
  for (const s of [-1, 1]) {
    const x = SANDO.x + s * 7.5;
    if (groveOk(x, z, 4, 0.38)) {
      grove("maple", x, z, 4, 2, MAPLE);
      trees += 2;
    }
  }
}
// The shrine's terrace and the inn's garden.
for (const [x, z, r, n] of [
  [56, -98, 5, 2], [90, -98, 5, 2], [56, -64, 4, 2],
  [52, 78, 4, 2], [92, 84, 4, 2], [58, 104, 4, 2], [86, 104, 4, 2],
]) {
  if (groveOk(x, z, r, 0.25)) {
    grove("maple", x, z, r, n, MAPLE);
    trees += n;
  }
}
// Bamboo behind the inn and the brewery, and on the temple hill's foot.
for (const [x, z] of [[104, 60], [30, 104], [-104, -40], [-40, -100], [-112, 50], [104, -40]]) {
  if (groveOk(x, z, 7)) grove("bamboo", x, z, 7, 5, ", scale: [0.85, 1.15], clearance: 0.9");
}

section(scatter, "the woods");
// A lattice over the whole square, jittered, sown by how wooded each point is
// — and nowhere is bare: the open ground between the flags carries a maple in
// most plots, because the reference frame has no field without a tree. A
// region that fails its checks is tried again smaller, so the woods run up to
// the river and the walls rather than stopping a lattice cell short.
for (let gz = -HALF + 12; gz < HALF - 6; gz += 20) {
  for (let gx = -HALF + 12; gx < HALF - 6; gx += 20) {
    const x = gx + rand(-4, 4);
    const z = gz + rand(-4, 4);
    const w = woodiness(x, z);
    let r = 0;
    for (const tryR of [GROVE, GROVE * 0.6, GROVE * 0.35]) {
      if (groveOk(x, z, tryR, 0.33, true)) {
        r = tryR;
        break;
      }
    }
    if (!r) continue;
    const high = natural(x, z) > 8;
    const cedar = high && chance(0.4);
    // Trees per region by area and by how wooded the point is — and a floor
    // under it, because no field in the reference frame is without a maple.
    const count = Math.max(1, Math.round((0.2 + w * 0.8) * (r * r) / 16));
    grove(cedar ? "pine" : "maple", x, z, r, count, cedar ? CEDAR : MAPLE);
    trees += count;
  }
}

section(scatter, "the fallen leaves");
// Drifts under the trees and along the paths — only where the ground is
// flat enough for a level drift to lie on it (`buildLeafLitter`).
for (let gz = -HALF + 10; gz < HALF - 6; gz += 18) {
  for (let gx = -HALF + 10; gx < HALF - 6; gx += 18) {
    const x = gx + rand(-5, 5);
    const z = gz + rand(-5, 5);
    const w = woodiness(x, z);
    const near = Math.abs(riverDist(x, z) - 14) < 6 || (Math.abs(x) < 40 && z > -60 && z < 95);
    if (!near && rng() > w) continue;
    if (Math.abs(x) + 6 > HALF - 3 || Math.abs(z) + 6 > HALF - 3) continue;
    let ok = true;
    for (let k = 0; k < 9; k++) {
      const px = x + (k === 0 ? 0 : Math.cos(k * 0.785) * 8);
      const pz = z + (k === 0 ? 0 : Math.sin(k * 0.785) * 8);
      if (wet(px, pz, 0.4) || grade(px, pz) > 0.05) ok = false;
    }
    if (!ok) continue;
    grove("leafLitter", x, z, 7, 8, ", scale: [0.9, 1.3], clearance: 0.6");
    drifts += 8;
  }
}
// And on the stone paths the reference frame is made of.
for (const [x, z] of [
  [-74, 44], [-74, 55], [0, 20], [0, 36], [-8, 50], [6, -30], [0, 70],
  [72, -30], [72, -50], [72, 60], [-72, -56],
  // The courts: under the precinct's maples and round the pond.
  [-96, 90], [-90, 58], [-56, 70], [-86, 84], [-60, 86], [-100, 60],
  [60, -92], [86, -70], [58, 80], [88, 76], [-86, -60], [-58, -72],
  [-14, 34], [14, 18], [24, MIDDLE_Z], [-24, CROSS_Z],
]) {
  grove("leafLitter", x, z, 4, 3, ", scale: [0.9, 1.3], clearance: 0.6");
  drifts += 3;
}

section(scatter, "the riverbanks");
// Boulders along the channel, where the water breaks round them.
for (let x = -114; x <= 114; x += 16) {
  const z = zr(x) + (chance(0.5) ? 1 : -1) * rand(4, 7);
  if (Math.abs(x - BRIDGE_C.x) < 20 || Math.abs(x - BRIDGE_W.x) < 12 || Math.abs(x - BRIDGE_E.x) < 12) continue;
  scatter.push(`  { prop: "boulder", x: ${n2(x)}, z: ${n2(Number(z.toFixed(1)))}, radius: 3, count: 2, scale: [0.5, 0.9], blocking: true, clearance: 1.0 },`);
}
// Rocks round the koi pond and the hot spring — the reference frame's pond.
// Each is stood on the WATERLINE, found by marching out from the middle —
// the basin's skirt puts the shore well past its core radius, and a rock
// placed on the radius is a rock under the water.
for (const b of [POND, ONSEN]) {
  const surface = b.level - 0.3;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.3;
    let r = 0;
    while (r < 20 && heightAt(b.x + Math.cos(a) * r, b.z + Math.sin(a) * r) < surface + 0.05) r += 0.25;
    const x = b.x + Math.cos(a) * (r + 0.6);
    const z = b.z + Math.sin(a) * (r + 0.6);
    scatter.push(`  { prop: "boulder", x: ${n2(Number(x.toFixed(1)))}, z: ${n2(Number(z.toFixed(1)))}, radius: 1.2, count: 1, scale: [0.45, 0.75], blocking: true, clearance: 0.4 },`);
  }
}

section(scatter, "the borderland");
// Past the square: non-blocking trees on the ground the leash runs you out
// over, so the woods do not stop at a line. Thickest in the first forty
// metres, which is all of the borderland the haze lets anybody see as trees
// rather than as a tint. Appended LAST — one seeded stream serves the whole
// build in authored order.
for (let k = 0; k < 56; k++) {
  const side = k % 4;
  const along = -HALF - 40 + (Math.floor(k / 4) / 13) * (PLAY + 80);
  const out = HALF + rand(12, 60);
  const [x, z] = [
    [along, out],
    [along, -out],
    [out, along],
    [-out, along],
  ][side];
  if (riverDist(x, z) < 16) continue;
  const prop = natural(x, z) > 8 && chance(0.5) ? "pine" : "maple";
  scatter.push(
    `  { prop: "${prop}", x: ${n2(Number(x.toFixed(1)))}, z: ${n2(Number(z.toFixed(1)))}, radius: 12, count: 5, scale: [0.9, 1.3] },`,
  );
  trees += 5;
}

// --- the water, the grass, the flags and the spawns ----------------------------

/**
 * One water body's rect, measured off the floor: the bounding box of the wet
 * ground CONNECTED to the basin's middle at the stated surface, plus a margin
 * of dry ground for the shoreline to be drawn on. See Sarab's `waterBody`,
 * which carries the argument.
 *
 * **Connected, and then checked**: a water plane is drawn over every point of
 * its rect that is under its surface, so wet ground inside the rect that is
 * not the basin is a second sheet of water, and wet ground the fill reaches at
 * the edge of the search is a basin with no rim. Both throw rather than emit.
 * Measured on the EMITTED floor (`floorAt`), not on `heightAt`: the game draws
 * the water against 3 m cells, and a rim narrower than a cell is not there.
 */
function waterRect(cx, cz, halfW, halfD, y, margin = 6) {
  const step = 0.75;
  const nx = Math.floor((2 * halfW) / step) + 1;
  const nz = Math.floor((2 * halfD) / step) + 1;
  const xAt = (i) => cx - halfW + i * step;
  const zAt = (j) => cz - halfD + j * step;
  const depthAt = (i, j) => y - floorAt(xAt(i), zAt(j));
  const inBody = new Uint8Array(nx * nz);
  const i0 = Math.round(halfW / step);
  const j0 = Math.round(halfD / step);
  if (depthAt(i0, j0) <= 0) {
    throw new Error(`water: the basin at (${cx}, ${cz}) is dry in the middle`);
  }
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  let deepest = 0;
  const stack = [[i0, j0]];
  inBody[j0 * nx + i0] = 1;
  while (stack.length) {
    const [i, j] = stack.pop();
    const x = xAt(i);
    const z = zAt(j);
    deepest = Math.max(deepest, depthAt(i, j));
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    z0 = Math.min(z0, z);
    z1 = Math.max(z1, z);
    for (const [a, c] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
      if (a < 0 || c < 0 || a >= nx || c >= nz) {
        throw new Error(`water: the basin at (${cx}, ${cz}) spills past its search box`);
      }
      if (inBody[c * nx + a] || depthAt(a, c) <= 0) continue;
      inBody[c * nx + a] = 1;
      stack.push([a, c]);
    }
  }
  for (let x = x0 - margin; x <= x1 + margin; x += step / 2) {
    for (let z = z0 - margin; z <= z1 + margin; z += step / 2) {
      if (y - floorAt(x, z) <= 0) continue;
      const i = Math.round((x - cx + halfW) / step);
      const j = Math.round((z - cz + halfD) / step);
      if (i >= 0 && j >= 0 && i < nx && j < nz && inBody[j * nx + i]) continue;
      // A sample between two body cells is the same water at a finer grain.
      let near = false;
      for (let a = i - 1; a <= i + 1 && !near; a++) {
        for (let c = j - 1; c <= j + 1 && !near; c++) {
          near = a >= 0 && c >= 0 && a < nx && c < nz && inBody[c * nx + a] === 1;
        }
      }
      if (!near) {
        throw new Error(
          `water: the rect for the basin at (${cx}, ${cz}) covers other wet ground at (${x.toFixed(1)}, ${z.toFixed(1)})`,
        );
      }
    }
  }
  return {
    x: Number(((x0 + x1) / 2).toFixed(2)),
    z: Number(((z0 + z1) / 2).toFixed(2)),
    width: Number((x1 - x0 + 2 * margin).toFixed(2)),
    depth: Number((z1 - z0 + 2 * margin).toFixed(2)),
    y: Number(y.toFixed(2)),
    deepest: Number(deepest.toFixed(2)),
  };
}

const waterBodies = [];
const water = [];
{
  // The river, one rect the length of the play square and the borderland,
  // so the water runs on out into the hills rather than stopping at a line.
  let lo = Infinity;
  let hi = -Infinity;
  for (let x = -HALF - MARGIN; x <= HALF + MARGIN; x += 2) {
    const zc = zr(Math.max(-HALF, Math.min(HALF, x)));
    lo = Math.min(lo, zc);
    hi = Math.max(hi, zc);
  }
  const z0 = lo - RIVER_LIP - 4;
  const z1 = hi + RIVER_LIP + 4;
  const body = {
    x: 0,
    z: Number(((z0 + z1) / 2).toFixed(2)),
    width: PLAY + 2 * MARGIN,
    depth: Number((z1 - z0).toFixed(2)),
    y: RIVER_Y,
    deepest: RIVER_DEPTH + RIVER_Y,
  };
  waterBodies.push(body);
  water.push(
    "  // The river, one rect the whole run: the channel is cut to one bed so a",
    "  // single level surface is wet along all of it (Harrowmead's stream), and",
    "  // it runs out through the borderland into the hills. A rect this deep is",
    "  // mostly dry bank — the floor decides where the water is, and the rect is",
    "  // only where it may be.",
    `  { x: ${n2(body.x)}, z: ${n2(body.z)}, width: ${n2(body.width)}, depth: ${n2(body.depth)}, y: ${n2(body.y)}, sound: "stream" },`,
  );
}
for (const [b, note] of [
  [POND, "The temple's koi pond, dug into the court beside the hall."],
  [ONSEN, "The inn's hot spring, dug into its garden."],
]) {
  const y = b.level - 0.3;
  const body = waterRect(b.x, b.z, b.rx + b.skirt + 3, b.rz + b.skirt + 3, y, 3);
  if (body.deepest < 1.0) {
    throw new Error(`water: the basin at (${b.x}, ${b.z}) is only ${body.deepest} m deep`);
  }
  waterBodies.push(body);
  water.push(
    `  // ${note}`,
    `  { x: ${n2(body.x)}, z: ${n2(body.z)}, width: ${n2(body.width)}, depth: ${n2(body.depth)}, y: ${n2(body.y)} },`,
  );
}

const grass = [
  "  // Autumn grass: gold-tipped, and a BUDGET rather than a blanket (the",
  "  // field is one mesh of thin instances with no culling inside it). What it",
  "  // is for is the ground that is not wood or town — the meadows between the",
  "  // flags, the riverbanks and the courts' margins.",
];
{
  let tufts = 0;
  for (let gz = -HALF + 20; gz < HALF - 10; gz += 36) {
    for (let gx = -HALF + 20; gx < HALF - 10; gx += 36) {
      const x = gx + rand(-6, 6);
      const z = gz + rand(-6, 6);
      if (Math.abs(x) < 40 && z > -64 && z < 98) continue;
      const w = woodiness(x, z);
      if (w > 0.75 || chance(0.3)) continue;
      const density = Number(rand(0.14, 0.22).toFixed(2));
      grass.push(`  { x: ${n2(Number(x.toFixed(1)))}, z: ${n2(Number(z.toFixed(1)))}, width: 30, depth: 26, density: ${density} },`);
      tufts += 30 * 26 * density;
    }
  }
  // The riverbanks, where it is lush.
  for (let x = -104; x <= 104; x += 26) {
    if (Math.abs(x) < 44) continue;
    grass.push(`  { x: ${n2(x)}, z: ${n2(Number(zr(x).toFixed(1)))}, width: 26, depth: 30, density: 0.28 },`);
    tufts += 26 * 30 * 0.28;
  }
  console.log(`  grass: ~${Math.round(tufts)} tufts`);
}

const NAMED = FLAGS.map(
  (f) =>
    `  { id: "${f.id}", name: "${f.name}", pos: new Vector3(${n2(f.x)}, ` +
    `${n2(Number(heightAt(f.x, f.z).toFixed(2)))}, ${n2(f.z)}), radius: ${f.r} },`,
);

/** One spawn per objective, outside its ring, on open ground. */
const FLAG_SPAWNS = [
  ["A", 0, -17, "0"],
  ["B", 0, 17, "Math.PI"],
  ["C", 0, 18, "Math.PI"],
  ["D", 0, 17, "Math.PI"],
  ["E", -12, -12, "Math.PI / 4"],
];
for (const [id, dx, dz, yaw] of FLAG_SPAWNS) {
  const f = byId[id];
  const x = f.x + dx;
  const z = f.z + dz;
  if (overlaps(x - 1, x + 1, z - 1, z + 1, (c) => c.type !== "solid")) {
    throw new Error(`spawn: ${id}'s spawn at (${x}, ${z}) stands in a building`);
  }
  if (wet(x, z)) throw new Error(`spawn: ${id}'s spawn at (${x}, ${z}) is in the water`);
  spawns.push(
    `  { team: null, controlPoint: "${id}", pos: new Vector3(${n2(x)}, ` +
      `${n2(Number(heightAt(x, z).toFixed(2)))}, ${n2(z)}), yaw: ${yaw} },`,
  );
}

// `--plan` prints the claim list as a plan, a character every 3 m: `#` a
// building, `=` a road, `o` a flag's ring, a spawn or a basin, `~` water.
if (process.argv.includes("--plan")) {
  const step = 3;
  for (let z = HALF - step / 2; z > -HALF; z -= step) {
    let line = String(Math.round(z)).padStart(5) + " ";
    for (let x = -HALF + step / 2; x < HALF; x += step) {
      const at = claimed.filter((c) => x >= c.x0 && x < c.x1 && z >= c.z0 && z < c.z1);
      line += at.some((c) => c.type === "solid") ? "#" : at.some((c) => c.type === "low") ? "o" :
        at.some((c) => c.type === "road") ? "=" : wet(x, z) ? "~" : ".";
    }
    console.log(line);
  }
}

// --- the heightfield ---------------------------------------------------------

const row = CELLS + 1;
const q = new Float64Array(row * row);
for (let j = 0; j < row; j++) {
  for (let i = 0; i < row; i++) {
    q[j * row + i] = Math.round(heightAt(-HALF + i * CELL, -HALF + j * CELL) * 100) / 100;
  }
}
let worstStep = 0;
let worstAt = "";
for (let j = 0; j < row; j++) {
  for (let i = 0; i < row; i++) {
    const h = q[j * row + i];
    if (i + 1 < row) {
      const s = Math.abs(q[j * row + i + 1] - h);
      if (s > worstStep) {
        worstStep = s;
        worstAt = `(${-HALF + i * CELL}, ${-HALF + j * CELL}) along X`;
      }
    }
    if (j + 1 < row) {
      const s = Math.abs(q[(j + 1) * row + i] - h);
      if (s > worstStep) {
        worstStep = s;
        worstAt = `(${-HALF + i * CELL}, ${-HALF + j * CELL}) along Z`;
      }
    }
  }
}
const worstGrade = worstStep / CELL;
if (worstGrade > MAX_GRADE * 0.9) {
  throw new Error(
    `terrain: a ${worstStep.toFixed(2)} m step over ${CELL} m at ${worstAt} is a ` +
      `${worstGrade.toFixed(3)} gradient, against MAX_WALKABLE_GRADE ${MAX_GRADE} ` +
      "less a tenth for margin.",
  );
}
let lo = Infinity;
let hi = -Infinity;
for (const v of q) {
  lo = Math.min(lo, v);
  hi = Math.max(hi, v);
}
const heightRows = [];
for (let j = 0; j < row; j++) {
  const line = [];
  for (let i = 0; i < row; i++) line.push(String(q[j * row + i]));
  heightRows.push("    " + line.join(",") + ",");
}

// --- emit --------------------------------------------------------------------

mkdirSync(out, { recursive: true });

writeFileSync(
  join(out, "heights.ts"),
  `/**
 * kurenai/heights.ts — GENERATED by \`scripts/generate-kurenai.mjs\` (\`npm run
 * kurenai\`), and editable afterwards with the map editor's terrain mode (F2,
 * then T). Do not hand-edit: both the script and the editor rewrite this file
 * wholesale.
 *
 * The floor of the temple valley — one height per grid vertex, row-major from
 * the -X/-Z corner. A lazy \`import()\` (\`MapDef.heights\`), so it reaches a
 * browser only when this map is built.
 *
 * ${CELLS}x${CELLS} cells of ${CELL} m over the ${PLAY} m play square, so ${row}x${row}
 * vertices. \`size * cell\` must equal \`MapLayout.size\`.
 *
 * **The shape is five passes laid over one another IN ORDER** (see
 * \`heightAt\` in the generator): rolling ground; the temple's hill in the
 * north-west corner and the shrine's in the south-east; every district
 * levelled by a weighted average; the river's corridor levelled to the valley
 * floor; and the channel, the koi pond and the hot spring cut last. The
 * river's bed is a constant ${-RIVER_DEPTH} m so one level rect at ${RIVER_Y} is wet
 * along its whole run, and its banks are gentle enough to wade anywhere.
 */
import type { Heightfield } from "../layout";

export const KurenaiHeights: Heightfield = {
  size: ${CELLS},
  cell: ${CELL},
  // Row-major, +Z per row.
  heights: [
${heightRows.join("\n")}
  ],
};

// Default too, because \`MapDef.heights\` is a lazy \`import()\` and a default is
// the one export name a generic signature can be written against.
export default KurenaiHeights;
`,
);

const placementCount = placements.filter((l) => l.includes("{ kind:")).length;
const scatterCount = scatter.filter((l) => l.includes("{ prop:")).length;

writeFileSync(
  join(out, "layout.ts"),
  `/**
 * kurenai/layout.ts — THE MAP, as data: structure placements, scatter regions,
 * control points, spawns, the grass and the three bodies of water. The water
 * rects are MEASURED off the floor by the generator.
 * The floor's shape is generated data and lives in heights.ts. Consumed by
 * MapBuilder; nothing here is code to special-case.
 * Gotchas that have already cost time: collider top faces within
 * CONFIG.nav.stepHeight of adjacent ground or bots treat decks as walls; a
 * control point's pos must NOT sit inside a PLACEMENT's collider; scatter
 * knows nothing about water, so every grove below was checked dry by the
 * generator; terrain steeper than a 0.4 gradient severs its own nav links;
 * a bridge's local zero is BANK grade, so its \`y\` is minus the bed under it.
 *
 * **SEEDED by \`scripts/generate-kurenai.mjs\`, and owned by the editor after
 * that.** The design is authored in that script and this file is the
 * transcription: flat arrays of one-line entries, which is what
 * \`src/editor/sourceScan.ts\` requires. Re-running the generator discards
 * editor edits.
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
 * KURENAI — a temple town in a mountain valley, in the last week of the
 * maples, an hour before sunset.
 *
 * **${PLAY} x ${PLAY} m of PLAY inside ${PLAY + 2 * MARGIN} m of ground**, origin at the arch
 * bridge, +Z north. Hollowmere's footprint, infantry only, eight a side.
 *
 * \`\`\`
 *                                N
 *   +-----------------------------------------------------+  z 120
 *   | temple hill                           x T1 HOME YARD |
 *   |  [A] KOYO-JI (-74,72) +3m        [E] THE INN (72,66) |
 *   |   pagoda, hall, koi pond  cross st  hot spring       |
 *   |            -- middle st --                           |
 *   |              [C] HASHIMOTO (0,28)                    |
 *   |  ~~ bridge ~~~~~~~~~ ARCH BRIDGE ~~~~~~~~~ bridge ~~ |  the river
 *   |               -- south lane --        torii stair    |
 *   |  [B] THE BREWERY (-72,-66)      [D] INARI SHRINE +5m |
 *   | x T0 HOME YARD          farm          (72,-80)       |
 *   +-----------------------------------------------------+  z -120
 * \`\`\`
 *
 * ## The ground, which is what makes it read
 *
 * **The RIVER** runs west to east across the middle, a shallow stream in a
 * channel 18 m lip to lip, cut to one bed so a single rect is wet the whole
 * way: waded anywhere, and crossed dry at three bridges — the vermilion ARCH
 * on the main street, and two plank bridges on the lines between the flags
 * either side of it. It separates the three northern flags from the two
 * southern ones without walling them off. **The TEMPLE's terrace** stands
 * three metres over the town in front of its hill in the
 * north-west, and **the SHRINE's** five up the south-east hill's flank, at the
 * top of a tunnel of vermilion torii climbing straight from the east bridge.
 *
 * ## Design intent per flag
 *
 * - **A Koyo-ji Temple** — a walled court behind a gate, a torii on the lane
 *   before it, the pagoda on one side and the bell on the other, the hall at
 *   the back and the koi pond beside it. The reference frame is its garden.
 *   The pagoda is the map's landmark and is not climbable.
 * - **B The Sake Brewery** — eight white storehouses round a working yard: the
 *   flag in the open between two rows of solid cover, with the brewer's house
 *   and the shop at the ends. The closest flag to T0's yard.
 * - **C Hashimoto** — the plaza at the north end of the arch bridge, in the
 *   middle of the town and the middle of the map; lattice-fronted townhouses
 *   on both banks of the river and down every street.
 * - **D Inari Shrine** — five metres up, at the top of a stone stair under a
 *   tunnel of torii. The high ground on the south side.
 * - **E The Hot Spring Inn** — an inn and its teahouses round a hot spring
 *   behind a garden wall, the closest flag to T1 as the brewery is to T0.
 */

const placements: Placement[] = [
${placements.join("\n")}
];

const scatter: ScatterSpec[] = [
${scatter.join("\n")}
];

const controlPoints: ControlPointDef[] = [
${NAMED.join("\n")}
];

/**
 * Home spawns are uncapturable; every flag also carries a spawn just outside
 * its ring. The home yards face each other down the SW-NE diagonal.
 */
const spawns: SpawnPointDef[] = [
${spawns.join("\n")}
];

const water: WaterRect[] = [
${water.join("\n")}
];

const grass: GrassRect[] = [
${grass.join("\n")}
];

export const KurenaiLayout: MapLayout = {
  placements,
  scatter,
  controlPoints,
  spawns,
  water,
  grass,
  /** The play square. \`heights.size * heights.cell\` equals it (${CELLS} x ${CELL}). */
  size: ${PLAY},
  /**
   * Four: the ground, a plinth or a deck, and the roof slabs over them — the
   * pagoda stacks five roofs over one plinth, and its colliders are emitted
   * walked-first so what overflows is a roof nobody stands on.
   */
  surfaces: 4,
  /**
   * Two and a half times the default, which is DRAW CALLS and nothing else:
   * under a 280 m haze the whole square is in view from anywhere in it, so a
   * merge block never leaves the frame for being far away and a fine grid
   * buys the cull nothing. Every block carries a draw per material — the
   * maples alone are eight — so the count of blocks in view is the draw
   * count. Measured warm at the centre flag: 48 m ran 118 fps on 445 draws,
   * 96 m 148, 120 m 154, 160 m 160; this is the play square in 2 x 2.
   */
  blockSize: ${BLOCK},
  /**
   * No wall: the valley carries on for ${MARGIN} m past the play square and the
   * leash is what stops you. The margin is the leash's floor with room over,
   * and no more, because what closes this horizon is the MOUNTAINS standing
   * on it — the rim below — and a landform closes a horizon at any distance
   * (Coldharbour's argument). Kept short so the ridges' feet stand inside the
   * haze rather than past it: seen from the play square they are the
   * reference frame's pale mountains, a silhouette most of the way into the
   * fog. \`roll\` is bounded by the river running out through the margin
   * (Greyfen's rule): its bed is ${RIVER_DEPTH} m down and the roll may not lift it dry.
   */
  borderland: { margin: ${MARGIN}, roll: 1.2, ease: 40 },
  /**
   * Mountains: rolling downs with summits and saddles along the crest and
   * woods on the lower slopes, steep enough (an angle of ${0.19} from the map's
   * centre) to stand over the valley as ranges rather than as a bank. Two
   * passes where the river leaves.
   */
  ridge: {
    form: "downs",
    slope: 0.19,
    slopeVariance: 0.04,
    passes: [
      { x: -${HALF + MARGIN}, z: ${n2(Number(zr(-HALF).toFixed(1)))}, width: 80, depth: 0.7 },
      { x: ${HALF + MARGIN}, z: ${n2(Number(zr(HALF).toFixed(1)))}, width: 80, depth: 0.7 },
    ],
    rolling: { relief: 0.35, summits: 10, knolls: 0.18, woods: 0.55 },
    seed: 0x4b555246,
  },
  seed: 0x4b555245,
};
`,
);

const byKind = {};
for (const l of placements) {
  const m = /kind: "([a-zA-Z]+)"/.exec(l);
  if (m) byKind[m[1]] = (byKind[m[1]] ?? 0) + 1;
}
const refusedByKind = {};
for (const r of refused) {
  const k = r.split(" ")[0];
  refusedByKind[k] = (refusedByKind[k] ?? 0) + 1;
}
console.log("  placed:  " + JSON.stringify(byKind));
console.log("  refused: " + JSON.stringify(refusedByKind));
if (process.argv.includes("--refusals")) for (const r of refused) console.log("    " + r);
console.log(
  `kurenai: ${PLAY} m play + ${MARGIN} m margin = ${PLAY + 2 * MARGIN} m across\n` +
    `  ${placementCount} placements, ${scatterCount} scatter regions (~${trees} trees, ~${drifts} drifts), ${claimed.length} claims\n` +
    `  ${row}x${row} height vertices, ground ${lo.toFixed(2)}..${hi.toFixed(2)} m\n` +
    `  ${waterBodies.length} water bodies, deepest ${waterBodies.map((b) => b.deepest.toFixed(2)).join(" / ")} m\n` +
    `  steepest cell step ${worstStep.toFixed(2)} m (grade ${worstGrade.toFixed(3)}) at ${worstAt}\n` +
    `  wrote src/world/kurenai/{layout,heights}.ts`,
);
