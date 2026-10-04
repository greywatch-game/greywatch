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

## 1. Frame pacing: the mean says 60, the tail says 28 — **the STALLS are not the page at all, and there is a SECOND population that is**

**Status:** still open, and its central conclusion is now KNOWN UNRELIABLE
rather than merely unproven. **The instrument was pairing each frame's wall
clock with the NEXT frame's spans** — see "The pairing bug" below — which is
the direct manufacturer of this section's signature reading, "the phases fall
well short of the wall clock with `gc` at 0, so the time is outside the game".
The eliminations below still stand (they are aggregates, which a one-row shift
does not move). The *leftover* does not. **Every per-frame number in this
section needs re-taking on the fixed instrument before it is argued from
again.**

**A collector reading taken HEADLESS AND UNCAPPED nearly closed this wrongly.**
At 220-700 fps the game allocates the same ~200 kB a FRAME and therefore two to
seven times as much per SECOND as a real session does, which wakes the
collector at 1.5-1.8/s and makes GC frames 1.7x-4.5x the cost of a clean one —
a tidy, wrong answer. On the real machine, playing normally at 95 fps, the same
instrument reports **2 collections in 31.4 seconds (0.06/s), and every hitch in
the capture has `gc: 0`.** **Do not measure allocation pressure uncapped**; the
rate per second is what the collector responds to, and uncapping fabricates it.

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

### What the capture said, which settles it

**Taken at last, on the Windows box, on the current tree, with a REAL round
under it** — walking, sweeping the view, firing in bursts — through the shipped
profiler (`?profile`, `window.__profile.capture("x", true)`), 3,000 frames a
map. The full series carries `gc[]` and `frameMs[]` per frame, so the question
this section could not answer for two milestones is one filter over a capture:
**split the frames by whether a collection landed on them.**

| map | no-GC mean | GC-frame mean | GC-frame max | frames with a GC |
| --- | --- | --- | --- | --- |
| hollowmere | 1.42 ms | **6.33** | **27.6** | 7 of 3000 |
| coldharbour | 2.13 ms | **5.11** | 8.3 | 11 of 3000 |
| sarab | 3.81 ms | **6.97** | 11.9 | 20 of 3000 |
| cinderhaven | 4.48 ms | **7.85** | 17.6 | 21 of 3000 |

**A frame with a collection on it costs 1.7x to 4.5x a frame without one, on
every map in the tree**, and the frame AFTER one is still elevated (cinderhaven
6.44 against 4.48, sarab 6.29 against 3.81) — a collection spills past its own
frame. The rate is **1.44–1.83 collections a second on every map**, which is
this section's own "a visible hitch roughly every 1.7 seconds" arriving from
the other end.

Hollowmere's worst frame is the one to read, because it is the shape this
section predicted in "How to settle it" and then had to wait for: **27.6 ms of
wall clock whose phases add up to 2.4, with `gc` on it.** That is the second
bullet of the three, word for word — the time is outside the game's own
brackets and the collector is standing next to it.

**The allocation rate is ~50 MB/s and it is the same 50 on every map**, which
is the tell that it is not the world: hollowmere 52.5, coldharbour 54.0, sarab
54.5, cinderhaven 49.2, over frame rates from 222 to 700.

**The other four fifths.** Babylon and the builtins it calls are ~64% of what
is left and our own code ~36%, and our share is spread over forty sites with
the largest at 4% — a thousand cuts rather than an actor. Nothing here has
costed the WebGPU backend's own per-frame objects (`getBindGroups`,
`_startRenderTargetRenderPass`), which are the next largest block.

### What the real machine says, and what it eliminates

A capture off the actual display (3432x1432, sarab, 31.4 s, 602 draw calls and
532 active meshes — a busier frame than any headless run had been reproducing):

| | wall clock | `frame` span | unaccounted | gc |
| --- | --- | --- | --- | --- |
| hitch 1 | 42.2 ms | 15.1 | **27.1** | 0 |
| hitch 2 | 30.8 ms | 13.4 | **17.4** | 0 |
| hitch 3 | 24.9 ms | 10.5 | **14.4** | 0 |

**DO NOT ARGUE FROM THAT TABLE.** Its three "unaccounted" figures are the
pairing bug below, at least in part: the `frame` span in each row is the
RECOVERY frame's, not the span that filled the interval beside it. The capture
it came from is a v3 and cannot be re-read — only re-taken.

What it seemed to say was this section's own third bullet — "the same shortfall
with `gc` at 0 puts the time outside the game altogether" — and three further
suspects were measured and dropped on the strength of it. **Those three
eliminations survive**, because each rests on an aggregate or on a controlled
A/B rather than on a single frame's decomposition:

- **Not the GPU, and not fill.** `setHardwareScalingLevel` across an **8x**
  reduction in pixels (4,915 -> 613 kpixels) moved the frame rate not at all:
  97.0 / 96.0 / 95.0 / 97.2 fps, with the wall-to-tick gap ~0 at every step.
  The frame is CPU-bound even at that resolution. That sweep also reproduces
  the real session closely (97 fps against 95.5, 10.29 ms against 10.48), so it
  is the workload to measure on.
- **Not pipeline compilation.** Hooking `createRenderPipeline` and
  `createShaderModule`: 29 pipelines and 73 modules during warmup, then **6
  pipelines and 2 modules across 40 s of play**. Finding 16 is a first-seconds
  cost and not a steady-state one.
- **Not the submit.** The `present` phase added for this reads **0.027 ms mean**
  and 0.3% of the wall clock. The decomposition now closes exactly — `frame`
  77.9% + `present` 0.3% + residue 21.8% = 100.0% — and a 27.9 ms hitch of the
  same shape reproduced headless reads `frame=9.5, present=0, gc=0`, leaving
  **18.4 ms in the residue**.

### The better hypothesis, which is a first-use PIPELINE stall

**Dawn compiles behind the call and the stall lands on first USE**
(`VERIFYING.md`), so a pipeline created cheaply is an 80 ms bill payable at an
arbitrary later frame — inside `drawWorld`, with the draw count flat, with
`gc` at 0, and clustered, which is every property the real hitches have. The
uncapped G-Sync session's hitches cluster at frames 2415–2432 and 320; `ProfileReport`'s
own series header calls a draw count that ramps across a second "a batch of
pipelines coming into view".

**This is not the thing the bullet above already eliminated.** That measurement counted
CREATIONS — 29 pipelines and 73 modules in warmup, then 6 pipelines and 2
modules across 40 s of play — and concluded steady-state compilation was
negligible. Six pipelines across 40 s of play is six opportunities for a
first-use stall, and counting creations cannot see one.

**How to settle it:** hook `createRenderPipeline` and `createShaderModule` as
before, but record the frame INDEX of each against the profiler's ring, and
look at whether the hitch frames are 1–2 frames downstream of a creation. Fire
every weapon and set off a blast during the run, which the A/B script did not.

`src/core/FrameCap.ts` is now a frame pacer, and its admitted frame measures
its delta across the whole gap — the raw, lagging `dt` that `docs/profiling.md`
(vsync) says a pacer owes something better than. Not measured.

### The pairing bug, which is where the leftover was coming from

**`Game.tick` reads `getDeltaTime()` on its FIRST line and hands it to
`endFrame` on its last**, so what the ring stored in row `i` was
`start(i) - start(i-1)` — the interval the frame BEFORE it filled — while
`phases[i]` were row `i`'s own spans. Every per-frame subtraction in this
section was therefore between two different frames, and it fails in one
direction: a long tick shows up as the NEXT row's wall clock, whose own tick is
the healthy recovery frame, so the difference reads as time nobody spent.

Proven three ways, over the 9,000 frames of three vsync-off captures (Chrome
152, 3440x1440 G-Sync fullscreen, two Sarab and one Cinderhaven):

