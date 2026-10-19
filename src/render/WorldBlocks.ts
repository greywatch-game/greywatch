/**
 * render/WorldBlocks.ts — The static world's BLOCKS as our renderer draws
 * them in the frame's main pass: cut into clusters, culled on the GPU, and
 * drawn with ONE plain draw per material over its whole range, the survivors
 * at the front and triangles of no area after them (`BABYLON_EXIT.md`
 * X3.3b; X3.3a drew one per surface) — and the SCATTER beside them, drawn as
 * instances of its variants, one indirect draw per variant per material
 * (X3.4b).
 * Owns: `WorldBlocks` — the surfaces and the scatter's instanced parts handed
 * to it until the map is cut (`finish`), then each material GROUP's vertex
 * buffers (every surface of the group end to end, then every instanced part
 * of it), its two pipelines (the blocks', and the instanced stage's), its
 * material block and bind group, and its instanced parts' index buffer; the
 * identity `world` the blocks bind (group 2); each variant's three modules
 * (assembled once); the `ClusterCull` that writes the blocks' indices and
 * indirect arguments and the `InstanceCull` that writes the scatter's
 * transforms and indirect arguments; and the `FrameDraw` that draws both at
 * the end of group 0's opaque meshes (`DrawPoint` `"opaque"`) with the
 * `FramePrepare` that culls ahead of it, both on the renderer only while a
 * map's culls are built and nobody has `stop`ped it.
 * The BLOCKS are never drawn indirect: an Intel Xe-LPG dropped single
 * indirect draws at random, at arguments however written, and drew the same
 * triangles plain every frame (`docs/rendering.md`). The scatter's indirect
 * draws were never seen to drop.
 * Invariants: a GROUP is one cel recipe — one material, one cluster draw and
 * one draw per instanced part — and a surface or an instanced part belongs to
 * exactly one; its vertex arrays are uploaded once as Babylon uploads a mesh's
 * (floats as `float32`, a `Float64Array` rounded exactly as Babylon's
 * `Float32Array` of the same numbers is), an attribute a surface lacks but its
 * variant reads being 0 for every one of its vertices — what Babylon's empty
 * vertex buffer reads — and its indices once, rebased onto the group's
 * buffers, as the source the cull copies the survivors from; the map is CUT
 * once (`finish`), in the order the surfaces were added, and never re-cut; in
 * a group that has instanced parts, the pieces `finish` is told to CUT (the
 * scatter's regions) are taken out of every surface before it is uploaded,
 * because those triangles are drawn as instances instead — and a group with
 * no surface of its own draws none of its instanced parts, since Babylon
 * draws that recipe whole; a group draws only once its pipelines and the
 * culls are built and every group it binds is whole, so a frame with a
 * pipeline compiling or a texture unpublished draws that group not at all
 * rather than wrongly; a group one of whose pipelines FAILS draws nothing at
 * all and hands every surface of it back, since half of a recipe would be a
 * hole where Babylon draws the other half; a surface it will never draw — its
 * group failed, or a cull did, or the cut is past the device's limits — is
 * handed to `onFailed` in the turn that failure lands, never held for the
 * map's other compiles, so whoever took it can give it back at once; a
 * material's block is re-copied from its recipe only when asked
 * (`writeMaterials`); nothing here allocates on a frame but the culls'
 * compute passes.
 * Never: imports Babylon; reads a node, or decides the reach or the size gate
 * (`ReachGate` is handed in); reads a Babylon material — a material is its
 * `CelRecipe`.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 *
 * WHAT A DRAW BINDS, by group: 0 the frame (`Renderer`'s), 1 the recipe's
 * material, 2 the identity `world` (`celMaterial.ts`'s header) — the blocks'
 * draw only; an instanced draw reads its `world` per instance. Vertex buffers
 * in the vertex program's attribute order, one buffer an attribute
 * (`celVertex.ts`'s `bufferLayouts`); a block draw's index buffer is the
 * cluster cull's, `uint32`, and the draw is `drawIndexed` over the group's
 * whole range of it — none for a group whose cut kept no index; an
 * instanced draw's is the group's own instanced
 * index buffer, its instances the instance cull's `placed` bound at the SET's
 * region, and the draw `drawIndexedIndirect` at the part's own arguments.
 */
