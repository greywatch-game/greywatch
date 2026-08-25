/**
 * server/index.ts — Process entry: the two HTTP endpoints, the WebSocket
 * listener, and the match registry.
 * Owns: accepting a socket, parsing the first message, routing the peer to a
 * `Match`, creating matches and bounding how many exist, and the liveness sweep
 * every socket in the process is pinged by. It owns no simulation and no game
 * rules — everything past the handshake belongs to `Match`.
 * Invariants: nothing here trusts a client. A socket that does not open with a
 * well-formed `join` at the right protocol version is closed, and a peer is
 * only ever given the slot the roster hands out. Never import a rendering
 * system; see `server/README.md` for what a NullEngine cannot do.
 *
 * **Everything an anonymous socket may spend is bounded here**, because this is
 * the only place one exists: a peer that has not said `join` holds no slot and
 * no match, so nothing downstream has a name for it or a place to charge it.
 * The four bounds are the payload size, the time it may stay anonymous, how
 * many sockets one address may hold, and — once it is past the handshake —
 * `Match`'s own per-peer message allowance. They are one subject rather than
 * four, and the reason is the process: Node is single-threaded, so a socket
 * that can make this thread work without limit is a socket that can stall every
 * match on the box, not just its own.
 *
 * **The pong deadline is the one rule here that is not one of those**, and it
 * is process-wide rather than split between this file and `Match` because a
 * dead connection is the same dead connection either side of the handshake.
 * See `PING_MS`.
 *
 * **This registry IS the lobby.** Matches live in this process's memory, so the
 * list it serves on `/matches` is authoritative for itself and needs nothing
 * central to check in with — which is true exactly as long as there is one
 * process. Two replicas behind one proxy would each serve their own half of the
 * world as though it were all of it, and a player picking `m1` would reach
 * whichever replica the proxy chose. See `docs/multiplayer.md`.
 */
