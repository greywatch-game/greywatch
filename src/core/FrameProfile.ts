/**
 * FrameProfile.ts — where a frame's milliseconds went, recorded continuously
 * and captured backwards.
 * Owns: the RECORDER — the ring that holds the recent past, the brackets that
 * fill it, the hooks on the scene, the engine and the device, the clock-grain,
 * overhead and heap probes, and the `window.__profile` handle. The phase list
 * is `profilePhases.ts`'s and what a capture SAYS is `profileReport.ts`'s,
 * which this hands a `ProfileRing` at the moment of a capture. Owns NO game
 * state and reads none: `Game` brackets the phases it already sequences and
 * pushes the per-frame context, so nothing here imports a system and no
 * system has heard of this.
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
 *    that was never the problem and `render` is the enormous bar.
 *    `SceneInstrumentation`'s counters are carried beside them for that
 *    reason — the mesh walk, the render-target time, the particle time and
 *    the draw count are what the big bar is made of — and **four spans open
 *    INSIDE it now**: `shadowPass`, `glow`, `drawWorld` and `drawOverlay`.
 *    They are the one part of this file `Game` does not bracket, because the
 *    boundaries they want are inside a Babylon call and there is nowhere in
 *    `Game.ts` to put them — `hookRender` hangs them off the scene's own
 *    observables instead, and carries the argument that they cannot overlap.
 *
 *    **What they measure is CPU, and under `compatibilityMode = false` that is
 *    the recording of a render BUNDLE rather than the work the GPU then does.**
 *    That is still the right thing to be watching — the whole of that
 *    measurement is that this frame is bound by the submission and not by the
 *    pixels — but a group whose bundle Babylon reuses reads cheap while the
 *    GPU is saturated, and nothing here would say so. **GPU time is here
 *    now, and only when the boot asked for it** (`?gpu` — see `main.ts`,
 *    which is the only place it can act, because a device's features are
 *    fixed when the device is created and a required feature the adapter
 *    lacks makes `requestDevice` REJECT). That is why it is a boot flag
 *    rather than a setting, and why it costs a reload.
 *    Read `gpu.frame` and not `gpu.mainPass`: this pipeline draws the world
 *    into post-process targets, so the "main pass" is the final full-screen
 *    quad and reads in the tens of microseconds. Measured cost of the flag:
 *    130.0 fps against 129.9 disarmed, which is nothing.
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
import {
  SceneInstrumentation,
  WebGPUCacheRenderPipeline,
  type Observable,
  type Scene,
} from "@babylonjs/core";
import { CONFIG } from "../config";
import { P, SLOTS } from "./profilePhases";
import {
  buildReport,
  buildTrace,
  type LoafRecord,
  type ProfileGraphics,
  type ProfileReport,
  type ProfileRing,
} from "./profileReport";
import { urlFlag } from "./urlOverrides";

/**
 * What the profiler needs of the glow: a pair of notifications around each
 * piece of its work. Structural, so this file imports no pass — `GlowPass`
 * satisfies it and `Game` hands it over at `arm`.
 */
