/**
 * math-check.mjs — proves `src/math/` gives Babylon's answers BIT FOR BIT.
 *
 *   node scripts/math-check.mjs [--perturb]
 *
 * `src/math/` is a port of the subset of Babylon's `Vector2`, `Vector3`,
 * `Vector4`, `Quaternion`, `Matrix`, `Color3`, `Color4`, `Plane` and
 * `Frustum` the tree calls, and
 * its whole claim is that a file moved onto it computes exactly what it did:
 * every oracle the exit is graded by compares bits, so "close" is a failure.
 * This runs every ported method on seeded random inputs and compares each
 * output number with Babylon's by its bits — a -0 against a +0 fails, and so
 * does one NaN against a number. Inputs include zeros, negative zeros, exact
 * right angles and identity-flagged matrices, because those are where
 * Babylon's shortcuts take a different path from the arithmetic.
 *
 * **Babylon's answers are a RECORDED TABLE** (`scripts/tables/math-check.json`,
 * `scripts/lib/babylonTable.mjs`; `BABYLON_EXIT.md` row "X6.1, the copy
 * checks"): each case's answers over a block of a thousand trials are one
 * digest of Babylon 9.28's, captured by `--record` while the package was
 * installed (X6.1i's first commit, which also compared every answer live; the
 * arm went with the package in the next), and a run holds ours to them. So the inputs may never change: the seed, the
 * trial count and every draw below are part of what was recorded.
 * `--perturb` is the negative test: one value in the first answer of every
 * group moved one ULP, and every group must then fail.
 *
 * **A method added to `src/math/` owes a case here**, and the script fails if
 * one of the classes has a member no case names (`COVERED`), so it cannot
 * quietly fall behind — but since the package left (X6.1i) nothing can record
 * the new case's answers, so a new member has no bit-level oracle: it is
 * proven some other way, or ported with the case while a Babylon is at hand.
 *
 * Plain Node: `src/math/` names its `.ts` imports and holds only erasable
 * syntax.
 */
import * as M from "../src/math/index.ts";
import { Ledger } from "./lib/babylonTable.mjs";
import { mulberry32 } from "../src/world/rng.ts";

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : dflt;
};
const TRIALS = arg("--trials", 20000);
const SEED = arg("--seed", 1);
/** A table group is one case over this many trials. */
const BLOCK = 1000;
const ledger = new Ledger("math-check", { seed: SEED, trials: TRIALS, block: BLOCK }, {
  perturb: args.includes("--perturb") && "output",
});
const rand = mulberry32(SEED);

// ---------------------------------------------------------------------------
// Inputs

const SPECIAL = [0, -0, 1, -1, 0.5, Math.PI / 2, -Math.PI / 2, Math.PI, 1e-7, 1e6];
/** A number that is sometimes one of the shortcuts' edges and mostly not. */
function num(scale = 10) {
  const r = rand();
  if (r < 0.12) return SPECIAL[Math.floor(rand() * SPECIAL.length)];
  return (rand() * 2 - 1) * scale;
}
const angle = () => (rand() < 0.15 ? SPECIAL[Math.floor(rand() * SPECIAL.length)] : (rand() * 2 - 1) * 4);
const v3 = () => [num(), num(), num()];
const unit3 = () => {
  const [x, y, z] = [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1];
  const l = Math.hypot(x, y, z) || 1;
  return rand() < 0.1 ? [0, 1, 0] : [x / l, y / l, z / l];
};
const quat = () => {
  if (rand() < 0.1) return [0, 0, 0, 1];
  const q = [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1];
  const l = Math.hypot(...q) || 1;
  return rand() < 0.2 ? q : q.map((c) => c / l);
};
const col = () => [rand(), rand(), rand()];
const hexes = ["#000000", "#FFFFFF", "#7fa3c2", "#12ab34cd", "#zz", "nope", "#abc", "#0a0b0c0d"];

/**
 * A matrix recipe, built identically on both sides — so its identity flag is
 * the same on both, which is what the shortcuts read.
 */
