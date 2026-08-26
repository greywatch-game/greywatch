/**
 * Launches the Chromium every script that drives the real game needs, and owns
 * the two facts about WebGPU that a bare `chromium.launch()` gets wrong.
 *
 * Shared by `bake-collision.mjs`, `check-world-parity.mjs` and
 * `capture-map-shots.mjs` — the three scripts that boot the client rather than
 * reasoning about its source, and by the WebGPU harness under
 * `plans/webgpu-ref/`. It is one module for the reason `dev-server.mjs` is:
 * three copies of a browser flag drift, and the failure when one of them
 * drifts is a script that reports the GAME is broken.
 *
 * **Both facts have the same shape and it is the worst shape there is**: a
 * machine that cannot hand out a WebGPU adapter is indistinguishable from a
 * browser that has never heard of WebGPU, so `main.ts`'s boot gate refuses,
 * `Game` is never constructed, and every one of these scripts fails as
 * `waitForFunction` timing out on `window.__celshock` — which says nothing
 * about why. If a script here starts failing that way, come back to this file
 * before you look at the game.
 *
 * **The FLAG, which is the Chromebook's half.** Playwright's bundled Chromium
 * keeps WebGPU behind `--enable-unsafe-webgpu` there: without it
 * `navigator.gpu` is still an object and `requestAdapter()` returns null.
 * Measured on the Windows box the flag is a no-op — an adapter comes back in
 * all four combinations of headless/headed and flag/no-flag, because what
 * decides it there is the binary below. It stays because it costs nothing on
 * the machine that does not need it and is the whole game on the machine that
 * does.
 *
 * **The BINARY, which is the Windows box's half, and it is the one that is
 * easy to get wrong because the fix looks like a preference.** Playwright's
 * default `headless: true` does not run the browser headless — it runs a
 * DIFFERENT executable, `chromium_headless_shell`, and on Windows that
 * executable carries no GPU stack at all: `requestAdapter()` returns null with
 * the flag, without it, and under every ANGLE override tried. `channel:
 * "chromium"` asks for the full browser binary, whose headless mode has the
 * real adapter — measured `nvidia/lovelace`, 21 features, and a swap chain
 * that survives 240 frames with no device loss. So the channel is not a
 * preference and not a speed knob: without it, on a Windows machine with a
 * GPU, every browser-driven script in this repo fails at the boot gate.
 *
 * **On the Chromebook the same line buys nothing**, which is why it was left
 * out for as long as it was: that box's headless shell DOES carry Dawn's
 * SwiftShader backend, so both binaries behaved identically and the channel
 * was measured as dead weight. It is dead weight there and load-bearing here,
 * and `VERIFYING.md` carries both readings side by side.
 *
 * **`headed` is a THIRD question and not the binary one restated.** Headless
 * on the Chromebook cannot present a WebGPU canvas at all — the first
 * `getCurrentTexture()` destroys the device — so a script that wants a PICTURE
 * has to be headed there. On the Windows box headless presents perfectly well
 * and a reference frame can be taken either way, with one caveat that belongs
 * to whoever is diffing rather than to whoever is launching: headed and
 * headless frames are NOT byte-identical, so a bank must be taken and diffed
 * in the same mode. `VERIFYING.md` has the measurement.
 */
import { chromium } from "playwright";

/**
 * A Chromium that can boot this game.
 *
 * `headed` is for the callers that must not be headless on a machine where
 * headless cannot present; leave it off for the ones that only read state back
 * out of the page. Note that it is NOT what gets you a GPU — the channel above
 * is, in both modes.
 */
export function launchClient({ headed = false } = {}) {
  return chromium.launch({
    headless: !headed,
    channel: "chromium",
    args: ["--enable-unsafe-webgpu"],
  });
}
