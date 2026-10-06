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

**Status:** still open, but its central conclusion now stands on the FIXED
instrument. **The instrument was pairing each frame's wall clock with the NEXT
frame's spans** — see "The pairing bug" below — and every per-frame reading
taken before report version 4 was argued from that. It was re-taken the same
week on v4-v9 (the sections from "What is left" down), and **"the stalls are
not the page" survived it**: the browser did not schedule the frame, the main
thread was idle through it and the GPU was idle through it. What is open is:

- **(a) the SECOND population of stalls**, which IS the tick and lands in a
  different phase each time — one stall absorbed wherever the frame stands, or
  four real faults; more captures settle it.
- **(b) the event at frame 2291** that stepped allocation up for good — a
  capture with `--enable-precise-memory-info`, so `heapLive` can size it.
- **(c) a laptop capture, on battery at 60 Hz and on AC at 120 Hz** — the case
  this entry was opened for. Every desktop capture so far is the 3432/3440
  panel; the tablet and the phone below are the only other devices.
- **(d) the capture the pipeline hook was built for** under the first-use
  hypothesis. The hook is in (report version 11: `pipelines`, and
  `createdOn`/`createdNear` on every hitch — `docs/profiling.md`, "Compiles");
  what is owed is a round with combat in it on this panel. **The phone's is
  taken** (finding 13): one hitch in 151 sat on a creation — the first blast,
  finding 16 — so on that device the first-use hypothesis is not what drops
  frames.

**A collector reading taken HEADLESS AND UNCAPPED nearly closed this wrongly.**
At 220-700 fps the game allocates the same ~200 kB a FRAME and therefore two to
seven times as much per SECOND as a real session does, which wakes the
collector at 1.5-1.8/s and makes GC frames 1.7x-4.5x the cost of a clean one —
a tidy, wrong answer. On the real machine the rate VARIES — **2 collections in
31.4 seconds (0.06/s)** on one Sarab capture at 95 fps with `gc: 0` on every
hitch, and `gcPerSec` 2.77, 1.49 and 1.62 on the Cinderhaven captures below —
and it does not matter which, because **the collector is exonerated** by the
table in "…and the collector is EXONERATED" below. **Do not measure allocation
pressure uncapped**; the rate per second is what the collector responds to, and
uncapping fabricates it.

### What was measured

On a laptop panel that runs 120 Hz on AC and 60 Hz on battery, with the
in-game readout (`#hud-fps`, added alongside the settings screen) — **on the
WebGL engine**, before the WebGPU boot (the table is already in 3ed9fec, before
791d1ae), and **never re-taken on the profiler**, which is ask (c) above:

| power | rate | frame time | 1% low |
| --- | --- | --- | --- |
| AC (120 Hz) | >60 | — | — |
| battery (60 Hz) | 60 | 17 ms | **28** |

The counter itself is sound: `Engine.getFps()` is `1000 / mean(frame
interval)` over a 30-frame rolling window, sampled once per `beginFrame()`,
and it agreed with an independent `requestAnimationFrame` count over a
four-second window to **0.9%**. There is at most one `beginFrame()` per rAF
callback in Babylon's `_processFrame` — at most, since `src/core/FrameCap.ts`
refuses a refresh before the next frame is due and a refused one runs nothing
of the engine's frame — and the game has a single
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

### The headless, uncapped GC reading — OVERTURNED

**Kept as the wrong answer this entry nearly closed on; the paragraph under
the status and the exoneration table below are what overturned it.** It ran
uncapped at 222-700 fps, which fabricates the per-second allocation the
collector responds to.

**Taken on the Windows box, on the then-current tree, with a REAL round
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
the other end — headless and uncapped, which is what made it look like one.

Hollowmere's worst frame was read as the shape this section had predicted:
**27.6 ms of wall clock whose phases add up to 2.4, with `gc` on it.** That is
a v3 per-frame decomposition, taken before the pairing fix — **do not argue
from it**; under that pairing the 2.4 may well be the next frame's spans.

**The allocation rate is ~50 MB/s and it is the same 50 on every map**, which
is the tell that it is not the world: hollowmere 52.5, coldharbour 54.0, sarab
54.5, cinderhaven 49.2, over frame rates from 222 to 700.

**The other four fifths.** The fifth that went was `ShaderMaterial.isReady`
rebuilding every material's define set per submesh per draw, removed by
freezing every cel material (`docs/rendering.md`, "Frozen materials"). Of what
is left, Babylon and the builtins it calls are ~64% and our own code ~36%, and
our share is spread over forty sites with the largest at 4% — a thousand cuts
rather than an actor. Nothing here has costed the WebGPU backend's own
per-frame objects (`getBindGroups`, `_startRenderTargetRenderPass`), which are
the next largest block. **That split predates Babylon 9.28 (96fcd19) and the
allocation fixes a804a66, 0bbc3c6, 211fdb2 and 7085da7** — re-take it before
arguing from it.

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
  **18.4 ms in the residue** (a v3 per-frame decomposition, before the pairing
  fix — not to be argued from; the aggregate split beside it stands).

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
**The hook is BUILT** (report version 11, `docs/profiling.md`, "Compiles"): a
capture now carries every creation filed against its frame and named by
effect and define set, and each hitch says how many landed on it or the two
frames before. What is left is taking the capture.

### The pairing bug, which is where the leftover was coming from

**Fixed in report version 4. The mechanism, the worked example (Cinderhaven
frame 2424, a 90.6 ms tick filed as "82 ms outside the game, gc 0") and the
contract are in `docs/profiling.md`, "The phases".** What only this entry
carries: over the three vsync-off captures that found it (Chrome 152, 3440x1440
G-Sync fullscreen, two Sarab and one Cinderhaven), the minimum residue as filed
was **-60.5 / -35.2 / -20.2 ms** with 133 / 133 / 87 negative residues, and
+0.1 with none on all three shifted one row; under the correct pairing **18 of
21 hitches on the Cinderhaven capture and 8 of 9 on one of the Sarabs are the
previous frame's tick**. Verified after the fix in a real round under an 8x CPU
throttle: minimum residue +0.30 ms over 884 frames, and 7 of the top 8 hitches
attributed to their own tick, which is what a CPU throttle should produce.

### What is left, and the instrument that now splits it

**The residue is real and it is no longer un-nameable**: the
`long-animation-frame` probe (report version 5) tells a busy main thread from
an idle one, and how to read it is `docs/profiling.md`, "The residue splits in
two". Verified two-sided before it was believed — a planted 120 ms `setTimeout`
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
seventh — the GPU — is dead too as of the next section**, measured rather
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

**The reading was nearly zero for the wrong reason**: without
`--enable-unsafe-webgpu` the whole-frame counter records real zeros and the
capture looks healthy. Fixed as `gpu.frameMeasurable` (report **version 9**);
the mechanism is `docs/profiling.md`, "GPU time". Every headless GPU number in
`VERIFYING.md` had the flag because `launchClient` in `scripts/browser.mjs`
(re-exported by `plans/webgpu-ref/harness.mjs`) passes it.

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

### The instrument bugs this capture found, all fixed

A long frame read as a busy main thread, an absence under 50 ms read as an
idle one, and a starving `loaf.worst` — all three, and the fixes, are in
`docs/profiling.md`, "The residue splits in two".

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

### Two captures off other devices, recorded only in commit messages

- **An Android tablet, Sarab and Cinderhaven, 60 Hz panel (8b61b2c).** The
  commit message records the frame after a 35-55 ms wait running every phase
  2.5x slower on a clocked-down CPU and `zones` 4x, because the flag cloth
  caught up five or six substeps behind it; 8b61b2c capped that catch-up at
  four. Not in the message, and recorded at the time from the v9 captures: the
  tablet held 60 on Harrowmead and ~45 on those two, the tick was BIMODAL (~9
  or ~23 ms, every phase at once), a wait of over 15 ms preceded 90-98% of the
  slow ticks, and after the cap both maps were reported holding 60 — more than
  the cap alone explains, so the loop breaking or the conditions differing may
  be part of it.