import { CEL_MATERIAL_BLOCK, CEL_MATERIAL_TEXTURES, CEL_MESH_BLOCK, type CelRecipe } from "./celMaterial";
import { celFragment } from "./celFragment";
import { ATTRIBUTE_FORMATS, bufferLayouts, celInstancedVertex, celVertex } from "./celVertex";
import {
  type BlockBox,
  ClusterCull,
  type CullDiagnostics,
  type CullTables,
  NO_DIAGNOSTICS,
  type ReachGate,
} from "./ClusterCull";
import { type Cluster, cutClusters, type PieceSpan, type SurfaceArrays, withoutPieces } from "./clusters";
import type { FrameUniforms } from "./frame";
import { HostBindGroup } from "./HostBindGroup";
import { InstanceCull, type InstanceTables } from "./InstanceCull";
import type { BuiltPipeline, PipelineSpec } from "./PipelineCache";
import type { FrameContext, Renderer } from "./Renderer";
import { FRAME_TARGETS } from "./targets";
import { UniformBlockBuffer } from "./UniformBlockBuffer";
import type { AssembledModule, AssembledVertex } from "./wgsl/assemble";
import { CLUSTER_WORDS, INDIRECT_BYTES } from "./wgsl/clusterCull";
import { INSTANCE_WORDS, TRANSFORM_WORDS } from "./wgsl/instanceCull";

/** How the blocks are cut — `CONFIG.graphics.clusters`. */
export interface ClusterOptions {
  readonly triangles: number;
  readonly nearBands: readonly [number, number, number];
}

/** One SET of instances: a variant's placements, as `finish` is handed them. */
export interface InstanceSet {
  /** Each instance's world matrix, 16 floats laid out as WGSL's `mat4x4f` reads them. */
  readonly matrices: Float32Array;
  /** Each instance's uniform scale. */
  readonly scales: Float32Array;
}

/** What `finish` is told about the scatter: which pieces to cut, and the sets. */
export interface ScatterCut {
  /** A piece the instances draw instead (a scatter region). */
  readonly cut: (piece: number) => boolean;
  /** Indexed by the `set` each instanced part was added with. */
  readonly sets: readonly InstanceSet[];
}

/** A recipe's GPU half: its block's buffer and its group. */
interface MaterialSlot {
  readonly recipe: CelRecipe;
  readonly block: UniformBlockBuffer;
  readonly group: HostBindGroup;
}

/** One variant's three modules. */
interface Program {
  readonly vertex: AssembledVertex;
  readonly instanced: AssembledVertex;
  readonly fragment: AssembledModule;
}

/** A surface as handed over, held until the map is cut. */
interface Surface {
  geometry: SurfaceArrays;
  pieces: readonly PieceSpan[];
}

/** An instanced part as handed over: drawn once per surviving instance of its set. */
interface InstancedPart {
  readonly geometry: SurfaceArrays;
  readonly set: number;
}

/** One instanced draw: a part of a set, at its own arguments. */
interface InstancedDraw {
  /** Where its set's region starts in `placed`, in bytes. */
  readonly offset: number;
}

/** One material's draws: its surfaces' buffers end to end, its parts after them. */
interface Group {
  readonly material: MaterialSlot;
  readonly program: Program;
  /** Indices into `surfaces`, in the order added. */
  readonly members: number[];
  /** Its instanced parts, in the order added; emptied at `finish` if it has no members. */
  instanced: InstancedPart[];
  /** In the vertex program's attribute order; empty until `finish`. */
  vertex: GPUBuffer[];
  /** The instanced parts' indices, each part's own; null without parts. */
  instancedIndex: GPUBuffer | null;
  /** Its blocks' range of the cut's indices, `[indexBase, indexBase + indexCount)` — what its draw covers. */
  indexBase: number;
  indexCount: number;
  /** Its draws in the instance cull's table: `[drawStart, drawEnd)`. */
  drawStart: number;
  drawEnd: number;
  built: BuiltPipeline | null;
  instancedBuilt: BuiltPipeline | null;
  /** A pipeline of this group failed: it draws nothing, its members went back. */
  failed: boolean;
}

