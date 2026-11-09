/**
 * shaders/wgsl/fxaa.ts — FXAA's two modules AS BABYLON'S PROCESSOR COMPILED
 * THEM (`BABYLON_EXIT.md` X5.2c2): Babylon's OWN `fxaa` vertex stage (not the
 * `postprocess` one: it writes `vUV` with NO `scale` multiply, and the eight
 * sample coordinates off `texelSize`, nine inter-stage variables) and the
 * fragment `shaders/Fxaa.ts` used to register under Babylon's name — both
 * character for character the text the parent's device was handed for
 * `DefaultRenderingPipeline`'s `FxaaPostProcess` (`plans/webgpu-ref/post.mjs`'s
 * module table, both probe pages), with the three tuning constants folded in
 * from `CONFIG.graphics.fxaa` written where they were; and the block's layout.
 * Owns: `FXAA_VERTEX`, `FXAA_FRAGMENT`, their bindings (`FXAA_VERTEX_BINDINGS`,
 * `FXAA_FRAGMENT_BINDINGS`) and the 16-byte block's layout (`FXAA_BLOCK`).
 * Invariants: the text is the PROCESSOR'S — comments gone, one statement a
 * line, `texelSize` folded into `struct LeftOver` ALONE (Babylon's `scale` is
 * set by every post-process's `apply` but declared by no line of FXAA's, so
 * it is in no block here), the `#ifdef MALI` arms resolved as the parent's
 * device resolved them: NOT Mali, the early exit kept at the top — Babylon's
 * `ThinFXAAPostProcess._GetDefines` tests `extractDriverInfo()` for "mali",
 * and under WebGPU that is the empty string on every device (X5.2a measured
 * it), so the Mali arm never ran under this engine on any phone and is gone
 * with the text that held it; the bindings numbered as Babylon numbered them
 * (group 1: the input 0, its sampler 1, `Internals` 2, the block 3; group 0
 * empty).
 * Never: imports Babylon; is edited for its own sake — a change to FXAA's
 * arithmetic is a change to the picture (`BABYLON_EXIT.md` rule 2), made in
 * its own commit, and the readable account is `shaders/Fxaa.ts`' header and
 * `CONFIG.graphics.fxaa`'s comments.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 */
import { CONFIG } from "../../config";
import type { AssembledBinding } from "../../render/wgsl/assemble";

const F = CONFIG.graphics.fxaa;
const f = (x: number): string => x.toFixed(4);

/** Where each uniform sits in the block, in FLOATS (16 bytes: `texelSize`, then the pad). */
export const FXAA_BLOCK = {
  floats: 4,
  texelSize: 0,
} as const;

/** What the vertex module declares: `Internals` and the block. */
export const FXAA_VERTEX_BINDINGS: readonly AssembledBinding[] = [
  { group: 1, binding: 2, kind: "uniform", name: "internals", type: "Internals" },
  { group: 1, binding: 3, kind: "uniform", name: "uniforms", type: "LeftOver" },
];

/** What the fragment module declares: the input, its sampler, and both blocks. */
export const FXAA_FRAGMENT_BINDINGS: readonly AssembledBinding[] = [
  { group: 1, binding: 0, kind: "texture", name: "textureSampler", type: "texture_2d<f32>" },
  { group: 1, binding: 1, kind: "sampler", name: "textureSamplerSampler", type: "sampler" },
  ...FXAA_VERTEX_BINDINGS,
];

