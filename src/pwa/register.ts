/**
 * register.ts — the two things that turn the page into an installable app:
 * the service worker registration, and the fullscreen gesture a phone needs
 * when the game is opened in a browser tab rather than from the home screen.
 *
 * Nothing here touches the game. `Game` owns the round; this owns the window
 * the round is drawn in, which is why it is a module of its own rather than
 * more wiring in `Game`.
 */

/**
 * How long to leave between update checks. Each one is a conditional GET of an
 * 8 KB worker that answers 304 the overwhelming majority of the time, so this
 * is about not asking on every alt-tab rather than about bandwidth.
 */
const UPDATE_INTERVAL_MS = 60_000;

/**
 * Installs `sw.js` (see `src/pwa/sw.js`), which is what makes the game
 * launchable offline and is half of what makes it installable at all.
 *
 * Production only: in dev there is no worker to register — the plugin that
 * emits it is `apply: "build"` — and a worker caching a Vite dev server's
 * module graph would be actively harmful.
 *
 * Registration is deferred to `load` so it never competes with the bundle it
 * exists to cache: a service worker that installs during startup pulls a few
 * megabytes down a second time while the first copy is still arriving.
 *
 * **`updateViaCache: "none"` is belt and braces over the `no-cache` header
 * `docker/default.conf.template` puts on `/sw.js`.** The default, `"imports"`,
 * already keeps the top-level worker script out of the HTTP cache — but the
 * header is the deployment's to get right and this is the app's, and the
 * failure they both guard is a worker that can never learn a new build exists.
 * One of the two costs nothing to state twice.
 *
 * **`update()` IS CALLED BY HAND, AND THAT IS NOT BELT AND BRACES — IT IS THE
 * ONLY THING THAT EVER CHECKS.** Registering an already-registered worker with
 * the same script url, type and cache mode resolves against the existing
 * registration and returns without checking anything, and a navigation's own
 * soft update is throttled by the browser on a schedule of its own. Measured,
 * on a deploy behind a local server: a full page reload asked for `/sw.js`
 * ZERO times, the standing worker stayed active, and the precache sat on the
 * previous build indefinitely — until `update()` was called explicitly, at
 * which point the new worker installed, activated and pruned the old cache
 * within a second. This is the other half of why an update used to take five
 * to ten launches, and it is the half that reads as superstition if it is ever
 * "cleaned up": the register call above LOOKS like the check, and it is not
 * one.
 *
 * It is also asked again whenever the page comes back into view, which is what
 * a home-screen app resumed from the switcher does instead of navigating —
 * that path makes no load event and no navigation, so nothing else here would
 * fire. The throttle is what keeps an alt-tab from being a request.
 *
 * **Nothing is reloaded on the strength of any of it.** A round in progress
 * must not be swapped out from under the player, and it does not need to be:
 * the navigation handler in `sw.js` makes the NEXT launch current whether this
 * fired or not. What this buys is the precache — the bytes a flight-mode
 * launch reads, and the old build's cache getting dropped rather than kept
 * forever.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    // A failure here is not worth surfacing: an unregistered worker costs
    // offline launch and nothing else, and the commonest cause is the page
    // being served over plain HTTP from something other than localhost.
    void navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((registration) => {
        let checked = 0;
        const check = () => {
          if (Date.now() - checked < UPDATE_INTERVAL_MS) return;
          checked = Date.now();
          // A failure is an offline launch, which is not news.
          void registration.update().catch(() => {});
        };
        check();
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") check();
        });
      })
      .catch(() => {});
  });
}

/**
 * Takes the screen on a touch device, if it is not already taken.
 *
 * This is for the browser-tab case only. An installed app declares
 * `"display": "fullscreen"` in the manifest and comes up without any chrome to
 * escape from, and on the desktop the pointer lock already does the immersing
 * — a page that went fullscreen under a mouse click nobody asked it to would
 * be a nuisance, so the coarse-pointer test is the gate, not an optimisation.
 *
 * **It is the document that goes fullscreen, never the canvas.** A fullscreen
 * element is the only thing drawn, and the HUD is a `<div>` SIBLING of the
 * canvas — so fullscreening the canvas plays the game with the scene at full
 * size and no tickets, no flags, no crosshair and no deploy map. It looks like
 * the HUD failed to build.
 *
 * Everything here is best-effort by design. iPhone Safari has no element
 * fullscreen at all (`requestFullscreen` is simply absent, hence the typeof
 * test rather than a promise that rejects on every tap), and the orientation
 * lock is Android-only and refuses outside fullscreen — so both failures are
 * swallowed. The game plays either way; this only removes the URL bar.
 */
export function enterFullscreenOnTouch(): void {
  if (!window.matchMedia("(pointer: coarse)").matches) return;
  if (document.fullscreenElement) return;
  const el = document.documentElement;
  if (typeof el.requestFullscreen !== "function") return;

  void el
    .requestFullscreen({ navigationUI: "hide" })
    .then(() => {
      // A first-person shooter has one orientation. The manifest says so for
      // the installed app; this says it for the tab.
      const orientation = screen.orientation as ScreenOrientation & {
        lock?: (o: string) => Promise<void>;
      };
      if (typeof orientation?.lock === "function") {
        void orientation.lock("landscape").catch(() => {});
      }
    })
    .catch(() => {});
}
