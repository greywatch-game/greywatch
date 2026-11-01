/**
 * render/viewProgram.ts — The VIEWMODEL's programs: the player's own weapon,
 * arms, fist and muzzle flash drawn by our renderer (`BABYLON_EXIT.md`
 * X4.3c) — the cel stage over a segment's corners, the emissive palette's
 * stage over a reticle's, and that one's twin in the glow's mask — declared
 * for our renderer.
 * Owns: `VIEW_GEOMETRY` (group 2 of all three: every attribute's array, the
 * segments' indices, and each draw's matrix — seven storage arrays, under
 * WebGPU's default ceiling of eight), `VIEW_GLOW` (the mask's group 1: each
 * draw's bloom colour), `VIEW_EMISSIVE_DEFINES` and `viewPrograms`, the
 * modules for a cel variant and the two emissive ones.
 * Invariants: the vertex and pixel BODIES are the cel material's and the
 * emissive palette's own (`celVertex`, `celFragment`, `EMISSIVE_WORLD_VERTEX`,
 * `EMISSIVE_WORLD_SURFACE`), never restated — what is the viewmodel's here is
 * the DECODE, and it is the simplest in the tree: a draw is ONE segment, one
 * instance, as Babylon drew one mesh, so a vertex is a corner of the segment
 * (`indexData` at the vertex index — the draw's `firstVertex` is the
 * segment's first index, its count the segment's index count) and the
 * instance is the DRAW (its `firstInstance` the draw's place in the frame),
 * whose matrix `world` is — what `freezeWorldMatrix` handed the mesh until
 * X4.3c — read WHOLE, all sixteen floats out of storage as Babylon's uniform
 * held them, so nothing the compiler may fold makes the product differ from
 * the one Babylon's stage computed; the emissive stage is ONE module for the
 * main pass and the mask, which is what the mask's LEQUAL tie rests on, and
 * it hands each pixel its draw (`vBody`, flat) for the mask to read that
 * draw's bloom off — the colour `GlowRules` gave the mesh, written as it was
 * (rgb the colour, a the material's alpha), never faded here.
 * Never: imports Babylon; restates a body; decides what a segment is, its
 * order, its material or which draw.
 * Contract: `docs/rendering.md`, "The weapon, ours" and "Hand-written WGSL".
 */
import { WGSL_CHUNKS } from "../shaders/wgsl/chunks";
import { EMISSIVE_WORLD_VERTEX } from "../shaders/wgsl/emissiveWorld";
import { CEL_VARYINGS, celFragment } from "./celFragment";
import { CEL_ATTRIBUTES } from "./celVertex";
import { EMISSIVE_ATTRIBUTES, EMISSIVE_VARYINGS, emissiveWorld } from "./emissiveWorld";
import { FRAME_BLOCK, FRAME_TEXTURES } from "./frame";
import { FRAME_TARGETS, GLOW_TARGETS } from "./targets";
import {
  assembleFragment,
  assembleVertex,
  type AssembledModule,
  type AssembledVertex,
  type Binding,
  type VertexProgram,
} from "./wgsl/assemble";

/**
 * Group 2 of every viewmodel program: the kit's arrays (by the names the cel
 * stage's attributes are read out of — `uv2Data` declared in every variant,
 * so the cel program and the emissive one share one layout and one bind
 * group), `indexData`, every segment's indices rebased onto the arrays, and
 * the frame's matrices, one `mat4x4f` a draw, four `vec4f` columns as
 * Babylon's `Matrix.m` lays them. Seven storage arrays.
 */
export const VIEW_GEOMETRY = [
  { kind: "storage", name: "positionData", type: "array<f32>" },
  { kind: "storage", name: "normalData", type: "array<f32>" },
  { kind: "storage", name: "colorData", type: "array<vec4f>" },
  { kind: "storage", name: "uvData", type: "array<vec2f>" },
  { kind: "storage", name: "uv2Data", type: "array<vec2f>" },
  { kind: "storage", name: "indexData", type: "array<u32>" },
  { kind: "storage", name: "viewMatrices", type: "array<vec4f>" },
] as const satisfies readonly Binding[];

/** The mask's group 1: each draw's bloom colour, rgb the colour and a the alpha. */
export const VIEW_GLOW = [{ kind: "storage", name: "viewGlow", type: "array<vec4f>" }] as const satisfies readonly Binding[];

/** The emissive stage's variant: the palette declared, so group 0 is laid out as every cel program's is. */
export const VIEW_EMISSIVE_DEFINES = ["CEL_PALETTE"] as const;

/** What the emissive stage hands its pixel: the palette's two, then the draw it belongs to. */
const EMISSIVE_DRAW_VARYINGS = [...EMISSIVE_VARYINGS, { name: "vBody", type: "u32", interpolate: "flat" }] as const;

