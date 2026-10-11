# The wiring hub: what `Game` owns, and what may leave it

Why the one place systems meet is a long file on purpose, the mechanical test
for what may be extracted from it, the single funnel every map is built through,
and what is pushed from `tick` rather than from a state's own arm. Split
out of [`CLAUDE.md`](../CLAUDE.md), which keeps the wiring rule itself and the
end-of-frame order; this file is the contract for `src/core/Game.ts` and for
anything proposing to make it smaller.

The rule this file exists under is in the spine and is not repeated here:
**systems never import each other, and they meet in exactly two places** — the
systems that DECIDE a round in `src/sim/SimCore.ts`, wired once there for every
host, and the VIEWS in `Game`, wired to the core's EVENTS. Everything below is a
consequence of that, including the reasons a refactor keeps wanting to undo it.
**Since `BABYLON_EXIT.md` X2.5a C4a no system that decides a round is wired
here**: offline they are the simulation core's, as they are the authority's in a
match — see "Offline, the round is the core's" below. The core's own wiring
keeps the one injection the spine names — `BattleSystem` takes `CombatSystem`
in its constructor and calls `combat.fire` for a bot's shot. A callback would
not do — the shot has to resolve synchronously inside the bot's think tick so
the result is available to the same frame's kill handling.

## Offline, the round is the core's

`Game` holds the simulation core through its HOST (`core`, a `SimHost` —
`src/sim/simHost.ts`, `BABYLON_EXIT.md` X2.5b) and simulates no round of its
own. **The core is in a WORKER wherever the page is cross-origin isolated**
(`WorkerSimHost`, `src/sim/simWorker.ts`) **and in this thread otherwise**
(`PageSimHost`, X2.5a's arrangement exactly) — chosen by `main.ts` before
`Game` is built and injected as `havok` and `engine` are, the boot's console
line saying which and why. Either way it is a `SimCore({ hostHoldsRespawn:
true, publish: true, rewind: true })`. **Three doors, and no fourth**:

- **`ask`** submits one of the local player's acts as a `SimCommand`
  (`src/sim/commands.ts`) — the walk every frame (`move`, after
  `Player.update`), a round with the cone already rolled on the page's own
  `STREAM.player` (`shot`, from the eye, the viewmodel muzzle for the tracer
  only), a throw and a rocket from the viewmodel's hand and muzzle, a mine at
  the `standableAt` point, the kit and the deploy, a mount, a crossing (a
  `mount` naming the hull the player is in), a dismount, the hull's guns, and
  — every frame a seat is held — the hull or the ring this page PREDICTS
  (`drive`/`gun`, `reportHull`/`reportGun`, X2.5a C4b). Every one is trusted;
  the core still refuses what its own state makes impossible. **`ask`
  returns nothing**: in the page an act's news is drained inside the call,
  from a Worker it arrives with the next step or `pumpSim`, and nothing may
  wait to find out which (below).
- **`core.step(dt)`** once a frame, in `updateWorld` — in every state that
  steps the world (`playing`, `dying`, `bench`) and none that holds it. **From
  a Worker the step OVERLAPS the frame**: `step` takes in the step started a
  frame ago (spinning for it only if the Worker has not finished — the
  profiler's `simWait`) and starts this one, so the frame read after it is
  the PREVIOUS step's and `live` is that step's answer. On a frame that does
  not step, `tick` calls **`pumpSim`** after the state's arm instead: what
  came back is taken in, synced and drained, and what the frame asked is
  sent — which is how the deploy screen's `deploy` reaches the core and its
  `spawned` comes back.
  **Every call made on the core is followed by `simSync`** — the step, every
  `ask`, and the round's own calls (`startRound`, `addPlayer`,
  `removePlayer`, `releaseWorld`) — which reads the frame into the page's
  readers (below) BEFORE anything draws what the call said. **But a REPORT**
  — `move`, `drive`, `gun`, each frame's word of where the player, their hull
  and their gun already are on this page — raises no news and changes nothing
  read before the step, so it is not synced (nor `?simcheck`ed); the step's
  own sync follows within the frame. The core fills the frame at the end of
  each step and lazily on the first read after any other call
  (`SimCore.frame`), so a frame pays one fill for the step and one per
  non-report ask, not one per call. A sync is skipped when the host's
  `version` has not moved since the last — from a Worker, every `ask` between
  two steps.
- **`drainSim`** after every call made on the core, which hands every event the
  core wrote to **`onSimEvent`**, one switch, in emission order. It is
  presentation only — the tracer, the corpse, the killfeed line, the marker,
  the blast, the fire's light, the pane, the seat — and **wherever a match has
  the same news it ends in the method `onNetEvent`'s arm ends in**
  (`playerHit`/`playerDown`, `seatAnswer`, `playerSpawned`, `roundPassed`,
  `flagCaptured`, `breakPane`, `fireLit`), so offline and online cannot drift
  for the player.

**The frame's order offline** (`updateWorld`): `BattleView.beginFrame` → the
core's step → `simSync` → the hull trigger (`pullHullTrigger`, an `ask` and so
a `simSync` of its own) → this page's fleet POSED off the core's (`syncFleet`
with the frame's `FleetMirror`, `vehicles.update` answering `remoteFor` for
every hull but the one under a driver) → the driver carried after his hull
(D4) → `drainSim` (and, under `?simcheck`, the mirror check) →
`VehicleViews.update` → `BattleView.update` and the flash budget →
`stepShots` → `stepAftermath`. The mirrors sync BEFORE the drain so a corpse
built off a `botDown` finds the rig caught up to the frame the death was in,
and the fleet is posed before it so every event that names a hull finds it
where the step left it; the views update AFTER it so a gun the core fired this
step has kicked (`Vehicle.mirrorShot`).

