/**
 * bounds-check.mjs — proves `boundsOf`'s TRANSFORMED path gives Babylon's
 * `BoundingInfo` BIT FOR BIT, over every kind the world is built from.
 *
 *   node scripts/bounds-check.mjs [--transforms 6] [--seed 1] [--perturb]
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
 * How: under a NullEngine, every kit builder (`BUILDERS`, built bare at its
 * default params) and every scatter kind (`SCATTER_BUILDERS`, at one seed and
 * every foliage rung) is built, and each of its parts' positions is taken as
 * the Float32Array a mesh holds. Each part is placed under `--transforms`
 * seeded OFF-IDENTITY world matrices — its own (`worldMatrixOf`) times a
 * placement (a turn about Y and a translation, as `MapBuilder` places a
 * structure), and seeded `Compose`s of a scale (negative and zero axes among
 * them), a rotation and a translation — and its bounds are taken twice:
 * `boundsOf` over `src/math`'s matrix, and a Babylon `Mesh` holding the same
 * positions with the same sixteen floats frozen as its world matrix
 * (`freezeWorldMatrix`, then `refreshBoundingInfo`: the mesh path itself,
 * `extractMinAndMax` and `BoundingInfo.update`). The box (`minimumWorld`,
 * `maximumWorld`) and the sphere (`centerWorld`, `radiusWorld`) are compared
 * with `Object.is`, so a -0 against a +0 fails.
 *
 * The matrix is built ONCE, on our side, and copied to Babylon's float for
 * float: that `src/math` composes as Babylon does is `math-check.mjs`'s to
 * prove, and this proves what `boundsOf` does with a matrix it is handed.
 * Both sides read the same positions array.
 *
 * `--perturb` is the negative test: our side's matrix has its X translation
 * moved by a millimetre (`NUDGE`) and Babylon's does not, so every comparison should
 * fail — and the run exits 0 only if it does, saying how many it caught.
 *
 * In `math-check.mjs`'s style: a Node script, no GPU, no browser, exit 1 on
 * any differing answer. The game's modules are loaded through Vite's SSR loader
 * (as `kit-hash.mjs` loads them), because they import without extensions and
 * read `import.meta.env`. Kept until X6.1, which removes Babylon and keeps a
 * recorded table in place of it.
 */
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { mulberry32 } from "../src/world/rng.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : dflt;
};
const TRANSFORMS = arg("--transforms", 6);
const PERTURB = args.includes("--perturb");
const rand = mulberry32(arg("--seed", 1));

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
function stubMats(B, scene) {
  const cache = new Map();
  return new Proxy(
    {},
    {
      get: (_t, prop) => () => {
        const key = String(prop);
        if (!cache.has(key)) cache.set(key, new B.StandardMaterial(key, scene));
        return cache.get(key);
      },
    },
  );
}

const SPECIAL_SCALES = [1, -1, 0, 0.5, 2, 1e-3];
const scaleAxis = () => (rand() < 0.25 ? SPECIAL_SCALES[Math.floor(rand() * SPECIAL_SCALES.length)] : 0.1 + rand() * 3);
const coord = () => (rand() * 2 - 1) * 400;

/** The seeded world matrices one part is placed under, all off identity. */
function transformsFor(M, own) {
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

const server = await createServer({
  root: ROOT,
  configFile: false,
  logLevel: "error",
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: "custom",
});

let checks = 0;
let failures = 0;
let parts = 0;
let kinds = 0;
const failedKinds = new Map();
const buildErrors = [];
try {
  stubCanvas();
  const B = await server.ssrLoadModule("@babylonjs/core");
  B.Logger.LogLevels = B.Logger.NoneLogLevel;
  const M = await server.ssrLoadModule("/src/math/index.ts");
  const { boundsOf } = await server.ssrLoadModule("/src/world/worldGeometry.ts");
  const { BUILDERS } = await server.ssrLoadModule("/src/world/BuildingKit.ts");
  const { SCATTER_BUILDERS } = await server.ssrLoadModule("/src/world/MapBuilder.ts");
  const { flattenParts, worldMatrixOf } = await server.ssrLoadModule("/src/world/parts.ts");
  const { CONFIG } = await server.ssrLoadModule("/src/config/index.ts");
  const engine = new B.NullEngine();
  const scene = new B.Scene(engine);
  const mats = stubMats(B, scene);
  const mesh = new B.Mesh("bounds-check", scene);

  /** Both sides' bounds of one part under one matrix. */
  function compare(kind, partName, positions, world) {
    const ours = PERTURB
      ? M.Matrix.FromValues(...Array.from(world.m, (v, i) => (i === 12 ? v + NUDGE : v)))
      : world;
    const mine = boundsOf(positions, ours);
    mesh.freezeWorldMatrix(B.Matrix.FromArray(Array.from(world.m)));
    mesh.refreshBoundingInfo();
    const info = mesh.getBoundingInfo();
    const box = info.boundingBox;
    const sphere = info.boundingSphere;
    const theirs = [
      box.minimumWorld.x, box.minimumWorld.y, box.minimumWorld.z,
      box.maximumWorld.x, box.maximumWorld.y, box.maximumWorld.z,
      sphere.centerWorld.x, sphere.centerWorld.y, sphere.centerWorld.z, sphere.radiusWorld,
    ];
    const got = [
      mine.minX, mine.minY, mine.minZ, mine.maxX, mine.maxY, mine.maxZ,
      mine.centerX, mine.centerY, mine.centerZ, mine.radius,
    ];
    checks++;
    if (got.every((v, i) => Object.is(v, theirs[i]))) return;
    failures++;
    failedKinds.set(kind, (failedKinds.get(kind) ?? 0) + 1);
    if (failures <= 5 && !PERTURB) {
      console.log(`DIFF ${kind} / ${partName}\n  matrix ${JSON.stringify(Array.from(world.m))}\n  babylon ${JSON.stringify(theirs)}\n  ours    ${JSON.stringify(got)}`);
    }
  }

  function checkParts(kind, list) {
    kinds++;
    for (const part of list) {
      const positions = Float32Array.from(part.geometry.positions);
      if (positions.length === 0) continue;
      parts++;
      mesh.setVerticesData(B.VertexBuffer.PositionKind, positions, false);
      const own = worldMatrixOf(part, new M.Matrix());
      for (const world of transformsFor(M, own)) compare(kind, part.name, positions, world);
    }
  }

  for (const kind of Object.keys(BUILDERS).sort()) {
    let s;
    try {
      s = BUILDERS[kind](scene, mats);
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
} finally {
  await server.close();
}

console.log(
  `bounds-check: ${checks} comparisons over ${parts} parts of ${kinds} kinds, ${TRANSFORMS} off-identity transforms a part` +
    (PERTURB ? " (--perturb: our matrix a millimetre off in X)" : ""),
);
if (buildErrors.length) console.log(`BUILD FAILED: ${buildErrors.join("; ")}`);
if (PERTURB) {
  // The negative test: every comparison must have been caught.
  console.log(`perturbed: ${failures} of ${checks} comparisons differ`);
  process.exit(failures === checks && checks > 0 && !buildErrors.length ? 0 : 1);
}
if (failures) console.log(`FAILED: ${failures} differing answers in ${[...failedKinds.keys()].join(", ")}`);
process.exit(failures || buildErrors.length || checks === 0 ? 1 : 0);
