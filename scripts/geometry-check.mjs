/**
 * geometry-check.mjs — proves `src/geometry/` builds Babylon's surfaces BIT
 * FOR BIT.
 *
 *   node scripts/geometry-check.mjs [--trials 400] [--seed 1]
 *
 * `src/geometry/` is a port of the eight primitive generators the tree builds
 * from and of what the kit and the models do to vertex data — merge it (with
 * each member under its own matrix, as `Mesh.MergeMeshes` does), transform
 * it, bake a transform into it as `Mesh.bakeTransformIntoVertices` does,
 * compute its normals (BABYLON_EXIT.md X1.2, X1.3) — and its whole
 * claim is that a surface built through it is the surface Babylon built: one
 * vertex out of place moves every building made of it, and `kit:hash` and
 * `merge:hash` compare bits. This builds each one both ways over seeded
 * options and compares every number, every index and the attribute set with
 * `Object.is`, so a -0 against a +0 fails. It is `math-check.mjs`'s twin, and
 * like it, it fails on an export of `primitives.ts` no case names
 * (`COVERED`), so it cannot quietly fall behind.
 *
 * What it compares is VALUES, never array types: a buffer holds a
 * `Float64Array` where Babylon held a `number[]` (see `buffer.ts`), and the
 * type is what the merge cases check separately — a `Float32Array` first
 * member must give a `Float32Array` back, as Babylon's does.
 *
 * `--trials` past about 3,000 runs Node out of heap, and the leak is
 * BABYLON's: its `CreateSphereVertexData` holds on to ~0.5 MB a call, which
 * ours does not (measured over 3,000 calls each, after a forced GC: 67 MB
 * against 1,588). 3,000 is 33,000 comparisons and every option arm many times.
 *
 * Deleted with Babylon at X6.1, when there is nothing left to compare with.
 */
import * as B from "@babylonjs/core";
import * as G from "../src/geometry/primitives.ts";
import { GeometryBuffer, computeNormals, mergeTransformed } from "../src/geometry/buffer.ts";
import { Matrix as OurMatrix, Quaternion as OurQuaternion, Vector3 as OurVector3 } from "../src/math/index.ts";
import { mulberry32 } from "../src/world/rng.ts";

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : dflt;
};
const TRIALS = arg("--trials", 400);
const rand = mulberry32(arg("--seed", 1));

const pick = (list) => list[Math.floor(rand() * list.length)];
/** Sometimes absent, sometimes zero, mostly a positive size. */
const dim = () => pick([undefined, 0, 1, 2, 0.5]) ?? (rand() < 0.6 ? 0.01 + rand() * 4 : undefined);
const side = () => pick([undefined, undefined, undefined, 0, 1, 2]);
const maybe = (v) => (rand() < 0.5 ? undefined : v);
/** Drops the keys whose value is undefined, so an absent option is ABSENT. */
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

// ---------------------------------------------------------------------------

let failures = 0;
let checks = 0;
const failedNames = new Map();
const KINDS = ["positions", "normals", "uvs", "uvs2", "colors", "indices"];

function sameData(name, ours, theirs, input) {
  checks++;
  let why = null;
  for (const k of KINDS) {
    const a = ours[k] ?? null;
    const b = theirs[k] ?? null;
    if (!a !== !b) {
      why = `${k}: present ${!!a} against ${!!b}`;
      break;
    }
    if (!a) continue;
    if (a.length !== b.length) {
      why = `${k}: length ${a.length} against ${b.length}`;
      break;
    }
    for (let i = 0; i < a.length; i++) {
      if (!Object.is(a[i], b[i])) {
        why = `${k}[${i}]: ${a[i]} against ${b[i]}`;
        break;
      }
    }
    if (why) break;
  }
  if (!why) return;
  failures++;
  failedNames.set(name, (failedNames.get(name) ?? 0) + 1);
  if (failedNames.get(name) <= 3) console.log(`DIFF ${name}\n  input ${JSON.stringify(input)}\n  ${why}`);
}

function sameValue(name, ok, input, why) {
  checks++;
  if (ok) return;
  failures++;
  failedNames.set(name, (failedNames.get(name) ?? 0) + 1);
  if (failedNames.get(name) <= 3) console.log(`DIFF ${name}\n  input ${JSON.stringify(input)}\n  ${why}`);
}

