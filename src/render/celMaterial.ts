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
 * own spec, never shared state (that is the frame's, `frame.ts`) — a body's
 * kit palette among them (`CEL_OWN_PALETTE`, `bodyCelRecipe`), the one
 * palette that is a material's own — the split
 * `CelMaterialFactory` already makes, read off the code; a recipe is filled by
 * the factory that made the material (`CelMaterialFactory.celRecipe`), as a
 * PULL off what it kept at birth, and never read off a Babylon material; a
 * recipe's `values` hold exactly the fields its variant declares, each a
 * tight `Float32Array` as `frame.ts`'s are.
 * Never: imports Babylon — a texture is an `OwnTexture`, our renderer's own
 * (`TextureMaker`'s, `BABYLON_EXIT.md` X5.4d), bound where it lies.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 */
import { MAX_PALETTE } from "../shaders/wgsl/celSurface";
import type { OwnTexture } from "./HostBindGroup";
import { guardHolds } from "./wgsl/layout";
import type { Binding, UniformField } from "./wgsl/assemble";

/** Every member of a cel material's own block, in layout order. */
export const CEL_MATERIAL_FIELDS = [
  { name: "baseColor", type: "vec3f", when: ["!CEL_GROUND_TEX"] },
  // World-mapped ground albedo: sampled at vPosW.xz * texScale, so no UVs are
  // needed and the pattern keeps a constant real-world size across placements.
  { name: "texScale", type: "f32", when: ["CEL_GROUND_TEX"] },
  // The tile's own weathering — see graphics.groundVariation in the config for
  // why a ground texture gets a wider cell and a wider swing than a flat colour.
  { name: "groundVariationScale", type: "f32", when: ["CEL_GROUND_TEX"] },
  { name: "groundVariationAmount", type: "f32", when: ["CEL_GROUND_TEX"] },
  // Metres of fake relief at height value 1.0 (`bumpTex`).
  { name: "bumpScale", type: "f32", when: ["CEL_GROUND_TEX", "CEL_BUMP"] },
  // The relief's DEPTH — see groundRelief. x, y: the distance the parallax fades
  // out over; z, w: the distance the self-shadow fades out over.
  { name: "reliefFade", type: "vec4f", when: ["CEL_GROUND_TEX", "CEL_BUMP"] },
  // x: how dark the relief's own shadow is (1 = the key gone), y: how much of the
  // ambient a groove at height 0 loses.
  { name: "reliefShade", type: "vec2f", when: ["CEL_GROUND_TEX", "CEL_BUMP"] },
  // Toon specular: one hard two-band Blinn highlight from the key light.
  // specColor is premultiplied by intensity — black (the default) is matte.
  { name: "specColor", type: "vec3f" },
  { name: "specShininess", type: "f32" },
  // The top rung of the gloss ladder, and the one that is not a highlight: how
  // much of the ENVIRONMENT a polished surface hands back instead of its own
  // shaded colour. Zero (the default, and every matte, satin and metal material
  // in the game) leaves the whole mirror block in celSurface unentered — a uniform
  // branch, which is the same shape the albedo weathering's mask already is.
  { name: "specMirror", type: "f32" },
  // Translucency: the key light coming THROUGH a thin surface rather than off
  // it — a canvas awning or a pine crown with the moon behind it. Premultiplied
  // by intensity — black (the default) is opaque.
  { name: "transColor", type: "vec3f" },
  // TranslucencySpec.depth, in metres: 0 is a thin sheet, otherwise how far
  // behind the solid's lit surface a face may lie and still transmit.
  { name: "transDepth", type: "f32" },
  // Glazing. x = reflectance face-on, y = the Fresnel falloff's exponent,
  // z = cosine half-width of the sun's halo in the reflection, w = how much of
  // the tint a face-on pane keeps. See CelMaterialFactory.getGlass.
  { name: "glassParams", type: "vec4f", when: ["CEL_GLASS"] },
  // The ALBEDO of the mass this sheet hangs on, named by the builder that hung
  // it (the backed argument of Build.pane). Unlit, because it is shaded here by
  // the same light the pane is: they are parallel faces a hand apart, so one
  // light term is right for both. See the composite in celSurface for why this
  // is exact rather than an approximation of the blend it replaces.
  { name: "glassBackdrop", type: "vec3f", when: ["CEL_GLASS", "CEL_GLASS_BACKED"] },
  // Where the cube was baked from, and how much of it this surface returns
  // against the sky it would otherwise show: reflectProbe.xyz is the bake point
  // and .w is the strength — 0 where nothing was baked, which is every map with
  // nothing to bake for (`celProbe`).
  { name: "reflectProbe", type: "vec4f", when: ["CEL_GLASS"] },
  // The box the mirrored ray is parallax-corrected against — the map's own
  // extent, floor to roofline (`celProbeBox`).
  { name: "reflectBoxMin", type: "vec3f", when: ["CEL_GLASS"] },
  { name: "reflectBoxMax", type: "vec3f", when: ["CEL_GLASS"] },
  // A palette of the material's OWN, where the frame's is the map's: the
  // soldier kit's nine hexes (`CelMaterialFactory.bodyCelRecipe`,
  // `BABYLON_EXIT.md` X4.1d), which outlive every map and so never ride the
  // frame — `frame.ts` declares its own only without this define. LAST, so no
  // other variant's offsets move.
  { name: "celPalette", type: "vec3f", count: MAX_PALETTE, when: ["CEL_PALETTE", "CEL_OWN_PALETTE"] },
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
  // The ground's tiling albedo (`texScale`).
  { kind: "sampled", name: "baseColorTex", type: "texture_2d<f32>", when: ["CEL_GROUND_TEX"] },
  // Height map matching the albedo texel-for-texel (domed setts, dark mortar).
  {
    kind: "sampled",
    name: "bumpTex",
    type: "texture_2d<f32>",
    when: ["CEL_GROUND_TEX", "CEL_BUMP"],
  },
  // The world as a mirror sees it: one cube baked per map install from the
  // map's own geometry (systems/ReflectionSystem.ts). Alpha 1 where the bake
  // drew something and 0 where it saw nothing at all, which is what lets the
  // sky above stay the analytic gradient and the world below be a picture of
  // the world. Colour is NOT premultiplied — see each sampler's own mix.
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
    out[f.name as CelMaterialField] = new Float32Array(COMPONENTS[f.type] * (f.count ?? 1));
  }
  return out;
}

/** What a cel material is drawn with, as the factory that made it states it. */
export interface CelRecipe {
  /** The variant: the defines its program is assembled under, bare (`CEL_PALETTE`). */
  readonly defines: readonly string[];
  /**
   * The material key's `zOffsetUnits` — the pipeline's `depthBias`, in the
   * depth buffer's own units. The slope (`zOffset`) is 0 on every cel material.
   */
  readonly depthBias: number;
  /** The block, filled in place; `CelMaterialFactory.materialEpoch` moves when any is rewritten. */
  readonly values: MaterialUniforms;
  /** One per texture the variant binds. */
  readonly textures: Readonly<Partial<Record<CelMaterialTexture, OwnTexture>>>;
}
