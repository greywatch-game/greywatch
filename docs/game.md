# The wiring hub: what `Game` owns, and what may leave it

Why the one place systems meet is a long file on purpose, the mechanical test
for what may be extracted from it, the single funnel every map is built through,
and what is pushed from `tick` rather than from a state's own arm. Split
out of [`CLAUDE.md`](../CLAUDE.md), which keeps the wiring rule itself and the
end-of-frame order; this file is the contract for `src/core/Game.ts` and for
anything proposing to make it smaller.

The rule this file exists under is in the spine and is not repeated here:
**systems never import each other; `Game` wires them with callbacks.** Everything
below is a consequence of that, including the reasons a refactor keeps wanting
to undo it. **Since `BABYLON_EXIT.md` X2.5a C4a the systems that DECIDE a round
are not among them**: offline they are the simulation core's (`src/sim/SimCore.ts`),
as they are the authority's in a match — see "Offline, the round is the core's"
below.

## Offline, the round is the core's

`Game` holds a `SimCore({ hostHoldsRespawn: true })` (`core`) and simulates no
round of its own. **Three doors, and no fourth**:

- **`ask`** submits one of the local player's acts as a `SimCommand`
  (`src/sim/commands.ts`) — the walk every frame (`move`, after
  `Player.update`), a round with the cone already rolled on the page's own
  `STREAM.player` (`shot`, from the eye, the viewmodel muzzle for the tracer
  only), a throw and a rocket from the viewmodel's hand and muzzle, a mine at
  the `standableAt` point, the kit and the deploy, a mount, a crossing (a
  `mount` naming the hull the player is in), a dismount, the hull's guns, and
  — every frame a seat is held — the hull or the ring this page PREDICTS
  (`drive`/`gun`, `reportHull`/`reportGun`, X2.5a C4b). Every one is trusted;
  the core still refuses what its own state makes impossible.
- **`core.step(dt)`** once a frame, in `updateWorld` — in every state that
  steps the world (`playing`, `dying`, `bench`) and none that holds it.
- **`drainSim`** after every call made on the core, which hands every event the
  core wrote to **`onSimEvent`**, one switch, in emission order. It is
  presentation only — the tracer, the corpse, the killfeed line, the marker,
  the blast, the fire's light, the pane, the seat — and **wherever a match has
  the same news it ends in the method `onNetEvent`'s arm ends in**
  (`playerHit`/`playerDown`, `seatAnswer`, `playerSpawned`, `roundPassed`,
  `flagCaptured`, `breakPane`, `fireLit`), so offline and online cannot drift
  for the player.

**The frame's order offline** (`updateWorld`): `BattleView.beginFrame` → the
core's step → the hull trigger (`pullHullTrigger`) → this page's fleet POSED
off the core's (`syncFleet` with `FleetMirror`, `vehicles.update` answering
`remoteFor` for every hull but the one under a driver) → the driver carried
after his hull (D4) → `drainSim` → `VehicleViews.update` → `BattleView.update`
and the flash budget → `stepShots` → `stepAftermath`. The fleet is posed BEFORE
the drain so every event that names a hull finds it where the step left it; the
views update AFTER it so a gun the core fired this step has kicked
(`Vehicle.mirrorShot`).

**The hull under a DRIVER is this page's prediction, as in a match** (X2.5a
C4b): `driveFor` steps it off the sticks inside that `vehicles.update`, and
`updateDriver` reports where the LAST step left it (`drive`, before the core's
step), so the core's copy is posed one frame behind and stands exactly where
this page's does at one moment of the frame — between the core's step and this
page's fleet, which is why the trigger is asked THERE rather than at the key
(`hullTrigger`, set in `updateDriver`): the round leaves the gun the player is
looking at, and its kick (`mirrorShot(true)` — the loader, the shove, the rock,
the masts) lands before this page's hull steps, as a match's predicted shell
does; the core's `hullKicked` for that hull is not mirrored again. That ask is
made WITHOUT a drain (`ask(cmd, false)`), so its news waits in the ring behind
the step's and is drawn after the fleet. A gunner's ring is the same bargain
(`gunFor` lays it here, `gun` reports it). The core still crushes, burns and
seats off its own copy — a frame behind, which is a match's arrangement with
the latency taken out.

