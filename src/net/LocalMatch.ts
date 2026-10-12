/**
 * net/LocalMatch.ts — The OWNER's channel to a match the page hosts itself
 * (`BABYLON_EXIT.md` X2.5c C3): the calls it makes, the answers it hears, and
 * the dial that puts a person into that match over a port.
 * Owns: the owner's half of the channel — the call counter, the calls
 * awaiting an answer, and the watchdog over them. The words both halves speak are `localWire.ts`'s; the
 * host's half is `server/localMatch.ts`, reached in a
 * Worker (`server/localMatchWorker.ts`) or on a `MessageChannel` in this
 * thread, and this file cannot tell which: it is handed an `OwnerPort`.
 * Invariants:
 * - **This is not a `ClientMessage`, and no remote client can say it.** It
 *   travels its own port, the host reads it with no claim gate, and
 *   `server/wire.ts` never sees it — what it can do (begin a round on a seed,
 *   step or hold the clock, let a watcher in, end the match) is the OWNER's
 *   and nobody else's.
 * - **A person is not the owner.** The page's own player joins through
 *   `dial`, as a peer over the protocol's JSON (`portTransport`), validated
 *   as any remote peer is; the owner channel only ever carries the match.
 * - **The host answers calls in the order they were posted**, each after
 *   every call before it has finished — `begin` included, which builds a
 *   world. So any call is a SETTLE: its answer says everything posted ahead
 *   of it has run. That is what the benchmark's fight read relies on.
 * - **A dead host is SAID, never waited on** (X2.5c C4, "A port opens
 *   whoever is at the far end"). A WebSocket to a dead server closes; a port
 *   into a Worker that died or wedged says nothing at all, so every awaited
 *   call would hang for ever and a person's `Connection` would sit `open`
 *   on a join nobody reads. Two signals end it: whoever holds the Worker
 *   routes its `onerror` here (`lost`, `localHost.ts`), and this file's own
 *   watchdog calls the host lost when a call has gone unanswered past its
 *   patience (`STALL_PATIENCE_MS`, a build's far longer). Lost is final and raised ONCE (`onLost`): every
 *   awaiting call rejects, every later one rejects at once and posts
 *   nothing, and a later `dial` hears its port close — what a socket to a
 *   dead server hears.
 * Never: import from `server/` — the page reaches the host only through a
 * port (`localHost.ts` holds the one dynamic import, for the host it runs
 * in its own thread); or allocate per frame — `advance` and `hold` are
 * posted every frame, so the watchdog is one interval and a few numbers, never
 * a timer per call.
 */
import { portTransport, type ClientTransport } from "./transport";
import {
  PORT_CLOSE,
  type Advanced,
  type OwnerCall,
  type OwnerMessage,
  type OwnerPort,
  type OwnerReply,
} from "./localWire";

/** A call awaiting its answer. */
interface Waiting {
  resolve(reply: OwnerReply): void;
  reject(err: Error): void;
}

/**
 * How long the host may owe an answer before it is called lost, in ms — two
 * numbers, because the calls are two kinds and one patience would be wrong
 * for one of them.
 *
 * Everything but a build is a step or less — milliseconds even on a phone —
 * and the page posts one a frame, so ten seconds of silence while one is owed
 * is a host that has stopped, not one that is slow, and the player hears it
 * inside the time they would spend wondering why the world froze.
 *
 * A BUILD (`open`, `begin`) is the slowest honest answer there is: it loads
 * the map's bake and floor — a fetch, on a first visit — and builds the
 * simulation's world (nav, cover, the ray and sweep structures), seconds on a
 * desktop for the biggest map and several times that on a phone; and every
 * call posted behind it waits it out, since the host answers in order. So
 * while one is owed the patience is X2.5b's for the same build
 * (`src/sim/simHost.ts`'s round patience): two minutes, past anything a
 * device has been seen to take, against the alternative of a building card
 * for ever. A stall the page caused itself is not the host's (`watch`).
 */
const STALL_PATIENCE_MS = 10_000;
const BUILD_PATIENCE_MS = 120_000;