function matRecipe() {
  const pick = Math.floor(rand() * 9);
  switch (pick) {
    case 0: return { k: "Identity" };
    case 1: return { k: "RotationX", a: angle() };
    case 2: return { k: "RotationY", a: angle() };
    case 3: return { k: "RotationZ", a: angle() };
    case 4: return { k: "Translation", t: rand() < 0.2 ? [0, 0, 0] : v3() };
    case 5: return { k: "Compose", s: rand() < 0.2 ? [1, 1, 1] : v3(), q: quat(), t: v3() };
    case 6: return { k: "RotationYawPitchRoll", a: [angle(), angle(), angle()] };
    case 7: return { k: "RotationAxis", axis: v3(), a: angle() };
    default: return { k: "FromValues", m: Array.from({ length: 16 }, () => num()) };
  }
}
function build(L, r) {
  switch (r.k) {
    case "Identity": return L.Matrix.Identity();
    case "RotationX": return L.Matrix.RotationX(r.a);
    case "RotationY": return L.Matrix.RotationY(r.a);
    case "RotationZ": return L.Matrix.RotationZ(r.a);
    case "Translation": return L.Matrix.Translation(...r.t);
    case "Compose": return L.Matrix.Compose(new L.Vector3(...r.s), new L.Quaternion(...r.q), new L.Vector3(...r.t));
    case "RotationYawPitchRoll": return L.Matrix.RotationYawPitchRoll(...r.a);
    case "RotationAxis": return L.Matrix.RotationAxis(new L.Vector3(...r.axis), r.a);
    case "FromValues": return L.Matrix.FromValues(...r.m);
  }
}

// ---------------------------------------------------------------------------
// Reading an answer as a list of numbers

function flat(x) {
  if (x === undefined || x === null) return [String(x)];
  if (typeof x === "number" || typeof x === "boolean" || typeof x === "string") return [x];
  if (Array.isArray(x)) return x.flatMap(flat);
  if (ArrayBuffer.isView(x)) return Array.from(x);
  if ("m" in x && x.m && x.m.length === 16) return Array.from(x.m);
  if ("w" in x) return [x.x, x.y, x.z, x.w];
  if ("a" in x) return [x.r, x.g, x.b, x.a];
  if ("r" in x) return [x.r, x.g, x.b];
  if ("x" in x && !("z" in x)) return [x.x, x.y];
  if ("x" in x) return [x.x, x.y, x.z];
  throw new Error(`cannot read ${x}`);
}

// ---------------------------------------------------------------------------
// The cases. Each is run once per trial on fresh inputs; `run(L)` builds its
// inputs from the plain arrays and returns what to compare.

const CASES = {};
const COVERED = new Set();
/** `names` are the members the case exercises, as "Class.Static" or "Class#method". */
function caseOf(names, make) {
  for (const n of names) COVERED.add(n);
  CASES[names.join(" ")] = make;
}

const V = (L, a) => new L.Vector3(...a);
const Q = (L, a) => new L.Quaternion(...a);
const C3 = (L, a) => new L.Color3(...a);

