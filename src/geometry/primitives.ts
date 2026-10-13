/**
 * primitives.ts — The eight primitive surfaces the tree builds from: box,
 * cylinder, torus, icosphere, sphere, polyhedron, plane and disc, as
 * `GeometryBuffer`s (the last two for the optics' glass).
 * Owns: the generators, their option shapes, and the side-orientation step
 * they share. No state but one cached unit cube (`createBox`); imports nothing
 * but `src/math/` and `buffer.ts`.
 *
 * **Each one is Babylon 9.28's `Create*VertexData`, operation for operation,
 * and must produce exactly its vertex order, normals and UVs** — one vertex
 * out of place moves every building made of it (BABYLON_EXIT.md, "Generator
 * fidelity"). `scripts/geometry-check.mjs` runs every generator against
 * Babylon's over seeded option sets and compares every number with
 * `Object.is`, so a change here owes a run of it.
 *
 * What is left out is what nothing in the tree passes: `faceUV`,
 * `faceColors`, `frontUVs` and `backUVs` (the defaults Babylon fills them with
 * are kept, as constants, so the arithmetic on them is the same), and
 * Babylon's OpenGL UV flip, which is a global nothing here sets. The arrays
 * are built as Babylon builds them, in plain arrays, and turned into a buffer
 * at the end.
 *
 * ## Licence
 *
 * Copied from Babylon.js 9.28 (`Meshes/Builders/*.pure.js`), licensed under
 * the Apache License, Version 2.0 (`node_modules/@babylonjs/core/license.md`;
 * https://www.apache.org/licenses/LICENSE-2.0). "Babylon.js — Copyright 2023
 * The Babylon.js team" (its NOTICE). Changes from the original: the options
 * above removed, the result a `GeometryBuffer` rather than a `VertexData`, and
 * `createBox`'s unit cube scaled rather than rebuilt (see there).
 */
import { Matrix, Vector3 } from "../math/index.ts";
import { computeNormalsInto, GeometryBuffer } from "./buffer.ts";

/** Babylon's `VertexData.FRONTSIDE`, `BACKSIDE` and `DOUBLESIDE`. */
export const FRONTSIDE = 0;
export const BACKSIDE = 1;
export const DOUBLESIDE = 2;

/** Babylon's `Mesh.NO_CAP`, `CAP_START`, `CAP_END` and `CAP_ALL`. */
export const NO_CAP = 0;
export const CAP_START = 1;
export const CAP_END = 2;
export const CAP_ALL = 3;

/** The `Vector4(0, 0, 1, 1)` Babylon fills an absent `faceUV` and `frontUVs` with. */
const FULL_UV = { x: 0, y: 0, z: 1, w: 1 } as const;

/** `VertexData._ComputeSides`, with its UV windows at their defaults. */
function computeSides(
  sideOrientation: number,
  positions: number[],
  indices: number[],
  normals: number[],
  uvs: number[],
): void {
  const li = indices.length;
  const ln = normals.length;
  let i;
  let n;
  sideOrientation = sideOrientation || FRONTSIDE;
  switch (sideOrientation) {
    case FRONTSIDE:
      break;
    case BACKSIDE:
      for (i = 0; i < li; i += 3) {
        const tmp = indices[i];
        indices[i] = indices[i + 2];
        indices[i + 2] = tmp;
      }
      for (n = 0; n < ln; n++) {
        normals[n] = -normals[n];
      }
      break;
    case DOUBLESIDE: {
      const lp = positions.length;
      const l = lp / 3;
      for (let p = 0; p < lp; p++) {
        positions[lp + p] = positions[p];
      }
      for (i = 0; i < li; i += 3) {
        indices[i + li] = indices[i + 2] + l;
        indices[i + 1 + li] = indices[i + 1] + l;
        indices[i + 2 + li] = indices[i] + l;
      }
      for (n = 0; n < ln; n++) {
        normals[ln + n] = -normals[n];
      }
      const lu = uvs.length;
      let u;
      for (u = 0; u < lu; u++) {
        uvs[u + lu] = uvs[u];
      }
      const frontUVs = FULL_UV;
      const backUVs = FULL_UV;
      u = 0;
      for (i = 0; i < lu / 2; i++) {
        uvs[u] = frontUVs.x + (frontUVs.z - frontUVs.x) * uvs[u];
        uvs[u + 1] = frontUVs.y + (frontUVs.w - frontUVs.y) * uvs[u + 1];
        uvs[u + lu] = backUVs.x + (backUVs.z - backUVs.x) * uvs[u + lu];
        uvs[u + lu + 1] = backUVs.y + (backUVs.w - backUVs.y) * uvs[u + lu + 1];
        u += 2;
      }
      break;
    }
  }
}

/** Babylon's own defaulting: `0` means 0, absent means the default. */
function sideOf(sideOrientation: number | undefined): number {
  return sideOrientation === 0 ? 0 : sideOrientation || FRONTSIDE;
}

function result(positions: number[], normals: number[], uvs: number[], indices: number[]): GeometryBuffer {
  return new GeometryBuffer({ positions, normals, uvs, indices });
}

// --- box ---------------------------------------------------------------------

export interface BoxOptions {
  size?: number;
  width?: number;
  height?: number;
  depth?: number;
  wrap?: boolean;
  topBaseAt?: number;
  bottomBaseAt?: number;
  sideOrientation?: number;
}

const BOX_INDICES = [
  0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11, 12, 13, 14, 12, 14, 15, 16, 17, 18, 16, 18, 19, 20, 21, 22,
  20, 22, 23,
];
const BOX_NORMALS = [
  0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1,
  0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
];
const BOX_POSITIONS = [
  1, -1, 1, -1, -1, 1, -1, 1, 1, 1, 1, 1, 1, 1, -1, -1, 1, -1, -1, -1, -1, 1, -1, -1, 1, 1, -1, 1, -1, -1, 1, -1, 1, 1,
  1, 1, -1, 1, 1, -1, -1, 1, -1, -1, -1, -1, 1, -1, -1, 1, 1, -1, 1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1, -1, -1, -1,
  -1, -1, -1, -1, 1,
];

/** The unit cube `createBox` scales, built once by the full generator. */
let UNIT_BOX: GeometryBuffer | undefined;

/**
 * `CreateBoxVertexData`.
 *
 * **Every box in the kit is the same 24 vertices** — one unit cube, scaled —
 * so a call with nothing but `width`, `height` and `depth` takes the cube
 * built ONCE at a half-extent of exactly 1 and multiplies its positions by
 * its own half-extents: the same `base * (size / 2)` product Babylon computes
 * per vertex, so not a bit moves, without Babylon's per-call `reduce` that
 * `concat`s a fresh array for each of 72 numbers (that loop was 10.6% of a
 * map install, `FINDINGS.md` 26). Any other option takes the full generator.
 * Every array is the box's OWN: a merge writes its sources in place.
 */
