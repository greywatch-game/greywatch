/**
 * SceneEngine.ts — the engine the Babylon `Scene` stands on until X6.1
 * (`BABYLON_EXIT.md` X5.4h, row "X5.4, Babylon's engine", decided by the
 * owner: (A)): Babylon's own data-only `NullEngine`, told WebGPU's depth
 * range and the canvas's size, so that what Babylon computed for the game —
 * the camera's projection, the scene's transform matrix and
 * `Vector3.ProjectToRef` — was what it computed on the `WebGPUEngine`, to the
 * bit. **Since `BABYLON_EXIT.md` X6.1f none of the three is Babylon's**: the
 * camera is ours (`core/FreeCamera.ts`, its projection at WebGPU's depth range
 * off the surface's aspect ratio), the frame computes the transform
 * (`SceneFrame.updateTransformMatrix`) and the projection to pixels is
 * `src/math`'s (X6.1e); the engine stands under the scene alone, until X6.1h.
 * Owns: `SceneEngine`, a `NullEngine` — no device, no canvas, no context, no
 * loop, no GPU object of any kind — answering the render size, the scaling
 * level and so the aspect ratio off the game's `CanvasSurface`.
 * Invariants:
 * - **`isNDCHalfZRange` is TRUE**, as on the `WebGPUEngine` (a `NullEngine`
 *   says false): Babylon's camera projection (`Camera.getProjectionMatrix`,
 *   until X6.1f) and `Vector3.ProjectToRef`/`Unproject` (which read the LAST
 *   engine built, `EngineStore.LastCreatedEngine`) map depth to WebGPU's
 *   0..1. Nothing else is built after it.
 * - **The render size is the surface's backing store, asked either way**
 *   (`getRenderWidth(useScreen)`): the `WebGPUEngine` answered a bound render
 *   target's size instead when one was bound, and none has been since X5.4f;
 *   a `NullEngine` would answer its options' 512x256. The scaling level is the
 *   surface's (a `NullEngine` answers 1). `getAspectRatio` is the base class's
 *   over these, as it was over the `WebGPUEngine`'s.
 * - It is the scene's alone (and was the camera's until X6.1f): the game asks the SURFACE
 *   (`core/CanvasSurface.ts`) for every size, never this.
 * Never: draws, compiles or holds a GPU resource — nothing of the game's is a
 * Babylon material since `BABYLON_EXIT.md` X6.1c, so nothing could compile
 * on it (the DEV watch that held it to 0, `core/babylonCompiles.ts`, went
 * then); reaches a Babylon internal.
 * Contract: `docs/rendering.md` ("Our renderer's frame").
 */
import { NullEngine } from "@babylonjs/core";
import type { CanvasSurface } from "./CanvasSurface";

export class SceneEngine extends NullEngine {
  /** Null only while the base constructor runs, before it is set. */
  private surface: CanvasSurface | null = null;

  constructor(surface: CanvasSurface) {
    super();
    this.surface = surface;
    // WebGPU's depth range, 0..1 (the header). Public, typed read-only.
    (this as { isNDCHalfZRange: boolean }).isNDCHalfZRange = true;
  }

  override getRenderWidth(_useScreen = false): number {
    return this.surface?.getRenderWidth() ?? 0;
  }

  override getRenderHeight(_useScreen = false): number {
    return this.surface?.getRenderHeight() ?? 0;
  }

  override getHardwareScalingLevel(): number {
    return this.surface?.getHardwareScalingLevel() ?? 1;
  }
}
