# ENGINE_UPGRADE.md — what a 1500 m map costs, and the order to buy it in

The engine work standing between this tree and a **1500 x 1500 m** map that
holds a frame rate. Written to be handed to a coding agent **one step at a
time**: each step is independently landable, independently verifiable, and
ordered so that the one before it has already told you whether the one after it
is still necessary.

`CLAUDE.md` is still the source of truth for every invariant named here, and the
subsystem contracts under `docs/` are still the contract for the code each step
touches. This file argues about COST and ORDER and nothing else. Where it
disagrees with a contract, the contract wins and this file is wrong.

**Nothing here is a map.** The desert city is S11, and it is deliberately last:
authoring content against an engine that cannot hold it is how you end up unable
to tell a layout problem from an engine one.

---

## Context

The largest shipped map is Harrowmead at **400 m**. The ask is **1500 m** —
**14.1x Harrowmead's area** and **22.0x Coldharbour's**. Six systems under
`src/world/` and two inside Babylon scale with map AREA rather than with what is
on screen, and at this multiplier four of them stop working rather than merely
getting slower. A fifth — the reflection bake — was not in this document at all
until S0 measured it, and it is the one that fails hardest.

The reference numbers throughout are `FINDINGS.md` **17**, **18** and — since
S0 landed — **19**, all measured on the Windows box (RTX 4070 Ti SUPER, headless
Chromium via `channel: "chromium"`, 1920x1080, uncapped, warm past the compile
stall). **Read all three before starting any step**, because they also record
what has already been tried and did not work.

**S0 HAS LANDED, and finding 19 is what it produced.** Every projection in the
walls below has been replaced with a measurement taken on a generated 1500 m
proving ground (`src/world/proving/`, `npm run proving`). Where a derivation
survived it is marked as CONFIRMED and its measured value is beside it; where it
did not, the measurement is what this document now says and the derivation is
recorded beside it so nobody re-derives it. **The play/margin decision is
settled: 900 m of play inside 1500 m of ground**, and the committed proving
ground is that variant.

| | Hollowmere | Coldharbour | Harrowmead |
| --- | --- | --- | --- |
| size | 240 | 320 | 400 |
| populated merge blocks | 32 | 45 | 44 |
| collider boxes (baked) | 824 | 768 | 748 |
| `surfaces` | 3 | 4 | 3 |
| `fogEnd` | 78 | 480 | 520 |
| active meshes (post-palette) | — | 577 | 574 |
| draw calls (post-palette) | — | 1,397 | 1,361 |
| frame | 6.1 ms | 12.8 ms | 11.9 ms |

**Everything below is now MEASURED unless it says otherwise**, on the two
proving-ground extents finding 19 describes: **1500 / 0** (the whole extent is
play) and **900 / 300** (a 900 m play square inside a 300 m borderland). Both
are 1500 m of ground across. Where a figure is still derived it says so, and
those are the hypotheses the step that touches them has to settle.

---

## The five walls

### Wall 1 — the frame walks the whole scene, and the scene is the map

**The largest single number in this document, and S0 confirmed it while
correcting both of its terms.** The scene's mesh count is proportional to map
area — merged world meshes, terrain patches, terrain collider clones, and every
collider cluster — and `_evaluateActiveMeshes` walks all of it every frame.

| measured, probes stubbed | Coldharbour | 900 / 300 | 1500 / 0 |
| --- | --- | --- | --- |
| scene meshes | 2,213 | 9,002 | **23,014** |
| active meshes | 644 | 125 | 146 |
| `_evaluateActiveMeshes` | 3.4 ms | **7.6 ms** | **23.0 ms** |
| whole frame | 13.7 ms | 10.1 ms | **30.3 ms** |
| main draw phase | 5.5 ms | 1.1 ms | 1.7 ms |

**At 1500 m, 23.0 of a 30.3 ms frame is spent rejecting meshes nobody draws**,
with a draw phase of 1.7 ms. The two proving columns keep almost the same number
of meshes and differ only in map area, so the marginal cost is
`(23.0 - 7.6) / (23,014 - 9,002)` = **1.10 us per mesh in the scene, per
frame**.

Two corrections to what this section used to say. **The mesh count was 2.4x too
high**: the derivation read Coldharbour's ~2,500 forward by 22x and predicted
~55,000, where a merged block is one mesh whatever is in it and terrain patches
are cut on a 48 m grid. And **the per-mesh rate was 1.6x too LOW**: finding 18's
0.67 us came from disabling the rejected meshes, which measures the walk with an
early-out rather than the walk in full. The two errors point in opposite
directions and the wall survives both — 23 ms is still most of a frame that
should be 16.

Frustum culling does not help. It decides what is DRAWN; the walk that reaches
that decision is the cost, and it is `O(meshes in the scene)`.

**The 900 m square is FASTER than Coldharbour** — 10.1 ms against 13.7 — because
it draws a fifth of the calls. That is not comfort: 7.6 of those 10.1 ms are
still the walk, so the frame is already wall-1-bound at a size everything else
in the engine holds easily.

**Finding 18 already closed the two obvious escapes.** A selection octree
measured **-5.4%** *and* dropped meshes that should have stayed active.
`scene.freezeActiveMeshes()` is +14.8% and must never ship — in a game whose
every effect is pooled, a frozen active list is a bug, not a trade. Both were
measured at 45 blocks; neither is the lever at 1,000.

### Wall 2 — every ray in the game walks the same list

