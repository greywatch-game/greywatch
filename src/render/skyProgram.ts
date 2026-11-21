/**
 * render/skyProgram.ts — The dome's and the moon's program as OUR renderer draws
 * them (`BABYLON_EXIT.md` X4.5c): one vertex stage and three fragment variants,
 * what `StandardMaterial` drew the two with and `GlowPass`'s mask material the
 * moon's bloom with, until X4.5c.
 * Owns: `SKY_BLOCK` (group 1: a piece's world, its emissive colour and its bloom
 * colour), `SKY_TEXTURE` (group 1 after it: the painted texture, ours),
 * `SKY_GEOMETRY` (group 2: its positions, uvs and index), `SKY_VARYINGS`,
 * `SkyRecipe` (what a piece is drawn WITH, as plain data), `SKY_BLEND` and
 * `skyPrograms`, the modules.
 * Invariants: a vertex is the index the draw's `vertexIndex` steps into, the
 * index never rewritten; the camera's matrix is the FRAME's and everything else
 * the block's; group 0 is the cel FRAGMENT's whole group, so the frame's one bind
 * group serves every variant as it serves every cel program; one vertex module
 * serves the main pass and the mask, as `GlowPass`'s comment asks of a mask: the
 * same expression in the same order.
 * Never: imports Babylon; restates a body.
 * Contract: `docs/rendering.md`, "The sky".
 */
import type { OwnTexture } from "./HostBindGroup";
import { FRAME_BLOCK, FRAME_TEXTURES } from "./frame";
import { FRAME_TARGETS, GLOW_TARGETS } from "./targets";
import { SKY_SURFACE, SKY_VERTEX } from "../shaders/wgsl/sky";
import {
  assembleFragment,
  assembleVertex,
  type AssembledModule,
  type AssembledVertex,
  type Binding,
} from "./wgsl/assemble";

/** Group 1's block: everything a piece's material held that the frame does not. */
export const SKY_BLOCK = {
  kind: "uniform",
  var: "sky",
  struct: "SkyMaterial",
  fields: [
    { name: "skyWorld", type: "mat4x4f" },
    { name: "skyEmissive", type: "vec3f" },
    { name: "skyGlow", type: "vec4f" },
  ],
} as const satisfies Binding;

/** Group 1 after the block: the painted texture, with its own view and sampler (`TextureMaker`'s, `BABYLON_EXIT.md` X5.4d). */
export const SKY_TEXTURE = { kind: "sampled", name: "skyTexture", type: "texture_2d<f32>" } as const satisfies Binding;

/** A field of `SKY_BLOCK`, by the name the body reads it as. */
export type SkyField = (typeof SKY_BLOCK.fields)[number]["name"];

/** Group 2, the vertex stage's: the piece's two attributes, and its index. */
export const SKY_GEOMETRY = [
  { kind: "storage", name: "positionData", type: "array<f32>" },
  { kind: "storage", name: "uvData", type: "array<vec2f>" },
  { kind: "storage", name: "indexData", type: "array<u32>" },
] as const satisfies readonly Binding[];

/** What the vertex stage hands the pixel. */
export const SKY_VARYINGS = [{ name: "vUV", type: "vec2f" }] as const;

/**
 * What a piece is drawn with: each field of `SKY_BLOCK` a `Float32Array` written
 * in place, so a reader holding it sees every later write, and the texture it is
 * painted on.
 */
export interface SkyRecipe {
  readonly values: Readonly<Record<SkyField, Float32Array>>;
  readonly texture: OwnTexture;
}

/** `ALPHA_COMBINE`'s factors (Babylon's `alphaCullingState`, mode 2): the moon's, in both passes. */
export const SKY_BLEND: GPUBlendState = {
  color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
};

/** The frame's palette is declared, so group 0 is laid out as every cel program's is. */
const DEFINES = ["CEL_PALETTE"];

/** The modules: one vertex stage, and the fragment each of the three draws is. */
export interface SkyPrograms {
  readonly vertex: AssembledVertex;
  readonly dome: AssembledModule;
  readonly moon: AssembledModule;
  readonly moonGlow: AssembledModule;
}

let built: SkyPrograms | null = null;

/** The programs, assembled once. */
export function skyPrograms(): SkyPrograms {
  if (built) return built;
  if (FRAME_TARGETS.flipY !== GLOW_TARGETS.flipY) {
    throw new Error("skyPrograms: the main pass and the glow's mask flip differently; one sky stage cannot serve both");
  }
  const fragment = (label: string, extra: readonly string[]): AssembledModule =>
    assembleFragment(
      {
        label,
        groups: [[FRAME_BLOCK, ...FRAME_TEXTURES], [SKY_BLOCK, SKY_TEXTURE]],
        varyings: SKY_VARYINGS,
        includes: {},
        body: SKY_SURFACE,
        surface: "skySurface",
      },
      [...DEFINES, ...extra],
      FRAME_TARGETS,
    );
  built = {
    vertex: assembleVertex(
      {
        label: "sky-vertex",
        groups: [[FRAME_BLOCK], [SKY_BLOCK], SKY_GEOMETRY],
        attributes: [
          { name: "position", type: "vec3f", from: "positionData" },
          { name: "uv", type: "vec2f", from: "uvData" },
        ],
        varyings: SKY_VARYINGS,
        includes: {},
        body: SKY_VERTEX,
        entry: "skyVertex",
        pull: { vertex: "vertex", decode: "  let vertex = indexData[vertexIndex];" },
      },
      DEFINES,
      FRAME_TARGETS,
    ),
    dome: fragment("sky-dome-fragment", []),
    moon: fragment("sky-moon-fragment", ["SKY_OPACITY"]),
    moonGlow: fragment("sky-moon-glow-fragment", ["SKY_GLOW"]),
  };
  return built;
}
