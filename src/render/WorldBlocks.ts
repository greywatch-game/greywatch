/**
 * render/WorldBlocks.ts — The static world's BLOCKS as our renderer draws
 * them in the frame's main pass: their geometry on buffers of our own, one
 * material group per cel recipe, one pipeline per variant, one draw per block
 * surface (`BABYLON_EXIT.md` X3.3a).
 * Owns: `WorldBlocks` — every block surface's vertex and index buffers, the
 * zero buffer an absent `uv` reads, each recipe's material block and bind
 * group, the identity `world` every block binds (group 2), each variant's
 * two modules (assembled once), each draw's pipeline and which ones FAILED
 * to build, which draws are ON this frame, and the `FrameDraw` that draws
 * them at the end of group 0's opaque meshes (`DrawPoint` `"opaque"`).
 * Invariants: a surface's arrays are uploaded once, as Babylon uploads a
 * mesh's — floats as `float32` (a `Float64Array` rounded exactly as Babylon's
 * `Float32Array` of the same numbers is), indices as `uint16` unless one is
 * past 65535 — and never read back; a draw draws only when it is ON this
 * frame (`setOn`, which whoever decides visibility writes, after the frame's
 * cull) and only once its pipeline is built and every group it binds is
 * whole, so a frame with a pipeline compiling or a texture unpublished draws
 * that surface not at all rather than wrongly; a material's block is
 * re-copied from its recipe only when asked (`writeMaterials`); nothing here
 * allocates on a frame.
 * Never: imports Babylon; decides visibility; reads a Babylon material — a
 * material is its `CelRecipe`.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 *
 * WHAT A DRAW BINDS, by group: 0 the frame (`Renderer`'s), 1 the recipe's
 * material, 2 the identity `world` (`celMaterial.ts`'s header). Vertex
 * buffers in the vertex program's attribute order, one buffer an attribute;
 * a block surface with no `uv` binds the zero buffer at stride 0, which reads
 * what Babylon's empty vertex buffer reads — 0 — for every vertex.
 */
import type { GeometryBuffer } from "../geometry/buffer";
import {
  CEL_MATERIAL_BLOCK,
  CEL_MATERIAL_TEXTURES,
  CEL_MESH_BLOCK,
  type CelRecipe,
} from "./celMaterial";
import { celFragment } from "./celFragment";
import { celVertex } from "./celVertex";
import { HostBindGroup } from "./HostBindGroup";
import type { BuiltPipeline, PipelineSpec } from "./PipelineCache";
import type { FrameContext, Renderer } from "./Renderer";
import { FRAME_TARGETS } from "./targets";
import { UniformBlockBuffer } from "./UniformBlockBuffer";
import type { AssembledAttribute, AssembledModule, AssembledVertex } from "./wgsl/assemble";

/** A recipe's GPU half: its block's buffer and its group. */
interface MaterialSlot {
  readonly recipe: CelRecipe;
  readonly block: UniformBlockBuffer;
  readonly group: HostBindGroup;
}

/** One variant's two modules. */
interface Program {
  readonly vertex: AssembledVertex;
  readonly fragment: AssembledModule;
}

/** One block surface: its buffers, its material and its pipeline once built. */
interface BlockDraw {
  readonly label: string;
  readonly material: MaterialSlot;
  /** In the vertex program's attribute order. */
  readonly vertex: readonly GPUBuffer[];
  readonly index: GPUBuffer;
  readonly indexFormat: GPUIndexFormat;
  readonly indexCount: number;
  built: BuiltPipeline | null;
}

/** The floats per vertex of each attribute type, and its vertex format. */
const FORMATS: Readonly<Record<string, { readonly floats: number; readonly format: GPUVertexFormat }>> = {
  vec2f: { floats: 2, format: "float32x2" },
  vec3f: { floats: 3, format: "float32x3" },
  vec4f: { floats: 4, format: "float32x4" },
};

/** Which of a surface's arrays an attribute is read from. */
const SOURCE: Readonly<Record<string, keyof GeometryArraysOf>> = {
  position: "positions",
  normal: "normals",
  color: "colors",
  uv: "uvs",
  uv2: "uvs2",
};
type GeometryArraysOf = Pick<GeometryBuffer, "positions" | "normals" | "colors" | "uvs" | "uvs2">;

