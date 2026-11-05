/**
 * render/waterProgram.ts — The water's program as OUR renderer draws it
 * (`BABYLON_EXIT.md` X4.6d): the one wave grid and the one far quad, drawn once
 * per body of water over the bodies in `shaders/wgsl/water.ts` — what
 * `WaterShader.ts`' `ShaderMaterial` drew through Babylon until X4.6d.
 * Owns: `WATER_FRAME_GROUP` (group 0), `WATER_SHARED`, `WATER_BODY`, `WATER_GROUP`
 * (group 1: what the map and the frame state, what one body states, and its three
 * textures), `WATER_GEOMETRY` (group 2), `WaterShared` and `createWaterShared`,
 * `WaterBodyValues` and `createWaterBodyValues`, `WATER_DEFINES`, `WATER_STATE`
 * and `waterProgram`.
 * Invariants: **the water states its own eye, its own key, its own lamps and its
 * own fog**, as its material did, under the names the bodies and `celShadow` read,
 * and the frame's fields of those names are renamed for this program alone
 * (`frameBlockExcept`) — the same layout, so the frame's one buffer binds here;
 * what a shared chunk reads of the frame is the shadows, the clouds, the lightning
 * and the lamps' cones. **Group 0 is the frame's block and only the SIX shadow maps
 * of its textures**, a prefix so each keeps its binding, because the water reads no
 * foliage and no irradiance, as its material declared none: the frame's whole group
 * and this program's three would be 17 sampled textures in the stage, and WebGPU
 * promises 16 (`WaterDraw` holds a group 0 of its own over the frame's handles). It
 * writes depth, blends nothing, culls the back face, biased nowhere.
 * Never: imports Babylon; restates a body.
 * Contract: `docs/rendering.md`, "The water".
 */
import { CONFIG } from "../config";
import { MAX_POINT_LIGHTS } from "../shaders/wgsl/celSurface";
import { WGSL_CHUNKS } from "../shaders/wgsl/chunks";
import { WATER_SURFACE, WATER_VERTEX } from "../shaders/wgsl/water";
import { FRAME_TEXTURES, frameBlockExcept } from "./frame";
import type { PipelineState } from "./PipelineCache";
import { FRAME_TARGETS } from "./targets";
import {
  assembleFragment,
  assembleVertex,
  type AssembledModule,
  type AssembledVertex,
  type Binding,
  type UniformField,
} from "./wgsl/assemble";

/** Group 1's first block: what the map and the frame state for every body alike. */
export const WATER_SHARED = {
  kind: "uniform",
  var: "waterShared",
  struct: "WaterShared",
  fields: [
    // What moves.
    { name: "camPos", type: "vec3f" },
    { name: "time", type: "f32" },
    { name: "lightDir", type: "vec3f" },
    { name: "pointCount", type: "f32" },
    { name: "lightColor", type: "vec3f" },
    { name: "washCount", type: "f32" },
    { name: "gridOrigin", type: "vec2f" },
    { name: "gridDetail", type: "vec2f" },
    // The map's light and air, and the numbers `CONFIG.water` fixes.
    { name: "ambientColor", type: "vec3f" },
    { name: "waveDrag", type: "f32" },
    { name: "skyLightColor", type: "vec3f" },
    { name: "waveBreak", type: "f32" },
    { name: "fogColor", type: "vec3f" },
    { name: "waveLap", type: "f32" },
    { name: "mistColor", type: "vec3f" },
    { name: "waveDetail", type: "f32" },
    { name: "skyZenithColor", type: "vec3f" },
    { name: "depthMax", type: "f32" },
    { name: "skyHorizonColor", type: "vec3f" },
    { name: "depthDry", type: "f32" },
    { name: "deepColor", type: "vec3f" },
    { name: "reflectance", type: "f32" },
    { name: "shallowColor", type: "vec3f" },
    { name: "fresnelPower", type: "f32" },
    { name: "bedColor", type: "vec3f" },
    { name: "sunHalo", type: "f32" },
    { name: "foamColor", type: "vec3f" },
    { name: "haloStrength", type: "f32" },
    { name: "fogParams", type: "vec2f" },
    { name: "mistParams", type: "vec2f" },
    { name: "lampCut", type: "vec2f" },
    { name: "mirrorBlur", type: "f32" },
    { name: "mirrorChop", type: "f32" },
    { name: "glintCut", type: "f32" },
    { name: "glintStrength", type: "f32" },
    { name: "sheenCut", type: "f32" },
    { name: "sheenStrength", type: "f32" },
    { name: "throughCrest", type: "f32" },
    { name: "depthFade", type: "f32" },
    { name: "bedDepth", type: "f32" },
    { name: "bedShow", type: "f32" },
    { name: "caustics", type: "f32" },
    { name: "scatter", type: "f32" },
    { name: "foamWidth", type: "f32" },
    { name: "foamScale", type: "f32" },
    { name: "foamSpeed", type: "f32" },
    { name: "foamSlope", type: "f32" },
    { name: "capLevel", type: "f32" },
    { name: "fleckStrength", type: "f32" },
    { name: "washFlatten", type: "f32" },
    { name: "washReach", type: "f32" },
    { name: "washBlur", type: "f32" },
    { name: "washFoam", type: "f32" },
    { name: "washHeight", type: "f32" },
    { name: "washLength", type: "f32" },
    { name: "washSpeed", type: "f32" },
    { name: "washSite", type: "vec4f", count: CONFIG.water.wash.sites },
    { name: "pointPos", type: "vec3f", count: MAX_POINT_LIGHTS },
    { name: "pointColor", type: "vec3f", count: MAX_POINT_LIGHTS },
    { name: "pointRange", type: "f32", count: MAX_POINT_LIGHTS },
  ],
} as const satisfies Binding;