`scene.pickWithRay` filters `scene.meshes` by predicate, then bounds-tests, then
triangle-tests. There are eight sites: the hitscan's wall cap
(`CombatSystem.fire`), the bots' LOS (`BattleSystem`), the aim assist, the
grenade's step ray and its blast check, the rocket, the death cam's pull-in, and
the tank's chase camera and ground probe.

**The precedent is already in the tree and it is emphatic.** `Player.probeGround`
was `scene.pickWithRay` with a `solid` predicate, walking ~1,800 meshes and
ray-testing ~820 colliders to find one number under one pair of feet. Measured at
**0.483 ms — a third of the game's own per-frame JS and five times the next item
on the list.** Its header says exactly what this document is about:

> it scaled with how big the MAP was rather than with anything on screen, which
> is what made it the first wall a larger map would hit.

It was retired by answering the question analytically off `ObstacleField` and
`TerrainField`. The other eight have not been.

### Wall 3 — the nav graph is allocated per CELL SLOT, not per surface

`NavGrid` sizes every array `cells * maxSurfaces`, whether or not a cell has that
many standable heights, and `FlowField.dist` is a `Float32Array` over the same
count. At `CONFIG.nav.cellSize` 1.5 a 1500 m map is `1000 x 1000 = 1,000,000`
cells. **`cellSize` is not a per-map override** — unlike `size`, `surfaces`,
`fogEnd` and `shadowWindow`, it is read straight from `CONFIG` in the
constructor.

**CONFIRMED to within 2%.** Measured off `byteLength` at `surfaces: 4` — what
Coldharbour needs, and a ruined city needs at least as much:

| array | derived | **measured, 1500 / 0** | measured, 900 / 300 |
| --- | --- | --- | --- |
| `links` (`cells * surfaces * 8` int32) | 128 MB | **122.1 MiB** | 43.9 MiB |
| `heights` (float32) | 16 MB | 15.3 MiB | 5.5 MiB |
| `walkable` + `blocked` (uint8) | 8 MB | 7.6 MiB | 2.7 MiB |
| `counts` (uint8) | 1 MB | 1.0 MiB | 0.4 MiB |
| `CoverMap` | 24 MB | **42.9 MiB** | 15.5 MiB |
| seven flow fields (float32) | 112 MB | 106.8 MiB | 38.5 MiB |
| **total** | **~289 MB** | **295.6 MiB** | **106.4 MiB** |

**The one line the derivation got wrong is `CoverMap`**, at 43 MiB rather than
24: the table counted its three `Uint16Array` masks and missed that it also
holds its own copies of the graph's `heights`, `counts` and `walkable`. That is
another 20 MiB, and it compacts with the same S3 change as the rest.

In a browser tab, alongside Havok, the Babylon scene, sixteen rigs and a 2 MB
WASM. This is the wall that is not "slower" — it is an allocation failure, and
**it lands**: at the moment the 1500 / 0 round opens, before a frame is drawn,
the JS heap is **3,536 MiB against V8's 4,192 MiB cap** and the renderer's
working set is 5.4 GB. At 900 / 300 the same figures are 1,696 MiB and 2.6 GB.

### Wall 4 — load time, and the burst builds behind the card

**This wall is real and this section was wrong about all of it.** Derived:
30-60 s behind the loading card, dominated by `NavGrid`, `CoverMap`, the flood
fill and the flow fields. Measured, from `src/world/buildProfile.ts`:

| build phase, ms | Coldharbour | 900 / 300 | 1500 / 0 |
| --- | --- | --- | --- |
| **`build:total`** | **1,635** | **11,316** | **182,889** |
| — the PLACEMENT loop | 908 | 7,564 | **159,249** |
| — block merge | 62 | 669 | 9,044 |
| — scatter | 86 | 277 | 4,313 |
| — road merge | 3 | 162 | 2,662 |
| — AO bake | 165 | 936 | 2,360 |
| — `NavGrid` | 140 | 729 | 2,328 |
| — `CoverMap` | 56 | 294 | 895 |
| — seven flow fields | 10 | 150 | 368 |
| **install to `deploy`** | **1,770** | **13,219** | **197,753** |

**It is 183 seconds, not 30-60, and the four things this section named are 3.3%
of them.** `NavGrid`, `CoverMap`, the flow fields and the AO bake are 5,951 ms
of 182,889 between them. The **placement loop is 87%**.

**And the placement loop is superlinear in the number of placements**, which is
the finding under the finding — 1.1 ms each on Harrowmead's 124, 6.6 on
Coldharbour's 137, 18.4 on the 900 m square's 410, **143.7 on the 1500 m
square's 1,108**. About `n^2.9` overall. Nothing in a builder knows how big the
map is, so this is the cost of adding one structure growing with how many are
already there.

