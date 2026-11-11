/**
 * FrameCap.ts — the ceiling on how often a frame is drawn: the player's frame
 * rate cap (`Settings.fpsCap`).
 * Owns: the ADMITTER our frame loop asks of every display refresh
 * (`core/FrameLoop.ts`, `BABYLON_EXIT.md` X5.4g; Babylon's render loop asked it
 * through `engine.customAnimationFrameRequester` until then) — the decision
 * whether a refresh is given a frame at all — and the simulation's clock: how
 * much time a frame steps the world by (`elapsed`).
 * Invariants: a refused refresh runs NOTHING of the frame — not the loop's
 * begin, not `Game.tick`, not the submit — so the frame that does run measures
 * its delta across the whole gap and every system sees one ordinary long
 * frame. The cap is a DEADLINE, never an accumulator. Rate 0 admits every
 * refresh, which is the loop exactly as it ran before the setting existed.
 * The world is stepped on the REFRESH clock, never on when the callback ran.
 * Never: requests a refresh (the loop does, and re-requests one it refused);
 * allocates per frame (the profiler's rule — `docs/profiling.md`).
 *
 * **Why not `engine.maxFPS`, which Babylon already has.** Read in
 * `AbstractEngine._isOverFrameTime`: it ADDS each refresh's elapsed time to an
 * accumulator and draws once that reaches `1000 / maxFPS`, carrying the
 * remainder. On a panel whose period is a hair under 16.667 ms — any "60 Hz"
 * display running at 60.02 — two refreshes sum to just under a 30 cap's
 * 33.333 ms, so the second is refused, the third is taken with a whole
 * refresh of remainder, and from then on every frame needs three: a 30 cap
 * that runs at 20. The cap is here to make pacing EVEN, so the one failure it
 * may not have is a cadence decided by a rounding error.
 *
 * A deadline does not have that failure. Each admitted frame sets the next
 * one's due time `1000 / rate` after the last due time — not after the
 * refresh that happened to take it — and a refresh is admitted once it is
 * within `CONFIG.graphics.frameCapSlackMs` of being due. The slack absorbs the
 * refresh timestamps' own jitter; scheduling off the due time is what keeps
 * the AVERAGE exactly at the cap whatever the slack is, including on a panel
 * the cap does not divide (144 Hz under a 60 cap alternates two refreshes and
 * three, and averages 60).
 *
 * **A frame late by a whole interval restarts the schedule instead of repaying
 * it**: a hitch, a hidden tab or the first frame would otherwise leave a
 * backlog of due times in the past, and the frames after it would all be
 * admitted back to back — a burst at the display's own rate, which is the
 * uneven pacing this exists to remove.
 *
 * **EVEN PACING IS HALF OF IT; THE OTHER HALF IS AN EVEN STEP.** The frame's
 * delta (`FrameClock.getDeltaTime()`, Babylon's `getDeltaTime()` ported) is
 * `performance.now()` read as the frame begins — whenever the callback
 * happened to get the main thread — so under a 30 cap every frame is SHOWN for
 * exactly two refreshes and STEPPED by 31 ms, 36, 33: the camera and the world
 * advance unevenly across a display that is not, which is judder under a
 * steady pan however even the cadence is. The timestamp a refresh hands its
 * callback is the refresh's own (the vsync's, in every engine that matters),
 * so the gap between two admitted ones is a whole number of refreshes — the
 * interval the display actually puts between the frames. `elapsed` is that,
 * and it is what `Game.tick` steps the world by. The raw delta stays what the
 * profiler and the readout read: an instrument measures when the work ran,
 * and the world moves by when it is seen.
 */
import { CONFIG } from "../config";

export class FrameCap {
  /** Milliseconds between frames at the cap, or 0 for no cap. */
  private interval = 0;
  /** When the next frame is due, on the refresh timestamps' clock. */
  private next = 0;
  /** The refresh timestamp the frame now running was admitted on, 0 before any. */
  private stamp = 0;
  /** The one the frame before it was admitted on, 0 before there were two. */
  private prevStamp = 0;

  /** Frames a second, or 0 to draw on every refresh. */
  setRate(fps: number): void {
    const interval = fps > 0 ? 1000 / fps : 0;
    if (interval === this.interval) return;
    this.interval = interval;
    // A new rate starts a new schedule; the old due time belongs to the old one.
    this.next = 0;
  }

  /**
   * Seconds between the refresh that took this frame and the one that took the
   * last — what the world should be stepped by — or `fallback` until two
   * frames have run. See the header for why this is not the frame's delta.
   */
  elapsed(fallback: number): number {
    const gap = this.stamp - this.prevStamp;
    return this.prevStamp > 0 && gap > 0 ? gap / 1000 : fallback;
  }

  /**
   * The refresh timestamp the frame now running was admitted on, on
   * `performance.now()`'s clock — the instant this frame is SEEN, which is
   * what a match's render clock is read at (`Connection.setFrame`). 0 before
   * the first frame.
   */
  get refreshAt(): number {
    return this.stamp;
  }

  /**
   * Whether the refresh stamped `t` (its `requestAnimationFrame` timestamp) is
   * given a frame. An admitted one becomes the frame's `refreshAt` and the
   * one before it the start of `elapsed`'s gap; a refused one changes nothing
   * here, and the loop asks again on the next refresh.
   */
  admit(t: number): boolean {
    if (this.interval !== 0) {
      if (t < this.next - CONFIG.graphics.frameCapSlackMs) return false;
      this.next =
        t - this.next >= this.interval ? t + this.interval : this.next + this.interval;
    }
    this.prevStamp = this.stamp;
    this.stamp = t;
    return true;
  }
}
