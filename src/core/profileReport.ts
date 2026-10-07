/**
 * profileReport.ts — what a frame-profiler capture SAYS: the report and the
 * trace, built from the ring `FrameProfile` recorded.
 * Owns: the report's shape (`ProfileReport` and every row type in it, the JSON
 * a capture hands back), `buildReport`, `buildTrace`, and the statistics both
 * are computed with. Owns NO recording: it reads a `ProfileRing` it is handed
 * at the moment of a capture and keeps nothing between captures.
 *
 * Invariants:
 *  - **It ALLOCATES FREELY, and that is why it is a file of its own.** The
 *    recorder may not allocate per frame (`FrameProfile`'s header says why);
 *    a capture is a deliberate act and not a frame, so everything here builds
 *    arrays, objects and strings as it likes. The two used to share one class
 *    and only comments kept them apart. Nothing here may be called from a
 *    frame — `FrameProfile.capture` and `FrameProfile.trace` are the only
 *    callers, and both are gestures.
 *  - **It never WRITES the ring.** Every typed array in a `ProfileRing` is the
 *    recorder's own, lent for the length of one call; a write here would land
 *    in the live ring and be read back as a measurement.
 *  - **The report is the artefact, so its shape is a contract with the
 *    reader** (`public/profile_viewer.html`). A field changed, added or given
 *    a new meaning owes `version` a bump and a line in the history beside it.
 *  - It reads no game state, exactly as the recorder reads none: the map, the
 *    graphics and the context rows were pushed by `Game` into the ring.
 */
import { CONFIG } from "../config";
import { PARENT_OF, PHASES, ROOTS, SLOTS, type Phase } from "./profilePhases";

/**
 * How much of a creation's define set a COMPACT report carries, in characters.
 * A cel variant's set runs to several hundred, and the compact form is sized to
 * survive a phone's clipboard; the download carries every one whole.
 */
const DEFINES_CAP = 160;

/**
 * The duration a frame has to reach before the browser reports it at all.
 *
 * **Fixed by the specification at 50 ms, and it is the one number that decides
 * what an ABSENCE means.** Over it, no entry is a real finding: the browser
 * watched that frame and had nothing to report, so the main thread was idle.
 * UNDER it, no entry means nothing whatsoever — a 44.9 ms hitch is invisible to
 * this probe by design. A reader that misses the distinction turns a threshold
 * into a diagnosis, which is exactly what happened the first time this was
 * read: six frames between 24 and 50 ms were filed as "the main thread was
 * idle" when the truth is that nobody looked.
 */
const LOAF_FLOOR_MS = 50;

/**
 * Whether this browser can measure a WHOLE FRAME's GPU time at all, which is a
 * different question from whether the adapter has `timestamp-query`.
 *
 * **Babylon brackets the whole command encoder with
 * `GPUCommandEncoder.writeTimestamp`, and Chrome exposes that method only
 * behind `--enable-unsafe-webgpu`** — while the FEATURE itself, and the
 * `timestampWrites` pass descriptor the MAIN PASS counter is written with, need
 * no flag at all. So on a stock browser the adapter reports the feature,
 * `enableGPUTimingMeasurements` takes, `gpuTimeInFrameForMainPass` appears and
 * `available` is therefore TRUE — while `WebGPUDurationMeasure.stop` returns a
 * literal 0, which `endFrame` accepts because `duration >= 0`. The counter then
 * records a real measurement of ZERO on every frame: 747 of them over one
 * measured session, against 626 genuine samples with the flag. `over` filters
 * every one of them out on `> 0` and the report says `samples: 0`.
 *
 * **Which is indistinguishable from "the GPU took no time", and that is the
 * whole reason this exists.** It is the third fact in the row `loaf.supported`
 * and `memory.heapLive` already state — "nobody asked", "the adapter refused"
 * and "this browser cannot express the answer" are three different things and
 * none of them is a reading. It cost a capture taken to settle `FINDINGS.md`
 * #1: `?gpu` armed, the feature present, `available` true, and the one
 * question the flag exists to answer came back empty.
 *
 * The METHOD is absent from `@webgpu/types` — it was removed from the spec,
 * which is why Chrome keeps it behind a flag — so the prototype is cast rather
 * than typed. **It is reached through `globalThis` rather than named**, which
 * is not style: `server/tsconfig.json` narrows `types` to `["node"]` and still
 * includes `../src`, so the bare identifier is undeclared in the authority's
 * typecheck even though it is declared in the client's — and it is undefined
 * at RUNTIME there too, under `NullEngine`.
 */
function gpuFrameMeasurable(): boolean {
  const ctor = (
    globalThis as unknown as {
      GPUCommandEncoder?: { prototype?: { writeTimestamp?: unknown } };
    }
  ).GPUCommandEncoder;
  return typeof ctor?.prototype?.writeTimestamp === "function";
}

/**
 * What a pipeline-or-module creation was, and the byte the ring stores for it.
 * The recorder stores the INDEX (`FrameProfile`'s `DEVICE_CREATES`, a byte
 * in `logKind`) and the name is attached here, at capture.
 *
 * **A creation is not a cost, and that is why this is recorded as an EVENT
 * against the frame rather than timed as a span.** Dawn compiles behind the
 * call: summed over a whole Coldharbour round `createRenderPipeline` is under a
 * millisecond (`plans/webgpu-ref/pipelines.mjs`), and the stall lands later, on
 * the first draw that USES what was created — the same frame or one or two after
 * it. So the question this answers is never "how long did the call take" but
 * "was something created on, or just before, the frame that hitched", which
 * is `FINDINGS.md` 1's first-use hypothesis put in a form a capture can settle.
 * The call time is kept beside it (`pipelines.callMs`) only to show that it is
 * not the explanation.
 */
const CREATED = ["render", "compute", "module"] as const;

/** One creation, as a capture reports it. See `ProfileReport.pipelines`. */
export interface CreationEvent {
  /** Seconds before the newest frame in the ring. */
  ago: number;
  kind: (typeof CREATED)[number];
  /**
   * The wall clock of the frame it landed on — the frame that would pay a
   * first-use compile if the thing was drawn at once. 0 where that frame's
   * interval is not known yet (the newest row).
   */
  frameMs: number;
  /**
   * Babylon's label for a render pipeline: its colour and depth formats, sample
   * count and texture state, which is as close as the DEVICE gets to saying
   * which pass it was for. Empty for whatever Babylon creates unlabelled.
   */
  label: string;
  /** The shader name, for a render pipeline built through Babylon's cache. */
  effect: string;
  /** That effect's define set — the variant. Truncated in a compact report. */
  defines: string;
  /** Time inside the create call itself, which is not the compile. */
  callMs: number;
}

/** One phase's line in a report. Milliseconds throughout. */
export interface PhaseStat {
  name: Phase;
  /** How many recorded frames entered this phase at all. */
  frames: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  /** Mean as a share of the mean `frame`, 0..1. Attribution, not a partition. */
  share: number;
}

