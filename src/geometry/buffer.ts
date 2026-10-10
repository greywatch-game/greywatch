/**
 * buffer.ts — `GeometryBuffer`: one surface's vertex arrays, as typed arrays,
 * with the three things the kit does to one — `merge`, `transform` and
 * `computeNormals` — done exactly as Babylon's `VertexData` does them.
 * Owns: the buffer class, `FloatArray`, and the conversions in and out of
 * plain arrays. No state, no tunable, and imports nothing but `src/math/` — not
 * `@babylonjs/core`, not `CONFIG` — so a Node script loads it by type stripping
 * (`scripts/geometry-check.mjs`), and so will the server and the renderer.
 *
 * **It exists so the world's geometry stops being Babylon's** (BABYLON_EXIT.md
 * X1.2): the kit and the scatter props build these, `world/parts.ts` is the
 * one place one becomes a Babylon mesh, and the merge moves onto them next
 * (X1.4).
 *
 * ## The one rule: the same bits as Babylon
 *
 * Every oracle that grades the exit compares bits (`kit:hash`, `merge:hash`),
 * so every routine here is Babylon 9.28's, operation for operation
 * (`Meshes/mesh.vertexData.js`), and `scripts/geometry-check.mjs` runs each
 * against Babylon on seeded inputs with `Object.is`. Two things follow that a
 * tidier design would get wrong:
 *
 *   - **A `Float64Array` is where Babylon held a `number[]`, and a
 *     `Float32Array` is where it held one of those.** Babylon keeps whatever
 *     array it is given, and the TYPE decides the arithmetic: a merge whose
 *     first member is a `Float32Array` rounds every value it copies to float32,
 *     and one whose first member is a plain array keeps doubles. Storing
 *     everything as float32 would round a part's local positions before the
 *     merge transforms them, and the world would move by a bit. So a buffer
 *     never changes an array's precision, and `merge` keeps the first member's.
 *   - **Indices are a `Uint32Array`** where Babylon mostly held a `number[]`.
 *     An index is an integer, so the VALUES cannot differ; `world/parts.ts`
 *     hands Babylon back a plain array, which is what it had.
 *
 * ## Licence
 *
 * The method bodies are copied from Babylon.js 9.28, which is licensed under
 * the Apache License, Version 2.0 (`node_modules/@babylonjs/core/license.md`;
 * https://www.apache.org/licenses/LICENSE-2.0). "Babylon.js — Copyright 2023
 * The Babylon.js team" (its NOTICE). Changes from the original: typed arrays in
 * place of `number[]`, only the attributes the tree carries (no tangents, no
 * skinning, no third UV set onward), no material infos, no completion, no
 * coroutine, and `ComputeNormals` without its facet options.
 */
import { Vector3, type MatrixLike } from "../math/index.ts";

/**
 * A float attribute. See the header: a `Float64Array` stands where Babylon
 * held a `number[]` and must never be handed to Babylon as it is.
 */
export type FloatArray = Float64Array | Float32Array;

/** What a buffer is built from: typed arrays kept as they are, plain ones widened. */
export interface GeometryArrays {
  positions: ArrayLike<number>;
  normals?: ArrayLike<number> | null;
  uvs?: ArrayLike<number> | null;
  uvs2?: ArrayLike<number> | null;
  colors?: ArrayLike<number> | null;
  indices: ArrayLike<number>;
}

/**
 * A float array as a buffer holds it: a typed array kept AS IT IS (its type is
 * its precision — see the header), anything else copied into doubles.
 */
export function floats(a: ArrayLike<number>): FloatArray {
  if (a instanceof Float32Array || a instanceof Float64Array) return a;
  // A loop rather than `Float64Array.from`, which goes through the iterator.
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i];
  return out;
}

function floatsOrNull(a: ArrayLike<number> | null | undefined): FloatArray | null {
  return a ? floats(a) : null;
}

/** An index array as a buffer holds it. */
export function indexArray(a: ArrayLike<number>): Uint32Array {
  if (a instanceof Uint32Array) return a;
  const out = new Uint32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i];
  return out;
}

/**
 * One surface: positions, normals, two UV sets, colours and triangles.
 *
 * The attributes are `VertexData`'s under its names, and `null` where Babylon's
 * would be absent, because a merge refuses two members that disagree on which
 * ones they carry, exactly as Babylon's does.
 */
export class GeometryBuffer {
  positions: FloatArray;
  normals: FloatArray | null;
  uvs: FloatArray | null;
  uvs2: FloatArray | null;
  colors: FloatArray | null;
  indices: Uint32Array;

  constructor(arrays: GeometryArrays) {
    this.positions = floats(arrays.positions);
    this.normals = floatsOrNull(arrays.normals);
    this.uvs = floatsOrNull(arrays.uvs);
    this.uvs2 = floatsOrNull(arrays.uvs2);
    this.colors = floatsOrNull(arrays.colors);
    this.indices = indexArray(arrays.indices);
  }

