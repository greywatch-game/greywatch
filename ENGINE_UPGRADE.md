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

### Wall 1 — the frame walks the whole scene, and the scene is the map — **DOWN, AND MEASURED DOWN AT 1500 m**

**S1 has landed and finding 21 is what it produced**; the walk is 7.6 ms to 2.5
at 900/300 and the frame 9.8 to 4.3. **And the extent this wall was really about
has now been measured too** (`FINDINGS.md` 27): a 1500 / 0 round is
**9.3 ms warm, 107 fps, with 146 active meshes out of 23,031** — against the
30.3 ms below, of which 23.0 was this wall. It is not mostly down at the size
that mattered, it is down, and the frame is no longer where the 1500 m problem
is. What is unmeasured is a FIGHT: finding 22 records that a round left to
itself fires no ray at all, and that reading was taken on a quiet one. What follows is the wall as S0 measured it,
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

### Wall 5 — the reflection bake takes the GPU device, and it was not in this document — **DOWN, BUT IT LEFT 37 SECONDS IN THE ROUND**

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

**And "the total is indeed unchanged" is the half of that correction nobody
followed up, which is what S0c was.** Measured at 1500 / 0 at last
(`FINDINGS.md` 27): the queue drained over **40 frames and 36.9 seconds**, a
928 ms median frame, in `deploy` and then in the ROUND rather than behind the
loading card. **S0c has landed and both halves of that are answered**
(`FINDINGS.md` 28): the drain is behind the card, and it is 10.6 s rather than
44.8 because a probe's six faces now cull like the frame does. The total was
not unchanged after all — it was six times what the picture needed.

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

- **1500 / 0 has not been re-tested** — *answered by `FINDINGS.md` 27 and again
  by 28, at both extents as a matched pair.* The chosen extent is 900 / 300 and that
  is what the committed proving ground is; the ceiling case would want the
  probe cap to actually engage, and nothing has watched it do so.
- **The bake still lands AFTER the loading card, not behind it** — *answered by
  S0c, which put it behind the card.* `installMap`
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

### S0c — The bake drains in the ROUND, and at 1500 m that is 37 seconds of one frame a second — **LANDED, LEVERS 1 AND 2**

**It is down, and the two levers are worth more together than either is
alone.** `FINDINGS.md` 28 is the result. Lever 1 moved the drain off the round
and under the loading card; lever 2 gave a probe's six faces the frustum test
the frame has always had, which removed four fifths of the draws without moving
a pixel. Lever 3 — grouping harder — was **not taken**, and should not be: it
was the one that makes the picture worse rather than the bake smaller, and after
lever 2 there is nothing left for it to buy.

| the drain, matched pairs | 900/300 before | 900/300 after | 1500/0 before | 1500/0 after |
| --- | --- | --- | --- | --- |
| spent in | `deploy` | **`loading`** | `deploy` | **`loading`** |
| frames | 31 | 31 | 47 | 47 |
| wall clock | 24.9 s | **5.7 s** | **44.8 s** | **10.6 s** |
| median frame | 838 ms | **181 ms** | 931 ms | **197 ms** |
| worst frame | 1,141 ms | 382 ms | 1,697 ms | 1,217 ms |
| warm frame after | 4.54 ms | 4.53 ms | 9.08 ms | 9.50 ms |

**In the ROUND, which is the number this step was opened over: 44.8 s to
zero.** The frame count is identical either side by design — lever 2 was
deliberately not allowed to make the queue's budget go further, so the same
number of batches is issued and each one is smaller.

**What each lever did:**

1. **`Game.bakeWait` holds `loading` until `ReflectionSystem.bakePending`
   reaches 0.** No new machinery: `releaseBatch` already rides a render
   observable, `loading` already renders and already simulates nothing, and the
   wait is one call at the END of `tick` — after the render it is asking about,
   and never an arm of the switch. Coldharbour stays exactly one frame of it
   (`installMs` 1,097 → 1,865, `bakeFrameMs` 889 → 5), which is the one frame
   the bake always took, moved.
2. **`ReflectionSystem.faceOf` on Babylon's `getCustomRenderList`.** A cube
   target has no frustum culling of its own — `ObjectRenderer` dispatches every
   mesh in a render list on every face — so a probe drew its whole
   neighbourhood six times. Measured over a whole install: **1,469,484
   mesh-draws offered against 284,097 issued at 900/300 (5.2x), and 2,120,976
   against 394,604 at 1500/0 (5.4x)**. It is `AbstractMesh.isInFrustum` against
   `scene.frustumPlanes`, which is the frame's own test, so what it drops the
   rasteriser was going to clip and the picture cannot move — proved rather
   than argued, below.
3. **`perCell` was left alone.** It is already 2 at 1500 m and grouping harder
   costs 96 m of city out of the middle of a cube.

**Three things this step also had to fix, and only one of them was foreseen:**

- **`loading` stopped being the same question as "the build has not run yet".**
  Three guards read `this.state === "loading"` to mean the second, and with the
  card up through the drain they would have refused a map rotation or a team
  correction arriving from the authority for ten seconds and dropped it on the
  floor — `NetSession.onSeated` defers to a `buildRound` that has already
  happened. `Game.buildPending` is now `loading && bakeWait === null` and all
  three ask it.
