# FINDINGS

Open threads: things measured or derived and found worth acting on, but not
yet acted on. Each entry says what is **measured**, what is **derived from the
code** and therefore still a hypothesis, and what would settle it.

This is not a bug tracker and not a design document. A finding leaves here by
being fixed (and folded into `CLAUDE.md` or the subsystem's contract under
`docs/` if it turns out to be load-bearing)
or by being disproved. If you disprove one, delete it and say so in the
commit — a stale finding is worse than no finding, because the next person
spends an afternoon re-deriving it.

---

## 1. Frame pacing: the mean says 60, the tail says 28

**Status:** measured, cause unknown.

### What was measured

On a laptop panel that runs 120 Hz on AC and 60 Hz on battery, with the
in-game readout (`#hud-fps`, added alongside the settings screen):

| power | rate | frame time | 1% low |
| --- | --- | --- | --- |
| AC (120 Hz) | >60 | — | — |
| battery (60 Hz) | 60 | 17 ms | **28** |

The counter itself is sound: `Engine.getFps()` is `1000 / mean(frame
interval)` over a 30-frame rolling window, sampled once per `beginFrame()`,
and it agreed with an independent `requestAnimationFrame` count over a
four-second window to **0.9%**. There is exactly one `beginFrame()` per rAF
callback in Babylon's `_processFrame`, and the game has a single
`runRenderLoop` and a single `scene.render()`, so nothing double-counts.

### What it means

A 17 ms mean frame time is the loop sitting on the 60 Hz vsync cadence:
99% of frames are fine. A 1% low of 28 is a tail averaging `1/28 s = 36 ms`.
That number is the tell — **a frame that misses its vsync deadline does not
take 18 ms, it waits for the next interval and takes 33.3 ms.** 36 is just
past that, so the slowest 1% are not "slow frames", they are *dropped* ones,
where the picture is held for two display intervals.

At 60 fps, 1% is 0.6 frames per second: **a visible hitch roughly every 1.7
seconds.** That is very legible under first-person mouse look, and the mean
can never show it, which is the whole reason the low is on screen.

The AC case may be a different and worse problem. If the panel is at 120 Hz
and gameplay reads 60/17, the frame cost is straddling the 8.3 ms budget and
getting pinned to the **60 harmonic** — every frame taking two intervals
instead of one — with excursions to three or four. That is not "capped at 60",
it is running at half the panel's cap with alternating pacing. Not yet
confirmed: the AC reading above is from memory rather than from a capture,
and the frame time beside it was not recorded.

### Candidates, none investigated

- **GC.** A collection every second or two matches the cadence closely.
- **The shadow depth pass** (see finding 2) — but that is a *steady* per-frame
  cost, so it fits the mean sitting at 60 rather than the spikes.
- **HUD `innerHTML` rebuilds.** `magStrip`, `nadePips`, `flagStrip`, the
  damage arcs and the scoreboard are all rebuilt as markup rather than
  patched. Event-driven, not periodic, but a burst of killfeed and arc
  activity lands several in one frame.
- **`ConquestSystem.planSquads`**, on its own 2 Hz timer.
- **WebAudio node churn** in `Sfx` — nodes are created per voice.
- The browser compositor, or anything else on the machine.

### How to settle it

Per-phase timers around the `updateGameplay` stages, accumulated per frame and
logged **only for frames over ~25 ms**. That costs nothing on the 99% and
names the phase on the 1%. If no phase accounts for the gap, the time is
outside the game's own code and GC is the first suspect —
`performance.measureUserAgentSpecificMemory()` or a DevTools allocation
timeline over a minute of play would confirm it.

Worth capturing the AC case properly at the same time: `median_ms` from the
console snippet distinguishes 120 Hz (~8.3) from 60 Hz (~16.7) directly.

---

## 2. The shadow map's refresh test almost never fails during play

**Status:** measured, and half of it acted on. The frequency below was
arithmetic when this was written and has since been captured: **97.5% of frames
re-render** while the view is turning at an ordinary rate, which is what the
arithmetic predicted.

The *cost* has been measured too, and the first response to it is in: the pass
was submitting **all 314 casters and 79k triangles** on every re-render,
because Babylon culls nothing off an explicit `renderList`. It now draws only
the ~150 that can reach the window (`ShadowSystem.cullToWindow`), which is
lossless — see CLAUDE.md. Measured over an identical 24-bearing sweep, that
change and the god-ray detach together took the frame from **846 to 674 draws
and 253k to 194k triangles**.

**What is left open is the original question**, and the cull does not answer
it: the pass still runs on essentially every frame, and whether re-rendering a
2048² depth map at that cadence is worth what it costs is still unmeasured in
milliseconds. The options below stand, all of them still quality trades, and
they are now trading against a pass that is roughly half the size.

### The claim in the contract

`ShadowSystem`'s header says the depth map "re-renders only when the snapped
focus moves", and `update()` implements exactly that: the focus is snapped to
whole shadow-map texels in the light's basis, and `resetRefreshCounter()` is
called only when the snapped value changed. The intent is that a stationary
player pays for one depth pass and then nothing.

### Why it does not hold up

Two numbers from `CONFIG.graphics.shadows`:

```
texel = frustumSize / mapSize = 110 m / 2048 = 0.0537 m
```

and the focus is **not** the player — it is (`Game.updateGameplay`):

```ts
this.shadowFocus
  .copyFrom(this.player.position)
  .addInPlace(this.cameraSys.forward.scale(8));
```

So the focus sits on an **8 m lever arm off the camera's forward**, and moves
when the player walks *or when the player turns*. The lever is what makes this
sharp:

