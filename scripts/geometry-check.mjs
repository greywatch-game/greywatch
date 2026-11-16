/**
 * geometry-check.mjs — proves `src/geometry/` builds Babylon's surfaces BIT
 * FOR BIT.
 *
 *   node scripts/geometry-check.mjs [--perturb]
 *   node scripts/geometry-check.mjs --record   (only where Babylon 9.28 is installed)
 *
 * `src/geometry/` is a port of the eight primitive generators the tree builds
 * from and of what the kit and the models do to vertex data — merge it (with
 * each member under its own matrix, as `Mesh.MergeMeshes` does), transform
 * it, bake a transform into it as `Mesh.bakeTransformIntoVertices` does,
 * compute its normals — and its whole
 * claim is that a surface built through it is the surface Babylon built: one
 * vertex out of place moves every building made of it, and `kit:hash` and
 * `merge:hash` compare bits. This builds each one over seeded options and
 * compares every number, every index and the attribute set with Babylon's by
 * its bits, so a -0 against a +0 fails. It is `math-check.mjs`'s twin, and
 * like it, it fails on an export of `primitives.ts` no case names
 * (`COVERED`), so it cannot quietly fall behind.
 *
 * **And the three EFFECTS' own calls** (`BABYLON_EXIT.md` X6.1g, which moved
 * them off Babylon's routines onto these): the blast's two icospheres
 * (`BlastFx`, radius 1 at subdivisions 8 and 4, smooth), a rubble chunk's box
 * (`BlastDebrisSystem`, three jittered extents), and a glass shard's normals
 * computed INTO a float32 array from float32 positions (`DebrisSystem`) —
 * which rounds every sum as it is stored, on both sides, so it is its own
 * case beside the doubles' `computeNormals`.
 *
 * What it compares is VALUES, never array types: a buffer holds a
 * `Float64Array` where Babylon held a `number[]` (see `buffer.ts`), and the
 * type is what the merge cases check separately — a `Float32Array` first
 * member must give a `Float32Array` back, as Babylon's does.
 *
 * **Babylon's answers are a RECORDED TABLE** (`scripts/tables/geometry-check.json`,
 * `scripts/lib/babylonTable.mjs`; `BABYLON_EXIT.md` row "X6.1, the copy
 * checks"): each case over a block of twenty trials is one digest of Babylon
 * 9.28's answers, captured by `--record` while the package was installed
 * (X6.1i's first commit, which compared every answer live as well), and a run
 * now holds ours to them — so the seed, the trial count and every draw below
 * are part of what was recorded and may not change. A generator Babylon threw
 * on must throw here too (the throw is recorded, not its message). Two cases
 * compare ours with ours and need no table: a merge leaves its members alone,
 * and refuses members whose attributes differ. `--perturb` is the negative
 * test: one value in the first answer of every recorded group moved one ULP,
 * and every group must then fail. A new export owes a case and has nothing to
 * record it against since the package left (X6.1i).
 */
import * as G from "../src/geometry/primitives.ts";
import { GeometryBuffer, computeNormals, computeNormalsInto, mergeTransformed } from "../src/geometry/buffer.ts";
import { Matrix as OurMatrix, Quaternion as OurQuaternion, Vector3 as OurVector3 } from "../src/math/index.ts";
import { Ledger } from "./lib/babylonTable.mjs";
import { mulberry32 } from "../src/world/rng.ts";

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : dflt;
};
const TRIALS = arg("--trials", 400);
const SEED = arg("--seed", 1);
const RECORD = args.includes("--record");
/** A table group is one case over this many trials. */
const BLOCK = 20;
const ledger = new Ledger("geometry-check", { seed: SEED, trials: TRIALS, block: BLOCK }, {
  record: RECORD,
  perturb: args.includes("--perturb") && "output",
});
/** Babylon, when recording: the reference the table is taken from. */
const B = RECORD ? await import("@babylonjs/core") : null;
const rand = mulberry32(SEED);

/** The trial being run, which names the block a comparison is filed under. */
let trial = 0;
const group = (name) => `${name} @${Math.floor(trial / BLOCK)}`;

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

/** A surface as the flat list its comparison is: per kind, whether, how long, what. */
function flatData(x) {
  const out = [];
  for (const k of KINDS) {
    const a = x[k] ?? null;
    out.push(!!a);
    if (!a) continue;
    out.push(a.length);
    for (let i = 0; i < a.length; i++) out.push(a[i]);
  }
  return out;
}

/** Live: ours against the other, every value by `Object.is` (ours with ours, or Babylon's when recording). */
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

/**
 * A surface against Babylon's: compared live when recording (and Babylon's
 * filed), ours filed against the table otherwise. `key` is the group.
 */
function againstBabylon(name, key, ours, theirs, input) {
  if (B) {
    sameData(name, ours, theirs, input);
    ledger.answer(key, flatData(theirs));
  } else {
    ledger.answer(key, flatData(ours));
  }
}

