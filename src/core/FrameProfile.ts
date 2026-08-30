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
 *  - **Nothing allocates while it is recording.** Every array is sized once by
 *    `arm` and written by index thereafter; there is no per-frame object, no
 *    label string and no closure. That is not tidiness: `FINDINGS.md` §1's
 *    leading suspect for the hitch this exists to find is GC, and a profiler
 *    that allocates per frame manufactures the bug it was built to catch.
 *    Captures and reports allocate freely — a capture is a deliberate act, not
 *    a frame.
 *
 * **WHAT IT CAN AND CANNOT SEE, because a table of plausible numbers is worse
 * than no table.** Two limits, both recorded into every capture rather than
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
 *    is one enormous bar. That is why `SceneInstrumentation`'s counters are
 *    carried beside them: the mesh walk, the render-target time and the draw
 *    count are what the big bar is made of. GPU time is NOT here — Babylon can
 *    read it, but only if `timestamp-query` is requested at device creation,
 *    and `main.ts` calls `initAsync()` with no descriptor. That is a boot
 *    change with its own blast radius and is deliberately not in this cut.
 */
import { SceneInstrumentation, type Scene } from "@babylonjs/core";
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
  "glass",
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
  drawCalls: number;
  activeMeshes: number;
  meshWalkMs: number;
  renderTargetsMs: number;
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
  };
  counters: {
    drawCalls: number;
    activeMeshes: number;
    meshWalkMs: number;
    renderTargetsMs: number;
  };
  phases: PhaseStat[];
  hitches: HitchFrame[];
  /** The whole ring, one array per phase. Present only in a FULL report. */
  series?: {
    frameMs: number[];
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

  /** Open spans, as absolute stamps. Zero means "not open". */
  private readonly openAt = new Float64Array(SLOTS);

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
    this.cursor = 0;
    this.filled = 0;
    this.hitchAt = [];
    this.hitchWhen = [];
    this.openAt.fill(0);

    this.scene = scene;
    // Babylon's own counters, and they are the half of the frame the JS spans
    // cannot reach. Constructed here rather than in the ctor because each
    // capture flag hangs observers off the scene, which is a cost a disarmed
    // profiler must not be paying.
    this.instr = new SceneInstrumentation(scene);
    this.instr.captureActiveMeshesEvaluationTime = true;
    this.instr.captureRenderTargetsRenderTime = true;

    this.on = true;
    this.grainMs = probeGrain();
    this.overheadUs = this.probeOverhead();
    // The probe wrote into slot 0 of the ring. Start clean.
    this.durMs.fill(0);
    this.entered.fill(0);
  }

  /** Stops recording and gives the memory back. The last report survives. */
  disarm(): void {
    if (!this.on) return;
    this.on = false;
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
    this.hitchAt = [];
    this.hitchWhen = [];
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
    }
    if (realDeltaMs >= CONFIG.profiling.hitchMs) {
      this.hitchAt.push(i);
      this.hitchWhen.push(this.frameT0);
      // Bounded, and it drops the OLDEST.
      if (this.hitchAt.length > CONFIG.profiling.hitchesKept * 4) {
        this.hitchAt.shift();
        this.hitchWhen.shift();
      }
    }
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
    const series: { frameMs: number[]; phases: Partial<Record<Phase, number[]>> } = {
      frameMs: [],
      phases: {},
    };
    if (full) for (let k = 0; k < n; k++) series.frameMs.push(round(frames[k]));

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
      version: 1,
      takenAt: new Date().toISOString(),
      reason,
      map: this.mapId,
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
      },
      counters: this.counterMeans(first, n, cap),
      phases,
      hitches: this.worstHitches(),
      series: full ? series : undefined,
    };
  }

  private counterMeans(first: number, n: number, cap: number): ProfileReport["counters"] {
    let draws = 0;
    let meshes = 0;
    let walk = 0;
    let rtt = 0;
    for (let k = 0; k < n; k++) {
      const i = (first + k) % cap;
      draws += this.drawCalls![i];
      meshes += this.activeMeshes![i];
      walk += this.meshWalkMs![i];
      rtt += this.rttMs![i];
    }
    return {
      drawCalls: Math.round(draws / n),
      activeMeshes: Math.round(meshes / n),
      meshWalkMs: round(walk / n),
      renderTargetsMs: round(rtt / n),
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
        drawCalls: this.drawCalls![i],
        activeMeshes: this.activeMeshes![i],
        meshWalkMs: round(this.meshWalkMs![i]),
        renderTargetsMs: round(this.rttMs![i]),
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
   * own frame — so a flame chart falls out with no further work. Bounded by
   * default because the whole ring is tens of thousands of events and a hitch
   * lives in the last few hundred frames.
   */
  trace(maxFrames = 600): string {
    if (!this.on || this.filled === 0) return "{}";
    const cap = this.capacity;
    const n = Math.min(this.filled, maxFrames);
    const first = (this.cursor - n + cap) % cap;
    const t0 = this.frameAt![first];
    const parts: string[] = [];
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
