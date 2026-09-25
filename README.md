# GREYWATCH — Cel-Shaded Conquest

A browser-based **Conquest** shooter built with **Babylon.js** and
**TypeScript**, played in **first person** against bots — alone, or with other
people on a match server. Two sides fight over five control points on one of
eight maps, from a fog-drowned village at night to a volcanic island fifteen
hundred metres across (and the Candy Land board itself), eight a side or
twenty-four on the two biggest. The look
is low-poly and cel-shaded, with ink lines, and the scene is lit by what is
actually in it: lanterns, fires, muzzle flashes, a moon or a low sun, and the
light that bounces between them.

## Setup

```bash
npm install
npm run dev      # start the dev server (Vite), open the printed URL
```

Other scripts:

```bash
npm run typecheck  # tsc over the client and the server — the only automated gate
npm run build      # the gates + typecheck + production build to dist/
npm run preview    # serve the production build
npm run icons      # regenerate the install icons under public/icons (committed)
npm run shots      # re-photograph each map for the menu backdrop (committed)
npm run audio      # re-cut and re-encode audio/ from its masters (needs ffmpeg)
npm run collision  # re-bake each map's colliders for the server (committed)
npm run parity     # prove the server's world matches the browser's
npm run simulate   # play a whole round headless: `-- [map] [difficulty] [rounds]`
```

Requires Node 24+ and a **WebGPU-capable browser**: Chrome or Edge on any
platform, Safari 18 or later, and Firefox on Windows. Firefox on Linux and
macOS cannot run it, and neither can an older Android or iOS. There is no
WebGL fallback — the boot screen checks for a GPU adapter and says so rather
than showing a black page. WebGPU also needs a secure context, so the page has
to be served over HTTPS or from `localhost`.

`npm run shots` is the one script here that needs a machine with a real GPU;
everything else, the build included, runs anywhere.

## Multiplayer

Single player needs nothing but the page. Multiplayer needs a second process —
an authoritative server that runs the real simulation and hands clients what
moves — and **Multiplayer** on the main menu (or **M**) is the way to it: a list
of the matches that server is running, with a row per match and a button to
start a fresh one.

A match has **sixteen seats for people**, eight a side, on every map, and every
seat nobody is sitting in is a bot — so a round starts with one person in it and
fills up as people arrive. The map decides how big the fight is: Sarab and
Cinderhaven field twenty-four a side, online as well as off, of whom sixteen at
most are people. A match can also be created with **bots off**, and then it is
people and nobody else.

**A new match is started on the map you pick in that screen's Map row; joining
one puts you on the map it is already running**, whichever map the menu happens
to be showing. Every row names its match's map. When a round ends, the
eight-second pause before the next one is a **vote between three maps**: the
first is the one the rotation would have picked anyway, and it wins if nobody
votes or the vote ties.

A dropped connection retries into the same match, but into whatever slot is
free rather than the seat you left — possibly on the other side.

Locally:

```bash
npm run build:server   # bundle the server to dist-server/
npm run server         # run it (PORT, default 8080; MAX_MATCHES, default 4)
npm run dev            # the client, in another terminal
```

The dev client is on a different origin from the server, so point it at one:
`http://localhost:5173/?server=ws://localhost:8080/ws`. Deployed, the game and
the server share an origin and the menu needs no help. `?name=` on the URL sets
the name the scoreboard shows; there is no box for it in the interface yet.

Everything wired up, in two containers:

```bash
docker compose up --build
open http://localhost:8080
```

## Hosting it

The deployment is those same two containers from published images
(`ghcr.io/greywatch-game/greywatch` and `ghcr.io/greywatch-game/greywatch-server`,
`:latest` being `main`), behind whatever already terminates HTTPS for the
domain:

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
domain is. The settings worth a look:

