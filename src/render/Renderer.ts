/**
 * render/Renderer.ts — Our renderer: the device, the frame's uniforms and
 * their buffer, the pipeline cache, and the draws it records into the
 * frame's main pass.
 * Owns: `Renderer` — the frame's `FrameUniforms` and `FrameUniformBuffer`,
 * its `FrameTextures` and the bind group they make with the buffer (group 0
 * of every program, `FrameContext.frameGroup`), the `PipelineCache`, the `FrameDraw`s at each of the two points they may be
 * drawn at, and the hook into the host's main pass; `FrameDraw`, `DrawPoint`
 * and `FrameContext`.
 * Invariants: every GPU resource it holds it made, on the host's device, and
 * destroys in `dispose` (`BABYLON_EXIT.md` rule 5 — a texture another side
 * owns is READ through the seam, never copied); the frame's uniforms are
 * filled by the `fill` it is handed (`CelMaterialFactory.fillFrame`) and the
 * host's camera, and its textures by `fillTextures`
 * (`CelMaterialFactory.fillFrameTextures`) resolved through the host, once
 * per frame as the main pass begins, and uploaded only when something will
 * draw — with nothing added it costs one empty branch a
 * frame; a frame draws only if it was FILLED this frame (a draw added
 * mid-phase waits for the next) and only if the open pass is exactly
 * `FRAME_TARGETS`, checked every frame — a pass that is not draws nothing
 * that frame, with one console error per change, rather than recording a
 * pipeline the pass cannot take (that blacks out the frame under bundles);
 * nothing here allocates on a frame.
 * Never: imports Babylon — it is handed a `FrameHost`; draws into any pass
 * but the main one; reads a Babylon material.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 *
 * WHERE A DRAW LANDS, in the host's own order, at one of two points of
 * rendering group `groupId` (0: the world) in the main pass (`DrawPoint`):
 * - `"opaque"`: after the group's opaque and alpha-tested meshes and before
 *   anything blended in it — its particles and its transparent meshes. An
 *   OPAQUE draw goes here and nowhere else, because the blended surfaces
 *   write no depth: an opaque wall drawn after the glazing or the water in
 *   front of it paints over them, and one drawn after a particle in front of
 *   it paints over the particle.
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
import { PipelineCache } from "./PipelineCache";
import { FRAME_TARGETS } from "./targets";

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
 * One thing drawn in the main pass. It sets its own pipeline, bind groups
 * and buffers (the host leaves none set), changes none of the host's dynamic
 * state (`FrameHost.queue`), and draws only with pipelines built against
 * `FRAME_TARGETS`.
 */
export type FrameDraw = (pass: GPURenderPassEncoder, ctx: FrameContext) => void;

/** Where in the main pass a `FrameDraw` is drawn — see the header. */
export type DrawPoint = "opaque" | "afterGroup";

export class Renderer {
  readonly device: GPUDevice;
  readonly host: FrameHost;
  readonly pipelines: PipelineCache;
  /** The frame as last filled. Read-only to anything but `begin`. */
  readonly frame: FrameUniforms = createFrameUniforms();
  readonly frameBuffer: FrameUniformBuffer;
  /** The frame's textures as last pulled. Read-only to anything but `begin`. */
  readonly textures: FrameTextures = createFrameTextures();
  private readonly frameBindings: HostBindGroup;

  /** In the order added, one list per point. Arrays, so a frame's walk allocates no iterator. */
  private readonly opaque: FrameDraw[] = [];
  private readonly after: FrameDraw[] = [];
  private readonly ctx: FrameContext;
  private readonly hook: { dispose(): void };
  /** Whether `begin` filled and uploaded the frame this draw phase. */
  private filled = false;
  /** Whether the last pass checked was refused — so a refusal is reported once per change. */
  private refused = false;

  constructor(
    host: FrameHost,
    private readonly fill: (out: FrameUniforms) => void,
    private readonly fillTextures: (out: FrameTextures) => void,
    groupId = 0,
  ) {
    this.host = host;
    this.device = host.device;
    this.pipelines = new PipelineCache(this.device);
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
    this.hook = host.onMainPass(groupId, {
      begin: this.begin,
      afterOpaque: this.afterOpaque,
      afterGroup: this.afterGroup,
    });
  }

  /**
   * Draws `draw` at `at` in every main pass from the next one on, until the
   * returned function is called.
   */
  add(draw: FrameDraw, at: DrawPoint = "afterGroup"): () => void {
    const list = at === "opaque" ? this.opaque : this.after;
    list.push(draw);
    return () => {
      const i = list.indexOf(draw);
      if (i >= 0) list.splice(i, 1);
    };
  }

  dispose(): void {
    this.hook.dispose();
    this.opaque.length = 0;
    this.after.length = 0;
    this.frameBuffer.destroy();
  }

  private readonly begin = (): void => {
    this.filled = this.opaque.length + this.after.length > 0;
    if (!this.filled) return;
    this.fill(this.frame);
    this.host.viewProjection(this.frame.viewProjection);
    this.frameBuffer.write(this.frame);
    this.fillTextures(this.textures);
    this.frameBindings.refresh(this.host, this.textures);
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
          "render: the main pass is not what FRAME_TARGETS states — drawing nothing",
          { open: this.host.openPass(), stated: FRAME_TARGETS },
        );
      }
      this.refused = true;
      return false;
    }
    this.refused = false;
    return true;
  }

  private readonly runOpaque = (pass: GPURenderPassEncoder): void => {
    const draws = this.opaque;
    for (let i = 0; i < draws.length; i++) draws[i](pass, this.ctx);
  };

  private readonly runAfter = (pass: GPURenderPassEncoder): void => {
    const draws = this.after;
    for (let i = 0; i < draws.length; i++) draws[i](pass, this.ctx);
  };
}
