/**
 * generate-candyland.mjs — SEEDS Candy Land: writes
 * `src/world/candyland/{layout,heights}.ts`.
 *
 * Run with `npm run candyland`, and owe `npm run collision -- candyland`
 * after it. Committed output, like every `heights.ts` and every collision
 * bake, and re-running it with the tree unchanged must produce the same bytes.
 *
 * Three flags for iterating on it: `--probe` prints the floor as a plan and
 * writes nothing, `--plan` prints the claim list as a plan, and `--refusals`
 * lists every plot that was refused and what refused it.
 *
 * ## What it is modelled on
 *
 * The 1962 Milton Bradley board (`reference-media/candyland-board.jpg`,
 * gitignored): START in the bottom-left corner, a rainbow path winding back
 * and forth up the board past Candy Hearts, the Peppermint Stick Forest, the
 * Gingerbread Plum Tree, Gumdrop Mountains and its Mountain Pass, the Crooked
 * Old Peanut Brittle House, the Lollypop Woods, the Ice Cream Floats and the
 * Molasses Swamp, to HOME SWEET HOME at the top — with the Rainbow Trail short
 * cut near the start.
 *
 * **The path is TRACED, not designed.** `PATH_PX` is its centreline read off
 * the board photograph in that picture's own pixels, START to HOME, a point
 * every space or so; `board()` is the one mapping from those pixels to the
 * map (0.245 m a pixel, the board's middle at the map's), so every landmark
 * below is written where the board draws it and the layout's plan is the
 * board's plan. The spaces are the board's order — purple, yellow, blue,
 * orange, green, red, round and round — with its picture spaces in lavender
 * and its three sticky spaces carrying their black dot, each put on the space
 * nearest where the board has it.
 *
 * ## How a board game became a battlefield
 *
 * - **Five flags on five landmarks**: A Home Sweet Home at the top, B the
 *   Peanut Brittle House on the left, C the Plum Tree in the middle, D the
 *   Gumdrop Mountains on the right, E Candy Hearts at the bottom. T0's home
 *   is START, bottom-left; T1's is the strip of lawn on the right under the
 *   Ice Cream Sea. Each side has two flags near it and the tree between.
 * - **The ground does the sightline work a board cannot**: Gumdrop Mountains
 *   are a real plateau three metres up with the Mountain Pass climbing it; the
 *   Ice Cream Sea is a wadeable basin the path runs along the shore of; the
 *   Molasses Swamp is a basin with a sheet of treacle in it; the plum tree
 *   stands on a low knoll.
 * - **Cover is candy**: gumdrops from knee- to house-high, peppermint sticks,
 *   lollipop woods, conversation hearts, chocolate bars, gingerbread men and
 *   cupcakes — all of it the board's own sweets at the scale of a person.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = join(root, "src", "world", "candyland");

// --- the extent --------------------------------------------------------------

/** The PLAY square. */
const PLAY = 300;
/** Ground past it — the leash's floor with room over. */
const MARGIN = 100;
/** Metres per heightfield cell. `CELLS * CELL` must equal `PLAY`. */
const CELL = 3;
const CELLS = PLAY / CELL;
const HALF = PLAY / 2;
const MAX_GRADE = 0.4;
/** The merge block's side: the play square in 2 x 2 (Kurenai's measurement). */
const BLOCK = 150;
/** A floor patch: twenty cells, so the square is five by five of them. */
const TERRAIN_BLOCK = 60;
/** How far the floor may fall across a footprint before a plot is refused. */
const FLAT = 0.4;

/** The candy path's width, the Rainbow Trail's and the Mountain Pass's. */
const PATH_W = 7;
const TRAIL_W = 4.2;
const PASS_W = 5;
/** A space's length along the path, near enough — the count is what is stated. */
const SPACE = 7.2;

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
const rng = mulberry32(0x43414e44);
const rand = (lo, hi) => lo + rng() * (hi - lo);
const pick = (list) => list[Math.floor(rng() * list.length)];

// --- the board -----------------------------------------------------------------

/** Board-photo pixels to map metres: +X right, +Z up the board (north). */
const PX = 0.245;
const board = (px, py) => [Number(((px - 610) * PX).toFixed(2)), Number(((990 - py) * PX).toFixed(2))];

/**
 * The path's centreline on the board, START to HOME, in the photograph's
 * pixels. Read a space at a time off `reference-media/candyland-board.jpg`.
 */
const PATH_PX = [
  [300, 1495], [350, 1485], [400, 1462], [440, 1427], [480, 1402], [530, 1395], [580, 1405], [612, 1422],
  [650, 1447], [700, 1467], [750, 1480], [800, 1487], [850, 1482], [895, 1466], [930, 1440], [950, 1402],
  [945, 1362], [918, 1332], [870, 1313], [810, 1303], [750, 1303], [690, 1308], [630, 1308], [570, 1305],
  [525, 1295], [497, 1268], [508, 1240], [545, 1230], [607, 1230], [673, 1224], [720, 1225], [773, 1228],
  [827, 1234], [873, 1239], [923, 1239], [973, 1236], [1013, 1226], [1053, 1206], [1097, 1180], [1128, 1150],
  [1140, 1113], [1141, 1067], [1133, 1027], [1117, 993], [1082, 961], [1037, 938], [987, 930], [940, 930],
  [897, 937], [853, 953], [822, 982], [799, 1030], [773, 1073], [740, 1106], [693, 1118], [647, 1121],
  [587, 1124], [547, 1140], [507, 1163], [470, 1184], [427, 1206], [380, 1190], [337, 1175], [287, 1181],
  [240, 1205], [193, 1231], [147, 1246], [102, 1240], [80, 1208], [88, 1166], [128, 1140], [180, 1126],
  [225, 1116], [285, 1101], [340, 1081], [383, 1056], [398, 1017], [362, 991], [305, 970], [265, 946],
  [246, 912], [252, 875], [282, 846], [330, 823], [380, 816], [430, 813], [480, 811], [530, 809],
  [573, 808], [623, 807], [667, 813], [720, 825], [767, 833], [813, 840], [860, 846], [907, 846],
  [953, 840], [1000, 827], [1047, 808], [1087, 776], [1107, 722], [1087, 676], [1040, 649], [1000, 627],
  [960, 593], [933, 553], [900, 515], [853, 494], [802, 518], [787, 560], [773, 605], [740, 640],
  [707, 672], [667, 693], [620, 718], [573, 728], [527, 738], [477, 743], [430, 745], [380, 743],
  [330, 738], [280, 732], [230, 722], [190, 700], [145, 672], [111, 633], [107, 593], [108, 555],
  [133, 517], [170, 489], [217, 480], [263, 487], [307, 505], [353, 532], [400, 555], [440, 573],
  [487, 593], [515, 606],
];
/**
 * Where the board's path ends is at the house's STEPS, round its left side;
 * the map carries it the last few metres to the door.
 */
const PATH_TAIL = [[-15.9, 92.6], [-7, 97.4], [0.5, 101.5]];

