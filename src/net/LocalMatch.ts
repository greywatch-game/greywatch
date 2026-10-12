/**
 * net/LocalMatch.ts — The OWNER's channel to a match the page hosts itself
 * (`BABYLON_EXIT.md` X2.5c C3): the calls it makes, the answers it hears, and
 * the dial that puts a person into that match over a port.
 * Owns: the owner's half of the channel — the call counter, the calls
 * awaiting an answer, and the words both halves speak (`OwnerMessage`,
 * `OwnerReply`). The host's half is `server/localMatch.ts`, reached in a
 * Worker (`server/localMatchWorker.ts`) or on a `MessageChannel` in this
 * thread, and this file cannot tell which: it is handed an `OwnerPort`.
 * Invariants:
 * - **This is not a `ClientMessage`, and no remote client can say it.** It
 *   travels its own port, the host reads it with no claim gate, and
 *   `server/wire.ts` never sees it — what it can do (begin a round on a seed,
 *   step the clock, end the match) is the OWNER's and nobody else's.
 * - **A person is not the owner.** The page's own player joins through
 *   `dial`, as a peer over the protocol's JSON (`portTransport`), validated
 *   as any remote peer is; the owner channel only ever carries the match.
 * - **The host answers calls in the order they were posted**, each after
 *   every call before it has finished — `begin` included, which builds a
 *   world. So any call is a SETTLE: its answer says everything posted ahead
 *   of it has run. That is what the benchmark's fight read relies on.
 * Never: import from `server/` — the page reaches the host only through a
 * port.
 */
import type { FrameTiming } from "../sim/frame";
import { portTransport, type ClientTransport } from "./transport";

/**
 * Whatever the owner channel runs over: the page's `Worker`, the Worker's own
 * scope, or one end of a `MessageChannel` — the three already share this
 * shape, so nothing is wrapped.
 */
export interface OwnerPort {
  postMessage(message: unknown, transfer: Transferable[]): void;
  onmessage: ((ev: MessageEvent) => void) | null;
}

/** The owner's calls, each answered once (`OwnerReply`). */
export type OwnerCall =
  /**
   * Build a match on `map`: owned, so its clock, its rounds and its end are
   * this channel's. `timeOrigin` is the page's `performance.timeOrigin`, so
   * a step's timing reads on the page's clock wherever the host runs.
   * Refused while a match is open: `close` it first.
   */
  | { t: "open"; map: string; timeOrigin: number }
  /** Begin a round — the first or the next — on this seed and difficulty (`Match.begin`). */
  | { t: "begin"; seed: number; difficulty: number }
  /**
   * `dt` seconds onto the match's clock (`Match.advance`), answered with
   * what that stepped. `timed`: time the steps for the profiler's `sim` root.
   */
  | { t: "advance"; dt: number; timed: boolean }
  /** The benchmark's fight starts here: awards and deaths folded from this tick. */
  | { t: "markFight" }
  /** The fight's hash so far — after every call before it (the settle). */
  | { t: "fight" }
  /** End the match (`Match.close`): every peer told and let go, the world disposed. */
  | { t: "close" };

/** What crosses the channel to the host: a call, or a person's port. */
export type OwnerMessage =
  | (OwnerCall & { call: number })
  /** A port for one more peer, transferred, its far end the page's (`dial`). Unanswered. */
  | { t: "connect"; port: MessagePort };

/** What `advance` stepped. */
export interface Advanced {
  /** Whole steps this advance took — 0 when it held less than one, or the round is held. */
  steps: number;
  /** The round has a winner: it ended on a step, and nothing steps until the next `begin`. */
  ended: boolean;
  /**
   * The LAST step's phases on the page's clock, when it was timed and
   * something stepped; null otherwise.
   */
  timing: FrameTiming | null;
}

/** …and what comes back, one per call, in the order the calls went. */
export type OwnerReply =
  | { t: "done"; call: number }
  | ({ t: "advanced"; call: number } & Advanced)
  | { t: "fight"; call: number; hex: string; events: number }
  | { t: "failed"; call: number; message: string };

/** A call awaiting its answer. */
interface Waiting {
  resolve(reply: OwnerReply): void;
  reject(err: Error): void;
}

export class LocalMatch {
  /**
   * Wired by the owner: an `advance` was answered. Not a promise per call —
   * the page posts one every frame and reads the newest answer, so nothing
   * here waits on it.
   */
  onAdvanced: (advanced: Advanced) => void = () => {};
  /**
   * Wired by the owner: a call nobody is awaiting failed — an `advance`
   * whose step threw. The match is then the owner's to `close`.
   */
  onFailed: (message: string) => void = (message) => console.error(`[local match] ${message}`);

  private nextCall = 1;
  private readonly waiting = new Map<number, Waiting>();

  constructor(private readonly host: OwnerPort) {
    host.onmessage = (ev: MessageEvent<OwnerReply>) => this.answered(ev.data);
  }

  open(map: string): Promise<void> {
    return this.call({ t: "open", map, timeOrigin: performance.timeOrigin }).then(() => {});
  }

  begin(round: { seed: number; difficulty: number }): Promise<void> {
    return this.call({ t: "begin", seed: round.seed, difficulty: round.difficulty }).then(() => {});
  }

  /** Posted, never awaited: the answer arrives through `onAdvanced`. */
  advance(dt: number, timed: boolean): void {
    this.post({ t: "advance", dt, timed });
  }

  markFight(): Promise<void> {
    return this.call({ t: "markFight" }).then(() => {});
  }

  /** The benchmark's fight hash and how many awards and deaths it folds. */
  async fight(): Promise<{ hex: string; events: number }> {
    const reply = await this.call({ t: "fight" });
    if (reply.t !== "fight") throw new Error(`[local match] fight answered "${reply.t}"`);
    return { hex: reply.hex, events: reply.events };
  }

  close(): Promise<void> {
    return this.call({ t: "close" }).then(() => {});
  }

  /**
   * A person's way into the match — `JoinOptions.dial`. A fresh port per
   * call, one end handed to the host, which reads the `join` off it as the
   * server reads one off a socket; the other end is the person's transport.
   */
  dial(): ClientTransport {
    const { port1, port2 } = new MessageChannel();
    const msg: OwnerMessage = { t: "connect", port: port2 };
    this.host.postMessage(msg, [port2]);
    return portTransport(port1);
  }

  private post(call: OwnerCall): number {
    const id = this.nextCall++;
    const msg: OwnerMessage = { ...call, call: id };
    this.host.postMessage(msg, []);
    return id;
  }

  private call(call: OwnerCall): Promise<OwnerReply> {
    return new Promise((resolve, reject) => {
      this.waiting.set(this.post(call), { resolve, reject });
    });
  }

  private answered(reply: OwnerReply): void {
    const waiting = this.waiting.get(reply.call);
    if (!waiting) {
      if (reply.t === "advanced") this.onAdvanced(reply);
      else if (reply.t === "failed") this.onFailed(reply.message);
      return;
    }
    this.waiting.delete(reply.call);
    if (reply.t === "failed") waiting.reject(new Error(reply.message));
    else waiting.resolve(reply);
  }
}
