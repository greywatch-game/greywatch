/**
 * FrameProfile.ts — where a frame's milliseconds went, recorded continuously
 * and captured backwards.
 * Owns: the phase list, the ring that holds the recent past, the clock-grain
 * and overhead probes, the report a capture produces, and the
 * `window.__profile` handle. Owns NO game state and reads none: `Game` brackets
 * the phases it already sequences and pushes the per-frame context, so nothing
 * here imports a system and no system has heard of this.
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
 *    `FINDINGS.md` §1's leading suspect for the hitch this exists to find is
 *    GC, and a profiler that allocates per frame manufactures the bug it was
 *    built to catch. Captures and reports allocate freely — a capture is a
 *    deliberate act, not a frame.
 *
 *    **There is exactly ONE allocation left in the recording path and it is
 *    per COLLECTION rather than per frame**: the sentinel object the GC watch
 *    re-registers each time one is collected (see `watchGc`). It is one empty
 *    object per GC event — at a scavenge every hundred milliseconds that is
 *    four bytes a second — and the alternative is an instrument that cannot see
 *    the one thing §1 most suspects. Nothing else here may take that licence.
 *
 * **WHAT IT CAN AND CANNOT SEE, because a table of plausible numbers is worse
 * than no table.** Three limits, each recorded into every capture rather than
 * left to prose:
 *
 *  - **The clock is coarse.** Chrome quantises `performance.now()` to 100 us
 *    unless the page is cross-origin isolated, and this one is not
 *    (`docker/default.conf.template` sets no COOP/COEP). Most phases below
 *    `render` cost under 120 us on real hardware (`FINDINGS.md` §18), so a
 *    SINGLE frame's reading of a small phase is one grain or two and nothing
 *    in between. The mean over a window still converges — a phase boundary
 *    falls at a uniformly random offset within the grid, so the difference of
 *    two quantised stamps is unbiased across many frames — but a percentile of
 *    a sub-grain phase is quantisation noise wearing a statistic's clothes.
 *    `clock.grainMs` and `clock.belowGrain` are in every report so a reader can
 *    see which of its rows are real. **This answers "which phase", never "which
 *    function"**; a 3.5 us box query (`FINDINGS.md` §23) is micro-benchmark
 *    territory and always will be.
 *  - **The frame is draw-call bound** (`FINDINGS.md` §17), so the JS phases
 *    attribute the third of the frame that was never the problem and `render`
 *    is the enormous bar. `SceneInstrumentation`'s counters are carried beside
 *    them for that reason — the mesh walk, the render-target time, the particle
 *    time and the draw count are what the big bar is made of — and **four spans
 *    open INSIDE it now**: `shadowPass`, `glow`, `drawWorld` and
 *    `drawOverlay`. They are the one part of this file `Game` does not
 *    bracket, because the boundaries they want are inside a Babylon call and
 *    there is nowhere in `Game.ts` to put them — `hookRender` hangs them off
 *    the scene's own observables instead, and carries the argument that they
 *    cannot overlap.
 *
 *    **What they measure is CPU, and under `compatibilityMode = false` that is
 *    the recording of a render BUNDLE rather than the work the GPU then does.**
 *    That is still the right thing to be watching — the whole of §17 is that
 *    this frame is bound by the submission and not by the pixels — but a group
 *    whose bundle Babylon reuses reads cheap while the GPU is saturated, and
 *    nothing here would say so. GPU time is NOT here: Babylon can read it
 *    (`gpuTimeInFrameForMainPass`, and `gpuTimeInFrame` per render target),
 *    but only if `timestamp-query` is requested at DEVICE CREATION, and
 *    `main.ts` calls `initAsync()` with no descriptor. That is what keeps it
 *    out of this cut rather than the blast radius: a feature asked for at
 *    device creation cannot be armed by a SETTING the way everything else here
 *    is, so it would have to be read at boot and cost a reload to turn on.
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
 *    to its wall clock, with collections on it, is the GC pause §1 is looking
 *    for; the same hitch with none is not, and eliminating the leading suspect
 *    is worth as much as confirming it.
 */
