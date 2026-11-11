/**
 * render/babylonSeam.ts — The ONE place our renderer meets Babylon's engine:
 * the DEVICE — what the frame still takes from Babylon's ENGINE once the
 * frame, its passes, its encoder, its submit and its loop are ours
 * (`BABYLON_EXIT.md` X5.4f and X5.4g).
 * Owns: `BabylonEngineSeam`, Babylon's `WebGPUEngine` as the one thing a
 * `FrameHost` still reaches through it — the device (`device`). The rest of
 * the renderer's host — the draw phase, the camera's matrix and the clear
 * colour — is the game's own frame's (`core/SceneFrame.ts`), and the encoder
 * every pass is recorded into, the frame's one submit and its end are the
 * game's own loop's (`core/FrameLoop.ts`, `render/FrameSubmit.ts`, X5.4g),
 * which the frame hands on.
 * **Every pass of the frame is our renderer's** since X5.4f: the opening
 * clear, the main pass, the glow's mask and its blur (X5.4e), and the post
 * chain's — a target of its pool and the canvas's — (`render/ChainPasses.ts`,
 * X5.4f); and since X5.4g they are recorded into OUR encoder and submitted in
 * ONE `queue.submit` of ours (`FrameSubmit`), so Babylon begins no pass,
 * draws nothing, binds no texture of ours and submits nothing of ours, and
 * items 2 to 5, 7 and 8 — the open pass, a slot in its bundle list, its
 * attachments, its flip, a Babylon texture's view and its sampler — were
 * retired with the passes of Babylon's they reached (X5.4f), `hostTexture`
 * with them, and item 9 — the encoder Babylon submitted first — with
 * Babylon's submit (X5.4g).
 * Invariants: NAMES Babylon's types and loads none of it (every import here
 * is `import type`, so the Babylon-free gate walks this file as it walks the
 * rest of `src/render/`); every Babylon INTERNAL anything in `src/render/`
 * reaches is reached here and is on the numbered list below — the list may
 * grow through Phase 3 and only shrinks after it (`BABYLON_EXIT.md` rule 4),
 * and a retired item's number is never given to another (ONE item since
 * X5.4g retired 9; X5.4f retired 2, 3, 4, 5, 7 and 8; X5.3d retired 6 and
 * 10); nothing here allocates on a frame.
 * Never: imports a Babylon value; hands a Babylon object to anything that
 * draws — what leaves this file is a `GPUDevice`.
 * Contract: `docs/rendering.md`, "Our renderer's frame"; `BABYLON_EXIT.md`
 * rules 4 and 5.
 *
 * WHAT THIS REACHES INTO (Babylon 9.28, `node_modules/@babylonjs/core`;
 * `E` is `Engines/webgpuEngine.pure.js`):
 *
 *   1. `engine._device` — the `GPUDevice` (E:458). Typed public, documented
 *      as internal; there is no other door to it. X5.4h's.
 *
 * Item 9 was RETIRED at `BABYLON_EXIT.md` X5.4g, and its number is not
 * reused: `engine._uploadEncoder` (E:519, E:2388), the encoder Babylon
 * finished and submitted FIRST in `flushFramebuffer`, ahead of its
 * `_renderEncoder`, and the one its `?gpu` timer opened on — every pass of
 * the frame was recorded into it from X5.4e to X5.4g. The frame's encoder is
 * ours now (`FrameSubmit.encoder`), made after each of our submits as
 * Babylon made its next, and Babylon's two are submitted only by its own
 * resize (`_initializeMainAttachments`' flush and its own begin and end of
 * frame), holding nothing of ours, until X5.4h stops constructing the
 * engine. The engine's end of frame (`onEndFrameObservable`, public API,
 * which `afterSubmit` hung on from X5.1b) went with it: `FrameHost.afterSubmit`
 * is told after OUR submit (`FrameLoop.onEndFrameObservable`).
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
 * WHAT IS NOT HERE. Two touches of Babylon internals in one file predated
 * this one and stayed where they were written, because neither was our
 * renderer's and one could not move here at all: `core/FrameProfile.ts`'s
 * (the timestamp query, and a patch on `WebGPUCacheRenderPipeline`'s
 * prototype — a Babylon VALUE, which this directory may not import), both
 * retired at X5.4g (the frame's GPU time is ours, `render/FrameTimer.ts`, and
 * no Babylon pipeline is made to name). A third, `core/webgpuLeaks.ts'`
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
}

/** Babylon's engine as the device. */
export class BabylonEngineSeam {
  readonly device: GPUDevice;

  constructor(engine: WebGPUEngine) {
    this.device = (engine as unknown as EngineInternals)._device; // item 1
  }
}
