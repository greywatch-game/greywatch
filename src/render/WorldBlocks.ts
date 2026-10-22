/**
 * render/WorldBlocks.ts — The static world as our renderer draws it in the
 * frame's main pass: the BLOCKS, cut into clusters, culled on the GPU and
 * drawn with ONE plain draw per material over its whole range, the survivors
 * at the front and triangles of no area after them (`BABYLON_EXIT.md`
 * X3.3b); the SCATTER, instances of its variants expanded into their
 * clusters on the GPU and drawn with ONE indirect draw per material over the
 * survivors (X3.4b, folded at X3.5b); and the LANDFORM, the floor's patches,
 * the rim's runs and the map-wide road merge, cut, culled and drawn as the
 * blocks are, after them (X3.5) — every draw through the one pulled vertex
 * stage (`celVertex.ts`), which reads its record off the index
 * (`streamIndex.ts`).
 * Owns: `WorldBlocks` — the surfaces and the scatter's instanced parts handed
 * to it until the map is cut (`finish`), then each material GROUP's vertex
 * arrays (every instanced part of the group end to end, then every surface of
 * it), its pipeline, its material block and bind group and its geometry bind
 * group (group 2); the instances' transforms, which every group's group 2
 * binds; each variant's two modules (assembled once); the `ClusterCull` that
 * writes the blocks' indices and the `InstanceCull` that writes the
 * scatter's; and the one `FrameDraw`, ahead of group 0's alpha-tested meshes
 * (`DrawPoint` `"beforeAlphaTest"`) — the blocks, the scatter, then the
 * landform — with the `FramePrepare` that culls ahead of it, both on the
 * renderer only while a map's culls are built and nobody has `stop`ped it.
 * WHY THAT POINT, AND THE LANDFORM LAST: the turf (`GrassSystem`) is a blend
 * laid over the floor on group 0's alpha-tested list, and it writes no depth
 * of its own — so the floor, and a road beside it, must be drawn before that
 * list, or they would paint over it. The point is after the sky dome, so the
 * blocks are drawn there too, AHEAD of the landform: the floor behind a
 * building then fails the depth test before it shades, rather than being
 * shaded and painted over (`BABYLON_EXIT.md` X3.5, `FINDINGS.md` 61).
 * WHY TWO DRAWS FOR A GROUP THAT HAS SCATTER, AND NOT ONE: the BLOCKS are
 * never drawn indirect — an Intel Xe-LPG dropped single indirect draws at
 * random, at arguments however written, and drew the same triangles plain
 * every frame (`docs/rendering.md`) — and the scatter cannot be drawn plain,
 * because what survives of it is a count only the GPU knows, and a range that
 * held every instance would hand the GPU the whole forest as triangles of no
 * area every frame. So a group's blocks are one plain draw and its scatter
 * one indirect draw, through one pipeline; the scatter's indirect draws were
 * never seen to drop.
 * Invariants: a GROUP is one cel recipe IN ONE LAYER — one material, one
 * pipeline, one cluster draw and at most one scatter draw — and a surface or
 * an instanced part belongs to exactly one: a landform surface to its
 * recipe's landform group, a block surface and every instanced part to its
 * recipe's block group, so a rim wearing the pines' material never shares
 * their group or their scatter; the two layers share ONE cut, one cull, one
 * cluster list and one index buffer, each group drawing only its own range of
 * it, and the scatter's stream gives each group a region of its own; its
 * vertex arrays are uploaded once as Babylon uploads a mesh's (floats as
 * `float32`, a `Float64Array` rounded exactly as Babylon's `Float32Array` of
 * the same numbers is), an attribute a surface lacks but its variant reads
 * being 0 for every one of its vertices — what Babylon's empty vertex buffer
 * reads — with its instanced parts FIRST, so a scatter index names its vertex
 * with no per-group base (`streamIndex.ts`), and its block indices once,
 * rebased onto the arrays, as the source the cull copies the survivors from;
 * the map is CUT once (`finish`), in the order the surfaces were added, and
 * never re-cut; in a group that has instanced parts, the pieces `finish` is
 * told to CUT (the scatter's regions) are taken out of every surface before
 * it is uploaded, because those triangles are drawn as instances instead —
 * and a group with no surface of its own draws none of its instanced parts,
 * since Babylon draws that recipe whole; a group draws only once its pipeline
 * and the culls are built and every group it binds is whole, so a frame with
 * a pipeline compiling or a texture unpublished draws that group not at all
 * rather than wrongly; a group that will never draw — its pipeline FAILED, an
 * instanced part of it lacks what its variant reads, or its scatter is past
 * the stream index's budget or the stream past the device's limits — draws
 * nothing at all and hands every surface of
 * it back, since half of a recipe would be a hole where Babylon draws the
 * other half (and Babylon's blocks still hold the scatter we would have cut);
 * a surface it will never draw — its group failed, or a cull did, or the cut
 * is past the device's limits — is handed to `onFailed` in the turn that
 * failure lands, never held for the map's other compiles, so whoever took it
 * can give it back at once; a material's block is re-copied from its recipe
 * only when asked (`writeMaterials`); nothing here allocates on a frame but
 * the culls' compute passes.
 * Never: imports Babylon; reads a node, or decides the reach or the size gate
 * (`ReachGate` is handed in); reads a Babylon material — a material is its
 * `CelRecipe`.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 *
 * WHAT A DRAW BINDS, by group: 0 the frame (`Renderer`'s), 1 the recipe's
 * material, 2 the group's geometry — its arrays, read at the vertex each
 * index names, and the instances' transforms (`celVertex.ts`'s
 * `CEL_GEOMETRY`); no vertex buffer. A block draw's index buffer is the
 * cluster cull's, `uint32`, and the draw is `drawIndexed` over the group's
 * whole range of it — none for a group whose cut kept no index; a scatter
 * draw's is the instance cull's stream, and the draw is `drawIndexedIndirect`
 * at the group's own arguments.
 */