**Derived, not measured, and it is in Babylon**: `Scene.removeMesh` is an
`indexOf` over `scene.meshes` plus a second scan of `rootNodes`, and
`mergeByMaterial` DISPOSES its sources (which is what turns Babylon's
attribute-aligning path off — see `MapBuilder`'s header). A build that creates
and destroys ~a million part meshes against a list growing to 23,014 is
`O(built x live)`. `AssetContainer` / `_blockEntityCollection` is the supported
door, and re-timing the loop through it is what settles this.

**Which means S5's premise has moved.** Finding 18 says the burst work is the
worker-shaped part of this codebase and that moving it "buys load time and
nothing else"; at 1500 m load time IS the problem, so that sentence still
inverts. But the burst work S5 names is 3.3% of the build. **Flattening the
placement loop is worth 50x what moving the nav builds to a worker is**, and it
is a smaller change.

### Wall 5 — the reflection bake takes the GPU device, and it was not in this document

**The one wall S0 found rather than confirmed, and the first thing between this
tree and a map of either size.** `ReflectionSystem` bakes one refresh-once cube
probe per glazed BLOCK at `CONFIG.graphics.reflection.size` (128), which is
priced on map area like everything else here:

| | Coldharbour | 900 / 300 | 1500 / 0 |
| --- | --- | --- | --- |
| glazing groups | 71 | 389 | 1,153 |
| probes | 40 | 265 | **770** |
| queued in | 47 ms | 1,113 ms | **15,615 ms** |
| meshes in each probe's render list | 177 | 928 | 2,434 |
| the first frame, which is the bake | 1.3 s | **never returned** | **never returned** |

**At BOTH extents the first frame after the build never completes**, given ten
minutes. At 900 / 300, 162 seconds in, the page reports:

```
Failed to execute 'requestDevice' on 'GPUAdapter': ID3D12Device::CreateDescriptorHeap
BJS - A fatal error occurred during WebGPU creation/initialization.
```

The D3D12 device is LOST during the bake and Babylon's attempt to recreate it
fails too. At 1500 / 0 the renderer process is simply replaced. **This is a
resource ceiling, not a timeout**, so a slower bake fails identically — and
every frame figure in this document was taken with `ReflectionSystem.build`
stubbed to a no-op, which is the single lever that isolates it (a probe is
refresh-once, so the steady-state frame is identical either way).

The bake is `probes x 6 faces x render list`: at 1500 m, **11.2 million draws in
one frame**. Amortising it across frames does not reduce it. The render list has
to come down, the probe count has to, or both — and the probe count is the map's
GLAZING rather than its size, so a probe per BUILDING is on the table. See S0b.

---

## The decision that changes every number above — SETTLED

**`MapLayout.size` is the PLAY square. `Borderland.margin` is ground that costs
terrain and nothing else.** Everything in walls 1-4 is priced on `size`:

- the nav grid, the flow fields, the cover masks, the obstacle field and the box
  index are all built over `size` and stop at it;
- scatter, placements, control points and spawns are authored inside it;
- the borderland is tessellated floor with a collider clone, and **bots never
  enter it**, because the graph stops at the square.

So **1500 m of ground is far cheaper than 1500 m of play**, and the split is a
free variable this plan should set deliberately rather than inherit.

| play square | margin | ground across | nav cells | walls 3 total |
| --- | --- | --- | --- | --- |
| 1500 | 0 | 1500 | 1,000,000 | **295.6 MiB measured** |
| 1100 | 200 | 1500 | 538,756 | ~156 MB derived |
| **900** | **300** | **1500** | **360,000** | **106.4 MiB measured** |
| 700 | 400 | 1500 | 218,089 | ~63 MB derived |

**S0 measured both ends of that table, and the answer is 900 m of play inside
1500 m of ground.** It is not close:

| measured | 1500 / 0 | **900 / 300** |
| --- | --- | --- |
| `MapBuilder.build` | 183 s | **11.3 s** |
| install to `deploy` | 198 s | **13.2 s** |
| frame | 30.3 ms | **10.1 ms** — faster than Coldharbour's 13.7 |
| `_evaluateActiveMeshes` | 23.0 ms | **7.6 ms** |
| scene meshes | 23,014 | **9,002** |
| JS heap at deploy | 3,536 MiB of a 4,192 cap | **1,696 MiB** |
| nav / cover / flow arrays | 295.6 MiB | **106.4 MiB** |
| the reflection bake | fails | fails |

**900 / 300 is affordable today except for wall 5. 1500 / 0 is not affordable at
all** — three minutes behind the loading card, three quarters of its frame spent
rejecting meshes, and a heap 84% full before it draws a pixel. The committed
proving ground is the 900 / 300 variant; `npm run proving -- --play 1500
--margin 0` is one command away for anyone re-testing the ceiling.

It is 5.1x Harrowmead's playable area — by a wide margin still the biggest map
in the tree — it reads as 1500 m from every vantage, and a desert city's ruined
outskirts running out into open sand is exactly what a borderland is for
thematically.

It also splits wall 1 in a useful way, and the measurement bore this out.
Structures scale with the PLAY square while the terrain patches and their
collider clones are priced on the whole 1500 m of ground either way: 9,002
meshes against 23,014, **7.6 ms of walk instead of 23.0**. That turns S1 from
the thing that decides whether this is possible into the thing that decides
whether it is comfortable — though 7.6 of 10.1 ms is still most of the frame,
so S1 does not become optional.

**Two things it does not buy.** The leash kills at `CONFIG.map.leash.seconds`
(10) — 69 m at sprint — so a 300 m margin is a horizon and not a place. And the
margin still carries real, walkable, shootable floor, so it is not free.

---

## The steps

Each is sized for one agent session. Each states what it must not break, because
in this tree that is usually the harder half.

**Standing rules for every step.** Run `npm run typecheck` after any change and
`npm run build` before calling one done. If the step touches the world layer at
all, run `npm run parity` — and remember the bake guard hashes the LAYOUT, so a
flag changed in a builder needs `npm run collision` by hand. Read `VERIFYING.md`
before writing a Playwright script, not after it has misled you; it is written
PER MACHINE and several of its rules invert between a box with a GPU and one
without. Use `plans/webgpu-ref/gate.mjs` and `bank.mjs --check` as the merge
gate: the sixteen banked frames must stay 0/255, and **a frame re-taken from the
thing under test is a test of nothing.**

---

### S0 — The proving ground, and the numbers to beat — **LANDED**

**Done. `FINDINGS.md` 19 is the result, and every wall above has been corrected
in place against it.** What landed:

- `scripts/generate-proving-ground.mjs` (`npm run proving -- --play P
  --margin M`), writing `src/world/proving/{layout,heights}.ts` — a generated
  city block grid at roughly Coldharbour's collider density, five flags, both
  home spawns, one scatter region per block. `src/world/proving/environment.ts`
  is the one hand-written file beside them, and its `fogEnd` is past the map's
  own diagonal on purpose: fog is the cheapest thing in this tree that removes
  work, and a fogged proving ground would report a frame the map does not have.
- Registration in `MAPS` behind `import.meta.env.DEV`, plus
  `scripts/check-proving.mjs` on the end of `npm run build`. It greps `dist/`
  AND `dist-server/` for two strings that exist only past that gate.
  **`dist-server/` is why the script exists rather than the habit**: Vite sets
  `moduleSideEffects: "no-external"` for the client build and leaves Rollup's
  default for SSR, so the server bundle kept the layout's control points until
  `vite.server.config.ts` was told otherwise. The client shook it out
  unassisted.
- `src/world/buildProfile.ts` — DEV-only, no-op in a production build, wired at
  fourteen points inside `MapBuilder.build`. `window.__buildProfile()` is the
  handle. This is the instrument every later step should re-use rather than
  re-invent; wall 4's table came out of it.

**What it changed about the rest of this document**, in the order it matters:

1. **A fifth wall exists and it is first.** The reflection bake loses the GPU
   device at both extents — see wall 5 and S0b, which is inserted below rather
   than renumbering eleven steps and every cross-reference to them.
2. **Wall 4's attribution inverts.** The placement loop is 87% of the build and
   the four things S5 names are 3.3%. S5 is still worth doing and is no longer
   the biggest thing in this wall.
3. **The play/margin decision is settled at 900 / 300**, on numbers rather than
   on the derived table.
4. **Wall 1 is confirmed and larger per mesh than finding 18 said**; wall 3 is
   confirmed to within 2%.

**What it did NOT measure, and what the next step to touch each owes:**

- **Anything with sixteen bots fighting.** The player spawns and the round runs,
  but the proving ground's flags are hundreds of metres apart and no engagement
  was forced. Every frame figure is a quiet frame.
- **Wall 2.** No ray was fired down a 1500 m scene. `Player.probeGround`'s
  retirement is still the only measurement this document has for that wall, and
  it is off a 240 m map.
- **`ObstacleField`'s footprint**, which reported no typed arrays and is absent
  from the memory table.
- **The reflection bake's cost as a curve.** It is a pass/fail at three points,
  not a rate.

---

### S0b — Survive the reflection bake

Wall 5. **Nothing after this can be verified without it**, because nothing after
it can draw a frame on a map this size — S0's own figures had to be taken with
`ReflectionSystem.build` stubbed to a no-op, and that is not a thing anyone can
ship.

It is lettered rather than numbered because it was discovered rather than
planned, and renumbering S1–S11 would stale every cross-reference in this file
and in `FINDINGS.md`. Read it as coming first.

The bake is `probes x 6 faces x render list`. At 1500 m that is 770 x 6 x 2,434
= **11.2 million draws in one frame**, and it dies on
`ID3D12Device::CreateDescriptorHeap` rather than on time. Three levers, and they
are not exclusive:

1. **Cut the render list.** `ReflectionSystem.opaqueWorld` is every opaque mesh
   in the map. A probe standing inside one building does not need the far side
   of the map in its cube — the same neighbourhood test S1 is about, applied to
   a render list instead of to the frame. This is the one that composes with the
   rest of the plan.
2. **Cut the probe count.** It is one per glazed BLOCK today, and the count is
   the map's GLAZING rather than its size. One per BUILDING, or one per N
   blocks with the nearest bound to each group, is a smaller number without
   being a different feature. `PaneBlocks` already files glazing under the block
   key, so the grouping exists.
3. **Spread the bake over frames.** `RenderTargetTexture.refreshRate` is
   render-once and all of them land on the same frame. Baking a few per frame
   behind the loading card turns one 11-million-draw frame into many small ones
   — but note that this alone does NOT fix it: the failure is a descriptor-heap
   ceiling, not a frame budget, and 770 live cubes is 400 MB of texture whether
   they are filled in one frame or a thousand.

**Must not break:**

- `docs/rendering.md`'s seven load-bearing details of the bake, and the three
  ways a cube probe goes flat. In particular `noReflect` and
  `ReflectionSystem.encloses`: a probe drops its own block from its own bake,
  and an ink twin is an inverted hull that reads as a sealed room from inside.
- **Probes are pooled and never disposed**, like the bot rigs.
- **An EDITOR build bakes nothing**, which is what keeps a rebuild affordable.
- The eye hook: the cel materials' eye is saved and restored around the whole
  render-target block, never per probe.
- A map with no glazing must still bake nothing and cost nothing.

**Verify:** the proving ground at 900 / 300 reaches a steady-state frame with
the bake ENABLED, and `bank.mjs --check` stays 0/255 on all sixteen banked
frames — the glazing on Coldharbour is exactly what would change if a probe's
render list lost something it needed.

---

### S1 — Block visibility: stop walking the whole scene

Wall 1, and — once S0b has made a frame possible at all — the step that decides
whether the frame is affordable. **Measured, it is 23.0 of a 30.3 ms frame at
1500 / 0 and still 7.6 of 10.1 ms at the chosen 900 / 300**, so it does not
become optional at the smaller square. The number to beat is **1.10 us per mesh
in the scene per frame**, over 9,002 meshes.

Add a manager that **enables and disables whole map blocks** around the camera,
so Babylon's per-frame walk sees a neighbourhood rather than a map.
`metadata.block` (`"3,2"`) is already written by `BlockMerge.finish`, already
read by `ReflectionSystem.encloses`, and `PaneBlocks` files glazing under the
same key — so the grouping exists and does not have to be invented. Terrain
patches carry the same convention (`TerrainPatch.key`), cut on the heightfield's
grid lines rather than on `BLOCK_SIZE` seams, which is fine because the key is a
name and not an alignment claim.

**Two radii, not one, and this is the part that will bite.** A disabled mesh is
invisible to `pickWithRay` as well as to the draw, so:

- **Visuals** may cull at the map's `fogEnd`, because past it there is nothing to
  see and nothing else reads them.
- **Colliders** must stay enabled out to **the longest ray in the game** — the
  weapon `range` a hitscan caps against, the tank gun's, the rocket's — or a
  round fired at a target you can see passes through the wall in front of it, the
  client and the authority disagree, and nothing says so. Derive that radius from
  `CONFIG` rather than writing a number.

That split is the design rather than an implementation detail: the two lists have
different reasons to exist and have never had the same reach.

**Must not break:**

- Pooled anything — rigs, tracers, shards, ragdolls, grenades, effect meshes.
  None are block-keyed and none may be touched. This is precisely why
  `freezeActiveMeshes` is a bug and this is not.
- `ShadowSystem.setCasters` and `ReflectionSystem`'s render lists, both of which
  hold explicit mesh lists and both of which the contracts say must be replaced
  on every install before the next frame.
- `GlassSystem`'s vertex ranges into `paneGroups` meshes — a disabled pane block
  must still break correctly when it comes back.
- `NavGrid`, `CoverMap`, `ObstacleField` and `Player.probeGround`, all of which
  read `WorldBox`es and the terrain FIELD rather than meshes and are therefore
  correctly indifferent to this whole step. Keep it that way.
- The editor, which keys per placement and does not block-merge.

**Verify:** S0's harness, same session, single lever. Then `bank.mjs --check` at
0/255 — the picture must not move at any banked vantage — and a scripted round on
the proving ground firing at the furthest wall a weapon can reach, asserting the
impact lands.

---

### S2 — Retire the whole-scene picks

Wall 2. Replace `scene.pickWithRay` at the eight sites with a segment query
answered analytically against `colliderBoxes` through `boxIndex`, plus
`TerrainField` for the floor — exactly the shape that retired
`Player.probeGround`.

`world/solid.ts`'s two predicates become two filters over box flags: `SOLID_ONLY`
is `solid && !rayOnly`, `OPAQUE_ONLY` is `solid && !porous`, and both are already
properties on the `WorldBox`. `boxGeometry.ts` already owns the sign-sensitive
segment-vs-box math (`segmentHitsBox`) and is already shared by `NavGrid`,
`ObstacleField` and `CoverMap`.

**This step also fixes the authority for free.** `server/world.ts` builds real
NullEngine meshes purely so the server's rays have something to pick against; a
query over boxes needs no meshes at all, and the server is the process running a
fixed-step simulation for sixteen slots.

**The precedent carries its own warning, and it is the thing to be careful
about.** When `probeGround` was converted, the analytic and the ray agreed on
99.8% of 51,000 standable positions — and the 0.2% was a real bug in the shared
primitive: `topFaceAtLocalZ` extrapolated a pitched box's top-face plane past the
face's own footprint, so a stair parapet claimed ground beside itself. It was
closed by `topFaceHalfDepth`. **Do the same audit here** — sample thousands of
rays on every shipped map, both ways, and treat any disagreement as a geometry
bug until proven otherwise.

**Must not break:**

- The four shipped maps' behaviour, at all. This is a pure substitution;
  `bank.mjs --check` and `npm run parity` must both be clean.
- `metadata.surface`. The hitscan reads it off the terrain collider clone to pick
  the impact spark, and that clone is the one collider with no `WorldBox` behind
  it. The floor branch has to answer `"ground"` and everything else `"hard"` by
  omission, exactly as now.
- The tank hull, which is the one MOVING `solid` mesh and emits **no `WorldBox`**
  at all. It is picked out of its own way by two property writes today and will
  need explicit handling in whatever replaces the pick.
- `CombatSystem.fire`'s ordering: the wall pick caps the shot and only targets
  CLOSER than the wall count. Keep that exact, including the near-miss sweep that
  rides on the same pass.

**Verify:** the sampling audit above, `npm run parity`, `npm run simulate`, and
S0's harness for the per-frame saving.

---

### S3 — Compact the nav graph's surface ids

Wall 3, and the structural half of it.

A surface id is `cell * maxSurfaces + slot` today, so every array reserves
`maxSurfaces` slots for every cell whether or not they exist. On mostly-open
ground the true occupancy is close to 1. **Make the surface id a compacted
index**: rasterize first, then allocate `heights`, `walkable`, `blocked`, `links`
and every `FlowField.dist` over the surfaces that ACTUALLY exist, with a
`cellBase: Int32Array` giving each cell's first id and a reverse surface -> cell
array for `positionOf`.

Derived saving at `surfaces: 4` with ~1.3 real surfaces per cell: **~3x across
every array in wall 3's table**, and it compounds with S4.

**Stack the link encoding on top if the measurement wants it.** `links` stores an
absolute surface id, but the neighbour CELL is already implied by the direction —
the only unknown is which slot within it. That fits in an `Int8Array`, a further
**4x** on the largest array in the table. It costs a cell -> id lookup per link
read in the two hot loops (the flood fill and `buildField`), so **measure it
rather than assuming it**: it may cost more in the BFS than it saves in bytes.

**Must not break:**

- `src/world/fingerprint.ts` and `npm run parity`. The fingerprint is over the
  DERIVED graph, so a correct compaction leaves it unchanged and any diff is a
  bug in this step. That makes it the best available oracle — lean on it.
- `NavGrid.openBox`'s monotonicity. Glass is the one mutation the graph admits
  and it only ever GAINS links, so a compacted id space must never need to grow
  when a pane breaks. It does not — `openBox` relinks and floods over surfaces
  that already exist — but check rather than assume.
- `debugSnapshot`'s contract with the editor: LIVE references, read never write.
- `CoverMap`, whose three masks are indexed by the same surface id and must be
  compacted in the same pass or they silently address the wrong spots.
- `maxSurfaces` staying the map's own answer (`MapLayout.surfaces`), and overflow
  staying a silent drop in ARRIVAL ORDER. That is a documented contract with
  every builder's collider ordering and must not be quietly "improved".

---

### S4 — Flow fields at 1500 m

Seven `Float32Array`s over the whole graph, rebuilt on a broken pane (finding 9).
At this size that is the second-largest line in wall 3's table and the
longest-running item in wall 4.

Three moves, in increasing order of how much they change:

1. **`dist` holds BFS step counts, so it does not need 32 bits.** A
   `Uint16Array` with `0xFFFF` as the unreachable sentinel covers 65,535 steps
   against a 1,000-cell diagonal. A free 4x with no behaviour change.
2. **Seven whole-map fields may not be the right model any more.** A bot 800 m
   from a flag does not need a per-cell route to it, it needs a bearing. A coarse
   field over blocks with the fine field computed only near the goal — or fields
   built lazily and evicted — is the shape, and `nav.steer()` being the one
   reader is what makes it changeable at all.
3. **Build them off the main thread**, which is S5.

**Must not break:**

- **Bots read `nav.steer()`, never run their own pathfinding, and never use
  `moveWithCollisions`.** Whatever replaces a field must keep that true; per-bot
  A* is exactly what this design replaced.
- `GlassSystem`'s amortised rebuild, and `fieldGoals` — the arguments a field was
  built from are held precisely so one can be built again after a break.
- The staleness guarantee: a route computed before a wall opened is stale (it
  walks the long way) and never wrong. Any lazier scheme must preserve that, or
  it is a correctness change wearing a performance change's clothes.

---

### S5 — Move the burst builds off the main thread

Wall 4. Finding 18 names the candidates precisely: `MapBuilder`'s geometry, the
AO bake, the `NavGrid`/`CoverMap`/`ObstacleField` builds, finding 9's flow-field
rebuild, and finding 11's editor tier-3.

**And it says moving them "buys load time and nothing else" — which is the whole
point at this size.** Quote that sentence in the commit so nobody re-derives the
objection it correctly makes at 320 m.

**S0 moved this step's ceiling, and the honest reading is that it is now second
in its own wall.** The nav/cover/AO builds S5 relocates are **5,951 ms of a
182,889 ms build** at 1500 / 0 and 2,109 of 11,316 at 900 / 300. The PLACEMENT
loop is 87% and 67% of those. **Flatten the placement loop first** — wall 4
names `Scene.removeMesh`'s `indexOf` as the derived cause and `AssetContainer`
as the door — and re-time before spending a session on workers. A worker that
hides 2 s behind a card that is up for 13 is not the win it looks like.

The natural cut is that these are **pure functions over plain data**: `NavGrid`,
`CoverMap` and `ObstacleField` take `WorldBox[]` and a `TerrainField` and produce
typed arrays. Neither end needs Babylon. Transfer the boxes and the heightfield
in, transfer the arrays back, reconstruct on the main thread. `vertexShading` is
the same shape over vertex buffers.

**Must not break:**

- **`installMap` stays the one place a map is built**, and both callers — a round
  starting and an editor rebuild — keep going through it. Two copies of it
  drifted apart once and the failure was silent rather than loud.
- `loading` stays a STEP and not a lid: nothing may simulate under the building
  card, and asynchrony must not open a window where something does.
- The server, which is Node and has no browser `Worker`. Keep the synchronous
  path working and make the worker the client's optimisation, or use
  `node:worker_threads` behind the same interface — but do not fork the logic, or
  the two simulations drift and `npm run parity` will tell you once, late.
- Determinism. Scatter is seeded and the nav graph must be identical on every
  boot; a parallel build that reorders anything reachable from the seeded stream
  breaks that. `npm run parity` is the oracle again.

---

### S6 — Make the block and terrain resolution the map's

`BLOCK_SIZE` is a module constant at 48 m, chosen for a 240 m map: *coarse enough
that the whole village collapses into a few dozen draws, fine enough that frustum
culling still throws away most of the map. Well under the 78 m fog wall.* Every
clause in that argument is about a 240 m map with a 78 m fog wall, and none of
them survives at 1500 m.

At 48 m, a 1500 m map is `32 x 32 = 1,024` blocks. At 96 m it is 256; at 128 m,
144 — fewer meshes to walk (wall 1) and fewer draws, at the cost of coarser cull
granularity and larger merged buffers.

`terrainPatches` already takes `blockSize` as an argument and is called with
`BLOCK_SIZE`, so the two move together today. **They should not have to.** The
terrain's right block size is a function of heightfield cell and triangle count;
the merge's is a function of draw calls and cull granularity.

Follow the precedent the existing per-map overrides set: default to today's value
so a map that says nothing is bit-identical, and let a map state its own.
`docs/world.md`'s "Four things that look global and are the map's" is the
template, and this makes it five or six.

**Must not break:**

- `ReflectionSystem.encloses` and `PaneBlocks`, which agree on "the same
  building" by sharing the block key rather than by measuring a distance between
  two centres. They must keep agreeing.
- The rule that only plain `solid` boxes may be grouped, and that the grouping
  rides to the server as `MapCollision.boxGroups`.
- `server/world.ts`, which imports `BLOCK_SIZE` directly.
- The editor, which keys per placement and takes the draw-call hit deliberately
  so a placement stays recoverable.

---

### S7 — Get the heightfield out of the JS bundle

`heights.ts` is a module constant imported by `layout.ts`, so it is in the main
bundle. Harrowmead's is 51 KB for `100 x 100` cells. Derived at 1500 m:

| terrain cell | grid | vertices | ~file |
| --- | --- | --- | --- |
| 6 m | 250 x 250 | 63,001 | ~320 KB |
| 4 m | 375 x 375 | 141,376 | ~700 KB |

A 4 m cell is what Coldharbour and Harrowmead both use, and dropping to 6 m
coarsens the slope limit — which `docs/world.md` lists as one of the three things
a larger map owes: *the heightfield's own grid grows with the square rather than
getting coarser*, or the limit is measured over cells no author can control.

So keep the cell and move the DATA: a binary asset, or a payload behind the same
lazy `import()` shape `MapDef.collision` already uses, rather than hundreds of
thousands of JS number literals to parse on boot. `MapDef.collision`'s header
carries that argument verbatim and is the worked precedent.

**Must not break:**

- The editor's terrain mode and `vite.config.ts`'s `WRITABLE` table, which is
  what lets a save patch these files at all. A new format needs a new writer and
  a new `min`/`marker` rule.
- `scripts/collision-hash.mjs`, which hashes `layout.ts` AND `heights.ts` because
  an authored `y` is an offset above the local floor. If the heights move, that
  hash has to follow them or `npm run build`'s staleness guard silently stops
  guarding.
- `TerrainField` taking its half-extent from `size * cell` and never from
  `CONFIG`.

---

### S8 — Sight, shadow and fog for a map you cannot fog

Coldharbour states `fogEnd: 480` at `size: 320`, and Harrowmead `520` at `400` —
both at or past their own diagonal. **That trend cannot continue.** At 1500 m the
diagonal is 2,121 m, and a `fogEnd` past it means nothing is ever culled by
distance and every one of wall 1's blocks stays a candidate.

A desert wants aerial haze anyway, so the look and the budget agree for once.
Pick a `fogEnd` well inside the map — 500-650 m is four to five times Harrowmead's
play radius and still an enormous view — and **lay the map out knowing what did
not move with it**: `audio.maxDistance` is still 70 and
`bots.perception.engageRange` still 55. Coldharbour's streets are broken at chest
height every few tens of metres for exactly this reason, and a ruined city gets
that for free from rubble and collapsed frontage.

The shadow window is the other half, and it is the environment's
(`EnvironmentSpec.lighting.shadowWindow`, default 110). Shadow length is
`h / tan(elevation)`, and the failure when the window is too small is not a soft
edge — `shadowVisibility` returns **fully lit** outside it, so what you get is a
straight line across open ground sliding with the player. `mapSize` stays global
at 2048, so the window costs texel density: 5.4 cm at 110, 9.8 cm at 200.

**A high sun is the desert's answer and it is the cheap one.** Coldharbour kept a
high sun *because of* the fixed 110 m window and had to raise the window to 200
when it dropped its sun to 24 degrees. A midday desert throws short shadows off
tall rubble, which is a look this map wants and a budget this map needs.

**Also revisit `FOG_WALL`'s two riders.** `bots.lodDisableDistance` (where a rig
stops being drawn) and `bots.death.maxDistance` (past which a corpse is not worth
tumbling) are the same distance by construction, and `Game.installMap` pushes a
map's `fogEnd` into `BattleSystem`, `NetRoster` and `RagdollSystem`. At 500 m
those gates stop gating anything, and every rig on the map is drawn and posed.
**That is a real new cost at this size**: post-palette-merge the world is 88
meshes on Coldharbour and the soldier rigs are 237, so the rigs are now the
largest bucket in the frame. This probably wants a draw distance separate from
the fog.

