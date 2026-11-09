/**
 * FrameDepth.ts — the depth image the frame has ALREADY written, wrapped once
 * so more than one full-screen pass can sample it. Owns the capture hook and
 * the wrapper; owns no pass, no uniform and no scene state, and renders and
 * copies nothing.
 * Invariants: it must be constructed BEFORE anything that reads it, because
 * the wrapper is filled from a draw-phase hook and a stage whose depth is
 * still null when the host draws it draws nothing. `Game` builds it ahead of
 * the post chain's stages for that reason. It reads the frame's depth off
 * the frame's own render target, by Babylon's PUBLIC getter
 * (`RenderTargetWrapper.depthStencilTexture`, `BABYLON_EXIT.md` X5.2d, row
 * "X5.2, `FrameDepth`") — no internal and no bound target.
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
 *    `Game`'s constructor turns that clear OFF for group 1 (it was `Sky.ts`'s,
 *    while the moon drew there). So group 1 shares group 0's buffer and there is ONE coherent depth
 *    image holding the village, the sky shell and the gun. That line is also
 *    what makes `GlowPass`'s occlusion work, and breaking it breaks all three
 *    readers.
 * 2. **Babylon's WebGPU backend creates depth textures with `TEXTURE_BINDING`**,
 *    and `main.ts` puts the engine at sample count 1 with `depth32float`
 *    and no stencil, so no MSAA resolve stands in the way.
 * 3. **The buffer belongs to the FRAME's render target and nothing downstream
 *    writes to it.** The scene draws into that target (`PostPasses`' frame, the
 *    camera's `outputRenderTarget`, X5.2d; the ink's input before it), the
 *    post chain's first stage reads it, every stage writes a target of its
 *    own and the last writes to the screen — so a pass sampling this is never
 *    reading a target it is also attached to.
 *
 * NO ORIENTATION FLAG, AND THAT IS DELIBERATE: a reader indexes it at
 * `vUV * textureDimensions(...)` and the colour at `vUV`, and those name the
 * same screen point in the same convention whatever the storage is.
 */
import { ThinTexture, type Camera, type RenderTargetTexture, type Scene } from "@babylonjs/core";

export class FrameDepth {
  /** The main pass's depth, re-wrapped whenever the underlying texture moves. */
  private wrapped: ThinTexture | null = null;
  private source: object | null = null;

  /**
   * Takes the frame's depth attachment at the end of the draw phase, with the
   * same camera guard as `GlowPass`, and binds, renders and copies nothing:
   * the depth is read off `frame`, the render target the scene draws into,
   * so nothing the glow binds on the same hook can move what this finds.
   *
   * One identity test a frame, and on the frames the target actually moves (a
   * resize) one wrapper.
   */
  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
    /** The render target the scene draws into (`PostPasses`' frame). */
    private readonly frame: RenderTargetTexture,
  ) {
    this.scene.onAfterDrawPhaseObservable.add(() => {
      // Only `Scene._renderForCamera` notifies this observable (Babylon
      // 9.28, `scene.pure.js` 4180; no render target's manager does), so
      // this guards against another camera's depth, which nothing draws
      // today. Harmless, and kept, as `GlowPass`'s is.
      if (this.scene.activeCamera !== this.camera) return;
      const tex = this.frame.renderTarget?.depthStencilTexture;
      if (!tex || tex === this.source) return;
      this.source = tex;
      this.wrapped = new ThinTexture(tex);
    });
  }

  /**
   * The frame's depth, or null before the first draw phase has run.
   *
   * A declared binding must be BOUND or the bind group fails to build and the
   * draw is silently lost, so every reader tests this — it cannot be null by
   * the time the post chain draws, since the capture above is on the draw
   * phase of the same `scene.render()`, but no stage rests on that.
   */
  get texture(): ThinTexture | null {
    return this.wrapped;
  }
}