// Vector3, instance
caseOf(["Vector3#constructor", "Vector3#toArray"], () => { const a = v3(); return [a, (L) => { const o = [9, 9, 9, 9]; V(L, a).toArray(o, 1); return o; }]; });
caseOf(["Vector3#fromArray", "Vector3.FromArrayToRef"], () => { const a = [num(), num(), num(), num()]; return [a, (L) => new L.Vector3().fromArray(a, 1)]; });
caseOf(["Vector3#addInPlace"], () => { const a = v3(), b = v3(); return [[a, b], (L) => V(L, a).addInPlace(V(L, b))]; });
caseOf(["Vector3#addInPlaceFromFloats"], () => { const a = v3(), b = v3(); return [[a, b], (L) => V(L, a).addInPlaceFromFloats(...b)]; });
caseOf(["Vector3#add"], () => { const a = v3(), b = v3(); return [[a, b], (L) => V(L, a).add(V(L, b))]; });
caseOf(["Vector3#addToRef"], () => { const a = v3(), b = v3(); return [[a, b], (L) => V(L, a).addToRef(V(L, b), new L.Vector3())]; });
caseOf(["Vector3#subtractInPlace"], () => { const a = v3(), b = v3(); return [[a, b], (L) => V(L, a).subtractInPlace(V(L, b))]; });
caseOf(["Vector3#subtract"], () => { const a = v3(), b = v3(); return [[a, b], (L) => V(L, a).subtract(V(L, b))]; });
caseOf(["Vector3#subtractToRef", "Vector3#subtractFromFloatsToRef"], () => { const a = v3(), b = v3(); return [[a, b], (L) => V(L, a).subtractToRef(V(L, b), new L.Vector3())]; });
caseOf(["Vector3#multiply", "Vector3#multiplyByFloats"], () => { const a = v3(), b = v3(); return [[a, b], (L) => V(L, a).multiply(V(L, b))]; });
caseOf(["Vector3#divide"], () => { const a = v3(), b = v3(); return [[a, b], (L) => V(L, a).divide(V(L, b))]; });
caseOf(["Vector3#negate"], () => { const a = v3(); return [a, (L) => V(L, a).negate()]; });
caseOf(["Vector3#scaleInPlace"], () => { const a = v3(), s = num(); return [[a, s], (L) => V(L, a).scaleInPlace(s)]; });
caseOf(["Vector3#scale"], () => { const a = v3(), s = num(); return [[a, s], (L) => V(L, a).scale(s)]; });
caseOf(["Vector3#scaleToRef"], () => { const a = v3(), s = num(); return [[a, s], (L) => V(L, a).scaleToRef(s, new L.Vector3())]; });
caseOf(["Vector3#equals"], () => { const a = v3(), b = rand() < 0.5 ? a : v3(); return [[a, b], (L) => V(L, a).equals(V(L, b))]; });
caseOf(["Vector3#equalsWithEpsilon"], () => { const a = v3(), b = a.map((c) => c + (rand() - 0.5) * 0.004); const e = rand() < 0.5 ? undefined : rand() * 0.003; return [[a, b, e], (L) => V(L, a).equalsWithEpsilon(V(L, b), e)]; });
caseOf(["Vector3#minimizeInPlace", "Vector3#minimizeInPlaceFromFloats"], () => { const a = v3(), b = v3(); return [[a, b], (L) => V(L, a).minimizeInPlace(V(L, b))]; });
caseOf(["Vector3#maximizeInPlace", "Vector3#maximizeInPlaceFromFloats"], () => { const a = v3(), b = v3(); return [[a, b], (L) => V(L, a).maximizeInPlace(V(L, b))]; });
caseOf(["Vector3#length", "Vector3#lengthSquared"], () => { const a = v3(); return [a, (L) => [V(L, a).length(), V(L, a).lengthSquared()]]; });
caseOf(["Vector3#normalize", "Vector3#normalizeFromLength"], () => { const a = rand() < 0.1 ? [0, 0, 0] : v3(); return [a, (L) => V(L, a).normalize()]; });
caseOf(["Vector3#normalizeToNew", "Vector3#normalizeToRef"], () => { const a = rand() < 0.1 ? [0, 1, 0] : v3(); return [a, (L) => V(L, a).normalizeToNew()]; });
caseOf(["Vector3#rotateByQuaternionToRef"], () => { const a = v3(), q = quat(); return [[a, q], (L) => V(L, a).rotateByQuaternionToRef(Q(L, q), new L.Vector3())]; });
caseOf(["Vector3#clone"], () => { const a = v3(); return [a, (L) => V(L, a).clone()]; });
caseOf(["Vector3#copyFrom", "Vector3#copyFromFloats"], () => { const a = v3(); return [a, (L) => new L.Vector3().copyFrom(V(L, a))]; });
caseOf(["Vector3#set"], () => { const a = v3(); return [a, (L) => new L.Vector3().set(...a)]; });
caseOf(["Vector3#setAll"], () => { const s = num(); return [s, (L) => new L.Vector3(1, 2, 3).setAll(s)]; });

