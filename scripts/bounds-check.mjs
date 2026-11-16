/**
 * bounds-check.mjs — proves `boundsOf`'s TRANSFORMED path gives Babylon's
 * `BoundingInfo` BIT FOR BIT, over every kind the world is built from.
 *
 *   node scripts/bounds-check.mjs [--perturb]
 *
 * `world/worldGeometry.ts`' `boundsOf` is what `WorldCulling` grows its cells
 * from and size-gates a candidate by, in place of a mesh's bounding info, and
 * its claim is that it is the same numbers: `extractMinAndMax`, then
 * `BoundingBox`'s and `BoundingSphere`'s `reConstruct` and `_update`, step for
 * step. Under an identity matrix it copies the local box; under any other it
 * transforms the eight corners in Babylon's order. A round's visuals are all at
 * identity, and after `BABYLON_EXIT.md` X5.3e no mesh is made of a collider,
 * so nothing a round builds puts the transformed arm under a check — what
 * `merge:hash --editor` alone did until the editor was retired (row "X5.3,
 * `merge:hash --editor`", the owner's of 2026-11-08). This is its replacement.
 *
 * How: every kit builder (`BUILDERS`, built bare at its default params) and
 * every scatter kind (`SCATTER_BUILDERS`, at one seed and every foliage rung)
 * is built, and each of its parts' positions is taken as the Float32Array a
 * mesh held. Each part is placed under `--transforms` seeded OFF-IDENTITY
 * world matrices, drawn from a stream of the KIND's own (so a kind reworked
 * moves no other kind's draws) — its own (`worldMatrixOf`) times a
 * placement (a turn about Y and a translation, as `MapBuilder` places a
 * structure), and seeded `Compose`s of a scale (negative and zero axes among
 * them), a rotation and a translation — and its bounds are taken by
 * `boundsOf` over `src/math`'s matrix and held to a Babylon `Mesh` holding
 * the same positions with the same sixteen floats frozen as its world matrix
 * (`freezeWorldMatrix`, then `refreshBoundingInfo`: the mesh path itself,
 * `extractMinAndMax` and `BoundingInfo.update`). The box (`minimumWorld`,
 * `maximumWorld`) and the sphere (`centerWorld`, `radiusWorld`) are compared
 * by their bits, so a -0 against a +0 fails.
 *
 * The matrix is built ONCE, on our side, and copied to Babylon's float for
 * float, so the bounds half proves what `boundsOf` does with a matrix it is
 * handed. Both sides read the same positions array. **And a SEEDED section
 * built from nothing in the game** (`--synthetic` parts, X6.1i): float32
 * positions with zeros of both signs and the odd exact value among them, each
 * under a seeded chain one to three nodes deep and the same transforms — both
 * halves again, on inputs no rework can move.
 *
 * **And the MATRIX half: `worldMatrixOf` against Babylon's
 * `TransformNode.computeWorldMatrix`**, which `merge:hash --editor` checked by
 * implication and `math-check.mjs` does not (it proves `Compose` and the
 * products, not a part's walk: the Euler angles turned into a quaternion, a
 * quaternion preferred when a node has one, the parent chain multiplied in).
 * Every part above has its own matrix compared with a Babylon `TransformNode`
 * chain mirroring its node chain field for field, and so do `--chains` seeded
 * synthetic chains one to four nodes deep (Euler and quaternion turns, the same
 * scales, zero and negative axes among them), each node of a chain compared,
 * all sixteen floats by `Object.is`.
 *
 * **Babylon's answers are a RECORDED TABLE** (`scripts/tables/bounds-check.json`,
 * `scripts/lib/babylonTable.mjs`; `BABYLON_EXIT.md` row "X6.1, the copy
 * checks"), captured by `--record` while the package was installed (X6.1i's
 * first commit, which compared every answer live as well; the arm went with
 * the package in the next): per kind, one
 * digest of its bounds and one of its world matrices; the chains and the
 * synthetic parts in blocks. **A kind's input is the game's** — its parts'
 * positions and transform chains — so beside each kind's answers the table
 * holds a digest of that input, and a kind reworked since is reported STALE
 * and not compared (nothing can ask Babylon about its new drawing); a kind
 * added since is NEW and one deleted GONE, reported and neither compared nor
 * failed, and so is a scatter kind's rung when a foliage tier's detail moves
 * (it names the group). A MASS of them at once is suspect: a kind's input is
 * partly computed through `src/math` (a builder's own arithmetic, and
 * `flattenParts` for a scatter kind), so a copy that moved can move it. The
 * chains and the synthetic parts are seeded and never stale, so the oracle
 * holds `boundsOf` and `worldMatrixOf` whatever the art does. The knobs (the
 * seed and the counts) are part of what was recorded.
 *
 * `--perturb` is the negative test: our side's matrix has its X translation
 * moved by a millimetre (`NUDGE`), and in the matrix half our chain's ROOT
 * position is moved the same millimetre — which reaches every node's world
 * translation unscaled — so every group of both halves should differ from the
 * table, and the run exits 0 only if each does.
 *
 * In `math-check.mjs`'s style: a Node script, no GPU, no browser, exit 1 on
 * any differing answer. The game's modules are loaded through Vite's SSR loader
 * (as `kit-hash.mjs` loads them), because they import without extensions and
 * read `import.meta.env`.
 */
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { Ledger } from "./lib/babylonTable.mjs";
import { mulberry32 } from "../src/world/rng.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : dflt;
};
const TRANSFORMS = arg("--transforms", 6);
const CHAINS = arg("--chains", 500);
const SYNTHETIC = arg("--synthetic", 2000);
const SEED = arg("--seed", 1);
const PERTURB = args.includes("--perturb");
/** The chains and the synthetic parts are filed this many to a group. */
const BLOCK = 100;
const ledger = new Ledger(
  "bounds-check",
  { seed: SEED, transforms: TRANSFORMS, chains: CHAINS, synthetic: SYNTHETIC, block: BLOCK },
  { perturb: PERTURB && "input" },
);
/** The synthetic chains' own stream, so adding them moved no transform above. */
const chainRand = mulberry32(SEED ^ 0x9e3779b9);
/** The synthetic parts', apart from both. */
const synthRand = mulberry32(SEED ^ 0x7f4a7c15);

