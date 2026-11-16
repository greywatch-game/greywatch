/**
 * sweep-check.mjs — holds the body sweep (`src/world/ellipsoidSweep.ts`, run
 * through `src/world/CollisionField.ts`) to Babylon 9.28's
 * `moveWithCollisions`, to the BIT, over the same triangles.
 *
 *   node scripts/sweep-check.mjs [map ...] [--seed S] [--tight]
 *                                [--body player|tank|truck|heli] [--perturb]
 *
 * The three body sweeps — the player on foot, a hull driving, a wreck coasting
 * — left Babylon's collider for a port of it that runs on plain numbers
 * against `WorldBox`es. The port's
 * whole claim is that it is the SAME algorithm, quirks included, because the
 * feel of moving is that algorithm's and everything built over it (the
 * push-outs, the hull's offset sphere, its climb band) was tuned against it. A
 * divergence that starts at the last bit does not stay there: a slide that
 * rounds the other way can pick the other triangle of a tie and go somewhere
 * else. So every answer is compared by its bits.
 *
 * Every map is built as the authority builds it (`buildServerWorld`, off the
 * bake, with no engine and no mesh), which hands over the collider boxes, the
 * `RayWorld` whose `bodyNear` every sweep gathers from and the
 * `CollisionField` over it (`map.collidables`).
 * The bodies are the player and the three vehicle kinds, their ellipsoids and
 * offsets DERIVED as `Player` and `Vehicle` derive them (`bodiesOf`) from the
 * numbers the table was recorded with, which it FROZE beside its answers
 * (`CONFIG`'s at the time: a retune is not a change to the sweep).
 *
 * **Babylon's answers are a RECORDED TABLE** (`scripts/tables/sweep-check.json`,
 * `scripts/lib/babylonTable.mjs`; `BABYLON_EXIT.md` row "X6.1, the copy
 * checks"): each map's body over a block of 250 samples is one digest of
 * Babylon 9.28's answers, captured by `--record` while the package was
 * installed (X6.1i's first commit, which compared every answer live as well;
 * the arm went with the package in the next), and a run holds ours to them.
 * Babylon was given the world the port was written against — one `CreateBox`
 * collider mesh per box, as `MapBuilder.collider` made them before the
 * scatter was merged, created in the CLIENT's collider order (every box no
 * cluster holds, then the clusters' boxes in `boxGroups` order), which is the
 * rank `RayWorld` hands a sweep its candidates in — and was started where the
 * port is started: from `Math.fround(position)` plus the offset, because
 * `moveWithCollisions` opens from `getAbsolutePosition()`, the float32 world
 * matrix's translation. Ours is `CollisionField.sweepFrom`, the production
 * gather, then Babylon's write-back (the move kept only past
 * `COLLISIONS_EPSILON`). `--tight` runs two fields with a deliberately short
 * first reach (`GatherKnobs`, see `TIGHT_KNOBS`), one that re-gathers and one
 * that falls straight through to the whole map, so both arms of the loop run
 * — which a real sweep almost never makes them do; every gather must give the
 * first one's answer, and that one the table's.
 *
 * **A map is the game's**, so beside its answers the table holds a digest of
 * what the map is to a sweep (its boxes, their groups, its floor, its
 * square), and a map re-laid since is reported STALE and not compared. So
 * that the oracle does not fade as the maps move, a SEEDED world built from
 * nothing in the game runs after the maps (`synthetic`: see
 * `syntheticWorld`), which is never stale. Each body's samples are a stream
 * of their own (the hulls are the map's), so a map or a body named alone draws
 * what the table's run drew and is held to its groups; the seed and the
 * sample count are part of what was recorded. `--perturb` is the negative
 * test: our start moved a millimetre in x, so every group must differ.
 *
 * Until X6.1i two more modes measured the production sweep against Babylon
 * live: `shipped` (the client's real merged collider scene, and the
 * authority's, every miss over a millimetre diagnosed — the float32 start, the
 * tie order, the merge, a knife edge) and `walk` (chained fixed-step
 * trajectories and their drift). They were the account of how far the world
 * that shipped was from the port, asked from starts nudged at run time, which
 * no table can answer; they went with the package and stand at any tree
 * before it.
 *
 * The starts are drawn round a random collider (never a map-sized rim box), in
 * that box's turned frame: mostly at or just short of contact, the tangential
 * coordinate running a little past the face so corners come up, and about a
 * tenth deliberately EMBEDDED, because the ejection path is where this
 * algorithm is strangest. Heights span the box's band plus the ellipsoid's
 * own vertical radius. Steps are a frame's worth, mostly toward the box, one
 * in seven twenty times that so the retries and long slides run, and a tenth
 * with a vertical part. Six synthetic HULLS, two of each kind's box, stand
 * beside random colliders so the movers path — `rays.hulls`, last in the list
 * as a hull built after the map was last in `scene.meshes` — is exercised,
 * and an eighth of the starts are drawn round them.
 *
 * The counts: `blocked` is a sample ours did not let go where the step
 * pointed (by more than 1e-6). `embedded` is a start whose ellipsoid overlaps
 * ANY box near it, measured rather than drawn (a pitched box by its unpitched
 * footprint, so a count and not a verdict), and `in anchor` those inside the
 * box the sample was drawn round. Expect `embedded` near half: a building is
 * floor slabs and party walls laid flush, so a start at a random height beside
 * one of them is very often already in the next. `regathered` is a sweep
 * whose path outran its first list, `whole map` one that fell through to every
 * box on the map — both a COST, never a failure. Exits 1 on any group that
 * differs from the table, or gathers that disagree.
 */
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { Ledger } from "./lib/babylonTable.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const VALUED = new Set(["--seed", "--body"]);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const SEED = Number(opt("--seed", 1));
const TIGHT = args.includes("--tight");
const ONLY_BODY = opt("--body", null);
const named = args.filter((a, i) => !a.startsWith("--") && !VALUED.has(args[i - 1]));
const PERTURB = args.includes("--perturb");
/** The samples a map's body is run over, as the table was recorded. */
const SAMPLES = 2000;
/** The table groups a map's body over this many samples. */
const BLOCK = 250;
/**
 * `--perturb`'s nudge: a millimetre on our start's X, so every sample moves
 * (a start is never so deep in a corner that the answer cannot move with it).
 */
