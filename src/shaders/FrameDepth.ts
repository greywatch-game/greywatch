/**
 * FrameDepth.ts — the depth image the frame has ALREADY written, wrapped once
 * so more than one full-screen pass can sample it. Owns the capture hook and
 * the wrapper; owns no pass, no uniform and no scene state, and renders and
 * copies nothing.
 * Invariants: it must be constructed BEFORE anything that reads it, because
 * the wrapper is filled from a draw-phase hook and a declared sampler that is
 * still null at apply time fails to build its bind group and loses the draw
 * silently. `Game` builds it first in the post chain for that reason.
 *
 * WHY IT IS A THING OF ITS OWN. It was `CelInk`'s private capture, and it
 * stopped being private the moment a SECOND pass wanted the same image:
 * `MotionBlur` names the viewmodel with it (see that file). Two copies of this
 * would be two `ThinTexture`s over one texture and two observers doing the
 * same identity test, and the subtle half — the render-target guard below — is
 * exactly the sort of thing that gets fixed in one copy.
 *
 * WHAT MAKES IT SAMPLEABLE AT ALL, all three checked in the tree rather than
 * assumed:
 *
 * 1. **The frame's depth at the end of the draw phase is the WORLD's.** Babylon
 *    clears depth between rendering groups — the classic viewmodel trick — but
 *    `Sky.ts` turns that clear OFF for group 1 so the moon cannot draw through
 *    a wall. So group 1 shares group 0's buffer and there is ONE coherent depth
 *    image holding the village, the sky shell and the gun. That line is also
 *    what makes `GlowDepth`'s occlusion work, and breaking it breaks all three
 *    readers.
 * 2. **Babylon's WebGPU backend creates depth textures with `TEXTURE_BINDING`**,
 *    and `FINDINGS.md` 4 put the engine at sample count 1 with `depth32float`
 *    and no stencil, so no MSAA resolve stands in the way.
 * 3. **The buffer belongs to the FIRST pass in the camera's chain and nothing
 *    downstream writes to it.** The scene draws into that pass's texture, every
 *    later pass writes into the next one's, and the last writes to the screen —
 *    so a pass sampling this is never reading a target it is also attached to.
 *    A pass inserted BEFORE the ink would take the depth with it.
 *
 * NO ORIENTATION FLAG, AND THAT IS DELIBERATE: a reader indexes it at
 * `vUV * textureDimensions(...)` and the colour at `vUV`, and those name the
 * same screen point in the same convention whatever the storage is.
 */
import { Camera, Scene, ThinTexture } from "@babylonjs/core";

/** What a render-target wrapper carries that this needs, cast in one place. */
type DepthOwner = {
  _depthStencilTexture?: object | null;
};

/** The engine internal `GlowDepth` already depends on, named the same way. */
type EngineInternals = {
  _currentRenderTarget?: DepthOwner | null;
};

export class FrameDepth {
  /** The main pass's depth, re-wrapped whenever the underlying texture moves. */
  private wrapped: ThinTexture | null = null;
  private source: object | null = null;

  /**
   * Takes the frame's depth attachment at the end of the draw phase — the same
   * hook and the same guard as `GlowDepth`, and deliberately not disturbing
   * what that one leaves bound: nothing here binds, renders or copies.
   *
   * One identity test a frame, and on the frames the target actually moves (a
   * resize) one wrapper.
   */
  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
  ) {
    const engine = this.scene.getEngine() as unknown as EngineInternals;
    this.scene.onAfterDrawPhaseObservable.add(() => {
      // Render targets drive this observable too — a reflection probe's bake
      // is the one that matters — and a probe's depth is not the frame's.
      if (this.scene.activeCamera !== this.camera) return;
      const tex = engine._currentRenderTarget?._depthStencilTexture;
      if (!tex || tex === this.source) return;
      this.source = tex;
      this.wrapped = new ThinTexture(tex as never);
    });
  }

  /**
   * The frame's depth, or null before the first draw phase has run.
   *
   * A DECLARED sampler must be BOUND or the bind group fails to build and the
   * draw is silently lost, so every reader tests this — it cannot be null by
   * the time an `onApply` runs, since the capture above is on the draw phase
   * of the same `scene.render()`, but no pass rests on that.
   */
  get texture(): ThinTexture | null {
    return this.wrapped;
  }
}