import { CEL_MATERIAL_BLOCK, CEL_MATERIAL_TEXTURES, type CelRecipe } from "./celMaterial";
import { celFragment } from "./celFragment";
import { CEL_GEOMETRY, celVertex, TRANSFORM_WORDS, writeTransform } from "./celVertex";
import {
  type BlockBox,
  ClusterCull,
  type CullDiagnostics,
  NO_DIAGNOSTICS,
  type ReachGate,
  type ScanRange,
} from "./ClusterCull";
import { type Cluster, cutClusters, type PieceSpan, type SurfaceArrays, withoutPieces } from "./clusters";
import type { FrameUniforms } from "./frame";
import { HostBindGroup } from "./HostBindGroup";
import { InstanceCull, type InstanceTables } from "./InstanceCull";
import type { PassTiming } from "./PassTimer";
import type { BuiltPipeline } from "./PipelineCache";
import type { FrameContext, Renderer } from "./Renderer";
import { SCATTER_INSTANCES, SCATTER_VERTICES } from "./streamIndex";
import { FRAME_TARGETS } from "./targets";
import { UniformBlockBuffer } from "./UniformBlockBuffer";
import { type AssembledModule, type AssembledVertex, PULLED_ATTRIBUTES } from "./wgsl/assemble";
import { CLUSTER_WORDS } from "./wgsl/clusterCull";
import { INDIRECT_BYTES, INSTANCE_WORDS, RECORD_WORDS, SOURCE_VERTICES } from "./wgsl/instanceCull";

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

/** One variant's two modules. */
interface Program {
  readonly vertex: AssembledVertex;
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

/** Which of the world's two layers a group is in: the blocks, drawn first, or the landform. */
type WorldLayer = "blocks" | "landform";

/** One material's draws in one layer: its instanced parts' arrays end to end, its surfaces' after them. */
interface Group {
  readonly layer: WorldLayer;
  readonly material: MaterialSlot;
  readonly program: Program;
  /** Indices into `surfaces`, in the order added. */
  readonly members: number[];
  /** Its instanced parts, in the order added; emptied at `finish`. */
  instanced: InstancedPart[];
  /** Why it cannot draw its scatter, if an instanced part lacked what its variant reads: it goes back at `finish`. */
  withheld: string | null;
  /** Its storage arrays, in the vertex program's attribute order; empty until `finish`. */
  arrays: GPUBuffer[];
  /** Group 2: its arrays and the instances' transforms; null until `finish`. */
  geometry: HostBindGroup | null;
  /** Its range of the cluster cull's indices, `[indexBase, indexBase + indexCount)` — what its block draw covers. */
  indexBase: number;
  indexCount: number;
  /** It draws scatter: its region of the instance cull's stream, at its own arguments. */
  scattered: boolean;
  built: BuiltPipeline | null;
  /** It draws nothing, and its members went back. */
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

/** One surface as the cut left it: its group, where its indices start, and its clusters. */
interface CutSurface {
  readonly surface: number;
  readonly group: number;
  readonly base: number;
  readonly c: readonly Cluster[];
}

/** Where the cut has got to in the cluster cull's indices and clusters. */
interface CutCursor {
  index: number;
  cluster: number;
}

/** What the cut will make (`WorldBlocks.measure`). */
interface CutSize {
  /** The cluster cull's indices. */
  indices: number;
  /** The instanced parts' indices, every group's. */
  source: number;
  /** The scatter's stream: every record's indices. */
  stream: number;
  /** Each group's vertices, in group order. */
  readonly vertices: number[];
}

/** What the cut makes of the scatter for the instance cull, gathered group by group. */
interface ScatterStream {
  /** Each instanced part's clusters, with their first index into `source`, their range (group) and their part's first vertex. */
  readonly clusters: { readonly cluster: Cluster; readonly first: number; readonly range: number; readonly base: number }[];
  readonly records: number[];
  readonly ranges: ScanRange[];
  /** Each part's own indices, 16 bits (`SOURCE_VERTICES`). */
  readonly source: Uint16Array;
  /** Where the next range's source and region start. */
  sourceAt: number;
  streamAt: number;
}

export class WorldBlocks {
  /** Until `finish`; emptied there, so the build's arrays can go. */
  private surfaces: Surface[] = [];
  private surfaceCount = 0;
  /**
   * One per recipe a layer, in the order first added — the order each layer
   * draws its own in, its biased ones first (`drawClusters`).
   */
  private readonly groups: Group[] = [];
  /** Each layer's groups by recipe: one recipe in both layers is two groups. */
  private readonly groupOf: Record<WorldLayer, Map<CelRecipe, Group>> = {
    blocks: new Map(),
    landform: new Map(),
  };
  /**
   * Each variant's modules, assembled once rather than per surface: a map is
   * thousands of surfaces over a handful of variants.
   */
  private readonly programs = new Map<string, Program>();
  /** Every instance's transform, `TRANSFORM_WORDS` each, in the instance table's order; null until `finish`. */
  private transforms: GPUBuffer | null = null;
  private cull: ClusterCull | null = null;
  private instances: InstanceCull | null = null;
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
   * Takes the draws and the culls' prepare back off the renderer; null while
   * nothing is registered. Registered only while a map's culls are BUILT, so
   * a frame with nothing of ours to draw — the menu, an editor build — costs
   * the renderer one empty branch rather than a filled and uploaded frame.
   */
  private unhook: (() => void) | null = null;

