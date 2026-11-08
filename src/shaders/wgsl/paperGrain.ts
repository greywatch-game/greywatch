/**
 * shaders/wgsl/paperGrain.ts — The paper grain's two modules AS BABYLON'S
 * PROCESSOR COMPILED THEM (`BABYLON_EXIT.md` X5.2c1): the `postprocess`
 * vertex stage carrying the grain's whole `LeftOver` block, and the grade's
 * fragment, both character for character the text the parent's device was
 * handed for the `paperGrain` `PostProcess` (`plans/webgpu-ref/post.mjs`'s
 * module table, both probe pages), with the constants `PaperGrain` folded in
 * from `CONFIG` written where they were; and the block's layout.
 * Owns: `PAPER_GRAIN_VERTEX`, `PAPER_GRAIN_FRAGMENT`, their bindings
 * (`PAPER_GRAIN_VERTEX_BINDINGS`, `PAPER_GRAIN_FRAGMENT_BINDINGS`), the
 * lattice's constants the CPU half shares (`PAPER_PERIOD`,
 * `PAPER_LEVEL_MIN`, `PAPER_LEVELS`), and the 496-byte block's layout
 * (`PAPER_GRAIN_BLOCK`, in floats).
 * Invariants: the text is the PROCESSOR'S, not a source it would process —
 * comments gone, one statement a line, the twelve `uniform` lines folded
 * into `struct LeftOver` behind the vertex stage's `scale` (and left as
 * blank lines where they stood), the bindings numbered as Babylon numbered
 * them (group 1: the input 0, the frame's depth 1, the input's sampler 2,
 * `Internals` 3, the block 4; group 0 empty), `dpdy` scaled by
 * `-internals.yFactor_` as the processor rewrites it — so a pipeline built
 * from it is the one Babylon drew with, and the probe names its modules by
 * the same tokens; the block is std140-shaped as Babylon's uniform buffer
 * laid it out (`scale` at 0, `cellOffset` at 4, the camera's basis at 100,
 * 104 and 108, `tanHalfFov` 112, `nearFar` 114, then the six scalars from
 * 116 — 124 floats).
 * Never: imports Babylon; is edited for its own sake — a change to the
 * grade's arithmetic is a change to the picture (`BABYLON_EXIT.md` rule 2),
 * made in its own commit, and the readable account of what each line does
 * is `PaperGrain.ts`' header and `docs/rendering.md`'s grade bullets.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 */
import { CONFIG } from "../../config";
import type { AssembledBinding } from "../../render/wgsl/assemble";

const P = CONFIG.graphics.paper;
/** The lattice wraps every PERIOD cells, per octave. MUST stay 256: the shader
 *  wraps with a mask and packs the wrapped point into 24 bits for one hash. */
export const PAPER_PERIOD = 256;
/** The finest octave level, as log2 of the cell in metres. */
export const PAPER_LEVEL_MIN = -12;
/** How many levels the lattice offsets cover. */
export const PAPER_LEVELS = 24;
const PERIOD = PAPER_PERIOD;
const LEVEL_MIN = PAPER_LEVEL_MIN;
const LEVELS = PAPER_LEVELS;
/** Octaves summed per pixel. */
const OCTAVES = 5;
/** The finest octave's cell, in frame pixels (`paper.rows`). */
const CELL_PIXELS = 2;
/** The sky's paper is a sphere of this radius around the eye. */
const SKY_RADIUS = 1000;

/**
 * Where each uniform sits in the block, in FLOATS (the block is 496 bytes:
 * Babylon's `LeftOver`, `scale` first because the vertex stage reads it).
 */
export const PAPER_GRAIN_BLOCK = {
  floats: 124,
  scale: 0,
  cellOffset: 4,
  camRight: 100,
  camUp: 104,
  camFwd: 108,
  tanHalfFov: 112,
  nearFar: 114,
  vignette: 116,
  grain: 117,
  aberration: 118,
  vivid: 119,
  contrast: 120,
  damage: 121,
} as const;

/** What the vertex module declares: `Internals` and the block (an effect's vertex module carries its whole block). */
export const PAPER_GRAIN_VERTEX_BINDINGS: readonly AssembledBinding[] = [
  { group: 1, binding: 3, kind: "uniform", name: "internals", type: "Internals" },
  { group: 1, binding: 4, kind: "uniform", name: "uniforms", type: "LeftOver" },
];