| Setting | On | Default | What it is |
| --- | --- | --- | --- |
| `MAX_MATCHES` | server | 4 | matches one process runs; they all share one core |
| `MAX_SOCKETS_PER_IP` | server | 16 | open sockets per address; 0 turns the cap off |
| `TRUST_PROXY` | server | auto | `1`/`0` forces whether a proxy's forwarded address is believed |
| `MATCH_SERVER` | `web` | `match-server:8080` | where nginx sends `/ws` — the compose service name |

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
A player who has not chosen gets the fastest region that answers.

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

| Action              | Gamepad (Xbox / PS)         | Keyboard / Mouse       |
| ------------------- | --------------------------- | ---------------------- |
| Move                | Left stick                  | WASD                   |
| Look                | Right stick                 | Mouse                  |
| Sprint              | L3 (toggle)                 | Shift (hold)           |
| Crouch              | B / ○ (toggle)              | Ctrl (hold), C (toggle) |
| ADS                 | LT / L2                     | Right-click            |
| Shoot               | RT / R2                     | Left-click             |
| Jump                | A / ✕                       | Space                  |
| Reload              | X / ▢                       | R                      |
| Throw               | RB / R1                     | G                      |
| Swap weapon         | Y / △                       | Mouse wheel            |
| Draw slot           | —                           | 1 / 2 / 3              |
| Fire mode           | D-pad Down                  | B                      |
| Board / leave       | X / ▢ when offered, D-pad Up | E                    |
| Change seat         | Y / △ (in a vehicle)        | F                      |
| Climb / descend     | A / B (flying)              | Space / Ctrl (flying)  |
| Scoreboard          | Back / Share                | Tab                    |
| Loadout             | Y / △ (menus)               | L (menus)              |
| Settings            | —                           | O                      |
| Pause               | Start / Options             | Esc                    |
| Confirm             | A or Start                  | Enter / Click          |
| Back                | B / ○                       | Backspace              |

Bindings are fixed; the Settings screen lists them but cannot change them.

**There is no crosshair, and that is the aiming model rather than a missing
gauge.** Aiming down sights brings the fitted sight onto the centre of the
screen and zooms the view, and that sight is the only mark in the game that says
where your rounds go. Hip fire is unaimed: the spread is real, it is just not
drawn.

On a phone, the same actions are on the glass: **drag the left of the screen**
to move (push to the edge to sprint), **drag the right** to look, and the
buttons over them are fire, ADS, jump, crouch, reload, throw and swap, with
the scoreboard and the pause menu in the top corner. A **use** button appears
when there is something to get into, and a helicopter's pilot gets **up** and
**down**. The trigger also steers — press it and keep sliding, and the view
follows your thumb, so you never have to choose between shooting and aiming.
ADS and the scoreboard are taps rather than holds; the second, smaller fire
button on the left edge is for a claw grip. They are drawn only while a finger
is what is playing, and the HUD's own gauges shrink out of the corners while
they are up. Settings has a **Touch** page: look speed, a fixed or floating
stick, fire-to-aim, and **gyro aim** (off, only while aiming, or always) with a
speed of its own.

Click the page once to capture the mouse (pointer lock). Gamepads use the
browser's standard mapping and are hot-pluggable — press any button after
connecting. Pads with vibration support get **rumble** for shots, hits,
kills, and damage taken (requires a browser with the Gamepad haptics API,
e.g. Chrome/Edge with an Xbox or DualSense controller).

Gamepad look comes with **aim assist**: the stick slows down while the
aim is over an enemy, and the view pulls gently toward the target
(full strength while aiming down sights, weaker at the hip while firing or
steering). Pushing the stick against the pull cancels it — a committed push
always breaks free. It only engages while the right stick is the active
look device — the moment the mouse moves, assist disengages and sensitivity
is untouched, so mixed setups never penalize keyboard/mouse aim. **Touch gets
it too**, and for the same reason: a thumb on glass is a coarse pointing
device with no wrist behind it. The three rules above hold there unchanged —
a committed swipe cancels the pull exactly as a committed stick does.

