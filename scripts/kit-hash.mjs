/**
 * Fingerprints what the kit's builders BUILD — `npm run kit:hash` — and, with
 * `--models`, every other model in the game.
 *
 * Owns: nothing but a report and, when asked, one JSON file. Every placement
 * of every builder in every map's layout is built, made into part meshes
 * through the door `MapBuilder` uses (`structureMeshes`) under a NullEngine,
 * and hashed twice: the DRAWING (every mesh's vertices, indices, material, name
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
 * Flags: `--models` fingerprints the models instead of the kit (below);
 * `--kinds a,b` limits it to those builder keys (every key in `BUILDERS`
 * otherwise); `--out file` writes the fingerprint; `--against
 * file` compares with one and exits 1 on any difference, listing the drawing
 * and the collider changes apart (with `--kinds`, only those kinds of the
 * file are compared, so one whole-kit fingerprint serves every later check).
 * A build that throws is recorded as its error message, so a builder broken
 * by the change is a difference too.
 *
 * **The SCATTER props are fingerprinted too** (`MapBuilder`'s
 * `SCATTER_BUILDERS` — the trees, rocks, barrels and junk in `world/props/`),
 * and since a layout places a REGION rather than a prop, each kind is built
 * over `SCATTER_SEEDS` fixed seeds at every rung of `CONFIG.graphics.foliage`
 * instead of over its placements. Its two halves are the scatter's own: the
 * DRAWING is the prop as `propMeshes` (`MapBuilder`) hands it to the merge
 * — the root and every child, in that order, each child's parent composed
 * into its own transform and the link cut (`flattenParts`), metadata included,
 * because `noInk`/`noGlow`/`noShadowCaster` are part of the merge key — and the
 * COLLIDERS are what decides where a blocking field's boxes go: the kind's
 * `PROP_BODIES` row, and how many numbers the builder drew from the REGION's
 * stream. That count is the one a rework must not move ("keep 48 rng draws"):
 * every prop after it in the region, and every yaw, comes off the same
 * stream, so a builder that draws one more rerolls the whole field — and its
 * colliders — without a vertex of its own changing. The prop's own `sub`
 * stream reaches only its own drawing, which is already hashed. A scatter
 * kind is named in `--kinds` like any other.
 *
 * **`--models` fingerprints everything drawn that is NOT the kit**, which is
 * what `BABYLON_EXIT.md` X1.3 moves onto `src/geometry/` and has to prove it
 * moved nothing:
 *
 * - each carried weapon's model (`weapon:<id>`, the builders `ViewModel`'s
 *   `WEAPON_BUILDERS` names: the seven guns, the launcher and the mine). A
 *   builder builds every optic its rail can take into the weapon, so one
 *   build covers them all. Each is built bare and in each finish
 *   (`applyFinish`, a material write the hash sees as material names);
 * - the `ViewModel` itself (`viewmodel`): the arms (`buildArm`), the throwing
 *   hand, its grenade and bottle, the spent magazines and the kit card. It is
 *   hashed as built, and with every carried weapon in every sight. Its data is
 *   what the fit derives from the geometry: the aimed pose off the worn
 *   sight's centre, the hip pose, the turntable pivot, and each rig's magazine
 *   pivots, which are MEASURED off the magazine's bounds;
 * - the `Player` (`player`): its capsule, flash petals and casing pool, over
 *   a `ViewModel` of its own;
 * - the four pooled bodies that fly or lie (`grenade`, `molotov`, `rocket`
 *   with its flame, `mine`, the laid one);
 * - every vehicle kind (`vehicle:<kind>`: the `CONFIG.vehicles` blocks
 *   `kindOf` pairs with a builder), for both sides, in its livery and wrecked;
 * - a soldier of each side (`soldier`), as `Bot` and `NetSoldier` build one;
 * - `CaptureZoneSystem`'s rings, poles and flags (`zone`), over every map's
 *   control points at their own positions and radii. They stand on
 *   `zoneWorld`, a striped stand-in that gives every ring open ground, made
 *   ground, a wall and a road to cross, and puts some poles under a roof. It
 *   is not the map.
 *
 * Each build gets a fresh Scene under the NullEngine and the stub factory
 * above. The viewer is on side 0, so side 1 is the other kit, and
 * `Math.random` is seeded (none of these builders calls it today).
 *
 * **It is stricter than the kit half, on purpose.** Every mesh AND every
 * transform node left in the scene is hashed. A part disposed after its merge
 * is gone from the scene and is not counted. Each node's record is its class,
 * name, parent, enabled state, transform and pivot. A mesh adds its material
 * name, visibility, picking and collision flags, rendering group, culling
 * flag, side orientation, metadata, sub-meshes and bounding box, then every
 * vertex attribute it carries and its indices. Each array goes in with its
 * TYPE (a `number[]` holds doubles and a `Float32Array` does not) and its
 * numbers as exact doubles, not through float32. The builder's plain data is
 * hashed with it (landmarks, the finish list, a rig's reaches), with each
 * Babylon object named by class and name.
 *
 * Each build gives two hashes. `draw` takes the records in SCENE ORDER;
 * `set` sorts them first. `--against` puts every build in one of three
 * buckets: "identical", "scene order differs" (the same nodes, created in
 * another order, as when a merge mints its mesh at a different moment) and
 * "content changed". It fails on content, and on order only under
 * `--strict-order`: whether creation order reaches a pixel is the reference
 * bank's question, not this one's. `--kinds` takes model kinds (`weapon:rifle`,
 * `viewmodel`, `vehicle:tank`, `zone`). `--feet` does not apply.
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
import { mulberry32 } from "../src/world/rng.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const args = process.argv.slice(2);
const opt = (k) => {
  const i = args.indexOf(`--${k}`);
  return i < 0 ? undefined : args[i + 1];
};

/** Builds per worker. See the header for why there are workers at all. */
const CHUNK = 250;
/** The same for `--models`, whose viewmodel builds are each nine weapons. */
const MODEL_CHUNK = 24;

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

