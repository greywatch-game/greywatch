/**
 * render/WorldBlocks.ts — The static world's BLOCKS as our renderer draws
 * them in the frame's main pass: cut into clusters, culled on the GPU, and
 * drawn with ONE indirect draw per material (`BABYLON_EXIT.md` X3.3b; X3.3a
 * drew one per surface).
 * Owns: `WorldBlocks` — the surfaces handed to it until the map is cut
 * (`finish`), then each material GROUP's vertex buffers (every surface of the
 * group, end to end), its pipeline, its material block and bind group; the
 * identity `world` every group binds (group 2); each variant's two modules
 * (assembled once); the `ClusterCull` that writes the indices and the
 * indirect arguments every group draws; which surfaces FAILED; and the
 * `FrameDraw` that draws the groups at the end of group 0's opaque meshes
 * (`DrawPoint` `"opaque"`).
 * Invariants: a GROUP is one cel recipe — one pipeline, one material, one
 * draw — and a surface belongs to exactly one; its vertex arrays are uploaded
 * once as Babylon uploads a mesh's (floats as `float32`, a `Float64Array`
 * rounded exactly as Babylon's `Float32Array` of the same numbers is), an
 * attribute a surface lacks but its variant reads being 0 for every one of
 * its vertices — what Babylon's empty vertex buffer reads — and its indices
 * once, rebased onto the group's buffers, as the source the cull copies the
 * survivors from; the map is CUT once (`finish`), in the order the surfaces
 * were added, and never re-cut; a group draws only once its pipeline and the
 * cull's are built and every group it binds is whole, so a frame with a
 * pipeline compiling or a texture unpublished draws that group not at all
 * rather than wrongly; a material's block is re-copied from its recipe only
 * when asked (`writeMaterials`); nothing here allocates on a frame but the
 * cull's submit.
 * Never: imports Babylon; reads a node, or decides the reach or the size gate
 * (`ReachGate` is handed in); reads a Babylon material — a material is its
 * `CelRecipe`.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 *
 * WHAT A DRAW BINDS, by group: 0 the frame (`Renderer`'s), 1 the recipe's
 * material, 2 the identity `world` (`celMaterial.ts`'s header). Vertex
 * buffers in the vertex program's attribute order, one buffer an attribute;
 * the index buffer is the cull's, `uint32`, and the draw is
 * `drawIndexedIndirect` at the group's own arguments.
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
import { type BlockBox, ClusterCull, type CullTables, type ReachGate } from "./ClusterCull";
import { type Cluster, cutClusters, type PieceSpan } from "./clusters";
import type { FrameUniforms } from "./frame";
import { HostBindGroup } from "./HostBindGroup";
import type { BuiltPipeline, PipelineSpec } from "./PipelineCache";
import type { FrameContext, Renderer } from "./Renderer";
import { FRAME_TARGETS } from "./targets";
import { UniformBlockBuffer } from "./UniformBlockBuffer";
import type { AssembledAttribute, AssembledModule, AssembledVertex } from "./wgsl/assemble";
import { CLUSTER_WORDS, INDIRECT_BYTES } from "./wgsl/clusterCull";

/** How the blocks are cut — `CONFIG.graphics.clusters`. */
export interface ClusterOptions {
  readonly triangles: number;
  readonly nearBands: readonly [number, number, number];
}

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

/** A surface as handed over, held until the map is cut. */
interface Surface {
  readonly geometry: GeometryBuffer;
  readonly pieces: readonly PieceSpan[];
}

/** One material's draw: its surfaces' buffers end to end, and its pipeline once built. */
interface Group {
  readonly material: MaterialSlot;
  readonly program: Program;
  /** Indices into `surfaces`, in the order added. */
  readonly members: number[];
  /** In the vertex program's attribute order; empty until `finish`. */
  vertex: GPUBuffer[];
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
  /** Until `finish`; emptied there, so the build's arrays can go. */
  private surfaces: Surface[] = [];
  private surfaceCount = 0;
  /** One per recipe, in the order first added — the order they draw in. */
  private readonly groups: Group[] = [];
  private readonly groupOf = new Map<CelRecipe, Group>();
  private readonly mesh: UniformBlockBuffer;
  private readonly meshGroup: HostBindGroup;
  private readonly pending: Promise<void>[] = [];
  /** Surfaces drawn by neither side unless handed back — see `compiled`. */
  private readonly failed: number[] = [];
  /**
   * Each variant's two modules, assembled once rather than per surface: a
   * map is thousands of surfaces over a handful of variants.
   */
  private readonly programs = new Map<string, Program>();
  private cull: ClusterCull | null = null;
  /** Whether the cull is built: until then nothing draws. */
  private culling = false;
  private clusterCount = 0;
  /**
   * Bumped by `clear`: a compile that settles for a map already gone writes
   * nothing — not the draw state, not the next map's failures.
   */
  private generation = 0;
  private readonly removeDraw: () => void;
  private readonly removeFrame: () => void;

