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

**Status:** measured, ATTEMPTED, and reverted. The mechanism is confirmed
against Babylon's source. The open question below — what excluding the geometry
costs visually — now has half an answer: enough that it cannot be excluded, by
distance or otherwise. Read the last section of this entry first.

**The draw counts below were taken on WebGL2 and are now unattributed.** The
mechanism is source-level and did not move with the backend — the exclusion scan
still runs before any map exists, and `_shouldRenderMesh` is still `hasMesh` —
so the entry stands. What is no longer a current measurement is the ~150 draws
and ~30k triangles.

**The sentence that used to close this paragraph said the count was not worth
reaching for, and finding 17 has inverted it.** It read: finding 12 measured
excluding the world from the glow layer at -26.4% of the draw calls and no
movement in the frame, so only the visual question here mattered. That was true
on a backend where a draw call was cheap. On WebGPU **disabling the layer
outright is worth +22.5% on Coldharbour**, the layer is 883 of that map's 2,647
draws a frame, and this frame is draw-call bound rather than fill bound — see
finding 17 for the measurement and for why the backend changed the answer.
**So the count is now the reason to reach for this, and the visual question in
it is the thing standing in the way.** Nothing about that question has moved:
what has to be established is still whether the village's opaque black is
load-bearing as a depth occluder for the glow buffer, and "how to settle it"
below is unchanged.

Note the size of the prize is not the whole 22.5%: that A/B disables the layer
and the fix here only excludes the WORLD from it, leaving the braziers and lit
windows the layer exists for. The braziers are a small fraction of the 883.

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

### Tried, shipped, and REVERTED — and the predicate was wrong, not the number

`Game.excludeDistantFromGlow` landed this as a per-map range
(`EnvironmentSpec.glowOccluderRange`, 08d1020) and was reverted the same day
(beacd3d) on sight: **lights read through terrain and through buildings at
distance.** Coldharbour and Harrowmead were set to range 0, which excludes every
non-emissive map visual — and the terrain patches are in `map.visuals`
(`terrain-<key>`, `MapBuilder`), so the ground stopped occluding along with the
walls.

**The mistake worth keeping is not the range, it is the PREDICATE.** "Too far
from any emissive to occlude one" sounds obviously right and is geometrically
false: occlusion is a property of the LINE OF SIGHT, not of proximity to the
light. A wall two hundred metres from a lamp occludes it perfectly well when it
stands between the lamp and the eye, and every mesh on the map is between some
camera position and some emissive. Distance-from-emissive cannot express the
question, so no value of the range is the right one — the safe end of it is "the
whole map", which is what the game already did.

That also disposes of the tuning that was done on the way, and none of it should
be re-run: centre-to-centre against surface-to-centre (34 of Coldharbour's 559
visuals excluded at 30 m one way, 140 the other, 508 at zero) was a real
measurement of the wrong quantity.

**How the verification missed it, which is the more expensive lesson.** It was
checked by diffing the committed vantages with the pass on and off, and they
came back 0.04–0.51/255 on Coldharbour against a floor proven byte-identical.
That number was real and meant nothing: `plans/webgpu-ref/vantages.mjs` is a
table of poses chosen to catch a SHADER going wrong — glazing at range, a
lamp-lit street, a gust, water — and a pose with no emissive standing behind
geometry cannot show an occlusion failure at all. **A diff of ~0 there says the
vantage does not test the thing, and it was read as "the change is invisible".**

This entry had already said so, in "How to settle it" below, before any of it
happened: stand an emissive *directly behind a wall* and diff. That is still the
test, it was not run, and a future attempt owes it plus a sweep over many camera
positions rather than the committed four or five — the failure is visible while
WALKING, which is the one thing a bank of still frames cannot do.

**What is still true**: the layer really is drawing the whole village as opaque
black, it really is 883 of Coldharbour's 2,647 draws a frame, and disabling it
outright really is worth ~21%. What is now known is that mesh exclusion is not
how to collect it, because the black is load-bearing everywhere. If this is
worth another attempt the shape to look at is making the occluders CHEAPER
rather than fewer — the glow layer redraws geometry it could in principle share
a depth buffer with — and that is a Babylon question rather than a content one.

---

## 4. ~~A 4× MSAA backbuffer is allocated and resolved for nothing~~ — FIXED

**Re-taken on WebGPU, where the reading is a sample count rather than a GL
parameter, and it still holds.** The engine is
`new WebGPUEngine(canvas, { antialias: false, stencil: false })`,
`engine.currentSampleCount` is **1**, and there is not one multisampled texture
in the engine's cache. The counterfactual was measured rather than assumed: a
second engine on a throwaway 1920x1080 canvas with `antialias: true` comes back
at sample count **4**, `bgra8unorm` colour and `depth32float` depth — which is
33.2 MB of colour and 33.2 MB of depth, so the "66 MB at 1080p" below is exactly
right for the new formats as well. The original WebGL2 reading follows.

The engine was `new Engine(canvas, false, {})` and
`gl.getParameter(gl.SAMPLES)` read **0** on the default framebuffer, against
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

**Re-counted on WebGPU and the shape is unchanged**: the four chained passes are
all still there, and the ash field is a `ComputeShaderParticleSystem` (WebGPU
routes `GPUParticleSystem` to compute rather than transform feedback — no import
and no code changed) at a capacity of 14,934 on Hollowmere with
`randomTextureSize` 8192, against the 18,667 recorded here. The particle count
is a MAP number and moved with the maps, not with the backend. **What is now
costed is the post chain, and it is small**: finding 12's run puts the whole of
it at ~1% of Coldharbour's frame. `renderScale` is still the unmeasured lever.

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

## 6. Where the per-frame CPU actually goes — its one open thread is CLOSED

**Status:** measured headless, so the absolute milliseconds are inflated and
only the ranking is trustworthy. **The thread this entry carried — the ground
probe's analytic replacement — is DONE**; the entry is kept rather than deleted
because four files cite it by number for the measurements below, and because the
differential that justified the switch is not worth anybody re-running. Recorded because two of these were surprises.
**The ranking has since been confirmed on real hardware and the figures are
about five times too big — see finding 18**, which puts `probeGround` at 0.483
ms and everything below it under 0.12. Read the order here, never the
milliseconds.

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

**The ground probe dominated the game's own JS**, and it scaled with the map
rather than with what is on screen: `scene.pickWithRay` with a predicate walked
all 1,775 meshes and ray-tested all 758 solid colliders. A second identical pick
had already been removed (see CLAUDE.md on `Player.floorY`). **It is now
analytic and this row is history** — read the table for the RANKING of what is
left, and the section below for what closed it.

### The analytic replacement: SWITCHED ON, and what closed it

**Status: done.** `Player.probeGround` no longer casts a ray. It takes the
highest of three answers in the band the feet reach — `TerrainField.surfaceAt`
for the floor, `ObstacleField.groundAt` for the static world, and
`VehicleSystem.deckAt` for the hulls, which are in no baked structure — and the
whole thing is a bucket lookup, a heightfield sample and a loop over at most two
tanks. The differential below is kept because it is what the switch rested on
and nobody should re-run it from scratch.

**Sampling the whole map on a half-metre grid at four standing heights is the
WRONG test and says so loudly**: 1.2% of 914k samples disagree on Hollowmere,
2.9% on Greyfen. Nearly all of that is an artefact of asking about positions a
body cannot occupy. Where the probe's origin lands a few millimetres *inside* a
ramp, `pickWithRay` starts within the mesh, punches through it, and reports the
UNDERSIDE — 0.347 for a surface at 0.653. The ray is the one lying there.

**The right domain is the nav graph's walkable surfaces** — every (cell, height)
pair the game says a body can stand on. Over those the two agreed on 99.8% and
disagreed on 116 running in opposite directions, and the second class was the
blocker:

- At the Hollowmere rim the analytic reports 1.2–3.4 m, the nav graph agrees
  with it, and the RAY finds nothing at all and falls back to the terrain.
- Along one Greyfen fence line the analytic reports a surface 0.5 m up that the
  ray passes straight through.

**What closed it was a footprint, and it was in the shared primitive rather than
in the query.** `topFaceAtLocalZ` extrapolated a box's top-face PLANE across the
footprint `halfDepth` describes — which is the SOLID's ground projection, and for
a pitched box is wider than the face sitting on it. The top face's own projection
is an interval of half-width `(d/2)|cos|` centred on `(h/2) sin`, so the solid
reaches `h |sin|` further at one end, and across that strip the plane kept
climbing at `tan(rotX)` over ground it had run out of face for. At the far edge
it overshoots by exactly one `slabThickness`. `boxGeometry` now gates every
height query on `topFaceHalfDepth`/`topFaceCentreZ`; `halfDepth` is untouched and
still owns every question about where a box IS.

**Validated against a brute-force downward ray at the real rotated box**: 640k
samples over 400 random boxes pitched to ±60°, and the new gate answers on
exactly the spots where that ray lands on the top face, to 4e-12 m, and declines
on exactly the spots where it does not. The old gate answered on 1.5% of samples
with nothing standable under them at all, by as much as 6 m.