import {
  SceneInstrumentation,
  type EffectLayer,
  type Observer,
  type RenderTargetTexture,
  type Scene,
} from "@babylonjs/core";
import { CONFIG } from "../config";

/**
 * The phases, in the order a frame runs them. **An index into this list IS a
 * phase's slot id**, which is what keeps the recording loop free of strings.
 *
 * They NEST and they do not partition: `frame` contains `gameplay` contains
 * `world` contains `bots`, and what is left over inside each is the lines
 * nobody thought worth naming. Read a report as an attribution, exactly as
 * `buildProfile`'s header says to read the build's.
 *
 * Adding one is a name here and a `begin`/`end` pair in `Game`. Nothing else
 * moves — the ring, the report and the trace are all sized and labelled off
 * this list.
 */
export const PHASES = [
  /** The whole `tick`, wall to wall. Opened by `beginFrame`, not by `begin`. */
  "frame",
  "input",
  "roundBehind",
  /** The `playing` arm of the state switch: `updateGameplay` entire. */
  "gameplay",
  "driver",
  "onFoot",
  "world",
  "net",
  "conquest",
  /** The crews, the hulls and the tracks' sweep — one span over the armour. */
  "vehicles",
  "bots",
  "combat",
  "grenades",
  "antiTank",
  /** Havok's step and its three clients, which is the order they must run in. */
  "physics",
  "camera",
  "zones",
  /** `updateHud` — what a gameplay frame pushes at the chrome. */
  "hud",
  /** `HUD.update` — the chrome's own clock, which every state owes. */
  "hudDraw",
  /** The post chain, the sky and the shafts. */
  "post",
  /** The cull cells, the mote field, the rotors' dust and the shader's eye. */
  "culling",
  /** `pushHullEngines` — the fleet's voices. */
  "audio",
  /** `scene.render()`. The big one, and see the header on why. */
  "render",
  /**
   * The four spans INSIDE `render`, and the only ones in this list that
   * `Game` does not bracket — see `hookRender`, which is also where the
   * argument that they cannot overlap each other is written down.
   */
  "shadowPass",
  "glow",
  "drawWorld",
  "drawOverlay",
  /**
   * The engine's own END of the frame: everything `endFrame` does after `tick`
   * has returned, which on WebGPU is closing the render pass and
   * `queue.submit`.
   *
   * **It is the one phase in this list that is NOT inside `frame`**, and it is
   * here because the residue outside the tick was the whole of an unexplained
   * hitch: a real capture read 42.2 ms of wall clock against a 15.1 ms tick
   * with no collection on it, and nothing in the instrument could say which
   * side of the submit the missing 27 ms was on. See `recordPresent`, and
   * `PARENT_OF`, where being a root is declared.
   *
   * What is still outside everything, after this, is the gap from the submit to
   * the next frame opening: the rAF wait, the compositor, the panel. A report
   * where `frame` + `present` falls well short of `frame.mean` is saying the
   * time is THERE, and that is a real answer rather than a gap in the tree.
   */
  "present",
] as const;

export type Phase = (typeof PHASES)[number];

const SLOTS = PHASES.length;

/**
 * `P.bots` is the slot id for `"bots"`.
 *
 * Derived from `PHASES` rather than written out, so the list is stated once
 * and an id cannot drift from its label. The values are plain numbers by the
 * time a call site sees one, which is exactly what the ring wants.
 */
export const P = Object.fromEntries(
  PHASES.map((name, i) => [name, i]),
) as Readonly<Record<Phase, number>>;

