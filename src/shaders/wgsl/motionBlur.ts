/**
 * shaders/wgsl/motionBlur.ts — The motion blur's two modules AS BABYLON'S
 * PROCESSOR COMPILED THEM (`BABYLON_EXIT.md` X5.2c2): the `postprocess`
 * vertex stage carrying the blur's whole `LeftOver` block, and the smear's
 * fragment, both character for character the text the parent's device was
 * handed for the `motionBlur` `PostProcess` (`plans/webgpu-ref/post.mjs`'s
 * module table, both probe pages), with the one constant `MotionBlur` folded
 * in from `CONFIG` (`SAMPLES`) written where it was; and the block's layout.
 * Owns: `MOTION_BLUR_VERTEX`, `MOTION_BLUR_FRAGMENT`, their bindings
 * (`MOTION_BLUR_VERTEX_BINDINGS`, `MOTION_BLUR_FRAGMENT_BINDINGS`) and the
 * 112-byte block's layout (`MOTION_BLUR_BLOCK`, in floats).
 * Invariants: the text is the PROCESSOR'S, not a source it would process —
 * comments gone, one statement a line, the seven `uniform` lines folded into
 * `struct LeftOver` behind the vertex stage's `scale` (and left as blank
 * lines where they stood), the bindings numbered as Babylon numbered them
 * (group 1: the input 0, the frame's depth 1, the input's sampler 2,
 * `Internals` 3, the block 4; group 0 empty) — so a pipeline built from it is
 * the one Babylon drew with, and the probe names its modules by the same
 * tokens; the block is laid out as Babylon's uniform buffer laid it out
 * (`scale` at 0, the `mat3x3f` as three vec4-aligned COLUMNS at 4, 8 and 12 —
 * nine floats repacked into twelve, the fourth of each column zero —
 * `tanHalfFov` 16, `strength` 18, `maxShift` 19, `mask` 20, `nearFar` 22,
 * `nearBand` 24: 28 floats).
 * Never: imports Babylon; is edited for its own sake — a change to the
 * smear's arithmetic is a change to the picture (`BABYLON_EXIT.md` rule 2),
 * made in its own commit, and the readable account of what each line does is
 * `MotionBlur.ts`' header and `docs/rendering.md`'s smear section.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 */
import { CONFIG } from "../../config";
import type { AssembledBinding } from "../../render/wgsl/assemble";

/** Where each uniform sits in the block, in FLOATS (112 bytes: Babylon's `LeftOver`, `scale` first). */
export const MOTION_BLUR_BLOCK = {
  floats: 28,
  scale: 0,
  /** Three columns of four floats, the last of each a pad. */
  reproject: 4,
  tanHalfFov: 16,
  strength: 18,
  maxShift: 19,
  mask: 20,
  nearFar: 22,
  nearBand: 24,
} as const;

/** What the vertex module declares: `Internals` and the block (an effect's vertex module carries its whole block). */
export const MOTION_BLUR_VERTEX_BINDINGS: readonly AssembledBinding[] = [
  { group: 1, binding: 3, kind: "uniform", name: "internals", type: "Internals" },
  { group: 1, binding: 4, kind: "uniform", name: "uniforms", type: "LeftOver" },
];

/** What the fragment module declares: the input, the frame's depth, the input's sampler, and both blocks. */
export const MOTION_BLUR_FRAGMENT_BINDINGS: readonly AssembledBinding[] = [
  { group: 1, binding: 0, kind: "texture", name: "textureSampler", type: "texture_2d<f32>" },
  { group: 1, binding: 1, kind: "texture", name: "depthTexture", type: "texture_depth_2d" },
  { group: 1, binding: 2, kind: "sampler", name: "textureSamplerSampler", type: "sampler" },
  ...MOTION_BLUR_VERTEX_BINDINGS,
];

