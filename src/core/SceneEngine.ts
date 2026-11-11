/**
 * SceneEngine.ts — the engine the Babylon `Scene` stands on until X6.1
 * (`BABYLON_EXIT.md` X5.4h, row "X5.4, Babylon's engine", decided by the
 * owner: (A)): Babylon's own data-only `NullEngine`, told WebGPU's depth
 * range and the canvas's size, so that what Babylon still computes for the
 * game — the camera's projection, the scene's transform matrix and
 * `Vector3.ProjectToRef` — is what it computed on the `WebGPUEngine`, to the
 * bit.
 * Owns: `SceneEngine`, a `NullEngine` — no device, no canvas, no context, no
 * loop, no GPU object of any kind — answering the render size, the scaling
 * level and so the aspect ratio off the game's `CanvasSurface`.
 * Invariants:
 * - **`isNDCHalfZRange` is TRUE**, as on the `WebGPUEngine` (a `NullEngine`
 *   says false): the camera's projection (`Camera.getProjectionMatrix`) and
 *   `Vector3.ProjectToRef`/`Unproject` (which read the LAST engine built,
 *   `EngineStore.LastCreatedEngine`) map depth to WebGPU's 0..1. Nothing else
 *   is built after it.
 * - **The render size is the surface's backing store, asked either way**
 *   (`getRenderWidth(useScreen)`): the `WebGPUEngine` answered a bound render
 *   target's size instead when one was bound, and none has been since X5.4f;
 *   a `NullEngine` would answer its options' 512x256. The scaling level is the
 *   surface's (a `NullEngine` answers 1). `getAspectRatio` is the base class's
 *   over these, as it was over the `WebGPUEngine`'s.
 * - It is the scene's and the camera's alone: the game asks the SURFACE
 *   (`core/CanvasSurface.ts`) for every size, never this.
 * Never: draws, compiles or holds a GPU resource — a Babylon effect compiled
 * on it is counted by the DEV watch (`core/babylonCompiles.ts`), which must
 * read 0; reaches a Babylon internal.
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
