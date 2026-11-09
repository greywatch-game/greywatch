/**
 * wgsl/glowBlur.ts — The glow's blur and its box downsample as OUR renderer
 * draws them (`BABYLON_EXIT.md` X5.2b): the WHOLE modules Babylon 9.28 handed
 * the device for `ThinBlurPostProcess` (its built-in `kernelBlur`) and for the
 * `glowDown` effect over Babylon's stock `postprocess` vertex stage, read off
 * the parent's device (`plans/webgpu-ref/post.mjs`, 285da96) — and, for the
 * blur, the arithmetic that WRITES them, because its text is a function of the
 * kernel.
 * Owns: `GLOW_DOWN_VERTEX` and `GLOW_DOWN_FRAGMENT` (the box filter, as
 * compiled); `blurKernel` (Babylon's `_nearestBestKernel`, the kernel a blur of
 * a given ideal width compiles for); `glowBlurModules` (the blur's two modules
 * for one compiled kernel and a device's inter-stage limit: Babylon's
 * `_updateParameters` — the Gaussian, its normalisation, the linear-sampling
 * pairs, the `toFixed(8)` printing, the split of the taps between varyings and
 * dependent reads on `maxInterStageShaderVariables` — and its processor's
 * output for those defines, character for character).
 * Invariants: every expression is Babylon's AS COMPILED, character for
 * character — a re-typed shader is a different rounding, and the tokens are
 * what the probe compares; the bindings are Babylon's own (group 1: the
 * source texture 0, its sampler 1, `Internals` 2, the pass's `LeftOver` 3;
 * group 0 empty), so a pipeline is laid out as Babylon's was; the position
 * arrives as Babylon fed it, a `vec2f` vertex ATTRIBUTE at location 0 off
 * Babylon's quad, not pulled from storage; the kernel's arithmetic runs in
 * float64 exactly as Babylon's does, so the constants printed are Babylon's;
 * the vertex stage writes `vertexOutputs.position.y *= internals.yFactor_`, as
 * Babylon's processor appends it, -1 into a texture.
 * The box filter's one whitespace-only line (two spaces, where Babylon's
 * processor indented an empty first line of `main`) is written `${"  "}`, so
 * no text editor's trailing-space trim moves a character of it.
 * Never: imports Babylon (`src/render/` imports this, and the build gate walks
 * it); is assembled (`render/wgsl/assemble.ts`) — these are whole modules;
 * changes a character without the probe's `--against` its parent and the
 * bank's `exact.mjs` saying it moved nothing.
 * Contract: `docs/rendering.md`, "The glow: what the depth share replaced".
 */

/** `_nearestBestKernel`'s candidates about the rounded width, in its order: v, v - 1, v + 1, v - 2, v + 2. */
const NEAREST = [0, -1, 1, -2, 2] as const;

/**
 * The ideal kernel's compiled width: Babylon's `_nearestBestKernel` — the odd
 * width nearest `ideal` whose half is even (5, 9, 13…), at least 3. The blur's
 * TEXT depends on this and nothing else of the kernel, so two ideal widths
 * that round alike share a program. Asked every frame, so it allocates nothing.
 */
export function blurKernel(ideal: number): number {
  const v = Math.round(Math.max(ideal, 1));
  for (let i = 0; i < NEAREST.length; i++) {
    const k = v + NEAREST[i];
    if (k % 2 !== 0 && Math.floor(k / 2) % 2 === 0 && k > 0) return Math.max(k, 3);
  }
  return Math.max(v, 3);
}

/** Babylon's `_gaussianWeight`: sigma 1/3 over [-1, 1]. */
function gaussianWeight(x: number): number {
  const sigma = 1 / 3;
  const denominator = Math.sqrt(2.0 * Math.PI) * sigma;
  const exponent = -((x * x) / (2.0 * sigma * sigma));
  return (1.0 / denominator) * Math.exp(exponent);
}

/** Babylon's `_glslFloat`: eight decimals, trailing zeros off (so `0.`). */
function glslFloat(x: number): string {
  return x.toFixed(8).replace(/0+$/, "");
}

