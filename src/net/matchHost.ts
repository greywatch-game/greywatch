/**
 * net/matchHost.ts — Where the page's own match runs (`BABYLON_EXIT.md`
 * X2.5c C4): the boot's choice between a Worker and this thread, made once
 * and handed back as a `LocalMatch` either way.
 * Owns: `openMatchHost` — starting the host (`server/localMatchWorker.ts` in a
 * Worker, or `server/localMatch.ts` on a `MessageChannel` here), proving it is
 * up, and, for a Worker, routing its failure to the owner (`LocalMatch.lost`).
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
 *   host has answered once. Once up, its `onerror` is the match LOST — a
 *   port into a dead Worker says nothing, so this is the one place that
 *   learns of it ("A port opens whoever is at the far end").
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
  /** The owner's channel to it — the one thing `Game` holds. */
  match: LocalMatch;
  /** Where the host runs: a Worker, or this thread on a `MessageChannel`. */
  mode: "worker" | "page";
  /** Why — the boot line's half of the answer. */
  why: string;
}

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
export async function openMatchHost(opts: { simpage: boolean }): Promise<MatchHost> {
  if (opts.simpage) return inPage("asked for by ?simpage");
  let worker: Worker;
  try {
    worker = new Worker(new URL("../../server/localMatchWorker.ts", import.meta.url), {
      type: "module",
      name: "match",
    });
  } catch (err) {
    return inPage(`the Worker could not be created (${String(err)})`);
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
    return inPage(`the Worker did not come up (${failed})`);
  }
  const upIn = Math.round(performance.now() - asked);
  // Up. The boot's `onerror` is REPLACED rather than left: it cancels the
  // event it resolves on (`preventDefault`), so left standing it would
  // swallow every uncaught error the Worker throws for the rest of the
  // session — the console would never show one. An uncaught error in the
  // host is the match lost — `serveLocalMatch` catches what a call throws
  // and answers `failed`, so what reaches here is the host itself broken,
  // and nothing on the far side will answer again.
  worker.onerror = (e) => {
    e.preventDefault();
    const what = `uncaught ${e.message || "error"} (${e.filename}:${e.lineno}:${e.colno})`;
    console.error(`[local match] Worker: ${what}`);
    match.lost(`the Worker failed: ${what}`);
  };
  return { match, mode: "worker", why: `it answered its first call in ${upIn} ms` };
}

/**
 * The match in this thread: the host's module loaded by the one dynamic
 * import (the header), served on one end of a `MessageChannel` and owned
 * through the other — exactly the Worker's shape with the thread taken out.
 */
async function inPage(why: string): Promise<MatchHost> {
  const { serveLocalMatch } = await import("../../server/localMatch");
  const { port1, port2 } = new MessageChannel();
  serveLocalMatch(port2);
  return { match: new LocalMatch(port1), mode: "page", why };
}
