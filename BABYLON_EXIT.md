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
  `noShadowCaster`;
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

### X4.3 — The viewmodel and the kit bay — **M–L, as four sub-steps** (split 2026-10-31, decided the same day)

The player's own weapon — whichever of the nine carried rigs is up, its
optic, both gloved arms, the throwing fist with its grenade or bottle, the
spent magazine and the muzzle flash hung off it — comes off Babylon's scene,
and so does the kit screen's card behind it. Nothing here is a PERF_PLAN
item and **no sub-step changes the picture**: unlike X4.1 and X4.2 there is no
fade or tier to build on the result, so all four are proven byte-identical
and each lands on its own leaving the game shippable. If one cannot be — an
equal-depth tie the new order loses, a canvas upload that rounds differently
— that difference is broken out into a commit of its own with the bank's
numbers (rule 2), never absorbed. It is split so the instrument comes first,
the hierarchy moves before the draw (X4.1a's and X4.2a's shape), and the two
BLENDED surfaces — the lens glass and the kit card, the riskiest draws in the
step and the only ones whose slot is load-bearing — move last and alone.

**What the viewmodel is today** (`entities/ViewModel.ts`): a tree of
`TransformNode`s parented to the CAMERA (`body` → `weapon` → one root per
carried id → the model's `parts.root`, the two arms, the magazine and its
spent clone, the bolt, the slide, the warhead, one `SightAssembly` root and
`sightCenter` per optic; `throwHand` → the fist, the pip, the bottle; `muzzle`,
`ejectPort`; the card), every weapon and every optic BUILT up front and all
but the carried ones switched off (`applyFit`, :1135). The pose stack is
additive layers into `pos`/`off`/`rot` written onto `weapon` once a frame
(`update`, :1403; `applyPose`, :1778). Four things in it are outside what
`rigJoints.ts`' `Joint` models (its header: "No joint here has a pivot … a
quaternion of its own"): **pivots** (`setPivotPoint` on both arms, the
magazine and its spent clone, :836-852, and the launcher's warhead,
`RpgModel.ts:272`); **a quaternion that overrides the Euler** (both arms
always, `weapon` on the turntable, :838-839, :1272/1290); **the camera as the
root** (its world is the inverse of its view, which Babylon makes); and
**meshes that parent meshes** (the fist's `ball` → `pip`; `buildMolotov`'s
bottle → neck, cloth, wick). Its surfaces are four kinds of material: cel
matte and glossy (`mats.get` / `getGlossy`, the finish ladder's mirror rung
included), `getEmissive`'s unlit `StandardMaterial` (every reticle, bead and
post — the posts are emissive BLACK, `optics.ts:553` — the pip, the wick,
the flash), the two lens glasses (a `StandardMaterial` of their own per
weapon, alpha 0.12 and 0.07, blended, `optics.ts:807-839`, `:912-931`), and
the card (`StandardMaterial` over a 256² `DynamicTexture`,
`ALPHA_REPLACE_COLOR` at alpha 0, depth `ALWAYS` with `forceDepthWrite`,
`ViewModel.ts:231-299`). Every viewmodel mesh and the flash's petals are in
`VIEWMODEL_GROUP` (1) (`ViewModel.ts:956`, `PlayerView.ts:101`); **the card
is NOT** — it is the last blended mesh of group 0 (`alphaIndex` `Infinity`),
which is the slot that makes it cover the world and be covered by the gun.
**Group 1's depth is NOT cleared** (`Game.ts:1775-1782`): the frame keeps one
depth image of the world and the gun, which `FrameDepth` hands to the ink
(`ink.near`), the motion blur (`nearSharp`/`nearFull`) and the paper
(`heldWithin`), and against which `GlowPass` occludes — all of which name
the gun by DEPTH alone, so a draw that writes the same depth keeps them.