/**
 * One long animation frame, whole — the browser's account of a frame it
 * considered slow, filed against the ring row it ended on.
 *
 * Read it BESIDE the hitch list rather than instead of it. A hitch that has one
 * of these on it is the main thread; a hitch that has none, in a capture where
 * `loaf.supported` is true, is not.
 */
export interface LoafFrame {
  /** Seconds before the newest frame in the ring. */
  ago: number;
  /** The wall clock of the ring row this landed on, for the pairing. */
  frameMs: number;
  /** The browser's own window, end of the last frame's render to the end of this one's. */
  durationMs: number;
  /**
   * How much of it was work that would have blocked an input, which is the
   * browser's own answer to "how much of this did a user feel". 0 where the
   * field is absent.
   */
  blockingMs: number;
  /** Summed duration of the scripts inside it. Zero means the time was not JS. */
  scriptMs: number;
  /**
   * The RENDERING half — style, layout, paint, commit — as the remainder after
   * the browser's `renderStart`.
   *
   * **Read it against `scriptMs` and `blockingMs`, because those three are
   * three different verdicts.** Script high: the main thread was busy with JS.
   * Render high with script near zero: the browser's own rendering took the
   * time, which on a page that is one canvas means compositing or the way to
   * the screen. All three near zero under a long `durationMs`: the frame began
   * and then WAITED, which is a scheduling answer and not a cost at all.
   */
  renderMs: number;
  /** The biggest script in it, as function and file. Empty when there were none. */
  top: string;
}

/** One frame worth keeping whole, because it was slow. */
export interface HitchFrame {
  /** Seconds before the newest frame in the ring. */
  ago: number;
  /**
   * The wall clock this frame's own spans fill: its start to the start of the
   * one after it.
   *
   * **Aligned with `phases` since report version 4**, and before that it was
   * the interval BEFORE the frame — which paired a hitch's cost with the
   * following frame's spans and reported the recovery frame's healthy tick
   * under it. See `FrameProfile.endFrame`.
   */
  frameMs: number;
  x: number;
  y: number;
  z: number;
  botsAlive: number;
  /**
   * Collections the sentinel reported during this frame, and the used heap at
   * the end of it in MB (0 where the reading is frozen — see `FrameProfile`'s
   * header).
   *
   * **This is the pair the whole hitch list exists to be read against.** A
   * hitch whose `phases` do not add up to its `frameMs`, with `gc` on it, is
   * a collection; the same shortfall with `gc` at 0 is the browser — vsync,
   * present, compositing — and those are two different investigations.
   *
   * **That subtraction is only between two facts about the SAME frame from
   * report version 4 onward**, and a v3 capture's shortfall is mostly the
   * pairing bug `FrameProfile.endFrame` describes rather than a browser. Do
   * not read an old capture's "outside the tick" verdict; re-take it.
   */
  gc: number;
  heapMb: number;
  /**
   * The long animation frame covering this hitch, and how much of it blocked.
   * **Zero means the browser reported none** — so in a capture where
   * `loaf.supported` is true, a hitch with `loafMs: 0` is one the main thread
   * was IDLE for, and its time went to the compositor or the panel. That is the
   * split the residue alone could never make. See `FrameProfile`'s `LOAF_TYPE`.
   */
  loafMs: number;
  loafBlockMs: number;
  /**
   * How much of that long frame was script, and how much was the browser's own
   * rendering. **A long frame is not by itself a busy main thread** — a real
   * capture carried 263.5 ms of long frame over 8.7 ms of script and zero
   * blocking — so these two are what separate "the page did it" from "the page
   * was waiting for the browser". See `LoafFrame.renderMs`.
   */
  loafScriptMs: number;
  loafRenderMs: number;
  /**
   * GPU time for the main pass on this frame, **0 where none resolved** — see
   * `ProfileReport.gpu`. A hitch whose wall clock is a quarter of a second
   * over a GPU time of a few milliseconds is not waiting on the GPU.
   */
  gpuMs: number;
  /**
   * Whole-frame GPU time on this frame, **0 where this frame was not one of
   * the sampled ones** — which is most of them. Where it is non-zero it is the
   * number that matters: a 240 ms wall clock over 3 ms of GPU is not the GPU.
   */
  gpuFrameMs: number;
  drawCalls: number;
  activeMeshes: number;
  meshWalkMs: number;
  renderTargetsMs: number;
  particlesMs: number;
  /**
   * Pipelines and shader modules created ON this frame, and on it plus the
   * `CONFIG.profiling.creationLead` frames before it.
   *
   * **`createdNear` is the one to read.** A creation costs nothing at the call
   * and the compile lands on first use, which is this frame or a frame or two
   * after the creation — so a hitch with `createdNear` above zero is a
   * candidate first-use stall, and a hitch with zero is not one. Absent before
   * report version 11.
   */
  createdOn: number;
  createdNear: number;
  /** Only the phases this frame actually entered, in `PHASES` order. */
  phases: Partial<Record<Phase, number>>;
}

/**
 * The graphics a frame was drawn with, pushed by `Game` whenever the settings
 * are applied. Plain strings rather than the settings' own unions, because this
 * file may not know what a rung IS — only what to write down.
 *
 * **Every value is the one IN FORCE, not the one stored.** A `?gi=` or a
 * `?shadows=` overrides the setting for a session, and a capture taken under
 * one that reported the stored rung would be a confident wrong answer about the
 * very thing it was taken to compare. `forced` names the keys the URL decided.
 */
export interface ProfileGraphics {
  /** `Settings.renderScale` — a share of the panel's native resolution. */
  renderScale: number;
  /**
   * `Settings.fpsCap` — the frame-rate ceiling, 0 for none. Read a capture's
   * frame times against it: under a cap of 30 a 33 ms frame is the cap doing
   * its job, not a slow device. Absent in a capture from before the setting
   * existed, which ran uncapped.
   */
  fpsCap?: number;
  shadows: string;
  gi: string;
  grass: string;
  /**
   * The crowns' rung the standing map was BUILT with — not the stored
   * setting, which a player may have moved since and which waits for the
   * next map (`CONFIG.graphics.foliage`). Absent before a map is built, and in
   * a capture from before the setting existed.
   */
  foliage?: string;
  /** The shaft pass's rung, or `off` when it is off the camera. */
  volumetrics: string;
  motionBlur: boolean;
  paperGrain: boolean;
  /**
   * Whether the corner minimap is drawn — false under `?nominimap`, the
   * HUD's A/B (FINDINGS.md 13). Absent in a capture from before the flag
   * existed, every one of which drew it.
   */
  minimap?: boolean;
  /** Keys above whose value came from the URL rather than the setting. */
  forced: readonly string[];
}

