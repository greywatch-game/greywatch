/**
 * render/cubeMips.ts — A cube texture's MIP CHAIN as our renderer makes it
 * (`BABYLON_EXIT.md` X3.6c): each level of each face drawn from the level
 * above, as Babylon's `WebGPUTextureManager.generateCubeMipmaps` draws a
 * reflection probe's after its sixth face.
 * Owns: `CubeMips` — the pipeline (asked through the renderer's
 * `PipelineCache`, so the building card's warm-up waits on it), the sampler,
 * and each cube's chain: a pass and a bind group per face per level, made
 * the first time that cube is chained and kept with it (as Babylon keeps them
 * on the hardware texture).
 * Invariants: the filter is Babylon's, number for number — a full-screen
 * strip of four corners sampling level `i - 1` at the texel centres of level
 * `i` through a sampler that is `linear` for minification and Babylon's
 * defaults otherwise (`nearest` magnification and mip, clamped), so each
 * texel is the box average of the four above it — faces in layer order,
 * levels top down, each pass loading its level and storing it; it records
 * into the encoder it is handed and submits nothing; a cube's chain is
 * forgotten only with the cube (`forget`).
 * Never: imports Babylon; reads a node; allocates on a frame once a cube has
 * been chained once.
 * Contract: `docs/rendering.md`, "The glazing and the reflection bake".
 */
import type { PassTargets } from "./frameHost";
import type { BuiltPipeline, PipelineCache, ShaderSource } from "./PipelineCache";

/** One module holding both stages: Babylon's `mipmapVertexSource` and `mipmapFragmentSource`, in plain WGSL. */
const MIP_WGSL = /* wgsl */ `
@group(0) @binding(0) var img: texture_2d<f32>;
@group(0) @binding(1) var imgSampler: sampler;

struct Corner {
  @builtin(position) position: vec4f,
  @location(0) vTex: vec2f,
}

@vertex
fn vertexMain(@builtin(vertex_index) i: u32) -> Corner {
  let pos = array<vec2f, 4>(vec2f(-1.0, 1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, -1.0));
  let tex = array<vec2f, 4>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0), vec2f(1.0, 1.0));
  var out: Corner;
  out.vTex = tex[i];
  out.position = vec4f(pos[i], 0.0, 1.0);
  return out;
}

@fragment
fn fragmentMain(input: Corner) -> @location(0) vec4f {
  return textureSample(img, imgSampler, input.vTex);
}
`;

const MIP_SOURCE: ShaderSource = {
  label: "cube mips",
  code: MIP_WGSL,
  bindings: [
    { group: 0, binding: 0, kind: "texture", name: "img", type: "texture_2d<f32>" },
    { group: 0, binding: 1, kind: "sampler", name: "imgSampler", type: "sampler" },
  ],
};

/** A level's pass: no depth, and — Babylon's mip passes are its own, never a render target's — drawn the right way up. */
function mipTargets(format: GPUTextureFormat): PassTargets {
  return { colorFormats: [format], depthFormat: undefined, sampleCount: 1, flipY: false };
}

/** One cube's chain: a pass and a bind group per face per level past the first. */
interface Chain {
  readonly passes: GPURenderPassDescriptor[];
  readonly groups: GPUBindGroup[];
}

export class CubeMips {
  /** Resolves true once the pipeline is built; false if it failed. */
  readonly ready: Promise<boolean>;
  private built: BuiltPipeline | null = null;
  private readonly sampler: GPUSampler;
  private readonly chains = new Map<GPUTexture, Chain>();

  constructor(
    private readonly device: GPUDevice,
    pipelines: PipelineCache,
    format: GPUTextureFormat,
  ) {
    // Babylon's `_mipmapSampler`: only the minification filter is stated.
    this.sampler = device.createSampler({ label: "cube mips", minFilter: "linear" });
    this.ready = pipelines
      .get({
        vertex: MIP_SOURCE,
        vertexEntry: "vertexMain",
        fragment: MIP_SOURCE,
        fragmentEntry: "fragmentMain",
        targets: mipTargets(format),
        state: { topology: "triangle-strip", cullMode: "none", depthWrite: false },
      })
      .then(
        (built) => {
          this.built = built;
          return true;
        },
        (err: unknown) => {
          console.error("cube mips: the pipeline did not build", err);
          return false;
        },
      );
  }

  /** `cube`'s levels 1 and down, every face, from the level above — false, recording nothing, before the pipeline is built. */
  record(cube: GPUTexture, encoder: GPUCommandEncoder): boolean {
    const built = this.built;
    if (!built) return false;
    const chain = this.chainOf(cube, built);
    for (let k = 0; k < chain.passes.length; k++) {
      const pass = encoder.beginRenderPass(chain.passes[k]);
      pass.setPipeline(built.pipeline);
      pass.setBindGroup(0, chain.groups[k]);
      pass.draw(4);
      pass.end();
    }
    return true;
  }

  /** Drops `cube`'s chain: the cube is going. */
  forget(cube: GPUTexture): void {
    this.chains.delete(cube);
  }

  private chainOf(cube: GPUTexture, built: BuiltPipeline): Chain {
    let chain = this.chains.get(cube);
    if (chain) return chain;
    const passes: GPURenderPassDescriptor[] = [];
    const groups: GPUBindGroup[] = [];
    const view = (level: number, face: number): GPUTextureView =>
      cube.createView({
        dimension: "2d",
        baseMipLevel: level,
        mipLevelCount: 1,
        baseArrayLayer: face,
        arrayLayerCount: 1,
      });
    for (let face = 0; face < cube.depthOrArrayLayers; face++) {
      for (let level = 1; level < cube.mipLevelCount; level++) {
        passes.push({
          label: `cube mips: face ${face} level ${level}`,
          colorAttachments: [{ view: view(level, face), loadOp: "load", storeOp: "store" }],
        });
        groups.push(
          this.device.createBindGroup({
            label: `cube mips: face ${face} level ${level}`,
            layout: built.groups[0],
            entries: [
              { binding: 0, resource: view(level - 1, face) },
              { binding: 1, resource: this.sampler },
            ],
          }),
        );
      }
    }
    chain = { passes, groups };
    this.chains.set(cube, chain);
    return chain;
  }
}