/** A Catmull-Rom curve through `pts`, sampled every `step` metres. */
function smoothPath(pts, step) {
  const out = [];
  const P = (i) => pts[Math.max(0, Math.min(pts.length - 1, i))];
  for (let i = 0; i + 1 < pts.length; i++) {
    const p0 = P(i - 1);
    const p1 = P(i);
    const p2 = P(i + 1);
    const p3 = P(i + 2);
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(1, Math.round(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a, b, c, d) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out.map(([x, z]) => [Number(x.toFixed(2)), Number(z.toFixed(2))]);
}

const PATH = smoothPath([...PATH_PX.map(([x, y]) => board(x, y)), ...PATH_TAIL], 3.5);
/** Arc length along the path at each point. */
const PATH_S = [0];
for (let i = 1; i < PATH.length; i++) {
  PATH_S.push(PATH_S[i - 1] + Math.hypot(PATH[i][0] - PATH[i - 1][0], PATH[i][1] - PATH[i - 1][1]));
}
const PATH_LEN = PATH_S[PATH_S.length - 1];

/** Distance from (x, z) to a polyline, and the arc length of the nearest point. */
function nearestOn(line, s, x, z) {
  let best = Infinity;
  let at = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
    if (d < best) {
      best = d;
      at = s ? s[i] + Math.sqrt(l2) * t : 0;
    }
  }
  return { d: best, s: at };
}
const pathDist = (x, z) => nearestOn(PATH, null, x, z).d;

/** The Rainbow Trail and the Mountain Pass, off the board likewise. */
const TRAIL = smoothPath([[438, 1420], [428, 1370], [412, 1310], [398, 1255], [388, 1205]].map(([x, y]) => board(x, y)), 3);
const PASS = smoothPath(
  [[862, 1226], [880, 1186], [903, 1143], [925, 1100], [950, 1060], [945, 1010], [925, 975], [915, 947]].map(([x, y]) => board(x, y)),
  3,
);

// --- the floor ---------------------------------------------------------------

const smooth = (t) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};

function hash2(i, j, seed) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

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

const bell = (d, radius) => (d >= radius ? 0 : (Math.cos((Math.PI * d) / radius) + 1) / 2);

/**
 * GUMDROP MOUNTAINS: a plateau three metres up, flat across its top so the
 * gumdrops stand level, easing down to the lawn inside the path's loop round
 * it. The Mountain Pass climbs it. 3.2 over an ease of 16 m is a 0.31 grade
 * at its steepest, which walks.
 */
const MESA = { x: 88, z: -24, flat: 14, ease: 16, h: 3.2 };
/** The plum tree's knoll, so the landmark stands over the lawn. */
const KNOLL = { x: -3, z: 4, r: 34, h: 1.3 };
/** The Lollypop Woods' swell. */
const SWELL = { x: 70, z: 64, r: 30, h: 0.9 };

/**
 * THE ICE CREAM SEA's surface, and how deep it gets. Wadeable everywhere —
 * there is no swimming in this game — and deep enough in the middle that a
 * body wading it is up to its chest.
 */
const SEA_Y = -0.35;
const SEA_DEPTH = 1.9;
/** The beach between the path's edge and the water. */
const SEA_SHORE = 7.5;
const SEA_SHELF = 12;
/** The part of the path the sea is the far side of: the ice cream loop. */
const SEA_LINE = [board(787, 560), board(802, 518), board(853, 494), board(900, 515), board(933, 553), board(960, 593), board(1000, 627), board(1040, 649), board(1087, 676), board(1107, 722)];

/** How much of the sea's depth reaches (x, z), 0..1. */
function seaMask(x, z) {
  // North of the loop's south-east end and east of its west one...
  const [ax, az] = SEA_LINE[0];
  const [bx, bz] = SEA_LINE[SEA_LINE.length - 1];
  const nx = -(bz - az);
  const nz = bx - ax;
  const nl = Math.hypot(nx, nz);
  const side = ((x - ax) * nx + (z - az) * nz) / nl;
  // Strictly past the loop: its inside is lawn, and water there would be a
  // second pond cut off from the sea by the path's own causeway.
  const m =
    smooth((side - 2) / 8) *
    smooth((x - 40) / 10) *
    smooth((z - 70) / 8) *
    smooth((HALF - 6 - x) / 10) *
    smooth((HALF - 6 - z) / 10);
  if (m <= 0) return 0;
  // ...and off the path's own shore.
  const d = nearestOn(SEA_LINE, null, x, z).d;
  return m * smooth((d - SEA_SHORE) / SEA_SHELF);
}

/** THE MOLASSES SWAMP: a basin inside the path's loop at the top-left. */
const SWAMP = { x: -95, z: 93, rx: 12, rz: 10, skirt: 6, depth: 1.2 };
/** The treacle's surface. */
const SWAMP_Y = -0.25;

/** Places that have to be level: the houses' plots and the two home yards. */
const DISTRICTS = [
  { name: "home sweet home", x: 5, z: 113, hw: 14, hd: 11, skirt: 12 },
  { name: "brittle house", x: -118, z: 22, hw: 9, hd: 10, skirt: 10 },
  { name: "start", x: -110, z: -118, hw: 14, hd: 14, skirt: 12 },
  { name: "t1 yard", x: 137, z: 57, hw: 7, hd: 12, skirt: 8 },
];

/** Rolling lawn and the landforms, before anything is levelled or dug. */
function natural(x, z) {
  let h = 0.45 + 0.32 * vnoise(x, z, 70, 21) + 0.14 * vnoise(x, z, 27, 22);
  h += KNOLL.h * bell(Math.hypot(x - KNOLL.x, z - KNOLL.z), KNOLL.r);
  h += SWELL.h * bell(Math.hypot(x - SWELL.x, z - SWELL.z), SWELL.r);
  const dm = Math.hypot(x - MESA.x, z - MESA.z);
  h += MESA.h * (1 - smooth((dm - MESA.flat) / MESA.ease));
  return h;
}
for (const d of DISTRICTS) d.level = Math.round(natural(d.x, d.z) * 4) / 4;

function rectDist(x, z, r) {
  const dx = Math.max(Math.abs(x - r.x) - r.hw, 0);
  const dz = Math.max(Math.abs(z - r.z) - r.hd, 0);
  return Math.hypot(dx, dz);
}

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
  if (wsum <= 0) return base;
  return base + (hsum / wsum - base) * Math.min(1, wsum);
}

function swampCut(x, z) {
  const e = Math.hypot((x - SWAMP.x) / SWAMP.rx, (z - SWAMP.z) / SWAMP.rz);
  const d = (e - 1) * Math.min(SWAMP.rx, SWAMP.rz);
  if (d >= SWAMP.skirt) return 0;
  if (d <= 0) return SWAMP.depth;
  return SWAMP.depth * (1 - smooth(d / SWAMP.skirt));
}

function heightAt(x, z) {
  let h = land(x, z);
  const sea = seaMask(x, z);
  if (sea > 0) h -= SEA_DEPTH * sea;
  return h - swampCut(x, z);
}

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

function grade(x, z) {
  const e = 2;
  return Math.max(
    Math.abs(heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e),
    Math.abs(heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e),
  );
}

