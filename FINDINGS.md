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

- **GC.** A collection every second or two matches the cadence closely — and
  that guess has since been measured rather than left as one. The frame
  profiler watches collections with a `FinalizationRegistry` sentinel, and on
  the Windows box, Hollowmere, headless at 130 fps over a 12 s window it reports
  **2.2 collections a second against a hitch cadence of one per 1.7 s**, with
  the heap running a mean of 157 MB, a peak of 184 and — the number to look at —
  an allocation rate of **27.4 MB/s**, or ~210 kB per frame. That is a game
  allocating steadily enough to keep the collector awake at exactly the cadence
  this finding is about. **It is not a confirmation**: that window recorded zero
  hitches (a headless 130 fps box is not the 60 Hz battery case above), so what
  is established is the input and not the link. Taking the same capture on the
  machine that actually hitches is now a two-minute job — see below.
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

**This is built now and the answer is a capture rather than a project.**
`FrameProfile` is what this section asked for — per-phase timers across the
whole frame, a ring that keeps the worst frames whole, and a bar that files
them relative to what the device is managing rather than at a fixed 25 ms.
Arm it on the laptop, on battery, play for a minute, press `F3`, and read the
hitch list:

- **A hitch whose `phases` add up to its `frameMs`** names the phase, and this
  finding becomes that phase's problem.
- **A hitch whose phases fall well short of its wall clock, with `gc` on it**,
  is the collection this section has suspected since it was written.
- **The same shortfall with `gc` at 0** puts the time outside the game
  altogether — the compositor, or the panel — and eliminating the leading
  suspect is worth as much as confirming it.

Two things about the reading. The heap columns are 0 unless Chrome is started
with `--enable-precise-memory-info` (the bucketised counter is rate-limited to
one update every twenty minutes, and `memory.heapLive` says so), while the
collection count needs no flag. And `docs/profiling.md` is the contract for all
of it.

Worth capturing the AC case properly at the same time, which the same capture
does for free: `frame.mean` distinguishes 120 Hz (~8.3) from 60 Hz (~16.7)
directly, and `frame`'s own share against it says how much of the interval was
even the game's.

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

## 3. ~~The GlowLayer draws the whole village into a buffer it cannot light~~ — FIXED

**Status: FIXED and LANDED** — `src/core/GlowDepth.ts`, folded into
`CLAUDE.md` and `docs/rendering.md`. **Worth ~20% of the frame on all three big
maps**; the last section has the numbers and what landed. The entry is kept
whole because the three attempts that came first are the argument for the shape
of the fix, and because each of them looked right when it was written.

The history: measured, ATTEMPTED THREE TIMES and reverted three times — for the
WORLD in world space, for the BODIES, and for the world again in SCREEN space,
which was the one that was geometrically right and died on the block merge
instead. **All three asked WHICH GEOMETRY MATTERS to a bloom. None of them
could have worked, and the fix is that the frame already answers that question
per pixel and the layer only had to be handed the answer.** The mechanism is confirmed against Babylon's source. The open
question below — what excluding the geometry costs visually — is now answered
for both: enough that neither can be excluded, by distance or otherwise.
**RE-MEASURED after finding 18 and the share did not move**, which is the last
section and is the one to read first — it also carries the first breakdown of
who is actually in the layer's list, and that breakdown is what re-ranks the
three shapes left.

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
**Those two figures are PRE-finding-18 and the draw count is superseded; the
+22.5% is not.** Both were re-taken on the current tree and the last section has
them — the layer's list is 585 meshes against the frame's 1,362 draws now, and
it is still 22.7% of the frame, which is not the coincidence it looks like.
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

### Tried a SECOND time, for BODIES rather than the world, and it fails the same way

**A soldier looked like the exception to "the black is load-bearing" and is
not.** The rigs are the largest bucket of meshes in a 24-a-side frame (finding
30), every mesh of one but the visor is a cel `ShaderMaterial` with no
`emissiveColor`, and a body is nineteen small boxes rather than a wall — so
excluding rigs alone, and keeping every wall in the layer, looked like the
version of this that could not repeat the revert above. It repeats it exactly.

**What it was worth, measured on Sarab with the fight held so four arms saw one
scene** (`glow+cull` / `glow` / `cull` / `none`, round-robin, against an A-vs-A
control spanning 12.46-13.05 ms), 48 bodies with 19 of them inside
`bodyDrawDistance`:

| arm | draws | candidates | mesh walk | frame | fps |
| --- | --- | --- | --- | --- | --- |
| none | 1,892 | 2,295 | 2.63 ms | 14.22 ms | 70.3 |
| glow | **1,582** (−16.4%) | 2,295 | 2.61 ms | 13.20 ms (**−7.2%**) | 75.7 |
| cull | 1,892 | **1,686** (−26.5%) | 2.24 ms | 13.61 ms (−4.3%) | 73.5 |
| glow+cull | 1,582 | 1,686 | 2.25 ms | 12.72 ms (−10.6%) | 78.7 |

The two levers are orthogonal — each moves its own counter and nothing else —
and roughly additive. **The glow half is the bigger one and it is the one that
had to go.**

**The test that killed it is the one this entry has prescribed since it was
written**, and it took ten minutes: stand an emissive directly behind the thing
being excluded and diff. Staged from the `lanterns` vantage in `deploy` (the
world is held there, so the camera stays where it is put — in `playing`
`updateGameplay` puts it back on the player every frame and the first attempt at
this measured nothing but motion), one bot on the eye-to-lamp line, an A-vs-A
control that came back **byte-identical**, and the lever confirmed applied by a
draw count that moved by exactly −19:

| eye to body | body height on screen | mean abs | worst pixel |
| --- | --- | --- | --- |
| 1.5 m | 1,260 px | 1.899/255 | **254/255** |
| 4.5 m | 420 px | 0.406 | 253 |
| 8.5 m | 222 px | 0.152 | 177 |
| 13.5 m | 140 px | 0.053 | **104** |

It is the lamp blooming through the soldier's chest, and it is obvious in the
frame rather than a number — two yellow blobs sitting on a body that is between
you and the light. It decays with the body's screen AREA and it is still 104/255
at 13.5 m, so **no distance gate rescues it**: tuning one would be this entry's
own "the mistake worth keeping is the PREDICATE" a second time, in a night
village where the failure is exactly the walking-past case a bank of stills
cannot see.

**Rows past 13.5 m in that sweep read zero and mean nothing** — the camera had
walked back inside a building and neither the lamp nor the body was in frame.
Noted because the zeros look like the falloff reaching a floor and are a
staging failure, which is the same shape of mistake as the revert above.

**The occluder-proxy idea is what is left, and nobody has costed it.** A rig is
nineteen meshes only because of COLOUR merging, and the glow pass does not care
about colour — it wants one body-shaped depth write. `rig.root` is already an
invisible capsule of about the right size. Making it draw in the glow pass and
not in the main one is the "cheaper occluders rather than fewer" shape this
entry already names, and it is a Babylon question: the layer's render list is
the scene's ACTIVE meshes, so an occluder has to be `isVisible` to be seen by
it, and what stops it drawing normally would have to be renderer state the glow
pass does not inherit. Untried.

---

### RE-MEASURED on the current tree: the share is INVARIANT, and who is in the list

**Status:** measured on the Windows box, three instruments agreeing. Nothing
landed; what this settles is the SIZE of the prize and the RANKING of the three
shapes above, both of which were being read off pre-finding-18 numbers.

The question was whether finding 18 had quietly eaten this entry. It cut
Coldharbour from 2,641 draws to 1,431 by taking colour out of the merge key, and
the glow layer's list is derived from the scene rather than stated, so the
expectation was that the prize had shrunk with it and this entry could be
closed. **It has not shrunk, and the reason it has not is the thing worth
keeping.**

Coldharbour, uncapped headless at 1920x1080, a live round with sixteen bots,
warm past the compile stall, the shipped profiler armed with `?profile` and its
capture reaching back over 3,000 frames:

```
frame        9.905 ms   98.0%      draws 1362 | active 601
  render     9.398      93.0%      mesh walk 2.06 ms | render targets 2.292 ms
    drawWorld    4.719  46.7%
    glow         2.297  22.7%
    drawOverlay  0.199   2.0%
  gameplay   0.462       4.6%
```

and an A/B/A/B on `layer.isEnabled` in the same session, 6 s windows with a
1.5 s settle, which is the instrument that does not depend on the span being
bracketed correctly:

| arm | glow | median | fps |
| --- | --- | --- | --- |
| 1 | on | 10.10 ms | 99.0 |
| 2 | **off** | 7.80 ms | 128.2 |
| 3 | on | 10.60 ms | 94.3 |
| 4 | **off** | 8.20 ms | 122.0 |

**The layer is 2.35 ms — 22.7% of the frame, and +29.4% fps if it goes.** The
`glow` span says 2.297, the A/B says 2.35, and `SceneInstrumentation`'s
render-target counter says 2.292 without being asked, because the glow's main
texture is the only render target that runs every frame on this map. Three
instruments inside 2%. The drift between the two ON arms is 4.7%, which is well
under the effect and is the reason the arms alternate.

Finding 17 measured +22.5% before the palette merge. This is +22.7% after it.

### Why it did not move, which is a rule rather than a coincidence

The layer's render list is not stated anywhere — `effectLayer.js` sets
`_mainTexture.renderList = null` and `objectRenderer.js` then falls back to
`scene.getActiveMeshes()`. **So the layer's cost is per ACTIVE MESH, exactly
like the main pass's, and every fix that removes active meshes removes them from
both halves at once.** Finding 18 cut the glow's list by the same proportion it
cut the main pass, in the same frame, and left the ratio exactly where it was.

**The glow layer's share of the frame cannot be reduced by making the scene
smaller.** That is the general form and it is worth having before anyone spends
a week on the next mesh-count lever expecting this to fall out of it: mesh-count
work pays into this entry proportionally and never changes it. Only changing the
LAYER changes the share. It also disposes of one idea that looks adjacent and is
not — paletteising `SoldierModel`'s `mergeByColor` the way `BlockMerge` was
paletteised is worth having for the main and ink passes, and it will not move
this number.

### Who is in the list, counted for the first time

