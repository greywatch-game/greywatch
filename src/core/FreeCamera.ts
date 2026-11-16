/**
 * FreeCamera.ts — the game's one camera: Babylon 9.28's `FreeCamera` PORTED as
 * written onto `src/math/` (`BABYLON_EXIT.md` X6.1f), with the parts of its
 * `TargetCamera` and `Camera` this game reaches, collapsed into one class
 * under Babylon's member names — so a reader that asked Babylon's camera asks
 * this one the same question in the same words, and gets the same bits.
 * Owns: the camera's pose (`position`, `rotation`, `upVector`), its lens
 * (`fov`, `fovMode`, `minZ`, `maxZ`, `viewport`), and the matrices Babylon
 * computed off them — the view, the projection, the world (the view's
 * inverse), `globalPosition` and the view-projection — with the CACHES that
 * decide when each is recomputed.
 *
 * **Why the caches are ported and not simplified** (the step's rule: a port of
 * Babylon is a port of what it DID). A matrix here is recomputed only when the
 * cache says its inputs moved (`_isSynchronizedViewMatrix`,
 * `_isSynchronizedProjectionMatrix`), and a recompute is not free of side
 * effects: the view's moves `globalPosition` and the world matrix, and the
 * cache it stores holds the up vector as it stood BEFORE the compute — which
 * `updateUpVectorFromRotation` then rewrites, so the next ask recomputes again
 * whenever the roll's up vector moved. When `globalPosition` moves is part of
 * the game's timing (`lookDirection`'s `getWorldMatrix` mid-frame, the
 * frame's own `update`), so the caches are kept as Babylon kept them, member
 * for member. `setTarget` writes the REFERENCE POINT's length (the focal
 * distance), which the view's target is built off, and nudges `position.z`
 * by `Epsilon` on a target level with the eye: both are kept, because both
 * move a bit of the view.
 *
 * **What Babylon's camera had that this game never reaches, and is not here**
 * (each read off the source, and each answering nothing in this game):
 * - the INPUTS and their INERTIA (`FreeCamera.inputs`, `cameraDirection`,
 *   `cameraRotation`, `TargetCameraMovement`): `CameraSystem` cleared the
 *   inputs at construction and nothing in the tree wrote either field, so
 *   `_checkInputs` took the movement system's fast path every frame and
 *   moved nothing — `update` is what it was after that: the view and the
 *   projection asked;
 * - collisions and gravity (off), a parent (none), a locked target (null),
 *   `rotationQuaternion` (unset), rig cameras (`RIG_MODE_NONE`), the
 *   orthographic and oblique projections (`mode` is perspective), reverse
 *   depth (off), a right-handed scene (it is left-handed);
 * - the observables (`onViewMatrixChangedObservable` and its kin, which
 *   nothing observed), `_hasMoved` (read by nothing), the camera's own
 *   frustum planes (`_updateFrustumPlanes`, read only by `isInFrustum`,
 *   which nothing called — the FRAME's planes are `SceneFrame`'s), the
 *   render-pass id and the scene's camera list.
 *
 * Invariants:
 * - **The projection is WebGPU's** (`isNDCHalfZRange`: depth 0..1, what
 *   the game's `SceneEngine` told Babylon's until X6.1h) **at the SURFACE's aspect ratio**
 *   (`CanvasSurface.getAspectRatio(this)`, Babylon's `getAspectRatio` over the
 *   render size and this camera's `viewport`).
 * - The matrices are `src/math`'s (float32, Babylon's identity flag), so a
 *   reader takes them as `Matrix` and nothing crosses a library.
 * - `setTarget` ZEROES the roll (Babylon's "match previous behavior"): a roll
 *   is written after it, never before (`CameraSystem.update`).
 * Never: reads the scene or a Babylon object; allocates in `getViewMatrix` or
 * `getProjectionMatrix` (`setTarget` allocates its one vector, the `subtract`
 * Babylon's made); owns where the camera goes — `CameraSystem` and the viewer
 * write the pose.
 *
 * ## Licence
 *
 * The method bodies are copied from Babylon.js 9.28 (`Cameras/camera.pure.js`,
 * `targetCamera.pure.js`, `freeCamera.pure.js`), which is licensed under the
 * Apache License, Version 2.0 (`licenses/babylonjs.md`;
 * https://www.apache.org/licenses/LICENSE-2.0). "Babylon.js — Copyright 2023
 * The Babylon.js team" (its NOTICE). Changes from the original: the three
 * classes collapsed into one, and the parts listed above removed.
 * Contract: `docs/rendering.md` ("Our renderer's frame": the camera).
 */
import { Epsilon, Matrix, Quaternion, Vector3, type Vector3Like } from "../math";
import type { ViewportOwner } from "./CanvasSurface";

/** What the projection asks of the canvas: `AbstractEngine.getAspectRatio` (`CanvasSurface`'s). */
export interface AspectSource {
  getAspectRatio(owner: ViewportOwner): number;
}