/** What a capture hands back. JSON by construction — this is the artefact. */
export interface ProfileReport {
  version: number;
  takenAt: string;
  reason: string;
  /** The map the ring was recorded on, pushed by `Game`. */
  map: string;
  device: {
    userAgent: string;
    devicePixelRatio: number;
    window: string;
    /** Backing-store size, which is the render scale already spent. */
    backingStore: string;
    hardwareConcurrency: number;
    /** `navigator.deviceMemory` where the browser has it. */
    deviceMemoryGb: number | null;
    /**
     * `(pointer: coarse)` — the test every per-machine default in
     * `settings.ts` keys on, so it says which defaults a fresh install got.
     */
    coarsePointer: boolean;
  };
  /**
   * The graphics settings in force when the capture was taken, or null where
   * nothing pushed them. `inForceSeconds` is how long they had been: **shorter
   * than `window.seconds` means the window straddles a change** (past the
   * 0.1 s both are rounded to — a ring armed at boot ties exactly), and its
   * aggregates are a blend of two configurations.
   */
  graphics: (ProfileGraphics & { inForceSeconds: number }) | null;
  /**
   * Child phase → the span that contains it, straight from `PARENT_OF`.
   *
   * Carried so a reader can draw the containment without knowing this build's
   * phase list — see `PARENT_OF`. A phase absent from here is a root.
   */
  tree: Record<string, string>;
  /**
   * The phases nothing contains — see `ROOTS`. Absent from a capture taken
   * before this field, where `["frame"]` is the right assumption.
   */
  roots: string[];
  /** What the instrument knows about itself. See `FrameProfile`'s header. */
  clock: {
    /** The smallest non-zero `performance.now()` step observed, in ms. */
    grainMs: number;
    /** One `begin`/`end` pair, in microseconds. */
    overheadUs: number;
    /** Phases whose mean is under one grain — read their means, not their tails. */
    belowGrain: Phase[];
  };
  window: {
    frames: number;
    seconds: number;
  };
  frame: {
    fps: number;
    mean: number;
    p50: number;
    p95: number;
    p99: number;
    max: number;
    /** The statistic that matters: the mean of the slowest 1%. */
    onePercentLow: number;
    hitches: number;
    /**
     * What the hitch list was being filed at when the capture was taken, in ms
     * — `CONFIG.profiling.hitchMs` or `hitchFactor` times the device's own
     * recent floor, whichever is larger.
     *
     * In the report because the threshold MOVES: a reader who assumed 24 on a
     * capture taken from a phone holding 30 fps would read an empty list as a
     * smooth session rather than as the 82 ms bar it actually cleared.
     */
    hitchThresholdMs: number;
    /** The floor that threshold was derived from. See `baselineRise`. */
    baselineMs: number;
  };
  /**
   * What the heap and the collector were doing, and what this browser would
   * let the instrument see of either. See `FrameProfile`'s header.
   */
  memory: {
    /**
     * Whether `performance.memory` MOVED when the arming probe allocated
     * against it. False on a stock browser, where the reading is rate-limited
     * to one update every twenty minutes, and the heap fields below are then 0
     * rather than a flat line pretending to be a measurement.
     */
    heapLive: boolean;
    /** Mean used JS heap over the window, MB. 0 unless `heapLive`. */
    heapMb: number;
    /** Peak used JS heap over the window, MB. 0 unless `heapLive`. */
    heapPeakMb: number;
    /**
     * Every RISE in the heap over the window, summed and divided by its
     * length: the allocation rate, in MB/s. 0 unless `heapLive`.
     *
     * The number to watch after touching anything in the frame path — the
     * no-allocation rule `FrameProfile` states for itself is one nothing else in
     * the game obeys, and this is the only readout that would notice it being
     * broken somewhere that matters.
     */
    allocMbPerSec: number;
    /**
     * Whether `FinalizationRegistry` exists here at all. Where it does not,
     * `gcEvents` is 0 and means nothing.
     */
    gcObserved: boolean;
    /**
     * Collections the sentinel reported **over this window**, summed from the
     * ring rather than counted since arming. Best-effort — see
     * `FrameProfile`'s header.
     */
    gcEvents: number;
    gcPerSec: number;
  };
  counters: {
    drawCalls: number;
    activeMeshes: number;
    meshWalkMs: number;
    renderTargetsMs: number;
    /** The GPU clouds and the mote field, which no phase covers. */
    particlesMs: number;
  };
  /**
   * What the BROWSER said about the same frames, which is the only thing in
   * this report that is not this instrument's own measurement.
   *
   * `supported` first and always, because the useful reading here is an
   * ABSENCE: no entries over a window full of hitches means the main thread was
   * idle through them. That inference is only available where the browser
   * reports these at all (Chrome 123+; nothing in Safari or Firefox at the time
   * of writing), and on a browser that does not, an empty list means nothing
   * whatsoever. See `FrameProfile`'s `LOAF_TYPE`.
   */
  loaf: {
    supported: boolean;
    /**
     * The duration a frame must reach before the browser reports it, fixed at
     * 50 ms by the specification. **It is what makes an absence readable**: a
     * hitch OVER this with no entry had an idle main thread, and a hitch under
     * it simply was not watched. Shipped so a reader never has to know the
     * number to use the field.
     */
    floorMs: number;
    /**
     * How many long frames landed in this window, and how many ROWS they
     * marked between them — one window covers several, so `rows` is always
     * the larger and the two are not interchangeable. **Every total below is
     * over `entries`**, because summing over rows counts the same
     * milliseconds once per row and turned 26 entries into 51% of the wall
     * clock. See `FrameProfile.loafHead`.
     */
    entries: number;
    rows: number;
    /**
     * Their summed duration over those rows, and the three shares that say
     * what the duration WAS: blocking (a task nobody could interrupt), script
     * (JS), and render (the browser's own style/layout/paint/commit).
     */
    totalMs: number;
    blockingMs: number;
    scriptMs: number;
    renderMs: number;
    /** The biggest few, whole, with the script the browser blamed. */
    worst: LoafFrame[];
  };
  /**
   * What the GPU spent on the main pass, where the boot asked for it.
   *
   * **`requested` and `available` are two questions and a capture answers
   * both**, the rule `loaf.supported` and `memory.heapLive` already state:
   * nobody asked, or somebody asked and the adapter refused, are different
   * facts and neither is "the GPU took no time". `?gpu` is what asks — see
   * `main.ts`, which is the only place it can act, because a device's features
   * are fixed when it is created.
   *
   * **It is the MAIN PASS only.** Shadow maps, the glow's targets and the
   * reflection bake are render targets with counters of their own that this
   * does not read, so a frame whose GPU cost is in a target reads low here.
   */
  gpu: {
    requested: boolean;
    available: boolean;
    /**
     * Whether this browser can express a whole-frame answer — see
     * `gpuFrameMeasurable`. **False with `frame.samples: 0` means the reading
     * was impossible, not that the GPU was idle**, and on Chrome that is the
     * ordinary case: it needs `--enable-unsafe-webgpu` on the command line,
     * which `available` does not. `mainPass` is unaffected either way.
     */
    frameMeasurable: boolean;
    /**
     * The WHOLE frame's GPU time, which is the one to read. Sampled rather than
     * continuous — only one measurement is in flight at a time — so `samples`
     * is the denominator and the mean is over those rows, never over the
     * window. **Read it against `frameMeasurable` and never alone.**
     */
    frame: { samples: number; meanMs: number; p95Ms: number; maxMs: number };
    /**
     * The MAIN PASS only, which in this pipeline is **the final full-screen
     * quad** and not the scene: the world renders into post-process targets, so
     * this reads in the tens of MICROSECONDS and is not a claim about the GPU
     * being idle. Kept because it is measured per frame and attributed exactly,
     * which `frame` above cannot be, so it is the cross-check rather than the
     * answer.
     */
    mainPass: { frames: number; meanMs: number; p95Ms: number; maxMs: number };
  };
  /**
   * What was COMPILED during the window, and whether the slow frames sat on it.
   *
   * **`observed` first, for the reason every other probe here ships its own
   * availability**: a window with no creations in it is a finding only where
   * the hook was installed. `named` says whether Babylon's descriptor builder
   * was found to name them; after a Babylon upgrade a capture with `observed`
   * true and `named` false means the internal moved, not that nothing had a
   * name.
   */
  pipelines: {
    observed: boolean;
    named: boolean;
    render: number;
    compute: number;
    modules: number;
    /** Time inside the create calls, summed. Small by nature — see `CREATED`. */
    callMs: number;
    /**
     * Slow frames in the window — every one, not only the kept — with a
     * creation on them or in the `creationLead` frames before. Read it against
     * `frame.hitches`.
     */
    hitchesNear: number;
    /** The creations the log still holds inside this window, newest first. */
    recent: CreationEvent[];
  };
  phases: PhaseStat[];
  hitches: HitchFrame[];
  /** The whole ring, one array per phase. Present only in a FULL report. */
  series?: {
    /**
     * Wall clock per frame, aligned with `phases` — see `HitchFrame.frameMs`.
     * One shorter than the ring: the newest row's interval is not known until
     * the frame after it closes.
     */
    frameMs: number[];
    /** Collections per frame, and the used heap in MB. See `memory`. */
    gc: number[];
    heapMb: number[];
    /**
     * Babylon's two counters, per frame.
     *
     * **They are here because the means alone cannot answer the question they
     * are most often asked.** `counters.drawCalls` is one number for the whole
     * window and a hitch record carries its own — so a draw count that RAMPS
     * across a second, which is what a batch of pipelines coming into view
     * looks like, was visible only as five disconnected hitch records and had
     * to be inferred. With the series it is a line you can lay against
     * `frameMs`.
     */
    drawCalls: number[];
    activeMeshes: number[];
    /**
     * The long animation frame on each row, 0 where there was none — see
     * `ProfileReport.loaf`. Laid against `frameMs` it is the whole reading:
     * where the two rise together the main thread was busy, and where
     * `frameMs` rises alone it was not.
     */
    loafMs: number[];
    /**
     * GPU time for the main pass per row, **0 where no reading resolved for
     * that frame** rather than where the GPU was idle. Lay it against
     * `frameMs`: a wall clock that rises while this stays flat is not the GPU.
     */
    gpuMs: number[];
    /**
     * Whole-frame GPU time on the rows that were measured, **0 on the rest —
     * which is most of them**, because only one measurement is in flight at a
     * time. Not a curve; a scatter. See `ProfileReport.gpu`.
     */
    gpuFrameMs: number[];
    /**
     * Pipelines (render and compute) and shader modules created per frame.
     * Laid against `frameMs` this is the first-use question asked of the whole
     * window: does a spike follow a creation by zero to two rows?
     */
    pipelines: number[];
    modules: number[];
    phases: Partial<Record<Phase, number[]>>;
  };
}