### How a round works

- Two teams — **Valeguard** (warm amber) and **Redline** (cold crimson) — fight
  over **five control points**. How many a side is the map's: eight on most,
  and twenty-four on Sarab and Cinderhaven, because a fight is made of contact
  and contact is bodies per square metre. A side is told apart three ways, so
  the read survives losing any one of them: the whole kit is warm or cold, the
  team colour is worn on pauldrons, bandolier and helmet band where some of it
  faces every direction, and each side wears a helmet of its own shape — a peak
  against a respirator — for when a body is backlit, in fog, or too far away to
  have a colour at all.
- Stand inside a zone to capture it. More bodies capture faster, with
  diminishing returns; if both teams are inside, the meter freezes. A flag has
  to be swept through **neutral** before it changes hands, so you cannot steal
  one by briefly outnumbering the defender.
- Every zone is **marked in the world**: its exact capture boundary is laid on
  the ground, as whitewashed stones on open ground and a painted line on a road
  or a deck, and the flag over it **is** the meter — a cloth flag in the map's
  wind, run up its pole as the meter fills, in the colours of the side it leans
  to. Step inside and a panel names the point and shows the meter running.
- Each team starts with **400 reinforcements**. Every death costs one, and
  whichever side holds **fewer flags bleeds** tickets steadily on top. Winning
  fights while ignoring objectives still loses the round.
- Everyone — you and every bot — spawns with **two throwables** and no way to
  get more. The kit picks which: **frag grenades**, which arc, bounce off walls
  and roll, go off on a fuse, and are lethal at the centre and survivable at the
  edge — fragments do not go through walls, so a corner is real cover — or
  **molotovs**, which break on the first thing they touch and leave the ground
  burning for a few seconds.
- Death opens the **deploy screen**: a top-down map where you pick a spawn from
  the flags you hold, or fall back to your side's home base. Health regenerates
  a few seconds after you stop taking fire.
- The round ends when one side hits zero.

### The kit

Six primaries and a sidearm, each modelled on a real weapon. The **Loadout**
screen (L, or from the deploy screen) picks the primary, its sight, its finish,
the throwable, and on maps with armour the anti-tank item.

| Weapon          | Modelled on                       | Trigger                |
| --------------- | --------------------------------- | ---------------------- |
| Assault Rifle   | FN SCAR-H                         | auto / semi            |
| Burst Carbine   | FAMAS                             | 3-round burst / semi   |
| Submachine Gun  | SIG MPX                           | auto                   |
| Marksman Rifle  | HK G28                            | semi                   |
| Sniper Rifle    | Accuracy International AXMC       | bolt action            |
| Machine Gun     | FN Minimi                         | auto                   |
| Sidearm         | Colt M45A1                        | semi                   |

- **Seven sights**, any of them on any primary: reflex, irons, holographic, a 2x
  green dot, a 2.5x prism, a 3.5x scope and a 6x long scope.
- **Sixteen finishes**, remembered per weapon. They are paint and nothing else.
- Damage falls off with range, and no single round to the body kills — the
  sniper rifle included. Fire a bolt gun through its sight and the bolt stays
  shut until the sight comes down.
- **A map with armour on it puts a third slot in the kit**, and a map without
  one does not have the slot at all. It holds a rocket launcher or two mines,
  never both, because choosing is the point: two rockets are 1240 against a
  tank's 1200, so one launcher is one dead tank provided both land, and a mine
  is 800 that a driver never sees coming. Neither resupplies — the pouch is
  refilled by dying, like the throwables — and a mine is set off by vehicles
  only, so everybody's infantry walks over them. One bot in every squad carries
  a launcher and uses it on armour and nothing else.

### The maps