**Two of its reads decide an OUTCOME** (`FINDINGS.md` 55): the grenade's
release point is `throwHandWorld()` (`Game.releaseGrenade`, `Game.ts:9881`)
and the rocket's start is `muzzleWorld()` (`Game.launchRocket`, :7093), each
submitted as a command's `origin`. Both read Babylon's render-id cache
(`getAbsolutePosition`, unforced): the world the LAST render composed, or a
fresh compose where the node was not drawn in it — "one frame stale", as
`throwHandWorld`'s own comment says. `ejectPort` (the brass) and
`evaluateReload`'s `parts.root.getWorldMatrix()` (the magazine's fall, :1922)
read the same cache for the picture.

- **X4.3a — the bank sees the viewmodel (no change to the game).** The bank's
  ten `view-*` rows (`bench/vantages.ts:518-543`, Harrowmead by day) hold
  five of the seven optics (no `greenDot`, no `longScope`) on five of the
  nine rigs (no DMR, no pistol — the one FIXED sight, at its own eye relief —
  no launcher, no mine), every one at rest, matte, and none on the kit
  screen. Rows are added for what X4.3b-d move and the ten cannot see:
  `greenDot` and `longScope` hip and aimed; the pistol, the launcher (its own
  prism, `RpgModel.ts:293`) and the mine; one finish on each rung of the
  gloss ladder above matte, the mirror rung (`spec.rifleChrome`) among them;
  the gestures held mid-phase — a dry reload (both magazines, both pivots,
  the body's counter-turn), the bolt cycle, the launcher's load, a frag and a
  molotov mid-throw, a shot's flash on a seeded strobe; and the kit screen, by
  raising the REAL lid over `deploy` (the card, the bench lamps, the glow's
  stage rule) with the DOM's bay replaced by a stated one, at a desktop's
  bay and a phone's. The existing `view` field takes a `params` override
  (`ViewModelParams` as stated) and a `finish`; a `kit` field is new
  (`harness.mjs`' `placeVantage`, :369-378, and its put-away). **Appended at
  the END of Harrowmead's sequence**, because a row's frame depends on the
  rows shot before it (`plans/webgpu-ref/README.md`), and banked with
  `--rows`. It lands before X4.3b so every later sub-step's BEFORE has them.
  **Oracle:** `bank.mjs --check` twice back to back, every new row
  byte-identical to itself; every old row unmoved against a BEFORE at the
  parent; each new row LOOKED at and its `proves` true of it.
- **X4.3b — the viewmodel's joints are ours (no picture change, no outcome
  change).** The tree becomes a `JointTree` (`rigJoints.ts`, X4.1a's), its
  joint list the node list in the order the nodes were made, and `Joint`
  gains exactly what the viewmodel needs and the rigs never did: a PIVOT
  (Babylon's pivot path, `transformNode.pure.js`' `computeWorldMatrix`: pivot ×
  scale × rotation × pivot⁻¹, the translation added after), a ROTATION
  QUATERNION that overrides the Euler while set, and a ROOT held off an
  outside matrix (the camera's world, copied as the render will use it).
  Whatever of that `src/math` lacks (`Matrix.ScalingToRef`,
  `addTranslationFromFloats`) joins it with its `math-check` case, and the
  pose math moves onto `src/math` with it (`ViewModel`'s scratch,
  `ReloadGesture`, `turnAboutHand`), as `solveArm` did at X4.1a. The weapon
  builders hang JOINTS, not nodes, from the root (`WeaponParts.magazine`,
  `warhead`, `bolt`, `slide`, `SightAssembly.root` and `sightCenter`).
  **Babylon still draws every mesh, and none has a parent**: each mesh's own
  local composed once, and `drawView` — beside `drawBodies` and `drawHulls`,
  once a frame in every state, after every write, immediately before
  `scene.render` (`Game.ts:4100-4106`) — hands each switched-on mesh its local
  times its joint's world through `freezeWorldMatrix`; the flash's petals the
  same off the muzzle joint. **The readers keep Babylon's answers, not fresh
  ones**: `muzzleWorld`, `throwHandWorld`, the eye port and the root's inverse
  read the world `drawView` last composed where Babylon's cache would have
  answered the last render's, and compose fresh only where it would have (a
  joint not drawn in the last render whose channels moved since) — because
  two of the four are command inputs, and `rigJoints.ts`' "every answer is
  FRESH" here would move where a grenade leaves the hand on the first frame
  of a throw. **Find out first** whether `scene.render`'s camera update can
  move the view after `drawView` (a `FreeCamera` with its inputs cleared,
  `CameraSystem.ts:375-378`, should not): if it can, the root is taken off
  the matrix the render makes. **Oracle:** each mesh's world matrix against
  its node chain's, bit for bit, at `onAfterActiveMeshesEvaluation` on the
  parent, then against our arrays on the step (X4.1a's probe), over seeded
  `ViewModelParams` sequences through every rig in every sight — hip, aimed,
  sprint, swap, both reloads, the bolt, the load, both throws, the turntable
  turned — and both trees digested frame by frame; the four readers' answers
  as float64 bits over a recorded offline round that fires, launches a
  rocket and throws both throwables, identical on both sides, and the
  `GrenadeCommand.origin` / `OrdnanceCommand.origin` it submits with them;
  `kit:hash --models`' `weapon:*`, `viewmodel` and `player` rows unmoved; the
  bank byte-identical; a netplay round with a grenade and a rocket (the
  authority's start points unchanged); "the reticle cannot lie" — fired at a
  wall at range with each optic.
- **X4.3c — the weapon drawn by us: every opaque part (no picture change).**
  The viewmodel's cel and emissive meshes — every rig's colour groups,
  magazine and spent magazine, bolt, slide and warhead, every optic's housing
  and reticle, both arms, the fist and its pip, the bottle and its wick —
  and the muzzle flash become a KIT our renderer draws (`render/`, beside
  `BodyDraw` and `HullDraw`): the arrays on the GPU once, at construction,
  for all nine rigs and every optic, a segment's matrix its joint's world
  times its own local, drawn while its joint chain is switched on. **One
  draw a segment, one instance**, the cel ones each with its material's
  recipe (`celRecipe`, the PLAIN variant — matte, glossy and the mirror rung
  differ only in values) and the emissive ones by the emissive program (the
  visor's, X4.1d: alpha 1, the fog toward the map's), and those with a
  non-black colour into the glow's mask (`Renderer.addGlowMask`) on
  `glowAdmits(VIEWMODEL_GROUP)` — the stage, which the kit screen keeps. **In
  Babylon's group-1 ORDER**: its opaque queue is `PainterSortCompare`
  (material `uniqueId`, then the order the meshes were dispatched;
  `renderingGroup.js`), which decides who wins an equal depth, so a finish,
  which swaps a group's material, re-orders it. **Where:** our draws at group
  0's `"afterGroup"` (`Renderer.ts:76-77`; no draw has used that point yet),
  which is after the card — the last of group 0's blended queue — and before
  group 1, which is left holding the two glasses. A finish becomes a recipe
  swap (`applyFinish`, `finishes.ts:401-414`) and the epoch moves. **The draw
  is installed for the SESSION, not the round**: the kit screen covers
  `menu` (`ScreenStack.ts:234-239`), where no map is installed and
  `BodyDraw`/`HullDraw` are not (`Game.ts:4978-4979`) — so every frame
  texture must be published there, or the gun is missing from a kit screen
  raised off the title (verify, `FrameTextures`' null rule). Babylon builds
  no opaque viewmodel mesh: the builders hand back segments (`WeaponBuild
  .merge`/`lit`, `buildArm`, `optics.ts`), `WeaponParts.meshes` and
  `FinishPart.mesh` become them, and `kit:hash --models` hashes the same
  arrays off them. The viewmodel leaves `WorldCulling`'s candidate list. The
  pipelines are asked ahead through `PipelineCache`. **Oracle:** the bank's
  `view-*` rows and X4.3a's byte-identical, every other row too; the glow's
  mask read back against the parent's at the aimed rows (the reticles), as
  X3.6d's was; `census --against` (Babylon's draws fall by the gun's, ours
  counted); `kit:hash --models` unmoved; every finish on every primary,
  photographed against the parent on the turntable; the kit screen raised
  from the menu and from deploy at 832x384 and 3440x1440; a round with
  every weapon, both throwables and both AT items; a netplay round.
- **X4.3d — the lens glass and the kit card (no picture change), and group 1
  goes.** The two glasses (the holo's disc and the reflex's canted pane, one
  pair a rail weapon) as a BLENDED draw of ours after the gun's opaque
  parts: colour `SRC_ALPHA`/`ONE_MINUS_SRC_ALPHA` and alpha (ONE, ONE) —
  `ALPHA_COMBINE`, so ink behind a lens is attenuated by its alpha as now —
  no depth written, both faces, back to front, `StandardMaterial`'s unlit
  emissive at its alpha reproduced as `EmissiveWorld.ts` reproduced
  `getEmissive`'s, never in the mask (`noGlow`). The card as a draw of ours
  at the head of the same point, before the gun: its 256² canvas uploaded as
  a texture of ours as `DynamicTexture.update` uploads it (its flip, its
  format, no mips — none were asked for — and Babylon's sampler) and
  repainted only when the bay moves (`updateInspect`, :1376-1380);
  `ALPHA_REPLACE_COLOR`'s factors — colour (ONE, ZERO), alpha (ONE,
  ONE_MINUS_SRC_ALPHA) at a fragment alpha of 0, the coverage channel
  untouched — depth `always` and written, no culling; up
  only between `beginInspect` and `endInspect`. With group 1 empty,
  `setRenderingAutoClearDepthStencil(VIEWMODEL_GROUP, false)` and
  `VIEWMODEL_GROUP` go, the glow's stage rule is stated by the draw itself
  rather than by a group id (`Game.glowAdmits`, :2156-2158), `Player
  .warmView` goes (the glass was the last viewmodel pipeline it compiled,
  `Player.ts:2494-2505`), and `FINDINGS.md` 16's "only the weapon and optic
  WORN are warmed" is settled. The profiler's `drawOverlay` was group 1
  (`FrameProfile.ts:1365-1374`) and records nothing once it is empty: it is
  retired with a report version, or re-hung on our draw. **Oracle:** the
  bank's aimed `holo` and `reflex` rows and X4.3a's kit rows byte-identical,
  every other row too; the kit screen walked through a resize, a rotation
  into portrait and the AT row arriving (the pool repainting) on a phone and
  a 32:9 window; `pipelines.mjs` creating nothing on a first ADS through
  either glass; a capture's phase tree.
- **Read first:** `docs/weapons.md` from the top to the end of the
  viewmodel's bullets (its `VIEWMODEL_GROUP` bullet is out of date: below),
  the "reticle cannot lie" and eye-relief sections; `docs/rendering.md`'s
  ink (the near band, the coverage channel), "The smear", "Our renderer's
  frame" (the three draw points, the bundle trap), the palette's mask, the
  two bullets on group 1 and the kit card, and "The bodies, ours";
  `ViewModel.ts`' header and `buildKitBackdrop`; the comment over
  `setRenderingAutoClearDepthStencil` in `Game.ts`; `rigJoints.ts`;
  `BodyDraw.ts`' header; `FINDINGS.md` 55 and 16; X4.1a's note (the stale
  reader, the oracle's shape).
- **Contracts all four keep:**
  - the reticle cannot lie: the aimed pose is DERIVED by `applyFit` alone off
    the worn sight's `sightCenter`, re-derived on every loadout change, a
    change of weapon included, and `zoomComp` scales `adsPos` and the
    weapon's scaling together
  - the viewmodel reads the camera and never writes it, and decides nothing
    but the two command inputs it is read for, whose answers stay bit for bit
  - one depth image for the frame: the gun draws into the world's depth with
    no clear, so the ink, the blur, the paper and the glow's occlusion name
    it by depth as they do now
  - the coverage channel: the cel parts write `opaqueAlpha`, the emissives 1,
    the lens glass its alpha accumulated, the card nothing
  - the card covers the world and is covered by the gun, up only while the
    turntable is; on the kit screen only the stage blooms, and no lens and
    no card ever does
  - the bay is the DOM's (`LoadoutScreen.stageBay`) and the scene follows:
    nothing here changes `updateInspect`'s fit or the bay's column
  - every rig built once and all but the carried one switched off: a
    loadout change is switches and a re-derivation, never a rebuild; the
    muzzle and the eject port outlive a swap
  - a finish is a material write and nothing else, out of the optic's and
    the brass group's reach, `standard` the built state
  - the local player casts nothing
  - the near plane (`CameraSystem`'s `minZ` 0.05) and everything bound by it
    (`kick.adsClearance`, eye relief rising with magnification) are the
    camera's: the projection is pulled off it, never restated
- **Verify, each sub-step:** the bank `--check --keep` against a BEFORE at
  the parent; `census --against`; `gate`, `shaders`; typecheck, build,
  corecheck, `parity`; `kit:hash --models`; a round offline and a netplay
  round; the kit screen from the menu and from deploy.
- **Rewrites:** `docs/weapons.md` (the `VIEWMODEL_GROUP` bullet, which says
  the depth is cleared); `docs/rendering.md` (group 1's bullet, the kit
  card's two, the draw points, "anything outside rendering group 0" in the
  size gate's exemptions); `docs/ui.md` ("The kit screen": "drawn in
  `VIEWMODEL_GROUP`"); `docs/profiling.md` (`drawOverlay`); `docs/game.md`
  (the warm-up's poses); `CLAUDE.md` (the size gate's group exemption, the
  glow's stage rule; "Every BODY AND HULL IS OUR RENDERER'S" gains the
  weapon); the contract headers of `ViewModel.ts`, `PlayerView.ts`,
  `weaponKit.ts`, `optics.ts`, `finishes.ts`, `rigJoints.ts` and
  `world/parts.ts`; `FILES.md`.
- **Not this step's: the brass** (`PlayerView`'s casing pool, cel boxes
  thrown into the WORLD in group 0, `PlayerView.ts:105-117`) is X4.4's, as a
  pool; it reads the eye port's joint from X4.3b on. The thrown grenade and
  bottle, the flying rocket and the laid mine are X4.4's too; the ones in
  the hand are this step's.

### X4.4 — The effect pools, and pipelines compiled at load — **M**

- **Do:**
  - The pools on our side: tracers, sparks, impact discs, bullet marks (a cel
    material in `WorldCulling`'s size gate today), `BlastFx`'s billows, the
    fires (`FlameMaterial`; their block merges are the one world surface
    besides glazing that X3.7 leaves a Babylon mesh in a round), grenades,
    rockets, mines, shards and debris, and the BRASS (`PlayerView`'s casing pool,
    cel boxes thrown into the world; it reads X4.3b's eye-port joint; decided
    2026-10-31).
  - **The HELD-caster layer** (`WorldBlocks.addCaster`, `BlockHandover`'s
    `held` and its DEV node check), kept by X3.7c for a casting fire and
    reached by no build (every fire is `noShadowCaster`: X3.7c's note): a
    fire of ours that casts uses it or has no need of it, and it goes.
  - **The warm-up changes shape**: every pipeline a round can use is created
    from a declared list during loading, so the `warm(on)` poses become a list
    of pipeline keys.
- **Verify:** `plans/webgpu-ref/pipelines.mjs` reports zero pipeline creations
  during a round; the bank's blast vantage; a round with every weapon, both
  throwables and both AT items used.
- **Rewrites:** `CLAUDE.md`, "loading ends in a PIPELINE WARM-UP";
  `docs/game.md`.

### X4.5 — Sky and clouds — **M**

The dome, stars, moon and cloud ring (`Sky`, `cloudMasses`, `CloudShader`).

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

- **Verify:** the bank with ash; a helicopter landing on sand and on water.

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
| X4.3c | One draw a segment, as Babylon drew it, or a palette fold like the bodies' kit? | **Decided** 2026-10-31: one draw a segment. It is one instance, the finishes differ per group in spec and mirror as well as colour, and a fold re-orders equal-depth ties for an unmeasured gain; a fold is a later, measured step if a capture ever names the gun. |
| X6.2 | Is it ready to merge to `develop`? | Only when X6.2's "Before" list passes in full. |
