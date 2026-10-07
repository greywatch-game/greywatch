/**
 * frameStats.ts — the "1% low", the one frame statistic two instruments put
 * in front of a player: the HUD's frame-rate readout and a profiler capture.
 * Owns: `onePercentLow`, and with it the definition of the number. Owns no
 * window and no buffer — each caller decides what it is measuring over and
 * sorts it.
 *
 * Invariants:
 *  - **One definition, two units.** The readout hands it seconds and turns the
 *    answer into a rate; a capture hands it milliseconds and reports those. The
 *    function is unit-blind on purpose, so the two cannot drift apart by one
 *    of them changing the statistic while the other keeps the old one.
 *  - **It allocates nothing.** The readout calls it four times a second for as
 *    long as it is up, and a readout whose own garbage causes a hitch is worse
 *    than no readout. Sorting is the caller's, into a buffer the caller owns.
 *  - Imports nothing, like `math.ts`: a leaf that `ui/` and `core/` can both
 *    reach without a path between them.
 */

/**
 * The MEAN of the slowest 1% of a sample, in the sample's own units.
 *
 * `sorted` must be in ASCENDING order — `Float64Array.prototype.sort` is
 * numeric by default, so the string-ordering trap that catches `Array.sort`
 * out does not apply to the callers here. At least one value is taken, so a
 * short sample still reports its worst rather than dividing by zero; an empty
 * one reads 0.
 *
 * The mean of the worst 1%, deliberately, and not the 99th percentile — they
 * sound interchangeable and are not. A percentile is a single sample from the
 * tail, so it cannot move until a full 1% of frames are bad: over a 5 s window
 * at 120 Hz that is six frames, and a lone 100 ms stall sits at index 599 of
 * 600 where p99 reads index 594 and never sees it. Measured, that stall left a
 * p99 reading a clean 120 — a hitch you would certainly feel, reported as
 * perfect. Averaging the tail lets one bad frame pull the figure down in
 * proportion to how bad it was, which is the behaviour this number exists to
 * have.
 */
export function onePercentLow(sorted: Float64Array): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const tail = Math.max(1, Math.floor(n * 0.01));
  let sum = 0;
  for (let i = n - tail; i < n; i++) sum += sorted[i];
  return sum / tail;
}