- **Walking.** `player.moveSpeed` is 4.6 m/s (6.9 sprinting). At 60 fps that
  is 0.077 m per frame — **1.4 texels**. Every frame re-renders. At 120 fps it
  is 0.7 texels walking and 1.07 sprinting.
- **Turning.** One texel of focus movement is `0.0537 / 8 = 0.0067 rad`, which
  is **0.38°**. So any turn faster than about **23°/s at 60 fps** moves the
  focus a full texel between frames. Ordinary aiming is many times that; a
  flick is two orders of magnitude past it.

The snap is tested on all three axes (`sx`, `sy`, `sz`) and any one changing
is enough, so real movement — which projects onto more than one — triggers
more readily than the single-axis figures above suggest.

There is a third path worth knowing about: `cameraSys.forward` is built from
`aimYaw`/`aimPitch`, which **include the aimed hold sway** (bob and the view
punch are excluded — they move the rendered camera only). So a player standing
perfectly still and holding ADS still has a continuously drifting focus, and
still re-renders every frame. Hip fire while standing still is the one case
where the optimisation genuinely engages.

**Net: during active play the depth pass runs on essentially every frame.**
The optimisation buys a saving only when standing still, not aiming, and not
touching the mouse — which is close to never in a round.

### Why it might matter

A 2048² depth pass over ~150 merged casters is not free. **The cost in
milliseconds is still not measured** — it could be 0.5 ms or 3 ms, and on the
120 Hz case the difference decides whether the frame fits an 8.3 ms budget.
Measure before trading any quality for it.

### Options, in rough order of cost

1. **Measure first.** A GPU timer query around the shadow generator's pass, or
   simply `shadows.setCasters([])` for a run and compare the readout's frame
   time. That single comparison says whether any of this is worth doing.
   Nothing below should be attempted before it, and the caster cull is in
   precisely because it needed no such licence — it costs nothing visually.
2. **Widen the deadband.** Re-render when the focus has moved more than *k*
   texels rather than one. Shadow edges crawl by up to *k* texels when it does
   fire, which is what the snapping exists to prevent — so this trades a
   visible artifact for frames and needs to be looked at, not just measured.
3. **Drop the lever arm, or shorten it.** The 8 m bias exists so the window
   covers what is ahead rather than centring behind the player. A smaller
   bias re-renders less on turns; zero makes turning free and wastes half the
   window behind the player.
4. **Decouple from turning entirely** — bias along the player's *movement*
   direction instead of the camera's, so mouse look costs nothing. Changes
   which ground is covered, so it wants a look at the shadow window's edges
   during a fast strafe.
5. **Amortise**: re-render at a fixed cadence (say 30 Hz) rather than on
   demand. Halves the cost and introduces a one-frame lag between the world
   and its shadows, which on a 38° moon may well be invisible.

Note that (2)–(5) all trade shadow quality for frame time, and the current
behaviour is the *correct* one for quality. Nothing here is a bug — it is an
optimisation whose precondition turns out to be rare, and a cost nobody has
put a number on.

---

## 3. The GlowLayer draws the whole village into a buffer it cannot light

**Status:** measured. The mechanism is confirmed against Babylon's source; the
one open question is what excluding the geometry costs visually.

### What was measured

**~150 draws and ~30k triangles a frame**, spent rendering cel-shaded world
geometry into the glow layer's texture. Restricting the layer to meshes with a
non-black emissive `StandardMaterial` removed them; a frozen-scene pixel diff
at three lamp-facing vantage points came out **below the frame-to-frame noise
floor**.

### Why it happens

`Game`'s exclusion scan is one loop in the constructor:

```ts
for (const m of this.scene.meshes) {
  if (m.metadata && m.metadata.noGlow === true) glow.addExcludedMesh(m as Mesh);
}
```

That runs **before any map exists** — the map is built per round, long after —
so every mesh `MapBuilder` produces is eligible forever. `WaterSystem`,
`GrassSystem`, `CaptureZoneSystem` and `Sky` each call `addExcludedMesh` by
hand for exactly this reason; the map does not.

What those meshes contribute is nothing. `ThinGlowLayer._shouldRenderMesh` is
just `hasMesh`, and `_setEmissiveTextureAndColor` falls back to `neutralColor`
— `(0, 0, 0, 1)` — for any material without an `emissiveColor`, which is every
cel `ShaderMaterial`. They are drawn as opaque black.

### The catch, and it is the whole question

Opaque black is not *quite* nothing: it is what makes the glow buffer
depth-occlude, so a brazier behind a cottage does not bloom through the wall.
Excluding the world would let it. The blur kernel is 56 px on a half-resolution
texture, so the bleed would be local rather than map-wide, and it did not show
at the three vantage points sampled — but those were chosen for lamps in the
open, which is the case least likely to show it.

### How to settle it

Stand an emissive fixture directly behind a wall — the smithy's forge or a
lit window with a building between it and the camera — and diff with and
without the exclusion. If it bleeds, the fallback is to exclude by distance
from the nearest emissive rather than wholesale, which keeps the occluders
that matter and drops the 90% of the village that is nowhere near a light.

---

## 4. ~~A 4× MSAA backbuffer is allocated and resolved for nothing~~ — FIXED

The engine is now `new Engine(canvas, false, {})` and
`gl.getParameter(gl.SAMPLES)` reads **0** on the default framebuffer, against
the 4 it used to. The reasoning was never in doubt — FXAA sends every pass of
the scene into post-process render targets, so the only thing ever drawn to the
default framebuffer is one full-screen quad, and multisampling it antialiases
edges that do not exist while costing a resolve every frame and ~30 MB at 720p.
`stencil` went with it: nothing in `src/` uses one and there is no
`HighlightLayer`.

Kept as a heading rather than deleted because the saving is what pays for
finding 5's render scale, and the two want reading together.

---