/**
 * One kept long animation frame, as the recorder holds it: the ring row and
 * the stamp that was in it, plus the browser's numbers and the script it
 * blamed. See `FrameProfile.loafWorst` on why the stamp rides with the row.
 */
export interface LoafRecord {
  at: number;
  when: number;
  durationMs: number;
  blockingMs: number;
  scriptMs: number;
  renderMs: number;
  top: string;
}

/**
 * Everything a capture reads, LENT by `FrameProfile` for the length of one
 * call.
 *
 * **These are the recorder's own fields under their own names**, and every
 * array is the live ring rather than a copy: a capture reads the ring and has
 * no reason to duplicate it. So the reporter may read anything and must write
 * nothing — see this file's header. Each field's argument is on the field of the same
 * name in `FrameProfile`; only the three that are not a field there are
 * documented here.
 *
 * A ring is only built while the recorder is armed and holds two frames, so
 * nothing here is null but `heapMb`, which is null on a browser whose heap
 * reading is frozen.
 */
export interface ProfileRing {
  /** `CONFIG.profiling.frames` — how many rows the ring holds. */
  readonly capacity: number;
  readonly cursor: number;
  readonly filled: number;
  readonly startMs: Float32Array;
  readonly durMs: Float32Array;
  readonly entered: Uint8Array;
  readonly frameAt: Float64Array;
  readonly frameMs: Float32Array;
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly pz: Float32Array;
  readonly botsAlive: Uint16Array;
  readonly drawCalls: Uint32Array;
  readonly activeMeshes: Uint32Array;
  readonly meshWalkMs: Float32Array;
  readonly rttMs: Float32Array;
  readonly particlesMs: Float32Array;
  readonly heapMb: Float32Array | null;
  readonly gcAt: Uint8Array;
  readonly loafMs: Float32Array;
  readonly loafBlockMs: Float32Array;
  readonly loafScriptMs: Float32Array;
  readonly loafRenderMs: Float32Array;
  readonly loafHead: Uint8Array;
  readonly gpuMs: Float32Array;
  readonly gpuFrameMs: Float32Array;
  readonly madeRender: Uint16Array;
  readonly madeCompute: Uint16Array;
  readonly madeModules: Uint16Array;
  readonly madeCallMs: Float32Array;
  readonly logT: Float64Array;
  readonly logKind: Uint8Array;
  readonly logMs: Float32Array;
  readonly logLabel: readonly string[];
  readonly logEffect: readonly string[];
  readonly logDefines: readonly string[];
  readonly logCursor: number;
  readonly logFilled: number;
  readonly createObserved: boolean;
  readonly createNamed: boolean;
  readonly loafSupported: boolean;
  readonly loafWorst: readonly LoafRecord[];
  readonly heapLive: boolean;
  /** Whether the GC sentinel is watching — `FrameProfile.gcReg` is not null. */
  readonly gcObserved: boolean;
  readonly baselineMs: number;
  readonly hitchBarMs: number;
  readonly hitchAt: readonly number[];
  readonly grainMs: number;
  readonly overheadUs: number;
  readonly mapId: string;
  readonly graphics: ProfileGraphics | null;
  readonly graphicsAt: number;
  readonly gpuRequested: boolean;
  /**
   * Whether the engine carries a main-pass GPU counter at all — asked of the
   * engine by the recorder, which is the half that holds Babylon's internals.
   */
  readonly gpuAvailable: boolean;
  /** The engine, for the backing store's size. Null where there is no scene. */
  readonly engine: {
    getRenderWidth(): number;
    getRenderHeight(): number;
  } | null;
}