export interface GlowSpans {
  readonly onBeforeWorkObservable: Observable<void>;
  readonly onAfterWorkObservable: Observable<void>;
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
 * Babylon's GPU counter, and the one private field this file reads.
 *
 * **The frame id is not optional and taking the value without it would be this
 * session's pairing bug for the third time.** `WebGPUTimestampQuery.endPass`
 * stamps `engine.frameId` when the pass closes and resolves the duration in a
 * `.then()` a map-async round trip later — so the number sitting in the
 * counter belongs to a frame one to three rows BACK, and filing it against the
 * row that happened to read it would attribute a hitch's GPU cost to the frame
 * after it. `_gpuTimeInFrameId` is which frame the counter currently holds.
 * It is private in Babylon and there is no public equivalent; the precedent for
 * reaching in anyway is `PhysicsWorld`'s two handles onto the plugin, and the
 * justification is the same — the alternative is not a simpler instrument but a
 * wrong one.
 */
interface GpuCounter {
  readonly counter: { readonly current: number };
  readonly _gpuTimeInFrameId: number;
}

/**
 * Babylon's WHOLE-FRAME GPU counter, which is the one that answers the
 * question, and the two internal fields it takes to attribute.
 *
 * **The main-pass counter is not the scene in this pipeline.** Every pass of
 * the world renders into a post-process target and the only thing drawn to the
 * default framebuffer is the final full-screen quad (`main.ts` says so about
 * the MSAA it therefore does not ask for), so
 * `gpuTimeInFrameForMainPass` times that quad: measured at **27 microseconds**
 * on Hollowmere, which is correct for one quad and would be a catastrophic
 * misreading of "the GPU is idle". `gpuFrameTimeCounter` brackets the whole
 * command encoder instead.
 *
 * It carries no frame id, so it is attributed by watching the state machine
 * that produces it. `_measureDurationState` is 0 while nothing is in flight
 * and 1 from the frame a measurement STARTS (at the engine's `beginFrame`,
 * before `Game.tick`) — so the row that sees the transition is the row being
 * measured, and `counter.count` says when its result has landed. Only one
 * measurement is in flight at a time, which is why this samples a subset of
 * frames rather than all of them and why `gpu.frame.samples` ships beside the
 * mean.
 *
 * **All three fields are Babylon internals and a version bump can take them
 * away.** Every read is guarded and the failure is `available: false` rather
 * than a throw; after upgrading Babylon, take a `?gpu` capture and check that
 * `gpu.frame.samples` is not zero.
 */
interface GpuTimestampQuery {
  readonly gpuFrameTimeCounter?: { readonly current: number; readonly count: number };
  readonly _measureDurationState?: number;
}

interface GpuEngine {
  readonly frameId: number;
  readonly gpuTimeInFrameForMainPass?: GpuCounter;
  readonly _timestampQuery?: GpuTimestampQuery;
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

/**
 * The part of a Babylon `Effect` a creation is named by: its shader name and
 * its define set, which together are the VARIANT — and the variant is what a
 * warm-up pass would have to draw to have compiled it in advance.
 */
interface NamedEffect {
  readonly name?: unknown;
  readonly defines?: unknown;
}

/**
 * The effect whose render pipeline is about to be created, set by the wrapper on
 * Babylon's descriptor builder and taken by the wrapper on the device.
 *
 * **Module scope and not a field because Babylon's cache calls it, not this
 * class**, and the two calls are adjacent by construction:
 * `_createRenderPipeline` and `preWarmPipeline` both pass
 * `_buildRenderPipelineDescriptor(effect, …)` straight into the device's create
 * call. The device wrapper clears it, so a pipeline Babylon creates WITHOUT that
 * builder (the clear quad, the mipmap generator) goes unnamed rather than
 * inheriting the last effect's name.
 */
let namingEffect: NamedEffect | null = null;

/**
 * Whether a missing descriptor builder has been reported. Once per PAGE and
 * not once per arm, because the method is gone for the life of the bundle and
 * re-arming would only repeat the same sentence.
 */
let warnedUnnamed = false;

/**
 * The shader an effect was compiled from, as a string the effect already holds.
 *
 * `Effect.name` is either the shader's name or an `IShaderPath` object; the
 * object's keys are read rather than serialised, because nothing in the
 * recording path may build a string. A `vertexSource`-only path would be the
 * whole shader text, so it is named "inline" instead of carried.
 */
function effectName(e: NamedEffect): string {
  const n = e.name;
  if (typeof n === "string") return n;
  if (n && typeof n === "object") {
    const p = n as Record<string, unknown>;
    for (const k of ["vertex", "vertexElement", "fragment", "fragmentElement", "compute"]) {
      if (typeof p[k] === "string") return p[k] as string;
    }
  }
  return "inline";
}

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
  private drawCalls: Uint32Array | null = null;
  private activeMeshes: Uint32Array | null = null;
  private meshWalkMs: Float32Array | null = null;
  private rttMs: Float32Array | null = null;
  private particlesMs: Float32Array | null = null;

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
   * GPU time for the main pass, per row, in milliseconds — and the engine frame
   * id each row carried, which is what files it correctly.
   *
   * **Zero means NOT RESOLVED and never "the GPU was instant"**, the same rule
   * `loafMs` and `heapLive` obey. A reading arrives one to three frames after
   * the frame it describes and only the newest is held, so a row whose result
   * was overtaken keeps its zero. `gpu.frames` says how many rows in the
   * window actually got one.
   */
  private gpuMs: Float32Array | null = null;
  /** Whole-frame GPU time, on the rows that were actually measured. */
  private gpuFrameMs: Float32Array | null = null;
  private frameIdAt: Uint32Array | null = null;
  /** The row a whole-frame measurement is in flight for, and the count when it began. */
  private gpuPendingRow = -1;
  private gpuLastCount = -1;
  /** The frame id whose GPU time has already been filed, so it is filed once. */
  private gpuFiledId = -1;
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
   * one coordinate both rings share without an identity pair. The strings are
   * REFERENCES Babylon already holds (a label, a shader name, a define set) —
   * storing one allocates nothing, which is what lets this live inside the
   * recording path.
   */
  private logT: Float64Array | null = null;
  private logKind: Uint8Array | null = null;
  private logMs: Float32Array | null = null;
  private logLabel: string[] = [];
  private logEffect: string[] = [];
  private logDefines: string[] = [];
  private logCursor = 0;
  private logFilled = 0;
  /** Whether the device's create methods are wrapped, and whether creations can be named. */
  private createObserved = false;
  private createNamed = false;

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
   * Whether the frame is inside the CAMERA's own draw phase.
   *
   * The one piece of state `hookRender`'s spans need, and it exists because
   * `onBeforeRenderingGroupObservable` is notified by every `RenderingManager`
   * in the process — a render target has one of its own and fires the SCENE's
   * observable from it. Without this the shadow map's groups and the glow's
   * would be added to `drawWorld` on top of their own spans. See `hookRender`.
   */
  private inDraw = false;

