/**
 * shaders/wgsl/celInk.ts — The ink's two modules AS BABYLON'S PROCESSOR
 * COMPILED THEM (`BABYLON_EXIT.md` X5.2d): the `postprocess` vertex stage
 * carrying the ink's whole `LeftOver` block, and the ink's fragment with the
 * glow's compose spliced in ahead of it (`GlowPass`' header says why the
 * compose is no pass of its own), both character for character the text the
 * parent's device was handed for the `celInk` `PostProcess`
 * (`plans/webgpu-ref/post.mjs`'s module table, both probe pages — the same
 * two texts on each); and the block's layout.
 * Owns: `CEL_INK_VERTEX`, `CEL_INK_FRAGMENT`, their bindings
 * (`CEL_INK_VERTEX_BINDINGS`, `CEL_INK_FRAGMENT_BINDINGS`) and the 112-byte
 * block's layout (`CEL_INK_BLOCK`, in floats).
 * Invariants: the text is the PROCESSOR'S, not a source it would process —
 * comments gone, one statement a line, the twelve `uniform` lines (eleven
 * of the ink's and the compose's `glowIntensity`) folded into `struct
 * LeftOver` behind the vertex stage's `scale` and left as blank lines where
 * they stood, the bindings numbered as Babylon numbered them (group 1: the
 * frame 0, its depth 1, the glow's mask 2, `glowNear` 3, `glowWide` 4, their
 * samplers 5 to 8 in that order, `Internals` 9, the block 10; group 0 empty)
 * — so a pipeline built from it is the one Babylon drew with, and the probe
 * names its modules by the same tokens; the block is laid out as Babylon's
 * uniform buffer laid it out (`scale` at 0, `nearFar` 2, `tanHalfFov` 4,
 * `thresholds` 6, `fadeBand` 8, `nearBand` 10, `maskBand` 12, `tint` 14, a
 * pad, `widthBand` 16, `widthRange` 20, `creaseStroke` 22, `grain` 24 and
 * `glowIntensity` in the vec3's fourth float, 27: 28 floats).
 * Never: imports Babylon; is edited for its own sake — a change to the ink's
 * arithmetic is a change to the picture (`BABYLON_EXIT.md` rule 2), made in
 * its own commit, and the readable account of what each line does is
 * `shaders/CelInk.ts` (its header and its notes on the shader, kept from the
 * source this text was compiled from) and `docs/rendering.md`'s ink section.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 */
import type { AssembledBinding } from "../../render/wgsl/assemble";

/** Where each uniform sits in the block, in FLOATS (112 bytes: Babylon's `LeftOver`, `scale` first). */
export const CEL_INK_BLOCK = {
  floats: 28,
  scale: 0,
  nearFar: 2,
  tanHalfFov: 4,
  thresholds: 6,
  fadeBand: 8,
  nearBand: 10,
  maskBand: 12,
  tint: 14,
  widthBand: 16,
  widthRange: 20,
  creaseStroke: 22,
  grain: 24,
  /** The glow's compose's one uniform, in `grain`'s fourth float. */
  glowIntensity: 27,
} as const;

/** What the vertex module declares: `Internals` and the block (an effect's vertex module carries its whole block). */
export const CEL_INK_VERTEX_BINDINGS: readonly AssembledBinding[] = [
  { group: 1, binding: 9, kind: "uniform", name: "internals", type: "Internals" },
  { group: 1, binding: 10, kind: "uniform", name: "uniforms", type: "LeftOver" },
];

/**
 * What the fragment module declares: the frame, its depth, the glow's mask and
 * two blurred targets, the four samplers (the frame's, the mask's and the
 * two glow targets', in that order), and both blocks.
 */