/** Babylon's `fxaa` vertex stage, as compiled. */
export const FXAA_VERTEX = `//#define SHADER_NAME vertex:fxaa
diagnostic(off, chromium.unreachable_code);
struct VertexInputs {
  @builtin(vertex_index) vertexIndex : u32,
  @builtin(instance_index) instanceIndex : u32,
@location(0) position : vec2f,
};
var<private> vertexInputs : VertexInputs;
struct FragmentInputs {
  @builtin(position) position : vec4<f32>,
  @location(0) @interpolate(perspective, center) vUV : vec2f,
  @location(1) @interpolate(perspective, center) sampleCoordS : vec2f,
  @location(2) @interpolate(perspective, center) sampleCoordE : vec2f,
  @location(3) @interpolate(perspective, center) sampleCoordN : vec2f,
  @location(4) @interpolate(perspective, center) sampleCoordW : vec2f,
  @location(5) @interpolate(perspective, center) sampleCoordNW : vec2f,
  @location(6) @interpolate(perspective, center) sampleCoordSE : vec2f,
  @location(7) @interpolate(perspective, center) sampleCoordNE : vec2f,
  @location(8) @interpolate(perspective, center) sampleCoordSW : vec2f,
};
var<private> vertexOutputs : FragmentInputs;

struct LeftOver {
  texelSize : vec2f,
};
@group(1) @binding(3) var<uniform> uniforms : LeftOver;
const IS_NDC_HALF_ZRANGE = true;
struct Internals {
yFactor_: f32,
textureOutputHeight_: f32,
};
@group(1) @binding(2) var<uniform> internals : Internals;











const madd: vec2f= vec2f(0.5,0.5);
//#define CUSTOM_VERTEX_DEFINITIONS
@vertex
fn main(input : VertexInputs)->FragmentInputs {
  vertexInputs = input;

//#define CUSTOM_VERTEX_MAIN_BEGIN
vertexOutputs.vUV=(vertexInputs.position*madd+madd);
vertexOutputs.sampleCoordS=vertexOutputs.vUV+ vec2f( 0.0,1.0)*uniforms.texelSize;
vertexOutputs.sampleCoordE=vertexOutputs.vUV+ vec2f( 1.0,0.0)*uniforms.texelSize;
vertexOutputs.sampleCoordN=vertexOutputs.vUV+ vec2f( 0.0,-1.0)*uniforms.texelSize;
vertexOutputs.sampleCoordW=vertexOutputs.vUV+ vec2f(-1.0,0.0)*uniforms.texelSize;
vertexOutputs.sampleCoordNW=vertexOutputs.vUV+ vec2f(-1.0,-1.0)*uniforms.texelSize;
vertexOutputs.sampleCoordSE=vertexOutputs.vUV+ vec2f( 1.0,1.0)*uniforms.texelSize;
vertexOutputs.sampleCoordNE=vertexOutputs.vUV+ vec2f( 1.0,-1.0)*uniforms.texelSize;
vertexOutputs.sampleCoordSW=vertexOutputs.vUV+ vec2f(-1.0,1.0)*uniforms.texelSize;
vertexOutputs.position=vec4f(vertexInputs.position,0.0,1.0);
//#define CUSTOM_VERTEX_MAIN_END
  vertexOutputs.position.y = vertexOutputs.position.y * internals.yFactor_;
  return vertexOutputs;
}`;

