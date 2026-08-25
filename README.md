# HOLLOWMERE — Cel-Shaded Conquest

A browser-based, single-player **Conquest** shooter built with **Babylon.js** and
**TypeScript**. Eight-a-side against bots over five control points in a
fog-drowned horror village, in **first person** (aiming down sights brings the
fitted sight onto the centre of the screen and zooms the view) with a low-poly
cel-shaded look: a near-black valley lit by guttering lanterns, burning
braziers, muzzle flashes, and your own shoulder lamp.

## Setup

```bash
npm install
npm run dev      # start the dev server (Vite), open the printed URL
```

Other scripts:

```bash
npm run build    # typecheck + production build to dist/
npm run preview  # serve the production build
npm run icons    # regenerate the install icons under public/icons (committed)
npm run shots    # re-photograph each map for the menu backdrop (committed)
```

Requires Node 18+ and a WebGL2-capable browser (Chrome/Edge/Firefox/Safari).

## Multiplayer

Single player needs nothing but the page. Multiplayer needs a second process —
an authoritative server that runs the real simulation and hands clients what
moves — and **Multiplayer** on the main menu is the way to it: a list of the
matches that server is running, with a row per match and a button to start a
fresh one. A match is always 8v8; every seat nobody is sitting in is a bot, so a
round starts with one person in it and fills up as people arrive.

**A new match is started on the map you pick in that screen's Map row; joining
one puts you on the map it is already running**, whichever map the menu happens
to be showing. Every row names its match's map, and the server rotates to the
next one when a round ends.

Locally:

```bash
npm run build:server   # bundle the server to dist-server/
npm run server         # run it (PORT, default 8080; MAX_MATCHES, default 4)
npm run dev            # the client, in another terminal
```

The dev client is on a different origin from the server, so point it at one:
`http://localhost:5173/?server=ws://localhost:8080/ws`. Deployed, the game and
the server share an origin and the menu needs no help.

Everything wired up, in two containers:

```bash
docker compose up --build
open http://localhost:8080
```

## Hosting it

The deployment is those same two containers from published images, behind
whatever already terminates HTTPS for the domain:

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

`web` (nginx and the game) listens on `127.0.0.1:8080` and `match-server` is not
published at all — the only route to the simulation is nginx's `/ws` proxy on
the compose network. Point the reverse proxy at `127.0.0.1:8080` and give it one
thing it did not need while this was a static site: **`/ws` is a WebSocket, so
the Upgrade must survive the hop.**

```nginx
location /ws {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 1h;
}

location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
}
```

Caddy carries WebSockets by itself, so it is one line:
`reverse_proxy 127.0.0.1:8080`.

