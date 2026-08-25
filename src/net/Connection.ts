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
 * the server's `Date.now()`, and interpolation needs to place those stamps on
 * the local timeline — two machines' wall clocks can differ by minutes, so the
 * stamps are useless raw.
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
 */
import { CONFIG } from "../config";
import { decode, encode, PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from "./protocol";

export type ConnectionState = "idle" | "connecting" | "open" | "closed";

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
  private offset = 0;

  /** Best estimate of the server's clock, in ms. */
  now(): number {
    return Date.now() + this.offset;
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
    this.offset = best;
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