/** True where the floor is under the sea or the treacle (plus a margin). */
function wet(x, z, margin = 0.2) {
  if (seaMask(x, z) > 0 && heightAt(x, z) < SEA_Y + margin) return true;
  if (swampCut(x, z) > 0 && heightAt(x, z) < SWAMP_Y + margin) return true;
  return false;
}

if (process.argv.includes("--probe")) {
  const step = 10;
  const cols = [];
  for (let x = -HALF; x <= HALF; x += step) cols.push(String(x).padStart(5));
  console.log("  z|x " + cols.join(""));
  for (let z = HALF; z >= -HALF; z -= step) {
    let line = String(z).padStart(5) + " ";
    for (let x = -HALF; x <= HALF; x += step) {
      const g = grade(x, z);
      const mark = wet(x, z) ? "~" : pathDist(x, z) < PATH_W / 2 ? "=" : g > 0.3 ? "!" : " ";
      line += (heightAt(x, z).toFixed(1) + mark).padStart(5);
    }
    console.log(line);
  }
  console.log(`path ${PATH_LEN.toFixed(0)} m, ${PATH.length} points`);
  process.exit(0);
}

// --- what is already there ---------------------------------------------------

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
  if (Math.max(Math.abs(x0), Math.abs(x1)) > HALF - 4) return false;
  if (Math.max(Math.abs(z0), Math.abs(z1)) > HALF - 4) return false;
  return !overlaps(x0, x1, z0, z1);
}

function claim(x, z, w, d, pad = 0, type = "solid") {
  claimed.push({ x0: x - w / 2 - pad, x1: x + w / 2 + pad, z0: z - d / 2 - pad, z1: z + d / 2 + pad, type });
}

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
/** Turn 0 faces SOUTH (a builder's front is its local -Z), 1 WEST, 2 NORTH, 3 EAST. */
const FACES = { south: 0, west: 1, north: 2, east: 3 };

function paramText(params) {
  if (!params) return "";
  return Object.entries(params)
    .map(([k, v]) => {
      const lit = typeof v === "string" ? JSON.stringify(v) : typeof v === "boolean" ? String(v) : n2(v);
      return `${k}: ${lit}`;
    })
    .join(", ");
}

/**
 * Emit one placement, claiming its footprint first. `w` and `d` are the
 * builder's local extents; an odd turn swaps them. `opts.rot` is a free yaw
 * in radians instead of a quarter `turn` (its footprint is then the circle's
 * box). Refused on a claim, a slope or water unless forced.
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
  const rot = opts.rot !== undefined ? `, rotY: ${n2(opts.rot)}` : TURN[turn];
  placements.push(`  { kind: "${kind}", x: ${n2(x)}, z: ${n2(z)}${y}${rot}` + (ps ? `, params: { ${ps} }` : "") + " },");
  return true;
}

function must(kind, x, z, turn, w, d, params, opts = {}) {
  if (place(kind, x, z, turn, w, d, params, opts)) return;
  throw new Error(
    `set piece: ${kind} at (${x.toFixed(0)}, ${z.toFixed(0)}) was refused — ` +
      refused[refused.length - 1] + ". Move the piece.",
  );
}

/**
 * `place`, tried where it was meant to go and then on rings round it: a piece
 * of cover authored off the board's picture lands on the path about as often
 * as not, and a few metres either way is still where the board has it.
 */
function placeNear(kind, x, z, turn, w, d, params, opts = {}, reach = 6) {
  const offs = [[0, 0]];
  for (const r of [2.5, 4.5, reach]) {
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      offs.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
  }
  const before = refused.length;
  for (const [dx, dz] of offs) {
    const px = Number((x + dx).toFixed(1));
    const pz = Number((z + dz).toFixed(1));
    if (place(kind, px, pz, turn, w, d, params, opts)) {
      refused.length = before;
      return true;
    }
  }
  refused.length = before;
  refused.push(`${kind} at (${x.toFixed(0)}, ${z.toFixed(0)}) nowhere within ${reach} m`);
  return false;
}

function section(list, title) {
  const bar = "=".repeat(Math.max(4, 74 - title.length));
  list.push(`  // ===== ${title} ${bar}`);
}

/** A path road through world points, claimed as squares along its line. */
function pathRoad(points, w, surface, extra = {}) {
  const xs = points.map((p) => p[0]);
  const zs = points.map((p) => p[1]);
  const cx = Number(((Math.min(...xs) + Math.max(...xs)) / 2).toFixed(2));
  const cz = Number(((Math.min(...zs) + Math.max(...zs)) / 2).toFixed(2));
  for (let i = 0; i + 1 < points.length; i++) {
    const [ax, az] = points[i];
    const [bx, bz] = points[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(len / 2.5));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      claim(x, z, w, w, 0.6, "road");
      if (wet(x, z, 0.05)) throw new Error(`road: a ${surface} road runs into the water near (${x.toFixed(1)}, ${z.toFixed(1)})`);
    }
  }
  const local = points.map((p) => `[${n2(Number((p[0] - cx).toFixed(2)))}, ${n2(Number((p[1] - cz).toFixed(2)))}]`);
  const ps = paramText(extra);
  placements.push(
    `  { kind: "road", x: ${n2(cx)}, z: ${n2(cz)}, ` +
      `params: { path: [${local.join(", ")}], width: ${n2(w)}, surface: "${surface}"${ps ? ", " + ps : ""} } },`,
  );
}

// --- the flags and the homes ---------------------------------------------------

const FLAGS = [
  { id: "A", name: "Home Sweet Home", x: 20, z: 86, r: 12 },
  { id: "B", name: "Peanut Brittle House", x: -101, z: 12, r: 11 },
  { id: "C", name: "Gingerbread Plum Tree", x: -3, z: -8, r: 13 },
  // The plateau's top IS the ring, and the gumdrops standing in it are the
  // fight — so D keeps only its own point clear, not its whole ring.
  { id: "D", name: "Gumdrop Mountains", x: 88, z: -22, r: 12, clear: 9 },
  { id: "E", name: "Candy Hearts", x: 45, z: -134, r: 11 },
];
const byId = Object.fromEntries(FLAGS.map((f) => [f.id, f]));

/** `s` is how each yard's three spawns are stepped out. */
const HOMES = [
  { team: 0, x: -112, z: -118, dx: [0, 6, -6], dz: [0, 6, -6], yaw: "Math.PI / 4" },
  { team: 1, x: 138, z: 57, dx: [0, 0, 0], dz: [0, 8, -8], yaw: "-Math.PI * 0.6" },
];

// --- the path, first, because everything else stands off it ----------------------

section(placements, "the path");
placements.push(
  "  // The board's own rainbow path, traced off the 1962 board START to HOME.",
  "  // Visual only, like every road: no collider, no nav, no cover — but it is in",
  "  // the road footprint, so nothing grows through it. `tiles` is the spaces in",
  "  // order, the board's colour cycle with its picture spaces in lavender (`l`)",
  "  // and its sticky spaces carrying a black dot (a capital).",
);