// ---------------------------------------------------------------------------
// The generators. Each case draws options and names the export it covers.

const COVERED = new Set(["FRONTSIDE", "BACKSIDE", "DOUBLESIDE", "NO_CAP", "CAP_START", "CAP_END", "CAP_ALL"]);
const CASES = [];
function caseOf(name, ours, theirs, draw) {
  COVERED.add(name);
  CASES.push({ name, ours, theirs, draw });
}

caseOf("createBox", G.createBox, B.CreateBoxVertexData, () =>
  rand() < 0.6
    ? clean({ width: dim(), height: dim(), depth: dim() })
    : clean({
        size: maybe(dim()),
        width: maybe(dim()),
        height: maybe(dim()),
        depth: maybe(dim()),
        wrap: maybe(rand() < 0.5),
        topBaseAt: maybe(Math.floor(rand() * 8) - 4),
        bottomBaseAt: maybe(Math.floor(rand() * 8) - 4),
        sideOrientation: side(),
      }),
);
caseOf("createCylinder", G.createCylinder, B.CreateCylinderVertexData, () =>
  clean({
    height: maybe(dim()),
    diameterTop: maybe(pick([0, dim()])),
    diameterBottom: maybe(pick([0, dim()])),
    diameter: maybe(dim()),
    tessellation: maybe(pick([3, 5, 6, 8, 12, 20, 24])),
    subdivisions: maybe(pick([1, 2, 3])),
    arc: maybe(pick([0.25, 0.5, 1, 1.5, -1])),
    hasRings: maybe(rand() < 0.5),
    enclose: maybe(rand() < 0.5),
    cap: maybe(pick([0, 1, 2, 3])),
    sideOrientation: side(),
  }),
);
caseOf("createTorus", G.createTorus, B.CreateTorusVertexData, () =>
  clean({ diameter: maybe(dim()), thickness: maybe(dim()), tessellation: maybe(pick([3, 8, 16, 18])), sideOrientation: side() }),
);
caseOf("createIcoSphere", G.createIcoSphere, B.CreateIcoSphereVertexData, () =>
  clean({
    radius: maybe(dim()),
    radiusX: maybe(dim()),
    radiusY: maybe(dim()),
    radiusZ: maybe(dim()),
    flat: maybe(rand() < 0.5),
    subdivisions: maybe(pick([1, 2, 3, 4])),
    sideOrientation: side(),
  }),
);
caseOf("createSphere", G.createSphere, B.CreateSphereVertexData, () =>
  clean({
    segments: maybe(pick([1, 2, 4, 8, 16])),
    diameter: maybe(dim()),
    diameterX: maybe(dim()),
    diameterY: maybe(dim()),
    diameterZ: maybe(dim()),
    arc: maybe(pick([0.25, 0.5, 1, 1.5])),
    slice: maybe(pick([0.25, 0.5, 1, -1])),
    dedupTopBottomIndices: maybe(rand() < 0.5),
    sideOrientation: side(),
  }),
);
caseOf("createPolyhedron", G.createPolyhedron, B.CreatePolyhedronVertexData, () =>
  clean({
    type: maybe(Math.floor(rand() * 17) - 1),
    size: maybe(dim()),
    sizeX: maybe(dim()),
    sizeY: maybe(dim()),
    sizeZ: maybe(dim()),
    flat: maybe(rand() < 0.5),
    sideOrientation: side(),
  }),
);

caseOf("createPlane", G.createPlane, B.CreatePlaneVertexData, () =>
  clean({ size: maybe(dim()), width: maybe(dim()), height: maybe(dim()), sideOrientation: side() }),
);
caseOf("createDisc", G.createDisc, B.CreateDiscVertexData, () =>
  clean({
    radius: maybe(dim()),
    tessellation: maybe(pick([3, 6, 12, 24, 64])),
    arc: maybe(pick([0.25, 0.5, 1, 1.5, -1, 0])),
    sideOrientation: side(),
  }),
);

// ---------------------------------------------------------------------------
// The buffer: normals, transform and merge, against VertexData's.

/** A random little mesh, as plain arrays both sides are built from. */
function soup(withUv = true) {
  const n = 3 + Math.floor(rand() * 12);
  const positions = [];
  for (let i = 0; i < n * 3; i++) positions.push(rand() < 0.1 ? pick([0, -0, 1]) : (rand() * 2 - 1) * 5);
  const indices = [];
  const tris = 1 + Math.floor(rand() * 10);
  for (let i = 0; i < tris * 3; i++) indices.push(Math.floor(rand() * n));
  const uvs = withUv ? Array.from({ length: n * 2 }, () => rand()) : null;
  return { positions, indices, uvs };
}

