/**
 * sw.js — the service worker: what makes the game launch with the phone in
 * flight mode, and what decides how soon a deploy reaches the person playing.
 * This file is a TEMPLATE: it is never served as it stands. `vite.config.ts`'s
 * `serviceWorker()` plugin reads it after a build, replaces `__PRECACHE__` with
 * the manifest of what that build actually emitted, and writes the result to
 * `dist/sw.js`.
 *
 * It is plain JavaScript, not TypeScript, because nothing imports it — it is
 * copied as text — and a `.js` file under `src/` is invisible to `tsc`. Keep
 * it small enough to read in one sitting; there is no typecheck behind it.
 *
 * **The one rule the rest of this file is an argument for: THE NAVIGATION IS
 * NETWORK-FIRST AND EVERYTHING ELSE IS CACHE-FIRST**, and the split is not a
 * compromise between two strategies — it is the shape of the build. Vite
 * content-hashes everything under `/assets/`, so those URLs are their own
 * bytes: cache-first there is not merely fast, it can never be wrong, and it is
 * where all eleven megabytes are. `index.html` is the ONE unhashed file and the
 * only thing that names which build is which, so it is the only file whose
 * cached copy can be stale — and it is eight kilobytes.
 *
 * That is the whole update mechanism. Fetch the eight kilobytes, and the asset
 * URLs in them decide the version; a hit is the build you already have, a miss
 * is the build you do not, and the cache fills itself either way.
 *
 * **This used to be cache-first for the navigation too, and the cost was not
 * the one the comment here claimed.** It said a deploy took effect "on the
 * launch after next" — one launch behind, in exchange for never waiting on the
 * network to start. In practice it was five to ten launches behind, because
 * "the launch after next" quietly assumed two things that are not true. The
 * new worker has to have NOTICED, and a reload does not make it look: a
 * `register()` call for an already-registered script returns without checking
 * and the browser's own soft update is throttled, so the check is now made by
 * hand in `register.ts` — read that note, it is half of this bug. And the new
 * worker has to have FINISHED, which meant one `cache.addAll` over the entire
 * 11 MB build, all-or-nothing, every refresh in the meantime served the old
 * shell, and a home-screen app closed mid-download starting again from zero.
 * So the number of times you had to reopen the game was really a measure of
 * how long you left it open. Freshness cannot rest on a background download
 * completing; it now rests on a request the launch itself makes.
 *
 *   install   fill this build's cache. Content-hashed URLs are COPIED from
 *             whatever cache already holds them; only what changed is fetched.
 *   activate  turn navigation preload on, and drop every other cache — a
 *             version no longer current is megabytes nobody will load again.
 *   fetch     a navigation is the network's answer, or the cached shell if the
 *             network does not answer in time. Everything else same-origin
 *             comes from the cache when it is there and fills it when it is
 *             not. Everything else again is passed through.
 *
 * `sw.js` MUST still be served no-cache (see docker/default.conf.template): the
 * navigation above keeps a launch current on its own, but a worker that can
 * never notice it is out of date is a precache that never advances, and the
 * first flight-mode launch after a deploy would be the build before it.
 */

/** Replaced at build time with `{ version, immutable, mutable }`. */
const PRECACHE = __PRECACHE__;

const CACHE = `greywatch-${PRECACHE.version}`;

/**
 * How long a launch waits for a fresh shell before drawing the one it already
 * has, and — separately — how long the request itself is given before it is
 * abandoned.
 *
 * Offline the first is never reached: a fetch with nowhere to go rejects at
 * once. It is the budget for a network that is PRESENT AND NOT ANSWERING — a
 * captive portal, a dead cell, a train. Falling back costs the player the
 * previous build for one launch, which is what every launch used to cost, so
 * erring short is cheap.
 *
 * The second is a different number for a different reason. A shell that is
 * merely slow rather than dead is still worth finishing, because the worker is
 * awake for the whole page load anyway — every subresource below is going
 * through it — so a copy that arrives after the fallback was drawn still lands
 * in the cache and leaves the NEXT launch current. What must not happen is
 * holding the line open indefinitely, and that is why the shell fetch is
 * deliberately NOT wrapped in `waitUntil` and is aborted where this worker owns
 * the request. Measured against a server that accepts a connection and then
 * answers nothing at all: pinned open, every stalled launch leaks a socket, a
 * browser allows six per host, and after a handful of launches the app cannot
 * fetch anything — the shell, the bundle or the match list. A stale shell is a
 * bad launch; a starved socket pool is no launch.
 */
const SHELL_TIMEOUT_MS = 3000;
const SHELL_GIVE_UP_MS = 12_000;

/** The shell's own key. A navigation is answered with this unless it is below. */
const SHELL = "/";