  /** How many vertices it holds. */
  get vertexCount(): number {
    return this.positions.length / 3;
  }

  /**
   * `VertexData.transform`: every position through the full matrix, every
   * normal through its upper 3x3 and NOT renormalised, and the winding turned
   * over when the matrix mirrors. In place, as Babylon's is.
   */
  transform(matrix: MatrixLike & { determinant(): number }): this {
    const flip = matrix.determinant() < 0;
    transformCoordinates(this.positions, matrix, 0, this.positions.length);
    if (this.normals) transformNormals(this.normals, matrix, 0, this.normals.length);
    if (flip) flipFaces(this.indices, 0, this.indices.length);
    return this;
  }

  /**
   * `VertexData.merge(others)`: this buffer's vertices, then each other's in
   * order, the others' indices offset past everything ahead of them. The
   * result is written onto THIS buffer, as Babylon's is, and each attribute
   * keeps this buffer's precision (see the header).
   *
   * Refuses members that disagree on which attributes they carry, as
   * Babylon's does without its `enableCompletion`.
   */
  merge(others: GeometryBuffer | readonly GeometryBuffer[]): this {
    const list = Array.isArray(others) ? (others as readonly GeometryBuffer[]) : [others as GeometryBuffer];
    validate(this);
    for (const other of list) {
      validate(other);
      if (
        !this.normals !== !other.normals ||
        !this.uvs !== !other.uvs ||
        !this.uvs2 !== !other.uvs2 ||
        !this.colors !== !other.colors
      ) {
        throw new Error("Cannot merge vertex data that do not have the same set of attributes");
      }
    }
    let totalIndices = this.indices.length;
    for (const other of list) totalIndices += other.indices.length;
    const indices = new Uint32Array(totalIndices);
    indices.set(this.indices);
    let indicesOffset = this.indices.length;
    let positionsOffset = this.positions.length / 3;
    for (const other of list) {
      for (let index = 0; index < other.indices.length; index++) {
        indices[indicesOffset + index] = other.indices[index] + positionsOffset;
      }
      positionsOffset += other.positions.length / 3;
      indicesOffset += other.indices.length;
    }
    this.indices = indices;
    this.positions = mergeElement(this.positions, list.map((o) => o.positions));
    if (this.normals) this.normals = mergeElement(this.normals, list.map((o) => o.normals!));
    if (this.uvs) this.uvs = mergeElement(this.uvs, list.map((o) => o.uvs!));
    if (this.uvs2) this.uvs2 = mergeElement(this.uvs2, list.map((o) => o.uvs2!));
    if (this.colors) this.colors = mergeElement(this.colors, list.map((o) => o.colors!));
    return this;
  }

  /** A deep copy: every array its own. */
  clone(): GeometryBuffer {
    return new GeometryBuffer({
      positions: this.positions.slice(),
      normals: this.normals?.slice() ?? null,
      uvs: this.uvs?.slice() ?? null,
      uvs2: this.uvs2?.slice() ?? null,
      colors: this.colors?.slice() ?? null,
      indices: this.indices.slice(),
    });
  }
}

/**
 * `VertexData._MergeElement` without a transform: the source's values, then
 * each other's, in an array of the SOURCE's type — a `Float32Array` source
 * rounds what it copies, anything else keeps doubles.
 */
function mergeElement(source: FloatArray, others: readonly FloatArray[]): FloatArray {
  let len = source.length;
  for (const o of others) len += o.length;
  const out = source instanceof Float32Array ? new Float32Array(len) : new Float64Array(len);
  out.set(source);
  let offset = source.length;
  for (const o of others) {
    out.set(o, offset);
    offset += o.length;
  }
  return out;
}

/** `VertexData._validate`, for the attributes a buffer carries. */
function validate(b: GeometryBuffer): void {
  if (b.positions.length % 3 !== 0) {
    throw new Error("The positions array count must be a multiple of 3");
  }
  const count = b.positions.length / 3;
  const check = (kind: string, values: FloatArray | null, stride: number): void => {
    if (!values) return;
    if (values.length % stride !== 0) {
      throw new Error(`The ${kind}s array count must be a multiple of ${stride}`);
    }
    if (values.length / stride !== count) {
      throw new Error(
        `The ${kind}s element count (${values.length / stride}) does not match the positions count (${count})`,
      );
    }
  };
  check("normal", b.normals, 3);
  check("uv", b.uvs, 2);
  check("uv2", b.uvs2, 2);
  check("color", b.colors, 4);
}

const scratch = new Vector3();

