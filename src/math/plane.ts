/**
 * plane.ts — `Plane` and `Frustum`: the subset of Babylon's classes of those
 * names that the tree calls, under the same names and with the same
 * signatures — the six planes a frame is culled against, and the
 * normalisation each is left with.
 * Owns: the two classes. No state, no tunable, and it imports only
 * `vector.ts`, so a Node script can load it by type stripping, and so can the
 * server.
 *
 * **The same bits as Babylon** (`vector.ts`' one rule): every body is Babylon
 * 9.28's, operation for operation (`Maths/math.plane.js`,
 * `Maths/math.frustum.js`), and `scripts/math-check.mjs` holds each to
 * Babylon's recorded answers (`scripts/tables/`). A plane's normal is a
 * `Vector3` of doubles and its `d` a double, as Babylon's are; `GetPlanesToRef`
 * reads a matrix's float32s through `m` and writes doubles. Its order is
 * Babylon's — near, far, left, right, top, bottom — and every reader indexes
 * it that way (`Game`'s culls, `Sky`'s moon, `GrassSystem`'s patches).
 *
 * Who computes the frame's six: `core/SceneFrame.ts`' `updateTransformMatrix`,
 * where `Scene.setTransformMatrix` computed the scene's (`BABYLON_EXIT.md`
 * X6.1f); `GrassSystem` computes its own off the camera's transform, as it
 * did off Babylon's.
 *
 * ## Licence
 *
 * The method bodies are copied from Babylon.js 9.28, which is licensed under
 * the Apache License, Version 2.0 (`licenses/babylonjs.md`;
 * https://www.apache.org/licenses/LICENSE-2.0). "Babylon.js — Copyright 2023
 * The Babylon.js team" (its NOTICE). Changes from the original: the subset
 * trimmed to what this tree calls.
 */
import { type MatrixLike, Vector3 } from "./vector.ts";

export class Plane {
  normal: Vector3;
  d: number;

  constructor(a: number, b: number, c: number, d: number) {
    this.normal = new Vector3(a, b, c);
    this.d = d;
  }

  normalize(): this {
    const norm = Math.sqrt(this.normal.x * this.normal.x + this.normal.y * this.normal.y + this.normal.z * this.normal.z);
    let magnitude = 0.0;
    if (norm !== 0) {
      magnitude = 1.0 / norm;
    }
    this.normal.x *= magnitude;
    this.normal.y *= magnitude;
    this.normal.z *= magnitude;
    this.d *= magnitude;
    return this;
  }
}

export class Frustum {
  static GetPlanes(transform: MatrixLike): Plane[] {
    const frustumPlanes: Plane[] = [];
    for (let index = 0; index < 6; index++) {
      frustumPlanes.push(new Plane(0.0, 0.0, 0.0, 0.0));
    }
    Frustum.GetPlanesToRef(transform, frustumPlanes);
    return frustumPlanes;
  }

  static GetNearPlaneToRef(transform: MatrixLike, frustumPlane: Plane): void {
    const m = transform.m;
    frustumPlane.normal.x = m[3] + m[2];
    frustumPlane.normal.y = m[7] + m[6];
    frustumPlane.normal.z = m[11] + m[10];
    frustumPlane.d = m[15] + m[14];
    frustumPlane.normalize();
  }

  static GetFarPlaneToRef(transform: MatrixLike, frustumPlane: Plane): void {
    const m = transform.m;
    frustumPlane.normal.x = m[3] - m[2];
    frustumPlane.normal.y = m[7] - m[6];
    frustumPlane.normal.z = m[11] - m[10];
    frustumPlane.d = m[15] - m[14];
    frustumPlane.normalize();
  }

  static GetLeftPlaneToRef(transform: MatrixLike, frustumPlane: Plane): void {
    const m = transform.m;
    frustumPlane.normal.x = m[3] + m[0];
    frustumPlane.normal.y = m[7] + m[4];
    frustumPlane.normal.z = m[11] + m[8];
    frustumPlane.d = m[15] + m[12];
    frustumPlane.normalize();
  }

  static GetRightPlaneToRef(transform: MatrixLike, frustumPlane: Plane): void {
    const m = transform.m;
    frustumPlane.normal.x = m[3] - m[0];
    frustumPlane.normal.y = m[7] - m[4];
    frustumPlane.normal.z = m[11] - m[8];
    frustumPlane.d = m[15] - m[12];
    frustumPlane.normalize();
  }

  static GetTopPlaneToRef(transform: MatrixLike, frustumPlane: Plane): void {
    const m = transform.m;
    frustumPlane.normal.x = m[3] - m[1];
    frustumPlane.normal.y = m[7] - m[5];
    frustumPlane.normal.z = m[11] - m[9];
    frustumPlane.d = m[15] - m[13];
    frustumPlane.normalize();
  }

  static GetBottomPlaneToRef(transform: MatrixLike, frustumPlane: Plane): void {
    const m = transform.m;
    frustumPlane.normal.x = m[3] + m[1];
    frustumPlane.normal.y = m[7] + m[5];
    frustumPlane.normal.z = m[11] + m[9];
    frustumPlane.d = m[15] + m[13];
    frustumPlane.normalize();
  }

  static GetPlanesToRef(transform: MatrixLike, frustumPlanes: Plane[]): void {
    // Near
    Frustum.GetNearPlaneToRef(transform, frustumPlanes[0]);
    // Far
    Frustum.GetFarPlaneToRef(transform, frustumPlanes[1]);
    // Left
    Frustum.GetLeftPlaneToRef(transform, frustumPlanes[2]);
    // Right
    Frustum.GetRightPlaneToRef(transform, frustumPlanes[3]);
    // Top
    Frustum.GetTopPlaneToRef(transform, frustumPlanes[4]);
    // Bottom
    Frustum.GetBottomPlaneToRef(transform, frustumPlanes[5]);
  }
}