| | as filed (v3) | shifted one row |
| --- | --- | --- |
| minimum residue | **-60.5 / -35.2 / -20.2 ms** | +0.1 / +0.1 / +0.1 |
| negative residues | 133 / 133 / 87 | **0 / 0 / 0** |

A negative residue is impossible — it says the tick outran the interval
containing it — and the shifted pairing produces none. The worked example is
cinderhaven frame 2424: a **90.6 ms tick, 86.6 of it `drawWorld`**, arriving
as a 91.5 ms wall clock on row 2425, whose own tick was 9.5 ms. Filed as
"82 ms outside the game, gc 0". Under the correct pairing, **18 of 21 hitches
on that capture and 8 of 9 on one of the sarabs are the previous frame's tick**.

**Fixed** — `endFrame` writes the delta into `lastSlot`, as `recordPresent`
already did, and files a hitch against the frame that filled the interval.
Report **version 4**; `docs/profiling.md` carries the contract and
`public/profile_viewer.html` marks an older capture as stale rather than
reading it. Verified in a real round under an 8x CPU throttle: minimum residue
+0.30 ms over 884 frames, and 7 of the top 8 hitches now attributed to their
own tick, which is what a CPU throttle should produce.

### What is left, and the instrument that now splits it

**The residue is real and it is no longer un-nameable.** A page cannot tell the
rAF wait, the compositor and the panel apart — that argument stands — but
`long-animation-frame` tells all three from the fourth possibility nobody could
previously exclude: **the main thread busy with something outside `Game.tick`**.
The probe is in (report version 5, `docs/profiling.md`), and its ABSENCE is the
reading: a hitch with no long frame over it is a hitch the main thread was idle
through.

Verified two-sided before it was believed — a planted 120 ms `setTimeout`
outside the tick comes back as `tick 2.2 | loaf 124 | block 74` naming
`TimerHandler:setTimeout`, and a clean round reports nothing but the map
install.

**The vsync-ON capture that this section was waiting for has now been taken**,
and it is the first per-frame reading of this finding that can be trusted:

| | |
| --- | --- |
| the lock | 96.0% of frames within 18% of a 7.00 ms median — vsync on at ~143 Hz |
| the tick | 4.61 ms mean, 19.5 ms max, sd 1.07 — **healthy throughout** |
| `present` | **0.0 on every hitch frame** (0.017 mean, 0.2 max over 2,999) |
| the hitches | 18 intervals over the 24 ms bar, **0 explained by their own tick** |
| the worst | 120.6 ms wall, 7.4 ms tick, 113.2 ms of WAIT, `gc: 0` |
| the workload | draws 506/496/514 and meshes 428/423/439 before/during/after — **flat** |

So it is neither the tick nor the submit, and `drawWorld` is clean (max 9.6 ms)
— which also takes the first-use pipeline hypothesis above off this particular
episode.

### …and the probe has now answered: it is NOT THE MAIN THREAD EITHER

Cinderhaven at 3440x1440, 43 bots alive, the player standing still at
(34, -0.2, 204.4), 2,999 frames on the v5 instrument. Eight hitches, and the
browser's own account of every one of them:

| wall | tick | `present` | long frame | of which script | blocking |
| --- | --- | --- | --- | --- | --- |
| **262.1 ms** | 7.2 | 0.1 | 263.5 | **8.7** | **0** |
| 163.0 | 6.9 | 0 | 165.1 | ~9 | **0** |
| 120.7 | 7.6 | 0 | 121.5 | 8.4 | **0** |
| 84.4 | 9.0 | 0 | 84.2 | — | **0** |

**A 263.5 ms animation frame carrying 8.7 ms of script and no blocking task at
all.** The browser watched the frame, agrees it took a quarter of a second, and
reports that essentially none of it was JavaScript. Draw calls are flat at
497–509 and meshes at 427–429 across the whole episode; `allocMbPerSec` is
50.28 and `gcPerSec` 2.77, both ordinary. The shape is a stall and then a
catch-up — 262.1 then 13.5, 163 then 40.9, 84.4 then 20.4.

So the elimination list was: not the tick, not the submit, not the collector,
not `drawWorld`, and not the main thread — and not the GPU either, two sections
below.

### ANSWERED: the browser is not giving the page a frame

Two v6 captures, Cinderhaven at 3440x1440, 32-36 bots alive, 2,999 frames each.
Every hitch in both, split by `renderStart`:

| wall | tick | `present` | long frame | script | render | **before the render began** |
| --- | --- | --- | --- | --- | --- | --- |
| **243.4** | 6.2 | 0 | 244.0 | 7.0 | 7.3 | **236.7** |
| 124.7 | 4.7 | 0 | 125.9 | 6.1 | 6.3 | **119.6** |
| 96.8 | 5.4 | 0.1 | 97.6 | 6.6 | 6.9 | **90.7** |
| 107.6 | 7.1 | 0 | 108.0 | 8.1 | 8.3 | **99.7** |
| 77.1 | 5.7 | 0 | 77.5 | 6.4 | 6.4 | **71.1** |
| 68.1 | 7.1 | 0 | 68.4 | 7.8 | 7.9 | **60.5** |

**`renderMs` is `scriptMs` plus about 0.3 ms on every row in both captures.**
The rendering steps ARE the rAF callback — `Game.tick` — plus a third of a
millisecond of style, layout and paint, which is what a page that is one canvas
should cost. So the whole of every hitch sits BEFORE the rendering steps began,
with **no script in it at all**.

The browser opened the frame, ran nothing for up to 236.7 ms, then ran our 7 ms
tick and painted. `gc` is 0 on every one, `allocMbPerSec` is 38.0 and 41.5 and
`gcPerSec` 1.49 and 1.62 — ordinary on both. Draw calls are flat within each
episode. The shape is a stall and then a catch-up.

**So the time is not the page's in any sense the page can reach.** Not the tick,
not the submit, not the collector, not the main thread, and not the browser's
rendering work either — **the frame was simply not scheduled**. Six of this
section's seven suspects are dead and the seventh was never on the list. **The
seventh — the GPU — is dead too as of the section after next**, measured rather
than argued, which leaves this finding with no suspect inside the process at
all.

### ANSWERED: IT IS NOT THE GPU EITHER, and the instrument that says so nearly lied

**A rendering opportunity that does not arrive for 237 ms on a 144 Hz panel is
the compositor declining to issue one**, and the leading reason for that was the
GPU being behind: `present` returns instantly because `queue.submit` queues
rather than blocks, so a saturated GPU is invisible to every CPU span in this
file. `?gpu` was built for exactly this question and the answer is **no**.

Four v8/v9 captures of Cinderhaven at 3440x1440 on the real display, with the
whole-frame counter armed:

| capture | GPU mean | GPU p95 | **GPU max** | tick mean | wall budget |
| --- | --- | --- | --- | --- | --- |
| 21-35-38 | 1.977 | 2.449 | **3.672** | 4.48 | ~7.0 |
| 21-36-13 | 2.065 | 2.548 | **3.677** | 6.41 | ~7.0 |
| headless 3440x1440 | 2.325 | 2.821 | 15.079 | 6.05 | ~7.0 |

**The GPU never comes near the budget, and on the hitch frames themselves it is
1.6–2.7 ms** — including a **160.7 ms frame on which the GPU did 1.703 ms of
work**, and a 150.7 ms one on which it did 1.779. Whatever is holding the frame
open, the GPU is idle through it. That was the seventh suspect and the last one
this instrument could reach.

**The reading was nearly zero for the wrong reason, and that is the part worth
keeping.** The first `?gpu` capture came back `requested: true, available: true,
frame.samples: 0` — which reads as "the GPU took no time" and is instead "this
browser cannot express the answer". Babylon brackets the whole command encoder
with `GPUCommandEncoder.writeTimestamp`, removed from the WebGPU spec and kept
by Chrome behind **`--enable-unsafe-webgpu`**; the feature itself and the
`timestampWrites` descriptor `gpu.mainPass` uses need no flag, so the main-pass
counter went on working and made the capture look healthy. `stop()` returns a
literal 0, `endFrame` accepts it on `duration >= 0`, and the counter records a
real measurement of zero — **747 of them, against 626 genuine samples with the
flag**. `plans/webgpu-ref/harness.mjs` passes the flag, which is why every
headless GPU number in `VERIFYING.md` existed while a stock browser got nothing.
Fixed as `gpu.frameMeasurable` (report **version 9**).

