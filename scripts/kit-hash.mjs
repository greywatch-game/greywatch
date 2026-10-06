/**
 * Fingerprints what the kit's builders BUILD — `npm run kit:hash`.
 *
 * Owns: nothing but a report and, when asked, one JSON file. Every placement
 * of every builder in every map's layout is built under a NullEngine and
 * hashed twice: the DRAWING (every mesh's vertices, indices, material, name
 * and transform, the panes, the lights and the sounds) and the COLLIDERS (the
 * `BoxSpec` list, in the order it was emitted). Each kind is also built once
 * bare — default params, no `BuildCtx` — as a preview would build it.
 *
 * **What it is for is proving a change did or did not move something.** Take
 * a fingerprint, make the change, take another against it:
 *
 *   npm run kit:hash -- --kinds torii,toro --out before.json
 *   ...edit...
 *   npm run kit:hash -- --kinds torii,toro --against before.json
 *
 * A pure refactor must come back with nothing changed at all. A model rework
 * that claims "the colliders are unchanged, byte for byte" — which is the
 * claim that decides whether it owes `npm run collision` — must come back
 * with the drawing changed and the colliders not.
 *
 * **It is a comparison, never a picture of a map.** The ground under each
 * placement is a synthetic swell rather than that map's floor (the floors are
 * lazy halves this does not load), the materials are stand-ins named for the
 * factory call that asked for them, and nothing is merged, culled or drawn —
 * so a hash means something only against another hash taken the same way.
 * For what a change LOOKS like, `.claude/skills/model-detail/scripts/shots.mjs`.
 *
 * Flags: `--kinds a,b` limits it to those builder keys (every key in
 * `BUILDERS` otherwise); `--out file` writes the fingerprint; `--against
 * file` compares with one and exits 1 on any difference, listing the drawing
 * and the collider changes apart (with `--kinds`, only those kinds of the
 * file are compared, so one whole-kit fingerprint serves every later check).
 * A build that throws is recorded as its error message, so a builder broken
 * by the change is a difference too.
 *
 * **The SCATTER props are fingerprinted too** (`MapBuilder`'s
 * `SCATTER_BUILDERS` — the trees, rocks, barrels and junk in `Props.ts`),
 * and since a layout places a REGION rather than a prop, each kind is built
 * over `SCATTER_SEEDS` fixed seeds at every rung of `CONFIG.graphics.foliage`
 * instead of over its placements. Its two halves are the scatter's own: the
 * DRAWING is the prop as `MapBuilder.flatten` would hand it to the merge —
 * the root and every child mesh, in that order, metadata included, because
 * `noInk`/`noGlow`/`noShadowCaster` are part of the merge key — and the
 * COLLIDERS are what decides where a blocking field's boxes go: the kind's
 * `PROP_BODIES` row, and how many numbers the builder drew from the REGION's
 * stream. That count is the one a rework must not move ("keep 48 rng draws"):
 * every prop after it in the region, and every yaw, comes off the same
 * stream, so a builder that draws one more rerolls the whole field — and its
 * colliders — without a vertex of its own changing. The prop's own `sub`
 * stream reaches only its own drawing, which is already hashed. A scatter
 * kind is named in `--kinds` like any other.
 *
 * `--feet` asks a different question of the same builds: for every kind in
 * `scripts/lib/footprints.mjs`'s `FOOT`, how far the DRAWING reaches past
 * the footprint the generators claim for it, worst case over every placement
 * (and the bare build) on each side of the builder's own frame — once for
 * what stands below head height, once for everything. A positive figure is a
 * footprint that understates its builder, and a kind with one in the ground
 * columns is flagged — past its row plus its `LITTER` allowance, a kind with
 * one being marked `(litter)` instead; the table's header says which kinds
 * take more ground than they draw, or less, on purpose. It is the check a
 * builder rework owes before the table is trusted again, and it writes
 * nothing.
 *
 * Two stand-ins decide what a hash can see. A PATH road is built without its
 * share of the network (`BuildCtx.road`, which only `MapBuilder` can hand
 * out), so it builds empty and only a rectangle road is really covered; and
 * the road's ground texture is painted on a canvas that draws nothing, being
 * a material's content rather than the builder's geometry.
 *
 * The builds run in WORKER processes, a few hundred each: Babylon keeps a
 * disposed Scene reachable through something a NullEngine run never
 * releases, so one process over the whole kit grows past Node's heap however
 * carefully it disposes, and a worker that exits hands all of it back at once.
 *
 * Never: writes anything but `--out`, or fails a build — it is not a gate.
 * A `--feet` run's measurements stay out of `--out`'s fingerprint, which
 * hashes and nothing else.
 */
