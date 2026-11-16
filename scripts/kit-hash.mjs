/**
 * Fingerprints what the kit's builders BUILD — `npm run kit:hash` — and, with
 * `--models`, every other model in the game.
 *
 * Owns: nothing but a report and, when asked, one JSON file. Every placement
 * of every builder in every map's layout is built, and its PARTS
 * (`world/parts.ts`) hashed twice: the DRAWING (every part's record — below —
 * then the structure's lights, sounds and panes) and the COLLIDERS (the
 * `BoxSpec` list, in the order it was emitted). Each kind is also built once
 * bare — default params, no `BuildCtx` — as a preview would build it.
 *
 * **It runs with NO BABYLON** (`BABYLON_EXIT.md` X6.1a): no `NullEngine`, no
 * `Scene`, no `StandardMaterial`, no `Mesh`, `TransformNode` or
 * `BoundingInfo` is made, and the package is not loaded by this script — nor,
 * since X6.1h, by any game module it loads, and since X6.1i it is not in the
 * tree. A builder takes no scene (X6.1d): its pictures are
 * cached under the material factory it is handed (`world/textures.ts`), here
 * the stub factory, and a material is a plain named object (`StubMaterial`).
 *
 * **What a record IS — what the drawing is, not the Babylon mesh it used to
 * become** (X6.1a restated it; a fingerprint taken before X6.1a is of the
 * other format and compares with nothing here, and so is one taken before
 * X6.1a's review, which recorded the Euler angles beside a quaternion). A
 * part's record is its name, its material's name, its metadata, its transform
 * as far as it decides the part's matrix (position, scaling, and the
 * quaternion where the part carries one, else its Euler angles —
 * `worldMatrixOf`'s choice, so a dead Euler write under a quaternion is no
 * change; X6.1a's review), and then every attribute it carries (`positions`, `normals`, `uvs`, `uvs2`,
 * `colors`) and its indices, each WHOLE, with its array's TYPE (a `number[]`
 * holds doubles and a `Float32Array` does not) and its numbers as exact
 * doubles. A structure's record adds whether the part is `freeform`; its
 * lights, sounds and panes and its colliders are its plain data. **A value is
 * spelled by KIND and value, whichever library made it** — a vector, a
 * quaternion, a colour or a matrix as `[class, ...numbers]`, read off its
 * fields, so a Babylon `Vector3` and a `src/math` one of the same numbers are
 * the same spelling and moving a builder onto `src/math/` (X6.1e) cannot
 * change a fingerprint by spelling alone; a number JSON cannot spell
 * (`Infinity`, `NaN`, `-0`) is spelled as a string; a material is
 * `material:<name>`, a picture `Picture:<label>`.
 *
 * **What the old record took from Babylon's defaults, field by field**: the
 * mesh's quaternion zeroing its Euler angles, the attributes cut to the
 * vertex count and hashed as float32, and (in `--models`) the mesh's class,
 * picking, collisions, rendering group, always-active flag, side orientation,
 * visibility, alpha index, layer mask, infinite distance, billboard mode,
 * pivot, sub-meshes and each vertex buffer's stride, offset, type and
 * normalised flag — every one a constant of the stand-in or a default
 * Babylon supplied, and DROPPED; the bounding box Babylon computed, RESTATED
 * off ours (`world/worldGeometry.ts`' `boundsOf`, which `bounds-check.mjs`
 * holds to Babylon's bit for bit); and the stand-in `camera` node and the
 * glasses' and the card's stand-in materials, dropped for what the segment
 * itself says (its `role`, and a glass's look, `ViewSegment.glass`).
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
 * DRAWING is the prop as `MapBuilder` hands it to the merge (`flattenParts`)
 * — the root and every child, in that order, each child's parent composed
 * into its own transform and the link cut (`flattenParts`), each a part's
 * record (its metadata in it, because `noInk`/`noGlow`/`noShadowCaster` are
 * part of the merge key) — and the
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
 * what is built on `src/geometry/`, and proves a change to it moved
 * nothing:
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
 * - the `PlayerView` (`player`): its flash petals and casing pool, over a
 *   `ViewModel` of its own, as the `Player` it is handed to leaves it.
 *   `Player` itself draws nothing;
 * - the four pooled bodies that fly or lie (`grenade`, `molotov`, `rocket`
 *   with its flame, `mine`, the laid one), each the KIT our renderer draws
 *   (`entities/pieces.ts`): the builder's parts (`grenadeParts`,
 *   `molotovPieceParts`, `rocketParts`, `minePieceParts`) in the order the
 *   builder made them, each with the part it hangs from and the switches the
 *   pool leaves on it (shown or hidden, the root on or off), and the
 *   builder's data spelled as the pool holds it (`{ mesh, pip }`,
 *   `{ mesh, wick }`, `{ mesh, flame }`, `{ mesh, lamp }`). The `player`'s
 *   casing pool the same: each case's part (`casingParts`), hidden, after the
 *   tree;
 * - every vehicle kind (`vehicle:<kind>`: the `CONFIG.vehicles` blocks
 *   `kindOf` pairs with a spec, each built by `vehicleModels.modelOf`), for
 *   both sides, in its livery and wrecked: its rig and its kit, as data;
 * - a soldier of each side (`soldier`), as `Bot` and `NetSoldier` build one;
 * - `CaptureZoneSystem`'s rings, poles and flags (`zone`), over every map's
 *   control points at their own positions and radii. They stand on
 *   `zoneWorld`, a striped stand-in that gives every ring open ground, made
 *   ground, a wall and a road to cross, and puts some poles under a roof. It
 *   is not the map. What is hashed is what `ZoneDraw` is handed — each
 *   surface's name, recipe, switch, stated box, geometry and indices — and the
 *   sphere `ZoneDraw.addSurface` works out of it (the real method, on an
 *   object holding only what it writes), **held to `boundsOf`'s** (ours, of
 *   the stated box or of the positions), any difference in any bit a throw.
 *   **So this hash cannot fail on the rest of `ZoneDraw`**: the rebasing, the
 *   upload and the rewrite are outside it, and the bank's byte comparison
 *   holds them (`plans/webgpu-ref/exact.mjs`, `docs/rendering.md`).
 *
 * **The viewmodel's three kinds are its JOINT TREE** (`ViewTree`,
 * `entities/viewTree.ts`): each SURFACE the tree hangs (a `ViewSegment`, of
 * every role) is a part's record with the joint it hangs from, its own
 * switch, its `isVisible`, its role and a glass's look, and its local
 * bounds, in the order the tree hung them; each other joint is a joint's
 * record (name, parent, own switch, channels — the quaternion OR the Euler
 * angles, whichever decides the joint — and pivot), in the
 * order the joints were made. A joint in the builder's data, or as a parent,
 * is named for what it stands for (`camera:<name>` the root — the tree's
 * camera a plain stand-in, `segment:<name>` a surface's joint,
 * `joint:<name>` any other); a segment in the data is `segment:<name>`, a
 * part `part:<name>`.
 *
 * Each build is fresh, with the viewer on side 0, and `Math.random` seeded
 * (none of these builders calls it today).
 *
 * Each build gives two hashes. `draw` takes the records in the order they
 * were made; `set` sorts them first. `--against` puts every build in one of
 * three buckets: "identical", "creation order differs" (the same records,
 * made in another order) and "content changed". It fails on content, and on
 * order only under `--strict-order`: whether creation order reaches a pixel
 * is the reference bank's question, not this one's. `--kinds` takes model
 * kinds (`weapon:rifle`, `viewmodel`, `vehicle:tank`, `zone`). `--feet` does
 * not apply.
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
 * The builds run in WORKER processes, a few hundred each, so a run over the
 * whole kit never holds the whole kit's arrays at once (it was the only way
 * to give back what a NullEngine's disposed scenes kept, before X6.1a, and
 * it bounds the heap still).
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

/** A number array's exact doubles, whatever array it arrived in. */
const f64 = (a) => Buffer.from(Float64Array.from(a).buffer);

