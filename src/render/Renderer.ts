/**
 * render/Renderer.ts — Our renderer: the device, the frame's uniforms and
 * their buffer, the pipeline cache, and the draws it records into the
 * frame's main pass — and into the glow's mask pass, the one other pass of
 * the host's it draws in (`BABYLON_EXIT.md` X3.6d).
 * Owns: `Renderer` — the frame's `FrameUniforms` and `FrameUniformBuffer`,
 * its `FrameTextures` and the bind group they make with the buffer (group 0
 * of every program, `FrameContext.frameGroup`, handed to a prepare as to a
 * draw), the `PipelineCache`, the `FrameDraw`s at each of the three
 * points they may be drawn at and those drawn in the glow's mask
 * (`addGlowMask`), the `FramePrepare`s run as the pass begins, whoever is
 * told of a refused pass (`onRefused`, and the mask's `onGlowMaskRefused`),
 * the hook into the host's main pass, and the `PassTimer` that times the
 * prepares' passes under `?gpu` (`timer`); `FrameDraw`, `FramePrepare`,
 * `DrawPoint`, `FrameContext` and `RendererOptions`.
 * Invariants: every GPU resource it holds it made, on the host's device, and
 * destroys in `dispose` (`BABYLON_EXIT.md` rule 5 — a texture another side
 * owns is READ through the seam, never copied); the frame's uniforms are
 * filled by the `fill` it is handed (`CelMaterialFactory.fillFrame`) and the
 * host's camera, and its textures by `fillTextures`
 * (`CelMaterialFactory.fillFrameTextures`) resolved through the host, once
 * per frame as the main pass begins, and uploaded only when something will
 * draw — with nothing added it costs one empty branch a
 * frame; every `FramePrepare` runs right after that fill, on the same frames,
 * so what it hands the GPU is this frame's, and records into the host's
 * encoder rather than submitting one of its own, so the frame's GPU timer
 * sees it, the LATE ones after the rest (`onFrame`'s `late`) — and, with a
 * `timer`, is handed the `PassTiming` its passes take
 * their timestamp writes from on a frame being timed, null on every other
 * (`gpu.cull`); without one, timing costs the frame one null test; a frame
 * draws only if it was
 * FILLED this frame (a draw added
 * mid-phase waits for the next) and only if the open pass is exactly
 * `FRAME_TARGETS`, checked every frame — a pass that is not draws nothing
 * that frame, with one console error per change, rather than recording a
 * pipeline the pass cannot take (that blacks out the frame under bundles),
 * and every `onRefused` listener is told, on every frame it is refused, so a
 * draw that something else would otherwise draw can be handed back to it;
 * a GLOW MASK draw is recorded only when the mask's owner says its pass has
 * OPENED (`glowMaskOpened`, wired by `Game` to `GlowPass`, which owns the
 * mask: rule 5 — ours draws INTO Babylon's pass, as it does the main one),
 * on a frame whose `begin` filled the frame, FIRST in that pass, right after
 * its clear, and only if the open pass is exactly `GLOW_TARGETS` — with the
 * main pass's refusal rule and listeners of its own (`onGlowMaskRefused`);
 * it reads the MAIN pass's frame — the same camera, in the same submit — so
 * it binds the same group 0; nothing here allocates on a frame.
 * Never: imports Babylon — it is handed a `FrameHost`; draws into any of the
 * HOST's passes but the main one and the glow's mask when told it opened (a
 * prepare's pass into a texture of ours is the prepare's); reads a Babylon
 * material; finds the glow's mask by testing a pass's targets — it is TOLD.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 *
 * WHERE A DRAW LANDS, in the host's own order, at one of three points of
 * rendering group `groupId` (0: the world) in the main pass (`DrawPoint`),
 * which come in this order in every frame the group is drawn:
 * - `"beforeAlphaTest"`: after the group's opaque meshes and before its
 *   ALPHA-TESTED ones — or, in a frame with none of those, immediately ahead
 *   of `"opaque"`. An opaque draw that something on the alpha-tested list
 *   is laid OVER goes here: that list is where a blend that must land after
 *   the surface under it is put (the turf, `GrassSystem`; the clouds), and
 *   the turf writes no depth of its own — so the FLOOR it lies on must be in
 *   the depth buffer, and in the picture, before it draws. The world's other
 *   opaque draws go here too, AHEAD of the floor (`WorldBlocks`): the point
 *   is after the sky dome, which writes no depth, and a building drawn
 *   before the floor behind it spares that floor its shading.
 * - `"opaque"`: after the group's opaque and alpha-tested meshes and before
 *   anything blended in it — its particles and its transparent meshes. No
 *   OPAQUE draw goes later, because the blended surfaces write no depth: an
 *   opaque wall drawn after the glazing or the water in front of it paints
 *   over them, and one drawn after a particle in front of it paints over
 *   the particle.
 * - `"afterGroup"`: after the group has been queued whole, and before the
 *   next group (the viewmodel's).
 */
