/**
 * server/localMatch.ts — A match the page hosts itself (`BABYLON_EXIT.md`
 * X2.5c C3): one OWNED `Match` at a time, its owner's calls answered off one
 * port and each person admitted off a port of their own.
 * Owns: the open match, the benchmark's fight fold, and the two adapters a
 * port needs — `portPeer`, the `PeerTransport` a person's port is to `Match`,
 * and the handshake that reads a `join` off it, as `server/index.ts` reads
 * one off a socket.
 * Invariants:
 * - **The owner's calls run one at a time, in the order they were posted**
 *   (`LocalMatch`'s header): a call is answered only after every call before
 *   it has finished, so any answer is a settle. A person's port is queued
 *   behind them too, so it is admitted into the match the owner's calls
 *   before it built.
 * - **Everything a person says goes through `Match`'s own door**, the JSON
 *   and every claim gate (`server/wire.ts`), exactly as a remote peer's
 *   does: this file reads the `join` and nothing after it.
 * - **The handshake is the server's minus what only a socket can spend.** No
 *   handshake window, no per-address cap: a port exists only because the
 *   owner dialled it, so there is no anonymous peer to bound. The protocol
 *   version is still checked, as a socket's is — a host and a page from two
 *   builds is the one way the two can disagree.
 * - **The host runs anywhere a port does** — in a Worker
 *   (`localMatchWorker.ts`), on a `MessageChannel` in the page's own thread,
 *   or in Node (`server/corecheck.ts`), the three being one code path.
 * Never: import Node (`node:*`, `ws`) — this file and everything it reaches,
 * `Match` included, runs in a browser; read a URL or the DOM; or read a
 * clock that decides anything — the step's clock is the owner's (`advance`),
 * and the one clock read here, the timing clock, only measures.
 */
import { MAPS } from "../src/world/maps";
import { encode, PROTOCOL_VERSION } from "../src/net/protocol";
import { PORT_CLOSE } from "../src/net/transport";
import type { OwnerCall, OwnerMessage, OwnerPort, OwnerReply } from "../src/net/LocalMatch";
import { EV, SCORE_KINDS, type EventCursor } from "../src/sim/events";
import { FightHash } from "../src/bench/fightHash";
import { Match, type PeerHandlers, type PeerTransport } from "./Match";
import { readClientMessage } from "./wire";

/** The local match's id — on its welcome, and in its log lines. */
const LOCAL_ID = "local";

/**
 * A person's port as `Match` reaches a peer: protocol text both ways, and
 * `PORT_CLOSE` (`src/net/transport.ts`). Its own `close` raises nothing, as
 * `Match` expects of any transport (it drops a peer it closes by hand); the
 * far end's raises `closed`.
 *
 * **A ping is answered HERE, a microtask later.** The scoreboard's column
 * measures the CONNECTION and never how busy the far end's page is — which
 * is why a WebSocket's pong is the browser's network stack's and not the
 * page's script (`docs/multiplayer.md`, "The ping column"). A port has no
 * connection to measure, and the one place its far end could answer is the
 * page's busy thread, so what is left is what a socket's reading also holds:
 * this thread's own delay in getting back to it — about 0.
 */
function portPeer(port: MessagePort): PeerTransport {
  let open = true;
  let handlers: PeerHandlers | null = null;
  return {
    get open() {
      return open;
    },
    send(text) {
      if (open) port.postMessage(text);
    },
    close() {
      if (!open) return;
      open = false;
      port.postMessage(PORT_CLOSE);
      port.close();
    },
    ping() {
      // Never inside the call: a socket's pong cannot arrive while `Match`
      // is still in `pingPeer`, and nothing there is written to expect one.
      queueMicrotask(() => {
        if (open) handlers?.pong();
      });
    },
    listen(raised) {
      handlers = raised;
      port.onmessage = (ev: MessageEvent<string | number>) => {
        const d = ev.data;
        if (typeof d === "string") {
          if (open) raised.message(d);
        } else if (d === PORT_CLOSE && open) {
          open = false;
          port.close();
          raised.closed();
        }
      };
    },
  };
}

/**
 * Serves one owner off `owner` for as long as it stays open: its calls
 * answered in order, and every port it dials admitted into whichever match
 * is open when that port's `join` arrives.
 */
