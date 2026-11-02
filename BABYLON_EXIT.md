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
- **The empty-group seam is X4.5's**: over the menu, with the kit screen up
  and no map, the sky is the only thing of Babylon's left in group 0 (X4.3d
  measured it never empty); whichever of X4.4-X4.6 drains the group owes the
  fix.
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
  beside the map's own pipelines, which its install asks; and our cache is
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
  warns of (`Game.applySky`); `Renderer`'s warning stays.
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

### X4.5 — Sky and clouds — **M**

The dome, stars, moon and cloud ring (`Sky`, `cloudMasses`, `CloudShader`).

- **Do:**
  - **The empty-group seam** (decided 2026-10-31, X4.3c's review): every
    draw of ours hangs on rendering group 0's three points, and Babylon
    visits no empty group — so a frame on which group 0 dispatches no mesh
    of Babylon's runs NONE of ours, silently (a DEV build warns once per
    change, `Renderer`). This step takes meshes out of group 0; whichever of
    X4.4, X4.5 and X4.6 leaves it able to be empty in some state (the kit
    screen over the menu holds the sky alone since X4.3d) owes the seam a
    fix — our draws must not depend on group 0 being non-empty (a point of
    ours that does not ride Babylon's group, or a mesh kept in it on
    purpose, stated as such). **It is THIS step's** (X4.4e measured it):
    X4.4 left the seam unreachable, and what holds group 0 in every state
    is the sky's dome and cloud ring — over the menu with the kit screen up,
    nothing else — so the step that takes them owes the fix. A seam-safe
    shape is a question for the owner if it needs a NEW Babylon internal on
    `babylonSeam.ts`'s list (rule 4), and stops there. Today a map stating
    no `sky` empties the group over the menu already, which a DEV build
    warns of (`Game.applySky`); no shipped map does.
- **Contracts it keeps:**
  - the clouds write the depth of a point 7 km out
  - they draw after every opaque surface and before everything blended
  - the moon is exempt from the bloom's fog fade (`infiniteDistance` today)
  - the cloud shadow on the ground (`cloudShadow`)
- **Verify:** the bank on every map, the night map included.

### X4.6 — Water, glazing, grass, flags and capture rings — **M–L**

- **Do:**
  - `WaterSystem`: its bed-depth bake and its probes.
  - See-through glazing over X3.6c's cubes, and `backed` panes, which write
    depth — Babylon meshes in a round until here (`PaneBlocks`, the breakable
    panes `GlassFx` writes included; X3.7 keeps them).
  - `GrassSystem`'s field around the eye (thin instances, its own frustum
    test).
  - `FlagCloth`, and `CaptureZoneSystem`'s rings.
  - **The three blended pools X4.4 left Babylon's** (decided 2026-11-01,
    X4.4's "Find out first"): `CombatFx`'s sparks and dust discs and
    `BlastDebrisSystem`'s scorch (a `StandardMaterial` decal, ported or
    taken as a recorded picture change). Babylon draws them back to front
    by bounding-sphere centre, INTERLEAVED with the see-through pane blocks;
    with the glazing ours, one sort of ours orders all of them, and
    `fx-glass-sort` (a fade squarely behind and squarely in front of a pane)
    plus `fx-glass`, the impact rows and the scorch rows are the BEFORE.
    Their `warm(on)` poses go into X4.4e's declared list then.
  - **The empty-group seam** (decided 2026-10-31, X4.3c's review): every
    draw of ours hangs on rendering group 0's three points, and Babylon
    visits no empty group — so a frame on which group 0 dispatches no mesh
    of Babylon's runs NONE of ours, silently (a DEV build warns once per
    change, `Renderer`). This step takes meshes out of group 0; whichever of
    X4.4, X4.5 and X4.6 leaves it able to be empty in some state (the kit
    screen over the menu holds the sky alone since X4.3d) owes the seam a
    fix — our draws must not depend on group 0 being non-empty (a point of
    ours that does not ride Babylon's group, or a mesh kept in it on
    purpose, stated as such).