607 active meshes, 585 of them in the layer, 22 excluded (the sky, the water,
the grass, the zones, the viewmodel's own exclusions):

| bucket | meshes | share of the layer |
| --- | --- | --- |
| bot rigs | 212 | 36% |
| block-merged world | 220 | 38% |
| terrain patches (`terrain-#,#`) | 49 | 8% |
| tank parts | 36 | 6% |
| ridge scree and rock | 20 | 3% |
| blob shadows | 15 | 3% |

**That list is 43% of the frame's 1,362 draws and the layer is 23% of its
time**, and the gap between those two is the same one finding 17 found under
the outline shells: a glow draw reuses one bound material, so it is a cheap
draw rather than a free one. (The 43% is the list size against the counter's
total, not a per-pass draw count — nothing here attributes draws by pass, and
the 2.35 ms is measured rather than inferred.)

**What the breakdown re-ranks:**

- **The rigs are 36% of the layer, so ~0.85 ms, so ~8% of the frame.** That is
  the −7.2% the section above measured on Sarab, arrived at from the opposite
  direction on a different map, which is the best evidence either number is
  right. It is also the bucket where the occluder proxy is a **92% cut** — 212
  meshes down to one capsule per body — against the ~37% a colour-merge fix
  would give, and it is the only one of the three shapes that changes the ratio
  rather than riding it down. That is the argument for trying it, and the
  section above is still the caution: the capsule's silhouette is not the
  body's, so it can fail the emissive-behind test in the OTHER direction —
  occluding a lamp visible between an arm and the torso — and that test is what
  it owes before anything else. Untried, and this changes nothing about that.
- **The world, the terrain and the ridge are 49% between them** and are exactly
  what the first revert killed. No proxy exists for arbitrary block geometry,
  and the terrain patches are the specific thing that revert names.
- **The 15 blob shadows are free and are the only free thing here.** They are
  flat decals lying on terrain that is already in the list, so they occlude
  nothing the ground does not already occlude. It is 2.5% of the layer — worth
  taking only because it is the one exclusion in this entry that carries no
  visual question at all, and therefore the one that needs no test.

### Tried a THIRD time, in SCREEN space, and it is defeated by the block merge

**Status:** built, verified picture-identical, measured, and REVERTED — this
time on the numbers rather than on sight. The mechanism was sound and the
prize is not there, for a reason that is worth more than the attempt.

The two reverts above both narrowed the occluder set in WORLD space, and the
lesson drawn from the first is that they could not: "occlusion is a property of
the LINE OF SIGHT, not of proximity to the light." **A screen-space overlap
test is that line of sight.** A mesh can occlude a bloomed pixel only if it
covers pixels within the blur's reach of an emissive pixel — a projection
rather than a distance — and a wall two hundred metres from a lamp still passes
it while it stands between the lamp and the eye, which is the exact case that
killed the range version. So this was not that predicate retuned.

`GlowOccluders` put a `getCustomRenderList` hook on the layer's main texture
(the same public hook `ShadowSystem` uses), stamped each emissive mesh's
projected bounding sphere — grown by the blur's reach and a margin — into a
32x18 screen grid, and kept only the meshes whose own projection touched a
stamped cell. Everything was rounded OUTWARD, and anything that could not be
bounded at all was kept.

**It works, and the frame is bit-identical.** Twelve poses on Hollowmere — the
three committed diff vantages at four yaws each, frozen, with an A-vs-A control
— report **0.0/255 mean and 0 worst pixel** against the un-narrowed frame, on a
control that is byte-identical. Every pose had the lever confirmed applied by a
counter that moved, which is the check the first revert did not have.

**And it saves nothing, because the emissive geometry is BLOCK-MERGED.** In a
live round it kept **584 of 607** meshes on Coldharbour — a 3.8% cut — and
159/171 then 78/90 on Hollowmere. The measured frame did not improve on either
map and was worse on the cheap one, where two bounding-sphere projections per
active mesh per frame in JS cost more than the handful of draws they removed:

| map | narrowed | whole-scene | drift between the two narrowed arms |
| --- | --- | --- | --- |
| Coldharbour | 13.20 ms | 12.90 ms | 13.50 / 12.90 |
| Hollowmere | 2.80 ms | 2.25 ms | 3.30 / 2.30 |

Read the Hollowmere row as noisy and the Coldharbour row as decisive: at a 3.8%
cut there is nothing to win whatever the drift is.

**WHY, and this is the finding.** After finding 18, an emissive "mesh" is not a
lamp — it is every emissive fitting in a 48 m block, merged per colour.
Coldharbour's whole visible emissive set in a frozen frame is **five meshes**,
and Hollowmere's sixteen, each with a bounding sphere tens of metres across;
two of Hollowmere's had the camera INSIDE them. A block-sized sphere projects
to most of the screen, so the stamp covers the grid and the test keeps
everything. **The merge that bought half the main pass's draws also destroyed
the spatial granularity any screen-space reasoning about emissives needs**, and
that trade is not recorded anywhere else.

**One real bug was found on the way and it is in this idea rather than in the
game.** `Sky`'s four cloud decks carry an emissive AND `infiniteDistance`, so
their centre sits on the eye with a ~1,000 m radius around it. They are
correctly excluded from the layer, but the render list a `getCustomRenderList`
hook is handed is the scene's active meshes BEFORE the layer's own exclusions,
so consulting one stamped the whole screen on every frame of every map. The
first version of this cut exactly 0% everywhere and that was why. **Anything
reading that list owes `layer.hasMesh` before it believes a mesh is in the
pass.**

**What this leaves.** The occluder-proxy idea in the section above is NOT
affected — a rig is per-body and small, so a body's footprint is a body — but
the world half of this entry now has three failed approaches rather than two,
and all three failed on the same thing: **there is no cheap way to know which
geometry matters to a bloom, because the only honest answer is a per-pixel
depth test.** That is an argument for moving the emissive into the MAIN pass as
a second attachment and blooming it in post, where occlusion is inherited from
the depth test the frame already does and merge granularity stops mattering
entirely. What blocks that is not the shader — every fragment in this game goes
through hand-written WGSL — but that a scene-wide MRT needs every OTHER
material in the pass to write the attachment too, Babylon's own
`StandardMaterial` included. **That sentence has now been tested twice and it
is exactly right, which was not the expected answer — see the next section.**

### The MRT route, spiked: it WORKS, and the attachment mask is PASS-WIDE

**Status:** measured, on the Windows box, in raw WebGPU and then through
Babylon with this game's real materials. Nothing landed. This is here so the
next attempt starts from the constraint rather than from the hope.

**1. WebGPU allows a pipeline to leave a colour target unwritten, but only if
that target's `writeMask` is 0.** Raw WebGPU, two `rgba8unorm` targets,
attachment 1 cleared to blue:

| case | result |
| --- | --- |
| shader writes both, two full targets | **OK** — a0 red, a1 green |
| writes `@location(0)` only, two full targets | **INVALID** |
| writes `@location(0)` only, `targets[1].writeMask = 0` | **OK**, a1 keeps its clear value |
| writes `@location(0)` only, `targets[1] = null` | pipeline builds, the render PASS rejects it |

The message is `Color target has no corresponding fragment stage output but
writeMask (ColorWriteMask::(Red|Green|Blue|Alpha)) is not zero`. An unwritten
attachment keeps the CLEAR value rather than garbage, which is the half that
makes the idea viable at all.

**2. Babylon emits exactly that form, and the switch is
`engine.bindAttachments(engine.buildTextureLayout([...]))`** —
`webgpuCacheRenderPipeline.js` writes `writeMask: (this._mrtEnabledMask & (1 <<
i)) !== 0 ? this._writeMask : 0`. Put the game's own active meshes into a
two-attachment `MultiRenderTarget` with that layout bound and **the scene
draws**: attachment 0 came back `[20,29,43,255]`, which is Hollowmere.

**3. And the mask is ENGINE state applied per render-target BIND, not per
material — which is the whole finding.** Setting it pass-wide works. Varying it
per draw through `mesh.onBeforeDrawObservable` does NOT: the pipeline for that
draw is already built by the time the hook runs, and the trial fails with the
same `writeMask` error as doing nothing at all. So within one pass there is one
attachment mask, and therefore **either every material in the pass writes
`@location(1)`, or none of them can.**

**What that costs, enumerated on Hollowmere's 73 active meshes: 51
`ShaderMaterial` and 22 `StandardMaterial`** — and the `StandardMaterial` half
is not the awkward remainder, it is the EMISSIVE half, the tracers and embers
and lamps the layer exists for. So the list is every hand-written shader in
`src/shaders/` (yours, easy), Babylon's `StandardMaterial`, Babylon's
`OutlineRenderer` pass and the particle shaders (not yours). The technique for
the last three is not new here — `OutlineFog.ts` already patches Babylon's WGSL
shader store by hand and forces the recompile — but it is three more shaders
under that regime, and `OutlineFog`'s header is a fair estimate of what each
one costs to get right.

**Two traps, both of which cost time in the spike itself.**

- **A bad pipeline is SILENT.** The baseline trial drew nothing at all —
  attachment 0 all zeros — with `pageErrors` empty and `consoleErrors` empty.
  The only trace was a `pushErrorScope("validation")` put there on purpose.
  This is finding 18's black-frame cascade arriving from a third direction, and
  it means **any attempt at this owes an explicit WebGPU error scope**, or a
  wrong answer looks like a working one that renders nothing.
- **Babylon's pipeline cache POISONS later trials in the same page.** Once one
  invalid pipeline exists, every later trial reports `[Invalid RenderPipeline
  ...] is invalid due to a previous error` whatever it actually did — the first
  run of this spike read that as "the escape hatch does not work" and it was
  the cache. **One page per trial**, or the result is the previous trial's.

**And render bundles are keyed on attachment state.** With
`compatibilityMode = false`, a mesh recorded into a bundle for the one-attachment
backbuffer pass and then replayed into a two-attachment pass is
`Attachment state of renderBundles[17] is not compatible with
[RenderPassEncoder]`. Harmless in a spike that adds a second pass; a real
implementation has one pass and would not hit it, but it is the thing to watch
if the main pass ever gains an attachment conditionally.

**Where this leaves the route.** It is not blocked and it is not plumbing. It
is one shader-store patch each for `StandardMaterial`, `OutlineRenderer` and
the particles, plus an output on every shader in `src/shaders/`, plus the post
chain re-pointed at attachment 0 — for the 2.60 ms this entry is about. Nobody
has decided whether that trade is worth taking.

### The DEPTH-SHARING route, spiked: it WORKS, and it needs no shader changed

**Status:** measured on the Windows box, mechanism proven end to end. Nothing
landed. **This is the cheapest route found so far and the first one that is not
blocked on something.**

The idea sidesteps every wall above. Do not narrow the occluder set and do not
move the emissive into the main pass — instead draw ONLY the emissive meshes
into the glow buffer and take the occlusion from the main pass's own depth
buffer, which already holds exactly the answer at exactly the right
granularity. `RenderTargetWrapper.shareDepth` is engine-agnostic in 9.19.1 — a
plain `_depthStencilTexture` reassignment — so WebGPU needs no override.

Hollowmere, the `lanterns` vantage, render scaled to 480x270 because depth
sharing REQUIRES matching dimensions and a full-resolution readback per trial
is not worth the wait. An emissive-only buffer holding the frame's 20 emissive
meshes against the 204 the layer draws today:

| arm | lit pixels |
| --- | --- |
| its OWN depth, freshly cleared (nothing can occlude) | 1,672 |
| the main pass's depth, SHARED | **926** |
| shared, with the depth test INVERTED (the control) | 748 |

**926 + 748 = 1,674, against the 1,672 the unoccluded arm drew.** The normal
and inverted tests partition the set exactly, which is what says the depth is
being read per PIXEL rather than approximately — a control worth copying,
because "fewer pixels" on its own is also what a broken render looks like.

**Four things it took to get there, and the second is the one that wasted the
first run.**

- The main pass IS a render target during the draw phase
  (`WebGPURenderTargetWrapper`, reachable as `engine._currentRenderTarget` from
  `scene.onAfterDrawPhaseObservable`) and it DOES carry a depth texture, at the
  render size. Neither was obvious; the camera has three post-processes and it
  is the first of those that owns the target.
- **The glow buffer must clear COLOUR ONLY.** Babylon's default RTT clear wipes
  depth and stencil too, so the first run cleared the very buffer it had just
  been handed and occluded nothing — 1,673 against 1,675, which reads exactly
  like "the mechanism does not work". `rtt.onClearObservable.add((e) =>
  e.clear(color, true, false, false))` is the whole fix.
- It has to render from `onAfterDrawPhaseObservable`, so the depth is THIS
  frame's. An effect layer's own texture renders in the render-target phase,
  which is BEFORE the main draw — one frame stale, which for a bloom is a halo
  that lags the camera.
- No validation errors on any arm, under `compatibilityMode = false`.

**What it would cost to build, and it is all in one place.** `GlowLayer` cannot
be configured into this — its texture renders in the wrong phase and clears the
wrong buffers — so this is a custom layer: an RTT holding the emissive meshes,
a blur, and an additive composite in the post chain, plus a port of
`Game`'s `customEmissiveColorSelector` (the per-mesh fog fade and the kit-screen
blanking, both of which are look decisions with arguments written down beside
them). Two details are not optional. The pass needs its own material so a mesh
contributes its EMISSIVE term rather than its full shaded colour —
`RenderTargetTexture.setMaterialForRendering` is the hook, and the spike did
not use it, so its pixel counts are "what drew" and not "what would bloom".
And the buffer must be FULL resolution, where the layer's is half
(`mainTextureRatio` 0.5), because that is what depth sharing demands — four
times the pixels through the blur, which is free on the box these numbers come
from and is exactly the trade `FINDINGS.md` 17's third open thread says will
invert on a phone.

**Against the MRT route it wins on every axis but one.** No shader gains an
output, no Babylon shader store is patched, no material has to participate, and
the occlusion is exact rather than conservative. What it does not do is remove
the second geometry pass — it makes that pass 20 meshes instead of 204, which
is the same ~90% the whole entry has been chasing, but the pass is still there
and still costs a bind. **Nobody has measured the frame with it built.**

### WHAT LANDED — `src/core/GlowDepth.ts`

The layer keeps its blur, its compose, its emissive selector and its exclusion
list. Two things change: **its render list is the emissive meshes alone**, and
**its occlusion is the main pass's depth buffer**, shared rather than redrawn.
That is the same answer the opaque black was computing, exact to the pixel, for
none of the draws.

**The frame, a live round, uncapped headless, fresh page per arm:**

| map | stock | landed | saving |
| --- | --- | --- | --- |
| Coldharbour | 9.45 ms | 7.60 ms | **1.85 ms, 19.6%** (106 -> 132 fps) |
| Harrowmead | 10.55 ms | 8.25 ms | **2.30 ms, 21.8%** (95 -> 121 fps) |
| Sarab | 13.40 ms | 10.55 ms | **2.85 ms, 21.3%** (75 -> 95 fps) |

Both arms of every pair agree to within 0.3 ms (9.4/9.5, 7.6/7.6, 13.4/13.4),
which is far tighter than this box's usual spread and is what makes a ~20%
reading believable at all.

**The picture: 36 frozen vantages across Hollowmere, Coldharbour and Greyfen —
three committed diff vantages per map at four yaws each — worst mean
0.0258/255, worst pixel 90, and zero page or console errors on every map.**
Two poses came back exactly 0. For scale, finding 18 landed at 0.19 to 3.26.
The residue is the blur resampling at full resolution rather than half; it is
not occlusion, which the spike proved separately by showing the normal and
inverted depth tests PARTITION the emissive pixels exactly (926 + 748 against
1,672 unoccluded).

**Four mechanics, and every one of them failed silently first** — they are on
the line in `GlowDepth.ts` and repeated here because each cost a measurement
round:

1. **The main texture must render LATE.** The scene component registers
   `_renderMainTexture` on `_cameraDrawRenderTargetStage` (before the camera
   draws) and the compose on `_afterCameraDrawStage` (after). Only the first is
   in the wrong place. It must be MOVED and never skipped, because it also
   raises the `_renderEffects` flag the compose reads — skipping it stops the
   layer compositing at all, which looks like the glow having been deleted.
2. **The clear must be REPLACED, not added to.** `_createMainTexture` installs
   its own `onClearObservable` handler that clears colour, depth AND stencil,
   and an `Observable` runs every observer. Adding a colour-only clear beside it
   leaves the depth wiped — the arm with sharing and the arm without came back
   BIT-IDENTICAL, which reads exactly like "the mechanism does not work" and
   actually meant "it never ran".
3. **The framebuffer must be re-bound after the render**, because an RTT render
   restores the DEFAULT framebuffer and the compose would otherwise land on the
   canvas, under the post chain.
4. **The texture must be FULL resolution with a doubled kernel.** `shareDepth`
   demands matching dimensions and the layer's default is half; the kernel is in
   texels of that texture, so it doubles with it or the bloom halves on screen.

**What this cost that is not milliseconds.** The glow buffer is four times the
pixels through the blur. That is free on a draw-call-bound desktop frame and is
precisely the trade finding 17's third open thread says inverts on a phone —
**nobody has measured this on a phone, and it is the one open thread this
change leaves.** It also reaches into three Babylon internals (`_getComponent`,
`_renderMainTexture`, `_currentRenderTarget`), each asserted in a DEV build for
the reason `OutlineFog.ts` asserts its patch anchors.

**And it retires the entry's whole premise.** The rigs are no longer in the
layer's render list, so the second attempt's 310 draws on Sarab are gone
without excluding anything; `CLAUDE.md`'s paragraph saying rig exclusion is
deliberately not done has been replaced.

### One thing noticed on the way, and it belongs to finding 32 rather than here

**Coldharbour's frame has roughly halved since finding 32 was written.** That
entry has it at 52.6 warm fps and a 19.3 ms median; the same map, same
resolution, same instrument class, profiler armed (which costs ~1.5%), now reads
94-99 fps and a 10.1-10.6 ms median. 1.9x is well past the ~1/3
cross-session drift that entry warns about, so most of it is real and is
presumably `narrowedMove` and the rig culling landing after it. **Finding 32's
table is stale enough to mislead anyone sizing a lever against it.**

And `shadowPass` fired on **zero of 3,000 frames** on both maps measured. That
is not a dead hook: `ShadowSystem` sets `REFRESHRATE_RENDER_ONCE` and the
refresh test genuinely never fails during play, which is finding 2's headline
confirmed continuously rather than by inference. The 2.18 ms left unattributed
inside `render` is the mesh walk (2.06 ms by the counter), not the shadows.

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
that, which is why `Vehicle.deckAt` exists. Verified against the ray over 1,617
points on and around a parked hull with no disagreement, and a body dropped over
the turret settles on the deck. Anything else that ever moves and can be stood
on owes the same door.

### It IS switched on for a vehicle, and that half is closed

`Vehicle.supportAt` takes it ten times a frame — once per track contact — and the
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

**Status:** measured headless, amortised, re-measured on real hardware, and
worth re-measuring before anyone raises the breakable-pane count. **A field is
half the bytes it was** — `Uint16Array`, one BFS step count per surface, see
`NavGrid.FLOW_UNREACHED` — which changes what a rebuild ALLOCATES and not what
it costs.

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

34,142 walkable surfaces, seven fields (five control points and both home
spawns). The walkable count grew by ~5% when the mixed-use blocks went in and
the timings above were not re-taken; a field is linear in it, so read them as a
floor rather than as current. (The surface count that used to head this
paragraph was 183,184, which was `cells * maxSurfaces` rather than surfaces:
ENGINE_UPGRADE.md S3 compacted the id space and the same graph now reports
**72,230**. The walkable figure is unaffected — it always counted real ground.)

**One field is 1.9 ms on the Windows box** (Coldharbour, real adapter, warm,
median of five), against the 4.7 ms headless above — inside the 1–2 ms this
entry guessed. **Re-measured after `ENGINE_UPGRADE.md` S4 it is 0.90 ms**, same
box, same map, same median-of-five, and S4 is not the reason: it moved
`FlowField.dist` from a `Float32Array` to a `Uint16Array` and the BFS queue from
a `number[]` to an `Int32Array`, and on the proving ground — where a field is
long enough to measure honestly — the same pair of runs is 11.60 ms before and
11.80 after. The rebuild is a MEMORY change and not a speed one; read the 1.9
against the 0.90 as two readings of a sub-millisecond call rather than as a
2.1x. It is still a SYNCHRONOUS call rather than one taken from the
page's own frame loop, so what is settled is the machine, not the placement. 15.9 ms in one frame is a dropped frame on a 60 Hz budget that
FINDINGS #1 already says drops one every 1.7 s; spread over seven it is
invisible, and the staleness in between costs nothing because breaking is
monotonic — the graph only ever gains links, so a stale field walks the long way
and is never wrong.