// Vector3, static
caseOf(["Vector3.FromArray"], () => { const a = [num(), num(), num(), num()]; return [a, (L) => L.Vector3.FromArray(a, 1)]; });
caseOf(["Vector3.Zero", "Vector3.One", "Vector3.Up", "Vector3.Right", "Vector3.Forward", "Vector3.UpReadOnly", "Vector3.ZeroReadOnly"], () => [null, (L) => [L.Vector3.Zero(), L.Vector3.One(), L.Vector3.Up(), L.Vector3.Right(), L.Vector3.Forward(), L.Vector3.Forward(true), L.Vector3.UpReadOnly, L.Vector3.ZeroReadOnly]]);
caseOf(["Vector3.TransformCoordinates", "Vector3.TransformCoordinatesToRef", "Vector3.TransformCoordinatesFromFloatsToRef"], () => { const a = v3(), r = matRecipe(); return [[a, r], (L) => L.Vector3.TransformCoordinates(V(L, a), build(L, r))]; });
caseOf(["Vector3.TransformNormalToRef", "Vector3.TransformNormalFromFloatsToRef"], () => { const a = v3(), r = matRecipe(); return [[a, r], (L) => L.Vector3.TransformNormalToRef(V(L, a), build(L, r), new L.Vector3())]; });
caseOf(["Vector3.TransformNormal"], () => { const a = v3(), r = matRecipe(); return [[a, r], (L) => L.Vector3.TransformNormal(V(L, a), build(L, r))]; });
caseOf(["Vector3.LerpToRef"], () => { const a = v3(), b = v3(), t = num(1); return [[a, b, t], (L) => L.Vector3.LerpToRef(V(L, a), V(L, b), t, new L.Vector3())]; });
caseOf(["Vector3.Lerp"], () => { const a = v3(), b = v3(), t = num(1); return [[a, b, t], (L) => L.Vector3.Lerp(V(L, a), V(L, b), t)]; });
caseOf(["Vector3.Dot"], () => { const a = v3(), b = v3(); return [[a, b], (L) => L.Vector3.Dot(V(L, a), V(L, b))]; });
caseOf(["Vector3.Cross", "Vector3.CrossToRef"], () => { const a = v3(), b = v3(); return [[a, b], (L) => L.Vector3.Cross(V(L, a), V(L, b))]; });
caseOf(["Vector3.Distance", "Vector3.DistanceSquared"], () => { const a = v3(), b = v3(); return [[a, b], (L) => [L.Vector3.Distance(V(L, a), V(L, b)), L.Vector3.DistanceSquared(V(L, a), V(L, b))]]; });
caseOf(["Vector3.RotationFromAxis", "Vector3.RotationFromAxisToRef"], () => { const a = v3(), b = v3(), c = v3(); return [[a, b, c], (L) => L.Vector3.RotationFromAxis(V(L, a), V(L, b), V(L, c))]; });
caseOf(["Vector3.ProjectToRef"], () => {
  const a = v3(), w = matRecipe(), t = matRecipe(), vp = [num(100), num(100), 1 + rand() * 1000, 1 + rand() * 1000];
  return [[a, w, t, vp], (L) => {
    // Recorded with Babylon's `Viewport` and its last engine's depth range
    // stood in as WebGPU's [0, 1], which ours is.
    const view = { x: vp[0], y: vp[1], width: vp[2], height: vp[3] };
    return L.Vector3.ProjectToRef(V(L, a), build(L, w), build(L, t), view, new L.Vector3());
  }];
});

caseOf(["Vector3.NormalizeToRef"], () => { const a = rand() < 0.1 ? (rand() < 0.5 ? [0, 0, 0] : [0, 1, 0]) : v3(); return [a, (L) => L.Vector3.NormalizeToRef(V(L, a), new L.Vector3())]; });

// Vector2 / Vector4 — a shader's uniform holders (`CelShader`, `ShadowBindings`, …)
const v2 = () => [num(), num()];
const v4 = () => [num(), num(), num(), num()];
caseOf(["Vector2#constructor", "Vector2#toArray"], () => { const a = v2(); return [a, (L) => { const o = [9, 9, 9, 9]; new L.Vector2(...a).toArray(o, 1); return [o, new L.Vector2()]; }]; });
caseOf(["Vector2#copyFromFloats", "Vector2#set"], () => { const a = v2(); return [a, (L) => [new L.Vector2().copyFromFloats(...a), new L.Vector2(1, 2).set(...a)]]; });
caseOf(["Vector2#scaleInPlace", "Vector2#length"], () => { const a = v2(), s = num(); return [[a, s], (L) => [new L.Vector2(...a).scaleInPlace(s), new L.Vector2(...a).length()]]; });
caseOf(["Vector2#normalize", "Vector2#normalizeFromLength"], () => { const a = rand() < 0.1 ? (rand() < 0.5 ? [0, 0] : [0, 1]) : v2(); return [a, (L) => new L.Vector2(...a).normalize()]; });
caseOf(["Vector4#constructor", "Vector4#toArray"], () => { const a = v4(); return [a, (L) => { const o = [9, 9, 9, 9, 9, 9]; new L.Vector4(...a).toArray(o, 1); return [o, new L.Vector4()]; }]; });
caseOf(["Vector4#copyFrom", "Vector4#copyFromFloats", "Vector4#set"], () => { const a = v4(); return [a, (L) => [new L.Vector4().copyFrom(new L.Vector4(...a)), new L.Vector4().copyFromFloats(...a), new L.Vector4(1, 2, 3, 4).set(...a)]]; });