**On the shipped maps it is nearly invisible, and that is the honest headline.**
Every pitched box in all four maps is a stair flight or its parapet at 8.3–19.3°,
so the widest strip anywhere is 0.343 m against a 1.5 m nav cell. Re-run over
every walkable surface on all four maps, the old gate and the new one give
IDENTICAL answers at every one of them, and the nav graph loses four surfaces on
Coldharbour and none anywhere else. **The fix is what makes the switch safe, not
what makes it worth doing** — and it would have been a live bug on the first map
authored with a steeper pitch.

**What is left disagreeing with the ray is the RAY.** Over every walkable
surface: 0 on Hollowmere, 0 on Greyfen, 431 on Coldharbour and 8 on Harrowmead.
Every Coldharbour one is a cell centre at x = ±160.25, inside the rim wall
(`ridge-e-col`, 160→162): the ray starts inside that box, punches through and
reports its underside at 0, where the analytic reports the terrain at 1.2. Every
Harrowmead one is a cell centre at x = 120.25, exactly on the outer face plane of
a 0.5 m wall — the analytic includes the boundary, Babylon's triangle test misses
it, and the analytic is the one that agrees with the nav graph the bots walk.

**What it costs, measured on the Windows box in a live warm round**, per probe,
against the ray it replaces at the same 2,000 walkable positions:

| map | ray | analytic | |
| --- | --- | --- | --- |
| Hollowmere (240 m) | 0.106 ms | 0.0002 ms | 634x |
| Greyfen (240 m) | 0.099 ms | 0.0002 ms | 458x |
| Coldharbour (320 m) | 0.123 ms | 0.0004 ms | 350x |
| Harrowmead (400 m) | 0.101 ms | 0.0003 ms | 356x |

The ray reads lower here than the 0.483 ms finding 18 measures in the frame —
this is a tight loop with warm caches and that is a live frame — so the RATIO is
the trustworthy half, and either way the analytic is a rounding error. **What
actually matters is the exponent, not the constant**: the ray was O(meshes in the
scene) and this is O(boxes in one 4 m bucket), which is the difference between a
probe that grows with the map and one that does not.

**The one thing it cost is a rule.** The boxes are the STATIC world, so anything
`solid` that MOVES is invisible to the probe — today a tank's hull, and only
that, which is why `Tank.deckAt` exists. Verified against the ray over 1,617
points on and around a parked hull with no disagreement, and a body dropped over
the turret settles on the deck. Anything else that ever moves and can be stood
on owes the same door.

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

Nothing remains open here: the body's went the same way, above.

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

**Measured, headless (SwiftShader, Coldharbour); superseded on real hardware —
see the end of this entry.** `ReflectionSystem` bakes 37
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

**Measured on real hardware at last, and it lands in the SECOND arm of this
entry's own test, not the first.** On the Windows box (RTX 4070 Ti SUPER,
WebGPU) the shipped bake — 40 probes, 128² faces, no cull, a mean render list of
**486** meshes — costs **~1.4–2.1 s in one frame warm, and 1.0–3.1 s on the
frame it first happens**, against a 6.8 ms frame beside it. It is still a build
cost and never a frame cost (the probes are refresh-once and re-render zero
times per frame, confirmed), but it is a second of the map build rather than the
rounding error the sub-150 ms arm assumed. **So the shape to reach for is fewer
PROBES and not a distance cull**, exactly as this entry says of anything over
~500 ms — merging the probes of adjacent blocks whose glazing shares a centre,
which drops the count without putting a hole in anything.

It is draw-call bound, and that half of the title is now confirmed on hardware
rather than under SwiftShader: keeping every probe and truncating each render
list scales almost linearly — 486 meshes 2124 ms, 243 meshes 813 ms, 49 meshes
109 ms. Note the list has grown from the 328 above; that is the map, not the
backend.

**Both halves are now settled, and the cull went in at 800 m — but it is not
what fixed anything.** `ENGINE_UPGRADE.md` S0b took a radius cull, and the
reason the answer moved from "not worth its failure mode" is that the map got
five times bigger rather than that the failure mode got better: a culled mesh
still vanishes rather than fading. What makes 800 m defensible where 140 m was
not is that it is past the diagonal of every map in the tree and past the
longest `fogEnd` any of them declares, so **nothing that ships is culled at all**
and on a fogged map everything it drops was already flat fog colour.

**And it is the smallest of the three levers wherever it has been measured**:
on the 900 m proving ground it takes a probe's list from 928 meshes to 864 — 7%
— because the probes all stand inside the middle 900 m of a 1500 m floor. This
entry's second arm ("the shape to reach for is fewer PROBES") is in as a
`poolBudgetMiB` ceiling that no map in the tree reaches. **What actually took
the bake off the device was neither**: spending it over frames at 50,000 draws
each. A descriptor heap is recycled per SUBMISSION, so the largest single frame
is what the ceiling is against and the total is not — which is the sentence
`ENGINE_UPGRADE.md`'s wall 5 had backwards. Coldharbour's forty probes are
41,934 draws and still land on one frame, unchanged.

**One number in `plans/webgpu_migration.md` and `VERIFYING.md` does not
reproduce and is the open thread here.** Both record this bake at 138 ms on this
machine, and nothing since has been able to repeat it: in the same gate run that
puts Coldharbour's forty probes at 1151 ms, Hollowmere's FOUR cost 76 ms, which
is 19 ms a probe against the 3.5 ms a probe the old figure implies. The box is
running about 20% below the frame rates recorded beside that figure, which is
nowhere near enough to explain 10x. The likeliest reading is that the 138 ms
frame was not the frame the bake happened on — `installRound` times the frame
after the state flips, and the bake is not contractually on it — but that has
not been demonstrated. **Do not quote 138 ms; re-take it.**

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

## 12. Coldharbour was FILL-bound on WebGL2, and most of the glass has been taken out of the blend

**Status:** cause measured and located, half of it acted on. **The title is
past tense as of finding 17, which disproves the present-tense version of it**:
on WebGPU this frame is draw-call bound, and rendering it at a sixteenth of the
pixels costs the same milliseconds. Everything below stands as a WebGL2
measurement and as the history of a change that shipped; what does not stand is
the ranking it hands the next person. Read finding 17 first.

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

**That paragraph is a WebGL2 reading and finding 17 reverses both halves of
it.** On WebGPU excluding the glow layer is worth +22.5% and hiding every
`paneGroups` mesh is worth +1.5% — inside the drift of the run that measured
it. Two conclusions and they are different sizes. The small one is that this
entry's own 12% glass figure (52.2 against 46.4, recorded below) did not
reproduce; the two disablings are not identical, so that is a discrepancy and
not yet a refutation. The large one is that it no longer matters which of them
is right, because **the pixel-scaling test is a better instrument than either**
— it varies the fill and nothing else, where hiding the glass varies fill, draw
calls and active meshes together and cannot separate them. It says there is no
fill term here to find.

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

**M7 adds nothing to the ranking and one thing to the caveat.** The
frozen-camera sweep this entry asks for has still not been run on this machine,
so the "~3.5x Hollowmere" figure is still not like-for-like with the "~25%"
above it. What M7 did establish is that the two levers it might have moved are
not levers: the glass depth bias is at its measured optimum in both directions
(`docs/rendering.md`), and the reflection bake is a build cost rather than
anything per frame — a large one, but paid once at install (finding 10). **The glass FRAGMENT is still the
next lever in line and is still untouched.**

**The glass fragment is no longer the next lever in line.** It is a fill
optimisation — fading the parallax-corrected `textureCube` out with distance
and branching the fetch away below a threshold — and finding 17 says there is
no fill to reclaim on this backend. It stays written down because it is a real
saving on a machine whose balance is different from this one, and the phone
this game installs onto is exactly that machine. But on the box this gap was
measured on, the three levers in finding 17 come first and there is no reason
to spend the picture on this one until they are in.

---

## 13. Greyfen's jungle costs 67% more geometry per frame, and nobody has costed it on real hardware

**Status:** measured headless, both sides of the change. The ranking is
trustworthy and the milliseconds do not exist.