- **A wait outliving its own round.** `Game.go` clears `bakeWait`, so a step
  away from the card — the menu, F2, another `startRound` — ends the wait
  wherever it had got to rather than letting `finishBakeWait` open a deploy
  screen over whatever replaced it.
- **A queue that cannot drain must not hang the card**, which the step named.
  Two caps, because they catch different failures: `drainStallFrames` (120) for
  an outstanding count that stops moving, which no wall clock can tell from a
  slow machine, and `drainCapMs` (90,000) for a bake that inches forward
  forever, which no stall counter can catch. Either one gives up and lets the
  remainder land in the round exactly as it used to.

**What it must not break, and did not.** `drawsPerFrame` is untouched and the
queue is still priced at `list.length * 6`, so the largest single submission is
strictly smaller than it was. Coldharbour is one frame of `loading` and the
other three shipped maps are too (`gate.mjs` clean on all four, no page or
console errors). **The picture is unmoved**: `bank.mjs --check` run either side
of the change against the same fixed reference reports the SAME mean on all
sixteen banked vantages of all four maps, to four decimal places — the bank
itself is still red from the drift S0b recorded, so this is the same
stronger-than-a-pass standin S0b used, and it is the check that matters here
because lever 2 changes what is IN a probe's cube. The 1500 m frame is
unchanged at 9.5 ms against finding 27's 9.3 and this run's own 9.1 before, so
lever 2 bought nothing out of the round. `loading` is still a STEP with an empty
arm in `tick`, and an editor build still bakes nothing and never opens a wait.

**What it did NOT do:**

- **The worst frame is still over a second at 1500 m** (1,217 ms). It is the
  first batch, and it is a queue-shaping question rather than a draw-count one:
  one probe goes through however fat it is on an empty frame, by design, or a
  queue with a fat head would never drain.
- **What a bake draw costs is still unexplained** (finding 27), and it is the
  term that multiplies everything above.
- **Nothing has looked at the PICTURE on the proving ground**, which was S0b's
  owed item and still is. The bank proves the four shipped maps are unmoved; it
  cannot see an 800 m radius leaving a hole on a map big enough to cull.

What follows is the step as it was written, kept because the argument for the
shape of the fix is in it.

---

#### The step, as opened

**S0b's second owed item, measured at last, and it is the largest number left
anywhere in a 1500 m round.** `installMap` returns in ~19 s, the state goes to
`deploy` with **211 probes still queued and 1,782,504 face draws outstanding**,
and the next **40 frames take 36.9 seconds** — a 928 ms median frame, a 1,505 ms
worst. The player is looking at the deploy screen and then at the round while it
happens. `FINDINGS.md` 27 is the measurement.

**Read this against the two load steps rather than beside them.** The mesh round
trip (finding 26) is ~6.3 s and the worker's whole ceiling is 3,899 — both
behind the loading card. This is 37 s in the player's hands, and it is six times
the larger of them.

**It is the PRICE of S0b and not a regression, which is why this step is
lettered rather than numbered.** `drawsPerFrame` turns one fatal submission
into a queue, and that trade is correct — what it bought is a device that
survives, measured against a lost D3D12 device and a replaced renderer process.
What S0b explicitly did NOT decide is WHERE those frames are spent, and it said
so: "the bake still lands AFTER the loading card, not behind it… holding
`loading` until the queue is empty is a state-machine change and was out of
scope here", and "1500 / 0 has not been re-tested". Both are now answered.

**Three levers, and only one of them reduces the WORK.** In the order their
size suggests:

1. **Spend the frames behind the CARD.** `loading` is a STEP where nothing
   simulates and the scene still renders (`docs/states.md`), and `releaseBatch`
   rides a render observable — so holding `loading` until the queue and
   `inFlight` are both empty drains the bake under the card with no new
   machinery at all. It moves 37 s rather than removing it, and what it buys is
   that the round is a round when it starts. It also hands the card the progress
   figure it does not have: `queue.length` against what was queued.
2. **Cut the DRAWS, which is the only lever that removes work.** A probe's
   render list is `neighbourhood()` — a pure radius test over the opaque world,
   1,348 of 2,434 meshes each at 1500 m. The FRAME asks a different question and
   gets 146 active meshes out of 23,031, because `WorldCulling` files every
   block-keyed mesh per 48 m block and gates on `fogEnd`. **The bake and the
   frame have never been asked the same question**, and nothing has tried giving
   a probe the frame's answer. This is the shape of a real fix rather than a
   relocation.
3. **Cut the PROBES, and know what it costs before reaching for it.**
   `perCell` is already 2 at this extent. Grouping harder is fewer probes and a
   worse picture, not merely a smaller number: a probe drops every block it
   SERVES out of its own bake (`encloses`), so a cell of four blocks is a probe
   with 96 m of city missing from the middle of its cube.

**Must not break — and this list is mostly S0b's, because this step is spending
what S0b bought:**

- **The device survives.** `drawsPerFrame` is what stands between this bake and
  a lost D3D12 device inside one submission, and a descriptor heap is recycled
  per SUBMISSION — so the largest single frame is what matters and the sum is
  not. **Raising the budget is not one of the three levers above** and must not
  become one by accident while chasing the frame count down.
