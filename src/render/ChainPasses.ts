/**
 * render/ChainPasses.ts — The post chain's PASS OWNER, ours (`BABYLON_EXIT.md`
 * X5.4f; `shaders/PostPasses.ts` opened the same passes with Babylon's public
 * API from X5.2c1): every pass a stage of the chain draws in, into its POOL and
 * into the CANVAS, made, begun and labelled as Babylon made, began and
 * labelled them — read off the device at X5.4f's BEFORE (221abf1,
 * `plans/webgpu-ref/post.mjs`) — and the render size the chain's targets
 * are, and the frame's size with it.
 * Owns: `ChainPasses` — the pool (one target a pass POSITION, as `PostPasses`
 * made one a `RenderTargetTexture`: `rgba8unorm`, one level, one sample, `2d`,
 * usage 23, viewed whole, zeros when made, remade when the render size moves;
 * named for the stage that READS it, `PostProcessRTT-<label>`), the canvas's
 * DEPTH (`depth32float`, the swap chain's size, usage `RENDER_ATTACHMENT` 16,
 * viewed as Babylon viewed its engine's depth: what the engine's main pass
 * carried), the descriptors of the two kinds of pass, and whether this frame
 * has begun the canvas's.
 * Invariants:
 * - **A pool pass is begun as Babylon's `bindFramebuffer` and `clear` began
 *   one** (`_startRenderTargetRenderPass` with the scene's clear colour): its
 *   colour CLEARED to the scene's clear colour and stored, no depth (the pool
 *   has none), labelled `<target's label> - RenderPass`, whether or not its
 *   stage then draws — so a stage not built leaves its target cleared, as it
 *   did.
 * - **The canvas's pass is Babylon's MAIN pass** (`_startMainRenderPass(false)`):
 *   the swap chain's current texture (`getCurrentTexture`, on the context
 *   the boot configured — the canvas's one `webgpu` context, `main.ts`,
 *   Babylon's engine's until `BABYLON_EXIT.md` X5.4h) viewed as
 *   `ViewDescriptorSwapChain` described it, LOADED and stored; the canvas's
 *   depth LOADED and stored, no stencil; labelled `MainRenderPass`. It is begun
 *   EXACTLY ONCE a frame, as Babylon's was: by the chain's last stage
 *   (`openCanvas`), or — on a frame no stage reached the canvas — at the
 *   frame's end (`finishFrame`), where `Scene._renderFrame`'s closing
 *   `restoreDefaultFramebuffer` began it with nothing to draw. The canvas's
 *   depth is never cleared: Babylon's engine cleared its own when it made it
 *   (a resize's `_initializeMainAttachments`, until X5.4h stopped constructing
 *   the engine and its depth with it), and nothing reads it — the grade
 *   writes it under `always` (`PostChain`).
 * - Every pass is recorded into the host's prepare encoder (`FrameHost
 *   .prepareEncoder`), after the frame's own, and ENDED by the call that
 *   asked for it (`PostChain.record`) before the next is begun; nothing here
 *   allocates on a frame but the swap chain's view (Babylon made one a frame
 *   too); a texture this replaces is destroyed after the frame's submit
 *   (`FrameHost.afterSubmit`), never inside a frame that may still bind it —
 *   the one exception being `dispose`, which destroys the pool and the
 *   canvas's depth AT ONCE, and removes its end-of-frame observer, because it
 *   is a TEARDOWN with no frame after it (as `FrameTargets.dispose` is). Its
 *   one caller is a lost device's teardown (`Game.deviceLost`, X5.4i), right
 *   after `Renderer.dispose`, between frames, after the last submit, the loop
 *   stopped: `ChainPasses` is `Game`'s, not the `Renderer`'s, so
 *   `Renderer.dispose` does not reach it.
 * Never: imports Babylon; draws — a stage of the chain does, into the pass
 * this begins (`PostChain`); clears the frame (`Renderer.end` does).
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 */
import type { FrameHost } from "./frameHost";
import { FrameTarget, type FrameTargets } from "./FrameTargets";
import type { OwnTexture } from "./HostBindGroup";
import type { PostChain, PostPassOwner, PostStage } from "./PostChain";
import { POST_TARGETS } from "./targets";

/** `ViewDescriptorSwapChain` (`webgpuEngine.pure.js` 56-62), the format filled per frame as Babylon filled it. */
const SWAP_CHAIN_VIEW: GPUTextureViewDescriptor = {
  label: "TextureView_SwapChain",
  dimension: "2d",
  format: undefined,
  mipLevelCount: 1,
  arrayLayerCount: 1,
};

