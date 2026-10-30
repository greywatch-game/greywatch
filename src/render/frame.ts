/**
 * render/frame.ts — The FRAME's uniforms: the one block every program our
 * renderer draws with binds at group 0, binding 0, stated once as data, and
 * the plain struct it is written from.
 * Owns: `FRAME_FIELDS` and `FRAME_BLOCK` (the declaration `celFragment.ts`,
 * `celVertex.ts` and every later program include), `FrameUniforms` (one
 * `Float32Array` per field, named as the shader names it) and
 * `createFrameUniforms`; `FRAME_TEXTURES`, the rest of group 0 — every
 * shadow map, the foliage map and the irradiance volume — and
 * `FrameTextures`, the handles they are bound from — the host's, or our
 * renderer's own (`OwnTexture`: the world's shadow maps since X3.6a).
 * Invariants: one LAYOUT in every variant but the last field — a name only
 * some programs read is declared for all of them, and the one guarded field,
 * the 2 KB palette, is LAST, so every variant reads the same offsets (the
 * header of `celFragment.ts` argues it); a field's array is TIGHT —
 * `count * components` floats, a `vec3f` three — and only the upload
 * (`FrameUniformBuffer`) knows the padding; the struct is filled by whoever
 * already publishes the value (`CelMaterialFactory.fillFrame`), never read
 * off a Babylon material; so are the textures (`CelMaterialFactory
 * .fillFrameTextures`), as handles only the host resolves.
 * Never: imports Babylon; allocates per frame — the struct is made once and
 * filled in place.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 *
 * WHY THE CAMERA AND THE WIND ARE HERE although the fragment reads neither:
 * they are the VERTEX stage's share of the same frame (`CelShader.ts`'s
 * vertex declares them beside `world`), and a frame is one buffer bound once,
 * so a vertex stage that arrives later (X3.3) reads offsets that already
 * exist rather than moving every field after them. An unread member costs a
 * few bytes and nothing else.
 *
 * WHY THE TEXTURES ARE THE FRAME'S. Every one of them is pushed onto EVERY cel
 * material as shared state (`ShadowBindings.applyShadow`,
 * `CelMaterialFactory.setGi`) and replaced under all of them at once, so it
 * is one bind group per frame rather than one per material.
 */
import { MAX_PALETTE, MAX_POINT_LIGHTS } from "../shaders/wgsl/celSurface";
import { GI_SLOTS } from "../shaders/wgsl/giTrace";
import type { HostTexture } from "./frameHost";
import type { OwnTexture } from "./HostBindGroup";
import type { Binding, UniformField } from "./wgsl/assemble";

// `giSlotChannel` is one channel per POINT-LIGHT slot, and the volume's table
// (`GiBinding.slotChannel`) is `GI_SLOTS` long: `fillFrame` copies one into
// the other, which throws every frame the moment the two differ. Loud here,
// at load, instead.
if (GI_SLOTS !== MAX_POINT_LIGHTS) {
  throw new Error(`render/frame: GI_SLOTS (${GI_SLOTS}) must equal MAX_POINT_LIGHTS (${MAX_POINT_LIGHTS})`);
}