/** A small stable hash, so a kind's stream is its own. */
function hashOf(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** As `kit-hash.mjs`: the road paints on a canvas, and Node has none. */
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

/** A material per factory call, named for it — the bounds read none of them. */
function stubMats() {
  const cache = new Map();
  return new Proxy(
    {},
    {
      get: (_t, prop) => () => {
        const key = String(prop);
        if (!cache.has(key)) cache.set(key, { name: key });
        return cache.get(key);
      },
    },
  );
}

const SPECIAL_SCALES = [1, -1, 0, 0.5, 2, 1e-3];

/** The seeded world matrices one part is placed under, all off identity. */
function transformsFor(M, own, rand) {
  const scaleAxis = () => (rand() < 0.25 ? SPECIAL_SCALES[Math.floor(rand() * SPECIAL_SCALES.length)] : 0.1 + rand() * 3);
  const coord = () => (rand() * 2 - 1) * 400;
  const out = [];
  // Its own transform, under a placement: a turn about Y and a translation.
  const turn = M.Quaternion.RotationYawPitchRoll(rand() * 2 * Math.PI, 0, 0);
  const place = M.Matrix.Compose(new M.Vector3(1, 1, 1), turn, new M.Vector3(coord(), rand() * 30, coord()));
  out.push(own.multiply(place));
  while (out.length < TRANSFORMS) {
    const q = new M.Quaternion(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
    q.normalize();
    const s = new M.Vector3(scaleAxis(), scaleAxis(), scaleAxis());
    const t = rand() < 0.1 ? new M.Vector3(0, 0, 0) : new M.Vector3(coord(), coord() * 0.1, coord());
    out.push(M.Matrix.Compose(s, q, t));
  }
  return out.filter((m) => !m.isIdentity());
}

/**
 * `--perturb`'s nudge: a millimetre on the X translation (2^-10 m, which a
 * float32 holds exactly at the coordinates placed here). One float32 STEP is
 * not enough to be sure of: on a zero translation it is a denormal, which the
 * double arithmetic downstream of it adds to a vertex's metres without a trace.
 */
const NUDGE = 2 ** -10;

/** What a node chain IS to `worldMatrixOf`: every node's fields, leaf to root. */
function chainInput(node) {
  const out = [];
  for (let n = node; n; n = n.parent) {
    const q = n.rotationQuaternion;
    out.push(
      n.position.x, n.position.y, n.position.z,
      n.rotation.x, n.rotation.y, n.rotation.z,
      q ? q.x : null, q ? q.y : null, q ? q.z : null, q ? q.w : null,
      n.scaling.x, n.scaling.y, n.scaling.z,
    );
  }
  return out;
}

const server = await createServer({
  root: ROOT,
  configFile: false,
  logLevel: "error",
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: "custom",
});

let checks = 0;
let matrixChecks = 0;
let chainNodes = 0;
let parts = 0;
let synthParts = 0;
let kinds = 0;
const buildErrors = [];
try {
  stubCanvas();
  const M = await server.ssrLoadModule("/src/math/index.ts");
  const { boundsOf } = await server.ssrLoadModule("/src/world/worldGeometry.ts");
  const { BUILDERS } = await server.ssrLoadModule("/src/world/BuildingKit.ts");
  const { SCATTER_BUILDERS } = await server.ssrLoadModule("/src/world/MapBuilder.ts");
  const { PartNode, flattenParts, worldMatrixOf } = await server.ssrLoadModule("/src/world/parts.ts");
  const { CONFIG } = await server.ssrLoadModule("/src/config/index.ts");
  const mats = stubMats();

  /** One part's bounds under one matrix, filed under `group`. */
  function compare(group, positions, world) {
    const ours = PERTURB
      ? M.Matrix.FromValues(...Array.from(world.m, (v, i) => (i === 12 ? v + NUDGE : v)))
      : world;
    const mine = boundsOf(positions, ours);
    const got = [
      mine.minX, mine.minY, mine.minZ, mine.maxX, mine.maxY, mine.maxZ,
      mine.centerX, mine.centerY, mine.centerZ, mine.radius,
    ];
    checks++;
    ledger.answer(group, got);
  }

  /**
   * One node's `worldMatrixOf`, filed under `group` — recorded against a
   * Babylon `TransformNode` chain built to mirror its node chain (position,
   * rotation, rotation quaternion, scaling, parent), all sixteen floats.
   * Under `--perturb` the ROOT's position is a millimetre off in X on our
   * side, for the computation alone.
   */
  function compareMatrix(group, node) {
    let root = node;
    while (root.parent) root = root.parent;
    const x = root.position.x;
    if (PERTURB) root.position.x = x + NUDGE;
    const ours = worldMatrixOf(node, new M.Matrix());
    root.position.x = x;
    matrixChecks++;
    ledger.answer(group, Array.from(ours.m));
  }

  /** A seeded node: a position, Euler angles or a quaternion, and a scaling. */
  function seededNode(name, rand, parent) {
    const axis = () =>
      rand() < 0.25 ? SPECIAL_SCALES[Math.floor(rand() * SPECIAL_SCALES.length)] : 0.1 + rand() * 3;
    const signed = () => rand() * 2 - 1;
    const node = new PartNode(name);
    node.position.set(signed() * 40, signed() * 10, signed() * 40);
    if (rand() < 0.3) {
      const q = new M.Quaternion(signed(), signed(), signed(), signed());
      q.normalize();
      node.rotationQuaternion = q;
    } else {
      node.rotation.set(signed() * Math.PI, signed() * Math.PI, signed() * Math.PI);
    }
    node.scaling.set(axis(), axis(), axis());
    node.parent = parent;
    return node;
  }

  /** A seeded chain one to four nodes deep; every node of it is compared. */
  function checkChain(i) {
    const depth = 1 + Math.floor(chainRand() * 4);
    let parent = null;
    for (let d = 0; d < depth; d++) {
      const node = seededNode(`chain${i}.${d}`, chainRand, parent);
      parent = node;
      chainNodes++;
      compareMatrix(`chains @${Math.floor(i / BLOCK)}`, node);
    }
  }

  /**
   * A seeded part built from nothing in the game: up to two dozen float32
   * vertices (zeros of both signs, ones and the odd large or tiny value among
   * them, at one of four scales) under a seeded chain one to three deep.
   */
  function checkSynthetic(i) {
    const block = Math.floor(i / BLOCK);
    const r = synthRand;
    const SPECIAL = [0, -0, 1, -1, 1e-3, 1e3];
    const scale = [0.01, 1, 10, 100][Math.floor(r() * 4)];
    const n = 1 + Math.floor(r() * 24);
    const positions = new Float32Array(n * 3);
    for (let k = 0; k < positions.length; k++) {
      positions[k] = r() < 0.1 ? SPECIAL[Math.floor(r() * SPECIAL.length)] : (r() * 2 - 1) * scale;
    }
    const depth = 1 + Math.floor(r() * 3);
    let part = null;
    for (let d = 0; d < depth; d++) part = seededNode(`synthetic${i}.${d}`, r, part);
    synthParts++;
    compareMatrix(`synthetic (matrix) @${block}`, part);
    const own = worldMatrixOf(part, new M.Matrix());
    for (const world of transformsFor(M, own, r)) compare(`synthetic @${block}`, positions, world);
  }

  /** A kind's parts: its input digest, then both halves under its own stream. */
  function checkParts(kind, list) {
    kinds++;
    const rand = mulberry32((SEED ^ hashOf(kind)) >>> 0);
    const kept = list.filter((part) => part.geometry.positions.length > 0);
    for (const part of kept) {
      const input = [...Float32Array.from(part.geometry.positions), ...chainInput(part)];
      ledger.input(kind, input);
      ledger.input(`${kind} (matrix)`, input);
    }
    for (const part of kept) {
      const positions = Float32Array.from(part.geometry.positions);
      parts++;
      compareMatrix(`${kind} (matrix)`, part);
      const own = worldMatrixOf(part, new M.Matrix());
      for (const world of transformsFor(M, own, rand)) compare(kind, positions, world);
    }
  }

  for (const kind of Object.keys(BUILDERS).sort()) {
    let s;
    try {
      s = BUILDERS[kind](mats);
    } catch (e) {
      buildErrors.push(`${kind}: ${e?.message ?? e}`);
      continue;
    }
    checkParts(kind, [...s.meshes, ...s.paneMeshes]);
  }
  const rungs = [...new Set(Object.values(CONFIG.graphics.foliage.tiers).map((t) => t.detail))];
  for (const kind of Object.keys(SCATTER_BUILDERS).sort()) {
    for (const foliage of rungs) {
      let root;
      try {
        root = SCATTER_BUILDERS[kind](mats, mulberry32(1), mulberry32(1 ^ 0x2545f491), foliage);
      } catch (e) {
        buildErrors.push(`${kind} (foliage ${foliage}): ${e?.message ?? e}`);
        continue;
      }
      checkParts(`${kind}@${foliage}`, flattenParts(root));
    }
  }
  for (let i = 0; i < CHAINS; i++) checkChain(i);
  for (let i = 0; i < SYNTHETIC; i++) checkSynthetic(i);
} finally {
  await server.close();
}

console.log(
  `bounds-check: ${checks} bounds over ${parts} parts of ${kinds} kinds and ${synthParts} synthetic parts, ${TRANSFORMS} off-identity transforms a part` +
    (PERTURB ? " (--perturb: our matrix a millimetre off in X)" : ""),
);
console.log(
  `bounds-check: ${matrixChecks} world matrices (${parts} parts, ${synthParts} synthetic parts, ${chainNodes} nodes of ${CHAINS} seeded chains)`,
);
if (buildErrors.length) console.log(`BUILD FAILED: ${buildErrors.join("; ")}`);
const failed = ledger.finish();
process.exit(failed || buildErrors.length || checks === 0 || matrixChecks === 0 ? 1 : 0);
