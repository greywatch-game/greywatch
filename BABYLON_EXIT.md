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

### X0.2 — Seeded randomness in the simulation (PERF_PLAN C1) — **S** — **LANDED** (08a52fd)

**Landed.** Every outcome `Math.random` decided now draws from a stream out of
`src/systems/RoundRandom.ts`: the spread cone, spawn choice and scatter, a
crew's lay, and also the player's recoil drift and flinch, since those move
where the player's rounds go. There is one stream per shooter, keyed by the
authority's slot for a bot and by hardstanding for a hull's cupola gun, so one
shooter's draws never move another's. Each side calls one `seedRound` per round
(`Game.buildRound`, `HeadlessGame.startRound`). Normal play draws a fresh seed;
`?seed=` and `npm run simulate`'s fourth argument fix one. The seed is in the
profiler capture (report version 12, shown in the viewer), on a DEV console
line, and in the match server's round log. In a match the client's capture
says null, because the seed is the authority's. The bots' movement streams
still use their constant seeds, but `BattleSystem.reset` now restarts them every
round. Without that, a seed reproduced only the first round of a session. The
skill draw is untouched. Pictures and sounds stay on `Math.random`. `simulate`
now prints `fight`, a hash over the whole kill list in order. **Measured:** from
seed 777, all seven maps (the four vehicle maps among them) printed one hash
for two rounds in each of two processes, and every board balanced. Seed 778 and
two fresh seeds printed different hashes. `npm run parity` passed on all eight
maps, `npm run build` passed, and `bank.mjs --check` passed with no pixel
moved. In a browser, `?seed=4242` reached two rounds in a row, the DEV line, and
the capture, with the player firing and bots fighting and no page errors.

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

### X0.3 — A benchmark that runs itself on any device — **M** — **LANDED** (6e2e7a9)

**Landed.** `?bench=<map>` (or `?bench` for the menu's map) builds the map and
plays three parts. First, the bank's vantages: one stop per position, eight
headings each. Second, a loop through the quarter with the most built ground,
which means collider boxes weighed by footprint, because a plain count picked
Hollowmere's dead-tree wood. Third, a bot-only round from seed 777: nobody is
seated, the player's body is dead, and a 45 s lead-in at nine steps a frame
gets the bots into contact before 45 s of fight is measured. Every bench frame
is the fixed 1/60 s step, so every device draws the same measured frames and
fights the same fight. The run ends in a capture on a HALTED ring, so `VIEW`,
`SAVE` and `TRACE` hand over the run and nothing after it. Every row of that
capture is labelled by segment (report version 13: `bench`, `segments`,
`series.segment`, and a table in the viewer), and it carries `FightHash`. The
page then goes back to its menu with the player's own map and tier. `bench` is
a new step state. The script and the bank's vantage table are a lazy chunk;
the table moved to `src/bench/vantages.ts`, which `vantages.mjs` re-exports.
`plans/webgpu-ref/bench.mjs` is the desktop wrapper. It also fixed a recorder
bug: arming mid-frame, which the settings toggle does, filed a row stamped 0,
so `window.seconds` read as the page's lifetime.

Three things the first version got wrong were found by the verify, and each
is now in `docs/profiling.md`'s "The benchmark":
- **A first look's GPU bill.** It surfaced, uncapped, as one 110-570 ms wait
  at a frame nobody can predict, which moved a vantage up to 71% between runs.
  Settles now end on quiet frames, and every stop is rehearsed before it is
  measured.
- **A GPU-bound frame arrives in bursts.** So the vantages are measured for at
  least 1,152 frames between them.
- **1920x1080 was too small to measure at.** A frame there is ~2.5 ms, which
  is pacing jitter. The wrapper defaults to the box's own 3440x1440.

**Measured:** the Windows box, headless and uncapped at 3440x1440, three runs
per map in one session. Every group on all seven maps agreed:

| map | vantages | path | fight | fight ms (median) |
| --- | --- | --- | --- | --- |
| hollowmere | 2.5% | 2.2% | 3.1% | 5.85 |
| greyfen | 0.7% | 0.4% | 1.3% | 7.12 |
| coldharbour | 2.1% | 0.5% | 0.2% | 7.33 |
| harrowmead | 0.6% | 0.3% | 2.3% | 5.98 |
| sarab | 0.7% | 1.4% | 0.5% | 11.14 |
| cinderhaven | 0.1% | 0.4% | 1.4% | 10.07 |
| kurenai | 0.4% | 0.7% | 5.4% | 5.98 |

Each figure is the spread of the mean across the three runs. Each map fought
one fight on every run. Of the individual vantage holds, only Coldharbour's
`avenue` was over 8%, at 8.8%. The last three rows were re-run after the
1,152-frame floor, which changes only maps with fewer than four stops.

**Not run: a real phone.** Nothing here can reach one, and X0.4 owes that run.
A phone-SHAPED run did complete with nothing but the URL: touch, a coarse
pointer, a 915x412 viewport at DPR 2.625 and the CPU throttled 4x. It came
back to the menu with the hand-off written, and its fight hash on Greyfen
matched the desktop's. `bank.mjs --check` passed and `npm run build` passed.

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

- **Do, first:** take the "before" with X0.3 on **Greyfen and Sarab**, on
  **the desktop and the phone**, several runs each. The two maps are the two
  ends of the game: Greyfen is small, 8 a side and has no vehicles; Sarab is
  large, 24 a side and has all three kinds. The two devices are the two ends
  of its settings:
  - **the desktop at MAX settings**: `bench.mjs --max`, which fails a run
    whose capture is not at the top of every ladder, uncapped at 3440x1440.
  - **the phone at minimal settings**: render scale 0.5, the 60 fps cap, every
    quality setting at its lowest, GI off. It runs from the deployed build
    (`develop` carries X0.1 to X0.3; see "The branch").

  Cinderhaven and Coldharbour were dropped (the user's call, 2026-10-09):
  Sarab covers Cinderhaven's size, roster and armour, and the steps that need
  either map (X1.x's build times, X4.2) take their own before and after. The
  tablet was dropped too: it is faster than the phone, so a target the phone
  meets says nothing more on the tablet.

  **Measure the phone WARM.** A player plays for more than a minute, and the
  phone slows as it heats: on Greyfen the runs after a cold first run took
  33-49% longer a frame, and the cold run slowed through its own 164 s
  (`FINDINGS.md` 52). So: one warm-up run
  that is thrown away, then the runs back to back, in the same screen state
  (installed app or fullscreen) and the same settings. Do `PERF_PLAN.md` G1
  where the device allows it; the phone's GPU cost moves with the shaders, not
  the engine.
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

**Met 2026-10-09, tagged `exit-phase-0`:** the bank 47 of 47 (X0.1), the
benchmark within 2.3% on the desktop and 4.5% on the phone's Sarab, and one
fight per map on both devices (X0.3, X0.4).

---

## Phase 1 — Data off Babylon types

The cheapest phase and the one that pays most: the maps, the kit and the merge
stop depending on Babylon, and every oracle stays byte-identical.

### X1.1 — `src/math/`, and the world's data layer on it — **M** — **LANDED** (ad863e7)

**Landed.** `src/math/` holds `Vector3`, `Quaternion`, `Matrix`, `Color3` and
`Color4`: the members of Babylon's classes that the tree calls (a TypeScript
compiler survey listed them), under the same names and signatures. Every body
is copied from Babylon 9.28 in the same order of operations, with Babylon's
Apache-2.0 notice in each header. The matrix stores float32 and keeps the
identity flag its shortcuts read, so the answers are the same bits.
`scripts/math-check.mjs` checks that. It runs every method in both libraries
on seeded inputs (zeros, negative zeros, right angles, identity-flagged
matrices), compares the results with `Object.is`, and fails when a member has
no test case. Each map's `layout.ts`, the eight generators that write those
files, `mapTypes`, `NavGrid`, `CoverMap`, `ObstacleField` and `RayWorld` now
use it. The rest of the list had nothing to move: `TerrainField`'s queries
take numbers, and its `VertexData` waits for X1.3. `layout`, `boxGeometry`,
`boxIndex`, `roads`, `roadPaths`, `leash` and `collision` imported no Babylon
math.

**What the types found, and what it costs later steps.** Babylon's vector
methods read `_x`, not `x`. Passing one of ours to a Babylon method therefore
produces NaN, with no error. The reverse fails too: a Babylon vector cannot
stand in for ours, because its `add` would be handed one of ours and read `_x`
from it. So every function that both sides call takes `Vector3Like` (it only
reads `x`, `y`, `z`) or `Vector3Ref` (it only writes, through `set`). A Babylon
vector satisfies both as it is. `RayHit` is generic over which library's
vectors it holds. Every copy from our math to Babylon's goes through
`src/math/babylon.ts`, the one file under `src/math/` that imports Babylon (Rule 6
names it). For now that is `toBabylon` at thirteen call sites and
`babylonRayHit` in the three systems that read a hit with Babylon's methods.
The file is deleted at X6.1, and each step that moves a caller off Babylon
removes that caller's use of it. Two crossings get past the types. The
editor's serializer recognises a position with `instanceof`, so `serialize.ts`
and the editor's new layout entries now use our `Vector3` (`CLAUDE.md`,
Conventions). A compiler scan for any of our values passed to a Babylon
declaration finds none; a planted one is caught. `npm run collision`
changed only the eight hash stamps, because the layouts' text changed and no
box did.

**Measured:**
- **math-check:** 1,440,000 comparisons, all identical. A sum with its terms
  reordered was planted, and it was caught.
- **kit:hash:** identical on every kind, for both the drawing and the
  colliders.
- **merge:hash:** identical on all eight maps, shipped and `--editor`.
- **parity:** passes on all eight maps.
- **drop.mjs --check:** identical on five maps, and on Greyfen at its banked
  2,400 steps. Harrowmead is "within tol" with the same hash on the parent, so
  that state predates this step. At the default 480 steps Greyfen does not
  settle, as its header says it won't, even though a run with no map named
  still includes it. (Fixed after this step landed: a bare `--check` now runs
  each map at its bank's count, and passes on all seven.)
- **simulate, seed 777:** two processes of three rounds on each side (before
  and after). Both sides fought the same fight (Greyfen `6ef4707c3c7a8414`,
  Sarab `c109c06104830c4a`), and tick times differ by at most 2%, which is
  within noise. The plain fields are neither faster nor slower here, because
  no vector on a hot path left Babylon's math in this step. Bots, bodies and
  hulls still hold Babylon's; X2.2 is where that question gets a real answer.
- **The benchmark at `--max`:** fought X0.4's fights (Greyfen
  `7ee089c174427e3d`, Sarab `1cab861b4ea23f7f`). Sarab's fight measured a 1%
  low of 16.8 ms against 17.2.
- **Generators and serializer:** every generator rewrites its layout byte for
  byte apart from the import line. (Sarab's file has one comment added by hand
  after generation, which the generator would drop.) The editor's serializer
  rewrites every untouched layout byte for byte.
- **A live round:** plays offline on Sarab and in a match on Greyfen, with no
  page errors.
- **`npm run build`:** passes.

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

### X1.2 — Geometry as typed arrays: the `Build` layer and the kit — **M** — **LANDED** (df89358)

**Landed.** `src/geometry/` holds `GeometryBuffer` and the six generators.
The buffer stores positions, normals, uvs, uv2, colours and indices as typed
arrays, with `VertexData`'s merge, transform and `ComputeNormals`. The
generators are box, cylinder, torus, icosphere, sphere and polyhedron. All of
it is copied from Babylon 9.28 operation for operation, with the Apache-2.0
notice in each header (the licence obligation is the notice, which is kept).
One rule came out of matching bits: **an array's type is its precision**.
Babylon keeps whatever array it is given. A merge whose first member is a
`Float32Array` rounds what it copies, and one whose first member is a
`number[]` keeps doubles. So a buffer holds a `Float64Array` where Babylon
held a `number[]` and a `Float32Array` where it held one, and never converts
between the two. `scripts/geometry-check.mjs` builds every generator both
ways over seeded options, runs merge, transform and normals against
`VertexData`'s, and compares every number with `Object.is`. It fails on an
export with no case.

`Build` and every scatter prop now make `Part`s (`world/parts.ts`): a buffer,
a local transform, a material and metadata, with the members a builder used
to touch on a mesh under the same names. **The 52 `.parent =` became data,
and the transform is applied at emit time, not at build time.** The
placement is set on a prop's ROOT after the builder returns, so the whole
transform is not known until `MapBuilder` places it. `flattenParts` runs
there. It composes each link into the part's own transform the way Babylon's
`setParent(null)` did, in the same float32 steps and in Babylon's child order,
because that order is the merge's vertex order. Composing at build time would
have needed an extra multiply by the placement, which moves bits. `partMesh`
is the one adapter into Babylon (`MapBuilder.structureMeshes`, `propMeshes`).
It hands back the arrays in the types Babylon held, by a loop, because
`Array.from` over a typed array cost +15% of a map build on its own. Scatter
builders no longer take a scene. Kit builders still do, for materials and
textures. Pulled forward from X1.3, because the kit uses them: `flame.ts`
(the molotov adapts it through `vertexDataOf`), `TerrainField`'s accumulator
(the roads are built from it, and the terrain patches with them), and the
fire drum's torus. `kit:hash` now hashes a prop after `flattenParts`
(713bdcd, committed before any conversion, and the baseline for this step).

**Measured:**
- **geometry-check:** 33,000 comparisons, all identical. A planted constant
  in the icosphere was caught. Past ~3,000 trials Node runs out of heap. The
  leak is Babylon's `CreateSphereVertexData` (1,588 MB against our 67 over
  3,000 calls).
