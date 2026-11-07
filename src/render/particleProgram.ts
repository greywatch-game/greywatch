/**
 * render/particleProgram.ts — The particle fields' programs as OUR renderer
 * builds them (`BABYLON_EXIT.md` X4.7c): an update pipeline a feature set and a
 * render pipeline a feature set and blend, over the modules Babylon compiled
 * (`shaders/wgsl/particles.ts`).
 * Owns: `PARTICLE_GROUP` (the draw's one bind group: Babylon's `LeftOver` block,
 * its `Internals`, the particle buffer and the sprite buffer the attributes are
 * pulled from, the field's texture), `PARTICLE_BLOCK` and `PARTICLE_INTERNALS`
 * (the two blocks, for `UniformBlockBuffer`), `ParticleBlend` and
 * `PARTICLE_BLENDS` (the two modes a field may draw in, with Babylon's
 * factors), `PARTICLE_SPRITE` (the four corners), `PARAMS_BYTES` and the
 * offsets `ParticleDraw` writes the update's `SimParams` at, and
 * `particlePipelines`, every pipeline asked once.
 * Invariants: the bindings stated here are the ones the modules declare —
 * `PARTICLE_GROUP`'s order is `firstBindings`' numbering, which the vertex and
 * fragment modules spell out by hand; the blocks' fields are Babylon's structs
 * member for member, so `blockLayout` lays them out where WGSL reads them; the
 * render state is what Babylon's cache built for the draw (read off the
 * parent's device): a triangle strip of four, no cull, depth test LEQUAL, no
 * depth write, no bias, write mask 15, `ALPHA_ADD` (colour `src-alpha, one`,
 * alpha `zero, one`: an ember leaves the coverage alone) or `ALPHA_COMBINE`
 * (colour `src-alpha, one-minus-src-alpha`, alpha `one, one`: ash accumulates
 * into it); the update's layout is `"auto"` (`PipelineCache.compute`) and
 * `SimParams`' offsets are WGSL's, which are Babylon's `UniformBuffer`'s for
 * this struct (read off the parent: `currentCount` 0 … `maxEmitBox` at float 64).
 * Never: imports Babylon; restates a shader expression (`wgsl/particles.ts`
 * holds them).
 * Contract: `docs/rendering.md`, "The particles".
 */
import type { BuiltPipeline, PipelineCache, ShaderSource } from "./PipelineCache";
import { FRAME_TARGETS } from "./targets";
import type { AssembledBinding, Binding } from "./wgsl/assemble";
import { PARTICLE_RENDER_FRAGMENT, PARTICLE_RENDER_VERTEX, PARTICLE_UPDATE_BOX } from "../shaders/wgsl/particles";

/** Babylon's `LeftOver`, member for member: what the draw's vertex stage reads. */
export const PARTICLE_BLOCK = {
  kind: "uniform",
  var: "uniforms",
  struct: "LeftOver",
  fields: [
    { name: "view", type: "mat4x4f" },
    { name: "projection", type: "mat4x4f" },
    { name: "translationPivot", type: "vec2f" },
    { name: "worldOffset", type: "vec3f" },
    { name: "invView", type: "mat4x4f" },
    { name: "colorDead", type: "vec4f" },
    { name: "eyePosition", type: "vec3f" },
  ],
} as const satisfies Binding;

/** Babylon's `Internals`: the clip-space y flip of the pass. */
export const PARTICLE_INTERNALS = {
  kind: "uniform",
  var: "internals",
  struct: "Internals",
  fields: [
    { name: "yFactor_", type: "f32" },
    { name: "textureOutputHeight_", type: "f32" },
  ],
} as const satisfies Binding;

/** The draw's group 0, in binding order: 0, 1, 2, 3, then the texture's sampler (4) and view (5). */
export const PARTICLE_GROUP = [
  PARTICLE_BLOCK,
  PARTICLE_INTERNALS,
  { kind: "storage", name: "particleData", type: "array<f32>" },
  { kind: "storage", name: "spriteData", type: "array<f32>" },
  { kind: "sampled", name: "diffuseSampler", type: "texture_2d<f32>" },
] as const satisfies readonly Binding[];