const NUDGE = 2 ** -10;
/** The recorded answers (`scripts/lib/babylonTable.mjs`). */
let ledger = null;

/** How many failing samples are printed in full before the rest are only counted. */
const SHOW = 6;
/** A step this much shorter than asked was blocked, not rounded. */
const BLOCKED = 1e-6;

/**
 * `--tight`'s two gathers, both with a first reach a quarter of the step and
 * no margin. The first re-gathers once at the reach the path needed, which
 * almost always suffices — a re-run over the longer list slides no farther —
 * so it all but never reaches the whole map; the second goes straight there.
 * Between them both arms of `sweepFrom`'s loop run, and both must agree.
 */
const TIGHT_KNOBS = [
  { stepShare: 0.25, margin: 0, regathers: 1 },
  { stepShare: 0.25, margin: 0, regathers: 0 },
];
function vite() {
  return createServer({
    root: ROOT,
    configFile: false,
    logLevel: "error",
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: "custom",
  });
}

// ---------------------------------------------------------------------------
// The bodies, as the table froze them.

/**
 * The player's body (`Player.ellipsoid`, its `sweepBody`): no offset. The hull's sphere
 * (`Vehicle`'s constructor and `aimCollider`): lifted half the climb band and
 * carried `bias` along the yaw to whichever end leads.
 */
