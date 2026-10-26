# CLAUDE.md

The rules for AI coding agents (and contributors): what each thing owns, what is
load-bearing, and what must never be undone. `AGENTS.md` points here; `README.md`
is user-facing.

**This file is the spine, not the whole of it.** It carries the project's shape,
the wiring rule, the two rules the world layer cannot bend, and the conventions —
what crosses subsystems, or what a change anywhere could silently break. A
subsystem's own rules live in a companion under `docs/`, and each of those is the
**contract** for the code it names. The summary here is a pointer, not a
substitute: read the companion before changing that subsystem.

| contract | read it before |
| --- | --- |
| [`docs/weapons.md`](docs/weapons.md) | the viewmodel, the aim path, the two slots, an optic or a weapon model |
| [`docs/grenades.md`](docs/grenades.md) | anything about the one projectile in the game |
| [`docs/states.md`](docs/states.md) | a new screen, a new game state, anything about what a lid holds or lets run |
| [`docs/ui.md`](docs/ui.md) | any screen, any stylesheet, anything under `src/ui/` |
| [`docs/rendering.md`](docs/rendering.md) | lights, shadows, fog, outlines, block visibility, the post chain, the sky, the grass |
| [`docs/world.md`](docs/world.md) | a map, a layout, a builder, the terrain or the rim |
| [`docs/editor.md`](docs/editor.md) | anything under `src/editor/` or the dev write endpoint |
| [`docs/bots.md`](docs/bots.md) | navigation, perception, cover, squads, bot cost |
| [`docs/deaths.md`](docs/deaths.md) | ragdolls, glass shards, Havok, the death cam |
| [`docs/vehicles.md`](docs/vehicles.md) | a vehicle of either kind, a new kind, its hull collider, its picture (`VehicleView`), the chase camera, mounting, the respawn |
| [`docs/antitank.md`](docs/antitank.md) | the third slot, the launcher, the mine, the rocket that flies, a bot with a tube |
| [`docs/audio.md`](docs/audio.md) | a sound, a sample, `audio/`, the audio budget |
| [`docs/pwa.md`](docs/pwa.md) | `public/`, `src/pwa/`, the service worker |
| [`docs/multiplayer.md`](docs/multiplayer.md) | anything under `server/` or `src/net/`, the roster, the collision bake, the regions, the two images and the proxy in front of them |
| [`docs/game.md`](docs/game.md) | extracting anything from `Game.ts`, `installMap`, what a frame owes |
| [`docs/build.md`](docs/build.md) | adding a generated asset, `vite.config.ts`, anything importing from `@babylonjs/*` |
| [`docs/profiling.md`](docs/profiling.md) | the frame profiler, a new phase, anything measuring a frame |

Three more companions carry what is looked up rather than reasoned about.
**`FILES.md`** is the module map, one line per file — read it to find the right
module, and the rules those modules obey are below. **`VERIFYING.md`** is the
headless-browser quirks; read it before writing a Playwright script.
**`FINDINGS.md`** is the open-threads list — measured, worth doing, not yet done
— read before performance work, and delete an entry when you fix or disprove it.

**A section that outgrows the spine becomes a file of its own, and the rule is
mechanical so nobody has to weigh it.** When a `###` section here passes ~150
lines, split it into `docs/<topic>.md`: move the prose **verbatim** — this
material is argued rather than stated, and a paraphrase loses the argument along
with the reason the rule exists — demote its headings one level, and leave behind
a summary carrying whatever a reader must not violate even if they never open the
file, plus the pointer and a row in the table above.

**That split is a MOVE, and the summary left behind owes a TRIM the move does
not do for it.** A companion-backed section here STATES rules and does not argue
them: the companion holds the argument verbatim, and a spine that argues too is
one where every subsystem's whole case is written down twice. So a measurement,
a worked number, the history of what was tried first and the symptom a bug
presented as all belong in the companion or in `FINDINGS.md` — never here.

**Keep this file under ~1,500 lines, and the PER-SECTION CAP is what holds it
there**, the total being a consequence rather than a thing to trim toward: a
companion-backed section is **~85 lines**, and the few that carry a reference
table or a contract two subsystems both read may run to **~135**. When a section
is over, cut the argument first by the rule above; if it is still over, cut the
RULES that only that subsystem's own author can break. **The test is whether
somebody who is NOT editing this subsystem could break it** — anyone who IS has
already been sent to the companion by the table above, so a rule about the
flight model or a puff's colour belongs there, and one about what a hull is to
the ray queries belongs here. What must **not** move out is anything two
subsystems both depend on; that is what this file is for. Four sections stay
long whatever their companion holds, because what is in them is what crosses
subsystems: the wiring, the two rules the world layer cannot bend (the collider
proxy and the metadata contract), and the conventions — ~340 lines between them.

**Every source file has a contract header** stating what it owns, its invariants,
and what it must never do. Read it before editing that file.

## Project overview

**GREYWATCH — Cel-Shaded Conquest**: a browser-based, single-player
**first-person** Conquest shooter (8v8 vs bots, five control points, ticket
bleed). **Babylon.js** + **TypeScript** + **Vite**; ES modules, Node 24+,
**WebGPU** — there is no WebGL fallback engine in the tree and there must not be
one. `main.ts` gates the boot on `navigator.gpu` AND an adapter, so a browser
without one gets a sentence instead of a black page.

**The engine is built with `compatibilityMode = false`, and that is load-bearing
rather than a tuning flag. Do not delete it to tidy the boot.** Its risk is
state changing between draws: if a rendering bug ever appears that shows only
while something is MOVING, flip this first (`docs/rendering.md`).

**Zero model files, and SEVENTEEN audio files** — every mesh is built from
primitives at runtime (for the world kit, the scatter props and every model
the copies of Babylon's in `src/geometry/`, for the rest Babylon's own), and
every sound is synthesized WebAudio (`src/core/Sfx.ts`) but for those seventeen. Do not add asset files unless
explicitly asked. There are four generated exceptions, each with a generator in
`package.json`: the icons, Havok's `.wasm`, the water's foam mask, and each
map's menu photograph. **The recordings in `audio/` are the fifth**, and **the
game is still whole with every file in `audio/` deleted** — a shot fired before
the decode lands is the SYNTHESIZED report. **AN EIGHTEENTH sound owes that same
claim**, and **what the pipeline refuses is a LIBRARY, not a sound that is not a
gunshot**. **A sample belongs to a VOICE, never to a weapon**, and **the budget
is SECONDS of mono, not bytes** — `npm run build` fails over it. **A sample is
the DIRECT sound; the ROOM is the game's.**

**The world also makes a noise on its own** (`Sfx.ambience`,
`systems/AmbienceSystem.ts`), and it is synthesized: **sample the guns, never
the ambience.** **An emitter's INDEX is its identity**, so the registry is
append-only within a map and a teardown owes `Sfx.ambienceAllOff` beside the
`clear`. It is pushed from `tick` in **every** state. **THREE things carry a
sound**: a scatter prop through `SCATTER_AMBIENCE` (beside `SCATTER_LIGHTS`), a
STRUCTURE through `Build.sound`, `Build.light`'s twin — **what is drawn as
burning is heard burning** — and a `WaterRect`. It is named by ID (`AmbienceId`,
`AMBIENCE_KINDS`) and never by reaching for the audio config, **a position is
taken at BUILD time or not at all**, and `WaterRect.sound` is the one optional
field on a layout whose default is not "unaffected": absent means `shore`.
**TWO FADERS SIT ABOVE ALL OF IT AND THEY MULTIPLY** (`CONFIG.mix`, the dev-only
`F4` panel), and **a fader is TWO NODES, which is the rule a new sound breaks**:
every layer helper in `Sfx` takes a `MixBus` FIRST, read into a LOCAL and
**never held in a field**. **A channel that belongs to a THING is named on that
thing** (`ReportVoice.mix`, `EngineKind.mix`, `AmbienceKind.mix`).

**Havok's `.wasm` (~2 MB) is the one binary that ships**, never named by path
and never also hand-placed in `public/`. **It is REQUIRED**: `main.ts` awaits
`loadHavok()` before it constructs `Game`, so nothing downstream asks whether
physics has arrived. **No shader in `src/` may be GLSL** — `WebGPUEngine`
fetches two more WASMs the moment one is. **Never add a deep static import into
`@babylonjs/core`, and never drop `optimizeDeps.exclude` from `vite.config.ts`**
— both break a DEV session only; `npm run build` fails on the first. **There is
no rigged character asset in the tree**: do not reintroduce a GLB body, and do
not extend that approach to bots or weapons.

→ **[`docs/audio.md`](docs/audio.md)** — the seventeen rows and what makes each
admissible, the three budgets, the ambience's ranking and both water fits, the
mixer's two tiers and pair buses, `F4`, the pipeline and every trim.
**[`docs/build.md`](docs/build.md)** — the generated assets and the test a sixth
owes, Havok's path, the dev-only 404, the two WASMs' tripwires, the deep-import
trap in full, and what the WebGPU gate cost in reach.
## Commands

```bash
npm install
npm run dev        # Vite dev server
npm run typecheck  # tsc --noEmit (strict, noUnusedLocals/Parameters)
npm run build      # gates + typecheck + production build to dist/
npm run corecheck  # the ONE test: the core's scoring and person rules off its
                   #   events with no Game, then through a real Match
npm run preview    # serve the production build
npm run icons      # regenerate public/icons (committed)
npm run audio      # re-cut and re-encode audio/ from its masters (committed
                   #   source). Needs ffmpeg + ffprobe on PATH; the BUILD does
                   #   not, since the output is committed — docs/audio.md
npm run audio:measure # where the numbers in a `trim` come from: envelope,
                   #   bands, width, sum, onset, room. `-- --row <id>` for a
                   #   shipped row, `-- --all` for the directory on one basis,
                   #   `-- --decode` to prove the browser decodes them
npm run loc        # how big the project is: hand-written code split into
                   #   code/comment/blank, apart from the generated bakes and
                   #   the map data. `-- --files 20`, `-- --json`
npm run kit:hash   # fingerprint every kit builder over every placement, the
                   #   DRAWING and the COLLIDERS hashed apart — proves a
                   #   refactor moved nothing, or a rework kept its colliders.
                   #   The SCATTER props too, over fixed seeds and every
                   #   foliage rung, their collider half being the
                   #   `PROP_BODIES` row and the region-stream draw count,
                   #   and FAILS if a kind's replay (`props/sharedDraws.ts`)
                   #   draws a different count from its builder.
                   #   `-- --kinds a,b`, `--out f.json`, `--against f.json`.
                   #   `-- --feet` measures every kind against the generators'
                   #   footprint table (`scripts/lib/footprints.mjs`)
npm run merge:hash # kit:hash's other half: builds every map in a real browser
                   #   and hashes what the MERGE hands the world — every
                   #   visual, collider and terrain collider, and the box
                   #   lists — and fails on any mesh left a PART. Proves a
                   #   change to how parts are built or merged moved nothing,
                   #   and is owed by every Babylon upgrade (docs/build.md).
                   #   `-- --out f.json`, `--against f.json`, `--maps a,b`,
                   #   `--editor` for the editor's unmerged build
npm run shots      # re-photograph the maps for the menu backdrop (committed).
                   #   The ONE script here that needs a real GPU — docs/build.md
npm run proving    # regenerate the DEV-ONLY proving ground (committed source).
                   #   `-- --play 900 --margin 300`. Not a level — ENGINE_UPGRADE.md
# RE-SEED a map's layout and heights (committed source). Each is ONE-SHOT —
# it DISCARDS editor edits to both files — is part of no build, and owes
# `npm run collision -- <map>` after it. `--probe` (and greyfen's `--at` and
# `--point`) print the floor and write nothing; the script's header has the rest.
npm run sarab        # ENGINE_UPGRADE.md S11
npm run cinderhaven  # `--probe`: the floor as a plan, a section and a survey
                     #   (how you iterate on a coastline); `--roads`: how far
                     #   every dry, in-play square is from a carriageway
npm run kurenai      # `--probe`, `--plan` the claim list, `--refusals`
npm run harrowmead   # `--probe`, `--refusals` every plot refused and why (a
npm run hollowmere   #   road, the water, a slope, a door onto nothing)
npm run greyfen      # `--at x0,z0,x1,z1` / `--point x,z` the floor, `--stands`
npm run coldharbour  # `--probe`, `--refusals`
```

