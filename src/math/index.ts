/**
 * math/ — the game's own vector, quaternion, matrix, colour, plane and frustum
 * classes, under Babylon's names so that moving a file off Babylon's math is
 * an import change.
 * Owns: nothing of its own; it re-exports `vector.ts`, `color.ts` and
 * `plane.ts`.
 *
 * **Since `BABYLON_EXIT.md` X6.1f every vector, colour, quaternion, matrix and
 * plane in the tree is one of these** — the camera's included (`core/
 * FreeCamera.ts`, Babylon's camera ported onto them); the last exception, a
 * Babylon mesh's own rotation in `world/parts.ts`' mesh arm, went at X6.1g.
 *
 * **Nothing under `src/math/` may import `@babylonjs/core`.** The one crossing
 * there was (`babylon.ts`, a copy into Babylon's `Vector3`) was deleted with its
 * last call, the camera's, at X6.1f. Every relative import here names its
 * `.ts`, so a Node script can load this directory by type stripping.
 */
export {
  Epsilon,
  Matrix,
  Quaternion,
  Vector2,
  Vector3,
  Vector4,
  type MatrixLike,
  type QuaternionLike,
  type Vector3Like,
  type Vector3Ref,
  type Vector4Like,
  type ViewportLike,
} from "./vector.ts";
export { Color3, Color4, type Color3Like } from "./color.ts";
export { Frustum, Plane } from "./plane.ts";
