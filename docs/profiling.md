# Measuring a frame

The contract for [`src/core/FrameProfile.ts`](../src/core/FrameProfile.ts),
[`src/ui/ProfileChip.ts`](../src/ui/ProfileChip.ts) and
[`src/config/profiling.ts`](../src/config/profiling.ts), and for the ~22 pairs
of brackets in `Game.ts` that feed them. [`CLAUDE.md`](../CLAUDE.md) carries the
summary; this is the argument.

It is not the only instrument in the tree and is deliberately not the biggest.
[`world/buildProfile.ts`](../src/world/buildProfile.ts) times the map BUILD and
is DEV-only; `HUD.setFps` puts a rate and a 1% low on screen;
[`FINDINGS.md`](../FINDINGS.md) is where a measurement goes once it means
something. This file is about the frame, in flight, on a device you do not own.

---

## Why it ships

**Every number in `FINDINGS.md` §17–§32 was taken on one of two dev machines by
hand-wrapping a function from a Playwright script.** That protocol is good and
should stay — it is how you price a single call site. What it cannot do is
answer any question about a phone, a tablet, a mid-range laptop or a production
build, and those are where this game is actually played. The frame is
**draw-call bound** (§17), which is a property of the machine as much as of the
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

Neither figure is a constant in a table: both probes run on arming, on the
device, and `clock.overheadUs` and `clock.grainMs` are in every capture.
**An instrument that does not state its own cost is one nobody can subtract** —
see `FINDINGS.md` §31 on the instrument that had been dead since the WebGPU port
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
that, `endFrame` files every frame over `CONFIG.profiling.hitchMs` (24 ms, one
missed 60 Hz deadline with room) into a hitch list, so a capture carries the
worst frames whole even if the thumb was slow.

**Nothing allocates while it is recording.** Every array is sized once by `arm`
and written by index; there is no per-frame object, no label string, no closure,
and `context()` takes four positional numbers rather than one struct for exactly
that reason. This is not tidiness. §1's leading suspect for the hitch is GC, and
a profiler that allocates per frame manufactures the bug it was built to find.
Captures and reports allocate freely — a capture is a deliberate act, not a
frame.

---

## Using it

**Arming.** The settings screen's Display page has a `Frame profiler` row, and
it is remembered — which matters, because reproducing something usually takes a
reload. `?profile` arms it before the first frame and is how a smoke script gets
it on, since the setting lives in `localStorage` and a fresh browser profile has
none.

**The chip** (`#prof`, top-left) is up whenever the ring is recording, in every
state, and is the only sign that it is. It shows how much the ring is holding
and how many hitches it has seen, and carries three buttons:

| | what it does | where it lands |
| --- | --- | --- |
| **KEEP** | compact report — summary, phase table, the worst frames whole | the clipboard (≈6 kB) |
| **SAVE** | the same plus the complete per-frame series | a download (≈70 kB for 1,000 frames) |
| **TRACE** | the last 600 frames as Chrome Trace Event JSON | a download, for `ui.perfetto.dev` |

**`F3` is KEEP**, and it exists because on a desktop mid-round **the pointer is
locked and none of those buttons can be clicked at all**. On a phone there is no
lock and the buttons are the whole interface — which is the case this was built
for. The flash line under the chip reports what actually happened, because under
a lock there is no other channel back to the player.

**The clipboard is tried three ways and that is not defensive coding.** The
async clipboard needs a secure context, and the way this game is really played
on a phone is a LAN address over plain http, where `navigator.clipboard` is not
merely going to reject — it is `undefined`. So: the modern API, then an
`execCommand` textarea, then a download. The last rung always works.

**`window.__profile`** is the instrument itself — `capture(reason, full)`,
`trace(maxFrames)`, `last()`, `armed`, `seconds`. It ships. A smoke script wants
this and not `__celshock`, because none of it is anything to do with the game.

---

## The phases

