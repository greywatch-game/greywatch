/**
 * src/sim/simHost.ts — **The page's door into the simulation core, wherever
 * the core runs** (`BABYLON_EXIT.md` X2.5b): `SimHost`, the one interface
 * `core/Game.ts` holds the core through, and its two transports — the core
 * in THIS thread (`PageSimHost`, exactly X2.5a's arrangement) and the core in
 * a Worker over shared memory (`WorkerSimHost`, `simWorker.ts`).
 * Owns: the interface, both transports, the handshake between the page and
 * the Worker (the control block, the two command buffers, the two
 * publications), and `openSimHost`, the boot's choice of transport.
 * Invariants:
 * - **One interface, one code path in `Game`.** Nothing `Game` does depends on
 *   WHEN the core answers: a command is submitted and its consequences are
 *   heard through `drain` and read off `frame` whenever they arrive — at once
 *   in the page, a frame later from a Worker. So `submit` returns nothing
 *   (`SimCore.submit`'s courtesy boolean is the authority's), and the page
 *   decides what it predicts off its own state, as a match's client does.
 * - **A STEP is the one operation that overlaps the page's frame.** `step(dt)`
 *   on the Worker transport takes in the last operation's publication (waiting
 *   for it if the Worker is still running it — `waitMs`, the profiler's
 *   `simWait`) and STARTS the next step, which runs while the page draws: so
 *   the frame a step leaves readable is the PREVIOUS step's, and `step`
 *   returns that step's answer. Bots and everything else are a frame ahead of
 *   the picture, and the local player — on the page, with the camera — is not.
 * - **Everything else is an operation in turn**: `pump` sends what was
 *   submitted on a frame that did not step and takes in what came back
 *   without waiting; the round's own calls (`startRound`, `addPlayer`,
 *   `removePlayer`, `releaseWorld`) and `settle` wait for their answer. The
 *   Worker runs one operation at a time and the page never sends the next
 *   before it has taken in the last, which is what makes each buffer one
 *   side's at a time — no lock anywhere.
 * - **Allocation-free per frame on both threads**: commands are encoded into
 *   shared float64s (`commandCodec.ts`), the frame and the news are copied
 *   into views both sides hold (`publication.ts`), and the signal is an
 *   `Atomics` store. A posted message is a ROUND's cost (`startRound` carries
 *   the world as data), never a frame's.
 * - **The core reads no clock the Worker owns for an outcome.** The step's
 *   `dt` is the page's (the benchmark's fixed step survives the hop), and the
 *   one clock the Worker's core is handed is its timing clock, converted onto
 *   the page's `timeOrigin` so the profiler files it without a conversion.
 * Never: let `Game` see a `SimCore`. `local` is the in-page core, for the DEV
 * mirror check alone (`?simcheck`), and null from a Worker.
 */
import type { Team } from "../entities/Combatant";
import { EventRing, type EventCursor } from "./events";
import { newFrame, type SimFrame } from "./frame";
import type { SimCommand } from "./commands";
import { encodeCommand, MAX_COMMAND } from "./commandCodec";
import { PublicationReader, newPublicationBuffer } from "./publication";
import { SimCore, type RoundSpec } from "./SimCore";
import {
  CTL,
  CTL_BYTES,
  CTL_DT,
  CTL_F64_AT,
  OP,
  type HostMessage,
  type WorkerMessage,
} from "./hostWire";

