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

The reference numbers throughout are `FINDINGS.md` **17**, **18**, **19**
(S0's), **21** (S1's) and **22**/**23** (wall 2's before and after), all
measured on the Windows box (RTX 4070 Ti SUPER, headless
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

### Wall 1 — the frame walks the whole scene, and the scene is the map — **MOSTLY DOWN**

**S1 has landed and finding 21 is what it produced**; the walk is 7.6 ms to 2.5
at 900/300 and the frame 9.8 to 4.3. What follows is the wall as S0 measured it,
kept because the shape of it is why the fix is shaped the way it is — and
because **one term of it was still wrong after S0 corrected two**: the walk is
not mostly buildings, it is **70% invisible COLLIDER proxies**, which is a class
of mesh that can never draw and is therefore free to remove. What is left of the
wall is 0.94 us over 2,670 candidates, and S8 is what has the rest of it.

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

### Wall 2 — every ray in the game walked the same list — **DOWN**

**S2 has landed and finding 23 is the after half of the pair.** No ray in
gameplay picks a mesh any more: all eight sites go through
`src/world/RayWorld.ts`, a grid over `colliderBoxes` plus the strut groups plus
a march over the heightfield. **3.75 ms of the frame became 0.006 ms**, the
per-ray cost went from 2,438 us to **3.5**, and — the part that matters more
than the ratio — **the cost is no longer a function of the map's size**: the
1500-m-class proving ground is now the cheapest of the three maps per ray rather
than 11x the dearest. The forced fight there went from 82 fps to 112.

What follows is the reading that priced the wall, kept because it is the before
half and because the projections in it are what the fix had to beat.

**Finding 22 priced it, and it changed the order of what was left.** With S1
landed, `pickWithRay` was **3.75 ms of an 8.6 ms frame — 30.7% of it** — on the
900/300 proving ground with sixteen bots in contact, against 3.0 ms for the mesh
walk beside it. It was the one wall this document had no measurement for at all.

| sixteen bots in contact | Coldharbour | Harrowmead | **proving 900/300** |
| --- | --- | --- | --- |
| collider boxes | 768 | 748 | **5,929** |
| median frame | 5.8 ms | 6.9 ms | **8.6 ms** |
| — the mesh walk | 1.5 | 1.9 | 3.0 |
| — **`pickWithRay`** | **0.41** | **0.35** | **3.75** |
| picks per frame | 1.86 | 1.77 | 1.54 |
| **us per pick** | **222** | **199** | **2,438** |
| share of the frame | 5.8% | 3.9% | **30.7%** |

**The pick COUNT is the same on all three** — it is sixteen bots at `thinkRate`,
not a property of the map — so the whole of the difference is what one ray
costs, and that is 11x for 7.7x the colliders.

`scene.pickWithRay` filters `scene.meshes` by predicate, then bounds-tests, then
triangle-tests. There are eight sites: the hitscan's wall cap
(`CombatSystem.fire`), the bots' LOS (`BattleSystem`), the aim assist, the
grenade's step ray and its blast check, the rocket, the death cam's pull-in, and
the tank's chase camera and ground probe.

**S1 did nothing for this and that was deliberate.** `WorldCulling` works by
replacing the ACTIVE-MESH candidate list, and `InternalPick` has never heard of
it — which is exactly what made S1 safe and is exactly why this wall is
untouched. The two are independent by construction.

**Ray LENGTH barely touches it, which is the wall's signature.** 400 isolated
rays per range: 125.8 / 121.3 / 120.8 us on Coldharbour and 1,043.8 / 1,035.5 /
1,007.3 on the proving ground at 55 m, 120 m and 180 m — the bots' engage range,
the rifle's and the tank gun's. Tripling the ray is very slightly CHEAPER.
Nothing about the cost is bounded by how far the ray goes; it is
`O(colliders in the scene)`.

**The precedent is already in the tree and it is emphatic.** `Player.probeGround`
was `scene.pickWithRay` with a `solid` predicate, walking ~1,800 meshes and
ray-testing ~820 colliders to find one number under one pair of feet. Measured at
**0.483 ms — a third of the game's own per-frame JS and five times the next item
on the list.** Its header says exactly what this document is about:

> it scaled with how big the MAP was rather than with anything on screen, which
> is what made it the first wall a larger map would hit.

It was retired by answering the question analytically off `ObstacleField` and
`TerrainField`. The other eight have not been.

### Wall 3 — the nav graph is allocated per CELL SLOT, not per surface — **THE SLOTS ARE GONE**

**S3 has landed and the per-slot half of this wall is down.** Every array
below is now allocated over the surfaces that exist rather than the slots that
could: measured on the committed 900/300 proving ground the nav layer went
**99.2 MiB to 40.0 MiB**, a 2.48x cut, and the graph it produces is
bit-identical (see S3). What is left is a wall about SIZE rather than about
padding, and **S4 has since halved the flow fields inside it**, leaving `links`
as the biggest line. The table below is the wall as S0 measured it, kept because
it is what the derivation must be read against.

`NavGrid` sized every array `cells * maxSurfaces`, whether or not a cell had
that many standable heights, and `FlowField.dist` was a `Float32Array` over the
same count. At `CONFIG.nav.cellSize` 1.5 a 1500 m map is `1000 x 1000 = 1,000,000`
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
holds the graph's `heights`, `counts` and `walkable`. **S3 found that those
three are REFERENCES rather than copies** — `debugSnapshot` hands back live
arrays and always has — so the extra 20 MiB is the same 20 MiB counted twice,
and a byteLength sum that walks both structures double-counts it. It compacted
with the same S3 change as the rest either way.

**What S3 took off this table, measured per map** (every per-surface array once,
which is the accounting the table above wanted rather than the one it did):

| | slots | real surfaces | occupancy | was | now |
| --- | --- | --- | --- | --- | --- |
| Coldharbour | 183,184 | 72,230 | 1.58 | 12.6 MiB | **5.5 MiB** |
| Harrowmead | 213,867 | 72,876 | 1.02 | 14.8 MiB | **5.6 MiB** |
| proving 900/300 | 1,440,000 | 528,287 | 1.47 | 99.2 MiB | **40.0 MiB** |

Derived forward to 1500/0 at the same occupancy: **~276 MiB becomes ~111 MiB**.
That is the wall's own table cut by 60%, and it is not on its own the difference
between a round opening and a tab dying — the 1500/0 heap was 3,536 MiB of which
this was under 300. **S4 was the next line and it is down too**: the seven
fields are a `Uint16Array` each now, 14.11 MiB of the proving ground's nav layer
becoming 7.05 and ~39.2 MiB at 1500/0 becoming ~19.6. (The 28-of-40 MiB this
paragraph used to quote was arithmetic rather than a reading — seven arrays over
528,287 surfaces at four bytes is 14.1 MiB, not 28. The 40 was S3's accounting
and the instrument S4 used reports 44.24 for the same graph, counted to a wider
edge; which of the two is quoted matters less than that S4's before-and-after
are the same instrument as each other.) **What is left in this wall is `links` at 16.1 MiB and `CoverMap`'s
masks at 7.3, and S4 measured and declined the one encoding change that would
move `links`** — see it for why.

In a browser tab, alongside Havok, the Babylon scene, sixteen rigs and a 2 MB
WASM. This is the wall that is not "slower" — it is an allocation failure, and
**it lands**: at the moment the 1500 / 0 round opens, before a frame is drawn,
the JS heap is **3,536 MiB against V8's 4,192 MiB cap** and the renderer's
working set is 5.4 GB. At 900 / 300 the same figures are 1,696 MiB and 2.6 GB.

### Wall 4 — load time, and the burst builds behind the card — **MOSTLY DOWN, AND BOTH SITES ARE CLOSED**

**S5's first half has landed and `FINDINGS.md` 24 is what it produced**: the
1500 m build is 186 s to 17.4 and the placement loop 161.5 s to 9.4, and the
whole install 205 s to 35. What follows is the wall as S0 measured it, kept
because the shape of it is why the fix is shaped the way it is — and because
**the cause named at the bottom of this section was the wrong one, which is the
part worth reading twice.**

**What WAS left of the wall was 18.7 s and it was NOT the build.**
`FINDINGS.md` 25 profiled the gap between `build:total` and
install-to-`deploy`, which this section had never attributed:
`PhysicsWorld.setMap` was 13,402 ms and quadratic in collider boxes,
`ReflectionSystem.build` was 5,272 and walked the whole scene six times per cube
probe to release ids it never allocated, and everything else in `installMap` is
27 ms between them. Those were **S5b** and **S5c**, and both have landed: the
two are **181 ms and 72** at 1500 m now, so 18.7 s of the wall came off for a
bucketed compound and a three-line swap. **What is left of wall 4 is
`MapBuilder.build` and nothing else** — 98.7% of a 19.1 s install — and finding
24's open threads are where it is.

**This wall is real and this section was wrong about all of it.** Derived:
30-60 s behind the loading card, dominated by `NavGrid`, `CoverMap`, the flood
fill and the flow fields. Measured, from `src/world/buildProfile.ts`:

| build phase, ms | Coldharbour | 900 / 300 | 1500 / 0 | **1500 / 0 after** |
| --- | --- | --- | --- | --- |
| **`build:total`** | **1,635** | **11,316** | **182,889** | **17,422** |
| — the PLACEMENT loop | 908 | 7,564 | **159,249** | **9,443** |
| — block merge | 62 | 669 | 9,044 | 1,010 |
| — scatter | 86 | 277 | 4,313 | 443 |
| — road merge | 3 | 162 | 2,662 | 41 |
| — AO bake | 165 | 936 | 2,360 | 2,191 |
| — `NavGrid` | 140 | 729 | 2,328 | 2,572 |
| — `CoverMap` | 56 | 294 | 895 | 736 |
| — seven flow fields | 10 | 150 | 368 | 227 |
| **install to `deploy`** | **1,770** | **13,219** | **197,753** | **34,923** |

**It is 183 seconds, not 30-60, and the four things this section named are 3.3%
of them.** `NavGrid`, `CoverMap`, the flow fields and the AO bake are 5,951 ms
of 182,889 between them. The **placement loop is 87%**.

**And the placement loop is superlinear in the number of placements**, which is
the finding under the finding — 1.1 ms each on Harrowmead's 124, 6.6 on
Coldharbour's 137, 18.4 on the 900 m square's 410, **143.7 on the 1500 m
square's 1,108**. About `n^2.9` overall. Nothing in a builder knows how big the
map is, so this is the cost of adding one structure growing with how many are
already there. — *True, and now 6.4 and 8.5: 2.7x the placements costs 1.33x
each. The superlinearity is gone with the cause below.*

**Derived, not measured, and it is in Babylon**: `Scene.removeMesh` is an
`indexOf` over `scene.meshes` plus a second scan of `rootNodes`, and
`mergeByMaterial` DISPOSES its sources (which is what turns Babylon's
attribute-aligning path off — see `MapBuilder`'s header). A build that creates
and destroys ~a million part meshes against a list growing to 23,014 is
`O(built x live)`. `AssetContainer` / `_blockEntityCollection` is the supported
door, and re-timing the loop through it is what settles this. — ***Wrong, and
measured wrong by 65x. `removeMesh` is called 88,131 times, scans 547 MILLION
array elements, and costs 98 ms of a 6,420 ms loop*** — an `indexOf` over a
packed array is 0.18 ns an element, and this paragraph priced a linear scan as
a linear number of memory accesses. `AssetContainer` was never the door and
`rootNodes` has been O(1) since Babylon 9. **What the loop was actually doing
is talking to the GPU**: `VertexData.applyToMesh` uploads a part's positions,
normals, UVs and indices the moment a builder makes it, and the merge disposes
it moments later, so ~4.2 s of an 8.8 s build was `device.createBuffer` and
`queue.writeBuffer` for geometry no frame ever draws — and the superlinear term
was the allocator degrading under ~3 million create/destroy cycles.
`src/world/parts.ts` is what stopped it.

**Which means S5's premise has moved.** Finding 18 says the burst work is the
worker-shaped part of this codebase and that moving it "buys load time and
nothing else"; at 1500 m load time IS the problem, so that sentence still
inverts. But the burst work S5 names is 3.3% of the build. **Flattening the
placement loop is worth 50x what moving the nav builds to a worker is**, and it
is a smaller change. — *It was worth 27x, and it has moved the premise twice
more: the nav/cover/AO builds are now **33%** of a 17.4 s build rather than 3.3%
of a 183 s one, and then the install profile put both S5b and S5c ahead of them
anyway. The worker is third and gated — see S5.*

### Wall 5 — the reflection bake takes the GPU device, and it was not in this document — **DOWN**

**The one wall S0 found rather than confirmed, and the first thing between this
tree and a map of either size. S0b has landed and it is no longer standing**;
what follows is what it was, kept because the shape of it is why the fix is
shaped the way it is. `ReflectionSystem` bakes one refresh-once cube probe per
glazed BLOCK at `CONFIG.graphics.reflection.size` (128), which is priced on map
area like everything else here:

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
one frame**, and 1,373,340 at 900 / 300. See S0b for what came down and by how
much.

**One sentence of this section was wrong and it was the one about the fix.**
"Amortising it across frames does not reduce it" reads the failure as a pure
resource ceiling that a slower bake meets just the same — and the total is
indeed unchanged — but a descriptor heap is recycled per SUBMISSION, so what
matters is the largest single frame and not the sum. Spending the bake over
frames is what actually took the wall down; the render list and the probe count
came down as well and neither had to come down far.

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

- ~~**Anything with sixteen bots fighting.**~~ **CLOSED by finding 22.** A
  forced skirmish is an 8.6 ms frame against the quiet 4.30, and what a fight
  adds is almost all wall 2. A round left to itself fires no ray at all, which
  is why it had to be forced.
- ~~**Wall 2.** No ray was fired down a 1500 m scene.~~ **CLOSED by finding
  22**, after S1 — and it is the biggest thing in the frame now. See wall 2
  above.
- **`ObstacleField`'s footprint**, which reported no typed arrays and is absent
  from the memory table.
- **The reflection bake's cost as a curve.** It is a pass/fail at three points,
  not a rate.

---

### S0b — Survive the reflection bake — **LANDED**

Wall 5, and it is down. **The proving ground at 900 / 300 now reaches a
steady-state frame with the bake ENABLED**, which is what every later step was
waiting on: S0's figures had to be taken with `ReflectionSystem.build` stubbed
to a no-op, and there is no longer anything to stub.

It is lettered rather than numbered because it was discovered rather than
planned, and renumbering S1–S11 would stale every cross-reference in this file
and in `FINDINGS.md`. Read it as coming first.

**All three levers the step named are in, and the ORDER of their importance is
the opposite of the order they were written in.** Every number is
`CONFIG.graphics.reflection`'s and every one of them is a no-op on all four
shipped maps, which is the property the bank check rests on.

1. **The bake is SPENT over frames** — `drawsPerFrame`, 50,000 face draws.
   `ReflectionSystem.queue` holds the probes that have a render list and no
   frame yet and `releaseBatch` lets a frame's worth go, riding
   `onBeforeRenderTargetsRenderObservable` because Babylon asks each custom
   target whether it `_shouldRender()` immediately after that observable fires.
   **This is the lever that took the wall down**, against this document's own
   sentence saying it could not: a descriptor heap is recycled per SUBMISSION,
   so the largest single frame is what matters and the sum is not. The budget
   is set just over Coldharbour's whole bake, so the largest thing that ships
   still lands on the frame it always did.
2. **A probe is not in `scene.customRenderTargets` until it is released.**
   Without this, lever 1 does nothing at all on the first install of a map: a
   `ReflectionProbe` is born with its refresh counter at -1, which a
   refresh-once target reads as "render when next asked", and `build` fills the
   render list before any frame happens. Membership of that array is the only
   thing that can hold a fresh probe back.
3. **A frame's budget counts the RE-BAKES it is already committed to**
   (`ReflectionSystem.inFlight`). Babylon's render-list pass resets a target's
   refresh counter and skips any mesh whose material has not compiled, so a
   probe re-bakes IN FULL until its whole list is ready — and a queue that does
   not know this releases fresh batches on top of batches already thrashing,
   arriving at the same enormous frame by the long way round. Measured before
   the accounting went in: 29 of the first 60 probes re-baked, and 116 targets
   were live two frames after the install against 88 with it.
4. **The render list is a NEIGHBOURHOOD** — `radius`, 800 m to the near side of
   each mesh's bounding sphere, which is what keeps a landform in. 800 m is
   past the diagonal of every map in the tree and past the longest `fogEnd` any
   declares, so nothing shipped is culled. **It is the smallest of the levers
   where it has been measured** — 928 meshes to 864 on the proving ground, 7% —
   because at 900 / 300 the probes are all inside the middle 900 m of a 1500 m
   floor. It is there for the extent where they are not.
5. **The probe count is capped by a TEXTURE budget** — `poolBudgetMiB`, 160,
   which is 320 probes at the shipped face size. Past it, glazed blocks group
   in twos, then fours. Coldharbour asks for 40 and the proving ground for 265
   (133 MiB), so **nothing in the tree groups anything**: it is a bounded worst
   case rather than a live lever, and the thing to know before raising it is
   that `encloses` drops every block a probe SERVES.

**Measured on the Windows box, dev build, headless via `channel: "chromium"`:**

| | Coldharbour | proving 900 / 300 |
| --- | --- | --- |
| glazing groups / probes | 71 / 40 | 389 / **265** |
| opaque meshes / listed per probe | 177 / 175 | 928 / **864** |
| queued in | 42 ms | 960 ms |
| total face draws | 41,934 | **1,373,340** |
| frames the bake takes | **1** | **28** |
| the bake's own frames | 2.2 s | 3.3 s then ~0.9 s |
| settled after install | 1 frame | **27 frames** |
| cube pool held | 20 MiB | **133 MiB** |
| the first frame | draws | **draws** |

**Coldharbour is unchanged in every respect** — one frame, 2.2 s, no probe
re-baked — which is the point of the budget being where it is.

**What it did NOT do, and what the next step to touch this owes:**

- **1500 / 0 has not been re-tested.** The chosen extent is 900 / 300 and that
  is what the committed proving ground is; the ceiling case would want the
  probe cap to actually engage, and nothing has watched it do so.
- **The bake still lands AFTER the loading card, not behind it.** `installMap`
  is one JS turn, so no frame can render inside it — the queue drains over the
  first ~28 frames of `deploy`, which is ~26 s of second-long hitches on the
  proving ground and one 2.2 s frame on Coldharbour. Holding `loading` until
  the queue is empty is a state-machine change (`docs/states.md`) and was out
  of scope here.
- **Nothing has looked at the PICTURE on the proving ground.** The bank check
  proves the four shipped maps are unmoved; it cannot say whether an 800 m
  radius leaves a visible hole, because no shipped map is big enough to cull.

**What it must not break, and did not:** `docs/rendering.md`'s load-bearing
details of the bake and the three ways a cube probe goes flat — `noReflect` and
`ReflectionSystem.encloses` in particular, which now takes a SET of block keys
and holds exactly one on every shipped map; probes pooled and never disposed;
an EDITOR build baking nothing; the eye borrowed and restored around the whole
render-target block rather than per probe; and a map with no glazing baking
nothing.

**Verified:** the proving ground at 900 / 300 reaches a steady-state frame with
the bake ENABLED — 265 probes over 28 frames, settling 27 frames after the
install, no device loss and no page error.

**The bank check could not be the gate, because it is already RED on the commit
before this one.** Run against `plans/webgpu-ref/ref` as banked on 2026-08-26
during S0, the UNMODIFIED tree regresses on all fifteen vantages of all four
maps — 0.19 to 3.26 mean/255 against a 0.02 tolerance, a few per cent of pixels
each, worst tiles on the marsh and the avenue. The bank is gitignored, so it is
a local artefact taken on this machine the day before; **this is drift under
the bank rather than anything in the tree**, and it wants explaining before it
is re-taken (`diff.mjs`'s own header: if it cries wolf, find the unpinned thing
rather than raise the number).

**What stands in for it is stronger than a pass would have been.** The same
check, run either side of this change against the same fixed reference, reports
the SAME mean on every one of the fifteen vantages to four decimal places. A
pass would have said the frames are within tolerance; this says the four
shipped maps are byte-for-byte what they were.

---

### S1 — Block visibility: stop walking the whole scene — **LANDED**

Wall 1, and most of it is down. **`FINDINGS.md` 21 is the result.** The walk is
**7.60 ms to 2.50** on the 900/300 proving ground and the frame **9.80 to
4.30**, measured as one lever in one process against the number this step was
given to beat.

**The step's own premise was wrong about what the meshes ARE, and that is the
finding under the finding.** This section read wall 1 as a map's worth of
buildings and wrote two radii to keep the colliders reachable. Measured, **6,349
of the proving ground's 9,019 scene meshes are the COLLIDERS** — invisible
proxies Babylon pays the whole per-mesh cost for and rejects on `isVisible`
after `isReady`, `getTotalVertices` and the LOD map get. The structures are
1,158. So the largest thing in wall 1 is a class of mesh that can never draw at
any distance, and taking it out is exact rather than a trade.

**And the lever is a CANDIDATE LIST rather than `setEnabled`, which is what
makes the two radii unnecessary rather than merely cheaper.**
`Scene.getActiveMeshCandidates` is the supported extension point — it is what
`createOrUpdateSelectionOctree` replaces — it is read in exactly one place, and
a mesh left out of it is skipped ENTIRELY. `setEnabled(false)` leaves the mesh
in the walk and only shortens what the walk does with it (which is what made
finding 18's 0.67 µs and finding 19's 1.10 µs disagree about one number), and it
costs four indifferences that a candidate list gets for nothing: **every ray,
the shadow map's render list, every cube probe's bake, and
`moveWithCollisions`**. `WorldCulling` writes no property onto any mesh at all.

The rays were tested adversarially rather than argued: 1,000 seeded rays across
the 900 m square, fired with the reach at the map's fog wall and again with it
wound to zero — every structure out of the frame — **agreed on the mesh and the
distance 1,000 times out of 1,000**.

**Three classes of mesh**, and `metadata.block` decides two of them:

| class | what | offered |
| --- | --- | --- |
| hidden | `map.colliders` | **never**, at any distance |
| blocked | drawn geometry carrying `metadata.block` | inside the map's `fogEnd` |
| loose | everything else | **always** |

`inkTwin` and `PaneBlocks.finish` now carry the same key `BlockMerge.finish`
writes, because a twin is an INVERTED HULL — one left behind when its source
goes is a solid silhouette — and a tower has to lose its glazing and its shaft
together. **The landform is deliberately loose**: the terrain, the roads and the
rim carry no block, and they are what the SKY is behind.

**What it did NOT do, and what the next step to touch this owes:**

- **The block half is nearly unmeasurable today, and S8 is why.** Coldharbour,
  Harrowmead and the proving ground all state a `fogEnd` past their own
  diagonal, so nothing is culled by distance on any of them and every
  millisecond above is the collider half. Re-filing the proving ground at a
  550 m wall is another 0.6 ms of walk and 0.8 ms of frame — **so S8 is now
  what unlocks the rest of S1**, and the two should be read as a pair.
- **The two big maps' FRAME deltas are under the 8% floor** and must not be
  quoted as wins; only their `_evaluateActiveMeshes` deltas (−23%, −19%) are
  above it.
- **The cull cell is the 48 m merge block**, because that key already exists.
  Whether it is the right cell is S6's question.
- ~~**Nothing was measured with sixteen bots fighting**~~ — **finding 22 does
  it**, and the walk holds up (3.0 ms in a fight against 2.50 quiet). It also
  breaks the remaining candidates down: **57% are `loose`**, which no fog wall
  can reach, and ~750 of those are IDLE POOLED effect meshes. A pool member not
  in use is as skippable as a collider is, by this same mechanism, for roughly
  what S8's wall is worth — and no step in this document names that lever.

**What it must not break, and did not:** everything in the list this section
used to carry, and the mechanism is why rather than care — pooled anything is
never block-keyed and is always offered; `ShadowSystem.setCasters` and
`ReflectionSystem`'s render lists are explicit lists a candidate has no bearing
on; `GlassSystem`'s vertex ranges are untouched because no mesh is; `NavGrid`,
`CoverMap`, `ObstacleField` and `Player.probeGround` read `WorldBox`es and the
terrain FIELD and are indifferent; and the editor block-merges nothing, so
nothing there carries a block and nothing there is culled.

**Verified:** `npm run typecheck`, `npm run build`, `npm run parity` (all four
maps, all 17 fields), the 1,000-ray audit above, and the differential bank
check.

**The bank check is still RED on an unmodified tree (finding 20), so the
differential is what stands in for it** — and it is nearly clean.
**Fourteen of the fifteen banked vantages come back to four decimal places.**
The exception is `hollowmere/lanterns` at 1.5051 → 1.5050 mean/255 and
`hollowmere/menu` at 7.8133% → 7.8117% of pixels: **0.0001/255 over 0.0016% of
the frame, of the order of thirty pixels**, against a 0.02 tolerance and against
the 0.19–3.26 the bank is already red by. It is the block cull and it is
located — widen the reach past the map and all four Hollowmere vantages come
back byte-for-byte. Hollowmere has the tightest fog in the tree (78 against a
240 m square); Greyfen states the same 78, drops half its cells and does not
move at all.

---

### S2 — Retire the whole-scene picks — **LANDED**

**Done, and finding 23 is the result.** `src/world/RayWorld.ts` is the segment
query; all eight sites go through it; `world/solid.ts` keeps `SOLID_ONLY` for
the editor's centre-screen pick and `OPAQUE_ONLY` is deleted. Measured against
the number this step was set: **2,438 us a ray became 3.5, and 30.7% of the
frame became 0.07%.** The proving ground's forced fight went 656 → 898 frames in
eight seconds, Harrowmead's 890 → 1,151, Coldharbour's 1,115 → 1,234.

**What it changed about the rest of this document:**

1. **Wall 2 is down** and the per-ray cost is flat in map size, so the 1500/0
   projection in it (~6.8 ms in situ) is moot rather than unsettled.
2. **S3's premise is untouched** — the nav graph's allocation has nothing to do
   with rays — and S8's stays what it was: 0.6–0.8 ms of dormant block
   visibility, which is now a bigger share of a smaller frame.
3. **The authority got it for free**, as this step said it would: the server
   builds a `RayWorld` off the bake and resolves every rewound shot through it.
   **But the promise under it — that a query over boxes needs no meshes at all
   — does not hold on the server, and a later step must not act on it.**
   `server/world.ts` still has to stand its collider meshes up, because
   `Tank.update` drives a hull with `body.moveWithCollisions` and the authority
   simulates its own hulls. That was true before armour reached netplay and is
   not any more; the file's header said "nothing on the server moves that way"
   and now says why it does. Deleting that geometry would leave armour driving
   through walls on the server and stopping at them on every client.

**Two things worth knowing before the next step touches this:**

- **Babylon's picking was FUZZY and the analytic is not.**
  `Ray.intersectsTriangle` accepts a barycentric outside the triangle by up to
  `Ray.epsilon` (1e-3), which is a phantom skin about a centimetre thick on a
  13 m face. Thirteen rays in 32,000 stopped on it. The analytic agrees with
  `colliderBoxes` instead — the list `NavGrid`, `CoverMap`, `ObstacleField` and
  `server/validate.ts` all read — so the substitution made the ray agree with
  the rest of the world layer rather than departing from it. Finding 23 has the
  audit and how the three wrong hypotheses were eliminated.
- **A collider flush with the ground is a TIE**, and `RayWorld.COINCIDENT`
  resolves it the way the pick did. It decides only which spark is thrown.

What follows is the step as it was written.

---

Wall 2, and **since S1 landed it is the biggest thing in the frame.** Finding
22 measures it: `pickWithRay` is **3.75 ms of an 8.6 ms frame with sixteen bots
in contact** on the 900/300 proving ground — 30.7% of it, against 3.0 ms for the
mesh walk S1 left beside it — at **2,438 us a ray**, 11x Coldharbour's 222 for
7.7x the colliders. The number to beat is that one.

**It is ahead of S8 on the evidence and not on the plan's original order.** S8
unlocks S1's dormant block half, which is worth 0.6–0.8 ms measured; this is
worth five times that today and ~2.8x more again at 1500/0. S8 also has no map
to land on until S11 exists — the three shipped `fogEnd`s are gameplay contracts
their own files forbid moving, and the proving ground's 2400 is deliberate.

Replace `scene.pickWithRay` at the eight sites with a segment query
answered analytically against `colliderBoxes` through `boxIndex`, plus
`TerrainField` for the floor — exactly the shape that retired
`Player.probeGround`.

`world/solid.ts`'s two predicates become two filters over box flags: `SOLID_ONLY`
is `solid && !rayOnly`, `OPAQUE_ONLY` is `solid && !porous`. **Half of that was
wrong and it is the one place this step under-specified itself**: `porous` is on
the `WorldBox` and `rayOnly` is NOT — a strut emits no box at all, by design, so
the round question could not be answered off `colliderBoxes` alone. The struts
reach the query as `GameMap.rayGroups`, indexed beside the boxes with the round
bit and not the body one. `boxGeometry.ts` already owns the sign-sensitive
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
  need explicit handling in whatever replaces the pick. — *It got a list of its
  own (`RayWorld.hulls`, filled by `VehicleSystem.build`), `Tank.rayBox` hands
  the box over through `deckAt`'s existing gate and scratch, and the two writes
  became a `skip` argument.*
- `CombatSystem.fire`'s ordering: the wall pick caps the shot and only targets
  CLOSER than the wall count. Keep that exact, including the near-miss sweep that
  rides on the same pass.

**Verify:** the sampling audit above, `npm run parity`, `npm run simulate`, and
S0's harness for the per-frame saving. — *All but one done. `npm run simulate`
throws before it starts a round, and it does so on an unmodified tree at
`f18bdc9` too: `CelEmissiveFog` refuses the tracer material's shader language
under a NullEngine. Pre-existing, unrelated, and recorded in finding 23.*

**Two things about measuring it, both of which cost a run in finding 22.** A
round left to itself fires **no ray at all** — `BattleSystem.acquire` only
ray-tests a candidate inside `bots.perception.engageRange`, so with nobody in
contact the count is zero on the proving ground AND on Coldharbour, and a
skirmish has to be forced. And the proving ground's reflection bake takes **21 s
and 24 frames** to drain: warm on `reflections.queue.length === 0` and never on
a wall clock, or the bake is reported as the round (10 frames in 8 s, a 894 ms
median frame, 1.1 fps — all of it the bake).

---

### S3 — Compact the nav graph's surface ids — **LANDED**

Wall 3, and the structural half of it.

**Done.** A surface id is `cellBase[cell] + slot`, the rasteriser fills a
scratch that is thrown away in the constructor, and `heights`, `walkable`,
`blocked`, `links`, `surfaceCell` and every `FlowField.dist` are allocated over
the surfaces that exist. `CoverMap`'s three masks are compacted in the same
pass, addressed through the graph's own `cellBase` rather than a second copy of
the arithmetic. **Measured 99.2 → 40.0 MiB on the committed 900/300 proving
ground** (2.48x), 12.6 → 5.5 on Coldharbour, 14.8 → 5.6 on Harrowmead. Real
occupancy is 1.58 / 1.02 / 1.47 surfaces per cell, against the ~1.3 this step
derived from.

**The graph is bit-identical, and that is checked rather than argued.** The
fingerprint could not be the oracle it was billed as — every hash in it is over
arrays whose LENGTH and whose stored ids both change with the compaction, so it
must differ and a difference proves nothing. What replaced it is a canonical
dump, id-encoding-independent by construction: per cell, its count, and per
surface its height, walkable, blocked and its eight links written as
`(target cell, target slot)` rather than as an id. Taken through
`server/parity.ts`'s own path on all four shipped maps, before and after, plus
the seven flow fields hashed the same way. **Every hash is identical.** The
mutation half was checked separately in a real browser: break all twenty-four of
Coldharbour's panes through `GlassSystem.catchUp`, rebuild all seven fields,
canon-hash again — identical before and after the change, walkable unchanged at
34,142, and `openBox` never wanted an id the build had not already made.

**The link encoding was measured and NOT taken.** `links` is still an absolute
surface id in an `Int32Array`. The Int8 slot form does save what it promised —
16.1 MiB to 4.0 on the proving ground, 40% of everything left in the nav layer
after this step — but the decode is not free: measured on the real table, on
real data, an 8-way sweep reading `links` directly is **7.8 ms** and the same
sweep decoding `surfaceCell` → cell → `cellBase` is **18.2 ms**, a **2.33x**
per-read penalty (Coldharbour: 1.3 → 2.9 ms, 2.23x). That lands on
`buildField`, which is 14.4 ms a field at 900/300 and 1.9 on Coldharbour, and
`GlassSystem` already drains those one per frame. **S4 is about to rewrite that
array anyway**, so the number is recorded here rather than spent now: if S4
leaves a BFS shaped like this one, the trade is 12 MiB against roughly doubling
a field build, and it was not obviously worth it at 900/300. — *S4 did leave it
shaped like this one, so the penalty applies unmeasured-again and the trade is
the one above. **Declined**, and the reason is in S4: the memory this would buy
is a fifth of a percent of the heap wall 3 is about, and what it would cost is
the rebuild spike S4 measured at ~32 ms a field at 1500/0 and handed to S5.*

**What it did not change, checked rather than assumed:** `maxSurfaces` is still
the map's own answer and still a CEILING whose overflow drops the arriving
candidate silently, in arrival order — the builders' collider ordering contract
is untouched. `debugSnapshot` still returns live references, read-never-write,
and now carries `cellBase`, `surfaceCell` and `surfaceCount` beside them.
`worldFingerprint.surfaces` changed VALUE — it reports real surfaces now, not
`cells * maxSurfaces` — which is a narrower and more honest number; nothing
compares it across versions, only client against server. One editor bug fell out
on the way: `validate.ts`'s island finder tested `heights[s] >= 0` to skip the
old padding, which also hid any island standing below sea level; a compacted id
space has no padding to skip and the test is gone.

**Must not break:**

- `src/world/fingerprint.ts` and `npm run parity`. **This step was written
  expecting the fingerprint to be the oracle, and it cannot be** — its
  `heights`, `walkable` and `links` hashes are over arrays whose length and
  whose stored ids both move with the compaction, so it MUST differ and a
  difference proves nothing either way. It is still the client-against-server
  check it was built to be, and `npm run parity` still passes; what it is not
  is a before-and-after. The canonical dump above is what replaced it, and a
  later step touching this indexing wants the same instrument.
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

### S4 — Flow fields at 1500 m — **MOVE 1 LANDED, MOVE 2 MEASURED AND NOT TAKEN**

Seven `Float32Array`s over the whole graph, rebuilt on a broken pane (finding 9).
At this size that is the second-largest line in wall 3's table and the
longest-running item in wall 4.

Three moves, in increasing order of how much they change:

1. **`dist` holds BFS step counts, so it does not need 32 bits.** A
   `Uint16Array` with `0xFFFF` as the unreachable sentinel covers 65,535 steps
   against a 1,000-cell diagonal. A free 4x with no behaviour change. —
   *Done, and it is a free **2x**, not 4x: `Float32Array` is four bytes and
   `Uint16Array` is two.*
2. **Seven whole-map fields may not be the right model any more.** A bot 800 m
   from a flag does not need a per-cell route to it, it needs a bearing. A coarse
   field over blocks with the fine field computed only near the goal — or fields
   built lazily and evicted — is the shape, and `nav.steer()` being the one
   reader is what makes it changeable at all. — *Not taken. Measured, its case
   has gone; see below.*
3. **Build them off the main thread**, which is S5. — *Still S5, and still not
   taken. S5b and S5c have both landed since, which is what ungated it: the
   worker now has to overlap the MERGES, because the 13.4 s compound it could
   have hidden behind is 181 ms.*

**Move 1 is done and the graph is bit-identical, which is checked rather than
argued.** The same canonical dump S3 built is what did it — per surface, the
step count with the unreachable marker written as `-1` whatever the sentinel
happens to be, so the hash cannot notice a representation change — taken through
`server/parity.ts`'s own path on all four shipped maps. **All 28 fields hash
identically**, along with `reached`, `max` and the array length. **The mutation
half is checked separately and is the half that matters**, because a field's
REBUILD path is the one a break exercises: opening all twenty-four of
Coldharbour's breakable panes through `NavGrid.openBox` and rebuilding all seven
fields gives seven more identical hashes, and `walkableCount` is unchanged at
34,142 either way. 35 hashes, no differences.

**What it bought, measured on the committed 900/300 proving ground** (the nav
layer here is every per-surface array plus `CoverMap`'s masks, which is a wider
accounting than S3's):

| | before | after |
| --- | --- | --- |
| seven flow fields | 14.11 MiB | **7.05 MiB** |
| the graph's own arrays | 22.88 MiB | 22.88 MiB |
| `CoverMap`'s masks | 7.26 MiB | 7.26 MiB |
| **nav layer** | **44.24 MiB** | **37.19 MiB** |
| `rebuildField`, median of five | 11.60 ms | 11.80 ms |

Coldharbour's seven are 1.93 MiB → 0.96, and one rebuild there is 0.90 ms.
Derived forward to 1500/0 at the measured 1.47 occupancy: the seven go 39.2 MiB
→ **19.6**, and the nav layer ~122 → **~103 MiB**.

**The BFS queue became an `Int32Array` in the same change and it is a memory
move rather than a time one.** Every surface is enqueued at most once — the
seeds are all zero and the sweep is FIFO, so `dist` is discovered in
non-decreasing order and `dist[t] <= next` refuses every second visit — which
makes `surfaceCount` an exact capacity rather than a high-water mark. What that
replaces at 1500 m is a `number[]` growing to ~1.5 million elements through a
dozen reallocations, once per field. **It did not measurably change the build**:
11.60 → 11.80 ms is inside a spread that ran 11.1–13.4 across both runs. Do not
quote it as a speed-up.

**The headroom on the sentinel is not close.** Measured maximum BFS depth across
all 28 shipped fields is **254** — Harrowmead's two home fields, on the largest
shipped map — against 65,534. `buildField` still guards it: a step count that
would collide with the marker is not written, so the field stops rather than
inverting into "unreachable".

**Move 2's case has gone, and this is the step that was supposed to find that
out.** It rests on two claims and S3 plus move 1 have taken both:

- **Memory.** The wall's table put seven fields at 106.8 MiB and derived the
  redesign from that. S3 compacted the id space and move 1 halved the element,
  and what is left at 1500/0 is **~19.6 MiB against a 3,536 MiB heap** — 0.6% of
  the allocation failure that is wall 3. A coarse-plus-fine or lazy-and-evicted
  scheme would be chasing a fifth of one percent of the tab, and paying for it
  in the one place this codebase is least able to afford a mistake.
- **Load time.** Wall 4 measured the seven at **368 ms of 182,889**. They are
  the smallest line in that table, not "the longest-running item in wall 4" —
  that sentence was written before S0 measured anything, and the placement loop
  is 87%.

What is genuinely left is the **rebuild spike**: 11.7 ms a field at 900/300
scales to ~32 ms at 1500/0, and `GlassSystem` drains one per frame, so a break
burst on a map with breakable glass costs seven consecutive ~32 ms frames. That
is a real cost and it is **S5's shape rather than move 2's** — the work is
unchanged and wants to be somewhere other than the frame. It is also not
chargeable to any map that exists: the proving ground has no breakable glass and
the desert city is S11.

**So move 2 is recorded as measured-and-declined rather than deferred.** Anyone
reopening it needs a NEW measurement, not this one — and the thing that would
reopen it is a 1500 m map with glass in it, where the number to beat is the
32 ms, not the 19.6 MiB.

**S3's open question about `links` is answered by the same logic and the answer
is no.** S3 measured the Int8 slot encoding at 16.1 MiB → 4.0 on the proving
ground and left the decision here, because "S4 is about to rewrite that array
anyway". S4 did not: the BFS is the same sweep over the same absolute ids, so
S3's measured 2.33x per-read penalty applies unchanged, and it would land on a
`buildField` that is already 11.7 ms and on `GlassSystem` draining those one per
frame. **12 MiB against roughly doubling the spike this step just declined to
redesign for is the wrong side of the trade.** `links` stays an `Int32Array` of
absolute surface ids.

**Must not break:**

- **Bots read `nav.steer()`, never run their own pathfinding, and never use
  `moveWithCollisions`.** Whatever replaces a field must keep that true; per-bot
  A* is exactly what this design replaced. — *Untouched: `steer` and
  `steerAhead` are the same comparisons, and `FLOW_UNREACHED` loses to every
  real step count exactly as `Infinity` did.*
- `GlassSystem`'s amortised rebuild, and `fieldGoals` — the arguments a field was
  built from are held precisely so one can be built again after a break. —
  *Checked, and it is the mutation half of the oracle above.*
- The staleness guarantee: a route computed before a wall opened is stale (it
  walks the long way) and never wrong. Any lazier scheme must preserve that, or
  it is a correctness change wearing a performance change's clothes. — *Nothing
  got lazier, so nothing had to preserve it.*
- **The one reader outside `NavGrid` that tested the sentinel by its TYPE.**
  `editor/navOverlay.ts` painted "reached, but no route to this objective" with
  `!Number.isFinite(dist[s])`, and every value in a `Uint16Array` is finite — so
  the amber pass would have gone silently empty and the overlay would have
  reported a perfectly routed map. It tests `FLOW_UNREACHED` now, and a later
  change to this array's width wants that grep before anything else.

**Verify:** the canonical dump above on all four shipped maps, build and
post-break rebuild; `npm run typecheck`; `npm run build`; `npm run parity`; and
`bank.mjs --check`. — *All done. **The bank is stale on this machine and it is
pre-existing**: fifteen of the sixteen vantages report a regression on an
UNMODIFIED tree, and the control run reproduces every mean to four decimals
(hollowmere/menu 0.627, coldharbour/avenue 3.2563, harrowmead/millpond 1.3526,
and so on down the list), with harrowmead/borderland at 0% in both. Identical to
the digit with and without this change is what says the change moves no pixel;
re-banking would have destroyed that evidence, so the bank was left alone. It
predates the last two commits and wants re-taking as its own piece of work.
`npm run simulate` is still the pre-existing NullEngine failure finding 23
records.*

---

### S5 — The load behind the card — **THE FLATTEN LANDED; S5b HAS UNGATED THE WORKER AND IT IS STILL NOT TAKEN**

**This step was called "Move the burst builds off the main thread", and that
name stopped being true twice.** What landed under it was a GPU-upload fix, and
what the re-time it demanded found underneath was a quadratic physics compound
and a whole-scene walk per render pass id — none of which is a burst build and
none of which is about a thread. So the step is the LOAD now, the worker is one
candidate inside it rather than its subject, and the two things it turned up are
S5b and S5c below. The original framing is kept under the rule because the ORDER
it argues for is the order that turned out to be right, three times running.

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

---

**The flatten has landed and `FINDINGS.md` 24 is what it produced.** The 1500 m
build is **185,899 ms to 17,422** and the placement loop **161,491 to 9,443**,
both matched pairs on the same tree. The cause was neither of the two things
the paragraph above names:

- **`Scene.removeMesh` is not it, and is not within 65x of it.** Measured on the
  900/300 ground it is called 88,131 times, scans 547 million array elements,
  and costs **98 ms of a 6,420 ms loop**. `AssetContainer` was never the door;
  `rootNodes` has been O(1) since Babylon 9; and an `indexOf` over a packed
  array is 0.18 ns an element. **This document should stop reaching for a list
  scan**, which is the general lesson rather than the local one — and note that
  S5c below is a list scan that DOES cost, because it is a walk of objects
  rather than of a packed array of pointers.
- **It is the GPU.** Every part a builder makes is a real `Mesh`, and
  `VertexData.applyToMesh` uploads its positions, normals, UVs and indices the
  instant it exists. `mergeByMaterial` reads them back out of the CPU copies
  Babylon kept anyway and DISPOSES the source — destroying the buffers it just
  made. ~4.2 s of an 8.8 s build was `device.createBuffer` and
  `queue.writeBuffer` for geometry no frame ever draws.
- **And the `n^2.9` was that allocator degrading**, not an `O(built x live)`
  term. Per placement is now 6.4 ms at 900/300 and 8.5 at 1500/0 — 2.7x the
  placements for 1.33x each, against 7.8x. The road merge and the block merge
  build their geometry the ordinary way and still came down 75x and 8.7x,
  because the device they allocate against is no longer in that state.

`src/world/parts.ts` is the fix: `kit/core.ts`'s seven creation sites build
their geometry BEFORE its mesh and apply it while `delayLoadState` reads
NOTLOADED, so `Geometry.applyToMesh` skips the call that creates every
postponed buffer. `uploadPart` puts a part back on the normal path on the three
ways out of a merge that keep their source. The oracle is a per-mesh hash of
every visual and collider — name, material, metadata, transform, flags, counts,
and the position/normal/uv/colour/index buffers — and **all five maps hash
identically**, with `gate.mjs` clean, `npm run parity` passing and
`bank.mjs --check` reproducing S4's control run to four decimals.

**And then the gap under the build was profiled, which is what produced S5b and
S5c.** `build:total` is 17,422 ms and install-to-`deploy` is 34,923, so more
than half the load was somewhere this document had never looked. `FINDINGS.md`
25 is the attribution, taken as the direct children of `installMap` so the lines
sum to the method:

| installMap, ms | 900 / 300 | 1500 / 0 | |
| --- | --- | --- | --- |
| `MapBuilder.build` | 4,837 | 13,656 | 42.2% |
| `PhysicsWorld.setMap` | 1,716 | **13,402** | **41.4%** — S5b |
| `ReflectionSystem.build` | 1,075 | **5,272** | **16.3%** — S5c |
| everything else in the method, together | 11 | 27 | 0.1% |

**Two of those four rows have moved since, and the table is the BEFORE.** S5b
landed and `PhysicsWorld.setMap` is 268 ms and 682 rather than 1,716 and 13,402;
`MapBuilder.build` re-times a little higher on the same box (17.4 s at 1500 m)
and `ReflectionSystem.build` a little lower (4.5–5.0 s), both inside what the
same instrument scatters by. Quote this table for the ranking that produced
S5b and S5c, never for what the install costs today.

**That last row is the useful negative result and closes a question.** The six
`setWorld` calls, the fog pushes, the leash, the ground probe, the shadow
casters and the culling are 27 ms at 1500 m between them. None of the wiring in
`installMap` needs looking at, and nobody should look again.

**The worker is what is LEFT of this step, and it is deliberately not S5d yet.**
Where the build stands after the flatten:

| | ms | share of the build |
| --- | --- | --- |
| the placement loop | 9,443 | 54% |
| the AO bake | 2,191 | 13% |
| `NavGrid` | 2,572 | 15% |
| `CoverMap` | 736 | 4% |
| seven flow fields | 227 | 1% |
| `ObstacleField` | 7 | 0% |
| **what a worker would move** | **5,733** | **33%** |
| **`build:total`** | **17,422** | |

At S0 that was 3.3% of 183 s and the answer was obviously "flatten first". It is
now a third of the build — a real win rather than a rounding error. **What holds
it back is not its size, it is that S5b moves its design.** Today the order in
`installMap` is build → physics → probes, so a `MapBuilder.build` that returned
with nav OUTSTANDING would hide the whole 3.5 s nav lane behind the 13.4 s
compound for nothing: no restructuring, no second lane. Take S5b first and that
hiding place is gone, and the worker has to overlap the MERGES instead —
`NavGrid` + `CoverMap` + `ObstacleField` + the fields (3,542 ms) against block
merge + pane merge + AO bake + ink twins (3,715 ms), which are near enough
balanced to hide one behind the other but need `build` split into two lanes to
do it. **So the worker is cheaper before S5b and dearer after**, and which of
those is true is not a thing to guess. It is also the only candidate in this
step that opens an async window inside `installMap`, which is what the
must-not-break list below is most emphatic about.

**Re-time after S5b lands, and promote it to S5d then or not at all.** This plan
has been re-ordered by measurement three times — S0 inverted wall 4, the flatten
inverted it again, the install profile inverted it a third time — and writing
the worker down as a step now would be committing to a design whose cost the
next step is about to move.

**S5b has landed and it moved the cost exactly as predicted, which settles the
GATE and not the step.** The 13.4 s the nav lane could have hidden behind is
682 ms, so the hiding place is gone: a worker now has to overlap the merges,
which needs `build` split into two lanes, and the two sides of that
(3,542 ms of nav against 3,715 of merges) are the figures above rather than
fresh ones. Nothing here promotes it — what a worker is worth is now a question
about `MapBuilder.build`, which is 42% of the install and is where finding 24's
open threads are.

The natural cut, when it comes, is that these are **pure functions over plain
data**: `NavGrid`, `CoverMap` and `ObstacleField` take `WorldBox[]` and a
`TerrainField` and produce typed arrays. Neither end needs Babylon. Transfer the
boxes and the heightfield in, transfer the arrays back, reconstruct on the main
thread. `vertexShading` is the same shape over vertex buffers.

There is a **cheaper candidate than any of the three** and it is finding 24's
first open thread: **colliders are still built the ordinary way** — 16,526 boxes
at 1500/0, invisible, never drawn and never picked since wall 2 came down — held
back only because a part has no submeshes and `moveWithCollisions` walks them.
It is the same mechanism that just landed, so it is the thing to try first.

**Must not break:**

- **`installMap` stays the one place a map is built**, and both callers — a round
  starting and an editor rebuild — keep going through it. Two copies of it
  drifted apart once and the failure was silent rather than loud. — *Untouched
  by the flatten: nothing about where a map is built moved.*
- `loading` stays a STEP and not a lid: nothing may simulate under the building
  card, and asynchrony must not open a window where something does. — *The
  flatten is synchronous end to end, so this is still owed in full by the
  worker, and is the whole of why it is gated.*
- The server, which is Node and has no browser `Worker`. Keep the synchronous
  path working and make the worker the client's optimisation, or use
  `node:worker_threads` behind the same interface — but do not fork the logic, or
  the two simulations drift and `npm run parity` will tell you once, late. —
  *The flatten never reaches the server: it is inside `MapBuilder`, which the
  server cannot run at all.*
- Determinism. Scatter is seeded and the nav graph must be identical on every
  boot; a parallel build that reorders anything reachable from the seeded stream
  breaks that. `npm run parity` is the oracle again. — *Checked, and the mesh
  hash above is the stronger half of it: nothing reordered, because nothing
  became parallel.*

**Verify:** the per-mesh hash on all five maps; `npm run typecheck`;
`npm run build`; `npm run parity`; `gate.mjs`; and `bank.mjs --check`. — *All
done and all clean for the flatten. **The bank is still red on an unmodified
tree and it is still pre-existing** (finding 20): the sixteen vantages reproduce
S4's control run to four decimals with this change in the tree, which is what
says it moves no pixel, and re-banking would destroy that evidence.
`npm run simulate` is still the pre-existing NullEngine failure finding 23
records.*

---

### S5b — Stop rebuilding the static world's compound once per box — **LANDED**

**The largest single line in a 1500 m install, and it is a square.**
`PhysicsWorld.buildWorld` adds one `PhysicsShapeBox` at a time into one
`PhysicsShapeContainer`, and the profile puts 13,244 of its 13,398 ms inside
`addChild` rather than in shape construction — so it is Havok rebuilding the
compound's acceleration structure on every insert. `HavokPlugin.addChild` is one
`HP_Shape_AddChild` per call and there is no batch entry point through the
plugin.

| | collider boxes | ms | ms per box |
| --- | --- | --- | --- |
| 900 / 300 | 5,929 | 1,716 | 0.29 |
| 1500 / 0 | 16,526 | **13,402** | **0.81** |

2.79x the boxes for **7.81x** the time — an exponent of 1.94, which is a square
with the rounding off. **The number to beat is 13,402 ms**, and the shape to
beat is the exponent: a fix that halves the constant and leaves the square is
not a fix at this size.

**`PhysicsWorld`'s own header already measured this and read it as flat.** It
says "rebuilding a 33-50 ms compound every time a window goes in is a hitch",
which is Coldharbour's 768 boxes. At 16,526 the same compound is 13.4 seconds —
21.5x the boxes for ~300x the cost. The header's ARGUMENT is untouched (a
rebuild per broken pane is still the wrong trade, and by a wider margin than it
knew); its NUMBER does not generalise and must not be quoted at a large map.

**Two fixes, and they are a first choice and a fallback rather than
alternatives.** Bucket first, because it is contained and it is measurable;
reach for the second only if the exponent survives.

1. **Bucket the compound.** One container per 48 m map block turns `n^2` into
   `k(n/k)^2`: 324 blocks at 1500/0 is ~51 boxes each, so 842k insert-units
   against 273M. What it spends is the argument at the top of `buildWorld` —
   one static body rather than 758 — and that argument is about the plugin's
   per-step sync walking BODIES, so **measure the STEP as well as the build**:
   324 statics that bail out immediately is not 783 dynamic ones, but it is not
   1 either, and this step is the only place that can find out.
2. **Move it off the load.** Nothing needs the static world until something
   falls on it, and the first ragdoll is many seconds after `deploy`. Building
   it on the far side of the loading card takes the whole 13.4 s off the wait
   without touching the shape — and unlike the worker it needs no async window
   inside `installMap`, only somewhere to spend it. **It may not be lazy at the
   first death**: `PhysicsWorld`'s header is explicit that building shapes at
   the moment of a kill is a hitch on the worst frame available, and that is
   still true.

**Must not break:**

- **Nothing under Havok feeds navigation, cover or hit detection.** A corpse is
  not in `NavGrid`, not in `ObstacleField`, not in `hittablesAgainst`, and
  neither a shard nor a chunk is either. Bucketing changes which container a
  shape is in and must change nothing else.
- **`scene.physicsEnabled` stays false**, and the engine is stepped by
  `PhysicsWorld` only while a client says it has something moving.
- **The world is ONE thing to tear down.** The header's second reason for a
  single body is that a map rebuild has one thing to release; `k` buckets is `k`
  bodies and `k` containers, and every one of them has to go in
  `worldCleared`/dispose or the editor leaks a whole static world per rebuild.
  This is the sharp edge of fix 1.
- **A pane of glass stays in the world after it breaks**, and the compound is
  not rebuilt when one does.
- **Editor builds register nothing at all** (`setMap(map, editor)`).
- The floor stays a `PhysicsShapeMesh` per terrain block — it is the documented
  collider exception and has no box to bucket.

**Verify:** the `installMap` attribution again, through the same instrument
(`FINDINGS.md` 25's profile), at BOTH extents so the exponent is a pair and not
a point; a step-cost reading with a corpse pile alive, because fix 1 spends the
per-step body walk; `npm run typecheck`; `npm run build`; `gate.mjs`.

**And this step owes an ORACLE that does not exist yet, which is part of its
cost.** The flatten could hash vertex buffers; a bucketed compound changes what
corpses and shards rest ON, and "it looks the same" is not a test. Havok is
deterministic given identical input, so the instrument is a fixed set of bodies
dropped from fixed transforms, a fixed number of substeps, and a hash of the
resting transforms — identical before and after. Build that first; a physics
change with no oracle is the one class of change this tree has no way to check.
`npm run parity` cannot help: the fingerprint is the nav graph, and physics is
not in it.

---

**Fix 1 landed, the exponent went with it, and the fallback was not needed.**
`PhysicsWorld.buildWorld` builds one `PhysicsShapeContainer` and one static
`PhysicsBody` per 48 m map block — `MapBuilder`'s `BLOCK_SIZE`, keyed exactly as
`BlockMerge` keys a merged visual — with each block's collider boxes and its own
terrain patch in it. Every bucket's node stands at the ORIGIN and every child
carries the world-space transform it always carried, so nothing in the world
moved; what changed is which container each shape is in.

| `PhysicsWorld.setMap` | boxes | before | after | |
| --- | --- | --- | --- | --- |
| 900 / 300 | 5,929 | 1,726 ms | **268 ms** | 6.4x, 420 buckets |
| 1500 / 0 | 16,526 | 13,433 ms | **682 ms** | 19.7x, 1,023 buckets |

**The shape is what matters and the shape is gone.** 2.79x the boxes cost 7.78x
the time and now cost 2.54x — an exponent of 1.94 against 0.89, which is a
straight line with the rounding off, and per box it is 0.29/0.81 ms against
0.045/0.041. A fix that halved the constant and left the square was the thing
this step said not to accept; this is the other one. Install-to-`deploy` at
1500 m is **42.6 s to 22.6**, and `PhysicsWorld.setMap` is 3.0% of `installMap`
where it was 41.4%.

**The step was measured as the step demanded, and it costs nothing.** With
sixty-four bodies resting on the 1500 m ground a substep is 36/36 us against one
static body and 35/31 against 1,023 — inside the scatter of the same reading
taken twice, which is the answer the plugin's own code predicts: `executeStep`
walks bodies three times and a STATIC one is a `continue` in each. What does
show is the falling phase, where the whole 480-substep settle goes from ~52 ms
to ~60: about 18 us a substep with sixty-four bodies in contact at once, a tenth
of a percent of a frame, and only while something is tumbling. The
single-body argument at the top of `buildWorld` was about 783 DYNAMIC bodies and
it survives untouched; what did not survive is the assumption that its number
generalises.

**The ORACLE this step owed exists and it is `plans/physics-ref/drop.mjs`.**
Sixty-four boxes on a seeded lattice over the play square, each dropped 1.2 m
above whatever `RayWorld.castBody` says is under it, 480 substeps at
`CONFIG.bots.death.substep`, and the resting transforms hashed. Three things had
to be learnt to make it an instrument rather than a coin toss, and each is
written up in its header:

- **A resting transform is the measurement and a velocity is not.** Havok
  DEACTIVATES a settled body and freezes the velocity it went to sleep holding —
  measured on Harrowmead, one box reported 0.02267 m/s at 480 substeps and the
  identical 0.02267 at 1200. The rest test is a DISPLACEMENT over the last tenth
  of the run.
- **The floor is not zero and it moved with this change.** Against the
  single-container world three of the four shipped maps reproduced to every
  decimal recorded and Harrowmead settled one body 2.8 mm apart between two runs
  in one process; against the bucketed world the same runs scatter up to a
  centimetre LATERALLY, because a thousand static bodies is a thousand ways for
  the solver to take the same contacts in another order.
- **So height is graded tightly and sideways loosely**, which is also what makes
  the oracle say something. Across all five maps the worst body came to rest
  3.8 cm from where it did before — and **under a millimetre of that is
  vertical**. A collider that left the world, arrived somewhere else or came
  across at the wrong size is a body resting at a different HEIGHT; sliding two
  centimetres along the same shelf is the solver. The four shipped maps hash
  IDENTICALLY under the old code across two processes, which is what says the
  instrument is reading the change rather than itself.

**The bank was then RE-TAKEN on the far side of the change**, which is the same
rule `bank.mjs` states about a reference frame: the graded run above is the
evidence, and a bank left at the old world would make every later check inherit
S5b's residue instead of starting from `identical`. Re-taken, all four maps come
back identical across two processes again.

**Verified:** the `installMap` attribution at both extents as a matched pair;
the step reading above; the oracle on all five maps; three consecutive rebuilds
holding at 193 bodies and 35 nodes on Hollowmere with an editor build
registering none and a teardown leaving none; `npm run typecheck`;
`npm run build`; `gate.mjs` clean on all four shipped maps (137.8–143.9 fps on
Hollowmere, 69.2–74.8 on Harrowmead, no page or console errors, no probe
re-rendering). `npm run parity` is untouched by this and says so — physics is
not in the fingerprint, which is why the oracle had to exist.

**What this leaves for S5c and for the worker.** At 1500 m `installMap` is now
`MapBuilder.build` 17,370 ms, `ReflectionSystem.build` 4,491–4,972 and
`PhysicsWorld.setMap` 682, so the largest line is the build again and the second
is S5c. And the worker's hiding place is gone exactly as this step predicted: a
`MapBuilder.build` that returned with nav outstanding now has 682 ms of physics
to hide 3,542 ms of nav behind, so promoting it means splitting `build` into two
lanes. That decision is S5's and is still not taken.

---

### S5c — Stop walking the whole scene once per render pass id — **LANDED**

**5,272 ms at 1500/0, and every microsecond of it does nothing.** 96% of
`ReflectionSystem.build` is probe CONSTRUCTION — `newProbe` → `ReflectionProbe`
→ `RenderTargetTexture` → `ObjectRenderer` — and 5,058 ms of that is
`_releaseRenderPassId` on a probe that has never had a render pass id:

```js
// Rendering/objectRenderer.js
_createRenderPassId() {
    this._releaseRenderPassId();              // <- _renderPassIds is EMPTY here
    for (let i = 0; i < this.options.numPasses; ++i) { ... }
}
// Engines/AbstractEngine/abstractEngine.renderPass.pure.js
releaseRenderPassId = function (id) {         // <- id is undefined
    this._renderPassNames[id] = undefined;
    for (const scene of this.scenes)
        for (const mesh of scene.meshes) {    // <- EVERY MESH, EVERY SUBMESH
            mesh._releaseRenderPassId(id);
            for (const subMesh of mesh.subMeshes) subMesh._removeDrawWrapper(id);
        }
};
```

A cube probe is six passes, so **every probe constructed walks the entire scene
six times to release six `undefined` ids**. 265 probes x 6 x 9,002 meshes =
**14.3 million mesh visits** at 900/300, confirmed against the `[reflection]`
line, for 1,075 ms; ~106 million at 1500/0 for 5,272. **It is priced on map AREA
twice over** — more glazed blocks and more meshes to walk for each — which makes
it a wall-1-shaped cost hiding in the load rather than in the frame.

**The loop is Babylon's, so the lever is the MULTIPLIER.** The probes are pooled
and survive a rebuild, so this is a first-install cost — and it is paid at the
worst possible moment, immediately after `MapBuilder.build` has put 23,014
meshes in the scene. Two shapes, neither costed:

1. **Grow the pool while the scene is SHORT.** `installMap` disposes the old map
   on its first line, and between there and the build the scene is ~1,020
   meshes rather than 23,014 — a 22x cut, which would take 5,272 ms to roughly
   240. What stands in the way is that the probe count is not known until the
   map is built, so this needs an estimate off the layout, or a pool grown to a
   ceiling rather than to a count.
2. **Hide `scene.meshes` from the walk** for the length of the construction
   loop. `WorldCulling` already replaces `getActiveMeshCandidates` on the scene,
   so a scoped swap is not without precedent here — but it is a Babylon array
   rather than a Babylon hook, and it is only safe because no frame renders
   inside `installMap` and probe construction creates no meshes. Say both of
   those out loud in the code if this is the one that lands.

**Must not break:**

- **A probe is refresh-ONCE and one per glazed BLOCK** — not one per map, not
  one per material — and `CONFIG.graphics.reflection.drawsPerFrame` with
  `releaseBatch` is what keeps a bake off one enormous frame. S0b is the step
  that bought that and nothing here may spend it.
- **The ink twins stay out of every probe's render list** (`noReflect`). An ink
  twin is an inverted hull, so a probe inside one bakes six flat faces — the
  measurement is on Coldharbour's curtain wall at 85% of the frame's pixels.
- **The WATER pool is separate and is built at a different moment of the same
  install**, from inside `WaterSystem.build`. Anything scoped around the glazing
  loop either has to cover `bakeWater` too or has to be explicit that it does
  not — and this proving ground has no water, so the profile above cannot see
  that half at all.
- `ReflectionSystem.build` parks every probe it owns on the way in, and a
  rebuild with fewer glazed blocks leaves the spares parked with an empty list.

**Verify:** the `[reflection]` DEV line unchanged in every field it prints —
probes, glazing groups, blocks each, meshes, listed, dropped, draws, frames —
which is a full description of the bake that costs nothing to compare;
`bank.mjs --check`, because glazing is on screen and Coldharbour has four
vantages of it; `gate.mjs`, which asserts no probe re-renders per frame; and the
`installMap` attribution again. A map WITH water wants its own reading here
whatever the proving ground says.

---

**Fix 2 landed — the scoped swap — and fix 1 was not needed.** `newProbe` hands
`scene.meshes` an empty array for the length of the `new ReflectionProbe(...)`
call and puts the real one back in a `finally`. It is in the one place both
pools mint a probe, so the WATER half this step said had to be covered
explicitly is covered by construction instead — and so is probe 0, the one the
constructor builds before any map exists.

| `ReflectionSystem.build` | probes x scene meshes | before | after | |
| --- | --- | --- | --- | --- |
| Coldharbour | 40 x 2,213 | 41 ms | **5 ms** | |
| 900 / 300 | 265 x 9,002 | 1,298 ms | **38 ms** | 34x |
| 1500 / 0 | 250 x 23,014 | 6,551 ms | **72 ms** | 91x |

| the WATER pool, which has no proving ground | probes | before | after |
| --- | --- | --- | --- |
| Hollowmere | 3 | 6.4 ms | **1.1 ms** |
| Greyfen | 1 | 4.6 ms | **0.5 ms** |
| Harrowmead | 1 | 4.2 ms | **0.7 ms** |

`installMap` itself — timed around the method rather than to `deploy`, so the
lines sum to it — is 7,510 ms to **6,099** at 900/300 and 24,876 to **19,117**
at 1500/0, both matched pairs on the same tree in the same session.

**The probe count at 1500/0 is 250 and not 770, which was one of finding 25's
own open threads.** `poolBudgetMiB` caps the pool at 320, so 1,153 glazing
groups come back at `perCell` **2** — the first map anywhere in this tree where
the grouping is not 1, and the bounded worst case `docs/rendering.md` describes
turning out to be live at this size. So the walk is 250 x 6 x 23,014 =
**34.5 million** mesh visits rather than the 106 million this step opened with.
The conclusion is untouched; the arithmetic under it was not.

**And the visits do not predict the milliseconds, which is the part to carry
away.** 2.41x the visits between the two extents cost **5.05x** the time — 91 ns
a visit at 900/300 against 190 at 1500/0. The inner loop walks each mesh's
SUBMESH array too, and the outer one walks a 23,014-entry array where the
smaller ground walks 9,002; either way a rate taken on the smaller extent
understates the larger by half. That is finding 18's 0.67 us against finding
19's 1.10 us, in a different file, and it is why the pair was taken.

**Why the swap and not the early-grown pool, which this step listed first.**
Growing the pool while the scene is short needs the probe count before the map
that decides it exists — an estimate off the layout, or a ceiling — and it takes
the walk to ~1,020 meshes rather than to none, which is the 22x this step
costed against the 34-91x measured above. The swap is two assignments per probe
and the argument that makes it safe is two sentences, both of them said out loud
in `newProbe` as this step demanded: **no frame renders inside `installMap`**,
and **probe construction creates no mesh**. The second is ENFORCED rather than
merely stated — anything pushed into the hidden array is moved back into the
real list in the `finally`, with a DEV error naming the site — because
`Scene.addMesh` pushes into whatever `scene.meshes` IS at that moment, and a
mesh lost there is one the frame never walks, the shadow map never casts from
and nothing ever draws.

**Verified:** the `[reflection]` DEV line identical in every field it prints, on
all five maps and both extents — probes, glazing groups, blocks each, meshes,
listed, dropped, draws, frames — with only `queued in` moving; `bank.mjs
--check` producing byte-identical output before and after over all fifteen
shots, including Coldharbour's four glazing vantages and Harrowmead's millpond,
which is what says no pixel moved (the bank itself is still the pre-existing red
S5 records, and re-banking would destroy that evidence); `gate.mjs` clean on all
four shipped maps (137.8-143.9 fps on Hollowmere, 61.2-80.1 elsewhere, 40 probes
on Coldharbour, no probe re-rendering); the `installMap` attribution above at
both extents as matched pairs; `npm run typecheck`; `npm run build`.
`npm run parity` is not owed and says nothing: this touches no world geometry.

**What this leaves.** `installMap` at 1500 m is `MapBuilder.build` 18,837 ms,
`PhysicsWorld.setMap` 181 and `ReflectionSystem.build` 72 — **the build is
98.7% of the install**, everything else in the method is under 300 ms together,
and finding 24's open threads are the whole of what is left of wall 4.

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

**S1 has made this step worth more than it was written to be worth.** Block
visibility landed and its distance half is inert on every map in the tree,
because all three of the big ones state a `fogEnd` past their own diagonal —
so the whole of finding 21's saving is the collider half, and the block half is
waiting on this step to have anything to cull. Measured on the proving ground by
re-filing the built map: a 550 m wall is another 0.6 ms of walk and 0.8 ms of
frame on a map whose structures are only 1,158 of its 9,019 meshes, and on a
ruined city that is the column that grows. **Read S1 and S8 as a pair.**

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