/**
 * The other navigable documents this build emits, which answer a navigation as
 * THEMSELVES rather than as the shell.
 *
 * **Without this list a second page is a page that works online and silently
 * becomes the game offline**, which is the worst of the three possible
 * behaviours: `freshShell` falls back to `cache.match(SHELL)`, and `SHELL` is
 * the game. The profile viewer is precached like every other unhashed file, so
 * the bytes are right there — it was only ever the key that was wrong.
 *
 * It matters most in exactly the case the viewer exists for. The frame
 * profiler is aimed at phones, and a phone that has just captured something is
 * regularly a phone on a LAN address with no route to the internet, or a
 * home-screen install in flight mode. Answering that navigation with the game
 * would throw away the capture the player pressed a button to keep.
 *
 * A path here must be a real emitted file and must be in the precache, or this
 * is a promise the cache cannot keep. Two entries, because `dist/` writes the
 * file and nginx serves the extensionless form too.
 */
const DOCS = new Set(["/profile_viewer.html", "/profile_viewer"]);

/** The cache key a navigation to `pathname` should be answered from. */
function shellFor(pathname) {
  return DOCS.has(pathname) ? "/profile_viewer.html" : SHELL;
}

/**
 * Fetches one precache entry from the network and stores it.
 *
 * `reload` so this populates from the network rather than from the HTTP cache,
 * which may still be holding the previous deploy's index.html — the one
 * unhashed file, and the one that would silently pin the whole app to the wrong
 * asset URLs.
 *
 * A bad status THROWS, which fails the install. That is deliberate: a cache
 * missing a file it promised is a flight-mode launch that dies partway through
 * boot, which is worse than a worker that did not update. The install is
 * resumable now (see below), so failing it is cheap.
 */
async function fetchInto(cache, url) {
  const res = await fetch(new Request(url, { cache: "reload" }));
  if (!res.ok) throw new Error(`precache ${url}: ${res.status}`);
  await cache.put(url, res);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);

      // A content-hashed URL IS its bytes, so a copy in ANY cache is by
      // construction the right one — and `caches.match` searches all of them,
      // which here means three useful places at once.
      //
      // The one that always pays is the RUNNING PAGE's. A network-first
      // navigation has just sent it after this build's bundle, and every byte
      // it fetches lands in a cache through the handler below, so the 7.4 MB
      // entry crosses the wire ONCE and this install copies it rather than
      // fetching a second private copy. That is the whole of the saving and it
      // does not depend on what changed: measured against `addAll` on the same
      // pair of builds, 9.88 MB and still the old build after one reload,
      // against 7.28 MB and the new one.
      //
      // The second is the STANDING BUILD's cache, and it is worth less than it
      // looks. What reliably survives a deploy is the assets that import
      // nothing — Havok's 2 MB wasm, both water textures, the three collision
      // chunks — about 2.7 MB. Babylon's lazy shader chunks do NOT reliably
      // survive it: they import from the entry, so the entry's new name is in
      // their bytes and re-hashes them. Two deploys measured: one kept 50 of 52
      // asset names, the next kept 9.
      //
      // The third is this build's OWN cache from an install that was cut short,
      // which is what makes an install resume rather than restart. `addAll` was
      // all-or-nothing over the whole 11 MB, so a home-screen app closed
      // mid-download discarded every byte and began again on the next launch —
      // which is how "open and close it five to ten times" could genuinely
      // never converge.
      await Promise.all(
        PRECACHE.immutable.map(async (url) => {
          const held = await caches.match(url, { ignoreVary: true });
          return held ? cache.put(url, held) : fetchInto(cache, url);
        }),
      );

      // The unhashed half — "/", index.html, the manifest, the icons. Their
      // URLs say nothing about their contents, so they are always refetched.
      await Promise.all(PRECACHE.mutable.map((url) => fetchInto(cache, url)));

      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.map((name) => (name === CACHE ? null : caches.delete(name))),
      );

      // Navigation preload puts the shell request in flight BEFORE this worker
      // is woken, which is what keeps the network-first navigation close to
      // free: without it a cold launch pays the worker's own start-up — tens to
      // hundreds of milliseconds on a phone — and only then begins the round
      // trip. Guarded rather than assumed: support is not universal and this
      // is the kind of fact that rots, and where it is absent the handler below
      // simply fetches for itself.
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }

      await self.clients.claim();
    })(),
  );
});

/**
 * Answers a navigation with the newest shell that can be had in time.
 *
 * The cached copy is the FALLBACK rather than the answer, and that inversion is
 * the whole fix: eight kilobytes off the network names this build's asset URLs,
 * every one of which is either already in the cache (nothing changed, nothing
 * downloaded) or a miss the fetch handler fills. A player who opens the game
 * gets the build that is deployed, on that launch, without knowing there is
 * such a thing as a service worker.
 */
