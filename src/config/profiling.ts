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
   * allocate while it is recording. The one ring that is not this size is a
   * benchmark's, which is sized to its script (`bench` below).
   */
  frames: 3000,

  /**
   * The FLOOR of what a capture's `hitches` list is a list of, in
   * milliseconds. The threshold in force is this or `hitchFactor` times what
   * the device has lately been managing, whichever is LARGER.
   *
   * 24 ms is one missed 60 Hz deadline with a little room: a frame that misses
   * vsync does not take 18 ms, it waits for the next interval and takes 33
   * (`FINDINGS.md` §1). Anything at or over this is a frame the player felt on
   * a panel this game runs well on — and that last clause is the whole reason
   * `hitchFactor` exists beside it.
   */
  hitchMs: 24,

  /**
   * What a frame has to cost as a multiple of the device's own recent floor
   * before it is filed as a hitch.
   *
   * **An absolute threshold degenerates on exactly the device this instrument
   * was built to be carried to.** A mid-range phone holding 30 fps spends 33 ms
   * in every frame, so at `hitchMs` alone EVERY frame is a hitch: the list
   * floods, the cap below throws away the older half of it on every lap, and a
   * capture's headline — the worst frames in the ring, whole — reaches back
   * three seconds instead of fifty. The chip's counter pegs and stops meaning
   * anything. A hitch is not an absolute duration; it is a frame that cost
   * much more than the frames around it, and on a locked-30 device that is
   * ~82 ms rather than 33.
   *
   * It cuts the other way too, which is the half nobody notices: on a 240 Hz
   * machine at 4 ms a frame, a 20 ms frame is five missed deadlines and a
   * violent stutter, and a fixed 24 never files it.
   *
   * 2.5 is a frame that took two and a half times what its neighbours did.
   * Below ~2 the ordinary jitter of a browser's frame pacing starts to qualify.
   */
  hitchFactor: 2.5,

  /**
   * How fast the baseline this device is measured against RISES and FALLS, as
   * an EWMA weight per frame.
   *
   * **They are deliberately different, and which one applies is decided by the
   * BAR rather than by the average.** A symmetric mean is dragged upward by the
   * very frames it is meant to be the yardstick for; a mean that resisted
   * everything above itself would resist half of all frames and take several
   * seconds to follow a device that genuinely changed speed. So the slow rate
   * applies only to a frame the bar has already called an outlier — a 682 ms
   * frame against a 7.8 ms floor lifts it by 6.8 ms — and every ordinary frame
   * moves it most of the way in either direction.
   *
   * What that buys is the case nobody thinks of: a profiler armed on the MENU
   * and then handed a heavy map. The floor triples, and the bar follows it in
   * about fifty frames rather than in two hundred and thirty. It is also why
   * the first frame SEEDS the baseline outright instead of averaging up from
   * zero — a profiler armed on a slow device has the right bar from its second
   * frame.
   */
  baselineRise: 0.01,
  baselineFall: 0.15,

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
   * How many LONG ANIMATION FRAMES a capture carries whole, worst first.
   *
   * **These are the only records here that carry a STRING**, so the cap is a
   * clipboard budget as well as a memory one: each one names the script the
   * browser blamed, which is the whole reason the probe exists. Twelve is
   * enough to see whether a hitch episode has one cause or several, and small
   * enough that a full list is a few hundred bytes.
   *
   * It is also the bound on the probe's allocation. `FrameProfile` may not
   * allocate per frame, and on a device slow enough that EVERY frame is a long
   * one the observer would fire every frame — so once this list is full,
   * nothing is built for an entry that would not displace the smallest in it.
   */
  loafKept: 12,

  /**
   * How many pipeline and shader-module CREATIONS the profiler keeps whole —
   * kind, label, shader and define set — newest first.
   *
   * They are what a warm-up pass would have to compile in advance, so the log
   * is sized for a round rather than for a hitch: an install is ~100 creations
   * and a round in play a handful (6 in 40 s, `docs/profiling.md`,
   * "Compiles"), so 256 holds the whole of a round with an install's worth to
   * spare. The strings are references Babylon already holds, so the memory is
   * the arrays — about 5 KB — sized once on arming. Every creation is still COUNTED per frame
   * whatever falls off the end of this.
   */
  creationsKept: 256,

  /**
   * How many of those a COMPACT capture carries. The download carries every
   * one the window holds; this is the clipboard's share.
   */
  creationsReported: 48,

  /**
   * How many frames BEFORE a hitch a creation still counts against it, in
   * `HitchFrame.createdNear` and `pipelines.hitchesNear`.
   *
   * **Two, because Dawn compiles behind the call and the stall lands on first
   * USE**, which is the frame that created it or one of the next two — the
   * window `FINDINGS.md` 1 named when it asked for this hook. Wider would start
   * catching creations that merely happened nearby; a round in play makes so
   * few that a coincidence at two frames is itself worth a look.
   */
  creationLead: 2,

  /**
   * How many `performance.now()` reads the clock-grain probe takes on arming.
   *
   * **The probe is not optional and its answer belongs in every capture.**
   * Chrome coarsens `performance.now()` to 100 us unless the page is
   * cross-origin isolated, and this one is not (`docker/default.conf.template`
   * sets no COOP/COEP) — while most of the phases below `render` cost under
   * 120 us on real hardware (`docs/profiling.md`, "Reading a capture"). So a
   * single frame's reading of a small phase is one or two grains and nothing
   * in between, and only the MEAN over many frames converges. A report that
   * did not say which grain it was taken at would be a table of plausible
   * numbers meaning nothing.
   *
   * 20,000 reads is a couple of milliseconds and reliably finds the floor.
   */
  grainSamples: 20000,

  /**
   * How many `begin`/`end` pairs the overhead probe times on arming.
   *
   * Recorded into the capture for the reason the grain is: an instrument that
   * does not state its own cost is one nobody can subtract. See `ENGINE_UPGRADE.md`
   * S9 on the instrument that had been dead since the WebGPU port.
   */
  overheadSamples: 20000,

  /**
   * How much ballast the heap-liveness probe allocates on arming, in
   * megabytes.
   *
   * **`performance.memory` is frozen on a stock browser and the probe exists to
   * say so rather than to let a report imply otherwise.** Chrome rate-limits
   * the bucketised reading to one update every TWENTY MINUTES — deliberately,
   * so a page cannot compare memory before and after a dubious action — so on
   * a phone the number does not move, and a heap series taken from it would be
   * a flat line read as "nothing is allocating". `--enable-precise-memory-info`
   * lifts that to a 20 ms refresh, which is what a Playwright run should pass
   * and what makes the curve worth having.
   *
   * So the probe allocates this much, reads the counter again, and drops it:
   * the reading either moved or it did not, and `memory.heapLive` says which.
   * 16 MB is well past any bucket the coarsened form rounds to, and it is a
   * few milliseconds during a settings toggle rather than anything in a frame.
   */
  heapProbeMb: 16,

  /**
   * The benchmark `?bench=<map>` plays (`bench/BenchScript.ts`): how long it
   * holds each thing it looks at, and the fixed step it plays the round at.
   *
   * **Everything here is counted in FRAMES or in fixed steps, never in wall
   * clock, and that is the whole of what makes two runs comparable.** The
   * same frames are drawn in the same order on every device; only what each
   * one COSTS differs. A script paced by seconds would show a phone fewer
   * frames of the same path than a desktop and call the two the same run.
   *
   * The ring is sized to the script on arming (`BenchScript.frames`), so
   * lengthening any of these lengthens the run and the memory together, and
   * nothing is ever lapped out of a capture.
   */
  bench: {
    /**
     * The round's seed — `BABYLON_EXIT.md` X0.2's fixed seed, so the fight is
     * the one that step proved reproduces. `?seed=` overrides it.
     */
    seed: 777,
    /**
     * The step every bench frame advances the world and every clock by,
     * whatever the wall clock did. 1/60 s, the authority's tick, so a fight
     * here and one under `npm run simulate` are the same arithmetic.
     */
    dt: 1 / 60,
    /** Headings per vantage: the bank's pose turned through a full circle. */
    headings: 8,
    /**
     * The settle on arriving somewhere — a vantage, or the path's start —
     * before anything there is measured: the QUIET frames in a row that end
     * it (`BenchScript.settles`). The shadow window re-renders, the irradiance
     * volume re-traces its new window on its warm budget, and the first look
     * at anything the warm-up did not reach compiles. Long, because the GPU's
     * share of that surfaced 60-92 frames after the jump on the Windows box,
     * as one frame that waited; the settle has to outlast it to see it.
     */
    arriveFrames: 120,
    /** The settle after each turn of the camera, in quiet frames in a row. */
    turnFrames: 12,
    /**
     * What a settle calls QUIET: a frame no more than this many times the
     * fastest it has seen, nor this many milliseconds over it — whichever is
     * looser, so a device whose frame swings by a few milliseconds is quiet.
     */
    quietFactor: 2.5,
    quietSlackMs: 8,
    /**
     * The most frames a settle takes, quiet or not, as a multiple of its own
     * length — 600 on arriving, 60 after a turn. The ring is sized as if every
     * settle ran to it, so this is also the run's memory.
     */
    settleCap: 5,
    /** Frames measured per heading, at the least — see `vantageFrames`. */
    holdFrames: 36,
    /**
     * The fewest frames the VANTAGES are measured for between them, spread
     * over however many a map has: a map with one stop holds each heading
     * longer rather than measuring less. A GPU-bound frame, uncapped, arrives
     * in BURSTS — the CPU runs ahead and then waits a few hundred milliseconds
     * for the GPU, about every 1.3 s on Kurenai at 3440x1440 — and a window
     * shorter than a few bursts catches none or one: Kurenai's single stop,
     * 288 frames, moved 41% between three runs while its 1,440-frame path
     * agreed to 0.4%. 1,152 is what Greyfen's four stops already came to.
     */
    vantageFrames: 1152,
    /** Fixed steps of the camera path through the densest quarter. */
    pathSeconds: 24,
    /**
     * The path's loop radius is the spread of the quarter's collider boxes,
     * held between these two, in metres — so a village is circled at street
     * scale and a 900 m town is not flown at airliner speed.
     */
    pathRadius: [25, 110],
    /** Metres the path rides over whatever is under it — street or roof. */
    pathClearance: 2.5,
    /**
     * The round before the measured fight, stepped `leadSteps` fixed steps a
     * frame and NOT measured: on every map the first tens of seconds are bots
     * running to flags, which is a frame with nobody fighting in it
     * (`FINDINGS.md` 32's "the CLIENT frame was measured EMPTY"). It is the
     * same steps as playing them one a frame, so the fight that follows is the
     * fight the seed decides.
     */
    leadSeconds: 45,
    leadSteps: 9,
    /** Fixed steps of the measured fight, one a frame. */
    fightSeconds: 45,
    /**
     * The spectator's chase camera over the bot it follows: metres back and
     * up from the eye, pulled in off whatever solid is behind, and how fast its
     * bearing follows the bot's look (per second, the frame-lerp idiom at the
     * fixed step).
     */
    chaseBack: 3.5,
    chaseUp: 1.1,
    chaseTurn: 4,
  },
} as const;
