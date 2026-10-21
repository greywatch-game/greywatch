/**
 * render/celMaterial.ts — A cel MATERIAL as our renderer draws one: its own
 * uniform block (group 1), the textures it binds there, and the
 * fixed-function state it carries; group 2, the draw's geometry, is the
 * vertex stage's (`celVertex.ts`).
 * Owns: `CEL_MATERIAL_FIELDS` and `CEL_MATERIAL_BLOCK` (group 1, binding 0
 * of the cel program), `CEL_MATERIAL_TEXTURES` (the rest of group 1),
 * `MaterialUniforms` and `createMaterialUniforms`, and `CelRecipe` — what a
 * material is drawn WITH, as plain data.
 * Invariants: a field or texture here is one a material is BORN with from its
 * own spec, never shared state (that is the frame's, `frame.ts`) — the split
 * `CelMaterialFactory` already makes, read off the code; a recipe is filled by
 * the factory that made the material (`CelMaterialFactory.celRecipe`), as a
 * PULL off what it kept at birth, and never read off a Babylon material; a
 * recipe's `values` hold exactly the fields its variant declares, each a
 * tight `Float32Array` as `frame.ts`'s are.
 * Never: imports Babylon — a texture is a `HostTexture`, which only the
 * frame's host can resolve.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 */
import type { HostTexture } from "./frameHost";
import { guardHolds } from "./wgsl/layout";
import type { Binding, UniformField } from "./wgsl/assemble";

/** Every member of a cel material's own block, in layout order. */
export const CEL_MATERIAL_FIELDS = [
  { name: "baseColor", type: "vec3f", when: ["!CEL_GROUND_TEX"] },
  { name: "texScale", type: "f32", when: ["CEL_GROUND_TEX"] },
  { name: "groundVariationScale", type: "f32", when: ["CEL_GROUND_TEX"] },
  { name: "groundVariationAmount", type: "f32", when: ["CEL_GROUND_TEX"] },
  { name: "bumpScale", type: "f32", when: ["CEL_GROUND_TEX", "CEL_BUMP"] },
  { name: "reliefFade", type: "vec4f", when: ["CEL_GROUND_TEX", "CEL_BUMP"] },
  { name: "reliefShade", type: "vec2f", when: ["CEL_GROUND_TEX", "CEL_BUMP"] },
  { name: "specColor", type: "vec3f" },
  { name: "specShininess", type: "f32" },
  { name: "specMirror", type: "f32" },
  { name: "transColor", type: "vec3f" },
  { name: "transDepth", type: "f32" },
  { name: "glassParams", type: "vec4f", when: ["CEL_GLASS"] },
  { name: "glassBackdrop", type: "vec3f", when: ["CEL_GLASS", "CEL_GLASS_BACKED"] },
  { name: "reflectProbe", type: "vec4f", when: ["CEL_GLASS"] },
  { name: "reflectBoxMin", type: "vec3f", when: ["CEL_GLASS"] },
  { name: "reflectBoxMax", type: "vec3f", when: ["CEL_GLASS"] },
] as const satisfies readonly UniformField[];

/** The material block: group 1, binding 0 of the cel program. */
export const CEL_MATERIAL_BLOCK = {
  kind: "uniform",
  var: "material",
  struct: "CelMaterial",
  fields: CEL_MATERIAL_FIELDS,
} as const satisfies Binding;

/** The textures a material binds after its block, in binding order. */
export const CEL_MATERIAL_TEXTURES = [
  { kind: "sampled", name: "baseColorTex", type: "texture_2d<f32>", when: ["CEL_GROUND_TEX"] },
  {
    kind: "sampled",
    name: "bumpTex",
    type: "texture_2d<f32>",
    when: ["CEL_GROUND_TEX", "CEL_BUMP"],
  },
  { kind: "sampled", name: "reflectionCube", type: "texture_cube<f32>", when: ["CEL_GLASS"] },
] as const satisfies readonly Binding[];

/** The name of a material field — what the shader calls it. */
export type CelMaterialField = (typeof CEL_MATERIAL_FIELDS)[number]["name"];
/** The name of a texture a material binds. */
export type CelMaterialTexture = (typeof CEL_MATERIAL_TEXTURES)[number]["name"];

/** A material's values: one tight array per field its variant declares, and no other. */
export type MaterialUniforms = { readonly [K in CelMaterialField]?: Float32Array };

/** Floats in one element of each type a material field may be. */
const COMPONENTS: Readonly<Record<string, number>> = { f32: 1, vec2f: 2, vec3f: 3, vec4f: 4 };

/** A zeroed block for the variant `defines`. Made once, by whoever fills it. */
export function createMaterialUniforms(defines: Iterable<string>): MaterialUniforms {
  const variant = new Set(defines);
  const out: Partial<Record<CelMaterialField, Float32Array>> = {};
  for (const f of CEL_MATERIAL_FIELDS as readonly UniformField[]) {
    if (!guardHolds(f.when, variant)) continue;
    out[f.name as CelMaterialField] = new Float32Array(COMPONENTS[f.type]);
  }
  return out;
}

/** What a cel material is drawn with, as the factory that made it states it. */
export interface CelRecipe {
  /** The variant: the defines its Babylon twin compiles with, bare (`CEL_PALETTE`). */
  readonly defines: readonly string[];
  /**
   * Babylon's `zOffsetUnits` — the pipeline's `depthBias`, in the depth
   * buffer's own units. The slope (`zOffset`) is 0 on every cel material.
   */
  readonly depthBias: number;
  /** The block, filled in place; `CelMaterialFactory.materialEpoch` moves when any is rewritten. */
  readonly values: MaterialUniforms;
  /** One per texture the variant binds. */
  readonly textures: Readonly<Partial<Record<CelMaterialTexture, HostTexture>>>;
}