import { createServer, type IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import {
  encode,
  PROTOCOL_VERSION,
  type MatchList,
} from "../src/net/protocol";
import { Match } from "./Match";
import { readClientMessage } from "./wire";

/**
 * The backstop under everything else, installed before anything can throw.
 *
 * **It is not a substitute for a single check and must never be treated as
 * one.** Every throw this catches is a bug with a real fix somewhere else —
 * the one that made it necessary was three handlers destructuring a `Vec3` off
 * an unvalidated client message, and the fix for that is `server/wire.ts`, not
 * this. What this answers is the second question: when the next one gets
 * through, how much does it cost?
 *
 * Without it, the answer is everything. Node's default for an uncaught
 * exception is to exit, and since 15.x an unhandled rejection is an uncaught
 * exception — so one bad frame from one socket, or one rejected promise in one
 * timer, takes down every match in this process and drops sixteen people per
 * match mid-round. `restart: unless-stopped` brings the container back in a
 * second, which turns a permanent outage into a repeatable one: a client
 * sending a single message every few seconds keeps the server down for as long
 * as it cares to.
 *
 * So the process stays up and says loudly what happened. This is the trade Node
 * warns about — resuming after an uncaught exception means carrying on from an
 * unknown state — and it is the right way round HERE, where the realistic
 * throw is inside one socket's handler or one match's timer and the rest of the
 * process is untouched. A match that has genuinely been corrupted has its own
 * way out: `rotate` abandons it and every client reconnects into a fresh one.
 *
 * The log line is the point, not the survival. A server that swallows these
 * silently is one where the next `wire.ts`-shaped bug is invisible until
 * somebody reads a stack trace they were never shown.
 */
function backstop(kind: string): (err: unknown) => void {
  return (err) => {
    console.error(`[fatal] uncaught ${kind} — the process survived it:`, err);
  };
}
process.on("uncaughtException", backstop("exception"));
process.on("unhandledRejection", backstop("rejection"));

const PORT = Number(process.env.PORT ?? 8080);

/**
 * A count from the environment, or the default when there isn't a usable one.
 *
 * The `Number.isFinite` test is the point. `Number(process.env.X ?? 4)` reads
 * `MAX_MATCHES=four` as `NaN`, and every comparison against `NaN` is false — so
 * a typo in a compose file does not fall back to the default, it removes the
 * cap entirely and the failure is a server that keeps building matches until it
 * runs out of memory. A bound that a typo can delete is not a bound.
 */
function envCount(name: string, fallback: number, min: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(min, Math.trunc(n)) : fallback;
}

/**
 * The largest inbound WebSocket message this server will read, in bytes.
 *
 * `ws` defaults to 100 MB, which is a size nothing in this protocol has any use
 * for: the biggest message a legitimate client sends is a `join` carrying a
 * display name, and the most frequent is a movement sample of a couple of
 * hundred bytes. At the default, a socket that has not yet proved it is a
 * player at all can make this process buffer a hundred megabytes and then hand
 * it to `JSON.parse` — on the one thread every match here shares.
 *
 * A frame past this is a protocol error rather than a message: `ws` closes the
 * socket with 1009 and raises `error` ON the socket, which is one of the two
 * reasons every socket below is given an `error` listener the moment it
 * connects.
 *
 * A name longer than this is refused with the socket rather than truncated, and
 * that is the right way round — `cleanName` bounds what a name may CONTAIN, and
 * a kilobyte of it is not a name that got away from somebody.
 */
const MAX_MESSAGE_BYTES = 4096;

/**
 * How long a socket may stay anonymous — connected, but not yet through the
 * handshake.
 *
 * A client sends `join` from its own `open` handler, so the honest case is one
 * round trip and this is ten seconds of slack on it. What it bounds is the
 * socket that connects and then says nothing: it costs no roster slot and no
 * match, which is exactly what makes it the cheapest thing an attacker can hold
 * open in bulk, and nothing else in this process would ever close it.
 */
const HANDSHAKE_MS = 10_000;

/**
 * How many sockets one client address may hold at once. 0 disables the cap.
 *
 * Generous on purpose: it is bounding a flood, not policing a household, and
 * sixteen is far above a player with a reconnect in flight and far below
 * anything that costs this process something. The addresses it counts are
 * whatever `clientKey` can work out, which behind a proxy that forwards no
 * client address at all is ONE key for the whole internet — so an operator in
 * that position either fixes the proxy (see `docker/default.conf.template`, and
 * the edge-proxy block in `docs/multiplayer.md`) or sets this to 0. The refusal
 * says which address it counted, so the misconfiguration is legible from a log
 * line rather than from players reporting that the lobby sometimes refuses
 * them.
 */
const MAX_SOCKETS_PER_IP = envCount("MAX_SOCKETS_PER_IP", 16, 0);

/** Live sockets per client address, for the cap above. */
const socketsPerAddress = new Map<string, number>();

/**
 * How often every open socket is pinged, in milliseconds. Half the deadline:
 * a socket is dropped on the sweep AFTER the one it did not answer, so a
 * connection that dies the moment a ping goes out has between one and two
 * intervals to say so.
 *
 * **This is the one thing here that is not a bound on spending, and it is the
 * only one that notices a peer which stopped existing without saying so.**
 * `close` and `error` both need the far end or the kernel to speak, and a
 * laptop lid, a phone leaving wifi or a NAT that forgot the mapping says
 * nothing at all: TCP keepalive is what eventually notices, and Node leaves
 * that at the OS default, which on Linux is TWO HOURS before the first probe.
 * For all of that time the peer's roster slot is held, the bot that would have
 * backfilled it stays benched, `HeadlessGame` keeps a `NetPlayer` nobody owns
 * in the rewind history, and the socket counts against `MAX_SOCKETS_PER_IP`
 * for the very address the player is reconnecting from — the cap above makes
 * the last of those worse than it was, which is what turned this from a known
 * gap into a fix.
 *
 * **Tens of seconds rather than one, because it is a connection being
 * measured and not a player.** A pong is written by the far end's network
 * stack rather than by its JavaScript, so a blocked main thread, a paused
 * game and a backgrounded tab all answer on time (verified against headless
 * Chromium with the main thread blocked solid across a ping). What a longer
 * deadline buys is tolerance for the network's worst minute, and fifteen
 * seconds to answer two bytes is already far past anything a real connection
 * needs.
 */
const PING_MS = 15_000;

/**
 * Sockets that have been pinged and have not answered yet. Emptied by the
 * `pong` handler, and a socket still in it when the next sweep comes round is
 * one whose far end is gone.
 *
 * **A seated peer is pinged from `Match` as well, once a second, for the
 * scoreboard's ping column — and those pongs land here too.** Nothing is
 * weakened by that: any pong is the far end's network stack answering, which is
 * the whole of what this deadline asks, and a peer that has stopped existing
 * produces neither kind. The traffic goes only one way — `Match` tags its own
 * pings so an untagged pong from THIS sweep is not mistaken for an answer to
 * one of its measurements.
 *
 * Weak on purpose: `wss.clients` is what holds a socket alive, and this must
 * not be a second thing that remembers one after it has closed.
 */
const awaitingPong = new WeakSet<WebSocket>();

/** What each socket was counted against, so the deadline's log line can say. */
const socketAddress = new WeakMap<WebSocket, string>();

/**
 * How many matches this process will hold at once.
 *
 * Node is single-threaded, so every match here shares one core: a sixteen-bot
 * round costs a few percent of it at `TICK_HZ` (see the note on that constant),
 * and each also holds a scene, sixteen rigs and a nav graph in memory. Four is
 * a deliberately conservative default for one small box — raise it with the env
 * var once you have measured the box you are actually on, rather than guessing
 * upward from here.
 *
 * The cap is what makes "create a match" a safe button to put in a lobby. A
 * create path with nothing bounding it is a way for anyone to spend the whole
 * server's memory from the menu.
 */
const MAX_MATCHES = envCount("MAX_MATCHES", 4, 1);

/**
 * Matches, by id. One for now — matchmaking across several is phase 8, and the
 * registry exists so that adding it does not mean rewriting the handshake.
 */
const matches = new Map<string, Match>();

/**
 * Monotonic, not `matches.size`. Ids derived from the size are reused as soon
 * as a match is forgotten, so two different matches in one process could both
 * be called `m2` — and a client's logs, or a reconnect naming one, would refer
 * to whichever happened to be alive.
 */
let nextMatchId = 1;

/**
 * Builds and registers a match. The only place either happens.
 *
 * `mapId` is what the joining client ASKED for and is passed straight to
 * `Match`, which resolves it against the real map table — nothing here trusts
 * it, and nothing here needs to know what maps exist.
 */
function createMatch(mapId?: string): Match {
  const match = new Match(`m${nextMatchId++}`, mapId);
  match.onRetired = () => matches.delete(match.id);
  matches.set(match.id, match);
  return match;
}

/**
 * Where a joining peer should land, or why it cannot.
 *
 * Every match always has sixteen bodies in it, so "is there room" is a question
 * about how many of those are bots rather than about how many people are
 * present — which is exactly the property that lets a match start with one
 * human in it and fill up later.
 *
 * **A named match is never substituted.** A peer that asked for `m3` and could
 * be seated in `m4` instead is refused, because it picked that row off a lobby
 * for a reason — the map on it, or the people in it — and being quietly moved
 * is indistinguishable from the lobby being wrong. The refusal names the cause,
 * and the lobby's answer is to refresh, which is honest and takes a second.
 *
 * An UNNAMED join is the opposite and still fills whatever has room: that is
 * `?mp` on the URL and every client that predates the lobby, neither of which
 * expressed a preference to betray.
 *
 * **The requested map is spent only on a match this call CREATES**, and both
 * create paths take it — the explicit one and the fallthrough where nothing had
 * room. A peer landing in an existing match gets that match's map and is told so
 * in the welcome; a preference cannot move a round sixteen people are already
 * standing in.
 */
function routeJoin(
  matchId?: string,
  create?: boolean,
  map?: string,
): { match: Match } | { refuse: string } {
  if (matchId !== undefined) {
    const match = matches.get(matchId);
    // Gone rather than never-existed, most likely: an idle match disposes its
    // world after a minute and drops out of the registry, so a lobby left open
    // on a desk names matches that have since retired.
    if (!match) return { refuse: `match ${matchId} is no longer running` };
    if (!match.hasBotSlot()) return { refuse: `match ${matchId} is full` };
    return { match };
  }
  if (create) {
    if (matches.size >= MAX_MATCHES) {
      return { refuse: "this server is already running as many matches as it can" };
    }
    return { match: createMatch(map) };
  }
  for (const match of matches.values()) {
    if (match.hasBotSlot()) return { match };
  }
  if (matches.size >= MAX_MATCHES) {
    return { refuse: "every match on this server is full" };
  }
  return { match: createMatch(map) };
}

/** The lobby's view of this process. */
function matchList(): MatchList {
  return {
    protocol: PROTOCOL_VERSION,
    full:
      matches.size >= MAX_MATCHES &&
      ![...matches.values()].some((m) => m.hasBotSlot()),
    matches: [...matches.values()].map((m) => m.summary()),
  };
}

const http = createServer((req, res) => {
  if (req.url === "/matches") {
    res.writeHead(200, {
      "content-type": "application/json",
      // The lobby fetches this before any socket exists, and it does so from
      // another origin whenever this process is not the one behind the page:
      // every region past the local one, and in DEV the client on Vite's port
      // with no nginx in between to make them one. Read-only and public — it is
      // the same list anyone can get by connecting — so there is nothing here
      // an origin check would protect.
      "access-control-allow-origin": "*",
      // **This header is the ping.** The lobby times its own request with the
      // transport's resource timing (`responseStart - requestStart`) precisely
      // so the DNS, TCP and TLS a first request pays for are excluded — and
      // cross-origin, a browser zeroes those fields unless the server allows
      // the reading. Without this line every region a player has never fetched
      // from falls back to a wall clock that includes its whole connection
      // setup, so the far server reads as slower than it is on the one screen
      // built for comparing them. A region is by definition cross-origin.
      "timing-allow-origin": "*",
      // A lobby row that is four seconds stale is a row that lies about who is
      // in it, and this is cheap to recompute.
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(matchList()));
    return;
  }
  // Kept distinct from `/matches`: this one answers "is the process alive" for
  // the container healthcheck, and must not start depending on the lobby's
  // shape. Docker calls it every 30 s.
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, protocol: PROTOCOL_VERSION }));
    return;
  }
  res.writeHead(404).end();
});