function theirsOf(arrays, f32) {
  const vd = new B.VertexData();
  vd.positions = f32 ? new Float32Array(arrays.positions) : arrays.positions.slice();
  vd.indices = arrays.indices.slice();
  if (arrays.normals) vd.normals = f32 ? new Float32Array(arrays.normals) : arrays.normals.slice();
  if (arrays.uvs) vd.uvs = f32 ? new Float32Array(arrays.uvs) : arrays.uvs.slice();
  return vd;
}
function oursOf(arrays, f32) {
  return new GeometryBuffer({
    positions: f32 ? new Float32Array(arrays.positions) : arrays.positions,
    indices: arrays.indices,
    normals: arrays.normals ? (f32 ? new Float32Array(arrays.normals) : arrays.normals) : null,
    uvs: arrays.uvs ? (f32 ? new Float32Array(arrays.uvs) : arrays.uvs) : null,
  });
}
function withNormals(a) {
  const normals = [];
  B.VertexData.ComputeNormals(a.positions, a.indices, normals);
  return { ...a, normals };
}

/** A scale (sometimes mirrored), a rotation and a translation (sometimes -0). */
function drawMatrix() {
  return {
    s: [rand() < 0.3 ? -1 : 1, 1 + rand(), rand() < 0.2 ? 1 : 0.5 + rand()],
    q: [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1],
    t: [rand() * 10, rand() * 10, rand() < 0.2 ? -0 : rand() * 10],
  };
}

/** The one scene the bake case builds its meshes in: a mesh needs one. */
const bakeScene = new B.Scene(new B.NullEngine());