/** What the fragment module declares: the input, the frame's depth, the input's sampler, and both blocks. */
export const PAPER_GRAIN_FRAGMENT_BINDINGS: readonly AssembledBinding[] = [
  { group: 1, binding: 0, kind: "texture", name: "textureSampler", type: "texture_2d<f32>" },
  { group: 1, binding: 1, kind: "texture", name: "depthTexture", type: "texture_depth_2d" },
  { group: 1, binding: 2, kind: "sampler", name: "textureSamplerSampler", type: "sampler" },
  ...PAPER_GRAIN_VERTEX_BINDINGS,
];

/** Babylon's `postprocess` vertex stage, as compiled for the grain. */
export const PAPER_GRAIN_VERTEX = `//#define SHADER_NAME vertex:postprocess
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
 cellOffset : array<vec4f, ${LEVELS}>,
  camRight : vec3f,
  camUp : vec3f,
  camFwd : vec3f,
  tanHalfFov : vec2f,
  nearFar : vec2f,
  vignette : f32,
  grain : f32,
  aberration : f32,
  vivid : f32,
  contrast : f32,
  damage : f32,
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

/** The grade, as compiled. */
export const PAPER_GRAIN_FRAGMENT = `//#define SHADER_NAME fragment:paperGrain
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
 cellOffset : array<vec4f, ${LEVELS}>,
  camRight : vec3f,
  camUp : vec3f,
  camFwd : vec3f,
  tanHalfFov : vec2f,
  nearFar : vec2f,
  vignette : f32,
  grain : f32,
  aberration : f32,
  vivid : f32,
  contrast : f32,
  damage : f32,
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












