# Measuring a frame

The contract for [`src/core/FrameProfile.ts`](../src/core/FrameProfile.ts)
(the recorder),
[`src/core/profileReport.ts`](../src/core/profileReport.ts) (what a capture
says), [`src/core/profilePhases.ts`](../src/core/profilePhases.ts) (the phase
list both read), [`src/ui/ProfileChip.ts`](../src/ui/ProfileChip.ts) and
[`src/config/profiling.ts`](../src/config/profiling.ts), and for the ~22 pairs
of brackets in `Game.ts` that feed them, plus the four inside `render` that
`FrameProfile` hangs off the scene itself — and for the BENCHMARK that rides
on all of it, [`src/bench/BenchScript.ts`](../src/bench/BenchScript.ts),
`Game.updateBench` and the desktop wrapper
[`plans/webgpu-ref/bench.mjs`](../plans/webgpu-ref/bench.mjs). [`CLAUDE.md`](../CLAUDE.md) carries the
summary; this is the argument.

It is not the only instrument in the tree and is deliberately not the biggest.
[`world/buildProfile.ts`](../src/world/buildProfile.ts) times the map BUILD and
is DEV-only; `HUD.setFps` puts a rate and a 1% low on screen, the 1% low
being the same function a capture reports (`core/frameStats.ts`);
[`FINDINGS.md`](../FINDINGS.md) is where a measurement goes once it means
something. This file is about the frame, in flight, on a device you do not own.

---

## Why it ships

**Every number in `FINDINGS.md` §20–§32, and in `docs/rendering.md`'s "Why the
frame is draw-call bound", was taken on one of two dev machines by
hand-wrapping a function from a Playwright script.** That protocol is good and
should stay — it is how you price a single call site. What it cannot do is
answer any question about a phone, a tablet, a mid-range laptop or a production
build, and those are where this game is actually played. The frame is
**draw-call bound** (that section), which is a property of the machine as much as of the
scene; a hitch nobody here can reproduce is a hitch nobody here can fix.

So the profiler is armed by a **setting** (`Settings.profiler`, on the Display
page) or by **`?profile`**, and never by `import.meta.env.DEV`. Disarmed it
allocates nothing and every entry point returns on its first line — the whole
cost of a switched-off profiler is `if (!this.on) return;` at ~22 call sites.

**Measured on the Windows box, Hollowmere, three paired runs of eight seconds
each — one page armed with `?profile`, one not, `requestAnimationFrame`
callbacks counted rather than `Engine.getFps`:**

| | armed | disarmed | cost |
| --- | --- | --- | --- |
| run 1 | 128.4 fps | 129.1 fps | 0.54% |
| run 2 | 128.3 fps | 129.2 fps | 0.72% |
| run 3 | 128.8 fps | 130.6 fps | 1.35% |

**Call it under 1.5% of frame rate, and note that the spread is wider than the
signal.** The armed readings agree to 0.4% across all three; the disarmed ones
move by 1.2%, which is what the number is actually made of. Do not quote a
single run of this.

**The span calls are not where it goes, and that is worth knowing before
optimising the wrong half.** `probeOverhead` measures one `begin`/`end` pair at
**0.22 us** (0.225, 0.22, 0.22 across the three runs — the stable figure here),
which over ~22 pairs is **~5 us a frame**, or 0.06% of a 7.8 ms one. The rest is
`SceneInstrumentation`'s observers and the `getActiveMeshes()` read in
`endFrame`. If the cost ever has to come down, that is the end to look at.

**The four spans inside `render` add about four more pairs a frame** — the two
rendering groups and the glow's mask and blur, with the shadow map's on
the handful of frames that re-render it — which is ~0.9 us against the 5 above
and well inside the run-to-run spread the paired runs already showed. It is
arithmetic on the same probe rather than a new measurement, and the reason it
did not get one is that a difference that size cannot be resolved here: see the
rAF-counting note in `VERIFYING.md` for what it took to resolve the whole
instrument at 1.5%.

Neither figure is a constant in a table: both probes run on arming, on the
device, and `clock.overheadUs` and `clock.grainMs` are in every capture.
**An instrument that does not state its own cost is one nobody can subtract** —
see `ENGINE_UPGRADE.md` S9 on the instrument that had been dead since the WebGPU port
and nobody noticed.

---

## The one design decision

**It records CONTINUOUSLY and the capture reaches BACKWARDS.**

You cannot watch a graph while playing a first-person shooter with two thumbs.
Every other arrangement — start recording, do the thing, stop recording —
assumes you know when the interesting frame is going to happen, and the whole
difficulty with `FINDINGS.md` §1 is that you do not: a 1% low of 28 at a mean of
60 is *a visible hitch roughly every 1.7 seconds*, arriving unannounced.

So the ring holds `CONFIG.profiling.frames` (3,000 — **50 s at 60 Hz, 25 at 120,
12.5 at 240**) and the gesture is pressed AFTER you feel something. On top of
that, `endFrame` files every slow frame into a hitch list, so a capture carries
the worst frames whole even if the thumb was slow.

**What counts as slow is RELATIVE, and that is not a refinement — a fixed bar
degenerates on exactly the device this thing was built to be carried to.** A
mid-range phone holding 30 fps spends 33 ms in every frame, so at
`CONFIG.profiling.hitchMs` (24) alone *every frame is a hitch*: the list floods,
laps its own cap every few seconds, and a capture's headline — the worst frames
in the ring, whole — reaches back three seconds instead of fifty. So the bar is
`hitchMs` **or** `CONFIG.profiling.hitchFactor` (2.5) times the floor this
device has lately been managing, whichever is larger, and both the bar and the
floor are in every report (`frame.hitchThresholdMs`, `frame.baselineMs`)
because a reader who assumed 24 would read an empty list as a smooth session.

Measured, headless on the Windows box with Chromium throttled to a sixth of its
speed mid-session — the honest version of "somebody's phone", since it changes
under a profiler that was already armed:

| | frames in window | filed as hitches |
| --- | --- | --- |
| fixed 24 ms | 687 | **292** |
| relative bar | 687 | **25** |

The 25 all land in the ~1.5 s it takes the floor to follow the step change
(baseline 7.8 → 15.1 ms after one second, 39 ms after two, bar 24 → 98), and
the count stops growing once it has. **The floor resists only what the bar
already calls an outlier** and moves quickly for everything else, which is what
keeps a 682 ms frame from lifting it by more than 6.8 ms while still letting a
map install triple it in tens of frames rather than hundreds.

It cuts the other way too: on a 240 Hz machine at 4 ms a frame, a 20 ms frame is
five missed deadlines and a fixed 24 never files it.

