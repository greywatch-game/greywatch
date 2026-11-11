/**
 * FrameProfile.ts — where a frame's milliseconds went, recorded continuously
 * and captured backwards.
 * Owns: the RECORDER — the ring that holds the recent past, the brackets that
 * fill it, the hooks on the device and the window's size (`watchWindow`), the
 * clock-grain, overhead and heap probes, and the `window.__profile` handle. The phase list
 * is `profilePhases.ts`'s and what a capture SAYS is `profileReport.ts`'s,
 * which this hands a `ProfileRing` at the moment of a capture. Owns NO game
 * state and reads none: `Game` brackets the phases it already sequences,
 * files the simulation core's own timing of its step (`fileTiming`, as the
 * page's own local match reports it), and pushes the per-frame context, so
 * nothing here imports a system and no system has heard of this.
 *
 * Invariants:
 *  - **It MEASURES and never decides.** No caller may read a phase back to
 *    change what it does — the rule `world/buildProfile.ts` states for the
 *    build's timer, and the reason both are safe to leave switched on.
 *  - **A row's WALL CLOCK is the interval its own spans fill.** `frameMs[i]`,
 *    `phases[i]` and `present[i]` all describe the frame that started at
 *    `frameAt[i]` — which costs a write into the PREVIOUS row, because a
 *    frame's own interval is not known until the next one opens. See
 *    `endFrame`, where getting this wrong cost `FINDINGS.md` §1 two
 *    milestones. Anything added here that is measured ACROSS a frame boundary
 *    owes the same care, and the failure mode is the bad one: not a crash, a
 *    confident wrong attribution.
 *  - **It SHIPS.** This is not behind `import.meta.env.DEV`, and that is the
 *    whole point of it: the frame is draw-call bound on hardware nobody here
 *    owns, and the devices worth measuring — a phone, a tablet, somebody
 *    else's laptop — are exactly the ones that will never run a dev server.
 *    Disarmed, every entry point returns on its first line and the ring is not
 *    allocated at all.
 *  - **Nothing allocates PER FRAME while it is recording.** Every array is
 *    sized once by `arm` and written by index thereafter; there is no
 *    per-frame object, no label string and no closure. That is not tidiness:
 *    GC was `FINDINGS.md` §1's leading suspect for the hitch this exists to
 *    find until its captures exonerated the collector, and a profiler that
 *    allocates per frame still muddies every capture with churn of its own.
 *    Captures and reports allocate freely — a capture is a deliberate act,
 *    not a frame — and that is why the report is a FILE of its own
 *    (`profileReport.ts`): the half that may allocate is no longer a method
 *    away from the half that may not, and nothing in this file builds one.
 *
 *    **There is exactly ONE allocation left in the recording path and it is
 *    per COLLECTION rather than per frame**: the sentinel object the GC watch
 *    re-registers each time one is collected (see `watchGc`). It is one empty
 *    object per GC event — at a scavenge every hundred milliseconds that is
 *    four bytes a second — and the alternative is an instrument that cannot see
 *    the collector at all, which is what let §1's captures clear it. Nothing
 *    else here may take that licence.
 *
 * **A BENCHMARK borrows the same ring, and asks three things of it nothing else
 * does** (`?bench=<map>`, `bench/BenchScript.ts`): a ring SIZED to its script
 * rather than to `CONFIG.profiling.frames` (`arm`'s second argument), so
 * nothing the run drew is ever lapped out of its capture; a SEGMENT label on
 * every row (`setSegments`, `setSegment`), so a capture can say what each
 * frame was showing; and `halt`, which stops the recording at the run's last
 * frame and leaves the ring to be read — so `VIEW`, `SAVE` and `TRACE` all
 * hand over the run and nothing after it. A halted profiler is not armed and
 * costs what a disarmed one does; only its buffers are kept.
 *
 * **WHAT IT CAN AND CANNOT SEE, because a table of plausible numbers is worse
 * than no table.** Three limits, each recorded into every capture rather than
 * left to prose:
 *
 *  - **The clock is coarse.** Chrome quantises `performance.now()` to 100 us
 *    unless the page is cross-origin isolated, and this one is not
 *    (`docker/default.conf.template` sets no COOP/COEP). Most phases below
 *    `render` cost under 120 us on real hardware (`docs/profiling.md`,
 *    "Reading a capture"), so a SINGLE frame's reading of a small phase is one
 *    grain or two and nothing in between. The mean over a window still
 *    converges — a phase boundary falls at a uniformly random offset within
 *    the grid, so the difference of
 *    two quantised stamps is unbiased across many frames — but a percentile of
 *    a sub-grain phase is quantisation noise wearing a statistic's clothes.
 *    `clock.grainMs` and `clock.belowGrain` are in every report so a reader can
 *    see which of its rows are real. **This answers "which phase", never "which
 *    function"**; a 3.5 us box query (`RayWorld`) is micro-benchmark
 *    territory and always will be.
 *  - **The frame is draw-call bound** (`docs/rendering.md`, "Why the frame is
 *    draw-call bound"), so the JS phases attribute the third of the frame
 *    that was never the problem and `render` is the enormous bar — and **two
 *    spans open INSIDE it**: `drawWorld` and `glow`. They are bracketed by the
 *    frame itself (`core/SceneFrame.ts`, `BABYLON_EXIT.md` X5.4g), because the
 *    boundaries they want are inside the frame's render and there is nowhere
 *    in `Game.ts` to put them; until X5.4g this file hung them off the
 *    frame's observables (`hookRender`; the scene's until X5.4f), and they
 *    were three with `shadowPass`, a Babylon shadow generator's map, which
 *    nothing opened after X5.3d and which report version 38 retired (a
 *    fourth, `drawOverlay`, held the rendering groups above 0 until X4.3d
 *    emptied them, retired with report version 24). Babylon's
 *    `SceneInstrumentation` counters — the draw count, the active meshes, the
 *    mesh walk, the render-target and particle times — rode beside them while
 *    the big bar was Babylon's; nothing raised them once the scene stopped
 *    rendering (X5.4f), and report version 38 retired them too.
 *
 *    **What they measure is CPU: the RECORDING of the frame's commands, not
 *    the work the GPU then does.** That is still the right thing to be
 *    watching — the whole of that measurement is that this frame is bound by
 *    the submission and not by the pixels — but a recording can read cheap
 *    while the GPU is saturated, and nothing on the CPU would say so. **GPU time is here
 *    now, and only when the boot asked for it** (`?gpu` — see `main.ts`,
 *    which is the only place it can act, because a device's features are
 *    fixed when the device is created and a required feature the adapter
 *    lacks makes `requestDevice` REJECT). That is why it is a boot flag
 *    rather than a setting, and why it costs a reload.
 *    **Both GPU counters are OURS** since `BABYLON_EXIT.md` X5.4g:
 *    `gpu.frame`, the whole frame, from before its first pass to after its
 *    last (`render/FrameTimer.ts`, two empty passes of its own bracketing the
 *    frame's one encoder), and `gpu.cull`, our renderer's culls, stamped on
 *    their own compute passes (`render/PassTimer.ts`), a part of `gpu.frame`
 *    — both attributed the same way (`GpuPassTimer`). Until X5.4g `gpu.frame`
 *    was Babylon's (`writeTimestamp` around its two encoders, which needed
 *    `--enable-unsafe-webgpu` in Chrome) and `gpu.mainPass` Babylon's
 *    main-pass counter, which timed nothing after X5.4f and which report
 *    version 38 retired. Measured cost of the flag: 130.0 fps against 129.9
 *    disarmed, which is nothing.
 *  - **The heap is usually FROZEN and the GC is only ever INFERRED.** Chrome
 *    rate-limits the bucketised `performance.memory` to one update every twenty
 *    minutes on purpose, so on a stock browser its reading does not move and a
 *    heap curve drawn from it would be a flat line read as "nothing is
 *    allocating". `probeHeapLive` settles that on ARMING, on the device, and
 *    `memory.heapLive` carries the answer into every capture; where it is
 *    false there is no series and the report says so rather than implying a
 *    number. Collections themselves are watched a second way that works
 *    everywhere — a `FinalizationRegistry` sentinel, which fires AFTER the
 *    collection and is best-effort by specification — so `memory.gcEvents` is
 *    "a collection happened near here", never "the pause was this collection".
 *    Read it against the frame it lands on: a hitch whose phases do not add up
 *    to its wall clock, with collections on it, is the GC pause §1 was looking
 *    for; the same hitch with none is not, and eliminating the leading suspect
 *    is worth as much as confirming it — it is how §1 cleared the collector.
 */
import { CONFIG } from "../config";
import { P, SLOTS } from "./profilePhases";
import {
  buildReport,
  buildTrace,
  type BenchFacts,
  type BlockFacts,
  type BodyFacts,
  type HullFacts,
  type PoolFacts,
  type ViewFacts,
  type LoafRecord,
  type ProfileGraphics,
  type ProfileReport,
  type ProfileRing,
  type ProfileSegment,
} from "./profileReport";
import { urlFlag } from "./urlOverrides";

/**
 * What the profiler reads of the canvas, once a row: the backing store's size
 * and the scaling level that made it of the window. Structural, so this file
 * imports no canvas — the game's `CanvasSurface` satisfies it (Babylon's
 * `WebGPUEngine` did until `BABYLON_EXIT.md` X5.4h), and `Game` hands it over
 * at `arm`.
 */
export interface RenderSurface {
  getRenderWidth(useScreen?: boolean): number;
  getRenderHeight(useScreen?: boolean): number;
  getHardwareScalingLevel(): number;
}