**Half of the title is now answered and the half that matters is not.** Greyfen
on real hardware under WebGPU runs at 133–176 fps warm, a 5.6 ms median and a
6.7 ms p95 — indistinguishable from Hollowmere and a third of what Coldharbour
and Harrowmead cost (finding 12's table). So the forest is not expensive in any
sense a player would notice, and the question this entry was opened for — what
the 67% costs — has been answered as "nothing measurable". What was NOT measured
is the other side of the change, because that Greyfen no longer exists to boot;
the before/after ranking below stays headless and stays unattributed. **A second
thing the re-cut cost, found by M7:** the closed canopy puts the valley floor in
deep enough shade that `docs/rendering.md`'s ground-relief aliasing measurement
can no longer be taken there at all, and moved to Coldharbour.

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

## 17. The frame is DRAW-CALL bound on WebGPU, and that is what the backend changed

**Status:** measured on the Windows box, cause located, three levers costed.
**One of the three has LANDED** — `compatibilityMode = false`, see below — and
the other two have not. **This entry corrects findings 3 and 12**, which were
both written against a backend where a draw call was cheap.

It was opened by a symptom rather than by a sweep: the big maps that used to
run over 100 fps now struggle to hold 60, and the GPU sits at 25-30%
utilisation while they do it.

### The measurement that settles it

Coldharbour, a live round with sixteen bots, warm, uncapped, headless Chromium
on the RTX 4070 Ti SUPER. **The same frame at a sixteenth of the pixels costs
the same milliseconds:**

| render size | fps | frame |
| --- | --- | --- |
| 1920x1080 | 45.9 | 21.8 ms |
| 960x540 | 45.7 | 21.9 ms |
| 480x270 | 46.0 | 21.7 ms |

`setHardwareScalingLevel` is the right instrument here and hiding geometry is
not, which is the methodological half of this entry: it varies the pixel count
and **nothing else**, where hiding the glass varies fill, draw calls and active
meshes together and can never say which of the three it just bought. Hollowmere
answers the same way — 157, 145, 164 fps down the same three rungs, which is
noise around a flat line.

### Where the time goes instead

The rAF callback wrapped, `scene.render` wrapped inside it, medians over 246
frames on Coldharbour:

```
interval 21.5 ms | in the rAF callback 21.3 ms
                 |   scene.render()     19.6 ms
                 |   the game's own JS    1.7 ms
```

The callback fills the interval, so **the main thread is the wall and the GPU
is starved rather than busy** — which is what the utilisation reading that
opened this entry means, and it is worth knowing that it means that, because a
GPU at 25% looks like headroom and is the exact opposite. Note also that the
game's own JS is 1.7 ms of a 21.5 ms frame: **finding 6's ranking is still
right about what is expensive inside `updateGameplay`, and that whole budget is
now under 8% of the frame.** Inside `scene.render`, by Babylon's own phase
observables:

| median ms | Hollowmere | Coldharbour |
| --- | --- | --- |
| whole frame | 6.1 | 19.4 |
| `_evaluateActiveMeshes` | 1.8 | 3.4 |
| render targets | 0.8 | 4.5 |
| main draw phase | 3.0 | 11.0 |

All three of those are JS.

### The draw count predicts the frame, and nothing else does

Draws counted by wrapping `drawElementsType` and `drawArraysType`, attributed
by phase, live round:

| per frame | Hollowmere | Coldharbour | Harrowmead |
| --- | --- | --- | --- |
| draw calls | 857 | **2,647** | 2,238 |
| — render targets | — | 883 | 820 |
| — main pass | — | 1,760 | 1,414 |
| active meshes | 240 | 903 | 879 |
| — carrying an outline shell | — | 429 | 287 |
| frame | 6.1 ms | 19.4 ms | 18.7 ms |

Hollowmere to Coldharbour is **3.09x the draws against 3.18x the frame** — a
fit to within 3%. Triangles are 1.96x and do not fit. Pixels are identical and
do not fit at all. **A cel mesh that is outlined draws twice**, which is what
puts 903 active meshes into a 1,760-draw main pass.

### Why the backend changed the answer

Babylon's WebGPU backend pays substantially more CPU per draw than its WebGL2
one: a pipeline-state hash and lookup in `WebGPUCacheRenderPipeline`, a
bind-group cache lookup or rebuild, and dynamic uniform-buffer offset
management, on every draw. WebGL2 was closer to a `glDrawElements` beside a few
cached uniform binds. **So the swap raised the SLOPE and not the intercept, and
the crossover is the draw count.** That is why the two small maps came out of
the migration faster and the two big ones came out much slower, and why the
migration's own gates never caught it: they were green, and they were green
because the game still ran.

**That paragraph is derived and not measured, and it cannot be measured here**
— there is no WebGL engine left in the tree to A/B against, by design
(`CLAUDE.md`), and re-introducing one to settle a ranking would cost more than
the ranking is worth. What backs it is the one lever that isolates the
submission path and changes nothing else, which is the first below.

### The three levers, costed

Single-lever A/Bs in the page on Coldharbour. The baseline itself drifted -4 to
-6% across the run, so **read nothing under about 8% as real**:

| lever | Coldharbour |
| --- | --- |
| `engine.compatibilityMode = false` | **+25.8%** |
| the GlowLayer disabled | **+22.5%** |
| `scene.freezeActiveMeshes()` | **+14.8%** |
| every `paneGroups` mesh hidden | +1.5% |
| the shadow generator's `renderList` emptied | -9.7% |

The last two are the null results and both are useful: the glass is finding
12's lever and no longer moves anything, and the shadow pass reads *negative*,
which is drift plus whatever emptying an explicit render list does to Babylon's
own path — either way finding 2 is not where the frame is. Stacked, which is
the number worth having:

| Coldharbour | fps | frame |
| --- | --- | --- |
| baseline | 47.8 | 20.9 ms |
| bundles | 61.3 | 16.3 ms |
| + no glow | 75.7 | 13.2 ms |
| + frozen active meshes | **102.1** | 9.8 ms |

Harrowmead tracks it the whole way: 53.5 -> 66.3 -> 79.3 -> 108.8.

**1. `compatibilityMode = false` is real, and it is the only one verified.** It
is Babylon's WebGPU render-bundle submission path; it changes how draws are
submitted and nothing about what is drawn, which is why it doubles as the
evidence for the section above. Costed end to end through the real boot path
with `gate.mjs --uncap`, both runs in one session on this machine:

| warm fps | baseline | bundles | p95 |
| --- | --- | --- | --- |
| Hollowmere | 165.8 | 192.6 | 7.3 -> 6.6 ms |
| Greyfen | 183.9 | 211.1 | 6.2 -> 5.6 ms |
| Coldharbour | 47.2 | 59.4 | 22.7 -> 18.6 ms |
| Harrowmead | 54.2 | 68.6 | 20.2 -> 17.2 ms |

**The picture does not move.** `bank.mjs --check` comes back 0/255 on all
sixteen reference frames with the flag on, against a 0/255 control taken in the
same session with it off; `gate.mjs`, `shaders.mjs` and `npm run build` all pass
with no page error, no console error and no WebGPU validation complaint.

**What the bank does NOT prove is the case the flag is actually about**, and
this is the part worth keeping: the bank is a FROZEN frame, and
non-compatibility mode's documented risk is state CHANGING between draws. So
the evidence that landed it is a different script — a live round on
Coldharbour, Harrowmead and Hollowmere with the bots fighting, six bots killed
into ragdolls, every one of Coldharbour's 24 panes broken in a single frame,
six overlapping blasts and a turret tracking for 180 frames, run with the flag
and without it and reporting the same thing both times. **This has LANDED**
(`main.ts`, with the argument on the line) and it is the reason this entry is
no longer a lever but a fact.

**What is still not proven is a human playing.** The script drives the
simulation and reads state back; it does not move a mouse. The failure it could
not see is a rendering artefact that a person would notice and an assertion
would not, and the cheapest way to close that is to play a round on Coldharbour
and look at it.

**2. The GlowLayer is finding 3 and it has inverted.** The layer is 883 of
Coldharbour's 2,647 draws. The fix that entry names is unchanged and is small —
the exclusion scan runs in `Game`'s constructor, before any map exists, so
every `MapBuilder` mesh is eligible forever and is drawn as opaque black into a
buffer it cannot light. What it is still waiting on is the visual question in
that entry, which none of this changes: the opaque black is what makes the glow
buffer depth-occlude. Expect materially less than the 22.5% above, which is the
whole layer rather than the world in it.

**3. `scene.freezeActiveMeshes()` is a diagnostic and must not ship.** It
freezes the active list, so a bot that walks into view, a pooled effect, a
grenade, a shard and a spawned ragdoll all stop appearing — in a game whose
every mesh is pooled that is not a trade, it is a bug. What the +14.8% measures
is `_evaluateActiveMeshes` walking **2,488 meshes to find 903**, and the real
version of that saving is having fewer meshes to walk or a cheaper walk, not a
frozen list. **"Fewer meshes to WALK" is the wrong half and finding 18 measures
it**: the ~1,580 the walk rejects are worth 0.8 ms of the 3.3, and the ~900 it
keeps are the other 2.5. Fewer ACTIVE meshes is the only fix.

### What is open

- **A round played by a human under `compatibilityMode = false`.** It has
  landed on the strength of a scripted dynamic round, which is the strongest
  automatic check available and is still not a pair of eyes.
- ~~**Whether the draw count itself can come down**~~ — **ANSWERED, see finding
  18**, and not where this entry expected. The outline shells looked like the
  obvious place, and they are worth only +8.6% measured on this backend because
  a shell reuses a bound material. Half the draw count is the block merge
  splitting the village once per paint COLOUR, and taking the colour out of the
  merge key is +60% on Coldharbour with no picture change at all.
- **The phone.** Every number here is one desktop GPU, and the balance that
  makes fill irrelevant here will not hold on a device this game installs onto.
  Finding 12's glass fragment is still the right lever there.

---

## 18. The village is drawn four times over, and the block merge bottoms out on paint colour

**Status:** measured on the Windows box, cause located, **and the fix has
LANDED** — see "What landed" at the end, which also carries the one thing about
the picture that is still open. **This answers the first open thread in finding
17** — whether the draw count itself can come down — and the answer is that it
can, by about half.

### The frame, re-measured as a matched pair

Coldharbour and Harrowmead, a live round with sixteen bots, warm past the
compile stall, headless Chromium on the RTX 4070 Ti SUPER, uncapped, 1920x1080,
medians over 3 x 6 s. The baseline first, because finding 17's budget was taken
before `compatibilityMode = false` landed and the shape has moved:

| median ms | Coldharbour | Harrowmead |
| --- | --- | --- |
| frame (rAF interval) | 20.6 | 18.8 |
| `scene.render()` | 18.4 | 17.1 |
| — `_evaluateActiveMeshes` | 4.3 | 4.1 |
| — render targets | 3.4 | 3.3 |
| — main draw phase | 9.1 | 8.3 |
| the game's own JS | 2.2 | 1.7 |

**The game's own JS is a tenth of the frame and the rest is Babylon's**, which
is the number that closes the "move it to workers" question before it is asked:
`scene.render` is JS on the thread that owns the device, so an `OffscreenCanvas`
worker RELOCATES 18 ms rather than removing it, and the worker becomes the wall.
What is genuinely worker-shaped here is burst work and not the frame —
`MapBuilder`'s geometry, the AO bake, the `NavGrid`/`CoverMap`/`ObstacleField`
builds, finding 9's flow-field rebuild, finding 11's editor tier-3 — and moving
any of them buys load time and nothing else. Do not re-derive this.

Inside that tenth, on real hardware rather than finding 6's inflated headless
run: `player.probeGround` is **0.483 ms** and everything else is under 0.12
(`updateHud` 0.112, `battle.update` 0.094, `minimap.update` 0.086,
`lighting.update` 0.063). The ranking finding 6 records is intact and the
absolute figures were five times too big. **The ground probe was a third of the
game's own budget and is now gone** — the footprint test it waited on landed, and
finding 6 carries what closed it and what it measures at now.

### What the draws are made of

Every active mesh attributed to what built it, and counted once for each pass it
is drawn in. Coldharbour, same session:

| bucket | meshes | materials | outline | glow | shadow | draws |
| --- | --- | --- | --- | --- | --- | --- |
| **world (BlockMerge)** | **409** | **55** | 346 | 409 | 401 | **1,565** |
| soldier rigs | 237 | 11 | 0 | 237 | 0 | 474 |
| vehicles | 48 | 12 | 48 | 48 | 0 | 144 |
| glazing | 72 | 72 | 0 | 71 | 0 | 143 |
| terrain | 49 | 1 | 0 | 49 | 0 | 98 |
| viewmodel | 28 | 7 | 14 | 28 | 0 | 70 |
| rim/ridge | 20 | 2 | 20 | 20 | 0 | 60 |
| everything else | 39 | — | 1 | 19 | 0 | 59 |
| **total** | **902** | 180 | 429 | 881 | 401 | **2,613** |

**The village is 60% of the frame's draws and it is drawn 3.8 times per mesh** —
once for itself, once for its outline shell, once as an occluder in the glow
buffer, once into the shadow map.

### The merge bottoms out on COLOUR, and that is the whole finding

`mergeByMaterial` keys its outer map on the material INSTANCE, so a 48 m block
splits once per paint colour. Simulated by re-keying on the shader VARIANT
(`cel`/`gloss`/`trans`/`glass`/`ink`/`emissive`) with the sway layer and the
exemption set kept, which is what a merge could honestly collapse to:

| map | blocks | world meshes now | colour out of key | per block, now -> then |
| --- | --- | --- | --- | --- |
| Coldharbour | 45 | 416 | **90** (4.62x) | median 10 -> 2 |
| Harrowmead | 44 | 438 | **131** (3.34x) | median 9 -> 3 |
| Hollowmere | 32 | 332 | **59** (5.63x) | median 11 -> 2 |

Harrowmead collapses least because it carries 104 `trans` and 100 `ink` meshes
from the swaying groups' twins, which are real shader differences and stay in
the key. Coldharbour is 349 `cel` against 51 `emissive`, 8 `trans` and 8 `ink`.

### The prototype, and what it bought

Before any of it was built, the outer key was changed to the variant for one
run — **the picture wrong on purpose, only the cost being read** — and then
reverted. Same script, same session shape, 3 x 6 s each:

| | Coldharbour | Harrowmead |
| --- | --- | --- |
| fps | 48.3 -> **77.2** | 52.6 -> **83.0** |
| frame | 20.6 -> 12.8 ms | 18.8 -> 11.9 ms |
| draws | 2,641 -> 1,397 | 2,332 -> 1,361 |
| main draw phase | 9.1 -> 5.0 ms | 8.3 -> 4.6 ms |
| render targets | 3.4 -> 2.0 ms | 3.3 -> 1.9 ms |
| `_evaluateActiveMeshes` | 4.3 -> 3.2 ms | 4.1 -> 3.2 ms |
| active meshes | 900 -> 577 | 889 -> 574 |
| world meshes / draws | 409 / 1,565 -> 88 / 305 | — |
| shadow renderList | 408 -> 86 | — |

**+60% and +58%**, on the two maps that need it. For scale, every other lever
ever measured on this frame: `compatibilityMode = false` +26% (landed), the
GlowLayer deleted outright +27%, the glow AND every world outline off together
+19.5%.

**Why it converts better than the shell levers, which is the part worth
keeping.** Taking the outline shells and the glow occluders away removes draws
that reuse an already-bound material — measured at about 2.3 us each. This
removes MESH draws, each carrying a material switch, and those measure about
6.3 us each: Babylon's WebGPU backend pays a pipeline-state hash, a bind-group
cache lookup and a dynamic-UBO offset on every draw, and a material change is
what makes all three miss. That is finding 17's mechanism arriving from the
other side. **So a draw is not a draw** — say which kind before predicting a
saving from a count.

### What the real version is

Albedo moves from a material uniform to a per-vertex attribute on world geometry
only, and the shader picks between the two on the mark it already has.
`vBaked.y` is 1 on baked map geometry and 0 everywhere else, and the branch is
already in the cel shader for the albedo variation — so this needs **no new
define, no second cache variant, and no fourth `cel-<variant>-#rrggbb` name for
`outlineInkFor`'s regex to learn**, which is precisely the cost
`vertexShading.ts`'s header says its design refuses to pay.

Four things it costs, in the order they will bite:

- **The ink is the real work and the part that can go wrong.** `inkColorFor`
  parses the material NAME, so a mesh holding ten colours can only wear one ink.
  Per-vertex ink means the outline shader reading the same attribute.
  `OutlineFog` already patches that shader, so there is a precedent and a place
  — but expect the trouble here rather than in the merge.
- **It cannot ride in the existing colour buffer.** Red is the sway weight,
  green the world mark, alpha the AO; blue is written 0 and free, and albedo
  needs three channels. So it is a second attribute (uv2, or a second colour
  set), and `VertexData.merge`'s all-or-nothing rule applies to it exactly as
  `CLAUDE.md` already records for `colors`.
- **The variants stay in the key.** `gloss`, `trans`, `glass`, `ink` and
  `emissive` are shader differences, and merging across them draws one of them
  wrong — the same rule `mergeByMaterial` already states about two materials
  sharing a name.
- **The editor is unaffected** and must stay so: it keys per placement, does not
  block-merge, and takes the draw-call hit deliberately so a placement stays
  recoverable.

### What this displaces

**An MRT main pass is no longer the first move, and half of it should probably
never be made.** Writing emissive into a second attachment is the
architecturally correct answer to finding 3 — a shared depth buffer IS
occlusion, which distance from a lamp can never express — and Babylon's WebGPU
pipeline cache keeps `_alphaBlendEnabled` as a per-TARGET array, so blended
glazing writing a second attachment is configurable rather than the blocker it
looks like. But the prize shrinks with this entry: the world's glow occluders go
409 -> 88, leaving the layer mostly the 237 soldier-rig meshes rather than the
village. **Take that number after this lands, not before.**

Replacing the OUTLINE with a screen-space edge is the half to leave alone. It is
not a generic edge — it is per-material coloured ink, applied selectively
through `noOutline`, thinned per mesh by `updateOutlineScales` and fogged per
pixel by `OutlineFog` — so a screen-space version needs an ink-id attachment,
which means every draw in the main pass has to participate, the compute ash
field and the sky included. And `docs/rendering.md` carries a family of rules
that exist BECAUSE the outline is an inverted hull with a slope-scaled depth
offset: the thick-box rule for a walked surface, "nothing may be laid ON an
inked surface", an emissive detail having to protrude past its neighbours'
shells. Swapping the mechanism does not only change the look, it invalidates the
reason a good deal of geometry is shaped the way it is.

### Two null results and one correction, so nobody re-runs them

- **A selection octree is -5.4%**, and `scene.createOrUpdateSelectionOctree`
  also dropped meshes that should have stayed active. Not the lever.
- **Detaching the whole post chain is -4.6%**, which is free within drift.
  Finding 5's four chained passes cost nothing on this hardware, and finding
  12's ~1% holds.
- **Finding 17's third lever calls the `_evaluateActiveMeshes` saving "fewer
  meshes to walk", and that half is wrong.** Disabling every mesh the walk
  REJECTS took it from 2,063 walked to 880 and the cost only moved 3.30 -> 2.51
  ms: about 2.5 ms of it is the ~900 meshes it KEEPS. `doNotSyncBoundingInfo` on
  all 1,380 frozen meshes moved nothing, because a frozen matrix already skips
  it. Fewer ACTIVE meshes is the only fix — which is this entry, and it is what
  took amEval 4.3 -> 3.2 above.

---
### What landed

Albedo per vertex, behind `#define CEL_PALETTE`: a 1-based slot in `uv2.x`
written per source mesh by `MapBuilder` before the merge, indexed into a
`celPalette` array on the two materials that read one — `getWorldCel` and its
ink. Slot 0 is "not paletted", which is what an unwritten attrib gives, so a
colour past `MAX_PALETTE` keeps its own material and merges the way everything
did before. Only `BlockMerge` paletteises, which exempts the editor for free.

**Costed through the real boot path with `gate.mjs --uncap`, both runs in one
session on this machine**, which is the instrument finding 17 quoted and so the
one to compare against:

| warm fps | before | after | p95 |
| --- | --- | --- | --- |
| Hollowmere | 148.4 | 185.1 | 9.5 -> 7.3 ms |
| Greyfen | 167.6 | 203.3 | 8.1 -> 6.4 ms |
| Coldharbour | 48.9 | **66.9** | 25.5 -> 17.7 ms |
| Harrowmead | 52.2 | **61.7** | 25.3 -> 20.6 ms |

**The two instruments disagree on the size and the honest range is +18% to
+81%.** An in-page probe over 3 x 6 s of a warm round reads Coldharbour 48.3 ->
87.5 and Harrowmead 52.6 -> 80.2; `gate.mjs`'s 8 s window right after its
warm-up reads +37% and +18% for the same change. Both are live rounds, so bots
dying and ragdolls spawning are in both. **What is not in dispute is the draw
count**, which is the same number however it is sampled: Coldharbour 2,641 ->
1,431 and Harrowmead 2,332 -> 1,551. Quote the gate figures and say which.

**Two bugs were found on the way and both are fixed.** They are recorded because
neither is obvious and both will be met again by anyone adding an attribute or a
twin:

- **An attribute must be DECLARED in the WGSL source, not merely listed on the
  material.** `vertexInputs.uv2` without `attribute uv2: vec2f;` is "struct
  member uv2 not found", the shader module fails, and under
  `compatibilityMode = false` one bad module invalidates the render bundle and
  takes **the entire frame black** — sky, glazing and all. Nothing appears in
  `consoleErrors`; the cascade is a wall of "Invalid RenderPipeline ... is
  invalid due to a previous error" with the real message above it. This is the
  first real instance of the moving-state risk `main.ts` warns about, and it
  arrived from a direction that warning does not describe.
- **An ink twin may never be in a reflection render list** (`noReflect`, the
  seventh metadata flag). See the flag in `CLAUDE.md`. This one was PRE-EXISTING
  and latent: the foliage twins were already in those lists, and it never showed
  because a canopy twin is small and Greyfen glazes almost nothing. Giving the
  whole village twins made it 85% of Coldharbour's curtain-wall frame.

**`ReflectionSystem.encloses` had to be rewritten and that is a consequence
worth generalising.** It was a bounding-box containment test, and it worked
only because of a property the palette removes — the merge split per colour, so
"a colour that appears once appears in a mesh of its own" and the test picked
out small meshes. With one mesh per block the smallest thing it could remove was
a 48 m block, and it could not tell a tower's probe standing in its own shaft
from a water probe floating in open marsh inside the same extent. Greyfen's
marsh cost one exclusion and that one was the near treeline. It now asks the
BLOCK KEY, which `PaneBlocks` and `BlockMerge` already file under identically.
**The general lesson: a heuristic that reads merged GEOMETRY is a heuristic with
a hidden dependency on how the merge is keyed.** A solid-mass test against the
collider boxes was tried first and is the wrong answer — 17 of Coldharbour's 40
glazing probes stand in open air rather than in mass, and `curtain2` regressed
to 30.5/255 under it against 1.9 with the block key.

### What is still open, and it is a LOOK decision rather than a bug

**Sixteen of sixteen reference frames are within 0.19 to 3.26 mean/255**
(`borderland` is exactly 0), against 43 to 108 when the world first drew. The
residue is not noise and will not go away by debugging, because it is the trade
this entry is:

- **The ink no longer traces each colour group.** `mergeByMaterial`'s own header
  says the merge "means the outline traces each colour group's silhouette rather
  than every individual plank" — the colour group WAS the ink granularity, and
  taking colour out of the key coarsens it to the block. Lines between
  differently-coloured parts of one building are gone.
- **An ink twin covers a thin surface that Babylon's hull did not.** Confirmed
  by hiding the twins at runtime: Greyfen's hut roofs go from near-black back to
  brown. `CEL_INK` expands 5 cm along the normal with no polygon offset, where
  `OutlineRenderer` pulls its hull toward the eye and then repairs the depth
  buffer in a second pass. This is the same family as the two rules in
  `docs/rendering.md` about thin slabs and about laying anything on an inked
  surface, arriving through the other mechanism. **It is the one thing here that
  is arguably a defect rather than a trade**, and the cheapest test of that is a
  round played on Greyfen looking at the stilt huts.

Both want a pair of eyes rather than another measurement.

---

## 19. A 1500 m map, measured: the frame is a mesh WALK, the build is quadratic, and the reflection bake takes the GPU device

**Status:** measured on the Windows box against a generated proving ground at
two extents, one cause located in Babylon's own source, one cause not yet
located. **This is `ENGINE_UPGRADE.md` S0**, and it replaces every projection in
that file's walls 1–4 with a measurement. Four of its numbers were right, three
were wrong in the same direction, and one wall was not in the document at all.

Nothing here is fixed. What it changes is the ORDER: `ENGINE_UPGRADE.md` has
been corrected in place against these figures.

### The instrument, and what it is measuring

`src/world/proving/` — a generated map, dev-only, registered in `MAPS` behind
`import.meta.env.DEV` and kept out of both bundles by
`scripts/check-proving.mjs`. A city block grid on an 80 m pitch at roughly
Coldharbour's collider density, five flags, both home spawns, one scatter region
per block; `npm run proving -- --play P --margin M` writes it. It is not a level
and must never become one — see its header.

Two extents, both **1500 m of ground across**, differing only in how much of
that is the PLAY square:

- **1500 / 0** — the whole extent is play, closed by a rim.
- **900 / 300** — a 900 m play square inside a 300 m borderland.

Windows box (RTX 4070 Ti SUPER), headless Chromium via `channel: "chromium"`,
`--disable-frame-rate-limit --disable-gpu-vsync`, 1920x1080, warm 10 s past the
compile stall, medians over an 8 s sample — finding 18's protocol, so the
figures are comparable to its. Coldharbour and Harrowmead were re-measured in
the same sessions as controls. Build phases come from
`src/world/buildProfile.ts`, added for this and DEV-only.

### What each extent IS

| | Coldharbour | Harrowmead | **900 / 300** | **1500 / 0** |
| --- | --- | --- | --- | --- |
| play square (m) | 320 | 400 | **900** | **1500** |
| ground across (m) | 320 | 560 | 1500 | 1500 |
| placements | 137 | 124 | 410 | 1,108 |
| collider boxes | 768 | 748 | 5,929 | 16,526 |
| **scene meshes** | 2,213 | 2,187 | **9,002** | **23,014** |
| nav cells | 45,796 | 71,289 | 360,000 | 1,000,000 |
| walkable surfaces | 34,142 | 70,524 | 305,193 | 846,766 |
| glazing groups | 71 | 0 | 389 | 1,153 |
| cube probes | 40 | 2 | 265 | 770 |

**The first correction is wall 1's headline.** It read Coldharbour's ~2,500
meshes forward by 22x and predicted **~55,000** at 1500 m. The measured figure
is **23,014** — 2.4x less, because a merged block is one mesh whatever is in it
and the terrain patches are cut on a 48 m grid rather than per structure. The
900 m square is **9,002**, which is 4.1x Coldharbour rather than the 7.9x its
area would suggest, for the same reason.

### Wall 1 is real, it is the largest thing in the frame, and it is worse per mesh than finding 18 said

The frame, with the reflection bake stubbed out so a frame exists at all (see
below — at either extent the bake never returns):

| median ms | Coldharbour | **900 / 300** | **1500 / 0** |
| --- | --- | --- | --- |
| frame (rAF interval) | 13.7 | **10.1** | **30.3** |
| `scene.render()` | 12.3 | 9.5 | 26.3 |
| — `_evaluateActiveMeshes` | 3.4 | **7.6** | **23.0** |
| — render targets | 2.1 | 0.3 | 0.5 |
| — main draw phase | 5.5 | 1.1 | 1.7 |
| the game's own JS | 1.4 | 0.6 | 4.0 |
| draw calls | 1,441 | 293 | 368 |
| active meshes | 644 | 125 | 146 |
| fps | 71.1 | 91.6 | 30.8 |

**At 1500 m, 23.0 ms of a 30.3 ms frame is spent rejecting meshes nobody
draws.** 23,014 walked, 146 kept. The draw phase is 1.7 ms — the GPU work is
nothing, and the map is slower than Coldharbour while drawing a quarter of its
calls.

The two proving columns differ only in map AREA and keep almost the same number
of meshes (125 against 146), which makes them a clean pair: the marginal cost is
**(23.0 − 7.6) / (23,014 − 9,002) = 1.10 µs per mesh in the scene, per frame.**
Finding 18 measured 0.67 µs for the same thing by disabling the meshes the walk
rejects; **it under-read by 1.6x**, and the honest reading is that its method
measured the walk with a disabled-mesh early-out rather than the walk in full.

**The 900 m square is FASTER than Coldharbour** — 10.1 ms against 13.7 — and
that is the shape of the whole problem rather than a surprise: it walks 4x the
meshes and draws a fifth of the calls, because the camera at its spawn is in an
empty block looking down a street. Wall 1 does not care what is on screen, and
neither does this number.

### Wall 4 was right that the build is the problem and wrong about which part

Derived: 30–60 s behind the loading card at 1500 m, dominated by `NavGrid`,
`CoverMap`, the flood fill and the flow fields. Measured:

| build phase, ms | Coldharbour | Harrowmead | **900 / 300** | **1500 / 0** |
| --- | --- | --- | --- | --- |
| **`build:total`** | **1,635** | **877** | **11,316** | **182,889** |
| — placements | 908 | 132 | 7,564 | **159,249** |
| — block merge | 62 | 63 | 669 | 9,044 |
| — scatter | 86 | 357 | 277 | 4,313 |
| — road merge | 3 | 1 | 162 | 2,662 |
| — AO bake | 165 | 82 | 936 | 2,360 |
| — `NavGrid` | 140 | 49 | 729 | 2,328 |
| — `CoverMap` | 56 | 29 | 294 | 895 |
| — seven flow fields | 10 | 17 | 150 | 368 |
| — pane merge | 20 | 0 | 165 | 549 |
| — ink twins | 20 | 43 | 116 | 316 |
| — scatter clusters | 4 | 20 | 16 | 624 |
| — terrain patches | 2 | 5 | 18 | 3 |
| — `ObstacleField` | 1 | 0.5 | 5 | 7 |
| **install to `deploy`** | **1,770** | **1,043** | **13,219** | **197,753** |

**It is 183 seconds, not 30–60, and the four things wall 4 named are 3.3% of
them.** `NavGrid`, `CoverMap`, the flow fields and the AO bake together are
**5,951 ms of 182,889**. The placement loop alone is **87%**.

**And the placement loop is superlinear in the number of placements**, which is
the finding under the finding:

| | placements | ms in the loop | **ms per placement** |
| --- | --- | --- | --- |
| Harrowmead | 124 | 132 | 1.1 |
| Coldharbour | 137 | 908 | 6.6 |
| 900 / 300 | 410 | 7,564 | **18.4** |
| 1500 / 0 | 1,108 | 159,249 | **143.7** |

2.7x the placements costs 7.8x each, so the loop is about `n^2.9` overall.
Nothing in a builder knows how big the map is, so this is not a builder getting
slower — it is the cost of adding one structure growing with how many are
already there. (Harrowmead against Coldharbour is a different mix rather than a
scaling point: a farm is not a tower block.)

**The cause is derived, not measured, and it is in Babylon rather than here.**
`Scene.removeMesh` is `this.meshes.indexOf(toRemove)` followed by a `splice`,
plus `_removeFromSceneRootNodes`, which is a second linear scan
(`scene.pure.js`). Every structure builds dozens of part meshes and
`mergeByMaterial` **disposes its sources** — that is what turns Babylon's
attribute-aligning path off, and `MapBuilder`'s header says so. So the build
creates and destroys on the order of a million meshes against a `scene.meshes`
array that grows to 23,014, and pays a scan over all of it every time. That is
`O(built × live)`, which is the shape the table has.

**What would settle it** is a build with the part meshes created under
`scene._blockEntityCollection` — `AssetContainer` is the supported door — and
the placement loop re-timed. If the ms-per-placement column goes flat, this is
the whole of it. If it does not, the remainder is in `BlockMerge`'s accumulation
or in `boxIndex`, and neither has been measured apart.

### Wall 3 was right to within 2%, and its table was missing 20 MiB

Every typed array in the built world, summed off `byteLength`:

| MiB | Coldharbour | Harrowmead | **900 / 300** | **1500 / 0** | wall 3 derived |
| --- | --- | --- | --- | --- | --- |
| `NavGrid` (`links` is 122.1 of it) | 6.7 | 7.8 | 52.5 | **145.9** | 153 |
| `CoverMap` | 2.0 | 2.3 | 15.5 | **42.9** | 24 |
| seven flow fields | 4.9 | 5.7 | 38.5 | **106.8** | 112 |
| **total** | **13.5** | **15.8** | **106.4** | **295.6** | **289** |

The derivation was right. The one line it got wrong is `CoverMap`, which is 43
MiB rather than 24: the table counted its three `Uint16Array` masks and missed
that it also holds **its own copies of the graph's `heights`, `counts` and
`walkable`**. That is another 20 MiB at 1500 m and it compacts with the same S3
change as the rest.

**What it costs in a tab is bigger than the arrays.** At the moment the round
opens, before a frame is drawn:

| | 900 / 300 | 1500 / 0 |
| --- | --- | --- |
| JS heap used | 1,696 MiB | **3,536 MiB** |
| JS heap limit | 4,192 MiB | 4,192 MiB |
| renderer working set | 2,554 MB | **5,432 MB** |

**1500 / 0 sits at 84% of V8's heap cap with nothing drawn yet.** That is wall 3
landing as an allocation failure exactly as the document predicted, and the
proving ground reaches it by building successfully and then having nowhere left
to go.

### The wall that was not in the document: the reflection bake takes the GPU device

`ReflectionSystem` bakes **one cube probe per glazed BLOCK**, refresh-once, at
`CONFIG.graphics.reflection.size` (128). That is priced on map area like
everything else here, and nothing in `ENGINE_UPGRADE.md` lists it:

| | Coldharbour | 900 / 300 | 1500 / 0 |
| --- | --- | --- | --- |
| glazing groups | 71 | 389 | 1,153 |
| probes | 40 | 265 | **770** |
| queued in | 47 ms | 1,113 ms | **15,615 ms** |
| meshes in each probe's render list | 177 | 928 | 2,434 |
| first frame (the bake) | 1.3 s | **never returned** | **never returned** |

**At BOTH extents the first frame after the build never completes.** At 900/300,
162 seconds into that frame, the page reports:

```
Failed to execute 'requestDevice' on 'GPUAdapter': ID3D12Device::CreateDescriptorHeap
BJS - A fatal error occurred during WebGPU creation/initialization.
```

— the D3D12 device is LOST during the bake and Babylon's attempt to recreate it
fails too. At 1500/0 the renderer process is simply replaced. Both were given
ten minutes.

**So this is not "slow", it is a hard failure, and it is the first thing between
this tree and a map of either size.** Every frame figure in this entry was taken
with `ReflectionSystem.build` stubbed to a no-op before the round started, which
is the single lever that isolates it: a probe is refresh-once, so it costs
nothing after the frame it bakes on and the steady-state frame is identical
either way.

Three things about it decide what the fix looks like:

- **The count is the map's GLAZING, not the map's size.** A desert city with
  less curtain wall has fewer, and a probe per BUILDING rather than per glazed
  block is not obviously wrong.
- **The bake is `probes × 6 faces × render list`**, and at 1500 m that is
  770 × 6 × 2,434 = **11.2 million draws in one frame**. Amortising it over
  frames does not reduce it; the render list has to come down, or the probe
  count has to, or both.
- **`CreateDescriptorHeap` failing is a resource ceiling and not a timeout**, so
  a slower bake fails identically. The ~400 MB of cube textures (520 KB each,
  per `CONFIG.graphics.reflection`) is the more obvious half; the descriptor
  heap is the half that actually breaks.

### The decision the document asked this to make

`ENGINE_UPGRADE.md` recommended **900 m of play inside 1500 m of ground** on a
derived table and said S0 should settle it with numbers. It settles it, and not
narrowly:

| | 1500 / 0 | 900 / 300 |
| --- | --- | --- |
| build | 183 s | **11.3 s** |
| frame | 30.3 ms | **10.1 ms** — faster than Coldharbour |
| `_evaluateActiveMeshes` | 23.0 ms | **7.6 ms** |
| JS heap at deploy | 3,536 MiB of a 4,192 cap | **1,696 MiB** |
| nav/cover/flow arrays | 295.6 MiB | **106.4 MiB** |
| reflection bake | fails | fails — **fixed since, see S0b** |

**900/300 is affordable today except for the reflection bake. 1500/0 is not
affordable at all** — three minutes of loading, three quarters of its frame in a
mesh walk, and a heap 84% full before it draws. The committed proving ground is
therefore the 900/300 variant, and `--play 1500 --margin 0` is one command away
for anyone re-testing the ceiling.

That is 5.1x Harrowmead's playable area and still reads as 1500 m from every
vantage, which is what the split was for.

### What is open

- ~~**The reflection bake.**~~ **CLOSED by `ENGINE_UPGRADE.md` S0b.** The
  proving ground at 900 / 300 reaches a steady-state frame with the bake
  enabled: 265 probes over 28 frames of ~0.9 s, settling 27 frames after the
  install, no device loss. The stub is gone and every figure in this entry can
  now be re-taken without one — **and none of them has been**, so the frame
  table above is still a measurement of a map whose glass reflects nothing.
- **The placement loop's `n^2.9`**, and whether `AssetContainer` flattens it. It
  is worth more than every worker in S5: 159 s of a 183 s build.
- ~~**Wall 1 at 1.10 µs per scene mesh**, which is what block visibility has to
  beat.~~ **MOSTLY CLOSED by `ENGINE_UPGRADE.md` S1 — see finding 21.** The walk
  is 7.60 ms to 2.50 and the frame 9.80 to 4.30 on the same proving ground, and
  the reason it was that large is not what this entry assumed: **6,349 of the
  9,019 meshes are INVISIBLE collider proxies**. What is left is 0.94 µs over
  2,670 candidates, so the walk is still the largest single line in the frame
  and S8's fog wall is what has the rest of it.
- ~~**Nothing here was measured with sixteen bots fighting.**~~ **CLOSED by
  finding 22**, which forces a skirmish and prices one. A fight is an 8.6 ms
  frame against the 4.30 ms quiet one, and 3.75 ms of it is `pickWithRay` —
  wall 2, not this one. Note what had to be worked around to get there: a round
  left to itself fires **no ray at all**, on this map or on Coldharbour.
- **`ObstacleField` reported no typed arrays**, so it is absent from the memory
  table. It holds bucketed box references rather than a grid of primitives; its
  footprint is unmeasured.

---

## 20. The reference bank is RED on an unmodified tree, and nobody knows why

**Status:** measured on the Windows box, cause NOT located. This is the merge
gate `ENGINE_UPGRADE.md` names for every step in it, so it matters more than
its size suggests.

`node plans/webgpu-ref/bank.mjs --check` against the bank taken on 2026-08-26
fails on **all fifteen vantages of all four maps**, on the tree that took it:

| map | worst vantage | mean/255 | pixels moved |
| --- | --- | --- | --- |
| hollowmere | lanterns | 1.51 | 7.4% |
| greyfen | marsh | 2.35 | 6.5% |
| coldharbour | avenue | **3.26** | 16.9% |
| harrowmead | millpond | 1.35 | 13.8% |

Every vantage is over, the smallest by 10x (canopy, 0.19 against a 0.02
tolerance) and the largest by 160x. Worst single pixels are ~200/255, and the
worst tiles are the marsh, the avenue and the millpond — water and long
streets.

**What is known.** The bank is gitignored, so it is a local artefact rather
than a committed reference, and its files are dated the day before this reading
— it was taken during S0 on this machine, and the tree has not moved since
except for S0b, which reproduces these figures to four decimal places on all
fifteen. So **the difference is under the bank rather than in the tree**: a
Chromium auto-update or a driver update between the two runs are the obvious
candidates and neither has been checked.

**Why it is not a tolerance problem.** `diff.mjs`'s own header says the answer
to a bank that cries wolf is to find the unpinned thing and not to raise the
number, and that this has already been the answer twice — a lantern's flicker
phase and an unfrozen cube probe. A third unpinned thing is the first
hypothesis to test, and the tiles point at the water and the mirrors, which is
where the last one was.

**What it costs right now.** Every step of `ENGINE_UPGRADE.md` is supposed to
merge behind this check. Until it is re-taken or explained, the only usable
form is a DIFFERENTIAL one — run `--check` either side of a change and require
the same means — which is what S0b did. That catches a change but proves
nothing about the absolute picture.

**How to settle it.** Record the Chromium build and the driver version beside
the next bank (neither is in `mode.json` today, and both should be). Re-take on
the current machine state and diff the new bank against the old one tile by
tile: if the difference is a uniform sub-LSB shift it is the backend, and if it
is concentrated on the water and the glazing it is a third unpinned clock and
`freeze` is where it belongs.

---

## 21. The frame's mesh walk is two thirds collider boxes, and a candidate list is what takes them out of it

**Status:** measured on the Windows box, landed. **This is `ENGINE_UPGRADE.md`
S1** and it takes most of wall 1 down. It also corrects that wall's own reading
of what the meshes ARE: the walk is not mostly buildings, it is mostly
INVISIBLE COLLIDER PROXIES that Babylon pays full price for and rejects on
`isVisible` after it has already done everything expensive.

`src/systems/WorldCulling.ts` replaces `Scene.getActiveMeshCandidates` and
**writes nothing onto any mesh** — no `setEnabled`, no `isVisible`, no
`isPickable`. `docs/rendering.md` carries the contract; what follows is only
the measurement.

### The instrument, and the lever

Windows box (RTX 4070 Ti SUPER), headless Chromium via `channel: "chromium"`,
`--disable-frame-rate-limit --disable-gpu-vsync`, 1920x1080, `spawnPlayer()` so
the round is LIVE rather than sitting under the deploy lid, warm 10 s past the
compile stall, medians over 8 s. Findings 17–19's protocol, so the figures are
comparable to theirs.

**One process, one lever, four arms.** The lever is
`scene.getActiveMeshCandidates` and nothing else: the OFF arm puts Babylon's own
`_getDefaultMeshCandidates` back — the whole of `scene.meshes`, which is what
the tree did before this — and the ON arm hands the pointer back. OFF/ON/OFF/ON
interleaved in the same boot, so nothing about the map, the camera, the
pipelines or the thermal state differs between them.

### What the walk is made of

| | scene meshes | hidden | blocked | loose | candidates |
| --- | --- | --- | --- | --- | --- |
| hollowmere | 1,935 | 697 | 114 | 1,124 | 1,178 |
| greyfen | 2,006 | 672 | 213 | 1,121 | 1,230 |
| coldharbour | 2,230 | 805 | 229 | 1,196 | 1,425 |
| harrowmead | 2,204 | 647 | 313 | 1,244 | 1,557 |
| **proving 900/300** | **9,019** | **6,349** | **1,158** | **1,512** | **2,670** |

**On the proving ground 70% of the scene is collider boxes**, and taking them
out is exact rather than a trade — a collider cannot draw, so no pixel can move.
The `blocked` column is the distance-culled half and is the smaller one at every
size.

### What it is worth

| median ms | hollowmere | greyfen | coldharbour | harrowmead | **proving** |
| --- | --- | --- | --- | --- | --- |
| `_evaluateActiveMeshes` off | 0.70 | 1.10 | 2.60 | 2.70 | **7.60** |
| `_evaluateActiveMeshes` on | 0.40 | 0.50 | 2.00 | 2.20 | **2.50** |
| | **−43%** | **−55%** | **−23%** | **−19%** | **−67%** |
| frame off | 2.40 | 3.70 | 11.50 | 12.30 | **9.80** |
| frame on | 1.60 | 2.30 | 11.20 | 12.20 | **4.30** |
| | **−33%** | **−38%** | −2.6% | −0.8% | **−56%** |

**The proving ground's frame halves.** The two big maps' frame deltas are under
the 8% floor the measurement protocol says to read as noise and must not be
quoted as wins; their `_evaluateActiveMeshes` deltas are 3 to 8 times that floor
and are real. Coldharbour and Harrowmead both state a `fogEnd` past their own
diagonal, so all 45 and all 44 of their cells stay on and every millisecond
above is the collider half alone.

The marginal rate on the proving ground is **(7.60 − 2.50) / (9,019 − 2,670) =
0.80 µs per mesh taken out of the walk**, against finding 19's 1.10 µs per mesh
in it — the difference being that finding 19's figure came from two map extents
whose meshes are not the same meshes.

**What is left is still a walk.** 2.50 ms over 2,670 candidates is 0.94 µs each,
so the same lever has more in it as soon as a map has a fog wall inside its own
diagonal — which is S8.

### What the block half is worth, which the proving ground cannot show on its own

The proving ground states `fogEnd: 2400` deliberately (see its
`environment.ts`), so nothing is culled by distance there. Re-filing the same
built map at the wall S8 will want, in one process:

| reach, m | candidates | cells on | `_evaluateActiveMeshes` | frame |
| --- | --- | --- | --- | --- |
| 2400 (as shipped) | 2,670 | 280/280 | 2.80 | 4.80 |
| 650 | 2,180 | 163/280 | 2.30 | 4.20 |
| 550 | 2,035 | 127/280 | 2.20 | 4.00 |
| 450 | 1,908 | 97/280 | 2.00 | 3.70 |

So a 550 m wall is another **0.6 ms of walk and 0.8 ms of frame** on top, on a
map whose structures are only 1,158 of its meshes. On a denser map — a ruined
city rather than a generated block grid — that column is the one that grows.

### A ray cannot see any of it, and that was tested adversarially

The whole safety argument is that picking walks `scene.meshes` and has never
heard of the candidate list. **1,000 seeded rays across the 900 m play square**,
939 of which hit something, fired twice out of the same process: once with the
reach at the map's own fog wall and once with it wound down to ZERO, which
leaves every structure on the map out of the frame (candidates 2,670 → 1,512).
**The two arms agreed on the mesh and on the distance 1,000 times out of 1,000.**

### The picture, and the one place it moved

`bank.mjs --check` is RED on an unmodified tree (finding 20), so the usable form
is the DIFFERENTIAL one: run it either side of the change against the same fixed
reference and require the same means. Two runs of the unmodified tree reproduce
Hollowmere's four vantages to four decimal places **and to the fourth decimal of
the pixel SHARE**, which is what made the reading below possible at all — and is
a fact finding 20 wanted: cross-process residue on this map is zero, not the
0.14 Harrowmead showed.

**Fourteen of the fifteen banked vantages are unmoved to four decimal places.**
The exception is Hollowmere:

| vantage | before | after |
| --- | --- | --- |
| hollowmere/menu | 7.8133% of pixels, mean 0.627/255 | 7.8117%, mean 0.627 |
| hollowmere/lanterns | 7.3892%, mean 1.5051/255 | 7.3877%, mean **1.5050** |

That is **0.0001 mean/255 over 0.0016% of the frame** — of the order of thirty
pixels — against a 0.02 tolerance, and against the 0.19 to 3.26 the bank is
already red by.

**It is the block cull, and it is located.** With the reach widened past the map
so nothing is culled by distance, all four Hollowmere vantages come back
byte-for-byte: 7.8133% / 0.627 and 7.3892% / 1.5051. Hollowmere is the map with
the tightest fog in the tree — `fogEnd: 78` against a 240 m square — and it is
one of only two of the four where the cull engages at all. Greyfen states the
same 78 and drops half its cells with **no** movement at any of its four
vantages, which is what says this is a Hollowmere geometry fact rather than a
rule being wrong.

### What is open

- **What those thirty pixels ARE.** The hypothesis the design already names is
  that they are sky: a structure past the wall draws pure `fogColor` and is
  backed by ground that draws pure `fogColor`, but a roofline poking above the
  ridge line is backed by the DOME, whose `horizonColor` is only required to sit
  CLOSE to the fog. Nobody would see thirty pixels; it is recorded because a
  rule that is exact on three maps and approximate on the fourth should say so.
- ~~**Nothing here was measured with sixteen bots FIGHTING**~~, **CLOSED by
  finding 22.** The walk holds up under one — 3.0 ms in a fight against the
  2.50 ms quiet reading here — and what a fight adds lands on wall 2 instead.
  That entry also breaks the remaining candidates down: **57% of them are
  `loose`**, which no fog wall can reach, and ~750 of those are idle pooled
  effect meshes that the same mechanism could skip.
- **The cull cell is the 48 m merge block**, because that is the key that
  already exists. Whether a coarser or a finer cell is better is S6's question
  and this has not asked it.
- **The nav arrays are untouched by this**, correctly — they read `WorldBox`es
  and the terrain field rather than meshes. Wall 3 is entirely open.

---

## 22. Wall 2, measured at last: one ray is 2.4 ms on a 1500 m map, and a fight spends a third of the frame in `pickWithRay`

**Status:** measured on the Windows box, **not fixed**. This is
`ENGINE_UPGRADE.md` wall 2, and it is the first time a ray has been fired down a
map this size — findings 19 and 21 both name that as the gap and neither closed
it. It settles the S1/S2/S8 ordering: **wall 2 is now the largest single line in
the frame**, larger than what S1 left of wall 1, and S1 did nothing for it on
purpose.

### The instrument

Windows box (RTX 4070 Ti SUPER), headless Chromium via `channel: "chromium"`,
`--disable-frame-rate-limit --disable-gpu-vsync`, 1920x1080, medians over 8 s —
findings 17–21's protocol. Two readings, because one of them alone says nothing:
what a single `scene.pickWithRay` costs, and how many the LIVE game makes, taken
by wrapping `scene.pickWithRay` for the whole window.

**A round left to itself fires NO ray at all**, which is why this had to be
forced. `BattleSystem.acquire` gathers candidates by distance and only
ray-tests inside `bots.perception.engageRange` (55 m), so with nobody in contact
there is nothing to test: measured at **zero `pickWithRay` calls in eight
seconds on Coldharbour AND on the proving ground**, sixteen bots alive on both.
So the bots are stood in a ring 12–24 m around the player and re-stood every
second, which puts every one of them inside an enemy's engage range with a clear
look. That is artificial and it is the only way to price this at all; what it
buys is the two pick sites that carry the load — the bots' LOS
(`BattleSystem.visible`) and the hitscan's wall cap (`CombatSystem.fire`).

### What a fight costs

| sixteen bots in contact | Coldharbour | Harrowmead | **proving 900/300** |
| --- | --- | --- | --- |
| collider boxes | 768 | 748 | **5,929** |
| frames in 8 s | 1,115 | 890 | 656 |
| fps | 139.3 | 111.2 | 81.9 |
| median frame | 5.8 ms | 6.9 ms | **8.6 ms** |
| — the mesh walk (what S1 left) | 1.5 ms | 1.9 ms | 3.0 ms |
| — **`pickWithRay`** | **0.41 ms** | **0.35 ms** | **3.75 ms** |
| picks per frame | 1.86 | 1.77 | 1.54 |
| **us per pick** | **222** | **199** | **2,438** |
| **share of the frame** | 5.8% | 3.9% | **30.7%** |
| bots alive at the end | 7 | 8 | 9 |

**11x the per-pick cost for 7.7x the colliders**, and the two big maps agree
with each other to 10%. The pick count per frame is essentially the same on all
three — it is a property of sixteen bots thinking at `thinkRate`, not of the map
— so **the whole of the difference is what one ray costs**.

### It is the per-mesh walk, and ray LENGTH barely touches it

400 seeded rays per range, warmed, with nothing else running:

| us per pick, isolated | Coldharbour | proving 900/300 |
| --- | --- | --- |
| 55 m — `bots.perception.engageRange` | 125.8 | 1,043.8 |
| 120 m — the rifle's `range` | 121.3 | 1,035.5 |
| 180 m — the tank gun's | 120.8 | 1,007.3 |

**Tripling the ray changes nothing and is very slightly cheaper**, which is the
wall's whole signature: `InternalPick` walks `scene.meshes`, runs the predicate,
then bounds-tests every mesh that survives it, and none of that is bounded by
how far the ray goes. It is `O(colliders)` and it is the same shape
`Player.probeGround` was retired for — that pick was 0.483 ms on a 240 m map,
and this is 1.0 ms on a 900 m one and 2.4 ms in situ.

**The in-situ figure is 2.4x the isolated one on the same map and the gap is
NOT accounted for** (2,438 against 1,036). Both say the same thing, and S2 must
re-derive rather than quote either.

**Derived, not measured:** at 1500/0 there are 16,526 boxes against 5,929, so if
this stays roughly linear in the collider count a ray is ~2.8x again — ~6.8 ms
in situ, and a fight would be spending more time picking than rendering. That is
the projection S2 has to settle rather than a number to quote.

### What S1 left in the walk, and why S8 cannot reach most of it

The same session, `WorldCulling.stats` plus a breakdown of the loose bucket:

| | Coldharbour | proving 900/300 |
| --- | --- | --- |
| candidates | 1,425 | 2,670 |
| — blocked (reachable by a fog wall) | 229 | 1,158 |
| — **loose** | **1,196** | **1,512** |
| — — pooled effects and the rest | 804 | 753 |
| — — bot rigs | 320 | 320 |
| — — map, unblocked (terrain / roads / rim) | 72 | 439 |

**57% of what is left in the walk is loose**, and block visibility can never
touch it because loose is what MOVES. Of that, ~750 are pooled effect meshes
sitting idle — tracers, sparks, impact discs, shards, rubble, grenades — and a
pool member that is not in use is exactly as skippable as a collider is, by the
same mechanism, for roughly what S8's fog wall is worth (~0.7 ms). **Nothing in
`ENGINE_UPGRADE.md` names that lever under any step.** The 320 rig meshes are
S8's own rider (`bots.lodDisableDistance` is `FOG_WALL`, so a map with no fog
wall draws and poses every rig on it).

