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
| [`docs/rendering.md`](docs/rendering.md) | lights, shadows, fog, outlines, the post chain, the sky |
| [`docs/world.md`](docs/world.md) | a map, a layout, a builder, the terrain or the rim |
| [`docs/editor.md`](docs/editor.md) | anything under `src/editor/` or the dev write endpoint |
| [`docs/bots.md`](docs/bots.md) | navigation, perception, cover, squads, bot cost |
| [`docs/deaths.md`](docs/deaths.md) | ragdolls, glass shards, Havok, the death cam |
| [`docs/vehicles.md`](docs/vehicles.md) | the tank, its hull collider, the chase camera, mounting, the respawn |
| [`docs/antitank.md`](docs/antitank.md) | the third slot, the launcher, the mine, the rocket that flies, a bot with a tube |
| [`docs/pwa.md`](docs/pwa.md) | `public/`, `src/pwa/`, the service worker |
| [`docs/multiplayer.md`](docs/multiplayer.md) | anything under `server/` or `src/net/`, the roster, the collision bake, the regions, the two images and the proxy in front of them |
| [`docs/game.md`](docs/game.md) | extracting anything from `Game.ts`, `installMap`, what a frame owes |
| [`docs/build.md`](docs/build.md) | adding a generated asset, `vite.config.ts`, anything importing from `@babylonjs/*` |

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
live view. `loading` (the map being built) and `dying` (the death cam) are
**STEPS, not lids**; `updateWorld` runs in full under the death cam and nothing
may simulate under the building card.

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

→ **[`docs/ui.md`](docs/ui.md)** — the shell, the four cards as one class, the
menu's rail and the map schematic drawn from a LAYOUT, why **the pointer deploys
only through the Deploy button**, the deploy map, the kit turntable, the settings
panel, the lobby's row identity, the short-viewport scaling, and the touch
controls as a screen — with [`docs/pwa.md`](docs/pwa.md) for them as a phone.

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
must hold the canopy. **Anything a collider stands in for may never sway**, and
**a swaying merge group draws its own ink** through `MapBuilder.inkTwin`.

**Water is a MIRROR with a dark body under it, and it is SAMPLED FROM NOTHING** —
directional wave trains, no normal map, and re-adding one brings back four rules
that existed only to hide its lattice.

**The world is OPAQUE with exactly one exception, and it is glazing.** Glass you
can see THROUGH is `getGlass` over a cube `ReflectionSystem` bakes **one per
GLAZED BLOCK** — not one for the map, not one per material. Glass you cannot is
`Build.pane({ backed })`, which composites the mass behind it arithmetically and
therefore writes DEPTH; **it pays only if the pane is drawn first**, which is why
`Game`'s constructor sorts the opaque queue FRONT TO BACK, and **`backed` is a
claim about the WORLD that nothing throws over**. **No pane of either kind is
outlined or a shadow caster.**

→ **[`docs/rendering.md`](docs/rendering.md)** — the water's wave field and mirror
and the three ways a cube probe goes flat, the four light terms and the colour
buffer's three further rules, the ink's tint, the wind's two bounds, the
muzzle-flash budget, the fog split, the shadow window, the reflection bake's
seven load-bearing details, the painted sky, and the WGSL dialect's own traps.

### The map is data, not code

`src/world/hollowmere/layout.ts` is the entire level — placements, scatter
regions, control points, spawns, the water/grass/terrain rects — and `MapBuilder`
special-cases nothing, so **a second map is one new layout file plus an
`EnvironmentSpec`**. Every figure on the menu's map panel is read off the layout
and the environment, so nothing countable is stated twice. The two halves are
paired in `src/world/maps.ts`, which with `vite.config.ts`'s `WRITABLE` table and
`scripts/collision-hash.mjs`'s `MAPS` are the only existing files a new map
touches, and **nothing outside `maps.ts` may import a map's own modules**. A
`MapDef` must be a **module constant**, `Game.mapDef` may only be written from
`menu`, and **scatter placement is seeded — never call `Math.random()` in
world-building code**, or the nav graph differs between page loads.

**Four things that read like global constants are the MAP's**, each defaulting so
that a map saying nothing is unaffected:

