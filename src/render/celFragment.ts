/**
 * render/celFragment.ts — The cel material's fragment as OUR renderer declares
 * it: the same body Babylon's `ShaderMaterial` draws (`celSurface`), against
 * explicit bind groups.
 * Owns: `CEL_FRAGMENT`, the declarations — the frame's uniforms and textures
 * (group 0), a material's (group 1) and the interpolated inputs — and
 * `celFragment`, one variant of it as a plain WGSL module.
 * Invariants: declares every name the shared body reads, by Babylon's names
 * because the body reads them by name, and under Babylon's guards
 * (`CelShader.ts`'s `celFragmentShader`, `shaders/wgsl/includes.ts`) except
 * where the frame's one layout overrides that (below); a texture is declared
 * with its sampler, as Babylon's are; the inputs keep Babylon's order and its
 * locations.
 * Never: imports Babylon; restates a body — what is different on this side is
 * a declaration, and a body edited here would be the second copy the shared
 * chunks exist to prevent.
 * Contract: `docs/rendering.md`, "Hand-written WGSL"; what each name means is
 * written beside its Babylon declaration.
 *
 * WHY TWO GROUPS, AND WHICH NAME IS IN WHICH. Group 0 is what
 * `CelMaterialFactory` pushes onto EVERY cel material as shared state — the
 * environment, the camera, the point lights, every shadow, the irradiance
 * volume, the map's palette, the Ground relief setting — and group 1 is what
 * a material is born with from its own spec: its albedo, its ground texture
 * and relief depth, its gloss, translucency and glazing, and a pane's own
 * probe. That is the split the factory already makes, read off the code
 * rather than chosen. The frame's block is `render/frame.ts`'s `FRAME_BLOCK`,
 * one declaration every program binds at group 0, binding 0, so a name can
 * move between the two without touching a body.
 *
 * **The frame is ONE layout in every variant but the last field**, because it
 * is one buffer shared by every material: a frame name Babylon declares only
 * for some variants (`skyZenithColor` for glazing, `reliefMarch` for the
 * bumped ground) is declared for all of them, which an unread member costs
 * nothing, and the one that cannot be — the 2 KB palette — is guarded and
 * LAST, so the variants that have it read the same offsets as the rest and a
 * longer buffer (`frame.ts` states it; `FrameUniformBuffer` writes it).
 *
 * WHAT THIS DOES NOT DO YET, and owes before it draws (X3.3): Babylon flips
 * `position.y` before the body runs when its pass draws into a texture
 * (`internals.yFactor_`), and the dither is keyed on that position, so a pass
 * that renders to a texture owes the same flip in `main` or its grain is
 * mirrored — and the frame's main pass IS one (`targets.ts`, `flipY`).
 */
import { WGSL_CHUNKS } from "../shaders/wgsl/chunks";
import { FRAME_BLOCK } from "./frame";
import { assembleFragment, type AssembledModule, type FragmentProgram } from "./wgsl/assemble";

/** The cel fragment, declared for our renderer. */
export const CEL_FRAGMENT: FragmentProgram = {
  label: "cel",
  // What Babylon's `#define DISABLE_UNIFORMITY_ANALYSIS` becomes: the
  // derivatives and the mip-chained fetches in the body are what was MEANT
  // (`CelShader.ts` says why beside that define).
  diagnosticsOff: ["derivative_uniformity"],
  groups: [
    [
      FRAME_BLOCK,
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