/** Every member of the frame block, in layout order. */
export const FRAME_FIELDS = [
  // The camera — what Babylon's `ShaderMaterial` fills from the scene's
  // active camera as `viewProjection`, and the eye the shading reads.
  { name: "viewProjection", type: "mat4x4f" },
  { name: "camPos", type: "vec3f" },
  { name: "opaqueAlpha", type: "f32" },
  // The environment (`CelMaterialFactory.setEnvironment`).
  { name: "lightDir", type: "vec3f" },
  { name: "keyWrap", type: "f32" },
  { name: "lightColor", type: "vec3f" },
  { name: "ambientColor", type: "vec3f" },
  { name: "skyLightColor", type: "vec3f" },
  { name: "skyZenithColor", type: "vec3f" },
  { name: "rimColor", type: "vec3f" },
  { name: "fogColor", type: "vec3f" },
  { name: "fogParams", type: "vec2f" },
  { name: "mistColor", type: "vec3f" },
  { name: "mistParams", type: "vec2f" },
  { name: "variationScale", type: "f32" },
  { name: "variationAmount", type: "f32" },
  { name: "wearColor", type: "vec3f" },
  { name: "wearParams", type: "vec4f" },
  { name: "wearGrain", type: "vec3f" },
  { name: "reliefMarch", type: "f32" },
  // The wind — the vertex stage's sway (`CelShader.ts`, `applyWind`).
  { name: "windTime", type: "f32" },
  { name: "windDir", type: "vec2f" },
  { name: "windParams", type: "vec3f" },
  { name: "windFrond", type: "vec4f" },
  { name: "windFrondRate", type: "vec4f" },
  { name: "windBough", type: "vec4f" },
  { name: "windBoughRate", type: "vec4f" },
  { name: "windBoughFade", type: "vec2f" },
  // The point lights (`setPointLights`, `LocalShadows.publish`).
  { name: "pointPos", type: "vec3f", count: MAX_POINT_LIGHTS },
  { name: "pointColor", type: "vec3f", count: MAX_POINT_LIGHTS },
  { name: "pointRange", type: "f32", count: MAX_POINT_LIGHTS },
  { name: "pointCount", type: "f32" },
  { name: "pointSpot", type: "vec4f", count: MAX_POINT_LIGHTS },
  { name: "pointShade", type: "vec4f", count: MAX_POINT_LIGHTS },
  { name: "localAtlas", type: "vec4f" },
  { name: "localParams", type: "vec4f" },
  // The shadows (`ShadowBindings`).
  { name: "lightMatrix", type: "mat4x4f" },
  { name: "shadowParams", type: "vec4f" },
  { name: "nearLightMatrix", type: "mat4x4f" },
  { name: "nearShadowParams", type: "vec4f" },
  { name: "bodyLightMatrix", type: "mat4x4f" },
  { name: "bodyShadowParams", type: "vec4f" },
  { name: "foliageLightMatrix", type: "mat4x4f" },
  { name: "foliageParams", type: "vec4f" },
  { name: "cloudShadow", type: "vec4f" },
  { name: "cloudShadowRay", type: "vec4f" },
  { name: "flashDir", type: "vec3f" },
  { name: "flashColor", type: "vec3f" },
  { name: "flashLightMatrix", type: "mat4x4f" },
  { name: "flashParams", type: "vec4f" },
  // The irradiance volume (`GiVolume.binding`).
  { name: "giGrid", type: "vec4f" },
  { name: "giWindow", type: "vec4f" },
  { name: "giShade", type: "vec4f" },
  { name: "giBand", type: "vec4f" },
  { name: "giExtra", type: "vec4f" },
  { name: "giSlotChannel", type: "f32", count: MAX_POINT_LIGHTS },
  // Guarded, so LAST — see the header. The MAP's palette; a body's own table
  // is a material's and never rides the frame (`CEL_OWN_PALETTE`, the soldier
  // kit's, `celMaterial.ts` — `BABYLON_EXIT.md` X4.1d), so a variant holding
  // its own declares none here and reads the same offsets as every other.
  { name: "celPalette", type: "vec3f", count: MAX_PALETTE, when: ["CEL_PALETTE", "!CEL_OWN_PALETTE"] },
] as const satisfies readonly UniformField[];

/** The frame block: group 0, binding 0, in every program. */
export const FRAME_BLOCK = {
  kind: "uniform",
  var: "frame",
  struct: "CelFrame",
  fields: FRAME_FIELDS,
} as const satisfies Binding;

/** The rest of group 0, after the block, in binding order. */
export const FRAME_TEXTURES = [
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
] as const satisfies readonly Binding[];

/** The name of a frame texture. */
export type FrameTexture = (typeof FRAME_TEXTURES)[number]["name"];

/**
 * The frame's textures as last pulled: a handle per binding — the host's, or
 * one of our renderer's own — or null for one its owner has not published
 * yet: a frame with any null draws nothing, as a Babylon material with a
 * sampler unbound draws nothing.
 */
export type FrameTextures = { [K in FrameTexture]: HostTexture | OwnTexture | null };

/** Every frame texture unpublished. Made once by whoever fills it. */
export function createFrameTextures(): FrameTextures {
  const out: Partial<Record<FrameTexture, HostTexture | OwnTexture | null>> = {};
  for (const t of FRAME_TEXTURES) out[t.name] = null;
  return out as FrameTextures;
}

/** The name of a frame field — what the shader calls it. */
export type FrameField = (typeof FRAME_FIELDS)[number]["name"];

/** The frame's values, one tight array per field. Filled in place, never re-made. */
export type FrameUniforms = { readonly [K in FrameField]: Float32Array };

/** Floats in one element of each type a frame field may be. */
const COMPONENTS: Readonly<Record<string, number>> = {
  f32: 1,
  vec2f: 2,
  vec3f: 3,
  vec4f: 4,
  mat4x4f: 16,
};

/** A zeroed frame. Made once by whoever fills it. */
export function createFrameUniforms(): FrameUniforms {
  const out: Record<string, Float32Array> = {};
  for (const f of FRAME_FIELDS as readonly UniformField[]) {
    out[f.name] = new Float32Array(COMPONENTS[f.type] * (f.count ?? 1));
  }
  return out as FrameUniforms;
}