function bodiesOf(params) {
  const p = params.player;
  const list = [
    {
      name: "player",
      radii: { x: p.radius, y: p.height / 2 - 0.05, z: p.radius },
      offsetAt: () => [0, 0, 0],
      step: [0.04, 0.12],
    },
  ];
  for (const kind of ["tank", "truck", "heli"]) {
    const t = params[kind];
    const r = t.collideRadius;
    const bias = t.hull.length / 2 - r;
    list.push({
      name: kind,
      spec: t,
      radii: { x: r, y: (t.hull.height - t.climbHeight) / 2, z: r },
      offsetAt: (yaw, lead) => [Math.sin(yaw) * bias * lead, t.climbHeight / 2, Math.cos(yaw) * bias * lead],
      step: [0.05, 0.2],
    });
  }
  return ONLY_BODY ? list.filter((b) => b.name === ONLY_BODY) : list;
}

// ---------------------------------------------------------------------------
// Moving a body.

/** Babylon's position callback: the displacement kept only past the epsilon. */
function writeBack(env, position, centre, r, to) {
  const dx = r.x - centre[0];
  const dy = r.y - centre[1];
  const dz = r.z - centre[2];
  to.x = position[0];
  to.y = position[1];
  to.z = position[2];
  if (Math.sqrt(dx * dx + dy * dy + dz * dz) > env.COLLISIONS_EPSILON) {
    to.x += dx;
    to.y += dy;
    to.z += dz;
  }
}

/** Ours from Babylon's own start: the float32 position plus the offset. */
function oursFromFloat32(env, field, position, radii, offset, step, to) {
  const c = [
    Math.fround(position[0]) + offset[0],
    Math.fround(position[1]) + offset[1],
    Math.fround(position[2]) + offset[2],
  ];
  const r = field.sweepFrom(c[0], c[1], c[2], radii, { x: step[0], y: step[1], z: step[2] }, null);
  writeBack(env, position, c, r, to);
}

const same = (a, b) => Object.is(a.x, b.x) && Object.is(a.y, b.y) && Object.is(a.z, b.z);

// ---------------------------------------------------------------------------
// The worlds.

async function buildWorld(env, def) {
  if (def.id === SYNTHETIC) return syntheticWorld(env);
  const map = await env.buildServerWorld(def);
  if (map.rays.hulls.length !== 0) {
    throw new Error(`${def.id}: the server world arrived with ${map.rays.hulls.length} hulls; the reference has none`);
  }
  const anchors = map.colliderBoxes.filter((b) => !(b.w > 200 || b.d > 200));
  return { map, anchors, input: worldInput(map, def.layout.size ?? env.CONFIG.map.size) };
}

/**
 * What a map IS to a sweep, before any copy under test runs: every box's
 * fields, the groups that rank them, the floor a hull is stood on and the
 * square — the INPUT digest `exact`'s table keeps beside each map's answers,
 * so a re-laid map reads STALE rather than wrong.
 */
function worldInput(map, size) {
  const out = [size];
  for (const b of map.colliderBoxes) out.push(b.w, b.h, b.d, b.cx, b.cy, b.cz, b.rotX, b.rotY, !!b.porous, !!b.glass);
  for (const g of map.boxGroups) out.push("group", ...g);
  const t = map.terrain;
  out.push("floor", t.margin, t.roll, t.ease);
  if (t.field) out.push(t.field.size, t.field.cell, ...t.field.heights);
  return out;
}

/** The seeded world's name, beside the maps': it is never one of them. */
const SYNTHETIC = "synthetic";

/**
 * `exact`'s SEEDED world, built from nothing in the game (X6.1i), so the
 * table holds the port whatever the maps become: six hundred boxes on a flat
 * floor in a 160 m square — slabs and walls from a hand's breadth to a house,
 * on the ground or lifted, square to the axes, at right angles or at any yaw,
 * one in ten pitched, one in twenty porous — and some fifty scatter-like
 * CLUSTERS of two to six small boxes, so the rank `boxGroups` gives the
 * sweep's ties is exercised as a map's scatter exercises it. Built through
 * the same `RayWorld` and `CollisionField` as a map.
 */