/** The spaces: the board's cycle, with its specials on the nearest space. */
const SPACES = Math.round(PATH_LEN / SPACE);
const tiles = [];
for (let i = 0; i < SPACES; i++) tiles.push("pybogr"[i % 6]);
/** Where the board's picture and sticky spaces are, in its own pixels. */
const SPECIALS = [
  { px: [612, 1422], ch: "l", note: "candy hearts" },
  { px: [607, 1230], ch: "l", note: "gingerbread" },
  { px: [1117, 993], ch: "l", note: "candy corn" },
  { px: [853, 953], ch: "B", note: "cherry pitfall" },
  { px: [398, 1017], ch: "l", note: "peanut brittle" },
  { px: [623, 807], ch: "R", note: "cherry pitfall" },
  { px: [1087, 776], ch: "l", note: "lollypop" },
  { px: [853, 494], ch: "l", note: "ice cream" },
  { px: [145, 672], ch: "B", note: "molasses swamp" },
];
for (const sp of SPECIALS) {
  const [x, z] = board(sp.px[0], sp.px[1]);
  const { s } = nearestOn(PATH, PATH_S, x, z);
  const k = Math.min(SPACES - 1, Math.floor((s / PATH_LEN) * SPACES));
  tiles[k] = sp.ch;
  sp.at = k;
}
pathRoad(PATH, PATH_W, "candy", { tiles: tiles.join("") });

section(placements, "the short cuts");
placements.push(
  "  // The Rainbow Trail — bands of colour laid the length of it — and the",
  "  // Mountain Pass, a track up through the gumdrops. Both end ON the path, so",
  "  // the network paves each end as a junction in the path's own cream.",
);
pathRoad(TRAIL, TRAIL_W, "candy", { stripes: "roygbp" });
pathRoad(PASS, PASS_W, "dirt");

// The flags, the homes and the basins claim before any building does.
for (const f of FLAGS) claim(f.x, f.z, f.clear ?? f.r * 2, f.clear ?? f.r * 2, 0, "low");
claim(SWAMP.x, SWAMP.z, (SWAMP.rx + SWAMP.skirt) * 2, (SWAMP.rz + SWAMP.skirt) * 2, 0, "low");

const spawns = [];
for (const h of HOMES) {
  for (let i = 0; i < 3; i++) {
    const x = h.x + h.dx[i];
    const z = h.z + h.dz[i];
    claim(x, z, 6, 6, 0, "low");
    if (wet(x, z)) throw new Error(`spawn: a home spawn at (${x}, ${z}) is in the water`);
    spawns.push(`  { team: ${h.team}, pos: new Vector3(${n2(x)}, ${n2(Number(heightAt(x, z).toFixed(2)))}, ${n2(z)}), yaw: ${h.yaw} },`);
  }
}

// --- A — Home Sweet Home ---------------------------------------------------------

section(placements, "A: Home Sweet Home");
{
  // The house the path ends at, facing down the board, its door where the
  // path's last space is.
  must("gingerbreadHouse", 5, 114.5, 0, 19.6, 15, { width: 18, depth: 13, enterable: true, text: "HOME|SWEET|HOME" }, { pad: 0.5 });
  // The peppermint fence: across the front either side of the way in.
  place("candyFence", -12, 104, 0, 10, 0.5, { length: 10 }, { pad: 0.2, flat: 0.5 });
  place("candyFence", 22, 104, 0, 14, 0.5, { length: 14 }, { pad: 0.2, flat: 0.5 });
  // The board's ice cream stand by the right-hand window: cones and a cupcake.
  for (const [x, z, tint] of [[18.5, 108.5, "#ee8da4"], [21, 112, "#6e3f22"], [18.5, 115.5, "#bfe6c2"]]) {
    placeNear("iceCreamCone", x, z, 0, 1.6, 1.6, { height: 3.4, tint }, { pad: 0.3 });
  }
  placeNear("cupcake", -9, 109, 0, 2.2, 2.2, { height: 2.8 }, { pad: 0.3 });
  placeNear("cupcake", 26, 96, 0, 2.2, 2.2, { height: 2.4, tint: "#f39ab5" }, { pad: 0.3 });
  // The lawn in front: cover you can fight the yard from.
  placeNear("chocolateBar", 32, 84, 1, 6, 0.8, { length: 6 }, { pad: 0.4 });
  placeNear("chocolateBar", 6, 76, 0, 6, 0.8, { length: 6 }, { pad: 0.4 });
  placeNear("candyCorn", 34, 70, 0, 2, 2, null, { pad: 0.4 });
  placeNear("gingerbreadMan", -18, 84, 0, 2.6, 0.6, null, { pad: 0.4 });
  place("signpost", -28, 76, 0, 1.2, 1.2, { text: "16 MILES" }, { pad: 0.3, noClaim: true });
}

// --- B — the Crooked Old Peanut Brittle House -----------------------------------------

section(placements, "B: Peanut Brittle House");
{
  // The house on the board's left edge, its door toward the path's bend.
  must("brittleHouse", -118, 22, FACES.east, 10.6, 11, { width: 10, depth: 9, enterable: true }, { pad: 0.5 });
  // The yard between the house and the path: brittle slabs, a gumdrop and
  // chocolate for cover.
  placeNear("chocolateBar", -104, 30, 1, 5, 0.8, { length: 5, tint: "#a8642a" }, { pad: 0.4 });
  placeNear("chocolateBar", -108, -4, 0, 6, 0.8, { length: 6, tint: "#a8642a" }, { pad: 0.4 });
  place("gumdrop", -128, 2, 0, 5, 5, { height: 3.8, tint: "#efbd2a" }, { pad: 0.4, anySlope: true });
  place("gumdrop", -131, 42, 0, 6, 6, { height: 4.6, tint: "#3d9e48" }, { pad: 0.4, anySlope: true });
  placeNear("cupcake", -122, 8, 0, 2, 2, { height: 2.4, tint: "#f6d27a" }, { pad: 0.3 });
  place("signpost", -66, 22, 0, 1.2, 1.2, { text: "59 MILES" }, { pad: 0.3, noClaim: true });
}

// --- C — the Gingerbread Plum Tree ----------------------------------------------------

section(placements, "C: Gingerbread Plum Tree");
{
  // The tree on its knoll in the middle of the board, the gingerbread man in
  // its trunk looking down toward START.
  must("plumTree", -3, 4, 0, 6, 6, null, { pad: 0.5, force: true });
  claim(-3, 4, 7, 7, 0, "solid");
  // Cover round the lawn under it: the board has none, a shooter needs it.
  placeNear("gingerbreadMan", -24, 12, 0, 2.6, 0.6, null, { pad: 0.4 });
  placeNear("gingerbreadMan", 22, 0, 3, 2.6, 0.6, null, { pad: 0.4 });
  placeNear("chocolateBar", -19, -16, 0, 6, 0.8, { length: 6 }, { pad: 0.4 });
  placeNear("chocolateBar", 16, 18, 1, 6, 0.8, { length: 6 }, { pad: 0.4 });
  placeNear("chocolateBar", 14, -20, 0, 5, 0.8, { length: 5, tint: "#4a2918" }, { pad: 0.4 });
  placeNear("cupcake", -28, -4, 0, 2.2, 2.2, { height: 2.6, tint: "#f39ab5" }, { pad: 0.3 });
  placeNear("cupcake", 26, 22, 0, 2.2, 2.2, { height: 2.4 }, { pad: 0.3 });
  placeNear("candyCorn", 30, -12, 0, 2, 2, { height: 2.8 }, { pad: 0.3 });
  placeNear("candyCorn", -32, 24, 0, 2, 2, { height: 2.4 }, { pad: 0.3 });
  placeNear("iceCreamCone", -12, 28, 0, 1.6, 1.6, { height: 3.0, tint: "#6e3f22" }, { pad: 0.3 });
  place("signpost", 10, -44, 0, 1.2, 1.2, { text: "76 MILES" }, { pad: 0.3, noClaim: true });
  // The gingerbread space's own man, at the path's edge by it.
  const [gx, gz] = board(607, 1262);
  placeNear("gingerbreadMan", gx, gz, 0, 2.6, 0.6, { height: 2.6 }, { pad: 0.3 });
}

