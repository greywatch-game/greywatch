/**
 * render/emissiveWorld.ts — The emissive palette as OUR renderer draws it: the
 * lit windows, lamp lenses, embers and signs of a map's merged world, into a
 * reflection probe's faces (`render/ProbeBake.ts`, `BABYLON_EXIT.md` X3.6c),
 * into the glow's MASK (`render/WorldGlow.ts`, X3.6d) and into the frame's
 * MAIN pass (`render/WorldBlocks.ts`, X3.6e: the bake's own pipelines) —
 * the only draw of the palette there is since X3.7c, whose Babylon stages
 * and mask twin (`EmissiveWorldMaterial`'s, until then) it was the pulled
 * form of.
 * Owns: `EMISSIVE_BLOCK` (group 1: the palette, the fog band and, for the
 * mask, the bloom's colour), the geometry it reads (group 2,
 * `EMISSIVE_GEOMETRY`: the positions, the slots in `uv2` and the instances'
 * transforms, which the shared decode names), `EMISSIVE_ATTRIBUTES`,
 * `EmissiveRecipe` (what a palette material is drawn WITH, as plain data) and
 * `emissiveWorld`, the program's two modules for either pass.
 * Invariants: the pixel is the palette's one body
 * (`shaders/wgsl/emissiveWorld.ts`) — the slot's colour faded toward the fog
 * by `EmissiveFog`'s curve over the radial distance to the FRAME's `camPos`
 * (a bake's frame holds the probe there), alpha 1 — or, under `GLOW_MASK`,
 * its mask twin's — faded toward black on the same curve and scaled by the
 * bloom's colour (`glowColor`, `GlowRules`' answer for that material); and the
 * vertex is its vertex in both, `world` identity as the merge's is, read
 * through the cel stage's own decode (`pulledWorld`) — so the mask's LEQUAL
 * test ties against the depth our main pass's palette wrote, by the same
 * vertex module; group 0 is the cel
 * FRAGMENT's whole group, so one frame bind group serves the cel pipelines
 * and these; group 1 is laid out for the MASK's variant, `glowColor` LAST, so
 * the bake's program reads a prefix of the same buffer and one bind group
 * serves both (no layout states a `minBindingSize`); the fog band is the
 * material's own pair as the factory computes it (`fogRange`: start and the
 * reciprocal of the band, on the CPU, so it rounds as Babylon's uniform did), and the
 * palette the factory's table — both a PULL off the factory
 * (`CelMaterialFactory.emissiveRecipe`), never read off a material; back
 * faces are culled and the material's own depth bias is its pipeline's.
 * Never: imports Babylon; restates the body.
 * Contract: `docs/rendering.md`, "The paint palette" and "Our renderer's
 * frame".
 */
import { EMISSIVE_WORLD_SURFACE, EMISSIVE_WORLD_VERTEX, MAX_EMISSIVE_PALETTE } from "../shaders/wgsl/emissiveWorld";
import { pulledWorld } from "./celVertex";
import { FRAME_BLOCK, FRAME_TEXTURES } from "./frame";
import {
  assembleFragment,
  assembleVertex,
  type AssembledAttribute,
  type AssembledModule,
  type AssembledVertex,
  type Binding,
  type StageTarget,
} from "./wgsl/assemble";

/**
 * Group 1: the map's emissive colours and the fog band they fade on — and,
 * for the glow's mask, the bloom's colour, LAST, so the offsets the bake's
 * program reads are the same in both variants.
 */
export const EMISSIVE_BLOCK = {
  kind: "uniform",
  var: "emissive",
  struct: "EmissiveMaterial",
  fields: [
    { name: "emissivePalette", type: "vec3f", count: MAX_EMISSIVE_PALETTE },
    { name: "fogRange", type: "vec2f" },
    // rgb the bloom's scale for this material (`GlowRules`), a its alpha.
    { name: "glowColor", type: "vec4f", when: ["GLOW_MASK"] },
  ],
} as const satisfies Binding;

/** The variant a palette block is laid out for: the mask's, whose layout the bake's is a prefix of. */
export const EMISSIVE_BLOCK_DEFINES = ["GLOW_MASK"] as const;

/** Group 2: the positions, the slots and the transforms the shared decode names. */
export const EMISSIVE_GEOMETRY = [
  { kind: "storage", name: "positionData", type: "array<f32>" },
  { kind: "storage", name: "uv2Data", type: "array<vec2f>" },
  { kind: "storage", name: "transforms", type: "array<vec4f>" },
] as const satisfies readonly Binding[];

/** What a palette surface's arrays hold: its positions and its slots. */
export const EMISSIVE_ATTRIBUTES: readonly AssembledAttribute[] = [
  { name: "position", type: "vec3f", from: "positionData" },
  { name: "uv2", type: "vec2f", from: "uv2Data" },
];

/** What a palette material is drawn with, as the factory that made it states it. */
export interface EmissiveRecipe {
  /** Babylon's `zOffsetUnits` — the pipeline's `depthBias` (the over-glass twin's). */
  readonly depthBias: number;
  /** The block, filled in place; `CelMaterialFactory.materialEpoch` moves when either is rewritten. */
  readonly values: { readonly emissivePalette: Float32Array; readonly fogRange: Float32Array };
}

const VARYINGS = [
  { name: "vPosW", type: "vec3f" },
  { name: "vSlot", type: "f32" },
] as const;

/** The frame's palette is declared, so group 0 is laid out as every cel program's is. */
const DEFINES = ["CEL_PALETTE"];
/** The mask's fragment: the same, and the body's `GLOW_MASK` arm. */
const GLOW_DEFINES = ["CEL_PALETTE", "GLOW_MASK"];

const programs = new Map<string, { vertex: AssembledVertex; fragment: AssembledModule }>();

/**
 * The emissive palette's two modules for a pass of `target`'s kind — the
 * main pass and a probe's face are `FRAME_TARGETS`, the glow's mask
 * `GLOW_TARGETS` — with `glow` the mask twin's fragment. The vertex stage is
 * ONE text either way, which is what the mask's LEQUAL tie rests on.
 */
export function emissiveWorld(
  target: StageTarget,
  glow = false,
): { vertex: AssembledVertex; fragment: AssembledModule } {
  const key = `${target.flipY}|${glow}`;
  let program = programs.get(key);
  if (!program) {
    program = {
      vertex: assembleVertex(
        {
          label: "emissive-vertex",
          groups: [[FRAME_BLOCK], [], EMISSIVE_GEOMETRY],
          attributes: EMISSIVE_ATTRIBUTES,
          varyings: VARYINGS,
          includes: {},
          body: EMISSIVE_WORLD_VERTEX,
          entry: "emissiveWorldVertex",
          ...pulledWorld(null),
        },
        DEFINES,
        target,
      ),
      fragment: assembleFragment(
        {
          label: glow ? "emissive-glow-fragment" : "emissive-fragment",
          groups: [[FRAME_BLOCK, ...FRAME_TEXTURES], [EMISSIVE_BLOCK]],
          varyings: VARYINGS,
          includes: {},
          body: EMISSIVE_WORLD_SURFACE,
          surface: "emissiveWorldSurface",
        },
        glow ? GLOW_DEFINES : DEFINES,
        target,
      ),
    };
    programs.set(key, program);
  }
  return program;
}