export const CEL_INK_FRAGMENT_BINDINGS: readonly AssembledBinding[] = [
  { group: 1, binding: 0, kind: "texture", name: "textureSampler", type: "texture_2d<f32>" },
  { group: 1, binding: 1, kind: "texture", name: "depthTexture", type: "texture_depth_2d" },
  { group: 1, binding: 2, kind: "texture", name: "emissiveSampler", type: "texture_2d<f32>" },
  { group: 1, binding: 3, kind: "texture", name: "glowNear", type: "texture_2d<f32>" },
  { group: 1, binding: 4, kind: "texture", name: "glowWide", type: "texture_2d<f32>" },
  { group: 1, binding: 5, kind: "sampler", name: "textureSamplerSampler", type: "sampler" },
  { group: 1, binding: 6, kind: "sampler", name: "emissiveSamplerSampler", type: "sampler" },
  { group: 1, binding: 7, kind: "sampler", name: "glowNearSampler", type: "sampler" },
  { group: 1, binding: 8, kind: "sampler", name: "glowWideSampler", type: "sampler" },
  ...CEL_INK_VERTEX_BINDINGS,
];

/** Babylon's `postprocess` vertex stage, as compiled for the ink. */
export const CEL_INK_VERTEX = `//#define SHADER_NAME vertex:postprocess
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
  nearFar : vec2f,
  tanHalfFov : vec2f,
  thresholds : vec2f,
  fadeBand : vec2f,
  nearBand : vec2f,
  maskBand : vec2f,
  tint : f32,
  widthBand : vec4f,
  widthRange : vec2f,
  creaseStroke : vec2f,
  grain : vec3f,
  glowIntensity : f32,
};
@group(1) @binding(10) var<uniform> uniforms : LeftOver;
const IS_NDC_HALF_ZRANGE = true;
struct Internals {
yFactor_: f32,
textureOutputHeight_: f32,
};
@group(1) @binding(9) var<uniform> internals : Internals;



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

/** The ink, with the glow's compose in its last line, as compiled. */
export const CEL_INK_FRAGMENT = `//#define SHADER_NAME fragment:celInk
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
  nearFar : vec2f,
  tanHalfFov : vec2f,
  thresholds : vec2f,
  fadeBand : vec2f,
  nearBand : vec2f,
  maskBand : vec2f,
  tint : f32,
  widthBand : vec4f,
  widthRange : vec2f,
  creaseStroke : vec2f,
  grain : vec3f,
  glowIntensity : f32,
};
@group(1) @binding(10) var<uniform> uniforms : LeftOver;
const IS_NDC_HALF_ZRANGE = true;
struct Internals {
yFactor_: f32,
textureOutputHeight_: f32,
};
@group(1) @binding(9) var<uniform> internals : Internals;

@group(1) @binding(5) var textureSamplerSampler: sampler;
@group(1) @binding(0) var textureSampler: texture_2d<f32>;
@group(1) @binding(1) var depthTexture: texture_depth_2d;
@group(1) @binding(6) var emissiveSamplerSampler: sampler;
@group(1) @binding(2) var emissiveSampler: texture_2d<f32>;











@group(1) @binding(7) var glowNearSampler: sampler;
@group(1) @binding(3) var glowNear: texture_2d<f32>;
@group(1) @binding(8) var glowWideSampler: sampler;
@group(1) @binding(4) var glowWide: texture_2d<f32>;