import {
  createFrameTextures,
  createFrameUniforms,
  FRAME_BLOCK,
  FRAME_TEXTURES,
  type FrameTextures,
  type FrameUniforms,
} from "./frame";
import type { FrameHost } from "./frameHost";
import { FrameUniformBuffer } from "./FrameUniformBuffer";
import { HostBindGroup } from "./HostBindGroup";
import { type PassTiming, PassTimer } from "./PassTimer";
import { PipelineCache } from "./PipelineCache";
import { FRAME_TARGETS, GLOW_TARGETS } from "./targets";

/** What a draw is handed beside the pass. */
export interface FrameContext {
  /** The frame block's buffer: group 0, binding 0 of every program. */
  readonly frameBuffer: GPUBuffer;
  /** Whether clip-space y is negated in this pass — see `PassTargets.flipY`. */
  readonly flipY: boolean;
  /**
   * Group 0 — the frame block and every frame texture — made against
   * `layout`, or null on a frame a texture is not published yet (draw
   * nothing that reads it). Valid for this frame.
   */
  frameGroup(layout: GPUBindGroupLayout): GPUBindGroup | null;
}

/**
 * One thing drawn in the main pass — or in the glow's mask (`addGlowMask`).
 * It sets its own pipeline, bind groups and buffers (the host leaves none
 * set), changes none of the host's dynamic state (`FrameHost.queue`), and
 * draws only with pipelines built against its pass's targets
 * (`FRAME_TARGETS`, `GLOW_TARGETS`).
 */
export type FrameDraw = (pass: GPURenderPassEncoder, ctx: FrameContext) => void;

/**
 * Work for the frame that must reach the GPU before the main pass's draws do
 * — a compute cull, or a pass into a texture our renderer owns that the
 * frame samples (a world shadow map, `WorldShadows`). Run once a frame as
 * the pass begins, after the frame is filled; it records into `encoder`, the
 * host's own, which is submitted ahead of every pass of the host's and inside
 * the frame's GPU timer (`FrameHost.prepareEncoder`) — a pass it records is
 * begun and ended there — and it records nothing into the main pass, submits
 * nothing and keeps neither.
 * `timing` is non-null on a frame whose passes are timed (`PassTimer`): each
 * compute pass it records then begins with `timing.pass(its descriptor)`, so
 * `gpu.cull` is the sum of them.
 * **Once a SUBMIT, as the frame block is**: what it hands the queue
 * (`writeBuffer`) lands before the submit its recording rides in, so a second
 * run before that submit would leave both reading the second one's values.
 * The main pass begins once a frame; a second pass that runs prepares owes
 * them a buffer of its own.
 */
export type FramePrepare = (
  frame: FrameUniforms,
  encoder: GPUCommandEncoder,
  timing: PassTiming | null,
  /** What a draw is handed, valid for this frame: a prepare may ask it whether something can draw. */
  ctx: FrameContext,
) => void;

/** How a `Renderer` is built beyond its host and its fills. */
export interface RendererOptions {
  /** The rendering group its draws are hooked into: 0, the world. */
  readonly groupId?: number;
  /**
   * Time the prepares' compute passes (`PassTimer`, `gpu.cull`): `?gpu`,
   * and only where the device has `timestamp-query` — asked of the device,
   * so a request it cannot answer builds no timer.
   */
  readonly timePasses?: boolean;
}

/** Where in the main pass a `FrameDraw` is drawn — see the header. */
export type DrawPoint = "beforeAlphaTest" | "opaque" | "afterGroup";

export class Renderer {
  readonly device: GPUDevice;
  readonly host: FrameHost;
  readonly pipelines: PipelineCache;
  /** The frame as last filled. Read-only to anything but `begin`. */
  readonly frame: FrameUniforms = createFrameUniforms();
  readonly frameBuffer: FrameUniformBuffer;
  /** The frame's textures as last pulled. Read-only to anything but `begin`. */
  readonly textures: FrameTextures = createFrameTextures();
  /** The prepares' pass timer, under `?gpu` on a device that can; null otherwise. */
  readonly timer: PassTimer | null;
  private readonly frameBindings: HostBindGroup;

