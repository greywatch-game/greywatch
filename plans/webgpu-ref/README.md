# The M2 reference set — GLSL under WebGPU

**This is what every WGSL landing diffs against**, and it is the most valuable
artefact of the migration. It is deliberately NOT a set of WebGL2 shots: the
engine swap landed first with all nine shaders still in GLSL, so a frame taken
here has the engine difference already absorbed in it. A diff against these
therefore means a **shader** difference, which is the only thing M3–M6 can
break.

Taken with `src/shaders/glslScaffold.ts` in place — the engine was
`WebGPUEngine`, every shader was still GLSL, and the backend ran them through
glslang → SPIR-V → twgsl → WGSL. **The bank does not move as shaders are
ported**, which is the whole technique: it is the picture the GLSL sources drew
on this engine, and every WGSL landing was asked to reproduce it exactly. All
nine have, so **the set is now a REGRESSION bank rather than a port bank** —
that file is deleted and there is no longer a way to re-take these frames from
the GLSL. Do not re-take them for a rendering change either: a frame re-taken
from the shader under test is a test of nothing. Re-take only when the ENGINE or
the VANTAGES move, and say so in the commit.

## The scripts

They live beside this file and share `harness.mjs`, which owns the facts about
driving WebGPU that each of them would otherwise get wrong alone. The
browser and the dev server are NOT re-implemented here: `scripts/browser.mjs`
and `scripts/dev-server.mjs` own those and these import them, so there is one
copy of the launch flags in the repository rather than four.

Nothing needs `npm run dev` running first — each script starts and stops its
own dev server.

```
node plans/webgpu-ref/gate.mjs [map...] [--headed] [--uncap]
node plans/webgpu-ref/bank.mjs [map...] [--headed] [--check]
node plans/webgpu-ref/shaders.mjs [map...] [--headed] [--list]
node plans/webgpu-ref/depth.mjs glass|zoffset [--headed]
node plans/webgpu-ref/diff.mjs a.png b.png [--tiles]
node plans/webgpu-ref/pipelines.mjs [map] [--seconds N]
node plans/webgpu-ref/bench.mjs [map...] [--runs 3] [--capped] [--gpu] [--size WxH] [--out f.json] [--against f.json]
```

- **`gate.mjs`** boots every shipped map, plays a real round on each and fails
  loudly if any is not clean — the engine is WebGPU, the round reaches
  `playing`, no probe re-renders per frame, and there are no page or console
  errors. It exits non-zero, so it can stand in front of a merge.
- **`bank.mjs`** takes the reference frames into `ref/<map>-<vantage>.png`, and
  refuses to write one that is not reproducible. `--check` re-takes and grades
  against what is banked instead of replacing it.
- **`shaders.mjs`** compiles every shader on every map and fails on anything
  the driver called an error. It asks the FACTORY rather than the frame — walk
  the cel cache, hand each material a probe mesh, poll `isReady` — so it reaches
  the variants a still camera cannot see, and it asserts that the six cel
  define-shapes were all compiled somewhere across the four maps. It also mints
  the one shape no shipped map does: a ground albedo with no height map beside
  it, which both call sites happen to pass, and which would otherwise rot
  uncompiled. Exits non-zero, so it stands in front of a merge beside
  `gate.mjs`. It is also the strongest place the transpiler tripwire is asked,
  because it forces the CACHED materials to compile rather than the drawn ones.
- **`vantages.mjs`** is the table of poses `bank.mjs` shoots, one row per frame
  with what that frame is FOR written beside it. It is data and has no CLI.
  **The table itself is `src/bench/vantages.ts` now** and this file re-exports
  it through Node's type stripping, because the benchmark (`?bench=<map>`)
  stands at the same poses and two copies would drift the first time a row
  was re-posed. Edit a row there.
- **`bench.mjs`** is the benchmark's desktop wrapper (`BABYLON_EXIT.md` X0.3).
  The benchmark itself is the PAGE's — `?bench=<map>` plays the bank's
  vantages at eight headings, a path through the densest quarter and a seeded
  bot-only round at a fixed step, and ends in a labelled capture — and this
  only opens the URL N times per map and reads the captures: medians per
  group, the spread of each group and each segment against the protocol's 8%,
  the fight's hash (every run must print one), and `--against` ratios.
  Uncapped unless `--capped`. `docs/profiling.md`, "The benchmark", is the
  contract.
- **`diff.mjs`** says how much and where two PNGs differ. `bank.mjs --check`
  grades itself with the same function; the CLI is for looking at a specific
  pair by hand, and `--tiles` names the region rather than the number.