/**
 * The entry type that answers the one question the phases cannot.
 *
 * **The residue — wall clock minus `frame` minus `present` — is the rAF wait,
 * the compositor and the panel, and from inside the page those three cannot be
 * told apart. `long-animation-frame` splits it in two anyway**, because it is
 * the BROWSER's account of the same frame rather than ours: a long animation
 * frame is reported when the browser's own window — every task from the end of
 * the last frame's rendering to the end of this one's — runs over 50 ms, and
 * it names the scripts inside it.
 *
 * So a hitch with a long animation frame over it is the MAIN THREAD, busy with
 * something outside `Game.tick`, and `scripts` says what. A hitch with NONE
 * is a main thread that was idle, which puts the time outside the page
 * altogether — the compositor, the driver, the panel — and that is a real
 * answer rather than a gap. **The absence is the finding**, which is why
 * `loaf.supported` ships in every capture: on a browser that never reports
 * these, "no entry" must not be read as "the main thread was idle".
 */
const LOAF_TYPE = "long-animation-frame";

/**
 * `PerformanceLongAnimationFrameTiming` and its script records, declared here
 * because TypeScript's DOM lib does not carry them yet.
 *
 * Only the fields this file reads. Everything is optional-safe at runtime:
 * these are the browser's objects and an older Chrome may hand back fewer, so
 * every read below has a fallback rather than trusting the shape.
 */
interface LoafScript {
  readonly name?: string;
  readonly duration?: number;
  readonly invoker?: string;
  readonly invokerType?: string;
  readonly sourceURL?: string;
  readonly sourceFunctionName?: string;
}

interface LoafEntry {
  readonly startTime: number;
  readonly duration: number;
  readonly blockingDuration?: number;
  /**
   * When the browser began the RENDERING half of the frame — style, layout,
   * paint, commit. Absent or 0 on a frame that never rendered.
   *
   * **This is the field that says which kind of long frame it was**, and
   * leaving it out cost a capture: a 263.5 ms window carrying 8.7 ms of script
   * and zero blocking is not a busy main thread, and without this there is no
   * way to tell a frame that WAITED to be rendered from one whose rendering
   * took a quarter of a second.
   */
  readonly renderStart?: number;
  readonly scripts?: readonly LoafScript[];
}

/** How long a name from a long animation frame may be, in characters. */
const LOAF_NAME_CAP = 120;

/**
 * The shortest true thing that can be said about which script the browser
 * blamed.
 *
 * Four fallbacks deep because the fields are populated unevenly — a handler
 * has an `invoker` and often no `sourceFunctionName`, a module's top level
 * has the reverse — and a record that came back "undefined" would be the one
 * kind of answer worse than no record at all. The URL is reduced to its last
 * segment: this build's files are content-hashed and the whole path is a
 * hundred characters of nothing.
 */
