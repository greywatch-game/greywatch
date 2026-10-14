/**
 * render/frameHost.ts — What our renderer needs from whoever owns the frame,
 * stated as an interface so the owner can change without the renderer
 * noticing.
 * Owns: `FrameHost` and `PassTargets`.
 * Invariants: everything a `FrameHost` hands over is WebGPU's or plain data —
 * a device, a pass encoder, formats, floats; a draw reaches the pass through
 * `queue` and nothing else, in the host's own order.
 * Never: imports Babylon. Babylon's host is `babylonSeam.ts`'s
 * `BabylonFrameHost`, until the game owns the frame (`BABYLON_EXIT.md` X5.4)
 * and a host of its own implements this instead.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 */

/** What the open pass draws into: every pipeline drawn in it must match all of it. */
export interface PassTargets {
  /** One per colour attachment, in attachment order. */
  readonly colorFormats: readonly GPUTextureFormat[];
  readonly depthFormat: GPUTextureFormat | undefined;
  readonly sampleCount: number;
  /**
   * The pass draws into a texture that is rendered upside down, so a later
   * sample reads it the GL way up — clip-space y is negated there.
   */
  readonly flipY: boolean;
}

/** Whoever owns the frame, as the renderer sees it. */
export interface FrameHost {
  readonly device: GPUDevice;
  /** The attachments of the pass open now — for a diagnostic; it allocates. */
  openPass(): PassTargets;
  /** Whether the pass open now is exactly `t`. The per-frame test: allocates nothing. */
  passIs(t: PassTargets): boolean;
  /**
   * Records `run` into the open pass at this point in the host's draw order.
   * It is called once, later in the same frame, with the pass. The pipeline,
   * bind groups and buffers are unset when it starts, so it sets every one it
   * uses; the viewport, scissor, stencil reference and blend constant are the
   * host's, so it changes NONE of them (or restores each before returning).
   */
  queue(run: (pass: GPURenderPassEncoder) => void): void;
  /** The view-projection the frame's camera is drawn with, as 16 floats. */
  viewProjection(out: Float32Array): void;
  /**
   * Hooks the frame's MAIN pass — never a shadow map's, a probe's or any other
   * render target's: `begin` once as its drawing starts, `afterGroup` once
   * after rendering group `groupId` has been queued in it.
   */
  onMainPass(groupId: number, begin: () => void, afterGroup: () => void): { dispose(): void };
}