  /**
   * The observers `hookRender` hung off the scene, as teardowns.
   *
   * Built once by `arm` and run by `disarm`, which is what keeps the promise
   * the header makes about a disarmed profiler: not merely that its entry
   * points return early, but that it is not ON the scene at all.
   */
  private unhook: (() => void)[] = [];

  /** Where the next frame goes, and how many the ring holds. */
  private cursor = 0;
  private filled = 0;
  private frameT0 = 0;

  /**
   * When `endFrame` finished, and the ring row it had just written — the two
   * facts `recordPresent` needs and cannot get for itself.
   *
   * `lastSlot` exists because `endFrame` ADVANCES `cursor`, and the engine's
   * end-of-frame notification arrives after that: by then `cursor` names the
   * frame about to start, and writing `present` there would file it one frame
   * late, forever. -1 until a frame has closed, which is the state an arm in
   * the middle of a frame leaves behind.
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

  private scene: Scene | null = null;
  private instr: SceneInstrumentation | null = null;

  private grainMs = 0;
  private overheadUs = 0;

  /** Which map the ring holds. Pushed by `Game`, since nothing here may ask. */
  private mapId = "?";
  /** The round's seed, pushed by `Game` like the map. See `ProfileReport.seed`. */
  private seed: number | null = null;
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
    return CONFIG.profiling.frames;
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
  arm(scene: Scene, glow: GlowSpans | null = null): void {
    if (this.on) return;
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
    this.drawCalls = new Uint32Array(n);
    this.activeMeshes = new Uint32Array(n);
    this.meshWalkMs = new Float32Array(n);
    this.rttMs = new Float32Array(n);
    this.particlesMs = new Float32Array(n);
    this.gcAt = new Uint8Array(n);
    this.loafMs = new Float32Array(n);
    this.loafBlockMs = new Float32Array(n);
    this.loafScriptMs = new Float32Array(n);
    this.loafRenderMs = new Float32Array(n);
    this.loafHead = new Uint8Array(n);
    this.gpuMs = new Float32Array(n);
    this.gpuFrameMs = new Float32Array(n);
    this.frameIdAt = new Uint32Array(n);
    this.madeRender = new Uint16Array(n);
    this.madeCompute = new Uint16Array(n);
    this.madeModules = new Uint16Array(n);
    this.madeCallMs = new Float32Array(n);
    const logCap = CONFIG.profiling.creationsKept;
    this.logT = new Float64Array(logCap);
    this.logKind = new Uint8Array(logCap);
    this.logMs = new Float32Array(logCap);
    this.logLabel = new Array<string>(logCap).fill("");
    this.logEffect = new Array<string>(logCap).fill("");
    this.logDefines = new Array<string>(logCap).fill("");
    this.logCursor = 0;
    this.logFilled = 0;
    this.gpuFiledId = -1;
    this.gpuPendingRow = -1;
    this.gpuLastCount = -1;
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
    this.baselineMs = 0;
    this.hitchBarMs = CONFIG.profiling.hitchMs;
    this.gcPending = 0;

    this.scene = scene;
    // Babylon's own counters, and they are the half of the frame the JS spans
    // cannot reach. Constructed here rather than in the ctor because each
    // capture flag hangs observers off the scene, which is a cost a disarmed
    // profiler must not be paying.
    this.instr = new SceneInstrumentation(scene);
    this.instr.captureActiveMeshesEvaluationTime = true;
    this.instr.captureRenderTargetsRenderTime = true;
    // The one counter with a MAP behind it rather than a subsystem: the GPU
    // clouds a blast raises and the mote field Sarab emits around the eye are
    // the only particles in the game, and nothing else prices either.
    this.instr.captureParticlesRenderTime = true;
    // …and the four spans inside `render`, which are observers rather than
    // brackets. Registered before `on`, which costs nothing: every one of them
    // goes through `begin`/`endAdd` and returns on the same first line as the
    // rest of this class.
    this.hookRender(scene, glow);
    this.hookEngine(scene);
    this.hookCreation();

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

  /** Stops recording and gives the memory back. The last report survives. */
  disarm(): void {
    if (!this.on) return;
    this.on = false;
    for (const off of this.unhook) off();
    this.unhook = [];
    this.inDraw = false;
    this.tickEndAt = 0;
    this.lastSlot = -1;
    this.instr?.dispose();
    this.instr = null;
    this.scene = null;
    this.startMs = null;
    this.durMs = null;
    this.entered = null;
    this.frameAt = null;
    this.frameMs = null;
    this.px = null;
    this.py = null;
    this.pz = null;
    this.botsAlive = null;
    this.drawCalls = null;
    this.activeMeshes = null;
    this.meshWalkMs = null;
    this.rttMs = null;
    this.particlesMs = null;
    this.heapMb = null;
    this.gcAt = null;
    this.loafMs = null;
    this.loafBlockMs = null;
    this.loafScriptMs = null;
    this.loafRenderMs = null;
    this.loafHead = null;
    this.gpuMs = null;
    this.gpuFrameMs = null;
    this.frameIdAt = null;
    this.madeRender = null;
    this.madeCompute = null;
    this.madeModules = null;
    this.madeCallMs = null;
    this.logT = null;
    this.logKind = null;
    this.logMs = null;
    this.logLabel = [];
    this.logEffect = [];
    this.logDefines = [];
    this.logCursor = 0;
    this.logFilled = 0;
    // The wrappers came off with `unhook` above; these only say so.
    this.createObserved = false;
    this.createNamed = false;
    namingEffect = null;
    this.gpuFiledId = -1;
    this.gpuPendingRow = -1;
    this.gpuLastCount = -1;
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
   * **Every one of `hookRender`'s spans needs this and none of `Game`'s does**,
   * which is the whole reason it is a second method rather than `end` growing a
   * flag: a rendering group is entered once per group per camera, and a plain
   * `end` would report the LAST of those as the phase's whole cost.
   *
   * **`entered` is what says "first this frame", and it is sound because
   * `endFrame` clears the slots of the frame it is about to overwrite** — the
   * write that stops a skipped phase flying the previous lap's flag. So the
   * first close of a frame stamps the start and the rest add to the duration,
   * and `startMs` stays the start of the FIRST piece, which is what the trace
   * export wants: the pieces of one of these phases are contiguous in the
   * frame's order, so a flame chart draws one bar in the right place.
   */
  private endAdd(slot: number): void {
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
   * Hangs `present` off the ENGINE's end-of-frame notification.
   *
   * **The second place a bracket lives outside `Game.ts`, and for the opposite
   * reason to `hookRender`'s.** Those four are boundaries INSIDE
   * `scene.render()`; this one is a boundary `Game` never sees at all, because
   * `endFrame` is called by Babylon's render loop after `tick` has returned.
   * There is no line in `Game.ts` that could hold it.
   *
   * `onEndFrameObservable` fires at the END of `WebGPUEngine.endFrame`, after
   * `flushFramebuffer` has run `queue.submit` — so the span this closes covers
   * the render pass being closed and the command buffers being submitted, which
   * is where a stall on the way to the screen would land. What it deliberately
   * does NOT cover is the wait for the next frame to start; that stays as the
   * residue between `frame` + `present` and the wall clock, and naming it would
   * mean claiming to know which of the compositor, the driver and the panel it
   * belonged to.
   */
  private hookEngine(scene: Scene): void {
    const engine = scene.getEngine();
    const done = engine.onEndFrameObservable.add(() => this.recordPresent());
    this.unhook.push(() => engine.onEndFrameObservable.remove(done));
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
   * **Naming is the second, optional half and it IS a Babylon internal**:
   * `WebGPUCacheRenderPipeline._buildRenderPipelineDescriptor` is the one place
   * that holds the effect a render pipeline is for, so it is wrapped to leave
   * that effect where the device wrapper can see it. A version that renames it
   * costs the NAMES and nothing else — `pipelines.named` goes false and every
   * count stays right — the arrangement `GpuTimestampQuery`'s fields have. It
   * also warns ONCE on the console, because a flag in a capture is only seen
   * by somebody who already knows to look for it.
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

    const cache = WebGPUCacheRenderPipeline.prototype as unknown as Record<string, unknown>;
    const build = cache._buildRenderPipelineDescriptor;
    if (typeof build !== "function") {
      if (!warnedUnnamed) {
        warnedUnnamed = true;
        console.warn(
          "FrameProfile: WebGPUCacheRenderPipeline._buildRenderPipelineDescriptor " +
            "is gone (a Babylon upgrade?) — pipeline creations are still counted " +
            "but will not be named. See docs/profiling.md.",
        );
      }
      return;
    }
    const describe = build as (this: unknown, e: NamedEffect, t: unknown, s: unknown) => unknown;
    cache._buildRenderPipelineDescriptor = function named(
      this: unknown,
      effect: NamedEffect,
      topology: unknown,
      samples: unknown,
    ): unknown {
      namingEffect = effect;
      return describe.call(this, effect, topology, samples);
    };
    this.unhook.push(() => {
      cache._buildRenderPipelineDescriptor = build;
      namingEffect = null;
    });
    this.createNamed = true;
  }

  /**
   * Files one creation: a count on the row being recorded, and an entry in the
   * log. Nothing here builds a string — every one stored is a reference the
   * descriptor or the effect already held.
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
    // Only a render pipeline is built through the descriptor builder, and a
    // module or compute pipeline must not inherit the last render's effect.
    const effect = kind === 0 ? namingEffect : null;
    this.logEffect[at] = effect ? effectName(effect) : "";
    this.logDefines[at] = effect && typeof effect.defines === "string" ? effect.defines : "";
    if (kind === 0) namingEffect = null;
    this.logCursor = (at + 1) % this.logT!.length;
    if (this.logFilled < this.logT!.length) this.logFilled++;
  }

  /**
   * Hangs the four spans inside `render` off Babylon's own observables.
   *
   * **This is the one place this file's own arrangement bends, and the reason
   * is that there is nowhere in `Game.ts` to put these brackets.** Every other
   * phase is a pair of lines in a method whose order `Game` already declares;
   * these four are boundaries INSIDE `scene.render()`, and the alternative to
   * an observer is no measurement at all. Nothing here reaches for a system —
   * the shadow map is found through the SCENE (`scene.lights`) and the glow is
   * handed in as two observables (`GlowSpans`), so `ShadowSystem` and
   * `GlowPass` still have not heard of this file and do not have to.
   *
   * **THE FOUR CANNOT OVERLAP, and that is a fact about where Babylon runs
   * them rather than a hope.** `Scene._renderForCamera` is one order:
   *
   *  1. the render targets — the shadow map among them — all of it before
   *     the draw phase opens;
   *  2. `onBeforeDrawPhaseObservable`, the rendering manager, and
   *     `onAfterDrawPhaseObservable`, which is the camera's own pass and where
   *     the glow draws its mask and blurs it, after every group has drawn;
   *  3. the post chain, where the ink runs the glow's compose as its last line.
   *
   * So the shadow map is in (1), the two group spans and then the glow's mask
   * are in (2), and the glow's compose is in (3), unnamed. What is left inside
   * `render` and named by nothing is the active-mesh evaluation, the post
   * chain, a frame's share of a reflection bake, and the present.
   *
   * **The group spans are gated on `inDraw` and would double-count without
   * it.** `onBeforeRenderingGroupObservable` is the SCENE's, and every
   * `RenderingManager` in the process notifies it — including the one inside a
   * render target — so the shadow map's own groups and the glow's would be
   * added to `drawWorld` on top of the spans that already hold them. **The glow
   * closes that gate itself when its span opens**, because its mask renders
   * from `onAfterDrawPhaseObservable` BEFORE the observer below that would
   * otherwise close it (the glow's was added at construction, ours at `arm`):
   * every group of the camera's own pass has drawn by then, so nothing is
   * lost, and the mask's groups are not counted twice.
   *
   * **Group 0 is the world and everything above it is `drawOverlay`**, which
   * today is the viewmodel (`VIEWMODEL_GROUP`) alone — the sky draws in group 0.
   * Split that way rather than one slot per id because the question worth
   * asking is what the MAP costs against what the gun costs, and a third group
   * added to the game should join the overlay rather than go unrecorded.
   *
   * **A render target is bracketed BIND to UNBIND.** The glow is not bracketed
   * as a target at all: it notifies around its mask AND its blur together.
   */
  private hookRender(scene: Scene, glow: GlowSpans | null): void {
    const off = this.unhook;

    const drawOn = scene.onBeforeDrawPhaseObservable.add(() => {
      this.inDraw = true;
    });
    off.push(() => scene.onBeforeDrawPhaseObservable.remove(drawOn));
    const drawOff = scene.onAfterDrawPhaseObservable.add(() => {
      this.inDraw = false;
    });
    off.push(() => scene.onAfterDrawPhaseObservable.remove(drawOff));

    const groupIn = scene.onBeforeRenderingGroupObservable.add((info) => {
      if (this.inDraw) {
        this.begin(info.renderingGroupId === 0 ? P.drawWorld : P.drawOverlay);
      }
    });
    off.push(() => scene.onBeforeRenderingGroupObservable.remove(groupIn));
    const groupOut = scene.onAfterRenderingGroupObservable.add((info) => {
      if (this.inDraw) {
        this.endAdd(info.renderingGroupId === 0 ? P.drawWorld : P.drawOverlay);
      }
    });
    off.push(() => scene.onAfterRenderingGroupObservable.remove(groupOut));

    // Every shadow map in the scene, which is ShadowSystem's one directional
    // light. Its texture is created once at a fixed `mapSize` and never
    // re-created, so unlike the glow's it needs no re-binding.
    for (const light of scene.lights) {
      const map = light.getShadowGenerator()?.getShadowMap();
      if (!map) continue;
      const bind = map.onBeforeBindObservable.add(() => this.begin(P.shadowPass));
      off.push(() => map.onBeforeBindObservable.remove(bind));
      const unbind = map.onAfterUnbindObservable.add(() =>
        this.endAdd(P.shadowPass),
      );
      off.push(() => map.onAfterUnbindObservable.remove(unbind));
    }

    // The glow: its mask and blur at the end of the draw phase. See the header
    // on `inDraw`.
    if (!glow) return;
    const before = glow.onBeforeWorkObservable.add(() => {
      this.inDraw = false;
      this.begin(P.glow);
    });
    off.push(() => glow.onBeforeWorkObservable.remove(before));
    const after = glow.onAfterWorkObservable.add(() => this.endAdd(P.glow));
    off.push(() => glow.onAfterWorkObservable.remove(after));
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
   * Closes the frame, samples Babylon's counters and advances the ring.
   *
   * Last line of `tick`, after `scene.render()`: the counters are what that
   * render just did, and asking before it would report the previous frame's.
   */
  endFrame(realDeltaMs: number): void {
    if (!this.on) return;
    this.end(0);
    const i = this.cursor;
    this.frameAt![i] = this.frameT0;
    // **The interval that has just elapsed belongs to the row BEFORE this
    // one.** `Game.tick` reads `getDeltaTime()` on its FIRST line, so
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
    // `present` needed no such move and never had this bug: `recordPresent`
    // already writes into `lastSlot`, for the same reason stated there.
    const prev = this.lastSlot;
    if (prev >= 0) this.frameMs![prev] = realDeltaMs;
    // This frame's own interval is not known until the next one closes, and
    // the row may still hold the previous lap's. `buildReport` drops the
    // newest row rather than reading this zero as an instant frame.
    this.frameMs![i] = 0;
    const instr = this.instr;
    if (instr && this.scene) {
      this.drawCalls![i] = instr.drawCallsCounter.current;
      this.activeMeshes![i] = this.scene.getActiveMeshes().length;
      this.meshWalkMs![i] = instr.activeMeshesEvaluationTimeCounter.current;
      this.rttMs![i] = instr.renderTargetsRenderTimeCounter.current;
      this.particlesMs![i] = instr.particlesRenderTimeCounter.current;
    }
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
    // …and the hitch this lap is about to overwrite stops being a hitch. The
    // list is in ring order, so the stale ones are always at the FRONT and this
    // is one comparison on nearly every frame. Without it the chip counts
    // hitches that no longer exist and a capture reports the wrong frame's
    // phases under an old frame's cost — see the field.
    while (this.hitchAt.length > 0 && this.frameAt![this.hitchAt[0]] !== this.hitchWhen[0]) {
      this.hitchAt.shift();
      this.hitchWhen.shift();
    }
    // The handover to `recordPresent`, and it is the LAST line for a reason:
    // everything above is this instrument's own bookkeeping, and charging that
    // to the submit would be the profiler measuring itself.
    this.lastSlot = i;
    this.tickEndAt = performance.now();
  }

  /**
   * Closes `present` on the frame that has just been submitted.
   *
   * **Written straight into the ring rather than through `end`, because the
   * cursor has already moved on.** `endFrame` is the last line of `tick` and
   * advances `cursor`; the engine notifies after `tick` returns, so the row
   * this belongs to is `lastSlot` and not `cursor`. `endFrame` clears the
   * NEXT row's `entered` flags, never the one just written, so stamping it
   * here is safe.
   *
   * `tickEndAt` is zeroed on the way through so a second notification inside
   * one frame cannot write twice — there is exactly one `endFrame` per render
   * loop today, and this costs one comparison to not depend on that.
   */
  private recordPresent(): void {
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
    if (!this.on || this.filled < 2) return null;
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
    if (!this.on || this.filled < 2) return "{}";
    return buildTrace(this.ring(), maxFrames);
  }

  /**
   * Lends the reporter everything it reads — see `ProfileRing`. Called only by
   * `capture` and `trace`, both of which return first unless the profiler is
   * armed and holds two frames. That is what entitles every `!` below: in that
   * state nothing here is null but the heap series.
   */
  private ring(): ProfileRing {
    const engine = this.scene?.getEngine() ?? null;
    const gpu = engine as unknown as GpuEngine | null;
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
      drawCalls: this.drawCalls!,
      activeMeshes: this.activeMeshes!,
      meshWalkMs: this.meshWalkMs!,
      rttMs: this.rttMs!,
      particlesMs: this.particlesMs!,
      heapMb: this.heapMb,
      gcAt: this.gcAt!,
      loafMs: this.loafMs!,
      loafBlockMs: this.loafBlockMs!,
      loafScriptMs: this.loafScriptMs!,
      loafRenderMs: this.loafRenderMs!,
      loafHead: this.loafHead!,
      gpuMs: this.gpuMs!,
      gpuFrameMs: this.gpuFrameMs!,
      madeRender: this.madeRender!,
      madeCompute: this.madeCompute!,
      madeModules: this.madeModules!,
      madeCallMs: this.madeCallMs!,
      logT: this.logT!,
      logKind: this.logKind!,
      logMs: this.logMs!,
      logLabel: this.logLabel,
      logEffect: this.logEffect,
      logDefines: this.logDefines,
      logCursor: this.logCursor,
      logFilled: this.logFilled,
      createObserved: this.createObserved,
      createNamed: this.createNamed,
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
      graphics: this.graphics,
      graphicsAt: this.graphicsAt,
      gpuRequested: this.gpuRequested,
      gpuAvailable: !!gpu?.gpuTimeInFrameForMainPass,
      engine,
    };
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
   * Files whatever GPU time has resolved since the last frame against the ROW
   * IT BELONGS TO, which is not this one.
   *
   * The engine's frame id advances once per frame exactly as the ring does, so
   * the row is `i` minus however many frames back the reading is — an
   * arithmetic step rather than a search, and `frameIdAt` is then checked
   * rather than trusted, because a ring that has lapped past the frame in
   * question must drop the reading instead of writing it somewhere plausible.
   *
   * Nothing is allocated and the whole thing is four reads on a healthy frame.
   * With `?gpu` absent `gpuTimeInFrameForMainPass` is undefined and this
   * returns on its second line.
   */
  private pollGpu(i: number): void {
    const engine = this.scene?.getEngine() as unknown as GpuEngine | undefined;
    if (!engine) return;
    this.frameIdAt![i] = engine.frameId;
    this.pollGpuFrame(i, engine);

    const perf = engine.gpuTimeInFrameForMainPass;
    if (!perf) return;
    const id = perf._gpuTimeInFrameId;
    if (id < 0 || id === this.gpuFiledId) return;
    this.gpuFiledId = id;
    const back = engine.frameId - id;
    if (back < 0 || back >= this.filled + 1) return;
    const row = (i - back + this.capacity) % this.capacity;
    // The check that makes the arithmetic safe rather than merely quick.
    if (this.frameIdAt![row] !== id) return;
    // Babylon reports NANOSECONDS.
    this.gpuMs![row] = perf.counter.current / 1e6;
  }

  /**
   * The whole frame's GPU time, filed against the row it was measured on.
   *
   * Two transitions and nothing else — see `GpuTimestampQuery` for why they
   * are the attribution. A measurement STARTS at the engine's `beginFrame`,
   * which is before `Game.tick`, so a row that finds the state non-zero with
   * nothing already pending is the row being measured; the result LANDS later
   * and `count` moving is what says so.
   */
  private pollGpuFrame(i: number, engine: GpuEngine): void {
    const q = engine._timestampQuery;
    const counter = q?.gpuFrameTimeCounter;
    if (!counter) return;
    const count = counter.count;
    if (this.gpuLastCount < 0) this.gpuLastCount = count;
    else if (count !== this.gpuLastCount) {
      this.gpuLastCount = count;
      if (this.gpuPendingRow >= 0) {
        this.gpuFrameMs![this.gpuPendingRow] = counter.current / 1e6;
        this.gpuPendingRow = -1;
      }
    }
    // A fresh measurement is in flight and nothing is claimed for it yet.
    if (this.gpuPendingRow < 0 && (q?._measureDurationState ?? 0) !== 0) {
      this.gpuPendingRow = i;
    }
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