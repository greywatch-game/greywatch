# The installable app

The four files that make the build install to a home screen and launch offline,
and the phone-shaped details behind each. Split out of
[`CLAUDE.md`](../CLAUDE.md), which keeps the summary; this file is the contract
for `public/`, `src/pwa/` and the service-worker plugin.

The build installs to a home screen and launches fullscreen, landscape and offline.
Four files carry it: `public/manifest.webmanifest`, `public/icons/`,
`src/pwa/register.ts` and `src/pwa/sw.js`. Nothing in the game knows any of this
exists — `Game`'s one line is the fullscreen gesture.

**`public/` is the one place a URL is written by hand.** Vite copies it to `dist/`
unhashed, which is the point: a manifest names its icons, `index.html` names the
manifest, and a home screen keeps the `start_url` it installed with, so those paths
are a contract with something outside the build. The icons are generated and
*committed* (`npm run icons` → `scripts/generate-icons.mjs`, a zero-dependency PNG
encoder), so nothing at build time depends on a script having been run.

**The service worker is a template, not a module.** `src/pwa/sw.js` is never
imported and never typechecked; `vite.config.ts`'s `serviceWorker()` plugin reads it
in `writeBundle`, substitutes the whole `const PRECACHE = __PRECACHE__;` line for the
manifest of what was actually written to `dist/`, and emits `dist/sw.js`.

- **The version hashes every file's NAME AND CONTENTS.** Hashing names alone looks
  sufficient because Vite content-hashes asset filenames — but `index.html` is unhashed,
  and a byte-identical worker is one the browser never updates, so anything that
  changes only unhashed output would be served from cache forever. `index.html` still
  carries the head, the manifest link and the meta tags, and the next thing to live only
  there will not announce itself.
- **The substitution anchors on the declaration, not on the placeholder.** The file's
  header comment names `__PRECACHE__` twice; a plain string replace puts the manifest in
  the prose and leaves the code undefined.
- **`sw.js` must be served `no-cache`** (`docker/default.conf.template`). A cached
  copy is a client that can never learn a new build exists.
- **The two lists are `immutable` and `mutable`, and the split is what install is
  built on.** Everything Vite content-hashed into `/assets/` is its own bytes, so a
  copy already in any cache is by construction the right one and is copied rather
  than downloaded; the handful of files whose URL is a contract with something
  outside the build (`index.html`, the manifest, the icons) say nothing about their
  contents and are always refetched. `regions.json` is emitted and deliberately
  **not** precached — the fetch handler is network-only for it, so a precached copy
  is an entry nothing can ever read.
- **The match server's endpoints are exempt from all of it, by path.** The fetch
  handler is cache-first over *everything* same-origin and fills the cache with what
  comes back, and in a deployed build `/matches` is same-origin — nginx proxies it onto
  the game's own domain. So without the exemption the lobby is answered from the cache
  after its first ever fetch and shows one frozen list of matches for the life of the
  build. `cache: "no-store"` on the request and `no-store` on the response do not save
  it: the Cache API implements none of HTTP's caching semantics, and a `cache.put` is
  a `cache.match` hit by URL forever. **This can only be seen on the deployed site** —
  there is no worker in dev and none on a first load — which is what makes it worth
  stating here rather than leaving to whoever reads `sw.js`.

## How a deploy reaches the player

**The navigation is network-first and everything else is cache-first**, and that is
not a compromise between two strategies — it is the shape of the build. All eleven
megabytes are content-hashed, so cache-first there can never be wrong. `index.html`
is the one unhashed file, the only thing that says which build is which, and it is
eight kilobytes. Fetch those eight kilobytes and the asset URLs inside them decide
the version: a hit is the build you already have, a miss is the one you do not, and
the cache fills itself either way. Offline the fetch rejects at once and the
precached shell answers, so the flight-mode promise is untouched.

**It used to be cache-first for the navigation too, and the comment claiming that
cost "the launch after next" was wrong by a factor of five.** Two assumptions
underneath it do not hold, and both had to be fixed — either one alone still leaves
a player refreshing:

- **The browser does not notice.** A `register()` call for an already-registered
  script resolves against the existing registration without checking anything, and
  the soft update a navigation is supposed to trigger is throttled on a schedule of
  the browser's own. Measured against a local deploy: a full reload asked for
  `/sw.js` **zero** times and the precache sat on the previous build indefinitely,
  until `registration.update()` was called explicitly — at which point the new
  worker installed, activated and pruned the old cache within a second. That call in
  `register.ts` is the only thing that ever checks. It reads like belt and braces
  next to `register()` and it is not; do not tidy it away.
- **The install did not finish.** `cache.addAll` over the whole 11 MB was
  all-or-nothing, so a home-screen app closed mid-download discarded every byte and
  began again from zero on the next launch — which is how "open and close it five to
  ten times" could genuinely never converge. Install is per-URL now, and because a
  content-hashed URL already in a cache is copied instead of refetched, an
  interrupted install RESUMES.

**Measured, on the same pair of builds** (a deploy in which 43 of 52 asset names
re-hashed): the old worker spent 9.88 MB and was *still showing the old build* after
one reload; the new one spends 7.28 MB and shows the new build. The saving is not
mainly the copying — it is that the running page's own download of the 7.4 MB entry
IS the precache's copy, instead of the two fetching it separately. What reliably
survives a deploy is only the assets that import nothing (Havok's wasm, the water
textures, the collision chunks — about 2.7 MB); Babylon's lazy shader chunks import
from the entry, so its new name is in their bytes and re-hashes them. Two deploys
measured, one kept 50 of 52 asset names and the next kept 9.

