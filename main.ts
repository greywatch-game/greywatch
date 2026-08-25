/**
 * main.ts — Bootstrap. Creates the Game on #game-canvas after DOMContentLoaded,
 * and owns the boot screen `index.html` puts up before any of this ran.
 * All game wiring lives in src/core/Game.ts; nothing else belongs here.
 *
 * The one thing that is not the Game's is the service worker (src/pwa): it is
 * what the browser offers to install the page as an app from, and it must
 * survive a Game that never gets built on a machine without WebGPU — which is
 * why it is registered here, before the scene is built, rather than from
 * inside it.
 *
 * `base.css` is imported FIRST, and from here rather than from a UI module,
 * for both halves of the word: it carries the document reset every other sheet
 * assumes, and being first on the module graph is what puts it first in the
 * bundled stylesheet, so a screen's own rules can override a shared one at
 * equal specificity. Every other sheet is imported by the module that writes
 * the markup it styles.
 *
 * THE BOOT SCREEN IS THIS FILE'S, and it is the one piece of interface that is
 * not a `src/ui/` module, because it covers the stretch in which no module has
 * evaluated: the bundle is a couple of megabytes gzipped and the constructor
 * builds a scene and every pool in the game, which together is seconds of a
 * black page on a phone. It is markup in `index.html` (see the comment on the
 * `<style>` block there) and this is the only code that ever touches it —
 * taken down on the first rendered frame, or turned into the failure message
 * on a machine that cannot run the game at all. That message is the second
 * half of the same job: without it, "no WebGPU" and "still loading" are the
 * same black screen forever.
 *
 * **There are TWO things the game cannot start without, and they are checked
 * here for the same reason.** The GPU is one; Havok is the other. The physics
 * WASM used to be fetched from inside the `Game` constructor and never awaited,
 * with a collapse tween and a scripted shard arc standing in until it landed —
 * two code paths for every falling thing, exercised only on machines nobody was
 * testing on. It is awaited here now, which costs the boot screen the length of
 * a ~2 MB precached download and buys the entire game the right to assume a
 * solver exists. A rejection is this file's failure message like any other.
 *
 * **The engine is now the same shape, and that is what the second await is.**
 * A `WebGLEngine` was built inside the `Game` constructor because its
 * constructor was synchronous; `WebGPUEngine`'s is not — an adapter and a
 * device are both promises. So the engine is created here and INJECTED, which
 * keeps `Game`'s constructor synchronous and `window.__celshock` non-null the
 * moment it returns (`VERIFYING.md`), and makes the engine exactly the move
 * `havok` already made rather than a second, differently-shaped one.
 */
import "./src/ui/base.css";
import { WebGPUEngine } from "@babylonjs/core";
import { Game } from "./src/core/Game";
import { loadHavok } from "./src/systems/PhysicsWorld";
import { registerServiceWorker } from "./src/pwa/register";

registerServiceWorker();

/**
 * WebGPU or nothing — every cel material, the shadow map and the GPU particle
 * systems assume it, and there is no WebGL fallback engine in the tree.
 *
 * **The throwaway-canvas probe this replaces is GONE, not edited.** WebGL2 had
 * to be asked for on a canvas, so the old gate created one, took a context off
 * it and dropped it immediately (a browser only allows so many live contexts).
 * `requestAdapter()` touches no canvas at all: it asks the browser for a GPU,
 * not for a drawing surface. If you come here looking for the probe canvas, it
 * has no counterpart.
 *
 * Both halves are load-bearing. `navigator.gpu` is a SECURE-CONTEXT-only
 * property — it is absent over plain `http://` to anything but localhost, so
 * its absence means "not offered here" as often as "not supported". And it can
 * be present with no adapter behind it: a headless Chrome without
 * `--enable-unsafe-webgpu` is exactly that machine, which is why the gate is
 * the adapter rather than the namespace.
 */
async function hasWebGPU(): Promise<boolean> {
  try {
    return !!navigator.gpu && !!(await navigator.gpu.requestAdapter());
  } catch {
    return false;
  }
}

/** Leaves the boot screen up and says why the game is not coming. */
function bootFailed(message: string): void {
  const boot = document.getElementById("boot");
  if (!boot) return;
  boot.classList.add("failed");
  const note = boot.querySelector("p");
  if (note) note.textContent = message;
}

/**
 * Takes the boot screen down, after a frame has actually been drawn.
 *
 * NOT when the constructor returns: it ends by registering the render loop,
 * so at that moment the canvas is still the empty black rectangle it was
 * created as, and removing the cover there trades a boot screen for a black
 * flash. Two frames of grace — Babylon queues its first tick from inside the
 * constructor, so it is already ahead of the first callback below, and the
 * second is there so this never rests on that ordering.
 */