| the map's | default | what a map that raises it owes |
| --- | --- | --- |
| `MapLayout.size` — how big it is | `CONFIG.map.size`, 240 | `terrain.size * terrain.cell` must equal it, and the rim's boundary boxes must stay over 200 m so the seven sites keying on `w > 200 \|\| d > 200` still can |
| `EnvironmentSpec.fogEnd` — how far you can see | `FOG_WALL` | it is pushed into `BattleSystem`, `NetRoster` and `RagdollSystem`; `audio.maxDistance` (70) and `bots.perception.engageRange` (55) did **not** move with it, so a clear map must be laid out knowing that |
| `MapLayout.surfaces` — how deep it stacks | `CONFIG.nav.maxSurfaces`, 3 | only a map that stacks FLOORS raises it; overflow drops candidates silently (see the bots section) |
| `EnvironmentSpec.lighting.shadowWindow` — how far its shadows reach | `CONFIG.graphics.shadows.frustumSize`, 110 | shadow length is `h / tan(elevation)`, and `shadowVisibility` returns FULLY LIT outside the window rather than fading — an undersized one draws a line across the ground rather than softening |

**A map is CLOSED one of two ways, and the second has no wall at all.** The rim
is four boxes at `±size/2` under `Ridge`'s escarpment, and is what three of the
four are. `MapLayout.borderland` is the other: the floor carries on for a
`margin` past the play square — `TerrainField` continues the field, so nav, the
roads, the grass and **`server/validate.ts`** agree for free — and what stops you
leaving is `src/world/leash.ts`, a countdown rather than a shape. **It is sized
by the leash, it kills on the AUTHORITY and only draws on a client, and bots are
never leashed** — the nav graph stops at the play square.

**The shipped maps are Hollowmere** (a night village), **Greyfen** (a jungle
valley), **Coldharbour** (a business district — what the first three overrides
exist for) **and Harrowmead** (`size: 400`, no wall around it). **The last two
are the two with armour on them**, and they are the two biggest.

→ **[`docs/world.md`](docs/world.md)** — the four overrides in full, the
heightfield and the road slabs cut against it, the winding trap that makes a
floor vanish, the builder and two-pass merge rules, the layout gotchas that have
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
`BattleSystem`'s LOS, `Player.probeGround`, the grenade's step ray, the death cam's
pull-in — and `moveWithCollisions` walks every mesh with `checkCollisions`. At
village scale, visual geometry must stay out of both.

| Kind         | visible | pickable | collides | `solid` | merged | frozen |
| ------------ | ------- | -------- | -------- | ------- | ------ | ------ |
| **Visual**   | yes     | **no**   | **no**   | —       | yes    | yes    |
| **Collider** | **no**  | yes      | yes      | yes     | no     | yes    |

Colliders must line up with the surfaces they stand in for or bullet sparks land
off the visible geometry. `MapBuilder.collider()` is the only place that creates
them, and it also records a `WorldBox` for the nav grid — geometry added by any
other path is invisible to navigation.

**A collider answers two questions and they can disagree, which is why there are
two pick predicates and not one.** *Where may a body be?* is `SOLID_ONLY` —
`Player.probeGround`, the death cam's pull-in, the editor's centre-screen pick.
*What stops a round or a look?* is `OPAQUE_ONLY` — the hitscan and its wall cap,
the bots' and the aim assist's LOS, the grenade's step ray and its blast check.
Both live in [`src/world/solid.ts`](src/world/solid.ts) and both are module
constants, never minted at a call site. So a collider is one of three things,
and a builder picks which by how it declares the box:

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

**`glass` is the one thing in the world that CHANGES, and it needs no new
predicate to do it.** A breakable pane is `porous` exactly, so both predicates
already get intact glass right, and breaking it clears `solid` itself — one
property write rather than a term every ray in the process evaluates.
`WorldBox.glass` exists only for the readers that must SKIP a pane rather than
merely pass a round through it: `CoverMap`, the AO bake, and the collision bake.

**Colliders are MERGED, because a pick costs per MESH long before it costs per
triangle.** `MapBuilder.struts` merges a placement's struts into one mesh (161
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
  through anyway (`OPAQUE_ONLY` subtracts it; `SOLID_ONLY` keeps it). Declared as
  `BoxSpec.porous` by the builder, carried on the `WorldBox` and into the
  collision bake, and skipped by `CoverMap`. Today it is the fence's coarse run,
  and only that.
- `rayOnly: true` — the mirror: a `solid` collider that stops a round and a look
  but is no body at all (`SOLID_ONLY` subtracts it, `OPAQUE_ONLY` keeps it), and
  the one collider that emits **no `WorldBox`** — invisible to the nav grid, the
  cover bake, the obstacle field, the AO bake and scatter placement. Declared by
  `Build.strut`, merged per placement, baked in groups. Today it is fence posts
  and rails.