const PERIOD: i32 = ${PERIOD};
const LEVEL_MIN: f32 = ${LEVEL_MIN.toFixed(1)};
const LEVEL_TOP: f32 = ${(LEVEL_MIN + LEVELS - OCTAVES).toFixed(1)};
const OCTAVES: i32 = ${OCTAVES};
const CELL_PIXELS: f32 = ${CELL_PIXELS.toFixed(1)};
const ROWS: f32 = ${P.rows.toFixed(1)};
const SKY_RADIUS: f32 = ${SKY_RADIUS.toFixed(1)};
const HELD_WITHIN: f32 = ${P.heldWithin.toFixed(3)};
const SKY_FROM: f32 = ${P.skyFrom.toFixed(1)};
const FIBRES: f32 = ${P.fibres.toFixed(3)};
const MOTTLE: f32 = ${P.mottle.toFixed(3)};
const LIT_KNEE: f32 = ${P.litKnee.toFixed(3)};
const LIT_FLOOR: f32 = ${P.litFloor.toFixed(3)};
fn linearise(d: f32, nf: vec2f) -> f32 {
return (nf.x * nf.y) / (nf.y - d * (nf.y - nf.x));
}
fn pcg(v: u32) -> u32 {
let s = v * 747796405u + 2891336453u;
let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
return (w >> 22u) ^ w;
}
fn grad(c: vec3i) -> vec3f {
let w = vec3u(c & vec3i(PERIOD - 1));
let h = pcg(w.x | (w.y << 8u) | (w.z << 16u));
return vec3f(f32(h & 1023u), f32((h >> 10u) & 1023u), f32((h >> 20u) & 1023u)) / 511.5 - 1.0;
}
fn gnoise(p: vec3f) -> f32 {
let fl = floor(p);
let i = vec3i(fl);
let f = p - fl;
let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
let n000 = dot(grad(i), f);
let n100 = dot(grad(i + vec3i(1, 0, 0)), f - vec3f(1.0, 0.0, 0.0));
let n010 = dot(grad(i + vec3i(0, 1, 0)), f - vec3f(0.0, 1.0, 0.0));
let n110 = dot(grad(i + vec3i(1, 1, 0)), f - vec3f(1.0, 1.0, 0.0));
let n001 = dot(grad(i + vec3i(0, 0, 1)), f - vec3f(0.0, 0.0, 1.0));
let n101 = dot(grad(i + vec3i(1, 0, 1)), f - vec3f(1.0, 0.0, 1.0));
let n011 = dot(grad(i + vec3i(0, 1, 1)), f - vec3f(0.0, 1.0, 1.0));
let n111 = dot(grad(i + vec3i(1, 1, 1)), f - vec3f(1.0, 1.0, 1.0));
return mix(
mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
u.z
);
}
fn band(u: f32, a: f32, b: f32, c: f32, d: f32) -> f32 {
return smoothstep(a, b, u) * (1.0 - smoothstep(c, d, u));
}
fn paper(rel: vec3f, world: bool, foot: f32) -> f32 {
let lvl = clamp(log2(foot * CELL_PIXELS), LEVEL_MIN, LEVEL_TOP + 0.999);
let e0 = floor(lvl);
let fr = lvl - e0;
var tooth = 0.0;
var toothW = 0.0;
var fibre = 0.0;
var fibreW = 0.0;
var mottle = 0.0;
var mottleW = 0.0;
for (var k: i32 = 0;
k < OCTAVES;
k++) {
let e = e0 + f32(k);
let offset = select(vec3f(0.0), uniforms.cellOffset[i32(e - LEVEL_MIN)].xyz, world);
let n = gnoise(offset + rel * pow(2.0, -e));
let u = (f32(k) - fr + 1.0) / f32(OCTAVES);
let wt = band(u, 0.0, 0.12, 0.2, 0.45);
let wf = band(u, 0.3, 0.5, 0.7, 0.9);
let wm = band(u, 0.6, 0.82, 0.9, 1.0);
let ridge = 1.0 - smoothstep(0.0, 0.045, abs(n));
tooth += n * wt;
toothW += wt * wt;
fibre += (ridge - 0.12) * wf;
fibreW += wf * wf;
mottle += n * wm;
mottleW += wm * wm;
}
return tooth / sqrt(max(toothW, 1e-4))
+ FIBRES * fibre / sqrt(max(fibreW, 1e-4))
+ MOTTLE * mottle / sqrt(max(mottleW, 1e-4));
}
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {  fragmentInputs = input;
  
let centered = input.vUV - 0.5;
let r2 = dot(centered, centered);
let offset = centered * uniforms.aberration * r2 * 0.09;
var col = vec3f(
textureSampleLevel(textureSampler, textureSamplerSampler, input.vUV + offset, 0.0).r,
textureSampleLevel(textureSampler, textureSamplerSampler, input.vUV, 0.0).g,
textureSampleLevel(textureSampler, textureSamplerSampler, input.vUV - offset, 0.0).b,
);
let dims = vec2f(textureDimensions(depthTexture, 0));
let px = clamp(vec2i(input.vUV * dims), vec2i(0), vec2i(dims) - vec2i(1));
let d = linearise(textureLoad(depthTexture, px, 0), uniforms.nearFar);
let ndc = input.vUV * 2.0 - 1.0;
let rayC = vec3f(ndc * uniforms.tanHalfFov, 1.0);
let rayW = uniforms.camRight * rayC.x + uniforms.camUp * rayC.y + uniforms.camFwd * rayC.z;
let held = d < HELD_WITHIN;
let sky = d > SKY_FROM;
let world = !(held || sky);
let rel = select(select(rayW * d, normalize(rayW) * SKY_RADIUS, sky), rayC * d, held);
let pixAngle = 2.0 * uniforms.tanHalfFov.y / ROWS;
let iso = select(d, SKY_RADIUS, sky) * pixAngle;
let slope = max(length(dpdx(rel)), length((-internals.yFactor_)*dpdy(rel))) * dims.y / ROWS;
let quantum = select(0.0, d * d / uniforms.nearFar.x * 2.5e-7, world);
let foot = max(clamp(slope, iso, iso * 6.0), quantum);
let lumC = dot(col, vec3f(0.2126, 0.7152, 0.0722));
let hi = max(col.r, max(col.g, col.b));
let sat = (hi - min(col.r, min(col.g, col.b))) / max(hi, 1e-4);
let push = 1.0 + (uniforms.vivid - 1.0) * (1.0 - sat);
col = max(vec3f(lumC) + (col - vec3f(lumC)) * push, vec3f(0.0));
let lumK = dot(col, vec3f(0.2126, 0.7152, 0.0722));
let lc = clamp(lumK, 0.0, 1.0);
let bend = uniforms.contrast * smoothstep(0.0, 0.25, lumK) * step(lumK, 1.0);
col *= mix(lumK, lc * lc * (3.0 - 2.0 * lc), bend) / max(lumK, 1e-4);
col *= 1.0 - uniforms.vignette * smoothstep(0.05, 0.62, r2);
let lumV = dot(col, vec3f(0.299, 0.587, 0.114));
col = mix(col, vec3f(lumV), clamp(r2 * 1.1, 0.0, 0.4));
col = mix(col, vec3f(0.42, 0.02, 0.03), uniforms.damage * 0.8 * smoothstep(0.04, 0.42, r2));
let g = paper(rel, world, foot) * uniforms.grain;
let sheet = select(vec3f(1.0), vec3f(1.0, 0.94, 0.82), g > 0.0);
let lit = mix(LIT_FLOOR, 1.0, smoothstep(0.0, LIT_KNEE, lumV));
col = col * (1.0 + g * 2.2) + g * sheet * (0.9 - lumV * 0.5) * lit;
fragmentOutputs.color = vec4f(col, 1.0);
  return fragmentOutputs;
}`;
