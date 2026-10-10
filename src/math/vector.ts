/**
 * vector.ts — `Vector3`, `Quaternion` and `Matrix`: the subset of Babylon's
 * classes of those names that the tree calls, under the same names and with
 * the same signatures, so that moving a file off Babylon's math is an import
 * change and nothing else.
 * Owns: the three classes, `Epsilon`, the `*Like` shapes their read-only
 * parameters take, and `Vector3Ref`, the shape of one handed in to be written.
 * Owns NO state beyond three module scratch values and two read-only
 * constants, NO tunable, and imports NOTHING — not `@babylonjs/core`, not
 * `CONFIG` — so a Node script can load it by type stripping, and so can the
 * server.
 *
 * ## The one rule: the same bits as Babylon
 *
 * Every method is Babylon 9.28's, operation for operation (`Maths/
 * math.vector.pure.js` and `ThinMaths/thinMath.matrix.functions.js`): the
 * same evaluation order, the same shortcuts and the same scratch. A rewrite
 * that is "mathematically the same" is not the same in floating point, and
 * the oracles that grade the exit (`kit:hash`, `merge:hash`, `parity`, the
 * fight hash) compare bits. So:
 *
 *   - **`Matrix` stores its sixteen numbers in a `Float32Array`**, as
 *     Babylon's does unless an engine is built with `useHighPrecisionMatrix`
 *     (none in this tree is). Every write rounds to float32 exactly where
 *     Babylon's would.
 *   - **`Matrix` keeps Babylon's identity flag**, because `multiplyToRef`,
 *     `invertToRef`, `determinant` and `decompose` take a shortcut on it, and
 *     the shortcut differs from the full arithmetic in the sign of a zero.
 *     Babylon's change counter (`updateFlag`) and its 3x2 identity flag are
 *     NOT kept: nothing in the tree reads either, and neither moves a number.
 *   - **A method nobody calls is not here.** Add one by copying Babylon's body
 *     for it, not by writing it fresh — and grep the tree before assuming a
 *     method is unused.
 *
 * ## Mixing with Babylon's classes
 *
 * Babylon's `Vector3` keeps its coordinates in `_x`/`_y`/`_z` behind `x`/`y`/
 * `z` accessors, and its own methods read the underscored fields. These
 * classes keep plain `x`/`y`/`z` fields and read only those. So:
 *
 *   - **One of these may NEVER be handed to a Babylon method** — Babylon would
 *     read `_x` off it, get `undefined`, and write NaN without a word. The
 *     types refuse it (these lack most of Babylon's members), and the crossing
 *     is `src/math/babylon.ts`, which copies.
 *   - **Nor is a Babylon vector one of these**, and the types refuse that too:
 *     called as one, its `add` would be handed a vector of ours and read `_x`
 *     off it. What a Babylon vector CAN be is a `Vector3Like` (read) or a
 *     `Vector3Ref` (written through `set` and the fields): every method here
 *     reads its other vectors through `x`/`y`/`z` alone, which both libraries'
 *     accessors answer. So a function written over this module that a caller
 *     still on Babylon's math must reach takes those two types, never
 *     `Vector3` — the world's data layer does (`NavGrid.steer`,
 *     `RayWorld.castRound`, `ObstacleField.resolve`).
 *
 * `Matrix` keeps its identity flag private, which makes its type nominal; a
 * read-only matrix parameter is typed `MatrixLike` (Babylon's `IMatrixLike`:
 * anything with `m`), so a Babylon matrix can still be READ by these
 * functions. Colours keep plain fields in both libraries (`color.ts`).
 *
 * **`ProjectToRef` assumes WebGPU's depth range** ([0, 1]), where Babylon asks
 * the last engine created. The game has one engine and it is WebGPU.
 *
 * ## Licence
 *
 * The method bodies are copied from Babylon.js 9.28, which is licensed under
 * the Apache License, Version 2.0 (`node_modules/@babylonjs/core/license.md`;
 * https://www.apache.org/licenses/LICENSE-2.0). "Babylon.js — Copyright 2023
 * The Babylon.js team" (its NOTICE). Changes from the original: plain fields
 * in place of dirty-tracked accessors, the change counter and 3x2 identity
 * flag removed, `ProjectToRef` fixed to a [0, 1] depth range, `decompose`
 * without its scaling-node argument, and the subset trimmed to what this tree
 * calls.
 */

/** Babylon's `Epsilon`: the default tolerance of `equalsWithEpsilon`. */
export const Epsilon = 0.001;

/** Anything with three coordinates — a Babylon vector included. */
export interface Vector3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * A vector handed in to be WRITTEN, from either library: its fields, and the
 * methods that take nothing but numbers. Those are exactly what is safe on a
 * Babylon vector from here (the header), so a function that only writes its
 * `into` this way can serve a caller still on Babylon's math. Generic over
 * the caller's own class wherever it is handed back, so that caller keeps its
 * type.
 */
export interface Vector3Ref {
  x: number;
  y: number;
  z: number;
  set(x: number, y: number, z: number): this;
  setAll(v: number): this;
  copyFromFloats(x: number, y: number, z: number): this;
}

/** Anything with four quaternion components — a Babylon quaternion included. */
export interface QuaternionLike {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

/** Babylon's `IMatrixLike`: anything whose sixteen numbers can be READ. */
export interface MatrixLike {
  readonly m: ArrayLike<number>;
}

/** Babylon's `Viewport`, as far as `ProjectToRef` reads it. */
export interface ViewportLike {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function withinEpsilon(a: number, b: number, epsilon: number): boolean {
  return Math.abs(a - b) <= epsilon;
}

// ---------------------------------------------------------------------------
// Vector3

export class Vector3 {
  x: number;
  y: number;
  z: number;

  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  toArray(array: number[] | Float32Array, index = 0): this {
    array[index] = this.x;
    array[index + 1] = this.y;
    array[index + 2] = this.z;
    return this;
  }

  fromArray(array: ArrayLike<number>, offset = 0): this {
    Vector3.FromArrayToRef(array, offset, this);
    return this;
  }

