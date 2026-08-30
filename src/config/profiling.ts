/**
 * config/profiling.ts — the frame profiler's numbers.
 * Owns: how much of the recent past the ring holds, what counts as a hitch,
 * and how hard the clock is probed on arming.
 * Invariants: none of this decides anything about the game. `FrameProfile` is
 * the only reader, and it MEASURES and never decides — the rule
 * `world/buildProfile.ts` states for the build's timer, restated here for the
 * frame's.
 *
 * Why these are tunables at all, when `HUD`'s `FPS_INTERVAL` deliberately is
 * not: that one is a fact about eyes and belongs beside the readout it paces.
 * These are a memory budget and a threshold — the two things somebody chasing
 * a hitch on a specific device will actually want to move.
 */

export const profiling = {
  /**
   * How many frames the ring holds, and therefore how far back a capture can
   * reach.
   *
   * **This is the whole design in one number.** You cannot watch a graph while
   * playing a first-person shooter with two thumbs, so the profiler records
   * CONTINUOUSLY and the capture gesture reaches BACKWARDS: you feel the
   * hitch, then press the button. 3,000 frames is 50 s at 60 Hz, 25 s at 120
   * and 12.5 s at 240 — long enough that a hitch is never missed by a slow
   * thumb, on every rate this game runs at.
   *
   * The cost is `frames * PHASES * 8 bytes` for the two span arrays plus the
   * per-frame context, which at 3,000 x 26 is about 1.3 MB. Allocated once on
   * arming and never resized — see `FrameProfile` on why nothing here may
   * allocate while it is recording.
   */
  frames: 3000,

  /**
   * What a capture's `hitches` list is a list OF, in milliseconds.
   *
   * 24 ms is one missed 60 Hz deadline with a little room: a frame that misses
   * vsync does not take 18 ms, it waits for the next interval and takes 33
   * (`FINDINGS.md` §1). Anything at or over this is a frame the player felt,
   * on any panel this game is playable on.
   */
  hitchMs: 24,

  /**
   * How many hitch frames a capture carries the full phase breakdown for,
   * worst first.
   *
   * The report is meant to survive a trip through a phone's clipboard, so the
   * per-frame detail is bounded and the rest of the window is summarised. The
   * complete series is still in the DOWNLOAD, which has no such limit.
   */
  hitchesKept: 24,

  /**
   * How many `performance.now()` reads the clock-grain probe takes on arming.
   *
   * **The probe is not optional and its answer belongs in every capture.**
   * Chrome coarsens `performance.now()` to 100 us unless the page is
   * cross-origin isolated, and this one is not (`docker/default.conf.template`
   * sets no COOP/COEP) — while most of the phases below `render` cost under
   * 120 us on real hardware (`FINDINGS.md` §18). So a single frame's reading
   * of a small phase is one or two grains and nothing in between, and only the
   * MEAN over many frames converges. A report that did not say which grain it
   * was taken at would be a table of plausible numbers meaning nothing.
   *
   * 20,000 reads is a couple of milliseconds and reliably finds the floor.
   */
  grainSamples: 20000,

  /**
   * How many `begin`/`end` pairs the overhead probe times on arming.
   *
   * Recorded into the capture for the reason the grain is: an instrument that
   * does not state its own cost is one nobody can subtract. See `FINDINGS.md`
   * §31 on the instrument that had been dead since the WebGPU port.
   */
  overheadSamples: 20000,
} as const;