/**
 * Freezes the ring into a report — see `FrameProfile.capture`, the one caller.
 *
 * `full` carries the complete per-frame series, which is what the download is
 * for; the compact form is summary plus the worst frames, sized to survive a
 * phone's clipboard.
 */
export function buildReport(
  r: ProfileRing,
  reason: string,
  full: boolean,
): ProfileReport {
  const cap = r.capacity;
  // **The window is every row whose interval is KNOWN, which is all of them
  // but the newest.** A row's wall clock is written by the frame after it
  // (see `FrameProfile.endFrame`), so the row the cursor has just left is
  // still waiting for its own, and a zero in the series would read as an
  // instant frame.
  //
  // It buys an invariant worth having: `spanMs` is `frameAt` of the newest
  // row minus `frameAt` of the oldest, which telescopes to exactly the sum
  // of the intervals in the window — so `window.seconds` and
  // `series.frameMs` now describe the same stretch of time, which they did
  // not before.
  const n = r.filled - 1;
  const first = (r.cursor - r.filled + cap) % cap;
  const frames = new Float64Array(n);
  for (let k = 0; k < n; k++) frames[k] = r.frameMs[(first + k) % cap];
  const frameStats = stats(frames, n);
  const spanMs = r.frameAt[(r.cursor - 1 + cap) % cap] - r.frameAt[first];

  const scratch = new Float64Array(n);
  const phases: PhaseStat[] = [];
  const belowGrain: Phase[] = [];
  const series: ProfileReport["series"] & object = {
    frameMs: [],
    gc: [],
    heapMb: [],
    drawCalls: [],
    activeMeshes: [],
    loafMs: [],
    gpuMs: [],
    gpuFrameMs: [],
    pipelines: [],
    modules: [],
    phases: {},
  };
  if (full) {
    for (let k = 0; k < n; k++) {
      const i = (first + k) % cap;
      series.frameMs.push(round(frames[k]));
      series.gc.push(r.gcAt[i]);
      series.heapMb.push(r.heapMb ? round(r.heapMb[i], 2) : 0);
      series.drawCalls.push(r.drawCalls[i]);
      series.activeMeshes.push(r.activeMeshes[i]);
      series.loafMs.push(round(r.loafMs[i]));
      series.gpuMs.push(round(r.gpuMs[i], 3));
      series.gpuFrameMs.push(round(r.gpuFrameMs[i], 3));
      series.pipelines.push(r.madeRender[i] + r.madeCompute[i]);
      series.modules.push(r.madeModules[i]);
    }
  }

  for (let slot = 0; slot < SLOTS; slot++) {
    let count = 0;
    const column: number[] = [];
    for (let k = 0; k < n; k++) {
      const at = ((first + k) % cap) * SLOTS + slot;
      const hit = r.entered[at] === 1;
      if (hit) scratch[count++] = r.durMs[at];
      if (full) column.push(hit ? round(r.durMs[at]) : 0);
    }
    if (count === 0) continue;
    const s = stats(scratch, count);
    const name = PHASES[slot];
    phases.push({
      name,
      frames: count,
      mean: round(s.mean),
      p50: round(s.p50),
      p95: round(s.p95),
      p99: round(s.p99),
      max: round(s.max),
      share: frameStats.mean > 0 ? round(s.mean / frameStats.mean, 4) : 0,
    });
    // The honesty line: a mean under one clock grain is a real number built
    // out of quantised ones, and its own tail is not.
    if (s.mean < r.grainMs) belowGrain.push(name);
    if (full) series.phases[name] = column;
  }
  // Biggest first, which is the only order anybody reads this in.
  phases.sort((a, b) => b.mean - a.mean);

  return {
    // 9: `gpu.frameMeasurable`, and the LoAF row is cleared when the ring
    // laps it. A v8 capture's `gpu.frame.samples: 0` cannot be read — it is
    // "the browser could not measure" and "the GPU did nothing" collapsed
    // into one number — and its `loaf` TOTALS carry every long frame the
    // process ever saw rather than the window's, so `loaf.totalMs`,
    // `blockingMs`, `scriptMs`, `renderMs`, `entries` and `rows` are
    // unreadable before v9. `loaf.worst`, the per-hitch `loaf*` fields and
    // `series.loafMs` were always right, and `gpu.mainPass` is unaffected.
    // 8: `gpu` — the main pass's GPU time, per frame and filed against the
    // frame it belongs to rather than the one that read it. Off unless the
    // boot asked (`?gpu`), and `requested`/`available` are two questions.
    // 7: `loaf.totalMs` and its three shares are summed over ENTRIES rather
    // than over the rows they marked, and `loaf.rows` carries the other
    // count. A v6 capture's totals are inflated by however many rows each
    // window covered — measured at 1.9x on the capture that found it — while
    // its per-hitch and per-record figures were always right.
    // 6: the three SHARES of a long frame — `scriptMs`, `renderMs` and
    // `blockingMs`, on the summary, on every kept record and on every hitch
    // — plus `loaf.floorMs`. A v5 capture says a long frame HAPPENED and
    // cannot say whether it was the page's: the first real one carried
    // 263.5 ms of window over 8.7 ms of script, which reads as a busy main
    // thread and was not one.
    // 5: `loaf` — the browser's own account of the frames this instrument
    // could only call "residue", and the per-hitch `loafMs` that says which
    // side of the page a hitch's time went. Its ABSENCE is a reading, so
    // `loaf.supported` rides with it.
    // 4: `frameMs` — in the series and on every hitch — is the interval the
    // frame's OWN spans fill, where a v3 capture carried the interval BEFORE
    // it. The aggregates are unaffected (a mean over a window does not care
    // which end a shift is at), so `frame`, `phases` and `memory` are
    // comparable across the boundary; a v3 hitch record is NOT, because its
    // wall clock and its phases are one row apart.
    // 3: `present`, the first phase outside `frame`, and the `roots` that
    // let a reader tell a second root from a phase it has not heard of.
    // 10: `graphics` — the settings in force and how long they had been —
    // and `device.coarsePointer`. Before it a capture could only be read
    // against a guess at its settings, the render scale worked back out of
    // the backing store and every rung assumed to be the device's default.
    // 11: `pipelines` — every pipeline and shader module created in the
    // window, filed against its frame and named by effect where Babylon's
    // builder could be wrapped — with `createdOn`/`createdNear` on every
    // hitch and `pipelines`/`modules` in the series. Before it a first-use
    // compile stall could only be guessed at from a draw count ramping.
    version: 11,
    takenAt: new Date().toISOString(),
    reason,
    map: r.mapId,
    tree: PARENT_OF,
    roots: [...ROOTS],
    device: deviceFacts(r),
    graphics: r.graphics
      ? {
          ...r.graphics,
          forced: [...r.graphics.forced],
          inForceSeconds: round((performance.now() - r.graphicsAt) / 1000, 1),
        }
      : null,
    clock: {
      grainMs: round(r.grainMs, 4),
      overheadUs: round(r.overheadUs, 3),
      belowGrain,
    },
    window: { frames: n, seconds: round(spanMs / 1000, 2) },
    frame: {
      fps: frameStats.mean > 0 ? round(1000 / frameStats.mean, 1) : 0,
      mean: round(frameStats.mean),
      p50: round(frameStats.p50),
      p95: round(frameStats.p95),
      p99: round(frameStats.p99),
      max: round(frameStats.max),
      onePercentLow: round(onePercentLow(frames, n), 1),
      hitches: r.hitchAt.length,
      hitchThresholdMs: round(r.hitchBarMs, 1),
      baselineMs: round(r.baselineMs),
    },
    memory: memoryFacts(r, first, n, cap, spanMs),
    loaf: loafFacts(r, first, n, cap),
    gpu: gpuFacts(r, first, n, cap),
    pipelines: creationFacts(r, first, n, cap, full),
    counters: counterMeans(r, first, n, cap),
    phases,
    hitches: worstHitches(r),
    series: full ? series : undefined,
  };
}