- `noOutline: true` — skipped by `addOutline()`. Every emissive part (eyes, flames,
  signs, reticle) needs it. Outlines are coloured ink (a darkened take on the mesh's
  own cel colour), thinned with distance per mesh by `updateOutlineScales()` and
  faded into the fog per pixel by `OutlineFog`. **How far it is darkened is the
  MAP's**, derived by `setEnvironment` PER CHANNEL from `ambient * (1 -
  ao.strength)` — the darkest light the shader can put on any pixel: the ink is
  unlit and the surface under it is not, so a tint above that light term inverts
  into a bright halo, and deriving it from anything but the true floor leaves the
  creases, the undersides and the weakest channel still inverted.
- `noGlow: true` — excluded from the `GlowLayer` in the `Game` constructor. Only
  meshes existing at construction time are scanned. A mesh that stays in bloom
  is faded with distance instead (`customEmissiveColorSelector`), and
  `infiniteDistance` is that fade's one exemption — it is what every sky mesh
  sets, and the moon is not in the valley to be fogged out of.
- `noShadowCaster: true` — excluded from `ShadowSystem.setCasters()`. Flat receivers
  (ground, roads) need it: casting from them is pure shadow acne.
- `noReflect: true` — excluded from every cube probe's render list
  (`ReflectionSystem.opaqueWorld`). Today it is the ink twins and only them, and
  it is not a tidiness flag: an ink twin is an INVERTED HULL, which is a thin
  line seen from outside and a sealed room seen from within, and a probe parked
  against a tower's glass stands inside its own block's hull. All six faces come
  back one flat ink colour and the glazing reflects a grey card. Measured on
  Coldharbour's curtain wall at 85% of the frame's pixels.
- `block: "3,2"` — which 48 m map block a merged visual came from, written by
  `BlockMerge.finish`. A **value**, like `surface`, and absent on everything
  that is not block-merged — the terrain, the roads and the rim, which is what
  keeps them out of the test that reads it. `ReflectionSystem.encloses` is that
  reader and the only one: a probe drops its own building from its bake, and
  since the albedo palette took the colour out of the merge key there is no
  longer any geometry-shaped way to ask which building a mesh IS.
  `PaneBlocks` files glazing under the same key, which is what lets the two
  agree without measuring a distance.
- `surface: "ground"` — what a round that stops here kicks up. The odd one out:
  it is a **value with a default**, not a flag, and **absent means `"hard"`**.
  `MapBuilder` sets it on exactly one thing — the terrain floor's collider clone
  — so every wall, prop and roof in the village answers by omission and a new
  collider needs no thought at all. Read by `CombatSystem` to pick the impact's
  spark, its dust disc and its sound. Adding `"wood"`/`"metal"` is one member of
  `ImpactKind`, one row in that file's `IMPACTS` table, one arm in `Sfx.impact`
  and a `surface` argument on `collider()`; no signature in between moves.

### Bots: navigation, scaling, perception and squads

`NavGrid` is built from the finished collider set at map load, and its node is a
**surface** — a (cell, height) pair — not a cell. The cap is
`CONFIG.nav.maxSurfaces` (3) unless the map raises it, and overflow **fails
silently: the candidate that does not fit is DROPPED, in arrival order**, which
makes a BUILDER's collider order part of the design — walked surfaces first,
cover next, roofs last. One flow field per objective is precomputed and nothing
is recomputed: **bots read `nav.steer()`, never run their own pathfinding, and
never use `moveWithCollisions`**. `ObstacleField` is the sub-cell half, and its
push-out is a preference, never a veto.

Three things carry the frame budget and undoing any costs ~10x draw calls or a
permanent hitch: the rig pool is built once and never disposed, a rig is nineteen
merged meshes, and AI is staggered round-robin at `CONFIG.bots.thinkRate`.
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

**A bot inside a TANK is out of all of this** (see the vehicles section), and
what it costs this layer is one rule: `BattleSystem.aside` is the skip test every
loop over `bots` owes, never `benched.has`.

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

### Vehicles: one hull, and the exceptions it is

**A tank is a `Combatant` you get INSIDE.** `MapLayout.vehicles` is one
hardstanding per team — absent on two of the four maps — and `Game.driving` is
the single fact the feature turns on. **`mount` and `clearVehicle` are exact
inverses and must be read as a pair.** **A driver's frame is not a body's**:
`Player.update` is not called, so the hull's ground REPLACES the probe. **The
verb is `E`, the pad's d-pad north and a button that APPEARS on glass** — one
`usePressed`, and `Game.offerUse` is the one door that names it, because a phone
has nothing to press until something is drawn under it.

**In a NETPLAY round a driver simulates their own hull and REPORTS it, exactly
as they do their own legs; every other hull is posed from the wire** by
`Tank.updateRemote`. `Tank.predicted` says which — it refuses local damage as
`NetSoldier` does and stands both hardstanding clocks down. **Getting in and out
are ASKS the authority answers**, and **occupancy is stated once, on the hull**.

**A hull is the one MOVING `solid` mesh in the game, and that is the RAGDOLL's
rule rather than an exception to the world layer's**: it is in both pick
predicates and has `checkCollisions`, but emits **no `WorldBox`** — so the nav
graph, the cover bake, the obstacle field and the collision bake have never heard
of it, and **bots walk through a parked tank as they walk through a corpse**. Its
box covers the TURRET, and **anything picking a hull out of its own way owes two
property writes rather than a predicate** — `world/solid.ts` forbids minting one.

**A tank DRIVES OVER things, and `climbHeight` is the one number deciding what is
ground and what is a wall** — the collision ellipsoid's floor AND the ceiling of
the band a track contact accepts a surface from, two uses that must never drift.

**What a hit is worth is a `DamageKind`** — the third parameter on
`Hittable.takeDamage`, which only a tank reads, and `CONFIG.vehicles.tank.resist`
is where what each kind is worth against armour is written down. **The reticle
still cannot lie**: the look is an ORDER the turret walks toward, the shell goes
down the GUN's axis, and `#gun-marker` draws where the barrel points.
**Everything else on the hull that moves is a PICTURE** — the collider never
tilts, nothing is pickable, and the gun is aimed in WORLD angles.

