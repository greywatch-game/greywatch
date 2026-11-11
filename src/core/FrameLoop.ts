/**
 * FrameLoop.ts — the game's RENDER LOOP and its clock (`BABYLON_EXIT.md`
 * X5.4g): what Babylon's engine ran for it until then — `runRenderLoop`, the
 * animation-frame request, `beginFrame`, `endFrame` and its submit,
 * `getDeltaTime` and `getFps` — done by the game, in Babylon's order.
 * Owns: `FrameLoop` — the `requestAnimationFrame` chain, `FrameCap` asked of
 * every refresh (its ADMITTER, no longer a requester Babylon calls), the
 * frame's begin and end as OBSERVABLES of its own, each named for the
 * engine's it replaces (`onBeginFrameObservable`, `onEndFrameObservable`),
 * the frame's id (what `engine.frameId` was: moved once a frame, after its
 * submit, as `endFrame` moved Babylon's), the frame's ONE encoder and ONE
 * submit (`render/FrameSubmit.ts`), and the profiler's `present`, the span
 * around that submit; and `FrameClock`, the frame's delta and its frame rate.
 * Invariants:
 * - **The order is `AbstractEngine._renderLoop`'s**, read off Babylon 9.28
 *   (`abstractEngine.pure.js` 433-501, `webgpuEngine.pure.js` 2326-2393): a
 *   refresh refused by the cap requests the next and runs nothing; an admitted
 *   one samples the clock (`_measureFps`, `beginFrame`'s first line), raises
 *   the begin, runs the frame (`Game.tick`), then the end — the submit, the
 *   frame id moved, the end raised — and only THEN requests the next refresh,
 *   so a frame that throws stops the loop exactly as Babylon's did (nothing
 *   here catches: a throw from `tick` or from an end-of-frame observer, such
 *   as `GiCompute`'s armed-and-unrecorded DEV throw, is the loud failure it
 *   was).
 * - **The clock is Babylon's `PerformanceMonitor` PORTED** (`FrameClock`,
 *   `Misc/performanceMonitor.js` and `_measureFps`): a rolling window of the
 *   last 30 gaps between samples, `performance.now()` read at each, the
 *   delta the newest gap and the rate 1000 over the window's mean — so the
 *   readout and the profiler's real delta read what Babylon's `getDeltaTime`
 *   and `getFps` did. **It is sampled where Babylon's monitor was**: at every
 *   frame's begin, and at every `beginFrame` Babylon's engine still runs of
 *   its own — since this step only the one inside a resize
 *   (`_initializeMainAttachments`, flushing and clearing its own depth:
 *   `initAsync`'s at the boot and every resize's after), which the boot tells
 *   it from the engine's `onBeginFrameObservable`, hooked before
 *   `initAsync` (`main.ts`), until `BABYLON_EXIT.md` X5.4h retires the engine.
 * - **A lost device holds the loop** (`held`), as `_contextWasLost` held
 *   Babylon's — no frame and no ask of the cap while the engine restores.
 * - The world is NOT stepped by this clock: `Game.tick` steps it by
 *   `FrameCap.elapsed`, the refresh stamps (`FrameCap`'s header); this delta
 *   is what the readout, the profiler and the particle fields' animation
 *   ratio read (`SceneFrame.animationRatio`, `Scene.animate`'s arithmetic).
 * Never: allocates on a frame (the profiler's rule); runs a frame inside
 * `start`; requests a second refresh while one is pending.
 * Contract: `docs/game.md` ("What a frame owes"), `docs/profiling.md`
 * ("`present`, and the three roots").
 */
import { Observable } from "@babylonjs/core";
import { FrameSubmit } from "../render/FrameSubmit";
import type { FrameCap } from "./FrameCap";

/**
 * Babylon's `RollingAverage` over a `PerformanceMonitor`'s window, and
 * `WebGPUEngine._measureFps` over it: the same arithmetic in the same order,
 * every value a double, so a sample answers what Babylon's did.
 */
export class FrameClock {
  /** `PerformanceMonitor`'s default window. */
  private static readonly WINDOW = 30;
  private readonly samples = new Float64Array(FrameClock.WINDOW);
  private average = 0;
  private count = 0;
  private pos = 0;
  /** The last sample's `performance.now()`, or -1 before the first (`_lastFrameTimeMs`'s null). */
  private last = -1;
  /** What `getFps` answers: Babylon's `_fps`, 60 until a sample sets it. */
  private fps = 60;
  /** What `getDeltaTime` answers: Babylon's `_deltaTime`, 0 until a sample sets it. */
  private delta = 0;

