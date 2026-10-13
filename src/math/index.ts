/**
 * math/ — the game's own vector, quaternion, matrix and colour classes, under
 * Babylon's names so that moving a file off Babylon's math is an import change.
 * Owns: nothing of its own; it re-exports `vector.ts` and `color.ts`.
 *
 * **Nothing under `src/math/` may import `@babylonjs/core`** — except
 * `babylon.ts`, the one crossing, which is NOT re-exported here and is deleted
 * with Babylon (X6.1). Every relative import here names its `.ts`, so a Node
 * script can load this directory by type stripping.
 */
export {
  Epsilon,
  Matrix,
  Quaternion,
  Vector3,
  type MatrixLike,
  type QuaternionLike,
  type Vector3Like,
  type Vector3Ref,
  type ViewportLike,
} from "./vector.ts";
export { Color3, Color4, type Color3Like } from "./color.ts";
