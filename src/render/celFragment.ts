/**
 * render/celFragment.ts — The cel material's fragment as OUR renderer declares
 * it: the same body Babylon's `ShaderMaterial` draws (`celSurface`), against
 * explicit bind groups.
 * Owns: `CEL_FRAGMENT`, the declarations — the frame's uniforms and textures
 * (group 0), a material's (group 1) and the interpolated inputs — and
 * `celFragment`, one variant of it as a plain WGSL module.
 * Invariants: declares every name the shared body reads, under the variant
 * defines Babylon's declarations sit under (`CelShader.ts`'s
 * `celFragmentShader` and `shaders/wgsl/includes.ts`), and the names are
 * Babylon's, because the body reads them by name; a texture is declared with
 * its sampler, as Babylon's are; the inputs keep Babylon's order, so a vertex
 * stage that writes them in that order lines up.
 * Never: imports Babylon; restates a body — what is different on this side is
 * a declaration, and a body edited here would be the second copy the shared
 * chunks exist to prevent.
 * Contract: `docs/rendering.md`, "Hand-written WGSL"; what each name means is
 * written beside its Babylon declaration.
 *
 * WHY TWO GROUPS, AND WHICH NAME IS IN WHICH. Group 0 is what
 * `CelMaterialFactory` pushes onto EVERY cel material as shared state — the
 * environment, the camera, the point lights, every shadow, the irradiance
 * volume, the map's palette — and group 1 is what a material is born with
 * from its own spec: its albedo, its ground texture and relief, its gloss,
 * translucency and glazing, and a pane's own probe. That is the split the
 * factory already makes, read off the code rather than chosen; X3.2 owns the
 * frame's buffer and may move a name between the two without touching a body.
 *
 * WHAT THIS DOES NOT DO YET, and owes before it draws (X3.2, X3.3):
 * Babylon flips `position.y` before the body runs when its pass draws into a
 * texture (`internals.yFactor_`), and the dither is keyed on that position,
 * so a pass that renders to a texture owes the same flip in `main` or its
 * grain is mirrored. And the world's uniforms here are laid out by WGSL's
 * rules, which is not the byte layout anything uploads yet.
 */
import { MAX_PALETTE, MAX_POINT_LIGHTS } from "../shaders/wgsl/celSurface";
import { WGSL_CHUNKS } from "../shaders/wgsl/chunks";
import {
  assembleFragment,
  type AssembledModule,
  type FragmentProgram,
  type UniformField,
} from "./wgsl/assemble";

/** `celCloud`'s, `celShadow`'s and `celGi`'s uniforms, which every consumer owes. */
const SHARED_FIELDS: readonly UniformField[] = [
  { name: "cloudShadow", type: "vec4f" },
  { name: "cloudShadowRay", type: "vec4f" },
  { name: "lightMatrix", type: "mat4x4f" },
  { name: "shadowParams", type: "vec4f" },
  { name: "nearLightMatrix", type: "mat4x4f" },
  { name: "nearShadowParams", type: "vec4f" },
  { name: "bodyLightMatrix", type: "mat4x4f" },
  { name: "bodyShadowParams", type: "vec4f" },
  { name: "pointSpot", type: "vec4f", count: MAX_POINT_LIGHTS },
  { name: "pointShade", type: "vec4f", count: MAX_POINT_LIGHTS },
  { name: "localAtlas", type: "vec4f" },
  { name: "localParams", type: "vec4f" },
  { name: "flashDir", type: "vec3f" },
  { name: "flashColor", type: "vec3f" },
  { name: "flashLightMatrix", type: "mat4x4f" },
  { name: "flashParams", type: "vec4f" },
  { name: "giGrid", type: "vec4f" },
  { name: "giWindow", type: "vec4f" },
  { name: "giShade", type: "vec4f" },
  { name: "giBand", type: "vec4f" },
  { name: "giExtra", type: "vec4f" },
  { name: "giSlotChannel", type: "f32", count: MAX_POINT_LIGHTS },
];