- **Coldharbour stays ONE frame and the four shipped maps' pixels do not move.**
  All four drain on the first frame, so lever 1 must cost them at most that one
  frame of `loading` — a map whose queue empties immediately may not sit at the
  card waiting for a second one. `bank.mjs --check` either side is what says
  the picture is unmoved.
- **`loading` stays a STEP and nothing may simulate under it.** Lever 1 makes
  the card stay up LONGER, which is more exposure to that rule rather than less.
- **A queue that cannot drain must not hang the card.** A probe re-bakes in full
  until every mesh in its list has a compiled material (`inFlight`), so "wait
  for empty" needs a frame or time cap and a way out — the state machine has no
  concept of a step that fails.
- **The water pool is queued from inside `WaterSystem.build`**, later in the
  same install than the glazing, so anything that waits on the queue has to wait
  after BOTH — and the proving ground has no water, so this profile cannot see
  that half.
- **An EDITOR build bakes nothing**, and a tier-3 rebuild must not start
  waiting on an empty queue.

**Verify:** the drain measurement at both extents as a matched pair, taken
UNPROFILED — finding 27 records that the sampling profiler stretches a 37 s
drain past twenty minutes and cannot be used here; the four shipped maps still
draining in one frame with `gate.mjs` clean; `bank.mjs --check` byte-identical
either side, because lever 2 changes what is IN a probe's cube and that is the
one thing the bank can see; and the 1500 m frame unchanged at ~9.3 ms, which
lever 2 must not buy its saving from.

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
   `Vehicle.update` drives a hull with `body.moveWithCollisions` and the authority
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
  own (`RayWorld.hulls`, filled by `VehicleSystem.build`), `Vehicle.rayBox` hands
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

### S5 — The load behind the card — **THE FLATTEN LANDED; THE WORKER IS UNGATED, RE-TIMED, AND BEATEN BY WHAT THE RE-TIME FOUND**

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

---

**The re-time S5b and S5c both owed has been taken, and the answer is still not
S5d.** Measured at 1500/0 on the tree with both of them in, through
`src/world/buildProfile.ts` and the same `installMap` wrapper finding 25 used:

```
installMap 19,147 ms = build 18,853 + physics 185 + reflect 79 + 30 rest
```

| build phase at 1500 / 0 | ms | share of the build |
| --- | --- | --- |
| **the placement loop** | **10,092** | **53.5%** |
| `NavGrid` | 2,806 | 14.9% |
| the AO bake | 2,414 | 12.8% |
| block merge | 1,144 | 6.1% |
| `CoverMap` | 822 | 4.4% |
| scatter | 469 | 2.5% |
| ink twins, pane merge, valley | 731 | 3.9% |
| seven flow fields | 264 | 1.4% |
| `ObstacleField`, `RayWorld`, the rest | 28 | 0.1% |
| **`build:total`** | **18,853** | |

**The two lanes are still balanced and the worker's ceiling is still ~20%.** The
nav lane is `NavGrid` + `CoverMap` + `ObstacleField` + the fields = **3,899 ms**,
and the merge lane it would have to hide behind is block merge + pane merge +
the AO bake + the ink twins = **4,106**. That is the 3,542-against-3,715 above,
re-measured and unmoved in shape. A perfect overlap takes the install from
19.1 s to about 15.2 — **a fifth**, for `build` split into two lanes and an
async window opened inside `installMap`, which is the single thing this step's
must-not-break list is most emphatic about.

**And the phase that decides whether that is worth doing is the one nobody has
attributed since the flatten.** The placement loop is **53.5% of the build and
sits ahead of both lanes** — `NavGrid` is built from the FINISHED collider set,
so no worker can overlap it — and what it is now MADE OF has not been profiled
since finding 24 changed what it does. The two threads finding 24 names inside
it are ~430 ms of collider buffer work and 656 ms of `CreateBoxVertexData`, both
at 900/300 and neither sized at 1500 m; together they are a tenth of the loop at
the smaller extent, which means **90% of 10 seconds is unaccounted for**.

**That profile has since been taken and it is `FINDINGS.md` 26.** The loop is
another single MECHANISM, exactly as `PhysicsWorld.setMap` and
`ReflectionSystem.build` both were, so the worker loses again and this document
has now been re-ordered by measurement four times, every one of them by
profiling a phase nobody had opened.

**A part exists only to be merged, and the loop pays full `Mesh` price twice
for it.** It is registered in the scene, given a uniform buffer and a GUID, and
tessellated from a fresh unit box; then it is read back out, unregistered, its
buffer disposed and its rendering group freed. `partBox` is 3,465 ms over the
install (18.5%) in two near-equal halves — `CreateBoxVertexData` 1,986 and the
`Mesh` constructor 1,657 — and `MergeMeshes` is 3,834 (20.5%), the largest
single name in the profile, of which **46% is disposing the sources**. Roughly
**76% of the placement loop is that round trip**, around geometry that is a box.

**It is the same shape finding 24 fixed, one layer down**: the flatten stopped
the GPU half of the round trip and the CPU half was never touched. At 1500 m the
CPU half is bigger than the GPU half ever was at 900. Worth ~6.3 s against the
worker's 3,899, synchronous, no async window, no lane split — and
`src/world/parts.ts` is already the module that knows a part is not a real mesh.
What it does not yet do is let one avoid BEING one.