/** A seeded stream that counts how many numbers were drawn from it — the region's. */
function counted(next) {
  const f = () => {
    f.draws++;
    return next();
  };
  f.draws = 0;
  return f;
}

/** A vertex buffer's bytes, empty for a buffer the mesh does not carry. */
const f32 = (a) => (a ? Buffer.from(new Float32Array(a).buffer) : Buffer.alloc(0));

/**
 * One mesh's transform and geometry into `draw`. Each caller writes its own
 * header line first — the name and material, and whatever else its kind of
 * build can see — so a structure's hash is what it was before scatter shared
 * this.
 */
function hashMesh(draw, m) {
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

/**
 * The material factory every build is handed: a material is named for the
 * factory call that asked for it, so a builder that paints a part another
 * colour changes the drawing's hash. A Babylon object among the arguments (the
 * road's ground texture) is named by its class and name, being a graph that
 * points back at the engine. `scene` is read per call, so one stub serves a
 * worker that makes a fresh Scene per build.
 */
function stubMats(B, cache, scene) {
  const plain = (_k, v) =>
    v && typeof v === "object" && typeof v.getClassName === "function" ? `${v.getClassName()}:${v.name}` : v;
  return new Proxy(
    {},
    {
      get: (_t, prop) => (...a) => {
        const key = `${String(prop)}(${JSON.stringify(a, plain)})`;
        if (!cache.has(key)) cache.set(key, new B.StandardMaterial(key, scene()));
        return cache.get(key);
      },
    },
  );
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
    const { SCATTER_BUILDERS, PROP_BODIES, propMeshes, structureMeshes } = await server.ssrLoadModule(
      "/src/world/MapBuilder.ts",
    );
    const engine = new B.NullEngine();
    let scene = new B.Scene(engine);
    const cache = new Map();
    const mats = stubMats(B, cache, () => scene);
    const terrain = { flat: false, surfaceAt: swell, heightAt: swell };
    for (const [key, p] of jobs) {
      scene.dispose();
      scene = new B.Scene(engine);
      cache.clear();
      try {
        if (p.scatter) {
          out[key] = hashScatter(SCATTER_BUILDERS[p.kind], PROP_BODIES[p.kind], propMeshes, scene, mats, p);
          continue;
        }
        const floor = p.bare ? 0 : swell(p.x, p.z);
        const ctx = p.bare
          ? undefined
          : { terrain, x: p.x, z: p.z, y: floor + (p.y ?? 0), floor, rotY: p.rotY ?? 0 };
        // Through the same door `MapBuilder` takes, so what is hashed is what
        // the merge is handed: every part a part mesh (`structureMeshes`).
        const built = p.bare ? BUILDERS[p.kind](scene, mats) : BUILDERS[p.kind](scene, mats, p.params ?? {}, ctx);
        const s = structureMeshes(built, scene);
        const draw = createHash("sha256");
        for (const m of [...s.meshes, ...s.paneMeshes]) {
          draw.update(`|${m.name}|${m.material?.name}|${s.freeform.has(m)}|`);
          hashMesh(draw, m);
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
function hashScatter(build, body, propMeshes, scene, mats, p) {
  const rng = counted(mulberry32(p.seed));
  const root = build(mats, rng, mulberry32(p.seed ^ 0x2545f491), p.foliage);
  const draw = createHash("sha256");
  // What `propMeshes` (`MapBuilder`) hands the merge: the root, then every
  // child with its parent's transform composed into its own and the link cut
  // (`flattenParts`), each made a part mesh. Hashed AFTER that rather than
  // before, so the fingerprint is of what the merge reads and not of how a
  // builder chose to say it — a child parented to a trunk and one placed
  // where the trunk would have put it are the same drawing.
  for (const m of propMeshes(root, scene)) {
    draw.update(`|${m.name}|${m.material?.name}|${JSON.stringify(m.metadata ?? null)}|`);
    hashMesh(draw, m);
  }
  const colliders = createHash("sha256").update(JSON.stringify([body, rng.draws]));
  return { draw: draw.digest("hex").slice(0, 16), colliders: colliders.digest("hex").slice(0, 16) };
}

/*
 * ---------------------------------------------------------------------------
 * `--models`: everything drawn that is not the world kit. See the header.
 * ---------------------------------------------------------------------------
 */

/** A number array's exact doubles, whatever array it arrived in. */
const f64 = (a) => Buffer.from(Float64Array.from(a).buffer);

/**
 * A plain-data replacer for what a builder hands back: a node, a material, a
 * texture or the scene is named by class and name (each is a graph pointing
 * back at the engine), a Babylon maths value is spelled out by class and its
 * numbers, the stub factory is `mats`, a typed array is its type and its
 * numbers, and a number JSON cannot spell (`Infinity`, `NaN`, `-0`) is spelled
 * as a string so it is not silently `null` or `0`.
 */
function plainOf(mats) {
  return function (_k, v) {
    if (v === mats) return "mats";
    if (typeof v === "number") return Number.isFinite(v) && !Object.is(v, -0) ? v : String(Object.is(v, -0) ? "-0" : v);
    if (!v || typeof v !== "object") return v;
    if (isGraph(v)) return `${v.getClassName()}:${v.name}`;
    if (ArrayBuffer.isView(v)) return [v.constructor.name, ...Array.from(v)];
    if (typeof v.getClassName === "function" && typeof v.asArray === "function") {
      return [v.getClassName(), ...Array.from(v.asArray())];
    }
    if (v instanceof Map) return ["Map", ...v];
    if (v instanceof Set) return ["Set", ...v];
    return v;
  };
}

/**
 * Whether a value is part of Babylon's object GRAPH — a node, a material, a
 * texture, the scene — rather than a value. Asked by shape, never by
 * `instanceof`: the `@babylonjs/core` this script loads through Vite is not
 * the instance the game's modules were linked against, so a mesh they build is
 * no instance of this script's `Mesh`, and a test by class would silently skip
 * every one of them.
 */
const isGraph = (v) =>
  typeof v.getClassName === "function" && (typeof v.uniqueId === "number" || v.getClassName() === "Scene");

/**
 * One node's whole record — everything the hash can see of it, in one buffer.
 * Its NAME and its PARENT'S are in it, so a part hung off a different joint is
 * a different record and not merely a reordering.
 */
function nodeRecord(n, plain) {
  const head = [
    n.getClassName(),
    n.name,
    n.parent ? `${n.parent.getClassName()}:${n.parent.name}` : null,
    n.isEnabled(false),
    n.position.asArray(),
    n.rotation.asArray(),
    n.scaling.asArray(),
    n.rotationQuaternion?.asArray() ?? null,
    Array.from(n.getPivotMatrix().m),
    n.infiniteDistance,
    n.billboardMode,
  ];
  const parts = [];
  if (typeof n.getBoundingInfo === "function") {
    head.push(
      n.material ? `${n.material.getClassName()}:${n.material.name}` : null,
      n.isVisible,
      n.isPickable,
      n.checkCollisions,
      n.renderingGroupId,
      n.alwaysSelectAsActiveMesh,
      n.sideOrientation ?? null,
      n.visibility,
      n.alphaIndex,
      n.layerMask,
      n.metadata ?? null,
      n.getTotalVertices(),
      (n.subMeshes ?? []).map((s) => [s.materialIndex, s.verticesStart, s.verticesCount, s.indexStart, s.indexCount]),
    );
    const box = n.getBoundingInfo().boundingBox;
    head.push(box.minimum.asArray(), box.maximum.asArray());
    if (typeof n.getVerticesDataKinds === "function") {
      for (const kind of [...n.getVerticesDataKinds()].sort()) {
        const vb = n.getVertexBuffer(kind);
        const data = vb.getData();
        // The array's TYPE is its precision — a `number[]` keeps doubles and a
        // `Float32Array` rounds — so it is part of the record, and the numbers
        // are hashed as exact doubles rather than through float32.
        parts.push(
          Buffer.from(
            JSON.stringify([kind, data?.constructor?.name ?? null, vb.getSize(), vb.byteStride, vb.byteOffset, vb.type, vb.normalized]),
          ),
        );
        if (data) parts.push(data instanceof ArrayBuffer ? Buffer.from(data) : f64(data));
      }
      const idx = n.getIndices(false, false);
      parts.push(Buffer.from(JSON.stringify(["indices", idx?.constructor?.name ?? null])));
      if (idx) parts.push(f64(idx));
    }
  }
  return Buffer.concat([Buffer.from(JSON.stringify(head, plain)), ...parts]);
}

/**
 * The two hashes of one model build: `draw`, every mesh and then every
 * transform node in SCENE ORDER followed by the builder's plain data, and
 * `set`, the same records hashed one by one and sorted first — so a build
 * whose nodes are all the same but were created in another order matches on
 * `set` and differs on `draw`. That is the difference `--against` reports as
 * "scene order differs", apart from "content changed".
 */
function hashScene(scene, data, plain) {
  const draw = createHash("sha256");
  const each = [];
  for (const list of [scene.meshes, scene.transformNodes]) {
    draw.update(`|${list === scene.meshes ? "meshes" : "nodes"}|${list.length}|`);
    for (const n of list) {
      const rec = nodeRecord(n, plain);
      draw.update(createHash("sha256").update(rec).digest());
      each.push((list === scene.meshes ? "m" : "n") + createHash("sha256").update(rec).digest("hex"));
    }
  }
  const tail = JSON.stringify(data ?? null, plain);
  draw.update(tail);
  each.sort();
  const set = createHash("sha256").update(each.join(",")).update(tail);
  return { draw: draw.digest("hex").slice(0, 16), set: set.digest("hex").slice(0, 16) };
}

/** What the capture-zone build stands on — see `zoneWorld`. */
const ZONE_DECK = 40;
const ZONE_WALL = 30;
const ZONE_ROOF = 60;

/**
 * A stand-in world for `CaptureZoneSystem.build`, which asks a map four
 * questions: the floor (the swell), the obstacle boxes' floors and walls, the
 * roads, and a body cast for the flag's pole. Each is answered by a pattern
 * striped across the plane, so every map's points — at their own positions
 * and radii — find open ground (stones), made ground (paint), a wall the ring
 * breaks at, and somewhere a roof the pole goes up through. A comparison and
 * not a map, like everything else here.
 */
function zoneWorld(points) {
  const mod = (a, n) => ((a % n) + n) % n;
  // A deck's top is flat over a 4 m cell, so `floorAt`'s probes agree on it.
  const deckTop = (x, z) => swell(Math.floor(x / 4) * 4 + 2, Math.floor(z / 4) * 4 + 2) + 0.2;
  const terrain = { flat: false, surfaceAt: swell, heightAt: swell };
  const obstacles = {
    groundAt: (x, z, ceiling, floor) => {
      if (mod(x, ZONE_DECK) >= 12) return null;
      const top = deckTop(x, z);
      return top <= ceiling && top >= floor ? top : null;
    },
    wallAt: (x, z) => mod(z, ZONE_WALL) < 2 && mod(x, ZONE_DECK) >= 12,
  };
  const roads = {
    rects: points.map((cp) => ({
      x: cp.pos.x + cp.radius * 0.7,
      z: cp.pos.z,
      rotY: 0.4,
      width: 3,
      length: cp.radius * 2,
      top: 0.06,
    })),
    pieces: [],
    cell: 16,
    ox: 0,
    oz: 0,
    nx: 0,
    nz: 0,
    cells: [],
  };
  const rays = {
    castBody: (from, dir, max, hit) => {
      if (mod(from.x, ZONE_ROOF) >= 15) return false;
      const roof = swell(from.x, from.z) + 4;
      const d = dir.y > 0 ? roof - from.y : from.y - (roof + 0.3);
      if (d < 0 || d > max) return false;
      hit.distance = d;
      hit.point.set(from.x, from.y + dir.y * d, from.z);
      hit.normal.set(0, -Math.sign(dir.y), 0);
      return true;
    },
  };
  return { terrain, obstacles, roads, rays, env: { fogEnd: 400 } };
}

/**
 * Builds model jobs and returns `{ key: { draw, set } | { error } }`. Each build
 * is in a fresh Scene with the viewer on side 0 and `Math.random` seeded, so a
 * builder that reached for it would still hash the same twice running (none
 * does today).
 */
async function hashModelJobs(jobs) {
  stubCanvas();
  const server = await vite();
  const out = {};
  const random = Math.random;
  try {
    const B = await server.ssrLoadModule("@babylonjs/core");
    B.Logger.LogLevels = B.Logger.NoneLogLevel;
    const load = (p) => server.ssrLoadModule(p);
    const [W, VM, PL, GR, MO, RPG, MINE, VK, SM, CZ, FIN, TV] = await Promise.all(
      [
        "/src/entities/weapons.ts",
        "/src/entities/ViewModel.ts",
        "/src/entities/Player.ts",
        "/src/entities/GrenadeModel.ts",
        "/src/entities/MolotovModel.ts",
        "/src/entities/RpgModel.ts",
        "/src/entities/MineModel.ts",
        "/src/entities/vehicleKinds.ts",
        "/src/entities/SoldierModel.ts",
        "/src/systems/CaptureZoneSystem.ts",
        "/src/entities/finishes.ts",
        "/src/core/teamView.ts",
      ].map(load),
    );
    const weaponBuilders = await modelWeaponBuilders(load);
    const engine = new B.NullEngine();
    let scene = new B.Scene(engine);
    const cache = new Map();
    const mats = stubMats(B, cache, () => scene);
    const plain = plainOf(mats);
    for (const [key, p] of jobs) {
      scene.dispose();
      scene = new B.Scene(engine);
      cache.clear();
      TV.setViewerTeam(0);
      Math.random = mulberry32(0x6d0de15);
      try {
        let data = null;
        if (p.kind.startsWith("weapon:")) {
          const id = p.kind.slice("weapon:".length);
          const parts = weaponBuilders[id](scene, mats, `view_${id}`);
          if (p.finish) FIN.applyFinish(mats, parts.finish, p.finish);
          data = parts;
        } else if (p.kind === "viewmodel") {
          const camera = new B.TransformNode("camera", scene);
          const vm = new VM.ViewModel(scene, mats, camera);
          if (p.weapon) vm.setWeapon(p.weapon);
          if (p.sight) vm.setSight(p.sight);
          // What the fit derived from the geometry — the aimed pose off the
          // worn sight's centre, the hip pose, the turntable pivot — and each
          // rig's magazine pivots, MEASURED off the magazine's bounds.
          data = {
            carriedSight: vm.carriedSight,
            reloadAction: vm.reloadAction,
            sight: vm.sight,
            adsPos: vm.adsPos,
            hipPos: vm.hipPos,
            hipRot: vm.hipRot,
            pivot: vm.pivot,
            rigs: Object.fromEntries(
              Object.entries(vm.rigs).map(([id, r]) => [id, { parts: r.parts, magDrop: r.magDrop, reload: r.reload }]),
            ),
          };
        } else if (p.kind === "player") {
          const camera = new B.TransformNode("camera", scene);
          new PL.Player(scene, mats, camera);
        } else if (p.kind === "grenade") {
          data = GR.buildGrenade(scene, mats, "grenade0");
        } else if (p.kind === "molotov") {
          data = MO.buildMolotov(scene, mats, "molotov0");
        } else if (p.kind === "rocket") {
          data = RPG.buildRocket(scene, mats, "rocket0");
        } else if (p.kind === "mine") {
          data = MINE.buildMineBody(scene, mats, "mine0");
        } else if (p.kind.startsWith("vehicle:")) {
          const type = VK.kindOf(p.kind.slice("vehicle:".length));
          const rig = type.build(scene, mats, p.team);
          if (p.wrecked) rig.paint(true);
          data = rig;
        } else if (p.kind === "soldier") {
          data = SM.buildSoldier(scene, mats, p.team);
        } else if (p.kind === "zone") {
          const w = zoneWorld(p.points);
          const zones = new CZ.CaptureZoneSystem(scene, mats);
          zones.build(p.points, w.terrain, w.obstacles, w.roads, w.rays, w.env);
          data = zones.zones.map((z) => ({ x: z.x, z: z.z, meshes: z.meshes }));
        } else throw new Error(`no model "${p.kind}"`);
        out[key] = hashScene(scene, data, plain);
      } catch (e) {
        out[key] = { error: String(e?.message ?? e) };
      }
    }
  } finally {
    Math.random = random;
    await server.close();
  }
  return out;
}

/**
 * Every carried id's model builder — `ViewModel`'s `WEAPON_BUILDERS`, which is
 * not exported, rebuilt here from the same modules under the same ids; a
 * carried id with no builder here throws rather than going unhashed.
 */
async function modelWeaponBuilders(load) {
  const named = {
    rifle: ["RifleModel", "buildRifle"],
    carbine: ["CarbineModel", "buildCarbine"],
    smg: ["SmgModel", "buildSmg"],
    dmr: ["DmrModel", "buildDmr"],
    sniper: ["SniperModel", "buildSniper"],
    lmg: ["LmgModel", "buildLmg"],
    pistol: ["PistolModel", "buildPistol"],
    rpg: ["RpgModel", "buildRpg"],
    mine: ["MineModel", "buildMine"],
  };
  const { CARRIED_IDS } = await load("/src/entities/weapons.ts");
  const out = {};
  for (const id of CARRIED_IDS) {
    if (!named[id]) throw new Error(`no weapon builder for carried id "${id}" in kit-hash.mjs`);
    const [file, fn] = named[id];
    out[id] = (await load(`/src/entities/${file}.ts`))[fn];
  }
  return out;
}

/**
 * Every model build, keyed `[kind, ...variant]`: each carried weapon bare and
 * in every finish, the viewmodel as built and with every carried weapon in
 * every sight, the player, the four projectiles, every vehicle kind for both
 * sides in its livery and wrecked, a soldier of each side, and the capture
 * zones of every map's control points.
 */
async function listModelJobs(only) {
  const jobs = new Map();
  const server = await vite();
  try {
    const { CARRIED_IDS } = await server.ssrLoadModule("/src/entities/weapons.ts");
    const { SIGHT_IDS } = await server.ssrLoadModule("/src/entities/sights.ts");
    const { FINISH_IDS } = await server.ssrLoadModule("/src/entities/finishes.ts");
    const { kindOf } = await server.ssrLoadModule("/src/entities/vehicleKinds.ts");
    const { CONFIG } = await server.ssrLoadModule("/src/config/index.ts");
    const add = (key, job) => jobs.set(JSON.stringify(key), job);
    for (const id of CARRIED_IDS) {
      const kind = `weapon:${id}`;
      add([kind, "built"], { kind });
      for (const finish of FINISH_IDS) add([kind, "finish", finish], { kind, finish });
    }
    add(["viewmodel", "built"], { kind: "viewmodel" });
    for (const weapon of CARRIED_IDS) {
      for (const sight of SIGHT_IDS) add(["viewmodel", weapon, sight], { kind: "viewmodel", weapon, sight });
    }
    add(["player", "built"], { kind: "player" });
    for (const kind of ["grenade", "molotov", "rocket", "mine"]) add([kind, "built"], { kind });
    // `VEHICLE_KINDS` is not exported; its keys are `CONFIG.vehicles`' blocks
    // that `kindOf` pairs with that same block.
    const vehicleKinds = Object.keys(CONFIG.vehicles).filter((k) => kindOf(k)?.spec === CONFIG.vehicles[k]);
    for (const v of vehicleKinds) {
      for (const team of [0, 1]) {
        for (const wrecked of [false, true]) {
          add([`vehicle:${v}`, team, wrecked ? "wrecked" : "livery"], { kind: `vehicle:${v}`, team, wrecked });
        }
      }
    }
    for (const team of [0, 1]) add(["soldier", team], { kind: "soldier", team });
    for (const m of mapDirs()) {
      const mod = await server.ssrLoadModule(`/src/world/${m}/layout.ts`);
      for (const layout of Object.values(mod)) {
        if (!layout || !Array.isArray(layout.controlPoints) || !Array.isArray(layout.placements)) continue;
        const points = layout.controlPoints.map((cp) => ({
          id: cp.id,
          name: cp.name,
          pos: { x: cp.pos.x, y: cp.pos.y, z: cp.pos.z },
          radius: cp.radius,
          poleLift: cp.poleLift,
        }));
        add(["zone", m], { kind: "zone", points });
      }
    }
  } finally {
    await server.close();
  }
  const all = [...jobs];
  if (only) {
    const kinds = new Set(all.map(([k]) => JSON.parse(k)[0]));
    for (const k of only) if (!kinds.has(k)) throw new Error(`no model "${k}" (models: ${[...kinds].join(", ")})`);
  }
  return all.filter(([k]) => !only || only.has(JSON.parse(k)[0])).sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

/** The map directories under `src/world` that hold a layout, sorted. */
function mapDirs() {
  return readdirSync(join(ROOT, "src/world"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(ROOT, "src/world", d.name, "layout.ts")))
    .map((d) => d.name)
    .sort();
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
    for (const m of mapDirs()) {
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
    const rungs = new Set(Object.values(CONFIG.graphics.foliage.tiers).map((t) => t.detail));
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
    const out = process.env.KIT_HASH_MODELS ? await hashModelJobs(jobs) : await hashJobs(jobs);
    process.send(out, () => process.exit(0));
  });
} else {
  const feet = args.includes("--feet");
  if (feet) process.env.KIT_HASH_FEET = "1";
  const models = args.includes("--models");
  if (models) process.env.KIT_HASH_MODELS = "1";
  if (models && feet) throw new Error("--feet measures the kit, and --models is not the kit");
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

  const list = models ? await listModelJobs(only) : await listJobs(only);
  const chunks = [];
  const chunk = models ? MODEL_CHUNK : CHUNK;
  for (let i = 0; i < list.length; i += chunk) chunks.push(list.slice(i, i + chunk));
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
    const report = (label, ks) => {
      const per = {};
      for (const k of ks) per[kindOf(k)] = (per[kindOf(k)] ?? 0) + 1;
      const kinds = Object.entries(per)
        .map(([k, n]) => `${k} ${n}`)
        .join(", ");
      console.log(`  ${label.padEnd(18)} ${ks.length}${ks.length ? `  (${kinds})` : ""}`);
    };
    console.log(`against ${againstFile}:`);
    if (models) {
      // A build whose set of node records matches but whose scene order does
      // not is reported apart: the same meshes, created in another order.
      const changed = both.filter((k) => differs(k, "set") || differs(k, "error"));
      const reordered = both.filter((k) => !changed.includes(k) && differs(k, "draw"));
      const same = both.filter((k) => !changed.includes(k) && !reordered.includes(k));
      report("identical", same);
      report("scene order differs", reordered);
      report("content changed", changed);
      report("builds added", added);
      report("builds gone", gone);
      for (const k of reordered.slice(0, 10)) console.log(`    order  ${k}`);
      for (const k of changed.slice(0, 20)) console.log(`    change ${k}`);
      const strictOrder = args.includes("--strict-order");
      if (changed.length + added.length + gone.length || (strictOrder && reordered.length)) process.exit(1);
      console.log(reordered.length ? "  same content (scene order differs)" : "  identical");
      process.exit(0);
    }
    const drawn = both.filter((k) => differs(k, "draw") || differs(k, "error"));
    const boxed = both.filter((k) => differs(k, "colliders") || differs(k, "error"));
    report("drawing changed", drawn);
    report("colliders changed", boxed);
    report("builds added", added);
    report("builds gone", gone);
    if (drawn.length + boxed.length + added.length + gone.length) process.exit(1);
    console.log("  identical");
  }
}
