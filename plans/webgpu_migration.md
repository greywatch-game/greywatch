# Migrate Greywatch to WebGPU (WGSL-only, single branch)

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
   than changes what *Verification* already says.

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
| **M2** | All four maps up. **Bank the GLSL-under-WebGPU screenshot reference.** **Owes the 40 cube probes M1 could not reach**, and is therefore hard-gated on a GPU machine | The most valuable artefact of the migration — later diffs isolate *shader* errors by construction |
| **M3** | **First WGSL** — the three post fragments (`HorrorPost`, `GodRays`, `MotionBlur`) | Dialect, `PostProcess` wiring, `onApply` binding, single-exit rewrite. Standalone, no attributes, no defines |
| **M4** | **First WGSL surface** — shared includes, then `GrassShader` | Include strategy, `instances*` twin, `MAX_PUSHERS`, `array<vec3f,N>` + `setArray3`. Run the uniform read-back assertion here |
| **M5** | **`CelShader`** — author variant by variant, land once | The long pole: ~620 shader lines, 29 uniforms, 8 materials, 6 defines |
| **M6** | `WaterShader` → `OutlineFog` → `EmissiveFog`. **Delete the scaffold**: assert `engine._glslang === undefined && engine._tintWASM === undefined` after a four-map sweep | Complete |
| **M7** | Re-tune `GLASS_DEPTH_UNITS`, outline z-offsets, MSAA/memory. Re-measure everything `FINDINGS.md` claims | Re-derives what the depth-format change invalidated |
| **M8** | Docs, four-map parity sign-off | — |

M1 is the real first-light gate. M5 is the long pole. M7+M8 are about a third of
the calendar.

**The scaffold is one FILE as of M1** — `src/shaders/glslScaffold.ts`, holding
`StandardMaterial.ForceGLSL`, the outline renderer's language, and the twgsl
output repair (findings 4 and 5), with two call sites. M6's demolition is
therefore three steps, not one: port `EmissiveFog` (item 12), delete the file
and its two calls, and only then assert the transpiler tripwire — deleting it
first turns every `StandardMaterial` in the game WGSL at once, which is a
different milestone's work arriving unannounced.

---

## Work breakdown

| # | File | Work | Days |
| --- | --- | --- | --- |
| 1 ✅ | `main.ts` | `hasWebGL2` → async `hasWebGPU`; new copy; third boot branch; header rewrite (4 paragraphs name WebGL2). **Also added `@webgpu/types`** — `navigator.gpu` is not in TypeScript's DOM lib, and tsconfig's `types` went `[]` → one entry so the list stays CLOSED | 0.5 |
| 2 ✅ | `src/core/Game.ts:698` | Engine becomes a **constructor argument** like `havok` — see below | 1 |
| 3 | `src/shaders/HorrorPost.ts` | First WGSL in the tree; budget dialect learning here | 1 |
| 4 | `src/shaders/GodRays.ts` | `#define SAMPLES` survives; loop bound must be `i32` | 0.5 |
| 5 | `src/shaders/MotionBlur.ts` | **`setMatrix3x3("reproject")` (`:154`) is the risk** — `mat3x3f` is three vec4-aligned columns; verify the upload | 1 |
| 6 | `src/shaders/wgsl/includes.ts` *(new)* | BAND / SHADOW / PROBE / PROBE_BOX / DITHER as WGSL includes | 1.5 |
| 7 | `src/shaders/Dither.ts` | Body moves to (6); **keep the 60-line header verbatim** — it is the argument | 0.25 |
| 8 | `src/shaders/GrassShader.ts` | Both stages; `instances*` twins; drop `#extension` at `:120` | 1.5 |
| 9 | `src/shaders/CelShader.ts` | **The long pole.** Fragment `:462-966`, 6 defines, 3 albedo paths, glass composite, `facetNormal()`. Factory needs `shaderLanguage` on 7 `new ShaderMaterial` sites and nothing else | 5 |
| 10 | `src/shaders/WaterShader.ts` | Wave field, `domeAt`, Schlick, foam. Long but mostly arithmetic | 2.5 |
| 11 | `src/shaders/OutlineFog.ts` | `patch()` keeps structure; retarget to `ShadersStoreWGSL` (`:97, 111, 266`); rewrite `VERTEX_BODY`; declare the varying in **both** stages. `dropCompiled` needs **re-verification, not rewriting** | 2 |
| 12 | `src/shaders/EmissiveFog.ts` | `getCustomCode(type, lang)` / `getUniforms(lang)` / `isCompatible` all take a language arg (`materialPluginBase.pure.d.ts:52/115/198`) — branch cleanly. **`isCompatible` is what the M0 scaffold stands in for**, so this item and the `ForceGLSL` line land together; `gl_FragColor` becomes `fragmentOutputs.color`, and `vPositionW`/`vEyePosition` become `fragmentInputs.`/`uniforms.` | 1 |
| 13 | `Atmosphere.ts`, `GrenadeSystem.ts` | No code change expected. Verify compute particles, `emitRateControl`, `randomTextureSize: 4096`. Headers naming transform feedback are now wrong | 0.5 |
| 14 | `WaterSystem`, `ShadowSystem`, `ReflectionSystem`, `Sky` | No code change expected. Verify R8 texture, shadow depth format + `bias = 0`, 40 cube RTTs + face Y-flip, `DynamicTexture.update(false)` | 1 |
| 15 | `src/entities/ViewModel.ts:203-204` | Verify `ALWAYS` + `forceDepthWrite` + `alphaIndex: Infinity`; WebGPU bakes depth state into the pipeline rather than setting it | 0.5 |
| 16 | `index.html`, `README.md`, `FILES.md` | Boot copy, requirements, two rows | 0.5 |

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