- **`depth.mjs`** re-derives the two numbers the DEPTH FORMAT decides, and it is
  the one script here that is not about the picture being the same — it is about
  a number staying right. `stencil: false` picks `depth32float` over
  `depth24plus-stencil8`, and WebGPU defines `depthBias` in a different unit for
  a float format, so `CelMaterialFactory.GLASS_DEPTH_UNITS` and
  `OutlineRenderer`'s own offsets are both stated in a unit that moves when that
  flag moves. `glass` sweeps the bias against range on a tinted curtain wall;
  `zoffset` is a ruler that says what the outline pass's offsets are worth in
  metres. **Nothing else re-derives these, the bank least of all** — a pane that
  has quietly stopped being drawn at 180 m is in no banked frame.
- **`pipelines.mjs`** counts shader modules and render pipelines against the
  frame clock. This is the replacement for the WebGL2 `shaderSource` hook —
  `GPUDevice.prototype.createShaderModule` in an `addInitScript`, whose
  `getCompilationInfo()` reports against source you are already holding.

`cold-stagger.mjs` is **gone and is not coming back**. It existed to bake
Coldharbour's forty cube probes four a frame because doing all forty at once
killed a CPU rasteriser's device; on real hardware the shipped one-frame bake
completes in one frame and the workaround only ever proved the probe path
rather than the thing that ships.

## Two vantage tables, because they answer different questions

**A map is banked as SEVERAL frames.** The menu backdrop's pose is read at
runtime out of `src/ui/mapShots.ts` — the table the MENU stands on — so a
reference frame and a menu backdrop cannot come to hold two ideas of where the
camera stands, and a re-frame there is an edit in one place. A map with no row
there is skipped and that is not an error.

**That pose alone is not a reference set, and mistaking it for one is the
failure this set exists to prevent.** A backdrop is chosen to look like the
map. What the remaining milestones can break is a SHADER PATH, and between them
the four backdrops hold no backed pane at 2 m, no lamp-lit crossroads, no gust
crossing a canopy, no wall far enough off to band and barely any water at all —
so a clean four-frame diff would have said nothing about the variant that
moved. The rest of the poses are therefore stated in `vantages.mjs`, each with
a `proves` line naming what it is in the set FOR: a row nobody can write that
line for should not be banked, and a diff that comes back dirty is read by
looking at which rows moved.

**Adding those poses found three bugs in the freeze, which is the argument for
coverage stated as a measurement.** The water clock was pinned onto
`body.material` where the field is `body.mat` — an optional chain onto
`undefined`, pinning nothing; the lantern flicker was never pinnable at all;
and the cube probes were baked before any of it. Every one of the three is
invisible in the four backdrops and obvious in a frame chosen to hold water, a
lamp or a reflection. See the floor, below.

## What makes a diff mean anything

- **The frame is FROZEN, and the freeze PINS clocks rather than stopping
  them.** `Game.tick` runs `post.update`, `sky.update`, the light shafts' own
  `update` (`Volumetrics`, and the field is null when the player has them off) and
  `motionBlur.update` in EVERY state, the deploy lid included, and there are
  three more accumulators behind them: **there is one wind and three clocks
  reading it** — the cel factory's `windTime`, the grass field's `time` and the
  water body's. Halting a clock leaves it holding however much wall clock that
  run spent booting, which reads as perfect inside one process and differs in
  every pixel of sky across two. Each is therefore assigned a constant and then
  stopped. The trap is worth stating plainly because it looks solved when it is
  not: with the clocks merely halted, two consecutive grabs were byte-identical
  on all four maps and a bank taken minutes earlier still failed on three.
- **The floor is ZERO in both directions, and getting it there was the work.**
  Two consecutive grabs inside one process are byte-identical on all four maps
  in both browser modes, and `bank.mjs` writes nothing unless they are — that
  much was true from the start. Across PROCESSES the same frame did not come
  back, and the residue was read as noise and written into a 0.35 tolerance:
  0.00 on the maps with no lamps, 0.12–0.25 on Hollowmere, later up to 1.0/255
  on a lamp-lit street and 0.72 on a marsh. **It was not noise. It was two
  things that are not clocks**, and each is in `freeze` with its own note: a
  lantern's flicker PHASE is `Math.random() * 100` per fixture at map build, so
  no amount of pinning time makes two boots agree; and a cube probe is
  refresh-ONCE and was baked in the frame after install, before any of this was
  held, so the water and the glazing went on reflecting a world that had never
  been frozen. **The phase was fixed in the GAME rather than papered over
  here** — `LightingSystem` seeds it now, the same rule the world layer already
  keeps for scatter — which leaves `freeze` re-baking the probes and pinning
  clocks, and means a bank taken over the game's own phases fails loudly if
  anyone unseeds them again. With both, all sixteen frames come back
  **byte-identical across processes**. `CHECK_TOLERANCE` is now 0.02 and is slack for a driver rather
  than a measured floor. **Re-derive the floor in any run that is going to
  produce a number** — a method that cannot reach its own floor is not
  measuring what you think, and this one could not twice.