---

### S9 — The authority at 1500 m

Everything above is the client. The server runs the same simulation on a fixed
step for sixteen slots under NullEngine, and it inherits:

- **S2, which it needs most.** `server/world.ts` builds real meshes purely so
  rays have something to pick against, and the rewind (`server/lagComp.ts`)
  re-runs `CombatSystem.fire` per shot per rewound target.
- **S3, S4 and S5**, since it builds the same `NavGrid`, `CoverMap` and
  `ObstacleField`.
- A generated `collision.ts` at **7.7x Coldharbour's box count** — 5,929 boxes
  against 768, measured on the 900 / 300 proving ground — so roughly 400 kB
  against Coldharbour's 53. (At the 1500 m square it would have been 16,526
  boxes and ~1.1 MB, which is what this line used to derive.) It is a lazy chunk
  on the client and never downloaded, so this is the server's parse cost and the
  repo's diff size, not the player's.

**Measure the tick, not the frame.** `npm run simulate` runs a whole round
headless with no clients and is the right instrument. The question is whether one
process still holds its fixed step with sixteen bots pathing across 900 m, and it
is a question the client's numbers cannot answer.

**Must not break:** `npm run parity` after anything in the world layer, and the
rule that the bake guard hashes the LAYOUT — a flag changed in a builder needs
`npm run collision` by hand.