- **Bones: check whether `getSkinned` (`CelShader.ts:1561`) has any caller.** It
  appears to be dead — `CLAUDE.md:83-87` records that the rigged asset and
  `@babylonjs/loaders` were deleted. If so, deleting it removes both bone
  includes, both deep imports and the question. Confirm before relying on it.
- **Instances genuinely load-bearing** (the grass field is thin-instanced):
  register our own `celInstances` (~short — read `world0..world3`, build
  `finalWorld`). Header names the Babylon file and version it mirrors, so an
  upgrade has something to diff.
- **Add a grep gate to `npm run build`**, beside `check-collision.mjs`, failing
  on any `@babylonjs/core/` subpath in `src/` and `main.ts`. This is the only
  absolute rule in the project that `tsc` cannot see and that reproduces on
  someone else's machine. Overdue.
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

**The transpiler tripwire**: assert `engine._glslang === undefined &&
engine._tintWASM === undefined` after a four-map sweep, and add
`page.route("**/*.babylonjs.com/**", r => r.abort())` to every smoke
script, so a regression fails loudly instead of quietly costing a CDN round trip.

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

**Measurements that must be re-taken, not re-read**: `GLASS_DEPTH_UNITS` and
both z-offset geometry rules (`docs/rendering.md:511-529, 941-981`); the MSAA
memory figure (`FINDINGS.md` #4); the shadow kernel's 0.33% containment
(`:693-703`); per-map ink luma (`:206-211`); the band `fwidth` widening
(`:1038-1057`); and **the two outline invalidation counts** (534/642 freed
wrappers, 148 stale-fog wrappers) — these are prose regression tests and are the
most important re-run in the plan.

**Two mechanical gates worth committing** (`npm run typecheck` stays the only
logic gate): the deep-import grep, and a **shader-compile smoke script** that
forces all eight cel variants + grass + water + three post passes + outline to
compile and asserts zero `getCompilationInfo` errors. That is the only thing
standing between "typecheck passes" and "the map is invisible".

**`npm run shots` is a hard dependency and it IS broken**, confirmed by running
it: it times out at `waitForFunction` waiting for a map that cannot draw. The
committed shots survive (the script only writes a placeholder when the file is
absent), so `main` is not at risk — but the generator no longer runs on a
GPU-less box. That is a *build-contract* consequence (one of the four assets
`docs/build.md` permits exists because it has a generator), not a testing
inconvenience. **The answer is that the generator's contract gains a
requirement** — it needs a machine with a GPU, the same one M2 needs — and
`docs/build.md` says so. It is not a candidate for the offscreen workaround:
the script photographs the PAGE, not the canvas.

---

## Docs

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

1. **The outline effect-cache invalidation.** The only place in the tree
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
   assertion at M4 so light plumbing is already ruled out.*
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
