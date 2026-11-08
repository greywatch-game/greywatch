/**
 * shaders/wgsl/volumetrics.ts — The light shafts' modules AS BABYLON'S
 * PROCESSOR COMPILED THEM (`BABYLON_EXIT.md` X5.2c2): the `postprocess`
 * vertex stage carrying the shafts' whole `LeftOver` block (one text for
 * every rung: the block is the same), and the march's fragment, one text a
 * RUNG — each character for character the text the parent's device was
 * handed for that rung's `volumetrics_<rung>` `PostProcess`
 * (`plans/webgpu-ref/post.mjs`'s module table, both probe pages), with the
 * three things `Volumetrics` folded in from `CONFIG` written where they were
 * (the rung's name, its `SAMPLES`, and `shadows.edgeFade` as `EDGE_FADE`);
 * and the block's layout.
 * Owns: `VOLUMETRICS_VERTEX`, `volumetricsFragment(rung)`, their bindings
 * (`VOLUMETRICS_VERTEX_BINDINGS`, `VOLUMETRICS_FRAGMENT_BINDINGS`) and the
 * 320-byte block's layout (`VOLUMETRICS_BLOCK`, in floats).
 * Invariants: the text is the PROCESSOR'S, not a source it would process —
 * comments gone, one statement a line, `#include<celCloud>` expanded where it
 * stood, the fifteen `uniform` lines folded into `struct LeftOver` behind the
 * vertex stage's `scale` in the processor's order (the include's two first,
 * then the march's own) and left as blank lines where they stood, the
 * bindings numbered as Babylon numbered them (group 1: the input 0, the
 * frame's depth 1, the world's shadow map 2, the bodies' 3, the clouds'
 * field 4, then the samplers of the input 5, the two maps 6 and 7 and the
 * field 8, `Internals` 9, the block 10; group 0 empty) — so a pipeline built
 * from it is the one Babylon drew with, and the probe names its modules by
 * the same tokens; the block is laid out as Babylon's uniform buffer laid it
 * out (`scale` 0, `cloudShadow` 4, `cloudShadowRay` 8, the two matrices 12
 * and 28, `air` 44, the five vec3s on 16-byte rows from 48 to 68 and `tint`
 * 68, `tanHalfFov` 72, `nearFar` 74, `march` 76 with `intensity` in its
 * fourth float, 79: 80 floats).
 * Never: imports Babylon; is edited for its own sake — a change to the
 * march's arithmetic is a change to the picture (`BABYLON_EXIT.md` rule 2),
 * made in its own commit, and the readable account of what each line does is
 * `Volumetrics.ts`' header and `docs/rendering.md`'s light-shaft section.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 */
import { CONFIG } from "../../config";
import type { AssembledBinding } from "../../render/wgsl/assemble";

/** The rungs, derived from the config so the ladder is declared exactly once. */
export type VolumetricRung = keyof typeof CONFIG.graphics.volumetrics.rungs;

/**
 * `CONFIG.graphics.shadows.edgeFade` as the literal the march was compiled
 * with — the surfaces' own ramp, so the air and the floor under it stop
 * being shadowed together (`Volumetrics.ts`).
 */
const EDGE_FADE = Math.max(CONFIG.graphics.shadows.edgeFade, 1e-4).toFixed(4);

/** Where each uniform sits in the block, in FLOATS (320 bytes: Babylon's `LeftOver`, `scale` first). */
export const VOLUMETRICS_BLOCK = {
  floats: 80,
  scale: 0,
  cloudShadow: 4,
  cloudShadowRay: 8,
  lightMatrix: 12,
  bodyLightMatrix: 28,
  air: 44,
  camPos: 48,
  camRight: 52,
  camUp: 56,
  camFwd: 60,
  moonDir: 64,
  tint: 68,
  tanHalfFov: 72,
  nearFar: 74,
  march: 76,
  intensity: 79,
} as const;