`PHASES` in `FrameProfile.ts` is the list, and **an index into it is a slot id**,
which is what keeps the recording loop free of strings. The brackets are in
`Game.ts` and nowhere else: `tick`, `updateGameplay`, `updateNetWorld` and
`updateWorld` are where the frame's order is already declared with the argument
for it written down, so **the phase list IS that order** and no system had to be
taught the profiler exists.

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
│  │  ├─ physics            Havok and its three clients
│  │  └─ glass              the flow-field drain a broken pane owes
│  ├─ camera                the eye, the lights, the chase cam
│  ├─ zones                 the capture rings
│  └─ hud                   what a gameplay frame pushes at the chrome
├─ hudDraw                  HUD.update — every state owes it
├─ post                     the post chain, the sky, the shafts
├─ culling                  the cull cells, the motes, the shader's eye
├─ audio                    pushHullEngines
└─ render                   scene.render()
```

**They nest and they do not partition.** What is left inside a span is the lines
nobody thought worth naming — read a report as an ATTRIBUTION, exactly as
`buildProfile`'s header says to read the build's.

**A span never closed is never recorded**, which is what makes this safe at the
sites sitting on an early return: `beginFrame` clears the open table, so a stamp
can never leak into the next frame. `updateGameplay` deliberately closes `world`
*before* its early return rather than around it — a frame that ends the round
still spent the time, and `world` reading as "not entered" on the most
interesting frame of a session would be the wrong kind of missing.

**Adding a phase** is a name in `PHASES` and a `begin`/`end` pair. Nothing else
moves.

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

**`render` is one enormous bar and always will be.** That is §17 — the frame is
draw-call bound and Babylon's WebGPU backend charges CPU per draw — which is why
`SceneInstrumentation`'s counters ride alongside: `drawCalls`, `activeMeshes`,
`meshWalkMs` (the scene walk §21 is about) and `renderTargetsMs` (the shadow map
and the reflection bake). Those four are what the big bar is made of, and a
change in them is the change worth chasing.

**`clock.belowGrain` names the rows whose TAILS are fiction.** Chrome quantises
`performance.now()` to 100 us absent cross-origin isolation, and seventeen of
the twenty-two phases here cost less than that. Their MEANS are real — a phase
boundary falls at a uniformly random offset within the grid, so the difference of
two quantised stamps is unbiased over a thousand frames — but a `p95` of exactly
`0.100` is one grain, not a measurement. **This instrument answers "which
phase", never "which function"**; a 3.5 us box query (§23) is micro-benchmark
territory and always will be.

**The hitch list is where the position pays.** Each kept frame carries its whole
phase breakdown plus where the player was standing, how many bots were up, and
the draw and mesh counts. Block visibility, the merge blocks and the terrain
patches are all keyed to PLACE, so *which street was I in when it hitched* is
most of the diagnosis — and it is not recoverable from a stack of milliseconds.
In the capture above the worst frame is 682 ms at `(0, 3, -8)` with **0 bots**,
which is the spawn: the round's first frames are the pipeline compiler (§16),
not the game.

---

## The trace

`TRACE` writes Chrome Trace Event JSON. Open it at **`ui.perfetto.dev`** — no
viewer was written here and none should be. The spans nest properly by
construction (`frame` ⊃ `gameplay` ⊃ `world` ⊃ `bots`, each start stored
relative to its own frame), so a flame chart falls out with no further work, and
`drawCalls`/`activeMeshes` ride along as counter tracks.

600 frames is the default because the whole ring is tens of thousands of events
and a hitch lives in the last few hundred frames; `window.__profile.trace(n)`
takes more.

---

## What is deliberately not in it

Both of these are real levers and both have a blast radius bigger than the
instrument, so neither was folded into it.

**GPU time.** Babylon reads it — `EngineInstrumentation.captureGPUFrameTime`
over `WebGPUTimestampQuery` — but only if `timestamp-query` is requested at
device creation, and `main.ts` calls `initAsync()` with no descriptor at all.
Adding one means an adapter-support check on every boot, and whether Android's
Chrome exposes the feature is a question for the handset rather than for this
file. On a draw-call-bound frame it is the single most valuable thing missing.

**A 5 us clock.** Cross-origin isolation (COOP + COEP) drops
`performance.now()`'s grain from 100 us to 5, which would make every row of the
phase table real rather than seventeen of them means-only.
`docker/default.conf.template` sets neither header, and adding them makes every
cross-origin subresource need CORP — including whatever the lobby's match-server
fetches touch. That is a deployment change, not a profiler change.

**Per-callsite timing.** Not a lever, a category error: see the grain note
above. Wrap the call site from a Playwright script, the way §22 and §23 did.

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