// Quaternion
caseOf(["Quaternion#constructor", "Quaternion#copyFrom"], () => { const q = quat(); return [q, (L) => new L.Quaternion().copyFrom(Q(L, q))]; });
caseOf(["Quaternion#copyFromFloats", "Quaternion#set"], () => { const q = quat(); return [q, (L) => new L.Quaternion().set(...q)]; });
caseOf(["Quaternion#scaleInPlace"], () => { const q = quat(), s = num(); return [[q, s], (L) => Q(L, q).scaleInPlace(s)]; });
caseOf(["Quaternion#multiplyToRef"], () => { const a = quat(), b = quat(); return [[a, b], (L) => Q(L, a).multiplyToRef(Q(L, b), new L.Quaternion())]; });
caseOf(["Quaternion#length", "Quaternion#lengthSquared"], () => { const q = quat(); return [q, (L) => [Q(L, q).length(), Q(L, q).lengthSquared()]]; });
caseOf(["Quaternion#normalize", "Quaternion#normalizeFromLength"], () => { const q = rand() < 0.1 ? [0, 0, 0, 0] : quat(); return [q, (L) => Q(L, q).normalize()]; });
caseOf(["Quaternion#toEulerAngles", "Quaternion#toEulerAnglesToRef"], () => {
  // The two gimbal branches need |y*z - x*w| near a half.
  const q = rand() < 0.2 ? [Math.SQRT1_2, 0, 0, rand() < 0.5 ? Math.SQRT1_2 : -Math.SQRT1_2] : quat();
  return [q, (L) => Q(L, q).toEulerAngles()];
});
caseOf(["Quaternion#toRotationMatrix", "Matrix.FromQuaternionToRef"], () => { const q = quat(); return [q, (L) => Q(L, q).toRotationMatrix(new L.Matrix())]; });
caseOf(["Quaternion.FromRotationMatrixToRef"], () => { const r = matRecipe(); return [r, (L) => L.Quaternion.FromRotationMatrixToRef(build(L, r), new L.Quaternion())]; });
caseOf(["Quaternion.Identity"], () => [null, (L) => L.Quaternion.Identity()]);
caseOf(["Quaternion.RotationAxisToRef"], () => { const a = v3(), t = angle(); return [[a, t], (L) => L.Quaternion.RotationAxisToRef(V(L, a), t, new L.Quaternion())]; });
caseOf(["Quaternion.FromEulerVector"], () => { const a = [angle(), angle(), angle()]; return [a, (L) => L.Quaternion.FromEulerVector(V(L, a))]; });
caseOf(["Quaternion.FromEulerVectorToRef"], () => { const a = [angle(), angle(), angle()]; return [a, (L) => L.Quaternion.FromEulerVectorToRef(V(L, a), new L.Quaternion(7, 7, 7, 7))]; });
caseOf(["Quaternion.FromUnitVectorsToRef"], () => { const a = unit3(); const b = rand() < 0.15 ? a.map((c) => -c) : unit3(); return [[a, b], (L) => L.Quaternion.FromUnitVectorsToRef(V(L, a), V(L, b), new L.Quaternion())]; });
caseOf(["Quaternion.RotationYawPitchRoll", "Quaternion.RotationYawPitchRollToRef"], () => { const a = [angle(), angle(), angle()]; return [a, (L) => L.Quaternion.RotationYawPitchRoll(...a)]; });
caseOf(["Quaternion.RotationQuaternionFromAxisToRef"], () => { const a = v3(), b = v3(), c = v3(); return [[a, b, c], (L) => L.Quaternion.RotationQuaternionFromAxisToRef(V(L, a), V(L, b), V(L, c), new L.Quaternion())]; });
caseOf(["Quaternion.SlerpToRef"], () => { const a = quat(), b = rand() < 0.1 ? a : quat(), t = rand(); return [[a, b, t], (L) => L.Quaternion.SlerpToRef(Q(L, a), Q(L, b), t, new L.Quaternion())]; });

// Matrix. Each case also reads the identity flag back through isIdentity(),
// since a flag that disagrees changes a LATER answer.
caseOf(["Matrix#constructor", "Matrix#m", "Matrix#isIdentity", "Matrix#markAsUpdated", "Matrix#_updateIdentityStatus",
  "Matrix.Identity", "Matrix.IdentityToRef", "Matrix.IdentityReadOnly", "Matrix.RotationX", "Matrix.RotationXToRef",
  "Matrix.RotationY", "Matrix.RotationYToRef", "Matrix.RotationZ", "Matrix.RotationZToRef", "Matrix.Translation",
  "Matrix.TranslationToRef", "Matrix.Compose", "Matrix.ComposeToRef", "Matrix.RotationYawPitchRoll",
  "Matrix.RotationYawPitchRollToRef", "Matrix.RotationAxis", "Matrix.RotationAxisToRef", "Matrix.FromValues",
  "Matrix.FromValuesToRef"], () => { const r = matRecipe(); return [r, (L) => { const m = build(L, r); return [m, m.isIdentity(), L.Matrix.IdentityReadOnly, L.Matrix.IdentityToRef(new L.Matrix()).isIdentity()]; }]; });
