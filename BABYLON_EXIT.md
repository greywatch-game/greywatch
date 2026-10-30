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

### X3.1 — The shared WGSL (PERF_PLAN B0) — **M** — **LANDED** (ab51aa7)

As B0 states it: `CelShader.ts`'s fragment factored into WGSL chunks that both
Babylon's `ShaderMaterial` and our pipelines include. Two copies drift, and
the failure is silent.

- **Do also:** our side needs real WGSL, not Babylon's dialect (`uniform`,
  `attribute` and `varying` declarations, `vertexInputs.`, `#include<>`, and
  56 `#ifdef`-family lines in `CelShader` alone). Write a small preprocessor
  for includes and defines that emits plain WGSL with explicit bind groups.
  The bodies are shared; the declarations are per side.
- **Verify:** `bank.mjs --check` with no pixel moved on every map;
  `plans/webgpu-ref/shaders.mjs`.

**Landed** (ab51aa7, review fixes f5320eb).
- **The bodies.** They are Babylon-free chunks: `shaders/wgsl/chunks.ts`
  (`WGSL_CHUNKS`, the one table) and `shaders/wgsl/celSurface.ts`. The cel
  fragment's whole body is the function `celSurface()`. A body declares
  nothing.
- **Babylon's side.** Its declarations are `includes.ts`'s `DECLARATIONS`
  and the fragment's own in `celFragmentShader`. Every registered include is
  declarations plus the body, verbatim, so grass, water and the air include
  exactly as before.
- **Our side.** `render/celFragment.ts` declares the frame (group 0) and the
  material (group 1) as data. `render/wgsl/assemble.ts` and
  `render/wgsl/preprocess.ts` turn that into plain WGSL with explicit bind
  groups. `src/render/` joined the Babylon-free gate here, a step early,
  because the directory exists from this step on.
- **Measured.** Every shader module Babylon compiles on all seven maps was
  dumped before and after. The 68 cel fragments differ only by `main`'s body
  becoming `celSurface()`, and every other module is identical up to order.
- **The bank.** 47 of 47 rows are within the floor: 45 at 0%, and Sarab's
  `rig-near` and `rig-far` at 0.0721% and 0.0014% of pixels. The parent
  commit gives those two rows the same numbers, so the banked Sarab rig
  frames are stale from an earlier commit. They are not this step's
  difference. Sarab was re-banked after X3.1 landed, and `--check` now puts
  every row on every map at 0%, which is X3.2's baseline. The bank lives
  outside git (`ref/` is ignored), so the re-bank is recorded only here.
- **`shaders.mjs`.** It is clean on seven maps. It now also builds our module
  for every shape each map compiled into a pipeline against an EXPLICIT
  layout. It was proven to fail on a uniform our side does not declare and
  on a 17th sampled texture. The bumped ground is at 16 of 16 sampled
  textures and 16 of 16 samplers on our side too.
- **What the review found.** Babylon strips the comments of the top-level
  source only, and pastes an include in whole, comments and all. So the cel
  body's ~700 lines of prose had become text Babylon's declaration regexes
  read. Nothing matched them, so nothing broke, but any comment quoting a
  declaration would have minted a binding with nothing behind it. Every
  registered entry now goes through `stripComments`, the same function our
  preprocessor runs. Also fixed:
  - the preprocessor no longer accepts `#define` (a body's define would not
    reach the declaration guards);
  - our varying locations are counted as Babylon counts them;
  - the frame block is one layout in every variant but its last field;
  - stale pointers to code that moved.
- **Owed to X3.2 and X3.3:**
  - our `main` lacks Babylon's `position.y` flip for a pass that renders to
    a texture, and the dither is keyed on that position;
  - the WGSL struct layout is not yet the layout anything uploads;
  - the vertex stage's sway is not shared yet. X3.3 needs it as a chunk, the
    same way.

### X3.2 — `src/render/`: device, pipelines, frame uniforms, and the seam — **M** — **LANDED** (e59b96a)

- **Do:**
  - The module owns its buffers, bind-group layouts and pipelines. It creates
    pipelines with `createRenderPipelineAsync`, keyed on shader variant,
    vertex layout and target formats.
  - It takes its frame uniforms (camera, fog, key light, ambient, sky fill,
    point lights, wind, the shadow matrices) from what `CelMaterialFactory`
    already publishes, as a plain struct, never by reading a Babylon material.
  - It gets the `GPUDevice` and the current pass encoder through
    `babylonSeam.ts` and nothing else.
  - It matches what the frame actually uses: the depth format
    (`depth32float`, since stencil is off; `plans/webgpu-ref/depth.mjs`), the
    colour format, the sample count, and the coverage alpha (opaque writes 0).
  - It states its attachment formats once — `docs/rendering.md`'s bundle
    trap.
  - Add `src/math/` to X2.3's gate (X3.1 added `src/render/` with the
    directory).
- **Verify:** it draws nothing yet, so the bank shows no pixel moved; the gate
  passes; a DEV-only test draw shows up where expected and then comes out.
- **Must not:** import `@babylonjs/core`; reach an internal from anywhere but
  the seam.

**Landed** (e59b96a).
- **The seam.** `render/babylonSeam.ts`'s `BabylonFrameHost` implements
  `render/frameHost.ts`'s `FrameHost`, which a host of the game's own
  implements at X5.4. It imports Babylon's types only, so the gate walks it
  like the rest of the directory. Its header numbers five internals:
  - the device;
  - the lazily-started pass;
  - `_bundleList.addItem`;
  - the pass's attachment wrapper;
  - the render target (its identity and its flip).
- **Draws are QUEUED, not issued.** Under bundles a raw `pass.draw` lands
  before every Babylon draw already in the pass. An item in Babylon's own
  bundle list runs in order at the pass's end.
- **The main pass is the target bound as the draw phase begins.** The
  window alone was not enough: the glow renders its mask from
  `onAfterDrawPhase`, so whether its group 0 fell inside the window
  depended on observer order. The review found this.
- **The attachments are stated once** (`render/targets.ts`).
  - The frame does not draw to the canvas. It draws into `CelInk`'s
    target: `rgba8unorm`, `depth32float`, 1 sample, y-flipped.
  - `Renderer` checks the open pass every frame and draws nothing into one
    that differs.
  - `PipelineCache` derives the front face by Babylon's rule: clockwise as
    authored, `ccw` under the flip.
- **The frame's uniforms.** `render/frame.ts`'s `FRAME_BLOCK` is the cel
  frame plus the camera and the wind, with the palette last.
  - `CelMaterialFactory.fillFrame` and `ShadowBindings.fillFrame` PULL it
    off the fields once a frame, and only when something draws. A push
    would miss the in-place writes: the shadow matrices, the clouds, the
    flash, the lamps' slots and the GI vectors.
  - `render/wgsl/layout.ts` computes the byte layout, and
    `FrameUniformBuffer` copies by it.
  - `assemble.ts` gained `declareGroups` and `@align(16)` on every array.
    Without it, an `f32` array after a member ending off 16 bytes is
    rejected; the frame block never put one there.
- **The gate** walks `src/math/`, with `math/babylon.ts` in `NOT_ROOTS`.
  The server typecheck gained `@webgpu/types`, because it includes
  `src/`.
- **Measured.**
  - `bank.mjs --check`: every row on all seven maps at 0%.
  - `shaders.mjs`: clean on seven maps, ours built for every variant.
  - A DEV-only draw, deleted before the commit:
    - a compute shader read the frame block back through WGSL, and 869 of
      869 floats matched, with unique values and with the real frame;
    - a triangle 10 m ahead of the deploy camera on Hollowmere landed
      upright above centre, occluded by the nearer flagpole;
    - it ran exactly once a frame for 91 frames;
    - authored clockwise it drew, and declared counter-clockwise it was
      culled;
    - removing it left 0 pixels different.
- **Rule 4, as read here.** Six older touches of internals in four files
  stay where they are: `FrameDepth`, `webgpuLeaks`, `ReflectionSystem`
  (two) and `FrameProfile` (two). None is the renderer's, and
  `FrameProfile`'s prototype patch needs a Babylon VALUE, which
  `src/render/` may not import. So rule 4 holds as "every internal OUR
  RENDERER reaches". The seam's header lists the six and the step each
  leaves at (FrameDepth at X5.4, the rest at X6.1).
- **Owed to X3.3** (all four are X3.3a's, and X3.3a's "Landed" says where
  each went):
  - the fragment's `position.y` flip, since the main pass is a texture;
  - the vertex sway as a shared chunk;
  - a hook BEFORE group 0's blended meshes, if the world must draw there
    (`RenderingGroup.onBeforeTransparentRendering`); today a draw lands
    after the whole group;
  - a binding field for a depth or unfilterable texture (every texture is
    laid out filterable `float` today).

### X3.3 — The static world's main pass (PERF_PLAN B1) — **L, as three sub-steps** (split 2026-10-13)

As B1 states it: clusters of ~128–256 triangles, a compute cull (frustum, the
fog reach `WorldCulling` walks to, the size gate), one `drawIndexedIndirect`
per material per pass, and the blocks taken out of `WorldCulling`'s main-pass
candidate list while their Babylon meshes live on for the other passes.

It is split so that correctness and speed are proven apart. **(a)** makes our
pipeline draw the blocks to the pixel, behind a DEV switch, with Babylon's
draw counts untouched. **(b)** changes HOW they are drawn, under the same
switch, with the pixels already pinned. **(c)** makes it the only path and
takes the measurement. Each sub-step lands on its own and leaves the game
shippable. Until (c), a build without the switch draws exactly what X3.2's
did.