/** A number JSON cannot spell (`Infinity`, `NaN`, `-0`), as a string; any other as itself. */
const num = (v) => (Number.isFinite(v) && !Object.is(v, -0) ? v : String(Object.is(v, -0) ? "-0" : v));

/** The fields each math kind is spelled by — Babylon's and `src/math`'s alike (the header). */
const MATH_FIELDS = {
  Vector2: ["x", "y"],
  Vector3: ["x", "y", "z"],
  Vector4: ["x", "y", "z", "w"],
  Quaternion: ["x", "y", "z", "w"],
  Color3: ["r", "g", "b"],
  Color4: ["r", "g", "b", "a"],
};

/**
 * A vector, quaternion, colour or matrix spelled `[class, ...numbers]`, read
 * off its fields — whichever library made it — or null for anything else. By
 * class NAME and shape, never by `instanceof`: the game's modules are loaded
 * through Vite, and their classes are not this script's.
 */
function mathValue(v) {
  const name = v?.constructor?.name;
  if (name === "Matrix" && v.m && v.m.length === 16) return ["Matrix", ...Array.from(v.m)];
  const fields = MATH_FIELDS[name];
  if (fields && fields.every((k) => typeof v[k] === "number")) return [name, ...fields.map((k) => v[k])];
  return null;
}

