/**
 * SceneFrame.ts — the FRAME as OURS (`BABYLON_EXIT.md` X5.4f): what Babylon's
 * `scene.render()` did for this game, done in its order by the game, so the
 * scene is never rendered. `Game.tick` calls `render` where it called
 * `scene.render()`, once a frame in every state.
 * Owns: `SceneFrame` — the frame's index (what `scene.getFrameId()` answered),
 * its six points as OBSERVABLES of its own, each named for the scene's
 * observable it replaces and raised where `Scene._renderFrame` and
 * `Scene._renderForCamera` raised that one (Babylon 9.28, `scene.pure.js`
 * 4492-4612 and 4055-4198), and the `FrameHost` our renderer is handed
 * (`host`): the draw phase this frame tells, the scene's camera matrix and
 * clear colour, the game's own device (`main.ts`, `BABYLON_EXIT.md` X5.4h),
 * and the encoder and the end of frame of the game's own loop
 * (`core/FrameLoop.ts`, X5.4g); the
 * particle fields' ANIMATION RATIO (`animationRatio`, what
 * `scene.getAnimationRatio()` answered); and two of the frame profiler's
 * spans, `drawWorld` and `glow`, bracketed here (`timeWith`).
 * Invariants:
 * - **The order is Babylon's, point for point, read off its source and the
 *   frame's logs** (`plans/webgpu-ref/post.mjs`, `readers.mjs`), and only the
 *   steps that did anything in this game are kept (the list below): the frame
 *   id; the scene's animations — `Scene.animate`'s arithmetic PORTED since
 *   X5.4g (`animationRatio`: the loop's delta, `FrameClock.getDeltaTime()`,
 *   clamped to `Scene.MinDeltaTime`..`MaxDeltaTime` and scaled by 60/1000, or
 *   16 ms under `scene.useConstantAnimationDeltaTime`, its non-lock-step
 *   branch — the engine is never deterministic-lock-step here), the ratio the
 *   particle fields' clock reads (`ParticleDraw`), because the delta
 *   `scene.animate()` read was Babylon's `getDeltaTime()`, which only Babylon's
 *   own frame sampled; the active camera's update (`camera.update()`, public
 *   API); `onBeforeRenderObservable`; `onBeforeRenderTargetsRenderObservable`
 *   (the frame's); the render id's FIRST advance, under
 *   `scene.renderTargetsEnabled`, where `_renderFrame` moved Babylon's after
 *   its custom render targets' block; then the camera's render: the render
 *   id's SECOND advance, `scene.updateTransformMatrix()` (public API: the view,
 *   the projection, the scene's transform matrix and its frustum, computed
 *   exactly as Babylon computed them, because it is Babylon's own call), the
 *   EVALUATION (`RenderId.evaluated`, where `onAfterActiveMeshesEvaluation`
 *   settled the viewmodel's render cache), `onBeforeRenderTargetsRenderObservable`
 *   again (the camera's: raised TWICE a frame, as Babylon raised it), the draw
 *   phase (`onBeforeDrawPhaseObservable`, then `onAfterDrawPhaseObservable`),
 *   `onAfterCameraRenderObservable` (the post chain), and last
 *   `onAfterRenderObservable` (the frame is drawn) — and then the CANVAS's
 *   pass if nothing this frame began one (`render/ChainPasses.ts`
 *   `finishFrame`), where `_renderFrame`'s closing `restoreDefaultFramebuffer`
 *   began Babylon's main pass on a frame no stage of the chain had drawn into.
 * - **The render id moves at exactly the two points Babylon's did, and
 *   nowhere else** (`core/renderId.ts`, X5.4a's log; X5.4b's counter, advanced
 *   off the scene's observables until this step), and the evaluation is told
 *   between the second advance and the camera's render targets, so the
 *   viewmodel's readers answer as Babylon's did, bit for bit.
 * - **An observable here is BABYLON's `Observable`**, so an observer added,
 *   removed, inserted first or called once behaves exactly as it did on the
 *   scene's (the harness's frame adapter and every probe rest on that), and
 *   each module hangs on the point here in the order it hung on the scene's.
 * - **`drawWorld` and `glow` are bracketed HERE** (X5.4g; `FrameProfile
 *   .hookRender` hung them off these points until then): `drawWorld` opens
 *   once the draw phase's opening is told (after our renderer's `begin`,
 *   which is not in it) and closes where the glow's work opens — told by the
 *   glow's own two notifications (`GlowSpans`) — or after the draw phase's
 *   close on a frame the glow does no work; `glow` is that work. The spans are
 *   the profiler's (`FrameSpans`), whose every entry point returns on its
 *   first line while it is disarmed.
 * - What `scene.render()` did and this does NOT, each because nothing in a
 *   round of this game reached it (measured at X5.4f's parent: no observer,
 *   no stage, no target, no mesh): `scene.animate()` itself since X5.4g, its
 *   ratio ported above — `_animate` steps no `Animatable` (none exists) and
 *   nothing observes `onAfterAnimationsObservable`, physics being off; the readiness check `_renderFrame` opened
 *   with (`executeWhenReady`'s own timer still runs), the transient
 *   components, the per-frame counters (`SceneInstrumentation`'s, which the
 *   profiler reads and which therefore stop moving: an instrument's change,
 *   retired with them at X5.4g), the cached material, the action manager, the
 *   component stages, rig cameras, the custom render targets, the camera's
 *   viewport on the engine and every bind and clear of Babylon's (the scene
 *   clears nothing: `autoClear` and `autoClearDepthAndStencil` are false and
 *   no target is bound), the active-mesh walk (`WorldCulling` hands it no
 *   candidates since this step: no Babylon mesh is drawn), particle systems
 *   (none is Babylon's), the rendering manager (Babylon draws nothing), the
 *   post-process manager (no Babylon `PostProcess`), the pointer pick,
 *   intersections and the dispose queue.
 * Never: draws, binds or clears (every pass is our renderer's); reads a clock
 * of its own or draws a random number (the delta is the loop's
 * `FrameClock`'s, the spans' clock the profiler's);
 * advances the render id anywhere but the two points; allocates on a frame.
 * Contract: `docs/game.md` ("What a frame owes") and `docs/rendering.md`
 * ("Our renderer's frame").
 */
