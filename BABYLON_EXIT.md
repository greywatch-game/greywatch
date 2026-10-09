# BABYLON_EXIT.md — getting the game off Babylon.js, one landed step at a time

The plan for removing `@babylonjs/core` from the tree, written like
`ENGINE_UPGRADE.md` and `PERF_PLAN.md`: **to be handed to a coding agent one
step at a time.** Each step lands on the **`babylon-exit` branch**, leaves the
game on that branch shippable, and is proven by an oracle run against the
commit before it. `develop` does not see any of it until the whole exit merges
at X6.2.

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
| **2. The simulation off the scene** | sweeps, state, the server, Havok | `server/` and the simulation import nothing from Babylon (a build gate says so) |
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
   directories to it; X6.1 widens it to the whole tree.
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

Nothing in the game moves in this phase. Every later step is graded with what
it builds, so a gap here is a gap in every step after it.

### X0.1 — A reference bank that reproduces, and covers what will move — **M** — **LANDED** (9246a72)

**Landed.** The unpinned clock was the IRRADIANCE VOLUME's rolling sweep: it
converges per sweep (~72 frames), not per frame, and moved 7.4% of Greyfen's
pixels, up to 78/255, between two consecutive grabs. `freeze` now re-sweeps it
8 times at its warm budget after everything else is pinned, then holds it (1
sweep still leaves 6.4% off across processes). The cloud ring's turn and
Cinderhaven's storm were unpinned too and are now. The water, the grass and the
wind were already pinned, the flags' cloth is not stepped in `deploy`, and the
particles are off in the freeze. The bank went from 22 frames on six maps to 47
on seven. The new rows hold rigs at 6 m and 250 m, all three hull kinds, the
viewmodel hip and aimed for one weapon per optic, a blast in the air, a
see-through shopfront, a capture ring, Cinderhaven at night, and the blur in
flight beside each post setting off. Four rows had gone stale with the re-lays
and were re-posed. Every row now places the shadow maps, the lamps' atlas, the
water and the grass at its own eye. It was re-taken on 9.28 with the current
clouds, and `mode.json` now records the Chromium build, Playwright, the adapter,
the driver and the settings. **Measured:** two `--check` runs in a row, from two
separate shells, came back 47 of 47 at 0% of pixels and 0/255. `FINDINGS.md` 20
was fixed and deleted. The bank's README has a table of which rows serve which
exit step.

`FINDINGS.md` 20: the bank in `plans/webgpu-ref/` cannot reproduce a frame on
any map, is stale against the clouds and Babylon 9.28, and `ref/mode.json`
records nothing but the mode. It is the look oracle for all of Phases 3–5.

- **Read first:** `FINDINGS.md` 20; `plans/webgpu-ref/README.md`;
  `bank.mjs`, `vantages.mjs`, `diff.mjs`.
