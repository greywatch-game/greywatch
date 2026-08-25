/**
 * Launches the Chromium every script that drives the real game needs, and owns
 * the two facts about WebGPU that a bare `chromium.launch()` gets wrong.
 *
 * Shared by `bake-collision.mjs`, `check-world-parity.mjs` and
 * `capture-map-shots.mjs` — the three scripts that boot the client rather than
 * reasoning about its source. It is one module for the reason `dev-server.mjs`
 * is: three copies of a browser flag drift, and the failure when one of them
 * drifts is a script that reports the GAME is broken.
 *
 * **The flag is not optional and its absence does not look like its absence.**
 * Playwright's bundled Chromium keeps WebGPU behind `--enable-unsafe-webgpu`:
 * without it `navigator.gpu` is still an object and `requestAdapter()` returns
 * null — which is exactly the shape of "this browser has no WebGPU", so
 * `main.ts`'s boot gate refuses, `Game` is never constructed, and every one of
 * these scripts fails as `waitForFunction` timing out on `window.__celshock`.
 * Measured on this checkout: no flag, no adapter; with it, an adapter every
 * time.
 *
 * **A script that needs a PICTURE must also be headed**, and that is a
 * different requirement from the flag rather than the same one twice. Headless
 * Chromium cannot present a WebGPU canvas at all: `getContext("webgpu")` and
 * `configure()` both succeed and then the first `getCurrentTexture()` destroys
 * the device. Everything that is DOM or simulation — which is both build gates
 * — is unaffected and stays headless, because headless starts much faster.
 * `VERIFYING.md` has the full measurement and the Crostini GPU-toggle caveat
 * that comes with it.
 */
import { chromium } from "playwright";

/**
 * A Chromium that can boot this game.
 *
 * `headed` is for the callers that photograph something; leave it off for the
 * ones that only read state back out of the page.
 */
export function launchClient({ headed = false } = {}) {
  return chromium.launch({
    headless: !headed,
    args: ["--enable-unsafe-webgpu"],
  });
}