| Map             | What it is                                                                                                  | Play area | A side | Vehicles                 |
| --------------- | ----------------------------------------------------------------------------------------------------------- | --------- | ------ | ------------------------ |
| **Hollowmere**  | A drowned village at night, under fog. Lanes and walled yards make every flag a short fight.                | 240 m     | 8      | —                        |
| **Greyfen**     | The same valley two hours after sunrise, gone to jungle, with the sun coming down through the canopy.       | 240 m     | 8      | —                        |
| **Coldharbour** | A business district an hour before dusk, the sea at the end of every avenue. Three floors, glass to break.   | 320 m     | 8      | tank                     |
| **Harrowmead**  | A farming vale at sunset. No wall around it at all: the floor carries on and a leash counts you back.       | 400 m     | 8      | tank                     |
| **Sarab**       | A desert town an hour before noon, inside a kilometre and a half of sand.                                   | 900 m     | 24     | tank, truck, helicopter  |
| **Cinderhaven** | A harbour town on a volcanic island at night, lit by the burning mountain, with a bay you wade to cross.    | 1,500 m   | 24     | tank, truck, helicopter  |
| **Kurenai**     | A temple town in a mountain valley as the maples turn, forty minutes before sunset.                         | 240 m     | 8      | —                        |
| **Candy Land**  | The 1962 board game's board on a spring lawn: the rainbow path from START to Home Sweet Home, gumdrops and all. | 300 m     | 8      | —                        |

Hollowmere, the first of them: the **Chapel** is on a terrace with a single
ramp — hard to take, easy to hold. The **Mill** stands on the embankment over a
sunken creek, so whoever holds the banks shoots down into it. The
**Farmstead**'s barn has a hayloft, the best perch on the map, and the ramp up
to it is fully exposed. The **Bog Docks** are low and cramped by the
boathouses. The **Square** is a crossroads with four road approaches and almost
no cover.

### Vehicles

Four maps put armour on the field, one of each kind the map states per side,
parked on a hardstanding in each home yard. Walk up and press **E** (X on a
pad) to get in; the first person aboard drives, the second takes the gun, and
**F** (Y) crosses between the two seats.

- **Tank** — the driver steers and fires the main gun, the gunner has the
  cupola machine gun.
- **Gun truck** — lighter and quicker; the gunner has the remote machine gun,
  and there is no main gun.
- **Helicopter** — a gunship. The pilot flies it, climbing and descending on
  Space and Ctrl (A and B), and the gunner has the chin turret.

Every hull runs people over, and every hull can be killed. A destroyed one
stands as a wreck — and as cover — for sixteen seconds, and a fresh one arrives
at that side's hardstanding after forty-five. **Bots crew all three**, both
seats, and fly the helicopter; if you want one they are sitting in, walk up and
press **E** — the crew gets out. A vehicle belongs to its side. In a match the
server owns every hull exactly as it owns everything else: a driver simulates
their own and reports it, the way they already do their own legs, and getting
in and out are asks the server answers.

## Settings and performance

Settings (**O**) has four pages: **Input** (mouse and stick look speed, and the
bindings), **Touch** (see above), **Display** (render scale at 50, 75 or 100%,
an FPS counter, motion blur, paper grain, and the frame profiler), and
**Light** (light shafts, bounce light and shadows, each with rungs down to
off). A phone starts on low shadows.

