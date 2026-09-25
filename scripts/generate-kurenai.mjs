/**
 * generate-kurenai.mjs — SEEDS Kurenai, the temple valley: writes
 * `src/world/kurenai/{layout,heights}.ts`.
 *
 * Run with `npm run kurenai`. Committed output, like every `heights.ts` and
 * every collision bake, and re-running it with the tree unchanged must produce
 * the same bytes.
 *
 * ## Why it is seeded, on Sarab's precedent
 *
 * The floor is forty thousand numbers and a river that meanders across a
 * kilometre of ground, which is a FUNCTION; and a 750 m valley dressed the way
 * the reference frame is dressed is two thousand trees whose only interesting
 * property is that none of them stands in the river, on a road or through a
 * roof. So the DESIGN is authored here — the flags, the town's streets, every
 * set piece, the recipe the woods are sown from — and the TRANSCRIPTION is
 * mechanical. The output is an ordinary layout file the editor opens, patches
 * and saves; re-running this discards those edits.
 *
 * ## What lives here rather than in the layout's own header
 *
 * - **The floor is five passes, in order**: rolling ground; four hills (the
 *   temple mountain in the north-west, the shrine hill in the south-east and a
 *   low shoulder behind each home yard); every district flattened toward its
 *   own level by a weighted AVERAGE (Sarab's `land`, and for its reason — a
 *   sequence lets a later district lift an earlier one's core); the river's
 *   corridor flattened to the valley floor; and the channel, the temple's koi
 *   pond and the inn's hot spring cut last. The gradient of the result is
 *   checked against `MAX_WALKABLE_GRADE` and the script REFUSES to write a
 *   floor it cannot walk.
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
const PLAY = 750;
/** Ground past it — the horizon's floor; see the layout's `borderland` note. */
const MARGIN = 100;
/** Metres per heightfield cell. `CELLS * CELL` must equal `PLAY`. */
const CELL = 3.75;
const CELLS = PLAY / CELL;
const HALF = PLAY / 2;
const MAX_GRADE = 0.4;
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
 * The hills. The temple mountain is the big one and stands in the north-west
 * corner with the precinct cut into its south-eastern flank; the shrine hill
 * is the south-east's, with the shrine on a terrace at its crown. The two low
 * shoulders are there so the home yards are not on a table.
 *
 * Peak over radius is the steepest the bell makes: 26 over 175 is 0.23.
 */
const HILLS = [
  { x: -330, z: 330, peak: 26, r: 200 },
  { x: 238, z: -210, peak: 18, r: 125 },
  { x: -340, z: -40, peak: 9, r: 110 },
  { x: 340, z: 40, peak: 9, r: 110 },
];

/** Rolling ground and the hills, before anything is levelled. */
function natural(x, z) {
  let h = 2.2 * vnoise(x, z, 170, 11) + 0.8 * vnoise(x, z, 64, 12) + 0.25 * vnoise(x, z, 23, 13);
  for (const k of HILLS) h += k.peak * bell(Math.hypot(x - k.x, z - k.z), k.r);
  return h;
}

// The river: a centreline, and the channel cut to a constant bed along it so
// ONE flat water rect is wet along its whole run (Harrowmead's mill stream,
// at twice the length).
const zr = (x) => -12 + 22 * Math.sin((x + 40) / 130);
const zrSlope = (x) => (22 / 130) * Math.cos((x + 40) / 130);
/** Perpendicular distance to the river's centreline, near enough. */
const riverDist = (x, z) => Math.abs(z - zr(x)) / Math.sqrt(1 + zrSlope(x) ** 2);
/** Flat bed half-width, and where the bank reaches the valley floor. */
const RIVER_BED = 4;
const RIVER_LIP = 12;
const RIVER_DEPTH = 1.2;
/** The river's surface. The bed is 0.7 m under it. */
const RIVER_Y = -0.5;
/** The flat valley floor either side of it, and its skirt. */
const CORRIDOR = 34;
const CORRIDOR_SKIRT = 50;

/**
 * The places that have to be LEVEL: every flag's precinct, the town, the home
 * yards and the farms. `level` is what the ground reads inside the core,
 * `skirt` how far it takes to get back to the hills. Farms are added below at
 * their own natural height.
 */
const DISTRICTS = [
  // C — the town, both banks. Short skirt: it sits beside the temple's
  // terrace, which is seven metres up, and must not dilute it.
  { name: "town", x: 2.5, z: 10, hw: 117.5, hd: 125, level: 0, skirt: 32 },
  // A — the temple precinct, cut into the mountain's flank.
  { name: "temple", x: -205, z: 160, hw: 50, hd: 50, level: 6, skirt: 60 },
  // B — the brewery.
  { name: "brewery", x: -205, z: -150, hw: 46, hd: 36, level: 1, skirt: 45 },
  // D — the shrine, at the hill's crown.
  { name: "shrine", x: 222, z: -184, hw: 26, hd: 24, level: 15, skirt: 72 },
  // E — the inn.
  { name: "inn", x: 205, z: 170, hw: 46, hd: 46, level: 2, skirt: 45 },
  { name: "home sw", x: -300, z: -300, hw: 44, hd: 44, level: 1.5, skirt: 45 },
  { name: "home ne", x: 300, z: 300, hw: 44, hd: 44, level: 1.5, skirt: 45 },
];

/** Farmsteads, each a small level plot at its own natural height. */
const FARMS = [
  [-60, -235],
  [95, -250],
  [-330, 110],
  [-110, 270],
  [70, 285],
  [330, -95],
  [-300, -150],
  [300, 150],
  [-20, -330],
  [30, 335],
  [330, -260],
  [160, -300],
  [-160, 320],
];
/**
 * A farm is levelled at its own natural height, so it only goes where that is
 * a meaningful thing to say — ground that falls under four metres across the
 * plot and its yard. On the mountain's flank a level plot is a cut and a fill
 * whose skirt is steeper than the nav graph links.
 */