import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const args = process.argv.slice(2);
const opt = (k) => {
  const i = args.indexOf(`--${k}`);
  return i < 0 ? undefined : args[i + 1];
};

/** Builds per worker. See the header for why there are workers at all. */
const CHUNK = 250;

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

/**
 * The seeds every scatter kind is built over. The region's stream and the
 * prop's own are both minted from one, the second XORed apart, so a builder
 * reading either is exercised; eight is enough that a draw-dependent branch
 * (a bamboo clump's culm count, a cask's decay) takes more than one arm.
 */
const SCATTER_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

/** A seeded stream that counts how many numbers were drawn from it. */
function counted(next) {
  const f = () => {
    f.draws++;
    return next();
  };
  f.draws = 0;
  return f;
}

/** The ground every placement stands on: a swell, not any map's floor. */
const swell = (x, z) => 3 * Math.sin(x * 0.07) + 2 * Math.cos(z * 0.05) + 0.01 * x;

/**
 * A canvas that draws nothing. The road paints its ground texture on one, and
 * Node has none; what is painted never reaches either hash — the texture is
 * the MATERIAL's, and a material here is only its name — so a sink that
 * answers every call with itself is enough to let the road be built at all.
 */
function stubCanvas() {
  const sink = new Proxy(function () {}, {
    get: (_t, p) => (p === Symbol.toPrimitive ? () => 0 : p === "then" ? undefined : sink),
    apply: () => sink,
    construct: () => sink,
  });
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }
    getContext() {
      return sink;
    }
  };
}

/**
 * What a body cannot walk under: anything below this, in metres over the
 * placement's origin. A wall's foot is under it and its eaves are not.
 */
const HEADROOM = 2;

/**
 * The plan of what a builder drew, `[x0, x1, z0, z1]` in its own frame — a
 * structure is origin-local until `MapBuilder` turns and places it — twice:
 * everything (`plan`), and only what stands below `HEADROOM` (`ground`).
 */
function planOf(B, meshes) {
  const all = [Infinity, -Infinity, Infinity, -Infinity];
  const low = [Infinity, -Infinity, Infinity, -Infinity];
  const grow = (b, x, z) => {
    if (x < b[0]) b[0] = x;
    if (x > b[1]) b[1] = x;
    if (z < b[2]) b[2] = z;
    if (z > b[3]) b[3] = z;
  };
  const v = new B.Vector3();
  for (const m of meshes) {
    const pos = m.getVerticesData("position");
    if (!pos) continue;
    const wm = m.computeWorldMatrix(true);
    for (let i = 0; i < pos.length; i += 3) {
      B.Vector3.TransformCoordinatesFromFloatsToRef(pos[i], pos[i + 1], pos[i + 2], wm, v);
      grow(all, v.x, v.z);
      if (v.y < HEADROOM) grow(low, v.x, v.z);
    }
  }
  const mm = (b) => b.map((n) => Math.round(n * 1000) / 1000);
  return { plan: mm(all), ground: mm(low) };
}

/**
 * `--feet`'s report: per kind, the furthest the drawing reaches past its
 * `FOOT` entry on each side (`-x +x -z +z`), over every build of it — first
 * what stands on the ground, then everything, eaves and canopies included.
 */