/** One compiled kernel's taps, as Babylon's `_updateParameters` defines them. */
interface Taps {
  /** `KERNEL_OFFSET{i}` / `KERNEL_WEIGHT{i}`, read off a varying each. */
  readonly varying: readonly (readonly [string, string])[];
  /** `KERNEL_DEP_OFFSET{i}` / `KERNEL_DEP_WEIGHT{i}`, read off the centre. */
  readonly dependent: readonly (readonly [string, string])[];
}

/** `_updateParameters`' arithmetic, line for line, for a compiled width `n`. */
function taps(n: number, maxInterStageShaderVariables: number): Taps {
  const centerIndex = (n - 1) / 2;
  let offsets: number[] = [];
  let weights: number[] = [];
  let totalWeight = 0;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const w = gaussianWeight(u * 2.0 - 1);
    offsets[i] = i - centerIndex;
    weights[i] = w;
    totalWeight += w;
  }
  for (let i = 0; i < weights.length; i++) weights[i] /= totalWeight;
  const linearSamplingMap: { o: number; w: number }[] = [];
  for (let i = 0; i <= centerIndex; i += 2) {
    const j = Math.min(i + 1, Math.floor(centerIndex));
    const singleCenterSample = i === j;
    if (singleCenterSample) {
      linearSamplingMap.push({ o: offsets[i], w: weights[i] });
    } else {
      const sharedCell = j === centerIndex;
      const weightLinear = weights[i] + weights[j] * (sharedCell ? 0.5 : 1);
      const offsetLinear = offsets[i] + 1 / (1 + weights[i] / weights[j]);
      if (offsetLinear === 0) {
        linearSamplingMap.push({ o: offsets[i], w: weights[i] });
        linearSamplingMap.push({ o: offsets[i + 1], w: weights[i + 1] });
      } else {
        linearSamplingMap.push({ o: offsetLinear, w: weightLinear });
        linearSamplingMap.push({ o: -offsetLinear, w: weightLinear });
      }
    }
  }
  offsets = linearSamplingMap.map((m) => m.o);
  weights = linearSamplingMap.map((m) => m.w);
  // WGSL: one row fewer for the builtins, then one for `sampleCenter`.
  const maxVaryingRows = maxInterStageShaderVariables - 1;
  const freeVaryingVec2 = Math.max(maxVaryingRows, 0) - 1;
  const varyingCount = Math.min(offsets.length, freeVaryingVec2);
  const varying: [string, string][] = [];
  for (let i = 0; i < varyingCount; i++) varying.push([glslFloat(offsets[i]), glslFloat(weights[i])]);
  const dependent: [string, string][] = [];
  for (let i = freeVaryingVec2; i < offsets.length; i++) dependent.push([glslFloat(offsets[i]), glslFloat(weights[i])]);
  return { varying, dependent };
}

/** The blur's two modules for one compiled width, as Babylon's processor wrote them. */
export interface GlowBlurModules {
  readonly vertex: string;
  readonly fragment: string;
}

/**
 * The blur's vertex and fragment modules for compiled width `n`
 * (`blurKernel`) on a device whose `maxInterStageShaderVariables` is `limit`:
 * the text Babylon's WGSL processor made of `kernelBlur` for those defines.
 */
