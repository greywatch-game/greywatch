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
node plans/webgpu-ref/gate.mjs [map...] [--headed] [--uncap] [--query=<flags>]
node plans/webgpu-ref/bank.mjs [map...] [--headed] [--check] [--query=<flags>] [--keep=<dir>] [--rows=<id,...>] [--limit=<seconds>]
node plans/webgpu-ref/exact.mjs <before-dir> <after-dir> [--new=<id,...>] [--rows=<id,...>]
node plans/webgpu-ref/census.mjs [map...] [--query=<flags>] [--out f.json] [--against f.json] [--fall]
node plans/webgpu-ref/shaders.mjs [map...] [--headed] [--list]
node plans/webgpu-ref/depth.mjs glass|zoffset [--headed]
node plans/webgpu-ref/diff.mjs a.png b.png [--tiles]
node plans/webgpu-ref/pipelines.mjs [map] [--seconds N] [--round]
node plans/webgpu-ref/surfaces.mjs [map...] [--rows=<id,...>] [--pixels] [--editor] [--keep=<dir>] [--out=<f.json>]
node plans/webgpu-ref/bench.mjs [map...] [--runs 3] [--capped] [--gpu] [--max] [--size WxH] [--out f.json] [--against f.json]
node plans/webgpu-ref/particles.mjs [map...] [--frames=N] [--out=f.json] [--against=f.json] [--editor]
node plans/webgpu-ref/gi.mjs [map...] [--out=f.json] [--against=f.json] [--shafts-off] [--no-editor] [--no-states]
node plans/webgpu-ref/gi.mjs --compare=a.json --against=b.json
node plans/webgpu-ref/post.mjs [--sizes=desk,phone] [--out=f.json] [--against=f.json] [--no-live]
node plans/webgpu-ref/post.mjs --compare=a.json --against=b.json
```

- **`gate.mjs`** boots every shipped map, plays a real round on each and fails
  loudly if any is not clean — the engine is WebGPU, the round reaches
  `playing`, the reflection bake has drained by deploy and stays drained
  over every frame it watches (`ReflectionSystem.bakePending`; until X3.7c,
  no Babylon probe re-rendering per frame), and there are no page or console
  errors. It exits non-zero, so it can stand in front of a merge.
- **`bank.mjs`** takes the reference frames into `ref/<map>-<vantage>.png`, and
  refuses to write one that is not reproducible. `--check` re-takes and grades
  against what is banked instead of replacing it, and counts the page's
  console errors as problems on every check, since a draw of ours that fails
  says so there and draws nothing. **The bank is BABYLON's picture of the
  blocks, taken before `BABYLON_EXIT.md` X3.3c, and its old rows are STALE**:
  X3.4 moved the scatter on purpose (sixteen variants a kind, one colour bake
  a kind) and the GPU driver has moved since the bank was taken (596.21 to
  610.88), so a plain `--check` fails 34 of its 143 rows, whatever the tree under
  test does: 33 of the 47 banked before X3.5, Greyfen's `canopy` at a mean of
  44/255, and `greyfen-crossing` (0.0581), one of the fourteen `ground` and
  `crossing` rows banked at 54ec8c0. Every row banked since grades within the
  floor against the bank. **Until the bank is re-taken
  (the user's call), a step is graded against a BEFORE**: `--check
  --keep=<dir>` at the parent commit and again at the step, the two
  directories compared frame by frame with `diff.mjs`'s `comparePngs` at
  `CHECK_TOLERANCE` (X3.5 did; its record has the numbers). Re-taking the
  bank gives Babylon's picture of the blocks up for good. `--query=<flags>`
  boots the game with that URL query and grades it against the bank taken
  WITHOUT it — how a DEV switch that must draw the same picture is proven
  (X3.3a's `?ourworld`, gone since X3.3c) — and refuses to take a bank.
  **The bank is no longer the switch-off picture**: the shipping build draws
  our renderer's, and the bank is Babylon's from before X3.3c, so a future
  `--query` check is graded against Babylon's and absorbs the same tie
  residue, and the stale rows' drift with it, until the bank is re-taken.
  **A row's frame depends on the rows shot before it** (state carries between
  them): a frame shot at one vantage alone differs from its banked row by
  tens of thousands of pixels with nothing changed, so a scratch diff against
  the bank owes the bank's own sequence up to that row. **`--rows=<id,...>`
  is how a NEW row is banked without re-taking the old ones**: it shoots each
  map's sequence in order up to its last named row and writes (under
  `--check`, grades) only the named rows, leaving every other PNG and
  `ref/mode.json` alone — so a row appended for a later step is Babylon's
  picture taken beside a bank it does not disturb. Append new rows at the END
  of a map's list, or every row after them carries a different state. **The
  `fx` rows (X4.4a) are no exception**: the put-away after one puts its
  pools back and re-seeds the streams a row draws from (the rubble's, the
  shards', the fire lights' flicker), but Havok's world keeps every body
  the pools made, the lamps' shadow atlas keeps its allocation and caches,
  and the flights' ids run on — so an `fx` row is its banked frame only shot
  in its map's sequence, which is how `bank.mjs` shoots it.
- **`census.mjs`** counts the MAIN pass's draws at every bank vantage —
  Babylon's into the frame's own target plus our renderer's — on the same
  frozen frame the bank grades, each row split into Babylon's and ours. With
  `--query` it counts the build both ways and fails unless the totals are
  EQUAL (X3.3a: one draw for one), or with `--fall` unless the switch's is
  LOWER (X3.3b). For a step that leaves no switch behind (X3.3c), `--out
  f.json` writes the shipping build's rows and `--against f.json` compares
  them with rows an earlier `--out` wrote — the BEFORE, taken by running this
  file in a worktree of the commit before the step — failing unless every
  map's total is equal, or with `--fall` lower.
- **`shaders.mjs`** compiles every shader on every map and fails on anything
  the driver called an error. It asks the FACTORY rather than the frame — walk
  the cel cache, hand each material a probe mesh, poll `isReady` — so it reaches
  the variants a still camera cannot see, and it asserts that the seven cel
  define-shapes were all compiled somewhere across the maps. It also mints
  the one shape no shipped map does: a ground albedo with no height map beside
  it, which both call sites happen to pass, and which would otherwise rot
  uncompiled. And it builds OUR renderer's modules — both stages — for every
  shape a map compiled (`src/render/celVertex.ts` and `celFragment.ts`,
  `BABYLON_EXIT.md` X3.1 and X3.3a) into a real pipeline through our own
  `PipelineCache`, on a device of its own, so the shared bodies' second
  reader is compiled for every shape, drawn or not — and the per-stage
  texture and sampler limits are counted against what is bound. Beside them
  it builds the compute cull those draws read (`src/render/wgsl/
  clusterCull.ts`, X3.3b), each of its three entry points into a pipeline,
  and (since X3.7a) the emissive PALETTE's two programs — the main pass's
  and a probe face's, and the glow mask's twin — at every depth bias a
  palette material on the page carries, and fails if a palette group our
  renderer cut carries a bias it found no material for (so a page with a
  palette cannot pass having built neither program, as X3.7c's first run
  did). Since X4.6e's review it also builds the glazing's PLACED stage
  (`celPlacedVertex`) in the four states `GlassDraw` asks, and the four fade
  programs in `FadeDraw`'s (`FADE_STATES`): eight more a map.
  Exits non-zero, so it stands in front of a merge beside
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
  Uncapped unless `--capped`. `--max` puts every graphics setting at its top
  rung first and fails a run whose capture says otherwise; without it a run
  gets a fresh context's per-device defaults. `docs/profiling.md`, "The
  benchmark", is the contract.
- **`exact.mjs`** is the proof a step that must move nothing owes: two
  `--check --keep=<dir>` directories, at the parent and at the step, compared
  byte for byte. Each row prints `byte-equal`, or the pixels moved and the worst
  value, and it exits 1 on any row that differs, or stands on one side only, outside
  `KNOWN_FLAKES` (`harrowmead-view-pistol-reload` up to 2 pixels by 1/255, `sarab-shelf`
  1 pixel by 1/255). A row the step added is named in `--new`. **`--check`'s pass line
  cannot do this**: `coldharbour-ring-behind-field` with the ring ahead of the blades moves 54
  pixels by up to 113/255, a mean of 0.0002 against 0.02. It wants no GPU.
  **`EXPECTED_MOVES` is not flakes**: a row whose move is a recorded picture difference
  the owner accepted for a stated time, bounded so the tool fails if it moves MORE, and
  removed by the step its `until` names. It is empty since X4.6d, whose run ended the one
  entry it has held (`sarab-shore-flip`, `BABYLON_EXIT.md` "Decisions"). `--rows` compares
  only the named rows, which is how a kept frame is held against `ref/` alone, whose other
  rows are stale: `exact.mjs plans/webgpu-ref/ref <keep> --rows=sarab-shore-flip`.
- **`diff.mjs`** says how much and where two PNGs differ. `bank.mjs --check`
  grades itself with the same function; the CLI is for looking at a specific
  pair by hand, and `--tiles` names the region rather than the number.
- **`depth.mjs`** re-derives the two numbers the DEPTH FORMAT decides, and it is
  the one script here that is not about the picture being the same — it is about
  a number staying right. `stencil: false` picks `depth32float` over
  `depth24plus-stencil8`, and WebGPU defines `depthBias` in a different unit for
  a float format, so `CelMaterialFactory.GLASS_DEPTH_UNITS` and
  `OutlineRenderer`'s own offsets are both stated in a unit that moves when that
  flag moves. `glass` sweeps the bias against range on a tinted curtain wall
  (and throws since X4.6e, owing a port to our glazing: `FINDINGS.md` 69);
  `zoffset` is a ruler that says what the outline pass's offsets are worth in
  metres. **Nothing else re-derives these, the bank least of all** — a pane that
  has quietly stopped being drawn at 180 m is in no banked frame.
- **`pipelines.mjs`** counts shader modules and render pipelines against the
  frame clock. This is the replacement for the WebGL2 `shaderSource` hook —
  `GPUDevice.prototype.createShaderModule` in an `addInitScript`, whose
  `getCompilationInfo()` reports against source you are already holding.
  It counts our renderer's pipelines too (`createRenderPipelineAsync` and
  `createComputePipelineAsync`, built off the frame) beside Babylon's.
  **`--round`** plays a scripted round on an armoured map instead of standing
  still — two lives, every weapon fired, a frag, a molotov, the launcher and a
  mine, one pane broken — and files every creation under the action that
  caused it (the spawn, deploy to playing, is a phase of its own) and under
  the Babylon mesh being drawn when it was made, each install reported apart
  and left out: the count `BABYLON_EXIT.md` X4.4e must take to zero (X4.4a's
  note has the readings). The camera's path is a function of FRAMES and it is
  turned onto the pane before the pane breaks, so what is on screen when an
  effect is first drawn does not ride the machine's frame rate; the pane
  phase says how many shard draws the main pass made.

- **`surfaces.mjs`** is where each surface `BABYLON_EXIT.md` X4.6 moves sits in
  Babylon's frame, MEASURED: it shoots a map's sequence as `bank.mjs` does and
  logs one frozen frame's every Babylon draw in record order, our draw points
  among them, with the list each draw is on (read from its place between the
  points), what its pipeline holds (depth write and test, bias, cull, blend) and
  what the frustum kept and the size gate dropped. **`--pixels`** takes each
  class out at `Mesh.render` for a frame and counts the pixels that move, which
  is how a row is shown to hold a surface rather than merely to draw it, and
  counts the overlaps the plan asks about: a blended surface over water, a pane
  over water. Each class prints a count per list, `other` and the editor's `proxy`
  included, and under `--pixels` the whole-frame mean its removal comes to, which is
  what `--check`'s tolerance would see. **`--editor`** asks the same of an editor
  build and changes one water rect and one grass rect through the editor's own
  rebuild. **`--keep=<dir>`** writes each reported row's frame as the probe saw it,
  under the names `bank.mjs --keep` uses, which is how the probe is shown to move no
  pixel. What it reads stops being reported as each surface leaves Babylon, which is
  how a sub-step shows it took the whole of one. **An empty class says only that
  frame**: no frozen frame reaches `updateBlobs`, so a blob is in no row but one that
  raises it with a `blob` event. X4.6a's note has the table. **What comes through
  no `Mesh.render` is logged too** (Phase 4's gate, `BABYLON_EXIT.md`): the engine's
  `_draw` while no mesh or field renders — the post chain's passes and anything else
  Babylon would draw on its own (a layer, an effect layer, a sprite) — as `effect ->
  target`, under a row when it differs from the row before and totalled per draw over
  the run at the end. A frozen frame still raises only what that frame raises, so the
  gate read a live round's log beside it (its record names the script).

- **`particles.mjs`** is the GPU particle fields' CPU half, logged frame by frame in
  a live frame loop over the deploy screen's HELD world (`BABYLON_EXIT.md` X4.7a; not a
  live round: `Game.followEye` is told the fleet stepped, the hull and the camera
  pinned): each field's emission state (rate,
  accumulator, count, emit index and count, write pointer, step, emitter), the
  rotors' water sites, the GPU passes each frame began (a field's dispatch
  SPLITTING the main pass, counted) and which path the seam took, with a flying
  hull pinned over dry ground and then over water and the ash running, every field
  reset and the window opened on the first frame every field is ready. **The clock
  is a schedule of frame deltas handed to the scene's own path** (16.7 ms, and
  0.25 ms and 1,500 ms once every sixty frames, so the 1..1000 ms clamp in
  `Scene.animate` is exercised; X4.7a's review, where it had been
  `useConstantAnimationDeltaTime`, which skips the clamp). Several maps are one boot,
  rotated through the menu as a player rotates them; at each install it logs the
  scene's particle systems in order and the `Math.random` draws of each
  construction and each first update, and `--editor` ends with `F2` and an
  editor rebuild. `--against` compares two logs — the order, every construction's
  and first update's draws (label and count), then every logged number by
  `Object.is`, and the editor's orders and draws — which is how a port of the CPU
  half is proven, since no live frame's pixels reproduce; one tree against itself
  is the control. Since X4.7c it reads OUR fields beside Babylon's through one
  adapter (the ash since X4.7c and the rotor wash since X4.7d are
  `g.particleDraw`'s, listed first, the order the frame draws them in), the same
  columns off each, and counts our first updates around
  `ParticleDraw.initialize` under Babylon's label; a field it cannot count (neither
  ours nor holding a Babylon `_initialize`) is named in the log's `unwrapped`
  rather than thrown on. `--editor` ends in the round leaving the editor starts
  (X4.7d), so the dev-only flow X4.7c's decision names — `F2`, an in-memory
  `particles.count` edit, the rebuild, back to a round — is compared whole; its
  oracle for X4.7d was a BEFORE at 312dc44, where every field was Babylon's.
  `surfaces.mjs` has a class per BABYLON field (`motes`, `rotorWash`,
  `rotorSpray`), each draw logged at its place between the points with its
  pipeline, blend mode, count and the defines of its compiled update and render
  effects, and the seam's path each frame — which logs none on a tree since X4.7d,
  every field being ours, and is how a BEFORE's are read; `pipelines.mjs --round` keeps each creation's stack.

- **`gi.mjs`** is the irradiance volume, STEPPED one `update` at a time in a held
  deploy world under a pinned seed (`BABYLON_EXIT.md` X5.1a; its header is its
  contract): every step's CPU half (the cursor, the warm frames, the window, the
  light lists, the channels, the hull slots, the whole params array, the passes
  dispatched by name and workgroups) and its thirteen GPU resources read back and
  hashed, from a fresh history through the warm-up, a converged world held, a lamp
  switched on (its bounce followed sweep by sweep), a flash raised and dying, the
  tiers, and the cloud field's sampler both ways; beside it, measured live and not
  compared, the states (the building card, deploy, a round, the round-over card,
  the menu, an editor build with a drag), whether each dispatch ended a render pass,
  which encoder it went on, whether our prepares ran that frame, and Babylon's binds
  of the seven and the cloud field. The device is wrapped from the page's first line
  (`bootMap`'s `init`), so the modules' tokens, the pipelines, the bind groups, the
  textures', buffers' and samplers' descriptors are read as they are made. **The
  trace RACES** (it reads history another workgroup of the same dispatch may be
  writing), so its colour lanes are compared only in its `serial` scenarios (one
  workgroup a dispatch), and everything else everywhere. `--against` compares two
  logs by `Object.is` and by hash; `--compare=a.json --against=b.json` does it with
  no browser. Every read of the volume's own resources — the thirteen, and what our
  frame binds for the seven — goes through one adapter (`window.__giGpu`), Babylon's at
  a parent before X5.1b, and OURS (`GiVolume.gpu`, `render/GiCompute.ts`) wherever it
  is present; the cloud field, Babylon's texture until X5.4, and the live half's
  Babylon wraps are read directly (its header). A sampler is logged by the members
  `GPUSamplerDescriptor` has (Babylon's cache hands the device one of its own,
  `anisotropyEnabled`, which WebGPU ignores; X5.1b).
  **The harness holds the volume by stubbing its `update`**, and that is a contract a
  port keeps: `freeze`'s `gi` block counts the volume's dispatches through one adapter
  (`window.__refGiCount`: OURS first since X5.1b — `GiCompute.recorded`, the frames its
  late prepare recorded the passes on, checked LIVE at every call against the volume's own
  pipelines' dispatches counted at `GPUComputePassEncoder` (trace, compose and vis each
  equal to how far `recorded` moved, or it throws: X5.1b's review, so a `recorded` that
  stopped counting cannot hold a row vacuously) — and Babylon's at a parent, whose arm answers null
  — and the freeze throws — for anything in `trace`, `compose` or `vis` that is not
  Babylon's own `ComputeShader`) and
  `thaw` throws if any happened under the stub; `bank.mjs` thaws once more after each
  map's last row, so every row's hold is checked.

- **`post.mjs`** is the post chain read off the DEVICE pass by pass (`BABYLON_EXIT.md`
  X5.2a; its header is its contract): Hollowmere's `lanterns` eye, shot as `bank.mjs`
  shoots a row, at two page sizes (`desk`, 1920x1080 at 1, the bank's; `phone`, 832x384
  at a device scale of 2.8125) through sixteen scenarios a boot (every render scale at
  both glow rungs, every shafts rung, each tail pass off, all of them off, the blur in
  flight, the damage flash held, and the base again after every toggle), two frames
  captured each and the second logged: every render pass in submit order with its
  attachments, load and store ops and clear values, a SHA-256 of each target as its pass
  left it (a copy recorded on the pass's own encoder after its `end`), and every draw a
  chain stage made, with its pipeline (both modules by their tokens, the vertex layout,
  cull, front face, depth state, blend, write mask, the layout), its bind groups entry by
  entry (each sampler's descriptor, each view's target, each uniform buffer's BYTES as the
  queue held them at the submit — a buffer binding recorded by VALUE since X5.2b, Babylon
  rewriting its binding objects for the next group), its vertex and index bytes and its draw call; beside
  them the camera's list as Babylon holds it (its holes), each pass's own fields,
  `scene.autoClear` and `scene.imageProcessingConfiguration`; and once a boot the
  device's limits, the canvas's configuration and every module's processed text. **Every
  naming goes through one adapter** (`window.__postGpu`: Babylon's arm, and a sub-step
  that moves a stage adds ours, picked first, under the same names — since X5.2b the
  glow's box filter and blur, `Game.glowBlur`, named off its modules' labels), so a draw of ours is
  compared with the Babylon draw it replaced (`harness.mjs`'s `postAdapter`, the CPU half
  `freeze` holds, shares the name and gains ours by the same sub-step). Beside the log,
  printed and not compared, the LIVE frames from the page's first, and — on a second,
  fresh page, where nothing has been drawn at those settings yet and a compile can still
  show — after a render-scale change, a glow rung change, a shafts rung change and a
  resize. `--against` compares two logs by `Object.is`, names EVERY differing path a
  scenario has (`--max-diffs`, 40 by default), a long value from its first differing
  character, and excuses only the path patterns `--ignore` names (`**` any segments, `*`
  any run within one, `[stage=glob]` an element by its STAGE rather than its index;
  `@file` for a list), saying which pattern matched nothing; it exits 1 on a difference
  left; `--compare` does it with no browser. About 25 minutes for both sizes.
  **Each X5.2 sub-step's expected differences are committed in
  `plans/webgpu-ref/post-expected.txt`** (`--ignore=@plans/webgpu-ref/post-expected.txt`),
  a section a sub-step, each line saying why — X5.2b's three on the glow's draws first —
  and a later sub-step adds its own section there. **Key a line on the draw's stage**
  (`**.draws[stage=glow.*].viewport`), never on a pass index: an index names whatever
  draw a scenario puts at it, so it would excuse the same field on another stage's draw
  (X5.2b's review).

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
  the air, but for a row that asks for one: `strike`, `sky-flash`). **When the bank goes red on an unchanged tree again, look for the
  newest thing that changes by itself in a held world** — that has now been
  the answer four times.
- **The post chain is left ON, with only its updaters held.** The plan called
  for `g.post.setEnabled(false)`, and that would reach the same floor — the
  grade's grain was re-hashed every frame at ~14 LSB and was the largest term in
  the noise. But the three post fragments are M3's own work and a set taken
  with the chain disabled could not diff them. Pinning the grade's `time` killed the
  grain and kept the vignette, the aberration, the god rays and the motion
  blur in the picture. **The grade has had no clock since** (its paper is pinned to
  the world), so the `g.post.time = 0` the freeze went on writing was a no-op and
  is gone (`BABYLON_EXIT.md` X5.2a): what holding it stops now is the damage
  flash's decay, which a `damage` row raises under the hold. The three updaters
  are reached through one adapter, `harness.mjs`'s `postAdapter`.
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
  **It was not a pure read while Babylon drew the debris**: `Mesh.isReady(true)`
  COMPUTES every mesh's world, which refreshed the bounds Babylon's size gate
  read — so before `BABYLON_EXIT.md` X4.4c it is what made the `fx-blast-*`
  rows' rubble drawable, a chunk a live round never drew, and X4.4c restated
  that refresh in `waitUntilDrawn` for its pieces. Since the commit after
  X4.4c every piece is gated on the sphere it is drawn with, the game draws
  the rubble the rows always showed, and the refresh is gone. **The scorch and
  the blobs were the same case until X4.6e** and nobody saw it: their meshes'
  bounds were refreshed by the same call, so no row could tell Babylon's
  latch from a gate on this frame's sphere, and X4.6e's note said the two
  were the same. Its review found the latch with a live probe; it was ported
  exactly for one commit, with this refresh restated in `waitUntilDrawn`, and
  then dropped by the owner's decision of 2026-11-06, the refresh with it:
  nothing here touches the game's state before asking whether it is ready.
  **So the bank is BLIND to a Babylon size-gate latch, by construction, and
  "no change to the picture" for a size-gated Babylon mesh is not something
  it can say** — it missed the pieces, the debris and the scorch
  (`FINDINGS.md` 68). Ask a LIVE probe instead: the render loop running, no
  `scene.isReady()` and no freeze, the surface raised through the game's own
  door far from where its mesh was last computed, the active and candidate
  lists read per frame on Babylon's side and the draw's on ours, at a
  phone-height viewport and at 1080p, with a case that releases the latch.

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
frozen again. **The post chain's parts are the exception, recorded afresh at
EVERY freeze off the objects it stubbed**, because the game REBUILDS the shafts
on a rung change and on off to on: a stash taken once a page gave the first
pass its updater back and never a successor, so until `BABYLON_EXIT.md` X5.2a's
held finding F1 was fixed (2026-11-08) Hollowmere's `ground`, `crossing`,
`sky-moon`, `sky-motes` and `ring-flown`, shot after `post-novol` and
`post-glowlow` rebuilt the pass, were banked with the shafts held at
`lanterns`' basis — this smear, measured — and those five were re-banked when
it was fixed. **Readiness is asked per vantage too, and for the same reason it
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
`gate.json`. It is ~360 MB of PNG (132 frames, measured at X4.6a's review) that is only
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
blast in the air, the effect pools on a stated clock (`fx`: rounds, throws, rockets, mines, blasts, fires, shards, brass), the viewmodel (fitted, painted, or held mid-gesture), the
kit screen, the capture rings and flags, a setting changed, the motion blur in
flight, the particle fields as the game runs them — each posed by the game's own code from a fixed state through fixed
steps (`src/bench/vantages.ts`'s header lists them, and
`placeVantage` puts every one away before the next row). What the table holds
for each step of the exit:

| exit step | rows |
| --- | --- |
| X3 the static world | every map's menu and map views |
| X3.5 terrain and roads | every map's `ground` (the eye 35 cm off the floor, a turf edge in frame) and `crossing` (two road ranks meeting), banked by `--rows` before X3.5 so they are Babylon's floor |
| X4.1 bodies | `sarab-rig-near`, `sarab-rig-far` (250 m, inside `bodyDrawDistance`) |
| X4.2 vehicles | `sarab-tank`, `sarab-truck`, `sarab-heli`; `cinderhaven-tank-far` (X4.2c's detail tier: a tank ~30.5 px across, just past its 32 px swap, so it draws its REDUCED set — ~55 pixels of the frame, seen by a pixel comparison of two `--keep` directories and never by `--check`'s mean tolerance; appended by `--rows`) |
| X4.3 the viewmodel | `harrowmead-view-<optic>-hip` / `-aim`, one weapon per optic; and X4.3a's twenty-two, appended at the end of Harrowmead's list by `--rows`: the two optics those leave out (`view-greendot-*`, `view-longscope-*` on the DMR), the three rigs with a sight of their own (`view-pistol-aim`, `view-rpg-aim`, `view-mine-hip`), one finish on each rung of the gloss ladder above matte (`view-finish-satin`, `-glint`, `-mirror`), every gesture held mid-phase (`view-reload-drop` and `-seat` — a dry reload, the camera turned by the head's look, each posed off its OWN previous frame because the reload's gravity reads Babylon's render cache — `view-bolt`, `view-load`, `view-throw-frag`, `-molotov`, and `view-flash` on a seeded strobe), and the kit screen (`kit-desktop`, `kit-phone`: the real lid raised over `deploy`, the card, the bench lamps and the glow's stage rule, at the bay `stageBay` measures on a desktop and on an 832x384 phone, stated because the bank hides the interface), and after them the review's three (`view-pistol-reload`, the pistol's slide locked back in its dry reload; `view-bolt-aim`, the bolt cycle aimed with the reticle on the axis; `view-reload-tactical`, the spent magazine stripped into the hand) |
| X4.4 effect pools | `coldharbour-blast`; and X4.4a's twenty-one, appended by `--rows` at the end of Coldharbour's list and Cinderhaven's (`fx` rows, every one standing at a position the map's rows already stand at, so the benchmark gains no stop): a tracer in flight (`fx-tracer`), impacts mid-fade on `hard` and `ground` (`fx-impact-hard`, `-ground`), a wall of marks near and at the size gate's edge (`fx-marks-near`, `-far`), a frag in flight and at rest with a bottle (`fx-grenade`), a rocket (`fx-rocket`), two mines lit and dark (`fx-mine`), brass (`fx-brass`), the blast at three ages on each surface with its rubble and scorch (`fx-blast-{hard,ground}-{fireball,billows,smoke}`), two scorches full and fading (`fx-scorch`), a molotov (`fx-molotov`), a pane's shards (`fx-shards`), fading effects behind and in front of see-through glazing (`fx-glass`), and on Cinderhaven a world fire alone and with fading effects round it (`fx-fire`, `fx-fire-fade`); and after X4.4b, when the pieces' stale-sphere latch came out, three pieces far enough from the world origin that the latch dropped them, each appended by `--rows` at its stop and at the game's own hip field (`fx-brass-far` at Coldharbour's `avenue`, `fx-mine-far` and `fx-rocket-far` at Cinderhaven's `fx-fire` eye); and after X4.4c, when the debris's latch came out, a pane's shards on Cinderhaven ~313 m from the origin, half of which it dropped (`fx-shards-far` at the `town` eye, appended by `--rows`) |
| X4.5 sky and clouds | every row; `hollowmere-lanterns` and `cinderhaven-town` at night; and X4.5a's eight, appended by `--rows` at the end of Hollowmere's, Coldharbour's and Cinderhaven's lists, every one at an eye a row above it stands at, so the benchmark gains no stop: the moon and its bloom with a roof under it (`hollowmere-sky-moon`), ash in front of and beside it (`hollowmere-sky-motes`), the disc and its bloom on a day map (`coldharbour-sky-disc`), the ring against a horizon by day and by night (`coldharbour-sky-ring`, `cinderhaven-sky-ring`), a cloud crossing the disc (`cinderhaven-sky-cloud-moon`), the ridge 680 to 740 m off against the dome (`cinderhaven-sky-far`) and a seeded flash (`cinderhaven-sky-flash`, last on its list) |
| X4.6 water, glazing, grass, flags, rings | `greyfen-marsh`, `harrowmead-millpond`, `coldharbour-shopfront` (see-through), `coldharbour-curtain2/40/90` (backed), `hollowmere-ring`; the far quad in `coldharbour-menu`, `-avenue` and `-sky-disc` and `cinderhaven-sky-cloud-moon` (`surfaces.mjs --pixels` has the counts); and X4.6a's nine, appended by `--rows` at the end of Hollowmere's, Greyfen's, Coldharbour's and Sarab's lists, every one at an eye a row above it stands at or the menu's, so the benchmark gains no stop: the cloth up its pole on both sheets and both sides (`hollowmere-ring-flown`, `coldharbour-ring-flown-far`), a ring's stones (`coldharbour-ring-stones`), Greyfen's grass at each rung (`greyfen-grass-low`, `-medium`, `-high`), sparks and discs over water with a disc under it (`coldharbour-fx-water-fade`), a pane really collapsed (`coldharbour-fx-glass-broken`) and water through glass (`sarab-pane-water`); and its review's two, at the end of Coldharbour's list at `square`'s eye: the blob among the panes and the fades (`coldharbour-fx-blob-sort`) and a scorch through glass on both sides of the sort (`coldharbour-fx-scorch-glass`); and X4.6b's one at the end of the same list at `crossing`'s eye: a ring farther than its field's blades (`coldharbour-ring-behind-field`); and X4.6c's three, at the end of Greyfen's and Harrowmead's lists at `crossing`'s, `millpond`'s and the menu's eyes: blades in water on either side of its sort key (`greyfen-shore-ahead`, `harrowmead-shore-ahead`, `harrowmead-shore-behind`), which no fixed draw point holds; and its review's one, at the end of Sarab's list at `shelf`'s eye: reedy bodies on BOTH sides of the key in one frame (`sarab-shore-flip`), whose frame is 21839d1's truth, banked there, and which the tree moves until X4.6d (the owner's decision, `exact.mjs`'s `EXPECTED_MOVES`); and X4.6e's review's one, by the owner's decision of 2026-11-06, at the end of Coldharbour's list at `square`'s eye through a 6° field: a blob seen from above sorted BETWEEN two glass layers, under the near one and over the far one, which `fx-blob-sort` stopped holding when the blob turned to face up (`coldharbour-fx-blob-glass`) |
| X4.7 GPU particles | `hollowmere-sky-motes` (the field gathered, for the moon's order); and X4.7a's five, appended by `--rows` at the end of Sarab's, Cinderhaven's and Kurenai's lists, every one at an eye a row above it stands at, so the benchmark gains no stop, each the fields as the game runs them and nothing else in the air: the ash on an ADD field that follows the eye (`cinderhaven-particles-embers`, `town`'s eye) and on a STANDARD one that follows it and falls (`kurenai-particles-leaves`, `ground`'s); a helicopter pinned 2.5 m over sand, its dust ring (`sarab-particles-dust`, `crossing`'s eye); one 3 m over the western sea, its spray ring and the water's hole (`cinderhaven-particles-spray`, `tank-far`'s, 12°); and the dust ring with the embers through it, the order between two fields (`cinderhaven-particles-ring-ash`, the same eye, 20°) |
| X5.1 the irradiance volume | every row, converged and held (`freeze`'s `gi` block): no row holds it MOVING, which `gi.mjs` logs instead; and the floors under `--query=gi=low` and `--query=gi=off` (X5.1a: the floors, two full processes each: `--query=gi=off` 142 of 143 byte-equal and `harrowmead-view-pistol-reload` within its flake; `--query=gi=low` 142 byte-equal and `sarab-alley` 5 pixels by 2/255 — two frames, Sarab alone twice more drawing the second run's (3 processes of 4 against 1), the class `sarab-ground` is at high (what moves is that row's frame, both frames the same tree's; the cause is not pinned — it did not appear at off in two runs, which fits the volume's race leaving a sub-8-bit residue there, unproven)), the BEFOREs X5.1b is graded against beside the plain bank's |
| X5.2 the post chain | `hollowmere-post-*`, each one setting off against `lanterns`; and X5.2a's four, appended by `--rows` at the end of Hollowmere's list at `lanterns`' eye, so the benchmark gains no stop: the chain at render scale 0.5 and 0.75 (`post-scale50`, `post-scale75`: every target re-sized, the glow's floored, the blur's kernel and so its shader text moved), the grade's damage flash held at its kick (`post-damage`, `freeze`'s `damage`) and every tail pass off, the ink writing the canvas itself (`post-alloff`). What no row holds — the passes' targets, samplers, descriptors and processed WGSL, a phone's density, a frame before readiness, a resize in play — `post.mjs` logs |

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
- **Six rows hold a GPU particle, and every other row holds none.** The freeze
  turns particles off, because they run on their own clock. `hollowmere-sky-motes`
  rebuilds the mote field under a seed, gathered into 24 m on the eye, steps it
  by hand and holds it by a clock of zero (`placeVantage`, the `motes` field),
  for the moon painting over ash in front of it — an ORDER, not the field.
  **Since `BABYLON_EXIT.md` X4.7a five more hold the fields AS THE GAME RUNS
  THEM** (the `particles` field): the ash in its own box on the eye at its own
  rate on an ADD field (`cinderhaven-particles-embers`) and a STANDARD one that
  falls (`kurenai-particles-leaves`); a helicopter pinned hovering over sand, its
  dust ring driven by `RotorWash.update` (`sarab-particles-dust`), and over the
  sea, its spray ring and the water's hole (`cinderhaven-particles-spray`); and
  a ring and the ash in one frame, the order BETWEEN two fields
  (`cinderhaven-particles-ring-ash`). Each field is rebuilt under a seed (the
  ash before the rings, an install's order), stepped by its own pre-warm pair
  through fixed frames at an animation ratio of 1 under a second seed, and held
  by a clock of zero, and every field a row does not state is held EMPTY. **Every
  touch of a field in this file goes through one adapter (`placeVantage`'s
  `fields`)** — that path, the `motes` path and `freeze`'s `particles` switch with
  its thaw — which since `BABYLON_EXIT.md` X4.7c picks per field between OURS (the
  ash since X4.7c and the rings since X4.7d, `g.particleDraw`: its ready test,
  reset, pre-warm step and switch) and Babylon's (the rotor wash at a parent
  before X4.7d), so every particle row grades our fields, and a BEFORE at a parent
  touches each field where it lies, as before.
  **These rows sit under `--check`'s mean** — the embers' whole field 0.0142, the
  order between the ring and the ash about 0.0001 — **so only `exact.mjs` grades
  them.** No row puts a particle against the see-through panes or the fades, or a
  ring against the moon. **What
  no row holds is a field MOVING**: the CPU half a port must reproduce (the
  emission accumulator, the count, the write pointer, the step, the emitter) is
  logged frame by frame in a live loop by `particles.mjs`, compared by
  `Object.is` across two trees, since no live frame's pixels reproduce.
- **No row holds the irradiance volume MOVING.** Every row is its converged fixed
  point, with no dispatch in the frame and no pulse light (`freeze`), so a wrong
  slice order, a dropped frame, a dirty vis channel, or the bake and the dispatch
  recorded in another order can converge to the same bytes. `gi.mjs` logs it moving
  (`BABYLON_EXIT.md` X5.1a). **And no two runs agree on it before it converges**: the
  trace reads the history other workgroups of its own dispatch are rewriting, so
  one step from the same fresh history came back with four hashes in four tries;
  what reproduces is the converged frame (eight sweeps leave a held world's drift at
  most 3.8e-6 a texel) and anything traced one workgroup a dispatch. No row sets
  `gi`, so the bank is the HIGH tier's; the low and off tiers are graded by
  `--check --keep --query=gi=low` (and `=off`) at the parent and at the step,
  compared by `exact.mjs` — never against `ref/`, which is high's.
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
  frames are not a substitute for it.** It is `depth.mjs glass` now — **which
  THROWS since `BABYLON_EXIT.md` X4.6e** ("owes a port"): it reads Babylon's
  glazing meshes and a round has none, so the sweep is not re-takeable until
  it is ported to `GlassDraw` (`FINDINGS.md` 69). The sweep
  is a measurement: it hides the rest of the map, holds the incidence angle and the
  on-screen size still by moving `fov` with the distance, and reads the pane's
  own contribution by toggling the group and differencing — see
  `VERIFYING.md`. What is banked instead is the same wall photographed at 2, 40
  and 90 m as the game actually draws it, which catches a sheet that stops
  being drawn and will not resolve a depth bias that is merely a little wrong.
  Past ~100 m there is also nothing to photograph down that axis: 220 m of
  clear line does not exist on a 320 m map with buildings on it, which is why
  the sweep hides them.