**Nothing allocates per frame while it is recording.** Every array is sized once
by `arm` and written by index; there is no per-frame object, no label string, no
closure, and `context()` takes four positional numbers rather than one struct
for exactly that reason. This is not tidiness. GC was §1's leading suspect for
the hitch (§1's own captures have since exonerated the collector — "The heap and
the collector", below), and a profiler that allocates per frame manufactures the
bug it was built to find. Captures and reports allocate freely — a capture is a deliberate
act, not a frame — **and the two halves are two FILES**: `FrameProfile.ts`
records and `profileReport.ts` builds the report and the trace from a
`ProfileRing` the recorder lends it at the capture, reading it and never
writing it. A new figure in a capture is a field in the ring and a line in the
reporter, and the reporter is the only side that may build an object to say it.
The reporter is NOT lazy-loaded: `capture` is synchronous because the chip's
VIEW opens the reader's window and writes the hand-over inside the tap's own
user activation, and `window.__profile.capture` returns the report to a smoke
script on the same line.

**There is exactly one allocation left in the recording path and it is per
COLLECTION**: the sentinel the GC watch re-registers, below. One empty object
per GC event, against the alternative of an instrument that cannot see the one
thing §1 most suspected.

---

## Using it

**Arming.** The settings screen's Display page has a `Frame profiler` row, and
it is remembered — which matters, because reproducing something usually takes a
reload. `?profile` arms it before the first frame and is how a smoke script gets
it on, since the setting lives in `localStorage` and a fresh browser profile has
none.

**An arm from inside a frame drops that frame**, and it used to file it. The
settings toggle and a benchmark's first frame both arm part-way through a tick
whose `beginFrame` ran before there was a ring, so the first `endFrame` closed
a row with a `frameAt` of 0 — and `window.seconds`, which is the newest row's
stamp minus the oldest's, read as the page's whole lifetime until the ring
lapped. `FrameProfile.frameOpen` is what refuses that row now.

**The chip** (`#prof`, top-left) is up whenever the ring is recording, in every
state, and is the only sign that it is. It shows how much the ring is holding
and how many hitches it has seen, and carries three buttons:

| | what it does | where it lands |
| --- | --- | --- |
| **VIEW** | the full report, handed straight to the reader | `/profile_viewer.html`, opened in a new tab |
| **KEEP** | compact report — summary, memory, phase table, the worst frames whole | the clipboard (≈6 kB) |
| **SAVE** | the same plus the complete per-frame series | a download (≈70 kB for 1,000 frames) |
| **TRACE** | the last 600 frames as Chrome Trace Event JSON | a download, for `ui.perfetto.dev` |

**`VIEW` is the one that closes the loop, and it can only exist because the
reader is on the game's own origin.** Same origin means the same
`localStorage`, so the report is written to a key
(`greywatch.profile.handoff`) and the reader picks it up on load — no clipboard,
no paste, no file, and nothing leaving the device. That is the payoff of
shipping the reader in `public/` rather than linking somewhere else: it is the
difference between a capture being READ on the phone that took it and one being
mailed to a desktop by somebody who probably will not bother. The **full**
report goes over, series and all, because a hand-off has no size problem to
dodge and the timelines are most of what the reader is for.

Neither side clears the key. A reader that consumed it would come up empty on a
refresh — the first thing anybody does to a page full of charts — so the game
overwrites it on every hand-off and the reader prints the capture's own
timestamp rather than letting a stale one pass for fresh.

Two failures it handles rather than ignores. **Storage can refuse** (a private
window, a quota, a browser told to deny it) and that is no reason to lose a
capture: it falls through to the clipboard ladder below and says which happened.
And **`window.open` is called without `noopener`, with the reference severed
afterwards** — passed as a feature it returns `null` *by specification*, which
is indistinguishable from a blocked popup, and telling a player to open the page
themselves when a tab did open is the wrong report.

**`F3` is KEEP**, and it exists because on a desktop mid-round **the pointer is
locked and none of those buttons can be clicked at all**. On a phone there is no
lock and the buttons are the whole interface — which is the case this was built
for. The flash line under the chip reports what actually happened, because under
a lock there is no other channel back to the player. (`VIEW` has no key: under a
lock a new tab is the wrong thing to spring on somebody, and releasing the lock
is one keypress away from being able to click it.)

**The clipboard is tried three ways and that is not defensive coding.** The
async clipboard needs a secure context, and the way this game is really played
on a phone is a LAN address over plain http, where `navigator.clipboard` is not
merely going to reject — it is `undefined`. So: the modern API, then an
`execCommand` textarea, then a download. The last rung always works.

**`window.__profile`** is the instrument itself — `capture(reason, full)`,
`trace(maxFrames)`, `last()`, `armed`, `seconds`. It ships. A smoke script wants
this and not `__celshock`, because none of it is anything to do with the game.

---

## The benchmark: `?bench=<map>`

**A URL starts it, the game plays it, and it ends in a capture** — because the
devices it is for will not run a script (`PERF_PLAN.md` P0: USB and wireless
debugging both failed on the phone), and `BABYLON_EXIT.md` grades every step
from X0.4 on against it. Open `/?bench=sarab` (or `?bench` bare, for the map the
menu would offer) and the page builds that map, plays the run, and comes back
to its menu with the chip up and the run handed over: `VIEW` reads it. Nothing
else is needed, and nothing the player chose is changed — the map and the enemy
tier are the run's for its length and the stored picks come back after it.

**What it plays, in order** (`BenchScript`, every length in
`CONFIG.profiling.bench`):

1. **The bank's vantages, eight headings each.** The poses are
   `plans/webgpu-ref/`'s reference bank's — the menu's from `ui/mapShots.ts`,
   the rest from `src/bench/vantages.ts`, which the bank now re-exports
   rather than keeping a copy — one stop per POSITION, turned through a circle
   at the row's own pitch, with the world held as `deploy` holds it. Every
   stop and heading is first REHEARSED, unmeasured; then each stop is
   arrived at again, settled, and each heading MEASURED for `holdFrames`.
2. **One camera path through the densest quarter**: a loop around the
   quarter of the play square with the most BUILT ground — collider boxes
   weighed by footprint, because the boxes are the one description of a place
   this exit cannot move and a count of them is a census of tree trunks — at
   eye height over the street, lifted over a roof and walked past a trunk.
3. **A bot-only round from the fixed seed** (`bench.seed`, X0.2's 777;
   `?seed=` overrides): nobody is seated, so every slot fights, and the player's
   body is DEAD, which takes it out of every count. The first `leadSeconds` are
   stepped `leadSteps` fixed steps a frame and not measured — they are bots
   running to flags on every map, the empty frame `FINDINGS.md` 32 warned
   about — and then `fightSeconds` are measured one step a frame, the camera
   over the shoulder of the lowest-numbered bot still standing.

**A SETTLE ends when the device has caught up, and the first look at a place
is REHEARSED — both because of one measurement.** The first version settled
for a fixed 60 frames and measured each vantage straight away, and on the
Windows box, headless and uncapped, three runs of one map disagreed on a
vantage by up to 71% while the path and the fight agreed within 6%. Every
outlier was one frame that WAITED — 110 to 570 ms with no script and almost
no render in it, `loaf`'s "neither" verdict — 60 to 92 frames after the camera
arrived somewhere: the GPU's bill for arriving (the irradiance volume back on
its warm budget after a jump of more than half its window, pipelines first
used, a lamp's first shadow tiles) presented by a CPU that had run dozens of
frames ahead of it, so it landed in a hold on one run and a settle on the
next. The same run played three times in one page had five of them the first
time and none in a hold after. So a settle now runs until its last `frames`
frames were all QUIET (`BenchScript.settles`: none over `quietFactor` times
the fastest it has seen and `quietSlackMs` over it), capped at `settleCap`
times its length, and a `rehearsal` visits every stop and heading once before
the measured pass. **What a hold measures is what a view costs once it has
been seen** — the steady state a renderer change moves — and the first-look
bill stays on the path and in the fight, where every run pays it the same
way. A settle's length is the one thing the DEVICE decides, and it may be only
because a settle is never measured and steps nothing.

**A GPU-bound frame, uncapped, arrives in BURSTS, so no measured stretch may
be short.** With the settles and the rehearsal in, Kurenai's one stop still
moved 41% between three runs while its path agreed to 0.4%: at 3440x1440 the
map is GPU-bound (a 3.0 ms tick in a 4.1 ms frame), and the browser delivers
that as a CPU that runs ahead and then waits 180-320 ms for the GPU, about
every 1.3 s, at the same frames on every run. The mean over a long stretch is
right; a stretch of 288 frames catches none of those waits or one. So the
vantages between them are measured for at least `vantageFrames` (1,152, what
Greyfen's four stops already came to), each heading held longer on a map with
fewer stops.

**Everything is counted in FRAMES and fixed steps, never in wall clock, and
that is what makes two runs comparable.** Every bench frame advances the world
and every clock by `bench.dt` (1/60 s) whatever the device did, so a phone and
a desktop are shown the same frames in the same order and differ only in what
each one cost — which is also why the same fight happens on every run, on every
device: `FightHash` folds every award and every death, with the step it landed
on, into a hash the capture carries, and **two runs whose hashes differ did not
fight the same fight** and their `fight` segments are not comparable. The
frame TIME is still the real one, read off the same clock every capture reads.

**The capture says what each frame was showing.** The ring is armed at the
run's first frame, SIZED to the script (`BenchScript.frames`, every settle
counted at its cap, so nothing is ever lapped out), and every row carries a SEGMENT label: each vantage's hold,
the path, the fight, and three labels that are recorded but are not
measurements — `rehearsal`, `settle` and `lead`. Report version 13 rolls them up two ways,
`segments.list` (each label) and `segments.groups` (`vantages`, `path`,
`fight`), each with the wall clock's mean, p50, p95, p99 and 1% low, the tick,
`render`, the draw and mesh counts and `gpu.frame` over the rows that got a
reading; `bench` carries the run's own facts (completed or not, the plan, the
path's loop, the fight's hash and steps); `series.segment` labels every row of
a SAVE. **A capture with `bench.completed` false was stopped** — Escape, or a
round that ran out of tickets inside it — and its fight is short.

**It ends by HALTING the ring, not disarming it** (`FrameProfile.halt`):
nothing after the run's last frame is recorded and the buffers are kept, so
`VIEW`, `KEEP`, `SAVE` and `TRACE` all hand over the run and only the run, for
as long as the page is open. The report is written to the hand-off key at once
(`ProfileChip.benchDone`) — no tab is opened, because the run ends on a frame
nobody touched and a popup without a gesture is refused — and the chip says so
until something else is said. A halted profiler costs what a disarmed one does;
arming it again from the settings starts a fresh ring.

**Read it as a benchmark and not as a session.** The graphics are whatever is
in force — a fresh profile gets the device's defaults, and the capture says
which (`graphics`) — and the frame cap is the setting's. The HUD is drawn as the
death cam draws it, because the minimap is a real per-frame cost
(`FINDINGS.md` 13) and a run without it would flatter every device that pays
for it. Sound plays where the page may play it; on a phone with no gesture it
is silent.

**On a desktop, `node plans/webgpu-ref/bench.mjs [map...] --runs 3`** plays the
URL N times per map in one browser (a fresh context each time), checks every
run completed and fought the one fight, and prints each group's medians and the
SPREAD of its mean across the runs — flagged over the protocol's 8% — plus the
worst single segment per map. `--out f.json` keeps the result and `--against
f.json` prints each group's median as a ratio, new over old. It runs UNCAPPED
unless told `--capped`, the opposite of `gate.mjs`, because a run held at the
display's ceiling reports the ceiling; uncapping fabricates the collector's
rate, so no GC figure is read out of it. `--gpu` adds `?gpu`, and `--size WxH`
is the viewport, which is part of the workload rather than a detail of it:
3440x1440 unless told, the Windows box's own display — and the size at which
three runs agreed within 4% on every segment, where at the bank's 1920x1080 a
frame is ~2.5 ms, the browser's pacing jitter is a tenth of it, and a single
vantage's hold moved 23% between runs.

---

## The phases

