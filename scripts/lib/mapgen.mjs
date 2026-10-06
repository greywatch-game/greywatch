/**
 * mapgen.mjs — What the seven map generators (`scripts/generate-<map>.mjs`)
 * share: the seeded stream, the floor's noise, the arithmetic every placement
 * check is made of, the text a layout is written in, and the two printers a
 * run reports through (`--probe`'s plan and `--refusals`' list).
 *
 * Owns: helpers that were byte-identical copies in two or more generators —
 * nothing that decides what a map IS. A generator still owns its design, its
 * own state (the claim list, the heightfield, the scatter lines) and every
 * helper whose difference from its neighbours is deliberate.
 *
 * **A helper that needs a generator's state is a FACTORY, never a global.**
 * `makeFloorAt`, `makeOverlaps`, `makeMust` and the rest take the arrays and
 * functions they read and hand back the function the generator always had, so
 * a call site reads exactly as it did — `floorAt(x, z)`, `overlaps(r, 0.5)` —
 * and nothing here holds a map between calls. Bind the result where the old
 * `function` stood: a `const` is not hoisted, so a call above the binding is a
 * loud TDZ error rather than a quiet difference.
 *
 * Invariants:
 * - **Every generator's output is byte-identical to what its own copies
 *   wrote.** That is the acceptance this file was cut under, and a change to
 *   anything here owes a regeneration of EVERY map that imports it with no
 *   diff in `src/world/<map>/{layout,heights}.ts` — or a re-seed of the maps
 *   it moves, argued for in the commit, with the collision rebake and
 *   `npm run parity` that owes.
 * - The PRNG is `src/world/rng.ts`'s `mulberry32`, the one the game's own
 *   scatter uses. It is imported by its `.ts` name under Node's type
 *   stripping, as `roadPaths.ts` is, so that file may hold no syntax that has
 *   to be compiled rather than erased.
 *
 * Never: call `Math.random()` (a seeded map that differs between runs is the
 * bug every generator exists to prevent); name a map, a kit kind or a
 * coordinate; or read `process.argv` — which flag prints what is the
 * generator's to decide.
 */
import { mulberry32 } from "../../src/world/rng.ts";

// --- the seeded stream -------------------------------------------------------

/**
 * One seeded stream and the draws made from it. Every draw shares `rng`, so
 * the ORDER of calls is part of a map's design exactly as it was when each
 * generator wrote these lines out itself.
 */
export function seeded(seed) {
  const rng = mulberry32(seed);
  const rand = (lo, hi) => lo + rng() * (hi - lo);
  return {
    rng,
    rand,
    randInt: (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1)),
    pick: (list) => list[Math.floor(rng() * list.length)],
    chance: (p) => rng() < p,
    /** `rand`, rounded to the centimetre a layout is written at. */
    rnd: (lo, hi) => Number(rand(lo, hi).toFixed(2)),
  };
}

// --- the floor's arithmetic --------------------------------------------------

export const smooth = (t) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};