No test suite but `corecheck`, no linter. `npm run typecheck` is the automated
gate — run it after any change. Playwright + Chromium are devDeps for ad-hoc browser smoke
tests; write throwaway scripts to the scratchpad, not the repo, drive them
through the `window.__celshock` handle `Game`'s constructor exposes, and read
**[`VERIFYING.md`](VERIFYING.md)** before writing one rather than after it has
misled you — **it is written PER MACHINE now**, because a headless Chromium
needs the right binary and the right flag before `navigator.gpu` will hand back
an adapter at all, and several of its rules invert between a box with a GPU and
one without. Anything with a PICTURE in it needs the first kind.

## Architecture

### Ownership and wiring

**Systems never import each other, and they meet in exactly two places.** **The
systems that DECIDE a round meet in `src/sim/SimCore.ts`, wired once there** —
ONE core, which `Match` hosts for every round anybody plays, and `simulate` and
`corecheck` host bare. It wires them with callbacks
(`battle.onBotKill/onBotFired`, `conquest.onCaptured/onNeutralised`, …), hands
bot AI a `BattleCtx` (`entities/Bot.ts`) built once, and runs
`ConquestSystem.update` *before* `BattleSystem.update`, so a think tick sees
this step's flags. **The VIEWS meet the round in `src/core/Game.ts`, and only as
a MATCH CLIENT**: every round — a server's, or the page's own — is a `Match` the
page joins through `NetSession`, sends its player's acts to as messages the
authority validates, and hears through ONE switch (`onNetEvent`). **Its views
read the round off the WIRE and nothing else** (`net.roster`, `syncNetVehicles`,
the flags and tickets in `updateNetWorld`), so no object of the authority's is
nameable on the page, and a view wanting what the wire lacks owes the PROTOCOL a
field — for both kinds of round at once. So "systems never import each other"
holds on the page, and new cross-system behaviour goes in one of the two
wirings. Type-only imports are fine — erased.

**Offline the page HOSTS that `Match` itself and OWNS it** (the Multiplayer
section): its clock is advanced from `updateWorld` and held otherwise, so a
lid or the deploy screen holds the world. **The rule is ONE client model:
whatever about the online experience is not acceptable offline is fixed for
BOTH**, and offline never gets a better transport than a match. **Nothing on
the page may depend on WHEN the match answers**, and **the local `Player` is a
PREDICTION exactly as in a server's match** — its sweep, its ground, its
stance, the HUD's regen and, in a hull, the DRIVE — validated on arrival and
answered as events (`docs/game.md`).

**There is one system that calls another directly, and it is injected rather
than imported**: `BattleSystem` takes `CombatSystem` in its constructor
(`SimCore` owns the wiring) and calls `combat.fire` for a bot's shot,
synchronously inside the think tick so the same step's kill handling sees it.
Read the rule as "never reach for another system", not "never mention its type".