export function glowBlurModules(n: number, limit: number): GlowBlurModules {
  const t = taps(n, limit);
  const v = t.varying;
  const d = t.dependent;
  const defines: string[] = [];
  const consts: string[] = [];
  v.forEach(([o, w], i) => {
    defines.push(`//#define KERNEL_OFFSET${i} ${o}`, `//#define KERNEL_WEIGHT${i} ${w}`);
    consts.push(`const KERNEL_OFFSET${i} = ${o};`, `const KERNEL_WEIGHT${i} = ${w};`);
  });
  d.forEach(([o, w], i) => {
    defines.push(`//#define KERNEL_DEP_OFFSET${i} ${o}`, `//#define KERNEL_DEP_WEIGHT${i} ${w}`);
    consts.push(`const KERNEL_DEP_OFFSET${i} = ${o};`, `const KERNEL_DEP_WEIGHT${i} = ${w};`);
  });
  const head = (stage: string): string => `${defines.join("\n")}\n//\n//#define SHADER_NAME ${stage}:kernelBlur\ndiagnostic(off, chromium.unreachable_code);\n`;
  const varyings = (): string => {
    let s = "  @location(0) @interpolate(perspective, center) sampleCenter : vec2f,\n";
    for (let i = 0; i < v.length; i++) s += `  @location(${i + 1}) @interpolate(perspective, center) sampleCoord${i} : vec2f,\n`;
    return s;
  };
  const common =
    "\nstruct LeftOver {\n  delta : vec2f,\n};\n@group(1) @binding(3) var<uniform> uniforms : LeftOver;\n" +
    consts.map((c) => `${c}\n`).join("") +
    "const IS_NDC_HALF_ZRANGE = true;\nstruct Internals {\nyFactor_: f32,\ntextureOutputHeight_: f32,\n};\n@group(1) @binding(2) var<uniform> internals : Internals;\n";

  let vertex = head("vertex");
  vertex +=
    "struct VertexInputs {\n  @builtin(vertex_index) vertexIndex : u32,\n  @builtin(instance_index) instanceIndex : u32,\n@location(0) position : vec2f,\n};\nvar<private> vertexInputs : VertexInputs;\n";
  vertex += `struct FragmentInputs {\n  @builtin(position) position : vec4<f32>,\n${varyings()}};\nvar<private> vertexOutputs : FragmentInputs;\n`;
  vertex += common;
  vertex += "\n".repeat(v.length + 3);
  vertex +=
    "//#define CUSTOM_VERTEX_DEFINITIONS\n@vertex\nfn main(input : VertexInputs)->FragmentInputs {\n  vertexInputs = input;\nconst madd: vec2f= vec2f(0.5,0.5);\n//#define CUSTOM_VERTEX_MAIN_BEGIN\nvertexOutputs.sampleCenter=(vertexInputs.position*madd+madd);\n";
  for (let i = 0; i < v.length; i++) {
    vertex += `vertexOutputs.sampleCoord${i}=vertexOutputs.sampleCenter+uniforms.delta*KERNEL_OFFSET${i};\n`;
  }
  vertex +=
    "vertexOutputs.position= vec4f(vertexInputs.position,0.0,1.0);\n//#define CUSTOM_VERTEX_MAIN_END\n  vertexOutputs.position.y = vertexOutputs.position.y * internals.yFactor_;\n  return vertexOutputs;\n}";

  let fragment = head("fragment");
  fragment += `struct FragmentInputs {\n  @builtin(position) position : vec4<f32>,\n  @builtin(front_facing) frontFacing : bool,\n${varyings()}};\nvar<private> fragmentInputs : FragmentInputs;\nstruct FragmentOutputs {\n  @location(0) color : vec4<f32>,\n};\nvar<private> fragmentOutputs : FragmentOutputs;\n`;
  fragment += common;
  fragment += "@group(1) @binding(1) var textureSamplerSampler: sampler;\n@group(1) @binding(0) var textureSampler: texture_2d<f32>;\n";
  fragment += "\n".repeat(v.length + 2);
  fragment +=
    "//#define CUSTOM_FRAGMENT_DEFINITIONS\n@fragment\nfn main(input: FragmentInputs)->FragmentOutputs {  fragmentInputs = input;\n  var computedWeight: f32=0.0;\nvar blend: vec4f= vec4f(0.);\n";
  for (let i = 0; i < v.length; i++) {
    fragment += `computedWeight=KERNEL_WEIGHT${i};\nblend+=textureSample(textureSampler,textureSamplerSampler,fragmentInputs.sampleCoord${i})*computedWeight;\n`;
  }
  for (let i = 0; i < d.length; i++) {
    fragment += `computedWeight=KERNEL_DEP_WEIGHT${i};\nblend+=textureSample(textureSampler,textureSamplerSampler,fragmentInputs.sampleCenter+uniforms.delta*KERNEL_DEP_OFFSET${i})*computedWeight;\n`;
  }
  fragment += "fragmentOutputs.color=blend;\n  return fragmentOutputs;\n}";
  return { vertex, fragment };
}

/**
 * The box filter's vertex stage: Babylon's stock `postprocess` vertex as its
 * processor compiled it for the `glowDown` effect — whose `LeftOver` (the
 * effect's `scale`, then `texel`) it carries whole, as every effect's vertex
 * module carries its fragment's uniforms.
 */