**So the worker stays unpromoted and there is still no S5d**, for the reason
this section has now given four times: writing it down commits to a design whose
cost the next step is about to move. Finding 26's open list has the three
sub-threads, the constraint `parts.ts` puts on any of them, and the oracle.

**The collider flatten is NOT that step and is not a candidate yet.** It is
finding 24's first open thread and it is BLOCKED rather than merely uncosted:
`moveWithCollisions` walks `mesh.subMeshes` and a part has none, so a collider
built as a part would stop nothing, silently — which is a physics failure that
no oracle in the tree would catch as a build change. Giving a part a submesh
with no device buffer is the door, nobody has costed it, and what is behind it
is ~430 ms at 900/300. It is a thread inside the loop above, not an alternative
to the worker.

---

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

### S6 — Make the block and terrain resolution the map's — **LANDED**

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

**Done, and it is six.** `MapLayout.blockSize` is the merge's and
`MapLayout.terrainBlock` is the floor's, each defaulting to `BLOCK_SIZE`
**independently of the other**, both carried on `GameMap` for the readers that
meet a built map rather than a layout. `BlockMerge` and `PaneBlocks` are handed
one value by `build` so they cannot be given two. All three callers of
`terrainPatches` take the map's — `buildValley`, `server/world.ts`'s
`terrainColliders` and the editor's brush, which was the one site that would
have gone wrong quietly. No shipped map states either field, so all four are
bit-identical: `npm run parity` passes on all four, `npm run build` is clean,
and a default build still comes out at this document's own figures — 45
populated merge blocks on Coldharbour, 44 on Harrowmead.

**What follows a map's `blockSize` and what deliberately does not.**
`ReflectionSystem.encloses` and `WorldCulling` follow it for free and needed no
argument, because both read the block KEY the merge wrote rather than a size —
which is the property `encloses` was built on and `WorldCulling`'s
bounds-from-the-meshes rule already made explicit. What does **not** follow it
is the world layer's unit of LOCALITY: `PhysicsWorld`'s static buckets and
`GlassSystem`'s pane index stay on the constant. Neither is an identity —
nothing reads either key — and what they want from a big map is the opposite of
what the merge wants, because `addChild` is quadratic in a container's children
(finding 25). A 128 m bucket is a seventh of the buckets and seven times the
boxes in each, which is most of what S5b bought handed straight back.

**Measured, and the lever is larger than this step claimed.** Uncapped,
1920x1080, headless via `channel: "chromium"`, a quiet warm round on the
committed 900/300 proving ground:

| merge / terrain | install | warm | frame | scene meshes | active | drawn map meshes | blocks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **48 / 48** | 10,973 ms | 74.3 fps | **13.5 ms** | 9,002 | 442 | 1,597 | 280 |
| **96 / 96** | 6,719 ms | 103.0 fps | **9.7 ms** | 7,757 | 222 | 653 | 94 |
| **128 / 96** | 6,404 ms | 110.9 fps | **9.0 ms** | 7,610 | 184 | 506 | 62 |

**33% of the frame and 42% of the install, at 1500 m of ground, for two numbers
in a layout file.** The frame is the draw phase rather than the walk — S1 has
already taken the walk down and `WorldCulling` offers 442 of 9,002 meshes at 48
— so what this buys is 1,597 drawn map meshes becoming 506, each of them a draw
and an outline shell. The install is mostly the reflection bake, and this is a
lever on it that wall 5 did not have: the bake is one cube per GLAZED BLOCK, and
265 glazed blocks become 61. It is the HONEST version of `blocksPerCell`, which
is the dishonest one — a cell of four blocks is a probe with 96 m of city
missing from the middle of its cube, while a wider block is a probe whose
`encloses` still drops exactly what it serves and nothing more.

**The two axes are independent, checked and not argued** — on Coldharbour,
Harrowmead and the proving ground, `blockSize: 96` alone leaves the floor's mesh
count untouched (49 / 97 / 417) and `terrainBlock: 96` alone leaves the block
count untouched (45 / 44 / 280). And `PaneBlocks` never disagreed with
`BlockMerge` at any size: **zero** glazing groups filed under a key the merge
did not also write, at 48, 96 and 128, on both maps that have any glazing —
Coldharbour and the proving ground. `colliderBoxes` and
the nav graph are identical in every row — nothing about the solid world or the
graph is a function of either field.

**What was not done.** No map states either value, including the proving ground:
the table above says what the lever is worth on generated geometry, and what it
costs is cull granularity — a coarser block draws more that is off screen, which
is a trade only a real layout can settle. That is S8's and S11's to spend. Nor
was the PICTURE looked at: `bank.mjs` can only say the four shipped maps are
unmoved, which they are by construction here. See `FINDINGS.md` 29.

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

### S7 — Get the heightfield out of the JS bundle — **LANDED**

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

**Done, and it is the precedent rather than the binary.** `MapDef.heights` is a
`() => Promise<{ default: Heightfield }>` beside `MapDef.collision`, each map's
`heights.ts` grew a default export, and `MapLayout.terrain` **is gone** — the
layouts no longer import their own heights module, so nothing statically
reaches one. The FORMAT is untouched, which is what makes all three of the
must-not-breaks below hold by construction rather than by care: the editor's
writer, `vite.config.ts`'s `WRITABLE` and `scripts/collision-hash.mjs` are
unchanged, and `TerrainField` still takes its half-extent from `size * cell`.
A binary would have bought a smaller file and cost a new writer, a new
`min`/`marker` rule, and a second way for a map to arrive; the parse this step
is about is deferred either way, and only the map being played now pays it.

