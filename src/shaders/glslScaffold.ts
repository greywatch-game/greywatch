/**
 * glslScaffold.ts — SCAFFOLDING, and the whole of it. Owns the three things
 * that are true only while the engine is WebGPU and a shader in the tree is
 * still GLSL, and it exists as one file so that finishing the port is
 * deleting a file and two calls rather than hunting three unrelated lines.
 * Invariants: nothing in the game may DEPEND on any of this. Each function
 * makes a GLSL source behave as it did under WebGL2 and buys nothing else.
 *
 * **This is not a fallback and not a transpiler the game ships.** The
 * migration lands the engine first and the shader language second, because an
 * engine failure and a language failure are debugged differently and paying
 * them together is what turns a month into three. GLSL still compiles under
 * `WebGPUEngine` — the backend runs it through glslang to SPIR-V and twgsl to
 * WGSL — which is the lever the whole ordering rests on, and these three
 * functions are what that lever costs.
 *
 * **The demolition is ORDERED and this file is not the first step.** The last
 * WGSL shader lands, then `EmissiveFog` gains its WGSL branch (which is what
 * `forceStandardMaterialGLSL` stands in for), then this file goes, and only
 * then is the tripwire — `engine._glslang === undefined && engine._tintWASM
 * === undefined` after a sweep that actually drew every map — worth asserting.
 * Deleting this first turns every `StandardMaterial` in the game WGSL at once,
 * which is a different milestone's work arriving unannounced.
 */
import {
  ShaderLanguage,
  StandardMaterial,
  type Scene,
  type WebGPUEngine,
} from "@babylonjs/core";

/**
 * **A `StandardMaterial` picks WGSL FOR ITSELF under WebGPU, and both material
 * plugins fail on it before their own milestone.**
 * `Material._createUniformBuffer` sets `_shaderLanguage = WGSL` whenever
 * `engine.isWebGPU && !this._forceGLSL`, and `MaterialPluginBase.isCompatible`
 * answers true for GLSL and false for everything else — so
 * `MaterialPluginManager._addPlugin` THROWS the first time
 * `CelMaterialFactory.getEmissive` attaches `EmissiveFog`, which is inside
 * `Game`'s constructor, and the boot screen says "something went wrong" about
 * a shader language.
 *
 * `ShaderMaterial` needs no equivalent: it defaults to GLSL and is told
 * otherwise per material, which is how the port lands one shader at a time.
 */
function forceStandardMaterialGLSL(): void {
  StandardMaterial.ForceGLSL = true;
}

/**
 * The natural stride of one array element in the uniform address space —
 * `roundUp(align, size)` from the WGSL memory-layout rules, where an array in
 * a uniform buffer additionally rounds its element alignment up to 16.
 *
 * Only the element types twgsl can hand back for the arrays this tree declares
 * are here. Anything else throws in `retargetStrides` rather than being
 * guessed at, because guessing a stride wrong is a UBO that reads plausible
 * values from the wrong offsets — no diagnostic, and the failure is "lighting
 * is subtly off".
 */
const UNIFORM_ARRAY_STRIDE: Record<string, number> = {
  "f32": 16,
  "i32": 16,
  "u32": 16,
  "vec2<f32>": 16,
  "vec3<f32>": 16,
  "vec4<f32>": 16,
  "mat4x4<f32>": 64,
};

/** Element types that must be wrapped rather than merely padded — see below. */
const SCALAR_ELEMENTS = new Set(["f32", "i32", "u32"]);

const STRIDE_ALIAS =
  /alias\s+(\w+)\s*=\s*@stride\((\d+)\)\s*array<\s*([\w<>]+)\s*,\s*(\d+)u?\s*>\s*;/g;

/**
 * **twgsl emits `@stride(N)`, which was removed from WGSL, so every shader in
 * this game that carries a uniform ARRAY is rejected by the backend it was
 * just transpiled for.** Measured at M1, on the first lit scene: Dawn answers
 * `invalid type alias` for `alias Arr = @stride(16) array<vec3<f32>, 16u>;`
 * and the cel, grass and water fragments all fail to compile. The build on
 * `cdn.babylonjs.com` is the only one there is — the unversioned path and the
 * versioned path are the same bytes — so the output is rewritten here rather
 * than fixed upstream.
 *
 * **The two cases are not the same repair, and that is the whole of this
 * function.** A `vec3<f32>` array already has a natural uniform stride of 16,
 * so the attribute is redundant and dropping it changes no offset. A SCALAR
 * array does not: `array<f32, 16>` packs at 4, which is both a different
 * layout and illegal in a uniform buffer (elements must be 16-aligned). It has
 * to become an array of a padded struct — which is exactly what Babylon's own
 * WGSL processor does to `array<f32, N>` and what a current Tint emits, so the
 * shape here is the shape `pointRange` will have after the port anyway.
 *
 * Rewriting the ACCESSES is safe here in a way it would not be on hand-written
 * source: twgsl's output is normalised, every index is already a `let`-bound
 * name or a literal, and a member is only ever reached through a `.`. Anything
 * this does not recognise throws with the line in the message; a stride
 * quietly gotten wrong is the failure mode this file cannot be allowed to have.
 */