caseOf(["Matrix.FromArrayToRef"], () => {
  // Over an identity-flagged target as often as not: the copy must clear it.
  const a = Array.from({ length: 19 }, () => num()), off = Math.floor(rand() * 4), r = matRecipe();
  return [[a, off, r], (L) => { const m = L.Matrix.FromArrayToRef(a, off, build(L, r)); return [m, m.isIdentity()]; }];
});
caseOf(["Matrix#determinant"], () => { const r = matRecipe(); return [r, (L) => build(L, r).determinant()]; });
caseOf(["Matrix#asArray", "Matrix#copyToArray"], () => { const r = matRecipe(); return [r, (L) => { const o = new Array(18).fill(7); build(L, r).copyToArray(o, 2); return [o, build(L, r).asArray()]; }]; });
// In place (the camera's `setTarget`): the same answer and flag as into another.
caseOf(["Matrix#invert"], () => { const r = matRecipe(), r2 = matRecipe(); return [[r, r2], (L) => { const m = build(L, r).invert(); return [m, m.isIdentity(), m.multiply(build(L, r2))]; }]; });
caseOf(["Matrix#invertToRef", "invertMatrixToArray"], () => { const r = matRecipe(); return [r, (L) => { const out = build(L, r).invertToRef(new L.Matrix()); return [out, out.isIdentity()]; }]; });
caseOf(["Matrix#copyFrom"], () => { const r = matRecipe(); return [r, (L) => { const out = new L.Matrix().copyFrom(build(L, r)); return [out, out.isIdentity(), out.multiply(build(L, r))]; }]; });
caseOf(["Matrix#multiply", "Matrix#multiplyToRef", "Matrix#multiplyToArray"], () => { const a = matRecipe(), b = matRecipe(); return [[a, b], (L) => { const out = build(L, a).multiply(build(L, b)); return [out, out.isIdentity()]; }]; });
caseOf(["Matrix#decompose"], () => {
  const r = matRecipe(), which = Math.floor(rand() * 4);
  return [[r, which], (L) => {
    const s = new L.Vector3(), q = new L.Quaternion(), t = new L.Vector3();
    const m = build(L, r);
    const ok = which === 0 ? m.decompose(s, q, t) : which === 1 ? m.decompose(undefined, q, t) : which === 2 ? m.decompose(s) : m.decompose(s, q);
    return [ok, s, q, t];
  }];
});
caseOf(["Matrix.LookAtLHToRef"], () => {
  // A probe face's look (an axis step off the eye) as often as not, and the
  // degenerate up-along-the-look case the X-axis shortcut is for.
  const e = v3(), axis = Math.floor(rand() * 6), up = rand() < 0.8 ? [0, 1, 0] : v3();
  const t = rand() < 0.5 ? e.map((c, i) => c + (i === axis >> 1 ? (axis & 1 ? -1 : 1) : 0)) : v3();
  return [[e, t, up], (L) => { const m = L.Matrix.LookAtLHToRef(V(L, e), V(L, t), V(L, up), new L.Matrix()); return [m, m.isIdentity()]; }];
});
caseOf(["Matrix.PerspectiveFovLHToRef", "NDC_TO_HALF_Z_RANGE"], () => {
  const fov = rand() < 0.5 ? Math.PI / 2 : rand() * 3, aspect = rand() < 0.5 ? 1 : 0.2 + rand() * 3;
  const n = rand() < 0.1 ? 0 : rand() * 2, f = rand() < 0.1 ? 0 : n + rand() * 5000;
  const fixed = rand() < 0.8, half = rand() < 0.8, tilt = rand() < 0.8 ? 0 : angle(), rev = rand() < 0.2;
  return [[fov, aspect, n, f, fixed, half, tilt, rev], (L) => { const m = L.Matrix.PerspectiveFovLHToRef(fov, aspect, n, f, new L.Matrix(), fixed, half, tilt, rev); return [m, m.isIdentity()]; }];
});
// The pivot path's two (`rigJoints.ts`): a scale of one is flagged identity,
// which the next product's shortcut reads, so each is multiplied after.
caseOf(["Matrix.ScalingToRef"], () => { const s = rand() < 0.3 ? [1, 1, 1] : v3(), r = matRecipe(); return [[s, r], (L) => { const m = L.Matrix.ScalingToRef(...s, new L.Matrix()); return [m, m.multiply(build(L, r)), build(L, r).multiply(m), m.isIdentity()]; }]; });
caseOf(["Matrix#addTranslationFromFloats"], () => { const r = matRecipe(), t = rand() < 0.2 ? [0, 0, 0] : v3(), r2 = matRecipe(); return [[r, t, r2], (L) => { const m = build(L, r).addTranslationFromFloats(...t); return [m, m.multiply(build(L, r2)), m.isIdentity()]; }]; });
// The translation's three (`Sky`'s moon): each read back through a product,
// since the write clears the identity flag the shortcuts read.
caseOf(["Matrix#setTranslationFromFloats", "Matrix#setTranslation"], () => { const r = matRecipe(), t = rand() < 0.2 ? [0, 0, 0] : v3(), r2 = matRecipe(), which = rand() < 0.5; return [[r, t, r2, which], (L) => { const m = which ? build(L, r).setTranslationFromFloats(...t) : build(L, r).setTranslation(V(L, t)); return [m, m.multiply(build(L, r2)), m.isIdentity()]; }]; });
caseOf(["Matrix#getTranslationToRef"], () => { const r = matRecipe(); return [r, (L) => build(L, r).getTranslationToRef(new L.Vector3(7, 7, 7))]; });
// `shadowWindow.ts`' light projection: both depth ranges, and the identity
// flag the result is left with (2/w, 2/h, 2/(f-n) all one only at w=h=2).
caseOf(["Matrix.OrthoLHToRef"], () => {
  const w = rand() < 0.1 ? 2 : rand() * 400, h = rand() < 0.1 ? 2 : rand() * 400;
  const n = rand() < 0.2 ? (rand() < 0.5 ? -1 : 0) : num(), f = rand() < 0.2 ? 1 : n + rand() * 3000, half = rand() < 0.7 ? true : rand() < 0.5 ? false : undefined;
  const r2 = matRecipe();
  return [[w, h, n, f, half, r2], (L) => { const m = L.Matrix.OrthoLHToRef(w, h, n, f, new L.Matrix(), half); return [m, m.isIdentity(), m.multiply(build(L, r2))]; }];
});
caseOf(["Matrix.FromXYZAxesToRef"], () => { const a = v3(), b = v3(), c = v3(); return [[a, b, c], (L) => L.Matrix.FromXYZAxesToRef(V(L, a), V(L, b), V(L, c), new L.Matrix())]; });