**A system that SIMULATES owns its state on `src/math` and never imports
Babylon; its PICTURE is a view module beside it (`CombatFx`, `GrenadeFx`,
`VehicleView`, `PlayerView`, …) that reads it and never writes it.** `SimCore`
builds the simulations, `Game` the views (and the page's predictions),
so nothing that decides an outcome may read a node — a throw's, a rocket's and
a mine's start point are command INPUTS the page computes (`FINDINGS.md` 55).
`scripts/check-babylon-free.mjs` fails the build on any value import path from
`server/`, `src/sim/` or a simulation to `@babylonjs/core`, so **a new
simulation joins its `SIMULATIONS` list** (`docs/build.md`).

**`Game.ts` is long on purpose**: what may leave it is a cluster of **private
fields that answers only to itself** (`net/RegionBook.ts`), never anything
whose methods reach across systems, however big it gets (`docs/game.md`).

**`installMap` is the one place a map is built**, and both callers — a round
starting and an editor rebuild — go through it, since two copies drift
silently. **Anything new that
consumes a `GameMap` or an `EnvironmentSpec` goes in `installMap`.** **What a
round SIMULATES is not built there**: `SimCore.startRound` builds the core's
world (`buildSimWorld`) off the map as DATA — its committed collider bake and
its floor (`loadSimWorld`), on a server and in the page's own match alike — so
a new fact the simulation reads goes through that pair, and an editor save
plays against the old colliders until `npm run collision` re-bakes them.

`Game`'s state machine is `menu -> loading -> deploy -> playing -> dying ->
deploy`, with `roundover` when a side runs out of tickets, and `bench` — the
benchmark `?bench=<map>` plays — off to one side of it like `editor`. **The 3D
scene renders in every state** — in the page's own match over a HELD world,
advanced only through `updateWorld` (`playing`, `dying`, `bench`) — and
`loading` and `dying` are **STEPS, not lids**: `updateWorld` runs in full under
the death cam, and nothing may simulate under the building card. **The
menu has NO map behind it**: it stands on a photograph, so leaving a round goes
through `Game.teardownMap` — `installMap`'s other half, and the one place a map
is torn down — and anything new that `installMap` hands a map to owes a line
there that takes it back.

**`loading` ends in a PIPELINE WARM-UP** (`core/PipelineWarmup.ts`): after the
reflection bake, the card draws the whole map from each home spawn and flag
until a frame compiles nothing, because WebGPU compiles a pipeline on the frame
that first draws it. **It OPENS by waiting for OUR renderer's pipelines**,
which are asked for ahead and compiled off the frame (`PipelineCache`'s
counts). What it cannot see it is SHOWN, one frame at a time, by a `warm(on)`
on whatever owns an idle pool (a shot's effects, a blast, a scorch, a body, a
blob, the weapon) — **posed as IN FLIGHT**, since a stretched mesh or a
`visibility` under 1 is a different pipeline from the idle pose. **A new pool
that idles switched off owes one**, or its first use compiles in the round.

**A LID is a screen laid over a state, which taking it off puts back rather than
moving the game on — and which state is which, and what each one owes, is
DECLARED rather than described.** `SCREENS` in
[`src/core/ScreenStack.ts`](src/core/ScreenStack.ts) is a
`Record<GameState, ScreenSpec>` with one row per state, so **a new screen does
not compile until it has answered all four questions**: what it may cover,
whether the world under it is held in the page's own match, whether it owes a
server's round the frame the authority keeps running behind it, and whether the scoreboard is owed to it.
`Game` has exactly three moves (`go`, `raiseLid`, `lowerLid`), **nothing in the
codebase assigns a game state** — `Game.state` is a getter — and `Game.takeDown`
is the one place that knows what putting a screen away means. **`#overlay` is
the one screen the TABLE cannot own**, so a caller that wants it up raises it
AFTER its own `go`. **The question a
lid raises is never which screen is up, but whether what is under it is moving**:
in the page's own match a pause genuinely holds the world, and in a server's
round it holds nothing, because the authority never heard the key.

`Game.updateGameplay` has a load-bearing order at the end of the frame: camera
update → carried-light updates → `lighting.update(dt, camera.position, mats)`.
Light slot selection keys off the camera position, so nothing may move the
camera after it. **What the states that simulate nothing still owe is pushed
from `tick`** (`docs/game.md` lists it), and four of those cross subsystems:
`mats.updateCamera()` (the shader's EYE), `sfx.setListener()` (the EAR),
`Game.pushAmbience` and `Game.pushScoreboard` (the Tab board belongs to the
ROUND, not to the states that simulate one).

→ **[`docs/game.md`](docs/game.md)** — the page's own match (its host, the
owner channel, the frame's `advance` and `hold`, a lost host), the mechanical
test for what may leave `Game.ts`, what `installMap` hands to which system,
and the pushes from `tick`.
**[`docs/states.md`](docs/states.md)** — the full cycle, the four spec fields,
the stranded-screen bug behind them, the reflection bake draining behind the
loading card, pausing and the netplay inversion of it, and the pointer-lock
trigger.
### First person, the weapon on the camera, and the loadout

The camera sits **at `Player.eyePos`** — the same point `CONFIG.camera.eyeHeight`
defines and bots test LOS against — and there is **no player body mesh at all**.
Crouch is that one point moving, and `Player.center` must come down the same half
metre or crouching makes you *easier* to kill.

**A new weapon is a table entry, a model builder and a row in `ViewModel`'s
`WEAPON_BUILDERS`; a new optic is a table entry and a builder in `optics.ts`.**
Both are `Record`s over the derived id union, so neither compiles half-added, and
nothing else has to be told — but the kit screen's stat bars are shares of the
BEST figure in the kit, so a weapon that sets a new best shortens every other bar
in that row.

**Three tables carry the kit and none of them knows about the others**:
`CONFIG.weapons` owns the round, `CONFIG.sights` owns the picture and
`entities/finishes.ts` owns the paint, and **the finish table decides nothing** —
it reaches neither the camera nor a caption nor the wire. **What a weapon SOUNDS
like is a field stating only what is DIFFERENT**, as `recoilMult` and
`recoilImpulse` scale `CONFIG.recoil`, and **the rifle is the reference with
every number 1** — a shooter with no weapon of its own needs no default
anywhere.

**Everything about an aimed weapon is arranged so that the reticle cannot lie.**
The aimed pose is DERIVED and never authored — `applyFit` cancels the fitted
sight's own `sightCenter` onto the axis `CombatSystem` sends bullets down — and
it owes a re-derivation on **every loadout change, including a change of
weapon**. So the hold sway is on the AIM and not the rendered camera, and the
reload breaks the aim outright rather than posing an aimed weapon.

**AND THERE IS NO CROSSHAIR — the middle of the screen is EMPTY, and that is
the aiming model rather than a gauge nobody got round to.** Hip fire is
UNAIMED: `Player.spread` is still simulated and still reaches every round, it
is simply not drawn. **Two marks are drawn there anyway and both are exempt
because neither is an aim** — `#hitmarker` reports a round that has already
landed, and a hull's `#gun-marker` is drawn where the barrel points. **Anything
new in the middle of the screen owes that test**, and **the hit confirmation is
ANCHORED to the gun marker**, written from `HUD.setGunMarker` itself and back at
the centre for a seat that draws no marker (`docs/ui.md` has the argument).

**Springs and timelines have one owner each**: the punch spring is `Player`'s,
the bob phase is `CameraSystem`'s, and the reload is a timeline keyed to
`Sfx.reload`'s clacks. **The trigger is two questions** (must it come UP, what
does one pull SPEND) and `CONFIG.weapons[id].modes` is a weapon's ANSWERS, worn
one at a time and quoted throughout the table in `modes[0]`: **`tryShot` reads
the POSITION, never the weapon**, and the position is the HOLSTER's beside the
magazine. A reload, a swap, an empty magazine, a death **or a switch** must
ABANDON what a burst owes.

**There are THREE gestures over a weapon and only one has a clock of its own.**
The reload runs on `reloadTime` and needs a gate, a phase and a cancel path; the
launcher's load (`muzzleLoad`) and the bolt cycle (`boltCycle`) are both the FIRE
COOLDOWN read as a gesture, and hold no state at all. **A new gesture over a
wait belongs on that clock, not on a new one.** The reload and the load take the
aim away with them (`aimBreak`); **the bolt cycle is the one that KEEPS THE
SIGHT PICTURE, and it is where a gesture over an aimed weapon must go**, since
an aimed weapon that MOVES is a reticle that lies.

**An optic's `eyeRelief` has to RISE with its magnification**, or the aimed
stand-off falls inside `CameraSystem`'s near plane and clips the eyepiece open,
silently.

→ **[`docs/weapons.md`](docs/weapons.md)** — the report's five layers, the crouch
latch, the gloss ladder, the viewmodel's rendering group and pose stack, the
reload (its beats, dry against tactical, the two magazines, the action each
weapon closes, why impacts ring in seconds and the wrist turns), the kick
spring, the recoil pattern's envelope and sweep, the bolt cycle's two
expressions and why neither may move the sight, the fire selector (the four
facts a position is, why only the carbine's `semi` states a rate), the two
slots, the head zone, eye relief and the near plane, and the procedural-model
rules.
### Grenades

Everyone carries two and there is no resupply, so the pouch is refilled by death
and nothing else. **It is one of the two things in the game that are not
hitscan** — the anti-tank rocket is the other: one collision ray per grenade per
frame, a pool that **refuses rather than stealing a live slot**, and a blast
resolved against the **thrower's** target list fetched at detonation, so friendly
fire is excluded by construction as in `CombatSystem.fire`.

**The pouch holds a FRAG or a MOLOTOV, never both** (`entities/throwables.ts`, a
kit row on every map, riding the join and the deploy like the weapon). **A
molotov is the same pool, the same arc and the same ray** — thrown on the frag's
`throwSpeed`/`throwLift`/`gravity`, which the bots' measured band depends on —
and it BREAKS on first contact into a FIRE: a second pool in `GrenadeSystem`
that burns the thrower's target list on a tick, skips hulls, and is drawn (by
`GrenadeFx`) in the world's one `FlameMaterial`. Three rules reach outside it.
**A burn is `DamageKind` `"fire"`, which DROPS a body** — `RagdollSystem`'s test
is "not a bullet or a burn". **A fire's held-open sound is keyed NEGATIVE**
(`Game.fireSoundKey`), because `AmbienceSystem` spends 0 and up and an emitter's
index is its identity. **In a match the burn is the authority's**: it arrives as
a `blaze` event (`fire` is a gunshot on this wire) and a client draws it through
`drawFire`, with `GrenadeSystem.predicted` stopping the thrower's own local
bottle lighting a second one.

**There is ONE blast in the game and one set of numbers describing it.**
`blastAt` takes a `power` — the grenade is 1, the reference, and the tank shell
`blastPower` of the same eight layers — and **`power` scales SIZE and COUNT,
never TIME**. **What a blast throws is keyed on what it went off ON** (the same
`metadata.surface` a bullet's impact reads), and `drawBlast` is the one place a
blast is DRAWN (it raises `onBlast`, the only event the picture starts on).
**The drawn layers are opaque, lit billows** (`systems/BlastFx.ts`), one draw
call per blast, never built on the authority.
**Both flying things are a SIMULATION and a PICTURE**: `GrenadeSystem` and
`AntiTankSystem` hold their positions as plain `src/math` fields and import no
Babylon, and `GrenadeFx`/`AntiTankFx` read their pools after each `update` and
never write them (`docs/grenades.md`).

→ **[`docs/grenades.md`](docs/grenades.md)** — the bounce, resting and terrain
backstop rules, the eight layers and the four rules holding them together, the
billow (its heat, why it is lit, why its silhouette decides cloud or boulder,
the dissolve, one mesh per blast), the throw timeline, the bots' range band, and the molotov — the break,
the floor under it, the fire pool, the burn and the bots' reflex out of it.

### The interface is five screens and the chrome

`src/ui/` holds one class per thing on screen, and `HUD` is not where a new one
goes — it owns **only** the gameplay chrome. Each screen builds its own root and
appends it to `#hud`, so construction order matters exactly once: `HUD` writes
`#hud.innerHTML` and is built first. **A class on `#hud` belongs to whoever
raises it.** **One stylesheet per module that writes markup, imported by that
module**, and `index.html` gets no interface CSS beyond the black background and
the boot screen — which stands in the menu's frame by COPYING its unit, gutters
and title clamp (nothing has loaded when it paints), so a change to those owes
that copy a look. **A phone gets a sixth thing on `#hud`, and it is a DEVICE
rather than a screen**: `TouchControls` is polled by `InputManager` once a frame
exactly as a gamepad is, so nothing in gameplay has heard of it.

**Every screen is a LIST, and a list whose rows can change under the cursor keeps
its place by IDENTITY rather than by index** (the lobby is the one that can), and
**the way OUT is a fixed place, never a row in its own list** — the system
CORNER, top right; the pause alone comes back by its FIRST plate, Resume. Every
one of them is a TITLE SCREEN laid out as the menu is, **sized off one unit over
`vmin`, and nothing is scaled to a short viewport** — a screen fits a phone by
its floors. **A screen over another SCREEN is opaque and a screen over the SCENE
is not**, and **the PAUSE is the one card that does not take the screen**. **A
ROW OF PICKS IS A GRID OF EQUAL SHARES, NEVER A WRAPPING FLEX ROW.**

**The KIT screen's middle is a hole the real viewmodel is drawn through, and the
DOM MEASURES while the scene follows**: `LoadoutScreen.stageBay` measures that
hole every frame and `ViewModel` fits the weapon to what it is told. **Anything
else that wants to place a 3D object against the interface owes the same shape**
— and its converse: **nothing sharing the bay's column may change height as the
cursor moves**, or the weapon rescales under the player. The DEPLOY screen,
being a STATE rather than a lid, takes only the HUD's gameplay chrome off
(`#hud.deploying`), because it draws the tickets and the flags itself; a new
gauge that must be read between lives owes that list a look. **A front-end lid
raised over other SCREENS takes them off the glass** (`#hud.kitting`,
`#hud.setting`, `#hud.lobbying` — `visibility`, so they return unredrawn) and
is laid over the SCENE, so a new child of `#hud` that must survive one is carved
out of every such rule by name, as `#hud-fps` is.

**The MENU is the first title screen, and the one the others copy**: the chosen
map's PHOTOGRAPH is the screen (`#menu-shot`), and **the lobby DRIVES that
photograph** (`MenuBackdrop`) rather than keeping a copy, so `#menu-shot` must
stay a root of its OWN that a card rewrite leaves standing. **The BUILDING card
stands in the menu's frame over the map being built, and what may be on it is
decided by the freeze under it**: it gets the two frames `startRound` waits, so
nothing needing a later one (a canvas, a fetch, an undecoded photograph) may be
part of what it says, and only what the compositor animates alone moves through
the build.

**THERE ARE THREE MAPS OF THE SAME PLACE HERE AND THEY ARE ONE DRAWING** — the
menu's intel plate, the deploy screen and the corner minimap. `ui/mapPlan.ts` is
WHAT is drawn (the floor, the water, the carriageways, the masses, and **nothing
about a round**) and `ui/mapPaint.ts` is what it looks like; a screen supplies a
projection and its own overlay, and **a fourth surface is a projection and a
call, never a fourth dialect** (`planFromWorld`, `planFromLayout`, the menu
fetching the collider bake). **COLOUR MEANS OWNERSHIP**: only the flags, the
bodies and the cursor are saturated. **A flag is the same HEXAGON on all three
and on the HUD's own strip.**

**The CHROME is sized by a UNIT, never by a transform**: every size in `hud.css`
and `minimap.css` is a multiple of a ladder in `base.css` (`--hud-u`, three
bands of type, `--hud-map`), `clamp()`ed over `vmin`. **A new size is a
multiple, never a bare pixel**; **an INSTRUMENT is exempt**, and the test is
whether its size is a claim about the SCREEN (the gun marker is where the barrel
points, the hitmarker is drawn at the point of aim).

→ **[`docs/ui.md`](docs/ui.md)** — the front end and the shell it replaced, why
a row of picks is a grid, each screen's layout (the menu's reel, prompts and
`mapShots.ts`, the kit's MEASURED bay, the settings, the lobby's row identity,
the deploy map, the round-over ballot, the pause), why **the pointer deploys
only through the Deploy button**, the three maps as one drawing (the mass
layer's three failed readings, the scale gates, the prerender), the gauges'
four ladders and the touch TRIM, the minimap's backing store, the portrait
fallback, and the touch controls — with [`docs/pwa.md`](docs/pwa.md) for them
as a phone.
### The scene has (almost) no Babylon lights

**Every shader in the tree is hand-written WGSL** (`shaderLanguage` is
load-bearing; the default is GLSL), and **a sampler a material DECLARES must be
BOUND, used or not**, or the draw is silently lost. **A shared body declares
NOTHING** (`wgsl/chunks.ts`): `src/render/` includes it too, so both sides
declare.

**Every cel material is FROZEN, and `CelMaterialFactory.remember` is the one
door into the cache.** **What breaks it is a mesh that GAINS or LOSES a vertex
COLOUR buffer, bones or morph targets after its first draw** — it keeps the
effect it compiled first, silently, unless given `resetDrawCache()`.

Cel materials carry their own light as uniforms — key, ambient, sky fill and up
to `MAX_POINT_LIGHTS` (16) point lights — and `LightingSystem` is the sole owner
of dynamic light. **Adding a `PointLight` or `HemisphericLight` to the scene
will not affect any cel-shaded mesh**.

**The indirect light is TRACED in compute against the COLLIDERS**
(`systems/GiVolume.ts`): **a light whose brightness changes faster than a sweep
is registered `fast`**, or its bounce freezes into the probes, and
**`GameMap.colliderAlbedo` stays parallel to `colliderBoxes`**.

**THERE ARE TWO SHADOW MAPS, AND WHICH CASTERS GO IN WHICH IS DECIDED BY REFRESH
RATE RATHER THAN BY WHAT THEY ARE.** The world's re-renders only when its
texel-snapped focus MOVES, so **nothing that ANIMATES may be registered with
`shadows.setCasters`**. Soldiers and hulls have a map of their own
(`systems/BodyShadows.ts`): **a rig's shape is `RAGDOLL_BONES` and a hull's is
its collider box**, so moving either moves a shadow, and **the local player
casts nothing**. **The world's map is two CASCADES of one caster set and
records BACK faces**, so **every caster must be a CLOSED shape**. **The world's
four maps (both cascades, the foliage's and the lightning's) are OUR renderer's
in every round, on every rung** (`render/WorldShadows.ts`), `ShadowSystem`'s
generators only an editor build's, so **a new world caster must be one the
handover can hold (block-merged, at identity, never `updatable`) or the map is
REFUSED** — BLENDED OR NOT, since the lamps' atlas casts every surface not
`noShadowCaster`.

**THE LAMPS CAST INTO ONE ATLAS** (`systems/LocalShadows.ts`), **a light casts
by what it SAYS** (`PointLightData.shadow`), and the bumped ground variant is at
**16 of WebGPU's 16 sampled textures per stage** — a new texture owes a PACKING.

**Nothing drawn outside the cel shader gets fog for free, and everything that
draws outside it owes the same fade** `CelMaterialFactory.setEnvironment`
publishes — nothing may describe different weather from the wall in front of it.

**The world carries a VERTEX COLOUR buffer and its neutral values are the GL
defaults** — baked occlusion in the **alpha**, a world marker in the **green**,
the wind's sway weight in the **red** and the wear ramp in the **blue**. **All
four are spoken for**: a fifth per-vertex quantity owes a second buffer. The
bake (`world/vertexShading.ts`) runs **after every merge, before the upload**.

**A map's GRIME is the MAP's and its ramp is not** (`EnvironmentSpec.wear`
against `CONFIG.wear`); absent is CLEAN. **It is only on the OUTSIDE, and the
BAKE decides that** — a vertex steps `wear.shelterProbe` along its NORMAL and is
clean under a collider — so **a structure that overhangs further than a jettied
townhouse owes that step a look**.

**There is ONE wind and everything that leans in it leans the same way**
(`CONFIG.wind`). **Anything a collider stands in for may never sway.** **A sway
layer is RAMPED or RIGGED**: a ramp is the red channel's height weight, and a
rigged layer (a palm's `frond`, an ash's `bough`) writes each vertex's place on
its frond or bough into `uv` BEFORE the merge and is told apart by a NEGATIVE
red — so every cel material binds `uv`, and a mesh marked with a rigged layer
owes one on every vertex.

**The frame's ALPHA CHANNEL is TRANSLUCENT COVERAGE, and every shader in the
tree owes it.** Everything opaque writes **0** (`CelShader`'s `opaqueAlpha`, a
literal 0 in the grass and the water, the clear in `applyEnvironment`), every
alpha-blended draw accumulates into it (`ALPHA_COMBINE`), and `CelInk` scales
its edge by `1 - a`. **A REFLECTION PROBE inverts it** (`opaqueAlpha` is 1 for a
bake), so **a shader that hardcodes either value breaks a pass silently** — the
EMISSIVE palette's **1** is deliberate: do not "fix" it onto `opaqueAlpha`.
**The sky's CLOUDS write the depth of a point 7 km out**, so every surface must
be nearer. **Nothing on the floor writing NO depth is OPAQUE**.

**The world is OPAQUE with exactly one exception, and it is glazing.** Glass you
can see THROUGH is `getGlass` over a cube `ReflectionSystem` bakes **one per
GLAZED BLOCK** — by OUR renderer (`render/ProbeBake.ts`), the only bake. Glass you
cannot is `Build.pane({ backed })`, which writes DEPTH — so **`backed` is a
claim about the WORLD that nothing throws over**. **No pane of either kind is a
shadow caster**, and see-through glazing gets no ink.

**THE WORLD DRAWS WHOLE OR THE ROUND DOES NOT START.** Every BLOCK, the
LANDFORM (the BUILD marks `WorldSurface.landform`) and the emissive PALETTE are
OUR renderer's in every pass and **Babylon is made NO MESH of them**
(`BlockHandover`, `worldMeshes`) — only of the glazing and the fires — so a
surface ours cannot hold is REFUSED (a DEV throw `merge:hash` fails on), and a
pass of ours that cannot draw its world tells the failure it was HANDED WITH
it: **`Game.worldFailed`**, the menu and a toast, never a fallback.
**The frame WALKS the scene, and the scene is the map.** `WorldCulling`
**replaces `scene.getActiveMeshCandidates` and writes nothing onto any mesh**:
it never disables, never hides, never unpickles. **A collider is never a
candidate**, and a CELL is grown from the RECORDS (`GameMap.world`, whole).
**The SCATTER is drawn ONCE**, as INSTANCES of its variants, its colour baked
once per kind, its pieces cut out of the block arrays it stays merged into
(`BuildOptions.onScatter`). **A mesh carrying `metadata.block` (the
glazing, a fire) is one only while the camera is inside the map's `fogEnd`**,
**a body's RIG only while the root the roster switches is enabled**, and
**everything else is ELIGIBLE**. **Anything EMISSIVE and anything outside
rendering group 0 are exempt outright.** **Nothing pooled may ever be
block-keyed**, and the rigs are **filed mesh by mesh, never by ancestry**
(`RagdollSystem` reparents a corpse's joints).

**The GLOW draws the EMISSIVE meshes and nothing else, its occlusion being the
FRAME's own depth buffer** (`src/shaders/GlowPass.ts`). **What may bloom is read
per mesh every frame** — an emissive colour, no `metadata.noGlow`, and `Game`'s
`GlowRules` — so nothing excludes a mesh by hand. **A map's merged emissives are
a PALETTE like its albedo** (`shaders/EmissiveWorld.ts`): their colour is a slot
in `uv2.x` under a WHITE `emissiveColor`, so **a new reader asking a material
what it emits must ask the vertex for that one**. **The palette has NO Babylon
draw** (ours in every pass; the mask itself `GlowPass`'s), **`noGlow` is read
PER SURFACE at the take**, and **a palette surface ours cannot hold is REFUSED**.

**OUR renderer (`src/render/`) draws INSIDE Babylon's frame through ONE seam**
(`render/babylonSeam.ts`, the only file there that names Babylon, and only as
types). The frame's uniforms are PULLED off the factory's fields
(`CelMaterialFactory.fillFrame`), so **a new value every cel material holds owes
`render/frame.ts` a field and `fillFrame` a line**, or our draws shade without
it — a shared TEXTURE the same, in `FRAME_TEXTURES` and `fillFrameTextures`. **A
material's OWN value is set through the factory's `own`**, which keeps it in the
recipe our renderer draws that material with (`render/celMaterial.ts`); a
`setFloat` beside it is a value Babylon's draw has and ours does not.

→ **[`docs/rendering.md`](docs/rendering.md)** — the frozen define set, the
irradiance volume (why not Lumen, why the blend is 1), the four light terms and
the three `DirectionalLight`s, the colour buffer and the map's grime, the shadow
window, back faces and the foliage's third map, the bodies' map, the rungs, the
lamps' atlas, lightning, the ink's NIB and its coverage channel's two blended
exceptions, the wind's rigs, the fire, the glazing and reflection bake, the
grass and turf, the water, the WGSL traps, our renderer's frame and its seam,
the candidate list and size gate, the glow's three failed attempts and the
palette, ours, and the sky and its clouds' depths.
### The map is data, not code

`src/world/hollowmere/layout.ts` is the entire level — placements, scatter
regions, control points, spawns, the water and grass rects — and `MapBuilder`
special-cases nothing, so **a second map is one new layout file plus an
`EnvironmentSpec`**. Every figure on the menu's map panel is read off the layout
and the environment, so nothing countable is stated twice. The two halves are
paired in `src/world/maps.ts`, which with `vite.config.ts`'s `WRITABLE` table and
`scripts/collision-hash.mjs`'s `MAPS` are the only existing files a new map
touches, and **nothing outside `maps.ts` may import a map's own modules**. A
`MapDef` must be a **module constant**, `Game.mapDef` may only be written from
`menu`, and **scatter placement is seeded — never call `Math.random()` in
world-building code**, or the nav graph differs between page loads.

**Two of a map's four halves are LAZY imports and neither is on the layout** —
`MapDef.collision`, which only the server reads, and `MapDef.heights`, the
FLOOR, which grows with the square of the map. **There is no
`MapLayout.terrain`**: everything that needs the ground is HANDED it —
`MapBuilder.build` takes it as an argument, `Game.floor` holds the standing
map's (`installMap` cannot contain a fetch), `loadSimWorld` awaits it, and the
editor writes through `map.terrain.field`, which is that same object. `size *
cell` must still equal the map's extent and nothing typed can see the pair any
more, so `build` asserts it in a DEV build.

**Eight things that read like global constants are the MAP's**, each defaulting
so that a map saying nothing is unaffected:

| the map's | default | what a map that raises it owes |
| --- | --- | --- |
| `MapLayout.size` — how big it is | `CONFIG.map.size`, 240 | its heightfield's `size * cell` must equal it (asserted in DEV), and the rim's boundary boxes must stay over 200 m so the seven sites keying on `w > 200 \|\| d > 200` still can |
| `EnvironmentSpec.fogEnd` — how far you can see | `FOG_WALL` | it is the reach `WorldCulling` walks to and the default for the row below; `audio.maxDistance` (70) and `bots.perception.engageRange` (55) did **not** move with it, so a clear map must be laid out knowing that |
| `EnvironmentSpec.bodyDrawDistance` — how far a BODY is worth drawing | its own `fogEnd` | resolved ONCE (`bodyDrawDistanceOf`, clamped to `fogEnd`) and pushed to `NetRoster` and `RagdollSystem` together (`setViewDistance`), which is what keeps where a body stops being drawn and where a corpse is refused one distance; a body it drops POPS. **A map's `fogEnd` is a distance from the EYE and a LANDMARK is a fixed thing in the world**: never shorten the fog for the cull budget — take the saving out of this row |
| `MapLayout.surfaces` — how deep it stacks | `CONFIG.nav.maxSurfaces`, 3 | only a map that stacks FLOORS raises it; overflow drops candidates silently (see the bots section) |
| `MapLayout.perTeam` — how many bodies a side | `CONFIG.bots.perTeam`, 8 | it is DENSITY, bounded by `CONFIG.bots.maxPerTeam` (24), and it is spent in RIGS — the core's `BattleSystem.setRoster` resizes the pool and the page's `NetRoster` rebuilds its rigs when it moves (`setFielded`). The squads and the scoreboard follow it; `CONFIG.conquest.tickets` deliberately does not, so a denser map is a shorter round. **It reaches a match too**: the authority's slot table is the ceiling, `setFielded` says how many a round fights, and the SEATS stay at sixteen |
| `MapLayout.blockSize` — how big a merge block is | `BLOCK_SIZE`, 48 | it is DRAW CALLS and cull granularity and nothing else; the reflection bake's exclusion and `WorldCulling` follow it for free because they read the block KEY rather than a size, and the world layer's unit of LOCALITY (the physics buckets, the pane index) deliberately does **not** |
| `MapLayout.terrainBlock` — how big a floor patch is | `BLOCK_SIZE`, 48, **independently of `blockSize`** | a whole number of terrain cells, and the same value in both callers of `terrainPatches` — `buildValley` and the editor's brush — or a stroke re-cuts patches the floor was never cut into |
| `EnvironmentSpec.lighting.shadowWindow` — how far its shadows reach | `CONFIG.graphics.shadows.frustumSize`, 110 | shadow length is `h / tan(elevation)`, and `shadowVisibility` is FULLY LIT outside the window, the last `edgeFade` of the volume ramping back to it — so an undersized one puts that transition on ground the player can see, and an OVERSIZED one moves it not at all while costing texel density (`ShadowSystem` DEV-warns) |

**A map is CLOSED one of two ways, and NO map takes the first one any more** —
four boxes at `±size/2` with `Ridge`'s escarpment over them, still what a
layout stating nothing gets. `MapLayout.borderland` is the other: the floor
carries on for a `margin` past the play square (`TerrainField` continues the
field, so nav, the roads, the grass and **`server/validate.ts`** agree for free)
and what stops you leaving is `src/world/leash.ts`, a countdown rather than a
shape. **The LEASH is the FLOOR under that margin and the EYE is what spends
it.** It kills on the AUTHORITY and only draws on a client, and **bots are never
leashed**, the nav graph stopping at the play square. **What a boundary is
closed BY and what it is closed WITH are two questions, and the answer may
differ PER BEARING**: `RidgeSpec.form` takes `none` for a map that has laid
something out there already — an ISLAND stating its horizon in water, or a
`borderland` bought past the map's own `fogEnd` — and `RidgeSpec.mouth` is that
same claim scoped to an ARC. **What either owes is that reach from EVERYWHERE a
player can be**, and the fog is LINEAR: a margin short of it draws an edge
rather than softening one.

**The shipped maps are Hollowmere, Greyfen, Coldharbour, Harrowmead, Sarab,
Cinderhaven and Kurenai.** **Coldharbour, Harrowmead, Sarab and Cinderhaven are
the four with vehicles on them**; **Sarab and Cinderhaven are the two with all
THREE KINDS and the two that are not 8v8** — 24 a side, online and off. **Every
shipped map is SEEDED by a generator** (the commands above), which CHECKS that
every front door opens onto a street, a yard or the green, and emits an ordinary
`layout.ts` the editor patches. **Cinderhaven's rules are general rather than
details of that map** (`docs/world.md`); the one that reaches outside the world
layer is that **there is no swimming in this game**, so water anybody must cross
is walkable and everything else is made steep enough to sever.

**A ROAD is visual-only and rejects exactly one thing, which is anything that
GROWS** (`world/roads.ts`, `GameMap.roads`): `MapBuilder` sows no
`PropBody.rooted` prop on a carriageway and the grass mask no blade. **Any
change to a placement rule re-rolls the seeded dressing field**, so it owes `npm
run collision` and `npm run parity` — the staleness guard hashes the LAYOUT and
this kind of change is in the BUILDER. **A road's tile may not equal a FLOOR
pattern's** — every ground texture in the tree is sampled at `vPosW.xz` — so a
new `floorSurface` picks its `metersPerTile` against `ROAD_PATTERNS` as well as
against the other floors. **Where two roads CROSS, the SURFACE decides which one
is the ground, and it decides by HEIGHT** (`ROAD_RANK`): do not give two
surfaces one rank. **That ladder cannot settle the FLOOR**: `ROAD_DEPTH_UNITS`
is a polygon offset carried by the BUILDER (`Build`'s `depthUnits`) and **part
of the material CACHE KEY** — one hex at two biases is two materials, or a car's
underbody rides off the ground.

**A road may be a PATH (`params.path`), and then the NETWORK decides where it
stops** (`world/roadPaths.ts`) — a layout never states a junction. **A map
GENERATOR imports `bendPath` from `roadPaths.ts` rather than copying it** — Node
loads that file and `roads.ts` by type stripping, so a value import in either
names its `.ts` and neither may hold syntax that must be compiled rather than
erased.

**There is an eighth entry in `MAPS` and it is DEV-ONLY and not a level**
(`src/world/proving/`). **`MAPS` is an `import.meta.env.DEV` ternary and must
stay one**: that fold is the only thing keeping 900 kB of it out of both
bundles, and a `push`, a `filter` or a `const dev = import.meta.env.DEV` one
line up would silently stop working.

→ **[`docs/world.md`](docs/world.md)** — the shipped maps one by one, the eight
overrides in full, the heightfield and the road slabs cut against it, the
winding trap that makes a floor vanish, the builder and two-pass merge rules,
the harbour kit and the island's floor (Cinderhaven's general rules: the floor
as the level, the derived waterfront, the water rects' probe and seams, the
foreshore, the landmark, the measured road network), the roads (the rank ladder
and the depth bias with their arithmetic, the kerb, the path network), the
layout gotchas that have already cost time, the valley rim's contract with the
sky, the borderland, the three rim forms, the mouth and the leash, the margin
that IS the landform, and the proving ground's bake and build sentinel.

### The map editor (dev only)

`F2` in a dev build opens `src/editor/`: free-fly the real scene, click to
select, drag gizmos, edit properties, sculpt terrain, lay a path road point by
point. It is reached through **one
dynamic `import()` inside an `import.meta.env.DEV` branch** in
`Game.toggleEditor` — the *whole method body* is behind that gate, which is what
makes the chunk unreachable under `vite build`. **Never import `src/editor/`
statically.** Saving **patches `layout.ts`'s text and does not regenerate it**:
an untouched entry is re-emitted byte for byte. There is no undo.

→ **[`docs/editor.md`](docs/editor.md)** — the two pointer modes and the terrain
brush, the three rebuild tiers, `SelectionRef` and the three files that must
agree on a field key, the source-scan properties a save rests on, and
`environment.ts` patching.

### Visual meshes and collider proxies are separate things

The single most load-bearing rule in the world layer. Every ray test —
`CombatSystem`'s hitscan (every shot), `BattleSystem`'s LOS, the grenade's step
ray, the death cam's pull-in — and every body's sweep is answered off the
COLLIDERS, and the editor's pick filters on `metadata.solid === true`. At
village scale, visual geometry must stay out of all of it.

**The ground under a body's feet is the one question no longer asked with a
ray**: `Player.probeGround` reads the `WorldBox` list through
`ObstacleField.groundAt`, and **a BOT's feet read the same answer**
(`BattleCtx.groundHeight`, `docs/bots.md`). So a collider that skips
`collider()` is invisible to the FLOOR as well as to navigation, and anything
SOLID that MOVES owes the probe a query of its own, because the boxes are baked
once at map load — `Vehicle.deckAt`, and only that.

**That probe is a POINT and a body is not, so a body can come to REST inside a
collider — and no sweep gets it out again** (`docs/world.md`). **Every body
therefore owes a push-out, and there is one primitive for it** —
`ObstacleField.resolve`, keeping a bot out of a tree, a hull out of a shopfront
(`Vehicle.freeFromWalls`) and a player out of a railing
(`Player.freeFromProps`), each at its OWN radius and band, a body's being the
sweep's own so the push never asks for room the sweep does not hold it out to.
`server/validate.ts` runs the same query and calls a position deeper than
`nav.bodyRadius` a noclip.

| Kind         | visible | pickable | collides | `solid` | merged | frozen |
| ------------ | ------- | -------- | -------- | ------- | ------ | ------ |
| **Visual**   | yes     | **no**   | **no**   | —       | yes    | yes    |
| **Collider** | **no**  | yes      | yes      | yes     | no     | yes    |

Colliders must line up with the surfaces they stand in for or bullet sparks land
off the visible geometry. `MapBuilder.collider()` is the only place that creates
them, and it also records a `WorldBox` for the nav grid — geometry added by any
other path is invisible to navigation.

**A collider answers two questions and they can disagree.** *Where may a body
be?* is `RayWorld.castBody` — the death cam's pull-in, a tank's chase camera,
the dismount's floor test — and `SOLID_ONLY`, the mesh predicate the same
question still wears for the editor's centre-screen pick. *What stops a round or
a look?* is `RayWorld.castRound` and its any-hit twin `blocked` — the hitscan
and its wall cap, the bots' and the aim assist's LOS, the grenade's step ray and
its blast check, the rocket. A builder picks which by how it declares the box:

| collider | body | round | in the nav/cover/AO boxes |
| --- | --- | --- | --- |
| ordinary — `wall`, `block` | yes | yes | yes |
| `porous` — a fence's coarse run | yes | **no** | yes |
| `rayOnly` — a fence's posts and rails (`strut`) | **no** | yes | **no** |
| `glass` — a breakable pane, intact | yes | **no** | nav only |
| `glass` — the same pane, broken | **no** | **no** | **no** |

**`porous` and `rayOnly` exist as a pair and describe one object between them**:
the coarse box is the fence a body walks into and the nav graph severs across,
and the struts are the timber a round stops on. A porous box is **not cover**
(`CoverMap` skips it, or bots hide behind something that stops nothing), and a
strut is invisible to navigation on purpose — a 0.1 m rail is a shape `NavGrid`
can only get wrong.

**`glass` is the one thing in the world that CHANGES, and it needs no new term
to do it.** A breakable pane is `porous` exactly, so both questions already get
intact glass right, and breaking it is one write on each side —
`RayWorld.remove` for the queries, `metadata.solid = false` for the editor's
predicate. `WorldBox.glass` exists only for the readers that must SKIP a pane
rather than merely pass a round through it: `CoverMap`, the AO bake, and the
collision bake.

**NO RAY IN THE GAME PICKS A MESH ANY MORE, and that is the load-bearing part
rather than an optimisation** (`RayWorld.ts`'s header). All eight sites are
answered analytically, by [`src/world/RayWorld.ts`](src/world/RayWorld.ts), off
`colliderBoxes`, the strut groups and `TerrainField` — the same geometry the
colliders were built from. **`map.rays` is where a system gets it**, beside
`nav`, `cover` and `obstacles`, and the authority builds one off the bake. A NEW
RAY GOES THERE; nothing may reach for the scene.

**…and NO SWEEP WALKS A MESH EITHER** (`CollisionField.ts`'s header). **There
are exactly THREE sweeps and all of them go through `CollisionField`**
(`moveBody`, `map.collidables`) — `Player.update`, `Vehicle.update` and
`Vehicle.coast` (a wreck), on both sides — Babylon's ellipsoid collider ported
(`world/ellipsoidSweep.ts`) and fed **`RayWorld.bodyNear`'s candidates**. So
whatever changes what blocks a body changes it THERE: a hull through
`rays.hulls`, a broken pane through `RayWorld.remove`. **The list is CHECKED
against the path the centre took**, and re-gathered when the sweep outran it.
**Ties go in the CLIENT's collider-mesh order, which both sides derive from
`boxGroups`** — so that grouping is load-bearing for MOVEMENT, on both sides.
**A FOURTH sweep goes through `CollisionField` too.**

**Colliders are still MERGED, and the grouping is DATA**: `rayGroups` is how
the struts reach the queries (`MapBuilder.struts`, one mesh per placement), the
blocking scatter is merged by LOCALITY (`MapBuilder.clusterColliders`), the
boxes stay in `colliderBoxes` one per prop, **only plain `solid` boxes may be
grouped**, and the grouping rides to the server as `MapCollision.boxGroups`.

**A blocking scatter prop may not stand on a control point or a spawn**, and
`MapBuilder.keepClear` refuses it rather than the layout dodging by hand — a
flag inside a collider cannot be captured and sinks its own flow field.
Non-blocking props are exempt: a fern over a capture point is dressing.

**The floor is the one documented exception**, and it proves the rule rather than
bending it: the heightfield has no box that could stand in for it, so each block's
collider is an invisible *clone of the visual's vertex data* — same shape, two
separate meshes, only the clone marked `solid`. It emits no `WorldBox` and
`NavGrid` reads `TerrainField` directly. It is also in no sweep (a sweep reads
`WorldBox`es): every sweep asks a horizontal step, vertical placement is the ground
probe's job, and bots never sweep.
### Mesh metadata is a contract

Seven flags and two values, all read elsewhere; new geometry that omits them
misbehaves silently. **On the world's drawn geometry they are written on the
RECORD, not the mesh** — the surface's part (`WorldSurface.part.metadata`,
`world/worldGeometry.ts`) — and the one adapter (`worldMeshes`) hands that same
object, unchanged, to a mesh WHERE IT MAKES ONE: since X3.7b only for what
Babylon draws (the glazing, the fires, an editor build's every surface), our
renderer reading the record. `GameMap.world` keeps it for every surface:

- `solid: true` — collider proxies only. Unmarked geometry is shot through, seen
  through, and walked through.
- `porous: true` — a `solid` collider that rounds, sightlines and grenades pass
  through anyway (`castRound` subtracts it; `castBody` keeps it). Declared as
  `BoxSpec.porous` by the builder, carried on the `WorldBox` — which is what the
  queries read — and into the collision bake, and skipped by `CoverMap`. Today
  it is the fence's coarse run, and only that.
- `rayOnly: true` — the mirror: a `solid` collider that stops a round and a look
  but is no body at all (`castBody` subtracts it, `castRound` keeps it), and the
  one collider that emits **no `WorldBox`** — invisible to the nav grid, the
  cover bake, the obstacle field, the AO bake and scatter placement. It reaches
  the queries as `GameMap.rayGroups` instead, which is why that list is on the
  map rather than only in the bake. Declared by `Build.strut`, merged per
  placement, baked in groups. Today it is fence posts and rails.
- `noInk: true` — **records INTENT, and nothing reads it to decide ink.** It
  says "this was never meant to carry line work", it is the list a future
  per-mesh ink would be built from, and today its only consumer is
  `mergeByMaterial`'s exemption key (measured cost of keeping it there: **≤1
  draw call on Coldharbour, 0 on Harrowmead and Hollowmere** — an exempt mesh
  almost always differs by material anyway). **What HONOURS it is three
  mechanisms, none of which is the flag**, and that is the thing to know before
  adding a fourth: an emissive part is masked out by the glow's mask (`GlowPass.mask`,
  `ink.emissiveMask`), a viewmodel part is scaled down by the near-depth band
  (`ink.near`), and a coplanar decal — a road dash, a blob shadow, the capture
  ring — produces no depth step and no bend, so the pass never finds it. The sky
  writes no depth at all. It was called `noOutline` while an inverted hull read
  it; **it is deliberately absent now from grass, water and both debris pools**,
  which the ink does draw on purpose.
- `noGlow: true` — out of the bloom. `GlowPass` reads it per mesh every frame,
  so a mesh built at any time needs only the flag — but the emissive PALETTE,
  which has no mesh, reads it at the TAKE, PER SURFACE (`BlockHandover`), so
  it must be on the part when the build hands it over: it keeps that surface
  out of the mask alone. A mesh that stays in bloom is faded with distance instead
  (`GlowRules.colour` in `Game`), and `infiniteDistance` is that fade's one
  exemption — it is what every sky mesh sets, and the moon is not in the
  valley to be fogged out of.
- `noShadowCaster: true` — excluded from `ShadowSystem.setCasters()`. Flat receivers
  (ground, roads) need it: casting from them is pure shadow acne.
- `block: "3,2"` — which map block a merged visual came from (the block's side
  is `MapLayout.blockSize`, 48 m by default). A **value**,
  like `surface`, and **absent on everything that is not block-merged — the
  terrain, the roads and the rim**, which is what keeps the landform out of
  both tests that read it. Written in three places and they must agree:
  `BlockMerge.finish` and `PaneBlocks.finish` for the glazing hung on the same
  building. **Two readers.** A probe's bake drops its own building — there
  being no geometry-shaped way to ask which building a surface IS since the
  albedo palette left the merge key — asked as NUMBERS (`exclusionOf`, off
  `WorldSurface.block`, and for a scatter instance the REGION its copy was
  merged under, `ScatterSet.blocks`), so those keep the merge's lattice. And
  `WorldCulling`, which grows a cull cell from every RECORD carrying one and
  files Babylon's meshes carrying one into it.
- `surface: "ground"` — what a round that stops here kicks up. The odd one out:
  it is a **value with a default**, not a flag, and **absent means `"hard"`**.
  `MapBuilder` sets it on exactly one thing — the terrain floor's collider clone
  — so every wall, prop and roof in the village answers by omission and a new
  collider needs no thought at all. Read by `CombatSystem` to name the impact,
  which `CombatFx` turns into its spark, its dust disc and its sound. Adding
  `"wood"`/`"metal"` is one member of `ImpactKind`, one row in `CombatFx`'s
  `IMPACTS` table, one arm in `Sfx.impact` and a `surface` argument on
  `collider()`; no signature in between moves.

### Bots: navigation, scaling, perception and squads

**How many bots there ARE is the MAP's on both sides** (`MapLayout.perTeam`, 8
on the five smaller maps, 24 on Sarab and Cinderhaven), stated as
`RoundSpec.pool` and `fielded`: an OWNED match's pool IS that roster, and a
SERVER's is the ceiling (`CONFIG.bots.maxPerTeam` a side), built once, with
`setFielded` taking the surplus out of each round — the third reason a bot can
be `aside`. **The RIGS are the session's**, so "built once and never disposed"
holds inside a round: the page's own match is a fresh session every round, and
a server's rebuilds its pool (`NetRoster.setFielded`, from `buildRound`, never
`installMap`) only when the count or the viewer's side moves. **Nothing else in
this layer may know a size**: the squads, the radio's boards, the squad orders
and the skill draw are all grown from the pool they are handed, and the think
budget from the number of bodies actually in the round.

`NavGrid` is built from the finished collider set at map load, and its node is a
**surface** — a (cell, height) pair — not a cell. The cap is
`CONFIG.nav.maxSurfaces` (3) unless the map raises it, and overflow **fails
silently: the candidate that does not fit is DROPPED, in arrival order**, which
makes a BUILDER's collider order part of the design — walked surfaces first,
cover next, roofs last. **A surface ID is `cellBase[cell]` plus the slot, never
`cell * maxSurfaces + slot`**, or the graph's own arrays are addressed wrong in
silence. One flow field per objective is precomputed and nothing is
recomputed: **bots read `nav.steer()`, never run their own pathfinding, and
never sweep**. `ObstacleField` is the sub-cell half, and its
push-out is a preference, never a veto.

**`Bot` and `BattleSystem` are the SIMULATION and draw nothing** (`src/math`, no
Babylon, no camera), **and no view names one**: every body a page draws is a
`NetSoldier` on its session's `NetRoster`, one per slot the round fields, posed
off the wire and never writing back — so the distance LOD and a ragdoll holding
a corpse are the view's, and nothing about the camera reaches an outcome. **Three things carry the frame budget and undoing any costs ~10x draw
calls or a permanent hitch**: the rig pool is built once per roster size and
never disposed inside a round, a rig is fourteen merged meshes (one per JOINT,
the albedo in `uv2.x`) and two materials, and AI is staggered round-robin at
`CONFIG.bots.thinkRate`. **Everything a bot notices without seeing it is
ray-free by construction** — cover is baked, never probed, and skill is one
scalar drawn **per squad** from a seeded generator.

**Cover is baked as three nested masks and a query answers with a KIND**, each
height being a hit SPHERE's top and never an eye height. **A bot's crouch is one
decision re-made every frame and one eased blend read by everything else**, and
the eye and the hit sphere come down together or the stance makes a body easier
to kill — `entities/stance.ts` is the one copy of both heights and the ease,
for all five bodies that crouch. **A team's bots tell each other two things, and both are CUES that may
never enter `BotMemory`** (`entities/SquadRadio.ts`, one board per team): a
squad-only contact CALL, deliberately not a destination, and a HAZARD mark where
the team's own bodies fall — everything in `BotMemory` feeds `hasCue`, so a cue
there is a SEARCH. **A squad walks as a line, not a column**: `movement.spacing`
(5 m) is the formation and `bots.separation` (1.5 m) is de-penetration, both out
of one pairwise pass, and a cover anchor is CLAIMED so a baked lookup cannot
hand four bots the same corner.

**A bot inside a TANK is out of all of this** (see the vehicles section), and so
is a bot the round does not field; what it costs this layer is one rule:
`BattleSystem.aside` is the skip test every loop over `bots` owes, never
`benched.has`.

→ **[`docs/bots.md`](docs/bots.md)** — surface and link rules, the acquisition
cone and target hysteresis, the four states that take the stance, the radio's two
cues, the three sources of herding, squad planning and postures, a crewed bot's
three exemptions, and the yaw/bodyYaw split.
### Deaths, glass, and the one physics engine

A killed bot falls under **Havok**, the only physics engine in the tree; so do
the death cam's stand-in body, a broken pane's shards and a blast's rubble.
**Nothing under it feeds navigation, cover or hit detection** — a corpse is not in
`NavGrid`, not in `ObstacleField`, not in `hittablesAgainst`, and neither a shard
nor a chunk is either. `scene.physicsEnabled` is **false and must stay false**
until the scene goes, and Havok never touches a node at all.
**What the pool holds for a body is its RIG** (a `NetSoldier`'s, or the death
cam's stand-in), never the simulation's `Bot`.

**The engine is required and there is no fallback.** A full pool **evicts the
oldest corpse** rather than refusing, which protects the death cam's body for
free; **one refusal is left, a death past the body draw distance**, where
nothing is drawn.

**A round DROPS a body and an explosion THROWS it**, how far being the
`deathDamage` the corpse already recorded, so a blast's `power` stays the size
of the PICTURE. `DamageKind` picks, and the test is "not a bullet or a burn".

**`PhysicsWorld` owns the engine and no client owns any of it.** It is INJECTED
into `RagdollSystem`, `DebrisSystem` and `BlastDebrisSystem` by `Game` — the
`BattleSystem`←`CombatSystem` precedent — and `Game` steps the engine and *then*
its three clients, never the other way round. **It calls Havok's RAW `HP_*` API**
(`systems/havok.ts`) — no Babylon plugin, no physics engine on the scene — and
**a body's pose is seven numbers in an array** (`WorldBody.pose`), which each
client's VIEW writes onto what it draws (`systems/poseView.ts`): the ragdoll at
the top of its `update`, before `freeze` reparents joints, so **anything new
that reads a corpse's drawing between `physics.update` and the clients'
`update`s reads last frame's**. `PhysicsWorld` reaches no node, mesh or scene —
the floor reaches it as `GameMap.terrainGeometry` — and
`scripts/check-babylon-free.mjs` holds it there.

`dying` is a **step in the state machine, not a lid**: `updateWorld` runs in full
underneath the death cam, so the tickets bleed and your killer walks past while
you watch — and it costs no time, because `enterDeploy` is opened with
`respawnDelay` minus what the shot already spent.

→ **[`docs/deaths.md`](docs/deaths.md)** — the boot gate and what the optional
version cost, Havok called directly (the dialect, the substep, the pose array
and where each view draws it), the pool's three tiers, the quaternion leak that
freezes a respawned bot, the fog-wall gate shared with the LOD, the shard pool,
and the death cam's camera hand-off.

### Vehicles: three kinds, one hull, and the exceptions it is

**A vehicle is a `Combatant` you get INSIDE, and TWO people fit.**
`MapLayout.vehicles` is one hardstanding per vehicle — absent on three of the
seven maps — and `Game.driving` plus `Game.drivingSeat` are the two facts the
feature turns on. **There are THREE KINDS and no code that knows it**: a fourth
is a block of numbers, a frame file, a model file and a row in each of TWO
`Record<VehicleKind, …>` tables — `VEHICLE_KINDS` (what the authority builds a
hull from) and `vehicleModels.ts` (what a client draws it with) — and **no `if`
anywhere** — the moment a system asks which kind it is holding, that is broken.
**TWO capabilities stand in for that branch** — **`Vehicle.armed`** and
**`Vehicle.flies`**, each a nullable spec block resolved once into a boolean —
and **a reader that needs the NUMBERS narrows on the block itself** (`spec.gun`,
`spec.flight`), still never on a kind.

**There is no player model in this game, so nothing on a vehicle may promise a
body standing at it**, and nothing may stand on a roof inside a gun's sweep.
**The two seats are `DRIVER` (sticks + main gun) and `GUNNER` (the cupola gun
and nothing else), and the first man aboard DRIVES**. **The verbs are `E` to
board and `F` to cross** (and two buttons that APPEAR on glass, which
`Game.offerUse` is the one door to name); **both turn a BOT out of the chair
they reach and neither ever moves a PERSON**. **A driver's frame is not a
body's**: `Player.update` is not called, so the hull's ground REPLACES the
probe.

**`Vehicle` is the simulation and a `VehicleView` its picture**, TOLD through
one `HullPicture` only what it cannot poll; **no simulation reads a node** —
the muzzles are replayed off fields (`docs/vehicles.md`).

**A hull is the one MOVING solid thing in the game**: every ray and every SWEEP
meets it through `rays.hulls` and `rayBox()`, behind one gate
(`Vehicle.present`, which `hide` ends), off its own fields and never its mesh,
but it emits **no `WorldBox`** — so the nav graph, the cover bake, the obstacle
field and the collision bake have never heard of it, and **bots walk through a
parked tank as they walk through a corpse**. **Anything taking a hull out of its
own way passes it as the query's `skip`** (`castBody`, `castRound`, `blocked`) —
never a predicate (`world/solid.ts` forbids minting one) and never a write to
the hull. **It is also the one TARGET answered by its collider rather than by a
hit sphere** (`RayHit.hull`), **which is why a hull's own ROUNDS leave that
collider out too** (`ShotOptions.fromHull`, stated on the GUN).

**A hull drives over PEOPLE**, which is what `crushSweep` is
(`systems/hullRules.ts`, beside the two guns — ONE copy, which the core calls
right after `VehicleSystem.update`). **What a hit is worth is a
`DamageKind`** — the third parameter on `Hittable.takeDamage`, which only a
tank reads, against `CONFIG.vehicles.tank.resist` — and `"crush"` is one no
round carries. **The reticle still cannot lie**: the look is an ORDER the
turret walks toward, the shell goes down the GUN's axis, and **everything else
on the hull that moves is a PICTURE** — the collider never tilts and nothing on
it is pickable.

**A GUNNER's SIGHT is the one thing in a hull that reads the player's ADS**
(`Game.opticUp`) — a question about the SEAT, never the kind.

**BOTS CREW BOTH CHAIRS, and a crewman is not a bot with a vehicle attached.** A
crewed bot leaves `Bot`'s FSM entirely (the bots section's `aside` rule) while
keeping its LIFE, its POSITION slaved to the hull and its SQUAD'S ORDER.

**A hull is HEARD whoever is in it**, pushed per FRAME (`Game.pushHullEngines`),
and **what drives the voice and the rotor's wash is asked of the HULL**
(`Vehicle.powerplant`, `Vehicle.washTo`), never of the kind. **A colour GRADIENT
changes a particle system's VERTEX BUFFER LAYOUT, so one may only be added
before that system's FIRST RENDER.** **A frame that did not STEP the fleet owes
`Sfx.enginesOff` and a wash of zero** (`Game.fleetStepped`, **read ONCE**).

→ **[`docs/vehicles.md`](docs/vehicles.md)** — the kinds, their trades and
models, and every reader of `flies`; the hull and its view, and what a picture
is told; the seats and the crew of two; the pilot's held bearing and the flight
model; the collider's three answers; the crush's gates; the gunner's sight and
the framing bug it found; the engine voices and the rotor's dust, spray and
ripple; the plank, the climb and the leading-end sphere; the authority's
unforced world matrix; the damage kinds, the shell, what a map and its GENERATOR
owe, and what is not built.

### Anti-tank: the third slot, and the only thing a hull is afraid of

**The kit has a third slot on maps that have armour, and nowhere else** —
`Game.armourOffered` is one `MapLayout.vehicles` entry, online and off. A
slot that is not there is not one that is empty: the kit row, the HUD line and
`Player.slots[2]` are absent. It holds a LAUNCHER or two MINES, never both,
because the choice is the feature.

**An AT item is CARRIED as a weapon and RESOLVED as nothing like one.**
`equipmentSetup` hands back a plain `WeaponSetup`, so the holster, the draw, the
swap, the rig and the trigger gate need no teaching — and every field that would
make it a gun is a constant saying it is not, **`reloadTime` included**: the
pouch is refilled by death exactly as the grenades' is. **The launcher is LOADED
on screen off the fire cooldown**, and **`Player.loading` is the one question
anything else asks** — a magazine going into a well OR a rocket going down a
bore, which is what stops the sprint.

**The ROCKET FLIES — the second thing in this game that is not hitscan.** **The
MINE is not a projectile at all**, and **only a hull sets one off**. **What a hit
is worth is TWO numbers**, the split the tank's gun already makes: `damage` to
the HULL it struck as a `shell`, the `blast` to everything else, spent together
by `resolveOrdnance`, friendly fire excluded by construction on both halves.
**One bot per squad carries a launcher and may fire it at armour and at nothing
else.** In a match the AUTHORITY owns both objects: a client predicts its own
rocket, never its mine, and never either one's blast.

→ **[`docs/antitank.md`](docs/antitank.md)** — why the two items are one slot,
what `equipmentSetup` makes constant, the three things `tryShot` skips, the
rocket's arm distance, the mine's cap, the bots' band and their worn tube, the
shoulder carry and `hipYaw`'s counter-intuitive sign, the muzzle load's seven
beats and the sustainer that makes them read, and what is not built.

### Breakable glass

**Glass BREAKS where there is enterable space behind it, and is decoration
everywhere else** — a sheet hung on a solid mass stops nothing. The rule is
declared as `PaneSpec.breakable` and carries the collider with it, so there is
one kind of pane rather than two: everything else is glazing `MapBuilder` draws
and no other part of the game has heard of — not in `GameMap.panes`, not bucketed
for the sweep, not in the collision bake, not nameable on the wire.

A pane breaks and never mends inside a round, and **that monotonicity is what
makes the update incremental**: the graph only ever GAINS links, so
`NavGrid.openBox` relinks the ground AND relaxes the seven fields over it, in
the frame the pane broke. **Two rules keep it honest**: every CLEARED pane comes
out of the list `openBox` re-severs against, not merely the one breaking; and
the fields belong to `openBox`, never to its caller.

**A round has to pass THROUGH glass, so a pane can never stop a `castRound` —
which means the hitscan's wall query can never report one.** `CombatSystem.fire`
raises `onShotPath` with the segment the round flew and `GlassSystem` answers it
analytically, in the core, off its world as data. **A pane's index in
`GameMap.panes` is its identity** on both sides and on the wire, `npm run
parity` proves both build the list in the same order, and breaking is the
CORE's — the page breaks a pane when its `glass` event says so. **A pane is
see-through, a FAIRNESS rule and not a look**: `castRound` already lets a bot
shoot through a window. **`GlassSystem` is the
simulation and draws nothing** — the box, the push-out and the nav graph;
the collapsed glazing and the collider MESH's editor flags are `GlassFx`'s,
told by `onBroken` and `onCleared`, and the core builds none.

→ **[`docs/world.md`](docs/world.md)** for the builder's side and
**[`docs/multiplayer.md`](docs/multiplayer.md)** for the wire's.

### Conquest rules

`ConquestSystem` owns flags, the capture meter, tickets and bleed. The meter runs
-1..+1 and ownership flips only by crossing 0, so a flag must be neutralised
before it changes hands, and occupancy is counted from the combatant list
`SimCore` assembles each step (bots, then people). A person's health
regenerates after `CONFIG.player.regenDelay` (the core's `SimPlayer`, the
page's `Player` predicting it), without which the round is a respawn queue.

**A round is SCORED as well as counted, and the score is not the kills.**
`ScoreBook` is ONE ledger — one row per roster SLOT, held by the one core
(`SimCore`, inside every `Match` — the page's own included), so there is no
second board to drift — and **the payout rules are one function each, in that
same file**: `awardKill`, keyed on **the flag the VICTIM was standing in, never
the killer's own position**; `awardZone`, which pays everyone of a side standing
in the flag at the moment its meter moved; and `paysKiller`, which is **WHICH
BODIES PAY AT ALL** — a hull is not a row on the scoreboard, because a destroyed
tank already pays its crew. **None may be written out a second time, on the page
or anywhere else** — a second copy fails as a quiet disagreement. **A credit
guard belongs in `SimCore.creditKill`, never at the door**, and every new door
inherits it. **`ConquestSystem.onCaptured`/`onNeutralised` are the CORE's
callbacks**, so a host that took one for itself would silently turn the capture
awards off; a host hears a capture as the `captured` event, after its awards.
**`npm run corecheck` asserts these rules TWICE and the halves must agree**: on
a bare core through the TRUSTED door (`SimCore.submit`, no `Game` and no
`Match`), then through a real `Match`'s VALIDATED door with fake peers, and both
must drain the identical events — the proof that `Match` restates no rule.

**A capture zone is DRAWN, not just counted** (`CaptureZoneSystem`, plus
`HUD.setCapture`), and the one rule reaching outside the drawing is that **the
ring is the boundary**: it is built at `ControlPointDef.radius`, which is what
`pointAt` tests, so the line on the floor is not an approximation of the zone.
**It is LAID, never lit** — whitewashed stones on open ground and paint on made
ground, in the cel material — so nothing on the floor says who holds the point.
**The flag over it IS the meter** — flown at `|meter|` up its pole in the
colours of the side the meter leans to — and it is a CLOTH SIMULATION in the one
wind, never a posed wave, flown from the roof when the point is indoors.

→ **[`docs/rendering.md`](docs/rendering.md)** for the ring's surface sampling
and the markers that fade themselves out, and
**[`docs/multiplayer.md`](docs/multiplayer.md)** for the score on the wire.

### Measuring a frame

**The frame profiler SHIPS, and that is the whole feature rather than a
compromise**: the devices worth measuring are the ones that will never run a dev
server or open DevTools. `FrameProfile` is therefore armed by a **setting**
(`Settings.profiler`) or by **`?profile`**, never by `import.meta.env.DEV`;
disarmed, every entry point returns on its first line and the ring is not
allocated.

**It records CONTINUOUSLY and the capture reaches BACKWARDS**: the ring holds
`CONFIG.profiling.frames` and the gesture is pressed AFTER the hitch (`F3`, or
the chip's buttons on glass). **Nothing allocates PER FRAME while it is
recording** — no per-frame object, no label string, no closure — because a
profiler that allocates per frame manufactures the bug it was built to catch.

**The brackets live in `Game.ts` and nowhere else, with three exceptions, one
INSIDE the render, one AFTER it and one inside the core.** `tick`,
`updateGameplay`, `updateNetWorld` and `updateWorld` are where the frame's order
is already declared, so **the phase list IS that order** and no system had to be
taught the profiler exists. A phase is a name in `PHASES`, a parent in
`PARENT_OF` and a `begin`/`end` pair, and **the spans NEST and do not
partition** — read a report as an attribution. `render`'s four spans hang off
the SCENE's own observables (`hookRender`); **`present` is NOT inside `frame`**,
hung off the engine's end of frame (`hookEngine`); and **`sim` is the core
TIMING ITSELF** with a clock its host injects (`SimCoreOptions.timing`), **never
for an outcome**, and only for the page's OWN match. So there are **THREE
ROOTS** (`ROOTS`, derived so it cannot drift), and **what is left over is the
answer, not a gap**: `frame` + `present` short of the wall clock is a wait
nobody can name.

**THE BENCHMARK IS A URL** (`?bench=<map>`, `bench/BenchScript.ts`), ending in a
labelled capture on a HALTED ring, so a phone runs it off the link and one tap.
**Every bench frame is the FIXED step `tick` hands down**, which is why the
world must step by `tick`'s `dt` and by no clock of its own: anything that reads
the refresh clock, the wall clock or `Math.random` for an OUTCOME makes two runs
fight two fights, and the capture's `bench.fight.hash` is what says so.

**What all of them measure is CPU**, and under `compatibilityMode = false` that
is the recording of a render BUNDLE rather than the work the GPU then does.
**GPU time is a BOOT FLAG** (`?gpu`), and **necessary but not sufficient**: the
whole-frame counter also needs `--enable-unsafe-webgpu` on the BROWSER. Read
`gpu.frame`, never `gpu.mainPass`.

**A capture is READ at `/profile_viewer.html`**, one import-free, network-free
page in `public/`. **That path is spelled in THREE places** — the file in
`public/`, `sw.js`'s `DOCS`, and `ProfileChip`'s `VIEWER_PATH` — and **every
way of missing one fails silently** (a path missing from `DOCS` silently becomes
the game offline). **The capture states its own phase tree**
(`ProfileReport.tree` from `PARENT_OF`, typed so a new phase does not compile
until it names its parent).

→ **[`docs/profiling.md`](docs/profiling.md)** — the phases and what each one
covers, the residue and the report versions that made it a subtraction, the
long-animation-frame reading and why its absence is the finding, how to take
and read a capture, the viewer and the three rules for editing it, the relative
hitch bar, the GC sentinel and the heap probe, how to find WHO allocates, the
trace export, `?gpu` (`frameMeasurable`, the two counters), and the levers
deliberately not in it.
### The installable app

The build installs to a home screen and launches fullscreen, landscape and
offline. Four files carry it — `public/manifest.webmanifest`, `public/icons/`,
`src/pwa/register.ts` and `src/pwa/sw.js` — and nothing in the game knows any of
it exists. **There are TWO navigable documents now**, the game and
`public/profile_viewer.html`, and a navigation is answered with the shell unless
its path is in `sw.js`'s `DOCS` — a second page not listed there works online
and silently becomes the game offline.

Three rules are about the DEVICE rather than the game: a tap arrives twice
(the second as a synthesized mouse event, disbelieved for
`CONFIG.touch.mouseGrace`), a mouse that has not MOVED is not a mouse being used,
and the trigger's gate takes `touchActive` beside the pointer lock and the pad.

**`public/` is the one place a URL is written by hand**, because a home screen
keeps the `start_url` it installed with. The service worker is a **template, not
a module**: never imported, never typechecked, substituted into `dist/sw.js` at
`writeBundle`. **The NAVIGATION is network-first and everything else is
cache-first** — every asset is content-hashed, and `index.html` is the one
unhashed file. And **`registration.update()` in `register.ts` is the only thing
that ever checks for a new build**; deleting it puts the game back to needing
five to ten refreshes.

→ **[`docs/pwa.md`](docs/pwa.md)** — the version hash over names *and* contents,
the `no-cache` requirement, the two assumptions that made a deploy take five
launches, and the phone-shaped details
(fullscreen on the document element, and why no screen is scaled to a short
viewport any more).

### Multiplayer: the server is the authority, and a slot is a slot

A server's match is a dedicated Node process running the real simulation,
which its clients render; no client hosts one. **`Match` is the HOST of the
one `SimCore`**: it VALIDATES each message (`server/wire.ts`, the claim
gates, `validateMove`/`validateDrive`), `submit`s what it accepted as a
`SimCommand`, and drains the core's events after every call to `relay` them
onto the wire — **validation is `Match`'s and every rule is the core's**, so
neither may grow the other's half. A shooter's hitmarker is a **guess** —
every target is rewound and `CombatSystem.fire` runs again on the server, the
only thing that deals damage. **A client predicts its own MOVEMENT, its own
health regeneration and — in a hull — its own DRIVE**, each validated on
arrival; everything else a client steps is DRESSING.

**Offline is a match too, and the page is its OWNER as well as its one client**:
an owned `Match` in a Worker (`src/net/matchHost.ts`), or on a channel in the
page's own thread under `?simpage` or when no Worker comes up — reached through
**the one value import of `server/` anywhere in `src/`**, that fallback's
dynamic `import()` — and joined over a port, meeting every claim gate a remote
peer meets. **What only the owner may do goes on a SECOND channel that is not a
`ClientMessage`** (`src/net/LocalMatch.ts`): begin a round on a seed and a
difficulty, `advance` or `hold` the clock, read the bench's fight, dial a
seatless WATCHER — so nothing a remote client sends can begin a round or move a
clock. **Whether the page owns the match is ONE question
(`Game.localRound`/`remoteRound`), asked only about AUTHORITY** — restart, the
map and the difficulty, a lid holding the world — never about what the page
PREDICTS.

**The slot table is forty-eight slots, built once, never resized or reordered**
— `CONFIG.bots.maxPerTeam` a side, on every map, because a match rotates maps
under ONE table (an OWNED match never rotates). **What the map decides is the
ROUND**: `MapLayout.perTeam` reaches the authority through `setFielded`. **What
the map may never decide is the SEATS**, which stay at sixteen — the smallest
roster in the rotation, so a rotation takes bots off the field and never a
person out of a seat. Every slot nobody is sitting in is a bot: a human joining
BENCHES the bot in their slot and leaving un-benches it. **Benching is not
killing** — joining and leaving must never charge a team a reinforcement — the
bench lives in `BattleSystem` as a `Set<Bot>` and never as a flag on `Bot`,
**every loop over `bots` there must skip it** (through `aside`, which also
covers a tank's crew), and **a slot index IS a bot index**.

**A match may be created with NO BOTS** (`Join.bots`), the SEATS untouched,
so **an empty slot is STATED and not read** (`dead: 1`).

**Four things arrive from the authority and may only be written through their one
funnel**, because a client that decides any of them for itself is playing a
different game in the same window: the local player's **team**
(`Game.applyPlayerTeam`), the match's **map** (`Game.applyMatchMap`;
`Game.setMap` is the *player* choosing, never written from the wire), a **body
coming into the world** (an ASK), and the **scoreboard**. **The ROUND is a fifth
and it is a REFUSAL rather than a funnel**: `startRound` is the player asking
for one, so every door into it asks `!Game.remoteRound` — the round-over
card's confirm, its own button, and the pause menu's Restart — and the two
that are DRAWN are absent in a server's match rather than dimmed.

**The next map is VOTED for** (`server/MapVote.ts`), and **a vote is an INDEX
into the server's ballot, never a map id**.

**A TEAM INDEX IS THE AUTHORITY'S AND A SIDE'S COLOURS ARE THE VIEWER'S**
([`src/core/teamView.ts`](src/core/teamView.ts)) — presentation only; everything
else stays on the authority's index. **A side is chosen when a rig is BUILT**,
so it is half of each rig POOL's identity beside its size
(`NetRoster.setFielded`), and **nothing outside `teamLook` may index
`CONFIG.teams` with a live team.**

**The server cannot run `MapBuilder`** (no canvas): it rebuilds the solid
world from the generated `src/world/<map>/collision.ts` as data, including each
box's `porous` flag, so **`npm run parity` should be run after anything
touching the world layer**. `npm run build` refuses a bake older than its
layout, but that guard hashes the LAYOUT — a flag changed in a builder needs
`npm run collision` by hand.

**A SERVER TIME IS THE SIMULATION'S CLOCK AND NEVER `Date.now()`**
(`SimCore.now`): **every stamped message uses it**, `LagComp` included. **The
core reads no clock and draws no seed itself** — its HOST hands it both — and
nothing in `src/sim/` imports from `server/`.

**Each sound cue comes from whichever side actually knows** — including the
crack of a round going past, which is ADDRESSED to the one player it happened
to rather than broadcast, because a broadcast is the read a wallhack wants.

**A driver reports a HULL instead of a body** (`DriveMessage`), and **every
bound `validateDrive` holds is ANSWERED**: speed and climb are REFUSED, the
extent and a flying hull's ceiling are LIDS, and **a refusal is never SILENT**
(`hullcorrect`, answered by `Vehicle.correctTo` — never `placeAt`). **An
ACCEPTED sample is also a CRASH TEST** (`src/sim/reportedLanding.ts`).

**`decode` proves only that a frame is JSON with a `t` on it, so a
`ClientMessage` is a CLAIM and never a fact**: `server/wire.ts` is the one door
that makes it one, nothing else on the server may read a frame, and a new client
message type owes an arm in its switch.

**A KIT IS CHOSEN MORE THAN ONCE, so it rides the DEPLOY** — anything that
changes what a person carries owes the authority a `deploy`. **A round says
WHICH carried weapon it left** (`ShotMessage.slot`, the slot constants living in
`entities/weapons.ts` because the authority cannot import `Player`).

**There is more than one match server, the CLIENT holds the list, and none of
them knows another exists.** **A match id is minted per process**, so every
row, join and identity is qualified by REGION, and **two processes behind one
hostname is forbidden**.

→ **[`docs/multiplayer.md`](docs/multiplayer.md)** — the authority model and what
it does not defend against, the roster, the bench and the botless match, the map
vote's ballot, the viewer's side, the deploy ask and the kit that rides it, the
two weapons and the rate bucket, the stance and the addressed crack, what a
death owes each side, the clock and its slew, the rewind, armour on the wire,
the drive verdict (the ceiling as a RATE) and its correction, the match its
OWNER drives (the hold, the watcher, the table's width, the local transport
and a lost host), the lobby and the regions' two headers, and what is not
built.
## Conventions

- **All tunables live in `src/config/`** (`CONFIG`, `as const`). No gameplay magic
  numbers elsewhere — art/geometry constants stay in their model file. It is one
  module per subsystem, composed into a single `CONFIG` by `config/index.ts`,
  which is the only file that imports the sections. **A new tunable goes in the
  section module it belongs to, never in `index.ts`** — that file is a spine and
  holds one import per module and nothing else. `FOG_WALL` is alone in
  `config/fogWall.ts` because it is a constant rather than a section, and a
  section that reads it must take it from there: `index.ts` imports every
  section, so taking it from `index.ts` would be an import cycle.
- `CONFIG` is `as const`, so a field like `bots.engageRange` has a *literal* type.
  `let x = CONFIG.bots.engageRange` then reassigning it fails to compile — annotate
  `let x: number` instead.
- **There are TWO `Vector3`s until the exit's X6.1, and they do not mix.**
  `src/math/` is the game's own — Babylon's subset under Babylon's names, bit
  for bit (`scripts/math-check.mjs`) — and a map's LAYOUT positions and the
  world's data layer are made of it; the rest of the tree still holds
  Babylon's. **One of ours handed to a Babylon method reads `_x` and writes
  NaN without a word**, so a crossing is a copy through `src/math/babylon.ts`,
  and a function both sides reach takes `Vector3Like` (read) or `Vector3Ref`
  (written through `set`), which Babylon's satisfies. The types catch every
  crossing but two: an `instanceof` (the editor's serializer knows a position
  by its CLASS) and a push into an untyped array (the editor's new entries) —
  so a vector put INTO a layout is `src/math/`'s.
- Smoothing is normally the frame-lerp idiom `Math.min(1, dt * rate)`. **Anything
  that moves where bullets go, or that a player will read as recoil, is stepped
  EXACTLY instead**, because burst climb must not vary with frame rate.
  Frequency decides which you need.
- **Recoil is an ARREST and a HAUL and must never become a spring again**
  ([`src/core/recoilCurve.ts`](src/core/recoilCurve.ts), run by both the aim
  and the weapon on screen). **A weapon states it TWICE** — `recoilMult` the
  MOMENT, `recoilImpulse` the SHOVE — and **one set from the other has said
  nothing**. **Spend its visual budget on the MODEL, not the aim**: the model
  has a SHOULDER (`kick.stackCap`) and **the aim has none and must not be given
  one**. The pattern's walk figures are DERIVED — **re-derive them** whenever
  the pattern or a per-shot figure moves (`docs/weapons.md`).
- **The recoil vector is built in `Player.recoilKick`, never at the call site**,
  its horizontal drawn ONCE per shot (`Player.kickDrift`) as a SWEEP over the
  string, never an independent draw per round, and `Game` does no arithmetic on
  it. **A STRING CHANGES HOW HARD A WEAPON KICKS AND NEVER WHICH WAY.**
  **`CameraSystem.addFlinch` is the one aim kick that is 100% springy and must
  stay that way.**
- **Nothing may take the RENDERED aim DOWN under a held trigger except each
  round's own recovery** — the hold sway, the shake and the view punch are all
  on the same picture as the recoil. **Anything new on `aimPitch` or the
  rendered pitch owes that test**, through a held trigger in the live client.
  **The ONE exception is the reload's head looking down at the work**
  (`reload.head`): rendered only, and level again before the round it loads is
  live.
- **The recoil vector is built in `Player.recoilKick`, never at the call site**,
  its horizontal drawn ONCE per shot into `Player.kickDrift` so the aim, the
  viewmodel's lean and the view punch are the same round going the same way;
  `Game` wires the result to the camera and does no arithmetic on it.
  **That horizontal is a SWEEP over the string and never an independent draw
  per round** (`recoil.pattern.sweepShots`). **A STRING CHANGES HOW HARD A
  WEAPON KICKS AND NEVER WHICH WAY**: `pattern` is ONE envelope spent on both
  axes and the direction is the weapon's own `yawBias`.
- **One event arrives ONCE, and a repeating one ACCUMULATES rather than
  restarting.** **Anything new on the rendered camera owes both halves.** **And
  a GUNSHOT's punch has NO DIRECTION** (`punchLift` and `punchSwing` are both
  0): every angle in a round is already stated where the bullets can see it. A
  BLAST keeps both.
- **A team's colour is WORN, not merely drawn** (`CONFIG.teams[].color`, on a
  soldier as on the deploy map), so it stays saturated enough to read at three
  pixels through fog, and the sides are told apart by **hue**, **accent** and
  **silhouette** at once (`SoldierModel`'s `KITS`). **WHICH side wears which is
  the VIEWER's**: a kit table is indexed through `viewTeam` and a name or a
  colour through `teamLook`.
- **Every ROUND is hitscan** — player and bots share `CombatSystem.fire()`,
  which takes the shooter's target list (so friendly fire is excluded by
  construction rather than by a team check inside) and the shooter's own
  `range`, which bounds the wall pick and the near-miss sweep as well as the
  damage. **The PICTURE of a round is `systems/CombatFx.ts`'s and the shot never
  draws**: `fire` raises `onRound` once per round and `Game` wires it to the
  view, which the authority never builds. Its effects are POOLED; add to a pool
  rather than allocating per shot. **The bullet MARK pool's slots outlive the
  shot** (`systems/BulletMarks.ts`): CEL-lit, and stood on the STATIC world
  only. **Two things are deliberate exceptions to hitscan and there are exactly
  two**: the grenade and the anti-tank rocket.
- **Damage is a slope, not a number**, and `range` is only where the ray stops.
  `ShotOptions` carries a fall-off band resolved against the distance the impact
  point already cost. Quote a weapon's time to kill as the CLOSE one or say which.
- **The head zone belongs to the player by CONSTRUCTION, not by a check.**
  `ShotOptions.headMult` turns it on and only `Player.shotOptions` sets it; at 1
  or absent the head sphere is never ray-tested at all — bots aim at `eyePos`,
  so a head sphere their rounds could find would make every accurate bot shot a
  headshot. It is an *upgrade* to a body hit that already landed, never a
  candidate of its own, and fall-off applies first.
- **An OUTCOME is drawn from the ROUND's seed, never from `Math.random`**
  ([`src/systems/RoundRandom.ts`](src/systems/RoundRandom.ts)): a round's cone,
  which spawn a body takes and where in it, a crew's lay, and anything new that
  decides who lives. A system asks its simulation's `RoundRandom` for a stream —
  **one per SHOOTER**, keyed by the authority's slot or the hardstanding — and
  the core reseeds it once a round from the seed its host passes (`?seed=`,
  `simulate`'s fourth argument, or a fresh draw); the page's one stream is the
  player's cone (`STREAM.player`). **A picture or a sound stays on `Math.random`
  and never draws from an outcome stream**, or the fight depends on the camera.
  `npm run simulate -- <map> 1 2 <seed>` prints a `fight` hash the same seed
  must reproduce.
- TypeScript is strict with `noUnusedLocals`/`noUnusedParameters` — the typecheck
  fails on dead variables. **`useDefineForClassFields` is FALSE and must stay
  false**, or a field declared without an initializer boxes every number
  stored into it (`docs/profiling.md`). Nothing fails; the game just allocates.
- `Bot` holds a small FSM and drives a joint rig built by `SoldierModel` (invisible
  root + `TransformNode` joints). Animation is procedural, so a new behavior means new
  FSM states, never new clips.

## Files not to edit / not part of the build

- `dist/` and `node_modules/` — gitignored build output and dependencies.
- `specs/game_design.md` — the original roguelike prototype; historical, **not a
  live contract**.