/**
 * The heap and the collector over the window.
 *
 * **`allocMbPerSec` is the sum of the RISES rather than the difference of the
 * ends**, and the difference matters: a heap that climbs 40 MB and is
 * collected back to where it started has a net delta of zero and an
 * allocation rate of several megabytes a second, and it is the second number
 * that says why the collector keeps waking up.
 */
function memoryFacts(
  r: ProfileRing,
  first: number,
  n: number,
  cap: number,
  spanMs: number,
): ProfileReport["memory"] {
  const seconds = spanMs > 0 ? spanMs / 1000 : 0;
  // Summed over the RING rather than kept as a running total — see
  // `FrameProfile.gcPending` on the bug that was.
  let gc = 0;
  for (let k = 0; k < n; k++) gc += r.gcAt[(first + k) % cap];
  let sum = 0;
  let peak = 0;
  let risen = 0;
  if (r.heapMb) {
    let prev = r.heapMb[first];
    for (let k = 0; k < n; k++) {
      const v = r.heapMb[(first + k) % cap];
      sum += v;
      if (v > peak) peak = v;
      if (v > prev) risen += v - prev;
      prev = v;
    }
  }
  return {
    heapLive: r.heapLive,
    heapMb: r.heapLive ? round(sum / n, 2) : 0,
    heapPeakMb: r.heapLive ? round(peak, 2) : 0,
    allocMbPerSec: r.heapLive && seconds > 0 ? round(risen / seconds, 2) : 0,
    gcObserved: r.gcObserved,
    gcEvents: gc,
    gcPerSec: seconds > 0 ? round(gc / seconds, 2) : 0,
  };
}

/** Every creation on ring row `i`, of any kind. */
function madeAt(r: ProfileRing, i: number): number {
  return r.madeRender[i] + r.madeCompute[i] + r.madeModules[i];
}

/**
 * Creations on row `i` and the `creationLead` rows before it — the frames a
 * creation could still be compiling into — never reaching back past the
 * oldest row the ring holds, where the counts belong to a lap long gone.
 */
function madeNear(r: ProfileRing, i: number): number {
  const cap = r.capacity;
  const oldest = (r.cursor - r.filled + cap) % cap;
  let sum = madeAt(r, i);
  let row = i;
  for (let k = 0; k < CONFIG.profiling.creationLead && row !== oldest; k++) {
    row = (row - 1 + cap) % cap;
    sum += madeAt(r, row);
  }
  return sum;
}

/**
 * What was created over the window, whether the slow frames sat on it, and
 * the creations the log still holds — see `ProfileReport.pipelines`.
 *
 * The log is mapped to rows by TIME here, at capture, rather than at the
 * call: see `FrameProfile.logT`. Rows are in time order, so a binary search
 * over the window's start stamps finds each one's frame.
 */
function creationFacts(
  r: ProfileRing,
  first: number,
  n: number,
  cap: number,
  full: boolean,
): ProfileReport["pipelines"] {
  let render = 0;
  let compute = 0;
  let modules = 0;
  let callMs = 0;
  for (let k = 0; k < n; k++) {
    const i = (first + k) % cap;
    render += r.madeRender[i];
    compute += r.madeCompute[i];
    modules += r.madeModules[i];
    callMs += r.madeCallMs[i];
  }
  let hitchesNear = 0;
  for (const i of r.hitchAt) if (madeNear(r, i) > 0) hitchesNear++;

  const recent: CreationEvent[] = [];
  const frameAt = r.frameAt;
  const start = frameAt[first];
  const newest = frameAt[(r.cursor - 1 + cap) % cap];
  const logCap = r.logT.length;
  const limit = full ? logCap : CONFIG.profiling.creationsReported;
  for (let k = 0; k < r.logFilled && recent.length < limit; k++) {
    const at = (r.logCursor - 1 - k + logCap) % logCap;
    const t = r.logT[at];
    // Newest first, so the first one older than the window ends the walk.
    if (t < start) break;
    // The last row that started at or before `t`. Row `n` is the newest,
    // whose interval is not known yet — its creations report frameMs 0.
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (frameAt[(first + mid) % cap] <= t) lo = mid;
      else hi = mid - 1;
    }
    const defines = r.logDefines[at];
    recent.push({
      ago: round(Math.max(0, newest - t) / 1000, 2),
      kind: CREATED[r.logKind[at]],
      frameMs: lo < n ? round(r.frameMs[(first + lo) % cap]) : 0,
      label: r.logLabel[at],
      effect: r.logEffect[at],
      defines:
        full || defines.length <= DEFINES_CAP
          ? defines
          : defines.slice(0, DEFINES_CAP - 1) + "…",
      callMs: round(r.logMs[at], 3),
    });
  }
  return {
    observed: r.createObserved,
    named: r.createNamed,
    render,
    compute,
    modules,
    callMs: round(callMs, 3),
    hitchesNear,
    recent,
  };
}

function counterMeans(
  r: ProfileRing,
  first: number,
  n: number,
  cap: number,
): ProfileReport["counters"] {
  let draws = 0;
  let meshes = 0;
  let walk = 0;
  let rtt = 0;
  let particles = 0;
  for (let k = 0; k < n; k++) {
    const i = (first + k) % cap;
    draws += r.drawCalls[i];
    meshes += r.activeMeshes[i];
    walk += r.meshWalkMs[i];
    rtt += r.rttMs[i];
    particles += r.particlesMs[i];
  }
  return {
    drawCalls: Math.round(draws / n),
    activeMeshes: Math.round(meshes / n),
    meshWalkMs: round(walk / n),
    renderTargetsMs: round(rtt / n),
    particlesMs: round(particles / n),
  };
}