  addInPlace(otherVector: Vector3Like): this {
    this.x += otherVector.x;
    this.y += otherVector.y;
    this.z += otherVector.z;
    return this;
  }

  addInPlaceFromFloats(x: number, y: number, z: number): this {
    this.x += x;
    this.y += y;
    this.z += z;
    return this;
  }

  add(otherVector: Vector3Like): Vector3 {
    return new Vector3(this.x + otherVector.x, this.y + otherVector.y, this.z + otherVector.z);
  }

  addToRef<T extends Vector3>(otherVector: Vector3Like, result: T): T {
    result.x = this.x + otherVector.x;
    result.y = this.y + otherVector.y;
    result.z = this.z + otherVector.z;
    return result;
  }

  subtractInPlace(otherVector: Vector3Like): this {
    this.x -= otherVector.x;
    this.y -= otherVector.y;
    this.z -= otherVector.z;
    return this;
  }

  subtract(otherVector: Vector3Like): Vector3 {
    return new Vector3(this.x - otherVector.x, this.y - otherVector.y, this.z - otherVector.z);
  }

  subtractToRef<T extends Vector3>(otherVector: Vector3Like, result: T): T {
    return this.subtractFromFloatsToRef(otherVector.x, otherVector.y, otherVector.z, result);
  }

  subtractFromFloatsToRef<T extends Vector3>(x: number, y: number, z: number, result: T): T {
    result.x = this.x - x;
    result.y = this.y - y;
    result.z = this.z - z;
    return result;
  }

  negate(): Vector3 {
    return new Vector3(-this.x, -this.y, -this.z);
  }

  scaleInPlace(scale: number): this {
    this.x *= scale;
    this.y *= scale;
    this.z *= scale;
    return this;
  }

  scale(scale: number): Vector3 {
    return new Vector3(this.x * scale, this.y * scale, this.z * scale);
  }

  scaleToRef<T extends Vector3>(scale: number, result: T): T {
    result.x = this.x * scale;
    result.y = this.y * scale;
    result.z = this.z * scale;
    return result;
  }

  equals(otherVector: Vector3Like): boolean {
    return !!otherVector && this.x === otherVector.x && this.y === otherVector.y && this.z === otherVector.z;
  }

  equalsWithEpsilon(otherVector: Vector3Like, epsilon = Epsilon): boolean {
    return (
      !!otherVector &&
      withinEpsilon(this.x, otherVector.x, epsilon) &&
      withinEpsilon(this.y, otherVector.y, epsilon) &&
      withinEpsilon(this.z, otherVector.z, epsilon)
    );
  }

  minimizeInPlace(other: Vector3Like): this {
    return this.minimizeInPlaceFromFloats(other.x, other.y, other.z);
  }

  maximizeInPlace(other: Vector3Like): this {
    return this.maximizeInPlaceFromFloats(other.x, other.y, other.z);
  }

  minimizeInPlaceFromFloats(x: number, y: number, z: number): this {
    if (x < this.x) this.x = x;
    if (y < this.y) this.y = y;
    if (z < this.z) this.z = z;
    return this;
  }

  maximizeInPlaceFromFloats(x: number, y: number, z: number): this {
    if (x > this.x) this.x = x;
    if (y > this.y) this.y = y;
    if (z > this.z) this.z = z;
    return this;
  }

  length(): number {
    return Math.sqrt(this.lengthSquared());
  }