export class ChainPasses implements PostPassOwner {
  width = 0;
  height = 0;
  /** The pool, one target a pass POSITION, grown on first use. */
  private readonly pool: FrameTarget[] = [];
  /** Each pool target's pass label, by the stage that reads it — made once a stage, never per frame. */
  private readonly labels = new Map<PostStage, string>();
  /** The canvas's depth, at the swap chain's size. */
  private depthTexture: GPUTexture | null = null;
  private depthView: GPUTextureView | null = null;
  private depthWidth = 0;
  private depthHeight = 0;
  /** Whether this frame has begun the canvas's pass. */
  private canvasBegun = false;
  private readonly retired: GPUTexture[] = [];
  private readonly afterSubmit: { dispose(): void };
  /** The scene's clear colour, written in place as each pool pass is begun. */
  private readonly clearValue: GPUColorDict = { r: 0, g: 0, b: 0, a: 1 };
  private readonly poolColour: GPURenderPassColorAttachment;
  private readonly poolPass: GPURenderPassDescriptor;
  private readonly canvasColour: GPURenderPassColorAttachment;
  private readonly canvasDepth: GPURenderPassDepthStencilAttachment;
  private readonly canvasPass: GPURenderPassDescriptor;

  constructor(
    private readonly device: GPUDevice,
    private readonly host: FrameHost,
    /** Our renderer's frame targets: the frame this sizes and the chain's first stage reads. */
    private readonly targets: FrameTargets,
    /** The canvas's context, as the engine configured it. */
    private readonly context: GPUCanvasContext,
  ) {
    const nothing = null as unknown as GPUTextureView;
    this.poolColour = { view: nothing, clearValue: this.clearValue, loadOp: "clear", storeOp: "store" };
    this.poolPass = { label: "", colorAttachments: [this.poolColour] };
    this.canvasColour = { view: nothing, loadOp: "load", storeOp: "store" };
    this.canvasDepth = { view: nothing, depthLoadOp: "load", depthStoreOp: "store" };
    this.canvasPass = {
      label: "MainRenderPass",
      colorAttachments: [this.canvasColour],
      depthStencilAttachment: this.canvasDepth,
    };
    this.afterSubmit = host.afterSubmit(this.destroyRetired);
  }

  /** What the chain's first stage reads: OUR frame (`FrameTargets.frame`). */
  get frame(): OwnTexture {
    return this.targets.frame;
  }

  /** Pool target `slot`, or null before a pass first used it — for the probe's adapter. */
  poolTarget(slot: number): FrameTarget | null {
    return this.pool[slot] ?? null;
  }

  /** The canvas's depth texture, or null before the first canvas pass — for the probe's adapter. */
  get canvasDepthTexture(): GPUTexture | null {
    return this.depthTexture;
  }

  /**
   * The frame at this frame's render size — `width` x `height`, which the
   * caller reads as Babylon sized a post-process's input
   * (`getRenderWidth(true) * 1 | 0`) — named for its reader, `first`, the
   * chain's first active stage; before anything in the frame draws (the
   * frame's `onBeforeRenderObservable`, where `PostPasses.prepareFrame` ran).
   * Remade only when the render size moved (`FrameTargets.sizeFrame`).
   */
  prepareFrame(width: number, height: number, first: PostStage | null): void {
    this.width = width;
    this.height = height;
    this.targets.sizeFrame(width, height);
    if (first) this.targets.frameLabel = this.labelFor(first);
  }

  /** The chain's passes for this frame, after the camera's render (`PostChain.record`). */
  record(chain: PostChain): void {
    chain.record(this);
  }

  openPool(slot: number, reader: PostStage): GPURenderPassEncoder {
    let t = this.pool[slot];
    if (!t) {
      t = new FrameTarget(`postChain pool ${slot}`, POST_TARGETS.colorFormats[0]);
      this.pool[slot] = t;
    }
    // Made at the render size on first use and remade when it moved, as
    // `PostPasses` made and resized its `RenderTargetTexture`.
    this.size(t, this.width, this.height);
    // Bound and cleared as Babylon's `activate` bound and cleared the input of
    // a post-process at its DEFAULTS (every stage of ours was): the whole
    // target as the viewport (a pass's default), and a clear to the scene's
    // colour — depth and stencil asked too, and the pool has neither.
    this.host.clearColor(this.clearValue);
    this.poolColour.view = t.view!;
    this.poolPass.label = this.labelFor(reader);
    return this.host.prepareEncoder().beginRenderPass(this.poolPass);
  }