- **math-check:** 1,520,000 comparisons, identical, with the four `Vector3`
  members the generators added.
- **kit:hash:** identical on all 3,722 builds of 105 kinds, drawing and
  colliders. A planted flatten error moved palm and pine and not cottage.
- **merge:hash:** identical on all eight maps, shipped and `--editor`, before
  and after the copy fix.
- **`npm run collision`:** no diff. **parity:** passes on all eight maps.
- **simulate, seed 777:** fought X1.1's fights (Greyfen `6ef4707c3c7a8414`,
  Sarab `c109c06104830c4a`).
- **The benchmark at `--max`:** played both rounds to the end and fought
  X0.4's fights (Greyfen `7ee089c174427e3d`, Sarab `1cab861b4ea23f7f`). One
  run each, so no frame figure is quoted. The scene is the same geometry by
  `merge:hash`.
- **`build:total`**, median of 5 per side, parent / this step / parent again:
  Greyfen 9,932 / 10,047 / 9,840 ms, Coldharbour 3,587 / 3,599 / 3,541. That
  is +1-2%, inside the 8% bar. The placement phase is +11-13% (~140 ms), which
  is the adapter's copies. X1.4 deletes them.
- **What was not run:** a live match against `server/`. Its one change is
  that the terrain patches go through `vertexDataOf`, which parity exercises.
- **`npm run build`:** passes.

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

### X1.3 — The rest of the geometry — **M** — **LANDED** (3bcaca7)

**Landed.** The oracle came before any model moved: `kit:hash --models`
(9b76260) builds every model that is not the kit under a NullEngine, 244
builds of 20 kinds, and
hashes every mesh AND transform node left in the scene, each vertex array with
its TYPE and as exact doubles. It keeps two hashes a build, one in scene order
and one over the sorted records, so `--against` can tell "content changed"
from "scene order differs". The foundation (31c672a) added
`mergeTransformed` to `src/geometry/buffer.ts`, which is
`VertexData._mergeCoroutine`, the merge `Mesh.MergeMeshes` runs. Each member is
transformed INSIDE the merge, after it has been copied into the first member's
array type, so "transform, then merge" rounds at the other end and is not the
same bits. It also added `GeometryBuffer.bake` (`bakeTransformIntoVertices`,
which renormalises where a merge does not), and `createPlane` and `createDisc`
for the optics' glass. `world/parts.ts` gained `PartNode` (a build frame that
draws nothing, standing where a model hung a `TransformNode`), `detachPart`
(`setParent(null)`, now the step `flattenParts` runs), `mergeParts`,
`bakePartTransform`, and `drawnMesh`, the one adapter a model's surface
becomes an uploaded Babylon mesh through. Then `facet.ts` (754ef99) was
converted, with a temporary `drawnMesh` bridge at each caller, and the three
families in parallel: the hulls (01b0fad), the soldier, the capture ring and
the flag's pole (1c2b6ab), and the weapons, optics, the viewmodel's arms and
card, the player's petals and casings and the four thrown or laid things
(b992968). Every family removed facet's bridges in its own files. Every model's
geometry is now ours. Its merges run on buffers, and its live joints are still
Babylon `TransformNode`s (the rig is X4's). What is left on `MeshBuilder` is
there on purpose. The player's capsule and a hull's box are colliders, and the
sweeps are X2.1's. The rig's root capsule is what `WorldCulling` measures a body
by and goes with the rig at X4.1. The flag's cloth is a live simulation with
updatable buffers.

**Scene order moved and no pixel did.** The weapons family came back with 201
builds (every gun, the launcher, the viewmodel, the player) "scene order
differs" and no content change, for two reasons. First, a lone colour group's
mesh is now minted at merge time and not when its one part was made: the
magazine's rubber on five guns and the sleeve on all 19 arms. Second, Babylon's
`removeTransformNode` is a swap-remove, so disposing the old pivots used to
shuffle the last live nodes into their slots. The hulls keep the old order on
purpose (`vehicleRig.mergeByColor` mints lone colours first). A transform
node's order draws nothing. A mesh's order is the opaque draw order, which the
bank judged.

**Measured:**
- **kit:hash --models:** no content change on any of the 244 builds. 43 are
  identical, and 201 differ in scene order only, for the two causes above.
- **The bank, `--check` on Harrowmead, Sarab and Hollowmere:** every row is at
  0% of pixels and 0/255. That covers the ten viewmodel rows (each optic, hip
  and aimed), the three hulls, both rigs and the ring. The same check passed
  before the conversion.
- **geometry-check:** 55,548 comparisons over 14 cases at 3,000 trials, all
  identical. Three plants were caught: no first-member flip, no renormalise in
  `bake`, and no transform on a float32 first member.
- **kit:hash:** identical on all 3,722 builds, drawing and colliders.
- **merge:hash:** identical on all eight maps, shipped and `--editor`, against
  2fc1286.
- **parity:** passes.
- **simulate, seed 777:** fought X1.1's fights (Greyfen `6ef4707c3c7a8414`,
  Sarab `c109c06104830c4a`). The server builds the rigs and the hulls too.
- **gate.mjs:** a real round on Harrowmead and Sarab is clean.
- **`npm run build`:** passes.

The same for what is not in the kit:
- `weaponKit` and the seven weapon models, `optics.ts`
- `vehicleRig` and the three hull models
- `SoldierModel`'s geometry (the rig itself is X4.1)
- the grenade, molotov, rocket and mine models
- the capture zone's polyhedron (`createPolyhedron` exists and is checked)

(`flame.ts`, `fireDrum`'s torus and `TerrainField`'s `VertexData` landed with
X1.2, because the kit and the props are built from them.)

- **First:** none of these is hashed today. Extend `kit:hash` with a models
  mode that fingerprints them, commit it, and only then convert anything.
- **Verify:** that new mode identical; `kit:hash` and `merge:hash` identical;
  the bank's viewmodel and hull vantages pixel-identical.

### X1.4 — The merge and the vertex bake on arrays — **M** — **LANDED** (3b35779)

**Landed**, in seven commits graded one at a time:
- **C0** (0879ffe): `merge:hash` sees what an upload at the end could get wrong. Each mesh's `sceneRank` (its creation order), `positionUpdatable`, `hasVertexAlpha` and `frozen` are recorded. So are the `panes`, the `paneGroups` and each editor item's visuals.
- **C1** (68e7a8e): `kit:hash` hashes Parts directly.
- **C2** (4992dbe): the bake's core runs on arrays (`shadingContext`, `takesShading`, `shadeVertices`). The dead child walk left over from the ink twins was deleted.
- **C3** (ddad7e5): the merges run on `WorldSurface`s (`worldGeometry.ts`). `mergeByMaterial`, `BlockMerge`, `PaneBlocks` and `paneGroup` all use `mergeParts` and `bakePartTransform`. The palette is written into the buffer. A merged mesh is made in ONE place: `worldMeshes`, the adapter, which uses `drawnMesh`.
- **C4** (080cff0): the floor and the rim become surfaces (`Ridge.ts` returns a `GeometryBuffer`). The bake runs on the surfaces before the upload. `GameMap.world` is the record: one `SurfaceRecord` per visual with its name, material, metadata, block, pieces and counts. Its arrays are released as each mesh is made, so the CPU holds the world's geometry once.
- **C5** (f4d9b4b): the part mesh is deleted (`partMesh`, `partSurface`, `uploadPart`, `bakePart`, `setPartVerticesData`, `structureMeshes`, `propMeshes`), and so is the mesh form of `writePaletteIndex`. `shaders/` no longer imports `world/`.
- **C6** (3b35779): each surface carries its PIECE ranges (a piece is a layout item, from the `GameMap.world.pieces` table) through every merge, and a DEV assertion checks that they tile each surface exactly.