export interface SimHost {
  /** Where the core runs — what the boot says and every profiler capture carries. */
  readonly mode: "worker" | "page";
  /** Why it runs there, in a sentence (the boot's console line). */
  readonly why: string;
  /** The standing round as the core last published it (`src/sim/frame.ts`). */
  readonly frame: SimFrame;
  /** Moves whenever `frame` may say something new — a reader may skip a sync while it has not. */
  readonly version: number;
  /**
   * The page's own clock, ms, `step` has spent waiting for the Worker to
   * finish the step it takes in, since `clearWait` — 0 in the page. A round's
   * calls wait too (a world is built), and are not counted: they are the
   * building card's, not a frame's.
   */
  readonly waitMs: number;
  /** The in-page core, for the DEV mirror check; null from a Worker. */
  readonly local: SimCore | null;
  startRound(spec: RoundSpec): void;
  addPlayer(slot: number, team: Team): void;
  removePlayer(slot: number): void;
  releaseWorld(): void;
  /** `SimCore.firstSlotOf`, answered off the frame (the pool is laid out in two equal blocks). */
  firstSlotOf(team: Team): number;
  submit(slot: number, cmd: SimCommand): void;
  /** One step of the world; false once the round the readable frame belongs to has ended. */
  step(dt: number): boolean;
  /** A frame that steps nothing: take in what arrived, send what was submitted. True when something new was taken in. */
  pump(): boolean;
  /** Everything sent, answered and readable before this returns — the benchmark's last frame. */
  settle(): void;
  timeSteps(on: boolean): void;
  drain(out: EventCursor): void;
  /** Takes `waitMs` back to zero — read it first. */
  clearWait(): void;
}

/**
 * The core in this thread — X2.5a's arrangement, kept whole: every call is
 * the core's own, applied at once, so a command's news is drained in the
 * same call that submitted it and a step's frame is the step just taken. The
 * fallback where there is no cross-origin isolation, and the mode `?simcheck`
 * and `?simcopy` need (`openSimHost`).
 */
export class PageSimHost implements SimHost {
  readonly mode = "page";
  readonly waitMs = 0;
  readonly local: SimCore;
  version = 0;

  constructor(readonly why: string) {
    this.local = new SimCore({
      hostHoldsRespawn: true,
      publish: true,
      rewind: true,
      timing: () => performance.now(),
    });
  }

  get frame(): SimFrame {
    return this.local.frame;
  }

  startRound(spec: RoundSpec): void {
    this.local.startRound(spec);
    this.version++;
  }

  addPlayer(slot: number, team: Team): void {
    this.local.addPlayer(slot, team);
    this.version++;
  }

  removePlayer(slot: number): void {
    this.local.removePlayer(slot);
    this.version++;
  }

  releaseWorld(): void {
    this.local.releaseWorld();
    this.version++;
  }

  firstSlotOf(team: Team): number {
    return this.local.firstSlotOf(team);
  }

  submit(slot: number, cmd: SimCommand): void {
    this.local.submit(slot, cmd);
    this.version++;
  }

  step(dt: number): boolean {
    this.version++;
    return this.local.step(dt);
  }

  pump(): boolean {
    return false;
  }

  settle(): void {}

  timeSteps(on: boolean): void {
    this.local.timeSteps(on);
  }

  drain(out: EventCursor): void {
    this.local.drain(out);
  }

  clearWait(): void {}
}

/** How long the page waits for one operation before calling the Worker lost, ms. */
const STEP_PATIENCE_MS = 10_000;
const ROUND_PATIENCE_MS = 120_000;
/** …and for a new Worker to say it is up, before the boot falls back to the page. */
const READY_PATIENCE_MS = 20_000;

/**
 * The core in a Worker, over shared memory. See the file header for the
 * handshake; every method here is one of its moves.
 */
export class WorkerSimHost implements SimHost {
  readonly mode = "worker";
  readonly local = null;
  version = 0;
  waitMs = 0;

  private readonly ctl: Int32Array;
  private readonly ctlF64: Float64Array;
  /** Length-tracking views on the two growable command buffers. */
  private readonly cmd: Float64Array[];
  private readonly cmdSab: SharedArrayBuffer[];
  private readonly reader: PublicationReader;
  /** Everything taken in and not yet drained, in order. */
  private readonly ring = new EventRing();
  /** The last operation sent, and the last one taken in. */
  private sent = 0;
  private taken = 0;
  /** Float64s submitted for the next operation. */
  private cmdLen = 0;
  /** The last STEP's answer — what a step returns while it is the readable one. */
  private live = true;
  private front: SimFrame = newFrame();
  /** What the last `take` spent spinning, ms. */
  private waited = 0;

