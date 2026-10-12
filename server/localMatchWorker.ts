/**
 * server/localMatchWorker.ts — The Worker a local match runs in
 * (`BABYLON_EXIT.md` X2.5c C3): this thread's scope is the owner's port, and
 * `serveLocalMatch` is everything it does.
 * Owns: nothing — the host is `localMatch.ts`, which a page without this
 * Worker runs on a `MessageChannel` in its own thread, the same code path.
 * Never: import a view or Babylon, or Node — `scripts/check-babylon-free.mjs`
 * walks this directory for the first and walks from THIS FILE for the second
 * (`localMatch.ts` says why). The page reaches it only as a Worker URL, which
 * `src/net/matchHost.ts` names — and that URL is what puts it, and
 * everything it reaches, into the page's build.
 */
import type { OwnerPort } from "../src/net/localWire";
import { serveLocalMatch } from "./localMatch";

// A Worker's own scope, which the DOM lib types as a window.
serveLocalMatch(self as unknown as OwnerPort);