/** FXAA 3.11's quality path at this game's three constants, as compiled. */
export const FXAA_FRAGMENT = `//#define SHADER_NAME fragment:fxaa
diagnostic(off, chromium.unreachable_code);
struct FragmentInputs {
  @builtin(position) position : vec4<f32>,
  @builtin(front_facing) frontFacing : bool,
  @location(0) @interpolate(perspective, center) vUV : vec2f,
  @location(1) @interpolate(perspective, center) sampleCoordS : vec2f,
  @location(2) @interpolate(perspective, center) sampleCoordE : vec2f,
  @location(3) @interpolate(perspective, center) sampleCoordN : vec2f,
  @location(4) @interpolate(perspective, center) sampleCoordW : vec2f,
  @location(5) @interpolate(perspective, center) sampleCoordNW : vec2f,
  @location(6) @interpolate(perspective, center) sampleCoordSE : vec2f,
  @location(7) @interpolate(perspective, center) sampleCoordNE : vec2f,
  @location(8) @interpolate(perspective, center) sampleCoordSW : vec2f,
};
var<private> fragmentInputs : FragmentInputs;
struct FragmentOutputs {
  @location(0) color : vec4<f32>,
};
var<private> fragmentOutputs : FragmentOutputs;

struct LeftOver {
  texelSize : vec2f,
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









const fxaaQualitySubpix: f32 = ${f(F.subpix)};
const fxaaQualityEdgeThreshold: f32 = ${f(F.edgeThreshold)};
const fxaaQualityEdgeThresholdMin: f32 = ${f(F.edgeThresholdMin)};
const kLumaCoefficients: vec3f = vec3f(0.2126, 0.7152, 0.0722);
fn FxaaLuma(rgba: vec4f) -> f32 {
return dot(rgba.rgb, kLumaCoefficients);
}
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {  fragmentInputs = input;
  
var posM: vec2f;
posM.x = input.vUV.x;
posM.y = input.vUV.y;
var rgbyM: vec4f = textureSampleLevel(textureSampler, textureSamplerSampler, input.vUV, 0.0);
var lumaM: f32 = FxaaLuma(rgbyM);
var lumaS: f32 = FxaaLuma(textureSampleLevel(textureSampler, textureSamplerSampler, input.sampleCoordS, 0.0));
var lumaE: f32 = FxaaLuma(textureSampleLevel(textureSampler, textureSamplerSampler, input.sampleCoordE, 0.0));
var lumaN: f32 = FxaaLuma(textureSampleLevel(textureSampler, textureSamplerSampler, input.sampleCoordN, 0.0));
var lumaW: f32 = FxaaLuma(textureSampleLevel(textureSampler, textureSamplerSampler, input.sampleCoordW, 0.0));
var maxSM: f32 = max(lumaS, lumaM);
var minSM: f32 = min(lumaS, lumaM);
var maxESM: f32 = max(lumaE, maxSM);
var minESM: f32 = min(lumaE, minSM);
var maxWN: f32 = max(lumaN, lumaW);
var minWN: f32 = min(lumaN, lumaW);
var rangeMax: f32 = max(maxWN, maxESM);
var rangeMin: f32 = min(minWN, minESM);
var rangeMaxScaled: f32 = rangeMax * fxaaQualityEdgeThreshold;
var range: f32 = rangeMax - rangeMin;
var rangeMaxClamped: f32 = max(fxaaQualityEdgeThresholdMin, rangeMaxScaled);
if (range < rangeMaxClamped) {
fragmentOutputs.color = rgbyM;
return fragmentOutputs;
}
var lumaNW: f32 = FxaaLuma(textureSampleLevel(textureSampler, textureSamplerSampler, input.sampleCoordNW, 0.0));
var lumaSE: f32 = FxaaLuma(textureSampleLevel(textureSampler, textureSamplerSampler, input.sampleCoordSE, 0.0));
var lumaNE: f32 = FxaaLuma(textureSampleLevel(textureSampler, textureSamplerSampler, input.sampleCoordNE, 0.0));
var lumaSW: f32 = FxaaLuma(textureSampleLevel(textureSampler, textureSamplerSampler, input.sampleCoordSW, 0.0));
var lumaNS: f32 = lumaN + lumaS;
var lumaWE: f32 = lumaW + lumaE;
var subpixRcpRange: f32 = 1.0 / range;
var subpixNSWE: f32 = lumaNS + lumaWE;
var edgeHorz1: f32 = (-2.0 * lumaM) + lumaNS;
var edgeVert1: f32 = (-2.0 * lumaM) + lumaWE;
var lumaNESE: f32 = lumaNE + lumaSE;
var lumaNWNE: f32 = lumaNW + lumaNE;
var edgeHorz2: f32 = (-2.0 * lumaE) + lumaNESE;
var edgeVert2: f32 = (-2.0 * lumaN) + lumaNWNE;
var lumaNWSW: f32 = lumaNW + lumaSW;
var lumaSWSE: f32 = lumaSW + lumaSE;
var edgeHorz4: f32 = (abs(edgeHorz1) * 2.0) + abs(edgeHorz2);
var edgeVert4: f32 = (abs(edgeVert1) * 2.0) + abs(edgeVert2);
var edgeHorz3: f32 = (-2.0 * lumaW) + lumaNWSW;
var edgeVert3: f32 = (-2.0 * lumaS) + lumaSWSE;
var edgeHorz: f32 = abs(edgeHorz3) + edgeHorz4;
var edgeVert: f32 = abs(edgeVert3) + edgeVert4;
var subpixNWSWNESE: f32 = lumaNWSW + lumaNESE;
var lengthSign: f32 = uniforms.texelSize.x;
var horzSpan: bool = edgeHorz >= edgeVert;
var subpixA: f32 = subpixNSWE * 2.0 + subpixNWSWNESE;
if (!horzSpan) { lumaN = lumaW;
}
if (!horzSpan) { lumaS = lumaE;
}
if (horzSpan) { lengthSign = uniforms.texelSize.y;
}
var subpixB: f32 = (subpixA * (1.0 / 12.0)) - lumaM;
var gradientN: f32 = lumaN - lumaM;
var gradientS: f32 = lumaS - lumaM;
var lumaNN: f32 = lumaN + lumaM;
var lumaSS: f32 = lumaS + lumaM;
var pairN: bool = abs(gradientN) >= abs(gradientS);
var gradient: f32 = max(abs(gradientN), abs(gradientS));
if (pairN) { lengthSign = -lengthSign;
}
var subpixC: f32 = clamp(abs(subpixB) * subpixRcpRange, 0.0, 1.0);
var posB: vec2f;
posB.x = posM.x;
posB.y = posM.y;
var offNP: vec2f;
offNP.x = select(uniforms.texelSize.x, 0.0, (!horzSpan));
offNP.y = select(uniforms.texelSize.y, 0.0, (horzSpan));
if (!horzSpan) { posB.x += lengthSign * 0.5;
}
if (horzSpan) { posB.y += lengthSign * 0.5;
}
var posN: vec2f;
posN.x = posB.x - offNP.x * 1.5;
posN.y = posB.y - offNP.y * 1.5;
var posP: vec2f;
posP.x = posB.x + offNP.x * 1.5;
posP.y = posB.y + offNP.y * 1.5;
var subpixD: f32 = ((-2.0) * subpixC) + 3.0;
var lumaEndN: f32 = FxaaLuma(textureSampleLevel(textureSampler, textureSamplerSampler, posN, 0.0));
var subpixE: f32 = subpixC * subpixC;
var lumaEndP: f32 = FxaaLuma(textureSampleLevel(textureSampler, textureSamplerSampler, posP, 0.0));
if (!pairN) { lumaNN = lumaSS;
}
var gradientScaled: f32 = gradient * 1.0 / 4.0;
var lumaMM: f32 = lumaM - lumaNN * 0.5;
var subpixF: f32 = subpixD * subpixE;
var lumaMLTZero: bool = lumaMM < 0.0;
lumaEndN -= lumaNN * 0.5;
lumaEndP -= lumaNN * 0.5;
var doneN: bool = abs(lumaEndN) >= gradientScaled;
var doneP: bool = abs(lumaEndP) >= gradientScaled;
if (!doneN) { posN.x -= offNP.x * 3.0;
}
if (!doneN) { posN.y -= offNP.y * 3.0;
}
var doneNP: bool = (!doneN) || (!doneP);
if (!doneP) { posP.x += offNP.x * 3.0;
}
if (!doneP) { posP.y += offNP.y * 3.0;
}
if (doneNP) {
if (!doneN) { lumaEndN = FxaaLuma(textureSampleLevel(textureSampler, textureSamplerSampler, posN.xy, 0.0));
}
if (!doneP) { lumaEndP = FxaaLuma(textureSampleLevel(textureSampler, textureSamplerSampler, posP.xy, 0.0));
}
if (!doneN) { lumaEndN = lumaEndN - lumaNN * 0.5;
}
if (!doneP) { lumaEndP = lumaEndP - lumaNN * 0.5;
}
doneN = abs(lumaEndN) >= gradientScaled;
doneP = abs(lumaEndP) >= gradientScaled;
if (!doneN) { posN.x -= offNP.x * 12.0;
}
if (!doneN) { posN.y -= offNP.y * 12.0;
}
doneNP = (!doneN) || (!doneP);
if (!doneP) { posP.x += offNP.x * 12.0;
}
if (!doneP) { posP.y += offNP.y * 12.0;
}
}
var dstN: f32 = posM.x - posN.x;
var dstP: f32 = posP.x - posM.x;
if (!horzSpan) { dstN = posM.y - posN.y;
}
if (!horzSpan) { dstP = posP.y - posM.y;
}
var goodSpanN: bool = (lumaEndN < 0.0) != lumaMLTZero;
var spanLength: f32 = (dstP + dstN);
var goodSpanP: bool = (lumaEndP < 0.0) != lumaMLTZero;
var spanLengthRcp: f32 = 1.0 / spanLength;
var directionN: bool = dstN < dstP;
var dst: f32 = min(dstN, dstP);
var goodSpan: bool = select(goodSpanP, goodSpanN, directionN);
var subpixG: f32 = subpixF * subpixF;
var pixelOffset: f32 = (dst * (-spanLengthRcp)) + 0.5;
var subpixH: f32 = subpixG * fxaaQualitySubpix;
var pixelOffsetGood: f32 = select(0.0, pixelOffset, goodSpan);
var pixelOffsetSubpix: f32 = max(pixelOffsetGood, subpixH);
if (!horzSpan) { posM.x += pixelOffsetSubpix * lengthSign;
}
if (horzSpan) { posM.y += pixelOffsetSubpix * lengthSign;
}
fragmentOutputs.color = textureSampleLevel(textureSampler, textureSamplerSampler, posM, 0.0);
  return fragmentOutputs;
}`;