**Nothing the page does depends on WHEN the core answers** (X2.5b), which is
the whole of what made one code path serve both hosts. `SimCore.submit`'s
boolean is the authority's courtesy and the page no longer reads it: what it
predicts it decides off its own state, as a match's client does — the main
gun off its own hull's `gunReady`, the cupola gun off its own `fireMg` (the
core's clocks are never behind the page's, having stepped first, so what the
page fires the core fires), a thrown grenade booked off the pouch BEFORE the
ask and given back by the core's `ordnanceRefused` (`Player.returnGrenade`),
a mine heard going down as in a match. **A person's round is REWOUND**
(`rewind`): it carries the frame it was aimed at (`renderTime`, the synced
frame's `time`), so a shot from a page drawing a step behind the core is
resolved against the picture, by the authority's own rule. In the page the
picture IS the core's present and the rewind moves nobody, bit for bit.

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
sweep, its ground, its stance, its regen for the HUD and the camera — and it
keeps its `SIMULATIONS` entry (`docs/build.md`) because it sweeps. Its health
is ASSIGNED from the core's `damaged` (`applyServerHealth`), its death is the
core's (a leash expiry included, D3), and its body is put in the world by the
core's `spawned` answer to a `deploy` — which, with no respawn clock of the
core's own to wait for, is honoured at submit (D21) through the same
`deployPerson` door the reinforcement pass uses.

**What the page's VIEWS read of the core is its FRAME and nothing else**
(X2.5a C5). `SimCore.frame` (`src/sim/frame.ts`) is the round as plain typed
arrays — every bot's root, centre, eye, team, life, death and SOLVED joints
(packed bit for bit, `packJoints`), the flags and tickets, the persons, the
hulls and who holds each chair, the four pools, the board, the broken panes and
the order of the target list — refreshed by the core at the end of every call
that can change it. `simSync` copies it into `sim` (`SimMirror`,
`src/sim/mirror.ts`): a `BotMirror` per pool slot (`RosterMirror`, what
`BattleView`'s rigs follow and what the minimap, the blob shadows, the grass,
the sounds, the scoreboard and the bench's spectator read), `FleetMirror`
(what the posed fleet is told by, and `seatHolder` for the seat prompts),
`OrdnanceMirror` (what `GrenadeFx`, `AntiTankFx` and the fire lights read),
`ScoresMirror`, the persons (the HUD's laid-mine count) and
`hittablesAgainst` (the aim assist's list, in the core's own order). **The
flags are written onto this page's own `conquest`** (`flagsInto`), exactly as
a match's `NetRoster` writes them off the wire, so the capture zones, the HUD,
the minimap and the deploy screen hold one set of points on both sides and the
deploy screen's offer is answered off them. Which roster and which pools a
view reads is still asked through one accessor each (`rosterRead`,
`simGrenades`, `simAntiTank`) — the mirror offline, the page's own netplay
mirror or prediction in a match — and `flags` is `conquest` on both.

**The proof is the TYPE.** `core` is held as a `SimHost`: the host calls and
`frame`, nothing else — so no object of the core's is nameable in `Game.ts`,
and `npm run typecheck` is the assertion that the offline page reads the
frame and the ring and nothing else. The one place the core is held whole is
the DEV mirror check's closure (`SimHost.local`, null from a Worker), built
inside the `import.meta.env.DEV` branch a production bundle folds away.

**What crosses to a Worker is numbers in shared memory, and nothing crosses
by reference** (`src/sim/simHost.ts`'s header has the handshake): commands
are encoded into one of two growable `SharedArrayBuffer`s
(`commandCodec.ts`, `ShotCommand.weapon` narrowed to the five numbers
resolving a round reads), each operation's frame and news are published into
one of two more (`publication.ts`, the layout derived from `newFrame()` so a
field added to the frame crosses by itself), and the signal is an `Atomics`
store the Worker waits on. The page never sends an operation before it has
taken in the last, which is what makes each buffer one side's at a time. A
posted message is a ROUND's cost — `startRound` (the map named by id, since a
`MapDef` holds import thunks), `addPlayer`, `removePlayer`, `releaseWorld` —
and the page spins for its answer, as it waited for the in-page call. The
page's readers keep the frame they were synced with for the whole frame,
which is why there are two publications: the Worker writes the other one.

**Three URL switches hold the boundary to account, and all three put the core
in THIS thread** (`openSimHost`): `?simpage` asks for it outright, and the two
below need it. `?simcheck` (DEV builds
only — `simCheck` is a module function, and the production bundle carries
none of it) runs `src/sim/simCheck.ts` after every drain: every reader against
the live object it stands for, with `Object.is` — every bot field and every
joint, the flags on this page's `conquest`, the persons, the hulls, the
pools, the board, the frame's panes AND this page's glass, and the target list
in order — tallying on `window.__simcheck` and logging each mismatch as a
console error. `?simcopy` (every build) round-trips every command, every frame
and every drain through `structuredClone` before the other side reads it —
the clone boundary rehearsed in one process (a clone of a view onto shared
memory shares it, so the rehearsal is the in-page core's); the benchmark's
fight hash under it, and from a Worker, must be the plain one. `server/corecheck.ts` runs the same
check headless, with a person in it.

**A frame costs a copy, and the authority does not pay it**: `publish` is
off on `Match` (its validators and its snapshot read its own objects,
in-process) and on `simulate` unless `--frame` asks — which is how the copy's
price is measured. A bot's joints are solved at every publish rather than only
for the bodies inside the page's freeze distance; the solve is a pure function
of the pose, so that moved its cost and not its answer.

**The page keeps only its netplay prediction systems** — `combat`, `grenades`,
`antiTank`, the fleet, `glass` and `conquest` as the wire's mirror — and steps
none of them offline but the fleet (posed, and the player's own hull predicted)
and the glass (the core's `glass` applied). There is no `BattleSystem`, `VehicleCrew` or `ScoreBook` on the page.
**Nor the AI's map data**: the page's build skips the cover bake and, offline,
the seven flow fields (`BuildOptions.navFields` false — kept for the editor's
overlay and in a match, where the scratch netplay smoke steers by them), since
the core's own world bakes both for the bots that read them; the nav GRAPH is
kept, for `standableAt` and the editor.

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
has to re-argue the line count.** It is the only place the VIEWS meet the core
and each other, so most of its length *is* its job — and splitting the wiring re-creates exactly the
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
reads it and never writes it, and the core builds the simulations alone — so
every view's line here has no twin in `SimCore`. **No node decides an outcome**:
the player's throw hand, launcher muzzle and mine point are read HERE and
submitted as the command's `origin` (`FINDINGS.md` 55), so the core reads none.
`CombatFx` takes
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
everything in the air; what letting go SAYS, every fire put out as a
`burntOut`, is drained and DROPPED there rather than left in the ring for the
next round's first drain to draw on a map that never had those fires, and the
fires' lights the page holds go with it), the water and grass disposed, the reflection probes parked, the mote field
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
`AimAssistSystem`, `DeathCam` and `VehicleCamera` — the page's netplay
predictions and its views; the core's own systems take `rays` off the world
`buildSimWorld` builds it. `VehicleSystem` is absent from that list and is not
an exception: it is handed the whole `GameMap` and takes it off `map.rays`
where it takes `nav`, `cover` and `obstacles`, as the core's `BattleSystem`
does off its own. A system that misses this one does not throw
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
other poses it off the core. What they DO share is ten system updates in the
same relative order — two of them, the grenades' and the rockets' prediction,
stepped in a match alone — and those were written out twice.

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
| `sfx.setListener`, `pushAmbience` | every state; the listener never from a warm-up frame | the EAR, the same bug with a different symptom — a listener placed only by the frames that simulate sits at the origin, so a fire in the village pans from the map's corner while the menu is up; a fire is a property of the map and the ear, both true behind a deploy card |
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