/**
 * Which span each phase sits INSIDE.
 *
 * **The nesting is a fact about `Game.ts`'s bracket placement, and until this
 * existed the only written statement of it was prose in `docs/profiling.md`.**
 * That was enough while a report was read by a person, and stopped being enough
 * the moment `public/profile_viewer.html` had to draw the containment: a reader
 * that guesses the tree draws a wrong picture confidently, and one that carries
 * its own copy goes stale the first time a phase is added here.
 *
 * So the tree is declared once, beside the list it is about, and **shipped in
 * every capture** (`ProfileReport.tree`) — a report states its own shape for
 * the same reason it states its own clock grain and its own overhead.
 *
 * `Exclude<Phase, "frame" | "present">` is what makes it safe: every phase but
 * the two ROOTS must name a parent, so **a phase added to `PHASES` does not
 * compile until it has said where it sits** — the arrangement `ScreenStack`'s
 * `SCREENS` uses to stop a new screen shipping without answering its four
 * questions.
 *
 * **There are two roots because the frame has two parts and only one of them
 * is the tick.** `frame` is `Game.tick`, wall to wall; `present` is what the
 * engine does after it returns. Neither contains the other, they cannot
 * overlap, and a reader that drew `present` inside `frame` would be drawing a
 * containment that does not exist — which is exactly what the fallback tree in
 * `public/profile_viewer.html` does to any phase it has not been told about, so
 * that copy must gain this one too.
 */
export const PARENT_OF: Readonly<
  Record<Exclude<Phase, "frame" | "present">, Phase>
> = {
  input: "frame",
  roundBehind: "frame",
  gameplay: "frame",
  driver: "gameplay",
  onFoot: "gameplay",
  world: "gameplay",
  net: "world",
  conquest: "world",
  vehicles: "world",
  bots: "world",
  combat: "world",
  grenades: "world",
  antiTank: "world",
  physics: "world",
  camera: "gameplay",
  zones: "gameplay",
  hud: "gameplay",
  hudDraw: "frame",
  post: "frame",
  culling: "frame",
  audio: "frame",
  render: "frame",
  shadowPass: "render",
  glow: "render",
  drawWorld: "render",
  drawOverlay: "render",
};

/**
 * The phases nothing contains: `frame` (the tick) and `present` (what the
 * engine does after it).
 *
 * DERIVED from the two tables above rather than written out, so it cannot go
 * stale the way a hand-kept list would, and SHIPPED in every capture — because
 * a reader given only a child→parent map cannot tell a root from a phase the
 * map has not heard of, and those two want opposite renderings: a root is a
 * top-level bar, and an unknown phase is a warning that the reader is stale.
 * `public/profile_viewer.html` drew the second for both until this existed.
 */