### The measurement trap that cost two runs, and will cost the next person too

**The proving ground's reflection bake takes 21 s and 24 frames to drain, and a
wall-clock warm lands inside it.** S0b spends the bake `drawsPerFrame` at a time
and its own open list says it lands after the loading card rather than behind
it; what that means for anyone measuring is sharper than it sounds:

| warmed until | Coldharbour | proving 900/300 |
| --- | --- | --- |
| `reflections.queue.length === 0` | 39 ms, 1 frame | **21,039 ms, 24 frames** |

With a ten-second warm the proving ground reports **10 frames in 8 seconds, a
894 ms median frame, 1.1 fps** and 5,680 us per pick — which reads as a
catastrophic new wall and is entirely the bake. **Warm on the QUEUE, never on a
clock.** `VERIFYING.md` already says `queue.length` reaching 0 is what says the
bake has landed; it now also says what happens if you do not wait for it.

### What is open

- **Wall 2 itself.** It is `ENGINE_UPGRADE.md` S2 and nothing here fixes it: the
  eight pick sites still go through `scene.pickWithRay`, and the fix is the
  analytic segment query over `colliderBoxes` that `Player.probeGround` already
  set the precedent for.
- **The 2.4x between the in-situ and the isolated per-pick cost.**
- **The 1500/0 projection**, which is derived from the collider count alone.
- **Whether the pick count per frame holds up in a real fight** rather than in a
  forced ring. 1.5–1.9 per frame is what sixteen bots at `thinkRate` produce
  here; a fight over a control point with everyone shooting will produce more,
  because every round fired is another wall pick.
- **The idle-pool lever**, above. Measured as a count, never as a saving.

---
