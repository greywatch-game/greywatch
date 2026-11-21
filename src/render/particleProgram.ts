/**
 * render/particleProgram.ts — The particle fields' programs as OUR renderer
 * builds them (`BABYLON_EXIT.md` X4.7c, X4.7d): an update pipeline a feature
 * set and a render pipeline a feature set and blend, over the modules Babylon
 * compiled (`shaders/wgsl/particles.ts`).
 * Owns: `ParticleFeatures` (the two feature sets a field of ours is built with:
 * the ash's `"box"` and the rotor wash's `"ring"`); each set's draw group
 * (`PARTICLE_GROUP`, `PARTICLE_RING_GROUP`: Babylon's `LeftOver` block, its
 * `Internals`, the particle buffer and the sprite buffer the attributes are
 * pulled from, the field's texture, and for the ring its colour gradient), its
 * block (`PARTICLE_BLOCK`, `PARTICLE_RING_BLOCK`) and `PARTICLE_INTERNALS` (for
 * `UniformBlockBuffer`); `ParticleBlend` and `PARTICLE_BLENDS` (the two modes a
 * field may draw in, with Babylon's factors) and `RING_BLENDS` (the one the
 * ring is drawn in); `PARTICLE_SPRITE` (the four corners); each set's
 * `SimParams` size and the offsets `ParticleDraw` writes it at (`PARAMS`,
 * `RING_PARAMS`); the ring's update layout (`RING_UPDATE_GROUPS`) and the
 * samplers its gradients are read through (`RING_COLOR_SAMPLER`,
 * `RING_FACTOR_SAMPLER`); and `particlePipelines`, every pipeline asked once.
 * Invariants: the bindings stated here are the ones the modules declare —
 * each group's order is `firstBindings`' numbering, which the vertex and
 * fragment modules spell out by hand; the blocks' fields are Babylon's structs
 * member for member, so `blockLayout` lays them out where WGSL reads them; the
 * render state is what Babylon's cache built for the draw (read off the
 * parent's device): a triangle strip of four, no cull, depth test LEQUAL, no
 * depth write, no bias, write mask 15, `ALPHA_ADD` (colour `src-alpha, one`,
 * alpha `zero, one`: an ember leaves the coverage alone) or `ALPHA_COMBINE`
 * (colour `src-alpha, one-minus-src-alpha`, alpha `one, one`: ash and dust
 * accumulate into it); the box's update layout is `"auto"` (`PipelineCache.
 * compute`) and the ring's is Babylon's explicit one — its gradients are
 * `rg32float`, an UNFILTERABLE float read through a NON-FILTERING sampler,
 * which `"auto"` would type as filterable; the samplers are the descriptors
 * Babylon's cache made for those textures (read off the parent's device: the
 * colour's nearest and clamped, the factors' nearest and REPEATING, which is
 * what an age past its life reads); `SimParams`' offsets are WGSL's, which are
 * Babylon's `UniformBuffer`'s for each struct (read off the parent: the box's
 * `currentCount` 0 … `maxEmitBox` at float 64, the ring's … `directionRandomizer`
 * at float 43).
 * Never: imports Babylon; restates a shader expression (`wgsl/particles.ts`
 * holds them).
 * Contract: `docs/rendering.md`, "The particles".
 */
import type { BuiltPipeline, PipelineCache, ShaderSource } from "./PipelineCache";
import { FRAME_TARGETS } from "./targets";
import type { AssembledBinding, Binding } from "./wgsl/assemble";
import {
  PARTICLE_RENDER_FRAGMENT,
  PARTICLE_RENDER_VERTEX,
  PARTICLE_RING_RENDER_VERTEX,
  PARTICLE_UPDATE_BOX,
  PARTICLE_UPDATE_RING,
} from "../shaders/wgsl/particles";

/**
 * Which of Babylon's feature sets a field is: `"box"`, the ash's (a box
 * emitter, a colour per slot, no gradient), or `"ring"`, the rotor wash's (a
 * cylinder emitter, a two-row colour gradient, size and velocity gradients).
 * Each is its own compiled modules; a field needing another owes the port.
 */
export type ParticleFeatures = "box" | "ring";

/** Babylon's `LeftOver`, member for member: what the box's draw's vertex stage reads. */
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