## 5. The fill-rate budget: four full-screen passes and 18.6k particles

**Status:** counted, not costed, and now partly *steerable* — the lever this
entry asked for exists.

- **Four chained passes at the render resolution** — fxaa, godRays, motionBlur,
  horror — plus the glow layer's blur. Finding 2's detach takes that to three
  for most of a round and the blur is already a player setting.
- **The resolution itself is now a setting** (`Settings.renderScale`, three
  rungs of the display's native pixels, `Game.applyRenderScale`). Note what the
  investigation behind it turned up, because it changes what this entry means:
  the engine was never rendering at native resolution at all. Without
  `adaptToDeviceRatio` the backing store matched the CSS pixel grid, so on a 2x
  panel every number here was being paid at a QUARTER of the display's pixels
  and upscaled by the compositor. The default derives back to exactly that, so
  nothing has moved yet — but 75% and 100% are now one keypress away, and
  **that** is the frame cost nobody has measured on real hardware.
- **The ash field is 18,667 alpha-blended GPU particles** (`getCapacity`, at
  steady state). Simulation is on the GPU and cheap; the overdraw is not.

Neither of the last two should be cut by default. If a graphics-quality preset
is ever wanted, these are what it should move, in that order.

---

## 6. Where the per-frame CPU actually goes

**Status:** measured headless, so the absolute milliseconds are inflated and
only the ranking is trustworthy. Recorded because two of these were surprises.

Per frame, in a live round with 16 bots:

| phase | ms | note |
| --- | --- | --- |
| `Player.probeGround` | 2.45 | one whole-scene ray pick |
| `battle.update` | 0.55 | 16 bots, staggered thinking |
| `game.updateHud` | 0.49 | |
| `minimap.update` | 0.28 | canvas redrawn every frame |
| everything else | < 0.2 each | |

**`minimap.update` roughly DOUBLED when the map was turned player-centred and
heading-up**, and the figure above is the square-blit version. Re-measured
against itself in one session on Harrowmead — 300 updates with a 1x1
`getImageData` after each to force the flush — the old whole-map view costs
0.134 ms and the turning one 0.274. Timing the calls WITHOUT that readback says
0.011 and 0.041, which is command submission and not the raster: Canvas2D
defers, and a micro-benchmark of the blit alone reports two microseconds for
work that has not happened yet. Both numbers are software raster under
SwiftShader, so the ratio is the only part to trust; the extra is one rotated
resample of a 220 px square out of the prerendered backdrop.

**The ground probe dominates the game's own JS**, and it scales with the map
rather than with what is on screen: `scene.pickWithRay` with a predicate walks
all 1,775 meshes and ray-tests all 758 solid colliders. A second identical pick
has already been removed (see CLAUDE.md on `Player.floorY`).

### The analytic replacement: written, measured, NOT switched on

`ObstacleField.groundAt` is the bucketed answer this entry asks for — the
highest collider top face in the band the probe reaches — and `Player.probeGround`
is still the ray anyway. What settles it is the differential, and it is worth
recording in full so nobody re-runs it from scratch.

**Sampling the whole map on a half-metre grid at four standing heights is the
WRONG test and says so loudly**: 1.2% of 914k samples disagree on Hollowmere,
2.9% on Greyfen. Nearly all of that is an artefact of asking about positions a
body cannot occupy. Where the probe's origin lands a few millimetres *inside* a
ramp, `pickWithRay` starts within the mesh, punches through it, and reports the
UNDERSIDE — 0.347 for a surface at 0.653. The ray is the one lying there.

**The right domain is the nav graph's walkable surfaces** — every (cell, height)
pair the game says a body can stand on. Over those:

| map | standable samples | disagreements | worst |
| --- | --- | --- | --- |
| Hollowmere | 28,106 | 74 (0.26%) | 3.4 m |
| Greyfen | 23,037 | 42 (0.18%) | 0.59 m |

**The 116 split into two classes running in opposite directions**, which is why
this is not simply "nearly right":

- At the Hollowmere rim the analytic reports 1.2–3.4 m, the nav graph agrees
  with it, and the RAY finds nothing at all and falls back to the terrain.
- Along one Greyfen fence line the analytic reports a surface 0.5 m up that the
  ray passes straight through to the terrain collider below.

The second class is the blocker, and it is a property of the shared primitive
rather than of the call site: `topFaceAtLocalZ` extrapolates a box's top-face
plane across a footprint that `toLocalXZ` bounds with `halfDepth`, which
INFLATES for anything pitched — `(d/2)cos + (h/2)sin`. A tall thin box tilted a
few degrees therefore claims ground beside itself. `NavGrid` tolerates that (a
phantom node is a routing nuisance); a ground probe cannot, because it stands
the player on air.

**What it is waiting on is a footprint test that bounds the plane by the box's
real extent rather than its projected one.** Everything else is done: the query
exists, the buckets are there, and switching `probeGround` over is one line
against ~2.4 ms a frame.

### It IS switched on for a vehicle, and that half is closed

`Tank.supportAt` takes it ten times a frame — once per track contact — and the
hull's `pickWithRay` is gone. **The blocker above does not block a HULL**: a
phantom surface half a metre up is one of ten contacts under a seven-metre
plank, and the rise it asks for is rate-limited by `drive.climbSlope` before it
reaches the drawn tank; the same half metre under a pair of feet stands a player
in the air. That is the asymmetry that let the vehicle go first.

Measured in one headless session on Coldharbour, so only the ratio is
trustworthy: **ten contacts cost 0.0009 ms against 0.567 ms for the one
whole-scene ray they replaced** — about a six-hundredth. It also closes what
used to be a finding of its own: a DRIVER paid two of the frame's most expensive
pick (the hull's ground and the chase camera's pull-in) where a body on foot
paid one. A driver now pays one, the camera's, and it is the only one left in a
vehicle frame. See `docs/vehicles.md`.

What remains open here is the body's, and it is unchanged.

Two things checked and found *not* to be problems, recorded so nobody
re-derives them: the point-light arrays are **not** re-uploaded per draw
(Babylon rebinds a material's uniforms once per frame — measured 99
`uniform3fv` calls a frame, not thousands), and the HUD costs **one** style
recalc and **one** layout per frame.

---

## 7. Allocation churn is real but too small to be the hitch

**Status:** measured. This is evidence *against* finding 1's GC hypothesis, and
it is here so the hypothesis is not re-run from scratch.

A CDP heap sampling profile over 40 frames of a live round:

```
total 13.4 KB/frame
  7.15 KB/frame  Sfx.ts — WebAudio voice nodes and their onended closures
  2.01 KB/frame  Babylon's own render loop
  the rest       < 0.7 KB/frame each
```

So the WebAudio churn finding 1 lists as a candidate is confirmed as **the
largest single allocator in the game** — and 13.4 KB/frame is ~800 KB/s at
60 fps, which is a young-generation scavenge every ten seconds or so, not a
36 ms stall every 1.7. Unless a scavenge here is far more expensive than it
should be, **GC is not what finding 1 is looking at**, and the per-phase timer
plan in that entry is still the way to find out what is.

Caveat worth keeping: this was sampled headless at ~2 fps, where game time runs
at ~25% of wall clock, so the *rate* of audio events per second is not the
rate a real round produces. The ranking is sound; the absolute figure is a
floor rather than an estimate.

---

## 9. A broken pane costs a flow-field rebuild, and the rebuild is not measured on real hardware

**Status:** measured headless, amortised, and worth re-measuring before anyone
raises the breakable-pane count.

Breaking a pane relinks the nav graph locally — cheap, bounded by the
box — and then owes every flow field a rebuild, because a route computed before
a wall opened still walks round it. `GlassSystem.update` drains **one field per
frame** and coalesces every break inside that window into the same pass.

Measured on Coldharbour, headless (so inflated; the ranking is the trustworthy
part):

| | ms |
| --- | --- |
| one field (`NavGrid.rebuildField`) | 4.7 |
| all seven | 15.9 |
| the local relink + flood (`NavGrid.openBox`) | under the timer's resolution |

183,184 surfaces, 34,101 walkable, seven fields (five control points and both
home spawns). The walkable count grew by ~5% when the mixed-use blocks went in
and the timings above were not re-taken; a field is linear in it, so read them
as a floor rather than as current. 15.9 ms in one frame is a dropped frame on a 60 Hz budget that
FINDINGS #1 already says drops one every 1.7 s; spread over seven it is
invisible, and the staleness in between costs nothing because breaking is
monotonic — the graph only ever gains links, so a stale field walks the long way
and is never wrong.

### What is not known

**The real-hardware figure.** 4.7 ms headless is probably 1–2 ms on a real
machine, but that is a guess, and it is the number that decides whether one
field per frame is comfortable or whether it wants spreading further. The
cheapest way to settle it is the same harness as the table above with the page's
own frame loop rather than a synchronous call.

**How it scales with the breakable count.** Coldharbour has twenty-four breakable
panes — the two offices' and the eight shophouses' shopfront bays, the only
glass on the map with a room
behind it — and a firefight breaks perhaps two or three of them, so the rebuild
queue is usually one pass. A map that made every ground floor enterable would
break several per exchange — and while the coalescing means that is still one
pass per burst rather than one per pane, nobody has stood in a fight and
counted. Reach for `PaneSpec.breakable` more often and this entry is the thing
to re-read.

---

## 8. A tumbling ragdoll is the most expensive thing in the frame while it lasts

**Status: the table below DOES NOT REPRODUCE, and the headline is withdrawn.**
Re-measured while raising `maxConcurrent`, and a falling corpse is roughly
0.015 ms rather than 0.34: eight of them cost 0.121 ms/frame against
`battle.update`'s 0.392 ms for all 16 bots in the same run, i.e. under a third
of the roster's AI where this claimed 5-6x. Both runs are headless and inflated,
but the yardstick is the same one, so the ratio is the part that moved.

The two do not reconcile and the difference is not just method. The re-measure
timed `ragdolls.update(1/60)` — exactly one substep — over 1,600 frames inside
the fall, with the spawn outside the timed region; a live 2 fps headless frame
clamps `dt` to 0.05 and so takes `maxSteps` (2) substeps, which is 2x, not 22x.
The rest is unexplained. The most likely candidate is that the original figure
was taken inside the render loop, where a `performance.now()` pair around one
call at 2 fps is measuring whatever else the frame was doing.

**Re-measure on real hardware before trusting either number.** What is safe to
carry forward: the shape (linear in corpse count, ~0 when settled) and the
substep sensitivity, not the absolutes.

The open question below is settled: **86% of the time is inside Havok's
`_step`**, not the JS around it, so the lever is substeps and not the velocity
poll. Measured over the same 1,600 frames with eight corpses live: 0.128 ms
total, 0.111 ms of it inside `_step`.

What the original run recorded, kept for the comparison:

With `CONFIG.bots.death.maxConcurrent` (4) corpses live, per frame:

| phase | ms | note |
| --- | --- | --- |
| `ragdolls.update` — bodies still moving | 1.37 | 24 dynamic bodies, 20 constraints, against the map's static compound |
| `battle.update` | 0.24 | all 16 bots, same run, as the yardstick |
| `ragdolls.update` — everything settled | 0.002 | the engine is not touched at all |

Two things bound it either way, and they are what still hold:

- **It is short.** A body settles in ~1.1 s (measured: ground contact at frame
  20, velocity under `sleepSpeed` by frame 30, frozen by ~frame 65), and from
  then to the sink at 6 s it costs ~0 (re-measured: 0.0004 ms/frame with eight
  settled corpses — `update` does not touch the engine). The window is the fall.
- **It is capped and gated.** Eight at once, and none past the fog wall. The cap
  is what makes the cost bounded rather than a function of how many people are
  dying — and it still is, now that a ninth body EVICTS the oldest corpse rather
  than being refused: the eviction changes which bodies are falling, never how
  many. The unused slots are free (four corpses cost 0.061 ms in a pool of four
  and 0.062 ms in a pool of eight).

The static world build is separate and one-off: **33–50 ms** inside
`installMap` for 733 boxes plus 25 terrain mesh blocks, against a map build
already costing ~570 ms, and it happens behind the deploy screen. Body count
is flat at 25 across three rounds, so the teardown does not leak.

### What is not yet known

Why the two runs disagree by more than an order of magnitude. Until that is
resolved on real hardware, neither absolute is worth quoting; the re-measure is
the more careful of the two (spawn outside the timed region, 1,600 timed frames,
a zero-corpse control that reads exactly 0.000 ms) but it is still SwiftShader.

The plugin's per-step sync walking every body in the engine is why the map is
ONE static body rather than 758 — still reasoned, still never measured against
the alternative. The 86% step share above makes it the more interesting half.

### How to settle it

Repeat the re-measure with the page's own frame loop rather than a synchronous
`update` loop, on real hardware, and see which number it lands on. If the
original stands, the lever is fewer substeps while several corpses are live —
`hasSettled`'s velocity poll is now known not to be it.

---

## 10. The reflection bake is draw-call bound, and a distance cull halves the list

**Measured, headless (SwiftShader, Coldharbour).** `ReflectionSystem` bakes 37
probes at install — one per glazed map block — which is 222 cube faces over
~328 merged meshes each. Forced synchronously in one `evaluate`:

| bake | mean render list | all 37 probes |
| --- | --- | --- |
| as shipped (enclosure removed only) | 328 | **2311 ms** |
| plus a 140 m distance cull | 160 | **1606 ms** |

A 100 m cull leaves 105 meshes and a 180 m cull 219, so the list is roughly
linear in the radius over the range that matters on a 320 m map. The saving is
**30% for half the draw calls**, which says the bake is not purely draw-call
bound under SwiftShader — fill is the rest of it, and dropping the face size
from 256 to 128 already took ~15 ms/face to ~10.

**Not taken, and the reason is a visible failure mode rather than the size of
the win.** A culled mesh does not fade, it vanishes: the cube's alpha goes to
0 where a dropped tower stood and the shader fills that with sky. On a map
whose whole point is that there is no fog wall, that is a reflection with a
hole in it, and the hole is at a fixed radius from a probe the player cannot
see. The rim survives any of these radii — a landform's bounding sphere is
enormous, so `distance - radius` keeps it — which means what gets dropped is
exactly the middle-distance city, the part with contrast in it.

**What would settle it.** The number that decides this is the bake on real
hardware, which nobody has: 2.3 s of SwiftShader against a map build already
costing ~570 ms says nothing about a GPU that draws the same 325 meshes in a
frame at 60 fps. If it lands under ~150 ms, the cull is not worth its failure
mode at any radius. If it lands over ~500 ms, the shape to reach for is not a
hard radius but fewer PROBES — merging the probes of adjacent blocks whose
glazing is within a few metres of a shared centre, which drops the count
without putting a hole in anything.

---

## 11. The editor's tier-3 rebuild is ~2.3 s on Coldharbour, and it is `MapBuilder`

**Status:** measured (CPU), cause located, not acted on.

This is the other half of the editor's Coldharbour problem. The first half —
one frame of ~300,000 draw calls from the reflection bake after every rebuild —
is fixed: `ReflectionSystem.build` now parks its probes on an editor build (see
[`docs/rendering.md`](docs/rendering.md)). What is left is the JS.

### What was measured

Headless, `buildEditorMap()` timed around each of `installMap`'s calls, and
then a CDP CPU profile of the same call. The wall-clock figures below are from
this machine under SwiftShader, but they are **JS and driver time, not
rasterisation** — the profile is of the build, which renders nothing.

| | Coldharbour | Hollowmere |
| --- | --- | --- |
| placements in the layout | 133 | 195 |
| `installMap` total | **2300 ms** | 784 ms |
| of which `MapBuilder.build` | **2131 ms** | 707 ms |
| `editor.rebuildProxies` after it | 79 ms | 230 ms |
| everything else in `installMap` | ≤4 ms each | ≤28 ms each |

`reflections.build` is 4 ms of that on Coldharbour and 0 on Hollowmere: the
bake's cost was never in the queueing, it was the frame afterwards.

Rolled up by function inside the build (total, so these nest):

| ms | what |
| --- | --- |
| 525 | `kit/city.ts` `buildTower` — 44 of them |
| 450 / 401 / 362 | `glaze` / `pane` / `cut` — the 6,139 sheets |
| 389 | `mergeByMaterial` |
| 383 | `MapBuilder.paneGroup` |
| 265 + 236 + 160 | `NavGrid`, `link`, `severLinks` |
| 199 | `bakeVertexShading` |
| 184 | disposing the standing map |

### What it means, and what is still a hypothesis

**Coldharbour is expensive to BUILD, not expensive to edit** — the same
`installMap` costs ~1.8–2.3 s starting a round, where it is paid once behind
the building card. The editor's problem is the frequency: tier 3 fires on every
param edit, add, delete, brush stroke release and road drag release, and
[`docs/editor.md`](docs/editor.md)'s ~570 ms is a Hollowmere number.

The glazing is over half of it and it is drawn twice over — `glaze`/`pane`/`cut`
build 6,139 sheets, then `paneGroup` and `mergeByMaterial` merge them, and on an
editor build the merge is keyed per PLACEMENT so it is 82 merges rather than 40.
**Derived, not measured:** the tier-3 rebuild exists because a param change
shifts every later index in `colliderBoxes`, and that argument is about the
edited placement's own geometry — nothing says the other 132 have to be built
again. An incremental rebuild that re-ran one builder and re-indexed from there
is the shape, and the reason it has not been tried is that the index is what
every editor structure hangs off.

Part of this is not JS at all: `_createVertexBuffer` is 133 ms of SELF time in
the profile, which is buffer upload and will be faster on a real driver.

### How to settle it

Time `buildEditorMap()` on real hardware on both maps first — if Coldharbour
lands under ~600 ms there, this is a headless artefact and the entry should be
deleted. If it stays several times Hollowmere's, the cheap probe before any
incremental work is to skip the AO bake and the cover bake on editor builds the
way the reflections and the physics world already are, and measure what is left.

---

## 12. Coldharbour is FILL-bound, and most of the glass has been taken out of the blend

**Status:** cause measured and located, half of it acted on. The remaining gap
is real and unattributed.

### What was measured

Coldharbour ran ~25% below Hollowmere and Greyfen on real hardware. Structural
counts over the same 30-sample sweep (five control points, six bearings, bots
frozen), headless:

| per frame | Hollowmere | Greyfen | Coldharbour |
| --- | --- | --- | --- |
| draw calls | 546 | 331 | 635 |
| — main pass | 351 | 221 | 411 |
| — glow layer | 124 | 76 | 158 |
| — shadow depth | 71 | 35 | 65 |
| active meshes | 134 | 85 | 169 |
| triangles | 361k | 353k | 319k |
| alpha-blended meshes | 6.8 | 7.2 | 20.2 |

Two candidates are DISPROVED by that table and should not be re-run: triangles
(Coldharbour has the fewest of the three) and the shadow window (200 m against
110, but `cullToWindow` admits 65 casters against Hollowmere's 71, and emptying
the depth pass moved the frame 4.3% — inside the noise).

**Glazing covers 16-45% of the screen**, measured by pixel-diffing a frame
against the same frame with `paneGroups` hidden. Every one of those pixels was
shaded twice: the opaque mass, then the pane blended on top running the same cel
shader plus the glass block.

### What the hardware said, which inverted the ranking

Three changes were A/B'd in the console on a real GPU. **Only hiding the glass
moved the needle.** Dropping distant outline shells (-35.5% of draw calls) and
excluding the world from the glow layer (-26.4%, FINDINGS #3) were both
*negligible* — so this frame is not draw-call bound, and #3's saving is not
worth reaching for on that argument alone. Headless had ranked them the other
way round, which is the sharpest reminder in this file that SwiftShader ranks
draw calls and a real GPU ranks pixels.

### What was done

`Build.pane({ backed })` and `CEL_GLASS_BACKED`: glazing with a solid mass a
hand behind it is drawn OPAQUE over a backdrop the builder names, so the mass
behind it is rejected before it is shaded. 98% of Coldharbour's glazing
triangles. Paired with a front-to-back opaque sort in `Game`'s constructor,
without which the pane is only drawn first by luck. See CLAUDE.md and
[`docs/rendering.md`](docs/rendering.md).

The picture is not identical and the difference is small: against a run-to-run
noise floor of 0.02/255, a street view differs by a mean of 0.63/255 (4.97% of
pixels) and a curtain wall filling the frame at 2 m by 1.72/255 (15.87%, worst
72). The residual is believed to be the soft shoulder — `col` goes through it
and `glassBackdrop * light` does not — plus geometry that was faintly visible
through the glass and is now occluded. Neither has been confirmed.

### What is still open

**The gap did not close.** A console A/B of the same two ideas before this
change was "a step towards it, not all of the way", and that was measured with
the blanket version rather than the shipped per-site one, so the first thing to
do is re-measure. If a gap remains, the next lever in line is the glass
FRAGMENT, which this change does not cheapen at all: the parallax-corrected
`textureCube` in `reflectBoxDir` is its most expensive term, and past ~100 m the
reflection is motion and colour rather than a picture. Fading the cube's weight
to zero over a band and branching the fetch out below a threshold is the shape.

**Nobody has measured any of this in milliseconds on real hardware**, only as
"which of three console A/Bs moved the FPS readout". A paired harness — park the
camera, alternate the config every frame, take the median ratio — is what
settled the equivalent questions headless and would settle these properly.

**The milliseconds now exist, and the gap is far larger than this entry
assumed.** Measured on the Windows box (RTX 4070 Ti SUPER, WebGPU, 1920x1080,
uncapped, sixteen bots, a live round, warm — see `plans/webgpu-ref/gate.mjs`):

| | Hollowmere | Greyfen | Coldharbour | Harrowmead |
| --- | --- | --- | --- | --- |
| warm fps | 132–176 | 133–176 | 46–48 | 52–56 |
| median frame | 5.7 ms | 5.6 ms | 20.8 ms | 17.8 ms |
| p95 frame | 7.4 ms | 6.7 ms | 22.7 ms | 19.5 ms |
| active meshes | ~229 | ~240 | ~902 | ~836 |

**Read the ratio and not the absolute**, and read the active-mesh row before
concluding anything: this sweep spawns the player at a spawn point with the
bots live, where the sweep above froze them at five control points, so the
active set is four times larger and the two are not the same measurement. What
survives the difference is the SHAPE — Coldharbour and Harrowmead cost ~3.5x
Hollowmere per frame, against the ~25% this entry recorded. Hiding the glass
still moves Coldharbour and nothing else does (52.2 fps against 46.4 with panes
disabled, ~12%), so the lever named below is still the right lever; what is not
established is why the gap is now so much wider, and the honest answer is that
nobody has yet run the frozen-camera sweep on this machine to compare like with
like. **That is the first thing to do here, and it is now cheap.**

Two candidates are ruled out by the same run: the forty cube probes are
refresh-once and re-render zero times per frame, so they are a build cost and
not a frame cost; and the post chain is worth ~1% (47.3 against 46.4).

---

## 13. Greyfen's jungle costs 67% more geometry per frame, and nobody has costed it on real hardware

**Status:** measured headless, both sides of the change. The ranking is
trustworthy and the milliseconds do not exist.

### What changed

The map shipped as five belts of forty canopy trees over an otherwise empty
valley: 354 trees placed, one trunk per 12.5 m of map, a median nearest
neighbour of 6.6 m, and a canopy that stopped **24%** of a ray fired straight up
from head height inside the thickest belt. It is now a forest — ~1,390 trees,
nearest-neighbour median 3.8 m, **85-97%** closure where it is deep — with a
crown rebuilt around broad leaf plates rather than fronds (see
`buildJungleTree`) and the grass budget moved out of the shade and into the
clearings.

### What it costs

Same 30-sample sweep as finding 12 (five control points, six bearings, bots
frozen), headless:

| | before | after |
| --- | --- | --- |
| scene triangles | 411k | 728k |
| scene vertices | 631k | 1,246k |
| active triangles / frame, mean | 831k | 1,386k |
| active triangles / frame, max | 1,372k | 2,425k |
| solid collider meshes | 696 | **672** |
| whole-scene ray (`SOLID_ONLY`, 80 m) | 246 µs | **214 µs** |
| map build | 4.0 s | 6.4 s |

Two of those go the RIGHT way and are the reason the rest is affordable at all:
`MapBuilder.clusterColliders` merges the scatter's colliders per 12 m square, so
1,412 blocking props are ~180 meshes and the map has fewer solid meshes than it
did with a fifth of the trees. `Player.probeGround` — the largest single cost in
the game's own JS, finding 6 — therefore got *cheaper*.

For scale, the same sweep reads 337k active triangles on Hollowmere and 339k on
Coldharbour. Greyfen was already 2.5x either of them before this (the grass
field is one mesh with a single bounding box over the valley, so all ~25k tufts
are active every frame whatever the camera does) and is now 4.1x.

### What is open

**Whether 1.4M active triangles a frame matters, and on what.** Finding 12
settled that this renderer is FILL-bound rather than draw-call bound on real
hardware, and disproved triangles as the differentiator *between three maps at
similar counts* — which is not the same question as whether doubling one map's
count costs anything. SwiftShader cannot answer it: it ranks draw calls where a
GPU ranks pixels, and it is the wrong instrument twice over here. What would
settle it is finding 12's own unbuilt harness — park the camera, alternate the
config every frame, take the median ratio — on the phone this game installs
onto.

Three levers exist if it does matter, in the order they should be reached for.
**The counts in `greyfen/layout.ts`** are the direct one and are authored per
region, so density can be dialled without touching a builder. **The grass** is
the cheapest triangle on the map to give back and 7,600 tufts of it have already
gone; the field is still ~17k tufts and ~260k triangles a frame, none of it
culled. **The canopy tree itself** is near its floor at 351 triangles — the
plates are 3.5x more sky per triangle than a frond and the ring counts were cut
until removing one more measurably opened the sky — so there is little left
there without a second, cheaper tree species, which is the one thing this change
deliberately did not add.

---

## 14. The water's key-light glint never fires under a low sun

**Status:** measured on Harrowmead, derived for the other two. One map tested,
three vantages, both sides of the change.

### What was measured

Harrowmead's `WaterEnvSpec.glint` was rebuilt at **0.45** and at **0** — a
source change and a full reload each time, not a mutated uniform — and the
millpond photographed from three places a player can actually stand: level
along the sun's azimuth from the pond's south-east lip, 16 degrees down onto
the near water on that same azimuth (the geometry that should put the sun's
mirror image ~6 m in front of the eye), and twelve metres up over the mill.

Water pixels moved by **1-3 of 255, in both directions** — the same magnitude
as the drift between two runs of the *identical* config, because the sky and
the shadow map animate off wall-clock time. The term is not dim on this map;
it is absent.

### Why, derived from the code

(As the shader stood then — `waveB.z` and `waveStrength` are both gone now; see
"What changed" below.) `col += lightColor * waveB.z * smoothstep(0.25, 0.6, spec)`
with `spec = pow(dot(n, h), CONFIG.water.specPower)` and `specPower = 90`. The gate
opens at `spec > 0.25`, so it wants `dot(n, h) > 0.25^(1/90) = 0.985` — inside
**10 degrees** of a perfect mirror. `n` is `normalize(mix(up, mapped, relief))`
with `relief = waveStrength * 0.85 = 0.51` in water deeper than `depthFade`,
which is most of a pond, and that flattening is deliberate (the comment above
it is about a hard white blob in open water). A 14.5-degree sun therefore has
no facet to reflect off: the exponent and the relief are tuned against each
other and at this sun elevation the pair multiplies out to nothing.

Hollowmere's moon sits at a similar elevation and its glint is the reason the
term exists, so **the honest guess is that this bites every map whose key is
low, which is all of them except Greyfen's overcast noon** — but that is
derived, not measured, and Hollowmere's water is small and dark enough that
nobody has missed it.

### What changed, and what is left

**The premise this was written under is gone: there is a sun on the water now,
and it is not this term.** The water became a Fresnel mirror, so what a low key
lays along a reach is `CONFIG.water.sunHalo` inside the reflection — a broad
glare where the mirrored ray points at the light, arriving through the same
Fresnel as the sky it sits on and bounded by it. That is the term doing the job
the glint was being asked to do and failing at, and it works at any elevation
because it is a picture of the SOURCE rather than of a facet.

The finding itself still stands, narrowed. `specPower` came down 90 -> 60 when
the surface stopped being a normal map, because the exponent is only meaningful
against slopes the surface actually reaches and those are now a stated number
(`waveHeight`, ~0.13 m of relief over a 7.5 m swell, a few degrees). Sixty is
still a tight lobe against a few degrees of slope, so on a map with a
14.5-degree key the glint remains close to silent — it is a crest sparkle for a
higher sun and for point lights, not a sunset term.

**What would settle the rest of it** is the measurement the old plan asked for,
re-run against the new surface: rebuild Hollowmere and Greyfen at `glint: 0`
and diff water pixels. The remedy is unchanged in shape — drop `specPower`
further, or raise `waveHeight` — but the second one is now a number about the
WAVES rather than a normal-map strength, and raising it past ~0.25 starts
aiming the mirrored ray at the ground behind the player, which is the one
direction a surface with no vertex displacement cannot honestly show.

**Do not treat the dial as live until then.** Harrowmead's `water` block reads
as if `glint` were tuned; it is at its shipped default because the measurement
said moving it buys nothing. The `rays.threshold` headroom the old note
protected is real and has been re-measured since the mirror landed — see
Greyfen's own `glint` note, where the reflection turned out to LOWER the frame
maximum below the horizon rather than raise it.

---

## 15. The blast got eight times bigger and nobody has costed it on hardware

**Status: derived from the code and from the counts, not measured. Recorded on
the frame it landed, so the next person does not have to work out what moved.**

The explosion was one emissive sphere, fourteen embers and one GPU dust cloud.
It is now eight layers (`CONFIG.grenade`, "The blast, as a picture"), and the
budget moved in four places at once:

| what | before | after | when it is paid |
| --- | --- | --- | --- |
| pooled meshes | 6 spheres | 28 (4 slots x flash + 5 lobes + ring) | idle: invisible, culled early. Live: up to 7 draws per concurrent blast |
| GPU particle systems | 4 (dust) | 8 (dust + smoke) | idle: `emitRate` 0, `_render` returns before any work |
| Havok bodies | 128 (80 corpses + 48 shards) | 158 (+30 chunks) | only while a burst is falling; `physicsActive` gates the step |
| transparent fill | 34 puffs to 2.9 m | + 14 puffs to 6 m, + a shock ring, + up to 8 scorch discs | the seconds after a detonation |

**The fill is the one to watch, and finding 5 is why.** Coldharbour is already
fill-bound and the ash field is already 18.6k alpha-blended particles; a smoke
column of fourteen six-metre billboards standing over a blast is a large number
of overdrawn pixels in exactly the part of the screen the player is looking at.
The scorch discs are the cheap half — eight small quads, `disableDepthWrite`,
and they are the only layer that persists.

**What is bounded by construction, and therefore is not the question:** the
mesh pools are fixed and built once, no burst allocates or builds a WASM shape
(a chunk's size is decided at construction), the chunk burst is refused past
`debris.distance` scaled by power, and a blast is seconds apart from the next
one by the economy — two grenades a life, a 3.6 s tank reload.

**What would settle it** is a frame capture on real hardware with two blasts
overlapping at close range on Coldharbour, against the same scene with
`grenade.smoke.puffs` at 0 — the smoke is the single largest new fill term and
the one designed to be turned off first if a graphics-quality preset ever
exists. Ranked against finding 5's list, it belongs after the ash field and
before the render scale.

---

## 16. The first seconds of a round are WebGPU compiling pipelines, and on Coldharbour that is 9 fps

**Status:** measured on real hardware, cause located, not acted on.

WebGPU compiles pipelines lazily, and the game does nothing to warm them. On
Coldharbour, measured second by second from the frame the player spawns:

| second | 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- | --- |
| fps | 9 | 34 | 48 | 47 | 48 |
| shader modules created | 42 | 2 | 0 | 0 | 0 |
| render pipelines created | 25 | 3 | 0 | 0 | 0 |

Sixty-two modules and thirty-three pipelines exist by the end; four and two of
them predate the round. **The cost does not appear in the call it comes from**
— summed over the whole round `createRenderPipeline` accounts for 0.6 ms —
because Dawn compiles behind the call and the stall lands on first use, which
is why timing the creation functions proves nothing and the frame clock beside
them proves it immediately.

**Two consequences and they are different sizes.** The measurement one is
settled and written down: any frame rate read in the first ~3 s of a round is
the compiler, which is what made a healthy Coldharbour read as 16 fps against
Hollowmere's 103 and sent an hour after a port bug that was not there
(`VERIFYING.md`, `plans/webgpu-ref/gate.mjs`). The PLAYER-facing one is open:
a round genuinely opens with a second at 9 fps on the heaviest map, on a
4070 Ti, and the deploy screen sits over a live view for several seconds before
that with most of these pipelines uncreated.

**What would settle it** is whether the stall can be moved under the deploy
screen, where there is already a lid and the player is already waiting. The
shape is a warm-up pass after `installMap` that draws each material variant
once off-screen, which is what `scene.isReady()` already tracks per material —
the same signal `plans/webgpu-ref/harness.mjs` waits on, and it flips on
exactly the frame a map first draws. Whether that is a few lines or a fight
with the variant matrix has not been looked at. **Do not reach for it before
the frozen-camera sweep in finding 12**: if Coldharbour's steady-state gap is
also a shader-count problem, the two share a cause and one change may move
both.

---