/** The material stand-in: a name, and nothing else (the header). */
class StubMaterial {
  constructor(name) {
    this.name = name;
  }
}

/** A `Picture` (`render/TextureMaker.ts`), by shape. */
const isPicture = (v) => v.canvas && typeof v.label === "string" && v.sampling;

/**
 * The plain-data replacer every record is spelled through (the header): a
 * material, a picture or a segment NAMED (a graph of its own, or a
 * drawing hashed as a record of its own), and a part NAMED where it is one of
 * `recorded` (a record of its own) and walked anywhere else; a joint of `tree`
 * named for what it stands for; a math value spelled by kind and value; a
 * typed array as its type and its numbers; a `Map` or `Set` as its entries;
 * the stub factory as `mats`; and a number JSON cannot spell as a string.
 */
function plainOf(mats = null, tree = null, recorded = null) {
  return function (_k, v) {
    if (mats !== null && v === mats) return "mats";
    if (typeof v === "number") return num(v);
    if (!v || typeof v !== "object") return v;
    if (v instanceof StubMaterial) return `material:${v.name}`;
    if (isPicture(v)) return `Picture:${v.label}`;
    if (isSegment(v)) return `segment:${v.name}`;
    if (recorded?.has(v)) return `part:${v.name}`;
    if (tree && isJoint(v)) return labelOf(tree, v);
    const math = mathValue(v);
    if (math) return math;
    if (ArrayBuffer.isView(v)) return [v.constructor.name, ...Array.from(v)];
    if (v instanceof Map) return ["Map", ...v];
    if (v instanceof Set) return ["Set", ...v];
    return v;
  };
}

/** A viewmodel `ViewSegment` (`viewTree.ts`), by class name (`mathValue`'s reason). */
const isSegment = (v) => v?.constructor?.name === "ViewSegment";
/** A `rigJoints.ts` joint, by shape. */
const isJoint = (v) => v.constructor?.name === "Joint" && "world" in v && "scaling" in v;

/**
 * A part's transform as far as it decides the part's matrix (the header):
 * its position, its rotation — the QUATERNION where it carries one, else its
 * Euler angles, which is the choice `worldMatrixOf` (`world/parts.ts`) makes,
 * so Euler angles written under a quaternion are dead and not recorded — and
 * its scaling. Which of the two it is is spelled, so a part that gains or
 * loses a quaternion is a change.
 */
function transformOf(p) {
  const q = p.rotationQuaternion;
  return [
    [p.position.x, p.position.y, p.position.z],
    q ? ["quaternion", q.x, q.y, q.z, q.w] : ["euler", p.rotation.x, p.rotation.y, p.rotation.z],
    [p.scaling.x, p.scaling.y, p.scaling.z],
  ];
}

/** Each attribute a geometry may carry, in the order a record takes them. */
const ATTRIBUTES = ["positions", "normals", "uvs", "uvs2", "colors"];

/**
 * A geometry's every attribute and its indices, WHOLE: each its name, its
 * array's type and length, then its numbers as exact doubles (the header).
 */
function geometryRecord(g, indices = g.indices) {
  const out = [];
  for (const k of ATTRIBUTES) {
    const a = g[k] ?? null;
    out.push(Buffer.from(JSON.stringify([k, a ? a.constructor.name : null, a ? a.length : 0])));
    if (a) out.push(f64(a));
  }
  out.push(Buffer.from(JSON.stringify(["indices", indices ? indices.constructor.name : null, indices ? indices.length : 0])));
  if (indices) out.push(f64(indices));
  return out;
}