/**
 * What the GPU spent, over the rows that got a reading.
 *
 * **Averaged over THOSE rows and not over the window**, because a row with no
 * reading is a missing measurement rather than a fast frame, and dividing by
 * the window would report a number several times under the truth with nothing
 * saying so. `frames` is the denominator, shipped beside the mean.
 */
function gpuFacts(
  r: ProfileRing,
  first: number,
  n: number,
  cap: number,
): ProfileReport["gpu"] {
  const over = (src: Float32Array | null) => {
    let count = 0;
    if (src) {
      const scratch = new Float64Array(n);
      for (let k = 0; k < n; k++) {
        const ms = src[(first + k) % cap];
        if (ms > 0) scratch[count++] = ms;
      }
      if (count > 0) {
        const s = stats(scratch, count);
        return {
          n: count,
          meanMs: round(s.mean, 3),
          p95Ms: round(s.p95, 3),
          maxMs: round(s.max, 3),
        };
      }
    }
    return { n: 0, meanMs: 0, p95Ms: 0, maxMs: 0 };
  };
  const whole = over(r.gpuFrameMs);
  const main = over(r.gpuMs);
  return {
    requested: r.gpuRequested,
    available: r.gpuAvailable,
    frameMeasurable: gpuFrameMeasurable(),
    frame: {
      samples: whole.n,
      meanMs: whole.meanMs,
      p95Ms: whole.p95Ms,
      maxMs: whole.maxMs,
    },
    mainPass: {
      frames: main.n,
      meanMs: main.meanMs,
      p95Ms: main.p95Ms,
      maxMs: main.maxMs,
    },
  };
}

/**
 * What the browser said about this window — see `ProfileReport.loaf`.
 *
 * Summed over the ROWS of the window rather than counted as they arrived, for
 * the reason `memoryFacts` sums `gcAt`: a running total outlives its own
 * ring and reports a rate the session never ran at.
 */
function loafFacts(
  r: ProfileRing,
  first: number,
  n: number,
  cap: number,
): ProfileReport["loaf"] {
  let entries = 0;
  let rows = 0;
  let total = 0;
  let blocking = 0;
  let script = 0;
  let render = 0;
  for (let k = 0; k < n; k++) {
    const i = (first + k) % cap;
    const ms = r.loafMs[i];
    if (ms <= 0) continue;
    rows++;
    // Only a HEAD row's numbers are added, or one window is counted once per
    // row it covers — see `FrameProfile.loafHead`.
    if (r.loafHead[i] !== 1) continue;
    entries++;
    total += ms;
    blocking += r.loafBlockMs[i];
    script += r.loafScriptMs[i];
    render += r.loafRenderMs[i];
  }
  return {
    supported: r.loafSupported,
    floorMs: LOAF_FLOOR_MS,
    entries,
    rows,
    totalMs: round(total),
    blockingMs: round(blocking),
    scriptMs: round(script),
    renderMs: round(render),
    worst: worstLoaf(r),
  };
}

/**
 * The kept long animation frames, worst first, with the stale ones dropped.
 *
 * Stale is the same test the hitch list makes and for the same reason: a ring
 * index is an identity only until the ring laps, and a record whose row has
 * been overwritten would put a real script's name under a frame that never
 * ran it.
 */
function worstLoaf(r: ProfileRing): LoafFrame[] {
  if (r.filled === 0) return [];
  const cap = r.capacity;
  const newest = r.frameAt[(r.cursor - 1 + cap) % cap];
  const out: LoafFrame[] = [];
  for (const rec of r.loafWorst) {
    if (r.frameAt[rec.at] !== rec.when) continue;
    out.push({
      ago: round((newest - rec.when) / 1000, 2),
      frameMs: round(r.frameMs[rec.at]),
      durationMs: round(rec.durationMs),
      blockingMs: round(rec.blockingMs),
      scriptMs: round(rec.scriptMs),
      renderMs: round(rec.renderMs),
      top: rec.top,
    });
  }
  out.sort((a, b) => b.durationMs - a.durationMs);
  return out;
}

/** The worst frames in the ring, whole. Sorted by cost, not by time. */
function worstHitches(r: ProfileRing): HitchFrame[] {
  const cap = r.capacity;
  const newest = r.frameAt[(r.cursor - 1 + cap) % cap];
  const seen = new Set<number>();
  const out: HitchFrame[] = [];
  for (let k = r.hitchAt.length - 1; k >= 0; k--) {
    const i = r.hitchAt[k];
    if (seen.has(i)) continue;
    seen.add(i);
    const phases: Partial<Record<Phase, number>> = {};
    for (let slot = 0; slot < SLOTS; slot++) {
      const at = i * SLOTS + slot;
      if (r.entered[at] === 1) phases[PHASES[slot]] = round(r.durMs[at]);
    }
    out.push({
      ago: round((newest - r.frameAt[i]) / 1000, 2),
      frameMs: round(r.frameMs[i]),
      x: round(r.px[i], 1),
      y: round(r.py[i], 1),
      z: round(r.pz[i], 1),
      botsAlive: r.botsAlive[i],
      gc: r.gcAt[i],
      heapMb: r.heapMb ? round(r.heapMb[i], 2) : 0,
      loafMs: round(r.loafMs[i]),
      loafBlockMs: round(r.loafBlockMs[i]),
      loafScriptMs: round(r.loafScriptMs[i]),
      loafRenderMs: round(r.loafRenderMs[i]),
      gpuMs: round(r.gpuMs[i], 3),
      gpuFrameMs: round(r.gpuFrameMs[i], 3),
      drawCalls: r.drawCalls[i],
      activeMeshes: r.activeMeshes[i],
      meshWalkMs: round(r.meshWalkMs[i]),
      renderTargetsMs: round(r.rttMs[i]),
      particlesMs: round(r.particlesMs[i]),
      createdOn: madeAt(r, i),
      createdNear: madeNear(r, i),
      phases,
    });
  }
  out.sort((a, b) => b.frameMs - a.frameMs);
  return out.slice(0, CONFIG.profiling.hitchesKept);
}

/**
 * The ring as Chrome Trace Event JSON, so `ui.perfetto.dev` is the viewer and
 * nobody here writes one.
 *
 * The spans nest properly by construction — `frame` contains `gameplay`
 * contains `world` contains `bots`, and every start is stored relative to its
 * own frame — so a flame chart falls out with no further work.
 *
 * **THE WINDOW IS CENTRED ON THE WORST FRAME IN THE RING, not on the present
 * moment, and that is the profiler's one design decision applied to the one
 * place it had been left out.** The ring holds `CONFIG.profiling.frames`
 * (3,000) *because* the gesture is pressed AFTER you feel something; a trace
 * that exported the last few hundred instead threw that away and handed back
 * whatever happened to be on screen when the thumb arrived. At 86 fps a
 * 600-frame tail is **seven seconds against a thirty-five second ring**, so a
 * hitch you reacted to in eight was simply not in the file — and nothing in
 * the file said so, which is worse: it looks like a trace of a healthy game.
 * Measured on a real export that prompted this: worst frame in it 17.6 ms,
 * worst frame in the ring behind it 332 ms.
 *
 * Centred rather than ending at the hitch, because both sides are evidence —
 * what was building up before it, and whether it cascaded after — and clamped
 * to what the ring actually holds, so a hitch in the first or last frames
 * still comes back with a full window rather than half of one.
 *
 * **The trace SAYS which window it is**, in the Perfetto track name and in an
 * instant marker on the worst frame itself, because the failure above was
 * only confusing for want of a label.
 */