  /** In the order added, one list per point. Arrays, so a frame's walk allocates no iterator. */
  private readonly beforeAlpha: FrameDraw[] = [];
  private readonly opaque: FrameDraw[] = [];
  private readonly after: FrameDraw[] = [];
  private readonly prepares: FramePrepare[] = [];
  private readonly latePrepares: FramePrepare[] = [];
  private readonly refusals: (() => void)[] = [];
  /** Drawn first in the glow's mask, in the order added (`addGlowMask`). */
  private readonly maskDraws: FrameDraw[] = [];
  private readonly maskRefusals: (() => void)[] = [];
  /** What every draw and prepare is handed: the frame block's buffer and its group 0. */
  private readonly ctx: FrameContext;
  private readonly hook: { dispose(): void };
  /** Whether `begin` filled and uploaded the frame this draw phase. */
  private filled = false;
  /** Whether `begin` filled the frame for the glow's mask, which opens after the main pass — until it does. */
  private maskFilled = false;
  /** Whether the last pass checked was refused — so a refusal is reported once per change. */
  private refused = false;
  /** The same, for the glow's mask. */
  private maskRefused = false;

  constructor(
    host: FrameHost,
    private readonly fill: (out: FrameUniforms) => void,
    private readonly fillTextures: (out: FrameTextures) => void,
    options: RendererOptions = {},
  ) {
    this.host = host;
    this.device = host.device;
    this.pipelines = new PipelineCache(this.device);
    this.timer =
      options.timePasses && this.device.features.has("timestamp-query") ? new PassTimer(this.device) : null;
    this.frameBuffer = new FrameUniformBuffer(this.device, "main pass");
    this.frameBindings = new HostBindGroup(
      this.device,
      "main pass frame",
      [FRAME_BLOCK, ...FRAME_TEXTURES],
      ["CEL_PALETTE"],
      { [FRAME_BLOCK.var]: this.frameBuffer.buffer },
    );
    const bindings = this.frameBindings;
    this.ctx = {
      frameBuffer: this.frameBuffer.buffer,
      flipY: FRAME_TARGETS.flipY,
      frameGroup: (layout) => bindings.get(layout),
    };
    this.hook = host.onMainPass(options.groupId ?? 0, {
      begin: this.begin,
      beforeAlphaTest: this.beforeAlphaTest,
      afterOpaque: this.afterOpaque,
      afterGroup: this.afterGroup,
    });
  }

  /**
   * Draws `draw` at `at` in every main pass from the next one on, until the
   * returned function is called.
   */
  add(draw: FrameDraw, at: DrawPoint = "afterGroup"): () => void {
    const list =
      at === "beforeAlphaTest" ? this.beforeAlpha : at === "opaque" ? this.opaque : this.after;
    list.push(draw);
    return () => {
      const i = list.indexOf(draw);
      if (i >= 0) list.splice(i, 1);
    };
  }

  /**
   * Runs `prepare` in every main pass from the next one on, until the
   * returned function is called — with `late`, after every prepare that is
   * not: work that SAMPLES what the others draw this frame (a probe's bake
   * reads the world's shadow maps and the lamps' atlas), whatever order the
   * two were added in.
   */
  onFrame(prepare: FramePrepare, late = false): () => void {
    const list = late ? this.latePrepares : this.prepares;
    list.push(prepare);
    return () => {
      const i = list.indexOf(prepare);
      if (i >= 0) list.splice(i, 1);
    };
  }

  /**
   * Calls `refused` on every frame whose main pass is not `FRAME_TARGETS` and
   * something was to draw, until the returned function is called — at each
   * point with something to draw, so up to three times a frame, which a
   * listener must take as one refusal. It runs INSIDE the render, after this
   * frame's prepares were recorded, so it may take draws and prepares off
   * this renderer but must free nothing this frame's commands hold.
   */
  onRefused(refused: () => void): () => void {
    this.refusals.push(refused);
    return () => {
      const i = this.refusals.indexOf(refused);
      if (i >= 0) this.refusals.splice(i, 1);
    };
  }

  /**
   * Draws `draw` in the glow's MASK pass from the next frame on, until the
   * returned function is called: FIRST in that pass, right after its clear,
   * ahead of every mesh Babylon draws into it — on every frame the mask's
   * owner says its pass opened (`glowMaskOpened`). Its pipelines are built
   * against `GLOW_TARGETS`, and it reads the main pass's frame
   * (`FrameContext`): the mask is drawn from the same camera in the same
   * submit.
   */
  addGlowMask(draw: FrameDraw): () => void {
    this.maskDraws.push(draw);
    return () => {
      const i = this.maskDraws.indexOf(draw);
      if (i >= 0) this.maskDraws.splice(i, 1);
    };
  }

  /**
   * Calls `refused` on every frame the glow's mask pass is not
   * `GLOW_TARGETS` and something was to draw in it, until the returned
   * function is called. Like `onRefused`'s, it runs INSIDE the render — in
   * the mask's clear, after Babylon built the mask's list — so it may take
   * draws and prepares off this renderer but must free nothing this frame's
   * commands hold.
   */
  onGlowMaskRefused(refused: () => void): () => void {
    this.maskRefusals.push(refused);
    return () => {
      const i = this.maskRefusals.indexOf(refused);
      if (i >= 0) this.maskRefusals.splice(i, 1);
    };
  }