/** `::ffff:10.0.0.4` and `10.0.0.4` are the same host; count them as one. */
function bareAddress(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith("::ffff:") ? trimmed.slice(7) : trimmed;
}

/**
 * Is the far end of this socket something that could be a proxy of ours?
 *
 * Loopback and the private ranges, which is every deployment this repo
 * describes: `docker compose` puts nginx and this process on the same bridge
 * network (172.16/12), and an edge proxy in front of the domain reaches it over
 * 127.0.0.1. A peer arriving from a public address is a browser talking to this
 * port directly, and a browser's own claim about which address it is at is
 * worth nothing.
 *
 * The two IPv6 prefixes are the unique-local block (`fc00::/7`) and are exact
 * rather than approximate: public IPv6 is `2000::/3` and link-local is `fe80::`,
 * so nothing routable begins with either letter pair.
 */
function isLocalPeer(address: string): boolean {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address.startsWith("10.") ||
    address.startsWith("192.168.") ||
    address.startsWith("169.254.") ||
    address.startsWith("fc") ||
    address.startsWith("fd") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(address)
  );
}

/**
 * Which client the per-address cap should count this socket against.
 *
 * A forwarded header is read only when the socket's own peer is local, and the
 * distinction is the whole of the security here: through the shipped nginx this
 * process never sees a browser directly, so `remoteAddress` is the proxy's and
 * counting it would make every player on the box one address — while a socket
 * that arrives from a public address is a browser, and a browser stating its
 * own `X-Real-IP` would simply be choosing which bucket to spend. `TRUST_PROXY`
 * forces the question either way, for a proxy that is not on this machine.
 *
 * `x-real-ip` before `x-forwarded-for`, because the first is set by the proxy
 * (`docker/default.conf.template` overwrites whatever the client sent) while
 * the second is a list a client can prepend to and nginx passes through
 * untouched. Both are a proxy's word for it, which is exactly as far as this
 * goes: what the cap protects is the process, and the worst an unattributable
 * address buys is the behaviour there was before the cap existed.
 */