/** Which of a surface's arrays an attribute is read from. */
const SOURCE: Readonly<Record<string, keyof SurfaceArrays>> = {
  position: "positions",
  normal: "normals",
  color: "colors",
  uv: "uvs",
  uv2: "uvs2",
};

export class WorldBlocks {
  /** Until `finish`; emptied there, so the build's arrays can go. */
  private surfaces: Surface[] = [];
  private surfaceCount = 0;
  /** One per recipe, in the order first added — the order they draw in. */
  private readonly groups: Group[] = [];
  private readonly groupOf = new Map<CelRecipe, Group>();
  private readonly mesh: UniformBlockBuffer;
  private readonly meshGroup: HostBindGroup;
  /**
   * Each variant's modules, assembled once rather than per surface: a map is
   * thousands of surfaces over a handful of variants.
   */
  private readonly programs = new Map<string, Program>();
  private cull: ClusterCull | null = null;
  private instances: InstanceCull | null = null;
  /** Each instanced draw, in the instance cull's draw order. */
  private draws: InstancedDraw[] = [];
  /** Whether the culls are built: until then nothing draws. */
  private culling = false;
  private clusterCount = 0;
  private instanceCount = 0;
  private setCount = 0;
  /**
   * Bumped by `clear` and `stop`: a compile that settles for a map already
   * gone, or stopped, writes nothing — not the draw state, not a failure.
   */
  private generation = 0;
  /**
   * Takes the draw and the culls' prepare back off the renderer; null while
   * nothing is registered. Registered only while a map's culls are BUILT, so
   * a frame with nothing of ours to draw — the menu, an editor build — costs
   * the renderer one empty branch rather than a filled and uploaded frame.
   */
  private unhook: (() => void) | null = null;

  /** Draws issued last frame — what a census of the main pass adds to Babylon's. */
  drawn = 0;
  /**
   * The fewest and most BLOCK draws (one a group, the scatter's apart) a run
   * has issued since the reader last reset them — `?drawcheck`.
   */
  fewestBlockDraws = Number.POSITIVE_INFINITY;
  mostBlockDraws = 0;