/** `VertexData._TransformVector3Coordinates`, over `[offset, offset + length)`. */
export function transformCoordinates(
  coordinates: FloatArray,
  transformation: MatrixLike,
  offset: number,
  length: number,
): void {
  for (let index = offset; index < offset + length; index += 3) {
    Vector3.TransformCoordinatesFromFloatsToRef(
      coordinates[index],
      coordinates[index + 1],
      coordinates[index + 2],
      transformation,
      scratch,
    );
    coordinates[index] = scratch.x;
    coordinates[index + 1] = scratch.y;
    coordinates[index + 2] = scratch.z;
  }
}

/** `VertexData._TransformVector3Normals`: no translation, and no renormalising. */
export function transformNormals(
  normals: FloatArray,
  transformation: MatrixLike,
  offset: number,
  length: number,
): void {
  for (let index = offset; index < offset + length; index += 3) {
    Vector3.TransformNormalFromFloatsToRef(
      normals[index],
      normals[index + 1],
      normals[index + 2],
      transformation,
      scratch,
    );
    normals[index] = scratch.x;
    normals[index + 1] = scratch.y;
    normals[index + 2] = scratch.z;
  }
}

/** `VertexData._FlipFaces`: each triangle's second and third index swapped. */
export function flipFaces(indices: Uint32Array, offset: number, length: number): void {
  for (let index = offset; index < offset + length; index += 3) {
    const tmp = indices[index + 1];
    indices[index + 1] = indices[index + 2];
    indices[index + 2] = tmp;
  }
}

/**
 * `VertexData.ComputeNormals(positions, indices, normals)` with no options:
 * each face's unit normal (`(p1 - p2) x (p3 - p2)`, left-handed) summed onto
 * its three vertices, then each sum normalised. Returns a new array of
 * doubles, which is what Babylon's write into the kit's `number[]` was.
 */
export function computeNormals(positions: ArrayLike<number>, indices: ArrayLike<number>): Float64Array {
  const normals = new Float64Array(positions.length);
  computeNormalsInto(positions, indices, normals);
  return normals;
}

/**
 * `computeNormals` into an array the caller holds — a `number[]` that grows,
 * as the primitives' own arrays do (`primitives.ts`), or a `Float64Array` the
 * length of `positions`. Never a `Float32Array`: the sums would be rounded at
 * every step, and Babylon's were not.
 */
export function computeNormalsInto(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  normals: number[] | Float64Array,
): void {
  for (let index = 0; index < positions.length; index++) {
    normals[index] = 0.0;
  }
  const nbFaces = (indices.length / 3) | 0;
  for (let index = 0; index < nbFaces; index++) {
    const v1x = indices[index * 3] * 3;
    const v1y = v1x + 1;
    const v1z = v1x + 2;
    const v2x = indices[index * 3 + 1] * 3;
    const v2y = v2x + 1;
    const v2z = v2x + 2;
    const v3x = indices[index * 3 + 2] * 3;
    const v3y = v3x + 1;
    const v3z = v3x + 2;
    const p1p2x = positions[v1x] - positions[v2x];
    const p1p2y = positions[v1y] - positions[v2y];
    const p1p2z = positions[v1z] - positions[v2z];
    const p3p2x = positions[v3x] - positions[v2x];
    const p3p2y = positions[v3y] - positions[v2y];
    const p3p2z = positions[v3z] - positions[v2z];
    // Babylon's `faceNormalSign` is 1 for a left-handed scene, and the
    // multiplication by it is kept: `1 * -0` is the -0 it would have stored.
    let faceNormalx = 1 * (p1p2y * p3p2z - p1p2z * p3p2y);
    let faceNormaly = 1 * (p1p2z * p3p2x - p1p2x * p3p2z);
    let faceNormalz = 1 * (p1p2x * p3p2y - p1p2y * p3p2x);
    let length = Math.sqrt(faceNormalx * faceNormalx + faceNormaly * faceNormaly + faceNormalz * faceNormalz);
    length = length === 0 ? 1.0 : length;
    faceNormalx /= length;
    faceNormaly /= length;
    faceNormalz /= length;
    normals[v1x] += faceNormalx;
    normals[v1y] += faceNormaly;
    normals[v1z] += faceNormalz;
    normals[v2x] += faceNormalx;
    normals[v2y] += faceNormaly;
    normals[v2z] += faceNormalz;
    normals[v3x] += faceNormalx;
    normals[v3y] += faceNormaly;
    normals[v3z] += faceNormalz;
  }
  for (let index = 0; index < normals.length / 3; index++) {
    let faceNormalx = normals[index * 3];
    let faceNormaly = normals[index * 3 + 1];
    let faceNormalz = normals[index * 3 + 2];
    let length = Math.sqrt(faceNormalx * faceNormalx + faceNormaly * faceNormaly + faceNormalz * faceNormalz);
    length = length === 0 ? 1.0 : length;
    faceNormalx /= length;
    faceNormaly /= length;
    faceNormalz /= length;
    normals[index * 3] = faceNormalx;
    normals[index * 3 + 1] = faceNormaly;
    normals[index * 3 + 2] = faceNormalz;
  }
}
