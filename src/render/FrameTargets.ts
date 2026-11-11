/**
 * render/FrameTargets.ts — The targets the frame's own passes draw into, ours
 * since `BABYLON_EXIT.md` X5.4e: the FRAME (what the main pass draws and the
 * post chain's first stage reads) and its depth, the glow's MASK, and the
 * glow's five BLUR targets — each made as Babylon made the render target it
 * replaces, read off the device at X5.4e's BEFORE (0fdf80c).
 * Owns: `FrameTargets` — the seven textures, their views and the glow's
 * sampler; `FrameTarget`, one of them as a bind group binds it and a pass
 * draws into it; the pass label the frame's two passes wear (`frameLabel`).
 * Invariants: every texture is what Babylon's `RenderTargetTexture` made — one
 * level, one sample, `2d`, usage `COPY_SRC | COPY_DST | TEXTURE_BINDING |
 * RENDER_ATTACHMENT` (23), zero-filled when made — at the format its pass's
 * targets state (`FRAME_TARGETS`: `rgba8unorm` and `depth32float`;
 * `GLOW_TARGETS`: `rgba8unorm`, the frame's own depth attached;
 * `GLOW_BLUR_TARGETS`: `rgba16float`), so every pipeline built against those
 * is one its pass takes, by construction; each is viewed whole as Babylon's
 * hardware texture viewed it, and that one view is both what a pass draws
 * into (Babylon's attachment view had the same descriptor) and what a stage
 * samples; the glow's six read through the sampler Babylon's cache made for
 * a `BILINEAR` render target with its default anisotropy of 4, clamped
 * (`anisotropic`: every filter linear, `w` repeating), the frame and its depth
 * through none of their own (the ink reads the frame with its own sampler,
 * every stage the depth by `textureLoad`); a target is made at its first size
 * and REMADE when its owner resized Babylon's — the frame and its depth when
 * the render size moves (`PostPasses` resized its target only then, and
 * `ChainPasses` asks it so since X5.4f), the
 * glow's six on every `sizeGlow` (`GlowPass` resized all six on a size or rung
 * change, and Babylon's `resize` remade a target whatever its size) — so a
 * remade target holds zeros; the texture it replaces is destroyed after
 * the frame's submit (`FrameHost.afterSubmit`), never inside a frame that may
 * still bind it — the one exception being `dispose`, which destroys every
 * texture AT ONCE because it is a TEARDOWN with no frame after it (its one
 * caller, `Renderer.dispose`, as `Renderer` destroys its frame buffer; its
 * caller owes it a moment between frames, after the last submit, which a lost
 * device's teardown is — X5.4i); a target not made yet has no view, and a
 * pass or a stage reading it draws nothing.
 * Never: imports Babylon; records a pass — `Renderer` records every pass into
 * these (the frame's clear and main pass, the mask) and the glow's blur
 * draws into the other five (`GlowBlur`); sizes itself — the frame is sized
 * by whoever reads the render size (`ChainPasses`), the glow's by its rules
 * (`GlowPass`).
 * Contract: `docs/rendering.md`, "Our renderer's frame" and "The glow".
 */
import type { FrameHost } from "./frameHost";
import { OwnTexture } from "./HostBindGroup";
import { FRAME_TARGETS, GLOW_BLUR_TARGETS, GLOW_TARGETS } from "./targets";

/** One of the frame's targets: its texture, its one view, its sampler (the glow's six) and its size. */
export class FrameTarget extends OwnTexture {
  texture: GPUTexture | null = null;
  width = 0;
  height = 0;
  /** The label each of its passes wears: Babylon's `<render target's name> - RenderPass`. */
  readonly passLabel: string;

  constructor(
    /** Babylon's name for the render target this stands in for. */
    readonly name: string,
    readonly format: GPUTextureFormat,
  ) {
    super();
    this.passLabel = `${name} - RenderPass`;
  }
}

