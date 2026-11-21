/**
 * render/grassProgram.ts — The grass field's programs as OUR renderer draws
 * them (`BABYLON_EXIT.md` X4.6c): the blades and the turf, each a patch mesh of
 * seeds drawn instanced with a patch an instance, over the bodies in
 * `shaders/wgsl/grass.ts` — what `GrassShader.ts`' two `ShaderMaterial`s drew
 * through Babylon until X4.6c.
 * Owns: `GRASS_BLOCK` and `GRASS_MASK` (group 1, one bind group for both
 * programs: everything the field states for itself, and the mask), the two
 * geometries (`BLADE_GEOMETRY`, `TURF_GEOMETRY`: group 2), `GrassValues` and
 * `createGrassValues`, `GRASS_DEFINES`, `BLADE_STATE`, `TURF_STATE` and
 * `grassPrograms`.
 * Invariants: **the field states its own eye, its own lamps, its own fog and
 * its own wind, as its materials did**, under the names the bodies and the
 * shared chunks read, and the frame's fields of those names are renamed for
 * these programs alone (`FIELD_FRAME_BLOCK`, `frameBlockExcept`) — the same layout, so the frame's
 * one bind group binds here as everywhere, and `pointLocal` in `celShadow`
 * reads the field's `pointPos` as it did: what a shared chunk reads of the frame
 * is the shadows, the clouds, the lightning and the lamps' cones. A patch is two
 * `vec4f`s of `patches` at `instance_index` (`PATCH_FLOATS`); the blades write
 * depth and blend nothing, no face culled; the turf writes no depth, no face
 * culled, biased by the road's own `ROAD_DEPTH_UNITS`, and blends colour
 * `SRC_ALPHA, ONE_MINUS_SRC_ALPHA` and alpha `ZERO, ONE` (`TURF_BLEND`), which
 * is the one blended draw that leaves the frame's coverage alpha alone:
 * `CelInk` scales its edge by that channel and a turf that added itself there
 * would take the ink off every blade standing in a lush field.
 * Never: imports Babylon; restates a body.
 * Contract: `docs/rendering.md`, "The grass".
 */
import { CONFIG } from "../config";
import { MAX_POINT_LIGHTS } from "../shaders/wgsl/celSurface";
import { WGSL_CHUNKS } from "../shaders/wgsl/chunks";
import { GRASS_SURFACE, GRASS_VERTEX, TURF_SURFACE, TURF_VERTEX } from "../shaders/wgsl/grass";
import { ROAD_DEPTH_UNITS } from "../world/roads";
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

/** Group 1's block: everything the field states for itself. */
export const GRASS_BLOCK = {
  kind: "uniform",
  var: "field",
  struct: "GrassField",
  fields: [
    { name: "camPos", type: "vec3f" },
    { name: "time", type: "f32" },
    { name: "lightDir", type: "vec3f" },
    { name: "keyWrap", type: "f32" },
    { name: "lightColor", type: "vec3f" },
    { name: "lodScale", type: "f32" },
    { name: "ambientColor", type: "vec3f" },
    { name: "pusherCount", type: "f32" },
    { name: "fogColor", type: "vec3f" },
    { name: "sheen", type: "f32" },
    { name: "mistColor", type: "vec3f" },
    { name: "pointCount", type: "f32" },
    { name: "rootColor", type: "vec3f" },
    { name: "tipColor", type: "vec3f" },
    { name: "rimColor", type: "vec3f" },
    { name: "fogParams", type: "vec2f" },
    { name: "mistParams", type: "vec2f" },
    { name: "windDir", type: "vec2f" },
    { name: "windParams", type: "vec2f" },
    { name: "pushParams", type: "vec2f" },
    { name: "maskSize", type: "vec2f" },
    { name: "maskHeight", type: "vec2f" },
    { name: "gustParams", type: "vec4f" },
    { name: "fieldParams", type: "vec4f" },
    { name: "maskOrigin", type: "vec4f" },
    { name: "pushers", type: "vec3f", count: CONFIG.grass.maxPushers },
    { name: "pointPos", type: "vec3f", count: MAX_POINT_LIGHTS },
    { name: "pointColor", type: "vec3f", count: MAX_POINT_LIGHTS },
    { name: "pointRange", type: "f32", count: MAX_POINT_LIGHTS },
  ],
} as const satisfies Binding;

/** The mask, group 1's other half. Read by `textureLoad` alone; a sampled binding brings a sampler with it. */
export const GRASS_MASK = { kind: "sampled", name: "maskTex", type: "texture_2d<f32>" } as const satisfies Binding;

/** A field of `GRASS_BLOCK`, by the name the bodies read it as. */
export type GrassField = (typeof GRASS_BLOCK.fields)[number]["name"];

/** The block's values: one tight array per field, written in place by whoever states it. */
export type GrassValues = Readonly<Record<GrassField, Float32Array<ArrayBuffer>>>;

/** Floats in one element of each type the block holds. */
const COMPONENTS: Readonly<Record<string, number>> = { f32: 1, vec2f: 2, vec3f: 3, vec4f: 4 };

/** Every value zero. Made once a map, by whoever fills it. */
export function createGrassValues(): GrassValues {
  const out: Record<string, Float32Array<ArrayBuffer>> = {};
  for (const f of GRASS_BLOCK.fields as readonly UniformField[]) {
    out[f.name] = new Float32Array(COMPONENTS[f.type] * (f.count ?? 1));
  }
  return out as GrassValues;
}

/** Group 2 of the blades: every blade's seeds, and this frame's patches. */
export const BLADE_GEOMETRY = [
  { kind: "storage", name: "positionData", type: "array<f32>" },
  { kind: "storage", name: "bladeData", type: "array<vec4f>" },
  { kind: "storage", name: "patches", type: "array<vec4f>" },
] as const satisfies readonly Binding[];