`PHASES` in `profilePhases.ts` is the list, and **an index into it is a slot id**,
which is what keeps the recording loop free of strings. The brackets are in
`Game.ts` and nowhere else **except the four inside `render` and `present`
after it**: `tick`,
`updateGameplay`, `updateNetWorld` and `updateWorld` are where the frame's
order is already declared with the argument for it written down, so **the phase
list IS that order** and no system had to be taught the profiler exists. A
phase is a name in `PHASES`, a parent in `PARENT_OF` and a `begin`/`end` pair;
the ring, the report and the trace are all sized and labelled off that list.

```
frame                       the whole tick, wall to wall
├─ input                    InputManager.update
├─ roundBehind              the netplay round running under a lid
├─ gameplay                 the `playing` arm
│  ├─ driver / onFoot       whichever half of a body's frame this is
│  ├─ world                 updateWorld entire
│  │  ├─ net                updateNetWorld — a match's dressing
│  │  ├─ conquest           flags, tickets, the combatant list
│  │  ├─ vehicles           crews, hulls, the tracks' sweep
│  │  ├─ bots               battle.update + the muzzle-light budget
│  │  ├─ combat, grenades, antiTank
│  │  └─ physics            Havok and its three clients
│  ├─ camera                the eye, the lights, the chase cam
│  │  └─ localShadows       which lamps cast, their proxies packed (the passes
│  │                        themselves are drawn inside render)
│  ├─ zones                 the capture rings
│  └─ hud                   what a gameplay frame pushes at the chrome
├─ hudDraw                  HUD.update — every state owes it
├─ post                     the post chain, the sky, the shafts
├─ culling                  the cull cells, the motes, the rotors' dust, the shader's eye
├─ gi                       GiVolume.update: the lights, the params, recording
│                           three compute passes (their GPU time is gpu.frame's)
├─ audio                    pushHullEngines
└─ render                   scene.render()
   ├─ shadowPass            the depth map, on the frames that re-render it
   ├─ glow                  GlowPass: its mask and four blurs at the end of
   │                        the draw phase (the compose is inside the ink)
   ├─ drawWorld             rendering group 0 — the map and the bodies
   └─ drawOverlay           groups above it — the gun

present                     the engine's endFrame AFTER tick returns: the
                            render pass closed and queue.submit. A ROOT, not a
                            child of frame — see below.

  (residue)                 wall clock minus frame minus present: the rAF wait,
                            the compositor, the panel. Deliberately unnamed.
```

**That subtraction only means anything because a row's wall clock is the
interval its OWN spans fill, and until report version 4 it was not.**
`Game.tick` reads `getDeltaTime()` on its first line, so what `endFrame`
receives is the gap that has just CLOSED — `start(i) - start(i-1)`, filled by
the frame BEFORE this one. Filed against row `i` it was read against the spans
of the frame only now beginning, which is a confident wrong answer rather than a
missing one: a 90.6 ms tick, 86.6 of it `drawWorld`, arrived as a 91.5 ms wall
clock on the next row, whose own tick was a healthy 9.5 — reported as **82 ms
outside the game with no collection on it**, which is exactly the shape
`FINDINGS.md` §1 spent two milestones chasing. `endFrame` writes the delta
into `lastSlot` now, as `recordPresent` already did, and files a hitch against
the frame that FILLED the interval rather than the one recovering from it.

Over the three vsync-off captures that found it (Chrome 152, 3440x1440 G-Sync
fullscreen, two Sarab and one Cinderhaven), under the correct pairing **18 of
21 hitches on the Cinderhaven capture and 8 of 9 on one of the Sarabs are the
previous frame's tick**. Verified after the fix in a real round under an 8x CPU
throttle: minimum residue +0.30 ms over 884 frames, and 7 of the top 8 hitches
attributed to their own tick, which is what a CPU throttle should produce.

Two consequences worth knowing when reading a capture:

- **A residue can no longer be negative**, and one that is says the pairing has
  been broken again. Measured over the three captures that found this, the
  minimum went from **-60.5 ms to +0.1** and the count of negative residues from
  **133 in 3,000 to zero**.
- **A report's window is one frame shorter than its ring.** The newest row's
  interval is not known until the frame after it closes, so `buildReport` drops
  it — which makes `window.seconds` exactly the sum of `series.frameMs`, an
  identity that did not hold before.

**A v3 capture cannot be re-read, only re-taken.** Its aggregates are sound —
a mean over a window does not care which end a one-row shift is at, so `frame`,
`phases` and `memory` compare across the boundary — but every per-frame
verdict in it is one row out.

### The residue splits in two, and the browser is what splits it

The three-way decomposition above is honest and it stops one question short:
the residue is "the rAF wait, the compositor and the panel", and from inside the
page those cannot be told apart. **`long-animation-frame` tells two of them
from the third**, because it is the browser's own account of the same frame
rather than ours. A long animation frame covers every task from the end of the
last frame's rendering to the end of this one's, it is reported when that runs
over 50 ms, and it names the scripts inside it.

So the reading a hitch gets is:

| a hitch with… | means | and then |
| --- | --- | --- |
| a long frame, most of it `scriptMs` (or any `blockingMs`) | **the main thread was busy** outside `Game.tick` | `loaf.worst` names the script |
| a long frame, most of it `renderMs` | the browser's own **rendering** took it | on a page that is one canvas, that is compositing or the way to the screen |
| a long frame that is **neither** | the frame began and then **WAITED** | a scheduling answer, and not a cost at all |
| **none**, over `loaf.floorMs` | the main thread was **IDLE** | the time is not the page's — compositor, driver, panel |
| none, UNDER `loaf.floorMs` | **nothing** | the browser does not watch frames that short |
| none, where it is not supported | **nothing** | re-take it on Chrome 123+ |

**A long frame is not by itself a busy main thread, and reading it that way is
the trap.** The first capture that mattered carried a **263.5 ms window over
8.7 ms of script with zero blocking** — which the viewer confidently called "the
main thread was busy through it" and which was nothing of the kind. The three
shares are three different verdicts and the duration alone is none of them.

**What a WAIT looks like, measured** — two v6 captures, Cinderhaven at
3440x1440, 32-36 bots alive, 2,999 frames each. Every hitch in both, split by
`renderStart`:

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

**And an absence only means something above the floor.** The specification
reports at 50 ms, so a 44.9 ms hitch is invisible to this probe by design — six
frames between 24 and 50 ms in that same capture were filed as "the main thread
was idle" when the truth is that nobody looked. `loaf.floorMs` ships so a
reader never has to know the number.

**The ABSENCE is the finding, which is why `loaf.supported` ships in every
capture** — the same rule as `memory.heapLive`. On a browser that never reports
these, every hitch looks like an idle main thread, and a report that let that be
read as a result would be worse than one that said nothing. Nothing but Chromium
reports them at the time of writing.

Four details that are not obvious:

- **A long window MARKS SEVERAL ROWS, on purpose — so the marks cannot be added
  up.** `loaf.rows` is how many rows carry a mark and `loaf.entries` how many
  long frames put them there; **every total is over ENTRIES**, because summing
  the marks counts one window once per row it touched. That was wrong in v6 and
  the number it produced was not merely inflated but meaningless: 26 entries
  over 50 rows came back as 11,246 ms of long frames inside a 22,150 ms window,
  or 51% of the wall clock. Entries never overlap each other, so the earliest
  row each one touches identifies it and `loafHead` marks that row.

  The marking itself is not negotiable: the browser's frame and this
  instrument's row are different intervals — a long animation frame runs render
  to render, a row owns its own start to the next row's start — so one window
  straddles two rows by construction. Trying to pick one gets the common case
  backwards: filing against the row the window ENDED on put a planted 120 ms
  `setTimeout` on the 4 ms frame that recovered from it, and every hitch in the
  test read `loaf: 0` while the entry explaining it sat one row away. That is
  `endFrame`'s pairing bug one layer up. Every overlapped row is marked instead,
  and `loaf.entries` counts ROWS rather than entries.
- **`buffered` is false**, so a capture does not inherit every long frame since
  the page loaded. The longest of those is always the map install, which is not
  a hitch and would take every slot in `loaf.worst` before a round had drawn.
- **Stale records are pruned as they are KEPT, not merely as they are
  reported**, or the list starves for the same reason. An install's long frames
  are never displaced by anything a round produces, and once the ring has lapped
  past them `worstLoaf` drops them — so the list reports almost nothing while
  refusing everything worth keeping. Measured on a real capture before the fix:
  **three records survived of twelve held**.
- **It is allowed to allocate**, the second exemption from the no-allocation
  rule after the GC sentinel, because it fires only on frames the browser has
  already called slow. The bound for a device where that is every frame is in
  `keepLoaf`: once `CONFIG.profiling.loafKept` records are held, an entry that
  would not displace the smallest builds no object at all.

Report **version 5**. `series.loafMs` is the per-row series and reads best laid
against `frameMs`: where the two rise together the main thread was busy, and
where `frameMs` rises alone it was not.

**The last four are not brackets in `Game.ts` and cannot be**, because the
boundaries they want are inside `scene.render()`. `FrameProfile.hookRender`
hangs them off the scene's own observables at `arm` and takes them off again at
`disarm`, finding the shadow map through `scene.lights` and taking the glow
as two observables handed to `arm` (`GlowSpans`) — so no system knows about
them either.