### What is not known

**The real-hardware figure.** ~~4.7 ms headless is probably 1–2 ms on a real
machine, but that is a guess~~ — settled above at 1.9 and then 0.90 ms on
Coldharbour. What is still a synchronous call rather than one taken from the
page's own frame loop is the PLACEMENT, and that is what the number was wanted
for.

**How it scales with the MAP, which is the open half now.** The same call on the
committed 900/300 proving ground is **11.7 ms**, against Coldharbour's 0.90 —
and a field is linear in walkable surfaces, of which that map has 305,193 to
Coldharbour's 34,142. Scaled to `ENGINE_UPGRADE.md`'s 1500 m target that is
**~32 ms a field**, which is a dropped frame on its own and seven of them in a
row while the queue drains. `ENGINE_UPGRADE.md` S4 measured this, declined to
re-model the fields for it, and handed it to S5 — the work is unchanged and
wants to be off the frame rather than smaller. Nothing is chargeable to it yet:
no map that big exists, and the proving ground has no breakable glass.

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

**One number in `plans/done/webgpu_migration.md` and `VERIFYING.md` does not
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

~~Replacing the OUTLINE with a screen-space edge is the half to leave alone.~~
**DONE, and this paragraph was wrong in every particular that mattered.** It
said a screen-space version needs an ink-id attachment, because the ink is
per-material coloured, selective through `noOutline`, thinned per mesh and
fogged per pixel. What it missed is that **every one of those four was a
CONSEQUENCE of the ink being an unlit inverted hull**, not a requirement of the
look: a screen-space line multiplies the pixel already there, so it is coloured
and lit and fogged and weathered for free and cannot invert; the thinning was
papering over a per-mesh fade the pass now does per pixel; and only `noOutline`
was a real loss, which is still outstanding and has a cheap answer
(`glow.mainTexture`). It also worried that swapping the mechanism invalidates
the rules a good deal of geometry is shaped by — the thick-box rule, "nothing
may be laid ON an inked surface", emissive details protruding past their
neighbours' shells. It does, and that is a REFUND rather than a cost: all three
existed because the hull wrote depth in front of what it wrapped, nothing has to
be re-shaped, and Coldharbour's lane markings stop being invisible.

**The counting in the table above is also STALE and was the load-bearing error.**
It reports 429 outline shells on Coldharbour. Counted live on the current tree:
**84 of 609 active meshes** — the palette merge had already taken the world out
of Babylon's outline pass, because `cel-world` is one mesh of ten colours and
`addOutline` is per mesh. The world's ink had moved to `MapBuilder.inkTwin`, a
separate INVERTED-HULL MESH per merge group: **53 on Coldharbour and 144 on
Harrowmead**, each the expensive kind of draw. So the prize was never the shells.

**What landed** (`shaders/CelInk.ts`): one full-screen edge over the depth the
frame has already written, replacing both mechanisms. `OutlineFog.ts`, the
`CEL_INK` shader variant, `getInk`, `inkTwin`, `addOutline`,
`updateOutlineScales`, `reinkOutlines`, the outline registry and the per-map ink
derivation are all deleted. Measured live, uncapped, 6 s windows, spawn
position: **Coldharbour 7.66 -> 5.80 ms (+32%), Harrowmead 9.22 -> 6.30 ms
(+51%)**. That beats the runtime A/B that predicted it (+15.4% / +34.7%) because
the A/B only DISABLED the twins and a disabled mesh is still walked — never
building them takes them out of `scene.meshes` as well, active meshes 609 -> 555
and 726 -> 582, which is finding 22's per-mesh walk cost arriving on top of the
draws.

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

**DISPROVED — see finding 24, and this paragraph is left standing because how
it was wrong is the useful part.** `removeMesh` is 98 ms of a 6,420 ms loop:
88,131 calls scanning 547 million array elements, which is 0.18 ns an element,
because V8's `indexOf` over a packed array is not a memory access per element.
`AssetContainer` was never the door and `rootNodes` has been O(1) since Babylon
9. The loop was uploading a million part meshes' vertex buffers to the GPU and
disposing them moments later, and the `n^2.9` was the WebGPU allocator
degrading rather than an `O(built × live)` scan. The ms-per-placement column
DID go flat — 6.4 at 900/300 and 8.5 at 1500/0 — for a completely different
reason than this predicted.

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

## 22. Wall 2, measured at last: one ray is 2.4 ms on a 1500 m map, and a fight spends a third of the frame in `pickWithRay` — **CLOSED by 23**

**Status:** measured on the Windows box, **and closed by finding 23** — every
one of the eight sites is a box query now and the per-ray cost is flat in map
size. What follows is the reading that priced the wall; keep it, because it is
the before half of 23's pair and because its protocol is the one to reuse. This is
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

- ~~**Wall 2 itself.**~~ **CLOSED by finding 23** — `RayWorld`, the analytic
  segment query over `colliderBoxes` that `Player.probeGround` set the precedent
  for.
- ~~**The 2.4x between the in-situ and the isolated per-pick cost.**~~ **Moot**:
  both are under 5 us now and the gap is inside the clock's own resolution.
- ~~**The 1500/0 projection**, which is derived from the collider count alone.~~
  **Moot**: the cost no longer scales with the collider count at all. Finding 23
  measures 3.5 us in situ on the 5,929-box proving ground against 4.5 on
  Coldharbour's 768.
- **Whether the query count per frame holds up in a real fight** rather than in
  a forced ring. 0.95–1.6 per frame is what sixteen bots at `thinkRate` produce
  here; a fight over a control point with everyone shooting will produce more,
  because every round fired is another wall query. It costs a thousandth of what
  it did, so this is a curiosity now rather than a budget.
- **The idle-pool lever**, above. Measured as a count, never as a saving. It is
  the last unclaimed item in this finding and it is about the mesh WALK rather
  than about rays.

---

## 23. Wall 2 is down: every ray is a box query, and one costs 3.5 us on the map where a pick cost 2,438

**Status:** measured on the Windows box, **fixed and landed** —
`ENGINE_UPGRADE.md` S2. This is finding 22's after half; read them as a pair,
and read 22 first, because its protocol is reused here unchanged.

`scene.pickWithRay` is gone from gameplay. All eight sites — the hitscan's wall
cap, the bots' LOS, the aim assist, the grenade's step ray and its blast probe,
the rocket, the death cam's pull-in, and the tank's chase camera and dismount
probe — go through `src/world/RayWorld.ts`: a uniform grid over `colliderBoxes`
plus the strut groups, plus a march over the heightfield. `world/solid.ts` keeps
one predicate for the editor's centre-screen pick and nothing else.

### What it costs now

Headless Chromium via `channel: "chromium"`, `--disable-frame-rate-limit
--disable-gpu-vsync`, 1920x1080, warmed on `reflections.queue.length === 0`,
sixteen bots stood in a 12–24 m ring around the player and re-stood every
second. Finding 22's forced skirmish, reproduced.

| sixteen bots in contact | Coldharbour | Harrowmead | **proving 900/300** |
| --- | --- | --- | --- |
| collider boxes | 768 | 748 | **5,929** |
| frames in 8 s — **before** | 1,115 | 890 | **656** |
| frames in 8 s — **after** | **1,234** | **1,151** | **898** |
| queries per frame | 1.36 | 0.95 | 1.59 |
| **us per query** | **4.5** | **4.0** | **3.5** |
| — against, per pick (22) | 222 | 199 | **2,438** |
| **share of the frame** | 0.07% | 0.05% | **0.07%**, from 30.7% |

**The exponent is what changed and the ratio is only the consequence.** A pick
was `O(colliders in the scene)`; a query is bounded by what the segment crosses,
so the 1500-m-class map is now the CHEAPEST of the three per ray rather than 11x
the dearest. The proving ground's forced fight went from 82 to 112 fps and
Harrowmead's from 111 to 144.

**Isolated, 400 seeded rays per range — finding 22's second table, rebuilt:**

| us per ray | Coldharbour | proving 900/300 |
| --- | --- | --- |
| pick, 55 m | 137.5 | 1,025.2 |
| pick, 180 m | 122.0 | 983.2 |
| **`castRound`, 55 m** | **3.25** | **5.0** |
| **`castRound`, 180 m** | **1.5** | **5.0** |
| **`blocked`, 55 m** | **2.25** | **3.75** |

The pick column reproduces 22's (125.8 / 1,043.8 at 55 m) to within 2%, which is
what says the instrument did not move. `blocked` is the any-hit form the three
line-of-sight callers use and is cheaper than the nearest-hit one, as it should
be. **`performance.now()` is clamped to 100 us in a page that is not
cross-origin-isolated**, so these are quantised at 0.25 us/ray over 400 and the
single-digit figures are 2–4 clock ticks: read them as an order of magnitude,
and take the in-situ table above — which integrates thousands of calls — as the
measurement.

### The substitution audit, and the two classes of disagreement it found

Under a NullEngine, off `buildServerWorld` (which still stands the collider
meshes up), **8,000 seeded rays per map per question** — 4,000 eye-height at
55/120/180 m, 2,000 short from inside geometry, 2,000 straight down — compared
`scene.pickWithRay` against `RayWorld` on all four shipped maps. **32,000 rays
each way. Every disagreement is one of two things and neither is a geometry
bug.**

**Class 1 — Babylon's picking is FUZZY by `Ray.epsilon` and the analytic is
not.** `Ray.intersectsTriangle` accepts a barycentric outside the triangle by up
to `Epsilon` (1e-3) — the guards are literally `bv < -this.epsilon` and
`bv + bw > 1.0 + this.epsilon`. Thirteen rays out of 32,000 stopped on geometry
the boxes say they miss, and **every one had a minimum barycentric between
-2.7e-4 and -9.2e-4**: all inside that tolerance, none inside the triangle. On a
jungle trunk's 13 m face that skin is about a centimetre, and along a grazing
ray it reads as up to 314 mm of distance (Coldharbour's worst). So the pick was
reporting hits on a phantom shell around every collider; the analytic does not,
and **the analytic is the one that agrees with `colliderBoxes` — which is what
`NavGrid`, `CoverMap`, `ObstacleField`, `server/validate.ts` and the collision
bake all read.** Greyfen has most of them (a jungle of ~950 tall thin trunks
maximises the absolute slop); Hollowmere has one.

**How that was established, because three hypotheses were wrong first.** The
merged clump mesh was suspected — its vertices match the boxes to 5e-7. Then
`MergeMeshes` — the same boxes as LOOSE meshes miss exactly where the analytic
does. Then float32 — a centimetre is five orders too big for it at 86 m. What
settled it was a manual Möller-Trumbore over the picked mesh's own vertex
buffer, which **found nothing** where `scene.pickWithRay` reported a hit, and
then `Ray.epsilon` in `node_modules`.

**Class 2 — a coincident surface, which is a tie rather than an error.** A prop
is planted with its foot on the ground, so the bottom face of its box and the
terrain under it are the same plane and a ray reaches both at the same distance;
the measured deltas run from 1e-15 to 3e-7 m. Which one answers decides nothing
but `RayHit.surface`, i.e. which spark the impact throws. `RayWorld`'s
`COINCIDENT` (1e-4 m) resolves it the way the pick did — the collider wins,
because `scene.meshes` is in creation order and every collider is made before
the floor's clones — and that closed 64 of the 67 on Hollowmere. **About 26 of
32,000 still tie the other way**, and no rule can satisfy both directions; what
it costs is a dirt spark where there was a stone one, on a round landing exactly
where a collider is flush with the ground.

**Agreement after the tie-break: 99.66% to 99.99% per map per question**, with
100% of the residual accounted for by the two classes above.

### What is open

- **The 1500/0 extent has not been measured**, only 900/300. The cost is no
  longer collider-bound, so the projection is far weaker than it was — but the
  terrain march IS bounded by the segment's length in terrain cells, and nothing
  has priced that at 1500 m.
- **The heightfield march has no hierarchy.** A cell is rejected by the max of
  its four corner heights against the segment's own y-band, which is enough that
  a long ray passing well over the ground costs four array reads a cell. A ray
  ALONG a valley floor tests two triangles per cell for its whole length. A
  coarse max-height pyramid would fix it and nothing has needed one.
- **The terrain normal is the FLAT triangle's**, where a pick interpolated the
  smoothed vertex normals. The two differ by a degree or so on a hillside, which
  is an impact disc lying a degree flatter. Not measured; nothing looked wrong.
- **The ~26 residual surface ties**, above.
- **`npm run simulate` throws before it starts a round** — `CelEmissiveFog`
  refusing the tracer material's shader language under a NullEngine. Reproduced
  on an unmodified tree at `f18bdc9`, so it predates this work and is unrelated
  to it; it is recorded here because S2's own verify list names that command and
  it could not be run.

---

## 24. Wall 4's cause was the wrong one, and the placement loop is not a list scan — it is a MILLION GPU BUFFERS

**S5's first half. The 1500 m build was 186 s and is now 17.4, the placement
loop 161.5 s and is now 9.4, and the `n^2.9` shape it was carrying is gone.**
Every figure is a matched pair on the Windows box (RTX 4070 Ti SUPER, headless
Chromium via `channel: "chromium"`, 1920x1080), taken with
`src/world/buildProfile.ts` on the generated proving ground at both extents,
and the "before" column is the same tree with the change stashed rather than
finding 19's numbers quoted forward.

### The derivation that was wrong, and it was wrong by 65x

Wall 4 and finding 19 both name `Scene.removeMesh` as the cause: it is
`this.meshes.indexOf(toRemove)` plus a splice, `mergeByMaterial` disposes its
sources, so a build creating and destroying ~a million part meshes against a
`scene.meshes` growing to 23,014 is `O(built x live)` — which is exactly the
shape the ms-per-placement column had. It was recorded as **derived, not
measured**, and it is worth saying plainly that the derivation was sound and
the answer was still wrong.

Measured, by wrapping `scene.removeMesh` on the 900/300 ground and summing
`scene.meshes.length` at every call:

| | |
| --- | --- |
| calls | 88,131 |
| array elements scanned | **547,517,230** |
| time inside `removeMesh` | **98 ms** |
| the placement loop it was blamed for | **6,420 ms** |

Half a BILLION element comparisons for 98 ms. V8's `indexOf` over a packed
array is ~0.18 ns an element, and the derivation was pricing a linear scan as
if it were a linear number of memory accesses. **A list scan is not a cost at
this scale, and this document should stop reaching for one.**

### Where it actually goes, from a CPU profile of the build

`Profiler.start` over `installMap`, aggregated by self time inside
`build@MapBuilder.ts` (8,802 ms of it, on 900/300):

| self, ms | frame |
| --- | --- |
| 1,878 | `createBuffer` (native — `device.createBuffer`) |
| 1,692 | `writeBuffer` (native — `queue.writeBuffer`) |
| 515 | `createVertexBuffer` |
| 690 | `CreateBoxVertexData`'s inner loop |
| 477 | `occlusionAt` (the AO bake) |
| 367 | `segmentHitsBox` |
| 81 | `removeMesh` |

**~4.2 s of an 8.8 s build is uploading geometry to the GPU.** Every part a
builder makes is a real `Mesh`, and `VertexData.applyToMesh` uploads positions,
normals, UVs and indices the instant it is created. `mergeByMaterial` then
reads them back out of the CPU copies Babylon kept anyway, uploads the merged
result, and disposes every source — destroying the buffers it just made. A
cottage's twenty planks are twenty round trips to the device for geometry that
never survives to be drawn.

### What the fix is

`src/world/parts.ts`, and the lever is Babylon's own. `Geometry.setVerticesData`
postpones the device buffer whenever the geometry has no mesh on it yet, and
`Geometry.applyToMesh` only runs `_applyToMesh` — which creates every postponed
buffer — `if (this.isReady())`. So a geometry built BEFORE its mesh and applied
while `delayLoadState` says NOTLOADED gets a mesh that holds its vertices and
has never spoken to the device. `kit/core.ts`'s seven creation sites go through
`partBox`/`partCylinder`/`partSurface`, and `uploadPart` puts a part back on the
normal path on the three ways out of a merge that keep their source.

**The state is put back on the very next line, and the one trap here is that it
has to be.** Every read on a `Geometry` is gated on the same `isReady()` —
`getVertexBuffer`, `getVerticesData` and `getTotalVertices` all return null or
zero while it is false — so a part left NOTLOADED is not an un-uploaded mesh,
it is an EMPTY one, and `MergeMeshes` fails it as "Positions are required".
That cost a run.

### What it bought

| build phase, ms | 900/300 before | 900/300 after | 1500/0 before | 1500/0 after |
| --- | --- | --- | --- | --- |
| **`build:total`** | **9,284** | **5,010** | **185,899** | **17,422** |
| — the PLACEMENT loop | 6,420 | **2,607** | 161,491 | **9,443** |
| — block merge | 495 | 219 | 8,763 | 1,010 |
| — scatter | 170 | 108 | 4,002 | 443 |
| — road merge | 135 | 12 | 3,068 | 41 |
| — ink twins | 86 | 88 | 1,022 | 278 |
| — pane merge | 74 | 75 | 535 | 236 |
| — AO bake | 734 | 724 | 2,514 | 2,191 |
| — `NavGrid` | 696 | 681 | 2,493 | 2,572 |
| — `CoverMap` | 245 | 246 | 919 | 736 |
| — seven flow fields | 67 | 67 | 292 | 227 |
| **install to `deploy`** | **11,993** | **8,807** | **204,800** | **34,923** |

**10.7x on the whole 1500 m build and 17.1x on the loop.** The phases that
build no geometry — the AO bake, `NavGrid`, `CoverMap`, the flow fields — are
unmoved, which is what says the attribution is right.

### The superlinearity was the GPU allocator, not a list

This is the part worth keeping. Finding 19 measured 1.1 ms per placement on
Harrowmead, 6.6 on Coldharbour, 18.4 at 900/300 and **143.7** at 1500/0, and
called it `n^2.9`. After:

| | placements | ms in the loop | ms per placement |
| --- | --- | --- | --- |
| 900 / 300 | 410 | 2,607 | **6.4** |
| 1500 / 0 | 1,108 | 9,443 | **8.5** |

2.7x the placements now costs **1.33x** each, against 7.8x before. Nothing in
this change touches a list, a lookup or an index — so what was superlinear was
the WebGPU buffer allocator degrading as ~3 million create/destroy cycles ran
through a device already holding tens of thousands of live buffers. The
downstream phases say the same thing: the road merge and the block merge build
their geometry the ordinary way and still came down 75x and 8.7x at 1500/0,
because the device they allocate against is no longer in that state.

### The oracle, because this change must not move a vertex

A nav-graph fingerprint cannot see it — this is VISUAL geometry, and
`npm run parity` is blind to it by design. What was compared instead, per map,
is every mesh in `GameMap.visuals` and `GameMap.colliders` in list order: name,
material name, metadata, position/rotation/scaling, `isVisible`, `isPickable`,
`checkCollisions`, rendering group, outline flags, vertex and index counts,
submesh count, `geometry.delayLoadState`, and FNV hashes of the position,
normal, uv and colour buffers and of the index buffer. **All five maps hash
identically** — Hollowmere, Greyfen, Coldharbour, Harrowmead and the proving
ground — along with `scene.meshes`, `scene.geometries`, the active-mesh count,
and a count of visuals failing `isReady(true)` after the map draws, which is
zero on both sides.

`npm run parity` passes on all four, `gate.mjs` is clean on all four, and
`bank.mjs --check` reproduces S4's control run to four decimals (hollowmere/menu
0.627, coldharbour/avenue 3.2563, harrowmead/millpond 1.3526, and
harrowmead/borderland at 0%) — which is the same evidence S4 used, and finding
20 is still the reason the bank reads red at all.