const farmOk = ([x, z]) => {
  let a = Infinity;
  let b = -Infinity;
  for (const dx of [-32, 0, 32]) {
    for (const dz of [-32, 0, 32]) {
      const h = natural(x + dx, z + dz);
      a = Math.min(a, h);
      b = Math.max(b, h);
    }
  }
  if (b - a > 4) console.log(`  farm at (${x}, ${z}) dropped: ${(b - a).toFixed(1)} m of fall`);
  return b - a <= 4;
};
for (let i = FARMS.length - 1; i >= 0; i--) if (!farmOk(FARMS[i])) FARMS.splice(i, 1);
for (const [x, z] of FARMS) {
  DISTRICTS.push({
    name: "farm",
    x,
    z,
    hw: 17,
    hd: 14,
    level: Math.round(natural(x, z) * 4) / 4,
    skirt: 42,
  });
}

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

/** The temple's koi pond and the inn's hot spring. */
const POND = { x: -176, z: 151, rx: 7.5, rz: 5.5, skirt: 7, depth: 1.5 };
const ONSEN = { x: 176, z: 150, rx: 6, rz: 4.5, skirt: 6, depth: 1.4 };

function heightAt(x, z) {
  let h = land(x, z);
  const rd = riverDist(x, z);
  if (rd < RIVER_LIP) {
    const bed = -RIVER_DEPTH;
    const w = rd <= RIVER_BED ? 1 : 1 - smooth((rd - RIVER_BED) / (RIVER_LIP - RIVER_BED));
    h += (bed - h) * w;
  }
  return h - basinCut(x, z, POND) - basinCut(x, z, ONSEN);
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
    if (Math.hypot((x - b.x) / (b.rx + b.skirt + 2), (z - b.z) / (b.rz + b.skirt + 2)) < 1) {
      return true;
    }
  }
  return false;
}

// --- what is already there ---------------------------------------------------

/**
 * Everything that has claimed ground, as axis-aligned rectangles. `type` is
 * "solid" for a building, "road" for a carriageway (which refuses a building
 * and nothing that grows, since a road already does that itself) and "low"
 * for a flag ring, a spawn or a hardstanding — which refuse everything.
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
  if (Math.max(Math.abs(x0), Math.abs(x1)) > HALF - 10) return false;
  if (Math.max(Math.abs(z0), Math.abs(z1)) > HALF - 10) return false;
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
      refused.push(`${kind} at (${x.toFixed(0)}, ${z.toFixed(0)}) claim`);
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
      "spawns and hardstandings claim first.",
  );
}

function section(list, title) {
  const bar = "=".repeat(Math.max(4, 74 - title.length));
  list.push(`  // ===== ${title} ${bar}`);
}

// --- the flags and the homes -------------------------------------------------

const FLAGS = [
  { id: "A", name: "Koyo-ji Temple", x: -205, z: 150, r: 16 },
  { id: "B", name: "The Sake Brewery", x: -205, z: -150, r: 15 },
  { id: "C", name: "Hashimoto", x: 0, z: 42, r: 16 },
  { id: "D", name: "Inari Shrine", x: 222, z: -178, r: 14 },
  { id: "E", name: "The Hot Spring Inn", x: 205, z: 162, r: 15 },
];
const byId = Object.fromEntries(FLAGS.map((f) => [f.id, f]));

const HOMES = [
  { team: 0, x: -300, z: -300, s: 1, yaw: "Math.PI / 4" },
  { team: 1, x: 300, z: 300, s: -1, yaw: "-Math.PI * 0.75" },
];

// --- the roads, first, because everything else dodges them -------------------

section(placements, "roads");
placements.push(
  "  // Visual only: a road carries no collider, stops no round and is in no",
  "  // baked structure. The town's streets are COBBLE — the reference frame's",
  "  // stone path is exactly this texture — and everything that leaves the",
  "  // town is a dirt lane. No road crosses the river: the bridges do, and a",
  "  // hull fords it anywhere, the banks being a 0.15 gradient the whole run.",
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

// The bridges' landings, which the roads run to.
const BRIDGE_C = { x: 0, span: 18 };
const BRIDGE_W = { x: -150, span: 26 };
const BRIDGE_E = { x: 150, span: 26 };
/** Where an arch bridge's ramps meet the bank (`buildArchBridge`: 2.3 / 0.3). */
const ARCH_REACH = BRIDGE_C.span / 2 + (1.7 + 0.6) / 0.3;
const zC = zr(BRIDGE_C.x);
const zW = zr(BRIDGE_W.x);
const zE = zr(BRIDGE_E.x);

// The main street, both banks of it, stopping at the arch bridge's feet.
{
  const southEnd = zC - ARCH_REACH - 0.5;
  const northEnd = zC + ARCH_REACH + 0.5;
  rectRoad(0, (-118 + southEnd) / 2, 0, southEnd + 118, 8, "cobble");
  rectRoad(0, (northEnd + 150) / 2, 0, 150 - northEnd, 8, "cobble");
}
// The north cross street, the plaza's back, the south lane and the back lane.
rectRoad(0, 68, 1, 250, 7, "cobble");
rectRoad(0, -72, 1, 226, 6, "cobble");
rectRoad(0, 122, 1, 226, 6, "dirt");
rectRoad(-68, 95, 0, 48, 5, "dirt");
rectRoad(68, 95, 0, 48, 5, "dirt");
// The plaza: paved, with the flag in it.
rectRoad(0, 41, 1, 44, 30, "cobble");