Nothing else needs configuring: the client asks its own origin for the match
list and opens the socket there, so the game does not know or care what the
domain is. Two settings are worth a look — `MAX_MATCHES` on the server (default
4, and one process's matches all share one core) and `MATCH_SERVER` on `web`
(default `match-server:8080`, the compose service name).

### More than one region

Players can be offered a choice of match server, with the round trip to each one
shown beside it in the lobby. A region is **this same pair of containers on a box
somewhere else, behind a hostname of its own** — there is no region-aware build
and nothing in the server knows which region it is. Stand the stack up there,
point `us-east-1.example.com` at it with the same `/ws` Upgrade forwarding, and
name it in the `regions.json` beside the compose file on the box that serves the
page:

```json
{
  "regions": [
    { "id": "us-west-1", "name": "US West", "host": "us-west-1.example.com" },
    { "id": "us-east-1", "name": "US East", "host": "us-east-1.example.com" }
  ]
}
```

That file is served unhashed and uncached, and `docker-compose.prod.yml`
bind-mounts it from beside itself, so adding a region — or dropping an unhealthy
one — is an edit on the box rather than a rebuild. Create it before the first
`up`, or Docker makes a directory where the file should be. `host` is an
authority and never a URL: the scheme comes from the page. Leave the file alone
and the game behaves exactly as it always has, as one server on its own origin.

Serve the page from **one** of the boxes rather than round-robin across them:
the client reads the region list from its own origin, and one hostname resolving
to two match servers is the arrangement regions exist to avoid. See
[`docs/multiplayer.md`](docs/multiplayer.md) for the whole of it, including the
worked two-box layout.

The single-player game still deploys on its own: bring up `web` without the
server and it plays exactly as it always has — the socket never opens, and the
lobby says it could not reach a match server.

## Installing it

The build is an installable app (a PWA): a web app manifest, generated icons,
and a service worker that caches the whole bundle, so once it has loaded a
round it launches offline.

- **Android / Chrome / Edge** — open the site, then _Install app_ from the
  browser menu (or the prompt in the address bar). It launches fullscreen and
  landscape, without browser chrome.
- **iOS / Safari** — open the site, _Share_ → _Add to Home Screen_. iOS gives
  it a standalone window rather than true fullscreen; that is as far as Safari
  goes.
- **Desktop Chrome/Edge** — the same _Install_ works, and gives it its own
  window.

Left in a browser tab on a phone, the first tap takes the screen and locks it
to landscape instead, so the URL bar is out of the way either way.

This needs the site served over **HTTPS** (or `localhost`) — a service worker
will not register otherwise, and without one there is no install prompt.

**A phone plays it with thumbs.** The on-screen controls appear the moment
touch is the device in your hands and get out of the way the moment a mouse or
a pad is used — so a phone with a Bluetooth controller paired to it works
either way round, with no setting to find.

## Controls

| Action     | Gamepad (Xbox / PS) | Keyboard / Mouse |
| ---------- | ------------------- | ---------------- |
| Move       | Left stick          | WASD             |
| Look       | Right stick         | Mouse            |
| Sprint     | L3 (toggle)         | Shift (hold)     |
| Crouch     | B / ○ (hold)        | Ctrl or C (hold) |
| ADS        | LT / L2             | Right-click      |
| Shoot      | RT / R2             | Left-click       |
| Jump       | A / ✕               | Space            |
| Reload     | X / ▢               | R                |
| Grenade    | RB / R1             | G                |
| Draw slot  | —                   | 1 / 2 / 3        |
| Use (tank) | D-pad Up            | E                |
| Scoreboard | Back / Share        | Tab              |
| Loadout    | Y / △ (menus)       | L (menus)        |
| Confirm    | A or Start          | Enter / Click    |

On a phone, the same actions are on the glass: **drag the left of the screen**
to move (push to the edge to sprint), **drag the right** to look, and the
buttons over them are fire, ADS, jump, crouch, reload, grenade and swap, with
the scoreboard and the pause menu in the top corner. The trigger also steers —
press it and keep sliding, and the view follows your thumb, so you never have
to choose between shooting and aiming. ADS and the scoreboard are taps rather
than holds; the second, smaller fire button on the left edge is for a claw
grip. They are drawn only while a finger is what is playing, and the HUD's own
gauges shrink out of the corners while they are up. Touch look speed has its
own row in Settings.

**Use** is how you get into a tank and out of it again, and on a map with no
armour it does nothing. Slot **3** is the anti-tank item, and it is only in the
kit on the maps that have armour — see the map notes below.

Click the page once to capture the mouse (pointer lock). Gamepads use the
browser's standard mapping and are hot-pluggable — press any button after
connecting. Pads with vibration support get **rumble** for shots, hits,
kills, and damage taken (requires a browser with the Gamepad haptics API,
e.g. Chrome/Edge with an Xbox or DualSense controller).

Gamepad look comes with **aim assist**: the stick slows down while the
crosshair is over an enemy, and the view pulls gently toward the target
(full strength while aiming down sights, weaker at the hip while firing or
steering). Pushing the stick against the pull cancels it — a committed push
always breaks free. It only engages while the right stick is the active
look device — the moment the mouse moves, assist disengages and sensitivity
is untouched, so mixed setups never penalize keyboard/mouse aim. **Touch gets
it too**, and for the same reason: a thumb on glass is a coarse pointing
device with no wrist behind it. The three rules above hold there unchanged —
a committed swipe cancels the pull exactly as a committed stick does.

### How a round works

- Two teams of eight — **Valeguard** (warm amber) and **Redline** (cold
  crimson) — fight over **five control points** across a 240 × 240 m village.
  A side is told apart three ways, so the read survives losing any one of
  them: the whole kit is warm or cold, the team colour is worn on pauldrons,
  bandolier and helmet band where some of it faces every direction, and each
  side wears a helmet of its own shape — a peak against a respirator — for
  when a body is backlit, in fog, or too far away to have a colour at all.
- Stand inside a zone to capture it. More bodies capture faster, with
  diminishing returns; if both teams are inside, the meter freezes. A flag has
  to be swept through **neutral** before it changes hands, so you cannot steal
  one by briefly outnumbering the defender.
- Every zone is **drawn in the world**: a coloured ring on the ground marking
  the exact capture boundary, a low glow that rises from the stretch of it you
  are walking up to, and a beacon over the flag you can see across the village.
  They carry the owner's colour and pulse while the flag is being taken. Step
  inside and a panel names the point and shows the meter running.
- Each team starts with **400 reinforcements**. Every death costs one, and
  whichever side holds **fewer flags bleeds** tickets steadily on top. Winning
  fights while ignoring objectives still loses the round.
- Everyone — you and every bot — spawns with **two frag grenades** and no way
  to get more. They arc, bounce off walls and roll, go off on a fuse rather
  than on impact, and are lethal at the centre and survivable at the edge.
  Fragments do not go through walls, so a corner is real cover. The blinking
  red pip on one that has landed near you is the only warning you get.
- Death opens the **deploy screen**: a top-down map of the village where you
  pick a spawn from the flags you hold, or fall back to your home gatehouse.
  Health regenerates a few seconds after you stop taking fire.
- The round ends when one side hits zero.

Map notes: the **Mill** sits down in a creek 1.5 m below the embankments on
either side, so whoever holds the banks shoots into it. The **Barn**'s hayloft
is the best perch on the map and the ramp up to it is fully exposed. The
**Chapel** is on a terrace with a single ramp — hard to take, easy to hold. The
**Bog Docks** are mist-choked and cramped by design. The **Square** has four
road approaches and almost no cover.

## Tech in one paragraph

Everything you see and hear is generated at runtime: every mesh is built from
Babylon primitives and merged per colour, all audio is synthesized WebAudio,
the cel look is a custom `ShaderMaterial` with 16 dynamic point-light slots,
and the 16 bots steer on a precomputed nav grid with one flow field per
objective — no pathfinding at all. The one engine in the tree is Havok, which
does nothing but drop the dead and scatter broken glass. It is required — the
boot screen waits for it, like WebGL2 — and nothing falls any other way.

**Contributor/agent documentation lives in [`CLAUDE.md`](CLAUDE.md)** —
architecture, load-bearing invariants, and conventions, with one contract per
subsystem under [`docs/`](docs/). Every source file also has a contract header at
the top.

## Known limitations

- Characters (bots) are primitive assemblies, not modeled/rigged meshes; all
  "animation" is procedural (posed joint hierarchies, walk cycles driven by
  travel speed). The rig has seven joints and no knees, so a bot can neither
  crouch nor lean — its cover is corners, not waist-high walls.
- Only the moon casts shadows. Its key light has a real shadow map, but the
  **point lights cast none** — lanterns, braziers and muzzle flashes light
  without occluding — and characters get blob-shadow discs rather than casting.
  Most of the darkness is fog, ambient and falloff.
- **Ragdolls are cosmetic.** Havok runs the fall and nothing else: a corpse is
  absent from navigation, cover and hit detection, so bots walk through bodies
  and rounds pass through them.
- Five primaries, a fixed sidearm and five optics — but **no classes**, and the
  sidearm is not a choice.
- **There is one vehicle, on the two maps that state one, online and off.**
  Coldharbour and Harrowmead give each side a tank on a hardstanding in its home
  yard: walk up, press **E**, drive it in third person, and put shells down the
  avenues. Destroy one and a fresh hull arrives at that side's hardstanding after
  45 seconds, with the burnt-out one standing as cover for the first sixteen. In
  a match the authority owns the hull exactly as it owns everything else — a
  driver simulates their own tank and reports it, the way they already do their
  own legs, and getting in and out are asks the server answers. Bots crew one
  too: a body that walks past its own side's hardstanding climbs in and takes
  the tank to its squad's objective, and if you want it back, walk up to it and
  press **E** — the crew gets out. One thing about it is honestly unfinished:
  **bots do not route around a parked one**, and walk through hulls exactly as
  they walk through corpses.
- **A map with armour on it puts a third slot in the kit**, and a map without
  one does not have the slot at all. It holds a rocket launcher or two mines,
  never both, because choosing is the point: two rockets are 1240 against a
  hull's 1200, so one launcher is one dead tank provided both land, and a mine
  is 800 that a driver never sees coming. Neither resupplies — the pouch is
  refilled by dying, like the grenades — and a mine is set off by vehicles
  only, so everybody's infantry walks over them.
- Nav cells hold a few surfaces each — three by default, and a map states its
  own where it stacks floors (Coldharbour's offices are three deep). Unusually
  deep stacks still need that number raised, and overflow is silent.
- Four maps: **Hollowmere**, a fog-drowned village at night; **Greyfen**, a
  jungle valley two hours after sunrise, with the sun coming down through the
  canopy in shafts; **Coldharbour**, a city's business district before dusk —
  larger than the first two, with no fog wall and with buildings you can fight
  through on three floors; and **Harrowmead**, the biggest of them, with no wall
  around it at all — the floor simply carries on and a leash counts you back.
  The last two are the two with armour on them. The system supports more; a
  fifth is one layout file plus an environment.
- **Multiplayer is one server process, and the lobby lists only that one.**
  Matches live in its memory, so it cannot be scaled by running a second copy
  behind the same address — that needs a shared matchmaker, which is not built.
  There is also no way to choose your name in the interface yet (`?name=` on the
  URL), and no reconnecting into the seat you left.
- **The touch controls are not customisable.** The layout is fixed — no drag to
  reposition, no size or opacity sliders, and no left-handed mirror, all of
  which every shipped mobile shooter has. Nor is there an auto-fire mode (CoD
  Mobile's "Simple"), a gyro aim, or a lean button. What is there is the shape
  those games agree on, at one size per screen height.

## Next steps for expansion

- A fifth map: one new `layout.ts` plus an `EnvironmentSpec`.
- Player-issued squad orders. Bots already plan their objectives as squads;
  what is missing is a way for you to tell one which flag to take.
- A sixth weapon or a sixth optic — both are a config entry plus a builder.
- **Bots that route around a parked hull.** `NavGrid`, `CoverMap` and
  `ObstacleField` are all baked once from the finished collider set, and a tank
  moves — so armour is invisible to every one of them, exactly as a corpse is.
- **A second vehicle.** Nothing in the code is special-cased to a tank, but
  nothing has been designed for two either: a second one is a model, a `CONFIG`
  block and a hard look at everything in `docs/vehicles.md` that says "the hull".

## License

[MIT](LICENSE) — do what you like with it, including commercially, as long as
the copyright notice travels with the copy.

One license covers the whole repository, which is only possible because there
are no authored assets to license separately: every mesh is built from Babylon
primitives at runtime and all audio is synthesized. The dependencies are
permissive and compatible — Babylon.js is Apache-2.0, and the Havok physics
build pulled in by `@babylonjs/havok` (the one binary that ships, for the
ragdolls) carries its own MIT terms from Babylon.js.