/** The cel fragment, declared for our renderer. */
export const CEL_FRAGMENT: FragmentProgram = {
  label: "cel",
  // What Babylon's `#define DISABLE_UNIFORMITY_ANALYSIS` becomes: the
  // derivatives and the mip-chained fetches in the body are what was MEANT
  // (`CelShader.ts` says why beside that define).
  diagnosticsOff: ["derivative_uniformity"],
  groups: [
    [
      {
        kind: "uniform",
        var: "frame",
        struct: "CelFrame",
        fields: [
          { name: "lightDir", type: "vec3f" },
          { name: "lightColor", type: "vec3f" },
          { name: "keyWrap", type: "f32" },
          { name: "ambientColor", type: "vec3f" },
          { name: "skyLightColor", type: "vec3f" },
          { name: "skyZenithColor", type: "vec3f", when: ["CEL_GLASS"] },
          { name: "rimColor", type: "vec3f" },
          { name: "fogColor", type: "vec3f" },
          { name: "fogParams", type: "vec2f" },
          { name: "mistColor", type: "vec3f" },
          { name: "mistParams", type: "vec2f" },
          { name: "camPos", type: "vec3f" },
          { name: "opaqueAlpha", type: "f32" },
          { name: "variationScale", type: "f32" },
          { name: "variationAmount", type: "f32" },
          { name: "wearColor", type: "vec3f" },
          { name: "wearParams", type: "vec4f" },
          { name: "wearGrain", type: "vec3f" },
          { name: "pointPos", type: "vec3f", count: MAX_POINT_LIGHTS },
          { name: "pointColor", type: "vec3f", count: MAX_POINT_LIGHTS },
          { name: "pointRange", type: "f32", count: MAX_POINT_LIGHTS },
          { name: "pointCount", type: "f32" },
          { name: "foliageLightMatrix", type: "mat4x4f" },
          { name: "foliageParams", type: "vec4f" },
          { name: "celPalette", type: "vec3f", count: MAX_PALETTE, when: ["CEL_PALETTE"] },
          ...SHARED_FIELDS,
        ],
      },
      { kind: "sampled", name: "shadowMap", type: "texture_2d<f32>" },
      { kind: "sampled", name: "nearShadowMap", type: "texture_2d<f32>" },
      { kind: "sampled", name: "bodyShadowMap", type: "texture_2d<f32>" },
      { kind: "sampled", name: "localAtlasMap", type: "texture_2d<f32>" },
      { kind: "sampled", name: "flashMap", type: "texture_2d<f32>" },
      { kind: "sampled", name: "cloudShadowMap", type: "texture_2d<f32>" },
      { kind: "sampled", name: "foliageMap", type: "texture_2d<f32>" },
      { kind: "sampled", name: "giIrr", type: "texture_3d<f32>" },
      { kind: "sampled", name: "giDir", type: "texture_3d<f32>" },
      { kind: "sampled", name: "giAux", type: "texture_3d<f32>" },
      { kind: "sampled", name: "giVis0", type: "texture_3d<f32>" },
      { kind: "sampled", name: "giVis1", type: "texture_3d<f32>" },
      { kind: "sampled", name: "giVis2", type: "texture_3d<f32>" },
      { kind: "sampled", name: "giVis3", type: "texture_3d<f32>" },
    ],
    [
      {
        kind: "uniform",
        var: "material",
        struct: "CelMaterial",
        fields: [
          { name: "baseColor", type: "vec3f", when: ["!CEL_GROUND_TEX"] },
          { name: "texScale", type: "f32", when: ["CEL_GROUND_TEX"] },
          { name: "groundVariationScale", type: "f32", when: ["CEL_GROUND_TEX"] },
          { name: "groundVariationAmount", type: "f32", when: ["CEL_GROUND_TEX"] },
          { name: "bumpScale", type: "f32", when: ["CEL_GROUND_TEX", "CEL_BUMP"] },
          { name: "reliefFade", type: "vec4f", when: ["CEL_GROUND_TEX", "CEL_BUMP"] },
          { name: "reliefShade", type: "vec2f", when: ["CEL_GROUND_TEX", "CEL_BUMP"] },
          { name: "reliefMarch", type: "f32", when: ["CEL_GROUND_TEX", "CEL_BUMP"] },
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
        ],
      },
      { kind: "sampled", name: "baseColorTex", type: "texture_2d<f32>", when: ["CEL_GROUND_TEX"] },
      {
        kind: "sampled",
        name: "bumpTex",
        type: "texture_2d<f32>",
        when: ["CEL_GROUND_TEX", "CEL_BUMP"],
      },
      { kind: "sampled", name: "reflectionCube", type: "texture_cube<f32>", when: ["CEL_GLASS"] },
    ],
  ],
  varyings: [
    { name: "vNormalW", type: "vec3f" },
    { name: "vPosW", type: "vec3f" },
    { name: "vBaked", type: "vec4f" },
    { name: "vPalette", type: "f32", when: ["CEL_PALETTE"] },
  ],
  includes: WGSL_CHUNKS,
  body: "#include<celSurface>",
  surface: "celSurface",
};

/** One variant of the cel fragment — a define set Babylon's materials compile. */
export function celFragment(defines: Iterable<string>): AssembledModule {
  return assembleFragment(CEL_FRAGMENT, defines);
}
