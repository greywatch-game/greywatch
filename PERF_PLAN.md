# PERF_PLAN.md — fewer draws, then the simulation off the main thread

The browser-side performance work, in the order to buy it. Written like
`ENGINE_UPGRADE.md`: **to be handed to a coding agent one step at a time**, each
step independently landable and verifiable, and ordered so that the one before
it says whether the one after it is still worth doing.

`CLAUDE.md` and the companions under `docs/` remain the contract for every
subsystem a step touches. This file argues about COST and ORDER. Where it
disagrees with a contract, the contract wins until the step that changes it
also rewrites it — and several steps below must (see "Contracts this plan
rewrites").

**Babylon stays.** Nothing here removes it for its own sake. Part B replaces the
pieces of it that stand between the game and fewer active meshes, and Part C
the pieces that tie the simulation to scene nodes. There is ONE decision point
where taking the frame away from Babylon could become the cheaper option (B4),
and it is decided on evidence there, not here.

---

## What we already know

Every number below is from the files cited; re-measure before sizing a lever
against any of them.

**The desktop frame is draw-call bound, and the game's own JS is small.**
`docs/rendering.md`, "Why the frame is draw-call bound" (Coldharbour, RTX 4070
Ti SUPER): the frame is ~21.7 ms at 1080p, 540p and 270p alike, 19.6 ms of a
21.5 ms frame is `scene.render`, and **the game's JS is 1.7 ms**. Inside the
render: `_evaluateActiveMeshes` 3.4 ms, render targets 4.5 ms, main draw 11.0 ms.
A draw with a material switch costs ~6.3 µs, a same-material draw ~2.3 µs. The
same section's conclusion: **"Fewer ACTIVE meshes is the only fix."**
(`freezeActiveMeshes` bought +14.8% and was rejected because every effect in
this game is pooled — a frozen active list stops new bodies and effects
appearing.)

**Cinderhaven's active list** (`FINDINGS.md` 39, stale — predates the rig cut,
the vehicle redraw and most builder reworks): ~850 active of 969 offered —
**rigs ~212, blocks ~203, terrain ~153, vehicles ~122**. Vehicles are governed
by nothing but the 3 px size gate.

