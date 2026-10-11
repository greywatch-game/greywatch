/**
 * src/sim/simWorker.ts — The simulation core in a Worker (`BABYLON_EXIT.md`
 * X2.5b): the Worker half of `WorkerSimHost`'s handshake, and nothing else.
 * Owns: this thread's one `SimCore` — built as the page's in-page core is
 * (`PageSimHost`: the host holds the respawn clock, the frame is published,
 * a person's round is rewound) — and the loop that runs one operation at a
 * time: apply the commands the page submitted (`commandCodec.ts`), step or
 * not, then publish the frame and everything the core said into the
 * operation's shared buffer (`publication.ts`) and mark it done.
 * Invariants:
 * - **It waits on `Atomics.wait` and on nothing else between operations**,
 *   which is allowed in a Worker and allocates nothing — so it does not hear
 *   a posted message while it waits. A round's call (`OP.message`) is the one
 *   operation that RETURNS to the event loop: the page posts the call, then
 *   signals, and this thread applies the commands, returns, takes the call
 *   off its queue, answers it, and goes back to waiting.
 * - **The core reads no clock of this thread's for anything that decides.**
 *   Its `dt` is the page's, carried in the control block, so a fixed step
 *   stays fixed across the hop; its one clock is the profiler's timing clock,
 *   moved onto the PAGE's `timeOrigin` here so a reading files on the page
 *   without a conversion.
 * - **A failure is reported, never swallowed into a hang.** An operation that
 *   throws marks the control block failed AND done, so the page — which
 *   spins on `done` — throws it on rather than waiting for ever.
 * Never: import a view, the DOM or Babylon (`scripts/check-babylon-free.mjs`
 * walks this directory), or read a URL. The map is named by id and looked up
 * in `MAPS`, because a `MapDef` holds import thunks and cannot be posted.
 */
import { MAPS } from "../world/maps";
import { EventCursor, EventRing } from "./events";
import { SIM_PHASES } from "./frame";
import { CommandDecoder } from "./commandCodec";
import { PublicationWriter } from "./publication";
import { SimCore } from "./SimCore";
import {
  CTL,
  CTL_DT,
  CTL_F64_AT,
  OP,
  type HostMessage,
  type WorkerMessage,
} from "./hostWire";

const SIM_PUBLISH = SIM_PHASES.indexOf("publish");

let core: SimCore | null = null;
let ctl: Int32Array;
let ctlF64: Float64Array;
let cmd: Float64Array[] = [];
let writer: PublicationWriter;
const decoder = new CommandDecoder();
/**
 * One drain of the core, and everything an operation said, in order. The core
 * is drained after EVERY call made on it — each submit and the step — as its
 * contract asks of any host (`SimCore.drain`: the per-call state it resets),
 * and each drain is appended here; the publication is written from all of it.
 */
const drained = new EventCursor();
const said = new EventRing();
const cursor = new EventCursor();

/** The core's news since the last drain, appended to what this operation has said. */
function drainCore(): void {
  core!.drain(drained);
  said.append(drained.kinds, drained.ticks, drained.data, drained.ints, drained.count, drained.intCount);
}
/** The last operation this thread saw. */
let seen = 0;
/** The last step's answer, carried by an operation that did not step. */
let live = true;
/** Whether the step being published was timed — its copy is added to the timing. */
let timed = false;
/** `performance.now()` here, onto the page's clock. */
let toPage = 0;

/** This thread's own scope — a Worker's, which the DOM lib does not describe. */
const scope = self as unknown as {
  postMessage(msg: WorkerMessage): void;
  onmessage: ((e: MessageEvent<HostMessage>) => void) | null;
};
const say = (msg: WorkerMessage): void => scope.postMessage(msg);

/** The commands the page submitted for operation `seq`, applied in order. */
function applyCommands(seq: number): void {
  const b = seq & 1;
  const len = Atomics.load(ctl, b === 0 ? CTL.cmdLen0 : CTL.cmdLen1);
  const src = cmd[b];
  let o = 0;
  while (o < len) {
    o = decoder.next(src, o);
    core!.submit(decoder.slot, decoder.cmd);
    drainCore();
  }
}