/**
 * One part's whole record (the header): `head` — what the caller's kind of
 * build can see of it beyond its own fields — then its name, its material's
 * name, its metadata and its transform, spelled through `plain`, then its
 * geometry. A part that still has a parent is refused: what is handed on is
 * flattened first, as the merge and the models' kits are handed it.
 */
function partRecord(p, plain, head = []) {
  if (p.parent) throw new Error(`partRecord: "${p.name}" still has a parent — flattenParts first`);
  const fields = [...head, p.name, p.material ? `material:${p.material.name}` : null, p.metadata ?? null, transformOf(p)];
  return Buffer.concat([Buffer.from(JSON.stringify(fields, plain)), ...geometryRecord(p.geometry)]);
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
function planOf(Vector3, worldMatrixOf, Matrix, parts) {
  const all = [Infinity, -Infinity, Infinity, -Infinity];
  const low = [Infinity, -Infinity, Infinity, -Infinity];
  const grow = (b, x, z) => {
    if (x < b[0]) b[0] = x;
    if (x > b[1]) b[1] = x;
    if (z < b[2]) b[2] = z;
    if (z > b[3]) b[3] = z;
  };
  const v = new Vector3();
  for (const p of parts) {
    const pos = p.geometry.positions;
    // The part's float32 world matrix — `computeWorldMatrix(true)`'s numbers,
    // by `worldMatrixOf` — and `src/math`'s transform of a point by it
    // (`math-check.mjs` holds it to Babylon's).
    const wm = worldMatrixOf(p, new Matrix());
    for (let i = 0; i < pos.length; i += 3) {
      Vector3.TransformCoordinatesFromFloatsToRef(pos[i], pos[i + 1], pos[i + 2], wm, v);
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
 * The material factory every build is handed: a material is a `StubMaterial`
 * named for the factory call that asked for it — the method and its
 * arguments spelled through `plainOf` — so a builder that paints a part
 * another colour changes the drawing's hash. One material per name a build,
 * as the factory caches one (`cache`, cleared per build).
 */
function stubMats(cache) {
  const plain = plainOf();
  return new Proxy(
    {},
    {
      get: (_t, prop) => (...a) => {
        const key = `${String(prop)}(${JSON.stringify(a, plain)})`;
        if (!cache.has(key)) cache.set(key, new StubMaterial(key));
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
    const { BUILDERS } = await server.ssrLoadModule("/src/world/BuildingKit.ts");
    const { SCATTER_BUILDERS, PROP_BODIES } = await server.ssrLoadModule("/src/world/MapBuilder.ts");
    const { SHARED_DRAWS } = await server.ssrLoadModule("/src/world/props/sharedDraws.ts");
    const { flattenParts, worldMatrixOf } = await server.ssrLoadModule("/src/world/parts.ts");
    const { Matrix, Vector3 } = await server.ssrLoadModule("/src/math/index.ts");
    const cache = new Map();
    const mats = stubMats(cache);
    const plain = plainOf(mats);
    const terrain = { flat: false, surfaceAt: swell, heightAt: swell };
    for (const [key, p] of jobs) {
      // A fresh factory a build (its materials cleared). The pictures are
      // keyed on the factory OBJECT (`world/textures.ts`, X6.1d), so a worker
      // paints each once where a fresh stand-in scene a build painted it per
      // build; a picture is spelled by its label (`plainOf`), so a hash cannot
      // tell.
      cache.clear();
      try {
        if (p.scatter) {
          out[key] = hashScatter(SCATTER_BUILDERS[p.kind], PROP_BODIES[p.kind], flattenParts, mats, plain, p);
          // The replay `MapBuilder` spends a placement's shared draws with
          // (`props/sharedDraws.ts`) must take exactly what the builder took.
          const replayed = counted(mulberry32(p.seed));
          SHARED_DRAWS[p.kind](replayed);
          const built = out[key].draws;
          if (replayed.draws !== built) out[key].replay = `builder ${built}, replay ${replayed.draws}`;
          continue;
        }
        const floor = p.bare ? 0 : swell(p.x, p.z);
        const ctx = p.bare
          ? undefined
          : { terrain, x: p.x, z: p.z, y: floor + (p.y ?? 0), floor, rotY: p.rotY ?? 0 };
        // What the merge is handed: the structure's parts, then its panes'.
        const s = p.bare ? BUILDERS[p.kind](mats) : BUILDERS[p.kind](mats, p.params ?? {}, ctx);
        const draw = createHash("sha256");
        for (const part of [...s.meshes, ...s.paneMeshes]) {
          draw.update(partRecord(part, plain, ["part", s.freeform.has(part)]));
        }
        draw.update(JSON.stringify([s.lights, s.sounds, s.panes], plain));
        const colliders = createHash("sha256").update(JSON.stringify(s.colliders, plain));
        out[key] = { draw: draw.digest("hex").slice(0, 16), colliders: colliders.digest("hex").slice(0, 16) };
        if (process.env.KIT_HASH_FEET) {
          Object.assign(out[key], planOf(Vector3, worldMatrixOf, Matrix, [...s.meshes, ...s.paneMeshes]));
        }
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
function hashScatter(build, body, flattenParts, mats, plain, p) {
  const rng = counted(mulberry32(p.seed));
  const root = build(mats, rng, mulberry32(p.seed ^ 0x2545f491), p.foliage);
  const draw = createHash("sha256");
  // What `MapBuilder` hands the merge: the root, then every child with its
  // parent's transform composed into its own and the link cut
  // (`flattenParts`). Hashed AFTER that rather than before, so the
  // fingerprint is of what the merge reads and not of how a builder chose to
  // say it — a child parented to a trunk and one placed where the trunk would
  // have put it are the same drawing.
  for (const part of flattenParts(root)) draw.update(partRecord(part, plain, ["part"]));
  const colliders = createHash("sha256").update(JSON.stringify([body, rng.draws], plain));
  return { draw: draw.digest("hex").slice(0, 16), colliders: colliders.digest("hex").slice(0, 16), draws: rng.draws };
}

/*
 * ---------------------------------------------------------------------------
 * `--models`: everything drawn that is not the world kit. See the header.
 * ---------------------------------------------------------------------------
 */

/**
 * What a joint of a viewmodel `ViewTree` stands for (the header): the
 * camera's stand-in at its root, the surface a surface's joint hangs, or a
 * joint of its own.
 */
function labelOf(tree, j) {
  if (j === tree.root) return `camera:${tree.camera.name}`;
  const segment = tree.meshFor(j);
  return segment ? `segment:${segment.name}` : `joint:${j.name}`;
}

/**
 * A joint's record (the header): its name, parent, own switch, channels and
 * pivot — its rotation the quaternion where it carries one, else its Euler
 * angles, as `transformOf` and for the same reason (`rigJoints.ts`' compose
 * reads the quaternion OVER the Euler angles while one is set).
 */
function jointRecord(tree, j, plain) {
  const head = [
    "joint",
    j.name,
    j.parent ? labelOf(tree, j.parent) : null,
    j.enabled,
    [j.position.x, j.position.y, j.position.z],
    j.quaternion
      ? ["quaternion", j.quaternion.x, j.quaternion.y, j.quaternion.z, j.quaternion.w]
      : ["euler", j.rotation.x, j.rotation.y, j.rotation.z],
    [j.scaling.x, j.scaling.y, j.scaling.z],
    j.pivot ? Array.from(j.pivot.m) : null,
  ];
  return Buffer.from(JSON.stringify(head, plain));
}

/**
 * The two hashes of one model build: `draw`, every surface and then every
 * joint in the order they were made, followed by the builder's plain data,
 * and `set`, the same records hashed one by one and sorted first — so a
 * build whose records are all the same but were made in another order
 * matches on `set` and differs on `draw`. That is the difference `--against`
 * reports as "creation order differs", apart from "content changed".
 */
function hashModel(surfaces, joints, data, plain) {
  const draw = createHash("sha256");
  const each = [];
  for (const [label, tag, list] of [
    ["surfaces", "s", surfaces],
    ["joints", "j", joints],
  ]) {
    draw.update(`|${label}|${list.length}|`);
    for (const rec of list) {
      const digest = createHash("sha256").update(rec).digest();
      draw.update(digest);
      each.push(tag + digest.toString("hex"));
    }
  }
  const tail = JSON.stringify(data ?? null, plain);
  draw.update(tail);
  each.sort();
  const set = createHash("sha256").update(each.join(",")).update(tail);
  return { draw: draw.digest("hex").slice(0, 16), set: set.digest("hex").slice(0, 16) };
}

/**
 * `ZoneDraw` with no renderer: what a round hands it, each surface recorded
 * at `finish` (the header). A recipe IS the stub's material here (the job's
 * `celRecipe`).
 *
 * **It holds `ZoneDraw`'s sphere to `boundsOf`'s** (ours, which
 * `bounds-check.mjs` holds to Babylon's `BoundingInfo`): the size gate, the
 * frustum, the sort and the zones' split all read that sphere, so the real
 * `addSurface` runs on an object holding only what it writes (no device is
 * needed to work out a sphere), and any difference from `boundsOf` over the
 * surface's stated box — or, where it states none, its positions — throws.
 * Nothing else of `ZoneDraw`'s is reached from here.
 */
function zoneDrawStandIn(ZD, boundsOf, identity, surfaces) {
  const ranges = [];
  return {
    addVertices(geometry) {
      ranges.push(geometry);
      return ranges.length - 1;
    },
    addSurface(name, first, indices, recipe, box, geometry = null) {
      const sphere = ZD.ZoneDraw.prototype.addSurface.call(
        { indexList: [], surfaces: [], materialOf: () => null },
        name,
        0,
        [],
        recipe,
        box,
        geometry,
      );
      const surface = { name, first, indices, recipe, box, on: true, sphere };
      surfaces.push(surface);
      return surface;
    },
    addStatic(name, geometry, indices, recipe) {
      return this.addSurface(name, this.addVertices(geometry), indices, recipe, null, geometry);
    },
    wear(surface, recipe) {
      surface.recipe = recipe;
    },
    rewrite() {},
    clear() {},
    finish() {
      for (const s of surfaces) {
        s.geometry = ranges[s.first];
        const b = s.box;
        const held = boundsOf(b ? [b[0], b[1], b[2], b[3], b[4], b[5]] : s.geometry.positions, identity);
        const z = s.sphere;
        if (z.x !== held.centerX || z.y !== held.centerY || z.z !== held.centerZ || z.radius !== held.radius) {
          throw new Error(
            `ZoneDraw's sphere for ${s.name} is (${z.x}, ${z.y}, ${z.z}) r ${z.radius}; boundsOf's is (${held.centerX}, ${held.centerY}, ${held.centerZ}) r ${held.radius}`,
          );
        }
      }
    },
  };
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
 * is fresh, with the viewer on side 0 and `Math.random` seeded, so a builder
 * that reached for it would still hash the same twice running (none does
 * today).
 */
async function hashModelJobs(jobs) {
  stubCanvas();
  const server = await vite();
  const out = {};
  const random = Math.random;
  try {
    const load = (p) => server.ssrLoadModule(p);
    const [VM, PL, PV, GR, MO, RPG, MINE, VK, SM, CZ, FIN, TV, VT, CFG, ZD, RID, WG, M] = await Promise.all(
      [
        "/src/entities/ViewModel.ts",
        "/src/entities/Player.ts",
        "/src/entities/PlayerView.ts",
        "/src/entities/GrenadeModel.ts",
        "/src/entities/MolotovModel.ts",
        "/src/entities/RpgModel.ts",
        "/src/entities/MineModel.ts",
        "/src/entities/vehicleModels.ts",
        "/src/entities/SoldierModel.ts",
        "/src/systems/CaptureZoneSystem.ts",
        "/src/entities/finishes.ts",
        "/src/core/teamView.ts",
        "/src/entities/viewTree.ts",
        "/src/config/index.ts",
        "/src/render/ZoneDraw.ts",
        "/src/core/renderId.ts",
        "/src/world/worldGeometry.ts",
        "/src/math/index.ts",
      ].map(load),
    );
    const identity = M.Matrix.Identity();
    // A surface's local bounds, ours (the header): `boundsOf` at identity.
    const boundsHead = (part) => {
      const b = WG.boundsOf(part.geometry.positions, identity);
      return [
        [b.minX, b.minY, b.minZ],
        [b.maxX, b.maxY, b.maxZ],
      ];
    };
    const weaponBuilders = await modelWeaponBuilders(load);
    const cache = new Map();
    const mats = stubMats(cache);
    // The camera a tree hangs from: a name and an identity world, all a
    // `ViewCamera` is (`viewTree.ts`); `TransformNode:camera` before X6.1a.
    const cameraStandIn = () => ({ name: "camera", getWorldMatrix: () => identity });
    for (const [key, p] of jobs) {
      cache.clear();
      TV.setViewerTeam(0);
      Math.random = mulberry32(0x6d0de15);
      // Every surface's record, in the order it was made; then every joint's.
      const surfaces = [];
      const joints = [];
      // A pool's piece parts (the header): each part in the builder's order,
      // the part it hangs from, its switch (the root's off where the pool
      // leaves it off) and whether it is shown. Returns the parts, in order.
      const recorded = new Set();
      const pieces = (list, plain, { hidden, rootOff = false, shown = [] }) => {
        const parts = list.map((pp) => pp.part);
        for (const part of parts) recorded.add(part);
        list.forEach((pp, i) => {
          const head = [
            "piece",
            pp.parent >= 0 ? `part:${parts[pp.parent].name}` : null,
            !(rootOff && i === 0),
            !(hidden && !shown.includes(i)),
            ...boundsHead(pp.part),
          ];
          surfaces.push(partRecord(pp.part, plain, head));
        });
        return parts;
      };
      try {
        let data = null;
        // The viewmodel's tree, for the three kinds built on one (X4.3b).
        let tree = null;
        // The pieces of the kinds that are not a tree, recorded as they are made.
        let late = [];
        if (p.kind.startsWith("weapon:")) {
          const id = p.kind.slice("weapon:".length);
          // Built alone: a tree with no camera, the weapon's root at its top
          // level, keyed on a render id of its own at 0 (`core/renderId.ts`).
          tree = new VT.ViewTree(new RID.RenderId(), null);
          const parts = weaponBuilders[id](mats, `view_${id}`, tree, null);
          if (p.finish) FIN.applyFinish(mats, parts.finish, p.finish);
          data = parts;
        } else if (p.kind === "viewmodel") {
          const vm = new VM.ViewModel(mats, cameraStandIn(), new RID.RenderId());
          tree = vm.tree;
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
          // As `Game` builds the pair: the picture, then the player that
          // puts it away (`applyVisibility`) — which is part of the record.
          const view = new PV.PlayerView(mats, cameraStandIn(), new RID.RenderId());
          new PL.Player(view);
          tree = view.model.tree;
          // The casing pool (X4.4b): one a case, after the tree's surfaces, hidden.
          late = Array.from({ length: CFG.CONFIG.gunfeel.casingPool }, (_, i) => PV.casingParts(mats, `player_casing${i}`));
        } else if (p.kind === "grenade") {
          // The body and the pip, both hidden.
          const [mesh, pip] = pieces(GR.grenadeParts(mats, "grenade0"), plainOf(mats, null, recorded), { hidden: true });
          data = { mesh, pip };
        } else if (p.kind === "molotov") {
          // The body, the neck, the cloth and the wick, all hidden.
          const m = pieces(MO.molotovPieceParts(mats, "molotov0"), plainOf(mats, null, recorded), { hidden: true });
          data = { mesh: m[0], wick: m[3] };
        } else if (p.kind === "rocket") {
          // The head, the tail and the flame, shown, the head switched off.
          const m = pieces(RPG.rocketParts(mats, "rocket0"), plainOf(mats, null, recorded), { hidden: false, rootOff: true });
          data = { mesh: m[0], flame: m[2] };
        } else if (p.kind === "mine") {
          // The plate and the pressure plate shown, the lamp hidden, the plate
          // switched off.
          const m = pieces(MINE.minePieceParts(mats, "mine0"), plainOf(mats, null, recorded), { hidden: true, rootOff: true, shown: [0, 1] });
          data = { mesh: m[0], lamp: m[2] };
        } else if (p.kind.startsWith("vehicle:")) {
          // The client's table (`vehicleModels.ts`), keyed by the same kind
          // `vehicleKinds.ts` pairs with its spec: the rig, joints and
          // segments, and its kind's kit in its side's colours (`rig.kit`,
          // hashed with the rig), which our renderer draws every hull of that
          // pair as instances of; the wreck is a flag on it.
          const rig = VK.modelOf(p.kind.slice("vehicle:".length))(p.team);
          if (p.wrecked) rig.paint(true);
          data = rig;
        } else if (p.kind === "soldier") {
          // The rig, joints and segments, and its side's kit, which our
          // renderer draws every body of that side as instances of.
          const rig = SM.buildSoldier(p.team);
          data = { rig, drawing: SM.soldierKits()[rig.kit] };
        } else if (p.kind === "zone") {
          const w = zoneWorld(p.points);
          const zoneMats = new Proxy(mats, { get: (t, prop) => (prop === "celRecipe" ? (m) => m : t[prop]) });
          const held = [];
          const zones = new CZ.CaptureZoneSystem(zoneMats, zoneDrawStandIn(ZD, WG.boundsOf, identity, held), () => true);
          zones.build(p.points, w.terrain, w.obstacles, w.roads, w.rays, w.env);
          const plain = plainOf(mats, null, recorded);
          for (const s of held) {
            const head = ["zone", s.name, s.recipe, s.on, s.box, [s.sphere.x, s.sphere.y, s.sphere.z, s.sphere.radius]];
            surfaces.push(Buffer.concat([Buffer.from(JSON.stringify(head, plain)), ...geometryRecord(s.geometry, s.indices)]));
          }
          data = zones.zones.map((z) => ({ x: z.x, z: z.z, ring: z.ring.map((s) => s.name) }));
        } else throw new Error(`no model "${p.kind}"`);
        const plain = plainOf(mats, tree, recorded);
        if (tree) {
          // A tree's surfaces in the order they were hung, each with the joint
          // it hangs from (the header); then every other joint, in the order
          // the joints were made.
          for (const v of tree.meshes) {
            const seg = v.segment;
            const head = [
              "segment",
              v.joint.parent ? labelOf(tree, v.joint.parent) : null,
              seg.enabled,
              seg.isVisible,
              seg.role,
              seg.glass ?? null,
              ...boundsHead(seg),
            ];
            surfaces.push(partRecord(seg, plain, head));
          }
          for (const j of tree.jointList) if (j !== tree.root && !tree.meshFor(j)) joints.push(jointRecord(tree, j, plain));
        }
        for (const list of late) pieces(list, plain, { hidden: true });
        out[key] = hashModel(surfaces, joints, data, plain);
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
  // A scatter kind's replay that takes a different count from its builder
  // would move every prop after it on a map: never a difference to weigh.
  const replays = keys.filter((k) => result[k].replay);
  for (const k of replays.slice(0, 10)) console.log(`  REPLAY ${k}: ${result[k].replay}`);
  if (replays.length) {
    console.log(`${replays.length} scatter builds take a different count from their replay (props/sharedDraws.ts)`);
    process.exit(1);
  }
  if (feet) await reportFeet(result, notBuilt);
  if (outFile) {
    const hashOnly = ({ plan: _p, ground: _g, draws: _d, replay: _r, ...r }) => r;
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
      // A build whose set of records matches but whose creation order does
      // not is reported apart: the same surfaces and joints, made in another order.
      const changed = both.filter((k) => differs(k, "set") || differs(k, "error"));
      const reordered = both.filter((k) => !changed.includes(k) && differs(k, "draw"));
      const same = both.filter((k) => !changed.includes(k) && !reordered.includes(k));
      report("identical", same);
      report("creation order differs", reordered);
      report("content changed", changed);
      report("builds added", added);
      report("builds gone", gone);
      for (const k of reordered.slice(0, 10)) console.log(`    order  ${k}`);
      for (const k of changed.slice(0, 20)) console.log(`    change ${k}`);
      const strictOrder = args.includes("--strict-order");
      if (changed.length + added.length + gone.length || (strictOrder && reordered.length)) process.exit(1);
      console.log(reordered.length ? "  same content (creation order differs)" : "  identical");
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