export class FrameTargets {
  /** The frame the main pass draws: the post chain's first stage reads it (`PostPassOwner.frame`). */
  readonly frame: FrameTarget;
  /** The frame's depth: the main pass's, the mask's borrowed one, and every stage's `textureLoad`. */
  readonly depth: FrameTarget;
  /** The glow's emissive mask, full resolution: the ink's emissive mask. */
  readonly mask: FrameTarget;
  /** The mask box-filtered to quarter resolution, which the `low` rung blurs from; 1x1 on `high`. */
  readonly down: FrameTarget;
  /** The near blur's horizontal pass's output, then the finished near blur. */
  readonly nearH: FrameTarget;
  readonly near: FrameTarget;
  /** Half of `near` again: the wide blur's horizontal pass, then the finished wide blur. */
  readonly wideH: FrameTarget;
  readonly wide: FrameTarget;
  /**
   * The label the frame's two passes wear: Babylon labelled a pass by its
   * target's name, and named the frame for the stage that READS it
   * (`PostProcessRTT-<label>`, `ChainPasses.prepareFrame`).
   */
  frameLabel = "postChain frame - RenderPass";
  private readonly retired: GPUTexture[] = [];
  private readonly afterSubmit: { dispose(): void };

  constructor(
    private readonly device: GPUDevice,
    host: FrameHost,
    /** The glow's sampler: Babylon's cache's for a bilinear target, anisotropy 4, clamped. */
    glowSampler: GPUSampler,
  ) {
    this.frame = new FrameTarget("postChain frame", FRAME_TARGETS.colorFormats[0]);
    this.depth = new FrameTarget("postChain frame depth", FRAME_TARGETS.depthFormat!);
    this.mask = new FrameTarget("glowMask", GLOW_TARGETS.colorFormats[0]);
    const half = GLOW_BLUR_TARGETS.colorFormats[0];
    this.down = new FrameTarget("glowDown", half);
    this.nearH = new FrameTarget("glowNearH", half);
    this.near = new FrameTarget("glowNear", half);
    this.wideH = new FrameTarget("glowWideH", half);
    this.wide = new FrameTarget("glowWide", half);
    for (const t of [this.mask, this.down, this.nearH, this.near, this.wideH, this.wide]) t.sampler = glowSampler;
    this.afterSubmit = host.afterSubmit(this.destroyRetired);
  }

  /** The frame and its depth at `width` x `height`: made at the first ask, remade when the size moved. */
  sizeFrame(width: number, height: number): void {
    this.size(this.frame, width, height);
    this.size(this.depth, width, height);
  }

  /**
   * The glow's six: the mask at the frame's size, and the box filter's, the
   * near pair's and the wide pair's at theirs (`GlowPass` computes them) —
   * every one REMADE on every call, a size that did not move included, as
   * `GlowPass` resized Babylon's six and Babylon's `RenderTargetTexture.resize`
   * remade a target whatever its size (a rung change remakes them all, holding
   * zeros until drawn).
   */
  sizeGlow(
    maskWidth: number,
    maskHeight: number,
    downWidth: number,
    downHeight: number,
    nearWidth: number,
    nearHeight: number,
    wideWidth: number,
    wideHeight: number,
  ): void {
    this.size(this.mask, maskWidth, maskHeight, true);
    this.size(this.down, downWidth, downHeight, true);
    this.size(this.nearH, nearWidth, nearHeight, true);
    this.size(this.near, nearWidth, nearHeight, true);
    this.size(this.wideH, wideWidth, wideHeight, true);
    this.size(this.wide, wideWidth, wideHeight, true);
  }

  dispose(): void {
    this.afterSubmit.dispose();
    for (const t of [this.frame, this.depth, this.mask, this.down, this.nearH, this.near, this.wideH, this.wide]) {
      t.texture?.destroy();
      t.texture = null;
      t.view = null;
      t.width = 0;
      t.height = 0;
    }
    this.destroyRetired();
  }

  /**
   * `t` at `width` x `height`, remade (zeros) when it moved — or `always`; the
   * texture it held destroyed after the submit.
   */
  private size(t: FrameTarget, width: number, height: number, always = false): void {
    if (!always && t.texture && t.width === width && t.height === height) return;
    if (t.texture) this.retired.push(t.texture);
    const texture = this.device.createTexture({
      label: t.name,
      size: [width, height, 1],
      format: t.format,
      // `COPY_SRC | COPY_DST | TEXTURE_BINDING | RENDER_ATTACHMENT` (23), what
      // Babylon's render targets asked for, colour and depth alike. Named at
      // the call, never at the module's top level (`docs/build.md`).
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
    // Whole, as Babylon's hardware texture viewed it — and as its attachment
    // view was described (`bindFramebuffer`: the same seven fields).
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

  private readonly destroyRetired = (): void => {
    const retired = this.retired;
    if (retired.length === 0) return;
    for (let i = 0; i < retired.length; i++) retired[i].destroy();
    retired.length = 0;
  };
}