// The lanes out of town.
pathRoad([[-125, 68], [-150, 76], [-178, 88], [-205, 100]], 6, "dirt"); // to the temple
pathRoad([[125, 68], [150, 90], [178, 118], [205, 134]], 6, "dirt"); // to the inn
pathRoad([[0, -118], [-40, -130], [-100, -142], [-150, -150], [-168, -150]], 6, "dirt"); // to the brewery
pathRoad([[113, -72], [150, -82], [190, -92], [222, -98]], 6, "dirt"); // to the shrine's foot
// The west bridge's two lanes, and the east's.
pathRoad([[-172, -128], [-160, -90], [-150, zW - BRIDGE_W.span / 2 - 1]], 5, "dirt");
pathRoad([[-150, zW + BRIDGE_W.span / 2 + 1], [-150, 20], [-140, 50], [-125, 64]], 5, "dirt");
pathRoad([[150, -78], [150, zE - BRIDGE_E.span / 2 - 1]], 5, "dirt");
pathRoad([[150, zE + BRIDGE_E.span / 2 + 1], [140, 50], [128, 64]], 5, "dirt");
// The home yards' lanes.
pathRoad([[-262, -262], [-250, -225], [-225, -185]], 7, "dirt");
pathRoad([[262, 262], [252, 236], [234, 216]], 7, "dirt");
// The farm tracks: a few, so the countryside has somewhere to go.
pathRoad([[-100, -142], [-80, -190], [-62, -222]], 4, "dirt");
pathRoad([[40, -130], [80, -200], [95, -236]], 4, "dirt");
pathRoad([[-100, 122], [-108, 200], [-110, 256]], 4, "dirt");
pathRoad([[60, 122], [68, 200], [70, 270]], 4, "dirt");
// The shrine's approach: a stone sando straight up the hill, under the torii.
const SANDO = { x: 222, z0: -100, z1: -160 };
rectRoad(SANDO.x, (SANDO.z0 + SANDO.z1) / 2, 0, SANDO.z0 - SANDO.z1, 3.6, "cobble");
// The temple's approach through its gate, and inside the precinct to the hall.
rectRoad(-205, 103, 0, 12, 5, "cobble");
rectRoad(-205, 137, 0, 40, 4, "cobble");

// The flags, the homes and the hardstandings claim before any building does.
for (const f of FLAGS) claim(f.x, f.z, 24, 24, 0, "low");

const spawns = [];
const vehicles = [];
for (const h of HOMES) {
  for (let i = 0; i < 3; i++) {
    const x = h.x + h.s * (20 + i * 7);
    const z = h.z + h.s * (22 - i * 7);
    claim(x, z, 7, 7, 0, "low");
    spawns.push(
      `  { team: ${h.team}, pos: new Vector3(${n2(x)}, ` +
        `${n2(Number(heightAt(x, z).toFixed(2)))}, ${n2(z)}), yaw: ${h.yaw} },`,
    );
  }
  // The tank, the truck and the helicopter — Sarab's three pads, one yard.
  const pads = [
    { dx: 30, dz: -6, size: 16, kind: "" },
    { dx: 12, dz: 10, size: 12, kind: ', kind: "truck"' },
    { dx: -8, dz: 30, size: 18, kind: ', kind: "heli"' },
  ];
  for (const p of pads) {
    const x = h.x + h.s * p.dx;
    const z = h.z + h.s * p.dz;
    claim(x, z, p.size, p.size, 0, "low");
    vehicles.push(
      `  { team: ${h.team}, pos: new Vector3(${n2(x)}, ` +
        `${n2(Number(heightAt(x, z).toFixed(2)))}, ${n2(z)}), yaw: ${h.yaw}${p.kind} },`,
    );
  }
}

// --- A — Koyo-ji, the temple ---------------------------------------------------

section(placements, "A: Koyo-ji Temple");
{
  const cx = -205;
  const gateZ = 116;
  // The gate on the precinct's south wall, the torii before it on the lane.
  // The pond's basin first: nothing may stand on its lip.
  claim(POND.x, POND.z, POND.rx * 2 + POND.skirt * 2 + 2, POND.rz * 2 + POND.skirt * 2 + 2, 0, "low");
  must("torii", cx, 97, 0, 9, 1, { width: 4.8, height: 6 }, { force: true });
  must("templeGate", cx, gateZ, 0, 10, 4.4, null, { force: true });
  // The precinct wall: south either side of the gate, and round the other
  // three sides with a way through on each.
  const W = 96;
  const D = 86;
  const west = cx - W / 2;
  const east = cx + W / 2;
  const north = gateZ + D;
  const wall = (x, z, turn, len) =>
    must("gardenWall", x, z, turn, len, 1, { length: len }, { pad: 0, flat: 0.5 });
  const gateHalf = 5;
  const southRun = (W / 2 - gateHalf - 0.2) / 2;
  wall(cx - gateHalf - 0.2 - southRun / 2, gateZ, 0, southRun);
  wall(cx - gateHalf - 0.2 - southRun * 1.5, gateZ, 0, southRun);
  wall(cx + gateHalf + 0.2 + southRun / 2, gateZ, 0, southRun);
  wall(cx + gateHalf + 0.2 + southRun * 1.5, gateZ, 0, southRun);
  for (const x of [west, east]) {
    // Two runs a side with a 6 m gap between them.
    const run = (D - 6) / 2;
    wall(x, gateZ + run / 2 + 0.5, 1, run - 1);
    wall(x, north - run / 2 - 0.5, 1, run - 1);
  }
  {
    const run = (W - 6) / 2;
    wall(cx - 3 - run / 2, north, 0, run);
    wall(cx + 3 + run / 2, north, 0, run);
  }
  // The hall at the back of the court, facing the gate.
  must("templeHall", cx, 178, 0, 23.2, 18.2, { width: 20, depth: 15, litWindows: true }, { pad: 0.5 });
  // The pagoda on the west side of the court, the bell on the east.
  must("pagoda", -237, 150, 0, 10.6, 10.6, null, { pad: 0.5 });
  must("bellTower", -172, 130, 0, 5.2, 5.2, null, { pad: 0.5 });
  // The garden by the pond, with its own stone pagoda and lanterns.
  must("stonePagoda", -164, 168, 0, 1.6, 1.6, null, { pad: 0.3 });
  must("teahouse", -238, 190, 3, 9.4, 8.4, { width: 7, depth: 6, litWindows: true }, { pad: 0.3 });
  // Lanterns lining the court's path, in pairs.
  for (const z of [122, 130, 165]) {
    for (const s of [-1, 1]) {
      place("toro", cx + s * 4.2, z, 0, 1.1, 1.1, { litWindows: true }, { pad: 0.2, flat: 0.3 });
    }
  }
  for (const [x, z] of [[-180, 196], [-168, 196], [-230, 176], [-225, 128], [-186, 136]]) {
    place("toro", x, z, 0, 1.1, 1.1, { litWindows: true }, { pad: 0.2, flat: 0.3 });
  }
}

