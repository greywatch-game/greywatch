/**
 * PostPasses.ts — The Babylon-side PASS OWNER of the post chain
 * (`BABYLON_EXIT.md` X5.2c1, shape (A)): it opens, with Babylon's public API,
 * every pass a stage of OUR renderer draws in (`render/PostChain.ts`), in
 * Babylon's frame, into targets Babylon owns, and it SIZES the frame the
 * chain's first stage reads — OUR renderer's since X5.4e
 * (`render/FrameTargets.ts`), drawn by our renderer's own passes.
 * Owns: `PostPasses` — the pool our stages hand on through (a
 * `RenderTargetTexture` a pass POSITION, made as Babylon made a
 * post-process's input: `rgba8unorm`, NEAREST, no mips, no depth, the render
 * size; grown when a stage of ours follows another: X5.2c2); the render size
 * every target of the chain is; and the order the chain's passes are opened
 * in.
 * Invariants: the frame is sized to the render size as the frame starts
 * (`onBeforeRenderObservable`), where this file resized its own target until
 * X5.4e, before anything in the frame draws into it, and named for the stage
 * that READS it, as Babylon names a post-process's input
 * (`PostProcessRTT-<label>`, the label the frame's passes wear); the frame's
 * clear is OUR renderer's (`Renderer.end`), not the scene's, so the camera
 * has no `outputRenderTarget` — X5.2d's field, deleted at X5.4e — and the
 * scene clears nothing (`Game` holds `scene.autoClear` and
 * `autoClearDepthAndStencil` false: with no output target the scene's only
 * clear would be a pass of its own on the canvas); no Babylon `PostProcess`
 * stands on the camera, so `_finalizeFrame` returns at once, and every pass
 * of the chain is ours: after the camera's render
 * (`onAfterCameraRenderObservable`), our first stage — the ink — reads the
 * frame and its depth; a pool target is bound (the whole target as the
 * viewport) and cleared to the scene's colour as `activate` bound and cleared
 * the input of a READER at Babylon's defaults, which every stage of ours was
 * (X5.2c2: a stage declares no `autoClear`, `alphaMode`, `clearColor` or
 * viewport of its own); the canvas is opened with `restoreDefaultFramebuffer`,
 * exactly as `_finalizeFrame` opened it for Babylon's last pass, so the
 * canvas's pass is Babylon's main pass with the engine's depth; a pool target
 * is named for the stage that READS it, as Babylon names a post-process's
 * input (`PostProcessRTT-<label>`); every target follows the render size.
 * Never: reaches a Babylon internal (public API only: no seam item, rule 4);
 * draws — our renderer does, queued from inside the pass this opened
 * (`Renderer.postStageOpened`); holds a slot or an index in the camera's list;
 * clears the frame.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 */
import {
  type Camera,
  Constants,
  RenderTargetTexture,
  type Scene,
} from "@babylonjs/core";
import type { HostTexture } from "../render/frameHost";
import type { FrameTargets } from "../render/FrameTargets";
import type { OwnTexture } from "../render/HostBindGroup";
import type { PostChain, PostPassOwner, PostStage } from "../render/PostChain";
import { hostTexture } from "../render/babylonSeam";

export class PostPasses implements PostPassOwner {
  /** The pool, one target a pass POSITION (`PostPassOwner.openPool`), grown on first use. */
  private readonly pool: RenderTargetTexture[] = [];
  /** The chain this owner opens the passes of (`drive`). */
  private chain: PostChain | null = null;
  width = 0;
  height = 0;

  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
    /** Our renderer's frame targets: the frame this sizes and the chain's first stage reads. */
    private readonly targets: FrameTargets,
  ) {
    // Before anything in the frame draws: the frame at this frame's render
    // size, named for its reader.
    scene.onBeforeRenderObservable.add(() => this.prepareFrame());
    scene.onAfterCameraRenderObservable.add(() => this.record());
  }

  /** The chain whose passes this opens, once `Game` has built it — its stages read the frame. */
  drive(chain: PostChain): void {
    this.chain = chain;
  }

  /** What the chain's first stage reads: OUR frame (`FrameTargets.frame`). */
  get frame(): OwnTexture {
    return this.targets.frame;
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
    this.size();
    // Remade only when the render size moved, as this file's own target was
    // resized only then (`target`, below, until X5.4e).
    this.targets.sizeFrame(this.width, this.height);
    const first = this.chain?.firstActive();
    if (first) this.targets.frameLabel = `PostProcessRTT-${first.label} - RenderPass`;
  }

  /** After the camera's render: the chain's passes, the frame drawn. */
  private record(): void {
    if (this.scene.activeCamera !== this.camera) return;
    this.chain?.record(this);
  }

  openCanvas(): void {
    // As `_finalizeFrame` opened it for Babylon's last pass: the engine's
    // main pass, its colour and depth loaded, begun when ours first draws (or
    // at once, if no target of Babylon's is bound to end first).
    this.scene.getEngine().restoreDefaultFramebuffer();
  }

  openPool(slot: number, reader: PostStage): HostTexture {
    const t = this.target(this.pool[slot] ?? null, `pool ${slot}`);
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
  private target(t: RenderTargetTexture | null, name: string): RenderTargetTexture {
    if (!t) {
      return new RenderTargetTexture(`postChain ${name}`, { width: this.width, height: this.height }, this.scene, {
        generateMipMaps: false,
        generateDepthBuffer: false,
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
