/**
 * PostPasses.ts — The Babylon-side PASS OWNER of the post chain
 * (`BABYLON_EXIT.md` X5.2c1, shape (A)): it opens, with Babylon's public API,
 * every pass a stage of OUR renderer draws in (`render/PostChain.ts`), in
 * Babylon's frame, into targets Babylon owns — and while a stage of ours is
 * active it takes Babylon's PREFIX of the chain off the canvas and onto a
 * target of its own, so the prefix's last pass writes what our first stage
 * reads.
 * Owns: `PostPasses` — the prefix's output (a `RenderTargetTexture`, made as
 * Babylon makes a post-process's input: `rgba8unorm`, no depth, NEAREST, no
 * mips, the render size), the pool our stages hand on through (made the same
 * way, one target a pass POSITION, grown when a stage of ours follows
 * another: X5.2c2), the window `camera.
 * outputRenderTarget` is set across, and the order the chain's passes are
 * opened in.
 * Invariants: with NO stage of ours active nothing here touches the frame —
 * `outputRenderTarget` stays null and Babylon's prefix writes the canvas
 * exactly as before X5.2c1, with no interim copy pass; with one active,
 * `outputRenderTarget` is set ONLY from the end of the camera's draw phase to
 * the end of its render (`onAfterDrawPhaseObservable`, added after the glow's
 * and the frame depth's, to `onAfterCameraRenderObservable`), because Babylon
 * reads it all through a frame and only `_finalizeFrame`'s read is the
 * prefix's output: as `Scene.render` resets the target's `_cleared` (the
 * colour clear's gate) and then binds the frame's first target and clears the
 * canvas's depth (it would bind this target instead and skip that clear — the
 * empty canvas pass the frame OPENS with, X5.2a), as it hands the camera's
 * render its bind flag, as the camera's render picks its render pass id
 * (which keys every Babylon draw's wrapper, an editor build's meshes among
 * them), in that render's and two materials' MULTIVIEW tests, and as
 * `PostProcessManager._finalizeFrame` binds its last pass's target — every
 * read but the last outside the window, and the multiview ones inert on a
 * one-view target anyway (`BABYLON_EXIT.md`, "What it is today"); the
 * prefix's output is CLEARED to the scene's clear colour at the open of the
 * pass that writes it, as Babylon's `PostProcess.activate`
 * clears a pass's input — from inside the prefix's last pass's `apply`
 * (`onApplyObservable`, after its own observers, before its draw), or, on a
 * frame that pass draws nothing (its effect not ready), as a pass of its own
 * where that one stood (a DEV build THROWS if that pass is ready, which is a
 * tail `Game` named wrongly, not one that drew nothing) — so what our first
 * stage reads on any frame is what the grade read as Babylon's last pass; a
 * target is named for the stage that READS it, as Babylon names a
 * post-process's input (`PostProcessRTT-<label>`);
 * a pool target is bound (the whole target as the viewport) and cleared to
 * the scene's colour as `activate` bound and cleared the input of a READER
 * at Babylon's defaults, which every stage of ours was (X5.2c2: a stage
 * declares no `autoClear`, `alphaMode`, `clearColor` or viewport of its own);
 * the canvas is opened with `restoreDefaultFramebuffer`, exactly as
 * `_finalizeFrame` opened it for Babylon's last pass, so the canvas's pass is
 * Babylon's main pass with the engine's depth; every target follows the
 * render size, resized before the prefix binds it.
 * Never: reaches a Babylon internal (public API only: no seam item, rule 4);
 * draws — our renderer does, queued from inside the pass this opened
 * (`Renderer.postStageOpened`); holds a slot or an index in the camera's list;
 * opens a pass while no stage of ours is active.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 */
import {
  type Camera,
  Constants,
  type Effect,
  type Observer,
  type PostProcess,
  RenderTargetTexture,
  type Scene,
} from "@babylonjs/core";
import type { HostTexture } from "../render/frameHost";
import type { PostChain, PostPassOwner, PostStage } from "../render/PostChain";
import { hostTexture } from "../render/babylonSeam";