**Measured, `vite build`, before against after:**

| | main chunk | gzip | heights chunks |
| --- | --- | --- | --- |
| before | 7,649.89 kB | 1,764.10 kB | — |
| after | 7,559.67 kB | 1,748.25 kB | 4, 91.18 kB total |

**90.2 kB and every map's grid off the boot path, for the four maps that exist
at 240–400 m.** That is the whole of what is there to win today: it is the
SHAPE that S11 needs, because the same change at 1500 m is ~700 kB of number
literals that never enter the main chunk and are never parsed by a player who
picks a different map. Harrowmead's 44.56 kB is half of the 91.18, which is the
curve — the grid grows with the square and the win grows with it.

**Everything that needs the floor is HANDED one, and the reason is that
`installMap` is one synchronous turn that cannot contain a fetch.**
`MapBuilder.build(layout, env, heights, opts)` takes it as an argument;
`Game.floor` is where the standing map's is put down, resolved by the two async
doors into a build — `buildRound`, which became `async` for that one line, and
`toggleEditor`, which already was; `buildServerWorld` awaits it beside the bake
it already awaited; the editor writes through `map.terrain.field`, which IS
that object, so the brush and the rebuild tier behave exactly as before.

**Two holes were opened by the await and both are covered.** The MAP can move
through it: `NetSession.onSeated` defers to `buildRound` for the whole wait
(`buildPending` is true from `go("loading")` until `openBakeWait`, which is what
made the deferral correct to begin with), so a welcome landing inside the fetch
would have been applied by nobody. `buildRound` settles the map, fetches, and
asks again on the far side — two passes, no third. And a fetch that FAILS is
`leaveUnknownMap`'s move: there is no honest half-build of a map with no ground
under it, and a card left standing wedges `buildPending` forever.

**The MENU is the one caller that cannot wait**, because it draws the row under
the cursor now. `drawMapThumb` takes the field as an argument and fetches
nothing; `OverlayScreen.paintThumb` hands it whatever `heightsOf` already has —
on a cold boot, nothing — and books a repaint for when the ground lands,
re-testing the row inside the callback because the cursor moves faster than a
fetch. A flat map for a moment and then the real relief; a hole in the menu
until a fetch returns would be the worse drawing.

**`scripts/check-proving.mjs` owed a third sentinel and now has one.**
`proving/heights.ts` used to be reachable only through `proving/layout.ts`, so
`PG-Alpha` covered it for free; a lazy `import()` makes it a chunk ROOT, which
Rollup emits unless the arrow naming it is shaken away with `PROVING`. It is —
the emitted build carries four heights chunks and none of them is the proving
ground's 100 kB — but that is a property of how `maps.ts` is written and not a
promise, which is the entire premise of that script. `PROVING_HEIGHTS_MARK` is
the string, and the file's own note predicted exactly this case.

**Verified.** `npm run typecheck` and `npm run build` clean, `check-proving`
passes with the new sentinel, `npm run collision` re-baked all four maps (the
hashes moved because both hashed files' TEXT moved; **every box is byte-identical
— the only line that changed in any `collision.ts` is its own `sourceHash`**),
and `npm run parity` passes on all four. `bank.mjs --check` is byte-for-byte
identical before and after — S7 moves no pixel — and its 15 standing
regressions are the bank's, not this step's; they reproduce unchanged on a
clean tree. A browser smoke run built all five registered maps, each on its own
floor and at its own extent (Hollowmere and Greyfen 6,561 vertices over 240 m,
Coldharbour 6,561 over 320, Harrowmead 10,201 over 400, the proving ground
51,076 over 900), repainted the menu schematic when the floor landed, and
opened the editor from the MENU — the one door where nothing has ever been
fetched.

**One thing the compiler used to see and no longer can**, said here because it
is the price of the step: `size * cell` must equal the map's extent, and the
two halves are now different files reaching `MapBuilder` by different routes. A
mismatched pair samples the floor against the wrong origin, reads the wrong row
everywhere, and throws nothing. `MapBuilder.build` asserts it in a DEV build.

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

### S8 — Sight, shadow and fog for a map you cannot fog — **THE ENGINE HALF IS LANDED; THE MAP HALF IS S11'S**

**`FINDINGS.md` 30 is the result**, and this step split cleanly in two when it
was opened. Its FIRST half — pick a `fogEnd` well inside the map, put a high sun
on it, size the window to that sun — is map authoring with no map to land on,
and it is restated below unchanged as what S11 owes. Its SECOND half, the two
riders, is engine work and is done.

**The riders are off the weather.** `EnvironmentSpec.bodyDrawDistance` is how
far a BODY is worth drawing, defaulting to `fogEnd`, clamped to it, resolved in
exactly one place (`bodyDrawDistanceOf`) and pushed by `installMap` to all three
gates together — which is what keeps `bots.lodDisableDistance` and
`bots.death.maxDistance` one distance, the property `config/fogWall.ts` exists
to hold. **No map in the tree states one**, so nothing shipped moved.