  /** What pool target `slot` holds once its pass has ended — what the next stage reads. */
  poolOutput(slot: number): OwnTexture {
    return this.pool[slot];
  }

  openCanvas(): GPURenderPassEncoder {
    return this.beginCanvas();
  }

  /**
   * The frame's end (`SceneFrame.render`'s last line): the canvas's pass,
   * begun and ended with nothing in it, on a frame nothing began one — as
   * `Scene._renderFrame`'s closing `restoreDefaultFramebuffer` began
   * Babylon's main pass. Every frame begins exactly one.
   */
  finishFrame(): void {
    if (!this.canvasBegun) this.beginCanvas().end();
    this.canvasBegun = false;
  }

  dispose(): void {
    this.afterSubmit.dispose();
    for (const t of this.pool) {
      t.texture?.destroy();
      t.texture = null;
      t.view = null;
    }
    this.depthTexture?.destroy();
    this.depthTexture = null;
    this.depthView = null;
    this.destroyRetired();
  }

  private beginCanvas(): GPURenderPassEncoder {
    this.canvasBegun = true;
    const swap = this.context.getCurrentTexture();
    if (!this.depthTexture || this.depthWidth !== swap.width || this.depthHeight !== swap.height) this.makeDepth(swap);
    SWAP_CHAIN_VIEW.format = swap.format;
    this.canvasColour.view = swap.createView(SWAP_CHAIN_VIEW);
    this.canvasDepth.view = this.depthView!;
    return this.host.prepareEncoder().beginRenderPass(this.canvasPass);
  }

  /** The canvas's depth at the swap chain's size, as `_initializeMainAttachments` made the engine's. */
  private makeDepth(swap: GPUTexture): void {
    if (this.depthTexture) this.retired.push(this.depthTexture);
    const w = swap.width;
    const h = swap.height;
    const texture = this.device.createTexture({
      label: `canvas depth ${w}x${h}`,
      size: { width: w, height: h, depthOrArrayLayers: 1 },
      mipLevelCount: 1,
      sampleCount: 1,
      dimension: "2d",
      format: "depth32float",
      // `RENDER_ATTACHMENT` (16), as Babylon's: named at the call, never at
      // the module's top level (`docs/build.md`).
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.depthTexture = texture;
    this.depthView = texture.createView({
      label: `canvas depth ${w}x${h} view`,
      dimension: "2d",
      format: "depth32float",
      mipLevelCount: 1,
      arrayLayerCount: 1,
    });
    this.depthWidth = w;
    this.depthHeight = h;
  }

  /** `t` at `width` x `height`: made at the first ask, remade (zeros) when the size moved. */
  private size(t: FrameTarget, width: number, height: number): void {
    if (t.texture && t.width === width && t.height === height) return;
    if (t.texture) this.retired.push(t.texture);
    const texture = this.device.createTexture({
      label: t.name,
      size: [width, height, 1],
      format: t.format,
      // `COPY_SRC | COPY_DST | TEXTURE_BINDING | RENDER_ATTACHMENT` (23), what
      // Babylon's render target asked for.
      usage:
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.RENDER_ATTACHMENT,
      mipLevelCount: 1,
      sampleCount: 1,
      dimension: "2d",
    });
    t.texture = texture;
    t.view = texture.createView({
      label: `${t.name} view`,
      format: t.format,
      dimension: "2d",
      mipLevelCount: 1,
      baseArrayLayer: 0,
      baseMipLevel: 0,
      arrayLayerCount: 1,
      aspect: "all",
    });
    t.width = width;
    t.height = height;
  }

  /** The label a pass into a target read by `reader` wears: `PostProcessRTT-<label> - RenderPass`. */
  private labelFor(reader: PostStage): string {
    let label = this.labels.get(reader);
    if (label === undefined) {
      label = `PostProcessRTT-${reader.label} - RenderPass`;
      this.labels.set(reader, label);
    }
    return label;
  }

  private readonly destroyRetired = (): void => {
    const retired = this.retired;
    if (retired.length === 0) return;
    for (let i = 0; i < retired.length; i++) retired[i].destroy();
    retired.length = 0;
  };
}
