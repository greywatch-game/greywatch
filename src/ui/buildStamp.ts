/**
 * buildStamp.ts — Which build this page is, as the build stamped it into
 * `index.html` (`vite.config.ts`'s `buildStamp`).
 * Owns: reading `<meta name="greywatch-build">`.
 * Invariants: read off the DOCUMENT, never compiled into the bundle — the
 * document is what the service worker served, so the stamp is the build
 * actually running, and the bundle's hash does not move with the commit.
 * Never: decides anything; fails — a page without the tag says so.
 */

/** The commit and the day it was built, e.g. `47ea98c · 2026-10-17`. */
export function buildStamp(): string {
  const tag = document.querySelector<HTMLMetaElement>('meta[name="greywatch-build"]');
  return tag?.content || "unknown";
}
