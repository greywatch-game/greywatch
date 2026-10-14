/**
 * render/Renderer.ts — Our renderer: the device, the frame's uniforms and
 * their buffer, the pipeline cache, and the draws it records into the
 * frame's main pass.
 * Owns: `Renderer` — the frame's `FrameUniforms` and `FrameUniformBuffer`,
 * the `PipelineCache`, the list of `FrameDraw`s, and the hook into the host's
 * main pass; `FrameDraw` and `FrameContext`.
 * Invariants: every GPU resource it holds it made, on the host's device, and
 * destroys in `dispose` (`BABYLON_EXIT.md` rule 5 — a texture another side
 * owns is READ through the seam, never copied); the frame's uniforms are
 * filled by the `fill` it is handed (`CelMaterialFactory.fillFrame`) and the
 * host's camera, once per frame as the main pass begins, and uploaded only
 * when something will draw — with nothing added it costs one empty branch a
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
 * WHERE A DRAW LANDS. After rendering group `groupId` (0: the world) has
 * been queued in the main pass — so after its opaque, alpha-tested and
 * blended meshes alike — and before the next group (the viewmodel's), in
 * Babylon's own order. A draw that must come before the group's blended
 * meshes owes the host a second hook point; X3.3 is the first step that
 * needs to say which.
 */
import { createFrameUniforms, type FrameUniforms } from "./frame";
import type { FrameHost } from "./frameHost";
import { FrameUniformBuffer } from "./FrameUniformBuffer";
import { PipelineCache } from "./PipelineCache";
import { FRAME_TARGETS } from "./targets";

/** What a draw is handed beside the pass. */
export interface FrameContext {
  /** The frame block's buffer: group 0, binding 0 of every program. */
  readonly frameBuffer: GPUBuffer;
  /** Whether clip-space y is negated in this pass — see `PassTargets.flipY`. */
  readonly flipY: boolean;
}

/**
 * One thing drawn in the main pass. It sets its own pipeline, bind groups
 * and buffers (the host leaves none set), changes none of the host's dynamic
 * state (`FrameHost.queue`), and draws only with pipelines built against
 * `FRAME_TARGETS`.
 */
export type FrameDraw = (pass: GPURenderPassEncoder, ctx: FrameContext) => void;

export class Renderer {
  readonly device: GPUDevice;
  readonly pipelines: PipelineCache;
  /** The frame as last filled. Read-only to anything but `begin`. */
  readonly frame: FrameUniforms = createFrameUniforms();
  readonly frameBuffer: FrameUniformBuffer;

  /** In the order added. An array, so a frame's walk allocates no iterator. */
  private readonly draws: FrameDraw[] = [];
  private readonly ctx: FrameContext;
  private readonly hook: { dispose(): void };
  /** Whether `begin` filled and uploaded the frame this draw phase. */
  private filled = false;
  /** Whether the last pass checked was refused — so a refusal is reported once per change. */
  private refused = false;

  constructor(
    private readonly host: FrameHost,
    private readonly fill: (out: FrameUniforms) => void,
    groupId = 0,
  ) {
    this.device = host.device;
    this.pipelines = new PipelineCache(this.device);
    this.frameBuffer = new FrameUniformBuffer(this.device, "main pass");
    this.ctx = { frameBuffer: this.frameBuffer.buffer, flipY: FRAME_TARGETS.flipY };
    this.hook = host.onMainPass(groupId, this.begin, this.afterGroup);
  }

  /** Draws `draw` in every main pass from the next one on, until the returned function is called. */
  add(draw: FrameDraw): () => void {
    this.draws.push(draw);
    return () => {
      const at = this.draws.indexOf(draw);
      if (at >= 0) this.draws.splice(at, 1);
    };
  }

  dispose(): void {
    this.hook.dispose();
    this.draws.length = 0;
    this.frameBuffer.destroy();
  }

  private readonly begin = (): void => {
    this.filled = this.draws.length > 0;
    if (!this.filled) return;
    this.fill(this.frame);
    this.host.viewProjection(this.frame.viewProjection);
    this.frameBuffer.write(this.frame);
  };

  private readonly afterGroup = (): void => {
    if (!this.filled || this.draws.length === 0) return;
    this.filled = false;
    if (!this.host.passIs(FRAME_TARGETS)) {
      if (!this.refused) {
        console.error(
          "render: the main pass is not what FRAME_TARGETS states — drawing nothing",
          { open: this.host.openPass(), stated: FRAME_TARGETS },
        );
      }
      this.refused = true;
      return;
    }
    this.refused = false;
    this.host.queue(this.run);
  };

  private readonly run = (pass: GPURenderPassEncoder): void => {
    const draws = this.draws;
    for (let i = 0; i < draws.length; i++) draws[i](pass, this.ctx);
  };
}