  constructor(
    readonly why: string,
    private readonly worker: Worker,
    ctl: SharedArrayBuffer,
    cmd: SharedArrayBuffer[],
    pub: SharedArrayBuffer[],
  ) {
    this.ctl = new Int32Array(ctl, 0, CTL_F64_AT / 4);
    this.ctlF64 = new Float64Array(ctl, CTL_F64_AT, 8);
    this.cmdSab = cmd;
    this.cmd = cmd.map((sab) => new Float64Array(sab));
    this.reader = new PublicationReader(pub);
  }

  get frame(): SimFrame {
    return this.front;
  }

  /** The command buffer the next operation reads. */
  private get pending(): number {
    return (this.sent + 1) & 1;
  }

  submit(slot: number, cmd: SimCommand): void {
    const b = this.pending;
    let buf = this.cmd[b];
    if (this.cmdLen + MAX_COMMAND > buf.length) {
      const sab = this.cmdSab[b];
      sab.grow(Math.min(sab.maxByteLength, sab.byteLength * 2));
      buf = this.cmd[b];
    }
    this.cmdLen = encodeCommand(buf, this.cmdLen, slot, cmd);
  }

  /** Starts operation `op` with everything submitted since the last one. */
  private send(op: number, dt = 0): void {
    const b = this.pending;
    Atomics.store(this.ctl, b === 0 ? CTL.cmdLen0 : CTL.cmdLen1, this.cmdLen);
    this.cmdLen = 0;
    this.ctlF64[CTL_DT] = dt;
    Atomics.store(this.ctl, CTL.op, op);
    this.sent++;
    Atomics.store(this.ctl, CTL.seq, this.sent);
    Atomics.notify(this.ctl, CTL.seq);
  }

  /**
   * Takes in the last operation's publication — waiting for the Worker to
   * finish it when `wait`, else only if it already has. True when one was
   * taken in.
   */
  private take(wait: boolean, patience = STEP_PATIENCE_MS): boolean {
    this.waited = 0;
    if (this.taken === this.sent) return false;
    if (Atomics.load(this.ctl, CTL.done) !== this.sent) {
      if (!wait) return false;
      // The page cannot `Atomics.wait` — the main thread may not block — so
      // it spins, and what the spin costs is measured (`waitMs`).
      const t0 = performance.now();
      let spins = 0;
      while (Atomics.load(this.ctl, CTL.done) !== this.sent) {
        if ((++spins & 0xffff) === 0 && performance.now() - t0 > patience) {
          throw new Error(`[sim] the Worker did not answer operation ${this.sent} in ${patience} ms`);
        }
      }
      this.waited = performance.now() - t0;
    }
    if (Atomics.load(this.ctl, CTL.failed) !== 0) {
      throw new Error("[sim] the simulation Worker failed — see the Worker's console");
    }
    const b = this.sent & 1;
    this.front = this.reader.read(b);
    this.reader.appendEvents(b, this.ring);
    if (this.reader.op(b) === OP.step) this.live = this.reader.live(b);
    this.taken = this.sent;
    this.version++;
    return true;
  }

  step(dt: number): boolean {
    this.take(true);
    this.waitMs += this.waited;
    if (!this.live) return false;
    this.send(OP.step, dt);
    return true;
  }

  pump(): boolean {
    const took = this.take(false);
    if (this.taken === this.sent && this.cmdLen > 0) this.send(OP.apply);
    return took;
  }

  settle(): void {
    this.take(true);
    if (this.cmdLen > 0) {
      this.send(OP.apply);
      this.take(true);
    }
  }

  /** A round's call: everything before it applied, the call posted, its answer taken in. */
  private call(msg: HostMessage): void {
    this.take(true);
    this.worker.postMessage(msg);
    this.send(OP.message);
    this.take(true, ROUND_PATIENCE_MS);
  }