/** `Axis.Y`, which `_getViewMatrix` rotates into the up vector. */
const AXIS_Y = new Vector3(0, 1, 0);
// `targetCamera.pure.js`' module scratch: `setTarget`'s look matrix, and the
// quaternion both `setTarget` and `_getViewMatrix` fill (never at once).
const TMP_MATRIX = new Matrix();
const TMP_QUATERNION = Quaternion.Identity();

export class FreeCamera {
  /** `Camera.FOVMODE_VERTICAL_FIXED`: the field of view is the vertical one. */
  static readonly FOVMODE_VERTICAL_FIXED = 0;
  /** `Camera.FOVMODE_HORIZONTAL_FIXED`. */
  static readonly FOVMODE_HORIZONTAL_FIXED = 1;
  /** `Camera.PERSPECTIVE_CAMERA`. */
  static readonly PERSPECTIVE_CAMERA = 0;

  readonly name: string;
  /** The eye: written in place by its owners (`CameraSystem`, the viewer). */
  position: Vector3;
  /** Pitch, yaw, roll — `setTarget` writes the first two and zeroes the third. */
  rotation = new Vector3(0, 0, 0);
  upVector = Vector3.Up();
  /** Radians; vertical unless `fovMode` says otherwise. */
  fov = 0.8;
  minZ = 1;
  maxZ = 10000.0;
  readonly mode = FreeCamera.PERSPECTIVE_CAMERA;
  fovMode = FreeCamera.FOVMODE_VERTICAL_FIXED;
  projectionPlaneTilt = 0;
  ignoreCameraMaxZ = false;
  /** The portion of the canvas drawn, as fractions: the whole of it. */
  readonly viewport = { x: 0, y: 0, width: 1.0, height: 1.0 };
  /** Derive the up vector from `rotation` on every view compute (`CameraSystem` sets it: the roll). */
  updateUpVectorFromRotation = false;

  private readonly _globalPosition = Vector3.Zero();
  private _computedViewMatrix = Matrix.Identity();
  private readonly _projectionMatrix = new Matrix();
  private readonly _transformMatrix = new Matrix();
  private readonly _worldMatrix = Matrix.Identity();
  private readonly _viewMatrix = new Matrix();
  private readonly _cameraRotationMatrix = new Matrix();
  private readonly _referencePoint = new Vector3(0, 0, 1);
  private readonly _transformedReferencePoint = Vector3.Zero();
  private readonly _currentTarget = Vector3.Zero();
  private _initialFocalDistance = 1;
  private _cachedRotationZ = 0;
  // `_cache`, as `_initCache` left it: the vectors at `Number.MAX_VALUE`, the
  // lens fields undefined, and a locked target the first `_updateCache` clears
  // (there is never one, so `_cacheLockedTarget` is only ever that first
  // state: `equals(null)` false, then `null`).
  private readonly _cachePosition = new Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
  private readonly _cacheUpVector = new Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
  private readonly _cacheRotation = new Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
  private _cacheLockedTarget = true;
  private _cacheMode: number | undefined = undefined;
  private _cacheMinZ: number | undefined = undefined;
  private _cacheMaxZ: number | undefined = undefined;
  private _cacheFov: number | undefined = undefined;
  private _cacheFovMode: number | undefined = undefined;
  private _cacheAspectRatio: number | undefined = undefined;
  private _cacheProjectionPlaneTilt: number | undefined = undefined;

  constructor(
    name: string,
    position: Vector3,
    private readonly surface: AspectSource,
  ) {
    this.name = name;
    this.position = position;
  }

  /** The eye in the world, as the last view compute left it (the world matrix's translation). */
  get globalPosition(): Vector3 {
    return this._globalPosition;
  }

  // --- the cache (`Node`, `Camera`, `TargetCamera`) ---

  private _updateCache(): void {
    this._cachePosition.copyFrom(this.position);
    this._cacheUpVector.copyFrom(this.upVector);
    this._cacheLockedTarget = false;
    this._cacheRotation.copyFrom(this.rotation);
  }

  private updateCache(force?: boolean): void {
    if (!force && this.isSynchronized()) {
      return;
    }
    this._updateCache();
  }

  private isSynchronized(): boolean {
    return this._isSynchronizedViewMatrix() && this._isSynchronizedProjectionMatrix();
  }

  private _isSynchronizedViewMatrix(): boolean {
    if (!(this._cachePosition.equals(this.position) && this._cacheUpVector.equals(this.upVector))) {
      return false;
    }
    return !this._cacheLockedTarget && this._cacheRotation.equals(this.rotation);
  }

  private _isSynchronizedProjectionMatrix(): boolean {
    const maxZ = this.ignoreCameraMaxZ ? 0 : this.maxZ;
    let isSynchronized = this._cacheMode === this.mode && this._cacheMinZ === this.minZ && this._cacheMaxZ === maxZ;
    if (!isSynchronized) {
      return false;
    }
    isSynchronized =
      this._cacheFov === this.fov &&
      this._cacheFovMode === this.fovMode &&
      this._cacheAspectRatio === this.surface.getAspectRatio(this) &&
      this._cacheProjectionPlaneTilt === this.projectionPlaneTilt;
    return isSynchronized;
  }

  // --- the pose ---

