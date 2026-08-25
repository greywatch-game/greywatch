# The M2 reference set — GLSL under WebGPU

**This is what every WGSL landing diffs against**, and it is the most valuable
artefact of the migration. It is deliberately NOT a set of WebGL2 shots: the
engine swap landed first with all nine shaders still in GLSL, so a frame taken
here has the engine difference already absorbed in it. A diff against these
therefore means a **shader** difference, which is the only thing M3–M6 can
break.

Taken on `feature/working` with `src/shaders/glslScaffold.ts` in place — the
engine is `WebGPUEngine`, every shader is still GLSL, and the backend runs them
through glslang → SPIR-V → twgsl → WGSL.

## How to re-take one

The scripts are beside this file. Start the dev server (`npm run dev`), then:

```
node bank.mjs <mapId>          # every vantage that map has, into ref/
node gate.mjs <mapId>          # the 24 engine-level assertions
node cold-stagger.mjs 4        # Coldharbour's forty probes, four a frame
```

`vantages.mjs` is the pose table, in the same shape `src/ui/mapShots.ts` states
its own: `pos` is `[x, metres ABOVE the surface there, z]` and `target` is
absolute world metres, with `absolute: true` on the rows that mean a height up a
wall rather than a height over the ground. Every row says what the frame is OF,
because that is what a re-shoot has to preserve and the numbers alone do not say
it.

## The three things that make a diff mean anything

- **The frame is FROZEN and the floor was re-derived, not read off the WebGL2
  number.** Measured here: **0.000% of pixels differ** between two consecutive
  grabs. Check it again in any run that is going to produce a number — a method
  that cannot reach zero is not measuring what you think it is.
- **The post chain is left ON, with only the grain's clock pinned.** The plan
  called for `g.post.setEnabled(false)`, and that would work — the grade's grain
  is re-hashed every frame at ~14 LSB and is by far the largest term in the
  noise floor. But the three post fragments are M3's own work, and a reference
  set taken with the chain disabled could not diff them. Pinning `post.time` to
  a constant kills the grain and keeps the vignette, the aberration, the god
  rays and the motion blur in the picture, and the floor still reaches zero.
- **One process per MAP, and the pause lid never comes off.** `VERIFYING.md`'s
  one-vantage-per-process rule is about cycling back through `playing` between
  vantages, which lets a frame of gameplay run and moves the player. Holding the
  lid up and placing the camera by hand moves nothing at all, so a map's whole
  table can be shot in one boot — which is what makes a re-shoot cheap enough to
  actually do.

## What is NOT in it, and must be taken on real hardware

- **Nothing here is a frame TIME.** Every WebGPU frame on this box is
  CPU-rendered by SwiftShader at roughly half a frame a second (see
  `VERIFYING.md`); WebGL2 gets the real GPU and WebGPU does not. Correctness —
  which is all a parity diff is — is unaffected. Performance is not measurable
  here at all.
- **Coldharbour's forty cube probes are baked four a frame rather than all at
  once.** The game queues all forty on the frame after `installMap`, which is
  240 face renders and is what takes the device here. Parking them and
  releasing them over ten frames bakes the same forty and proves the probe path,
  but it does not prove the SHIPPED bake, and only a GPU can do that.