/** The ring's `LeftOver`: the box's without `colorDead`, which a colour gradient takes the place of. */
export const PARTICLE_RING_BLOCK = {
  kind: "uniform",
  var: "uniforms",
  struct: "LeftOver",
  fields: [
    { name: "view", type: "mat4x4f" },
    { name: "projection", type: "mat4x4f" },
    { name: "translationPivot", type: "vec2f" },
    { name: "worldOffset", type: "vec3f" },
    { name: "invView", type: "mat4x4f" },
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

/** The box's draw group 0, in binding order: 0, 1, 2, 3, then the texture's sampler (4) and view (5). */
export const PARTICLE_GROUP = [
  PARTICLE_BLOCK,
  PARTICLE_INTERNALS,
  { kind: "storage", name: "particleData", type: "array<f32>" },
  { kind: "storage", name: "spriteData", type: "array<f32>" },
  { kind: "sampled", name: "diffuseSampler", type: "texture_2d<f32>" },
] as const satisfies readonly Binding[];

/** The ring's draw group 0: the box's, and the colour gradient's sampler (6) and view (7). */
export const PARTICLE_RING_GROUP = [
  PARTICLE_RING_BLOCK,
  PARTICLE_INTERNALS,
  { kind: "storage", name: "particleData", type: "array<f32>" },
  { kind: "storage", name: "spriteData", type: "array<f32>" },
  { kind: "sampled", name: "diffuseSampler", type: "texture_2d<f32>" },
  { kind: "sampled", name: "colorGradientSampler", type: "texture_2d<f32>" },
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

/** The blends each feature set is drawn in: the ash's both (a map change can flip it), the rotor wash's STANDARD alone. */
export const FEATURE_BLENDS: Readonly<Record<ParticleFeatures, readonly ParticleBlend[]>> = {
  box: ["add", "standard"],
  ring: ["standard"],
};

/**
 * The box's `SimParams` members, in floats from the struct's start (WGSL's
 * layout, and Babylon's `UniformBuffer`'s for the box emitter's feature set).
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

/** The box's `SimParams` size: 68 floats, the struct's 268 bytes rounded to its 16-byte alignment. */
export const PARAMS_BYTES = 272;

/**
 * The ring's `SimParams` members (Babylon's `UniformBuffer` for the cylinder
 * emitter with colour gradients, read off the parent: no colours, and the
 * cylinder's four numbers after the emitter's matrix).
 */
export const RING_PARAMS = {
  currentCount: 0,
  timeDelta: 1,
  stopFactor: 2,
  /** An `i32`. */
  randomTextureSize: 3,
  lifeTime: 4,
  emitPower: 6,
  emitIndex: 8,
  emitCount: 9,
  sizeRange: 10,
  scaleRange: 12,
  angleRange: 16,
  gravity: 20,
  emitterWM: 24,
  radius: 40,
  height: 41,
  radiusRange: 42,
  directionRandomizer: 43,
} as const;

/** The ring's `SimParams` size: 44 floats, 176 bytes (the buffer Babylon bound). */
export const RING_PARAMS_BYTES = 176;

/** The update modules' labels, for `PipelineCache.compute`. */
export const PARTICLE_UPDATE_LABEL = "particles-update-box";
export const PARTICLE_RING_UPDATE_LABEL = "particles-update-ring";

/** The texel width of every gradient texture Babylon bakes (`_rawTextureWidth`). */
export const GRADIENT_WIDTH = 256;

const COMPUTE = 4; // GPUShaderStage.COMPUTE, as a literal: this module is read before a device exists.

/**
 * The ring's update layout, Babylon's explicit one as the parent's device made
 * it: group 0 the box's (the block, the two buffers, the two random textures,
 * unfilterable); group 1 the size gradient's sampler and texture at 0 and 1 and
 * the velocity gradient's at 4 and 5, non-filtering and unfilterable.
 */
export const RING_UPDATE_GROUPS: readonly (readonly GPUBindGroupLayoutEntry[])[] = [
  [
    { binding: 0, visibility: COMPUTE, buffer: { type: "uniform" } },
    { binding: 1, visibility: COMPUTE, buffer: { type: "read-only-storage" } },
    { binding: 2, visibility: COMPUTE, buffer: { type: "storage" } },
    { binding: 3, visibility: COMPUTE, texture: { sampleType: "unfilterable-float", viewDimension: "2d", multisampled: false } },
    { binding: 4, visibility: COMPUTE, texture: { sampleType: "unfilterable-float", viewDimension: "2d", multisampled: false } },
  ],
  [
    { binding: 0, visibility: COMPUTE, sampler: { type: "non-filtering" } },
    { binding: 1, visibility: COMPUTE, texture: { sampleType: "unfilterable-float", viewDimension: "2d", multisampled: false } },
    { binding: 4, visibility: COMPUTE, sampler: { type: "non-filtering" } },
    { binding: 5, visibility: COMPUTE, texture: { sampleType: "unfilterable-float", viewDimension: "2d", multisampled: false } },
  ],
];

/**
 * The sampler the ring's colour gradient is drawn through: Babylon's for a
 * `RawTexture` at `TEXTURE_NEAREST_SAMPLINGMODE` with no mips, its wrap CLAMP —
 * the descriptor the parent's device was handed for it.
 */
export const RING_COLOR_SAMPLER: GPUSamplerDescriptor = {
  label: "particles: colour gradient",
  magFilter: "nearest",
  minFilter: "nearest",
  mipmapFilter: "nearest",
  lodMinClamp: 0,
  lodMaxClamp: 0,
  addressModeU: "clamp-to-edge",
  addressModeV: "clamp-to-edge",
  addressModeW: "repeat",
  maxAnisotropy: 1,
};

/**
 * The sampler the ring's update reads its size and velocity gradients through:
 * the descriptor the parent's device was handed for them — nearest, and
 * REPEATING, the compute shader binding them with the sampler state of a
 * texture no material had bound (so an age at or past its life wraps to the
 * first texel, as Babylon's did).
 */
export const RING_FACTOR_SAMPLER: GPUSamplerDescriptor = {
  label: "particles: factor gradients",
  magFilter: "nearest",
  minFilter: "nearest",
  mipmapFilter: "nearest",
  lodMinClamp: 0,
  lodMaxClamp: 0,
  addressModeU: "repeat",
  addressModeV: "repeat",
  addressModeW: "repeat",
  maxAnisotropy: 1,
};

const binding = (
  b: number,
  kind: AssembledBinding["kind"],
  name: string,
  type: string,
): AssembledBinding => ({ group: 0, binding: b, kind, name, type });

/** The box's draw's vertex module: the two blocks and the two buffers. */
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

/** The ring's draw's vertex module: the box's bindings, and the colour gradient it samples. */
const RING_VERTEX: ShaderSource = {
  label: "particles-ring-render-vertex",
  code: PARTICLE_RING_RENDER_VERTEX,
  bindings: [
    binding(0, "uniform", "uniforms", "LeftOver"),
    binding(1, "uniform", "internals", "Internals"),
    binding(2, "storage", "particleData", "array<f32>"),
    binding(3, "storage", "spriteData", "array<f32>"),
    binding(6, "sampler", "colorGradientSamplerSampler", "sampler"),
    binding(7, "texture", "colorGradientSampler", "texture_2d<f32>"),
  ],
};

/** Both sets' draw's fragment module: the texture. */
const FRAGMENT: ShaderSource = {
  label: "particles-render-fragment",
  code: PARTICLE_RENDER_FRAGMENT,
  bindings: [
    binding(4, "sampler", "diffuseSamplerSampler", "sampler"),
    binding(5, "texture", "diffuseSampler", "texture_2d<f32>"),
  ],
};

/** Every pipeline a feature set draws or updates with, as the cache settles them; a blend the set is never drawn in is absent. */
export interface ParticlePipelines {
  readonly update: Promise<GPUComputePipeline>;
  readonly render: Readonly<Partial<Record<ParticleBlend, Promise<BuiltPipeline>>>>;
}

/** Asks the cache for each set's update and its blends' draws — once, at construction (`Game.roundPipelines`). */
export function particlePipelines(cache: PipelineCache): Readonly<Record<ParticleFeatures, ParticlePipelines>> {
  const render = (vertex: ShaderSource, blend: ParticleBlend): Promise<BuiltPipeline> =>
    cache.get({
      vertex,
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
    box: {
      update: cache.compute(PARTICLE_UPDATE_LABEL, PARTICLE_UPDATE_BOX, "main"),
      render: { add: render(VERTEX, "add"), standard: render(VERTEX, "standard") },
    },
    ring: {
      update: cache.compute(PARTICLE_RING_UPDATE_LABEL, PARTICLE_UPDATE_RING, "main", RING_UPDATE_GROUPS),
      render: { standard: render(RING_VERTEX, "standard") },
    },
  };
}
