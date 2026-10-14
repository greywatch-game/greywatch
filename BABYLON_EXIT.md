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
| **3. The static world** | our renderer draws blocks, scatter and terrain, in every pass | Babylon builds no world mesh for a round |
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
  of the cell the mesh is filed in (`blockBoxOf`). So the cull reads no node.
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
    a timestamp pair of its own around the compute pass. **The whole-step
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
  the rest of it.
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

### X3.4 — Scatter as instances (PERF_PLAN B2) — **M–L** (decision) — **LANDED** (1a20232, X3.4b below)

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
- **X3.4a landed at 1a20232.**
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
    memory moves its frame). If the instanced draws ever cost there, they
    fold into one draw per recipe by vertex pulling; not built.
- **Verify:** `kit:hash` (it hashes scatter over fixed seeds and rungs,
  rng-draw count included) plus the replay check; `npm run collision` and
  `npm run parity`; the bank on every map, judged; the census; X0.3.

### X3.5 — Terrain and roads (PERF_PLAN B5) — **M**

As B5 states it: clusters, as the blocks. The floor carries the most
contracts:
- the road depth bias in the material cache key
- `ROAD_RANK` and the rest of the road ladder
- the turf
- `terrainBlock` agreeing across the three callers of `terrainPatches`
- the collider clone, which stays as it is

- **Verify:** the bank on every map, closest to the ground and on a road
  crossing; `merge:hash`; X0.3.

### X3.6 — The static world's other passes (PERF_PLAN B3) — **L, as four sub-steps**

Each sub-step lands on its own. Under rule 5, each pass's texture moves to our
side here, and Babylon's materials, which still draw the bodies and the rest,
sample a wrapped view of it.

- **X3.6a — the world's shadows:** both cascades, the foliage map and the
  lightning flash map (`ShadowSystem`, today a `ShadowGenerator` with a
  `DirectionalLight` per map). The texel snap (`core/shadowWindow.ts`), the
  back-face recording and "only re-render when the snapped focus moves" all
  hold.
- **X3.6b — the lamps' atlas:** `LocalShadows`' static faces.
- **X3.6c — the reflection bake:** `ReflectionSystem`'s probes, which draw the
  world from each probe with the probe's eye passed explicitly. That removes
  the class of bug 242b986 and a858c74 fixed: a `ReflectionProbe` never moving
  `scene.activeCamera`. The bake still drains behind the loading card.
- **X3.6d — the glow mask** for the emissive palette's static meshes
  (`GlowPass`; `shaders/EmissiveWorld.ts`).

- **Verify, each:** the bank; X0.3; and for X3.6c, the probe-eye harness that
  measured 242b986, run again.

**After X3.6:** Babylon builds no block, scatter or terrain mesh for a round.
Editor builds keep the old path until X5.3.

---

## Phase 4 — Everything else that draws

Each step takes one kind of draw off Babylon's scene, along with its view
module from X2.2. When the last one lands, Babylon draws nothing but the post
chain, and the frozen cel-material cache and its traps are deleted with
`CelMaterialFactory`'s Babylon half.

### X4.1 — Bodies (PERF_PLAN C6, A4) — **L**

- **Do:**
  - Our own joint hierarchy for `SoldierModel`'s rig, which today is a tree of
    `TransformNode` joints.
  - Living bodies drawn as instances fed from the simulation's state: 14 joint
    meshes × 48 bodies becomes 14 instanced draws or fewer.
  - `BodyShadows` from the proxy boxes (`core/proxyBoxes.ts`) on our side.
  - `NetSoldier`, the death cam's stand-in body, and corpses posed from
    X2.4's arrays.
  - **Build A4's fade here**: a screen-door dither at `bodyDrawDistance` and
    at the size gate's whole-body drop.
- **Contracts it keeps:**
  - a body is measured once and drops whole, its emissive with it
  - a rig's shadow shape is `RAGDOLL_BONES`
  - the local player casts nothing
  - the side a rig wears is chosen when it is built (`teamView`)
- **Verify:** the bank's rig vantages; X0.3 at 24 a side on Sarab and
  Cinderhaven; a netplay round; a blast throwing bodies.

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
    fires (`FlameMaterial`), grenades, rockets, mines, shards and debris.
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
    depth.
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
| A4 body fade | X4.1 |
| A5 occlusion culling | optional, after X3.3b, in the compute cull; occluders skip `RayWorld.removed` |
| A6 snapshot rendering | dropped: it is a Babylon mechanism |
| B0, B1, B2, B3, B5 | X3.1, X3.3 (a–c), X3.4, X3.6, X3.5 |
| B4 who owns the frame | decided: X5.4 |
| C1 | X0.2 |
| C2, C3 | X2.1, X2.2 |
| C4 Worker | X2.5b (decided 2026-10-10), its transport replaced by X2.5c (2026-10-11) |
| C5 Rust core | not in this plan |
| C6 dynamic draws | X4.1 |

## Contracts this plan rewrites

Each is rewritten by the step that breaks it, in the same commit.

| contract | step |
| --- | --- |
| `CLAUDE.md`: `compatibilityMode = false` is load-bearing | X5.4 (deleted) |
| `CLAUDE.md`: no deep static import, keep `optimizeDeps.exclude`; the two WASMs that never ship | X6.1 |
| `CLAUDE.md`: every cel material is frozen; `remember`; a vertex colour buffer gained after a first draw | end of Phase 4 (deleted) |
| `CLAUDE.md`: `shaderLanguage` is load-bearing; a declared sampler must be bound | X3.1, X5.2 (becomes a bind-group-layout rule) |
| `CLAUDE.md`: the two shadow maps; the lamps' atlas | X3.6a, X3.6b, X4.1 |
| `CLAUDE.md`: the frame walks the scene (`WorldCulling`) | X3.3c through X4.7 |
| `CLAUDE.md`: the glow | X3.6d, X5.2 |
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
| X4.2 | Which hull parts drop at range (the tank's links and wheels, the MG rings)? | An art call; PERF_PLAN A3 measured +6.5% at 300 m on Cinderhaven. |
| X6.2 | Is it ready to merge to `develop`? | Only when X6.2's "Before" list passes in full. |