/** Group 2 of the turf: its three grids end to end, and this frame's patches. */
export const TURF_GEOMETRY = [
  { kind: "storage", name: "positionData", type: "array<f32>" },
  { kind: "storage", name: "patches", type: "array<vec4f>" },
] as const satisfies readonly Binding[];

/** Floats a patch takes in `patches`: (side, lift, min x, min z), (edges, corners, unused, unused). */
export const PATCH_FLOATS = 8;

/**
 * The frame's block for these programs: its one layout, with every name the
 * field states for itself renamed out of the way (the header).
 */
const FIELD_FRAME_BLOCK: Binding = frameBlockExcept(new Set<string>(GRASS_BLOCK.fields.map((f) => f.name)));

/** The frame's palette is declared, so group 0 is laid out as every cel program's is. */
export const GRASS_DEFINES = ["CEL_PALETTE"];

/** Both sides of a blade are seen and it blends nothing, writing depth. */
export const BLADE_STATE: PipelineState = { cullMode: "none" };

/** The turf's blend (the header). */
export const TURF_BLEND: GPUBlendState = {
  color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "zero", dstFactor: "one", operation: "add" },
};

/**
 * A sheet on the ground is never seen from below, so nothing is saved by
 * culling one face and nothing has to agree which way the grid winds; and it
 * writes NO depth: the floor under it wrote the surface, the blades over it are
 * drawn before it and test it out where they stand, and a sheet writing a depth
 * wherever it is a hundredth covered would hide every coplanar mark laid after it.
 */
export const TURF_STATE: PipelineState = {
  cullMode: "none",
  depthWrite: false,
  depthBias: ROAD_DEPTH_UNITS,
  blend: TURF_BLEND,
};

/** The patch a vertex stage's instance is: `main` reads it, the bodies read `uniforms.patch0`. */
const PATCH_PRIVATE = {
  var: "fieldPatch",
  struct: "FieldPatch",
  fields: [
    { name: "patch0", type: "vec4f" },
    { name: "patch1", type: "vec4f" },
  ],
};
const PATCH_PRELUDE = [
  "  fieldPatch.patch0 = patches[instanceIndex * 2u];",
  "  fieldPatch.patch1 = patches[instanceIndex * 2u + 1u];",
].join("\n");

/** The modules of one kind of draw. */
export interface GrassProgram {
  readonly vertex: AssembledVertex;
  readonly fragment: AssembledModule;
}

/** Both kinds' modules. */
export interface GrassPrograms {
  readonly blade: GrassProgram;
  readonly turf: GrassProgram;
}

let built: GrassPrograms | null = null;

/** The programs, assembled once. */
export function grassPrograms(): GrassPrograms {
  if (built) return built;
  const groupOne: readonly Binding[] = [GRASS_BLOCK, GRASS_MASK];
  const bladeVaryings = [
    { name: "vPosW", type: "vec3f" },
    { name: "vBladeN", type: "vec3f" },
    { name: "vTip", type: "f32" },
    { name: "vGust", type: "f32" },
    { name: "vShade", type: "f32" },
  ];
  const turfVaryings = [
    { name: "vPosW", type: "vec3f" },
    { name: "vNormalW", type: "vec3f" },
    { name: "vFar", type: "f32" },
  ];
  built = {
    blade: {
      vertex: assembleVertex(
        {
          label: "grass-vertex",
          groups: [[FIELD_FRAME_BLOCK], groupOne, BLADE_GEOMETRY],
          attributes: [
            { name: "position", type: "vec3f", from: "positionData" },
            { name: "blade", type: "vec4f", from: "bladeData" },
          ],
          varyings: bladeVaryings,
          includes: {},
          body: GRASS_VERTEX,
          entry: "grassVertex",
          privates: [PATCH_PRIVATE],
          instanced: true,
          pull: { vertex: "vertexIndex" },
          prelude: PATCH_PRELUDE,
        },
        GRASS_DEFINES,
        FRAME_TARGETS,
      ),
      fragment: assembleFragment(
        {
          label: "grass-fragment",
          diagnosticsOff: ["derivative_uniformity"],
          groups: [[FIELD_FRAME_BLOCK, ...FRAME_TEXTURES], groupOne],
          varyings: bladeVaryings,
          includes: WGSL_CHUNKS,
          body: GRASS_SURFACE,
          surface: "grassSurface",
        },
        GRASS_DEFINES,
        FRAME_TARGETS,
      ),
    },
    turf: {
      vertex: assembleVertex(
        {
          label: "turf-vertex",
          groups: [[FIELD_FRAME_BLOCK], groupOne, TURF_GEOMETRY],
          attributes: [{ name: "position", type: "vec3f", from: "positionData" }],
          varyings: turfVaryings,
          includes: {},
          body: TURF_VERTEX,
          entry: "turfVertex",
          privates: [PATCH_PRIVATE],
          instanced: true,
          pull: { vertex: "vertexIndex" },
          prelude: PATCH_PRELUDE,
        },
        GRASS_DEFINES,
        FRAME_TARGETS,
      ),
      fragment: assembleFragment(
        {
          label: "turf-fragment",
          diagnosticsOff: ["derivative_uniformity"],
          groups: [[FIELD_FRAME_BLOCK, ...FRAME_TEXTURES], groupOne],
          varyings: turfVaryings,
          includes: WGSL_CHUNKS,
          body: TURF_SURFACE,
          surface: "turfSurface",
        },
        GRASS_DEFINES,
        FRAME_TARGETS,
      ),
    },
  };
  return built;
}
