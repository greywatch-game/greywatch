/**
 * wgsl/sky.ts — The dome and the moon as plain strings OUR renderer assembles
 * (`render/skyProgram.ts`, `BABYLON_EXIT.md` X4.5c): what `StandardMaterial`
 * compiled to for these two, and what `GlowPass`'s mask material compiled to for
 * the moon, read off the effects Babylon built (the defines in force: `EMISSIVE`,
 * for the moon `OPACITY`, `ALPHABLEND`; no light, no fog, no image processing, no
 * specular, no reflection).
 * Owns: `SKY_VERTEX` (`skyVertex`) and `SKY_SURFACE` (`skySurface`), and the two
 * defines that make its three variants (`SKY_OPACITY`, `SKY_GLOW`).
 * Invariants: the arithmetic is Babylon's, with the terms that are exactly 0 or
 * exactly 1 for these two taken out: `finalDiffuse` was `clamp(diffuseBase *
 * diffuseColor + emissive + ambient, 0, 1) * baseColor`, over a black diffuse and
 * ambient and a white base, and `color` that plus a black specular, reflection
 * and refraction, so the colour is the CLAMPED sum of the emissive colour (the
 * flash's on the dome, the boost's on the moon) and the texture, which is what
 * saturates the moon's face; the texture's level is 1; the alpha is the material's
 * 1 (the dome's) or that times the opacity texture's alpha, the moon's emissive
 * and opacity texture being one texture, sampled once. The mask's colour is
 * `GlowPass`'s term for term and is not clamped, the target clamping it; a body
 * DECLARES NOTHING (`wgsl/chunks.ts`' rule).
 * The dome's alpha is a LITERAL 1, as the material's was: not `opaqueAlpha`, the
 * sky being in no bake, and not the 0 an opaque surface writes, so `CelInk`'s edge
 * is scaled to nothing over it, as it has been.
 * Never: imports Babylon (`src/render/` imports this, and the build gate walks
 * it); declares a binding; lights or fogs anything.
 * Contract: `docs/rendering.md`, "The sky".
 */

/** The vertex stage: world first, then the view-projection, as `default.vertex` and the mask's. */
export const SKY_VERTEX = /* wgsl */ `
fn skyVertex() {
  let worldPos = uniforms.skyWorld * vec4f(vertexInputs.position, 1.0);
  vertexOutputs.position = uniforms.viewProjection * worldPos;
  vertexOutputs.vUV = vertexInputs.uv;
}
`;

/**
 * The pixel. `SKY_GLOW` is the moon's mask (`uniforms.skyGlow`: rgb the bloom
 * colour, a the material's alpha); `SKY_OPACITY` the disc's limb; neither, the dome.
 */
export const SKY_SURFACE = /* wgsl */ `
fn skySurface() -> vec4f {
  let tex = textureSample(skyTexture, skyTextureSampler, fragmentInputs.vUV);
#ifdef SKY_GLOW
  var colour = uniforms.skyGlow;
  colour = vec4f(colour.rgb, colour.a * tex.a);
  colour = colour * tex;
  return colour;
#else
  let rgb = clamp(uniforms.skyEmissive + tex.rgb, vec3f(0.0), vec3f(1.0));
#ifdef SKY_OPACITY
  return vec4f(rgb, tex.a);
#else
  return vec4f(rgb, 1.0);
#endif
#endif
}
`;