- **A phone on Greyfen (96cef43)**: 16, 16, 16, 70 ms with the main thread
  IDLE through the long one — 30 fps on average and a stall four times a
  second. That is this entry's shape on a phone, and what it bought was a
  frame-rate cap (30/60/unlimited on the settings screen) rather than a cause.
- **A phone on Greyfen again, twelve captures with and without `?gpu`
  (finding 13)** — the same shape, 7-24% of frames held with the main thread
  idle, and it narrows the field: not the collector, the compiler, the frame
  cap or the GPU timer, and not the display (the menu holds 60 exactly). The
  GPU ran 11-14 ms and standing still the drops did not follow it; they follow
  the TICK, which reads as the phone's CPU slowing rather than any one phase
  growing.

### Candidates, as they stood before the capture

- ~~**GC.**~~ **Superseded by the exoneration table above.** The headless
  Hollowmere reading this bullet quoted (2.2 collections a second, 27.4 MB/s)
  is in `docs/profiling.md`, "The heap and the collector".
- **The shadow depth pass** (see `docs/rendering.md`, "The shadow rungs") — but that is a *steady* per-frame
  cost, so it fits the mean sitting at 60 rather than the spikes. **And 52579ed
  took it off most frames**: turning at 90 deg/s the two static maps now redraw
  ~12 times a second rather than 127-232 (the bodies' map still redraws every
  frame).
- ~~**HUD `innerHTML` rebuilds.**~~ **False of today's tree**: `HUD.ts`'s header
  says per-frame writes never touch `innerHTML`, the magazine strip, the
  grenade pips and the flag strip are rebuilt only when their SIZE changes, the
  damage arcs are a fixed pool, and the scoreboard's frame is built once with
  its lists rebuilt only while Tab is held. A killfeed line is still built as
  markup, once per kill.
- **`ConquestSystem.planSquads`**, called by `BattleSystem.updateSquads` on its
  timer (`CONFIG.bots.squad.updateRate`, 2 Hz).
- **WebAudio node churn** in `Sfx` — nodes are created per voice.
- The browser compositor, or anything else on the machine.

### How to settle it

**The instrument is built** (`FrameProfile`, `docs/profiling.md`); what is
missing is a capture off the LAPTOP this entry was opened on. Arm it there, on
battery, play for a minute, press `F3`, and read the hitch list against the
sections above — with `--enable-precise-memory-info` if it is a browser that
can be started with flags, which also answers (b).

Worth capturing the AC case properly at the same time, which the same capture
does for free: `frame.mean` distinguishes 120 Hz (~8.3) from 60 Hz (~16.7)
directly, and `frame`'s own share against it says how much of the interval was
even the game's.

---

## 5. The fill-rate budget: six full-screen passes and 18.7k particles

**Status:** counted, not costed, and now partly *steerable* — the lever this
entry asked for exists.

**Re-counted on WebGPU and the shape is unchanged**: the post chain is all still
there, and the ash field is a `ComputeShaderParticleSystem` (WebGPU
routes `GPUParticleSystem` to compute rather than transform feedback — no import
and no code changed) with `randomTextureSize` 8192. Its capacity on Hollowmere
is `Atmosphere.fit`'s `ceil(count / 3 × MAX_LIFE)` = ceil(4000 / 3 × 14) =
**18,667** (`hollowmere/environment.ts`, `Atmosphere.ts`), under the 32,000
`particlePoolCeiling` — the 14,934 this entry once recorded does not follow
from today's code. The particle count is a MAP number and
moved with the maps, not with the backend. **What is now costed is the post
chain, and it is small**: a WebGL2-era run put the whole of it at ~1% of
Coldharbour's frame (47.3 against 46.4 fps), and detaching the chain later read
-4.6%, free within drift (`docs/profiling.md`, "Reading a capture") — **stale
as a share**, since that frame was ~21 ms and Coldharbour now runs at 122 fps
(~8 ms, 96fcd19). `renderScale` is measured on
the desktop, and on a phone only at its lowest rung (below). On a phone
the passes were priced and are not the lever — finding 13: at render scale
0.5 on Greyfen, taking motion blur and the grain off moved `gpu.frame` by
nothing measurable, and the dropped frames there do not follow the GPU.

- **Six full-screen passes at the render resolution at defaults**, in the order
  `Game.ts` (~1343-1405) builds them: `CelInk`, the `GlowPass` compose (behind
  its own mask and separable blur passes), FXAA, `Volumetrics`, `MotionBlur` and
  `PaperGrain`. Three of them are detachable by a setting (`core/settings.ts`,
  `motionBlur`, `paperGrain`, `volumetrics`). The grain is no longer a
  trivial pass: its world-pinned paper measured ~0.25 ms of GPU at 1920x1080. The god-ray detach took the chain
  down by one for most of a round while the shafts were `GodRays`; **that saving is
  gone**, because `Volumetrics` replaced it and is ON by default — only `off`
  detaches it. Measured at ~0.75 ms of GPU (`docs/rendering.md` has the per-rung
  table) — **before c81fd76 put a body-shadow sample in every tap and 2fee69c a
  cloud term**, so re-take it.