### What is open

- **Colliders are still built the ordinary way, and it is not an oversight.**
  6,349 of the 900/300 ground's meshes are collider proxies, and their upload is
  most of the ~430 ms of buffer work left in the build. They cannot become parts
  as this module stands: `moveWithCollisions` walks `mesh.subMeshes` and a part
  has none, so a collider built as a part would stop nothing, silently. Giving a
  part a submesh without a device buffer is possible and nobody has costed
  whether it is worth it.
- **`Props.ts`'s seventy creation sites were left alone**, deliberately: the
  whole scatter phase is 108 ms at 900/300 and 443 at 1500/0, so converting them
  is churn against a rounding error. If the desert city's dressing is much
  denser than the proving ground's, re-measure before assuming that holds.
- **The remaining 656 ms of `CreateBoxVertexData`** at 900/300 is a fresh unit
  box tessellated per part. Nothing shares geometry between two identical boxes,
  and a merge has to bake the transform in anyway — but the six faces of a unit
  cube are the same six faces every time, and the loop is measurable.
- **Where the 1500 m build now is**: the placement loop is 54% of it and the
  nav/cover/AO builds S5 would move to a worker are **33%** (5,733 ms of 17,422)
  against the 3.3% they were before this landed. See `ENGINE_UPGRADE.md` S5 —
  that inversion is the decision this measurement was owed. **Re-timed after
  S5b and S5c** (finding 25): `build:total` is 18,853 of a 19,147 ms install,
  the loop is **10,092 ms and 53.5%**, and the two lanes a worker would have to
  balance are 3,899 ms of nav against 4,106 of merges. **The loop has not been
  attributed since this finding changed what it does** — the two threads named
  above are ~430 ms and 656 ms at 900/300, so nine tenths of ten seconds is
  unaccounted for, and that profile is what decides whether the worker is the
  best thing left.

---

## 25. Half the install is not the build, and it is two sites: Havok's compound is quadratic and Babylon walks the whole scene once per render pass id — **CLOSED, BOTH HALVES**

**Asked because finding 24 left a 17.5 s hole.** `build:total` is 17,422 ms at
1500/0 and install-to-`deploy` is 34,923, so more than half the load was
somewhere nobody had profiled. It is in two calls, both inside `installMap`,
and **neither is the burst work `ENGINE_UPGRADE.md` S5 is about**.

A CPU profile over `buildRound`, attributed to the direct children of
`installMap` — so every line is one call in that method, and they sum to it:

| installMap, ms | 900 / 300 | share | 1500 / 0 | share |
| --- | --- | --- | --- | --- |
| `MapBuilder.build` | 4,837 | 63.3% | 13,656 | 42.2% |
| **`PhysicsWorld.setMap`** | **1,716** | **22.4%** | **13,402** | **41.4%** |
| **`ReflectionSystem.build`** | **1,075** | **14.1%** | **5,272** | **16.3%** |
| `WorldCulling.setMap` | 5 | 0.1% | 10 | 0.0% |
| `ShadowSystem.setCasters` | 4 | 0.1% | 7 | 0.0% |
| `Atmosphere.apply` | 2 | 0.0% | 3 | 0.0% |
| `GlassSystem.setMap` | 0 | 0.0% | 3 | 0.0% |
| **total** | **7,643** | | **32,360** | |

(Profiled runs, so the totals sit a little under the unprofiled 8,807 and
34,923; the split is what matters and it is internally consistent.
`WaterSystem.build` and `GrassSystem.build` do not appear because the proving
ground has neither — a map with water owes its own reading.)

**This table is the BEFORE and both bold rows have since been fixed.** S5b
bucketed the compound and S5c stopped the render-pass walk, so at 1500 m
`PhysicsWorld.setMap` is **181 ms** and `ReflectionSystem.build` **72**, against
`MapBuilder.build`'s 18,837 in the same run — 98.7% of a 19,117 ms install.
Quote the table for the RANKING that produced the two steps, never for what an
install costs today. And the water reading it says is owed now exists: it is in
the reflection section below, and it moved with the rest.

**Everything in `installMap` that is not those three is 27 ms at 1500 m.** All
the wiring — the six `setWorld` calls, the fog pushes, the leash, the ground
probe, the shadow casters, the culling — is free, and this closes the question
of whether any of it needed looking at.

### `PhysicsWorld.setMap` is O(boxes²), and it is the largest line at 1500 m — **FIXED, S5b**

| | collider boxes | ms | ms per box |
| --- | --- | --- | --- |
| 900 / 300 | 5,929 | 1,716 | 0.29 |
| 1500 / 0 | 16,526 | **13,402** | **0.81** |

2.79x the boxes costs **7.81x** the time — an exponent of 1.94, which is a
square with the rounding off. `buildWorld` adds one `PhysicsShapeBox` per box
into a single `PhysicsShapeContainer`, and the profile puts 13,244 of the
13,398 ms inside `addChild` rather than in the shape construction. Babylon's
`HavokPlugin.addChild` is one `HP_Shape_AddChild` per call, so the quadratic is
Havok rebuilding the compound's acceleration structure on every insert, and
there is no batch entry point through the plugin.

**`PhysicsWorld`'s own header already measured this and read it as flat.** It
says "rebuilding a 33-50 ms compound every time a window goes in is a hitch",
which is Coldharbour's 768 boxes. At 16,526 the same compound is 13.4 seconds
— 21.5x the boxes for ~300x the cost. The header's ARGUMENT is untouched (a
rebuild per broken pane is still the wrong trade); its NUMBER does not
generalise and should not be quoted at a large map.

Two shapes of fix, neither costed:

- **Bucket the compound.** One container per 48 m map block turns `n²` into
  `k(n/k)²`: 324 blocks at 1500/0 is ~51 boxes each, so 842k insert-units
  against 273M. It spends the argument at the top of `buildWorld` — one static
  body rather than 758 — but that argument is about the plugin's per-step sync
  walking BODIES, and 324 statics that bail out immediately is not 783 dynamic
  ones. It wants measuring, not assuming.
- **Move it off the load.** Nothing needs the static world until something
  falls on it, and the first ragdoll is many seconds after `deploy`. Building
  it on the far side of the loading card would take 13.4 s off the wait without
  touching the shape at all — and unlike a worker it needs no async window
  inside `installMap`, only a place to spend it. The header's "shapes at the
  moment of a kill is a hitch on the worst frame" still forbids doing it lazily
  at the first death.

**The first one landed and the second was not needed.** `PhysicsWorld` builds
one container and one static body per 48 m block, and the two builds above are
**268 ms and 682** — 6.4x and 19.7x, with the exponent going 1.94 → 0.89. The
bucket count is 420 and 1,023 rather than the 324 guessed here, because the
terrain patches carry blocks the boxes do not, and it is ~14 and ~16 boxes a
bucket rather than 51.

**The per-step body walk was the thing to measure and it costs nothing.** With
sixty-four bodies resting on the 1500 m ground a substep is 36/36 us with one
static body and 35/31 with 1,023, which is inside the scatter of the same
reading taken twice; the falling phase is ~18 us a substep dearer with
sixty-four bodies in contact at once. `ENGINE_UPGRADE.md` S5b has the whole
reading, and `plans/physics-ref/drop.mjs` is the oracle that came with it — the
answer to "a physics change has nothing to check it" this file had no entry
for.

### `ReflectionSystem.build` is doing nothing at all, 34.5 million times — **FIXED, S5c**

96% of it is probe CONSTRUCTION — `newProbe` → `ReflectionProbe` →
`RenderTargetTexture` → `ObjectRenderer` — and inside that, 5,058 of 5,272 ms
is `_releaseRenderPassId`. On a probe that has never had a render pass id.

```js
// Rendering/objectRenderer.js
_createRenderPassId() {
    this._releaseRenderPassId();              // <- _renderPassIds is EMPTY here
    for (let i = 0; i < this.options.numPasses; ++i) { ... }
}
_releaseRenderPassId() {
    for (let i = 0; i < this.options.numPasses; ++i) {
        this._engine.releaseRenderPassId(this._renderPassIds[i]);   // undefined
    }
}
// Engines/AbstractEngine/abstractEngine.renderPass.pure.js
releaseRenderPassId = function (id) {
    this._renderPassNames[id] = undefined;
    for (const scene of this.scenes)
        for (const mesh of scene.meshes) {          // <- EVERY MESH
            mesh._releaseRenderPassId(id);
            for (const subMesh of mesh.subMeshes) subMesh._removeDrawWrapper(id);
        }
};
```

A cube probe is six passes, so **every probe constructed walks the entire scene
six times to release six `undefined` ids**. At 900/300 that is a confirmed 265
probes x 6 x 9,002 meshes = **14.3 million mesh visits** for 1,075 ms; at
1500/0, on wall 5's count of 770 probes (carried forward, not re-measured this
session) x 6 x 23,014 = **106 million** for 5,272 ms. The ratio of the work is
7.4x and of the time 4.9x, which is as close as a per-submesh inner loop gets.
**Both of those figures are wrong and S5c re-measured them** — see the fix
below: the count at 1500/0 is 250 probes and not 770, so the visits are 34.5
million, and the work grows 2.41x between the extents where the time grows
5.05x. The direction is the opposite of what this paragraph reads off the
carried-forward count.

**It is priced on map AREA twice over** — more glazed blocks and more meshes to
walk per block — which makes it a wall-1-shaped cost hiding in the load rather
than in the frame, and it is entirely waste: nothing is released because nothing
was ever allocated.

The lever is the multiplier, since the loop is Babylon's. The probes are POOLED
and survive a rebuild, so this is a first-install cost, and it is paid when
`scene.meshes` is at its longest — right after `MapBuilder.build`. Growing the
pool while the scene is SHORT would remove most of it: `installMap` disposes the
old map on its first line, and between there and the build the scene is ~1,020
meshes rather than 23,014, which is a 22x cut. What stands in the way is that
the probe count is not known until the map is built.

**The other shape landed instead and it takes the walk to nothing rather than
to a 22nd.** `ReflectionSystem.newProbe` hands `scene.meshes` an empty array
for the length of the `new ReflectionProbe(...)` call and puts the real one
back in a `finally`. Both pools mint through that one method, so the water half
below is covered by construction rather than by remembering to cover it.

| `ReflectionSystem.build` | probes x scene meshes | before | after | |
| --- | --- | --- | --- | --- |
| Coldharbour | 40 x 2,213 | 41 ms | **5 ms** | |
| 900 / 300 | 265 x 9,002 | 1,298 ms | **38 ms** | 34x |
| 1500 / 0 | 250 x 23,014 | 6,551 ms | **72 ms** | 91x |

`installMap` goes 7,510 ms to **6,099** and 24,876 to **19,117**, matched pairs
through the instrument at the top of this finding. The water pool moves with it
— Hollowmere's three probes 6.4 ms to 1.1, Greyfen's one 4.6 to 0.5,
Harrowmead's one 4.2 to 0.7 — which is the fourth line this finding said the
proving ground could not show.

