/**
 * render/frameHost.ts — What our renderer needs from whoever owns the frame,
 * stated as an interface so the owner can change without the renderer
 * noticing.
 * Owns: `FrameHost`, `DrawPhaseHooks`, `PassTargets`, `HostTexture` and
 * `BoundTexture`.
 * Invariants: everything a `FrameHost` hands over is WebGPU's or plain data —
 * a device, a pass encoder, a command encoder, a texture view and a sampler,
 * formats, floats; the frame's own passes — its opening clear, its main pass,
 * the glow's mask and blur — are the RENDERER's (`render/FrameTargets.ts`,
 * `BABYLON_EXIT.md` X5.4e), recorded into `prepareEncoder` at the moments the
 * host tells (`onDrawPhase`); a draw reaches a pass the HOST opened — the post
 * chain's, until X5.4f — through `queue` and nothing else, in the host's own
 * order, when its owner asks from inside it; work owed ahead of the draws
 * reaches the GPU through `prepareEncoder` and nothing else — recorded there,
 * never kept, finished or submitted by the renderer; what may only happen once
 * the frame is submitted (a destroy) waits for `afterSubmit`; a texture the
 * host owns is handed over as ITS view, read where it lies and never copied
 * (`BABYLON_EXIT.md` rule 5).
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

/**
 * A texture the HOST owns, as the renderer holds it: a name for one, which
 * only the host can turn into something to bind (`FrameHost.bind`). Branded
 * so nothing but the host's own crossing mints one.
 */
export interface HostTexture {
  readonly __hostTexture: never;
}

/** What a `HostTexture` binds as, this frame: the host's own view and sampler. */
export interface BoundTexture {
  view: GPUTextureView | null;
  sampler: GPUSampler | null;
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
  /** The attachments of the pass open now — for a diagnostic; it allocates. */
  openPass(): PassTargets;
  /** Whether the pass open now is exactly `t`. The per-frame test: allocates nothing. */
  passIs(t: PassTargets): boolean;
  /**
   * Records `run` into the open pass at this point in the host's draw order —
   * a pass of the post chain, asked from inside it (`Renderer.postStageOpened`;
   * the main pass, the glow's mask and its blur were queued here too until
   * `BABYLON_EXIT.md` X5.4e made them the renderer's own passes).
   * It is called once, later in the same frame, with the pass. The pipeline,
   * bind groups and buffers are unset when it starts, so it sets every one it
   * uses; the viewport, scissor, stencil reference and blend constant are the
   * host's, so it changes NONE of them (or restores each before returning).
   */
  queue(run: (pass: GPURenderPassEncoder) => void): void;
  /**
   * The command encoder the host submits AHEAD of the frame's draws — ahead of
   * every pass of the host's, its render targets' included — with no pass
   * open in it: so a compute pass recorded here reaches the GPU before the
   * main pass's draws read what it wrote, a pass into a texture of the
   * renderer's (a world shadow map) is drawn before any of the host's passes
   * samples it, and the frame's GPU timer (`?gpu`, `gpu.frame`) measures
   * either as the frame's. The frame's own passes are recorded here too, after
   * the prepares (`Renderer`, `BABYLON_EXIT.md` X5.4e): it is submitted ahead
   * of every pass the HOST opens, the post chain's, which read them. Asked at
   * the call and used at once: never kept, never finished, never submitted,
   * and a pass begun in it is ended before the call returns.
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
   * map's, a probe's or any other render target's, none of which raises one.
   */
  onDrawPhase(hooks: DrawPhaseHooks): { dispose(): void };
  /**
   * What `t` binds as NOW — exactly the view and sampler the host itself
   * would bind for it, a texture not yet ready included — into `out`. Read
   * every frame and compared, never kept across one: an owner may replace
   * what is behind a handle (a quality change re-creates a shadow map).
   * Allocates nothing.
   */
  bind(t: HostTexture, out: BoundTexture): void;
}