### …and a SECOND population appeared, which IS the tick and DOES name a phase

Every hitch in this finding's history until now was "not the page". Five
captures from one session contain four that are, each one the game's own tick,
each corroborated by the browser's own script total, and **each in a DIFFERENT
phase**:

| capture | wall | `frame` | the phase | that phase's p99 | browser: script / blocking |
| --- | --- | --- | --- | --- | --- |
| 21-35-38 | 150.7 | 149.9 | **`vehicles` 139.1** | 0.3 | 149.9 / 100.4 |
| 20-50-28 | 136.7 | 124.2 | **`drawWorld` 119.9** | 4.3 | 124.4 / 75.1 |
| 21-36-13 | 62.9 | 60.6 | **`hud` 47.3** | 0.6 | 60.8 / 11.5 |
| 21-00-50 | 54.9 | 54.1 | **`bots` 45.0** | 0.3 | 54.2 / 4.7 |

Each is 30x to 460x its own p99, each happens once, and no two are in the same
subsystem. **Four unrelated subsystems do not independently spike once each**,
so the shape to suspect is one stall the tick absorbs wherever the frame happens
to be standing — and the bracket that catches it is then a bystander rather than
a culprit. Not yet established; what would settle it is more captures, since the
phase should keep moving if that is right and should not if `hud` or
`vehicles` has a real fault.

**The heap is the strongest correlate found so far.** On 21-35-38 it climbs to
**1070 MB**, then falls to 682 across the two buckets that carry the hitches
while collections step from 2–3 per bucket to 23 and 42; 20-50-28 does the same
thing 569 → 390 with GC stepping 2–4 → 43. **But it is not necessary**: 21-36-13
holds a flat 690–704 MB with GC flat at 4–10 per bucket and still produced a
105.1 ms stall, and 21-00-50 produced the worst frame in the whole set —
**254.6 ms** — with GC flat at 3–4 and `gc: 0` on the frame itself. So the
collection burst is a correlate of the BURSTS and not the cause of the stalls.

**The stalls also have a shape nobody had looked for.** They arrive in a single
self-limiting burst, periodic and escalating, then stop for good — 21-00-50 is
every third frame at 27.7 → 37.8 → 59.1 → 114.3 → 115.4 → 254.6 ms, followed by
448 clean frames at 6.9. Draw calls and active meshes FALL through each burst
rather than rising.

### Two instrument bugs this capture found, both fixed

Recorded because the second is the kind that produces a confident wrong answer
rather than a missing one, which is this section's whole history:

- **A long frame is not a busy main thread.** The viewer read any long frame as
  "the main thread was busy through it" and said so of the 263.5 ms one above.
  The three shares — script, blocking, render — are three different verdicts.
- **An absence under 50 ms is not an absence.** The spec reports at 50 ms, so
  six frames between 24 and 50 in that capture were filed as "the main thread
  was idle" when nothing had watched them. `loaf.floorMs` ships now.
- And `loaf.worst` was **starving**: an install's long frames are never
  displaced by anything a round produces and are dropped only at report time, so
  three records survived of twelve held. Stale ones are pruned as they are kept.

### …and the collector is EXONERATED by the same capture

The collection rate steps **20x at the hitch and stays there**, which looks
exactly like a cause until the tail is read:

| frames | gc/frame | mean wall |
| --- | --- | --- |
| 0–2100 | 0.010 | 6.95 ms |
| 2100–2400 | 0.087 | **10.79 ms** |
| 2400–2700 | **0.207** | **6.95 ms** |
| last 300 | 0.173 | 6.97 ms |

Six hundred frames run at 17–20x the collection rate at a flawless 144 Hz lock.
Per second it is 1–2 collections for sixteen seconds, 12–14 through the hitch,
then 29/31/29/22 — and those four seconds are the smoothest in the capture. **If
0.2 collections a frame cost 14 ms, the tail would be the worst part of the
capture instead of the best.**

So one event at frame 2291 had two consequences and the GC is the harmless one:
a permanent step in allocation, and ~2 s of stalls outside the tick. The stalls
stopped; the allocation did not. **What the event WAS is not in the capture** —
the player barely moves through it, from (-88.6, 7.9, 316.2) to (-86.6, 7.9,
316.3), with 32 bots alive. `heapLive` was false on that run, so there is no
MB/s to size the step; the next capture wants
`--enable-precise-memory-info`.

### The instrument trap, because it cost a run and will cost the next one

**Chrome's sampling heap profiler answers a DIFFERENT question by default and
its answer looks like good news.** `HeapProfiler.startSampling` at a 2 kB
interval over the same round reported **0.2 MB/s** — 260x under what the frame
profiler was reporting, and low enough to close this finding by mistake. V8
drops a sample when the object it sampled has been collected, so what comes
back is what SURVIVED: it measures retention, not churn, and churn is the whole
of this finding. `includeObjectsCollectedByMajorGC` and
`includeObjectsCollectedByMinorGC` are the two experimental flags that fix it,
and with both on the same run reports **51.6 MB/s**, agreeing with
`memory.allocMbPerSec` to 5%. **Ask for those flags or do not believe the
number.**

