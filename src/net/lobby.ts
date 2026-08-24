/**
 * net/lobby.ts — Asking a match server what it is running, before there is a
 * socket.
 * Owns: the `/matches` request and the round trip it is timed by. Owns no UI
 * and no state: it is one function that fetches a region and returns.
 * Invariants: never opens a socket, never joins anything, and never throws a
 * raw `TypeError` at a caller — a server that is down is an ordinary answer for
 * a lobby to render, not an exception for it to handle. It never chooses WHICH
 * server either: it is handed a resolved `Region` and asks that one, so the
 * list a player is reading and the socket they would open are the same machine
 * by construction (see `net/regions.ts`).
 *
 * This is the ONE part of multiplayer that is not the WebSocket. It is plain
 * HTTP on purpose: a client browsing matches has not committed to anything yet,
 * and making it hold a socket open to read a list would mean every idle player
 * sitting on a menu is a connection the server has to carry. With more than one
 * region that argument only gets stronger — a lobby measures every region on
 * every refresh, and doing that over sockets would mean opening one to each
 * server just to find out which is nearest.
 */
import type { MatchList } from "./protocol";
import type { Region } from "./regions";

/**
 * How long to wait for a list before calling the server down, in ms.
 *
 * Short, because this is a menu: the endpoint does no work — it walks a Map of
 * at most a handful of matches and stringifies it — so anything past a second
 * is a network that is not going to answer, and a lobby that spins for thirty
 * seconds before admitting it is a lobby nobody waits out. It is also the
 * longest a DOWN region can hold up the region beside it, which is nothing at
 * all: the requests are in flight together and each row lands when it lands.
 */
const LIST_TIMEOUT_MS = 4000;

/** What a lobby got back from one region, or why it got nothing. */
export type LobbyResult =
  | {
      ok: true;
      list: MatchList;
      /**
       * How long the round trip to this region took, in ms.
       *
       * The only ping available on this screen and an honest one: there is no
       * socket yet, so what is measured is the request that fetched this list —
       * same host, same network path, and the endpoint itself does no work
       * beyond walking a Map of at most a handful of matches. What a player
       * reads it for is which server is nearest them, and it answers that.
       */
      ping: number;
    }
  | { ok: false; error: string };

/**
 * Makes room for the timings the next fan-out is about to take.
 *
 * **The resource timing buffer holds 250 entries and then silently stops
 * recording**, and a page that has loaded a game has spent all of them long
 * before anybody opens the lobby: the bundle's own chunks, every texture, and —
 * on an installed build — the service worker's `cache.addAll` over the entire
 * precache. So `getEntriesByName` finds nothing, every reading falls through to
 * the wall clock, and the ping column quietly measures how busy the main thread
 * was instead of how far away the server is. Measured in a headless client,
 * where a stalled frame turned a 3 ms round trip to localhost into 683 ms —
 * against a probe on the same machine, taken on a page with no game on it,
 * which read the true 2.9 ms out of the transport.
 *
 * Called ONCE before a fan-out rather than inside the fetch, and the ordering is
 * the point: the regions are asked together, so a clear inside each request
 * would drop the entry of whichever answered first. Nothing else in the game
 * reads resource timings — this is the only measurement of its kind here — so
 * clearing the lot costs nothing and leaves the buffer holding one refresh's
 * worth for the life of the page.
 */
export function clearRequestTimings(): void {
  performance.clearResourceTimings();
}

/**
 * The transport's own timing for a request that has just finished, or the
 * wall-clock measurement it falls back to.
 *
 * **The fallback is the whole reason this exists.** A `fetch` measured with a
 * clock either side of it includes whatever the connection cost to establish,
 * and the FIRST list a player asks for is exactly the request that pays for DNS,
 * TCP and TLS — so a lobby that timed it naively would report three round trips
 * as one on the one look that forms the player's impression of the server, and
 * then quietly report a third of it on every Refresh. `responseStart -
 * requestStart` is the transport's own answer to "how long did the far end take
 * to start replying", with the setup already excluded.
 *
 * **With regions that stopped being a nicety and became the measurement.** Two
 * numbers are on screen to be COMPARED, and the far one is the one paying for a
 * fresh connection — an inflated first reading does not just flatter a server,
 * it points the player at the wrong one. Which is why the match server sends
 * `timing-allow-origin: *` beside its CORS header: without it a cross-origin
 * region's timing entry reads zeros and falls back to the wall clock, and the
 * region a player has never fetched from is the region that looks slow.
 *
 * It is not always there — a server that predates that header exposes nothing —
 * and that comes back as the wall-clock figure, which is the honest thing to do
 * with a measurement that was not available. The OTHER way it goes missing is
 * `clearRequestTimings`'s problem, above; read that before trusting this.
 */
function requestRtt(url: string, elapsed: number): number {
  const entries = performance.getEntriesByName(url);
  const last = entries[entries.length - 1] as PerformanceResourceTiming | undefined;
  if (!last) return elapsed;
  const rtt = last.responseStart - last.requestStart;
  return rtt > 0 ? rtt : elapsed;
}

/**
 * Fetches the match list from one region.
 *
 * Every failure comes back as `{ ok: false }` with something a player can read.
 * The distinction that matters to the caller is not WHICH failure it was but
 * that there is nothing to show, and a lobby that renders "could not reach the
 * match server" is more use than one that renders an empty list — an empty list
 * means "no matches running", which is a different and joinable situation.
 */
export async function fetchMatches(region: Region): Promise<LobbyResult> {
  const url = region.listUrl;
  const started = performance.now();
  try {
    const res = await fetch(url, {
      // The server sends `no-store`, but a client that asks for a fresh copy
      // does not have to trust it — this is a list whose whole value is being
      // current.
      cache: "no-store",
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, error: `match server returned ${res.status}` };
    const list = (await res.json()) as MatchList;
    // Shape-checked rather than trusted. This is the one endpoint that can be
    // answered by something that is not the match server at all: a misconfigured
    // proxy hands back `index.html` with a 200, and `list.matches.map` on a
    // string is a crash in the menu rather than a message in it.
    if (!Array.isArray(list?.matches)) {
      return { ok: false, error: "match server sent something unreadable" };
    }
    // Read after the body, not before it: the resource timing entry is filed
    // when the fetch finishes, so asking any earlier is asking for the previous
    // request's — or for nothing at all on the first one.
    return {
      ok: true,
      list,
      ping: Math.round(requestRtt(url, performance.now() - started)),
    };
  } catch (err) {
    // `AbortSignal.timeout` rejects with a `TimeoutError`; a server that is not
    // listening rejects with a `TypeError` that says only "Failed to fetch".
    // Neither is worth showing verbatim.
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    return {
      ok: false,
      error: timedOut ? "match server did not answer" : "could not reach the match server",
    };
  }
}
