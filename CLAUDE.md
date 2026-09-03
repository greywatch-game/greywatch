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
file, plus the pointer and a row in the table above. **Keep this file under ~850
lines the same way**, and when it drifts over, the thing to cut is the ARGUMENT
in a companion-backed summary — never a rule, because the companion already holds
the argument verbatim and nothing else holds the rule. What must **not** move out
is anything two subsystems both depend on; that is what this file is for. Four
sections stay long whatever their companion holds, because what is in them is
what crosses subsystems: the wiring, the two rules the world layer cannot bend
(the collider proxy and the metadata contract), and the conventions — ~260 lines
between them.

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
rather than a tuning flag.** This frame is DRAW-CALL bound — Coldharbour renders
at a sixteenth of the pixels for the same milliseconds — and Babylon's WebGPU
backend charges CPU on every draw, so the render-bundle submission path is worth
~26% on the two big maps and ~15% on the two small ones. **Do not delete it to
tidy the boot.** The argument is on the line in `main.ts`, the measurement is
`FINDINGS.md` #17, and the one thing to know without reading either is that its
risk is state changing between draws: if a rendering bug ever appears that shows
only while something is MOVING, flip this first.

**Zero audio files and zero model files** — every mesh is built from Babylon
primitives at runtime, all sound is synthesized WebAudio (`src/core/Sfx.ts`). Do
not add asset files unless explicitly asked. There are four exceptions, none
authored by hand and each with a generator in `package.json`: the icons, Havok's
`.wasm`, the water's foam mask, and each map's menu photograph.

**Havok's `.wasm` (~2 MB) is the one binary that ships**, and it is never named
by path — Vite emits it content-hashed from the ESM glue's own
`import.meta.url`. Do **not** also hand-place a copy in `public/`: that precaches
2 MB twice. **It is REQUIRED, and the boot screen enforces that**: `main.ts`
awaits `loadHavok()` before it constructs `Game`, so nothing downstream asks
whether physics has arrived. Do not reintroduce a fallback.

**Never add a deep static import into `@babylonjs/core`, and never drop
`optimizeDeps.exclude` from `vite.config.ts`.** Both break a DEV session only,
both blame a subsystem that is not at fault, and both hide themselves on a
restart — the first silently unshaded the glow layer and every `StandardMaterial`
in the game. `src/` now holds **zero** of them and `npm run build` fails on a
new one (`scripts/check-deep-imports.mjs`); `server/` is outside that scope.

**Two more WASMs exist and the rule is that neither ever ships.**
`WebGPUEngine` lazily fetches glslang and twgsl off `cdn.babylonjs.com` — four
files, on first draw — the moment a shader reaching the backend is GLSL rather
than WGSL, which would break `docs/pwa.md`'s offline promise silently. Nothing
in `src/` is GLSL, and the tripwire holding that is TWO halves because an
aborted route silences the other one.

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
deploy`, with `roundover` when a side runs out of tickets. The 3D scene renders
in **every** state, which is what lets the deploy screen and the menu sit over a
live view. `loading` (the map being built, and then the reflection bake
draining behind the same card — `Game.bakeWait`) and `dying` (the death cam) are
**STEPS, not lids**; `updateWorld` runs in full under the death cam and nothing
may simulate under the building card, which is now up for as long as the bake
takes rather than for one frame.

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
update → carried-light updates → `lighting.update(dt, camera.position, mats)` →
`sfx.setListener()`. Light slot selection and audio panning key off the camera
position, so nothing may move the camera after them.

**Two things are pushed from `tick` instead, because they are owed by the states
that simulate nothing**: `mats.updateCamera()` (the shader's eye, or every
screen with a live view behind it is fogged against wherever the last live frame
stood) and `Game.pushScoreboard` (the Tab board belongs to the ROUND, not to the
states that simulate one).

`ConquestSystem.update` runs *before* `BattleSystem.update`, so a bot's think tick
sees this frame's flag ownership rather than last frame's.

→ **[`docs/game.md`](docs/game.md)** — the mechanical test for what may leave
`Game.ts`, what `installMap` hands to which system, and the two pushes from
`tick`. **[`docs/states.md`](docs/states.md)** — the full cycle, the four spec
fields, the stranded-screen bug behind them, pausing and the netplay inversion of
it, and the pointer-lock trigger.

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
like is a field stating only what is DIFFERENT**, as `recoilMult` scales
`CONFIG.recoil`, and **the rifle is the reference with every number 1** — a
shooter with no weapon of its own needs no default anywhere.

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
new gesture over a wait belongs on that clock, not on a new one.** What each
takes away is `aimBreak`, and on the bolt gun that IS the weapon: one that kept
its sight picture through the cycle would be a slow DMR.

**An optic's `eyeRelief` has to RISE with its magnification**, and the failure is
silent. The aimed stand-off is `eyeRelief * zoomComp` and `zoomComp` falls as the
magnification rises, so the 3.5x scope's 0.17 buys 7.8 cm of eye and the same
number at 6x would buy 4.5 — inside `CameraSystem`'s 0.05 near plane, which clips
the eyepiece open and turns the tube into a hole in the air. The same number
sizes the optic (`optics.ts` measures every dimension against `eyeDistance`), so
the biggest glass in the kit is the one held furthest from the eye, which is the
honest way round.

→ **[`docs/weapons.md`](docs/weapons.md)** — the report's five layers, the crouch
latch, the gloss ladder, the viewmodel's rendering group and pose stack, the
reload's four beats, the kick spring, the recoil pattern's two envelopes, the two
slots, the head zone, eye relief, and the procedural-model rules.

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
of the same eight layers. **`power` scales SIZE and COUNT, never TIME**, because
the order the layers arrive in is what the effect is. **What a blast throws is
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
the boot screen.

**A phone gets a sixth thing on `#hud`, and it is a DEVICE rather than a
screen**: `TouchControls` is polled by `InputManager` once a frame exactly as a
gamepad is, so nothing in gameplay has heard of it.

**Every screen is a LIST, and a list whose rows can change under the cursor keeps
its place by IDENTITY rather than by index** (the lobby is the one that can), and
**the way OUT is a button in its footer, never a row in its own list**
(`.ui-foot` / `.ui-back`). They are drawn in ONE FRAME anchored to the VIEWPORT,
**sized in `clamp()` over `vmin` with `--ov-scale` a safety valve rather than the
layout**. **A screen over another SCREEN is opaque and a screen over the SCENE is
not**, and **the PAUSE is the one card that does not take the screen**.

**The menu stands on a PHOTOGRAPH of the map**, and `#menu-shot` is a root of its
OWN at z-index 9 rather than a child of `#overlay`, which would paint over the
veil whatever its z-index. **A map with no row in `mapShots.ts` is not broken.**

**The CHROME is sized by a UNIT, never by a transform** — a transform takes a
10 px caption to six along with the 46 px numeral it was aimed at. `hud.css` and
`minimap.css` are still authored in a 720p window's pixels and state every size
as a multiple of a ladder in `base.css`: `--hud-u` for shapes,
`--hud-cap`/`--hud-mid`/`--hud-num` for the three bands of type, `--hud-map` for
the minimap, all `clamp()`ed over `vmin` so a desktop is untouched. **A new size
is a multiple, never a bare pixel**; **an INSTRUMENT is exempt**, and the test is
whether its size is a claim about the SCREEN (the crosshair is the live spread,
the gun marker is where the barrel points); **`#hud.touching` is a TRIM on that
ladder**, keyed on the controls rather than the viewport, which is the only
thing that gets a TABLET right; and **the minimap is the one canvas that resizes
itself**, redrawn at its box times the device ratio rather than resampled.