**They cannot overlap, and the method's header carries the proof** rather than
the assertion: `Scene._renderForCamera` runs the render targets (the shadow
map) *before* it opens the draw phase, the camera's own pass *inside* it with
the glow's mask and blur at its very end, and the post chain — the ink, with
the glow's compose as its last line — *after* it closes. The group spans are
gated on being in that draw phase, because `onBeforeRenderingGroupObservable`
is the SCENE's and a render target's
own rendering manager fires it too — without the gate the shadow map's groups
would be added to `drawWorld` on top of `shadowPass`. **The glow closes the
gate when its span opens**, since its mask renders from the same end-of-draw
observable before the profiler's own observer there runs; until it did, the
mask's groups were being added to `drawWorld` too.

**What is left inside `render` and named by nothing** is the active-mesh
evaluation (the `Mesh walk` counter, which is the same number in other units),
the post chain, a frame's share of a reflection bake, and the present. Measured
on Hollowmere headless, 969 frames at 101 fps: `render` 4.86 ms, of which
`drawWorld` 2.15, `glow` 1.04, `drawOverlay` 0.25 and `shadowPass` 0.73 — 86%
of the bar attributed, and the glow's share of the whole frame **10.5%**, which
is the first continuous reading of a figure `CLAUDE.md` had only from an A/B.

**`shadowPass` reads on a HANDFUL of frames and that is the finding, not a
fault.** The depth map is `REFRESHRATE_RENDER_ONCE` with a manual reset, so it
re-renders only when the texel-snapped light window moves — 3 frames in 969 on
that run. **Read `PhaseStat.frames` before `mean` on any phase like this**: the
mean is over the frames that ENTERED it, so a phase costing 0.73 ms on three
frames and a phase costing 0.73 ms on all of them have the same `mean` and the
same `share`, and only `frames` tells them apart.

**What they measure is CPU.** Under `compatibilityMode = false` that is the
recording of a render BUNDLE and not the work the GPU then does — still the
right thing to watch, since the whole of `docs/rendering.md`'s "Why the frame
is draw-call bound" is that this frame
is bound by submission, but a group whose bundle Babylon reuses reads cheap
while the GPU is busy. See **GPU time** below.

**A span that opens more than once a frame closes through `endAdd`**, which
ADDS rather than assigns — a rendering group is entered once per group, the glow
twice — and `entered` is what tells it which close is the frame's first. That
works because `endFrame` clears the slots of the frame it is about to
overwrite; nothing else in the file depends on that write, and this does.

**They nest and they do not partition.** What is left inside a span is the lines
nobody thought worth naming — read a report as an ATTRIBUTION, exactly as
`buildProfile`'s header says to read the build's.

**A span never closed is never recorded**, which is what makes this safe at the
sites sitting on an early return: `beginFrame` clears the open table, so a stamp
can never leak into the next frame. `updateGameplay` deliberately closes `world`
*before* its early return rather than around it — a frame that ends the round
still spent the time, and `world` reading as "not entered" on the most
interesting frame of a session would be the wrong kind of missing.

**Adding a phase** is a name in `PHASES`, a parent in `PARENT_OF` (it will not
compile without one) and a `begin`/`end` pair — or, inside `render`, a
`begin`/`endAdd` pair on an observable in `hookRender`. Nothing else moves,
unless it is a new ROOT, for which see `present` below.

### `present`, and the two roots

**`present` is the one phase that is not inside `frame`.** `frame` is
`Game.tick`, wall to wall. `present` is what Babylon's render loop does *after*
`tick` returns: `WebGPUEngine.endFrame` closes the current render pass, runs
`flushFramebuffer` — which is `queue.submit` — and then fires
`onEndFrameObservable`. `FrameProfile.hookEngine` hangs the close off that
notification, because there is no line in `Game.ts` that could hold it.

It cannot go through `begin`/`end` like everything else, and the reason is the
ring rather than the clock: `endFrame` is the last line of `tick` and ADVANCES
`cursor`, so by the time the engine notifies, `cursor` names the frame about to
start. `recordPresent` writes into `lastSlot` instead — the row `endFrame` just
finished — and stamps `tickEndAt` as the last thing it does, so the profiler's
own bookkeeping is not charged to the submit.

**So a report now decomposes the wall clock into three parts, and the third is
an answer rather than a gap:**

```
wall (frame.mean)  =  frame  +  present  +  residue
                      ^tick     ^submit    ^everything between the submit and
                                            the next frame opening
```

The residue is the rAF wait, the browser's compositor and the panel. **It is
deliberately not a phase**: the page cannot tell those three apart, and a name
would be a claim. What the split buys is the ability to say which side of the
submit a missing millisecond is on — measured on Sarab at 3432x1432, `frame`
77.9%, `present` 0.3%, residue 21.8%, summing to 100.0%.

**`present` is normally almost free** — 0.027 ms mean on that run, well under
the clock grain, so read its MEAN and never its percentiles (it is in
`clock.belowGrain` for that reason). A `present` that grows is submission
backpressure; a residue that grows is not the game's at all.

**There are therefore TWO ROOTS**, and the report says so. `ROOTS` is derived
as `PHASES` minus the keys of `PARENT_OF`, so it cannot drift from either, and
it ships as `ProfileReport.roots` (report **version 3**). That field exists
because a reader handed only a child→parent map cannot distinguish a root from
a phase it has never heard of, and the two want opposite drawings: a root is a
top-level bar, an unknown phase is a warning that the reader is stale.
`profile_viewer.html` drew the second for both until `roots` existed, and its
`FALLBACK_ROOTS` is the copy that covers a version-2 capture and a TRACE.

**A phase that is a new ROOT is the one case where adding it to `PARENT_OF` is
wrong.** Add it to `PHASES`, widen the `Exclude` in `PARENT_OF`'s type so it
still refuses every non-root, and add it to `FALLBACK_ROOTS` in the viewer.


---

## The heap and the collector

**§1's leading suspect was GC, and until this the instrument built to chase it
could not see a collection.** Two readings answer that now, and they are
deliberately separate because one of them usually does not work. **They have
since answered it the other way**: read with this instrument, §1's captures
EXONERATED the collector — a stretch running at 17–20x the collection rate was
the smoothest in its capture — so GC is no longer the suspect, and the
no-allocation rule above stands as a rule rather than as a hypothesis being
chased.

**Collections are watched with a `FinalizationRegistry` sentinel.** An empty
object is registered and dropped in the same expression; the collection that
sweeps it calls back, which is one collection observed, and the callback
registers the next. That costs one object per GC event and none per frame, and
it needs no flag, no header and no permission — it works on the phone. What
lands in a report is `memory.gcEvents`, `memory.gcPerSec`, and a per-frame count
on every hitch (`HitchFrame.gc`), plus an instant marker down the flame chart in
a trace.

**Read it as "a collection happened around this frame", never as "the pause was
this collection".** The callback runs in a task *after* the collection rather
than during it, so a count lands on the frame it interrupted or the one after;
the engine may batch; and nothing here tells a young-generation scavenge from a
major one. That is still enough for the question §1 asks, because the question
is answered against the phases: **a hitch whose spans do not add up to its wall
clock, with `gc` on it, is a collection — and the same shortfall with `gc` at 0
is the browser, which is a different investigation.** Eliminating the leading
suspect is worth as much as confirming it.

**The heap itself is usually FROZEN, and the probe exists to say so rather than
to let a report imply otherwise.** Chrome rate-limits the bucketised
`performance.memory` to **one update every twenty minutes** — deliberately, so a
page cannot compare memory before and after a dubious action — so on a stock
browser the number does not move and a series drawn from it would be a flat line
read as "nothing is allocating". `probeHeapLive` settles it on arming by
allocating `CONFIG.profiling.heapProbeMb` (16 MB) and reading again;
`memory.heapLive` carries the answer, and where it is false the heap fields are
0 rather than a plausible fiction. `--enable-precise-memory-info` is what drops
the refresh to 20 ms, and it is what a Playwright run should pass.

Where it *is* live, the number to watch is **`memory.allocMbPerSec` — the sum of
the RISES over the window, not the difference of its ends.** A heap that climbs
40 MB and is collected back to where it started has a net delta of zero and an
allocation rate of megabytes a second, and it is the second figure that says why
the collector keeps waking up. Measured on this box, Hollowmere, headless at
130 fps: **157 MB mean, 184 peak, 27.4 MB/s — about 210 kB a frame — at 2.2
collections a second.** That is the first real number behind §1's oldest guess,
and the reason it is worth re-taking after anything touching the frame path: the
no-allocation rule this profiler holds itself to is one nothing else in the game
obeys, and this is the only readout that would notice it being broken somewhere
that matters.

**`gcEvents` is summed from the ring at capture time, over the same frames as
every other figure in the report** — and that is a correction rather than a
description. It was a running total kept since ARMING while `gcPerSec` divided
it by the WINDOW's seconds, so any session that outlived its own ring reported a
rate it had never run at. A real capture caught it: 7 events over a 36.18 s
window whose ring held 4, an overstatement of 75% on the number that rides the
flash line. **The figures quoted above are unaffected** — that run was 12 s
against a 23 s ring, so nothing had aged out — but anything measured over a long
session before this was fixed should be re-taken.

`memory.gcPerSec` also rides on the **flash line**, because under a pointer lock
that is the only channel back to the player and "is it GC" is the whole question.

### Uncapped, the collector reading lies — and the capture that cleared it