/** How often the watchdog looks, in ms — once a second is plenty against thirty. */
const WATCH_EVERY_MS = 1000;

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
  /**
   * Wired by the owner: the host is LOST — its Worker raised an error, or a
   * call went unanswered past its patience (`STALL_PATIENCE_MS`, the
   * header). Raised once, after
   * every awaiting call has rejected; the owner ends the session on it, since
   * nothing on the far side is ever going to answer again.
   */
  onLost: (reason: string) => void = (reason) => console.error(`[local match] lost: ${reason}`);

  private nextCall = 1;
  private readonly waiting = new Map<number, Waiting>();
  /** The last call the host has answered — calls are answered in order, so every one before it has been too. */
  private answeredThrough = 0;
  /**
   * Since when the host has owed an answer, in ms (`performance.now`): the
   * post of the first call after a quiet spell, or the last answer while
   * calls are still owed. What the watchdog measures — "the host has said
   * nothing for this long while owing something" — and two numbers rather
   * than a stamp per call, so a posted `advance` costs nothing here.
   */
  private owedSince = 0;
  /** The last build (`open`, `begin`) posted: while it is owed, the patience is a build's. */
  private buildCall = 0;
  /** When the watchdog last looked, to tell the page's own stall from the host's. */
  private lastWatch = 0;
  private readonly watchdog: ReturnType<typeof setInterval>;
  /** Why the host was lost, once it has been; null while it stands. Final. */
  private lostWhy: string | null = null;

  constructor(private readonly host: OwnerPort) {
    host.onmessage = (ev: MessageEvent<OwnerReply>) => this.answered(ev.data);
    this.lastWatch = performance.now();
    this.watchdog = setInterval(() => this.watch(), WATCH_EVERY_MS);
  }

  /** Whether the host has been lost (`lost`): a lost match answers nothing again. */
  get isLost(): boolean {
    return this.lostWhy !== null;
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

  /**
   * `dt` seconds the owner HELD the world (`Match.hold`): the match's clock
   * passes and nothing steps. Posted, never awaited, like `advance` — its
   * `done` finds nobody waiting and is dropped (`answered`). The owner posts
   * it every frame for the part of the frame's real time it did not step,
   * and only while a round stands: a hold with none is refused, and the
   * refusal arrives through `onFailed`.
   */
  hold(dt: number): void {
    this.post({ t: "hold", dt });
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
   *
   * `watch`: dial a WATCHER rather than a person (`Match.watch`) — welcomed
   * at no slot and seated nowhere, so the round it is drawn is the one the
   * owner is measuring, unmoved. The OWNER's word, on the owner channel:
   * nothing the person's port says can ask for it.
   *
   * On a lost host the port's far end says `PORT_CLOSE` at once, so the
   * `Connection` holding it hears what a socket to a dead server hears.
   */
  dial(opts: { watch?: boolean } = {}): ClientTransport {
    const { port1, port2 } = new MessageChannel();
    if (this.lostWhy !== null) {
      port2.postMessage(PORT_CLOSE);
      port2.close();
      return portTransport(port1);
    }
    const msg: OwnerMessage = { t: "connect", port: port2, watch: opts.watch ?? false };
    this.host.postMessage(msg, [port2]);
    return portTransport(port1);
  }

  /**
   * The host is gone, for `reason` — whoever holds the Worker calls this from
   * its `onerror` (`localHost.ts`), and the watchdog calls it on a stall. See
   * the header. Idempotent: the first reason is the one kept and raised.
   */
  lost(reason: string): void {
    if (this.lostWhy !== null) return;
    this.lostWhy = reason;
    clearInterval(this.watchdog);
    const err = new Error(`[local match] lost: ${reason}`);
    for (const waiting of this.waiting.values()) waiting.reject(err);
    this.waiting.clear();
    this.onLost(reason);
  }

  /**
   * Stops the watchdog, for an owner done with this channel for good (a
   * harness exiting). Calls still owed are left to the host; nothing here is
   * raised.
   */
  dispose(): void {
    clearInterval(this.watchdog);
  }

  /** The id posted, or 0 when the host is lost and nothing was posted. */
  private post(call: OwnerCall): number {
    if (this.lostWhy !== null) return 0;
    const id = this.nextCall++;
    // Nothing was owed: the wait starts with this call.
    if (id === this.answeredThrough + 1) this.owedSince = performance.now();
    if (call.t === "open" || call.t === "begin") this.buildCall = id;
    const msg: OwnerMessage = { ...call, call: id };
    this.host.postMessage(msg, []);
    return id;
  }

  private call(call: OwnerCall): Promise<OwnerReply> {
    if (this.lostWhy !== null) {
      return Promise.reject(new Error(`[local match] lost: ${this.lostWhy}`));
    }
    return new Promise((resolve, reject) => {
      this.waiting.set(this.post(call), { resolve, reject });
    });
  }

  /**
   * The watchdog's look: lost when calls are owed and the host has answered
   * none of them for its patience (`STALL_PATIENCE_MS`). **A stall of the PAGE's own is not
   * the host's** — a debugger paused on a breakpoint, a hidden tab whose
   * timers the browser throttled, a long synchronous build on this thread —
   * and through it the host's answers sit queued behind this very callback,
   * unread. So a look that itself arrives far later than it was due restarts
   * the wait instead of judging it: what is measured is the host's silence
   * while this thread was LISTENING.
   */
  private watch(): void {
    const now = performance.now();
    const late = now - this.lastWatch > 2 * WATCH_EVERY_MS;
    this.lastWatch = now;
    if (this.answeredThrough >= this.nextCall - 1) return;
    if (late) {
      this.owedSince = now;
      return;
    }
    const patience = this.answeredThrough < this.buildCall ? BUILD_PATIENCE_MS : STALL_PATIENCE_MS;
    if (now - this.owedSince > patience) {
      this.lost(`no answer in ${patience / 1000} s — the match's host has stopped`);
    }
  }

  private answered(reply: OwnerReply): void {
    if (this.lostWhy !== null) return;
    this.answeredThrough = reply.call;
    // Anything still owed has its wait counted from this answer: the moment
    // the host could start on it.
    this.owedSince = performance.now();
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
