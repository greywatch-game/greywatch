/**
 * render/frameHost.ts — What our renderer needs from whoever owns the frame,
 * stated as an interface so the owner can change without the renderer
 * noticing.
 * Owns: `FrameHost`, `DrawPhaseHooks` and `PassTargets`.
 * Invariants: everything a `FrameHost` hands over is WebGPU's or plain data —
 * a device, a command encoder, formats, floats; EVERY pass of the frame is the
 * RENDERER's (`BABYLON_EXIT.md` X5.4e and X5.4f): the frame's opening clear,
 * its main pass, the glow's mask and blur (`render/FrameTargets.ts`,
 * `Renderer`) and the post chain's, into its pool and the canvas
 * (`render/ChainPasses.ts`) — all recorded into `prepareEncoder` at the
 * moments the host tells (`onDrawPhase`, and the frame's own points); work
 * owed ahead of the draws reaches the GPU through `prepareEncoder` and
 * nothing else — recorded there, never kept, finished or submitted by the
 * renderer; what may only happen once the frame is submitted (a destroy)
 * waits for `afterSubmit`; no texture of the host's is bound by anything of
 * the renderer's (the host owns none it draws with since X5.4f).
 * Never: imports Babylon. The host is the game's own frame since X5.4f
 * (`core/SceneFrame.ts`), which reaches Babylon's engine for the device alone,
 * through `babylonSeam.ts`; the encoder, the frame's one submit and the end
 * of frame are the game's own loop's since X5.4g (`core/FrameLoop.ts`,
 * `render/FrameSubmit.ts`).
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 */

/** What a pass draws into: every pipeline drawn in it must match all of it. */
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

/**
 * The frame's DRAW PHASE as the host runs it: `begin` as it opens and `end` as
 * it closes, once each a frame the frame's camera draws, the host drawing
 * nothing of its own between the two. The renderer fills the frame and records
 * its prepares at `begin`, and records the frame's own passes — the opening
 * clear and the main pass, its seven points in their order — at `end`
 * (`Renderer`, `BABYLON_EXIT.md` X5.4e).
 */
export interface DrawPhaseHooks {
  /** Once, as the draw phase opens. */
  begin(): void;
  /** Once, as it closes — ahead of everything else told there (the glow's mask among them). */
  end(): void;
}

/** Whoever owns the frame, as the renderer sees it. */
export interface FrameHost {
  readonly device: GPUDevice;
  /**
   * The command encoder every pass of the frame is recorded into, with no
   * pass open in it: a compute pass recorded here reaches the GPU before the
   * main pass's draws read what it wrote, a pass into a texture of the
   * renderer's (a world shadow map) is drawn before any pass samples it, and
   * the frame's GPU timer (`?gpu`, `gpu.frame`) measures every one as the
   * frame's. The frame's own passes are recorded here after the prepares
   * (`Renderer`, `BABYLON_EXIT.md` X5.4e), and the post chain's after those
   * (`ChainPasses`, X5.4f). Asked at the call and used at once: never kept,
   * never finished, never submitted, and a pass begun in it is ended before
   * the call that began it returns.
   */
  prepareEncoder(): GPUCommandEncoder;
  /** The view-projection the frame's camera is drawn with, as 16 floats. */
  viewProjection(out: Float32Array): void;
  /**
   * The colour the frame is cleared to as it opens — the scene's clear colour,
   * the value Babylon's own clear of the frame read — written into `out`.
   */
  clearColor(out: GPUColorDict): void;
  /**
   * Calls `run` after EVERY frame's submit — once the frame's commands have
   * been handed to the queue, so a buffer or texture they hold may be
   * destroyed there and not before — until the returned handle is disposed.
   * What `run` does is its own; it records nothing (no encoder is open).
   */
  afterSubmit(run: () => void): { dispose(): void };
  /**
   * Hooks the frame camera's DRAW PHASE (`DrawPhaseHooks`) — never a shadow
   * map's, a probe's or any other pass's, none of which has one.
   */
  onDrawPhase(hooks: DrawPhaseHooks): { dispose(): void };
}