**A collector reading taken HEADLESS AND UNCAPPED nearly closed `FINDINGS.md`
§1 wrongly.** At 220-700 fps the game allocates the same ~200 kB a FRAME and
therefore two to seven times as much per SECOND as a real session does, which
wakes the collector at 1.5-1.8/s and makes GC frames 1.7x-4.5x the cost of a
clean one — a tidy, wrong answer. On the real machine the rate VARIES — **2
collections in 31.4 seconds (0.06/s)** on one Sarab capture at 95 fps with
`gc: 0` on every hitch, and `gcPerSec` 2.77, 1.49 and 1.62 on three Cinderhaven
captures — and it does not matter which, because **the collector is
exonerated** by the table at the end of this section. **Do not measure
allocation pressure uncapped**; the rate per second is what the collector
responds to, and uncapping fabricates it.

The wrong answer, kept because it is what an uncapped run will hand the next
person. **Taken on the Windows box, with a REAL round under it** — walking,
sweeping the view, firing in bursts — through the shipped profiler (`?profile`,
`window.__profile.capture("x", true)`), 3,000 frames a map, split by whether a
collection landed on the frame:

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
§1's own "a visible hitch roughly every 1.7 seconds" arriving from the other
end — headless and uncapped, which is what made it look like one.

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

**What cleared the collector**, off the real display (Cinderhaven, 3440x1440,
vsync on at ~143 Hz). The collection rate steps **20x at the hitch and stays
there**, which looks exactly like a cause until the tail is read:

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

### Finding WHO allocates, which the capture cannot say

**`allocMbPerSec` says how much and never where**, and it is too coarse to see a
fix: removing ~350 B a frame from a 385 kB frame is inside its run-to-run
spread. The instrument that names the allocator is not in the profiler and
should not be — it is the DevTools protocol's sampling heap profiler, driven
from a Playwright script over a CDP session:

- **`HeapProfiler.startSampling` drops COLLECTED objects by default**, and
  per-frame garbage is exactly the collected kind. Pass
  `includeObjectsCollectedByMinorGC` and `includeObjectsCollectedByMajorGC`, or
  a function allocating kilobytes a frame reads as zero in BOTH builds of an
  A/B — which looks like a fix that did nothing rather than an instrument that
  saw nothing.
- **Attribute each sample to the innermost frame under `/src/`**, and keep the
  innermost frame of all beside it: a builtin (`subarray`, `Set`, `add`,
  `assign`, `hypot`) or a Babylon getter there IS the answer. A
  `samplingInterval` of 16 bytes over ten seconds of a round resolves tens of
  bytes a frame. Always run the parent commit the same way — a row present in
  both builds is not the change's.

**Without those two flags its answer looks like good news.** At a 2 kB interval
over the same round as a frame-profiler capture it reported **0.2 MB/s** — 260x
under what the frame profiler was reporting, and low enough to close
`FINDINGS.md` §1 by mistake. V8 drops a sample when the object it sampled has
been collected, so what comes back is what SURVIVED: it measures retention, not
churn, and churn is the whole of that finding. With both flags on, the same run
reports **51.6 MB/s**, agreeing with `memory.allocMbPerSec` to 5%. **Ask for
those flags or do not believe the number.**