export function createBox(options: BoxOptions): GeometryBuffer {
  for (const key in options) {
    if (key !== "width" && key !== "height" && key !== "depth") return createBoxFull(options);
  }
  const unit = (UNIT_BOX ??= createBoxFull({ width: 2, height: 2, depth: 2 }));
  // Babylon's own defaulting, `||` and all: a zero or absent extent is 1.
  const hx = (options.width || 1) / 2;
  const hy = (options.height || 1) / 2;
  const hz = (options.depth || 1) / 2;
  const base = unit.positions;
  const positions = new Float64Array(base.length);
  for (let i = 0; i < base.length; i += 3) {
    positions[i] = base[i] * hx;
    positions[i + 1] = base[i + 1] * hy;
    positions[i + 2] = base[i + 2] * hz;
  }
  return new GeometryBuffer({
    positions,
    normals: unit.normals!.slice(),
    uvs: unit.uvs!.slice(),
    indices: unit.indices.slice(),
  });
}

function createBoxFull(options: BoxOptions): GeometryBuffer {
  const nbFaces = 6;
  let indices = BOX_INDICES.slice();
  const normals = BOX_NORMALS.slice();
  const uvs: number[] = [];
  const width = options.width || options.size || 1;
  const height = options.height || options.size || 1;
  const depth = options.depth || options.size || 1;
  const wrap = options.wrap || false;
  let topBaseAt = options.topBaseAt === void 0 ? 1 : options.topBaseAt;
  let bottomBaseAt = options.bottomBaseAt === void 0 ? 0 : options.bottomBaseAt;
  topBaseAt = (topBaseAt + 4) % 4;
  bottomBaseAt = (bottomBaseAt + 4) % 4;
  const topOrder = [2, 0, 3, 1];
  const bottomOrder = [2, 0, 1, 3];
  let topIndex = topOrder[topBaseAt];
  let bottomIndex = bottomOrder[bottomBaseAt];
  let basePositions = BOX_POSITIONS.slice();
  if (wrap) {
    indices = [2, 3, 0, 2, 0, 1, 4, 5, 6, 4, 6, 7, 9, 10, 11, 9, 11, 8, 12, 14, 15, 12, 13, 14];
    basePositions = [
      -1, 1, 1, 1, 1, 1, 1, -1, 1, -1, -1, 1, 1, 1, -1, -1, 1, -1, -1, -1, -1, 1, -1, -1, 1, 1, 1, 1, 1, -1, 1, -1, -1,
      1, -1, 1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1,
    ];
    const topFaceBase: number[][] = [
      [1, 1, 1],
      [-1, 1, 1],
      [-1, 1, -1],
      [1, 1, -1],
    ];
    const bottomFaceBase: number[][] = [
      [-1, -1, 1],
      [1, -1, 1],
      [1, -1, -1],
      [-1, -1, -1],
    ];
    const topFaceOrder = [17, 18, 19, 16];
    const bottomFaceOrder = [22, 23, 20, 21];
    while (topIndex > 0) {
      topFaceBase.unshift(topFaceBase.pop()!);
      topFaceOrder.unshift(topFaceOrder.pop()!);
      topIndex--;
    }
    while (bottomIndex > 0) {
      bottomFaceBase.unshift(bottomFaceBase.pop()!);
      bottomFaceOrder.unshift(bottomFaceOrder.pop()!);
      bottomIndex--;
    }
    const topFlat = topFaceBase.flat();
    const bottomFlat = bottomFaceBase.flat();
    basePositions = basePositions.concat(topFlat).concat(bottomFlat);
    indices.push(topFaceOrder[0], topFaceOrder[2], topFaceOrder[3], topFaceOrder[0], topFaceOrder[1], topFaceOrder[2]);
    indices.push(
      bottomFaceOrder[0],
      bottomFaceOrder[2],
      bottomFaceOrder[3],
      bottomFaceOrder[0],
      bottomFaceOrder[1],
      bottomFaceOrder[2],
    );
  }
  const scaleArray = [width / 2, height / 2, depth / 2];
  const positions = basePositions.map((value, index) => value * scaleArray[index % 3]);
  const sideOrientation = sideOf(options.sideOrientation);
  for (let index = 0; index < nbFaces; index++) {
    const uv = FULL_UV;
    uvs.push(uv.z, uv.w);
    uvs.push(uv.x, uv.w);
    uvs.push(uv.x, uv.y);
    uvs.push(uv.z, uv.y);
  }
  computeSides(sideOrientation, positions, indices, normals, uvs);
  return result(positions, normals, uvs, indices);
}

// --- cylinder ------------------------------------------------------------------

export interface CylinderOptions {
  height?: number;
  diameterTop?: number;
  diameterBottom?: number;
  diameter?: number;
  tessellation?: number;
  subdivisions?: number;
  arc?: number;
  hasRings?: boolean;
  enclose?: boolean;
  cap?: number;
  sideOrientation?: number;
}