---

### S10 — Density, and the sixteen slots

**The engine work above does not make a 1500 m map fun, and it is worth saying so
before S11 rather than after.** Sixteen combatants over 2.25 km^2 is one body per
140,000 m^2. Harrowmead is one per 10,000.

Three levers, and only the first is cheap:

1. **Concentrate the play.** The borderland decision at the top of this file is
   most of it: 900 m of play inside 1500 m of ground puts the density between
   Harrowmead's and Coldharbour's. Flags close enough together to contest, ground
   between them that is transit rather than fighting.
2. **More flags.** `ConquestSystem` counts occupancy off the combatant list
   `Game` assembles each frame and nothing hardcodes five — but the UI is TOLD
   the count rather than assuming it (`MenuState.flagCount`, `setScoreboard`,
   `showRoundOver`), and the deploy map, the minimap's edge markers and the
   ticket bleed all read it. Check each rather than assuming.
3. **More bodies, which is the expensive one.** `CONFIG.bots.perTeam` is 8 and
   the rig pool is sized exactly `perTeam * 2`. Offline that is a config change
   and a pool resize. **In a match it is a contract change**: `CLAUDE.md` says the
   roster is *sixteen slots, built once, never resized*, and *a slot index IS a
   bot index*. `server/Roster.ts`, the wire, `ScoreBook`'s one-row-per-slot
   ledger, the bench and the scoreboard all rest on it. That is a project, not a
   step — scope it separately if the density answer turns out to need it.