**The page's own `Player` is the prediction a match's client runs**: its
sweep, its ground, its stance, its regen for the HUD and the camera. Its health
is ASSIGNED from the core's `damaged` (`applyServerHealth`), its death is the
core's (a leash expiry included, D3), and its body is put in the world by the
core's `spawned` answer to a `deploy` — which, with no respawn clock of the
core's own to wait for, is honoured at submit (D21) through the same
`deployPerson` door the reinforcement pass uses.

**What the page's VIEWS read of the core** — the bots `BattleView`'s rigs
follow, the flags and the tickets the gauges draw, the pools `GrenadeFx` and
`AntiTankFx` pose, the crew table the seat prompts ask, the book the board is
drawn from — goes through `core.live`, **temporary and enumerated**
(`SimLive`): C5 replaces each member with a mirror off the frame and the ring,
and `live` goes. Which roster, which flags and which pools a view reads is
asked through one accessor each (`rosterRead`, `flags`, `simGrenades`,
`simAntiTank`), the core's offline and the page's own netplay mirror or
prediction in a match.

**The page keeps only its netplay prediction systems** — `combat`, `grenades`,
`antiTank`, the fleet, `glass` and `conquest` as the wire's mirror — and steps
none of them offline but the fleet (posed, and the player's own hull predicted)
and the glass (the core's `glass` applied). There is no `BattleSystem`, `VehicleCrew` or `ScoreBook` on the page.

**The core's world is the page's map as DATA**: `buildRound` hands it
`collisionOf(map)` (the bake's own read of the build, `src/world/collision.ts`)
with the floor, the tier, the per-map pool fielded whole and the round's seed,
inside the building card's freeze. Per-map pool, because the slot layout IS
the fight: the benchmark's seven fight hashes are the ones the page's own
simulation fought. `teardownMap` releases it (`SimCore.releaseWorld`), so the
menu, the editor and a match hold no second world.

## The constructor takes what it cannot build, and stays SYNCHRONOUS

**There are two arguments beside the canvas and they are arguments for the same
reason**: `havok` is the instantiated physics WASM and `engine` is a
`WebGPUEngine` whose `initAsync` has already resolved. Both are awaited by
`main.ts`, both are REQUIRED, and a failure of either is the boot screen's
business — so nothing in this file is written twice for a machine that never got
one, and there is no init state, no `ready` flag and no "has it arrived yet"
question anywhere below.

**The engine used to be built here**, back when it was a `WebGLEngine` with a
synchronous constructor. WebGPU's is not — an adapter and a device are both
promises — and the shape that fell out is the one `havok` had already taken
rather than a second, differently-shaped one. What did **not** happen is the
obvious alternative: `Game` is not a `static async create()`. That would have
moved the awaits inside and cost the property this file's own testability rests
on — `window.__celshock` non-null with every pool built the moment the
constructor returns, which ~40 smoke scripts assume (`VERIFYING.md`). Awaiting
in `main.ts` and injecting the result keeps both true at once.

**Nothing about the engine's OPTIONS lives here either.** `antialias: false`,
`stencil: false` and `powerPreference: "high-performance"` (the hybrid-laptop
adapter hint, shared with both bare `requestAdapter` probes so all three ask
about the same GPU, and dropped for the whole boot by the gate rather than
retried per site if a browser ever refuses it) are stated beside the
`initAsync` call in `main.ts`, with the argument for each — and `stencil`
picks the depth FORMAT under WebGPU, which is what `GLASS_DEPTH_UNITS` and the
outline z-offsets are measured in (see [`rendering.md`](rendering.md)). A
change to any of them is a change to numbers three files away, so it is made
where it is explained.

## What may leave `Game.ts`, and what may not

**`Game.ts` is long on purpose, and what may leave it is mechanical so nobody
has to re-argue the line count.** It is the only place systems meet, so most of
its length *is* its job — and splitting the wiring re-creates exactly the
system→system edges the rule above spends itself preventing. What may leave is a
cluster of **private fields that answers only to itself**: nothing else in the
file reads them, and the methods over them touch no system, no mesh and no
frame. There are two worked examples. `net/HitCredits.ts` is the smaller and
the plainer: the queue of rounds this client has already cued a hitmarker for
was one field and three methods that no line outside them touched, so the rule
that a landed round is announced ONCE is now stated in one file that flashes
nothing, plays nothing and never reads the wire — `Game` spends the answer and
draws the cue, which is the two halves below staying behind exactly as they
should. `net/RegionBook.ts` is the larger — the region list, its one
read, the player's pick, the automatic pick and the pings ranking it were six
fields no line outside the five lobby methods over them ever touched. What may
**not** leave is anything whose methods reach across systems, however big it
gets: the netplay client is the biggest cluster in the file and touches ~35 of
its members across a dozen systems, so extracting it would hand a constructor
`Game` itself or twenty callbacks — moving the coupling into a signature rather
than out of the file. **Two halves always stay behind**, and they are what makes
an extracted module a module: what PERSISTS (`prefs.ts` stores, `Game` spends)
and what DRAWS (every push at a screen is made from here). So such a module
hands its result *back* — `choose` and `note` return the row to light up — and
never acts on it.

Judge the file by its **code** lines, not its length: it is more than half
prose, and the contract headers this project runs on are not what a refactor
should be measuring.

The two halves that stay behind are worth stating as a test rather than as a
description, because they are what an extraction is judged by afterwards. If the
new module reads a preference, it has taken half of what `Game` spends. If it
touches a screen, it has taken half of what `Game` draws. Either one means the
next change to that behaviour has two files to visit, which is the cost the
rule is paid to avoid — and it is not detectable from the new module's own
line count, which is the number that motivated the extraction in the first
place.

## `installMap` is the one place a map is built

**`installMap` is the one place a map is built**, and both callers — a round
starting and an editor rebuild — go through it. It disposes the standing map,
builds `this.mapDef`, and hands the result to every system that reads geometry or
environment off it: shadows (casters, key light, fog range), atmosphere, water,
grass, the player's terrain, the grenade pool, the physics body — and every
simulation's PICTURE beside it (below). It was once two
copies that had drifted apart, and the failure is silent: a system added to the
round's copy and forgotten in the editor's keeps a cached pointer into a *disposed*
map, so the editor renders last build's water over this build's terrain and
nothing throws. **Anything new that consumes a `GameMap` or an `EnvironmentSpec`
goes in `installMap`.** What stays with the callers is what they genuinely
disagree about: the round applies the environment and repaints the sky while the
editor drives `applyEnvironment` itself so it can toggle its work light, and the
round alone owns what is about a *fight* — the core's round, flag markers,
minimap.

**A simulation and its view are handed the map on adjacent lines, and a view
is handed only what its own picture reads.** The split is `CLAUDE.md`'s
("Ownership and wiring"): the simulation owns the state on `src/math`, the view
reads it and never writes it, and the authority builds the simulations alone —
so every view's line here has no twin in `SimCore`. The one node an
outcome still reads is offline, the player's throw hand and launcher muzzle
(`FINDINGS.md` 55). `CombatFx` takes
`map.rays` (its `drawRounds` casts for itself); `GrenadeFx` takes `map.rays`,
the terrain and the environment (a fire's flames stand on their own floor
probe, and the map decides what colour a blast's dust is); `GlassFx` takes the map,
whose merged glazing it collapses; `BattleView` takes the body draw distance
with `RagdollSystem`; and `VehicleViews` builds one view per hull right after
`vehicles.build`, by hardstanding. **Two views take nothing from a map**:
`AntiTankFx` draws its simulation's pools and nothing else, and `PlayerView`
is the viewmodel on the camera. `BattleView`'s rigs are the ROSTER's, not the
map's — offline the core's, none in a match (`rosterRead`): `buildRound`
resizes them (`syncPool`) after the core's `startRound`, and every reset of
the round owes a `hideAll` beside it.

**Its disposal half is a method of its own, `teardownMap`, and the MENU calls it
alone.** It puts every system `installMap` hands a map to back as it was at
boot: the map disposed and `Game.map` null, the shots' tracers and marks
(`CombatFx.clearTransient`), both ordnance pools AND their pictures
(`GrenadeFx`, `AntiTankFx`), the fleet's views (`VehicleViews`, before the
fleet they draw), the fleet and rotor rings let go, the simulation core's
whole world released (`SimCore.releaseWorld` — its map, fleet, crews and
everything in the air), the water and grass disposed, the reflection probes parked, the mote field
stopped, both shadow maps' casters and the lamps' atlas emptied, the bodies' blob shadows hidden, the traced
bounce's buffers dropped, the candidate list and the physics world cleared (with
their corpses, shards and rubble), and the fires' voices and the storm's thunder
silenced. The menu used to leave the round's map standing as a live backdrop,
which stopped being a backdrop when the menu started standing on a photograph —
from then on it was a whole city rendered under a picture of another one, with
its fires and its shore still audible. **So the rule has a second half: anything
new that `installMap` hands a map to owes a line in `teardownMap` that takes it
back**, or it outlives the round under the title card. It is idempotent and safe
with nothing standing, which the boot and a build that failed its floor fetch
both rely on.

**It also lets go of the map's DATA, and that half is proved rather than
reviewed.** The core's world (released, above), `Player`'s ground, the `rays` eight
systems and views were handed, `GlassSystem`'s panes and `GlassFx`'s meshes, the deploy
screen's and the minimap's copies, `MapBuilder`'s own build scratch and `WorldCulling`'s
candidate array all held the last map through the menu; none of them was
stepped, drawn or heard there, so what they cost was memory — the whole map,
until the next one was built over it. They were found by holding a `WeakRef`
to each part of a map through a quit and asking a heap snapshot for every
direct holder, and after `teardownMap` every one of them is collected in the
menu. **One of them is a trap worth knowing on its own**: V8 gives every
closure made in one call a single shared scope, so an arrow written inline in
`installMap` keeps THAT call's `map` alive for as long as anything holds the
arrow. That is why `Game.deckAt` is a field. **What BABYLON kept of a map is
the last line of it** (`forgetBindGroups`), with its twin installed on the
engine at boot: Babylon's WebGPU arm never frees a released effect's
uniform-buffer pools nor prunes its bind-group cache, which was ~30 MB of heap
and ~28 MB of GPU buffers per Coldharbour build, kept for the life of the tab
(`core/webgpuLeaks.ts` has the mechanism and the measurement).

**It is one SYNCHRONOUS turn and that is why the map's floor is resolved before
it rather than inside it.** A heightfield is a lazy `import()` now
(`MapDef.heights`, ENGINE_UPGRADE.md S7), so the two doors into a build each
await it and put it down on `Game.floor`: `buildRound`, which is async for that
one line, and `toggleEditor`, which already was. `installMap` reads the field
and hands it to `MapBuilder.build`.

The await in `buildRound` is a hole the MAP can move through, and it is covered
rather than assumed away. `NetSession.onSeated` defers to `buildRound` for the
whole of it — `buildPending` is true from `go("loading")` until `openBakeWait`,
which is what makes the deferral correct in the first place — so a welcome
landing inside the fetch would otherwise be applied by nobody: not there,
because it defers, and not in `buildRound`, because the line that reads it has
already run. So the map is settled, the floor fetched, and the map asked again
on the far side; the loop settles in two passes. A fetch that FAILS is
`leaveUnknownMap`'s move — there is no honest half-build of a map with no
ground under it, and leaving the card up would wedge `buildPending` forever.

**Eight of those hand-offs are one line each and one object**, and they are worth
naming because they are new and because they look skippable. `map.rays` is the
segment query every ray in the game asks (`world/RayWorld.ts`), and `installMap`
pushes it to `CombatSystem`, `CombatFx` (whose `drawRounds` casts for itself),
`GrenadeSystem`, `GrenadeFx` (which stands a fire's flames on their floors
with its own probe), `AntiTankSystem`,
`AimAssistSystem`, `DeathCam` and `VehicleCamera`. `BattleSystem` and
`VehicleSystem` are absent from that list and are not exceptions: both are
handed the whole `GameMap`, and both take it off `map.rays` where they take
`nav`, `cover` and `obstacles`. A system that misses this one does not throw
either — it casts against a null world and reports that nothing is in the way,
which reads as a bot with a wallhack or a round that never stops.

**Silent is the operative word.** A system that missed the funnel does not throw
and does not log; it renders, correctly, from a map that no longer exists. The
editor is where it shows first because the editor is the caller that rebuilds
most often, but a round is just as capable of it — and by then the symptom is a
map that looks a build out of date in one layer only, which reads as a bug in
that layer. The funnel is cheap insurance against a class of bug that costs a
day to attribute.

## Both world steps share a tail, and it is one funnel for `installMap`'s reason

`updateWorld` is the offline round and `updateNetWorld` is the client's half of
a networked one, and the second is not a subset of the first — it runs `net`
where the other steps the core, and it poses the fleet off the wire where the
other poses it off the core. What they DO share is ten system updates
that are identical on both sides, in the same relative order, and those were
written out twice.

**They are one call each now, `stepShots` and `stepAftermath`, and the argument
is `installMap`'s exactly.** A system added to the offline sequence and
forgotten in the networked one does not throw and does not log — it simply never
runs in a match. The symptom is a tracer that hangs at the muzzle where the shot
went off, or a fuse that never burns down, or a corpse that takes a rig and hangs
in the air; each of those reads as a bug in that system rather than as a missing
line in a method nobody was looking at. **Anything new that both worlds owe per
frame goes in one of the two, and a system that only one of them owes goes at
its own call site with the reason written there.** The bots' picture is the
worked example: `BattleView.update` runs right after the core's step and its
drain in `updateWorld` alone (a match draws no local bot), before anything
reads a rig —
the bodies' shadow map, the mesh walk, a ragdoll built off a bot's joints in
`stepShots` — and `BattleView.hideAll` sits beside every reset of the round,
so a reset round shows no body for a frame. The body draw distance `installMap`
pushes goes to `BattleView`, `RagdollSystem` and `NetRoster` together. **The
fleet's picture is the same shape on BOTH sides**: `VehicleViews.update` runs
right after `vehicles.update` at each of its two call sites — after the
core's drain offline, after `syncNetVehicles` and the step in a match — before
anything reads a node (the two shadow maps' boxes are off each view's body);
`installMap` builds the views right after `vehicles.build`, one per hull by
hardstanding, and `teardownMap` takes them down before the fleet. What a view
must hear between two of those updates — a placing, a shot, each step's belts
and mass, and a wreck (the battle, the grenades and the rockets that wreck a
hull all step after the view's update) — it is told as it happens, through the
hull's `HullPicture`. A bot's rig is the same case once: a body put back and
killed inside one core step reaches `BattleView.corpseOf` (off the core's
`botDown`, at the drain) before `BattleView.update` has seen its new life, so
`BotRig.catchUp` re-derives the life itself before the ragdoll takes the joints.

**They are TWO blocks rather than one because the armour goes between them, and
it goes in a different place on each side**: offline the core steps the fleet
before its bots think (so a hull that has just pulled across a street breaks the
sightline on the frame it visibly blocked it) and the page poses its copy before
the drain; in a match it is posed from the wire after the shots, because none
of it decides anything. What both orders
guarantee is the only thing `stepAftermath` asks of a caller — that the hulls
have already moved this frame, since a mine's trigger is a distance test against
where a hull IS. **`stepAftermath` is also now the ONE place the physics world
is stepped anywhere in the client**, which was two places and a sentence in each
saying so; `scene.physicsEnabled` stays false precisely so that a pause, the
deploy map and the menu, all of which render, cannot advance it.

## What `tick` pushes, not a state's own arm

The end-of-frame order inside `updateGameplay` is in
[`CLAUDE.md`](../CLAUDE.md), because three subsystems depend on it. Everything
below is the opposite case: it is owed by the states that simulate **nothing**
as well as by the ones that do, so it cannot live in a chain that only a
simulating state runs.

`Game.tick` runs it in this order, and each row's reason is written at its call
site:

| push | owed to | why from `tick` |
| --- | --- | --- |
| `net.conn.setFrame` | every state, in a match | first in the frame: where on the authority's timeline a frame is posed is a question about when it is SEEN, and anything later may ask it (`Connection`'s header) |
| `input.update` | every state | the arms read it |
| `hud.setFps`, `profChip.update` | every state | they are instruments, and a frame rate that stops being reported when a menu opens cannot be investigated |
| `updateRoundBehind` | the states whose `ScreenSpec.roundBehind` says so | the authority's round carries on behind the screen; BEFORE the switch, because `dt` has already passed under the screen that was up (`docs/states.md`) |
| *the state's own arm* | | |
| `netShots.clear` | every state | the wire's shots a state did not draw are DROPPED, or the menu's worth leave the barrel on the next round's first frame |
| `hud.update` | every state, at `dt` 0 under a held world | a pause freezes the killfeed with the world; a netplay pause holds nothing, so neither does the feed |
| `post.update`, `sky.update`, `setCloudShadow`, `pushLightning` | every state | the sky and the weather do not stop for a menu; in a match the clouds' turn and the lightning run on the authority's clock, so every client agrees |
| `syncVolumetrics`, `motionBlur.update` | every state | after every arm has placed the camera, before the render they are drawn into |
| `followEye` — `mats.updateCamera`, `water.follow`, `grass.follow`, `culling.update`, `atmosphere.update` | every state | the EYE; see below |
| `followEye` — `rotorWash.update`, `water.setWash`; and `pushHullEngines` | every state, gated on `fleetStepped` (read ONCE) | a held world is a fleet frozen in place, so these owe it stillness and SILENCE rather than nothing |
| `stageWarmFrame` | while the building card's pipeline warm-up stands | BEFORE `followEye`, which is what carries its vantage into the cull, the water and the grass; `unstageWarmFrame` after the render undoes all of it, so a wait `go` abandons leaves nothing behind (`docs/states.md`) |
| `gi.update` | every state with a map, but never a warm-up frame | the bounce is owed to every picture with a map in it, and converges behind the loading card — around the CAMERA, so not around each vantage the warm-up stands at |
| `sfx.setListener`, `pushAmbience` | every state; the listener never from a warm-up frame | the EAR, for the eye's reason; a fire is a property of the map and the ear, both true behind a deploy card |
| `pushTouchControls`, `pushScoreboard` | the state the frame ENDS in | see below |
| `updateBakeWait` | while a reflection bake drains, and then while the pipeline warm-up runs | after the render, which released the bake's share or compiled the warm frame's pipelines; not an arm, because `loading` simulates nothing |

**The shader's eye is not in that chain either**, because it is owed by the
states that simulate nothing: `Game.followEye` pushes `mats.updateCamera()`
once per frame in every state, after every arm has placed the camera and before
`scene.render()`. The scene renders behind the menu, the building card, the
deploy screen and the kit turntable, and all four would otherwise be fogged
against wherever the last *live* frame stood — the origin, before there has been
one. `updateCamera` guards on the position, so a state with a still camera pays
one comparison; and because a new material is seeded with that same eye
(`CelShader.applyCamera`), a map built under the building card comes out of
`installMap` already correct. **The water owes the same push and gets it on
the same terms** (`WaterSystem.follow`, beside the cull): its Fresnel is asked
of the eye, and its wave grid is stood UNDER the eye, so left to the camera
tail a deploy screen over the bay would show a sea heaving wherever the player
last stood and lying flat under the view. It moves no clock, so a held world
stays held. **So does the grass** (`GrassSystem.follow`, right after the water):
its patches are CHOSEN around the eye and inside the frustum, so left to the
camera tail a deploy screen over a meadow shows bare ground — the field is only
ever drawn where it was last chosen. Its clock stays in the tail with the
foliage's, so a paused field holds still.

**`Game.pushScoreboard` is pushed from `tick` for the mirror reason**: the Tab
board is owed to `playing`, `dying` and `deploy` alike, so it belongs to the
ROUND rather than to the states that simulate one. It runs after the switch and
before the render, so the state a frame ends in decides — which is what makes
"the board goes when the round does" one line instead of a
`scoreboard.set(false)` owed by every one of the six ways out of a round. A lid
takes it away, because a lid is a screen the player asked for.

**`pushTouchControls` sits beside it on the same terms**: the on-screen
controls are owed to `playing` alone, which is narrower than `inRound`, and a
frame that paused, died or deployed has already taken them away by the time it
reads the state.

Every row above shares a shape worth recognising before adding another: the
thing being pushed is owed by a **span** of states rather than by one, and the
span does not match "is the world moving". Anything with that shape belongs in
`tick` and gets a row in the table, and anything without it belongs in the
state's own arm.
