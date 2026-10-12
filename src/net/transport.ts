/**
 * net/transport.ts — What `Connection` talks to a match through: a WebSocket
 * to a match server, or a `MessagePort` to a match the page hosts itself
 * (`BABYLON_EXIT.md` X2.5c C3, `server/localMatch.ts`).
 * Owns: the `ClientTransport` shape, its two kinds, and the port's one
 * control word. Owns no message: what crosses either kind is the protocol's
 * JSON text (`protocol.ts`), encoded and decoded above this file, so a local
 * match is reached over exactly the wire a remote one is.
 * Invariants: a transport is ONE attempt — it opens once, closes once and is
 * never reopened; `Connection` dials a fresh one to retry. `closed` is raised
 * when the far end ends the connection or it fails, and need not follow this
 * side's own `close` (a WebSocket's does, a port's does not), so nothing may
 * wait on it after closing.
 * Never: interpret a frame, or hold anything about a round.
 *
 * **A port carries text, and one word that is not.** A string is one
 * protocol frame, either way. `PORT_CLOSE` is what a WebSocket's closing
 * handshake says and a port cannot: a closed port tells the far end nothing,
 * so whichever end closes says so first. The host's half is
 * `server/localMatch.ts`'s `portPeer`, which answers `Match`'s ping itself:
 * the scoreboard's column measures the connection and never the page
 * (`docs/multiplayer.md`), and a port has no connection to measure.
 */

/** What a transport raises into `Connection`, one handler per thing it can say. */
export interface ClientHandlers {
  /** The far end can hear: the join goes down now. */
  opened(): void;
  /** One inbound frame, as text. */
  message(text: string): void;
  /** The far end ended the connection, or it failed — either way it is gone. */
  closed(): void;
}

/** One attempt at a connection to a match, as `Connection` needs it. */
export interface ClientTransport {
  /** Dialled and not yet open — what `Connection.joinSent` waits out. */
  readonly connecting: boolean;
  /** Whether `send` reaches the far end. */
  readonly open: boolean;
  /** One encoded `ClientMessage`. Dropped when not `open`. */
  send(text: string): void;
  /** Ends the connection. Idempotent. */
  close(): void;
  /** Hands this transport its handlers. Called once, right after the dial. */
  listen(handlers: ClientHandlers): void;
}

/** A port's control word: the connection is over. See the header. */
export const PORT_CLOSE = 0;

/**
 * A WebSocket to `url` — a path on this page's own origin (the nginx `/ws`
 * proxy a deployed build expects), or an absolute `ws(s)://` URL for a dev
 * client pointed at a server on another port.
 */
export function socketTransport(url: string): ClientTransport {
  const absolute = /^wss?:\/\//.test(url)
    ? url
    : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${url}`;
  const socket = new WebSocket(absolute);
  return {
    get connecting() {
      return socket.readyState === WebSocket.CONNECTING;
    },
    get open() {
      return socket.readyState === WebSocket.OPEN;
    },
    send(text) {
      if (socket.readyState === WebSocket.OPEN) socket.send(text);
    },
    close: () => socket.close(),
    listen(handlers) {
      socket.addEventListener("open", () => handlers.opened());
      socket.addEventListener("message", (ev) => handlers.message(String(ev.data)));
      socket.addEventListener("close", () => handlers.closed());
      // `error` is always followed by `close`, so the ending is handled there
      // and this exists only so an unhandled event does not reach the console
      // as an uncaught error.
      socket.addEventListener("error", () => {});
    },
  };
}

/**
 * The page's end of a `MessagePort` to a local match — the other end handed
 * to the host by `LocalMatch.dial`. Open a microtask after `listen`, not
 * inside it: a WebSocket never opens inside the call that dialled it, and
 * `Connection` is written against that.
 */
export function portTransport(port: MessagePort): ClientTransport {
  let state: "connecting" | "open" | "closed" = "connecting";
  return {
    get connecting() {
      return state === "connecting";
    },
    get open() {
      return state === "open";
    },
    send(text) {
      if (state === "open") port.postMessage(text);
    },
    close() {
      if (state === "closed") return;
      state = "closed";
      port.postMessage(PORT_CLOSE);
      port.close();
    },
    listen(handlers) {
      port.onmessage = (ev: MessageEvent<string | number>) => {
        const d = ev.data;
        if (typeof d === "string") {
          if (state === "open") handlers.message(d);
        } else if (d === PORT_CLOSE && state !== "closed") {
          state = "closed";
          port.close();
          handlers.closed();
        }
      };
      queueMicrotask(() => {
        if (state !== "connecting") return;
        state = "open";
        handlers.opened();
      });
    },
  };
}