**BOTS DRIVE, and a driver is not a bot with a vehicle attached.** A crewed bot
leaves `Bot`'s FSM entirely — `BattleSystem.crewed` is the BENCH's twin and
**`BattleSystem.aside` is the one skip test every loop over `bots` owes**, never
`benched.has` — while keeping its LIFE, its POSITION slaved to the hull and its
SQUAD'S ORDER, which is what it steers on. **A tank is never a DESTINATION**, and
**a crew never denies the player their own armour**: `TAKE OVER TANK` evicts and
mounts on one frame. `resolveShell` is the ONE round out of a tank gun (`Game`'s
offline, `HeadlessGame`'s in a match), and a driver needs no route graph — a
BEARING and `Tank.rideableAt` are all of it.

→ **[`docs/vehicles.md`](docs/vehicles.md)** — the crew, the whisker fan and the
two geometry bugs it found; the collider's three answers; the model's twenty-four
meshes, its tracks and its whips; the plank, the rate limit and the leading-end
sphere; the damage kinds, the four ways out of a seat, the shell, the two clocks
a hardstanding runs, what a map owes, and what is not built.

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

A pane breaks and never mends inside a round, and that monotonicity is what makes
the incremental nav-graph update safe rather than merely cheap: the graph only
ever GAINS links, so a route that was valid still is.

**A round has to pass THROUGH glass, so a pane can never be in `OPAQUE_ONLY` —
which means the hitscan's wall pick can never report one.** `CombatSystem.fire`
raises `onShotPath` with the segment the round flew and `GlassSystem` answers it
analytically; the same code runs on the authority, off the collision bake. **A
pane's index in `GameMap.panes` is its identity** on both sides and on the wire,
`npm run parity` proves both build the list in the same order, and breaking is
the AUTHORITY's. **A pane is see-through, a FAIRNESS rule and not a look**:
`OPAQUE_ONLY` already lets a bot shoot through a window.

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
drift — and `awardKill` is the one place a payout's shape is decided, keyed on
**the flag the VICTIM was standing in, never the killer's own position**.
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

### The installable app

The build installs to a home screen and launches fullscreen, landscape and
offline. Four files carry it — `public/manifest.webmanifest`, `public/icons/`,
`src/pwa/register.ts` and `src/pwa/sw.js` — and nothing in the game knows any of
it exists. Three rules are about the DEVICE rather than the game: a tap arrives
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

**The roster is sixteen slots, built once, never resized**, and every slot nobody
is sitting in is a bot: a human joining BENCHES the bot in their slot and leaving
un-benches it. **Benching is not killing** — joining and leaving must never
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
`DriveMessage` replaces `MoveMessage`, which is what `validateDrive` is for.

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
