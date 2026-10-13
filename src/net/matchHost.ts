/**
 * net/matchHost.ts — Where the page's own match runs (`BABYLON_EXIT.md`
 * X2.5c C4): the boot's choice between a Worker and this thread, made once
 * and handed back as a `LocalMatch` either way.
 * Owns: `openMatchHost` — starting the host (`server/localMatchWorker.ts` in a
 * Worker, or `server/localMatch.ts` on a `MessageChannel` here), proving it is
 * up, for a Worker saying what it throws, and REPLACING a host its owner
 * lost (`MatchHost.replace`: the old one torn down, a new one opened by this
 * same choice — so a lost Worker's successor is a Worker again when it
 * comes up, and this thread's host only on the boot's own terms).
 * Invariants:
 * - **One code path either way.** The Worker's scope and a `MessageChannel`'s
 *   port are both an `OwnerPort`, `serveLocalMatch` is the whole of the host
 *   in both, and `LocalMatch` cannot tell which it was handed — so the page,
 *   and `Game` above it, never ask (`mode` and `why` are for the boot line).
 * - **A Worker is proved before it is trusted, and watched after.** It is up
 *   when it has answered a `settle` (any answer is one); one that fails to
 *   load or does not answer in `READY_PATIENCE_MS` is terminated and the page
 *   hosts the match itself, saying why. Until that first answer the race
 *   here is the only judge — `LocalMatch`'s watchdog stands down until the
 *   host has answered once, and from then on it is the ONLY judge.
 * - **Once up, an uncaught error is a LOG LINE, never the match lost.** An
 *   error event is one task that threw, and a Worker carries on to its next
 *   message after it — as the server's process does past its backstop
 *   (`server/index.ts`) and the page's own thread does under `?simpage`, so
 *   the three hosts survive the same throws. A Worker that genuinely dies or
 *   wedges raises nothing at all; what finds it is SILENCE, which is the
 *   watchdog's (`LocalMatch`, "A port opens whoever is at the far end").
 * - **`?simpage` asks for this thread**, as it asked for the core in it
 *   before: what a debugger steps through.
 * Never: value-import `server/` statically. **The fallback's one dynamic
 * `import()` is the only value import of `server/` anywhere in `src/`**
 * (X2.5c C4's decision on "The same-thread fallback is a value import of
 * `server/`"): taken only when this thread hosts, so the Worker path's bundle
 * carries none of the authority — the Worker is reached as a URL, which is a
 * chunk of its own. Everything that import reaches must run in a browser,
 * which `scripts/check-babylon-free.mjs` holds (no Node in the local match's
 * reach).
 */
import { LocalMatch } from "./LocalMatch";

/** The page's own match, wherever it runs. */
export interface MatchHost {
  /** The owner's channel to it — what `Game` makes its calls on. */
  match: LocalMatch;
  /** Where the host runs: a Worker, or this thread on a `MessageChannel`. */
  mode: "worker" | "page";
  /** Why — the boot line's half of the answer. */
  why: string;
  /**
   * Ends this host for good and opens a fresh one the boot's way — for an
   * owner whose host was LOST (`LocalMatch.onLost`; `Game.rehostLocal`). The
   * old one is torn down first: a wedged Worker is terminated rather than
   * left spinning a core, and an in-page host's channel is closed. The new
   * one is chosen as at boot, by the same options.
   */
  replace(): Promise<MatchHost>;
}

type HostOptions = { simpage: boolean };

/**
 * How long a new Worker may take to answer its first call before the boot
 * stops waiting and hosts the match in this thread, ms. A Worker loads its
 * own module graph — on a first visit, over the network — before it can
 * answer anything, so this has to cover a slow connection's fetch of the
 * whole authority; and a boot held past it is a black page, which a match in
 * this thread is not.
 */
const READY_PATIENCE_MS = 20_000;

/**
 * The boot's choice (`main.ts`, awaited before `Game` is built): the match in
 * a Worker unless `?simpage` asks for this thread or the Worker does not come
 * up, and in this thread otherwise.
 */
export async function openMatchHost(opts: HostOptions): Promise<MatchHost> {
  if (opts.simpage) return inPage(opts, "asked for by ?simpage");
  let worker: Worker;
  try {
    worker = new Worker(new URL("../../server/localMatchWorker.ts", import.meta.url), {
      type: "module",
      name: "match",
    });
  } catch (err) {
    return inPage(opts, `the Worker could not be created (${String(err)})`);
  }
  // The Worker's scope is the host's `OwnerPort`; the Worker object is the
  // page's end of the same channel.
  const match = new LocalMatch(worker);
  const asked = performance.now();
  const failed = await new Promise<string | null>((resolve) => {
    // A Worker that loads and never answers must not hold the boot for ever:
    // past this, the page hosts the match itself.
    const timer = setTimeout(() => resolve(`no answer in ${READY_PATIENCE_MS} ms`), READY_PATIENCE_MS);
    worker.onerror = (e) => {
      e.preventDefault();
      clearTimeout(timer);
      resolve(e.message || "the Worker's script failed to load");
    };
    match.settle().then(
      () => {
        clearTimeout(timer);
        resolve(null);
      },
      (err: unknown) => {
        clearTimeout(timer);
        resolve(err instanceof Error ? err.message : String(err));
      },
    );
  });
  if (failed !== null) {
    match.dispose();
    worker.terminate();
    return inPage(opts, `the Worker did not come up (${failed})`);
  }
  const upIn = Math.round(performance.now() - asked);
  // Up. The boot's `onerror` is REPLACED rather than left: it cancels the
  // event it resolves on (`preventDefault`), so left standing it would
  // swallow every uncaught error the Worker throws for the rest of the
  // session — the console would never show one. What reaches here is a throw
  // outside an owner call (`serveLocalMatch` answers those `failed`): a
  // person's port handler, a `Match` timer, a microtask. The Worker survives
  // it, so this SAYS it and nothing more — the server's backstop, in the
  // header's terms. A host that went on to stop answering is the watchdog's.
  worker.onerror = (e) => {
    e.preventDefault();
    console.error(`[local match] Worker: uncaught ${e.message || "error"} (${e.filename}:${e.lineno}:${e.colno}) — the host survived it`);
  };
  return {
    match,
    mode: "worker",
    why: `it answered its first call in ${upIn} ms`,
    replace() {
      match.dispose();
      worker.terminate();
      return openMatchHost(opts);
    },
  };
}

/**
 * The match in this thread: the host's module loaded by the one dynamic
 * import (the header), served on one end of a `MessageChannel` and owned
 * through the other — exactly the Worker's shape with the thread taken out.
 */
async function inPage(opts: HostOptions, why: string): Promise<MatchHost> {
  const { serveLocalMatch } = await import("../../server/localMatch");
  const { port1, port2 } = new MessageChannel();
  serveLocalMatch(port2);
  const match = new LocalMatch(port1);
  return {
    match,
    mode: "page",
    why,
    replace() {
      match.dispose();
      port1.close();
      port2.close();
      return openMatchHost(opts);
    },
  };
}
