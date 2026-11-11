/**
 * render/babylonSeam.ts — The ONE place our renderer meets Babylon's engine:
 * the device, the encoder Babylon submits first, and the engine's end of
 * frame — what the frame still takes from Babylon's ENGINE once the frame
 * itself is ours (`BABYLON_EXIT.md` X5.4f).
 * Owns: `BabylonEngineSeam`, Babylon's `WebGPUEngine` as the three things a
 * `FrameHost` still reaches through it — the device (`device`), the encoder
 * every pass of the frame is recorded into (`prepareEncoder`) and the moment
 * the frame's commands are the queue's (`afterSubmit`). The rest of the
 * renderer's host — the draw phase, the camera's matrix and the clear colour
 * — is the game's own frame's (`core/SceneFrame.ts`), which hands these on.
 * **Every pass of the frame is our renderer's** since X5.4f: the opening
 * clear, the main pass, the glow's mask and its blur (X5.4e), and the post
 * chain's — a target of its pool and the canvas's — (`render/ChainPasses.ts`,
 * X5.4f), recorded into the encoder of item 9; and the scene is never
 * rendered (`SceneFrame.render`). So Babylon begins no pass, draws nothing
 * and binds no texture of ours, and items 2 to 5, 7 and 8 — the open pass, a
 * slot in its bundle list, its attachments, its flip, a Babylon texture's
 * view and its sampler — were retired with the passes of Babylon's they
 * reached, and `hostTexture` with them: there is no Babylon texture our
 * renderer holds.
 * Invariants: NAMES Babylon's types and loads none of it (every import here
 * is `import type`, so the Babylon-free gate walks this file as it walks the
 * rest of `src/render/`); every Babylon INTERNAL anything in `src/render/`
 * reaches is reached here and is on the numbered list below — the list may
 * grow through Phase 3 and only shrinks after it (`BABYLON_EXIT.md` rule 4),
 * and a retired item's number is never given to another (TWO items since
 * X5.4f retired 2, 3, 4, 5, 7 and 8; X5.3d retired 6 and 10); nothing here
 * allocates on a frame.
 * Never: imports a Babylon value; hands a Babylon object to anything that
 * draws — what leaves this file is a `GPUDevice` and a `GPUCommandEncoder`.
 * Contract: `docs/rendering.md`, "Our renderer's frame"; `BABYLON_EXIT.md`
 * rules 4 and 5.
 *
 * WHAT THIS REACHES INTO (Babylon 9.28, `node_modules/@babylonjs/core`;
 * `E` is `Engines/webgpuEngine.pure.js`):
 *
 *   1. `engine._device` — the `GPUDevice` (E:458). Typed public, documented
 *      as internal; there is no other door to it. X5.4h's.
 *   9. `engine._uploadEncoder` (E:519, E:2388) — the encoder Babylon finishes
 *      and submits FIRST in `flushFramebuffer`, ahead of `_renderEncoder`
 *      (E:2381-2382), and the one `_timestampQuery.startFrame` opens the frame's
 *      GPU timer on (E:2397; it is closed on `_renderEncoder` in `endFrame`,
 *      which since X5.4f holds nothing). Copies and mip generation are recorded
 *      into it, each pass begun and ended inside one call, so it has no pass
 *      open while ours records. A flush mid-frame replaces it (a resize's
 *      `_initializeMainAttachments`), which is why it is read at the call and
 *      never kept: whichever one is current is submitted before the passes
 *      recorded after it, and inside the timer. Every pass of the frame is
 *      recorded into it, after the prepares: the frame's own (`Renderer.end`,
 *      `recordGlowMask`, `glowBlurPass`, X5.4e) and the post chain's
 *      (`ChainPasses`, X5.4f). X5.4g's, with the loop.
 *
 * Items 2, 3, 4, 5, 7 and 8 were RETIRED at `BABYLON_EXIT.md` X5.4f, and
 * their numbers are not reused: `engine._getCurrentRenderPass()` (2),
 * `engine._bundleList.addItem` (3), `engine._getCurrentRenderPassWrapper()`
 * (4), `engine._currentRenderTarget._disableEngineYFlip` (5) — the open pass
 * of Babylon's, a slot in its draw order, its attachments and its flip, which
 * the post chain's passes reached while Babylon opened them — and
 * `internalTexture._hardwareTexture.view` (7) and `engine._cacheSampler
 * .getSampler` (8), a Babylon texture's own view and sampler, which the
 * chain's pool reached last (every other texture a draw of ours binds was
 * ours by X5.4e). Items 6 and 10 were retired at X5.3d:
 * `RenderingGroup.onBeforeTransparentRendering` (6) and
 * `RenderingGroup._renderAlphaTest` with `_alphaTestSubMeshes` (10), where the
 * `beforeBlended` and `beforeAlphaTest` points were told on a frame Babylon
 * VISITED group 0 — none did after X5.3c.
 *
 * Public API used here and nowhere else in `src/render/`, for the same
 * reason (it is Babylon's shape): the engine's end of frame
 * (`onEndFrameObservable`, `afterSubmit`, `BABYLON_EXIT.md` X5.1b).
 *
 * WHAT IS NOT HERE. Two touches of Babylon internals in one file predate
 * this one and stay where they were written, because neither is our
 * renderer's and one cannot move here at all: `core/FrameProfile.ts`'s (the
 * timestamp query, and a patch on `WebGPUCacheRenderPipeline`'s prototype — a
 * Babylon VALUE, which this directory may not import), which leave with
 * Babylon (X6.1; X5.4g retires both). A third, `core/webgpuLeaks.ts`'
 * (`_deletePipelineContext`), was deleted at X5.4b: Babylon releases no
 * effect and makes no bind group after the boot. `shaders/FrameDepth.ts`' (the
 * frame's depth texture) left at X5.2d, and the file at X5.4e.
 * `systems/ReflectionSystem.ts`' two (`_releaseRenderPassId`,
 * `_removeDrawWrapper`) left with Babylon's bake at X3.7c. So rule 4 holds
 * here as "every internal OUR RENDERER reaches"; `BABYLON_EXIT.md` records
 * that reading at X3.2.
 */
import type { WebGPUEngine } from "@babylonjs/core";

/** The internals above, typed as far as this file reads them. */
interface EngineInternals {
  readonly _device: GPUDevice;
  readonly _uploadEncoder: GPUCommandEncoder;
}

/** Babylon's engine as the device, the first encoder and the end of frame. */
export class BabylonEngineSeam {
  readonly device: GPUDevice;
  private readonly e: EngineInternals;

  constructor(private readonly engine: WebGPUEngine) {
    this.e = engine as unknown as EngineInternals;
    this.device = this.e._device; // item 1
  }

  /** Item 9. */
  prepareEncoder(): GPUCommandEncoder {
    return this.e._uploadEncoder;
  }

  /**
   * The engine's end of frame, public API: `endFrame` raises it after
   * `flushFramebuffer` has submitted both encoders, so the frame's commands
   * are the queue's by then (the irradiance volume's retired buffers and
   * textures, `GiCompute`; a remade target, `FrameTargets`, `ChainPasses`).
   */
  afterSubmit(run: () => void): { dispose(): void } {
    const engine = this.engine;
    const o = engine.onEndFrameObservable.add(run);
    return { dispose: () => engine.onEndFrameObservable.remove(o) };
  }
}