**Two numbers bound the shell request, and they are not the same number.** A launch
waits `SHELL_TIMEOUT_MS` (3 s) before drawing the shell it already has — the budget
for a network that is present but not answering, since an offline fetch rejects
immediately. The request itself is given `SHELL_GIVE_UP_MS` (12 s) and is then
abandoned, and it is deliberately **not** wrapped in `waitUntil`. Measured against a
server that accepts a connection and answers nothing: pinned open, every stalled
launch leaked a socket, a browser allows six per host, and after a handful of
launches the app could not fetch anything at all — not the shell, not the bundle,
not the match list. Once the network recovered it stayed stuck on the old build with
*zero* requests reaching the server. A stale shell is a bad launch; a starved socket
pool is no launch.

**Nothing reloads a running page.** A round in progress must not be swapped out from
under the player, and it does not need to be — the navigation handler makes the next
*launch* current whether an update check fired or not.

Registration happens in `main.ts` **before** the `Game` is constructed and is
`import.meta.env.PROD`-gated: it must survive a Game that throws on a machine
without WebGL2, and a worker caching a dev server's module graph would be actively
harmful. It registers with `updateViaCache: "none"`, which is the app's half of the
`no-cache` header the deployment owes `/sw.js` — the same failure guarded twice,
because one of the two costs nothing to state. The update check it then makes by
hand runs again whenever the page becomes visible, throttled to a minute: that is
what a home-screen app resumed from the switcher does instead of navigating, and
nothing else here would fire for it.

Details about the phone, each of which was a visible bug first:

- **Fullscreen is taken on `document.documentElement`, never on the canvas.** A
  fullscreen element is the only thing drawn and the HUD is a `<div>` *sibling* of the
  canvas, so fullscreening the canvas plays the game with no tickets, no flags, no
  crosshair and no deploy map. It is gated on a coarse pointer: an installed app is
  already fullscreen from the manifest, and on the desktop the pointer lock does the
  immersing.
- **A touch is felt nowhere in `InputManager`, and every screen a phone meets
  carries its own button** — the menu's and the round-over card's Deploy, the deploy
  screen's map and `#deploy-go`, the kit screen's — each listening for its own
  `pointerdown`, which a finger raises like any other pointer. A tap used to be
  latched into `confirmPressed` (the masks are held state and a tap has no hold) so
  that the title screen could be got past at all; that latch deployed the player off
  the menu's map and difficulty rows on the way, and went with the mouse.
- **`--ov-scale` scales `#overlay` and `#deploy` on short viewports** by growing the
  box to `100%/s` and scaling by `s` about the top-left, so the backdrop stays
  full-bleed and the desktop (s = 1) is untouched. Nothing in this HUD scrolls, and a
  landscape phone is ~350px tall against screens authored for 720p. **`#loadout` is
  deliberately excluded**: its stage is a hole the 3D turntable is placed through,
  back-projected from the same viewport fractions the CSS uses, so a transform would
  move the hole and leave the weapon behind it — which is also why it is the one screen
  carrying a short-viewport media query of its own.
- **Inside a scaled box, `vh` and `vw` are still the VIEWPORT's**, so a length written
  in them is scaled a second time on the way out. `#deploy`'s map is `calc(min(56vh,
  60vw) / var(--ov-scale))` for exactly that reason: at s = 0.45 the raw form rendered
  the map at a quarter of the height it asked for, and the divide is the identity on
  every desktop.

## The controls a phone plays with

`src/ui/TouchControls.ts` is the on-screen set, and it is a **device rather than a
screen**: `InputManager` polls it once a frame exactly as it polls a gamepad, so
nothing in gameplay has heard of it. The shape is the one every shipped mobile
shooter converged on — floating stick left, look drag right, cluster over both —
and the reasoning for each part is in that file's header, next to the code it
explains.

What belongs here is the part that is about **the phone rather than the game**:

- **They are drawn only when touch is the device in the player's hands**, which
  is a question `InputManager` answers with a clock: three stamps, one per
  device, most recent wins. A pad or a mouse takes the controls off screen the
  moment it is used and a tap puts them back, so a phone with a controller
  paired to it plays either way round without a setting.
- **A tap arrives twice** — once as a `pointerdown`, and again a moment later as
  a synthesized `mousedown`/`mousemove` pair for the benefit of pages written
  before touch existed. Believing the second is how the controls take themselves
  off screen on the first press of the fire button. Two things stop it: the layer
  calls `preventDefault` (which suppresses the pair where it is honoured), and
  mouse evidence inside `CONFIG.touch.mouseGrace` of a finger is disbelieved.
- **A mouse that has not moved is not a mouse being used.** A locked pointer
  delivers a zero-delta `pointermove` every frame it is held, which is a mouse
  arriving 60 times a second by any test that trusts the event itself. Measured
  headless, that alone took the controls off a phone the instant it deployed.
  There is no pointer lock to take on a phone, and the `pointerdown` that asks
  for one skips a finger for the same reason.
- **The fire gate has a third term.** `Game`'s trigger asks for a pointer lock or
  a gamepad, because a UI click must never discharge the gun; a phone has neither
  and never will, so `touchActive` joins them rather than an exception being
  carved out. The CLICK hint takes the same third term — it is a lie on a device
  with nothing to click.
- **`#touch` is `position: fixed`, not `absolute`**, which is load-bearing: the
  stick is drawn at the `clientX/clientY` of the finger that made it, and `#hud`
  carries the safe-area padding, so an absolutely positioned layer would put the
  ring one notch's width from the thumb holding it. The three button groups take
  their own `env(safe-area-inset-*)` back, and scale on short viewports through
  `--tscale` — the same trick `--ov-scale` plays for the menu, one transform per
  group about the corner that group is pinned to.