  constructor(
    private readonly renderer: Renderer,
    private readonly gate: ReachGate,
    private readonly options: ClusterOptions,
    /**
     * Handed the surfaces (by `add`'s index) this will never draw, as each
     * failure lands — drawn by NEITHER side unless whoever took them hands
     * them back.
     */
    private readonly onFailed: (surfaces: readonly number[]) => void,
    /** The culls' diagnostics (`ClusterCull`'s `CullDiagnostics`); none but off the URL. */
    private readonly diagnostics: CullDiagnostics = NO_DIAGNOSTICS,
  ) {
    const device = renderer.device;
    this.mesh = new UniformBlockBuffer(device, CEL_MESH_BLOCK, [], "world blocks: world");
    this.mesh.write({ world: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) });
    this.meshGroup = new HostBindGroup(device, "world blocks: world", [CEL_MESH_BLOCK], [], {
      [CEL_MESH_BLOCK.var]: this.mesh.buffer,
    });
    // No textures: resolved once, whole for good.
    this.meshGroup.refresh(renderer.host, {});
  }

  /** What is handed over, and what it was cut into. */
  get count(): { surfaces: number; clusters: number; groups: number; instances: number; sets: number } {
    return {
      surfaces: this.surfaceCount,
      clusters: this.clusterCount,
      groups: this.groups.length,
      instances: this.instanceCount,
      sets: this.setCount,
    };
  }

  /**
   * Hands over one block surface, drawn with `recipe`; its index is the
   * surface's, for `onFailed`. Its arrays are READ at `finish`, so they must
   * stand until then.
   */
  add(label: string, geometry: SurfaceArrays, recipe: CelRecipe, pieces: readonly PieceSpan[]): number {
    const group = this.groupFor(label, geometry, recipe);
    const at = this.surfaces.length;
    this.surfaces.push({ geometry, pieces });
    group.members.push(at);
    this.surfaceCount = this.surfaces.length;
    return at;
  }

  /**
   * Hands over one part of instance set `set` (`ScatterCut.sets`), drawn with
   * `recipe` once per surviving instance. Its arrays are READ at `finish`.
   */
  addInstanced(set: number, label: string, geometry: SurfaceArrays, recipe: CelRecipe): void {
    this.groupFor(label, geometry, recipe).instanced.push({ geometry, set });
  }

  /**
   * Cuts the map: every group's buffers uploaded and its pipelines asked for,
   * every surface cut into clusters — the scatter's pieces cut out of it
   * first, where its group draws them as instances — and the culls built.
   * `blocks[s]` is surface `s`'s block — its box, as the frame's mesh walk
   * files it; surfaces of one block share the object.
   */
  finish(blocks: readonly BlockBox[], scatter: ScatterCut | null = null): void {
    const surfaces = this.surfaces;
    if (blocks.length !== surfaces.length) throw new Error("world blocks: a block for every surface");
    // Nothing taken (an editor build, a map of loose surfaces): no cull, and
    // no instance either — Babylon draws every recipe whole.
    if (surfaces.length === 0) return;
    const device = this.renderer.device;

    // A recipe Babylon draws whole draws its scatter whole with it: a group
    // with no surface of ours keeps none of its instanced parts.
    for (const group of this.groups) if (group.members.length === 0) group.instanced = [];
    // Each surface's sphere is of what Babylon would draw — the WHOLE surface,
    // scatter included — because the size gate and the band measure the mesh.
    const spheres = new Float32Array(surfaces.length * 4);
    surfaces.forEach((s, i) => writeSphere(toFloat32(s.geometry.positions), spheres, i * 4));
    if (scatter) this.cutScatter(scatter);

    const blockIds = new Map<BlockBox, number>();
    const blockList: BlockBox[] = [];
    let indexTotal = 0;
    for (const s of surfaces) indexTotal += s.geometry.indices.length;
    const vertexTotals = this.groups.map((group) => {
      let vertices = 0;
      for (const s of group.members) vertices += surfaces[s].geometry.positions.length / 3;
      for (const p of group.instanced) vertices += p.geometry.positions.length / 3;
      return vertices;
    });
    // The largest buffer the cut makes: the indices (a storage binding), or
    // a group's widest attribute (four floats a vertex).
    let widest = 0;
    for (const vertices of vertexTotals) widest = Math.max(widest, vertices * 16);
    const limits = device.limits;
    if (indexTotal * 4 > Math.min(limits.maxStorageBufferBindingSize, limits.maxBufferSize) || widest > limits.maxBufferSize) {
      console.error("world blocks: the cut is past the device's buffer limits; the blocks go back to Babylon");
      this.giveUpAll();
      this.surfaces = [];
      return;
    }
    const indices = new Uint32Array(indexTotal);
    const cut: { surface: number; group: number; base: number; c: readonly Cluster[] }[] = [];
    const ranges: CullTables["groups"][number][] = [];
    const draws: InstanceTables["draws"][number][] = [];
    let indexAt = 0;
    let clusterCount = 0;
    this.groups.forEach((group, g) => {
      const start = clusterCount;
      const base = indexAt;
      const attributes = group.program.vertex.attributes;
      group.vertex = attributes.map((a) => this.vertexBuffer(group, a.name, a.type, vertexTotals[g]));
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
        vertexBase += positions.length / 3;
        indexAt += local.length;
      }
      ranges.push({ start, end: clusterCount, base });
      group.indexBase = base;
      group.indexCount = indexAt - base;
      // The instanced parts after the surfaces, each drawn at its own index
      // range from its own vertex base.
      group.drawStart = draws.length;
      if (group.instanced.length > 0) {
        let partIndices = 0;
        for (const p of group.instanced) partIndices += p.geometry.indices.length;
        group.instancedIndex = device.createBuffer({
          label: `world blocks: [${group.material.recipe.defines.join("+")}] instanced indices`,
          size: Math.max(4, partIndices * 4),
          usage: GPUBufferUsage.INDEX,
          mappedAtCreation: true,
        });
        const dst = new Uint32Array(group.instancedIndex.getMappedRange());
        let firstIndex = 0;
        for (const p of group.instanced) {
          dst.set(p.geometry.indices, firstIndex);
          draws.push({
            set: p.set,
            indexCount: p.geometry.indices.length,
            firstIndex,
            baseVertex: vertexBase,
          });
          firstIndex += p.geometry.indices.length;
          vertexBase += p.geometry.positions.length / 3;
        }
        group.instancedIndex.unmap();
      }
      group.drawEnd = draws.length;
      for (const b of group.vertex) b.unmap();
      this.ask(group);
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
    const bands2 = [bands[0] * bands[0], bands[1] * bands[1], bands[2] * bands[2]];
    this.cull = new ClusterCull(
      device,
      this.renderer.pipelines,
      { clusters: words, clusterCount, blocks: blockList, spheres, groups: ranges, indices, bands2 },
      this.gate,
      this.diagnostics,
    );
    const ready: Promise<boolean>[] = [this.cull.ready];
    if (scatter && draws.length > 0) {
      const tables = this.instanceTables(scatter.sets, draws, bands2);
      this.instances = new InstanceCull(device, this.renderer.pipelines, tables, this.gate, this.diagnostics);
      ready.push(this.instances.ready);
    }
    const generation = this.generation;
    void Promise.all(ready).then((oks) => {
      if (generation !== this.generation) return;
      const ok = oks.every(Boolean);
      this.culling = ok;
      if (ok) this.hook();
      else this.giveUpAll();
    });
    // The build's arrays are ours no longer.
    this.surfaces = [];
    for (const group of this.groups) group.instanced = [];
  }

  /**
   * Stops drawing this map for good, whatever is still compiling: the draw
   * and the culls come off the renderer and nothing that settles later writes
   * anything. Every buffer stays until `clear`, because this may be called
   * inside a render whose commands already hold them (`Renderer.onRefused`).
   */
  stop(): void {
    this.generation++;
    this.culling = false;
    this.unhook?.();
    this.unhook = null;
    // The draw that counted it is off the renderer now.
    this.drawn = 0;
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
      g.instancedIndex?.destroy();
      g.material.block.destroy();
    }
    this.unhook?.();
    this.unhook = null;
    this.cull?.dispose();
    this.cull = null;
    this.instances?.dispose();
    this.instances = null;
    this.draws = [];
    this.culling = false;
    this.surfaces = [];
    this.surfaceCount = 0;
    this.clusterCount = 0;
    this.instanceCount = 0;
    this.setCount = 0;
    this.groups.length = 0;
    this.groupOf.clear();
    this.drawn = 0;
  }

  dispose(): void {
    this.clear();
    this.mesh.destroy();
  }

  /** The group `recipe` is drawn in, made on its first surface; refuses a surface missing what its variant reads. */
  private groupFor(label: string, geometry: SurfaceArrays, recipe: CelRecipe): Group {
    if (this.cull) throw new Error("world blocks: a surface added after the map was cut");
    let group = this.groupOf.get(recipe);
    if (!group) {
      group = {
        material: this.materialOf(recipe),
        program: this.programOf(recipe.defines),
        members: [],
        instanced: [],
        vertex: [],
        instancedIndex: null,
        indexBase: 0,
        indexCount: 0,
        drawStart: 0,
        drawEnd: 0,
        built: null,
        instancedBuilt: null,
        failed: false,
      };
      this.groupOf.set(recipe, group);
      this.groups.push(group);
    }
    for (const a of group.program.vertex.attributes) {
      if (!geometry[SOURCE[a.name]] && a.name !== "uv") {
        throw new Error(`world blocks: "${label}" has no ${a.name}, which its variant reads`);
      }
    }
    return group;
  }

  /**
   * Cuts the scatter's pieces out of every surface of a group that draws them
   * as instances. In DEV it checks the trade is one for one: the triangles
   * cut out of a group are exactly its instanced parts' triangles times their
   * sets' instances, or something is drawn twice or not at all.
   */
  private cutScatter(scatter: ScatterCut): void {
    const surfaces = this.surfaces;
    for (const group of this.groups) {
      if (group.instanced.length === 0) continue;
      let cutIndices = 0;
      for (const s of group.members) {
        const surface = surfaces[s];
        const kept = withoutPieces(surface.geometry, surface.pieces, scatter.cut);
        surface.geometry = kept.geometry;
        surface.pieces = kept.pieces;
        cutIndices += kept.cutIndices;
      }
      if (import.meta.env.DEV) {
        let drawn = 0;
        for (const p of group.instanced) drawn += p.geometry.indices.length * scatter.sets[p.set].scales.length;
        if (drawn !== cutIndices) {
          console.error(
            `world blocks: [${group.material.recipe.defines.join("+")}] cut ${cutIndices} scatter indices ` +
              `out of its blocks and draws ${drawn} as instances (BABYLON_EXIT.md X3.4b)`,
          );
        }
      }
    }
  }

  /**
   * The instance cull's tables: every set's instances, set by set, each with
   * its world sphere — the set's own sphere (over every part of it, in its
   * own frame) moved by the instance's matrix and grown by its scale — and
   * the most its set's vertices can sway.
   */
  private instanceTables(
    sets: readonly InstanceSet[],
    draws: InstanceTables["draws"],
    bands2: readonly number[],
  ): InstanceTables {
    // Each set's sphere and sway, over every part drawn of it.
    const lo = sets.map(() => [Infinity, Infinity, Infinity]);
    const hi = sets.map(() => [-Infinity, -Infinity, -Infinity]);
    const ramp = sets.map(() => 0);
    const rigged = sets.map(() => false);
    for (const group of this.groups) {
      for (const p of group.instanced) {
        const pos = toFloat32(p.geometry.positions);
        const colors = p.geometry.colors;
        const l = lo[p.set];
        const h = hi[p.set];
        for (let i = 0, v = 0; i < pos.length; i += 3, v++) {
          for (let a = 0; a < 3; a++) {
            if (pos[i + a] < l[a]) l[a] = pos[i + a];
            if (pos[i + a] > h[a]) h[a] = pos[i + a];
          }
          if (colors) {
            const r = colors[v * 4];
            if (r > ramp[p.set]) ramp[p.set] = r;
            else if (r < 0) rigged[p.set] = true;
          }
        }
      }
    }
    let total = 0;
    for (const s of sets) total += s.scales.length;
    const words = new ArrayBuffer(Math.max(1, total) * INSTANCE_WORDS * 4);
    const f = new Float32Array(words);
    const u = new Uint32Array(words);
    const out: InstanceTables["sets"][number][] = [];
    const starts: number[] = [];
    let at = 0;
    sets.forEach((set, s) => {
      starts.push(at);
      const l = lo[s];
      const h = hi[s];
      const cx = (l[0] + h[0]) / 2;
      const cy = (l[1] + h[1]) / 2;
      const cz = (l[2] + h[2]) / 2;
      const r = Math.hypot(h[0] - l[0], h[1] - l[1], h[2] - l[2]) / 2;
      const n = set.scales.length;
      for (let i = 0; i < n; i++) {
        const m = set.matrices.subarray(i * 16, i * 16 + 16);
        const o = (at + i) * INSTANCE_WORDS;
        f[o] = m[0] * cx + m[4] * cy + m[8] * cz + m[12];
        f[o + 1] = m[1] * cx + m[5] * cy + m[9] * cz + m[13];
        f[o + 2] = m[2] * cx + m[6] * cy + m[10] * cz + m[14];
        f[o + 3] = Number.isFinite(r) ? r * set.scales[i] : 0;
        // Each column of the matrix, with that row of its translation in w.
        f[o + 4] = m[0];
        f[o + 5] = m[1];
        f[o + 6] = m[2];
        f[o + 7] = m[12];
        f[o + 8] = m[4];
        f[o + 9] = m[5];
        f[o + 10] = m[6];
        f[o + 11] = m[13];
        f[o + 12] = m[8];
        f[o + 13] = m[9];
        f[o + 14] = m[10];
        f[o + 15] = m[14];
        u[o + 16] = s;
      }
      out.push({ start: at, end: at + n, ramp: ramp[s], rigged: rigged[s] });
      at += n;
    });
    this.instanceCount = total;
    this.setCount = sets.length;
    this.draws = draws.map((d) => ({ offset: starts[d.set] * TRANSFORM_WORDS * 4 }));
    return { instances: words, instanceCount: total, sets: out, draws, bands2 };
  }

  /** The draw at the end of group 0's opaque meshes, and the culls ahead of it. */
  private hook(): void {
    const removeDraw = this.renderer.add(this.draw, "opaque");
    const removeFrame = this.renderer.onFrame(this.prepare);
    this.unhook = () => {
      removeDraw();
      removeFrame();
    };
  }

  /** Every surface failed: a cull, or the whole cut, could not be built. */
  private giveUpAll(): void {
    this.culling = false;
    this.onFailed(Array.from({ length: this.surfaceCount }, (_, s) => s));
  }

  /** A pipeline of `group` failed: it draws nothing, and its surfaces go back at once. */
  private fail(group: Group, which: string, err: unknown): void {
    if (group.failed) return;
    group.failed = true;
    console.error(
      `world blocks: [${group.material.recipe.defines.join("+")}] has no ${which} pipeline; ` +
        `its ${group.members.length} surfaces go back to Babylon`,
      err,
    );
    this.onFailed(group.members);
  }

  /** One attribute's buffer for the whole group, MAPPED, filled surface by surface, then part by part. */
  private vertexBuffer(group: Group, name: string, type: string, vertexTotal: number): GPUBuffer {
    const floats = ATTRIBUTE_FORMATS[type].floats;
    const buffer = this.renderer.device.createBuffer({
      label: `world blocks: [${group.material.recipe.defines.join("+")}] ${name}`,
      size: Math.max(4, vertexTotal * floats * 4),
      usage: GPUBufferUsage.VERTEX,
      mappedAtCreation: true,
    });
    const dst = new Float32Array(buffer.getMappedRange());
    let at = 0;
    const write = (geo: SurfaceArrays): void => {
      const array = geo[SOURCE[name]] as Float32Array | Float64Array | null;
      // A mapped buffer starts zeroed: an absent `uv` is left reading 0.
      if (array) dst.set(array, at);
      at += (geo.positions.length / 3) * floats;
    };
    for (const s of group.members) write(this.surfaces[s].geometry);
    for (const p of group.instanced) write(p.geometry);
    return buffer;
  }

  /** Asks for a group's pipelines; a failure of either hands every member back, at once. */
  private ask(group: Group): void {
    const recipe = group.material.recipe;
    const generation = this.generation;
    const state = recipe.depthBias === 0 ? undefined : { depthBias: recipe.depthBias };
    const spec = (vertex: AssembledVertex): PipelineSpec => ({
      vertex,
      vertexEntry: "main",
      fragment: group.program.fragment,
      fragmentEntry: "main",
      buffers: bufferLayouts(vertex),
      targets: FRAME_TARGETS,
      state,
    });
    const failed = (which: string) => (err: unknown) => {
      if (generation === this.generation) this.fail(group, which, err);
    };
    this.renderer.pipelines.get(spec(group.program.vertex)).then((built) => {
      group.built = built;
    }, failed("block"));
    if (group.drawEnd > group.drawStart) {
      this.renderer.pipelines.get(spec(group.program.instanced)).then((built) => {
        group.instancedBuilt = built;
      }, failed("instanced"));
    }
  }

  /** The three modules of the variant `defines`, assembled once. */
  private programOf(defines: readonly string[]): Program {
    const key = defines.join("+");
    let program = this.programs.get(key);
    if (!program) {
      program = {
        vertex: celVertex(defines, FRAME_TARGETS),
        instanced: celInstancedVertex(defines, FRAME_TARGETS),
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

  /** As the main pass begins: this frame's culls, ahead of the draws. */
  private readonly prepare = (frame: FrameUniforms, encoder: GPUCommandEncoder): void => {
    if (!this.culling) return;
    this.cull?.dispatch(frame, encoder);
    this.instances?.dispatch(frame, encoder);
  };

  private readonly draw = (pass: GPURenderPassEncoder, ctx: FrameContext): void => {
    let drawn = 0;
    const cull = this.cull;
    if (this.culling && cull) {
      const blocks = this.drawBlocks(pass, ctx, cull);
      if (blocks < this.fewestBlockDraws) this.fewestBlockDraws = blocks;
      if (blocks > this.mostBlockDraws) this.mostBlockDraws = blocks;
      drawn += blocks + this.drawScatter(pass, ctx);
    }
    this.drawn = drawn;
  };

  /** The blocks: one plain draw a group over its whole range of the cull's indices. */
  private drawBlocks(pass: GPURenderPassEncoder, ctx: FrameContext, cull: ClusterCull): number {
    let drawn = 0;
    const host = this.renderer.host;
    const groups = this.groups;
    pass.setIndexBuffer(cull.indices, "uint32");
    for (let g = 0; g < groups.length; g++) {
      const group = groups[g];
      const built = group.built;
      // A group whose surfaces were all scatter draws its parts as instances.
      if (!built || group.failed || group.indexCount === 0) continue;
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
      pass.drawIndexed(group.indexCount, 1, group.indexBase, 0, 0);
      drawn++;
    }
    return drawn;
  }

  /** The scatter: each group's parts against its own index buffer, each part's instances bound at its set's region. */
  private drawScatter(pass: GPURenderPassEncoder, ctx: FrameContext): number {
    const instances = this.instances;
    if (!instances) return 0;
    let drawn = 0;
    const host = this.renderer.host;
    const groups = this.groups;
    const draws = this.draws;
    for (let g = 0; g < groups.length; g++) {
      const group = groups[g];
      const built = group.instancedBuilt;
      if (!built || group.failed || !group.instancedIndex) continue;
      const material = group.material;
      material.group.refresh(host, material.recipe.textures);
      const frame = ctx.frameGroup(built.groups[0]);
      const own = material.group.get(built.groups[1]);
      if (!frame || !own) continue;
      pass.setPipeline(built.pipeline);
      pass.setBindGroup(0, frame);
      pass.setBindGroup(1, own);
      const vertex = group.vertex;
      for (let k = 0; k < vertex.length; k++) pass.setVertexBuffer(k, vertex[k]);
      pass.setIndexBuffer(group.instancedIndex, "uint32");
      const slot = vertex.length;
      for (let d = group.drawStart; d < group.drawEnd; d++) {
        pass.setVertexBuffer(slot, instances.placed, draws[d].offset);
        pass.drawIndexedIndirect(instances.args, d * INDIRECT_BYTES);
        drawn++;
      }
    }
    return drawn;
  }
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