/** The mask's pixel: that draw's bloom, as `GlowPass`'s mask material wrote a mesh's `glowColor`. */
const VIEW_GLOW_SURFACE = /* wgsl */ `
fn viewGlowSurface() -> vec4f {
  return viewGlow[fragmentInputs.vBody];
}
`;

/** `main`'s decode: the vertex the corner names, and where the draw's matrix is. */
const DECODE = ["  let vertex = indexData[vertexIndex];", "  let at = instanceIndex * 4u;"].join("\n");

/** `main`'s prelude: `world`, the draw's matrix, every column read whole. */
const WORLD_PRELUDE =
  "  instance.world = mat4x4f(viewMatrices[at], viewMatrices[at + 1u], viewMatrices[at + 2u], viewMatrices[at + 3u]);";

/** The same, and the pixel handed its draw (`vBody`): the emissive stage's. */
const EMISSIVE_PRELUDE = [WORLD_PRELUDE, "  vertexOutputs.vBody = instanceIndex;"].join("\n");

/** The private block both stages' `uniforms.world` is routed to. */
const WORLD_PRIVATE = { var: "instance", struct: "ViewInstance", fields: [{ name: "world", type: "mat4x4f" }] } as const;

/** One program: a vertex module and a pixel module. */
export interface ViewProgram {
  readonly vertex: AssembledVertex;
  readonly fragment: AssembledModule;
}

/** The emissive pair: the main pass's, and the mask's by the SAME vertex module. */
export interface ViewEmissivePrograms {
  readonly main: ViewProgram;
  readonly mask: ViewProgram;
}

const celBuilt = new Map<string, ViewProgram>();
let emissiveBuilt: ViewEmissivePrograms | null = null;

/** The cel program for a material's variant (`CelRecipe.defines`), assembled once a variant. */
export function viewCelProgram(defines: readonly string[]): ViewProgram {
  const key = [...defines].sort().join("+");
  let program = celBuilt.get(key);
  if (program) return program;
  const vertex: VertexProgram = {
    label: "view-cel-vertex",
    groups: [[FRAME_BLOCK], [], VIEW_GEOMETRY],
    attributes: CEL_ATTRIBUTES,
    varyings: CEL_VARYINGS,
    includes: WGSL_CHUNKS,
    body: "#include<celVertex>",
    entry: "celVertex",
    privates: [WORLD_PRIVATE],
    instanced: true,
    pull: { vertex: "vertex", decode: DECODE },
    prelude: WORLD_PRELUDE,
  };
  program = {
    vertex: assembleVertex(vertex, defines, FRAME_TARGETS),
    fragment: celFragment(defines, FRAME_TARGETS),
  };
  celBuilt.set(key, program);
  return program;
}

/**
 * The emissive programs — a reticle's, a pip's, a wick's and the flash's — in
 * the main pass (the palette's own pixel, over the viewmodel's table) and in
 * the glow's mask (each draw's bloom), by one vertex module.
 */
export function viewEmissivePrograms(): ViewEmissivePrograms {
  if (emissiveBuilt) return emissiveBuilt;
  if (FRAME_TARGETS.flipY !== GLOW_TARGETS.flipY) {
    // One vertex module for both passes is the mask's tie (the header).
    throw new Error("viewEmissivePrograms: the main pass and the glow's mask flip differently; one stage cannot serve both");
  }
  const vertex = assembleVertex(
    {
      label: "view-emissive-vertex",
      groups: [[FRAME_BLOCK], [], VIEW_GEOMETRY],
      attributes: EMISSIVE_ATTRIBUTES,
      varyings: EMISSIVE_DRAW_VARYINGS,
      includes: {},
      body: EMISSIVE_WORLD_VERTEX,
      entry: "emissiveWorldVertex",
      privates: [WORLD_PRIVATE],
      instanced: true,
      pull: { vertex: "vertex", decode: DECODE },
      prelude: EMISSIVE_PRELUDE,
    },
    VIEW_EMISSIVE_DEFINES,
    FRAME_TARGETS,
  );
  emissiveBuilt = {
    main: { vertex, fragment: emissiveWorld(FRAME_TARGETS).fragment },
    mask: {
      vertex,
      fragment: assembleFragment(
        {
          label: "view-glow-fragment",
          // Group 0 is the cel fragment's whole group, unread, so the frame's
          // one bind group serves this pipeline as it serves the main pass's.
          groups: [[FRAME_BLOCK, ...FRAME_TEXTURES], VIEW_GLOW],
          varyings: EMISSIVE_DRAW_VARYINGS,
          includes: {},
          body: VIEW_GLOW_SURFACE,
          surface: "viewGlowSurface",
        },
        VIEW_EMISSIVE_DEFINES,
        GLOW_TARGETS,
      ),
    },
  };
  return emissiveBuilt;
}
