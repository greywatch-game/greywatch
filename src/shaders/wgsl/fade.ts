/**
 * wgsl/fade.ts — The FADING pools' two BODIES, as plain strings OUR renderer
 * assembles (`render/fadeProgram.ts`): an impact's spark and dust disc, a
 * blast's scorch and a body's blob shadow, which were unlit
 * `StandardMaterial`s until `BABYLON_EXIT.md` X4.6e — the vertex stage
 * Babylon's `default.vertex` was for them, and the pixel its
 * `default.fragment` was with lighting off, every texture but an opacity map
 * absent, image processing off and the scene's fog off, `EmissiveFog`'s fade
 * after it where the material wore that plugin — and, under `GLOW_MASK`, the
 * spark's mask twin (what `GlowPass`'s `glowMask` stages were, deleted at
 * `BABYLON_EXIT.md` X5.3d).
 * Owns: `FADE_VERTEX` (`fadeVertex`) and `FADE_SURFACE` (`fadeSurface`).
 * Invariants: a body DECLARES NOTHING (`wgsl/chunks.ts`' rule): it reads
 * `uniforms.<name>`, `vertexInputs.<name>`, `fadeItem.<name>` and
 * `fragmentInputs.<name>`, and writes `vertexOutputs.<name>`; the arithmetic
 * is Babylon's in Babylon's order, read off the effect each material compiled
 * at X4.6e's BEFORE (the terms its uniforms zero — no diffuse, no ambient, a
 * base colour of 1, no specular, reflection or refraction — folded, each
 * exact: a sum with zero and a product with one move no bit of a colour in
 * [0, 1]); the alpha is the material's 1, times the opacity map's alpha times
 * its level of 1 where there is one, times the mesh's `visibility` LAST; the
 * fade is `t * t` over the radial distance to the frame's `camPos`, the
 * plugin's `scene.vEyePosition`, on the factory's band (`fogRange`).
 * Never: imports Babylon; declares a binding.
 * Contract: `docs/rendering.md`, "The pools, ours".
 *
 * ## Licence
 *
 * The arithmetic is restated from Babylon.js 9.28's WGSL shaders as its
 * processor compiled them for these materials
 * (`ShadersWGSL/default.vertex.js` 156, 172 and 174, the world and clip
 * positions and `vPositionW`; `default.fragment.js` 103, 242, 258, 275, 287
 * and 297, the alpha, the emissive colour, `finalDiffuse`, `color`, its floor
 * at 0 and the mesh's `visibility`; `ShadersInclude/defaultFragmentAlpha.js`
 * 9, the opacity map's alpha; `glowMapGeneration.fragment.js` 28 and 63, the
 * mask's colour), which is licensed under the Apache License, Version 2.0
 * (`licenses/babylonjs.md`; https://www.apache.org/licenses/LICENSE-2.0).
 * "Babylon.js — Copyright 2023 The Babylon.js team" (its NOTICE). Changes
 * from the original: the terms the uniforms zero folded (above), the
 * emissive colour a palette slot and the visibility an item's, the opacity
 * texture's matrix (the identity) dropped from its UV, and the fog's fade the
 * game's own (`EmissiveFog`'s, never Babylon's).
 */

/** The vertex stage: world first, then the view-projection, as `default.vertex` and the mask's stage both did. */
export const FADE_VERTEX = /* wgsl */ `
fn fadeVertex() {
  let worldPos = fadeItem.world * vec4f(vertexInputs.position, 1.0);
  vertexOutputs.position = uniforms.viewProjection * worldPos;
  vertexOutputs.vPosW = worldPos.xyz;
#ifdef FADE_OPACITY
  // OPACITYDIRECTUV: the texture's matrix is the identity, so the UV is read
  // as it stands.
  vertexOutputs.vUV = vertexInputs.uv;
#endif
  vertexOutputs.vLook = fadeItem.look;
  vertexOutputs.vGlow = fadeItem.glow;
}
`;

/**
 * The pixel: the slot's colour (black for slot 0) with the material's alpha,
 * the opacity map's and the mesh's visibility, faded toward the fog where the
 * material was; under `GLOW_MASK` the bloom's colour, as the mask material's
 * `glowColor` was.
 */
export const FADE_SURFACE = /* wgsl */ `
fn fadeSurface() -> vec4f {
#ifdef GLOW_MASK
  return fragmentInputs.vGlow;
#else
  var alpha: f32 = 1.0;
#ifdef FADE_OPACITY
  let opacityMap = textureSample(opacityTex, opacityTexSampler, fragmentInputs.vUV);
  alpha *= opacityMap.a * 1.0;
#endif
  let slot = u32(fragmentInputs.vLook.x + 0.5);
  var emissive = vec3f(0.0);
  if (slot > 0u) {
    emissive = uniforms.emissivePalette[slot - 1u];
  }
  var color = vec4f(clamp(emissive, vec3f(0.0), vec3f(1.0)), alpha);
  color = vec4f(max(color.rgb, vec3f(0.0)), color.a);
  color = vec4f(color.rgb, color.a * fragmentInputs.vLook.y);
#ifdef FADE_FOG
  let t = clamp((distance(fragmentInputs.vPosW, uniforms.camPos) - uniforms.fogRange.x) * uniforms.fogRange.y, 0.0, 1.0);
  color = vec4f(mix(color.rgb, uniforms.fogColor, t * t), color.a);
#endif
  return color;
#endif
}
`;