**The frame profiler ships in the production build**, because the devices
worth measuring are the ones that will never run a dev server. Turn it on under
Display (or add `?profile` to the URL) and a chip appears in the corner. It
records continuously, so play until something stutters and then press **VIEW**:
the report opens at `/profile_viewer.html` on the same origin, offline
included, and nothing leaves the device. **KEEP** copies a compact report (**F3**
does the same mid-round), **SAVE** downloads the full one, and **TRACE** exports
the last 600 frames for [Perfetto](https://ui.perfetto.dev). `?gpu` adds GPU
timing where the adapter supports it. See
[`docs/profiling.md`](docs/profiling.md) for how to read one.

## Tech in one paragraph

Every mesh is built from Babylon primitives at runtime and merged into blocks;
the cel look is hand-written WGSL — there is no GLSL left and no transpiler in
the bundle — with sixteen dynamic point lights that cast into one shadow atlas,
a sun or moon with its own maps, shadows from the clouds, and bounce light
traced in compute against the colliders. Nearly all audio is synthesized
WebAudio; seventeen short samples — one report per weapon, the vehicle guns,
the reload, the bolt and one explosion — are laid over it, and the game is
still whole without them. The bots — sixteen of them, or forty-eight on Sarab
and Cinderhaven — steer on a precomputed nav grid with one flow field per
objective, no pathfinding at all, and plan as squads. The one physics engine in
the tree is Havok, which drops the dead and scatters broken glass and blast
rubble. It is required — the boot screen waits for it, beside the GPU adapter —
and nothing falls any other way.

**Contributor/agent documentation lives in [`CLAUDE.md`](CLAUDE.md)** —
architecture, load-bearing invariants, and conventions, with one contract per
subsystem under [`docs/`](docs/) and a one-line-per-file module map in
[`FILES.md`](FILES.md). Every source file also has a contract header at the top.

## Known limitations

- Characters are primitive assemblies, not modelled or rigged meshes, and all
  animation is procedural. Bots have knees and crouch behind cover, but nobody
  leans.
- **Ragdolls are cosmetic.** Havok runs the fall and nothing else: a corpse is
  absent from navigation, cover and hit detection, so bots walk through bodies
  and rounds pass through them.
- **Bots do not route around a parked vehicle**, and walk through hulls exactly
  as they walk through corpses. The nav grid, the cover map and the obstacle
  field are all baked once from the finished collider set, and a hull moves.
- A vehicle has two seats and no passengers.
- There are **no classes**, and the sidearm is not a choice.
- Nav cells hold a few surfaces each — three by default, and a map states its
  own where it stacks floors (Coldharbour's offices are three deep). Unusually
  deep stacks still need that number raised, and overflow is silent.
- **Multiplayer:** there is no name entry in the interface (`?name=` on the
  URL), a dropped player comes back in a fresh slot rather than the one they
  left, and there are no kill assists. One process's matches live in its own
  memory, so a region is scaled by adding a box behind a hostname of its own,
  never by putting a second process behind the same one.
- **Bindings are fixed**, and there is no audio settings page.
- **The touch controls are not customisable.** The layout is fixed — no drag to
  reposition, no size or opacity sliders, and no left-handed mirror, all of
  which every shipped mobile shooter has. Nor is there an auto-fire mode (CoD
  Mobile's "Simple") or a lean button. What is there is the shape those games
  agree on, at one size per screen height.

## Next steps for expansion

- An eighth map: one new `layout.ts` plus an `EnvironmentSpec`.
- Player-issued squad orders. Bots already plan their objectives as squads;
  what is missing is a way for you to tell one which flag to take.
- Another weapon or optic — both are a config entry plus a builder.
- **Bots that route around a parked hull.** `NavGrid`, `CoverMap` and
  `ObstacleField` are all baked once from the finished collider set, and a hull
  moves — so armour is invisible to every one of them, exactly as a corpse is.
- A fourth vehicle kind: a row in `VEHICLE_KINDS`, a block of numbers and a
  model file.
- A name box in the lobby, and rejoining the seat you dropped out of.

## License

[MIT](LICENSE) — do what you like with it, including commercially, as long as
the copyright notice travels with the copy.

One license covers the whole repository. Almost nothing in it is art: every
mesh is built from Babylon primitives at runtime and nearly all audio is
synthesized. The exception is the seventeen samples in `audio/` and the masters
they are cut from in `audio/src/`, which were generated with Adobe Firefly on a
paid account and are distributed under the same license.
The dependencies are permissive and compatible — Babylon.js is Apache-2.0, and
the Havok physics build pulled in by `@babylonjs/havok` (the one binary that
ships, for the ragdolls, glass and rubble) carries its own MIT terms from
Babylon.js.