---

### S11 — Build the desert city

Only after S0-S8 have landed and S0's harness says the proving ground holds a
frame. Then it is what `docs/world.md` already says a map is: one new layout
file, an `EnvironmentSpec`, a generated `heights.ts`, a `collision.ts` from
`npm run collision`, and rows in the three registries — `src/world/maps.ts`,
`vite.config.ts`'s `WRITABLE`, and `scripts/collision-hash.mjs`'s `MAPS`.

What this particular map will want, from the contracts rather than from taste:

- **`floorSurface: "sand"`**, which already exists in
  `src/world/floorSurfaces.ts` and derives every tone from `floorColor` by
  `ramp` — so the sand's colour is `floorColor` and the surface owns none of it.
- **`borderland` plus `ridge: { form: "downs" }`**, which is a pair rather than a
  choice: an escarpment's basal band is a vertical face flush with a collider
  plane, and on an open boundary there is nothing within a margin's width to be
  flush with.
- **`surfaces: 4` at least.** A ruined city stacks floors, and overflow is a
  SILENT drop in arrival order — so the builders emit walked surfaces first,
  cover next, roofs last.
- **`vehicles`**, if the map has armour, which at this scale it probably wants:
  one hardstanding a side, on ground a seven-metre hull can get off. That also
  turns on the third kit slot (`Game.armourOffered`), online and off.