/** `CreateCylinderVertexData`: a cylinder, cone or prism, its axis on Y. */
export function createCylinder(options: CylinderOptions): GeometryBuffer {
  const height = options.height || 2;
  let diameterTop = options.diameterTop === 0 ? 0 : options.diameterTop || options.diameter || 1;
  let diameterBottom = options.diameterBottom === 0 ? 0 : options.diameterBottom || options.diameter || 1;
  diameterTop = diameterTop || 0.00001;
  diameterBottom = diameterBottom || 0.00001;
  const tessellation = (options.tessellation || 24) | 0;
  const subdivisions = (options.subdivisions || 1) | 0;
  const hasRings = options.hasRings ? true : false;
  const enclose = options.enclose ? true : false;
  const cap = options.cap === 0 ? 0 : options.cap || CAP_ALL;
  const arc = options.arc && (options.arc <= 0 || options.arc > 1) ? 1.0 : options.arc || 1.0;
  const sideOrientation = sideOf(options.sideOrientation);
  const quadNb = arc !== 1 && enclose ? 2 : 0;
  const ringNb = hasRings ? subdivisions : 1;
  const surfaceNb = 2 + (1 + quadNb) * ringNb;
  const faceUV = new Array(surfaceNb).fill(FULL_UV) as (typeof FULL_UV)[];
  const indices: number[] = [];
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const angleStep = (Math.PI * 2 * arc) / tessellation;
  let angle;
  let h;
  let radius;
  const tan = (diameterBottom - diameterTop) / 2 / height;
  const ringVertex = Vector3.Zero();
  const ringNormal = Vector3.Zero();
  const ringFirstVertex = Vector3.Zero();
  const ringFirstNormal = Vector3.Zero();
  const quadNormal = Vector3.Zero();
  const y = Vector3.Up();
  let i;
  let j;
  let r;
  let ringIdx;
  let s = 1;
  let cs = 0;
  let v;
  for (i = 0; i <= subdivisions; i++) {
    h = i / subdivisions;
    radius = (h * (diameterTop - diameterBottom) + diameterBottom) / 2;
    ringIdx = hasRings && i !== 0 && i !== subdivisions ? 2 : 1;
    for (r = 0; r < ringIdx; r++) {
      if (hasRings) {
        s += r;
      }
      if (enclose) {
        s += 2 * r;
      }
      for (j = 0; j <= tessellation; j++) {
        angle = j * angleStep;
        ringVertex.x = Math.cos(-angle) * radius;
        ringVertex.y = -height / 2 + h * height;
        ringVertex.z = Math.sin(-angle) * radius;
        if (diameterTop === 0 && i === subdivisions) {
          ringNormal.x = normals[normals.length - (tessellation + 1) * 3];
          ringNormal.y = normals[normals.length - (tessellation + 1) * 3 + 1];
          ringNormal.z = normals[normals.length - (tessellation + 1) * 3 + 2];
        } else {
          ringNormal.x = ringVertex.x;
          ringNormal.z = ringVertex.z;
          ringNormal.y = Math.sqrt(ringNormal.x * ringNormal.x + ringNormal.z * ringNormal.z) * tan;
          ringNormal.normalize();
        }
        if (j === 0) {
          ringFirstVertex.copyFrom(ringVertex);
          ringFirstNormal.copyFrom(ringNormal);
        }
        positions.push(ringVertex.x, ringVertex.y, ringVertex.z);
        normals.push(ringNormal.x, ringNormal.y, ringNormal.z);
        if (hasRings) {
          v = cs !== s ? faceUV[s].y : faceUV[s].w;
        } else {
          v = faceUV[s].y + (faceUV[s].w - faceUV[s].y) * h;
        }
        uvs.push(faceUV[s].x + ((faceUV[s].z - faceUV[s].x) * j) / tessellation, v);
      }
      if (arc !== 1 && enclose) {
        positions.push(ringVertex.x, ringVertex.y, ringVertex.z);
        positions.push(0, ringVertex.y, 0);
        positions.push(0, ringVertex.y, 0);
        positions.push(ringFirstVertex.x, ringFirstVertex.y, ringFirstVertex.z);
        Vector3.CrossToRef(y, ringNormal, quadNormal);
        quadNormal.normalize();
        normals.push(quadNormal.x, quadNormal.y, quadNormal.z, quadNormal.x, quadNormal.y, quadNormal.z);
        Vector3.CrossToRef(ringFirstNormal, y, quadNormal);
        quadNormal.normalize();
        normals.push(quadNormal.x, quadNormal.y, quadNormal.z, quadNormal.x, quadNormal.y, quadNormal.z);
        if (hasRings) {
          v = cs !== s ? faceUV[s + 1].y : faceUV[s + 1].w;
        } else {
          v = faceUV[s + 1].y + (faceUV[s + 1].w - faceUV[s + 1].y) * h;
        }
        uvs.push(faceUV[s + 1].x, v);
        uvs.push(faceUV[s + 1].z, v);
        if (hasRings) {
          v = cs !== s ? faceUV[s + 2].y : faceUV[s + 2].w;
        } else {
          v = faceUV[s + 2].y + (faceUV[s + 2].w - faceUV[s + 2].y) * h;
        }
        uvs.push(faceUV[s + 2].x, v);
        uvs.push(faceUV[s + 2].z, v);
      }
      if (cs !== s) {
        cs = s;
      }
    }
  }
  const e = arc !== 1 && enclose ? tessellation + 4 : tessellation;
  i = 0;
  for (s = 0; s < subdivisions; s++) {
    let i0 = 0;
    let i1 = 0;
    let i2 = 0;
    let i3 = 0;
    for (j = 0; j < tessellation; j++) {
      i0 = i * (e + 1) + j;
      i1 = (i + 1) * (e + 1) + j;
      i2 = i * (e + 1) + (j + 1);
      i3 = (i + 1) * (e + 1) + (j + 1);
      indices.push(i0, i1, i2);
      indices.push(i3, i2, i1);
    }
    if (arc !== 1 && enclose) {
      indices.push(i0 + 2, i1 + 2, i2 + 2);
      indices.push(i3 + 2, i2 + 2, i1 + 2);
      indices.push(i0 + 4, i1 + 4, i2 + 4);
      indices.push(i3 + 4, i2 + 4, i1 + 4);
    }
    i = hasRings ? i + 2 : i + 1;
  }
  const createCylinderCap = (isTop: boolean): void => {
    const radius = isTop ? diameterTop / 2 : diameterBottom / 2;
    if (radius === 0) {
      return;
    }
    let angle;
    let circleVector;
    let i;
    const u = isTop ? faceUV[surfaceNb - 1] : faceUV[0];
    const vbase = positions.length / 3;
    const offset = isTop ? height / 2 : -height / 2;
    const center = new Vector3(0, offset, 0);
    positions.push(center.x, center.y, center.z);
    normals.push(0, isTop ? 1 : -1, 0);
    const v = u.y + (u.w - u.y) * 0.5;
    uvs.push(u.x + (u.z - u.x) * 0.5, v);
    // Babylon's `Vector2(0.5, 0.5)`.
    const textureScale = { x: 0.5, y: 0.5 };
    for (i = 0; i <= tessellation; i++) {
      angle = (Math.PI * 2 * i * arc) / tessellation;
      const cos = Math.cos(-angle);
      const sin = Math.sin(-angle);
      circleVector = new Vector3(cos * radius, offset, sin * radius);
      const textureCoordinate = { x: cos * textureScale.x + 0.5, y: sin * textureScale.y + 0.5 };
      positions.push(circleVector.x, circleVector.y, circleVector.z);
      normals.push(0, isTop ? 1 : -1, 0);
      const v = u.y + (u.w - u.y) * textureCoordinate.y;
      uvs.push(u.x + (u.z - u.x) * textureCoordinate.x, v);
    }
    for (i = 0; i < tessellation; i++) {
      if (!isTop) {
        indices.push(vbase);
        indices.push(vbase + (i + 1));
        indices.push(vbase + (i + 2));
      } else {
        indices.push(vbase);
        indices.push(vbase + (i + 2));
        indices.push(vbase + (i + 1));
      }
    }
  };
  if (cap === CAP_START || cap === CAP_ALL) {
    createCylinderCap(false);
  }
  if (cap === CAP_END || cap === CAP_ALL) {
    createCylinderCap(true);
  }
  computeSides(sideOrientation, positions, indices, normals, uvs);
  return result(positions, normals, uvs, indices);
}

// --- torus ---------------------------------------------------------------------

export interface TorusOptions {
  diameter?: number;
  thickness?: number;
  tessellation?: number;
  sideOrientation?: number;
}