  /** Points the camera at `target` (`TargetCamera.setTarget`): yaw and pitch out of the look, roll zeroed. */
  setTarget(target: Vector3Like): void {
    this.upVector.normalize();
    this._initialFocalDistance = new Vector3(
      target.x - this.position.x,
      target.y - this.position.y,
      target.z - this.position.z,
    ).length();
    if (this.position.z === target.z) {
      this.position.z += Epsilon;
    }
    this._referencePoint.normalize().scaleInPlace(this._initialFocalDistance);
    Matrix.LookAtLHToRef(this.position, target, Vector3.UpReadOnly, TMP_MATRIX);
    TMP_MATRIX.invert();
    Quaternion.FromRotationMatrixToRef(TMP_MATRIX, TMP_QUATERNION);
    TMP_QUATERNION.toEulerAnglesToRef(this.rotation);
    // Explicitly set z to 0 to match previous behavior.
    this.rotation.z = 0;
  }

  /** Where the view looked, as its last compute built it. */
  getTarget(): Vector3 {
    return this._currentTarget;
  }

  /**
   * The frame's update (`Camera.update`): the inputs' turn (nothing — the
   * header), then the view and the projection asked, each recomputed only if
   * its cache says it moved.
   */
  update(): void {
    this.getViewMatrix();
    this.getProjectionMatrix();
  }

  // --- the matrices ---

  getWorldMatrix(): Matrix {
    if (this._isSynchronizedViewMatrix()) {
      return this._worldMatrix;
    }
    // Getting the view matrix will also compute the world matrix.
    this.getViewMatrix();
    return this._worldMatrix;
  }

  getViewMatrix(force?: boolean): Matrix {
    if (!force && this._isSynchronizedViewMatrix()) {
      return this._computedViewMatrix;
    }
    this.updateCache();
    this._computedViewMatrix = this._getViewMatrix();
    this._computedViewMatrix.invertToRef(this._worldMatrix);
    this._worldMatrix.getTranslationToRef(this._globalPosition);
    return this._computedViewMatrix;
  }

  private _getViewMatrix(): Matrix {
    // Compute
    this._updateCameraRotationMatrix();
    // Apply the changed rotation to the upVector
    if (this._cachedRotationZ !== this.rotation.z) {
      this._rotateUpVectorWithCameraRotationMatrix();
      this._cachedRotationZ = this.rotation.z;
    }
    Vector3.TransformCoordinatesToRef(this._referencePoint, this._cameraRotationMatrix, this._transformedReferencePoint);
    // Computing target and final matrix
    this.position.addToRef(this._transformedReferencePoint, this._currentTarget);
    if (this.updateUpVectorFromRotation) {
      Quaternion.FromEulerVectorToRef(this.rotation, TMP_QUATERNION);
      AXIS_Y.rotateByQuaternionToRef(TMP_QUATERNION, this.upVector);
    }
    Matrix.LookAtLHToRef(this.position, this._currentTarget, this.upVector, this._viewMatrix);
    return this._viewMatrix;
  }

  private _updateCameraRotationMatrix(): void {
    Matrix.RotationYawPitchRollToRef(this.rotation.y, this.rotation.x, this.rotation.z, this._cameraRotationMatrix);
  }

  private _rotateUpVectorWithCameraRotationMatrix(): void {
    Vector3.TransformNormalToRef(Vector3.UpReadOnly, this._cameraRotationMatrix, this.upVector);
  }

  getProjectionMatrix(force?: boolean): Matrix {
    if (!force && this._isSynchronizedProjectionMatrix()) {
      return this._projectionMatrix;
    }
    const maxZ = this.ignoreCameraMaxZ ? 0 : this.maxZ;
    // Cache
    this._cacheMode = this.mode;
    this._cacheMinZ = this.minZ;
    this._cacheMaxZ = maxZ;
    this._cacheFov = this.fov;
    this._cacheFovMode = this.fovMode;
    this._cacheAspectRatio = this.surface.getAspectRatio(this);
    this._cacheProjectionPlaneTilt = this.projectionPlaneTilt;
    if (this.minZ <= 0) {
      this.minZ = 0.1;
    }
    Matrix.PerspectiveFovLHToRef(
      this.fov,
      this.surface.getAspectRatio(this),
      this.minZ,
      maxZ,
      this._projectionMatrix,
      this.fovMode === FreeCamera.FOVMODE_VERTICAL_FIXED,
      true,
      this.projectionPlaneTilt,
      false,
    );
    return this._projectionMatrix;
  }

  /** The view times the projection, as they stand (`Camera.getTransformationMatrix`). */
  getTransformationMatrix(): Matrix {
    this._computedViewMatrix.multiplyToRef(this._projectionMatrix, this._transformMatrix);
    return this._transformMatrix;
  }

  /** `localAxis` in the world, off the camera's world matrix: a fresh vector. */
  getDirection(localAxis: Vector3Like): Vector3 {
    const result = Vector3.Zero();
    this.getDirectionToRef(localAxis, result);
    return result;
  }

  getDirectionToRef(localAxis: Vector3Like, result: Vector3): void {
    Vector3.TransformNormalToRef(localAxis, this.getWorldMatrix(), result);
  }
}