export const GLOW_DOWN_VERTEX = `//#define SHADER_NAME vertex:postprocess
diagnostic(off, chromium.unreachable_code);
struct VertexInputs {
  @builtin(vertex_index) vertexIndex : u32,
  @builtin(instance_index) instanceIndex : u32,
@location(0) position : vec2<f32>,
};
var<private> vertexInputs : VertexInputs;
struct FragmentInputs {
  @builtin(position) position : vec4<f32>,
  @location(0) @interpolate(perspective, center) vUV : vec2<f32>,
};
var<private> vertexOutputs : FragmentInputs;

struct LeftOver {
  scale : vec2<f32>,
  texel : vec2f,
};
@group(1) @binding(3) var<uniform> uniforms : LeftOver;
const IS_NDC_HALF_ZRANGE = true;
struct Internals {
yFactor_: f32,
textureOutputHeight_: f32,
};
@group(1) @binding(2) var<uniform> internals : Internals;



const madd=vec2(0.5,0.5);
//#define CUSTOM_VERTEX_DEFINITIONS
@vertex
fn main(input : VertexInputs)->FragmentInputs {
  vertexInputs = input;

//#define CUSTOM_VERTEX_MAIN_BEGIN
vertexOutputs.vUV=(vertexInputs.position*madd+madd)*uniforms.scale;
vertexOutputs.position=vec4(vertexInputs.position,0.0,1.0);
//#define CUSTOM_VERTEX_MAIN_END
  vertexOutputs.position.y = vertexOutputs.position.y * internals.yFactor_;
  return vertexOutputs;
}`;

/**
 * The `low` rung's downsample: the full-resolution mask to a quarter, as a 4x4
 * box. Each tap sits one source texel off the output texel's centre, which is
 * the corner a 2x2 quad of source pixels shares, so bilinear filtering
 * averages that quad and the four taps read all sixteen pixels once. Exactly
 * so where the frame divides by four. Elsewhere the quarter target is floored,
 * a texel spans a little over four pixels (1755 / 438 is 4.007) and the taps
 * slide off the corners: the weights go uneven and about one column in 150 is
 * read faintly, against seven pixels in eight the first blur would miss
 * without this pass. `texel` is one texel of the SOURCE, the mask. As
 * Babylon's processor compiled the fragment `GlowPass` wrote for it.
 */
export const GLOW_DOWN_FRAGMENT = `//#define SHADER_NAME fragment:glowDown
diagnostic(off, chromium.unreachable_code);
struct FragmentInputs {
  @builtin(position) position : vec4<f32>,
  @builtin(front_facing) frontFacing : bool,
  @location(0) @interpolate(perspective, center) vUV : vec2<f32>,
};
var<private> fragmentInputs : FragmentInputs;
struct FragmentOutputs {
  @location(0) color : vec4<f32>,
};
var<private> fragmentOutputs : FragmentOutputs;

struct LeftOver {
  scale : vec2<f32>,
  texel : vec2f,
};
@group(1) @binding(3) var<uniform> uniforms : LeftOver;
const IS_NDC_HALF_ZRANGE = true;
struct Internals {
yFactor_: f32,
textureOutputHeight_: f32,
};
@group(1) @binding(2) var<uniform> internals : Internals;

@group(1) @binding(1) var textureSamplerSampler: sampler;
@group(1) @binding(0) var textureSampler: texture_2d<f32>;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {  fragmentInputs = input;
${"  "}
let uv = fragmentInputs.vUV;
let d = uniforms.texel;
let sum =
textureSampleLevel(textureSampler, textureSamplerSampler, uv + vec2f(-d.x, -d.y), 0.0) +
textureSampleLevel(textureSampler, textureSamplerSampler, uv + vec2f(d.x, -d.y), 0.0) +
textureSampleLevel(textureSampler, textureSamplerSampler, uv + vec2f(-d.x, d.y), 0.0) +
textureSampleLevel(textureSampler, textureSamplerSampler, uv + vec2f(d.x, d.y), 0.0);
fragmentOutputs.color = sum * 0.25;
  return fragmentOutputs;
}`;