/** `CreateTorusVertexData`: a ring in the XZ plane, round the Y axis. */
export function createTorus(options: TorusOptions): GeometryBuffer {
  const indices: number[] = [];
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const diameter = options.diameter || 1;
  const thickness = options.thickness || 0.5;
  const tessellation = (options.tessellation || 16) | 0;
  const sideOrientation = sideOf(options.sideOrientation);
  const stride = tessellation + 1;
  for (let i = 0; i <= tessellation; i++) {
    const u = i / tessellation;
    const outerAngle = (i * Math.PI * 2.0) / tessellation - Math.PI / 2.0;
    const transform = Matrix.Translation(diameter / 2.0, 0, 0).multiply(Matrix.RotationY(outerAngle));
    for (let j = 0; j <= tessellation; j++) {
      const v = 1 - j / tessellation;
      const innerAngle = (j * Math.PI * 2.0) / tessellation + Math.PI;
      const dx = Math.cos(innerAngle);
      const dy = Math.sin(innerAngle);
      let normal = new Vector3(dx, dy, 0);
      let position = normal.scale(thickness / 2);
      const textureCoordinate = { x: u, y: v };
      position = Vector3.TransformCoordinates(position, transform);
      normal = Vector3.TransformNormal(normal, transform);
      positions.push(position.x, position.y, position.z);
      normals.push(normal.x, normal.y, normal.z);
      uvs.push(textureCoordinate.x, textureCoordinate.y);
      const nextI = (i + 1) % stride;
      const nextJ = (j + 1) % stride;
      indices.push(i * stride + j);
      indices.push(i * stride + nextJ);
      indices.push(nextI * stride + j);
      indices.push(i * stride + nextJ);
      indices.push(nextI * stride + nextJ);
      indices.push(nextI * stride + j);
    }
  }
  computeSides(sideOrientation, positions, indices, normals, uvs);
  return result(positions, normals, uvs, indices);
}

// --- icosphere -------------------------------------------------------------------

export interface IcoSphereOptions {
  radius?: number;
  radiusX?: number;
  radiusY?: number;
  radiusZ?: number;
  flat?: boolean;
  subdivisions?: number;
  sideOrientation?: number;
}

/** Babylon's `Vector2`, as far as the icosphere uses one. */
class Uv {
  x = 0;
  y = 0;
  copyFromFloats(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }
  /** `Vector2.Lerp` -> `LerpToRef`. */
  static Lerp(start: Uv, end: Uv, amount: number): Uv {
    const result = new Uv();
    result.x = start.x + (end.x - start.x) * amount;
    result.y = start.y + (end.y - start.y) * amount;
    return result;
  }
}

/** `CreateIcoSphereVertexData`: a subdivided icosahedron pushed out to a sphere. */
export function createIcoSphere(options: IcoSphereOptions): GeometryBuffer {
  // NOT `sideOf`: Babylon's icosphere reads `options.sideOrientation ||
  // DEFAULTSIDE`, so an explicit 0 is the default too — the same answer.
  const sideOrientation = options.sideOrientation || FRONTSIDE;
  const radius = options.radius || 1;
  const flat = options.flat === undefined ? true : options.flat;
  const subdivisions = (options.subdivisions || 4) | 0;
  const radiusX = options.radiusX || radius;
  const radiusY = options.radiusY || radius;
  const radiusZ = options.radiusZ || radius;
  const t = (1 + Math.sqrt(5)) / 2;
  const icoVertices = [
    -1, t, -0, 1, t, 0, -1, -t, 0, 1, -t, 0, 0, -1, -t, 0, 1, -t, 0, -1, t, 0, 1, t, t, 0, 1, t, 0, -1, -t, 0, 1, -t, 0,
    -1,
  ];
  const icoIndices = [
    0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 12, 22, 23, 1, 5, 20, 5, 11, 4, 23, 22, 13, 22, 18, 6, 7, 1, 8, 14, 21, 4, 14,
    4, 2, 16, 13, 6, 15, 6, 19, 3, 8, 9, 4, 21, 5, 13, 17, 23, 6, 13, 22, 19, 6, 18, 9, 8, 1,
  ];
  const verticesUnaliasId = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 2, 3, 3, 3, 4, 7, 8, 9, 9, 10, 11];
  const icoVertexuv = [
    5, 1, 3, 1, 6, 4, 0, 0, 5, 3, 4, 2, 2, 2, 4, 0, 2, 0, 1, 1, 6, 0, 6, 2, 0, 4, 3, 3, 4, 4, 3, 1, 4, 2, 4, 4, 0, 2, 1,
    1, 2, 2, 3, 3, 1, 3, 2, 4,
  ];
  const ustep = 138 / 1024;
  const vstep = 239 / 1024;
  const uoffset = 60 / 1024;
  const voffset = 26 / 1024;
  const islandUoffset = -40 / 1024;
  const islandVoffset = +20 / 1024;
  const island = [0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 0];
  const indices: number[] = [];
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  let currentIndice = 0;
  const faceVertexPos: Vector3[] = new Array(3);
  const faceVertexUv: Uv[] = new Array(3);
  let v012;
  for (v012 = 0; v012 < 3; v012++) {
    faceVertexPos[v012] = Vector3.Zero();
    faceVertexUv[v012] = new Uv();
  }
  for (let face = 0; face < 20; face++) {
    for (v012 = 0; v012 < 3; v012++) {
      const vId = icoIndices[3 * face + v012];
      faceVertexPos[v012].copyFromFloats(
        icoVertices[3 * verticesUnaliasId[vId]],
        icoVertices[3 * verticesUnaliasId[vId] + 1],
        icoVertices[3 * verticesUnaliasId[vId] + 2],
      );
      faceVertexPos[v012].normalize();
      faceVertexUv[v012].copyFromFloats(
        icoVertexuv[2 * vId] * ustep + uoffset + island[face] * islandUoffset,
        icoVertexuv[2 * vId + 1] * vstep + voffset + island[face] * islandVoffset,
      );
    }
    const interpVertex = (i1: number, i2: number, c1: number, c2: number): void => {
      const posX0 = Vector3.Lerp(faceVertexPos[0], faceVertexPos[2], i2 / subdivisions);
      const posX1 = Vector3.Lerp(faceVertexPos[1], faceVertexPos[2], i2 / subdivisions);
      // At the apex this IS the face's third corner, normalised in place — as
      // Babylon's is, which the next face never sees: it re-reads every corner.
      const posInterp = subdivisions === i2 ? faceVertexPos[2] : Vector3.Lerp(posX0, posX1, i1 / (subdivisions - i2));
      posInterp.normalize();
      let vertexNormal;
      if (flat) {
        const centroidX0 = Vector3.Lerp(faceVertexPos[0], faceVertexPos[2], c2 / subdivisions);
        const centroidX1 = Vector3.Lerp(faceVertexPos[1], faceVertexPos[2], c2 / subdivisions);
        vertexNormal = Vector3.Lerp(centroidX0, centroidX1, c1 / (subdivisions - c2));
      } else {
        vertexNormal = new Vector3(posInterp.x, posInterp.y, posInterp.z);
      }
      vertexNormal.x /= radiusX;
      vertexNormal.y /= radiusY;
      vertexNormal.z /= radiusZ;
      vertexNormal.normalize();
      const uvX0 = Uv.Lerp(faceVertexUv[0], faceVertexUv[2], i2 / subdivisions);
      const uvX1 = Uv.Lerp(faceVertexUv[1], faceVertexUv[2], i2 / subdivisions);
      const uvInterp = subdivisions === i2 ? faceVertexUv[2] : Uv.Lerp(uvX0, uvX1, i1 / (subdivisions - i2));
      positions.push(posInterp.x * radiusX, posInterp.y * radiusY, posInterp.z * radiusZ);
      normals.push(vertexNormal.x, vertexNormal.y, vertexNormal.z);
      uvs.push(uvInterp.x, uvInterp.y);
      indices.push(currentIndice);
      currentIndice++;
    };
    for (let i2 = 0; i2 < subdivisions; i2++) {
      for (let i1 = 0; i1 + i2 < subdivisions; i1++) {
        interpVertex(i1, i2, i1 + 1.0 / 3, i2 + 1.0 / 3);
        interpVertex(i1 + 1, i2, i1 + 1.0 / 3, i2 + 1.0 / 3);
        interpVertex(i1, i2 + 1, i1 + 1.0 / 3, i2 + 1.0 / 3);
        if (i1 + i2 + 1 < subdivisions) {
          interpVertex(i1 + 1, i2, i1 + 2.0 / 3, i2 + 2.0 / 3);
          interpVertex(i1 + 1, i2 + 1, i1 + 2.0 / 3, i2 + 2.0 / 3);
          interpVertex(i1, i2 + 1, i1 + 2.0 / 3, i2 + 2.0 / 3);
        }
      }
    }
  }
  computeSides(sideOrientation, positions, indices, normals, uvs);
  return result(positions, normals, uvs, indices);
}