- **`groundSpec` left alone.** `config/graphics.ts` warns the wet-cobble sheen is
  tuned to the key light's elevation, and a desert is the wrong weather for it
  entirely.
- **No lamps.** The sun is up, and a carried flame spends one of the sixteen
  light slots proving nothing. Harrowmead's rule, and Greyfen's before it.
- **Breakable glazing kept sparse.** `PaneSpec.breakable` is only for glass with
  enterable space behind it; a ruined city has a great deal of glazing and almost
  none of it should be in `GameMap.panes`, which is identity on the wire.

---

## What this plan does not fix

- **Fill rate on a phone.** Every number here is one desktop GPU. Finding 17's
  last open thread says the balance that makes fill irrelevant on the Windows box
  will not hold on a device this game installs onto, and finding 12's glass
  fragment is still the right lever there. A 1500 m map on a phone is a separate
  question this plan does not open.
- **The pipeline compile stall.** Finding 16: the first seconds of a round are
  WebGPU compiling pipelines, and on Coldharbour that is 9 fps. More geometry
  does not worsen it on its own — more MATERIALS does, and the palette merge
  already cut those — but it is unaddressed and it will be more visible on a map
  that takes longer to load.
- **Frame pacing.** Finding 1 is still open, still unexplained, and nothing here
  touches it.