/** Integer lattice hash in [0, 1). */
export function hash2(i, j, seed) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [-1, 1] at `scale` metres a lattice cell. */
export function vnoise(x, z, scale, seed) {
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
export const bell = (d, radius) => (d >= radius ? 0 : (Math.cos((Math.PI * d) / radius) + 1) / 2);

/** A smooth minimum, so two surfaces meet without a crease. */
export function smin(a, b, k) {
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
  return b + (a - b) * h - k * h * (1 - h);
}

/** Distance from a point to the segment a..b. */
export function segDist(x, z, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
}

/** Distance from a point to an edge rectangle `{ x0, x1, z0, z1 }`; 0 inside. */
export function rectDist(x, z, r) {
  const dx = Math.max(r.x0 - x, 0, x - r.x1);
  const dz = Math.max(r.z0 - z, 0, z - r.z1);
  return Math.hypot(dx, dz);
}

/** `rectDist` for a centred rectangle `{ x, z, hw, hd }` (half extents); 0 inside. */
export function centredRectDist(x, z, r) {
  const dx = Math.max(Math.abs(x - r.x) - r.hw, 0);
  const dz = Math.max(Math.abs(z - r.z) - r.hd, 0);
  return Math.hypot(dx, dz);
}

/**
 * The written floor read back between its vertices: bilinear over the vertex
 * at `vertex(i, j)`, clamped to the play square. `vertex` is a function rather
 * than the array so a generator may read a grid it is still filling, or one
 * it computes on demand.
 */
export function makeFloorAt(vertex, cells, cell, half) {
  return (x, z) => {
    const fx = Math.max(0, Math.min(cells - 1e-9, (x + half) / cell));
    const fz = Math.max(0, Math.min(cells - 1e-9, (z + half) / cell));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    return (
      (vertex(i, j) * (1 - tx) + vertex(i + 1, j) * tx) * (1 - tz) +
      (vertex(i, j + 1) * (1 - tx) + vertex(i + 1, j + 1) * tx) * tz
    );
  };
}

/** The steeper of the two axial slopes of `height`, by central difference over `e` metres. */
export function makeGrade(height, e) {
  return (x, z) =>
    Math.max(
      Math.abs(height(x + e, z) - height(x - e, z)) / (2 * e),
      Math.abs(height(x, z + e) - height(x, z - e)) / (2 * e),
    );
}

// --- placements and their footprints -----------------------------------------

/** Layout text for a turn, appended after `z`. */
export const TURN = ["", ", rotY: Math.PI / 2", ", rotY: Math.PI", ", rotY: -Math.PI / 2"];
/**
 * Turn 0 faces SOUTH (a builder's front is its local -Z), 1 faces WEST, 2
 * NORTH and 3 EAST — `rotY` of π/2 takes local -Z to world -X.
 */
export const FACES = { south: 0, west: 1, north: 2, east: 3 };

/** The world offset of a local one under a turn: `MapBuilder`'s `rotateY`. */
export function turnOf(lx, lz, turn) {
  switch (turn) {
    case 1: return [lz, -lx];
    case 2: return [-lx, -lz];
    case 3: return [-lz, lx];
    default: return [lx, lz];
  }
}

/**
 * A kind's footprint in the world, off a table of `kind -> params -> [x0, x1,
 * z0, z1]` in the builder's own frame.
 */
export function makeWorldFoot(foot) {
  return (kind, x, z, turn, params) => {
    const [a, b, c, d] = foot[kind](params ?? {});
    const p = [turnOf(a, c, turn), turnOf(b, d, turn)];
    return {
      x0: Math.min(p[0][0], p[1][0]) + x,
      x1: Math.max(p[0][0], p[1][0]) + x,
      z0: Math.min(p[0][1], p[1][1]) + z,
      z1: Math.max(p[0][1], p[1][1]) + z,
    };
  };
}

/** The first claim an edge rectangle overlaps (grown by `pad`), unless `skip` excuses it; else null. */
export function makeOverlaps(claimed) {
  return (r, pad, skip) => {
    for (const c of claimed) {
      if (skip && skip(c)) continue;
      if (r.x1 + pad > c.x0 && r.x0 - pad < c.x1 && r.z1 + pad > c.z0 && r.z0 - pad < c.z1) return c;
    }
    return null;
  };
}

/** File an edge rectangle on the claim list as `type`, with a `note` a refusal can name. */
export function makeClaim(claimed) {
  return (r, type = "solid", note = "") => {
    claimed.push({ ...r, type, note });
  };
}

/** Claim an OPEN rectangle — a yard, a green — which is also somewhere a door may open onto. */
export function makeYard(open, claim) {
  return (x0, x1, z0, z1, note) => {
    const r = { x0, x1, z0, z1 };
    open.push(r);
    claim(r, "open", note);
  };
}

/**
 * How far the floor falls across a footprint, from its centre's own height,
 * sampled on a grid at the fractions `at` of each side — 3x3 by default.
 */
export function makeRelief(floorAt, at = [0, 0.5, 1]) {
  return (r) => {
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    const h0 = floorAt(cx, cz);
    let worst = 0;
    for (const fx of at) {
      for (const fz of at) {
        worst = Math.max(worst, Math.abs(floorAt(r.x0 + fx * (r.x1 - r.x0), r.z0 + fz * (r.z1 - r.z0)) - h0));
      }
    }
    return worst;
  };
}

/** Whether any of a footprint is within 0.2 m of a carriageway. */
export function makeFootOnRoad(onRoadAt) {
  return (r) => {
    for (let x = r.x0; x <= r.x1 + 1e-9; x += Math.min(1, (r.x1 - r.x0) / 2 || 1)) {
      for (let z = r.z0; z <= r.z1 + 1e-9; z += Math.min(1, (r.z1 - r.z0) / 2 || 1)) {
        if (onRoadAt(x, z, 0.2)) return true;
      }
    }
    return false;
  };
}

/** Whether any of a footprint is wet, on a 5x5 sample, with `margin` of bank by default. */
export function makeFootWet(wet, margin) {
  return (r, m = margin) => {
    for (const fx of [0, 0.25, 0.5, 0.75, 1]) {
      for (const fz of [0, 0.25, 0.5, 0.75, 1]) {
        if (wet(r.x0 + fx * (r.x1 - r.x0), r.z0 + fz * (r.z1 - r.z0), m)) return true;
      }
    }
    return false;
  };
}

/**
 * Whether the 2.5 m in front of a building's front face is clear of every
 * other SOLID claim and of the water: null when it is, the reason when not.
 */
export function makeFrontClear(foot, claimed, wet) {
  return (kind, x, z, turn, params, self) => {
    const [, , z0] = foot[kind](params ?? {});
    const [fx, fz] = turnOf(0, -1, turn);
    const [sx, sz] = turnOf(0, z0, turn);
    for (let t = 0.3; t <= 2.5; t += 0.5) {
      const px = x + sx + fx * t;
      const pz = z + sz + fz * t;
      const hit = claimed.find((c) => c !== self && c.type === "solid" && px >= c.x0 && px <= c.x1 && pz >= c.z0 && pz <= c.z1);
      if (hit) return `front blocked by ${hit.note || "a claim"}`;
      if (wet(px, pz, 0)) return "front opens onto the water";
    }
    return null;
  };
}

/**
 * A named set piece: `place` it, and refuse to write the map if it did not
 * fit, naming the refusal `place` filed last.
 */
export function makeMust(place, refused) {
  return (kind, x, z, turn, params, opts = {}) => {
    if (place(kind, x, z, turn, params, opts)) return;
    throw new Error(`set piece: ${refused[refused.length - 1]}. Move the piece.`);
  };
}

// --- the layout's text --------------------------------------------------------

/** A number as a layout writes it: to the centimetre, and never `-0`. */
export const n2 = (v) => {
  const r = Number(v.toFixed(2));
  return Object.is(r, -0) ? "0" : String(r);
};
/** A number to the decimetre, as a scatter region's centre is written. */
export const f1 = (v) => n2(Number(v.toFixed(1)));

/**
 * A placement's `params` as layout source. A string is quoted unless it
 * starts with `@`, which writes the rest as an expression (a name in the
 * layout's own scope); an array is a list of points.
 */
export function paramText(params) {
  if (!params) return "";
  return Object.entries(params)
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}: [${v.map((q) => `[${q.map(n2).join(", ")}]`).join(", ")}]`;
      const lit = typeof v === "string" ? (v.startsWith("@") ? v.slice(1) : `"${v}"`) : typeof v === "boolean" ? String(v) : n2(v);
      return `${k}: ${lit}`;
    })
    .join(", ");
}

/**
 * Write one placement: its layout line into `placements`, and the same
 * placement as an object into `placed` for the road network, the checks and
 * the `--claims` render.
 */
export function makeEmit(placements, placed) {
  return (kind, x, z, turn, params, y) => {
    const ps = paramText(params);
    const yy = y !== undefined ? `, y: ${n2(y)}` : "";
    placements.push(
      `  { kind: "${kind}", x: ${n2(x)}, z: ${n2(z)}${yy}${TURN[turn]}` + (ps ? `, params: { ${ps} }` : "") + " },",
    );
    placed.push({ kind, x, z, y, rotY: [0, Math.PI / 2, Math.PI, -Math.PI / 2][turn], params: params ?? {}, turn });
  };
}

/** A banner comment between two runs of a layout's list. */
export function section(list, title) {
  const bar = "=".repeat(Math.max(4, 74 - title.length));
  list.push(`  // ===== ${title} ${bar}`);
}

/**
 * The two scatter-region shapes, each written to the layout's `scatter` lines
 * and — when the generator keeps `regions` for its own later checks —
 * recorded there as an object too.
 */
export function makeScatter(scatter, regions = null) {
  return {
    disc(prop, x, z, r, count, extra = "", obj = {}) {
      scatter.push(`  { prop: "${prop}", x: ${f1(x)}, z: ${f1(z)}, radius: ${n2(r)}, count: ${count}${extra} },`);
      regions?.push({ prop, x, z, radius: r, count, ...obj });
    },
    rectRegion(prop, x, z, w, d, count, extra = "", obj = {}) {
      scatter.push(`  { prop: "${prop}", x: ${f1(x)}, z: ${f1(z)}, width: ${f1(w)}, depth: ${f1(d)}, count: ${count}${extra} },`);
      regions?.push({ prop, x, z, width: w, depth: d, count, ...obj });
    },
  };
}

// --- what a run prints ----------------------------------------------------------

/**
 * `--probe`: the floor as a plan, one height every `step` metres over the
 * play square, marked `~` where `wet` says water (when given) and `!` where
 * the grade passes 0.3.
 */
export function printProbe({ half, step, height, grade, wet }) {
  const cols = [];
  for (let x = -half; x <= half; x += step) cols.push(String(x).padStart(5));
  console.log("  z|x " + cols.join(""));
  for (let z = half; z >= -half; z -= step) {
    let line = String(z).padStart(5) + " ";
    for (let x = -half; x <= half; x += step) {
      const g = grade(x, z);
      line += (height(x, z).toFixed(1) + (wet && wet(x, z, 0) ? "~" : g > 0.3 ? "!" : " ")).padStart(5);
    }
    console.log(line);
  }
}

/** How many of each kind: `kindOf` names an item's kind, or nothing to skip it. */
export function tally(items, kindOf) {
  const by = {};
  for (const item of items) {
    const k = kindOf(item);
    if (k == null) continue;
    by[k] = (by[k] ?? 0) + 1;
  }
  return by;
}

/** The kind a written placement line names. */
export const lineKind = (line) => /kind: "([a-zA-Z]+)"/.exec(line)?.[1];
/** The kind a refusal names as its first word. */
export const leadKind = (why) => why.split(" ")[0];
/** The kind a refusal names in parentheses before " at". */
export const bracketKind = (why) => why.match(/\((\w+)\) at/)?.[1] ?? "?";

/** The run's two summary lines: what was placed, and what was refused by kind. */
export function printTally(placedByKind, refused, kindOf) {
  console.log("  placed:  " + JSON.stringify(placedByKind));
  console.log("  refused: " + JSON.stringify(tally(refused, kindOf)));
}

/** `--refusals`: every refusal, one a line. */
export function printRefusals(refused) {
  for (const r of refused) console.log("    " + r);
}
