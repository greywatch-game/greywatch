/**
 * net/Connection.ts — The connection to a match: lifetime, reconnection, and
 * the clock offset every interpolated body is drawn against.
 * Owns: the transport it is dialled over (`transport.ts` — a WebSocket to a
 * match server, or a port to a match the page hosts), the inbound message
 * callback, and the estimate of what time it is on
 * the server. Owns no game state — it hands decoded messages upward and knows
 * nothing about rosters, soldiers or rounds, nor which kind of transport it
 * is holding.
 * Invariants: never simulates and never interprets. A message arrives, is
 * decoded, and is handed on; anything that decides what a message MEANS belongs
 * to whoever wired `onMessage`.
 *
 * **The clock offset is the load-bearing part.** Every snapshot is stamped with
 * the server's own clock, and interpolation needs to place those stamps on the
 * local timeline — two machines' wall clocks can differ by minutes, so the
 * stamps are useless raw. (What that clock IS is the server's business and
 * deliberately not this file's: it is the SIMULATION's, advancing by exactly
 * one step per tick, because a stamp is only ever read against the position it
 * arrived with — `SimCore.now`.)
 *
 * One sample is `serverNow - localNow` measured when the message is HANDLED,
 * which is `trueOffset - delay` for a delay made of transit plus however long
 * the main thread took to get to it. That delay is never negative, so every
 * sample UNDERSTATES the offset and the best estimate in a window is the
 * MAXIMUM — the sample that happened to be least delayed. Averaging would bake
 * in the mean queueing delay, and taking the minimum (which this did at first)
 * deliberately picks the worst-delayed sample in the window and drags render
 * time that much further behind. It showed up as a 342 ms apparent skew between
 * a server and a client on the same machine.
 *
 * **What that estimate is, and how fast it is OBEYED, are two questions.** The
 * maximum answers the first and says nothing about the second, and the second
 * is what a player sees: `renderTime` is where every remote body is drawn, so
 * a step in the offset is a step in the instant the whole world is posed at.
 * Applied raw it steps twice for one reason — up the moment a luckier packet
 * arrives, and back DOWN five seconds later when that packet ages out of the
 * window and a lesser sample becomes the maximum. The second is the sharp one:
 * render time going backwards is every body in the match rewinding together,
 * once per window on any link whose best case wanders, and worth the better
 * part of a metre on something moving at gunship speed.
 *
 * So the estimate is SLEWED rather than assigned — `offset` chases `target` at
 * `SLEW`, a share of real time small enough that the resulting 2% error in the
 * rate remote motion plays at is not a thing anybody can see, where the jump it
 * replaces plainly is. A disagreement too big to be jitter is not drift and is
 * taken whole: see `SNAP_MS`.
 *
 * **The server's timeline is the authority's; WHERE ON IT this client draws a
 * frame is this client's, and it is read at the instant the frame is SEEN.**
 * Nothing here decides when anything happened — the stamps do. What the local
 * clock decides is which instant of that history to pose this frame at, and a
 * reading taken whenever the code got the thread poses frames that are shown an
 * even 33.3 ms apart at instants 31, 36, 33 ms apart: every remote body
 * stutters, and `NetSoldier` reads the same jitter as a change of walking pace.
 * So `now` and `renderTime` are read at the frame's REFRESH timestamp, handed
 * in once a frame by `setFrame` — the client's half of the rule `SimCore.now`
 * is the server's half of, a stamp on the clock the motion is actually on. It
 * is also what the authority's REWIND is owed: a shot's `time` is the instant
 * the bodies on screen were posed at, exactly, rather than a few milliseconds
 * of main thread later.
 *
 * **One local clock for everything, and it is `performance.now()`'s.** The
 * frame timestamp is on it, so the offset has to be sampled on it too or the
 * two disagree by whatever separates the two clocks; and it is monotonic and
 * sub-millisecond where `Date.now()` is neither. The offset absorbs the
 * difference in origin, as it already absorbs two machines' wall clocks.
 */