/** What the vertex module declares: `Internals` and the block (an effect's vertex module carries its whole block). */
export const VOLUMETRICS_VERTEX_BINDINGS: readonly AssembledBinding[] = [
  { group: 1, binding: 9, kind: "uniform", name: "internals", type: "Internals" },
  { group: 1, binding: 10, kind: "uniform", name: "uniforms", type: "LeftOver" },
];

/** What a rung's fragment module declares: the five textures, their four samplers, and both blocks. */
export const VOLUMETRICS_FRAGMENT_BINDINGS: readonly AssembledBinding[] = [
  { group: 1, binding: 0, kind: "texture", name: "textureSampler", type: "texture_2d<f32>" },
  { group: 1, binding: 1, kind: "texture", name: "depthTexture", type: "texture_depth_2d" },
  { group: 1, binding: 2, kind: "texture", name: "shadowMap", type: "texture_2d<f32>" },
  { group: 1, binding: 3, kind: "texture", name: "bodyShadowMap", type: "texture_2d<f32>" },
  { group: 1, binding: 4, kind: "texture", name: "cloudShadowMap", type: "texture_2d<f32>" },
  { group: 1, binding: 5, kind: "sampler", name: "textureSamplerSampler", type: "sampler" },
  { group: 1, binding: 6, kind: "sampler", name: "shadowMapSampler", type: "sampler" },
  { group: 1, binding: 7, kind: "sampler", name: "bodyShadowMapSampler", type: "sampler" },
  { group: 1, binding: 8, kind: "sampler", name: "cloudShadowMapSampler", type: "sampler" },
  ...VOLUMETRICS_VERTEX_BINDINGS,
];

/** Babylon's `postprocess` vertex stage, as compiled for the shafts (every rung's). */
export const VOLUMETRICS_VERTEX = `//#define SHADER_NAME vertex:postprocess
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
  cloudShadow : vec4f,
  cloudShadowRay : vec4f,
  lightMatrix : mat4x4f,
  bodyLightMatrix : mat4x4f,
  air : vec4f,
  camPos : vec3f,
  camRight : vec3f,
  camUp : vec3f,
  camFwd : vec3f,
  moonDir : vec3f,
  tint : vec3f,
  tanHalfFov : vec2f,
  nearFar : vec2f,
  march : vec3f,
  intensity : f32,
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

/** The march at `rung`, as compiled: its tap count a WGSL `const`, so each rung is its own module. */
export function volumetricsFragment(rung: VolumetricRung): string {
  const samples = CONFIG.graphics.volumetrics.rungs[rung];
  return `//#define SHADER_NAME fragment:volumetrics_${rung}
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
  cloudShadow : vec4f,
  cloudShadowRay : vec4f,
  lightMatrix : mat4x4f,
  bodyLightMatrix : mat4x4f,
  air : vec4f,
  camPos : vec3f,
  camRight : vec3f,
  camUp : vec3f,
  camFwd : vec3f,
  moonDir : vec3f,
  tint : vec3f,
  tanHalfFov : vec2f,
  nearFar : vec2f,
  march : vec3f,
  intensity : f32,
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
@group(1) @binding(6) var shadowMapSampler: sampler;
@group(1) @binding(2) var shadowMap: texture_2d<f32>;
@group(1) @binding(7) var bodyShadowMapSampler: sampler;
@group(1) @binding(3) var bodyShadowMap: texture_2d<f32>;


@group(1) @binding(8) var cloudShadowMapSampler: sampler;
@group(1) @binding(4) var cloudShadowMap: texture_2d<f32>;
fn cloudShadowAt(p: vec3f) -> vec2f {
let key = p.xz - uniforms.cloudShadowRay.xy * p.y;
let uv = (key - uniforms.cloudShadow.xy) * uniforms.cloudShadow.z;
let two = textureSampleLevel(cloudShadowMap, cloudShadowMapSampler, uv, 0.0).rg;
let field = mix(two.x, two.y, uniforms.cloudShadowRay.z) - 0.5;
let edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
return vec2f(field, smoothstep(0.0, 0.05, edge));
}
fn cloudLit(p: vec3f) -> f32 {
let c = cloudShadowAt(p);
let w = max(max(fwidth(c.x), uniforms.cloudShadowRay.w), 1e-4);
return mix(1.0, uniforms.cloudShadow.w, smoothstep(-w, w, c.x) * c.y);
}
fn cloudLitAir(p: vec3f) -> f32 {
let c = cloudShadowAt(p);
let w = max(uniforms.cloudShadowRay.w, 1e-4);
return mix(1.0, uniforms.cloudShadow.w, smoothstep(-w, w, c.x) * c.y);
}