The design came from a survey first, and two of its rules were what the bits turned on:
- **A survivor's creation order is part of the picture.** `WorldCulling` hands candidates in scene order, and that order reaches the glow mask and the transparent tie-breaks. So every surface is minted a `born` number where Babylon used to make its mesh (a part on admission, a merge of two or more when it runs, a merge of one inheriting its member's), and the adapter makes the meshes in that order. List order is not creation order: Hollowmere differs on 91 of 135 visuals.
- **The floor's collider clone still shares its arrays with its ground** through a per-build memo (`PlainArrays`).

**What is left between the world and Babylon is public API in two places:**
- the adapter, through `VertexData.applyToMesh` and `Mesh.setVerticesData`;
- the colliders, through `MeshBuilder.CreateBox` and `Mesh.MergeMeshes`. Since X2.1 nothing that moves or shoots reads them: they remain only for the editor's centre-screen pick on the client, and as an inert mirror on the server, which X2.3 deletes.

All three internals `docs/build.md` listed are gone. `geometry-check` is now the only caller of `_mergeCoroutine`, as the reference our copy is checked against. A Babylon upgrade now owes geometry-check, math-check, then `merge:hash` (`docs/build.md`).

**Measured:**
- **merge:hash:** identical on all eight maps, shipped and `--editor`, after every commit from C2 on, against C0's baselines: every field, including `sceneRank`, the pane ranges and their updatability, and the editor items. No `info` line moved.
- **The piece assertion:** holds on all eight maps in both modes, and a planted bad offset was caught. Pieces per map, table entries / shipped ranges / editor ranges: Greyfen 809 / 2,202 / 3,586, Coldharbour 313 / 690 / 2,098. Every editor surface is one piece, and the widest shipped surface (Harrowmead) spans 170.
- **kit:hash:** identical on all 3,722 builds. **kit:hash --models:** identical on all 244.
- **geometry-check and math-check:** clean.
- **`build:total`, median of 5, parent / this step / parent again, one session:**
  - Greyfen: 13,652 / **8,875** / 13,559 ms, **-35%**.
  - Coldharbour: 4,433 / **2,996** / 4,368 ms, **-32%**.
  - Where it went, on Greyfen: placements 1,311 to 564 ms, scatter 5,935 to 3,117, the block merge 2,990 to 703, and the bake 2,881 to 1,893.
  - What it now costs: the new `upload` phase, 2,137 ms. That is the adapter's `number[]` copies and the device upload, and it is the next thing to take (`FINDINGS.md` 26).
  - The same session also cleared X1.3: X1.2's commit measured 13,598 and 4,446 ms against X1.3's 13,652 and 4,433.
- **The bank, `--check`:** all 47 rows on all seven maps at 0% of pixels.
- **parity:** passes.
- **simulate, seed 777:** fought X1.1's fights (Greyfen `6ef4707c3c7a8414`, Sarab `c109c06104830c4a`).
- **gate.mjs:** a real round is clean on all seven maps.
- **`npm run build`:** passes.

`PERF_PLAN.md` B1's "first job". `mergeByMaterial`, `BlockMerge`,
`PaneBlocks`, `writePaletteIndex`, the emissive palette and `vertexShading`
(AO, sway, wear, the world mark) run on `GeometryBuffer`s. What comes out is a
`WorldGeometry` record: per block, per material key, the arrays plus the
metadata `CLAUDE.md` makes a contract (`block`, `surface`, `noShadowCaster`,
`noGlow`, `noInk`). The adapter uploads Babylon meshes carrying identical
metadata, so `WorldCulling` and every reader of `metadata.*` are untouched.
X1.3 left the merge it needs in place: `mergeTransformed` is
`VertexData._mergeCoroutine`, checked by `geometry-check`, and the models
already merge with it (`mergeParts`).

- **Do also:** carry a **piece id** per vertex range through the merge, the
  `paneGroup` precedent. It costs nothing now, and destructible buildings need
  it.