→ **[`docs/ui.md`](docs/ui.md)** — the shell, the four cards as one class, the
menu's rail and the map schematic drawn from a LAYOUT, why **the pointer deploys
only through the Deploy button**, the deploy map, the kit turntable, the settings
panel, the lobby's row identity, the gauges' metric and the four ladders, the
short-viewport scaling, the portrait fallback, and the touch controls as a
screen — with [`docs/pwa.md`](docs/pwa.md) for them as a phone.

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
must hold the canopy. **Anything a collider stands in for may never sway**. A swaying group used to
need an ink TWIN because Babylon's hull could not follow the wind; the ink is a
screen-space pass now and gets sway for free.

**The ink's line WEIGHT is a function of distance and is not the same reading
as its fade** — a thin black line comes forward and a thick pale one does not,
so `ink.width` takes the stroke's weight down with range while `fadeBand` takes
its darkness. Its near end is `ink.near`'s viewmodel argument spent on width.
Width is a second sample ring, both rings divided by their own radius so one
pair of thresholds serves both.

**The frame's ALPHA CHANNEL is TRANSLUCENT COVERAGE, and every shader in the
tree owes it.** The ink comes off DEPTH, and nothing alpha-blended writes depth
— a capture marker must not hide what it marks — so smoke and the objective
columns had the line work of whatever stood BEHIND them painted over the top of
them. Everything opaque writes **0** into that channel (`CelShader`'s
`opaqueAlpha`, a literal 0 in the grass and the water, and the clear in
`applyEnvironment`), every alpha-blended draw accumulates into it for free
(`ALPHA_COMBINE` blends alpha as ONE, ONE), and `CelInk` scales its edge by
`1 - a` and writes 1 back out. It costs no pass and no target. **A REFLECTION
PROBE inverts it**: in a cube that channel is the bake's own coverage mask —
what the glazing and the water read to tell the city from the sky — so
`ReflectionSystem` flips `opaqueAlpha` to 1 for the length of a bake, and a
shader that hardcodes either value breaks one of the two passes silently.

**Water is a MIRROR with a dark body under it, and it is SAMPLED FROM NOTHING** —
directional wave trains, no normal map, and re-adding one brings back four rules
that existed only to hide its lattice.

**The world is OPAQUE with exactly one exception, and it is glazing.** Glass you
can see THROUGH is `getGlass` over a cube `ReflectionSystem` bakes **one per
GLAZED BLOCK** — not one for the map, not one per material. Glass you cannot is
`Build.pane({ backed })`, which composites the mass behind it arithmetically and
therefore writes DEPTH; **it pays only if the pane is drawn first**, which is why
`Game`'s constructor sorts the opaque queue FRONT TO BACK, and **`backed` is a
claim about the WORLD that nothing throws over**. **No pane of either kind is a shadow
caster**, and see-through glazing writes no depth, so the ink does not find it
either — a `backed` pane does write depth and is inked like the mass it stands
for.

**The frame WALKS the scene, and the scene is the map** — Babylon evaluates
every mesh in it every frame before it has decided anything, at ~1 us each, so
the cost is the map's AREA rather than what is on screen. `WorldCulling` is what
holds that down, and it works by **replacing `scene.getActiveMeshCandidates`
and writing nothing onto any mesh**: it never disables, never hides, never
unpickles. That is the load-bearing part rather than an implementation detail —
a disabled mesh leaves the shadow map's render list, a cube probe's bake and
Babylon's own default pick filter, and a candidate list leaves all three
untouched. **A collider is never a candidate at any distance** (invisible by
construction, so it cannot draw), **a mesh carrying `metadata.block` is one only
while the camera is inside the map's `fogEnd`**, **a body's RIG is one only
while the root the roster switches is enabled**, and **everything else always
is** — which is why the terrain, the roads and the rim carry no block: they are
what the SKY is behind, and a hole cut in them is a hole onto a gradient.
**Nothing pooled may ever be block-keyed.**

