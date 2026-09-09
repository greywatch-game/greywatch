/**
 * net/Connection.ts — The socket to the match server: lifetime, reconnection,
 * and the clock offset every interpolated body is drawn against.
 * Owns: the WebSocket, the inbound message callback, and the estimate of what
 * time it is on the server. Owns no game state — it hands decoded messages
 * upward and knows nothing about rosters, soldiers or rounds.
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
 * arrived with — `HeadlessGame.now`.)
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
 */
import { CONFIG } from "../config";
import { decode, encode, PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from "./protocol";

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
  /** Where to reach the server. Same-origin `/ws` when absent. */
  url?: string;
  weapon?: string;
  /**
   * The anti-tank item in the third slot. Resolved by the SERVER against its
   * own table, exactly as `weapon` is — see `Join.equipment`.
   */
  equipment?: string;
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

  private socket: WebSocket | null = null;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private join: JoinOptions = { name: "player" };
  private closedByUs = false;

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

  /** Best estimate of the server's clock, in ms. */
  now(): number {
    const local = Date.now();
    this.slew(local);
    return local + this.offset;
  }

  /**
   * Moves the applied offset toward the estimate, by however much real time has
   * passed since this last ran.
   *
   * Driven from the READ rather than from the frame or from the socket, because
   * this is the only place that has to be right: `now` and `renderTime` are
   * what the world is posed against, they are asked several times a frame
   * (`NetSession.update`), and the first ask of a frame is what fixes the
   * instant for all of them. A frame hook would be a second thing to keep in
   * step with them for no gain, and stepping this on message ARRIVAL would make
   * the rate a function of the jitter it exists to absorb.
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
    this.open(url);
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

  private open(url: string): void {
    // A relative path so a deployed build reaches the same origin it was served
    // from, which is what the nginx `/ws` proxy expects. An absolute ws:// URL
    // is still accepted, for a dev client pointed at a server on another port.
    const absolute = /^wss?:\/\//.test(url)
      ? url
      : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${url}`;

    this.setState("connecting");
    const socket = new WebSocket(absolute);
    this.socket = socket;

    socket.addEventListener("open", () => {
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
      });
    });

    socket.addEventListener("message", (ev) => {
      const msg = decode(String(ev.data)) as ServerMessage | null;
      if (!msg) return;
      // Every stamped message is a clock sample, not just an explicit ping —
      // snapshots arrive twenty times a second and carry `now`, so the estimate
      // stays fresh for free.
      if ("now" in msg && typeof msg.now === "number") this.sample(msg.now);
      this.onMessage(msg);
    });

    socket.addEventListener("close", () => {
      this.socket = null;
      if (this.closedByUs) return this.setState("closed");
      this.retry(url);
    });

    // `error` is always followed by `close`, so reconnection is handled there
    // and this exists only so an unhandled event does not reach the console as
    // an uncaught error.
    socket.addEventListener("error", () => {});
  }

  private retry(url: string): void {
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
    this.retryTimer = setTimeout(() => this.open(url), delay);
  }

  private sample(serverNow: number): void {
    this.offsets.push(serverNow - Date.now());
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
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(encode(msg));
    }
  }

  close(): void {
    this.closedByUs = true;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.socket?.close();
    this.socket = null;
    this.setState("closed");
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.onStateChange(state);
  }
}