- **Do:**
  - Find what makes two consecutive grabs differ, and pin it the way the
    lantern's flicker and the cube probe were pinned. The finding's suspects
    are the water's swell (363eb8b) and the grass field (c0f17b1). Also check
    the wind, the clouds, the flags' cloth, the ash particles and the GI's
    rolling sweep.
  - Add vantages for what this plan will move, which the map views alone do
    not cover:
    - a rig up close and one at ~250 m
    - a hull from each kind
    - the viewmodel, hip and aimed, for one weapon per optic
    - a blast posed mid-flight (the pools' `warm` poses already do this)
    - water, see-through glazing, a backed pane
    - the night map
    - each post setting on and off
  - Re-take on the current engine, and say so in the commit as the README
    asks. Write the Chromium build and driver into `mode.json`.
- **Verify:** `bank.mjs --check` passes twice in a row on an unchanged tree,
  in the same session and in a fresh one.
- **Rewrites:** `FINDINGS.md` 20 (closed or narrowed),
  `plans/webgpu-ref/README.md`.

### X0.2 — Seeded randomness in the simulation (PERF_PLAN C1) — **S**

As `PERF_PLAN.md` C1 states it — `CombatSystem`'s spread cone,
`ConquestSystem`'s spawn choice and scatter, `VehicleCrew`'s aim onto seeded
`mulberry32` streams; visual-only draws may stay. **This plan adds two
requirements:**

- **The seed is per ROUND.** Normal play draws a fresh seed for each round; the
  benchmark and any replay pass a fixed one.
- **The round's seed is readable.** Once outcomes vary by seed, reproducing a
  bug needs that round's seed. Write it into the profiler capture and into a
  DEV-visible line, and let a URL override set it.

**Leave the bots' own streams as they are.** Each bot's movement stream
(`BattleSystem.ts`, `CONFIG.bots.skill.seed + team * 131 + i * 17`) and the
per-squad skill draw stay on their constant seeds. That is deliberate, the
code says so, and it does not affect the exit: the benchmark passes a fixed
seed either way. Whether bots' movement should vary between rounds is a
game-feel question for later (see "Decisions that are yours"). The skill draw
should stay constant regardless, because seeding it per round would make squad
strength, and so balance, a matter of chance.

- **Verify:** `npm run parity`; `npm run simulate`; a bot-only round run twice
  from one seed at a fixed `dt` reaches the same score and the same kill
  list.

### X0.3 — A benchmark that runs itself on any device — **M**

USB and wireless debugging both failed on the phone (`PERF_PLAN.md` P0), so
the benchmark must need no tooling: **a URL starts it, it plays itself, and it
ends in a profiler capture.**

- **Read first:** `docs/profiling.md`; `plans/webgpu-ref/gate.mjs` (its
  `--uncap` run is the nearest thing that exists); FINDINGS 32's warning about
  variation between sessions.
- **Do:** `?bench=<map>` (or a settings entry) that runs, in order:
  - the bank's vantages, eight headings each, held long enough to settle
  - one scripted camera path through the map's densest quarter
  - a bot-only round from X0.2's fixed seed, with the simulation stepped at a
    fixed `dt` whatever the wall clock does, so the same fight happens every
    run while the frame time is still real

  It ends in a `FrameProfile` capture with each segment labelled. A desktop
  wrapper script runs it N times and reports medians and ratios.
- **Verify:** three runs in one session on the Windows box agree within the
  protocol's ~8% on every segment. A phone run completes with nothing but the
  URL.

### X0.4 — The "before", then the targets — **S** (decision at the end)

The targets are set from measurements, not guessed ahead of them. A target set
blind can be out of the exit's reach whatever the exit does. At render scale
0.5 the phone is limited by its GPU (`FINDINGS.md` 50), and at 0.75 by
per-pixel shader cost (`FINDINGS.md` 13). The shaders port unchanged, so no
renderer rewrite moves either.

- **Do, first:** take the "before" with X0.3 on Sarab, Cinderhaven,
  Coldharbour and Greyfen, on the desktop, the phone and the tablet, several
  runs each. Do `PERF_PLAN.md` G1 here too, since the phone's GPU cost moves
  with the shaders, not the engine.
- **Output:** a `FINDINGS.md` entry with the tables. For each device, split
  the time into what the exit can move (draw calls, CPU time in the render)
  and what it cannot (GPU fill, the browser's floor), as far as the captures
  allow. Every later step quotes its numbers against this entry.
- **Then stop, and bring the user the tables.** The user writes the targets
  into this file. Each target names:
  - a device
  - a map
  - a render scale
  - a statistic: a p95 or the 1% low, never a mean (`FINDINGS.md` 1 found
    the mean at 60 while the slowest frames were at 28)

  For example: "p95 at or under 16.7 ms on the Sarab benchmark, Android
  phone, render scale 0.5".
- **Nothing needs the targets until X6.2's sign-off.** The X3.3 gate only asks
  whether any device's frame improved. So if the user is not ready to set them,
  the step still lands, and Phase 1 can start.

**Gate after Phase 0:** the bank and the benchmark both reproduce. If either
does not, no later step can claim it moved nothing or saved anything. Fix them
before going on.

---

## Phase 1 — Data off Babylon types

The cheapest phase and the one that pays most: the maps, the kit and the merge
stop depending on Babylon, and every oracle stays byte-identical.

### X1.1 — `src/math/`, and the world's data layer on it — **M**

- **Do:** A small vector, quaternion, matrix and colour module covering the
  methods the tree actually calls — a subset, with the same names, so the swap
  is an import change. **Name the vector class `Vector3`**: every map's
  `layout.ts` is generated text full of `new Vector3(`, the generators emit it,
  and the editor's `sourceScan` patches that text byte for byte. Move the
  world's data layer onto it:
  - `mapTypes`, `layout`, every map's `layout.ts`
  - `TerrainField`'s queries, `NavGrid`, `CoverMap`, `ObstacleField`
  - `RayWorld`, `boxGeometry`, `boxIndex`
  - `roads`, `roadPaths`, `leash`, `collision`

  Where that data meets a mesh, convert in one bridge file (`src/math/babylon.ts`,
  deleted in X6.1).
- **Must not:** convert the rendering side. It is rewritten later, and
  converting it twice is waste.
- **Verify:** `npm run parity`, `npm run simulate`, `kit:hash` and
  `merge:hash` identical, `drop.mjs --check`, and `simulate`'s tick times
  within noise. Babylon's `Vector3` dirties itself on every write, so plain
  fields may be faster; say which.

### X1.2 — Geometry as typed arrays: the `Build` layer and the kit — **M**

The kit makes 2,316 calls through its own layer (`Build`, `StoneBatch`,
`Mesher`, `Lapidary`, `Joinery`). About 30 call Babylon's vertex generators
directly, and there are 52 `.parent =` assignments.

- **Read first:** `parts.ts`, `kit/core.ts`, `docs/build.md` (the four places
  the build copies Babylon), `scripts/kit-hash.mjs`.
- **Do:**
  - Define a `GeometryBuffer`: positions, normals, uvs, uv2, colours, indices,
    as typed arrays, plus the metadata a part carries.
  - Write the primitive generators — box, cylinder, torus, icosphere,
    polyhedron, sphere — to produce **exactly** Babylon's vertex order,
    normals and UVs. Babylon is Apache-2.0, so they may be copied; keep its
    licence notice in the file header, and confirm the obligation before
    shipping.
  - Rewrite `parts.ts` and `kit/core.ts` to emit buffers. Replace each
    `.parent =` with a transform applied at emit time. Where Babylon meshes
    are still needed, a single adapter turns a buffer into one.
- **Verify:** `npm run kit:hash -- --against` identical for every kind, the
  drawing and the colliders both; `merge:hash` identical; `npm run collision`
  produces no diff.
- **Rewrites:** `docs/build.md` (the four copied internals start going away),
  `parts.ts`'s header.

### X1.3 — The rest of the geometry — **M**

The same for what is not in the kit:
- `weaponKit` and the seven weapon models, `optics.ts`
- `vehicleRig` and the three hull models
- `SoldierModel`'s geometry (the rig itself is X4.1)
- the grenade, molotov, rocket and mine models
- `flame.ts`, the capture zone's polyhedron, `fireDrum`'s torus
- `TerrainField`'s `VertexData`

- **First:** none of these is hashed today. Extend `kit:hash` with a models
  mode that fingerprints them, commit it, and only then convert anything.
- **Verify:** that new mode identical; `kit:hash` and `merge:hash` identical;
  the bank's viewmodel and hull vantages pixel-identical.

### X1.4 — The merge and the vertex bake on arrays — **M**

`PERF_PLAN.md` B1's "first job". `mergeByMaterial`, `BlockMerge`,
`PaneBlocks`, `writePaletteIndex`, the emissive palette and `vertexShading`
(AO, sway, wear, the world mark) run on `GeometryBuffer`s. What comes out is a
`WorldGeometry` record: per block, per material key, the arrays plus the
metadata `CLAUDE.md` makes a contract (`block`, `surface`, `noShadowCaster`,
`noGlow`, `noInk`). The adapter uploads Babylon meshes carrying identical
metadata, so `WorldCulling` and every reader of `metadata.*` are untouched.

- **Do also:** carry a **piece id** per vertex range through the merge, the
  `paneGroup` precedent. It costs nothing now, and destructible buildings need
  it.
- **Verify:** `npm run merge:hash` identical, shipped and `--editor`;
  `build:total` before and after on Greyfen and Coldharbour (typed arrays
  should be faster; say by how much). Three of the four Babylon internals
  `docs/build.md` lists should be gone. Name what is left.

---

## Phase 2 — The simulation off the scene

The server is the proof. When this phase ends, the authority runs without
Babylon, and a build gate keeps it that way.

### X2.1 — The three sweeps are ours (PERF_PLAN C2) — **L**

As `PERF_PLAN.md` C2 states it: an analytic swept capsule (or ellipsoid)
against `WorldBox`es, hull boxes and the terrain, over the buckets
`CollisionField` keeps, answering `castBody`'s question exactly. The feel is
the acceptance test, through the scripted comparison harness C2 describes.
Every divergence over a few centimetres is investigated, not averaged away.

- **Verify:** the comparison harness; `drop.mjs --check` on every map;
  `npm run parity`; a played round on foot and in each vehicle kind.
- **Rewrites:** `CLAUDE.md`, "Visual meshes and collider proxies" — "exactly
  three sweeps through `narrowedMove`" becomes the new primitive's rule;
  `CollisionField.ts`'s header.

### X2.2 — State off the nodes, and every mixed system split (PERF_PLAN C3) — **L**

As `PERF_PLAN.md` C3 states it — the player off its capsule, a hull's body
into fields, grenades and rockets as `{pos, vel}`, analytic muzzles, the
authority no longer posing rigs. **This plan adds the split**: every system
that both simulates and draws becomes two modules, a simulation module that
owns the state and a view module that reads it and never writes it. The likely
list:
- `CombatSystem` and its pools
- `GrenadeSystem`, `AntiTankSystem`
- `VehicleSystem` and `Vehicle`
- `BattleSystem` and `Bot` against the rig
- `Player`
- `GlassSystem`'s collapse

The step's first job is to confirm that list against the code. The view
modules are what Phase 4 moves; the simulation modules move onto `src/math/`
here.

- **Verify:** `npm run parity`, `npm run simulate`, `drop.mjs --check`, a
  netplay round, and the profiler's `world` phase on the authority before and
  after.
- **Rewrites:** `CLAUDE.md`'s forced-world-matrix rule (its server reason
  ends), `docs/game.md`.

### X2.3 — The authority without Babylon — **M**

- **Do:**
  - `buildServerWorld` builds from the bake with no meshes.
  - `HeadlessGame` has no `Scene` and no `NullEngine`.
  - Add a build gate, `scripts/check-babylon-free.mjs`, that walks the import
    graph from `server/` and fails on any path that reaches `@babylonjs/core`.
    Wire it into `npm run build` beside `check-deep-imports.mjs`.
- **Verify:** the gate; `npm run parity`; `npm run simulate` timings and
  `dist-server` size before and after; a two-client match on a map with
  armour.
- **Rewrites:** `CLAUDE.md`, "Multiplayer" (the server cannot run
  `MapBuilder` because it has no canvas; that stays true, but `NullEngine`
  goes), `docs/multiplayer.md`, `server/README.md`.

### X2.4 — Havok, called directly — **M**

`PhysicsWorld`, `RagdollSystem`, `DebrisSystem` and `BlastDebrisSystem` use
Babylon's plugin (`HavokPlugin`, `PhysicsBody`, `Physics6DoFConstraint`, …).
`@babylonjs/havok` is a standalone WASM with its own API, and the plugin is a
wrapper over it.

- **Read first:** `docs/deaths.md`; Babylon's `HavokPlugin` source, for the
  raw calls it makes.
- **Do:** the four clients against the raw API, writing poses into plain
  arrays that a view applies to the rig. Injection stays as `CLAUDE.md` states
  it: `Game` steps the engine and then its clients.
- **Verify:** `drop.mjs --check` on every map. In a real round: a bullet drops
  a body, a blast throws one, shards fall, rubble falls, and the pool evicts
  the oldest corpse when full.
- **Rewrites:** `docs/deaths.md`. The `scene.physicsEnabled` rule stays until
  the scene is gone.

### X2.5 — One simulation core (optional) — **L** (decision)

Not needed to leave Babylon, and cheapest right here, with both simulations
Babylon-free. `Game` offline and `HeadlessGame` on the authority become one
core; offline play runs it in-process, or in a Worker as `PERF_PLAN.md` C4
describes. This ends the class of bug where the two drift apart
(`paysKiller`, the capture awards). **Verify:** `parity`, `simulate`, the
scoring rules exercised offline and online.

---

## Phase 3 — Our renderer draws the static world

Babylon still owns the frame. Our module draws inside Babylon's passes through
the seam.

### X3.1 — The shared WGSL (PERF_PLAN B0) — **M**

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

### X3.2 — `src/render/`: device, pipelines, frame uniforms, and the seam — **M**

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
  - Add `src/render/` and `src/math/` to X2.3's gate.
- **Verify:** it draws nothing yet, so the bank shows no pixel moved; the gate
  passes; a DEV-only test draw shows up where expected and then comes out.
- **Must not:** import `@babylonjs/core`; reach an internal from anywhere but
  the seam.

### X3.3 — The static world's main pass (PERF_PLAN B1) — **L**

As B1 states it: clusters of ~128–256 triangles, a compute cull (frustum, the
fog reach `WorldCulling` walks to, the size gate), one `drawIndexedIndirect`
per material per pass, and the blocks taken out of `WorldCulling`'s main-pass
candidate list while their Babylon meshes live on for the other passes.

- **Contracts it keeps:**
  - a per-cluster block id for `ReflectionSystem.encloses`, plus X1.4's piece
    id
  - fog to `fogEnd`
  - `opaqueAlpha` 0 in the frame and 1 under a probe bake
  - the wind's ramp and rigged layers
  - every caster a closed shape
- **Verify:** `bank.mjs --check`; P0's census (main-pass draws); X0.3 on the
  desktop and the phone against X0.4's "before".

**Gate after X3.3 — the first number that says whether the renderer pays.**
If main-pass draws fall and no device's frame improves, stop and re-read this
plan with the user before X3.4. Leaving Babylon would still remove the bugs
and the upkeep, but the performance case would be gone, and the order of
everything after this point should be weighed again.

### X3.4 — Scatter as instances (PERF_PLAN B2) — **M–L** (decision)

As B2 states it: keep the seeded placement exactly; emit one source mesh per
(kind, variant, material, foliage rung) and a transform per placement.
Destructible props become a per-instance flag. The AO question B2 raises is
the decision.

- **Verify:** `kit:hash` (it hashes scatter over fixed seeds and rungs,
  rng-draw count included); `npm run collision` and `npm run parity`; the bank
  on Greyfen and Kurenai; X0.3.

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

The one step that touches `develop`. It is the user's to start.

- **Before:** merge `develop` into `babylon-exit` one last time and run every
  oracle on the result. X0.3 against X0.4's "before" must pass on every device,
  and the targets must be met or the shortfall written down. Play rounds on
  every map, offline and in a match, for long enough that you would ship it.
- **Do:** merge with `git merge --no-ff babylon-exit`, so the whole exit is
  ONE merge commit on `develop`. If it has to come out after landing,
  `git revert -m 1 <merge>` takes all of it out in one commit. That is the
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
| A5 occlusion culling | optional, after X3.3, in the compute cull; occluders skip `RayWorld.removed` |
| A6 snapshot rendering | dropped: it is a Babylon mechanism |
| B0, B1, B2, B3, B5 | X3.1, X3.3, X3.4, X3.6, X3.5 |
| B4 who owns the frame | decided: X5.4 |
| C1 | X0.2 |
| C2, C3 | X2.1, X2.2 |
| C4 Worker | optional, with X2.5 |
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
| `CLAUDE.md`: the frame walks the scene (`WorldCulling`) | X3.3 through X4.7 |
| `CLAUDE.md`: the glow | X3.6d, X5.2 |
| `CLAUDE.md`: visual meshes and collider proxies; exactly three sweeps | X2.1, X2.3 |
| `CLAUDE.md`: mesh metadata is a contract | X1.4 (moves to the geometry record), X3.3 onward |
| `CLAUDE.md`: the forced world matrix on the authority | X2.2 |
| `CLAUDE.md`: the server cannot run `MapBuilder` / `NullEngine` | X2.3 |
| `CLAUDE.md`: Havok and `scene.physicsEnabled` | X2.4, X5.4 |
| `CLAUDE.md`: the pipeline warm-up | X4.4, X5.4 |
| `CLAUDE.md`: a colour gradient changes a particle system's vertex layout | X4.7 (deleted) |
| `CLAUDE.md`: measuring a frame, the two roots | X5.4 |
| `docs/build.md`: the four copied Babylon internals, `merge:hash` owed per upgrade | X1.2, X1.4, X6.1 |
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
| end of X0.4 | The frame targets: device, map, render scale and statistic for each. | Set them from X0.4's tables, against what the exit can move. Needed by X6.2, not before. |
| X0.4 | Bring Sarab to final detail first, as a heavier "before"? | Optional. If yes, do it after X0.3 and take the "before" twice, once on each side of the rework. |
| X2.5 | One simulation core, offline and online? | Yes, here, while it is cheapest. |
| X3.4 | Scatter AO: baked per kind (cheaper, changes the look) or per instance? | Per kind, judged in the bank. |
| X4.2 | Which hull parts drop at range (the tank's links and wheels, the MG rings)? | An art call; PERF_PLAN A3 measured +6.5% at 300 m on Cinderhaven. |
| X6.2 | Is it ready to merge to `develop`? | Only when X6.2's "Before" list passes in full. |