**Two numbers above this section were wrong and the pair of extents is what
found them.** The probe count at 1500/0 is **250**, not the 770 carried forward
from wall 5: `poolBudgetMiB` caps the pool at 320, so 1,153 glazing groups come
back at `perCell` 2 — the first map in the tree where the grouping is not 1. And
2.41x the mesh visits between the two extents cost **5.05x** the time, 91 ns a
visit against 190, because the inner loop walks submeshes and the outer walks a
23,014-entry array rather than a 9,002-entry one. **A per-visit rate taken on
the smaller ground understates the larger by half**, which is finding 18's
0.67 us against finding 19's 1.10 us in a different file.

**What makes the swap safe is two facts and one of them is enforced.** No frame
renders inside `installMap`, and probe construction creates no mesh; the
`finally` moves anything that did arrive back into the real list and logs a DEV
error naming the site, because `Scene.addMesh` pushes into whatever
`scene.meshes` is at the time. `ENGINE_UPGRADE.md` S5c has the verification —
the `[reflection]` line identical in every field on all five maps, `bank.mjs
--check` byte-identical before and after over all fifteen shots, `gate.mjs`
clean.

### What this says about S5

**The worker is now third, and these two are S5b and S5c.** What S5 would move
to a worker is 5,733 ms; the physics compound is 13,402 and the reflection
probes 5,272, and both are single sites with no async window to open inside
`installMap` and no server path to keep in step. (S5b has since landed, so the
compound is 682 ms and the worker is second rather than third — the ranking
below is the one that produced the order, not the one that holds today.)

**The worker is gated on S5b rather than merely ranked behind it**, which is the
non-obvious part. `installMap` runs build → physics → probes, so today a
`MapBuilder.build` that returned with the nav work OUTSTANDING would hide the
whole 3,542 ms nav lane behind the 13,402 ms compound for nothing — no second
lane, no restructuring. Take S5b first and that hiding place is gone, and the
worker has to overlap the MERGES instead (3,542 against 3,715 ms), which needs
`build` split in two. So the worker is cheaper before S5b and dearer after, and
`ENGINE_UPGRADE.md` S5 holds it unpromoted until S5b says which.

### What is open

- **`MapBuilder.build` is now 98.5% of the install** — 18,853 ms of 19,147 at
  1500 m, with the other two sites at 185 and 79 between them. Wall 4 is the
  build and nothing else. **The phase split was re-taken on the same tree** and
  is under finding 24's last open thread: the placement loop is 10,092 ms and
  53.5%, and **what it is made of has not been profiled since finding 24
  changed what it does**. That is the next measurement, and
  `ENGINE_UPGRADE.md` S5 holds the worker unpromoted until it exists.
- **The collider thread is BLOCKED, not merely uncosted**, which finding 24's
  own first bullet says and which is easy to read past when ranking by size:
  `moveWithCollisions` walks `mesh.subMeshes` and a part has none, so a collider
  built as a part stops nothing, SILENTLY. No oracle in this tree catches that
  as a build change — the per-mesh hash would pass and `npm run parity` does not
  see physics. Anything taking it owes a test that a body still stops.
- **A probe pool grown while the scene is SHORT was never costed and no longer
  needs to be.** It was the first shape offered here and the swap took the walk
  to nothing rather than to a 22nd of it, so the estimate-off-the-layout problem
  it opened is moot unless something else wants the probe count early.
- **`perCell` is 2 at 1500 m, which is the first live grouping in the tree** and
  means a probe there drops 96 m of city out of the middle of its own cube (the
  enclosure rule — see `docs/rendering.md`). Nobody has looked at what that
  costs the PICTURE, because the proving ground is not a map anyone plays. A
  1500 m map that ships glazing owes that reading.

---

## 26. The placement loop is one mechanism, not a thousand milliseconds: a part is built as a full `Mesh`, registered, given a uniform buffer and a GUID, tessellated from scratch, merged, and destroyed

**Asked because finding 25 left 53.5% of the build unattributed.** After S5b and
S5c, `installMap` at 1500/0 is 19,147 ms of which `MapBuilder.build` is 18,853,
and the placement loop is 10,092 of that. Finding 24 changed what that loop DOES
— it is no longer allocating three million GPU buffers — and nobody had looked
at what it is now made of. `ENGINE_UPGRADE.md` S5 was holding the worker
unpromoted on exactly this measurement.

### The instrument

A CDP `Profiler` capture at a 200 us sampling interval over the whole install,
attributed by subtree. Same instrument findings 24 and 25 used, and the same
caveat: it is a PROFILED run, so `build:total` reads 15,867 ms against the
unprofiled 18,853 and the placement phase 8,274 against 10,092. **Read the
shares, not the absolutes** — the split is internally consistent and that is
what this finding is about.

### What the loop is made of

The direct children of `MapBuilder.build` that are the loop (the rest of the
build's phases are behind `buildProfile`'s `record`, and the scatter phase is
its own):

| in the placement loop | ms | share of the loop |
| --- | --- | --- |
| `buildTower` | 2,270 | 27% |
| `mergeByMaterial` | 1,346 | 16% |
| `paneGroup` | 1,319 | 16% |
| `buildShophouse` | 626 | 8% |
| `collider` | 493 | 6% |
| `buildDepot` | 338 | 4% |
| `buildOffice` | 230 | 3% |
| `struts` | 209 | 3% |
| `buildRoad` | 155 | 2% |
| **named together** | **6,986** | **84%** |

**The builders are 3,619 ms and they are all one function.** `buildTower` is
89.7% `glaze`, `glaze` is 85.7% `cut`, and `cut` is two lambdas that do nothing
but call `Build.pane` — 1,744 ms of the tower is panes. Every builder bottoms
out in `partBox`, and aggregated over the whole install that is **3,465 ms,
18.5%**, in two almost equal halves:

| `partBox` splits in two | ms over the whole install | share |
| --- | --- | --- |
| `CreateBoxVertexData` — tessellating a fresh unit box | 1,986 | 10.6% |
| `partSurface` — constructing the `Mesh` | 1,657 | 8.8% |

**Neither half is doing anything a merged mesh needs.** `CreateBoxVertexData`
is 94% one anonymous loop in Babylon, and it is the same 24 positions, 24
normals, 24 UVs and 36 indices every time — a unit cube, rebuilt per part,
differing only by a scale and an offset. That is finding 24's third open thread,
which was 656 ms at 900/300 and is **three times that at 1500 m**. And
`partSurface` is Babylon's `Mesh` constructor: **43% of it is
`_buildUniformLayout`** — a per-mesh uniform buffer, for a mesh that will never
be drawn — and **16% is `RandomGUID`**.

**And 46% of the merge is DESTROYING what the loop just built.** `MergeMeshes`
aggregates to **3,834 ms, 20.5%** of the install — the largest single name in
the profile — and inside `_MergeMeshesCoroutine` the `dispose` of the source
meshes is 584 of 1,277 ms on the pane merge. What that dispose is made of is the
tell: `Scene.removeMesh`'s array scan (128 ms), the uniform buffer's own
`dispose` (120 ms) and `freeRenderingGroups` (72 ms) — the exact three things
`partSurface` paid to create. The real merge work under it is 355 ms of
`setVerticesData`, 162 of reading the vertex data back and 151 of
`_mergeCoroutine`.

### The shape, which is the finding

**A part exists only to be merged, and the loop pays full `Mesh` price twice
for it — once to construct it and once to tear it down.** Registered in the
scene, given a uniform buffer, given a GUID, tessellated from scratch, read back
out, and then unregistered, its buffer disposed and its rendering group freed.
Roughly **76% of the placement loop is that round trip**, and the geometry it is
around is a box.

**This is the same shape finding 24 fixed, one layer down.** The flatten stopped
the GPU half of the round trip — `device.createBuffer` for geometry no frame
draws. The CPU half was never touched, and at 1500 m it is bigger than the GPU
half ever was at 900. `src/world/parts.ts` is already the module that knows a
part is not a real mesh; what it does not yet do is let one avoid BEING one.

**So the answer to `ENGINE_UPGRADE.md` S5's question is that the loop is a
single mechanism and not spread cost**, and it is worth more than the worker:
~6.3 s of the loop against the worker's 3,899 ms ceiling, synchronously, with no
async window opened inside `installMap` and no `build` split into two lanes.

### What is open

- **Nothing here is a fix and none of it is costed.** Three sub-threads fall
  out, in the order their size suggests: never construct a `Mesh` for a part
  that is going to be merged (accumulate `VertexData` and merge the arrays);
  share one unit-box tessellation across every box part; and stop paying
  `RandomGUID` per part. The first subsumes the other two and is a real design
  change rather than a local one.
- **`parts.ts` exists because some parts must stay real meshes**, and that is
  the constraint any fix has to respect: `uploadPart` puts a part back on the
  normal path on the three ways out of a merge that KEEP their source, and an
  editor build keeps every placement unmerged. A merge-only path has to be a
  second path, not a replacement.
- **The oracle already exists and this change must not move a vertex.** Finding
  24's per-mesh hash — name, material, metadata, transform, flags, counts and
  every vertex buffer, over all five maps — is the instrument, and
  `plans/physics-ref/drop.mjs` covers anything that changes what a body stands
  on.
- **The collider half is BLOCKED and this does not unblock it.** `boxMesh`
  aggregates to 669 ms at 1500/0 (finding 24 measured ~430 at 900/300), but
  `moveWithCollisions` walks `mesh.subMeshes` and a part has none — see finding
  24's first open thread. A collider is not a merge candidate, so the mechanism
  above does not reach it.
- **The AO bake is now the second-largest named cost** — `occlusionAt` is
  1,738 ms subtree and 1,399 self, 9.3% — and it is not in the placement loop at
  all. It has never been questioned; `segmentHitsBox` under it is another
  1,021 ms of self time.
- **The garbage collector is 2,121 ms, 11.3% of the install**, which is the
  allocation pressure of everything above rather than a site of its own. It
  should fall with the round trip; if it does not, it is its own finding.

---

## 27. The 1500 m FRAME is 9.3 ms and the wall it was supposed to hit is gone — but the bake now drains in the ROUND, and that is 37 seconds at one frame a second — **the drain is CLOSED by 28**

**Asked because nobody had quoted a 1500 m frame since S0**, which measured
30.3 ms with `ReflectionSystem.build` stubbed to a no-op and before S1, S2, S3,
S0b, S5b and S5c had any of them landed. Every ordering decision since has been
about the LOAD, on the unexamined assumption that the frame was in hand. It is —
and asking the question turned up something larger than anything left in the
load.

### The frame, which is fine

Uncapped (`--disable-frame-rate-limit --disable-gpu-vsync`), 1920x1080,
headless via `channel: "chromium"`, warmed **on the reflection queue draining
and not on a timer** — see the drain below, and `VERIFYING.md`, which is
explicit that a wall-clock warm on this map reports the bake as the round:

| proving 1500 / 0 | |
| --- | --- |
| scene meshes | 23,031 |
| active meshes | **146** |
| cold (5 s) | 102.5 fps, 9.8 ms |
| warm (8 s) | **107.4 fps, 9.3 ms** |

**S0's 30.3 ms frame is 9.3, and 23.0 ms of it was wall 1.** 146 active meshes
out of 23,031 is `WorldCulling` doing exactly what S1 built it to do at an
extent S1 never measured. **Wall 1 is down at 1500 m**, not merely mostly down,
and this retires the projection that S8 would be needed to finish it — S8 is
about what a map you cannot fog LOOKS like, which is a different question from
what it costs.

Read this as a QUIET round: the player is spawned and nothing is in contact.
Finding 22 measured zero rays fired in eight seconds with sixteen bots alive, so
a fight has to be forced and this reading does not include one. Wall 2 is down,
so the expectation is that it changes little, but it has not been measured.

### The drain, which is not fine

`installMap` returns in ~19 s and the state goes to `deploy` with **211 probes
still queued and 1,782,504 face draws outstanding**. What happens next:

| the bake draining at 1500 / 0 | |
| --- | --- |
| frames | **40** |
| wall clock | **36.9 s** |
| median frame | **928 ms** |
| worst frame | 1,505 ms |
| first ten frames, ms | 931, 975, 932, 871, 909, 931, 822, 809, 1271, 906 |

**So a 1500 m map runs at about one frame a second for its first thirty-seven
seconds, and it does it in the ROUND rather than behind the loading card.**
That is six times the mesh round trip (finding 26, ~6.3 s) and nine times the
worker's whole ceiling (3,899 ms), and unlike either it is not hidden — the
deploy screen and then the round are what the player is looking at while it
happens.

**This is not a new mechanism and it is not a regression.** It is the price of
S0b, which is the step that took wall 5 down: `drawsPerFrame` converts one
fatal submission into a queue, and the trade is correct — the alternative
measured is a lost D3D12 device and a replaced renderer process.
`ENGINE_UPGRADE.md` S0b's own owed list says both halves of this out loud —
"**1500 / 0 has not been re-tested**" and "**the bake still lands AFTER the
loading card, not behind it**" — and estimates ~26 s at 900/300.
`VERIFYING.md` records the 900/300 version (21 s, 24 frames, 894 ms median)
but only as a trap for measurement scripts. **What nobody had written down is
that it means the map is unplayable for half a minute.**

**A bake draw is 18.6 us and nobody knows why.** 50,000 draws at ~928 ms is
three times the ~6.3 us `VERIFYING.md` measures for a mesh draw carrying a
material switch, and eight times the ~2.3 us for an outline shell reusing a
bound material. A first bake creates a draw wrapper per (mesh, render pass id)
and six of those per probe, so bind-group creation is the obvious suspect — but
it is a suspect and not a measurement.

### The measurement note that cost this finding its profile

**The drain cannot be CPU-profiled with the sampling profiler.** A CDP
`Profiler` capture at a 500 us interval over the drain ran past **twenty
minutes** against an unprofiled 37 seconds — a frame issuing 50,000 draws is a
deep stack sampled two thousand times a second — and was killed rather than
waited out. The figures above are all from unprofiled runs. Anything that wants
the 18.6 us broken down needs a different instrument: a GPU capture, or
`drawsPerFrame` turned down far enough that a frame is samplable and the
per-draw cost read off the slope.

### What is open

- ~~**Where the 37 s should be spent is a state-machine question and S0b named
  it.**~~ **CLOSED by 28.** `Game.bakeWait` holds `loading` until the queue and
  the in-flight re-bakes are both empty, and hands the card a progress figure
  while it does. Nothing is in the round.
- ~~**The bake and the FRAME have never been asked the same question, and that
  is the disproportion.**~~ **CLOSED by 28, and the answer was not the one this
  entry expected.** The frame's 146 is mostly the FRUSTUM, not the block gate —
  the proving ground states a `fogEnd` of 2400, past its own diagonal, so
  `WorldCulling` culls no block on it at all. What a cube probe was missing was
  the frustum test itself: `ObjectRenderer` dispatches every mesh of a render
  list on every one of six faces, with no `isInFrustum` anywhere.
  `ReflectionSystem.faceOf` is that test, and it removed 81% of the draws.
- **`perCell` is 2 here and grouping harder makes the picture worse, not just
  the count.** A probe drops every block it SERVES out of its own bake
  (`encloses`), so a cell of four blocks is a probe with 96 m of city missing
  from the middle of its cube. The probe count is not a free lever. **Still
  true and now moot**: after the per-face cull there is nothing left for it to
  buy.