export class PostPasses implements PostPassOwner {
  private output: RenderTargetTexture | null = null;
  /** The pool, one target a pass POSITION (`PostPassOwner.openPool`), grown on first use. */
  private readonly pool: RenderTargetTexture[] = [];
  /** Whether `outputRenderTarget` is set this frame. */
  private open = false;
  /** Whether the prefix's output was cleared in its pass this frame. */
  private cleared = false;
  /** The prefix's last pass the clear is hung on, and its observer — moved only when the tail does. */
  private tail: PostProcess | null = null;
  private tailObserver: Observer<Effect> | null = null;
  private outputHandle: HostTexture | null = null;
  width = 0;
  height = 0;

  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
    private readonly chain: PostChain,
    /**
     * The prefix's LAST live pass this frame — the one whose target is this
     * owner's output. `Game` assembled the prefix and knows its order
     * (`Game.postPrefixTail`).
     */
    private readonly prefixTail: () => PostProcess,
  ) {
    // After the glow's and the frame depth's observers (both built first),
    // so nothing they render is drawn while the output is set.
    scene.onAfterDrawPhaseObservable.add(() => this.openWindow());
    scene.onAfterCameraRenderObservable.add(() => this.closeWindow());
  }

  get prefixOutput(): HostTexture {
    return this.outputHandle!;
  }

  /** The prefix's output as Babylon holds it, or null before a stage of ours first drew — for the probe's adapter (`plans/webgpu-ref/post.mjs`). */
  get prefixTarget(): RenderTargetTexture | null {
    return this.output;
  }

  /** Pool target `slot`, or null before a pass first used it — for the probe's adapter, as `prefixTarget`. */
  poolTarget(slot: number): RenderTargetTexture | null {
    return this.pool[slot] ?? null;
  }

  /** Points the prefix at this owner's output, if a stage of ours draws this frame. */
  private openWindow(): void {
    if (this.scene.activeCamera !== this.camera || !this.chain.active()) return;
    const engine = this.scene.getEngine();
    // Babylon sizes a post-process's input as `getRenderWidth(true) * 1 | 0`.
    this.width = engine.getRenderWidth(true) | 0;
    this.height = engine.getRenderHeight(true) | 0;
    this.output = this.target(this.output, "output");
    this.outputHandle = hostTexture(this.output);
    this.label(this.output, this.firstActive());
    this.camera.outputRenderTarget = this.output;
    this.open = true;
    this.cleared = false;
    // The clear Babylon's `activate` gave the grade's input, in the same
    // pass: inside the prefix's last `apply`, after its own observers and
    // before its draw, so the pass the bind left pending opens cleared.
    // Hung once on whichever pass is the tail, and moved when a setting
    // moves the tail, so a frame adds no observer.
    const tail = this.prefixTail();
    if (tail !== this.tail) {
      if (this.tail && this.tailObserver) this.tail.onApplyObservable.remove(this.tailObserver);
      this.tail = tail;
      this.tailObserver = tail.onApplyObservable.add(this.clearInPass);
    }
  }

  /**
   * On the tail's `apply`: only while the window is open is the pass it is
   * about to draw in this owner's output — with no stage of ours active the
   * tail draws into the canvas, which this never clears.
   */
  private readonly clearInPass = (): void => {
    if (!this.open || this.cleared) return;
    this.clear();
  };

  /** After the prefix: the canvas (and any pool) passes of ours, then the output put back. */
  private closeWindow(): void {
    if (!this.open) return;
    this.open = false;
    this.camera.outputRenderTarget = null;
    // The prefix's last pass drew nothing (its effect not ready): Babylon's
    // `activate` would still have cleared the target in a pass of its own,
    // and the target is still bound, with nothing begun on it.
    if (!this.cleared) {
      // ...or `Game.postPrefixTail` named a pass that is not the prefix's
      // last, which this cannot tell from that: the real last pass drew, and
      // this clear would land after it and grade a clear colour, silently.
      // Babylon's `apply` returns nothing exactly while `!isReady()`, and
      // no readiness changes inside a frame, so a READY tail that never
      // applied is the wrong one — thrown in a DEV build, as `GiCompute`
      // throws a dispatch nobody recorded; production keeps the clear.
      if (import.meta.env.DEV && this.tail?.isReady()) {
        throw new Error(
          `post: the prefix's tail "${this.tail.name}" is ready and never applied this frame — Game.postPrefixTail does not name the prefix's last pass, and the fallback clear would wipe the grade's input`,
        );
      }
      this.clear();
    }
    this.chain.record(this);
  }

  /** The bound target cleared as Babylon's `activate` clears a pass's input: colour to the scene's, depth and stencil asked too. */
  private clear(): void {
    this.cleared = true;
    // `scene._allowPostProcessClearColor` is the second argument there; it
    // is true unless something sets it, and nothing here does.
    this.scene.getEngine().clear(this.scene.clearColor, true, true, true);
  }

  openCanvas(): void {
    // As `_finalizeFrame` opened it for Babylon's last pass: the engine's
    // main pass, its colour and depth loaded, begun when ours first draws.
    this.scene.getEngine().restoreDefaultFramebuffer();
  }

  openPool(slot: number, reader: PostStage): HostTexture {
    const t = this.target(this.pool[slot] ?? null, `pool ${slot}`);
    this.pool[slot] = t;
    this.label(t, reader);
    // Bound and cleared as Babylon's `activate` bound and cleared the input
    // of a post-process at its DEFAULTS, which every stage of ours was as
    // Babylon's (`plans/webgpu-ref/post.mjs` read each one's fields:
    // `forceFullscreenViewport` true, `enablePixelPerfectMode` false,
    // `autoClear` true, `alphaMode` 0, no `clearColor` of its own) — so the
    // whole target as the viewport whatever the camera's, and a clear to the
    // scene's colour, depth and stencil asked too. A stage declares none of
    // the three: one that needs another owes `PostStage` the field.
    const engine = this.scene.getEngine();
    engine.bindFramebuffer(t.renderTarget!, 0, undefined, undefined, true);
    engine.clear(this.scene.clearColor, true, true, true);
    return hostTexture(t);
  }

  /** `t` at the render size: made on first use, resized when the render size moved. */
  private target(t: RenderTargetTexture | null, name: string): RenderTargetTexture {
    if (!t) {
      return new RenderTargetTexture(`postChain ${name}`, { width: this.width, height: this.height }, this.scene, {
        generateMipMaps: false,
        generateDepthBuffer: false,
        generateStencilBuffer: false,
        type: Constants.TEXTURETYPE_UNSIGNED_BYTE,
        format: Constants.TEXTUREFORMAT_RGBA,
        samplingMode: Constants.TEXTURE_NEAREST_SAMPLINGMODE,
      });
    }
    const size = t.getSize();
    if (size.width !== this.width || size.height !== this.height) t.resize({ width: this.width, height: this.height });
    return t;
  }

  /** Names `t` for the stage that reads it, as Babylon names a post-process's input. */
  private label(t: RenderTargetTexture, reader: PostStage): void {
    const rt = t.renderTarget;
    const want = `PostProcessRTT-${reader.label}`;
    if (rt && rt.label !== want) rt.label = want;
  }

  private firstActive(): PostStage {
    return this.chain.firstActive()!;
  }
}
