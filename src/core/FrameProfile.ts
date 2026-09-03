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
  /** The cull cells, the mote field and the shader's eye. */
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
 * `Exclude<Phase, "frame">` is what makes it safe: every phase but the root
 * must name a parent, so **a phase added to `PHASES` does not compile until it
 * has said where it sits** — the arrangement `ScreenStack`'s `SCREENS` uses to
 * stop a new screen shipping without answering its four questions.
 */
export const PARENT_OF: Readonly<Record<Exclude<Phase, "frame">, Phase>> = {
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

/** One frame worth keeping whole, because it was slow. */
export interface HitchFrame {
  /** Seconds before the newest frame in the ring. */
  ago: number;
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
   */
  gc: number;
  heapMb: number;
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
  phases: PhaseStat[];
  hitches: HitchFrame[];
  /** The whole ring, one array per phase. Present only in a FULL report. */
  series?: {
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

    this.on = true;
    this.grainMs = probeGrain();
    this.overheadUs = this.probeOverhead();
    // The third probe, and it answers a question about the BROWSER rather than
    // about the device's speed: whether the heap counter moves at all here.
    // Only if it does is the per-frame read worth taking — see the header.
    this.heapLive = probeHeapLive();
    this.heapMb = this.heapLive ? new Float32Array(n) : null;
    this.watchGc();
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
    this.frameMs![i] = realDeltaMs;
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
    if (realDeltaMs >= this.hitchBarMs) {
      this.hitchAt.push(i);
      this.hitchWhen.push(this.frameT0);
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
    if (!this.on || this.filled === 0) return null;
    const report = this.buildReport(reason, full);
    this.lastReport = report;
    return report;
  }

  /** The last capture, for a smoke script or a retry at the clipboard. */
  last(): ProfileReport | null {
    return this.lastReport;
  }

  private buildReport(reason: string, full: boolean): ProfileReport {
    const n = this.filled;
    const cap = this.capacity;
    const first = (this.cursor - n + cap) % cap;
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
      // 2: the four spans inside `render` and the particle counter.
      version: 2,
      takenAt: new Date().toISOString(),
      reason,
      map: this.mapId,
      tree: PARENT_OF,
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
    if (!this.on || this.filled === 0) return "{}";
    const cap = this.capacity;
    const n = Math.min(this.filled, maxFrames);
    const oldest = (this.cursor - this.filled + cap) % cap;

    // The worst frame in the WHOLE ring, by wall clock — the same measure the
    // hitch list ranks by, so the trace and the report agree about which frame
    // is the interesting one.
    let worstAt = 0;
    let worstMs = -1;
    for (let k = 0; k < this.filled; k++) {
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
