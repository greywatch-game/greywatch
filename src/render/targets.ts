/**
 * render/targets.ts — The attachments the frame's main pass draws into, the
 * glow's mask, and the ones the shadow maps and the lamps' atlas are drawn
 * into, each stated ONCE: every pipeline our renderer builds for one of those
 * passes is built against its own, and nothing else in `src/render/` writes a
 * format.
 * Owns: `FRAME_TARGETS`, `GLOW_TARGETS`, `SHADOW_TARGETS` and `targetsKey`.
 * Invariants: `FRAME_TARGETS` is what the host's main pass is, and
 * `GLOW_TARGETS` what its glow mask's pass is (`FrameHost.passIs`), each
 * checked by `Renderer` on every frame it draws there — a pass that is not
 * REFUSES the frame's draws rather than recording a pipeline it cannot take.
 * Never: imports Babylon; is read off the pass per draw — a pipeline is
 * compiled ahead, so the formats it is compiled for must be known ahead.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 *
 * WHY THESE FOUR. Under `compatibilityMode = false` Babylon records render
 * bundles, and a bundle or pipeline whose attachment state differs from the
 * pass's by a format, a count or a sample count is refused — and one refused
 * pipeline poisons the bundle and blacks out the frame (`docs/rendering.md`:
 * "The trap it found" for the cascade, "The MRT route, spiked" for bundles
 * keyed on attachment state). What the frame draws into is the post chain's first
 * target, `CelInk`'s: one `rgba8unorm` colour attachment (a post-process's
 * default texture), one sample (`main.ts` builds the engine with
 * `antialias: false`), and `depth32float` (`stencil: false`;
 * `plans/webgpu-ref/depth.mjs`). And it is a TEXTURE, which Babylon renders
 * upside down — so `flipY`, which negates clip-space y in every vertex stage
 * and mirrors every triangle's winding (`PipelineCache` derives the front
 * face from it).
 */
import type { PassTargets } from "./frameHost";

/** The frame's main pass, as every pipeline drawn into it is built. */
export const FRAME_TARGETS: PassTargets = {
  colorFormats: ["rgba8unorm"],
  depthFormat: "depth32float",
  sampleCount: 1,
  flipY: true,
};

/**
 * The glow's MASK pass (`shaders/GlowPass.ts`), which our renderer draws the
 * emissive palette into (`render/WorldGlow.ts`, `BABYLON_EXIT.md` X3.6d): the
 * mask is Babylon's render target, an `rgba8unorm` colour
 * (`TEXTURETYPE_UNSIGNED_BYTE`), and its depth is the FRAME's, borrowed
 * (`shareDepth`), so `depth32float`; one sample; and a texture, drawn upside
 * down. The same values as `FRAME_TARGETS`, stated apart because they are
 * true for another reason — a change to the post chain's first target and a
 * change to the mask's format are two changes, and each pass refuses its own.
 */
export const GLOW_TARGETS: PassTargets = {
  colorFormats: ["rgba8unorm"],
  depthFormat: "depth32float",
  sampleCount: 1,
  flipY: true,
};

/**
 * A world shadow map's pass (`render/WorldShadows.ts`, `BABYLON_EXIT.md`
 * X3.6a): the caster's depth in an `r16float` colour attachment, which every
 * reader samples through a FILTERING sampler for channel 0 alone (the cel
 * lookup's `textureGather`, the volumetrics' `.x`) — Babylon's map was `rgba16float` with the depth in red and 1 in the
 * other three, which no reader reads, so the one channel is the same numbers
 * in a quarter of the memory; a `depth32float` attachment for the test, as
 * Babylon's; one sample; and drawn upside down as Babylon draws every render
 * target, which is the way up every reader's `clip.xy * 0.5 + 0.5` assumes.
 * The lamps' atlas is drawn into the same (`render/LampAtlas.ts`, X3.6b),
 * its one channel the radial distance its render target held in Babylon's
 * `r16float` already.
 */
export const SHADOW_TARGETS: PassTargets = {
  colorFormats: ["r16float"],
  depthFormat: "depth32float",
  sampleCount: 1,
  flipY: true,
};

/** A key a pipeline's attachment state is cached under. */
export function targetsKey(t: PassTargets): string {
  return `${t.colorFormats.join(",")}|${t.depthFormat ?? "-"}|${t.sampleCount}|${t.flipY ? "flip" : "up"}`;
}