// --- D — Gumdrop Mountains -----------------------------------------------------------

section(placements, "D: Gumdrop Mountains");
{
  // The range on its plateau, where the board draws each one, in its colours.
  const G = ["#d3263a", "#ef7b22", "#efbd2a", "#3d9e48", "#7a3aa6"];
  const drops = [
    [855, 1070, 11, 0], [910, 1038, 9, 3], [960, 1065, 8.5, 1], [1003, 1040, 10, 4],
    [985, 1108, 9.5, 3], [1060, 1110, 11, 0], [1050, 1180, 8.5, 2], [925, 1160, 10, 0],
    [1015, 985, 7, 2], [870, 1130, 7.5, 4], [1085, 1045, 7, 1],
  ];
  for (const [px, py, h, c] of drops) {
    const [x, z] = board(px, py);
    const r = h * 0.62;
    placeNear("gumdrop", x, z, 0, r * 1.5, r * 1.5, { height: h, tint: G[c] }, { pad: 0.2, anySlope: true }, 5);
  }
  place("signpost", 122, 22, 0, 1.2, 1.2, { text: "98 MILES" }, { pad: 0.3, noClaim: true });
  // The candy corn space's own corn, at the path's edge by it.
  const [cx, cz] = board(1085, 995);
  placeNear("candyCorn", cx, cz, 0, 2, 2, { height: 3 }, { pad: 0.3, anySlope: true });
}

// --- E — Candy Hearts and the Peppermint Stick Forest -----------------------------------

section(placements, "E: Candy Hearts");
{
  // The conversation hearts, below the path along the board's bottom edge as
  // the board has them, and a couple more inside the path's last loop.
  //
  // Each faces up the board toward the path it is read from, turned toward
  // the north-east: a heart's face is the one thing here that must be LIT to
  // be read, and the sun is in the south-east — due north puts every motto in
  // its own shadow.
  const hearts = [
    [16, -134, "I|LOVE|YOU", "#f28bb0", 0.25],
    [29, -141, "BE|MINE", "#f4d257", -0.15],
    [63, -140, "SWEET|HEART", "#8fdc98", 0.2],
    [76, -131, "HUG|ME", "#c3a0ee", -0.3],
    [38, -96, "XOXO", "#f9ad74", 0.35],
    [58, -104, "MY|LOVE", "#f28bb0", -0.2],
    [-8, -134, "KISS|ME", "#f7f1ec", 0.1],
  ];
  for (const [x, z, text, tint, jitter] of hearts) {
    const rot = Number((-Math.PI * 0.75 + jitter).toFixed(2));
    place("candyHeart", x, z, 0, 3.6, 3.6, { width: 3.4, tint, text }, { pad: 0.4, rot });
  }
  place("signpost", 20, -103, 0, 1.2, 1.2, { text: "127 MILES" }, { pad: 0.3, noClaim: true });
  // The Peppermint Stick Forest: the big canes in the bottom-right corner.
  const canes = [
    [100, -72, 11], [113, -80, 9], [127, -70, 12], [104, -94, 10], [120, -99, 12.5],
    [134, -88, 9], [110, -115, 11], [127, -121, 9.5], [96, -128, 8], [138, -108, 10.5], [117, -136, 9],
  ];
  for (const [x, z, h] of canes) {
    place("candyCane", x, z, 0, 1.4, 1.4, { height: h }, { pad: 0.6, rot: Number(rand(0, Math.PI * 2).toFixed(2)) });
  }
}

// --- START --------------------------------------------------------------------------

section(placements, "START");
{
  // The sign, and the board's four playing pieces waiting on the grass —
  // gingerbread men in red, green, yellow and blue.
  place("signpost", -84, -112, 0, 1.2, 1.2, { text: "START" }, { pad: 0.3, noClaim: true });
  const pawns = [["#c8323a", -92, -128], ["#3d9e48", -98, -124], ["#efbd2a", -93, -134], ["#3a6fd0", -99, -131]];
  for (const [tint, x, z] of pawns) {
    placeNear("gingerbreadMan", x, z, 0, 2.6, 0.6, { height: 3, tint }, { pad: 0.3, rot: Number((Math.PI * 0.35 + rand(-0.2, 0.2)).toFixed(2)) });
  }
  placeNear("chocolateBar", -120, -100, 1, 6, 0.8, { length: 6 }, { pad: 0.4 });
  place("gumdrop", -134, -96, 0, 4, 4, { height: 3.4, tint: "#7a3aa6" }, { pad: 0.4, anySlope: true });
}

// --- the Ice Cream Sea, the Lollypop Woods, the Molasses Swamp ------------------------

section(placements, "the Ice Cream Sea");
/** Points in the sea at least `deep` under its surface, on a lattice. */
function seaSpots(deep) {
  const out = [];
  for (let z = 72; z < HALF - 6; z += 4) {
    for (let x = 42; x < HALF - 6; x += 4) {
      if (seaMask(x, z) > 0 && SEA_Y - heightAt(x, z) > deep) out.push([x, z]);
    }
  }
  return out;
}
{
  // The ice cream floats: Neapolitan bars riding with half a metre out of the
  // water, and the popsicle buoy. Each is stood on the bed so its waterline
  // is the sea's surface.
  const floats = [[100, 122, 8, 0.3], [124, 108, 6, -0.5], [78, 136, 6.5, 0.1], [130, 132, 5.5, 0.9], [110, 142, 5, -0.2]];
  const deep = seaSpots(0.9);
  for (const [fx, fz, len, rot] of floats) {
    // The nearest properly deep spot to where it was meant to be.
    let best = null;
    for (const s of deep) {
      const d = Math.hypot(s[0] - fx, s[1] - fz);
      if (!best || d < best.d) best = { d, x: s[0], z: s[1] };
    }
    if (!best || best.d > 14) continue;
    const y = SEA_Y - 1.25 - heightAt(best.x, best.z);
    place("iceCreamFloat", best.x, best.z, 0, len + 2, len + 2, { length: len }, { pad: 0.5, wetOk: true, anySlope: true, rot, y });
  }
  // The buoy: the deep spot nearest where the board stands it that is clear
  // of every float.
  const [bx, bz] = board(1105, 560);
  const buoys = seaSpots(0.6).sort((a, c) => Math.hypot(a[0] - bx, a[1] - bz) - Math.hypot(c[0] - bx, c[1] - bz));
  for (const [x, z] of buoys) {
    const before = refused.length;
    if (place("popsicle", x, z, 0, 3, 3, { height: 6.5 }, { pad: 0.5, wetOk: true, anySlope: true, rot: 0.6, y: Number((SEA_Y - 0.3 - heightAt(x, z)).toFixed(2)) })) break;
    refused.length = before;
  }
}