  /**
   * A sample at `performance.now()`: `sampleFrame`, then `_measureFps`'s two
   * stores (`averageFPS`, `instantaneousFrameTime || 0`).
   */
  sample(): void {
    const now = performance.now();
    if (this.last >= 0) this.add(now - this.last);
    this.last = now;
    this.fps = 1000 / this.average;
    this.delta = this.newest() || 0;
  }

  /** Milliseconds since the sample before the last: Babylon's `getDeltaTime()`. */
  getDeltaTime(): number {
    return this.delta;
  }

  /** Frames a second over the window: Babylon's `getFps()`. */
  getFps(): number {
    return this.fps;
  }

  /**
   * `RollingAverage.add`, as written — but for its variance (`_m2`), which
   * nothing here reads and which never feeds the mean.
   */
  private add(v: number): void {
    const n = this.samples.length;
    let d: number;
    if (this.count >= n) {
      d = this.samples[this.pos] - this.average;
      this.average -= d / (this.count - 1);
    } else {
      this.count++;
    }
    d = v - this.average;
    this.average += d / this.count;
    this.samples[this.pos] = v;
    this.pos++;
    this.pos %= n;
  }

  /** `RollingAverage.history(0)`: the newest sample, 0 before any. */
  private newest(): number {
    const n = this.samples.length;
    if (this.count === 0) return 0;
    const i0 = (((this.pos - 1) % n) + n) % n;
    return this.samples[i0];
  }
}

/** What the loop tells the profiler: the end of its `present` span, the submit having returned. */
export interface PresentSpan {
  presented(): void;
}

export class FrameLoop {
  /** A frame opening, after the clock's sample and before `tick`: `engine.onBeginFrameObservable`'s point. */
  readonly onBeginFrameObservable = new Observable<void>();
  /** A frame's commands submitted and its id moved: `engine.onEndFrameObservable`'s point. */
  readonly onEndFrameObservable = new Observable<void>();
  /** Frames submitted: what `engine.frameId` answered, moved at each end. */
  frameId = 0;
  /**
   * True while the graphics device is LOST and its engine restoring it, when
   * an admitted refresh runs nothing: Babylon's `_processFrame` tested
   * `_contextWasLost` first, ahead of its cap. Written by `Game` from the
   * engine's two context observables until `BABYLON_EXIT.md` X5.4i decides
   * what a loss is.
   */
  held = false;
  /** The frame's encoder and its submit. */
  readonly submit: FrameSubmit;
  private frame: (() => void) | null = null;
  /** The browser's handle for the refresh being waited on, 0 for none. */
  private handle = 0;

  constructor(
    private readonly cap: FrameCap,
    device: GPUDevice,
    private readonly present: PresentSpan,
    /** The frame's clock, made by the boot and sampled at the engine's own begin-frames too (`main.ts`). */
    readonly clock: FrameClock,
    /** Whether the frame's GPU time is measured (`?gpu`). */
    timeFrame: boolean,
  ) {
    this.submit = new FrameSubmit(device, timeFrame);
  }

  /**
   * Runs `frame` once an admitted refresh, from the next one on — as
   * `runRenderLoop` queued its first frame rather than running it. Once.
   */
  start(frame: () => void): void {
    if (this.frame) return;
    this.frame = frame;
    this.handle = window.requestAnimationFrame(this.step);
  }

  private readonly step = (t: number): void => {
    this.handle = 0;
    if (!this.held && this.cap.admit(t)) {
      // `beginFrame`: the clock's sample (`_measureFps`), then its observable.
      this.clock.sample();
      this.onBeginFrameObservable.notifyObservers();
      this.frame!();
      // `endFrame`: the submit (`flushFramebuffer`'s), `present` closed
      // around it, the frame id moved, the end raised.
      this.submit.submit();
      this.present.presented();
      this.frameId++;
      this.onEndFrameObservable.notifyObservers();
    }
    // Only now, as `_renderLoop` queued its next frame after `_processFrame`:
    // a frame that threw above has requested nothing.
    if (this.handle === 0) this.handle = window.requestAnimationFrame(this.step);
  };
}