  lengthSquared(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  normalize(): this {
    return this.normalizeFromLength(this.length());
  }

  rotateByQuaternionToRef<T extends Vector3>(quaternion: QuaternionLike, result: T): T {
    Matrix.FromQuaternionToRef(quaternion, TMP_MATRIX[0]);
    Vector3.TransformCoordinatesToRef(this, TMP_MATRIX[0], result);
    return result;
  }

  normalizeFromLength(len: number): this {
    if (len === 0 || len === 1.0) {
      return this;
    }
    return this.scaleInPlace(1.0 / len);
  }

  normalizeToNew(): Vector3 {
    return this.normalizeToRef(new Vector3());
  }

  normalizeToRef<T extends Vector3>(result: T): T {
    const len = this.length();
    if (len === 0 || len === 1.0) {
      result.x = this.x;
      result.y = this.y;
      result.z = this.z;
      return result;
    }
    return this.scaleToRef(1.0 / len, result);
  }

  clone(): Vector3 {
    return new Vector3(this.x, this.y, this.z);
  }

  copyFrom(source: Vector3Like): this {
    return this.copyFromFloats(source.x, source.y, source.z);
  }

  copyFromFloats(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  set(x: number, y: number, z: number): this {
    return this.copyFromFloats(x, y, z);
  }

  setAll(v: number): this {
    this.x = this.y = this.z = v;
    return this;
  }

  static FromArray(array: ArrayLike<number>, offset = 0): Vector3 {
    return new Vector3(array[offset], array[offset + 1], array[offset + 2]);
  }

  static FromArrayToRef<T extends Vector3>(array: ArrayLike<number>, offset: number, result: T): T {
    result.x = array[offset];
    result.y = array[offset + 1];
    result.z = array[offset + 2];
    return result;
  }

  static Zero(): Vector3 {
    return new Vector3(0.0, 0.0, 0.0);
  }

  static One(): Vector3 {
    return new Vector3(1.0, 1.0, 1.0);
  }

  static Up(): Vector3 {
    return new Vector3(0.0, 1.0, 0.0);
  }

  /** A shared (0, 1, 0). Never write to it. */
  static get UpReadOnly(): Readonly<Vector3> {
    return UP_READ_ONLY;
  }

  /** A shared (0, 0, 0). Never write to it. */
  static get ZeroReadOnly(): Readonly<Vector3> {
    return ZERO_READ_ONLY;
  }

  static Forward(rightHandedSystem = false): Vector3 {
    return new Vector3(0.0, 0.0, rightHandedSystem ? -1.0 : 1.0);
  }

  static Right(): Vector3 {
    return new Vector3(1.0, 0.0, 0.0);
  }

  static TransformCoordinates(vector: Vector3Like, transformation: MatrixLike): Vector3 {
    const result = Vector3.Zero();
    Vector3.TransformCoordinatesToRef(vector, transformation, result);
    return result;
  }

  static TransformCoordinatesToRef<T extends Vector3>(vector: Vector3Like, transformation: MatrixLike, result: T): T {
    Vector3.TransformCoordinatesFromFloatsToRef(vector.x, vector.y, vector.z, transformation, result);
    return result;
  }

  static TransformCoordinatesFromFloatsToRef<T extends Vector3>(
    x: number,
    y: number,
    z: number,
    transformation: MatrixLike,
    result: T,
  ): T {
    const m = transformation.m;
    const rx = x * m[0] + y * m[4] + z * m[8] + m[12];
    const ry = x * m[1] + y * m[5] + z * m[9] + m[13];
    const rz = x * m[2] + y * m[6] + z * m[10] + m[14];
    const rw = 1 / (x * m[3] + y * m[7] + z * m[11] + m[15]);
    result.x = rx * rw;
    result.y = ry * rw;
    result.z = rz * rw;
    return result;
  }

  static TransformNormalToRef<T extends Vector3>(vector: Vector3Like, transformation: MatrixLike, result: T): T {
    Vector3.TransformNormalFromFloatsToRef(vector.x, vector.y, vector.z, transformation, result);
    return result;
  }

  static TransformNormalFromFloatsToRef<T extends Vector3>(
    x: number,
    y: number,
    z: number,
    transformation: MatrixLike,
    result: T,
  ): T {
    const m = transformation.m;
    result.x = x * m[0] + y * m[4] + z * m[8];
    result.y = x * m[1] + y * m[5] + z * m[9];
    result.z = x * m[2] + y * m[6] + z * m[10];
    return result;
  }

  static LerpToRef<T extends Vector3>(start: Vector3Like, end: Vector3Like, amount: number, result: T): T {
    result.x = start.x + (end.x - start.x) * amount;
    result.y = start.y + (end.y - start.y) * amount;
    result.z = start.z + (end.z - start.z) * amount;
    return result;
  }

  static Dot(left: Vector3Like, right: Vector3Like): number {
    return left.x * right.x + left.y * right.y + left.z * right.z;
  }

  static Cross(left: Vector3Like, right: Vector3Like): Vector3 {
    const result = new Vector3();
    Vector3.CrossToRef(left, right, result);
    return result;
  }

  static CrossToRef<T extends Vector3>(left: Vector3Like, right: Vector3Like, result: T): T {
    const x = left.y * right.z - left.z * right.y;
    const y = left.z * right.x - left.x * right.z;
    const z = left.x * right.y - left.y * right.x;
    result.copyFromFloats(x, y, z);
    return result;
  }

  /**
   * Projects `vector` through `world`, then `transform`, then the viewport —
   * Babylon's, with the depth range fixed at WebGPU's [0, 1] (the header).
   */
  static ProjectToRef<T extends Vector3>(
    vector: Vector3Like,
    world: Matrix,
    transform: Matrix,
    viewport: ViewportLike,
    result: T,
  ): T {
    const cw = viewport.width;
    const ch = viewport.height;
    const cx = viewport.x;
    const cy = viewport.y;
    const viewportMatrix = TMP_MATRIX[1];
    const zScale = 1;
    const zOffset = 0;
    Matrix.FromValuesToRef(
      cw / 2.0, 0, 0, 0,
      0, -ch / 2.0, 0, 0,
      0, 0, zScale, 0,
      cx + cw / 2.0, ch / 2.0 + cy, zOffset, 1,
      viewportMatrix,
    );
    const matrix = TMP_MATRIX[0];
    world.multiplyToRef(transform, matrix);
    matrix.multiplyToRef(viewportMatrix, matrix);
    Vector3.TransformCoordinatesToRef(vector, matrix, result);
    return result;
  }

  static Distance(value1: Vector3Like, value2: Vector3Like): number {
    return Math.sqrt(Vector3.DistanceSquared(value1, value2));
  }

  static DistanceSquared(value1: Vector3Like, value2: Vector3Like): number {
    const x = value1.x - value2.x;
    const y = value1.y - value2.y;
    const z = value1.z - value2.z;
    return x * x + y * y + z * z;
  }

  static RotationFromAxis(axis1: Vector3, axis2: Vector3, axis3: Vector3): Vector3 {
    const rotation = new Vector3();
    Vector3.RotationFromAxisToRef(axis1, axis2, axis3, rotation);
    return rotation;
  }

  static RotationFromAxisToRef<T extends Vector3>(axis1: Vector3, axis2: Vector3, axis3: Vector3, ref: T): T {
    const quat = TMP_QUATERNION[0];
    Quaternion.RotationQuaternionFromAxisToRef(axis1, axis2, axis3, quat);
    quat.toEulerAnglesToRef(ref);
    return ref;
  }
}

// ---------------------------------------------------------------------------
// Quaternion

export class Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;

  constructor(x = 0.0, y = 0.0, z = 0.0, w = 1.0) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }

  copyFrom(other: QuaternionLike): this {
    this.x = other.x;
    this.y = other.y;
    this.z = other.z;
    this.w = other.w;
    return this;
  }

  copyFromFloats(x: number, y: number, z: number, w: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
    return this;
  }

  set(x: number, y: number, z: number, w: number): this {
    return this.copyFromFloats(x, y, z, w);
  }

  scaleInPlace(value: number): this {
    this.x *= value;
    this.y *= value;
    this.z *= value;
    this.w *= value;
    return this;
  }

  multiplyToRef<T extends Quaternion>(q1: QuaternionLike, result: T): T {
    const x = this.x * q1.w + this.y * q1.z - this.z * q1.y + this.w * q1.x;
    const y = -this.x * q1.z + this.y * q1.w + this.z * q1.x + this.w * q1.y;
    const z = this.x * q1.y - this.y * q1.x + this.z * q1.w + this.w * q1.z;
    const w = -this.x * q1.x - this.y * q1.y - this.z * q1.z + this.w * q1.w;
    result.copyFromFloats(x, y, z, w);
    return result;
  }