fn glowAt(uv: vec2f) -> vec3f {
let near = textureSampleLevel(glowNear, glowNearSampler, uv, 0.0).rgb;
let wide = textureSampleLevel(glowWide, glowWideSampler, uv, 0.0).rgb;
return min((near + wide) * uniforms.glowIntensity, vec3f(1.0));
}
fn linearise(d: f32, nf: vec2f) -> f32 {
return (nf.x * nf.y) / (nf.y - d * (nf.y - nf.x));
}
fn rawAt(p: vec2i, dims: vec2i) -> f32 {
return textureLoad(depthTexture, clamp(p, vec2i(0), dims - vec2i(1)), 0);
}
fn ringAt(p: vec2i, dims: vec2i, r: i32, dc: f32, nf: vec2f) -> vec2f {
let rf = f32(r);
let dl = linearise(rawAt(p + vec2i(-r,  0), dims), nf);
let dr = linearise(rawAt(p + vec2i( r,  0), dims), nf);
let du = linearise(rawAt(p + vec2i( 0, -r), dims), nf);
let dd = linearise(rawAt(p + vec2i( 0,  r), dims), nf);
let sil = max(max(abs(dc - dl), abs(dc - dr)),
max(abs(dc - du), abs(dc - dd))) / (max(dc, 0.001) * rf);
let ic = 1.0 / max(dc, 0.001);
let cx = abs((1.0 / max(dl, 0.001) + 1.0 / max(dr, 0.001)) * 0.5 - ic) * dc / rf;
let cy = abs((1.0 / max(du, 0.001) + 1.0 / max(dd, 0.001)) * 0.5 - ic) * dc / rf;
return vec2f(sil, max(cx, cy));
}
fn strokeOf(m: f32, t: f32, press: f32) -> f32 {
return smoothstep(t, t * 2.0, m) * mix(press, 1.0, smoothstep(t, t * 5.0, m));
}
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {  fragmentInputs = input;
  
let frame = textureSampleLevel(textureSampler, textureSamplerSampler, input.vUV, 0.0);
let scene = frame.rgb;
let nf = uniforms.nearFar;
let dims = vec2i(textureDimensions(depthTexture, 0));
let dimsf = vec2f(dims);
let base = input.vUV * dimsf;
let n = base * uniforms.grain.z;
let wob = vec2f(
sin(n.y * 1.7 + 1.3) + 0.5 * sin(n.y * 4.3 + n.x * 1.1),
sin(n.x * 1.9 + 2.7) + 0.5 * sin(n.x * 4.7 + n.y * 0.9)
) * uniforms.grain.y;
let p = vec2i(base + wob);
let dc = linearise(rawAt(p, dims), nf);
let ndc = input.vUV * 2.0 - vec2f(1.0);
let dist = dc * length(vec3f(ndc * uniforms.tanHalfFov, 1.0));
let wb = uniforms.widthBand;
let far = saturate((dist - uniforms.widthRange.x)
/ max(0.001, uniforms.widthRange.y - uniforms.widthRange.x));
let arm = smoothstep(0.0, 1.0, saturate(dist / max(0.001, uniforms.widthRange.x)));
let nib = min(3.0, mix(wb.x, mix(wb.y, wb.z, sqrt(far)), arm) * (dimsf.y / wb.w));
let core = saturate(nib);
let flank = saturate((nib - 1.0) * 0.5);
let kNib = nib * uniforms.creaseStroke.y;
let kCore = saturate(kNib);
let kFlank = saturate((kNib - 1.0) * 0.5);
let r1 = ringAt(p, dims, 1, dc, nf);
let r2 = ringAt(p, dims, 2, dc, nf);
let press = uniforms.grain.x;
let contour = max(strokeOf(r1.x, uniforms.thresholds.x, press) * core,
strokeOf(r2.x, uniforms.thresholds.x, press) * flank);
let crease = max(strokeOf(r1.y, uniforms.thresholds.y, press) * kCore,
strokeOf(r2.y, uniforms.thresholds.y, press) * kFlank);
var edge = max(contour, crease * uniforms.creaseStroke.x);
let t = saturate((dist - uniforms.fadeBand.x) / max(0.001, uniforms.fadeBand.y - uniforms.fadeBand.x));
edge *= 1.0 - t * t;
edge *= mix(uniforms.nearBand.y, 1.0, saturate(dist / max(0.001, uniforms.nearBand.x)));
let emissive = textureSampleLevel(emissiveSampler, emissiveSamplerSampler, input.vUV, 0.0).rgb;
let lit = dot(emissive, vec3f(0.2126, 0.7152, 0.0722));
edge *= 1.0 - smoothstep(uniforms.maskBand.x, uniforms.maskBand.y, lit);
edge *= 1.0 - saturate(frame.a);
let inked = mix(scene, scene * uniforms.tint, edge);
fragmentOutputs.color = vec4f(inked + glowAt(input.vUV), 1.0);
return fragmentOutputs;
  return fragmentOutputs;
}`;