/** Operation `seq`'s answer into its buffer, then marked done. */
function publish(seq: number, op: number): void {
  const c = core!;
  const frame = c.frame;
  // Only a step's publication carries a step's timing; any other operation's
  // would file the last step a second time.
  if (op !== OP.step || !timed) frame.timing.total = -1;
  drainCore();
  said.drainInto(cursor);
  const b = seq & 1;
  if (op === OP.step && timed) {
    const t0 = performance.now();
    writer.write(b, frame, cursor, live, op);
    // The copy into shared memory is the Worker's half of publishing, added
    // to the core's own fill (`SIM_PHASES`' `publish`) and to the step, and
    // the timing written again.
    const ms = performance.now() - t0;
    frame.timing.ms[SIM_PUBLISH] += ms;
    frame.timing.total += ms;
    writer.retime(b, frame);
  } else {
    writer.write(b, frame, cursor, live, op);
  }
  finish(seq);
}

function finish(seq: number): void {
  Atomics.store(ctl, CTL.done, seq);
  Atomics.notify(ctl, CTL.done);
}

function fail(seq: number, err: unknown): void {
  const message = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
  console.error(`[sim worker] operation ${seq} failed:`, err);
  Atomics.store(ctl, CTL.failed, 1);
  finish(seq);
  say({ t: "error", message });
}

/**
 * Waits for the page's next operation and runs it, for as long as there are
 * operations — returning only for a round's call, which the posted message
 * that follows completes (`onmessage`).
 */
function loop(): void {
  for (;;) {
    Atomics.wait(ctl, CTL.seq, seen);
    const seq = Atomics.load(ctl, CTL.seq);
    if (seq === seen) continue;
    seen = seq;
    try {
      applyCommands(seq);
      const op = Atomics.load(ctl, CTL.op);
      if (op === OP.message) return;
      timed = false;
      if (op === OP.step) {
        timed = Atomics.load(ctl, CTL.timed) === 1;
        core!.timeSteps(timed);
        live = core!.step(ctlF64[CTL_DT]);
      }
      publish(seq, op);
    } catch (err) {
      fail(seq, err);
    }
  }
}

scope.onmessage = (e: MessageEvent<HostMessage>) => {
  const msg = e.data;
  if (msg.t === "init") {
    try {
      ctl = new Int32Array(msg.ctl, 0, CTL_F64_AT / 4);
      ctlF64 = new Float64Array(msg.ctl, CTL_F64_AT, 8);
      cmd = msg.cmd.map((sab) => new Float64Array(sab));
      writer = new PublicationWriter(msg.pub);
      // The page's clock: a reading here plus this offset is a reading there.
      toPage = performance.timeOrigin - msg.timeOrigin;
      core = new SimCore({
        hostHoldsRespawn: true,
        publish: true,
        rewind: true,
        timing: () => performance.now() + toPage,
      });
    } catch (err) {
      say({ t: "error", message: String(err) });
      return;
    }
    say({ t: "ready" });
    loop();
    return;
  }
  // A round's call, signalled as `OP.message` — the commands before it are
  // already applied (`loop`).
  const seq = seen;
  try {
    const c = core!;
    switch (msg.t) {
      case "startRound": {
        const { map, ...rest } = msg.spec;
        const def = MAPS.find((d) => d.id === map);
        if (!def) throw new Error(`no map "${map}" in this build`);
        c.startRound({ ...rest, def });
        live = true;
        break;
      }
      case "addPlayer":
        c.addPlayer(msg.slot, msg.team);
        break;
      case "removePlayer":
        c.removePlayer(msg.slot);
        break;
      case "releaseWorld":
        c.releaseWorld();
        break;
    }
    publish(seq, OP.message);
  } catch (err) {
    fail(seq, err);
  }
  loop();
};
