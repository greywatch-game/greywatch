# The wiring hub: what `Game` owns, and what may leave it

Why the one place systems meet is a long file on purpose, the mechanical test
for what may be extracted from it, the single funnel every map is built through,
and the two things pushed from `tick` rather than from a state's own arm. Split
out of [`CLAUDE.md`](../CLAUDE.md), which keeps the wiring rule itself and the
end-of-frame order; this file is the contract for `src/core/Game.ts` and for
anything proposing to make it smaller.

The rule this file exists under is in the spine and is not repeated here:
**systems never import each other; `Game` wires them with callbacks.** Everything
below is a consequence of that, including the reasons a refactor keeps wanting
to undo it.

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

**Nothing about the engine's OPTIONS lives here either.** `antialias: false` and
`stencil: false` are stated beside the `initAsync` call in `main.ts`, with the
argument for each — and the second of them picks the depth FORMAT under WebGPU,
which is what `GLASS_DEPTH_UNITS` and the outline z-offsets are measured in (see
[`rendering.md`](rendering.md)). A change to either is a change to numbers three
files away, so it is made where it is explained.

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
grass, the player's terrain, the grenade pool, the physics body. It was once two
copies that had drifted apart, and the failure is silent: a system added to the
round's copy and forgotten in the editor's keeps a cached pointer into a *disposed*
map, so the editor renders last build's water over this build's terrain and
nothing throws. **Anything new that consumes a `GameMap` or an `EnvironmentSpec`
goes in `installMap`.** What stays with the callers is what they genuinely
disagree about: the round applies the environment and repaints the sky while the
editor drives `applyEnvironment` itself so it can toggle its work light, and the
round alone owns what is about a *fight* — battle, conquest, flag markers, minimap.

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

**Six of those hand-offs are one line each and one object**, and they are worth
naming because they are new and because they look skippable. `map.rays` is the
segment query every ray in the game asks (`world/RayWorld.ts`), and `installMap`
pushes it to `CombatSystem`, `GrenadeSystem`, `AntiTankSystem`,
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
where the other runs `conquest` and the bots, and it poses the fleet off the
wire rather than stepping a crew. What they DO share is eight system updates
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
its own call site with the reason written there.**

**They are TWO blocks rather than one because the armour goes between them, and
it goes in a different place on each side**: offline the fleet is stepped before
the bots think, so a hull that has just pulled across a street breaks the
sightline on the frame it visibly blocked it; in a match it is posed from the
wire after the shots, because none of it decides anything. What both orders
guarantee is the only thing `stepAftermath` asks of a caller — that the hulls
have already moved this frame, since a mine's trigger is a distance test against
where a hull IS. **`stepAftermath` is also now the ONE place the physics world
is stepped anywhere in the client**, which was two places and a sentence in each
saying so; `scene.physicsEnabled` stays false precisely so that a pause, the
deploy map and the menu, all of which render, cannot advance it.

## Two things are pushed from `tick`, not from a state's own arm

The end-of-frame order inside `updateGameplay` is in
[`CLAUDE.md`](../CLAUDE.md), because three subsystems depend on it. These two are
the opposite case: they are owed by the states that simulate **nothing**, so
they cannot live in a chain that only a simulating state runs.

**The shader's eye is the one camera-derived thing that is NOT in that chain**,
because it is owed by the states that simulate nothing: `Game.tick` pushes
`mats.updateCamera()` once per frame in every state, last thing before
`scene.render()`. The scene renders behind the menu, the building card, the
deploy screen and the kit turntable, and all four would otherwise be fogged
against wherever the last *live* frame stood — the origin, before there has been
one. `updateCamera` guards on the position, so a state with a still camera pays
one comparison; and because a new material is seeded with that same eye
(`CelShader.applyCamera`), a map built under the building card comes out of
`installMap` already correct.

**`Game.pushScoreboard` is the other thing pushed from `tick` rather than from a
state's own arm**, and for the mirror reason: the Tab board is owed to `playing`,
`dying` and `deploy` alike, so it belongs to the ROUND rather than to the states
that simulate one. It runs after the switch and before the render, so the state
a frame ends in decides — which is what makes "the board goes when the round
does" one line instead of a `setScoreboard(false)` owed by every one of the six
ways out of a round. A lid takes it away, because a lid is a screen the player
asked for.

Both share a shape worth recognising before adding a third: the thing being
pushed is owed by a **span** of states rather than by one, and the span does not
match "is the world moving". Anything with that shape belongs in `tick` after
the switch, and anything without it belongs in the state's own arm.
