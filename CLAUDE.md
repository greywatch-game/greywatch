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
| [`docs/rendering.md`](docs/rendering.md) | lights, shadows, fog, outlines, block visibility, the post chain, the sky |
| [`docs/world.md`](docs/world.md) | a map, a layout, a builder, the terrain or the rim |
| [`docs/editor.md`](docs/editor.md) | anything under `src/editor/` or the dev write endpoint |
| [`docs/bots.md`](docs/bots.md) | navigation, perception, cover, squads, bot cost |
| [`docs/deaths.md`](docs/deaths.md) | ragdolls, glass shards, Havok, the death cam |
| [`docs/vehicles.md`](docs/vehicles.md) | a vehicle of either kind, a new kind, its hull collider, the chase camera, mounting, the respawn |
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
bleed). **Babylon.js** + **TypeScript** + **Vite**; ES modules, Node 18+,
**WebGPU** — there is no WebGL fallback engine in the tree and there must not be
one. `main.ts` gates the boot on `navigator.gpu` AND an adapter, so a browser
without one gets a sentence instead of a black page; what that costs is reach,
and Firefox on Linux/macOS plus older Android and iOS no longer boot at all.
Both phones are PWA install targets, so this is a product fact, not a detail.

**The engine is built with `compatibilityMode = false`, and that is load-bearing
rather than a tuning flag.** This frame is DRAW-CALL bound and Babylon's WebGPU
backend charges CPU on every draw, so the render-bundle submission path is worth
~26% on the two big maps and ~15% on the two small ones (`FINDINGS.md` #17).
**Do not delete it to tidy the boot.** The one thing to know without reading the
measurement is that its risk is state changing between draws: if a rendering bug
ever appears that shows only while something is MOVING, flip this first.

**Zero model files, and SIXTEEN audio files — one report per weapon in the
kit, the cupola gun all three hulls mount, the two halves of the player's own
magazine change, the four beats of a bolt cycle and the two blasts, and nothing
else in the game is recorded at all** — every mesh is built from Babylon
primitives at runtime, and every sound is synthesized WebAudio
(`src/core/Sfx.ts`) but for those sixteen. Do not add asset files unless
explicitly asked. There are four generated exceptions, none authored by hand
and each with a generator in `package.json`: the icons, Havok's `.wasm`, the
water's foam mask, and each map's menu photograph.

**The recordings in `audio/` are the fifth, and they are the only asset class
here a person authored.** They pass the same test the other four do — `npm run
audio` is the generator, the encoded files are committed, and the masters are
committed beside them in `audio/src/` — plus one that is their own: **the game
is still whole with every file in `audio/` deleted**, the fetch being
fire-and-forget off `Sfx.unlock`, so a shot fired before the decode lands or on
a device where it failed is the SYNTHESIZED report and no caller is told the
difference. **A SEVENTEENTH sound owes that same claim**, and **what the
pipeline refuses is a LIBRARY, not a sound that is not a gunshot** — five
footstep variants per surface, thirty one-shots, an ambient bed that alone costs
ten times this whole list.

**A sample belongs to a VOICE, never to a weapon**, which is what keeps sixteen
files serving everything that makes a noise: to a `ReportVoice` (one file is the
tank's cupola, the truck's remote station and the gunship's chin turret — one
gun on three mounts), to a MOMENT (every weapon in the kit plays the same
magazine change, told apart by `actionPitch`/`actionVol`), to a BEAT (a gesture
placed as fractions of a `shotInterval` cannot be one file), or to a BLAST, of
which this game has exactly ONE — `blastAt` takes a `power`, so one recording is
every explosion in the game.

**Three rules from it reach outside `audio/`.** A decoded buffer costs
`duration × ctx.sampleRate × channels × 4` and **nothing else** — the container,
the bitrate and the file's own sample rate are invisible to it — so **the budget
is SECONDS of mono, not bytes**, and `npm run build` fails over it. **A weapon's
`report.pitch` is NOT spent on its own sample**, the eight scalars being
deviations from the reference report that a recording of that weapon has already
made — **and a SHARED recording inverts that**, which is the rule rather than an
exception to it: the magazine change, the bolt's four and the grenade's one have
said nothing about what they are going into, so the scalars ARE spent on them.
And **a sample is the DIRECT sound; the ROOM is the game's** — `Sfx` answers
every gunshot with one shared `ConvolverNode`, so a baked tail double-reverbs
the shot, puts one room on six maps and holds a voice for the length of it.

**The world also makes a noise on its own, and that half is the one place the
recording boundary was never even close.** A burning drum is a SUSTAINED voice
(`Sfx.ambience`, `systems/AmbienceSystem.ts`), and one 30-second ambient loop
costs 5.5 MB decoded — **ten times the entire sampled gun kit** — against a
crackle that genuinely IS filtered noise. **Sample the guns, never the
ambience.** What it costs instead is CPU and SLOTS: the nearest
`CONFIG.audio.ambience.maxVoices` win a voice each frame, and an incumbent is
scored `swapMargin` closer so two fires either side of a street cannot trade a
slot. **An emitter's INDEX is its identity** — the key the held-open graph hangs
on — so the registry is append-only within a map and a teardown owes
`Sfx.ambienceAllOff` beside the `clear`. **Nothing in it is scheduled**, `Sfx`'s
own invariant. It is pushed from `tick` in **every** state, the OPPOSITE
conclusion to the engine voices' `fleetStepped`: an engine is driven by a load a
lid freezes, and a fire is driven by nothing at all — a village does not go
quiet because a kit screen is up.

**THREE things carry a sound and two of them say so beside the LIGHT they
already carry**: a scatter prop through `SCATTER_AMBIENCE` (beside
`SCATTER_LIGHTS`), a STRUCTURE through `Build.sound`, `Build.light`'s twin
rotated into the world by the same line — **what is drawn as burning is heard
burning** — and a `WaterRect`. It is named by ID and never by reaching for the
audio config (`AmbienceId` plus `MapBuilder`'s `AMBIENCE_KINDS`, a `Record` over
the union so a second kind does not compile half-added), and **a position is
taken at BUILD time or not at all**, the merge having taken the prop's mesh
away. **A LAKE MAKES NO NOISE IN THE MIDDLE OF ITSELF**, so a `WaterRect` names
WHAT it sounds like and never where: **a BODY of water is a connected group of
rects rather than a rect**, the emitter scores itself on the nearest point of a
RUN — **a fire is a place and a shore is a line** — and `WaterRect.sound` is the
one optional field on a layout whose default is not "unaffected", absent meaning
`shore` because silent water is a bug.

→ **[`docs/audio.md`](docs/audio.md)** — the three budgets and what each one
binds, why one ambient loop costs ten times the whole sampled gun kit and what
that rule bought instead (the ranking, the emitter's index, the fire's layers
and the gate's rendered pops-per-second), both water fits and the tables behind
them, the waterline derivation and what it costs on the biggest map, the
mono/round-robin/transient rules and the width measurements under them, the
manifest and its two gates, the master conventions and every trim in full.

**Havok's `.wasm` (~2 MB) is the one binary that ships**, and it is never named
by path — Vite emits it content-hashed from the ESM glue's own
`import.meta.url`. Do **not** also hand-place a copy in `public/`: that precaches
2 MB twice. **It is REQUIRED, and the boot screen enforces that**: `main.ts`
awaits `loadHavok()` before it constructs `Game`, so nothing downstream asks
whether physics has arrived. Do not reintroduce a fallback. **Two more WASMs
exist and the rule is that neither ever ships**: `WebGPUEngine` lazily fetches
glslang and twgsl off `cdn.babylonjs.com` the moment a shader reaching the
backend is GLSL rather than WGSL, which would break `docs/pwa.md`'s offline
promise silently. Nothing in `src/` is GLSL, and the tripwire holding that is
TWO halves because an aborted route silences the other one.

**Never add a deep static import into `@babylonjs/core`, and never drop
`optimizeDeps.exclude` from `vite.config.ts`.** Both break a DEV session only,
both blame a subsystem that is not at fault, and both hide themselves on a
restart — the first silently unshaded the glow layer and every `StandardMaterial`
in the game. `src/` now holds **zero** of them and `npm run build` fails on a
new one (`scripts/check-deep-imports.mjs`); `server/` is outside that scope.

**There is no rigged character asset in the tree.** `GlbSoldier.ts`,
`entities/soldier/` and `@babylonjs/loaders` were deleted when first person
retired them, and the death cam stands up a bot rig rather than bringing them
back. Do not reintroduce a GLB body, and do not extend that approach to bots or
weapons.

→ **[`docs/build.md`](docs/build.md)** — the four generated assets and the test a
fifth would have to pass (one of them now needs a GPU to regenerate), Havok's
path, the dev-only 404 that names the wrong thing twice, the two WASMs that must
never ship, and the deep-import trap in full.
## Commands

```bash
npm install
npm run dev        # Vite dev server
npm run typecheck  # tsc --noEmit (strict, noUnusedLocals/Parameters)
npm run build      # gates + typecheck + production build to dist/
npm run preview    # serve the production build
npm run icons      # regenerate public/icons (committed)
npm run audio      # re-cut and re-encode audio/ from its masters (committed
                   #   source). Needs ffmpeg + ffprobe on PATH; the BUILD does
                   #   not, since the output is committed — docs/audio.md
npm run shots      # re-photograph the maps for the menu backdrop (committed).
                   #   The ONE script here that needs a real GPU — docs/build.md
npm run proving    # regenerate the DEV-ONLY proving ground (committed source).
                   #   `-- --play 900 --margin 300`. Not a level — ENGINE_UPGRADE.md
npm run sarab      # RE-SEED the desert town's layout and heights (committed
                   #   source). One-shot: it discards editor edits to either
                   #   file. Not part of any build — ENGINE_UPGRADE.md S11
npm run cinderhaven# RE-SEED the volcanic island's layout and heights
                   #   (committed source). Same one-shot rule as `sarab`, and
                   #   the same warning: it discards editor edits to either
                   #   file. Not part of any build.
                   #   `-- --probe` prints the FLOOR as a plan, a section and a
                   #   survey and writes nothing — on a map whose floor is the
                   #   level, that is how you iterate on a coastline.
                   #   `-- --roads` prints how far every square of dry, in-play
                   #   ground is from a carriageway — a quarter with no lane to
                   #   it has no symptom in a screenshot
```

No test suite, no linter. `npm run typecheck` is the only automated gate — run it
after any change. Playwright + Chromium are devDeps for ad-hoc browser smoke
tests; write throwaway scripts to the scratchpad, not the repo, drive them
through the `window.__celshock` handle `Game`'s constructor exposes, and read
**[`VERIFYING.md`](VERIFYING.md)** before writing one rather than after it has
misled you — **it is written PER MACHINE now**, because a headless Chromium
needs the right binary and the right flag before `navigator.gpu` will hand back
an adapter at all, and several of its rules invert between a box with a GPU and
one without. Anything with a PICTURE in it needs the first kind.

## Architecture

### Ownership and wiring

`src/core/Game.ts` is the only place systems meet. Systems never import each
other; `Game` wires them with callbacks (`battle.onBotKill/onBotFired`,
`conquest.onCaptured/onNeutralised`, `player.onDamaged`, `deployScreen.onDeploy`)
and hands bot AI a `BattleCtx` (in `entities/Bot.ts`) built once rather than
rebuilt per frame. New cross-system behavior belongs in that wiring, not in an
import between systems. Type-only imports between systems are fine and common —
they are erased, so the runtime module graph still has no system→system edge.

**There is one system that calls another directly, and it is injected rather
than imported**: `BattleSystem` takes `CombatSystem` in its constructor (`Game`
still owns the wiring) and calls `combat.fire` for a bot's shot. A callback
would not do — the shot has to resolve synchronously inside the bot's think tick
so the result is available to the same frame's kill handling. Read the rule as
"never reach for another system", not "never mention its type".

**`Game.ts` is long on purpose**: most of its length *is* its job, and splitting
the wiring re-creates the system→system edges the rule above exists to prevent.
What may leave is a cluster of **private fields that answers only to itself** —
nothing else in the file reads them, and the methods over them touch no system,
no mesh and no frame (`net/RegionBook.ts` is the worked example). What may not
leave is anything whose methods reach across systems, however big it gets.

**`installMap` is the one place a map is built**, and both callers — a round
starting and an editor rebuild — go through it, because two copies of it drifted
apart once and the failure is silent rather than loud. **Anything new that
consumes a `GameMap` or an `EnvironmentSpec` goes in `installMap`.**

`Game`'s state machine is `menu -> loading -> deploy -> playing -> dying ->
deploy`, with `roundover` when a side runs out of tickets. **The 3D scene renders
in every state**, which is what lets the deploy screen and the menu sit over a
live view, and `loading` and `dying` are **STEPS, not lids**: `updateWorld` runs
in full under the death cam, and nothing may simulate under the building card.

**A LID is a screen laid over a state, which taking it off puts back rather than
moving the game on — and which state is which, and what each one owes, is
DECLARED rather than described.** `SCREENS` in
[`src/core/ScreenStack.ts`](src/core/ScreenStack.ts) is a
`Record<GameState, ScreenSpec>` with one row per state, so **a new screen does
not compile until it has answered all four questions**: what it may cover,
whether the world under it is held offline, whether it owes the netplay frame the
authority keeps running behind it, and whether the scoreboard is owed to it.
`Game` has exactly three moves (`go`, `raiseLid`, `lowerLid`), **nothing in the
codebase assigns a game state** — `Game.state` is a getter — and `Game.takeDown`
is the one place that knows what putting a screen away means. **The question a
lid raises is never which screen is up, but whether what is under it is moving**:
offline a pause genuinely holds the world, and in a netplay round it holds
nothing, because the authority never heard the key.

`Game.updateGameplay` has a load-bearing order at the end of the frame: camera
update → carried-light updates → `lighting.update(dt, camera.position, mats)`.
Light slot selection keys off the camera position, so nothing may move the
camera after it. **Four things are pushed from `tick` instead, because they are
owed by the states that simulate nothing**: `mats.updateCamera()` (the shader's
EYE, or every screen with a live view behind it is fogged against wherever the
last live frame stood), `sfx.setListener()` (the EAR, the same bug with a
different symptom — a listener placed only by the frames that simulate sits at
the origin, so a fire in the village pans from the map's corner while the menu
is up), `Game.pushAmbience` and `Game.pushScoreboard` (the Tab board belongs to
the ROUND, not to the states that simulate one). `ConquestSystem.update` runs
*before* `BattleSystem.update`, so a bot's think tick sees this frame's flag
ownership rather than last frame's.

→ **[`docs/game.md`](docs/game.md)** — the mechanical test for what may leave
`Game.ts`, what `installMap` hands to which system, and the pushes from `tick`.
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

**Springs and timelines have one owner each**: the punch spring is `Player`'s,
the bob phase is `CameraSystem`'s, and the reload is a timeline keyed to
`Sfx.reload`'s clacks. **The trigger is two questions** (`semiAuto`, `burst`), and
a reload, a swap, an empty magazine or a death must ABANDON what a burst owes.

**There are THREE gestures over a weapon and only one has a clock of its own.**
The reload runs on `reloadTime` and needs a gate, a phase and a cancel path; the
launcher's load (`muzzleLoad`) and the bolt cycle (`boltCycle`) are both the FIRE
COOLDOWN read as a gesture, and hold no state at all — that clock is already
dropped by a swap, already zeroed by a fresh weapon and already what refuses the
trigger, so neither can be stranded or disagree with what the weapon may do. **A
new gesture over a wait belongs on that clock, not on a new one.** The reload and
the load take the aim away with them (`aimBreak`); **the bolt cycle is the one
that KEEPS THE SIGHT PICTURE, and it is where a gesture over an aimed weapon
must go** — because `applyFit` puts the fitted sight's reticle on the camera
axis, so an aimed weapon that MOVES is a reticle that lies. It therefore has
**two expressions over one clock, crossed on the ADS blend**: at the hip a ROLL,
and aimed `cycle.wobble`, the same disturbance spent on where the rifle POINTS
as an offset that is a pure function of the phase and exactly zero at both ends
of it. **The aimed roll is zero including its travel along the bore**, which the
per-shot kick keeps and this may not: held for the better part of a second that
is EYE RELIEF, and it would pull the 6x eyepiece through the near plane.

**An optic's `eyeRelief` has to RISE with its magnification**, and the failure is
silent: the aimed stand-off is `eyeRelief * zoomComp`, `zoomComp` falls as the
magnification rises, and a number that buys 7.8 cm of eye at 3.5x buys 4.5 at 6x
— inside `CameraSystem`'s 0.05 near plane, which clips the eyepiece open and
turns the tube into a hole in the air. The same number sizes the optic
(`optics.ts` measures every dimension against `eyeDistance`), so the biggest
glass in the kit is the one held furthest from the eye, which is the honest way
round.

→ **[`docs/weapons.md`](docs/weapons.md)** — the report's five layers, the crouch
latch, the gloss ladder, the viewmodel's rendering group and pose stack, the
reload's four beats, the kick spring, the recoil pattern's two envelopes, the
bolt cycle's two expressions in full, the two slots, the head zone, eye relief,
and the procedural-model rules.
### Grenades

Everyone carries two and there is no resupply, so the pouch is refilled by death
and nothing else. **It is one of the two things in the game that are not
hitscan** — the anti-tank rocket is the other: one collision ray per grenade per
frame, a pool that **refuses rather than stealing a live slot**, and a blast
resolved against the **thrower's** target list fetched at detonation, so friendly
fire is excluded by construction as in `CombatSystem.fire`.

**There is ONE blast in the game and one set of numbers describing it.**
`blastAt` takes a `power`, the grenade passes 1 and is the reference exactly as
the rifle is for a weapon's `report`, and the tank shell is `blastPower` (1.85)
of the same eight layers — which is why ONE recording is every explosion in the
game, with `power` spent on it as playback rate (`docs/audio.md`). **`power`
scales SIZE and COUNT, never TIME**, because the order the layers arrive in is
what the effect is. **What a blast throws is
keyed on what it went off ON** — one downward ray reading the same
`metadata.surface` a bullet's impact reads — and `drawBlast` is the one place a
blast is DRAWN, public because the authority raises one with nothing but a
position on it.

→ **[`docs/grenades.md`](docs/grenades.md)** — the bounce, resting and terrain
backstop rules, the eight layers and the four rules holding them together, the
GPU cloud pool built twice (the one place a particle system may be spawned per
event), the throw timeline, and the bots' range band.

### The interface is five screens and the chrome

`src/ui/` holds one class per thing on screen, and `HUD` is not where a new one
goes — it owns **only** the gameplay chrome. Each screen builds its own root and
appends it to `#hud`, so construction order matters exactly once: `HUD` writes
`#hud.innerHTML` and is built first. **A class on `#hud` belongs to whoever
raises it.** **One stylesheet per module that writes markup, imported by that
module**, and `index.html` gets no interface CSS beyond the black background and
the boot screen. **A phone gets a sixth thing on `#hud`, and it is a DEVICE
rather than a screen**: `TouchControls` is polled by `InputManager` once a frame
exactly as a gamepad is, so nothing in gameplay has heard of it.

**Every screen is a LIST, and a list whose rows can change under the cursor keeps
its place by IDENTITY rather than by index** (the lobby is the one that can), and
**the way OUT is a button in its footer, never a row in its own list**
(`.ui-foot` / `.ui-back`). They are drawn in ONE FRAME anchored to the VIEWPORT,
**sized in `clamp()` over `vmin` with `--ov-scale` a safety valve rather than the
layout**. **A screen over another SCREEN is opaque and a screen over the SCENE is
not**, and **the PAUSE is the one card that does not take the screen**. **A ROW
OF PICKS IS A GRID OF EQUAL SHARES, NEVER A WRAPPING FLEX ROW** — a flex row
cannot be squeezed below its own longest word, so where it breaks is a
`flex-basis` tuned per viewport and a stranded button nothing but a screenshot
can catch; N items in `grid-auto-flow: column` are N equal shares at every width,
and a narrow viewport changes the COUNT rather than the break.

**The KIT screen's middle is a hole the real viewmodel is drawn through, and the
DOM MEASURES while the scene follows**: `LoadoutScreen.stageBay` measures that
hole every frame and `ViewModel` fits the weapon to what it is told, where the
weapon used to be placed from a constant that had to agree with a percentage in
a stylesheet — one possible layout, everything else squeezed beside it.
**Anything else that wants to place a 3D object against the interface owes the
same shape.**

**The menu stands on a PHOTOGRAPH of the map**, and `#menu-shot` is a root of its
OWN at z-index 9 rather than a child of `#overlay`, which would paint over the
veil whatever its z-index. **A map with no row in `mapShots.ts` is not broken.**
**Its scrim is the one in this interface that is DIRECTIONAL**, which the
shell's ellipse cannot be because the two demands are in different places; **the
dossier is therefore the one `.ui-panel` that is a BOX**, and **the menu is the
one screen with a one-column threshold of its own**. **The map row is a
STEPPER**, six maps in a segmented row of equal shares being `HOLLO…`, `GREYF…`,
`COLDH…` at every viewport a player has. **The entrance animation is keyed to
the card being RAISED** (`setCardClass`'s `raised`), never to its markup
existing — `showMenu` rewrites this card on every map step.

**The CHROME is sized by a UNIT, never by a transform** — a transform takes a
10 px caption to six along with the 46 px numeral it was aimed at. `hud.css` and
`minimap.css` are authored in a 720p window's pixels and state every size as a
multiple of a ladder in `base.css` (`--hud-u` for shapes, three bands of type,
`--hud-map` for the minimap), all `clamp()`ed over `vmin` so a desktop is
untouched. **A new size is a multiple, never a bare pixel**; **an INSTRUMENT is
exempt**, and the test is whether its size is a claim about the SCREEN (the
crosshair is the live spread, the gun marker is where the barrel points);
**`#hud.touching` is a TRIM on that ladder**, keyed on the controls rather than
the viewport, which is the only thing that gets a TABLET right; and **the
minimap is the one canvas that resizes itself**, redrawn at its box times the
device ratio rather than resampled.

→ **[`docs/ui.md`](docs/ui.md)** — the shell, the four cards as one class, the
menu's rail and the map schematic drawn from a LAYOUT, why **the pointer deploys
only through the Deploy button**, the deploy map, the kit screen's MEASURED bay
and the layout that buys, the settings panel, the lobby's row identity, the
gauges' metric and the four ladders, the short-viewport scaling, the portrait
fallback, and the touch controls as a screen — with
[`docs/pwa.md`](docs/pwa.md) for them as a phone.
### The scene has (almost) no Babylon lights

**Every shader in the tree is hand-written WGSL**, and `shaderLanguage` on a
`ShaderMaterial` or a `PostProcess` is load-bearing rather than declarative: the
default is GLSL and a defaulted one looks its source up in a store nothing
writes any more. **A sampler a material DECLARES must be BOUND, used or not** —
the bind group fails to build and the draw is silently lost — and uniforms are
the exact opposite, where unwritten reads as zeros.

Cel materials carry their own light as uniforms — key, ambient, sky fill and a
packed array of up to `MAX_POINT_LIGHTS` (16) point lights — and `LightingSystem`
is the sole owner of dynamic light. **Adding a `PointLight` or `HemisphericLight`
to the scene will not affect any cel-shaded mesh**; the one exception is
`ShadowSystem`'s `DirectionalLight`, which no material reads. **Nothing drawn
outside the cel shader gets fog for free, and everything that draws outside it
owes the same fade** `CelMaterialFactory.setEnvironment` publishes — nothing may
describe different weather from the wall it hangs in front of.

**The world carries a VERTEX COLOUR buffer and its neutral values are the GL
defaults, not ours** — baked occlusion in the **alpha**, a world marker in the
**green**, the wind's sway weight in the **red**, because a mesh with no such
buffer reads the disabled attrib's `(0, 0, 0, 1)`: unoccluded, not world,
planted. That is what lets the rigs, the viewmodel and every effect mesh stay
correct while carrying nothing. The bake (`world/vertexShading.ts`) runs **after
every merge**: `VertexData.merge` throws when one mesh in a group has `colors`
and another does not.

**There is ONE wind and everything that leans in it leans the same way** —
`CONFIG.wind`, clocked by `CelMaterialFactory.updateWind` beside the grass
field's clock rather than the shader's eye, because a pause that holds the world
must hold the canopy. **Anything a collider stands in for may never sway.**
**The ink's line WEIGHT is a function of distance and is not the same reading as
its fade**: `ink.width` takes the stroke's weight down with range while
`fadeBand` takes its darkness, a thin black line coming forward where a thick
pale one does not.

**The frame's ALPHA CHANNEL is TRANSLUCENT COVERAGE, and every shader in the
tree owes it.** The ink comes off DEPTH, and nothing alpha-blended writes depth
— a capture marker must not hide what it marks — so smoke and the objective
columns had the line work of whatever stood BEHIND them painted over the top of
them. Everything opaque writes **0** into that channel (`CelShader`'s
`opaqueAlpha`, a literal 0 in the grass and the water, and the clear in
`applyEnvironment`), every alpha-blended draw accumulates into it for free
(`ALPHA_COMBINE` blends alpha as ONE, ONE), and `CelInk` scales its edge by
`1 - a` and writes 1 back out. **A REFLECTION PROBE inverts it**: in a cube that
channel is the bake's own coverage mask, so `ReflectionSystem` flips
`opaqueAlpha` to 1 for the length of a bake, and **a shader that hardcodes
either value breaks one of the two passes silently**. **One blended mesh is the
exception and it is the one that WRITES DEPTH** — the kit screen's backdrop IS
the surface a pixel records, so it writes 0 coverage over the whole frustum
(`ALPHA_REPLACE_COLOR` at a fragment alpha of 0).

**Water is a MIRROR with a dark body under it, and it is SAMPLED FROM NOTHING** —
directional wave trains, no normal map, and re-adding one brings back four rules
that existed only to hide its lattice. The one thing that DISTURBS it is a
rotor: `washSite` is a short uniform array `RotorWash` fills and every body's
material is handed, so a hole straddling the seam between two rects is one hole
in one sea.

**The world is OPAQUE with exactly one exception, and it is glazing.** Glass you
can see THROUGH is `getGlass` over a cube `ReflectionSystem` bakes **one per
GLAZED BLOCK** — not one for the map, not one per material. Glass you cannot is
`Build.pane({ backed })`, which composites the mass behind it arithmetically and
therefore writes DEPTH; **it pays only if the pane is drawn first**, which is why
`Game`'s constructor sorts the opaque queue FRONT TO BACK, and **`backed` is a
claim about the WORLD that nothing throws over**. **No pane of either kind is a
shadow caster**, and see-through glazing writes no depth, so the ink does not
find it either.

**The frame WALKS the scene, and the scene is the map** — Babylon evaluates
every mesh in it every frame before it has decided anything, at ~1 us each, so
the cost is the map's AREA rather than what is on screen. `WorldCulling` holds
that down by **replacing `scene.getActiveMeshCandidates` and writing nothing
onto any mesh**: it never disables, never hides, never unpickles. That is the
load-bearing part rather than an implementation detail — a disabled mesh leaves
the shadow map's render list, a cube probe's bake and Babylon's own default pick
filter, and a candidate list leaves all three untouched. **A collider is never a
candidate at any distance**, **a mesh carrying `metadata.block` is one only
while the camera is inside the map's `fogEnd`**, **a body's RIG is one only
while the root the roster switches is enabled**, and **everything else always
is** — which is why the terrain, the roads and the rim carry no block: they are
what the SKY is behind. **Nothing pooled may ever be block-keyed**, and the rigs
are **filed mesh by mesh and never by ancestry**, because `RagdollSystem`
reparents a corpse's joints onto Havok proxies and an ancestry test would drop
every body in the game the moment it started falling.

**The GLOW layer draws the EMISSIVE meshes and nothing else, and what makes that
safe is that its occlusion is the FRAME's own depth buffer** (`GlowDepth`'s
`shareDepth`) rather than a whole-scene redraw in opaque black. **Do not put the
whole-scene render list back** — three attempts to narrow it by asking which
geometry matters to a bloom all failed (`FINDINGS.md` 3), the only honest answer
being a per-pixel depth test — and **read `GlowDepth`'s header before touching
the layer**: the schedule, the clear, the framebuffer rebind, the texture's
resolution and the REBUILD are five separate things that each fail SILENTLY, the
last of them on every `engine.resize()`. The hooks are re-installed by IDENTITY
every frame for that reason, and the depth share is keyed on BOTH of its ends.

→ **[`docs/rendering.md`](docs/rendering.md)** — the water's wave field and
mirror and the three ways a cube probe goes flat, the four light terms and the
colour buffer's three further rules, the ink's tint and the NIB it varies with
distance, the wind's two bounds, the muzzle-flash budget, the fog split, the
shadow window, the reflection bake's seven load-bearing details, the four
classes the candidate list sorts the scene into and what the cull measured, the
glow's own measurement, the painted sky, and the WGSL dialect's own traps.
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
map's because `installMap` is one synchronous turn that cannot contain a fetch,
`buildServerWorld` awaits it, and the editor writes through `map.terrain.field`,
which is that same object. `size * cell` must still equal the map's extent and
nothing typed can see the pair any more, so `build` asserts it in a DEV build.

**Eight things that read like global constants are the MAP's**, each defaulting
so that a map saying nothing is unaffected:

| the map's | default | what a map that raises it owes |
| --- | --- | --- |
| `MapLayout.size` — how big it is | `CONFIG.map.size`, 240 | its heightfield's `size * cell` must equal it (asserted in DEV), and the rim's boundary boxes must stay over 200 m so the seven sites keying on `w > 200 \|\| d > 200` still can |
| `EnvironmentSpec.fogEnd` — how far you can see | `FOG_WALL` | it is the reach `WorldCulling` walks to and the default for the row below; `audio.maxDistance` (70) and `bots.perception.engageRange` (55) did **not** move with it, so a clear map must be laid out knowing that |
| `EnvironmentSpec.bodyDrawDistance` — how far a BODY is worth drawing | its own `fogEnd` | resolved ONCE (`bodyDrawDistanceOf`, clamped to `fogEnd`) and pushed to `BattleSystem`, `NetRoster` and `RagdollSystem` together, which is what keeps `bots.lodDisableDistance` and `bots.death.maxDistance` one distance; a body it drops POPS. **A map's `fogEnd` is a distance from the EYE and a LANDMARK is a fixed thing in the world** — a fog wall chosen for the cull budget put Cinderhaven's volcano in flat `fogColor` from everywhere anybody played, and the fix was to buy the fog back and take the saving out of this row |
| `MapLayout.surfaces` — how deep it stacks | `CONFIG.nav.maxSurfaces`, 3 | only a map that stacks FLOORS raises it; overflow drops candidates silently (see the bots section) |
| `MapLayout.perTeam` — how many bodies a side | `CONFIG.bots.perTeam`, 8 | it is DENSITY, bounded by `CONFIG.bots.maxPerTeam` (24), and it is spent in RIGS — `BattleSystem.setRoster` rebuilds a CLIENT's pool when it moves. The squads and the scoreboard follow it; `CONFIG.conquest.tickets` deliberately does not, so a denser map is a shorter round. **It reaches a match too**: the authority's slot table is the ceiling, `setFielded` says how many a round fights, and the SEATS stay at sixteen |
| `MapLayout.blockSize` — how big a merge block is | `BLOCK_SIZE`, 48 | it is DRAW CALLS and cull granularity and nothing else; `ReflectionSystem.encloses` and `WorldCulling` follow it for free because they read the block KEY rather than a size, and the world layer's unit of LOCALITY (the physics buckets, the pane index) deliberately does **not** |
| `MapLayout.terrainBlock` — how big a floor patch is | `BLOCK_SIZE`, 48, **independently of `blockSize`** | a whole number of terrain cells, and the same value in all three callers of `terrainPatches` — `buildValley`, the server's `terrainColliders` and the editor's brush — or the two sides tessellate different floors |
| `EnvironmentSpec.lighting.shadowWindow` — how far its shadows reach | `CONFIG.graphics.shadows.frustumSize`, 110 | shadow length is `h / tan(elevation)`, and `shadowVisibility` is FULLY LIT outside the window, the last `edgeFade` of the volume ramping back to it — so an undersized one puts that transition on ground the player can see, and an OVERSIZED one moves it not at all while costing texel density (`ShadowSystem` DEV-warns) |

**A map is CLOSED one of two ways, and the second has no wall at all.** The rim
is four boxes at `±size/2` under `Ridge`'s escarpment. `MapLayout.borderland` is
the other: the floor carries on for a `margin` past the play square —
`TerrainField` continues the field, so nav, the roads, the grass and
**`server/validate.ts`** agree for free — and what stops you leaving is
`src/world/leash.ts`, a countdown rather than a shape. **It is sized by the
leash, it kills on the AUTHORITY and only draws on a client, and bots are never
leashed**, the nav graph stopping at the play square. **What a boundary is
closed BY and what it is closed WITH are two questions**: `RidgeSpec.form` takes
`none` for a map that has laid something out there already, an ISLAND stating
its horizon in water instead.

**The shipped maps are Hollowmere** (a night village), **Greyfen** (a jungle
valley), **Coldharbour** (a business district — what the first three overrides
exist for), **Harrowmead** (`size: 400`, no wall around it), **Sarab**
(`size: 900` inside 1500 m of ground — a desert town, and the map
`ENGINE_UPGRADE.md` exists for) **and Cinderhaven** (`size: 1500` inside 2000 m
of ground and 4,600 m of sea — a harbour town on a volcanic island, at night,
the biggest map in the tree and the only one with no rim at all). **The last
four are the four with vehicles on them**; **Sarab and Cinderhaven are the two
with all THREE KINDS and the two that are not 8v8**, both fielding 24 a side
online and off. Both were **SEEDED by a generator** (`npm run sarab`,
`npm run cinderhaven`) rather than typed, and the emitted `layout.ts` is an
ordinary layout file the editor opens, patches and saves like any other —
re-running the generator discards editor edits. **Sarab is the map that SPENDS
the levers**, stating six of the eight rows above, and the first to state a
`ParticleSpec.volume` — the mote field emitted around the EYE, without which
`count` is a density that scales with a map's AREA.

**Cinderhaven's rules are general rather than details of that map.** **Its FLOOR
IS THE LEVEL** — what is land, where the sea goes and which slopes sever their
own nav links are one continuous function — and **a WATERFRONT IS DERIVED FROM
THE FLOOR rather than authored against it**, the generator marching the finished
ground outward to find where it actually crosses the sea and placing the quay a
stated setback inland of THAT, so the shore may move without a coordinate going
quietly wrong. **A `WaterRect`'s reflection probe stands at the depth-weighted
centroid of its WET cells** (one rect over an island bakes a probe inside a
mountain), and **a SEAM between two rects is where the mirror CHANGES**, so a
partition must not put one where anybody looks across it; **a rect's bed map is
512 texels a side however big the rect is**, so widening one that carries a
shoreline spends that coastline's resolution on empty sea. **There is no
swimming in this game**, so water anybody must cross is walkable and everything
else is made steep enough to sever. **A FORESHORE has to be as long as the
ground behind it is high**, or the same beach that links on a 10 m shelf is a
severed shoreline against a 26 m apron. **A MAP FEELS LIKE A PLACE BECAUSE OF
WHICH BUILDINGS ARE ON IT, NOT HOW MANY** (`src/world/kit/harbour.ts`), and **a
landmark needs an INSIDE** — what lets the Cinderworks be both is that its
height is a CHIMNEY rather than a room. **AND A ROAD NETWORK IS MEASURED, NEVER
REVIEWED** (`npm run cinderhaven -- --roads`): a quarter laid off the network
still builds and still reads as a town from above, so **that failure has no
symptom in a screenshot**.

**A ROAD is visual-only and rejects exactly one thing, which is anything that
GROWS** (`world/roads.ts`, `GameMap.roads`): `MapBuilder` sows no
`PropBody.rooted` prop on a carriageway and `GrassSystem` no tuft. It is a
per-PROP fact rather than a per-region flag, because a street is where rubble,
cones and litter belong — and **what is sown there stands on the ROAD** rather
than on the floor under it (`roadTopAt`). **Any change to a placement rule
re-rolls the seeded dressing field**, so it owes `npm run collision` and `npm run
parity` — the staleness guard hashes the LAYOUT and this kind of change is in
the BUILDER.

**Where two roads CROSS, the SURFACE decides which one is the ground, and it
decides by HEIGHT**: `ROAD_RANK` (dirt < cobble < asphalt) lifts a carriageway
two millimetres per rank, because coplanar sheets in two meshes are a per-pixel
tie whose winner changes as the camera moves. **The rungs are tiny because a
road is a sheet OVER the floor and almost nothing else knows it is there** — a
bullet's dust disc clears the ground by 20 mm and is the tightest of them. Do
not give two surfaces one rank. **That ladder settles a CROSSING and cannot
settle the FLOOR**, being spent by ~100 m against the depth buffer's own step:
`ROAD_DEPTH_UNITS` (-8) is a polygon offset in the buffer's OWN units, carried
by the BUILDER (`Build`'s `depthUnits`) so a slab and the paint on it move
together, and **part of the material CACHE KEY** — one hex at two biases is two
materials, or a car's underbody rides off the ground. **A road is not inked and
needs no rule to stop it**: `CelInk` finds an edge where depth STEPS or BENDS,
and two coplanar sheets do neither.

**There is a sixth entry in `MAPS` and it is DEV-ONLY and not a level.**
`src/world/proving/` is the generated load `ENGINE_UPGRADE.md` S0 measures
against, written by `npm run proving`. **`MAPS` is an `import.meta.env.DEV`
ternary and must stay one**: that fold is the only thing keeping 900 kB of it
out of both bundles, and a `push`, a `filter` or a `const dev =
import.meta.env.DEV` one line up would silently stop working.
`scripts/check-proving.mjs` enforces that on the end of `npm run build`, over
`dist/` and `dist-server/` both. **It has a collision bake, so the AUTHORITY
runs on it too** — `DEV_MAPS` in `scripts/collision-hash.mjs`, kept out of the
`MAPS` beside it because `npm run parity`'s server half is a production build,
and reached through `npm run simulate:dev`.

→ **[`docs/world.md`](docs/world.md)** — the eight overrides in full, the
heightfield and the road slabs cut against it, the winding trap that makes a
floor vanish, the builder and two-pass merge rules, the harbour kit and the
island's floor, the road ladder's arithmetic, the layout gotchas that have
already cost time, the valley rim's contract with the sky, and the borderland,
the two rim forms and the leash.

### The map editor (dev only)

`F2` in a dev build opens `src/editor/`: free-fly the real scene, click to
select, drag gizmos, edit properties, sculpt terrain. It is reached through **one
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

The single most load-bearing rule in the world layer. Every ray test filters on
`metadata.solid === true` — `CombatSystem`'s hitscan (every shot),
`BattleSystem`'s LOS, the grenade's step ray, the death cam's pull-in — and
`moveWithCollisions` walks every mesh with `checkCollisions`. At village scale,
visual geometry must stay out of both.

**The ground under a body's feet is the one question no longer asked with a
ray**: `Player.probeGround` reads the `WorldBox` list through
`ObstacleField.groundAt`. So a collider that skips `collider()` is invisible to
the FLOOR as well as to navigation, and anything SOLID that MOVES owes the probe
a query of its own, because the boxes are baked once at map load —
`Vehicle.deckAt`, and only that.

| Kind         | visible | pickable | collides | `solid` | merged | frozen |
| ------------ | ------- | -------- | -------- | ------- | ------ | ------ |
| **Visual**   | yes     | **no**   | **no**   | —       | yes    | yes    |
| **Collider** | **no**  | yes      | yes      | yes     | no     | yes    |

Colliders must line up with the surfaces they stand in for or bullet sparks land
off the visible geometry. `MapBuilder.collider()` is the only place that creates
them, and it also records a `WorldBox` for the nav grid — geometry added by any
other path is invisible to navigation.

**A collider answers two questions and they can disagree, which is why there are
two of everything below and not one.** *Where may a body be?* is
`RayWorld.castBody` — the death cam's pull-in, a tank's chase camera, the
dismount's floor test — and `SOLID_ONLY`, the mesh predicate the same question
still wears for the editor's centre-screen pick. *What stops a round or a look?*
is `RayWorld.castRound` and its any-hit twin `blocked` — the hitscan and its
wall cap, the bots' and the aim assist's LOS, the grenade's step ray and its
blast check, the rocket. So a collider is one of three things, and a builder
picks which by how it declares the box:

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
predicate — rather than a term every ray in the process evaluates.
`WorldBox.glass` exists only for the readers that must SKIP a pane rather than
merely pass a round through it: `CoverMap`, the AO bake, and the collision bake.

**NO RAY IN THE GAME PICKS A MESH ANY MORE, and that is the load-bearing part
rather than an optimisation.** `scene.pickWithRay` filters `scene.meshes`, so it
was priced on how big the MAP is rather than on how far the ray goes
(`FINDINGS.md` 22). All eight sites are answered analytically now, by
[`src/world/RayWorld.ts`](src/world/RayWorld.ts), off `colliderBoxes`, the strut
groups and `TerrainField` — the same geometry the colliders were built from, and
exactly the substitution that retired `Player.probeGround`. **`map.rays` is
where a system gets it**, beside `nav`, `cover` and `obstacles`, and the
authority builds one off the bake. A NEW RAY GOES THERE; nothing may reach for
the scene.

**…and the ONE whole-scene walk that survived that is `moveWithCollisions`,
which is narrowed rather than replaced.** It MOVES a body instead of answering a
question about one, so no analytic query stands in for it — and Babylon walks
`scene.meshes` for every call **and again for every retry**, which priced a body
on the map's size exactly as a pick did, and worst at the moment it is pressed
against something. **There are exactly TWO sweeps in the game and both go
through `narrowedMove`**: `Vehicle.update` for a hull and `Player.update` for a
body on foot. `map.collidables`
([`src/world/CollisionField.ts`](src/world/CollisionField.ts)) is `rays`'
counterpart — the same collider set bucketed as MESHES — and a body hands the
answer to Babylon's own `surroundingMeshes`. **The saving is only sound while
that list is a SUPERSET of what the sweep can reach**, so the reach is the
sphere's radius plus the whole step plus a margin, the centre is
`getAbsolutePosition()`, the order is the scene's, and `narrowedMove` CHECKS the
promise and re-runs the whole walk when a sweep outran it. **A THIRD sweep goes
through `narrowedMove` too, or it is a body walking the whole map.**

**Colliders are still MERGED, and the grouping is now data rather than a
performance trick**: nothing in gameplay picks a mesh, but the bake carries the
grouping to the server and `rayGroups` is how the struts reach the queries at
all. `MapBuilder.struts` merges a placement's struts into one mesh; every
BLOCKING SCATTER collider is merged by LOCALITY instead
(`MapBuilder.clusterColliders`), one mesh per 12 m square over the whole scatter
pass at once, because a scattered field has no placement to merge by and the
regions overlap. The boxes stay in `colliderBoxes` one per prop, so nothing
derived from geometry can tell; **only plain `solid` boxes may be grouped**, and
the grouping rides to the server as `MapCollision.boxGroups`.

**A blocking scatter prop may not stand on a control point or a spawn**, and
`MapBuilder.keepClear` refuses it rather than the layout dodging by hand — a
flag inside a collider cannot be captured and sinks its own flow field.
Non-blocking props are exempt: a fern over a capture point is dressing.

**The floor is the one documented exception**, and it proves the rule rather than
bending it: the heightfield has no box that could stand in for it, so each block's
collider is an invisible *clone of the visual's vertex data* — same shape, two
separate meshes, only the clone marked `solid`. It emits no `WorldBox` and
`NavGrid` reads `TerrainField` directly. It is also the only `solid` mesh with
`checkCollisions = false`: `moveWithCollisions` is horizontal-only, vertical
placement is the ground probe's job, and bots never touch the collidable list.
### Mesh metadata is a contract

Seven flags and two values, all read elsewhere; new geometry that omits them
misbehaves silently:

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
  adding a fourth: an emissive part is masked out by `glow.mainTexture`
  (`ink.emissiveMask`), a viewmodel part is scaled down by the near-depth band
  (`ink.near`), and a coplanar decal — a road dash, a blob shadow, the capture
  ring — produces no depth step and no bend, so the pass never finds it. The sky
  writes no depth at all. It was called `noOutline` while an inverted hull read
  it; **it is deliberately absent now from grass, water and both debris pools**,
  which the ink does draw on purpose.
- `noGlow: true` — excluded from the `GlowLayer` in the `Game` constructor. Only
  meshes existing at construction time are scanned. A mesh that stays in bloom
  is faded with distance instead (`customEmissiveColorSelector`), and
  `infiniteDistance` is that fade's one exemption — it is what every sky mesh
  sets, and the moon is not in the valley to be fogged out of.
- `noShadowCaster: true` — excluded from `ShadowSystem.setCasters()`. Flat receivers
  (ground, roads) need it: casting from them is pure shadow acne.
- `block: "3,2"` — which map block a merged visual came from (the block's side
  is `MapLayout.blockSize`, 48 m by default). A **value**,
  like `surface`, and **absent on everything that is not block-merged — the
  terrain, the roads and the rim**, which is what keeps the landform out of
  both tests that read it. Written in three places and they must agree:
  `BlockMerge.finish` and `PaneBlocks.finish` for the glazing hung on the same
  building. **Two readers.** `ReflectionSystem.encloses`: a probe drops its
  own building from its bake, and since the albedo palette took the colour out
  of the merge key there is no longer any geometry-shaped way to ask which
  building a mesh IS. And `WorldCulling`, which files every mesh carrying one
  into a cull cell — see the rendering section.
- `surface: "ground"` — what a round that stops here kicks up. The odd one out:
  it is a **value with a default**, not a flag, and **absent means `"hard"`**.
  `MapBuilder` sets it on exactly one thing — the terrain floor's collider clone
  — so every wall, prop and roof in the village answers by omission and a new
  collider needs no thought at all. Read by `CombatSystem` to pick the impact's
  spark, its dust disc and its sound. Adding `"wood"`/`"metal"` is one member of
  `ImpactKind`, one row in that file's `IMPACTS` table, one arm in `Sfx.impact`
  and a `surface` argument on `collider()`; no signature in between moves.

### Bots: navigation, scaling, perception and squads

**How many bots there ARE is the MAP's on both sides** (`MapLayout.perTeam`, 8
everywhere but Sarab's 24), and the two sides spend it differently. On a CLIENT
the rig pool IS that roster and `BattleSystem.setRoster` rebuilds it when the
number moves — from `buildRound`, never from `installMap` — which is the one
place "built once and never disposed" bends. **The AUTHORITY builds the ceiling
once** (`CONFIG.bots.maxPerTeam` a side, because a slot index is a bot index and
a match rotates maps under one slot table) and `setFielded` takes the surplus
out of each round, which is the third reason a bot can be `aside`. **Nothing
else in this layer may know a size**: the squads, the radio's boards, the squad
orders and the skill draw are all grown from the pool they are handed, and the
think budget from the number of bodies actually in the round.

`NavGrid` is built from the finished collider set at map load, and its node is a
**surface** — a (cell, height) pair — not a cell. The cap is
`CONFIG.nav.maxSurfaces` (3) unless the map raises it, and overflow **fails
silently: the candidate that does not fit is DROPPED, in arrival order**, which
makes a BUILDER's collider order part of the design — walked surfaces first,
cover next, roofs last. **A surface ID is `cellBase[cell]` plus the slot, never
`cell * maxSurfaces + slot`** — `CoverMap` and the editor index the graph's own
arrays with it, and re-deriving the retired stride form addresses the wrong spot
in silence. One flow field per objective is precomputed and nothing is
recomputed: **bots read `nav.steer()`, never run their own pathfinding, and
never use `moveWithCollisions`**. `ObstacleField` is the sub-cell half, and its
push-out is a preference, never a veto.

**Three things carry the frame budget and undoing any costs ~10x draw calls or a
permanent hitch**: the rig pool is built once per roster size and never disposed
inside a round, a rig is nineteen merged meshes, and AI is staggered round-robin
at `CONFIG.bots.thinkRate`. **Everything a bot notices without seeing it is
ray-free by construction** — cover is baked, never probed, and skill is one
scalar drawn **per squad** from a seeded generator.

**Cover is baked as three nested masks and a query answers with a KIND**, each
height being a hit SPHERE's top and never an eye height. **A bot's crouch is one
decision re-made every frame and one eased blend read by everything else**, and
the eye and the hit sphere come down together or the stance makes a body easier
to kill. **A team's bots tell each other two things, and both are CUES that may
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
(the game renders in every state, so a scene-driven step would tumble corpses
under the pause card) and Havok never touches a rig node.

**The engine is required and there is no fallback.** A full pool **evicts the
oldest corpse** rather than refusing, which protects the death cam's body for
free; **one refusal is left, a death past the fog wall**, where nothing is drawn.

**A round DROPS a body and an explosion THROWS it**: a round is a
newton-second on the chest, a blast is a SPEED given to every bone at once, and
how far it flies is the falloff-scaled `deathDamage` the corpse already
recorded — so a blast's `power` stays the size of the PICTURE and nothing has to
be kept in step with it. `DamageKind` picks, and the test is "not a bullet".

**`PhysicsWorld` owns the engine and no client owns any of it.** It is INJECTED
into `RagdollSystem`, `DebrisSystem` and `BlastDebrisSystem` by `Game` — the
`BattleSystem`←`CombatSystem` precedent — and `Game` steps the engine and *then*
its three clients, never the other way round.

`dying` is a **step in the state machine, not a lid**: `updateWorld` runs in full
underneath the death cam, so the tickets bleed and your killer walks past while
you watch — and it costs no time, because `enterDeploy` is opened with
`respawnDelay` minus what the shot already spent.

→ **[`docs/deaths.md`](docs/deaths.md)** — the boot gate and what the optional
version cost, the pool's three tiers, the quaternion leak that freezes a
respawned bot, the fog-wall gate shared with the LOD, the shard pool, and the
death cam's camera hand-off.

### Vehicles: three kinds, one hull, and the exceptions it is

**A vehicle is a `Combatant` you get INSIDE, and TWO people fit.**
`MapLayout.vehicles` is one hardstanding per vehicle — absent on two of the six
maps — and `Game.driving` plus `Game.drivingSeat` are the two facts the feature
turns on. **There are THREE KINDS and no code that knows it**: a fourth is a row
in `VEHICLE_KINDS`, a block of numbers and a model file, and **no `if`
anywhere** — the moment a system asks which kind it is holding, that is broken.
**TWO capabilities stand in for that branch**, each one nullable block in the
spec resolved once into one boolean, and the boolean is what every reader puts
instead: **`Vehicle.armed`** (the trigger, the HUD's loader row — ABSENT, not
dimmed — the gun marker, the authority's rate gate) and **`Vehicle.flies`**,
which ten readers ask, from the wire's altitude to the shadow focus.

**There is no player model in this game, so nothing on a vehicle may promise a
body standing at it**, and nothing may stand on a roof inside a gun's sweep.
**The two seats are `DRIVER` (sticks + main gun) and `GUNNER` (the cupola gun
and nothing else), and the first man aboard DRIVES**. **The verbs are `E` to
board and `F` to cross** (and two buttons that APPEAR on glass, which
`Game.offerUse` is the one door to name); **both turn a BOT out of the chair
they reach and neither ever moves a PERSON**. **A driver's frame is not a
body's**: `Player.update` is not called, so the hull's ground REPLACES the
probe.

**A hull is the one MOVING `solid` mesh in the game**: in both pick predicates
and carrying `checkCollisions`, but emitting **no `WorldBox`** — so the nav
graph, the cover bake, the obstacle field and the collision bake have never
heard of it, and **bots walk through a parked tank as they walk through a
corpse**. **Anything picking a hull out of its own way owes two property writes
rather than a predicate** (`world/solid.ts` forbids minting one). **It is also
the one TARGET answered by its collider rather than by a hit sphere** —
`RayHit.hull` says which hull a cast stopped on,
and **nothing reads `Vehicle.hitRadius` any more** — **which is why a hull's own
ROUNDS leave that collider out too** (`ShotOptions.fromHull`, stated on the GUN
rather than at the trigger).

**A hull drives over PEOPLE**, which is what `Game.crushSweep` is
(`HeadlessGame`'s is the authority's twin, and both run right after
`VehicleSystem.update`): a tank is in no baked structure, so `moveWithCollisions`
sweeps the HULL out of the world rather than a body out of its way. **What a hit
is worth is a `DamageKind`** — the third parameter on
`Hittable.takeDamage`, which only a tank reads, against
`CONFIG.vehicles.tank.resist` — and `"crush"` is one no round carries. **The
reticle still cannot lie**: the look is an ORDER the turret walks toward, the
shell goes down the GUN's axis, and **everything else on the hull that moves is
a PICTURE** — the collider never tilts and nothing on it is pickable.

**A GUNNER may put a SIGHT up, and it is the one thing in a hull that reads the
player's ADS** (`Game.opticUp`): the eye goes to the optic head the model
already draws (`VehicleRig.mgSight`) and the view is slaved to the gun, so the
marker becomes the reticle. It is a question about the SEAT and never about the
kind, and `CameraSystem.place` takes the FIELD as a third argument for it. **A
chase camera's look point may never sit on its own eye ray** — those three were
collinear, so every hull sat dead centre whatever the framing claimed;
`CONFIG.vehicles.frameLift` is an ANGLE that fades out as the view looks down.

**BOTS CREW BOTH CHAIRS, and a crewman is not a bot with a vehicle attached.** A
crewed bot leaves `Bot`'s FSM entirely — **`BattleSystem.aside` is the one skip
test every loop over `bots` owes**, never `benched.has` — while keeping its
LIFE, its POSITION slaved to the hull and its SQUAD'S ORDER. **BOTS FLY IT**
too, on a bearing and a HEIGHT, and **a flow field's bearing is not an order a
pilot can fly**.

**ANY world position read off a node on the AUTHORITY owes a forced world
matrix, and the failure is invisible on a client**, whose render walk writes one
every frame. A node that is merely MOVED does not report itself out of sync, so
its FIRST read is what it returns for the life of the process.

**A hull is HEARD whoever is in it**, pushed per FRAME by `Game.pushHullEngines`
rather than opened on a mount, and **what drives the voice is asked of the HULL**
(`Vehicle.powerplant`), so the second powerplant needs no branch either. **A
MACHINE THAT HOLDS ITSELF UP BY MOVING AIR MOVES THE GROUND WHEN IT GETS NEAR
IT**: `RotorWash` spawns and schedules nothing, and **the hull answers what it
is doing to the ground** (`Vehicle.washTo`) exactly as it does for the voice.
**A colour GRADIENT changes a particle system's VERTEX BUFFER LAYOUT, so one may
only be added before that system's FIRST RENDER.** **A frame that did not STEP
the fleet owes `Sfx.enginesOff` and a wash of zero** (`Game.fleetStepped`,
**read ONCE**: a one-shot flag with two consumers is one whose second reader
gets nothing).

→ **[`docs/vehicles.md`](docs/vehicles.md)** — the three kinds and the two
capabilities between them, each trade and each model; the seats, the swap and
the crew of two; the pilot's held bearing and the flight model under it; the
collider's three answers; the crush's gates and skips; the gunner's sight, where
its eye comes from and the framing bug it found; the two engine voices and
the rotor's dust, spray and ripple; the plank, the climb and the leading-end
sphere; the damage kinds, the shell, what a map and its GENERATOR owe, and what
is not built.

### Anti-tank: the third slot, and the only thing a hull is afraid of

**The kit has a third slot on maps that have armour, and nowhere else** —
`Game.armourOffered` is one `MapLayout.vehicles` entry, online and off. A
slot that is not there is not one that is empty: the kit row, the HUD line and
`Player.slots[2]` are absent. It holds a LAUNCHER or two MINES, never both,
because the choice is the feature.

**An AT item is CARRIED as a weapon and RESOLVED as nothing like one.**
`equipmentSetup` hands back a plain `WeaponSetup`, so the holster, the draw, the
swap, the rig and the trigger gate need no teaching — and every field that would
make it a gun is a constant saying it is not, **`reloadTime` included**: no
resupply, and the pouch is refilled by death exactly as the grenades' is. **The
launcher is nonetheless LOADED on screen, off the fire cooldown rather than off
a reload** — on a two-shot weapon that cooldown IS the loader — and it is a
MUZZLE load, so the round is fetched and pushed back down the bore rather than
dropped and replaced. `Player.loadProgress` is the whole of its state, and
**`Player.loading` is the one question anything else asks** — a magazine going
into a well OR a rocket going down a bore, which is what stops the sprint. The
MINE is exempt by `muzzleLoad`: its cooldown is a placement rate, not a
gesture.

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
makes the whole of the update incremental rather than merely cheap**: the graph
only ever GAINS links, so a route that was valid still is and no step count in a
flow field can rise. `NavGrid.openBox` therefore relinks the ground AND relaxes
the seven fields over it, in the frame the pane broke and for a cost bounded by
what the break opened. It used to re-SWEEP them instead, one field per frame, and
that was the wrong axis to amortise on — a sweep is priced on the map, so at
1500 m one pane cost seven consecutive 40 ms frames. **Two rules keep it honest**:
monotonicity is a claim about the LIST `openBox` re-severs against, so every
CLEARED pane must come out of it and not merely the one breaking (or a second
break in the same frontage puts the first window's wall back); and the fields
belong to `openBox` rather than to its caller, because a caller that has to
remember them can forget them, and the authority did — `HeadlessGame` never
drained the deferral at all.

**A round has to pass THROUGH glass, so a pane can never stop a `castRound` —
which means the hitscan's wall query can never report one.** `CombatSystem.fire`
raises `onShotPath` with the segment the round flew and `GlassSystem` answers it
analytically; the same code runs on the authority, off the collision bake. **A
pane's index in `GameMap.panes` is its identity** on both sides and on the wire,
`npm run parity` proves both build the list in the same order, and breaking is
the AUTHORITY's. **A pane is see-through, a FAIRNESS rule and not a look**:
`castRound` already lets a bot shoot through a window.

→ **[`docs/world.md`](docs/world.md)** for the builder's side and
**[`docs/multiplayer.md`](docs/multiplayer.md)** for the wire's.

### Conquest rules

`ConquestSystem` owns flags, the capture meter, tickets and bleed. The meter runs
-1..+1 and ownership flips only by crossing 0, so a flag must be neutralised
before it changes hands, and occupancy is counted from the combatant list `Game`
assembles each frame. The player's health regenerates after
`CONFIG.player.regenDelay`, without which the round is a respawn queue.

**A round is SCORED as well as counted, and the score is not the kills.**
`ScoreBook` is one ledger per simulation — one row per roster SLOT, held by
`Game` offline and by `HeadlessGame` on the authority, so the two boards cannot
drift — and **the two payout rules are one function each, in that same file,
called by both simulations**: `awardKill`, keyed on **the flag the VICTIM was
standing in, never the killer's own position**, and `awardZone`, which pays
everyone of a side standing in the flag at the moment its meter moved. Neither
may be written out a second time on either side — the failure of a second copy
is not a crash but a quiet disagreement, where a player learns a scoring rule
in practice that the match they take it into does not run.
**`ConquestSystem.onCaptured`/`onNeutralised` are the SIMULATION's callbacks on
both sides**, so taking the conquest callback directly (as `npm run simulate`
did) silently turns the capture awards off.

**A capture zone is DRAWN, not just counted** (`CaptureZoneSystem`, plus
`HUD.setCapture`), and the one rule reaching outside the drawing is that **the
ring is the boundary**: it is built at `ControlPointDef.radius`, which is what
`pointAt` tests, so the line on the floor is not an approximation of the zone.

→ **[`docs/rendering.md`](docs/rendering.md)** for the ring's surface sampling
and the markers that fade themselves out, and
**[`docs/multiplayer.md`](docs/multiplayer.md)** for the score on the wire.

### Measuring a frame

**The frame profiler SHIPS, and that is the whole feature rather than a
compromise.** The frame is draw-call bound on hardware nobody here owns, and the
devices worth measuring — a phone on a home screen, a tablet, somebody else's
laptop — are exactly the ones that will never run a dev server or open a
DevTools window. `FrameProfile` is therefore armed by a **setting**
(`Settings.profiler`) or by **`?profile`**, never by `import.meta.env.DEV`;
disarmed, every entry point returns on its first line and the ring is not
allocated. Armed, it costs under 1.5% of frame rate, and the probes that say so
run on the DEVICE and land in every capture.

**It records CONTINUOUSLY and the capture reaches BACKWARDS**, because you
cannot watch a graph while playing a first-person shooter with two thumbs: the
ring holds `CONFIG.profiling.frames` and the gesture is pressed AFTER the hitch
(`F3`, or the chip's buttons on glass). **Nothing allocates PER FRAME while it
is recording** — no per-frame object, no label string, no closure — because
`FINDINGS.md` §1's leading suspect for the hitch this exists to find is GC, and
a profiler that allocates per frame manufactures the bug it was built to catch.
**What a hitch IS is relative**, a fixed bar degenerating on the device this was
built for; the bar and its floor are in every report, as is the GC count the
`FinalizationRegistry` sentinel puts on every frame.

**The brackets live in `Game.ts` and nowhere else, with one exception that is
INSIDE the render.** `tick`, `updateGameplay`, `updateNetWorld` and `updateWorld`
are where the frame's order is already declared, with the argument for it
written down, so **the phase list IS that order** and no system had to be taught
the profiler exists. A phase is a name in `PHASES`, a parent in `PARENT_OF` and
a `begin`/`end` pair; the ring, the report and the trace are all sized and
labelled off that list. **The spans NEST and do not partition** — read a report
as an attribution. The exception is `render`, where there is nowhere in
`Game.ts` to put a bracket inside `scene.render()`:
`FrameProfile.hookRender` hangs four spans off the SCENE's own observables when
the profiler arms and takes them off when it disarms, so no system knows about
those either. **What they measure is CPU**, and under `compatibilityMode =
false` that is the recording of a render BUNDLE rather than the work the GPU
then does. **GPU time is not here** — Babylon can read it, but only if
`timestamp-query` is requested at device creation, and `main.ts` calls
`initAsync()` with no descriptor.

**A capture is READ at `/profile_viewer.html`**, one import-free, network-free
page in `public/` served from the game's own origin, because the loop has to
close on the device that is slow. The chip's `VIEW` button hands the report over
through `localStorage` and opens the page: same origin, so no clipboard, no
file, and nothing leaves the device. **That path is spelled in THREE places** —
the file in `public/`, `sw.js`'s `DOCS`, and `ProfileChip`'s `VIEWER_PATH` — and
**every way of missing one fails silently**; it is the SECOND navigable
document, so a path missing from `DOCS` works online and silently becomes the
game offline, which is the one case it exists for. **The capture states its own
phase tree** (`ProfileReport.tree` from `PARENT_OF`, typed so a new phase does
not compile until it names its parent), so the reader is never guessing this
build's nesting.

→ **[`docs/profiling.md`](docs/profiling.md)** — the phases and what each one
covers, how to take and read a capture, the viewer and the three rules for
editing it, the relative hitch bar and what it was measured against, the
sentinel and the heap probe and how to read a hitch against them, the three
limits recorded into every capture, the trace export and Perfetto, what
`frame`'s own share means, the three-rung clipboard ladder, and the levers
(cross-origin isolation, `timestamp-query`) that are deliberately not in it.
### The installable app

The build installs to a home screen and launches fullscreen, landscape and
offline. Four files carry it — `public/manifest.webmanifest`, `public/icons/`,
`src/pwa/register.ts` and `src/pwa/sw.js` — and nothing in the game knows any of
it exists. **There are TWO navigable documents now**, the game and
`public/profile_viewer.html`, and a navigation is answered with the shell unless
its path is in `sw.js`'s `DOCS` — a second page not listed there works online
and silently becomes the game offline. Three rules are about the DEVICE rather than the game: a tap arrives
twice (the second as a synthesized mouse event, disbelieved for
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
launches, and the phone-shaped details (fullscreen on the document element,
`--ov-scale`, why `#loadout` is excluded from it).

### Multiplayer: the server is the authority, and a slot is a slot

A dedicated Node process runs the real simulation under Babylon's **NullEngine**
and clients render it; there is no host client. A shooter's hitmarker is a
**guess** — every target is rewound and `CombatSystem.fire` runs again on the
server, the only thing that deals damage. **A client predicts its own MOVEMENT,
its own health regeneration and — in a hull — its own DRIVE**, each validated on
arrival; everything else a client steps is DRESSING.

**The slot table is forty-eight slots, built once, never resized or reordered**
— `CONFIG.bots.maxPerTeam` a side, on every map, because a match rotates maps
under ONE table. **What the map decides is the ROUND**: `MapLayout.perTeam`
reaches the authority through `setFielded`, so Sarab is 24v24 online as well as
off. **What the map may never decide is the SEATS**, which stay at sixteen — the
smallest roster in the rotation, so a rotation takes bots off the field and
never a person out of a seat. Every slot nobody is sitting in is a bot: a human
joining BENCHES the bot in their slot and leaving un-benches it. **Benching is
not killing** — joining and leaving must never charge a team a reinforcement —
the bench lives in `BattleSystem` as a `Set<Bot>` and never as a flag on `Bot`,
**every loop over `bots` there must skip it** (through `aside`, which also
covers a tank's crew), and **a slot index IS a bot index**.

**…AND A MATCH MAY BE CREATED WITH NO BOTS AT ALL**, which is `MapLayout.perTeam`
reaching a round as ZERO rather than a new kind of absence: `Join.bots` is
`Join.map`'s twin — additive, and stated as a NEGATIVE read as `!== false` so a
field nobody sent falls through to the game everybody had — and nothing
downstream had to be told, the target lists, the squads, the tickets, the board
and a hull's crews being already written against `aside`. **The SEATS are
untouched**, which is why this is the one place the wire's "how many slots hold
a BODY" and the simulation's "how many bots are in the fight" stop being one
number (`Match.fieldedSlots`). **An empty slot is STATED and not read** — it
goes out as `dead: 1`, or a leaver's last standing frame is in the street.

**Four things arrive from the authority and may only be written through their one
funnel**, because a client that decides any of them for itself is playing a
different game in the same window: the local player's **team**
(`Game.applyPlayerTeam` — balance seats the second person on team 1, so a
hardcoded 0 turns every mine/theirs question backwards), the match's **map**
(`Game.applyMatchMap`; `Game.setMap` is the *player* choosing, never written from
the wire), a **body coming into the world** (an ASK), and the **scoreboard**.

**The server cannot run `MapBuilder`**: it has no canvas, so `DynamicTexture`
throws. It rebuilds the solid world from the generated
`src/world/<map>/collision.ts`, including each box's `porous` flag, so **`npm run
parity` should be run after anything touching the world layer**. `npm run build`
refuses a bake older than its layout, but that guard hashes the LAYOUT — a flag
changed in a builder needs `npm run collision` by hand.

**A STANCE is state and what travels is the authority's own blend**, and **each
sound cue comes from whichever side actually knows** — including the crack of a
round going past, which is ADDRESSED to the one player it happened to rather than
broadcast, because a broadcast is the read a wallhack wants.

**What armour puts on the wire is decided by how often it CHANGES**: hulls every
snapshot, rockets when one is flying, mines as a versioned table re-sent only
when the SET moves. **A driver reports a HULL instead of a body** —
`DriveMessage` replaces `MoveMessage`, which is what `validateDrive` is for —
and **a GUNNER reports one BEARING**, because a man on the cupola gun moves
nothing at all and there is therefore nothing to validate.

**`validateDrive`'s bounds are TWO KINDS OF CHECK and every one of them is
ANSWERED.** Speed and climb are things no legitimate client produces, so they
are REFUSED; the map's extent and a flying hull's ceiling are rules the client
enforces too and presses against on purpose, so they are LIDS — the step is
taken at the boundary and the client is told where it ended up. **The ceiling is
a RATE and not a HEIGHT**, a machine crossing ground that falls away being
legitimately far over it. **And a refusal may never be SILENT**: the one hull a
client does not pose from the wire is the one under its own driver, so nothing
else can pull a refused one back and one refusal latches for the round.
`hullcorrect` is the answer and `Vehicle.correctTo` is what a client does about
one — **it is not `placeAt`**, which is a hull ARRIVING, and **it ARRESTS the
motion it corrected** so a lid reads as a wall rather than a stutter.

**`decode` proves only that a frame is JSON with a `t` on it, so a
`ClientMessage` is a CLAIM and never a fact**: `server/wire.ts` is the one door
that makes it one, nothing else on the server may read a frame, and a new client
message type owes an arm in its switch.

**There is more than one match server, the CLIENT holds the list, and none of
them knows another exists.** A `Region` carries BOTH its urls, and **a match id
is minted per process, so every region has an `m1`** — every row, join and
identity is qualified by REGION as well as id, and **two processes behind one
hostname is forbidden**.

→ **[`docs/multiplayer.md`](docs/multiplayer.md)** — the authority model and what
it does not defend against, the roster and the bench, the botless match and the
row that says so, the deploy ask, what a death owes each side, the interpolation
clock and its easy sign error, the rewind, the drive verdict and the correction
under it, the lobby and the regions' two headers, and what is not built.
## Conventions

- **All tunables live in `src/config/`** (`CONFIG`, `as const`). No gameplay magic
  numbers elsewhere — art/geometry constants stay in their model file. It is one
  module per subsystem, composed into a single `CONFIG` by `config/index.ts`,
  which is the only file that imports the sections. **A new tunable goes in the
  section module it belongs to, never in `index.ts`** — that file is a spine and
  holds one import per module and nothing else. Several modules export two to
  four keys (`weapons.ts` is `weapons`/`combat`/`gunfeel`), which is fine: the
  rule is one MODULE per subsystem, not one key. `FOG_WALL` is alone in
  `config/fogWall.ts` because `config/bots.ts` reads it, and taking it from
  `index.ts` would be an import cycle.
- `CONFIG` is `as const`, so a field like `bots.engageRange` has a *literal* type.
  `let x = CONFIG.bots.engageRange` then reassigning it fails to compile — annotate
  `let x: number` instead.
- Smoothing is normally the frame-lerp idiom `Math.min(1, dt * rate)`. **Anything
  that moves where bullets go, or that a player will read as recoil, is stepped
  EXACTLY instead** — both recoil responses integrate their arrest in CLOSED
  FORM and haul at a rate, because burst climb must not vary with frame rate.
  The landing absorb next door is semi-implicit Euler and may stay that way.
  Frequency decides which you need.
- **A weapon states its recoil TWICE, and reading the two as a pair is how the
  kit is meant to be read.** `recoilMult` is the MOMENT — how far the muzzle
  tips, and the only thing that reaches `pitchPerShot`. `recoilImpulse` is the
  SHOVE, and it reaches no angle at all: the settle spring's constants, the
  post-shot unsteadiness, the view punch's amplitude and the viewmodel's own
  travel. They are physically different quantities and in this table they are
  frequently inverted — the pistol flips at 1.15 on a shove of 0.55, the LMG
  shoves 0.9 and flips 0.7. **A weapon that sets one of them from the other has
  not said anything.**
- **Recoil is an ARREST and a HAUL and must never become a spring again** —
  [`src/core/recoilCurve.ts`](src/core/recoilCurve.ts), run by both the aim and
  the weapon on screen. It has been a first-order decay and a damped spring, and
  the spring is the instructive failure: symmetric about its peak and smooth
  through it, so the excursion read as ANIMATION rather than impact. Nothing
  about a gun wants to be where it started — the charge hands it a velocity, the
  grip ARRESTS that, and the shooter HAULS it back at a rate, after a reaction —
  and **the CORNER between the arrest and the haul is the feature**. **The
  STANCE changes its TIMING, not just its amplitude** (a three-point lock and
  two arms are two mechanical systems). **It is tuned against the FRAME as well
  as against the gun**: nothing that completes in two samples of a 60 Hz display
  can read as motion however right its curve is, so **an excursion taken back
  under ~5 frames has made recoil jerkier whatever it did to the arithmetic**.
- **Spend recoil's visual budget on the MODEL, not the aim.** `kickPitch` and
  `kick.adsMult` move as a PAIR — their product is what an aimed weapon takes,
  a rotation while aimed taking the fitted sight's reticle off the axis the
  rounds fly down — and the bare `kickPitch` is what hip fire takes. **`kickWeight`
  reaches the model ONCE**: `Player` strikes the kick with it and `ViewModel`
  must not multiply by it again, which SQUARED the weight and put the bolt gun's
  6x eyepiece inside the near plane. **`stackPeak` is MEASURED through a held
  trigger, never derived**, and so are the pattern's total walk figures —
  **re-derive them rather than assuming they followed** whenever
  `CONFIG.recoil.pattern`, `pitchPerShot`, `yawPerShot` or `firstShotMult`
  moves.
- Recoil only partly springs back: `CONFIG.recoil.recoverFraction` (0.93)
  returns 93% and pushes 7% permanently into the player's own `pitch`/`yaw`.
  **It is the first number to move back if the rifle proves too easy to hold**,
  0.7 having been an explicit product decision that a fully-recovering recoil is
  decoration. **That share is HANDED OVER at the haul's own rate rather than
  applied at the shot** (`CameraSystem.owedPitch`), applied whole being a step
  function underneath a rise. **`CameraSystem.addFlinch` is the one aim kick
  that is 100% springy and must stay that way**: a hit *taken* is not a choice
  the player made, so a permanent share would ratchet the view skyward over one
  exchange — it queues nothing, the owed buckets being the only route into
  `pitch`/`yaw`.
- **The recoil vector is built in `Player.recoilKick`, never at the call site.**
  Every number in it is the weapon's or the body's, and the horizontal is drawn
  ONCE per shot into `Player.kickDrift` so the aim, the viewmodel's lean and the
  view punch are all the same round going the same way. `Game` wires the result
  to the camera and does no arithmetic on it.
- **A team's colour is WORN, not merely drawn.** `CONFIG.teams[].color` paints
  a soldier's pauldrons, bandolier and helmet band as well as the deploy map's
  markers, so it has to stay saturated enough to read at three pixels through
  fog — a dull tone is only dull on a screen, and is no marking at all on a
  body. `SoldierModel`'s `KITS` owns the rest, and the two sides are told apart
  three ways on purpose, each covering where the last fails: **hue** (the only
  one that survives a body three pixels wide), **accent** (that team colour,
  placed so some of it faces every direction), and **silhouette** (a helmet shape
  per side, which is what is left when there is no colour at all).
- **Every ROUND is hitscan** — player and bots share `CombatSystem.fire()`, which
  takes the shooter's target list (so friendly fire is excluded by construction rather
  than by a team check inside) and the shooter's own `range`, which bounds the wall pick
  and the near-miss sweep as well as the damage. Tracers, sparks and impact discs are
  pooled; add effects to a pool rather than allocating per shot. **Two things are
  deliberate exceptions and there are exactly two**: the grenade, and the
  anti-tank rocket. Both fly, both cost one collision ray a frame, and both are
  arguments about giving a player time to react rather than oversights.
- **Damage is a slope, not a number**, and `range` is only where the ray stops.
  `ShotOptions` carries a fall-off band resolved against the distance the impact
  point already cost, so every weapon (and the bots' one flat round) degrades
  with distance. Quote a weapon's time to kill as the CLOSE one or say which.
- **The head zone belongs to the player by CONSTRUCTION, not by a check.**
  `ShotOptions.headMult` turns it on and only `Player.shotOptions` sets it; at 1
  or absent the head sphere is never ray-tested at all. That gate is load-bearing
  rather than a difficulty knob — bots aim at `eyePos`, the very point the zone is
  centred on, so a head sphere their rounds could find would make every accurate
  bot shot a headshot. It is an *upgrade* to a body hit that already landed,
  never a candidate of its own, and fall-off applies first.
- TypeScript is strict with `noUnusedLocals`/`noUnusedParameters` — the typecheck
  fails on dead variables.
- `Bot` holds a small FSM and drives a joint rig built by `SoldierModel` (invisible
  root + `TransformNode` joints). Animation is procedural, so a new behavior means new
  FSM states, never new clips.

## Files not to edit / not part of the build

- `dist/` and `node_modules/` — gitignored build output and dependencies.
- `specs/game_design.md` — the original roguelike prototype; historical, **not a
  live contract**.
- `undefined/` — tracked stray screenshot output from a script with a bad path.