// --- sphere ----------------------------------------------------------------------

export interface SphereOptions {
  segments?: number;
  diameter?: number;
  diameterX?: number;
  diameterY?: number;
  diameterZ?: number;
  arc?: number;
  slice?: number;
  dedupTopBottomIndices?: boolean;
  sideOrientation?: number;
}

/** `CreateSphereVertexData`: an ellipsoid of latitude rings. */
export function createSphere(options: SphereOptions): GeometryBuffer {
  const segments = (options.segments || 32) | 0;
  const diameterX = options.diameterX || options.diameter || 1;
  const diameterY = options.diameterY || options.diameter || 1;
  const diameterZ = options.diameterZ || options.diameter || 1;
  const arc = options.arc && (options.arc <= 0 || options.arc > 1) ? 1.0 : options.arc || 1.0;
  const slice = options.slice && options.slice <= 0 ? 1.0 : options.slice || 1.0;
  const sideOrientation = sideOf(options.sideOrientation);
  const dedupTopBottomIndices = !!options.dedupTopBottomIndices;
  const radius = new Vector3(diameterX / 2, diameterY / 2, diameterZ / 2);
  const totalZRotationSteps = 2 + segments;
  const totalYRotationSteps = 2 * totalZRotationSteps;
  const indices: number[] = [];
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  for (let zRotationStep = 0; zRotationStep <= totalZRotationSteps; zRotationStep++) {
    const normalizedZ = zRotationStep / totalZRotationSteps;
    const angleZ = normalizedZ * Math.PI * slice;
    for (let yRotationStep = 0; yRotationStep <= totalYRotationSteps; yRotationStep++) {
      const normalizedY = yRotationStep / totalYRotationSteps;
      const angleY = normalizedY * Math.PI * 2 * arc;
      const rotationZ = Matrix.RotationZ(-angleZ);
      const rotationY = Matrix.RotationY(angleY);
      const afterRotZ = Vector3.TransformCoordinates(Vector3.Up(), rotationZ);
      const complete = Vector3.TransformCoordinates(afterRotZ, rotationY);
      const vertex = complete.multiply(radius);
      const normal = complete.divide(radius).normalize();
      positions.push(vertex.x, vertex.y, vertex.z);
      normals.push(normal.x, normal.y, normal.z);
      uvs.push(normalizedY, normalizedZ);
    }
    if (zRotationStep > 0) {
      const verticesCount = positions.length / 3;
      for (
        let firstIndex = verticesCount - 2 * (totalYRotationSteps + 1);
        firstIndex + totalYRotationSteps + 2 < verticesCount;
        firstIndex++
      ) {
        if (dedupTopBottomIndices) {
          if (zRotationStep > 1) {
            indices.push(firstIndex);
            indices.push(firstIndex + 1);
            indices.push(firstIndex + totalYRotationSteps + 1);
          }
          if (zRotationStep < totalZRotationSteps || slice < 1.0) {
            indices.push(firstIndex + totalYRotationSteps + 1);
            indices.push(firstIndex + 1);
            indices.push(firstIndex + totalYRotationSteps + 2);
          }
        } else {
          indices.push(firstIndex);
          indices.push(firstIndex + 1);
          indices.push(firstIndex + totalYRotationSteps + 1);
          indices.push(firstIndex + totalYRotationSteps + 1);
          indices.push(firstIndex + 1);
          indices.push(firstIndex + totalYRotationSteps + 2);
        }
      }
    }
  }
  computeSides(sideOrientation, positions, indices, normals, uvs);
  return result(positions, normals, uvs, indices);
}

// --- polyhedron ------------------------------------------------------------------

export interface PolyhedronData {
  vertex: number[][];
  face: number[][];
}

export interface PolyhedronOptions {
  type?: number;
  size?: number;
  sizeX?: number;
  sizeY?: number;
  sizeZ?: number;
  custom?: PolyhedronData;
  flat?: boolean;
  sideOrientation?: number;
}

/**
 * `CreatePolyhedronVertexData`: one of Babylon's fifteen solids (0
 * tetrahedron, 1 octahedron, 2 dodecahedron, 3 icosahedron, 4
 * rhombicuboctahedron, 5-7 the triangular, pentagonal and hexagonal prisms,
 * 8-14 the Johnson solids J1, J2, J12, J13, J15, J16 and J20), or `custom`.
 */