**The phone** (`FINDINGS.md` 13, Android, Chrome 154, Greyfen at `low`, render
scale 0.5): tick ~9-10 ms, `gpu.frame` 11-14 ms, **7-24% of frames held**, and
the drops follow the TICK, not the GPU. The working hypothesis: the phone's CPU
is shared between the page's main thread and Chrome's GPU process turning
~195 draws into Vulkan commands. **How the 9-10 ms tick splits between the
simulation (`world`, `onFoot`, `driver`) and the render (`render` and its
children) is not recorded anywhere** — and P0 exists mainly to read it.
(P0 has since read it: the simulation is 5-8%, and the GPU, not the tick, is
now the phone's wall at 0.5 — `FINDINGS.md` 50.)

**At render scale 0.75 the same phone is fill-bound** (27.8 ms of `gpu.frame`,
flat against draw calls). Nothing in this plan fixes that; see "What this plan
does not fix".

**The simulation is mostly plain data already.** `NavGrid`, `CoverMap`,
`ObstacleField`, `RayWorld`, `ConquestSystem`, `SquadRadio`, `ScoreBook`,
`BotMemory` and `TerrainField`'s queries use `Vector3` as arithmetic and
nothing else, and the server already builds them from data
(`server/world.ts`). A bot's position and yaw are plain fields pushed one way
into its rig (`Bot.syncTransform`). **The real coupling is five places**: the
player's capsule mesh and the hulls' `body` mesh ARE their positions; grenades
and rockets keep their state on `mesh.position`; the three sweeps are Babylon's
own ellipsoid-against-triangles collider (`narrowedMove` over
`moveWithCollisions`); and `Bot.muzzleWorld` / `Vehicle.muzzleToRef` read
forced world matrices off animated nodes — which is why the authority runs
`animateSoldier` for every bot every tick (`battle.update(dt, ORIGIN)`).

**Nothing is threaded.** No `Worker`, `SharedArrayBuffer`, `Atomics` or
`worker_threads` anywhere; no COOP/COEP headers. `index.html` loads nothing
cross-origin, so cross-origin isolation costs nothing to turn on.

---

## Step sizes

**S** under a week · **M** one to three weeks · **L** a month or two · **XL**
more. For one person with an agent; they are for ordering, not promising.

---

## P0 — The numbers every later gate reads — **TAKEN ON GREYFEN; THE TRACE WAS NOT**

**Result (`FINDINGS.md` 50, 2026-10-08):** on Greyfen at render scale 0.5 the
simulation (`world` + `onFoot`) is **0.5-1.0 ms of a 9.5-12 ms tick, 5-8%**,
and rendering is ~76% of it. The GPU averaged ~16.3 ms with a ~27 ms p95 — ~3
ms heavier than finding 13 at the same spot — and was over 16.7 ms on 38-59%
of frames, so **at 0.5 the phone's GPU is now the limit**. The gates below
resolved as:

- **Sim share under 15% → Part C does not move the phone frame.** It is
  demoted (see Part C's heading) and survives only on its own server and
  determinism case.
- **Draw count vs. the browser floor: not settled**, because the trace could
  not be taken (USB and wireless debugging both failed on the Windows box).
  Part A goes ahead regardless; Part B waits on G1.
- **New, and not a gate this step anticipated: the GPU.** G1 below.

Items 3 and 4 (the census and the desktop baseline) are still owed, and are
the "before" Part A's steps measure against. Harrowmead and Cinderhaven phone
captures can be added any time without redoing Greyfen's.

The step as written, kept for the remaining items:

Nothing after this may claim a saving without a "before" from here.

1. **Split the phone's tick.** `?profile&gpu` captures on the `FINDINGS.md` 13
   phone, at render scale 0.5, at the Greyfen spawn and on Harrowmead and
   Cinderhaven (the 24-a-side case): the mean and p95 of `world` (and each of
   its children — `bots`, `combat`, `vehicles`, …), `onFoot`, `driver`, and
   `render` (`shadowPass`, `glow`, `drawWorld`, `drawOverlay`). Several runs a
   side; that finding shows one configuration spans 6-24%.
2. **The DevTools trace finding 13 asked for** (`chrome://inspect`, a minute at
   the spawn): whether a held frame is the GPU process still encoding the last
   one. This is what says whether DRAW COUNT (Part B) or MAIN-THREAD time (Part
   C) is the phone's lever, or neither.
3. **Re-take the active-mesh census** on Cinderhaven, Coldharbour and Greyfen:
   active meshes by class (rigs, blocks, terrain, vehicles, scatter, pools,
   emissive), draws per pass (main, each shadow generator, `BodyShadows`, the
   lamp atlas, the glow mask). The 39 and 43 tables are too stale to size a
   step against.
4. **A desktop baseline** at the banked vantages, through the existing
   instrument (`FrameProfile`, `buildProfile.ts`) — never a new one.

**Output:** a `FINDINGS.md` entry with the tables. **Gates it sets:**

- If the sim share of the phone tick is under ~15%, Part C will not move the
  phone frame; it still pays on the server and in determinism (C's own
  rationale), but say so in C1's opening line rather than discovering it at C4.
- If the trace shows held frames with the GPU process busy, Part B is the
  phone's lever and goes before Part C, as ordered here. If it shows neither
  process busy, the phone is at the browser floor: finish Part A, re-read this
  plan, and do not start B or C on the phone's account.

---

## G1 — The phone's GPU at render scale 0.5 — **S, before Part B**

`FINDINGS.md` 50: the GPU is ~3 ms heavier than finding 13 measured, and it is
now what holds the phone under 60 at the lowest scale. Part B cuts the CPU cost
of drawing; it does little for this, so **Part B's value on the phone is
unknown until G1 is done**. Part A does not wait for it.

1. **The desktop proxy** (no phone): `?gpu` on the Windows box at the Greyfen
   spawn, volumetrics `off`/`low`/`medium`, and shadows `low` at 684a88c
   against its parent. Says only whether either is large anywhere.
2. **The phone**: the same spot and settings as finding 50, two standing
   captures per arm — volumetrics `off`; then, if `gpu.frame` is not back near
   13 ms, shadows `off` as well.
3. **The fix follows the culprit.** Volumetrics: a coarse-pointer default
   (`defaultVolumetricQuality`, the pattern its neighbours in `Settings.ts`
   already use — a fresh install gets `medium` on every device today) and/or a
   cheaper phone rung. The shadow lookup: a cheaper path on the `low` rung.
   Neither: finding 13's step 3, pricing the cel fragment's terms one by one.

---

## Part A — The cheap levers, inside Babylon as it stands

Each is independent; the order is by certainty of payoff. **A1 is IN
PROGRESS.**

### A1 — Parts stop being meshes (`FINDINGS.md` 26) — **LANDED, -16 TO -28% ON EVERY MAP**

**Done (2026-10-08, 8fbf663..f4b8fe9).** `npm run merge:hash` is the oracle;
against it every cut below hashed identically on all eight maps, and the one
change that did not is its own commit and says so:

- the cached unit box; `mergeToPart` (a merge `BlockMerge` merges again
  stays a part); `bakePart` (a lone colour uploads once, or not at all);
- the shading bake's per-box trig and `hypot` taken out of the vertex loop;
- the scatter props built as parts instead of through `MeshBuilder`;
- **one look change, 907c0f0**: a kit structure's bounce colour weighted by
  part size again — parts report zero-size bounds, so every part had weighed
  the same since the flatten. Bounce light only; nothing with GI off.

`build:total`, pre-A1 (684a88c, measured in a worktree) against f4b8fe9, two
or three runs a side on the Windows box:

| map | before | after | |
| --- | --- | --- | --- |
| Greyfen | 13.27 s | 9.93 s | -25% |
| Cinderhaven | 9.28 | 6.72 | -28% |
| Harrowmead | 9.10 | 7.61 | -16% |
| Kurenai | 7.27 | 5.67 | -22% |
| Coldharbour | 4.59 | 3.54 | -23% |
| Sarab | 4.38 | 3.38 | -23% |
| Hollowmere | 3.35 | 2.56 | -24% |
| proving ground | 10.08 | 7.67 | -24% |

**What is left, and why it stops here.** On Greyfen, the biggest: the FINAL
upload of the merged world (~1.2 s, unavoidable — it is what gets drawn; the
arrays arrive as plain JS arrays and a typed-array merge would save some of it
but rounds vertices in a different order, which no oracle can call harmless),
`buildJungleTree`'s own geometry (~2 s, art code), and the bake (~1.5 s over
~6 M vertices). The merge-only accumulator this step was written around is no
longer worth building: with most builders on `StoneBatch`, a `Mesh` per part
is ~300 ms of Coldharbour's build.

A kit part is built as a full `Mesh` (uniform layout, GUID, registration),
tessellated from scratch, merged and destroyed; ~76% of the placement loop is
that round trip, and it is the install's biggest single cost. `StoneBatch` and
`Mesher` already avoid it for the 23 files that use them.

- A **merge-only path** in `src/world/parts.ts`: `partBox`/`Build.box`/`cyl`/
  `pane`/`glow` append transformed vertex data to per-material accumulators
  instead of constructing a `Mesh`, one shared unit-box tessellation, no GUID.
  `uploadPart` and EDITOR builds keep real meshes (finding 26: "any fix must be
  a second, merge-only path").
- The collider half stays as it is: `moveWithCollisions` needs subMeshes, and
  C2 removes that need anyway.
- **First, commit the oracle finding 26 says does not exist**: a per-mesh hash
  of the MERGED visuals and colliders over every shipped map and the proving
  ground (`scripts/`, beside `kit-hash.mjs`). `kit:hash` covers the half
  before the merge; this covers the half after it. B1 needs the same oracle.

**Verify:** the merged hash identical on every map, `npm run kit:hash
--against` identical, `npm run parity`, `buildProfile` before/after on
Coldharbour and Sarab. **Buys:** load time, not frame time. It is first because
it is certain, and because B1 starts from geometry as typed arrays.

### A2 — The emissive palette (`FINDINGS.md` 43) — **M**

The glow mask draws every lit window a second time: 123 mask draws on
Coldharbour's street view, ~1.44 ms of `glow` on the phone. An emissive
palette — emissive colour into the vertex data as the albedo palette did for
diffuse — takes those meshes from ~123 to ~40 and pays twice (the world pass
and the mask), ~2.6 ms of a 20.1 ms phone frame.

- **Cost it before starting it** (the finding says so): six readers ask a
  material for its colour and must ask a vertex instead — `getEmissive`
  (`CelShader.ts`), `EmissiveFog`, `GlowPass.buildList` and its mask shader,
  `GlowRules.colour` (`Game.ts`), `WorldCulling.glows`, and the merge key.
- An emissive is an unlit `StandardMaterial` today, and vertex colours multiply
  diffuse, so the likely shape is an emissive ShaderMaterial in WGSL carrying
  the fog `EmissiveFog` adds — which is also what B1 will want.
- **All four vertex colour channels are spoken for** (CLAUDE.md), so the colour
  goes in a palette index through a UV slot exactly as the albedo did, never a
  fifth colour channel.

**Verify:** frozen-frame diffs at the banked vantages on Coldharbour and
Hollowmere at night; the census from P0; the phone's `glow` and `drawWorld`.

### A3 — Vehicles get a detail tier and a draw distance (`FINDINGS.md` 39) — **S-M**

Every hull draws every part at any range. Measured: a detail tier (silhouette
kept, running gear and fittings dropped) +6.5% at 300 m on Cinderhaven; a
vehicle draw distance of 420 m +15.4% (and 420 is a body's number — a hull is
~4x a body, so its distance should be larger).

- `segmentOf`/`mergeByColor` (`entities/vehicleRig.ts`) emit a second, reduced
  merge per segment; the swap is by projected size, computed the way
  `WorldCulling.offer`'s size gate already computes it, and the full merge
  must be the one the PIPELINE WARM-UP shows (`docs/game.md`).
- **The detail set is an art call** (`tank-link`, `tank-wheel`, the MG rings):
  get it from the user before building it.
- The draw distance is an `EnvironmentSpec` field defaulting to "unaffected",
  like `bodyDrawDistance`, or a derived multiple of it — decide which in the step.

### A4 — A body fades instead of popping (`FINDINGS.md` 30) — **M**

Not a saving by itself; it is what makes the saving acceptable. Finding 39
measured `bodyDrawDistance` 420 → 300 at +21.4% on Cinderhaven and left it as a
look decision because a body POPS. A fade makes the shorter distance a
reasonable look call.

- Two pops, one fade: `bodyDrawDistance` AND the size gate's whole-body drop
  (3 px drops a body at ~290 m on the phone's 384-tall viewport — inside
  Coldharbour's 480 m). A fade built for one misses the other.
- A rig is fourteen meshes and two materials and must stay that way (CLAUDE.md,
  "Bots"), and `visibility < 1` is a different, blended pipeline. So the fade
  is a screen-door DITHER (`shaders/Dither.ts` exists) driven per rig without a
  material per rig — how (a per-instance value the rig's two materials read, or
  a vertex-buffer write on the 14 meshes) is the step's first question.
- The pipeline warm-up owes the dithered pose a `warm` (CLAUDE.md, "loading").

### A5 — Occlusion culling with the collider boxes (spike, then build) — **S spike, M build**

Nothing culls by occlusion today: `WorldCulling` culls by fog distance, size
and Babylon's frustum. Every wall in the game already exists as a box
(`GameMap.colliderBoxes`, client-side at runtime). A coarse CPU depth raster of
those boxes — oriented, yaw and pitch only (`WorldBox`) — tested against
candidate bounds is the classic software occlusion cull, and the occluders
come for free.

- **Spike first, without building the culler**: at the banked vantages on
  Coldharbour, Harrowmead and Sarab, count how many of the active meshes a
  perfect box-occlusion test would reject, by class. Block-merged meshes are
  coarse (48-200 m), and `docs/rendering.md` already found them too coarse to
  occlude for the glow, so the win is expected in rigs, vehicles, loose meshes
  and pools, not blocks. **If the spike rejects under ~10% of active meshes,
  stop**, and write the finding.
- If built: occluders are ordinary boxes only — never `porous` (a fence you see
  through), never `glass`, never `rayOnly` struts. It drops CANDIDATES in
  `WorldCulling.offer` and writes nothing onto a mesh. It applies to the main
  pass only; a shadow caster behind a wall still casts.
- Raster resolution, the frame it reads (this frame's camera, so it never lags),
  and a TS-or-WASM decision come from the spike's own cost.

### A6 — Snapshot rendering (spike, expected to fail) — **S, time-boxed to two days**

Babylon's WebGPU snapshot rendering records the render bundles once and replays
them, which would take most of `drawWorld`'s CPU off the page. **It is expected
to hit the same wall as `freezeActiveMeshes`**: a snapshot is a frozen draw
list, and this game toggles pool visibility every shot, rewrites thin-instance
counts every frame (grass, `BlastFx`, `BodyShadows`, `LocalShadows`) and flips
cull cells as the camera moves.

The spike answers one question: can a snapshot cover a SUBSET (the static
world) while the dynamic draws are recorded normally, and what does re-recording
cost on a cell flip? **If not, close it** with a `docs/rendering.md` paragraph
beside the `freezeActiveMeshes` one, so nobody tries it again. If yes, it is a
cheap way to bank part of B1's gain early. Nothing in Part B depends on it.

### Gate after Part A

Re-run P0's tables. Update `FINDINGS.md` 26, 30, 39 and 43 (fixed or narrowed).
Then Part B, if G1 left the phone CPU-bound enough for it to matter; Part C
only on its own non-phone case.

---

## Part B — Fewer active meshes: a GPU-driven renderer for the static world

**The aim is to make draws scale with MATERIALS, not with BLOCKS or PROPS.**
WebGPU has no standard multi-draw-indirect, so "one indirect draw per object"
saves nothing. Two techniques give the reduction:

- **Unique geometry (merged blocks, terrain) → clusters.** Split each block's
  per-material geometry into clusters of ~128-256 triangles with bounds. A
  compute pass culls clusters (frustum, the fog reach `WorldCulling` uses, the
  size gate, and A5's occlusion if it was built) and writes a compacted index
  list plus ONE `drawIndexedIndirect` per material per pass. Culling gets
  FINER than today's block cells while draws drop to the material count.
- **Repeated geometry (scatter) → instances.** Scatter is seeded and made of a
  few kinds × variants × foliage rungs. Instead of flattening every prop into
  its block, keep one mesh per (kind, variant, material) and a transform per
  placement; compute culls placements into an instance list, one indirect draw
  per (kind, variant, material). Greyfen's ~1,400 palms become a handful of
  draws.

### B0 — The shared WGSL — **M**

The new path's materials must be the cel material, not a copy of it — two
copies drift, and the failure is silent. Factor `CelShader.ts`'s fragment (the
key, ambient and sky fill, point lights, both shadow maps and the lamp atlas,
`celCloud`, GI, fog, wear, the coverage alpha `opaqueAlpha`) into WGSL chunks
both the Babylon `ShaderMaterial` and the new pipelines include. No pixel may
move: frozen-frame diffs at the banked vantages, every map.

- The bumped ground variant is at **16 of WebGPU's 16 sampled textures**. The
  new path's storage buffers do not count against that limit, but anything it
  SAMPLES does — check per variant.

### B1 — The main pass for the static world — **L**

- A new module (`src/render/`, a contract header like every file) that is
  **engine-agnostic by construction**: it owns its buffers and pipelines and
  takes a `GPUDevice` and a pass encoder. It never imports a Babylon type. This
  is what lets B4 move the frame's ownership later without a rewrite.
- Built from A1's typed arrays in `installMap`, and taken back in
  `Game.teardownMap` (CLAUDE.md: anything `installMap` hands a map to owes a line
  there).
- Only the MAIN pass at first. Blocks drawn by the new path are taken out of
  `WorldCulling`'s candidate list for the main pass; the Babylon meshes stay
  alive for every other pass until B3 moves it.
- Draws inside Babylon's main render pass, after the opaque meshes, against the
  same depth (`FrameDepth.ts` already borrows it). **How it gets the pass is the
  step's first question**: a supported Babylon hook if one exists, otherwise an
  internal — and whichever it is, it is written in ONE place.
- The contracts it must keep: `metadata.block` becomes a per-cluster block id
  (`ReflectionSystem.encloses` reads it); fog to `fogEnd`; the coverage alpha
  writes 0; `opaqueAlpha` flips to 1 under a probe bake; wind sway's red-channel
  ramp and the rigged layers' `uv`; the frozen-define discipline.
- **The bundle trap**: `docs/rendering.md` records that a bundle replayed into a
  pass with different attachments fails. Every pass this module draws into
  states its attachment formats once.

**Verify:** frozen-frame diffs; P0's census (main-pass active meshes, draws);
the phone's `drawWorld` and tick; desktop fps on Coldharbour and Cinderhaven.
**This is the step that says whether Part B pays.** If the main pass's draws
fall and the phone's frame does not move, stop and write the finding before B2.

### B2 — Scatter as instances — **M-L**

`scatterRegion` (`MapBuilder.ts`) flattens each prop into its block today.
Keep the placement and the seeded RNG exactly as they are — the dressing field,
the nav graph and the collision bake all depend on it (CLAUDE.md, "The map is
data") — and change only what is emitted: one source mesh per (kind, variant,
material, foliage rung) and a transform list.

- Wind, the rigged `frond`/`bough` layers and the wear bake read world position
  and per-vertex values; with instancing the vertex shader computes world
  position from the instance transform. The AO bake runs per placement today —
  either bake per kind (cheaper, and it changes the look) or carry per-instance
  AO (not cheaper). That is a look call; ask.
- **Verify:** `npm run kit:hash` (scatter is hashed over fixed seeds and rungs,
  including the rng-draw count), `npm run collision` + `npm run parity`
  (CLAUDE.md: a placement-rule change owes both), frozen frames on Greyfen and
  Kurenai.

### B3 — The other passes — **L**

Each pass that draws the world moves to the new path, one at a time, each
measured: the far and near shadow cascades and the foliage map
(`ShadowSystem`), the lightning flash map, the lamp atlas's static-face bakes
(`LocalShadows`), the reflection bake (`ReflectionSystem`, behind the loading
card), the glow mask (`GlowPass`, after A2's palette), and the pipeline
warm-up's frames (CLAUDE.md, "loading": a new pool that idles switched off owes
one). Shadow casters must stay CLOSED shapes — the world's map records back
faces.

When the last pass moves, the Babylon block and scatter meshes are no longer
built for a round. Editor builds keep the old path (the editor picks and drags
meshes; `docs/editor.md`).

### B4 — Who owns the frame — **decision, then S or L**

By here the new path draws the world into roughly eight passes Babylon owns. If
reaching each pass needed a Babylon internal, every Babylon upgrade can break
eight places. **The criterion**: count the internals B1-B3 needed. If it is one
seam, keep Babylon owning the frame. If it is one per pass, take the frame
loop: a loop of our own that runs the passes and calls Babylon's scene render
for what remains Babylon's (rigs until C5, pools, the viewmodel, particles,
post). The module was built engine-agnostic so this is a wiring change, not a
rewrite. **Removing Babylon outright is not on the table here**; only the
question of who calls whom.

### B5 — Terrain — **M**

~153 active terrain patches on Cinderhaven. Clusters, as the blocks. Last in
Part B because the floor carries the most contracts — the road depth bias in
the material cache key, the turf, `terrainBlock` agreeing across the three
callers of `terrainPatches`, the collider clone (which stays as it is) — and
the gain is a third of the blocks'.

---

## Part C — The simulation off the main thread — **DEMOTED: NOT FOR THE PHONE'S FRAME**

**P0 answered the question this part was opened for, and the answer is no.**
The whole simulation is 0.5-1.0 ms of the phone's ~9.5 ms tick on Greyfen
(`FINDINGS.md` 50), so no stage below can buy the phone a frame. What is left
is its other case — the authority stops running a scene and posing rigs, and a
round becomes reproducible from a seed. Do it for that or not at all, and only
after Part B. C1 (seeded randomness) is small and stands on its own if the
determinism half is wanted.

**The order matters more here than anywhere: extract first, in TypeScript;
move it to a Worker, still TypeScript; only then port it to Rust.** Each stage
is shippable, and each is the test for the next — if the Worker does not free
the main thread, Rust will not either.

**What Part C buys even if P0 says the phone's tick is mostly render:** the
authority stops running a scene and posing rigs to read muzzles; the
simulation becomes deterministic (shots replayable, parity provable by
construction); and the same code runs in the client's Worker and on the server.
Say which of these a step is for.

### C1 — Seeded randomness in the simulation — **S**

`Math.random` decides outcomes in `CombatSystem` (the spread cone, every shot),
`ConquestSystem` (spawn choice, `scatterSpawn`) and `VehicleCrew` (crew aim).
Move each onto a seeded `mulberry32` stream (`world/rng.ts`), per shooter where
bots already have one. Visual-only uses (`GrenadeSystem`'s spin, `Player`'s
casings) may stay. **Verify:** `npm run parity`, `npm run simulate`; a round
replayed from a seed reaches the same score.

### C2 — The three sweeps stop being Babylon's — **L**

The one thing in the simulation that is genuinely Babylon's code:
`narrowedMove` hands `moveWithCollisions` (ellipsoid against collider
TRIANGLES, with Babylon's retries and `CollisionsEpsilon`) a narrowed list. The
colliders are boxes, oriented by yaw and pitch, plus the terrain. Replace the
sweep with an analytic swept-ellipsoid (or capsule) against `WorldBox`es and
hull boxes, over the same buckets `CollisionField` already keeps.

- It answers `castBody`'s question exactly: ordinary and `porous` boxes block,
  `rayOnly` struts and broken glass do not.
- It is **not** bit-identical to Babylon's sweep, and cannot be. The feel is
  the acceptance test: sliding along walls, stairs and the plank (`docs/
  vehicles.md`), a hull against a shopfront, corners. Build a scripted
  comparison — the same input sequences through both sweeps, positions logged
  — and investigate every divergence over a few centimetres rather than
  accepting it in aggregate.
- `ObstacleField.resolve`, `groundAt` and the push-out primitive are unchanged
  (CLAUDE.md, "Visual meshes and collider proxies").
- When it lands, the server needs no collider meshes and no `NullEngine` for
  collisions (`server/world.ts`'s own header says those meshes exist only for
  `moveWithCollisions`). `server/validate.ts`'s noclip test reads the same query.
- **Verify:** the comparison harness; `drop.mjs --check` on every map; `npm run
  parity`; a played round on foot and in each vehicle kind.

### C3 — State off the nodes — **L**

Make every authoritative value a plain field, with nodes as one-way views:

- **Player**: position off the capsule mesh `root.position` (`Player.ts`), as
  `server/NetPlayer.ts` already does.
- **Vehicle**: `body.position`/`rotation.y` become fields; `rayBox()` reads the
  fields; `body.isPickable`/`isEnabled()` used as simulation state (including
  the authority's LOS toggle in `HeadlessGame`) become explicit flags.
- **Grenades and rockets**: state is `{pos, vel, …}`; the mesh is a view.
- **Muzzles**: `Bot.muzzleWorld` and `Vehicle.muzzleToRef`/`mgMuzzleToRef`/
  `mgSightToRef` become ANALYTIC — a function of position, yaw, stance, aim and
  the model's own constants — instead of a forced world-matrix read off an
  animated rig. A bot's rocket origin moves by a few centimetres; tracers and
  the gunshot cue may keep the rig's muzzle on the client, since they are
  pictures. Then the authority stops posing rigs at all
  (`battle.update(dt, ORIGIN)` exists for those reads), and CLAUDE.md's
  forced-world-matrix rule loses its reason to exist on the server.
- Rig animation leaves the `bots` phase: the simulation emits what a pose needs
  and the client poses.

**Verify:** `npm run parity`, `npm run simulate`, `drop.mjs --check`, a netplay
round, and the profiler's `world` phase on the authority before and after.

### C4 — The simulation in a Worker, still TypeScript — **L**

- **One interface**: inputs (the local player's commands, net events) → `step(dt)`
  → outputs (state in typed arrays, double-buffered in a `SharedArrayBuffer`,
  and an event queue: shots, hits, kills, captures, blasts, sound cues).
  `Game` consumes the queue and does the wiring it does today — `onBotKill`,
  `onCaptured` and the rest become events read in `Game`, which keeps
  "systems never import each other" true on the main thread.
- **The local player stays on the main thread** with the camera, so input-to-
  photon latency is unchanged; it reads the world from the last published
  state and its own sweep (C2's, now plain code) runs locally. Bots and
  everything else run a frame ahead in the Worker; a frame of bot latency is
  invisible. A netplay client already simulates no outcomes (`updateNetWorld`),
  so the Worker is the OFFLINE sim's home; the authority runs the same core in
  `worker_threads` or in-process.
- **Cross-origin isolation** (needed for `SharedArrayBuffer`): COOP
  `same-origin` and COEP `require-corp` on the document from the Vite dev
  server, `docker/default.conf.template`, and anything in `server/` that serves
  the client — and on the navigation responses the service worker answers from
  its cache, or the installed app silently loses isolation offline
  (`docs/pwa.md`; the same failure shape as the `DOCS` list).
- **Verify:** the phone's main-thread tick before/after against P0's split.
  **If the main thread does not get faster by roughly the sim's share, stop
  and find out why before C5.**

### C5 — The core in Rust, compiled to WASM — **XL**

- Port module by module behind C4's interface, hottest first by the profiler:
  the bot think and steer, `RayWorld`, `ObstacleField`, combat resolution, then
  the rest. The TypeScript core stays as the reference until the port is whole.
- **A lockstep harness**: TS and WASM cores stepped side by side on recorded
  inputs, state compared every tick within a tolerance. Use `f64` throughout to
  match JS numbers, and `mulberry32`'s `Math.imul`/uint32 semantics exactly;
  NavGrid's `Float32Array` heights and `Uint16Array` fields stay those widths.
- The server loads the same `.wasm` (Node 24 runs it); a match then runs the
  identical binary on both sides.
- Threads inside the core (bots thinking in parallel) come last, if C4's
  measurements say one Worker is not enough.

### C6 — Dynamic draws from the shared state — **L**

With state in typed arrays and B1's renderer in place, the per-frame meshes
become instances fed straight from that buffer: rigs (14 joint meshes × up to
48 bodies → 14 instanced draws, or fewer), pooled effects, grenades. Joint
poses are computed in the Worker beside the state. This is the step that takes
Cinderhaven's ~212 rig meshes down to a handful, and with it B4's last reason
for Babylon to own the frame (re-ask B4's question here).

- The rig's shape is `RAGDOLL_BONES` and `BodyShadows` draws from it; a corpse
  is reparented onto Havok proxies (`RagdollSystem`) and so stays a Babylon
  rig. Only living bodies move.

---

## Contracts this plan rewrites

Each is rewritten by the step that breaks it, in the same commit:

- **CLAUDE.md, "Havok's .wasm is the one binary that ships"** — C5 ships a
  second. `docs/build.md` gains its generator and build rule.
- **CLAUDE.md, "Ownership and wiring"** — from C4 the simulation's systems meet
  inside one core behind one interface; `Game` wires the core's EVENTS. State
  the new rule; do not let it be inferred.
- **CLAUDE.md, the forced world-matrix rule** — C3 retires its server reason.
- **CLAUDE.md, "Visual meshes and collider proxies"** — C2 replaces
  `moveWithCollisions`; "exactly three sweeps through `narrowedMove`" becomes
  the new primitive's rule.
- **CLAUDE.md, "The frame WALKS the scene"** and `docs/rendering.md`'s culling
  sections — B1-B3 move the static world out of `WorldCulling`'s candidate list.
- **`docs/multiplayer.md`** — C2/C3 change what the authority builds
  (`buildServerWorld`) and whether it runs a scene.
- **`FILES.md`** — every new module gets its line.

## What this plan does not fix

- **Fill on a phone at render scale 0.75.** `FINDINGS.md` 13: 27.8 ms of
  `gpu.frame`, flat against draw calls. That is the cel fragment's and the
  full-screen passes' cost per pixel, and its lever is cheaper per-pixel work —
  finding 13's step 3 prices it. Nothing here touches it.
- **The browser's floor.** The compositor's scheduling and copy, no control of
  present mode or pacing (`FINDINGS.md` 1: "the frame was simply not
  scheduled"), per-tab memory caps. P0 says how high it sits on the phone.
- **The deploy screen's first-second stall** (`FINDINGS.md` 16) — not a compile,
  and unexplained.
- **The collider half of finding 26** until C2 lands.

## The measurement protocol

`ENGINE_UPGRADE.md`'s, unchanged: one instrument, one lever, one session; read
nothing under ~8% as real; say which kind of draw before predicting a saving
from a count; re-measure through `FrameProfile` and `buildProfile.ts`, never a
new instrument. **On the phone, several runs a side** — one configuration has
spanned 6-24% in an hour. Every number a step claims leaves a `FINDINGS.md`
entry, and an entry leaves that file by being fixed or disproved.
