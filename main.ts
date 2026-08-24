/**
 * main.ts — Bootstrap. Creates the Game on #game-canvas after DOMContentLoaded,
 * and owns the boot screen `index.html` puts up before any of this ran.
 * All game wiring lives in src/core/Game.ts; nothing else belongs here.
 *
 * The one thing that is not the Game's is the service worker (src/pwa): it is
 * what the browser offers to install the page as an app from, and it must
 * survive a Game that throws on a machine without WebGL2 — which is why it is
 * registered here, before the scene is built, rather than from inside it.
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
 * builds an engine, a scene and every pool in the game, which together is
 * seconds of a black page on a phone. It is markup in `index.html` (see the
 * comment on the `<style>` block there) and this is the only code that ever
 * touches it — taken down on the first rendered frame, or turned into the
 * failure message on a machine that cannot run the game at all. That message
 * is the second half of the same job: without it, "no WebGL2" and "still
 * loading" are the same black screen forever.
 *
 * **There are TWO things the game cannot start without, and they are checked
 * here for the same reason.** WebGL2 is one; Havok is the other. The physics
 * WASM used to be fetched from inside the `Game` constructor and never awaited,
 * with a collapse tween and a scripted shard arc standing in until it landed —
 * two code paths for every falling thing, exercised only on machines nobody was
 * testing on. It is awaited here now, which costs the boot screen the length of
 * a ~2 MB precached download and buys the entire game the right to assume a
 * solver exists. A rejection is this file's failure message like any other.
 */
import "./src/ui/base.css";
import { Game } from "./src/core/Game";
import { loadHavok } from "./src/systems/PhysicsWorld";
import { registerServiceWorker } from "./src/pwa/register";

registerServiceWorker();

/**
 * WebGL2 or nothing — every cel material, the shadow map and the GPU particle
 * systems assume it. Probed on a THROWAWAY canvas rather than on the game's:
 * asking the real one for a context here would hand Babylon a context it did
 * not create and does not know the attributes of. The probe is dropped
 * immediately, since a browser only allows so many live contexts at once.
 */
function hasWebGL2(): boolean {
  try {
    const probe = document.createElement("canvas").getContext("webgl2");
    if (!probe) return false;
    probe.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
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
  if (!hasWebGL2()) {
    bootFailed(
      "This game needs WebGL2, and this browser does not have it. " +
        "Try a current Chrome, Edge, Firefox or Safari — and if you are on a " +
        "desktop, check that hardware acceleration is switched on.",
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
  try {
    new Game(canvas, havok);
  } catch (err) {
    // Re-thrown: the message is for the player, the console is for whoever
    // has to work out which of a hundred systems failed to construct.
    bootFailed("Something went wrong starting the game. Reloading may fix it.");
    throw err;
  }
  bootDone();
});