async function reportFeet(result, notBuilt) {
  const { FOOT, LITTER } = await import("./lib/footprints.mjs");
  const worst = new Map();
  const reach = (box, [x0, x1, z0, z1]) => [x0 - box[0], box[1] - x1, z0 - box[2], box[3] - z1];
  const max = (a, b) => a.map((q, i) => Math.max(q, b[i]));
  const unlisted = new Set();
  for (const [key, r] of Object.entries(result)) {
    if (!r.plan) continue;
    const parsed = JSON.parse(key);
    // A scatter kind has no footprint: it is sown by clearance, not placed.
    if (parsed[1] === "scatter") continue;
    const kind = parsed[0];
    // `--kinds` may name a builder the table has no row for (a road).
    if (!(kind in FOOT)) {
      unlisted.add(kind);
      continue;
    }
    const foot = FOOT[kind](parsed[1] === "bare" ? {} : parsed[1]);
    const none = [-Infinity, -Infinity, -Infinity, -Infinity];
    const w = worst.get(kind) ?? { n: 0, ground: none, plan: none };
    w.n++;
    w.ground = max(w.ground, reach(r.ground, foot));
    w.plan = max(w.plan, reach(r.plan, foot));
    worst.set(kind, w);
  }
  const f = (n) => (Number.isFinite(n) ? (n > 0 ? "+" : "") + n.toFixed(2) : "-").padStart(6);
  console.log(`feet: how far each kind reaches past its FOOT entry, worst build (+ = the table understates it)`);
  console.log(`  ${"".padEnd(21)}  ground, under ${HEADROOM} m          everything`);
  console.log(`  ${"kind".padEnd(14)} ${"builds".padStart(6)}     -x     +x     -z     +z      -x     +x     -z     +z`);
  for (const [kind, w] of [...worst].sort((p, q) => (p[0] < q[0] ? -1 : 1))) {
    const litter = LITTER[kind] ?? {};
    const allowed = ["-x", "+x", "-z", "+z"].map((side) => litter[side] ?? 0);
    const flag = w.ground.some((q, i) => q > allowed[i] + 0.05) ? "  <" : Object.keys(litter).length ? "  (litter)" : "";
    console.log(`  ${kind.padEnd(14)} ${String(w.n).padStart(6)} ${w.ground.map(f).join(" ")}  ${w.plan.map(f).join(" ")}${flag}`);
  }
  if (notBuilt.length) console.log(`  in FOOT but not a builder: ${notBuilt.join(", ")}`);
  if (unlisted.size) console.log(`  a builder with no FOOT row: ${[...unlisted].sort().join(", ")}`);
}

/** Builds `[key, job]` pairs and returns `{ key: { draw, colliders } | { error } }`. */
async function hashJobs(jobs) {
  stubCanvas();
  const server = await vite();
  const out = {};
  try {
    const B = await server.ssrLoadModule("@babylonjs/core");
    B.Logger.LogLevels = B.Logger.NoneLogLevel;
    const { BUILDERS } = await server.ssrLoadModule("/src/world/BuildingKit.ts");
    const { SCATTER_BUILDERS, PROP_BODIES } = await server.ssrLoadModule("/src/world/MapBuilder.ts");
    const { mulberry32 } = await server.ssrLoadModule("/src/world/rng.ts");
    const engine = new B.NullEngine();
    let scene = new B.Scene(engine);
    // A material is named for the factory call that asked for it, so a
    // builder that paints a part another colour changes the drawing's hash. A
    // Babylon object among the arguments (the road's ground texture) is named
    // by its class and name, being a graph that points back at the engine.
    const cache = new Map();
    const plain = (_k, v) =>
      v && typeof v === "object" && typeof v.getClassName === "function" ? `${v.getClassName()}:${v.name}` : v;
    const mats = new Proxy(
      {},
      {
        get: (_t, prop) => (...a) => {
          const key = `${String(prop)}(${JSON.stringify(a, plain)})`;
          if (!cache.has(key)) cache.set(key, new B.StandardMaterial(key, scene));
          return cache.get(key);
        },
      },
    );
    const terrain = { flat: false, surfaceAt: swell, heightAt: swell };
    const f32 = (a) => (a ? Buffer.from(new Float32Array(a).buffer) : Buffer.alloc(0));
    for (const [key, p] of jobs) {
      scene.dispose();
      scene = new B.Scene(engine);
      cache.clear();
      try {
        if (p.scatter) {
          out[key] = hashScatter(SCATTER_BUILDERS[p.kind], PROP_BODIES[p.kind], scene, mats, mulberry32, p, f32);
          continue;
        }
        const floor = p.bare ? 0 : swell(p.x, p.z);
        const ctx = p.bare
          ? undefined
          : { terrain, x: p.x, z: p.z, y: floor + (p.y ?? 0), floor, rotY: p.rotY ?? 0 };
        const s = p.bare ? BUILDERS[p.kind](scene, mats) : BUILDERS[p.kind](scene, mats, p.params ?? {}, ctx);
        const draw = createHash("sha256");
        for (const m of [...s.meshes, ...s.paneMeshes]) {
          draw.update(`|${m.name}|${m.material?.name}|${s.freeform.has(m)}|`);
          draw.update(
            JSON.stringify([
              m.position.asArray(),
              m.rotation.asArray(),
              m.scaling.asArray(),
              m.rotationQuaternion?.asArray() ?? null,
              m.parent?.name ?? null,
            ]),
          );
          for (const kind of ["position", "normal", "uv", "uv2", "color", "matricesIndices"]) {
            draw.update(kind);
            draw.update(f32(m.getVerticesData(kind)));
          }
          draw.update(Buffer.from(new Uint32Array(m.getIndices() ?? []).buffer));
        }
        draw.update(JSON.stringify([s.lights, s.sounds, s.panes]));
        const colliders = createHash("sha256").update(JSON.stringify(s.colliders));
        out[key] = { draw: draw.digest("hex").slice(0, 16), colliders: colliders.digest("hex").slice(0, 16) };
        if (process.env.KIT_HASH_FEET) Object.assign(out[key], planOf(B, [...s.meshes, ...s.paneMeshes]));
      } catch (e) {
        out[key] = { error: String(e?.message ?? e) };
      }
    }
  } finally {
    await server.close();
  }
  return out;
}