function describeScript(s: LoafScript): string {
  const who =
    s.sourceFunctionName || s.invoker || s.name || s.invokerType || "?";
  const file = s.sourceURL ? s.sourceURL.replace(/[?#].*$/, "").replace(/^.*[/]/, "") : "";
  const out = file ? `${who} @ ${file}` : who;
  return out.length > LOAF_NAME_CAP ? out.slice(0, LOAF_NAME_CAP - 1) + "…" : out;
}

/**
 * One of OUR GPU timers, as this file reads it — the frame's
 * (`render/FrameTimer.ts`, `gpu.frame`) and the culls' (`render/PassTimer.ts`,
 * `gpu.cull`) — structural, so nothing here imports the renderer. Both are
 * attributed by two transitions: a row is CLAIMED by the frame being timed,
 * before `endFrame` polls it, and `count` moving is the reading landing, a
 * map-async round trip later. The cull timer's claim is `inFlight`, which
 * turns true during the frame's render; the frame timer's is `timing`
 * (`GpuFrameTimer`). One reading is in flight at a time, so both are
 * SAMPLED. They are ours and public, so nothing here is guarded: each is
 * there under `?gpu` on a device with `timestamp-query`, or it is null.
 */
interface GpuPassTimer {
  readonly ms: number;
  readonly count: number;
  readonly inFlight: boolean;
}

/**
 * The frame's timer, which also says whether the encoder being recorded now
 * is the one its next reading measures (`timing`: it was OPEN for it). That,
 * and never `inFlight`, is what claims a row: the timer runs all session
 * under `?gpu`, so at the first `endFrame` after an `arm` it may be reading
 * back an EARLIER frame, one the ring never recorded — `inFlight` is true
 * then, and the frame being recorded was not timed at all, its encoder's
 * `open` refused.
 */
interface GpuFrameTimer extends GpuPassTimer {
  readonly timing: boolean;
}

/**
 * The device's create methods, by the kind each makes — an index into
 * `profileReport.ts`'s `CREATED`, which is where the kind gets its name and
 * its argument. An ASYNC render pipeline
 * is still a render pipeline — Babylon 9.28's `preWarmPipeline` makes those, and
 * a warm-up built on it should show up here as creations BEFORE the round.
 */
const DEVICE_CREATES: readonly (readonly [string, number])[] = [
  ["createRenderPipeline", 0],
  ["createRenderPipelineAsync", 0],
  ["createComputePipeline", 1],
  ["createComputePipelineAsync", 1],
  ["createShaderModule", 2],
];

export class FrameProfile {
  /**
   * The one test every entry point makes first.
   *
   * A plain field rather than a getter over the buffers: disarmed, the whole
   * cost of this class is `if (!this.on) return;` at ~26 call sites a frame,
   * which is what lets it ship switched off instead of being compiled out.
   */
  private on = false;

  /** Allocated by `arm`, released by `disarm`. Null is the disarmed state. */
  private startMs: Float32Array | null = null;
  private durMs: Float32Array | null = null;
  private entered: Uint8Array | null = null;

  /** Per-frame context, one entry per ring slot. */
  private frameAt: Float64Array | null = null;
  private frameMs: Float32Array | null = null;
  private px: Float32Array | null = null;
  private py: Float32Array | null = null;
  private pz: Float32Array | null = null;
  private botsAlive: Uint16Array | null = null;
  /**
   * The size each row was DRAWN at, and the window it was drawn in.
   *
   * `canvasW`/`canvasH` are the backing store, read as `getRenderWidth(true)`
   * — the canvas itself, never a render target that happens to be bound —
   * which is a property read and no layout. `windowW`/`windowH` are the
   * window's CSS size as `watchWindow` last read it (`winW`/`winH`: on a
   * `resize` and once a second), because `innerWidth` read per frame can
   * flush a layout.
   * `scaleAt` is the engine's hardware scaling level, which is what turns the
   * one into the size the other should have been (`ProfileReport.viewport`).
   * All five are ASSIGNED on every row, so a lap leaves nothing behind.
   *
   * **Read at save, the size answered for the wrong moment**: three phone
   * captures in one session all read an 832x384 window, one with the
   * 1170x540 canvas that window makes and two with a 1170x618 one it does
   * not, and nothing said which size their runs had been drawn at.
   */
  private canvasW: Uint16Array | null = null;
  private canvasH: Uint16Array | null = null;
  private windowW: Uint16Array | null = null;
  private windowH: Uint16Array | null = null;
  private scaleAt: Float64Array | null = null;
  /** `innerWidth`/`innerHeight` as `watchWindow` last read them. */
  private winW = 0;
  private winH = 0;
  /**
   * Which segment of a benchmark each row was, as an index into `segments`
   * plus one — 0 is a row nobody labelled, which is every row outside a
   * benchmark. Written by `endFrame` from `segmentNow`, like the context.
   */
  private segmentAt: Uint8Array | null = null;

  /**
   * The used heap at the end of each frame in MB, and the collections the
   * sentinel reported during it.
   *
   * `heapMb` stays null where the arming probe found the reading frozen, which
   * is the stock-browser case — a series of one repeated number is worse than
   * no series, because it reads as an idle heap.
   */
  private heapMb: Float32Array | null = null;
  private gcAt: Uint8Array | null = null;

  /**
   * The browser's own account of each frame — see `LOAF_TYPE`.
   *
   * Three parallel arrays and not a list, for the reason everything else here
   * is one: a row's reading has to be free to write from a callback that may
   * fire on any frame. The STRINGS cannot go in a typed array and are kept
   * separately, bounded, in `loafWorst`.
   */
  private loafMs: Float32Array | null = null;
  private loafBlockMs: Float32Array | null = null;
  private loafScriptMs: Float32Array | null = null;
  private loafRenderMs: Float32Array | null = null;
  /**
   * Which rows are the HEAD of a long frame rather than merely covered by one.
   *
   * **A window marks every row it overlaps, so the marks cannot be added up.**
   * Summing `loafMs` over marked rows counts one 244 ms window once per row it
   * touched: measured on a real capture, 26 entries spread over 50 rows were
   * reported as 11,246 ms of long frames inside a 22,150 ms window — 51% of the
   * wall clock, which is not a number, it is the same milliseconds counted
   * twice. Entries do not overlap each other, so the earliest row each one
   * touches identifies it, and `loafFacts` sums over THOSE.
   */
  private loafHead: Uint8Array | null = null;

  /**
   * Whole-frame GPU time, on the rows that were actually measured.
   *
   * **Zero means NOT MEASURED and never "the GPU was instant"**, the same rule
   * `loafMs` and `heapLive` obey. One reading is in flight at a time and it
   * lands a frame or more after the frame it describes, so most rows keep
   * their zero; `gpu.frame.samples` says how many in the window got one.
   */
  private gpuFrameMs: Float32Array | null = null;
  /** Our culls' GPU time (`gpu.cull`), on the rows that were measured. */
  private gpuCullMs: Float32Array | null = null;
  /** Our renderer's pass timer, pushed by `Game` once; null without `?gpu`. */
  private cullTimer: GpuPassTimer | null = null;
  /** The row a cull reading is in flight for, and the timer's count then. */
  private cullPendingRow = -1;
  private cullLastCount = -1;
  /** The frame's GPU timer (`render/FrameTimer.ts`), pushed by `Game` once; null without `?gpu`. */
  private frameTimer: GpuFrameTimer | null = null;
  /** The row a whole-frame measurement is in flight for, and the timer's count then. */
  private gpuPendingRow = -1;
  private gpuLastCount = -1;
  /** Set from `?gpu` on arming — see `main.ts`, which is where it has to act. */
  private gpuRequested = false;

  /**
   * Creations per row, by kind, and the time spent inside the calls.
   *
   * Counted against `cursor` at the moment of the call — the frame being
   * recorded — and cleared when `endFrame` hands the row to the next lap, the
   * same handover every other per-row reading gets. See `CREATED`
   * (`profileReport.ts`) on why this is a count and not a span.
   */
  private madeRender: Uint16Array | null = null;
  private madeCompute: Uint16Array | null = null;
  private madeModules: Uint16Array | null = null;
  private madeCallMs: Float32Array | null = null;

  /**
   * The newest `CONFIG.profiling.creationsKept` creations, whole, as a ring of
   * parallel arrays sized on arming.
   *
   * **Filed by absolute TIME rather than by ring row**, and mapped to a row only
   * when a capture is built: a creation can land between `endFrame` and the next
   * `beginFrame`, where the row it belongs to has no stamp yet, and time is the
   * one coordinate both rings share without an identity pair. The label is
   * a REFERENCE the descriptor already holds — storing it allocates nothing,
   * which is what lets this live inside the recording path.
   */
  private logT: Float64Array | null = null;
  private logKind: Uint8Array | null = null;
  private logMs: Float32Array | null = null;
  private logLabel: string[] = [];
  private logCursor = 0;
  private logFilled = 0;
  /** Whether the device's create methods are wrapped. */
  private createObserved = false;

  /**
   * Whether this browser reports long animation frames at all.
   *
   * **It ships in every capture and it is not a detail.** The reading this
   * probe exists for is an absence — a hitch with no long frame over it is a
   * hitch the main thread was idle through — and on a browser that reports
   * none, every hitch looks like that. Probed once on arming, exactly as
   * `heapLive` is and for the same reason.
   */
  private loafSupported = false;

  /**
   * The worst long animation frames, with the script each one blamed.
   *
   * `at`/`when` is the ring row and the stamp that was in it, the same pair
   * `hitchAt`/`hitchWhen` carries and for the same reason: a ring index is an
   * identity only until the ring laps, and a stale record would put a real
   * script's name under a frame that never ran it.
   */
  private loafWorst: LoafRecord[] = [];

  private heapLive = false;
  /**
   * Collections the sentinel has reported since the last `endFrame` closed.
   *
   * **There is deliberately no running TOTAL beside it.** One was here, and it
   * was a bug of exactly the shape this file warns about elsewhere: it counted
   * every collection since ARMING while `memory.gcPerSec` divided it by the
   * WINDOW's seconds, so any session outliving its own ring reported a rate it
   * had never run at. Caught on a real capture — 7 events over a 36.18 s window
   * whose ring held 4, an overstatement of 75% on the number that rides the
   * chip's flash line. The count is summed from `gcAt` at capture time now,
   * over the same frames as every other figure in the report.
   */
  private gcPending = 0;
  private gcReg: FinalizationRegistry<number> | null = null;

  /**
   * The frame time this device has lately been managing, and the bar a frame
   * has to clear to be filed as a hitch.
   *
   * **The baseline tracks the FLOOR rather than the mean**, which is why it
   * rises and falls at different rates — see `CONFIG.profiling.baselineRise`.
   * Zero is "not seeded yet", and the first frame seeds it outright rather
   * than being averaged against nothing.
   */
  private baselineMs = 0;
  // Annotated, because `CONFIG` is `as const` and an inferred `24` cannot be
  // reassigned — the convention `CLAUDE.md` states for exactly this shape.
  private hitchBarMs: number = CONFIG.profiling.hitchMs;

  /** Open spans, as absolute stamps. Zero means "not open". */
  private readonly openAt = new Float64Array(SLOTS);

  /**
   * The hooks `arm` installed — the device's create methods, the window's
   * size, the long-frame observer — as teardowns.
   *
   * Built once by `arm` and run by `disarm`, which is what keeps the promise
   * the header makes about a disarmed profiler: not merely that its entry
   * points return early, but that it is not ON the device or the window at
   * all.
   */
  private unhook: (() => void)[] = [];

  /** Where the next frame goes, and how many the ring holds. */
  private cursor = 0;
  private filled = 0;
  private frameT0 = 0;
  /**
   * Whether the frame being closed was OPENED on this ring. `arm` is reached
   * from inside a frame — the settings screen's toggle, and a benchmark's
   * first frame off the bake — so the first `endFrame` after it closes a frame
   * whose `beginFrame` ran before there was a ring (or on the last one), and
   * `frameT0` is whatever that left: 0 on a first arm. Filed, that row put a
   * `frameAt` of 0 at the head of the ring and `window.seconds` read as the
   * page's lifetime until the ring lapped. Such a frame is dropped instead.
   */
  private frameOpen = false;

  /**
   * When `endFrame` finished, and the ring row it had just written — the two
   * facts `presented` needs and cannot get for itself.
   *
   * `lastSlot` exists because `endFrame` ADVANCES `cursor`, and the loop's
   * submit comes after that: by then `cursor` names the frame about to start,
   * and writing `present` there would file it one frame late, forever. -1
   * until a frame has closed, which is the state an arm in the middle of a
   * frame leaves behind.
   */
  private tickEndAt = 0;
  private lastSlot = -1;

  /**
   * Frames over `CONFIG.profiling.hitchMs`, oldest first, as a ring INDEX and
   * the stamp that was in it.
   *
   * **The stamp is not redundant and leaving it out was a bug.** A ring index
   * is only an identity until the ring laps: a hitch noted at startup and left
   * in this list is, three thousand frames later, pointing at whatever frame
   * has since been written over it — and what a capture would report is that
   * frame's phases under the old one's cost. Two parallel arrays rather than a
   * list of pairs, because this is written from `endFrame` and nothing there
   * may allocate.
   */
  private hitchAt: number[] = [];
  private hitchWhen: number[] = [];

  /** The canvas `arm` was handed, read once a row. Null disarmed. */
  private surface: RenderSurface | null = null;

  private grainMs = 0;
  private overheadUs = 0;

  /** Which map the ring holds. Pushed by `Game`, since nothing here may ask. */
  private mapId = "?";
  /** The round's seed, pushed by `Game` like the map. See `ProfileReport.seed`. */
  private seed: number | null = null;
  /** Where the simulation runs, pushed by `Game` once. See `ProfileReport.simMode`. */
  private simMode: "worker" | "page" | null = null;
  /**
   * The labels a benchmark's rows may carry, and the one the frame being
   * recorded carries (an index into the list plus one, 0 for none). Pushed by
   * `Game`, which has them from `BenchScript`; nothing here knows a script.
   */
  private segments: readonly ProfileSegment[] = [];
  private segmentNow = 0;
  /** What a benchmark says about its own run, pushed by `Game` before its capture. */
  private bench: BenchFacts | null = null;
  /**
   * Reads our renderer's take of the blocks, pushed by `Game` once and asked
   * only at a capture. See `ProfileReport.blocks`.
   */
  private blocksOf: (() => BlockFacts) | null = null;
  /**
   * `blocksOf`'s answer as the ring HALTED, which a halted ring's capture
   * reports: a benchmark's capture is often saved after its map is gone,
   * when the live answer is the menu's nothing. Null while recording.
   */
  private blocksAtHalt: BlockFacts | null = null;
  /**
   * Reads our renderer's bodies, pushed by `Game` once and asked only at a
   * capture or a halt, as `blocksOf` is. See `ProfileReport.bodies`.
   */
  private bodiesOf: (() => BodyFacts) | null = null;
  /** `bodiesOf`'s answer as the ring HALTED — `blocksAtHalt`'s reason. Null while recording. */
  private bodiesAtHalt: BodyFacts | null = null;
  /** Reads our renderer's hulls, as `bodiesOf` reads its bodies. See `ProfileReport.hulls`. */
  private hullsOf: (() => HullFacts) | null = null;
  /** `hullsOf`'s answer as the ring HALTED. Null while recording. */
  private hullsAtHalt: HullFacts | null = null;
  /** Reads our renderer's weapon, as `bodiesOf` reads its bodies. See `ProfileReport.view`. */
  private viewOf: (() => ViewFacts) | null = null;
  /** `viewOf`'s answer as the ring HALTED. Null while recording. */
  private viewAtHalt: ViewFacts | null = null;
  /** Reads our renderer's effect pools, as `bodiesOf` reads its bodies. See `ProfileReport.pools`. */
  private poolsOf: (() => PoolFacts) | null = null;
  /** `poolsOf`'s answer as the ring HALTED. Null while recording. */
  private poolsAtHalt: PoolFacts | null = null;
  /**
   * How many rows the ring holds — `CONFIG.profiling.frames`, or what `arm`
   * was asked for. Fixed between an `arm` and the next.
   */
  private cap: number = CONFIG.profiling.frames;
  /** The graphics in force, and since when. Pushed by `Game` like the map. */
  private graphics: ProfileGraphics | null = null;
  private graphicsAt = 0;

  /** The last capture, kept so a script (or a failed clipboard) can fetch it. */
  private lastReport: ProfileReport | null = null;

  get armed(): boolean {
    return this.on;
  }

  /** The ring's current depth, in seconds. What the chip shows. */
  get seconds(): number {
    if (!this.on || this.filled === 0 || !this.frameAt) return 0;
    const cap = this.capacity;
    const oldest = this.frameAt[(this.cursor - this.filled + cap) % cap];
    const newest = this.frameAt[(this.cursor - 1 + cap) % cap];
    return Math.max(0, (newest - oldest) / 1000);
  }

  get hitchCount(): number {
    return this.hitchAt.length;
  }

  private get capacity(): number {
    return this.cap;
  }

  /** Which map the ring is recording. Set by `Game.installMap`. */
  setMap(id: string): void {
    this.mapId = id;
  }

  /**
   * Which round seed the ring is recording, or null where this client did not
   * decide one. Set by `Game.buildRound`.
   */
  setSeed(seed: number | null): void {
    this.seed = seed;
  }

  /**
   * How a capture reads our renderer's take of the map's blocks — asked at
   * the capture, or at `halt` for a halted ring's, never per frame. Set by
   * `Game` at construction.
   */
  setBlocks(read: () => BlockFacts): void {
    this.blocksOf = read;
  }

  /**
   * How a capture reads our renderer's bodies — asked at the capture, or at
   * `halt` for a halted ring's, never per frame. Set by `Game` at
   * construction. The reader hands back a COPY: a halted ring keeps it.
   */
  setBodies(read: () => BodyFacts): void {
    this.bodiesOf = read;
  }

  /** How a capture reads our renderer's hulls — `setBodies`' terms. */
  setHulls(read: () => HullFacts): void {
    this.hullsOf = read;
  }

  /** How a capture reads our renderer's weapon — `setBodies`' terms. */
  setView(read: () => ViewFacts): void {
    this.viewOf = read;
  }

  /** How a capture reads our renderer's effect pools (`BABYLON_EXIT.md` X4.4b) — `setBodies`' terms. */
  setPools(read: () => PoolFacts): void {
    this.poolsOf = read;
  }

  /**
   * Our renderer's pass timer, whose readings are `gpu.cull` — null where
   * none was built (no `?gpu`, or no `timestamp-query`). Set by `Game` at
   * construction; polled every frame.
   */
  setCullTimer(timer: GpuPassTimer | null): void {
    this.cullTimer = timer;
  }

  /**
   * The frame's GPU timer (`render/FrameTimer.ts`), whose readings are
   * `gpu.frame` — null where none was built. Set by `Game` at construction;
   * polled every frame, as the cull timer is.
   */
  setFrameTimer(timer: GpuFrameTimer | null): void {
    this.frameTimer = timer;
  }

  /**
   * Which thread the page's own local match steps its core on
   * (`MatchHost.mode`). Set by `Game` at construction, and again when a lost
   * host is replaced.
   */
  setSimMode(mode: "worker" | "page"): void {
    this.simMode = mode;
  }

  /**
   * The labels a benchmark's rows will carry, in its own order. An empty list
   * is a ring nobody is labelling, which is the state `arm` leaves.
   */
  setSegments(list: readonly ProfileSegment[]): void {
    this.segments = list;
    this.segmentNow = 0;
  }

  /**
   * Which of `setSegments`' labels the frame being recorded is, or -1 for
   * none. Read by `endFrame`, so a frame may set it anywhere inside itself.
   */
  setSegment(index: number): void {
    this.segmentNow = index >= 0 && index < this.segments.length ? index + 1 : 0;
  }

  /** What a benchmark says about its run — see `ProfileReport.bench`. */
  setBench(facts: BenchFacts | null): void {
    this.bench = facts;
  }

  /**
   * Which graphics the frames are being drawn with. Set by
   * `Game.applySettings`, armed or not — it runs on a settings change rather
   * than per frame, and a ring armed later still wants to know how long the
   * settings have stood.
   *
   * The clock restarts only when a VALUE moves: `applySettings` runs on every
   * change to every setting, and a look-speed nudge is not a new configuration.
   */
  setGraphics(g: ProfileGraphics): void {
    if (this.graphics && sameGraphics(this.graphics, g)) return;
    this.graphics = g;
    this.graphicsAt = performance.now();
  }

  /**
   * Allocates the ring, probes the clock, and starts recording.
   *
   * **The two probes run here rather than being constants**, because both
   * answers are properties of the DEVICE and this instrument's whole reason to
   * exist is that the interesting devices are ones nobody here has measured.
   * They cost a few milliseconds once, during a settings toggle — never in a
   * frame.
   */
  arm(surface: RenderSurface, frames: number = CONFIG.profiling.frames): void {
    if (this.on) return;
    // A HALTED ring is still held, and arming again replaces it.
    if (this.frameAt) this.disarm();
    this.blocksAtHalt = null;
    this.bodiesAtHalt = null;
    this.hullsAtHalt = null;
    this.viewAtHalt = null;
    this.poolsAtHalt = null;
    this.cap = Math.max(2, Math.floor(frames));
    const n = this.capacity;
    this.startMs = new Float32Array(n * SLOTS);
    this.durMs = new Float32Array(n * SLOTS);
    this.entered = new Uint8Array(n * SLOTS);
    this.frameAt = new Float64Array(n);
    this.frameMs = new Float32Array(n);
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.botsAlive = new Uint16Array(n);
    this.canvasW = new Uint16Array(n);
    this.canvasH = new Uint16Array(n);
    this.windowW = new Uint16Array(n);
    this.windowH = new Uint16Array(n);
    this.scaleAt = new Float64Array(n);
    this.segmentAt = new Uint8Array(n);
    this.segments = [];
    this.segmentNow = 0;
    this.bench = null;
    this.gcAt = new Uint8Array(n);
    this.loafMs = new Float32Array(n);
    this.loafBlockMs = new Float32Array(n);
    this.loafScriptMs = new Float32Array(n);
    this.loafRenderMs = new Float32Array(n);
    this.loafHead = new Uint8Array(n);
    this.gpuFrameMs = new Float32Array(n);
    this.gpuCullMs = new Float32Array(n);
    this.madeRender = new Uint16Array(n);
    this.madeCompute = new Uint16Array(n);
    this.madeModules = new Uint16Array(n);
    this.madeCallMs = new Float32Array(n);
    const logCap = CONFIG.profiling.creationsKept;
    this.logT = new Float64Array(logCap);
    this.logKind = new Uint8Array(logCap);
    this.logMs = new Float32Array(logCap);
    this.logLabel = new Array<string>(logCap).fill("");
    this.logCursor = 0;
    this.logFilled = 0;
    this.gpuPendingRow = -1;
    this.gpuLastCount = -1;
    this.cullPendingRow = -1;
    this.cullLastCount = -1;
    // Read here rather than passed in: `main.ts` acts on this flag at device
    // creation and cannot reach an instrument that is armed later, and a
    // capture has to be able to tell "nobody asked" from "the adapter said no".
    this.gpuRequested = urlFlag("gpu");
    this.loafWorst = [];
    this.cursor = 0;
    this.filled = 0;
    this.hitchAt = [];
    this.hitchWhen = [];
    this.openAt.fill(0);
    this.frameOpen = false;
    this.baselineMs = 0;
    this.hitchBarMs = CONFIG.profiling.hitchMs;
    this.gcPending = 0;

    this.surface = surface;
    // The spans inside `render` are the frame's own brackets
    // (`SceneFrame.timeWith`) and `present` the loop's (`presented`), so
    // nothing hangs off a frame here: what is hooked is the device and the
    // window.
    this.hookCreation();
    this.watchWindow();

    this.on = true;
    this.grainMs = probeGrain();
    this.overheadUs = this.probeOverhead();
    // The third probe, and it answers a question about the BROWSER rather than
    // about the device's speed: whether the heap counter moves at all here.
    // Only if it does is the per-frame read worth taking — see the header.
    this.heapLive = probeHeapLive();
    this.heapMb = this.heapLive ? new Float32Array(n) : null;
    this.watchGc();
    // The fourth probe, and the only one that asks the BROWSER rather than the
    // device. Registered after `on` because its callback returns on that flag.
    this.watchLoaf();
    // The probes wrote into slot 0 of the ring. Start clean.
    this.durMs.fill(0);
    this.entered.fill(0);
  }

  /**
   * Stops recording and KEEPS the ring, to be read — the end of a benchmark.
   *
   * Everything that hangs off the device and the window comes off,
   * exactly as `disarm` takes it off, so a halted profiler costs what a
   * disarmed one does. What stays is the ring and the facts pushed into it,
   * which is what lets `capture` and `trace` keep answering about the run —
   * and only the run, since nothing after this line is recorded. `armed` is
   * false from here; `arm` replaces the ring and `disarm` releases it.
   *
   * The row in flight when this is called is never closed, and that is
   * correct rather than lost: a row's wall clock is written by the frame
   * after it, so a halt mid-frame leaves the last COMPLETED row as the one
   * `buildReport` already drops for want of an interval.
   */
  halt(): void {
    if (!this.on) return;
    this.on = false;
    // The run's last frame is the one the blocks, the bodies, the hulls, the
    // weapon and the pools are reported at.
    this.blocksAtHalt = this.blocksOf?.() ?? null;
    this.bodiesAtHalt = this.bodiesOf?.() ?? null;
    this.hullsAtHalt = this.hullsOf?.() ?? null;
    this.viewAtHalt = this.viewOf?.() ?? null;
    this.poolsAtHalt = this.poolsOf?.() ?? null;
    for (const off of this.unhook) off();
    this.unhook = [];
    this.tickEndAt = 0;
  }

  /** Stops recording and gives the memory back. The last report survives. */
  disarm(): void {
    if (!this.on && !this.frameAt) return;
    this.on = false;
    for (const off of this.unhook) off();
    this.unhook = [];
    this.tickEndAt = 0;
    this.lastSlot = -1;
    this.surface = null;
    this.startMs = null;
    this.durMs = null;
    this.entered = null;
    this.frameAt = null;
    this.frameMs = null;
    this.px = null;
    this.py = null;
    this.pz = null;
    this.botsAlive = null;
    this.canvasW = null;
    this.canvasH = null;
    this.windowW = null;
    this.windowH = null;
    this.scaleAt = null;
    this.segmentAt = null;
    this.segments = [];
    this.segmentNow = 0;
    this.bench = null;
    this.heapMb = null;
    this.gcAt = null;
    this.loafMs = null;
    this.loafBlockMs = null;
    this.loafScriptMs = null;
    this.loafRenderMs = null;
    this.loafHead = null;
    this.gpuFrameMs = null;
    this.gpuCullMs = null;
    this.madeRender = null;
    this.madeCompute = null;
    this.madeModules = null;
    this.madeCallMs = null;
    this.logT = null;
    this.logKind = null;
    this.logMs = null;
    this.logLabel = [];
    this.logCursor = 0;
    this.logFilled = 0;
    // The wrappers came off with `unhook` above; this only says so.
    this.createObserved = false;
    this.gpuPendingRow = -1;
    this.gpuLastCount = -1;
    this.cullPendingRow = -1;
    this.cullLastCount = -1;
    this.gpuRequested = false;
    this.loafWorst = [];
    this.loafSupported = false;
    this.hitchAt = [];
    this.hitchWhen = [];
    // The registry is dropped rather than unregistered: a sentinel already in
    // flight has no token and cannot be taken back, and its callback returns on
    // `this.on` like every other entry point here.
    this.gcReg = null;
  }

  /** Opens the frame. Called first thing in `Game.tick`. */
  beginFrame(): void {
    if (!this.on) return;
    this.frameOpen = true;
    this.frameT0 = performance.now();
    this.openAt.fill(0);
    this.openAt[0] = this.frameT0;
  }

  /**
   * Opens a span.
   *
   * A slot already open is simply re-opened, and a span never closed is never
   * recorded — which is what makes this safe at the sites in `Game` that sit on
   * an early return. `updateWorld` returns on a winner and again on a networked
   * round; both leave `world` unentered for that frame rather than leaking a
   * stamp into the next one, because `beginFrame` clears the table.
   */
  begin(slot: number): void {
    if (!this.on) return;
    this.openAt[slot] = performance.now();
  }

  /** Closes a span and records it. A slot that was never opened is ignored. */
  end(slot: number): void {
    if (!this.on) return;
    const t0 = this.openAt[slot];
    if (t0 === 0) return;
    this.openAt[slot] = 0;
    const t1 = performance.now();
    const at = this.cursor * SLOTS + slot;
    // Relative to the frame, so the trace export can nest these without
    // storing an absolute stamp per span.
    this.startMs![at] = t0 - this.frameT0;
    this.durMs![at] = t1 - t0;
    this.entered![at] = 1;
  }

  /**
   * Closes a span that may open MORE THAN ONCE in a frame, adding to whatever
   * the frame already has in that slot.
   *
   * **The frame's two spans inside `render` need this** (`SceneFrame`'s
   * `drawWorld`, closed at the glow's work and again after the draw phase —
   * the second a no-op when the first ran), which is the whole reason it is a
   * second method rather than `end` growing a flag: a span entered more than
   * once a frame would report the LAST of its pieces as its whole cost.
   *
   * **`entered` is what says "first this frame", and it is sound because
   * `endFrame` clears the slots of the frame it is about to overwrite** — the
   * write that stops a skipped phase flying the previous lap's flag. So the
   * first close of a frame stamps the start and the rest add to the duration,
   * and `startMs` stays the start of the FIRST piece, which is what the trace
   * export wants: the pieces of one of these phases are contiguous in the
   * frame's order, so a flame chart draws one bar in the right place.
   */
  endAdd(slot: number): void {
    if (!this.on) return;
    const t0 = this.openAt[slot];
    if (t0 === 0) return;
    this.openAt[slot] = 0;
    const t1 = performance.now();
    const at = this.cursor * SLOTS + slot;
    if (this.entered![at] === 1) {
      this.durMs![at] += t1 - t0;
      return;
    }
    this.startMs![at] = t0 - this.frameT0;
    this.durMs![at] = t1 - t0;
    this.entered![at] = 1;
  }

  /**
   * Files a step's whole timing row (`SimCore.timing`, the simulation core's)
   * in ONE call: the step into `root`, and each
   * phase the step reached into `slots[i]` — a span measured ELSEWHERE, by
   * whoever ran it, on this file's own clock. The row may already be a SUM
   * of steps (`addStepTiming` — a benchmark's lead steps the core several
   * times a frame, and the page files them as one row); like `endAdd`, a
   * slot filed twice in a frame ADDS too, and keeps the first piece's start
   * for the trace.
   *
   * **One call with objects in, rather than a call per phase with doubles in**,
   * because a double handed to a call that is not inlined is a heap number,
   * and the filing runs once a frame — the tier that does not inline
   * (`docs/profiling.md`, "Finding WHO allocates"). Measured on Sarab, a
   * call per phase was ~660 B a frame, the profiler's own recording path
   * breaking its own rule. Here the doubles go from the row's typed arrays
   * into the ring's without crossing a call.
   */
  fileTiming(
    root: number,
    slots: readonly number[],
    t: { readonly start: number; readonly total: number; readonly at: Float64Array; readonly ms: Float64Array },
  ): void {
    if (!this.on || !this.frameOpen || t.total < 0) return;
    const row = this.cursor * SLOTS;
    const entered = this.entered!;
    const dur = this.durMs!;
    const start = this.startMs!;
    const base = t.start - this.frameT0;
    let at = row + root;
    if (entered[at] === 1) dur[at] += t.total;
    else {
      start[at] = base;
      dur[at] = t.total;
      entered[at] = 1;
    }
    for (let i = 0; i < slots.length; i++) {
      if (t.at[i] < 0) continue;
      at = row + slots[i];
      if (entered[at] === 1) {
        dur[at] += t.ms[i];
        continue;
      }
      start[at] = base + t.at[i];
      dur[at] = t.ms[i];
      entered[at] = 1;
    }
  }

  /**
   * Wraps the device's create methods so every pipeline and shader module lands
   * on the frame it was made in — the hook `FINDINGS.md` 1 asked for to settle
   * whether a hitch sits one or two frames after a creation.
   *
   * **The PROTOTYPE is wrapped, not Babylon's device field**: `GPUDevice` is the
   * one surface here that a Babylon upgrade cannot move, and the device the
   * engine already holds picks the wrapper up through its prototype. The
   * wrappers are taken off again by `disarm` like every other hook, so a
   * disarmed profiler is not on the device at all. Anything that wrapped the
   * same methods first (`plans/webgpu-ref/pipelines.mjs` does, in an init
   * script) is wrapped in turn and put back exactly as it was found.
   *
   * **A creation is named by its descriptor's LABEL alone** since report
   * version 38: every pipeline made in a round is our renderer's, labelled
   * where it is made, and the Babylon effect a pipeline built through
   * Babylon's cache was named by (a patch on
   * `WebGPUCacheRenderPipeline._buildRenderPipelineDescriptor`) names
   * nothing any more — no Babylon pipeline is made after the boot.
   *
   * One argument and no rest parameter on every wrapper: all five create
   * methods take a single descriptor, and `...args` would be an array per call.
   */
  private hookCreation(): void {
    const proto = (
      globalThis as unknown as { GPUDevice?: { prototype: Record<string, unknown> } }
    ).GPUDevice?.prototype;
    if (!proto) return;
    for (const [name, kind] of DEVICE_CREATES) {
      const orig = proto[name];
      if (typeof orig !== "function") continue;
      const make = orig as (this: unknown, desc: unknown) => unknown;
      // A `function`, not an arrow, because `this` must stay the DEVICE.
      const self = this;
      proto[name] = function wrapped(this: unknown, desc: unknown): unknown {
        if (!self.on) return make.call(this, desc);
        const t0 = performance.now();
        const out = make.call(this, desc);
        self.noteCreated(kind, t0, performance.now() - t0, desc);
        return out;
      };
      this.unhook.push(() => {
        proto[name] = orig;
      });
      this.createObserved = true;
    }

  }

  /**
   * Files one creation: a count on the row being recorded, and an entry in the
   * log. Nothing here builds a string — the one stored is a reference the
   * descriptor already held.
   */
  private noteCreated(kind: number, t0: number, callMs: number, desc: unknown): void {
    const i = this.cursor;
    const counts =
      kind === 0 ? this.madeRender! : kind === 1 ? this.madeCompute! : this.madeModules!;
    if (counts[i] < 0xffff) counts[i]++;
    this.madeCallMs![i] += callMs;

    const at = this.logCursor;
    this.logT![at] = t0;
    this.logKind![at] = kind;
    this.logMs![at] = callMs;
    const label = (desc as { label?: unknown } | null)?.label;
    this.logLabel[at] = typeof label === "string" ? label : "";
    this.logCursor = (at + 1) % this.logT!.length;
    if (this.logFilled < this.logT!.length) this.logFilled++;
  }

  /**
   * Where the player was and what was alive, pushed by `Game` once a frame.
   *
   * **Position is the field nobody expects to need and the one that pays.**
   * Block visibility, the merge blocks and the terrain patches are all keyed to
   * PLACE, so "which street was I standing in when it hitched" is most of the
   * diagnosis — and it is not recoverable from a stack of milliseconds.
   *
   * Four positional arguments and not one object, which is the header's
   * no-allocation rule reaching the signature: an object literal at a call site
   * inside the render loop is a per-frame allocation however briefly it lives.
   */
  context(x: number, y: number, z: number, botsAlive: number): void {
    if (!this.on) return;
    this.px![this.cursor] = x;
    this.py![this.cursor] = y;
    this.pz![this.cursor] = z;
    this.botsAlive![this.cursor] = botsAlive;
  }

  /**
   * Closes the frame, files what landed for it and advances the ring.
   *
   * Last line of `tick`, after the frame's render: what is read here is what
   * that render just did, and asking before it would report the previous
   * frame's.
   */
  endFrame(realDeltaMs: number): void {
    if (!this.on) return;
    // A frame armed part-way through — see `frameOpen`. Whatever its spans
    // wrote into the row is cleared, because the next frame reuses it and
    // only `endFrame` ever clears a row's flags.
    if (!this.frameOpen) {
      const at = this.cursor * SLOTS;
      this.entered!.fill(0, at, at + SLOTS);
      return;
    }
    this.frameOpen = false;
    this.end(0);
    const i = this.cursor;
    this.frameAt![i] = this.frameT0;
    this.segmentAt![i] = this.segmentNow;
    // **The interval that has just elapsed belongs to the row BEFORE this
    // one.** `Game.tick` reads the frame's delta on its FIRST line, so
    // `realDeltaMs` is `start(i) - start(i-1)` — the gap the PREVIOUS frame
    // filled with its tick and its submit. Written into row `i` it is read
    // against the spans of the frame only now beginning, and that is a
    // confident wrong answer rather than a missing one: measured on a real
    // capture, a 90.6 ms tick whose 86.6 ms was `drawWorld` arrived as a
    // 91.5 ms wall clock on the NEXT row, whose own tick was a healthy 9.5 —
    // so the instrument reported 82 ms "outside the game, no collection on
    // it", which is `FINDINGS.md` §1's signature exactly. Across those same
    // 3,000 frames the shift takes the residue's minimum from -60.5 ms to
    // +0.1 and its negative count from 133 to 0, and a negative residue is
    // impossible.
    //
    // `present` needed no such move and never had this bug: `presented`
    // already writes into `lastSlot`, for the same reason stated there.
    const prev = this.lastSlot;
    if (prev >= 0) this.frameMs![prev] = realDeltaMs;
    // This frame's own interval is not known until the next one closes, and
    // the row may still hold the previous lap's. `buildReport` drops the
    // newest row rather than reading this zero as an instant frame.
    this.frameMs![i] = 0;
    // The size this row was drawn at — see `canvasW`. A row with no surface
    // reads 0, which the report skips.
    const surface = this.surface;
    this.canvasW![i] = surface ? surface.getRenderWidth(true) : 0;
    this.canvasH![i] = surface ? surface.getRenderHeight(true) : 0;
    this.scaleAt![i] = surface ? surface.getHardwareScalingLevel() : 0;
    this.windowW![i] = this.winW;
    this.windowH![i] = this.winH;
    // The collections the sentinel reported since the last frame closed, and
    // the heap they left behind. `gcPending` is cleared here rather than in the
    // callback, so a collection that fires between two frames lands on the one
    // it interrupted.
    const gc = this.gcPending;
    this.gcPending = 0;
    this.gcAt![i] = gc > 255 ? 255 : gc;
    this.pollGpu(i);
    if (this.heapMb) this.heapMb[i] = usedHeapMb();

    // **The bar is RELATIVE, and this is the whole of why.** A fixed 24 ms is
    // every frame on a phone holding 30 fps, which floods the list, laps the
    // cap below every three seconds and leaves a capture's headline reaching
    // back three seconds instead of fifty — on precisely the device this
    // instrument was built to be carried to. See `CONFIG.profiling.hitchFactor`.
    //
    // Tested against the bar the frames BEFORE this one set, then the baseline
    // is moved: a hitch is a frame that cost much more than its neighbours, and
    // letting it vote on its own threshold first is the wrong question.
    if (prev >= 0 && realDeltaMs >= this.hitchBarMs) {
      // Against the frame that FILLED the interval — the row the delta was
      // just written into, not the one starting now. A list that named `i`
      // was naming the RECOVERY frame, which is the healthy one.
      this.hitchAt.push(prev);
      this.hitchWhen.push(this.frameAt![prev]);
      // Bounded, and it drops the OLDEST.
      if (this.hitchAt.length > CONFIG.profiling.hitchesKept * 4) {
        this.hitchAt.shift();
        this.hitchWhen.shift();
      }
    }
    if (this.baselineMs === 0) {
      // Seeded outright rather than averaged up from nothing, so a profiler
      // armed on a slow device has the right bar from its second frame.
      this.baselineMs = realDeltaMs;
    } else {
      // **The baseline resists only what the bar already calls an outlier**,
      // and is quick in BOTH directions otherwise. A hitch therefore lifts it
      // by a hundredth of its own size — a 682 ms frame against a 7.8 ms floor
      // moves it 6.7 ms — while an ordinary frame moves it most of the way, so
      // a device that genuinely changes speed (a heavy map installed under a
      // profiler armed back on the menu) is tracked in tens of frames instead
      // of hundreds. Resisting on `> baselineMs` instead would resist every
      // frame above the average, which is half of them, and take a step change
      // several seconds to follow.
      const rate =
        realDeltaMs >= this.hitchBarMs
          ? CONFIG.profiling.baselineRise
          : CONFIG.profiling.baselineFall;
      this.baselineMs += rate * (realDeltaMs - this.baselineMs);
    }
    this.hitchBarMs = Math.max(
      CONFIG.profiling.hitchMs,
      CONFIG.profiling.hitchFactor * this.baselineMs,
    );
    this.cursor = (i + 1) % this.capacity;
    if (this.filled < this.capacity) this.filled++;
    // The frame about to be overwritten must not leave its spans behind for the
    // next one to be read as its own: `end` writes `entered`, so a phase this
    // frame skips would otherwise still be flying the previous lap's flag.
    const next = this.cursor * SLOTS;
    this.entered!.fill(0, next, next + SLOTS);
    // **A long frame's numbers are cleared off the reused row for the same
    // reason, and leaving them was worse than leaving a span behind.**
    // `recordLoaf` writes a window's duration into every row it spans and only
    // when it BEATS what is already there, so a value left over from a previous
    // lap both survives for the life of the session and REFUSES the real
    // reading that should have displaced it. The install's long frames are the
    // biggest of any session and are never displaced by anything a round
    // produces, which is exactly the starvation `keepLoaf` already guards
    // `loaf.worst` against — but the ring had no such guard, so `loafFacts`
    // summed them into every capture the process ever took. Measured on three
    // captures minutes apart from one page load: an identical
    // `loaf.blockingMs` of 6406.9 in all three, inside windows whose every
    // recorded hitch reported `loafBlockMs: 0`, and a `totalMs` of 9.3 s in a
    // 22.1 s window. Both halves of that are wrong in the confident direction —
    // a window that never happened, and a genuine long frame suppressed by it,
    // which reads as "the main thread was idle" on a hitch where it was not.
    this.loafMs![this.cursor] = 0;
    this.loafBlockMs![this.cursor] = 0;
    this.loafScriptMs![this.cursor] = 0;
    this.loafRenderMs![this.cursor] = 0;
    this.loafHead![this.cursor] = 0;
    // The creation counts are incremented, never assigned, so a lap's leftovers
    // would add to the new frame's — and a creation that lands between this line
    // and the next `beginFrame` belongs to the frame about to open, which is
    // the row being cleared here.
    this.madeRender![this.cursor] = 0;
    this.madeCompute![this.cursor] = 0;
    this.madeModules![this.cursor] = 0;
    this.madeCallMs![this.cursor] = 0;
    // The GPU's readings are ASSIGNED to a row only when one lands for it,
    // so a row that is not measured on this lap would keep the last lap's —
    // a reading from another stretch of the session, filed in this window.
    this.gpuFrameMs![this.cursor] = 0;
    this.gpuCullMs![this.cursor] = 0;
    // …and the hitch this lap is about to overwrite stops being a hitch. The
    // list is in ring order, so the stale ones are always at the FRONT and this
    // is one comparison on nearly every frame. Without it the chip counts
    // hitches that no longer exist and a capture reports the wrong frame's
    // phases under an old frame's cost — see the field.
    while (this.hitchAt.length > 0 && this.frameAt![this.hitchAt[0]] !== this.hitchWhen[0]) {
      this.hitchAt.shift();
      this.hitchWhen.shift();
    }
    // The handover to `presented`, and it is the LAST line for a reason:
    // everything above is this instrument's own bookkeeping, and charging that
    // to the submit would be the profiler measuring itself.
    this.lastSlot = i;
    this.tickEndAt = performance.now();
  }

  /**
   * Closes `present` on the frame that has just been submitted — called by the
   * frame loop right after `FrameSubmit.submit` returns (`core/FrameLoop.ts`,
   * `BABYLON_EXIT.md` X5.4g), so the span is the end of the frame after
   * `tick`: the frame timer closed, the encoder finished, the one
   * `queue.submit`, then the timer's read-back begun (`mapAsync`, under
   * `?gpu`) and the next frame's encoder made, with the timer's opening pass
   * when it times that frame — as Babylon's `flushFramebuffer` made its next
   * encoders inside the same span. Until X5.4g it hung off the engine's
   * end-of-frame notification (`hookEngine`), after Babylon's `endFrame`.
   *
   * **The second place a bracket lives outside `Game.ts`, and for the
   * opposite reason to the frame's spans.** Those are boundaries INSIDE the
   * frame's render; this one is a boundary `Game` never sees at all, because
   * the submit runs after `tick` has returned. What it deliberately does NOT
   * cover is the wait for the next frame to start; that stays as the residue
   * between `frame` + `present` and the wall clock, and naming it would mean
   * claiming to know which of the compositor, the driver and the panel it
   * belonged to.
   *
   * **Written straight into the ring rather than through `end`, because the
   * cursor has already moved on.** `endFrame` is the last line of `tick` and
   * advances `cursor`; the submit comes after `tick` returns, so the row this
   * belongs to is `lastSlot` and not `cursor`. `endFrame` clears the NEXT
   * row's `entered` flags, never the one just written, so stamping it here
   * is safe.
   *
   * `tickEndAt` is zeroed on the way through so a second call inside one
   * frame cannot write twice — there is exactly one submit per frame, and
   * this costs one comparison to not depend on that.
   */
  presented(): void {
    if (!this.on) return;
    const t0 = this.tickEndAt;
    if (t0 === 0) return;
    this.tickEndAt = 0;
    const i = this.lastSlot;
    if (i < 0) return;
    const at = i * SLOTS + P.present;
    // Relative to that frame's own start, exactly as `end` does it, so the
    // trace export can lay this bar down beside `frame` rather than inside it.
    this.startMs![at] = t0 - this.frameAt![i];
    this.durMs![at] = performance.now() - t0;
    this.entered![at] = 1;
  }

  /**
   * Freezes the ring into a report. The capture gesture: the ring is lent to
   * `buildReport` (`profileReport.ts`), the half of the profiler that is
   * allowed to allocate.
   *
   * `full` carries the complete per-frame series, which is what the download is
   * for; the compact form is summary plus the worst frames, sized to survive a
   * phone's clipboard.
   */
  capture(reason: string, full = false): ProfileReport | null {
    // TWO frames, not one: a row's wall clock is written by the frame AFTER
    // it, so a ring holding one frame holds no COMPLETED frame at all.
    // The BUFFERS rather than `on`: a halted ring is still a ring to read.
    if (!this.frameAt || this.filled < 2) return null;
    const report = buildReport(this.ring(), reason, full);
    this.lastReport = report;
    return report;
  }

  /** The last capture, for a smoke script or a retry at the clipboard. */
  last(): ProfileReport | null {
    return this.lastReport;
  }

  /**
   * The ring as Chrome Trace Event JSON, centred on the worst frame it holds —
   * see `buildTrace` (`profileReport.ts`) on why it is centred and not the
   * tail. `maxFrames` is the window; `trace(3000)` is the whole ring.
   */
  trace(maxFrames = 600): string {
    // `< 2` for `capture`'s reason: the newest row has no wall clock yet.
    if (!this.frameAt || this.filled < 2) return "{}";
    return buildTrace(this.ring(), maxFrames);
  }

  /**
   * Lends the reporter everything it reads — see `ProfileRing`. Called only by
   * `capture` and `trace`, both of which return first unless the profiler
   * holds a ring (armed, or halted) with two frames in it. That is what entitles every `!` below: in that
   * state nothing here is null but the heap series.
   */
  private ring(): ProfileRing {
    return {
      capacity: this.capacity,
      cursor: this.cursor,
      filled: this.filled,
      startMs: this.startMs!,
      durMs: this.durMs!,
      entered: this.entered!,
      frameAt: this.frameAt!,
      frameMs: this.frameMs!,
      px: this.px!,
      py: this.py!,
      pz: this.pz!,
      botsAlive: this.botsAlive!,
      canvasW: this.canvasW!,
      canvasH: this.canvasH!,
      windowW: this.windowW!,
      windowH: this.windowH!,
      scaleAt: this.scaleAt!,
      segmentAt: this.segmentAt!,
      segments: this.segments,
      bench: this.bench,
      heapMb: this.heapMb,
      gcAt: this.gcAt!,
      loafMs: this.loafMs!,
      loafBlockMs: this.loafBlockMs!,
      loafScriptMs: this.loafScriptMs!,
      loafRenderMs: this.loafRenderMs!,
      loafHead: this.loafHead!,
      gpuFrameMs: this.gpuFrameMs!,
      gpuCullMs: this.gpuCullMs!,
      madeRender: this.madeRender!,
      madeCompute: this.madeCompute!,
      madeModules: this.madeModules!,
      madeCallMs: this.madeCallMs!,
      logT: this.logT!,
      logKind: this.logKind!,
      logMs: this.logMs!,
      logLabel: this.logLabel,
      logCursor: this.logCursor,
      logFilled: this.logFilled,
      createObserved: this.createObserved,
      loafSupported: this.loafSupported,
      loafWorst: this.loafWorst,
      heapLive: this.heapLive,
      gcObserved: this.gcReg !== null,
      baselineMs: this.baselineMs,
      hitchBarMs: this.hitchBarMs,
      hitchAt: this.hitchAt,
      grainMs: this.grainMs,
      overheadUs: this.overheadUs,
      mapId: this.mapId,
      seed: this.seed,
      simMode: this.simMode,
      // A halted ring answers for its run, never for what came after it.
      blocks: this.on ? (this.blocksOf?.() ?? null) : this.blocksAtHalt,
      bodies: this.on ? (this.bodiesOf?.() ?? null) : this.bodiesAtHalt,
      hulls: this.on ? (this.hullsOf?.() ?? null) : this.hullsAtHalt,
      view: this.on ? (this.viewOf?.() ?? null) : this.viewAtHalt,
      pools: this.on ? (this.poolsOf?.() ?? null) : this.poolsAtHalt,
      graphics: this.graphics,
      graphicsAt: this.graphicsAt,
      gpuRequested: this.gpuRequested,
      gpuAvailable: this.frameTimer !== null,
      cullTimed: this.cullTimer !== null,
      surface: this.surface,
    };
  }

  /**
   * Keeps the window's CSS size for `endFrame` to file — see `canvasW`. Read
   * once now, again on every `resize`, and once a second besides, never per
   * frame; off with the other hooks, so a halted or disarmed profiler listens
   * to nothing.
   *
   * **The second is not belt and braces.** What a stale canvas MISSED is a
   * window change its resize never followed — a `resize` read before the
   * layout settled, or none at all — and a window size kept by that same
   * event would miss it alike, and file the stale canvas as MATCHED.
   */
  private watchWindow(): void {
    const read = (): void => {
      this.winW = window.innerWidth;
      this.winH = window.innerHeight;
    };
    read();
    window.addEventListener("resize", read);
    const poll = window.setInterval(read, 1000);
    this.unhook.push(() => {
      window.removeEventListener("resize", read);
      window.clearInterval(poll);
    });
  }

  /**
   * Subscribes to the browser's own account of a slow frame — see `LOAF_TYPE`.
   *
   * **`buffered` is deliberately false.** A buffered replay would hand back
   * every long frame since the page loaded, and the longest of those is always
   * the map INSTALL, which is not a hitch and would take every slot in
   * `loafWorst` before a round had drawn a frame.
   *
   * The support test is `supportedEntryTypes` rather than a try/catch alone,
   * because a browser that does not know the type throws on `observe` in some
   * versions and silently reports nothing in others — and silence is the one
   * answer this probe must never invent. Both are handled: the list decides,
   * and a throw takes support back down.
   */
  private watchLoaf(): void {
    if (typeof PerformanceObserver === "undefined") return;
    const types = PerformanceObserver.supportedEntryTypes;
    if (!types || types.indexOf(LOAF_TYPE) < 0) return;
    let obs: PerformanceObserver;
    try {
      obs = new PerformanceObserver((list) =>
        this.recordLoaf(list.getEntries() as unknown as LoafEntry[]),
      );
      obs.observe({ type: LOAF_TYPE, buffered: false });
    } catch {
      return;
    }
    this.loafSupported = true;
    // The observer is held by this closure and by nothing else, which is what
    // takes it off the browser at `disarm` along with every other hook here —
    // a field beside it would be a second reference to keep in step.
    this.unhook.push(() => obs.disconnect());
  }

  /**
   * Files each long animation frame against the ring row it ended on.
   *
   * **This is the one callback here that runs on a task rather than in a
   * frame**, and it is allowed to allocate for the reason `watchGc`'s sentinel
   * is: it fires only on frames the browser has ALREADY called slow, so on a
   * healthy device it never runs at all. The bound for the unhealthy one is in
   * `keepLoaf` — see `CONFIG.profiling.loafKept`.
   */
  private recordLoaf(entries: readonly LoafEntry[]): void {
    if (!this.on || !this.frameAt || !this.loafMs) return;
    for (const e of entries) {
      let scriptMs = 0;
      let topMs = -1;
      let top = "";
      for (const s of e.scripts ?? []) {
        const d = s.duration ?? 0;
        scriptMs += d;
        if (d > topMs) {
          topMs = d;
          top = describeScript(s);
        }
      }
      // The RENDERING half — style, layout, paint, commit — as the remainder
      // after `renderStart`. Zero where the browser did not report one, which
      // is a frame that never rendered rather than one that rendered instantly.
      const rs = e.renderStart ?? 0;
      const renderMs = rs > 0 ? Math.max(0, e.startTime + e.duration - rs) : 0;
      this.markLoaf(e, scriptMs, renderMs, top);
    }
  }

  /**
   * Marks every ring row a long animation frame OVERLAPS, and keeps the record
   * against the first of them.
   *
   * **It is an overlap and not a lookup, because the browser's frame and this
   * instrument's row are not the same interval and cannot be made to be.** A
   * long animation frame runs from the end of the previous frame's rendering to
   * the end of this one's; a row owns the time from its own start to the next
   * row's start. So one window straddles two rows by construction, and which of
   * them is "the" row depends on where the time actually went — the gap BEFORE
   * a frame is charged to the row before it, while a slow tick is charged to
   * its own.
   *
   * Trying to pick one gets the common case backwards, which is how this was
   * found: filing against the row the window ENDED on put a planted 120 ms
   * `setTimeout` on the 4 ms frame that recovered from it, and every hitch in
   * the test read `loaf: 0` while the entry that explained it sat one row
   * away. That is the same shape as the pairing bug in `endFrame`, one layer
   * up.
   *
   * So every overlapped row is marked and the question a reader asks becomes
   * the honest one: **was the main thread busy at any point during this row?**
   * A long window marks several rows, which is correct rather than
   * double-counting: `loafFacts` (`profileReport.ts`) counts those rows but
   * adds each window's numbers once, on its `loafHead` row.
   *
   * The walk is backwards because `frameAt` descends from the cursor, and it
   * stops at the first row that ended before the window opened. A row's own end
   * is `frameAt + frameMs`; the newest row has no `frameMs` yet (see
   * `endFrame`) and is treated as still open, which it is.
   */
  private markLoaf(
    e: LoafEntry,
    scriptMs: number,
    renderMs: number,
    top: string,
  ): void {
    const cap = this.capacity;
    const startMs = e.startTime;
    const endMs = startMs + e.duration;
    const blocking = e.blockingDuration ?? 0;
    let first = -1;
    for (let k = 1; k <= this.filled; k++) {
      const row = (this.cursor - k + cap) % cap;
      const t0 = this.frameAt![row];
      // Not reached yet: this row begins after the window closed.
      if (t0 >= endMs) continue;
      const span = this.frameMs![row];
      const t1 = span > 0 ? t0 + span : Infinity;
      // Walked past it: this row was over before the window opened, and every
      // row behind it is older still.
      if (t1 <= startMs) break;
      if (e.duration > this.loafMs![row]) {
        this.loafMs![row] = e.duration;
        this.loafBlockMs![row] = blocking;
        this.loafScriptMs![row] = scriptMs;
        this.loafRenderMs![row] = renderMs;
      }
      first = row;
    }
    if (first >= 0) {
      this.loafHead![first] = 1;
      this.keepLoaf(first, e.duration, blocking, scriptMs, renderMs, top);
    }
  }

  /**
   * Keeps the worst few whole, and allocates for nothing else.
   *
   * The list is small and unsorted, so the smallest is found by a walk — twelve
   * comparisons on a callback that fires only when a frame was already slow.
   * **Once it is full, an entry that would not displace the smallest builds no
   * object at all**, which is what keeps the header's promise on a device where
   * every frame is a long one.
   */
  private keepLoaf(
    at: number,
    durationMs: number,
    blockingMs: number,
    scriptMs: number,
    renderMs: number,
    top: string,
  ): void {
    const list = this.loafWorst;
    // **Stale records are dropped BEFORE the displacement test, not merely at
    // report time, or the list starves.** The biggest long frames of any
    // session are the map INSTALL's, they are never displaced by anything a
    // round produces, and once the ring has lapped past them they are dropped
    // by `worstLoaf` — so a list full of them reports almost nothing while
    // refusing every entry that would have been worth keeping. Caught on a real
    // capture: three records survived of twelve held, and the nine missing were
    // install frames from minutes earlier.
    for (let i = list.length - 1; i >= 0; i--) {
      if (this.frameAt![list[i].at] !== list[i].when) list.splice(i, 1);
    }
    if (list.length >= CONFIG.profiling.loafKept) {
      let least = 0;
      for (let i = 1; i < list.length; i++) {
        if (list[i].durationMs < list[least].durationMs) least = i;
      }
      if (list[least].durationMs >= durationMs) return;
      list.splice(least, 1);
    }
    list.push({
      at,
      when: this.frameAt![at],
      durationMs,
      blockingMs,
      scriptMs,
      renderMs,
      top,
    });
  }

  /**
   * Files whatever GPU time has landed since the last frame against the ROW IT
   * BELONGS TO, which is not this one — both of our timers, by the same two
   * transitions (`GpuPassTimer`). Nothing is allocated, and the whole thing is
   * a few reads on a healthy frame; nothing without `?gpu`.
   *
   * **The frame timer's row is claimed only by a frame it is TIMING**
   * (`GpuFrameTimer.timing`, asked here, after the frame's render and before
   * its submit), so every landing order files a reading against the frame it
   * measured: a timed frame's reading is the next to land, the timer opening
   * nothing while one is in flight, so a claim is answered by the next move
   * of `count`, which is read before this row's own claim and so never files
   * onto it. A reading that lands with no row claimed (one begun before an
   * `arm`) moves the count and files nothing, and a frame that is not timed
   * claims nothing, whatever is being read back.
   */
  private pollGpu(i: number): void {
    const frame = this.frameTimer;
    if (frame) {
      const count = frame.count;
      if (this.gpuLastCount < 0) this.gpuLastCount = count;
      else if (count !== this.gpuLastCount) {
        this.gpuLastCount = count;
        if (this.gpuPendingRow >= 0) {
          this.gpuFrameMs![this.gpuPendingRow] = frame.ms;
          this.gpuPendingRow = -1;
        }
      }
      // This frame is timed, and its reading is the next to land.
      if (this.gpuPendingRow < 0 && frame.timing) this.gpuPendingRow = i;
    }
    this.pollGpuCull(i);
  }

  /**
   * Our culls' GPU time, filed against the row it was measured on — the
   * same two transitions as `pollGpu`'s for the frame, read off
   * `GpuPassTimer`. A reading that lands as 0 (one that could not be read)
   * leaves its row's zero, which is "not measured". Three reads on a healthy
   * frame; nothing without a timer.
   */
  private pollGpuCull(i: number): void {
    const t = this.cullTimer;
    if (!t) return;
    const count = t.count;
    if (this.cullLastCount < 0) this.cullLastCount = count;
    else if (count !== this.cullLastCount) {
      this.cullLastCount = count;
      if (this.cullPendingRow >= 0) {
        this.gpuCullMs![this.cullPendingRow] = t.ms;
        this.cullPendingRow = -1;
      }
    }
    if (this.cullPendingRow < 0 && t.inFlight) this.cullPendingRow = i;
  }

  /**
   * Watches for garbage collections with a `FinalizationRegistry` sentinel.
   *
   * **This is how an instrument that cannot read the heap still sees the
   * collector.** An empty object is registered and immediately dropped; the
   * next collection that sweeps it calls back, which is a collection observed,
   * and the callback registers the next one. One object per GC event and none
   * per frame — the single exception the header grants to the no-allocation
   * rule, and the reason it is granted is `FINDINGS.md` §1.
   *
   * **It is best-effort by specification and must be read that way.** The
   * callback runs in a task AFTER the collection rather than during it, so a
   * count lands on the frame it interrupted or the one after; the engine may
   * batch or skip; and nothing here distinguishes a young-generation scavenge
   * from a major collection. What it supports is "a collection happened around
   * this frame", which against a hitch whose phases do not add up is the whole
   * of the question §1 asks.
   */
  private watchGc(): void {
    if (typeof FinalizationRegistry === "undefined") return;
    this.gcReg = new FinalizationRegistry<number>(() => {
      if (!this.on) return;
      this.gcPending++;
      this.dropSentinel();
    });
    this.dropSentinel();
  }

  private dropSentinel(): void {
    // Registered and unreachable in the same expression, which is the point of
    // it: the object exists only to be collected.
    this.gcReg?.register({}, 0);
  }

  /**
   * What one `begin`/`end` pair costs on THIS device, in microseconds.
   *
   * Recorded into every capture, because an instrument that does not state its
   * own cost is one nobody can subtract — and at ~26 pairs a frame it is worth
   * knowing whether that is 5 us or 200.
   */
  private probeOverhead(): number {
    const n = CONFIG.profiling.overheadSamples;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      this.begin(0);
      this.end(0);
    }
    return ((performance.now() - t0) / n) * 1000;
  }
}

/**
 * The smallest non-zero step this browser's `performance.now()` takes.
 *
 * 100 us without cross-origin isolation on Chrome, 5 us with it, and coarser
 * again on some mobile browsers. See the header: this number decides which rows
 * of a report are real.
 */
function probeGrain(): number {
  let min = Infinity;
  let prev = performance.now();
  for (let i = 0; i < CONFIG.profiling.grainSamples; i++) {
    const t = performance.now();
    const d = t - prev;
    if (d > 0 && d < min) min = d;
    prev = t;
  }
  return min === Infinity ? 0 : min;
}

/** Chrome's non-standard heap counter, absent everywhere else. */
interface HeapPerformance {
  memory?: { usedJSHeapSize: number };
}

/** The used JS heap in MB, or 0 where this browser has no such number. */
function usedHeapMb(): number {
  const mem = (performance as unknown as HeapPerformance).memory;
  return mem ? mem.usedJSHeapSize / 1048576 : 0;
}

/**
 * Whether `performance.memory` actually MOVES on this browser.
 *
 * Chrome rate-limits the bucketised reading to one update every twenty minutes
 * on purpose — so a page cannot compare memory before and after a dubious
 * action — and `--enable-precise-memory-info` is what drops that to 20 ms. The
 * difference decides whether a heap series is a measurement or a flat line, so
 * it is settled on the device rather than assumed: allocate well past any
 * bucket the coarse form rounds to, read again, and see.
 *
 * The ballast is dropped on return, which will cause a collection shortly
 * after. That is fine and slightly useful — it is arming, not a frame, and the
 * sentinel is not registered until after this runs.
 */
function probeHeapLive(): boolean {
  const before = usedHeapMb();
  if (before === 0) return false;
  const chunks = Math.max(1, CONFIG.profiling.heapProbeMb);
  const ballast: Float64Array[] = [];
  // 1 MB apiece, and each is written to so that nothing is entitled to skip
  // the allocation.
  for (let i = 0; i < chunks; i++) {
    const a = new Float64Array(131072);
    a[i % a.length] = i + 1;
    ballast.push(a);
  }
  let live = 0;
  for (const a of ballast) live += a[0];
  const after = usedHeapMb();
  return after !== before && live >= 0;
}

/** Whether two pushes describe the same configuration. */
function sameGraphics(a: ProfileGraphics, b: ProfileGraphics): boolean {
  return (
    a.renderScale === b.renderScale &&
    a.fpsCap === b.fpsCap &&
    a.shadows === b.shadows &&
    a.gi === b.gi &&
    a.grass === b.grass &&
    a.foliage === b.foliage &&
    a.volumetrics === b.volumetrics &&
    a.glow === b.glow &&
    a.groundRelief === b.groundRelief &&
    a.motionBlur === b.motionBlur &&
    a.paperGrain === b.paperGrain &&
    a.fxaa === b.fxaa &&
    a.minimap === b.minimap &&
    a.forced.join() === b.forced.join()
  );
}