/** Babylon's `postprocess` vertex stage, as compiled for the blur. */
export const MOTION_BLUR_VERTEX = `//#define SHADER_NAME vertex:postprocess
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
  reproject : mat3x3f,
  tanHalfFov : vec2f,
  strength : f32,
  maxShift : f32,
  mask : vec2f,
  nearFar : vec2f,
  nearBand : vec2f,
};
@group(1) @binding(4) var<uniform> uniforms : LeftOver;
const IS_NDC_HALF_ZRANGE = true;
struct Internals {
yFactor_: f32,
textureOutputHeight_: f32,
};
@group(1) @binding(3) var<uniform> internals : Internals;



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

/** The smear, as compiled. */
export const MOTION_BLUR_FRAGMENT = `//#define SHADER_NAME fragment:motionBlur
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
  reproject : mat3x3f,
  tanHalfFov : vec2f,
  strength : f32,
  maxShift : f32,
  mask : vec2f,
  nearFar : vec2f,
  nearBand : vec2f,
};
@group(1) @binding(4) var<uniform> uniforms : LeftOver;
const IS_NDC_HALF_ZRANGE = true;
struct Internals {
yFactor_: f32,
textureOutputHeight_: f32,
};
@group(1) @binding(3) var<uniform> internals : Internals;

@group(1) @binding(2) var textureSamplerSampler: sampler;
@group(1) @binding(0) var textureSampler: texture_2d<f32>;
@group(1) @binding(1) var depthTexture: texture_depth_2d;







const SAMPLES: i32 = ${CONFIG.graphics.motionBlur.samples};
fn hash(p: vec2f) -> f32 {
return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123);
}
fn linearise(d: f32, nf: vec2f) -> f32 {
return (nf.x * nf.y) / (nf.y - d * (nf.y - nf.x));
}
fn worldness(uv: vec2f, dims: vec2f, nf: vec2f, band: vec2f) -> f32 {
let p = clamp(vec2i(uv * dims), vec2i(0), vec2i(dims) - vec2i(1));
return smoothstep(band.x, band.y, linearise(textureLoad(depthTexture, p, 0), nf));
}
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {  fragmentInputs = input;
  
let scene = textureSampleLevel(textureSampler, textureSamplerSampler, input.vUV, 0.0).rgb;
if (uniforms.strength <= 0.0) {
fragmentOutputs.color = vec4f(scene, 1.0);
return fragmentOutputs;
}
let ndc = input.vUV * 2.0 - 1.0;
let ray = vec3f(ndc * uniforms.tanHalfFov, 1.0);
let prev = uniforms.reproject * ray;
if (prev.z <= 0.0001) {
fragmentOutputs.color = vec4f(scene, 1.0);
return fragmentOutputs;
}
let prevUV = (prev.xy / (prev.z * uniforms.tanHalfFov)) * 0.5 + 0.5;
var shift = (prevUV - input.vUV) * uniforms.strength;
let len = length(shift);
if (len > uniforms.maxShift) { shift *= uniforms.maxShift / len;
}
let dims = vec2f(textureDimensions(depthTexture, 0));
let here = worldness(input.vUV, dims, uniforms.nearFar, uniforms.nearBand);
shift *= here;
let r = length(input.vUV - 0.5) * 2.0;
shift *= smoothstep(uniforms.mask.x, uniforms.mask.y, r);
if (length(shift * dims) < 0.5) {
fragmentOutputs.color = vec4f(scene, 1.0);
return fragmentOutputs;
}
let jitter = hash(input.vUV) - 0.5;
var accum = scene;
var total = 1.0;
for (var i: i32 = 1;
i < SAMPLES;
i++) {
let uv = clamp(input.vUV + shift * ((f32(i) + jitter) / f32(SAMPLES - 1)), vec2f(0.0), vec2f(1.0));
let w = worldness(uv, dims, uniforms.nearFar, uniforms.nearBand);
accum += textureSampleLevel(textureSampler, textureSamplerSampler, uv, 0.0).rgb * w;
total += w;
}
fragmentOutputs.color = vec4f(accum / total, 1.0);
  return fragmentOutputs;
}`;