const SAMPLES: i32 = ${samples};
const PI: f32 = 3.14159265359;
fn hash(p: vec2f) -> f32 {
return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123);
}
fn linearise(d: f32, nf: vec2f) -> f32 {
return (nf.x * nf.y) / (nf.y - d * (nf.y - nf.x));
}
fn litIn(m: mat4x4f, tex: texture_2d<f32>, smp: sampler, p: vec3f, bias: f32) -> f32 {
let sc4 = m * vec4f(p, 1.0);
let sc = sc4.xyz / sc4.w;
let uv = sc.xy * 0.5 + 0.5;
let edge = min(
min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)),
min(sc.z, 1.0 - sc.z)
);
if (edge <= 0.0) { return 1.0;
}
let lit = step(sc.z - bias, textureSampleLevel(tex, smp, uv, 0.0).x);
return mix(1.0, lit, smoothstep(0.0, ${EDGE_FADE}, edge));
}
fn shadowAt(p: vec3f) -> f32 {
let world = litIn(uniforms.lightMatrix, shadowMap, shadowMapSampler, p,
uniforms.march.y);
let bodies = litIn(uniforms.bodyLightMatrix, bodyShadowMap, bodyShadowMapSampler,
p, uniforms.march.z);
return min(min(world, bodies), cloudLitAir(p));
}
fn phaseHG(cosT: f32, g: f32) -> f32 {
let g2 = g * g;
return (1.0 - g2) / (4.0 * PI * pow(max(1e-4, 1.0 + g2 - 2.0 * g * cosT), 1.5));
}
fn dither(col: vec3f, px: vec2f) -> vec3f {
return col + (hash(px) - hash(px + 17.31)) * (1.0 / 255.0);
}
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {  fragmentInputs = input;
  
let scene = textureSampleLevel(textureSampler, textureSamplerSampler, input.vUV, 0.0).rgb;
let ndc = input.vUV * 2.0 - 1.0;
let rayC = vec3f(ndc * uniforms.tanHalfFov, 1.0);
let rayW = uniforms.camRight * rayC.x + uniforms.camUp * rayC.y + uniforms.camFwd * rayC.z;
let dims = vec2f(textureDimensions(depthTexture, 0));
let px = clamp(vec2i(input.vUV * dims), vec2i(0), vec2i(dims) - vec2i(1));
let far = min(linearise(textureLoad(depthTexture, px, 0), uniforms.nearFar), uniforms.march.x);
let stepLen = far / f32(SAMPLES);
let jitter = hash(input.vUV * dims);
var accum = 0.0;
for (var i: i32 = 0;
i < SAMPLES;
i++) {
let p = uniforms.camPos + rayW * ((f32(i) + jitter) * stepLen);
let dens = exp(-max(0.0, p.y - uniforms.air.z) * uniforms.air.y);
accum += shadowAt(p) * dens;
}
accum *= stepLen * uniforms.air.x;
let phase = phaseHG(dot(normalize(rayW), uniforms.moonDir), uniforms.air.w);
let raw = uniforms.tint * (accum * phase * uniforms.intensity);
let lit = raw / max(1.0, max(raw.r, max(raw.g, raw.b)));
let col = scene + lit * (vec3f(1.0) - clamp(scene, vec3f(0.0), vec3f(1.0)));
fragmentOutputs.color = vec4f(dither(col, input.vUV * dims), 1.0);
  return fragmentOutputs;
}`;
}
