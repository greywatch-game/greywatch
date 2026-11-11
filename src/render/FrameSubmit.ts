/**
 * render/FrameSubmit.ts — The frame's ONE command encoder and its ONE
 * `queue.submit` (`BABYLON_EXIT.md` X5.4g): what Babylon's engine did for the
 * frame in `flushFramebuffer` until then, with its two encoders, of which
 * every pass of ours was recorded on the first (the seam's item 9, retired).
 * Owns: `FrameSubmit` — the encoder every pass of a frame is recorded into
 * (`encoder`, which the frame's host hands the renderer as
 * `FrameHost.prepareEncoder`), the frame's submit (`submit`), and under `?gpu`
 * the frame's GPU timer (`render/FrameTimer.ts`, `gpu.frame`).
 * Invariants: there is ALWAYS an encoder to record into, inside a frame or
 * between two — made at construction and again by every `submit`, right
 * after it, as Babylon made its next frame's encoders in `flushFramebuffer`
 * — so work recorded between frames (an upload whose decode landed on a
 * task) is the next frame's, submitted ahead of nothing it was recorded
 * after; `submit` finishes the encoder and hands it to the queue in ONE
 * `queue.submit` of ONE command buffer, never mid-frame; the timer's two
 * stamps are the encoder's first and last commands, opened as the encoder
 * is made (Babylon's `startFrame` on its new upload encoder) and closed as it
 * is finished, its read-back begun after the submit that carries it; nothing
 * here allocates on a frame but the command buffer WebGPU makes and the
 * timer's read-back once a reading.
 * Never: imports Babylon; records a pass of its own but the timer's two empty
 * ones; tells anybody the frame was submitted — the frame loop does, after
 * `submit` returns (`core/FrameLoop.ts`, its end-of-frame observable, which
 * `FrameHost.afterSubmit` adds to).
 * Contract: `docs/rendering.md`, "Our renderer's frame";
 * `docs/profiling.md`, "GPU time, and why it is a BOOT FLAG".
 */
import { FrameTimer } from "./FrameTimer";

export class FrameSubmit {
  /** The whole frame's GPU timer, or null without `?gpu` or `timestamp-query`. */
  readonly timer: FrameTimer | null;
  private current: GPUCommandEncoder;
  /** The one command buffer a submit hands over, in an array made once. */
  private readonly buffers: GPUCommandBuffer[] = [];
  private readonly descriptor: GPUCommandEncoderDescriptor = { label: "frame encoder" };

  constructor(
    private readonly device: GPUDevice,
    /** Whether the frame's GPU time is measured (`?gpu`): asked of the device too. */
    timeFrame: boolean,
  ) {
    this.timer = timeFrame && device.features.has("timestamp-query") ? new FrameTimer(device) : null;
    this.current = this.make();
  }

  /** The encoder the frame is being recorded into: asked at the call, never kept. */
  get encoder(): GPUCommandEncoder {
    return this.current;
  }

  /**
   * The frame's end: the timer closed, the encoder finished and submitted —
   * the frame's one `queue.submit` — and the next frame's encoder made, its
   * timer opened, as `flushFramebuffer` made Babylon's after its submit.
   */
  submit(): void {
    const encoder = this.current;
    this.timer?.close(encoder);
    this.buffers[0] = encoder.finish();
    this.device.queue.submit(this.buffers);
    this.timer?.submitted();
    this.current = this.make();
  }

  dispose(): void {
    this.timer?.dispose();
  }

  private make(): GPUCommandEncoder {
    const encoder = this.device.createCommandEncoder(this.descriptor);
    this.timer?.open(encoder);
    return encoder;
  }
}