- **Contracts it keeps:**
  - no pane of either kind casts a shadow
  - see-through glazing writes no depth
  - the ring is the zone's boundary
  - the coverage alpha's two blended exceptions (`docs/rendering.md`)
- **Verify:** the bank's water and glass vantages; Greyfen's grass at every
  rung; a flag captured.

### X4.7 — GPU particles — **S–M**

`Atmosphere`'s ash and `RotorWash` (`GPUParticleSystem`,
`CylinderParticleEmitter`) as our own compute particles over `puffTexture`.
The rule that a colour gradient can only be added before a system's first
render goes away with Babylon's particle system.

- **The rotor wash compiles in play today** (X4.4e measured it:
  `pipelines.mjs cinderhaven --round`, two of Babylon's pipelines in every
  run — the wash's compute and render, on the first frame a helicopter
  raises dust; `FINDINGS.md` 16). Ours, its pipelines join the round's
  declared list (`Game.roundPipelines`), and the count goes to zero.
- **Verify:** the bank with ash; a helicopter landing on sand and on water;
  `pipelines.mjs cinderhaven --round` zero in play.

**Gate after Phase 4:** Babylon's scene draws only the post chain. Read
`babylonSeam.ts`'s list against PERF_PLAN B4's criterion. If the count of
internals is still high, it is a measure of how much risk Phase 5 removes.

---

## Phase 5 — The frame

### X5.1 — GI and the compute passes are ours — **M**

`GiVolume` (`ComputeShader`, `StorageBuffer`, `RawTexture3D`) on our side.
With no Babylon material left sampling its seven textures, nothing needs a
wrapped view. Its continuous, fixed-ray-set behaviour and the `fast` lights
hold.

- **Verify:** the bank; GI on and off at each tier; a lamp switching on
  reaching the bounce within one sweep.

### X5.2 — The post chain — **M**

`FrameDepth`, `CelInk` with the glow's compose in its last line, the glow's
mask and blur, FXAA (already our own shader), `Volumetrics`, `MotionBlur`,
`PaperGrain`, and render scale. The chain's order becomes explicit, so the
slot-claiming tricks `Game` uses today (attach, then detach, to hold a place
in an append-only list) go away.

- **Keep the door open for the GPU side** (deferred until after the exit;
  "What this plan does not do"). The full-screen passes after `CelInk`
  (FXAA, the volumetrics, the blur, the grain) are written so that two
  neighbours can later be FUSED into one pass reading the same input, rather
  than each one hard-wired to read and write a target of its own. On a
  phone every full-screen pass is a whole frame's reads and writes, and the
  `gpu.mainPass` lead in `FINDINGS.md` 52 points here. Fusing them is not
  this step: this step only must not make it a rewrite.
- **Verify:** the bank with every post setting on and off; X0.3.
- **Rewrites:** `docs/rendering.md`'s post sections; the glow rules in
  `CLAUDE.md`.

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
- **Verify:** select, drag, rotate, sculpt, lay a path road, save — and
  confirm the save patches `layout.ts` byte for byte for untouched entries
  (`docs/editor.md`). `merge:hash --editor`.

### X5.4 — Take the frame — **M**

- **Do:**
  - Our own `requestAnimationFrame` loop.
  - The canvas: size, DPR and render scale.
  - Device-loss recovery, tested by destroying the device on purpose.
  - `FrameCap`.
  - `FrameProfile`'s `hookRender` and `hookEngine` replaced by spans around
    our own passes. `present` becomes the span around `queue.submit`; `?gpu`
    uses timestamp queries.
  - `PipelineWarmup` becomes waiting for X4.4's list.
  - Delete `webgpuLeaks.ts`.
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
| `CLAUDE.md`: the pipeline warm-up | X4.4, X5.4 |
| `CLAUDE.md`: a colour gradient changes a particle system's vertex layout | X4.7 (deleted) |
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
| X6.2 | Is it ready to merge to `develop`? | Only when X6.2's "Before" list passes in full. |