function syntheticWorld(env) {
  const { RayWorld, TerrainField, CollisionField, mulberry32 } = env;
  const rand = mulberry32(streamSeed(SYNTHETIC) ^ 0x51ed270b);
  const SIZE = 160;
  const boxes = [];
  const span = () => (rand() * 2 - 1) * 70;
  for (let i = 0; i < 600; i++) {
    const small = i >= 400;
    const w = small ? 0.2 + rand() * 1.5 : 0.1 + rand() * 14;
    const d = small ? 0.2 + rand() * 1.5 : 0.1 + rand() * 14;
    const h = small ? 0.2 + rand() * 2 : 0.2 + rand() * 8;
    const yaw = rand();
    const rotY = yaw < 0.4 ? 0 : yaw < 0.6 ? Math.floor(rand() * 4) * (Math.PI / 2) : rand() * Math.PI * 2;
    const rotX = rand() < 0.1 ? (rand() * 2 - 1) * 0.6 : 0;
    const box = { w, h, d, cx: span(), cy: h / 2 + (rand() < 0.3 ? rand() * 6 : 0), cz: span(), rotX, rotY };
    if (rand() < 0.05) box.porous = true;
    boxes.push(box);
  }
  // The clusters: runs of the small boxes, moved together as a prop's are.
  const boxGroups = [];
  for (let i = 400; i < 600; ) {
    const n = 2 + Math.floor(rand() * 5);
    if (i + n > 600) break;
    const x = span();
    const z = span();
    const group = [];
    for (let j = i; j < i + n; j++) {
      boxes[j].cx = x + (rand() * 2 - 1) * 2;
      boxes[j].cz = z + (rand() * 2 - 1) * 2;
      group.push(j);
    }
    boxGroups.push(group);
    i += n;
  }
  const terrain = new TerrainField();
  const rays = new RayWorld(SIZE, boxes, [], terrain, boxGroups);
  const map = { colliderBoxes: boxes, boxGroups, rays, terrain, collidables: new CollisionField(rays) };
  return { map, anchors: boxes, input: worldInput(map, SIZE) };
}

/**
 * Six hull boxes, two of each kind, each standing on the floor beside a random
 * collider at a random yaw. Babylon gets them as meshes built after the map;
 * ours as `RayHull`s in `rays.hulls`, which `bodyNear` hands over last.
 */
function addHulls(env, map, rand, anchors) {
  const hulls = [];
  for (const kind of ["tank", "truck", "heli", "tank", "truck", "heli"]) {
    const h = env.params[kind].hull;
    const a = anchors[Math.floor(rand() * anchors.length)];
    const dir = rand() * Math.PI * 2;
    const far = Math.max(a.w, a.d) / 2 + Math.max(h.width, h.length) / 2 + 0.5 + rand() * 2;
    const cx = a.cx + Math.cos(dir) * far;
    const cz = a.cz + Math.sin(dir) * far;
    const box = {
      w: h.width,
      h: h.height,
      d: h.length,
      cx,
      cy: map.terrain.heightAt(cx, cz) + h.height / 2,
      cz,
      rotX: 0,
      rotY: rand() * Math.PI * 2,
    };
    map.rays.hulls.push({ rayBox: () => box });
    hulls.push(box);
  }
  return hulls;
}

/**
 * A `RayWorld` as far as `CollisionField` can tell, counting what it is asked:
 * how often the gather fell through to the whole map, and the list the last
 * sweep was run over (the field's own array, refilled in place).
 */
function countingRays(rays) {
  return {
    whole: 0,
    last: null,
    bodyNear(x, z, reach, skip, out) {
      if (reach === Infinity) this.whole++;
      this.last = out;
      return rays.bodyNear(x, z, reach, skip, out);
    },
  };
}

// ---------------------------------------------------------------------------
// Sampling single moves (`exact`, `shipped`).

/**
 * One start and one step round `box`, in its turned frame. The ellipsoid's
 * CENTRE is drawn and the body's position backed out of it, so the offset
 * sphere of a hull is what touches the box.
 */