  /** Draws issued last frame — what a census of the main pass adds to Babylon's. */
  drawn = 0;

  constructor(
    private readonly renderer: Renderer,
    private readonly gate: ReachGate,
    private readonly options: ClusterOptions,
  ) {
    const device = renderer.device;
    this.mesh = new UniformBlockBuffer(device, CEL_MESH_BLOCK, [], "world blocks: world");
    this.mesh.write({ world: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) });
    this.meshGroup = new HostBindGroup(device, "world blocks: world", [CEL_MESH_BLOCK], [], {
      [CEL_MESH_BLOCK.var]: this.mesh.buffer,
    });
    // No textures: resolved once, whole for good.
    this.meshGroup.refresh(renderer.host, {});
    this.removeDraw = renderer.add(this.draw, "opaque");
    this.removeFrame = renderer.onFrame(this.prepare);
  }

  /** How many surfaces are handed over, and how many clusters they were cut into. */
  get count(): { surfaces: number; clusters: number; groups: number } {
    return { surfaces: this.surfaceCount, clusters: this.clusterCount, groups: this.groups.length };
  }

  /**
   * Hands over one block surface, drawn with `recipe`; its index is the
   * surface's, for `compiled`. Its arrays are READ at `finish`, so they must
   * stand until then.
   */
  add(label: string, geometry: GeometryBuffer, recipe: CelRecipe, pieces: readonly PieceSpan[]): number {
    if (this.cull) throw new Error("world blocks: a surface added after the map was cut");
    let group = this.groupOf.get(recipe);
    if (!group) {
      group = {
        material: this.materialOf(recipe),
        program: this.programOf(recipe.defines),
        members: [],
        vertex: [],
        built: null,
      };
      this.groupOf.set(recipe, group);
      this.groups.push(group);
    }
    for (const a of group.program.vertex.attributes) {
      if (!geometry[SOURCE[a.name]] && a.name !== "uv") {
        throw new Error(`world blocks: "${label}" has no ${a.name}, which its variant reads`);
      }
    }
    const at = this.surfaces.length;
    this.surfaces.push({ geometry, pieces });
    group.members.push(at);
    this.surfaceCount = this.surfaces.length;
    return at;
  }

  /**
   * Cuts the map: every group's buffers uploaded and its pipeline asked for,
   * every surface cut into clusters, and the cull built over them.
   * `blocks[s]` is surface `s`'s block — its box, as the frame's mesh walk
   * files it; surfaces of one block share the object.
   */
  finish(blocks: readonly BlockBox[]): void {
    const surfaces = this.surfaces;
    if (blocks.length !== surfaces.length) throw new Error("world blocks: a block for every surface");
    // Nothing taken (an editor build, a map of loose surfaces): no cull.
    if (surfaces.length === 0) return;
    const device = this.renderer.device;
    const blockIds = new Map<BlockBox, number>();
    const blockList: BlockBox[] = [];
    let indexTotal = 0;
    for (const s of surfaces) indexTotal += s.geometry.indices.length;
    // The largest buffer the cut makes: the indices (a storage binding), or
    // a group's widest attribute (four floats a vertex).
    let widest = 0;
    for (const group of this.groups) {
      let vertices = 0;
      for (const s of group.members) vertices += surfaces[s].geometry.positions.length / 3;
      widest = Math.max(widest, vertices * 16);
    }
    const limits = device.limits;
    if (indexTotal * 4 > Math.min(limits.maxStorageBufferBindingSize, limits.maxBufferSize) || widest > limits.maxBufferSize) {
      console.error("world blocks: the cut is past the device's buffer limits; the blocks go back to Babylon");
      this.giveUpAll();
      this.surfaces = [];
      return;
    }
    const indices = new Uint32Array(indexTotal);
    const spheres = new Float32Array(surfaces.length * 4);
    const cut: { surface: number; group: number; base: number; c: readonly Cluster[] }[] = [];
    const ranges: CullTables["groups"][number][] = [];
    let indexAt = 0;
    let clusterCount = 0;
    this.groups.forEach((group, g) => {
      const start = clusterCount;
      const base = indexAt;
      let vertexTotal = 0;
      for (const s of group.members) vertexTotal += surfaces[s].geometry.positions.length / 3;
      const attributes = group.program.vertex.attributes;
      group.vertex = attributes.map((a) => this.vertexBuffer(group, a, vertexTotal));
      const layouts = attributes.map((a) => layoutOf(a));
      let vertexBase = 0;
      for (const s of group.members) {
        const surface = surfaces[s];
        const geo = surface.geometry;
        const positions = toFloat32(geo.positions);
        const local = geo.indices;
        for (let i = 0; i < local.length; i++) indices[indexAt + i] = local[i] + vertexBase;
        const clusters = cutClusters(positions, local, geo.colors, surface.pieces, this.options.triangles);
        cut.push({ surface: s, group: g, base: indexAt, c: clusters });
        clusterCount += clusters.length;
        writeSphere(positions, spheres, s * 4);
        vertexBase += positions.length / 3;
        indexAt += local.length;
      }
      ranges.push({ start, end: clusterCount, base });
      for (const b of group.vertex) b.unmap();
      this.ask(group, layouts);
    });

    const words = new ArrayBuffer(Math.max(1, clusterCount) * CLUSTER_WORDS * 4);
    const f = new Float32Array(words);
    const u = new Uint32Array(words);
    let k = 0;
    for (const { surface, group, base, c } of cut) {
      const box = blocks[surface];
      let block = blockIds.get(box);
      if (block === undefined) {
        block = blockList.length;
        blockIds.set(box, block);
        blockList.push(box);
      }
      for (const cl of c) {
        const o = k * CLUSTER_WORDS;
        f[o] = cl.lo[0];
        f[o + 1] = cl.lo[1];
        f[o + 2] = cl.lo[2];
        u[o + 3] = base + cl.indexStart;
        f[o + 4] = cl.hi[0];
        f[o + 5] = cl.hi[1];
        f[o + 6] = cl.hi[2];
        u[o + 7] = cl.indexCount;
        u[o + 8] = group;
        u[o + 9] = block;
        u[o + 10] = surface;
        u[o + 11] = cl.piece;
        f[o + 12] = cl.ramp;
        u[o + 13] = cl.rigged ? 1 : 0;
        k++;
      }
    }
    this.clusterCount = clusterCount;
    const bands = this.options.nearBands;
    this.cull = new ClusterCull(
      device,
      {
        clusters: words,
        clusterCount,
        blocks: blockList,
        spheres,
        groups: ranges,
        indices,
        bands2: [bands[0] * bands[0], bands[1] * bands[1], bands[2] * bands[2]],
      },
      this.gate,
    );
    const generation = this.generation;
    this.pending.push(
      this.cull.ready.then((ok) => {
        if (generation !== this.generation) return;
        this.culling = ok;
        if (!ok) this.giveUpAll();
      }),
    );
    // The build's arrays are ours no longer.
    this.surfaces = [];
  }

  /**
   * Resolves once every pipeline asked for is built or has failed, with the
   * surfaces whose pipeline FAILED — which this never draws, so whoever took
   * them owes them back to whoever drew them before.
   */
  compiled(): Promise<readonly number[]> {
    return Promise.all(this.pending).then(() => [...new Set(this.failed)]);
  }

  /** Re-copies every material's block from its recipe — after its owner rewrote one. */
  writeMaterials(): void {
    for (const g of this.groups) g.material.block.write(g.material.recipe.values);
  }

  /** Drops every surface, group and material: the map they were is gone. */
  clear(): void {
    this.generation++;
    for (const g of this.groups) {
      for (const b of g.vertex) b.destroy();
      g.material.block.destroy();
    }
    this.cull?.dispose();
    this.cull = null;
    this.culling = false;
    this.surfaces = [];
    this.surfaceCount = 0;
    this.clusterCount = 0;
    this.groups.length = 0;
    this.groupOf.clear();
    this.pending.length = 0;
    this.failed.length = 0;
    this.drawn = 0;
  }

  dispose(): void {
    this.clear();
    this.removeDraw();
    this.removeFrame();
    this.mesh.destroy();
  }

  /** Every surface failed: the cull, or the whole cut, could not be built. */
  private giveUpAll(): void {
    this.culling = false;
    for (let s = 0; s < this.surfaceCount; s++) this.failed.push(s);
  }

  /** One attribute's buffer for the whole group, MAPPED, filled surface by surface. */
  private vertexBuffer(group: Group, a: AssembledAttribute, vertexTotal: number): GPUBuffer {
    const floats = FORMATS[a.type].floats;
    const buffer = this.renderer.device.createBuffer({
      label: `world blocks: [${group.material.recipe.defines.join("+")}] ${a.name}`,
      size: Math.max(4, vertexTotal * floats * 4),
      usage: GPUBufferUsage.VERTEX,
      mappedAtCreation: true,
    });
    const dst = new Float32Array(buffer.getMappedRange());
    const surfaces = this.surfaces;
    let at = 0;
    for (const s of group.members) {
      const geo = surfaces[s].geometry;
      const array = geo[SOURCE[a.name]];
      // A mapped buffer starts zeroed: an absent `uv` is left reading 0.
      if (array) dst.set(array, at);
      at += (geo.positions.length / 3) * floats;
    }
    return buffer;
  }

  /** Asks for a group's pipeline; a failure hands every member back. */
  private ask(group: Group, buffers: GPUVertexBufferLayout[]): void {
    const recipe = group.material.recipe;
    const generation = this.generation;
    const spec: PipelineSpec = {
      vertex: group.program.vertex,
      vertexEntry: "main",
      fragment: group.program.fragment,
      fragmentEntry: "main",
      buffers,
      targets: FRAME_TARGETS,
      state: recipe.depthBias === 0 ? undefined : { depthBias: recipe.depthBias },
    };
    this.pending.push(
      this.renderer.pipelines.get(spec).then(
        (built) => {
          group.built = built;
        },
        (err: unknown) => {
          if (generation !== this.generation) return;
          this.failed.push(...group.members);
          console.error(
            `world blocks: [${recipe.defines.join("+")}] has no pipeline; its ${group.members.length} surfaces go back to Babylon`,
            err,
          );
        },
      ),
    );
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
    return { recipe, block, group };
  }

  /** As the main pass begins: this frame's cull, ahead of the draws. */
  private readonly prepare = (frame: FrameUniforms): void => {
    const cull = this.cull;
    if (this.culling && cull) cull.dispatch(frame);
  };

  private readonly draw = (pass: GPURenderPassEncoder, ctx: FrameContext): void => {
    let drawn = 0;
    const cull = this.cull;
    if (this.culling && cull) {
      const host = this.renderer.host;
      pass.setIndexBuffer(cull.indices, "uint32");
      const groups = this.groups;
      for (let g = 0; g < groups.length; g++) {
        const group = groups[g];
        const built = group.built;
        if (!built) continue;
        const material = group.material;
        material.group.refresh(host, material.recipe.textures);
        const frame = ctx.frameGroup(built.groups[0]);
        const own = material.group.get(built.groups[1]);
        const world = this.meshGroup.get(built.groups[2]);
        if (!frame || !own || !world) continue;
        pass.setPipeline(built.pipeline);
        pass.setBindGroup(0, frame);
        pass.setBindGroup(1, own);
        pass.setBindGroup(2, world);
        const vertex = group.vertex;
        for (let k = 0; k < vertex.length; k++) pass.setVertexBuffer(k, vertex[k]);
        pass.drawIndexedIndirect(cull.args, g * INDIRECT_BYTES);
        drawn++;
      }
    }
    this.drawn = drawn;
  };
}

