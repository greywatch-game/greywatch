/**
 * net/LocalMatch.ts — The OWNER's channel to a match the page hosts itself
 * (`BABYLON_EXIT.md` X2.5c C3): the calls it makes, the answers it hears, and
 * the dial that puts a person into that match over a port.
 * Owns: the owner's half of the channel — the call counter and the calls
 * awaiting an answer. The words both halves speak are `localWire.ts`'s; the
 * host's half is `server/localMatch.ts`, reached in a
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
import { portTransport, type ClientTransport } from "./transport";
import type { Advanced, OwnerCall, OwnerMessage, OwnerPort, OwnerReply } from "./localWire";

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

  /** Resolves once every call posted before it has run. */
  settle(): Promise<void> {
    return this.call({ t: "settle" }).then(() => {});
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