  /** Draws issued last frame — see `drawn`. */
  private drawnLast = 0;

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
  ) {}

  /** Draws issued last frame — what a census of the main pass adds to Babylon's. */
  get drawn(): number {
    return this.drawnLast;
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
   * Hands over one surface, drawn with `recipe` — a block, or with `landform`
   * the floor, the rim or the road merge, drawn ahead of the alpha-tested
   * meshes (see the header); its index is the surface's, for `onFailed`. Its
   * arrays are READ at `finish`, so they must stand until then.
   */
  add(
    label: string,
    geometry: SurfaceArrays,
    recipe: CelRecipe,
    pieces: readonly PieceSpan[],
    landform: boolean,
  ): number {
    const group = this.groupFor(recipe, landform ? "landform" : "blocks");
    const missing = missingAttribute(group, geometry);
    if (missing) throw new Error(`world blocks: "${label}" has no ${missing}, which its variant reads`);
    const at = this.surfaces.length;
    this.surfaces.push({ geometry, pieces });
    group.members.push(at);
    this.surfaceCount = this.surfaces.length;
    return at;
  }

  /**
   * Hands over one part of instance set `set` (`ScatterCut.sets`), drawn with
   * `recipe` once per surviving instance. Its arrays are READ at `finish`. A
   * part lacking what its variant reads cannot be drawn while its pieces are
   * cut out of the blocks, so its whole group goes back at `finish`.
   */
  addInstanced(set: number, label: string, geometry: SurfaceArrays, recipe: CelRecipe): void {
    const group = this.groupFor(recipe, "blocks");
    const missing = missingAttribute(group, geometry);
    if (missing) group.withheld ??= `its instanced part "${label}" has no ${missing}, which its variant reads`;
    else group.instanced.push({ geometry, set });
  }

  /**
   * Cuts the map: what will never draw handed back, every group's arrays
   * uploaded and its pipeline asked for, every surface cut into clusters —
   * the scatter's pieces cut out of it first, where its group draws them as
   * instances — every instanced part cut into clusters too, and the culls
   * built. `blocks[s]` is surface `s`'s REACH box — its block's, as the
   * frame's mesh walk files it, or the one box of no reach every landform
   * surface is handed (`WorldCulling.reachBoxOf`); surfaces of one box share
   * the object.
   */
  finish(blocks: readonly BlockBox[], scatter: ScatterCut | null = null): void {
    const surfaces = this.surfaces;
    if (blocks.length !== surfaces.length) throw new Error("world blocks: a block for every surface");
    // Nothing taken (an editor build, a map of loose surfaces): no cull, and
    // no instance either — Babylon draws every recipe whole.
    if (surfaces.length === 0) return;
    const device = this.renderer.device;
    const sets = scatter?.sets ?? [];
    const setStarts: number[] = [];
    let instanceTotal = 0;
    for (const s of sets) {
      setStarts.push(instanceTotal);
      instanceTotal += s.scales.length;
    }

    // A recipe Babylon draws whole draws its scatter whole with it: a group
    // with no surface of ours keeps none of its instanced parts.
    for (const group of this.groups) {
      if (group.members.length > 0) continue;
      group.instanced = [];
      group.withheld = null;
    }
    this.handBack(instanceTotal);
    // Each surface's sphere is of what Babylon would draw — the WHOLE surface,
    // scatter included — because the size gate and the band measure the mesh.
    const spheres = new Float32Array(surfaces.length * 4);
    surfaces.forEach((s, i) => writeSphere(toFloat32(s.geometry.positions), spheres, i * 4));
    if (scatter) this.cutScatter(scatter);

    const size = this.measure(sets);
    if (!size) {
      console.error("world blocks: the cut is past the device's buffer limits; the blocks go back to Babylon");
      this.giveUpAll();
      this.release();
      return;
    }

    this.transforms = this.transformBuffer(sets, instanceTotal);
    const indices = new Uint32Array(size.indices);
    const cut: CutSurface[] = [];
    const ranges: ScanRange[] = [];
    const stream: ScatterStream = {
      clusters: [],
      records: [],
      ranges: [],
      source: new Uint16Array(size.source),
      sourceAt: 0,
      streamAt: 0,
    };
    const at: CutCursor = { index: 0, cluster: 0 };
    this.groups.forEach((group, g) => {
      const start = at.cluster;
      group.indexBase = at.index;
      // The instanced parts first: a scatter index names its vertex from the
      // start of the arrays (`streamIndex.ts`). A group handed back keeps its
      // place in both culls' tables, empty.
      const vertexBase = this.cutInstanced(group, g, sets, setStarts, stream);
      if (!group.failed) this.cutGroup(group, g, vertexBase, size.vertices[g], indices, at, cut);
      ranges.push({ start, end: at.cluster, base: group.indexBase });
      group.indexCount = at.index - group.indexBase;
    });

    const clusterCount = at.cluster;
    this.clusterCount = clusterCount;
    const bands = this.options.nearBands;
    const bands2 = [bands[0] * bands[0], bands[1] * bands[1], bands[2] * bands[2]];
    const boxes = uniqueBoxes(blocks);
    this.cull = new ClusterCull(
      device,
      this.renderer.pipelines,
      { clusters: clusterWords(cut, blocks, boxes), clusterCount, blocks: boxes, spheres, groups: ranges, indices, bands2 },
      this.gate,
      this.diagnostics,
    );
    const ready: Promise<boolean>[] = [this.cull.ready];
    if (stream.records.length > 0) {
      const tables: InstanceTables = {
        ...this.instanceTables(sets, setStarts),
        clusters: scatterClusterWords(stream.clusters),
        records: Uint32Array.from(stream.records),
        ranges: stream.ranges,
        source: stream.source,
        streamLength: size.stream,
        bands2,
      };
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
    this.release();
  }

  /**
   * What the cut will make — the cluster cull's indices, the scatter's source
   * and stream, each group's vertices — or null when the blocks' indices or a
   * group's widest array (four floats a vertex) are past the device's limits.
   * A STREAM past them hands back only the groups that draw scatter, as the
   * index's budget does: on the default limits (Babylon asks for no others)
   * Greyfen's 30.9M indices are 92% of a storage binding, and a denser forest
   * should cost Babylon the scatter's recipes, not the map.
   */
  private measure(sets: readonly InstanceSet[]): CutSize | null {
    const limits = this.renderer.device.limits;
    const storage = Math.min(limits.maxStorageBufferBindingSize, limits.maxBufferSize);
    let size = this.sizes(sets);
    if (size.stream * 4 > storage) {
      for (const group of this.groups) {
        if (group.instanced.length === 0) continue;
        this.fail(group, `the scatter's stream (${size.stream} indices) is past the device's ${storage} bytes`);
      }
      size = this.sizes(sets);
    }
    let widest = 0;
    for (const vertices of size.vertices) widest = Math.max(widest, vertices * 16);
    return Math.max(size.indices * 4, widest) > storage ? null : size;
  }

  /** `measure`'s count, over the groups not handed back. */
  private sizes(sets: readonly InstanceSet[]): CutSize {
    const size: CutSize = { indices: 0, source: 0, stream: 0, vertices: [] };
    for (const group of this.groups) {
      let vertices = 0;
      // A group handed back uploads nothing (and kept no instanced part).
      if (!group.failed) {
        for (const s of group.members) {
          vertices += this.surfaces[s].geometry.positions.length / 3;
          size.indices += this.surfaces[s].geometry.indices.length;
        }
      }
      for (const p of group.instanced) {
        vertices += p.geometry.positions.length / 3;
        size.source += p.geometry.indices.length;
        size.stream += p.geometry.indices.length * sets[p.set].scales.length;
      }
      size.vertices.push(vertices);
    }
    return size;
  }

  /**
   * Group `g`'s arrays uploaded, its surfaces' indices rebased past its
   * `vertexBase` instanced vertices and cut into clusters at `at`, and its
   * pipeline asked for.
   */
  private cutGroup(
    group: Group,
    g: number,
    vertexBase: number,
    vertexTotal: number,
    indices: Uint32Array,
    at: CutCursor,
    cut: CutSurface[],
  ): void {
    group.arrays = group.program.vertex.attributes.map((a) => this.attributeArray(group, a.name, a.type, vertexTotal));
    group.scattered = group.instanced.length > 0;
    let vertex = vertexBase;
    for (const s of group.members) {
      const surface = this.surfaces[s];
      const geo = surface.geometry;
      const positions = toFloat32(geo.positions);
      const local = geo.indices;
      for (let i = 0; i < local.length; i++) indices[at.index + i] = local[i] + vertex;
      const clusters = cutClusters(positions, local, geo.colors, surface.pieces, this.options.triangles);
      cut.push({ surface: s, group: g, base: at.index, c: clusters });
      at.cluster += clusters.length;
      at.index += local.length;
      vertex += positions.length / 3;
    }
    for (const b of group.arrays) b.unmap();
    this.geometryOf(group);
    this.ask(group);
  }

  /** The build's arrays are ours no longer, cut or not. */
  private release(): void {
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
    this.drawnLast = 0;
  }

  /** Re-copies every material's block from its recipe — after its owner rewrote one. */
  writeMaterials(): void {
    for (const g of this.groups) g.material.block.write(g.material.recipe.values);
  }

  /** Drops every surface, group and material: the map they were is gone. */
  clear(): void {
    this.generation++;
    for (const g of this.groups) {
      for (const b of g.arrays) b.destroy();
      g.material.block.destroy();
    }
    this.transforms?.destroy();
    this.transforms = null;
    this.unhook?.();
    this.unhook = null;
    this.cull?.dispose();
    this.cull = null;
    this.instances?.dispose();
    this.instances = null;
    this.culling = false;
    this.surfaces = [];
    this.surfaceCount = 0;
    this.clusterCount = 0;
    this.instanceCount = 0;
    this.setCount = 0;
    this.groups.length = 0;
    this.groupOf.blocks.clear();
    this.groupOf.landform.clear();
    this.drawnLast = 0;
  }

  dispose(): void {
    this.clear();
  }

  /**
   * The group of `recipe` in `layer`, made on its first surface or part. One
   * recipe's groups at the two layers share its program (assembled once a
   * variant) and each own a material slot, as each owns its arrays.
   */
  private groupFor(recipe: CelRecipe, layer: WorldLayer): Group {
    if (this.cull) throw new Error("world blocks: a surface added after the map was cut");
    const of = this.groupOf[layer];
    let group = of.get(recipe);
    if (!group) {
      group = {
        layer,
        material: this.materialOf(recipe),
        program: this.programOf(recipe.defines),
        members: [],
        instanced: [],
        withheld: null,
        arrays: [],
        geometry: null,
        indexBase: 0,
        indexCount: 0,
        scattered: false,
        built: null,
        failed: false,
      };
      of.set(recipe, group);
      this.groups.push(group);
    }
    return group;
  }

  /**
   * Hands back, before anything is cut or uploaded, every group that could
   * not draw its scatter: one with an instanced part it withheld, and one
   * whose scatter the stream index cannot address (`streamIndex.ts`) — the
   * map's instances past `SCATTER_INSTANCES` take every such group back, a
   * group's instanced vertices past `SCATTER_VERTICES` take that one — or
   * the cull's 16-bit source cannot, a part past `SOURCE_VERTICES`.
   */
  private handBack(instances: number): void {
    for (const group of this.groups) {
      if (group.withheld) {
        this.fail(group, group.withheld);
        continue;
      }
      if (group.instanced.length === 0) continue;
      let vertices = 0;
      let widest = 0;
      for (const p of group.instanced) {
        vertices += p.geometry.positions.length / 3;
        widest = Math.max(widest, p.geometry.positions.length / 3);
      }
      if (instances > SCATTER_INSTANCES) {
        this.fail(group, `the map's ${instances} instances are past the stream index's ${SCATTER_INSTANCES}`);
      } else if (vertices > SCATTER_VERTICES) {
        this.fail(group, `its ${vertices} instanced vertices are past the stream index's ${SCATTER_VERTICES}`);
      } else if (widest > SOURCE_VERTICES) {
        this.fail(group, `an instanced part's ${widest} vertices are past the cull's 16-bit source (${SOURCE_VERTICES})`);
      }
    }
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
   * Group `g`'s instanced parts for the instance cull: each part's own
   * indices into the stream's 16-bit source, every cluster of it carrying
   * where the part starts in the group's arrays, where the parts come first;
   * each part cut into clusters in its set's own frame; and a
   * RECORD for every cluster of every instance wearing it — part by part,
   * instance by instance, cluster by cluster — which is the group's range.
   * Returns the vertices the parts take, where the group's surfaces start.
   */
  private cutInstanced(
    group: Group,
    g: number,
    sets: readonly InstanceSet[],
    setStarts: readonly number[],
    stream: ScatterStream,
  ): number {
    const recordStart = stream.records.length / RECORD_WORDS;
    const regionStart = stream.streamAt;
    let vertexBase = 0;
    for (const p of group.instanced) {
      const positions = toFloat32(p.geometry.positions);
      const local = p.geometry.indices;
      stream.source.set(local, stream.sourceAt);
      const first = stream.clusters.length;
      const clusters = cutClusters(positions, local, p.geometry.colors, [], this.options.triangles);
      for (const cluster of clusters) {
        stream.clusters.push({ cluster, first: stream.sourceAt + cluster.indexStart, range: g, base: vertexBase });
      }
      const instances = sets[p.set].scales.length;
      for (let i = setStarts[p.set], end = i + instances; i < end; i++) {
        for (let c = 0; c < clusters.length; c++) stream.records.push(i, first + c);
      }
      stream.sourceAt += local.length;
      stream.streamAt += local.length * instances;
      vertexBase += positions.length / 3;
    }
    stream.ranges.push({ start: recordStart, end: stream.records.length / RECORD_WORDS, base: regionStart });
    return vertexBase;
  }

  /**
   * The instance cull's instance and set tables: every set's instances, set
   * by set, each with its world sphere — the set's own sphere (over every
   * part of it drawn, in its own frame) moved by the instance's matrix and
   * grown by its scale — and the most its set's vertices can sway. A set
   * none of whose parts is drawn (every one in a group handed back) has a
   * sphere of nothing at its placement: no record names it.
   */
  private instanceTables(
    sets: readonly InstanceSet[],
    setStarts: readonly number[],
  ): Pick<InstanceTables, "instances" | "instanceCount" | "sets"> {
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
    const total = sets.length === 0 ? 0 : setStarts[sets.length - 1] + sets[sets.length - 1].scales.length;
    const words = new ArrayBuffer(Math.max(1, total) * INSTANCE_WORDS * 4);
    const f = new Float32Array(words);
    const u = new Uint32Array(words);
    const out: InstanceTables["sets"][number][] = [];
    sets.forEach((set, s) => {
      const l = lo[s];
      const h = hi[s];
      const drawn = l[0] <= h[0];
      const cx = drawn ? (l[0] + h[0]) / 2 : 0;
      const cy = drawn ? (l[1] + h[1]) / 2 : 0;
      const cz = drawn ? (l[2] + h[2]) / 2 : 0;
      const r = drawn ? Math.hypot(h[0] - l[0], h[1] - l[1], h[2] - l[2]) / 2 : 0;
      const at = setStarts[s];
      const n = set.scales.length;
      for (let i = 0; i < n; i++) {
        const m = set.matrices.subarray(i * 16, i * 16 + 16);
        const o = (at + i) * INSTANCE_WORDS;
        f[o] = m[0] * cx + m[4] * cy + m[8] * cz + m[12];
        f[o + 1] = m[1] * cx + m[5] * cy + m[9] * cz + m[13];
        f[o + 2] = m[2] * cx + m[6] * cy + m[10] * cz + m[14];
        f[o + 3] = r * set.scales[i];
        writeTransform(m, f, o + 4);
        u[o + 16] = s;
      }
      out.push({ start: at, end: at + n, ramp: ramp[s], rigged: rigged[s] });
    });
    this.instanceCount = total;
    this.setCount = sets.length;
    return { instances: words, instanceCount: total, sets: out };
  }

  /**
   * Every instance's transform, set by set as the instance table orders
   * them: what group 2 binds in every group, so a map with no scatter still
   * binds one, never read. A buffer of its own rather than the instance
   * cull's table, whose records carry the same transform: the stage reads
   * twelve words an instance, never the cull's twenty, and a group binds it
   * whether or not there is a cull.
   */
  private transformBuffer(sets: readonly InstanceSet[], total: number): GPUBuffer {
    const buffer = this.renderer.device.createBuffer({
      label: "world blocks: transforms",
      size: Math.max(1, total) * TRANSFORM_WORDS * 4,
      usage: GPUBufferUsage.STORAGE,
      mappedAtCreation: true,
    });
    const dst = new Float32Array(buffer.getMappedRange());
    let at = 0;
    for (const set of sets) {
      for (let i = 0; i < set.scales.length; i++, at++) {
        writeTransform(set.matrices.subarray(i * 16, i * 16 + 16), dst, at * TRANSFORM_WORDS);
      }
    }
    buffer.unmap();
    return buffer;
  }

  /**
   * The culls, and the draw ahead of group 0's alpha-tested meshes — not
   * registered without a group, so it queues nothing: an item in Babylon's
   * bundle list closes the bundle open there.
   */
  private hook(): void {
    const removes: (() => void)[] = [this.renderer.onFrame(this.prepare)];
    if (this.groups.length > 0) removes.push(this.renderer.add(this.draw, "beforeAlphaTest"));
    this.unhook = () => {
      for (const remove of removes) remove();
    };
  }

  /** Every surface failed: a cull, or the whole cut, could not be built. */
  private giveUpAll(): void {
    this.culling = false;
    this.onFailed(Array.from({ length: this.surfaceCount }, (_, s) => s));
  }

  /** `group` will never draw: it draws nothing, and its surfaces go back at once. */
  private fail(group: Group, why: string, err?: unknown): void {
    if (group.failed) return;
    group.failed = true;
    group.instanced = [];
    console.error(
      `world blocks: [${group.material.recipe.defines.join("+")}] ${why}; ` +
        `its ${group.members.length} surfaces go back to Babylon`,
      ...(err === undefined ? [] : [err]),
    );
    this.onFailed(group.members);
  }

  /** One attribute's array for the whole group, MAPPED, filled part by part, then surface by surface. */
  private attributeArray(group: Group, name: string, type: string, vertexTotal: number): GPUBuffer {
    const floats = PULLED_ATTRIBUTES[type].floats;
    const buffer = this.renderer.device.createBuffer({
      label: `world blocks: [${group.material.recipe.defines.join("+")}] ${name}`,
      size: Math.max(16, vertexTotal * floats * 4),
      usage: GPUBufferUsage.STORAGE,
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
    for (const p of group.instanced) write(p.geometry);
    for (const s of group.members) write(this.surfaces[s].geometry);
    return buffer;
  }

  /** Group 2 for `group`: its arrays by the storage each attribute is read out of, and the transforms. */
  private geometryOf(group: Group): void {
    const buffers: Record<string, GPUBuffer> = { transforms: this.transforms! };
    group.program.vertex.attributes.forEach((a, k) => {
      buffers[a.from] = group.arrays[k];
    });
    const label = `world blocks: [${group.material.recipe.defines.join("+")}] geometry`;
    group.geometry = new HostBindGroup(this.renderer.device, label, CEL_GEOMETRY, group.material.recipe.defines, buffers);
    // No textures: resolved once, whole for good.
    group.geometry.refresh(this.renderer.host, {});
  }

  /** Asks for a group's pipeline; a failure hands every member back, at once. */
  private ask(group: Group): void {
    const recipe = group.material.recipe;
    const generation = this.generation;
    this.renderer.pipelines
      .get({
        vertex: group.program.vertex,
        vertexEntry: "main",
        fragment: group.program.fragment,
        fragmentEntry: "main",
        targets: FRAME_TARGETS,
        state: recipe.depthBias === 0 ? undefined : { depthBias: recipe.depthBias },
      })
      .then(
        (built) => {
          group.built = built;
        },
        (err: unknown) => {
          if (generation === this.generation) this.fail(group, "has no pipeline", err);
        },
      );
  }

  /** The two modules of the variant `defines`, assembled once. */
  private programOf(defines: readonly string[]): Program {
    const key = defines.join("+");
    let program = this.programs.get(key);
    if (!program) {
      program = { vertex: celVertex(defines, FRAME_TARGETS), fragment: celFragment(defines, FRAME_TARGETS) };
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
  private readonly prepare = (
    frame: FrameUniforms,
    encoder: GPUCommandEncoder,
    timing: PassTiming | null,
  ): void => {
    if (!this.culling) return;
    this.cull?.dispatch(frame, encoder, timing);
    this.instances?.dispatch(frame, encoder, timing);
  };

  /**
   * Ahead of group 0's alpha-tested meshes: the blocks, the scatter, then the
   * landform, so the floor behind what stands on it fails the depth test
   * before it shades (see the header).
   */
  private readonly draw = (pass: GPURenderPassEncoder, ctx: FrameContext): void => {
    let drawn = 0;
    const cull = this.cull;
    if (this.culling && cull) {
      drawn = this.drawClusters(pass, ctx, cull, "blocks") + this.drawScatter(pass, ctx);
      drawn += this.drawClusters(pass, ctx, cull, "landform");
    }
    this.drawnLast = drawn;
  };

  /**
   * Binds `group`'s pipeline and its three groups; false, binding nothing,
   * while its pipeline is compiling, it failed, or a texture it binds is
   * unpublished.
   */
  private bind(pass: GPURenderPassEncoder, ctx: FrameContext, group: Group): boolean {
    const built = group.built;
    if (!built || group.failed || !group.geometry) return false;
    const material = group.material;
    material.group.refresh(this.renderer.host, material.recipe.textures);
    const frame = ctx.frameGroup(built.groups[0]);
    const own = material.group.get(built.groups[1]);
    const geometry = group.geometry.get(built.groups[2]);
    if (!frame || !own || !geometry) return false;
    pass.setPipeline(built.pipeline);
    pass.setBindGroup(0, frame);
    pass.setBindGroup(1, own);
    pass.setBindGroup(2, geometry);
    return true;
  }

  /**
   * The surfaces of `layer`'s groups: one plain draw a group over its whole
   * range of the cull's indices — the groups whose recipe carries a depth
   * BIAS first (the roads), then the rest in the order first added.
   *
   * The bias decides which surface wins, never the order, so the picture is
   * the same either way; the order decides what is SHADED. Drawn after the
   * floor, every road pixel was the bumped floor shaded and then painted
   * over; drawn first, the floor under a road fails the depth test before it
   * shades. Measured at X3.5 on Cinderhaven (`BABYLON_EXIT.md`): about half
   * the landform's rise at a road crossing, most of it in the town.
   */
  private drawClusters(pass: GPURenderPassEncoder, ctx: FrameContext, cull: ClusterCull, layer: WorldLayer): number {
    let drawn = 0;
    const groups = this.groups;
    const n = groups.length;
    pass.setIndexBuffer(cull.indices, "uint32");
    // Twice over the groups: the biased ones on the first lap, the rest on the second.
    for (let lap = 0; lap < 2 * n; lap++) {
      const group = groups[lap % n];
      if (group.layer !== layer) continue;
      if ((group.material.recipe.depthBias !== 0) !== (lap < n)) continue;
      // A group whose surfaces were all scatter draws only its stream.
      if (group.indexCount === 0 || !this.bind(pass, ctx, group)) continue;
      pass.drawIndexed(group.indexCount, 1, group.indexBase, 0, 0);
      drawn++;
    }
    return drawn;
  }

  /** The scatter: one indirect draw a group that has any, over its region of the stream. */
  private drawScatter(pass: GPURenderPassEncoder, ctx: FrameContext): number {
    const instances = this.instances;
    if (!instances) return 0;
    let drawn = 0;
    const groups = this.groups;
    pass.setIndexBuffer(instances.indices, "uint32");
    for (let g = 0; g < groups.length; g++) {
      if (!groups[g].scattered || !this.bind(pass, ctx, groups[g])) continue;
      pass.drawIndexedIndirect(instances.args, g * INDIRECT_BYTES);
      drawn++;
    }
    return drawn;
  }
}

/** The first attribute `group`'s variant reads that `geometry` lacks, or null; an absent `uv` reads 0. */
function missingAttribute(group: Group, geometry: SurfaceArrays): string | null {
  for (const a of group.program.vertex.attributes) {
    if (!geometry[SOURCE[a.name]] && a.name !== "uv") return a.name;
  }
  return null;
}

/** A float array as the device holds it — rounded exactly as `new Float32Array(numbers)`. */
function toFloat32(a: Float32Array | Float64Array): Float32Array {
  return a instanceof Float32Array ? a : Float32Array.from(a);
}

/** Each distinct reach box once, in the order first met — the cluster cull's block table. */
function uniqueBoxes(blocks: readonly BlockBox[]): BlockBox[] {
  return [...new Set(blocks)];
}

/**
 * The block clusters as the cluster cull's `Cluster`: each surface's, in cut
 * order, its block the index of its reach box in `boxes` (`uniqueBoxes`).
 */
function clusterWords(cut: readonly CutSurface[], blocks: readonly BlockBox[], boxes: readonly BlockBox[]): ArrayBuffer {
  const blockIds = new Map(boxes.map((box, i) => [box, i]));
  let count = 0;
  for (const { c } of cut) count += c.length;
  const words = new ArrayBuffer(Math.max(1, count) * CLUSTER_WORDS * 4);
  const f = new Float32Array(words);
  const u = new Uint32Array(words);
  let k = 0;
  for (const { surface, group, base, c } of cut) {
    const block = blockIds.get(blocks[surface])!;
    for (const cl of c) writeCluster(f, u, k++, cl, base + cl.indexStart, [group, block, surface, cl.piece]);
  }
  return words;
}

/**
 * The instanced parts' clusters as the instance cull reads them
 * (`InstanceTables.clusters`): the same record, its first index into the
 * stream's source and its range in the place of a group, and its part's
 * first vertex beside it.
 */
function scatterClusterWords(clusters: ScatterStream["clusters"]): ArrayBuffer {
  const words = new ArrayBuffer(Math.max(1, clusters.length) * CLUSTER_WORDS * 4);
  const f = new Float32Array(words);
  const u = new Uint32Array(words);
  clusters.forEach(({ cluster, first, range, base }, k) => writeCluster(f, u, k, cluster, first, [range, base, 0, 0]));
  return words;
}

/**
 * Cluster `k` as `CULL_DECLARATIONS`' `Cluster`: its box and its first index
 * and count, its four `refs`, and its sway.
 */
function writeCluster(
  f: Float32Array,
  u: Uint32Array,
  k: number,
  cl: Cluster,
  first: number,
  refs: readonly [number, number, number, number],
): void {
  const o = k * CLUSTER_WORDS;
  f[o] = cl.lo[0];
  f[o + 1] = cl.lo[1];
  f[o + 2] = cl.lo[2];
  u[o + 3] = first;
  f[o + 4] = cl.hi[0];
  f[o + 5] = cl.hi[1];
  f[o + 6] = cl.hi[2];
  u[o + 7] = cl.indexCount;
  for (let r = 0; r < 4; r++) u[o + 8 + r] = refs[r];
  f[o + 12] = cl.ramp;
  u[o + 13] = cl.rigged ? 1 : 0;
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