- **The floor was lost once more, and it took the bank's whole job with it.**
  From 2026-09-26 `bank.mjs` refused every frame on every map (the finding
  `BABYLON_EXIT.md` X0.1 closed), and the cause was the IRRADIANCE VOLUME: it
  re-traces a rolling slice of itself every frame, its multi-bounce term
  converges by a factor of the albedo per SWEEP (~72 frames), and a frame shot
  36 frames after a teleport was half way through one — 7% of Greyfen's pixels, up to 78/255, between two
  consecutive grabs. `freeze` now re-sweeps it at its warm budget from a
  cursor of zero, `GI_SWEEPS` (8) times, after everything it traces is
  pinned, and holds it; one sweep instead of eight still leaves 6% of
  Greyfen's pixels up to 74/255 off across processes. Beside it two more
  things that move by themselves were found unpinned: the cloud ring's TURN,
  which replaced the two scrolling textures the freeze was still zeroing
  (`sky.turn` is pinned to 0 and the clouds' shadow re-primed at it), and
  Cinderhaven's storm, whose clock runs in `deploy` (held with no strike in
  the air). **When the bank goes red on an unchanged tree again, look for the
  newest thing that changes by itself in a held world** — that has now been
  the answer four times.
- **The post chain is left ON, with only its clock pinned.** The plan called
  for `g.post.setEnabled(false)`, and that would reach the same floor — the
  grade's grain is re-hashed every frame at ~14 LSB and is the largest term in
  the noise. But the three post fragments are M3's own work and a set taken
  with the chain disabled could not diff them. Pinning `post.time` kills the
  grain and keeps the vignette, the aberration, the god rays and the motion
  blur in the picture.
- **A map is drawn when `scene.isReady()` says so, never after N frames.**
  WebGPU compiles pipelines lazily and presents nothing until they exist. The
  frame that first happens on is not a constant — measured across runs it moved
  between 67 and 137 on Hollowmere, 3 and 35 on Greyfen, 7 and 15 on
  Coldharbour, 69 and 169 on Harrowmead — and `scene.isReady()` flipped on
  exactly the frame each map first drew, every time. A settle count in its
  place is a duration wearing a frame count's clothes: six frames was right on
  a 2 fps box because it was three seconds there, and it photographs a blank
  canvas here. This had already cost two committed backdrops before it was
  found (see `scripts/capture-map-shots.mjs`).

## One process per MAP, and the pause lid never comes off

`VERIFYING.md`'s one-vantage-per-process rule is about cycling back through
`playing` between vantages, which lets a frame of gameplay run and moves the
player. Holding the lid up and placing the camera by hand moves nothing at all,
so a map's whole table is shot in one boot — which is what makes a re-shoot
cheap enough to actually do.

**What that costs is one rule inside the loop: THAW before placing the next
camera.** The god rays and the motion blur are not pinned to a constant, they
are pinned by a camera that has been standing still, so a teleport into a
still-frozen chain photographs the previous vantage's convergence smeared
across this one. `harness.mjs` stashes the real updaters on the first freeze
and `thaw` puts them back; each vantage then converges on its own before it is
frozen again. **Readiness is asked per vantage too, and for the same reason it
is asked at all** — WebGPU compiles lazily, so a pose that brings a material
nobody has drawn yet into frame is not ready on the frame the camera moved.

## A bank belongs to the machine and the MODE it was taken in

Headed and headless frames are **not** byte-identical, on three of the four
maps. Both are correct; what may not happen is banking in one mode and checking
in the other, which reports four regressions that are a browser mode. The mode
is recorded in `ref/mode.json` and `bank.mjs --check` refuses a mismatch rather
than reporting nonsense. **Beside the mode it records what the bank was taken
ON** — the Chromium build, the Playwright that drove it, the WebGPU adapter,
the GPU driver (`nvidia-smi`, null where there is none) and the settings every
row was shot at, which are device-derived — and a check prints any of those
that has moved since, so a red bank after an update says which update in one
read. A full take writes it; a take over named maps leaves it alone. The same caution applies across machines: this bank was
taken headless on the Windows box (`nvidia/lovelace`), and a diff taken against
it on different silicon is measuring the silicon.

