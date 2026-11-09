/**
 * PostPasses.ts — The Babylon-side PASS OWNER of the post chain
 * (`BABYLON_EXIT.md` X5.2c1, shape (A)): it owns the FRAME — the render
 * target the scene draws straight into (X5.2d) — and opens, with Babylon's
 * public API, every pass a stage of OUR renderer draws in
 * (`render/PostChain.ts`), in Babylon's frame, into targets Babylon owns.
 * Owns: `PostPasses` — the frame (a `RenderTargetTexture` made as Babylon
 * made the ink's input, the post chain's first target: `rgba8unorm`, NEAREST,
 * no mips, the render size, WITH its `depth32float` depth and no stencil —
 * `render/targets.ts`' `FRAME_TARGETS`), held as the camera's
 * `outputRenderTarget` for good; the pool our stages hand on through (made
 * the same way without depth, one target a pass POSITION, grown when a stage
 * of ours follows another: X5.2c2); and the order the chain's passes are
 * opened in.
 * Invariants: the scene draws into the frame and CLEARS it itself — Babylon's
 * own frame-buffer clear of a camera's output target (`Scene._clearFrameBuffer`,
 * under `scene.autoClear`: its colour once a frame, at the frame's first bind,
 * where `_checkCameraRenderTarget` re-armed it, its depth and stencil at that
 * bind and again as the camera's render binds the target), the clear
 * `PostProcess.activate` gave the ink's input until X5.2d — so the frame's
 * OPENING pass is the frame's and no longer the canvas's (X5.2c1's reading of
 * `outputRenderTarget`, "What it is today"), and Babylon's render pass id for
 * the camera's draws is the frame's;
 * no Babylon `PostProcess` stands on the camera, so `_finalizeFrame` returns
 * at once, and every pass of the chain is ours: after the camera's render
 * (`onAfterCameraRenderObservable`), our first stage — the ink — reads the
 * frame and its depth; a pool target is bound (the whole target as the
 * viewport) and cleared to the scene's colour as `activate` bound and cleared
 * the input of a READER at Babylon's defaults, which every stage of ours was
 * (X5.2c2: a stage declares no `autoClear`, `alphaMode`, `clearColor` or
 * viewport of its own); the canvas is opened with `restoreDefaultFramebuffer`,
 * exactly as `_finalizeFrame` opened it for Babylon's last pass, so the
 * canvas's pass is Babylon's main pass with the engine's depth; a target is
 * named for the stage that READS it, as Babylon names a post-process's input
 * (`PostProcessRTT-<label>`); every target follows the render size, the frame
 * resized before the scene first binds it (`onBeforeRenderObservable`); and
 * `outputRenderTarget` stands on the camera through every frame — every read
 * Babylon makes of it as a frame starts (`_checkCameraRenderTarget` re-arms
 * the colour clear before anything else in the frame runs) and through the
 * camera's render. (Until `BABYLON_EXIT.md` X5.3d it was taken OFF the camera
 * once the chain was recorded and put back as the scene's render ended, a
 * window kept for the map editor's gizmo layer alone, which rendered with
 * the same camera after the chain and would otherwise have drawn into the
 * frame the chain had already read; the layer went with the editor at X5.3c,
 * and the window and the rule it rested on — nothing renders the main camera
 * after `onAfterCameraRender` but that layer — at X5.3d. X5.4 deletes the
 * field with the frame.) And the frame's
 * clear is Babylon's only under `scene.autoClear` (its colour AND its depth:
 * the camera's output target is cleared only then, where
 * `PostProcess.activate` cleared the ink's input's depth whatever the
 * setting), so a DEV build THROWS on a frame that starts with it false.
 * Never: reaches a Babylon internal (public API only: no seam item, rule 4);
 * draws — our renderer does, queued from inside the pass this opened
 * (`Renderer.postStageOpened`); holds a slot or an index in the camera's list;
 * clears the frame itself.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 */
import {
  type Camera,
  Constants,
  RenderTargetTexture,
  type Scene,
} from "@babylonjs/core";
import type { HostTexture } from "../render/frameHost";
import type { PostChain, PostPassOwner, PostStage } from "../render/PostChain";
import { hostTexture } from "../render/babylonSeam";