**What it is worth, and the reading that nearly hid it.** On a QUIET round the
lever is worth −7.4% of the frame, under the measurement protocol's own floor,
because the FRUSTUM already drops every distant rig — **zero rig meshes reach
the active list either way**. Stand the roster down a 900 m sight line, which is
the case a 240 m map does not have, and **65% of the frame's active meshes are
soldiers** (288 of 441) and the lever is **9.2 ms → 6.6 ms, −28%**, reproduced
twice to 0.1 ms. So S8's own claim — that the rigs are the largest bucket in the
frame at this size — is confirmed, and it is invisible in the first measurement
anybody would take.

**And `WorldCulling`'s reach deliberately did NOT move with it**, which is where
this step's two halves meet. The block cull is exact only because a structure
past the fog draws `fogColor` in front of ground that draws `fogColor`; a
building dropped early pops out of a skyline being looked at, and no shorter
number is exact. **So the answer for the WORLD on a map you cannot fog is still
to fog it**, and S1's dormant block half is still waiting on S11 to state a real
`fogEnd` — 0.6 ms of walk and 0.8 ms of frame at 550 m, measured in finding 21
and unchanged by this step.

**The shadow window's ceiling is now checked rather than only written down.**
`ShadowSystem.setShadowWindow` DEV-warns when the window is past what
`depthRange` can carry at the map's own elevation, which is arithmetic no author
can see — past it the along-sun line does not move and the extra is texel
density spent for nothing. The four shipped maps are the evidence the ceiling is
right and none of them trips it: Harrowmead states 185 against 183.8, Coldharbour
200 against 194.9, both authored by eye onto a number neither file names.

**What is still owed:** what the ~19 us per rig mesh is made of (the saving is
three times a draw and nobody has broken it down), what a body popping at 550 m
LOOKS like on a map that states one, and the fade band that has not been built.
Finding 30 carries all three.

What follows is the step as it was written, and its first half is still the
brief for S11.

---

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
straight line across open ground sliding with the player. — *It is a gradient
now: `CONFIG.graphics.shadows.edgeFade` ramps the term back over the last tenth
of the volume, on all three axes. That changed how the boundary READS and not
where it is, so this step's point stands and Sarab took the window to 240 as
well.* `mapSize` stays global
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
the fog. — *It got one: `EnvironmentSpec.bodyDrawDistance`, and the claim
measured true at 65% of the active meshes. See the top of this step.*

---

### S9 — The authority at 1500 m — **LANDED**

**`FINDINGS.md` 31 is the result, and the headline is that the tick is not where
the problem is either.** One process holds a 60 Hz step for sixteen bots across
900 m with three orders of magnitude to spare: **0 ticks of 108,181 over the
16.67 ms budget, p50 0.012 ms, p99 0.055** — and the 1500 m map has the CHEAPEST
tick of the five, because the four levels put bots in contact and it does not.

**The instrument had to be fixed before it could measure anything, and what was
broken was the SERVER.** `npm run simulate` threw on every map:
`EmissiveFogPlugin` is WGSL-only by design, `Material._createUniformBuffer`
picks WGSL only when `engine.isWebGPU`, and the authority runs under NullEngine
— so `getEmissive("#ffe680")` threw inside `CombatSystem`'s constructor, inside
`new HeadlessGame()`. `Match.game` is that constructor and a `Match` is built on
the first join, so **every match server since the WebGPU migration booted
cleanly and died on the first player**. One line in `attachEmissiveFog` fixes
it; the plugin is a picture and the authority draws none.

**What landed beside the fix**, all of it in service of being able to ask the
question at all:

- **The tick block in `npm run simulate`.** Every `step` timed on
  `performance.now()`, reported as p50/p95/p99/max with the count over
  `1000 / TICK_HZ`, and every spike over 1 ms located and checked against the
  round's GC pauses. The mean is printed last on purpose — a stagger
  (`CONFIG.bots.thinkRate`) is a mechanism for producing a tail a mean cannot
  see.
- **Contact buckets beside it**, because a 900 m round is quiet by default and a
  quiet round measures walking: ticks are filed by how many bots held a target
  during them, so the CONTESTED ticks can be quoted rather than the average.
  This is findings 22 and 30's lesson applied to this side before it cost a day
  rather than after.
- **The proving ground has a collision bake**, which is what let the authority
  run on it at all: `DEV_MAPS` in `scripts/collision-hash.mjs`,
  `npm run collision -- proving`, a fourth `check-proving.mjs` sentinel
  (`PG-Boxes`) over 473 kB of numbers that carry no other string, and
  `MapDef.collision` on `PROVING` stops refusing.
- **`npm run simulate:dev`**, the dev-mode server build (`dist-server-dev/`,
  gitignored, never deployed). `--mode development` alone does NOT do it — Vite
  pins `NODE_ENV` to production for every build and `import.meta.env.DEV` is
  resolved from that, so the flag folds the proving ground away and the script
  reports "no map". The `define` in `vite.server.config.ts` is what turns it
  over.
- **`npm run parity` covers the DEV-only maps**, at the cost of a second server
  build. The proving ground passes all 17 fingerprint fields — 5,929 boxes,
  528,287 surfaces, 305,193 walkable — which is what makes every number above a
  measurement of the world the client builds rather than of a bake nobody
  checked.

**What the three inherited items were actually worth:**