section(placements, "the Molasses Swamp");
{
  // The treacle sheet over its basin, level at its own surface.
  must("molasses", SWAMP.x, SWAMP.z, 0, 1, 1, { width: (SWAMP.rx + 3) * 2, depth: (SWAMP.rz + 3) * 2 }, {
    force: true,
    noClaim: true,
    y: Number((SWAMP_Y - heightAt(SWAMP.x, SWAMP.z)).toFixed(2)),
  });
}

section(placements, "the lawns");
{
  // Knee-to-chest cover across the rest of the board: chocolate bars, and the
  // odd cupcake and gingerbread man, where a lane between two rows of the
  // path would otherwise be a shooting gallery.
  const spots = [
    [-60, 60, "chocolateBar"], [-40, 48, "cupcake"], [-78, 56, "chocolateBar"],
    [-58, -40, "chocolateBar"], [-30, -44, "gingerbreadMan"], [-80, -48, "cupcake"],
    [-120, -60, "chocolateBar"], [-100, -75, "gumdrop"], [-40, -72, "chocolateBar"],
    [30, -66, "chocolateBar"], [60, -70, "cupcake"], [-10, -88, "chocolateBar"],
    [40, 30, "chocolateBar"], [60, 22, "gingerbreadMan"], [30, 48, "cupcake"],
    [-130, -20, "chocolateBar"], [-60, 98, "gumdrop"], [-40, 110, "chocolateBar"],
    [-130, 135, "gumdrop"], [-60, 132, "cupcake"], [60, -40, "chocolateBar"],
  ];
  for (const [x, z, kind] of spots) {
    const turn = Math.floor(rng() * 2);
    if (kind === "chocolateBar") placeNear(kind, x, z, turn, 6, 0.8, { length: 6 }, { pad: 0.5 });
    else if (kind === "gumdrop") placeNear(kind, x, z, 0, 5, 5, { height: Number(rand(3.2, 4.6).toFixed(1)), tint: pick(["#d3263a", "#ef7b22", "#efbd2a", "#3d9e48", "#7a3aa6"]) }, { pad: 0.5, anySlope: true });
    else if (kind === "cupcake") placeNear(kind, x, z, 0, 2.2, 2.2, { height: 2.6, tint: pick(["#7cc5e8", "#f39ab5", "#f6d27a", "#bfe6c2"]) }, { pad: 0.4 });
    else placeNear(kind, x, z, turn, 2.6, 0.6, null, { pad: 0.4 });
  }
}

// --- scatter -------------------------------------------------------------------------

/** Whether a region of radius `r` may be sown at (x, z): dry, off the flags. */
function regionOk(x, z, r, maxGrade = 0.33, offRoads = false) {
  if (Math.abs(x) + r > HALF - 3 || Math.abs(z) + r > HALF - 3) return false;
  // A region may stand over the path and over buildings — `findSpot` keeps a
  // prop out of every collider, and a ROOTED one off every road. A sweet that
  // lands (`offRoads`) is not held off a road by anything, so its region is.
  const skip = offRoads ? (c) => c.type === "solid" : (c) => c.type !== "low";
  if (overlaps(x - r, x + r, z - r, z + r, skip)) return false;
  for (let k = 0; k <= 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const f = k === 12 ? 0 : 1;
    const px = x + f * Math.cos(a) * (r + 1);
    const pz = z + f * Math.sin(a) * (r + 1);
    if (wet(px, pz, 0.3)) return false;
    if (grade(px, pz) > maxGrade) return false;
  }
  return true;
}

function region(prop, x, z, r, count, extra = "") {
  scatter.push(`  { prop: "${prop}", x: ${n2(Number(x.toFixed(1)))}, z: ${n2(Number(z.toFixed(1)))}, radius: ${n2(r)}, count: ${count}${extra} },`);
}

const LOLLI = ", scale: [0.85, 1.2], blocking: true, clearance: 1.7";
const PEPPER = ", scale: [0.85, 1.25], blocking: true, clearance: 1.3";
const GUMDROPS = ", scale: [0.8, 1.35], blocking: true, clearance: 1.4";
let props = 0;

section(scatter, "the Lollypop Woods");
// The woods under the Ice Cream Sea: every gap between the two rows of the
// path there, and the lawn in the loop's bend. A region may stand over the
// path — a lollipop is rooted, so none is sown on it.
for (let gz = 40; gz <= 96; gz += 11) {
  for (let gx = 22; gx <= 124; gx += 11) {
    const x = gx + rand(-3, 3);
    const z = gz + rand(-3, 3);
    if (!regionOk(x, z, 7)) continue;
    const n = 4;
    region("lollipop", x, z, 7, n, LOLLI);
    props += n;
  }
}

section(scatter, "the Peppermint Stick Forest");
for (let gz = -140; gz <= -64; gz += 10) {
  for (let gx = 40; gx <= 142; gx += 10) {
    const x = gx + rand(-3, 3);
    const z = gz + rand(-3, 3);
    // The big canes are the corner's; the small ones fill it and the loop.
    const inCorner = x > 88;
    const inLoop = x > 30 && x < 78 && z > -112 && z < -84;
    if (!inCorner && !inLoop) continue;
    if (!regionOk(x, z, 6)) continue;
    region("peppermint", x, z, 6, inCorner ? 4 : 3, PEPPER);
    region("mintLeaf", x, z, 6, 4, ", scale: [0.9, 1.4], clearance: 0.8");
    props += 8;
  }
}

section(scatter, "Gumdrop Mountains");
// Little gumdrops over the plateau and round its foot, between the big ones.
for (let k = 0; k < 16; k++) {
  const a = (k / 16) * Math.PI * 2 + rand(-0.2, 0.2);
  const r = rand(6, 26);
  const x = MESA.x + Math.cos(a) * r;
  const z = MESA.z + Math.sin(a) * r;
  if (!regionOk(x, z, 4, 0.36, true)) continue;
  region("gumdropSmall", x, z, 4, 3, GUMDROPS);
  props += 3;
}

section(scatter, "the Molasses Swamp");
// Cattails round the treacle's edge, where the board plants them — walked out
// to the real shore, as Kurenai's pond rocks are.
for (let k = 0; k < 10; k++) {
  const a = (k / 10) * Math.PI * 2 + 0.2;
  let r = 0;
  while (r < 30 && heightAt(SWAMP.x + Math.cos(a) * r, SWAMP.z + Math.sin(a) * r) < SWAMP_Y + 0.05) r += 0.25;
  const x = SWAMP.x + Math.cos(a) * (r + 1.5);
  const z = SWAMP.z + Math.sin(a) * (r + 1.5);
  if (pathDist(x, z) < PATH_W / 2 + 2) continue;
  region("cattail", x, z, 2.5, 3, ", scale: [0.9, 1.3], clearance: 0.6");
  props += 3;
}