export class PostPasses implements PostPassOwner {
  /**
   * The FRAME: what the scene draws into, with its depth, and what the post
   * chain's first stage reads — the camera's `outputRenderTarget`. Public for
   * the glow (whose mask borrows its depth), `FrameDepth` and the probe's
   * adapter (`plans/webgpu-ref/post.mjs`).
   */
  readonly frameTarget: RenderTargetTexture;
  private readonly frameHandle: HostTexture;
  /** The pool, one target a pass POSITION (`PostPassOwner.openPool`), grown on first use. */
  private readonly pool: RenderTargetTexture[] = [];
  /** The chain this owner opens the passes of (`drive`). */
  private chain: PostChain | null = null;
  width = 0;
  height = 0;

  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
  ) {
    this.size();
    this.frameTarget = this.target(null, "frame", true);
    // The whole target, whatever the camera's viewport says — as
    // `PostProcess.activate` bound the ink's input (`forceFullscreenViewport`).
    this.frameTarget.ignoreCameraViewport = true;
    this.frameHandle = hostTexture(this.frameTarget);
    // The scene binds and clears it as a frame starts, and the camera's
    // render binds it again (`Scene._bindFrameBuffer`): set before the first
    // frame, and never taken off.
    camera.outputRenderTarget = this.frameTarget;
    // Before the scene's first bind of the frame: the frame at this frame's
    // render size, named for its reader.
    scene.onBeforeRenderObservable.add(() => this.prepareFrame());
    scene.onAfterCameraRenderObservable.add(() => this.record());
  }

  /** The chain whose passes this opens, once `Game` has built it — its stages read the frame. */
  drive(chain: PostChain): void {
    this.chain = chain;
  }

  get frame(): HostTexture {
    return this.frameHandle;
  }

  /** Pool target `slot`, or null before a pass first used it — for the probe's adapter. */
  poolTarget(slot: number): RenderTargetTexture | null {
    return this.pool[slot] ?? null;
  }

  /** The render size, which every target of the chain is. */
  private size(): void {
    const engine = this.scene.getEngine();
    // Babylon sized a post-process's input as `getRenderWidth(true) * 1 | 0`.
    this.width = engine.getRenderWidth(true) | 0;
    this.height = engine.getRenderHeight(true) | 0;
  }

  private prepareFrame(): void {
    if (this.scene.activeCamera !== this.camera) return;
    // Babylon clears a camera's output target only under `scene.autoClear`
    // (`Scene._clearFrameBuffer`), colour and depth together, where
    // `PostProcess.activate` cleared the ink's input whatever it said: with
    // it false the scene would draw over last frame's depth, silently.
    if (import.meta.env.DEV && !this.scene.autoClear) {
      throw new Error(
        "post: scene.autoClear is false — the scene clears the frame (its colour and depth) only under it, so this frame would draw over the last one's depth",
      );
    }
    this.size();
    this.target(this.frameTarget, "frame", true);
    const first = this.chain?.firstActive();
    if (first) this.label(this.frameTarget, first);
  }

  /** After the camera's render: the chain's passes, the frame drawn. */
  private record(): void {
    if (this.scene.activeCamera !== this.camera) return;
    this.chain?.record(this);
  }

  openCanvas(): void {
    // As `_finalizeFrame` opened it for Babylon's last pass: the engine's
    // main pass, its colour and depth loaded, begun when ours first draws.
    this.scene.getEngine().restoreDefaultFramebuffer();
  }

  openPool(slot: number, reader: PostStage): HostTexture {
    const t = this.target(this.pool[slot] ?? null, `pool ${slot}`, false);
    this.pool[slot] = t;
    this.label(t, reader);
    // Bound and cleared as Babylon's `activate` bound and cleared the input
    // of a post-process at its DEFAULTS, which every stage of ours was as
    // Babylon's (`plans/webgpu-ref/post.mjs` read each one's fields:
    // `forceFullscreenViewport` true, `enablePixelPerfectMode` false,
    // `autoClear` true, `alphaMode` 0, no `clearColor` of its own) — so the
    // whole target as the viewport whatever the camera's, and a clear to the
    // scene's colour, depth and stencil asked too. A stage declares none of
    // the three: one that needs another owes `PostStage` the field.
    const engine = this.scene.getEngine();
    engine.bindFramebuffer(t.renderTarget!, 0, undefined, undefined, true);
    engine.clear(this.scene.clearColor, true, true, true);
    return hostTexture(t);
  }

  /** `t` at the render size: made on first use, resized when the render size moved. */
  private target(t: RenderTargetTexture | null, name: string, depth: boolean): RenderTargetTexture {
    if (!t) {
      return new RenderTargetTexture(`postChain ${name}`, { width: this.width, height: this.height }, this.scene, {
        generateMipMaps: false,
        generateDepthBuffer: depth,
        generateStencilBuffer: false,
        type: Constants.TEXTURETYPE_UNSIGNED_BYTE,
        format: Constants.TEXTUREFORMAT_RGBA,
        samplingMode: Constants.TEXTURE_NEAREST_SAMPLINGMODE,
      });
    }
    const size = t.getSize();
    if (size.width !== this.width || size.height !== this.height) t.resize({ width: this.width, height: this.height });
    return t;
  }

  /** Names `t` for the stage that reads it, as Babylon names a post-process's input. */
  private label(t: RenderTargetTexture, reader: PostStage): void {
    const rt = t.renderTarget;
    const want = `PostProcessRTT-${reader.label}`;
    if (rt && rt.label !== want) rt.label = want;
  }
}