- **S2, "which it needs most", is already spent.** No ray in the process touches
  the scene; `RayWorld` answers all of them off the same boxes. What is left of
  the old shape is **one** caller — `Vehicle.update`'s `moveWithCollisions`, which
  is still O(collidable meshes in the map) and is now the biggest single term in
  the authority's tick. Measured at **0.0394 ms/call on Coldharbour's 754 meshes
  and 0.4020 on the proving ground's 5,904**, and it runs only while a hull is
  MOVING — which is why the two maps with armour are the two expensive ticks and
  the three without are the three cheap ones. At 1500 m with two hulls driving
  that is 4.8% of the step. Not a problem; the only term that grows with area.
- **S3, S4 and S5 arrive as a 1.25 s BUILD**, against 235 ms on Coldharbour, and
  the profile puts it in `CoverMap.bake` (`segmentHitsBox` 19.3%) and `NavGrid`
  (`severLinks` 10.2%) rather than anywhere else. That is a rotation cost, not a
  tick cost, and it is the number to watch if a map rotation ever has to be
  seamless.
- **The 400 kB parse is a non-event**: 473 kB, 5,929 boxes, **7.5 ms** to parse
  and evaluate. The projection in the old text was right about the size and
  wrong to worry about it.

**And the round did not resolve.** Five of eleven proving rounds ran the full
45-minute cap with tickets on both sides, the rest took 19-30 minutes against
13-18 on every shipped map, and the peak contact was 5-7 of 16 bots against
10-14 on the levels. **S10 is no longer an arithmetic worry; it is the measured
outcome of a 900 m play square with sixteen bodies on it.**

**What is still owed** (finding 31 carries all of it): the hull sweep, on this
side and on the client's own frame while driving; why a rebuild in the same
process slows from 1.25 s to 2.78 s across four rounds; and the fact that
nothing measured here had a HUMAN in it — no rewind ran, no snapshot was
encoded, and `Match`'s own per-tick work is in none of these numbers.

**Must not break:** `npm run parity` after anything in the world layer, and the
rule that the bake guard hashes the LAYOUT — a flag changed in a builder needs
`npm run collision` by hand. The proving ground is now inside both of those.

---

### S10 — Density, and the sixteen slots

**The engine work above does not make a 1500 m map fun, and it is worth saying so
before S11 rather than after.** Sixteen combatants over 2.25 km^2 is one body per
140,000 m^2. Harrowmead is one per 10,000.

**S9 MEASURED this and it is worse than the arithmetic suggests** (`FINDINGS.md`
31). Even at 900 / 300 — one body per 51,000 m^2 of PLAY, the concentrated
variant lever 1 below argues for — five of eleven headless rounds ran the full
45-minute cap with tickets left on both sides, the rest took 19-30 minutes
against 13-18 on every shipped map, and the peak contact was 5-7 of 16 bots
against 10-14 on the levels. Difficulty does not move it. So this step is not a
polish pass on a working round; at this extent there is no round without it.

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
3. **More bodies, which is the expensive one — LANDED OFFLINE.**
   `CONFIG.bots.perTeam` is 8 and the rig pool is sized exactly `perTeam * 2`.
   Offline that is a config change and a pool resize. **In a match it is a
   contract change**: `CLAUDE.md` says the roster is *sixteen slots, built once,
   never resized*, and *a slot index IS a bot index*. `server/Roster.ts`, the
   wire, `ScoreBook`'s one-row-per-slot ledger, the bench and the scoreboard all
   rest on it. That is a project, not a step — so the two halves were SPLIT
   along exactly that line and the offline one taken.

   `MapLayout.perTeam` is the lever (`perTeamOf`, bounded by
   `CONFIG.bots.maxPerTeam` of 24), Sarab states 24, every other map states
   nothing and is unchanged to the bit, and `BattleSystem.setRoster` rebuilds
   the pool when the number moves — from `buildRound`, never from `installMap`.
   The pool is the ROSTER rather than the ceiling because a rig is nineteen
   meshes in the frame's own walk whether it is enabled or not (S1's whole
   argument), so a `maxPerTeam` pool would have taxed the four maps that did not
   ask for anything.

   **The authority is untouched and a netplay round on Sarab is still 8v8.**
   `Match` and `HeadlessGame` never call `setRoster`; `server/simulate.ts` does,
   before `startRound`, because it measures a round rather than serving one.

   **What it bought, measured.** The headless round S9 quoted at 19-30 minutes
   with 5-7 of 16 in contact at the peak now runs **14.6 minutes with 22 of 48
   in contact**, 9,004 of 52,502 ticks with nobody engaged against a majority
   before, and the authority's own tick is 0.61 ms p50 against a 16.67 budget.
   What it costs is the frame: Sarab warm and uncapped is **15.2-15.7 ms / 62-65
   fps at 24 a side against 10.8 ms / 90 fps at 8** — two samples of the first
   and one of the second, taken minutes apart in one session, which is the only
   way this box's third-of-a-run drift can be read past. Still above 60, and
   still under what the S11 table quotes for Harrowmead and Coldharbour, though
   that last comparison is across sessions and the table's own warning applies.
   The
   ticket count is deliberately untouched (`CONFIG.conquest.tickets`, 400 on
   every map), which is most of where the shorter round came from and is the
   answer to this section's complaint rather than a side effect of it. Lever 2 —
   more flags — was not needed and is still available.

---

### S11 — Build the desert city — **LANDED**