  /**
   * The glow's mask pass has OPENED: its owner calls this from inside its
   * clear (`GlowPass.onMaskOpenObservable`), the pass begun and nothing of
   * Babylon's queued in it yet. Queues the mask's draws there — on a frame
   * `begin` filled, and only into a pass that is exactly `GLOW_TARGETS`; one
   * that is not draws nothing of ours, with one console error per change,
   * and every `onGlowMaskRefused` listener is told.
   */
  glowMaskOpened(): void {
    const filled = this.maskFilled;
    this.maskFilled = false;
    if (!filled || this.maskDraws.length === 0) return;
    if (!this.host.passIs(GLOW_TARGETS)) {
      if (!this.maskRefused) {
        console.error(
          "render: the glow's mask pass is not what GLOW_TARGETS states — drawing nothing of ours in it",
          { open: this.host.openPass(), stated: GLOW_TARGETS },
        );
      }
      this.maskRefused = true;
      const refusals = this.maskRefusals;
      for (let i = 0; i < refusals.length; i++) refusals[i]();
      return;
    }
    this.maskRefused = false;
    this.host.queue(this.runMask);
  }

  dispose(): void {
    this.hook.dispose();
    this.beforeAlpha.length = 0;
    this.opaque.length = 0;
    this.after.length = 0;
    this.prepares.length = 0;
    this.latePrepares.length = 0;
    this.refusals.length = 0;
    this.maskDraws.length = 0;
    this.maskRefusals.length = 0;
    this.frameBuffer.destroy();
    this.timer?.dispose();
  }

  private readonly begin = (): void => {
    const timer = this.timer;
    // Last frame's reading, if one was recorded: its submit is past now.
    timer?.settle();
    this.filled = this.beforeAlpha.length + this.opaque.length + this.after.length > 0;
    // The glow's mask opens after the main pass, and draws from the frame
    // filled here.
    this.maskFilled = this.maskDraws.length > 0;
    if (!this.filled && !this.maskFilled) return;
    this.fill(this.frame);
    this.host.viewProjection(this.frame.viewProjection);
    this.frameBuffer.write(this.frame);
    this.fillTextures(this.textures);
    this.frameBindings.refresh(this.host, this.textures);
    const prepares = this.prepares;
    const late = this.latePrepares;
    if (prepares.length + late.length === 0) return;
    const encoder = this.host.prepareEncoder();
    const timing = timer !== null && timer.open() ? timer : null;
    for (let i = 0; i < prepares.length; i++) prepares[i](this.frame, encoder, timing, this.ctx);
    for (let i = 0; i < late.length; i++) late[i](this.frame, encoder, timing, this.ctx);
    if (timing) timing.close(encoder);
  };

  private readonly beforeAlphaTest = (): void => {
    if (this.filled && this.beforeAlpha.length > 0 && this.passOk()) this.host.queue(this.runBeforeAlpha);
  };

  private readonly afterOpaque = (): void => {
    if (this.filled && this.opaque.length > 0 && this.passOk()) this.host.queue(this.runOpaque);
  };

  private readonly afterGroup = (): void => {
    const filled = this.filled;
    this.filled = false;
    if (filled && this.after.length > 0 && this.passOk()) this.host.queue(this.runAfter);
  };

  /** Whether the open pass is `FRAME_TARGETS`; a refusal is reported once per change. */
  private passOk(): boolean {
    if (!this.host.passIs(FRAME_TARGETS)) {
      if (!this.refused) {
        console.error(
          "render: the main pass is not what FRAME_TARGETS states — drawing nothing of ours",
          { open: this.host.openPass(), stated: FRAME_TARGETS },
        );
      }
      this.refused = true;
      const refusals = this.refusals;
      for (let i = 0; i < refusals.length; i++) refusals[i]();
      return false;
    }
    this.refused = false;
    return true;
  }

  private readonly runBeforeAlpha = (pass: GPURenderPassEncoder): void => {
    const draws = this.beforeAlpha;
    for (let i = 0; i < draws.length; i++) draws[i](pass, this.ctx);
  };

  private readonly runOpaque = (pass: GPURenderPassEncoder): void => {
    const draws = this.opaque;
    for (let i = 0; i < draws.length; i++) draws[i](pass, this.ctx);
  };

  private readonly runAfter = (pass: GPURenderPassEncoder): void => {
    const draws = this.after;
    for (let i = 0; i < draws.length; i++) draws[i](pass, this.ctx);
  };

  private readonly runMask = (pass: GPURenderPassEncoder): void => {
    const draws = this.maskDraws;
    for (let i = 0; i < draws.length; i++) draws[i](pass, this.ctx);
  };
}