function drawSample(rand, box, body) {
  const rx = body.radii.x;
  const ry = body.radii.y;
  const offset = body.offsetAt(rand() * Math.PI * 2, rand() < 0.5 ? 1 : -1);
  const [s0, s1] = body.step;
  let len = s0 + rand() * (s1 - s0);
  if (rand() < 1 / 7) len *= 20;
  const hw = (box.w || 1) / 2;
  const hd = (box.d || 1) / 2;
  let u;
  let v;
  let nx = 0;
  let nz = 0;
  if (rand() < 0.1) {
    // Embedded: the centre anywhere in the box grown by half a radius.
    u = (rand() * 2 - 1) * (hw + rx * 0.5);
    v = (rand() * 2 - 1) * (hd + rx * 0.5);
  } else {
    // Off one face: a little past either end of it tangentially, and from
    // touching to a radius clear of it — most within the step's reach.
    const clear = rand() < 0.65 ? rand() * len * 1.3 : rand() * rx;
    const side = rand() < 0.5 ? -1 : 1;
    if (rand() < 0.5) {
      u = side * (hw + rx + clear);
      v = (rand() * 2 - 1) * hd * 1.15;
      nx = side;
    } else {
      u = (rand() * 2 - 1) * hw * 1.15;
      v = side * (hd + rx + clear);
      nz = side;
    }
  }
  // The box's yaw, as `RotationYawPitchRoll` turns its local x and z.
  const c = Math.cos(box.rotY);
  const s = Math.sin(box.rotY);
  const ex = box.cx + u * c + v * s;
  const ez = box.cz - u * s + v * c;
  const ey = box.cy + (rand() * 2 - 1) * (box.h / 2 + ry);
  // Toward the box within seventy degrees of its face, or anywhere at all.
  let dir;
  if ((nx || nz) && rand() < 0.7) {
    const wx = -(nx * c + nz * s);
    const wz = -(-nx * s + nz * c);
    dir = Math.atan2(wz, wx) + (rand() * 2 - 1) * (Math.PI * 7) / 18;
  } else {
    dir = rand() * Math.PI * 2;
  }
  const step = [Math.cos(dir) * len, 0, Math.sin(dir) * len];
  if (rand() < 0.1) step[1] = len * (rand() * 2 - 1) * 0.5;
  const position = [ex - offset[0], ey - offset[1], ez - offset[2]];
  return { position, offset, step, centre: [ex, ey, ez] };
}

/**
 * Whether an ellipsoid with radii (r, ry, r) at `p` overlaps `box`. Round the
 * vertical axis it is a circle, so in the box's yaw frame with y scaled by
 * r / ry it is a sphere against an axis-aligned box — exact for an unpitched
 * box, and the unpitched footprint's answer for a pitched one.
 */
function overlaps(p, r, ry, box) {
  const c = Math.cos(box.rotY);
  const s = Math.sin(box.rotY);
  const dx = p[0] - box.cx;
  const dz = p[2] - box.cz;
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const ly = ((p[1] - box.cy) * r) / ry;
  const qx = Math.max(Math.abs(lx) - (box.w || 1) / 2, 0);
  const qz = Math.max(Math.abs(lz) - (box.d || 1) / 2, 0);
  const qy = Math.max(Math.abs(ly) - (((box.h || 1) / 2) * r) / ry, 0);
  return qx * qx + qy * qy + qz * qz < r * r;
}

/** Whether a start is embedded in anything near it, and in its own anchor. */
function embedding(map, smp, body, anchor, scratch) {
  const r = body.radii.x;
  const ry = body.radii.y;
  map.rays.bodyNear(smp.centre[0], smp.centre[2], r + 1, null, scratch);
  return {
    any: scratch.some((b) => overlaps(smp.centre, r, ry, b)),
    anchor: overlaps(smp.centre, r, ry, anchor),
  };
}