section(scatter, "the lawns");
// Gumdrops for cover, and jelly beans spilt everywhere — the lawn's colour.
for (let gz = -HALF + 14; gz < HALF - 8; gz += 26) {
  for (let gx = -HALF + 14; gx < HALF - 8; gx += 26) {
    const x = gx + rand(-6, 6);
    const z = gz + rand(-6, 6);
    if (regionOk(x, z, 6, 0.33, true)) {
      region("gumdropSmall", x, z, 6, 2, GUMDROPS);
      props += 2;
    }
    const bx = x + rand(-8, 8);
    const bz = z + rand(-8, 8);
    if (regionOk(bx, bz, 6, 0.08)) {
      region("jellyBeans", bx, bz, 6, 2, ", scale: [0.9, 1.2], clearance: 1.2");
      props += 2;
    }
  }
}

// --- the water, the grass, the flags and the spawns ----------------------------

/**
 * The sea's rect, measured off the floor: the bounding box of the wet ground
 * connected to a point in the middle of it, plus a margin — Kurenai's
 * `waterRect`, which carries the argument.
 */
function waterRect(cx, cz, halfW, halfD, y, margin = 4) {
  const step = 0.75;
  const nx = Math.floor((2 * halfW) / step) + 1;
  const nz = Math.floor((2 * halfD) / step) + 1;
  const xAt = (i) => cx - halfW + i * step;
  const zAt = (j) => cz - halfD + j * step;
  const depthAt = (i, j) => y - floorAt(xAt(i), zAt(j));
  const inBody = new Uint8Array(nx * nz);
  const i0 = Math.round(halfW / step);
  const j0 = Math.round(halfD / step);
  if (depthAt(i0, j0) <= 0) throw new Error(`water: the sea at (${cx}, ${cz}) is dry in the middle`);
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  let deepest = 0;
  const stack = [[i0, j0]];
  inBody[j0 * nx + i0] = 1;
  while (stack.length) {
    const [i, j] = stack.pop();
    deepest = Math.max(deepest, depthAt(i, j));
    x0 = Math.min(x0, xAt(i));
    x1 = Math.max(x1, xAt(i));
    z0 = Math.min(z0, zAt(j));
    z1 = Math.max(z1, zAt(j));
    for (const [a, c] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
      if (a < 0 || c < 0 || a >= nx || c >= nz) throw new Error(`water: the sea spills past its search box`);
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
      let near = false;
      for (let a = i - 1; a <= i + 1 && !near; a++) {
        for (let c = j - 1; c <= j + 1 && !near; c++) {
          near = a >= 0 && c >= 0 && a < nx && c < nz && inBody[c * nx + a] === 1;
        }
      }
      if (!near) throw new Error(`water: the sea's rect covers other wet ground at (${x.toFixed(1)}, ${z.toFixed(1)})`);
    }
  }
  return {
    x: Number(((x0 + x1) / 2).toFixed(2)),
    z: Number(((z0 + z1) / 2).toFixed(2)),
    width: Number((x1 - x0 + 2 * margin).toFixed(2)),
    depth: Number((z1 - z0 + 2 * margin).toFixed(2)),
    y: SEA_Y,
    deepest: Number(deepest.toFixed(2)),
  };
}

const water = [];
const sea = waterRect(112, 122, 80, 58, SEA_Y);
water.push(
  "  // THE ICE CREAM SEA: one rect over the basin the path runs along the shore",
  "  // of. The floor decides where the water is; this is only where it may be.",
  `  { x: ${n2(sea.x)}, z: ${n2(sea.z)}, width: ${n2(sea.width)}, depth: ${n2(sea.depth)}, y: ${n2(sea.y)} },`,
);

const grass = [
  "  // A spring lawn: bright-tipped, and a BUDGET rather than a blanket (the",
  "  // field is one mesh of thin instances with no culling inside it). It",
  "  // never grows on the path — the road footprint refuses a tuft — so the",
  "  // rects can lie across it.",
];
{
  let tufts = 0;
  for (let gz = -HALF + 18; gz < HALF - 10; gz += 30) {
    for (let gx = -HALF + 18; gx < HALF - 10; gx += 30) {
      const x = gx + rand(-5, 5);
      const z = gz + rand(-5, 5);
      let ok = true;
      for (const [dx, dz] of [[0, 0], [-14, -12], [14, -12], [-14, 12], [14, 12]]) {
        if (wet(x + dx, z + dz, 0.4)) ok = false;
      }
      if (!ok) continue;
      const density = Number(rand(0.09, 0.13).toFixed(2));
      grass.push(`  { x: ${n2(Number(x.toFixed(1)))}, z: ${n2(Number(z.toFixed(1)))}, width: 30, depth: 26, density: ${density} },`);
      tufts += 30 * 26 * density;
    }
  }
  console.log(`  grass: ~${Math.round(tufts)} tufts`);
}

const NAMED = FLAGS.map(
  (f) => `  { id: "${f.id}", name: "${f.name}", pos: new Vector3(${n2(f.x)}, ${n2(Number(heightAt(f.x, f.z).toFixed(2)))}, ${n2(f.z)}), radius: ${f.r} },`,
);

/** One spawn per objective, outside its ring, on open ground. */
const FLAG_SPAWNS = [
  ["A", 0, -17, "Math.PI"],
  ["B", 16, -6, "-Math.PI / 2"],
  ["C", 0, -18, "0"],
  ["D", -20, 4, "Math.PI / 2"],
  ["E", 0, 13, "Math.PI"],
];
for (const [id, dx, dz, yaw] of FLAG_SPAWNS) {
  const f = byId[id];
  const x = f.x + dx;
  const z = f.z + dz;
  if (overlaps(x - 1, x + 1, z - 1, z + 1, (c) => c.type !== "solid")) {
    throw new Error(`spawn: ${id}'s spawn at (${x}, ${z}) stands in a building`);
  }
  if (wet(x, z)) throw new Error(`spawn: ${id}'s spawn at (${x}, ${z}) is in the water`);
  spawns.push(`  { team: null, controlPoint: "${id}", pos: new Vector3(${n2(x)}, ${n2(Number(heightAt(x, z).toFixed(2)))}, ${n2(z)}), yaw: ${yaw} },`);
}

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
      `${worstGrade.toFixed(3)} gradient, against MAX_WALKABLE_GRADE ${MAX_GRADE} less a tenth for margin.`,
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
 * candyland/heights.ts — GENERATED by \`scripts/generate-candyland.mjs\` (\`npm
 * run candyland\`), and editable afterwards with the map editor's terrain mode
 * (F2, then T). Do not hand-edit: both the script and the editor rewrite this
 * file wholesale.
 *
 * The floor of Candy Land — one height per grid vertex, row-major from the
 * -X/-Z corner. A lazy \`import()\` (\`MapDef.heights\`), so it reaches a
 * browser only when this map is built.
 *
 * ${CELLS}x${CELLS} cells of ${CELL} m over the ${PLAY} m play square, so ${row}x${row}
 * vertices. \`size * cell\` must equal \`MapLayout.size\`.
 *
 * **The shape is four passes laid over one another IN ORDER** (see
 * \`heightAt\` in the generator): a gently rolling lawn with the plum tree's
 * knoll, the Lollypop Woods' swell and the Gumdrop Mountains' plateau on it;
 * the two houses' plots and the two home yards levelled; the Ice Cream Sea
 * dug off the path's shore to ${SEA_DEPTH} m at most; and the Molasses Swamp's basin
 * cut last. The sea is ${SEA_Y} m at its surface and wadeable everywhere.
 */
import type { Heightfield } from "../layout";

export const CandylandHeights: Heightfield = {
  size: ${CELLS},
  cell: ${CELL},
  // Row-major, +Z per row.
  heights: [
${heightRows.join("\n")}
  ],
};

// Default too, because \`MapDef.heights\` is a lazy \`import()\` and a default is
// the one export name a generic signature can be written against.
export default CandylandHeights;
`,
);