export function serveLocalMatch(owner: OwnerPort): void {
  let match: Match | null = null;
  /** The benchmark's fight, folded from `fightFrom` once marked; null before. */
  let fight: FightHash | null = null;
  let fightFrom = 0;
  /** The call running and those behind it — see the header. */
  let queue: Promise<void> = Promise.resolve();

  const reply = (r: OwnerReply): void => owner.postMessage(r, []);

  const need = (): Match => {
    if (!match) throw new Error("no match is open");
    return match;
  };

  /**
   * The fight's fold — `Game`'s, for the page's own benchmark before this:
   * every award and death, stamped with its tick less the fight's first.
   */
  const hear = (c: EventCursor): void => {
    if (!fight) return;
    for (let i = 0; i < c.count; i++) {
      const kind = c.kind(i);
      if (kind === EV.death) fight.death(c.tick(i) - fightFrom, c.f(i, 0));
      else if (kind === EV.award) {
        fight.award(c.tick(i) - fightFrom, c.f(i, 0), SCORE_KINDS[c.f(i, 1)], c.f(i, 2));
      }
    }
  };

  const answer = async (msg: OwnerCall & { call: number }): Promise<OwnerReply> => {
    const call = msg.call;
    switch (msg.t) {
      case "open": {
        if (match) throw new Error("a match is already open — close it first");
        // Looked up rather than left to `Match`, which falls back to the
        // first map for an id it does not know: right for a peer's ask,
        // wrong for an owner who named the round it is about to play.
        if (!MAPS.some((d) => d.id === msg.map)) throw new Error(`no map "${msg.map}" in this build`);
        // This thread's clock onto the page's, so a step's timing files on
        // the page without a conversion — 0 in the page's own thread.
        const toPage = performance.timeOrigin - msg.timeOrigin;
        fight = null;
        match = new Match(LOCAL_ID, {
          map: msg.map,
          owned: true,
          timing: () => performance.now() + toPage,
          hear,
        });
        return { t: "done", call };
      }
      case "begin":
        fight = null;
        await need().begin({ seed: msg.seed, difficulty: msg.difficulty });
        return { t: "done", call };
      case "advance": {
        const m = need();
        m.game.timeSteps(msg.timed);
        const before = m.game.tick;
        m.advance(msg.dt);
        const steps = m.game.tick - before;
        return {
          t: "advanced",
          call,
          steps,
          ended: m.game.conquest.winner !== null,
          // Cloned as it is posted, so the core's own row is never handed out.
          timing: msg.timed && steps > 0 ? m.game.frame.timing : null,
        };
      }
      case "markFight":
        fightFrom = need().game.tick;
        fight = new FightHash();
        return { t: "done", call };
      case "fight":
        if (!fight) throw new Error("no fight marked");
        return { t: "fight", call, hex: fight.hex, events: fight.events };
      case "close":
        match?.close();
        match = null;
        fight = null;
        return { t: "done", call };
    }
  };

  /**
   * A person's port, from `LocalMatch.dial`: its first message must be a
   * `join` at this build's protocol, and then `Match` owns it — `admit`
   * calls `listen` before its first await, so no frame falls between the
   * two handlers.
   */
  const connect = (port: MessagePort): void => {
    const peer = portPeer(port);
    const refuse = (reason: string): void => {
      peer.send(encode({ t: "rejected", reason }));
      peer.close();
    };
    port.onmessage = (ev: MessageEvent<string | number>) => {
      const d = ev.data;
      // Gone before it said anything.
      if (d === PORT_CLOSE) return port.close();
      if (typeof d !== "string") return;
      const msg = readClientMessage(d);
      if (!msg) return refuse("malformed message");
      if (msg.t !== "join") return refuse("first message must be join");
      if (msg.version !== PROTOCOL_VERSION) {
        return refuse(`protocol ${msg.version} but this host speaks ${PROTOCOL_VERSION}`);
      }
      if (!match) return refuse("no match is open");
      // The join's match, map and bots are a server's routing and mean
      // nothing here: the owner chose the match, and this is it.
      match.admit(peer, msg.name, msg.weapon, msg.equipment, msg.throwable).catch((err: unknown) => {
        console.error("[local match] admit failed:", err);
        refuse("could not start a match");
      });
    };
  };

  const run = async (msg: OwnerMessage): Promise<void> => {
    if (msg.t === "connect") return connect(msg.port);
    try {
      reply(await answer(msg));
    } catch (err: unknown) {
      reply({ t: "failed", call: msg.call, message: err instanceof Error ? err.message : String(err) });
    }
  };

  owner.onmessage = (ev: MessageEvent<OwnerMessage>) => {
    const msg = ev.data;
    queue = queue.then(() => run(msg));
  };
}