export function createPolyhedron(options: PolyhedronOptions): GeometryBuffer {
  const polyhedra = POLYHEDRA;
  const type = options.type && (options.type < 0 || options.type >= polyhedra.length) ? 0 : options.type || 0;
  const size = options.size;
  const sizeX = options.sizeX || size || 1;
  const sizeY = options.sizeY || size || 1;
  const sizeZ = options.sizeZ || size || 1;
  const data = options.custom || polyhedra[type];
  const nbfaces = data.face.length;
  const faceUV = new Array(nbfaces).fill(FULL_UV) as (typeof FULL_UV)[];
  const flat = options.flat === undefined ? true : options.flat;
  const sideOrientation = sideOf(options.sideOrientation);
  const positions: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  let index = 0;
  let faceIdx = 0;
  const indexes: number[] = [];
  let i;
  let f;
  let u, v, ang, x, y, tmp;
  if (!flat) {
    for (i = 0; i < data.vertex.length; i++) {
      positions.push(data.vertex[i][0] * sizeX, data.vertex[i][1] * sizeY, data.vertex[i][2] * sizeZ);
      uvs.push(0, 0);
    }
    for (f = 0; f < nbfaces; f++) {
      for (i = 0; i < data.face[f].length - 2; i++) {
        indices.push(data.face[f][0], data.face[f][i + 2], data.face[f][i + 1]);
      }
    }
  } else {
    for (f = 0; f < nbfaces; f++) {
      const fl = data.face[f].length;
      ang = (2 * Math.PI) / fl;
      x = 0.5 * Math.tan(ang / 2);
      y = 0.5;
      for (i = 0; i < fl; i++) {
        positions.push(
          data.vertex[data.face[f][i]][0] * sizeX,
          data.vertex[data.face[f][i]][1] * sizeY,
          data.vertex[data.face[f][i]][2] * sizeZ,
        );
        indexes.push(index);
        index++;
        u = faceUV[f].x + (faceUV[f].z - faceUV[f].x) * (0.5 + x);
        v = faceUV[f].y + (faceUV[f].w - faceUV[f].y) * (y - 0.5);
        uvs.push(u, v);
        tmp = x * Math.cos(ang) - y * Math.sin(ang);
        y = x * Math.sin(ang) + y * Math.cos(ang);
        x = tmp;
      }
      for (i = 0; i < fl - 2; i++) {
        indices.push(indexes[0 + faceIdx], indexes[i + 2 + faceIdx], indexes[i + 1 + faceIdx]);
      }
      faceIdx += fl;
    }
  }
  computeNormalsInto(positions, indices, normals);
  computeSides(sideOrientation, positions, indices, normals, uvs);
  return result(positions, normals, uvs, indices);
}