/** One attribute in its own buffer, tightly packed. */
function layoutOf(a: AssembledAttribute): GPUVertexBufferLayout {
  return {
    arrayStride: FORMATS[a.type].floats * 4,
    attributes: [{ shaderLocation: a.location, offset: 0, format: FORMATS[a.type].format }],
  };
}

/** A float array as the device holds it — rounded exactly as `new Float32Array(numbers)`. */
function toFloat32(a: Float32Array | Float64Array): Float32Array {
  return a instanceof Float32Array ? a : Float32Array.from(a);
}

/**
 * A surface's bounding sphere as Babylon's `BoundingInfo` makes one from the
 * same float32 positions — the centre of the box, half its diagonal — into
 * `out[at..at + 4)`. The size gate measures a SURFACE, as it measures the
 * mesh, never a cluster: a cluster of a surface that draws is never dropped
 * for being small.
 */
function writeSphere(positions: Float32Array, out: Float32Array, at: number): void {
  let lx = Infinity, ly = Infinity, lz = Infinity;
  let hx = -Infinity, hy = -Infinity, hz = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    if (x < lx) lx = x;
    if (y < ly) ly = y;
    if (z < lz) lz = z;
    if (x > hx) hx = x;
    if (y > hy) hy = y;
    if (z > hz) hz = z;
  }
  out[at] = (lx + hx) / 2;
  out[at + 1] = (ly + hy) / 2;
  out[at + 2] = (lz + hz) / 2;
  out[at + 3] = Math.hypot(hx - lx, hy - ly, hz - lz) / 2;
}
