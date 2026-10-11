/**
 * babylon.ts — THE crossing between `src/math/` and Babylon's math: every
 * place a value made by one is handed to code still written against the other
 * goes through a function here, so the crossings can be found by one import
 * and counted down to none.
 * Owns: `toBabylon`. Owns NO state.
 *
 * **Deleted at X6.1** (`BABYLON_EXIT.md`), with Babylon; it is the one file
 * under `src/math/` that imports `@babylonjs/core`, and `index.ts` does not
 * re-export it. Every function here is a debt: a step that moves a caller
 * onto `src/math/` deletes that caller's use, and a function nobody calls is
 * deleted with its last use.
 *
 * ## Why a crossing is a COPY
 *
 * Babylon's vector keeps its coordinates in `_x`/`_y`/`_z` and its methods
 * read those, so one of ours handed to a Babylon method reads `undefined` and
 * writes NaN without a word (`vector.ts`'s header). The types refuse it; the
 * answer is never a cast, always a copy into a Babylon vector. The other
 * direction needs nothing here: the data layer's parameters are
 * `Vector3Like` (read) and `Vector3Ref` (written through `set` alone), which a
 * Babylon vector satisfies as it is.
 */
import { Vector3 as BabylonVector3 } from "@babylonjs/core";
import type { Vector3Like } from "./vector.ts";

/**
 * `v`'s coordinates in a Babylon vector: `into` when given (a scratch the
 * caller keeps, for work done often), a new one when not.
 */
export function toBabylon(v: Vector3Like, into = new BabylonVector3()): BabylonVector3 {
  return into.copyFromFloats(v.x, v.y, v.z);
}