- **The roster.** S10's third lever. Sixteen slots is a multiplayer contract, and
  this plan deliberately does not break it.
- **Bots at this scale.** S0 measured quiet frames: the round runs and the player
  spawns, but the proving ground's flags are hundreds of metres apart and no
  engagement was forced. Nothing in this document has costed sixteen bots
  fighting across 900 m, and S10 is where that has to happen.

## The measurement protocol

One instrument, one lever, one session — the methodological half of finding 17.
`setHardwareScalingLevel` varies pixels and nothing else; hiding geometry varies
fill, draw calls and active meshes together and can never say which of the three
it just bought. **Read nothing under about 8% as real** — finding 17's own
baseline drifted -4 to -6% across a run.

And **a draw is not a draw**: finding 18 measures an outline shell reusing an
already-bound material at ~2.3 us and a mesh draw carrying a material switch at
~6.3 us. Say which kind before predicting a saving from a count.

Every step above that claims a number should leave a `FINDINGS.md` entry saying
what was measured, what was derived, and what would settle the rest — and a
finding leaves that file by being fixed or by being disproved, never by going
stale.

**And the instrument for all of it now exists rather than having to be
rebuilt.** `src/world/buildProfile.ts` reports the build split under
`window.__buildProfile()`, and `npm run proving` regenerates the map every
figure in this document was taken on. Re-measure through those rather than
writing a third way of asking the same question — a number taken with a
different instrument is not comparable to the tables above, and finding 18's
0.67 us against finding 19's 1.10 us is exactly what that costs.