**And per-SITE attribution out of it is not to be trusted on our own files
without an A/B.** Two of its top twenty named a function that allocates nothing
— `eyeDistanceSq` (see `docs/rendering.md`'s front-to-back sort) and `buildBreathBuffer` (then on `Sfx`, now `AmbienceVoices`), which is called
once at init — because V8 attributes a sampled allocation to the JS frame on
top at the time, and a function called 22,000 times a frame collects
attribution that belongs to its callees. The FILE-level split is sound; a
single line is a hypothesis, and the memoised sort in `docs/rendering.md` is
what happens when one is taken at face value.

**A function that runs ONCE A FRAME never reaches V8's top tier, and that
changes what allocates in it.** Measured in a live round with
`--js-flags=--allow-natives-syntax` and `%GetOptimizationStatus`:
`GiVolume.chooseFast` and `LocalShadows.packDynamic` were still on MAGLEV a
minute in, while `LocalShadows.reaches` — called per box per face, thousands of
times a second — was on TurboFan. **Calibrate the status bits before reading
them**, against a throwaway function forced with `%OptimizeFunctionOnNextCall`
and one forced with `%OptimizeMaglevOnNextCall`; the layout moves between V8
versions and a bit read from memory was wrong here. On the mid tier:

- **Every `Vector3` `.x`/`.y`/`.z` read is a boxed number**, because Maglev does
  not inline Babylon's getters. Hand-inlining `Vector3.Distance` into
  `chooseFast` as `p.x - eye.x` arithmetic took it from 3.3 kB to 6 kB a frame:
  it traded one boxed return per fixture for six boxed getter reads.
- **A double passed to or returned from a call it does not inline is boxed** —
  `Vector3.Distance`'s result, a `score` argument, six box extents as
  parameters.
- **`for...of` over an array allocates an iterator per loop**, and an inner loop
  runs once per outer element (~1.7 kB a frame in `chooseFast`'s cluster test).
- **`Object.assign`, `subarray` and `Math.hypot` allocate** on every call.

What works is to put the per-ELEMENT work in a small method that the loop calls
often enough to reach TurboFan, with no double crossing its boundary — objects
in, an integer or a boolean out (`GiVolume.fastKind`, `LocalShadows.reaches`
reading its box from an array and offset) — and to write the rest as indexed
loops over typed arrays and field-by-field copies. Measured on Hollowmere:
`packDynamic` 7,117 → 155 B/frame, `chooseFast` 3,293 → 76. **Check a rewrite
with the sampler rather than by reading it**: which tier a function lands on is
decided by its call count, not by how the code looks.

---

## Reading a capture

A real one, Hollowmere, 1,038 frames over 9.2 s on the Windows box:

```
clock grain 0.1 ms · span overhead 0.225 us
frame: 106.8 fps · mean 9.361 · p99 24 · max 682.5 · 1% low 180.5 ms · 11 hitches
counters: 569 draws · 223 meshes · walk 1.158 ms · rtt 0.895 ms

phase            frames    mean     p95     max   share
frame             1038   4.721   6.100  49.900   50.4%
render            1038   4.256   5.400  49.400   45.5%
gameplay          1031   0.414   0.600   9.200    4.4%
camera            1031   0.163   0.300   3.400    1.7%
world             1031   0.117   0.200   2.800    1.3%
bots              1031   0.095   0.200   2.200    1.0%
hud               1031   0.095   0.200   1.900    1.0%
...
below one clock grain: input, roundBehind, onFoot, conquest, vehicles, bots,
  combat, grenades, antiTank, physics, glass, zones, hud, hudDraw, post,
  culling, audio
```

**`frame`'s own share is the first thing to read and the least obvious.** The
`frame` span is the TICK; `frame.mean` in the summary block above it is the
WALL CLOCK between frames. Here the tick is 4.7 ms of a 9.4 ms interval —
**50.4%** — and the other half is the browser: vsync wait, present, compositing,
whatever the page is doing outside `runRenderLoop`. A share near 100% means the
game is the bottleneck; a share near 50% on a machine that is not hitting its
panel's cap means something outside this instrument is.

**`render` is one enormous bar and always will be.** That is `docs/rendering.md`'s
"Why the frame is draw-call bound" — the frame is
draw-call bound and Babylon's WebGPU backend charges CPU per draw — which is why
`SceneInstrumentation`'s counters ride alongside: `drawCalls`, `activeMeshes`,
`meshWalkMs` (the scene walk `ENGINE_UPGRADE.md` S1 is about) and `renderTargetsMs` (the shadow map
and the reflection bake). Those four are what the big bar is made of, and a
change in them is the change worth chasing. Two readings taken by hand-wrapping
belong beside it (Windows box, live round, 2026-08-26, before the paint palette —
`docs/rendering.md`, "Why the frame is draw-call bound"):

- **The game's own JS is a tenth of the frame and the rest is Babylon's** —
  2.2 ms of a 20.6 ms frame on Coldharbour, 1.7 of 18.8 on Harrowmead — which
  is the number that closes the "move it to workers" question before it is
  asked: `scene.render` is JS on the thread that owns the device, so an
  `OffscreenCanvas` worker RELOCATES 18 ms rather than removing it, and the
  worker becomes the wall. What is genuinely worker-shaped here is burst work
  and not the frame — `MapBuilder`'s geometry, the AO bake, the
  `NavGrid`/`CoverMap`/`ObstacleField` builds, `FINDINGS.md` 11's editor
  tier-3 — and moving any of them buys load time and nothing else. Do not
  re-derive this. Inside that tenth, on real hardware rather than an earlier
  inflated headless run: `player.probeGround` was **0.483 ms** and everything
  else under 0.12 (`updateHud` 0.112, `battle.update` 0.094, `minimap.update`
  0.086, `lighting.update` 0.063). **The ground probe was a third of the game's
  own budget and is now gone** — `docs/world.md`'s ground-probe section carries
  what closed it and what it measures at now.
- **Detaching the whole post chain is -4.6%**, which is free within drift: the
  four chained passes (`FINDINGS.md` 5) cost nothing on this hardware, and an
  earlier WebGL2-era reading of ~1% (47.3 against 46.4 fps on Coldharbour)
  holds.

**`clock.belowGrain` names the rows whose TAILS are fiction.** Chrome quantises
`performance.now()` to 100 us absent cross-origin isolation, and seventeen of
the twenty-two phases here cost less than that. Their MEANS are real — a phase
boundary falls at a uniformly random offset within the grid, so the difference of
two quantised stamps is unbiased over a thousand frames — but a `p95` of exactly
`0.100` is one grain, not a measurement. **This instrument answers "which
phase", never "which function"**; a 3.5 us box query (`RayWorld`) is micro-benchmark
territory and always will be.

**The hitch list is where the position pays.** Each kept frame carries its whole
phase breakdown plus where the player was standing, how many bots were up, and
the draw and mesh counts. Block visibility, the merge blocks and the terrain
patches are all keyed to PLACE, so *which street was I in when it hitched* is
most of the diagnosis — and it is not recoverable from a stack of milliseconds.
In the capture above the worst frame is 682 ms at `(0, 3, -8)` with **0 bots**,
which is the spawn: the round's first frames are the pipeline compiler (§16),
not the game.

**Each hitch also carries `gc` and `heapMb`, and those two are read against the
phases rather than on their own.** Add up a hitch's spans: if they account for
its `frameMs`, the phase list has already named the problem. If they fall well
short, the time was spent outside the tick, and `gc` is what says whether it was
the collector. **From report version 4 that subtraction is between two facts
about the same frame** — before it a shortfall was mostly the pairing bug
above, so do not read an old capture's "outside the tick" verdict.

That block above predates both fields — it was taken before the memory readings
existed, and the numbers in it have not been re-taken, because a capture
re-printed from a later run is a capture of something else.

**From report version 10 a capture states the GRAPHICS it was drawn with**
(`graphics`), and **`device.coarsePointer`**, the test that picks every
per-machine default in `settings.ts`. Before it, two tablet captures on Sarab
and Cinderhaven had to be read against a guess — the render scale worked back
out of the backing store and every rung assumed to be the touch default. Three
details:

- **The values are the ones IN FORCE, not the ones stored.** `?gi=`,
  `?shadows=` and `?volumetrics=` override the setting for a session, and
  `graphics.forced` names the keys the URL decided — a capture taken to compare
  rungs that reported the stored one would be wrong about the one thing it was
  for. `Game.pushProfileGraphics` reads each value after `applySettings` has
  put it in force.
- **`inForceSeconds` is how long they had stood**, and one shorter than
  `window.seconds` means the window STRADDLES a change — its aggregates are a
  blend of two configurations. The clock restarts only when a value moves,
  because `applySettings` runs on every change to every setting, a look speed
  included. The viewer says so in words.
- **`?nominimap` is the one lever here that is not a setting**: it takes the
  corner map off for the session (never put up, never prerendered, never
  drawn) and the capture says so as `graphics.minimap: false`, with `minimap`
  in `forced`. It exists for FINDINGS.md 13's HUD A/B — the map is the one
  piece of chrome redrawn in full every frame, and its raster and the drop
  shadow re-applied under it are work no span here can see. Absent in a capture
  from before the flag, all of which drew it.
- **A new graphics setting owes a field here**, in `ProfileGraphics`,
  `sameGraphics` and the viewer's `Graphics` row, or captures go on describing
  a configuration that no longer names everything the frame paid for.

**From report version 13 a capture can be a BENCHMARK's** — `bench`,
`segments` and `series.segment`, null and absent on every other ring — and
"The benchmark" above is how to read one. Nothing older changed meaning.

**From report version 12 a capture states the round's SEED** (`seed`, pushed
by `Game.buildRound` through `FrameProfile.setSeed`), which is every outcome in
an offline round (`systems/RoundRandom.ts`): reopen the game with `?seed=<n>`
and the same map, and the round in the capture is fought again. It is null
before a first round and in a match, whose seed is the AUTHORITY's and is in
the server's log (`round started on <map>, seed <n>`). The viewer prints it
beside `taken`.

---

## Reading one: `/profile_viewer.html`

**A capture is JSON, and JSON is not a reading.** The numbers that matter are
differences between fields — a hitch's wall clock against its own `frame` span,
that shortfall against its collection count — and nobody does that arithmetic in
their head off a phone's clipboard.
[`public/profile_viewer.html`](../public/profile_viewer.html) does it. Press
`VIEW` on the chip and the capture arrives on its own; otherwise paste or drop a
`KEEP`/`SAVE` report or a `TRACE`, and it detects which.

**It is served from the game's own origin, and that is the whole point rather
than a convenience.** This instrument exists because the interesting devices are
phones and other people's laptops. A viewer somewhere else means mailing
yourself a file from the device you are standing on, which is a step nobody
takes — so the reader is one navigation away from the game that produced the
capture, and `docs/pwa.md` covers what that cost the service worker.

What it draws:

- **A verdict on the worst frame**, which is the reading this file prescribes
  made mechanical: wall clock minus the `frame` span is the time outside the
  tick, and the collection count on that frame says whether it was the collector
  or the browser.
- **The attribution ladder** — the phase tree indented by containment, each bar
  drawn *against its parent rather than against the frame*, with an explicit
  `unattributed` remainder per parent. Sub-grain rows are marked and their
  percentile columns dimmed, because this file says their tails are the grid.
- **The frame timeline**, scaled so the body of the distribution is legible with
  everything over the clip drawn as a full-height spike, the hitch bar and 60 Hz
  as references, and collections on a rail along the top.
- **The heap**, where it is live, with the collections aligned to it — and the
  frozen notice where it is not, rather than a flat line.
- **Draw calls and active meshes per frame**, under the other two and on the
  same x, so a ramp in the draw count can be laid against the frames it cost.
  Both are counts of the same kind of thing, which is the only reason they share
  an axis. They are in the SERIES rather than only in the summary because the
  means cannot answer the question they are most often asked: a batch of
  pipelines coming into view is a draw count CLIMBING over about a second, and
  against one number for the whole window that is invisible — it had to be
  inferred from five disconnected hitch records the first time it came up. A
  capture taken before the fields existed simply has no panel.
- **GPU time, as a SCATTER and never a curve**, against the frame's own budget
  (`frame.baselineMs`) rather than a nominal 60 Hz — what makes a GPU reading
  interesting is whether it fits the interval the display is actually handing
  out. Only about half the rows carry a reading, so joining them into a line
  would draw every gap as the GPU dropping to idle, which is the misreading the
  panel exists to prevent: a row with no dot is an unmeasured frame. **And the
  reading reaches the VERDICT** — a hitch the main thread was idle through now
  says what the GPU did on that frame, which is the sentence `?gpu` was armed
  to make ("the frame began and then waited, and the GPU did 1.75 ms of work on
  this frame"). The tile prints a REASON where it has no number, because
  `gpuRead`'s five silences are five different facts and one of them —
  `unmeasurable` — looks exactly like an idle GPU.
- **What was compiled** (report version 11): a `Compiles` tile whose foot is
  how many slow frames sat on a creation, a `compiled` tag on each such hitch, a
  rail of creations along the bottom of the frame timeline, and a table of the
  creations themselves — kind, the frame they landed on (red when it was slow),
  the shader, the pass Babylon's label names and the define set. Absent on an
  older capture rather than empty.
- **The long-frame totals for the window**, as a tile and a row — but **only
  from report version 9**. Before it the ring never cleared a row's LoAF
  numbers when it lapped, so those totals carry every long frame the PROCESS
  ever saw rather than the window's; the viewer withholds them and says so
  rather than printing a confident wrong number. The per-hitch fields,
  `loaf.worst` and `series.loafMs` were always right and are shown for any
  version.
- **The flame chart** for a trace, with GC instants — and it stacks its rows
  two ways, because one shape cannot answer both questions. **DEPTH** is the
  flame chart proper: a row per level of the phase tree, siblings packed onto
  one row, which is what shows containment at a glance and what keeps a frame
  four rows tall. **LANES** (the button beside `Fit`) gives every phase in the
  trace a row of its OWN, named down a gutter, in the order a frame runs them
  — so a phase that is a hairline beside its siblings is still a line you can
  read along, and a phase that did not run in a given frame is a GAP in its own
  row rather than something you have to notice is missing from somebody else's.
  Depth is the default. The tone stays the depth ramp in both, so containment
  still reads in lanes, where the row no longer says it. Only the phases the
  trace actually contains get a row, so a shallow capture does not open onto
  empty ground. Perfetto is still the better tool for a trace and the section
  below still points at it; this is the look you take without leaving the phone.

**The capture states its own tree.** `ProfileReport.tree` is `PARENT_OF` from
`profilePhases.ts` — child phase to the span containing it — so the viewer draws
the containment of the build that produced the capture rather than of the build
it was written against. `PARENT_OF` is typed `Record<Exclude<Phase, "frame" |
"present">, Phase>`, so **a phase added to `PHASES` does not compile until it says where it
sits**, and adding one is still a name, a `begin`/`end` pair, and now its parent.
The viewer keeps a `FALLBACK_TREE` — and, since the frame grew a second root, a
`FALLBACK_ROOTS` beside it — for captures older than those fields; those two
copies are the only things in the page that can go stale. **A TRACE always uses it** —
Chrome's format carries no tree, so a `TRACE` export has nowhere to state one —
which makes the fallback load-bearing rather than a legacy path: a phase missing
from it lands at depth 0 and is drawn as a top-level bar over `frame`, silently
and confidently. It went stale exactly once that way, when `render` grew its
four children. **Add a phase to `PARENT_OF` and add it here in the same
change.**

**Three rules for editing it**, all of them things the file cannot enforce about
itself:

- **No network.** No fonts, no CDN, nothing. The type is the same system stack
  `src/ui/base.css` uses, for the reason the game carries no font files, and a
  capture never leaves the browser it was opened in.
- **No imports and no build step.** It is copied out of `public/` verbatim and
  is never typechecked — the `src/pwa/sw.js` arrangement — and it must open from
  a `file://` URL with nothing else present.
- **Its path is written in THREE places and they must agree**: the file's own
  name in `public/`, `DOCS` in `src/pwa/sw.js` (or it becomes the game offline),
  and `VIEWER_PATH` in `src/ui/ProfileChip.ts` (or `VIEW` opens nothing). A
  rename that misses one fails silently, and two of the three fail only offline
  or only on somebody else's phone. The hand-off key is spelled in two of them.

---

## The trace

`TRACE` writes Chrome Trace Event JSON. Open it at **`ui.perfetto.dev`**, which
is still the right tool for a trace and always will be — nothing here competes
with it, and nothing here should try. (`/profile_viewer.html` will draw a flame
chart from one, because the phone that took the capture has no Perfetto and no
file manager worth the name; it is a look, not a replacement.) The spans nest properly by
construction (`frame` ⊃ `gameplay` ⊃ `world` ⊃ `bots`, each start stored
relative to its own frame), so a flame chart falls out with no further work, and
`drawCalls`/`activeMeshes` ride along as counter tracks.

**THE WINDOW IS CENTRED ON THE WORST FRAME IN THE RING, and that is this
file's one design decision finally applied to the one place it had been left
out.** The ring holds 3,000 frames *because the gesture is pressed after you
feel something* — and then the trace exported the last 600, which is to say
whatever happened to be on screen when the thumb arrived.

The arithmetic was never close. At 86 fps a 600-frame tail is **seven seconds
against a thirty-five second ring**, and a person who feels a hitch and reaches
for a button takes longer than that. What came back was a trace of the recovery,
and nothing in the file said so — which is the part that cost real time: a
healthy-looking trace is indistinguishable from a trace of a healthy game. The
export that prompted this had a worst frame of **17.6 ms in the file and 332 ms
in the ring behind it**.

So `trace()` finds the worst frame by wall clock — the same measure the hitch
list ranks by, so the two artefacts agree about which frame is interesting —
and builds the window around it. **Centred rather than ending on it**, because
both sides are evidence: what was building up before, and whether it cascaded
after. **Clamped to what the ring holds**, so a hitch in the first or last
frames still comes back inside a full window rather than half of one — which is
the common case, since the worst frame of a session is usually the spawn.

**And the trace now says which window it is**, in two places, because the
failure above was only confusing for want of a label:

- the Perfetto track name — `frames 1-600 of 2067 · centred on the worst
  (692.3 ms)`, which `/profile_viewer.html` also prints above the flame chart;
- an instant marker on the worst frame itself, so it is one click away instead
  of something to find by eye.

`window.__profile.trace(n)` still takes more, and `trace(3000)` is the whole
ring. A trace carries no map, no device and no memory block — that is Chrome's
format, not this instrument's — so for anything but the shape of a frame,
`SAVE` is the better artefact.

---

## GPU time, and why it is a BOOT FLAG

Everything else here is CPU, and under `compatibilityMode = false` that is the
recording of a render bundle rather than the work the GPU then does. **`?gpu`
adds the other half**, and it is the one thing in this instrument that a setting
could never turn on: `timestamp-query` is a device FEATURE, a device's features
are fixed when it is created, and a required feature the adapter does not have
makes `requestDevice` **reject**. So `main.ts` asks the adapter first and boots
normally when the answer is no — a diagnostic flag must never become a boot
failure — and a capture carries `gpu.requested` and `gpu.available` as two
separate questions, because "nobody asked" and "the adapter refused" are
different facts and neither is "the GPU took no time".

**AND THERE IS A THIRD QUESTION, WHICH IS THE ONE THAT ACTUALLY BITES:
`gpu.frameMeasurable`.** `?gpu` is necessary and not sufficient — on Chrome
the whole-frame counter ALSO needs **`--enable-unsafe-webgpu` on the command
line**, and without it the report comes back `requested: true, available: true,
frame.samples: 0`, which reads exactly like a GPU that did no work. Babylon
brackets the whole command encoder with `GPUCommandEncoder.writeTimestamp`,
which was removed from the WebGPU spec and which Chrome therefore keeps behind
that flag; the FEATURE and the `timestampWrites` pass descriptor `gpu.mainPass`
is written with need no flag at all, which is why the main-pass counter keeps
working and lends the report its false air of health. `WebGPUDurationMeasure
.stop` then returns a literal 0, `endFrame` accepts it because `duration >= 0`,
and the counter records a real measurement of ZERO on every frame — **747 of
them over one measured session, against 626 genuine samples with the flag** —
all of which the `> 0` filter removes.

**This cost a capture and would have cost the next one.** A `?gpu` run taken to
settle `FINDINGS.md` #1 came back empty with every other field looking right.
So: `frameMeasurable: false` with `samples: 0` means the reading was
impossible, and only `frameMeasurable: true` with `samples: 0` would mean
something is wrong with the wiring. `launchClient` (`scripts/browser.mjs`, which
`plans/webgpu-ref/harness.mjs` re-exports) passes the flag already, which is why every headless number below was
taken with it — **a reading from the harness does not prove a stock browser can
take one**.

**Read `gpu.frame`, not `gpu.mainPass`.** Babylon's
`gpuTimeInFrameForMainPass` is the pass that targets the default framebuffer —
and in this pipeline the world renders into post-process targets, so the only
thing drawn there is the final full-screen quad. It measured **27 microseconds**
on Hollowmere, which is right for one quad and would be a catastrophic
misreading of "the GPU is idle". `gpu.frame` brackets the whole command
encoder.

The two are attributed differently and the report says so:

| | attribution | coverage |
| --- | --- | --- |
| `gpu.mainPass`, `series.gpuMs` | **exact** — Babylon stamps the frame id and the row is derived from it | nearly every frame |
| `gpu.frame`, `series.gpuFrameMs` | **exact**, by watching the measure's own state machine | **about half** the frames — only one measurement is in flight at a time |

`gpu.frame.samples` is the denominator and the mean is over those rows, never
over the window: a row with no reading is a missing measurement, not a fast
frame, and a zero in either series means the same thing it means in `loafMs`.

**Three Babylon internals hold it up** — `_gpuTimeInFrameId`,
`_timestampQuery` and `_measureDurationState` — because neither counter is
attributable from the public surface, and filing a GPU reading against the frame
that happened to read it would be this file's pairing bug for the third time.
Every read is guarded and the failure is `available: false` rather than a
throw. **After upgrading Babylon, take a `?gpu` capture and check
`gpu.frame.samples` is not zero** — with `--enable-unsafe-webgpu`, or the
check tests the flag rather than the internals.

Measured cost: **130.0 fps with the flag against 129.9 without**, and on
Cinderhaven at 1718x858 the GPU reads 1.372 ms mean and 2.729 p95 against a
6.746 ms tick — which is `docs/rendering.md`'s "Why the frame is draw-call
bound" from the other side, a frame bound by
submission and not by the GPU.

**On the real display, at 3440x1440 on Cinderhaven, it reads 1.977–2.325 ms
mean, 2.4–2.8 p95 and a MAX of 3.7 ms** across four captures, against a 7 ms
vsync budget and a tick of 4.5–6.4 — and on the hitch frames themselves it is
1.6–2.7 ms, including a **160.7 ms frame on which the GPU did 1.7 ms of work**.
That is what retired the last suspect in `FINDINGS.md` #1.

**Nor is it fill, and that was settled before the counter existed**:
`setHardwareScalingLevel` across an **8x** reduction in pixels (4,915 -> 613
kpixels, Sarab at 3432x1432) moved the frame rate not at all: 97.0 / 96.0 /
95.0 / 97.2 fps, with the wall-to-tick gap ~0 at every step. The frame is
CPU-bound even at that resolution. That sweep also reproduces the real session
closely (97 fps against 95.5, 10.29 ms against 10.48), so it is the workload to
measure on.

## Compiles: what was created, and on which frame

**WebGPU compiles lazily and Dawn compiles behind the call, so a pipeline is
an EVENT here and never a span.** Summed over a whole round,
`createRenderPipeline` costs under a millisecond; the stall lands on the first
draw that USES what was created — the same frame or one or two after it, and
often outside the tick altogether, in the GPU process. So the question the
profiler asks is not how long a creation took but whether a slow frame sat on
one, which is `FINDINGS.md` 1's first-use hypothesis in a form a capture can
settle. Report version 11 carries it three ways:

- **`pipelines`** — render pipelines, compute pipelines and shader modules
  created in the window; `callMs`, the time inside the create calls, which is
  there to show it is NOT the explanation; `hitchesNear`, how many of the
  window's slow frames had a creation on them or in the
  `CONFIG.profiling.creationLead` (2) frames before; and `recent`, the
  creations themselves, newest first, each with the frame it landed on and its
  wall clock.
- **`createdOn` / `createdNear` on every hitch.** `createdNear` is the one to
  read. Zero means the hitch was not a first-use compile; above zero makes it a
  candidate, never a verdict, because a compile shows up either as `drawWorld`
  inside the tick or as a wait outside it, and the viewer appends it to
  whichever reading the frame already got.
- **`series.pipelines` and `series.modules`**, per frame, so the whole window
  can be read at once: a spike zero to two rows after a creation. The viewer
  draws them as a rail along the bottom of the frame timeline, apart from the
  collections' rail along the top, and the trace export puts a `compile`
  instant on each frame that had one.

**What a creation is NAMED by is the part a warm-up needs.** A render pipeline
built through Babylon's cache carries the effect it is for — the shader's name
and its define set, which together are the VARIANT — and Babylon's own label,
which gives the target's colour and depth formats, sample count and texture
state (as close as the device gets to saying which pass it was for). That list
is what a warm-up pass would have to compile in advance. Shader modules and
compute pipelines are counted but not named; the pipeline that uses a module
carries the name.

**How it hooks in, and the one internal it leans on.** The device's create
methods are wrapped on `GPUDevice.prototype` — a standard surface no Babylon
upgrade can move, which the engine's device picks up through its prototype —
and put back exactly as found on `disarm`, so a disarmed profiler is not on
the device at all and a script that wrapped them first
(`plans/webgpu-ref/pipelines.mjs` does) is wrapped in turn and restored. The NAMING wraps
`WebGPUCacheRenderPipeline._buildRenderPipelineDescriptor`, a Babylon
internal and the only place that holds the effect: **after a Babylon upgrade,
check that a capture reads `pipelines.named: true`**, because if that method
moves the counts stay right and only the names go. The profiler also warns
once on the console when it arms without it, so the loss does not wait on
somebody reading that flag. Nothing in the recording path builds a string —
the log holds references Babylon already owns, in
arrays sized on arming (`CONFIG.profiling.creationsKept`) — so the
no-allocation rule holds; a compact capture carries
`creationsReported` of them with long define sets truncated, the download all
of them whole.

**The first reading** (Coldharbour, headless on the Windows box, 2026-10-04,
`?profile`, spawn and stand, three runs): the spawn frame ran 240-308 ms with
24 creations on it and 27 within two frames, while `drawWorld` was ~37 ms of
it, and nothing more was created in the next eight seconds. Measured against
an independent counter installed under the hook, the capture's count matched
exactly (120 of 120 in the window). That list is what the building card's
pipeline warm-up now compiles before the round (`core/PipelineWarmup.ts`);
`FINDINGS.md` 16 has what it reaches and what it does not.

**Steady state, creations are few, and counting them is not the same as
eliminating them.** Hooking `createRenderPipeline` and `createShaderModule`
before this was built: 29 pipelines and 73 modules during warmup, then **6
pipelines and 2 modules across 40 s of play** — which is what sizes
`CONFIG.profiling.creationsKept`. Six pipelines across 40 s of play is still six
opportunities for a first-use stall, and counting creations cannot see one;
`createdNear` can.

## Vsync, the uncap flags, and VRR

Measured from three captures launched with `--disable-gpu-vsync
--disable-frame-rate-limit` (Chrome 152, the Windows box at 3440x1440, G-Sync
on and the window fullscreen, two on Sarab and one on Cinderhaven, 3,000 frames
each) against the vsync-on reading `FINDINGS.md` 39 took. **Uncapping the
display makes it worse, and those flags must not ship.**

### The flags do exactly what they say, and it buys nothing

| | vsync on (finding 39) | vsync off |
| --- | --- | --- |
| residue (rAF wait + compositor) | 1.42 ms | **0.56 / 0.90 / 0.66 ms** |
| tick share of the wall clock | ~78% | **86.6 / 92.1 / 90.3%** |
| mean frame | 6.94 ms budget | 6.92 / 7.40 / 6.94 ms |
| fps | ~144, 1.9% doubled | 144.6 / 135.2 / 144.1 |

The wait is genuinely gone. The frame rate does not move, because the tick is
5.99–6.81 ms and **the tick was already the binding constraint** — finding 39's
whole point. Uncapping removed a ceiling nothing was touching.

### What it costs: vsync was quantising the workload's own variance away

| | vsync on | vsync off |
| --- | --- | --- |
| frames within 18% of one 6.94 ms interval | **88.5%** | 53.7 / 62.4 / 65.8% |
| sd of the interval | ~0 by construction | 3.14 / 2.38 / 3.48 ms |
| frame-to-frame \|Δdt\|, mean | ~0 | 0.88 / 0.67 / 0.98 ms |
| frame-to-frame \|Δdt\|, p95 | ~0 | **4.30 / 1.90 / 4.80 ms** |
| frames faster than a 144 Hz interval | 0% | 28.9 / 15.3 / 22.1% |

`drawWorld`'s own sd is 1.29–2.74 ms, so the tick genuinely swings by ±2–3 ms
with what is on screen. **With vsync on, every tick under 6.94 ms presents at
6.94** and none of that reaches the eye. Without it, all of it does. The trade
is 1.9% of frames held an extra interval against **100% of frames arriving
unevenly** — and it is worse, reported as such from the chair before any of this
was computed.

There is a second-order version. `dt` is `getDeltaTime()`, the interval BEFORE
the frame, but the frame is displayed for the interval AFTER it — so each frame
advances the world by ~0.9 ms (p95: 4.8) more or less than the time it is shown
for. Vsync was hiding that too. **A frame pacer owes a dt that is smoothed or
predicted**, not the raw lagging one, and the pacer (`src/core/FrameCap.ts`,
the `fpsCap` setting) now hands the world one: `Game.tick` steps by
`FrameCap.elapsed`, the gap between the REFRESH timestamps that took this frame
and the last, which is a whole number of refreshes rather than whenever the
callback got the thread. **The profiler still reads the raw `getDeltaTime()`**
— it measures when the work ran, and the world moves by when it is seen.
Measured on the Windows box under a 30 cap, Hollowmere, 180 frames headed: the
raw delta ran 31.7–35.0 ms (sd 0.70, p95 error against 33.3 of 1.23 ms) and the
refresh step 32.8–33.8 (sd 0.25, p95 error 0.37); headless, the p95 error went
1.63 → 0.37. What is left is the browser's own timestamp jitter. A phone,
whose callback lands later and less evenly, is where the raw figure is worse
and the change is worth the most — not yet measured there.

The tell that VARIANCE is the villain rather than cost: the slowest capture
(135.2 fps, tick 6.81 ms) has by far the lowest jitter (p95 1.90 ms), because it
is consistently over budget rather than swinging.

### VRR is answered, and the answer is no

This is the run that would have shown it: G-Sync on, fullscreen, vsync off, which
is the configuration native games use to engage VRR. It still stuttered, and the
reason is in the numbers above — **a 30–90 ms frame is far below any VRR floor**
(a 144 Hz panel's range bottoms out around 48 Hz, 20.8 ms), so the display falls
back to frame doubling exactly where it is needed most. VRR handles a frame that
arrives late by a millisecond, not one that arrives late by 80.

**So do not ship these flags, and do not wrap the game in Electron or NW.js to
get them.** A wrapper is Chromium either way; what it would buy is the command
line, and the command line is what was just measured. The fix for judder remains
finding 39's: make the frame fit the interval.

## What is deliberately not in it

Both of these are real levers and both have a blast radius bigger than the
instrument, so neither was folded into it.

**A precise heap without a flag.** `performance.measureUserAgentSpecificMemory()`
is the standard, unrate-limited answer and it requires cross-origin isolation,
which is the next item. The sentinel above is what works without it, and it
gives collections rather than bytes.

**A 5 us clock.** Cross-origin isolation (COOP + COEP) drops
`performance.now()`'s grain from 100 us to 5, which would make every row of the
phase table real rather than seventeen of them means-only.
`docker/default.conf.template` sets neither header, and adding them makes every
cross-origin subresource need CORP — including whatever the lobby's match-server
fetches touch. That is a deployment change, not a profiler change.

**Per-callsite timing.** Not a lever, a category error: see the grain note
above. Wrap the call site from a Playwright script, the way `ENGINE_UPGRADE.md` S2 did.

---

## Smoke-testing it

The protocol that produced every number here, and the one to reuse
(`VERIFYING.md` for the launch rules — `channel: "chromium"` on the Windows box
or nothing works):

1. Two pages, one on `?profile` and one without, same map, same length.
2. Into `playing` with long Enter presses, then `player.takeDamage = () => {}`
   so a long capture is not interrupted by dying.
3. Count real `requestAnimationFrame` callbacks over the window rather than
   trusting `Engine.getFps` — the cost being measured is a fraction of a
   percent, and a 30-frame rolling mean cannot see it.
4. Read the capture out with `window.__profile.capture("smoke", false)`.
5. Check the disarmed page returns `null` and has no `#prof` up. **A profiler
   that is quietly always-on is the failure mode this whole design is arranged
   against.**

Two more, both learned the hard way here:

- **Pass `--enable-precise-memory-info` if you want the heap columns.** Without
  it `memory.heapLive` comes back false and every heap figure is 0 — correctly,
  and that is the stock-browser answer, but it is not what you want from a run
  you are using to chase an allocation. The GC count needs no flag either way.
- **To exercise the relative hitch bar, change the device's speed UNDER a
  profiler that is already armed** — `Emulation.setCPUThrottlingRate` over a CDP
  session. Throttling first and arming afterwards seeds the baseline at the slow
  rate and tests nothing: the interesting behaviour is the floor climbing to
  follow a step change, and how many frames get filed while it does.