export const ROOTS: readonly Phase[] = PHASES.filter(
  (name) => !(name in PARENT_OF),
);

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
   * under it. See `endFrame`.
   */
  frameMs: number;
  x: number;
  y: number;
  z: number;
  botsAlive: number;
  /**
   * Collections the sentinel reported during this frame, and the used heap at
   * the end of it in MB (0 where the reading is frozen — see the header).
   *
   * **This is the pair the whole hitch list exists to be read against.** A
   * hitch whose `phases` do not add up to its `frameMs`, with `gc` on it, is
   * a collection; the same shortfall with `gc` at 0 is the browser — vsync,
   * present, compositing — and those are two different investigations.
   *
   * **That subtraction is only between two facts about the SAME frame from
   * report version 4 onward**, and a v3 capture's shortfall is mostly the
   * pairing bug `endFrame` describes rather than a browser. Do not read an
   * old capture's "outside the tick" verdict; re-take it.
   */
  gc: number;
  heapMb: number;
  /**
   * The long animation frame covering this hitch, and how much of it blocked.
   * **Zero means the browser reported none** — so in a capture where
   * `loaf.supported` is true, a hitch with `loafMs: 0` is one the main thread
   * was IDLE for, and its time went to the compositor or the panel. That is the
   * split the residue alone could never make. See `LOAF_TYPE`.
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
  drawCalls: number;
  activeMeshes: number;
  meshWalkMs: number;
  renderTargetsMs: number;
  particlesMs: number;
  /** Only the phases this frame actually entered, in `PHASES` order. */
  phases: Partial<Record<Phase, number>>;
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
  };
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
  /** What the instrument knows about itself. See the header. */
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
   * let the instrument see of either. See the header.
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
     * no-allocation rule this file states for itself is one nothing else in
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
     * ring rather than counted since arming. Best-effort — see the header.
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
   * whatsoever. See `LOAF_TYPE`.
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
     * clock. See `loafHead`.
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
    phases: Partial<Record<Phase, number[]>>;
  };
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
  private loafWorst: {
    at: number;
    when: number;
    durationMs: number;
    blockingMs: number;
    scriptMs: number;
    renderMs: number;
    top: string;
  }[] = [];

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

  /**
   * The glow layer, the main texture it is currently rendering into, and the
   * observer sitting on that texture.
   *
   * **The texture is re-created rather than resized**, by `EffectLayer.render`
   * itself the frame after the backing store changes — a window resize, or the
   * render-scale setting — so an observer hung off it once at `arm` is on a
   * disposed object from then on and `glow` silently reads as the compose
   * alone. `bindGlow` is one reference comparison at the end of each frame
   * against exactly that, which is cheaper than any of the ways of being told.
   */
  private glowLayer: EffectLayer | null = null;
  private glowTex: RenderTargetTexture | null = null;
  private glowIn: Observer<RenderTargetTexture> | null = null;
  private glowOut: Observer<RenderTargetTexture> | null = null;

  private grainMs = 0;
  private overheadUs = 0;

  /** Which map the ring holds. Pushed by `Game`, since nothing here may ask. */
  private mapId = "?";

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
   * Allocates the ring, probes the clock, and starts recording.
   *
   * **The two probes run here rather than being constants**, because both
   * answers are properties of the DEVICE and this instrument's whole reason to
   * exist is that the interesting devices are ones nobody here has measured.
   * They cost a few milliseconds once, during a settings toggle — never in a
   * frame.
   */
  arm(scene: Scene): void {
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
    this.hookRender(scene);
    this.hookEngine(scene);

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
    this.glowLayer = null;
    this.glowTex = null;
    this.glowIn = null;
    this.glowOut = null;
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
   * flag: a rendering group is entered once per group per camera, the glow is
   * entered twice — its main texture, then its compose two stages later — and a
   * plain `end` would report the LAST of those as the phase's whole cost.
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
   * Hangs the four spans inside `render` off Babylon's own observables.
   *
   * **This is the one place this file's own arrangement bends, and the reason
   * is that there is nowhere in `Game.ts` to put these brackets.** Every other
   * phase is a pair of lines in a method whose order `Game` already declares;
   * these four are boundaries INSIDE `scene.render()`, and the alternative to
   * an observer is no measurement at all. Nothing here reaches for a system —
   * the shadow map and the glow are found through the SCENE (`scene.lights`,
   * `scene.effectLayers`), so `ShadowSystem` and `Game`'s glow layer still
   * have not heard of this file and do not have to.
   *
   * **THE FOUR CANNOT OVERLAP, and that is a fact about where Babylon runs
   * them rather than a hope.** `Scene._renderForCamera` is one order:
   *
   *  1. the render targets — the shadow map among them, then the effect
   *     layers' main textures — all of it before the draw phase opens;
   *  2. `onBeforeDrawPhaseObservable`, the rendering manager, and
   *     `onAfterDrawPhaseObservable`, which is the camera's own pass;
   *  3. the after-camera stages, where the glow COMPOSES, and then the post
   *     chain.
   *
   * So the shadow map and the glow's main texture are in (1), the two group
   * spans are in (2), and the glow's compose is in (3). What is left inside
   * `render` and named by nothing is the active-mesh evaluation, the post
   * chain, a frame's share of a reflection bake, and the present.
   *
   * **The group spans are gated on `inDraw` and would double-count without
   * it.** `onBeforeRenderingGroupObservable` is the SCENE's, and every
   * `RenderingManager` in the process notifies it — including the one inside a
   * render target — so the shadow map's own groups and the glow's would be
   * added to `drawWorld` on top of the spans that already hold them.
   *
   * **Group 0 is the world and everything above it is `drawOverlay`**, which
   * today is the sky shell, the moon and the viewmodel (`VIEWMODEL_GROUP`).
   * Split that way rather than one slot per id because the question worth
   * asking is what the MAP costs against what the gun costs, and a third group
   * added to the game should join the overlay rather than go unrecorded.
   *
   * **A render target is bracketed BIND to UNBIND, and the unbind is where the
   * blur is.** A glow layer hangs its four blur passes off that same
   * `onAfterUnbindObservable` at construction, and observers fire in the order
   * they were added — ours is added at `arm`, which is always later — so the
   * blurs are inside the span rather than after it.
   */
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

  private hookRender(scene: Scene): void {
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

    // The effect layers, of which this game has exactly one — the glow — and
    // the COMPOSE half of it, which is the half that is not a render target.
    const layer = scene.effectLayers[0] ?? null;
    this.glowLayer = layer;
    if (!layer) return;
    const before = layer.onBeforeComposeObservable.add(() => this.begin(P.glow));
    off.push(() => layer.onBeforeComposeObservable.remove(before));
    const after = layer.onAfterComposeObservable.add(() => this.endAdd(P.glow));
    off.push(() => layer.onAfterComposeObservable.remove(after));
    off.push(() => {
      if (!this.glowTex) return;
      if (this.glowIn) this.glowTex.onBeforeBindObservable.remove(this.glowIn);
      if (this.glowOut) this.glowTex.onAfterUnbindObservable.remove(this.glowOut);
    });
    this.bindGlow();
  }

  /**
   * Puts the glow's two brackets on whichever main texture the layer is
   * rendering into now, and does nothing at all while that is the one they are
   * already on.
   *
   * See the fields for why this is POLLED rather than subscribed: the texture
   * is re-created on a size change, and the observable that announces one fires
   * BEFORE the replacement exists, so being told is worth less here than one
   * reference comparison at the end of a frame.
   *
   * Both observers move together and both are registered ONCE per texture,
   * which is the header's no-allocation rule reaching a method that runs inside
   * `scene.render()`: a one-shot close added per open would be a closure per
   * frame, on the recording path, in the instrument built to catch exactly
   * that.
   */
  private bindGlow(): void {
    const tex = this.glowLayer?.mainTexture ?? null;
    if (tex === this.glowTex) return;
    if (this.glowTex) {
      if (this.glowIn) this.glowTex.onBeforeBindObservable.remove(this.glowIn);
      if (this.glowOut) this.glowTex.onAfterUnbindObservable.remove(this.glowOut);
    }
    this.glowTex = tex;
    this.glowIn = null;
    this.glowOut = null;
    if (!tex) return;
    this.glowIn = tex.onBeforeBindObservable.add(() => this.begin(P.glow));
    this.glowOut = tex.onAfterUnbindObservable.add(() => this.endAdd(P.glow));
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
    // One reference comparison, here rather than in `beginFrame`, because the
    // texture it is watching for is re-created INSIDE the render this frame has
    // just finished — see `bindGlow`.
    this.bindGlow();
    // The collections the sentinel reported since the last frame closed, and
    // the heap they left behind. `gcPending` is cleared here rather than in the
    // callback, so a collection that fires between two frames lands on the one
    // it interrupted.
    const gc = this.gcPending;
    this.gcPending = 0;
    this.gcAt![i] = gc > 255 ? 255 : gc;
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
   * Freezes the ring into a report. The capture gesture, and the only thing
   * here that allocates.
   *
   * `full` carries the complete per-frame series, which is what the download is
   * for; the compact form is summary plus the worst frames, sized to survive a
   * phone's clipboard.
   */
  capture(reason: string, full = false): ProfileReport | null {
    // TWO frames, not one: a row's wall clock is written by the frame AFTER
    // it, so a ring holding one frame holds no COMPLETED frame at all.
    if (!this.on || this.filled < 2) return null;
    const report = this.buildReport(reason, full);
    this.lastReport = report;
    return report;
  }

  /** The last capture, for a smoke script or a retry at the clipboard. */
  last(): ProfileReport | null {
    return this.lastReport;
  }

  private buildReport(reason: string, full: boolean): ProfileReport {
    const cap = this.capacity;
    // **The window is every row whose interval is KNOWN, which is all of them
    // but the newest.** A row's wall clock is written by the frame after it
    // (see `endFrame`), so the row the cursor has just left is still waiting
    // for its own, and a zero in the series would read as an instant frame.
    //
    // It buys an invariant worth having: `spanMs` is `frameAt` of the newest
    // row minus `frameAt` of the oldest, which telescopes to exactly the sum
    // of the intervals in the window — so `window.seconds` and
    // `series.frameMs` now describe the same stretch of time, which they did
    // not before.
    const n = this.filled - 1;
    const first = (this.cursor - this.filled + cap) % cap;
    const frames = new Float64Array(n);
    for (let k = 0; k < n; k++) frames[k] = this.frameMs![(first + k) % cap];
    const frameStats = stats(frames, n);
    const spanMs = this.frameAt![(this.cursor - 1 + cap) % cap] - this.frameAt![first];

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
      phases: {},
    };
    if (full) {
      for (let k = 0; k < n; k++) {
        const i = (first + k) % cap;
        series.frameMs.push(round(frames[k]));
        series.gc.push(this.gcAt![i]);
        series.heapMb.push(this.heapMb ? round(this.heapMb[i], 2) : 0);
        series.drawCalls.push(this.drawCalls![i]);
        series.activeMeshes.push(this.activeMeshes![i]);
        series.loafMs.push(round(this.loafMs![i]));
      }
    }

    for (let slot = 0; slot < SLOTS; slot++) {
      let count = 0;
      const column: number[] = [];
      for (let k = 0; k < n; k++) {
        const at = ((first + k) % cap) * SLOTS + slot;
        const hit = this.entered![at] === 1;
        if (hit) scratch[count++] = this.durMs![at];
        if (full) column.push(hit ? round(this.durMs![at]) : 0);
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
      if (s.mean < this.grainMs) belowGrain.push(name);
      if (full) series.phases[name] = column;
    }
    // Biggest first, which is the only order anybody reads this in.
    phases.sort((a, b) => b.mean - a.mean);

    return {
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
      version: 7,
      takenAt: new Date().toISOString(),
      reason,
      map: this.mapId,
      tree: PARENT_OF,
      roots: [...ROOTS],
      device: this.deviceFacts(),
      clock: {
        grainMs: round(this.grainMs, 4),
        overheadUs: round(this.overheadUs, 3),
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
        hitches: this.hitchAt.length,
        hitchThresholdMs: round(this.hitchBarMs, 1),
        baselineMs: round(this.baselineMs),
      },
      memory: this.memoryFacts(first, n, cap, spanMs),
      loaf: this.loafFacts(first, n, cap),
      counters: this.counterMeans(first, n, cap),
      phases,
      hitches: this.worstHitches(),
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
  private memoryFacts(
    first: number,
    n: number,
    cap: number,
    spanMs: number,
  ): ProfileReport["memory"] {
    const seconds = spanMs > 0 ? spanMs / 1000 : 0;
    // Summed over the RING rather than kept as a running total — see `gcPending`
    // on the bug that was.
    let gc = 0;
    for (let k = 0; k < n; k++) gc += this.gcAt![(first + k) % cap];
    let sum = 0;
    let peak = 0;
    let risen = 0;
    if (this.heapMb) {
      let prev = this.heapMb[first];
      for (let k = 0; k < n; k++) {
        const v = this.heapMb[(first + k) % cap];
        sum += v;
        if (v > peak) peak = v;
        if (v > prev) risen += v - prev;
        prev = v;
      }
    }
    return {
      heapLive: this.heapLive,
      heapMb: this.heapLive ? round(sum / n, 2) : 0,
      heapPeakMb: this.heapLive ? round(peak, 2) : 0,
      allocMbPerSec: this.heapLive && seconds > 0 ? round(risen / seconds, 2) : 0,
      gcObserved: this.gcReg !== null,
      gcEvents: gc,
      gcPerSec: seconds > 0 ? round(gc / seconds, 2) : 0,
    };
  }

  private counterMeans(first: number, n: number, cap: number): ProfileReport["counters"] {
    let draws = 0;
    let meshes = 0;
    let walk = 0;
    let rtt = 0;
    let particles = 0;
    for (let k = 0; k < n; k++) {
      const i = (first + k) % cap;
      draws += this.drawCalls![i];
      meshes += this.activeMeshes![i];
      walk += this.meshWalkMs![i];
      rtt += this.rttMs![i];
      particles += this.particlesMs![i];
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
   * What the browser said about this window — see `ProfileReport.loaf`.
   *
   * Summed over the ROWS of the window rather than counted as they arrived, for
   * the reason `memoryFacts` sums `gcAt`: a running total outlives its own
   * ring and reports a rate the session never ran at.
   */
  private loafFacts(
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
    if (this.loafMs) {
      for (let k = 0; k < n; k++) {
        const i = (first + k) % cap;
        const ms = this.loafMs[i];
        if (ms <= 0) continue;
        rows++;
        // Only a HEAD row's numbers are added, or one window is counted once
        // per row it covers — see `loafHead`.
        if (this.loafHead![i] !== 1) continue;
        entries++;
        total += ms;
        blocking += this.loafBlockMs![i];
        script += this.loafScriptMs![i];
        render += this.loafRenderMs![i];
      }
    }
    return {
      supported: this.loafSupported,
      floorMs: LOAF_FLOOR_MS,
      entries,
      rows,
      totalMs: round(total),
      blockingMs: round(blocking),
      scriptMs: round(script),
      renderMs: round(render),
      worst: this.worstLoaf(),
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
  private worstLoaf(): LoafFrame[] {
    if (!this.frameAt || this.filled === 0) return [];
    const cap = this.capacity;
    const newest = this.frameAt[(this.cursor - 1 + cap) % cap];
    const out: LoafFrame[] = [];
    for (const r of this.loafWorst) {
      if (this.frameAt[r.at] !== r.when) continue;
      out.push({
        ago: round((newest - r.when) / 1000, 2),
        frameMs: round(this.frameMs![r.at]),
        durationMs: round(r.durationMs),
        blockingMs: round(r.blockingMs),
        scriptMs: round(r.scriptMs),
        renderMs: round(r.renderMs),
        top: r.top,
      });
    }
    out.sort((a, b) => b.durationMs - a.durationMs);
    return out;
  }

  /** The worst frames in the ring, whole. Sorted by cost, not by time. */
  private worstHitches(): HitchFrame[] {
    const cap = this.capacity;
    const newest = this.frameAt![(this.cursor - 1 + cap) % cap];
    const seen = new Set<number>();
    const out: HitchFrame[] = [];
    for (let k = this.hitchAt.length - 1; k >= 0; k--) {
      const i = this.hitchAt[k];
      if (seen.has(i)) continue;
      seen.add(i);
      const phases: Partial<Record<Phase, number>> = {};
      for (let slot = 0; slot < SLOTS; slot++) {
        const at = i * SLOTS + slot;
        if (this.entered![at] === 1) phases[PHASES[slot]] = round(this.durMs![at]);
      }
      out.push({
        ago: round((newest - this.frameAt![i]) / 1000, 2),
        frameMs: round(this.frameMs![i]),
        x: round(this.px![i], 1),
        y: round(this.py![i], 1),
        z: round(this.pz![i], 1),
        botsAlive: this.botsAlive![i],
        gc: this.gcAt![i],
        heapMb: this.heapMb ? round(this.heapMb[i], 2) : 0,
        loafMs: round(this.loafMs![i]),
        loafBlockMs: round(this.loafBlockMs![i]),
        loafScriptMs: round(this.loafScriptMs![i]),
        loafRenderMs: round(this.loafRenderMs![i]),
        drawCalls: this.drawCalls![i],
        activeMeshes: this.activeMeshes![i],
        meshWalkMs: round(this.meshWalkMs![i]),
        renderTargetsMs: round(this.rttMs![i]),
        particlesMs: round(this.particlesMs![i]),
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
   * moment, and that is this whole file's one design decision applied to the
   * one place it had been left out.** The ring holds `CONFIG.profiling.frames`
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
  trace(maxFrames = 600): string {
    // `< 2` for `capture`'s reason: the newest row has no wall clock yet.
    if (!this.on || this.filled < 2) return "{}";
    const cap = this.capacity;
    const n = Math.min(this.filled, maxFrames);
    const oldest = (this.cursor - this.filled + cap) % cap;

    // The worst frame in the WHOLE ring, by wall clock — the same measure the
    // hitch list ranks by, so the trace and the report agree about which frame
    // is the interesting one.
    let worstAt = 0;
    let worstMs = -1;
    for (let k = 0; k < this.filled - 1; k++) {
      const ms = this.frameMs![(oldest + k) % cap];
      if (ms > worstMs) {
        worstMs = ms;
        worstAt = k;
      }
    }

    // Centre, then clamp. The clamp is what keeps the window FULL at either end
    // of the ring instead of running off it.
    let startAt = worstAt - (n >> 1);
    if (startAt < 0) startAt = 0;
    if (startAt + n > this.filled) startAt = this.filled - n;
    const first = (oldest + startAt) % cap;
    const t0 = this.frameAt![first];
    const worstBase = (this.frameAt![(oldest + worstAt) % cap] - t0) * 1000;

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
        this.filled +
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
      const base = (this.frameAt![i] - t0) * 1000;
      for (let slot = 0; slot < SLOTS; slot++) {
        const at = i * SLOTS + slot;
        if (this.entered![at] !== 1) continue;
        const ts = base + this.startMs![at] * 1000;
        const dur = this.durMs![at] * 1000;
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
          this.drawCalls![i] +
          ',"activeMeshes":' +
          this.activeMeshes![i] +
          "}}",
      );
      if (this.heapMb) {
        parts.push(
          '{"name":"heapMb","ph":"C","pid":1,"tid":1,"ts":' +
            base.toFixed(1) +
            ',"args":{"usedMb":' +
            this.heapMb[i].toFixed(2) +
            "}}",
        );
      }
      // An INSTANT rather than a counter track, because that is what a
      // collection is and it is what puts a marker straight down the flame
      // chart at the frame it landed on. `s:"g"` is global scope, which is how
      // Perfetto draws it across the whole timeline.
      if (this.gcAt![i] > 0) {
        parts.push(
          '{"name":"gc","cat":"memory","ph":"i","s":"g","pid":1,"tid":1,"ts":' +
            base.toFixed(1) +
            ',"args":{"count":' +
            this.gcAt![i] +
            "}}",
        );
      }
    }
    return '{"displayTimeUnit":"ms","traceEvents":[' + parts.join(",") + "]}";
  }

  private deviceFacts(): ProfileReport["device"] {
    const nav = navigator as Navigator & { deviceMemory?: number };
    const engine = this.scene?.getEngine();
    return {
      userAgent: navigator.userAgent,
      devicePixelRatio: window.devicePixelRatio || 1,
      window: `${window.innerWidth}x${window.innerHeight}`,
      backingStore: engine
        ? `${engine.getRenderWidth()}x${engine.getRenderHeight()}`
        : "?",
      hardwareConcurrency: navigator.hardwareConcurrency || 0,
      deviceMemoryGb: nav.deviceMemory ?? null,
    };
  }

  /**
   * What one `begin`/`end` pair costs on THIS device, in microseconds.
   *
   * Recorded into every capture, because an instrument that does not state its
   * own cost is one nobody can subtract — and at ~26 pairs a frame it is worth
   * knowing whether that is 5 us or 200.
   */
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
   * double-counting — `loafFacts` sums per ROW and says so.
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
