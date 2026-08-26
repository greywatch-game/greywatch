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
frame. `net/RegionBook.ts` is the worked example — the region list, its one
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

**Silent is the operative word.** A system that missed the funnel does not throw
and does not log; it renders, correctly, from a map that no longer exists. The
editor is where it shows first because the editor is the caller that rebuilds
most often, but a round is just as capable of it — and by then the symptom is a
map that looks a build out of date in one layer only, which reads as a bug in
that layer. The funnel is cheap insurance against a class of bug that costs a
day to attribute.

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