import { CONFIG } from "../config";
import { decode, encode, PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from "./protocol";
import { socketTransport, type ClientTransport } from "./transport";

export type ConnectionState = "idle" | "connecting" | "open" | "closed";

/**
 * How fast the applied clock offset is allowed to chase the estimate, as a
 * share of real time.
 *
 * It is a RATE and not a step, which is the whole point — see the header. At
 * 0.02 a 40 ms shift in a link's latency floor is absorbed over two seconds,
 * during which remote bodies play at 0.98x or 1.02x. Both figures are the trade
 * being made: fast enough that a genuine change in the route is tracked well
 * inside the five-second window that produced it, slow enough that the price is
 * a speed error two orders of magnitude below what the stamps themselves used
 * to cost.
 */
const SLEW = 0.02;

/**
 * How far the estimate may be from the applied offset before it is taken whole
 * instead of chased, in ms.
 *
 * A quarter of a second is not jitter and is not drift: it is a reconnect, a
 * match rotation, or the first sample of a session, and the honest answer to
 * all three is one visible correction now rather than twelve seconds of
 * everything being drawn at the wrong instant. It is comfortably above the
 * worst spread any of the three tolerable causes produces, which is what stops
 * it firing on the case it exists to smooth over.
 */
const SNAP_MS = 250;

/** How often the silence timer looks, in ms — once a second is plenty against `silenceTimeout`. */
const LISTEN_EVERY_MS = 1000;

/**
 * Everything the handshake needs, as one object.
 *
 * An object rather than four positional strings — `connect(name, url, weapon,
 * matchId)` is a signature where transposing any two of the last three still
 * typechecks and joins the wrong thing, which is the same reason `MenuState`
 * exists next door in the UI layer.
 */
export interface JoinOptions {
  name: string;
  /** Where to reach the server. Same-origin `/ws` when absent. Ignored with `dial`. */
  url?: string;
  /**
   * How to reach the match when it is not a server at a URL: a fresh
   * transport per attempt, a retry dialling again — a local match's port
   * (`LocalMatch.dial`). Absent, a WebSocket to `url`.
   */
  dial?: () => ClientTransport;
  weapon?: string;
  /**
   * The anti-tank item in the third slot. Resolved by the SERVER against its
   * own table, exactly as `weapon` is — see `Join.equipment`.
   */
  equipment?: string;
  /** The throwable in the pouch, on `equipment`'s terms — see `Join.throwable`. */
  throwable?: string;
  /** A specific match from the lobby. Absent means "wherever there is room". */
  matchId?: string;
  /** Ask for a fresh match instead of filling one. Ignored with `matchId`. */
  create?: boolean;
  /**
   * Which map a match created by this join should be started on. Ignored when
   * the join lands in a match that already exists — see `Join.map`.
   */
  map?: string;
  /**
   * Whether a match created by this join should field bots. `map`'s twin, and
   * ignored in the same case for the same reason — see `Join.bots`.
   */
  bots?: boolean;
}

export class Connection {
  state: ConnectionState = "idle";

  /** Wired by the owner: a decoded message arrived. */
  onMessage: (msg: ServerMessage) => void = () => {};
  /** Wired by the owner: the connection opened, or gave up for good. */
  onStateChange: (state: ConnectionState) => void = () => {};

  private transport: ClientTransport | null = null;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private join: JoinOptions = { name: "player" };
  private closedByUs = false;
  /** Whoever is waiting on `joinSent`. Settled together, never one at a time. */
  private joinWaiters: Array<() => void> = [];
  /** How the standing attempt was dialled — what a retry dials again. */
  private dial: (() => ClientTransport) | null = null;
  /**
   * When the standing attempt last showed it was alive — dialled, opened, or
   * a message — on `performance.now()`'s clock. What the silence timer
   * (`listen`) measures.
   */
  private heardAt = 0;
  /** When the silence timer last looked, to tell this page's own stall from the server's. */
  private lookAt = 0;
  private listener: ReturnType<typeof setInterval> | null = null;

  /**
   * Recent `serverNow - localNow` samples, in ms. Bounded by `clockWindow`
   * seconds' worth of snapshots.
   */
  private readonly offsets: number[] = [];
  /** The estimate: the maximum of the window. See the header. */
  private target = 0;
  /** What is actually applied, chasing `target` at `SLEW`. */
  private offset = 0;
  /** Local time the slew was last advanced, so it is a rate and not a step. */
  private slewAt = 0;
  /**
   * The instant the frame now running is SEEN, on `performance.now()`'s clock
   * — set by `setFrame`, 0 until the first. See the header.
   */
  private frameAt = 0;

  /**
   * Hands in the refresh timestamp of the frame about to be drawn
   * (`FrameCap.refreshAt`). `Game.tick`'s, before anything reads the clock; a
   * 0 is ignored, so the first frame reads the live clock instead.
   */
  setFrame(refreshAt: number): void {
    if (refreshAt > 0) this.frameAt = refreshAt;
  }

  /**
   * Best estimate of the server's clock, in ms, at the instant this frame is
   * seen — every read inside one frame is the same instant, which is what
   * lets the bodies, the grenades, the hulls and a shot's stamp agree.
   */
  now(): number {
    const local = this.frameAt > 0 ? this.frameAt : performance.now();
    this.slew(local);
    return local + this.offset;
  }

  /**
   * Moves the applied offset toward the estimate, by however much real time has
   * passed since this last ran.
   *
   * Driven from the READ rather than from the transport, because this is the
   * only place that has to be right: `now` and `renderTime` are what the world
   * is posed against, and they are asked several times a frame
   * (`NetSession.update`) at the one instant `setFrame` fixed — so the first
   * ask of a frame spends the gap since the last and the rest find none.
   * Stepping this on message ARRIVAL would make the rate a function of the
   * jitter it exists to absorb.
   */
  private slew(local: number): void {
    // Clamped, and read BEFORE the early returns so a stretch spent already on
    // target cannot bank real time and spend it as a step on the first frame
    // the estimate moves. The upper bound is a tab that was backgrounded: rAF
    // stops, and the frame that arrives when it resumes would otherwise carry a
    // minute of credit, which is the whole budget at once.
    const elapsed = Math.min(Math.max(local - this.slewAt, 0), 1000);
    this.slewAt = local;

    const gap = this.target - this.offset;
    if (gap === 0) return;
    // Not drift. A reconnect, a rotation, or the first sample of a session —
    // and a session's first sample is the case that makes this an `abs` rather
    // than a test on the far side only: `offset` starts at 0, which is a
    // decades-wide disagreement in whichever direction the two clocks lie.
    if (Math.abs(gap) > SNAP_MS) {
      this.offset = this.target;
      return;
    }
    // A bounded RATE, never overshooting: `renderTime` therefore advances at
    // between 0.98x and 1.02x of real time while a correction is being spent,
    // and at exactly 1x the rest of the time.
    const step = Math.min(Math.abs(gap), SLEW * elapsed);
    this.offset += gap > 0 ? step : -step;
  }

  /**
   * The instant other bodies should be drawn at: far enough behind the server
   * that the samples bracketing it have already arrived.
   */
  renderTime(): number {
    return this.now() - CONFIG.net.interpDelay * 1000;
  }

  connect(opts: JoinOptions): void {
    this.join = opts;
    this.closedByUs = false;
    // A new join is a new clock. `retry` reaches `open` directly and keeps the
    // window, which is right — it is the same server and the same offset — but
    // this is the door a region switch comes through, and a window of samples
    // from the machine that was being played on a moment ago is a maximum that
    // holds render time in the wrong place for the whole of a new match's first
    // five seconds.
    this.offsets.length = 0;
    this.target = 0;
    this.offset = 0;
    this.slewAt = 0;
    // Annotated `string`, not inferred: `CONFIG` is `as const`, so taking the
    // default inline would narrow it to the literal `"/ws"` and refuse every
    // caller that passes a real URL. The documented gotcha in CLAUDE.md.
    const url: string = opts.url ?? CONFIG.net.url;
    this.open(opts.dial ?? (() => socketTransport(url)));
  }

  /**
   * Fixes this connection to the match it actually landed in.
   *
   * Called by whoever reads the `welcome` — this file does not interpret
   * messages — and it exists because of RECONNECTION. A retry re-sends the
   * original join, so a client that opened with `create: true` would stand up
   * a brand new match on every dropped socket, abandoning the one it was
   * playing in and burning through the server's match cap in a bad minute. It
   * also turns a reconnect into a genuine rejoin: the same match is asked for
   * by name, and if that match is gone the server says so rather than dropping
   * the player into a stranger's round.
   */
  pinMatch(matchId: string): void {
    this.join = { ...this.join, matchId, create: false };
  }

  private open(dial: () => ClientTransport): void {
    this.setState("connecting");
    const transport = dial();
    this.transport = transport;
    this.dial = dial;
    this.heardAt = performance.now();
    if (transport.watched) this.listen();

    transport.listen({
      opened: () => {
        if (this.transport === transport) this.heardAt = performance.now();
        this.attempts = 0;
        this.setState("open");
        this.send({
          t: "join",
          version: PROTOCOL_VERSION,
          name: this.join.name,
          matchId: this.join.matchId,
          create: this.join.create,
          map: this.join.map,
          bots: this.join.bots,
          weapon: this.join.weapon,
          equipment: this.join.equipment,
          throwable: this.join.throwable,
        });
        this.settleJoin();
      },

      message: (text) => {
        // Before the decode: a frame that does not parse is still the far
        // end alive.
        if (this.transport === transport) this.heardAt = performance.now();
        const msg = decode(text) as ServerMessage | null;
        if (!msg) return;
        // Every stamped message is a clock sample, not just an explicit ping —
        // snapshots arrive twenty times a second and carry `now`, so the
        // estimate stays fresh for free.
        if ("now" in msg && typeof msg.now === "number") this.sample(msg.now);
        this.onMessage(msg);
      },

      closed: () => {
        // An attempt this connection has already let go of — closed by us, or
        // replaced — says nothing about the one standing.
        if (this.transport !== transport) return;
        this.transport = null;
        // An attempt that never opened has nothing to send a join down, and a
        // build waiting on it would wait out every retry behind a card. One
        // attempt is the whole of what `joinSent` promises to wait for.
        this.settleJoin();
        if (this.closedByUs) return this.setState("closed");
        this.retry(dial);
      },
    });
  }

  private retry(dial: () => ClientTransport): void {
    if (this.attempts >= CONFIG.net.reconnectMax) {
      this.setState("closed");
      return;
    }
    this.attempts++;
    this.setState("connecting");
    // Linear rather than exponential: a match server that dropped everyone is
    // usually restarting, and a client that has backed off to thirty seconds
    // rejoins a round that is already over.
    const delay = CONFIG.net.reconnectDelay * 1000 * this.attempts;
    this.retryTimer = setTimeout(() => this.open(dial), delay);
  }

  /**
   * Starts the SILENCE TIMER, if it is not already running: a connection to
   * a match server that has heard nothing at all for
   * `CONFIG.net.silenceTimeout` is dead, whatever the socket says, and is
   * let go and retried exactly as a closed one is (`retry`).
   *
   * **A socket can stay open with nothing coming through it** — a network
   * that died without a goodbye, or a server whose loop wedged behind a
   * proxy that holds this side open — and a page is shown no ping, so what
   * arrives is the one thing it can watch. Measured from the DIAL, so an
   * attempt that never opens (a wedged server's upgrade nobody answers) is
   * let go too. Only a transport that is `watched`: a local match's owner
   * holds its clock, and its host has a watchdog of its own (`LocalMatch`).
   *
   * **A stall of the PAGE's own is not the server's** — a long build on this
   * thread, a throttled background tab, a debugger — and through it the
   * server's messages sit queued behind this very callback, unread. So a
   * look that itself arrives far later than it was due restarts the wait
   * instead of judging it, as `LocalMatch.watch` does.
   *
   * One interval for the life of the connection rather than a timer per
   * message: snapshots arrive twenty times a second. Stopped when the
   * connection is `closed` (`setState`).
   */
  private listen(): void {
    if (this.listener !== null) return;
    this.lookAt = performance.now();
    this.listener = setInterval(() => this.look(), LISTEN_EVERY_MS);
  }

  /** The silence timer's look — see `listen`. */
  private look(): void {
    const now = performance.now();
    const late = now - this.lookAt > 2 * LISTEN_EVERY_MS;
    this.lookAt = now;
    const transport = this.transport;
    // Between attempts (a retry's delay), or a transport whose silence says
    // nothing: there is nobody to judge.
    if (!transport?.watched || !this.dial) return;
    if (late) {
      this.heardAt = now;
      return;
    }
    const silent = now - this.heardAt;
    if (silent <= CONFIG.net.silenceTimeout * 1000) return;
    console.warn(`[net] nothing from the match server in ${Math.round(silent / 1000)} s; reconnecting`);
    // Let go BEFORE closing, so the `closed` the close raises — whenever a
    // socket over a dead network gets round to it — is an attempt this
    // connection has already replaced, and says nothing (`open`).
    this.transport = null;
    transport.close();
    this.settleJoin();
    this.retry(this.dial);
  }

  private sample(serverNow: number): void {
    // The LIVE clock, not the frame's: a sample is when the message was
    // handled, and the frame instant is whenever the last refresh was. Same
    // clock as `frameAt`, which is the header's second rule.
    this.offsets.push(serverNow - performance.now());
    const keep = Math.max(2, Math.ceil(CONFIG.net.clockWindow * 20));
    while (this.offsets.length > keep) this.offsets.shift();
    // Maximum, not mean and NOT minimum — see the note at the top of the file.
    // Every sample is the true offset minus a non-negative delay, so the
    // largest one in the window is the closest to the truth.
    let best = this.offsets[0];
    for (const o of this.offsets) if (o > best) best = o;
    // The ESTIMATE. What is applied chases it — assigning here is the step the
    // header describes, and it steps down as well as up, once per window.
    this.target = best;
  }

  send(msg: ClientMessage): void {
    if (this.transport?.open) this.transport.send(encode(msg));
  }

  close(): void {
    this.closedByUs = true;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.transport?.close();
    this.transport = null;
    this.setState("closed");
    this.settleJoin();
  }

  /**
   * Resolves once the transport that is opening has had its `join` sent down
   * it — or has failed to open, or this connection was closed. Immediately
   * when none is opening.
   *
   * **The server gives an anonymous socket ten seconds to say `join`, and the
   * clock starts at the UPGRADE, not when this page gets round to it**
   * (`HANDSHAKE_MS` in `server/index.ts`). The upgrade happens in the
   * browser's network stack while the main thread is busy; the `open` handler
   * that sends the join is a task, and a task cannot run inside another one.
   * So a map build that holds the thread for ten seconds — Cinderhaven's
   * install is one task of about that on a desktop GPU, and a phone is slower —
   * sends its join after the window has shut, and the round it built is torn
   * down by the refusal. Anything about to hold the thread that long while a
   * join is outstanding awaits this first; the wait is a connect, which is
   * milliseconds.
   */
  joinSent(): Promise<void> {
    if (!this.transport?.connecting) return Promise.resolve();
    return new Promise((resolve) => this.joinWaiters.push(resolve));
  }

  private settleJoin(): void {
    const waiters = this.joinWaiters;
    this.joinWaiters = [];
    for (const resolve of waiters) resolve();
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    // Given up for good, or closed by its owner: nothing left to listen to.
    if (state === "closed" && this.listener !== null) {
      clearInterval(this.listener);
      this.listener = null;
    }
    this.onStateChange(state);
  }
}
