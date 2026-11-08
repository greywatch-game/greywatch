# BABYLON_EXIT.md — getting the game off Babylon.js, one landed step at a time

The plan for removing `@babylonjs/core` from the tree, written like
`ENGINE_UPGRADE.md` and `PERF_PLAN.md`: **to be handed to a coding agent one
step at a time.** Each step lands on the **`babylon-exit` branch**, leaves the
game on that branch shippable, and is proven by an oracle run against the
commit before it. `develop` does not see any of it until the whole exit merges
at X6.2 — with one exception, by the user's call: X0.1 to X0.3 were merged
into `develop` early (see "The branch").

`CLAUDE.md` and the companions under `docs/` remain the contract for every
subsystem a step touches. This file argues about ORDER and about what proves
each step. Where it disagrees with a contract, the contract wins until the step
that changes it also rewrites it, in the same commit.

**What this file replaces.** `PERF_PLAN.md`'s Part B (B0–B5) and Part C (C1–C3,
C6) are steps here now, and B4's question — who owns the frame — is decided:
the game does. PERF_PLAN's Part A is resolved below (see "PERF_PLAN, step by
step"). Its argument, its measurements and its measurement protocol are still
the reference, and this file points at them rather than restating them.

**Where the landed notes are.** A LANDED step keeps its heading here with a
short summary (its commits, what it measured, any picture change or
decision, and what it still owes); its full notes, word for word, are in
[`plans/done/babylon_exit_phases_0-2.md`](plans/done/babylon_exit_phases_0-2.md)
for Phases 0 to 2 and in
[`plans/done/babylon_exit_landed.md`](plans/done/babylon_exit_landed.md) from
Phase 3 on, under the same heading, so a reference such as "X4.1d's note" or
"X3.6c's Owed onward" is searched for there.

---

## Why in place, and not a new app beside the old one

Every oracle in the tree (`kit:hash`, `merge:hash`, `parity`, `simulate`, the
reference bank, `drop.mjs`) compares a commit with its parent. Replacing
Babylon from inside the running game, one step per commit, keeps that true:
each step is graded against the commit it started from. A second app would have
nothing to compare itself with until it was nearly finished.

## The branch

The exit is done on one long-lived branch, so that if it goes badly `develop`
has nothing to revert.

- **Name:** `babylon-exit`, cut from `develop`. Every step lands there.
- **`develop` comes IN by merge, never by rebase.** Each LANDED marker in this
  file records a commit hash, and a rebase would rewrite every one of them.
  Merge `develop` into the branch when it has moved, at least at every phase
  gate, so the final merge stays small.
- **A merge from `develop` owes the oracles.** After one, run
  `npm run collision` if any layout or builder moved, then `npm run parity`.
  The bake's staleness guard hashes the layout, not the builders, so a builder
  change arriving by merge is the case it misses. From X1.2 on, any kit change arriving from `develop` is written
  against the old geometry layer. Convert it in the merge commit and prove it
  with `kit:hash` against `develop`'s version.
- **Tag every phase gate:** `exit-phase-0` through `exit-phase-5`. A tag is a
  known-good point to return to if a phase goes wrong. Moving the branch back
  to one is the user's call, never an agent's.
- **Nothing is cherry-picked to `develop` along the way** unless the user asks.
  Phase 0's instruments and Phase 1's typed arrays change no behaviour, so the
  phase-0 and phase-1 tags are the clean points if that is ever wanted.
- **X0.1 to X0.3 are already on `develop`**, merged `--no-ff` from this
  branch at 2026-10-09 by the user's call, before the phase-0 tag. The game
  deploys from `develop`, and X0.4's phone run needs `?bench=` on a deployed
  URL, because the phone takes no tooling (`PERF_PLAN.md` P0). Nothing in
  those three steps changes a pixel or touches Babylon. Their one change to
  play is that each bot's movement stream restarts every round (X0.2). So
  X6.2's merge carries Phase 1 onwards, and its `revert -m 1` leaves the
  instruments on `develop`, which is what is wanted.
- **A second early merge, after X2.5c**, by the user's call on 2026-10-11
  (first planned for after X2.5b, then moved, because X2.5c deletes most of
  X2.5b's transport and `develop` should not deploy it in between): once
  X2.5c lands and has been code-reviewed, the branch is merged `--no-ff` into
  `develop`, so the phone can install and run the deployed build (X2.5c's
  Verify). That merge carries Phases 1 and 2 to `develop`, so from then on
  X6.2's merge carries Phase 3 onwards, and its `revert -m 1` no longer takes
  Phases 1 and 2 back out.
- **If the exit is abandoned,** `develop` is untouched and the branch is kept
  for its findings, not deleted.

The order follows from one idea: **Babylon stays the owner of the frame until
it owns nothing.** The simulation leaves it first (it has the most to gain and
the server proves it), then the static world is drawn by our renderer inside
Babylon's frame, then everything else that draws, then the post chain, and only
then the frame loop itself, at which point taking the frame is mostly deletion.

## The shape

| phase | what moves | ends when |
| --- | --- | --- |
| **0. Instruments** | nothing — the oracles this plan needs and the "before" | the bank and the benchmark both reproduce |
| **1. Data off Babylon types** | math, geometry and the merge become plain arrays | `kit:hash` and `merge:hash` identical, no pixel moved |
| **2. The simulation off the scene** | sweeps, state, the server, Havok, one core in a Worker | `server/` and the simulation import nothing from Babylon (a build gate says so) |
| **3. The static world** | our renderer draws blocks, scatter and terrain, in every pass | Babylon builds no mesh in a round for anything our renderer draws (glazing and fires stay Babylon's until X4.6 and X4.4) — met at X3.7b; the world passes Babylon kept for the fallback deleted at X3.7c, but the editor's (X5.3) |
| **4. Everything else that draws** | bodies, hulls, the viewmodel, effects, sky, water, glass, grass, particles | Babylon's scene draws nothing but the post chain |
| **5. The frame** | GI compute, the post chain, the editor, the loop | Babylon's engine is not constructed |
| **6. The cut** | the package, the gates, the docs, then the merge | `develop` carries the exit as one merge commit |

---

## Rules every step obeys

1. **One step, one series of commits, landed on `babylon-exit`.** The game
   on the branch could ship after every step: `npm run build` passes, a round
   plays offline and in a match. Nothing ships from the branch; it stays
   shippable so the gates mean something and a phase tag is a real fallback.
2. **Every step names its oracle and runs it against its parent.** No pixel
   moves unless the step says it will; a step that changes the picture does so
   in its own commit with the reference bank's numbers in the message (A1's
   907c0f0 is the precedent).
3. **Babylon stays at 9.28 for the duration.** An upgrade during the exit
   re-opens every seam and every copied internal at once. If one becomes
   unavoidable it is its own step, with `merge:hash` against the version
   before (`docs/build.md`).
4. **Every touch of a Babylon internal lives in one file**,
   `src/render/babylonSeam.ts`, created by X3.2. Its header keeps a numbered
   list of what it reaches into. The list may grow through Phase 3 and must
   only shrink after it. A step that needs a second place to touch an internal
   is a step that has gone wrong.
5. **A GPU resource lives with whatever produces it.** While both renderers
   run, the side that does not own a texture or buffer reads a wrapped view of
   it through the seam. It never copies it and never owns a second one.
6. **`src/render/` and `src/math/` never import `@babylonjs/core`.** X2.3 adds
   a build gate for `server/` and the simulation; X3.2 adds these two
   directories to it; X6.1 widens it to the whole tree. The one exception is
   `src/math/babylon.ts`, the crossing X1.1 made: the gate names it, and it is
   deleted at X6.1.
7. **A step that breaks a contract rewrites it in the same commit** —
   `CLAUDE.md`, the companion under `docs/`, `FILES.md`, and any contract
   header it invalidates. "Contracts this plan rewrites" below lists where.
8. **Art keeps landing.** From X1.2 on, a builder is written against the new
   geometry layer only, and every rework is proven with `kit:hash`.
9. **Every new module gets a contract header and a `FILES.md` line**, as
   `CLAUDE.md` requires of every source file.
10. **Measure the way `PERF_PLAN.md` says to** ("The measurement protocol"):
    one instrument, one lever, several runs a side, nothing under ~8% read as
    real, ratios within a session over absolutes across sessions.

## How to hand a step to an agent

One step per session, in order, with this prompt:

> On the `babylon-exit` branch, do step **X?.?** of `BABYLON_EXIT.md`. Read
> `CLAUDE.md`, that file's "The branch" and "Rules every step obeys", and the
> step's "Read first" before writing code. When the step's Verify passes,
> update the docs the step names, commit on `babylon-exit`, mark the step
> LANDED in `BABYLON_EXIT.md` with the commit and what was measured, and stop.
> Do not touch `develop`.

A step marked **(decision)** has a question for you in "Decisions that are
yours" at the end of this file. Answer it before handing the step over. A step
marked **(decision at the end)** is handed over as it is: the agent stops
before its last part and brings you what you need to answer it.

---

## Phase 0 — Instruments

**Landed, and tagged `exit-phase-0` on 2026-10-09:** the bank 47 of 47, the
benchmark within 2.3% on the desktop and 4.5% on the phone's Sarab, one fight
per map on both devices. Phases 0 to 2 are archived word for word, with every
step's brief, findings and measurements, in
[`plans/done/babylon_exit_phases_0-2.md`](plans/done/babylon_exit_phases_0-2.md).
What stays here under each heading is what it landed and what a later step still
uses or owes.

### X0.1 — A reference bank that reproduces, and covers what will move — **M** — **LANDED** (9246a72)

The reference bank in `plans/webgpu-ref/` (`bank.mjs`, `vantages.mjs`,
`diff.mjs`) reproduces: 47 rows on seven maps, `--check` twice in a row at 0%
of pixels and 0/255. Its rows cover what Phases 3 to 5 move: rigs at 6 m and
250 m, every hull kind, the viewmodel hip and aimed for each optic, a blast in
the air, see-through glazing, a capture ring, the night map, and each post
setting on and off. The bank's README says which rows serve which step, and
`mode.json` records the browser, the adapter and the settings. **It is the look
oracle for every step from X3.1 on** (`bank.mjs --check`). The full record is
in the archive.

### X0.2 — Seeded randomness in the simulation (PERF_PLAN C1) — **S** — **LANDED** (08a52fd)

Every outcome draws from a per-shooter stream out of
`src/systems/RoundRandom.ts`, reseeded once a round. `?seed=` and `simulate`'s
fourth argument fix the seed, every capture records it, and `simulate` prints
`fight`, a hash over the kill list in order. **The fixed seed (777) is what
makes the benchmark's and `simulate`'s fight hashes an oracle for every later
step.** The bots' movement streams and the per-squad skill draw keep their
constant seeds on purpose; whether the movement streams should vary is in
"Decisions that are yours". The full record is in the archive.

### X0.3 — A benchmark that runs itself on any device — **M** — **LANDED** (6e2e7a9)

`?bench=<map>` plays the bank's vantages at eight headings, a path through the
quarter with the most built ground, and a bot-only round from seed 777, every
frame on the fixed 1/60 s step. It ends in a capture labelled by segment on a
halted ring, carrying the fight's hash, and needs nothing on a phone but the
URL. `plans/webgpu-ref/bench.mjs` is the desktop wrapper (3440x1440 by
default). **Every "X0.3" under a later Verify means this run**, read by
`PERF_PLAN.md`'s protocol (the ~8% floor); `docs/profiling.md`'s "The
benchmark" holds the three things its first version got wrong. The full record
is in the archive.

### X0.4 — The "before", then the targets — **S** (decision at the end) — **LANDED** (2048484)

**Landed.** The "before" is `FINDINGS.md` 52: Greyfen and Sarab, the desktop
at max settings (`bench.mjs --max`, three runs a map, every group within
2.3%) and the phone at minimal ones (two warm runs a map, after a warm-up run
that was thrown away). Both devices fought one fight per map. On the desktop,
and in the phone's Sarab fight, the CPU's work is nearly the whole frame and
recording the draw calls is most of that, which is what the exit moves. The
phone's Greyfen frames wait on the GPU. The phone's GPU share is inferred, not
measured; `?bench=<map>&gpu` would measure it and is not needed before X6.2.

**The targets** (the user's, 2026-10-09). X6.2 checks each against a run of
X0.3 taken as `FINDINGS.md` 52 took it:

| device | map | render scale | statistic | target | before |
| --- | --- | --- | --- | --- | --- |
| the phone, minimal settings, warm | Sarab, the fight | 0.5 | p95 | **at or under 25 ms** | 36-37 ms |
| the phone, minimal settings, warm | Greyfen, the fight | 0.5 | p95 | **at or under 69 ms** (no regression) | 69 ms |
| the desktop, `--max`, uncapped 3440x1440 | Sarab, the fight | 1 | 1% low | **at or under 12 ms** | 17.2 ms |

The first is the exit's own: the fight's frame is CPU in the render on that
phone. The second is a floor, because Greyfen's frame on the phone is the GPU,
which the exit does not port away. The desktop's is a 1% low, not a p95,
because an uncapped frame arrives in bursts and its p95 sits at about twice
its mean.

The targets are set from measurements, not guessed ahead of them. A target set
blind can be out of the exit's reach whatever the exit does. At render scale
0.5 the phone is limited by its GPU (`FINDINGS.md` 50), and at 0.75 by
per-pixel shader cost (`FINDINGS.md` 13). The shaders port unchanged, so no
renderer rewrite moves either.

**How the "before" was taken, which X6.2's runs repeat:** the desktop with
`bench.mjs --max`, uncapped at 3440x1440, three runs a map in one session; the
phone from the deployed build at minimal settings (render scale 0.5, the 60 fps
cap, every quality setting at its lowest, GI off), **warm**: one warm-up run
thrown away, then the runs back to back in the same screen state and settings.
The full brief, and why Cinderhaven, Coldharbour and the tablet were dropped,
are in the archive.

---

## Phase 1 — Data off Babylon types

**Landed, and tagged `exit-phase-1` on 2026-10-10** (the merge of `develop` at
09e35f8): `kit:hash` (3,722 builds), `kit:hash --models` (244, no content
change), `merge:hash` on all eight maps shipped and `--editor`, and the bank 47
of 47 at 0% of pixels at 3b35779.

### X1.1 — `src/math/`, and the world's data layer on it — **M** — **LANDED** (ad863e7)

`src/math/` holds the subset of Babylon's `Vector3`, `Quaternion`, `Matrix`,
`Color3` and `Color4` that the tree calls, under the same names, bit for bit
(`scripts/math-check.mjs`). The world's data layer runs on it: every layout and
generator, `mapTypes`, `NavGrid`, `CoverMap`, `ObstacleField` and `RayWorld`.
**What it costs every later step:** one of our vectors handed to a Babylon
method reads `_x` and writes NaN without an error, so a function both sides
call takes `Vector3Like` or `Vector3Ref`. Every copy into Babylon goes through
`src/math/babylon.ts`, the one file under `src/math/` that imports Babylon.
Rule 6 names it, X6.1 deletes it, and each step that moves a caller off
Babylon removes that caller's use of it. The editor's serializer recognises a
position with `instanceof`, so anything put into a layout is our `Vector3`.
The full record is in the archive.

### X1.2 — Geometry as typed arrays: the `Build` layer and the kit — **M** — **LANDED** (df89358)

`src/geometry/` holds `GeometryBuffer` and six generators (box, cylinder,
torus, icosphere, sphere, polyhedron), copied from Babylon 9.28 with its
Apache-2.0 notice and checked by `scripts/geometry-check.mjs`. `Build` and
every scatter prop make `Part`s whose transforms are data, composed at emit
time by `flattenParts`. **An array's type is its precision:** a buffer holds a
`Float64Array` where Babylon held a `number[]` and a `Float32Array` where it
held one, and never converts between them. Rule 8 dates from here: a builder
is written against this layer and proven with `kit:hash`, and a kit change
merged in from `develop` is converted in the merge commit. The full record is
in the archive.

### X1.3 — The rest of the geometry — **M** — **LANDED** (3bcaca7)

Every model outside the kit builds on buffers: the weapons, the optics, the
hulls, the soldier's geometry, the four thrown or laid things and the capture
ring. They merge with `mergeTransformed`, which reproduces
`VertexData._mergeCoroutine`'s bits, and `kit:hash --models` (244 builds of 20
kinds) is their oracle. **What it leaves for later steps:** live joints are
still Babylon `TransformNode`s. The rig, and the root capsule `WorldCulling`
measures a body by, go at X4.1. The flag's cloth stays a live simulation with
updatable buffers. The full record is in the archive.

### X1.4 — The merge and the vertex bake on arrays — **M** — **LANDED** (3b35779)

The merges and the vertex bake run on `WorldSurface`s. `GameMap.world` is the
record, one `SurfaceRecord` per visual (name, material, metadata, block,
pieces, counts), and `worldMeshes` is the one adapter.
- **Each surface carries PIECE ranges** through every merge. A piece is a
  layout item from `GameMap.world.pieces`, and a DEV assertion checks that the
  ranges tile each surface. **X3.3b keeps a piece id per cluster, and
  destructible buildings need it.**
- **A surface's creation order (`born`) is part of the picture:** candidates
  arrive in scene order, which reaches the glow mask and the transparent
  tie-breaks.
- **What is left between the world and Babylon is public API:** the adapter
  (`VertexData.applyToMesh`, `Mesh.setVerticesData`), and the colliders
  (`MeshBuilder.CreateBox`, `Mesh.MergeMeshes`), which now serve only the
  editor's pick.
- **A Babylon upgrade owes geometry-check, then math-check, then
  `merge:hash`** (`docs/build.md`).

The full record is in the archive.

---

## Phase 2 — The simulation off the scene

`server/` and every simulation import nothing from Babylon, and X2.3's gate
says so. **No phase tag yet:** X2.5c's Verify still owes the play-test and the
phone (below).

### X2.1 — The three sweeps are ours (PERF_PLAN C2) — **L** — **LANDED** (b7607c3)

Landed on the user's play-test, on foot and in all three vehicle kinds. The
three sweeps (`Player.update`, `Vehicle.update`, `Vehicle.coast`) run through
`CollisionField` over `src/world/ellipsoidSweep.ts`: Babylon 9.28's
`moveWithCollisions` ported with its arithmetic and quirks, fed
`RayWorld.bodyNear`'s candidates and ranked in the client's collider-mesh order
from `boxGroups`. `scripts/sweep-check.mjs` is the oracle. **The sweep is a
copied Babylon internal, so a Babylon upgrade owes `sweep-check`**
(`docs/build.md`). The full record is in the archive.

### X2.2 — State off the nodes, and every mixed system split (PERF_PLAN C3) — **L** — **LANDED** (11f731f)

Every system that both simulated and drew is now two modules. The simulation
keeps the old name, holds its state on `src/math` and imports no Babylon. Its
view (`CombatFx`, `GrenadeFx`, `AntiTankFx`, `GlassFx`, `VehicleView`,
`HullWhips`, `VehicleViews`, `PlayerView`) reads it and never writes it.
**Phase 4 moves the view modules.** No outcome reads a node: the muzzles are
replayed from fields (`soldierPose.ts`, `hullFrame.ts`). This step's
`BotRig` and `BattleView` were deleted at X2.5c C5, and every body a page draws
is now a `NetSoldier`. The full record, with the table and the fight change at
C6, is in the archive.

### X2.3 — The authority without Babylon — **M** — **LANDED** (8a4831d)

The authority builds its world from the bake with no mesh and no scene, and
`dist-server` imports no Babylon. **The gate** is
`scripts/check-babylon-free.mjs`, run by `npm run build`:
- Its roots are every file in `server/`, plus the simulations listed in
  `SIMULATIONS`. A new simulation joins that list in the commit that creates
  it.
- It skips only erased imports, and fails on anything it cannot follow.
- `vite.server.config.ts`'s `no-babylon` plugin applies the same rule in the
  bundler.

**`DIRECTORIES`/`NOT_ROOTS` are where X3.2 adds `src/render/`, `src/math/` and
the `src/math/babylon.ts` exception** (Rule 6). X6.1 then widens the gate to
the whole tree. The full record is in the archive.

### X2.4 — Havok, called directly — **M** — **LANDED** (823906c)

Babylon's `HavokPlugin` is gone. `src/systems/havok.ts` speaks Havok's raw
`HP_*` API, and `PhysicsWorld` (Babylon-free, a root of the gate) owns the
world and the substep. **A body's pose is seven numbers in a `Float64Array`**
(`WorldBody.pose`), which each client's view draws (`poseView.ts`); those are
the arrays X4.1 reads. The port was bit-exact (`drop.mjs --check --exact`,
`clients.mjs --check`). It kept the world's friction at 0.5 (`FINDINGS.md` 53),
and raising it is a separate commit, on the user's word. `FINDINGS.md` 57, 58
and 59 were found on the way and left, each the user's call.
`scene.physicsEnabled = false` stays `Game`'s until X5.4. The full record is in
the archive.

### X2.5 — One simulation core, in a Worker — **L**, as three sub-steps (two decided 2026-10-10, the third 2026-10-11)

One core ends the class of bug where two simulations drift apart (`paysKiller`,
the capture awards). The Worker was the user's call on 2026-10-10, for where
the game is going rather than what it measured:
- Phases 3 to 5 cut the CPU the frame is bound by, so the simulation becomes a
  larger share of what is left.
- Larger maps with more bodies are coming.
- Moving the core while it is being made one is cheapest.

X2.5c was added after X2.5b, to give the page one client model instead of two.
The full argument is in the archive.

#### X2.5a — One core, in the page — **M** (ran **L**) — **LANDED** (e328d43)

Landed on the user's offline play-test. `SimCore` (`src/sim/`) is the one
simulation, hosted by `Match`, `simulate` and `corecheck`; since X2.5c the
page's own round is a `Match` too.
- It reads no clock and draws no seed: its host supplies `RoundSpec.seed`,
  `anchor`/`drop` and an optional timing clock.
- `SimCore.submit(slot, SimCommand)` is the one way in, and an allocation-free
  event ring is the one way out.
- `npm run corecheck` drives the core with no `Game`, through the trusted door
  and then through a real `Match`, and both must drain identical events.

**The bench's seven fight hashes, held through X2.5b and X2.5c:**
Greyfen `83e8e74ef36916ba`, Hollowmere `549487ba93bceefe`,
Coldharbour `de5622634abca6e7`, Harrowmead `3ae90f2f08fb0643`, Sarab
`986c2e35557fb679`, Cinderhaven `2f97c9072ab1762b`, Kurenai
`cd58b73111eacbdd`. The full record, with the twenty-one drifts it removed, is
in the archive.

#### X2.5b — The core in a Worker — **M** — **LANDED** (e454421) — **transport SUPERSEDED by X2.5c**

The shared-memory transport (`SimHost`, the codec, the publication) was deleted
at X2.5c C5, and cross-origin isolation was removed at C6. What survived is
X2.5c's "Keep from X2.5b", below. Among it is the root fix for
`FINDINGS.md` 61, `useDefineForClassFields: false`. The two decisions taken
here still hold, and both are in "Decisions that are yours": offline shots are
rewound in both modes, and the authority runs its core in-process. The full
record is in the archive.

#### X2.5c — Offline is a match client of a local `Match` — **M–L**

**C0 to C6 have landed** (C0 99cbfb3 through C6's review 1f4fa6f, plus the
fixes after that review, 132277a). Offline is a match client of an owned
`Match` in a Worker, over the existing JSON protocol, and the page has one
client model. **The step's rule stands for every later step:** whatever about
the online experience is not acceptable offline is fixed for BOTH. Offline
never gets a better transport, and a binary wire comes later, for both, only
if a capture asks for it.

**Keep from X2.5b** (all kept):
- `useDefineForClassFields: false` and its CLAUDE.md convention;
- `LagComp.record`'s allocation fix;
- `ShotWeapon` (a shot carries five numbers, not the `WeaponSetup`);
- `HULL_EARLY` as one constant shared with `Match`;
- the Worker boot in `main.ts` (awaited, with a fallback, and a boot line
  saying which one runs);
- the round named by map id rather than by posted import thunks;
- the profiler's `sim` root on the page's `timeOrigin`, re-pointed at
  `Match`'s step.

**Still owed before the step is closed:**
- **The user's play-test:** a netplay round on a local match server, then back
  to the menu for an offline round on the local match, on foot and in each
  vehicle kind.
- **The phone, offline Sarab, read off the profiler,** against X0.4's "before"
  and X2.5b's desktop reading. It runs from the deployed build, installed and
  offline, with the local match in its Worker. Anything wrong there is fixed
  for both modes.
- **Then the second early merge** to `develop`, after a code review ("The
  branch").

**Left open, smaller:**
- The feed never says "YOU" for the player's own kills: `kill` carries the
  killer's team and not their slot. The fix is a field on `kill`, for both.
- A refused grenade or rocket is still drawn flying on.
- The bench's round-end capture path (a fight that ends the round before
  its clock does) has never been exercised.
- corecheck does not cover the core's own refusal (a full pool), the rate
  gate, the mine, or the silence after an ask from a dead body or an empty
  pouch.
- An armed profiler's `advance` answer brings its timing as a fresh copy. A
  binary owner channel is the answer if a capture ever shows it matters.

The full record is in the archive: the shape, the commits C0 to C6, the traps,
what each commit found and decided, and what each left behind.

---

## Phase 3 — Our renderer draws the static world

Babylon still owns the frame. Our module draws inside Babylon's passes through
the seam.

**The end condition reads true** — "Babylon builds no mesh in a round for
anything our renderer draws" — since X3.7b, and since X3.7c no fallback pass
of Babylon's is left for a round (the editor's build keeps the generators and
the lamps' render target, X5.3's). **No phase tag yet**: the phone's
follow-up reading owed since X3.3c, and the tag itself, are the user's
(X3.7c, "Owed onward").

Phase 3 is archived word for word, with every step's brief, findings,
measurements and reviews, in
[`plans/done/babylon_exit_landed.md`](plans/done/babylon_exit_landed.md).
What stays here under each heading is what it landed and what a later step
still uses or owes.

### X3.1 — The shared WGSL (PERF_PLAN B0) — **M** — **LANDED** (ab51aa7)

**Landed** (ab51aa7, review fixes f5320eb). The cel fragment's body is one
Babylon-free function, `celSurface()` (`shaders/wgsl/chunks.ts`'s
`WGSL_CHUNKS`, the one table, and `shaders/wgsl/celSurface.ts`). **A body
declares nothing**: Babylon's declarations are `includes.ts`' `DECLARATIONS`,
ours are data (`render/celFragment.ts`) turned into plain WGSL with explicit
bind groups by `render/wgsl/assemble.ts` and `preprocess.ts`. Every registered
include goes through `stripComments` (the review: Babylon strips only the
top-level source). `src/render/` joined the Babylon-free gate here.
**Measured:** the 68 cel fragments Babylon compiles differ only by `main`
calling `celSurface()`; the bank 0% on every row once Sarab was re-banked (its
two rig rows were stale from before the step; `ref/` is outside git);
`shaders.mjs` clean on seven maps, the bumped ground at 16 of 16 sampled
textures and samplers on our side too. Its three owed items went to X3.2 and
X3.3a, which closed them. The full record is in
[the archive](plans/done/babylon_exit_landed.md).

### X3.2 — `src/render/`: device, pipelines, frame uniforms, and the seam — **M** — **LANDED** (e59b96a)

**Landed** (e59b96a). `render/babylonSeam.ts`'s `BabylonFrameHost` implements
`render/frameHost.ts`'s `FrameHost`, the interface a host of the game's own
implements at X5.4, and its header numbers every internal it reaches (five
here, the list growing through Phase 3). Our draws are QUEUED into Babylon's
bundle list, never issued raw; the main pass is the target bound as the draw
phase begins; the attachments are stated once (`render/targets.ts`:
`rgba8unorm`, `depth32float`, 1 sample, y-flipped, `CelInk`'s target); the
frame's uniforms (`render/frame.ts`' `FRAME_BLOCK`) are PULLED off the
factory's fields once a frame (`fillFrame`). The gate walks `src/math/`, with
`math/babylon.ts` in `NOT_ROOTS`. **Measured:** the bank 0% on every row of
seven maps; a DEV test draw (869 of 869 frame floats read back, a triangle
where expected) deleted before the commit. **Rule 4 as read from here:**
"every internal OUR RENDERER reaches" — six older touches in four files
(`FrameDepth`, `webgpuLeaks`, `ReflectionSystem`, `FrameProfile`) stay where
they are, listed in the seam's header with the step each leaves at
(`FrameDepth` at X5.4, the rest at X6.1). Its four owed items went to X3.3a.
The full record is in [the archive](plans/done/babylon_exit_landed.md).

### X3.3 — The static world's main pass (PERF_PLAN B1) — **L, as three sub-steps** (split 2026-10-13)

The blocks' main pass, split so correctness and speed were proven apart: (a)
our pipeline draws the blocks to the pixel behind `?ourworld`, (b) clusters
and a GPU cull under the same switch, (c) the switch comes out. **The
whole-step review** (5525a5d, after all three) made a refused main pass and a
failed compile hand the blocks back instead of leaving a hole (both are
`Game.worldFailed` since X3.7b) and added `blocks` to the capture (report
version 17). **The gate after X3.3c was met**: main-pass draws fell and the
desktop's CPU TICK improved in every group, so the exit went on. The gate read
the tick, not the frame, because the phone is GPU-bound on Greyfen once warm;
the phone's `gpu.frame` is judged only by the GPU-side work after the exit.
The full record, with the review and the gate's argument, is in
[the archive](plans/done/babylon_exit_landed.md).

#### X3.3a — Our cel pipeline draws the blocks, to the pixel — **M** — **LANDED** (b130995)

**Landed** (b130995). The cel vertex stage is shared
(`shaders/wgsl/celVertex.ts`); our main pass owes the clip-y negation in the vertex stage
and nothing in the fragment (Babylon's processor settled it, the reverse of
what X3.1 and X3.2 recorded); the blocks draw at the END of group 0's opaque
and alpha-tested lists; the textures are Babylon's own views and samplers,
re-resolved every frame; a material is its RECIPE (`own`/`ownTexture`); and
`PipelineCache`'s front face was backwards (`PipelineState.reversed`).
**Measured:** the bank 47 of 47 at 0% with the switch off and within the floor
with it on, the residue equal-depth ties Babylon settles by its own sort;
`census.mjs` (new) equal; the user's play-test fine. **Still owed from it:** a
fragment for the CANVAS is refused until a frame field carries the render
height (the first canvas pass, X5, owes it); no depth or unfilterable texture
is bound yet, so X3.2's binding field, and Babylon's `unfilterable-float`
fallback, are owed to the first one that is. The full record is in
[the archive](plans/done/babylon_exit_landed.md).

#### X3.3b — Clusters, the compute cull and indirect draws — **M–L** — **LANDED** (04d1b89, review fixes e21c9ac)

**Landed** (04d1b89, review fixes e21c9ac). Each taken surface is cut once at
install into clusters of at most 128 triangles of one X1.4 piece
(`render/clusters.ts`), each carrying its block, piece, box and wind reach; a
group is a recipe; a three-pass compute cull (`render/ClusterCull.ts`) tests
the reach, the size gate and the frustum and places survivors NEAR-FIRST by a
scan, banded per SURFACE, so an equal-depth tie settles the same way every
time. **Since 2026-10-18 the blocks' draw is a PLAIN `drawIndexed`**, the cull
clearing its output first: an Intel Xe-LPG dropped indirect draws
(`docs/rendering.md`, "NOTHING OF THE STATIC WORLD IS DRAWN OR DISPATCHED
INDIRECT"). **Measured:** the bank 47 of 47 within the floor on, 0% off;
main-pass draws fall on all seven maps (Greyfen 382 to 172). **Owed onward:**
A5 (occlusion), when it comes, goes into `cullClusters` beside the frustum;
destructible buildings mask by the cluster's piece. The full record is in
[the archive](plans/done/babylon_exit_landed.md).

#### X3.3c — Our path is the path — **S–M** — **LANDED** (0b49881, review fixes 70cb3f8)

**Landed** (0b49881, review fixes 70cb3f8). Our renderer draws the blocks in
the main pass in every build. The cull is recorded into Babylon's upload
encoder (the seam's item 9), so `?gpu` counts it; `PipelineCache` counts
compiles and the warm-up waits for ours (`warmup.oursCapMs`). **Measured**
(against a BEFORE at 69a7744): the bank 47 of 47 within the floor; main-pass
draws fall on all seven maps; on the desktop the tick falls in every group
(Sarab's fight 11.40 to 9.56 ms; its 1% low 17.1 ms against X6.2's target of
12). Greyfen's path turned GPU-bound (`gpu.frame` 5.31 to 5.77 ms), which went
to `FINDINGS.md` 61: `gpu.cull` (built 2026-10-20) is 27-66 µs and not the
rise, and the draw order was most of it (X3.5). **Owed onward:** the phone's
reading, taken since as X3.5's (X3.5b's BEFORE), and the phone's FOLLOW-UP
reading owed by every step after it; the GPU-side remainder waits with the
rest of the GPU work until after the exit. The full record is in
[the archive](plans/done/babylon_exit_landed.md).

### X3.4 — Scatter as instances (PERF_PLAN B2) — **M–L** (decision) — **LANDED** (1a20232 + f20a9ae)

**Landed** (X3.4a 1a20232, X3.4b f20a9ae). **Decided** (the user,
2026-10-14): **the colour buffer is baked once per kind**, as if the prop
stood alone on flat, open ground (the AO in the alpha and the wear in the blue
lose their placement; the world mark and the sway hold), and **16 variants a
kind**, every placement wearing one by a hash of where it sits, never a draw
— both look changes, judged in the bank. **The user's fallback if the look is
wrong:** keep the per-kind bake and add one or two numbers per instance, baked
at placement (how hemmed in the footing is, how far the ground darkens the
base). **X3.4a:** the placement did not move (`collision` rewrote no bake,
`parity` passed; the shared stream is REPLAYED per kind,
`world/props/sharedDraws.ts`, and `kit:hash` checks the replay against the
builder); the build's scatter phase ran 2-4x faster. **X3.4b:** our main pass
drew the variants as instances (`InstanceCull`); our world's buffers fell
(Greyfen 680 to 81 MB) and the draws rose to one a part of a set; the
desktop's frame did not move; the per-kind bake moved the bank by a mean of
0.22/255 at most. **Destructible props:** none on the branch (06fca4f is a
dangling commit); when they land, a wrecked prop is an instance the cull
drops. The draws were folded at X3.5b. The full record is in
[the archive](plans/done/babylon_exit_landed.md).

### X3.5 — Terrain and roads (PERF_PLAN B5) — **M** — **LANDED** (b2c9bc6, review fixes a24339d, 0dd2d09)

**Landed** (54ec8c0 the instruments, b2c9bc6 the step, a24339d the review's
fixes, 0dd2d09 the measurement's fix, afa0327 the review's tidy; then 39d84ea,
2026-10-19, the blocks ahead of the landform). Our renderer takes the
LANDFORM — the floor's patches (the borderland's too), the rim and the
map-wide road merge — marked by the build on the record
(`WorldSurface.landform`), with no reach (the size gate and the frustum only);
the roads' -8 is the pipeline's `depthBias`, and a biased group draws first;
an editor build takes nothing. Since 39d84ea the blocks, the scatter and the
landform draw as one `FrameDraw` at `"beforeAlphaTest"` (the seam's item 10),
so the floor behind a building fails the depth test before it shades. **A
contract X3.5 opened:** anything lying on the floor that writes NO depth must
be blended or on the alpha-tested list, never opaque (`CLAUDE.md`,
`docs/rendering.md`). **Measured:** `merge:hash` identical; the bank 61 of 61
within the floor against a BEFORE kept with `--keep` (14 new `ground` and
`crossing` rows); census falls on every map; drawing the roads first took
back about half of Cinderhaven's GPU rise, and the blocks-ahead order took
4.7-7.5% off every path's mean frame on the desktop. **Owed onward:**
- the landform's remaining GPU rise (about 0.6 ms on Cinderhaven's path)
  stays in `FINDINGS.md` 61, the cull its first suspect;
- **the bank's old rows are stale**: 33 of the 47 banked before X3.5 fail a
  plain `--check` on an unchanged tree. Re-taking them is the user's call;
  until then a step is graded against a BEFORE kept with `--keep` at its
  parent (`plans/webgpu-ref/README.md`);
- the phone's reading was taken 2026-10-21 as X3.5b's BEFORE, and **its
  settings are the protocol every later phone reading repeats**
  (`?bench=<map>&gpu` with the unsafe-WebGPU flag, render scale 0.5, cap 60,
  shadows, grass, Trees and glow `low`, volumetrics, GI, ground relief and
  FXAA off, blur and grain OFF, the minimap on, one matched canvas size); a
  difference across sessions reads only past about 8%.

The full record is in [the archive](plans/done/babylon_exit_landed.md).

### X3.5b — The fold: one draw a recipe, blocks and scatter together — **M–L** (decision) — **LANDED** (52e1343, review fixes after it)

**Landed** (52e1343, 2026-10-21; review fixes ebdcb6f, then 0d54721, 8660afd
and a78a4eb). **Decided** (the user, 2026-10-14) to land before X3.6. One
PULLED vertex stage draws the whole stream (no vertex buffer, every attribute
read from a storage array, `world` built per instance), and the instance cull
EXPANDS each surviving instance into its clusters. **It is not one draw a
recipe**: a group with scatter is two draws (the blocks' plain draw and the
scatter's), and a group is a recipe a LAYER, which keeps every block ahead of
every landform draw. **Measured:** ours a vantage falls (Greyfen 161 to 17);
the bank 61 of 61 within the floor, 57 byte-identical; the desktop's fights
faster (Sarab's tick 11.19 to 9.77 ms). **What followed, by date:** on the
phone the expanded cull cost 1.1-1.4 ms of GPU on the forest maps while
Sarab's fight got a quarter cheaper on the CPU (2026-10-21); `expand` was
launched over the survivors (1ec93a4) and read a 16-bit source (765d7b6);
then, **by the user's decision on the phone's A/B (2026-10-23)**, the scatter
is drawn from its survivors' LIST and the expanded stream and its memory are
gone (e07ae7c, `render/scatterList.ts`; `FINDINGS.md` 63 deleted as fixed);
and **since 2026-10-24 the scatter is drawn PLAIN at a bound the CPU
computes** (e172f88, review 071a95e, the switches stripped at 68b84b3), after
the Intel laptop's trees flickered: its A/B convicted the indirect DRAWS, and
`expand` stays direct by the user's decision, so nothing of the static world
is drawn or dispatched indirect. **Owed onward:**
- the phone, against a capture of the build before e172f88, alternated:
  `bound()` loops over every instance of the map on every dispatch (25-35 µs
  a dispatch on the desktop), so a phone frame re-baking several lamp faces,
  or a probe burst, could add a few ms of CPU;
- a same-session pair against 3b9be6c, to price the fold itself.

The full record is in [the archive](plans/done/babylon_exit_landed.md).

### X3.6 — The static world's other passes (PERF_PLAN B3) — **L, as five sub-steps** (the fifth added 2026-10-24)

Each pass moved to our renderer whenever the handover holds everything that
pass draws, its texture moving to our side and Babylon's readers sampling a
wrapped view (rule 5) — but for X3.6d's: the glow's MASK stays `GlowPass`'s,
and ours draws into it. Every pass draws through X3.5b's fold.
- **X3.6a — the world's shadows LANDED** (93d5918, review fixes 4fd2e85;
  2026-10-23). Both cascades, the foliage map and the lightning's are ours
  (`render/WorldShadows.ts`, drawn by `WorldDepth`); `ShadowSystem` keeps the
  lights, the windows, the snap, the hold and the strike. The bank 61 of 61
  within the floor; X0.3 level. The desktop's stalls are its D3D12 device
  hanging, not the step's (`FINDINGS.md` 64). **Owed:** the shadow maps are
  not timed on our side, so the phone's follow-up is read as `gpu.frame`.
- **X3.6b — the lamps' atlas LANDED** (5b31851, review fixes aef7328;
  2026-10-23). `render/LampAtlas.ts` owns the atlas and draws every pass of
  it; `LocalShadows` still decides everything. The bank 61 of 61
  byte-identical. **Owed:** the atlas's passes are not timed on our side;
  dynamic tiles with BODIES in them were never compared texel for texel.
- **X3.6c — the reflection bake LANDED** (9a3cdbb, review fixes 5752574;
  2026-10-24). `render/ProbeBake.ts` owns each probe's cube, baked with the
  probe's eye passed explicitly (242b986's harness: 0 texels moved with the
  camera 600 m off); `ReflectionSystem` still decides. The bank 50 of 61
  within the floor: the 11 over are Harrowmead's millpond and the sights over
  it, X3.4's scatter difference seen in the pond. Coldharbour's 39 probes
  drain in 5 frames, where Babylon's bake spent one ~2.3 s frame. **Owed:**
  the fire, when it moves (X4.4), owes the bake a program, and
  `FINDINGS.md` 51's near case is still open; the phone's follow-up is read
  as the loading card's length.
- **X3.6d — the glow mask LANDED** (6dc5122, review fixes c34a06b;
  2026-10-24). `render/WorldGlow.ts` draws the emissive palette's share of
  the mask, INTO `GlowPass`'s pass; the mask 0 texels against Babylon's on
  every row, the bank 61 of 61 byte-identical. **Owed:** the phone's
  follow-up is also the tie's check on a second GPU (a driver rounding the
  shared vertex body differently would drop palette bloom), and
  `FINDINGS.md` 43's phone reading is the same capture.
- **X3.6e — the palette's main pass LANDED** (806511f, review fixes ed51e1d;
  2026-10-24, added that day by the user's decision, "Decisions that are
  yours"). The palette is ours in both passes or in neither, drawn FIRST at
  `"beforeAlphaTest"`, so every tie goes as Babylon's opaque queue sent it.
  The bank 59 of 61 byte-identical, the two that move being Babylon's reach
  hysteresis keeping a palette mesh past the reach, not a tie; the census
  falls on every map. **Owed:** the phone's follow-up (`FINDINGS.md` 43's
  capture). Deleting the fallbacks became X3.7.

**After X3.6:** every pass that draws a block, the scatter, the landform or the
emissive palette is our renderer's whenever the handover holds what that pass
draws: the main pass (the palette's included, since X3.6e), the world's four
maps, the lamps' atlas, the probes' bake and the glow's mask. Babylon no
longer draws the palette's main pass while the handover holds it. It still
BUILDS every one of those meshes, as the fallback each pass hands back to (an
editor build, `?babylonworld`, a surface ours cannot hold, a loss mid-map).
Phase 3's end condition is met only once the fallbacks are deleted: X3.7,
below. Editor builds keep the old path until X5.3. **Since X3.7b** Babylon
builds no mesh in a round for anything our renderer draws — a round's
`GameMap.visuals` are the glazing and the fires — `?babylonworld` is gone
(its last build tagged `exit-babylonworld`), and every former handback is
`Game.worldFailed`: Phase 3's end condition is met. **Since X3.7c** the
fallback machinery is gone for a round: Babylon's `ReflectionProbe` path (the
default cube one of ours), the emissive palette's Babylon stages and its glow
mask twin, and every pass's `lose`/`onLost`/`broken` latch (a pass is handed
its world WITH the install's failure). The editor keeps `ShadowSystem`'s
generators and `LocalShadows`' render target (X5.3).

The full record of all five, with every readback, forced path and review, is
in [the archive](plans/done/babylon_exit_landed.md).

### X3.7 — Babylon builds no world mesh for a round — **L, as three sub-steps** (decided 2026-10-24)

**Decided** (2026-10-24): **the world draws whole or the round does not
start.** One `Game.worldFailed(reason)`: a `console.error`, back to the menu
(`leaveMatch` online) and a toast; a surface the handover cannot hold throws
in DEV and `merge:hash` refuses it, so it cannot ship. **Kept:** the cel and
emissive MATERIAL objects, never compiled in a round, which the merge keys on
and which hold the recipes (Phase 4's); the scatter merged into the block
ARRAYS (un-merging it is a picture change of its own); `metadata.block` on
glazing and fires. **Not its:** the editor's path (X5.3), glazing (X4.6),
fires (X4.4), the Material objects (Phase 4), device-loss recovery (X5.4).
- **X3.7a — the take off the RECORD LANDED** (c52ebb4, review fixes d795e76;
  2026-10-25; no picture change). The handover's verdict and the cull cells'
  bounds read the RECORD (`SurfaceRecord.bounds`), `merge:hash` hashes the
  record's arrays (a new baseline), and `shaders.mjs` builds both palette
  programs (X3.6c's item, closed). Every map's buffers are far under
  WebGPU's default limits (the largest, Cinderhaven's, 56 MiB against the
  128 MiB binding). The bank 61 of 61 byte-identical.
- **X3.7b — the cut LANDED** (b5c0a1e, review fixes 9f7f0b1; 2026-10-25; no
  picture change). Babylon is made no mesh of anything ours draws (a round's
  `GameMap.visuals` are the glazing and the fires); every handback is
  `Game.worldFailed`; `?babylonworld` is deleted, its last build tagged
  `exit-babylonworld`; `WorldCulling` files its cells off the records;
  `noGlow` is read per surface. **What it is worth** (a second install): the
  JS heap after a GC Greyfen 1,154 to 149 MiB, GPU buffers 652 to 142 MiB,
  `installRound` 7.98 to 5.6 s, every map lower. The bank 61 of 61
  byte-identical.
- **X3.7c — Babylon's world passes narrowed LANDED** (f9b2512, review fixes
  c4d3021; 2026-10-25; no picture change). Deleted for a round: the
  `ReflectionProbe` path (the default cube one of ours), the palette's
  Babylon stages and its mask twin, every pass's `lose`/`onLost`/`broken`
  latch. The editor keeps `ShadowSystem`'s generators and `LocalShadows`'
  render target. A deleted path, not a cost a round paid. **Phase 3's end
  condition reads true.** **The phone's FOLLOW-UP reading** (2026-10-30 and
  2026-10-31, Chrome 156, the protocol's settings in the second session):
  the forest maps read heavier and Sarab level against both earlier
  readings, open as `FINDINGS.md` 66; Sarab's fight p95 24.8 ms, on X0.4's
  target of 25 and still the CPU, which is X4.1's phone BEFORE.

**Owed onward:**
- the `exit-phase-3` tag and pushing `exit-babylonworld`, both the user's
  call;
- the forest maps' rise on the phone, `FINDINGS.md` 66;
- X5.3 deletes what the editor keeps;
- X4.4 uses or deletes the HELD-caster layer (`WorldBlocks.addCaster`,
  `BlockHandover`'s `held`), which no build reaches: every fire is made
  `noShadowCaster` (deleted at X4.4d);
- a stale comment naming `ReflectionSystem.encloses` stays in
  `src/world/harrowmead/layout.ts`, because the collision bake's staleness
  guard hashes that file's text and editing it would re-bake.

The full record is in [the archive](plans/done/babylon_exit_landed.md).

---

## Phase 4 — Everything else that draws

Each step takes one kind of draw off Babylon's scene, along with its view
module from X2.2. When the last one lands, Babylon draws nothing but the post
chain, and the frozen cel-material cache and its traps are deleted with
`CelMaterialFactory`'s Babylon half.

X4.1 and X4.2 are archived word for word in
[`plans/done/babylon_exit_landed.md`](plans/done/babylon_exit_landed.md),
with every oracle, readback, forced path and review. What stays here under
each heading is what it landed and what a later step still uses or owes.

### X4.1 — Bodies (PERF_PLAN C6, A4) — **L, as five sub-steps** (split 2026-10-29) — X4.1a **LANDED** (a417bfc, review fixes after it), X4.1b **LANDED** (f554b68, review fixes after it), X4.1c **LANDED** (3a07a68, review fixes after it), X4.1d **LANDED** (23c6cd9, review fixes after it), X4.1e **LANDED** (53dcb34) — **all five LANDED**

Every body a page draws (`NetSoldier`'s rig, a corpse, the death cam's
stand-in) is off Babylon's scene, with the moon's body map, and A4's fade is
built on the result. **It reversed one line of PERF_PLAN C6**: a corpse is
posed off X2.4's arrays (`WorldBody.pose`) onto our joints, so every body is
one kind of thing to draw.
- **X4.1a — the joints are ours LANDED** (a417bfc, review fixes 2e65dfa;
  2026-10-29; no picture change). A rig's joints are a `JointTree`
  (`entities/rigJoints.ts`, Babylon-free, a root of the gate), composed
  FRESH; the oracle matched the nodes bit for bit; the bank 61 of 61
  byte-identical. `kit:hash --models`' two `soldier` rows were re-baselined
  by construction here and again at X4.1b and X4.1d, so a `--against` older
  than a417bfc reports them changed: take a fresh baseline.
- **X4.1b — corpses and the stand-in on our joints LANDED** (f554b68, review
  fixes b15a5be; 2026-10-29). A corpse's joints are POSED off its bodies'
  pose arrays (`Joint.pose`); the reparenting onto proxies is gone. One
  cosmetic change by construction: a corpse's tumble starts 1-4 float32 ulps
  off, which Havok carries into where it rests. The bank 61 of 61
  byte-identical.
- **X4.1c — the moon's body map is ours LANDED** (3a07a68, review fixes
  85df99b; 2026-10-30). `render/BodyShadowMap.ts` draws soldiers and hulls, a
  hull's box off its own fields (`hullBodyToRef`), so X4.2 owed the shadows
  nothing. **Decided here:** a pipeline it cannot build fails the ROUND
  (`worldFailed`). Two picture changes by construction, on no bank row: the
  frame after a rung change, and a moving hull's box no longer drawn a frame
  behind it (the lamps' atlas very probably too). The bank 61 of 61
  byte-identical; `FrameProfile`'s `shadowPass` brackets no frame of a round
  now.
- **X4.1d — every body drawn by us LANDED** (23c6cd9, review fixes dd902aa;
  2026-10-30; no picture change). Every body is ours (`render/BodyDraw.ts`,
  `bodyProgram.ts`), an instance of its side's kit, a draw a RANK; Babylon is
  made no rig mesh. The bank 61 of 61 byte-identical. X0.3 at 24 a side:
  Sarab's fight 0.654 (10.44 to 6.83 ms), Cinderhaven's 0.742, `gpu.frame`
  held.
- **X4.1e — A4's fade LANDED** (53dcb34, review fixes ac35422 and f7534f2;
  2026-10-30; the picture change, at the two edges only). A body FADES at
  `bodyDrawDistance` and at the size gate (`WorldCulling.bodyFade`), by a 4x4
  screen door in faded twins of the body programs, the fade read in the
  FRAGMENT stage (`BODY_FADE`, group 3). **Decided** (the user, 2026-10-30):
  the door is stable (keyed on the pixel alone), the visor and its bloom
  drop together, the ink is left alone and the shadows are not faded. No bank
  row moved; X0.3 level.

**The phone's AFTER** (2026-10-31, f7534f2, report version 21, against
X3.7c's FOLLOW-UP as the BEFORE): **Sarab's fight is no longer bound by the
CPU** (tick 18.36 to 10.99 ms, `render` halved, median frame 20.8 to 16.6
ms), **but its p95 ROSE, 24.8 to 28.1** — the GPU's tail now that frames make
the vsync or miss it — **so X0.4's "p95 at or under 25 ms" no longer
measures what it was set for, and how X6.2 reads that target is the user's
call.** The forest maps' fights were already the GPU (Greyfen's p95 64.1,
under X0.4's floor of 69).

**Owed onward:**
- **The phone walk-through of the fade**, owed by the user's decision
  (2026-10-30): whether a 3-6 px body twinkling out reads as a fade at the
  size edge (190-290 m on Coldharbour); the size band's width (1.5x the gate,
  so a change of field of view can sweep a body across the ramp in one
  frame); whether 300 m on Sarab and 420 m on Cinderhaven are the right
  distances (`FINDINGS.md` 32, 39).
- **The corpse's measure at its TORSO**, not done: it owes the roster's
  switch the same point first, or a thrown corpse pops back at the distance
  fade.
- **The body programs' vertex stage is at 8 of 8 storage arrays** (WebGPU's
  default, which the device does not raise), so anything new per instance
  rides the fragment stage or an array already bound.
- **The rank's vertex surplus** (~2.8x the corners in vertex invocations):
  not visible on the phone so far; indirect draws, which could size each
  instance, are ruled out by the Intel rule.
- **X4.1a's compose cost** (several composes a body a frame, an estimate of
  ~800 extra at 24 a side): unmeasured, and **the fresh-compose invariant
  (`rigJoints.ts`' header) must not be undone to buy it back without a
  measurement**.
- **The editor draws no soldier**: X5.3 owes it the body draw if it is to
  show one. `VERIFYING.md`'s soldier-in-a-picture recipe borrows a roster
  body, since a rig a script builds is never drawn.
- The body map's pass is not timed on our side (read as `gpu.frame`). **An
  open question for the owner:** degrade the body map to its `off` state on a
  pipeline failure, rather than failing every round (X4.1c followed
  `LampAtlas`'s precedent).
- `FINDINGS.md` 57 (the impulse lands before the teleport) is untouched;
  fixing it re-takes `clients.mjs`'s bank, proving first with
  `--spawns-out=` that the spawn did not move.

The full record is in [the archive](plans/done/babylon_exit_landed.md).

### X4.2 — Vehicles (PERF_PLAN A3) — **M–L, as four sub-steps** (split 2026-10-31) — X4.2a **LANDED** (fde5be7), X4.2b **LANDED** (d4f41ef), X4.2c **LANDED** (f302403), X4.2d **LANDED** (a156355) — **all four LANDED**

Every hull a page draws (the tank, the truck and the helicopter, live or
wrecked) is off Babylon's scene, and A3's detail tier and draw distance are
built on the result, the distance with X4.1e's fade. The moon's map and the
lamps' atlas were already done (X4.1c).
- **X4.2a — the hull's joints are ours LANDED** (fde5be7, review fixes
  1a674cd; 2026-10-31). A hull's joints are a `JointTree`
  (`VehicleRig.tree`); `hullPointToRef` stays the simulation's. The oracle
  matched the nodes bit for bit with all three kinds driven, firing, flying
  and wrecked (no helicopter was wrecked). **One picture change, found by
  the review:** the parent's size gate kept a dropped hull part dropped at
  the bounds it was last drawn at (a tank arriving without its MG ring),
  fixed by the step.
- **X4.2b — every hull drawn by us LANDED** (d4f41ef, review fixes 4fe8e56;
  2026-10-31; no picture change). Every hull is ours (`render/HullDraw.ts`,
  `hullProgram.ts`), an instance of its kind's and side's kit, a draw a
  RANK; Babylon is made no hull mesh. **Decided** (2026-10-31): the size
  gate stays PER SEGMENT, for good. The bank 61 of 61 byte-identical; X0.3:
  Sarab's fight 0.696 (6.67 to 4.64 ms). `kit:hash --models`' twelve
  `vehicle:` rows moved by construction.
- **X4.2c — A3's detail tier LANDED** (f302403, review fixes b7997a2, with a
  bank row that sees the tier; 2026-10-31; the picture change, for a hull
  past the swap only). Each model's DETAIL list (the tank's links and road
  wheels, both MG rings) drops when a WHOLE-HULL measure (`measureHull`,
  composed this frame) projects under **32 px**; the measure is used for the
  swap and nothing else. The bank 61 of 61 byte-identical; A3's +6.5% does
  not reappear on the desktop, X4.2b having folded the fleet into rank draws.
- **X4.2d — the hull's draw distance and its fade LANDED** (a156355, review
  fixes 05a791c; 2026-10-31; the picture change where a map states a
  distance, and no shipped map does). `EnvironmentSpec.hullDrawDistance`,
  the ninth of the map's overrides: ABSENT is no distance (`Infinity`), a
  stated one is capped at `fogEnd` and floored at `hullDrawFloor()` (~419 m,
  the guns' reach), and a longer barrel is caught by `checkMuzzleReach`; the
  fade is X4.1e's door over the last tenth, in a faded hull twin. **Decided**
  (the owner, 2026-10-31): the rotor wash fades with its hull; tracers and a
  shell's blast past the distance are accepted. The bank 62 of 62
  byte-identical; at 420 m on Cinderhaven A3's +15.4% does not reappear.

**Owed onward:**
- **Whether any map states a `hullDrawDistance`**: the look call A3 left,
  now with no measurable desktop saving behind it; a phone, where hulls are a
  larger share of a GPU-bound frame, could change that.
- **The phone's reading**: whether the tier's vertex saving shows in
  `gpu.frame` on Cinderhaven at 832x384-class viewports (the swap at
  ~141 m), and the look of the tier and of the door on a hull on a phone,
  the ink's "x" marks on the door among it.
- **The bench carries no hull counts** (`benchhulls.mjs` is a scratch
  tally): the next bench of the tier owes a per-group count of reduced
  hulls, a report change.
- **The rank surplus** (3.0-3.35x the corners) is unmeasured on the phone.
- **The boot cost**: building the hull kits and `HullDraw` is ~37 ms of every
  boot (~160 ms under a 4x CPU throttle), and ~6 MB of GPU buffers and
  ~7.5 MB of JS heap stay resident on every map, armour or not; the lever is
  building them at the first install of a map with armour. Unmeasured on the
  phone.
- **The editor draws no hull**: X5.3's, as its bodies are.

The full record is in [the archive](plans/done/babylon_exit_landed.md).

### X4.3 — The viewmodel and the kit bay — **M–L, as four sub-steps** (split 2026-10-31, decided the same day) — X4.3a **LANDED** (3e48d98, review fixes after it), X4.3b **LANDED** (fa58735, review fixes after it), X4.3c **LANDED** (58ab5ed), X4.3d **LANDED** (4070427) — **all four LANDED**

The player's own weapon — whichever of the nine carried rigs is up, its
optic and the optic's glass, both gloved arms, the throwing fist with its
grenade or bottle, both magazines and the muzzle flash — and the kit screen's
card behind it are off Babylon's scene, and no sub-step changed the picture.
- **X4.3a — the bank sees the viewmodel LANDED** (3e48d98, review fixes
  after it; 2026-10-31). Twenty-two rows appended to Harrowmead's list (the
  two missing optics, the pistol, the launcher and the mine, the gloss rungs,
  the gestures held mid-phase, the kit screen at two bays, the review's
  three), so every later sub-step had a BEFORE.
- **X4.3b — the viewmodel's joints are ours LANDED** (fa58735, review fixes
  after it; 2026-10-31). The viewmodel is a tree of joints (`ViewTree`),
  `Joint` gaining a pivot, an overriding quaternion, an outside root and a
  fixed local; the readers answer out of `RenderCache`, Babylon's render-id
  cache reproduced, so the grenade's release and the rocket's start stay
  Babylon's to the bit (**decided**).
- **X4.3c — the weapon drawn by us: every opaque part LANDED** (58ab5ed,
  review fixes bd1aed3 and the owner's decisions 595e35d; 2026-10-31). One
  draw a segment (**decided**: no fold) in Babylon's group-1 order, a tie to
  the segment made first; the mask LAST in its pass (**decided**);
  `Renderer.begin` idle with nothing of ours committed (**decided**); the
  empty-group seam guarded (**decided**).
- **X4.3d — the lens glass and the kit card, and group 1 goes LANDED**
  (4070427; 2026-11-01). The glasses and the card are segments (`role`),
  drawn at the same point — the card first with `ALPHA_REPLACE_COLOR`'s
  factors, depth `always` and written, its canvas uploaded once per paint;
  the glasses last with `ALPHA_COMBINE`'s, no depth, back to front — and
  Babylon is made no viewmodel mesh. Group 1 is empty: the group, its depth
  rule, `Player.warmView` and the profiler's `drawOverlay` (report version
  24) are gone, and the glow's stage rule is stated by the weapon's draw.
  The bank 83 of 84 byte-identical (the 84th the main tree's known pixel),
  the mask 37 of 37, the replay's frames, draw order and 2,589 reader
  answers identical, a first ADS through either glass creating nothing. **The post-commit review** (an independent reader over 4070427 and
  da0a996) found no bug, and confirmed the glass's back-face culling (the
  brief's "both faces" was wrong: the arrays are `DOUBLESIDE`). Fixed after
  it, in one commit: the stale "four spans" (three since `drawOverlay`
  retired) and group-1 words in `CLAUDE.md`, `docs/profiling.md`,
  `FrameProfile.ts`, `config/graphics.ts`, `PlayerView.ts` and the viewer; a
  DEV warning in `WorldCulling.offer` for a Babylon mesh outside rendering
  group 0 (one would bring back a per-group depth clear and split the one
  depth image, and the size gate no longer exempts it); the card's size
  stated once (the texture made at the first paint off the canvas's own
  size, its copy's descriptors kept); why the glass culls, written where it
  is drawn; `ViewMesh.on` and `seen` (written, never read) dropped and
  `ViewTree.syncSwitches` made private. **Decided** (the owner, 2026-11-01):
  the twelve glass `StandardMaterial`s, unbound since the step, become plain
  data on the segment (`ViewSegment.glass`: the emissive colour and the
  alpha), so no Babylon material is made for a glass. The bank, the readers
  and every gate unmoved (the archive has the numbers).

**Owed onward:**
- **The render cache's frame id** (X5.4, decided): `RenderCache` is keyed
  on `scene.getRenderId()` and settled from a Babylon observable, both of
  which go with the frame. `FINDINGS.md` 55 stays after the exit.
- **The empty-group seam**: over the menu, with the kit screen up and no map,
  the sky is the only thing of Babylon's left in group 0 (X4.3d measured it
  never empty). Fixed at X4.5a.
- **The kit's cost on a phone**: it is built and uploaded on every boot
  (~14 MB of GPU buffers, the menu included); building it lazily, at its
  first use, is a lever to measure first (boot time and resident memory).
- **The kit's memory** the X4.3c review left: a colour, a uv and a slot
  uploaded for every vertex, and each spent magazine's arrays uploaded twice.
- **The tree's compose costs are unmeasured** (X4.3b): a frame composes the
  carried rig's ~20 joints and its ~15 surfaces through the render cache,
  against Babylon's own walk of the same nodes before.
- **The brass** and the thrown and laid pools are X4.4's.

The full record is in [the archive](plans/done/babylon_exit_landed.md).

### X4.4 — The effect pools, and pipelines compiled at load — **M–L, as five sub-steps** (split 2026-11-01, decided the same day) — X4.4a **LANDED** (63a338a, review fixes after it), X4.4b **LANDED** (9470686), X4.4c **LANDED** (d82f311), X4.4d **LANDED** (9d81875), X4.4e **LANDED** (e3d5276) — **all five LANDED** (63a338a..e3d5276)

Every pooled effect Babylon still draws comes off its scene but the three
that blend among the panes (decided 2026-11-01: they wait for X4.6), and the
warm-up's `warm(on)` poses become a declared list of pipelines. Nothing here
is a PERF_PLAN item and **no sub-step is meant to change the picture**: each
is proven byte-identical against the bank and lands on its own, leaving the
game shippable. If one cannot be (a blended effect that now sorts
differently against the glazing, a ported material that rounds
differently), that difference goes in a commit of its own with the bank's
numbers (rule 2), never absorbed. It was rated **M** as one step. It is
split because it is about ten picture modules (~4,300 lines in
`src/systems/` alone) drawn four different ways, plus three jobs that are
not pools, and because the bank holds ONE effect row today (`blast`, half a
second in). So the instrument comes first (X4.3a's shape), the pools then
move grouped by how they are drawn, and the warm-up, whose list is whole
only once every pool has moved, goes last.

**What the pools are today** (a survey, not a close read; each sub-step
confirms its own before it moves anything):
- **Plain meshes, one per slot.** `CombatFx` (606 lines): the tracer (a
  cylinder), the impact spark (a sphere) and the dust disc, all
  `getEmissive`, faded by `visibility` (a blended pipeline under 1).
  `BulletMarks` (279): decal quads on a CEL material at their own depth bias
  (`MARK_DEPTH_UNITS`), one mesh a mark, NOT size-exempt, so `WorldCulling`'s
  size gate drops them at range. `GrenadeFx`'s `GrenadeBody` (a cel body and
  an emissive fuse pip, `entities/GrenadeModel.ts`) and `AntiTankFx`'s
  `RocketBody` and `MineBody` (cel, with an emissive motor flame and fuze
  lamp, `entities/RpgModel.ts`, `MineModel.ts`); `net/NetGrenades.ts` and
  `NetOrdnance.ts` draw the SAME three bodies off the wire, so they move with
  them. `PlayerView`'s brass: cel boxes thrown into the world off X4.3b's
  eye-port joint (decided 2026-10-31).
- **The blast** (`BlastFx`, 899 lines): one thin-instanced icosphere per
  blast slot, plus a shared small one for the sparks and the trails, on
  `BlastShader`'s own WGSL — which WRITES depth (an opaque-list draw, X4.4a's
  sort measurement; only its glow-mask twin, `blastGlowMask`, sets
  `disableDepthWrite`) — its bounding box set by hand each frame, and 39
  `Math.random` draws (pictures, never a round stream).
  `BlastDebrisSystem` (806): the rubble chunks (cel, two materials, posed off
  Havok through `poseView`) and `ScorchMarks`, a **`StandardMaterial`** faded
  by `visibility` — the one material in the pools that is Babylon's own
  rather than a shader of ours.
- **Physics-posed shards** (`DebrisSystem`, 793): cel slivers cut from the
  pane, posed off Havok through `poseView` like the rubble.
- **The fires**, all on `FlameMaterial` (which writes depth, like the
  blast's: only its glow-mask twin, `flameGlowMask`, does not): the world's
  (`world/flame.ts` parts merged into blocks, the one world surface besides
  glazing that X3.7 leaves a Babylon mesh in a round, filed by
  `metadata.block` in `WorldCulling`), and the molotov's (`GrenadeFx` clones
  one source mesh per flame, on `getFlame()`).
- **Out of scope**: `Atmosphere`'s ash and `RotorWash` (`GPUParticleSystem`)
  are X4.7's; `GlassFx`'s collapse writes the glazing, which stays Babylon's
  until X4.6 — and so, decided after X4.4a's review, do the three blended
  pools (the sparks, the dust discs and the scorch: "Find out first" below).

**Find out first, before X4.4b moves anything blended**: where Babylon's
transparent sort puts each fading effect against the glazing and the fires
(both blended, and both Babylon's until X4.4d and X4.6). Our draws hang on
group 0's points, so a fading spark drawn at the end of the group lands
after a pane it used to be behind. X4.3c met this exact case (a blended
fading spark: 0/8 frames matched before the order was restored, 8/8 after).
The answer decides whether a blended pool of ours draws inside Babylon's
sort, at a point before it, or takes a recorded picture change.
**Answered by X4.4a** (measured; its note in the archive has the frames):
the blast's billows, both kinds of flame, the tracers, the marks and the
rubble are in Babylon's OPAQUE list, front to back, before `afterOpaque` —
none is blended. The fading sparks and discs (`visibility` under 1) and the
scorch are in its TRANSPARENT list, after `afterOpaque` and before
`afterGroup`, back to front by bounding-sphere centre and INTERLEAVED with
the see-through glazing (a pane block sorted by its centre). So neither
point of ours reproduces it: a blended pool drawn at `afterOpaque` lands
before every pane, at `afterGroup` after every pane, and either is wrong for
some fade — X4.4b draws inside the sort or records the change.
**Decided** (2026-11-01, the owner, on X4.4a's review): **neither — the
three blended pools WAIT for the glazing.** `CombatFx`'s sparks and dust
discs and `BlastDebrisSystem`'s scorch stay Babylon meshes, warm poses and
all, until X4.6 takes the see-through glazing, and X4.6 moves them with it
so ONE sort of ours orders every blended surface together. No picture
change, no new reach into Babylon's queue (rule 4), and no stand-in mesh.
Everything else in X4.4 moves as briefed; `fx-glass-sort` is X4.6's BEFORE.

- **X4.4a — the bank sees every pool LANDED** (63a338a, the post-commit
  review's fixes after it; 2026-11-01; no change to the game). Twenty-one
  rows (twenty-five since the review, below), each effect raised through the door
  the game raises it by on a stated clock (`Vantage.fx`): nineteen at the end
  of Coldharbour's list (see-through glazing, `hard` and `ground` side by
  side, armour) and two at the end of Cinderhaven's (a world fire in the
  open), every one at a position its map's rows already stand at, so the
  benchmark gains no stop: `fx-tracer`, `fx-impact-hard`/`-ground`,
  `fx-marks-near`/`-far` (14 of 30 under the size gate), `fx-grenade`,
  `fx-rocket`, `fx-mine` (laid as the wire lays one), `fx-brass`,
  `fx-blast-{hard,ground}-{fireball,billows,smoke}` (0.08, 0.6, 1.8 s, the
  rubble and scorch with them), `fx-scorch`, `fx-molotov`, `fx-shards`,
  `fx-glass`, `fx-fire`, `fx-fire-fade`. The pictures' randoms seeded for the
  clock and the sound's kept off that stream; the rubble and shards on their
  own seeded streams under Havok's fixed step. **Measured:** `--check --keep`
  twice back to back, the 21 new rows 0 pixels from the bank both times and
  104 of 105 frames byte-equal between the runs (the 105th the known pistol
  pixel); the 84 old rows byte-equal to a BEFORE at bb05074; typecheck,
  build, corecheck pass. **The round's pipeline creations**
  (`pipelines.mjs coldharbour --round`, new): zero of Babylon's and zero of
  ours in play in six of eight runs, 5 and 2 of Babylon's in the other two —
  which the review traced to the script's own bookkeeping (a closed phase
  re-opened, so whatever the second install and spawn made was filed under
  the pane) — what X4.4e takes to zero. **The sort**: answered above. Every
  row looked at. The full record is in
  [the archive](plans/done/babylon_exit_landed.md).
  **The post-commit review's fixes** (the bank, its harness, its table,
  `pipelines.mjs` and docs; nothing in the game moved): four rows appended
  at the end of Coldharbour's list — `fx-blast-hard-power2-billows` (a
  power-2 blast), `fx-wire` (the wire's rocket and grenades, posed off two
  snapshots), `fx-impact-kinds` (the flesh and glass sparks) and
  `fx-glass-sort` (a spark and disc squarely BEHIND pane 0 and squarely IN
  FRONT of it, each wholly inside the glass on screen, 49-73 px clear of its
  edge — the BEFORE for X4.4b's sort; `fx-glass`'s pier impact sits 0.15 m
  in front of the glass and straddles its edge); the put-away re-seeds the
  fire lights' flicker stream and takes the wire's grenades in (`fx-molotov`
  re-banked: its light's phase only), and the order dependency left (Havok,
  the lamp atlas, the ids) is documented. **`--round`** now counts the
  spawn as play, closes a phase for good, reports each install apart (28
  of Babylon's, 23 of ours the first, nothing the second), steps the camera
  by frames and turns it onto the pane before it breaks: **zero of
  Babylon's and zero of ours in play in five of five runs**, the shards
  drawn every time (4,848-7,692 shard draws). The pools with NO warm pose
  — the shards, the rubble, the thrown and laid bodies (both sides of the
  wire) and the brass — compile nothing in play only because their
  pipelines already exist (X4.4e's brief names them). **The floor scorch
  DRAWS**: "draws nothing" was a misreading — faint on a dark or fire-lit
  floor, whole under `fx-molotov`'s flames, and behind the book stall in the
  ground blasts' rows (each mark hidden and shown). **Measured:** `--check
  --keep` twice back to back, all 25 `fx` rows 0 pixels from the bank and
  109 of 109 frames byte-equal between the runs; the 84 old rows byte-equal
  to X4.4a's own kept frames; typecheck, build, corecheck pass.
- **X4.4b — the plain mesh pools are ours LANDED** (9470686; 2026-11-01; no
  picture change). Every tracer, spent case, thrown frag and bottle (the
  simulation's and the wire's), rocket in flight (both), laid mine and bullet
  mark is our renderer's (`render/PoolDraw.ts`, two draws, by the bodies'
  plain programs labelled `pool`), and Babylon is made no mesh of any; the
  sparks and the dust discs stay Babylon's whole, as decided. A piece is its
  meshes as data (`entities/pieces.ts`: a KIT a kind, built once by the view
  that made its first mesh so every material is asked of the factory where
  it always was, shared with the wire's pools; a node a segment composed as
  `computeWorldMatrix` composed the mesh); a mark is a slot of
  `BulletMarks` holding what `freezeWorldMatrix` left. Both draws sit at
  `"beforeAlphaTest"` installed AHEAD of the hulls, the bodies and the world
  (the pools' meshes were in Babylon's opaque queue, X4.4a), the unlit parts
  into the glow's mask after the visors; the pieces drawn by RANK (each
  piece's segments in `bodyPull`'s order, pulled inside the render), the
  marks one draw with the INSTANCES themselves sorted front to back off
  `globalPosition` (`Game.markPull`) — two overlapping marks are coplanar at
  one bias, where the later wins — at `MARK_DEPTH_UNITS` as pipeline state.
  **The size gate keeps Babylon's STALE sphere for a cel part**: the sphere
  as of the last frame Babylon would have computed the mesh (a candidate, or
  a candidate's ancestor), the local one before — so the step reproduces
  Babylon's latch (`docs/rendering.md`), under which a case first thrown far
  from the world origin is never drawn: `FINDINGS.md` 67, the owner's call.
  Four pipelines asked at `Game`'s construction; report version 26
  (`pools`). **Measured:** the bank `--check --keep` against a BEFORE at
  ece59b1, **109 of 109 frames byte-equal** (`comparePngs`), the 25 `fx` rows 0
  pixels from the bank; a probe over **330 scripted frames** (marks at the
  gate's edge under a moving camera, bodies in flight, the wire's, brass,
  and a phase ~150 m from the origin) reading Babylon's own render calls on
  the parent against what ours was handed: **every drawn set equal on all
  330** (ours also hands over what the frustum culls, clipped on the GPU),
  **every mark order equal** (182 frames, 4,782 marks) and **every piece's
  segment order equal** (905 pieces of two segments or more); the same
  probe with THIS frame's sphere gating found 27 segment-frames Babylon did
  not draw (22 of brass, latched; 5 of a bottle a frame early), which is why
  the stale sphere is kept. `pipelines.mjs coldharbour --round` **zero in play
  in five of five runs**, the first install making 26 of Babylon's (28 at
  X4.4a's review) and 23 of ours; `kit:hash --models` **244 of 244
  identical**, each pool's kit hashed in its meshes' bytes, and the kit
  half 3,722 of 3,722; `census
  --against` every row without a piece or a mark equal, Coldharbour 2567 →
  2502 and Cinderhaven 264 → 261 on the `fx` rows alone; `gate`, `shaders`,
  `parity`, typecheck, build, corecheck pass; an offline round on Coldharbour
  with every primary, the pistol, both throwables and both AT items (rockets
  and frags drawn, 0 errors, the empty-group warning never raised); a
  server's round with a second client on the other side throwing and firing
  (the wire's frags and rockets drawn on the first, 0 errors); a profiler
  capture at version 26 with `pools` filled. **The empty-group seam** is not
  made reachable: the sky still holds group 0 in a round and over the menu,
  and the DEV warning never fired in either round. The full record is in
  [the archive](plans/done/babylon_exit_landed.md).
  **The latch, fixed after** (the owner's decision of 2026-11-01, its own
  commit, a picture change): a cel part of a piece is gated on the world
  sphere composed THIS frame, the one it is drawn with — the hulls' rule —
  and the gate sphere and its bookkeeping are gone (`FINDINGS.md` 67
  deleted). **Measured:** the bank `--check --keep` at the parent's code and
  at the fix, **109 of 109 old rows pixel-equal** (`fx-brass`, `fx-mine`,
  `fx-rocket` and `fx-wire` stand near enough the origin that the latch never
  bit; one non-pool frame, `sarab-ground`, 100 px at 2/255, differed in the
  parent's run alone and both codes reproduce the fix's frame twice more —
  cross-process residue), the same 34 stale rows failing; three rows
  appended by `--rows`, each against the parent's code: `fx-brass-far`
  (Coldharbour's `avenue` eye, ~152 m out) **15,450 px**, worst 203/255 —
  three cases in the air where there were none; `fx-mine-far` (Cinderhaven's
  `fx-fire` eye, ~300 m out) **697 px**, worst 59 — the armed mine's plate
  and the whole arming mine; `fx-rocket-far` **8,009 px**, worst 206 — the
  tail between the head and the motor; re-banked, two consecutive checks of
  both maps 42 of 42 byte-equal. The order probe against the parent's
  Babylon recording: no segment lost, **51 segment-frames added** (46 of
  brass — eight cases on the quay ~58 m out; the finding's earlier count was
  22 — and 5 of a bottle's parts a frame early, the same latch a frame deep),
  mark order 182 of 182 and piece order 905 of 905 equal. `pipelines.mjs
  coldharbour --round` zero in play; an offline round, six lives, 0 errors,
  brass in every life (657-2,607 piece-frames; 0 on the parent's code) and
  the player's own laid mines (275-278; 0 on the parent's); typecheck,
  build, corecheck pass.
- **X4.4c — the blast and the posed pieces are ours LANDED** (d82f311;
  2026-11-01; no picture change). Every blast billow (`BlastFx`'s batches: a
  slot each and the sparks' and trails') is our renderer's
  (`render/BlastDraw.ts`, `render/blastProgram.ts`, the WGSL
  `shaders/wgsl/blast.ts` — `BlastShader`'s arithmetic statement for
  statement; `BlastShader.ts` is the paint now, `BlastPaint`), and so is every
  glass shard and rubble chunk, drawn straight off its body's pose
  (`poseView.PosedPiece`/`writePosedDrawing`, a third `PoolDraw`, the DEBRIS,
  built dynamic so a cut rewrites a shard's kit); Babylon is made no blast
  mesh, no blast material and no shard or chunk mesh, and `poseView`'s writes
  onto meshes are gone. **The scorch stays Babylon's**, as decided — a pool of
  its own, so the rubble leaving splits none. **Found first** (a probe over
  420 scripted frames reading Babylon's own render calls on the parent): the
  billows (slots and small) and the shards are in group 0's OPAQUE list, front
  to back, never blended, and the billows again in the glow's mask in the
  active list's order (one material); a billow is emissive, so never
  size-gated; the frustum test is the mesh's
  `CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY` on the sphere `BillowBatch` sets by
  hand; **no rubble chunk is EVER drawn in a live round** and a far shard
  latches (`FINDINGS.md` 58: the size gate read stale world bounds — a chunk's
  at its park a kilometre under the map, a shard's at the origin after every
  cut). All of it reproduced byte for byte: each batch one draw at
  `"beforeAlphaTest"` AHEAD of the pieces, sorted as the queue sorted them
  (`Game.blastPull`, with Babylon's sphere frustum test), its mask after the
  pieces' in the batches' own order with `GlowRules.colour` at its centre; the
  debris one draw after the marks, its instances front to back
  (`Game.debrisPull`), each gated on a GATE sphere that keeps the latch (the
  owner's to fix, a decisions row below). **The bank's `fx-blast-*` rows DO
  show rubble, and always did: the harness's readiness check
  (`scene.isReady()`) computed every mesh's world**, so `waitUntilDrawn` now
  makes the same refresh of each piece's gate sphere (`plans/webgpu-ref/
  README.md`). Three pipelines asked at `Game`'s construction; report version
  27 (`pools.billows`, `pools.debris`). **Measured:** the bank `--check
  --keep` against a BEFORE at 558dbdf, **112 of 112 frames byte-equal** (every
  `fx-blast` row at every age, the power-2 row, `fx-shards`, `fx-glass`,
  `fx-scorch`, `fx-molotov` and the three `*-far` rows among them), the same
  34 stale rows; the order probe **420 of 420 frames equal** in the main
  pass's batch draws (order and counts), the mask's, and the debris order, no
  chunk on either side; `pipelines.mjs coldharbour --round` **zero in play in
  five of five**, the first install 24 of Babylon's (26 at X4.4b: the billow
  and its mask gone), 23 of ours, 49 modules; `kit:hash` 3,722 of 3,722 and
  `--models` 244 of 244 identical; `census --against` the BEFORE: every row
  with no billow, shard or chunk in frame equal on all seven maps, Coldharbour
  2639 → 2561 on those rows alone (`fx-blast-*` -8 to -12, `fx-shards` -12,
  `blast` and the power-2 row -2, `fx-molotov` -1);
  `plans/physics-ref/clients.mjs --check` passes at the parent and at the step
  on all three of its maps — the engine's hash, the NODE digest (318 nodes ×
  601 frames, each shard and chunk now digested in the bytes its mesh gave)
  and every pooled body, identical; `gate`, `shaders` (seven maps clean),
  `parity`, typecheck, build and corecheck pass; an offline round on
  Coldharbour (`x44c/round.mjs`: X4.4b's script with the AT item's presses
  spread over its draw and load — the launcher never fired under the old two
  4-frame presses — and two panes broken a life): six lives, every primary,
  frags and molotovs, the launcher and the mine; the authority's `explode` 10
  and `blaze` 6; billows drawn on 131-293 frames a life (up to 409 a frame, 4
  draws and 4 mask draws), rockets in flight in every launcher life (8-14
  piece-frames), 1,680-1,704 shard instance-frames a life and no chunk; 0
  errors, the seam warning never raised; a server's round (`x44c/net2.mjs`,
  `PORT=8097`): B threw two frags and fired two rockets; on A the authority's
  `explode` 4, billows drawn on 758 frames (up to 192, 3 draws, 3 mask draws),
  the wire's frags and rockets drawn (203 and 418 piece-frames); 0 errors on
  either page; a profiler capture at report version 27 with a blast and a
  burst live: `pools: { drawn: 6, masked: 3, instances: 7, marks: 9, billows:
  42, debris: 12 }`. **The empty-group seam** is not made reachable: the sky
  still holds group 0, and neither round raised the DEV warning. The full
  record is in [the archive](plans/done/babylon_exit_landed.md).
  **The latch, fixed after** (the owner's decision of 2026-11-01, its own
  commit, a picture change): every shard and chunk is gated on the world
  sphere composed THIS frame, the one it is drawn with — the hulls' and the
  pieces' rule — and the gate sphere, `PosedPiece.build` and the harness's
  refresh of the spheres before `scene.isReady()` are gone (`FINDINGS.md` 58
  deleted). **Measured:** the bank `--check --keep` on Coldharbour and
  Cinderhaven at the fix, without the refresh, **42 of 42 frames byte-equal**
  to the parent's with it — the game now draws the rubble the rows always
  showed; the parent's code without the refresh shows what the latch hid,
  six rows and no other: `fx-blast-hard-fireball` 2,400 px (worst 184/255),
  `-hard-billows` 15,824 (188), `-hard-smoke` 1,197 (185),
  `-ground-fireball` 9,806 (218), `-ground-billows` 7,924 (172),
  `-ground-smoke` 1,828 (143). The full check at the fix: 110 of 112 old
  frames byte-equal to X4.4c's own `--keep`, the other two `sarab-ground`
  (100 px, 2/255) and `sarab-shelf` (1 px, 1/255) — the parent's code
  reproduces the fix's Sarab frames 11 of 11, so they are residue in that
  keep — and the same 34 stale rows failing. One row appended by `--rows`,
  graded against the parent's code without the refresh:
  **`fx-shards-far`** (Cinderhaven's `town` eye, a pane ~42 m off and ~313 m
  from the origin) **250 px**, worst 27/255 — the smaller half of the
  burst, six of twelve shards; re-banked, two consecutive checks of both
  maps 43 of 43 byte-equal and every `fx` row within floor. A live probe
  (`x44c-fix/probe.mjs`: the render loop running, the pools stepped at 1/60,
  what our renderer was handed after its pull), parent against fix:
  Coldharbour's quay, three blasts on stone and two on earth, **0 → 2,746
  stone and 1,700 earth chunk instance-frames** (1,583 and 1,606 in the
  frustum); the avenue ~140 m out, **0 → 2,335 stone and 2,930 earth**;
  Cinderhaven round the `town` eye, **0 → 1,176 stone and 3,180 earth**;
  three shopfront panes from that eye, **708 → 1,416, 1,428 → 2,856 and
  1,704 → 3,408 shard instance-frames** — every burst exactly half dropped
  before. An offline Coldharbour round (`x44c/round.mjs`): six lives, 0
  errors, rubble in every frag life (**12,460-12,900 chunk instance-frames;
  0 on the parent's code**), shards 1,680 a life. `plans/physics-ref/
  clients.mjs --check` identical on all three maps; `pipelines.mjs
  coldharbour --round` zero in play in two consecutive runs (24 of
  Babylon's at the install, 23 of ours, 49 modules; a first run straight
  after a build counted three of the install's 24 late, under the spawn);
  typecheck, build, corecheck pass.
- **X4.4d — the fires are ours, and the held-caster layer goes LANDED**
  (9d81875; 2026-11-01; no picture change). Every world fire — a block's merge
  of `world/flame.ts` surfaces, the fire drums, hearths and candles among
  them — and every flame of a burning molotov is our renderer's
  (`render/FlameDraw.ts`, `render/flameProgram.ts`, the WGSL
  `shaders/wgsl/flame.ts` — `FlameShader.ts`'s two stages as plain bodies,
  statement for statement, which the `ShaderMaterial` now assembles too, for
  an EDITOR build's fires, the one place Babylon still draws one), a draw
  each: one instance of its surface under its matrix, off the material's
  own values (`FlameMaterial.values`), the eye, wind, fog and opaque alpha
  being the frame's. Babylon is made no fire mesh in a round (the handover
  TAKES a fire, `takeFire`: block-merged at identity, never `updatable`,
  casting nothing, or REFUSED) and no molotov flame mesh at all
  (`GrenadeFx.flames`, a `PieceNode` each); the only world surface Babylon
  is made a mesh of is the glazing. **No bake draws a fire, and none does
  here** (`FINDINGS.md` 51). **The HELD-caster layer is deleted**
  (`WorldBlocks.addCaster`, its group, layer and cut rank; `BlockHandover`'s
  `held`, `heldMeshes` and DEV node check): no build reached it.
  **Found first** (`x44d/fireorder.mjs`, on the parent: Babylon's own render
  calls in group 0 of the main pass and in the glow's mask, with our
  draws' queue points marked as the bundle list holds them, over a scripted
  640 frames a map): every fire, world and molotov alike, is in group 0's
  OPAQUE list, sorted front to back with the sky dome before them and the
  grass, the capture zones, the backed panes and the water interleaved —
  every one of which writes depth — all before our `"beforeAlphaTest"`
  point; in the mask, after every draw of ours, in the active list's order
  (one material) — the molotov's flames first (their meshes were made at
  `Game`'s construction), then the world's in birth order. A fire is
  EMISSIVE, so the size gate never dropped one — **no latch** to keep or
  report — and Babylon's frustum test read bounds composed that frame
  (`computeWorldMatrix` before `isInFrustum`). Reproduced: the draws at
  `"beforeAlphaTest"` FIRST of all ours, ordered as the queue ordered them
  (`Game.flamePull`: scene order, a world fire while its block's cell is
  OFFERED — `WorldCulling.offersBlock`, snapshotted where the candidate list
  is built — the sphere frustum test, nearest centre first, stable), the
  mask after the billows' — which puts the fires, with ours at the mask's
  open, ahead of every mesh Babylon's mask still draws (the sparks, the dust
  discs, the moon) where its queue drew them among those: no depth written,
  LEQUAL against the frame's, so only an exact tie could differ, and the
  blended sparks and discs drew after the opaque fires before and since.
  Two pipelines asked at `Game`'s construction;
  report version 28 (`pools.fires`). `GrenadeFx.warm` still poses its
  molotov flame, drawn through ours, until X4.4e. **Group 0 cannot go
  empty**: the sky dome is in it on every frame of the probes.
  **Measured:** the bank `--check --keep` against a BEFORE at bac02b7,
  **111 of 113 frames byte-equal** — among them the 68 rows with a fire
  drawn (the census moves their fire draws from Babylon's count to ours),
  `fx-fire`, `fx-fire-fade` and `fx-molotov` 0 px from the bank — the
  other two Sarab's `ground` (100 px, 2/255) and `shelf` (1 px, 1/255), and
  Sarab alone re-checked twice at each code is **11 of 11 byte-equal across
  all four runs** (cross-process residue, as at X4.4c); the same 34 stale
  rows. The order probe **640 of 640 frames equal** on each of Coldharbour
  and Cinderhaven in the main pass's fire order and the mask's (10,752 and
  13,593 draws; molotovs overlapping and spreading, the hearths and drums
  close, a camera walked out past the reach and back — Coldharbour's first
  fire's cell switched off on 96 frames — and every one of ours at
  `"beforeAlphaTest"`). `merge:hash` against the parent: **exactly the 35
  world fires' `mesh` moved** (Hollowmere 11, Greyfen 3, Coldharbour 2,
  Harrowmead 2, Sarab 2, Cinderhaven 15; Kurenai and the proving ground
  none) and nothing else, 854 of 854 meshed visuals' records equal; `--editor`
  identical on all eight; every map installs. `pipelines.mjs coldharbour
  --round` **zero in play** in five of five (the first install 22 of
  Babylon's — 24 at X4.4c, the flame and its mask gone — 23 of ours, 45
  modules). `kit:hash` 3,722 of 3,722 and `--models` 244 of 244 identical;
  `census --against` the BEFORE **every one of 113 rows equal** (the fires'
  draws now counted as ours, `census.mjs`); `gate`, `shaders`, `parity`,
  typecheck, build, corecheck pass (`shaders`' first run lost its page to a
  navigation mid-install on Kurenai; re-run, clean on seven). An EDITOR
  build's fires (`buildEditorMap`, Cinderhaven): compiled, drawn and in the
  mask, **4 of 4 photographs byte-equal** to the parent's. An offline round
  on Coldharbour (`x44d/round.mjs`): six lives, 0 errors, the seam warning
  never raised; the molotov lives' flames drawn 1,398-1,737 flame-frames (up
  to 20 fire draws, 18 flames and the two hearths, all 20 in the mask), the
  world's two fires on 582-631 frames a life; the authority's `blaze` 6. A
  server's round (`x44d/net2.mjs`, `PORT=8097`): B threw two molotovs; on A
  the authority's `blaze` 2 drawn through `drawFire` — flames on 598 frames,
  8,100 flame-draws, up to 17 at once — and 0 errors on either page. A
  profiler capture at report version 28 with a molotov burning: `pools: {
  drawn: 17, masked: 14, …, fires: 12 }`. The full record is in
  [the archive](plans/done/babylon_exit_landed.md).
- **X4.4e — pipelines compiled at load, and the seam checked LANDED**
  (e3d5276; 2026-11-01; no picture change). **The pools' poses became a
  DECLARED list**: `Game.roundPipelines`, one place, names every draw of
  ours a round can use whatever its map — the bodies, the bodies' shadow
  map, the hulls, the weapon, the pieces (tracers, brass, the thrown and
  laid bodies of both sides of the wire), the marks, the billows, the debris
  (shards and rubble) and the fires — each of whose pipelines its
  constructor asks once, at `Game`'s construction. The warm-up waits on it
  by name before its first vantage (`PipelineWarmup`'s `DeclaredPipelines`),
  beside the map's own pipelines, which its install asks. **It departs from
  the brief**: the list is each draw's `ready` promise, asked at
  construction, not pipeline keys created during loading, and its wait is
  functionally redundant with the cache's in-flight count (an entry settles
  in the same microtask checkpoint as the compiles it waits on) — its value
  is the one place every draw of ours is stated, and the seal's tripwire
  (review fixes after it: the cap's warning names the entries unsettled,
  and the lamps' proxies, a session draw, joined the list). And our cache is
  SEALED from the card coming down (`finishBakeWait`) to the map's teardown
  (`PipelineCache.seal`): a compile of ours in play is a DEV warning naming
  it (proved by a compute asked in play: named; sealed at deploy and in
  play, unsealed over the menu). `warm(on)` is deleted from `GrenadeFx` (the
  billows and the molotov flame), `BlastFx` and `BulletMarks`, and
  `CombatFx.warm` no longer poses the tracer: **it survives on `CombatFx`
  (the sparks and the dust discs) and `BlastDebrisSystem` (the scorch) for
  those three blended pools alone**, stated as such, until X4.6 (decided
  2026-11-01). The pools that never had a pose — the shards, the rubble, the
  thrown and laid bodies of both sides, the brass — are covered by
  construction, on the list. **What the vantages still draw for** is
  Babylon's own meshes: the sky, the grass and turf, the water, the glazing,
  the flags and capture rings, the blob shadows, the particles and those
  three pools. **The empty-group seam is NOT reachable**: a probe of
  Babylon's active list each frame (`x44e/seam.mjs`) found the sky's dome
  and cloud ring in group 0 on every frame of the menu, the kit screen and
  the settings over it, the loading card's bake and warm-up, the deploy
  screen and the kit over it, play, the pause, the death cam, the editor,
  the menu again with no map and the kit over it, and a `?bench` run, on
  Coldharbour and on Sarab — no frame empty, the menu's two meshes the
  dome and the clouds alone — so **X4.5 owes the fix** (its brief says so).
  One way to empty it exists and no shipped map takes it: an
  `EnvironmentSpec` stating no `sky` builds none, which a DEV build now
  warns of (`Game.applySky`); `Renderer`'s warning stays (both deleted at
  X4.5a).
  **Measured:** the bank `--check --keep` against a BEFORE at b06595a,
  **111 of 113 frames byte-equal**, the other two Sarab's `ground` (100 px,
  2/255) and `shelf` (1 px, 1/255), and Sarab re-checked twice at each code
  **11 of 11 byte-equal across all four runs** (the residue X4.4c and
  X4.4d met); the same 34 stale rows. `pipelines.mjs coldharbour --round`
  **zero of Babylon's, zero of ours, zero modules in play in five of five**
  (three of three at the parent), the first install 22 of Babylon's, 23 of
  ours, 45 modules, as at the parent — the poses of ours compiled nothing
  since X4.4b-d, so removing them moved no count; **`cinderhaven --round`
  zero of ours in play in five of five**, and two of Babylon's in every run
  at both codes — the rotor wash's `GPUParticleSystem`, its compute and
  render pipelines (stacks taken; `FINDINGS.md` 16, X4.7's) — the install
  22 of Babylon's, 21 of ours, 48 modules, the second install one of
  Babylon's and two modules, both codes alike. **The building card**
  (`startRound` to `deploy`, a fresh browser a run, alternating sides, six
  a side, medians): Coldharbour **5,400 → 5,500 ms** (ranges 5,228-5,609
  and 5,228-5,766; a second install 2,858 → 2,813), Cinderhaven **7,973 →
  7,758** (7,713-8,109 and 7,645-7,776; second 5,299 → 5,393) — within
  ±3%, under the protocol's 8%: no slower. The warm-up itself (its DEV
  line): 8 pipelines from 11 vantages in 299-366 → 306-369 ms on
  Coldharbour, 10 in 387-493 → 401-438 on Cinderhaven. `census --against`
  every one of 113 rows equal; `kit:hash` 3,722 of 3,722 and `--models` 244
  of 244 identical; `gate`, `shaders`, `parity`, typecheck, build and
  corecheck pass. An offline round on Coldharbour (`x44e/round.mjs`, X4.4d's
  with the seal's warning watched): six lives, every primary, frags and
  molotovs, the launcher and the mine — tracers, brass, frags, bottles,
  rockets, the laid mines, marks, billows, shards (1,680-1,728 a life) and
  rubble (5,440-5,460 in the frag lives) drawn — the seal on in every life,
  0 errors, neither the seam's nor the seal's warning raised (the molotovs
  of that run lit three fires, few flames in frame, the parent's the same;
  a molotov thrown before the eye draws its ten flames on 272-273 frames at
  both codes). A server's round (`x44e/net2.mjs`, `PORT=8097`): B threw two
  molotovs and fired two rockets; on A the authority's `blaze` 2, flames on
  792 frames (13,941 flame-draws, up to 19), the wire's bottles (288
  piece-frames) and rockets (474); 0 errors and no warning on either page.
  A profiler capture at report version 28 (no field added): `pools: {
  drawn: 17, masked: 14, instances: 8, marks: 9, billows: 11, debris: 12,
  fires: 12 }`. The full record is in
  [the archive](plans/done/babylon_exit_landed.md).

- **Verify (the step as a whole):** `plans/webgpu-ref/pipelines.mjs` reports
  zero pipeline creations during a round; the bank's blast vantage and every
  X4.4a row; a round with every weapon, both throwables and both AT items
  used.
  **Met** at X4.4e: zero of ours in play on Coldharbour and Cinderhaven,
  zero of Babylon's on Coldharbour (Cinderhaven's two are the rotor wash's
  particles, X4.7's); the bank's blast vantage and every `fx` row byte-equal
  through all five sub-steps (every picture change in a commit of its own:
  the two latch fixes, 558dbdf and bac02b7); such a round, offline and in a
  server's match.
- **Rewrites:** `CLAUDE.md`, "loading ends in a PIPELINE WARM-UP" and the
  "EVERY BODY, HULL AND WEAPON IS OUR RENDERER'S" paragraph (the pools join
  it); `docs/game.md`; `docs/grenades.md` and `docs/antitank.md` where they
  say what draws a pool; `docs/rendering.md`'s size gate (the marks leave
  it).

### X4.5 — Sky and clouds — **M, as three sub-steps** (split 2026-11-02, decided the same day) — X4.5a **LANDED** (4118b5b), X4.5b **LANDED** (8d3b6fc), X4.5c **LANDED** (a3773c9, its picture change 7787229) — **all three LANDED**

The dome, stars, moon and cloud ring (`Sky`, `cloudMasses`, `CloudShader`)
come off Babylon's scene, and our draws stop depending on it having anything
in group 0. **No sub-step is meant to change the picture**: each is proven
byte-identical against the bank and lands on its own; a difference goes in a
commit of its own with the bank's numbers (rule 2), never absorbed. It was
rated **M** as one step. It is split because the seam has to be fixed before
any sky mesh can leave, because the clouds and the dome and moon share no
shader and no material, and because the bank's rows are not aimed at the sky
(a read of their descriptions in `src/bench/vantages.ts`: the moon and the
clouds are nobody's subject), so the instrument comes first.

**What the sky WAS** (a read of the code, not a measurement, before any of it
moved; **all of this is past since X4.5c**: no sky piece is a Babylon mesh):
- **The dome** (**MOVED at X4.5c**): a `StandardMaterial` sphere, its emissive texture a painted
  `DynamicTexture`, at `domeRadius` 600 m riding with the eye, writing no
  depth and depth-tested. `setFlash` lifts it through `emissiveColor` for
  lightning. Cinderhaven's world reaches 1,250 m, so **the dome is right only
  because it is drawn BEFORE whatever stands past 600 m**: drawn after it, the
  dome passes the depth test there and paints over it. Today it is in group
  0's opaque list, ahead of our `"beforeAlphaTest"` point, and that list is
  sorted nearest first by bounding-sphere centre (`setRenderingOrder`).
- **The moon** (**MOVED at X4.5c**): a `StandardMaterial` billboard disc on a painted texture
  (emissive and opacity both), blended, writing no depth, stood at
  `moonDepthDistance` 9 km, behind the depth a cloud writes. It is the first
  of Babylon's blended meshes down, and so draws AFTER the group's particles:
  ash and rotor wash in front of it are painted over by it. It is the one sky
  piece in the glow, through `GlowPass`'s Babylon mesh walk, exempt from the
  bloom's fog fade by `mesh.infiniteDistance` (`Game`'s `GlowRules`; the size
  gate asks the same field in `WorldCulling`).
- **The clouds** (**MOVED at X4.5b**: ours, no mesh and no material, at
  `"afterSurfaces"`; this is what they were until then): one merged soup on
  `CloudShader`'s own WGSL, in the alpha-test list for its ORDER only, writing the depth of a point 7 km out
  along each pixel's ray, its index buffer rewritten back to front when the
  eye or the turn has moved enough (`sortClouds`). `Sky.update` pushes the
  uniforms every frame in every state. `CloudShadowRaster` and the
  `cloudShadowMap` the cel materials read are not drawn by any of this.

- **X4.5a — our draws stop needing group 0 LANDED** (4118b5b; 2026-11-02; no
  picture change; no sky mesh moved). **The seam**: `onMainPass` hooks the
  draw phase's two observables as it did, and the end-of-phase one (inserted
  first, so ahead of the glow's mask and `FrameDepth`) now asks whether group 0
  was visited, and if it was not, tells `beforeAlphaTest`, `afterOpaque` and
  `afterGroup` in that order. **No new Babylon internal.** On a frame Babylon
  does visit the group nothing moved. `Renderer`'s `seamWarned` and
  `pointsPending` and `Game.applySky`'s warning are deleted. **The new point**
  is `DrawPoint` `"first"`, told right after `begin`; nothing hangs on it, and
  an empty list asks nothing of the pass. **The bank sees the sky**: eight rows
  appended by `--rows`, each at an eye a row above it stands at, so every map's
  benchmark stops are unchanged (compared table to table): `hollowmere-sky-moon`
  and `-sky-motes`, `coldharbour-sky-disc` and `-sky-ring`,
  `cinderhaven-sky-cloud-moon`, `-sky-ring`, `-sky-far` and `-sky-flash`. Two new
  row fields: `strike` (the map's own schedule read once at a clock) and `motes`
  (below). **Departures from the list**: Hollowmere states no clouds, so the
  cloud crossing a disc and the night ring are Cinderhaven's; the crossing needs
  no turn of the ring, one eye lines them up at the freeze's 0; and the mote
  field is the map's own gathered into 24 m on the eye, because its own density
  puts about a tenth of a mote in front of the disc. **Rotor wash is not framed**
  (the wash is X4.7's to bring a check for), and the ash carries
  the order. **What the sky owes a state with no map: nothing, and it need not
  be drawn under the photograph at all** (decided by the owner: the row in
  "Decisions that are yours" and `docs/states.md`, which also correct what this
  step first said of the windows).

  **Measured.** The bank `--check --keep`, twice back to back: **121 of 121
  frames byte-equal to each other**, none not reproducible. Against a BEFORE at
  de2a07e: **113 of 113 old frames byte-equal** (neither Sarab's residue nor the
  known 1 px flakes came up in this run), and **the 8 new rows byte-equal to the
  same rows shot at the parent's renderer**. The same 34 stale rows grade red
  against the bank as at the parent. `census --against` a BEFORE taken with the
  new rows: **every row of 121 equal**. **The fix fires** (`x45a/seamfix.mjs`): a
  map stating no `sky`, over the menu with the kit screen up, group 0 visited on
  **0 of 30 frames, draws queued on all 30**, and the frame **byte-equal** to the
  one with the sky up, weapon and card drawn; at the parent the same frame lost
  97% of its pixels, 30 of 60 queues, and raised both warnings.
  **The fallback is the same order as the hooks** (`x45a/fallback.mjs`): every
  Babylon mesh off (1,992 on Coldharbour, 4,212 on Cinderhaven), our world and
  the weapon up, group 0 empty against group 0 held by one always-active mesh
  behind the eye: byte-equal on both maps, 0 of 8 frames visited against 8 of 8,
  the same 32 queues. **The first point runs ahead of everything**
  (`x45a/firstpoint.mjs`): a depthless full-frame red there leaves the frame
  byte-equal under the dome while its count climbs and shows wherever the dome
  is hidden; writing depth at the near plane it hides everything Babylon's and
  ours; over the menu with no sky it ran on 30 of 30 frames, group 0 visited on
  none. **The motes row holds its order** (`x45a/motes.mjs`): within 80 px of
  the disc's centre the motes change no pixel with the moon up and 1,369 with it
  hidden. **Pipelines with the sky Babylon's** (`x45a/skypipes.mjs`, created
  while a sky mesh was being drawn): dome 1, clouds 1 (both by the menu's first
  frames), moon 2 (the main pass and the glow's mask, by the warm-up's end), so
  **4 on Coldharbour and Cinderhaven and 3 on Hollowmere**. `pipelines.mjs
  coldharbour --round` zero of each in play, the install 22 of Babylon's, 23 of
  ours, 45 modules; `cinderhaven --round` zero of ours, the rotor wash's two of
  Babylon's, the install 22 and 21, 48 modules (as X4.4e). `gate`, `shaders`,
  `parity`, typecheck, build and corecheck pass. An offline round
  (`x45a/round.mjs`, six lives, every primary, frags and molotovs, launcher and
  mine: the authority's `fire` 210, `explode` 12, `blaze` 6) and a server's
  (`x45a/net2.mjs`: `blaze` 2, `explode` 2, flames on 598 frames), 0 errors on
  every page. The full record is in
  [the archive](plans/done/babylon_exit_landed.md).

  **The boot's clear colour (the owner's decision, at this step's review).**
  `scene.clearColor` is set at the boot from the boot map's `skyColor`
  (`applyClearColor`, `environment.ts`'s one write, which `applyEnvironment` now
  goes through); not on the reel and not at a teardown, so after a round it is
  the last map's. **It moved no pixel** with the dome over the frame
  (`x45a-fix/boot.mjs`, clocks pinned, the seven maps twice a tree, Hollowmere
  and Kurenai five times): the bare canvas and the kit screen over the boot menu
  byte-equal to 547d803 in every run. A photograph held at half opacity, with and
  without the card, and the card over no photograph, byte-equal but for flakes
  that also come up inside one tree (one DOM pixel at 1/255; a lone Kurenai run's
  photograph, up to 7/255). With every sky mesh off the frames differ on all
  seven, which is the control: Coldharbour's centre (50,50,77) at the parent,
  (205,188,157) here. The bank on Coldharbour, Cinderhaven and Hollowmere: 64 of
  64 byte-equal to 547d803, the same 9 stale rows red.

  **Owes X4.5b and X4.5c:** the dome goes on `"first"`, nothing else; each sky
  draw's `Active` asks whether a map stands, and taking the sky off the menu's
  five windows is a picture change the bank cannot see, in a commit of its own
  with a before and after of them (the boot's fade then shows the right map's
  colour, a window after a round the last map's); `sky-motes` is the moon's order, and its
  harness rebuild reads `Atmosphere` until X4.7; the moon's two pipelines are
  a main-pass draw and a mask draw of ours, on `Game.roundPipelines`.
- **X4.5b — the clouds are ours LANDED** (8d3b6fc; 2026-11-03; no picture
  change anywhere, the menu's windows included). `shaders/wgsl/cloud.ts` holds
  the two bodies, statement for statement; `render/cloudProgram.ts` declares
  them and `render/CloudDraw.ts` draws them, one draw; `CloudShader.ts` is plain
  values now (`CloudPaint`); `Sky` keeps the turn, the matched clock, the
  painter's order and the shadow, and writes the paint every frame in every
  state. Babylon is made no `sky-clouds` mesh and no material. `sortClouds`
  writes each run with one `writeBuffer` over a span of its array, no view of it
  (the "index buffer" is a storage array the vertex stage reads, as every program
  of ours pulls). It is on `Game.roundPipelines`. No new Babylon internal; the
  profiler's `pools.drawn` counts the draw (report version 29), `census.mjs` too.
  **Three things a port owes the picture**: the block's own `cloudEye`, what
  `Sky.update` was handed, and not the frame's `camPos` (a frozen frame holds them
  apart); `world` composed as Babylon composes a node's (`Sky.standRing`: a
  quaternion, not `RotationY`); and the depth written through a new
  `FragmentProgram.writesDepth`, which changes no other program's module.
  **Where it draws, read before moving it**: the alpha-test list held the ring and
  the turf's LODs and nothing else, sorted by material id, the ring first on all
  seven maps, on a replay and after a map change (`x45b/order.mjs`), because the sky
  is applied ahead of the grass. So the draw is at a new point, `"afterSurfaces"`,
  right behind the whole of `"beforeAlphaTest"` in the same slot of the host's and
  ahead of the turf; `"opaque"` is behind the turf, and the end of
  `"beforeAlphaTest"`'s own list is install order. **What pinned that order**: moved
  to `"opaque"` the ring moved 0 pixels on the 15 rows tried (Harrowmead, Greyfen,
  Kurenai, `x45b/states.mjs`), so the bank does not hold the turf's side of it: it is
  kept by reading, not proved by a frame. **The group-0 hold**: the dome still visits
  the group on every map with a sky, so X4.5a's fallback newly fires nowhere and the
  seam is untouched. Item 10's fall-through does fire newly, on a frame with no turf
  in view, where the ring used to fill the list: read in `RenderingGroup.render`,
  nothing of Babylon's lies between that call and the fall-through's trigger, and the
  sky rows, which hold no turf, are byte-equal.

  **The clouds' `Active` waits for X4.5c, with the dome's.** No line of this plan
  allows that: the owner's decision is that the sky goes undrawn while no map stands,
  at X4.5b/c, and it is the hand-off prompt for this step that left the clouds' half
  to the implementer. So the split is the implementer's; the owner did not rule on it,
  and it is moot since X4.5c, whose one commit took the whole sky off the menu. Their draw here asks only whether a ring stands, so it draws over the
  menu as Babylon's mesh did and the windows `docs/states.md` names do not move.
  Landed here it would have left a dome with no cloud on it in those windows for one
  step, on two before-and-afters for one outcome, to save work the same step measures
  as small: **on Coldharbour's bare menu the frame now fills (301 of 301 frames, 0 at
  the parent), writes 5,851 bytes a frame against 1,333, `scene.render` 0.46 ms
  against 0.43 (one run a side, under the protocol's 8%), the same 12 passes**; a map
  stating no ring (Hollowmere) fills on none, as before. The ring's GPU work under
  the photograph is what the parent spent too.

  **Measured.** The bank `--check --keep`, twice, against a BEFORE at 89879c6: **121
  of 121 frames byte-equal both times**, the 8 sky rows among them, no flake; the same
  34 stale rows red against the bank on both sides. `census --against`: every map's
  total equal (308 on Hollowmere, 2,735 on Coldharbour), the ring moved from Babylon's
  column to ours. **The moving part** (`x45b/motion.mjs`): on `sky-ring` on Cinderhaven
  and Coldharbour and on `sky-cloud-moon`, 90 steps of a circuit of the eye with the
  turn drifting (1,156 to 2,170 partial uploads, up to 12.2 M indices), back to the
  frozen eye: the frame differs from before the walk (the slack keeps the walked
  order) and **6 of 6 frames are byte-equal to the parent's**, the walked orders'
  hashes equal.
  **A server's ring** (`x45b/netring.mjs`, `PORT=8097`, two clients): 120 frames on
  each, the turn exactly `rate * clock` and the world handed to the draw within 3e-8
  of it; with both clients' clocks pinned, A and B byte-equal at one time and at a
  quarter turn on (312,141 px apart), and each byte-equal to the parent's. **The menu**
  (`x45a-fix/boot.mjs`, the seven maps): the bare canvas, the held fades, no
  photograph and the kit screen, 35 of 35 equal to the parent but one pixel at 1/255
  on Harrowmead's card over no photograph, X4.5a's DOM flake. `sky-clouds` is in
  `scene.meshes` over the menu, in a round, in the editor and after each: **0**, the
  draw made in all of them (`x45b/states.mjs`). `pipelines.mjs --round`: Coldharbour
  zero in play, install 22 of Babylon's and 23 of ours; Cinderhaven zero of ours, the
  rotor wash's two, as X4.5a (Hollowmere has no armour for the script, as then). An
  offline round (`x45a/round.mjs`, six lives, `fire` 100, `explode` 6, `blaze` 3): no
  warning from the sealed cache, 0 errors. `gate`, `shaders`, `parity`, typecheck,
  build and corecheck pass.

  **What its review changed** (no picture change). A failed clouds pipeline refused
  every round, Hollowmere's among them, which draws no cloud: it is told now only while
  a ring stands (`CloudDraw.onFailed`, the rejection too), and the ring stands before
  the install hands the listener over, so a ring coming after the failure still refuses
  its round. A refused pass over the menu logged every frame: `refusalTold` resets in
  `draw`, as `ViewDraw`'s, and at a new listener, who has been told nothing. Forced
  (`x45b-fix/refuse.mjs`): at f035cc6 Hollowmere's round is refused and 60 refused
  frames log 60 lines; here it reaches `playing`, Coldharbour's round after it is
  refused, and the 60 frames log 1 (2 after the pass recovers and is refused again). A
  failure landing under a standing round ends Coldharbour's and leaves Hollowmere's.

  **Owes X4.5c:** the clouds' `Active` beside the dome's and the disc's, asking
  whether a map stands (`CloudDraw`'s `renderer.add`), so the sky leaves the menu whole
  in one commit of its own with one before and after of the five windows, and
  `Renderer`'s header and `docs/rendering.md`'s "nothing of ours committed" lose this
  step's exception; `boot.mjs`'s `bare` control stops being a control of the ring,
  which no longer is a mesh to disable (it differs here on the six maps with one, by
  construction). With the dome and the moon gone, group 0 over the menu is empty and
  X4.5a's fallback is that frame's path.
  - **Contracts it kept:** the clouds write the depth of a point 7 km out
    (along the pixel's ray, never down the axis), and back faces stay culled;
    they draw after every opaque surface and before everything blended; the
    cloud shadow on the ground (`cloudShadow`) is untouched; the ring is in
    no bake and no glow.
- **X4.5c — the dome and the moon are ours, and Babylon draws no sky LANDED**
  (a3773c9; 2026-11-03; no picture change, the menu's windows included). A sky
  program of one vertex stage and three fragments (`shaders/wgsl/sky.ts`,
  `render/skyProgram.ts`, `render/SkyDraw.ts`), read off the effects Babylon had
  built: `EMISSIVE`, `OPACITY` on the moon, no light, fog, image processing,
  specular or reflection. With the exact zeros and ones out, the colour is
  `clamp(emissive + texture)` and the alpha 1 (the dome) or the texture's (the
  moon); no colour-space step was in force. The dome draws at `"first"`, the moon at
  a new point, `"beforeBlended"` (the seam's item 6, past the particles and ahead of
  the blended list, told by the fallback too), and its bloom at a new mask place
  (`addGlowMaskBlended`), behind every other draw of ours at the mask's open. Babylon
  is made no `sky-dome` or `sky-moon` mesh and no material; the two `DynamicTexture`s
  stay, read through the seam's item 7 and 8. **No new Babylon internal.** Geometry
  from `src/geometry/`'s copies of the builders, bit-equal to Babylon's meshes.
  `infiniteDistance` set by nothing now, so the bloom's fade exemption and the size
  gate's test are deleted with their comments (`scripts/kit-hash.mjs` still READS the
  field in its fingerprint, always false, left so a hash stays comparable). Pipelines
  on `Game.roundPipelines`; `pools.sky`, `pools.drawn` and `pools.masked` count them
  (report version 30), `census.mjs` too. `CloudShader.ts` keeps its reason (the
  `CloudLook` and `CloudPaint` values). In no bake and in no other pass: read off
  `ProbeBake`, whose sky is alpha 0, and off the mask's list.

  **What a port owes that a table of options does not say.** Each piece's world
  is composed the way `TransformNode.computeWorldMatrix` composed it, off the camera's
  WORLD matrix (whose translation is the view's inverse, not `position`) through the
  same `Matrix` calls in the same order (`Sky.standSky`), as the main pass begins and
  never in `Sky.update`, which a frozen frame holds still. **The disc is CULLED as
  Babylon culled it** (the sphere alone, the default strategy, against the frame's
  planes): the first run drew it always, the picture byte-equal, and `census` read +1
  on every row the moon was out of (Hollowmere 321 against 308), so it was put back,
  one draw for one. **The mask's place, read before moving it**: the list a mask holds
  of Babylon's over all 114 rows at the parent (`x45c/mask.mjs --all`) is the moon and
  the sparks, and a spark in that list's opaque half wrote the depth a moon at its
  pixel is rejected by, so ahead of them and behind them cannot be told apart.

  **Group 0, the question the step inherits.** Over the boot's menu it now holds
  NOTHING, so X4.5a's fallback is that frame's path: 0 of 30 frames visited, 0 active
  meshes, 180 queues, kit screen over it the same. In a round the glazing, the water,
  the flags and the particles keep it visited: on the 61 rows of three maps
  (`x45c/group.mjs`) none is empty. **Back at the menu after a round it IS visited,
  0 active meshes**, by the `motes` particle system: `teardownMap` stops its emitter,
  Babylon goes on dispatching a stopped GPU system, and the motes in the air live out
  their lives over the menu, at the parent too. Either path tells the same points.
  **The fallback carries the four points with the sky on them** (`x45c/fb.mjs`, every
  Babylon mesh and particle off, the moon in frame, Coldharbour, Hollowmere,
  Cinderhaven): held by one mesh behind the eye 8 of 8 frames visited, empty 0 of 8,
  the same 48 queues, **byte-equal**, and the moon's control differs on all three.
  `FrameProfile`'s `drawWorld` qualifier holds, reworded: "the sky draws in it" goes,
  and a frame of a round with nothing of Babylon's in view joins the menu's. Nothing
  else read the sky's meshes: `GlowRules` and the size gate are above; the editor's
  pick filters on `solid`; `Atmosphere` reads nothing of them; `Sky.update`'s pushes are
  the ring's.

  **Measured.** The bank `--check --keep` against a BEFORE at 1520d41: **120 and 121
  of 121 byte-equal** (two runs before the cull went in) and **120 of 121 on the
  committed tree**, the one being the known `view-pistol-reload` flake, 2 px at 1/255;
  the same 34 stale rows red on both sides; the 8 sky rows byte-equal every time.
  `census --against` a BEFORE: **every row of 121 equal** (308, 205, 2,735, 2,314, 472,
  508, 125), the dome and the moon moved from Babylon's column to ours. **The moving
  part** (`x45c/stand.mjs`, the camera walked by a function of the frame, four maps):
  on 60 of 60 frames the dome's and the moon's worlds, as 32-bit floats, hash equal to
  the parent's nodes; the sphere's and the disc's positions, uvs and indices too. **The
  bloom in the mask** (`x45c/mask.mjs`, read back raw): the mask's whole RGBA hash-equal
  to the parent's on `sky-moon`, `sky-motes`, `sky-disc`, `sky-ring` (Coldharbour's, the
  moon culled), `sky-cloud-moon`, Cinderhaven's `sky-ring` and `sky-flash`, up to
  42,241 lit pixels. **The menu** (`x45c/windows.mjs`, clocks pinned, the seven maps and
  the proving ground): the bare canvas, the fade held half way with and without the
  card, a rejected decode, a building card with the note's `Math.random` pinned, a
  lobby row on no map, the kit screen and the sky stated away, all equal to the parent
  but for the known DOM flake (at most 6 px at 1/255); after a round, equal once the
  motes are held off, those last ones in the air being what moves there in both trees. **Sky meshes and
  materials**: 0 and 0 over the menu, over the kit screen, in a round, in the editor,
  after it and back at the menu. `pipelines.mjs --round`: Coldharbour zero in play,
  install 20 of Babylon's (22 less the moon's two, the dome's having been the menu's)
  and 23 of ours; Cinderhaven zero of ours, the rotor wash's two of Babylon's, install
  20 and 21. An offline round (`x45a/round.mjs`, six lives, `fire` 101, `explode` 6,
  `blaze` 3) with no warning from the sealed cache, and a server's (`x45a/net2.mjs`,
  `PORT=8097`: `blaze` 2, `explode` 1, flames on 757 frames), 0 errors on every page.
  `gate`, `shaders`, `parity`, typecheck, build and corecheck pass.
  - **Contracts it kept:** the moon has no fog fade to be exempt from; it stands
    behind the clouds' depth, so it is rejected and un-bloomed through one; the dome
    writes no depth; the map with no disc draws no disc, its halo still painted;
    `setFlash` lifts the dome (`sky-flash`); `sky-motes`: the moon paints over its ash.

  **The menu: the sky undrawn with no map standing, in a commit of its own**
  (7787229; the owner's decision at X4.5a; the clouds' half, left here by X4.5b's
  implementer, is moot, the whole sky having left in that one commit). `Sky.setStanding`, from `Game.installMap` and
  `teardownMap`, is what all three draws' `Active` ask, so **the boot's menu fills
  nothing of ours again**: 0 of 30 frames filled, 0 queues, `Renderer`'s and
  `docs/rendering.md`'s exception gone; a re-sort of the ring is the one thing left, a
  `writeBuffer` of what moved. **A picture change the bank cannot see**: every map
  stands in every row. **Windows, before (a3773c9, byte-equal to the parent) and after**
  (`x45c/win-port/<map>/` and `x45c/win-after/<map>/`, clocks pinned, held and shot on
  the seven maps): the boot's fade at half (`fade50`, 94.6 to 100% of pixels moved, up
  to 107/255; with the card, `fade50card`, 57.7 to 81.7%, up to 100), the bare canvas
  (99.2 to 100%, up to 213), a rejected decode (`decode`, 67.6 to 84.4%, up to 199), a
  building card over an undecoded photograph (`building`, 75.9 to 95.5%, up to 199), a
  lobby row on no map (`lobby`, as the decode) and the proving ground (`proving`, 80.8%,
  up to 24). What is there now is the map's flat colour through the post
  chain, Coldharbour's centre (205,188,157), corner (114,108,97): no dome, no cloud, no
  stars. After a round it is the last map's (`afterRound`, moved as `decode`, with the
  round's last motes over it). **A sixth window, accepted by the owner 2026-11-03**: on
  the way out of a round `enterMenu` tears the map down and `MenuBackdrop.show` raises
  `#menu-shot` from 0 over its 0.4 s transition, so the frame under the fade is the last
  map's flat colour where the parent showed the dome and clouds through the picture
  (Coldharbour: opaque 305 ms on leaving a round, a fade-out still running under it, 393 ms
  from the pause). **`afterRound` was shot only with the decode held rejected, so this
  fade was not among the frames compared in 7787229.** Not from the round-over card: its
  picture is up already and stays at 1, read frame by frame, on the same map. **One more
  the six do not name, stated and not ruled on**: a step of the photograph (the reel, the
  lobby) cross-fades two layers, which cover 75% at their lowest, 238 ms in and under 100%
  from 55 to 657 ms (Coldharbour's computed opacities), so up to a quarter of the same flat
  colour shows through, under the scrim. `bare`, the sky stated away by hand, is byte-equal before
  and after, so it is no control of the sky any more (`boot.mjs`'s went stale at X4.5b;
  `x45c/windows.mjs` clears the ring as well).

  **The clear's ALPHA was the one thing it could not leave as it was.** It was 0, and
  no window can tell, the depth buffer holding nothing to ink; but the kit screen can.
  The card leaves the coverage under it as it found it, so with the dome gone a clear of
  0 inks the half of the weapon's outline lying on the card, which the dome's 1 had been
  erasing: **0.5% of the frame, up to 56/255, on all seven maps** (`x45c/kitprobe/alpha0.png`).
  The owner's decision took the sky off the kit screen as moving no pixel, so
  `applyClearColor` now writes 1, the dome's own literal; with it the kit screen is
  byte-equal on five maps, at one pinned turn of the ring and no other (corrected below;
  `CelInk`'s comments follow it). Nothing a map stands behind
  reads it, every shipped map stating a dome: `sky-ring` and the rest are byte-equal.
  The whole stroke is arguably the better picture and is what the kit screen gets
  over a wall in a round; the owner did not ask for it (below). **What remains on the kit screen, explained and kept**: Sarab 247 px and
  Kurenai 274 px, up to 40/255, the outline of the sight. A cloud stands behind it under
  the menu's camera, and a cloud's coverage is 0. The parent with the ring cleared by hand
  and the dome left moves exactly those pixels and is **byte-equal to this commit's frame
  on both** (`x45c/kit2.mjs`). X4.5a's "byte-equal under the kit screen" was measured on
  Coldharbour; this is what it did not see, and a ring turning moves it anyway.

  **Corrected at the review, and the 1 is the owner's** (2026-11-03: kept, a constant half
  stroke on the kit screen's weapon, no longer the implementer's alone). "Five maps, with
  Sarab and Kurenai moving" was true only at the one pinned turn. At the parent, ring on
  against ring off (`x45c-review/probe.mjs`), Coldharbour reads 0 px at turn 0 and 35 to 209
  px, up to 73/255, at five of the seven other turns sampled; the drift being 0.15°/s, the
  first of them, 0.8 rad, is about 5 minutes on the menu. Hollowmere, with no ring, is 0 px
  at all 8. **So the old picture's stroke varied with the cloud behind the weapon and the
  new one does not**: at this tree those five turns read 0 px against turn 0. The other two
  (2.4 and 3.2 rad) read 539,279 px, up to 60/255, the weapon darker, and are excluded from
  those figures, not being the stroke. **They are the clouds' SHADOW, and it still reaches
  the kit stage**: the reviewer's reading was unconfirmed, and here the same two turns read
  the same 539,279 px against turn 0, and 0 px with the shadow's term off
  (`cloudShadowArea.w = 1`, `x45c-fix/probe.mjs`). `Sky.update` goes on over the menu and
  `tick` pushes `setCloudShadow` in every state, so the weapon on the kit screen goes dark
  as a cloud's shadow crosses the stage, at the parent and now, with no ring drawn over the
  menu to say why. Stated, not changed.

  **Accepted by the owner 2026-11-03, so no longer open:** Harrowmead's and Kurenai's frame
  has the soft bright band in the fade that `docs/states.md` names, shafts seeded at the boot
  over the clear colour (`x45c/win-after/harrowmead/canvas.png`,
  `x45c/win-after/kurenai/canvas.png`).

  **Its review** (no picture change): `SkyDraw.prepare` built `refresh`'s handles as an
  object literal up to twice a frame under a header saying nothing allocates; each piece
  holds its own now (`Standing.textures`). `CloudDraw` has no such site, its `refresh`es
  being at build. The bank `--check --keep` on Hollowmere and Cinderhaven against a keep at
  355c6e2: 29 of 29 byte-equal, the same 3 stale rows red with the same means on both sides.
  **Measured** at this commit: the bank `--check --keep` against the same BEFORE, **121 of
  121 byte-equal**, the same 34 stale rows red; `census --against` every row equal;
  `pipelines.mjs --round` as the port's; an offline round (`fire` 101, `explode` 6,
  `blaze` 3) and a server's (`blaze` 2, `explode` 1), 0 errors, no warning
  from the seal; `gate`, `shaders`, `parity`, typecheck, build and corecheck pass; 0 sky
  meshes and materials over the menu, the kit screen, a round, the editor and back.
- **Verify (the step as a whole):** the bank on every map, the night map included; zero
  sky meshes in `scene.meshes` over the menu, in a round and in the editor; `pipelines.mjs`
  and the sealed cache quiet in a round.
  **Met** at X4.5c: every row byte-equal to a BEFORE through all three sub-steps but the
  known flake, the sky rows and `hollowmere-lanterns` and `cinderhaven-town` among them, and
  every picture change in a commit of its own (the menu's windows, 7787229); 0 sky
  meshes and 0 sky materials in all of those states and back; zero in play on Coldharbour
  and zero of ours on Cinderhaven (its two are the rotor wash's, X4.7's), no warning from
  the seal. **Owes onward**: X4.6's blended list and X4.7's particles take the seam's
  item 6 from under `"beforeBlended"`, and X4.7 owes `sky-motes` and the wash a check that
  the moon still paints over them, or the owner's word that it should not; `drawWorld`
  reads less as Babylon's group empties (X4.7); the phone's reading of the sky's three
  pipelines (no draw count moves); X5.2 takes `GlowPass`, whose texture variants have no
  caller now.
- **Rewrites:** `CLAUDE.md`'s rendering section (the sky has no Babylon mesh;
  the group-0 rule), under its cap; `docs/rendering.md`'s sky, clouds and
  seam; `docs/game.md` if the menu's answer touches it; `Game`'s "the sky hangs
  behind every state" and `backdrop.css`'s "the live scene the menu has always
  stood over", with the `Active` commit; `Sky.ts`'s header and
  `CloudShader.ts`'s; `FILES.md` for each new file.

### X4.6 — Water, glazing, grass, flags and capture rings — **M–L, as five sub-steps** (split 2026-11-03, decided the same day) — X4.6a **LANDED** (df74bd4, its review 5d43b2e), X4.6b **LANDED** (483165a, its review e1f5712), X4.6c **LANDED** (4a16b5f, its review d80c078), X4.6d **LANDED** (5f26b00), X4.6e **LANDED** (a3d24c6, ccd194a, 0e44130, its note a5a4b28, its review 4251a34..a5ca27d, its note 2052df0) — **all five LANDED**

Everything left on the floor that Babylon still draws, the three blended pools
X4.4 left waiting for the glazing, and the blob shadows (decided 2026-11-03).
**No sub-step is meant to change the
picture**: each is proven byte-identical against the bank and lands on its own;
a difference goes in a commit of its own with the bank's numbers (rule 2), never
absorbed. It is split because the surfaces share no shader and each reaches the
GPU its own way, and because only the last has to replace a sort of Babylon's.
The order runs from the least risk to the most.

**What they are today** (a read of the code; **X4.6a measured every claim about
order and all of them hold**, on all 130 rows of the bank, the table below, and
its review the blobs and a scorch through glass on two more):
- **The flags** (ours since X4.6b, this the record): `FlagCloth`, a two-sided sheet in world space under an identity
  transform, on a cel material, its positions and normals uploaded by
  `updateVerticesData` whenever the cloth moves. **There are five meshes to a flag,
  not one**: a static pole, a field and a band on each of the two sheets (16x10
  inside `LOD_FAR`, 11x7 past it).
- **The rings** (the same): `CaptureZoneSystem.finish`, static batches of stones and paint
  on `mats.get(hex, depthUnits)`, the paint on a depth bias.
- **The grass** (ours since X4.6c, this and the turf the record): `GrassSystem`, thin instances per patch at each level of detail,
  rewritten by its own frustum test. No blending flag on the blades.
- **The turf**: blended by its material's bind (`createTurfMaterial`), writing no
  depth, on `ROAD_DEPTH_UNITS`. `needAlphaTesting` is set for the draw ORDER only.
- **The water** (ours since X4.6d, this the record): `createWaterMaterial`, a grid and a `waterFar` quad per body
  (`WaterSystem` shows one or the other by distance), a bed-depth map per body
  and a cube per body read through `wrapCubeTexture`. No blending flag on the
  material, and **it writes depth**.
- **The glazing** (ours since X4.6e, this the record): `PaneBlocks`, see-through over its block's cube and writing no
  depth, `backed` writing depth. `GlassFx`'s collapse writes positions into a
  block's buffer with `updateVerticesData`. **Many of these surfaces are NOT at
  identity** (a group of one is not baked, in a round as in the editor): 42 of
  Coldharbour's 78 (12 see-through), 20 of Sarab's 28 (16), 12 of Cinderhaven's 14
  (4), and every one's positions are local to that matrix.
- **The three pools** (the same): `CombatFx`'s sparks and dust discs and
  `BlastDebrisSystem`'s scorch (a `StandardMaterial` decal). Babylon draws them
  back to front by bounding-sphere centre, INTERLEAVED with the see-through pane
  blocks (X4.4a measured this, and X4.6a on every row since).
- **The blob shadows** (the same, and the facing below the record of before 0e44130, which turned it UP by the owner's decision of 2026-11-05 and deleted `FINDINGS.md` 67): `ShadowSystem`, one disc per combatant (`blobFor`), a black
  `StandardMaterial` with a radial `opacityTexture` (a canvas gradient), faded by
  `visibility`, `noInk`, `noGlow`, and one `warmBlob` pose. Placed by `updateBlobs`,
  whose two callers are a played frame's and the benchmark's, so no frozen frame
  reaches it and no row held a blob until `fx-blob-sort`, which is how the first
  version of this list came to miss them. **A blob faces DOWN on a back-culled
  material, so from above it draws nothing** (the question in "Decisions", and
  `FINDINGS.md` 67): `CreateDisc`'s front is its -Z, the world normal is (0, -1, 0),
  and where a dust disc is `DOUBLESIDE` geometry a blob is not. In `fx-blob-sort` the
  one on the pavement below the eye is in the log and owns 0 pixels, and turning the
  cull off or flipping the disc moves 0.1153% of that frame by up to 32/255. It costs
  draws all the same: ~14 a frame through a live round on Coldharbour.

**Where each sits in Babylon's frame** (measured by X4.6a, `surfaces.mjs`: the
same order on all 130 rows, seven maps, every mark in the same place). Our points
come `first`, then Babylon's opaque list, `beforeAlphaTest`, `afterSurfaces`, its
alpha-tested list, `opaque`, its particles, `beforeBlended`, its transparent list,
`afterGroup`. Every one tests depth LEQUAL and writes all four channels, so an
equal-depth pixel goes to whichever draws LATER: a port hung BEHIND the world on
`"beforeAlphaTest"` flips any exact tie with it, where Babylon's opaque list has it
ahead, and only a byte comparison will say. **The same goes for what stays on that
list: a tie with it is real, and X4.6b measured one.** Under a 0.05 m near plane a 32-bit
float depth steps every half-millimetre at 18 m and every 3 mm at 53 m, so a blade
growing through a stone ties for real. Hung at `"beforeAlphaTest"` as first briefed, the
zones moved 8 pixels of `ring-stones` and 7 of `ring-flown-far`, by up to 68/255, both
`within floor` at `--check`; all at `"first"`, 54 of `ring-behind-field` by up to 113/255.
So they are split at the blades' key, the near ones at `"first"` and the far ones at
`"beforeAlphaTest"` (X4.6b's entry). The table below is Babylon's order as X4.6a measured it,
the record each later sub-step is proven against.

| surface | Babylon's list, sorted by | ahead of | depth write | bias | cull | blend |
| --- | --- | --- | --- | --- | --- | --- |
| flag (both sheets), pole, stones | opaque, nearest first | `beforeAlphaTest` | on | 0 | back | off |
| paint | opaque, nearest first | `beforeAlphaTest` | on | -8 | back | off |
| blades (`grass0..`) | opaque, nearest first, all tied at the field's centre, in `lods` order | `beforeAlphaTest` | on | 0 | off | off |
| water, `waterFar` | opaque, nearest first by the rect's centre | `beforeAlphaTest` | on | 0 | back | off |
| `backed` | opaque, nearest first | `beforeAlphaTest` | on | -16 | back | off |
| turf | alpha-tested, tied, coarsest cell first (8, 4, 2) | `opaque`; past `afterSurfaces` | **off** | -8 | off | `SRC_ALPHA, ONE_MINUS_SRC_ALPHA`, alpha `ZERO, ONE` |
| see-through | transparent, farthest first, with the pools and the blobs | `afterGroup`; past `beforeBlended` | **off** (by the blend) | -16 | back | `SRC_ALPHA, ONE_MINUS_SRC_ALPHA`, alpha `ONE, ONE` |
| spark, dust disc | the same list | the same | **off** | 0 | back (a disc is `DOUBLESIDE` geometry) | the same |
| blob | the same list | the same | **off** | 0 | back (single-sided, facing down) | the same |
| scorch | the same list | the same | **off** | -4, slope -2 | off | the same |
| spark, in the glow's mask | the mask's own, farthest first | our `maskLate`; past our mask's open | **off** | 0 | back | the same |

**Nothing else of Babylon's is drawn in the main pass**, in any of the 132 rows (the
particles being off in all but one) or in two live rounds: Coldharbour and
Cinderhaven, 25 s each standing at a spawn with every Babylon `render` logged, drew
the panes, the water, the zones, the grass, the turf and, on Coldharbour, the blobs.
Coldharbour's scene holds nothing else that is not a collider but the idle pools and
`localShadowProxy`, which neither round drew. **The bank alone could not have said
this**, which is the lesson of the blob: a class a frozen frame never raises is
absent from every row, so an empty class in `surfaces.mjs` says only that frame. A
dust disc and a blob are `noGlow` and in no mask. A spark and a disc are always under
`visibility` 1 when they draw: `spawnImpact`'s one caller is inside `CombatFx.update`'s
tracer loop, ahead of the fade loops, so the same call that raises them fades them,
and a tracer only reaches its impact on a step with `dt` over 0 (a read of the code).
So neither is ever on the opaque list. The size gate drops none of these surfaces in
any row; a blob is a loose mesh to it (`tooSmallMesh`), so a far one can be gated in
play, and a port keeps that.

**What each does in an editor build** (`surfaces.mjs --editor`, Coldharbour and
Greyfen, `F2` from the menu and each eye of the map's rows):
- **The flags and the rings do not exist**: `buildEditorMap` is `installMap` alone,
  `zones.build` is `buildRound`'s, and `teardownMap` took any away (`zones` 0, no
  `zone-*` mesh). X4.6b has nothing to do there.
- **The grass, the turf and the water are the same meshes on the same lists**,
  following the free camera from `tick`, because `GrassSystem` and `WaterSystem` are
  no world surfaces and `installMap` builds both on either path (the water's cube
  the default one, at strength 0, nothing baked). **X4.6c and X4.6d move them here
  too** (decided 2026-11-03), one path through each system as the sky's did at X4.5c.
  Changing a water or a grass rect's value is the tier-3
  rebuild, measured: every mesh of both remade. Dragging one moves its PROXY alone
  (`repositionScene` returns for any list but placements and scatter, and
  `onDragEnd` rebuilds navigation only), so what is drawn waits for the next tier-3
  (a read of the code).
- **The glazing is the one world surface here, and it stays Babylon's until X5.3**:
  179 surfaces on Coldharbour against a round's 78, one mesh per placement PER
  MATERIAL (`PaneBlocks.finish` splits by material after the owner), `backed` on the
  opaque list and see-through on the transparent one, over the default cube. Counted:
  115 glazed placements (57 cars, 26 towers, 24 shophouses, 6 depots, 2 offices), 83
  of them one see-through surface and 32 of them three, so 115 see-through and 64
  `backed`; Sarab 42 over 38 placements, Cinderhaven 16 over 8. A round's 78 is 32
  see-through and 46 `backed` over 32 blocks. **`merge.ts`'s comment is stale** (82
  placements, 40 meshes), which is `src/` and goes with X4.6e.
- **The pools and the blobs stand idle**: built, hidden, nothing raises them.
- **Babylon's transparent list holds the see-through glazing AND the editor's
  proxies** (`editor/proxies.ts`, `ed-rect`, `-frame`, `-ring`, `-pole`, `-arrow`), every
  one of them blended and usually the larger part of it: at Coldharbour's eyes, 69
  against 8 panes at `menu`, 150 against 89 at `avenue`, 38 against 4 at `crossing`,
  and on Greyfen, with no glass at all, 26 to 414 alone. X5.3 inherits both.

- **X4.6a — the bank sees what it does not yet LANDED** (df74bd4; 2026-11-03; no change
  to the game; its full note is in `plans/done/babylon_exit_landed.md`). **Nine rows**,
  appended by `--rows`, every one at an eye a row above it stands at or the menu's,
  so the benchmark gains no stop: `hollowmere-ring-flown`,
  `coldharbour-ring-flown-far` (the cloth up its pole, both sheets and both sides),
  `coldharbour-ring-stones`, `greyfen-grass-low`, `-medium`, `-high`,
  `coldharbour-fx-water-fade`, `coldharbour-fx-glass-broken` (a real collapse, stood
  up again by the put-away) and `sarab-pane-water` (the one sight line from any eye
  in the table that reaches water through glass). **One gap was not real**: the far
  quad already owns pixels in 16 rows (`coldharbour-menu` 204,387,
  `cinderhaven-sky-cloud-moon` 120,672, `coldharbour-sky-disc` 69,292), so it took no
  row. **The instrument is kept**: `plans/webgpu-ref/surfaces.mjs` is the two tables
  above, and each sub-step re-runs it to show it took the whole of its surface. Two
  new fields, `flown` and an `fx` event `breaks`. **Measured**: 121 of 121 old rows
  byte-equal to a BEFORE at 1b5fec8 in one run and 120 in the other (the known pistol
  pixel); the 9 new rows byte-equal to themselves across two checks; the same 34
  stale rows red with the same means. Typecheck, build, corecheck and parity pass.
  **Its review** (5d43b2e; 2026-11-03; no change to the game, and under `src/` only
  `bench/vantages.ts`) added the blob class, a blob `fx` event and **two rows**, both
  at `square`'s eye and at the end of Coldharbour's list: `fx-blob-sort` (the panes, a
  far spark and disc, a blob at 11.32, pane 0's block at 8.35, a blob at 7.76, a near
  spark and disc, a blob at 6.21, with 3,149 pixels of blob on the panes, 3,802 on the
  sparks and 1,328 on the discs, and a fourth blob on the pavement owning none) and
  `fx-scorch-glass` (a mark sorted behind the block and one in front, 23,585 pixels
  through the glass, which all nine old scorch rows hold none of). `surfaces.mjs` now
  reports every class by list, `other` and the editor's `proxy` included, each class's
  whole-frame mean, and `--keep`. Measured in its note; the owner's two decisions are
  in "Decisions", and one question goes back to the owner: **a blob draws nothing from
  above**.
- **X4.6b — the flags and the rings LANDED** (483165a; 2026-11-04; no change to the
  picture; its full note and first brief are in `plans/done/babylon_exit_landed.md`). Every
  `zone-*` mesh is gone: `render/ZoneDraw.ts` draws each ring's stones and paint, each pole
  and a field and a band on each sheet, one draw for one, on the recipes `get` and
  `getCloth` keep, the paint's bias in its recipe. The cloth is one buffer of ours, two
  `writeBuffer`s a move. **The brief's draw point was wrong, and only bytes said so**: at
  `"beforeAlphaTest"` 8 pixels of `ring-stones` and 7 of `ring-flown-far` moved (up to
  68/255, `within floor` at `--check`), a blade growing through a stone being a real tie;
  all at `"first"`, 54 of the new row `ring-behind-field` (up to 113/255). **So the one
  nearest-first order is drawn at two points, split at the blades' key**
  (`GrassSystem.bladeSortCentre`, `Game.zonePull`): the near run at `"first"`, behind the
  dome, and the far run first of ours at `"beforeAlphaTest"`. **Measured** against a BEFORE
  at a269bfb: 133 of 133 byte-equal in one run and 132 in the other (`view-pistol-reload`,
  2 pixels by 1/255), the same 34 stale rows red at the same means; `kit:hash --models`
  identical over 244 builds, the zones' 8 among them; `census` every old row equal; a flag
  taken and then changing hands in a live Coldharbour round, no console error, the seal
  quiet; our pipelines in play zero. A flag's step fell from ~1,315 to ~313 bytes a frame,
  none of it in `present`, `rewrite` or `ZoneDraw`. **What is left of the interleave** is the
  water and the `backed` panes, whose keys the split does not read: no row holds such a
  tie. **Not verified**: a server's match in a browser, the phone.
  **Its review** (e1f5712; 2026-11-04; no change to the game, nothing under `src/`): no
  must-fix and no picture problem. **The tools now end on a lost device** (`harness.mjs`: exit 4 on the
  console line, exit 3 at a hard limit, each proven; `VERIFYING.md`), and **`exact.mjs` is the byte
  comparison** this step owed by hand. `kit:hash` cannot fail on `ZoneDraw`'s draw, which is now
  stated, and holds its sphere to the mesh's. The tie left against water and `backed` panes is measured
  small: no zone triangle at a `backed` pane on seven maps, 61 of Hollowmere's stones at the water,
  seven reversed eyes byte-equal. Two briefs changed (X4.6c owes both points; X4.6e retires the split).
  **Two findings**: `GiVolume`'s pipelines are on no list (`FINDINGS.md` 16), and a lost device freezes
  the game with no message (64). **Device loss is not this step's**: paired, alternating, 0 of 37 runs
  at each tree (64), where the review's unpaired runs lost 12 of 16 and 2 of 4. Bank by `exact.mjs`
  against a BEFORE at a269bfb: every old row byte-equal but the known pistol pixel in one of two pairs,
  no device lost, the same 34 stale rows red. The `CLAUDE.md` trim is left for the owner. Typecheck,
  build, corecheck and parity pass.
- **X4.6c — the grass and the turf LANDED** (4a16b5f; 2026-11-04; no change to the picture but
  the accepted, temporary one its review recorded below; its BEFORE's rows 21839d1; its full note and first brief are in
  `plans/done/babylon_exit_landed.md`). No `grass*` or `grassTurf*` mesh is left, in a round or an
  editor build: `render/GrassDraw.ts` draws each as a run of one index buffer, instanced, a patch an
  instance, over `render/grassProgram.ts` and `shaders/wgsl/grass.ts`, and `GrassSystem` keeps the
  walk, the frustum test and the levels of detail and writes plain arrays. `GrassShader.ts` is gone.
  **No fixed point holds, as the brief feared**: three rows added first, at existing eyes,
  `greyfen-shore-ahead` and `harrowmead-shore-ahead` moving 355 px by up to 60/255 and 251 by up to
  154/255 at `"beforeAlphaTest"` and `harrowmead-shore-behind` 58 by up to 76/255 at `"first"`, each
  byte-equal at the other. **So the blades take one or the other each frame** (`Game.grassPull`, the
  comparison Babylon made): `"first"`, behind the zones' near run, unless a body their drawn patches
  may stand in sorts at or ahead of the field's centre, and then `"beforeAlphaTest"`, first of ours,
  ahead of the far run; the turf at `"opaque"`. **Measured** against a BEFORE at 21839d1: 136 of 136 byte-equal in each of two runs on the final tree by `exact.mjs`, the same 34 stale rows red at the same means. 98
  further poses built to break it were byte-equal, which its review found was the wrong search:
  **a frame whose patches reach reedy bodies on both sides of the key cannot be held by two points,
  and pixels move** on Sarab and Hollowmere (below). No `backed` triangle of 14,844 is within a blade's reach. A real round with a rung change, both
  growths and a teardown, and `F2` with a rect edit, no console error and the seal quiet; our pipelines
  in play zero. The field's share of a frame's allocation falls from ~1,740 to ~100 bytes.
  **Not verified**: a server's match in a browser, the phone.
  **Its review** (d80c078; 2026-11-04; no change to the game, under `src/` only comments and
  `bench/vantages.ts`'s rows): **"only Hollowmere can" was false and pixels do move**. Sarab has four reedy
  bodies, and where a frame's patches reach one nearer than the field's centre and another farther,
  `grassPull` takes `"beforeAlphaTest"` and the blades win ties Babylon gave the farther water: up to 29 px
  (41/255) or 22 px (95/255) at long range through a sight, the table in `docs/rendering.md`, poses aimed at
  this and no rate of play. **The owner accepted it on 2026-11-04 as a recorded, temporary picture difference
  until X4.6d** ("Decisions"). **`sarab-shore-flip` banks it**, appended at `shelf`'s eye: its frame is Babylon's
  order, banked at 21839d1 and byte-equal across two processes; the tree moves 27 px by 54/255, byte-equal across
  two, at the west pool's waterline, read in the crop; `exact.mjs`'s `EXPECTED_MOVES` bounds it. **No
  Hollowmere row**: at each of its seven existing eyes both bodies sort beyond the field's centre, so none can
  hold this case and a row would cost a new benchmark stop, for 4 px by 1/255. **The two briefs below are made to
  agree**: nothing in the one run X4.6d makes ties with a `backed` pane, measured for the water here too, so
  X4.6d retires the split and `"first"`'s exception and X4.6e owes neither. **An editor build was never covered by
  "no change to the picture"**: Greyfen's frames at its six eyes against 21839d1, 302 px by 94/255 at `crossing`,
  47 by 58/255 at the menu's, 10 by 21/255 at `ground`, 5 by 6/255 at `marsh`, `canopy` byte-equal, `treeline`
  noise on one tree, and with the field hidden all six byte-equal, so it is the blades' place against the world on
  Babylon's list, and it stays until X5.3. Bank by `exact.mjs` against a BEFORE at 1d8f393: all 136 old rows byte-equal, no flake coming up, the new row new, the same 34 stale rows red at the same means, no device lost; the row against its truth 27 px by 54/255, through its bound, and a frame over the bound exits 1. Typecheck, build,
  corecheck and parity pass. **Not verified**: a server's match in a browser, the phone.
- **X4.6d — the water LANDED** (5f26b00; 2026-11-04; no change to the picture but the accepted flips ENDING, in
  a round; its full note and first brief are in `plans/done/babylon_exit_landed.md`). No `water` or `waterFar` mesh
  is left, in a round or an editor build: `render/WaterDraw.ts` draws each body its grid or its far quad, a range of
  one index buffer, over `render/waterProgram.ts` and `shaders/wgsl/water.ts`, and `WaterSystem` holds no mesh or
  material and writes plain arrays. `WaterShader.ts` is gone. **The zones, the blades and the water are ONE
  nearest-first order at ONE point** (`render/NearestRun.ts`, `Game.nearestPull`): first of ours at
  `"beforeAlphaTest"`, behind the `backed` panes, three lists merged, a tie to the mesh made first. **That point
  held at the first try**, so `"first"` was not tried for the whole run and no exception stays in `Renderer.ts`: the
  dome is alone there. **Retired**: `Game.grassPull` and `zonePull`, `GrassDraw.near`, its `pull` and `installNear`,
  `GrassSystem.reeds`, `drawnReeds` and `reedsOf`, `WaterSystem.sortCentre` and `surfaceTop`, `ZoneDraw`'s `split`, its
  `pull` and its two runs, `ShadowBindings`' consumers, and `wrapCubeTexture` for the water's pool. **The accepted flips
  are gone**: `sarab-shore-flip` byte-equal to its truth, all seven poses of X4.6c's review and all 1,201 poses of the
  scans byte-equal to 21839d1, and `EXPECTED_MOVES` empty. **Measured** against a BEFORE at a7b29fb by `exact.mjs`: 136
  of 137 byte-equal, in two runs on the tree, the same 34 stale rows red at the same means; the one that moved is the
  flip's row, by the 27 px and 54/255 X4.6c's review banked, back to its truth. The far quad's rows held (204,387
  px in `coldharbour-menu`, 120,672 in `cinderhaven-sky-cloud-moon`). Every water cube on Cinderhaven and Greyfen reads
  back byte-equal, face by level, after a frozen re-bake. A rotor's wash, which no row holds, forced near and far on
  two maps: 8 frames byte-equal. **In every pass, measured**: every draw of a water mesh over 90 frames and a re-bake was
  in the main pass. **Group 0 of the water is its own**: the frame's block and six shadow maps, because the whole frame
  group and these three textures would be 17 in the stage. **The foam stays a Babylon `Texture`** through the seam (X5.4's).
  **An editor build's blades and water stand behind its whole world**; against 21839d1 Greyfen's `crossing`, menu,
  `ground`, `marsh` and `canopy` are byte-equal now at those eyes, and Sarab and Harrowmead keep small differences (the note's table).
  A real Cinderhaven and Hollowmere round, `F2` with a rect edited and seen, out to the menu and a round: no console
  error, no warning, the seal quiet; our pipelines in play zero. A Cinderhaven frame's allocation falls ~7.2 KB.
  Report version 33, `pools.water`. **Not verified**: a server's match in a browser, the phone.
  **Its review** (9b086ef; 2026-11-04; no change to the picture; its table is in the note): Greyfen's editor
  frames were the blades against the WORLD, as X4.6c's review said, and not against the water as X4.6d's note said,
  and they hold at those eyes and not for the map; `CLAUDE.md`'s clause on the zones and the grass was false and is
  rewritten, and 5f26b00's message saying otherwise stands, corrected by the note; `NearestRun.draw` no longer spins on
  a NaN key, which sorts last, the review having found no shipped path to one and finite keys taking the same path
  (200,000 random cases against the old class, in Node); stale comments and `WaterDraw.setGeometry`'s doc. Bank by `exact.mjs`
  against a BEFORE at af5eff1: 137 of 137 byte-equal, the same 34 stale rows red at the same means. Typecheck, build, corecheck and
  parity pass. **Not verified**: a server's match in a browser, the phone, the NaN path on a real frame.
- **X4.6e — the glazing, the three blended pools and the blob shadows LANDED** (a3d24c6, ccd194a, 0e44130, its note a5a4b28;
  2026-11-05; no change to the picture in the first two, the owner's decided one in the third; the full note and the
  brief are in `plans/done/babylon_exit_landed.md`). **Babylon draws nothing in a round** — its opaque and transparent
  lists are empty and its active list too in a live Coldharbour round; an editor build is Babylon's (its glazing until
  X5.3). a3d24c6: `render/GlassDraw.ts` draws the `backed` pane groups under their own world matrices (the cel stage's
  placed twin, the matrix read whole), nearest first AHEAD of everything of ours at `"beforeAlphaTest"`. ccd194a: the
  see-through groups and every spark, dust disc, scorch and blob (`render/FadeDraw.ts`, `entities/fades.ts`) in ONE
  back-to-front run of ours (`render/FarthestRun.ts`) at `"beforeBlended"` behind the moon, farthest first by Babylon's
  `_distanceToCamera` (the square root), a tie to the mesh first in the scene, and the sparks' blooms in the mask behind
  the moon's; the fades' pixel and state read off each material's compiled effect, the scorch's slope term
  (`depthBiasSlopeScale`) new; `warm(on)`, `warmBlob` and `stageWarmFrame`'s poses retired; the round's glazing off
  `wrapCubeTexture` (the default cube keeps it), `glassProbe` gone; a break written into `GlassDraw`'s buffer. The
  harness draws the 31 picture-stream numbers a blob's Babylon mesh drew (`Geometry.RandomId`), which had moved
  `fx-blob-sort`'s bullet mark. 0e44130: **the blob faces UP** (the owner, 2026-11-05): `fx-blob-sort` alone moves,
  5,270 px by up to 78/255, every one a blob's (4,465 of the three above the eye, now unseen from below, 805 of the one
  on the pavement, now seen), re-banked in `ref/`; `FINDINGS.md` 67 deleted; the row no longer holds a blob among the
  panes, a row the owner may ask for. **Measured** by `exact.mjs`, each commit against its parent's take: 137 of 137,
  136 (`sarab-ground`, the flake), 136 and the move; the same 34 stale rows red. `census` equal, Babylon 0 a row;
  `pipelines.mjs --round` zero of ours in play; live rounds, `F2`, the menu and a second round clean; a frame's allocation
  159 KB to 73 KB. Report versions 34 and 35. **Not verified**: a server's match in a browser, the phone.
  **Its review** (4251a34, 48796b8, 1a89216, fdfae2e, a5ca27d, its note 2052df0; 2026-11-06; no change to the picture but
  the owner's decided one in 1a89216; the numbers are in the note). **`FarthestRun.reserve` dropped what the pull had
  filed** when it grew mid-filing, so a frame past 64 items drew pane 0 in the first 64's place: it carries them now
  (the real class in Node, and the review's live frame 0 on Coldharbour, 100 draws, 100 distinct). **Babylon's size gate
  LATCHED the scorch and the blobs** — it read the bounds as of the last time the mesh's world was computed, only for a
  candidate it kept, so one never computed was measured at the origin (381 m and 229 m at 384 px, 1,072 m and 643 m at
  1080p) — where X4.6e's note said "the last frame's", the bank blind to it by `scene.isReady()`: by the owner's decision
  it was **ported exactly** (48796b8: the same gate decision as 8bf7789 on every frame of a live probe, a release and a
  second round's warm-up among them) and **then dropped** (1a89216, `Picture change:`: on Sarab at 832x384 every case
  the latch dropped is drawn, on Sarab and Cinderhaven at 1080p a blob far from where it was last computed). The panes
  are filed among the blobs where their meshes stood in a later round's scene (`blobsBeforeGlass`); `merge:hash` reads
  a pane group's record and `docs/build.md` says why an older `merge:hash` or `kit:hash` baseline differs (the
  glazing's meshes and the probe slot's names; colliders 0); `shaders.mjs` builds the placed stage and the fades;
  `FINDINGS.md` 68 (the bank cannot see a Babylon latch: use a live probe) and 69 (`depth.mjs glass` owes a port).
  **`coldharbour-fx-blob-glass`** banks a blob seen from above sorted between two glass layers (the owner's), 581
  pixels, 96 of them over the far layer; drawn first of the run they move 96, last 612. Bank by `exact.mjs` at every
  code commit against its parent's take: every old row byte-equal but the known flakes, `sarab-ground` shown a
  two-state cross-process flake; the same 34 stale rows red. **Not verified**: a server's match in a browser, the
  phone, `merge:hash --editor`, `gate`.
- **Contracts it keeps:**
  - no pane of either kind casts a shadow
  - see-through glazing writes no depth
  - the ring is the zone's boundary
  - the coverage alpha's two blended exceptions (`docs/rendering.md`)
- **Every sub-step owes**: what leaves Babylon's opaque list lands in the one run
  (`render/NearestRun.ts`, X4.6d), or owes the bytes that say otherwise; its pipelines on `Game.roundPipelines`, and
  `pipelines.mjs --round` zero of ours in play; `surfaces.mjs`, to show it took the
  whole of its surface; and **a BYTE comparison of every row against a BEFORE at its
  parent, never `--check`'s pass line alone**: `plans/webgpu-ref/exact.mjs <before> <after>`
  over two `--check --keep` directories, which prints each row's pixels moved and worst
  value and exits non-zero outside the known flakes (`view-pistol-reload` up to 2 pixels by
  1/255, `sarab/shelf` 1 by 1/255). `ring-behind-field` with the split wrong is 54 pixels
  by up to 113/255 and a mean of 0.0002, so it cannot fail `--check`. `CHECK_TOLERANCE` is a whole-frame mean of
  0.02/255, and a surface can be taken out whole under or barely over it
  (`surfaces.mjs --pixels` now prints each class's mean): all of `fx-water-fade`'s
  discs are 0.0281, all of `fx-blob-sort`'s blobs 0.0235, and the scorch is 0, 0.0004,
  0.0008, 0.0014 and 0.0149 in five of the seven blast rows, each of which would print
  `within floor` with its mark gone.
- **Verify, the whole step:** the bank's water and glass vantages; Greyfen's
  grass at every rung; a flag captured. **DONE** (2026-11-06, against a BEFORE at
  a269bfb; the note "X4.6, the whole step verified" in `plans/done/babylon_exit_landed.md`):
  131 of 132 old rows byte-equal by `exact.mjs`, `fx-blob-sort` the one move (5,270 px by
  78/255, every pixel a blob's), the six new rows byte-equal to `ref/` and across two
  processes; Greyfen's three rungs at 13 poses each, wind steps and turf, 39 of 39
  byte-equal; the flag posed at six meters on two maps, 14 of 14 byte-equal, and captured
  live with the player in the ring, no error, the seal holding. The blob map's leak is
  measured (`FINDINGS.md` 70).

### X4.7 — GPU particles — **S–M, as four sub-steps** (split 2026-11-07: the owner instructed that X4.7 be implemented in sub-steps, each implemented, reviewed and fixed by agents; the four-way split was proposed by the orchestrating session and run under that instruction) — X4.7a **LANDED** (bad6caa, its review 30bd400), X4.7b **LANDED** (8c691c7, its review 312dc44), X4.7c **LANDED** (9dff2c4, its review 9d5ab4a), X4.7d **LANDED** (999d4ca, its review fd7199b) — **all four LANDED**; the step's own Verify **DONE** (marked by the owner 2026-11-07); the Gate after Phase 4 passed 2026-11-07, tagged `exit-phase-4`

`Atmosphere`'s ash and `RotorWash`'s two rings (`GPUParticleSystem`, a box and a
`CylinderParticleEmitter`) as our own compute particles: our update, our draw, our
pipelines on the round's list, and Babylon's scene left with no particle system in a
round or an editor build. The rule that a colour gradient can only be added before a
system's first render goes away with Babylon's particle system (rule 7). **No sub-step
is meant to change the picture**: each is proven byte-identical against a BEFORE at its
parent and lands on its own; a difference goes in a commit of its own whose subject
starts `Picture change:`, only by the owner's decision, with the bank's numbers (rule
2), never absorbed. It is split because the bank holds one particle frame and no wash,
so it is widened first; because the profiler's span is an instrument the moves would
empty; and because the ash and the wash share a shader but not a feature set, the wash
carrying the gradients. The order runs from the least risk to the most.

**THE ONE RULE FOR EVERY SUB-STEP: where a byte-exact port is not reached, STOP and
report to the owner with the numbers** — the rows that moved, their pixels and worst
value, what was tried and what each attempt moved. Do not choose a draw point, a blend, a
sort, a clock or a seed that "holds the rows", and do not land a workaround as "no change
to the picture": that is X4.6c's history (its row in "Decisions"), where an ambiguous
brief led an implementer to an unplanned third option. **A brief from an orchestrating
agent that reads otherwise is wrong, and this paragraph wins.**

**What they are today** (a read of the code, Babylon 9.28; **X4.7a measured the claims
here** and corrected this list in place: the corrections are the defines, the random draws
at rest, the editor's order and the splits, each marked "X4.7a". **The table holds, and
every cell in it is measured — but only since X4.7a's review**: X4.7a left the Greyfen,
Coldharbour and Harrowmead capacities and the Sarab, Coldharbour and Harrowmead blends
unread, and its review read every cell off the live fields on all seven maps in one boot,
each as stated):

| field | systems | emitter | texture | colour | blend | random texture | capacity |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ash, `motes` (`Atmosphere`) | one, rebuilt by `fit` whenever the capacity moves | a box, 0.2 to 11 m up, world-absolute in height; on the origin, or on the eye for a map stating `volume` (Sarab 260, Cinderhaven 250, Kurenai 140) | `mote`, its own 64² canvas radial gradient (`DynamicTexture`, no mips) — **not `puffTexture`**, as this entry first said | `color1`, `color2`, `colorDead`; no gradient | `BLENDMODE_ADD` where `emissive` (Coldharbour, Harrowmead, Sarab, Cinderhaven), `STANDARD` elsewhere | the DEVICE's `maxTextureSize`, no option being passed (8192 on the bank's box, `FINDINGS.md` 5) | `ceil(count / 3 × 14)` under 32,000: Hollowmere 18,667, Greyfen 22,400, Coldharbour 14,934, Harrowmead 16,800, Sarab 5,600, Cinderhaven 6,067, Kurenai 7,467 |
| dust ring, `rotorWash<i>` | one a flying hull (two on Sarab and two on Cinderhaven), kept across installs, rebuilt only for a new palette | a cylinder (`createCylinderEmitter(1, 0.4, 0.5, 0.4)`, the radius set per hull) on the ground `washTo` finds, `lift` over it | `rotorWash`, the 128² puff (`puffTexture`) | a colour gradient of two rows (light, dark), three stops, only the alpha moving; size and velocity gradients; angular speed and rotation ranges | `STANDARD` | 4096 | `ceil(90 × 1.5)` = 135 |
| spray ring, `rotorSpray<i>` | one a flying hull on a map with `water` (all seven state one) | the same, on the water's surface | the same texture | the same shape, the map's whitewater pair | `STANDARD` | 4096 | `ceil(140 × 0.9)` = 126 |

- **Each is a `GPUParticleSystem` routed to `ComputeShaderParticleSystem`** (WebGPU), in
  emit-rate-controlled mode (`Atmosphere.build`'s and `RotorWash.buildRing`'s notes say
  why both depend on it). **Its CPU half is the emission.** `animate()`, called once a
  frame from `Scene._evaluateActiveMeshes` for every started system while
  `scene.particlesEnabled`, sets `timeDelta = updateSpeed × scene.getAnimationRatio()`,
  the ratio being the engine's frame delta clamped to 1..1000 ms, × 0.06: **the wall
  clock, not `tick`'s `dt`**. `render()` adds `emitRate × timeDelta` to an accumulator
  while not stopped, grows `_currentActiveCount` toward `ceil(emitRate × maxLifeTime)`
  and never shrinks it but on `reset()`, and hands the update shader an emit range off a
  circular write pointer. **`render()` returns before any of it while the system is not
  ready** (its effects compiling), so a field emits from the first frame its effects are
  ready, not from its construction. The motes' `updateSpeed` is 0.012 (0.72 s of mote
  time a second), the rings' 1/60.
- **Where it sits in Babylon's frame** (X4.7a measured it, `surfaces.mjs`: every field's
  draw on the list between `opaque` and `beforeBlended`, in every particle row). Every system is dispatched to rendering group 0
  (its emitter is a `Vector3`, so no frustum test or size gate touches it, and
  `WorldCulling` never sees it) and drawn by `RenderingGroup._renderParticles`, after the
  group's alpha-tested list and before item 6, in `scene.particleSystems` order:
  **creation order, a disposed system removed, so a rebuilt field goes to the END.**
  **X4.7a's reading** (`particles.mjs`, a live rotation Sarab → Cinderhaven → Sarab →
  Hollowmere → Cinderhaven in one boot): the motes stand ahead of every ring at every
  deploy, a map change rebuilding the motes (their capacity moves) before the rings (their
  palette does). An editor build (`F2`) has no fleet but keeps the round's rings, cleared,
  when the palette is the same; an in-memory edit of `particles.count` and the editor's
  rebuild then put the motes BEHIND them, and putting the count back leaves them there. The
  editor's panel edits no `particles` field (it edits the floor alone), so no shipped or
  editor flow reaches that order: dev only, recorded, not blocking.
  Against our points: `first`, `beforeAlphaTest`, `afterSurfaces`, `opaque` (the turf,
  added at each install), **the particles**, `beforeBlended` (the moon, first, added at
  `SkyDraw`'s construction; then `FarthestRun`), `afterGroup`. So the moon paints over a
  mote in front of it, and every pane and fade of the one run paints over the particles.
  **No particle is drawn in the glow's mask** (`GlowPass`, `renderParticles = false`;
  X4.7a: no particle draw in any row's mask),
  the lamps' atlas (the same), a shadow map or a bake (all ours). Each draw is an
  instanced triangle strip of four, an instance a slot, in slot order, unsorted; depth
  test LEQUAL, no depth write, no cull, `ALPHA_ADD` or `ALPHA_COMBINE`
  (`_setEngineBasedOnBlendMode`), so an ember leaves the coverage alpha alone and ash and
  dust accumulate into it. Its vertex stage is handed `view` and `projection` APART,
  `eyePosition`, `translationPivot` and `worldOffset`. **X4.7a read the compiled defines
  (`surfaces.mjs`), and the guess this entry made was wrong**: there is NO `IMAGEPROCESSING`
  and no fog define. The render effect is `BILLBOARD`, `BILLBOARDMODE_ALL`, `EMITRATECTRL`
  and `TONEMAPPING 0`, the rings adding `COLORGRADIENTS` and `COLORGRADIENTS_COLOR2`; the
  update effect is `BOXEMITTER` (the motes) or `CYLINDEREMITTER` (a ring), `BILLBOARD` and
  `EMITRATECTRL`, the rings adding `COLORGRADIENTS`, `SIZEGRADIENTS` and `VELOCITYGRADIENTS`
  (no `ANGULARSPEEDGRADIENTS`: the spin is a range). The pipeline, read off the engine's
  cache for the draw: depth write off, depth test LEQUAL, bias 0, cull off, write mask 15;
  ADD `src-alpha, one` on colour and `zero, one` on alpha (the coverage untouched), STANDARD
  `src-alpha, one-minus-src-alpha` and `one, one` (accumulated). The bytes still need the
  compiled SOURCE, which X4.7c reads off the parent.
- **It SPLITS the main pass.** `ComputeShaderParticleSystem.updateParticleBuffer`
  dispatches from inside `render()`, and `WebGPUEngine._computeDispatch` opens with
  `_endCurrentRenderPass()`: every system with a live count ends the main pass, and
  Babylon restarts it for the draw. **Once a ring has emitted, its count stays up until its
  `reset()`** (`RotorWash.clear`, at every install and teardown), so it dispatches and draws
  its dead slots every frame after, at a rate of zero. **X4.7a counted it** (`particles.mjs`,
  the main pass's passes a frame, Sarab and Cinderhaven alike — **in the deploy screen's
  HELD world with `Game.followEye` told the fleet stepped and the hull pinned, not in a live
  round**, which the brief asked for and nobody has counted; X4.7a's review): with the particles off, 10
  render passes from the draw phase's start to the frame's end and no compute pass; with the
  ash and a dust ring live, 11-12 and 1-2, the main pass split 1-2 times; over water, the dust
  ring at a rate of zero with its count of 84 still up beside the spray, 13 and 3, split 3
  times every frame.
- **It holds group 0, and that decides which path the seam takes.** Since X4.6e nothing
  else of Babylon's is in a round, but a started system is dispatched every frame, so in a
  live round group 0 is VISITED and our points are told inside it. **In the bank it is
  not**: `freeze` sets `scene.particlesEnabled` false for every row but a `motes` row, so
  every other row of a round is drawn through the seam's empty-group fallback (X4.5a), its
  points told at the draw phase's end (X4.7a, `surfaces.mjs` on all 143 rows: 137 by the
  fallback, the 6 particle rows by the group; in the probe's held deploy screen, the group
  on every frame the ash runs — a live round's path was not read, X4.7a's review).
  So the bank already grades the path a live round
  takes from X4.7c on (five maps) and from X4.7d on (all seven), and only a particle row
  grades the switch. A stopped field (`apply(undefined)`, every teardown) is still
  STARTED: it drains, and holds the group, behind the menu's photograph.
- **Pipelines.** Babylon's: an update COMPUTE pipeline, made by the synchronous
  `createComputePipeline` at a system's first dispatch, and a render pipeline at its first
  draw, one of each per define set and blend (the dust and spray rings sharing theirs is a
  read; X4.7a: the same defines and blend, so one pipeline of each). The motes' are made
  under the building card, the field emitting at the vantages. The rings', at rest at a
  count of zero, are made on the first frame a helicopter raises dust: the two of Babylon's
  X4.4e measured in play (`pipelines.mjs cinderhaven --round`, `FINDINGS.md` 16; X4.7a kept
  each creation's stack: a compute pipeline under `ComputeShaderParticleSystem.updateParticleBuffer`
  and a render pipeline under `GPUParticleSystem._render`, on Cinderhaven and on Sarab, a
  bot's helicopter raising dust mid-round). **Beside them in that count stands `GiVolume`'s race** (three of
  Babylon's at the spawn in some runs, `FINDINGS.md` 16, X5.1's), which X4.7 does not touch:
  "zero in play" below means zero of ours and none of the wash's.
- **Randomness.** Every number a field draws is `Math.random`, a picture's, which the game
  allows (`CLAUDE.md`); the bank pins it by seeding the calls that draw.
  `GPUParticleSystem`'s constructor draws `4 × randomTextureSize` for its first random
  texture and as many for its second (65,536 for the motes on the bank's box, 32,768 a
  ring); `_initialize`, at the first `render()` after a construction or a `reset()`, draws
  4 a slot for the seeds (74,668 on Hollowmere, 540 a dust ring, 504 a spray ring);
  nothing else in the class, its emitters, `ComputeShader`, `UniformBuffer` or `RawTexture`
  draws (a read, by `grep`). **X4.7a counted every one of these** (`particles.mjs`, each
  construction and first update wrapped): 65,536 a mote field and 32,768 a ring at
  construction; 22,400 (Sarab), 24,268 (Cinderhaven), 74,668 (Hollowmere), 540 and 504 at
  `_initialize`. **And one thing the read missed: a ring AT REST draws its 540 or 504 too**,
  at its first render after every `reset()`, because `_initialize` comes before the count
  test, so every install, teardown and editor rebuild that clears the rings re-draws them
  off the native stream, on the next frame that renders them. The update shader picks from the random textures by slot, seed
  and `currentCount`, so the GPU's state is a function of the CPU's emission, and so of the
  clock. `sky-motes` pins all of it (`placeVantage`'s `motes`): the field rebuilt under seed
  `0xa5`, stepped by Babylon's own pre-warm calls (`animate(true)`, `render(true, true)`) at
  a fixed step under seed `0xa6`, which is where `_initialize`'s seeds are drawn, and held
  by an `updateSpeed` of 0. **X4.6e's lesson is the rule here**: a port that draws a
  different count in a seeded window, or at another call, moves a row for a reason that is
  not the picture (`Geometry.RandomId`'s 31 draws moved `fx-blob-sort`'s bullet mark). So a
  field of ours draws what Babylon's drew, in the same calls and in the same order; a draw
  Babylon made that ours does not make owes the harness a compensation stated beside it, as
  the blob's 31 were, never a new seed.

**The sub-steps.** Each one's Verify includes "Every sub-step owes" below.

- **X4.7a — the bank sees the particles.** **LANDED** (bad6caa; 2026-11-07; no change
  to the game). Five rows banked with `--rows` (`sarab-particles-dust`,
  `cinderhaven-particles-embers`, `-spray`, `-ring-ash`, `kurenai-particles-leaves`), each
  at an eye a row above it stands at; `placeVantage`'s `particles` path, through one field
  adapter a later step adds ours beside; `surfaces.mjs`'s field classes and the seam's
  path; `pipelines.mjs --round`'s stacks (and its Sarab run, which threw on a map with no
  breakable pane); and the live probe, `plans/webgpu-ref/particles.mjs`. **Measured**: 138
  of 138 old rows byte-equal to a BEFORE at 38c65fd by `exact.mjs`; the five new rows
  byte-equal across three processes (the banking, a full `--check --keep`, and
  `surfaces.mjs --keep` with every probe hung); the same 34 stale rows red at the same
  means; the probe's log over the rotation equal to itself by `Object.is` across two runs;
  the corrections above, each marked X4.7a. Typecheck, build, corecheck and parity pass.
  The note is in `plans/done/babylon_exit_landed.md`.

  **Its review** (2026-11-07; instruments and records only, no change to the game) found
  nothing real and five minor points, fixed because X4.7c and X4.7d use these instruments as
  their oracle. The harness's `particles` path now touches a field only through its adapter
  (the ring's rate and `preWarmStepOffset` were direct), and its header and this plan say
  which paths are still Babylon's alone and X4.7c's to give an adapter: the `motes` path
  (`sky-motes`) and `freeze`'s `particles` switch with its thaw. The probe's `_initialize`
  wrap no longer throws inside `Atmosphere.build` on a field that is not Babylon's (it names
  it in `unwrapped`); its header names the adapter it has (`babylon`, `__fields`, not
  `FIELDS`); `--against` now compares every construction's and first update's random draws
  and the editor's orders and draws; and its window's clock is a schedule of frame deltas
  handed to the scene's own path (16.7 ms, and 0.25 and 1,500 ms once in sixty), so
  `getAnimationRatio`'s 1..1000 ms clamp is exercised, where
  `useConstantAnimationDeltaTime` skipped it. The records no longer claim a live round
  for the splits (a held deploy screen) or every table cell for X4.7a (its review read the
  rest), and X4.7c's and X4.7d's Verify name what no row holds. **Measured**: the bank on
  Sarab, Cinderhaven, Kurenai and Hollowmere (51 rows, the five particle rows and
  `sky-motes` among them) against a BEFORE at 260552e by `exact.mjs`, 50 byte-equal and
  `sarab-ground` the documented cross-process residue (100 pixels by 2/255: two frames,
  each taken by both harnesses, Sarab alone at both ends); the same stale rows red at the
  same means; the probe over the note's rotation with `--editor` equal by `Object.is` to
  itself across three runs, and FAILING on a copy of its log with a first update, a
  construction and an editor draw each changed by hand; the table on all seven maps;
  typecheck and build. The note is in `plans/done/babylon_exit_landed.md`. The brief, as it
  was handed over:

  No change to the game; under `src/` only
  `bench/vantages.ts`. **Do:** append rows, each at the END of its map's list and at an eye
  a row above it already stands at, so no older row moves and the benchmark gains no stop,
  banked with `--rows` at the parent: the ash as a map runs it, not gathered, on an ADD
  field that follows the eye (Cinderhaven's embers) and on a STANDARD one that follows it
  and falls (Kurenai's leaves); a helicopter low over SAND, its dust ring stepped and held
  (Sarab); one low over WATER, its spray ring and the water's hole (Cinderhaven's bay); and
  one frame holding a ring and the ash together, which is the order BETWEEN two systems. A
  wash row is posed by the game's own doors where they exist — the hull placed and spooled
  as X4.2d's `x42dr/wash.mjs` pinned it, the rings driven by `RotorWash.update` with the
  fleet stepped — and pinned as `sky-motes` is: the rings REBUILT under a seed (they are
  built at install, off the native stream), stepped by Babylon's pre-warm calls at a fixed
  step under a second seed, held by a clock of zero. **In a particle row the particles
  drawn are exactly the ones it states**: every other field is held empty (`stop()` and
  `reset()`, which stays empty in emit-rate-controlled mode). **Write the harness's
  particle paths so a later step adds the path for OURS beside Babylon's**, because X4.7c's
  and X4.7d's BEFOREs run the newest instrument files over the parent's tree (X4.5a's note;
  `freeze`'s water clock is kept for a tree whose water is Babylon's). **Measure and
  record, at the parent:** `surfaces.mjs` gains a `particles` class — each system's draw
  logged at its place between the points, its pipeline state, and the defines of its
  compiled update and render effects — and `--pixels` takes each system out for a frame,
  which shows a row HOLDS it; which path the seam takes in every row and in a live round;
  the main pass's render passes a frame in a live Cinderhaven round, the splits counted;
  the `Math.random` draws at each construction and each `_initialize`, counted as X4.6e
  counted the blob's; and the order of `scene.particleSystems` across a live rotation Sarab
  → Cinderhaven → Sarab → Hollowmere → Cinderhaven and an editor rebuild. **The read is
  that in every shipped flow the motes stand ahead of every ring** (a ring is rebuilt only
  for a new palette, and no two maps with rings share one), and that an editor's edit of a
  map's `particles.count` is the one flow that could put them behind (dev only; record it,
  it does not block). And `pipelines.mjs cinderhaven --round` and `sarab --round`, each
  creation's stack kept. **Keep a live probe** (`plans/webgpu-ref/particles.mjs`, a name to
  change freely): a live round with a hull pinned over sand and over water and the ash
  running, the clock held by `scene.useConstantAnimationDeltaTime` (public), logging per
  frame each field's emission state (rate, accumulator, count, emit index and count, write
  pointer, `timeDelta`, emitter) and the water's site — the CPU half a port must reproduce
  bit for bit, compared by `Object.is` across two trees, since no live frame's pixels
  reproduce. Rewrite `plans/webgpu-ref/README.md`'s "One row holds a GPU particle" and its
  table's row for X4.7. **Read first:** `plans/webgpu-ref/README.md` (the scripts, "What a
  row can stand in front of the camera", "What is NOT in it"); `src/bench/vantages.ts`'s
  header (`motes`, `fx`); `harness.mjs` (`placeVantage`'s `seeded`, its `motes` and the
  put-away; `freeze`'s `particles`); `surfaces.mjs`; `pipelines.mjs`; X4.5a's and X4.6a's
  notes; X4.6e's note on `Geometry.RandomId`; `FINDINGS.md` 16 and 68; `Atmosphere.ts`;
  `RotorWash.ts`; `Vehicle.washTo`; and Babylon's `Particles/gpuParticleSystem.pure.js`
  (the constructor, `animate`, `render`, `_initialize`, `_update`, `_render`),
  `Particles/computeShaderParticleSystem.pure.js`,
  `Engines/WebGPU/Extensions/engine.computeShader.pure.js` (`_computeDispatch`),
  `Rendering/renderingGroup.js` (`render`, `_renderParticles`) and `scene.pure.js` (the
  particle loop in `_evaluateActiveMeshes`, `getAnimationRatio`). **Verify:** every old row
  byte-equal to a BEFORE at the parent by `exact.mjs`; each new row byte-equal to itself
  across two processes (a row that is not, is not banked: find what moves, as the README
  says four times); the same 34 stale rows red at the same means; the measurements above in
  its note. If a row cannot be pinned without changing the game, STOP and report.

- **X4.7b — the profiler's `drawWorld` is answered.** **LANDED** (8c691c7; 2026-11-07; no
  change to the picture; report version 36). `drawWorld` hangs off the camera's DRAW PHASE as
  the brief recommends: opened on `onBeforeDrawPhaseObservable`, closed where the glow's
  span opens (or at `onAfterDrawPhaseObservable` on a frame the glow does no work), the group
  observers and `inDraw` gone; `hookRender` still hangs only off the scene's own observables.
  It holds the rendering manager and, on the fallback's frames, the seam's telling of the
  points (its observer is inserted first, ahead of the glow); NOT the seam's start of the
  pass (our `begin`, its prepares and `first`), whose observer was added at the renderer's
  construction, before any `arm`. **Measured** (`?profile`, 600 frames a capture, the
  Windows box headless): the menu, `drawWorld` on 0 of 600 frames at the parent and 600 of
  600 at the step (0.003 ms Coldharbour, 0.005 Cinderhaven); a live round, 600 of 600 at both
  (the ash holds group 0), 0.153 → 0.132 ms (Coldharbour) and 0.144 → 0.144 (Cinderhaven); a
  Coldharbour round with the particles off (the fallback's path) 600 of 600 at 0.003 ms. On
  every frame of every capture `drawWorld` and `glow` both inside `render`, `drawWorld` ended
  before `glow` began (the trace, 601 frames each); the tree `drawWorld: render`, `glow:
  render`. **So in a live round today the span is Babylon's particles and, about half of it,
  our opaque recording** (corrected below; this said "almost all Babylon's particles"), and
  it will fall by ~0.13 ms across X4.7c and X4.7d while `glow` rises by ~0.06: like is
  compared with like, but not a constant. The viewer opens v36 and v35 captures with no error (no name
  moved, so it was not touched). The bank, all 143 rows, against a BEFORE at 30bd400 by
  `exact.mjs`: 141 byte-equal, `harrowmead-view-pistol-reload` within its known flake, and
  `sarab-ground` 100 pixels by 2/255, the cross-process residue: Sarab alone three times a
  tree, the parent drew the step's frame once (the two frames both the parent's). The same
  34 stale rows red at the same means. Typecheck, build (`check-babylon-free`,
  `check-proving`), corecheck and parity pass. The note is in
  `plans/done/babylon_exit_landed.md`. **Reviewed** (independent, off Babylon 9.28's source
  and the step's captures; comments and records only, no change to the game): **what the
  span holds was mis-stated.** `GPUParticleSystem`'s compute dispatch ENDS the main pass from
  inside group 0 (`_computeDispatch` calls `_endCurrentRenderPass`,
  `Engines/WebGPU/Extensions/engine.computeShader.pure.js` line 203), which runs the bundle
  list (`Engines/thinWebGPUEngine.js` lines 59-67): our `first`, `beforeAlphaTest` and
  `opaque` recordings, queued ahead of the particles. So with the ash our opaque recording
  runs INSIDE `drawWorld`, and without it where the glow's mask ends the pass, inside `glow`.
  The Coldharbour rounds show it: particles on, `drawWorld` 0.132 / `glow` 0.078 / `render`
  0.58 ms; off, 0.003 / 0.140 / 0.48. About half of `drawWorld` is our encoding, so across
  X4.7c and X4.7d it falls by ~0.13 ms while `glow` rises by ~0.06 — a move between spans,
  not a regression of the glow (both Verifys say so). Corrected: `docs/profiling.md` (the
  X4.7b measurement, and the weapon's queuing, "not confirmed by a capture" now confirmed),
  `FrameProfile.hookRender`'s header, and this entry and the note. Also: `GlowPass.render`'s
  and `FrameDepth`'s guard comments said render targets ("a reflection probe's bake") raise
  `onAfterDrawPhaseObservable`, when in 9.28 only `Scene._renderForCamera` does
  (`scene.pure.js` line 4180) — the guards stay, harmless; and the v36 note in
  `profileReport.ts` now says a group frame the glow skips also picks up the seam's `after`
  observer and `FrameDepth`'s test (negligible). The brief, as it was handed over:

  No change to the picture; a report
  version. The span opens on Babylon's rendering group, so on a frame Babylon visits no group
  (X4.5a's fallback: the menu, every bank row, and from X4.7c every live frame on five maps)
  no span opens and our queuing falls under none; from X4.7d it reads 0 on every frame of a
  round. **It lands BEFORE any move**, so a capture across X4.7c and X4.7d compares like with
  like. **Do:** hang it off the camera's DRAW PHASE instead of the group —
  `onBeforeDrawPhaseObservable` to `onAfterDrawPhaseObservable`, the public observables
  `inDraw` already reads, so `hookRender` still hangs off the scene's own observables and
  `CLAUDE.md`'s "Measuring a frame" stands — closed where the glow's span opens, as `inDraw`
  is closed there today, so `glow` stays outside it and the spans still nest. It then reads
  the same whichever path told our points. Retiring the span (the phase out of `PHASES` and
  `PARENT_OF`, a report version) is the other answer, if the draw-phase form cannot be made
  to nest. **Read first:** `FrameProfile.hookRender` and its header (`inDraw`, "the three
  cannot overlap"); `docs/profiling.md` (the phase tree, ~line 425; the weapon's queuing,
  ~line 1240; the viewer's three rules); `render/babylonSeam.ts`'s `onMainPass` (which
  observers are inserted first, and the fallback); `GlowPass`'s observables. **Verify:**
  `?profile` captures of a live round at the parent and at the step on Coldharbour and
  Cinderhaven, and of the menu: `drawWorld` open on every frame, `glow` outside it, the tree
  as `ProfileReport.tree` states it; the bank by `exact.mjs`, which should move nothing (the
  profiler is disarmed there). **Owes:** `FrameProfile.hookRender`'s comment,
  `docs/profiling.md`'s tree and its "from X4.7 ... owes the span an answer", the report
  version, and the viewer only if a name moved.

- **X4.7c — the ash is ours.** **LANDED** (9dff2c4; 2026-11-07; no change to the picture;
  report version 37). The ash is `render/ParticleDraw.ts` (every field in one list in
  creation order, its GPU half, the prepare and the draw), `render/ParticleField.ts` (a
  field's CPU half: Babylon's `animate` and the emit-rate-controlled arm of `render`, line
  for line, the not-ready gate's one frame included), `render/particleProgram.ts` and
  `shaders/wgsl/particles.ts` (Babylon's three modules AS COMPILED, read off the parent's
  device and copied, the bindings and the attribute fetch alone changed); a new draw point,
  `"particles"`, right behind `"opaque"` in the same slot of the host's, so behind the
  turf, ahead of the moon and ahead of Babylon's rings. `Atmosphere` decides the field
  and draws nothing; its pipelines (the update and both blends) are "the ash" on
  `Game.roundPipelines`; the update is a prepare, so the pass no longer splits; no seam
  item was added. **One thing the brief read otherwise**: the DRAW reads the buffer the
  update READ (`_createVertexBuffers`' crossed lists, bound at the incremented index), not
  the one it wrote — the port follows the code, and no held row can tell. **Measured**:
  the bank, all 143 rows, against a BEFORE at 312dc44 by `exact.mjs`: 142 byte-equal, the six particle rows
  and `sky-motes` among them, `view-pistol-reload` within its flake, and `sarab-ground` 100
  pixels by 2/255, the cross-process residue (Sarab alone twice a tree: the parent drew
  the step's frame once); the six particle rows also byte-equal with THIS harness run over
  the parent's tree, so the adapter picks Babylon's there; each ash row HOLDS our field
  (on against off: `sky-motes` 630,923 px, the embers 4,387, ring-and-ash 4,159, the
  leaves 16,696 — X4.7a's own counts); the probe across the trees, `hollowmere coldharbour
  cinderhaven sarab cinderhaven`, equal by `Object.is` on every map and every
  construction's and first update's draws; `census --against` equal on four maps, Babylon
  down one and ours up one in each ash row; editor frames at four eyes, held with and
  without a seeded ash, byte-equal across the trees; `pipelines.mjs cinderhaven --round` and
  `sarab --round` none of ours in play and the wash's two, and a standing Hollowmere
  making two of Babylon's fewer after its install (the motes') and three of ours more at
  the boot; `?profile`,
  `drawWorld` 0.132 → 0.002 ms and `glow` 0.075 → 0.143 in a Coldharbour round, as
  X4.7b's review predicted; live rounds on Cinderhaven and Kurenai through a teardown, a
  second round and `F2`, no console error and the seal quiet; `gate`, `shaders`,
  typecheck, build, corecheck and parity pass. **For the owner**: the dev-only
  editor flow X4.7a recorded (an in-memory `particles.count` edit rebuilding the motes
  behind the rings) now keeps them AHEAD, so the probe's `--editor` orders and the order
  of its draws differ there (the same draws); no shipped flow reaches it. **Decided by the
  owner 2026-11-07**: accepted as a recorded, dev-only order difference until X4.7d
  ("Decisions that are yours"). The note is in `plans/done/babylon_exit_landed.md`.
  **Reviewed** (2026-11-07; independent, records and docs only, no change to the game):
  nothing real. Read against Babylon 9.28's source — the ping-pong, the ready gate after a
  reset, the emission, the clock, the blends, the uniforms and the ordering all confirmed —
  and live over a rotation Hollowmere → Coldharbour → Coldharbour (a second round) → Sarab
  → Hollowmere: always one field and exactly six `particles:` GPU resources live, no leak
  across the rebuilds or the second round, the field drawn on every frame of the deploy
  screen, play and the menu, no console error. Three minor points, recorded: **the
  first-field timing** — the ported one-frame ready gate equals Babylon's only once
  Babylon's effects are cached; on a session's first field Babylon's render and compute
  effects may have taken more frames to come ready, so our first emission can start a few
  frames earlier, under the building card, which nothing measures (the probe opens its
  window at the first ready frame) and nothing shows (the field runs on the wall clock);
  **device loss** — Babylon's particle `rebuild()` path is gone with the port, which is not
  worse in practice, every draw of ours already dying on a lost device (`FINDINGS.md` 64);
  and `docs/rendering.md`'s moon passage, which put the wash ahead of the ash (it draws after
  the ash and before the moon), corrected. The review's note is in
  `plans/done/babylon_exit_landed.md`. The brief, as it was handed over:

  **Do:** the machinery, and the motes on it. Names are
  proposals: `render/ParticleDraw.ts` (every field of the game's in ONE list in creation
  order, a disposed one removed, so the order `scene.particleSystems` held is kept; their
  buffers; the update dispatched and the draw queued), `render/particleProgram.ts` (the
  pipelines: an update a feature set, a render a feature set and blend),
  `shaders/wgsl/particles.ts`, and a field's CPU half: Babylon's `animate` and the
  emit-rate-controlled arm of its `render`, ported line for line, the not-ready gate
  included, so a field emits and draws nothing until its pipelines are ready. **What makes
  it exact:**
  - **the WGSL is Babylon's AS COMPILED** for that feature set, read off the parent's
    effects after its preprocessor and copied, the bindings alone changed: a re-typed shader
    is a different rounding (X4.6e read the fades' pixel stage and state off each
    material's compiled effect);
  - **the buffers are Babylon's layout** (`_initialize`'s stride and its
    `alignDataInBuffer` padding), ping-ponged as `_targetIndex` is, the draw reading the
    buffer the update just wrote;
  - **the random textures** are `rgba32float`, `randomTextureSize` × 1, read by
    `textureLoad`, the motes' width the device's `maxTextureDimension2D` as Babylon's caps
    read it (so another device keeps its own field); both drawn at the field's construction
    and the seeds at its first update after a build or a reset, in Babylon's order;
  - **the uniforms are the values Babylon bound**: `view` and `projection` APART (a fused
    matrix is a different rounding; read off the camera in the system and handed in, as
    `Sky` hands in its `viewRotation`), the camera's `globalPosition`, `colorDead`, and the
    emitter's matrix built as `Matrix.TranslationToRef` builds it;
  - **the clock is Babylon's**: `updateSpeed × scene.getAnimationRatio()` (public), handed in
    by `Game` once a frame in every state the scene renders, as `animate()` ran; X5.4, which
    takes the frame, inherits that clock;
  - **the update runs OUTSIDE the main pass** (`host.prepareEncoder()`, item 9: submitted
    first, inside the GPU timer), so the pass no longer splits. A split costs no pixel by
    construction (the pass restarts with `load`), and the bytes are what say so: if a row
    moves because the split is gone, STOP;
  - **the draw goes where Babylon's particles were**, after the turf and ahead of the moon.
    The turf is added at `"opaque"` at each install and the moon first at `"beforeBlended"`
    at `SkyDraw`'s construction, so a draw added at `"opaque"` at `Game`'s construction
    lands AHEAD of the turf. The implementer picks the mechanism; `exact.mjs` says whether it
    holds. It is also **ahead of Babylon's rings**, which stay Babylon's through this step:
    the order every shipped flow has (X4.7a's reading; the ring-and-ash row grades it). If
    X4.7a found a shipped flow with a ring ahead of the motes, this step and X4.7d land
    together or the order goes to the owner, never a draw point that holds one flow;
  - **the `mote` texture stays Babylon's `DynamicTexture`**, bound through the seam
    (`hostTexture`, `bind`, items 7 and 8) as the water's foam is until X5.4. **No new Babylon
    internal**: a step that needs one STOPS (rule 4).

  `Atmosphere` keeps `fit`, `apply`, `update`, the wrap invariant and its DEV warning, on a
  field of ours; its header's note on the routing goes. The harness's `motes` path and
  `freeze`'s `particles` switch reach ours and keep Babylon's for a BEFORE. The pipelines join
  `Game.roundPipelines` (BOTH blends declared: a map change can flip one), `shaders.mjs` builds
  them, and a report version counts the particles' draws (the main pass's identity, as
  `pools.water` did). Correct `Game`'s stale comment at `atmosphere.update` ("all of them but
  one": three maps state a `volume`). **Read first:** X4.7a's note; `Atmosphere.ts`;
  `render/babylonSeam.ts` (items 3 and 6 to 9); `render/Renderer.ts` (the points and their
  order); `render/SkyDraw.ts` and `FarthestRun.ts` (what stands at `"beforeBlended"`);
  `render/GrassDraw.ts` (the turf at `"opaque"`); `render/PipelineCache.ts` and
  `core/PipelineWarmup.ts`; the ports of X4.6c and X4.6d for a Babylon program copied as
  compiled; Babylon's sources as X4.7a lists them; `docs/rendering.md`'s frame order and its
  moon. **Verify:** `exact.mjs` against a BEFORE at X4.7b, every row, `sky-motes`, the ash rows
  and the ring-and-ash row among them; `census --against`, Babylon down by the motes and ours
  up by as many; `surfaces.mjs`, no `motes`; the probe's log equal by `Object.is` to the
  parent's on Hollowmere, Coldharbour and Cinderhaven and across a map change; `pipelines.mjs
  cinderhaven --round`, zero of ours in play and the wash's two and `GiVolume`'s race as
  before, and plain `pipelines.mjs hollowmere` creating nothing new; `F2` in an editor build
  (the motes run there too, one path), its frames at a map's eyes byte-compared with the
  BEFORE and reported, as X4.6c's review did; the menu and a second round; the seal quiet.
  **A `?profile` capture across this step is expected to move time from `drawWorld` to
  `glow`** on the five maps whose ash becomes ours (X4.7b's review: about half of the ~0.13 ms
  `drawWorld` falls by is our opaque recording, which lands in `glow` once no compute
  dispatch ends the main pass inside group 0, ~0.06 ms), so neither span's move is a regression.
  **And what the instruments do NOT hold, each checked another way and the way named in
  the note** (X4.7a's review): **no row puts a particle against the see-through panes or the
  fades** (the one run at `"beforeBlended"`), and the ash's order against the MOON is held
  by `sky-motes` alone — through the harness's `motes` path, which is Babylon's alone at
  X4.7a, so it grades OUR field only once this step gives that path (and `freeze`'s
  `particles` switch and its thaw) the adapter for ours; a `sky-motes` byte-equal to the
  BEFORE while the path still rebuilds a Babylon field proves nothing. **The particle rows sit
  under `--check`'s mean** (the embers' whole field 0.0142 against `CHECK_TOLERANCE`'s 0.02;
  the ring-and-ash row's two fields drawn in the other order, about 0.0001), so only
  `exact.mjs` grades them, never the pass line. **The bank's rows step a field by its
  pre-warm pair and never read the animation ratio**: the probe is the one test of the
  clock (its window runs the scene's own path, the 1..1000 ms clamp included, since X4.7a's
  review), and its `--against` compares every construction's and first update's random
  draws, so the motes' counting is the port's to add beside Babylon's (the probe names a
  field it cannot wrap in `unwrapped` and does not throw).
  **Owes:** `docs/rendering.md` (the ash's place; "Particles are still under it" now of ours;
  `Renderer.ts`'s point docs), `CLAUDE.md`'s warm-up sentence ("in a round its particles
  alone" becomes the wash alone) and `docs/states.md`'s, `PipelineWarmup`'s header,
  `FINDINGS.md` 5's ash field, the seam's item 6 text, and the new modules' contract headers
  and `FILES.md` lines.

- **X4.7d — the rotor wash is ours, and Babylon's particle system goes.** **LANDED**
  (999d4ca; 2026-11-07; no change to the picture). The dust and spray rings are
  `ParticleField`s of a second feature set, `"ring"` (`render/particleProgram.ts`'s
  `ParticleFeatures`), on X4.7c's machinery: the cylinder emitter's four numbers, the
  colour, size and velocity gradients (`ParticleField.add…Gradient`, Babylon's sort),
  BAKED at the ring's first ready test as `_recreateUpdateEffect` baked them
  (`bakeColorGradients`, `bakeFactorGradients`: an `rgba8unorm` 256 × 2 and two
  `rg32float` 256 × 1), the spin range, a 4096 random texture; the update and the draw's
  vertex stage Babylon's WGSL as compiled (read off 9d5ab4a's device), the update on
  Babylon's EXPLICIT layout (`PipelineCache.compute` takes one now: the gradients are
  unfilterable floats behind non-filtering samplers, which `"auto"` would call
  filterable), the samplers the descriptors Babylon's cache made (the colour clamped,
  the factors REPEATING), stride 20. `RotorWash` decides the rings and draws nothing;
  the rebuild on a new palette is kept. The pipelines join "the ash and the rotor wash"
  on `Game.roundPipelines`. **Retired**: `GPUParticleSystem` and
  `CylinderParticleEmitter` are imported nowhere, `scene.particleSystems` is empty in a
  round and an editor build, the seam's particle observable and its line on the public
  list are gone (no numbered item retires: item 6 stays, for the moon and the one run
  while an editor build's group is visited, until X5.3), `CLAUDE.md`'s gradient rule is
  deleted, and X4.7c's recorded editor-order difference is gone. **Measured**: the bank,
  all 143 rows, by `exact.mjs` against a BEFORE at 9d5ab4a: **143 of 143 byte-equal**
  (no flake came up; the same 34 stale rows red at the same means); each wash row holds
  our ring (dust 83,644 px, spray 42,466, the ring in ring-and-ash 71,242 — X4.7a's
  counts); the gradients element for element equal to the parent's baked arrays on all
  eight rings of Sarab and Cinderhaven (2,048 + 512 + 512 each, with the stops, the
  cylinder and the lives); the probe `sarab cinderhaven sarab hollowmere cinderhaven
  --editor` equal by `Object.is` to the parent's and to 312dc44's on every map (45,120
  numbers a map with a hull, 4,800 on Hollowmere) with every construction's and first
  update's draws, the rings' 540/504 at rest after each reset among them, and the
  editor flow — now ending in the round leaving the editor starts — **equal to
  312dc44's in its orders and draws** (the motes behind the rings after the edit, as
  Babylon put them), where the parent differs; `census --against` equal on Sarab and
  Cinderhaven, Babylon down one and ours up one in each wash row; `surfaces.mjs` no
  Babylon draw in the four particle rows, the seam on its fallback; `pipelines.mjs
  cinderhaven --round` and `sarab --round` zero of either renderer in play; across an
  install Babylon compiles nothing at a vantage (the post chain's six before the card,
  `GiVolume`'s three under it, X5.1's) — handed to X5.4; live, a helicopter landing on
  Sarab's sand and Cinderhaven's water, a teardown, a second round, the map change to
  another palette, `F2` and back, no error and no seal warning; the fade at a stated
  `hullDrawDistance` (420 m on Cinderhaven, temporary) every rate and site equal to
  `rate × strength × fade` as X4.2d's review measured; editor frames at four eyes 8 of 8
  byte-equal across the trees; `?profile` `drawWorld` 0.050 → 0.003 ms (Sarab) and
  0.061 → 0.002 (Cinderhaven); `gate` and `shaders` clean on seven maps; typecheck,
  build, corecheck, parity. The note is in `plans/done/babylon_exit_landed.md`.
  **Reviewed** (2026-11-07; independent; records, docs and comments only, no change to
  the game): nothing real and nothing architectural. **Read** against Babylon 9.28: the
  ring's stride 20 and its slot layout; the bakes ported line for line at a width of 256,
  the `Uint8Array`'s truncation included; the bake at the first ready test, kept across a
  reset; the clamped colour sampler and the repeating factor samplers matching Babylon's
  compute-binding fallback; `SimParams` 176 bytes; `PipelineCache.compute`'s key now
  `label:entry:shape:code`, the `"auto"` callers' behaviour identical; the ring's
  pipelines on `Game.roundPipelines`; one creation-ordered list. **Run**: a live script of
  ten installs in one boot (Sarab, Cinderhaven, Hollowmere, Sarab, Cinderhaven, Kurenai,
  Sarab, Cinderhaven, Sarab, Cinderhaven), both helicopters pinned, one over sand and one
  over the deepest water: the rings exclusive (dust 55.6/s on hull 0, spray 86.4/s on
  hull 1), a destroyed hull silencing its ring, climbing away taking every rate to 0 and
  back, no GPU-resource growth across rounds (5 of each kind and 4 gradient textures at
  every helicopter-map deploy), the maps without vehicles down to the motes alone,
  `scene.particleSystems` 0 throughout, the motes ahead of the rings at every deploy, no
  console error or seal warning. **Not re-run by the review**: the bank, `pipelines.mjs`,
  the probe's `--editor` flow, an editor build. Fixed in the text: `RotorWash.paint`'s
  note, `docs/vehicles.md` and `Game`'s comment at `rotorWash.build` said the palette
  rebuild decides only when a ring's random textures are drawn; it also decides the
  rings' place in `ParticleDraw`'s one list (the motes rebuilt first, the rings after
  them, so the rings draw after the ash), and the repaint those notes promise owes that
  order a check, since it would leave the rings where they were and flip ring against ash
  in a rotation; and `docs/vehicles.md` (and those comments) said the gradients are baked
  at the first UPDATE, where it is the first ready test. Recorded, not a fault: after a
  teardown the rings left standing over the menu re-create their two buffers and draw
  their 540/504 seeds at rest, as Babylon's did — parity. The review's note is in
  `plans/done/babylon_exit_landed.md`. The brief, as it was handed over:

  **Do:** the two
  rings as fields of ours on X4.7c's machinery, with the features the ash does not use: the
  cylinder emitter (the radius per hull, its height, `radiusRange` and
  `directionRandomizer`), the colour gradient of two rows, the size and velocity gradients,
  the angular speed and initial rotation ranges, `randomTextureSize` 4096. **The gradients
  are BAKED as Babylon bakes them** (`_rawTextureWidth`, `GradientHelper.GetCurrentGradient`,
  the colour texture's 8-bit RGBA and its sampling, the factor textures' format), ported, and
  proven equal element for element against the parent's baked arrays before a frame is
  compared. `RotorWash`'s `update`, `drive`, `silence`, `clear` and `surfaceOver` write the
  same numbers into our fields; **the rebuild on a new palette is KEPT** (it decides when the
  random textures are drawn) and only the reason for it changes — a repaint in its place is a
  later commit, if the bytes allow one. `scene.particleSystems` is empty in a round and in an
  editor build; `GPUParticleSystem` and `CylinderParticleEmitter` are imported nowhere; the
  seam's particle observable (`onMainPass`) and its line on the public list go, and item 6's
  text says what still hangs there (the moon and the one run, while an editor build's group
  is visited, until X5.3). **Read first:** X4.7a's and X4.7c's notes; `RotorWash.ts`, all of
  it (the palette, `paint`, `buildRing`); `config/vehicles.ts`'s `wash`; `docs/vehicles.md`,
  "The dust under a rotor"; `Game.fadeHulls` and X4.2d's review's note (the fade and its
  `Object.is` check); `docs/rendering.md` on the water's hole (the sites). **Verify:**
  `exact.mjs` against a BEFORE at X4.7c, the wash rows among them; `pipelines.mjs cinderhaven
  --round` and `sarab --round`, zero of ours and none of the wash's in play (`GiVolume`'s race
  stays, X5.1's); a helicopter landing on sand (Sarab) and on water (Cinderhaven) live, the
  probe's log equal by `Object.is` to the parent's in every rate, emitter and site; the fade
  with its hull at a stated `hullDrawDistance`, as X4.2d's review measured it; a rotation
  through both palettes; `census`, `surfaces.mjs` and a live round's `render` log with no
  Babylon particle; `F2`, the menu, a second round, the seal quiet. **And the editor flow
  X4.7c's decision accepted shown back in Babylon's order** ("Decisions that are yours",
  X4.7c): `F2`, an in-memory `particles.count` edit, the editor's rebuild, then back to a
  round on Sarab or Cinderhaven — the motes rebuilt to the END of the one list, behind the
  rings. **Its oracle is a BEFORE at 312dc44, X4.7c's parent, where every field was
  Babylon's — NOT this step's own parent**, which holds X4.7c's recorded difference there
  (the motes ahead) and so must DIFFER from this step in that flow: the probe's `--editor`
  orders and the order of its `Math.random` draws equal to 312dc44's (the probe run in that
  worktree with this step's instrument files, as X4.5a's note runs a BEFORE), every other
  flow's oracle staying the parent. **A `?profile` capture
  across this step is expected to move time from `drawWorld` to `glow`** on Sarab and
  Cinderhaven, as X4.7c's did on the other five (X4.7b's review: about half of the ~0.13 ms
  `drawWorld` falls by is our opaque recording moving to `glow`), so neither span's move is
  a regression. **And what the
  instruments do NOT hold** (X4.7a's review), each checked another way and the way named in
  the note: **no row puts a ring against the see-through panes, the fades or the moon**, and
  nothing at all holds a ring's order there (the ash's against the moon is `sky-motes`'s,
  once X4.7c has ported the `motes` path); the wash rows are graded by `exact.mjs` alone,
  the ring-and-ash row's order flip sitting about 0.0001 under `--check`'s mean; and the
  probe's `--against` compares the 540 and 504 seeds a ring draws AT REST at its first
  render after every reset (every install, teardown and editor rebuild), which no logged
  number and no row shows, so a port that drops them fails the probe and nothing else.
  **Owes:** `CLAUDE.md`'s
  gradient sentence DELETED (the vehicles section) and its warm-up sentence ("nothing of
  Babylon's in a round but the post chain"); `docs/vehicles.md`'s "What a GPU particle system
  here may and may not do" and "A puff fades IN" (the rules that were Babylon's and the port
  keeps, restated as ours; the gradient's deleted); `docs/states.md`; `RotorWash.ts`'s header
  and `paint`'s note; `Game`'s comment at `rotorWash.build`; `FINDINGS.md` 16's rotor-wash
  bullet, deleted; `docs/rendering.md`; and what the warm-up's vantages still compile in a
  round, measured and handed to X5.4, which owns retiring them (this step does not).

- **Contracts it keeps:**
  - the ring is the disc: one radius for the particles and the water's hole
  - the wash fades with its hull, in its rate and its site, never its throw
  - a held world runs the rings at zero, and what is aloft drifts on its own clock
  - the wrap invariant, and `count` a density
  - no particle in the glow, a shadow map or a bake; no fog on the wash
  - the coverage alpha: an ember leaves it, ash and dust accumulate into it (`docs/rendering.md`)
- **Every sub-step owes**: **a BYTE comparison of every row against a BEFORE at its parent**
  (`exact.mjs` over two `--check --keep` directories, never `--check`'s pass line: a particle
  row's whole field can sit under `CHECK_TOLERANCE`), the known flakes alone excused; its
  pipelines on `Game.roundPipelines`; `pipelines.mjs cinderhaven --round`; `surfaces.mjs`;
  typecheck, build (`check-babylon-free`, `check-proving`), corecheck and parity; `gate` and
  `shaders` once code moves; each new module's contract header and `FILES.md` line (rules 7
  and 9); and **STOP with the numbers** wherever the bytes do not hold.
- **Verify, the whole step:** the bank's particle rows; a helicopter landing on sand and on
  water; `pipelines.mjs cinderhaven --round` with none of the wash's in play; no Babylon
  particle system in a round or in an editor build.
  **What the sub-steps measured toward it** (X4.7c's and X4.7d's notes): the bank with the
  ash and the rings, 143 of 143 byte-equal at X4.7d; landings on Sarab's sand and
  Cinderhaven's water, live; `pipelines.mjs cinderhaven --round` and `sarab --round` zero
  of either renderer in play; `scene.particleSystems` empty in a round and an editor build.
  **DONE** (marked by the owner on 2026-11-07): the Gate after Phase 4 below (a live
  round's `render` log with `surfaces.mjs`, the seam's list read against PERF_PLAN B4)
  passed on 2026-11-07, its live log showing no Babylon particle in a round or an editor
  build, and read the Verify as measured in full.

**Gate after Phase 4:** in a round, Babylon's scene draws only the post chain (an
editor build draws whole until X5.3). That is true of the blob shadows only because
X4.6e now carries them, and checked rather than assumed: `surfaces.mjs` on the rows
and a live round's `render` log, since a class no frozen frame raises is in no row.
Read `babylonSeam.ts`'s list against PERF_PLAN B4's criterion. If the count of
internals is still high, it is a measure of how much risk Phase 5 removes.

**Passed, 2026-11-07, at 55d98aa** (no change to the game; **tagged `exit-phase-4`** on
2026-11-07 by the owner's call, at the commit recording it; the phase-3 tag is still the
owner's call). In a round Babylon draws the post chain
and nothing else, on every bank row and through three live rounds:
- **`surfaces.mjs` on all 143 rows of the seven maps**: no Babylon draw through
  `Mesh.render` or a particle field in any pass (main, mask or target) of any row, the
  seam on its fallback in all 143. Given a fourth wrapper for the gate (the engine's
  `_draw` outside any mesh or field, `effect -> target`), every row's other Babylon draws
  are the post chain alone: `kernelBlur` four times (`glowNearH`, `glowNear`, `glowWideH`,
  `glowWide`: the glow's blur), `celInk` (the glow's compose in its last line), `fxaa`,
  `volumetrics_medium`, `motionBlur`, `paperGrain` to the canvas — 143, 142 or 141 rows
  each, the five `hollowmere-post-*` rows dropping their own pass (`noblur`, `nograin`,
  `nofxaa`, `novol`) and `post-glowlow` adding the glow's `glowDown`. `FrameDepth` and
  render scale draw nothing of their own. No page or console error.
- **A live round's render log** (the gate's scratch `gate-p4/renderlog.mjs`: the engine's
  `_draw` by frame class, keyed by the mesh rendering or the effect, with the target),
  offline, headless on the Windows box, through the menu, the building card, deploy, two
  lives (every primary round the compass, a frag and a molotov, the launcher and a mine,
  a pane broken — by `glass.shoot` on both maps, 60 frames of fire not reaching one — and
  on the helicopter maps a flying hull pinned down to 0.3 m and back up), the walk at the
  far flag until the bots killed the player, the death cam, the redeploy, the menu and a
  second round: **Coldharbour**, run twice (13,972 and 5,796 frames of play, 80 and 23
  kills, 38 and 12 blasts, the player killed and redeployed in each), **Cinderhaven** (18,649 frames, 112 kills,
  the rings drawn, killed twice) and **Sarab** (21,653 frames of play and 10,419 of the
  round-over card, 288 kills, 43 blasts, all three kinds crewed; the player was never
  killed there). In menu, loading, deploy, playing, dying and roundover alike: **the nine
  post-chain draws once a frame and not one mesh draw**; on every sampled frame (every
  twentieth) `scene.particleSystems`, the sprite managers, `scene.layers` and
  `scene.effectLayers` 0, the active meshes 0, and group 0's opaque, alpha-tested,
  transparent and depth-only lists empty — so the group is never visited and the seam's
  items 6 and 10 do not fire in a round. The one mesh held for drawing is
  `localShadowProxy`, which nothing draws. Babylon's one other GPU work in a round is
  `GiVolume`'s compute (`computeSource`, every frame: X5.1's, not a draw). No page or
  console error and no `[pipelines]` warning.
- **An editor build (`F2`) is the stated exception and only that**: Babylon draws it
  whole — 356 (Coldharbour) and 423 (Cinderhaven) mesh keys, 295,745 and 572,090 draws
  over 122 frames, into the frame, the glow's mask and the lamps' atlas — and its own
  shadow generators (`moonShadow`, `nearShadow`, `foliageDepth`, and `flashDepth` on
  Cinderhaven), beside the same post chain. **So does the building card raised from it**,
  for the two frames before `buildRound` tears the editor's build down (4,504 and 9,130
  draws): the editor's world, not a round's, X5.3's with the rest. A round's own card
  draws no mesh.
- **The seam's list against B4.** Ten numbered internals, as at the end of Phase 3
  (item 10 came at X3.5; c4d3021 had ten): Phase 4 added none and retired none (rule 4).
  None is one per pass. Items 1 (the device), 7 and 8 (a Babylon texture's view and
  sampler) and 9 (the encoder submitted first) serve every pass of ours alike; 2 to 5
  (the open pass, the bundle list, its attachments, the target and its flip) serve
  whichever Babylon pass is open, which is the main pass and the glow's mask; 6 and 10
  (the group's `beforeBlended` and `beforeAlphaTest` points) serve the main pass's group
  and, since X4.7d, only in an editor build. Each retires: 6 and 10 at X5.3; 2 to 5 at
  X5.4, for the mask and the main pass together (this note first said "for the mask at
  X5.2": corrected 2026-11-07, row "X5.2, the mask" — moving the mask alone retires no
  item while the main pass still uses them, so the owner kept the mask Babylon's through
  X5.2); 1 and 9 at X5.4; 7 and 8 piecemeal —
  `GiVolume`'s seven textures at X5.1, the editor's shadow generators' maps at X5.3, the
  water's foam at X5.4 — and the canvas-made textures read through `hostTexture` (the
  mote, the puff, the scorch, the blob, the sky's, the cel recipes' own) at no named step
  before X6.1 deletes the file. Outside the seam, its header's four touches in three
  files (`FrameDepth` X5.4, X5.2d proposing it read the public getter first, row "X5.2,
  `FrameDepth`"; `webgpuLeaks` and `FrameProfile`'s two, X5.4 and X6.1).
  **Against the criterion that reads ONE SEAM**, which by B4's own words is the case for
  keeping Babylon owning the frame: the frame's ownership is not forced by upgrade risk.
  B4 is decided the other way for the exit's own reason (removing Babylon, X5.4), which
  the count does not argue against; ten in the seam and four outside it is what Phase 5
  and X6.1 remove.

**Not verified:** a server's match in a browser; the phone; the lids (pause, kit,
settings, lobby) and the benchmark in a live round (the kit bay and the post settings are
in the rows, frozen); a helicopter flown down by a pilot (the hull was pinned; bots flew
their own); a pane broken by a round's own path rather than `glass.shoot`; the player's
death on Sarab. **X4.7's whole-step Verify** is measured in full by its sub-steps (X4.7,
"What the sub-steps measured toward it") and this gate adds the live log with no Babylon
particle: it can be marked done, which is the owner's to do.

---

## Phase 5 — The frame

### X5.1 — GI and the compute passes are ours — **M, as two sub-steps** (split 2026-11-07: the owner instructed that X5.1 be implemented in sub-steps, each implemented, reviewed and fixed by agents; the two-way split was proposed by the orchestrating session and run under that instruction) — X5.1a **LANDED** (06b9daa), X5.1b **LANDED** (e9a39d6, its picture change 9b9d205, its review b22fda3) — **both LANDED**

`GiVolume` (`ComputeShader`, `StorageBuffer`, `RawTexture3D`) on our side: its three
compute passes, its six buffers and its seven 3D textures made, bound and dispatched by
our renderer, its CPU half (`systems/GiVolume.ts`: the window, the light lists, the
channels, the hull slots, the params) kept line for line. Its continuous, fixed-ray-set
behaviour and the `fast` lights hold. **This entry first said "with no Babylon material
left sampling its seven textures, nothing needs a wrapped view", and that is wrong for an
editor build**: `F2` draws its world whole through Babylon's cel materials until X5.3,
and every cel material declares and binds all seven (`CelShader.SAMPLERS`, `applyGi`) —
measured by X5.1a, about 100,000 binds of each of the seven in 120 frames of a Coldharbour
editor build, and none in a round. This entry then said X5.1b owed those materials a
WRAPPED VIEW of our textures (rule 5); **the owner decided otherwise on 2026-11-07** (row 1
in "Decisions that are yours"): **no GI in an editor build until X5.3** — Babylon's cel
materials sample nothing of ours, bound to what GI `off` gives them (1×1×1 placeholders of
Babylon's own and a volume that says "no answer"), a dev-only picture change in a commit of
its own made before the move, so the move is graded against it; the editor regains GI when
X5.3 draws its world with our renderer. The editor's frames stay part of the oracle.
**No sub-step is meant to change the picture**: each is proven against
a BEFORE at its parent and lands on its own; a difference goes in a commit of its own
whose subject starts `Picture change:`, only by the owner's decision, with the bank's
numbers (rule 2), never absorbed. It is split because the bank cannot see the move: every
row photographs the volume's converged fixed point with no dispatch in its frame and no
pulse light in it (`freeze` re-sweeps it eight times and stubs `update`), so a wrong slice
order, a dropped frame, a dirty vis channel or the bake and the dispatch recorded in
another order can converge to the same bytes; and because the pipelines, the buffers, the
textures and the dispatch cannot move apart (Babylon's `ComputeShader` cannot write a
wrapped texture of ours, which has no `viewForWriting`, and our compute writing Babylon's
`RawTexture3D` breaches rule 5).

**THE ONE RULE FOR EVERY SUB-STEP: where a byte-exact port is not reached, STOP and
report to the owner with the numbers** — the rows that moved, their pixels and worst
value, what was tried and what each attempt moved. Do not choose a draw point, a blend, a
sort, a clock or a seed that "holds the rows", and do not land a workaround as "no change
to the picture": that is X4.6c's history (its row in "Decisions"), where an ambiguous
brief led an implementer to an unplanned third option. **A brief from an orchestrating
agent that reads otherwise is wrong, and this paragraph wins.** For X5.1, "byte-exact"
covers at least the bank's rows and every part of the probe's log that is a function of
its inputs (below, "the race"). **What it means for the trace's COLOUR at the game's own
budget** — which no two runs of the parent reproduce, the trace racing — **is the owner's
decision, not this paragraph's**: the third open question under X5.1b, a row in "Decisions
that are yours". **Answered by the owner 2026-11-07** (row 3, option (a)): the trace's colour
lanes are compared byte for byte only in the `serial` scenarios (the trace's budget forced
to 1); at the game's budget the oracle is the bank's converged rows and every deterministic
lane the probe compares. The trace is not changed.

**What it is today** (a read of the code, Babylon 9.28, by a planning agent; **X5.1a
measured it** with `plans/webgpu-ref/gi.mjs` at f7790e4 and corrected it in place, each
correction marked "X5.1a"):

- **Babylon's objects** (`GiVolume.ts`): three `ComputeShader`s, `gi-trace`,
  `gi-compose`, `gi-vis`, with `bindingsMapping` and no explicit layout, so each pipeline
  is `createComputePipeline` (synchronous) with layout `"auto"`, made on its first
  dispatch (X5.1a: 6 or 7 frames after the boot's first `setMap`, under the building card;
  every later install's first dispatch on the frame of its `setMap`; the first
  `setQuality("low")` of a boot 2 frames on). Effects are cached for the life of the engine
  (`_compiledComputeEffects`, keyed by source and defines), so a tier switched back reuses
  its pipelines: low's two (`trace` and `compose`; `vis` has one source for both tiers)
  were made once in a boot and never again (X5.1a). The comment in `disposeTier` that
  dropping a `ComputeShader` "releases the pipeline with the effect cache" is wrong.
  Six `StorageBuffer`s, usage `STORAGE | COPY_DST | COPY_SRC` (140) each (X5.1a): `gi-params`
  2,560 B (160 vec4), written whole every frame; `gi-state` 64 B a probe (4,718,592 at
  high, 1,572,864 at low); `gi-vis` 16 B a probe (1,179,648 at high); `gi-boxes` 64 B a box,
  its 8 hull slots rewritten every frame at offset 0 (57,984 B on Hollowmere, 109,120 on
  Coldharbour); `gi-index` (31,216, 49,184) and `gi-heights` (26,244), at a map's upload. The
  state and vis buffers are zeroed on an upload with `StorageBuffer.clear()`, a `clearBuffer`
  on Babylon's render encoder. Seven `RawTexture3D`s, never uploaded: width `columns`,
  height `layers`, depth `columns` (96×8×96 high, 64×6×64 low, 1×1×1 off), `3d`, one mip,
  usage `COPY_SRC | COPY_DST | TEXTURE_BINDING | STORAGE_BINDING` (15), `giIrr` and `giDir`
  `rgba16float`, `giAux` and `giVis0..3` `rgba8unorm` (X5.1a, off the device).
- **The modules** (`shaders/wgsl/giTrace.ts`). **X5.1a: the planning read said Babylon
  changes nothing but two comment lines, and the text says otherwise**: Babylon's shader
  processor REFLOWS it — indentation dropped, a one-line body split at its braces — and
  prepends `//#define main` and `//#define SHADER_NAME compute:[object Object]`. The TOKENS
  are the source's exactly (5,618 for the trace, 4,392 for compose, 4,415 for vis, comments
  aside), so the program is the source's; a port compiles the source as written and the
  probe compares tokens.
- **The bind groups** (X5.1a, off `createBindGroup`): one group each, at the mapping's
  numbers — the trace's 0-3 the four read buffers whole, 4 the state, **5 the cloud field's
  sampler and 6 its view** (`rg8unorm`, `2d`); compose 0-4, then the three storage views at
  5-7; vis 0-4, 5 the vis buffer, 6-9 the four storage views. **The trace's group is REBUILT
  every frame it dispatches** (one per dispatched frame in every state): Babylon's
  `ComputeShader._checkContext` compares a sampler made from the texture's own wrap fields
  with the internal texture's cached ones, which never match (`wrapR` 1 against null), so
  its context is cleared every dispatch.
- **The cloud field's sampler** (Babylon's compute bind takes it off the INTERNAL texture's
  cached sampling fields, `_cacheSampler.getSampler(texture._texture)`). **X5.1a: the
  planning read said those fields are null until a Babylon material binds the texture,
  "which happens in an editor build", so the sampler likely differs between a fresh
  session and one after `F2`. In a round a Babylon pass DOES bind it**: the light shafts
  (`Volumetrics`, still Babylon's until X5.2) bind it every frame as `cloudShadowMap` (one
  bind a frame in the menu and the deploy screen), which fills the fields; so with the
  shafts on (the default, `medium`) the trace's sampler is the SAME OBJECT our frame host's
  `bind` returns for that texture — clamp, clamp, repeat; linear, linear, linear;
  anisotropy 4 — fresh and after `F2` alike. **With the shafts off from boot** (`gi.mjs --shafts-off`) nothing of Babylon's binds it in a round, the fields stay null and the trace's sampler is repeat, repeat, repeat; linear, linear, nearest; lod 0..0; anisotropy 1 — not the host's — until an editor build's cel materials bind the texture, after which it is the host's for the rest of the session (measured: `F2`, and the round after it). Either way, **the trace's bytes
  did not move**: 256 serially traced probes from a fresh history (16,384 rays; "the race"
  below) under each sampler, byte-equal on Coldharbour, whose trace samples the field
  (`cloudArea.w` 0.45); Hollowmere's is 1, so its trace never samples it. The field is
  1,250 m across there and no hit came near its edge, where clamp and repeat part; the one
  mip makes the mip filter moot, and the trace samples at an explicit level, where the
  anisotropy did not show.
- **The seven as our frame reads them** (items 7 and 8, every frame, every program of ours,
  the bake's included): `host.bind`'s view is Babylon's own (`_hardwareTexture.view`) and its
  sampler repeat, clamp, repeat; linear, linear, linear; anisotropy 4 (X5.1a).
- **The schedule** (`update`): returns with no tier, no map or no buffers; the window
  scrolls, a jump over half of it re-arms the warm budget; `chooseSlow` when the window has
  moved four spacings, the fixture set changed or a chosen fixture changed, and
  `chooseFast`, `writeHulls`, `assignChannels` and `writeParams` every frame, BEFORE the
  readiness gate; then the trace at `min(total, warm ? warmProbesPerFrame :
  probesPerFrame)` workgroups, compose and vis at `ceil(total / 64)`. Tiers: low 64×64×6
  = 24,576 probes, 32 rays, a steady sweep of 64 frames (384 a frame) and a warm one of 6
  (4,096); high 96×96×8 = 73,728, 64 rays, 72 frames (1,024) and 9 (8,192). Measured
  (X5.1a): exactly these dispatches, every step, `converged` on the 18th step (two warm
  sweeps) at high.
- **Where it sits in the GPU frame.** `_computeDispatch` ends the open render pass first;
  **X5.1a: it never ends one** (`_endCurrentRenderPass` answers 0 inside every one of the
  volume's dispatches, in the building card, deploy, a live round, the round-over card and
  an editor build), and the three passes are recorded on Babylon's RENDER encoder ahead of
  every render pass on it, so they split nothing. Our renderer's prepares are recorded on
  the UPLOAD encoder, submitted first in the same submit (`flushFramebuffer`), so the bake's
  late prepare reads the PREVIOUS frame's compose output and the main pass, the glow's mask
  and an editor build's Babylon passes read this frame's. **X5.1a: no frame dispatched the
  volume without our prepares running** (`FrameHost.prepareEncoder` asked): 0 of 19, 61,
  241, 60 and 120 dispatched frames in the card, deploy, a live round, the round-over card
  and an editor build (Hollowmere live, Coldharbour's editor); the card had 2 frames with no
  prepare and no dispatch either. The late prepares are four: `FarthestRun`'s and
  `NearestRun`'s (CPU order, no GPU work), `GlassDraw`'s `late` (a CPU pull, every draw's
  verdict in before the run reads it) and `ProbeBake`'s, the one that samples the volume.
  (Corrected by X5.1a's review: this said "4 in all on the list with the rings' run",
  which counted `NearestRun` twice and left `GlassDraw`'s out.) **They run in PUSH order**
  (`Renderer.onFrame` appends; `begin` walks the list): `ProbeBake` pushes in its
  constructor (`Game.ts`, built before `GiVolume`), the other three at each map's install.
- **The race** (X5.1a; the planning read had nothing on it). The trace lights a hit with
  the volume's own HISTORY (the state buffer, the probe nearest the hit), and another
  workgroup of the SAME dispatch may be rewriting that probe — the shader's own comment says
  so ("may be read before or after its own write; both are history"). So **the trace's
  colour is not a function of its inputs at the game's budget**: one step from the same
  fresh history, repeated, gave four different state hashes in four (432 of 8,192 traced
  probes differing, all in the colour lanes: the SH colour's rgb and direction's xyz); with
  ONE workgroup a dispatch, three repetitions of 40 steps were byte-equal, and the vis
  buffer was equal under both. Everything else the volume writes is a function of its
  inputs: the sun and sky lanes, the age, validity, column and position, the floor height
  and validity in the textures' alpha, `giAux`, the four vis textures and the vis buffer.
  The bank holds anyway, because `freeze` takes it to convergence: eight sweeps leave the
  drift of a held world at most 3.8e-6 a texel (Coldharbour; 0 on Hollowmere), which no
  8-bit frame sees. **A held, converged world is NOT bitwise still at half precision**:
  over two steady sweeps after eight warm ones, `giIrr`'s colour changed on 0 of 143 steps
  (Hollowmere) and 29 (Coldharbour), `giDir`'s on 28 and 38; the exact lanes, `giAux` and
  vis on none; the state on every step (its age lane counts traces, by design).
- **A lamp reaching the bounce** (X5.1a, `gi.mjs`'s `lamp`: a steady fixture switched on
  5 m off the eye, `fast` false, against the volume re-converged with it): a probe is
  re-traced once a sweep and takes its re-trace whole (`blend` 1), so the first bounce is in
  place after ONE sweep and the rest is the multi-bounce iteration. Share of the eventual
  change to the irradiance in place: **high (72 frames a sweep) 92.2% / 91.7% after one
  sweep** (Hollowmere / Coldharbour), 99.3% / 99.0% after two, 99.9% / 99.86% after three;
  **low (64 frames) 94.6% / 91.1%**, 99.6% / 99.0%, 99.94% / 99.86%. Texels within 10% of
  their own eventual change: high 50% / 48% after one sweep, 93% / 91% after two; low 53% /
  43%, 92% / 90%. Its direct light and visibility are a frame's: a new slot's channel is
  traced in the frame it is dirtied.
- **A pulse** (X5.1a, `pulse`: a transient flash held at the eye with the trace's budget at
  zero, beside the same steps with none): compose takes it on the step after it is raised
  and gives it back byte for byte the step after it dies (15 or 16 steps at 1/60 s, a
  quarter of a second), `giIrr` and `giDir` alike; `giVis3` (its channel) and the vis buffer
  the same, steps 1-15 on both maps; `giAux` and the state never move. (Corrected by X5.1a's
  review, off the bits it made a compared field: this said the vis buffer never moves, which
  X5.1a never printed; it moves with `giVis3`, the same visibility written to both.)
- **Lifetimes, clears, device loss.** Babylon defers every buffer and texture release to
  after the frame's submit (`destroyDeferredBuffers`); its `_rebuildComputeEffects` rebuilds
  the three after a device loss, which no draw of ours does (`FINDINGS.md` 64). GiVolume
  touches no seam item itself; the seven reach our frame through items 7 and 8
  (`CelShader.fillFrameTextures`), and the cloud field reaches the trace through no item at
  all (Babylon's compute bind).

**The sub-steps.** Each one's Verify includes "Every sub-step owes" below.

- **X5.1a — the instruments see the volume.** **LANDED** (06b9daa; 2026-11-07; no change to
  the game; nothing under `src/`). The live probe `plans/webgpu-ref/gi.mjs` (its header is
  its contract): the device wrapped from the page's first line (`bootMap`'s new `init`), the
  volume STEPPED one `update` at a time in a held deploy world under a pinned seed, every
  step's CPU half logged and its thirteen GPU resources read back and hashed, the colour
  lanes apart from the rest; scenarios `serial`, `warm`, `stable`, `lamp`, `pulse`, `tiers`
  and `samplerSerial` on Hollowmere and Coldharbour; the live states, the passes, the
  encoders and the prepares through a card, deploy, a round, the round-over card, the menu
  and an editor build with a drag; `--compare` without a browser. The harness's GI path
  stated as a contract (`freeze`'s `gi` block) and checked: a stubbed `update` must stop
  the dispatch, the volume's dispatches counted through one adapter (`__refGiCount`,
  Babylon's arm; X5.1b adds ours) and the count held to the thaw. **Measured**: every
  measurement above marked X5.1a; the bank, all 143 rows, against a BEFORE at f7790e4 (`--check --keep`, the parent's harness) by `exact.mjs`: 141 byte-equal, `sarab-shelf` within its known flake and `sarab-ground` 100 pixels by 2/255, the cross-process residue (Sarab alone, with this harness and with the parent's, drew the AFTER's frame both times: the BEFORE's is the parent's other); the same 34 stale rows red against `ref/` at the same means; the stub's hold held on every row a thaw followed (no thaw threw; each map's last row had none, which its review found and closed); the floors, two full processes each: `--query=gi=off` 142 of 143 byte-equal and `harrowmead-view-pistol-reload` within its flake; `--query=gi=low` 142 byte-equal and `sarab-alley` 5 pixels by 2/255 — two frames, Sarab alone twice more drawing the second run's (3 processes of 4 against 1), the class `sarab-ground` is at high (what moves is that row's frame, both frames the same tree's; the cause is not pinned — it did not appear at off in two runs, which fits the volume's race leaving a sub-8-bit residue there, unproven); the probe equal to itself across two
  processes (`--against`: 904,662 values on Hollowmere and 244,782 on Coldharbour, by `Object.is` and hash, twice: with the file as it was measured and as it is committed; every comparable readback a SHA-256), and FAILING on copies of its log with a step's cursor, a step's params, a serial readback, a vis
  readback, a sampler's anisotropy and a dispatch's workgroups each changed by hand (an
  edited RACED hash of a full-budget step passes: that lane is not compared); `pipelines.mjs coldharbour --round` five times, the `FINDINGS.md` 16 baseline: 3 of Babylon's at the install in 5 of 5 (the volume's), none in play, 21 of ours and 15 modules at the install;
  typecheck, build (`check-babylon-free`, `check-proving`), corecheck and parity pass. The
  note is in `plans/done/babylon_exit_landed.md`.

  **Its review** (aaca294; 2026-11-07; instruments and records only, no change to the game) found
  three real points and eight minor ones, fixed because X5.1b uses these instruments as its
  oracle. **Real**: the harness's Babylon arm counted a dispatch through ANY object in
  `trace`, `compose` or `vis`, so a port that kept a `trace` field of its own and forgot its
  arm would have read the same count for ever and held every row vacuously — it now answers null (and the
  freeze throws) unless each of the three that is set is Babylon's own `ComputeShader`
  (`getClassName()`, named `gi-*`, a `dispatch` on its prototype), and `thaw` throws on null
  too; X5.1b's Verify asked `gi.mjs --against` to be equal while the log differs by design in
  fields it did not name, and read three of the volume's facts past the adapter — the reads
  now go through `window.__giGpu` (two new members, `frameBind` and `cachedSampling`) and
  X5.1b's Verify names every field expected to differ and why, the sampler ones conditional
  on row 2; and X5.1b's late prepare now carries the converse contract (an armed frame whose
  prepares do not run must not advance the CPU half), which today's frames never exercise.
  **Minor**: the pulse's flash-against-control bits are a compared field (`vsControl`); the
  bank thaws after each map's last row, so its hold is checked there too; `dispatched` logs
  x, y and z; `chanDirty` is read as `writeParams` hands it over (it was read after the
  trace's clear, always zeros); row 2's evidence restated (256 probes on Coldharbour, far
  from the field's edge; Hollowmere's trace never samples it; Sarab and Cinderhaven
  unmeasured); the late prepares counted right (`GlassDraw`'s, not `NearestRun`'s twice);
  `exact.mjs`'s header names `sarab-alley` beside `sarab-ground`; and X5.1b's brief says the
  bake-before-dispatch order rests on registration order alone. **Owner's, not decided**:
  the ONE RULE paragraph defined byte-exact for the trace's colour and said it won, which
  settled row 3; it now leaves that to the row, and X5.1b may not land until it is answered,
  the row now saying how thin the `serial` oracle is. The pulse's new compared bits found one
  record wrong — the vis buffer moves with a flash, as `giVis3` does (corrected in "A
  pulse"). **Measured**: `gi.mjs` twice in separate processes equal by `--against` and by
  `--compare` (914,616 values on Hollowmere, 254,736 on Coldharbour), and FAILING on copies
  with a pulse bit, a `chanDirty` and a workgroup y changed by hand; a hand test of the hold
  (a dispatch under the stub throws at the thaw; a port's own objects in the three fields
  read 219 for ever through the old arm and null through the new, and the freeze throws);
  the bank on Hollowmere and Greyfen, 26 of 26 rows byte-equal to X5.1a's AFTER by
  `exact.mjs`; typecheck and build. The note is in `plans/done/babylon_exit_landed.md`.

- **X5.1b — the volume's GPU half is ours, and Babylon does no compute in a round.**
  **LANDED** (e9a39d6, its picture change 9b9d205; below, after the open questions). A
  module of ours (`render/GiCompute.ts`, a name to change freely; no Babylon import, rule 6):
  the five compute pipelines on `PipelineCache.compute` with layout `"auto"`, every tier's
  asked at construction (the trace and compose at each tier, vis once — X4.7c declared both
  blends the same way) as "the irradiance volume" on `Game.roundPipelines`; six `GPUBuffer`s
  of Babylon's sizes and usages, written by the same `writeBuffer` calls at the same offsets;
  the two clears recorded ahead of the next dispatch; seven `GPUTexture`s of the same
  formats, sizes, dimension and one mip, usage 15 (`COPY_SRC` kept: the probe reads them
  back), handed to our frame as owned textures with the sampler descriptor X5.1a read
  (`fillFrameTextures`, no longer `hostTexture`); bind groups at the same binding numbers;
  the cloud field through a `hostTexture` handle and `host.bind` (items 7 and 8, no new
  item) — the host's sampler ALWAYS, the owner's answer to row 2 (2026-11-07); the dispatch recorded
  as a LATE prepare after `ProbeBake`'s, which keeps today's order exactly (the bake reads
  the previous frame's compose, the passes after it this frame's; nothing can be put between
  Babylon's two encoders), and recorded ONLY on a frame whose `update` armed it, so the
  harness's stub still stops it (X5.1a's two adapters gain our arms: the harness's
  `__refGiCount`, and `gi.mjs`'s `__giGpu` with its four members, `texture`, `buffer`,
  `frameBind` and `cachedSampling`). **And the converse, which nothing measured can catch**:
  an armed frame whose prepares do NOT run must not advance the CPU half, or must fail
  loudly in a dev build. `Renderer.begin` returns before any prepare when nothing of ours is
  active on the frame (`!this.filled && !this.maskFilled`) or none is registered, while
  today's `update` advances the cursor, counts down `warmFrames` and clears `chanDirty` in
  the call that dispatches — so a port that keeps those in `update` and records the passes
  in a prepare that did not run skips a slice silently. X5.1a measured that frame never
  happening today (0 dispatched frames without our prepares, in every state), so neither the
  probe nor the bank would see it; the requirement is stated here and the mechanism is
  X5.1b's. **The bake-before-dispatch order rests on REGISTRATION order alone**: the late
  list runs in push order, and `ProbeBake` pushes in its constructor (`Game.ts`, built
  before `GiVolume`), so a late prepare pushed when the volume is built runs after the bake;
  a construction order changed, or the bake hooked again after the volume, reverses it with
  no error — X5.1b states it where the push is made. Every buffer and texture
  destroyed past the frame's submit, never at the call (`setMap`, `setQuality`,
  `worldMoved` and `clearMap` all replace them mid-frame, and an immediate `destroy()` fails
  the upload encoder's whole command buffer). `systems/GiVolume.ts` keeps its CPU half line
  for line, its readiness gate asking our pipelines. `CelShader`: `GiBinding` carries our
  handles; `applyGi` hands Babylon's cel materials (an editor build's) NOTHING of ours —
  the owner's answer to row 1 (2026-11-07): what GI `off` gives them, in a `Picture change:`
  commit of its own ahead of the move (this brief first said a WRAPPED view, a third kind in
  `core/wrappedTextures.ts`, which the answer retired). **Read first**: this entry; X5.1a's note;
  `gi.mjs`'s header; `GiVolume.ts`; `wgsl/giTrace.ts`; `render/Renderer.ts` (`begin`, the
  late prepares), `render/ProbeBake.ts`, `render/PipelineCache.ts`, `render/frame.ts`;
  `core/wrappedTextures.ts`; `shaders/CelShader.ts` (`fillFrameTextures`, `applyGi`,
  `setGi`); and Babylon's `Compute/computeShader.pure.js`,
  `Engines/WebGPU/Extensions/engine.computeShader.pure.js` and
  `Engines/WebGPU/webgpuComputeContext.js`. **Verify**: the bank, all rows, against BEFOREs
  at its parent by `exact.mjs` at high and under `--query=gi=low` and `--query=gi=off`
  (X5.1a's floors); `gi.mjs` over its parent's log (`--against`): equal by `Object.is` on
  every step's CPU half and dispatches (the same workgroups on the same steps), and byte-equal
  on every comparable readback — the `serial` scenarios whole (the colour lanes included:
  there nothing races), and every other scenario's exact lanes; its statics and the rest of
  its log the same but for what moves BY DESIGN, each named here and nothing else excused
  (X4.7a's review's precedent): **`statics.late`** 4 → 5 (the dispatch a late prepare of its
  own); **`statics.pipelines`** (Babylon's three made by the first map's statics, synchronous,
  at the high tier's first dispatch, and low's two only at the first `setQuality("low")`,
  after them — ours all five asked at construction, asynchronous, so the count, the order and
  `call` differ, and `layout` `"auto"` and the entry point do not); **`statics.wgsl`** (three
  modules by the first map's statics against our five, and every module's `length` and
  `prefix`: Babylon's text reflowed behind `//#define main` and `//#define SHADER_NAME …`,
  ours the source as written, no prefix — while `tokens` and `tokensEqualTo` stay equal:
  compare TOKENS); and, **only if the owner answers row 2 "the host's always"**, the cloud
  field's sampler where Babylon's depended on the session — in a default boot
  `samplerSerial.unbound.sampler` and `.isHosts` (Babylon's repeat/nearest at anisotropy 1
  and false; ours the host's and true, since `host.bind` reads the texture's own wrap fields
  and never the internal texture's cache, `babylonSeam.ts`'s `bind`), and under
  `--shafts-off` `samplersFresh.trace` and `.same`, `samplerSerial.asFound.sampler` and
  `.isHosts` and `samplerSerial.restored` (the same two answers), the trace's readbacks under
  each still byte-equal; answered the other way, none of these differ. Everything else in
  the statics is equal, the textures', buffers' and samplers' descriptors and the bind
  groups' entries descriptor for descriptor, and `frameViewIsProducers` true on both arms;
  editor frames at four eyes byte-equal to the BEFORE; `pipelines.mjs coldharbour --round`
  five times with none of the volume's in play and none of Babylon's compute anywhere (the
  baseline is X5.1a's), then `cinderhaven --round`, `sarab --round` and plain `hollowmere`;
  `surfaces.mjs` and a live render log with `_computeDispatch` never called in a round or
  an editor build; `census --against`; live rounds through a teardown, a second round, a map
  change, the GI tier changed in a round with no validation error, and an `F2` drag;
  `?profile`: `gi` loses the recording and `render` gains it, `gpu.frame` unchanged within
  the protocol's 8%; `gate`, `shaders`, typecheck, build, corecheck and parity. **Owes**:
  `CLAUDE.md`'s GI and warm-up paragraphs; `docs/rendering.md` ("The irradiance volume",
  the frame textures, the prepare list); `docs/states.md` and `PipelineWarmup.ts`'s header;
  `docs/profiling.md` and `core/profilePhases.ts` (the `gi` span; a report version if it
  is renamed or emptied, as X4.7b bumped one); `FILES.md` (`GiVolume`, the new module,
  `wrappedTextures`); the contract headers it invalidates (`GiVolume.ts`, `CelShader.ts`'s
  `GiBinding` and `fillFrameTextures`, `wrappedTextures.ts`, `frame.ts`, `Game.ts`'s two
  comments at the volume's construction and `update`); the seam's header (no item retires:
  7 and 8 lose the seven and keep the cloud field, now a compute read); X5.4's "the sky's"
  line (the trace reads that texture through `hostTexture` too); `FINDINGS.md` 16's
  `GiVolume` bullet settled; and device loss recorded (Babylon's `_rebuildComputeEffects`
  goes, as for every draw of ours, `FINDINGS.md` 64).

  **Open questions, the owner's, before X5.1b is handed over** (each a row in "Decisions
  that are yours") — **all three ANSWERED by the owner on 2026-11-07**: row 1 no GI in an
  editor build until X5.3; row 2 the host's sampler, always; row 3 option (a), `serial` and
  the bank's rows, the trace unchanged. As they were asked:
  - **The editor's seven**: a wrapped view of ours for Babylon's cel materials (rule 5,
    recommended), or an editor build with no GI until X5.3 (a dev-only picture change)?
  - **The cloud field's sampler**: the trace's today depends on the session (our host's
    own object once the light shafts or an editor build have bound the texture; repeat and nearest-mipped at anisotropy 1 in a session where neither has, the light shafts off from boot,
    before), and X5.1a measured no byte of the trace's output move between the two over
    256 serially traced probes on Coldharbour, no hit near the field's edge where clamp and
    repeat part (Hollowmere's trace never samples the field; Sarab and Cinderhaven are
    unmeasured). Bind
    the host's always (recommended: it is the default session's, and the one the cel shader
    reads the same texture with), or reproduce Babylon's dependence on the history?
  - **The oracle for the trace's colour**: X5.1a found it races at the game's budget, so no
    two runs of the parent agree on those lanes. Today's byte oracle for them would be the
    `serial` scenarios and the bank's converged rows, the full-budget scenarios compared on
    everything else — and the `serial` oracle is THIN: 96 probes traced (64 at low, 256 in
    the sampler scenario) from a fresh history, so most of the history reads it makes
    (`volumeAt`, the probe nearest a hit) find an untraced probe and return the fallback, and
    a carried lamp's fast bounce likely reaches no valid probe at all (reasoned from the
    counts, not measured). Accept that as "byte-exact" for this step, widen that oracle first
    (instruments only), or make the trace order-independent first — a picture change of its
    own (rule 2)? The row has the options; X5.1b may not land until it is answered.

  **X5.1b LANDED** (e9a39d6, its picture change 9b9d205, the owner's answers recorded in
  14df397; 2026-11-07). **The picture change first** (9b9d205, dev-only, the owner's row 1):
  every Babylon cel material — an editor build's world, until X5.3 — is bound once, on
  creation, to GI `off` (`CelMaterialFactory.babylonGi`: seven 1x1x1 `RawTexture3D`s of the
  factory's own, made as `GiVolume` made them at `off`, `giShade.w` 0, the lightning fill the
  live `giExtra`), so `setGi` walks no material. Its numbers (`F2`, the first four distinct
  bank eyes of Hollowmere and Coldharbour, the harness's freeze): every eye moved, 627,166 to
  1,837,725 pixels, worst 38/255 to 135/255; two processes of the parent agree on 5 of 8
  eyes (Hollowmere's `ashwood` 9,646 pixels and `menu` 771 apart there); the bank 142 of
  143 byte-equal at high and off (`harrowmead-view-pistol-reload` within its flake) and at
  low (`sarab-alley` 5 pixels by 2/255, a frame X5.1a's first `gi=low` process drew on the
  same source). **Then the move** (e9a39d6): `render/GiCompute.ts` owns the five pipelines
  (asked at construction, "the irradiance volume" on `Game.roundPipelines`), the six
  buffers, the seven textures (one view each, the frame's `OwnTexture`s), their sampler, the
  bind groups, the history's clears and the retired resources (destroyed at the new
  `FrameHost.afterSubmit`, the engine's end of frame); `GiVolume` keeps its CPU half line for
  line (but for the readiness gate, which asks only our pipelines: its review) and ARMS a dispatch that `GiCompute`'s late prepare, pushed after `ProbeBake`'s,
  records (three compute passes on the host's prepare encoder); the converse is an ERROR
  (an armed dispatch unrecorded at the frame's end is dropped and thrown in a dev build,
  logged once in production — never seen in any run below); the cloud field the host's
  handle and sampler (row 2). The probe's arms (`__giGpu`, picked when `GiVolume.gpu`
  stands) and the harness's (`__refGiCount`, `GiCompute.recorded`, picked first); `gi.mjs`
  logs a sampler by `GPUSamplerDescriptor`'s own members (Babylon's cache hands the device
  `anisotropyEnabled`, which WebGPU ignores; the parent's log was re-taken with this probe).
  **Measured** (the Windows box, headless; the BEFOREs at 9b9d205 in the worktree):
  - **The bank**, all 143 rows by `exact.mjs`: high **143 byte-equal**; `--query=gi=off`
    **143 byte-equal**; `--query=gi=low` 142 byte-equal and `sarab-particles-dust` 4 pixels
    by 1/255 — a frame X5.1a's two full `gi=low` processes drew on the same source
    (06b9daa) and this run's BEFORE did not; Sarab alone at both ends under `gi=low`, two processes each (`exact.mjs`'s procedure): the parent drew BOTH of that row's frames (one a process) and so did the step, and each tree drew both of `sarab-alley`'s over its three processes — the cross-process residue `exact.mjs` names, `sarab-particles-dust` added to its header The same red rows against `ref/` at
    each tier (34, 135, 138), the lists identical. No thaw threw.
  - **The probe**, `gi.mjs` over the parent's log, a default boot and `--shafts-off`:
    **equal** — 914,601 values on Hollowmere and 254,721 on Coldharbour (914,595 and
    254,715 with the shafts off), every scenario's CPU half and dispatches by `Object.is`,
    every comparable readback byte for byte (the `serial` scenarios whole, colour lanes
    included; elsewhere the exact lanes; row 3) — once the fields named here are masked:
    `statics.late` 4 → 5; `statics.pipelines` (Babylon's 3, then 5 after the first
    `setQuality("low")`, synchronous, made on frames 9 and 2,504, against our 5 asynchronous
    at the boot — layout `"auto"` and entry `main` on all); `statics.wgsl` (Babylon's text
    19,056 / 14,243 / 13,615 characters behind `//#define main` and `//#define SHADER_NAME
    …`, ours 21,004 / 15,876 / 15,105 and no prefix — every module's tokens the source's,
    5,618 / 4,392 / 4,415); a default boot's `samplerSerial.unbound.sampler` and `.isHosts`
    (Babylon's repeat/nearest at anisotropy 1 and false, ours the host's and true); under
    `--shafts-off` `samplersFresh.trace` and `.same`, `samplerSerial.asFound` and
    `.restored` — and `statics.bindGroups.gi-trace`'s binding 5, which is the SAME sampler
    `samplersFresh.trace` reads off the same record (the plan's list missed it). Everything
    else in the statics equal: the seven's and the six's descriptors, the frame's sampler
    (repeat/clamp/repeat, linear x3, anisotropy 4), `frameViewIsProducers` true, every bind
    group entry.
  - **The live log** (a scratch script: Hollowmere's card, deploy and 240 frames playing, the
    tier set low, off and high in play through `Game.setSetting`, a teardown, a second round,
    a map change to Coldharbour and a round there, `F2` with a quay dragged 2 m and back and
    the tier changed in the editor, the round after it): **Babylon's `_computeDispatch`
    called 0 times and no synchronous compute pipeline made** (the parent: 3,375 and 5),
    ours recording 1,127 frames of the 1,400, **no WebGPU validation error**
    (`uncapturederror`), no page or console error. `gi.mjs`'s live half: dispatched on 19 of
    42 card frames, 63 of 64 deploy, 242 of 242 playing, 60 of 60 round-over, 120 of 120
    editor, **with no prepare of ours on 0**, every pass on the upload encoder, none ending a
    render pass; no Babylon bind of `gi-*` in the editor.
  - **Pipelines**: `pipelines.mjs coldharbour --round` five times, **0 of Babylon's at the
    install in 5 of 5 (X5.1a: 3, the volume's), none in play**, 21 of ours and 12 modules at
    the install (15 before: the volume's three modules are made at the boot now);
    `cinderhaven --round` and `sarab --round` 0 of Babylon's and 19 of ours at the install,
    none in play; plain `hollowmere` 71 of ours, 9 of Babylon's by the install and nothing in
    the sixteen seconds after it.
  - **The editor's frames** at the eight eyes of the picture change, two processes a tree:
    Coldharbour's `menu`, `curtain2` and `curtain40` and Hollowmere's `lanterns` byte-equal
    across the trees in all four pairings; `curtain90` 1-3 pixels by 1/255 (the parent
    against itself: 3); Hollowmere's `ashwood` and `menu` within the parent's own
    cross-process floor (31,845-102,989 pixels by 41-47/255 and 275-993 by 30-35, against
    79,451 by 47 and 768 by 35 between the parent's two); `wall40` moves between two grabs
    in ONE process on both trees and 1,433,398 pixels between the parent's two, so it is no
    oracle (the port's two runs drew one frame).
  - **`census --against`** (Hollowmere, Sarab, Cinderhaven, Kurenai): every row and total
    equal (331, 595, 619, 168).
  - **`?profile&gpu`** (the X5.1b captures in `docs/profiling.md`): `gi` 0.09-0.10 → 0.02-0.03
    ms, `render` within its spread, `gpu.frame` within 8%; no report version (the span kept
    its name and parent).
  - **Gates**: `gate` all seven maps clean; `shaders` every shader compiled clean on seven
    maps; typecheck, build (`check-babylon-free`, `check-proving`), corecheck and parity pass.
  - **Not verified**: a server's match in a browser; the phone; a lost device (not survived,
    as for every draw of ours, `FINDINGS.md` 64); `surfaces.mjs` (no Babylon draw moved);
    the converse's throw provoked on purpose (no state of the game reaches it).
  The note is in `plans/done/babylon_exit_landed.md`. **X5.1 is whole**: both sub-steps
  landed; its own Verify below is the owner's to mark.

  **Its review** (b22fda3; 2026-11-07; documents, comments, contract headers and the harness only, no
  change to the game) found nothing real and seven minor points, each checked against the
  tree before it was acted on. **Records**: `docs/rendering.md` no longer says an editor
  build's Babylon passes read the frame's compose (they hold GI `off` since 9b9d205), and
  `CLAUDE.md` says what `GiCompute`'s header says — an armed frame whose prepares never ran
  is dropped and thrown in a dev build, logged once in production. **An older claim**, "an
  editor build prepares NO frame of ours" (`docs/rendering.md`'s bodies' map and bodies,
  `BodyShadowMap`'s header and its `asks`, `BodyShadows`' comment): X5.1a counted our
  prepares on 120 of 120 editor frames (`Renderer.begin` runs them whenever a draw of ours is
  active), so `BodyShadowMap`'s clear-at-once branch is unreachable there — `prepare` zeroes
  `asks` each frame and the editor asks once a frame (`updateEditor`) — and its owed clear
  lands on the next frame, as in a round. **"Line for line" stated accurately**: the
  readiness gate (`GiCompute.isReady`) asks only the five pipelines, where Babylon's
  `ComputeShader.isReady()` also waited for every texture bound to it, the cloud field among
  them; a cloud field not yet ready would now arm and advance a slice nothing records (said
  once) — unreachable today, both candidates (`Sky.cloudShadowMap`, `ShadowBindings`' no-cloud
  texel) being `RawTexture`s built from data; `GiVolume`'s and `GiCompute`'s headers and
  `FILES.md` say so. **The converse's throw recorded as what it is**: never provoked, and
  thrown inside `onEndFrameObservable` (`afterSubmit`), whose `notifyObservers` catches
  nothing — it leaves `endFrame` before `_renderLoop` queues the next frame, so a dev build's
  render loop stops, the end-of-frame observers after it are skipped and the retired
  resources stay undestroyed, the CPU half having already advanced: the brief's "fail
  loudly" branch (`GiCompute`'s header). X5.4's list no longer says nothing of Babylon's
  samples the cloud field (`Volumetrics` binds it until X5.2, an editor build's materials
  until X5.3). `FILES.md`'s `GiVolume` and `GiCompute` lines made accurate, and
  `FINDINGS.md` 16's `GiVolume` bullet DELETED rather than marked settled (its numbers are
  this entry's and the note's; the entry's status says one thing is left). **The
  instrument**: the harness's arm for ours trusted `GiCompute.recorded` whenever it was a
  number, so a `recorded` that stopped counting would have held every freeze vacuously — the
  hole X5.1a's review closed for Babylon's arm. It now counts the volume's passes a second
  way, `GPUComputePassEncoder`'s `setPipeline`/`dispatchWorkgroups` wrapped once and a
  dispatch counted when its pipeline is one of `GiCompute`'s own, and throws unless trace,
  compose and vis each moved exactly as far as `recorded` since its first call. **Watch**:
  `sarab-particles-dust` is the THIRD Sarab row in the `gi=low` cross-process residue class
  (after `sarab-ground` and `sarab-alley`), the reviewer's observation. **Measured**: a hand
  test (scratch `x51b-review/live-count.mjs`, a Hollowmere round) — three freeze/thaw cycles
  pass with the count live (204 frames recorded, 204 of each pass); `recorded` stubbed to a
  constant fails the next freeze ("moved 204 ... dispatched 296 ... not live"); the volume
  let run ten frames under the hold with `recorded` stubbed fails the thaw ("moved 0 ...
  dispatched 10"), where the parent's harness passed it with no error, and with `recorded`
  live fails it on the old message ("dispatched 10 times while its update was stubbed");
  `gi.mjs` against X5.1b's AFTER log equal (914,611 values on Hollowmere, 254,731 on
  Coldharbour), no page or console error; `bank.mjs hollowmere --check --keep` against
  X5.1b's kept AFTER by `exact.mjs`, 16 of 16 byte-equal, the same two rows red against
  `ref/` (`menu`, `ashwood`) at the same means; typecheck and build pass.
- **Every sub-step owes**: **a BYTE comparison of every row against a BEFORE at its parent**
  (`exact.mjs` over two `--check --keep` directories, never `--check`'s pass line), the known
  flakes alone excused, and from X5.1b on the same under `--query=gi=low` and
  `--query=gi=off`; its pipelines on `Game.roundPipelines`; `pipelines.mjs coldharbour
  --round`; typecheck, build (`check-babylon-free`, `check-proving`), corecheck and parity;
  `gate` and `shaders` once code moves; each new module's contract header and `FILES.md`
  line (rules 7 and 9); and **STOP with the numbers** wherever the bytes do not hold.
- **Verify, the whole step:** the bank; GI on and off at each tier; a lamp switching on
  reaching the bounce within one sweep (X5.1a: the first bounce in place in one sweep, 91-95%
  of the eventual change, the rest the multi-bounce iteration's: 99% by two); no Babylon
  compute in a round or an editor build.

### X5.2 — The post chain — **M–L, as five sub-steps** (split 2026-11-07: the owner instructed that steps be implemented in sub-steps, each implemented, reviewed and fixed by agents; the split below was proposed by the orchestrating session from a planning agent's read at 33a8d35, and its two shaping decisions taken by the owner the same day, its seven others the next, rows in "Decisions that are yours") — X5.2a **LANDED** (e5d9390, its review 55ef32c, its held finding F1 fixed 738f5e3), X5.2b **LANDED** (f697f0e, its review e5ab075), X5.2c1 **LANDED** (4747fe7, its review bfa6a6b); X5.2c2, X5.2d not started

`FrameDepth`, `CelInk` with the glow's compose in its last line, the glow's
blur, FXAA (already our own fragment), `Volumetrics`, `MotionBlur` and
`PaperGrain` drawn by our renderer, and the chain correct at every render
scale. The chain's order becomes explicit, so the slot-claiming tricks `Game`
uses today (attach, then detach, to hold a place in an append-only list) go
away. **Two things this entry first named are not X5.2's**, by the owner's
decision of 2026-11-07: **the glow's MASK** stays Babylon's through X5.2 and
moves with the main pass (row "X5.2, the mask"), and **render scale's
setter** is X5.4's with the canvas (row "X5.2, render scale", decided
2026-11-08) — X5.2 owes only a chain correct at every scale.

- **Keep the door open for the GPU side** (deferred until after the exit;
  "What this plan does not do"). The full-screen passes after `CelInk`
  (FXAA, the volumetrics, the blur, the grain) are written so that two
  neighbours can later be FUSED into one pass reading the same input, rather
  than each one hard-wired to read and write a target of its own. On a
  phone every full-screen pass is a whole frame's reads and writes, and the
  `gpu.mainPass` lead in `FINDINGS.md` 52 points here. Fusing them is not
  this step: this step only must not make it a rewrite. **What keeps it open
  is the HOST, not the shaders** (the planning read): an ordered stage list
  (ink, FXAA, shafts, blur, grain), each stage declaring its program as
  compiled, its uniform block and extra bindings, **the sampler it reads its
  input with** (the consumer's property, never the target's), `active()` (its
  setting), and whether it reads its input **point-wise** (the ink, the
  shafts) or across a neighbourhood (FXAA, the blur, the grain's aberration);
  and one pass owner opening a pass per active stage in list order from a
  target pool, the last active stage given the canvas. **Nothing may
  hard-wire** a stage owning its output texture, a stage knowing it is last
  or that it writes the canvas, `Game` holding a slot or an index, a stage
  naming "the frame" rather than "my input", or a stage being exactly one
  pass (in a span or a timer). **The shaders are ported AS COMPILED**, never
  rewritten as composable functions now: a fusion drops the 8-bit rounding
  between two passes (as the glow's compose fold did, `GlowPass.ts`'s
  header), so it is never byte-exact and is a later `Picture change:`. Only a
  point-wise consumer can fold into its producer — FXAA into the shafts, the
  ink into the shafts with FXAA off; the blur cannot fold into the shafts (it
  comes after them), and the grain folds into nothing while it has its
  aberration.

**How our post passes record — shape (A), decided by the owner 2026-11-07**
(row "X5.2, the shape"). Our renderer records in two places today: the upload
encoder (seam item 9), submitted BEFORE Babylon's main pass, and passes
Babylon opens (items 2 to 5). Every post pass reads the main pass's output, so
it cannot be on the upload encoder; there is no public way onto Babylon's
render encoder (`flushFramebuffer` is `@internal`); and a new seam item is
rule 4 broken. So until X5.4 **our post passes are OUR DRAWS in passes BABYLON
OPENS, into targets BABYLON OWNS** — the glow mask's precedent: a Babylon-side
owner binds each stage's target with public API (`engine.bindFramebuffer`,
`clear`, `unBindFramebuffer`, `restoreDefaultFramebuffer`) and announces that
stage open, and our renderer queues the stage's draw into it as
`Renderer.glowMaskOpened` does. The canvas stays Babylon's main pass;
`gpu.frame` and `gpu.mainPass` keep their meaning (no report version); the
seam gains no item. **X5.4's Do gains "the post passes' targets and passes"**
— the sequencer is swapped for our own encoder there. Two consequences fix
the order: while Babylon runs any of the chain, ours can only take over a
**SUFFIX** of it (Babylon's FXAA, blur and grain each read their own
`inputTexture`, and ours cannot run between two of Babylon's), so the chain
moves **TAIL FIRST, INK LAST**; and the one exception is the glow's blur,
which already binds its own targets, a draw swap with no change to the pass
structure, so it moves first.

**THE ONE RULE FOR EVERY SUB-STEP** (X4.7's and X5.1's, carried verbatim):
**where a byte-exact port is not reached, STOP and report to the owner with
the numbers** — the rows that moved, their pixels and worst value, what was
tried and what each attempt moved. Do not choose a draw point, a blend, a
sort, a sampler, a clear, a target format or a vertex path that "holds the
rows", and do not land a workaround as "no change to the picture". **A brief
from an orchestrating agent that reads otherwise is wrong, and this paragraph
wins.** No sub-step is meant to change the picture; a difference goes in a
commit of its own whose subject starts `Picture change:`, only by the owner's
decision, with the bank's numbers (rule 2). **No sub-step adds a seam item.**

**What it is today** (a read of the code, Babylon 9.28, by a planning agent at
33a8d35; **X5.2a measured it** with `plans/webgpu-ref/post.mjs` at b00b887 — the
desktop page, 1920x1080 at 1, and a phone's, 832x384 at 2.8125, sixteen scenarios
each, read off the device pass by pass — and corrected it in place, each correction
marked "X5.2a"):

- **The order on the camera's list, and how it is held.** `CelInk` is built
  with the camera and attaches itself first (`Game.ts` ~2169).
  `DefaultRenderingPipeline`, FXAA alone, is detached (its index nulled) and
  re-attached (appended), which is `fxaaSlot` (~2180-2196). The shafts' slot is
  claimed by attaching and at once detaching (~2219-2227), and
  `syncVolumetrics` refills it by an indexed attach once `vol.ready`
  (~3990-4021). `MotionBlur` (~2237) and `PaperGrain` (~2244) attach
  themselves. The blur's toggle detaches the grade, appends the blur and
  re-appends the grade (~4060-4072, `PaperGrain.ts` ~465-475). Babylon's
  detach nulls an entry and an indexed attach refills a null
  (`camera.pure.js` 619-655); `_getActivePostProcesses` skips nulls
  (`postProcessManager.js` 46-56), so holes accumulate, bounded by settings
  clicks. The indices (0, 1→2, 3, 4, 5) are inferred, not logged. **X5.2a, logged
  (`chain.list`)**: at boot the list is `[0 ink, 1 hole, 2 fxaa, 3 shafts, 4 blur,
  5 grain]` — FXAA's first slot is the HOLE at 1, its live slot 2 (`fxaaSlot`), the
  shafts' 3 (`volumetricsSlot`) — on both pages; the shafts off leave 3 a hole, FXAA
  off leaves 2 one; and the holes GROW with the blur-and-grade dance: after the
  sixteen scenarios' toggles (the blur off and on, the grain off and on) the list is
  eleven entries, `[ink _ fxaa shafts _ _ _ _ _ blur grain]`, the blur at 9 and the
  grain at 10. The draws are the same either way (Babylon skips a null).
- **Every Babylon `PostProcess` alike.** Babylon's QUAD — `(1,1) (-1,1)
  (-1,-1) (1,-1)`, indices `0,1,2,0,2,3`, `drawElementsType(0, 0, 6)` — and its
  `postprocess` vertex stage, `vUV = (pos × 0.5 + 0.5) × scale`, the processor
  appending the y-flip (a texture target drawn flipped, the canvas not). Each
  pass owns its own INPUT texture (`getRenderWidth(true) × 1 | 0`,
  UNSIGNED_BYTE so `rgba8unorm`, not reusable, so no ping-pong); only the first
  live pass gets depth. Each input is sampled with that pass's
  `renderTargetSamplingMode`, **NEAREST by default**, FXAA's BILINEAR; each is
  cleared to `scene.clearColor` at `activate`; `apply` turns depth off, sets the
  alpha mode and binds `textureSampler` to the pass's own input. Every
  pipeline is Babylon's, compiled at boot (`docs/states.md`: the post chain's
  six on the frames before the card), none on `Game.roundPipelines`. No pass
  uses a seam item; `FrameDepth` reaches an internal outside the seam.
  **X5.2a, off the device** (every pass and draw below, both pages): the quad is
  exactly as read — one `float32x2` attribute at stride 8, its bytes `(1,1) (-1,1)
  (-1,-1) (1,-1)`, `uint16` indices `0,1,2,0,2,3`, `drawIndexed(6, 1, 0, 0, 0)`,
  triangle-list, cull none, ccw, no blend, write mask 15, an explicit layout (group 0
  EMPTY, every binding in group 1), the viewport the target's size and no scissor.
  The vertex text is `vUV = (position × 0.5 + 0.5) × scale` then
  `position.y *= internals.yFactor_`, and `Internals` is an 8-byte uniform of its own
  (`yFactor_` -1 into a texture and +1 into the canvas, then `textureOutputHeight_`);
  **FXAA's vertex stage multiplies by no `scale`**; and **the vertex module carries
  the pass's whole `LeftOver` struct** (the ink's vertex text declares all of the
  ink's uniforms), so a pass's vertex TEXT is a function of its fragment's uniforms
  and each pass has a vertex module of its own (twelve modules for the six stages'
  first variants). Each pass's colour target is `rgba8unorm`, usage 23 (copy src,
  copy dst, binding, attachment), the render size, loaded `clear` to the scene's
  clear colour (Hollowmere's `[0.0314, 0.0510, 0.0863, 1]`) and stored; **only the
  frame** (the ink's input, the scene's draws) has a depth attachment, `depth32float`
  cleared to 1, and no intermediate pass has one. The SAMPLERS as bound: the ink's,
  the shafts', the blur's and the grain's inputs nearest/nearest/nearest, clamp,
  lod 0..0, anisotropy 1; FXAA's input linear/linear, mip nearest, lod 0..0,
  anisotropy 1; the ink's mask and the two glow targets linear/linear/linear, clamp,
  lod 0..32, **anisotropy 4**; the shafts' two shadow maps (`r16float`, 2048 and
  1024) nearest like their input, the cloud field (`rg8unorm` 256) linear with
  anisotropy 4. The depth is read by `textureLoad` (`texture_depth_2d`, no
  sampler). Every RTT pass's pipeline has NO depth-stencil state. **The CANVAS's pass
  is not like the others**: it carries the ENGINE's own depth (`depth32float`, the
  render size, no `COPY_SRC`; `canvas.depth` in the log), not the frame's, loaded
  and stored, and its pipeline has `depth32float`, `depthWriteEnabled` TRUE and
  compare `always`, so the last pass WRITES the quad's depth into it every frame —
  and the frame OPENS with a canvas pass of no draws that loads the colour
  (`scene.autoClear` false) and clears that depth to 1 (`autoClearDepthAndStencil`
  true). The canvas is `bgra8unorm`, premultiplied, usage 17 (attachment and copy
  src), the device's preferred format. The uniform blocks: the ink 112 bytes, FXAA
  16, the shafts 320, the blur 112, the grain 496, a glow blur and the box filter 16,
  each beside the 8 of `Internals`. **The pipelines** (Babylon's
  `createRenderPipeline`, synchronous; **corrected by X5.2a's review**, which read
  the four live logs again and ran the in-play changes on a fresh page, eight boots
  in all): the chain first draws on the page's THIRD to FIFTH frame (in the menu or
  the first `loading` frame) — the frames before it draw only canvas passes — and
  each stage's pipeline is stamped on that frame or on the one before it (a frame
  with no pass of the chain recorded; the probe does not say what made it there).
  **A pass IS skipped for a compile, and not rarely**: on the phone's page FXAA's
  pipeline comes one or two frames after the rest in all four phone boots, and in
  two of them the chain's first frames ran with FXAA's pass drawing NOTHING
  (`->fxaa.out/clear`: its target cleared and handed on as the shafts' input),
  for one frame and for two; and one desktop shafts rung change in play
  (`postA2`) drew nothing in the shafts' pass on the frame of the change, its
  pipeline made on the next. On a fresh page (nothing drawn at those settings
  yet, so the glow blur's kernel text new each time) a render-scale change to
  0.75 makes the glow blur's new pipeline on the first frame the chain draws after
  it (the one after the canvas-only frame below) and draws it there, a glow rung
  change to `low` makes the blur's and the box filter's on the first frame after
  it and draws them there, and a shafts rung change
  (`low`, then `high`) makes each rung's on its frame and draws it there —
  nothing skipped on either page, one run; the scenarios' page could not show
  these, having drawn every kernel and rung first. **A render-scale change and a
  resize each cost ONE frame with nothing in it but the canvas's opening pass** —
  no scene, no mask, no glow, no chain — and the next frame is whole (both pages,
  every log, the resize on the desktop's; the phone's fresh page, booting at its
  device default of 0.5, showed the same frame going to 1).
- **`FrameDepth`** captures `engine._currentRenderTarget._depthStencilTexture`
  at `onAfterDrawPhase` (an internal, the seam header's "not here" list) and
  wraps it in a `ThinTexture`; the ink, the shafts, the blur and the grain read
  it by `textureLoad` (`texture_depth_2d`, no sampler); it relies on
  `GlowPass` rebinding the frame; `depth32float`, one sample. **X5.2a**: it is the
  frame's depth (`frame.depth`, the ink's input's own attachment) on every scenario,
  the render size, `depth32float`, one sample, usage 23.
- **`CelInk`** is our WGSL in Babylon's dialect, which the processor rewrites
  into structs and bindings. It reads the frame at `vUV` (alpha the coverage,
  `edge *= 1 - a`), the depth, the mask and `glowNear`/`glowWide` (the glow's
  compose spliced into its last line), writes alpha 1, takes eleven uniforms and
  `glowIntensity` a frame and the fog band at an environment change. **Its input
  IS the frame the scene draws into**; it is never detached. **X5.2a**: its bind
  group is the frame (binding 0), the frame's depth (1), the mask (2), `glowNear` (3)
  and `glowWide` (4), then four samplers (5 the frame's, nearest; 6 to 8 the mask's
  and the glow's, linear with anisotropy 4), `Internals` (9) and its 112-byte block
  (10); the frame's clear (`clear` to the scene's clear colour, depth to 1) is
  Babylon's `PostProcess.activate` of the ink's own input. With every tail pass off
  the ink IS the canvas's pass, and takes the canvas pass's depth state above.
- **`GlowPass`**: the MASK is a Babylon render target (`rgba8`, the frame's
  depth shared, bilinear clamp) whose clear observer opens our draws (items 2 to
  5) and whose after-render closes them, its Babylon list being the active
  meshes (none in a round, every emissive in an editor build). The BLUR is four
  `ThinBlurPostProcess` (Babylon's built-in `kernelBlur`) and a `glowDown`
  `EffectWrapper` (our fragment, Babylon's vertex) drawn by `EffectRenderer`
  into `rgba16float` targets **GlowPass binds itself**. The blur's shader TEXT
  depends on its kernel (`56 / (downsample × level)`, rounded by
  `_nearestBestKernel`, weights baked as `#define`s) and its tap split on the
  device's `maxInterStageShaderVariables`, so a render-scale, DPR or glow-rung
  change recompiles, and the pass is skipped while it compiles. **X5.2a**: the
  mask is cleared `[0, 0, 0, 1]` and LOADS the frame's depth; the glow's own passes
  (`glowDown` on `low`, then the four blurs into `glow.nearH`, `glow.near`,
  `glow.wideH`, `glow.wide`) LOAD their colour — no clear — with the viewport set to
  the target and no depth attachment, each target `rgba16float`, and each reads its
  source linear/linear/linear, clamp, lod 0..32, anisotropy 4. The four blurs are
  ONE program (Babylon's effect cache hands all four the same effect; the direction
  is a uniform), its text the kernel's: Babylon's `kernel` was 28, 21 and 14 at
  render scale 1, 0.75 and 0.5 on `high` and 14, 10.5 and 7 on `low` (the desktop),
  and 78.75, 59.06 and 39.38 on `high`, 39.38, 29.53 and 19.69 on `low` (the phone,
  whose scaling level is 0.356, 0.474 and 0.711) — five distinct texts a page, ten
  modules with their vertex stages, the kernel's offsets and weights inlined as
  constants. **X5.2b, corrected**: each of the four binds a `LeftOver` buffer of its
  OWN holding its own `delta` (Babylon's owner-keyed slots, one per draw context) — the
  probe's log named one buffer holding the wide pass's `delta` for all four, having kept a
  bind group's buffer binding by reference where Babylon rewrites the object for its next
  group (fixed; the parent's log re-taken). **Not the glow's alone** (X5.2b's review,
  `--compare` of the re-taken log against X5.2a's): 4 of the 52 paths a page that moved are
  not the glow's — the ink's `Internals` (`passes[7]`, binding 9) and the motion blur's
  (`passes[10]`, binding 3), in `damage` and `base-again`, on both pages, logged as +1
  (`0000803f`) where -1 (`000080bf`) is bound; those stages are X5.2c2's (the motion blur)
  and X5.2d's (the ink), which read the re-taken log. The device's `maxInterStageShaderVariables` is 16 here. The targets
  are floored as read: the desktop at 0.75 is `glow.near` 720x405 and `glow.wide`
  360x202, the phone at 1 is 1170x540 and 585x270, at 0.75 877x405 and 438x202, and
  `low`'s `glow.down` is the near size (`1x1` on `high`).
- **FXAA**: only the FRAGMENT is ours (`Fxaa.ts`); the vertex stage (eight
  sample-coordinate varyings, `texelSize`) and the pass are Babylon's.
  `DefaultRenderingPipeline` sets `scene.autoClear = false` and puts it back on
  dispose. **The "Mali driver" arm is dead under WebGPU**: `WebGPUEngine`'s
  driver info is the empty string, so the claims at `Game.ts` ~4030 and
  `Fxaa.ts` ~39-42 (and `FINDINGS.md` 5's phone statement) are wrong — read,
  not run on a Mali; corrected by the sub-step that moves FXAA. **X5.2a, measured
  on this box**: `engine.extractDriverInfo()`, what Babylon's
  `ThinFXAAPostProcess._GetDefines` tests for "mali", is the empty string under
  WebGPU (still not run on a Mali). FXAA's vertex stage writes `vUV` and the eight
  sample coordinates, nine inter-stage variables; its own block is 16 bytes
  (`texelSize`); it binds its input and one sampler.
- **`Volumetrics`**: one shader per rung (`SAMPLES` 8, 16, 32), a rung change a
  rebuild; reads the depth, the world and body shadow maps (ours, wrapped; or
  `litShadowTexture`; or an editor build's generator maps; nearest clamp) and
  Sky's cloud field — **Babylon's last reader of the cloud field in a round**
  (X5.1a); its `hash(vUV × dims)` jitter and dither are bit-sensitive to `vUV`;
  it attaches only once all four inputs exist, so the first frame has no shafts.
  **X5.2a**: the pass drew on the chain's first frame on both pages (its four
  inputs already stood); its group is its input (0), the frame's depth (1), the
  world's and the bodies' shadow maps (2, 3: `r16float` 2048 and 1024 on `high`
  shadows), the cloud field (4, `rg8unorm` 256), their four samplers (5 to 7
  nearest, 8 the cloud field's linear with anisotropy 4), `Internals` and a
  320-byte block. Each rung is its own fragment module; the vertex module is one.
- **`MotionBlur`**: rotation only; its history is the CPU's previous camera
  basis (from the aim and `dt`), not a texture; its `mat3x3f` repacked into vec4
  columns; the depth sets the weapon band; a `hash(vUV)` jitter; a straight copy
  at rest; reset at teleports. **X5.2a**: at rest its output is byte-equal to its
  input (`blur.out` and `shafts.out` hash the same), but two of its uniforms are not
  a function of the frame: `maxShift` is the config's rate times the `dt` of the last
  `update` — the machine's frame time, 0.01896 against 0.0192 in two processes —
  and `reproject` is left as the last rotation it was handed ("deliberately
  stale" while the strength is 0), so the bytes a held blur is handed depend on the
  frames before it. `freeze` now shows it the aim once at 1/60 s at rest
  (`harness.mjs`), which pins the first; the second is a function of the row
  sequence, as a row's frame is.
- **`PaperGrain`** IS the canvas pass; its aberration reads the input at
  `uv ± offset`, so it is NOT point-wise; the depth gives position;
  `dpdx`/`dpdy`, a `cellOffset` `array<vec4f, 24>` computed in float64; the
  grade set per map, the damage flash decaying in `update`. **It has no clock**:
  the harness's `g.post.time = 0` is a stale no-op (**X5.2a**: removed; `freeze`
  holds the grade, the shafts and the blur through one adapter, `postAdapter`, and
  raises the flash for a `damage` row under the held decay). **X5.2a**: its block is
  496 bytes; it binds its input (nearest), the frame's depth and `Internals`; it is
  the canvas pass with the canvas pass's depth state above. **X5.2c1**: ours since
  (`render/PostChain.ts`); its block is `scale` (1, 1) first — the `postprocess`
  vertex stage's — then `cellOffset` at byte 16, the basis at 400, 416 and 432,
  `tanHalfFov` 448, `nearFar` 456 and the six scalars from 464 (`wgsl/paperGrain.ts`'
  `PAPER_GRAIN_BLOCK`); its input's sampler is nearest x3, clamp, clamp, REPEAT,
  lod 0..0, anisotropy 1; and the processor rewrote its `dpdy` as
  `(-internals.yFactor_)*dpdy`.
- **`camera.outputRenderTarget`** (**X5.2c1**, read in `scene.pure.js` 4007-4087 and
  4185-4190; the list completed by X5.2c1's review): Babylon reads it at THREE points of a
  frame that move a pass, not one — as `Scene.render`
  binds the frame's first target and runs `_clearFrameBuffer` (set, it binds the output
  target and clears it only under `scene.autoClear`, so the canvas's opening pass, which
  clears `canvas.depth`, is never recorded), as `_renderForCamera` sets
  `currentRenderPassId` (the output target's own id, which keys every Babylon draw's
  wrapper), and as `_finalizeFrame` binds its last pass's target — with
  `bindFramebuffer` and NO clear, where `PostProcess.activate` clears a pass's input to
  the scene's clear colour. **It reads it at five more, all inert under X5.2c1's
  window**: `_renderFrame`'s `Scene._checkCameraRenderTarget` (4318-4330, as the frame
  starts: set, it resets the target's `_cleared`, the gate on `_clearFrameBuffer`'s
  COLOUR clear, `!rtt._cleared`); the camera loop's `_processSubCameras(activeCamera,
  !!activeCamera.outputRenderTarget)` (4601: set, `_renderForCamera` binds the target
  and runs `_clearFrameBuffer` a second time); `_renderForCamera`'s multiview branch
  (4072-4082, under `camera._renderingMultiview` alone); and the two MULTIVIEW tests,
  `materialHelper.functions.js` 1132 and `shaderMaterial.pure.js` 532 (a target of more
  than one view). The first two and the branch read it before the window opens (null,
  and the branch wants a multiview camera besides); the material tests are false of a
  target of one view, whenever they read it (`RenderTargetTexture.getViewCount()` is 1).
  X5.2c1 sets it
  only across the post phase and clears the target in its pass (its entry); **X5.2d's
  "the scene draws straight into the frame's render target (`outputRenderTarget` with
  depth)" meets the first two points and the two frame-start reads**: the canvas's
  opening pass and the render pass id move with it, `_checkCameraRenderTarget` re-arms
  `_cleared` every frame and the camera's render binds the target again, so under
  `scene.autoClear` (true from X5.2c2) the scene's colour clear lands on that target once
  a frame — at the first bind, the second held off by `!rtt._cleared` — and its depth and
  stencil clear at both.
- **Render scale** is `engine.setHardwareScalingLevel(1 / (dpr × renderScale))`
  (`Game.ts` ~3836-3839), which moves every target's size and the blur's kernel.
  **X5.2a**: the levels measured are 1, 1.333 and 2 on the desktop (render sizes
  1920x1080, 1440x810, 960x540) and 0.356, 0.474 and 0.711 on the phone (2340x1080,
  1755x810, 1170x540); every chain target follows the render size exactly.
- **Per state**: the chain runs every frame in every state — the menu under the
  photograph, the kit screen, the editor. `post.update`, `syncVolumetrics` and
  `motionBlur.update` run in `tick`'s `post` span; the recording sits inside
  `render`, unnamed. **X5.2a** (corrected by its review): not from the page's
  first frame — the first two to four draw only canvas passes, and the chain (with
  the scene and the mask) draws from the third to the fifth, in the menu or the
  first `loading` frame, on the phone's page sometimes with FXAA's pass drawing
  nothing for a frame or two (above) — and on the frame after a render-scale
  change or a resize it draws nothing at all (above).
  `scene.imageProcessingConfiguration` is off throughout (`isEnabled` and
  `applyByPostProcess` false, exposure and contrast 1, tone mapping, vignette, colour
  curves, grading and dithering off); `scene.autoClear` is false and
  `autoClearDepthAndStencil` true in every scenario (`DefaultRenderingPipeline` stands
  throughout); the scene's clear colour is the map's.

**The sub-steps**, least risk first. Each one's Verify includes "Every sub-step
owes" below.

- **X5.2a — the instruments see the chain** (no change to the game). The bank
  cannot see what the moves would change: every row is 1920×1080 at scaling
  level 1 (so the blur's kernel text, odd target sizes and floored glow targets
  are unseen), at DPR 1, with no damage flash, one blur row at `dt` 1/60, no row
  with every tail pass off, no frame before readiness, no resize or rung change
  in play, and none of the intermediate targets, samplers, pipeline descriptors
  or processed WGSL. **Do:** a probe in `gi.mjs`'s style, through one adapter
  with Babylon's arm now and ours later, logging per pass the module's processed
  text and tokens, the pipeline descriptor (vertex layout, index format, cull
  and front face, the pass's depth format, blend, write mask), the bind-group
  entries with their **sampler descriptors**, the uniform bytes, the render-pass
  descriptor (load ops, clear values, attachments), and a read-back hash of
  every pass's output and of the canvas, at 1920×1080 and at 832×384 × 2.8125,
  render scales 0.5, 0.75 and 1, both glow rungs and every volumetric rung;
  rows appended by `--rows` — `post-scale50`, `post-scale75` (proven
  byte-stable across processes, or graded by the probe's canvas read-back),
  `post-damage`, `post-alloff`; `freeze`'s post, shafts and blur calls through
  one adapter and the stale `g.post.time` removed; `scene.imageProcessingConfiguration`
  and `scene.autoClear` logged; and "What it is today" above measured and
  corrected in place. **Verify:** the probe equal to itself across two
  processes and failing on hand-edited copies; the new rows byte-stable; every
  old row byte-equal to a BEFORE at the parent.

  **X5.2a LANDED** (e5d9390; 2026-11-08; no change to the game: a new probe, the
  harness's post path through one adapter, four rows, docs; nothing under `src/` but the
  rows and their `damage` field in `bench/vantages.ts`). **The probe**,
  `plans/webgpu-ref/post.mjs` (its header is its contract): Hollowmere at `lanterns`'
  eye, each scenario shot as `bank.mjs` shoots a row (`placeVantage`, readiness, every
  stage's effect ready, the settle, `freeze`), at two pages — `desk` 1920x1080 at 1 and
  `phone` 832x384 at 2.8125 (`bootMap` gained `viewport` and `deviceScaleFactor`) —
  through sixteen scenarios a page (render scale 1, 0.75 and 0.5 at both glow rungs,
  shafts off, low and high, FXAA, the blur and the grain each off, all four off, the blur
  in flight, the damage flash, the base again); two consecutive frames captured, the
  second logged and checked equal to the first. Read off the device from the page's first
  line: every render pass in submit order (role, label, attachments and their targets'
  formats, sizes and usage, load and store ops, clear values) and a SHA-256 of every
  colour target as its pass left it (a copy recorded on the pass's own encoder after its
  `end`; depth for a named target with `COPY_SRC`), and for every draw a named stage made
  the pipeline (modules by tokens, entry points, vertex layout, topology, cull, front face,
  depth-stencil, targets' formats, blend and write mask, multisample, the layout entry by
  entry), the bind groups (samplers by descriptor, views by target, uniform buffers by
  their BYTES as the queue held them at the submit — bundles resolved where the pass runs
  them), the vertex and index bytes, the viewport, scissor and draw call; beside each
  frame the camera's list with its holes, each pass's fields, the glow's rung, kernel and
  targets, the scaling level, `scene.autoClear`, `autoClearDepthAndStencil`, the clear
  colour and `scene.imageProcessingConfiguration`; once a page the device's limits, the
  canvas's configuration, the driver info Babylon's FXAA tests and every module's
  processed text and tokens. **One adapter names everything** (`window.__postGpu`:
  `refresh`, `stage(module)`, `target(texture)`, `chain()`; Babylon's arm today, ours
  added per stage by the sub-step that moves it, under the same names — targets named by
  what WRITES them, `frame`, `<stage>.out`, `canvas`, the glow's six; since its review the
  shafts' inputs too). The LIVE frames (boot, a shafts rung change, a render-scale change,
  a glow rung change, a resize; since its review the changes on a second, fresh page) are
  printed and not compared. **The harness**: `freeze`, `thaw` and `placeVantage` reach the
  grade, the shafts and the blur through one adapter (`postAdapter`, `window.__refPost`,
  Babylon's arm), each stashed with the object it came off; the stale `g.post.time = 0` is
  gone; `freeze` takes `damage` (the flash raised under the held decay; `placeVantage`
  puts it out); and **the probe found one more thing that moved by itself in a held
  world**: the motion blur's `maxShift` uniform, the config's rate times the `dt` of its
  last real `update` (0.01896 against 0.0192 in two processes), so `freeze` now shows the
  pass the aim once at 1/60 s at rest — no pixel moves (the pass is a copy at rest; 502 of
  502 readbacks equal with and without it, and the bank below). **The rows**, appended by
  `--rows` at the end of Hollowmere's list at `lanterns`' eye: `post-scale50`,
  `post-scale75`, `post-damage` (the vantage table's new `damage` field), `post-alloff`.
  **Measured**: every correction above marked X5.2a. **Verify**: the probe equal to
  itself across two processes (`--against`: 34,083 values a page counted in the process,
  absent fields included — 31,701 off the written log, which both modes count since its
  review — every scenario steady), and FAILING on copies of its log with a sampler's filter, a uniform
  byte, a load op, the canvas's hash, a module's token count, a vertex stride and a hole
  in the camera's list each changed by hand; the four new rows banked in one process and
  byte-equal to it in two more (`--check`: 0 pixels; `exact.mjs` over the two `--keep`
  directories: Hollowmere's 20 rows byte-equal); the bank, 143 old rows against a BEFORE
  at b00b887 (`--check --keep`, the parent's harness) by `exact.mjs`: 142 byte-equal and
  `sarab-shelf` within its flake (1 pixel by 1/255), the four new rows named `--new`; the
  same 34 stale rows red against `ref/` on both sides; typecheck, build
  (`check-babylon-free`, `check-proving`), corecheck, parity, `gate` and `shaders`
  pass. Not run, the step moving no draw: `pipelines.mjs`, `surfaces.mjs`, `census`, the
  editor's frames, the live toggles by hand and `?profile&gpu` (the probe's live half
  covers the toggles and the resize). The note is in `plans/done/babylon_exit_landed.md`.

  **Its review** (55ef32c; 2026-11-08; instruments and records only, no change to the game; under
  `src/` one comment) found two real points and five minor ones, each checked against the
  code and the logs first; a third real point (F1: `harness.mjs`'s `thaw` leaving a rebuilt
  `Volumetrics` stubbed) was **held for the owner's decision**, fixing it moving bank rows, and
  the harness's freeze and thaw were untouched (F1 is fixed since: below). **Real**: the record said no pass was skipped
  for a compile, and the probe's own logs showed two (the phone's FXAA at boot, a desktop
  shafts rung change), while the live render-scale and glow changes ran where every kernel
  was already cached — the live half's changes now run on a second, fresh page, the record
  above is corrected from the rerun (nothing skipped in play there; FXAA's pass empty for two
  boot frames on the phone's first page), and the live print counts pipelines from the
  frames' own `+0` and lists the drawless chain passes; and `--against` stopped at a
  scenario's first difference, with `chain` (Babylon's fields, which X5.2b and X5.2c1 move by
  design) walked first, so it could never show the draw-for-draw comparison the adapter
  exists for, and cut values at 120 characters — it now names every differing path
  (`--max-diffs`), shows a long value from its first differing character (the byte, for
  hex), and excuses only what `--ignore` names by path pattern, saying which pattern matched
  nothing. **Minor**: X5.2c1's correction says the depth is the engine's, not the frame's;
  the adapter names the shafts' shadow maps and the cloud field (`shadow.world`,
  `shadow.bodies`, `cloud.field`), so X5.2c2's swap is compared by name; the two
  `postAdapter`s point to each other; the header's time agrees with the README;
  `BenchScript.ts`'s comment counts ten rows. **Measured**: `--compare` of X5.2a's two logs
  equal (31,701 values a page; its 34,083 counted absent fields); the seven hand-edited
  copies fail, and one copy with all seven plus a kernel and a pipeline's `call` in one
  scenario names all nine, the two excused under `--ignore`; the rerun `--against` X5.2a's
  log differs in exactly the 84 paths the new names move, every scenario steady; the bank on
  Hollowmere 20 of 20 rows byte-equal to X5.2a's AFTER by `exact.mjs`; typecheck and build
  pass. The note is in `plans/done/babylon_exit_landed.md`.

  **Its held finding F1** (738f5e3; 2026-11-08, by the owner's decision of that day: fixed before
  X5.2b, in a commit of its own, the moved rows measured and only those re-banked; it moves
  the reference, not the game — nothing under `src/` changes) is **fixed**. **Cause**:
  `freeze` stashed the post chain's three updaters once a page (`window.__refThaw ??=`), each
  with the object it came off, stubbed whatever `Volumetrics` was live at each freeze, and
  `thaw` gave `update` back only to the object stashed — but `Game.setVolumetrics` builds a
  new pass on every rung change and every off to on, so after the first, the live pass was
  stubbed by the next freeze and never restored. On Hollowmere `post-novol` turned the shafts
  off and `post-glowlow`'s reset to the boot's settings built a new pass, which its freeze
  stubbed, so `ground`, `crossing`, `sky-moon`, `sky-motes` and `ring-flown` converged with
  `syncVolumetrics`'s `vol.update()` doing nothing and were shot with the shafts' basis and
  `tanY` left at `post-glowlow`'s eye (`lanterns`'); a page whose first freeze found the
  shafts off never restored them at all. **Fix** (`harness.mjs` alone): the post chain's
  parts left the once-a-page stash; each freeze records every part it stubs, keyed by the
  object, with the real updater read off THAT object before its stub (`__refPostStubs`; a
  part already stubbed keeps its first record), the blur's real updater for the in-flight
  turn read from the same record, and `thaw` restores every recorded part — deleting the
  stub so the class's method shows through, or assigning back an own property — then
  empties the record. The grade and the blur are built once a page (`Game`'s constructor;
  the blur toggle detaches and re-appends the same grade), so neither was hit; they are held
  the same way. `post.mjs` has no stubbing of its own (it calls this `freeze` and `thaw`, so
  it is fixed with it; its scenarios stand at one eye, where the stale basis was the right
  one). **Measured**: the bank, all 147 rows, against a BEFORE at b9b6c43 (`--check --keep`,
  the parent's harness, the same tree) by `exact.mjs`, in two processes after the fix:
  exactly five rows moved, all Hollowmere's and all the bug's — `hollowmere-ground` 1,419,906 pixels by up to 21/255 (a mean of 4.0714/255),
  `hollowmere-crossing` 1,708,325 by 14/255 (1.8825), `hollowmere-sky-moon` 2,037,583 by 25/255
  (6.7773), `hollowmere-sky-motes` 2,012,029 by 25/255 (9.1004) and `hollowmere-ring-flown`
  1,868,088 by 6/255 (1.1955) — and
  nothing else but `sarab-ground` in one of the two (100 pixels by 2/255, its
  cross-process residue: the BEFORE's frame is byte-equal to the second process's, so the
  parent draws the step's frame) and `harrowmead-view-pistol-reload` within its known flake
  in the other. The five byte-stable across the two processes (`exact.mjs`, 5 of 5
  byte-equal), then re-banked ALONE (`bank.mjs hollowmere --rows=ground,crossing,sky-moon,
  sky-motes,ring-flown`, a third process, each row reproducible) and byte-equal to both
  processes' kept frames; `ref/mode.json` untouched. The five graded within the floor
  against the old bank before the fix (they were banked with the bug) and 1.2 to 9.1/255
  over it after; the same 34 stale rows red on both sides at the same means, so 34 with the
  five re-banked.
  Typecheck and build pass. `ref/` is gitignored, so this record is the re-bank's.
- **X5.2b — the glow's blur and downsample are our draws**, in `GlowPass`'s own
  passes, with no change to the pass structure: the kernel text generated as
  Babylon generates it (the same device limit), Babylon's vertex stage and quad
  as compiled, its samplers and uniform blocks. Its pipelines declared (row
  "X5.2, pipelines"). The mask stays Babylon's. **Verify** adds `post-glowlow`,
  the scale rows and both rungs in the probe.

  **X5.2b LANDED** (f697f0e; 2026-11-08; no change to the picture; no report version, the
  draws queued inside `glow`'s span). **What moved**: the glow's box filter and four blurs are
  our draws in the passes `GlowPass` still binds on its own targets (`bindFramebuffer`,
  `unBindFramebuffer`: Babylon opens, loads and ends each and draws nothing in it), queued
  through `Renderer.glowBlurOpened` against `GLOW_BLUR_TARGETS` (`rgba16float`, no depth, one
  sample, flipped) — no seam item, the mask Babylon's. `render/GlowBlur.ts` holds a pipeline a
  compiled kernel width and the box filter's, Babylon's quad (a `float32x2` attribute at stride
  8, `uint16` `0,1,2,0,2,3`, `drawIndexed(6, 1, 0, 0, 0)`, the buffers' usages 168 and 152),
  Babylon's `Internals` (-1, the render height) and one 16-byte `LeftOver` a pass, the source
  read through the host's own view and sampler (`FrameHost.bind`), layout and state Babylon's
  field for field (group 0 empty, everything in group 1; cull back, `cw`; no depth, no blend);
  `shaders/wgsl/glowBlur.ts` writes the blur's modules as Babylon's processor wrote them —
  `_nearestBestKernel`, the Gaussian, the linear pairs, `toFixed(8)`, the tap split on
  `maxInterStageShaderVariables` — and holds the box filter's as compiled: all 24 modules the
  parent's device was handed for the glow on both pages (ten kernel widths) reproduced
  character for character. `PipelineCache` gains `vertexBuffers` (a stage ported off
  Babylon's quad) and `get(spec, unsealed)`. **Pipelines** (row "X5.2, pipelines"): every rung
  at every render scale at the boot's DPR asked at construction (`glowKernels`, "the glow's
  blur" on `Game.roundPipelines`); `Game.applyRenderScale` declares a new DPR's new widths
  (up to five), the one exception to the seal. A pass whose program is not built is not
  bound — **corrected by X5.2b's review: that is not Babylon's behaviour, and is a known live
  difference the owner accepted on 2026-11-08** (row "X5.2, a DPR change in play"): Babylon
  compiled a new width synchronously at its first draw (`createRenderPipeline`), a hitch with
  the bloom drawn, where ours compiles off the frame, so after a device-pixel-ratio change in
  play the ink composes NO bloom for the ~3 frames the new widths compile (the resize having
  recreated the glow's targets zero-filled); and a ratio changed in the MENU declares its
  widths after the round's list was taken, so the warm-up does not wait for them and a round
  reaching play before they are built skips the same way. **The probe**: `post.mjs` kept a bind group's buffer
  binding by REFERENCE and Babylon rewrites those objects for its next group, so the log named
  the last group's buffer — the glow's four blurs logged as one buffer holding the wide pass's
  `delta` where the device bound four, each its own, and (X5.2b's review) the ink's and the
  motion blur's `Internals` as +1 in two scenarios (both corrected above); it copies the binding
  now, the parent's log was re-taken with it, and `__postGpu` gains our arm (`glow.down`,
  `glow.blur`, named off our modules' labels). **Verify**: the probe `--against` the parent's
  log (both pages, sixteen scenarios: every render scale at both rungs) equal — 31,031 values
  a page, every target's hash among them — with three paths excused on the glow's draws alone
  (`pipeline.call`: our asynchronous compile ahead of the frame against Babylon's synchronous
  one at the first draw; `bundle`: Babylon's draw was in a render bundle, ours is a bundle-list
  item run on the pass itself; `viewport`: Babylon set the whole target, ours sets none and a
  pass's default is the same) — committed since X5.2b's review as the first section of
  `plans/webgpu-ref/post-expected.txt`, keyed on the draws' STAGE (`**.draws[stage=glow.*]`,
  new in `post.mjs`) rather than on pass indices, which would excuse those fields on any
  other stage's draw at those indices; the bank, 147 rows, by `exact.mjs` against a BEFORE at 285da96:
  145 byte-equal, `harrowmead-view-pistol-reload` within its flake and `sarab-ground` 100 pixels
  by 2/255 — Sarab alone, two processes a tree: both trees draw both of its frames, the full
  run's one the parent's two drew (cross-process residue); the same 34 stale rows red on both
  sides. Then `blurKernel` made allocation-free (and the declared kernels de-duplicated): the
  probe again equal, Hollowmere's 20 rows (the `post-*` rows, `post-glowlow` and the scale rows
  among them) byte-equal. Live: our 12 modules made at the boot and none after through every
  post setting toggled in play, both rungs at every render scale, a resize, a teardown, a map
  change and `F2` (the parent compiled 8 more glow modules in play), Babylon's none, no glow
  pass drawn empty, no in-play compile warning, no error. `pipelines.mjs coldharbour --round`
  equal (0 of Babylon's, 21 of ours, none in play); `hollowmere` 9 to 8 of Babylon's by the
  install, 71 to 77 of ours, nothing after. `surfaces.mjs`: `kernelBlur` and `glowDown` gone
  from Babylon's draws. `census --against` equal. The editor's eight eyes: four byte-equal in
  every pairing, the rest within each tree's own floor. `?profile&gpu`: `render` and
  `gpu.frame` within 3%, `glow` 8 to 11% lower. A device-pixel-ratio change in play (1 to 2): the
  two new widths compiled with no in-play warning, the blur skipped for three frames meanwhile
  (no bloom on them: the accepted live difference above).
  `gate` (seven maps), `shaders` (seven), typecheck, build, corecheck and parity pass.
  The note is in `plans/done/babylon_exit_landed.md`.

  **Its review** (e5ab075; 2026-11-08; no change to the picture: two module-scope constants made equal
  literals, the rest documents, comments, contract headers and the probe's `--ignore`) found
  one real point, one the owner decided and two minor ones, each checked against the tree
  first. **The boot gate (real)**: `GlowBlur.ts` evaluated `GPUBufferUsage` at module load
  (its quad's two usages), as `GiCompute.ts` had since X5.1b (its buffer and texture usages);
  `main.ts` imports `Game` statically, so in a browser without WebGPU — or any browser on a
  LAN address over plain http, where those secure-context globals are undefined — the import
  threw (`GPUBufferUsage is not defined`) before `checkWebGPU` ran and the boot card stuck on
  "Fetching the game" with no sentence. Both are literals now (168 and 152; 140 and 15), the
  flags named in a comment, `particleProgram.ts`' `COMPUTE` the precedent; a scan of every
  module under `src/` for a `GPU*` global or `navigator` outside a function, a method or an
  instance field found those two and nothing else. `CLAUDE.md` and `docs/build.md` state the
  rule. **The DPR skip (the owner's)**: it was recorded as Babylon's behaviour and is not
  (row "X5.2, a DPR change in play": accepted as a known live difference, the code
  unchanged); corrected above, in both headers, `Game`'s comments, `docs/rendering.md`,
  `FILES.md` and the note, with the menu's case beside it. **The probe's correction** named
  the glow's four blurs alone; 4 of the 52 paths a page are the ink's and the motion blur's
  `Internals` (corrected in "What it is today"). **The seal's exception** was stated in some
  places only; `CLAUDE.md`, `docs/states.md`, `docs/rendering.md`'s `PipelineCache`
  paragraph, `PipelineCache`'s header and `Game`'s comments now name it (a pixel-ratio
  change's new glow blur widths, up to five). **Nits**: `docs/rendering.md`'s and `Game`'s
  stale "the setter returns on an unchanged value" removed; `post.mjs`'s `--ignore` takes
  `[stage=glob]` for an index (an element matched by its `stage`, both logs agreeing), and
  X5.2b's expected differences are committed, keyed on the glow's draws
  (`**.draws[stage=glow.*].{pipeline.call,bundle,viewport}`), as the first section of
  `plans/webgpu-ref/post-expected.txt` (the README says so), which X5.2c1 extends.
  **Measured** (the Windows box, headless): the boot, a scratch page off the dev server — on
  `http://192.168.1.136` (no secure context) and on `localhost` with every `GPU*` global and
  `navigator.gpu` deleted before any script — reached "Not a secure origin" and "No WebGPU"
  with their sentences and no page error; the parent, the same two ways, stuck on "Fetching
  the game" with `pageerror: GPUBufferUsage is not defined`. `post.mjs --compare` of X5.2b's
  final log against the parent's re-taken one, `--ignore=@plans/webgpu-ref/post-expected.txt`:
  equal on both pages, 31,031 values a page and the same 670 excused (134 a pattern), as
  under the index-keyed list; a hand-edited copy with the ink's `viewport` changed on
  `desk.base` and on `phone.glowlow` (where the ink is `passes[8]`) and a field added to a
  glow draw fails on all three, and one with a glow draw logged under another stage on one
  side fails on that draw's three fields. The bank on Hollowmere (`--check --keep`) by
  `exact.mjs`: 20 of 20 rows byte-equal to X5.2b's AFTER and to its parent's BEFORE; the
  same two rows red against `ref/` (`menu`, `ashwood`) as X5.2b's AFTER. Typecheck, build
  and corecheck pass.
- **X5.2c1 — the chain's host, and the grain.** `render/PostChain.ts` (ours) and
  the Babylon-side pass sequencer; `camera.outputRenderTarget` takes Babylon's
  prefix output **only while a stage of ours is active**, so with the grain off
  Babylon's prefix writes the canvas exactly as today and no interim copy pass
  exists. The canvas's pass targets include the main pass's `depth32float`
  (inferred; X5.2a measures it). **X5.2a measured it, and the depth is the
  ENGINE's, not the frame's**: the canvas's pass — Babylon's main pass — carries
  the engine's own depth (`canvas.depth`, `depth32float`, the render size, loaded
  and stored), not the one the scene draws into (`frame.depth`), and
  Babylon's pipeline there WRITES it (compare `always`, write on) — so a stage of
  ours drawn into that pass owes its pipeline that depth format, and whether it
  writes that depth is a byte the probe compares (nothing reads it after the
  frame's opening clear). The harness's readiness arm asks our
  pipelines. Retires the blur-and-grade dance.

  **X5.2c1 LANDED** (4747fe7; 2026-11-08; no change to the picture; no report version, the
  grade's draw queued inside `render` where Babylon's was, named by nothing). **What
  moved**: the grade is OUR draw, the last stage of the post chain's HOST,
  `render/PostChain.ts` — an ordered list of DECLARED stages (`PostStage`: the program as
  compiled with its bindings, the uniform block and its `fill`, extra bindings, the
  sampler it reads its input with, `active()`, `reads` point-wise or neighbourhood), routed
  a pass per active stage in list order, the last given the canvas, any other a pool
  target; nothing a stage holds names its output, its place or the canvas. Its passes are
  opened by the Babylon-side owner `shaders/PostPasses.ts` with public API (no seam item):
  while a stage of ours is active `camera.outputRenderTarget` takes Babylon's prefix's
  output (a `RenderTargetTexture` made as a post-process's input — `rgba8unorm`, no depth,
  NEAREST, the render size — named for the stage reading it, `PostProcessRTT-paperGrain`),
  the canvas is opened with `restoreDefaultFramebuffer` as `_finalizeFrame` opened it, and
  the draw goes in through `Renderer.postStageOpened` (`passIs` against `canvasTargets`:
  the swap chain's format, the ENGINE's `depth32float` written with compare `always`, not
  flipped); with no stage of ours active none of it runs and Babylon's prefix writes the
  canvas as before — no interim copy pass. The grade's modules are the parent's device text
  character for character (`shaders/wgsl/paperGrain.ts`, CONFIG's constants where they
  were), its 496-byte block filled as its `onApply` filled it (`PaperGrain.fill`), its input
  read through our own sampler at Babylon's descriptor (nearest x3, clamp, clamp, repeat,
  lod 0..0, anisotropy 1), the frame's depth through the host's own view; Babylon's quad,
  `Internals` (+1, the render height) and layout (group 0 empty, group 1 at Babylon's
  numbers). `PaperGrain` keeps the CPU half (grade, switch, flash, lattice) and its `stage`;
  its `attach`/`detach` and the blur-and-grade dance are gone (`Game.setMotionBlurEnabled`
  appends the blur, the last of Babylon's passes). `PipelineCache` lays a `texture_depth_*`
  binding out as `"depth"`. The harness's readiness arm (`__refPost().ready`) and both
  adapters' arms for the grain.
  **Found, and the reason for two things the plan did not say.** (1) **Babylon reads
  `outputRenderTarget` at THREE points**, not one: as `Scene.render` binds the frame's
  first target and clears the canvas's depth (with it set, the scene binds the output
  target instead and the frame's opening canvas pass — `canvas` loaded, `canvas.depth`
  cleared, X5.2a — is never recorded, shifting every pass after it); as the camera's render
  picks its render pass id (`outputRenderTarget.renderPassId`, which keys every Babylon
  draw's wrapper, an editor build's meshes among them); and as `_finalizeFrame` binds its
  last pass's target. Only the third is the prefix's output, so `PostPasses` sets it only
  from the draw phase's end to the camera's (`onAfterDrawPhaseObservable`, after the glow's
  and the frame depth's observers, to `onAfterCameraRenderObservable`). Five more reads,
  each inert under that window, were listed by X5.2c1's review ("What it is today":
  `_checkCameraRenderTarget`, the camera loop's bind flag, `_renderForCamera`'s multiview
  branch and two MULTIVIEW tests). (2)
  **`_finalizeFrame` binds that target WITHOUT a clear**, where Babylon's `activate` cleared
  the grade's input at its pass's open (to the scene's clear colour), so the pass the
  prefix's last stage draws in would load rather than clear — and on a frame that stage
  draws nothing (its effect still compiling: the probe's live half sees it at a boot) our
  grade would grade the target's last contents where Babylon's graded the clear colour. So
  `PostPasses` clears it in that pass, from the prefix's last pass's `onApplyObservable`
  (`Game.postPrefixTail`: the blur, the shafts, FXAA or the ink, whichever is last on the
  camera) — after its own observers, before its draw, the pass still unbegun — or, on a
  frame it draws nothing, in a pass of its own where that one stood: every pass's load op
  and clear value the parent's, on every frame. **That fallback cannot tell a tail that
  drew nothing from a `postPrefixTail` naming a pass that never applied** (the real last
  pass drew, and the clear would land after it, grading a clear colour), so a DEV build
  THROWS when it is about to run while the named tail `isReady()` — Babylon's `apply`
  returns nothing exactly while `!isReady()`, and readiness does not change inside a
  frame (X5.2c1's review; production keeps the clear).
  **Measured** (the Windows box, headless; BEFOREs at 79e620d in a worktree with its own
  `npm ci` and a copy of the main tree's `ref/`):
  - **The probe** `--against` the parent's log, both pages, sixteen scenarios: equal,
    29,009 values a page — every pass in submit order (the canvas's opening pass, the
    prefix's last pass into the grade's input with its `clear` and clear value and its
    label `PostProcessRTT-paperGrain`, the canvas's pass with the engine's depth loaded),
    every target's hash, every module's tokens (the module table equal: the grade's two
    the same text), pipeline, layout, bind group, sampler, uniform byte (the 496-byte block
    and `Internals` among them), vertex and index byte — with 2,223 excused a page by
    X5.2c1's section of `post-expected.txt`: the grade's draw's `pipeline.call`, `bundle`
    and `viewport` (X5.2b's three, for X5.2b's reasons: 28 paths a page) and Babylon's
    own `chain.list`, `chain.off` and `chain.slots.grade.attached` (the camera's list no
    longer holds the grade and the blur's toggle no longer re-appends it, so it is shorter
    with fewer holes; 32 paths each a page, the list's every field counted). Desk-only
    first, then both pages. The live half (printed): the same pass sequence frame for frame
    after the boot on both pages — the render-scale change and the resize each one frame
    with the canvas's opening pass alone, then whole; no stage of ours drawless; the shafts'
    rungs made on their frames. **At the boot one frame may differ, and it is not made
    exact** (stated plainly by X5.2c1's review): which pipeline is ready first rides
    timing on both trees (the parent's desk boot drew FXAA's pass empty on its first chain
    frame), and our grade is declared and compiled ahead of Babylon's prefix — so on a
    frame where every pass of that prefix is still compiling, ours grades its input
    cleared to the clear colour (the clear-alone path) and the canvas shows a GRADED CLEAR
    COLOUR where the parent's grade, compiling with the rest, left it BLACK. The probe's
    desk `boot-2` was such a frame, and it was under the building card; a real FIRST MENU
    BOOT may show it through the canvas for a frame while `#menu-shot` is still decoding
    (`ui/backdrop.css`: the shot has no background of its own), so "under the card" holds
    of the probe's frame and not of every boot. It is a timing-dependent boot-frame
    difference: no frozen frame and no bank row shows it, and it is not made exact
    because that would mean faking compile timing.
  - **The bank**, all 147 rows, `--check --keep` at the step against the BEFORE, by
    `exact.mjs`: 147 byte-equal, no flake, no Sarab procedure needed; the same 34 stale
    rows red against `ref/` on both sides.
  - **Live** (a scratch log, X5.2b's script on the grade: a Hollowmere round, FXAA, the
    motion blur and the grain off and on, the shafts low/off/high/medium, the glow low and
    high, render scale 0.5/0.75/1 at both rungs, a window resize and back, a teardown, a
    second round, Coldharbour, `F2` with a quay dragged and back and the glow rung changed,
    the round after): our two grade modules made at the boot and none after, no module of
    Babylon's `paperGrain` (the parent: one); Babylon's synchronous pipelines 32 against 33
    by the end; the grade's input pass drawn on every frame the grade was on but the three
    boot frames both trees draw it empty; `outputRenderTarget` null at every frame's end;
    no "compiled in play" warning, no `uncapturederror`, no page or console error, on
    either tree.
  - **Pipelines**: `coldharbour --round` identical on both trees (0 of Babylon's at the
    install, 21 of ours and 12 modules, none in play); `hollowmere` Babylon's 8 → 7 by the
    install (the grade's), ours 77 → 78, modules 111 on both, nothing in the 16 seconds
    after on either.
  - **`surfaces.mjs`**: Babylon's draws through no mesh lose `paperGrain -> canvas` (145
    rows); `motionBlur -> PostProcessRTT-paperGrain` stands, the prefix's output named for
    its reader.
  - **The editor's frames** (X5.1b's script, its eight eyes, two processes a tree):
    Coldharbour `menu`, `curtain2`, `curtain40` and Hollowmere `lanterns` byte-equal in all
    four pairings; `curtain90` 2-5 pixels by 1/255 (each tree against itself 0-3 by 1);
    Hollowmere `ashwood` 22,735-106,685 pixels by up to 52/255 and `menu` 273-1,165 by up to
    35/255 (each tree against itself 82,453-90,759 by 52 and 1,028-1,112 by 29-35);
    `wall40` changes between two grabs in one process on both trees — no oracle.
  - **`census --against`** (Hollowmere, Sarab, Cinderhaven, Kurenai): every row and total
    equal (403, 595, 619, 168).
  - **`?profile&gpu`** (Coldharbour and Hollowmere, the parent and the step alternating
    twice, report version 37 on both): `render` 0.931/0.960 → 0.964/0.977 and 0.820/0.843 →
    0.801/0.820 ms; `gpu.frame` 2.646/2.602 → 2.561/2.575 and 2.527/2.471 → 2.473/2.569 ms
    (within 4%); Babylon's draw calls 5 → 4 (the grade's draw is ours).
  - **Gates**: `gate` seven maps clean; `shaders` clean on seven; typecheck, build
    (`check-babylon-free`, `check-proving`), corecheck and parity pass.
  **For X5.2c2**: Babylon's chain becomes `[celInk]` and the host's list grows ahead of the
  grade — each stage DECLARED as the grade is, a pool pipeline asked for every stage another
  follows (`PostChain`'s constructor), the pool's passes opened bound and cleared as
  `activate` opens a pass (`PostPasses.openPool`, written here and first exercised there:
  its descriptors are X5.2c2's to prove), `Game.postPrefixTail` shrinking to the ink, and
  `__refPost`'s ours arm taking the shafts and the blur. Deleting
  `DefaultRenderingPipeline` sets `scene.autoClear` back to true, which the window does not
  meet (it opens after the frame's start) — only the opening canvas pass's colour load
  moves, as that entry says. A pass of ours into a texture is FLIPPED (`Internals` -1, the
  front face `cw` under cull none, as the probe read Babylon's).
  **Not run**: the phone (its page is the probe's `phone` size only), a lost device (ours
  does not rebuild after one, `FINDINGS.md` 64), a server's match in a browser, a DPR
  change in play (the grade's text and pipeline do not depend on the ratio). The note is in
  `plans/done/babylon_exit_landed.md`.
  **Its review** (bfa6a6b; 2026-11-08; no change to the picture: a DEV-only check, the rest documents,
  comments and contract headers) found nothing that must be fixed and five minor points,
  each checked against the tree first. **The tail**: the fallback clear could not tell a
  prefix tail that drew nothing from a `Game.postPrefixTail` naming a pass that never
  applied; a DEV build now throws on a READY tail that never applied ((2) above,
  `PostPasses`' header and comment, `Game.postPrefixTail`, `docs/rendering.md`, `FILES.md`).
  **The boot frame**: stated plainly in the probe's live half above, a first menu boot
  included. **`outputRenderTarget`'s readers**: five more, inert under the window, listed in
  "What it is today" with what X5.2d meets (and `PostPasses`' header and `docs/rendering.md`
  no longer say three). **`openPool`**: four things X5.2c2 must verify, in its bullet, the
  code unchanged. **A stray `TODO`** after "Measured" removed. **Measured** (the Windows box,
  headless, a dev build): a Hollowmere round with FXAA, the shafts (off, low, high, medium),
  the motion blur and the grain each off and on — the tail at the blur, the shafts and the
  ink in turn — and render scale 0.75 and back: 250 frames, the prefix's output cleared in
  its pass on every frame the grain was on and by the fallback on none, no page or console
  error; the detached (ready) blur named as the tail threw on its first frame. Typecheck and
  build pass; the throw's text is absent from `dist/`.
- **X5.2c2 — motion blur, the shafts, FXAA** (may land as one commit a pass,
  each moving the boundary one pass). Babylon's chain becomes `[celInk]`. The
  shadow maps read as `own ?? hostTexture` (`ShadowBindings`' pattern), the
  cloud field through `hostTexture` with the host's sampler. 
  `DefaultRenderingPipeline` is deleted, so `scene.autoClear` returns to true:
  the clears shown equal by the probe. **X5.2a measured what that moves**: the
  frame opens with a canvas pass of no draws that LOADS the colour and clears the
  engine's depth; with `autoClear` true it clears the colour too, which the last
  pass overwrites whole on every frame the chain draws — but on the one frame after
  a render-scale change or a resize the chain draws nothing (X5.2a), and that frame's
  canvas is whatever that opening pass leaves. The probe's descriptors will differ
  there by design; that frame's picture is the case to name. **`PostPasses.openPool`
  (X5.2c1's, first exercised here) owes four checks against Babylon's `activate`**
  (X5.2c1's review; its code is X5.2c2's to change): it always clears with
  `scene.clearColor`, where `activate` clears only under the READER's `autoClear` and
  `alphaMode` (or `forceAutoClearInAlphaMode`) and with the reader's own `clearColor`
  when it has one — a `PostStage` cannot declare any of the three; it binds with
  `forceFullscreenViewport` undefined where `activate` passes the pass's, `true` by
  default — equal only while the camera's viewport is 0,0,1,1; the pool PING-PONGS two
  textures where Babylon gives each pass an input of its own, so the texture a pass
  reads and writes is not the one Babylon's would be (anything the probe keys on texture
  identity differs by design); and a stage's `fill` is handed
  the render size (`owner.width`/`height`), not the size of what it reads as
  `PostChain`'s header says — equal while every target is the render size. Every volumetric rung declared. Retires
  the FXAA and shafts slot tricks, and the dead Mali comments. **Owes
  `gi.mjs --against`**: with no Babylon bind of the cloud field, its internal's
  cached sampler fields stay unfilled in a default boot, as under
  `--shafts-off` (inferred) — named as an expected difference. Ends Babylon's
  reading of the cloud field in a round (X5.4's list says so).
- **X5.2d — the head: the ink and the glow's compose are ours.** The scene draws
  straight into the frame's render target (`outputRenderTarget` with depth),
  its formats equal to `FRAME_TARGETS` (`render/targets.ts`), the clear moved
  from `CelInk.activate` to the scene's own frame-buffer clear;
  `GlowPass.drawsInto` takes that target; `FrameDepth` reads the public
  `renderTarget.depthStencilTexture`, which takes its internal off the seam
  header's "not here" list (row "X5.2, `FrameDepth`", decided 2026-11-08). No Babylon
  `PostProcess` is left. **Verify** adds `surfaces.mjs`: no Babylon post-process
  draw in a round.

**Risks to a byte-exact port** (each measured by X5.2a's per-pass hashes and
descriptors): `vUV`'s bits (the quad against a full-screen triangle, the
triangulation, the flip, the `scale` multiply), which feed the shafts' and the
blur's `hash()` — port Babylon's quad, vertex text and flip exactly, and keep a
boundary pass's target orientation; the samplers (NEAREST for the ink, shafts,
blur and grain inputs; bilinear for FXAA, the mask and the glow targets;
clamp; anisotropy as logged); the formats (`rgba8` intermediates, the canvas's
preferred format — `bgra8` on Windows, `rgba8` on Android — premultiplied,
alpha 1; the main pass's depth attachment; the glow's half floats); the clear
values and `scene.autoClear`; the blur's kernel text against the device limit
and the scaling level; the uniform layouts (the `mat3x3f` repack, the
`array<vec4f, 24>`, the processor's struct order); motion blur's CPU history
and `dt` cap; the grain's damage flash; boot and resize (Babylon skips a pass
while it compiles, leaving a cleared target; targets recreated at a resize);
the editor's image-processing state once the pipeline is deleted. **Device
loss**: Babylon's post chain rebuilds after a loss today and ours will not
(`FINDINGS.md` 64, X5.4's) — recorded, as for every draw of ours.

- **Every sub-step owes**: **a BYTE comparison of every row against a BEFORE at
  its parent** (`exact.mjs` over two `--check --keep` directories, never
  `--check`'s pass line), the known flakes alone excused and the Sarab
  procedure in `exact.mjs`'s header followed; from X5.2c2 on, the same under
  `--query=volumetrics=low` and `--query=volumetrics=high`; X5.2a's rows; the
  X5.2a probe `--against` its parent's log, every expected difference named
  (`--ignore`, by path pattern, never read past);
  its pipelines declared on `Game.roundPipelines`; `pipelines.mjs hollowmere`
  and `pipelines.mjs coldharbour --round`; `surfaces.mjs` (Babylon's post draws
  falling away as passes move); `census --against`; the editor's frames at
  X5.1b's eight eyes; live: every post setting toggled in play, a rung change, a
  render-scale change, a window resize, a teardown, a map change, `F2`;
  `?profile&gpu`, `render` and `gpu.frame` within 8%; typecheck, build,
  corecheck, parity, `gate`, `shaders`; each new module's contract header and
  `FILES.md` line (rules 7 and 9); and **STOP with the numbers** wherever the
  bytes do not hold.
- **Verify, the whole step:** the bank with every post setting on and off (row
  "X5.2, the Verify": X5.2a's rows are its meaning, decided 2026-11-08); X0.3 (row "X5.2,
  X0.3": the desktop bench, decided 2026-11-08); no Babylon `PostProcess` in a round.
- **Rewrites** (each sub-step its own share): `CLAUDE.md`'s glow paragraph, the
  `shaderLanguage` / declared-sampler rule (a bind-group-layout rule for ours,
  still the rule for Babylon's remaining materials), the frame-depth and ink
  lines and, if a span moves, "Measuring a frame"; `docs/rendering.md`'s ink,
  glow, smear, light-shaft and frame-target sections; `docs/states.md` where it
  counts the post chain's pipelines; `docs/profiling.md`; `PipelineWarmup.ts`'s
  header; the contract headers of every module moved; `FILES.md`; the seam
  header; `FINDINGS.md` 5, 16 and 52; the gate note after Phase 4 (above) and the
  "Contracts this plan rewrites" rows for the glow and `shaderLanguage`.

### X5.3 — The editor — **M–L**

`F2`'s editor on our renderer:
- its unmerged build drawn per item
- picking against `RayWorld` and item bounds instead of `scene.pick`
- our own move and Y-rotate gizmos (today `PositionGizmo`, `RotationGizmo`,
  `UtilityLayerRenderer`)
- the free-fly camera, `navOverlay`, the proxies and the terrain brush

It stays behind its one dynamic `import()` in a DEV branch.

- **Inherits from X3.7:** the editor's build is the last Babylon draws whole —
  every mesh, `ShadowSystem`'s generators and `LocalShadows`' render target,
  kept for it alone; X5.3 deletes them.
- **Inherits from X4.6e:** the editor's glazing, one Babylon mesh per placement per
  material over the default cube; `wrapCubeTexture` and `setDefaultReflection`, kept
  for that alone; the seam's item 6; and the `ed-*` proxies, every one blended, on
  that same transparent list. **X4.6c and X4.6d leave it no grass, turf or water**
  (decided 2026-11-03), so what is left to draw per item here is the world surfaces
  and the proxies.
- **Inherits from X4.6d: an editor build's blades and water do not interleave with its world.** Its
  whole world is on Babylon's opaque list and the one run stands behind that list, so anything that
  sorted ahead of the run's surfaces and ties with them flips. Measured against 21839d1 at X4.6d: Greyfen's `crossing`, menu, `ground`, `marsh` and `canopy` byte-equal, Sarab `wadi` 456 px by 91/255, `shelf` 17 by 35/255, `menu` 2 by 1/255, and Harrowmead `ground` 2 by 1/255 (X4.6d's note). Dev-only and recorded; moving
  the editor's world here is what ends it.
- **Verify:** select, drag, rotate, sculpt, lay a path road, save — and
  confirm the save patches `layout.ts` byte for byte for untouched entries
  (`docs/editor.md`). `merge:hash --editor`.

### X5.4 — Take the frame — **M**

- **Do:**
  - Our own `requestAnimationFrame` loop.
  - The canvas: size, DPR and render scale.
  - **The post passes' targets and passes** (X5.2's shape (A), decided 2026-11-07): the
    Babylon-side sequencer X5.2c1 builds (`shaders/PostPasses.ts`, a `PostPassOwner`:
    `render/PostChain.ts` routes through whichever owner it is handed) is swapped for our
    own encoder and targets, and
    the glow's MASK moves with the main pass (row "X5.2, the mask"), retiring items 2 to
    5 for both — the glow's five BLUR passes with them (bound by `GlowPass` on its own
    targets, our draws queued in them since X5.2b). Render scale's setter is this step's (row "X5.2, render scale").
  - Device-loss recovery, tested by destroying the device on purpose.
  - `FrameCap`.
  - `FrameProfile`'s `hookRender` and `hookEngine` replaced by spans around
    our own passes. `present` becomes the span around `queue.submit`; `?gpu`
    uses timestamp queries.
  - `PipelineWarmup` becomes waiting for X4.4's list.
  - Delete `webgpuLeaks.ts`.
  - **The water's foam mask is the last texture a draw of ours reads off a Babylon `Texture` it
    decoded and mipped itself** (X4.6d, `hostTexture`, 256 square, 9 levels, `rgba8unorm`, flipped).
    It goes with the seam, its decode and its mip chain proven against the bank's water rows,
    or it comes back with the numbers.
  - **Every other texture a draw of ours reads off a Babylon `Texture` goes with it, in the same
    pass and the same proof** (decided 2026-11-07, the owner, after Phase 4's gate found no step
    named them before X6.1). They are the seam's items 7 and 8 at their last readers, each wrapped
    by `hostTexture`, and each a canvas or raw texture the game draws itself:
    - **ours alone since Phase 4**: the ash's motes (`Atmosphere`), the rotor wash's puff
      (`RotorWash`), the scorch (`BlastDebrisSystem`), the blob (`ShadowSystem.blobMap`) and the
      sky's (`Sky`) — the cloud field, which since X5.1b the irradiance volume's TRACE reads
      through `hostTexture` and `host.bind` too (a compute reader beside the frame, the host's
      sampler by the owner's decision), so its move owes `gi.mjs` beside the bank. Nothing of
      Babylon's samples them but the cloud field, which Babylon's `Volumetrics` (the light
      shafts) binds on every frame it draws until X5.2 takes the post chain, and an editor
      build's Babylon cel materials until X5.3 (X5.1a counted both: one bind a frame in the
      menu and deploy, 100,485 in 120 editor frames; corrected by X5.1b's review), both gone
      before this step; they wait for it only so the group moves under one bank proof, not
      for any reader.
    - **shared with an editor build until X5.3**: the cel materials' own (`CelShader`'s
      `recipe.textures`) and the shadow maps `ShadowBindings` still wraps. X5.3 takes away the
      editor's Babylon draw that samples them (rule 5: a resource lives with what produces it),
      and leaves them here.
    - **not this step's**: `GiVolume`'s seven, X5.1's — ours since X5.1b (`render/GiCompute.ts`),
      no longer behind `hostTexture` at all.
    Each is drawn, uploaded and mipped by us, its levels and format stated as the foam's are,
    and proven against the bank rows that hold it — `exact.mjs` against a BEFORE at the parent,
    the six particle rows and the blast and blob rows by name, since several sit under `--check`'s
    mean. A texture whose bytes do not hold comes back with the numbers, as the foam does.
    `hostTexture` and the seam's items 7 and 8 are then read for any reader left, and deleted
    with the seam if none is.
  - **The viewmodel's readers keep Babylon's answers on a frame id of our
    own** (decided 2026-10-31): X4.3b's `RenderCache` (`rigJoints.ts`) is
    keyed on `scene.getRenderId()` and settled from
    `onAfterActiveMeshesEvaluationObservable`, both of which go with the
    frame. It is given a frame counter of our own with the same meaning —
    advanced where Babylon's render id advanced, settled at our evaluation of
    the "switched on and `isVisible`" set — so `muzzleWorld`,
    `throwHandWorld`, the eye port and the reload's gravity, and with them
    `GrenadeCommand.origin` and `OrdnanceCommand.origin`, stay bit for bit
    through the exit. `FINDINGS.md` 55 (the points stated analytically)
    stays after it.
- **Verify:** X0.3 against X0.4's "before" on every device; `gate.mjs`; a
  phone install from the home screen, offline.
- **Rewrites:** `CLAUDE.md`: the `compatibilityMode = false` rule (deleted),
  "Measuring a frame" (the two roots and the hooks); `docs/profiling.md`;
  `docs/states.md` where it says the scene renders in every state.

---

## Phase 6 — The cut

### X6.1 — Remove `@babylonjs/core` — **S–M**

- **Do:**
  - Delete `babylonSeam.ts`, `src/math/babylon.ts` and every adapter.
  - Drop `@babylonjs/core` from `package.json` and `optimizeDeps.exclude`
    from `vite.config.ts`.
  - Replace `check-deep-imports.mjs` with `check-babylon-free.mjs` over the
    whole tree.
  - Keep `@babylonjs/havok`: it does not depend on core.
- **Verify:** `npm run build`, every oracle once more against the parent; the
  bundle size before and after; the PWA updating cleanly over an installed
  copy.
- **Rewrites:** a sweep of `CLAUDE.md`, `docs/build.md`,
  `docs/rendering.md`, `FILES.md` and `VERIFYING.md` for anything still
  describing Babylon.

### X6.2 — Merge to `develop` — **S** (decision)

The one step that touches `develop`, apart from Phase 0's early merge of X0.1
to X0.3 (see "The branch"). It is the user's to start.

- **Before:** merge `develop` into `babylon-exit` one last time and run every
  oracle on the result. X0.3 against X0.4's "before" must pass on every device,
  and the targets must be met or the shortfall written down. Play rounds on
  every map, offline and in a match, for long enough that you would ship it.
- **Do:** merge with `git merge --no-ff babylon-exit`, so the whole exit is
  ONE merge commit on `develop`. If it has to come out after landing,
  `git revert -m 1 <merge>` takes all of it out in one commit, except X0.1 to
  X0.3, which were already on `develop` before it. That is the
  "no mess to revert" the branch exists for.
- **After:** move this file to `plans/done/` with a status block, as
  `plans/README.md` says, and keep the branch and its tags.

---

## PERF_PLAN, step by step

| PERF_PLAN | here |
| --- | --- |
| P0, G1 | X0.4 (G1's GPU cost transfers, since the shaders port) |
| A1, A2 | landed; X1.4 builds on both |
| A3 vehicle detail tier and draw distance | X4.2c (the tier), X4.2d (the distance, with X4.1e's fade), built in the new renderer, not in Babylon — both landed |
| A4 body fade | X4.1e |
| A5 occlusion culling | optional, after X3.3b, in the compute cull; occluders skip `RayWorld.removed` |
| A6 snapshot rendering | dropped: it is a Babylon mechanism |
| B0, B1, B2, B3, B5 | X3.1, X3.3 (a–c), X3.4 and X3.5b, X3.6, X3.5 |
| B4 who owns the frame | decided: X5.4 |
| C1 | X0.2 |
| C2, C3 | X2.1, X2.2 |
| C4 Worker | X2.5b (decided 2026-10-10), its transport replaced by X2.5c (2026-10-11) |
| C5 Rust core | not in this plan |
| C6 dynamic draws | X4.1a–d (its corpse line reversed at X4.1b) |

## Contracts this plan rewrites

Each is rewritten by the step that breaks it, in the same commit.

| contract | step |
| --- | --- |
| `CLAUDE.md`: `compatibilityMode = false` is load-bearing | X5.4 (deleted) |
| `CLAUDE.md`: no deep static import, keep `optimizeDeps.exclude`; the two WASMs that never ship | X6.1 |
| `CLAUDE.md`: every cel material is frozen; `remember`; a vertex colour buffer gained after a first draw | end of Phase 4 (deleted) |
| `CLAUDE.md`: `shaderLanguage` is load-bearing; a declared sampler must be bound | X3.1, X5.2 (becomes a bind-group-layout rule) |
| `CLAUDE.md`: the two shadow maps; the lamps' atlas | X3.6a, X3.6b, X3.7, X4.1c |
| `CLAUDE.md`: the rig pool, fourteen meshes a rig, rigs filed mesh by mesh; `docs/deaths.md`'s reparented corpse | X4.1a, X4.1b, X4.1d |
| `CLAUDE.md`: the pipeline warm-up's body pose (and, since X4.2b, the hulls' pipeline among those it waits for) | X4.1d, X4.1e, X4.2b |
| `CLAUDE.md`: a vehicle's picture (`VehicleView`, the rig's meshes; since X4.2b every hull an instance of its kind's kit, gated per segment, `docs/rendering.md`'s "The hulls, ours") | X4.2a, X4.2b |
| `CLAUDE.md`: the map's overrides table (a ninth, `hullDrawDistance`, landed: absent is no distance, a stated one floored at a hull's gun reach); `docs/world.md`'s section on them; the bodies-and-hulls paragraph's fade (a hull at its draw distance only) | X4.2d |
| `CLAUDE.md`: the frame walks the scene (`WorldCulling`) | X3.3c through X4.7 |
| `CLAUDE.md`: the glow | X3.6d, X3.6e, X3.7, X5.2 |
| `CLAUDE.md`: visual meshes and collider proxies; exactly three sweeps | X2.1, X2.3 |
| `CLAUDE.md`: mesh metadata is a contract | X1.4 (moves to the geometry record), X3.3 onward |
| `CLAUDE.md`: the forced world matrix on the authority | X2.2 |
| `CLAUDE.md`: the server cannot run `MapBuilder` / `NullEngine` | X2.3 |
| `CLAUDE.md`: Havok and `scene.physicsEnabled` | X2.4, X5.4 |
| `CLAUDE.md`: the pipeline warm-up | X4.4, X4.7c and X4.7d (the vantages' last Babylon draws in a round, the particles), X5.1b (the irradiance volume's compute on the declared list), X5.4 |
| `CLAUDE.md`: the indirect light traced in compute (its GPU half ours, the late prepare's registration order; an editor build with no GI until X5.3) | X5.1b and its picture change, X5.3 |
| `CLAUDE.md`: a colour gradient changes a particle system's vertex layout | X4.7d (deleted) |
| `CLAUDE.md`: measuring a frame, the two roots | X5.4 |
| `docs/build.md`: the four copied Babylon internals, `merge:hash` owed per upgrade | X1.2, X1.4, X2.1 (adds the sweep and `sweep-check`), X6.1 |
| `docs/rendering.md` | X3.1 onward, swept at X6.1 |
| `PERF_PLAN.md` Parts B and C | this file (see the note at its top) |

## Risks

- **The shared frame.** Through Phases 3 and 4, two renderers draw into one
  pass. A mismatch in attachment format, sample count or depth format fails
  silently. A render bundle replayed into a pass with different attachments
  fails. Every insertion point is one more seam. If Phase 3 needs many
  insertion points into Babylon's pass, consider doing X5.4 earlier, and say
  so here.
- **The look.** The cel picture comes out of many passes working together. The
  bank is the only defence, which is why X0.1 is first.
- **Generator fidelity.** A primitive that differs from Babylon's by one
  vertex shifts every building. `kit:hash` catches it, but only if X1.2 runs
  it on every kind.
- **`develop` moving under the branch.** Small if you stay focused on the
  exit, but anything that lands there must come in by merge and be converted
  (see "The branch"). The longer between merges, the bigger each one gets.
  Merge at least at every gate.
- **The seam count only grows until Phase 3 ends.** If it is still growing in
  Phase 4, stop and ask why.

## What this plan does not do

- No WebGL fallback, ever (`CLAUDE.md`).
- No new features inside a step. A step that wants one splits it out.
- Phone fill at render scale 0.75 is per-pixel shader cost, and the shaders
  port unchanged (`PERF_PLAN.md`, "What this plan does not fix").
- **The GPU side, until the exit is complete** (the user's call,
  2026-10-14). The phone is GPU-bound on Greyfen once warm, and it throttles
  (`FINDINGS.md` 52). What would make each frame cheaper for the GPU to
  paint comes AFTER X6.2, starting with short captures that find where the
  time goes, and then only the work those numbers justify. That means the
  post chain's passes fused or skipped on a phone, near-first drawing, and
  keeping the phone cool. Until then the exit does two things for it:
  - it keeps the door open (X3.3b writes clusters near-first; X5.2 keeps
    the post passes fusable);
  - it records the phone's `gpu.frame` beside every phone tick it
    measures.

  A 30 fps cap or an automatic render-scale drop on a phone needs nothing
  from the exit and can land on `develop` at any time if the phone cannot
  wait.
- The browser's own floor: compositor scheduling, present mode, per-tab
  memory.
- Rust (C5), and threads inside the simulation.

## Size

`PERF_PLAN.md`'s scale: **S** under a week, **M** one to three weeks, **L** a
month or two. Summed at midpoints, this plan is well over a year. That scale
has run long in this repo: the WebGPU migration's eight milestones landed in
two days (`plans/done/webgpu_migration.md`), and A1 and A2 took about a day
each. Read the sizes for ordering, and re-estimate after Phase 1 from what
Phase 1 actually took.

## Decisions that are yours

| before | question | recommendation |
| --- | --- | --- |
| any time | Should the bots' movement streams take the round's seed, so they move less alike from round to round? Not part of the exit. | Optional, and a one-line change. Leave the per-squad skill draw constant either way, or balance becomes chance. |
| end of X0.4 | The frame targets: device, map, render scale and statistic for each. | **Decided** 2026-10-09: X0.4's table. |
| X0.4 | Bring Sarab to final detail first, as a heavier "before"? | Optional. If yes, do it after X0.3 and take the "before" twice, once on each side of the rework. |
| X2.1 | Who judges the feel? | **Decided** 2026-10-10: the user play-tests a round on foot and in each vehicle kind before the step lands (X2.1). **Done** 2026-10-10: it felt good, and X2.1 landed. |
| X2.4 | Fix `FINDINGS.md` 53 (world friction 0.5, not 0.8) while porting Havok? | **Decided** 2026-10-10: no. The port keeps 0.5, so `drop.mjs` stays an oracle. A fix is a separate commit afterwards, on the user's word (X2.4). |
| X2.5 | One simulation core, offline and online? | **Decided** 2026-10-10: yes. |
| X2.5 | In the page or in a Worker? | **Decided** 2026-10-10: in a Worker. X2.5a makes the one core in the page behind a Worker-shaped interface, and X2.5b moves it into a Worker with cross-origin isolation, keeping the in-page core as the fallback for a browser without isolation (X2.5). |
| X2.5b | Shared memory (with cross-origin isolation) or posted frames? | **Decided** 2026-10-11: shared memory, with the transport behind one interface so posting can replace it (X2.5b). |
| X2.5b | Rewind offline shots, now that the bots run a frame ahead? | **Decided** 2026-10-11: yes, in both modes (X2.5b). |
| X2.5b | The phone check sits under the noise floor. How is it read? | **Decided** 2026-10-11: off the profiler: `sim` leaves the main thread, the new costs are named, and the frame is no slower (X2.5b). |
| X2.5b | How does the branch reach the phone? | **Decided** 2026-10-11: a code review, then a `--no-ff` merge to `develop` ("The branch"). Moved to after X2.5c the same day, so `develop` never deploys the transport X2.5c deletes. |
| X2.5b | Does the authority run the core in-process or in `worker_threads`? | **Decided** 2026-10-11: in-process, with no measurement owed. A server runs one core per match and draws nothing, so a Worker there only adds a hop to every relayed command and event, and the server is in no X0.4 target. |
| after X2.5b | Keep two client models, or make offline a match client? | **Decided** 2026-10-11: offline is a match client of a local `Match` in a Worker, over the existing protocol. Anything not acceptable offline is fixed for both; a binary wire comes later, for both, if needed (X2.5c). |
| X2.5b | Revert X2.5b, or replace it? | **Decided** 2026-10-11: replace it with forward commits, keeping what X2.5c lists under "Keep". A revert would take the keepers out and conflict with 934b695. |
| X2.5c | Keep cross-origin isolation (COOP/COEP) once nothing needs `SharedArrayBuffer`? | **Decided** 2026-10-11: remove it, in X2.5c's C6. It is a contract in four places that fails silently. The one thing it bought was finer `performance.now()` resolution for the profiler, whose phases average over many frames anyway. If a capture ever shows the coarser timer hurts, that is a new decision. |
| X3.3 | The phone is GPU-bound on Greyfen once warm (`FINDINGS.md` 52). Add the GPU-side work to the exit, or after it? | **Decided** 2026-10-14: after the exit is complete. Meanwhile the gate after X3.3c reads the CPU tick, the phone's `gpu.frame` is recorded at every phone measurement, and X3.3b and X5.2 keep the door open ("What this plan does not do"). |
| X3.4 | Every prop was unique, so there were no variants to instance: how many variants a kind, or defer the step? | **Decided** 2026-10-14: 16 variants a kind, each placement under its own yaw and scale; maple's four crowns four variants each (X3.4). |
| X3.4 | Scatter AO: baked per kind (cheaper, changes the look) or per instance? | **Decided** 2026-10-14: per kind, judged in the bank. If the look is wrong, the fix is X3.4's "If the look is wrong" (a per-kind bake plus a per-instance term), not a per-instance bake. |
| X3.5b | X3.4b's instanced draws are one a part of a set, issued every frame: fold them into one draw a recipe, and when? | **Decided** 2026-10-14: fold them by vertex pulling, blocks and scatter in one stream, before X3.6 repeats them in every pass. Fewer variants was not the lever: it halves the count and costs the look. |
| X3.5b | The instance in the index's high bits, or non-indexed draws over (record, corner)? | **Decided** 2026-10-20: the high bits, with the scatter addressed in its own region (13 bits of instance, 18 of vertex, its parts laid first); landed 2026-10-21, at two draws a group with scatter, since the blocks stay never-indirect; the scatter's draw plain since 2026-10-24, at a bound the CPU computes, and its `expand` direct, for the Intel laptop whose trees went too. |
| X3.6d | After X3.6 Babylon still BUILDS every world mesh, as the fallback each pass hands back to, and still draws the emissive palette's MAIN pass. Which step deletes the fallbacks, and which moves the palette's main pass? | **Decided** 2026-10-24 for the palette's main pass: option 1, move it in its own step and measure first — it changes which side wins an equal-depth tie with a coplanar wall, a picture change owed its own commit with the bank's numbers (rule 2); landed as X3.6e (59 of 61 rows byte-identical, the two that moved the reach's hysteresis rather than a tie). Deleting the fallbacks **decided** 2026-10-24, after the Intel laptop's flicker was fixed and the phone's world read right: X3.7, in three sub-steps. |
| X3.7 | With no fallback, what does a world our renderer cannot draw become? | **Decided** 2026-10-24: back to the menu with a toast and a `console.error` (`Game.worldFailed`), not a hole in the world; a surface the handover cannot hold is refused in DEV and by `merge:hash`, so it cannot ship (X3.7). |
| X3.7 | Glazing and fires stay Babylon meshes until X4.6 and X4.4: how does Phase 3's end condition read? | **Decided** 2026-10-24: "Babylon builds no mesh in a round for anything our renderer draws" (the shape table). |
| X3.7 | `?babylonworld` cannot exist without the meshes: delete it? | **Decided** 2026-10-24: yes, in X3.7b, with its parent tagged `exit-babylonworld` and pushed for a device A/B against Babylon's world. |
| X4.1 | One step or several? | **Decided** 2026-10-29: five sub-steps (X4.1). The fade is a picture change and lands alone (rule 2); corpses come off the reparenting before the draw moves, so the draw moves every body at once. |
| X4.2 | One step or several? | **Decided** 2026-10-31: four sub-steps (X4.2). The joints and the draw move with no picture change; the detail tier and the draw distance are picture changes and land alone (rule 2). |
| X4.2 | Which hull parts drop at range (the tank's links and wheels, the MG rings)? | **Decided** 2026-10-31: PERF_PLAN A3's suggestion — `tank-link-hi`, `tank-link-lo`, `tank-wheel`, `tank-mg-ring`, `truck-mg-ring`; PERF_PLAN A3 measured +6.5% at 300 m on Cinderhaven (X4.2c). |
| X4.2 | The hull's draw distance: a map field, or a multiple of `bodyDrawDistance`? And a pop or a fade at it? | **Decided** 2026-10-31: a map field, `EnvironmentSpec.hullDrawDistance`, defaulting to unaffected; and a fade at both edges, X4.1e's screen door (X4.2d) — the size edge withdrawn the same day (the next row): a fade at the distance only. The default's form, as landed: absent is NO distance (`Infinity`), not the fog — the first draft's "its own `fogEnd`, as `bodyDrawDistance` is" would have faded and cut far hulls on every armour map — and a stated one is capped at `fogEnd` and floored at a hull's gun reach (X4.2d's note). The wash fades with the hull; tracers and blasts do not, accepted (X4.2d's post-commit review, 2026-10-31). |
| X4.2b | The hull's size gate: kept PER SEGMENT (X4.2b's deviation, no picture change), or made a whole-hull drop as a body's? | **Decided** 2026-10-31: per segment, permanently. X4.2c adds a whole-hull measure used ONLY for its detail tier's swap; X4.2d fades ONLY at `hullDrawDistance`, with no size-edge fade — a whole-hull size edge falls past the fog on most viewports (~1.5 km at 1080p, ~540 m at 832x384), and a hull's small parts keep dropping at the per-segment gate as they always have (X4.2b's note, X4.2c, X4.2d). |
| X4.3 | One step or several? | **Decided** 2026-10-31: four sub-steps (X4.3). X4.3a widens the bank first (about seventeen rows: the two missing optics, the pistol, the launcher and the mine, the gloss rungs, five gestures held mid-phase, the kit screen at two bays, and a harness that raises the kit lid) so every later sub-step has a BEFORE; then the joints, the opaque draw, and the glass and the card. None is a picture change. |
| X4.3 | The muzzle flash and the brass: X4.3's or X4.4's? Neither entry named them. | **Decided** 2026-10-31: the flash is X4.3's (X4.3c), hung off the muzzle joint and drawn in the gun's order like a reticle; the brass is X4.4's, a pool of cel boxes in the world group needing only X4.3b's eye-port joint. |
| X4.3b | The grenade's release point and the rocket's start are read off the viewmodel's joints through Babylon's render-id cache (the last render's world, or fresh where a node was not drawn). Keep those answers bit for bit, or take one rule? | **Decided** 2026-10-31: bit for bit. A different answer changes what the page submits (`GrenadeCommand.origin`, `OrdnanceCommand.origin`) and would be its own commit; stating the points analytically stays `FINDINGS.md` 55's, after the exit. |
| X5.4 | X4.3b's readers copy Babylon's render-id cache, keyed on `scene.getRenderId()` and settled from a Babylon observable, both of which X5.4 removes (raised by X4.3b's review). Land `FINDINGS.md` 55 before X5.4, or port the cache? | **Decided** 2026-10-31: port it — the cache gets a frame id of our own with Babylon's meaning, so the two command origins stay bit for bit; `FINDINGS.md` 55 stays after the exit. Written into X5.4's Do. |
| X4.3c | One draw a segment, as Babylon drew it, or a palette fold like the bodies' kit? | **Decided** 2026-10-31: one draw a segment. It is one instance, the finishes differ per group in spec and mirror as well as colour, and a fold re-orders equal-depth ties for an unmeasured gain; a fold is a later, measured step if a capture ever names the gun. |
| X4.4 | One step or several? | **Decided** 2026-11-01: five sub-steps (X4.4). X4.4a widens the bank first (a row for every pool, the one `blast` row being all it held) and records the round's pipeline creations; the pools then move grouped by how they are drawn — the plain mesh pools and the brass (X4.4b), the blast and the Havok-posed pieces (X4.4c), the fires with the held-caster layer's deletion (X4.4d) — and the declared pipeline list and the empty-group seam's check go last (X4.4e), once every pool has moved. None is meant to change the picture; any that does lands alone (rule 2). |
| X4.4b | The fading sparks, dust discs and scorch sort among the see-through panes in Babylon's transparent list, and no draw point of ours reproduces that: hook the panes, take a recorded picture change, or wait? | **Decided** 2026-11-01: wait. The three pools stay Babylon meshes (their warm poses with them) until X4.6 takes the glazing, and move with it so one sort of ours orders every blended surface. No picture change, no new reach into Babylon's queue, no stand-in mesh; `fx-glass-sort` is X4.6's BEFORE. |
| X4.4c | `FINDINGS.md` 58: X4.4c kept Babylon's stale-bounds latch for the debris, byte for byte — no rubble chunk is ever drawn in a live round (its bounds were computed once at its park, a kilometre under the map), and a glass shard is measured from the map's ORIGIN once a burst, so a far pane's smaller pieces never draw (Cinderhaven). The bank's `fx-blast-*` rows show rubble only because the harness's `scene.isReady()` computed the meshes' worlds, which `waitUntilDrawn` now restates. Fix it (gate every piece on its sphere composed this frame, the pieces' rule since finding 67 — one line in `poseView.writePosedDrawing`), and when? | **Decided** 2026-11-01: fix it now, as its own commit — a deliberate picture change (rule 2): every shard and chunk gated on its world sphere composed THIS frame (the hulls' and the pieces' rule), the gate sphere and the harness's refresh deleted, Babylon's latch dropped on purpose. Landed the same day (X4.4c's note); every rubble burst now draws in a round, and the half of a far Cinderhaven pane the latch dropped. |
| X4.4b | `FINDINGS.md` 67: X4.4b kept Babylon's stale-sphere latch, under which a spent case first thrown far from the world origin (and a mine's plate, an arming mine, a rocket's tail) is never drawn. Fix it, and when? | **Decided** 2026-11-01: fix it now, as its own commit — a deliberate picture change (rule 2): every cel part of a piece gated on its world sphere composed THIS frame, the hulls' rule (X4.2b), the latch dropped on purpose. Landed the same day (X4.4b's note). |
| X4.5 | One step or several? | **Decided** 2026-11-02: three sub-steps (X4.5). X4.5a fixes the empty-group seam, adds a draw point ahead of group 0's opaque list and widens the bank to the sky before any sky mesh moves; X4.5b moves the clouds; X4.5c moves the dome and the moon, which empties Babylon of the sky. |
| X4.5a | What does the sky owe a state with no map, and must it be drawn under the photograph? | **Decided** 2026-11-02 by the owner, overruling part of what X4.5a settled: nothing, and no. Under the photograph, the settings and the lobby the frame is byte-equal with the sky stated away; the kit screen is not, at every turn of the ring (below). It shows in six windows (the boot's fade, ~480 ms on a local dev server and unmeasured on a phone's cold fetch; a rejected `img.decode()`, open as long as the menu stands; a building card's undecoded photograph; a lobby row on an unknown map; the DEV proving ground; and, **accepted by the owner 2026-11-03**, the photograph's fade on the way out of a round, about 300 to 400 ms on Coldharbour, over the last map's flat colour where the parent showed the dome and clouds through the picture, not among the frames compared in X4.5c's picture-change commit, and not from the round-over card, whose picture is up already). Each sky draw's `Active` asks whether a map stands, so the menu's frame keeps doing no work of ours (X4.3c's review). **What X4.5a got wrong**: the boot's fade is the RIGHT map's sky until the player steps the reel, not the wrong one, and what would replace it was no meaningful colour (`scene.clearColor` had one writer, reached only from the editor and `startRound`: Babylon's default slate at the boot). So the colour is set at the boot from the boot map's `skyColor` (`applyClearColor`, landed at this review and moving no pixel under today's dome), and the fade shows the right map's colour through the post chain. It is not extended to the reel or a teardown: after a round it is the last map's. Taking the sky off those windows is a picture change, in a commit of its own at X4.5b and X4.5c. How that divides between the two was the implementer's and no part of this decision: X4.5b left the clouds' `Active` to X4.5c, and that is moot now, the whole sky having left the menu in one commit (7787229). **Decided 2026-11-03 by the owner, no picture change:** the clear's alpha of 1 is kept, a constant half stroke on the kit screen's weapon. The old picture's stroke varied with the cloud behind the weapon and the new one does not: ring on against ring off at the parent, Coldharbour is 0 px at turn 0 and 35 to 209 px, up to 73/255, at five other turns, the first about 5 minutes on the menu, and Hollowmere, with no ring, 0 px at all 8. Two further turns read 539,279 px with the weapon darker, excluded from those figures: the clouds' shadow, which still reaches the kit stage (X4.5c's note). And the shafts' soft bright band over the flat colour on Harrowmead and Kurenai is accepted. X4.5c's note states one window the six do not name (a step's cross-fade), not ruled on. |
| X4.6 | One step or several? | **Decided** 2026-11-03: five sub-steps (X4.6). X4.6a fills the bank's gaps and records where each surface sits in Babylon's frame; X4.6b moves the flags and the rings, X4.6c the grass and the turf, X4.6d the water; X4.6e moves the glazing with the sparks, the dust discs and the scorch, so one sort of ours orders them (2026-11-01), and may land `backed` panes ahead of it. The scorch is ported exactly; a port that cannot match comes back to the owner with the numbers. |
| X4.6c, X4.6d | An editor build's grass, turf and water are no world surfaces (X4.6a): do these steps move them there too, one path through each system as the sky did at X4.5c, or keep them Babylon's until X5.3, two paths? | **Decided** 2026-11-03: they move there too, one path through each system. Each step's Verify gains an `F2` in an editor build and a rect edit. The editor's GLAZING still stays Babylon's until X5.3. |
| X4.6c | At `"first"` the blades fall ahead of water they were behind, and at `"beforeAlphaTest"` behind water they were ahead of (X4.6b's review): if no point holds the bytes at a shore, do the blades and the water move together, or is the tie taken as a picture change? | **Decided** 2026-11-04, by the owner: **X4.6c's moving draw point and its rare distant flips are accepted as a recorded, temporary picture difference until X4.6d, which must make those poses exact again.** How it came about: neither fixed point held (`greyfen-shore-ahead` 355 px by 60/255 and `harrowmead-shore-ahead` 251 px by 154/255 at `"beforeAlphaTest"`; `harrowmead-shore-behind` 58 px by 76/255 at `"first"`), which is the case the plan said comes back to the owner. The implementer built a third option instead of stopping, a point chosen each frame by Babylon's own comparison (`Game.grassPull`), which holds all 136 rows, and landed it as "no change to the picture". The phrase it worked from, "try moving where it helps", was in the orchestrating agent's brief to it, not in the plan, and was ambiguous; that same paragraph told it to stop and report if neither point held. X4.6c's review found the record understated the result: it said only Hollowmere could flip, and that none had. **The worst, which the owner saw**: a frame reaching reedy bodies either side of the key, Sarab `[250,8,50]` to `[-194.75,-6.0,-69.75]` at 9.8° 29 px by 41/255; `[-100,8,-175]` to `[-198.75,-0.52,51.25]` at 9.8° 22 by 95/255; `[50,8,-50]` to `[253.25,-6.29,-48.75]` at 9.8° 12 by 58/255; `[-275,8,50]` to `[273.25,-6.22,-44.75]` at 9.8° 16 by 34/255; `[-275,1.6,-150]` to `[79.25,-5.66,-39.75]` at 9.8°, standing eye height, 6 by 43/255; Hollowmere `[-50,8,-70]` to `[12.25,-1.8,-100.75]` at 54.4°, the hip, 1 by 5/255; `[-60,8,-80]` to `[14.25,-1.66,-93.75]` at 13.75° 4 by 1/255. Scans aimed at this case, so no rate of play: Sarab moved 20 of 300 poses at mid range and 14 of 300 at long range, Hollowmere 9 of 300 (at most 2 px there), Kurenai 0 of 300. `sarab-shore-flip` banks it (27 px by 54/255, `exact.mjs`'s `EXPECTED_MOVES`), and X4.6d's brief removes that entry and owes the row byte-equal to 21839d1's truth. **They ended at X4.6d** (5f26b00, 2026-11-04): with the water ours the blades, the zones and the water are one nearest-first run at one point, `sarab-shore-flip` is byte-equal to its truth, every pose above and all 1,201 poses of the scans byte-equal to 21839d1, and the entry is removed. |
| X4.6e | `ShadowSystem`'s blob shadows are a Babylon `StandardMaterial`, blended, no depth write, on the list X4.6e replaces, and were on no step's list (found by X4.6a's review): where do they go? | **Decided** 2026-11-03: X4.6e's one commit. The blob joins the see-through panes and the three pools under one sort of ours, and `warmBlob` goes with it. |
| X4.6e | A blob's disc faces DOWN on a back-culled material, so it draws nothing from above (X4.6a's review, `FINDINGS.md` 67; `docs/rendering.md` calls it the contact term): port it as it is, fix the facing as a picture change, or delete it? | **Decided** 2026-11-05 (owner: flip to face up). Ported byte-identically, face down, in X4.6e's second commit, then turned face up in a commit of its own whose subject starts `Picture change:`, with the bank's numbers; `FINDINGS.md` 67 deleted as fixed. Seen from above now, the floor's side, and from below not at all. |
| X4.6e | X4.6e's review: the scorch and the blob were gated on this frame's sphere, where Babylon's size gate LATCHED — it read a mesh's bounds as of the last time its world was computed, which only a candidate it kept was, so a mark or a blob never computed was measured at the world origin and stayed dropped (381 m and 229 m at a 384-pixel-high viewport, 1,072 m and 643 m at 1080p), and the bank could not see it, its harness's `scene.isReady()` computing every mesh's world. X4.6e's note called the two the same. Port it, or keep this frame's? | **Decided** 2026-11-06 by the owner: port it exactly, then drop it in a commit of its own whose subject starts `Picture change:`, as X4.4b and X4.4c did for the pieces and the debris. The port (`Fade.gate`, the warm-up's computation of the last free mark and the player's blob, the harness's restated refresh) matched Babylon's gate decisions on every frame of a live probe at 8bf7789, then went; the numbers are in X4.6e's review's note. |
| X4.7 | One step or several? | **Instructed by the owner 2026-11-07**: X4.7 implemented in sub-steps, each implemented, reviewed and fixed by agents. **The four-way split below was proposed by the orchestrating session and run under that instruction**; the owner decided the X4.7c editor-order row (below). Four sub-steps (X4.7). X4.7a widens the bank at the parent, before anything moves (the ash as a map runs it on an ADD and a STANDARD field, a wash over sand, one over water, a ring and the ash in one frame), records where each system sits, its pass splits, its random draws and its pipelines, and keeps a live probe of each field's emission; X4.7b answers the profiler's `drawWorld`, so captures across the moves compare; X4.7c builds the machinery and moves the ash (Babylon's WGSL as compiled, its buffers, its random draws, its clock, its place in the frame); X4.7d moves the wash and takes Babylon's particle system out of the scene, deleting the gradient rule. None is meant to change the picture; **a port that cannot match STOPS and comes back to the owner with the numbers**, never a third option (X4.6c's row). |
| X4.7 | **OPEN.** X4.7 keeps the particles where Babylon drew them: after the turf, ahead of the moon and of the one back-to-front run (`FarthestRun`). So the moon paints over a mote in front of it, and a see-through pane or a fade paints over a particle whether it stands in front of it or behind, none of them writing depth. Once the particles are ours they could be ordered among the panes and the fades, and the moon could stand behind its ash, which `docs/rendering.md` already calls "the better picture and the owner's to ask for". Keep Babylon's order, or change it after X4.7? | Keep it through X4.7, which ports it byte for byte; a change is a picture change of its own (`Picture change:`, the bank's numbers), after X4.7d, by the owner's word, and needs a sort key a FIELD can give (its emitter, or its own extent), which is a design of its own. Not blocking: no sub-step needs the answer. |
| X4.7c | In one dev-only flow — `F2`, an in-memory edit of `particles.count`, the editor's rebuild, then leaving back to a round on Sarab or Cinderhaven — Babylon put the motes BEHIND its live rotor rings (the rebuilt field going to the end of `scene.particleSystems`), where ours keeps them AHEAD at `"particles"`. ADD motes over STANDARD rings do not commute, so overlapping pixels would differ there — reasoned, not measured: no bank row reaches the flow. In the editor itself no pixel differs (the rings are cleared to count 0 and there is no fleet, so Babylon's render returns early); only the probe's order and the order of the `Math.random` draws differ. No shipped flow reaches it: every shipped map and the proving map has a distinct `floorColor`, so every map change rebuilds the rings after `atmosphere.apply` and the motes stay first; a second round on one map rebuilds neither; a server's rotation takes the same `installMap` path; no setting rebuilds the ash. Accept it, or hold X4.7c? | **Decided** 2026-11-07 by the owner: **accepted as a recorded, dev-only order difference until X4.7d**, which puts the rings in `ParticleDraw`'s one creation-ordered list and so restores Babylon's order; X4.7d's Verify shows the flow back in that order against a BEFORE at 312dc44. **Ended at X4.7d** (999d4ca): the rings in the one list, the probe's editor orders and draws — through the round after — equal to 312dc44's. How it came about: X4.7c's implementer was told by the orchestrator to stop and report this, and landed it flagged instead ("For the owner" in its entry); the brief's own stop condition was a SHIPPED flow with a ring ahead of the motes, which none is. |
| X5.1 | One step or several? | **Instructed by the owner 2026-11-07**: X5.1 implemented in sub-steps, each implemented, reviewed and fixed by agents. **The two-way split was proposed by the orchestrating session and run under that instruction**: X5.1a the instruments (no change to the game), X5.1b the volume's GPU half (X5.1). |
| X5.1b | An editor build (`F2`) samples the volume's seven textures through Babylon's cel materials until X5.3 (X5.1a: ~100,000 binds of each in 120 editor frames; none in a round). Once the textures are ours, what do those materials sample? | **Answered** 2026-11-07 by the owner: **no GI in an editor build until X5.3**, not a wrapped view. Babylon's cel materials in an `F2` build sample nothing of ours: they are given what GI `off` gives them (1×1×1 placeholders of Babylon's own and a volume that answers "nothing here"), so an editor build's Babylon world draws as if GI were off. A dev-only picture change in its own commit whose subject starts `Picture change:`, with the editor's frames before and after (rule 2), made FIRST, while Babylon still owns the volume, so the move after it is graded byte for byte against it; round rows may not move in it (`exact.mjs`). The editor regains GI at X5.3. (The planning session's recommendation was the wrapped view.) |
| X5.1b | The trace's cloud-field sampler depends on the session today: our host's own object (clamp, anisotropy 4) once Babylon's light shafts or an editor build have bound the texture, repeat and nearest-mipped at anisotropy 1 in a session where neither has (the light shafts off from boot). X5.1a measured no byte of the trace's output move between them over 256 serially traced probes (16,384 rays) from a fresh history on Coldharbour, whose trace samples the field (`cloudArea.w` 0.45) and none of whose hits came near the field's edge, where clamp and repeat part. Hollowmere's run is no evidence: its trace never samples the field (`cloudArea.w` 1). Sarab and Cinderhaven, where an edge may fall inside the window, are unmeasured. Which does ours bind? | **Answered** 2026-11-07 by the owner: **the host's, always.** The trace binds the cloud field with the sampler our frame resolves for it (`hostTexture`, `host.bind`), dropping Babylon's dependence on whether the light shafts have bound it. The probe fields X5.1a's review named as expected to differ under this answer (X5.1b's Verify) are the expected differences; nothing else may differ. |
| X5.1b | The trace RACES at the game's budget (X5.1a: it reads history another workgroup of the same dispatch is rewriting, by design), so no two runs of the parent agree on its colour lanes before convergence. Is X5.1b's byte oracle for those lanes the probe's `serial` scenarios and the bank's converged rows, every other byte of the probe compared everywhere? **How thin that oracle is** (X5.1a's review): a `serial` scenario traces 96 probes of 73,728 (64 of 24,576 at low; 256 in the sampler scenario) one workgroup a dispatch from a FRESH history, so most of the history reads the trace makes (`volumeAt`, the probe nearest a hit) find a probe nothing has traced and return the fallback, and a carried lamp's fast bounce likely reaches no valid probe at all (reasoned from the counts, not measured); the bank's rows are the converged fixed point, which a wrong order of reads can converge to as well. | **Answered** 2026-11-07 by the owner: **(a), `serial` and the bank's rows.** The trace's colour lanes are compared byte for byte only in the `serial` scenarios (the trace's budget forced to 1); at the game's budget the oracle is the bank's converged rows plus every deterministic lane the probe compares. The trace is NOT changed. (Before the answer: The planning session's recommendation was yes: making the trace order-independent (a second state buffer, or a read of last frame's) would be a picture change of its own (rule 2), not part of the port. The options as they stand: (a) yes, the oracle as it is; (b) widen it first, instruments only — serial steps over far more of the volume, so the history it reads is mostly traced (its cost in minutes a map not measured); (c) the trace order-independent first, a `Picture change:` of its own with the bank's numbers, after which every lane is an oracle at the game's budget.) |
| X5.2 | One step or several? | **Instructed by the owner 2026-11-07**: in sub-steps, each implemented, reviewed and fixed by agents. **The split was proposed by the orchestrating session** from a planning agent's read at 33a8d35: X5.2a the instruments (no change to the game), X5.2b the glow's blur and downsample, X5.2c1 the chain's host and the grain, X5.2c2 motion blur, the shafts and FXAA, X5.2d the ink and the compose (X5.2). |
| X5.2 | **The shape**: our post passes cannot record on the upload encoder (they read the main pass's output) and there is no public way onto Babylon's render encoder. (A) our draws in passes Babylon opens, into targets Babylon owns, until X5.4 — the glow mask's precedent, no seam item, `gpu.frame` keeps its meaning; or (B) our own encoder and targets submitted after Babylon's frame, the canvas taken through the DOM context — the post chain's GPU time leaves `gpu.frame`, a report version and a `gpu.post`, `FINDINGS.md` 52's baseline read as their sum? | **Decided** 2026-11-07 by the owner: **(A)**, the recommendation. X5.4's Do gains the post passes' targets and passes. Under (A) the chain moves tail first, ink last, the glow's blur ahead of it (X5.2). |
| X5.2 | **The mask**: the gate note said items 2 to 5 retire "for the mask at X5.2", but moving the mask alone retires no item (the main pass still uses them until X5.4), and moving it now would cost an editor build its emissives' bloom until X5.3 (a dev-only picture change) and a depth-attachment view of Babylon's depth. Move it at X5.2 (an X5.2e), or keep it Babylon's? | **Decided** 2026-11-07 by the owner: **keep the mask Babylon's through X5.2**, the recommendation; it moves with the main pass at X5.4 (or at X5.3), and the gate note is corrected. |
| X5.2 | **Render scale**: the entry named it, and X5.4 owns "the canvas: size, DPR and render scale". | **Decided** 2026-11-08 by the owner, the planner's recommendation: X5.4 owns the setter; X5.2 owes a chain correct at every scale, proven by X5.2a's rows (`post-scale50`, `post-scale75`). |
| X5.2 | **`FrameDepth`**: named by X5.2, listed as X5.4's by the seam header and the gate note. | **Decided** 2026-11-08 by the owner, the planner's recommendation: X5.2d makes it read the public `renderTarget.depthStencilTexture`, taking its internal off the seam header's "not here" list; X5.4 deletes it once the depth is ours; X5.2d reconciles the seam header and the gate note. |
| X5.2 | **Port as compiled, or rewrite the passes as composable functions** to keep the door open for fusing? | **Decided** 2026-11-08 by the owner, the planner's recommendation: **as compiled**; the door is the host's structure (X5.2), and a fusion, never byte-exact, is a later `Picture change:` with the bank's numbers. |
| X5.2 | **Pipelines**: the blur's text depends on the scaling level and the glow rung, the shafts' on their rung. | **Decided** 2026-11-08 by the owner, the planner's recommendation: every volumetric rung and both glow rungs' blur variants at the current DPR declared at construction, so a setting changed in play compiles nothing; a compile on a DPR change allowed (the seal's DEV warning lifted for that case alone). |
| X5.2 | **A DPR change in play** (X5.2b's review): our blur's new widths compile off the frame (`createRenderPipelineAsync`) and the blur is skipped until they are built — ~3 frames on the Windows box, on which the glow's targets, recreated zero-filled by the resize the change brings, hold nothing, so the ink composes NO bloom. Babylon compiled a new width synchronously at its first draw (`createRenderPipeline`), taking a hitch and drawing the bloom. X5.2b's record called the skip parity. The same holds for a ratio changed in the MENU: its widths are declared after the round's list is taken, so the warm-up does not wait for them and they can skip the same way in play. Compile them where Babylon did (a hitch, the bloom drawn), or accept the skip? | **Decided** 2026-11-08 by the owner: **accept the skip, recorded as a known live difference**. The code is unchanged; the record says what happens (`render/GlowBlur.ts`' and `shaders/GlowPass.ts`' headers, `docs/rendering.md`, X5.2b's entry and its note), and no longer calls it Babylon's behaviour. |
| X5.2 | **A profiler report version.** | **Decided** 2026-11-08 by the owner, the planner's recommendation: none under shape (A) while `render`, `glow` and `gpu.frame` keep their meaning, which each sub-step checks rather than assumes; a sub-step that moves a draw out of its span (the blur's out of `glow`) bumps the version and says why. |
| X5.2 | **X0.3's scope** in the whole step's Verify. | **Decided** 2026-11-08 by the owner, the planner's recommendation: the desktop `bench.mjs --max`, three runs at the parent and three after; a phone `?bench&gpu` capture optional and the owner's, the Verify not waiting on it. |
| X5.2 | **"The bank with every post setting on and off"**: the bank holds one row a setting off, none with every tail pass off. | **Decided** 2026-11-08 by the owner, the planner's recommendation: X5.2a's added rows (`post-alloff`, `post-damage`, `post-scale50`, `post-scale75`, `post-glowlow`) beside the bank's one-pass-off rows are its meaning; no pairwise or full-combination rows. |
| X5.4 | Phase 4's gate found the canvas and raw textures our draws read through the seam (`hostTexture`: the motes, the puff, the scorch, the blob, the sky's, the cel materials' own, the shadow maps it wraps) named by no step before X6.1, X5.4's foam item covering only a texture Babylon decoded and mipped. When do they go? | **Decided** 2026-11-07 by the owner: in X5.4, beside the foam, as one item under one bank proof — the five ours alone since Phase 4 wait only for that, the cel materials' and the shadow maps' because an editor build samples them until X5.3; `GiVolume`'s seven stay X5.1's. |
| X6.2 | Is it ready to merge to `develop`? | Only when X6.2's "Before" list passes in full. |