/** The four corners, offset then uv, as `_initialize`'s sprite buffer holds them. */
export const PARTICLE_SPRITE = new Float32Array([0.5, 0.5, 1, 1, -0.5, 0.5, 0, 1, 0.5, -0.5, 1, 0, -0.5, -0.5, 0, 0]);

/** How a field's draw blends: Babylon's `BLENDMODE_ADD` and `BLENDMODE_STANDARD`, the two a field of ours may take. */
export type ParticleBlend = "add" | "standard";

/** Each mode's factors, as `_setEngineBasedOnBlendMode` set them (`ALPHA_ADD`, `ALPHA_COMBINE`). */
export const PARTICLE_BLENDS: Readonly<Record<ParticleBlend, GPUBlendState>> = {
  add: {
    color: { srcFactor: "src-alpha", dstFactor: "one", operation: "add" },
    alpha: { srcFactor: "zero", dstFactor: "one", operation: "add" },
  },
  standard: {
    color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
    alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
  },
};

/**
 * `SimParams`' members, in floats from the struct's start (WGSL's layout, and
 * Babylon's `UniformBuffer`'s for the box emitter's feature set).
 */
export const PARAMS = {
  currentCount: 0,
  timeDelta: 1,
  stopFactor: 2,
  /** An `i32`. */
  randomTextureSize: 3,
  lifeTime: 4,
  emitPower: 6,
  emitIndex: 8,
  emitCount: 9,
  color1: 12,
  color2: 16,
  sizeRange: 20,
  scaleRange: 24,
  angleRange: 28,
  gravity: 32,
  emitterWM: 36,
  direction1: 52,
  direction2: 56,
  minEmitBox: 60,
  maxEmitBox: 64,
} as const;

/** `SimParams`' size: 68 floats, the struct's 268 bytes rounded to its 16-byte alignment. */
export const PARAMS_BYTES = 272;

/** The update module, for `PipelineCache.compute`. */
export const PARTICLE_UPDATE_LABEL = "particles-update-box";

const binding = (
  b: number,
  kind: AssembledBinding["kind"],
  name: string,
  type: string,
): AssembledBinding => ({ group: 0, binding: b, kind, name, type });

/** The draw's vertex module: the two blocks and the two buffers. */
const VERTEX: ShaderSource = {
  label: "particles-render-vertex",
  code: PARTICLE_RENDER_VERTEX,
  bindings: [
    binding(0, "uniform", "uniforms", "LeftOver"),
    binding(1, "uniform", "internals", "Internals"),
    binding(2, "storage", "particleData", "array<f32>"),
    binding(3, "storage", "spriteData", "array<f32>"),
  ],
};

/** The draw's fragment module: the texture. */
const FRAGMENT: ShaderSource = {
  label: "particles-render-fragment",
  code: PARTICLE_RENDER_FRAGMENT,
  bindings: [
    binding(4, "sampler", "diffuseSamplerSampler", "sampler"),
    binding(5, "texture", "diffuseSampler", "texture_2d<f32>"),
  ],
};

/** Every pipeline a field of the motes' feature set draws or updates with, as the cache settles them. */
export interface ParticlePipelines {
  readonly update: Promise<GPUComputePipeline>;
  readonly render: Readonly<Record<ParticleBlend, Promise<BuiltPipeline>>>;
}

/** Asks the cache for the update and both blends' draws — once, at construction (`Game.roundPipelines`). */
export function particlePipelines(cache: PipelineCache): ParticlePipelines {
  const render = (blend: ParticleBlend): Promise<BuiltPipeline> =>
    cache.get({
      vertex: VERTEX,
      vertexEntry: "main",
      fragment: FRAGMENT,
      fragmentEntry: "main",
      targets: FRAME_TARGETS,
      state: {
        topology: "triangle-strip",
        cullMode: "none",
        depthWrite: false,
        depthCompare: "less-equal",
        blend: PARTICLE_BLENDS[blend],
      },
    });
  return {
    update: cache.compute(PARTICLE_UPDATE_LABEL, PARTICLE_UPDATE_BOX, "main"),
    render: { add: render("add"), standard: render("standard") },
  };
}
