/**
 * render/targets.ts — The attachments the frame's main pass draws into, the
 * glow's mask and its blur, the post chain's stages (X5.2c1), and the ones the
 * shadow maps and the lamps' atlas are drawn into, each stated ONCE: every pipeline our renderer builds for one of those
 * passes is built against its own, and nothing else in `src/render/` writes a
 * format.
 * Owns: `FRAME_TARGETS`, `GLOW_TARGETS`, `GLOW_BLUR_TARGETS`, `POST_TARGETS`,
 * `canvasTargets`, `SHADOW_TARGETS` and `targetsKey`.
 * Invariants: `FRAME_TARGETS` is what the frame's main pass is,
 * `GLOW_TARGETS` what the glow mask's pass is and `GLOW_BLUR_TARGETS` what
 * each pass of the glow's blur is — our renderer's own targets since
 * `BABYLON_EXIT.md` X5.4e, MADE from these (`render/FrameTargets.ts`), so
 * each of those passes takes its pipelines by construction; and
 * `POST_TARGETS` and `canvasTargets` what a post-chain stage's pass is —
 * our renderer's own since X5.4f, BEGUN from these (`render/ChainPasses.ts`),
 * where until then it was a pass of the HOST's, checked by `Renderer` on
 * every frame it drew there (`FrameHost.passIs`), a pass that was not
 * refusing the draw.
 * Never: imports Babylon; is read off the pass per draw — a pipeline is
 * compiled ahead, so the formats it is compiled for must be known ahead.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 *
 * WHY THESE. A pipeline whose attachment state differs from the pass's by a
 * format, a count or a sample count is refused (and while Babylon recorded
 * render bundles under `compatibilityMode = false`, until `BABYLON_EXIT.md`
 * X5.4e, one refused
 * pipeline poisons the bundle and blacks out the frame (`docs/rendering.md`:
 * "The trap it found" for the cascade, "The MRT route, spiked" for bundles
 * keyed on attachment state). What the frame draws into is the FRAME — our
 * renderer's target since `BABYLON_EXIT.md` X5.4e (`FrameTargets.frame`),
 * `PostPasses`' render target (the camera's `outputRenderTarget`) from X5.2d
 * to X5.4e
 * — made as the post chain's first target, `CelInk`'s input, was: one
 * `rgba8unorm` colour attachment (a post-process's default texture), one
 * sample (Babylon's engine was built with `antialias: false`, and `main.ts`
 * asks for no multisampling since X5.4h), and
 * `depth32float` (`stencil: false`; `plans/webgpu-ref/depth.mjs`). And it is a
 * TEXTURE, which Babylon rendered upside down and ours renders the same way —
 * so `flipY`, which negates clip-space y in every vertex stage and mirrors
 * every triangle's winding (`PipelineCache` derives the front face from it).
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
 * The glow's MASK pass, which our renderer draws the emissive palette into
 * (`render/WorldGlow.ts`, `BABYLON_EXIT.md` X3.6d) and records itself since
 * X5.4e (`Renderer.recordGlowMask`): the mask is made as Babylon's render
 * target was, an `rgba8unorm` colour (`TEXTURETYPE_UNSIGNED_BYTE`), and its
 * depth is the FRAME's, borrowed (as `shareDepth` attached it), so
 * `depth32float`; one sample; and a texture, drawn upside down. The same values as `FRAME_TARGETS`, stated apart because they are
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
 * A pass of the glow's BLUR (`render/GlowBlur.ts` draws in it, `BABYLON_EXIT.md`
 * X5.2b; `Renderer.glowBlurPass` begins it, X5.4e): the box filter's and the
 * four blurs' targets are made as Babylon's render targets of
 * `TEXTURETYPE_HALF_FLOAT` were, so `rgba16float`, with NO depth
 * (`generateDepthBuffer` false, and the pass begun without one); one sample;
 * and a texture, drawn upside down — the probe read every one of the five so
 * (`plans/webgpu-ref/post.mjs`, X5.2a).
 */
export const GLOW_BLUR_TARGETS: PassTargets = {
  colorFormats: ["rgba16float"],
  depthFormat: undefined,
  sampleCount: 1,
  flipY: true,
};

/**
 * A pass of the POST CHAIN into a texture (`render/PostChain.ts`, `BABYLON_EXIT.md`
 * X5.2c1): what a stage of ours draws into when another stage of ours follows
 * it — a target of the chain's pool, made as Babylon made a post-process's
 * input (`TEXTURETYPE_UNSIGNED_BYTE`, so `rgba8unorm`, no depth, one sample)
 * and drawn upside down as every render target is. Babylon's own post passes
 * into a texture were read so by the probe (`plans/webgpu-ref/post.mjs`, X5.2a).
 */
export const POST_TARGETS: PassTargets = {
  colorFormats: ["rgba8unorm"],
  depthFormat: undefined,
  sampleCount: 1,
  flipY: true,
};

/**
 * The CANVAS's pass, as the post chain's LAST stage draws into it (X5.2c1):
 * Babylon's main pass, whose colour is the swap chain's — `format`, the
 * device's preferred canvas format, which is what the engine configured the
 * context with (`main.ts` names none: `bgra8unorm` on Windows, `rgba8unorm`
 * on Android) — and whose depth is the ENGINE's own `depth32float`
 * (`stencil: false`), not the frame's (X5.2a measured it); one sample; and
 * NOT flipped: the canvas is drawn the right way up. A function of the
 * format because that is the device's, not a constant of the tree's.
 */
export function canvasTargets(format: GPUTextureFormat): PassTargets {
  return { colorFormats: [format], depthFormat: "depth32float", sampleCount: 1, flipY: false };
}

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