**The rigs are the fourth class and a ROSTER is why** — `MapLayout.perTeam` is
the one number a layout may triple, so a pool is 336 rig nodes or Sarab's
**1,008**, every one offered to the walk whether the body was in the round or not.
`Game.installBodyPools` files BOTH pools (in a match that includes
`BattleSystem`'s sixteen, built and never enabled) and the switch is polled per
BODY. **It is filed mesh by mesh and never by ancestry**, because
`RagdollSystem` reparents a corpse's joints onto Havok proxies and an ancestry
test would drop every body in the game the moment it started falling. Sarab:
**candidates −26.5%, the walk −11.9%, the frame −4.4%, draw calls and active
meshes identical** — it takes the WALK and never the draw.

**The GLOW layer draws the EMISSIVE meshes and nothing else, and what makes
that safe is that its occlusion is the FRAME's own depth buffer.** It used to
redraw the whole visible scene into its own texture as opaque BLACK — 586
meshes of which 57 were emissive on Coldharbour — because that black is what
made the buffer depth-occlude, so a brazier behind a cottage did not bloom
through the wall. `src/core/GlowDepth.ts` takes the depth the main pass has
already written instead (`shareDepth`), which is the same answer exact to the
pixel, and the render list collapses to the emissive meshes. **Worth ~20% of
the frame on all three big maps** — Coldharbour 9.45 -> 7.60 ms, Harrowmead
10.55 -> 8.25, Sarab 13.40 -> 10.55 — with 36 frozen vantages across three maps
inside **0.026/255**. Three earlier attempts tried to narrow that list by
asking WHICH GEOMETRY MATTERS to a bloom (by distance from the light, by
excluding the rigs, by a screen-space overlap test) and all three failed;
`FINDINGS.md` 3 has them, and the reason they had to fail is that the only
honest answer to that question is a per-pixel depth test. **Do not put the
whole-scene render list back**, and read `GlowDepth`'s header before touching
the layer: the schedule, the clear, the framebuffer rebind, the texture's
resolution and the REBUILD are five separate things that each fail SILENTLY.
**The rebuild is the one that shipped as a bug**: the layer throws its main
texture away and builds another on every `engine.resize()`, and the new one
takes Babylon's own depth-clearing clear back while KEEPING the emissive-only
render list, which lives on the object renderer rather than on the texture.
Reverting both halves would only have cost the measurement; reverting one left
the pass occluding against nothing, so a window dragged to another size — or a
zoom, a second monitor, the render-scale setting, a phone turned on its side —
bloomed every lamp in the map through its own wall until the page was reloaded.
The hooks are re-installed by IDENTITY every frame for that reason, and the
depth share is keyed on BOTH of its ends.

→ **[`docs/rendering.md`](docs/rendering.md)** — the water's wave field and mirror
and the three ways a cube probe goes flat, the four light terms and the colour
buffer's three further rules, the ink's tint and the NIB it varies with
distance, the wind's two bounds, the
muzzle-flash budget, the fog split, the shadow window, the reflection bake's
seven load-bearing details, the four classes the candidate list sorts the scene
into, the painted sky, and the WGSL dialect's own traps.

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
| `MapLayout.size` — how big it is | `CONFIG.map.size`, 240 | its heightfield's `size * cell` must equal it (asserted in DEV, since `MapDef.heights` is a different file), and the rim's boundary boxes must stay over 200 m so the seven sites keying on `w > 200 \|\| d > 200` still can |
| `EnvironmentSpec.fogEnd` — how far you can see | `FOG_WALL` | it is the reach `WorldCulling` walks to and the default for the row below; `audio.maxDistance` (70) and `bots.perception.engageRange` (55) did **not** move with it, so a clear map must be laid out knowing that |
| `EnvironmentSpec.bodyDrawDistance` — how far a BODY is worth drawing | its own `fogEnd` | it is resolved ONCE (`bodyDrawDistanceOf`, clamped to `fogEnd`) and pushed to `BattleSystem`, `NetRoster` and `RagdollSystem` together, which is what keeps `bots.lodDisableDistance` and `bots.death.maxDistance` one distance; a body it drops POPS, and the WALK's reach deliberately stays the fog. **A map's `fogEnd` is a distance from the EYE and a LANDMARK is a fixed thing in the world**, which is the trap Cinderhaven found: a fog wall chosen for the cull budget put that map's volcano — the thing every road and the whole sky is arranged around — in flat `fogColor` from everywhere anybody played, and the honest fix was to buy the fog back and take the saving out of this row instead |
| `MapLayout.surfaces` — how deep it stacks | `CONFIG.nav.maxSurfaces`, 3 | only a map that stacks FLOORS raises it; overflow drops candidates silently (see the bots section) |
| `MapLayout.perTeam` — how many bodies a side | `CONFIG.bots.perTeam`, 8 | it is DENSITY, bounded by `CONFIG.bots.maxPerTeam` (24), and it is spent in RIGS — `BattleSystem.setRoster` rebuilds a CLIENT's pool when it moves rather than sizing it to the ceiling, because a disabled mesh is skipped cheaply and not skipped. The squads, the squads' launchers and the scoreboard follow it; `CONFIG.conquest.tickets` deliberately does not, so a denser map is a shorter round. **It reaches a match too, and what it moves there is the BOTS**: the authority's slot table is the ceiling and `setFielded` says how many of it a round fights, while the SEATS stay at sixteen on every map |
| `MapLayout.blockSize` — how big a merge block is | `BLOCK_SIZE`, 48 | it is DRAW CALLS and cull granularity and nothing else; `ReflectionSystem.encloses` and `WorldCulling` follow it for free because they read the block KEY rather than a size, and the world layer's unit of LOCALITY (the physics buckets, the pane index) deliberately does **not** — those want more buckets on a big map, not fewer |
| `MapLayout.terrainBlock` — how big a floor patch is | `BLOCK_SIZE`, 48, **independently of `blockSize`** | a whole number of terrain cells, and the same value in all three callers of `terrainPatches` — `buildValley`, the server's `terrainColliders` and the editor's brush — or the two sides tessellate different floors |
| `EnvironmentSpec.lighting.shadowWindow` — how far its shadows reach | `CONFIG.graphics.shadows.frustumSize`, 110 | shadow length is `h / tan(elevation)`, and `shadowVisibility` is FULLY LIT outside the window — the last `CONFIG.graphics.shadows.edgeFade` of the volume ramps back to it, so the boundary is a gradient rather than a line, but the ramp only softens the transition and never MOVES it. An undersized one still puts that transition on ground the player can see, and an OVERSIZED one moves it not at all (the depth volume binds along the sun) while costing texel density, which `ShadowSystem` now DEV-warns about |

**A map is CLOSED one of two ways, and the second has no wall at all.** The rim
is four boxes at `±size/2` under `Ridge`'s escarpment, and is what three of the
four are. `MapLayout.borderland` is the other: the floor carries on for a
`margin` past the play square — `TerrainField` continues the field, so nav, the
roads, the grass and **`server/validate.ts`** agree for free — and what stops you
leaving is `src/world/leash.ts`, a countdown rather than a shape. **It is sized
by the leash, it kills on the AUTHORITY and only draws on a client, and bots are
never leashed** — the nav graph stops at the play square.

**What a boundary is closed BY and what it is closed WITH are two questions**,
and `RidgeSpec.form` has a third value for maps that answer the second some
other way: `none` builds no landform at all. What earns it is having laid
something out there already, because the sky dome is flat `fogColor` below the
horizon and `Sky` culls its stars out of the lowest 7.2 deg — so a boundary with
nothing over it and nothing beyond it is a dead band of sky under a starless
one, which is the picture the other two forms were paying for. Cinderhaven is
the map it was added for and the only one that takes it: an ISLAND states its
horizon in water instead.

**The shipped maps are Hollowmere** (a night village), **Greyfen** (a jungle
valley), **Coldharbour** (a business district — what the first three overrides
exist for), **Harrowmead** (`size: 400`, no wall around it), **Sarab**
(`size: 900` inside 1500 m of ground — a desert town, and the map
`ENGINE_UPGRADE.md` exists for) **and Cinderhaven** (`size: 1500` inside 2000 m
of ground and 4,600 m of sea — a harbour town on a volcanic island, at night,
the biggest map in the tree and the only one with no rim on it at all). **The last four are the four with vehicles on them**, and they are
the four biggest; **Sarab and Cinderhaven are the two with all THREE KINDS**, a
tank, a gun truck and a helicopter a side, **and the two that are not 8v8** —
both field 24 a side, online and off, which is `MapLayout.perTeam` and the row
above.

**Sarab is the map that SPENDS the levers**, and it is the only one that states
most of them: `blockSize` and `terrainBlock` at 96 (S6), a `fogEnd` (560) inside
its own 1,273 m diagonal, which is the first time block visibility has had
anything to cull (S1 and S8), a `bodyDrawDistance` (300) inside THAT, which no
other map states, `surfaces: 5`, and a `perTeam` of 24 — S10's third lever, and
the one thing on this list that is bodies rather than metres. It is also the first to state a
`ParticleSpec.volume` — the mote field emitted around the EYE rather than over
the whole square, without which `count` is a density that scales with a map's
AREA and a 900 m one is air nobody can see. Its layout was **SEEDED by
`npm run sarab`** rather than typed — a 900 m town is some hundreds of buildings
and its floor is fifty thousand numbers — and the emitted `layout.ts` is an
ordinary layout file the editor opens, patches and saves like any other.
Re-running the generator discards editor edits, which is the warning every
`heights.ts` already carries.

**Cinderhaven spends them again at 1,500 m and adds eight rules of its own**,
each general rather than a detail of this map. **Its TOWN IS A NETWORK and the
houses are arranged against it** — a quarter is blocks cut by its own streets,
the streets are `road` placements that CLAIM their ground before anything is
built, and every house is laid on the frontage line facing the carriageway,
which works only because everything in the kit with a front faces its own local
-Z (the shophouse and the depot are the two that face +Z). **Its FLOOR IS THE
LEVEL** —
what is land, where the sea goes and which slopes sever their own nav links are
one continuous function, so `heightAt` in its generator is the map and the town
is what stands on the answer. **And a WATERFRONT IS DERIVED FROM THE FLOOR
rather than authored against it**: the generator MARCHES the finished ground
outward from the middle of Cinder Bay, finds where it actually crosses the sea
on each bearing, and places the Strand, the bay road, every jetty, boat shed,
quay wall and lamp a stated distance inland of THAT — so what is authored is an
arc and a setback, and the shore may move (a radius, a foreshore slope, a
district's level) without a coordinate going quietly wrong. **A `WaterRect`'s
reflection probe stands at the depth-weighted centroid of its WET cells**, so
one rect over an island bakes a cube probe inside a mountain — and the second
half of that rule is that a SEAM between two rects is where the mirror CHANGES,
so a partition must not put one where anybody looks across it. Its sea is a
PINWHEEL of four: the bay, its mouth and the whole eastern sea are one rect
with one probe standing in the throat, and the three carrying the open sea meet
only out past the coast. **An ISLAND'S HORIZON IS THE SEA, and it is priced in
QUADS rather than in ground** — a second pinwheel of four rects runs the water
to 2,300 m, which is `fogEnd` past the furthest point anything in the
simulation can reach, so the rim came off (`ridge: { form: "none" }`) and what
closes the map is the fog over open water. **The floor does NOT go with it**:
water is a quad with a texture for a bed and is opaque past
`CONFIG.water.depthMax`, so the ground still stops at the `borderland`'s
margin and nothing is drawn under the ocean at all. Two rules fall out and both
are general. The ring is not the inner four made bigger — **a rect's bed map is
512 texels a side however big the rect is**, so widening one that carries a
shoreline spends that coastline's own resolution on empty sea. And **the FLOOR'S
outer ring is what the ocean is drawn over**, because `TerrainField` clamps
every query outside the heightfield to its edge: two 60 m stretches of foreshore
reached the boundary at 0.9 m above the water, which was a spit while the sea
stopped at the margin and a kilometre and a half of dead-straight sandbar
afterwards, so the generator now pulls that last band under — deep enough that
`borderRoll` cannot lift it back into the shallows. And **there is no swimming
in this game**, so its
whole bay is 2.6 m at the deepest and walkable — a shelf you step off into
eight metres of water is a pit with a back-face-culled lid on it — which is
what lets its middle flag stand on an island and still be reached on foot,
while everything that must NOT be walked is made steep enough to sever instead.

**A MAP FEELS LIKE A PLACE BECAUSE OF WHICH BUILDINGS ARE ON IT, NOT HOW MANY**,
which is what `src/world/kit/harbour.ts` is: the first kit in the tree written
for a map that had already shipped. The island was built out of the village set
and read as Hollowmere with more water in it; the volcanic-coast set is seven
pieces (`smelter`, `lighthouse`, `crane`, `fishRack`, `careenedHull`,
`netLoft`, `saltPan`) made of three materials — the basalt the island IS,
tarred timber that came by sea, and iron a week after it landed. **`smelter` is
the tree's LANDMARK and the rule it carries is that a landmark needs an
INSIDE**: Sarab's minaret is legible at 800 m and explicitly refuses to be
entered, and what lets the Cinderworks do both is that its height is a CHIMNEY
rather than a room — forty metres of stack over a hall you fight in costs three
collider boxes and gives away no ground, because there is nothing at the top of
it to hold.

**AND A ROAD NETWORK IS MEASURED, NEVER REVIEWED.** `npm run cinderhaven --
--roads` prints how far every square of dry, in-play ground is from a
carriageway, and the answer on the shipped map was that a quarter of the land
— the whole western third and the outside of the north arm — was over 150 m
from any road. **That failure has no symptom in a screenshot**: a quarter laid
off the network still builds, still reads as a town from above, and is still
somewhere a player crosses four hundred metres of open moor to reach wondering
what it is for. The generator now refuses to write a DWELLING that far off the
network, tests the same distance before it sows a croft, and refuses a
carriageway laid in the sea or up a slope the nav graph severs — a road is a
picture and it draws over water as happily as over ground.

**It is also where three rules about WATER were found**, all of them general: a
body of water is a hole in the FLOOR with a plane over it — nothing but
`TerrainField` decides its depth, its shore or where its probe stands; what it
LOOKS like is whatever that probe can see, which on a bright map with nothing
round the pool is pale sky and reads as a salt pan; and **a FORESHORE has to be
as long as the ground behind it is high**, because a fixed beach that links on
a 10 m shelf is a 0.47 gradient and a severed shoreline where the same water
meets a 26 m volcanic apron.

**A ROAD is visual-only and rejects exactly one thing, which is anything that
GROWS** (`world/roads.ts`, `GameMap.roads`): `MapBuilder` sows no
`PropBody.rooted` prop on a carriageway and `GrassSystem` no tuft. It is a
per-PROP fact rather than a per-region flag, because a street is where rubble,
cones and litter belong — and **what is sown there stands on the ROAD** rather
than on the floor under it (`roadTopAt`), or the litter is half buried in it.
**Any change to a placement rule re-rolls the seeded dressing field**, so it
owes `npm run collision` and `npm run parity` — the staleness guard hashes the
LAYOUT and this kind of change is in the BUILDER.

**Where two roads CROSS, the SURFACE decides which one is the ground, and it
decides by HEIGHT**: `ROAD_RANK` (dirt < cobble < asphalt — the order the ground
was built in) lifts a carriageway two millimetres per rank, because coplanar
sheets in two meshes are a per-pixel tie whose winner changes as the camera
moves. **The rungs are tiny because a road is a sheet OVER the floor and almost
nothing else knows it is there** — a bullet's dust disc clears the ground by
20 mm and is the tightest of them — so the ladder stays inside the 10 mm a road
already stood proud by; what a map SOWS on a street is put on the street instead
(`roadTopAt`). Do not give two surfaces one rank.

**A road is still not inked, and it is now UNINKABLE rather than forbidden** —
which is the one rule in this family the screen-space ink retired outright.
Under the hull, ink was geometry: an inverted shell stamping depth 5 cm above
the sheet it wrapped, which painted every mixed junction black in whichever of
the two road meshes the sort drew second, and no lift could beat it because the
shell rode with the slab. `CelInk` finds an edge by asking whether depth STEPS
or BENDS, and two coplanar sheets do neither, so a carriageway laid across
another produces no line at all and needs no rule to stop it. The ladder above
survives untouched because it is not about ink: it settles a per-pixel depth
tie between two coplanar meshes, which is still exactly as real.

**That ladder settles a CROSSING and cannot settle the FLOOR**: 10 mm of
geometry is spent by ~100 m against a depth buffer whose step at the far end of
a big map is tens of centimetres, and past that a road is eaten by the ground it
lies on — measured from a helicopter over Sarab, **the far half of a 900 m
street drawn as detached bands of asphalt on bare sand**. `ROAD_DEPTH_UNITS`
(-8) is a polygon offset in the buffer's OWN units, carried by the BUILDER
(`Build`'s `depthUnits`) so a slab and the paint on it move together, and part
of the material CACHE KEY — one hex at two biases is two materials, or a car's
underbody rides off the ground.

**There is a sixth entry in `MAPS` and it is DEV-ONLY and not a level.**
`src/world/proving/` is the generated load `ENGINE_UPGRADE.md` S0 measures
against — a city block grid several times Harrowmead's size, written by
`npm run proving`. **`MAPS` is an `import.meta.env.DEV` ternary and must stay
one**: that fold is the only thing keeping 900 kB of it out of both bundles, and
a `push`, a `filter` or a `const dev = import.meta.env.DEV` one line up would
silently stop working. `scripts/check-proving.mjs` is what enforces that, on the
end of `npm run build`, over `dist/` and `dist-server/` both — one grepped
sentinel per generated module, since a comment naming the directory does not
survive a build and a string literal does.

**It has a collision bake, so the AUTHORITY runs on it too** (S9). That is
`DEV_MAPS` in `scripts/collision-hash.mjs` — baked and staleness-checked like
the five levels, kept out of the `MAPS` beside it because `npm run parity`'s
server half is a production build — reached through `npm run simulate:dev`,
where `--mode development` alone does not turn the flag over.

→ **[`docs/world.md`](docs/world.md)** — the six overrides in full, the
heightfield and the road slabs cut against it, the one thing a road rejects and
the pad it uses, the winding trap that makes a floor vanish, the builder and two-pass merge rules, the layout gotchas that have
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
still wears for the editor's centre-screen pick.
*What stops a round or a look?* is `RayWorld.castRound` and its any-hit twin
`blocked` — the hitscan and its wall cap, the bots' and the aim assist's LOS,
the grenade's step ray and its blast check, the rocket. So a collider is one of
three things, and a builder picks which by how it declares the box:

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
was priced on how big the MAP is rather than on how far the ray goes — 222 us a
ray on Coldharbour and **2,438 on a 1500 m proving ground, 30.7% of a frame with
sixteen bots in contact** (`FINDINGS.md` 22). All eight sites are answered
analytically now, by [`src/world/RayWorld.ts`](src/world/RayWorld.ts), off
`colliderBoxes`, the strut groups and `TerrainField` — the same geometry the
colliders were built from, and exactly the substitution that retired
`Player.probeGround`. **`map.rays` is where a system gets it**, beside `nav`,
`cover` and `obstacles`, and the authority builds one off the bake. A NEW RAY
GOES THERE; nothing may reach for the scene.

**…and the ONE whole-scene walk that survived that is `moveWithCollisions`,
which is narrowed rather than replaced.** It MOVES a body instead of answering a
question about one, so no analytic query stands in for it — and Babylon walks
`scene.meshes` for every call **and again for every retry**, which priced a body
on the map's size exactly as a pick did, and priced it worst at the moment it is
pressed against something. **There are exactly TWO sweeps in the game and both
go through `narrowedMove`**: `Vehicle.update` for a hull and `Player.update` for
a body on foot. Measured on Sarab: the fleet cost **2.30 ms a frame and 2.21 ms
of it was that one call**, and the player's own sweep cost **2.21 ms a frame**
again — between them more than a third of the frame. `map.collidables`
([`src/world/CollisionField.ts`](src/world/CollisionField.ts)) is `rays`'
counterpart — the same collider set bucketed as MESHES — and a body hands the
answer to Babylon's own `surroundingMeshes`, which is the list its coordinator
walks instead. **The saving is only sound while the list is a SUPERSET of what
the sweep can reach**, so the reach is the sphere's radius plus the whole step
plus a margin, the centre is `getAbsolutePosition()`, the order is the scene's,
and `narrowedMove` CHECKS the promise and re-runs the whole walk when a sweep
outran it. Proved identical at 6,000-8,000 blocked-and-unblocked samples per
body on every map: **the fleet 0.12 ms a frame, the player 0.036, Sarab's median
frame 14.6 ms to 8.7, and the authority's Sarab tick p50 0.691 ms to 0.053.**
**A THIRD sweep goes through `narrowedMove` too, or it is a body walking the
whole map** — and the mechanism is now general rather than the vehicles'.

**Colliders are still MERGED, and the grouping is now data rather than a
performance trick**: nothing in gameplay picks a mesh, but the bake carries the
grouping to the server and `rayGroups` is how the struts reach the queries at
all. A pick costs per MESH long before it costs per triangle: `MapBuilder.struts` merges a placement's struts into one mesh (161
loose post-and-rail boxes cost *every* ray in the game ~17%); every BLOCKING
SCATTER collider is merged by LOCALITY instead (`MapBuilder.clusterColliders`),
one mesh per 12 m square over the whole scatter pass at once, because a scattered
field has no placement to merge by and the regions overlap. The boxes stay in
`colliderBoxes` one per prop, so nothing derived from geometry can tell; **only
plain `solid` boxes may be grouped**, and the grouping rides to the server as
`MapCollision.boxGroups`.

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
in silence. One flow field per objective is precomputed and nothing
is recomputed: **bots read `nav.steer()`, never run their own pathfinding, and
never use `moveWithCollisions`**. `ObstacleField` is the sub-cell half, and its
push-out is a preference, never a veto.

Three things carry the frame budget and undoing any costs ~10x draw calls or a
permanent hitch: the rig pool is built once per roster size and never disposed
inside a round, a rig is nineteen merged meshes, and AI is staggered round-robin
at `CONFIG.bots.thinkRate`.
**Everything a bot notices without seeing it is ray-free by construction** —
cover is baked, never probed, and skill is one scalar drawn **per squad** from a
seeded generator.

**Cover is baked as three nested masks and a query answers with a KIND.** Each
height is a hit SPHERE's top and never an eye height. **A bot's crouch is one
decision re-made every frame and one eased blend read by everything else**, and
the eye and the hit sphere come down together or the stance makes a body easier
to kill.

**A team's bots tell each other two things, and both are CUES that may never
enter `BotMemory`** (`entities/SquadRadio.ts`, one board per team): a squad-only
contact CALL, deliberately not a destination, and a HAZARD mark where the team's
own bodies fall — everything in `BotMemory` feeds `hasCue`, so a cue there is a
SEARCH.

**A squad walks as a line, not a column.** `movement.spacing` (5 m) is the
formation and `bots.separation` (1.5 m) is de-penetration; both come out of one
pairwise pass, and a cover anchor is CLAIMED so a baked lookup cannot hand four
bots the same corner.

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
`MapLayout.vehicles` is one hardstanding per vehicle — absent on two of the five
maps — and `Game.driving` plus `Game.drivingSeat` are the two facts the feature
turns on.

**There are THREE KINDS and no code that knows it.** `Vehicle` is handed a
`VehicleSpec` (`config/vehicles.ts`) and a rig BUILDER by `VehicleSystem` and
never learns which it is; a fourth kind is a row in `VEHICLE_KINDS`
(`entities/vehicleKinds.ts`), a block of numbers and a model file, and **no
`if` anywhere** — the moment a system asks which kind it is holding, that is
broken. `VehicleSpawnDef.kind` is what a map states and defaults to `"tank"`,
in one place. **The rig is CLOSED over its own model** (`setRun`, `reset`,
`paint` are closures a builder hands back), because no interface over two belts
of scrolling links and four wheels that steer is honest in both directions.

**TWO things a kind differs by, and neither is asked as a kind.** Each is one
nullable block in the spec resolved once into one boolean, and the boolean is
what every reader puts instead. `VehicleSpec.gun` is null on a gunless kind and
**`Vehicle.armed`** is what the trigger, the HUD's loader row (ABSENT, not
dimmed), the gun marker, an AI driver's lay-and-fire and the authority's rate
gate on a claimed shell all ask. **An unarmed hull keeps `turretYaw` equal to
its own yaw**, so a welded ring draws at a permanent local zero and `aimMg`
needs no branch of its own.

**`VehicleSpec.flight` is the second, and `Vehicle.flies` is what ten readers
ask** — the drive block, the attitude, the wire's altitude, whether a bot may
take the chair, the leash, the shadow focus, the touch collective and the
authority's two bounds. **`standOnGround` is deliberately not one of them.**
That method has never heard of `flies`: what a flying hull does to the ground
model is `Vehicle.lift`, the acceleration its own powerplant is producing, which
is **zero on anything that cannot fly** and turns the free-fall term into
`velY + (lift - gravity) * dt` — bit-identical arithmetic on both older kinds. A
hover is then an EQUALITY rather than a decision, the plank is a landing floor,
and `jolt` is the arrival the skids spend. Gravity was never the only vertical
acceleration; it was only the only one anything had ever produced.

**`Vehicle.gearLoad` makes that bargain a second time, for the SUSPENSION**: 1
wherever `spec.flight` is null, so it scales `flexSuspension`'s drive to nothing
in flight and to nothing at all on a tank. **`flexHeave` is deliberately not
scaled** — a landing is an impulse, not a static load.

**A flying hull is steered by the LOOK and a driving one by the stick, and that
one difference of scheme costs no branch outside `flyStep`** — both halves are
`DriveInput` fields `Game.updateDriver` writes for every kind without knowing
which it is feeding, as it already does for `lift`. **`aimYaw` points the TURRET
on a hull that drives and the HULL on one that flies** (there is no turret to
spend it on), and **`steer` is hull yaw on the one and LATERAL TRANSLATION on
the other**. What `flyStep` derives from the look is a PEDAL and not a heading,
so `steerTo`, `steerAuthority` and the bank are the lines they always were.
**Two rules a change here must not undo**: the yaw chase is gated on
`seats[DRIVER]`, because `IDLE.aimYaw` is 0 and 0 is a bearing rather than a
centred stick; and only the COMMANDED half of the roll has thrust behind it,
because the coordinated half is made of the pilot's view and a bank that pushed
would mean turning your head translates the aircraft.

**The HELICOPTER is the third trade and it is bought with FRAGILITY**: 32 m/s
in a straight line over anything, for 340 points at fourteen times the tank's
small-arms damage, no cannon at all, and a 10.4 m rotor disc
(`drive.collideRadius`) that closes every alley a truck opens. Its ceiling is
40 m and that is COUNTERPLAY rather than a limit — bots acquire at 55 m in three
dimensions and their cone has no elevation term, so a machine that could climb
out of that bubble is one nothing in the game can answer. **It is drawn as a tandem-seat
GUNSHIP with its gun in a CHIN TURRET**, which is the truck's "nothing on a
vehicle may promise a body" rule paying out a second time: the sill station it
replaces obeyed the letter of that rule and still failed it, because a DOORWAY
with a gun on its lip is that promise however remote the mount is. Its stub
wings stop exactly at `hull.width / 2` — a span outside the collider is mass a
round passes through, and the rotor disc is the one thing here exempt, by
MOVING. **No bot will ever fly
one** (there is no route graph through the air), a lone pilot is a taxi because
that chin cannon is the second seat's, and a dismount at height is REFUSED rather
than punished — there is no fall damage in this game, so `dismountable` is a
height rule every kind obeys.

**The TANK is armour and the TRUCK is the trade**: 18 m/s against 11 through a
3.2 m gap against 4.4, for 520 points against 1200 at nine times the small-arms
damage and no cannon at all. It is drawn as a closed armoured 4x4 with a
**REMOTE** weapon station on its roof, and that is a rule rather than a style:
**there is no player model in this game, so nothing on a vehicle may promise a
body standing at it** — the pintle, the shield and the spade grips of the
open-bedded version it replaced were three such promises over an empty bed, and
what is on the roof now needs nobody. Nothing may stand on that roof inside the
station's sweep, exactly as nothing may stand on the tank's deck inside the
turret's. **Two numbers keep a fast vehicle honest and
neither is a branch**: `climbHeight` (0.55 against 1.25, so the parked car a
tank drives over is one a truck goes round) and **`steerAtRest`, which is how
much of `turnRate` a hull has standing still** — 1 is a neutral-steer pivot and
the tank's, 0 is the truck's, and between them `steerRollSpeed` ramps the
authority up in the hull's own **signed** velocity, so a truck cannot spin on
the spot and steers inverted backing up. `Vehicle.steerAuthority` is the one
place either end is read, the drive and the remote pose both go through it, and
a hull that cannot pivot is why the AI driver's throttle bottoms out at
`crew.turnCrawl` scaled by `1 - steerAtRest` rather than at nothing. Sarab is
the only map with both. **`mount` and `clearVehicle` are exact inverses and must be read as a
pair.** **A driver's frame is not a body's**: `Player.update` is not called, so
the hull's ground REPLACES the probe. **The verb is `E`, the pad's d-pad north
and a button that APPEARS on glass** — one `usePressed`, and `Game.offerUse` is
the one door that names it, because a phone has nothing to press until
something is drawn under it.

**The two seats are `DRIVER` (sticks + main gun) and `GUNNER` (the cupola
machine gun and nothing else), and the first man aboard DRIVES** —
`VehicleSystem.seatOn` states that once for both processes. A hull with one
chair left is `enterable`; only a FULL one is an eviction, so the player climbs
on beside a bot crew rather than turning it out. **Crossing is a third verb
(`InputManager.seatPressed` — `F`, the pad's Y, the touch swap button), and it
turns a BOT out of the chair it crosses into exactly as boarding does** —
without that the sweep fills the free chair seconds after a mount and the
second seat is unreachable by every route the game has. A PERSON is never
moved. `Game.canSwapSeat` is the one place that decides, so the key and the
HUD's prompt cannot disagree, and **the HUD draws the CREW rather than only
your own chair**: a chair held by somebody else used to be drawn as nothing at
all, which reads as a vehicle with one seat.

**The CUPOLA gun's bearing is a WORLD angle exactly as the turret's is, and
that one decision is the whole of the independence**: the mount is parented to
the turret, so a relative angle would be dragged round by every traverse the
driver asked for. `Vehicle.aimMg` writes the difference onto the rig; a gun nobody
is on inverts the rule and rides its ring. It is stepped from `VehicleSystem`
rather than from `update`, because a hull's two guns can have two owners of
different kinds — a person driving off the wire while a bot lays the cupola
gun. **It is a `bullet` against `resist.bullet` of 0.05, so it cannot touch
armour**, which is the trade rather than a limitation: what it answers is
infantry inside the main gun's reload.

**In a NETPLAY round a driver simulates their own hull and REPORTS it, exactly
as they do their own legs; every other hull is posed from the wire** by
`Vehicle.updateRemote`. `Vehicle.predicted` says which — it refuses local damage as
`NetSoldier` does and stands both hardstanding clocks down. **Getting in and out
are ASKS the authority answers**, and **occupancy is stated once, on the hull**.

**A hull is the one MOVING `solid` mesh in the game, and that is the RAGDOLL's
rule rather than an exception to the world layer's**: it is in both pick
predicates and has `checkCollisions`, but emits **no `WorldBox`** — so the nav
graph, the cover bake, the obstacle field and the collision bake have never heard
of it, and **bots walk through a parked tank as they walk through a corpse**. Its
box covers the TURRET, and **anything picking a hull out of its own way owes two
property writes rather than a predicate** — `world/solid.ts` forbids minting one.

**A hull is also the one TARGET answered by its collider rather than by a hit
sphere**, and that is a rule the two subsystems share rather than a vehicle
detail. `CombatSystem.fire` rejects a target sphere farther than the first
opaque hit — a body behind a wall is not shootable — so a sphere smaller than
the collider in front of it always loses: at `hitRadius` 3.2 against a
half-length of 3.6 a hull swallowed every round arriving within ~32 deg of its
own nose or tail, its own gun's included. `RayHit.hull` says which hull a cast
stopped on, armour is out of the sphere sweep, and **nothing reads
`Vehicle.hitRadius` any more.**

**…which is why a hull's own ROUNDS have to be taken out of that same
collider.** A vehicle's guns are drawn ON it, so a muzzle regularly sits inside
the box, and a ray starting inside a box is handed its far face — so a round
left the muzzle and stopped on the thing that fired it. `ShotOptions.fromHull`
is the skip and it is stated on the GUN rather than at the trigger, because
there are two triggers in two processes; it is the third query to leave the
hull out of its own answer, after the chase camera's and the crew's sightline.

**A tank DRIVES OVER things, and `climbHeight` is the one number deciding what is
ground and what is a wall** — the collision ellipsoid's floor AND the ceiling of
the band a track contact accepts a surface from, two uses that must never drift.

**…and it drives over PEOPLE, which is the one thing armour does that is not a
weapon.** `Game.crushSweep` (the authority's twin is `HeadlessGame`'s) runs
right after `VehicleSystem.update` and puts down every enemy body a MOVING
hull's collider is standing in. It is owed to the rule above it: a tank is in no
baked structure, so bots walk through one as they walk through a corpse, and
`moveWithCollisions` sweeps the HULL out of the world rather than a body out of
the hull's way. **`Vehicle.crushes` asks the two heights different questions** —
horizontally the body's hit SPHERE, vertically the FEET, because a man
crouching on the deck has his chest inside a 2.9 m box and **riding on a hull is
the one thing a crush must not take away**. Three gates (a live hull,
`crush.minSpeed`, a DRIVER to credit it to) and a list that is the hull's own
side's enemies with armour and anyone riding inside one skipped, for the reason
`blastAt` skips them. `"crush"` is a `DamageKind` no round carries: it decides
only that the body is THROWN clear rather than dropped.

**What a hit is worth is a `DamageKind`** — the third parameter on
`Hittable.takeDamage`, which only a tank reads, and `CONFIG.vehicles.tank.resist`
is where what each kind is worth against armour is written down. **The reticle
still cannot lie**: the look is an ORDER the turret walks toward, the shell goes
down the GUN's axis, and `#gun-marker` draws where the barrel points.
**Everything else on the hull that moves is a PICTURE** — the collider never
tilts, nothing is pickable, and the gun is aimed in WORLD angles.

**BOTS CREW BOTH CHAIRS, and a crewman is not a bot with a vehicle attached.**
The gunner is a second body with a second brain and a different set of targets
— infantry only, in BURSTS, because a machine gun cannot hurt a hull. A crewed
bot leaves `Bot`'s FSM entirely — `BattleSystem.crewed` is the BENCH's twin and
**`BattleSystem.aside` is the one skip test every loop over `bots` owes**, never
`benched.has` — while keeping its LIFE, its POSITION slaved to the hull and its
SQUAD'S ORDER, which is what it steers on. **A tank is never a DESTINATION**, and
**a crew never denies the player their own armour**: `TAKE OVER TANK` evicts and
mounts on one frame. `resolveShell` is the ONE round out of a tank gun (`Game`'s
offline, `HeadlessGame`'s in a match), and a driver needs no route graph — a
BEARING and `Vehicle.rideableAt` are all of it.

**A hull is HEARD whoever is in it, and that is two voices over one graph.** The
one the player is sitting in is unpanned for the reason their own report is;
every other OCCUPIED hull gets a spatialised copy of the same six sources,
driven per FRAME by `Game.pushHullEngines` rather than opened on a mount —
because what is being tracked is not somebody getting in, it is a tank being
within earshot. **A frame that did not STEP the fleet owes `Sfx.enginesOff`**
(`Game.fleetStepped`, raised by the two world steps): a held world is a fleet
whose speeds are frozen, and a voice left running under the deploy card is a
tank droning in a street where nothing moves.

**There are TWO POWERPLANTS in that graph and no code that asks which kind it is
holding.** `EngineKind.rotor` is a nullable block — `spec.flight`'s bargain made
again one layer down — turning the same five layers from a piston engine into a
turbine hung off a disc. **What it changes is not levels: a GOVERNED rotor does
not change note with what the machine is doing**, so the whistle answers the
spool alone and what the load moves is how hard the disc CHOPS. **And what
drives it is asked of the HULL** (`Vehicle.powerplant`): the spool and the disc
loading on a rotor, road speed and a stick on anything geared to its wheels. A
voice driven off `travel` **hovered in silence**, which is a machine flying with
its engine off.

→ **[`docs/vehicles.md`](docs/vehicles.md)** — the three kinds and the two
capabilities that stand in for a branch between them, the truck's trade and the
helicopter's fragility; the two seats and the swap, the cupola gun's
world angle and its stowed inversion, the crew of two, the whisker fan and the
two geometry bugs it found; the collider's three answers; the tracks' sweep, its
three gates and its two skips; each model's mesh budget, its running gear and
its whips, and the gunship's chin turret with the four clearances it owes; the
two engine voices, the two powerplants under them and the measurements on both;
the plank, the
rate limit and the leading-end sphere; the damage kinds, the four ways out of a
seat, the shell, the two clocks a hardstanding runs, what a map owes — including
what its GENERATOR owes — and what is not built.

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
compromise.** The frame is draw-call bound on hardware nobody here owns, and
the devices worth measuring — a phone on a home screen, a tablet, somebody
else's laptop — are exactly the ones that will never run a dev server or open a
DevTools window. `FrameProfile` is therefore armed by a **setting**
(`Settings.profiler`) or by **`?profile`**, never by `import.meta.env.DEV`;
disarmed, every entry point returns on its first line and the ring is not
allocated. Measured cost while armed, three paired runs: **under 1.5% of frame
rate**, of which the span calls are ~5 us a frame (0.22 us a pair, ~22 pairs —
and ~4 more since, for the spans inside `render`) and the rest is
`SceneInstrumentation`'s observers. The probes that say so run on
the DEVICE and land in every capture.

**It records CONTINUOUSLY and the capture reaches BACKWARDS.** You cannot watch
a graph while playing a first-person shooter with two thumbs, so the ring holds
`CONFIG.profiling.frames` (3,000 — 50 s at 60 Hz, 12.5 at 240) and the gesture
is pressed AFTER the hitch: `F3` on a keyboard, the chip's buttons on glass.
**Nothing allocates PER FRAME while it is recording** — no per-frame object, no
label string, no closure — because `FINDINGS.md` §1's leading suspect for the
hitch this exists to find is GC, and a profiler that allocates per frame
manufactures the bug it was built to catch. The one exception is per
COLLECTION: the sentinel below.

**What a hitch IS is relative, because a fixed bar degenerates on the device
this was built for.** A phone holding 30 fps spends 33 ms in every frame, so at
`CONFIG.profiling.hitchMs` (24) alone every frame is a hitch, the list floods
and a capture's headline reaches back three seconds instead of fifty. The bar
is that floor or `hitchFactor` (2.5) times what the device has lately been
managing, whichever is larger, and both it and the floor are in every report.
Measured under a 6x CPU throttle applied mid-session: **292 of 687 frames filed
at a fixed 24 ms against 25 on the relative bar**, all 25 in the ~1.5 s the
floor takes to follow the step.

**It watches the COLLECTOR, which is what §1 has always suspected and nothing
could see.** A `FinalizationRegistry` sentinel — one object per GC event, none
per frame, no flag needed — puts a count on every frame, so a hitch whose spans
do not add up to its wall clock is read against it: collections on it is the GC
pause, none is the browser. **The heap itself is usually FROZEN** (Chrome
rate-limits the bucketised `performance.memory` to one update every twenty
minutes) and `probeHeapLive` says so on arming rather than letting a flat line
read as an idle heap; `--enable-precise-memory-info` is what makes it live, and
where it is, `memory.allocMbPerSec` is the number to watch — **27.4 MB/s at 2.2
collections a second on Hollowmere**, the first real figure behind §1's oldest
guess.

**The brackets live in `Game.ts` and nowhere else, with one exception that is
INSIDE the render.** `tick`, `updateGameplay`, `updateNetWorld` and
`updateWorld` are where the frame's order is already declared, with the argument
for it written down, so **the phase list IS that order** and no system had to be
taught the profiler exists. A phase is a name in `PHASES`, a parent in
`PARENT_OF` and a `begin`/`end` pair; the ring, the report and the trace are
all sized and labelled off that list. The spans NEST and do not partition — read
a report as an attribution, exactly as `buildProfile`'s does for the build.

**`render` is four spans deep now, and they are the exception because there is
nowhere in `Game.ts` to put a bracket inside `scene.render()`.**
`FrameProfile.hookRender` hangs `shadowPass`, `glow`, `drawWorld` (rendering
group 0 — the map and the bodies) and `drawOverlay` (the groups above it —
the sky shell, the moon, the viewmodel) off the SCENE's own observables when the
profiler arms and takes them off when it disarms, finding the shadow map through
`scene.lights` and the glow through `scene.effectLayers`, so no system knows
about them either. **They cannot overlap and the method carries the proof**:
Babylon runs the render targets before it opens the draw phase, the camera's
pass inside it, and the glow's compose after it closes — which is also why the
group spans are gated on that draw phase, since a render target's own rendering
manager fires the same scene observable. **What they measure is CPU**, and under
`compatibilityMode = false` that is the recording of a render BUNDLE rather than
the work the GPU then does.

**The `TRACE` export CENTRES its window on the worst frame in the ring**, not on
the present moment — a 600-frame tail is seven seconds against a thirty-five
second ring, so the frame you reacted to was routinely not in the file and
nothing in the file said so. It is clamped to what the ring holds, and it names
its own window in the Perfetto track title and marks the worst frame with an
instant.

**Three limits, and each is recorded into every capture rather than left to
prose.** The clock is quantised to **100 us** (Chrome, absent cross-origin
isolation, which `docker/default.conf.template` does not set) while most phases
cost under 120 us — so a mean over a window converges but a small phase's
PERCENTILE is quantisation noise, and `clock.belowGrain` names the rows that
applies to. And the frame is draw-call bound, so the JS spans attribute the
third that was never the problem: `SceneInstrumentation`'s draw count, mesh walk
and render-target time are carried beside them for the rest. And the heap is
frozen on a stock browser, which is the paragraph above. **GPU time is not
here** — Babylon can read it, but only if `timestamp-query` is requested at
device creation and `main.ts` calls `initAsync()` with no descriptor.

**A capture is READ at `/profile_viewer.html`**, one import-free, network-free
page in `public/` served from the game's own origin — because the loop has to
close on the device that is slow, and a viewer you must mail a file to is one
nobody uses. **The chip's `VIEW` button hands the full report straight over
through `localStorage`** and opens the page: same origin, so no clipboard, no
paste, no file, and nothing leaves the device. That path is spelled in THREE
places — the file in `public/`, `sw.js`'s `DOCS`, and `ProfileChip`'s
`VIEWER_PATH` — and every way of missing one fails silently. It draws the verdict, the attribution ladder, the timelines and a
flame chart, and **the capture states its own phase tree** (`ProfileReport.tree`
from `PARENT_OF`, typed so a new phase does not compile until it names its
parent) so the reader is never guessing this build's nesting. It is the SECOND
navigable document, so **its path is in `sw.js`'s `DOCS`** — without that it
works online and silently becomes the game offline, which is the one case it
exists for.

→ **[`docs/profiling.md`](docs/profiling.md)** — the phases and what each one
covers, how to take and read a capture, the viewer and the three rules for
editing it, the relative hitch bar and what it was
measured against, the sentinel and the heap probe and how to read a hitch
against them, the trace export and Perfetto, what `frame`'s own share means, the
three-rung clipboard ladder, and the levers (cross-origin isolation,
`timestamp-query`) that are deliberately not in it.

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
under ONE table and a table sized per map would renumber every player on team 1
at every rotation. **What the map decides is the ROUND**: `MapLayout.perTeam`
reaches the authority through `setFielded`, so Sarab is 24v24 online as well as
off and the wire mentions only the slots a round fields. **What the map may
never decide is the SEATS**, which stay at sixteen — the smallest roster in the
rotation, so that a rotation takes bots off the field and never a person out of
a seat. Every slot nobody is sitting in is a bot: a human joining BENCHES the
bot in their slot and leaving un-benches it. **Benching is not killing** — joining and leaving must never
charge a team a reinforcement — the bench lives in `BattleSystem` as a `Set<Bot>`
and never as a flag on `Bot`, **every loop over `bots` there must skip it**
(through `aside`, which also covers a tank's crew), and **a slot index IS a bot
index**.

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

**`decode` proves only that a frame is JSON with a `t` on it, so a
`ClientMessage` is a CLAIM and never a fact**: `server/wire.ts` is the one door
that makes it one, nothing else on the server may read a frame, and a new client
message type owes an arm in its switch.

**There is more than one match server, the CLIENT holds the list, and none of
them knows another exists.** A `Region` carries BOTH its urls, resolved together,
and **a match id is minted per process, so every region has an `m1`** — every
row, join and identity is qualified by REGION as well as id, and **two processes
behind one hostname is forbidden**.

→ **[`docs/multiplayer.md`](docs/multiplayer.md)** — the authority model and what
it does not defend against, the roster and the bench, the deploy ask, what a
death owes each side, the interpolation clock and its easy sign error, the
rewind, the lobby and the regions' two headers, and what is not built.

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
  EXACTLY instead** — recoil decay uses true `Math.exp(-rate * dt)` because burst
  climb must not vary with frame rate, and the viewmodel's kick spring is stepped
  in closed form at a stiffness Euler cannot hold. The landing absorb next door
  is semi-implicit Euler and may stay that way. Frequency decides which you need.
- Recoil only partly springs back: `CONFIG.recoil.recoverFraction` (0.7) returns 70%
  and pushes 30% permanently into the player's own `pitch`/`yaw`, so a magazine held
  down genuinely walks off target. An explicit product decision — a fully-recovering
  version was rejected. **`CameraSystem.addFlinch` is the one aim kick that is
  100% springy and must stay that way**: a hit *taken* is not a choice the player
  made, so a permanent share would ratchet the view skyward over one exchange. It
  shares the recoil spring rather than owning one, for the reason the bob phase
  has a single integrator.
- **A string of shots has a SHAPE, and the shape is two envelopes over one
  counter.** `CONFIG.recoil.pattern` tapers the vertical toward `pitchSettled`
  and ramps the horizontal up from `yawStart` across `patternShots`, both keyed
  to `Player.stringShots`, so the kick's *direction* rotates as a string runs.
  The pair is tuned to leave the total walk alone (10.6 deg of climb and 2.4 of
  drift over the rifle's magazine), and **those two figures are derived —
  re-derive them rather than assuming they followed** whenever `pattern`,
  `pitchPerShot`, `yawPerShot` or `firstShotMult` moves.
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
