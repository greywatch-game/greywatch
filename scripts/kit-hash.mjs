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

/** Builds `[key, job]` pairs and returns `{ key: { draw, colliders } | { error } }`. */
async function hashJobs(jobs) {
  stubCanvas();
  const server = await vite();
  const out = {};
  try {
    const B = await server.ssrLoadModule("@babylonjs/core");
    B.Logger.LogLevels = B.Logger.NoneLogLevel;
    const { BUILDERS } = await server.ssrLoadModule("/src/world/BuildingKit.ts");
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
      } catch (e) {
        out[key] = { error: String(e?.message ?? e) };
      }
    }
  } finally {
    await server.close();
  }
  return out;
}

/** Every placement of the asked-for kinds in every layout, plus one bare build of each. */
async function listJobs(only) {
  const jobs = new Map();
  const server = await vite();
  try {
    const { BUILDERS } = await server.ssrLoadModule("/src/world/BuildingKit.ts");
    if (only) for (const k of only) if (!(k in BUILDERS)) throw new Error(`no builder "${k}"`);
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
  const only = opt("kinds") ? new Set(opt("kinds").split(",")) : null;
  const outFile = opt("out");
  const againstFile = opt("against");

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
  if (outFile) {
    writeFileSync(outFile, JSON.stringify(Object.fromEntries(keys.map((k) => [k, result[k]])), null, 1));
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
