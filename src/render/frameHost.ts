/**
 * render/frameHost.ts — What our renderer needs from whoever owns the frame,
 * stated as an interface so the owner can change without the renderer
 * noticing.
 * Owns: `FrameHost`, `PassTargets`, `MainPassHooks`, `HostTexture` and
 * `BoundTexture`.
 * Invariants: everything a `FrameHost` hands over is WebGPU's or plain data —
 * a device, a pass encoder, a command encoder, a texture view and a sampler,
 * formats, floats; a draw reaches the pass through `queue` and nothing else,
 * in the host's own order — in the main pass, or in the glow's mask when
 * that pass's owner says it opened; work owed ahead of the draws reaches the GPU
 * through `prepareEncoder` and nothing else — recorded there, never kept,
 * finished or submitted by the renderer; a texture the host owns is handed over as ITS view, read where it
 * lies and never copied (`BABYLON_EXIT.md` rule 5).
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
 * The four points of the frame's main pass a renderer is told of, in the
 * order they come: `begin` as the pass starts, then — in every frame rendering
 * group `groupId` is drawn, whatever it holds — `beforeAlphaTest`,
 * `afterOpaque` and `afterGroup`, once each.
 */
export interface MainPassHooks {
  /** Once, as the main pass's drawing starts. */
  begin(): void;
  /**
   * Once, after rendering group `groupId`'s OPAQUE meshes have been queued
   * and before its ALPHA-TESTED meshes are. In a frame whose group has no
   * alpha-tested mesh to draw, immediately before `afterOpaque` instead — so
   * it always comes before that hook, and nothing of the group's is queued
   * between the two.
   */
  beforeAlphaTest(): void;
  /**
   * Once, after rendering group `groupId`'s OPAQUE and alpha-tested meshes
   * have been queued and before anything blended in it is — its sprites, its
   * particles and its transparent meshes.
   */
  afterOpaque(): void;
  /** Once, after rendering group `groupId` has been queued whole. */
  afterGroup(): void;
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
   * the main pass at one of its hooks (`onMainPass`), or the glow's mask,
   * which its owner announces as it opens (`Renderer.glowMaskOpened`).
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
   * either as the frame's. Asked as the main pass begins and used at once:
   * never kept, never finished, never submitted, and a pass begun in it is
   * ended before the call returns.
   */
  prepareEncoder(): GPUCommandEncoder;
  /** The view-projection the frame's camera is drawn with, as 16 floats. */
  viewProjection(out: Float32Array): void;
  /**
   * Hooks the frame's MAIN pass — never a shadow map's, a probe's or any other
   * render target's — at the points of `MainPassHooks`, for rendering group
   * `groupId`.
   */
  onMainPass(groupId: number, hooks: MainPassHooks): { dispose(): void };
  /**
   * What `t` binds as NOW — exactly the view and sampler the host itself
   * would bind for it, a texture not yet ready included — into `out`. Read
   * every frame and compared, never kept across one: an owner may replace
   * what is behind a handle (a quality change re-creates a shadow map).
   * Allocates nothing.
   */
  bind(t: HostTexture, out: BoundTexture): void;
}