const BUFFER_CASES = {
  computeNormals() {
    const a = soup();
    const theirs = [];
    B.VertexData.ComputeNormals(a.positions, a.indices, theirs);
    sameData("computeNormals", { normals: computeNormals(a.positions, a.indices) }, { normals: theirs }, a);
  },
  transform() {
    const a = withNormals(soup());
    const s = [rand() < 0.3 ? -1 : 1, 1 + rand(), rand() < 0.2 ? 1 : 0.5 + rand()];
    const q = [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1];
    const t = [rand() * 10, rand() * 10, rand() < 0.2 ? -0 : rand() * 10];
    const f32 = rand() < 0.3;
    const theirs = theirsOf(a, f32).transform(B.Matrix.Compose(new B.Vector3(...s), new B.Quaternion(...q), new B.Vector3(...t)));
    const ours = oursOf(a, f32).transform(OurMatrix.Compose(new OurVector3(...s), new OurQuaternion(...q), new OurVector3(...t)));
    sameData("transform", ours, theirs, { a, s, q, t, f32 });
  },
  merge() {
    const count = 1 + Math.floor(rand() * 4);
    const uv = rand() < 0.8;
    const parts = Array.from({ length: count }, () => ({ a: withNormals(soup(uv)), f32: rand() < 0.3 }));
    const [first, ...rest] = parts;
    const theirs = theirsOf(first.a, first.f32).merge(rest.map((p) => theirsOf(p.a, p.f32)), rand() < 0.5);
    const ours = oursOf(first.a, first.f32).merge(rest.map((p) => oursOf(p.a, p.f32)));
    sameData("merge", ours, theirs, parts);
    // The FIRST member's precision is the merge's (see `buffer.ts`).
    sameValue(
      "merge keeps the first member's precision",
      (ours.positions instanceof Float32Array) === (theirs.positions instanceof Float32Array),
      parts.map((p) => p.f32),
      `ours ${ours.positions.constructor.name}, Babylon's ${theirs.positions.constructor.name}`,
    );
  },
  mergeTransformed() {
    // What `Mesh.MergeMeshes` runs: every member under its own world matrix,
    // transformed INSIDE the merge (see `buffer.ts`), mirrors included.
    const count = 1 + Math.floor(rand() * 4);
    const uv = rand() < 0.8;
    const parts = Array.from({ length: count }, () => ({
      a: withNormals(soup(uv)),
      f32: rand() < 0.3,
      m: rand() < 0.15 ? null : drawMatrix(),
    }));
    const [first, ...rest] = parts;
    const theirMatrix = (m) => (m ? B.Matrix.Compose(new B.Vector3(...m.s), new B.Quaternion(...m.q), new B.Vector3(...m.t)) : undefined);
    const ourMatrix = (m) => (m ? OurMatrix.Compose(new OurVector3(...m.s), new OurQuaternion(...m.q), new OurVector3(...m.t)) : null);
    const steps = theirsOf(first.a, first.f32)._mergeCoroutine(
      theirMatrix(first.m),
      rest.map((p) => ({ vertexData: theirsOf(p.a, p.f32), transform: theirMatrix(p.m) })),
      true,
      false,
      false,
    );
    let step = steps.next();
    while (!step.done) step = steps.next();
    const theirs = step.value;
    const members = parts.map((p) => ({ buffer: oursOf(p.a, p.f32), transform: ourMatrix(p.m) }));
    const before = members.map((m) => m.buffer.clone());
    const ours = mergeTransformed(members[0], members.slice(1));
    sameData("mergeTransformed", ours, theirs, parts);
    sameValue(
      "mergeTransformed keeps the first member's precision",
      (ours.positions instanceof Float32Array) === (theirs.positions instanceof Float32Array),
      parts.map((p) => p.f32),
      `ours ${ours.positions.constructor.name}, Babylon's ${theirs.positions.constructor.name}`,
    );
    // Babylon writes the merge onto its first member; ours must not touch any.
    members.forEach((m, i) =>
      sameData("mergeTransformed leaves its members alone", m.buffer, before[i], parts[i]),
    );
  },
  bake() {
    // `Mesh.bakeTransformIntoVertices`, on a real mesh: normals renormalised,
    // a mirror turning the winding over.
    const a = withNormals(soup());
    const f32 = rand() < 0.3;
    const m = drawMatrix();
    const mesh = new B.Mesh("bake", bakeScene);
    theirsOf(a, f32).applyToMesh(mesh);
    mesh.bakeTransformIntoVertices(B.Matrix.Compose(new B.Vector3(...m.s), new B.Quaternion(...m.q), new B.Vector3(...m.t)));
    const theirs = {
      positions: mesh.getVerticesData("position"),
      normals: mesh.getVerticesData("normal"),
      uvs: mesh.getVerticesData("uv"),
      indices: mesh.getIndices(),
    };
    const ours = oursOf(a, f32).bake(OurMatrix.Compose(new OurVector3(...m.s), new OurQuaternion(...m.q), new OurVector3(...m.t)));
    sameData("bake", ours, theirs, { a, f32, m });
    mesh.dispose();
  },
  mergeRefusesMismatch() {
    const a = withNormals(soup(true));
    const b = withNormals(soup(false));
    let refused = false;
    try {
      oursOf(a, false).merge(oursOf(b, false));
    } catch {
      refused = true;
    }
    sameValue("merge refuses a member without the same attributes", refused, null, "it merged");
  },
};

// ---------------------------------------------------------------------------

const missing = Object.keys(G).filter((k) => !COVERED.has(k));

for (let t = 0; t < TRIALS; t++) {
  for (const c of CASES) {
    const options = c.draw();
    // An option set Babylon throws on must throw here too, and the message
    // says which way round it went.
    const attempt = (f) => {
      try {
        return f({ ...options });
      } catch (e) {
        return { threw: String(e?.message ?? e) };
      }
    };
    const ours = attempt(c.ours);
    const theirs = attempt(c.theirs);
    if (ours.threw || theirs.threw) {
      sameValue(c.name, !!ours.threw === !!theirs.threw, options, `ours ${ours.threw ?? "built"}, Babylon's ${theirs.threw ?? "built"}`);
    } else {
      sameData(c.name, ours, theirs, options);
    }
  }
  for (const run of Object.values(BUFFER_CASES)) run();
}

console.log(
  `geometry-check: ${checks} comparisons over ${CASES.length + Object.keys(BUFFER_CASES).length} cases, ${TRIALS} trials each`,
);
if (missing.length) console.log(`UNCOVERED (an export with no case): ${missing.join(", ")}`);
if (failures) console.log(`FAILED: ${failures} differing answers in ${[...failedNames.keys()].join(", ")}`);
process.exit(failures || missing.length ? 1 : 0);
