# The M2 reference set — GLSL under WebGPU

**This is what every WGSL landing diffs against**, and it is the most valuable
artefact of the migration. It is deliberately NOT a set of WebGL2 shots: the
engine swap landed first with all nine shaders still in GLSL, so a frame taken
here has the engine difference already absorbed in it. A diff against these
therefore means a **shader** difference, which is the only thing M3–M6 can
break.

Taken with `src/shaders/glslScaffold.ts` in place — the engine is
`WebGPUEngine`, every shader is still GLSL, and the backend runs them through
glslang → SPIR-V → twgsl → WGSL.

## The scripts

They live beside this file and share `harness.mjs`, which owns the four facts
about driving WebGPU that each of them would otherwise get wrong alone. The
browser and the dev server are NOT re-implemented here: `scripts/browser.mjs`
and `scripts/dev-server.mjs` own those and these import them, so there is one
copy of the launch flags in the repository rather than four.

Nothing needs `npm run dev` running first — each script starts and stops its
own dev server.

```
node plans/webgpu-ref/gate.mjs [map...] [--headed] [--uncap]
node plans/webgpu-ref/bank.mjs [map...] [--headed] [--check]
node plans/webgpu-ref/diff.mjs a.png b.png [--tiles]
node plans/webgpu-ref/pipelines.mjs [map] [--seconds N]
```

- **`gate.mjs`** boots every shipped map, plays a real round on each and fails
  loudly if any is not clean — the engine is WebGPU, the round reaches
  `playing`, no probe re-renders per frame, and there are no page or console
  errors. It exits non-zero, so it can stand in front of a merge.
- **`bank.mjs`** takes the reference frames into `ref/`, and refuses to write
  one that is not reproducible. `--check` re-takes and grades against what is
  banked instead of replacing it.
- **`diff.mjs`** says how much and where two PNGs differ. `bank.mjs --check`
  grades itself with the same function; the CLI is for looking at a specific
  pair by hand, and `--tiles` names the region rather than the number.
- **`pipelines.mjs`** counts shader modules and render pipelines against the
  frame clock. This is the replacement for the WebGL2 `shaderSource` hook —
  `GPUDevice.prototype.createShaderModule` in an `addInitScript`, whose
  `getCompilationInfo()` reports against source you are already holding.

`cold-stagger.mjs` is **gone and is not coming back**. It existed to bake
Coldharbour's forty cube probes four a frame because doing all forty at once
killed a CPU rasteriser's device; on real hardware the shipped one-frame bake
takes 138 ms and the workaround only ever proved the probe path rather than the
thing that ships.

The vantages are **not** stated here. They are read at runtime out of
`src/ui/mapShots.ts` — the table the MENU stands on — so a reference frame and
a menu backdrop cannot come to hold two ideas of where the camera stands, and a
re-frame is an edit in one place. A map with no row there is skipped and that is
not an error.

## The four things that make a diff mean anything

- **The frame is FROZEN, and the freeze PINS clocks rather than stopping
  them.** `Game.tick` runs `post.update`, `sky.update`, `godRays.update` and
  `motionBlur.update` in EVERY state, the deploy lid included, and there are
  three more accumulators behind them: **there is one wind and three clocks
  reading it** — the cel factory's `windTime`, the grass field's `time` and the
  water body's. Halting a clock leaves it holding however much wall clock that
  run spent booting, which reads as perfect inside one process and differs in
  every pixel of sky across two. Each is therefore assigned a constant and then
  stopped. The trap is worth stating plainly because it looks solved when it is
  not: with the clocks merely halted, two consecutive grabs were byte-identical
  on all four maps and a bank taken minutes earlier still failed on three.
- **The floor is measured two ways because there are two questions.** Inside
  one process, two consecutive grabs of the frozen frame are **byte-identical**
  on all four maps in both browser modes, and `bank.mjs` writes nothing unless
  they are. Across processes the same frame does not come back: over several
  runs the residue is 0.00 on Greyfen, ~0.001 on Coldharbour, 0.07–0.14 on
  Harrowmead and 0.12–0.25 on Hollowmere, in mean 8-bit channel error,
  concentrated in the sky and the tower rather than spread over the frame.
  `CHECK_TOLERANCE` is 0.35 — set from Hollowmere's worst rather than its
  typical, and below the 0.63/255 FINDINGS #12 treats as a real picture change.
  **That margin is under 2x, so `--check` catches a change that alters the
  picture and will not catch a subtle one**; resolve anything finer by taking
  before and after in ONE process, where the floor is zero. **Re-derive the
  floor in any run that is going to produce a number** — a method that cannot
  reach its own floor is not measuring what you think.
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
so a map's whole table can be shot in one boot — which is what makes a re-shoot
cheap enough to actually do.

## A bank belongs to the machine and the MODE it was taken in

Headed and headless frames are **not** byte-identical, on three of the four
maps. Both are correct; what may not happen is banking in one mode and checking
in the other, which reports four regressions that are a browser mode. The mode
is recorded in `ref/mode.json` and `bank.mjs --check` refuses a mismatch rather
than reporting nonsense. The same caution applies across machines: this bank was
taken headless on the Windows box (`nvidia/lovelace`), and a diff taken against
it on different silicon is measuring the silicon.

## What is NOT in it

- **Nothing here is a frame TIME.** `gate.mjs` reports those and they are real
  on this machine, but they are not what a reference IMAGE is for. Quote the
  gate's `warmFps`, never a number read off a bank run.
- **Nothing here proves the shipped bake on a machine that cannot finish it.**
  Coldharbour's forty probes are one frame and 138 ms here. On the Chromebook
  that frame takes the device, and no reference set taken there covers it.