/** A merge's precision (whether its positions are a `Float32Array`), the same way. */
function precisionAgainstBabylon(name, ours, theirs, input) {
  const mine = ours.positions instanceof Float32Array;
  if (B) {
    const theirs32 = theirs.positions instanceof Float32Array;
    sameValue(name, mine === theirs32, input, `ours ${ours.positions.constructor.name}, Babylon's ${theirs.positions.constructor.name}`);
    ledger.answer(group(name), [theirs32]);
  } else {
    ledger.answer(group(name), [mine]);
  }
}

// ---------------------------------------------------------------------------
// The generators. Each case draws options and names the export it covers.

const COVERED = new Set(["FRONTSIDE", "BACKSIDE", "DOUBLESIDE", "NO_CAP", "CAP_START", "CAP_END", "CAP_ALL"]);
const CASES = [];
/** `theirs` is the Babylon generator's NAME, asked only when recording. */
function caseOf(name, ours, theirs, draw) {
  COVERED.add(name);
  CASES.push({ name, ours, theirs: B ? B[theirs] : null, draw });
}

caseOf("createBox", G.createBox, "CreateBoxVertexData", () =>
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
caseOf("createCylinder", G.createCylinder, "CreateCylinderVertexData", () =>
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
caseOf("createTorus", G.createTorus, "CreateTorusVertexData", () =>
  clean({ diameter: maybe(dim()), thickness: maybe(dim()), tessellation: maybe(pick([3, 8, 16, 18])), sideOrientation: side() }),
);
caseOf("createIcoSphere", G.createIcoSphere, "CreateIcoSphereVertexData", () =>
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
caseOf("createSphere", G.createSphere, "CreateSphereVertexData", () =>
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
caseOf("createPolyhedron", G.createPolyhedron, "CreatePolyhedronVertexData", () =>
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

caseOf("createPlane", G.createPlane, "CreatePlaneVertexData", () =>
  clean({ size: maybe(dim()), width: maybe(dim()), height: maybe(dim()), sideOrientation: side() }),
);
caseOf("createDisc", G.createDisc, "CreateDiscVertexData", () =>
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
/**
 * A soup with its normals: Babylon's `ComputeNormals` when recording, and
 * since the package left ours, which `computeNormals` below holds to it (an
 * input made by a broken copy moves the answers it feeds, so it fails too).
 */
function withNormals(a) {
  const normals = [];
  if (B) B.VertexData.ComputeNormals(a.positions, a.indices, normals);
  else normals.push(...computeNormals(a.positions, a.indices));
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

/** The one scene the bake case builds its meshes in, recording: a mesh needs one. */
const bakeScene = B ? new B.Scene(new B.NullEngine()) : null;
const theirMatrix = (m) => (m ? B.Matrix.Compose(new B.Vector3(...m.s), new B.Quaternion(...m.q), new B.Vector3(...m.t)) : undefined);
const ourMatrix = (m) => (m ? OurMatrix.Compose(new OurVector3(...m.s), new OurQuaternion(...m.q), new OurVector3(...m.t)) : null);

const BUFFER_CASES = {
  computeNormals() {
    const a = soup();
    let theirs = null;
    if (B) {
      theirs = [];
      B.VertexData.ComputeNormals(a.positions, a.indices, theirs);
    }
    againstBabylon("computeNormals", group("computeNormals"), { normals: computeNormals(a.positions, a.indices) }, { normals: theirs }, a);
  },
  transform() {
    const a = withNormals(soup());
    const m = drawMatrix();
    const f32 = rand() < 0.3;
    const theirs = B ? theirsOf(a, f32).transform(theirMatrix(m)) : null;
    const ours = oursOf(a, f32).transform(ourMatrix(m));
    againstBabylon("transform", group("transform"), ours, theirs, { a, ...m, f32 });
  },
  merge() {
    const count = 1 + Math.floor(rand() * 4);
    const uv = rand() < 0.8;
    const parts = Array.from({ length: count }, () => ({ a: withNormals(soup(uv)), f32: rand() < 0.3 }));
    const [first, ...rest] = parts;
    // Babylon's `use32BitsIndices`, drawn whether or not it is asked.
    const wide = rand() < 0.5;
    const theirs = B ? theirsOf(first.a, first.f32).merge(rest.map((p) => theirsOf(p.a, p.f32)), wide) : null;
    const ours = oursOf(first.a, first.f32).merge(rest.map((p) => oursOf(p.a, p.f32)));
    againstBabylon("merge", group("merge"), ours, theirs, parts);
    // The FIRST member's precision is the merge's (see `buffer.ts`).
    precisionAgainstBabylon("merge keeps the first member's precision", ours, theirs, parts.map((p) => p.f32));
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
    let theirs = null;
    if (B) {
      const steps = theirsOf(first.a, first.f32)._mergeCoroutine(
        theirMatrix(first.m),
        rest.map((p) => ({ vertexData: theirsOf(p.a, p.f32), transform: theirMatrix(p.m) })),
        true,
        false,
        false,
      );
      let step = steps.next();
      while (!step.done) step = steps.next();
      theirs = step.value;
    }
    const members = parts.map((p) => ({ buffer: oursOf(p.a, p.f32), transform: ourMatrix(p.m) }));
    const before = members.map((m) => m.buffer.clone());
    const ours = mergeTransformed(members[0], members.slice(1));
    againstBabylon("mergeTransformed", group("mergeTransformed"), ours, theirs, parts);
    precisionAgainstBabylon("mergeTransformed keeps the first member's precision", ours, theirs, parts.map((p) => p.f32));
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
    let theirs = null;
    if (B) {
      const mesh = new B.Mesh("bake", bakeScene);
      theirsOf(a, f32).applyToMesh(mesh);
      mesh.bakeTransformIntoVertices(theirMatrix(m));
      theirs = {
        positions: mesh.getVerticesData("position"),
        normals: mesh.getVerticesData("normal"),
        uvs: mesh.getVerticesData("uv"),
        indices: mesh.getIndices(),
      };
      mesh.dispose();
    }
    const ours = oursOf(a, f32).bake(ourMatrix(m));
    againstBabylon("bake", group("bake"), ours, theirs, { a, f32, m });
  },
  computeNormalsIntoFloat32() {
    // `DebrisSystem`'s call: a shard's float32 positions, its normals summed
    // INTO its own float32 array (stale values first, as a reused shard's),
    // degenerate faces and all — the soup repeats indices.
    const a = soup(false);
    const positions = new Float32Array(a.positions);
    const ours = new Float32Array(positions.length).fill(7);
    let theirs = null;
    if (B) {
      theirs = new Float32Array(positions.length).fill(7);
      B.VertexData.ComputeNormals(positions, a.indices, theirs);
    }
    computeNormalsInto(positions, a.indices, ours);
    const name = "computeNormalsInto (float32, a shard's)";
    againstBabylon(name, group(name), { normals: ours }, { normals: theirs }, a);
  },
  chunkBox() {
    // `BlastDebrisSystem`'s call: a base size in the rubble's band, three
    // extents jittered off it, the full extents handed to the generator.
    const base = 0.04 + rand() * 0.16;
    const hx = base * (0.7 + 0.6 * rand());
    const hy = base * (0.55 + 0.5 * rand());
    const hz = base * (0.7 + 0.6 * rand());
    const o = { width: hx * 2, height: hy * 2, depth: hz * 2 };
    const name = "createBox (a rubble chunk's)";
    againstBabylon(name, group(name), G.createBox({ ...o }), B ? B.CreateBoxVertexData({ ...o }) : null, o);
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

// The blast's two icospheres (`BlastFx`), exactly as it asks for them: once
// each, since nothing about them is drawn.
for (const subdivisions of [8, 4]) {
  const o = { radius: 1, subdivisions, flat: false };
  const name = `createIcoSphere (the billow's, ${subdivisions})`;
  againstBabylon(name, name, G.createIcoSphere({ ...o }), B ? B.CreateIcoSphereVertexData({ ...o }) : null, o);
}

for (trial = 0; trial < TRIALS; trial++) {
  for (const c of CASES) {
    const options = c.draw();
    // An option set Babylon throws on must throw here too (the throw is what
    // is recorded, not its message).
    const attempt = (f) => {
      try {
        return f({ ...options });
      } catch (e) {
        return { threw: String(e?.message ?? e) };
      }
    };
    const ours = attempt(c.ours);
    const answer = (x) => (x.threw ? [true] : [false, ...flatData(x)]);
    if (B) {
      const theirs = attempt(c.theirs);
      if (ours.threw || theirs.threw) {
        sameValue(c.name, !!ours.threw === !!theirs.threw, options, `ours ${ours.threw ?? "built"}, Babylon's ${theirs.threw ?? "built"}`);
      } else {
        sameData(c.name, ours, theirs, options);
      }
      ledger.answer(group(c.name), answer(theirs));
    } else {
      ledger.answer(group(c.name), answer(ours));
    }
  }
  for (const run of Object.values(BUFFER_CASES)) run();
}

console.log(
  `geometry-check: ${checks} comparisons ${B ? "against Babylon live and " : ""}of ours with ours, over ${CASES.length + Object.keys(BUFFER_CASES).length} cases, ${TRIALS} trials each`,
);
if (missing.length) console.log(`UNCOVERED (an export with no case): ${missing.join(", ")}`);
if (failures) console.log(`FAILED: ${failures} differing answers in ${[...failedNames.keys()].join(", ")}`);
const failed = ledger.finish();
process.exit(failures || missing.length || failed ? 1 : 0);
