/**
 * wgsl/emissiveWorld.ts — The emissive palette's two BODIES, as plain strings
 * both renderers assemble: Babylon's `EmissiveWorldMaterial` (and its glow
 * mask twin, `shaders/EmissiveWorld.ts`) and ours, which draws the palette
 * into a reflection probe's faces (`render/emissiveWorld.ts`, `BABYLON_EXIT.md`
 * X3.6c).
 * Owns: `EMISSIVE_WORLD_VERTEX` (`emissiveWorldVertex`, the vertex stage),
 * `EMISSIVE_WORLD_SURFACE` (`emissiveWorldSurface`, the pixel — the frame's
 * and, under `GLOW_MASK`, the bloom's) and `MAX_EMISSIVE_PALETTE`.
 * Invariants: a body DECLARES NOTHING (`wgsl/chunks.ts`' rule, for the same
 * reason): it reads `uniforms.<name>`, `vertexInputs.<name>` and
 * `fragmentInputs.<name>` and writes `vertexOutputs.<name>`, and each side
 * declares those its own way — so the palette's pixel is one text, and the
 * probe's lamps are the frame's lamps by construction.
 * Never: imports Babylon (`src/render/` imports this, and the build gate
 * walks it); declares a binding.
 * Contract: `docs/rendering.md`, "The paint palette" and "Hand-written WGSL".
 */

/**
 * How many emissive colours one map's merged world may carry before the merge
 * stops collapsing them — `MAX_PALETTE`'s twin, and overflow is graceful for
 * the same reason: slot 0 means "keep your own material". The shipped maps use
 * at most 19 materials (Coldharbour, over-glass variants counted apart), so
 * this is better than a doubling of the hexes behind them.
 */
export const MAX_EMISSIVE_PALETTE = 32;

/** The vertex stage: the world position, its clip position and the slot. */
export const EMISSIVE_WORLD_VERTEX = /* wgsl */ `
fn emissiveWorldVertex() {
  // World first, then the view-projection — the order Babylon's own
  // StandardMaterial transforms in, so the depth this writes is the depth that
  // material wrote for the same vertex.
  let worldPos = uniforms.world * vec4f(vertexInputs.position, 1.0);
  vertexOutputs.position = uniforms.viewProjection * worldPos;
  vertexOutputs.vPosW = worldPos.xyz;
  // The 1-based slot \`writePaletteIndex\` stamped on every vertex of a source
  // mesh — constant across a triangle, so interpolation cannot move it.
  vertexOutputs.vSlot = vertexInputs.uv2.x;
}
`;

/**
 * The pixel: the slot's colour faded toward the fog by `EmissiveFog`'s curve
 * over the radial distance to `camPos` — the cel materials' eye, a probe's
 * in a bake (`EmissiveWorld.ts`, "WHY ITS OWN EYE") — alpha 1; under
 * `GLOW_MASK` faded toward BLACK instead and scaled by the bloom's colour.
 */
export const EMISSIVE_WORLD_SURFACE = /* wgsl */ `
fn emissiveWorldSurface() -> vec4f {
  let col = uniforms.emissivePalette[u32(fragmentInputs.vSlot + 0.5) - 1u];
  let t = clamp((distance(fragmentInputs.vPosW, uniforms.camPos) - uniforms.fogRange.x) * uniforms.fogRange.y, 0.0, 1.0);
#ifdef GLOW_MASK
  // Toward BLACK, where the frame below fades toward the fog — a bloom of the
  // fog colour is a white haze round every far lamp (GlowPass's header).
  return vec4f(col * (1.0 - t * t) * uniforms.glowColor.rgb, uniforms.glowColor.a);
#else
  // What the unlit StandardMaterial wrote — clamp(emissive) with no light, the
  // material's alpha of 1 — and then EmissiveFog's mix. Alpha is 1 in a
  // reflection bake and in the frame alike, which is what that material wrote
  // into the coverage channel and so what this keeps: an emissive pixel takes
  // no ink in the frame (GlowPass.mask already holds it out) and is city in a
  // probe's cube.
  return vec4f(mix(col, uniforms.fogColor, t * t), 1.0);
#endif
}
`;
