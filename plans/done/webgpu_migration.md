# Migrate Greywatch to WebGPU (WGSL-only, single branch)

> **SHIPPED — archived 2026-08-29. This is a record, not a plan.**
>
> Every milestone M0–M8 landed between 2026-08-25 (`791d1ae`, the engine swap
> with all nine shaders still GLSL) and 2026-08-26 (`38066a1`, the last shader
> and the last four deep imports). The tree it describes as the FUTURE is the
> tree that exists: zero GLSL under `src/`, `ShaderLanguage.WGSL` on every
> material and post-process that declares one, no WebGL fallback engine, and
> `main.ts` gating the boot on `navigator.gpu` plus an adapter. The two
> `WebGLEngine` mentions left in the source are prose in comments explaining
> what used to be there.
>
> **It is kept because the ARGUMENTS are still load-bearing** — *Key decisions*
> carries why the uniform arrays were not repacked, why the shared GLSL
> constants became registered WGSL includes, and why the deep-import count had
> to end lower than it started, none of which is written down anywhere else.
> Read it for those; do not read it for what to do next.
>
> **What is still LIVE from this work is the tooling, and it did not move**:
> `plans/webgpu-ref/` is the reference harness and image bank the milestones
> diffed against, and it is still how a rendering change is graded — `gate.mjs`,
> `bank.mjs --check` and `depth.mjs` are cited from `docs/build.md`,
> `docs/rendering.md`, `docs/world.md`, `VERIFYING.md` and `FINDINGS.md`.
> `plans/physics-ref/` is the same for Havok.
>
> **`ENGINE_UPGRADE.md` is NOT this and is NOT archived.** It is the live plan,
> with S10 still open.

## Context

Greywatch renders through WebGL2 with ~1,500 lines of hand-written GLSL ES 1.00.
This migrates it to **WebGPU only**, with every shader rewritten as **hand-written
WGSL**, on a **long-lived branch merged in one pass**. Both choices were made
explicitly after reviewing the alternatives (dual-backend with a runtime
transpiler; dual shader sources; incremental dual-engine).

**The justification is architectural, not performance.** `FINDINGS.md` #12
measured on real hardware that this frame is fill-bound: draw-call reductions of
26–36% were negligible. This migration changes no fill term, no shader
arithmetic and no resolution. **Expect frame time to be neutral.** Do not let
the schedule be defended by a frame-rate hope.

**It costs platform reach.** WebGPU is Chrome/Edge everywhere, Safari 18+, and
Firefox on Windows only. Firefox on Linux/macOS, older Android and older iOS will
stop booting — and Android/iOS are explicit PWA install targets. `README.md:26`'s
"Chrome/Edge/Firefox/Safari" promise and the boot-screen copy both change.

The server is unaffected: `NullEngine` (`server/HeadlessGame.ts:30`,
`server/parity.ts:15`) is engine-agnostic, and `npm run parity` / `npm run
simulate` don't move.

---

## Status

**M0 landed (`e23253c`, branch `feature/working`).** The engine is
`WebGPUEngine`, the boot gate is `navigator.gpu` + an adapter, the engine is a
constructor argument, and the game reaches `menu` with every pool non-null on
the first evaluate. All nine shaders are still GLSL. Fourteen gate assertions
pass, including all three boot-failure branches.

**Three things M0 found that this plan got wrong, each corrected in place
below.** They are listed here as well because two of them move work EARLIER:

1. `WebGPUEngine.CreateAsync` can never reject — see *Boot and engine*.
2. `EmissiveFog` blocks at M0, not M6, and `OutlineFog` will block at M1, not
   M6 — see *Verified groundwork* and *Milestones*.
3. Headless canvas rendering is unavailable on the dev machine — risk 3 landed.
   See *Verification*.

**M1 landed. Hollowmere draws, end to end, with all nine shaders still GLSL** —
a full round from `menu` through `deploy` into `playing`, twenty gate
assertions, zero page errors, zero WebGPU validation warnings, and the frame
diffs by eye against the committed WebGL2 menu photograph at the same vantage.
`setHardwareScalingLevel`, the front-to-back opaque sort, the 2048² shadow RTT
with 330 casters, fourteen `DynamicTexture`s, the R8 depth field, the
`GlowLayer`, the FXAA pipeline, the compute-particle motes (18.7k live) and the
kit backdrop's `ALWAYS` + `forceDepthWrite` + `alphaIndex: Infinity` are all
confirmed on the real backend.

**The `OutlineRenderer` question is settled the scaffolded way, and item 11
stays at M6.** Putting `_shaderLanguage` back to GLSL is three lines and makes
the outline pass read the store `OutlineFog` actually patches; measured after a
hollowmere → greyfen change, the compiled outline effect carries Greyfen's fog
literal (`0.7098, 0.7686, 0.6431`), there is exactly **1** outline effect in the
cache, and **0 of 328** outline draw wrappers hold a freed effect. The two prose
regression tests therefore re-run clean under WebGPU, and the second cache layer
the plan worried about has not bitten.