  length(): number {
    return Math.sqrt(this.lengthSquared());
  }

  lengthSquared(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
  }

  normalize(): this {
    return this.normalizeFromLength(this.length());
  }

  normalizeFromLength(len: number): this {
    if (len === 0 || len === 1.0) {
      return this;
    }
    return this.scaleInPlace(1.0 / len);
  }

  toEulerAngles(): Vector3 {
    const result = Vector3.Zero();
    this.toEulerAnglesToRef(result);
    return result;
  }

  toEulerAnglesToRef<T extends Vector3>(result: T): T {
    const qz = this.z;
    const qx = this.x;
    const qy = this.y;
    const qw = this.w;
    const zAxisY = qy * qz - qx * qw;
    const limit = 0.4999999;
    if (zAxisY < -limit) {
      result.y = 2 * Math.atan2(qy, qw);
      result.x = Math.PI / 2;
      result.z = 0;
    } else if (zAxisY > limit) {
      result.y = 2 * Math.atan2(qy, qw);
      result.x = -Math.PI / 2;
      result.z = 0;
    } else {
      const sqw = qw * qw;
      const sqz = qz * qz;
      const sqx = qx * qx;
      const sqy = qy * qy;
      result.z = Math.atan2(2.0 * (qx * qy + qz * qw), -sqz - sqx + sqy + sqw);
      result.x = Math.asin(-2.0 * zAxisY);
      result.y = Math.atan2(2.0 * (qz * qx + qy * qw), sqz - sqx - sqy + sqw);
    }
    return result;
  }

  toRotationMatrix<T extends Matrix>(result: T): T {
    Matrix.FromQuaternionToRef(this, result);
    return result;
  }

  static FromRotationMatrixToRef<T extends Quaternion>(matrix: MatrixLike, result: T): T {
    const data = matrix.m;
    const m11 = data[0], m12 = data[4], m13 = data[8];
    const m21 = data[1], m22 = data[5], m23 = data[9];
    const m31 = data[2], m32 = data[6], m33 = data[10];
    const trace = m11 + m22 + m33;
    let s: number;
    if (trace > 0) {
      s = 0.5 / Math.sqrt(trace + 1.0);
      result.w = 0.25 / s;
      result.x = (m32 - m23) * s;
      result.y = (m13 - m31) * s;
      result.z = (m21 - m12) * s;
    } else if (m11 > m22 && m11 > m33) {
      s = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33);
      result.w = (m32 - m23) / s;
      result.x = 0.25 * s;
      result.y = (m12 + m21) / s;
      result.z = (m13 + m31) / s;
    } else if (m22 > m33) {
      s = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33);
      result.w = (m13 - m31) / s;
      result.x = (m12 + m21) / s;
      result.y = 0.25 * s;
      result.z = (m23 + m32) / s;
    } else {
      s = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22);
      result.w = (m21 - m12) / s;
      result.x = (m13 + m31) / s;
      result.y = (m23 + m32) / s;
      result.z = 0.25 * s;
    }
    return result;
  }

  static Identity(): Quaternion {
    return new Quaternion(0.0, 0.0, 0.0, 1.0);
  }

  static RotationAxisToRef<T extends Quaternion>(axis: Vector3, angle: number, result: T): T {
    result.w = Math.cos(angle / 2);
    const sinByLength = Math.sin(angle / 2) / axis.length();
    result.x = axis.x * sinByLength;
    result.y = axis.y * sinByLength;
    result.z = axis.z * sinByLength;
    return result;
  }

  static FromEulerVector(vec: Vector3Like): Quaternion {
    const q = new Quaternion();
    Quaternion.RotationYawPitchRollToRef(vec.y, vec.x, vec.z, q);
    return q;
  }

  static FromUnitVectorsToRef<T extends Quaternion>(
    vecFrom: Vector3Like,
    vecTo: Vector3Like,
    result: T,
    epsilon = Epsilon,
  ): T {
    const r = Vector3.Dot(vecFrom, vecTo) + 1;
    if (r < epsilon) {
      if (Math.abs(vecFrom.x) > Math.abs(vecFrom.z)) {
        result.set(-vecFrom.y, vecFrom.x, 0, 0);
      } else {
        result.set(0, -vecFrom.z, vecFrom.y, 0);
      }
    } else {
      Vector3.CrossToRef(vecFrom, vecTo, TMP_VECTOR3[0]);
      result.set(TMP_VECTOR3[0].x, TMP_VECTOR3[0].y, TMP_VECTOR3[0].z, r);
    }
    return result.normalize();
  }

  static RotationYawPitchRoll(yaw: number, pitch: number, roll: number): Quaternion {
    const q = new Quaternion();
    Quaternion.RotationYawPitchRollToRef(yaw, pitch, roll, q);
    return q;
  }

  static RotationYawPitchRollToRef<T extends Quaternion>(yaw: number, pitch: number, roll: number, result: T): T {
    // Produces a quaternion from Euler angles in the y-x-z orientation
    const halfRoll = roll * 0.5;
    const halfPitch = pitch * 0.5;
    const halfYaw = yaw * 0.5;
    const sinRoll = Math.sin(halfRoll);
    const cosRoll = Math.cos(halfRoll);
    const sinPitch = Math.sin(halfPitch);
    const cosPitch = Math.cos(halfPitch);
    const sinYaw = Math.sin(halfYaw);
    const cosYaw = Math.cos(halfYaw);
    result.x = cosYaw * sinPitch * cosRoll + sinYaw * cosPitch * sinRoll;
    result.y = sinYaw * cosPitch * cosRoll - cosYaw * sinPitch * sinRoll;
    result.z = cosYaw * cosPitch * sinRoll - sinYaw * sinPitch * cosRoll;
    result.w = cosYaw * cosPitch * cosRoll + sinYaw * sinPitch * sinRoll;
    return result;
  }

  static RotationQuaternionFromAxisToRef<T extends Quaternion>(
    axis1: Vector3,
    axis2: Vector3,
    axis3: Vector3,
    ref: T,
  ): T {
    const rotMat = TMP_MATRIX[0];
    const a1 = axis1.normalizeToRef(TMP_VECTOR3[0]);
    const a2 = axis2.normalizeToRef(TMP_VECTOR3[1]);
    const a3 = axis3.normalizeToRef(TMP_VECTOR3[2]);
    Matrix.FromXYZAxesToRef(a1, a2, a3, rotMat);
    Quaternion.FromRotationMatrixToRef(rotMat, ref);
    return ref;
  }

  static SlerpToRef<T extends Quaternion>(left: QuaternionLike, right: QuaternionLike, amount: number, result: T): T {
    let num2: number;
    let num3: number;
    let num4 = left.x * right.x + left.y * right.y + left.z * right.z + left.w * right.w;
    let flag = false;
    if (num4 < 0) {
      flag = true;
      num4 = -num4;
    }
    if (num4 > 0.999999) {
      num3 = 1 - amount;
      num2 = flag ? -amount : amount;
    } else {
      const num5 = Math.acos(num4);
      const num6 = 1.0 / Math.sin(num5);
      num3 = Math.sin((1.0 - amount) * num5) * num6;
      num2 = flag ? -Math.sin(amount * num5) * num6 : Math.sin(amount * num5) * num6;
    }
    result.x = num3 * left.x + num2 * right.x;
    result.y = num3 * left.y + num2 * right.y;
    result.z = num3 * left.z + num2 * right.z;
    result.w = num3 * left.w + num2 * right.w;
    return result;
  }
}

