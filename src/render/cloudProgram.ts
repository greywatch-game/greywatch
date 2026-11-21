/**
 * render/cloudProgram.ts — The cloud ring's program as OUR renderer draws it
 * (`BABYLON_EXIT.md` X4.5b): one triangle soup, a vertex an index into it, drawn
 * into the frame's main pass — what `CloudShader.ts`'s `ShaderMaterial` drew
 * until X4.5b, over the same bodies (`shaders/wgsl/cloud.ts`).
 * Owns: `CLOUD_BLOCK` (group 1: the ring's `world`, the eye `Sky` pushes, its
 * depth line and every value the pixel is lit with), `CLOUD_GEOMETRY` (group 2:
 * the soup's positions, facet normals, smooth normals and the index the painter's
 * order is written into), `CLOUD_VARYINGS`, `CloudRecipe` (what the ring is drawn
 * WITH, as plain data) and `cloudProgram`, the pipeline's two modules.
 * Invariants: a vertex is the index the draw's `vertexIndex` steps into
 * (`indexData`, which `Sky.sortClouds` rewrites, farthest lump first); the
 * camera's matrix is the FRAME's and everything else the block's, the eye
 * included — the block's is `Sky.update`'s, the frame's is not the same field —
 * so no name is declared twice; group 0 is the cel FRAGMENT's whole group, so the
 * frame's one bind group serves this pipeline as it serves every cel one; the
 * fragment writes its own depth (`FragmentProgram.writesDepth`).
 * Never: imports Babylon; restates the body.
 * Contract: `docs/rendering.md`, "The sky".
 */
import { WGSL_CHUNKS } from "../shaders/wgsl/chunks";
import { CLOUD_SURFACE, CLOUD_VERTEX } from "../shaders/wgsl/cloud";
import { FRAME_BLOCK, FRAME_TEXTURES } from "./frame";
import { FRAME_TARGETS } from "./targets";
import {
  assembleFragment,
  assembleVertex,
  type AssembledModule,
  type AssembledVertex,
  type Binding,
} from "./wgsl/assemble";

/**
 * Group 1: everything the material held that the frame does not. `cloudEye` is
 * the `camPos` the material was pushed: `Sky.update`'s `eye`, as it stood at
 * that push, which the frame's own `camPos` is not bound to be.
 */
export const CLOUD_BLOCK = {
  kind: "uniform",
  var: "cloud",
  struct: "CloudMaterial",
  fields: [
    { name: "world", type: "mat4x4f" },
    { name: "cloudEye", type: "vec3f" },
    { name: "depthRay", type: "vec4f" },
    { name: "depthLine", type: "vec2f" },
    { name: "sunDir", type: "vec3f" },
    { name: "shadeColor", type: "vec3f" },
    { name: "litColor", type: "vec3f" },
    { name: "hazeColor", type: "vec3f" },
    { name: "zenithColor", type: "vec3f" },
    { name: "glowColor", type: "vec3f" },
    { name: "look", type: "vec4f" },
    { name: "form", type: "vec4f" },
    { name: "tones", type: "vec2f" },
    { name: "fill", type: "vec2f" },
  ],
} as const satisfies Binding;

/** A field of `CLOUD_BLOCK`, by the name the body reads it as. */
export type CloudField = (typeof CLOUD_BLOCK.fields)[number]["name"];

/** Group 2, the vertex stage's: the soup's three attributes, and the index the sort rewrites. */
export const CLOUD_GEOMETRY = [
  { kind: "storage", name: "positionData", type: "array<f32>" },
  { kind: "storage", name: "normalData", type: "array<f32>" },
  { kind: "storage", name: "smoothNormalData", type: "array<f32>" },
  { kind: "storage", name: "indexData", type: "array<u32>" },
] as const satisfies readonly Binding[];

/** What the vertex stage hands the pixel. */
export const CLOUD_VARYINGS = [
  { name: "vNormalW", type: "vec3f" },
  { name: "vSmoothW", type: "vec3f" },
  { name: "vDir", type: "vec3f" },
] as const;

/**
 * What the ring is drawn with, as `CloudShader.ts` states it (`CloudPaint`):
 * each field of `CLOUD_BLOCK` a `Float32Array` written in place, so a reader
 * holding it sees every later write.
 */
export interface CloudRecipe {
  readonly values: Readonly<Record<CloudField, Float32Array>>;
}

/** The frame's palette is declared, so group 0 is laid out as every cel program's is. */
const DEFINES = ["CEL_PALETTE"];

/** The pipeline's two modules. */
export interface CloudProgram {
  readonly vertex: AssembledVertex;
  readonly fragment: AssembledModule;
}

let built: CloudProgram | null = null;

/** The ring's program, assembled once. */
export function cloudProgram(): CloudProgram {
  if (built) return built;
  built = {
    vertex: assembleVertex(
      {
        label: "cloud-vertex",
        groups: [[FRAME_BLOCK], [CLOUD_BLOCK], CLOUD_GEOMETRY],
        attributes: [
          { name: "position", type: "vec3f", from: "positionData" },
          { name: "normal", type: "vec3f", from: "normalData" },
          { name: "smoothNormal", type: "vec3f", from: "smoothNormalData" },
        ],
        varyings: CLOUD_VARYINGS,
        includes: {},
        body: CLOUD_VERTEX,
        entry: "cloudVertex",
        pull: { vertex: "vertex", decode: "  let vertex = indexData[vertexIndex];" },
      },
      DEFINES,
      FRAME_TARGETS,
    ),
    fragment: assembleFragment(
      {
        label: "cloud-fragment",
        // `fwidth`, which WGSL's uniformity analysis cannot prove uniform: the
        // define the fragment carried under Babylon, as the cel fragment's does.
        diagnosticsOff: ["derivative_uniformity"],
        groups: [[FRAME_BLOCK, ...FRAME_TEXTURES], [CLOUD_BLOCK]],
        varyings: CLOUD_VARYINGS,
        includes: WGSL_CHUNKS,
        body: CLOUD_SURFACE,
        surface: "cloudSurface",
        writesDepth: true,
      },
      DEFINES,
      FRAME_TARGETS,
    ),
  };
  return built;
}