// --- B — the brewery -----------------------------------------------------------

section(placements, "B: The Sake Brewery");
{
  const { x: cx, z: cz } = byId.B;
  // The storehouses round the yard: a row on the north, a row on the south.
  for (let i = 0; i < 5; i++) {
    must("kura", cx - 34 + i * 10, cz + 24, 0, 6.8, 5.6, { width: 6.4, depth: 5.2, height: 5.6 }, { pad: 0.3 });
  }
  for (let i = 0; i < 4; i++) {
    must("kura", cx - 28 + i * 11, cz - 24, 2, 7.2, 6, { width: 7, depth: 5.6, height: 6.2 }, { pad: 0.3 });
  }
  // The brewer's house on the west, the shop on the east.
  must("minka", cx - 36, cz, 3, 14.6, 10.9, { width: 14, depth: 9, enterable: true, litWindows: true }, { pad: 0.5 });
  must("machiya", cx + 29, cz + 13, 1, 7.2, 11.2, { width: 7, depth: 11, enterable: true, litWindows: true }, { pad: 0.3 });
  must("machiya", cx + 29, cz - 13, 1, 6.6, 11.2, { width: 6.4, depth: 11, litWindows: true }, { pad: 0.3 });
  place("well", cx - 16, cz - 8, 0, 2, 2, null, { pad: 0.3 });
  place("woodpile", cx + 16, cz + 12, 0, 3, 1.5, null, { pad: 0.3 });
  place("cart", cx - 18, cz + 12, 1, 1.8, 3.6, null, { pad: 0.3 });
  place("crates", cx + 14, cz - 12, 0, 2, 2, null, { pad: 0.3 });
  for (const [x, z] of [[cx - 8, cz + 17], [cx + 8, cz - 17]]) {
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
  // The plaza's furniture: a torii at its river side, lanterns at the
  // corners, and the bell tower on its east flank.
  must("torii", 0, 23, 0, 7, 1, { width: 5.4, height: 5.4 }, { force: true });
  for (const [x, z] of [[-19, 28], [19, 28], [-19, 54], [19, 54]]) {
    must("toro", x, z, 0, 1.1, 1.1, { litWindows: true }, { force: true });
  }
  must("bellTower", 30, 44, 0, 5.2, 5.2, null, { pad: 0.3 });
  must("teahouse", -34, 42, 3, 8.4, 9.4, { width: 7, depth: 6, litWindows: true, lit: true }, { pad: 0.3 });
}

// --- D — the Inari shrine ---------------------------------------------------------

section(placements, "D: Inari Shrine");
{
  const { x: cx, z: cz } = byId.D;
  // The shrine hall at the back of the crown, facing down the sando.
  must("templeHall", cx, cz - 20, 2, 15.2, 12.2, { width: 12, depth: 9, litWindows: true }, { pad: 0.4 });
  // The tunnel of torii: close-set gates up the whole of the stone approach.
  // Each straddles the path across the slope, so both posts stand on one
  // contour whatever the grade is.
  for (let z = SANDO.z0 - 2; z >= SANDO.z1 + 1; z -= 3.2) {
    must("torii", cx, z, 0, 5.6, 0.8, { width: 3.4, height: 4.2 }, { force: true, noClaim: true });
  }
  must("torii", cx, SANDO.z1 - 3, 0, 9, 1, { width: 5.2, height: 6.4 }, { force: true });
  for (const [x, z] of [[cx - 6, cz + 8], [cx + 6, cz + 8], [cx - 9, cz - 8], [cx + 9, cz - 8]]) {
    must("toro", x, z, 0, 1.1, 1.1, { litWindows: true }, { force: true });
  }
  place("teahouse", cx + 20, cz - 4, 3, 8.4, 9.4, { width: 7, depth: 6, litWindows: true }, { pad: 0.3 });
  place("stonePagoda", cx - 18, cz - 6, 0, 1.6, 1.6, null, { pad: 0.3 });
}

// --- E — the hot spring inn -------------------------------------------------------

section(placements, "E: The Hot Spring Inn");
{
  const { x: cx, z: cz } = byId.E;
  must("minka", cx, cz + 30, 0, 18.6, 12.6, { width: 18, depth: 11, height: 3.2, enterable: true, litWindows: true }, { pad: 0.5 });
  must("teahouse", cx - 30, cz + 8, 3, 9.4, 8.4, { width: 7, depth: 6, litWindows: true, lit: true }, { pad: 0.3 });
  must("teahouse", cx + 30, cz + 6, 1, 10.4, 9.4, { width: 8, depth: 7, litWindows: true }, { pad: 0.3 });
  must("teahouse", ONSEN.x, ONSEN.z - 19, 2, 8.4, 8.4, { width: 6, depth: 6, litWindows: true }, { pad: 0.3 });
  must("kura", cx + 28, cz + 30, 0, 6.8, 5.6, null, { pad: 0.3 });
  // The garden wall round the back of the inn.
  must("gardenWall", cx - 2, cz + 44, 0, 36, 1, { length: 36, tint: "#b3aa97" }, { pad: 0, flat: 0.5 });
  for (const [x, z] of [[ONSEN.x - 13, ONSEN.z + 2], [ONSEN.x + 2, ONSEN.z + 12], [cx - 10, cz + 20], [cx + 10, cz + 20]]) {
    place("toro", x, z, 0, 1.1, 1.1, { litWindows: true }, { pad: 0.2 });
  }
  claim(ONSEN.x, ONSEN.z, ONSEN.rx * 2 + ONSEN.skirt * 2 + 2, ONSEN.rz * 2 + ONSEN.skirt * 2 + 2, 0, "low");
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
  while (t < end) {
    const w = Number(rand(5.8, 7.6).toFixed(1));
    const d = Number(rand(10, 13).toFixed(1));
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
    if (place("machiya", x, z, turn, w + 0.2, d + 0.2, params, { pad: 0.15 })) {
      t += w + rand(0.1, 0.5);
    } else {
      t += 2;
    }
  }
}

// The main street, both sides, both banks.
for (const [a, b] of [[-114, zC - 24], [zC + 22, 148]]) {
  machiyaRow(-4, a, b, "east");
  machiyaRow(4, a, b, "west");
}
// The north cross street.
machiyaRow(71.5, -124, 124, "south");
machiyaRow(64.5, -124, 124, "north");
// The south lane.
machiyaRow(-69, -112, 112, "south");
machiyaRow(-75, -112, 112, "north", { minka: 0.25 });
// The back lane, looser.
machiyaRow(125, -112, 112, "south", { minka: 0.4 });
machiyaRow(119, -112, 112, "north", { minka: 0.3 });
// The two short lanes between them.
for (const x of [-68, 68]) {
  machiyaRow(x - 2.5, 74, 116, "east");
  machiyaRow(x + 2.5, 74, 116, "west");
}
// Kura in the back plots, where the rows left room.
for (let i = 0; i < 60; i++) {
  const x = rand(-115, 115);
  const z = rand(-115, 135);
  place("kura", Number(x.toFixed(1)), Number(z.toFixed(1)), Math.floor(rng() * 4), 6.8, 5.6, null, { pad: 1.5 });
}
// Lanterns down the main street.
for (let z = -110; z < 145; z += 18) {
  if (Math.abs(z - zC) < 26) continue;
  place("toro", -5.2, z, 0, 1.1, 1.1, { litWindows: true }, { pad: 0.1, flat: 0.3 });
}

// --- the countryside ---------------------------------------------------------------

section(placements, "the farms");
for (const [x, z] of FARMS) {
  const turn = Math.floor(rng() * 4);
  const w = Number(rand(11, 14).toFixed(1));
  const d = Number(rand(7.5, 9).toFixed(1));
  place("minka", x, z, turn, w + 2.6, d + 3.8, { width: w, depth: d, enterable: chance(0.5), litWindows: chance(0.6) }, { pad: 1 });
  const k = turn % 2 === 0 ? [x + (w / 2 + 6) * (chance(0.5) ? 1 : -1), z + rand(-3, 3)] : [x + rand(-3, 3), z + (w / 2 + 6) * (chance(0.5) ? 1 : -1)];
  place("kura", Number(k[0].toFixed(1)), Number(k[1].toFixed(1)), Math.floor(rng() * 4), 6.8, 5.6, null, { pad: 1 });
  place("woodpile", Number((x + rand(-10, 10)).toFixed(1)), Number((z + rand(-10, 10)).toFixed(1)), Math.floor(rng() * 4), 3, 1.5, null, { pad: 0.5 });
  if (chance(0.5)) place("toro", Number((x + rand(-12, 12)).toFixed(1)), Number((z + rand(-12, 12)).toFixed(1)), 0, 1.1, 1.1, { litWindows: true }, { pad: 0.5 });
}
// Wayside torii and lanterns on the lanes into the hills.
for (const [x, z] of [[-108, 205], [68, 205], [-80, -190], [80, -200]]) {
  place("torii", x, z, 0, 7, 1, { width: 5.4, height: 4.6 }, { force: true });
}

// The home yards: a storehouse and a farmhouse each, clear of the pads.
section(placements, "the home yards");
for (const h of HOMES) {
  place("kura", h.x - h.s * 18, h.z - h.s * 20, h.s > 0 ? 0 : 2, 6.8, 5.6, null, { pad: 1 });
  place("minka", h.x - h.s * 22, h.z + h.s * 8, h.s > 0 ? 1 : 3, 13.8, 11.9, { width: 12, depth: 8, enterable: true }, { pad: 1 });
}

// --- the woods ----------------------------------------------------------------------

/**
 * Whether a grove of radius `r` may be sown at (x, z): its whole disc dry,
 * clear of every claim that is not a road, and under `maxGrade`.
 */
function groveOk(x, z, r, maxGrade = 0.3, overBuildings = false) {
  if (Math.abs(x) + r > HALF - 4 || Math.abs(z) + r > HALF - 4) return false;
  // A big region may stand over buildings: `findSpot` keeps a trunk out of
  // every collider, and a crown over a roof is a garden. What it may not
  // stand over is a pad, a spawn or a flag's ring.
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

const GROVE = 19;
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

/** How wooded a point is meant to be, 0..1 — the hills and the riverbanks. */
function woodiness(x, z) {
  const h = natural(x, z);
  let w = smooth((h - 3) / 10) * 0.9;
  const rd = riverDist(x, z);
  if (rd > RIVER_LIP + 2 && rd < 34) w = Math.max(w, 0.75);
  // The margins of the square: woods closing the valley in.
  const edge = Math.max(Math.abs(x), Math.abs(z));
  w = Math.max(w, smooth((edge - 290) / 60) * 0.8);
  // A broken field of noise, so the woods come as stands.
  w += 0.35 * vnoise(x, z, 55, 31);
  return Math.max(0, Math.min(1, w));
}

section(scatter, "the precincts");
// The temple court and the gardens: maples round the pond and in the corners.
for (const [x, z, r, n] of [
  [-240, 204, 5, 2], [-172, 200, 5, 2], [-244, 126, 6, 3], [-228, 164, 4, 2],
  [-165, 182, 4, 2], [-190, 126, 4, 1], [-150, 100, 8, 4], [-262, 100, 8, 4],
  [-222, 200, 4, 2], [-196, 202, 3, 1], [-248, 150, 3, 1], [-226, 134, 3, 1],
  [-162, 124, 4, 2], [-218, 104, 6, 3], [-192, 104, 6, 3], [-240, 90, 8, 4],
  [-170, 90, 8, 4], [-205, 222, 10, 5], [-150, 222, 10, 5], [-260, 222, 10, 5],
]) {
  if (groveOk(x, z, r, 0.2)) {
    grove("maple", x, z, r, n, MAPLE);
    trees += n;
  }
}
// The shrine's crown and the sando's flanks — maples first, cedar behind.
for (let z = -106; z > -162; z -= 9) {
  for (const s of [-1, 1]) {
    const x = SANDO.x + s * 9;
    if (groveOk(x, z, 5)) {
      grove("maple", x, z, 5, 3, MAPLE);
      trees += 3;
    }
  }
}
// The inn's garden.
for (const [x, z, r, n] of [[160, 170, 8, 4], [246, 170, 8, 4], [180, 205, 7, 3], [232, 205, 7, 3], [168, 132, 6, 2]]) {
  if (groveOk(x, z, r, 0.2)) {
    grove("maple", x, z, r, n, MAPLE);
    trees += n;
  }
}
// Bamboo behind the inn and the brewery, and on the temple mountain's foot.
for (const [x, z] of [[235, 228], [175, 228], [-250, -182], [-170, -190], [-255, 232], [-150, 240], [262, -150], [180, -214]]) {
  if (groveOk(x, z, 10)) grove("bamboo", x, z, 10, 7, ", scale: [0.85, 1.15], clearance: 0.9");
}

section(scatter, "the woods");
// A lattice over the whole square, jittered, sown by how wooded each point is
// — and nowhere is bare: the open ground between the flags carries a maple in
// one plot in four, because the reference frame has no field without a tree.
// A region that fails its checks is tried again smaller, so the woods run up
// to the river and the pads rather than stopping a lattice cell short.
for (let gz = -HALF + 20; gz < HALF - 10; gz += 38) {
  for (let gx = -HALF + 20; gx < HALF - 10; gx += 38) {
    const x = gx + rand(-5, 5);
    const z = gz + rand(-5, 5);
    const w = woodiness(x, z);
    let r = 0;
    for (const tryR of [GROVE, GROVE * 0.6, GROVE * 0.35]) {
      if (groveOk(x, z, tryR, 0.33, true)) {
        r = tryR;
        break;
      }
    }
    if (!r) continue;
    const high = natural(x, z) > 15;
    const cedar = high && chance(0.5);
    // Trees per region by area and by how wooded the point is — and a floor
    // under it, because no field in the reference frame is without a maple.
    const count = Math.max(2, Math.round((0.2 + w * 0.8) * (r * r) / 22));
    grove(cedar ? "pine" : "maple", x, z, r, count, cedar ? CEDAR : MAPLE);
    trees += count;
  }
}

section(scatter, "the town's trees");
// A maple in the back plots and on the verges, where the rows left room.
for (let i = 0; i < 60; i++) {
  const x = rand(-120, 125);
  const z = rand(-118, 140);
  if (!groveOk(x, z, 9, 0.2, true)) continue;
  grove("maple", x, z, 9, 3, MAPLE);
  trees += 3;
}

section(scatter, "the fallen leaves");
// Drifts under the trees and along the paths — only where the ground is
// flat enough for a level drift to lie on it (`buildLeafLitter`).
for (let gz = -HALF + 18; gz < HALF - 10; gz += 36) {
  for (let gx = -HALF + 18; gx < HALF - 10; gx += 36) {
    const x = gx + rand(-8, 8);
    const z = gz + rand(-8, 8);
    const w = woodiness(x, z);
    const near = Math.abs(riverDist(x, z) - 20) < 10 || Math.abs(x) < 125 && Math.abs(z - 10) < 130;
    if (!near && rng() > w) continue;
    if (Math.abs(x) + 6 > HALF - 4 || Math.abs(z) + 6 > HALF - 4) continue;
    let ok = true;
    for (let k = 0; k < 9; k++) {
      const px = x + (k === 0 ? 0 : Math.cos(k * 0.785) * 13);
      const pz = z + (k === 0 ? 0 : Math.sin(k * 0.785) * 13);
      if (wet(px, pz, 0.4) || grade(px, pz) > 0.05) ok = false;
    }
    if (!ok) continue;
    grove("leafLitter", x, z, 12, 18, ", scale: [0.9, 1.3], clearance: 0.6");
    drifts += 18;
  }
}
// And on the stone paths the reference frame is made of.
for (const [x, z] of [
  [-205, 128], [-205, 146], [-205, 100], [0, 36], [0, 48], [-8, 90], [6, -40],
  [222, -120], [222, -140], [205, 150], [-205, -140],
  // The courts: under the precinct's maples and round the pond.
  [-235, 195], [-225, 130], [-185, 172], [-240, 160], [-176, 132], [-160, 170],
  [-220, 185], [-190, 200], [-232, 116], [-178, 120],
  [212, -186], [232, -170], [190, 176], [226, 150], [-185, -160], [-215, -140],
  [-14, 30], [14, 52], [0, 100], [0, -90],
]) {
  grove("leafLitter", x, z, 5, 3, ", scale: [0.9, 1.3], clearance: 0.6");
  drifts += 3;
}

section(scatter, "the riverbanks");
// Boulders along the channel, where the water breaks round them.
for (let x = -360; x <= 360; x += 30) {
  const z = zr(x) + (chance(0.5) ? 1 : -1) * rand(5, 9);
  if (Math.abs(x - BRIDGE_C.x) < 25 || Math.abs(x - BRIDGE_W.x) < 22 || Math.abs(x - BRIDGE_E.x) < 22) continue;
  scatter.push(`  { prop: "boulder", x: ${n2(x)}, z: ${n2(Number(z.toFixed(1)))}, radius: 4, count: 2, scale: [0.5, 0.9], blocking: true, clearance: 1.0 },`);
}
// Rocks round the koi pond and the hot spring — the reference frame's pond.
// Each is stood on the WATERLINE, found by marching out from the middle —
// the basin's skirt puts the shore well past its core radius, and a rock
// placed on the radius is a rock under the water.
for (const [b, level] of [[POND, 6], [ONSEN, 2]]) {
  const surface = level - 0.3;
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + 0.3;
    let r = 0;
    while (r < 30 && heightAt(b.x + Math.cos(a) * r, b.z + Math.sin(a) * r) < surface + 0.05) r += 0.25;
    const x = b.x + Math.cos(a) * (r + 0.6);
    const z = b.z + Math.sin(a) * (r + 0.6);
    scatter.push(`  { prop: "boulder", x: ${n2(Number(x.toFixed(1)))}, z: ${n2(Number(z.toFixed(1)))}, radius: 1.2, count: 1, scale: [0.45, 0.75], blocking: true, clearance: 0.4 },`);
  }
}

section(scatter, "the borderland");
// Past the square: non-blocking trees on the ground the leash runs you out
// over, so the woods do not stop at a line. Appended LAST — one seeded stream
// serves the whole build in authored order.
for (let k = 0; k < 64; k++) {
  const side = k % 4;
  const along = -HALF - 40 + (Math.floor(k / 4) / 15) * (PLAY + 80);
  const out = HALF + rand(18, MARGIN - 8);
  const [x, z] = [
    [along, out],
    [along, -out],
    [out, along],
    [-out, along],
  ][side];
  if (riverDist(x, z) < 26) continue;
  const prop = natural(x, z) > 12 && chance(0.5) ? "pine" : "maple";
  scatter.push(
    `  { prop: "${prop}", x: ${n2(Number(x.toFixed(1)))}, z: ${n2(Number(z.toFixed(1)))}, radius: 14, count: 7, scale: [0.9, 1.3] },`,
  );
}

// --- the water, the grass, the flags and the spawns ----------------------------

/**
 * One water body's rect, measured off the floor: the wet bounding box at the
 * stated surface, plus a margin of dry ground for the shoreline to be drawn
 * on. See Sarab's `waterBody`, which carries the argument.
 */
function waterRect(cx, cz, halfW, halfD, y, margin = 6) {
  const step = 1.5;
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  let deepest = 0;
  for (let x = cx - halfW; x <= cx + halfW; x += step) {
    for (let z = cz - halfD; z <= cz + halfD; z += step) {
      const d = y - heightAt(x, z);
      if (d <= 0) continue;
      deepest = Math.max(deepest, d);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      z0 = Math.min(z0, z);
      z1 = Math.max(z1, z);
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
    lo = Math.min(lo, zr(x));
    hi = Math.max(hi, zr(x));
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
    "  // single level surface is wet along all of it (Harrowmead's stream at",
    "  // twice the length), and it runs out through the borderland into the",
    "  // hills. A rect this deep is mostly dry bank — the floor decides where",
    "  // the water is, and the rect is only where it may be.",
    `  { x: ${n2(body.x)}, z: ${n2(body.z)}, width: ${n2(body.width)}, depth: ${n2(body.depth)}, y: ${n2(body.y)}, sound: "stream" },`,
  );
}
for (const [b, level, note] of [
  [POND, 6, "The temple's koi pond, dug into the court beside the hall."],
  [ONSEN, 2, "The inn's hot spring, dug into its garden."],
]) {
  const y = level - 0.3;
  const body = waterRect(b.x, b.z, b.rx + b.skirt + 3, b.rz + b.skirt + 3, y, 4);
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
  "  // flags, the riverbanks and the courts' margins — and it sums to about",
  "  // fifteen thousand tufts.",
];
{
  let tufts = 0;
  for (let gz = -HALF + 40; gz < HALF - 30; gz += 70) {
    for (let gx = -HALF + 40; gx < HALF - 30; gx += 70) {
      const x = gx + rand(-12, 12);
      const z = gz + rand(-12, 12);
      if (Math.abs(x) < 120 && Math.abs(z - 10) < 125) continue;
      const w = woodiness(x, z);
      if (w > 0.6 || chance(0.5)) continue;
      const density = Number(rand(0.1, 0.18).toFixed(2));
      grass.push(`  { x: ${n2(Number(x.toFixed(1)))}, z: ${n2(Number(z.toFixed(1)))}, width: 56, depth: 48, density: ${density} },`);
      tufts += 56 * 48 * density;
    }
  }
  // The riverbanks, where it is lush.
  for (let x = -330; x <= 330; x += 66) {
    if (Math.abs(x) < 130) continue;
    grass.push(`  { x: ${n2(x)}, z: ${n2(Number(zr(x).toFixed(1)))}, width: 60, depth: 44, density: 0.25 },`);
    tufts += 60 * 44 * 0.25;
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
  ["A", 0, -26, "0"],
  ["B", 0, 14, "Math.PI"],
  ["C", 0, 24, "Math.PI"],
  ["D", 0, 18, "Math.PI"],
  ["E", -8, -22, "0"],
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
 * \`heightAt\` in the generator): rolling ground; the temple mountain in the
 * north-west, the shrine hill in the south-east and a shoulder behind each
 * home yard; every district levelled by a weighted average; the river's
 * corridor levelled to the valley floor; and the channel, the koi pond and the
 * hot spring cut last. The river's bed is a constant ${-RIVER_DEPTH} m so one
 * level rect at ${RIVER_Y} is wet along its whole run, and its banks grade at
 * 0.15, so it is waded and driven anywhere.
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
 * control points, spawns, the hardstandings, the grass and the three bodies of
 * water. The water rects are MEASURED off the floor by the generator.
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
  VehicleSpawnDef,
  WaterRect,
} from "../layout";

/**
 * KURENAI — a temple town in a mountain valley, in the last week of the
 * maples, an hour before sunset.
 *
 * **${PLAY} x ${PLAY} m of PLAY inside ${PLAY + 2 * MARGIN} m of ground**, origin at the town's
 * plaza, +Z north. The third-largest map in the tree, with all three kinds of
 * vehicle and twenty bodies a side.
 *
 * \`\`\`
 *                                     N
 *   +-------------------------------------------------------------+  z 375
 *   |  the temple mountain                        x T1 HOME YARD   |
 *   |    [A] KOYO-JI (-205,150) +7m          [E] THE INN (205,162) |
 *   |     pagoda, hall, koi pond               teahouses, onsen    |
 *   |               ----- back lane -----                          |
 *   |               ----- north street -----                       |
 *   |                  [C] HASHIMOTO (0,42)                        |
 *   |  ~~~~~ bridge ~~~~~~~~~~~ ARCH BRIDGE ~~~~~~~~~ bridge ~~~~~ |  the river
 *   |               ----- south lane -----                         |
 *   |  [B] THE BREWERY (-205,-150)          [D] INARI SHRINE +15m   |
 *   |      kura round a yard                (222,-178) up the torii |
 *   |  x T0 HOME YARD                             the shrine hill   |
 *   +-------------------------------------------------------------+  z -375
 * \`\`\`
 *
 * ## The ground, which is what makes it read
 *
 * **The RIVER** runs west to east across the middle, a shallow stream in a
 * channel 24 m lip to lip, cut to one bed so a single rect is wet the whole
 * way: waded anywhere, driven anywhere (the banks are a 0.15 gradient), and
 * crossed on foot dry at three bridges — the vermilion ARCH on the main
 * street, and two plank bridges up and down stream. It separates the three
 * northern flags from the two southern ones without walling them off.
 * **The TEMPLE MOUNTAIN** stands 26 m over the north-west corner with the
 * precinct cut into its flank on a terrace seven metres over the town, and
 * **the SHRINE HILL** stands 18 m over the south-east with the shrine on its
 * crown and a tunnel of vermilion torii up the stone approach to it.
 * Everything else rolls a couple of metres, and the woods — maples, a few
 * thousand of them, with cedar on the high ground and bamboo in the hollows —
 * are sown by how HIGH the ground is and how near the river.
 *
 * ## Design intent per flag
 *
 * - **A Koyo-ji Temple** — a walled court behind a gate, a torii on the lane
 *   before it, the pagoda on one side and the bell on the other, the hall at
 *   the back and the koi pond beside it. The reference frame is its garden.
 *   The pagoda is the map's landmark and is not climbable.
 * - **B The Sake Brewery** — nine white storehouses round a working yard: the
 *   flag in the open between two rows of solid cover, with the brewer's house
 *   and the shop at the ends.
 * - **C Hashimoto** — the plaza at the north end of the arch bridge, in the
 *   middle of the town and the middle of the map; every other flag is 200 to
 *   300 m away. Streets of machiya on four sides, the river across the fifth.
 * - **D Inari Shrine** — fifteen metres up, at the top of a stone path under
 *   eighteen torii. The high ground on the south side, and the one flag a
 *   hull cannot easily take.
 * - **E The Hot Spring Inn** — an inn and its teahouses round a hot spring in
 *   a walled garden, the closest flag to T1 as the brewery is to T0.
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

/**
 * THREE hardstandings a side, in each home yard: a tank, a gun truck and a
 * helicopter — Sarab's arrangement and for Sarab's reasons (docs/vehicles.md).
 * The river is the map's answer to armour: fordable everywhere, fast nowhere,
 * and the town's streets are eight metres between two rows of doors.
 */
const vehicles: VehicleSpawnDef[] = [
${vehicles.join("\n")}
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
  vehicles,
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
   * Twenty a side: ${PLAY * PLAY} m^2 of play is between Harrowmead's and Sarab's,
   * and contact is bodies per square metre (see Sarab's note).
   */
  perTeam: 20,
  /** Sarab's S6 number for the merge; the floor's block is a whole number of cells. */
  blockSize: 96,
  terrainBlock: 75,
  /**
   * No wall: the valley carries on for ${MARGIN} m past the play square and the
   * leash is what stops you. The margin is the leash's floor with room over,
   * and no more, because what closes this horizon is the MOUNTAINS standing
   * on it — the rim below — and a landform closes a horizon at any distance
   * (Coldharbour's argument). Kept short so the ridges stand inside the haze
   * rather than past it: seen from the plaza they are the reference frame's
   * pale mountains, a silhouette two thirds of the way into the fog.
   * \`roll\` is bounded by the river running out through the margin (Greyfen's
   * rule): its bed is ${RIVER_DEPTH} m down and the roll may not lift it dry.
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
      { x: -${HALF + MARGIN}, z: ${n2(Number(zr(-HALF - MARGIN).toFixed(1)))}, width: 90, depth: 0.7 },
      { x: ${HALF + MARGIN}, z: ${n2(Number(zr(HALF + MARGIN).toFixed(1)))}, width: 90, depth: 0.7 },
    ],
    rolling: { relief: 0.35, summits: 16, knolls: 0.18, woods: 0.55 },
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
console.log(
  `kurenai: ${PLAY} m play + ${MARGIN} m margin = ${PLAY + 2 * MARGIN} m across\n` +
    `  ${placementCount} placements, ${scatterCount} scatter regions (~${trees} trees, ~${drifts} drifts), ${claimed.length} claims\n` +
    `  ${row}x${row} height vertices, ground ${lo.toFixed(2)}..${hi.toFixed(2)} m\n` +
    `  ${waterBodies.length} water bodies, deepest ${waterBodies.map((b) => b.deepest.toFixed(2)).join(" / ")} m\n` +
    `  steepest cell step ${worstStep.toFixed(2)} m (grade ${worstGrade.toFixed(3)}) at ${worstAt}\n` +
    `  wrote src/world/kurenai/{layout,heights}.ts`,
);