- **What a bake draw costs is unexplained**, and it is the term that multiplies
  everything above.
- **A fight has not been measured at 1500 m.** The frame reading is a quiet
  round.
- **The proving ground's glazing is a generated worst case.** 1,153 glazing
  groups over a city-block grid; a real 1500 m map may glaze far less, and S11
  is deliberately last so that the engine is not tuned against content that does
  not exist. The SHAPE is not a worst case — the bake is priced on glazing and
  `docs/rendering.md` says glazing has no natural bound.

---

## 28. The bake was drawing the whole neighbourhood six times: a cube probe has no frustum culling, and 81% of every bake was clipped geometry

**Asked because finding 27 put 37 seconds of one-frame-a-second in the
player's hands** and `ENGINE_UPGRADE.md` S0c named three levers for it. Two
were taken. The first moves the cost; the second turned out to remove most of
it, and for a reason the step had guessed at from the wrong end.

### The matched pairs

Windows box, RTX 4070 Ti SUPER, headless via `channel: "chromium"`, 1920x1080,
uncapped, UNPROFILED — finding 27 records that the sampling profiler stretches
this past twenty minutes. The drain is counted from the first frame that begins
with a probe outstanding to the first that begins with none, which includes the
in-flight re-bakes and is therefore a slightly longer window than finding 27's
40 frames.

| | 900/300 before | 900/300 after | 1500/0 before | 1500/0 after |
| --- | --- | --- | --- | --- |
| spent in | `deploy` | **`loading`** | `deploy` | **`loading`** |
| frames | 31 | 31 | 47 | 47 |
| wall clock | 24.9 s | **5.7 s** | **44.8 s** | **10.6 s** |
| median frame | 838 ms | **181 ms** | 931 ms | **197 ms** |
| worst frame | 1,141 ms | 382 ms | 1,697 ms | 1,217 ms |
| probes | 265 | 265 | 250 | 250 |
| warm frame after | 4.54 ms | 4.53 ms | 9.08 ms | 9.50 ms |

**In the round it is 44.8 s to nothing.** The frame COUNT is identical either
side and that is by design: the queue is still priced at `list.length * 6`, so
the same number of batches is released and each one merely issues far fewer
draws. `drawsPerFrame` is what stands between this bake and a lost D3D12 device
inside one submission, and letting a saving in draws turn into a bigger
submission would have spent it on exactly the wrong thing.

### The finding under the finding

**A cube render target does not frustum-cull, and nothing in the tree knew
it.** `ObjectRenderer._prepareRenderingManager` walks the render list and
dispatches every mesh in it — readiness, LOD, `_activate`, a draw per submesh —
with no `isInFrustum` anywhere, because a render list is normally something the
caller has already chosen. `RenderTargetTexture._render` then calls it once per
face. So a probe drew its whole 1,348-mesh neighbourhood **six times**, once
for each 90-degree view, where the main pass draws each mesh at most once.

Measured over a whole install, by wrapping the hook:

| meshes dispatched per install | offered | issued | removed |
| --- | --- | --- | --- |
| 900/300 | 1,469,484 | **284,097** | 80.7% |
| 1500/0 | 2,120,976 | **394,604** | 81.4% |

(`offered` exceeds the queue's own figure because a probe that re-bakes offers
its list again.) The six faces tile the sphere exactly, so the floor is 1/6 —
17% — and the measured 19% is that plus the conservatism of a bounding-SPHERE
test at a face boundary. The world being a thin slab is what makes the two poles
nearly free.

**S0c guessed at this from the wrong end and the guess is worth recording**,
because the next person will make it too. It read the frame's 146 active meshes
out of 23,031 as `WorldCulling` filing per 48 m block and gating on `fogEnd`,
and proposed giving a probe the same treatment. But the proving ground declares
a `fogEnd` of 2400, past its own 2121 m diagonal, deliberately — so
`WorldCulling` culls **no block on it at all**, and the frame's 146 is almost
entirely the FRUSTUM. The disproportion between the bake and the frame was real
and the mechanism behind it was the opposite of the one named.

### Why this one cannot move a pixel, and the proof

It is `AbstractMesh.isInFrustum` against `scene.frustumPlanes` — the same call
`_evaluateActiveMeshes` makes for the main pass, at the default
`CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY`, which is the conservative one. What it
drops is what the rasteriser was about to clip. The ordering that makes the
planes the FACE's rather than the main camera's is Babylon's own:
`ReflectionProbe` writes the face's view and projection through
`scene.setTransformMatrix` from `onBeforeRenderObservable`, that setter
refreshes the planes, and `ObjectRenderer.render` fires the observable
immediately before it calls `_prepareRenderingManager`. A Babylon version that
moved either line would cull each face against the previous one's planes, and
the tell is a seam of missing geometry that rotates with the probe.

**Proved rather than argued.** `bank.mjs --check` run either side of the change
against the same fixed reference reports the SAME mean on all sixteen banked
vantages of all four shipped maps, to four decimal places — including
Coldharbour's three curtain-wall vantages and the avenue, which are the frames
that exist to catch exactly this. The bank itself is still red from the drift
S0b recorded, so a pass was never available; identical-either-side is the
stronger statement and it is the one that was taken.