async function freshShell(event) {
  const cache = await caches.open(CACHE);
  const key = shellFor(new URL(event.request.url).pathname);

  const fromNetwork = (async () => {
    // The preload response, when there is one, is the navigation's own request
    // already in flight. It must be awaited either way or the browser warns
    // about a preload nobody consumed. It is the browser's request rather than
    // this worker's, so the abort below cannot reach it — what bounds that one
    // is the worker's own idle shutdown, which the missing `waitUntil` allows.
    const preloaded = await event.preloadResponse;
    const res =
      preloaded ||
      (await fetch(new Request(event.request.url, { cache: "no-cache" }), {
        // Optional call: where `AbortSignal.timeout` is missing this is
        // `undefined`, which `fetch` ignores. Reaching for it unguarded would
        // throw inside this promise, and a throw here is indistinguishable from
        // being offline — the shell would fall back to cache forever and the
        // game would silently stop updating on exactly the old browsers least
        // able to say so.
        signal: AbortSignal.timeout?.(SHELL_GIVE_UP_MS),
      }));
    // Only a document's OWN url may be written back under its key. There is no
    // client-side router here, so any other path is a genuine 404 from nginx —
    // and one cached under "/" would be what every offline launch after it
    // showed instead of the game. A path that is not a known document resolves
    // to the shell's key, which its own pathname cannot equal, so it is never
    // written back.
    const isSelf = new URL(event.request.url).pathname === key;
    if (res.ok && res.type === "basic" && isSelf) {
      await cache.put(key, res.clone());
    }
    return res.ok ? res : null;
  })();

  // Handled, but deliberately NOT handed to `waitUntil` — see SHELL_GIVE_UP_MS.
  // The `catch` is still owed: an unhandled rejection here is reported as a
  // worker error on every offline launch.
  void fromNetwork.catch(() => {});

  const cached = await cache.match(key, { ignoreVary: true });
  if (!cached) return (await fromNetwork.catch(() => null)) || fetch(event.request);

  const raced = await Promise.race([
    fromNetwork.catch(() => null),
    new Promise((resolve) => setTimeout(resolve, SHELL_TIMEOUT_MS, null)),
  ]);
  return raced || cached;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // The match server's two endpoints are LIVE STATE on the game's own origin,
  // and this handler is cache-first over everything same-origin — so without
  // this line the lobby is answered from the cache after its first ever fetch
  // and shows one frozen list for the life of the build. It is not enough that
  // `fetchMatches` asks with `cache: "no-store"` and the server answers
  // `no-store`: the Cache API implements none of HTTP's caching semantics, so
  // `cache.put` stores what it is given and `cache.match` returns it by URL.
  //
  // Returning without calling `respondWith` hands the request back to the
  // browser untouched, which is what makes it network-only. Offline it fails,
  // and that is correct — there is no multiplayer offline, and a cached list is
  // a menu full of rooms that stopped existing.
  //
  // Named as paths rather than tested against the socket's URL because these
  // are proxied independently of `/ws` and only agree by convention, which is
  // the reason `net/lobby.ts` names `/matches` outright too.
  //
  // `/regions.json` is here for a DIFFERENT reason and is worth not merging
  // with them in your head. It is a static file the build emits — but it is the
  // one static file a deployer is expected to edit on the box, without a
  // rebuild, and it is what a region being drained is edited out of.
  // Cache-first would answer with the version that shipped until the next
  // deploy, which is to say it would point players at a server somebody has
  // already taken out of the list. It is network-only here, and for that reason
  // it is also the one emitted file the precache LEAVES OUT: an entry this
  // handler can never return is not a fallback, it is a lie about one.
  // `loadRegions` answers a failed fetch with this page's own origin, so an
  // offline launch is a single-player launch rather than a broken one.
  if (
    url.pathname === "/matches" ||
    url.pathname === "/health" ||
    url.pathname === "/regions.json"
  ) {
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(freshShell(event));
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // `ignoreVary` because nginx sends `Vary: Accept-Encoding` with `gzip_vary
      // on`, and a match that honours it can miss a URL that is sitting right
      // there — the entry was stored under whatever the request that filled it
      // happened to advertise. Every key here is content-hashed or the shell,
      // so the URL alone is the identity and there is nothing for Vary to tell
      // apart.
      const hit = await cache.match(req, { ignoreVary: true });
      if (hit) return hit;
      const res = await fetch(req);
      // Only a clean same-origin response is worth keeping. An opaque or
      // errored one cached here would be served for the life of the build.
      if (res.ok && res.type === "basic") {
        void cache.put(req, res.clone());
      }
      return res;
    })(),
  );
});