- **Contracts all three keep:**
  - a per-cluster block id for `ReflectionSystem.encloses`, plus X1.4's piece
    id
  - fog to `fogEnd`
  - `opaqueAlpha` 0 in the frame and 1 under a probe bake (the probes keep
    drawing Babylon's meshes until X3.6c, so our pipeline draws only the
    main pass, at 0)
  - the wind's ramp and rigged layers
  - every caster a closed shape (the casters stay Babylon's until X3.6a)

#### X3.3a — Our cel pipeline draws the blocks, to the pixel — **M** — **LANDED** (b130995)

- **Do:**
  - **The vertex stage as a shared chunk.** `CelShader.ts`'s vertex body,
    sway included, becomes a Babylon-free chunk both sides include, as X3.1
    did for the fragment (X3.1's third owed item). Ours is declared as data
    beside `celFragment.ts`, with the frame's camera and wind from
    `FRAME_BLOCK`.
  - **The fragment's `position.y` flip** in our `main` (X3.1's and X3.2's
    owed item; the frame's main pass is a texture), so the dither is not
    mirrored.
  - **The textures the cel surface samples**, bound as wrapped views of
    Babylon's own through the seam (rule 5): every shadow map, the lamps'
    atlas, the flash map, the cloud field, the foliage map, the GI volume's
    seven 3D textures, the ground textures and the reflection cubes. Each is
    a numbered internal in the seam's header, the list growing as Phase 3
    allows. Babylon re-creates some of these on a quality change, so a view
    is re-taken when its owner replaces it, never cached across that. A
    depth or unfilterable texture gets a field on its binding (X3.2's owed
    item) rather than the filterable default.
  - **The material block** (group 1), filled from the same spec a Babylon
    cel material is born with, through a pull on the factory like
    `fillFrame`. Never read off a `ShaderMaterial`.
  - **The geometry** uploaded from the world's `GeometryBuffer` records
    (X1.4) into buffers our renderer owns. Whole blocks, one draw per block
    material, no clusters yet.
  - **Where in the pass the blocks draw.** They draw BEFORE group 0's
    blended meshes, through a second host hook
    (`RenderingGroup.onBeforeTransparentRendering`; X3.2's owed item). It is
    not optional: glazing and water write no depth, so an opaque wall drawn
    after them would paint over the glass in front of it.
  - **A DEV switch** (`?ourworld`) under which our pipeline draws the blocks
    in the main pass and `WorldCulling` leaves them out of the main pass's
    candidates only. Every other pass keeps drawing Babylon's meshes.
    Without the switch, nothing changes.
  - The pipelines are compiled at load, under the building card, so the
    switch never draws a frame with a pipeline still compiling.
- **Verify:**
  - `bank.mjs --check` with the switch ON is within the floor on every row
    of every map, and with it OFF is still 0%.
  - The census shows main-pass draws unchanged with the switch on: this
    step trades one draw for one draw.
  - `shaders.mjs` builds our vertex module for every shape as well.
- **Must not:** change a pixel without the switch; read a Babylon material;
  copy a Babylon texture.

**Landed** (b130995).
- **The vertex body is shared.** `shaders/wgsl/celVertex.ts` is the cel
  vertex stage as one function, `celVertex()`, which Babylon's `main` calls
  and `render/celVertex.ts` declares as data. The frame block, the material
  block (`render/celMaterial.ts`) and group 2's `world` are declared once
  each.
- **The flip, settled by Babylon's processor rather than by the brief.**
  Into a texture, Babylon negates clip y and leaves the fragment as written.
  It turns `dpdy` and the position around only ONTO THE CANVAS, and the
  position by the render height it rewrites on every resize. So our main
  pass owes the vertex negation and nothing in the fragment. X3.1 and X3.2
  recorded it the other way round. A fragment for the canvas is refused until
  a frame field carries that height; the first canvas pass (X5) owes it.
- **Where in the pass.** The draw point is the END of group 0's opaque and
  alpha-tested lists: the first of its sprites, its particles and item 6,
  `onBeforeTransparentRendering`. That hook alone was too late, because the
  particles come before it, so a wall drawn there paints over every particle
  in front of it. The START of the group was tried as well and refused: the
  sky dome writes no depth, draws first and stands at 600 m, and
  Cinderhaven's `fogEnd` is 1,250 m.
- **The textures are Babylon's own.** Items 7 and 8 are each texture's own
  `GPUTextureView` and the `GPUSampler` from Babylon's own cache, for the
  state `_setTexture` would bind. They are re-resolved every frame
  (`FrameHost.bind`, `render/HostBindGroup.ts`), and a bind group is re-made
  only when a view moves. **No depth or unfilterable texture is bound**: the
  sixteen are `rgba16float`, `r16float`, `rg8unorm` and `rgba8unorm`. So X3.2's
  binding field stays owed to the first one that is, and with it Babylon's
  `unfilterable-float` fallback for a full-float texture on a device without
  `float32-filterable`.
- **A material is its RECIPE.** Every per-material value goes through the
  factory's `own`/`ownTexture`, which set the material and its recipe in one
  statement (`CelMaterialFactory.celRecipe`, `materialEpoch`). It applies to
  the five getters whose meshes our side takes.
- **What is taken.** A block-merged surface in group 0, at identity, under
  no parent, not `updatable`, on a recipe material. Its arrays are taken on
  the way past the build (`BuildOptions.onSurface`), before the release
  (`systems/BlockHandover.ts`), and it is drawn by `render/WorldBlocks.ts`.
  `WorldCulling.setTaken` keeps it out of the main pass's candidates and of
  nothing else. It is ON exactly when Babylon's walk would draw it, asked
  through the mesh right after the walk. A surface whose pipeline fails goes
  back to Babylon. The card waits for the pipelines, under the bake's own cap.
- **Found on the way: `PipelineCache` had the front face backwards.** A mesh
  in this left-handed scene is born `CounterClockWiseSideOrientation`, so it
  faces the eye `"ccw"` on screen and `"cw"` in a flipped pass. X3.2's test
  triangle was authored to the rule it tested. `PipelineState.reversed`
  replaces `counterClockwise`.
- **Measured.**
  - **`bank.mjs --check` with the switch OFF: every row of every map at 0%**
    (47 of 47).
  - **With it ON** (`--query=ourworld`, new here): every row within the
    floor. The worst row is Coldharbour's `curtain90`, at 0.093% of pixels
    and a mean of 0.0104/255, against 0.02. Sarab's `wadi` is the widest, at
    0.12%.
  - **The residue is equal-depth TIES**, traced on `curtain90` (1,931
    pixels differ by any amount) with frames taken in the bank's own vantage
    order. **A frame shot at one vantage alone differs from the bank by
    41,271 pixels with no switch at all**, from state carried between the
    rows, and the first round of experiments was confounded by it. A scratch
    diff owes the bank's sequence.
    - With Babylon drawing every block AND ours drawn over them, the frame
      is the same 1,931 pixels as ours alone. So our vertices land bit for
      bit where Babylon's do, and our shading is the same.
    - Moving our draws to the group's start moves the residue to a
      complementary set of 1,094.
    - What is left is coplanar surfaces (lit-window quads, mullions, slab
      edges) whose winner Babylon decides by its front-to-back sort, pair by
      pair. No fixed point of ours can reproduce that.
  - **`census.mjs`** (new: main-pass draws, Babylon's into the frame's target
    plus ours, on the bank's frozen frames): **equal with and without the
    switch on every vantage of all seven maps.** Hollowmere is 629, Greyfen
    382, Coldharbour 1,104, Harrowmead 1,514, Sarab 1,206, Cinderhaven 294,
    Kurenai 89. Taken surfaces per map run from 54 (Hollowmere) to 354
    (Greyfen).
  - **`shaders.mjs`** builds both of our stages through our own
    `PipelineCache` for every shape on seven maps (5 to 7 variants a map),
    clean.
  - `npm run build` passes every gate.
  - **The user's play-test under `?ourworld`** (2026-10-14): everything
    looked fine.
- **Owed onward.**
  - X3.3b: the clusters and the cull keep the ON rule's other half, the
    walk's frustum and readiness, which X3.3a asks of Babylon's mesh.
    **Done at X3.3b.**
  - X3.3b: a mesh whose `visibility` drops below 1 would go to Babylon's
    blended list, and ours would still draw it opaque. No block changes its
    visibility today. **Answered at X3.3b** by a contract and a DEV check.
  - X3.3c: `PipelineWarmup` learns our pipelines. **Done at X3.3c.**
  - X3.3c: the census's equal totals become falling totals (`census.mjs
    --fall`). **They fell at X3.3b already**; X3.3c reads them again.
    **Read at X3.3c**, against a BEFORE taken at the commit before it.

#### X3.3b — Clusters, the compute cull and indirect draws — **M–L** — **LANDED** (04d1b89, review fixes e21c9ac)

- **Do:**
  - The blocks cut into clusters of ~128–256 triangles, each carrying its
    block id and its X1.4 piece id.
  - A compute cull per frame over the clusters: the frustum, the fog reach
    `WorldCulling` walks to (`fogEnd` and the size gate, as it decides them
    today), writing indirect arguments.
  - One `drawIndexedIndirect` per material per pass. All of it under the
    same DEV switch.
    **Since 2026-10-18 the blocks' draw is a PLAIN `drawIndexed` over the
    group's whole range**, the cull clearing its output first so the
    survivors' remainder is triangles of no area: an Intel Xe-LPG dropped
    single indirect draws at random (`docs/rendering.md`, "NOTHING OF THE
    STATIC WORLD IS DRAWN OR DISPATCHED INDIRECT"). The scatter's draws
    (X3.4b) stayed indirect until 2026-10-24, when the same laptop's trees
    went too; nothing of the scatter is indirect since (X3.5b's landed
    list).
  - **Keep the door open for the GPU side** (deferred until after the exit;
    "What this plan does not do"). Where the cull compacts the surviving
    clusters, it writes them NEAR-FIRST, so that a later depth-ordered draw
    lets the GPU skip hidden pixels. It costs nothing now: an order chosen
    while the list is being written anyway. It is not a sort per frame.
- **Verify:**
  - `bank.mjs --check` with the switch on, within the floor everywhere: the
    cull may drop only what the fog or the frustum already hid.
  - P0's census with the switch on: main-pass draws fall.
  - X0.3 on the desktop, read as an indication only; the step's number is
    (c)'s.
- **Must not:** let the cull read a node; re-cut clusters per frame.

**Landed** (04d1b89, review fixes e21c9ac).
- **The cut.** `render/clusters.ts` cuts each taken surface once, at
  install (`WorldBlocks.finish`, after `WorldCulling.setMap`), into runs of
  at most 128 triangles of ONE X1.4 piece in the surface's own order
  (`CONFIG.graphics.clusters`). Each cluster carries its block, its piece,
  its float32 box, and how far the wind can move it: its largest ramp
  weight, and whether it is rigged.
- **A group is a recipe.** Every surface of one cel recipe is laid end to
  end on one set of vertex buffers, with its indices rebased onto them. An
  attribute a surface lacks but the variant reads is zero-filled, which is
  what Babylon's empty buffer reads. One pipeline, one material, one
  `drawIndexedIndirect` a group, at the same draw point X3.3a found.
- **The cull** (`render/ClusterCull.ts`, `render/wgsl/clusterCull.ts`) is
  three compute passes, submitted as a command buffer of their own when the
  main pass begins (`Renderer.onFrame`), which the queue runs ahead of the
  frame's:
  - `cullClusters`: the block's box against the reach, the SURFACE's sphere
    against the size gate (as `WorldCulling.tooSmall` measures the mesh, so
    a cluster of a drawn surface is never too small), then the cluster's
    box against the view-projection's four side planes and the eye's own
    plane, grown by the most the frame's wind can move its vertices;
  - `prefix`: one workgroup scans the workgroups' totals and writes each
    group's indirect arguments;
  - `scatter`: each survivor's indices copied into its group's region.
  The reach and the size gate's scale are `WorldCulling`'s own, stated as
  numbers (`WorldCulling.reachGate`), and the reach is measured to the box
  of the cell the mesh is filed in (`blockBoxOf`; `reachBoxOf` since X3.5).
  So the cull reads no node.
- **Near-first, in one order.** The survivors are placed by a SCAN, never
  an atomic append: band first (24, 64 and 160 m, nearest first), then
  cluster index. The same eye draws the same triangles in the same order,
  so an equal-depth tie is settled the same way every time. The four bands
  are the four lanes of one `vec4u`, so one scan orders all of them. **The
  band is the SURFACE's** (the distance to its sphere's centre, as Babylon
  sorts a mesh), never the cluster's own: banded per cluster, two coplanar
  runs of one surface would trade places as the eye crossed a band's edge,
  which no still vantage of the bank can show. The review found it.
- **X3.3a's two owed items.** The ON rule's other half (the walk's frustum
  and readiness) is now the cull's frustum and our own pipelines' and bind
  groups' readiness. The per-frame mesh reads are gone. The layer mask moved
  into the take test. A taken mesh whose `visibility` drops below 1 is
  answered by a contract rather than followed: nothing in the tree switches,
  hides or fades a block, and a DEV build checks every frame and says so if
  one ever is.
- **Measured.**
  - **`bank.mjs --check` with the switch ON: 47 of 47 within the floor**,
    the same residue as X3.3a's (equal-depth ties). The worst rows are
    Sarab's `wadi` at 0.1222% of pixels and Coldharbour's `curtain90` at a
    mean of 0.0104/255, after the review fixes (0.1227% and 0.0105 before
    them). **With it OFF: 47 of 47 at 0%.**
  - **`census.mjs --fall`: main-pass draws fall on all seven maps**, every
    vantage, with our side down to one draw a recipe:

    | map | without | with | ours (surfaces taken) |
    | --- | --- | --- | --- |
    | Hollowmere | 629 | 497 | 2 (54) |
    | Greyfen | 382 | 172 | 9 (354) |
    | Coldharbour | 1,104 | 836 | 7 (108) |
    | Harrowmead | 1,514 | 869 | 8 (104) |
    | Sarab | 1,206 | 891 | 7 (165) |
    | Cinderhaven | 294 | 217 | 5 (130) |
    | Kurenai | 89 | 61 | 12 (170) |

  - **`shaders.mjs`** builds the cull's three entry points as well, clean
    on seven maps. **`gate.mjs`** is clean both ways. `npm run build` passes.
  - **X0.3 on the desktop, as an indication only** (one run a side,
    `bench.mjs --query ourworld`, the fight hashes equal). The tick falls in
    every group: Greyfen's fight 6.80 to 6.24 ms, Sarab's 11.26 to 9.93 ms,
    with draws 389 to 312 and 603 to 510. The wall-clock frame is mixed
    within this box's noise. The step's number is (c)'s.
- **What the review found** (fixed before the step was marked): the
  band per cluster (above); a compile or a cull that settled after its map
  was torn down could still write the draw state or the next map's
  failures (a generation now guards both, and a disposed cull drops late
  pipelines); the vertex buffers missing from the device-limit check; a cull
  built for a map with nothing taken; and a frame's submit allocating its
  descriptors.
- **Owed onward.**
  - X3.3c: the cull is submitted outside Babylon's encoder, so a GPU timer
    bracketing Babylon's frame (`?gpu`, `gpu.frame`) does not see it. Before
    the phone's `gpu.frame` is read at the gate, either the timer brackets
    it or it is encoded into the frame's own command buffer. **Done at
    X3.3c**: it is recorded into Babylon's upload encoder.
  - X3.3c: `PipelineWarmup` learns our pipelines, the cull's included.
    **Done at X3.3c.**
  - A5 (occlusion), when it comes, goes into `cullClusters` beside the
    frustum. Destructible buildings mask by the cluster's piece.

#### X3.3c — Our path is the path — **S–M** — **LANDED** (0b49881, review fixes 70cb3f8)

- **Do:**
  - The switch comes out: the blocks are drawn by our renderer in every
    build, and `WorldCulling` leaves them out of the main pass for good.
    Their Babylon meshes stay for the shadow maps, the probes, the lamps'
    atlas and the glow until X3.6 moves those passes.
  - The pipeline warm-up (`core/PipelineWarmup.ts`) learns about our
    pipelines.
  - The contracts it breaks are rewritten: `CLAUDE.md`'s "the frame walks the
    scene" for the blocks, `docs/rendering.md`, and `FILES.md`.
- **Verify:**
  - `bank.mjs --check` on every map.
  - P0's census.
  - X0.3 on the desktop and the phone against X0.4's "before"
    (`FINDINGS.md` 52). The phone is read as two numbers, never as its
    frame: its tick and its `gpu.frame`, warm, after one warm-up run.
  - A round played offline and in a match.

**Landed** (0b49881, review fixes 70cb3f8).
- **The switch is out.** `Game.handover` is built in every build, so the
  blocks `BlockHandover` takes are drawn in the main pass by our renderer
  and never offered to Babylon's walk. Their Babylon meshes stay for the
  shadow maps, the probes and the lamps' atlas (the glow draws only what
  glows, which a taken block never does). A surface the take
  test refuses, or whose compile fails, is Babylon's in the main pass as
  before. The editor's build is unmerged, so it takes nothing.
- **The cull is inside the frame's GPU timer** (X3.3b's owed item). It is
  no longer a command buffer of its own: it is recorded, as the main pass
  begins, into the encoder Babylon submits FIRST (`FrameHost.prepareEncoder`,
  the seam's item 9, `engine._uploadEncoder`), which is also the encoder
  Babylon opens `gpu.frame` on. So it still reaches the GPU before the draws
  that read it, and `?gpu` now counts it.
- **The warm-up learns our pipelines.** `PipelineCache` builds the cull's
  compute pipelines too (`compute`, cached across maps, so they compile once
  a session) and counts every compile (`CompileProgress`). The warm-up opens
  by waiting for them at no vantage, under `warmup.oursCapMs` (90 s, a
  backstop, because a group of ours compiling is a hole and not a hitch).
  Then a vantage is quiet only when neither cache built anything and nothing
  of ours is compiling. The separate wait on `handover.compiled` is gone.
- **The census reads a BEFORE now.** With no switch left, `census.mjs --out`
  takes the rows at the previous commit and `--against ... --fall` compares
  them. `bank.mjs` counts console errors on every check, and its bank stays
  Babylon's picture from before this step.
- **What the review found** (fixed before the step was marked): our draw
  and the cull's prepare were on the renderer for good, so every frame of
  the menu filled and uploaded the frame for nothing — a DEV switch's cost
  that every build now paid; they are registered once a map's cull is built.
  A prepare is once a submit (its `writeBuffer` is read by the whole
  submit), now stated. A compile start that threw would have leaked the
  count. The contracts claimed the glow as one of Babylon's passes over a
  taken block, and a hand-back "in the turn its compile settles", which is
  after the map's LAST compile.
- **Measured** (after the review fixes, which moved no total).
  - **`bank.mjs --check`: 47 of 47 within the floor**, no console errors,
    the same residue as X3.3b's switch-on rows (equal-depth ties). The worst
    rows are Sarab's `wadi` at 0.1222% of pixels and Coldharbour's
    `curtain90` at a mean of 0.0104/255.
  - **`census.mjs --against --fall`** (the BEFORE taken at 69a7744 without
    the switch, equal to X3.3b's "without" column on every map): main-pass
    draws fall on all seven maps, Hollowmere 629 to 497, Greyfen 382 to 172,
    Coldharbour 1,104 to 836, Harrowmead 1,514 to 869, Sarab 1,206 to 891,
    Cinderhaven 294 to 217, Kurenai 89 to 61.
  - **X0.3 on the desktop** (`bench.mjs --max --runs 3`, 3440x1440
    uncapped, the BEFORE at 69a7744 in the same session, fight hashes
    `83e8e74ef36916ba` and `986c2e35557fb679` on every run). **The tick
    falls in every group:**

    | map | part | tick before | tick after | draws | mean, new / old |
    | --- | --- | --- | --- | --- | --- |
    | Greyfen | vantages | 5.04 | 4.34 | 131 to 58 | 1.024 |
    | Greyfen | path | 4.88 | 4.20 | 184 to 114 | 1.091 |
    | Greyfen | fight | 6.95 | 6.37 | 388 to 313 | 0.923 |
    | Sarab | vantages | 3.51 | 3.36 | 181 to 130 | 0.992 |
    | Sarab | path | 3.87 | 3.85 | 175 to 131 | 1.044 |
    | Sarab | fight | 11.40 | 9.56 | 604 to 510 | 0.843 |

    Against X0.4's desktop "before" (`FINDINGS.md` 52, an older fight),
    Sarab's fight 1% low is 17.1 ms against 17.2, with X6.2's target at 12.
  - **The frame did not follow the tick on Greyfen's path, and the GPU is
    why.** Its mean rose 9% while its tick fell 14%. `?gpu` on Greyfen
    (`--max --gpu --runs 2`, before and after): `gpu.frame` 5.60 to 5.55 ms
    on the vantages, **5.31 to 5.77 on the path**, 5.95 to 5.99 in the fight.
    So the desktop's path is GPU-bound now (`gpu.frame` 5.77 against a tick
    of 4.46). The after includes the cull, which no before had, and no timer
    here separates the cull from the draws. That is GPU-side work, so it waits
    with the rest of it until after the exit.
  - **`shaders.mjs`** clean on seven maps, **`gate.mjs`** clean on seven (an
    offline round on each), and **a round played in a server match**
    (Hollowmere, `?mp=`, 54 surfaces taken, 9,721 clusters, our 2 draws a
    frame, no page or console errors). `corecheck` and `npm run build` pass.
- **The gate.** Main-pass draws fall, and the desktop's CPU tick improves in
  every group, so the stop condition ("no device's CPU tick improves") is not
  met, and X3.4 may proceed on the desktop's reading.
- **Owed onward.**
  - **The phone's reading**, the user's to take: X0.3 on the deployed
    `babylon-exit` build, minimal settings, warm (one warm-up run thrown
    away), Greyfen and Sarab, read as its tick and its `gpu.frame`
    (`?bench=<map>&gpu`), against `FINDINGS.md` 52.
  - The desktop path's `gpu.frame` rise above goes to the GPU-side work after
    the exit, with the phone's. Separating the cull's own GPU time would need
    a timestamp pair of its own around the compute pass — **built 2026-10-20**
    as `gpu.cull` (`render/PassTimer.ts`), and it is 27-66 µs on the
    desktop, so it is not the rise (`FINDINGS.md` 61). **The whole-step
    review named a second suspect**, the draw order (below, and
    `FINDINGS.md` 61).

**The whole-step review of X3.3** (2026-10-14, fixes 5525a5d). X3.3a, b
and c were reviewed together after all three had landed.
- **A refused main pass was a HOLE.** `Renderer` refuses a pass that is not
  `FRAME_TARGETS` and draws nothing of ours. Before X3.3c that cost a test
  draw. Since then it left every taken block drawn by nobody, because
  Babylon's walk no longer offers them. Now `Renderer.onRefused` tells
  `BlockHandover`, which stops our side for the rest of the map
  (`WorldBlocks.stop`, keeping the buffers this frame's commands hold) and
  hands every block back to Babylon from the next frame. Nothing ships such
  a pass (`CelInk` is fixed first in the chain), so it is a backstop.
- **A failed compile waited for the map's LAST one.** `WorldBlocks.compiled`
  resolved once every compile settled, so a compile that never settled
  kept a failed group a hole for the round. `WorldBlocks.onFailed` now hands
  back a group's surfaces (or every surface, for the cull) in the turn its
  failure lands.
- **A capture could not see our renderer.** Its draw count is Babylon's
  counter. Report version 17 adds `blocks` (taken, clusters, groups, our
  draws last frame, handed back), read at the capture, and the viewer prints
  it as `ours`. A phone capture now says whether the handover took anything.
- **The draw order is a suspect for the desktop path's GPU rise**
  (`FINDINGS.md` 61). The blocks draw after Babylon's whole front-to-back
  opaque queue, so the terrain, the roads and the loose props are shaded
  before the buildings that hide them. Greyfen's `fogEnd` (78 m) is inside
  the sky dome, so drawing ours at the group's start is legal there and
  separates the order from the cull. That is GPU-side work, deferred with
  the rest of it. (Settled at X3.5, "The blocks ahead of the landform": the
  order was most of Greyfen's rise.)
- **Tidy.** `WorldCulling.pass` folded back into `offer` (its second caller
  went at X3.3b), `FrameUniformBuffer`'s type-only `write` gone,
  `WorldBlocks.finish` sums each group's vertices once, and `ClusterCull`
  logs nothing after `dispose`.
- **Measured after the fixes.**
  - `bank.mjs --check`: 47 of 47 within the floor. The worst rows are
    unchanged (Sarab's `wadi` at 0.1222% of pixels, Coldharbour's
    `curtain90` at a mean of 0.0104/255).
  - `census.mjs --against` the BEFORE at 69a7744, `--fall`: totals identical
    to X3.3c's on all seven maps.
  - `shaders.mjs` and `gate.mjs` clean on seven maps. A server-match round
    on Hollowmere took 54, drew 2 and handed back none, with no errors.
    `corecheck` and `npm run build` pass.
  - **Both new paths, forced, on Greyfen** (a scratch test at the first bank
    vantage). A refused pass hands back all 354 surfaces, and the next frame
    matches the bank to the pixel: Babylon draws every block again. One
    group's pipeline failing before install hands back its 41 surfaces, the
    other 8 groups draw, and the frame is within the floor (0.0476% of
    pixels).

**Gate after X3.3c — the first number that says whether the renderer pays.**
If main-pass draws fall and no device's CPU TICK improves, stop and re-read
this plan with the user before X3.4. Leaving Babylon would still remove the
bugs and the upkeep, but the performance case would be gone, and the order
of everything after this point should be weighed again.

**The gate reads the tick, not the frame, and the phone is why.** On the
desktop the two are nearly the same number (the tick is 89-97% of the
frame). The phone is GPU-bound on Greyfen once warm: `gpu.frame` is 22-29
ms against a tick of 9-17.5 ms (`FINDINGS.md` 52, "The GPU half,
measured"). X3.3 moves the tick, so a phone frame that does not move says
nothing about the renderer. The phone's `gpu.frame` is RECORDED at the
gate, and is judged only by the GPU-side work after the exit. The phone
reaches the branch itself: `babylon-exit` is deployable as well as
`develop`, since 2026-10-13.

### X3.4 — Scatter as instances (PERF_PLAN B2) — **M–L** (decision) — **LANDED** (1a20232 + f20a9ae)

As B2 states it: keep the seeded placement exactly; emit one source mesh per
(kind, variant, material, foliage rung) and a transform per placement.
Destructible props become a per-instance flag. The AO question B2 raises is
the decision.

- **Decided** (2026-10-14): **the colour buffer is baked once per kind**, as
  if the prop stood alone on flat, open ground, and every placement of it
  shares that bake. The look change is judged in the bank, frame by frame,
  rather than held to the floor. It is not only the AO: the colour buffer's
  four channels (`world/vertexShading.ts`) split two and two.
  - **Placement-dependent, so they change:** the AO in the ALPHA (a prop
    against a wall or under a tree no longer darkens on that side, and a prop
    on a slope loses its slope's grounding) and the wear ramp in the BLUE
    (measured from the ground under each vertex, and zero under a roof, so a
    crate under an eave now carries street grime).
  - **The prop's own, so they hold:** the world mark in the GREEN, and the
    sway weight in the RED nearly so. A rigged layer's sign holds exactly. A
    ramp is height above the ground, so it is now measured up the prop at
    scale 1 on level ground: a prop sown on a slope or drawn at 1.3x sways a
    little differently.
- **If the look is wrong** (the user's fallback, 2026-10-14): keep the
  per-kind bake for the prop's SELF-occlusion and add one or two numbers PER
  INSTANCE, baked at placement from the world around it. For example, how
  hemmed in the spot is (the AO's box term at the prop's footing) and how far
  the ground darkens its base (the ground term along its height). The shader
  combines them with the per-kind alpha. That is most of the grounding back
  for a few bytes an instance, against a per-instance bake, which costs as
  much colour data as today. It is a look change of its own, judged in the
  bank again.
- **Found on the way in (2026-10-14): there were no variants to instance.**
  B2's premise was "scatter is made of a few kinds × variants × foliage
  rungs". It was not. Every prop is built per placement from the shared
  stream, and the five tree builders seed a stream of their own from one of
  those draws, so every tree is a different shape: Greyfen's 1,737 jungle
  trees were 1,737 meshes' worth of unique geometry. Measured off the build's
  piece ranges, scatter is most of the world on the forest maps:

  | map | vertices | scatter | the biggest kind |
  | --- | --- | --- | --- |
  | Hollowmere | 1.96 M | 38% | `deadTree`, 0.64 M |
  | Greyfen | 8.93 M | 87% | `jungleTree`, 7.29 M |
  | Coldharbour | 2.97 M | 33% | `pine`, 0.59 M |
  | Harrowmead | 6.37 M | 84% | `ashTree`, 3.78 M |
  | Sarab | 2.02 M | 50% | `boulder`, 0.63 M |
  | Cinderhaven | 4.77 M | 15% | `pine`, 0.20 M |
  | Kurenai | 5.56 M | 60% | `maple`, 3.09 M |

  **Decided** (the user, 2026-10-14): **16 variants a kind.** Each kind is
  built 16 times a build, and every placement wears one of them under its
  own scale, yaw and translation. That is a second look change, judged in
  the bank like the first: a forest repeats shapes, broken up by yaw and
  scale. Maple's four crown colours become four variants each. The other
  two answers were 8 variants, and deferring the step, since X3.3 already
  draws scatter at one draw a material.
- **Destructible props: nothing to flag.** Destruction's stage one
  (06fca4f) was never merged to `develop` or to this branch. It is a dangling
  commit, so no prop on the branch is destructible. When it lands, a wrecked
  prop is an instance the cull drops (a flag in its record), and Babylon's
  copy of it is the vertex range its piece already names.
- **Two sub-steps**, split as X3.3 was so the two claims are proven apart:
  - **X3.4a — the variants, on the path as it stands.** Each kind's 16
    variants are built once a build (`world/scatterVariants.ts`), and a
    placement takes one by a hash of where it sits in the layout, never by
    a draw. **The placement must not move**, and that is the step's oracle.
    The shared stream is spent exactly as the builder would have spent it,
    by a REPLAY per kind (`world/props/sharedDraws.ts`, maple's
    `mapleSharedDraws` generalised), which `kit:hash` checks against the
    builder's own count at every seed and rung. So `npm run collision`
    rewrites no bake and `npm run parity` passes untouched. `kit:hash` is
    identical (the builders are not touched); `merge:hash` moves (the
    scatter's drawing is the variants'). The picture moves only by the
    variants.
  - **X3.4b — our main pass draws the variants as instances.** One source
    surface per (variant, material) with its colour buffer baked once per
    kind, a transform per placement, a compute cull per instance (the
    frustum, the reach and the size gate, near-first, in one order), and one
    `drawIndexedIndirect` per (variant, material): WebGPU has no
    multi-draw-indirect. The scatter's clusters are left out of the blocks'
    cut, and Babylon's merged copy stays in the blocks for the other passes
    until X3.6, so the shadows are the variants' shapes as well. The picture
    moves by the per-kind bake.
- **X3.4a, measured** (2026-10-14, before its commit):
  - **The placement did not move.** `npm run collision` rewrote none of the
    eight bakes, and `npm run parity` passes on all eight. `kit:hash` is
    identical against the parent (3,722 builds), and every scatter kind's
    replay takes its builder's count at all 8 seeds and 3 rungs. The check
    was shown to bite: `log` replayed as 2 draws failed 24 builds.
    `merge:hash`: colliders and terrain identical on every map; the visuals
    and `colliderAlbedo` (now weighed off the variant's parts) moved.
  - **The build:** the scatter phase falls 2-4x (Greyfen 2,241 to 602 ms,
    Harrowmead 1,698 to 454, Kurenai 1,170 to 302), `build:total` 4-26%
    (Greyfen 6,279 to 4,658 ms). The scatter's vertices are within 3% of
    before, so the AO bake and the upload are unmoved, as expected until
    X3.4b.
  - **The bank, judged:** every row with scatter in view moves (Greyfen's
    `canopy` 91% of pixels, its `menu` 55%); every row with none stays in
    the floor (`shopfront`, the three hulls, Cinderhaven's `menu`). By eye:
    the same trunks in the same places, each wearing a variant's crown,
    lean and lianas, and Kurenai's crowns still in all four colours.
    `bank.mjs --keep=<dir>` (new) keeps a check's frames for that judging.
  - `npm run build`, `corecheck` and `gate.mjs` (a round on all seven maps)
    pass.
- **X3.4a landed at 1a20232, X3.4b at f20a9ae.**
- **X3.4b, measured** (2026-10-14, against X3.4a in the same session):
  - **How it is drawn.** `BuildOptions.onScatter` hands `BlockHandover` the
    FIELD: each worn variant a set of parts, merged through the block
    merge's palette, its colour buffer baked once per kind, and the matrix
    of every placement wearing it. `WorldBlocks` appends each set's parts to
    its recipe's group, cuts the scatter's pieces out of the group's taken
    blocks (`withoutPieces`), and draws one `drawIndexedIndirect` per part
    of a set. `InstanceCull` culls the instances on the GPU on the cluster
    cull's terms (reach, size gate, frustum, near-first by a scan) into each
    set's own region of the instance buffer. The instanced vertex stage is
    the same body with `world` built per instance in `main` (the assembler
    gained instance-step attributes, a `PrivateBlock` and a prelude). A
    group is ours whole or Babylon's whole: either pipeline failing hands
    every surface back.
  - **What it bought is memory.** Our renderer's buffers for the world:
    Greyfen 680 to 81 MB, Harrowmead 467 to 65, Kurenai 415 to 136,
    Hollowmere 124 to 75, Coldharbour 171 to 114, Sarab 130 to 57,
    Cinderhaven 288 to 244. Greyfen's clusters 86,192 to 4,731. Babylon's
    copy is unchanged until X3.6.
  - **What it cost is draws.** One a part of a set, because WebGPU has no
    multi-draw-indirect: `census.mjs` totals (every vantage) rise from
    X3.3c's 497 / 172 / 836 / 869 / 891 / 217 / 61 to 1,663 / 776 / 1,942 /
    3,534 / 2,673 / 613 / 170 (Hollowmere, Greyfen, Coldharbour,
    Harrowmead, Sarab, Cinderhaven, Kurenai). Babylon's share is unmoved.
    Greyfen's main pass is our 9 block draws and 151 instanced.
  - **The desktop's frame did not move.** X0.3 (`bench.mjs --max --runs
    3`, 3440x1440, same session, the fight hashes X3.3c's on every run):
    every group's tick within the protocol's 8%. Greyfen fight 7.24 to
    7.18 ms, path 4.35 to 4.67; Harrowmead path 5.51 to 5.23, fight 6.12 to
    6.14; Sarab fight 12.37 to 13.09 (its before spread 5.8%). The desktop
    is not bound by the memory this freed; the phone's reading is owed, as
    X3.3c's is.
  - **The bank, judged.** Against X3.4a's frames, the per-kind bake moves
    a mean of 0.22/255 at most (Greyfen's `menu`; Coldharbour's
    `curtain40` 0.13, Sarab's `wadi` 0.14, the rest under 0.08), and rows
    with no scatter stay at 0. By eye nothing reads differently.
  - **Checks.** The DEV trade check (the indices cut out of a group equal
    its instanced parts' times their instances) is silent on all seven
    maps, and `bank.mjs` counts no console error. `shaders.mjs` builds
    both vertex stages for every shape on seven maps and both culls.
    `gate.mjs`, `npm run build`, `corecheck` and `parity` pass.
  - **Owed.** The phone's reading (tick, `gpu.frame`, and whether the
    memory moves its frame). The draws fold into one draw per recipe by
    vertex pulling in X3.5b, before X3.6 repeats them in every pass.
- **Verify:** `kit:hash` (it hashes scatter over fixed seeds and rungs,
  rng-draw count included) plus the replay check; `npm run collision` and
  `npm run parity`; the bank on every map, judged; the census; X0.3.

### X3.5 — Terrain and roads (PERF_PLAN B5) — **M** — **LANDED** (b2c9bc6, review fixes a24339d, 0dd2d09)

As B5 states it: clusters, as the blocks. The floor carries the most
contracts:
- the road depth bias in the material cache key
- `ROAD_RANK` and the rest of the road ladder
- the turf
- `terrainBlock` agreeing across the two callers of `terrainPatches`
  (`MapBuilder.buildValley` and the editor's brush; the server's went at X2.3)
- the collider clone, which stays as it is

- **Verify:** the bank on every map, closest to the ground and on a road
  crossing; `merge:hash`; X0.3.
**Landed** (54ec8c0 the instruments, b2c9bc6 the step, a24339d the review's
fixes, 0dd2d09 the measurement's fix).
- **What it is.** Our renderer takes the LANDFORM from Babylon's main pass —
  the floor's patches (the borderland's too), the rim's runs and the
  map-wide road merge — and draws it through the blocks' cut and cull.
  - **A second draw point, `"beforeAlphaTest"`**, between group 0's opaque
    and alpha-tested lists, because the turf is a blend on the alpha-tested
    list that writes no depth and must land on a floor already drawn. Babylon
    has no hook there, so the seam wraps the group's `_renderAlphaTest` while
    the main pass's group 0 renders (item 10). A frame whose alpha-tested
    list is empty fires the point just ahead of `"opaque"`. The blocks stay
    at `"opaque"`.
  - **The landform is marked by the BUILD** (`WorldSurface.landform`), on the
    record and never in `part.metadata`, so `merge:hash` and `kit:hash` have
    nothing new to see. `BlockHandover` tells the cull which taken mesh is a
    block and which the landform (`WorldCulling.setTaken`'s two lists).
  - **No reach.** The landform's reach box is ±`F32_MAX`
    (`WorldCulling.reachBoxOf`), so the GPU cull keeps it to the size gate
    and the frustum, the no-reach answer it had as a loose mesh. The floor
    and the rim carry no piece and are cut as one `NO_PIECE` span; the
    roads keep theirs.
  - **A group is (recipe, point)** over one cut, one cull and one index
    buffer, with two `FrameDraw`s, so the rim (the pines' material) never
    shares a group or the scatter with a block. The roads' -8 is the
    pipeline's `depthBias` (`CelRecipe.depthBias`), and a biased group draws
    first at its point (0dd2d09, below).
  - **An editor build takes nothing** (`Game` passes no `onSurface`), which
    keeps the terrain brush's in-place rewrite of the floor Babylon's.
- **What the review found** (a24339d, before any browser ran).
  `reachBoxOf` gave ANY taken mesh filed in no cell the landform's no-reach
  box, so a block that had lost its cell would have drawn at every distance
  instead of throwing. It now takes a `landform` flag, and a block in no
  cell throws again. And the contract X3.5 opened is written down: Babylon's
  opaque list now always draws before our floor, so anything lying on the
  floor that writes NO depth must be blended or on the alpha-tested list,
  never opaque, or the floor paints over it every frame (the sky dome is the
  one deliberate case). `CLAUDE.md` states it, `docs/rendering.md` argues
  it.
- **What the measurement found** (0dd2d09). X0.3 put Cinderhaven's frame up,
  and a paired, alternating A/B on the GPU confirmed it (`bench.mjs
  cinderhaven --max --gpu --runs 2`, twice a side, 3440x1440, `src/` swapped
  between 54ec8c0 and a24339d in one session). `gpu.frame` rose 4.38 to
  5.55 ms on the vantages, 5.19 to 6.27 on the path and 4.70 to 5.69 in the
  fight; the frame 5.44 to 6.02 ms on the vantages and 5.47 to 6.55 on the
  path. The fight still got faster, 13.31 to 11.17 ms, its tick falling
  12.40 to 10.30 as 193 meshes left Babylon's walk.
  - **Part of the rise was the roads.** Drawn after the floor, every road
    pixel was the bumped floor shaded and then painted over.
    `WorldBlocks.drawClusters` now draws a point's biased groups first, so
    the floor under a road fails the depth test before it shades. The
    picture does not move: the bias decides who wins, the order only what is
    shaded.
  - **What that bought**, paired against a24339d (two runs a side): the
    crossing vantage's mean frame 7.46 to 6.92 ms (about half its rise), the
    town's 6.55 to 6.09 (most of it); `gpu.frame` 5.70 to 5.32 ms on the
    vantages and 6.13 to 5.95 on the path.
  - **The rest is the landform's ORDER** against what Babylon's
    front-to-back queue gave it, `FINDINGS.md` 61's question, which now
    holds both measurements.
- **Measured** (after 0dd2d09 unless named; the BEFORE taken at 54ec8c0 in
  the same session).
  - **`merge:hash`: identical** to the BEFORE on all eight maps (the proving
    ground included), so `kit:hash` was not owed.
  - **`shaders.mjs`: clean on seven maps.** Our builds are 18/18 on the
    five-variant maps (12/12 before) and 22/22 on the seven-variant ones
    (16/16): the -8 road pipelines, both stages, for every biased shape.
  - **The bank, against the BEFORE.** Every row's frame was graded against
    the same row's frame kept at 54ec8c0 (`--check --keep`, `diff.mjs`'s
    `comparePngs` at `CHECK_TOLERANCE`), because the bank's old rows are
    stale (below). **61 of 61 within the floor**, at a24339d and again at
    0dd2d09. The worst are Sarab's `shelf` (0.0025/255, 0.037% of pixels),
    Sarab's `wadi` (0.0019), Kurenai's `crossing` (0.0014) and Greyfen's
    `crossing` (0.0010): equal-depth ties, as X3.3c's. 21 rows are
    byte-identical, the `ground` rows of Greyfen, Harrowmead and Cinderhaven
    among them.
  - **The 14 new rows against the bank: within the floor**, worst Kurenai's
    `crossing` at 0.0014/255 and Greyfen's at 0.0010. The other 33
    over-tolerance rows are the same 33 the BEFORE fails (stale). No console
    or page error on any check.
  - **By eye** (`ground`, `crossing`, Harrowmead's `borderland`): the turf
    still lies over the floor and the blades stand in it; the roads sit on
    the floor with their kerbs and no z-fighting at range, two ranks
    crossing cleanly on Sarab and Coldharbour; the borderland's turf rolls
    to the horizon, and Cinderhaven's floor runs to its night skyline.
  - **The empty alpha-tested list**, forced at every map's `ground` and
    `crossing` vantage by switching off what was on it (the turf patches and
    `sky-clouds`). Babylon then makes no `_renderAlphaTest` call with that
    list, and the landform still draws its 5 (or 11) groups from the
    fallback. The frame differs from the same frame under `?babylonworld`
    exactly as the turfed frame does (the scatter's per-kind bake), with no
    hole.
  - **`?babylonworld`** takes nothing (0 surfaces, 0 draws of ours) on all
    seven maps, and Babylon draws the floor.
  - **The handover**, per map: the surfaces taken, how many are landform,
    its groups, and our draws at each point on every frame of a played
    round. Nothing was handed back and nothing threw.

    | map | taken | landform | its groups | draws, landform / blocks |
    | --- | --- | --- | --- | --- |
    | Hollowmere | 95 | 41 | 5 | 5 / 108 |
    | Greyfen | 385 | 41 | 5 | 5 / 156 |
    | Coldharbour | 172 | 64 | 11 | 11 / 161 |
    | Harrowmead | 120 | 16 | 5 | 5 / 207 |
    | Sarab | 303 | 138 | 5 | 5 / 203 |
    | Cinderhaven | 323 | 193 | 5 | 5 / 201 |
    | Kurenai | 251 | 81 | 11 | 11 / 111 |

  - **`census.mjs --against --fall`: every row falls.** Totals: Hollowmere
    1,958 to 1,749, Greyfen 1,172 to 1,090, Coldharbour 2,403 to 2,206,
    Harrowmead 3,967 to 3,861, Sarab 3,213 to 2,818, Cinderhaven 1,196 to
    1,008, Kurenai 507 to 428 (the landform's draws fall to one a group).
  - **X0.3 on the desktop** (`bench.mjs greyfen sarab cinderhaven --max
    --runs 3`, 3440x1440 uncapped, a24339d against 54ec8c0, install times
    within each other's spread). The fight hashes are `83e8e74ef36916ba`,
    `986c2e35557fb679` and `2f97c9072ab1762b` on every run.

    | map | part | tick before | tick after | draws | mean, new / old |
    | --- | --- | --- | --- | --- | --- |
    | Greyfen | vantages | 4.40 | 3.84 | 59 to 40 | 1.060 |
    | Greyfen | path | 4.79 | 5.14 | 113 to 97 | 1.034 |
    | Greyfen | fight | 6.58 | 6.92 | 313 to 287 | 1.053 |
    | Sarab | vantages | 3.48 | 3.35 | 130 to 78 | 0.999 |
    | Sarab | path | 3.92 | 3.79 | 131 to 86 | 1.000 |
    | Sarab | fight | 10.26 | 9.36 | 510 to 435 | 0.927 |
    | Cinderhaven | vantages | 4.40 | 4.89 | 176 to 108 | 1.133 |
    | Cinderhaven | path | 4.74 | 5.49 | 177 to 114 | 1.214 |
    | Cinderhaven | fight | 9.08 | 9.77 | 487 to 375 | 1.077 |

    Greyfen's fight spread 9.0% and Cinderhaven's 34% in that run, so those
    two fight rows are noise; Cinderhaven's paired A/B above is its reading.
    A run at 0dd2d09 printed the same three hashes, but its installs ran
    25-35% slow against the BEFORE's, so its frame rates are not comparable
    (`VERIFYING.md`). Only the paired A/B prices the fix.
  - **`gate.mjs`** is clean on seven maps (an offline round on each).
  - **A round in a server match** (Cinderhaven, `?mp=`): 323 taken, 193 of
    them landform, 5 and 201 draws a frame, nothing handed back, no page or
    console error.
  - **The editor** (`F2` on Hollowmere): nothing taken. A sculpt stroke
    raised the floor from 3.25 to 7.25 m under the brush, and the drawn floor
    rose with it.
  - `npm run corecheck`, `npm run build` and `npm run parity` (all eight
    maps, every scene ready on frame 1) pass.
- **Owed onward.**
  - **The phone's reading — X3.5b's phone BEFORE, taken 2026-10-21** on
    the deployed v18 build (3b9be6c: the blocks ahead of the landform, the
    cull timer, a phone's run held for a tap and a settled fullscreen
    canvas). X0.3, a thrown-away warm-up run, then one run a map back to
    back 03:45-04:02 UTC: Greyfen, Harrowmead, Sarab. **The settings X3.5b's
    AFTER must repeat**: `?bench=<map>&gpu` with the unsafe-WebGPU flag
    (`frameMeasurable`, 4,500-6,300 samples a run), render scale 0.5, cap
    60, shadows, grass, Trees and glow `low`, volumetrics, GI, ground relief
    and FXAA off, **blur and grain OFF** (`FINDINGS.md` 52 had both on, so
    its frames are not this table's), the minimap on. **Every frame of all
    three was drawn at one matched size** (`viewport`: 1170x540 in an
    832x384 window, `sizes` 1, `staleFrames` 0). Fight hashes
    `83e8e74ef36916ba`, `3ae90f2f08fb0643`, `986c2e35557fb679`. "GPU" is
    `gpu.frame`'s mean over its samples; "cull" is `gpu.cull`'s.

    | map | part | mean | p95 | 1% low | tick | render | draws | GPU | cull |
    | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
    | Greyfen | vantages | 18.0 | 32.7 | 55.6 | 4.71 | 3.29 | 34 | 13.2 | 0.27 |
    | Greyfen | path | 19.4 | 40.1 | 61.1 | 5.23 | 3.56 | 47 | 15.8 | 0.26 |
    | Greyfen | fight | 23.7 | 61.9 | 78.5 | 11.15 | 8.09 | 234 | 17.7 | 0.34 |
    | Harrowmead | vantages | 19.5 | 42.9 | 70.1 | 5.61 | 3.75 | 49 | 14.6 | 0.34 |
    | Harrowmead | path | 22.6 | 53.2 | 77.8 | 6.47 | 4.15 | 52 | 18.0 | 0.35 |
    | Harrowmead | fight | 25.8 | 61.1 | 79.5 | 11.13 | 7.24 | 162 | 20.4 | 0.47 |
    | Sarab | vantages | 17.0 | 18.5 | 42.5 | 6.28 | 4.57 | 56 | 11.3 | 0.46 |
    | Sarab | path | 16.7 | 18.1 | 23.6 | 6.22 | 4.35 | 56 | 11.1 | 0.39 |
    | Sarab | fight | 22.7 | 36.1 | 63.1 | 18.34 | 14.23 | 333 | 15.6 | 0.57 |

    The phone is GPU-bound on every part but Sarab's fight: `gpu.frame` is
    2.5-3x the tick on the look parts and 1.6-1.8x in Greyfen's and
    Harrowmead's fights, while Sarab's fight is the CPU (an 18.3 ms tick
    against 15.6 of GPU; its p95 is 36.1 against X0.4's target of 25).
    `draws` is Babylon's counter and does not see ours. **Our culls are
    1.9-3.9% of the phone's `gpu.frame`** (0.26-0.57 ms), against 0.5-1.2%
    on the desktop. Every run's heaviest eighth is still its last, the
    fight (GPU by eighths: Greyfen 13.6-20.1, Harrowmead 13.9-20.5, Sarab
    10.7-17.8), so heat and the fight are not separable in one run.

    **The provisional reading it replaces** (2026-10-20, 39d84ea's code, one
    run a map, no warm-up) drew Harrowmead and Sarab on a canvas that had
    not followed its window, 1170x618 in the same 832x384 window: about 14%
    more rows, squashed into a narrower view, which is why their draws rise
    here (46 to 49 on Harrowmead's vantages, 320 to 333 in Sarab's fight)
    while their GPU fell (Harrowmead's vantages 19.0 to 14.6, path 21.8 to
    18.0). **Greyfen is the session-to-session reading**: one matched
    1170x540 both times, the same draws, and `gpu.frame` 13.9/17.1/19.0
    then against 13.2/15.8/17.7 now, 5-8% apart with no change to what it
    draws. So **an X3.5b AFTER on the phone is a difference only past about
    8%** unless it is taken in one session beside a BEFORE. **What is short
    of the protocol**: one run a map rather than two.
  - **The landform's remaining GPU rise** (Cinderhaven's vantages and path,
    0.8-0.9 ms of `gpu.frame` on the desktop after 0dd2d09) went to
    `FINDINGS.md` 61 with the blocks'. The order half is settled below; what
    is left (about 0.6 ms on Cinderhaven's path) stays there, the cull its
    first suspect.
  - **The bank's old rows are stale.** X3.4 moved the scatter and the GPU
    driver moved (596.21 to 610.88), so 33 of the 47 rows banked before X3.5
    fail a plain `--check` on an unchanged tree. Re-taking them is the
    user's call. Until then a step is graded against a BEFORE taken with
    `--keep` at its parent (`plans/webgpu-ref/README.md` now says so).

- **The blocks ahead of the landform** (2026-10-19, after the record above).
  `"beforeAlphaTest"` is already after the sky dome, which was X3.3a's one
  objection to drawing the blocks early, so `WorldBlocks` now draws the
  blocks, the scatter and then the landform there, as ONE `FrameDraw`; a
  group is (recipe, LAYER), and nothing of ours draws at `"opaque"`. The
  floor behind a building fails the depth test before it shades.
  - **Measured**, a paired, alternating A/B against afa0327 (`bench.mjs
    --max --gpu --runs 2`, two invocations a side, ABAB on one dev server,
    3440x1440, installs within each other's spread). `gpu.frame`, median of
    four runs a side:

    | map | vantages | path | fight |
    | --- | --- | --- | --- |
    | Greyfen | 5.69 to 5.47 | 6.05 to 5.70 | 6.86 to 6.48 |
    | Sarab | 3.84 to 3.66 | 4.22 to 3.95 | 4.32 to 4.05 |
    | Cinderhaven | 5.38 to 5.32 | 5.98 to 5.74 | 5.69 to 5.57 |

    The mean frame fell 4.7-7.5% on every path (Greyfen 6.38 to 6.08, Sarab
    4.70 to 4.35, Cinderhaven 6.44 to 6.10); the CPU-bound fights on Sarab
    and Cinderhaven rose 1.3%, inside their spread. Every path's range of
    four runs clears the other side's. Draws and fight hashes unchanged.
    `FINDINGS.md` 61 has the per-segment table.
  - **The picture.** `bank.mjs --check --keep` graded against a BEFORE kept
    at afa0327 in the same session: 60 of 61 within the floor, the worst
    equal-depth ties at a building's foot (Sarab's `shelf` and `wadi`,
    0.007/255). The one over is Greyfen's `crossing` (0.056/255): the turf
    now lands after the blocks, so its sheet blends over the edge of a grave
    ledger laid level with the floor. That is BABYLON's picture — the same
    region under `?babylonworld` matches the after to 0.002/255 and the
    before by 0.96 — which X3.3c to X3.5 had lost by drawing the blocks after
    the turf.
  - **X3.5b's main pass** is no longer two draws a recipe: nothing of
    Babylon's comes between the blocks and the landform, so the fold's
    stream is one in the main pass as in every other, if it keeps the
    blocks ahead of the landform (its "What", below). (It landed at two
    draws a group with scatter, for the Intel rule: X3.5b's record.)

### X3.5b — The fold: one draw a recipe, blocks and scatter together — **M–L** (decision) — **LANDED** (52e1343, review fixes after it)

Numbered after X3.5 rather than renumbering X3.6, whose sub-steps are named
across the tree. **Decided** (the user, 2026-10-14): it lands before X3.6.

**Why.** X3.4b draws the scatter at one `drawIndexedIndirect` per part of a
set, because WebGPU has no multi-draw-indirect. The count is fixed per map
and issued every frame whatever the cull keeps: 151 instanced draws a frame
on Greyfen, and several hundred on Harrowmead and Sarab (the census totals,
over each map's vantages). Three things make that the wrong shape to carry
into X3.6:
- **They are encoded live.** Babylon's own draws replay from render bundles;
  ours run through `run(pass)` every frame, each draw two WebGPU calls
  across Chrome's wire. The desktop absorbed it (Sarab's fight rose 5.8%,
  inside the floor); the phone's reading is not yet taken.
- **Most of them draw nothing.** A set with no survivors is still a draw,
  which costs the command processor of a phone that is already GPU-bound
  (`FINDINGS.md` 52).
- **X3.6 multiplies them.** Every pass it moves (both cascades, the foliage
  map, the lamps' atlas, every probe face, the glow mask) would repeat the
  same draws: thousands a frame.

**What.** Every recipe draws ONCE per pass, the blocks, the scatter and the
terrain (X3.5) in one stream — **the main pass included**, at
`"beforeAlphaTest"` (X3.5, "The blocks ahead of the landform"), so long as
the stream keeps the blocks ahead of the landform, which is what spares the
floor its shading:
- The scatter's variant parts are cut into clusters as the blocks are
  (`clusters.ts`), each part a run of clusters in its set's own frame.
- The instance cull keeps its per-instance tests and then expands each
  surviving instance into its clusters, testing each against the frustum, so
  a big tree half in view draws half. It writes (instance, cluster) records
  into the SAME compacted stream the cluster cull writes the blocks into, in
  the same near-first order, by a scan, never an atomic append.
- The vertex stage reads its attributes from storage buffers instead of
  vertex buffers, and its `world` from the record's instance: the blocks'
  identity becomes instance 0, so one vertex stage draws both.
- **How the vertex stage learns its record is the step's first decision.**
  (a) The instance in the index's high bits and the vertex in its low bits:
  indexed draws and the post-transform cache are kept, but the two must fit
  32 bits, so the cut asserts it and hands back what does not fit. (b)
  Non-indexed draws over (record, corner): no limit, but every vertex is
  shaded once per triangle, about three times over, on a phone that is
  GPU-bound. (a), unless a map's counts break the budget.
  - **The counts, measured 2026-10-20**, at max settings on all seven
    maps off the real cut (`WorldBlocks.finish` wrapped in a scratch
    script). The VERTEX is an index into its group's buffer — every surface
    end to end, then the group's instanced parts (`finish`); the INSTANCE is
    global, the blocks' identity 0 and every scatter instance after it:

    | map | vertices, worst group | bits | instances + 1 | bits | sum | records |
    | --- | --- | --- | --- | --- | --- | --- |
    | Hollowmere | 1,127,702 | 21 | 917 | 10 | 31 | 5,315 |
    | Greyfen | 1,148,398 | 21 | 2,133 | 12 | **33** | 83,846 |
    | Coldharbour | 1,630,106 | 21 | 729 | 10 | 31 | 7,690 |
    | Harrowmead | 868,180 | 20 | 2,125 | 12 | 32 | 59,995 |
    | Sarab | 835,074 | 20 | 2,995 | 12 | 32 | 9,638 |
    | Cinderhaven | 3,672,515 | 22 | 1,351 | 11 | **33** | 5,275 |
    | Kurenai | 2,004,484 | 21 | 804 | 10 | 31 | 43,576 |

    The worst group is the merged world's (`CEL_PALETTE`) on every map, and
    it holds every set's instances too, so a split per group buys nothing;
    folding the landform into its recipe's stream moves no maximum (no
    landform group passes 163k vertices). Records, (instance, cluster) over
    every instance, peak at 83,846 (17 bits).
  - **Verdict: (a) as written does NOT fit.** Greyfen and Cinderhaven need
    33 bits, Harrowmead and Sarab exactly 32, and one split for every map
    34 (22 + 12). The product does not save it either: an index of
    instance × group vertices + vertex reaches 116% of 2^32 on Cinderhaven.
  - **What fits is (a) with the scatter addressed in its OWN region**: the
    blocks' indices stay plain vertex numbers (instance 0, at most
    3,603,508 surface vertices, 22 bits), and a scatter index sets the top
    bit, then the instance, then the vertex counted from the group's
    instanced parts (at most 69,007 a group, Cinderhaven's, 17 bits) —
    1 + 12 + 17 = **30 bits** worst (Sarab's 2,994 instances, Cinderhaven's
    parts), two to spare, decoded by shifts and a per-group base, no
    divide. It keeps (a)'s indexed draws and post-transform cache; the cut
    still asserts the budget and hands back what does not fit.
- **Two things X3.4b left are settled here:**
  - the size gate per instance against per surface (a cone or a litter pile
    under 3 px now drops where Babylon drew it inside a block);
  - the hole `BlockHandover.install` could leave: a part it skips while its
    pieces are still cut. It hands its group back instead.
- **Interim lever, not built:** if the phone shows the live encoding costing
  before the fold lands, the draw list is static (every argument indirect),
  so it can be recorded into a `GPURenderBundle` at the cut and re-recorded
  only when a bind group changes. It removes the CPU cost and not the empty
  draws, so it does not replace the fold.

- **Verify:** the census, ours at one draw a recipe in the main pass;
  `bank.mjs --check` within the floor against X3.5 (the fold moves no
  pixel but equal-depth ties); the DEV trade check silent; `shaders.mjs` for
  the new vertex stage and both culls; X0.3; the phone's tick and
  `gpu.frame` on Greyfen, Harrowmead and Sarab.

**Landed** (2026-10-21).
- **What it is.** One vertex stage draws the whole stream, PULLED: no vertex
  buffer, every attribute read out of a storage array in group 2 at the
  vertex the index names, and `world` built in `main` — identity for a
  block's or the landform's index, the instance's transform for a scatter
  index (`render/celVertex.ts`, the assembler's `VertexProgram.pull` and
  storage bindings). The index is `render/streamIndex.ts`: the top bit set
  is scatter, then 13 bits of instance, then 18 of vertex counted from the
  start of the group's arrays, where its instanced parts now lie FIRST — so
  the "per-group base" of the decision above is not needed at all. The
  instance cull keeps its per-instance tests (what `?cullcheck` reads) and
  then EXPANDS: each instanced part is cut into clusters in its set's frame,
  a record is one cluster of one instance, kept when its instance is and its
  box moved by the instance's matrix is not wholly outside a plane, and the
  kept records are scanned near-first into their group's region of one
  stream, each index written with the scatter bit and the instance set
  (`wgsl/instanceCull.ts`: `cullInstances`, `cullRecords`, `prefix`,
  `expand`). A group is one pipeline where it was two.
- **What it is NOT: one draw a recipe.** A group with scatter is TWO draws,
  its blocks' plain draw and its scatter's ONE draw, through one pipeline.
  This decision post-dates the plan above: the Intel laptop (2026-10-18,
  `docs/rendering.md`) made the blocks never-indirect after this step was
  written, and the scatter's draw could not be the blocks' — a plain range
  holding every record would hand the GPU the whole forest as triangles of
  no area every frame — so it was drawn INDIRECT at the survivors' count,
  until the same laptop's trees went too (2026-10-24): it is a plain draw
  to a BOUND the CPU computes since, `expand` dispatched direct (the dated
  note at the end of this step's landed list). Folding the landform into
  its recipe's group was not done either: the groups stay one per recipe A
  LAYER, which keeps every block ahead of every landform draw, and the one
  recipe in both layers (the rim wearing the pines' material) costs one
  draw.
- **The two things X3.4b left, settled.** The size gate stays per INSTANCE:
  the fold was to move no pixel against X3.5's picture, and a gate per block
  surface would have moved every distant prop that drops today. And a part
  `BlockHandover.install` cannot draw (an array its variant reads missing)
  now hands its whole group back (`WorldBlocks.addInstanced` withholds it,
  `finish` hands it back before anything is cut), where it was skipped while
  its pieces were still cut — a hole. A cut past the index's budget goes
  back the same way, whole: the map's instances past 8,192, or a group's
  instanced vertices past 262,144.
- **Measured** (the BEFORE at f70be50 in a worktree, the same session):
  - **`census.mjs --against --fall`: every row falls.** Ours a vantage,
    before to after: Hollowmere 113 to 8, Greyfen 161 to 17, Coldharbour 172
    to 19, Harrowmead 212 to 14, Sarab 208 to 13, Cinderhaven 206 to 11,
    Kurenai 122 to 24; Babylon's unmoved. Totals over the vantages: 1,749 to
    384, 1,090 to 226, 2,206 to 829, 3,861 to 891, 2,818 to 673, 1,008 to
    228, 428 to 134.
  - **The bank, against the BEFORE** (`--check --keep` both sides, graded at
    `CHECK_TOLERANCE`): **61 of 61 within the floor, 57 byte-identical.**
    The four that move are Greyfen's `treeline` (0.0008% of pixels),
    `marsh` (0.0005%), `crossing` (0.0002%) and `ground` (0.0001%), each
    mean 0.0000/255: equal-depth ties, the scatter's draw order now being
    near-first across a group's parts rather than part by part. No page or
    console error on either side, so the DEV trade check was silent.
  - **What it COST is memory, and it is the step's open trade.** The stream
    is sized for every record surviving, because a range can never overrun
    — that is every scatter index Babylon's merge holds. Our world's buffers
    at the deploy, before to after: Greyfen 86.8 to 206.9 MB (the stream
    30.9M indices), Harrowmead 82.4 to 166.7 (21.6M), Kurenai 154.4 to 218.1
    (16.4M), Hollowmere 83.3 to 90.6, Coldharbour 138.8 to 148.9, Sarab 74.7
    to 86.4, Cinderhaven 271.8 to 278.5. X3.3c held 680 MB on Greyfen and
    the phone drew it, so this is not a wall. **The lever, not built:** a
    region capacity under the full expansion, `prefix` clamping each draw's
    count to it and `expand` skipping what lands past it — near-first, so
    an overflow drops the FARTHEST records of the view that overflowed. It
    trades a pop in a rare view for the memory, which is the user's call
    (`FINDINGS.md` 63). **It is also a limit**: Babylon asks the device for
    no limits, so a storage binding is the default 128 MiB on every device,
    and Greyfen's stream is 92% of it; a stream past it hands back the
    groups that draw scatter (`WorldBlocks.measure`), never the map.
  - `shaders.mjs`: clean on seven maps — one build a shape now (10/10 and
    12/12, the two culls included), the pulled stage's six storage arrays
    within a default device's limits. `gate.mjs`: clean on seven maps,
    nothing handed back on any (`handedBack` 0, every taken surface drawn).
    `npm run build` and `corecheck` pass.
  - **X0.3 on the desktop** (`bench.mjs greyfen harrowmead sarab --max
    --gpu --runs 3`, 3440x1440, the BEFORE then the AFTER in one session;
    every run fought `83e8e74ef36916ba`, `3ae90f2f08fb0643` and
    `986c2e35557fb679`, every segment's spread within 8%). **The fights got
    faster**, the CPU no longer encoding a draw a part: mean new / old
    Greyfen 0.947, Harrowmead 0.932, Sarab 0.865 (its tick 11.19 to 9.77
    ms). The vantages and the path held, 0.995 to 1.017. `gpu.frame` held
    within 2% on every group (Greyfen's path 5.75 to 5.61 ms, Sarab's
    vantages 3.60 to 3.67). **The cull grew as expected**, the instances
    expanded into their records: `gpu.cull` Greyfen 0.027 to 0.095 ms on the
    vantages (0.5% to 1.7% of the frame), Harrowmead 0.029 to 0.085, Sarab
    0.029 to 0.041 — finding 61's BEFORE, now its AFTER.
- **The phone's AFTER, taken 2026-10-21** on the deployed ebdcb6f, the
  BEFORE's settings and protocol (a thrown-away warm-up, then one
  `?bench=<map>&gpu` run a map, 06:00-06:20 UTC; every frame one matched
  1170x540, `staleFrames` 0; the three canonical fight hashes) — but in the
  order **Sarab, Greyfen, Harrowmead**, where the BEFORE ran Greyfen,
  Harrowmead, Sarab. (`blocks` reads 0 taken in all three: it is read at
  the save, after the bench's map is gone. The cull's own counter is what
  says ours drew.) BEFORE to AFTER:

  | map | part | mean | tick | GPU | cull |
  | --- | --- | --- | --- | --- | --- |
  | Greyfen | vantages | 18.0 → 20.4 | 4.71 → 5.07 | 13.2 → 15.7 | 0.27 → 1.44 |
  | Greyfen | path | 19.4 → 22.1 | 5.23 → 5.34 | 15.8 → 18.3 | 0.26 → 1.35 |
  | Greyfen | fight | 23.7 → 28.1 | 11.15 → 11.61 | 17.7 → 22.2 | 0.34 → 1.76 |
  | Harrowmead | vantages | 19.5 → 21.5 | 5.61 → 6.28 | 14.6 → 16.8 | 0.34 → 1.61 |
  | Harrowmead | path | 22.6 → 22.5 | 6.47 → 6.48 | 18.0 → 18.0 | 0.35 → 1.48 |
  | Harrowmead | fight | 25.8 → 25.9 | 11.13 → 11.62 | 20.4 → 20.5 | 0.47 → 1.90 |
  | Sarab | vantages | 17.0 → 16.7 | 6.28 → 4.99 | 11.3 → 10.8 | 0.46 → 0.44 |
  | Sarab | path | 16.7 → 16.7 | 6.22 → 4.85 | 11.1 → 11.1 | 0.39 → 0.38 |
  | Sarab | fight | 22.7 → 18.4 | 18.34 → 13.60 | 15.6 → 11.9 | 0.57 → 0.47 |

  - **What is certain: the expanded cull costs the phone 1.1-1.4 ms of GPU**
    on the two forest maps (Greyfen's 83,846 records, Harrowmead's 59,995)
    and nothing on Sarab (9,638) — 7-10% of the frame, where the desktop
    paid 0.07 ms. A counter of its own, so the run order cannot make it.
  - **What is certain the other way: Sarab's fight is a quarter cheaper on
    the CPU** — its tick 18.34 to 13.60 ms, its p95 36.1 to 28.0, the
    fight that was the phone's one CPU-bound part — and every Sarab tick
    fell 1.3 ms: the draws a part are gone from the encoding.
  - **What the order confounds: the rest of `gpu.frame`.** Greyfen's GPU
    rose 2.5 ms on the vantages, of which the cull is 1.2; Harrowmead's
    vantages rose 2.2 while its path and fight held; Sarab's fight fell
    3.7. Every one of those moves the way swapping the order moves heat —
    Sarab ran first and cool where it had run last, Greyfen second where it
    had run first — so the pulled vertex stage's own price on the phone is
    not resolved by these runs.
- **The cull's `expand`, launched over the survivors** (2026-10-21, after
  the phone's AFTER). It launched a workgroup for EVERY record (83,846 on
  Greyfen, to the cluster cull's 5,612 for its scatter pass) whether or not
  it survived. Now each workgroup of `cullRecords` appends its survivors to
  a WORK LIST in one global atomic — record, band, instance and cluster in
  a `vec4u`, so `expand` reads no record or band table and both passes stay
  at the default eight storage buffers — `prefix` writes `expand`'s
  workgroup count from the list's length, and `expand` is dispatched
  INDIRECT over it. The append orders nothing: the scan has already placed
  every index, so the stream is the same stream.
  - **The first form tripled the desktop's cull** (Greyfen 0.095 to 0.290
    ms, Harrowmead 0.082 to 0.519): `expand`'s bound check was an
    `atomicLoad` of the count in every thread of every workgroup, all at one
    address. `prefix` now writes the count beside the dispatch arguments and
    `expand` reads it through a plain read-only binding of that buffer.
  - **Desktop, paired against ebdcb6f in one session** (`bench.mjs
    greyfen harrowmead sarab --max --gpu --runs 3`, the canonical hashes,
    every spread within 8%): `gpu.cull` Greyfen 0.095 to 0.068 ms, Harrowmead
    0.082 to 0.090, Sarab 0.040 to 0.058 — the clear, the barrier and the
    indirect dispatch are about 0.02 ms whatever the map, which Sarab's few
    records show — and the frame within 3% on every group. The desktop
    cannot price it: an empty workgroup was nearly free on NVIDIA, which is
    why it paid 0.07 ms where the phone paid 1.2. **The phone's `gpu.cull`
    is the reading.**
  - The bank, against the BEFORE at f70be50: 61 of 61 within the floor,
    the same four Greyfen tie rows as the step's own AFTER, no console
    error.
- **And the capture's `blocks`** (report version 19): a halted ring's is read
  as it halted, the benchmark's last frame, so a run saved from the menu
  afterwards reports the run (Sarab headless: 303 taken, 13 draws, where the
  live reading was the menu's 0).
- **The phone on the work list, taken 2026-10-22** on the deployed 1ec93a4
  (report version 19, `blocks` filled), the BEFORE's settings and its ORDER
  (a thrown-away warm-up, then Greyfen, Harrowmead, Sarab, 04:41-04:55 UTC,
  the canonical hashes) — **but on Android 17, which the phone took the day
  before**, Chrome still 155. Sarab's canvas was stale again (1170x618, not
  matched); Greyfen and Harrowmead were one matched 1170x540. BEFORE
  (f70be50) → ebdcb6f → 1ec93a4:

  | map | part | tick | GPU | cull |
  | --- | --- | --- | --- | --- |
  | Greyfen | vantages | 4.71 → 5.07 → 3.71 | 13.2 → 15.7 → 11.4 | 0.27 → 1.44 → 0.75 |
  | Greyfen | path | 5.23 → 5.34 → 3.89 | 15.8 → 18.3 → 11.8 | 0.26 → 1.35 → 0.65 |
  | Greyfen | fight | 11.15 → 11.61 → 9.60 | 17.7 → 22.2 → 13.1 | 0.34 → 1.76 → 0.87 |
  | Harrowmead | vantages | 5.61 → 6.28 → 5.66 | 14.6 → 16.8 → 13.8 | 0.34 → 1.61 → 1.17 |
  | Harrowmead | path | 6.47 → 6.48 → 6.04 | 18.0 → 18.0 → 15.0 | 0.35 → 1.48 → 1.20 |
  | Harrowmead | fight | 11.13 → 11.62 → 11.44 | 20.4 → 20.5 → 18.2 | 0.47 → 1.90 → 1.75 |
  | Sarab | vantages | 6.28 → 4.99 → 5.97 | 11.3 → 10.8 → 11.1 | 0.46 → 0.44 → 0.61 |
  | Sarab | path | 6.22 → 4.85 → 5.87 | 11.1 → 11.1 → 11.4 | 0.39 → 0.38 → 0.55 |
  | Sarab | fight | 18.34 → 13.60 → 17.25 | 15.6 → 11.9 → 13.5 | 0.57 → 0.47 → 0.76 |

  - **The phone moved under the code, so the frame is not priced.**
    ebdcb6f to 1ec93a4 changed only the cull, yet Greyfen's GPU less its
    cull fell 14.3 to 10.7 ms (-25%) and its tick 5.07 to 3.71: that is the
    OS, the order or both, not the work list. Greyfen's look parts now hold
    the 60 cap (p95 17.2 where it was 45.4). Against the BEFORE at the same
    place in the order the rest of the frame is 11-17% lower on Greyfen and
    Harrowmead, but across an OS update that is a hint, not a price.
  - **The cull is a counter of its own, and the work list roughly halved
    it on Greyfen** (1.44 to 0.75 on the vantages) **and took a quarter
    off Harrowmead's look parts and 8% off its fight** — still 2.5-3.7x
    the BEFORE on both forest maps — while Sarab's rose 0.15-0.3 ms (the
    desktop's fixed overhead was 0.02). The driver can move a counter as
    well, so the ratios are the reading, not the milliseconds.
- **Where the rest goes: the INDICES the expansion writes** (2026-10-22, a
  scratch probe on the desktop, 1ec93a4, the phone's settings and canvas —
  832x384 at 2.8125, render scale 0.5, Trees `low`, so 1170x540 and the
  same size gate — reading `args` and the work list's length back every
  400 ms through each `?bench=<map>`, the canonical hashes). What survives
  is the camera's and the settings', not the device's, so it is the phone's
  count. Means a frame, against the phone's `gpu.cull` over the BEFORE:

  | map | records | part | survivors | indices | phone cull over BEFORE |
  | --- | --- | --- | --- | --- | --- |
  | Sarab | 9,638 | vantages | 960 | 0.29 M | +0.15 |
  | Sarab | | path | 870 | 0.26 M | +0.16 |
  | Sarab | | fight | 1,820 | 0.54 M | +0.19 |
  | Greyfen | 53,485 | vantages | 4,820 | 1.73 M | +0.48 |
  | Greyfen | | path | 5,350 | 1.92 M | +0.39 |
  | Greyfen | | fight | 5,880 | 2.11 M | +0.53 |
  | Harrowmead | 41,695 | vantages | 8,530 | 3.00 M | +0.83 |
  | Harrowmead | | path | 8,710 | 3.05 M | +0.85 |
  | Harrowmead | | fight | 11,460 | 4.04 M | +1.28 |

  - **The cost follows the indices, not the records.** Greyfen has 28% more
    records than Harrowmead and costs 40-60% less, Harrowmead writing 1.6-1.9x
    its indices. About 0.1 ms plus 0.25-0.3 ms a million indices fits all
    nine; a million is 4 MiB written and 4 MiB of `source` read, so the
    phone is moving the stream at roughly 25-30 GB/s, where the desktop's
    bandwidth makes the same bytes 0.03 ms. The record pass is not the cost,
    so skipping a culled instance's records would not buy it back.
  - **A survivor is about 355 indices** on both forest maps (a cluster of
    ~120 triangles), and 10% (Greyfen) to 28% (Harrowmead) of the records
    survive — which is why the work list halved Greyfen's cull and took
    less off Harrowmead's: it removed the empty workgroups, not the writes.
  - The milliseconds carry the Android 17 caveat above; the ordering and
    the fit do not depend on them.
- **The copy's source at 16 bits** (2026-10-22, the third lever of
  `FINDINGS.md` 63). `expand` read a 32-bit `source` index for every index
  it wrote, so a million indices was 8 MiB of traffic; the source is now 16
  bits an index, local to its PART, two to a word (`sourceIndex`), and each
  scatter cluster carries its part's first vertex in its group's arrays in
  the spare `refs.y` — so the stream it writes is the same stream, bit for
  bit, at three quarters of the bytes. A part past 65,536 vertices
  (`SOURCE_VERTICES`) hands its group back in `WorldBlocks.handBack`
  beside the stream index's two budgets; no shipped part is near it (the
  census below is unchanged on every map).
  - **The picture is the same picture**: the bank's 61 frames pixel-identical
    to 1ec93a4's own (mean 0, max 0, every one), and its report against the
    banked frames identical line for line; the census (`--against` X3.5b's
    AFTER) equal on all seven maps; `shaders.mjs` clean on seven; gate.mjs
    clean on Greyfen, Harrowmead and Sarab; build passes.
  - **Desktop, against 1ec93a4's own run** (`bench.mjs --max --gpu --runs
    3`, the canonical hashes, every segment within 8%): `gpu.cull` Greyfen
    0.068 to 0.067 ms, Harrowmead 0.090 to 0.085, Sarab 0.058 to 0.057; the
    look parts within 1%. The fights read 6-12% faster on the CPU tick, which
    a GPU buffer's format cannot do — a day apart, that is the session. As
    before, the desktop's bandwidth hides what this saves.
- **`?scatterlist`: the survivors' list drawn, nothing expanded**
  (2026-10-22, `FINDINGS.md` 63's first lever, as an A/B a phone can take
  from one build). The scan counts SURVIVORS; `expand` is a thread a
  survivor writing its one 16-byte entry (instance, first source index,
  count, part — `streamIndex.ts`'s `LIST_WORDS`) where the scan puts it;
  each range's draw is a non-indexed `drawIndirect` of 384 corners a
  survivor (128 triangles, a cluster's most), first corner the scatter bit
  over `slot * 384`; and the vertex stage's list twin (`celVertex`'s
  third argument) reads the entry and the 16-bit source itself, a corner
  past its cluster's count repeating the last so a short cluster ends in
  triangles of no area. Only the groups that draw scatter wear the twin,
  chosen at `finish` once the cull exists (so group 2 and the pipeline ask
  moved after it), binding the list and the source beside their arrays:
  eight storage buffers in a palette variant, the default limit, which
  `shaders.mjs` now builds on every map. The stream is never allocated —
  Sarab's list is 154 KB where its stream was 12 MB.
  - **The same picture**: the bank under `?scatterlist` pixel-identical to
    stream mode's frames, all 61 (mean 0, max 0), no console error; the
    census under it equal on all seven maps; a probe saw the list cull,
    the list stage and only `drawIndirect` under the flag, and only
    `drawIndexedIndirect` without; captures say `forced: ["scatterlist"]`.
  - **Desktop, the two modes back to back** (`bench.mjs --max --gpu --runs
    3`, then `--query scatterlist`, the canonical hashes): `gpu.cull`
    Greyfen 0.066 to 0.050 ms, Harrowmead 0.085 to 0.053 (fight 0.097 to
    0.057), Sarab 0.057 to 0.050 — while `gpu.frame` ROSE 1-3% (Greyfen's
    vantages 5.37 to 5.51, Harrowmead's fight 5.44 to 5.60, Sarab +0.4-1.1%):
    the vertex stage's lost reuse costs the desktop about 0.15 ms where the
    cull saves 0.03. The phone's cull saves an order more, and its vertex
    work costs what only its run can say.
- **The phone's A/B, taken 2026-10-23** on the deployed d763327 (Android 17,
  Chrome 155, report version 19, one matched 1170x540 on all six, the
  canonical hashes), in the protocol's order: Greyfen stream then list,
  Harrowmead list then stream, Sarab stream then list, 00:52-01:22 UTC.
  Stream → list, the segment groups' means (GPU less cull is the one
  subtracted from the other):

  | map | part | tick | GPU | cull | GPU less cull |
  | --- | --- | --- | --- | --- | --- |
  | Greyfen | vantages | 4.04 → 4.04 | 12.29 → 11.97 | 0.82 → 0.40 | 11.47 → 11.58 |
  | Greyfen | path | 5.03 → 4.80 | 15.07 → 14.44 | 0.87 → 0.38 | 14.20 → 14.06 |
  | Greyfen | fight | 12.92 → 11.71 | 18.11 → 16.97 | 1.17 → 0.51 | 16.94 → 16.46 |
  | Harrowmead | vantages | 5.14 → 4.46 | 12.64 → 12.04 | 1.09 → 0.41 | 11.55 → 11.63 |
  | Harrowmead | path | 4.83 → 4.39 | 13.34 → 11.87 | 1.08 → 0.36 | 12.26 → 11.51 |
  | Harrowmead | fight | 10.59 → 9.88 | 15.49 → 14.98 | 1.53 → 0.49 | 13.96 → 14.49 |
  | Sarab | vantages | 4.88 → 5.79 | 10.59 → 10.83 | 0.62 → 0.51 | 9.97 → 10.32 |
  | Sarab | path | 4.90 → 5.06 | 10.78 → 11.16 | 0.55 → 0.45 | 10.23 → 10.71 |
  | Sarab | fight | 13.84 → 16.80 | 10.19 → 11.09 | 0.65 → 0.53 | 9.54 → 10.56 |

  - **The list takes 55-70% off the forest maps' cull** (0.4-1.0 ms) and
    15-20% off Sarab's (0.1): the writes were the cost, as the probe said.
  - **The lost vertex reuse costs the phone too, about half of what the
    cull saves.** Paired vantage by vantage on medians where the tick says
    the phone was in one state (Greyfen's, Harrowmead's millpond,
    borderland, ground and crossing), the rest of the GPU frame rose 0-0.8
    ms; both forest fights +0.7 (medians). On Sarab it rose 0.1-1.0, but
    its list run was the hotter one (tick +19% on the vantages, +21% on the
    fight, which a GPU binding cannot do).
  - **So the frame: a small win on the forest maps, a small loss on
    Sarab.** Greyfen's list run went second and still read 0.3-1.1 ms
    lower on every group (fight 18.1 to 17.0, frame 24.4 to 23.5 ms);
    Harrowmead's 0.5-1.5 lower, but it went first and the stream run's
    tick was 7-15% higher, so that is the heat's as much as the list's.
    Sarab 0.24-0.9 higher, its fight bound by the CPU either way (tick
    13.8-16.8 against a 10-11 ms GPU). The look parts held the 60 cap in
    both modes on every map.
  - **The 16-bit source has no phone reading.** The stream mode's cull
    against 1ec93a4's capture a day earlier: Greyfen 0.75 to 0.82 on the
    vantages (fight 0.87 to 1.17), Harrowmead 1.17 to 1.09 (fight 1.75 to
    1.53), Sarab within 0.1 — across sessions and either way, so nothing.
- **The list is the only draw now, and the stream is gone** (2026-10-23,
  the user's decision on the A/B above). The cull writes the list and
  nothing else: no stream buffer, no `expand` that copies indices, no
  `drawIndexedIndirect`, no `?scatterlist`. `render/streamIndex.ts` became
  `render/scatterList.ts` — the entry, an index as the scatter bit over
  `slot * 384 + corner`, the 16-bit source and its read — and the 13/18-bit
  split went with the stream, so the budget a cut is held to is the list's:
  records times 384 corners past 2^31, or the list past the device's
  storage limit, hands back the scatter's groups, and a part past 65,536
  vertices its own (CLAUDE.md states it). The vertex stage keeps two
  variants, the plain one (every index a plain vertex, no list bound) for a
  group without scatter and the SCATTER twin for one with; `drawIndirect`'s
  arguments are four words a range, not five. `FINDINGS.md` 63 — the
  stream's 124 MB on Greyfen and 92% of a default storage binding — is
  deleted as fixed; its distance-rung idea went with it, unmeasured.
  - **The same picture**: the bank's 61 frames pixel-identical to
    `?scatterlist`'s and to the stream mode's (mean 0, max 0, every one),
    its report against the banked frames identical line for line, no
    console error; the census (`--against` X3.5b's AFTER) equal on all
    seven maps; `shaders.mjs` clean on seven (a row fewer, the one cull);
    gate.mjs clean on Greyfen, Harrowmead and Sarab; build passes.
  - **Desktop, against the flagged list run** (`--max --gpu --runs 3`, the
    canonical hashes): every group within 2% but Sarab's fight (7% faster
    on the tick, the session's); `gpu.cull` 0.049-0.057 ms on all three.
- **2026-10-24: the scatter is drawn PLAIN, at a bound the CPU computes —
  a fix, not a step.** It corrects this step's draw in every view X3.6a-c
  built on it, and changes no plan. What the laptop showed, its A/B's
  answer (the scatter's indirect DRAWS, not `expand`'s dispatch) and why
  `expand` stays direct anyway, and the bound, the cleared list and the
  zero entry are argued in
  `docs/rendering.md`, "NOTHING OF THE STATIC WORLD IS DRAWN OR DISPATCHED
  INDIRECT". Each range is `draw(bound * 384, 1, SCATTER_CORNERS + base *
  384, 0)` (`InstanceCull.drawRange`, `empty`) from both draw sites
  (`WorldBlocks.drawScatter`, `WorldDepth.draw`), so every view changed
  together. The A/B shipped with it as a TEMPORARY switch
  (`?scatterindirect`, the path before exactly; `?scatterindirect=dispatch`,
  the plain draw with `expand` alone indirect), named in a capture's
  `graphics.forced`, and was stripped once the laptop answered (below).
  - **Rejected** (the design, in this session's scratch): a plain draw over
    the list's whole capacity (32 M corners a pass on Greyfen), a count read
    back a few frames late (pop-in on a cut, a probe face with no history),
    and gating it to the device (nobody knows which devices drop).
  - **Measured on the desktop** (`--max`, the RTX box; the scratch logs
    are this session's):
    - **The same picture**: the bank's 61 frames byte-identical to ed51e1d's
      (a BEFORE in the worktree), and again under `?scatterindirect` and
      under `?scatterindirect=dispatch` — 61 of 61 each, mean 0, max 0 — its
      report identical line for line, no console error.
    - **The bound is never short**: a probe copied every dispatch's `args`
      out in its own encoder and compared each range with the CPU's bound,
      through a whole `?bench=<map>` on seven maps (the install's probe
      bake, the vantages at eight headings, the path, the fight: 3,670-7,138
      dispatches a map; every one but every fourth of the main pass's) —
      max(count - bound) 0 in every view, at max settings (3440x1440) and at
      a phone's (2400x1080, Trees, shadows, GI, grass and bloom low).
      Bound over count, summed over the run: the main pass 1.004 (Sarab) to
      1.20 (Greyfen) at max, 1.004-1.19 at the phone's; the cascades
      1.01-1.20, the foliage map 1.04-1.14, a probe's faces 1.02-1.09, the
      lamps' faces 1.18-1.87 over a few thousand survivors; a single
      dispatch's ratio runs higher where its count is a handful. Under
      1.5 everywhere it matters, so the lever (the clusters of a straddling
      instance tested on the CPU) is not built.
    - **The census** (`--against` ed51e1d's): ours lower on five maps —
      Greyfen 213 to 205, Coldharbour 674 to 672, Harrowmead 851 to 847,
      Sarab 669 to 661, Kurenai 131 to 125, a range at bound 0 drawing
      nothing — and equal on Hollowmere (278) and Cinderhaven (186);
      `?scatterindirect` equal to ed51e1d on all seven.
    - `gate.mjs` and `shaders.mjs` clean on seven; typecheck, build,
      corecheck.
    - **X0.3** (`bench.mjs --max --gpu`, 3440x1440, uncapped, one run an
      invocation, plain alternated with `?scatterindirect`, three a side,
      the canonical fight hashes on all 18), plain over indirect: Greyfen
      frame 1.001 / 1.003 / 0.996 (vantages / path / fight), `gpu.frame`
      1.002 / 0.999 / 0.994, tick 1.005 / 0.996 / 0.998; Harrowmead frame
      1.000 / 0.997 / 0.984, `gpu.frame` 0.984 / 1.013 / 1.000, tick
      1.004 / 0.993 / 0.980; Kurenai frame 0.995 / 0.997 / 0.988,
      `gpu.frame` 0.994 / 1.035 (17 samples) / 0.998, tick 1.008 / 0.988 /
      0.988. `gpu.cull` fell about a third on all three (51-61 to 33-42
      µs): the indirect `expand` cost more than the direct one and the
      clear. Nothing past the session's floor. Greyfen's bench install read
      1.1 s longer on the plain arm; a paired install at 1920x1080 did not
      reproduce it (8.4-8.9 s plain, 8.6-9.3 s indirect), and `dispatch`
      took 25-35 µs a call with the bound against 5 without.
  - **What the post-commit review found** (two independent readers over
    e172f88, one for correctness and one for shape and contracts; fixed
    after it). No correctness defect: the bound was confirmed against
    `visible` test by test (the reach, the size gate and its near cut, the
    five planes and each set's sway, a probe's exclusion left out), the
    order of every caller (a dispatch's survivors drawn before the view's
    next), the zero guard in the shared decode, and the arithmetic (`+`
    over the sign bit, the bound times the stride under 2^31). On the
    shape: nothing stated that `visible` has a CPU mirror (both headers and
    `bound`'s doc now do: a test that keeps more owes `bound` the same
    widening); `args` was described as read back by a probe that is not in
    the tree; `EXPAND_SIZE` was said to be read by the bound (it sizes the
    direct dispatch); a citation put `ScatterDraw` in `InstanceCull.ts`;
    `WorldBlocks`' header had a sentence with no subject; `SLACK_CPU` is
    `PLANE_SLACK`; `drawRange` returned a boolean no caller needed (`void`,
    behind `empty`); `CullDiagnostics` did not say a sharing view draws as
    the uploading view does; the A/B's branches and parameters were
    untagged (each now `TEMPORARY (?scatterindirect)`, and
    `docs/rendering.md`'s strip note lists what goes dead with them); the
    `InstanceCull` header's invariants described both arms in a 30-line
    chain; and the arms were described in eleven places (once now, on
    `ScatterDraw`, and pointers — this note's argument cut to the one in
    `docs/rendering.md`, `SCATTER_BIT` there and here named as the TS
    constant, `SCATTER_CORNERS`). Re-checked after the fixes: the bank 61
    of 61 byte-identical to ed51e1d's frames on the default arm, its report
    identical line for line to the commit's; typecheck, build and
    corecheck. The A/B arms were not re-banked: the fixes moved none of
    their branches.
  - **The laptop answered** (the user, 2026-10-24, on the deployed
    071a95e, four loads each): the default — no flicker;
    `?scatterindirect` — FLICKERS; `?scatterindirect=dispatch` — no
    flicker. So it was the scatter's indirect DRAWS, and the suspicion on
    `expand`'s indirect dispatch is DISPROVED; every tree going together
    reads as that driver dropping a whole pass's or frame's indirect draws
    together, not one at random as the blocks' symptom read on 2026-10-18.
    `expand` stays direct anyway, by the user's decision, so the rule stays
    one rule (nothing of the static world drawn OR dispatched indirect):
    less code, and the direct dispatch cost nothing (`gpu.cull` fell about
    a third, above). The switches came out in the commit after 071a95e,
    with the indirect arguments `prefix` wrote for them (`args`, `expand`'s
    dispatch words, `INDIRECT_BYTES`, `DISPATCH_BYTES`, `MAX_WORKGROUPS`);
    `expand` now reads the work list's length through a plain binding of
    the counter `cullRecords` appends with. Re-checked: the bank 61 of 61
    byte-identical to ed51e1d's frames, the census as e172f88's default on
    all seven, `gate.mjs` and `shaders.mjs` clean on seven, typecheck,
    build, corecheck.
  - **Owed**: the phone, against a capture of the build before e172f88
    (there is no switch any more), alternated, which is where the bound's
    CPU would show: `bound()` loops over every instance of the map on every
    dispatch, each lamp face's and each probe face's included, 25-35 µs a
    dispatch on the desktop, so a phone frame re-baking several lamp faces,
    or a probe burst, could add a few ms of CPU.
- **Owed.** A same-session pair against 3b9be6c still prices the fold
  itself.

### X3.6 — The static world's other passes (PERF_PLAN B3) — **L, as five sub-steps** (the fifth added 2026-10-24)

Each sub-step lands on its own. Under rule 5, each pass's texture moves to our
side here, and Babylon's materials, which still draw the bodies and the rest,
sample a wrapped view of it — but for X3.6d's: the glow's MASK stays
`GlowPass`'s, because the bodies, the effects, the fire, the viewmodel and the
moon still draw into it and its blur and the ink read it, so ours draws INTO
Babylon's pass there, as it draws into the main pass, and nothing is wrapped.
Every pass draws through X3.5b's fold: a group's plain draw and, with scatter,
its one draw, a pass — indirect when these steps landed, plain at a bound the
CPU computes since 2026-10-24 (X3.5b's landed list).

- **X3.6a — the world's shadows:** both cascades, the foliage map and the
  lightning flash map (`ShadowSystem`, today a `ShadowGenerator` with a
  `DirectionalLight` per map). The texel snap (`core/shadowWindow.ts`), the
  back-face recording and "only re-render when the snapped focus moves" all
  hold **LANDED** (below).
- **X3.6b — the lamps' atlas:** `LocalShadows`' static faces — and, the
  texture being one side's whole, its dynamic tiles and its clears with
  them **LANDED** (below).
- **X3.6c — the reflection bake:** `ReflectionSystem`'s probes, which draw the
  world from each probe with the probe's eye passed explicitly. That removes
  the class of bug 242b986 and a858c74 fixed: a `ReflectionProbe` never moving
  `scene.activeCamera`. The bake still drains behind the loading card
  **LANDED** (below).
- **X3.6d — the glow mask** for the emissive palette's static meshes
  (`GlowPass`; `shaders/EmissiveWorld.ts`) **LANDED** (below).
- **X3.6e — the palette's main pass** (decided 2026-10-24) — **S–M**. Added
  after X3.6d by the user's decision ("Decisions that are yours"), not part of
  the step as first planned, and measured first because it could flip the
  pixels where a lit window ties in depth with a coplanar surface.
  - **Do:** the palette held since X3.6c is TAKEN for the main pass whenever
    the handover holds the whole palette, one decision with the mask; drawn
    FIRST in `WorldBlocks`' `"beforeAlphaTest"` draw, ahead of the blocks, by
    the bake's own pipeline; reach-culled by its cell's box, as Babylon's
    candidate was; a loss of either pass hands both back.
  - **Verify:** the bank against a BEFORE at c34a06b; the in-page A/B (frame
    and mask, ours against Babylon's after a loss); `census --fall`; the gate;
    the paths; X0.3.
  - **Must not:** flip a palette-against-block tie (the palette is drawn before
    every surface of ours, as Babylon's opaque queue drew it); draw a palette
    pixel past the reach; leave a palette mesh bloomed by neither side.
  **LANDED** (below).

- **Verify, each:** the bank; X0.3; and for X3.6c, the probe-eye harness that
  measured 242b986, run again.

**X3.6a landed** (93d5918, the post-commit review's fixes after it; 2026-10-23).
- **What it is.** The world's four directional maps — both cascades, the
  foliage's front-face map and the lightning's — are textures our renderer
  OWNS (`render/WorldShadows.ts`) and draws the casters into
  (`render/WorldDepth.ts`, the depth program `render/celDepth.ts`) whenever
  the handover holds EVERY caster a map has; Babylon's readers (the cel
  materials, the grass, the water, the volumetrics) sample a wrapped view
  (`WebGPUEngine.wrapWebGPUTexture`), and our frame binds the texture itself
  (`OwnTexture`) — rule 5 both ways. `ShadowSystem` keeps the lights, the
  windows, the snap, the hold and the strike, and hands each map's matrix
  over; its `ShadowGenerator`s are the path for an editor build,
  `?babylonworld`, a map with a caster the handover cannot hold, and a map
  whose casters are LOST mid-map (a group's or a cull's failure, a refused
  main pass: `WorldShadows.lose`, handed over after the task in hand because
  a refusal lands inside a render whose unsubmitted commands still hold the
  textures).
- **Every caster held, two ways.** A surface the main pass takes casts from
  its own group; a caster it does not take — the emissive palette's merges,
  which keep no recipe — is held for the shadow maps ALONE
  (`WorldBlocks.addCaster`: positions only, one "casters" group cut after
  every other, which the main pass's cull leaves out as a tail and no main
  pass draws). Which surfaces cast is Babylon's generator's rule, stated
  once a side (`BlockHandover.passesOf`, `ShadowSystem.casts`): not
  `noShadowCaster`, not blended; `PASS_SOLID` too for a translucent solid.
  Every shipped map holds every caster: 78 casting surfaces on Hollowmere
  (24 of them emissive, held alone), 353 on Greyfen (9), 154 on Coldharbour
  (46), 108 on Harrowmead (4), 171 on Sarab (6), 179 on Cinderhaven (49),
  170 on Kurenai (4).
- **A map is a second VIEW of the main pass's culls.** `ClusterCull` and
  `InstanceCull` split into a map's TABLES, uploaded once by the main pass's
  view, and per-view outputs; a cull reads its inputs as data
  (`CullInputs`: a view-projection, an eye, the reach, the size gate, the
  sway, a PASS MASK), and each cluster's record carries the passes it is
  drawn in (`sway.z`; the uniform block grew a tenth `vec4u` for the mask,
  which the main pass's view sets to 0 and never tests). The shadow view is
  told the light's matrix and eye, no reach, no gate and no sway — Babylon's
  depth pass culled nothing but the window and never swayed a vertex — and
  serves all four maps in one submit through a staging SLOT a map
  (`CullUniform`), each map's draws reading the indices its own dispatch
  wrote. Faces by the generator's rule (the back for the far, near and
  flash maps, the front for the foliage's).
- **Babylon's number, at a quarter of the memory.** The depth is the light's
  clip z under the half-z range from a matrix built by `getTransformMatrix`'s
  own helpers in its order (`ShadowSystem.lightTransform`), drawn upside down
  as every render target is, into `r16float` where Babylon's was
  `rgba16float` with three channels nobody read; the `depth32float`
  attachments are one a size, shared. A map is drawn only when
  `ShadowSystem` asks, on the next frame our renderer prepares, into the
  encoder Babylon submits ahead of every pass of its own; the probes' bake
  waits on `ShadowSystem.ready` beside `gi.converged`.
- **Measured.**
  - **The maps themselves, against the generators** (a scratch readback of
    both sides' maps at each map's menu vantage in one page, after the
    review's fixes): texels differing, far / near / foliage —
    Hollowmere 7 / 2 / 0 (of 4.2 M, 4.2 M and 1 M), Greyfen 837 / 357 / 155,
    Coldharbour 0 / 2 / 0, Harrowmead 66 / 14 / 21, Sarab 10 / 2 / 0,
    Cinderhaven 3 / 6 / 0, Kurenai 63 / 72 / 8 — Greyfen's far map the worst
    at 0.02% of its texels.
    Coldharbour's far map is identical; what differs is a triangle's edge
    across a texel's centre, worst on Greyfen, whose scatter is 87% of the
    world: its instances are moved by their matrices on the GPU where
    Babylon's merged copy was moved on the CPU.
  - **The bank, against a BEFORE kept at a78a4eb in the same session**
    (`--check --keep` both sides, graded at `CHECK_TOLERANCE`): **61 of 61
    within the floor, 37 byte-identical**, the worst Greyfen's `crossing`
    (0.0088% of pixels, mean 0.0004/255), `menu`, `canopy`, `marsh` and
    `treeline` (under 0.01% each), and Harrowmead's `borderland`. No
    console or page error. The bank, the census and `shaders.mjs` ran before the
    review's fixes; the readback above, taken after them, matches its own
    reading before them texel for texel, and the gate and the benchmark ran
    on the committed code but for the culls' buffer labels.
  - **`census.mjs --against`** the BEFORE: equal on all seven maps (384,
    226, 829, 891, 673, 228, 134) — the step moves no main-pass draw.
  - **`shaders.mjs`**: clean on seven maps, our builds 15/15 and 19/19 (the
    depth pipelines, plain and scatter, by faces, among them). **`gate.mjs`**:
    clean on seven.
  - **The paths no instrument covers**, forced in a scratch page on
    Hollowmere: a rung change to `low` and back while the maps are ours
    (re-made, redrawn), a strike (the flash map drawn), a forced LOSS (the
    four generators built, `depthMap` theirs), a second round after it (ours
    again, no generator), and the editor (`F2`: the generators). No page or
    console error.
  - **X0.3 on the desktop** (`bench.mjs greyfen harrowmead sarab --max --gpu --runs 3`,
    3440x1440, the BEFORE at a78a4eb in the same session, the canonical fight
    hashes on every run, every segment within 3.1%): the mean frame new /
    old 0.997-1.000 on the vantages, 0.998-1.002 on the path and 0.929-0.972
    in the fights. Babylon's draw counter falls where its depth passes went —
    the paths 97 to 38 (Greyfen), 76 to 58 (Harrowmead), 86 to 65 (Sarab).
    `gpu.frame` within 2% on the look parts; Greyfen's fight 6.11 to 6.53 ms
    over 351 and 133 samples. The tick rose on Greyfen's vantages (3.90 to
    4.50 ms), all of it in `render` at equal draws, and is BACK-PRESSURE on a
    GPU-bound segment rather than work: at one vantage in one page, the maps
    handed back and forth three times a side, `scene.render`'s span reads
    0.69-0.83 ms ours against 0.67-0.75 Babylon's capped, and lower ours
    uncapped. The maps redraw only when a window moves: none on a still
    camera, bursts of 2-10 a second of the three static maps together as the
    benchmark's camera moves on.
  - **Two stalls, and they are not this step's.** The first AFTER
    benchmark's third Greyfen run never reached the round (its 40-minute
    timeout), and one gate run recorded no frame in Hollowmere's warm
    window. A watchdog over the benchmark's workload, nine runs back to back
    in one browser (`--max`, uncapped, 3440x1440), caught the cause:
    `DXGI_ERROR_DEVICE_HUNG`, the D3D12 device removed mid-run, rendering
    stopped. And it is the MACHINE's, not the step's — the identical loop at
    the parent, a78a4eb, hung 6 of 9 runs (all three maps), against 4 of 9
    at 4fd2e85 (Greyfen 3, Harrowmead 1) — and 4 of 9 at 1920x1080, 4 of 9
    capped at 60, and 5 of 9 under `?babylonworld`, our renderer drawing
    nothing at all. `FINDINGS.md` 64.
  - **What the shadow view costs in memory** — measured off every buffer and texture made through the install:
    the textures are 40 MiB on the `high` rung (two 2048 and two 1024
    `r16float` maps and one `depth32float` attachment a size), where the
    generators held about 120 (an `rgba16float` colour and a `depth32float`
    of its own a map); the second view of the culls is 12.1 MiB on Greyfen
    and Harrowmead, 9.6 on Sarab, 16.5 on Kurenai and 27.6 on Cinderhaven
    (an index buffer as large as the map's, and the scatter's per-record
    scratch). So the step takes 50-70 MiB off every map on a rung that
    draws one; on `off` it holds nothing (no caster is held, review below).
- **What the review found** (fixed before the commit): `WorldBlocks`'
  contract header still described two layers; a `WorldDepth` was built for a
  map whose casters had already gone back at the cut (now skipped, and the
  install already refused the hand-over when a casting surface went back
  during the cut); the
  map count restated as `SHADOW_SLOTS`; a closure and iterators made on a
  redraw frame; the shadow view's eye at the origin (the light's now — the
  bands are the camera's, which a light ~90 m back mostly lands past, so it
  orders little); a view's buffers labelled
  as the map's (each now names its view); comments the step made false (the
  uniform's nine words, a reader's channel).
- **What the post-commit review found** (a second, independent reader over
  93d5918; fixed after it): `ShadowSystem.remakeOurs` kept a texture of the
  same size under a view it had just disposed, which Babylon destroys at its
  frame's end — latent, no path re-made a map at its own size, but nothing
  stopped one (now always made afresh); `settled` waited on the LATEST ask,
  which a moving window renews for as long as it moves, so the probes' bake
  could be held off without limit (now each map's FIRST draw since its
  casters or its texture changed; the two stalls above turned out to be
  the device, not this); the culls' second view built on the `off` rung, where
  no map is drawn (no caster is held there now: `WorldShadows.rungDraws`,
  which `ShadowSystem.setQuality` states — a rung switched on mid-map draws
  on the generators until the next map); the foliage and flash matrices
  not re-published on a hand-over; two `Vector3.Up()` a redraw; a scatter
  part never asked whether it blends; `WorldBlocks` told whether to build
  the depth by a boolean and counting the slots itself (it is handed the
  count); and docs the step had over-claimed (the eye's ordering, which
  the camera's bands mostly lose; the memory on `off`; whose meshes cast
  on the fallback). A single group's failed pipeline still loses every
  map, deliberately: one owner a map. Re-checked after the fixes: the
  readback on seven maps, the gate on seven, and the paths above with a
  round on `off` (no caster held, no generator) and back on `high` (ours).
- **Owed onward.**
  - The shadow maps are not timed on our side: their culls are not in
    `gpu.cull`, and `shadowPass` brackets only Babylon's generators — in a
    round, only the bodies'. So when the phone's FOLLOW-UP reading is taken
    (owed as every step's has been since X3.3c, the user's to take; the
    step's own Verify — the bank and X0.3 — is above), it is read as
    `gpu.frame` against X3.5b's.
  - X3.6b, the lamps' atlas, holds `map.visuals` the same way: the caster
    groups and the pass mask are its to extend.

**X3.6b landed** (5b31851, the post-commit review's fixes after it;
2026-10-23).
- **What it is.** The lamps' atlas is a texture our renderer OWNS
  (`render/LampAtlas.ts`, an `r16float` colour as Babylon's render target's
  was, and a `depth32float` attachment) and draws EVERY pass
  of whenever the handover holds every caster; Babylon's cel materials
  sample a wrapped view (`wrapShadowTexture`, now `core/shadowWindow.ts`'s,
  which `ShadowSystem` uses too) and our frame binds the texture itself
  (`ShadowBindings`' `own.localAtlasMap`). `LocalShadows` still decides
  everything — which lights cast, which tiles each holds, which faces bake
  on which frame, what reaches the slots — and on our side hands the frame's
  work over as one `AtlasWork` over the arrays it already filled
  (`LampAtlas.queue`), where Babylon's side draws it into its render target
  as before. Who holds it is read at `LocalShadows.setWorld`, after the
  install, as the world's maps are; a loss (`LampAtlas.lose`, beside
  `WorldShadows.lose`) hands it back after the task in hand.
- **Every pass moved, not only the static faces.** A static tile and a
  dynamic one share the texture, and the cel stage binds one atlas at 16 of
  16 textures, so the step could not leave the proxies Babylon's: the
  proxies (collider boxes and bodies) are one instanced unit box (the
  kit's `createBox`, unrolled into 36 corners), its matrix and tile an
  instance's, one draw for every dynamic tile; a tile flagged cleared is a
  `copyBufferToTexture` of a tile of the far value. The passes keep
  Babylon's order (clears, static faces, proxies); the colour is loaded by
  every pass and the depth cleared by every pass and stored by none.
- **A static face is a view of the culls.** The atlas's casters are their own
  pass bit, `PASS_LAMPS` — every surface not `noShadowCaster`, BLENDED OR
  NOT, because Babylon's bake drew its visuals whatever their material;
  on every shipped map no blended surface casts, so the set is the world
  maps'. Each static face is culled as a directional map is
  (`WorldDepth` split into `cull` and `draw`, the pass the caller's), at a
  slot of its own after the world's four (`staticFacesPerFrame` slots):
  the face's perspective as a view-projection (`lampDepth.faceInputs`), the
  light as the eye, the light's range as the reach. The program
  (`render/lampDepth.ts`) is `localShadowDepth` in the pulled form — the
  radial distance over the range from the back faces, the fragment
  discarded outside the face — over the world's arrays, its scatter twin and
  the proxies'.
- **Measured.**
  - **The atlas itself, against Babylon's** (a scratch readback, ours / Babylon's /
    ours again from a fresh allocation at one eye, three vantages near
    clusters of shadowed fixtures a map; static tiles on `high`, the
    dynamic ones on `low`, where every light is proxies). Ours against ours
    is 0 texels everywhere; the dynamic tiles are identical to Babylon's on
    every map. On the static tiles, first on seven maps, then on Harrowmead
    and Hollowmere after the reach fix below:
    texels a receiver can read differently (both values clamped at 1, the
    lookup being asked only inside the range; over 0.01): Harrowmead 0 / 0 /
    0, Hollowmere 3 / 0 / 5 — silhouette edges across a texel centre, both
    sides covering the same count of in-range texels on every tile. Before
    the clamp, the raw count over 0.01 is 70 / 70 / 448 and 281 / 0 / 5:
    texels past the range where one side stored a distance over 1 and the
    other the far value — Babylon tested a MESH against the range, the cull
    tests a cluster's BLOCK — which read "lit" alike. The first seven-map
    readback (before the fix) was edge and rounding differences of the same
    kind: Greyfen 62 texels at most, Coldharbour 27 at 0.0005, Sarab and
    Cinderhaven under 0.19% of a tile's texels, Kurenai 0.
  - **The bank, against a BEFORE kept at e1fbb9a in a worktree**
    (`--check --keep` both sides): **61 of 61 byte-identical**. No console
    or page error.
  - **`census.mjs --against`** the BEFORE: equal on all seven maps (384,
    226, 829, 891, 673, 228, 134).
  - **`shaders.mjs`**: clean on seven maps, our builds 15/15 and 19/19 (the
    lamp pipelines among them). **`gate.mjs`**: clean on seven.
  - **The paths no instrument covers**, forced in a scratch page on
    Hollowmere and Coldharbour: ours after every install on all seven maps;
    a rung change (`low`, `off` and back) while the atlas is ours; a forced
    LOSS (Babylon's render target, then ours again on the next map); a
    second round; a round installed on `off` and raised (Babylon's until the
    next map, as the world's maps); the editor and `?babylonworld`
    (Babylon's). No page or console error. These ran before the reach fix,
    which changes one number in the cull's inputs.
  - **X0.3 on the desktop** (`bench.mjs`'s run, settings and summary —
    `--max`, `&gpu`, uncapped, 3440x1440, three runs a side — through a
    scratch driver that alternates the two trees run by run in one browser
    and abandons a run the device hangs, the canonical fight hashes on all
    18 runs, every segment within 0.978-1.013): the mean frame new / old
    0.997-1.000 on the vantages, 0.995-1.000 on the path, 0.994-1.013 in
    the fights; `gpu.frame` level; Babylon's draw counter equal or 1-3
    lower.
  - **The machine's device hang (`FINDINGS.md` 64) was at its worst all
    session**: 64 nvlddmkm event-153 hangs in about three hours, every
    stall killed matching one, on both trees (the BEFORE's Cinderhaven bank
    2 of 3, its Hollowmere census 3 of 3), so every GPU instrument above ran
    one map a process with retries, and nothing is the step's.
- **What the post-commit review found** (an independent reader over
  5b31851; fixed after it): the tile clears built four descriptor objects a
  copy, a frame (now three made with the atlas, the origin moved a tile);
  a proxies' pipeline that failed to build left `ready` false for good, so
  every lamp went unshadowed with Babylon's render target sitting idle (it
  now loses the casters and takes none again: the atlas is Babylon's);
  work no frame recorded stayed queued across an `update` that returned
  early, and a later frame could draw it, mid-refill, into tiles just given
  back — unread, every tile being cleared before it is published, but
  wrong (it is dropped with the tiles now); `shadowWindow.ts`'s header
  never named the two textures it makes; a comment that a shadow cull uses
  no reach, which a lamp face's does; a guard in `LocalShadows.handOver`
  that could not fail; `LocalShadows`' header saying the proxy mesh is
  kept only on Babylon's side; a line of `docs/rendering.md` naming the
  atlas and the world's maps among Babylon's group-0 passes, stale since
  X3.6a; and CLAUDE.md's rule for a new world caster,
  which now says blended or not, since `PASS_LAMPS` makes a blended
  caster the handover cannot hold cost the world's maps too. Kept as they
  are: the atlas-sized depth attachment cleared by every pass (a copy
  cannot write `depth32float`, and Babylon's clear sheet reset it a tile a
  pass), and the prepare hooked for the atlas's life (one early return a
  frame, where `WorldShadows` hooks while its casters are built).
  Re-checked after the fixes: the readback on Harrowmead and Hollowmere,
  every count as before them; the paths above on Hollowmere and
  Coldharbour, 14 of 14 each, no page or console error. A failed proxies'
  pipeline was not forced.
- **Owed onward.**
  - The atlas's passes are not timed on our side (not in `gpu.cull`, and
    `shadowPass` brackets only Babylon's generators); the phone's FOLLOW-UP
    reading, the user's to take as every step's since X3.3c, is read as
    `gpu.frame` against X3.6a's.
  - Dynamic tiles with BODIES in them were not compared texel for texel (the
    `low` rung's comparison has the collider boxes only); the bodies go
    through the same instanced draw, their boxes `LocalShadows`'.
  - What X4.1 leaves to do for the atlas is where a body's boxes come from:
    the draw is ours already.

**X3.6c landed** (9a3cdbb, the post-commit review's fixes after it;
2026-10-24).
- **What it is.** Each probe's cube is a texture our renderer OWNS
  (`render/ProbeBake.ts`: `rgba8unorm`, six layers, a full mip chain, pooled
  for the process as Babylon's probes are) and draws whenever the handover
  holds every surface the bake draws; Babylon's glazing and water sample a
  wrapped cube view (`wrapCubeTexture`, `core/wrappedTextures.ts`, its sampler
  derived from `INVCUBIC_MODE` as the probe cube's was). `ReflectionSystem`
  still decides everything — the probes, where each stands, its box, what it
  leaves out, the queue, the gate, `bakePending` — and picks the path per
  install (`path`); Babylon's `ReflectionProbe`s are the fallback for the
  editor (which bakes nothing), `?babylonworld`, a map with a bake surface
  our side cannot draw, and a LOSS before the bake drained, which re-queues
  the install on Babylon's side and re-points every reader (the water through
  a `rebind` callback).
- **The eye is PASSED, not borrowed.** The bake has a frame of its own (a
  second `FrameUniformBuffer`, its group 0 over the frame's textures), filled
  by `CelMaterialFactory.fillBakeFrame` — the frame's values seen from the
  probe, `opaqueAlpha` 1, the clouds' shadow held off — and each face's
  camera (view-projection, eye, alpha: the block's first 80 bytes) reaches it
  through a staging slot copied in the encoder ahead of its pass. On our path
  `ReflectionSystem` moves no material's eye and flips no alpha, so the class
  of bug 242b986 and a858c74 fixed (a `ReflectionProbe` never moving
  `scene.activeCamera`) has no surface left to land on. A face is Babylon's
  face: `ReflectionProbe`'s six looks, `LookAtLH` and a 90-degree
  `PerspectiveFovLH` over the camera's near and far in the half-z range
  (both added to `src/math`, `math-check` cases beside them).
- **A face is a third VIEW of the main pass's culls**, built when a bake is
  queued and destroyed when it drains, so a round holds none: a slot a face
  (`probesPerFrame` 8 probes a submit), the pass bit `PASS_PROBE` (every
  taken surface and scatter part, and the emissive palette), and two tests
  the probe view alone turns on in the uniform's word 9 — the reach to the
  near side of a cluster's SURFACE sphere, Babylon's `neighbourhood` test on
  the same mesh, and its own blocks left out, `encloses` asked as numbers (a
  cluster's block, a scatter placement's REGION block as `BlockMerge` filed
  its copy, the cell at `perCell` and a bit a served block). It draws through
  the main pass's own draw code (`WorldBlocks`' `DrawView`), in the order the
  groups were added — floor before roads: at a grazing far horizon the road's
  bias no longer separates them, and Babylon's bake drew the floor first
  (Sarab, 14 texels before the order was kept). It records LATE in the
  prepare (`Renderer.onFrame`'s `late`), after the world's shadow maps and the
  lamps' atlas, and only when every group it draws is drawable.
- **What Babylon's bake drew that ours had not.** The emissive palette, held
  for the bake with its slots (`WorldBlocks.addEmissive`, a group a material,
  cut last, drawn in no main pass) and drawn by `render/emissiveWorld.ts`
  over the one body both sides now include (`shaders/wgsl/emissiveWorld.ts`);
  its palette and fog reach our side as data (`emissiveRecipe`). Fire is left
  out (`FINDINGS.md` 51: Babylon's bake drew a distant fire as a dark texel
  and a near one not at all). Mips are ours (`render/cubeMips.ts`, Babylon's
  `generateCubeMipmaps` filter for filter). Every shipped map holds the whole
  bake: taken / palette / fires left out / other —
  Hollowmere 95 / 29 / 11 / 0 (2 water probes), Greyfen 385 / 10 / 3 / 0 (1),
  Coldharbour 172 / 46 / 2 / 0 (39), Harrowmead 120 / 4 / 2 / 0 (1), Sarab
  303 / 7 / 2 / 0 (28), Cinderhaven 323 / 53 / 15 / 0 (14), Kurenai
  251 / 4 / 0 / 0 (3).
- **Measured.**
  - **The cubes, against Babylon's** (a scratch readback, both bakes of the
    same probes in one page under the freeze, every face and level; Babylon
    against itself 0 texels on every map). The landform alone and the palette
    alone are 0 texels on all seven maps. What differs is the SCATTER — every
    differing texel on or within a texel of where ours draws it, but ~15
    single texels on three maps, near scatter or fog-coloured at the
    horizon — X3.4's difference (instances under their own matrices, one
    colour bake a kind) seen from a probe, plus 6 texels of distant fire
    (3 Sarab, 3 Cinderhaven): mip 0 differs at 0.02% of texels (Cinderhaven)
    to 2.5% (Greyfen, mostly 1-2/255) and 2.2% (Kurenai, at most 22/255);
    Harrowmead 768 texels, Hollowmere 416, Coldharbour 3,885, Sarab 18,417
    (a palm's fronds over a probe; one-texel coverage edges give the 255s).
    Coverage (alpha) identical but a few edge texels; the mips carry mip 0's
    differences down and shrink them.
  - **The probe-eye check** (242b986's harness, made again): a Coldharbour
    glazing probe baked with the camera at the probe and 600 m off it reads
    back IDENTICAL on our path, 0 of 131,070 texels over every face and level,
    the frame's eye confirmed moved.
  - **The bank, against a BEFORE kept at aef7328 in a worktree** (`--check
    --keep` both sides): 34 of 61 byte-identical, 50 within the floor. The 11
    over it are Harrowmead's `millpond` and the ten sight shots over the same
    water (2.3-5.0% of pixels, mean 0.04-0.07/255, at most 76): the pond's
    reflection of the trees, the cube's scatter difference bent by the chop,
    and nothing above the waterline. The rest — Greyfen's `marsh` (0.64%),
    Coldharbour's three curtain walls (under 0.1%), Sarab's `ground` and
    `shelf` — are within it. No console or page error.
  - **`census.mjs --against`** the BEFORE: equal on all seven maps (384,
    226, 829, 891, 673, 228, 134). **`shaders.mjs`**: clean on seven, ours
    15/15 and 19/19. **`gate.mjs`**: clean on seven, the probe counts as
    `gate.json`'s.
  - **The bake's cost.** A frame of 8 probes is 5-6 ms from the frame's start
    to its queue's work done on the desktop, against 1-3 idle: Coldharbour's
    39 probes drain in 5 frames, ~41 ms of wall time, where Babylon's bake
    spent one ~2.3 s frame on them; Cinderhaven's 14 in 2 frames, ~17 ms.
  - **X0.3 on the desktop** (`bench.mjs`'s run, `--max --gpu`, uncapped,
    3440x1440, one run an invocation, alternated BEFORE and AFTER run by run, three a side, the
    BEFORE in the worktree at aef7328; the canonical fight hashes on all 18
    runs, one BEFORE run lost to `FINDINGS.md` 64's hang and retried): the
    mean frame new / old 0.999-1.001 on the vantages, 0.999-1.000 on the path
    and 1.002-1.004 in the fights; `gpu.frame` 0.975-1.028; the draw counts
    equal. The bench's INSTALL rose (Greyfen 10.4 to 13.4 s, Harrowmead 12.4 to
    13.4, Sarab 11.8 to 12.2, medians), and a timeline of the install, both
    trees in one browser and alternated, three runs a side, did not
    reproduce it — 8.8 to 8.7 s, 11.0 to 9.4 and 10.3 to 8.8 (Babylon's 43,254
    bake draws in one of Sarab's frames are gone; the warm-up compiles one
    pipeline more, ours) — so it is the bench starting a cold dev server and
    browser for every run, not the bake: in every run the queue waited on
    `gi.converged` alone. That wait found `FINDINGS.md` 65, older than this
    step.
  - **The paths no instrument covers**, forced in a scratch page on
    Coldharbour (glazing and water) and Hollowmere (water): the install, a
    shadow rung `low` mid-bake and back, a forced loss mid-bake (Babylon's,
    the readers re-pointed), a second round (ours again), a loss after the
    bake drained and a `rebake` (Babylon's), a third round, the editor (`F2`,
    nothing baked) and `?babylonworld` (Babylon's, the probe counts as
    before). No page or console error. X3.6a's shadow readback on
    Coldharbour, Greyfen and Hollowmere matches its record exactly. These ran
    before the draw-order fix, which moves the order inside the probe view
    and nothing else.
- **What the post-commit review found** (two independent readers over
  9a3cdbb, one for correctness and one for shape and contracts; fixed after
  it). No defect on the shipped path. Four on the edges: a mips pipeline
  that failed at construction left the bake on our path with no fallback,
  every install waiting out the card on cubes never baked (`ProbeBake` now
  latches broken for the session and every map's bake is Babylon's); a loss
  in the one frame between the last probe recorded and the view closing
  threw a finished bake away and re-queued it on Babylon's side (a loss now
  re-queues only what is still queued or was dropped unrecorded); past 32
  blocks a cell the CPU and the cull disagreed on what a probe leaves out
  (both now leave out the whole cell, which nothing in the tree reaches);
  and the probe view's memory, unmeasured until then — 9.0 MiB on
  Hollowmere, 9.6 Sarab, 12.1 Greyfen and Harrowmead, 15.3 Coldharbour, 16.6
  Kurenai, 27.6 Cinderhaven, nearly all of it the view's own index buffer,
  X3.6a's shadow view's order, and held only while a bake drains. On the
  shape: `FILES.md` not rewritten for six modules whose contracts moved
  (rule 7); CLAUDE.md's rendering section grown past its cap (cut back by
  moving rules only a renderer author can break to `docs/rendering.md`);
  the bake's frame filled once a probe and its shadows twice (once a
  recorded frame now); Babylon's render lists built on our path for a DEV
  log; the block key parsed in three places and computed in a fourth (one
  parse beside `blockKey`; `blockOf` and `blockCell` from `merge.ts`); the
  two paths sharing one queue of nullable entries (ours has its own
  `ProbeJob` queue); the cube pool indexed twice (`ProbeCube`); the
  per-frame budget read in two places; `probeCount` kept by hand; the bind
  groups assembled three ways in `WorldBlocks` (`groupsFor`); stale names
  (the "casters" layer is "held"); the wrappers moved to
  `core/wrappedTextures.ts`; the cubes made `COPY_SRC`, so a readback needs
  no patch. Re-checked after the fixes: the cube readback on Coldharbour,
  Harrowmead and Sarab equal to its numbers above, the probe-eye check, the
  paths on Coldharbour and Hollowmere, both edge cases forced in a page,
  and after them the bank on seven maps byte-identical to 9a3cdbb's frames
  (61 of 61), the gate clean on seven, `merge:hash` identical to the
  parent's and parity passing. A third reader over the fixes found the
  "added after the map was cut" guard narrowed to the add that makes a
  group (now asked of every add again) and three stale lines.
- **Owed onward.**
  - The fire, when it moves (X4.4), owes the bake a program, and
    `FINDINGS.md` 51's near case is still open.
  - `shaders.mjs` builds neither the palette's program nor the mips'; the
    gate and the bank compiled both on every map.
  - The phone's FOLLOW-UP reading, the user's to take as every step's since
    X3.3c: the bake is under the loading card, so it is read as the card's
    length, not the frame.

**X3.6d landed** (6dc5122, the post-commit review's fixes after it;
2026-10-24).
- **What it is.** The emissive palette's share of the glow's MASK is drawn by
  OUR renderer (`render/WorldGlow.ts`) whenever the handover holds the WHOLE
  palette, and `GlowPass` leaves those meshes out of its list on the frames
  ours means to draw them (`GlowRules.drawnElsewhere`). **The mask does not
  move** (rule 5, the X3.6 intro's one exception): the bodies, the effects,
  the fire's twin, the viewmodel and the moon still draw into it and its blur
  and the ink read it, so ours draws INTO Babylon's pass, as it draws into the
  main pass, and nothing is wrapped or copied. The palette's MAIN-pass draw
  stays Babylon's (moved at X3.6e): moving it changes which side wins an
  equal-depth tie with a coplanar wall, a picture change owed its own commit
  ("Decisions that are yours"). Every shipped map holds the whole palette: one
  draw a palette BIAS, two on Coldharbour (6,864 triangles at the over-glass
  bias and 11,292 plain, 10 and 36 surfaces) and one elsewhere (Hollowmere
  22,378 triangles over 29 surfaces, Cinderhaven 10,020 over 53).
- **Where: FIRST in the mask's pass, right after its clear.** `GlowPass`
  announces the pass from inside its own clear observer
  (`onMaskOpenObservable`, wired to `Renderer.glowMaskOpened` by `Game`, so
  `GlowPass` imports nothing of `src/render/`): WebGPU's `clear()` begins the
  mask's pass at once, after Babylon built the list and before it queued any
  of it, every frame. A rendering group's hook was refused (an empty group is
  never visited, and the mask's group 0 often is once the palette is ours),
  the target's after-render too (it lands after the blended mask draws), and
  a second clear observer (an order race). No new seam item: `FrameHost.queue`
  and `passIs` against `GLOW_TARGETS` (`render/targets.ts`). With no depth
  written, first is also Babylon's order, the palette having drawn in its
  opaque queue.
- **The tie is across the two renderers**, and holds by construction: the same
  vertex body both sides include (`EMISSIVE_WORLD_VERTEX`), `world` identity
  on both, the same float32 view-projection, the same flip, the same depth
  bias; LEQUAL against the depth Babylon's palette wrote in the main pass.
- **Culled through the MAIN view**, no view of its own
  (`WorldBlocks.glowView`): the held groups are cut palette first and casters
  last, the main view's count runs through the palette, the main pass (which
  has no recipe for them) never draws them, and a palette cluster is never
  SIZE-GATED (`PASS_GLOW`, mirrored in the CPU replay and `cullProbe`), as
  Babylon never gated an emissive. No reach (`NO_REACH`, as every held
  surface, where Babylon's twin is reach-culled as a block): past that reach
  the mask's pixel is the clear's own. (Harmless in the mask still; X3.6e
  gives every palette surface its cell's box, which the MAIN pass needs,
  past the reach being the sky there.) Its memory is the main view's
  per-cluster scratch for the palette's clusters, a few KB — counted at EVERY
  cut, even on a map whose palette mask goes back to `GlowPass`, where they
  are scanned and never drawn; kept, as the price of one cut whatever the
  handover decides.
- **The program** is the twin's in the pulled form (`emissiveWorld(GLOW_TARGETS,
  true)`, the one body under `GLOW_MASK`), `glowColor` appended LAST to the
  palette's block so the bake's program reads a prefix and one bind group
  serves both. The rules stay `Game`'s, each stated once (`glowAdmits`,
  `bloomColour`) and PULLED once a frame; a colour is written only when it
  moved.
- **Who decides.** `BlockHandover` per install (a palette surface it cannot
  hold, or one marked `noGlow` — read at the take — leaves the map's whole
  palette mask to `GlowPass`); `WorldGlow` per frame, in a renderer prepare as
  the main pass begins (held, built, admitted, drawable), before `GlowPass`
  builds its list. A palette surface handed back, a refused main pass or a
  refused MASK pass LOSE it (the draw and the prepare off the renderer after
  the task in hand); a failed mask pipeline latches it broken for the
  session; the editor and `?babylonworld` take nothing. Two costs, both off
  the shipped path: the one frame a refused mask pass is found has the
  palette in neither side's draw (Babylon built the list before the clear
  that announces the pass), and a loss mid-map compiles Babylon's twin in
  the round.
- **Measured.**
  - **The mask itself, ours against Babylon's** (a scratch readback of the
    mask texture at every bank row, 61 rows on seven maps: ours, ours again,
    Babylon's after `lose()`, ours after taking it back): **0 texels on every
    row**, and 0 ours against ours. Thirteen rows hold no lit texel at all
    (eight of Sarab's eleven, Greyfen's `treeline` and `canopy`,
    Harrowmead's `borderland` and `ground`, Coldharbour's `shopfront`), so
    the proof is the other 48.
  - **Babylon's mask draws, a row's mean** (ours drawing / after `lose()`):
    Coldharbour 0.44 / 19.67, Cinderhaven 3.00 / 14.50, Hollowmere 2.69 /
    11.85, Harrowmead 2.47 / 6.13, Greyfen 0.83 / 4.00, Kurenai 0.33 / 2.33,
    Sarab 0.36 / 1.73 — no palette mesh left in Babylon's list while ours
    draws (`FINDINGS.md` 43).
  - **The bank, against a BEFORE kept at 5752574 in a worktree**
    (`--check --keep` both sides): **61 of 61 byte-identical**. No console or
    page error.
  - **`census.mjs --against`** the BEFORE: equal on all seven maps (384,
    226, 829, 891, 673, 228, 134). **`shaders.mjs`**: clean on seven, ours
    15/15 and 19/19 (it builds neither palette program, as before).
    **`gate.mjs`**: clean on seven.
  - **The held-group reorder moved no shadow**: the world's four maps read
    back through a compute `textureLoad` (they are not `COPY_SRC`) at the
    menu vantage, BEFORE against AFTER, are byte-identical on Greyfen and
    Coldharbour.
  - **The paths no instrument covers**, forced in a scratch page on
    Coldharbour and Hollowmere (the night map): deploy and a round (ours);
    the kit screen (neither side; ours again on leaving it); the Glow rung
    `low` and back, a resize to 1280x720 and back, render scale 0.5 and back
    (ours throughout); a forced `lose()` (Babylon's: 46 and 5 palette meshes
    in its list), a second round (ours); a forced main-pass refusal (both
    handed back), a third round (ours); the editor (nothing held) and
    leaving it (ours); `?babylonworld` (Babylon's). No page error; the only
    console errors are the refusal's own two diagnostics. `?cullcheck` on
    Coldharbour in a round: 0 disagreements.
  - **X0.3 on the desktop** (`bench.mjs`'s run, `--max --gpu`, uncapped,
    3440x1440, BEFORE in the worktree and AFTER alternated run by run, three a
    side, on Coldharbour, Cinderhaven and Hollowmere, where the palette is
    largest; the canonical fight hashes on all 18 runs, no hang): the mean
    frame new / old 0.997-1.000 on the vantages, 0.979-1.001 on the path
    (Cinderhaven's 0.979 inside the BEFORE's own spread) and 0.996-1.012 in
    the fights; `gpu.frame` 0.950-1.026 over 14-37 samples a look group.
    Babylon's draw counter fell in every group: Coldharbour 112 to 95 on the
    vantages, 79 to 68 on the path, 302 to 283 in the fight; Cinderhaven 108
    to 92, 97 to 84, 371 to 340; Hollowmere 48 to 40, 43 to 37, 245 to 233.
    The bench's install rose ~2 s on every map, and is the main tree's cold
    dev server again (X3.6c's reading): `installRound` timed in both trees is
    level (Hollowmere 4.95-5.4 s against 4.93-5.7, Coldharbour 6.3-6.4 against
    6.4-6.5; the warm-up waits ~40 ms more on Coldharbour for two more
    pipelines and compiles nothing in play), and a second run in one
    invocation reads 5.13 against 5.26 s.
  - These ran before the review's fixes below, which change comments, a
    prepare's signature and a `ready` that answered false for a disposed
    view; typecheck, build and corecheck were run again after them, and
    the mask readback on Coldharbour and Hollowmere (six rows, 0 texels).
- **What the review found** (an independent reader before the commit; fixed
  before it). No defect on the shipped path. CLAUDE.md's cut had taken the
  emissive palette's hardcoded coverage of 1 out of the spine while leaving
  "a shader that hardcodes either value breaks one of the two passes" — the
  exception is back as a clause. The contracts over-claimed "exactly the
  frames": a refused mask pass is found after Babylon's list was built
  (softened in `WorldGlow`, `GlowPass` and `docs/rendering.md`). The twin's
  compile after a mid-map loss was undocumented. A view's `ready` answered
  false for a DISPOSED view, which `WorldGlow` reads as a failed pipeline and
  latches broken for the session — safe while every dispose follows a
  generation bump, but a guard the generation already is (now a pipeline
  question alone, in `glowView` and `probeView` both). `Renderer.context` had
  been made public for one prepare (a prepare is handed the `FrameContext`
  now). The `noGlow` bullet named every block-merged emissive where only the
  palette's is read at the take; `VERIFYING.md`'s re-take only holds on a map
  that held the whole palette. Kept: `WorldGlow`'s lifecycle has
  `ProbeBake`'s shape (a generation, `broken`, the loss after the task) — a
  second copy of a small shape rather than a base class for two.
- **What the post-commit review found** (two independent readers over
  6dc5122, one for correctness and one for shape and contracts; fixed after
  it). No defect on the shipped path; both traced the frame's order
  (the verdict, `GlowPass`'s list, the clear, the queued draw) through
  Babylon 9.28 and found it as documented. Latent: the colour write built an
  object a call, so a bloom that ever animates would allocate a frame (one
  values object a view now); the DEV `noGlow` check read the meshes held for
  the mask after a loss had handed them back (it now asks whether the world
  is still held); the mask is opened once a frame and a second open would
  queue nothing of ours (stated on `maskFilled`). On the shape: the
  palette's pipelines by bias were built by the same 25 lines in `probeView`
  and `glowView` (one `palettePipelines` now, which a third palette pass
  would otherwise have made three); `drawnElsewhere` asked the material too,
  which the handover's answer already covers (it takes the mesh alone, and
  `glows` is `glowHolds`, beside `probeHolds`); `drawHeld` and `drawableIn`
  tested a group's passes two ways (one `drawsIn`); contract text the step
  or its pre-commit fixes left false (a prepare reading `Renderer.context`,
  "exactly the frames" in one more place, `addEmissive` cut "after every
  other group", the pass-bit list without `PASS_GLOW`, the refusal listener
  missing from `WorldGlow`'s owns, "`GlowRules`' two questions", the failed
  mask pipeline missing from four fallback lists, the `noGlow` bullet's
  unsatisfiable "set before the build", and `VERIFYING.md`'s re-take, which
  draws nothing twice); CLAUDE.md's coverage clause got its "do not fix it"
  back and its glow clause stopped reading as a contradiction, the rendering
  section still 133 lines. One reader held that the palette's clusters are
  reach-culled by their block; they were not — every held surface was given
  `NO_REACH` at the install and filed in no cell — so "no reach" stood,
  argued more fully (since X3.6e every palette surface is cut with its cell's
  box and reach-culled by it). Kept: the main view counts the palette's
  clusters at every cut, even on a map whose palette mask goes back to
  `GlowPass` (a few KB, scanned and never drawn). Re-checked after the fixes:
  the mask readback on seven maps (61 rows, 0 texels ours against Babylon's),
  the bank 61 of 61 byte-identical to 6dc5122's frames, the gate clean on
  seven, the paths on Coldharbour and Hollowmere as before, typecheck, build
  and corecheck.
- **Owed onward.**
  - The palette's main pass: X3.6e (landed, below). Deleting the fallbacks
    ("After X3.6", "Decisions that are yours").
  - The phone's FOLLOW-UP reading, the user's to take as every step's since
    X3.3c, which is also the tie's check on a second GPU: a driver that
    rounds the shared vertex body differently would drop palette bloom
    wherever ours lands behind Babylon's depth. `FINDINGS.md` 43's phone
    reading is the same capture.
  - `shaders.mjs` builds neither palette program (X3.6c's item, still open).

**X3.6e landed** (806511f, the post-commit review's fixes after it;
2026-10-24; added after X3.6d by the user's decision of the same day,
"Decisions that are yours").
- **What it is.** The emissive palette's MAIN-pass draw is OUR renderer's
  whenever the handover holds the WHOLE palette — the same decision that
  hands X3.6d's mask over, so the palette is ours in both passes or in
  neither. The palette held since X3.6c is TAKEN from Babylon's main pass as a
  block (`WorldCulling.setTaken`), so no palette mesh is a candidate, ACTIVE,
  or in `GlowPass`'s list while ours holds it; Babylon's
  `EmissiveWorldMaterial` and its mask twin are both the fallback. Deleting
  Babylon's fallback meshes is not part of it.
- **Where: FIRST in `WorldBlocks`' one `"beforeAlphaTest"` draw** — the
  palette, the blocks, the scatter, the landform — so every equal-depth tie
  with a surface of ours goes as Babylon's opaque queue, which drew the
  palette ahead of all of ours, sent it. The argument, the tie table and the
  two residues are `docs/rendering.md`'s ("The palette, ours: the mask
  (X3.6d) and the main pass (X3.6e)").
- **The reach: the cell's box, not `NO_REACH`**, because in the main pass
  past the reach is the SKY: every palette surface is cut with its cell's box
  whoever draws it (`WorldCulling.reachBoxOf` answers a filed mesh, taken or
  not), the box Babylon's candidate was offered by; every other view reads it
  to the same picture (the same section).
- **The program** is the bake's, unchanged — `emissiveWorld(FRAME_TARGETS)`,
  one pipeline a bias, asked once at the cut (`WorldBlocks.mainPalette`) and
  shared with `probeView` — so the mask's tie is ours against ours, which
  closes X3.6d's driver-rounding risk for the palette (the same section).
- **One decision, and every loss returns both.** `BlockHandover` decides once,
  after the cut (`claimPalette`); every loss of the mask hands the main pass
  back with it (`WorldGlow.onLost`, `dropPalette`), and a failed main-pass
  palette pipeline is a loss of both that hands no surface back, so the
  shadows stay ours (the same section). A loss mid-map compiles Babylon's
  palette material and its twin in the round, the warm-up never having drawn
  them: one frame's hitch, no frame without its lit windows (measured below).
  The editor and `?babylonworld` take nothing.
- **What became dead, and was deleted.** `GlowRules.drawnElsewhere` and the
  handover's `glowHolds` (X3.6d's way of keeping `GlowPass` off the palette on
  the frames ours drew it) answered false on every path once the palette
  left the candidate list; both are gone, with `GlowPass`'s skip. The DEV
  `noGlow`-after-the-take check stays. `WorldBlocks`' HELD layer split into
  `"palette"` and `"held"` (the casters alone), `drawHeld` became
  `drawPalette`, and `BlockHandover`'s `held` set split the same way —
  `probeHolds` counts the palette through its own set.
  `BlockHandover.takePalette()` re-takes both passes for a scratch script
  (the game never calls it).
- **Deviations from the design**, all in shape: `takePalette` is public (a
  private method nothing calls fails `noUnusedLocals`); `palettePipelines`
  takes a failure callback rather than a message, so the main ask can tell
  the handover (`WorldBlocks.onPaletteFailed`); the main palette pipelines
  are asked at the cut even on a map whose main pass stays Babylon's (a
  probe's face shares them); a palette surface's failure re-files the cull
  twice (once through `onLost`), which is harmless; every palette surface is
  cut with its cell's box whoever draws it, so `takePalette` can re-take it
  after any loss that handed nothing back. `shaders.mjs` still builds neither
  palette program (X3.6c's item).
- **Measured.**
  - **The bank, against a BEFORE kept at c34a06b in a worktree**
    (`--check --keep` both sides): **59 of 61 byte-identical**, no console or
    page error. The two that move, both deterministic (a re-shoot is
    byte-identical to the first): Hollowmere's `ground`, 56 pixels (0.0027%),
    mean 0.0001/255, max 16/255, in two specks at (1485-1492, 510-513) and
    (1515-1522, 528-532); Greyfen's `marsh`, 29 pixels (0.0014%), mean
    0.0001/255, max 22/255, at (1112-1116, 517-526). **Neither is a tie: it is
    the reach's HYSTERESIS.** A candidate cell switches on at the reach and
    off only `culling.hysteresis` (12 m) past it, and at those two rows
    Babylon's list still held one palette mesh from the rows before, 7.33 m
    and 6.09 m past the reach — drawn as a fog-dark window with no wall round
    it, the wall being a taken block our exact per-frame reach had already
    dropped. Ours drops window and wall together. Invisible at crop scale
    (crops in the step's scratch record).
  - **The in-page A/B** (one boot a map, every bank row: ours, a control,
    Babylon's for both passes after `worldGlow.lose()`, ours again through
    `takePalette()`): the MASK 0 texels on all 61 rows, ours against
    Babylon's and ours against ours; the FRAME 0 pixels on 59, and on the
    same two rows the same 56 and 29 pixels, attributed by the past-reach
    count (Hollowmere's `wall40` holds three such meshes, 4.4 m past, and
    moves nothing). The control 0 everywhere. No palette mesh in Babylon's
    active list while ours holds the palette, and its N after the loss
    (Coldharbour's `avenue` 37); ours drew one draw a row more than after the
    loss (two on Coldharbour).
  - **Past the fog, against the sky**: three borderland poses on Coldharbour
    up to ~700 m out (`fogEnd` 480) and two on Hollowmere (78), the same A/B.
    The mask 0 on all five; the frame 0 on three, and 37 pixels (max 10/255)
    and 345 (max 6/255) on the other two — Babylon's fogged specks from
    palette meshes 11.28 m and 4.12 m past the reach, ours plain sky. Ours
    drew no lit window past the reach anywhere.
  - **`census.mjs --against` the BEFORE `--fall`**: every map lower, each
    exactly the design's prediction — Babylon's main pass loses every palette
    mesh it drew, ours gains one draw a bias a row:

    | map | rows | before | after |
    | --- | --- | --- | --- |
    | Hollowmere | 13 | 384 | 278 |
    | Greyfen | 6 | 226 | 213 |
    | Coldharbour | 9 | 829 | 674 |
    | Harrowmead | 15 | 891 | 851 |
    | Sarab | 11 | 673 | 669 |
    | Cinderhaven | 4 | 228 | 186 |
    | Kurenai | 3 | 134 | 131 |

    A row with no palette in view rises by one (two on Coldharbour), most of
    Sarab's. The "taken" column rises by the palette's surfaces: Hollowmere
    +29, Greyfen +10, Coldharbour +46, Harrowmead +4, Sarab +7, Cinderhaven
    +53, Kurenai +4.
  - **`gate.mjs`**: clean on seven (its warm fps read 60 on every map this
    session, the display's vsync, where X3.6d's read ~125; the uncapped
    bench is unaffected). **`shaders.mjs`**: clean on seven, ours 15/15 and
    19/19; Babylon's modules two fewer on five maps (Hollowmere 126 to 124,
    Greyfen 129 to 127, Coldharbour 139 to 137, Sarab and Cinderhaven 142 to
    140), the palette's material no longer compiled on our path; Harrowmead
    and Kurenai unchanged.
  - **The paths no instrument covers**, forced in a scratch page on
    Coldharbour and Hollowmere: deploy and a round (ours: 2 and 1 palette
    draws in the main pass and as many in the mask, no palette mesh in
    Babylon's list); the kit screen (the main pass still ours, the mask
    drawn by neither); the Glow rung `low` and back, the shadow rung `low`
    and back, a resize to 1280x720 and back, render scale 0.5 and back (ours
    throughout); a forced `worldGlow.lose()` (both passes Babylon's together:
    46 and 5 palette meshes in its list; `stats` read taken 218 to 172 and
    124 to 95 then, 218 and 124 with 46 and 29 handed back since the
    review's fix below); a
    forced mask refusal (both back together); a forced main-pass refusal
    (everything back); a round after each (ours); the editor (nothing taken)
    and leaving it (ours); `?babylonworld` (Babylon's in both passes). No
    page error; the only console errors are each forced refusal's own.
    `?cullcheck` on Coldharbour, eight headings: 0 disagreements.
  - **What a loss costs, stepped a frame at a time** at a frozen vantage
    (Coldharbour `avenue`, Hollowmere `menu`): the three frames after a
    forced loss are byte-identical to the frame before it on both maps,
    where hiding the palette for one frame moves 303,138 and 105,062 pixels
    — Babylon's palette is drawn from the first frame, its material and twin
    compiled inside it (2 shader modules and 4 pipelines on Coldharbour, 2
    on Hollowmere): 7.8 ms of CPU against 3.9 steady on Coldharbour, 3.8
    against 1.6 on Hollowmere. The plan had expected frames with no lit
    windows; there are none.
  - **X0.3 on the desktop** (`bench.mjs`'s run, `--max --gpu`, uncapped,
    3440x1440, the BEFORE at c34a06b in the worktree and the AFTER
    alternated run by run, three a side, on Coldharbour, Cinderhaven and
    Hollowmere; the canonical fight hashes on all 18 runs, no hang): the
    mean frame new / old 0.997-1.004 on the vantages, 1.001 on the path and
    0.964-1.000 in the fights (Cinderhaven's 0.964 a CPU-bound segment whose
    BEFORE runs were noisy, `gpu.frame` equal); `gpu.frame` 0.988-1.013.
    Babylon's draw counter fell in every group and ours rose by the
    palette's one or two: Coldharbour 95 to 78 on the vantages, 68 to 56 on
    the path, 281 to 261 in the fight (ours 19 to 21); Cinderhaven 92 to 75,
    84 to 70, 339 to 308 (11 to 12); Hollowmere 40 to 32, 37 to 32, 233 to
    223 (8 to 9). The bench's install rose 1.5-2.2 s and is again the main
    tree's cold dev server: the in-page install, timed alternately, is level
    (Hollowmere 5.19 and 4.95 s against 5.12 and 4.95, Coldharbour 6.09 and
    6.02 against 6.19 and 6.14), the warm-up compiling the same pipelines on
    both sides.
- **What the post-commit review found** (two independent readers over
  806511f, one for correctness and one for shape and contracts; fixed after
  it). No defect on the shipped path; both found the two passes always on
  one side. Latent: the main palette pipeline was asked at every cut,
  whoever drew the palette, and its failure FAILED the palette's groups —
  handing the map's shadow maps and the lamps' atlas back to Babylon over a
  pipeline nothing might have drawn with, on every map. A failure now fails
  no group: it latches for the map, LOSES the palette (both passes, through
  the mask's loss) when it was ours, refuses a later take, and costs the
  bake through the probe view's `ready` — the shadows and the atlas, drawing
  the palette with their own depth pipelines, stay ours (forced on
  Coldharbour and Hollowmere with the palette ours and not). `stats` stopped
  counting the palette after a loss (it counts against "taken this install"
  now). On the shape: the decision was made twice, provisionally before the
  cut and again after it, only because `WorldCulling.reachBoxOf` answered a
  TAKEN mesh — it answers any mesh filed in a cell now, every palette
  surface is cut with its cell's box, and the decision is made once
  (`paletteBoxed` and `WorldGlow.usable` deleted); `takePalette` restated
  the end of `install` (one `claimPalette`); `heldGroup` made palette groups
  (`paletteGroup`, `casterGroup`); `hold` and `onSurface` tested palette
  against caster twice; four headers still described X3.6d's world (a mask
  tied against Babylon's depth, `GlowPass` skipping the palette, the fallback
  compiling in the round on every path rather than after a loss alone); "the
  palette is in no Babylon list" stated ten times (once now, and pointers);
  and this note and `docs/rendering.md` arguing the same points twice (the
  note cut to pointers, the hysteresis argued once). Re-checked after the
  fixes: the bank 61 of 61 byte-identical to 806511f's frames, the in-page
  A/B on seven maps as above, the census equal to 806511f's, the gate clean
  on seven, the paths on Coldharbour and Hollowmere as before, typecheck,
  build and corecheck.
- **Owed onward.**
  - Deleting the fallbacks ("After X3.6", "Decisions that are yours").
  - The phone's FOLLOW-UP reading, the user's to take as every step's since
    X3.3c (`FINDINGS.md` 43's capture is the same one).
  - `shaders.mjs` builds neither palette program (X3.6c's item, still open),
    and every map's main pass now depends on one of them. Closed at X3.7a.

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

### X3.7 — Babylon builds no world mesh for a round — **L, as three sub-steps** (decided 2026-10-24)

The fallback each pass of X3.6 hands back to goes. After X3.6 Babylon still
BUILDS a mesh for every surface our renderer draws (the blocks with the
scatter's merged copy in them, the landform, the emissive palette) and keeps
the machinery that would draw them (`ShadowSystem`'s generators,
`LocalShadows`' render target, `ReflectionSystem`'s `ReflectionProbe`s,
`GlowPass`'s palette twin), for an editor build, `?babylonworld`, a surface
ours cannot hold, or a loss mid-map. Every shipped map holds every surface in
every pass, the Intel laptop's flicker is fixed (68b84b3) and the phone's
world reads right (the user, 2026-10-24), so the safety net is now only cost:
the world built twice (Greyfen's scatter copy alone was +120 MB at X3.5b),
install time, and a dozen handback paths. Each sub-step lands on its own and
is checked against its parent.

- **What becomes of a failure** (decided 2026-10-24): **the world draws whole
  or the round does not start.** One `Game.worldFailed(reason)`, run after the
  task in hand as a `lose()` is today: a `console.error`, back to the menu
  (`leaveMatch` online) and a toast that the map could not be drawn —
  `loadHeights`' precedent, there being no honest half-build to fall back to
  and no fallback engine (`CLAUDE.md`). A surface the handover cannot hold
  throws in DEV and `merge:hash` refuses it on seven maps at every foliage
  rung, so it cannot ship; a failed pipeline fails the install under the card;
  a refused pass is a backstop; device loss is unchanged (X5.4).
- **X3.7a — the take off the RECORD (no picture change).** Landed (below).
  - `BlockHandover.onSurface` decides from the surface's record, not its mesh:
    the rendering group and layer mask `worldMeshes`' defaults, identity off
    the part, the blend from the material.
  - `SurfaceRecord.bounds`, taken from the arrays before they are released;
    `WorldCulling`'s cell boxes and spheres read them where they read
    `getBoundingInfo` today (`WorldCulling.ts` 442, 857). A DEV check against
    the mesh's test and its world box, bit for bit, on seven maps.
  - `merge:hash` hashes the record's arrays through a sink before release (a
    new baseline whose per-surface hashes equal the old buffers').
  - `shaders.mjs` builds both palette programs (owed since X3.6c): after X3.7b
    a failed one fails the round.
  - Each map's buffer sizes recorded against WebGPU's default limits (128 and
    256 MiB): with no fallback, a device with less headroom gets the error.
- **X3.7b — the cut.** Landed (below).
  - `worldMeshes` makes no mesh for a surface ours draws; `GameMap.visuals` is
    Babylon's meshes alone (glazing, fires, and an editor build's every
    mesh), and `world.surfaces` stays complete, each saying who draws it.
  - Every handback becomes `worldFailed`: `BlockHandover`'s `back`,
    `handedBack`, `takePalette`, `dropPalette` and its DEV node check;
    `WorldBlocks.fail`/`giveUpAll`; the losses of `WorldShadows`, `LampAtlas`,
    `ProbeBake` and `WorldGlow`; and `WorldCulling.setMap`'s two throws
    (X3.7a's: the visuals and the records out of step, a block-keyed mesh
    with no record), invariants of the build that throw in every build today
    and reach the player as an uncaught error rather than the menu.
  - `?babylonworld` is deleted (decided 2026-10-24); X3.7b's parent is tagged
    `exit-babylonworld` and pushed, the last build that has it, so a device
    A/B against Babylon's world stays one deploy away.
  - `WorldCulling` files cells off the records and drops `setTaken`;
    `reachBoxOf` keys on the block.
  - The casters are held on every shadow rung, so a rung raised from `off`
    draws ours, not the generators until the next map.
  - `noGlow` is read per surface (`heldPasses` already drops `PASS_GLOW` per
    surface): "the whole palette" existed only because `GlowPass` was the
    fallback.
  - **Measured here:** the JS heap after a GC, GPU bytes (`createBuffer` and
    `createTexture` wrapped, as X3.6a did), `installRound` timed in the page
    and alternated (the bench's install reads a cold dev server), and
    `scene.meshes`/`geometries` a map — before and after.
- **X3.7c — Babylon's world passes narrowed.** Landed (below). Deleted for a round: the
  `ReflectionProbe` path (the editor's strength-0 default cube replaced by one
  of ours), `GlowPass`'s palette twin and `EmissiveWorld`'s Babylon stages,
  the `lose`/`onLost`/`broken` latches. `ShadowSystem`'s generators and
  `LocalShadows`' render target stay for the editor's build alone, X5.3's to
  delete. Babylon still draws, in a round: the bodies and `BodyShadows`, the
  hulls, the viewmodel, the effects and fires, the sky, clouds and moon, the
  water, grass, glazing, flags, rings, blobs and particles, and the glow
  mask's non-world emissives.
- **Keeps:** the cel and emissive MATERIAL objects, never compiled in a
  round, which the merge keys on and which hold the recipes (Phase 4); the
  scatter merged into the block ARRAYS, whose spheres, cell boxes and probe
  region key read it (un-merging it moves them, a picture change of its own);
  `metadata.block` on glazing and fires, which stay in `WorldCulling`'s
  blocked class.
- **Verify, each sub-step:** the bank `--check --keep` against a BEFORE at the
  parent (61 of 61 byte-identical expected; where it could move: the cell
  boxes, the take test, candidate order, the default cube); `census
  --against` equal (its `handedBack` 0 from X3.7b); `gate`, `shaders`;
  `merge:hash` against X3.7a's baseline and `--editor` unchanged; `kit:hash`,
  `parity`, `collision`; typecheck, build, corecheck; the forced paths in a
  scratch page (each former loss ends in the error and the menu; a shadow rung
  `off` to `high`; `F2` select, drag, sculpt and save); X0.3 alternated three
  a side, `--max --gpu`, 3440x1440, on Greyfen, Coldharbour and Cinderhaven.
- **Rewrites (rule 7):** `CLAUDE.md`'s rendering section (the four maps' and
  the bake's "back to Babylon" clauses become the refusal, "the SCATTER is
  drawn twice over" becomes once, `WorldCulling`'s taken-mesh rules, the
  glow's palette clause) and its metadata section (`worldMeshes` hands a mesh
  only where one is made, `encloses` goes with Babylon's bake, the `noGlow`
  bullet); `docs/rendering.md`; `docs/game.md` (`installMap`, `teardownMap`,
  `worldFailed`); `docs/editor.md`; `docs/world.md`; `FILES.md`;
  `VERIFYING.md` (the forced-loss, `takePalette` and `?babylonworld`
  recipes); `FINDINGS.md` 61 and 64; "After X3.6" above; the shape table.
- **Risks:** the device A/B leaves the URL (the tag above keeps it); a phone
  with tighter limits gets the error rather than a picture (X3.7a's headroom
  and the phone's reading come before X3.7b lands); the editor's path
  diverges further and the bank cannot see it (`merge:hash --editor`, `F2` by
  hand); `merge:hash` across X3.7b compares only against X3.7a's baseline.
- **Not this step's:** the editor's path (X5.3), glazing (X4.6), fires (X4.4),
  un-merging the scatter from the blocks, the Material objects (Phase 4),
  device-loss recovery (X5.4).

**X3.7a landed** (c52ebb4, the post-commit review's fixes after it;
2026-10-25; no picture change).
- **What it is.** Two readers that asked a world MESH now ask its RECORD,
  so X3.7b can make none. `BlockHandover.onSurface`'s verdict: identity off
  the part's own transform (no parent by then), the blend off the material
  (`blends`: its `transparencyMode` when stated, else `needAlphaBlending` —
  what `needAlphaBlendingForMesh` answers at visibility 1 with no vertex
  alpha, which `worldMeshes` guarantees), and rendering group 0 on the
  default layer mask by construction (`worldMeshes` sets neither); the
  scatter parts' passes go through the same `blends`. `SurfaceRecord.bounds`
  (`boundsOf`, `worldGeometry.ts`): Babylon's `extractMinAndMax`,
  `BoundingBox` and `BoundingSphere` step for step on the arrays before they
  are released, under the part's world matrix (`worldMatrixOf`);
  `WorldCulling` grows its cells from them and size-gates a filed mesh off
  the record's sphere (one `gateOf` entry, no extra lookup a candidate),
  everything else off its own bounding info. The contract is
  `docs/rendering.md` (the handover's bullet, "A cell's bounds", the size
  gate) and the two headers.
- **The DEV checks, until X3.7b.** `WorldCulling.setMap` compares every
  filed surface's box and sphere with its mesh's by `Object.is`
  (`stats.boundsChecked`/`boundsMismatched`, a console error);
  `BlockHandover.checkBirth` compares each mesh's group, mask, parent and
  `needAlphaBlendingForMesh` with the record's verdict (one console error a
  page). `VERIFYING.md` has the reads.
- **`merge:hash` hashes the record's arrays** through a DEV sink
  (`SurfaceSink`, `window.__surfaceSink`, called by `releaseArrays`) — each
  attribute under Babylon's kind name in the type Babylon was handed, so
  the strings are the mesh buffers' own — and every run checks the two
  halves equal wherever a visual has a mesh (`arrays≠buffers` fails it).
- **`shaders.mjs` builds both palette programs** (X3.6c's item, closed):
  `emissiveWorld(FRAME_TARGETS)` at `askPalette`'s state and
  `emissiveWorld(GLOW_TARGETS, true)` at `glowView`'s, at every depth bias a
  palette material on the page carries.
- **Deviations.** The sink is a page global set by the script rather than
  a `BuildOptions` field, so the editor's build (which takes no `onSurface`)
  is hashed by the same door; `releaseArrays` takes the surface's index for
  it. The sphere is read off the record only for a FILED mesh: a loose one,
  the landform and every editor-build mesh keep their own, which an editor
  move or a sculpt rewrites under the record. The DEV `checkBirth` and the
  bounds comparison are transitional and go with the meshes at X3.7b.
- **Measured.**
  - **The bank, against a BEFORE kept at 2293c09 in the worktree**
    (`--check --keep` both sides): **61 of 61 byte-identical**, no console or
    page error; the same 34 stale rows over the bank's tolerance on both
    sides. (A first AFTER run lost its page on Sarab's `tank` row, and a
    first `--editor` hash its Sarab page, both to Vite full reloads while
    this step's files were being edited and the collision bake rewrote
    `collision.ts`; re-run with the tree still, both clean.)
  - **The DEV bounds check on seven maps**: every filed surface equal bit for
    bit — Hollowmere 94, Greyfen 357, Coldharbour 234, Harrowmead 110, Sarab
    202, Cinderhaven 212, Kurenai 174 — and every VISUAL equal on each
    (the landform too); Coldharbour's EDITOR build, 2,154 visuals of which
    2,094 are off identity, all equal, so the transformed path is exact as
    well. The birth check silent on all seven.
  - **`merge:hash`**: identical to the BEFORE's on all eight registry maps,
    shipped and `--editor`; the record's arrays equal to their mesh's
    buffers on **3,828 of 3,828** shipped visuals (1,957 on the seven maps,
    1,871 the proving ground's) and **28,473 of 28,473** editor-build ones.
    The new baseline is `merge-baseline-x37a.json` /
    `merge-baseline-x37a-editor.json` in this step's scratch record, taken
    after the review's fixes with the record's bounds in it (below); X3.7b's
    run takes its own BEFORE at X3.7a.
  - **`census --against` the BEFORE**: every row equal (Hollowmere 278,
    Greyfen 205, Coldharbour 672, Harrowmead 847, Sarab 661, Cinderhaven 186,
    Kurenai 125). **`gate.mjs`** clean on seven. **`shaders.mjs`** clean on
    seven, ours 17/17 (21/21 on Sarab and Cinderhaven, 23/23 on Coldharbour,
    whose palette carries biases 0 and -24) — two more a bias than X3.6e's.
  - **Buffers against WebGPU's DEFAULT limits** (`createBuffer` wrapped from
    boot, foliage `high`, the largest rung; the game asks no raised limits —
    `setMaximumLimits` is off and the device reads 256 MiB / 128 MiB):
    **no shipped map is near either limit.** The largest buffer on every map
    is a world group's storage array, the `CEL_PALETTE` group's colour:
    Cinderhaven 56.0 MiB (44% of the 128 MiB binding limit), Kurenai 30.6,
    Coldharbour 24.9, Greyfen 17.5, Hollowmere 17.2, Harrowmead 13.3, Sarab
    12.7; the next are the same group's positions and normals (Cinderhaven
    42.0) and, on Coldharbour, Harrowmead and Sarab, the main view's source
    indices (14.7 MiB at most). Nothing over 56 MiB is made on any map.
  - **`kit:hash`** identical; **`parity`** passes on eight; **`collision`**
    rewrote nothing (every bake byte-identical); typecheck, build and
    corecheck pass.
  - **X0.3 on the desktop** (`bench.mjs`, `--max --gpu`, uncapped,
    3440x1440, the BEFORE at 2293c09 and the AFTER alternated run by run,
    three a side, on Greyfen, Coldharbour and Cinderhaven; the canonical
    fight hashes on all 18 runs): the mean frame new / old 0.995-1.001 on
    the vantages, 0.998-1.000 on the path and 0.994-0.996 in the fights;
    `gpu.frame` 0.978-1.020; draws equal but Cinderhaven's fight 308 to 309.
    The bench's install on Greyfen, each run's first map, rose ~2 s (9.6 to
    11.8 s) and is the main tree's cold dev server again (X3.6e's reading):
    `installRound` timed in-page, alternately, after a warm boot, is level
    (Greyfen 8.34/8.37 s then 5.88/5.78 against 8.39/8.28 then 5.82/5.81;
    Cinderhaven 8.88/8.58 then 5.91/5.87 against 8.55/8.94 then 5.85/5.92).
- **What the post-commit review found** (an independent reader over
  c52ebb4; fixed after it). No defect and nothing architectural. The
  TRANSFORMED branch of `boundsOf` had no automated check: the DEV
  comparison in `setMap` sees only filed surfaces, all at identity on a
  play build, and `merge:hash` hashed no bounds. It now hashes each
  visual's record bounds (`bounds`) and checks them against the mesh's
  bounding info bit for bit on every run (`bounds≠mesh`), so `--editor`
  puts the transformed path under test each time. `setMap`'s two throws
  (the visuals and the records out of step, a block-keyed mesh that is no
  map visual) run in a production build: kept as invariants, stated in
  `WorldCulling`'s header, and routed through `worldFailed` at X3.7b
  (above). "A cell needs no mesh to be filed" overclaimed: filing is still
  per mesh, and only a cell's BOX needs none (`docs/rendering.md`,
  `SurfaceRecord.bounds`). `gateOf`'s reason ("so the test needs no mesh")
  could not apply, a candidate being a mesh: the gate reads the record
  because the plan asks it to, the two agreeing, so the verdict is the
  mesh's. Names: `filedBounds`, `recordByMesh`, `releaseArrays`'
  `surfaceIndex`. `merge:hash`'s summary counted a visual with no sink
  arrays as unequal but not as compared; it is counted apart now and still
  fails the run. `boundsOf`'s transformed path allocated three vectors a
  surface (module scratches now, bit-identical: the check above); the DEV
  bounds stats reset on `setMap(null)`; `misread` is in `BlockHandover`'s
  Owns. Re-checked after the fixes: `merge:hash` identical to the earlier
  baselines on all eight maps, shipped and `--editor`, but for the new
  `bounds` field; the record bounds equal to the mesh's on **3,828 of
  3,828** shipped visuals (628 off identity) and **28,473 of 28,473**
  editor-build ones (27,488 off identity); the DEV bounds check on
  Coldharbour 234 of 234 and Greyfen 357 of 357, every visual equal; the
  bank 61 of 61 byte-identical to the BEFORE at 2293c09, no console or page
  error; typecheck, build and corecheck.
- **Owed onward.** X3.7b, whose gate the headroom above meets: the
  defaults are the floor every WebGPU adapter must grant and the device asks
  for nothing more, so a phone gets the same limits; what can still differ
  there is memory, not a limit. The phone's FOLLOW-UP reading as every
  step's since X3.3c.

**X3.7b landed** (b5c0a1e, the post-commit review's fixes after it;
2026-10-25; no picture change).
- **What it is.** Babylon is made no mesh of anything our renderer draws.
  `worldMeshes` asks `BuildOptions.onSurface` — now `(surface, index) =>
  boolean` — BEFORE a mesh exists, and makes none of a surface ours draws
  in every pass; a round's `GameMap.visuals` are the glazing and the fires
  (Hollowmere 11, Greyfen 3, Coldharbour 80, Harrowmead 2, Sarab 30,
  Cinderhaven 29, Kurenai none), and `GameMap.world` keeps a record of every
  surface, each naming its mesh (`SurfaceRecord.visual`, -1 for none).
  `BlockHandover.onSurface` decides at the take: a block or landform surface
  on a cel recipe, or the emissive palette with its slots, is OURS; anything
  else is Babylon's, a caster among them held for the shadows alone; one that
  casts but cannot be held, a palette surface that cannot be held, or a mesh
  in a probe's list that is neither a fire nor ours (`probeHolds`) is REFUSED
  (`refuse`: thrown in a DEV build, held to the install and failed in a
  production one). The palette's main pass is ours at the install
  (`setPaletteMain`) and its mask handed to `WorldGlow` whenever a surface
  of it glows; the casters go to `WorldShadows` and `LampAtlas` on EVERY
  rung (`rungDraws` deleted). The contract is `docs/rendering.md` ("Our
  renderer's frame", the shadow maps, the lamps, the bake, "The palette,
  ours"), `docs/game.md` (`installMap`, `teardownMap`, `worldFailed`),
  `docs/editor.md`, `docs/world.md` and the headers.
- **Every former handback is `Game.worldFailed(reason)`**, run after the task
  in hand (`queueMicrotask`), once a failure (`worldFailing`, and the
  handover's own once-an-install latch): one `console.error` (`[world] <map>:
  the map could not be drawn — <reason>`), `enterMenu` (which leaves a
  server's match through `leaveMatch` as it leaves the page's own) and a
  toast (`<Map> could not be drawn on this device`), `loadHeights`' move.
  Its doors: `WorldBlocks.onFailed` (a group's pipeline, a withheld part, a
  list or a cut past the device's limits, a cull — `fail`, `giveUpAll`),
  `onPaletteFailed`, `Renderer.onRefused`, the `onLost` of `WorldShadows`,
  `LampAtlas`, `ProbeBake` and `WorldGlow` (registered by the handover now;
  `ShadowSystem`, `LocalShadows` and `ReflectionSystem` no longer take the
  world back, and `ReflectionSystem.oursLost` is deleted), a pass that will
  take no world at the install (a pipeline latched broken for the session),
  the DEV node check (now of the held casters alone, the one kind of surface
  Babylon draws and ours casts), and `WorldCulling.setMap`, whose two
  invariants hand back their reason instead of throwing (the map filed as
  none, `installMap` handing nothing over after it). `back`, `handedBack`,
  `takePalette`, `dropPalette`, `claimPalette`, `wholePalette`,
  `paletteTaken`, X3.7a's `checkBirth` and its DEV bounds comparison are
  gone, and `stats.handedBack` with them (report version 20; the viewer
  still reads an older capture's).
- **`WorldCulling`** grows a cell from EVERY record filed under its block,
  mesh or none, files Babylon's block-keyed meshes into it, drops `setTaken`
  and the taken set, and answers `reachBoxOf(block)` by the BLOCK (null is
  the landform's `NO_REACH`). `?babylonworld` is deleted (`urlOverrides`'
  `ourWorld`); its parent is tagged `exit-babylonworld` locally at d795e76 —
  pushing it is the user's call.
- **`noGlow` is read per surface, and it needed more than the plan's one
  line.** The glow's mask draws a palette GROUP whole off the main view's
  survivors, and `PASS_GLOW` also meant "never size-gated" — so a `noGlow`
  surface sharing a material with glowing ones would have bloomed, and lost
  its size-gate exemption. A `noGlow` palette surface is cut into a palette
  group of its own material (`WorldBlocks.paletteGroup`, the quiet groups),
  which `glowView` leaves out, and the gate's exemption moved to a bit of its
  own, `LIGHT_SOURCE` (32), on every palette surface — the cull's WGSL, its
  CPU mirror (`ClusterCull`'s replay) and `?cullcheck`'s probe test it where
  they tested `PASS_GLOW`. No shipped map marks a palette surface `noGlow`,
  so nothing moves; a scratch page marking one on Coldharbour installed it
  with three palette groups (two glowing, one quiet), the palette's main
  pass ours, every palette group a light source, no error.
- **`merge:hash` fingerprints one entry a SURFACE**: a surface with no mesh
  off its record (name, material, metadata, counts, pieces, bounds, the
  sink's arrays, `mesh: false`) compared on those fields alone, its arrays
  against the baseline's (which X3.7a proved equal to its mesh's buffers);
  a meshed one field for field, its `sceneRank` against the baseline's
  re-ranked over the surfaces still meshed; pane groups and editor items by
  surface index. It says how many surfaces of each map have no mesh rather
  than failing on them, fails any map that does not build (a DEV refusal is
  a page error out of `buildRound`, watched rather than waited out), and
  takes `--foliage <rung>`.
- **Measured.**
  - **The bank, against a BEFORE at d795e76 in the worktree** (`--check
    --keep` both sides): 60 of 61 byte-identical at first, the same 34
    stale rows over the bank's tolerance on both sides, no console or page
    error. The one, Sarab's `ground` (100 pixels, 0.0048%, at most 2/255 in
    a disc behind the palm), was the BEFORE's own: Sarab re-run on both
    sides, the BEFORE's second `ground` equals the AFTER's, twice, and
    differs from its own first in exactly those 100 pixels. So **61 of 61
    byte-identical** against the BEFORE's re-run; nothing of the cell boxes,
    the take, the candidate order or the default cube moved.
  - **`census --against` the BEFORE**: every row equal (Hollowmere 278,
    Greyfen 205, Coldharbour 672, Harrowmead 847, Sarab 661, Cinderhaven
    186, Kurenai 125). **`gate.mjs`** clean on seven; **`shaders.mjs`** clean
    on seven, ours 17/17 (21/21 Sarab and Cinderhaven, 23/23 Coldharbour).
  - **`merge:hash`** identical to X3.7a's baseline on all eight registry
    maps: 2,939 of the 3,828 shipped surfaces have no mesh now (Hollowmere
    124 of 135, Greyfen 395 of 398, Coldharbour 218 of 298, Harrowmead 124
    of 126, Sarab 310 of 340, Cinderhaven 376 of 405, Kurenai 255 of 255,
    the proving ground 1,137 of 1,871) and compared off their records; the
    889 meshed ones' arrays and bounds equal to their meshes' (628 off
    identity). **`--editor` identical** to its baseline, 28,473 of 28,473
    meshes. **At `--foliage low` and `medium`** every map builds with no
    refusal (the rungs took: Greyfen 253, Kurenai 128, Harrowmead 32 and
    Coldharbour 20 surfaces' arrays differ from `high`'s).
  - **`kit:hash`** identical; **`parity`** passes on eight; **`collision`**
    rewrote nothing; typecheck, build and corecheck pass.
  - **The forced paths** (a scratch page on Coldharbour): `WorldShadows
    .lose`, `LampAtlas.lose`, `ProbeBake.lose`, `WorldGlow.lose`, a refused
    main pass, a failed group, a failed main-pass palette pipeline, two at
    once, the cull refusing the build, and a pipeline failing under the
    building card each end in ONE `[world]` error, the menu and the toast;
    a round installed after all ten is clean, every pass ours. **A shadow
    rung raised from `off` mid-round** draws ours (four textures of ours,
    no generator, the lamps' atlas ours) and its frame at the menu vantage
    is byte-identical to a round installed at `high`. **`F2`**: the editor's
    build is 2,154 meshes, one a record, aligned, taken by nothing, its
    shadows the generators'; a click selects (placements 47), a select by
    ref highlights, a drag moves the item, a sculpt stroke rebuilds, and the
    save patched `layout.ts` (the one dragged entry) and `heights.ts` —
    restored by `git checkout` after.
  - **What the cut is worth** (`measure.mjs` in the scratch record: the
    heap after two forced GCs, live GPU bytes off `createBuffer` and
    `createTexture` wrapped from boot with `destroy` subtracted, the scene's
    counts, read after a SECOND install in the page, BEFORE and AFTER
    alternated twice a side):

    | map | JS heap MiB | GPU buffers MiB | meshes / geometries | `installRound` 2nd, s |
    | --- | --- | --- | --- | --- |
    | Hollowmere | 333 → 144 | 239 → 127 | 2,487 → 2,363 / 2,409 → 2,285 | 3.01, 2.94 → 2.56, 2.42 |
    | Greyfen | 1,154 → 149 | 652 → 142 | 2,741 → 2,346 / 2,665 → 2,270 | 7.98, 7.98 → 5.62, 5.57 |
    | Coldharbour | 461 → 170 | 357 → 197 | 3,617 → 3,399 / 3,529 → 3,311 | 4.49, 4.40 → 3.63, 3.76 |
    | Harrowmead | 853 → 168 | 515 → 143 | 2,864 → 2,740 / 2,788 → 2,664 | 7.00, 7.16 → 5.28, 5.28 |
    | Sarab | 431 → 238 | 252 → 136 | 6,092 → 5,782 / 6,010 → 5,700 | 4.47, 4.50 → 3.98, 3.93 |
    | Cinderhaven | 720 → 269 | 625 → 353 | 6,611 → 6,235 / 6,521 → 6,145 | 8.06, 8.08 → 6.68, 6.60 |
    | Kurenai | 753 → 134 | 528 → 207 | 2,497 → 2,242 / 2,417 → 2,162 | 5.41, 5.51 → 3.84, 3.84 |

    Textures are unchanged on every map (237-259 MiB). The first install in
    a page fell the same way (Greyfen 11.8 to 9.2 s, Cinderhaven 12.3 to
    11.0, Kurenai 9.2 to 7.6).
  - **X0.3 on the desktop** (`bench.mjs`, `--max --gpu`, uncapped,
    3440x1440, the BEFORE at d795e76 and the AFTER alternated run by run,
    three a side, on Greyfen, Coldharbour and Cinderhaven; the canonical
    fight hashes on all 18 runs): the mean frame new / old 0.993-1.005 on
    the vantages, 1.000-1.001 on the path and 0.992-0.997 in the fights but
    Coldharbour's, 1.030 (its runs' spread 1.1% and 2.4%: under the 8%
    floor); `gpu.frame` 0.980-1.021; draws equal but Greyfen's fight 270 to
    272 and Cinderhaven's 308 to 309. The frame was never the point: what
    moved is the bench's install, Coldharbour 9.6-9.7 s to 7.0-8.5 and
    Cinderhaven 13.4-13.6 to 10.4-12.0; Greyfen, each run's first map on a
    cold dev server, read level (12.6-12.8 to 12.5-13.0), as at X3.7a.
- **Where the line with X3.7c was drawn.** Taken literally from the X3.7b
  list: the `lose`/`onLost`/`broken` latches stay (X3.7c deletes them) and
  their LISTENER changed (the handover's failure); Babylon's
  `ReflectionProbe` path, `GlowPass`'s palette twin and `EmissiveWorld`'s
  Babylon stages stay, now used by the editor alone (`rebake`'s `toBabylon`
  kept for the harness); `WorldBlocks.setPaletteMain` and the HELD layer
  (`addCaster`, a casting fire's — no shipped map has one) stay; the
  generators and the lamps' render target are the editor's (X5.3).
- **What the post-commit review found** (an independent reader over
  b5c0a1e; fixed after it). No game-code defect and nothing architectural;
  one defect in the ORACLE. `merge:hash --against` could not see a surface
  LOSE its mesh: only a meshless entry said `mesh` (`false`), and a field a
  side lacks is not compared, so a fire made meshless would have vanished
  and passed. A meshed entry now says `mesh: true` and a `mesh` that moved
  is a difference (a baseline that records none, X3.7a's, still compares
  as before); `reRanked` no longer gives a baseline rank of -1 a slot.
  Proved on Hollowmere and Coldharbour with one fire forced meshless: the
  new script against the new baseline fails on exactly that entry
  (`visuals[61]`, `visuals[109]`: `mesh`), the old one against the old
  baseline passed it; reverted, both maps identical. Five LATENT paths, none
  reachable on a shipped map: `WorldCulling.reachBoxOf` threw, uncaught
  inside `installMap`, for a surface of ours filed under a block no cell
  was grown for — it answers null now and `BlockHandover.install` fails the
  world on it, as `setMap`'s reasons are; `fail`'s guard was "ours took a
  surface" (`reach` non-empty), meant for the editor, which also swallowed
  a production refusal on a map ours took nothing of — the handover now
  latches an OWNER at the install (`WorldOwner`, a fresh `{ id, name }`
  each) and an editor build latches none (`install`'s `editor`); the glow
  mask asked a pipeline for every palette group's bias, a quiet (`noGlow`)
  group's too, which could have failed the world for a pass drawing
  nothing with it (`palettePipelines` takes the groups the pass draws); a
  loss of the OLD map landing between `startRound` and the new install
  aborted the NEW round under a toast naming the new map — the failure now
  carries its owner, which names the map in the line and the toast, and
  one whose owner is not the round in hand while a build is pending
  (`Game.roundWorld`, null from `startRound` to the install) is said and
  ignored; and a cull refusal of an EDITOR build would have taken the page
  to the menu with the editor open — it is a `console.error` now, the
  editor kept over a map the cull files nothing of. Two of SHAPE: the
  refusal of a Babylon mesh that is neither the glazing nor a fire (a held
  non-fire caster among them) ran in `probeHolds` only because
  `ReflectionSystem.build` asked it ahead of an early return — it is the
  install's now (`strayMesh`, every map), and `probeHolds` only counts; and
  a DEV refusal stranded the page under the building card (it threw at the
  take, out of `buildRound`, the state still `loading`) — a refusal is held
  to the install in every build, which fails the world and THEN throws in
  DEV, so `merge:hash` still sees a page error, the map was built whole
  and is torn down, and the page reaches the menu. Docs: the stale
  handback claims in `PipelineWarmup`'s header, the scatter list's limits
  and the water's rebind (`docs/rendering.md`, `WaterSystem`, `FILES.md`;
  the `toBabylon` branch it serves is X3.7c's to delete), `ProbeBake.lose`,
  `ReflectionSystem`'s log line and `rebake`, `CLAUDE.md`'s "any other mesh
  carrying `metadata.block`" (no line added), `docs/game.md`'s failure
  paragraph, `VERIFYING.md`'s forced-loss recipe (the refused surface, the
  old map's loss), and this note's hash. Left for X3.7c as planned:
  `setPaletteMain` (only ever `true`), `ProbeBake.lose`'s unread `dropped`
  count, and `toBabylon`. Re-checked after the fixes: `merge:hash`
  identical to X3.7b's baselines on all eight maps, shipped and `--editor`,
  the new baselines (`merge-baseline-x37b.json`,
  `merge-baseline-x37b-editor.json` in this step's scratch record)
  differing from those only by `mesh: true` on the 889 and 28,473 meshed
  entries; `census --against` the BEFORE equal on seven; `gate.mjs` clean
  on seven; the forced paths on Coldharbour — the ten of X3.7b, a surface
  filed under no block, a refused surface (one `[world]` line, the DEV
  throw as a page error, the menu, the toast), the old map's shadows lost
  right after a Restart's `startRound` (one line naming it, "already being
  replaced", the new round deployed with every pass ours, no toast) and a
  clean round after; an editor build the cull refuses (one line, the
  editor kept, no toast, a clean round on leaving it); `F2` select, drag,
  sculpt and save (restored); the bank 61 of 61 byte-identical to the
  BEFORE at d795e76 (its Sarab re-run) and to X3.7b's AFTER, the same 34
  stale rows, no console or page error; typecheck, build and corecheck.
- **Owed onward.** X3.7c. The phone's FOLLOW-UP reading, as every step's
  since X3.3c — X3.7b's gain is memory the phone feels most. Pushing the tag
  `exit-babylonworld` (the user's call).

**X3.7c landed** (f9b2512, the post-commit review's fixes after it;
2026-10-25; no picture change).
- **What it is.** The fallback machinery Babylon kept for the world goes for a
  round. **Babylon's `ReflectionProbe` path is deleted** (`ReflectionSystem`:
  the two probe pools, the draw-budgeted queue and `releaseBatch`, `release`,
  `forgetPasses`, `newProbe` and its scene swap, `faceOf`, `neighbourhood`,
  `opaqueWorld`, `encloses`, `toBabylon`, `setOurs`/`holds`/`path`, the eye
  borrowed around the render targets, the water's `rebind`; `CONFIG.graphics
  .reflection.drawsPerFrame`); the bake is ours, always, and a build our bake
  holds no world for (an editor's, a round already failed) bakes nothing.
  **The default cube is one of ours** (`ProbeBake.cube("default")`, wrapped,
  never baked: WebGPU makes it zeroed, as Babylon's probe 0 was cleared to
  zero), bound at a strength of 0 as before. **The emissive palette's Babylon
  stages and its glow-mask twin are deleted** (`EmissiveWorld.ts`: no
  ShaderStore entries, no `EmissiveWorldMask`, no `SelfMasking`, no
  palette/fog/eye uniforms); `EmissiveWorldMaterial` is a plain `Material`
  OBJECT — the merge keys on it, the factory hangs its recipe off it,
  `GlowRules` reads its white `emissiveColor` (X3.7, Keeps). **The
  `lose`/`onLost`/`broken` latches are deleted** from `WorldShadows`,
  `LampAtlas`, `ProbeBake` and `WorldGlow` (`WorldGlow.holds` with them), and
  so are `WorldBlocks.setPaletteMain` (only ever `true`: the palette is drawn
  first whenever there is one) and its `paletteFailed` getter,
  `BlockHandover.probeHolds` and `ProbeHolding`, and the Babylon-bake-only
  flips the materials carried (`CelMaterialFactory.setOpaqueAlpha` and
  `readEye`, `FlameMaterial`/`BlastMaterial.setOpaqueAlpha`,
  `ShadowBindings.holdCloudShadow`).
- **How a failure still reaches `worldFailed` without the latches.** The
  handover hands each pass its world WITH the install's failure —
  `WorldShadows.setCasters(depth, failed)`, `LampAtlas.setCasters(depth, slot,
  failed)`, `ProbeBake.setWorld(source, failed)`, `WorldGlow.setWorld(source,
  failed)`, `failed` being `BlockHandover.failFor(owner, …)`, which drops a
  failure for an install no longer in hand — and the pass TELLS it whatever
  it finds it cannot draw, in the turn it finds it: casters whose build
  failed, a bake view not made or not built, a mask view not made, a mask
  pipeline failed, a refused mask pass. Nothing is dropped or handed back;
  the handover stops our draws (`WorldBlocks.stop`) and `Game.worldFailed`
  tears the round down after the task in hand. **A pipeline asked once for
  the session** (the lamps' proxies, the bake's mips) is no latch either:
  every world handed over waits on its settled PROMISE, so a failure fails
  that install and every one after it, each through its own failure. The
  handover's own doors are unchanged (`WorldBlocks.onFailed`,
  `onPaletteFailed`, `Renderer.onRefused`, the cull's refusal, a refusal at
  the take, the DEV node check). The install's checks that asked a pass
  whether it HELD a world (`lamps.casters`, `probes.holds`, `glow.holds`,
  `blocks.paletteFailed`) are gone with them: the first three could be false
  at the install only through a latch, but for `glow.holds` on a null
  `glowView()`, which `WorldGlow.setWorld` now tells synchronously, in the
  install's turn; and `blocks.paletteFailed` was dead — set only in a
  main-pass palette pipeline's `.then`, after the cut that asks for it, so
  never true by the install that read it (corrected by the review, below).
- **What the editor keeps, and why it needed nothing replaced but the
  cube.** `ShadowSystem`'s generators and `LocalShadows`' render target, as
  planned (X5.3's). The palette's Babylon stages and twin were drawn by NO
  build: an editor build never merges its blocks (`MapBuilder.mergeBlocks`,
  the one pass that paletteises), so its emissives are `getEmissive`'s
  `StandardMaterial`s, which `GlowPass` blooms as ever (`merge:hash
  --editor`'s baseline: no `emissive-world` material on any of the eight
  maps' 28,473 meshes) — the header that said they drew an editor build was
  wrong. Its glass and water bake nothing and sample the default cube at
  strength 0, as before.
- **Deviations.** HELD-caster layer kept — but not, as this note first
  said, "live for a casting fire, which no shipped map has": it is
  unreachable by construction (the review, below). Every fire is made
  `noShadowCaster` where it is made (`flame.ts`'s `flamePart`, and the fire
  drum's flame), so no fire is ever held, and a held caster that is not a
  fire is made a Babylon mesh that `strayMesh` refuses; no held caster can
  exist without making a fire cast. The layer (`WorldBlocks.addCaster`,
  `BlockHandover`'s `held`, the DEV node check of its meshes) is kept for
  X4.4, the fires, to use or delete.
  `probeCount` counts the slots baked, both pools, and no longer the default
  cube (Babylon's glazing pool held it as slot 0): one fewer on a map with no
  glazing (Hollowmere 3 to 2, Greyfen and Harrowmead 2 to 1, Kurenai 4 to 3;
  `gate.mjs` prints it and asserts nothing of it). A stale comment naming
  `ReflectionSystem.encloses` stays in `src/world/harrowmead/layout.ts`: the
  collision bake's staleness guard hashes that file's text, so editing it
  would re-bake.
- **Measured.**
  - **The bank, against a BEFORE at 9f7f0b1 in the worktree** (`--check
    --keep` both sides): 60 of 61 byte-identical at first, the same 34 stale
    rows over the bank's tolerance on both sides, no console or page error.
    The one, Sarab's `ground` (100 pixels, 0.0048%, at most 2/255), was this
    time the AFTER's first run — X3.7b's known run noise: Sarab re-run on both
    sides, the two re-runs equal each other on all eleven rows, and equal the
    BEFORE's first run and X3.7b's AFTER. So **61 of 61 byte-identical**; the
    default cube moved nothing, as `mix(sky, city, 0)` says it cannot.
  - **`census --against` the BEFORE**: every row equal (Hollowmere 278,
    Greyfen 205, Coldharbour 672, Harrowmead 847, Sarab 661, Cinderhaven 186,
    Kurenai 125). **`gate.mjs`** clean on seven (the probe counts it prints
    one lower on the four maps with no glazing: above). **`shaders.mjs`**
    clean on seven, ours 17/17 (21/21 Sarab and Cinderhaven, 23/23
    Coldharbour, palette biases 0 and -24) — after its discovery was fixed:
    it read the palette's biases off the ShaderMaterials it compiles, which
    the palette no longer is, and its first run built neither palette program
    (15/15, "palette biases []") while passing; it now asks every material on
    the page (`scene.materials`). Babylon compiles two modules fewer a map
    (116-132 against 118-134): the palette's stages.
  - **`merge:hash`** identical to X3.7b's baselines and to X3.7a's on all
    eight registry maps, shipped (2,939 of 3,828 surfaces meshless, 889
    meshed equal in arrays and bounds) and `--editor` (28,473 of 28,473).
    **`kit:hash`** identical (3,722 builds); **`parity`** passes on eight;
    **`collision`** rewrote nothing; typecheck, build and corecheck pass.
  - **The forced paths** (a scratch page on Coldharbour, each on the pass's
    own path, `VERIFYING.md`'s recipe): the main pass refused, a failed
    group, a failed main-pass palette pipeline, the mask pass refused
    (`WorldGlow.refused`), two at once, the shadow maps' casters and the
    lamps' casters not building, the lamps' proxies' pipeline failed for the
    session — and a SECOND round on that session failing the same way — the
    bake's mips pipeline failed, its view not made and not built, the mask's
    view not made, a mask pipeline failed, the cull's refusal, a pipeline
    failing under the card, a surface filed under no block and a refused
    surface (its DEV page error) each end in ONE `[world]` error, the menu
    and the toast naming the map; the OLD install's failure called after a
    Restart's `startRound` is said against the old map ("already being
    replaced") and dropped when called again after the new install
    (`failFor`), the new round deployed with no toast; a clean round after,
    every pass held, the bake drained. **A shadow rung raised from `off`**
    mid-round draws ours, byte-identical to a round installed at `high`.
    **`F2`**: 2,154 meshes, the generators drawing, select (placements 47),
    a select by ref, a drag, a sculpt stroke and a save (restored by `git
    checkout`), no error. **The editor's look**, photographed in the editor
    at Coldharbour's shopfront (see-through glazing, the shop's lamps) and at
    its curtain wall, frozen, two runs a side: BEFORE against AFTER 0.005-
    0.014% and 0.020-0.026% of pixels (at most 3 and 17/255), the BEFORE
    against itself 0.005% and 0.018% (2 and 17/255) — run noise, the glass
    showing the sky half and the fanlight's bloom the same; one custom
    render target fewer (Babylon's probe 0).
  - **What it is worth** (`measure.mjs`, the second install in the page,
    BEFORE and AFTER alternated twice a side): GPU textures 0.3-0.4 MiB lower
    on every map (Babylon's probe 0 against the default cube of ours: 236.8
    to 236.5 Hollowmere, 256.2 to 255.9 Coldharbour, 258.5 to 258.1
    Cinderhaven), GPU buffers identical (127.0 to 353.0 MiB), the JS heap
    level within half a MiB (Greyfen 149.1 to 148.8, Cinderhaven 269.6 to
    269.2), scene meshes and geometries identical, `installRound` level
    (Greyfen 4.28/4.33 to 4.35/4.31 s, Cinderhaven 5.87/5.57 to 5.59/5.49).
    The bundle is 9.2 kB smaller (`index` 9,448.94 to 9,439.72 kB, gzip
    2,344.26 to 2,342.01). X3.7c deleted a path, not a cost a round paid.
  - **X0.3 on the desktop** (`bench.mjs`, `--max --gpu`, uncapped,
    3440x1440, the BEFORE at 9f7f0b1 and the AFTER alternated run by run,
    three a side, on Greyfen, Coldharbour and Cinderhaven; the canonical
    fight hashes on all 18 runs, none hung): the mean frame new / old
    0.997-1.001 on the vantages, 0.993-1.000 on the path and 0.996-1.010 in
    the fights (every spread under 3%); `gpu.frame` 0.990-1.013; draws equal
    but Greyfen's fight 273 to 272. The bench's install read the main tree's
    dev server again (Greyfen, each run's first map, 8.7-8.8 s to 11.0-11.5;
    Coldharbour 8.1-8.5 to 6.0-6.4) — `installRound` timed in the page,
    above, is level.
- **Phase 3's end condition** — "Babylon builds no mesh in a round for
  anything our renderer draws" — **reads true** (since X3.7b), and since
  X3.7c no Babylon pass of the world is kept for a round: what Babylon draws
  in one is the bodies and `BodyShadows`, the hulls, the viewmodel, the
  effects and fires, the sky, clouds and moon, the water, grass, glazing,
  flags, rings, blobs and particles, and the glow mask's non-world emissives.
- **What the post-commit review found** (an independent reader over
  f9b2512; fixed after it). No defect and nothing architectural. One
  LATENT path: a block-merged build handed no `onSurface` would make a
  Babylon mesh wearing the now-plain `EmissiveWorldMaterial`, which a frame
  never draws (a plain `Material` is never ready) and `GlowPass` would bloom
  WHITE over the hole (its stock mask admits the white `emissiveColor`) —
  the header said only "a hole". `worldMeshes` makes a mesh of the palette
  in NO build now: handed `onSurface`, the handover has taken it or refused
  it (the refusal failing the world at the install, as X3.7b routes every
  one), so a refused palette surface is left meshless with the map being
  torn down; handed none, a DEV build throws (no production build hands
  none, the editor's being DEV-only and never merged). Two ORACLES that
  could pass while testing nothing: `gate.mjs`'s "a reflection probe is
  re-rendering every frame" read `scene.customRenderTargets`, empty in a
  round since X3.7c — it now asks our bake, `bakePending` 0 at deploy and
  0 on every frame the gate watches (~2,850 a map); and `shaders.mjs`
  could pass again having found no palette bias — it now fails when a
  palette group `WorldBlocks` cut carries a bias it built no program at.
  Both proved to fail: the bake re-queued every 600 frames by a scratch
  hack in `ReflectionSystem.releaseOurs` failed Coldharbour's gate ("the
  reflection bake re-queued during the round (39 probes pending at most
  over 2851 frames)"), and X3.7c's first-run discovery restored in a
  scratch `shaders.mjs` failed Coldharbour ("palette biases [], cut [-24,
  0]", 19/19 ours where the right run builds 23/23) — each reverted. Of
  SHAPE: the held-caster layer is unreachable by construction, not merely
  unused (Deviations, corrected), kept for X4.4; `Game`'s per-mesh bloom
  rule lost its `fadesOwnBloom` branch, no Babylon mesh wearing the palette
  — and `fadesOwnBloom` itself went, there being no other caller (the
  review took `WorldGlow` to use it: it never did, its rule passing a fade
  of 1); `WorldBlocks.draw`'s palette guard went, `drawPalette` skipping
  every group with no emissive. Docs: this note's line on the install's
  checks (`blocks.paletteFailed` was dead, a null `glowView()` is told
  synchronously), `CelInk`'s "ReflectionSystem flips `opaqueAlpha`" (the
  bake's frame states 1, `fillBakeFrame`), `CONFIG.graphics.reflection`'s
  `size` and `radius` (Babylon's bake's cost model, stated in the present
  tense), `generate-harrowmead.mjs`'s stale `ReflectionSystem.encloses`
  (its `layout.ts` left alone: editing it re-bakes), `VERIFYING.md`'s
  default-cube readback (the raw `GPUTexture` in `ProbeBake`'s cubes, not
  Babylon's wrapped `defaultCube`), `docs/rendering.md`, `FILES.md`, the
  webgpu-ref README, X4.4's list and the headers. Re-checked after the
  fixes: typecheck, build and corecheck; `gate.mjs` clean on seven, every
  map's bake drained at deploy and over the frames watched; `shaders.mjs`
  clean on seven, the cut palette's biases those built (Coldharbour
  [-24, 0], the rest [0]), ours 17/17 (21/21 Sarab and Cinderhaven, 23/23
  Coldharbour); `census --against` the BEFORE equal on seven; `merge:hash`
  identical to X3.7b's baselines on all eight maps, shipped and `--editor`
  (no `emissive-world` material on the editor's 28,473 meshes); the forced
  paths on Coldharbour — X3.7c's twenty, among them the main pass refused,
  the mask pass refused and the mips pipeline failed — each one `[world]`
  error, the menu and the toast, a clean round after, and no install of
  the twenty handed a palette mesh (the refused PALETTE surface's
  included); the DEV assertion fired once under a scratch build handed no
  `onSurface` (`worldMeshes: "block-1,0-emissive-world-over-glass-noInk"
  wears the emissive palette…`); the default cube read back all zeroes on
  six faces through the corrected recipe, a pool cube world; `F2` select,
  drag, sculpt and save (restored by `git checkout`), no error; the bank 61
  of 61 byte-identical to the BEFORE at 9f7f0b1 on the first run, the same
  34 stale rows, no console or page error.
- **Owed onward.** Before a phase gate: the phone's FOLLOW-UP reading, owed
  since X3.3c and the user's to take, and the post-commit review of this
  step; then the `exit-phase-3` tag, the user's call (rule: "Moving the
  branch back to one is the user's call"), as is pushing `exit-babylonworld`.
  X5.3 deletes what the editor keeps. X4.4 uses or deletes the HELD-caster
  layer, which no build reaches (Deviations).

---

## Phase 4 — Everything else that draws

Each step takes one kind of draw off Babylon's scene, along with its view
module from X2.2. When the last one lands, Babylon draws nothing but the post
chain, and the frozen cel-material cache and its traps are deleted with
`CelMaterialFactory`'s Babylon half.

### X4.1 — Bodies (PERF_PLAN C6, A4) — **L, as five sub-steps** (split 2026-10-29) — X4.1a **LANDED** (a417bfc, review fixes after it)

Every body a page draws — `NetSoldier`'s rig, a corpse, the death cam's
stand-in — comes off Babylon's scene, along with the moon's body shadow map,
and A4's fade is built on the result. It is split so that the four moves are
each proven with no picture change, one claim at a time, and the fade, which
IS a picture change (rule 2), lands alone with the bank's numbers. Each
sub-step lands on its own and leaves the game shippable.

**This reverses one line of PERF_PLAN C6**, which kept a corpse a Babylon rig
because `RagdollSystem` reparents its joints onto Havok proxies. Here a corpse
is posed off X2.4's arrays (`WorldBody.pose`) onto our joints, so the
reparenting goes and every body is one kind of thing to draw.

- **X4.1a — the joints are ours (no picture change).** Landed (below).
  `SoldierModel`'s tree
  of `TransformNode` joints becomes our own hierarchy, its world matrices
  written into arrays a rig owns. Babylon still draws the 14 meshes, reading
  those matrices. `NetSoldier`'s pose (`soldierPose.ts`), `proxyBoxes`, the
  muzzle replay and anything else that reads a joint read the arrays. The
  root capsule `WorldCulling` measures a body by is taken off the arrays too
  (X1.3 left it here). **Oracle:** the joint matrices against the nodes',
  bit for bit, over a recorded round, before the nodes go.
- **X4.1b — corpses and the stand-in on our joints (no picture change).**
  `RagdollSystem` writes a corpse's joints from its bodies' pose arrays
  instead of reparenting nodes onto proxies; the death cam's stand-in the
  same. `freeze`, the pool's three tiers and eviction of the oldest, and the
  quaternion leak (`docs/deaths.md`) are re-proven on the new path.
  **Oracle:** `drop.mjs --check --exact` and `clients.mjs --check` as at X2.4;
  a blast throwing bodies; a full pool evicting; a respawned bot that does not
  freeze.
- **X4.1c — the moon's body map is ours (no picture change).** `BodyShadows`'
  generator, light and proxy mesh become a pass of our renderer, as
  `WorldShadows` did at X3.6a, drawing `proxyBoxes`' matrices — soldiers AND
  hulls, a hull's being its collider box off its own fields (`hullFrame.ts`),
  never its mesh, so X4.2 owes this map nothing. The rung, the window and the
  back faces carry over; the lamps' atlas already draws ours (X3.6b) and only
  changes where its boxes come from. **Oracle:** the bank; a shadow rung `off`
  to `high` mid-round; the map read back against Babylon's before the
  generator goes.
- **X4.1d — every body drawn by us (PERF_PLAN C6).** Living bodies, corpses
  and the stand-in as instances fed from the joint arrays: 14 joint meshes ×
  48 bodies becomes 14 instanced draws or fewer, in every pass a body is in.
  The body's measure, the fog-wall gate and the size gate's whole-body drop
  move with them, its emissive with it. Babylon builds no rig mesh in a round.
  Its pipelines are asked ahead through `PipelineCache`, so the warm-up's body
  pose goes or becomes a key. **Oracle:** the bank's rig vantages 61 of 61
  byte-identical; census; X0.3 alternated at 24 a side on Sarab and
  Cinderhaven, `--max --gpu`; a netplay round; a blast throwing bodies.
- **X4.1e — A4's fade (the picture change).** A screen-door dither at
  `bodyDrawDistance` AND at the size gate's drop (a fade built for one misses
  the other), carried as a per-instance value — A4's "first question" is
  answered by X4.1d's instancing. The dithered pipeline is asked ahead with
  the rest. **Oracle:** the bank's numbers in the message (only rows with a
  body at a fade edge may move); a body walked through both edges on a phone
  and a 32:9 window.
- **Contracts all five keep:**
  - a body is measured once and drops whole, its emissive with it
  - a rig's shadow shape is `RAGDOLL_BONES`, a hull's its collider box
  - the local player casts nothing
  - the side a rig wears is chosen when it is built (`teamView`), and is half
    of a rig pool's identity beside its size
  - the rig pool is built once per roster size and never disposed inside a
    round
  - nothing under Havok feeds navigation, cover or hit detection
- **Verify, each sub-step:** the bank `--check --keep` against a BEFORE at the
  parent; `census --against`; `gate`, `shaders`; typecheck, build, corecheck,
  `parity`; a round offline and a netplay round.

**X4.1a landed** (a417bfc, the post-commit review's fixes after it;
2026-10-29; no picture change).
- **What it is.** A soldier rig's joints are OUR hierarchy
  (`src/entities/rigJoints.ts`, Babylon-free, a root of
  `check-babylon-free.mjs`): `Joint` holds the local channels a
  `TransformNode` held (position, Euler, scaling, its own switch) and a
  float32 world `Matrix` the rig owns; `JointTree.compute` composes every
  joint parents first and `computeChain` one joint and its ancestors — each
  answer FRESH, what a forced `computeWorldMatrix(true)` was, in `src/math`'s
  copies of Babylon's arithmetic (the muzzle replay's, X2.2). **Babylon
  still draws the fourteen meshes, and none has a parent**: each mesh's own
  local is composed once at build, and `drawRig` hands Babylon its world
  matrix (that local times its joint's) through `freezeWorldMatrix` — once a
  frame from `Game.drawBodies`, in every state, after every write and
  immediately before `scene.render`, inside the `render` span where Babylon
  composed them before. **The root capsule is gone**: the root is a joint;
  `rig.enabled` is the switch every roster, the death cam and the culling
  read (`setRigEnabled`, which writes each mesh's own flag beside it, the
  launcher's mesh off while its joint is); and `WorldCulling` measures a
  body through `PooledBody.measure` (`SoldierModel.pooledBody`, so the cull
  still names no soldier) — `rigJoints.measureBody`, the capsule's sphere
  (`BoundingSphere._update` over its exact ±0.4/±0.9 bounds) off a fresh
  compose of the root. Every reader of a joint reads the arrays:
  `NetSoldier.muzzleWorld` and the death cam's anchor and chest
  (`jointPosition`), `ProxyBoxes.writeRig` (a fresh `compute`; the bone
  boxes composed in `src/math`), both shadow packers' root position,
  `RagdollSystem.shadowFor` and its spawn (`computeChain(joint).decompose`).
  The pose math (`solveArm`, the reload's hand keys) moved onto `src/math`
  with it. `Matrix.FromArrayToRef` joined `src/math`, with its `math-check`
  case; `storePose` takes `Vector3Like`/`QuaternionLike`.
- **How it coexists with today's corpse reparenting (X4.1b's to delete).**
  A corpse still hangs its bones on the pool's proxy `TransformNode`s, but
  as a joint's HOLDER: `JointTree.hold(joint, proxy)` and `release(joint)`
  replay `TransformNode.setParent` operation for operation (the current
  world rebuilt in place off the current parent's or holder's fresh world,
  times the inverse of the new one's, decomposed, Euler written back), and
  a held joint composes off the proxy's own position, quaternion and scaling
  exactly as Babylon composed an unparented node. So a frozen corpse is the
  same locals to the bit, and `resetSoldierPose` clears every holder — the
  leak to fear now, as a leaked quaternion was. The proxies stay Babylon
  nodes with nothing under them, so the one read of one's matrix
  (`applyImpulse`'s chest point) is FORCED. The first `clients.mjs --check`
  moved at frame 50 without it: the ninth death's eviction reuses slot 0,
  whose proxy's unforced `getAbsolutePosition` answered frame 0's position
  inside the script's one render id, where `setParent` had forced it; the
  forced compose put the script back to bits. X4.1b writes the poses
  straight onto the joints, and takes the holder and the proxies with it.
- **The oracle — the joint matrices against the nodes', bit for bit.**
  - **On the parent, over live rounds** (a scratch probe on 25331b8): every
    rig mesh in the active list at `onAfterActiveMeshesEvaluation`, against
    a fresh `src/math` composition of its node chain's current locals —
    368,091 on Sarab (2,400 frames, 48 bodies) and 200,173 on Hollowmere
    (3,000 frames; 176,110 of them corpses: fifteen deaths staged through the
    roster's own alive edge, bullet and blast, and the death cam's
    stand-in) — all bit-identical, so what Babylon DREW was always the fresh
    composition the arrays now make. Both shadow packers'
    `root.absolutePosition` was fresh on every read (46,314 on Sarab, 15,797
    on Hollowmere). **The one stale reader**: `ProxyBoxes.writeRig`'s
    unforced `getWorldMatrix` read 146 of 179,208 body-map boxes and 146 of
    172,452 lamp boxes, and `shadowFor` 4 of 11,569 corpse chests, out of
    Babylon's render-id cache on the frames a corpse's joints changed parent
    (the take and the freeze) — the world under the OLD parent, which
    `setParent` keeps equal to the new up to float32 rounding. The arrays
    answer fresh there (`rigJoints.ts`' header): a rounding-sized input to a
    shadow map on two frames a corpse, which no bank row can see, gone with
    the hand-off at X4.1b. The capsule's sphere: 26,465 forced measures on
    Sarab against `measureBody` off the same root, all bit-identical.
  - **Across the two trees** (one scratch run on the parent's nodes and one
    on our arrays): 8,000 seeded poses, both kits, the launcher on, a reset
    every 97th — gait, aim, twist, crouch, ready, carry, kick and reload, the
    root anywhere in ±600 m and turned anywhere — every joint's world (17)
    and every mesh's world matrix as Babylon holds it (15): **0 of 8,000
    differ**. `clients.mjs`'s script with every switched-on stand-in's 17
    joint and 15 mesh world matrices digested each frame: **601 of 601
    frames identical on Coldharbour, Cinderhaven and Harrowmead** (310
    distinct digests a map — the takes, the tumbles, the freezes, the sinks,
    the eviction and the retire).
  - **On the step, over live rounds** (the same probe against our arrays):
    every rig mesh drawn, against its local times a fresh composition of our
    joints' locals at evaluation — Hollowmere 190,975 (176,690 corpses),
    Sarab 327,947 (171,316 corpses), all bit-identical: no rig is drawn off a
    matrix older than its last write.
  - **`clients.mjs --check`**: identical on all three maps — Havok's bodies,
    every pooled body every frame, and the node digest, whose rig half reads
    our joints in the bytes a node gave (the holding proxy's name as the
    parent, the rig's switch as the root's flag, "noquat"), so the bank
    taken off the nodes grades them unchanged.
- **Measured.** The bank against a BEFORE at 25331b8 in a worktree
  (`--check --keep` both sides): **61 of 61 byte-identical**, `rig-near`
  and `rig-far` among them, the same 34 stale rows on both sides, no console
  or page error. **`census --against`** the BEFORE: every row equal (Hollowmere 278, Greyfen 205, Coldharbour 672, Harrowmead 847, Sarab 661, Cinderhaven 186, Kurenai 125). **`gate.mjs`** clean on seven. **`shaders.mjs`** clean on seven, ours 17/17 (21/21 Sarab and Cinderhaven, 23/23 Coldharbour). `math-check` 79 cases;
  typecheck, build, corecheck and `parity` (eight maps) pass. **A round offline** on Hollowmere and Sarab (the probes above, and `gate`'s seven) and **a netplay round** against a local `dist-server` (`?mp=`, Hollowmere, the authority's round): bodies drawn off the wire, fifteen deaths staged through the roster and the death cam's stand-in, 208,184 rig meshes drawn and every one the fresh composition, no console or page error.
  **`kit:hash --models`: the two `soldier` rows are RE-BASELINED here, by
  construction** — `["soldier",0]` draw 9bd8b11fd2b30505 → 37d7f293a37d85e0
  (set 3aab2fe91440b7a7 → 2b8b8d71b6fb5da2), `["soldier",1]` draw
  fb60ea13d72eda54 → 57344c42de95f3cf (set a839d7e8d283267b →
  f7ce60a37248dcfd), taken at 25331b8 and at HEAD by the review. The script
  hashes every transform node left in the scene, each mesh's parent and
  transform, and the builder's plain data (the rig), and this step took the
  joint nodes and the root capsule out of the scene, left every mesh
  unparented, and made the rig's joints a
  `JointTree` — so both rows had to move, and they cannot say whether a
  drawn body did; the bank and the oracle above are that proof. **A later `--against` a
  baseline older than a417bfc reports these two as "content changed", and
  that is this step, not a regression** — take a fresh baseline past it.
- **Deviations.** `WorldCulling.stats.pooled` counts the meshes alone (it
  counted each root too). `DeathCam.warm` hands its meshes their matrices
  itself as well as through `drawBodies` — redundant, a warm-up frame running
  `drawBodies` like any other, and harmless. The fresh shadow-box and
  `shadowFor` reads above.
- **What the post-commit review found** (an independent reader over a417bfc
  and 8bf4e21; fixed after it). No game-code defect and nothing
  architectural; every fix is a document or a comment. One RECIPE that
  stopped working: `VERIFYING.md`'s "a soldier is judged in a picture" built
  a rig with `buildSoldier` and posed it in an `onBeforeRenderObservable`,
  but since this step only `Game.drawBodies` hands a rig's meshes their
  matrices, and only the roster's and the death cam's — so a script
  following it photographed unparented meshes bunched at the origin. It now
  calls `setRigEnabled(rig, true)` (a fresh build leaves the slung
  launcher's mesh on) and `drawRig(rig)` in that observable, after the pose,
  and `drawRig`'s doc names a rig that pass does not know as owing its own
  call. One ORACLE row that moved by construction and was not said: the
  `kit:hash --models` soldier rows (Measured, above). Stale words:
  `CLAUDE.md`'s deaths pointer promised "the quaternion leak" where
  `docs/deaths.md` now tells the HOLDER leak (reworded, its line count
  kept); `DeathCam.prepare` called the proxies "the PARENTS of the joints
  about to be disposed" (the joints are disposed of nothing now: the hazard
  is a slot holding a rig whose meshes are freed); `NetSoldier`'s "proxy
  nodes … the same nodes", "re-parenting a living body's joints" and "the
  body node"; `drawRig`'s doc calling `DeathCam.warm` "a frame of its own"
  (a warm-up frame gets `drawBodies` too; the call is redundant but
  harmless, Deviations). `SoldierRig.root` now says its own `enabled` is not
  the body's switch — `rig.enabled` through `setRigEnabled` is. One
  UNMEASURED cost, recorded below rather than fixed. Re-checked after the
  fixes: typecheck and build; `kit:hash --models --kinds soldier` at HEAD
  (the two rows above).
- **Owed onward.** X4.1b: the holder and the proxies, `freeze`'s hand-back
  and the forced proxy compose — which, the review notes, need not survive
  even as long as the proxies: `applyImpulse`'s forced
  `chest.proxy.computeWorldMatrix(true)` is there only for its translation
  row, so the proxy's own position rounded to float32 (`Math.fround` on each
  axis) answers the same point without a compose. The phone's FOLLOW-UP
  reading, as every step's since X3.3c. **And a cost the review saw and
  nobody has measured**: every enabled body is now composed SEVERAL times a
  frame — `drawRig`'s `compute`, up to two `ProxyBoxes.writeRig` computes
  (the body map's and the lamps' atlas's), and root chains for the measure
  and both packers — where Babylon composed each node once per render id
  and cached it; the reviewer's estimate is ~800 extra joint composes a
  frame at 24 a side. That phone reading, or an X0.3 at 24 a side on Sarab
  and Cinderhaven, is what reads it. **The fresh-compose invariant
  (`rigJoints.ts`' header) must not be undone to buy it back without a
  measurement** — a cached compose is how `ProxyBoxes` read 146 stale boxes
  before this step (the oracle, above); X4.1d's instancing is the natural
  place to compose a body once.

### X4.2 — Vehicles (PERF_PLAN A3) — **M** (decision)

- **Do:** hull segments (`vehicleRig`) as our meshes, `HullFlex`, the rotor
  and turret pictures. **Build A3's detail tier and draw distance here**; the
  detail set is the decision.
- **Contracts it keeps:**
  - the collider never tilts, and nothing on a hull that moves is pickable
  - a hull's shadow shape is its collider box
- **Verify:** the bank's hull vantages; X0.3 on Cinderhaven at 300 m.

### X4.3 — The viewmodel and the kit bay — **M–L**

- **Do:** `ViewModel` in its own ordered draw, with its pose stack unchanged:
  `applyFit`, the near plane at 0.05, eye relief, the reload and the bolt.
  Optics and finishes, including the `DynamicTexture`s it uses today. The kit
  screen's measured bay (`LoadoutScreen.stageBay`).
- **Read first:** the comment over `setRenderingAutoClearDepthStencil`
  (`VIEWMODEL_GROUP`) in `Game.ts`. `FrameDepth`, the ink and the glow all
  read the depth buffer the gun draws into, and the new draw must keep the
  same arrangement.
- **Verify:** the bank's viewmodel vantages, hip and aimed per optic; "the
  reticle cannot lie", checked by firing at a wall at range with each optic;
  the kit screen on a phone and a 32:9 window.

### X4.4 — The effect pools, and pipelines compiled at load — **M**

- **Do:**
  - The pools on our side: tracers, sparks, impact discs, bullet marks (a cel
    material in `WorldCulling`'s size gate today), `BlastFx`'s billows, the
    fires (`FlameMaterial`; their block merges are the one world surface
    besides glazing that X3.7 leaves a Babylon mesh in a round), grenades,
    rockets, mines, shards and debris.
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
| A3 vehicle detail tier | X4.2, built in the new renderer, not in Babylon |
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
| `CLAUDE.md`: the pipeline warm-up's body pose | X4.1d, X4.1e |
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
| X4.2 | Which hull parts drop at range (the tank's links and wheels, the MG rings)? | An art call; PERF_PLAN A3 measured +6.5% at 300 m on Cinderhaven. |
| X6.2 | Is it ready to merge to `develop`? | Only when X6.2's "Before" list passes in full. |