// ---------------------------------------------------------------------------
// Matrix

/** Row-major sixteen numbers in float32, translation in `m[12..14]` — Babylon's layout. */
export class Matrix {
  private readonly _m = new Float32Array(16);
  private _isIdentity = false;
  private _isIdentityDirty = true;

  constructor() {
    this.markAsUpdated();
  }

  /** The sixteen numbers. Read them; write through a method, or the identity flag lies. */
  get m(): Readonly<Float32Array> {
    return this._m;
  }

  markAsUpdated(): void {
    this._isIdentity = false;
    this._isIdentityDirty = true;
  }

  private _updateIdentityStatus(isIdentity: boolean, isIdentityDirty = false): void {
    this._isIdentity = isIdentity;
    this._isIdentityDirty = this._isIdentity ? false : isIdentityDirty;
  }

  isIdentity(): boolean {
    if (this._isIdentityDirty) {
      this._isIdentityDirty = false;
      const m = this._m;
      this._isIdentity =
        m[0] === 1.0 && m[1] === 0.0 && m[2] === 0.0 && m[3] === 0.0 &&
        m[4] === 0.0 && m[5] === 1.0 && m[6] === 0.0 && m[7] === 0.0 &&
        m[8] === 0.0 && m[9] === 0.0 && m[10] === 1.0 && m[11] === 0.0 &&
        m[12] === 0.0 && m[13] === 0.0 && m[14] === 0.0 && m[15] === 1.0;
    }
    return this._isIdentity;
  }

  determinant(): number {
    if (this._isIdentity === true) {
      return 1;
    }
    const m = this._m;
    const m00 = m[0], m01 = m[1], m02 = m[2], m03 = m[3];
    const m10 = m[4], m11 = m[5], m12 = m[6], m13 = m[7];
    const m20 = m[8], m21 = m[9], m22 = m[10], m23 = m[11];
    const m30 = m[12], m31 = m[13], m32 = m[14], m33 = m[15];
    const det_22_33 = m22 * m33 - m32 * m23;
    const det_21_33 = m21 * m33 - m31 * m23;
    const det_21_32 = m21 * m32 - m31 * m22;
    const det_20_33 = m20 * m33 - m30 * m23;
    const det_20_32 = m20 * m32 - m22 * m30;
    const det_20_31 = m20 * m31 - m30 * m21;
    const cofact_00 = +(m11 * det_22_33 - m12 * det_21_33 + m13 * det_21_32);
    const cofact_01 = -(m10 * det_22_33 - m12 * det_20_33 + m13 * det_20_32);
    const cofact_02 = +(m10 * det_21_33 - m11 * det_20_33 + m13 * det_20_31);
    const cofact_03 = -(m10 * det_21_32 - m11 * det_20_32 + m12 * det_20_31);
    return m00 * cofact_00 + m01 * cofact_01 + m02 * cofact_02 + m03 * cofact_03;
  }

  asArray(): Readonly<Float32Array> {
    return this._m;
  }

  invertToRef<T extends Matrix>(other: T): T {
    if (this._isIdentity === true) {
      Matrix.IdentityToRef(other);
      return other;
    }
    if (invertMatrixToArray(this._m, other._m)) {
      other.markAsUpdated();
    } else {
      other.copyFrom(this);
    }
    return other;
  }

  copyFrom(other: Matrix): this {
    other.copyToArray(this._m);
    this._updateIdentityStatus(other._isIdentity, other._isIdentityDirty);
    return this;
  }

  copyToArray(array: number[] | Float32Array, offset = 0): this {
    const source = this._m;
    for (let i = 0; i < 16; i++) {
      array[offset + i] = source[i];
    }
    return this;
  }

  multiply(other: Matrix): Matrix {
    const result = new Matrix();
    this.multiplyToRef(other, result);
    return result;
  }

  multiplyToRef<T extends Matrix>(other: Matrix, result: T): T {
    if (this._isIdentity) {
      result.copyFrom(other);
      return result;
    }
    if (other._isIdentity) {
      result.copyFrom(this);
      return result;
    }
    this.multiplyToArray(other, result._m, 0);
    result.markAsUpdated();
    return result;
  }