const placementCount = placements.filter((l) => l.includes("{ kind:")).length;
const scatterCount = scatter.filter((l) => l.includes("{ prop:")).length;

writeFileSync(
  join(out, "layout.ts"),
  `/**
 * candyland/layout.ts — THE MAP, as data: structure placements, scatter
 * regions, control points, spawns, the grass and the Ice Cream Sea. The sea's
 * rect is MEASURED off the floor by the generator.
 * The floor's shape is generated data and lives in heights.ts. Consumed by
 * MapBuilder; nothing here is code to special-case.
 * Gotchas that have already cost time: collider top faces within
 * CONFIG.nav.stepHeight of adjacent ground or bots treat decks as walls; a
 * control point's pos must NOT sit inside a PLACEMENT's collider; scatter
 * knows nothing about water, so every region below was checked dry by the
 * generator; terrain steeper than a 0.4 gradient severs its own nav links; an
 * ice cream float's \`y\` puts its waterline at the sea's surface.
 *
 * **SEEDED by \`scripts/generate-candyland.mjs\`, and owned by the editor
 * after that.** The design is authored in that script and this file is the
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
 * CANDY LAND — the 1962 board game's board, on a bright spring afternoon.
 *
 * **${PLAY} x ${PLAY} m of PLAY inside ${PLAY + 2 * MARGIN} m of ground**, +Z up the board
 * (north), infantry only, eight a side.
 *
 * \`\`\`
 *                                  N
 *   +--------------------------------------------------------+  z 150
 *   | MOLASSES    [A] HOME SWEET HOME (20,86)    ICE CREAM SEA |
 *   |  SWAMP ~~     ======== the path =========   ~~ floats ~~  |
 *   |  =========================================  LOLLYPOP     |
 *   | [B] PEANUT BRITTLE    [C] PLUM TREE (-3,-8)   WOODS  x T1 |
 *   |  HOUSE (-101,12)   =====================     [D] GUMDROP  |
 *   |  ==============  =============================  MOUNTAINS |
 *   |   rainbow trail  ============================  (88,-22)  |
 *   | x T0 START  ============================     PEPPERMINT  |
 *   |              [E] CANDY HEARTS (45,-134)       STICK FOREST|
 *   +--------------------------------------------------------+  z -150
 * \`\`\`
 *
 * ## The board, which is the whole design
 *
 * The rainbow path is the 1962 board's own, traced off a photograph of it
 * (see the generator) and laid across the lawn as one ${Math.round(PATH_LEN)} m road of
 * ${SPACES} spaces: purple, yellow, blue, orange, green, red and round again,
 * lavender where the board has a picture, a black dot on its two cherry
 * pitfalls and its molasses space. The Rainbow Trail and the Mountain Pass are
 * its two short cuts. Every landmark stands where the board draws it.
 *
 * ## Design intent per flag
 *
 * - **A Home Sweet Home** — the gingerbread house the path ends at, iced pink,
 *   enterable, in a front yard behind a peppermint fence. The closest flag to
 *   T1 but for D.
 * - **B Peanut Brittle House** — the crooked old cottage on the left, and its
 *   yard in the bend of the path. The closest flag to T0.
 * - **C Gingerbread Plum Tree** — the board's middle and the map's landmark,
 *   twenty-six metres of tree on a low knoll with lawns all round it.
 * - **D Gumdrop Mountains** — a plateau three metres up among gumdrops as big
 *   as houses, the Mountain Pass climbing through. The high ground, on T1's
 *   side.
 * - **E Candy Hearts** — conversation hearts along the bottom of the board,
 *   the Peppermint Stick Forest beside them. On T0's side.
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
 * its ring. T0 starts at START, as a player does.
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

export const CandylandLayout: MapLayout = {
  placements,
  scatter,
  controlPoints,
  spawns,
  water,
  grass,
  /** The play square. \`heights.size * heights.cell\` equals it (${CELLS} x ${CELL}). */
  size: ${PLAY},
  /**
   * Four: the ground, a house's plinth or table, its roof slab, and the
   * chimney over that — emitted in that order, so what overflows is a
   * chimney top nobody stands on.
   */
  surfaces: 4,
  /**
   * The play square in 2 x 2, Kurenai's measurement: under a haze that puts
   * the whole board in view from anywhere on it, the merge block is the draw
   * count and a fine grid buys the cull nothing.
   */
  blockSize: ${BLOCK},
  /** Twenty cells, so the floor is five patches by five. */
  terrainBlock: ${TERRAIN_BLOCK},
  /**
   * No wall: the lawn carries on for ${MARGIN} m past the board's edge and the
   * leash is what stops you. What closes the horizon is the rolling green
   * downs standing on it, soft in the pink haze.
   */
  borderland: { margin: ${MARGIN}, roll: 1.6, ease: 40 },
  /**
   * Round green downs — gumdrop hills, a dozen tops round the ring — and no
   * woods: a pine on Candy Land's horizon would be the one thing on the map
   * that is not a sweet.
   */
  ridge: {
    form: "downs",
    slope: 0.15,
    slopeVariance: 0.04,
    rolling: { relief: 0.45, summits: 12, knolls: 0.2, woods: 0 },
    seed: 0x43414e45,
  },
  seed: 0x43414e44,
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
  `candyland: ${PLAY} m play + ${MARGIN} m margin = ${PLAY + 2 * MARGIN} m across\n` +
    `  path ${PATH_LEN.toFixed(0)} m in ${SPACES} spaces (${(PATH_LEN / SPACES).toFixed(2)} m each), ${PATH.length} points\n` +
    `  specials: ${SPECIALS.map((s) => `${s.note} @${s.at}`).join(", ")}\n` +
    `  ${placementCount} placements, ${scatterCount} scatter regions (~${props} props), ${claimed.length} claims\n` +
    `  ${row}x${row} height vertices, ground ${lo.toFixed(2)}..${hi.toFixed(2)} m\n` +
    `  sea ${sea.width} x ${sea.depth} m at (${sea.x}, ${sea.z}), deepest ${sea.deepest} m\n` +
    `  steepest cell step ${worstStep.toFixed(2)} m (grade ${worstGrade.toFixed(3)}) at ${worstAt}\n` +
    `  wrote src/world/candyland/{layout,heights}.ts`,
);