import { Observable, Scene } from "@babylonjs/core";
import type { DrawPhaseHooks, FrameHost } from "../render/frameHost";
import type { FrameLoop } from "./FrameLoop";
import { P } from "./profilePhases";
import type { RenderId } from "./renderId";

/**
 * What the frame's two spans are told to: the frame profiler, structural, so
 * this file imports no profiler (`FrameProfile` satisfies it).
 */
export interface FrameSpans {
  begin(slot: number): void;
  endAdd(slot: number): void;
}

/**
 * The glow's two notifications around its work (the mask and its blur, at
 * the draw phase's end): structural, so this file imports no pass —
 * `GlowPass` satisfies it.
 */
export interface GlowSpans {
  readonly onBeforeWorkObservable: Observable<void>;
  readonly onAfterWorkObservable: Observable<void>;
}

export class SceneFrame {
  /** The frame's index: what `scene.getFrameId()` answered, moved once a `render`. */
  index = 0;
  /** After the camera's update, before any matrix of the frame is computed: `Scene.onBeforeRenderObservable`'s point. */
  readonly onBeforeRenderObservable = new Observable<void>();
  /** Twice a frame, the frame's then the camera's: `Scene.onBeforeRenderTargetsRenderObservable`'s points. */
  readonly onBeforeRenderTargetsRenderObservable = new Observable<void>();
  /** The camera's draw phase opening: `Scene.onBeforeDrawPhaseObservable`'s point. */
  readonly onBeforeDrawPhaseObservable = new Observable<void>();
  /** The camera's draw phase closing: `Scene.onAfterDrawPhaseObservable`'s point. */
  readonly onAfterDrawPhaseObservable = new Observable<void>();
  /** The camera's render done: `Scene.onAfterCameraRenderObservable`'s point (the post chain). */
  readonly onAfterCameraRenderObservable = new Observable<void>();
  /** The frame drawn: `Scene.onAfterRenderObservable`'s point. */
  readonly onAfterRenderObservable = new Observable<void>();
  /** Our renderer's host: the draw phase told here, the matrix and the clear colour the scene's, the device and the encoder the game's. */
  readonly host: FrameHost;
  /**
   * The particle fields' clock this frame — what `scene.getAnimationRatio()`
   * answered, `Scene.animate`'s arithmetic over the loop's delta (the
   * header) — 1 until the first frame sets it, as Babylon's getter answered.
   */
  animationRatio = 1;
  /** What `render` calls last: the canvas's pass, if this frame began none (`ChainPasses.finishFrame`). */
  private finish: (() => void) | null = null;
  /** The profiler, told `drawWorld` and `glow` (`timeWith`); null until `Game` sets it. */
  private spans: FrameSpans | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly ids: RenderId,
    /** The game's device (`main.ts`). */
    device: GPUDevice,
    private readonly loop: FrameLoop,
  ) {
    const frame = this;
    const ends = loop.onEndFrameObservable;
    this.host = {
      device,
      // The loop's encoder (`FrameSubmit`), asked at the call.
      prepareEncoder: () => loop.submit.encoder,
      // The loop's end of frame: told after its one submit.
      afterSubmit: (run) => {
        const o = ends.add(run);
        return { dispose: () => ends.remove(o) };
      },
      // The scene's transform matrix, public API: what `updateTransformMatrix`
      // computed this frame, read inside the draw phase.
      viewProjection: (out) => out.set(scene.getTransformMatrix().m),
      // The scene's clear colour, public API: the value Babylon's own clears read.
      clearColor: (out) => {
        const c = scene.clearColor;
        out.r = c.r;
        out.g = c.g;
        out.b = c.b;
        out.a = c.a;
      },
      onDrawPhase: (hooks: DrawPhaseHooks) => {
        // `begin` in order; `end` inserted FIRST, ahead of the glow's mask,
        // which is told from the same point — as the seam inserted it on the
        // scene's observable until this step.
        const before = frame.onBeforeDrawPhaseObservable.add(() => hooks.begin());
        const after = frame.onAfterDrawPhaseObservable.add(() => hooks.end(), undefined, true);
        return {
          dispose: () => {
            frame.onBeforeDrawPhaseObservable.remove(before);
            frame.onAfterDrawPhaseObservable.remove(after);
          },
        };
      },
    };
  }

  /** What the frame calls last (`ChainPasses.finishFrame`): set once, by `Game`. */
  finishWith(fn: () => void): void {
    this.finish = fn;
  }

  /**
   * The spans this frame brackets (the header): `drawWorld` here in `render`,
   * and the glow's work off its two notifications. Set once, by `Game`,
   * whether the profiler is armed or not.
   */
  timeWith(spans: FrameSpans, glow: GlowSpans): void {
    this.spans = spans;
    glow.onBeforeWorkObservable.add(() => {
      spans.endAdd(P.drawWorld);
      spans.begin(P.glow);
    });
    glow.onAfterWorkObservable.add(() => spans.endAdd(P.glow));
  }

  /** The frame, in `scene.render()`'s order (the header). */
  render(): void {
    const scene = this.scene;
    this.index++;
    // `_renderFrame`'s animations, `Scene.animate`'s non-lock-step branch:
    // the animation ratio (the particle fields' clock) off the loop's delta.
    const delta = scene.useConstantAnimationDeltaTime
      ? 16
      : Math.max(Scene.MinDeltaTime, Math.min(this.loop.clock.getDeltaTime(), Scene.MaxDeltaTime));
    this.animationRatio = delta * (60.0 / 1000.0);
    const camera = scene.activeCamera;
    // `_renderFrame`'s camera update (no rig cameras, no `activeCameras`).
    if (camera) camera.update();
    this.onBeforeRenderObservable.notifyObservers();
    this.onBeforeRenderTargetsRenderObservable.notifyObservers();
    // `_renderFrame`'s advance, after its (empty) custom render targets.
    if (scene.renderTargetsEnabled) this.ids.advance();
    if (!camera) throw new Error("No camera defined");
    // The camera's render (`_renderForCamera`): its advance, its matrices,
    // its evaluation, its render targets' point, its draw phase, its end.
    this.ids.advance();
    scene.updateTransformMatrix();
    this.ids.evaluated();
    this.onBeforeRenderTargetsRenderObservable.notifyObservers();
    this.onBeforeDrawPhaseObservable.notifyObservers();
    this.spans?.begin(P.drawWorld);
    this.onAfterDrawPhaseObservable.notifyObservers();
    // Closed by the glow's work if it ran (`timeWith`); an `endAdd` on a span
    // already closed returns on its first test.
    this.spans?.endAdd(P.drawWorld);
    this.onAfterCameraRenderObservable.notifyObservers();
    this.onAfterRenderObservable.notifyObservers();
    // `_renderFrame`'s closing `restoreDefaultFramebuffer`: the canvas's pass,
    // begun if nothing began it this frame.
    this.finish?.();
  }
}