// Color3 / Color4
caseOf(["Color3#constructor", "Color3#toColor4"], () => { const a = col(), al = rand() < 0.3 ? undefined : rand(); return [[a, al], (L) => C3(L, a).toColor4(al)]; });
caseOf(["Color3#multiply", "Color3#multiplyToRef"], () => { const a = col(), b = col(); return [[a, b], (L) => [C3(L, a).multiply(C3(L, b)), C3(L, a).multiplyToRef(C3(L, b), new L.Color3())]]; });
caseOf(["Color3#equals"], () => { const a = col(), b = rand() < 0.5 ? a : col(); return [[a, b], (L) => C3(L, a).equals(C3(L, b))]; });
caseOf(["Color3#scale", "Color3#scaleInPlace"], () => { const a = col(), s = num(2); return [[a, s], (L) => [C3(L, a).scale(s), C3(L, a).scaleInPlace(s)]]; });
caseOf(["Color3#addInPlace", "Color3#addToRef"], () => { const a = col(), b = col(); return [[a, b], (L) => [C3(L, a).addInPlace(C3(L, b)), C3(L, a).addToRef(C3(L, b), new L.Color3())]]; });
caseOf(["Color3#clone", "Color3#copyFrom", "Color3#copyFromFloats", "Color3#set"], () => { const a = col(); return [a, (L) => [C3(L, a).clone(), new L.Color3().copyFrom(C3(L, a)), new L.Color3().set(...a)]]; });
caseOf(["Color3#toArray"], () => { const a = col(); return [a, (L) => { const o = [9, 9, 9, 9, 9]; C3(L, a).toArray(o, 1); C3(L, a).toArray(o); return o; }]; });
caseOf(["Color3#toHexString"], () => { const a = rand() < 0.2 ? [0, 1, 15 / 255] : col(); return [a, (L) => C3(L, a).toHexString()]; });
caseOf(["Color3#fromHexString", "Color3.FromHexString"], () => { const h = rand() < 0.5 ? hexes[Math.floor(rand() * hexes.length)] : "#" + Math.floor(rand() * 0xffffff).toString(16).padStart(6, "0"); return [h, (L) => L.Color3.FromHexString(h)]; });
caseOf(["Color3.Lerp", "Color3.LerpToRef"], () => { const a = col(), b = col(), t = rand(); return [[a, b, t], (L) => L.Color3.Lerp(C3(L, a), C3(L, b), t)]; });
caseOf(["Color3.Black", "Color3.White"], () => [null, (L) => [L.Color3.Black(), L.Color3.White()]]);
caseOf(["Color4#constructor", "Color4#copyFromFloats", "Color4#set"], () => { const a = [...col(), rand()]; return [a, (L) => [new L.Color4(...a), new L.Color4().set(...a)]]; });
caseOf(["Color4#fromHexString", "Color4.FromHexString"], () => { const h = hexes[Math.floor(rand() * hexes.length)]; return [h, (L) => L.Color4.FromHexString(h)]; });