export class WorldBlocks {
  /** Surfaces in the order added; an index is a surface's draw. */
  private readonly draws: BlockDraw[] = [];
  /** 1 where the draw is ON this frame — see `setOn`. */
  private on = new Uint8Array(64);
  private readonly materials = new Map<CelRecipe, MaterialSlot>();
  /** `materials`' values, so a frame's walk allocates no iterator. */
  private readonly slots: MaterialSlot[] = [];
  private readonly mesh: UniformBlockBuffer;
  private readonly meshGroup: HostBindGroup;
  /** What an absent `uv` reads: zeros, at stride 0. */
  private readonly zero: GPUBuffer;
  private readonly pending: Promise<void>[] = [];
  /** Draws whose pipeline failed to build: never drawn — see `compiled`. */
  private readonly failed: number[] = [];
  /**
   * Each variant's two modules, assembled once rather than per surface: a
   * map is thousands of surfaces over a handful of variants.
   */
  private readonly programs = new Map<string, Program>();
  private readonly remove: () => void;

  /** Draws drawn last frame — what a census of the main pass adds to Babylon's. */
  drawn = 0;

  constructor(private readonly renderer: Renderer) {
    const device = renderer.device;
    this.mesh = new UniformBlockBuffer(device, CEL_MESH_BLOCK, [], "world blocks: world");
    this.mesh.write({ world: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) });
    this.meshGroup = new HostBindGroup(device, "world blocks: world", [CEL_MESH_BLOCK], [], {
      [CEL_MESH_BLOCK.var]: this.mesh.buffer,
    });
    // No textures: resolved once, whole for good.
    this.meshGroup.refresh(renderer.host, {});
    this.zero = device.createBuffer({
      label: "world blocks: zero",
      size: 16,
      usage: GPUBufferUsage.VERTEX,
    });
    this.remove = renderer.add(this.draw, "opaque");
  }

  /** How many surfaces are uploaded. */
  get count(): number {
    return this.draws.length;
  }

  /**
   * Uploads one block surface, drawn with `recipe`; its index is the draw's,
   * for `setOn`. Asks for its pipeline at once, so `compiled` covers it.
   */
  add(label: string, geometry: GeometryBuffer, recipe: CelRecipe): number {
    const device = this.renderer.device;
    const material = this.materialOf(recipe);
    const program = this.programOf(recipe.defines);
    const vertex: GPUBuffer[] = [];
    const layouts: GPUVertexBufferLayout[] = [];
    for (const a of program.vertex.attributes) {
      const array = geometry[SOURCE[a.name]];
      if (array) {
        vertex.push(upload(device, `${label} ${a.name}`, GPUBufferUsage.VERTEX, toFloat32(array)));
        layouts.push(layoutOf(a, FORMATS[a.type].floats * 4));
      } else if (a.name === "uv") {
        vertex.push(this.zero);
        layouts.push(layoutOf(a, 0));
      } else {
        throw new Error(`world blocks: "${label}" has no ${a.name}, which its variant reads`);
      }
    }
    const wide = geometry.indices.some((i) => i > 65535);
    const indices = wide ? geometry.indices : Uint16Array.from(geometry.indices);
    const draw: BlockDraw = {
      label,
      material,
      vertex,
      index: upload(device, `${label} indices`, GPUBufferUsage.INDEX, indices),
      indexFormat: wide ? "uint32" : "uint16",
      indexCount: geometry.indices.length,
      built: null,
    };
    const at = this.draws.length;
    this.draws.push(draw);
    if (at >= this.on.length) {
      const grown = new Uint8Array(this.on.length * 2);
      grown.set(this.on);
      this.on = grown;
    }
    const spec: PipelineSpec = {
      vertex: program.vertex,
      vertexEntry: "main",
      fragment: program.fragment,
      fragmentEntry: "main",
      buffers: layouts,
      targets: FRAME_TARGETS,
      state: recipe.depthBias === 0 ? undefined : { depthBias: recipe.depthBias },
    };
    this.pending.push(
      this.renderer.pipelines.get(spec).then(
        (built) => {
          draw.built = built;
        },
        (err: unknown) => {
          this.failed.push(at);
          console.error(`world blocks: "${label}" has no pipeline; it goes back to Babylon`, err);
        },
      ),
    );
    return at;
  }

  /**
   * Resolves once every pipeline asked for so far is built or has failed,
   * with the draws whose pipeline FAILED — which this never draws, so
   * whoever took them owes them back to whoever drew them before.
   */
  compiled(): Promise<readonly number[]> {
    return Promise.all(this.pending).then(() => [...this.failed]);
  }

  /** Every draw OFF — the start of each frame's visibility. */
  clearOn(): void {
    this.on.fill(0);
    this.drawn = 0;
  }

  /** Draw `index` this frame. */
  setOn(index: number): void {
    this.on[index] = 1;
  }

  /** Re-copies every material's block from its recipe — after its owner rewrote one. */
  writeMaterials(): void {
    for (const slot of this.slots) slot.block.write(slot.recipe.values);
  }

  /** Drops every surface and material: the map they were is gone. */
  clear(): void {
    for (const d of this.draws) {
      for (const b of d.vertex) if (b !== this.zero) b.destroy();
      d.index.destroy();
    }
    for (const m of this.slots) m.block.destroy();
    this.draws.length = 0;
    this.materials.clear();
    this.slots.length = 0;
    this.pending.length = 0;
    this.failed.length = 0;
    this.on.fill(0);
    this.drawn = 0;
  }

  dispose(): void {
    this.clear();
    this.remove();
    this.mesh.destroy();
    this.zero.destroy();
  }

  /** The two modules of the variant `defines`, assembled once. */
  private programOf(defines: readonly string[]): Program {
    const key = defines.join("+");
    let program = this.programs.get(key);
    if (!program) {
      program = {
        vertex: celVertex(defines, FRAME_TARGETS),
        fragment: celFragment(defines, FRAME_TARGETS),
      };
      this.programs.set(key, program);
    }
    return program;
  }

  private materialOf(recipe: CelRecipe): MaterialSlot {
    let slot = this.materials.get(recipe);
    if (slot) return slot;
    const device = this.renderer.device;
    const label = `world blocks: material [${recipe.defines.join("+")}]`;
    const block = new UniformBlockBuffer(device, CEL_MATERIAL_BLOCK, recipe.defines, label);
    block.write(recipe.values);
    const group = new HostBindGroup(
      device,
      label,
      [CEL_MATERIAL_BLOCK, ...CEL_MATERIAL_TEXTURES],
      recipe.defines,
      { [CEL_MATERIAL_BLOCK.var]: block.buffer },
    );
    slot = { recipe, block, group };
    this.materials.set(recipe, slot);
    this.slots.push(slot);
    return slot;
  }

  private readonly draw = (pass: GPURenderPassEncoder, ctx: FrameContext): void => {
    const host = this.renderer.host;
    const slots = this.slots;
    for (let i = 0; i < slots.length; i++) slots[i].group.refresh(host, slots[i].recipe.textures);
    let drawn = 0;
    let pipeline: GPURenderPipeline | null = null;
    let material: MaterialSlot | null = null;
    const draws = this.draws;
    const on = this.on;
    for (let i = 0; i < draws.length; i++) {
      if (on[i] === 0) continue;
      const d = draws[i];
      const built = d.built;
      if (!built) continue;
      const frame = ctx.frameGroup(built.groups[0]);
      const own = d.material.group.get(built.groups[1]);
      const world = this.meshGroup.get(built.groups[2]);
      if (!frame || !own || !world) continue;
      if (built.pipeline !== pipeline) {
        pipeline = built.pipeline;
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, frame);
        pass.setBindGroup(2, world);
        material = null;
      }
      if (d.material !== material) {
        material = d.material;
        pass.setBindGroup(1, own);
      }
      for (let k = 0; k < d.vertex.length; k++) pass.setVertexBuffer(k, d.vertex[k]);
      pass.setIndexBuffer(d.index, d.indexFormat);
      pass.drawIndexed(d.indexCount);
      drawn++;
    }
    this.drawn = drawn;
  };
}

/** One attribute in its own buffer. */
function layoutOf(a: AssembledAttribute, stride: number): GPUVertexBufferLayout {
  return {
    arrayStride: stride,
    attributes: [{ shaderLocation: a.location, offset: 0, format: FORMATS[a.type].format }],
  };
}

/** A float array as the device holds it — rounded exactly as `new Float32Array(numbers)`. */
function toFloat32(a: Float32Array | Float64Array): Float32Array {
  return a instanceof Float32Array ? a : Float32Array.from(a);
}

/** A buffer holding `data`, its size padded to the 4 bytes a copy needs. */
function upload(
  device: GPUDevice,
  label: string,
  usage: number,
  data: Float32Array | Uint32Array | Uint16Array,
): GPUBuffer {
  const size = Math.max(4, Math.ceil(data.byteLength / 4) * 4);
  const buffer = device.createBuffer({ label, size, usage, mappedAtCreation: true });
  const Kind = data.constructor as { new (b: ArrayBuffer): typeof data };
  new Kind(buffer.getMappedRange()).set(data);
  buffer.unmap();
  return buffer;
}