/** Babylon's fifteen solids, verbatim. */
const POLYHEDRA: PolyhedronData[] = [];
POLYHEDRA[0] = {
  vertex: [
    [0, 0, 1.732051],
    [1.632993, 0, -0.5773503],
    [-0.8164966, 1.414214, -0.5773503],
    [-0.8164966, -1.414214, -0.5773503],
  ],
  face: [
    [0, 1, 2],
    [0, 2, 3],
    [0, 3, 1],
    [1, 3, 2],
  ],
};
POLYHEDRA[1] = {
  vertex: [
    [0, 0, 1.414214],
    [1.414214, 0, 0],
    [0, 1.414214, 0],
    [-1.414214, 0, 0],
    [0, -1.414214, 0],
    [0, 0, -1.414214],
  ],
  face: [
    [0, 1, 2],
    [0, 2, 3],
    [0, 3, 4],
    [0, 4, 1],
    [1, 4, 5],
    [1, 5, 2],
    [2, 5, 3],
    [3, 5, 4],
  ],
};
POLYHEDRA[2] = {
  vertex: [
    [0, 0, 1.070466],
    [0.7136442, 0, 0.7978784],
    [-0.3568221, 0.618034, 0.7978784],
    [-0.3568221, -0.618034, 0.7978784],
    [0.7978784, 0.618034, 0.3568221],
    [0.7978784, -0.618034, 0.3568221],
    [-0.9341724, 0.381966, 0.3568221],
    [0.1362939, 1, 0.3568221],
    [0.1362939, -1, 0.3568221],
    [-0.9341724, -0.381966, 0.3568221],
    [0.9341724, 0.381966, -0.3568221],
    [0.9341724, -0.381966, -0.3568221],
    [-0.7978784, 0.618034, -0.3568221],
    [-0.1362939, 1, -0.3568221],
    [-0.1362939, -1, -0.3568221],
    [-0.7978784, -0.618034, -0.3568221],
    [0.3568221, 0.618034, -0.7978784],
    [0.3568221, -0.618034, -0.7978784],
    [-0.7136442, 0, -0.7978784],
    [0, 0, -1.070466],
  ],
  face: [
    [0, 1, 4, 7, 2],
    [0, 2, 6, 9, 3],
    [0, 3, 8, 5, 1],
    [1, 5, 11, 10, 4],
    [2, 7, 13, 12, 6],
    [3, 9, 15, 14, 8],
    [4, 10, 16, 13, 7],
    [5, 8, 14, 17, 11],
    [6, 12, 18, 15, 9],
    [10, 11, 17, 19, 16],
    [12, 13, 16, 19, 18],
    [14, 15, 18, 19, 17],
  ],
};
POLYHEDRA[3] = {
  vertex: [
    [0, 0, 1.175571],
    [1.051462, 0, 0.5257311],
    [0.3249197, 1, 0.5257311],
    [-0.8506508, 0.618034, 0.5257311],
    [-0.8506508, -0.618034, 0.5257311],
    [0.3249197, -1, 0.5257311],
    [0.8506508, 0.618034, -0.5257311],
    [0.8506508, -0.618034, -0.5257311],
    [-0.3249197, 1, -0.5257311],
    [-1.051462, 0, -0.5257311],
    [-0.3249197, -1, -0.5257311],
    [0, 0, -1.175571],
  ],
  face: [
    [0, 1, 2],
    [0, 2, 3],
    [0, 3, 4],
    [0, 4, 5],
    [0, 5, 1],
    [1, 5, 7],
    [1, 7, 6],
    [1, 6, 2],
    [2, 6, 8],
    [2, 8, 3],
    [3, 8, 9],
    [3, 9, 4],
    [4, 9, 10],
    [4, 10, 5],
    [5, 10, 7],
    [6, 7, 11],
    [6, 11, 8],
    [7, 10, 11],
    [8, 11, 9],
    [9, 11, 10],
  ],
};
POLYHEDRA[4] = {
  vertex: [
    [0, 0, 1.070722],
    [0.7148135, 0, 0.7971752],
    [-0.104682, 0.7071068, 0.7971752],
    [-0.6841528, 0.2071068, 0.7971752],
    [-0.104682, -0.7071068, 0.7971752],
    [0.6101315, 0.7071068, 0.5236279],
    [1.04156, 0.2071068, 0.1367736],
    [0.6101315, -0.7071068, 0.5236279],
    [-0.3574067, 1, 0.1367736],
    [-0.7888348, -0.5, 0.5236279],
    [-0.9368776, 0.5, 0.1367736],
    [-0.3574067, -1, 0.1367736],
    [0.3574067, 1, -0.1367736],
    [0.9368776, -0.5, -0.1367736],
    [0.7888348, 0.5, -0.5236279],
    [0.3574067, -1, -0.1367736],
    [-0.6101315, 0.7071068, -0.5236279],
    [-1.04156, -0.2071068, -0.1367736],
    [-0.6101315, -0.7071068, -0.5236279],
    [0.104682, 0.7071068, -0.7971752],
    [0.6841528, -0.2071068, -0.7971752],
    [0.104682, -0.7071068, -0.7971752],
    [-0.7148135, 0, -0.7971752],
    [0, 0, -1.070722],
  ],
  face: [
    [0, 2, 3],
    [1, 6, 5],
    [4, 9, 11],
    [7, 15, 13],
    [8, 16, 10],
    [12, 14, 19],
    [17, 22, 18],
    [20, 21, 23],
    [0, 1, 5, 2],
    [0, 3, 9, 4],
    [0, 4, 7, 1],
    [1, 7, 13, 6],
    [2, 5, 12, 8],
    [2, 8, 10, 3],
    [3, 10, 17, 9],
    [4, 11, 15, 7],
    [5, 6, 14, 12],
    [6, 13, 20, 14],
    [8, 12, 19, 16],
    [9, 17, 18, 11],
    [10, 16, 22, 17],
    [11, 18, 21, 15],
    [13, 15, 21, 20],
    [14, 20, 23, 19],
    [16, 19, 23, 22],
    [18, 22, 23, 21],
  ],
};
POLYHEDRA[5] = {
  vertex: [
    [0, 0, 1.322876],
    [1.309307, 0, 0.1889822],
    [-0.9819805, 0.8660254, 0.1889822],
    [0.1636634, -1.299038, 0.1889822],
    [0.3273268, 0.8660254, -0.9449112],
    [-0.8183171, -0.4330127, -0.9449112],
  ],
  face: [
    [0, 3, 1],
    [2, 4, 5],
    [0, 1, 4, 2],
    [0, 2, 5, 3],
    [1, 3, 5, 4],
  ],
};
POLYHEDRA[6] = {
  vertex: [
    [0, 0, 1.159953],
    [1.013464, 0, 0.5642542],
    [-0.3501431, 0.9510565, 0.5642542],
    [-0.7715208, -0.6571639, 0.5642542],
    [0.6633206, 0.9510565, -0.03144481],
    [0.8682979, -0.6571639, -0.3996071],
    [-1.121664, 0.2938926, -0.03144481],
    [-0.2348831, -1.063314, -0.3996071],
    [0.5181548, 0.2938926, -0.9953061],
    [-0.5850262, -0.112257, -0.9953061],
  ],
  face: [
    [0, 1, 4, 2],
    [0, 2, 6, 3],
    [1, 5, 8, 4],
    [3, 6, 9, 7],
    [5, 7, 9, 8],
    [0, 3, 7, 5, 1],
    [2, 4, 8, 9, 6],
  ],
};
POLYHEDRA[7] = {
  vertex: [
    [0, 0, 1.118034],
    [0.8944272, 0, 0.6708204],
    [-0.2236068, 0.8660254, 0.6708204],
    [-0.7826238, -0.4330127, 0.6708204],
    [0.6708204, 0.8660254, 0.2236068],
    [1.006231, -0.4330127, -0.2236068],
    [-1.006231, 0.4330127, 0.2236068],
    [-0.6708204, -0.8660254, -0.2236068],
    [0.7826238, 0.4330127, -0.6708204],
    [0.2236068, -0.8660254, -0.6708204],
    [-0.8944272, 0, -0.6708204],
    [0, 0, -1.118034],
  ],
  face: [
    [0, 1, 4, 2],
    [0, 2, 6, 3],
    [1, 5, 8, 4],
    [3, 6, 10, 7],
    [5, 9, 11, 8],
    [7, 10, 11, 9],
    [0, 3, 7, 9, 5, 1],
    [2, 4, 8, 11, 10, 6],
  ],
};
POLYHEDRA[8] = {
  vertex: [
    [-0.729665, 0.670121, 0.319155],
    [-0.655235, -0.29213, -0.754096],
    [-0.093922, -0.607123, 0.537818],
    [0.702196, 0.595691, 0.485187],
    [0.776626, -0.36656, -0.588064],
  ],
  face: [
    [1, 4, 2],
    [0, 1, 2],
    [3, 0, 2],
    [4, 3, 2],
    [4, 1, 0, 3],
  ],
};
POLYHEDRA[9] = {
  vertex: [
    [-0.868849, -0.100041, 0.61257],
    [-0.329458, 0.976099, 0.28078],
    [-0.26629, -0.013796, -0.477654],
    [-0.13392, -1.034115, 0.229829],
    [0.738834, 0.707117, -0.307018],
    [0.859683, -0.535264, -0.338508],
  ],
  face: [
    [3, 0, 2],
    [5, 3, 2],
    [4, 5, 2],
    [1, 4, 2],
    [0, 1, 2],
    [0, 3, 5, 4, 1],
  ],
};
POLYHEDRA[10] = {
  vertex: [
    [-0.610389, 0.243975, 0.531213],
    [-0.187812, -0.48795, -0.664016],
    [-0.187812, 0.9759, -0.664016],
    [0.187812, -0.9759, 0.664016],
    [0.798201, 0.243975, 0.132803],
  ],
  face: [
    [1, 3, 0],
    [3, 4, 0],
    [3, 1, 4],
    [0, 2, 1],
    [0, 4, 2],
    [2, 4, 1],
  ],
};
POLYHEDRA[11] = {
  vertex: [
    [-1.028778, 0.392027, -0.048786],
    [-0.640503, -0.646161, 0.621837],
    [-0.125162, -0.395663, -0.540059],
    [0.004683, 0.888447, -0.651988],
    [0.125161, 0.395663, 0.540059],
    [0.632925, -0.791376, 0.433102],
    [1.031672, 0.157063, -0.354165],
  ],
  face: [
    [3, 2, 0],
    [2, 1, 0],
    [2, 5, 1],
    [0, 4, 3],
    [0, 1, 4],
    [4, 1, 5],
    [2, 3, 6],
    [3, 4, 6],
    [5, 2, 6],
    [4, 5, 6],
  ],
};
POLYHEDRA[12] = {
  vertex: [
    [-0.669867, 0.334933, -0.529576],
    [-0.669867, 0.334933, 0.529577],
    [-0.4043, 1.212901, 0],
    [-0.334933, -0.669867, -0.529576],
    [-0.334933, -0.669867, 0.529577],
    [0.334933, 0.669867, -0.529576],
    [0.334933, 0.669867, 0.529577],
    [0.4043, -1.212901, 0],
    [0.669867, -0.334933, -0.529576],
    [0.669867, -0.334933, 0.529577],
  ],
  face: [
    [8, 9, 7],
    [6, 5, 2],
    [3, 8, 7],
    [5, 0, 2],
    [4, 3, 7],
    [0, 1, 2],
    [9, 4, 7],
    [1, 6, 2],
    [9, 8, 5, 6],
    [8, 3, 0, 5],
    [3, 4, 1, 0],
    [4, 9, 6, 1],
  ],
};
POLYHEDRA[13] = {
  vertex: [
    [-0.931836, 0.219976, -0.264632],
    [-0.636706, 0.318353, 0.692816],
    [-0.613483, -0.735083, -0.264632],
    [-0.326545, 0.979634, 0],
    [-0.318353, -0.636706, 0.692816],
    [-0.159176, 0.477529, -0.856368],
    [0.159176, -0.477529, -0.856368],
    [0.318353, 0.636706, 0.692816],
    [0.326545, -0.979634, 0],
    [0.613482, 0.735082, -0.264632],
    [0.636706, -0.318353, 0.692816],
    [0.931835, -0.219977, -0.264632],
  ],
  face: [
    [11, 10, 8],
    [7, 9, 3],
    [6, 11, 8],
    [9, 5, 3],
    [2, 6, 8],
    [5, 0, 3],
    [4, 2, 8],
    [0, 1, 3],
    [10, 4, 8],
    [1, 7, 3],
    [10, 11, 9, 7],
    [11, 6, 5, 9],
    [6, 2, 0, 5],
    [2, 4, 1, 0],
    [4, 10, 7, 1],
  ],
};
POLYHEDRA[14] = {
  vertex: [
    [-0.93465, 0.300459, -0.271185],
    [-0.838689, -0.260219, -0.516017],
    [-0.711319, 0.717591, 0.128359],
    [-0.710334, -0.156922, 0.080946],
    [-0.599799, 0.556003, -0.725148],
    [-0.503838, -0.004675, -0.969981],
    [-0.487004, 0.26021, 0.48049],
    [-0.460089, -0.750282, -0.512622],
    [-0.376468, 0.973135, -0.325605],
    [-0.331735, -0.646985, 0.084342],
    [-0.254001, 0.831847, 0.530001],
    [-0.125239, -0.494738, -0.966586],
    [0.029622, 0.027949, 0.730817],
    [0.056536, -0.982543, -0.262295],
    [0.08085, 1.087391, 0.076037],
    [0.125583, -0.532729, 0.485984],
    [0.262625, 0.599586, 0.780328],
    [0.391387, -0.726999, -0.716259],
    [0.513854, -0.868287, 0.139347],
    [0.597475, 0.85513, 0.326364],
    [0.641224, 0.109523, 0.783723],
    [0.737185, -0.451155, 0.538891],
    [0.848705, -0.612742, -0.314616],
    [0.976075, 0.365067, 0.32976],
    [1.072036, -0.19561, 0.084927],
  ],
  face: [
    [15, 18, 21],
    [12, 20, 16],
    [6, 10, 2],
    [3, 0, 1],
    [9, 7, 13],
    [2, 8, 4, 0],
    [0, 4, 5, 1],
    [1, 5, 11, 7],
    [7, 11, 17, 13],
    [13, 17, 22, 18],
    [18, 22, 24, 21],
    [21, 24, 23, 20],
    [20, 23, 19, 16],
    [16, 19, 14, 10],
    [10, 14, 8, 2],
    [15, 9, 13, 18],
    [12, 15, 21, 20],
    [6, 12, 16, 10],
    [3, 6, 2, 0],
    [9, 3, 1, 7],
    [9, 15, 12, 6, 3],
    [22, 17, 11, 5, 4, 8, 14, 19, 23, 24],
  ],
};

