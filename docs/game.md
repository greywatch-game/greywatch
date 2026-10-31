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
host, and the VIEWS in `Game`, wired to what the authority SAYS. Everything
below is a consequence of that, including the reasons a refactor keeps wanting
to undo it. **No system that decides a round is wired here, and no core is
held here either**: `BABYLON_EXIT.md` X2.5a C4a took the deciding systems out
of `Game`, and X2.5c C4 took the core out of the page — every round is a
`Match`'s, a server's or the page's own, and the page hears it as the wire.
See "Offline, the round is the page's own match" below. The core's own wiring
keeps the one injection the spine names — `BattleSystem` takes `CombatSystem`
in its constructor and calls `combat.fire` for a bot's shot. A callback would
not do — the shot has to resolve synchronously inside the bot's think tick so
the result is available to the same frame's kill handling.

## Offline, the round is the page's own match

**Every round is a MATCH, and the page is a client of it whoever hosts it**
(`BABYLON_EXIT.md` X2.5c C4). A round that is not a server's is played by a
`Match` (`server/Match.ts`) the page HOSTS and OWNS — the same class, running
the same `SimCore`, that a match server runs — and the page joins it through
the same `NetSession` and `Connection` a remote match is joined through, over a
port rather than a socket (`src/net/transport.ts`'s `portTransport`). So there
is one client model: one prediction, one wire, one validation — every act the
offline player makes is a CLAIM that `server/wire.ts`, the rate bucket,
`validateMove` and `validateDrive` check exactly as they check a remote
player's — and one event switch, **`Game.onNetEvent`**, which ends in the
presentation methods for the player (`playerHit`, `playerDown`, `seatAnswer`,
`playerSpawned`). There is nothing left to drift. `docs/multiplayer.md` ("A
match its OWNER drives", "Holding the world", "The local transport") is the
contract for the match's side and the ports; this section is the page's half.

**Where the host runs is the boot's choice, and nothing below asks it.**
`main.ts` awaits `openMatchHost` (`src/net/matchHost.ts`) beside the engine and
Havok and injects the `MatchHost` as the constructor's fourth argument: a
Worker (`server/localMatchWorker.ts`), proved up by answering a `settle`, or —
under `?simpage`, or when the Worker does not come up — a `MessageChannel` in
the page's own thread, reached through the one dynamic `import()` of
`server/localMatch.ts` in `src/`. The boot's console line says which and why,
and `prof.setSimMode` puts it in every capture. `Game` hands the host to
`net/LocalOwner.ts`, which holds everything OWNING it means — the begun line,
the clock's `step` and `pass`, the step timing waiting to be filed, a lost
host replaced — and answers `Game` through four hooks (a timing to file, a
round failed, the host lost, its replacement up). `Game` reads the
`LocalMatch` off `localOwner.match` every time it asks rather than holding
one, because the host can be REPLACED (below).

**The OWNER's channel is what owning buys, and it is not a `ClientMessage`**
(`src/net/LocalMatch.ts`, the words in `src/net/localWire.ts`). Per round,
`openLocalRound` — called from `buildRound` BEFORE the build, so the host
builds its world while the page builds the picture — closes the last match
(`leaveMatch`), posts `open` on the chosen map and `begin` on the round's seed
and the player's difficulty, and connects a fresh `NetSession` (`local` true)
whose port is `dial`led on the owner channel BEHIND the `begin`. The owner's
port answers in posting order, so the host is listening for this page's `join`
only once the round stands, and the order the two ports do not promise each
other is never needed. **A fresh match every round**, a restart included: a
`begin` over a round in play is a ROTATION to everyone seated, which a client
answers by rebuilding — the round `buildRound` is already building. A
benchmark dials a WATCHER (`dial({ watch: true })`), a connection with no seat,
so no person in a slot moves the fight it measures; `markFight` and `fight`
fold its hash where the match runs, since no wire event carries a bot's award.

**The match steps only when the page hands it time, and `updateWorld` is the
one door.** In the states that step the world (`playing`, `dying`, a
benchmark's FIGHT frames) `updateWorld` posts `advance` and then runs
`updateNetWorld`, the frame a server's round is drawn with. The advance is
posted and never awaited: the match answers between frames, and what it decided
reaches this frame or the next as the wire, exactly as a server's does.
**Only what fits under the slack is stepped**: a frame advances
`min(dt, CONFIG.net.localSlack - LocalMatch.behind)`, `behind` being the
SECONDS the unanswered advances still carry, so a device the host cannot keep
up on plays the fight slower than real time rather than ever further behind its
picture. The benchmark posts one advance per STEP and holds nothing back
(`advance` is seconds, and one tick's worth is exactly one step).

**Everything a frame did not step is handed over as HELD.** After the state's
arm, `tick` calls `LocalOwner.pass`, which posts `hold` for the frame's real
time less what `updateWorld` advanced — a pause, the deploy screen, the slack's
remainder, what `MAX_FRAME_DT` cut off a long frame, a benchmark's LOOK — so the
match's clock passes with nothing stepped and its snapshot stamps stay on the
wall clock the client's offset is sampled against (`Match.hold`'s argument).
Only once the session is seated: before the welcome there is no round on the
host to hold. A frame that did not run `updateWorld` also drops the step timing
waiting to be filed and counts off the answers still owed for advances posted
before it (`LocalOwner.timingSkip`, through `LocalOwner.dropTiming`), so the
profiler never charges a resumed frame with steps taken seconds earlier — and a
benchmark segment's first frame does the same, so a segment never files the last
one's steps; otherwise every answer's timing is SUMMED into one row
(`LocalOwner.timing`) and filed as the `sim` root by the next frame that steps
(`LocalOwner.step`, `docs/profiling.md`).

**WHO HOSTS is asked as two getters, and only about AUTHORITY.**
`remoteRound` (a session that is not `local`) and `localRound` (one that is) —
never `!this.net`, which is true of no round any more. They answer who may
restart a round and choose the map and the difficulty (the round-over card's
Another round plate and the pause menu's Restart, both DRAWN and so absent in a
server's match rather than dimmed, and the round-over card's confirm KEY, which
is a guard — `updateMenuCard`'s `!this.remoteRound`; `docs/states.md`), whether a lid or the deploy screen holds the world (`worldHeld`,
`updateRoundBehind`, `docs/states.md`), and the facts that follow from there
being a server at all: the clouds' turn and the storm on the authority's
clock, the ping column, whose seed a capture names, and the flow fields
(`BuildOptions.navFields`, baked on the page only for the editor's overlay and
a server's match, whose netplay smoke steers by them). **Never what the page
PREDICTS** — a fork on who hosts that changes a prediction is offline getting
a different game from online, which is what X2.5c exists to rule out.

**What the page still simulates is a match client's PREDICTION, identical
offline and online.** Its own `Player` — the sweep, the ground, the stance,
regen for the HUD, the camera — reported as a `move` each frame it is alive in
`playing`, and keeping its `SIMULATIONS` entry (`docs/build.md`) because it
sweeps; its health is ASSIGNED from the authority's `damage`
(`applyServerHealth`), and its death and its body are the authority's (`died`,
`spawn`). The hull under a driver (`driveFor`, reported as `drive`, a refusal
answered by `hullcorrect` and `Vehicle.correctTo`) and the ring a gunner lays
(`gunFor`, reported as `gun`). And the prediction systems that answer its own
acts before the authority does — `combat` (the tracer, and the hitmarker as a
GUESS, `net/HitCredits.ts`), `grenades`, `antiTank` and `glass` — a refused
throw given back by the addressed `refused` (`Player.returnGrenade`,
`Player.returnOrdnance`). A person's round is rewound to the frame it was drawn
at, as every peer's is, and the page draws the round `CONFIG.net.interpDelay`
behind its snapshots in its own match as in a server's. **There is no
`SimCore`, `BattleSystem`, `VehicleCrew` or `ScoreBook` on the page**:
`conquest` is a copy written off the wire, the bodies are `net.roster`'s
`NetSoldier`s (read through `mapBodies`), and the posed fleet is
`syncNetVehicles`'. Nor the AI's map data: the page's build always returns
`cover: null` (`MapBuilder.build`), skips the flow fields wherever nothing on
the page steers by them (`BuildOptions.navFields`, set only for the editor and
a server's match), and keeps the nav GRAPH for `standableAt` and the editor.

**The match's world is the map's committed BAKE, not the page's build**
(found at X2.5c C4). The old in-page core was handed `collisionOf(map)` off the
map the page had just built; a `Match` reads `MapDef.collision` through
`loadSimWorld`, as a server's does — so an edit the editor saved plays against
stale colliders on the authority's side until `npm run collision` re-bakes it.
The same rule a server match always had, now met in the dev loop. **An owned
match has no idle timer, so nothing closes it but the page**: `leaveMatch`
does, from `enterMenu`, from F2 into the editor and at the top of every
`openLocalRound`, so the menu, the editor and a server's match hold no second
world.

**A host that dies is SAID, and REPLACED.** A port into a dead Worker says
nothing, so `LocalMatch`'s watchdog calls the host lost on SILENCE
(`docs/multiplayer.md`, "The local transport"). `LocalOwner.wire`, wired once
per HOST because a host outlives every round on it, hears three things: a step's
report (`onAdvanced`, gated on `LocalOwner.begun` so the last match's late
answers are not this round's), a posted call that failed (`onFailed`) and the
host gone (`onLost`). A failure under the round standing — or the local
session's port closing, or its join refused — ends that round through
`failLocalRound`, which leaves for the menu with a toast: there is no authority
left to play it, the fight having lived in the host. A loss then REPLACES the
host (`LocalOwner.rehost`, `MatchHost.replace`: the old one torn down, a wedged
Worker terminated, a new one opened the boot's way and re-wired), up to
`CONFIG.net.localRehosts` times a page. A round asked for while the replacement
is coming up fails at once, and past the bound, or when a replacement fails to
open, the toast asks for a reload (`LocalOwner.state`).

**Until X2.5c the page hosted a CORE rather than a match**, and the shape is
kept here as history because each piece of it is a thing a refactor might
reach for again. X2.5a put a `SimCore` in the page behind a `SimHost` — three
doors, `ask`, `step` and `drainSim` into a switch of its own, `Game.onSimEvent`
— and X2.5b moved it into a Worker wherever the page was cross-origin isolated,
commands and frames crossing as numbers in `SharedArrayBuffer`s
(`commandCodec.ts`, `publication.ts`, an `Atomics` signal), the page's views
reading the core's `SimFrame` through mirrors (`frame.ts`, `mirror.ts`,
`BattleView`'s `BotRig`s), checked under `?simcheck` and rehearsed under
`?simcopy`. It worked, and it was a SECOND client model beside the match's: two
event switches that had begun to differ, two prediction models (23 methods in
`Game.ts` forked on `this.net`), two state vocabularies, and event payloads read
by raw offset. X2.5c C4 made offline a match client, C5 deleted the old host
and everything only it read, and C6 took out the cross-origin isolation the
shared memory had needed. `BABYLON_EXIT.md` X2.5c has the argument and the
record.

## The constructor takes what it cannot build, and stays SYNCHRONOUS

**There are three arguments beside the canvas and they are arguments for the
same reason**: `havok` is the instantiated physics WASM, `engine` is a
`WebGPUEngine` whose `initAsync` has already resolved, and `local` is the page's
own match host (`MatchHost`, X2.5c C4), whose Worker has already answered its
first call or been given up on for the page's own thread. All three are awaited
by `main.ts` and a failure of any is the boot screen's business — the host
cannot fail by its Worker, which falls back to the page, only by the in-page
module's fetch failing too — so nothing in this file is written twice for a
machine that never got one, and there is no init state, no `ready` flag and no
"has it arrived yet" question anywhere below. The host is the one of the three
that can be REPLACED after the boot (`LocalOwner.rehost`, above), which is why
`LocalOwner` keeps the host and everything reads the match off it rather than
holding the match.

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
has to re-argue the line count.** It is the only place the VIEWS meet the wire
and each other, so most of its length *is* its job — and splitting the wiring re-creates exactly the
system→system edges the rule above spends itself preventing. What may leave is a
cluster of **private fields that answers only to itself**: nothing else in the
file reads them, and the methods over them touch no system, no mesh and no
frame. There are three worked examples. `net/HitCredits.ts` is the smaller and
the plainer: the queue of rounds this client has already cued a hitmarker for
was one field and three methods that no line outside them touched, so the rule
that a landed round is announced ONCE is now stated in one file that flashes
nothing, plays nothing and never reads the wire — `Game` spends the answer and
draws the cue, which is the two halves below staying behind exactly as they
should. `net/RegionBook.ts` is the larger — the region list, its one
read, the player's pick, the automatic pick and the pings ranking it were six
fields no line outside the five lobby methods over them ever touched.
`net/LocalOwner.ts` is the third, and the one with HOOKS: the page's ownership
of its own match was eight fields whose methods touched only the owner's
channel, so the hold accounting and the timing skip are one file now — and
the two halves stayed behind as four hooks, `fileTiming` (the profiler, which
`Game` files into) and `roundFailed`/`hostLost`/`replaced` (the toast and the
menu, which `Game` draws). Four is the ceiling of that shape: a cluster that
needs more callbacks than that is reaching across systems. What may
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
round alone owns what is about a *fight* — the match it plays (opened before
the build, `openLocalRound`), the roster's pool, flag markers, minimap.

**A simulation and its view are handed the map on adjacent lines, and a view
is handed only what its own picture reads.** The split is `CLAUDE.md`'s
("Ownership and wiring"): the simulation owns the state on `src/math`, the view
reads it and never writes it, and the core builds the simulations alone — in
the match, never on the page — so every view's line here has no twin in
`SimCore`. **No node decides an outcome**: the player's throw hand, launcher
muzzle and mine point are read HERE and sent as the message's `origin`
(`FINDINGS.md` 55), so the authority reads none.
`CombatFx` takes
`map.rays` (its `drawRounds` casts for itself); `GrenadeFx` takes `map.rays`,
the terrain and the environment (a fire's flames stand on their own floor
probe, and the map decides what colour a blast's dust is); `GlassFx` takes the map,
whose merged glazing it collapses; the session's roster (`NetRoster`) takes the
body draw distance with `RagdollSystem` — pushed by `wireNet` too, since a
roster built for a join into a match in progress arrives after the map; and
`VehicleViews` builds one view per hull right after `vehicles.build`, by
hardstanding. **Two views take nothing from a map**: `AntiTankFx` draws its
simulation's pools and nothing else, and `PlayerView` is the viewmodel on the
camera. The bodies' rigs are the ROSTER's, not the map's — `NetSoldier`s in
the session's pool, whoever hosts the match: `buildRound` sizes the pool
(`NetSession.setFielded`) right after `ragdolls.reset()`, the other thing that
holds a rig. Until X2.5c C4 the page's own round drew the core's bots through
`BattleView`'s `BotRig`s instead; C5 deleted both.

**Its disposal half is a method of its own, `teardownMap`, and the MENU calls it
alone.** It puts every system `installMap` hands a map to back as it was at
boot: the map disposed and `Game.map` null, the shots' tracers and marks
(`CombatFx.clearTransient`), both ordnance pools AND their pictures
(`GrenadeFx`, `AntiTankFx`), the fleet's views (`VehicleViews`, before the
fleet they draw), the fleet and rotor rings let go, every fire's light the
page holds (a fire the authority lit is put out by nothing this page will hear
again), the water and grass disposed, the reflection bake's queue emptied, the mote field
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
both rely on. **The SIMULATION's world is not in that list, because it is not
the page's**: it is the match's, and `leaveMatch` closes the match — from
`enterMenu`, beside this — so the authority's map, fleet, crews and everything
in the air go with the host's `close` rather than with a line here. Until X2.5c
C5 it was a line here (`SimCore.releaseWorld`, its `burntOut`s drained and
dropped so the next round's first drain did not draw fires on a map that never
had them).

**The world's drawing is our renderer's, and a failure of it is the ROUND's**
(`BABYLON_EXIT.md` X3.7b). `installMap` builds the map with
`BlockHandover.onSurface`, which answers for each surface whether ours draws
it in every pass — and Babylon is made no mesh of what it does, a round's
`map.visuals` being the glazing and the fires, while `map.world` keeps a
record of every surface, each naming its mesh if it has one — then files it
(`WorldCulling.setMap`, the cells grown off the records) and hands it over
(`handover.install`, the cut, and every pass of ours its world). An editor
build hands nothing over: Babylon draws it whole. **What ours cannot draw is
never handed back, there being no mesh to hand it to: it is
`Game.worldFailed(reason)`**, run after the task in hand (a failure can land
inside a render, or inside `installMap` itself) — a `console.error`,
`enterMenu` (which leaves the match, a server's as well as the page's own,
through `leaveMatch`) and a toast that the map could not be drawn:
`loadHeights`' move, for its reason, there being no honest half-world to play
in and no fallback engine. Its doors are the handover's — a surface it cannot
hold, failed at the install (and thrown after it in a DEV build, so
`merge:hash` refuses the map — the page still reaching the menu, the map it
built whole and torn down), a group or a cull that fails (under the building
card, where a pipeline settles), a cut past the device's limits, a refused
pass, a pass of ours that cannot draw the world it was handed (each is
handed its world WITH the install's failure and tells it, since X3.7c: no
pass latches a loss, and a pipeline failed for the session fails every
install after it through its settled promise) — and the cull's, which REFUSES a build
whose own contract is broken (`setMap` hands back the reason rather than
throwing, `reachBoxOf` a null, and `installMap` hands nothing over after
it). **One door is not the handover's**: the bodies' shadow map (X4.1c) is no
part of the world but has no fallback either, so `installMap` hands it the
install's failure after the handover's (`BodyShadowMap.setFailure`, none for
an editor build, taken back by `teardownMap`), and its pipeline, asked once
for the session, fails every round after a failed build. **A failure belongs to the INSTALL it came from**: the handover latches
a fresh `WorldOwner` at each install and hands it back with the failure, so
the console line and the toast name the map that failed, and one of the OLD
map still standing under the next round's building card (between
`startRound` and that round's install, `Game.roundWorld` null) is said and
ignored rather than ending the round being built. **An EDITOR build fails
nothing** — the exemption is the build's kind (`install`'s `editor`), never
whether ours took a surface — and a cull refusal of one is a
`console.error`, the editor kept open. `teardownMap` takes our side down
first (`handover.clear`), ahead of the map's meshes.

**It also lets go of the map's DATA, and that half is proved rather than
reviewed.** `Player`'s ground, the `rays` eight
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
`AimAssistSystem`, `DeathCam` and `VehicleCamera` — the page's predictions and
its views; the authority's own systems take `rays` off the world
`buildSimWorld` builds it, in the match. `VehicleSystem` is absent from that list and is not
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

## One world frame, and its tail is one funnel for `installMap`'s reason

**There is ONE frame of the round on the page, `updateNetWorld`, whoever hosts
the match** (X2.5c C4). It has two callers and they differ by one line each:
`updateWorld`, for the states that are IN the round (`playing`, `dying`, a
benchmark's FIGHT), which in the page's own match first posts the frame's
`advance` (above); and `updateNetUnderCard`, for a card a SERVER's round
carries on behind (`updateRoundBehind`, `docs/states.md`), which adds the two
gauges the deploy screen and the pause card leave showing. Inside it, in this
order: `updateNet` (the snapshots onto the roster's bodies, the flags and
tickets onto `conquest`, this frame's `move`) → `fillPushers` →
`drawNetShots` → `stepShots` → the fleet (`syncNetVehicles`,
`vehicles.update`, `VehicleViews.update`) → `stepAftermath`.

**Until X2.5c C4 there were two world steps, and that is where this section's
rule comes from.** `updateWorld` was the offline round — the core's step, the
fleet posed off its frame, its bots drawn through `BattleView` — and
`updateNetWorld` the client's half of a networked one; what they shared was ten
system updates in the same relative order, written out twice, until each run
of them became one call, `stepShots` and `stepAftermath`. The argument for that
was `installMap`'s exactly, and it outlives the merge: a system added to one
sequence and forgotten in another does not throw and does not log — it simply
never runs there. The symptom is a tracer that hangs at the muzzle where the
shot went off, or a fuse that never burns down, or a corpse that takes a rig
and hangs in the air; each of those reads as a bug in that system rather than
as a missing line in a method nobody was looking at. **Anything new the
round's frame owes goes in `updateNetWorld` — in `stepShots` or
`stepAftermath` when it is about the rounds or what follows the armour — and
never in one of its callers; something only one caller owes goes at that call
site with the reason written there**, as the advance and the gauges do.

**The bodies and the fleet are pictures stepped before anything reads them.**
The roster's `NetSoldier`s are posed inside `updateNet`, which is also what
raises an interpolated death (`roster.onDeath`, a ragdoll off the authority's
word), before anything reads a rig — the grass's pushers, the bodies' shadow
map, the mesh walk — and the body draw distance `installMap` pushes goes to
`NetRoster` and `RagdollSystem` together. `VehicleViews.update` runs right
after `vehicles.update`, after `syncNetVehicles` has posed the fleet off the
wire, and before anything reads a node (the two shadow maps' boxes are off
each view's body); `installMap` builds the views right after `vehicles.build`,
one per hull by hardstanding, and `teardownMap` takes them down before the
fleet. What a view must hear between two of those updates — a placing, a shot,
each step's belts and mass, and a wreck — it is told as it happens, through
the hull's `HullPicture`.

**They are TWO blocks rather than one because the armour goes between them**:
the page poses its fleet off the wire after the shots, because none of it
decides anything — the authority steps its own fleet before its bots think, in
the match, so a hull that has just pulled across a street breaks the sightline
on the step it visibly blocked it. What the page's order guarantees is the only
thing `stepAftermath` asks of its caller — that the hulls have already moved
this frame, since a mine's trigger is a distance test against where a hull IS.
**`stepAftermath` is also the ONE place the physics world is stepped anywhere
in the client**, which was two places and a sentence in each saying so;
`scene.physicsEnabled` stays false precisely so that a pause, the deploy map
and the menu, all of which render, cannot advance it.

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
| `net.conn.setFrame` | every state with a session — every round, whoever hosts it | first in the frame: where on the authority's timeline a frame is posed is a question about when it is SEEN, and anything later may ask it (`Connection`'s header) |
| `input.update` | every state | the arms read it |
| `hud.setFps`, `profChip.update` | every state | they are instruments, and a frame rate that stops being reported when a menu opens cannot be investigated |
| `updateRoundBehind` | in a SERVER's round, the states whose `ScreenSpec.roundBehind` says so | the authority's round carries on behind the screen (the page's own is held there instead); BEFORE the switch, because `dt` has already passed under the screen that was up (`docs/states.md`) |
| *the state's own arm* | | |
| `LocalOwner.pass` | every state, in the page's own match once seated | after the arm, so what `updateWorld` advanced is counted first: the rest of the frame's real time is posted as `hold`, so the match's clock stays on the wall's and the client's offset never sees a hold (`docs/multiplayer.md`, "Holding the world") |
| `netShots.clear` | every state | the wire's shots a state did not draw are DROPPED, or the menu's worth leave the barrel on the next round's first frame |
| `hud.update` | every state, at `dt` 0 under a held world | a pause over the page's own match freezes the killfeed with the world; one over a server's round holds nothing, so neither does the feed |
| `post.update`, `sky.update`, `setCloudShadow`, `pushLightning` | every state | the sky and the weather do not stop for a menu; in a server's match the clouds' turn and the lightning run on the authority's clock, so every client agrees |
| `syncVolumetrics`, `motionBlur.update` | every state | after every arm has placed the camera, before the render they are drawn into |
| `followEye` — `mats.updateCamera`, `water.follow`, `grass.follow`, `culling.update`, `atmosphere.update` | every state | the EYE; see below |
| `followEye` — `rotorWash.update`, `water.setWash`; and `pushHullEngines` | every state, gated on `fleetStepped` (read ONCE) | a held world is a fleet frozen in place, so these owe it stillness and SILENCE rather than nothing |
| `stageWarmFrame` | while the building card's pipeline warm-up stands | BEFORE `followEye`, which is what carries its vantage into the cull, the water and the grass; `unstageWarmFrame` after the render undoes all of it, so a wait `go` abandons leaves nothing behind (`docs/states.md`) |
| `gi.update` | every state with a map, but never a warm-up frame | the bounce is owed to every picture with a map in it, and converges behind the loading card — around the CAMERA, so not around each vantage the warm-up stands at |
| `sfx.setListener`, `pushAmbience` | every state; the listener never from a warm-up frame | the EAR, the same bug with a different symptom — a listener placed only by the frames that simulate sits at the origin, so a fire in the village pans from the map's corner while the menu is up; a fire is a property of the map and the ear, both true behind a deploy card |
| `pushTouchControls`, `pushScoreboard` | the state the frame ENDS in | see below |
| `drawBodies` | every state, inside the `render` span, immediately before `scene.render` | every pooled rig `WorldCulling` says is drawn this frame (`drawsBody`: switched on, not under the size gate) has its joints composed and its segments' matrices written as an instance of its side's kit (`SoldierModel.writeRigDrawing`, `BABYLON_EXIT.md` X4.1d), handed to our renderer (`BodyDraw.commit`) — after every write that poses or places a body and after the cull; in the render span because Babylon composed the rigs' meshes inside `scene.render` until X4.1a, so the attribution did not move. What only the render knows — each body's segment ORDER and its visor's bloom, both off `camera.globalPosition` — is PULLED by the renderer's prepare inside the render (`Game.bodyPull`) |
| `drawHulls` | every state, right after `drawBodies`, immediately before `scene.render` | every present hull's joints composed and its segments' matrices written as an instance of its kind's kit, each segment the size gate drops (`WorldCulling.keepsSphere`) written as nothing (`vehicleRig.writeHullDrawing`, `BABYLON_EXIT.md` X4.2b), and every DETAIL segment of a hull whose whole measure the detail tier refuses (`WorldCulling.keepsDetail`, X4.2c; off while the warm-up stands, so the full set is the one it shows), handed to our renderer (`HullDraw.commit`) — after every write to a joint (`VehicleViews.update` and what the hull tells its picture) and after the cull; in the render span for `drawBodies`' reason, Babylon having composed the hulls' nodes inside `scene.render` until X4.2a. Each hull's segment ORDER is PULLED inside the render (`Game.hullPull`), off `camera.globalPosition` |
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