**Which is why `ref/` is NOT committed** — it is in `.gitignore` beside
`gate.json`. It is ~130 MB of PNG (47 frames since X0.1) that is only
meaningful on one machine in one browser mode, and it has a generator: `node
plans/webgpu-ref/bank.mjs` rebuilds the whole set in about five minutes. That is the same bar the four generated
assets in `docs/build.md` are held to, and a bank fails the other half of it —
those are the SAME on every machine and this is not. What is committed is the
harness and `vantages.mjs`, which is the part that would be expensive to lose:
the poses were chosen by taking them and looking at them, and the numbers are
the record of that.

**Re-take the bank only when the ENGINE or the VANTAGES move, and say so in
the commit.** A frame taken here has the engine difference already absorbed
into it, which is the entire technique; re-taking after a shader change
silently replaces the thing that would have caught the shader change.

## What a row can stand in front of the camera

**Since `BABYLON_EXIT.md` X0.1 the bank is the look oracle for a renderer
being replaced piece by piece**, and a table of map views holds none of the
pieces after the static world. So a row may ask for a SUBJECT — soldiers, a
blast in the air, the viewmodel, the capture rings and flags, a setting
changed, the motion blur in flight — each posed by the game's own code from a
fixed state through fixed steps (`src/bench/vantages.ts`'s header lists them, and
`placeVantage` puts every one away before the next row). What the table holds
for each step of the exit:

| exit step | rows |
| --- | --- |
| X3 the static world | every map's menu and map views |
| X4.1 bodies | `sarab-rig-near`, `sarab-rig-far` (250 m, inside `bodyDrawDistance`) |
| X4.2 vehicles | `sarab-tank`, `sarab-truck`, `sarab-heli` |
| X4.3 the viewmodel | `harrowmead-view-<optic>-hip` / `-aim`, one weapon per optic |
| X4.4 effect pools | `coldharbour-blast` |
| X4.5 sky and clouds | every row; `hollowmere-lanterns` and `cinderhaven-town` at night |
| X4.6 water, glazing, rings | `greyfen-marsh`, `harrowmead-millpond`, `coldharbour-shopfront` (see-through), `coldharbour-curtain2/40/90` (backed), `hollowmere-ring` |
| X5.2 the post chain | `hollowmere-post-*`, each one setting off against `lanterns` |

**`placeVantage` also places the camera-dependent passes at each row's eye**
— the two cascades, the bodies' map, the lamps' atlas, the water and the grass
— by `Game.updateSceneForCamera` at dt 0, the path the editor and the warm-up
use. Before X0.1 they stayed wherever the install left them, so a frame far
from the spawn photographed no shadow window at all.

## What is NOT in it

- **Nothing here is a body in MOTION or a world being culled as it is
  walked.** A posed rig and a held camera cover what is drawn, not what a
  candidate-list change does while bodies move — `VERIFYING.md` has the live
  round's screenshot pair with a control for that.
- **Nothing here holds a GPU particle.** The freeze turns particles off,
  because they run on their own clock; X4.7 has to bring its own check.
- **Nothing here is a frame TIME.** `gate.mjs` reports those and they are real
  on this machine, but they are not what a reference IMAGE is for. Quote the
  gate's `warmFps`, never a number read off a bank run.
- **Nothing here proves the shipped bake on a machine that cannot finish it.**
  Coldharbour's forty probes (the pre-re-lay map; it was re-laid as a bay in
  6e848a1) are one frame here — see `FINDINGS.md` #10 for
  what that frame actually costs, which is not what this plan first recorded.
  On the Chromebook
  that frame takes the device, and no reference set taken there covers it.
- **The `GLASS_DEPTH_UNITS` SWEEP is not in it, and the three curtain-wall
  frames are not a substitute for it.** It is `depth.mjs glass` now. The sweep
  is a measurement: it hides the rest of the map, holds the incidence angle and the
  on-screen size still by moving `fov` with the distance, and reads the pane's
  own contribution by toggling the group and differencing — see
  `VERIFYING.md`. What is banked instead is the same wall photographed at 2, 40
  and 90 m as the game actually draws it, which catches a sheet that stops
  being drawn and will not resolve a depth bias that is merely a little wrong.
  Past ~100 m there is also nothing to photograph down that axis: 220 m of
  clear line does not exist on a 320 m map with buildings on it, which is why
  the sweep hides them.