/** A small stable hash, so a stream does not depend on which maps were named. */
function hashOf(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
const streamSeed = (key) => (Math.imul(SEED, 0x9e3779b1) ^ hashOf(key)) >>> 0;

/** The anchor of the next sample: a synthetic hull an eighth of the time. */
const anchorOf = (rand, hulls, anchors) =>
  rand() < 0.12 ? hulls[Math.floor(rand() * hulls.length)] : anchors[Math.floor(rand() * anchors.length)];

const reproduce = (def, body, n, smp) =>
  `  replay   node scripts/sweep-check.mjs ${def.id} --seed ${SEED} --body ${body.name}${TIGHT ? " --tight" : ""} (sample ${n})\n` +
  `  radii    ${JSON.stringify([body.radii.x, body.radii.y, body.radii.z])}\n` +
  `  position ${JSON.stringify(smp.position)}\n` +
  `  offset   ${JSON.stringify(smp.offset)}\n` +
  `  step     ${JSON.stringify(smp.step)}`;

// ---------------------------------------------------------------------------
// `exact`

async function runExact(env, def, state) {
  const { CollisionField, mulberry32 } = env;
  const { map, anchors, input } = await buildWorld(env, def);
  const rand = mulberry32(streamSeed(def.id));
  const hulls = addHulls(env, map, rand, anchors);
  const fields = (TIGHT ? TIGHT_KNOBS : [{}]).map((knobs) => {
    const counting = countingRays(map.rays);
    return { counting, field: new CollisionField(counting, knobs), ours: { x: 0, y: 0, z: 0 } };
  });
  const regathers = () => fields.reduce((a, f) => a + f.field.regathered, 0);
  const wholes = () => fields.reduce((a, f) => a + f.counting.whole, 0);
  const scratch = [];
  for (const body of bodiesOf(env.params)) {
    const row = {
      map: def.id, body: body.name, samples: 0, blocked: 0, embedded: 0, inAnchor: 0,
      regathered: 0, whole: 0, oursMs: 0,
    };
    const regathered0 = regathers();
    const whole0 = wholes();
    const groupOf = (n) => `${def.id} ${body.name} @${Math.floor(n / BLOCK)}`;
    // Each body's samples are a stream of their own (the hulls are the map's),
    // so a run naming one body (`--body`) draws what the table's run drew.
    const draw = mulberry32(streamSeed(`${def.id}/${body.name}`));
    for (let n = 0; n < SAMPLES; n += BLOCK) ledger.input(groupOf(n), input);
    for (let n = 0; n < SAMPLES; n++) {
      const anchor = anchorOf(draw, hulls, anchors);
      const smp = drawSample(draw, anchor, body);
      // `--perturb`: our start a millimetre off in x, the table's not.
      const start = PERTURB ? [smp.position[0] + NUDGE, smp.position[1], smp.position[2]] : smp.position;
      const t = performance.now();
      oursFromFloat32(env, fields[0].field, start, body.radii, smp.offset, smp.step, fields[0].ours);
      row.oursMs += performance.now() - t;
      for (let i = 1; i < fields.length; i++) {
        oursFromFloat32(env, fields[i].field, start, body.radii, smp.offset, smp.step, fields[i].ours);
      }
      row.samples++;
      const emb = embedding(map, smp, body, anchor, scratch);
      if (emb.any) row.embedded++;
      if (emb.anchor) row.inAnchor++;
      // Field 0's answer is held to the table, and every other gather
      // (`--tight`) must give field 0's to the bit.
      const first = fields[0].ours;
      ledger.answer(groupOf(n), [first.x, first.y, first.z]);
      const free = Math.hypot(first.x - start[0] - smp.step[0], first.y - start[1] - smp.step[1], first.z - start[2] - smp.step[2]);
      if (free > BLOCKED) row.blocked++;
      if (fields.every((f) => same(f.ours, first))) continue;
      state.failures++;
      if (state.failures <= SHOW) {
        console.log(
          `DIFF ${def.id} ${body.name} sample ${n}: the gathers disagree\n${reproduce(def, body, n, smp)}\n` +
            fields.map(({ ours }, i) => `  ours (gather ${i}) ${JSON.stringify([ours.x, ours.y, ours.z])}`).join("\n"),
        );
      }
    }
    row.regathered = regathers() - regathered0;
    row.whole = wholes() - whole0;
    state.rows.push(row);
  }
  return map.colliderBoxes.length;
}

function reportExact(state) {
  const us = (ms, n) => ((ms * 1000) / n).toFixed(1);
  table(
    ["map", "body", "samples", "blocked", "embedded", "in anchor", "regathered", "whole map", "µs ours"],
    state.rows.map((r) => [
      r.map, r.body, r.samples, r.blocked, r.embedded, r.inAnchor, r.regathered, r.whole, us(r.oursMs, r.samples),
    ]),
  );
  const gathered = TIGHT ? ` with --tight (${sum(state.rows, "regathered")} re-gathered, ${sum(state.rows, "whole")} fell through to the whole map)` : "";
  console.log(`\n${sum(state.rows, "samples")} samples held to the table${gathered}.`);
  if (state.failures) console.log(`FAILED: ${state.failures} samples' gathers disagree${state.failures > SHOW ? ` (the first ${SHOW} printed)` : ""}`);
  return state.failures > 0;
}

const sum = (rows, k) => rows.reduce((a, r) => a + r[k], 0);
function table(head, rows) {
  const width = head.map((h, i) => Math.max(h.length, ...rows.map((row) => String(row[i]).length)));
  const line = (row) => row.map((c, i) => (i < 2 ? String(c).padEnd(width[i]) : String(c).padStart(width[i]))).join("  ");
  console.log(`\n${line(head)}`);
  for (const row of rows) console.log(line(row));
}

// ---------------------------------------------------------------------------

const started = performance.now();
const server = await vite();
let exitCode = 0;
try {
  const CONFIG = (await server.ssrLoadModule("/src/config/index.ts")).CONFIG;
  ledger = new Ledger("sweep-check", { seed: SEED, samples: SAMPLES, block: BLOCK }, {
    perturb: PERTURB && "input",
    partial: named.length > 0 || ONLY_BODY !== null,
  });
  // The bodies the table was recorded with (`CONFIG`'s at the time).
  const params = ledger.recorded()?.frozen?.bodies;
  if (!params) throw new Error(`no recorded bodies in ${ledger.path}`);
  const env = {
    CONFIG,
    params,
    buildServerWorld: (await server.ssrLoadModule("/server/world.ts")).buildServerWorld,
    mulberry32: (await server.ssrLoadModule("/src/world/rng.ts")).mulberry32,
    ...(await server.ssrLoadModule("/src/world/CollisionField.ts")),
    RayWorld: (await server.ssrLoadModule("/src/world/RayWorld.ts")).RayWorld,
    TerrainField: (await server.ssrLoadModule("/src/world/TerrainField.ts")).TerrainField,
  };
  const { MAPS } = await server.ssrLoadModule("/src/world/maps.ts");
  // The proving ground is DEV-only and not a level, and was not recorded. The
  // seeded world runs after the maps.
  const synthetic = { id: SYNTHETIC };
  const all = [...MAPS.filter((m) => m.id !== "proving"), synthetic];
  const defs = named.length ? named.map((id) => all.find((m) => m.id === id) ?? id) : all;
  const unknown = defs.filter((d) => typeof d === "string");
  if (unknown.length) throw new Error(`no such map: ${unknown.join(", ")} (the maps are ${all.map((m) => m.id).join(", ")})`);
  if (ONLY_BODY && !bodiesOf(env.params).length) throw new Error(`no such body: ${ONLY_BODY}`);

  console.log(`sweep-check${TIGHT ? " --tight" : ""}${PERTURB ? " --perturb" : ""}: ${SAMPLES} samples a body, seed ${SEED}, against the table`);
  const state = { rows: [], failures: 0 };
  for (const def of defs) {
    const t = performance.now();
    const boxes = await runExact(env, def, state);
    console.log(`  ${def.id}: ${boxes} boxes, ${((performance.now() - t) / 1000).toFixed(1)} s`);
  }
  if (reportExact(state)) exitCode = 1;
  if (ledger.finish()) exitCode = 1;
  console.log(`\nsweep-check: ${defs.length} map(s) in ${((performance.now() - started) / 1000).toFixed(1)} s`);
} catch (e) {
  console.log(`sweep-check: ${e?.stack ?? e}`);
  exitCode = 1;
} finally {
  await server.close();
}
process.exit(exitCode);