/** Group 1's second block: what one body states, written once. */
export const WATER_BODY = {
  kind: "uniform",
  var: "waterBody",
  struct: "WaterBody",
  fields: [
    { name: "bounds", type: "vec4f" },
    { name: "reflectProbe", type: "vec4f" },
    { name: "waveFlow", type: "vec2f" },
    { name: "surfaceY", type: "f32" },
    { name: "trainCount", type: "f32" },
    { name: "crestFoam", type: "f32" },
    { name: "throughStrength", type: "f32" },
    { name: "trainA", type: "vec4f", count: CONFIG.water.waves.trains },
    { name: "trainB", type: "vec4f", count: CONFIG.water.waves.trains },
  ],
} as const satisfies Binding;

/** Group 1 in full: the two blocks, the foam mask, the bed's depth and the mirror. */
export const WATER_GROUP = [
  WATER_SHARED,
  WATER_BODY,
  { kind: "sampled", name: "foamTex", type: "texture_2d<f32>" },
  { kind: "sampled", name: "depthTex", type: "texture_2d<f32>" },
  { kind: "sampled", name: "reflectionCube", type: "texture_cube<f32>" },
] as const satisfies readonly Binding[];

/** Group 2: the grid's and the quad's vertices, end to end. */
export const WATER_GEOMETRY = [
  { kind: "storage", name: "positionData", type: "array<f32>" },
] as const satisfies readonly Binding[];

/** Floats in one element of each type the blocks hold. */
const COMPONENTS: Readonly<Record<string, number>> = { f32: 1, vec2f: 2, vec3f: 3, vec4f: 4 };

/** One tight array per field, every value zero. */
function valuesOf(fields: readonly UniformField[]): Record<string, Float32Array<ArrayBuffer>> {
  const out: Record<string, Float32Array<ArrayBuffer>> = {};
  for (const f of fields) out[f.name] = new Float32Array(COMPONENTS[f.type] * (f.count ?? 1));
  return out;
}

/** `WATER_SHARED`'s values: written in place by `WaterSystem`, its owner. */
export type WaterShared = Readonly<Record<(typeof WATER_SHARED.fields)[number]["name"], Float32Array<ArrayBuffer>>>;

/** Every value zero. Made once a map's water. */
export function createWaterShared(): WaterShared {
  return valuesOf(WATER_SHARED.fields) as WaterShared;
}

/** `WATER_BODY`'s values. */
export type WaterBodyValues = Readonly<Record<(typeof WATER_BODY.fields)[number]["name"], Float32Array<ArrayBuffer>>>;

/** Every value zero. Made once a body. */
export function createWaterBodyValues(): WaterBodyValues {
  return valuesOf(WATER_BODY.fields) as WaterBodyValues;
}

/** The frame's block for this program (the header). */
const WATER_FRAME_BLOCK = frameBlockExcept(new Set<string>(WATER_SHARED.fields.map((f) => f.name)));

/** How many of `FRAME_TEXTURES` this program binds: the six shadow maps at its head. */
const SHADOW_MAPS = 6;

/** Group 0: the frame's block, and the shadow maps at the head of its textures (the header). */
export const WATER_FRAME_GROUP: readonly Binding[] = [WATER_FRAME_BLOCK, ...FRAME_TEXTURES.slice(0, SHADOW_MAPS)];

/** The frame's palette is declared, so the block is laid out as every cel program's is. */
export const WATER_DEFINES = ["CEL_PALETTE"];

/** Opaque, and writing depth: every default (`PipelineCache`). */
export const WATER_STATE: PipelineState = {};

/** The water's modules. */
export interface WaterProgram {
  readonly vertex: AssembledVertex;
  readonly fragment: AssembledModule;
}

let built: WaterProgram | null = null;

/** The program, assembled once. */
export function waterProgram(): WaterProgram {
  if (built) return built;
  const varyings = [{ name: "vPosW", type: "vec3f" }];
  built = {
    vertex: assembleVertex(
      {
        label: "water-vertex",
        groups: [[WATER_FRAME_BLOCK], WATER_GROUP, WATER_GEOMETRY],
        attributes: [{ name: "position", type: "vec3f", from: "positionData" }],
        varyings,
        includes: {},
        body: WATER_VERTEX,
        entry: "waterVertex",
        pull: { vertex: "vertexIndex" },
      },
      WATER_DEFINES,
      FRAME_TARGETS,
    ),
    fragment: assembleFragment(
      {
        label: "water-fragment",
        diagnosticsOff: ["derivative_uniformity"],
        groups: [WATER_FRAME_GROUP, WATER_GROUP],
        varyings,
        includes: WGSL_CHUNKS,
        body: WATER_SURFACE,
        surface: "waterSurface",
      },
      WATER_DEFINES,
      FRAME_TARGETS,
    ),
  };
  return built;
}