/**
 * One scatter prop, built off `p.seed` at foliage `p.foliage` and hashed in
 * two halves — see the header for what each one is.
 */
function hashScatter(build, body, scene, mats, mulberry32, p, f32) {
  const rng = counted(mulberry32(p.seed));
  const sub = counted(mulberry32(p.seed ^ 0x2545f491));
  const root = build(scene, mats, rng, sub, p.foliage);
  const draw = createHash("sha256");
  // `MapBuilder.flatten`'s order: the root, then its child meshes.
  for (const m of [root, ...root.getChildMeshes()]) {
    draw.update(`|${m.name}|${m.material?.name}|${JSON.stringify(m.metadata ?? null)}|`);
    draw.update(
      JSON.stringify([
        m.position.asArray(),
        m.rotation.asArray(),
        m.scaling.asArray(),
        m.rotationQuaternion?.asArray() ?? null,
        m.parent?.name ?? null,
      ]),
    );
    for (const kind of ["position", "normal", "uv", "uv2", "color", "matricesIndices"]) {
      draw.update(kind);
      draw.update(f32(m.getVerticesData(kind)));
    }
    draw.update(Buffer.from(new Uint32Array(m.getIndices() ?? []).buffer));
  }
  const colliders = createHash("sha256").update(JSON.stringify([body, rng.draws]));
  return { draw: draw.digest("hex").slice(0, 16), colliders: colliders.digest("hex").slice(0, 16) };
}

/**
 * Every placement of the asked-for kinds in every layout, plus one bare build
 * of each — and every asked-for scatter kind over every seed and foliage rung.
 */