function retargetStrides(code: string): string {
  const wrapped = new Set<string>();
  let out = code.replace(
    STRIDE_ALIAS,
    (whole, name: string, stride: string, element: string, count: string) => {
      const declared = Number(stride);
      const natural = UNIFORM_ARRAY_STRIDE[element];
      if (natural === undefined) {
        throw new Error(`glslScaffold: unknown array element type in "${whole}"`);
      }
      if (declared !== natural) {
        throw new Error(
          `glslScaffold: stride ${declared} is not the natural ${natural} in "${whole}"`,
        );
      }
      if (!SCALAR_ELEMENTS.has(element)) {
        return `alias ${name} = array<${element}, ${count}u>;`;
      }
      wrapped.add(name);
      return (
        `struct ${name}_el {\n  @size(${declared}) el : ${element},\n}\n` +
        `alias ${name} = array<${name}_el, ${count}u>;`
      );
    },
  );

  // Every struct member declared with a wrapped alias, so the accesses through
  // it can be given the `.el` the padding cost them. Members are collected
  // from the declarations rather than from a name list, so a second scalar
  // array added to any shader is carried for free.
  if (wrapped.size > 0) {
    const members = new Set<string>();
    const decl = /(\w+)\s*:\s*(\w+)\s*,/g;
    for (const m of out.matchAll(decl)) {
      if (wrapped.has(m[2])) members.add(m[1]);
    }
    for (const member of members) {
      out = out.replace(
        new RegExp(`\\.${member}\\[([^\\[\\]]*)\\]`, "g"),
        `.${member}[$1].el`,
      );
    }
  }

  if (out.includes("@stride(")) {
    throw new Error("glslScaffold: an @stride attribute survived the rewrite");
  }
  return out;
}

/**
 * Installs the two engine-level repairs the GLSL path needs, and the reason
 * they are installed through the PUBLIC `prepareGlslangAndTintAsync` rather
 * than at construction is that `_tintWASM` does not exist until then: the
 * engine builds it lazily, the first time a GLSL shader actually reaches the
 * backend. `_preparePipelineContextAsync` awaits that method before it converts
 * anything, so a patch applied after the inner call has resolved is in place
 * before the first conversion — and after the first load the method is never
 * called again, which is why the guard below is a flag rather than a re-test.
 *
 * **The second repair is uniformity analysis, and it is not optional.** WGSL
 * rejects `textureSample` (and every derivative) in non-uniform control flow,
 * which is what a cel shader's `fwidth` bands and its `#ifdef`'d texture
 * fetches are by construction — measured at M1 as
 * `'textureSample' must only be called from uniform control flow` out of a
 * shader that has run correctly for the life of the project. Forcing the flag
 * on is the GLSL-path twin of the `#define DISABLE_UNIFORMITY_ANALYSIS` every
 * hand-written WGSL shader in this tree will carry, so it is the same decision
 * taken once, five milestones early, rather than a different one.
 */
function repairTranspiledWGSL(engine: WebGPUEngine): void {
  const prepare = engine.prepareGlslangAndTintAsync.bind(engine);
  let patched = false;
  engine.prepareGlslangAndTintAsync = async () => {
    await prepare();
    if (patched) return;
    const tint = (engine as unknown as { _tintWASM: TintWASM | null })._tintWASM;
    if (!tint) return;
    patched = true;
    const convert = tint.convertSpirV2WGSL.bind(tint);
    // `true` is passed rather than forwarded: Babylon hands the flag to twgsl
    // AND prefixes `diagnostic(off, derivative_uniformity)`, and both halves
    // are wanted on every shader, not on the ones a caller happened to ask for.
    tint.convertSpirV2WGSL = (code: unknown) => retargetStrides(convert(code, true));
  };
}

/** The half of Babylon's `WebGPUTintWASM` this file has to reach through. */
interface TintWASM {
  convertSpirV2WGSL(code: unknown, disableUniformityAnalysis?: boolean): string;
}

/**
 * **`OutlineRenderer` picks WGSL for itself the way a `StandardMaterial` does,
 * and unlike the material it has NO override to say otherwise** — its
 * constructor sets `_shaderLanguage = GLSL` and then overwrites it with WGSL
 * whenever `engine.isWebGPU`, with no flag between. So the outline pass reads
 * `ShadersStoreWGSL` while `OutlineFog.patch()` writes `ShadersStore`, and the
 * patch silently does nothing: the ink draws, unfogged, in flat lines over
 * walls that have already dissolved into the fog wall.
 *
 * That is the bug `OutlineFog` exists to fix, arriving again by a different
 * route, and it is SILENT on Hollowmere and loud on Greyfen for the same
 * reason it was the first time — near-black ink on a near-black fog is
 * invisible. Putting the language back is what keeps the outline pass on the
 * source `OutlineFog` actually patches until that file is ported.
 *
 * Reaching for the outline renderer is also what CREATES it, one frame earlier
 * than the first outlined mesh would have. That costs four render-pass ids and
 * nothing else, and it is what makes this a single call at construction rather
 * than a thing some later frame has to remember.
 */
function forceOutlineGLSL(scene: Scene): void {
  const renderer = scene.getOutlineRenderer() as unknown as {
    _shaderLanguage: ShaderLanguage;
  };
  renderer._shaderLanguage = ShaderLanguage.GLSL;
}

/**
 * The engine half, called from `main.ts` with the engine it just built and
 * before `Game` is constructed — `forceStandardMaterialGLSL` has to be true
 * before the first material exists, and the first material is built inside
 * that constructor.
 */
export function scaffoldEngineGLSL(engine: WebGPUEngine): void {
  forceStandardMaterialGLSL();
  repairTranspiledWGSL(engine);
}

/**
 * The scene half, called from `Game`'s constructor with the scene it just
 * built. Separate from the engine half only because the outline renderer is a
 * scene component and there is no scene when the engine is made.
 */
export function scaffoldSceneGLSL(scene: Scene): void {
  forceOutlineGLSL(scene);
}