**M0's one scaffold line is now a scaffold FILE**, `src/shaders/glslScaffold.ts`
— `StandardMaterial.ForceGLSL`, the outline language, and the transpiler repair
below, with one header carrying the whole argument and two call sites
(`main.ts`, `Game`'s constructor). M6's demolition is deleting a file rather
than hunting three unrelated lines.

**Four things M1 found:**

4. **twgsl emits `@stride(N)`, which was REMOVED from WGSL, so every shader
   carrying a uniform ARRAY is rejected by the backend it was just transpiled
   for.** `alias Arr = @stride(16) array<vec3<f32>, 16u>;` → Dawn's `invalid
   type alias`; the cel, grass and water fragments all fail. The build on
   `cdn.babylonjs.com` is the only one there is (the unversioned path and the
   versioned path are the same bytes; there is no `twgsl` on npm), so the output
   is repaired in `glslScaffold`. **The two cases are different repairs**: a
   `vec3<f32>` array's natural uniform stride is already 16 and the attribute
   just goes, but `array<f32, 16>` packs at 4 and is illegal in a uniform buffer
   at all, so it becomes an array of a `@size(16)` struct with `.el` patched
   onto its accesses — which is what a current Tint emits and what Babylon's own
   WGSL processor does, so it is the shape `pointRange` will have after item 9
   anyway. **This is the thing that would have stopped the whole M0–M6 lever**,
   and it is one function.
5. **Uniformity analysis is required on day one on the GLSL path too, not only
   for hand-written WGSL.** `'textureSample' must only be called from uniform
   control flow` out of `shadowVisibility` and `band` — a shader that has been
   correct for the life of the project. `glslScaffold` forces Babylon's flag,
   which both passes it to twgsl and prefixes
   `diagnostic(off, derivative_uniformity)`. Same decision as the plan's
   `#define DISABLE_UNIFORMITY_ANALYSIS`, taken once and five milestones early.
6. **A sampler a material DECLARES must be BOUND, used or not.** `getInk` binds
   no shadow map and the cel `samplers` list declares one for every variant, so
   Hollowmere's two ink twins took the bind group down with them and the frame
   was black. **This is NOT scaffolding** — it is a permanent WebGPU rule and it
   is written up in `docs/rendering.md`. Uniforms are the opposite: unwritten is
   zeros, which is why the ink still binds no point lights.
7. **Coldharbour's forty-probe bake KILLS THE DEVICE on this machine** and is an
   instrument cliff rather than a port bug — the same bake is one frame at ~32
   fps on WebGL2 here, because WebGL2 gets the real GPU and WebGPU gets
   SwiftShader. Written up in `VERIFYING.md` with the two ways round it. **M2's
   Coldharbour work is now hard-gated on real hardware**, which sharpens rather
   than changes what *Verification* already says. **RESOLVED — see below: on
   real hardware the shipped bake is one frame and needs nothing — though see
   M7's finding 33, because the 138 ms recorded for it does not reproduce.**

---

## The hardware gate is lifted

**There is a second dev machine now — a Windows box with an RTX 4070 Ti SUPER —
and it settles every question this plan deferred to "real hardware".** WebGPU
gets `nvidia/lovelace` rather than SwiftShader, and headless presents a canvas
perfectly well provided the browser is asked for by `channel: "chromium"`;
Playwright's default `chromium_headless_shell` carries no GPU stack on Windows
and returns no adapter at all, which is the same boot-gate failure the missing
flag causes on the Chromebook and arrives by a different route.
`VERIFYING.md`'s WebGPU section is now written per-machine, because several of
its rules invert between the two.

**Item 7 is closed and its workaround is deleted.** Coldharbour's forty probes
bake in the one frame after install, all forty, no device loss, and the probes
are refresh-once so they are a build cost and never a frame cost. **The 138 ms
recorded here does not reproduce and M7 could not repeat it** — forcing a
re-bake with everything compiled costs ~1.4–2.1 s on the same machine. See
finding 33.
`cold-stagger.mjs` has been removed rather than kept: it only ever proved the
probe path, and the thing it stood in for now runs.

**The M2 reference set exists**, taken headless on that box, with the harness
committed beside it at `plans/webgpu-ref/` — `gate.mjs`, `bank.mjs`,
`shaders.mjs` (M5's), `diff.mjs`, `pipelines.mjs` and the `vantages.mjs` table,
over a shared `harness.mjs`. Three findings came out of building it and each is a way a
reference set can be confidently wrong:

8. **A frozen frame needs its clocks PINNED, not stopped, and there are seven
   of them.** `Game.tick` runs `post.update`, `sky.update`, `godRays.update`
   and `motionBlur.update` in EVERY state including the deploy lid, and **there
   is one wind and THREE clocks reading it** — the cel factory's `windTime`,
   the grass field's `time` and the water body's. Halting an accumulator leaves
   it holding however much wall clock that run spent booting, which looks
   perfect inside one process and differs across two. Consecutive grabs are
   byte-identical on all four maps; cross-process the residue is 0.00 to 0.14
   mean channel error, so the bank writes on byte-identity and CHECKS against a
   0.30 tolerance.
9. **A frame count cannot stand in for readiness, and this had already damaged
   committed output.** WebGPU compiles pipelines lazily and presents nothing
   until they exist; `scene.isReady()` flips on exactly the frame each map
   first draws, and that frame is not a constant (67–137 on Hollowmere across
   runs). `capture-map-shots.mjs` settled six frames — three seconds on the
   Chromebook, 45 ms here — so `npm run shots` would have overwritten two
   committed backdrops with blank frames. Fixed there.
10. **Do not read pixels back off the canvas.** A `drawImage` readback comes
    back fully transparent on Hollowmere while `page.screenshot()` of the same
    frame is 3.3 MB of chapel, and a diff of two black images passes.

**What real hardware also says about the frame**, uncapped, warm, 1920x1080,
sixteen bots, a live round — the milliseconds FINDINGS #12 says nobody has ever
taken:

| | Hollowmere | Greyfen | Coldharbour | Harrowmead |
| --- | --- | --- | --- | --- |
| warm fps | 132–176 | 133–176 | 46–48 | 52–56 |
| median frame | 5.7 ms | 5.6 ms | 20.8 ms | 17.8 ms |
| p95 frame | 7.4 ms | 6.7 ms | 22.7 ms | 19.5 ms |

**The first seconds of a round are the COMPILER**: 42 shader modules and 25
render pipelines are created in the first second after spawn, which runs at
9 fps on Coldharbour against the ~48 it settles at by the third. Summed over
the round, `createRenderPipeline` accounts for 0.6 ms, so the cost is Dawn
compiling behind the call rather than the call. Anything quoting a frame rate
must warm up first — and a stutter through the opening seconds of a live round
is a player-facing question this plan has not costed.

## M2 landed

**All four maps are up on GLSL-under-WebGPU, and the reference set is SIXTEEN
frames rather than four.** `gate.mjs` plays a real round on each of the four
with no page and no console errors, `probesRenderOnce` true everywhere, and
Coldharbour's forty cube probes baking in one frame — the thing M1 could
not reach and the last of what M2 owed. (Recorded here at 130–150 ms; that
figure does not reproduce — see M7's finding 33.) Every banked frame is reproducible to a
0.000% floor inside its own process, which `bank.mjs` refuses to write without.

**Two things M2 found, and the first is why four frames was never a reference
set:**

11. **A backdrop is not a test, and the gap was not one of degree.** Between
    them the four menu photographs hold no backed pane at any range, no
    lamp-lit street, no gust crossing a canopy, no wall far enough off to band
    and — measurably — almost no water. A clean four-frame diff would therefore
    have said nothing at all about the variant that moved, which is risk 2's
    failure wearing a passing test. So a map is banked as several frames, and
    every row in the new `plans/webgpu-ref/vantages.mjs` carries a `proves`
    line naming the path it puts in frame; a row nobody can write that line for
    does not belong in the set. **Three of the vantages this plan named did not
    survive contact with the maps.** Greyfen has no dead trees any more — it
    was re-cut as a closed canopy, so the bright-fog outline case is the trunks
    receding down the valley instead. Hollowmere's ash MOTES cannot be in a
    frozen frame at all, because the freeze turns particles off and a frame
    that keeps them is not reproducible. And the 130 m and 220 m glass readings
    are a MEASUREMENT rather than a photograph: the sweep hides the rest of the
    map and moves `fov` with the distance, and 220 m of clear line does not
    exist on a 320 m map with buildings on it. The bank holds the same curtain
    wall at 2, 40 and 90 m as the game actually draws it; the sweep stays M7's,
    against `VERIFYING.md`'s recipe.
12. **The frozen frame was not frozen, and NONE of the three things in the way
    was a clock.** The water clock had been pinned onto `body.material` where
    the field is `body.mat` — an optional chain onto `undefined`, throwing
    nothing, reporting nothing and pinning nothing, so the water was left
    HALTED at whatever clock the run booted with. **A lantern's flicker PHASE
    is `Math.random() * 100` per fixture at map build**, so a lamp-lit frame
    cannot agree with itself across two processes however carefully time is
    pinned. And **a cube probe is refresh-ONCE and was baked in the frame after
    install, before any of this was held** — so the water and the glazing went
    on reflecting a world that had never been frozen, which is why two runs
    could differ by 0.72/255 across a marsh with every clock, phase and uniform
    already provably identical. All three are invisible in the four backdrops
    and obvious in a frame chosen to hold water, a lamp or a reflection, which
    is finding 11 arriving as a measurement rather than an argument. **The
    phase is fixed in the GAME and not in the harness** — `LightingSystem` now
    seeds it (`FLICKER_SEED`, re-seeded in `clear`), which is the rule the
    world layer already keeps for scatter and which makes a bank taken over the
    game's own phases fail loudly if anyone unseeds them again. The other two
    are fixed in `harness.mjs`, the probes by re-baking after the pinning.

**The cross-process floor is now ZERO — all sixteen frames byte-identical
between two processes, on all four maps.** That is what finding 8's residue
turns out to have been, so `CHECK_TOLERANCE` drops from 0.35 to 0.02 and is now
slack for a driver rather than a measured floor. **A tolerance is what a floor
is not**: 0.35 was measuring two bugs and calling them noise, and it passed a
bank that was genuinely different every run. Finding 8's "0.00 to 0.14" and the
0.30 it quotes are superseded by this.

**The bank is NOT committed, and `ref/` is in `.gitignore` beside
`gate.json`.** It is ~45 MB of PNG, it is only meaningful on this machine in
this browser mode, and it has a generator that rebuilds the whole set in about
four minutes. That is the bar `docs/build.md` holds a committed generated asset
to, and a bank fails the other half of it: those four are the SAME on every
machine and this is not. What is committed is the harness and the vantage
table, which is the part that would be expensive to lose — the poses were
chosen by taking them and looking at them, and the numbers are the record of
that.


## M3 landed

**The three post fragments are hand-written WGSL, and all sixteen banked
frames come back byte-identical.** `HorrorPost`, `GodRays` and `MotionBlur`
are registered into `ShaderStore.ShadersStoreWGSL` and their passes state
`shaderLanguage: ShaderLanguage.WGSL`; the four-map gate is clean, every one
of the three effects reports WGSL, ready and no compilation error, and
`bank.mjs --check` is 0.000/255 on every frame of every map. The reference set
did the job it was built for on the first milestone that could use it.

**Two things M3 found, and both make later milestones cheaper:**

13. **The plan's single-exit rewrite was unnecessary and would have deleted
    something load-bearing.** A bare `return;` is indeed a compile error — the
    processor types `main` as `-> FragmentOutputs` — but `return
    fragmentOutputs;` is not, and Babylon prefixes `diagnostic(off,
    chromium.unreachable_code)` precisely so its own appended return can sit
    behind one. So all four early-outs survive as early-outs, which matters
    because `GodRays` and `MotionBlur` both document theirs as the second line
    of defence rather than decoration. **Item 5's `setMatrix3x3` risk is
    closed** as well: a debug WGSL pass handed `[1..9]` painted its columns
    back as `(1,2,3) (4,5,6) (7,8,9)`, so Babylon's repack into three
    vec4-aligned slots is right.
14. **A frozen reference frame cannot reach every branch, and the scaffold is
    the instrument for the rest — while it lasts.** A still camera is
    `strength = 0`, so no banked frame contains a single blurred pixel, and
    the god rays are wherever the moon happened to be. The check that covers
    them is the old GLSL source registered as a second effect and rendered over
    the same frozen frame with the same forced uniforms, every other pass off
    the camera: byte-identical on all three, on a forced six-degree yaw and a
    forced `presence = 1`. **This is the technique for M4 and M5** — it is
    strictly better than a bank diff because it holds the input fixed as well
    as the frame, and it dies with `glslScaffold.ts` at M6, which is an
    argument for using it hard now. Written up in `VERIFYING.md`.

**Two prose questions the plan flagged are answered rather than deferred.** The
trailing-`//`-with-a-`;` trap does NOT bite on the WGSL path — the processor
runs `RemoveComments` over the whole source before anything splits a line — and
`docs/rendering.md` and `VERIFYING.md` both say so where the trap is stated.
And the sampling rule the cel shader will need is settled early: **sample with
`textureSampleLevel`, not `textureSample`**, because an explicit LOD carries no
uniformity requirement at all and none of these textures has a mip chain — the
`DISABLE_UNIFORMITY_ANALYSIS` define is then only needed where a DERIVATIVE is
what you meant. `docs/rendering.md` gains a section on the dialect carrying
this, the `#define`-is-a-regex trap, the strided scalar array, the mat3x3
repack and the two halves of asking for WGSL at all.

## M4 landed

**The shared includes are WGSL, the grass is WGSL, and the tree has TWO fewer
deep imports than it started with.** `src/shaders/wgsl/includes.ts` registers
`celBand`, `celShadow`, `celProbe`, `celProbeBox`, `celDither` and our own
`celInstancesDeclaration` / `celInstancesVertex` into
`ShaderStore.IncludesShadersStoreWGSL`; `GrassShader` states
`shaderLanguage: ShaderLanguage.WGSL` and includes four of them. All sixteen
banked frames come back at 0.000/255, the four-map gate is clean, and both
branches a frozen frame cannot reach are diffed byte-identical against the
grass's own GLSL original.

**Four things M4 found:**

15. **A uniform ARRAY's size must be a literal or a `#define`, and a WGSL
    `const` will not do** — Babylon resolves the bound out of the preprocessor
    table when it lays out the leftover UBO, and a `const` is not in that
    table. That collides with item 4's own lesson, which is to prefer a `const`
    to a define because the processor implements a define as an un-anchored
    regex over the whole source. Both counts are already TypeScript constants,
    so the answer is to interpolate the NUMBER into the declaration and keep a
    real `const` for the loop bound — no define anywhere, and the trap cannot
    fire.
16. **The uniform read-back assertion the plan schedules here passes on both
    array shapes, exactly.** `array<vec3f, 16>` + `setArray3` and the strided
    `array<f32, 16>` both land the values written, at two indices each, painted
    out of a debug WGSL pass and read back off the canvas. Light plumbing is
    therefore ruled out before the cel fragment lands, which is what risk 2's
    mitigation asks for.
17. **Two WGSL rules the cel vertex stage will hit and the post passes never
    did**: a SWIZZLE cannot be assigned to (`worldPos.xz += …` becomes two
    component writes), and there is no `mat3(m4)` conversion (the upper-left
    block is spelled `mat3x3f(m[0].xyz, m[1].xyz, m[2].xyz)`). Both are in
    `docs/rendering.md` now.
18. **A forced branch that changes nothing is the TEST's fault twice as often
    as it is the shader's, and a byte-identical diff of two shaders both
    drawing the unforced picture is worth nothing.** Item 14's technique needs
    a control — the forced frame against the UNFORCED one — and without it this
    milestone would have banked two false passes: a pusher taken at an
    arbitrary index in an 11,313-blade instance buffer stands somewhere else on
    the map, and at the range a FIELD is seen from the mist and the fog are
    nine tenths of every grass pixel, so a point light lands under one LSB and
    rounds away. Written up in `VERIFYING.md` beside the technique it guards.

## M5 landed

**The cel shader is WGSL, the long pole is paid, and the tree now holds ZERO
deep imports into `@babylonjs/core`.** Both stages are hand-written WGSL in
`ShaderStore.ShadersStoreWGSL`, all six materials state
`shaderLanguage: ShaderLanguage.WGSL`, and the four-map gate, all sixteen banked
frames and a whole-scene diff against the shader's own GLSL original are clean.
The five shared includes did their job: the fragment reaches `celShadow`,
`celBand`, `celDither` and — under `CEL_GLASS` — `celProbe` and `celProbeBox`,
so nothing was transliterated twice.

**`getSkinned` was dead and deleting it paid for the deep-import gate.** The
plan asked for this to be confirmed rather than assumed; it has no caller
anywhere in the tree, which is what `CLAUDE.md`'s "no rigged character asset"
already implied. Out with it went `CEL_TEXTURED`, the `uv` attribute and the two
`ShadersInclude/bones*` imports — the last two subpaths in `src/`. So
`scripts/check-deep-imports.mjs` now runs from `npm run build`, and it went in
on the milestone that emptied the list because **an empty allow-list is the only
kind that stays empty**.

**Four things M5 found:**

19. **An implicit LOD is sometimes what was MEANT, and item 13's rule needed the
    exception written next to it.** "Sample with `textureSampleLevel` and never
    `textureSample`" is right for the shadow map and the post chain, and wrong
    for exactly three fetches: the ground albedo and its height map are
    `DynamicTexture`s built with mips and 8x anisotropy, and a `ReflectionProbe`
    cube generates a chain unless asked not to. On the height map it would have
    deleted an ARGUMENT as well — `perturbNormal` rests on two taps a texel
    apart converging with distance and says so as the reason it needs no
    explicit fade. So the cel fragment samples those three implicitly and
    carries `#define DISABLE_UNIFORMITY_ANALYSIS`, which it owed anyway for
    `fwidth` and `facetNormal`. `docs/rendering.md` now states the rule as being
    about what you meant.
20. **A reference bank taken from the deploy lid cannot hold a mesh with no
    vertex COLOUR buffer, and that is half the cel shader.** `bank.mjs` disables
    every rig and never spawns the player, so no banked frame contains a rig, a
    viewmodel, a grenade or an effect mesh — which is `vBaked` reading the
    disabled attrib's (0,0,0,1), the `vBaked.y > 0.5` branch NOT taken,
    occlusion at 1 and the sway at 0. Item 14's technique covers it at whole-
    scene scale: spawn, play, `g.pause()` (offline a pause genuinely holds the
    world, which `freeze` does not), twin every cel material off the GLSL source
    at the previous commit with its uniforms carried across, swap and diff. **0%
    of pixels on all four maps**, with 65-279 bufferless meshes in frame and the
    gloss, translucent, ink, ground, bump and both glass variants with them.
21. **A whole-scene material swap re-decides the VIEWMODEL's z-fights, and it
    reads exactly like a real finding.** `Game` sets its front-to-back
    comparator on group 0 only, so the viewmodel group keeps Babylon's
    `PainterSortCompare` — which orders by MATERIAL ID. Handing the weapon 54
    freshly minted materials moved 0.16% of the frame at worst 151/255, confined
    to the lower right. The control that settled it is finding 18's, pointed at
    the swap rather than at a forced branch: twins built from the shader UNDER
    TEST moved 0.159% at worst 147/255 — the same number to three figures. Skip
    `renderingGroupId !== 0` and nothing is lost, because the weapon is matte
    and glossy cel paint on bufferless meshes, which is what the rigs beside it
    already are.
22. **A variant nobody draws is a variant nobody compiles, so the plan's
    shader-compile smoke script is now `plans/webgpu-ref/shaders.mjs`** — it
    asks the FACTORY rather than the frame, hands every cached material a probe
    mesh and polls `isReady`, then reads `getCompilationInfo()` off every
    `GPUShaderModule` the page made. Zero driver errors on all four maps. It
    also turned up the one cel shape **no shipped map mints**:
    `CEL_GROUND_TEX` without `CEL_BUMP`, because both call sites happen to pass
    a height map. The script mints it rather than dropping it from the list,
    which is the difference between eight variants compiling and five.

## M6 landed

**The last three files are ported, the scaffold is DELETED, and there is no
GLSL left in `src/`.** `WaterShader` is hand-written WGSL in both stages;
`OutlineFog` patches `ShaderStore.ShadersStoreWGSL`; `EmissiveFog` answers
`isCompatible` for WGSL and only WGSL and injects `fragmentOutputs.color` and
`scene.vEyePosition`; `src/shaders/glslScaffold.ts` and its two call sites are
gone. All sixteen banked frames come back at 0.000/255, the four-map gate is
clean, `shaders.mjs` reports zero driver errors, and the water diffs
byte-identical against its own GLSL original on both water maps — with four and
eight point lights forced on, which no banked frame holds.

**With the water went the four GLSL constants** — `BAND_GLSL`, `SHADOW_GLSL`,
`PROBE_GLSL` and `DITHER_GLSL` — so `wgsl/includes.ts` holds the only copy of
each and `Dither.ts` holds its own source again beside its argument.

**Five things M6 found, and the first is the only real bug the whole port
produced:**

23. **An explicit LOD turns ANISOTROPY off, so "the texture has no mip chain"
    is NOT enough to make `textureSampleLevel(..., 0.0)` equal to
    `textureSample`.** The water's bed-depth map is a `RawTexture` built with
    `generateMipMaps: false` — one level, so an explicit level 0 looks free —
    and Babylon's WebGPU sampler cache still enables anisotropy for it, because
    `BILINEAR_SAMPLINGMODE` qualifies whether or not the texture carries mips
    (`useMipMaps || samplingMode === 2`) against the texture's default
    `anisotropicFilteringLevel` of 4. The explicit fetch is therefore a single
    bilinear tap where the GLSL got an anisotropic one, and `depth` changes in
    the last bits. **That is invisible everywhere except at the shoreline**,
    where `foamBand` is a 1.2 m smoothstep seen edge-on and about one pixel
    wide, so a last-bit difference flips whole pixels: 911 of them along
    Harrowmead's far shore, at up to 28/255 — small enough to pass the bank's
    tolerance and loud enough to be a real difference. Item 19's rule needed
    this written beside it: check the SAMPLER, not just the mip chain.
24. **A twin diff that is small but not zero is a THRESHOLD, and flattening
    thresholds finds it faster than reading the shader.** A few pixels moving by
    tens of LSB cannot be rounding — rounding is one LSB everywhere — so the
    move is to force the terms that make edges out of the picture, on both
    materials, one at a time. Zeroing the waves, the mirror blur, the caustics,
    the whitecaps, the flecks and the foam mask's scale changed nothing; the two
    uniforms that flatten `foamBand` took 911 pixels to six at 1/255 in one go,
    and the threshold named the term feeding it. Seven runs of one script,
    against reading four hundred lines of correct arithmetic.
25. **The plan's tripwire assertion would have passed for ever, and the route
    filter SILENCES the half that works.** `_glslang` and `_tintWASM` are
    initialised to `null` by `WebGPUEngine`'s constructor rather than left
    `undefined`, so `=== undefined` is never true of a broken build either.
    Worse, they are only ever SET when the CDN fetch succeeds — so on a page
    that aborts `**/*.babylonjs.com/**`, a stray GLSL shader leaves both null
    and the assertion cannot fire at all. Measured both ways with a one-line
    GLSL `ShaderMaterial` compiled by hand: without the abort, four files
    fetched and both fields set; with it, one request made, both fields null,
    and the material simply never becomes ready. **So the tripwire is two halves
    and a caller must fail on both** — `bootMap` records every request to the
    domain as well as aborting it, and `assertNoTranspiler` reads the engine.
    Both are asked by `gate.mjs` and by `shaders.mjs`.
26. **`OutlineFog`'s three invalidation rules survived the language change, and
    they were re-measured rather than re-read** — risk 1, discharged. Hollowmere
    with the player spawned and the pooled rigs built, back to the menu, into
    Greyfen: **1** outline effect in the cache, **0 of 438** outline draw
    wrappers holding a freed effect, and **one** distinct fog literal in the
    compiled fragment source — Greyfen's `0.7098, 0.7686, 0.6431`, equal to the
    `fogColor` the cel materials carry in the same frame. Against 534 of 642 and
    148 for the two bugs. The second cache layer the risk named has not bitten.
    One trap in writing that test: `setMap` refuses outside `menu`/`lobby`, so
    a test that calls it from `playing` measures the first map twice and reports
    clean.
27. **A backtick in a shader COMMENT is a backtick in a template literal.**
    Every shader here is a JS template literal, so prose that quotes an
    identifier the way this plan does ends the string — which arrives as a
    dev-server 500 on the module and a map that never boots, on one map before
    the others because that is the order they were run in. Same class of trap as
    the trailing-`//`-with-a-`;` one and it bites from the opposite side: that
    one is the preprocessor eating code, this one is JavaScript eating the
    shader.

**What M6 did NOT do**, deliberately, because both are listed elsewhere and
batching them is what makes them checkable: item 16's copy (`index.html`,
`README.md`'s browser requirement, `CLAUDE.md:62`'s "WebGL2") and M8's Tier 2/3
doc sweep. What is edited here is only what M6's own change made false.

## M7 landed

**Everything the depth-format change invalidated is re-derived, and the headline
is that `GLASS_DEPTH_UNITS` does not move.** -16 is now bracketed on both sides
by measurement, which it never was: -12 is the floor and -4 collapses the far
end outright, while -24 is a CEILING that costs the curtain wall's horizontal
transoms at 130 m. `plans/webgpu-ref/depth.mjs` is committed so the number can
be re-taken, because one boot flag decides it and nothing else in the repository
re-derives it.

**Six things M7 found, and the first two are the milestone:**

28. **The two outline z-offset geometry rules came APART, and only measuring
    both would have shown it.** They are the same offset and the plan treats
    them as one item. Re-derived: the ROAD-MARKING rule still bites and bites
    hard — with the carriageway's ink put back at the shipped 45 mm, not one
    lane marking survives at any range, against 57% surviving out to 71 m at
    3 cm and 89% out to 187 m at 1 cm. The THIN-DECK rule's fault does not
    reproduce at all: `boardDeck` thinned back to the 0.14 m slab that produced
    it, Greyfen rebuilt, the great hall photographed — **byte-identical to the
    shipped 0.54 m box**. What separates them is the SEPARATION, and the ruler
    that says so is `depth.mjs zoffset`: the offset is worth about a millimetre
    per metre of range, so 20 mm between a marking and its slab's shell is
    beaten from 20 m out and 185 mm between a deck's top face and its own would
    need 185 m of hall. The rule is KEPT — it costs nothing, it is the geometry
    a walked surface wants anyway, and `stencil: true` would put the format back
    and the fault with it.
29. **A rig that fails to reproduce a fault proves nothing about the fault, and
    it cost most of a milestone to stop believing one.** A lone box in the air
    with an ink shell on it does not go flat at 0.06 m thick or under an 0.8 m
    shell — which reads exactly like "the rule is dead" and is worth nothing,
    because the manor's deck is in a merged block group standing on a podium.
    The in-situ reproduction is what settled it, and the assertion that makes a
    null result mean anything is checking the mesh is INKED first
    (`renderOutline`, `outlineWidth`, `outlineColor` on the block group).
30. **A frozen vantage holds no shadowed pixel until the shadow window is pushed
    to it, and every shadow reading comes back 0.000%.** The window follows the
    player, `updateWorld` does not run under the deploy lid the reference poses
    are taken from, and outside it `shadowVisibility` returns FULLY LIT. With
    the push in, the four-tap kernel's containment is 0.12/0.60/0.39/0.42% of
    the frame across the four maps, peaking 31–119/255, over frames that are
    32.7/40.0/7.2/26.8% in shadow. The control that catches the trap is the
    darkness term: set it to zero and if THAT comes back 0% too, nothing is
    being measured.
31. **The band's `fwidth` widening had to change maps to be measurable.**
    Greyfen was re-cut as a closed canopy since the number was taken, so its
    valley floor sits in deep shade where the whole effect is under 0.2% of
    pixels; Coldharbour's lit streets are where it reads now — 0.00% off a 4x
    reference with the relief off, 2.91% with the relief and the widening back
    at the fixed 0.15, 0.85% as shipped. The ordering holds and the absolutes
    are not comparable, because the frame the originals were taken in no longer
    exists. The technique is worth keeping: edit the registered include, then
    push a dummy define onto every cached material — a re-registered include
    alone hands back the effect that is already cached.
32. **The ink luma's absolute bound is not a WebGPU question and could not have
    been one.** `outlineInkFor` is CPU arithmetic over the palette and the
    ambient, so the tint cannot have moved with the backend; re-read, the
    brightest is 0.082 on a near-white Coldharbour façade against the 0.054 the
    contract records, and two of the four maps have been re-cut since that
    figure was taken. What the bound actually claims is RELATIVE — `ink <
    surface` per channel — and that is the sentence worth re-deriving.
33. **`FINDINGS.md` #10 answers to the SECOND arm of its own test, and this
    plan's own 138 ms does not reproduce.** The entry asks for the reflection
    bake on real hardware, says a cull is not worth its failure mode under
    ~150 ms and that over ~500 ms the shape to reach for is fewer PROBES.
    Measured by forcing a re-bake with every pipeline already compiled, the
    shipped forty-probe bake is **~1.4–2.1 s**, and it scales almost linearly
    with the render list (486 meshes 2124 ms, 243 meshes 813 ms, 49 meshes
    109 ms) — so it is draw-call bound on hardware as well as under SwiftShader,
    it is still a build cost and never a frame cost, and the answer is fewer
    probes. **The 138 ms this plan and `VERIFYING.md` both record is not
    repeatable**: in the same gate run that puts Coldharbour's forty at 1151 ms,
    Hollowmere's four cost 76 ms — the same 19 ms a probe — and the box is only
    ~20% off the frame rates recorded beside that figure, which is nowhere near
    10x. The likeliest reading is that the 138 ms frame was not the frame the
    bake happened on, but that is not demonstrated and it is now the open thread
    in #10. Every quote of the number is corrected to say so rather than
    deleted. #3, #4, #5, #12 and #13 have a status line each rather than a
    deletion, as `FINDINGS.md:6-12` requires: #4's MSAA reading is re-taken as a
    WebGPU sample count (1 as shipped, measured 4 with `antialias: true`, and
    the "66 MB at 1080p" is exactly right for `bgra8unorm` + `depth32float`),
    and #13's title question is answered as "nothing measurable" while its
    before/after stays headless.

**What M7 did NOT do**, deliberately: the Tier 2/3 doc sweep and item 16's copy
are still M8's, and the five source headers still naming WebGL2 or transform
feedback (`Atmosphere.ts`, `GrenadeSystem.ts`, `OutlineFog.ts`, `CelShader.ts`)
are in that sweep rather than here. What is edited here is only what M7's own
measurements made false.

## M8 landed

**The doc sweep is done and the four-map sign-off is clean on every instrument
this plan built.** Nothing in the tree still tells a reader the game runs on
WebGL2, the two Tier 2 documents that owed a paragraph have one, and the
migration is complete.

**The sign-off, run in this order against the final tree:**

| gate | result |
| --- | --- |
| `npm run typecheck` | clean, client and server |
| `npm run parity` | 4/4 maps, all 17 fields |
| `gate.mjs` | 4/4 clean — warm 142.7 / 143.8 / 47.9 / 56.3 fps, median 6.9 / 6.9 / 20.7 / 17.6 ms, probes 4 / 2 / 40 / 2 |
| `shaders.mjs` | every shader compiled clean on all four; 6 cel variants reached, zero driver errors |
| `bank.mjs --check` | **16/16 frames at 0% of pixels, mean 0/255, worst 0/255** |
| `npm run build` | clean; `HavokPhysics-*.wasm` is the only binary in `dist/` |

**Both halves of the transpiler tripwire fired clean in both scripts**, which is
the offline promise discharged: no request to `**/*.babylonjs.com/**` on any of
the four maps, and the engine's two fields still null after a sweep that forced
337 cel materials to compile. The bundle contains the STRING
`cdn.babylonjs.com` — that is Babylon's own lazy-fetch code, which ships whether
or not anything calls it — and `docs/build.md` already says the assertion is a
runtime one for exactly that reason.

**Coldharbour's bake came back at 1926 ms in the gate run**, which is M7's
finding 33 confirming itself a third time. The 138 ms is dead; do not restore it.

**Five things M8 found, and the last one is the only thing this milestone
leaves owed:**

34. **`index.html` had nothing to change, and item 16 named the wrong file for
    half of its own row.** The boot SCREEN is markup in `index.html`; the boot
    COPY is three string literals in `main.ts`, and they were rewritten at M1
    with the third failure branch. So the row is `README.md` and `FILES.md`
    only. Worth recording because the next person auditing this plan against
    the tree will otherwise go looking for a WebGL2 string in the HTML and
    conclude the sweep missed one.
35. **Two of the Tier 2 entries were ADDITIONS, not edits, which is why a
    grep-driven sweep would have reported the tree clean.** `docs/states.md`
    and `docs/game.md` contained no `WebGL2`, no `GLSL` and no `engine` — the
    thing that changed there is that a fact became true, not that a sentence
    became false. `states.md` now opens on the two awaits before any state
    exists; `game.md` now has the constructor's two injected arguments and why
    it is not a `static async create()`. **A doc sweep driven by `grep` finds
    the premises that moved and none of the ones that arrived.**
36. **Seven of the nine Tier 3 headers were already right**, each done by the
    milestone that made it wrong — `main.ts`, `Game.ts`, `CelShader.ts`,
    `OutlineFog.ts`, `EmissiveFog.ts`, `Dither.ts` and `PhysicsWorld.ts`. Only
    `Atmosphere.ts` and `GrenadeSystem.ts` were left, exactly the two M7 named.
    The rule that produced that ("what is edited here is only what this
    milestone's own change made false") is worth keeping for the next migration:
    it front-loads the sweep into the milestones that can still check their own
    claims.
37. **What `docs/editor.md` actually owed was a TIME beside a draw count.** The
    plan's Tier 2 row named the file and not the reason. The editor refuses the
    reflection bake, and the argument for that refusal was stated in draw calls
    (~300,000) with no clock on it — which is M7's finding 33 arriving in a
    second document. The shipped 40-probe bake is ~1.4–2.1 s and scales with
    the render list; the editor's is 82 probes over 610 unmerged meshes, larger
    by both terms. That is stated there as DERIVED from `FINDINGS.md` #10 and
    explicitly not as a new measurement of the editor, which is the honest
    shape when the ratio is known and the number is not.
38. **`CLAUDE.md` cannot be brought under ~850 lines by cutting argument,
    because there is no argument left in it to cut** — and this is the one
    thing M8 does not discharge. The file was **877 before this milestone
    touched it** and is **901 after**; M8's own additions are 24 lines (the
    engine and its reach cost, the two WASMs, the WGSL/`shaderLanguage` and
    sampler-bind rules, `npm run shots` needing a GPU, and `VERIFYING.md` being
    per-machine now). The remedy the file prescribes for its own overflow is to
    cut the ARGUMENT in a companion-backed summary and never a rule — but read
    end to end, the summaries are rules already: every paragraph in the
    vehicles, anti-tank, bots, deaths, weapons and multiplayer sections is a
    load-bearing sentence with its argument already moved out to the companion.
    The overflow came in with the armour work (~790 → 877), not with the port.
    **So the compression is a real editorial pass on those sections, by whoever
    owns them, and not something a docs sweep should do by guessing which
    sentence is safe to delete.** Recorded here rather than done quietly the
    wrong way.

---

## Verified groundwork

Checked against the installed `@babylonjs/core` 9.19.1. These change the shape of
the work and several contradict the obvious assumptions.

**Babylon's WGSL is preprocessed, not raw.** Declarations are
`attribute position: vec3f;` / `varying vUV: vec2f;` / `uniform offset: f32;`,
accessed as `vertexInputs.X`, `fragmentInputs.X`, `uniforms.X`,
`vertexOutputs.position`, `fragmentOutputs.color`. `#include<>`, `#ifdef` and
`#define` all survive. Includes live in `ShaderStore.IncludesShadersStoreWGSL`.

**Every Babylon shader we lean on has a WGSL twin** — verified present in
`ShadersWGSL/`: `outline.*`, `default.*`, `glowMapGeneration.*`,
`glowMapMerge.fragment`, `shadowMap.*`, `fxaa.fragment`, `postprocess.vertex`,
`gpuRenderParticles.*`, `gpuUpdateParticles.compute`. `GPUParticleSystem` routes
to `ComputeShaderParticleSystem` on WebGPU (`Particles/gpuParticleSystem.pure.js:769-778`),
already registered by the barrel — **no import change** for `Atmosphere.ts` or
`GrenadeSystem.ts`, only runtime verification.

**`OutlineFog` survives far better than expected.** All four anchors it patches
exist verbatim and in the same order in `ShadersWGSL/outline.{vertex,fragment}.js`,
with `#include<clipPlaneVertex>` still sitting after `worldPos` and
`vertexOutputs.position` are assigned. `patch()` (`OutlineFog.ts:89-125`) keeps
its structure; only the injected snippets change. `_compiledEffects` is keyed
identically (`webgpuEngine.pure.js:1469`), so the `"outline+outline@"` prefix
scan survives. **WGSL has `transpose()` but no `inverse()`** — the
eye-from-`viewProjection`-rows trick stays, for a new reason that must be
written down or someone will undo it.

**The uniform-array trap is the opposite of the obvious one.**
`UniformBuffer.updateUniformArray` (`Materials/uniformBuffer.js:519-550`)
already zero-fills each element up to the recorded stride, so
`array<vec3f, N>` + `setArray3` is **correct as-is — do not repack**. The real
trap is scalar arrays: `_generateLeftOverUBOCode` rewrites `array<f32, N>` into
a `@size(16)` strided struct and patches accesses with the **non-greedy** regex
`name\s*\[(.*?)\]` → `name[$1].el` (`webgpuShaderProcessorsWGSL.pure.js:434-441,
539-544`). `pointRange[i]` is safe; `pointRange[idx[j]]` silently corrupts.

**Disabling stencil changes the depth format**, `depth24plus-stencil8` →
`depth32float` (`webgpuEngine.pure.js:717`), and WebGPU defines the `depthBias`
unit differently for float formats. So `GLASS_DEPTH_UNITS = -16`
(`CelShader.ts:1163`) and `OutlineRenderer`'s `setZOffsetUnits(-4)` are not
"needs re-tuning" — **they are measured in a different unit**, and the two
geometry rules built on the latter (`docs/rendering.md:941-952`, `:953-981`)
must be re-derived.

**`#define DISABLE_UNIFORMITY_ANALYSIS` is required on day one.** WGSL's
uniformity analysis rejects `dpdx`/`dpdy`/`fwidth` and implicit-LOD sampling in
non-uniform control flow — exactly `facetNormal()`, `band()`'s `fwidth`, and
texture fetches inside `#ifdef CEL_GROUND_TEX`. The processor honours the define
(`webgpuShaderProcessorsWGSL.pure.js:332/414`). Without it you get a wall of
errors that read like real bugs.

**A bare `return;` in a fragment `main` is a compile error** — the processor
appends `return fragmentOutputs;` to a function typed `-> FragmentOutputs`
(`:413`). Four early returns need single-exit rewrites: `GodRays.ts` (1),
`HorrorPost.ts` (1), `MotionBlur.ts` (2).

**A `StandardMaterial` picks WGSL FOR ITSELF under WebGPU, so both material
plugins fail before their own milestone.** `Material._createUniformBuffer` sets
`_shaderLanguage = WGSL` whenever `engine.isWebGPU && !this._forceGLSL`, and
`MaterialPluginBase.isCompatible` returns true for GLSL and false for
everything else — so `MaterialPluginManager._addPlugin` THROWS
(`materialPluginManager.pure.js:40`) the first time `getEmissive()` attaches
`EmissiveFog`, which is inside `Game`'s constructor. **Measured at M0, not
predicted.** `StandardMaterial.ForceGLSL = true` is the scaffold; it is one
line in `Game`'s constructor and it comes out with item 12.

**`OutlineRenderer` does the same and has NO equivalent override**
(`outlineRenderer.pure.js:44-56`: `_shaderLanguage = GLSL`, then
`if (engine.isWebGPU) _shaderLanguage = WGSL`, with no flag between). So the
outline pass reads `ShadersStoreWGSL` while `OutlineFog.patch()` writes
`ShadersStore`, and the patch silently does nothing. **This bites at M1** — the
first lit scene — rather than at M6 where item 11 sits. Either patch
`_shaderLanguage` back to GLSL as a second scaffold line, or bring item 11
forward. It has not been tried yet.

**glslang and twgsl are lazily fetched from a CDN, and the HOST IN THIS PLAN WAS
WRONG.** Not `preview.babylonjs.com` — **observed at M0, four files off
`cdn.babylonjs.com/v9.19.1/`**: `glslang/glslang.js`, `glslang/glslang.wasm`,
`twgsl/twgsl.js`, `twgsl/twgsl.wasm`. They load only when a GLSL shader actually
reaches the backend, which is why the M0 boot (menu only, no map, no shader
compiled) never touched them and the first round fetched all four.

**This cost a false PASS already** and is the cautionary tale for the tripwire
below: M0's gate asserted "no CDN fetch during boot" against
`preview.babylonjs.com` and passed — while watching a host that is never
contacted. **Match on `**/*.babylonjs.com/**`**, not on a hostname anyone typed
from memory. If one shader is missed at M6, the game silently pulls two WASMs
off a CDN at first draw, breaking `docs/pwa.md`'s offline promise. **This must
become an asserted invariant** — and the assertion must be `engine._glslang`
and `engine._tintWASM` being `undefined` AFTER a sweep that actually compiled
every shader, because a route filter only proves what was requested and a
never-compiled shader requests nothing.

---

## Milestones

The ordering rule: **separate engine-level failures from shader-language
failures and pay them in that order.** They have different debugging techniques
and mixing them is what turns four weeks into ten.

The lever: **GLSL still compiles under `WebGPUEngine`** (via glslang→SPIR-V→twgsl).
So the engine swap lands first with all nine shaders still in GLSL. This is
**scaffolding, demolished at M6** — not a fallback, not a shipped transpiler.

| M | Milestone | What it proves |
| --- | --- | --- |
| **M0** ✅ | `WebGPUEngine` + boot gate on `navigator.gpu`. Menu reached. | Boot path, `main.ts`, `__celshock` timing. **Menu RENDERS was not provable** — see Verification |
| **M1** ✅ | **First lit scene** — Hollowmere end to end on GLSL sources. `OutlineRenderer` scaffolded back to GLSL; item 11 stays at M6 | RTTs, R8 depth field, 14 `DynamicTexture`s, `setRenderingOrder`, `GlowLayer`, pipeline, compute particles, `setHardwareScalingLevel`, blend/depth state — all confirmed. **The 40 cube probes did NOT come with it**: Hollowmere has no glazed block, and Coldharbour's bake kills the device here (finding 7), so they move to M2 on hardware |
| **M2** ✅ | All four maps up. **The GLSL-under-WebGPU reference set is banked** — sixteen frames, the four menu vantages plus twelve chosen for the shader path each puts in frame (`plans/webgpu-ref/vantages.mjs`). Coldharbour's 40 cube probes bake in one frame | The most valuable artefact of the migration — later diffs isolate *shader* errors by construction. **Four frames could not have done it**: the backdrops hold no glazing at range, no lamp-lit street, no gust and almost no water |
| **M3** ✅ | **First WGSL** — the three post fragments (`HorrorPost`, `GodRays`, `MotionBlur`) | Dialect, `PostProcess` wiring, `onApply` binding. Standalone, no attributes, no defines. **The single-exit rewrite was not needed** — `return fragmentOutputs;` is legal and the early-outs stay. Sixteen banked frames at 0.000/255, and the three forced branches a frozen frame cannot reach diffed byte-identical against their own GLSL originals |
| **M4** ✅ | **First WGSL surface** — the five shared includes, our own `celInstances` pair, then `GrassShader` | Include strategy, `instances*` twin, `MAX_PUSHERS`, `array<vec3f,N>` + `setArray3`. Sixteen banked frames at 0.000, the read-back assertion exact on both array shapes, and the pushers and the point lights — neither of which is in any banked frame — byte-identical against the GLSL original. **A uniform array's size must be a literal or a `#define`**, which cuts against item 4 |
| **M5** ✅ | **`CelShader`** — both stages WGSL, landed once. `getSkinned` deleted (dead), taking `CEL_TEXTURED` and the last two deep imports with it | The long pole: ~620 shader lines, 8 materials, 6 defines. Sixteen banked frames at 0.000, four-map gate clean, and a whole-scene diff against the GLSL original at 0% on all four maps — which is where the branches a banked frame CANNOT hold live: every rig, the viewmodel and every effect mesh carries no colour buffer |
| **M6** ✅ | `WaterShader` → `OutlineFog` → `EmissiveFog`. **Scaffold deleted**; the tripwire is TWO halves, because the aborted route silences the engine-state one and the fields are `null` rather than `undefined` | Complete. Sixteen banked frames at 0.000, four-map gate clean, `shaders.mjs` clean, the water byte-identical against its own GLSL original with 4 and 8 lamps forced, and the outline's two prose regression tests re-measured at 1 cached effect / 0 of 438 freed / 0 stale |
| **M7** ✅ | Re-tune `GLASS_DEPTH_UNITS`, outline z-offsets, MSAA/memory. Re-measure everything `FINDINGS.md` claims | Complete. -16 is CONFIRMED and now bracketed on both sides; the two outline geometry rules came APART, one still biting and one whose fault will not reproduce; MSAA re-read as a sample count; the shadow kernel, the ink luma and the band's `fwidth` all re-taken; six `FINDINGS.md` entries given a status line, and the reflection bake measured at ~1.4 s rather than the 138 ms this plan recorded |
| **M8** ✅ | Docs, four-map parity sign-off | Complete. Every Tier 1/2/3 document swept; two of them needed a paragraph ADDED rather than edited, which a grep would have missed. `typecheck`, `parity`, `gate.mjs`, `shaders.mjs`, `bank.mjs --check` (16/16 at 0.000) and `npm run build` all clean, and both halves of the transpiler tripwire fired on all four maps. **One thing is owed and is not the port's**: `CLAUDE.md` is 901 lines against a ~850 bar it was already over before M8 — see finding 38 |

M1 is the real first-light gate. M5 is the long pole. M7+M8 are about a third of
the calendar. **All nine are landed.**

**The scaffold was one FILE from M1 and is now deleted** —
`src/shaders/glslScaffold.ts` held `StandardMaterial.ForceGLSL`, the outline
renderer's language, and the twgsl output repair (findings 4 and 5), with two
call sites. The demolition was three steps and the ORDER was load-bearing:
`EmissiveFog` first (item 12), then the file and its two calls, and only then
the tripwire. Deleting it first turns every `StandardMaterial` in the game WGSL
at once, which is a different milestone's work arriving unannounced — and
measured, it is a boot failure rather than a rendering one, because
`_addPlugin` throws on the mismatch inside `Game`'s constructor.

---

## Work breakdown

| # | File | Work | Days |
| --- | --- | --- | --- |
| 1 ✅ | `main.ts` | `hasWebGL2` → async `hasWebGPU`; new copy; third boot branch; header rewrite (4 paragraphs name WebGL2). **Also added `@webgpu/types`** — `navigator.gpu` is not in TypeScript's DOM lib, and tsconfig's `types` went `[]` → one entry so the list stays CLOSED | 0.5 |
| 2 ✅ | `src/core/Game.ts:698` | Engine becomes a **constructor argument** like `havok` — see below | 1 |
| 3 ✅ | `src/shaders/HorrorPost.ts` | First WGSL in the tree; budget dialect learning here. **Also moved the three passes to `PostProcess`'s options form**, which is where `shaderLanguage` can be stated at all | 1 |
| 4 ✅ | `src/shaders/GodRays.ts` | `#define SAMPLES` survives — but a WGSL `const SAMPLES: i32` is better and is what landed, because the processor implements a define as an UN-ANCHORED regex over the whole source | 0.5 |
| 5 ✅ | `src/shaders/MotionBlur.ts` | **`setMatrix3x3("reproject")` was the risk and is closed** — `mat3x3f` is three vec4-aligned columns, Babylon repacks correctly, and it was measured by painting the columns out of a debug pass rather than reasoned about | 1 |
| 6 ✅ | `src/shaders/wgsl/includes.ts` *(new)* | BAND / SHADOW / PROBE / PROBE_BOX / DITHER as WGSL includes, plus the `celInstances` pair item 8 needed. The five carry the ARGUMENT now and the GLSL originals carry a pointer, so there is one copy of each rather than two for three milestones | 1.5 |
| 7 ✅ | `src/shaders/Dither.ts` | Body cannot move until the cel and the water go, so the WGSL twin is in (6) and this keeps the argument — the 60-line header, plus the three shaping decisions that were on the constant and are now above it | 0.25 |
| 8 ✅ | `src/shaders/GrassShader.ts` | Both stages; our own `celInstances` twins rather than two new deep imports; `#extension` and `precision` both gone. The counts are interpolated rather than `#define`d — see finding 15 | 1.5 |
| 9 ✅ | `src/shaders/CelShader.ts` | **The long pole**, and it came in under its estimate because M3 and M4 had already paid for the dialect. 6 defines, 2 albedo paths (the third went with `getSkinned`), glass composite, `facetNormal()`. `shaderLanguage` on 6 sites, not 7 | 5 |
| 10 ✅ | `src/shaders/WaterShader.ts` | Wave field, `domeAt`, Schlick, foam. The `out` params became a returned struct (WGSL has none), and the ONE judgement call in it — an explicit LOD on the bed-depth map — was the port's only real bug; see finding 23 | 2.5 |
| 11 ✅ | `src/shaders/OutlineFog.ts` | `patch()` kept its structure exactly; retargeted to `ShadersStoreWGSL`, `VERTEX_BODY` rewritten, the varying declared in **both** stages — whose ORDER is what keeps the two `@location`s in step. `dropCompiled` needed no change and was re-verified rather than rewritten | 2 |
| 12 ✅ | `src/shaders/EmissiveFog.ts` | `isCompatible` answers WGSL and only WGSL — there is no GLSL path left in this game to be compatible with — and it landed with the `ForceGLSL` line it stood in for. `gl_FragColor` became `fragmentOutputs.color`; `vPositionW` is `fragmentInputs.` but `vEyePosition` is **`scene.`** and not `uniforms.`, because it lives in the SCENE block. The non-UBO `fragment:` declaration string went with them: WebGPU has no such path, and the marker it replaces is not in Babylon's WGSL `default.fragment` at all, so the text was being dropped on the floor. | 1 |
| 13 ✅ | `Atmosphere.ts`, `GrenadeSystem.ts` | No code change was needed. Confirmed on the real backend: every particle system's platform is `ComputeShaderParticleSystem`, `randomTextureSize` is 4096 (8192 for the motes), and the ash field is 14,934 at steady state. **Both headers are rewritten at M8**: the class name is the only thing that did not change, since `GPUParticleSystem` routes itself to `ComputeShaderParticleSystem` on a WebGPU engine | 0.5 |
| 14 ✅ | `WaterSystem`, `ShadowSystem`, `ReflectionSystem`, `Sky` | No code change was needed. Confirmed: 2048² shadow map, `bias`/`normalBias` both 0, 408 casters, `refreshRate` 0; 40 cube probes at 128², all refresh-once; the R8 depth field at M1. Verify R8 texture, shadow depth format + `bias = 0`, 40 cube RTTs + face Y-flip, `DynamicTexture.update(false)` | 1 |
| 15 ✅ | `src/entities/ViewModel.ts:203-204` | Confirmed at M1 and re-read here — `depthFunction` 519 (`ALWAYS`) and `forceDepthWrite` on the kit backdrop in group 0. Verify `ALWAYS` + `forceDepthWrite` + `alphaIndex: Infinity`; WebGPU bakes depth state into the pipeline rather than setting it | 0.5 |
| 16 ✅ | `README.md`, `FILES.md` | Requirements and the no-fallback sentence; two rows. **`index.html` was not in it**: the boot SCREEN is its markup but the boot COPY is three literals in `main.ts`, rewritten at M1 with the third failure branch — see finding 34 | 0.5 |

**~20 engineer-days of porting**, before measurement or docs.

---

## Key decisions

### Shared GLSL constants → registered WGSL includes

`BAND_GLSL`, `PROBE_GLSL`, `PROBE_BOX_GLSL`, `SHADOW_GLSL` and `DITHER_GLSL` are
template-interpolated into three consumers today. Move the **source text** into
`IncludesShadersStoreWGSL` entries in a new `src/shaders/wgsl/includes.ts`.

Why, specifically for WGSL: `SHADOW_GLSL` and `PROBE_GLSL` declare *uniforms and
samplers*, not just functions. Under WebGPU those feed the auto-generated
`LeftOver` UBO struct, so an inconsistency between three copies is no longer a
compile error in one shader — it is a **different UBO layout**, failing as wrong
values with no diagnostic.

**Namespace every entry with a `cel` prefix.** Babylon registers includes
first-writer-wins, so an unprefixed `dither` or `band` would silently shadow or
be shadowed. The prefix is the collision guard, not style.

**Keep `SHADOW_UNIFORM_NAMES` (`CelShader.ts:346`) and `PROBE_UNIFORM_NAMES`
(`:255-259`) exactly as they are** — they are the half of the contract that must
stay in TypeScript, and `docs/rendering.md:704-717`'s "registering is half the
contract" argument is then unchanged.

**Registration order is newly load-bearing**: an include must exist before the
first *effect compile*. Import `includes.ts` for side effect at the top of
`CelShader.ts`, `GrassShader.ts` and `WaterShader.ts`, with the same
can't-be-tree-shaken comment the existing bones imports carry.

### Uniform arrays — do not repack

Declare `array<vec3f, MAX_POINT_LIGHTS>` and keep `setArray3`. Babylon pads to
stride already (verified). Repacking into `vec4` would mean rewriting
`setPointLights` (`CelShader.ts:1796-1830`) whose `Math.fround` guard is
delicately argued and has broken silently once, plus the same change in
`GrassSystem` and `WaterSystem` — and the UBO layout is identical either way
(both 256 bytes).

Three rules instead:
1. **Never index a strided array with an expression containing `]`** (the regex
   above). `pointRange[i]` only.
2. Loop with an `i32` counter. WGSL allows non-constant bounds and dynamic
   uniform indexing, so the fixed-trip-count-plus-float-guard dance is
   unnecessary — but keep the fixed count if you want the instruction schedule
   the current tuning was measured against.
3. **Write the read-back assertion once, at M4.** Set `pointPos[3]` and
   `pointRange[3]` to known values, output them as colour from a debug cel
   variant, `readPixels`. Ten minutes, and it turns "lighting looks subtly
   wrong" into a boolean *before* the hard shader lands.

One claim goes stale: `CelShader.ts:1792`'s "`setArray3` bypasses Babylon's own
value cache and re-pushes on every bind" stops being true —
`updateUniformArray` has a change test. Fix the comment rather than leaving it.

### Deep imports — end with four fewer, not four more

The four grandfathered imports (`CelShader.ts:58-59`, `GrassShader.ts:25-26`)
point at `Shaders/ShadersInclude/*`. The WGSL twins are four *new* subpaths,
which `CLAUDE.md:77-82` and `docs/build.md:100-125` forbid absolutely.

- **Bones: `getSkinned` was dead and is gone (M5).** Confirmed by grep rather
  than assumed, which is what `CLAUDE.md:83-87` already implied. Deleting it took
  `CEL_TEXTURED`, the `uv` attribute and both bone includes with it.
- **Instances genuinely load-bearing** (the grass field is thin-instanced):
  register our own `celInstances` (~short — read `world0..world3`, build
  `finalWorld`). Header names the Babylon file and version it mirrors, so an
  upgrade has something to diff.
- **A grep gate runs from `npm run build`** beside `check-collision.mjs`
  (`scripts/check-deep-imports.mjs`, M5), failing on any `@babylonjs/core/`
  subpath in `src/` and `main.ts`. This is the only absolute rule in the project
  that `tsc` cannot see and that reproduces on someone else's machine. It went in
  on the milestone that emptied the list: an empty allow-list is the only kind
  that stays empty. `server/` is out of scope — it imports `NullEngine` by
  subpath on purpose.
- **Leave `optimizeDeps` alone** (`vite.config.ts:257-277`). Do not add an
  `include:` workaround — same optimizer, third side, and `docs/build.md`
  already records both other failure modes.

### Boot and engine

**Keep `Game`'s constructor synchronous; inject the engine.**

```ts
// main.ts
const engine = new WebGPUEngine(canvas, { antialias: false, stencil: false });
await engine.initAsync();
new Game(canvas, havok, engine);
```

**NOT `WebGPUEngine.CreateAsync`, and this is a correction rather than a
preference.** That helper is `new WebGPUEngine(...)` plus `initAsync()` wrapped
in `new Promise((resolve) => …)` with **no `reject`**
(`webgpuEngine.pure.js:234-237`, Babylon 9.19.1). A rejected init therefore
never settles: the `await` waits forever, the `catch` around it is unreachable,
and the failure surfaces as an unhandled rejection behind a boot screen still
saying "loading" — which is the exact failure that screen exists to prevent,
and it is the failure branch below. Calling the two halves by hand is the same
code path and rejects properly. If a later Babylon fixes the wrapper this can
collapse back to one line; check for the missing `reject` before assuming it
did.

Not `static async Game.create()`. `VERIFYING.md:18-26` and ~40 other places rest
on `window.__celshock` existing *when the constructor returns* with every pool
non-null on first `evaluate`. `main.ts` already awaits `loadHavok()` and already
owns the two-things-the-game-cannot-start-without argument (`:28-35`), so a
third await beside it is the shape that file is written for — and it makes the
engine the same move `havok` already made, which `Game.ts:675-681` argues for
verbatim. `stencilEnabled` already defaults false, matching the current choice.

**Gate:** `!!navigator.gpu && !!(await navigator.gpu.requestAdapter())`, placed
**before** `loadHavok()` — a machine with no WebGPU shouldn't download 2 MB of
physics to be told no. Note in the header that the throwaway-canvas trick
(`main.ts:46-51`) is *replaced*, not edited: `requestAdapter()` touches no
canvas. One sentence, or the next reader will hunt for it.

**Three boot-failure branches now, and the third is new in kind**: the adapter
exists but `initAsync()` rejects. Today that lands in the generic catch
(`main.ts:112-118`, "reloading may fix it" — advice that cannot work). It
deserves its own message for the reason the Havok one has one. ✅ Done, and
**tested by stubbing `GPUAdapter.prototype.requestDevice` to reject once** in
an `addInitScript` — worth keeping, because this is the branch that was
unreachable under `CreateAsync` and a smoke test is the only thing that would
have caught it.

---

## Verification

**SETTLED AT M0, and the answer is half good.** Measured, not assumed — the
probe scripts are in the M0 scratchpad.

- **`--enable-unsafe-webgpu` and nothing else.** The default
  `chromium_headless_shell` DOES carry Dawn's SwiftShader backend, so
  `channel: "chromium"` buys nothing; both binaries behave identically.
  `--enable-features=Vulkan`, `--use-angle=swiftshader`,
  `--use-webgpu-adapter=swiftshader` and `--enable-unsafe-swiftshader` each
  changed nothing either way. Without the one flag, `navigator.gpu` is present
  and `requestAdapter()` returns null — which is indistinguishable from "this
  browser has no WebGPU", so a script with no flag reports a boot-gate failure
  that is its own doing.
- **`navigator.gpu` is SECURE-CONTEXT-only, so probe on a real origin.** On
  `about:blank` it is `undefined` and the first hour is spent debugging a
  browser that is fine. `http://localhost` and `http://127.0.0.1` both count.
- **A WebGPU CANVAS cannot be rendered to on a machine with no GPU, and no flag
  fixes it.** `getContext("webgpu")` and `configure()` both succeed, and then
  the FIRST `getCurrentTexture()` destroys the device — `device.lost` resolves
  `reason: "destroyed"`, Babylon reports "WebGPU context lost", tries to
  restore, and dies with "Could not retrieve a WebGPU adapter". Measured across
  seven flag sets, both binaries, headless AND headed, and all three canvas
  kinds (DOM, detached `OffscreenCanvas`, `transferControlToOffscreen`): **one
  frame, every time.** Offscreen rendering into a `device.createTexture()`
  colour attachment is untouched — 480 frames in 8 s — so the broken piece is
  the swap chain specifically, not WebGPU and not SwiftShader. `ls /dev/dri`
  tells you which machine you are on.

**What that leaves, and it is more than it sounds.** The DOM and the whole
simulation stay testable — M0's gate proved the boot path, `__celshock`
timing, the state machine, every pool, all three failure branches and the depth
format without a single presented frame. Rules, damage arithmetic, nav,
`ScoreBook`, the screens and the recoil envelope are all main-thread and none
of them needs a picture.

**What it rules out is the entire visual half of this plan**: the M2 reference
set, every per-variant diff at M5, the `GLASS_DEPTH_UNITS` sweep at M7, the ink
luma and `fwidth` re-measurements, and `npm run shots`. **Those need real
hardware, and that is now a certainty rather than a risk.** Schedule M2 against
a GPU machine or the reference set does not exist — and without the reference
set, M5's failure mode is exactly the one risk 2 describes.

**That gate has since been lifted and the paragraph above is kept only because
its reasoning still holds on the slow machine** — see *The hardware gate is
lifted*. The reference set exists, `npm run shots` runs, and the harness that
takes both is committed at `plans/webgpu-ref/`. What has NOT changed is the
consequence for anyone working on the Chromebook: none of the visual half can
be done there, and the numbers in this section are still the right description
of that box.

Two headless notes worth keeping for whoever writes the next script: the game
gets two frames in before the device goes, so `scene.getFrameId()` stops at 2
and `engine.getFps()` reads ~3 forever — neither is a stall. And Dawn logs a
wall of `'textureSample' must only be called from uniform control flow` for
Babylon's OWN WGSL shaders; filter `getCompilationInfo()` on
`type === "error"` or every run reads as broken.

**The debug hook has a strictly better replacement.** `VERIFYING.md:277-280`
hooks `WebGL2RenderingContext.prototype.shaderSource`. Replace with
`GPUDevice.prototype.createShaderModule` in an `addInitScript`, capturing
`descriptor.code` — and then `GPUShaderModule.getCompilationInfo()` returns
`{lineNum, linePos, message}` against the source you're holding. Say so in
`VERIFYING.md`; the next person should not reimplement the old one.

**The transpiler tripwire, as it actually landed and NOT as written here
first** (finding 25): it is two halves and both are in `harness.mjs`, so every
script that boots a page gets them. `bootMap` records every request matching
`**/*.babylonjs.com/**` AND aborts the route; `assertNoTranspiler` reads
`engine._glslang` / `engine._tintWASM` after a sweep that compiled something.
The fields are `null` and not `undefined`, and the ABORT silences them — an
aborted fetch leaves both null forever — so a caller fails on the recorded
requests as well. `gate.mjs` and `shaders.mjs` do.

**Visual parity — the M2 reference set is the whole technique.** Every WGSL
landing diffs against the GLSL-under-WebGPU shots, not against WebGL2, so engine
differences are already absorbed and a diff means a *shader* difference. Use the
existing methodology (`docs/rendering.md:206-217`, `VERIFYING.md:773-805`):
freeze the frame first (`g.post.setEnabled(false)`, stop sky and ash — the
unfrozen noise floor is 42–47% of pixels, frozen 0.00%; **re-derive that floor
under WebGPU before trusting any number**), one vantage per process run, mask by
toggling at full canvas size.

Vantages: reuse the four committed ones in `src/ui/mapShots.ts` (already
reviewed, already what the menu stands on), plus per map — Hollowmere: a lantern
street (point lights, `CEL_BUMP`), the ash field, a wall at 40 m (dither
banding). Greyfen: dead trees (**the `OutlineFog` regression case**,
`docs/rendering.md:53-61`), the canopy mid-gust via `g.mats.updateWind(2.6)`, the
flood meadow. Coldharbour: a curtain wall at 2 m (`CEL_GLASS_BACKED`), the same
pane at 40/90/130/220 m (**the `GLASS_DEPTH_UNITS` sweep — `VERIFYING.md:618-637`
is the recipe and must be re-run**), an avenue (front-to-back sort).
Harrowmead: the millpond, the borderland edge.

**Measurements that must be re-taken, not re-read** — all of them now have been,
the last six at M7: `GLASS_DEPTH_UNITS` and both z-offset geometry rules
(`docs/rendering.md`; the two rules came apart — see finding 28); the MSAA memory
figure (`FINDINGS.md` #4, re-read as a WebGPU sample count); the shadow kernel's
containment (four maps, and the window has to be pushed to the vantage first);
per-map ink luma (and the absolute tint bound, which could not have moved with
the backend); the band `fwidth` widening (on Coldharbour now, because Greyfen's
floor is in shade); and **the two outline invalidation counts** (534/642 freed
wrappers, 148 stale-fog wrappers) — these are prose regression tests, they were
the most important re-run in the plan, and M6 discharged them at 1 cached effect
/ 0 of 438 freed / 0 stale.

**Two mechanical gates worth committing** (`npm run typecheck` stays the only
logic gate): the deep-import grep, and a **shader-compile smoke script** that
forces all eight cel variants + grass + water + three post passes + outline to
compile and asserts zero `getCompilationInfo` errors. That is the only thing
standing between "typecheck passes" and "the map is invisible". **Both landed at
M5** — `scripts/check-deep-imports.mjs` and `plans/webgpu-ref/shaders.mjs`. The
smoke script asks the FACTORY rather than the frame, because a variant nobody
draws is a variant nobody compiles; it also mints the one cel shape no shipped
map does (`CEL_GROUND_TEX` with no `CEL_BUMP`), which is the difference between
eight variants compiling and five.

**`npm run shots` is a hard dependency and it IS broken on a GPU-less box**,
confirmed by running it: it times out at `waitForFunction` waiting for a map
that cannot draw. The committed shots survive (the script only writes a
placeholder when the file is absent), so `main` is not at risk — but the
generator no longer runs on a GPU-less box. **On the Windows box it now runs
end to end** and produces all four backdrops, though only after the readiness
bug in finding 9 was fixed: before that it produced two blank ones, which is a
worse failure than the timeout because it succeeds. That is a *build-contract* consequence (one of the four assets
`docs/build.md` permits exists because it has a generator), not a testing
inconvenience. **The answer is that the generator's contract gains a
requirement** — it needs a machine with a GPU, the same one M2 needs — and
`docs/build.md` says so. It is not a candidate for the offscreen workaround:
the script photographs the PAGE, not the canvas.

---

## Docs

**Landed at M8 — the list below is the record of what was swept, not a queue.**
Three corrections to it came out of doing it, and they are findings 34, 35 and
37: `index.html` had nothing to change, `docs/states.md` and `docs/game.md`
needed a paragraph ADDED rather than a premise edited, and what `docs/editor.md`
owed was a TIME beside a draw count. Tier 1 had already been paid milestone by
milestone, which is why only `CLAUDE.md` was left in it.

Not a tail — roughly a fifth of the work. **Move prose verbatim, never
paraphrase** (`CLAUDE.md:39-53`): most of what needs editing is an *argument*
whose GLSL-specific premise changed. Edit the premise, keep the argument.

**Tier 1** — `docs/rendering.md` (the big one: the fog split `:32-49`; the
OutlineFog argument `:63-83` and its "compiles under GLSL ES 1.00" premise
`:31-34` → restate as "WGSL has no `inverse()`"; the three invalidation rules
`:85-135`; glazing `:436-462`; **`GLASS_DEPTH_UNITS` `:511-529`**; the no-stencil
claim `:676-691`, still true and now also deciding the depth *format*; the
shadow kernel and the renamed includes `:693-717`; `Dither` `:718-731`; the
trailing-`//`-with-`;` trap `:912-918` — **re-verify whether it still bites in
the WGSL path**; the two z-offset rules `:941-981`; `fwidth` `:1038-1057`).
`docs/build.md` — extend the deep-import section, and add **a new section on the
two WASMs the engine will fetch if you let it**. `CLAUDE.md` — `:62`, `:77-82`,
`:93-110`, `:273-316`, staying under ~850 lines. `VERIFYING.md` — the new hook,
the two-await `__celshock` note, the re-derived diff floor, and **a new opening
paragraph on `channel: "chromium"` and the WebGPU flags**. `FINDINGS.md` — #3,
#4, #5, #10, #12, #13 are now unattributed; **do not delete them** (`:6-12` says
a finding leaves by being fixed or disproved, and "measured on another backend"
is neither) — add a status line each.

**Tier 2** — `docs/states.md` (one paragraph: the state machine doesn't exist
until *two* awaits have resolved), `docs/game.md` (engine as constructor
argument), `docs/pwa.md:115`, `docs/deaths.md:13,25`, `docs/ui.md:95`,
`docs/editor.md`, and **`docs/multiplayer.md` — one line saying the server did
not move**, because that is the next reader's first question.

**Tier 3** — contract headers in `main.ts` (4 places), `Game.ts:49,679,683-697`,
`CelShader.ts:1-37`, `OutlineFog.ts:1-52`, `EmissiveFog.ts:88`, `Dither.ts`,
`Atmosphere.ts:13-17`, `GrenadeSystem.ts:263,334`, `PhysicsWorld.ts:14`. Plus
`README.md:26,260`, `FILES.md:44,291`, `index.html`.

---

## Risks and rollback

**The branch is the rollback** — `main` works throughout and the branch never
merges until the four-map sweep signs off. What needs planning is the
*non-binary* failure.

**Top three risks:**

1. ~~**The outline effect-cache invalidation.**~~ **Discharged at M6, by
   measurement rather than by inspection — see finding 26.** The three rules
   survived the language change untouched, the second cache layer named below
   has not bitten, and both prose regression tests were re-run on the map
   change this entry says to run them on. The original entry follows, because
   the reasoning is still the reason those rules may not be simplified.

   **The outline effect-cache invalidation.** The only place in the tree
   reaching into Babylon's private state, with three rules each paid for in a
   measured bug — and WebGPU adds a second cache layer (`_deletePipelineContext`
   now calls `resetCachedPipeline`, not `_deleteProgram`) that the hand
   `delete cache[key]` backstop does not reach. Both failure modes are **silent
   on Hollowmere and loud on Greyfen** (`docs/rendering.md:98-109, 126-133`), so
   a sweep starting on the night village reports clean. *Mitigation: make this
   its own milestone, test on Greyfen at the second map change of a session, and
   turn the two prose regression tests into assertions before starting.*
2. **The cel fragment silently wrong.** 505 lines, six defines, derivative facet
   normals, a per-pixel composite. The failure mode is not a compile error — it
   is lighting subtly off in one variant on one map, which
   `docs/rendering.md:149-176` shows can hide for a whole map. *Mitigation: the
   M2 reference set is the entire defence and is worth the days it costs; diff
   per variant and land only when all eight are clean; run the uniform read-back
   assertion at M4 so light plumbing is already ruled out.* **Discharged at M5**,
   and the reference set was not on its own enough: no banked frame holds a mesh
   with no vertex colour buffer, so the whole-scene twin swap over a paused live
   round is what covers the rigs, the viewmodel and the effect meshes. 0% on all
   four maps, with the variants enumerated by `shaders.mjs` rather than assumed.
3. ~~**Headless verification collapsing**~~ — **this one has already happened,
   so it is no longer a risk to manage but a constraint to plan around.**
   Headless renders nothing on the dev machine (see Verification). The
   mitigation named here is now the plan of record rather than a contingency:
   **a headed harness on a real GPU is the primary instrument for everything
   visual** — a better instrument anyway (`FINDINGS.md:680-684`), but slower
   and unattendable, and the estimate below does not yet carry that. The half
   that survived is worth naming too: headless still runs the DOM and the
   simulation at full speed, so it stays the instrument for everything that is
   not a picture, and the split is clean rather than degraded.

**Off-ramps.** If the outline doesn't converge: (a) fall back to the unscoped
`resetDrawCache(undefined, true)` branch `OutlineFog.ts:232` already has,
accepting 15 recompiles per map change instead of 1; (b) `engine.releaseEffects()`
on a fog change — brutal, correct, paid behind the building card where the game
can afford it; (c) abandon per-pixel ink fade for per-mesh — a **visible quality
regression** (`docs/rendering.md:33-38`) needing sign-off, so escalate rather
than choose it.

**If it doesn't converge at all**, delete the branch but keep the WGSL sources
(the expensive artefact, still correct next time) and every non-WebGPU-specific
doc edit — the re-derived measurements and the premises nobody had written down
are net-positive regardless.

**Do not merge partially** — three of nine shaders in WGSL is the dual-language
maintenance burden with none of the benefit. **Do not let the branch run past
~6 weeks**; `docs/rendering.md`, `docs/world.md` and `src/shaders/` are actively
edited and long-lived branches across them conflict in exactly the prose that is
hardest to merge.

---

## Estimate

| phase | days |
| --- | --- |
| M0–M2 engine swap, four maps on GLSL | 3–5 |
| M3–M6 nine shaders + two plugins | 16–20 |
| M7 re-tuning and re-measurement | 4–6 |
| M8 four-map parity sweep | 3–5 |
| Docs | 4–6 |
| **total** | **30–42 days** |

**Five weeks with a two-week band**, the band almost entirely the headless-WebGPU
answer and the outline off-ramp. Performance outcome: **neutral, by design.**

**After M0, half the band is resolved and it resolved to the bad side.** The
headless answer is settled: nothing visual can be verified on the dev machine,
so every milestone with a picture in it (M2, M5, M7, M8 — the majority of the
calendar) is gated on GPU hardware being available, and the days those phases
carry assume an instrument that turns out to be slower and unattendable. The
outline off-ramp is UNCHANGED in size but has moved EARLIER: the language
problem lands at M1, so whether item 11 converges is now known at first light
instead of at M6. That is the one piece of good news in the re-estimate — it is
the same risk discovered five weeks sooner, which is when an off-ramp is still
worth taking.

M0 itself came in at well under its 1.5 days, but that number was never the
question.