async function listJobs(only) {
  const jobs = new Map();
  const server = await vite();
  try {
    const { BUILDERS } = await server.ssrLoadModule("/src/world/BuildingKit.ts");
    const { SCATTER_BUILDERS } = await server.ssrLoadModule("/src/world/MapBuilder.ts");
    const { CONFIG } = await server.ssrLoadModule("/src/config/index.ts");
    if (only) for (const k of only) if (!(k in BUILDERS) && !(k in SCATTER_BUILDERS)) throw new Error(`no builder "${k}"`);
    const worlds = readdirSync(join(ROOT, "src/world"), { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(ROOT, "src/world", d.name, "layout.ts")))
      .map((d) => d.name)
      .sort();
    for (const m of worlds) {
      const mod = await server.ssrLoadModule(`/src/world/${m}/layout.ts`);
      for (const layout of Object.values(mod)) {
        if (!layout || !Array.isArray(layout.placements)) continue;
        for (const p of layout.placements) {
          if (!(p.kind in BUILDERS) || (only && !only.has(p.kind))) continue;
          const job = { kind: p.kind, params: p.params, x: p.x, z: p.z, y: p.y, rotY: p.rotY };
          jobs.set(JSON.stringify([p.kind, p.params ?? {}, p.x, p.z, p.y ?? 0, p.rotY ?? 0]), job);
        }
      }
    }
    for (const k of Object.keys(BUILDERS)) {
      if (!only || only.has(k)) jobs.set(JSON.stringify([k, "bare"]), { kind: k, bare: true });
    }
    const rungs = [...new Set(Object.values(CONFIG.graphics.foliage.tiers).map((t) => t.detail))].sort();
    for (const k of Object.keys(SCATTER_BUILDERS)) {
      if (only && !only.has(k)) continue;
      for (const seed of SCATTER_SEEDS) {
        for (const foliage of rungs) {
          jobs.set(JSON.stringify([k, "scatter", seed, foliage]), { kind: k, scatter: true, seed, foliage });
        }
      }
    }
  } finally {
    await server.close();
  }
  return [...jobs].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

if (process.env.KIT_HASH_WORKER) {
  process.once("message", async (jobs) => {
    const out = await hashJobs(jobs);
    process.send(out, () => process.exit(0));
  });
} else {
  const feet = args.includes("--feet");
  if (feet) process.env.KIT_HASH_FEET = "1";
  const outFile = opt("out");
  const againstFile = opt("against");
  // `--feet` measures the kinds the footprint table names, unless told which.
  let only = opt("kinds") ? new Set(opt("kinds").split(",")) : null;
  let notBuilt = [];
  if (feet && !only) {
    const { FOOT } = await import("./lib/footprints.mjs");
    const server = await vite();
    try {
      const { BUILDERS } = await server.ssrLoadModule("/src/world/BuildingKit.ts");
      only = new Set(Object.keys(FOOT).filter((k) => k in BUILDERS));
      notBuilt = Object.keys(FOOT).filter((k) => !(k in BUILDERS));
    } finally {
      await server.close();
    }
  }

  const list = await listJobs(only);
  const chunks = [];
  for (let i = 0; i < list.length; i += CHUNK) chunks.push(list.slice(i, i + CHUNK));
  const result = {};
  const run = (chunk) =>
    new Promise((resolve, reject) => {
      const child = fork(SELF, [], { env: { ...process.env, KIT_HASH_WORKER: "1" } });
      child.once("message", (out) => Object.assign(result, out));
      child.once("exit", (code) => (code ? reject(new Error(`a worker exited with ${code}`)) : resolve()));
      child.send(chunk);
    });
  const lanes = Math.max(1, Math.min(4, Math.floor(cpus().length / 2), chunks.length));
  let next = 0;
  await Promise.all(
    Array.from({ length: lanes }, async () => {
      while (next < chunks.length) await run(chunks[next++]);
    }),
  );

  const keys = Object.keys(result).sort();
  const kindOf = (key) => JSON.parse(key)[0];
  const errors = keys.filter((k) => result[k].error);
  console.log(`${keys.length} builds of ${new Set(keys.map(kindOf)).size} kinds, ${errors.length} threw`);
  for (const k of errors.slice(0, 10)) console.log(`  threw  ${k}: ${result[k].error}`);
  if (feet) await reportFeet(result, notBuilt);
  if (outFile) {
    const hashOnly = ({ plan: _p, ground: _g, ...r }) => r;
    writeFileSync(outFile, JSON.stringify(Object.fromEntries(keys.map((k) => [k, hashOnly(result[k])])), null, 1));
    console.log(`wrote ${outFile}`);
  }
  if (againstFile) {
    // A whole-kit fingerprint may be compared against for a few kinds: the
    // kinds not asked for are not gone, merely not looked at.
    const before = Object.fromEntries(
      Object.entries(JSON.parse(readFileSync(againstFile, "utf8"))).filter(([k]) => !only || only.has(kindOf(k))),
    );
    const gone = Object.keys(before).filter((k) => !(k in result));
    const added = keys.filter((k) => !(k in before));
    const both = keys.filter((k) => k in before);
    const differs = (k, f) => JSON.stringify(before[k][f]) !== JSON.stringify(result[k][f]);
    const drawn = both.filter((k) => differs(k, "draw") || differs(k, "error"));
    const boxed = both.filter((k) => differs(k, "colliders") || differs(k, "error"));
    const report = (label, ks) => {
      const per = {};
      for (const k of ks) per[kindOf(k)] = (per[kindOf(k)] ?? 0) + 1;
      const kinds = Object.entries(per)
        .map(([k, n]) => `${k} ${n}`)
        .join(", ");
      console.log(`  ${label.padEnd(18)} ${ks.length}${ks.length ? `  (${kinds})` : ""}`);
    };
    console.log(`against ${againstFile}:`);
    report("drawing changed", drawn);
    report("colliders changed", boxed);
    report("builds added", added);
    report("builds gone", gone);
    if (drawn.length + boxed.length + added.length + gone.length) process.exit(1);
    console.log("  identical");
  }
}