  multiplyToArray(other: MatrixLike, result: number[] | Float32Array, offset: number): this {
    const m = this._m;
    const otherM = other.m;
    const tm0 = m[0], tm1 = m[1], tm2 = m[2], tm3 = m[3];
    const tm4 = m[4], tm5 = m[5], tm6 = m[6], tm7 = m[7];
    const tm8 = m[8], tm9 = m[9], tm10 = m[10], tm11 = m[11];
    const tm12 = m[12], tm13 = m[13], tm14 = m[14], tm15 = m[15];
    const om0 = otherM[0], om1 = otherM[1], om2 = otherM[2], om3 = otherM[3];
    const om4 = otherM[4], om5 = otherM[5], om6 = otherM[6], om7 = otherM[7];
    const om8 = otherM[8], om9 = otherM[9], om10 = otherM[10], om11 = otherM[11];
    const om12 = otherM[12], om13 = otherM[13], om14 = otherM[14], om15 = otherM[15];
    result[offset] = tm0 * om0 + tm1 * om4 + tm2 * om8 + tm3 * om12;
    result[offset + 1] = tm0 * om1 + tm1 * om5 + tm2 * om9 + tm3 * om13;
    result[offset + 2] = tm0 * om2 + tm1 * om6 + tm2 * om10 + tm3 * om14;
    result[offset + 3] = tm0 * om3 + tm1 * om7 + tm2 * om11 + tm3 * om15;
    result[offset + 4] = tm4 * om0 + tm5 * om4 + tm6 * om8 + tm7 * om12;
    result[offset + 5] = tm4 * om1 + tm5 * om5 + tm6 * om9 + tm7 * om13;
    result[offset + 6] = tm4 * om2 + tm5 * om6 + tm6 * om10 + tm7 * om14;
    result[offset + 7] = tm4 * om3 + tm5 * om7 + tm6 * om11 + tm7 * om15;
    result[offset + 8] = tm8 * om0 + tm9 * om4 + tm10 * om8 + tm11 * om12;
    result[offset + 9] = tm8 * om1 + tm9 * om5 + tm10 * om9 + tm11 * om13;
    result[offset + 10] = tm8 * om2 + tm9 * om6 + tm10 * om10 + tm11 * om14;
    result[offset + 11] = tm8 * om3 + tm9 * om7 + tm10 * om11 + tm11 * om15;
    result[offset + 12] = tm12 * om0 + tm13 * om4 + tm14 * om8 + tm15 * om12;
    result[offset + 13] = tm12 * om1 + tm13 * om5 + tm14 * om9 + tm15 * om13;
    result[offset + 14] = tm12 * om2 + tm13 * om6 + tm14 * om10 + tm15 * om14;
    result[offset + 15] = tm12 * om3 + tm13 * om7 + tm14 * om11 + tm15 * om15;
    return this;
  }