- **Verify:** `npm run merge:hash` identical, shipped and `--editor`;
  `build:total` before and after on Greyfen and Coldharbour (typed arrays
  should be faster; say by how much — X1.2's adapter costs ~140 ms of
  Greyfen's placement phase in copies this removes). X1.2 took the fourth
  internal `docs/build.md` listed; of the three left, the merge's two should
  be gone. Name what is left.

**Gate after Phase 1:** `kit:hash` and `merge:hash` identical, and no pixel
moved.

**Met 2026-10-10:** `kit:hash` (3,722 builds), `kit:hash --models` (244, no
content change), `merge:hash` on all eight maps shipped and `--editor`, and
the bank 47 of 47 at 0% of pixels at 3b35779. **Tagged** by the user on
2026-10-10: `develop` merged in at 09e35f8 (it carried one commit, a7b58ea,
whose content was already here), and `exit-phase-1` is that merge.

---

## Phase 2 — The simulation off the scene

The server is the proof. When this phase ends, the authority runs without
Babylon, and a build gate keeps it that way.

### X2.1 — The three sweeps are ours (PERF_PLAN C2) — **L** — **LANDED** (b7607c3)

**Landed** 2026-10-10, on the user's play-test: a round on foot and in all
three vehicle kinds, and "everything feels good". Four commits:
- **C1** (d11ba15): `src/world/ellipsoidSweep.ts`, Babylon 9.28's
  `moveWithCollisions` ported against each `WorldBox`'s twelve triangles,
  `RayWorld.bodyNear` as its candidate list, and the oracle
  `scripts/sweep-check.mjs`. Nothing wired.
- **C2** (869bddc): `CollisionField` rewritten over `RayWorld`. The player,
  a driven hull and a coasting wreck move by it on both sides. `narrowedMove`,
  its forced world matrix, `CollisionField.movers` and
  `scene.collisionsEnabled` are gone. Static boxes are ranked in the client's
  collider-mesh order, derived from `boxGroups` on both sides.
- **C3** (0372808): the contracts and docs below, and the collision bakes
  regenerated for `boxGroups`' new header text.
- b7607c3: the DEV sweep-order assertion made a module function, so a
  production bundle drops it whole.

**Why a port and not a new analytic sweep.** The feel is the acceptance test,
and every push-out, the hull's offset sphere and its climb band were tuned
against Babylon's response loop. A difference that starts at the last bit can
pick the other triangle of a tie and slide somewhere else, so the port keeps
Babylon's arithmetic, quirks included: back faces are tested (the default
material meant Babylon's cull never ran in this game), and the 1 mm
write-back is kept.

**Where it differs from the text above:**
- **The candidates come from `RayWorld`'s grid** (`bodyNear`), not from a grid
  `CollisionField` keeps. One index, so a hull (`rays.hulls`) and a broken pane
  (`RayWorld.remove`) leave every ray and every sweep in one write.
  `CollisionField` holds no geometry of its own.
- **The terrain is not swept**, as it never was. Vertical placement is the
  ground probe's.
- **The candidate list is checked against the path the centre took.** A sweep
  that outran it is re-gathered at the reach it needed (three times, then the
  whole map).

**Three deliberate differences from what shipped**, named in
`CollisionField.ts`'s header. All three matter only on knife edges at embedded
starts:
- the start is the body's own float64 position, where Babylon read the float32
  world matrix;
- a merged scatter cluster's triangles round as a mesh of their own did;
- a hull is swept where it IS. Babylon read a stale world matrix on a client,
  and on the authority possibly the origin.

**Measured:**
- **sweep-check, exact** (one mesh per box in the client's order, Babylon's
  float32 start, the production gather): 56,000 of 56,000 bit-identical over
  the seven maps; 44-73% of samples blocked. Ours takes 10-33 us a move, against
  Babylon narrowed to the same boxes at 13-80 us and its whole walk at 52-524.
- **sweep-check, `--tight`:** the same 56,000, with 104,118 re-gathers and
  52,069 whole-map fallbacks. In C1 a reviewer forced the redo on 93% of
  samples and it stayed 8,000/8,000.
- **sweep-check, shipped** (the client's real merged scene, float64 starts
  both sides): 40,345 of 56,000 within 1e-9, 90 over 1 mm. Every one of the 90
  is an embedded start on a knife edge or merged-cluster rounding; 0
  unexplained.
- **sweep-check, walk** (700 chained fixed-step trajectories): the player never
  drifts past 7 mm. Hulls pinned on box edges at those same knife edges drive
  apart open-loop. Of the six worst, traced: three were merge rounding, three
  were the start, none were ties.
- **simulate, seed 777:** Greyfen fought X1.1's fight (`6ef4707c3c7a8414`). The
  armour maps' fights changed: Sarab `dd2ee4abacfda2fe`, Coldharbour
  `81e262436c7af253`, Harrowmead `6c61e93be2cffcbc`, Cinderhaven
  `0e09b2c0616d9fa7`. Every change is attributed: with a float32 start, ours
  fights the parent's own Babylon fight exactly once the parent is given
  unmerged clusters and fresh hull matrices.
- **parity:** passes on all eight maps.
- **drop.mjs --check:** identical on six maps. Harrowmead is "within tol", as
  it has been since X1.1.
- **gate.mjs:** a real round on all seven maps is clean.
- **A netplay round on Coldharbour**, on foot and driving into a building:
  client and authority agree to 0.000 m. No body correction in ~640 uploads,
  and no hull correction in 391 drive samples without bots. A drive refused
  for speed after a long frame was found on the way and is pre-existing
  (`FINDINGS.md` 54).
- **`npm run build`:** passes.

**Rewritten:** `CLAUDE.md` ("Visual meshes and collider proxies", and the
hull's line in "Vehicles"), `CollisionField.ts`'s header, `docs/vehicles.md`,
`docs/multiplayer.md`, `docs/editor.md`, `docs/world.md`, `docs/build.md` (the
sweep is a copied Babylon internal; `sweep-check` is owed by an upgrade),
`FILES.md` and `VERIFYING.md`. The collision bakes were regenerated for the
new `boxGroups` header text.

**The play-test** (the user's, 2026-10-10): on foot and in the tank, the truck
and the helicopter — everything feels good.

As `PERF_PLAN.md` C2 states it: an analytic swept capsule (or ellipsoid)
against `WorldBox`es, hull boxes and the terrain, over the buckets
`CollisionField` keeps, answering `castBody`'s question exactly. The feel is
the acceptance test, through the scripted comparison harness C2 describes.
Every divergence over a few centimetres is investigated, not averaged away.

- **Verify:** the comparison harness; `drop.mjs --check` on every map;
  `npm run parity`; a played round on foot and in each vehicle kind.
- **The played round is the USER's** (decided 2026-10-10). The scripted
  comparison and the automated checks do not land the step on their own: when
  they pass, stop and hand the user a build to play on foot and in all three
  vehicle kinds, and land only on their word.
- **Rewrites:** `CLAUDE.md`, "Visual meshes and collider proxies" — "exactly
  three sweeps through `narrowedMove`" becomes the new primitive's rule;
  `CollisionField.ts`'s header.

### X2.2 — State off the nodes, and every mixed system split (PERF_PLAN C3) — **L** — **LANDED** (11f731f)

**Landed** 2026-10-10, after a five-way code review whose findings are
11f731f. Every system that simulated and drew is now two modules: the
SIMULATION keeps the old name, holds its state on `src/math` and imports
nothing from Babylon; its VIEW sits beside it, reads it and never writes it;
`Game` builds both and wires them; the authority builds the simulations only.
CLAUDE.md "Ownership and wiring" states the rule. The list, confirmed against
the code:

| simulation | view |
| --- | --- |
| `CombatSystem` (the shot, `onRound`) | `CombatFx` (tracers, sparks, discs, `BulletMarks`) |
| `GrenadeSystem`, `AntiTankSystem` (`pos`/`vel` fields, `onBlast`) | `GrenadeFx`, `AntiTankFx` (shared with `NetGrenades`/`NetOrdnance`) |
| `GlassSystem` (`onBroken`, `onCleared`) | `GlassFx` (the collapse, the collider's editor flags) |
| `Bot`, `BattleSystem` (`shown`, `life`, `poolVersion`) | `BotRig`, `BattleView` (the rig pool, LOD, flashes) |
| `Vehicle`, `HullSprings`, `VehicleSystem` (`HullPose`, `HullPicture` events) | `VehicleView`, `HullWhips`, `VehicleViews`; `vehicleModels.ts` beside the Babylon-free `vehicleKinds.ts` and per-kind frames |
| `Player` (`mid`, `ellipsoid`, `PlayerPicture` events) | `PlayerView` (viewmodel, flash, brass) |
| `ConquestSystem` | — (it drew nothing) |

Commits: C1 3075f89 (the shared `Hittable`/`Combatant` contract reads either
library's vector; `takeDamage` and the cross-system callbacks are PROPERTIES so
`strictFunctionTypes` checks them; `hullSeats.ts`, `blocks.ts`), C2 97e966f,
C3 54415ed, C4 d4678d5, C5 af2fc79 + 4ee3066, C6 f327ca9, C7 2ba6f69,
C8 96adb2b, C9 8f1d287, C10 242cdd8, C11 1ce7529, review 11f731f.

**No outcome reads a node any more.** The bot's muzzle (`soldierPose.ts`'s
`soldierMuzzleToRef`) and the hull's three (`hullFrame.ts`) replay Babylon's
forced float32 node chain from fields. Babylon's `computeWorldMatrix(true)`
forces every ancestor (`transformNode.pure.js` ~1003), so there was no stale
matrix to model. The hull's 1e-5 pose guards are simulation state
(`HullPose`), because the nodes trailed the fields by them. CLAUDE.md's
forced-world-matrix rule became its converse.

**One named fight change, C6.** The authority posed only bots within 35 m of
the map centre, and offline the camera decided; an outcome may not depend on
the camera. Every live bot's pose is now filled each frame (solved on demand).
New hashes at seed 777, held from C6 to the end: Greyfen `fc958d7e0d0e65c1`,
Hollowmere `1c14cd10dad9cead`, Coldharbour `da7b7d7ed3355f4f`, Harrowmead
`c5650f9f2ba94654`, Sarab `d13d7fe62cf059e5`, Cinderhaven `d0519088626918ec`,
Kurenai `471b692bc45bc1be`. The parent with every bot forced to animate fights
these exact seven fights, so the change is the pose and nothing else.

**Measured:**
- **simulate, seed 777:** every other commit held its parent's seven hashes
  (baseline f6a9d56: Greyfen `6ef4707c3c7a8414`, Hollowmere
  `50368db11f538d0f`, Coldharbour `81e262436c7af253`, Harrowmead
  `6c61e93be2cffcbc`, Sarab `dd2ee4abacfda2fe`, Cinderhaven
  `0e09b2c0616d9fa7`, Kurenai `9f3486e3b7e07880`).
- **Equivalence of the replayed muzzles:** bots 28,913 server reads and 157
  live, 0 mismatches (`Object.is`); hulls 300,000+ server reads over four maps
  and three seeds plus live driving of all three kinds, 0 mismatches.
- **The player's movement replay** (fixed-step, fixed input, walls, stairs,
  roofs, push-out, broken panes, boarding): 81,433 steps over Greyfen,
  Coldharbour and Sarab, bit-identical to the parent.
- **The authority** (median of 3 interleaved runs; C6 changed the fight, so
  compare per tick): tick p50/p95 flat on Sarab (0.110/0.172 → 0.113/0.170 ms)
  and Cinderhaven (0.104/0.170 → 0.104/0.161); peak RSS down 12-16% (Sarab
  483 → 405 MB); `dist-server` JS 5.03 → 4.59 MB. It builds no rig, no hull
  model, no pool and no material.
- **The server's import closure:** 263 modules with 104 importing Babylon
  directly, down to 136 with 4 — `HeadlessGame` (its `Scene`/`NullEngine`),
  `parity.ts`, `world.ts` and `world/parts.ts`, which X2.3 removes.
- **parity**, **build**, **gate.mjs** on all seven maps, **bank.mjs --check**
  (47 rows, 0%), **sweep-check** (exact, `--tight`, shipped) identical to the
  parent, **kit:hash --models** identical but for the rig fields and the
  player capsule that moved out on purpose.
- **Netplay** (a scripted two-client match plus a raw observer, Coldharbour
  botless and Sarab with bots): green throughout; client and authority agree on
  tickets every tick and on the board at a common tick; 0 hull corrections.

**Review findings fixed (11f731f):** a bot respawned and killed in one frame
stood up as a corpse (`BotRig.syncLife`), and a wreck painted a frame late
(`HullPicture.wrecked`); both were reproduced, then fixed. Plus `HullWhips`
sized from the kind's antennae, dead editor-pick flags on the hull body, and
the stale text.

**Found on the way** (`FINDINGS.md`): 55 — offline, the local player's
grenade and rocket START POINTS are read off the viewmodel's nodes, so a
drawing still decides those two outcomes; 56 — long sprints in a netplay round
collect `speed` corrections, cause not identified. `Player` still drives its
`ViewModel` through `PlayerPicture.model` (no outcome reads it); X2.5 must
settle both before the local player is split from the core.

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

### X2.3 — The authority without Babylon — **M** — **LANDED** (8a4831d)

**Landed** 2026-10-10: 3f69200, and the review's fixes 8a4831d.
- **`buildServerWorld(def)`** builds from the bake with no mesh and no scene;
  `GameMap.colliders`/`terrainColliders` are empty on the authority (every
  reader is a client view). **`HeadlessGame` and `parity.ts` have no engine.**
  `dist-server` imports no `@babylonjs` at all — before, the SSR build had left
  Babylon EXTERNAL and loaded it from `node_modules` at runtime.
- **The gate**, `scripts/check-babylon-free.mjs`, runs in `npm run build`
  after `check-deep-imports.mjs`. Roots: every file in `server/` plus the
  eleven simulations of X2.2's table, named one by one (so `Player`, which the
  server never reaches, is covered for being a simulation). A new simulation
  joins `SIMULATIONS` in the commit that creates it (CLAUDE.md "Ownership and
  wiring"). It skips only erased imports, counts `export … from` and
  `import()`, and FAILS on what it cannot follow: a computed `import()`,
  `import.meta.glob`, an unresolvable relative path; the package reached by a
  relative path into `node_modules` is caught by the resolved file.
  `DIRECTORIES`/`NOT_ROOTS` are where X3.2 adds `src/render/`, `src/math/` and
  the `src/math/babylon.ts` exception. Each refusal was proved with a probe and
  reverted. **`vite.server.config.ts`'s `no-babylon` plugin** is the same rule
  at the bundler (`enforce: "pre"`, before Vite marks a dependency external),
  so `build:server` and `simulate` refuse too.
- **`sweep-check --reference server`** rebuilds the old server scene itself
  (clusters first, then each ungrouped box); every mode identical to the parent.

**Measured** (median of 3 interleaved `simulate <map> 1 1 777` runs, d0fa2b7 →
3f69200):

| map | world build ms | tick p50 / p95 / p99 ms | peak RSS MB |
| --- | --- | --- | --- |
| Sarab | 623 → 461 | 0.112/0.166/0.270 → 0.112/0.171/0.282 | 406 → 132 |
| Cinderhaven | 931 → 761 | 0.103/0.157/0.248 → 0.102/0.157/0.259 | 468 → 237 |
| Greyfen | 262 → 171 | 0.024/0.041/0.071 → 0.024/0.042/0.082 | 315 → 101 |

- **Server boot** (to listening): 1.42-1.47 s at 190 MB → 72-76 ms at 57 MB.
- **p99 rose ~0.01 ms** (Greyfen +15%, over the noise bar): the smaller heap
  runs ~6x the young-generation GCs (56 → 370 on Greyfen), and
  `--min-semi-space-size=16` halves the gap. Left as it is; the p50 and p95 did
  not move.
- **simulate:** the seven C6 hashes on every map. **parity**, **build**,
  **sweep-check** (every mode, both references) identical. **Netplay** (the
  scripted two-client match): Coldharbour botless with B driving, and Sarab with
  bots, both green — tickets every tick, the board at a common tick, 0 hull
  corrections.

**Rewritten:** CLAUDE.md ("Ownership and wiring", "Multiplayer", the
`terrainBlock` row), `docs/multiplayer.md`, `server/README.md`,
`docs/build.md` (the gate), `docs/world.md`, FILES.md, VERIFYING.md, and the
headers of `check-deep-imports.mjs`, `bake-collision.mjs`,
`vite.server.config.ts`, `HeadlessGame`, `world`, `parity` and the world data
modules.

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

### X2.4 — Havok, called directly — **M** — **LANDED** (823906c)

**Landed** 2026-10-11, after a two-way review whose fixes are f60ae44 and
823906c. Babylon's `HavokPlugin` is gone: `src/systems/havok.ts` is the one
dialect over `@babylonjs/havok`'s raw `HP_*` API, the four clients speak it,
and `PhysicsWorld` (Babylon-free, a root of the gate beside `havok.ts`) owns
the world, a `WorldBody` table whose pose is seven numbers in a
`Float64Array`, and the substep (pending teleports, step, read back). The
ragdoll and both debris pools draw those poses onto their proxies and meshes
(`poseView.ts`) before anything reads a node. The floor reaches the physics as
data (`GameMap.terrainGeometry`). `scene.physicsEnabled = false` is `Game`'s.

Commits: C0 fb90b7d (the oracles), C1 728d046 (the static world), C2 ea7bb95
(shards and rubble; `PhysicsWorld` owns the substep), C3 8b0382b (ragdolls,
constraints), C4 f56a1e3 (the plugin dropped), C5 8a49494 (poses in arrays,
drawn by views), C6 4c2c35d (docs), review f60ae44 + 823906c.

**The bar was bits, and it held at every commit.** The port replays the
plugin's own calls in its own order — the lazily created bucket containers,
the reversed terrain winding, the material-free world (FINDINGS 53's 0.5
kept), the two mass-property sets that keep the shape's inertia, park keeping
the current orientation, the sync's `p + 0`.
- **`drop.mjs --check --exact`:** "bits identical" on all seven maps, against a
  full-precision fingerprint banked at the parent (`ref/exact.json`).
- **`clients.mjs --check`**, new: ragdolls (a bullet death, a blast death, an
  eviction), glass bursts with re-shapes, and rubble, stepped 600 frames. It
  hashes every live body, every pooled body including the PARKED ones (each
  must sit at y = -1000), and every node the views draw. It rebuilds the world
  twice first and counts Havok's bodies. Banked on the PRE-PORT tree, and
  identical on the port; a park with its teleport removed fails it.
- **simulate**, the seven C6 hashes, unchanged. **bank.mjs** 47 rows, 0 moved.
  **gate.mjs** all seven maps.
- **A real round:** a bullet drops a body, a blast throws one, the ninth corpse
  evicts the oldest, shards fall, the death cam's stand-in falls.
- **Main bundle:** 9,390.8 kB → 9,345.1 kB.

**Found on the way, all pre-existing, none fixed here** (each changes the
picture, so each is the user's call):
- **FINDINGS 57:** a ragdoll's impulse lands while its bodies are still parked
  1 km down, so the chest spins at Havok's 100 rad/s cap. Reproduced bit for
  bit.
- **FINDINGS 58:** debris is culled off a stale bounding sphere. Rubble never
  draws, and a glass shard's sphere sits at the map ORIGIN, so on Cinderhaven
  only 6-8 of a pane's 12 shards draw.
- **FINDINGS 59:** shards and chunks never sink more than one frame's step.

`death.substep` now really is the step: Babylon's engine had overwritten the
plugin's timestep with its own 1/60 default, the same value today.

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
- **Must not:** fix `FINDINGS.md` 53 (the static world's friction is 0.5, not
  the configured 0.8, because Havok combines by minimum). Decided 2026-10-10:
  the port keeps 0.5, so `drop.mjs --check` stays a bit-for-bit oracle for this
  step. Raising the world to 0.8 is a separate commit after X2.4 lands. It
  changes the feel, so it is the user's to ask for, and it re-takes
  `drop.mjs`'s bank.
- **Rewrites:** `docs/deaths.md`. The `scene.physicsEnabled` rule stays until
  the scene is gone.

### X2.5 — One simulation core, in a Worker — **L**, as three sub-steps (two decided 2026-10-10, the third 2026-10-11)

Not needed to leave Babylon, and cheapest right here, with both simulations
Babylon-free. `Game` offline and `HeadlessGame` on the authority become one
core, and offline play runs it in a Worker (`PERF_PLAN.md` C4). One core ends
the class of bug where the two drift apart (`paysKiller`, the capture awards).

**Why a Worker now, although P0 measured the simulation at only 5-8% of a
GPU-bound phone tick (0.5-1.0 ms of 9.5-12).** The user decided it on
2026-10-10, and the case is about where the game is going rather than what it
measures today:
- Phases 3-5 cut the draw-call CPU the frame is bound by, so the simulation
  becomes a larger share of what is left.
- The game is going to large battlefield maps with more bodies, more vehicles
  and destructible buildings.
- Moving the core while it is being made one is cheaper than moving it after
  Phases 3-5 have built on it.

**What the Worker costs**, which this step owes in full rather than discovers:
- cross-origin isolation, which the shared state needs;
- the local player split from the world it reads;
- a frame of bot latency;
- one more place for two seeded runs to diverge.

The two sub-steps land separately, each with its own oracle, because a
divergence after both at once could not be placed in either.

**A third sub-step, X2.5c, was added after X2.5b landed** (the user's call,
2026-10-11, after a review of the branch). X2.5a and X2.5b made one core but
left the PAGE with two client models: a match client (snapshots, `ServerEvent`,
`NetRoster`, local predictions) and an offline one (`SimFrame`, mirrors,
`SimEvent`, bare asks). X2.5c makes offline a match client of a `Match` running
in a Worker, so there is one client, and deletes most of X2.5b's transport.

#### X2.5a — One core, in the page — **M** (ran **L**) — **LANDED** (e328d43)

**Landed** 2026-10-11, after a three-way review whose fixes are 3e154cd and
e328d43, and the USER's offline play-test of C4b in the tank, the truck and the
helicopter ("Everything feels fine. I tested all, and noticed no issues").

**What exists.**
- **`SimCore`** (`src/sim/`, `HeadlessGame` moved and generalised) is the one
  simulation. `Match`, `simulate`, `corecheck` and the page all host it. Its
  systems meet only inside it. It reads no clock and draws no seed: the host
  supplies `RoundSpec.seed`, `anchor`/`drop`, and an optional timing clock.
- **Commands in.** `SimCore.submit(slot, SimCommand)` (`commands.ts`) is the one
  door. `Match` VALIDATES, then submits; the page's commands are trusted.
- **Events out.** Events go into an allocation-free typed ring (`events.ts`),
  with every number captured at emission. `Match` drains and relays them;
  `Game.onSimEvent` draws them.
- **State out.** A plain-data `SimFrame` (`frame.ts`) is read by the page's
  mirrors (`mirror.ts`). `Game` holds the core only as a `SimDoor`.
- **The local `Player` is outside the core**, offline as in a match: a
  prediction that submits `move`/`shot`/`grenade`/`ordnance`/`deploy`/`mount`/
  `drive`/`gun`. Its throw and launch start points are command INPUTS (FINDINGS
  55). Its own hull is predicted on the page and reported (C4b).
- **`hostHoldsRespawn`** keeps the offline deploy screen over a held world.
  `RoundSpec.pool`/`fielded` keeps offline's per-map pool, which keeps the
  bench.
- **Twenty-one drifts between the two old simulations are gone** (the brief's
  D1-D22). Among them:
  - the player's death or ticket could be dropped by UI state;
  - bots heard the player's rifle at the VIEWMODEL muzzle;
  - offline deaths were filed with no cause;
  - offline riders lagged their hull by a frame;
  - offline spawns skipped the authority's check.

Commits: C0 a81895e, C1 2f34bca, C2 0ae6474, C3 e5b9cc3, C4a-1 115432b, C4a-2
159cec3, C4b bb8345e, be031a6 (FINDINGS 60), C5 22bc7ec, C6 f707238, C7
d91dcfa, review 3e154cd + e328d43.

**Measured:**
- **The bench's seven fight hashes** (bot-only, recorded at C0): identical at
  every commit, plain and under `?simcopy` (every command, frame and event
  through `structuredClone`). Greyfen `83e8e74ef36916ba`, Hollowmere
  `549487ba93bceefe`, Coldharbour `de5622634abca6e7`, Harrowmead
  `3ae90f2f08fb0643`, Sarab `986c2e35557fb679`, Cinderhaven `2f97c9072ab1762b`,
  Kurenai `cd58b73111eacbdd`.
- **simulate:** X2.2's seven C6 hashes and every map's `--events` list
  identical at every commit.
- **`?simcheck`** (DEV: every mirror read equals the live object, `Object.is`):
  0 mismatches over the bench on all seven maps and an offline round with a
  person.
- **`npm run corecheck`**, new: 108 assertions driving the core with no `Game`.
  They cover the scoring rules (attack, defend, headshot keyed on the victim's
  flag, capture paid to present bodies, `paysKiller`, the hull pays nobody, crew
  deaths), deploy and seats, the leash, and reported landings. The same scripts
  through a real `Match` with fake peers give the identical event stream.
- **The core's cost** (the profiler's `sim` phase, v14): 0.14-0.52 ms per
  desktop fight frame (Sarab 0.52). Offline the page builds no `CoverMap` and no
  flow fields (Cinderhaven: 15.5 + 13.6 MB). The core's own world adds ~28 MB on
  Sarab and ~75 MB on Cinderhaven, and `core.startRound` adds 0.44 / 0.71 s to
  the build.
- **parity**, **build** (the gate walks `server/`, `src/sim/` and the
  simulations), **gate.mjs** all seven maps, **bank.mjs**, **clients.mjs**, and
  the scripted netplay match (Coldharbour botless, Sarab with bots, Sarab in the
  helicopter): green throughout.

**Found and fixed on the way:**
- **FINDINGS 60:** a helicopter a person flew never took crash damage, in a
  match always. It is now charged off the accepted drive reports
  (`reportedLanding.ts`) by one rule on both sides, matching the bot path to
  6e-11 at 60 Hz.
- **The leash never killed a seated flier.** It now puts the person on foot,
  then kills them.
- **A client's raw stamps could dodge or deal crash damage** and buy ~10x the
  movement allowance. `Match.onStamp` now holds each peer's stamp lead to
  ±250 ms; an honest peer's numbers are bit-unchanged.
- **A correction mid-descent charged a phantom crash.** A `resync` on the first
  drive after a `hullcorrect` now rebases the history without making a landing
  free.

**Open for X2.5b**, from the review (session notes): `RoundSpec.def` holds
import thunks and cannot be posted; the timing clock is a function with a
different `timeOrigin` in a Worker; five page call sites use `submit`'s
boolean synchronously; `ShotCommand.weapon` carries the whole `WeaponSetup`;
some mirror readers read the frame lazily; the frame's counts and header live
outside its typed arrays; one frame must be applied before that call's events;
`?simcheck` needs the core in-process. FINDINGS 61: `BotMirror.read` allocates
~3.2 kB a frame.

- **Do:** extract the core behind the interface the Worker will use.
  - Inputs go in: the local player's commands and the net events.
  - `step(dt)` runs.
  - Out come state as plain data (typed arrays where it is per-body) and an
    event queue: shots, hits, kills, captures, blasts and sound cues.
  - The core has no DOM, no Babylon, and no reference to anything a view owns.
  - Nothing in it may assume it shares a heap with its caller: everything
    crossing the boundary is data that could be posted or shared.
  - `Game` reads the queue and does its wiring there (`onBotKill`,
    `onCaptured` and the rest become events), which keeps "systems never
    import each other" true on the main thread.
  - The authority runs the same core in-process as `HeadlessGame`'s
    replacement.
- **Verify:**
  - `parity` and `simulate`;
  - the scoring rules, exercised offline and online;
  - the benchmark's fights: X0.4's hashes, or new ones with the reason named;
  - a test that drives the core with no `Game` at all;
  - a netplay round.
- **Rewrites:** `CLAUDE.md`, "Ownership and wiring" (the core's events are
  where systems meet) and "Conquest rules" (one ledger, one core); `docs/game.md`;
  `docs/multiplayer.md`.

#### X2.5b — The core in a Worker — **M** — **LANDED** (e454421) — **transport SUPERSEDED by X2.5c**

**Superseded in part, 2026-10-11.** X2.5c replaces this step's transport
(shared memory, `SimHost`, the codec and the publication) with a local `Match`
over the existing protocol, and its two owed Verify items (the phone run and
the docker image's isolation) move to X2.5c. What X2.5c keeps from here is
listed in its "Keep". The record below stays as it landed.

**Landed** 2026-10-11, at the end of one session; **two Verify items are owed
by the deploy, not by this commit**: the phone run (the user's review, then the
`--no-ff` merge to `develop`, then the deployed build — "The branch") and
`crossOriginIsolated` in the docker image (no docker or nginx on this box; the
template's pair is untested until that deploy, and the installed app's own
service worker stamps the pair whatever the server sends — below).

**What exists.**
- **`SimHost`** (`src/sim/simHost.ts`) is the page's one door into the core,
  wherever it runs. `PageSimHost` is X2.5a's arrangement exactly;
  `WorkerSimHost` runs the core in a Worker (`src/sim/simWorker.ts`) over
  shared memory. `openSimHost` chooses at boot (`main.ts`, awaited and
  injected as `havok` and `engine` are): a Worker when the page is
  cross-origin isolated and has growable `SharedArrayBuffer`s, the page
  otherwise, under `?simpage`, `?simcheck` (DEV) or `?simcopy`, or when a
  Worker fails or stays silent for 20 s. The boot's console line says which
  and why; every capture says it as `simMode`. `SimDoor` is gone.
- **The transport allocates nothing per frame on either thread.** Commands are
  encoded into one of two growable float64 buffers (`commandCodec.ts`, one held
  object per kind on the decode side; `ShotCommand.weapon` is now `ShotWeapon`,
  the five numbers resolving a round reads). Each operation's frame and news
  are published into one of two growable buffers (`publication.ts`: the layout
  derived from `newFrame()`, per-round lengths and a version in the header,
  the scalars through `frame.ts`' written-out `FRAME_SCALARS` pair, checked
  against the walk at load). The signal is an `Atomics` store the Worker
  `Atomics.wait`s on; the page never sends before it has taken in, so each
  buffer is one side's at a time. A posted message is a round's cost
  (`startRound` names the map by id; `addPlayer`, `removePlayer`,
  `releaseWorld`), answered while the page spins (`hostWire.ts`).
- **One code path in `Game`, which depends on nothing about WHEN the core
  answers.** `ask` returns nothing; the five sites that read `submit`'s boolean
  decide off the page's own state as a match's client does — the main gun off
  `gunReady`, the cupola gun off the page hull's `fireMg`, the grenade booked
  before the ask and returned by `ordnanceRefused` (`Player.returnGrenade`),
  the rocket and the mine as in a match. **From a Worker the step overlaps the
  frame**: `step` takes in the step started a frame ago and starts this one,
  so the frame drawn is the step before; a frame that does not step calls
  `pumpSim` (the deploy's `spawned` comes back that way); the bench `settle`s
  before its hash and a round build drops what the last round still owed.
- **Offline shots are rewound** (decided): the page's core is built with
  `rewind` in both modes, and a round carries `renderTime`, the synced frame's
  `time`. In the page that is the core's present and moves nobody.
- **The profiler sees the Worker** (report version 15): `sim` is a third ROOT,
  filed against the frame that takes its answer in, its clock moved onto the
  page's `timeOrigin`; `simPublish` is the fill plus the shared copy; `world`
  gains `simWait` (the page blocked on the Worker) and `simSync`;
  `SegmentStat.sim.hop` and `bench.mjs` print both. `FrameProfile.fileTiming`
  files the row in one call (`file` is gone).
- **Isolation** (COOP `same-origin`, COEP `require-corp`) on every response
  from the Vite dev and preview servers, the nginx template (server level and
  every location with its own `add_header`), and every response `sw.js`
  answers. `server/` serves no page; the lobby's cross-region list is CORS,
  which `require-corp` accepts; the page makes no other cross-origin load.
- **FINDINGS 61, fixed at its root, and the entry deleted.** It was boxed
  doubles, as suspected — but from the COMPILER, not the tier: under ES2022's
  [[Define]] class fields `x: number;` is emitted as `x;`, the field starts
  `undefined`, and V8 holds it Tagged, so every `Vector3` store was a fresh heap
  number even on TurboFan. `useDefineForClassFields: false` (`tsconfig.json`,
  now a `CLAUDE.md` convention). Beside it: `RosterMirror.aliveCount`'s
  `for...of`, `LagComp.record`'s, and the per-phase `file` (~660 B a frame).

**Measured:**
- **The benchmark's seven fights, from the Worker: X2.5a's hashes, every one**
  (Greyfen `83e8e74ef36916ba`, Hollowmere `549487ba93bceefe`, Coldharbour
  `de5622634abca6e7`, Harrowmead `3ae90f2f08fb0643`, Sarab `986c2e35557fb679`,
  Cinderhaven `2f97c9072ab1762b`, Kurenai `cd58b73111eacbdd`), and Sarab's the
  same with `?simpage`. `?simcheck&simcopy` (the page): Hollowmere and
  Coldharbour 5,402 checks each, 0 mismatches, the same hashes; an offline
  round with a PERSON in it under `?simcheck` (a rewound rifle round that
  hit, a grenade, a seat, the main gun) 449 checks, 0 mismatches.
- **simulate, seed 777:** X2.2's seven C6 hashes and every map's `--events`
  list identical (the timing lines aside), and the authority's round 7-16%
  faster on wall clock on every map (Cinderhaven 5,315 → 4,487 ms) from the
  class-field setting alone. **corecheck** all passed; **parity** every map;
  **merge:hash** identical on all eight against the parent; **kit:hash**
  identical; **bank.mjs --check** 47 rows within the floor; **drop.mjs
  --check** bits identical and **clients.mjs --check** identical on every map;
  **build** green (the babylon-free gate walks the five new files).
- **`crossOriginIsolated`**: true in dev and under `vite preview`; the
  production build installed, then OFFLINE — still true, the core in the
  Worker, a round deployed and stepping. A bare server sending no headers: false
  on the first load, the boot falling back to the page and saying so — and true
  once the service worker controls the page, online and offline (it stamps the
  pair). Docker: owed (above).
- **A netplay round** (Coldharbour, a local match server, `?mp`): joined,
  deployed, played; left to the menu and played an offline round on the Worker.
- **The phone check, read off the profiler — on the desktop, the phone owed**
  (Sarab fight, 3440x1440, two runs a side in one session, final code):
  - `sim` OFF the main thread: 0.27 ms of step on the Worker, `simWait`
    0.000 ms (the Worker always finished inside the frame), `simSync`
    0.015 ms, `simPublish` 0.029 ms (on the Worker).
  - **The main thread's frame against X2.5a's** (the parent, my work
    stashed, same session): fight tick **10.04 vs 10.48 ms (−4.2%)**, wall
    10.39 vs 10.84 ms, run spreads 0.2–0.3%. Under the protocol's 8% floor,
    and the size of X2.5a's `sim` (0.39 ms) — the expected reading.
  - The same code with the core in the page (`?simpage`): tick 10.58 ms,
    `sim` 0.37 inside it — the page and the Worker are within this
    desktop's spread once the class-field fix cut the step, which is why
    the phone, where the step is a larger share, is the reading that
    matters.
- **Allocation** (CDP sampler, both collected-object flags, Sarab fight):
  `BotMirror.read` 117 → 6.5 B a call (the empty loop's floor), ~3 µs → 34 ns;
  the page's whole frame 692 → 620 kB with the core in the page, 357 kB with
  it in the Worker (the core's allocation leaves with it); the hop's own code
  on the main thread at the sampler's floor (`take`, the mirrors, `pumpSim`,
  `fileSimTiming` all gone from the list); the Worker's publish path ~80 B a
  frame (getter boxing inside `fillFrame`, sampling-level) and its timing
  ~4 B.
- **The cost**: the Worker's bundle is a second copy of the simulation and the
  map data, 568 kB (127 kB gzipped) beside a 9.2 MB entry.

The step as handed over follows.

As `PERF_PLAN.md` C4 states it:
- **The shared state.** Per-body state and the event queue are double-buffered
  in a `SharedArrayBuffer`.
- **The local player stays on the main thread** with the camera, so the time
  from input to photon is unchanged. It reads the world from the last
  published state and runs its own sweep there (X2.1's primitive, now plain
  code).
- **Bots and everything else run a frame ahead** in the Worker.
- **The authority** runs the core in-process (decided 2026-10-11, below).
  C4 left it to whichever measured better; no measurement is owed.

**Decided 2026-10-11, before the step:**
- **Shared memory, not posted frames.** Posting the frame and transferring its
  buffers was weighed. It needs no isolation, and `?simcopy` already proves
  the clone boundary. But every message allocates on the receiving thread (the
  event, and new buffers that need new views), so it cannot meet the
  allocation-free rule below. Shared memory allocates nothing on either
  thread, and Phase 4's instanced bodies can upload straight from it. The speed
  difference (an estimated 0.1-0.3 ms a phone frame) is below the measurement
  protocol's floor and did not decide it. **The transport is one small module
  behind one interface**, and the frame's layout is the same for both, so
  posting can replace shared memory later as a contained change if isolation
  causes trouble.
- **Offline shots are rewound.** With the bots a frame ahead, a person's shot
  resolves about two steps after the picture it was aimed at (15-20 cm at a
  run). The offline core is built with `rewind` in both modes, so a shot is
  resolved against what was drawn, by the same rule as a match. The bench is
  bot-only, so its hashes are not expected to move.
- **The phone check is restated** (see Verify): the simulation's share of a
  phone tick (5-8% at P0) is at or under the protocol's ~8% floor, so "the main
  thread gets faster by roughly that share" could not be read either way.
- **The phone run goes through `develop`.** After the step lands, it is
  reviewed and then merged `--no-ff` into `develop` by the user's call, so the
  deployed build can be installed and run on the phone (see "The branch").
- **The authority stays in-process.** A server runs one core per match and
  draws nothing, so a Worker there would only add a thread hop to every
  command and event `Match` relays. The server is in no X0.4 target, so a
  measurement would have nothing to be graded against.

**Cross-origin isolation** (COOP `same-origin`, COEP `require-corp`) is owed on
EVERY document response:
- the Vite dev server;
- `docker/default.conf.template`;
- anything in `server/` that serves the client;
- the navigations the service worker answers from its cache. Missing this one
  makes the installed app silently lose isolation offline, which is the same
  failure shape as `sw.js`'s `DOCS` list (`docs/pwa.md`).

Check every cross-origin load the page makes (fonts, anything from a CDN)
against `require-corp` before turning it on.

**Do:**
- **The fixed step survives the hop.** The benchmark and `simulate` still
  fight the same fight from the same seed. Nothing in the core may read a clock
  the Worker owns.
- **The profiler sees the Worker.** The core's `step` reports its own timing
  back through the published state. `FrameProfile` shows it as a phase that is
  not inside `frame`, in the way `present` is not (`docs/profiling.md`). Its
  allocation-free rule holds on both threads.
- **Fallback:** a browser without cross-origin isolation (or without
  `SharedArrayBuffer`) runs the core in the page, exactly as X2.5a left it. It
  stays one code path behind one interface, and the boot says which one is
  running. The in-page mode also stays selectable by a flag, because
  `?simcheck` needs the core in-process.
- **Offline rewind** (decided above): the offline core is built with `rewind`
  in both modes.
- **FINDINGS 61 is fixed in the step.** `BotMirror.read`'s ~3.2 kB a frame
  breaks the allocation-free rule this step extends to both threads.

**Verify:**
- `crossOriginIsolated` is true in dev, in the docker image, and in the
  installed app OFFLINE.
- The benchmark's fights are unchanged from X2.5a.
- `parity` and `simulate`.
- A netplay round, and an offline round on the phone (on the deployed
  `develop` build, after the review and merge decided above).
- **The phone, before and after, read off the profiler rather than the frame
  rate** (restated 2026-10-11):
  - the main thread's `sim` phase goes to about zero;
  - the page's new per-frame costs (publishing, syncing the mirrors) are
    measured and named;
  - the main thread's frame is no slower than X2.5a's.
  **If `sim` does not leave the main thread, or the new costs eat what it
  freed, stop and find out why before going on.**

**Rewrites:**
- `CLAUDE.md`: "Ownership and wiring" (the simulation runs off the main
  thread), "Measuring a frame" (the Worker's phase, a third root), and "The
  installable app" (the isolation headers, beside `DOCS`);
- `docs/pwa.md`, `docs/profiling.md`, `docs/game.md`;
- `VERIFYING.md`, which has to say how a headless run gets isolation.

#### X2.5c — Offline is a match client of a local `Match` — **M–L**

**Why** (the user's call, 2026-10-11, after a review of the branch).
"Single-player is a local server." After X2.5b the page had two client models,
and they had begun to drift:
- **Two event switches.** `Game.onSimEvent` and `Game.onNetEvent` shared about
  half their arms. The hit cue already differed: offline picked it by cause,
  while a match sends every hit through `hitCredits`.
- **Two prediction models.** In a match the page predicts with its own
  `CombatSystem`, `GrenadeSystem` and the rest. Offline the same acts were bare
  asks. 23 methods in `Game.ts` forked on `this.net` (0 on `develop`).
- **Two state vocabularies.** `SimFrame` and the mirrors offline; `Snapshot`
  and `NetRoster` in a match. A field the page can see was added twice, and the
  offline half took five edits, three of which failed silently if forgotten.
- **Event payloads read by raw offset.** `onSimEvent` made 61 reads like
  `c.f(i, 7)`, checked against nothing.
- **The tank gun's reload clock kept twice**, reconciled by `HULL_EARLY` slack.

**The rule this step sets: if anything about the online experience is not
acceptable offline, it is fixed for BOTH.** Offline does not get a better
transport than a match. The step uses the existing JSON protocol. A binary
wire comes later, for both at once, and only if a profiler capture asks for it.

**Read first:**
- `server/Match.ts`: its header, `Peer`, `addPeer`, the step loop around
  `TICK_HZ`, `broadcastSnapshot`, `retire`, the map vote and rotation.
- `src/net/Connection.ts`: the whole header (the clock offset), and
  `NetSession`.
- `server/corecheck.ts`: the half that drives the core through a real `Match`
  with fake peers. It is this step's model.
- `docs/multiplayer.md`, `docs/game.md`, `docs/states.md` (pausing and its
  netplay inversion), X2.5a's "What exists", and X2.5b's "What exists".

**The shape.**
- **The Worker hosts a `Match`** with one in-memory peer per person (offline:
  one). The page joins it through the same `NetSession` and `Connection` a
  remote match uses, so `Game.net` is non-null in every round.
- **There is a second channel for the OWNER only:** start a round on a map
  with a seed and a difficulty, advance by `dt`, settle, report the step's
  timing and the bench's fight hash. It is not a `ClientMessage`, so no remote
  client can send it, and `server/wire.ts` never sees it.
- **The Worker's entry lives in `server/`** (e.g. `server/localMatch.ts`), and
  the page reaches it only as a Worker URL. Nothing in `src/` value-imports
  `server/`, so CLAUDE.md's "nothing in `src/sim/` imports from `server/`"
  still holds, and the babylon-free gate already walks it.
- **The page also keeps a same-thread local match**, hosted on a
  `MessageChannel`, selected by `?simpage` and used when the Worker fails to
  start. It is the same code path, and it is what a debugger steps through.

**Do**, as commits each proven against its parent:
- **C0, the oracle.** Record the bench's seven fight hashes, `simulate --events`
  for every map, and `corecheck` at the parent. These are X2.5a's hashes,
  unchanged through X2.5b.
- **C1, Match off the socket.**
  - Introduce a `Peer` transport (send, close, ping) with a `ws` adapter in
    `server/index.ts`, replacing `peer.socket`, `socket.ping` and `on("pong")`.
  - Behaviour unchanged. Verify with `corecheck`, `parity` and a netplay round.
- **C2, a Match the owner drives.**
  - Its clock becomes a choice. The server free-runs (today's wall-clock
    accumulator). A local owner calls `advance(dt)`, and the same accumulator
    steps `1 / TICK_HZ`.
  - The bench's `dt` is already `1 / 60` (`CONFIG.profiling`), so a bench frame
    stays one step.
  - Add the options a local match needs:
    - the seed (`?seed=`, the bench);
    - the difficulty (`Match` hardcodes 1);
    - the map named by the owner, with no vote and no rotation;
    - no idle retire, since the bench is a match with no person;
    - **the per-map pool**: `RoundSpec.pool` equal to the map's own roster,
      as offline builds it today. A slot index is a bot index, and every
      outcome stream is keyed by slot, so the authority's 48-slot ceiling
      would renumber team 1 and change the fight. Keeping the per-map pool
      keeps the fight hashes as the oracle.
- **C3, the local transport.**
  - The Worker entry, the owner channel, and `Connection` taking a transport
    (a WebSocket, or a `MessagePort`).
  - Nothing in `Game` uses it yet. `corecheck` gains a run through the local
    transport.
- **C4, offline is a local match.**
  - `Game`'s offline round goes through `NetSession` over the local transport.
  - **The forks about AUTHORITY stay, as one question:** `net.local`, true when
    the page owns the match. Restart, choosing the map, the difficulty, and
    pause and the deploy screen holding the world. Every door that asks
    `!Game.net` today asks `!net.local` instead.
  - **The forks about PREDICTION go.** Offline predicts exactly as a match
    client does.
  - **Holding the world is not stepping it.** While a lid holds the world, or
    the deploy screen holds a respawn (`hostHoldsRespawn`'s job today), the
    page does not call `advance`. An ask made while held (deploy, `spawned`)
    must still be answered: `Match` handles a message on arrival, not on a
    tick. Check that it is.
  - The bench drives the local match. Its fight hash comes back over the owner
    channel, after a `settle`.
- **C5, delete.**
  - `simHost.ts`, `simWorker.ts`, `hostWire.ts`, `commandCodec.ts`,
    `publication.ts`.
  - `frame.ts`, `mirror.ts` and `simCheck.ts`, wherever nothing outside the
    page used them. `simulate`, `corecheck`, `BotRig` and `BattleView` read
    them today: move each onto `SimCore` directly or onto the match path.
  - `Game.onSimEvent`, the pump, settle and ask plumbing, `?simcheck` and
    `?simcopy`.
  - `ordnanceRefused` and `Player.returnGrenade`, if the match client already
    has the same path; keep one.
  - The profiler's `sim` root is now fed from the owner channel.
- **C6, cross-origin isolation comes out, then the contracts** (decided
  2026-10-11, below).
  - Posting needs no cross-origin isolation; only `SharedArrayBuffer` did.
    Remove the COOP `same-origin` / COEP `require-corp` pair from all four
    places X2.5b put it:
    - `vite.config.ts` (the dev and preview servers);
    - `docker/default.conf.template` (the server level and every location
      with its own `add_header`);
    - `src/pwa/sw.js` (every response it answers);
    - and any check left reading `crossOriginIsolated`.
  - Verify: `grep -rE "crossOriginIsolated|Cross-Origin-(Opener|Embedder)|require-corp"`
    finds nothing outside this file, `PERF_PLAN.md` and the docs' history.
    The local match still runs in the Worker in dev, under `vite preview`, and
    in the installed app offline, now with `crossOriginIsolated` false.
  - Rewrite the contracts (below).

**Keep from X2.5b:**
- `useDefineForClassFields: false` and its CLAUDE.md convention;
- `LagComp.record`'s allocation fix;
- `ShotWeapon` (a shot carries five numbers, not the `WeaponSetup`);
- `HULL_EARLY` as one constant shared with `Match`;
- the Worker boot in `main.ts` (awaited, with a fallback, and a boot line
  saying which one runs);
- the round named by map id rather than by posted import thunks;
- the profiler's `sim` root on the page's `timeOrigin` (report version 15),
  re-pointed at `Match`'s step.

**Traps:**
- **A hold stops the server's clock and the client's offset estimate does not
  know.** `Connection` estimates server time as the MAXIMUM sample in a
  five-second window. After a hold of P seconds every new sample is P lower, so
  the stale maximum keeps render time P ahead of the server for up to five
  seconds. Bodies then stand at their newest snapshot, and rewound shots are
  stamped in the future. Resetting the window on release is the likely fix.
  Whatever the fix, a remote client must never take that path.
- **The anti-cheat gates see the local peer.** Stamp leads are clamped to
  ±250 ms (`Match.onStamp`), there is a message-rate bucket, and the move and
  drive validation run on every report. An honest local peer must pass them
  bit-unchanged, as an honest remote one does, and a hold must not read as a
  stamp jump.
- **Validation now runs offline.** That is the point: one rule. But a refusal
  offline that an offline player could not trigger before is a finding, not
  noise.
- **The client numbers slots by the ceiling** (found at C2). An owned match's
  slot table is its map's own roster, so team 1 begins at slot `perTeam` (8 on
  most maps), but `NetRoster.buildPool` places team 1 at
  `CONFIG.bots.maxPerTeam` (24). Before C4 puts a client in front of an owned
  match, the client must take the block width from the match rather than from
  `CONFIG`. A remote match's width is still 24.
- **Two ports, and no order between them** (found at C3). The page speaks to
  a local match as a PERSON on its `Connection`'s port and as the OWNER on
  the owner channel, and a port promises order only within itself: a
  `deploy` posted before an `advance` may be read after it. Anything C4
  needs ordered across the two (an ask answered while held, a settle before a
  read) must come from an answer on one port, never from the order the page
  posted in (`docs/multiplayer.md`, "The local transport").
- **The benchmark has to WATCH its fight, and a peer is a seat** (found at
  C3's review). The bench draws the fight it measures — the bodies, the
  tracers, the chase camera over a bot (`Game.chaseBench`, reading the
  page's own core today) — and once the frame and the mirrors go (C5) the
  wire is the only picture there is. But the wire reaches only an ADMITTED
  peer, and `admit` claims a slot and benches its bot, which moves the fight
  hash. C4 owes a peer with no seat — snapshots and events, never
  `Roster.claim` — or another way to draw the round that leaves the slot
  table alone.
- **`advance` is seconds, and seconds do not sum to whole steps** (found at
  C3's review). `accrue` adds milliseconds, so one `advance(9 / 60)` steps 8
  and carries most of a ninth: 150 ms less nine `STEP_MS` in floating point
  is a hair under a step. One `advance(1 / 60)` IS one step exactly (C2), so
  the bench's multi-step lead-in frames post one advance per STEP, as
  `Game.updateBench` already loops `updateWorld` per step, never one per
  frame.
- **A port opens whoever is at the far end** (found at C3's review). A
  WebSocket to a dead server closes; a port into a Worker that died or
  wedged says nothing, so `Connection` goes `open`, sends its join and waits
  for ever, and `LocalMatch`'s awaited calls never settle. C4 owes the
  Worker's own failure signal (`onerror`, and a call that does not answer)
  routed to the session, as the boot already does for X2.5b's Worker.
- **Nothing yet enforces that the local match's reach imports no Node.**
  `server/localMatch.ts` and everything it reaches — `Match` included — run
  in a browser, but `check-babylon-free.mjs` gates Babylon only and
  `npm run build` does not bundle the Worker until C4 names it as a Worker
  URL. From then the page build refuses a `node:` or `ws` import in its
  reach; until then it is a rule in the headers alone.
- **The same-thread fallback is a value import of `server/`** (found at C3).
  `serveLocalMatch` is one code path in a Worker and on a `MessageChannel`,
  but running it in the page's thread means the page imports
  `server/localMatch.ts`, which "nothing in `src/` value-imports `server/`"
  forbids. C4 decides: a dynamic `import()` taken only on the fallback keeps
  the Worker path's bundle free of it, and the rule is restated as "only the
  fallback's one dynamic import". Until something references
  `server/localMatchWorker.ts` as a Worker URL, `npm run build` does not
  bundle it — C3 proved it under `vite dev` in a real Worker.
- **The bench's fight must not move.** If the hashes differ, the slot layout
  (the pool), the step order around `Match.step`, and the seed's route are the
  suspects, in that order. Attribute the change to one cause, as X2.2 C6 did,
  or do not land.
- **The page's own match is built off the map's committed BAKE** (found at
  C4). The old offline core was handed `collisionOf(map)`, the map the page
  had just built; a `Match` reads `MapDef.collision`, as a server's does. So
  an edit the editor saved plays against stale colliders on the authority's
  side until `npm run collision` re-bakes it — the same rule a server match
  has always had, now met in the dev loop. Not a bug in either half; a
  workflow to know (`Game.toggleEditor`'s header says it).
- **What C4 leaves C5** (found at C4). `Game` constructs no `BattleView` and
  holds no `SimHost`, frame or mirror: every one of `simHost.ts`,
  `simWorker.ts`, `hostWire.ts`, `commandCodec.ts`, `publication.ts`,
  `mirror.ts`, `simCheck.ts`, `BattleView.ts` and (if nothing else draws a
  bot) `BotRig.ts` is now unreachable from the page and still typechecks.
  `src/sim/frame.ts` is still where `FrameTiming` and `SIM_PHASES` live, and
  `localWire.ts` and `Game` read them — C5 moves those two before deleting
  the rest. `?simcheck` and `?simcopy` now do nothing (`VERIFYING.md` says
  so). `VehicleSystem.onRespawned` never fires on a page's fleet (it is always
  `predicted`); the READY toast is the wire's arrival edge
  (`Game.syncNetVehicles`).
- **Fixed for BOTH at C4, by the step's rule** (found at C4 — each was a
  match's behaviour that offline would otherwise have inherited): bodies off
  the wire now cast body shadows, get blob shadows and bend the grass
  (`mapBodies`, `fillCombatants`); a remote rocket's launch is heard
  (`NetOrdnance.onLaunch`); the shooter's mark for a blast, a killing burn, a
  hull gun's kill and the tracks rides the wire (`hit`'s new `cause`); a
  hull's return says READY; the player's own scoreboard row and own death on
  the feed read "YOU".
- **Still different, and owed** (found at C4): the feed names a kill BY the
  player as their team, never "YOU" — the `kill` event carries the killer's
  team and not their slot, so a client cannot tell its own kills from its
  squad's. Fixing it is a field on `kill`, for both.
- **A person's FIRST `move` was budgeted one input interval, and that was a
  match's bug** (found at C4, fixed for both). Validation runs offline now,
  and a headless Sarab walk came back `speed`-corrected by a third of a
  metre on `seq` 1 — once in fourteen walks, whenever the frames right after
  a spawn ran long. A client sends on the first frame its upload clock
  reaches an interval, so its first sample spans up to one interval plus a
  frame, and a frame is capped at one interval. `Match.onStamp` now assumes
  `FIRST_STAMP_GAP` (two intervals); every later sample is priced by its own
  stamps. corecheck's every banked line is unchanged by it.
- **The benchmark watches through interpolation** (found at C4): its bodies
  are the watcher's, drawn `interpDelay` behind 20 Hz snapshots, and an
  uncapped run steps the match faster than the wall, so the render clock
  snaps forward as the offset estimate catches up. A picture, which the hash
  does not fold; what it costs is that the bench's bodies are no longer the
  core's exact pose each frame, which is the cost this step exists to measure.
- **The contracts are C6's** (found at C4): `CLAUDE.md`'s "Ownership and
  wiring", "Multiplayer" and "Measuring a frame", and `docs/game.md`,
  `docs/states.md` and `docs/profiling.md`, still describe the core-in-a-Worker
  page; C4 rewrote only `docs/multiplayer.md`, `FILES.md`, `VERIFYING.md`'s
  misleading lines and the contract headers it touched.

**Verify:**
- The bench's seven fight hashes: X2.5a's table, identical, from the Worker and
  under `?simpage`.
- `simulate --events` identical for every map; `corecheck` all passed,
  including the new local-transport run; `parity`; `merge:hash` and
  `kit:hash` identical; `npm run build`.
- **A netplay round** on a local match server, then leave to the menu and play
  an offline round on the local match: on foot, then in each vehicle kind. The
  USER play-tests this, as for X2.1 and X2.5a.
- **The phone, offline Sarab, off the profiler** (moved here from X2.5b). This
  is where the 100 ms interpolation (`CONFIG.net.interpDelay`, 20 Hz
  snapshots) and the JSON allocation would show. By this step's rule, anything
  wrong there is fixed for both modes. Compare against X0.4's "before" and
  against X2.5b's desktop reading.
- `Game.ts` has no `onSimEvent`. Count the `this.net` forks and name each one
  left: every one should be an authority question (`net.local`).
- The docker image's isolation, owed from X2.5b, is no longer owed: the
  headers are gone. What the deploy owes instead is the local match running in
  the Worker from the deployed build, installed and offline, on the phone run
  above.

**Rewrites:**
- `CLAUDE.md`, "Ownership and wiring": offline is a match client of a local
  `Match`; `SimHost`, the frame and the mirrors are gone.
- `CLAUDE.md`, "Multiplayer": the local match, the owner channel, and
  `net.local`.
- `CLAUDE.md`, "Measuring a frame": where the `sim` root's timing comes from.
- `CLAUDE.md`, "The installable app": the isolation paragraph (every response
  owes COOP and COEP, beside `DOCS`) is deleted, and so is the sentence on
  `require-corp` in "Ownership and wiring".
- `CLAUDE.md`, "Conquest rules": corecheck's two halves.
- `docs/game.md`, `docs/multiplayer.md`, `docs/states.md` (a pause holds the
  world in a LOCAL match, and still holds nothing in a remote one),
  `docs/profiling.md`, `docs/pwa.md` (the isolation headers' four places),
  `FILES.md`, `VERIFYING.md` (how a headless run gets isolation, no longer
  needed), and every contract header the deletions touch.

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
| A5 occlusion culling | optional, after X3.3, in the compute cull; occluders skip `RayWorld.removed` |
| A6 snapshot rendering | dropped: it is a Babylon mechanism |
| B0, B1, B2, B3, B5 | X3.1, X3.3, X3.4, X3.6, X3.5 |
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
| X3.4 | Scatter AO: baked per kind (cheaper, changes the look) or per instance? | Per kind, judged in the bank. |
| X4.2 | Which hull parts drop at range (the tank's links and wheels, the MG rings)? | An art call; PERF_PLAN A3 measured +6.5% at 300 m on Cinderhaven. |
| X6.2 | Is it ready to merge to `develop`? | Only when X6.2's "Before" list passes in full. |