**SARAB is on the map list**: 900 m of play inside 1500 m of ground, five flags,
two hardstandings, and every lever S0 through S9 bought spent at once. It is by
a wide margin the biggest map in the tree — 5.1 times Harrowmead's playable area
and 3.75 times its extent — and it is **faster than both maps a quarter of its
size**:

| uncapped, headless, warm | install | warm fps | med ms | p95 ms | probes |
| --- | --- | --- | --- | --- | --- |
| hollowmere (240 m) | 809 ms | 262.5 | 3.5 | 5.4 | 4 |
| greyfen (240 m) | 4,749 ms | 204.8 | 4.7 | 5.8 | 2 |
| coldharbour (320 m) | 2,003 ms | 52.6 | 19.3 | 21.4 | 40 |
| harrowmead (400 m) | 1,215 ms | 47.7 | 20.6 | 25.7 | 2 |
| **sarab (900 / 300)** | **3,356 ms** | **61.4** | **16.4** | **18.9** | **17** |

**One session** of `node plans/webgpu-ref/gate.mjs --uncap`, and the rows are
comparable to each other and to nothing else. Three runs of the same command on
this tree put Sarab between 11.1 and 16.4 ms and Harrowmead between 14.6 and
20.6, so the box drifts by about a third between sessions — the measurement
protocol's own warning, at four times the size it names. **What survives every
run is the ORDER**: Sarab is faster than both maps a quarter of its size, every
time.

For comparison, the committed 900/300 proving ground at the same extent is
10,973 ms of install and 13.5 ms of frame at the default 48 m blocks. What Sarab
is instead of that is a real layout that states the numbers S6 measured: the
whole table above is `blockSize: 96` and `terrainBlock: 96` doing what finding
29 said they would.

**What it states, and which step each one is:**

- `size: 900`, `borderland: { margin: 300 }`, `ridge: { form: "downs" }` — the
  split this document settled at the top, and the pair `Borderland` requires.
- `blockSize: 96` and `terrainBlock: 96` — **S6**, and Sarab is the first map in
  the tree to state either.
- `fogEnd: 560` inside a 1,273 m diagonal — **S8's first half, and the first
  time any map in this tree has had a fog wall inside its own square**, which is
  what finally gives `WorldCulling`'s block half something to cull.
- `bodyDrawDistance: 300` — **S8's landed field**, and still the only map that
  states one.
- `surfaces: 5` — the ground, two floors and a roof inside a shelled block, and
  a parapet or a rubble heap over one of them.
- `floorSurface: "sand"`, no lamps, no `groundSpec` default, and no breakable
  glazing at all: `GameMap.panes` is EMPTY on this map. The shelled blocks have
  no glass in them, which is both cheaper and truer than a dozen buildings'
  worth of window entries on the wire.

**The AUTHORITY holds it, measured rather than projected.** `npm run simulate
sarab` over three rounds: the world builds in 692 ms, **0 of 64,981 ticks go
over the 16.67 ms budget**, p50 is 0.021 ms and the worst tick is 6.585. Every
round ENDED — 18 minutes of game time, a winner and a side out of tickets —
against finding 31's proving-ground result where five of eleven rounds ran the
45-minute cap with tickets left on both sides. Peak contact was 8 to 12 of 16
bots against the proving ground's 5 to 7, which is S10's density lever working:
900 m of play with the flags 200 to 290 m apart and the ground between them
transit rather than fighting. `npm run parity` passes — 3,231 boxes, 380,598 nav
surfaces, server matching the client on all seventeen fields.

**What it needed that was not on this list.** A vernacular: `src/world/kit/
desert.ts`, eight builders and the first in the kit whose ROOF is walked, which
is what makes a town of flat roofs a second surface over the whole map rather
than a set of boxes. And one scatter prop, the date palm — the only tree that
grows on a map with no water on it.

**Two things on the list below were decided the other way, and both by
looking.** The wadi is **DRY**: it was built with Harrowmead's construction, one
`WaterRect` floated over a carved bed, and a 1.6 m pool under a shoreline band
read as pale membrane rather than water — so the map declares no water at all,
which also spends nothing on the mirror or its probe. And the aberration went
DOWN rather than up: a fringe that reads as heat haze on a 240 m valley reads as
rainbow speckle on a hundred metres of scrub.

What follows is the brief as it was written.

---

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
  turns on the third kit slot (`Game.armourOffered`), online and off. **It is
  also the only thing on this list that costs the AUTHORITY anything**: a
  DRIVEN hull is a `moveWithCollisions` against every collidable mesh in the
  map, measured at 0.40 ms a tick at this extent against 0.039 on Coldharbour
  (`FINDINGS.md` 31). Two hulls is 4.8% of the server step — affordable, and
  the one term out there that grows with map area.
- **A `fogEnd` well inside the map, and a `bodyDrawDistance` inside THAT if the
  bodies want it.** The first is S8's first half and it is what unlocks the rest
  of S1 — 0.6 ms of walk and 0.8 ms of frame at 550 m, still dormant because no
  map in the tree has a fog wall inside its own diagonal. The second is S8's
  landed field, worth 28% of the frame with the roster down a 900 m sight line
  (`FINDINGS.md` 30), and the cost of stating it is a body popping in clear air,
  which nobody has yet had a map to judge.
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