**And per-SITE attribution out of it is not to be trusted on our own files
without an A/B.** Two of its top twenty named a function that allocates nothing
— `eyeDistanceSq` (see `docs/rendering.md`'s front-to-back sort) and `Sfx.buildBreathBuffer`, which is called
once at init — because V8 attributes a sampled allocation to the JS frame on
top at the time, and a function called 22,000 times a frame collects
attribution that belongs to its callees. The FILE-level split is sound; a
single line is a hypothesis, and the memoised sort in `docs/rendering.md` is
what happens when one is taken at face value.

### Candidates, as they stood before the capture

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
- **The shadow depth pass** (see `docs/rendering.md`, "The shadow rungs") — but that is a *steady* per-frame
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

- **Four chained passes at the render resolution** — fxaa, the light shafts,
  motionBlur, paper grain — plus the glow layer's blur. The grain is no longer a
  trivial pass: its world-pinned paper measured ~0.25 ms of GPU at 1920x1080. The god-ray detach took that
  to three for most of a round while the shafts were `GodRays`; **that saving is
  gone**, because `Volumetrics` replaced it and is attached always. Measured at
  ~0.75 ms of GPU (`docs/rendering.md` has the per-rung table). Both the shafts
  and the blur are player settings.
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

### Also open, carried from the bake's closed entries

**A bake draw is 18.6 us and nobody knows why.** 50,000 draws at ~928 ms is
three times the ~6.3 us `VERIFYING.md` measures for a mesh draw carrying a
material switch, and eight times the ~2.3 us for an outline shell reusing a
bound material. A first bake creates a draw wrapper per (mesh, render pass id)
and six of those per probe, so bind-group creation is the obvious suspect — but
it is a suspect and not a measurement.

- **The worst frame is still 1,217 ms at 1500 m**, against a 197 ms median. It
  is the first batch and it is a queue-shaping question rather than a
  draw-count one: `releaseBatch` lets one probe through however fat it is on an
  otherwise empty frame, by design, or a queue with a fat head could never
  drain. A budget that could be spent as "one probe's worth of FACES" rather
  than one probe would smooth it; nothing has tried.
- **`perCell` is 2 at 1500 m, which is the first live grouping in the tree** and
  means a probe there drops 96 m of city out of the middle of its own cube (the
  enclosure rule — see `docs/rendering.md`). Nobody has looked at what that
  costs the PICTURE, because the proving ground is not a map anyone plays. A
  1500 m map that ships glazing owes that reading.
- **Nothing has looked at the PICTURE on the proving ground**, which is S0b's
  owed item and survives all of this. The bank can only say the four shipped
  maps are unmoved.
- **Nobody has looked at the PICTURE of a wider merge block** (`ENGINE_UPGRADE.md`
  S6). The whole cost of a wider block is cull granularity — a block is offered
  while the camera is inside `reach` of its bounds, so a 128 m block draws more
  that is off screen — and on the proving ground the draw-call saving swamped
  it. On a map with long sightlines and heavy per-pixel work it might not. Five
  shipped maps now state a wider block — Sarab 96, Cinderhaven 120, Kurenai 120,
  Harrowmead 200, and Coldharbour's `terrainBlock` 96 — and a probe drops every
  block it serves from its own bake (`ReflectionSystem`'s `encloses`), so a
  wider block is also more of the city missing from its own cube. None of that
  has been judged on screen.
- **The proving ground's glazing is a generated worst case.** 1,153 glazing
  groups over a city-block grid; a real 1500 m map may glaze far less, and S11
  is deliberately last so that the engine is not tuned against content that does
  not exist. The SHAPE is not a worst case — the bake is priced on glazing and
  `docs/rendering.md` says glazing has no natural bound.

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
excluding the world from the glow layer (-26.4%, since landed as `GlowPass`) were both
*negligible* — so this frame is not draw-call bound, and that saving is not
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
the game's own JS, `docs/world.md`'s ground probe — therefore got *cheaper*.

For scale, the same sweep reads 337k active triangles on Hollowmere and 339k on
Coldharbour. Greyfen was already 2.5x either of them before this (the grass
field WAS one mesh with a single bounding box over the valley, so all ~25k tufts
were active every frame whatever the camera did — finding 46 retired that) and
is now 4.1x.

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
no longer a lever here: it is drawn around the eye and culled per 8 m patch now
(finding 46), so what it costs is what is in view at the player's rung, and the
~17k tufts this section counted are gone. **The canopy tree itself** is near its floor at 351 triangles — the
plates are 3.5x more sky per triangle than a frond and the ring counts were cut
until removing one more measurably opened the sky — so there is little left
there without a second, cheaper tree species, which is the one thing this change
deliberately did not add.

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
`grenade.column.billows` at 0 — the column is the single largest term and the
one designed to be turned off first if a graphics-quality preset ever exists.
(Since 2026-09-30 the smoke is opaque billows (`BlastFx`) rather than blended
sprites, so the cost moved from FILL to vertices: a tank shell is ~50 billows of
1,280 triangles in one draw, plus ~150 small ones of 320, each drawn twice —
the frame and the glow mask — with six value-noise lookups per vertex.
Measured on the Windows box, Hollowmere, uncapped, a 1.85-power blast every
0.6 s so all four slots stay live, run order controlled: idle 408 fps both
builds, under the storm 366 fps before and 302 after — about 0.2 ms a frame for
the old spheres and sprites against 0.7 ms for the billows. Draw calls went the
other way (one per blast against seven meshes a slot plus one per ember). The
first lever is `BlastFx`'s icosphere subdivision (8); under ~7 the lumps start
to lose the cauliflower silhouette that keeps them from reading as rock.) Ranked against finding 5's list, it belongs after the ash field and
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
**Two of the three have LANDED** — `compatibilityMode = false` and the glow, see
below — and the third has not. **This entry corrects finding 12** and the glow reading
`GlowPass` replaced, both written against a backend where a draw call was cheap.

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
game's own JS is 1.7 ms of a 21.5 ms frame: **the per-frame CPU ranking (finding 18) is still
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
own path — either way the shadow pass is not where the frame is. Stacked, which is
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

**2. The GlowLayer had inverted, and the fix has LANDED as `GlowPass`.** The
layer was 883 of Coldharbour's 2,647 draws, every `MapBuilder` mesh drawn as
opaque black into a buffer it cannot light so that the glow buffer could
depth-occlude. `GlowPass` borrows the frame's own depth for that occlusion and
draws the emissive meshes alone; what it replaced is `docs/rendering.md`, "The
glow: what the depth share replaced".

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
builds, finding 11's editor tier-3 — and moving
any of them buys load time and nothing else. Do not re-derive this.

Inside that tenth, on real hardware rather than an earlier inflated headless
run: `player.probeGround` is **0.483 ms** and everything else is under 0.12
(`updateHud` 0.112, `battle.update` 0.094, `minimap.update` 0.086,
`lighting.update` 0.063). The headless run's ranking is intact and the
absolute figures were five times too big. **The ground probe was a third of the
game's own budget and is now gone** — the footprint test it waited on landed, and
`docs/world.md`'s ground-probe section carries what closed it and what it
measures at now.

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
architecturally correct answer to the glow's occluders — a shared depth buffer IS
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
and 726 -> 582, which is the per-mesh walk cost arriving on top of the
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

**DISPROVED — see `src/world/parts.ts`'s header, and this paragraph is left standing because how
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
  beat.~~ **MOSTLY CLOSED by `ENGINE_UPGRADE.md` S1 — see `docs/rendering.md`, "Block
  visibility".** The walk
  is 7.60 ms to 2.50 and the frame 9.80 to 4.30 on the same proving ground, and
  the reason it was that large is not what this entry assumed: **6,349 of the
  9,019 meshes are INVISIBLE collider proxies**. What is left is 0.94 µs over
  2,670 candidates, so the walk is still the largest single line in the frame
  and S8's fog wall is what has the rest of it.
- ~~**Nothing here was measured with sixteen bots fighting.**~~ **CLOSED by
  `ENGINE_UPGRADE.md` S2**, which forces a skirmish and prices one. A fight is an 8.6 ms
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

Measured while landing the candidate list (`ENGINE_UPGRADE.md` S1): the usable form
is the DIFFERENTIAL one: run it either side of the change against the same fixed
reference and require the same means. Two runs of the unmodified tree reproduce
Hollowmere's four vantages to four decimal places **and to the fourth decimal of
the pixel SHARE** — the fact this entry wanted: cross-process residue on this map is zero, not the
0.14 Harrowmead showed.

---

## 23. Rays at 1500 m: the terrain march is unpriced and has no hierarchy

**Status:** open. Every ray is a box query now (`RayWorld`, `ENGINE_UPGRADE.md`
S2, and `docs/world.md` for the audit that proved the substitution); what is
left is the one term in it that grows with a ray's length.

- **The 1500/0 extent has not been measured**, only 900/300. The cost is no
  longer collider-bound, so the projection is far weaker than it was — but the
  terrain march IS bounded by the segment's length in terrain cells, and nothing
  has priced that at 1500 m.
- **The heightfield march has no hierarchy.** A cell is rejected by the max of
  its four corner heights against the segment's own y-band, which is enough that
  a long ray passing well over the ground costs four array reads a cell. A ray
  ALONG a valley floor tests two triangles per cell for its whole length. A
  coarse max-height pyramid would fix it and nothing has needed one.

---

## 26. The placement loop is one mechanism, not a thousand milliseconds: a part is built as a full `Mesh`, registered, given a uniform buffer and a GUID, tessellated from scratch, merged, and destroyed

**Status:** measured, not acted on. `StoneBatch` and `Mesher` (`kit/core.ts`)
take the first sub-thread below locally, for the stone and tile runs that opt
in; the general path in `parts.ts` still builds a `Mesh` per part.

### The instrument

A CDP `Profiler` capture at a 200 us sampling interval over the whole install,
attributed by subtree. Same instrument as the flatten in `src/world/parts.ts` and S5b/S5c, and the same
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
but call `Build.pane` — 1,744 ms of the tower is panes. (Since 2026-09-30 a
tower glazes a sheet per storey per side and batches its boxes through
`StoneBatch`: Coldharbour's 37 emit 2,325 sheets where they emitted 4,233, and
~31 parts each where they emitted ~245. This profile predates that and was not
re-taken — the proving ground's install fell 32.3 -> 31.3 s across the change.)
Every builder bottoms
out in `partBox`, and aggregated over the whole install that is **3,465 ms,
18.5%**, in two almost equal halves:

| `partBox` splits in two | ms over the whole install | share |
| --- | --- | --- |
| `CreateBoxVertexData` — tessellating a fresh unit box | 1,986 | 10.6% |
| `partSurface` — constructing the `Mesh` | 1,657 | 8.8% |

**Neither half is doing anything a merged mesh needs.** `CreateBoxVertexData`
is 94% one anonymous loop in Babylon, and it is the same 24 positions, 24
normals, 24 UVs and 36 indices every time — a unit cube, rebuilt per part,
differing only by a scale and an offset. That is a thread the flatten left open
(`ENGINE_UPGRADE.md` S5), which was 656 ms at 900/300 and is **three times that at 1500 m**. And
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

**This is the same shape the flatten fixed, one layer down.** It stopped
the GPU half of the round trip — `device.createBuffer` for geometry no frame
draws. The CPU half was never touched, and at 1500 m it is bigger than the GPU
half ever was at 900. `src/world/parts.ts` is already the module that knows a
part is not a real mesh; what it does not yet do is let one avoid BEING one.

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
- **The oracle already exists and this change must not move a vertex.** A
  nav-graph fingerprint cannot see it — this is VISUAL geometry, and
  `npm run parity` is blind to it by design. What was compared instead, per map,
  is every mesh in `GameMap.visuals` and `GameMap.colliders` in list order: name,
  material name, metadata, position/rotation/scaling, `isVisible`, `isPickable`,
  `checkCollisions`, rendering group, outline flags, vertex and index counts,
  submesh count, `geometry.delayLoadState`, and FNV hashes of the position,
  normal, uv and colour buffers and of the index buffer. **All five maps hash
  identically** — Hollowmere, Greyfen, Coldharbour, Harrowmead and the proving
  ground — along with `scene.meshes`, `scene.geometries`, the active-mesh count,
  and a count of visuals failing `isReady(true)` after the map draws, which is
  zero on both sides. No script for it is committed; it has to be rebuilt.
  `plans/physics-ref/drop.mjs` covers anything that changes what a body stands
  on.
- **The collider half is BLOCKED and this does not unblock it.** `boxMesh`
  aggregates to 669 ms at 1500/0 (~430 at 900/300 before the flatten), but
  `moveWithCollisions` walks `mesh.subMeshes` and a part has none — see
  `parts.ts`'s header. A collider is not a merge candidate, so the mechanism
  above does not reach it.
- **The AO bake is now the second-largest named cost** — `occlusionAt` is
  1,738 ms subtree and 1,399 self, 9.3% — and it is not in the placement loop at
  all. It has never been questioned; `segmentHitsBox` under it is another
  1,021 ms of self time.
- **The garbage collector is 2,121 ms, 11.3% of the install**, which is the
  allocation pressure of everything above rather than a site of its own. It
  should fall with the round trip; if it does not, it is its own finding.

---

## 30. A body past `bodyDrawDistance` POPS, and no fade has been built

**Status:** the gate landed (`ENGINE_UPGRADE.md` S8, `EnvironmentSpec.bodyDrawDistance`,
stated by Sarab and Cinderhaven). What is open is how it ends.

- **A fade was not built.** The gate is a hard on/off, as `lodDisableDistance`
  always was, and it was invisible only because it sat where everything was
  already `fogColor`. If a stated `bodyDrawDistance` reads badly, a short fade
  band is the obvious next thing and nothing here has costed one.

---

## 31. The authority across a rotation: a rebuild in the same process gets slower, and no measured tick has had a person in it

**Status:** open. The tick itself is answered (`ENGINE_UPGRADE.md` S9, and
`docs/multiplayer.md`, "What a tick costs").

`buildServerWorld` is **1.25 s** at 1500 m against 235 ms on Coldharbour, and a
profile of the build alone attributes it to `segmentHitsBox` (19.3%) under
`CoverMap.bake` (3.8%), `severLinks` (10.2%) and `linkCells` (1.4%) under
`NavGrid`, and `buildField` (2.8%) for the seven flow fields. **The cover bake is
the largest single thing in the authority's install**, which is S3/S4/S5's
inheritance arriving exactly where they said it would — and a 1.25 s build is a
rotation cost nobody is watching, not a tick cost.

- **Why a rebuild in the same process gets slower**: rebuilding in the same
  NullEngine read 1.25, 1.36, 1.62 and 2.78 s over four consecutive rounds, with
  `map.dispose()` between them. A match server rotates maps for hours. Heap
  growth is the obvious suspect and nothing has isolated it.
- **Nothing here had a human in it.** No `LagComp` rewind ran, no snapshot was
  encoded, and `Match`'s own per-tick work — sixteen sockets, `validateMove`, the
  interest sets — is in none of the numbers above. What was measured is the
  SIMULATION's tick, which is what S9 asked for and is not the whole of what a
  server does.

---

## 32. Sarab: what a 1500 m map actually costs once it is a map — 91 fps, 2.4 s to install, and the two cheapest levers doing most of it

**Status:** measured on the shipped map. ENGINE_UPGRADE.md S11.

**Coldharbour's frame has roughly halved since this entry was written.** This
entry has it at 52.6 warm fps and a 19.3 ms median; the same map, same
resolution, same instrument class, profiler armed (which costs ~1.5%), now reads
94-99 fps and a 10.1-10.6 ms median. 1.9x is well past the ~1/3
cross-session drift this entry warns about, so most of it is real and is
presumably `narrowedMove` and the rig culling landing after it. **This entry's
table is stale enough to mislead anyone sizing a lever against it.**

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
three quarters of its frame time. `ENGINE_UPGRADE.md` S6 measured `blockSize` and
`terrainBlock` at 96 as worth a third of the frame and two fifths of the install
on the proving ground and said the value was "nobody's yet"; it is Sarab's, and
this is what it looks like spent on a real layout. The other half is `ENGINE_UPGRADE.md` S8's
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

**The density problem `ENGINE_UPGRADE.md` S9 measured is answered by the LAYOUT and not by
the engine.** On the proving ground five of eleven rounds ran the 45-minute cap
with tickets left on both sides and peak contact was 5 to 7 of 16. On Sarab
every round ended, in about the time a round takes on a shipped map, with peak
contact 8 to 12. What differs is not the extent — both are 900 m of play — but
that the flags are 200 to 290 m apart in a town rather than hundreds of metres
apart on a grid, and that the ground between them is transit. That is S10's
lever 1, and it is the whole of what was needed.

### What is open

- **Nobody has watched a body POP at 300 m.** `bodyDrawDistance` is stated for
  the first time here and finding 30's open thread — what the drop LOOKS
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
  forces contact, which is the wall `ENGINE_UPGRADE.md` S2 and S9 both hit. What sixteen
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

**The first half of this now EXISTS, built for the jungle palm** — see
`world/sway.ts`'s rig and `docs/rendering.md`'s wind section. A layer may be
`rig: true`, its builder writes each vertex's place on its own member into the
`uv` buffer before the merge (`swayRig`), and the shader reads that behind a
negative red channel. A drape would be the second rigged layer: `bend` running
from 0 at the head to 1 at the hem, and the shader's frond motion — pressure
downwind, a slow swing, a flutter at the edge — is close to what a hung sheet
wants already. Neither the cloth layer nor `kit/desert.ts` has been moved
across, so the workaround below still stands.

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
median tick and it is still 3.8% of the budget with nothing over it;
`docs/multiplayer.md`, "What a tick costs", already prices a driven hull and
this agrees with it.

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

## 38. `WorldCulling.offer`: who the disabled candidates are, and its own per-frame cost

**Status:** the drop landed (`docs/rendering.md`, the size gate). Two things
about it are open.

- **Who the ~420 disabled candidates ARE has still not been counted.**
  `setPools` already keeps an idle rig out of the list by its root, so a
  disabled mesh still being offered is either a pool never filed or a part
  disabled under an enabled root.
- **`offer` is `O(eligible)` every frame** and `isEnabled()` walks ancestors. A
  pool that told `WorldCulling` when it went live would cost nothing per frame,
  but it cannot use `setPools`' transition-marks-dirty route, because
  `rebuildList` is a full scene walk and effect pools toggle many times a frame.

---

## 39. Cinderhaven does not fit in a 144 Hz frame, and the only geometry with no LOD at all is a vehicle's — **the size gate is LANDED; the big levers are look decisions and are not**

**Status:** the gate is in (`WorldCulling.offer`, `CONFIG.graphics.culling.minPixels`).
The rest is measured and deliberately left to whoever owns the look.

### What the problem actually is

Two captures off the real machine, Chrome 152, Cinderhaven, at 3440x1440 and
1718x858. Both are vsync-locked at ~144 Hz — 2,655 of 3,000 frames sit within
18% of a single 6.9 ms interval — and the frame does not fit inside it:

| | tick | residue | total | budget |
| --- | --- | --- | --- | --- |
| 3440x1440 | 5.96 ms | 1.42 | **7.38** | 6.94 |
| 1718x858 | 6.40 ms | 1.44 | **7.84** | 6.94 |

So frames spill into a second interval and render at 72 fps: **1.90% of them on
the big window and 4.73% on the small one**, which is 1.6 and 5.4 doubled frames
a second. That is not a hitch, it is continuous judder, and it is separate from
the bursts finding 1 is about.

**The window size is not what prices it** — the BIGGER window measured FASTER
(135.2 fps against 127.2), and a `setHardwareScalingLevel` sweep across an
eightfold cut in pixels moved nothing. The frame is bound by how many meshes are
in it, not how many pixels.

### Where the meshes are

The candidate list on Cinderhaven is 969 offered for ~850 active, and the active
list is **rigs ~212, blocks ~203, terrain ~153, vehicles ~122**. Three of those
are governed: a body by `bodyDrawDistance` (420 here), a block by the cull cells,
the terrain by the frustum. **A vehicle is governed by nothing at all.** Every
hull draws every part at any range — measured with the running gear and the
fittings at 1,360-1,420 m, where `heli-whip` (16 cm), `heli-mg-ring` (14 cm) and
`truck-mg-ring` (17 cm) are well under a pixel.

### What landed, and what it is worth

A projected-size gate in `offer`: a mesh is not offered when its bounding
sphere's projected DIAMETER falls under `CONFIG.graphics.culling.minPixels`.
A size on the SCREEN rather than a distance in the world, so one number holds at
every resolution and field of view, and it tightens by itself when a sight goes
up.

Paired and alternating in one session at 3440x1440, against the same list with
the gate off:

| threshold | cinderhaven |
| --- | --- |
| 2 px | +1.4% fps, -0.11 ms |
| 3 px | +6.2% fps, **-0.51 ms** (6 reps) |
| 4 px | +6.3% fps, -0.51 ms |

**3 px is shipped**, because -0.51 ms is what the 0.44 ms deficit above needs.
Sarab reads +0.8% / -0.03 ms and the small maps read nothing — this is a
big-map, many-distant-hulls lever and does not pretend otherwise.

**Two classes are exempt and each was found by looking at what a naive gate
removed**, not by reasoning first. A POOLED BODY, because a rig is nineteen
meshes and a per-mesh test dropped `bot-head-m` x16 and `bot-legL` x16 while
keeping the torsos — headless soldiers at 300 m. And anything EMISSIVE, because
bloom carries a sub-pixel emitter far past its own geometry and this is a night
map full of lit windows; the test is exact rather than a name guess, since
`getEmissive` is the only source of a `StandardMaterial` in the tree and every
lit surface wears a `ShaderMaterial` with no `emissiveColor` to read.

### The bug this had, which the pixel bank could not catch

**The first version deleted the weapon out of the player's hands**, and the bank
passed anyway. `offer` runs in `Game.tick`, BEFORE `scene.render()` bakes world
matrices, and the viewmodel hangs off the camera — so its world bounding info is
still sitting at the ORIGIN when this reads it. Asked for its size, the rifle
answered **"1.8 px at 726 m"**, which is the distance from the world origin to
the player, and the gate dropped all fourteen of its meshes.

`bank.mjs --check` came back byte-identical on all 21 vantages **through both
the broken and the fixed version**, because `placeVantage` disables the bots and
the zones and the vantages hold none of what this touches. **The bank is
necessary and not sufficient for a change to the candidate list.** What caught
it was a screenshot pair taken in a live round at one frozen camera, with a
CONTROL pair taken under the same condition so the noise floor was measured
rather than assumed: the lever read 8.58% of pixels at mean 1.11/255 against a
control of 2.02% at 0.07. Fixed — group 0 only, and `infiniteDistance` skipped
for the sky — it reads 2.46% at **mean 0.066/255 against a control of 1.47% at
0.037**, which is the trim at 1.4 km and nothing else.

### The levers that are NOT taken, because they are look decisions

Both are larger than what landed, and both change what a player sees:

- **`bodyDrawDistance` 420 -> 300 on Cinderhaven: +21.4% fps.** One number in
  `environment.ts`. Bodies pop 120 m closer. **Half of this is now TAKEN, and
  by the gate rather than by the number**: a body is measured off its rig root
  and dropped whole, so the size gate reaches a soldier for the first time and
  is a `bodyDrawDistance` stated in SCREEN space. It needs no per-map value
  and it costs a desktop nothing — at the shipped 3 px a body drops at 810 m
  on a 1080-tall viewport, past every map's own body distance — while on a
  384-tall phone viewport it drops at 290 m and takes half a Coldharbour
  roster out of the candidate list (688 offered -> 575). What is still open is
  the per-map number, which is the only lever that reaches a DESKTOP.
- **A vehicle draw distance at 420 m: +15.4% fps.** Hulls would vanish where
  bodies do. By SIZE that is the wrong number — a hull is ~4x a body, which
  puts it past `fogEnd` — so a hull's distance is its own question and nobody
  has answered it.

### What is open

- **A vehicle DETAIL tier**, keeping the silhouette and dropping the running
  gear, measured at +6.5% / -0.55 ms at 300 m. Not taken because the detail set
  is an art judgement: the naive set included `tank-link` (3.26 m) and
  `tank-wheel` (3.02 m), and `TankModel`'s own comment says the road wheels
  filling the track hole ARE the silhouette.
- **The gate is `O(eligible)` with a bounding-sphere read per candidate.** At
  2 px it does not repay that on any map measured; it is only worth having
  because 3 px does on the biggest one.
- **A `sqrt` per candidate measured as a LOSS** — comparing squared is what
  made the low thresholds stop costing more than they saved.

---

## 42. The ground's relief DEPTH is unmeasured for aliasing, and unmeasured on a phone

**Status:** open. The depth (parallax and self-shadow over the ground's height
maps — `docs/rendering.md`, "A slope is not a depth") was judged by eye in
still frames and priced on one desktop GPU. Neither of the two questions a
per-pixel march raises was measured.

### What was measured

- `gpu.frame`, at eye height down a street in a 1920x1080 headless frame on the
  Windows box, 600 frames settled in `deploy`: **Cinderhaven 1.61 → 1.93 ms,
  Harrowmead 1.54 → 1.50 ms**, frame rate within 3% on both (71.8/72.2 and
  103.5/100.2 fps, one run each — the frame is draw-call bound).
- Still frames on all six maps, at dusk, noon and night, against
  `reference-media/visuals.jpg`.

### What is not

- **Aliasing and crawl in MOTION.** The slope's own aliasing was measured against
  a 4x supersampled reference (`docs/rendering.md`, the world-space slope
  bullet: 0.85% off-reference on Coldharbour's lit streets as shipped). That
  figure has not been re-taken with the depth on. The self-shadow's edge is a
  0.03-of-height smoothstep and nothing in the pipe antialiases it, so a
  shadow edge per sett is thousands of new hard edges per screen; the
  parallax's crossing moves with the eye by design and could crawl on a slow
  strafe. The two fades (8–22 m and 30–60 m) are smooth, but a ring the eye
  finds would be a camera-locked shape of exactly the kind the rim light was
  gated off level ground for.
- **A phone.** Up to 12 layers, 3 refines and 8 shadow taps per ground pixel
  inside the fades, on a device whose GPU was never the budget here. Nothing
  gates it but the fades.

### How to settle it

Re-take the supersampled comparison on Coldharbour and Harrowmead with
`CONFIG.graphics.relief.shadowStrength` at 0 and at 1, and with the parallax
fade pulled to 0, standing still and after a slow strafe. On a phone, a
`?profile&gpu` capture down Cinderhaven's harbour street with the relief on and
with both fades pulled to zero. If either is bad, the lever is the fade
distances and the step counts in `CONFIG.graphics.relief`, not the height maps.

---

## 43. The bloom is a SECOND GEOMETRY PASS over every lit window in view — 123 draws on Coldharbour, and the only lossless lever left is an EMISSIVE palette

**Status:** decomposed and measured on the Windows box under a CPU throttle at
the phone's viewport. One free lever found and **LANDED** (the mask materials
were the only unfrozen `ShaderMaterial` in the tree). Everything else is a look
decision or the palette below, and none of it is taken.

Opened by a phone capture (832x384, Android, Chrome 153) where `glow` read
**1.44 ms mean and 3.1 p95 of a 20.1 ms frame** — 7% — against **0.21-0.30 ms**
on the desktop reference captures. Everything else on that device is ~2.4x its
desktop cost, so a 5-7x gap said the glow was doing something the rest of the
frame was not.

### What it is NOT, which is most of the entry

Paired and alternating in one boot, 5 reps of 260 frames each, 4x CPU throttle,
832x384, Coldharbour, a live round. **Read the pairing and not the absolutes**
— an unpaired first attempt drifted enough that a variant with strictly less
work in it came out 18% SLOWER, which is the methodological half of this entry.

| B against baseline A | `glow` A | `glow` B | delta |
| --- | --- | --- | --- |
| the mask's mesh draws removed | 5.16 | 1.10 | **-4.07** |
| …capped at 3 meshes | 4.40 | 1.32 | -3.08 |
| …capped at 1 mesh | 4.76 | 1.22 | -3.54 |

- **Not the BLUR.** Four separable passes and the compose survive in every row
  above and the floor is 1.10 ms.
- **Not the per-mesh WALK.** The `list-only` row runs `buildList` in full over
  the whole active list and throws the result away: that is the -4.07 row.
- **Not a pathological per-DRAW cost.** 0 -> 1 -> 3 meshes is 1.10 -> 1.22 ->
  1.32, so a mask draw is ~26 us throttled, ~6.4 unthrottled — an ordinary
  draw. **There are simply 123 of them.**
- **Not the mask's RESOLUTION.** It is full backing-store on purpose and pinned
  twice: depth sharing needs it at the frame's size, and `CelInk` reads it as
  its emissive mask. Half-resolution is not available here.
- **Not anything that could be culled EXACTLY.** `GlowRules.colour` already
  fades a bloom toward black with the fog, so a mesh faded out contributes
  nothing and could be skipped for free — measured, **0 of 119 are under even
  4/255 of peak**, the dimmest being 0.168 at 365 m. Coldharbour's fog is too
  gentle at its own scale for this to find anything. Do not re-run it there;
  it is worth asking again only on a map whose fog actually closes.

### What it IS

**123 emissive meshes in the mask on Coldharbour in a street view** — three to
four per 48 m block, because the block merge splits once per emissive colour
and **emissive is exactly what the albedo palette refuses** (finding 18: gloss,
translucency, glazing and emissive are shader BEHAVIOUR, not a uniform). A
block contributes `#ffd79a`, `#4e3a1f`, `#4e3a1f-over-glass` and `#ff5a4a` as
four meshes, and the mask draws all four with ONE material and one
`glowColor` apiece.

**The count is a camera fact and not a map fact, which is what made this hard
to see.** A frozen bank vantage holds five; the deploy screen holds 35; a live
street view holds 112-123. An earlier reading of "five" is the vantage's and
must not be quoted for a round.

### What landed

**`GlowMaskMaterial` was the only unfrozen `ShaderMaterial` left in the tree**,
and it was an omission rather than a decision — `FlameMaterial.glowMask`
already freezes the twin it hands this same pass. `ShaderMaterial.isReady`
rebuilds the whole define set for every submesh of every draw before it can
answer (`docs/rendering.md`, "Frozen materials": a fifth of everything this game allocates), and the define
set here is fixed at construction because it IS the cache key.

Paired, 5 reps, frozen against unfrozen: **`glow` 5.26 -> 5.98 ms, -0.72 ms,
and the sign is the same in all five.** ~14% of the pass. Byte-identical
picture — a frozen/unfrozen/frozen triple in `deploy` with 35 emissives in the
mask reads **0.0000% of pixels and max 0** on both the control and the lever,
which is the `glowColor` push still flowing through `_mustRebind` as
`CelMaterialFactory.remember` says it does.

### The lever that is NOT taken, and it is the big one

**An EMISSIVE palette, the albedo palette's twin.** It would collapse a block's
three or four emissive meshes into one and take Coldharbour's 123 to roughly
40, and it pays **twice** — those meshes are drawn once into the world and
again into the mask, so ~1 ms of `glow` and ~1.6 ms of `drawWorld` on the
phone, ~2.6 ms of a 20.1 ms frame. It is lossless, exactly as finding 18 was.

**What makes it a project rather than a change** is that an emissive is an
unlit `StandardMaterial` and not a cel `ShaderMaterial`, so there is no vertex
path to put a colour on: `StandardMaterial.emissiveColor` is a uniform and
vertex colours multiply DIFFUSE. Converting it touches `getEmissive`,
`EmissiveFog`, `GlowPass.buildList` and its mask shader, `GlowRules.colour`,
`WorldCulling.glows` and the merge key — six readers that all ask a material
"what colour do you emit" and would have to ask a vertex instead. Cost it
before starting it.

The two cheaper alternatives are both LOOK decisions and neither is costed: a
bloom quality rung (the shape `volumetrics` already has, and there is no glow
setting today), and a distance cap on the mask, which the measurement above
says would have to be well inside the fog to remove anything.

---

## 44. The irradiance volume is priced on ONE desktop GPU, its low tier is not proportionally cheaper, and contact shadows were not built

**Status:** open. The volume (`docs/rendering.md`, "The irradiance volume") ships
on by default — `high` on a fine pointer, `low` on a coarse one — and every cost
below is the RTX box's.

### What was measured

Uncapped (`--disable-frame-rate-limit --disable-gpu-vsync`), headless 1920x1080,
at each map's menu vantage in `deploy`, cost read as the frame-time difference
with the three dispatches stubbed out of a live page:

- **The first version cost 4-5 ms of GPU** (Coldharbour 1.5 → 5.5 ms
  `gpu.frame`, ~275 → ~150 fps). Split by pass: compose 1.77 ms (two fast
  lights live), visibility 0.85 ms, trace 0.22 ms.
- **Three levers took it to ~0.05-0.7 ms**: visibility kept per LIGHT rather
  than per slot, and re-traced only when a light is new or moves (0.85 →
  ~0.02 ms); fast rays bounded by the light's own reach and the flicker of
  fires only within `flickerReach` (compose 1.77 → ~0.03 ms); one fixture per
  hit and the terrain march's two exits (Hollowmere's trace 1.45 → ~0.44 ms at
  1,024 probes a frame).
- As shipped, high: Coldharbour ~0.05-0.55 ms, Hollowmere ~0.4-0.7 ms,
  Cinderhaven ~0.1 ms; Hollowmere under a staged firefight (four guns, a blast
  a second, a fast fire) +0.3 ms. Low on Hollowmere ~0.34 ms. **The ranges are
  this box's own floor**: the stubbed baseline itself moved between 729 and
  941 fps across runs of identical configuration.
- CPU: the `gi` phase, 0.08-0.14 ms. `drawCalls` unchanged.
- **Stillness**, on a frozen frame against a byte-identical GI-off control:
  Hollowmere 0.005% of pixels at 1/255; Sarab 0.0075% at 1/255 once settled
  (0.08% at up to 13/255 four seconds after placing the camera, while the
  multi-bounce iteration was still shrinking). At `blend` 0.25 it was 5-13% at
  up to 52/255 — see the config field.

### What is not

- **A phone, at all.** Low was chosen for a coarse pointer on the ~2.4x ratio
  in 43, not on a measurement.
- **Why low is not proportionally cheaper.** It traces a fifth of high's rays
  (384 probes x 32 against 1,024 x 64) for about half the time. The suspect,
  derived and not measured, is LATENCY rather than throughput: each trace
  workgroup relocates its probe and casts the sun ray on ONE thread with the
  other 31-63 waiting at a barrier, so a small dispatch is as slow as its
  slowest few workgroups. Moving the relocation to the CPU (it is a pure
  function of the column and the boxes) and the sun ray into the ray loop
  would test it.
- **In a round, moving.** Every number is at a still vantage. A sprint scrolls
  a column every ~0.3 s and a hull at speed several a second; each exposes
  `columns x layers` probes that read as the flat path until traced (they are
  in the edge fade, which is why nothing has been seen, but it is unmeasured).
- **Contact shadows were NOT built.** The plan had a screen-space march along
  the key light against the frame's depth, inside the cel fragment. It needs
  last frame's depth, which lags a frame under a fast turn — a shadow that
  swims is the one artefact this look will not take — and the volume's own
  2 m spacing does not reach contact scale. Still the lever for a crate on a
  floor.

### How to settle it

On a phone: `?profile&gpu&gi=low` and `?gi=off` captures at the same vantage
on Hollowmere and Cinderhaven, and a sprint down a street with each. If low is
over ~1 ms there, the first lever is the latency test above, then
`probesPerFrame`.

## 45. The lamps' shadows and the shadow rungs are priced on ONE desktop GPU, and three things about them are open

`systems/LocalShadows.ts` and `CONFIG.graphics.shadowTiers` shipped measured
only on the RTX box (`docs/rendering.md`, "The lamps' shadows"): the high rung
is ~+0.1 ms of GPU and +3 draws over shadows off on Hollowmere and Cinderhaven,
uncapped, at a staged street with eight soldiers round a lamp and a moving spot.
The `low` rung was chosen for a coarse pointer on finding 43's ~2.4x ratio, not
on a measurement.

- **Nothing is measured on a phone.** `?profile&gpu&shadows=low` against
  `?shadows=off` at the same street on Hollowmere and Cinderhaven. If low is
  over ~1 ms there, the levers in order: `every` (hold dynamic tiles longer),
  `taps` (already 1), the sun map's size, then `lights` to 0 on that rung.
- **The shadow HOLD (`shadowTiers[q].hold`) is priced on the desktop only.**
  The nearest thing to the phone this box can stand up — Greyfen at `low`,
  832x384, a 4x CPU throttle, the same turn, three reps each — moved the most:
  **redraws 41.6/s -> 5.7, `shadowPass` 2.67 -> 0.73 ms, the tick 17.56 ->
  15.97 ms and 46.6 -> 51.0 fps.** **Open: the phone itself**, where the capture that
  prompted this showed the pass on 80-90% of frames at ~1.8 ms of CPU; a
  `?profile&gpu` capture on Greyfen at `low` is what prices it there.
- **The first-bake frame is unmeasured.** A fixture's static tile is baked from
  the real meshes over `staticFacesPerFrame` faces a frame; walking into a
  street of lamps queues several. It has not been captured as a hitch and has
  not been looked for — a `?profile` capture sprinting down Coldharbour's lit
  streets would say.
- **A fixture's static tile never learns a pane broke.** It is baked from the
  visuals and glazing is not a caster, so this is right today; the day a
  DESTRUCTIBLE building exists (the memory's "destruction stages" plan), a
  fixture whose room changed owes a re-bake and nothing asks for one.
- **The volume still traces visibility for a slot the atlas holds.** Harmless
  (the shader picks the atlas), and the vis pass is ~0.02 ms, so it was left.

Also open and not a cost: the atlas face-seam shows as a hairline where two
faces of one cube meet at a grazing receiver, because each face clamps its taps
a texel inside its own tile. Not seen in a screenshot yet; a filter across the
seam is the fix if it is.

## 46. The grass field is priced on ONE desktop GPU, and on a phone nothing is measured

**Status:** shipped measured on the Windows box only. `docs/rendering.md`, "The
grass", is the contract; this is what is not yet known about it.

### What was measured

Harrowmead's pasture, four vantages (standing in the field, crouched in it,
looking down its length, and a 12 m overlook), the field hidden versus drawn in
ONE session so the run-to-run spread cancels (the scratch script toggled
`grass.follow` and hid every patch mesh; conditions interleaved `off, high,
medium, low, off`):

| | 1080p, uncapped | 4800x2700 (render scale 0.4), uncapped |
| --- | --- | --- |
| off | ~500 fps, CPU-bound | 143–158 fps |
| `low` | inside the noise | −0.6 ms |
| `high` | −1% to −7% | −0.9 ms |
| the OLD sparse field, same vantages | — | −0.1 to −0.15 ms |

**It is PIXELS.** Cutting the blade vertex work by about a third (√½ LOD steps
and one-triangle far blades) moved none of those numbers, and hiding the turf
alone gave back ~0.2 ms of the 0.9. The fragment stage is the cel shader's whole
model — four-band key through the shadow maps and the cloud field, the lamp
loop, rim, mist, fog — over a lot of overdraw.

The profiler's `?gpu` whole-frame counter read ~6 ms in EVERY condition on this
box, grass or none, so it is not the instrument for a cost this size here; the
GPU-bound frame rate is.

**The mask bake** is 120–270 ms on six maps and 443 ms on Harrowmead, whose
borderland ring makes its mask 1440 m across at 0.7 m a texel (2048² — the cap).
Two thirds of the first version's 1.1 s was four road queries per texel; one
padded query per 8 m patch and then per texel took it down.

### What is open

- **A phone.** `?profile` with the settings screen's Grass row at `low` against
  the field hidden (there is no `off` rung; hide it from the console as above),
  standing in Harrowmead's pasture and on Coldharbour's square. If `low` is over
  ~1 ms there, the levers in order: `tiers.low.turf` (the sheet is cheap in
  vertices but it is a second layer of ground pixels), `tiers.low.reach`, then a
  cheaper fragment stage for the far blades — the lamp loop and the rim are the
  terms a far blade needs least.
- **The mask's memory on a phone.** 16 MB of GPU texture at the cap, plus ~100 MB
  of transient typed arrays during the bake. Neither has been watched on a
  device that could run short.
- **Growth of a patch buffer mid-round** is the one path that can take the WHOLE
  frame down (`docs/rendering.md`'s third rule). It was tested by shrinking the
  starting capacity to four patches and walking Harrowmead through three rung
  switches: buffers grew to 32x, no GPU validation error, every frame drawn.
  Re-run that if anything about how the patch meshes are made changes — and it
  is not covered by `npm run parity` or the reference bank.
