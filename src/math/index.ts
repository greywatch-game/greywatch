/**
 * math/ — the game's own vector, quaternion, matrix and colour classes, under
 * Babylon's names so that moving a file off Babylon's math is an import change.
 * Owns: nothing of its own; it re-exports `vector.ts` and `color.ts`.
 *
 * **Since `BABYLON_EXIT.md` X6.1e every vector, colour, quaternion and matrix
 * in the tree is one of these but the CAMERA's** (`CameraSystem`, the viewer's
 * camera, the scene's matrices and frustum planes), which X6.1f ports, and a
 * Babylon mesh's own rotation in `world/parts.ts`' mesh arm (X6.1g).
 *
 * **Nothing under `src/math/` may import `@babylonjs/core`** — except
 * `babylon.ts`, the one crossing, which is NOT re-exported here and is deleted
 * with its last call, the camera's (X6.1f). Every relative import here names its `.ts`, so a Node
 * script can load this directory by type stripping.
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