function clientKey(req: IncomingMessage): string {
  const peer = bareAddress(req.socket.remoteAddress ?? "");
  const trustProxy = process.env.TRUST_PROXY;
  const trusted =
    trustProxy === "1" || (trustProxy !== "0" && isLocalPeer(peer));
  if (trusted) {
    const real = req.headers["x-real-ip"];
    if (typeof real === "string" && real.length > 0) return bareAddress(real);
    const forwarded = req.headers["x-forwarded-for"];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(
      ",",
    )[0];
    if (first) return bareAddress(first);
  }
  return peer || "unknown";
}

const wss = new WebSocketServer({
  server: http,
  path: "/ws",
  // Not a tuning knob: see the constant. ws's default lets one socket spend a
  // hundred megabytes of this process before it has said who it is.
  maxPayload: MAX_MESSAGE_BYTES,
});

/**
 * The liveness sweep: ping everything that is open, and drop whatever did not
 * answer the last one.
 *
 * **One timer for the process rather than one per match, and it is deliberately
 * not where the other bounds are.** Those are split between this file and
 * `Match` because an anonymous socket and a seated one can spend different
 * things; a dead connection is the same dead connection either side of the
 * handshake, and `wss.clients` is the only place that holds every socket in the
 * process. What terminating one releases is split the same way and needs both
 * halves: the roster slot goes back through `Match.drop`, which is already
 * wired to `close` and needs nothing new, and the per-address quota is released
 * by the `close` handler below.
 *
 * `terminate` rather than `close`, because `close` opens a handshake with a far
 * end that has just proved it is not answering — ws would hold the socket for
 * its own 30-second closing timeout before destroying it anyway.
 *
 * Sockets that are not OPEN are left alone: they are already on their way out
 * (a refusal, a close in flight) and ws bounds that itself. Pinging one is not
 * an error worth raising — it would reach the `error` listener every socket
 * gets below — but it is not a liveness question either.
 */