- **The resolution itself is now a setting** (`Settings.renderScale`, three
  rungs of the display's native pixels, `Game.applyRenderScale`). Note what the
  investigation behind it turned up, because it changes what this entry means:
  the engine was never rendering at native resolution at all. Without
  `adaptToDeviceRatio` the backing store matched the CSS pixel grid, so on a 2x
  panel every number here was being paid at a QUARTER of the display's pixels
  and upscaled by the compositor. The default derives back to that — exactly
  only at dpr 1, 1.333 and 2, since `defaultRenderScale` rounds `1 / dpr` to
  the NEAREST rung (`core/settings.ts`) — so nothing has moved there, but 75%
  and 100% are now one keypress away. **On the desktop that cost is measured
  and is nothing**: `docs/rendering.md`, "Why the frame is draw-call bound",
  swept `setHardwareScalingLevel` across 16x the pixels on Coldharbour and the
  frame was flat. **On a phone the rungs are still unmeasured against each
  other**; the one phone captured (finding 13) was on the lowest, 0.5, and
  0.75 against it is that entry's control for whether fill matters at all.
- **The ash field is 18,667 alpha-blended GPU particles** (`getCapacity`, at
  steady state). Simulation is on the GPU and cheap; the overdraw is not.
- **The glass FRAGMENT's reflection has no distance fade.** The
  parallax-corrected cube fetch in `reflectBoxDir` is its most
  expensive term, and past ~100 m the reflection is motion and colour rather
  than a picture. Fading the cube's weight to zero over a band and branching the
  fetch out below a threshold is the shape. `reflectBoxDir` is WGSL now
  (`src/shaders/wgsl/includes.ts` ~882), sampled with `textureSample`, still
  unconditionally (`CelShader.ts` ~1589-1592), and the fade is not built. **It
  is a PHONE lever only** — the desktop frame is not fill-bound.

Neither the resolution nor the ash field should be cut by default. If a graphics-quality preset
is ever wanted, these are what it should move, in that order.

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

One question is settled: **86% of the time is inside Havok's
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
- **It is capped and gated.** Eight at once, and none past `death.maxDistance`,
  which `bodyDrawDistanceOf` resolves to at most the map's `fogEnd`. The cap
  is what makes the cost bounded rather than a function of how many people are
  dying — and it still is, now that a ninth body EVICTS the oldest corpse rather
  than being refused: the eviction changes which bodies are falling, never how
  many. The unused slots are free (four corpses cost 0.061 ms in a pool of four
  and 0.062 ms in a pool of eight).

The static world build is separate, one-off and CLOSED: since cd8d2a8 the map
is one static body per 48 m block rather than one compound
(`PhysicsWorld.buildWorld`, `docs/deaths.md`), so the 33–50 ms for 733 boxes
and 25 terrain blocks once recorded here is pre-cd8d2a8 and does not describe
it. The per-step body walk that the single body was reasoned around was
measured in the same commit and is free — a substep is 36/36 us against one
static body and 35/31 against 1,023 (`PhysicsWorld.ts` ~349).

### What is still open

Why the two runs disagree by more than an order of magnitude — and there is a
third figure beside them, **0.279-0.290 ms/step for eight falling corpses**
(`docs/deaths.md`, the bone-count A/B), from a third harness. Until that is
resolved on real hardware, no absolute is worth quoting; the re-measure is the
more careful of the first two (spawn outside the timed region, 1,600 timed
frames, a zero-corpse control that reads exactly 0.000 ms) but it is still
SwiftShader.

### How to settle it

**It is cheap now**: `FrameProfile` has a `physics` phase under `world`
bracketing Havok's step and its three clients (`FrameProfile.ts` ~153, ~266),
so one `?profile` capture on real hardware with several corpses falling reads
it in the page's own frame loop. If the original stands, the lever is fewer
substeps while several corpses are live — `hasSettled`'s velocity poll is known
not to be it.

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
frame it first happens**, against a 6.8 ms frame beside it (both before
Coldharbour's re-lay in 6e848a1, which took its collision bake from 800 to
1,772 boxes — the probe count and the list are not today's). It is still a build
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
not was that it was past the diagonal of every map then in the tree and past
the longest `fogEnd` any of them declared. **That is no longer true of what
ships.** Sarab is 900 m (a 1,273 m diagonal), but its `fogEnd` is 560, so
everything the cull drops there was already flat fog colour. **Cinderhaven is
not covered**: 1500 m, a 2,121 m diagonal under a `fogEnd` of 1,250, and it
ships see-through glazing (the shophouses' breakable, unbacked panes,
`kit/city/shophouse.ts`) — so a mesh 800-1,250 m from one of its probes is cut
while it would still draw partly through the fog, and **the hole this entry
refused a 140 m cull over is now on a shipped map**. Nobody has looked at it
(`ReflectionSystem.ts`'s `neighbourhood` header says the same).

**And it is the smallest of the three levers wherever it has been measured**:
on the 900 m proving ground it takes a probe's list from 928 meshes to 864 — 7%
— because the probes all stand inside the middle 900 m of a 1500 m floor. This
entry's second arm ("the shape to reach for is fewer PROBES") is in as a
`poolBudgetMiB` ceiling that no map in the tree reaches. **What actually took
the bake off the device was neither**: spending it over frames at 50,000 draws
each. A descriptor heap is recycled per SUBMISSION, so the largest single frame
is what the ceiling is against and the total is not — which is the sentence
`ENGINE_UPGRADE.md`'s wall 5 had backwards. Coldharbour's forty probes were
41,934 draws and landed on one frame — **before its re-lay (6e848a1)**, and if
the re-laid map's draws now pass 50,000 the bake spans two frames. Re-count it.
Hollowmere's probe count is likewise pre-re-lay (5806a24).

**The bake also waits for the irradiance volume now** (659b58f): releasing is
held until `GiVolume.converged`, so no cube freezes the volume's first pass —
~18 more frames under the building card, plus the first compile.

### Also open, carried from the bake's closed entries

**A bake draw is ~18.6 us and nobody knows why.** The figure was taken just
before per-face culling (edc9ccf), and that commit's own figures still work out
to ~18.7 us per ISSUED draw, so the per-draw cost survives — but "50,000 draws
at ~928 ms" is a pre-cull number (after it, a frame offering 50,000 issues about
a fifth of them, at 181-197 ms median). It is three times the ~6.3 us
`VERIFYING.md` measures for a mesh draw carrying a material switch, and eight
times the ~2.3 us for an outline shell reusing a bound material. A first bake
creates a draw wrapper per (mesh, render pass id) and six of those per probe,
so bind-group creation is the obvious suspect — and on Babylon 9.28 (96fcd19)
every draw context owns a bind group until it is disposed, which is why
a1eed52 added `ReflectionSystem.forgetPasses`. **The 18.6 us was taken on 9.19
and needs re-taking on 9.28 before it is argued from.**

- **The worst frame is still 1,217 ms at 1500 m**, against a 197 ms median. It
  is the first batch and it is a queue-shaping question rather than a
  draw-count one: `releaseBatch` lets one probe through however fat it is on an
  otherwise empty frame, by design, or a queue with a fat head could never
  drain. A budget that could be spent as "one probe's worth of FACES" rather
  than one probe would smooth it; nothing has tried.
- **`perCell` is 2 on the 1500/0 proving ground, the only live grouping in the
  tree** — every shipped map is `perCell` 1 (`ReflectionSystem.ts` ~340) — and
  means a probe there drops 96 m of city out of the middle of its own cube (the
  enclosure rule — see `docs/rendering.md`). Nobody has looked at what that
  costs the PICTURE, because the proving ground is not a map anyone plays.
  Cinderhaven is the 1500 m map that ships glazing, and its reading is the
  800 m cull's above rather than this one's.
- **Nothing has looked at the PICTURE on the proving ground**, which is S0b's
  owed item and survives all of this. The bank can only say the four shipped
  maps are unmoved.
- **Nobody has looked at the PICTURE of a wider merge block** (`ENGINE_UPGRADE.md`
  S6). The whole cost of a wider block is cull granularity — a block is offered
  while the camera is inside `reach` of its bounds, so a 128 m block draws more
  that is off screen — and on the proving ground the draw-call saving swamped
  it. On a map with long sightlines and heavy per-pixel work it might not. Four
  shipped maps now state a wider `blockSize` — Sarab 96, Cinderhaven 120,
  Kurenai 120 and Harrowmead 200 — and a probe drops every block it serves from
  its own bake (`ReflectionSystem`'s `encloses`), so a wider block is also more
  of the city missing from its own cube. None of that has been judged on
  screen. (`terrainBlock` does not bear on either: it is the floor patch, and
  the terrain carries no `block` metadata.)
- **The proving ground's glazing is a generated worst case.** 1,153 glazing
  groups over a city-block grid; a real 1500 m map may glaze far less — and one
  exists now (Cinderhaven; S11 has landed too), so the comparison is a count
  away. The SHAPE is not a worst case — the bake is priced on glazing and
  `docs/rendering.md` says glazing has no natural bound.

---

## 11. The editor's tier-3 rebuild is ~2.3 s on Coldharbour, and it is `MapBuilder`

**Status:** measured (CPU), cause located, not acted on — **and every figure
below NEEDS RE-MEASUREMENT.** They are from 3ed9fec (2026-08-24, before the
WebGPU boot, headless), and `MapBuilder.ts` has had ~50 commits since;
Coldharbour itself was re-laid (6e848a1) and its buildings reworked. The newest
figure is `docs/editor.md`'s: a tier-3 rebuild is **~0.5 s on Hollowmere and
~2.5 s on Cinderhaven** (the path-road section). Re-measuring is cheap —
`window.__buildProfile` (`src/world/buildProfile.ts`, DEV only) gives the
per-phase split of a `MapBuilder.build` without a CPU profile — and the open
threads below (Coldharbour on hardware, the skip-AO/cover probe, an incremental
rebuild) stay open until it is done.

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
| 525 | `kit/city/tower.ts` `buildTower` — 44 of them |
| 450 / 401 / 362 | `glaze` / `pane` / `cut` — the 6,139 sheets |
| 389 | `mergeByMaterial` |
| 383 | `MapBuilder.paneGroup` |
| 265 + 236 + 160 | `NavGrid`, `link`, `severLinks` |
| 199 | `bakeVertexShading` |
| 184 | disposing the standing map |

(`glaze` and `cut` no longer exist as functions — the glazing is
`Build.pane` now — so these rows will not come back under those names. And
one cost this table cannot list has been added since: `GiVolume.setMap` runs in
`installMap` on an editor build as on any other.)

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

## 13. Greyfen at `low` does NOT hold 60 on a phone, and neither half the profiler can see is over budget

**Status:** answered for one phone (twelve captures, below): **no** — 7-24% of
frames are held one to three refreshes. **The cause is open, and the field is
narrowed**: not the collector, not the compiler, not the frame cap, not the GPU
timer, not the post chain, and not the display (the menu holds 60 exactly).
Neither measured half is over budget: the tick is ~9-10 ms, the GPU frame
11-14 ms, and **standing still the drop rate does not follow the GPU at all**.
What it does follow, most consistently, is the TICK — a CPU reading, at
roughly half the interval. An earlier reading of this entry called the phone
GPU-bound; the standing-still captures below disproved it. Also open: the
tablet df3c7cc was made for.

**The forest is ~1,400 feather-frond palms** (4ea4c72, 1130c74, 6c7a505;
`buildJungleTree` in `src/world/Props.ts`) — the most-placed model in the game —
on a layout seeded by `scripts/generate-greyfen.mjs` (`npm run greyfen`,
94c97db), so density is dialled in the generator rather than in `layout.ts`.
**Since df3c7cc the palm follows the Trees setting** (`CONFIG.graphics.foliage`):
~4.3k / ~3.5k / ~2.7k vertices a tree on high / medium / low, 6.21 / 5.39 /
4.56 M scene vertices, and on a desktop GPU at 1920x1080 low drew 4-7% more
frames than high at all six vantages and built the round ~3.2 s sooner (14.7 ->
11.5 s). A coarse pointer already defaults to low.

**What df3c7cc was made FOR is still not measured.** Its message records a
tablet that held 60 on Greyfen before the palm and no longer did with it, and
nobody has taken a capture on that tablet at `low` since.

### The phone, at `low` (six captures, 2026-10-05 01:47-01:51 UTC)

`?profile&gpu` SAVE captures, report v11, one session on an Android phone
(Chrome 154, a 2340x1080 panel at dpr 2.81, 8 cores, 8 GB — the reduced user
agent does not name the GPU), `gpu.frameMeasurable: true`. All on Greyfen at
**render scale 0.5 — the lowest rung, a 1170x540 backing store** — shadows,
grass and Trees `low`, GI and volumetrics off, motion blur and paper grain ON,
cap 60 on a 60 Hz panel. The table is the last three, which were 100%
`playing` on settings that had stood for over three minutes:

| capture | fps | tick mean / p95 | tick > 16.7 | `gpu.frame` mean / p95 | GPU > 16.7 | intervals > 22 ms |
| --- | --- | --- | --- | --- | --- | --- |
| 01:50:11 | 56.5 | 10.3 / 13.5 ms | 1.0% | 13.4 / 19.6 ms | 19% | 8% |
| 01:50:41 | 54.9 | 10.6 / 13.6 ms | 1.0% | 13.7 / 19.3 ms | 21% | 10% |
| 01:51:14 | 51.4 | 10.6 / 15.1 ms | 2.2% | 13.9 / 19.5 ms | 25% | 16% |

- **The slow frames are WAITS.** On the intervals over 22 ms the tick is still
  ~10-11 ms, the long animation frame over each has zero blocking and script ≈
  the tick, and every steady-state hitch carries `gc: 0` and `createdNear: 0`
  (one hitch in 151 across the five gameplay captures sat on a creation —
  finding 16). The frame was finished and was not presented: finding 1's
  shape.
- **WHILE MOVING, the wait appeared to follow GPU time — and standing still it
  does not**, so this table is a CONFOUND and not a cause: a heavy view raises
  the GPU and whatever really holds the frame together. One-second windows (60
  frames, stride 20) over the five gameplay captures, binned by their mean
  `gpu.frame`:

  | window GPU mean | windows | frames over 22 ms |
  | --- | --- | --- |
  | 11-12.5 ms | 154 | 1.0% |
  | 12.5-14 ms | 176 | 5.9% |
  | 14-15.5 ms | 182 | 14.0% |
  | over 15.5 ms | 215 | 25.3% |

  Read as it first was ("drops begin near 13 ms because the compositor shares
  the GPU"), it predicts the standing-still captures below would drop ~6-14%
  in proportion to their GPU. They dropped 16% at under 12.5 ms.
- **The tick tracks the drops at every GPU level.** The same windows split both
  ways (share of frames over 22 ms) — the column effect is the one that
  survived standing still:

  | | tick < 10 | tick 10-11.5 | tick > 11.5 |
  | --- | --- | --- | --- |
  | GPU < 13 | 0.3% | 0.5% | 4.2% |
  | GPU 13-15 | 3.7% | 7.8% | 19.2% |
  | GPU > 15 | 12.2% | 22.5% | 29.7% |

- **Draw calls do not predict the GPU here**: the per-frame correlation of
  `gpu.frame` with `drawCalls` is -0.11 to 0.06 across the five.
- **The MENU** — 12 draw calls, a 3.5 ms tick — reads **7.15 ms** of
  `gpu.frame` over 753 samples, but that window straddled a settings change
  (`inForceSeconds` 31.7 of 85 s) and dropped frames in RUNS of consecutive
  33 ms intervals, the shape of a 30 cap passed through on the settings
  screen. The clean menu reading is the 03:12:55 capture below.

### Standing at the spawn (six captures, 02:14-03:12 UTC)

Same phone, same settings except the column that moves, standing at
(-102, 98) with the view held; every window on settings that had stood over
100 s, and none with a creation in it:

| capture | cap | `?gpu` | motion blur / grain | fps | frames > 22 ms | tick mean | `gpu.frame` mean / p95 | GPU > 16.7 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 02:14:38 | 60 | yes | on / on | 56.1 | 10.2% | 9.4 ms | 13.5 / 15.8 ms | 0.6% |
| 02:16:59 | 60 | yes | **off** / on | 51.4 | 23.3% | 10.0 ms | 13.9 / 16.5 ms | 3.5% |
| 02:19:00 | 60 | yes | **off / off** | 54.3 | 18.8% | 9.6 ms | 13.8 / 16.4 ms | 2.7% |
| 03:08:14 | **off** | yes | on / on | 56.9 | 6.6% | 8.9 ms | 11.4 / 15.7 ms | 3.1% |
| 03:11:27 | **off** | **no** | on / on | 50.1 | 24.2% | 9.2 ms | — | — |
| 03:12:55 | off | no | on / on | **60.1 — MENU** | **0** | 3.0 ms | — | — |

- **The post chain is not the lever.** Two full-screen passes out and
  `gpu.frame` went UP 0.3 ms; one-second means drift 11-15 ms inside a single
  capture with nothing moving, which swamps anything those passes cost. Either
  they are nearly free at 1170x540 or this phone's GPU clock scales to the work
  (a mobile governor lowers the clock when there is less to do, which would
  hold the duration flat while the work falls) — so **on a phone `gpu.frame`
  may read utilisation rather than work**. Unmeasured.
- **The GPU over the interval is not what drops frames.** It ran over 16.7 ms
  on 0.6-3.5% of frames while 7-23% dropped, and binned the same way as the
  moving table, the three capped runs' windows dropped **16% under 12.5 ms GPU, 16% at 12.5-14
  and 19% at 14-15.5** — flat.
- **Neither the cap nor the GPU timer is it.** Uncapped dropped 6.6%, inside
  the 10-23% spread of the capped runs; uncapped without `?gpu` dropped 24.2%,
  the worst of the six. **The same configuration at the same spot ranges from
  6.6% to 24%** across an hour, and that spread is itself a finding: device
  state — temperature, clocks, whatever else the phone was doing — moves the
  result more than anything toggled here.
- **The display is not it.** The menu, uncapped, holds 60.1 fps with zero
  hitches, a p99 of 18.5 ms and not one long animation frame in 50 s. This
  phone presents a WebGPU canvas under the DOM at 60 without a stumble; the
  drops arrive with the round's load.
- **The TICK tracks the drops even where the scene does not move.** Windowed
  correlation of the drop rate with the tick is 0.34-0.68 at the spawn and
  0.17-0.90 across all ten gameplay captures, against -0.19 to 0.82 for draw
  calls. At 02:14:38 the draw count was flat (tick against draws 0.09) and the
  drops still followed the tick at 0.66 — **the main thread getting slower
  with the scene held still is the CPU itself slowing**, and frames drop in the
  same seconds. A 9 ms tick is not over budget by itself, so the reading is
  that the phone's CPU is the shared resource: the main thread's ~9 ms plus
  the CPU work neither instrument measures — Chrome's GPU process turning ~195
  draws into Vulkan commands (the desktop is draw-call bound for the same
  reason, `docs/rendering.md`) and the compositor. **A hypothesis**, and the
  first step below is what tests it.

**Three readings this GPU got wrong**, all excluded from the above and none
explained — the instrument's own open thread on a mobile GPU:

- **~2,300 gameplay readings sit at exactly 7.13-7.20 ms** at 200+ draw calls —
  the menu's value — and they land on slow frames up to twice as often as
  other readings (21-29% against 8-15% in the captures where the rate was
  highest).
- **`gpu.mainPass` is bimodal** (~0.5 ms or 8-16 ms), and `gpu.frame` reads
  the same ~13 ms under either mode, so on this GPU (presumably tile-based) it
  says where a timestamp landed rather than what the final quad cost.
- **`gpu.frame.maxMs` is 84.95 in five captures**, to the hundredth.

**One-offs in the same sessions, not the steady problem:** a 291 ms frame at the
spawn with 284 ms inside `render` and almost none of it in a named span (the
active-mesh walk, the post chain or a reflection bake's share), a 26.4 s block in one
frame callback just before the round (0 bots, at the spawn, 12 draw calls —
most likely the map build, which on the desktop takes ~11.5 s); the spawn's
1,268 ms frame with 34 creations near it and the first blast's 403 ms
(finding 16); and three single-frame CPU spikes, one per capture — 102.8 ms
(`world` 49.3, `onFoot` 19.2, 50 ms blocking), 68.6 ms (`shadowPass` 15.9, a
16.7 ms mesh walk, `input` 6.4) and 80.2 ms (`drawWorld` 52.4) — finding 1(a)'s
second population, on a phone.

**How to settle what is left**, in order:

1. **See the threads the profiler cannot.** A DevTools Performance recording
   of the phone over USB (`chrome://inspect`, a minute at the spawn) shows the
   GPU process's main thread and the compositor beside the page's, frame by
   frame — whether a held frame is the GPU process still encoding the last
   one. A Perfetto system trace over `adb` adds the CPU and GPU clocks, which
   is what would settle both the CPU-slowing reading and the governor reading
   of `gpu.frame`. Either is more decisive than another capture.
2. **If it is the CPU, the lever is draw calls** — shadows to their lowest
   rung, Trees `low` against `high`, a smaller map (Kurenai) — each A/B'd at
   the spawn with several runs a side, since one configuration spans 6-24%.
   Render scale 0.75 against 0.5 is the control: more fill, the same draws, so
   it should move nothing if the GPU is not the wall.
3. **The HUD, which is the other page-side work neither instrument times.**
   Its fills and its low-health glow stopped laying out and repainting in
   027fe87; what is left is the corner map, redrawn in full every frame
   (a rotated Canvas2D blit of the backdrop, the marks over it, a
   `shadowBlur` on the arrow) under a CSS `drop-shadow` the compositor
   re-applies because the canvas changed. `?nominimap` takes all of it away
   and the capture records which arm it was (`graphics.minimap`), so the A/B is
   the same spot with and without it, several runs a side for the reason above.
   If it moves nothing, the map is not part of this; if it does, the still
   parts of it (the arrow, the pad, the cone, the rim and the shadow, none of
   which ever moves) come off the per-frame draw first.
4. **The tablet** df3c7cc was made for, at Trees `low` and `high`. A report
   carries the rung (`graphics.foliage`) and `device.coarsePointer`. The grass
   is not a lever (finding 46 draws it around the eye).

(History, so nobody re-derives it: the headless before/after table this entry
carried — 354 trees to ~1,390, 831k to 1,386k active triangles — and the
133-176 fps real-hardware reading were taken on the broad-plate crown the palm
replaced, and the whole-scene ray rows beside them are moot now that no
gameplay ray picks a mesh and `Player.probeGround` is analytic. The closed
canopy also pushed `docs/rendering.md`'s ground-relief aliasing measurement off
this map to Coldharbour.)

---

## 15. The blast is costed on ONE desktop GPU, as vertices — Coldharbour, the subdivision lever and the phone are not

**Status: measured once on the desktop GPU (64559ce / 2da8d33); open on
Coldharbour, on a phone, and as a lever nobody can reach from the settings.**

**A blast is lit, opaque, thin-instanced BILLOWS now** (`src/systems/BlastFx.ts`,
`BlastShader.ts`), and no blast particle system remains. What it holds, all
built once: `CONFIG.grenade.blastSlots` (4) slots of one thin-instanced batch
of `blastBillows` (64) at icosphere subdivision 8, a shared small batch
(`SMALL_CAP` 320 at subdivision 4) and 32 streamers. What did not change: the
Havok chunks are 3 bursts of 10 (`debris`), the scorch is `marks: 8`, and the
chunk burst is refused past `debris.distance` (80 m) scaled by power.

**What it costs, measured**: on the Windows box, Hollowmere, uncapped, a
1.85-power blast every 0.6 s so all four slots stay live, run order controlled
— idle 408 fps on both builds, under the storm 366 fps before and 302 after,
**about 0.7 ms a frame for the billows against 0.2 ms for the old spheres and
sprites**. A tank shell is ~50 billows of 1,280 triangles in one draw, plus
~150 small ones of 320, each drawn twice — the frame and the glow mask — with
six value-noise lookups per vertex. Draw calls went the other way (one per
blast against seven meshes a slot plus one per ember). The billows are opaque
and the frame is draw-call bound (`docs/rendering.md`), so the cost is VERTICES and not
fill; the fill argument and the ranking against finding 5 this entry used to
make were about the blended sprites (pre-2026-09-30) and are moot.

**What is bounded by construction, and therefore is not the question:** the
pools are fixed and built once, no burst allocates or builds a WASM shape
(a chunk's size is decided at construction), and a blast is seconds apart from
the next one by the economy — two grenades a life, a 3.6 s tank reload.

**What is open:**

- **Coldharbour, two blasts overlapping at close range, against the same scene
  with `grenade.column.billows` at 0** — the column is the largest layer, and
  it is now a vertex question rather than a fill one.
- **The subdivision is on no settings rung.** It is `BlastFx`'s first lever (8;
  under ~7 the lumps start to lose the cauliflower silhouette that keeps them
  from reading as rock), and it is a constant in the constructor.
- **The phone is unmeasured**, and it is the device where 0.7 ms is not small.

---

## 16. The first seconds of a round are WebGPU compiling pipelines, and on Coldharbour that is 9 fps

**Status:** open — measured on real hardware and cause located, but **every
number below needs re-taking on today's tree**, and not acted on.

WebGPU compiles pipelines lazily, and **nothing warms the MAIN-PASS
pipelines**. What does exist is narrow: `BlastFx` calls `forceCompilation` on
its one material (`src/systems/BlastFx.ts` ~426), which builds the EFFECT — on
WebGPU the pipeline itself is still created at the first real draw, since it
depends on render state, vertex layout and target format; `LocalShadows.ready()`
compiles the lamp atlas's own pass before it draws; and `GiVolume` and
`GlowPass` skip their work until their compute and blur are ready, which warms
nothing. The reflection bake drains under the building card, but what it
compiles is reflection-pass pipelines, not the main pass's.

On Coldharbour, measured second by second from the frame the player spawns
(2026-08-26 — **before** `compatibilityMode = false`, the ink pass, the palette
merge, `GlowPass`, the irradiance volume, the clouds, the water, the grass
field, `BlastShader` and the flame, every one of which adds variants):

| second | 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- | --- |
| fps | 9 | 34 | 48 | 47 | 48 |
| shader modules created | 42 | 2 | 0 | 0 | 0 |
| render pipelines created | 25 | 3 | 0 | 0 | 0 |

Sixty-two modules and thirty-three pipelines exist by the end; four and two of
them predate the round (the same 2026-08-26 run; finding 1's newer hook counted
29 pipelines and 73 modules in warm-up, then 6 and 2 across 40 s of play).
**The cost does not appear in the call it comes from**
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
with the variant matrix has not been looked at. Finding 1's first-use pipeline
hypothesis — pipelines first used in PLAY stalling the frame they are first
drawn on — is a second reason a warm-up pass would pay.

**The instrument for it now exists, and its first reading says what a warm-up
owes.** The profiler records every creation against its frame (report v11,
`docs/profiling.md`, "Compiles"). Coldharbour, headless on the Windows box,
2026-10-04, `?profile`, spawn and stand: the spawn frame ran **240-308 ms with
24 creations on it and 27 within two frames, while `drawWorld` was ~37 ms of
it** — the stall lands mostly OUTSIDE the tick, which is what a compile in the
GPU process looks like from the page — and nothing further was created over
the next eight seconds of standing still. What compiled there was the cel
world (`CEL_PALETTE`), a shadow-map variant (`INSTANCES`/`THIN_INSTANCES`),
the flame's `GLOW_MASK` twin, and Babylon's own `StandardMaterial` in
`ALPHABLEND` variants, against an `rgba8unorm` target — the list a warm-up
would have to draw. Babylon 9.28 also brings the tool for it:
`engine.createRenderPipelineAsync` (backed by
`WebGPUCacheRenderPipeline.preWarmPipeline`) compiles a variant without
drawing it, and its creations would show up in the same log, before the round.

**On a phone it is bigger, and it reaches past the spawn** (finding 13's
session, Greyfen, 2026-10-05). The spawn frame ran **1,268 ms with 34
creations near it**. Then, ~45 s into the round, the FIRST BLAST ran **403 ms**
on nine creations: `blast` in a plain and a `GLOW_MASK` variant (both
`INSTANCES`/`THIN_INSTANCES`) and a `default` `StandardMaterial` with a detail
plugin, all against `rgba8unorm`/`depth32float`. That is measured proof that
`BlastFx`'s `forceCompilation` warms the effect and NOT the pipeline. The
blast's pair belongs on any warm-up list, and it is the one stall in this list
that lands in play rather than under the deploy screen.

---

## 20. The reference bank cannot reproduce a frame, and is stale against the clouds and Babylon 9.28

**Status:** open. This is the merge gate `ENGINE_UPGRADE.md` names for every
step in it, so it matters more than its size suggests. The mystery this number
used to hold is explained; what has replaced it is not.

**The bank that was red "on an unmodified tree" was red over the paint
palette.** It was taken at 61c6ace (2026-08-26, 18:16) and the palette landed
two hours later at 6bb50c3 (20:10), whose own message reports sixteen of
sixteen reference frames **within 0.19 to 3.26 mean/255** — the same residue,
smallest and largest, this entry tabulated as unexplained. It was the
palette's trade (the ink tracing a block rather than each colour group), not
anything under the bank. It went green afterwards: f7f515e (2026-09-07) checks
21 vantages on six maps at 0% of pixels, and 860fad6 (2026-09-14) re-took all
21 — the PNGs on disk are that day's.

**What is open now:**

- **It cannot reproduce a frame.** a59abd2 (2026-09-26) records that "the WebGPU
  reference bank cannot reproduce a frame on any map at the moment", and so did
  not re-take Harrowmead over its re-lay. `bank.mjs` refuses to write a frame
  whose two consecutive grabs differ, so that is an UNPINNED CLOCK somewhere —
  the shape both earlier false alarms took (a lantern's flicker phase and an
  unfrozen cube probe, `diff.mjs`'s header). Derived and not checked: the
  water's swell (363eb8b, 2026-09-25) and the grass field (c0f17b1,
  2026-09-26) both landed the days before, and both move with time.
- **It is stale against the picture twice over.** 864d5f8 and 7f98ec1 changed
  the clouds and both say the bank was not re-taken. 96fcd19 moved Babylon to
  9.28 and compared every banked vantage under both engines, but
  `plans/webgpu-ref/README.md`'s own rule is to RE-TAKE when the engine moves,
  and the bank on disk is still 2026-09-14's.
- **`ref/mode.json` still records only `{"mode":"headless"}`** — `bank.mjs`
  writes the mode and nothing else (~line 214), so the Chromium build and the
  driver version this entry asked to be recorded beside a bank still are not.

**What would settle it:** find what makes two consecutive grabs differ, and pin
it as the lantern and the probe were pinned; re-take on the current engine and
the current vantages, saying so in the commit as the README asks; and write the
browser and driver version into `mode.json` beside the mode, so the next red
bank can be told apart from a Chromium update in one read.

---

## 23. Rays at 1500 m: the terrain march is unpriced and has no hierarchy

**Status:** open. Every ray is a box query now (`RayWorld`, `ENGINE_UPGRADE.md`
S2, and `docs/world.md` for the audit that proved the substitution); what is
left is the one term in it that grows with a ray's length.

- **The 1500/0 extent has not been measured**, only 900/300. The cost is no
  longer collider-bound, so the projection is far weaker than it was — but the
  terrain march IS bounded by the segment's length in terrain cells, and nothing
  has priced that at 1500 m. **Cinderhaven is the shipped 1500 m map now**, and
  is the natural place to price it rather than the proving ground.
- **The heightfield march has no hierarchy.** A cell is rejected by the max of
  its four corner heights against the segment's own y-band, which is enough that
  a long ray passing well over the ground costs four array reads a cell. A ray
  ALONG a valley floor tests two triangles per cell for its whole length. A
  coarse max-height pyramid would fix it and nothing has needed one.
- **Four array reads is the price INSIDE the grid only.** Out in a borderland
  `latticeHeight` (`RayWorld.ts`) falls through to `TerrainField.heightAt` —
  a bilinear sample plus `borderRoll` — so a march across the margin costs four
  function calls a cell rather than four reads. That is the ground a long ray
  on Harrowmead (1600 m of ground round 400 of play) or Cinderhaven (2000 m
  round 1500) crosses most, and it is in no measurement here.

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

**The per-builder rows below are history** (profiled 2026-08-28, after S5b and
S5c): every city builder in the table has been reworked since — the tower
(988a2e4, 33259dd), the shophouse (022e6a6), the depot (b0f7066) and the office
(672d984) — and each now batches its boxes through `StoneBatch`, so their
milliseconds and their order are not today's. What is probably still the right
shape is the SHARES of the `partBox`/merge round trip further down:
`src/world/parts.ts` has had no commit since this profile.

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
  normal, uv and colour buffers and of the index buffer. **All five maps of the
  day hashed identically** — Hollowmere, Greyfen, Coldharbour, Harrowmead and
  the proving ground — along with `scene.meshes`, `scene.geometries`, the
  active-mesh count, and a count of visuals failing `isReady(true)` after the
  map draws, which is zero on both sides. No script for it is committed; it has
  to be rebuilt, and rebuilt it owes the seven shipped maps plus the proving
  ground. **Half of it now exists**: `npm run kit:hash` (`scripts/kit-hash.mjs`,
  90da735) fingerprints every builder's output over every placement BEFORE the
  merge, and by its own header merges nothing — so it proves the parts are
  unchanged, and the merged-visuals comparison above is still the half that has
  to be rebuilt.
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
  1,021 ms of self time. **It is probably bigger now than measured**: the same
  bake also runs `shelteredAt` for every vertex below `wear.height` (3a3549a,
  `src/world/vertexShading.ts`), a second box query per low vertex that did not
  exist when this was profiled.
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
- **There is a SECOND hard pop, and on a phone it is the nearer one.**
  `WorldCulling.offer`'s size gate (`CONFIG.graphics.culling.minPixels`, 3 px)
  drops a whole body off its rig root by projected size, and its own comment
  measures where that lands on Coldharbour: **810 m on a 1080-tall viewport
  but 290 m on a 384-tall one** — past the map's 480 m on a desktop, and well
  inside it on a phone, where a body pops out in clear air rather than in fog.
  A fade built for `bodyDrawDistance` alone would not reach it; finding 39
  argues the gate.

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
rotation cost nobody is watching, not a tick cost. (Measured 2026-08-28, on the
proving ground, before 82242d9 put a `CollisionField` in the server's build
and d1dcd90 changed `NavGrid`: the absolute figures are history, while the
attribution's SHAPE — the cover bake largest — is likely still current.
Cinderhaven is the shipped 1500 m map to re-measure it on.)

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

**Every number in this section is Sarab at 8 a side, on 2026-08-28** — before
the map went to 24 a side (20a8bf2, and 00f739e, which made it actually field
them; `perTeam: 24` in `sarab/layout.ts`), and before the gun trucks, the
helicopters, the water (f25b189) and the desert fill (0ede92a). Read the table
and the authority's figures as a sixteen-bot map that no longer exists. The
24-a-side remeasurement is `ENGINE_UPGRADE.md` S10's "What it bought": rounds
of 14.6 minutes with 22 of 48 in contact, the authority's tick 0.61 ms p50, and
the frame **15.2-15.7 ms at 24 a side against 10.8 at 8**.

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

3,233 collider boxes then (3,545 today, by `sarab/collision.ts`'s header),
4,734 scene meshes, 148 active, 360,000 nav cells, 380,598 nav surfaces, 625
placements and 80 scatter regions. `npm run parity` passes on all seventeen
fields.

**The table's `probes` and the prose's "7 probes" below disagree (17 against
7), and one of them must be re-counted.** The code cannot settle it after the
fact: the column is `scene.customRenderTargets.length` (`harness.mjs`), which
is every released cube on the list — glazing and water alike, and anything
else pushed there — rather than glazing probes alone, and the map has gained
water and changed builders since. A re-count should report the two apart.

And the authority, `npm run simulate sarab 1 3` under NullEngine, at sixteen
bots (S10 above has 48): the world builds in 692 ms, **0 of 64,981 ticks over
the 16.67 ms budget**, p50 0.021 ms, p95 0.508, worst 6.585. Every round ended
with a winner in about 18 minutes of game time, peak contact 8 to 12 of 16
bots.

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
  it may be the bump, the AO bake or the cel shader's banding. **The symptom
  may have changed since**: the ground's height maps carry parallax and a
  self-shadow now (finding 42), so look again before chasing the old one.
- **The picture was checked DIFFERENTIALLY and not absolutely**, which is
  finding 20's fault and not this step's: `bank.mjs --check` was red on an
  unmodified tree at the time, so what was run is the usable form — the same check either
  side of the change against the same fixed reference. All fifteen banked
  vantages report the SAME mean to four decimal places with these changes
  applied and with them stashed, which is what says the shared edits (the palm
  in `Props.ts`, the two table rows in `MapBuilder.ts`, the eight in
  `BuildingKit.ts`) moved no pixel on any existing map. Sarab now has a bank of
  its own — menu, `alley`, `shelf` and `wadi` — and the `shelf` row is the first
  banked frame anywhere with a fog wall INSIDE the play square in it.
- **The layouts are in the MAIN bundle, and the thread is still open and
  larger than this entry first said.** `MapDef.heights` and `MapDef.collision`
  are lazy and `MapDef.layout` is not (`src/world/maps.ts` imports all seven),
  by design — it is authorship rather than bulk — but every shipped map is
  generated now, and Sarab's `layout.ts` is ~129 KB of source on its own; the
  seven shipped layouts come to ~640 KB, every byte of which every boot parses
  for the one map a session builds. That is the same argument S7 made about the
  heightfields and it has not been re-made about this; whether a layout is
  worth a third lazy half is nobody's step yet, and the honest figure to check
  first is what it costs to PARSE rather than what it costs to fetch.
- **The CLIENT frame was measured EMPTY.** The gate's round has bots in it but
  nothing forces contact, which is the wall `ENGINE_UPGRADE.md` S2 and S9 both
  hit. Contact at 24 a side is measured for the AUTHORITY (S10, above); what 48
  bodies fighting across the old town's roofs cost a client's frame is still
  unmeasured, and it is the one place a roofscape could turn out to be
  expensive: every roof is a walked surface and the nav graph has 380,598 of
  them.

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
`world/sway.ts`'s rig and `docs/rendering.md`'s wind section. A layer may name
a `rig`, its builder writes each vertex's place on its own member into the
`uv` buffer before the merge (`swayRig`), and the shader reads that behind a
negative red channel. Neither the cloth layer nor `kit/desert.ts` has been
moved across, so the workaround above still stands.

- **A rigged `hang` layer — the route, and now the only per-vertex one.** A
  drape would be the THIRD rigged layer (`frond` is `rig: 1` and the ash's
  `bough` is `rig: 2` in `config/wind.ts`, 36199f9): `bend` running from 0 at
  the head to 1 at the hem via `swayRig`, and the frond motion — pressure
  downwind, a slow swing, a flutter at the edge — is close to what a hung sheet
  wants already. **It costs more than a config row**: the shader's rigged branch
  is a two-way `select` keyed on `color.r < -1.5` (`CelShader.ts`, the
  `bough` test), with one uniform pair per layer (`windFrond`/`windFrondRate`,
  `windBough`/`windBoughRate`), so a third layer needs a third uniform set and
  a three-way pick on the hottest vertex shader in the game.
- **~~An anchor channel~~ — gone.** This entry once proposed stashing each
  sheet's top in the BLUE vertex channel, "written 0 today … the only free
  one". Blue is the wear ramp since 6d36839 and all four channels are spoken
  for (`CLAUDE.md`), so the `uv` rig above is the only per-vertex route through
  the merge left.
- **A second sway term in the shader**, pivoting about the anchor rather than
  translating, which is what would make a hem actually swing rather than shear.
  Costs a uniform and a branch on a path that is already the hottest vertex
  shader in the game, and wants the rig above first regardless — the anchor
  has to reach the shader per vertex, and `uv` is the only way it can.
- **Leave it.** The amplitude is small, the geometry does the reading, and no
  other map has cloth. This is only worth opening if a second map hangs
  something bigger — an awning over a souk lane, a tent — where the shear would
  be across a two-metre span rather than a one-metre one.

---

## 38. `WorldCulling.offer`: who the disabled candidates are, and its own per-frame cost

**Status:** the drop landed (`docs/rendering.md`, the size gate). Two things
about it are open.

- **Who the disabled candidates ARE has still not been counted — and how many
  there are has to be re-counted first.** The "~420" this entry carried was
  counted on Cinderhaven when the drop landed (f7f515e, 2026-09-07), and three
  things have moved it since: 00105a4 filed the death cam's rig, cada131 cut a
  rig from 22 meshes to 14, and 42d831d drops a body whole off its root.
  `setPools` already keeps an idle rig out of the list by its root, so a
  disabled mesh still being offered is either a pool never filed or a part
  disabled under an enabled root.
- **`offer` is `O(eligible)` every frame, and it does more per candidate than
  it did.** `isEnabled()` walks ancestors; the size gate adds a bounding-sphere
  read per candidate; and every body pays a forced `computeWorldMatrix` on its
  rig root (`WorldCulling.ts`, the "root's matrix is FORCED" comment) — up to
  48 a frame on the densest map. At 2 px the gate does not repay its own read
  on any map measured; it is only worth having because 3 px does on the biggest
  one, and a `sqrt` per candidate measured as a LOSS, so it compares squared.
  A pool that told `WorldCulling` when it went live would cost nothing per
  frame, but it cannot use `setPools`' transition-marks-dirty route, because
  `rebuildList` is a full scene walk and effect pools toggle many times a frame.

---

## 39. Cinderhaven does not fit in a 144 Hz frame, and the only geometry with no LOD at all is a vehicle's — **the size gate is LANDED; the big levers are look decisions and are not**

**Status:** the gate is in (`WorldCulling.offer`, `CONFIG.graphics.culling.minPixels`).
The rest is measured and deliberately left to whoever owns the look.

**Every table, the mesh census and the lever values below need re-measuring
before anyone sizes a lever against them.** They are mostly 2026-09-07's, and since
then rigs were cut by a third (cada131), bodies joined the gate (42d831d), and
the fire, the clouds, the irradiance volume, the lamps' atlas, the water's
swell, the grass field and the shadow hold (52579ed) all landed, most of the
city and harbour builders Cinderhaven stands on were reworked, and all three
vehicles were redrawn (2026-09-27). Coldharbour's 688 → 575 offered, below,
also predates its re-lay as a harbour town (6e848a1).

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
fittings at 1,360-1,420 m, where `heli-whip` (16 cm; `heli-whip-lo`/`-hi` in
today's model), `heli-mg-ring` (14 cm) and `truck-mg-ring` (17 cm) are well
under a pixel.

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

**Two classes were exempt in the version that landed, and each was found by
looking at what a naive gate removed**, not by reasoning first. A POOLED BODY,
because a per-mesh test dropped `bot-head-m` x16 and `bot-legL` x16 while
keeping the torsos — headless soldiers at 300 m. **That exemption is gone**: a
body is measured once off its rig root and dropped whole (42d831d), and a rig
is fourteen meshes now (cada131), where this entry counted nineteen. And anything
EMISSIVE, which is still exempt, because bloom carries a sub-pixel emitter far
past its own geometry and this is a night map full of lit windows; the test is
exact rather than a name guess — a non-black `emissiveColor` on the material.
(This entry once said `getEmissive` was the only `StandardMaterial` in the
tree; it is not — `FlameMaterial` and `BlastShader` declare an
`emissiveColor`, and the optics, the kit screen's backdrop, the sky and the
editor all make `StandardMaterial`s. `glows` in `WorldCulling.ts` states the
test as it is.)

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
  is an art judgement: the naive set included `tank-link` (3.26 m; today's
  model names it `tank-link-lo`/`-hi`) and
  `tank-wheel` (3.02 m), and `TankModel`'s own comment says the road wheels
  filling the track hole ARE the silhouette — an argument the Leopard's tapered
  armoured skirts (3105f22) weaken, since they now cover most of those wheels.
- **The gate's own per-frame cost** is finding 38's.

---

## 42. The ground's relief DEPTH is unmeasured for aliasing, and unmeasured on a phone

**Status:** open. The depth (parallax and self-shadow over the ground's height
maps — `docs/rendering.md`, "A slope is not a depth") was judged by eye in
still frames and priced on one desktop GPU. Neither of the two questions a
per-pixel march raises was measured.

### One phone session serves 42, 44, 45 and 46

Their phone halves can share one protocol. Boot `?profile&gpu` with Chrome's
unsafe-WebGPU flag set (`chrome://flags`), so `gpu.frameMeasurable` reads true,
and the frame cap at Unlimited (`graphics.fpsCap` 0 in the capture); boot once
per map and toggle each condition live from the settings screen A/B/A/B,
throwing out any window whose `graphics.inForceSeconds` says it straddled a
switch. Vantages: Cinderhaven's harbour street (42, 44, 45); a lamp-lit
Hollowmere street (44, 45); Harrowmead's pasture (46); Coldharbour's square
and a sprint down its lit streets (45's first bake, 46, and 43's re-count);
Greyfen at `low` (45's hold); Kurenai's loam (42). **The tooling gap comes
first**: grass and relief have no URL override, so nothing in a capture says
the field was hidden or the relief pulled — `?grass=` and `?relief=`,
recorded in `graphics.forced`, are what make those captures self-describing.

### What was measured

- `gpu.frame`, at eye height down a street in a 1920x1080 headless frame on the
  Windows box, 600 frames settled in `deploy`: **Cinderhaven 1.61 → 1.93 ms,
  Harrowmead 1.54 → 1.50 ms**, frame rate within 3% on both (71.8/72.2 and
  103.5/100.2 fps, one run each — the frame is draw-call bound).
- Still frames on all six maps of the day, at dusk, noon and night, against
  `reference-media/visuals.jpg`. There are seven now, and the seventh is the
  one that matters most here: Kurenai's forest loam (981efdd) carves at a
  `bumpScale` of 0.08, the deepest floor relief in the tree (only the cobbled
  street's 0.1 is deeper), and it was never in this check.

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

Re-take the supersampled comparison on Coldharbour, Harrowmead and Kurenai's
loam with `CONFIG.graphics.relief.shadowStrength` at 0 and at 1, and with the
parallax fade pulled to 0, standing still and after a slow strafe. On a phone, a
`?profile&gpu` capture down Cinderhaven's harbour street with the relief on and
with both fades pulled to zero. If either is bad, the lever is the fade
distances and the step counts in `CONFIG.graphics.relief`, not the height maps.

**"Pulled to zero" has no switch today.** The relief is read off `CONFIG` into
each cel material's `reliefFade`/`reliefShade` uniforms at construction, so on
a phone it means a console write of those two on every bumped material, or a
CONFIG edit and a rebuild. A `?relief=` override recorded in the capture's
`graphics.forced` — beside `gi`, `shadows` and `volumetrics`, the three it
holds now — would make a phone capture say which it was.

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
and **emissive is exactly what the albedo palette refuses** (`docs/rendering.md`,
"The paint palette": gloss, translucency, glazing and emissive are shader
BEHAVIOUR, not a uniform, and stay in the merge key). A
block contributes `#ffd79a`, `#4e3a1f`, `#4e3a1f-over-glass` and `#ff5a4a` as
four meshes, and the mask draws all four with ONE material and one
`glowColor` apiece.

**The count is a camera fact and not a map fact, which is what made this hard
to see.** A frozen bank vantage holds five; the deploy screen holds 35; a live
street view holds 112-123. An earlier reading of "five" is the vantage's and
must not be quoted for a round.

**And the 123 is history (2026-09-19).** The builders that carry Coldharbour's
emissives were reworked after it — the office (672d984), the tower
(33259dd), the parkade (8492189), the shophouse (022e6a6), the depot (b0f7066)
and the lighthouse (2779fdb) — and the map itself was re-laid (6e848a1). So the
123 and the "~40" a palette would leave both need re-counting in a Coldharbour
street view before the palette is costed. The frozen mask's −0.72 ms below is
likely still current.

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
phone, ~2.6 ms of a 20.1 ms frame. It is lossless, exactly as the albedo
palette was.

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
  Cinderhaven ~0.1 ms (**every Hollowmere figure in this entry predates its
  re-lay on real terrain, 5806a24**, and the trace marches terrain as well as
  boxes, so re-take those; Coldharbour's predate its re-lay as a harbour
  town, 6e848a1, on the same argument, and Cinderhaven's are likely current); Hollowmere under a staged firefight (four guns, a blast
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

---

## 45. The lamps' shadows and the shadow rungs are priced on ONE desktop GPU, and three things about them are open

`systems/LocalShadows.ts` and `CONFIG.graphics.shadowTiers` shipped measured
only on the RTX box (`docs/rendering.md`, "The lamps' shadows"): the high rung
is ~+0.1 ms of GPU and +3 draws over shadows off on Hollowmere and Cinderhaven,
uncapped, at a staged street with eight soldiers round a lamp and a moving spot.
The `low` rung was chosen for a coarse pointer on finding 43's ~2.4x ratio, not
on a measurement. Two things have moved under that figure since: Hollowmere was
re-laid on real terrain (5806a24), and 94b9b82 changed the "off" baseline —
shadows off no longer draws the volume's coarse sun shadow — so the delta was
taken against a different floor from today's.

- **Nothing is measured on a phone.** `?profile&gpu&shadows=low` against
  `?shadows=off` at the same street on Hollowmere and Cinderhaven. If low is
  over ~1 ms there, the levers in order: `every` (hold dynamic tiles longer),
  `taps` (already 1), the sun map's size, then `lights` to 0 on that rung —
  `every`, `taps` and `lights` are per rung in
  `CONFIG.graphics.localShadows.tiers`, and only the sun map's size is in
  `shadowTiers`.
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

---

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
alone gave back ~0.2 ms of the 0.9 (measured before 3ff0456 made the turf a
blended density ramp with stitched edges, so that share is history). The
fragment stage is the cel shader's whole
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
  the field hidden (there is no `off` rung; hide it from the console as above —
  and since there is no `?grass=` override either, nothing in the capture says
  the field was hidden, which is the tooling a phone capture needs first),
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
  is not covered by `npm run parity` or the reference bank. **That re-run is
  OWED now**: its own condition was met by 3ff0456, which stitched the turf's
  patches edge to edge instead of skirting them, and the test was not repeated.