  /** Babylon's, without the scaling-node argument nothing here passes. */
  decompose(scale?: Vector3, rotation?: Quaternion, translation?: Vector3): boolean {
    if (this._isIdentity) {
      if (translation) {
        translation.setAll(0);
      }
      if (scale) {
        scale.setAll(1);
      }
      if (rotation) {
        rotation.copyFromFloats(0, 0, 0, 1);
      }
      return true;
    }
    const m = this._m;
    if (translation) {
      translation.copyFromFloats(m[12], m[13], m[14]);
    }
    const s = scale || TMP_VECTOR3[0];
    s.x = Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]);
    s.y = Math.sqrt(m[4] * m[4] + m[5] * m[5] + m[6] * m[6]);
    s.z = Math.sqrt(m[8] * m[8] + m[9] * m[9] + m[10] * m[10]);
    if (this.determinant() <= 0) {
      s.y *= -1;
    }
    if (s.x === 0 || s.y === 0 || s.z === 0) {
      if (rotation) {
        rotation.copyFromFloats(0.0, 0.0, 0.0, 1.0);
      }
      return false;
    }
    if (rotation) {
      const sx = 1 / s.x, sy = 1 / s.y, sz = 1 / s.z;
      Matrix.FromValuesToRef(
        m[0] * sx, m[1] * sx, m[2] * sx, 0.0,
        m[4] * sy, m[5] * sy, m[6] * sy, 0.0,
        m[8] * sz, m[9] * sz, m[10] * sz, 0.0,
        0.0, 0.0, 0.0, 1.0,
        TMP_MATRIX[0],
      );
      Quaternion.FromRotationMatrixToRef(TMP_MATRIX[0], rotation);
    }
    return true;
  }

  /** A shared identity. Never write to it. */
  static get IdentityReadOnly(): Readonly<Matrix> {
    return IDENTITY_READ_ONLY;
  }

  static FromValuesToRef(
    initialM11: number, initialM12: number, initialM13: number, initialM14: number,
    initialM21: number, initialM22: number, initialM23: number, initialM24: number,
    initialM31: number, initialM32: number, initialM33: number, initialM34: number,
    initialM41: number, initialM42: number, initialM43: number, initialM44: number,
    result: Matrix,
  ): void {
    const m = result._m;
    m[0] = initialM11;
    m[1] = initialM12;
    m[2] = initialM13;
    m[3] = initialM14;
    m[4] = initialM21;
    m[5] = initialM22;
    m[6] = initialM23;
    m[7] = initialM24;
    m[8] = initialM31;
    m[9] = initialM32;
    m[10] = initialM33;
    m[11] = initialM34;
    m[12] = initialM41;
    m[13] = initialM42;
    m[14] = initialM43;
    m[15] = initialM44;
    result.markAsUpdated();
  }

  static FromValues(
    initialM11: number, initialM12: number, initialM13: number, initialM14: number,
    initialM21: number, initialM22: number, initialM23: number, initialM24: number,
    initialM31: number, initialM32: number, initialM33: number, initialM34: number,
    initialM41: number, initialM42: number, initialM43: number, initialM44: number,
  ): Matrix {
    const result = new Matrix();
    Matrix.FromValuesToRef(
      initialM11, initialM12, initialM13, initialM14,
      initialM21, initialM22, initialM23, initialM24,
      initialM31, initialM32, initialM33, initialM34,
      initialM41, initialM42, initialM43, initialM44,
      result,
    );
    return result;
  }

  static Compose(scale: Vector3Like, rotation: QuaternionLike, translation: Vector3Like): Matrix {
    const result = new Matrix();
    Matrix.ComposeToRef(scale, rotation, translation, result);
    return result;
  }

  static ComposeToRef<T extends Matrix>(
    scale: Vector3Like,
    rotation: QuaternionLike,
    translation: Vector3Like,
    result: T,
  ): T {
    const m = result._m;
    const x = rotation.x, y = rotation.y, z = rotation.z, w = rotation.w;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    const sx = scale.x, sy = scale.y, sz = scale.z;
    m[0] = (1 - (yy + zz)) * sx;
    m[1] = (xy + wz) * sx;
    m[2] = (xz - wy) * sx;
    m[3] = 0;
    m[4] = (xy - wz) * sy;
    m[5] = (1 - (xx + zz)) * sy;
    m[6] = (yz + wx) * sy;
    m[7] = 0;
    m[8] = (xz + wy) * sz;
    m[9] = (yz - wx) * sz;
    m[10] = (1 - (xx + yy)) * sz;
    m[11] = 0;
    m[12] = translation.x;
    m[13] = translation.y;
    m[14] = translation.z;
    m[15] = 1;
    result.markAsUpdated();
    return result;
  }

  static Identity(): Matrix {
    const identity = Matrix.FromValues(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
    identity._updateIdentityStatus(true);
    return identity;
  }

  static IdentityToRef<T extends Matrix>(result: T): T {
    Matrix.FromValuesToRef(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, result);
    result._updateIdentityStatus(true);
    return result;
  }

  static RotationX(angle: number): Matrix {
    const result = new Matrix();
    Matrix.RotationXToRef(angle, result);
    return result;
  }

  static RotationXToRef<T extends Matrix>(angle: number, result: T): T {
    const s = Math.sin(angle);
    const c = Math.cos(angle);
    Matrix.FromValuesToRef(1.0, 0.0, 0.0, 0.0, 0.0, c, s, 0.0, 0.0, -s, c, 0.0, 0.0, 0.0, 0.0, 1.0, result);
    result._updateIdentityStatus(c === 1 && s === 0);
    return result;
  }

  static RotationY(angle: number): Matrix {
    const result = new Matrix();
    Matrix.RotationYToRef(angle, result);
    return result;
  }

  static RotationYToRef<T extends Matrix>(angle: number, result: T): T {
    const s = Math.sin(angle);
    const c = Math.cos(angle);
    Matrix.FromValuesToRef(c, 0.0, -s, 0.0, 0.0, 1.0, 0.0, 0.0, s, 0.0, c, 0.0, 0.0, 0.0, 0.0, 1.0, result);
    result._updateIdentityStatus(c === 1 && s === 0);
    return result;
  }

  static RotationZ(angle: number): Matrix {
    const result = new Matrix();
    Matrix.RotationZToRef(angle, result);
    return result;
  }

  static RotationZToRef<T extends Matrix>(angle: number, result: T): T {
    const s = Math.sin(angle);
    const c = Math.cos(angle);
    Matrix.FromValuesToRef(c, s, 0.0, 0.0, -s, c, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, result);
    result._updateIdentityStatus(c === 1 && s === 0);
    return result;
  }

  static RotationAxis(axis: Vector3, angle: number): Matrix {
    const result = new Matrix();
    Matrix.RotationAxisToRef(axis, angle, result);
    return result;
  }

  static RotationAxisToRef<T extends Matrix>(axis: Vector3, angle: number, result: T): T {
    const s = Math.sin(-angle);
    const c = Math.cos(-angle);
    const c1 = 1 - c;
    const a = axis.normalizeToRef(TMP_VECTOR3[0]);
    const m = result._m;
    m[0] = a.x * a.x * c1 + c;
    m[1] = a.x * a.y * c1 - a.z * s;
    m[2] = a.x * a.z * c1 + a.y * s;
    m[3] = 0.0;
    m[4] = a.y * a.x * c1 + a.z * s;
    m[5] = a.y * a.y * c1 + c;
    m[6] = a.y * a.z * c1 - a.x * s;
    m[7] = 0.0;
    m[8] = a.z * a.x * c1 - a.y * s;
    m[9] = a.z * a.y * c1 + a.x * s;
    m[10] = a.z * a.z * c1 + c;
    m[11] = 0.0;
    m[12] = 0.0;
    m[13] = 0.0;
    m[14] = 0.0;
    m[15] = 1.0;
    result.markAsUpdated();
    return result;
  }

  static RotationYawPitchRoll(yaw: number, pitch: number, roll: number): Matrix {
    const result = new Matrix();
    Matrix.RotationYawPitchRollToRef(yaw, pitch, roll, result);
    return result;
  }

  static RotationYawPitchRollToRef<T extends Matrix>(yaw: number, pitch: number, roll: number, result: T): T {
    Quaternion.RotationYawPitchRollToRef(yaw, pitch, roll, TMP_QUATERNION[0]);
    TMP_QUATERNION[0].toRotationMatrix(result);
    return result;
  }

  static Translation(x: number, y: number, z: number): Matrix {
    const result = new Matrix();
    Matrix.TranslationToRef(x, y, z, result);
    return result;
  }

  static TranslationToRef<T extends Matrix>(x: number, y: number, z: number, result: T): T {
    Matrix.FromValuesToRef(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, x, y, z, 1.0, result);
    result._updateIdentityStatus(x === 0 && y === 0 && z === 0);
    return result;
  }

  static FromXYZAxesToRef<T extends Matrix>(xaxis: Vector3Like, yaxis: Vector3Like, zaxis: Vector3Like, result: T): T {
    Matrix.FromValuesToRef(
      xaxis.x, xaxis.y, xaxis.z, 0.0,
      yaxis.x, yaxis.y, yaxis.z, 0.0,
      zaxis.x, zaxis.y, zaxis.z, 0.0,
      0.0, 0.0, 0.0, 1.0,
      result,
    );
    return result;
  }

  static FromQuaternionToRef<T extends Matrix>(quat: QuaternionLike, result: T): T {
    const xx = quat.x * quat.x;
    const yy = quat.y * quat.y;
    const zz = quat.z * quat.z;
    const xy = quat.x * quat.y;
    const zw = quat.z * quat.w;
    const zx = quat.z * quat.x;
    const yw = quat.y * quat.w;
    const yz = quat.y * quat.z;
    const xw = quat.x * quat.w;
    const m = result._m;
    m[0] = 1.0 - 2.0 * (yy + zz);
    m[1] = 2.0 * (xy + zw);
    m[2] = 2.0 * (zx - yw);
    m[3] = 0.0;
    m[4] = 2.0 * (xy - zw);
    m[5] = 1.0 - 2.0 * (zz + xx);
    m[6] = 2.0 * (yz + xw);
    m[7] = 0.0;
    m[8] = 2.0 * (zx + yw);
    m[9] = 2.0 * (yz - xw);
    m[10] = 1.0 - 2.0 * (yy + xx);
    m[11] = 0.0;
    m[12] = 0.0;
    m[13] = 0.0;
    m[14] = 0.0;
    m[15] = 1.0;
    result.markAsUpdated();
    return result;
  }
}