// Plane / Frustum (X6.1f: the frame's six planes, `SceneFrame`, and the
// grass's own): off a camera's transform (a view times a projection) as often
// as not, and off any matrix the rest — a degenerate row's zero norm included.
const camTransform = (L, e, t, up, fov, aspect, n, f) => L.Matrix.LookAtLHToRef(V(L, e), V(L, t), V(L, up), new L.Matrix()).multiply(L.Matrix.PerspectiveFovLHToRef(fov, aspect, n, f, new L.Matrix(), true, true));
caseOf(["Plane#constructor", "Plane#normalize"], () => { const a = rand() < 0.1 ? [0, 0, 0, num()] : [num(), num(), num(), num()]; return [a, (L) => { const p = new L.Plane(...a).normalize(); return [p.normal, p.d]; }]; });
caseOf(["Frustum#constructor", "Frustum.GetPlanes", "Frustum.GetPlanesToRef", "Frustum.GetNearPlaneToRef", "Frustum.GetFarPlaneToRef", "Frustum.GetLeftPlaneToRef", "Frustum.GetRightPlaneToRef", "Frustum.GetTopPlaneToRef", "Frustum.GetBottomPlaneToRef"], () => {
  const cam = rand() < 0.6;
  const e = v3(), t = v3(), up = rand() < 0.8 ? [0, 1, 0] : v3(), fov = 0.1 + rand() * 1.5, aspect = 0.3 + rand() * 3, n = 0.05 + rand(), f = n + rand() * 10000, r = matRecipe();
  return [[cam, e, t, up, fov, aspect, n, f, r], (L) => {
    const m = cam ? camTransform(L, e, t, up, fov, aspect, n, f) : build(L, r);
    const fresh = L.Frustum.GetPlanes(m);
    const into = [0, 1, 2, 3, 4, 5].map(() => new L.Plane(9, 9, 9, 9));
    L.Frustum.GetPlanesToRef(m, into);
    return [...fresh, ...into].flatMap((p) => [p.normal, p.d]);
  }];
});

// ---------------------------------------------------------------------------
// Coverage: every member of every class has a case.

const missing = [];
for (const cls of ["Vector2", "Vector3", "Vector4", "Quaternion", "Matrix", "Color3", "Color4", "Plane", "Frustum"]) {
  const C = M[cls];
  const statics = Object.getOwnPropertyNames(C).filter((n) => !["length", "name", "prototype"].includes(n));
  const methods = Object.getOwnPropertyNames(C.prototype);
  for (const n of statics) if (!COVERED.has(`${cls}.${n}`)) missing.push(`${cls}.${n}`);
  for (const n of methods) if (!COVERED.has(`${cls}#${n}`)) missing.push(`${cls}#${n}`);
}

// A Babylon object handed to ours had to work too, the direction the header
// promised was safe: recorded with Babylon's objects on its own side, and
// since the package left (X6.1i) answered by ours on our own objects.
caseOf(["mixed"], () => { const a = v3(), b = v3(), q = quat(); return [[a, b, q], (L) => [L.Vector3.Cross(V(L, a), V(L, b)), V(L, a).rotateByQuaternionToRef(Q(L, q), new L.Vector3())]]; });

for (let t = 0; t < TRIALS; t++) {
  const block = Math.floor(t / BLOCK);
  for (const [name, make] of Object.entries(CASES)) {
    const [, run] = make();
    ledger.answer(`${name} @${block}`, flat(run(M)));
  }
}

if (missing.length) console.log(`UNCOVERED (a member with no case): ${missing.join(", ")}`);
const failed = ledger.finish();
process.exit(missing.length || failed ? 1 : 0);