  startRound(spec: RoundSpec): void {
    const { def, ...rest } = spec;
    this.call({ t: "startRound", spec: { ...rest, map: def.id } });
    this.live = true;
  }

  addPlayer(slot: number, team: Team): void {
    this.call({ t: "addPlayer", slot, team });
  }

  removePlayer(slot: number): void {
    this.call({ t: "removePlayer", slot });
  }

  releaseWorld(): void {
    this.call({ t: "releaseWorld" });
  }

  firstSlotOf(team: Team): number {
    return team === 0 ? 0 : this.front.bots.count / 2;
  }

  timeSteps(on: boolean): void {
    Atomics.store(this.ctl, CTL.timed, on ? 1 : 0);
  }

  drain(out: EventCursor): void {
    this.ring.drainInto(out);
  }

  clearWait(): void {
    this.waitMs = 0;
  }
}

/**
 * The boot's choice (`main.ts`, awaited before `Game` is built, as Havok
 * is): a Worker when the page is cross-origin isolated and the browser has
 * growable `SharedArrayBuffer`s, the page otherwise — and the page whenever a
 * URL switch needs the core in this thread: `?simpage` asks for it,
 * `?simcheck` holds every mirror to the live core, `?simcopy` rehearses the
 * clone boundary the Worker replaces. A Worker that fails to come up falls
 * back too, and says so.
 */
export async function openSimHost(flags: { simpage: boolean; simcheck: boolean; simcopy: boolean }): Promise<SimHost> {
  if (flags.simpage) return new PageSimHost("asked for by ?simpage");
  if (flags.simcheck) return new PageSimHost("?simcheck holds the mirrors to the core in this thread");
  if (flags.simcopy) return new PageSimHost("?simcopy rehearses the boundary in this thread");
  if (!globalThis.crossOriginIsolated) {
    return new PageSimHost("the page is not cross-origin isolated (no COOP/COEP headers)");
  }
  if (typeof SharedArrayBuffer === "undefined" || typeof SharedArrayBuffer.prototype.grow !== "function") {
    return new PageSimHost("this browser has no growable SharedArrayBuffer");
  }
  const ctl = new SharedArrayBuffer(CTL_BYTES);
  const cmd = [0, 1].map(
    () => new SharedArrayBuffer(16 * 1024, { maxByteLength: 4 * 1024 * 1024 }),
  );
  const pub = [newPublicationBuffer(), newPublicationBuffer()];
  let worker: Worker;
  try {
    worker = new Worker(new URL("./simWorker.ts", import.meta.url), { type: "module", name: "sim" });
  } catch (err) {
    return new PageSimHost(`the Worker could not be created (${String(err)})`);
  }
  const up = await new Promise<string | null>((resolve) => {
    // A Worker that loads and never answers must not hold the boot for ever:
    // past this, the page runs the core itself.
    const timer = setTimeout(() => resolve(`no answer in ${READY_PATIENCE_MS} ms`), READY_PATIENCE_MS);
    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      clearTimeout(timer);
      resolve(e.data.t === "ready" ? null : e.data.message);
    };
    worker.onerror = (e) => {
      e.preventDefault();
      clearTimeout(timer);
      resolve(e.message || "the Worker's script failed to load");
    };
    const init: HostMessage = { t: "init", ctl, cmd, pub, timeOrigin: performance.timeOrigin };
    worker.postMessage(init);
  });
  if (up !== null) {
    worker.terminate();
    return new PageSimHost(`the Worker did not come up (${up})`);
  }
  // After it is up, the Worker says nothing it is not asked; a script error
  // inside an operation is reported through the control block instead.
  worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
    if (e.data.t === "error") console.error(`[sim] Worker: ${e.data.message}`);
  };
  return new WorkerSimHost("cross-origin isolated", worker, ctl, cmd, pub);
}