/** Babylon's `InvertMatrixToArray`: false, and `target` untouched, when singular. */
function invertMatrixToArray(m: Float32Array, target: Float32Array): boolean {
  const m00 = m[0], m01 = m[1], m02 = m[2], m03 = m[3];
  const m10 = m[4], m11 = m[5], m12 = m[6], m13 = m[7];
  const m20 = m[8], m21 = m[9], m22 = m[10], m23 = m[11];
  const m30 = m[12], m31 = m[13], m32 = m[14], m33 = m[15];
  const det_22_33 = m22 * m33 - m32 * m23;
  const det_21_33 = m21 * m33 - m31 * m23;
  const det_21_32 = m21 * m32 - m31 * m22;
  const det_20_33 = m20 * m33 - m30 * m23;
  const det_20_32 = m20 * m32 - m22 * m30;
  const det_20_31 = m20 * m31 - m30 * m21;
  const cofact_00 = +(m11 * det_22_33 - m12 * det_21_33 + m13 * det_21_32);
  const cofact_01 = -(m10 * det_22_33 - m12 * det_20_33 + m13 * det_20_32);
  const cofact_02 = +(m10 * det_21_33 - m11 * det_20_33 + m13 * det_20_31);
  const cofact_03 = -(m10 * det_21_32 - m11 * det_20_32 + m12 * det_20_31);
  const det = m00 * cofact_00 + m01 * cofact_01 + m02 * cofact_02 + m03 * cofact_03;
  if (det === 0) {
    return false;
  }
  const detInv = 1 / det;
  const det_12_33 = m12 * m33 - m32 * m13;
  const det_11_33 = m11 * m33 - m31 * m13;
  const det_11_32 = m11 * m32 - m31 * m12;
  const det_10_33 = m10 * m33 - m30 * m13;
  const det_10_32 = m10 * m32 - m30 * m12;
  const det_10_31 = m10 * m31 - m30 * m11;
  const det_12_23 = m12 * m23 - m22 * m13;
  const det_11_23 = m11 * m23 - m21 * m13;
  const det_11_22 = m11 * m22 - m21 * m12;
  const det_10_23 = m10 * m23 - m20 * m13;
  const det_10_22 = m10 * m22 - m20 * m12;
  const det_10_21 = m10 * m21 - m20 * m11;
  const cofact_10 = -(m01 * det_22_33 - m02 * det_21_33 + m03 * det_21_32);
  const cofact_11 = +(m00 * det_22_33 - m02 * det_20_33 + m03 * det_20_32);
  const cofact_12 = -(m00 * det_21_33 - m01 * det_20_33 + m03 * det_20_31);
  const cofact_13 = +(m00 * det_21_32 - m01 * det_20_32 + m02 * det_20_31);
  const cofact_20 = +(m01 * det_12_33 - m02 * det_11_33 + m03 * det_11_32);
  const cofact_21 = -(m00 * det_12_33 - m02 * det_10_33 + m03 * det_10_32);
  const cofact_22 = +(m00 * det_11_33 - m01 * det_10_33 + m03 * det_10_31);
  const cofact_23 = -(m00 * det_11_32 - m01 * det_10_32 + m02 * det_10_31);
  const cofact_30 = -(m01 * det_12_23 - m02 * det_11_23 + m03 * det_11_22);
  const cofact_31 = +(m00 * det_12_23 - m02 * det_10_23 + m03 * det_10_22);
  const cofact_32 = -(m00 * det_11_23 - m01 * det_10_23 + m03 * det_10_21);
  const cofact_33 = +(m00 * det_11_22 - m01 * det_10_22 + m02 * det_10_21);
  target[0] = cofact_00 * detInv;
  target[1] = cofact_10 * detInv;
  target[2] = cofact_20 * detInv;
  target[3] = cofact_30 * detInv;
  target[4] = cofact_01 * detInv;
  target[5] = cofact_11 * detInv;
  target[6] = cofact_21 * detInv;
  target[7] = cofact_31 * detInv;
  target[8] = cofact_02 * detInv;
  target[9] = cofact_12 * detInv;
  target[10] = cofact_22 * detInv;
  target[11] = cofact_32 * detInv;
  target[12] = cofact_03 * detInv;
  target[13] = cofact_13 * detInv;
  target[14] = cofact_23 * detInv;
  target[15] = cofact_33 * detInv;
  return true;
}

// Babylon's `MathTmp` and `TmpVectors`, as far as the methods above use them.
// Never handed out: each is filled and read inside one call.
const TMP_VECTOR3 = [new Vector3(), new Vector3(), new Vector3()];
const TMP_QUATERNION = [new Quaternion()];
const TMP_MATRIX = [Matrix.Identity(), Matrix.Identity()];

const UP_READ_ONLY = Vector3.Up();
const ZERO_READ_ONLY = Vector3.Zero();
const IDENTITY_READ_ONLY = Matrix.Identity();