function bootDone(): void {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => document.getElementById("boot")?.remove()),
  );
}

window.addEventListener("DOMContentLoaded", async () => {
  const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
  // FIRST, and before the physics download: a machine with no WebGPU should
  // not spend 2 MB to be told no. It is also the cheapest of the three checks
  // — no canvas, no file, one round trip to the browser's own GPU service.
  if (!(await hasWebGPU())) {
    bootFailed(
      "This game needs WebGPU, and this browser does not have it. " +
        "Try a current Chrome or Edge, Safari 18 or later, or Firefox on " +
        "Windows — and if you are on a desktop, check that hardware " +
        "acceleration is switched on.",
    );
    return;
  }
  // The physics engine, and the one thing the boot screen genuinely waits on.
  // Its own failure message rather than the constructor's: a 404 or a bad MIME
  // type on the WASM is a deployment fault with a known shape (see the
  // `optimizeDeps.exclude` note in CLAUDE.md), and telling the player to reload
  // would be advice that cannot work.
  let havok;
  try {
    havok = await loadHavok();
  } catch (err) {
    bootFailed(
      "The physics engine could not be loaded, so the game cannot start. " +
        "Check the connection and reload; if it keeps happening, the build is " +
        "missing a file.",
    );
    throw err;
  }
  // **A THIRD failure branch, and it is new in kind**: the adapter above said
  // yes and the device request still failed. That is a driver the browser has
  // blocklisted, a GPU already out of memory, or a device lost between the two
  // calls — none of which the gate can see, and none of which a reload fixes
  // any more reliably than the physics 404 does. It gets its own message for
  // the same reason the Havok one has one: the generic catch below says
  // "reloading may fix it", which here is advice that mostly cannot work.
  //
  // **No MSAA, and that is a saving rather than a downgrade.** Asking for it
  // gave a 4x multisampled DEFAULT framebuffer — but the pipeline runs FXAA,
  // so every pass of the scene renders into post-process render targets and
  // the only thing ever drawn to the default framebuffer is the final
  // full-screen quad. The multisampling was antialiasing one quad's edges, of
  // which there are none, and paying a resolve every frame and ~30 MB at 720p
  // (66 MB at 1080p) to do it. FXAA still does the actual antialiasing.
  //
  // No stencil either: nothing in `src/` uses one, and there is no
  // `HighlightLayer` (the effect layer that would). Under WebGPU that flag
  // does one thing more than it used to, and it is worth knowing before
  // anything is re-tuned: it picks the DEPTH FORMAT. False gives
  // `depth32float`, true would give `depth24plus-stencil8`, and `depthBias` is
  // defined in a different unit for a float format — which is why the glass
  // and outline z-offsets are re-derived rather than carried over.
  //
  // `adaptToDeviceRatio` is deliberately still not passed. It would pin the
  // backing store to the display, and the resolution is a player setting —
  // `applyRenderScale` owns the scaling level from the first `applySettings`.
  //
  // **`WebGPUEngine.CreateAsync` is NOT used, and that is not a style choice.**
  // It is `new WebGPUEngine(...)` followed by `initAsync()` wrapped in `new
  // Promise((resolve) => ...)` — with no `reject`
  // (`webgpuEngine.pure.js:234-237`, Babylon 9.19.1). So when `initAsync`
  // rejects, the promise it hands back never settles: `await` on it waits
  // forever, this `catch` is unreachable, and the failure surfaces as an
  // unhandled rejection in the console behind a boot screen that says
  // "loading" until the tab is closed. That is the exact failure this screen
  // exists to prevent. Calling the two halves by hand is the same code path
  // and rejects properly. If a future Babylon fixes the wrapper, this can go
  // back to one line — check for the missing `reject` before assuming it did.
  let engine;
  try {
    engine = new WebGPUEngine(canvas, { antialias: false, stencil: false });
    await engine.initAsync();
  } catch (err) {
    bootFailed(
      "This browser has WebGPU but could not start a graphics device, so the " +
        "game cannot run. Check that hardware acceleration is switched on and " +
        "that the graphics driver is up to date.",
    );
    throw err;
  }
  try {
    new Game(canvas, havok, engine);
  } catch (err) {
    // Re-thrown: the message is for the player, the console is for whoever
    // has to work out which of a hundred systems failed to construct.
    bootFailed("Something went wrong starting the game. Reloading may fix it.");
    throw err;
  }
  bootDone();
});