setInterval(() => {
  for (const socket of wss.clients) {
    if (socket.readyState !== socket.OPEN) continue;
    if (awaitingPong.has(socket)) {
      const key = socketAddress.get(socket) ?? "unknown";
      console.warn(`[net] ${key} missed the pong deadline; socket dropped`);
      socket.terminate();
      continue;
    }
    awaitingPong.add(socket);
    socket.ping();
  }
}, PING_MS);

wss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
  // FIRST, and before anything can throw. A `WebSocket` is an EventEmitter, so
  // an `error` with no listener is not swallowed — it is thrown, out of ws's
  // own callback, which takes the process and every match on it down with it.
  // Until the handshake there was nothing listening: `Match.admit` wires its
  // own, and an anonymous socket never reaches it. ws raises one here for an
  // oversized frame (1009, which `maxPayload` now makes reachable), a malformed
  // one, and a connection reset — none of which needs handling beyond not
  // being fatal, because `close` follows every one of them.
  socket.on("error", () => {});

  // The per-address cap is charged before anything else this socket could cost,
  // and released on `close` — which ws emits for every ending, including the
  // refusal below.
  const key = clientKey(req);
  const held = socketsPerAddress.get(key) ?? 0;
  if (MAX_SOCKETS_PER_IP > 0 && held >= MAX_SOCKETS_PER_IP) {
    console.warn(`[net] ${key} holds ${held} sockets; refused another`);
    socket.send(
      encode({ t: "rejected", reason: "too many connections from your address" }),
    );
    socket.close();
    return;
  }
  socketsPerAddress.set(key, held + 1);
  socketAddress.set(socket, key);
  socket.on("close", () => {
    const left = (socketsPerAddress.get(key) ?? 1) - 1;
    if (left > 0) socketsPerAddress.set(key, left);
    else socketsPerAddress.delete(key);
  });

  // The far end answered, so it is still there. Nothing above the transport
  // sees this: a browser writes the pong from its network stack without waking
  // its JavaScript, which is what makes the sweep a question about the
  // connection rather than about how busy the page is. `ws` answers our peers'
  // pings the same way (`autoPong`), so a client owes nothing for this.
  socket.on("pong", () => awaitingPong.delete(socket));

  // A peer is anonymous until it says `join`. Until then it holds no slot, so a
  // socket that opens and says nothing costs one entry in ws's own client set
  // and nothing in any match — and would sit there for as long as the far end
  // kept the TCP connection up, which is why it is on a clock.
  let joined = false;
  let refused = false;
  let handshake: ReturnType<typeof setTimeout> | null = null;

  const clearHandshake = (): void => {
    if (handshake === null) return;
    clearTimeout(handshake);
    handshake = null;
  };

  const refuse = (reason: string): void => {
    // Once. `close` starts a handshake rather than finishing one, so messages
    // already in the socket's buffer are still delivered afterwards — and a
    // second `rejected` down a closing socket is a message nobody will read,
    // queued against a peer that has already been told why.
    if (refused) return;
    refused = true;
    clearHandshake();
    socket.send(encode({ t: "rejected", reason }));
    socket.close();
  };

  handshake = setTimeout(() => {
    handshake = null;
    refuse("no join within the handshake window");
  }, HANDSHAKE_MS);
  socket.on("close", clearHandshake);

  const onHandshakeMessage = (raw: unknown): void => {
    // Nothing to decode: this socket is on its way out, or the match owns it.
    // Tested before `decode` rather than after, because the parse is the cost.
    if (refused || joined) return;

    // The shape gate, not `decode`: a `join` whose `version` is a string would
    // otherwise reach the comparison below and be refused as a protocol
    // mismatch it is not. See `server/wire.ts`.
    const msg = readClientMessage(String(raw));
    if (!msg) return refuse("malformed message");

    if (msg.t !== "join") return refuse("first message must be join");
    if (msg.version !== PROTOCOL_VERSION) {
      return refuse(
        `protocol ${msg.version} but this server speaks ${PROTOCOL_VERSION}`,
      );
    }
    const route = routeJoin(msg.matchId, msg.create, msg.map);
    // Refused BEFORE `joined` is set, so a client that named a match which
    // has since filled can pick another row and try again on the same socket
    // rather than reconnecting. `refuse` closes it anyway today; leaving the
    // flag alone is what makes a retry a one-line change rather than a
    // handshake redesign.
    if ("refuse" in route) return refuse(route.refuse);
    joined = true;
    clearHandshake();
    // Past the handshake the match owns the peer, including this socket's
    // remaining messages — it registers its own handler inside `admit`, which
    // is synchronous up to its first await. This listener goes rather than
    // merely standing down, because leaving it wired meant every `move` and
    // every `shot` for the life of the connection was decoded twice: once here
    // to discover it was not a `join`, and once by the handler that acts on it.
    socket.off("message", onHandshakeMessage);
    // `admit` builds the world on the first arrival, so it is async. A
    // failure there must close the socket rather than leave a client waiting
    // on a welcome that is never coming.
    route.match.admit(socket, msg.name, msg.weapon, msg.equipment).catch((err: unknown) => {
      console.error("admit failed:", err);
      refuse("could not start a match");
    });
  };

  socket.on("message", onHandshakeMessage);
});

http.listen(PORT, () => {
  console.log(
    `greywatch server on :${PORT} (protocol ${PROTOCOL_VERSION}, up to ${MAX_MATCHES} matches)`,
  );
});