// --- plane -------------------------------------------------------------------

export interface PlaneOptions {
  size?: number;
  width?: number;
  height?: number;
  sideOrientation?: number;
}

/** `CreatePlaneVertexData`: a `width` by `height` quad in XY, facing -Z. */
export function createPlane(options: PlaneOptions): GeometryBuffer {
  const indices: number[] = [];
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const width = options.width !== undefined ? options.width : options.size !== undefined ? options.size : 1;
  const height = options.height !== undefined ? options.height : options.size !== undefined ? options.size : 1;
  const sideOrientation = sideOf(options.sideOrientation);
  // Vertices
  const halfWidth = width / 2.0;
  const halfHeight = height / 2.0;
  positions.push(-halfWidth, -halfHeight, 0);
  normals.push(0, 0, -1.0);
  uvs.push(0.0, 0.0);
  positions.push(halfWidth, -halfHeight, 0);
  normals.push(0, 0, -1.0);
  uvs.push(1.0, 0.0);
  positions.push(halfWidth, halfHeight, 0);
  normals.push(0, 0, -1.0);
  uvs.push(1.0, 1.0);
  positions.push(-halfWidth, halfHeight, 0);
  normals.push(0, 0, -1.0);
  uvs.push(0.0, 1.0);
  // Indices
  indices.push(0);
  indices.push(1);
  indices.push(2);
  indices.push(0);
  indices.push(2);
  indices.push(3);
  // Sides
  computeSides(sideOrientation, positions, indices, normals, uvs);
  return result(positions, normals, uvs, indices);
}

// --- disc --------------------------------------------------------------------

export interface DiscOptions {
  radius?: number;
  tessellation?: number;
  arc?: number;
  sideOrientation?: number;
}

/** `CreateDiscVertexData`: a fan in XY around its centre, the first vertex. */
export function createDisc(options: DiscOptions): GeometryBuffer {
  const positions: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const radius = options.radius || 0.5;
  const tessellation = options.tessellation || 64;
  const arc = options.arc && (options.arc <= 0 || options.arc > 1) ? 1.0 : options.arc || 1.0;
  const sideOrientation = sideOf(options.sideOrientation);
  // positions and uvs
  positions.push(0, 0, 0); // disc center first
  uvs.push(0.5, 0.5);
  const theta = Math.PI * 2 * arc;
  const step = arc === 1 ? theta / tessellation : theta / (tessellation - 1);
  let a = 0;
  for (let t = 0; t < tessellation; t++) {
    const x = Math.cos(a);
    const y = Math.sin(a);
    const u = (x + 1) / 2;
    const v = (1 - y) / 2;
    positions.push(radius * x, radius * y, 0);
    uvs.push(u, v);
    a += step;
  }
  if (arc === 1) {
    positions.push(positions[3], positions[4], positions[5]); // close the circle
    uvs.push(uvs[2], uvs[3]);
  }
  //indices
  const vertexNb = positions.length / 3;
  for (let i = 1; i < vertexNb - 1; i++) {
    indices.push(i + 1, 0, i);
  }
  // result
  computeNormalsInto(positions, indices, normals);
  computeSides(sideOrientation, positions, indices, normals, uvs);
  return result(positions, normals, uvs, indices);
}