export function buildTrace(r: ProfileRing, maxFrames: number): string {
  const cap = r.capacity;
  const n = Math.min(r.filled, maxFrames);
  const oldest = (r.cursor - r.filled + cap) % cap;

  // The worst frame in the WHOLE ring, by wall clock — the same measure the
  // hitch list ranks by, so the trace and the report agree about which frame
  // is the interesting one.
  let worstAt = 0;
  let worstMs = -1;
  for (let k = 0; k < r.filled - 1; k++) {
    const ms = r.frameMs[(oldest + k) % cap];
    if (ms > worstMs) {
      worstMs = ms;
      worstAt = k;
    }
  }

  // Centre, then clamp. The clamp is what keeps the window FULL at either end
  // of the ring instead of running off it.
  let startAt = worstAt - (n >> 1);
  if (startAt < 0) startAt = 0;
  if (startAt + n > r.filled) startAt = r.filled - n;
  const first = (oldest + startAt) % cap;
  const t0 = r.frameAt[first];
  const worstBase = (r.frameAt[(oldest + worstAt) % cap] - t0) * 1000;

  const parts: string[] = [];
  // Perfetto labels its track from these, which is where a reader finds out
  // what they are looking at. A trace carries no map and no device — it is
  // Chrome's format, not this instrument's — so this line is the only place
  // the window can describe itself.
  parts.push(
    '{"name":"process_name","ph":"M","pid":1,"tid":1,"args":{"name":"GREYWATCH frame profiler"}}',
    '{"name":"thread_name","ph":"M","pid":1,"tid":1,"args":{"name":"frames ' +
      (startAt + 1) +
      "-" +
      (startAt + n) +
      " of " +
      r.filled +
      " · centred on the worst (" +
      worstMs.toFixed(1) +
      ' ms)"}}',
  );
  // …and a marker on the frame the window was built around, so it is one
  // click away rather than something to hunt for by eye.
  parts.push(
    '{"name":"worst frame ' +
      worstMs.toFixed(1) +
      ' ms","cat":"frame","ph":"i","s":"g","pid":1,"tid":1,"ts":' +
      worstBase.toFixed(1) +
      "}",
  );
  for (let k = 0; k < n; k++) {
    const i = (first + k) % cap;
    const base = (r.frameAt[i] - t0) * 1000;
    for (let slot = 0; slot < SLOTS; slot++) {
      const at = i * SLOTS + slot;
      if (r.entered[at] !== 1) continue;
      const ts = base + r.startMs[at] * 1000;
      const dur = r.durMs[at] * 1000;
      parts.push(
        '{"name":"' +
          PHASES[slot] +
          '","cat":"frame","ph":"X","pid":1,"tid":1,"ts":' +
          ts.toFixed(1) +
          ',"dur":' +
          dur.toFixed(1) +
          "}",
      );
    }
    parts.push(
      '{"name":"draws","ph":"C","pid":1,"tid":1,"ts":' +
        base.toFixed(1) +
        ',"args":{"drawCalls":' +
        r.drawCalls[i] +
        ',"activeMeshes":' +
        r.activeMeshes[i] +
        "}}",
    );
    if (r.heapMb) {
      parts.push(
        '{"name":"heapMb","ph":"C","pid":1,"tid":1,"ts":' +
          base.toFixed(1) +
          ',"args":{"usedMb":' +
          r.heapMb[i].toFixed(2) +
          "}}",
      );
    }
    // An INSTANT rather than a counter track, because that is what a
    // collection is and it is what puts a marker straight down the flame
    // chart at the frame it landed on. `s:"g"` is global scope, which is how
    // Perfetto draws it across the whole timeline.
    if (r.gcAt[i] > 0) {
      parts.push(
        '{"name":"gc","cat":"memory","ph":"i","s":"g","pid":1,"tid":1,"ts":' +
          base.toFixed(1) +
          ',"args":{"count":' +
          r.gcAt[i] +
          "}}",
      );
    }
    // Creations get the same treatment and for the same reason: a first-use
    // stall is a long frame ZERO TO TWO frames after one of these, and that
    // is a reading you make by eye down a flame chart.
    if (madeAt(r, i) > 0) {
      parts.push(
        '{"name":"compile","cat":"gpu","ph":"i","s":"g","pid":1,"tid":1,"ts":' +
          base.toFixed(1) +
          ',"args":{"render":' +
          r.madeRender[i] +
          ',"compute":' +
          r.madeCompute[i] +
          ',"modules":' +
          r.madeModules[i] +
          "}}",
      );
    }
  }
  return '{"displayTimeUnit":"ms","traceEvents":[' + parts.join(",") + "]}";
}

function deviceFacts(r: ProfileRing): ProfileReport["device"] {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const engine = r.engine;
  return {
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio || 1,
    window: `${window.innerWidth}x${window.innerHeight}`,
    backingStore: engine
      ? `${engine.getRenderWidth()}x${engine.getRenderHeight()}`
      : "?",
    hardwareConcurrency: navigator.hardwareConcurrency || 0,
    deviceMemoryGb: nav.deviceMemory ?? null,
    coarsePointer:
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches,
  };
}

interface Stats {
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

/** Summarises the first `n` entries of `values`. Capture-time only. */
function stats(values: Float64Array, n: number): Stats {
  const view = values.subarray(0, n);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += view[i];
  const sorted = Float64Array.from(view).sort();
  return {
    mean: sum / n,
    p50: pick(sorted, 0.5),
    p95: pick(sorted, 0.95),
    p99: pick(sorted, 0.99),
    max: sorted[n - 1],
  };
}

function pick(sorted: Float64Array, q: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

/**
 * The mean of the slowest 1% of frames, in milliseconds.
 *
 * The statistic `HUD.setFps` already puts on screen, and for the same reason: a
 * mean is close to the worst measure of smoothness, because it is dominated by
 * the frames that arrived quickly and what a player feels is the ones that did
 * not.
 */
function onePercentLow(values: Float64Array, n: number): number {
  const sorted = Float64Array.from(values.subarray(0, n)).sort();
  const take = Math.max(1, Math.floor(n * 0.01));
  let sum = 0;
  for (let i = 0; i < take; i++) sum += sorted[n - 1 - i];
  return sum / take;
}

function round(v: number, places = 3): number {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}