That property is why this is preferable to every other way of shortening a
probe's list. A smaller `radius` drops geometry the face WOULD have drawn and
leaves a hole the shader fills with sky (finding 10's objection). A coarser
`perCell` drops a whole building out of the middle of a cube. This drops
nothing that would have been seen.

### What the state-machine half cost

Holding `loading` until the bake drains is `Game.bakeWait`, and it needed no
new machinery — `releaseBatch` already rides a render observable, `loading`
already renders and already simulates nothing. What it did need was three
corrections nobody had to make while the state lasted two frames:

- **`loading` stopped being the same question as "the build has not run
  yet".** Three guards read the state to mean the second. With the card up
  through a ten-second drain, `NetSession.onSeated` would have deferred a map
  rotation or a team correction to a `buildRound` that already happened and
  dropped it on the floor. `Game.buildPending` is now `loading && bakeWait ===
  null`.
- **A wait can outlive its own round.** `Game.go` clears it, so stepping away
  from the card cannot leave a `finishBakeWait` to open a deploy screen over
  whatever replaced it.
- **A queue that cannot drain must not hang the card**, and the state machine
  has no concept of a step that fails. Two caps: a stalled outstanding count
  (`drainStallFrames`, 120), which is the only thing that can tell a wedged
  re-bake from a slow machine, and a backstop clock (`drainCapMs`, 90,000) for
  a bake that inches forward forever, which no stall counter catches. Either
  gives up and lets the remainder land in the round as before.

Coldharbour is one frame of `loading` and nothing else moved: `installMs` 1,097
→ 1,865 with `bakeFrameMs` 889 → 5, which is the same frame in a different
state. `gate.mjs` is clean on all four maps.

### What is open

- **The worst frame is still 1,217 ms at 1500 m**, against a 197 ms median. It
  is the first batch and it is a queue-shaping question rather than a
  draw-count one: `releaseBatch` lets one probe through however fat it is on an
  otherwise empty frame, by design, or a queue with a fat head could never
  drain. A budget that could be spent as "one probe's worth of FACES" rather
  than one probe would smooth it; nothing has tried.
- **What a bake draw costs is still unexplained.** Finding 27 measured 18.6 us
  and suspected bind-group creation. This finding does not settle it — it
  removed draws rather than making one cheaper — and the per-draw figure now
  implied is of the same order.
- **The 1500 m install is still ~26 s before the drain starts.** That is
  findings 24, 25 and 26's territory and this step did not touch it; it is now
  the largest single number in a 1500 m load.
- **Nothing has looked at the PICTURE on the proving ground**, which is S0b's
  owed item and survives all of this. The bank can only say the four shipped
  maps are unmoved.

---

## 29. The 48 m merge block is worth a third of the 1500 m frame and two fifths of its install — **the lever is LANDED (S6), the value is nobody's yet**

**Asked because S6 said to make the block size the map's, and a mechanism with
no number beside it is a lever nobody knows whether to pull.** The step's own
argument was about mesh COUNTS at 1500 m — 1,024 blocks at 48 m against 256 at
96 and 144 at 128 — and counts are the thing wall 1 was measured in before S1
took the walk down. What is left is the DRAW phase, which nothing had priced
against this axis.

### What was measured

The committed 900/300 proving ground, uncapped
(`--disable-frame-rate-limit --disable-gpu-vsync`), 1920x1080, headless via
`channel: "chromium"`, one page per row, 10 s warm and an 8 s window. A quiet
round: the player is spawned and nothing is in contact. The two fields are set
on the layout in the page before `startRound`.

| merge / terrain | install | warm | frame | scene meshes | active | drawn map meshes | glazed blocks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **48 / 48** | 10,973 ms | 74.3 fps | **13.5 ms** | 9,002 | 442 | 1,597 | 265 |
| **96 / 96** | 6,719 ms | 103.0 fps | **9.7 ms** | 7,757 | 222 | 653 | 93 |
| **128 / 96** | 6,404 ms | 110.9 fps | **9.0 ms** | 7,610 | 184 | 506 | 61 |

**33% of the frame and 42% of the install**, both far past the 8% the
measurement protocol says to read as real, and both monotonic across three
points rather than a single pair.

The same three cuts on the two big shipped maps, for the independence check
rather than for a frame:

| | Coldharbour 48/48 | 96/48 | 48/96 | Harrowmead 48/48 | 96/48 | 48/96 |
| --- | --- | --- | --- | --- | --- | --- |
| populated blocks | 45 | **16** | 45 | 44 | **16** | 44 |
| floor meshes | 49 | 49 | **16** | 97 | 97 | **37** |
| drawn map meshes | 301 | 201 | 268 | 432 | 306 | 372 |
| glazing groups orphaned by the merge | 0 | 0 | 0 | — | — | — |
| collider boxes / nav surfaces | 768 / 72,230 | same | same | 748 / 72,876 | same | same |

### What it means

**The frame is the draw phase and not the walk.** `WorldCulling` offers 442 of
9,002 meshes at 48 m, so wall 1 is not what moves here; what moves is 1,597
drawn map meshes becoming 506, each of which is a draw and an outline shell.
Finding 18's own note applies — an outline shell reusing a bound material is
~2.3 us and a mesh draw carrying a material switch ~6.3 — so a count is not a
prediction, which is why this was measured rather than derived.

**The install is a lever on wall 5 that wall 5 did not have.** The reflection
bake is one cube per GLAZED BLOCK, and a wider block is fewer of them by
construction: 265 becomes 61. This is the honest form of what `blocksPerCell`
does under duress — that one groups four blocks onto one probe and the probe
then has 96 m of city missing from the middle of its own cube, while a wider
block is a probe whose `encloses` still drops exactly the block it serves and
nothing else.

**The two axes really are independent**, which is the part the step insisted on
and the middle table is the proof: `blockSize` alone never moves a floor mesh
and `terrainBlock` alone never moves a block. Neither moves a collider box or a
nav surface on any map, at any size.

### What is open

- **Nobody has looked at the PICTURE.** The whole cost of a wider block is cull
  granularity — a block is offered while the camera is inside `reach` of its
  bounds, so a 128 m block draws more that is off screen — and on this map the
  draw-call saving swamped it. On a map with long sightlines and heavy
  per-pixel work it might not. `bank.mjs` can only say the four shipped maps are
  unmoved, which they are by construction: none of them states either field.
- **Nothing here is a fight.** Finding 22 measured a round left to itself firing
  no ray at all, and this is that kind of round. Wall 2 is down and the merge
  block is invisible to `RayWorld`, so the expectation is that a fight changes
  nothing about the SHAPE of this table, but it has not been measured.
- **The proving ground still builds at 48 / 48** and should probably keep doing
  so, because it is the load every figure in `ENGINE_UPGRADE.md` was taken
  against. What wants a value is the desert city (S11), and what should decide
  it is a real layout rather than a generated grid.
- **Larger merged buffers were not measured.** 128 m blocks are ~7x the
  vertices per mesh, which is memory and a coarser bounding box; neither was
  looked at, and neither showed up as a cost in the frame.

---

## 30. The rigs are the largest thing in a 900 m frame, and the frustum hides that until you look down an avenue

**Status:** measured on the Windows box, landed. **This is `ENGINE_UPGRADE.md`
S8's engine half** — `EnvironmentSpec.bodyDrawDistance`, a body draw distance a
map may state ahead of its fog — and it prices the lever S8 named and did not
cost.

S8 claimed that on a map you cannot fog the three body gates
(`BattleSystem.viewDistance`, `NetRoster`'s, `RagdollSystem`'s) stop gating and
"the rigs are now the largest bucket in the frame". Both halves are true, and
the second one is invisible in the reading anyone would take first.

### The instrument, and the lever

Proving ground 900/300 (`fogEnd: 2400`, past its own 2121 m diagonal, so the
three gates gate nothing), Windows box (RTX 4070 Ti SUPER), headless Chromium
via `channel: "chromium"`, `--disable-frame-rate-limit --disable-gpu-vsync`,
1920x1080, `spawnPlayer()`, warm 12 s past the compile stall, medians over 8 s.
Findings 17-21's protocol, so the numbers sit beside theirs — and the quiet
round below reproduces finding 21's 4.80 ms frame to the second decimal, which
is what says it is the same instrument.

**One process, one lever: `battle.setViewDistance` and the ragdoll gate beside
it, arms interleaved fog/wall/fog/wall.** The field itself is not stated by any
map in the tree; the arms are the two values it would resolve to.

### A quiet round says almost nothing, and that is the finding under the finding

| 900/300, quiet | frames/8 s | median ms | `_evaluateActiveMeshes` | active meshes | rig meshes active | rigs on |
| --- | --- | --- | --- | --- | --- | --- |
| fog 2400 | 1,607 / 1,664 | 4.8 / 4.7 | 2.96 / 2.85 | 121 | **0** | 15 |
| wall 550 | 1,779 / 1,548 | 4.3 / 4.5 | 2.50 / 2.75 | 121 | **0** | 7 |

**Zero rig meshes reach the active list either way.** The bots are spread across
the play square and the FRUSTUM is already dropping every one of them, so the
lever buys only the walk — 160 rig meshes going from enabled (world matrix
recomputed, frustum tested) to disabled (an early out). The frame delta is
**−7.4%, under the 8% floor**, and must not be quoted as a win. The walk's is
−10%.

A first run of the same arms read −16% on the frame; the four-arm interleave
above is what corrected it. **The quiet-round number is noise and the honest
reading is "nothing measurable".**

### With the roster in view it is a quarter of the frame

The case S8 is about is a 900 m sight line with bodies down it, which a 240 m
map does not have. Sixteen rigs stood 120-900 m ahead of the camera, splayed a
few degrees each side, re-stood every frame on the drawn ground:

| 900/300, roster in view | median ms | `_evaluateActiveMeshes` | active meshes | rig meshes active | rigs on |
| --- | --- | --- | --- | --- | --- |
| fog 2400 | **9.2 / 9.1** | 3.89 / 3.90 | 441 | **288** | 15 |
| wall 550 | **6.6 / 6.6** | 2.95 / 2.98 | 307 | **154** | 8 |
| | **−28%** | **−24%** | **−30%** | | |

**65% of the frame's active meshes are soldiers** (288 of 441), and the whole of
the 134-mesh delta is rigs — nothing else moved, because nothing else was
levered. Both repeats agree to 0.1 ms, so this is 3.5x the 8% floor and not a
drift.

**The frame delta is 2.55 ms over 134 meshes, or ~19 us each, which is far more
than a mesh draw.** Finding 18 measures ~6.3 us for a draw carrying a material
switch and ~2.3 for an outline shell on a bound material; the walk accounts for
~0.94. So a rig mesh is being paid for more than once a frame — the outline
shell and the glow accumulation are the obvious suspects and neither has been
isolated. **That is a suspect, not a measurement.**

### What landed

`EnvironmentSpec.bodyDrawDistance`, resolved once by `bodyDrawDistanceOf` and
pushed by `installMap` to all three body gates together. Verified end to end on
Hollowmere by mutating the environment and rebuilding: absent → 78 (both gates),
40 → 40, 5000 → 78 with the DEV warning, absent again → 78, and
`WorldCulling`'s reach 105 m throughout all four.

**No map in the tree states one**, so nothing shipped changed — which is also
why `bank.mjs` has nothing to say about this and was not run.

**`WorldCulling`'s reach deliberately stayed `fogEnd`.** The block cull is exact
only because a structure past the fog draws `fogColor` in front of ground that
draws `fogColor`. A body dropped early POPS, and that is a trade a map author
takes knowingly; a building dropped early pops out of a skyline being looked at.

### The other half: the shadow window's ceiling is now checked

`ShadowSystem.setShadowWindow` DEV-warns when the window is past what
`depthRange` can carry at the map's own key-light elevation
(`2 * halfDepth / cos(elevation)`, halfDepth 89 m). Past that the along-sun
reach does not move and the extra is texel density spent for nothing — and
there is no feedback at all, because the line the author is trying to push out
stays exactly where it was on that axis.

**The four shipped maps are the evidence the ceiling is right, and none of them
trips it**: Harrowmead states 185 against 183.8 at 14.5 degrees and Coldharbour
200 against 194.9 at 24 — both authored by eye to within a couple of metres of a
number neither file names. Greyfen (140 of 201.6), Hollowmere (110 of 226.5) and
the proving ground (200 of 433, near-overhead noon) are well inside. Verified
silent on all five with a round installed, and verified to FIRE at 400 m.

### What is open

- **What the ~19 us per rig mesh is made of.** The frame saving is three times
  what a draw costs and twice what a draw plus the walk costs. Until it is
  broken down, the 2.55 ms is a measurement whose mechanism is a guess.
- **No map states the field, so it has never run in anger.** What a body popping
  at 550 m on a clear map LOOKS like is unjudged — there is no map to judge it
  on until S11, which is exactly why the field defaults to the fog.
- **A fade was not built.** The gate is a hard on/off, as `lodDisableDistance`
  always was, and it was invisible only because it sat where everything was
  already `fogColor`. If a stated `bodyDrawDistance` reads badly, a short fade
  band is the obvious next thing and nothing here has costed one.
- ~~**The rigs are still `loose` candidates whether they are drawn or not.**~~
  **CLOSED for the rigs.** `WorldCulling` has a fourth class — pooled — and
  `Game.installBodyPools` files both rosters' rigs under the root the LOD
  already switches, so a body that is not in the round is offered to nothing.
  On Sarab at 24 a side that is **candidates 2,299 → 1,690 (−26.5%), the walk
  2.75 → 2.42 ms (−11.9%) and the frame −4.4%**, with draw calls and active
  meshes identical in every block — it takes the walk and never the draw, which
  is the half this thread was about. **Finding 21's ~750 idle effect meshes are
  still open** and can now take the same door.

---

## 31. The authority's tick is priced on ARMOUR and not on the map — 1500 m is the CHEAPEST tick in the tree, and the instrument that says so had been dead since the WebGPU port — **its two sweep threads are CLOSED by 35**

**Status:** measured on the Windows box, landed. **This is `ENGINE_UPGRADE.md`
S9** — the authority at 1500 m — and it is the first step in that document whose
budget is a TICK rather than a frame.

Three things came out of it, in the order they had to: the instrument was broken
and every match server with it, the tick holds at 1500 m by three orders of
magnitude, and the one term that does grow with map area is the one nobody was
looking at.

### The instrument was dead, and so was every match server

`npm run simulate` crashed on every map before it printed a line:

```
The plugin "CelEmissiveFog" can't be added to the material "emissive-#ffe680"
because the plugin is not compatible with the shader language of the material.
```

`EmissiveFogPlugin.isCompatible` answers WGSL and only WGSL — deliberately, and
correctly: there is no GLSL path left in the tree. But
`Material._createUniformBuffer` picks WGSL for a `StandardMaterial` only when
`engine.isWebGPU`, and the authority runs under `NullEngine`, which is not. So
the pair threw inside `CombatSystem`'s constructor — which builds its tracer pool
out of `getEmissive("#ffe680")` — which is to say inside `new HeadlessGame()`.

**That is not a tooling bug. `Match.game` is `new HeadlessGame()` and a `Match`
is built when the first person joins**, so a match server booted, printed
`greywatch server on :8080`, and died on the first join. Every build since the
WebGPU migration. Nothing noticed, because the process starts perfectly and
`npm run simulate` was the only thing that would ever have said otherwise.

The fix is one line in `attachEmissiveFog`: skip the plugin when the engine is
not WebGPU. It is a per-pixel fade over an unlit colour, the authority draws no
pixels, and it builds these materials only because it runs the same pooled
systems a client does.

### The tick, on every map in the tree

`npm run simulate` now times every `step` and prints the distribution, the count
over the `1000 / TICK_HZ` = **16.67 ms** budget, and the ticks filed by how many
bots held a target during them. One whole round per map, sixteen bots, no humans,
difficulty 1; the proving ground through `npm run simulate:dev`, the dev-mode
server build that is the only one which has heard of it.

| map | extent | boxes | build | p50 | p95 | p99 | worst | over budget |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Hollowmere | 240 | 824 | 138 ms | 0.016 | 0.034 | 0.070 | 3.04 | **0 / 62,281** |
| Greyfen | 240 | 1,717 | 210 ms | 0.022 | 0.039 | 0.073 | 3.21 | **0 / 62,821** |
| Coldharbour | 320 | 768 | 235 ms | **0.062** | **0.192** | **0.275** | 9.80 | **0 / 48,519** |
| Harrowmead | 400 | 748 | 170 ms | 0.015 | 0.127 | 0.178 | 4.30 | **0 / 64,801** |
| **proving 900/300** | **1500** | **5,929** | **1.25 s** | **0.012** | **0.029** | **0.055** | 7.45 | **0 / 108,181** |

Milliseconds per tick. **Not one tick of 347,000 crossed the budget on any map,
and the 1500 m map has the CHEAPEST tick of the five** — its p99 is 0.33% of the
step. Four proving rounds reproduce it: p50 0.007-0.012, p99 0.030-0.055.

**The worst ticks are not the simulation.** Every spike over 1 ms is reported
with where it fell and whether a GC pause overlapped it: they cluster in the
first ~6,000 ticks (the JIT), one or two a round land inside one of that round's
10-25 GC pauses, and a whole round's collection is 8-16 ms. The largest tick seen
anywhere here is 10.3 ms — still inside the budget, and a collector pause with a
tick around it.

### The map is not what prices it — armour is

Read the table by what is ON each map rather than by how big it is: the two
expensive ticks are **Coldharbour and Harrowmead**, which are the two maps with
`vehicles`, and the three cheap ones are the three without. Coldharbour's median
is 4x Hollowmere's on a map with FEWER collider boxes.

A CPU profile of a Coldharbour round says it outright — `_checkCollision` 23.1%,
`_collideWithWorld` 13.9%, `_testTriangle` 3.3% of all samples, about 2.7 s of a
round whose ticks total ~3.4 s. That is Babylon's `moveWithCollisions`, and on
the authority it has exactly one caller: `Vehicle.update`. The legs never touch it —
a client does its own movement and `validateMove` checks the result analytically
— and `ENGINE_UPGRADE.md` wall 2 took every ray in the game off the scene. **The
hull sweep is what was left, and it is the last O(meshes in the map) thing this
process does per tick.**

It is gated on `Math.abs(this.speed) > 1e-3`, which is why Harrowmead's median is
cheap and its p95 is eight times that median: its hardstandings are in the home
yards and its hulls spend the round parked, while Coldharbour's are on the
avenues and its crews drive.

**Priced directly rather than derived**, with one hull-shaped body carrying the
tank's own ellipsoid, stepped 2,000 times through a built server world:

| world | collidable meshes | `moveWithCollisions` |
| --- | --- | --- |
| Coldharbour | 754 | **0.0394 ms/call** |
| proving 900/300 | 5,904 | **0.4020 ms/call** |

**10.2x the cost for 7.8x the meshes.** So a 1500 m map with armour pays 0.40 ms
per DRIVEN hull per tick — 2.4% of the budget for one, 4.8% for the two a map
states today, against 0.05% for everything else the tick does out there. That is
not a problem at sixteen slots and two hardstandings. It is the only term in the
authority that grows with map AREA, and S11 says the desert city probably wants
armour.

### The install at 1500 m is the COVER bake, not the parse

S9 costed the server's inheritance as a parse — 400 kB of generated
`collision.ts` against Coldharbour's 53. The bake came out at **5,929 boxes and
473 kB**, which is that projection to within a rounding, and **it parses and
evaluates in 7.5 ms**. It is not the cost.

`buildServerWorld` is **1.25 s** at 1500 m against 235 ms on Coldharbour, and a
profile of the build alone attributes it to `segmentHitsBox` (19.3%) under
`CoverMap.bake` (3.8%), `severLinks` (10.2%) and `linkCells` (1.4%) under
`NavGrid`, and `buildField` (2.8%) for the seven flow fields. **The cover bake is
the largest single thing in the authority's install**, which is S3/S4/S5's
inheritance arriving exactly where they said it would — and a 1.25 s build is a
rotation cost nobody is watching, not a tick cost.

It is also not stable across a process: rebuilding in the same NullEngine read
1.25, 1.36, 1.62 and 2.78 s over four consecutive rounds. Heap growth is the
obvious suspect and nothing has isolated it.

### The world S9 measured is the world the client builds

`npm run parity` now covers the DEV-only maps too, which costs it a second server
build in dev mode. The proving ground passes on all 17 fingerprint fields:
**5,929 boxes, 528,287 surfaces, 305,193 walkable.** Without that, every number
above would rest on the assumption that a 1500 m bake reconstructs correctly —
which is the one assumption the entire server design is built on.

### The density problem is measurable on the authority, and it is S10's

**Five of eleven proving rounds never ended.** They ran the full 45-minute cap
with tickets left on both sides (367/239, 183/81); the six that resolved took
19-30 minutes against 13-18 on every shipped map. Difficulty does not fix it —
both rounds run at difficulty 3 hit the cap.

The contact block says why: **peak 5-7 of 16 bots ever held a target at once** on
the proving ground, against 10-14 on the four shipped maps, and 73-95% of its
ticks have nobody in contact at all. Sixteen bodies over 0.81 km² of play is one
per 51,000 m²; Harrowmead is one per 10,000.

That is `ENGINE_UPGRADE.md` S10 stated as a measurement rather than as an
arithmetic worry, and it arrives with a warning for anyone measuring this map
again: **a quiet round is most of what a 900 m round IS**, so a mean tick taken
on one is a measurement of walking. Findings 22 and 30 hit the same wall on the
client and had to force a fight; the contact buckets are this side's answer to
it.

### What is open

- ~~**`Vehicle.update`'s hull sweep is the last whole-scene walk on the
  authority.**~~ and ~~**the same sweep is on the CLIENT, per frame**~~ — **BOTH
  CLOSED by 35.** A big map did state `vehicles` (Sarab, and three kinds of
  them), the client half turned out to be 96% of everything the fleet cost, and
  the substitution was not the analytic sweep suggested here: `CollisionField`
  narrows Babylon's own walk through `surroundingMeshes` instead, which keeps
  the collision response bit-identical rather than reimplementing it.
- **Why a rebuild in the same process gets slower**: 1.25 s to 2.78 s over four
  rounds, with `map.dispose()` between them. A match server rotates maps for
  hours.
- **Nothing here had a human in it.** No `LagComp` rewind ran, no snapshot was
  encoded, and `Match`'s own per-tick work — sixteen sockets, `validateMove`, the
  interest sets — is in none of the numbers above. What was measured is the
  SIMULATION's tick, which is what S9 asked for and is not the whole of what a
  server does.
- **The 45-minute cap is now a thing that fires.** `MAX_SIM_MINUTES` was a
  backstop against a round that could not end; on a 900 m map it is the normal
  outcome, and a reader who does not check `winner: NONE` will average a
  contested round together with one that never started.

---

## 32. Sarab: what a 1500 m map actually costs once it is a map — 91 fps, 2.4 s to install, and the two cheapest levers doing most of it

**Status:** measured on the shipped map. ENGINE_UPGRADE.md S11.

### What was measured

`node plans/webgpu-ref/gate.mjs --uncap`, headless via `channel: "chromium"`,
1920x1080, the frame limiter off, warm past the compile stall. All five maps in
one session on the Windows box:

| map | extent | install | coldFps | warmFps | med ms | p95 ms | probes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| hollowmere | 240 | 809 ms | 141.7 | 262.5 | 3.5 | 5.4 | 4 |
| greyfen | 240 | 4,749 ms | 109.4 | 204.8 | 4.7 | 5.8 | 2 |
| coldharbour | 320 | 2,003 ms | 45.0 | 52.6 | 19.3 | 21.4 | 40 |
| harrowmead | 400 | 1,215 ms | 42.2 | 47.7 | 20.6 | 25.7 | 2 |
| **sarab** | **900 / 300** | **3,356 ms** | **66.3** | **61.4** | **16.4** | **18.9** | **17** |

**ONE SESSION, and that is not a footnote — it is the reading.** Three runs of
this command on this tree put Sarab's median between 11.1 and 16.4 ms and
Harrowmead's between 14.6 and 20.6, and the run taken immediately after a
production build came back 30% low on every row. The measurement protocol says
to read nothing under about 8% as real; on this box, across sessions, the floor
is nearer a third. **What survives every run is the ORDER**: Sarab is faster
than both maps a quarter of its size, every time, and it is the RATIO between
rows in one table that is worth quoting rather than any absolute in it.

3,233 collider boxes, 4,734 scene meshes, 148 active, 360,000 nav cells,
380,598 nav surfaces, 625 placements and 80 scatter regions. `npm run parity`
passes on all seventeen fields.

And the authority, `npm run simulate sarab 1 3` under NullEngine: the world
builds in 692 ms, **0 of 64,981 ticks over the 16.67 ms budget**, p50 0.021 ms,
p95 0.508, worst 6.585. Every round ended with a winner in about 18 minutes of
game time, peak contact 8 to 12 of 16 bots.

### What it means

**A 900 m map is faster than a 320 m one, and the reason is two numbers in a
layout file.** Sarab is 5.1 times Harrowmead's playable area and renders in
three quarters of its frame time. Finding 29 measured `blockSize` and
`terrainBlock` at 96 as worth a third of the frame and two fifths of the install
on the proving ground and said the value was "nobody's yet"; it is Sarab's, and
this is what it looks like spent on a real layout. The other half is finding 30's
`bodyDrawDistance`, stated here at 300 against a 560 m fog, which is the first
time either field has been in a shipped map.

**The install is the reflection bake and the bake is the GLAZING**, which this
map has almost none of: 7 probes against Coldharbour's 40, because the only
glass in the town is what a handful of reused city builders bring with them and
the shelled blocks carry none at all. `GameMap.panes` is EMPTY — there is no
breakable glazing on this map, which is also why `paneGroups` is 21 and the
sweep, the bake and the wire have nothing to name.

**The roofs are a ROUTE and not scenery, which is what the vernacular was built
for and is the one claim about it that could have been wrong.** Counted out of
the built graph: **18,766 nav surfaces stand more than 2.5 m over the ground,
and 8,439 of them are reachable** from flag C's flow field — 45%, which is
roughly the share of houses the generator gives a stair (`rampSide`) and is the
design rather than a shortfall. The other 55% are the roofs of houses without
one, plus parapet tops: drawn, solid to a round, and not a floor. The ground
graph is 353,969 reachable of 361,832 (97.8%), so nothing on the map is
stranded.

**The density problem finding 31 measured is answered by the LAYOUT and not by
the engine.** On the proving ground five of eleven rounds ran the 45-minute cap
with tickets left on both sides and peak contact was 5 to 7 of 16. On Sarab
every round ended, in about the time a round takes on a shipped map, with peak
contact 8 to 12. What differs is not the extent — both are 900 m of play — but
that the flags are 200 to 290 m apart in a town rather than hundreds of metres
apart on a grid, and that the ground between them is transit. That is S10's
lever 1, and it is the whole of what was needed.

### What is open

- **Nobody has watched a body POP at 300 m.** `bodyDrawDistance` is stated for
  the first time here and finding 30's third open thread — what the drop LOOKS
  like on a map that states one — is still open, because the measurement above
  is a frame rate and not a pair of eyes. The 300 was chosen so that the pop
  happens in haze rather than in clear air; that is a hypothesis.
- **The sand's bump reads as scales at a grazing angle.** Visible down the
  wadi's bank in the shots this map was tuned against — `floorSurface: "sand"`
  is 0.015 of relief over a 5 m tile, and at a few degrees off the surface the
  normal perturbation reads as a pattern rather than as grain. Not investigated;
  it may be the bump, the AO bake or the cel shader's banding.
- **The picture was checked DIFFERENTIALLY and not absolutely**, which is
  finding 20's fault and not this step's: `bank.mjs --check` is red on an
  unmodified tree, so what was run is the usable form — the same check either
  side of the change against the same fixed reference. All fifteen banked
  vantages report the SAME mean to four decimal places with these changes
  applied and with them stashed, which is what says the shared edits (the palm
  in `Props.ts`, the two table rows in `MapBuilder.ts`, the eight in
  `BuildingKit.ts`) moved no pixel on any existing map. Sarab now has a bank of
  its own — menu, `alley`, `shelf` and `wadi` — and the `shelf` row is the first
  banked frame anywhere with a fog wall INSIDE the play square in it.
- **The layout is in the MAIN bundle and it is the biggest one there.**
  `MapDef.heights` and `MapDef.collision` are lazy and `MapDef.layout` is not,
  by design — it is authorship rather than bulk — but Sarab's is 625 placements
  and about 90 KB of source against Harrowmead's 45, so the five layouts now
  come to a quarter of a megabyte every boot parses for the one map a session
  builds. That is the same argument S7 made about the heightfields and it has
  not been re-made about this; whether 90 KB is worth a third lazy half is
  nobody's step yet, and the honest figure to check first is what it costs to
  PARSE rather than what it costs to fetch.
- **The frame was measured EMPTY.** The gate's round has bots in it but nothing
  forces contact, which is the wall findings 22, 30 and 31 all hit. What sixteen
  bots fighting across the old town's roofs costs on this map is unmeasured, and
  it is the one place a roofscape could turn out to be expensive: every roof is a
  walked surface and the nav graph has 380,598 of them.

---

---

## 33. The sway ramp cannot hang cloth, and the drapes are dressed around it rather than fixed

**Status:** derived from the code and confirmed on screen; worked around, not
solved.

### What the ramp is

`world/vertexShading.ts` writes one number per vertex into the RED channel and
it is `swayWeight(y - terrain.heightAt(x, z), layer)` — height above the ground
under that vertex, run through `(h / reach)^1.6 * amount`. Every reader of it is
foliage, and for foliage it is exactly right: a blade, a bole and a crown are
all planted at the bottom and free at the top, so weight rising with height is
the shape the thing actually has.

**Hung cloth is the same shape upside down**, and the ramp gets it exactly
backwards. A drape over a parapet is fixed at its head and free at its hem, so
the ramp gives it the most travel where it is nailed and the least where it
should swing. Two visible consequences, both seen before the workaround: the
head shears out from under whatever it hangs on, and — with a `reach` set low
enough to stop that by putting the whole sheet on the ramp's flat top — the
sheet stops having any internal gradient at all and translates as one rigid
slab. Measured that way on Sarab: every cloth vertex in the town baked to
exactly `amount`, with zero spread.

### Why it cannot be fixed where the weight is written

The weight would have to be a function of distance BELOW the sheet's own
anchor, and the anchor is not knowable at the point the bake runs. The bake is
after `BlockMerge` (it has to be — `VertexData.merge` throws when one mesh in a
group has `colors` and another does not), so by then a whole 96 m block's
washing is one mesh: no drape, no part, no local frame, and a bounding-box top
that belongs to the block rather than to any sheet in it. This is the same
constraint `world/sway.ts`'s header already documents for the per-part anchor a
leaf would want, arriving at a case where the positional estimate does not
happen to be right.

### What was done instead

`CONFIG.wind.foliage.layers.cloth` is tuned so the inversion is below notice
rather than corrected: `reach` 5 spans the heights cloth is hung at so a drape
shears down its own length, and `amount` 0.28 caps the largest travel in the
layer at 0.095 m against the 0.08 m every drape's coping oversails its wall by.
The look is carried by `kit/desert.ts`'s `drape` — a rolled head and three
strips differing in width, drop, proudness and hang, all marked so there is no
internal join.

### What would settle it, in rough order of cost

- **An anchor channel.** The BLUE vertex channel is written 0 today
  (`vertexShading.ts` sets `colors[i * 4 + 2] = 0`) and is the only free one.
  A builder that marked a mesh could stash its own top there before the merge —
  the merge concatenates vertex data, so a per-vertex value survives it where a
  per-mesh one does not — and the bake would read `anchor - y` instead of
  `y - terrain`. That is one channel, one branch in the bake keyed on a `hang`
  flag in the layer, and no shader change at all: the red channel still means
  "how much this vertex moves".
- **A second sway term in the shader**, pivoting about the anchor rather than
  translating, which is what would make a hem actually swing rather than shear.
  Costs a uniform and a branch on a path that is already the hottest vertex
  shader in the game, and wants the channel above first regardless.
- **Leave it.** The amplitude is small, the geometry does the reading, and no
  other map has cloth. This is only worth opening if a second map hangs
  something bigger — an awning over a souk lane, a tent — where the shear would
  be across a two-metre span rather than a one-metre one.


---

## 34. A second vehicle a side puts HALF the AI in vehicles, and the round goes quiet

**Status:** measured on the authority; the cause is arithmetic and the fix is a
design decision nobody has made yet.

### What was measured

`npm run simulate sarab`, twice, before and after the map gained a gun truck a
side (four hardstandings instead of two) and `crew.boardRadius` went from 18 to
24 so the second pad in each yard is actually inside a circle bots walk through:

| | two vehicles | four vehicles |
| --- | --- | --- |
| round length | 23.8 min | 16.5 min |
| kills | 94 / 67 | 65 / 27 |
| flag captures in the round | 32 | 15 |
| tick p50 | 0.269 ms | 0.642 ms |
| ticks over the 16.67 ms budget | 0 | 0 |

A 33-second browser round says why: within one boarding sweep of the first
deploy, **all four hulls have both seats filled**. A roster is sixteen slots,
eight a side; two hulls a side at two seats each is four of those eight, so
half of each team's AI is inside a vehicle and out of `Bot`'s FSM
(`BattleSystem.aside`). The flags are taken by the other half.

### What is derived rather than measured

That the drop in captures is CAUSED by the crewing rather than by the trucks
driving over the people who would have taken the flags. A crewed bot still
counts for its squad's objective and a vehicle parked on a flag captures it, so
some of the lost captures are presumably deferred rather than lost — but
nothing in the two runs separates the two, and the kill count fell as well,
which a deferral does not explain.

The server cost is not the interesting half. Four driven hulls doubled the
median tick and it is still 3.8% of the budget with nothing over it; finding 31
already prices a driven hull and this agrees with it.

### What would settle it

- **A cap on how much of a team may be crewed at once**, which is one counter
  in `VehicleCrew.board` and the only change here that is cheap. Two of eight is
  Coldharbour's ratio and is the one the AI was tuned against.
- **Or make the second seat lower priority than the first ACROSS hulls**: fill
  every hull's driver before any hull's gunner. That is a re-ordering of the
  two loops in `board` and it costs nothing, and it is arguably right on its own
  terms — a hull that moves is worth more than a hull with two men in it.
- **Or decide this is what a map with four vehicles is**, and leave it. Sarab is
  900 m of transit ground and armour is the answer to that; a round where half
  the AI is mounted may simply be the map working. What makes that hard to
  accept as it stands is that nobody CHOSE it — it fell out of a hardstanding
  count.

---

## 35. The vehicles were 2.3 ms a frame and 96% of it was ONE call — the last whole-scene walk is down, on both sides

**Status:** measured on the Windows box, landed. Closes both open threads of
finding 31.

### What was measured

Sarab, six hulls (a tank, a gun truck and a helicopter a side), four of them
crewed and driving by the time the sample starts, headless Chromium through
`plans/webgpu-ref/harness.mjs`, 12 s windows, every phase of the fleet's frame
wrapped and accumulated:

| phase | before | after |
| --- | --- | --- |
| `VehicleSystem.update` | **2.299 ms/frame** | **0.120** |
| — of which `moveWithCollisions` | **2.214** (553 us x 4 calls) | **0.039** (11 us) |
| everything else the fleet does | 0.085 | 0.081 |
| median frame | 11.3 ms | **8.7** |
| fps | 87.2 | **117.8** |

**The whole of the vehicle subsystem outside that one call is 0.085 ms** — the
ten-contact ground probe, the plank, the springs, the hull lean, the antennae,
the turret slew, the cupola gun, the crew AI, `crushSweep` and
`pushHullEngines` between them. There was never anything else to find here, and
a reader who goes looking for it will spend a day confirming that.

And the authority, `npm run simulate sarab 1 3`, one round either side of the
change on the same tree:

| | before | after |
| --- | --- | --- |
| tick p50 | 0.691 ms | **0.053** |
| p95 / p99 | 0.947 / 1.080 | **0.068 / 0.087** |
| worst | 8.844 | 4.050 |
| a round of wall clock | 52.9 s | **3.1 s** |
| real time on one core | 23.6x | **298.5x** |

Finding 31 priced a driven hull at 0.40 ms per tick on a 1500 m map and called
it "the only term in the authority that grows with map AREA". It does not grow
with it any more.

### What it is

`scene.meshes`, walked per call, `isEnabled()` up the parent chain and a
bounding-box test each, up to `collisionRetryCount` times. Babylon's own
coordinator reads
`(excludedMesh && excludedMesh.surroundingMeshes) || this._scene.meshes`, so
handing the body a list is a supported narrowing of that walk and not a patch
over it — the collision RESPONSE is untouched, which is the whole reason this
was preferred to the analytic sweep finding 31 proposed. `CollisionField` is
the bucket grid behind the list; see its header for the rules.

### Three things had to be right, and two of them were found the expensive way

- **The list must be a SUPERSET of what the sweep can reach** — radius plus the
  whole step plus a margin, centred on the sphere rather than on the mesh.
- **The ORDER must be the scene's.** `Collider._testTriangle` rejects on
  `distToCollision >= _nearestDistance`, so a tie goes to whichever mesh was
  walked FIRST, and a world made of boxes is full of coplanar ties. A grid
  walks cell order; `scene.meshes` walks creation order. Left alone this put the
  hull a few centimetres out against a wall — small, real, and exactly the kind
  of difference that would have been blamed on the suspension a year later.
  Sorting the hits back into index order fixes it outright.
- **The centre must be `getAbsolutePosition()` and not `position`**, because
  that is the expression `moveWithCollisions` opens with. See VERIFYING.md —
  the two come apart under a render id, and a list built for the wrong point is
  the one failure mode this whole mechanism has.

### Two traps for whoever measures this next — and a third, which is worse

- **A scripted DRIVE proves nothing and looks like it proves everything.** Every
  hull on all three maps with armour completed 1,800 steps of full-throttle
  turning and reversing **without being blocked once** — a hardstanding is in a
  yard and armour spends its first half-minute crossing open ground. Two arms
  agreeing over free motion is two arms agreeing about arithmetic. The test that
  means something samples positions across the whole play square and reports how
  many of them actually hit something (760 to 2,484 of 8,000, by kind and map).
- **Always run an A-vs-A control.** The first oracle written for this reported
  3 m divergences that were entirely its own doing, and the control is what said
  so in one line.
- **`surroundingMeshes` is state on the MESH, and an A/B that only nulls the
  FIELD measures the new path twice.** This nearly buried the player half of
  this finding: an in-frame comparison that called `setGround(..., null)` for
  its control left Babylon walking the list the previous frame had written, and
  reported the whole thing as worth 0.003 ms. `narrowedMove` clears it on the
  no-field path now — which is a real fix and not only a harness one, because a
  body that stopped being given a field would otherwise sweep forever against a
  frozen snapshot of one street.
- **A sweep timed on open ground is not the sweep the game runs.** The walk is
  charged per RETRY, so it is dearest against geometry: 106-377 us isolated at a
  spawn, 388-2,209 us walking a town. Both figures are honest measurements of
  different things, and only the second is the frame.

### What is open

- ~~**`Player.update` does the same sweep, every frame the player moves.**~~ —
  **DONE, and it was worth as much again as the fleet.** Measured walking a real
  round, the player's own sweep is **2.21 ms a frame on Sarab, 0.616 on
  Coldharbour and 0.521 on Hollowmere**, against 0.036 / 0.015 / 0.026 with the
  list — Sarab's median frame 14.6 ms to 11.3, Coldharbour's 11.2 to 9.9.
  Hollowmere's does not move because that map is already at 6.9 ms and something
  else is its floor; the half-millisecond is real and goes unspent there.
  **The guess in this bullet was wrong in the direction that matters**: it
  reasoned that a smaller sphere and one call instead of four would make the
  player a fraction of the fleet, and the player turned out to cost the same as
  all four hulls together. The reason is the RETRY loop — `_collideWithWorld`
  re-walks the entire list on each retry, so the walk is dearest when a body is
  pressed against geometry, and a body on foot spends a round doing that.
  `Vehicle.update` and `Player.update` now share `narrowedMove`, which is where
  the reach, the ordering and the guard live once. Proved identical at 6,000
  samples on all five maps, 164 to 991 of them blocked.
- **`CELL` is 24 m and nobody swept it.** It answers with ~10 meshes for a tank
  and ~12 for the helicopter's 10.4 m disc, which was good enough that the cost
  stopped being visible; whether 16 or 32 is better has not been asked.
- **The grid is stamped once and never updated.** That is correct today because
  the only collidable thing that moves is a hull and hulls are in `movers` — but
  it is an invariant nothing enforces, and a future collidable that moves and is
  not registered would be walked through silently.
