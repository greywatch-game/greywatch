/**
 * render/WorldBlocks.ts — The static world as our renderer draws it in the
 * frame's main pass: the BLOCKS, cut into clusters, culled on the GPU and
 * drawn with ONE plain draw per material over its whole range, the survivors
 * at the front and triangles of no area after them (`BABYLON_EXIT.md`
 * X3.3b); the SCATTER, instances of its variants culled over their
 * clusters on the GPU and drawn with ONE indirect draw per material over the
 * survivors' list (X3.4b, folded at X3.5b); and the LANDFORM, the floor's
 * patches, the rim's runs and the map-wide road merge, cut, culled and drawn
 * as the blocks are, after them (X3.5) — every draw through the one pulled
 * vertex stage (`celVertex.ts`), which reads its record off the index
 * (`scatterList.ts`). And, since X3.6a, the same map as the world's shadow
 * maps record it (`WorldDepth`, which it builds at the cut over the same
 * tables): every surface and instanced part carries the shadow passes it is
 * drawn in, and the CASTERS no main pass of ours draws — the emissive
 * palette's — are held here for the shadow maps alone (`addCaster`). And,
 * since X3.6c, the map as a reflection probe's faces draw it (`probeView`):
 * every taken surface and part in `PASS_PROBE`, and the emissive palette
 * HELD for it with its slots (`addEmissive`), drawn there by its own program
 * (`render/emissiveWorld.ts`).
 * Owns: `WorldBlocks` — the surfaces and the scatter's instanced parts handed
 * to it until the map is cut (`finish`), then each material GROUP's vertex
 * arrays (every instanced part of the group end to end, then every surface of
 * it), its pipeline, its material block and bind group and its geometry bind
 * group (group 2); the instances' transforms, which every group's group 2
 * binds; each variant's two modules (assembled once); the `ClusterCull` that
 * writes the blocks' indices and the `InstanceCull` that writes the
 * scatter's list, whose tables, transforms and budget the cut's scatter
 * half makes (`scatterCut.ts`); and the one `FrameDraw`, ahead of group 0's
 * alpha-tested meshes (`DrawPoint` `"beforeAlphaTest"`) — the blocks, the
 * scatter, then the landform — with the `FramePrepare` that culls ahead of
 * it, both on the renderer only while a map's culls are built and nobody has
 * `stop`ped it; and the map's `WorldDepth`, when `finish` is asked for one; each held
 * palette material's block and groups; the probes' VIEWS of the culls
 * (`probeView`) while their holder keeps them, and with the map at the latest.
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
 * their group or their scatter; the CASTERS are one group of no recipe, its
 * arrays the positions alone, drawn in no main pass and cut LAST, so the main
 * pass's cull leaves its clusters out as a tail (`count`) — and so are the
 * held palette groups, one a material, positions and slots; a probe's view
 * culls every cluster and draws what is in `PASS_PROBE` with the main pass's
 * own pipelines and material groups, through the face's frame, each
 * scattered group's twin bound to its own list — the draw code is ONE
 * (`drawClusters`, `drawScatter`, `bind`, over a `DrawView`), never a copy;
 * the layers share
 * ONE cut, one set of cull tables, one cluster list and one index buffer
 * each cull view writes, each group drawing only its own range of it, and
 * the scatter's list gives each group a run of its own; its
 * vertex arrays are uploaded once as Babylon uploads a mesh's (floats as
 * `float32`, a `Float64Array` rounded exactly as Babylon's `Float32Array` of
 * the same numbers is), an attribute a surface lacks but its variant reads
 * being 0 for every one of its vertices — what Babylon's empty vertex buffer
 * reads — with its instanced parts FIRST, each scatter cluster carrying where
 * its part starts (`scatterList.ts`), and its block indices once, rebased
 * onto the arrays, as the source the cull copies the survivors from;
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
 * what the list can name or a part past the 16-bit source — draws
 * nothing at all and hands every surface of
 * it back, since half of a recipe would be a hole where Babylon draws the
 * other half (and Babylon's blocks still hold the scatter we would have cut);
 * a surface it will never draw — its group failed, or a cull did, or the cut
 * is past the device's limits — is handed to `onFailed` in the turn that
 * failure lands, never held for the map's other compiles, so whoever took it
 * can give it back at once; the map's `WorldDepth` is built only when every
 * group with a shadow pass is still whole at the cut — a map whose casters
 * already went back draws its shadows on Babylon's side, and a depth nobody
 * will use is not built; a material's block is re-copied from its recipe
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
 * draw has no index buffer and is a `drawIndirect` at the group's own
 * arguments, its group's vertex stage the scatter twin, whose group 2 binds
 * the cull's list and source as well (`celVertex.ts`'s `celGeometry`);
 * every group with no scatter keeps the plain stage.
 */
import { CEL_MATERIAL_BLOCK, CEL_MATERIAL_TEXTURES, type CelRecipe } from "./celMaterial";
import { celFragment } from "./celFragment";
import { celGeometry, celVertex } from "./celVertex";
import {
  type BlockBox,
  ClusterCull,
  createCullInputs,
  type CullDiagnostics,
  type CullInputs,
  frameInputs,
  NO_DIAGNOSTICS,
  type ReachGate,
  type ScanRange,
} from "./ClusterCull";
import { type Cluster, cutClusters, type PieceSpan, type SurfaceArrays, toFloat32, withoutPieces } from "./clusters";
import { EMISSIVE_ATTRIBUTES, EMISSIVE_BLOCK, EMISSIVE_GEOMETRY, emissiveWorld, type EmissiveRecipe } from "./emissiveWorld";
import type { FrameUniforms } from "./frame";
import { HostBindGroup } from "./HostBindGroup";
import { InstanceCull } from "./InstanceCull";
import type { PassTiming } from "./PassTimer";
import type { BuiltPipeline } from "./PipelineCache";
import type { ProbeWorld } from "./ProbeBake";
import type { FrameContext, Renderer } from "./Renderer";
import {
  type InstancedPart,
  type InstanceSet,
  listPast,
  partRecords,
  type ScatterCut,
  ScatterTables,
  sourcePast,
  uploadTransforms,
} from "./scatterCut";
import { listStride } from "./scatterList";
import { FRAME_TARGETS } from "./targets";
import { UniformBlockBuffer } from "./UniformBlockBuffer";
import { type AssembledAttribute, type AssembledModule, type AssembledVertex, PULLED_ATTRIBUTES } from "./wgsl/assemble";
import { CLUSTER_WORDS, NO_BLOCK, PASS_PROBE, SHADOW_PASSES, writeCluster } from "./wgsl/clusterCull";
import { INDIRECT_BYTES } from "./wgsl/instanceCull";
import { type DepthGroup, WorldDepth } from "./WorldDepth";

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

/** A palette material's GPU half (`EmissiveRecipe`): its block's buffer and its group 1. */
interface EmissiveSlot {
  readonly recipe: EmissiveRecipe;
  readonly block: UniformBlockBuffer;
  readonly group: HostBindGroup;
}

/** One variant's two modules. */
interface Program {
  readonly vertex: AssembledVertex;
  readonly fragment: AssembledModule;
  /** The list's stride its vertex stage was built for — the scatter twin — or null for the plain stage. */
  readonly stride: number | null;
}

/** A surface as handed over, held until the map is cut. */
interface Surface {
  geometry: SurfaceArrays;
  pieces: readonly PieceSpan[];
  /** The passes it is drawn in beside the main one (`PASS_CASTS`, `PASS_SOLID`, `PASS_LAMPS`, `PASS_PROBE`). */
  readonly passes: number;
  /** Its block (`blockKey`), which a probe's view leaves out by; `NO_BLOCK` for the landform. */
  readonly key: number;
}

/**
 * Which layer a group is in: the blocks, drawn first, or the landform — or
 * the HELD surfaces, drawn in no main pass: the casters held for the shadow
 * maps alone (`addCaster`) and the emissive palette held for the probes'
 * bake and its own shadows (`addEmissive`), whose groups are always cut last.
 */
type WorldLayer = "blocks" | "landform" | "casters";

/** What a caster held for the shadow maps alone reads: its positions. */
const CASTER_ATTRIBUTES: readonly AssembledAttribute[] = [{ name: "position", type: "vec3f", from: "positionData" }];

/** One material's draws in one layer: its instanced parts' arrays end to end, its surfaces' after them. */
interface Group {
  readonly layer: WorldLayer;
  /** Its recipe's GPU half; null for the held groups, which no main pass draws. */
  readonly material: MaterialSlot | null;
  /** A held palette group's material, which a probe's face draws it with; null for every other group. */
  readonly emissive: EmissiveSlot | null;
  /**
   * Its variant: chosen when the group is made, and its scatter twin chosen
   * at `finish` for a group drawing scatter; null for the casters.
   */
  program: Program | null;
  /** What its arrays hold: its vertex stage's attributes, a caster's positions alone, or a palette surface's positions and slots. */
  readonly attributes: readonly AssembledAttribute[];
  /** Indices into `surfaces`, in the order added. */
  readonly members: number[];
  /** Its instanced parts, in the order added; emptied at `finish`. */
  instanced: InstancedPart[];
  /** Why it cannot draw its scatter, if an instanced part lacked what its variant reads: it goes back at `finish`. */
  withheld: string | null;
  /** Its storage arrays, in the vertex program's attribute order; empty until `finish`. */
  arrays: GPUBuffer[];
  /** Group 2: its arrays and the instances' transforms (a palette group's, for the probes' bake); null until `finish`. */
  geometry: HostBindGroup | null;
  /** Its range of the cluster cull's indices, `[indexBase, indexBase + indexCount)` — what its block draw covers. */
  indexBase: number;
  indexCount: number;
  /** It draws scatter: its run of the instance cull's list, at its own arguments. */
  scattered: boolean;
  built: BuiltPipeline | null;
  /** It draws nothing, and its members went back. */
  failed: boolean;
  /** The passes beside the main one its surfaces, and its instanced parts, are drawn in, together. */
  surfacePasses: number;
  scatterPasses: number;
}

/** Which of a surface's arrays an attribute is read from. */
const SOURCE: Readonly<Record<string, keyof SurfaceArrays>> = {
  position: "positions",
  normal: "normals",
  color: "colors",
  uv: "uvs",
  uv2: "uvs2",
};

/** One surface as the cut left it: its group, where its indices start, its clusters, its passes and its block. */
interface CutSurface {
  readonly surface: number;
  readonly group: number;
  readonly base: number;
  readonly c: readonly Cluster[];
  readonly passes: number;
  readonly key: number;
}

/**
 * What one VIEW of the map draws through: its cluster cull's survivors, its
 * instance cull's list and arguments, and each group's geometry for it — the
 * main pass's own, or a probe's, whose scatter twins bind its list.
 */
interface DrawView {
  readonly cull: ClusterCull;
  readonly instances: InstanceCull | null;
  /** By group: its group 2 in this view. */
  readonly geometry: readonly (HostBindGroup | null)[];
}

/** A view's group 0, made against the layout a pipeline was built with; null while a texture is unpublished. */
type FrameGroup = (layout: GPUBindGroupLayout) => GPUBindGroup | null;

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
  /** The scatter's records: what the list holds at most. */
  records: number;
  /** Each group's vertices, in group order. */
  readonly vertices: number[];
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
  /**
   * Each layer's groups by recipe: one recipe in both layers is two groups;
   * the casters' is keyed on none and each held palette material's on its
   * recipe.
   */
  private readonly groupOf: Record<WorldLayer, Map<CelRecipe | EmissiveRecipe | null, Group>> = {
    blocks: new Map(),
    landform: new Map(),
    casters: new Map(),
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
  /** The main pass's view of the culls, once built. */
  private mainView: DrawView | null = null;
  /** The probes' views standing (`probeView`), disposed with the map at the latest — ahead of the culls they read. */
  private readonly probeViews = new Set<ProbeWorld>();
  /** The map as the shadow maps record it, when `finish` was asked for it. */
  private worldDepth: WorldDepth | null = null;
  /** The main pass's cull inputs, refilled every frame. */
  private readonly inputs = createCullInputs();
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
  /** The corners a survivor's run takes in the scatter's draw (`listStride`). */
  private readonly stride: number;

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
    this.stride = listStride(options.triangles);
  }

  /** Draws issued last frame — what a census of the main pass adds to Babylon's. */
  get drawn(): number {
    return this.drawnLast;
  }

  /**
   * The map as the world's shadow maps record it (`WorldShadows`) — built by
   * `finish` when asked; null before, without the ask, and after `clear`.
   */
  get depth(): WorldDepth | null {
    return this.worldDepth;
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
   * meshes (see the header) — and in the shadow passes `passes` names; its
   * index is the surface's, for `onFailed`. Its arrays are READ at `finish`,
   * so they must stand until then.
   */
  add(
    label: string,
    geometry: SurfaceArrays,
    recipe: CelRecipe,
    pieces: readonly PieceSpan[],
    landform: boolean,
    passes: number,
    key: number = NO_BLOCK,
  ): number {
    return this.addTo(this.groupFor(recipe, landform ? "landform" : "blocks"), label, geometry, pieces, passes, key);
  }

  /**
   * Hands over one surface our side draws in NO main pass — a caster whose
   * material keeps no recipe, the emissive palette's — so that the shadow
   * passes `passes` names are drawn whole by our side: its positions alone
   * are uploaded, and cut after every other group's. Its index is the
   * surface's, as `add`'s.
   */
  addCaster(label: string, geometry: SurfaceArrays, pieces: readonly PieceSpan[], passes: number, key: number = NO_BLOCK): number {
    return this.addTo(this.groupFor(null, "casters"), label, geometry, pieces, passes, key);
  }

  /**
   * Hands over one surface of the emissive PALETTE (its material's `recipe`),
   * which no main pass of ours draws: held with its positions and its slots,
   * cut after every other group's, for the passes `passes` names — a probe's
   * faces (`PASS_PROBE`, drawn by `render/emissiveWorld.ts`) and any shadow
   * pass it casts in. Its index is the surface's, as `add`'s.
   */
  addEmissive(
    label: string,
    geometry: SurfaceArrays,
    pieces: readonly PieceSpan[],
    recipe: EmissiveRecipe,
    passes: number,
    key: number,
  ): number {
    return this.addTo(this.groupFor(recipe, "casters"), label, geometry, pieces, passes, key);
  }

  private addTo(
    group: Group,
    label: string,
    geometry: SurfaceArrays,
    pieces: readonly PieceSpan[],
    passes: number,
    key: number,
  ): number {
    const missing = missingAttribute(group, geometry);
    if (missing) throw new Error(`world blocks: "${label}" has no ${missing}, which its variant reads`);
    const at = this.surfaces.length;
    this.surfaces.push({ geometry, pieces, passes, key });
    group.members.push(at);
    group.surfacePasses |= passes;
    this.surfaceCount = this.surfaces.length;
    return at;
  }

  /**
   * Hands over one part of instance set `set` (`ScatterCut.sets`), drawn with
   * `recipe` once per surviving instance, and in the shadow passes `passes`
   * names. Its arrays are READ at `finish`. A part lacking what its variant
   * reads cannot be drawn while its pieces are cut out of the blocks, so its
   * whole group goes back at `finish`.
   */
  addInstanced(set: number, label: string, geometry: SurfaceArrays, recipe: CelRecipe, passes: number): void {
    const group = this.groupFor(recipe, "blocks");
    const missing = missingAttribute(group, geometry);
    if (missing) group.withheld ??= `its instanced part "${label}" has no ${missing}, which its variant reads`;
    else {
      group.instanced.push({ geometry, set, passes });
      group.scatterPasses |= passes;
    }
  }

  /**
   * Cuts the map: what will never draw handed back, every group's arrays
   * uploaded and its pipeline asked for, every surface cut into clusters —
   * the scatter's pieces cut out of it first, where its group draws them as
   * instances — every instanced part cut into clusters too, and the culls
   * built. `blocks[s]` is surface `s`'s REACH box — its block's, as the
   * frame's mesh walk files it, or the one box of no reach every landform
   * surface is handed (`WorldCulling.reachBoxOf`); surfaces of one box share
   * the object. With `shadowSlots`, the map as that many shadow maps record
   * it in one submit is built too (`depth`), over the same tables — unless a
   * group with a shadow pass went back before the cut, when the map's
   * shadows are not ours to draw.
   */
  finish(blocks: readonly BlockBox[], scatter: ScatterCut | null = null, shadowSlots = 0): void {
    const surfaces = this.surfaces;
    if (blocks.length !== surfaces.length) throw new Error("world blocks: a block for every surface");
    // Nothing taken (an editor build, a map of loose surfaces): no cull, and
    // no instance either — Babylon draws every recipe whole.
    if (surfaces.length === 0) return;
    const device = this.renderer.device;
    const sets = scatter?.sets ?? [];
    // The casters last, so the main pass's cull can leave their clusters out
    // as a tail (`drawn` below). A stable sort keeps every other group's order.
    this.groups.sort((a, b) => Number(a.layer === "casters") - Number(b.layer === "casters"));

    // A recipe Babylon draws whole draws its scatter whole with it: a group
    // with no surface of ours keeps none of its instanced parts.
    for (const group of this.groups) {
      if (group.members.length > 0) continue;
      group.instanced = [];
      group.withheld = null;
    }
    this.handBack();
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

    this.transforms = uploadTransforms(device, sets);
    const indices = new Uint32Array(size.indices);
    const cut: CutSurface[] = [];
    const ranges: ScanRange[] = [];
    const scatterTables = new ScatterTables(sets, size.source, this.options.triangles);
    const at: CutCursor = { index: 0, cluster: 0 };
    // The clusters the main pass culls: every group's but the casters'.
    let drawn = 0;
    this.groups.forEach((group, g) => {
      const start = at.cluster;
      group.indexBase = at.index;
      // The instanced parts first, each cluster carrying where its part
      // starts. A group handed back keeps its place in both culls' tables,
      // empty — so range `g` of each is group `g`'s.
      const parts = scatterTables.add(group.instanced);
      // It draws scatter only if a record is its, so a group that does has
      // an instance cull to bind (a part of no triangle makes no record). A
      // failed group makes none: `fail` emptied its instanced parts.
      group.scattered = parts.records > 0;
      if (!group.failed) this.cutGroup(group, g, parts.vertices, size.vertices[g], indices, at, cut);
      ranges.push({ start, end: at.cluster, base: group.indexBase });
      group.indexCount = at.index - group.indexBase;
      if (group.layer !== "casters") drawn = at.cluster;
    });

    const clusterCount = at.cluster;
    this.clusterCount = clusterCount;
    const bands = this.options.nearBands;
    const bands2 = [bands[0] * bands[0], bands[1] * bands[1], bands[2] * bands[2]];
    const boxes = uniqueBoxes(blocks);
    const main = { label: "main pass", slots: 1 };
    this.cull = new ClusterCull(
      device,
      this.renderer.pipelines,
      { clusters: clusterWords(cut, blocks, boxes), clusterCount, blocks: boxes, spheres, groups: ranges, indices, bands2 },
      { ...main, count: drawn },
      this.diagnostics,
    );
    const ready: Promise<boolean>[] = [this.cull.ready];
    if (scatterTables.recordCount > 0) {
      const tables = scatterTables.tables(bands2);
      this.instanceCount = tables.instanceCount;
      this.setCount = tables.sets.length;
      this.instances = new InstanceCull(device, this.renderer.pipelines, tables, this.stride, main, this.diagnostics);
      ready.push(this.instances.ready);
    }
    // Group 2 and the pipelines last, once the list a group's scatter reads
    // exists. The casters have neither: no main pass draws them. A palette
    // group's group 2 is made here for the probes' bake, whose view asks for
    // its pipeline (`probeView`).
    for (const group of this.groups) {
      if (group.failed) continue;
      if (group.emissive) {
        this.emissiveGeometryOf(group);
        continue;
      }
      if (!group.material) continue;
      if (group.scattered) group.program = this.programOf(group.material.recipe.defines, this.stride);
      this.geometryOf(group);
      this.ask(group);
    }
    this.mainView = { cull: this.cull, instances: this.instances, geometry: this.groups.map((g) => g.geometry) };
    const casterLost = this.groups.some((g) => g.failed && ((g.surfacePasses | g.scatterPasses) & SHADOW_PASSES) !== 0);
    if (shadowSlots > 0 && !casterLost) {
      this.worldDepth = new WorldDepth(
        this.renderer,
        this.cull,
        this.instances,
        this.depthGroups(),
        this.transforms,
        clusterCount,
        this.stride,
        shadowSlots,
      );
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
   * and records, each group's vertices — or null when the blocks' indices or a
   * group's widest array (four floats a vertex) are past the device's limits.
   * A LIST past what an index can name, or past them, hands back only the
   * groups that draw scatter: a denser forest should cost Babylon the
   * scatter's recipes, not the map.
   */
  private measure(sets: readonly InstanceSet[]): CutSize | null {
    const limits = this.renderer.device.limits;
    const storage = Math.min(limits.maxStorageBufferBindingSize, limits.maxBufferSize);
    let size = this.sizes(sets);
    const past = listPast(size.records, this.options.triangles, storage);
    if (past) {
      for (const group of this.groups) {
        if (group.instanced.length === 0) continue;
        this.fail(group, past);
      }
      size = this.sizes(sets);
    }
    let widest = 0;
    for (const vertices of size.vertices) widest = Math.max(widest, vertices * 16);
    return Math.max(size.indices * 4, widest) > storage ? null : size;
  }

  /** `measure`'s count, over the groups not handed back. */
  private sizes(sets: readonly InstanceSet[]): CutSize {
    const size: CutSize = { indices: 0, source: 0, records: 0, vertices: [] };
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
        size.records += partRecords(p, sets, this.options.triangles);
      }
      size.vertices.push(vertices);
    }
    return size;
  }

  /**
   * Group `g`'s arrays uploaded, its surfaces' indices rebased past its
   * `vertexBase` instanced vertices and cut into clusters at `at`; its group 2
   * and its pipeline wait for `finish` to have built the culls.
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
    group.arrays = group.attributes.map((a) => this.attributeArray(group, a.name, a.type, vertexTotal));
    let vertex = vertexBase;
    for (const s of group.members) {
      const surface = this.surfaces[s];
      const geo = surface.geometry;
      const positions = toFloat32(geo.positions);
      const local = geo.indices;
      for (let i = 0; i < local.length; i++) indices[at.index + i] = local[i] + vertex;
      const clusters = cutClusters(positions, local, geo.colors, surface.pieces, this.options.triangles);
      cut.push({ surface: s, group: g, base: at.index, c: clusters, passes: surface.passes, key: surface.key });
      at.cluster += clusters.length;
      at.index += local.length;
      vertex += positions.length / 3;
    }
    for (const b of group.arrays) b.unmap();
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
    for (const { material, emissive } of this.groups) {
      material?.block.write(material.recipe.values);
      emissive?.block.write(emissive.recipe.values);
    }
  }

  /** Drops every surface, group and material: the map they were is gone. */
  clear(): void {
    this.generation++;
    for (const g of this.groups) {
      for (const b of g.arrays) b.destroy();
      g.material?.block.destroy();
      g.emissive?.block.destroy();
    }
    this.transforms?.destroy();
    this.transforms = null;
    this.unhook?.();
    this.unhook = null;
    // Ahead of the culls, whose tables their views read.
    this.worldDepth?.dispose();
    this.worldDepth = null;
    for (const view of this.probeViews) view.dispose();
    this.probeViews.clear();
    this.mainView = null;
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
    this.groupOf.casters.clear();
    this.drawnLast = 0;
  }

  dispose(): void {
    this.clear();
  }

  /**
   * The group of `recipe` in `layer`, made on its first surface or part. One
   * recipe's groups at the two layers share its program (assembled once a
   * variant) and each own a material slot, as each owns its arrays. The
   * casters are one group, of no recipe; each palette material held is one,
   * of its own.
   */
  private groupFor(recipe: CelRecipe | EmissiveRecipe | null, layer: WorldLayer): Group {
    if (this.cull) throw new Error("world blocks: a surface added after the map was cut");
    const of = this.groupOf[layer];
    let group = of.get(recipe);
    if (!group) {
      const cel = recipe && "defines" in recipe ? recipe : null;
      const emissive = recipe && !("defines" in recipe) ? this.emissiveOf(recipe) : null;
      const program = cel ? this.programOf(cel.defines) : null;
      group = {
        layer,
        material: cel ? this.materialOf(cel) : null,
        emissive,
        program,
        attributes: program ? program.vertex.attributes : emissive ? EMISSIVE_ATTRIBUTES : CASTER_ATTRIBUTES,
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
        surfacePasses: 0,
        scatterPasses: 0,
      };
      of.set(recipe, group);
      this.groups.push(group);
    }
    return group;
  }

  /**
   * Hands back, before anything is cut or uploaded, every group that could
   * not draw its scatter: one with an instanced part it withheld, and one
   * with a part the 16-bit source cannot index, past `SOURCE_VERTICES`
   * (`scatterList.ts`). What the list can name is `measure`'s.
   */
  private handBack(): void {
    for (const group of this.groups) {
      if (group.withheld) {
        this.fail(group, group.withheld);
        continue;
      }
      const past = sourcePast(group.instanced);
      if (past) this.fail(group, past);
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
            `world blocks: ${labelOf(group)} cut ${cutIndices} scatter indices ` +
              `out of its blocks and draws ${drawn} as instances (BABYLON_EXIT.md X3.4b)`,
          );
        }
      }
    }
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
      `world blocks: ${labelOf(group)} ${why}; ` +
        `its ${group.members.length} surfaces go back to Babylon`,
      ...(err === undefined ? [] : [err]),
    );
    this.onFailed(group.members);
  }

  /** One attribute's array for the whole group, MAPPED, filled part by part, then surface by surface. */
  private attributeArray(group: Group, name: string, type: string, vertexTotal: number): GPUBuffer {
    const floats = PULLED_ATTRIBUTES[type].floats;
    const buffer = this.renderer.device.createBuffer({
      label: `world blocks: ${labelOf(group)} ${name}`,
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

  /**
   * Group 2 for `group`: its arrays by the storage each attribute is read out
   * of, and the transforms — and the instance cull's list and source for the
   * scatter twin.
   */
  private geometryOf(group: Group): void {
    const program = group.program!;
    const defines = group.material!.recipe.defines;
    const buffers: Record<string, GPUBuffer> = { transforms: this.transforms! };
    group.attributes.forEach((a, k) => {
      buffers[a.from] = group.arrays[k];
    });
    const stride = program.stride;
    if (stride !== null) {
      buffers.scatterList = this.instances!.list;
      buffers.scatterSource = this.instances!.source;
    }
    const label = `world blocks: ${labelOf(group)} geometry`;
    const entries = celGeometry(stride);
    group.geometry = new HostBindGroup(this.renderer.device, label, entries, defines, buffers);
    // No textures: resolved once, whole for good.
    group.geometry.refresh(this.renderer.host, {});
  }

  /** Asks for a group's pipeline; a failure hands every member back, at once. */
  private ask(group: Group): void {
    const recipe = group.material!.recipe;
    const program = group.program!;
    const generation = this.generation;
    this.renderer.pipelines
      .get({
        vertex: program.vertex,
        vertexEntry: "main",
        fragment: program.fragment,
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

  /** The two modules of the variant `defines` — its vertex stage the scatter twin given a stride — assembled once. */
  private programOf(defines: readonly string[], stride: number | null = null): Program {
    const key = `${defines.join("+")}${stride === null ? "" : ` scatter ${stride}`}`;
    let program = this.programs.get(key);
    if (!program) {
      program = {
        vertex: celVertex(defines, FRAME_TARGETS, stride),
        fragment: celFragment(defines, FRAME_TARGETS),
        stride,
      };
      this.programs.set(key, program);
    }
    return program;
  }

  /** A palette material's block and group 1, as `materialOf` makes a cel recipe's. */
  private emissiveOf(recipe: EmissiveRecipe): EmissiveSlot {
    const device = this.renderer.device;
    const label = `world blocks: emissive [bias ${recipe.depthBias}]`;
    const block = new UniformBlockBuffer(device, EMISSIVE_BLOCK, [], label);
    block.write(recipe.values);
    const group = new HostBindGroup(device, label, [EMISSIVE_BLOCK], [], { [EMISSIVE_BLOCK.var]: block.buffer });
    // No textures: resolved once, whole for good.
    group.refresh(this.renderer.host, {});
    return { recipe, block, group };
  }

  /** A held palette group's group 2 — its positions, its slots and the transforms — for the probes' bake. */
  private emissiveGeometryOf(group: Group): void {
    const buffers: Record<string, GPUBuffer> = { transforms: this.transforms! };
    group.attributes.forEach((a, k) => {
      buffers[a.from] = group.arrays[k];
    });
    group.geometry = new HostBindGroup(this.renderer.device, `world blocks: ${labelOf(group)} geometry`, EMISSIVE_GEOMETRY, [], buffers);
    group.geometry.refresh(this.renderer.host, {});
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

  /**
   * Each group as the shadow maps draw it (`WorldDepth`), in group order: a
   * group handed back draws in none, its arrays never uploaded.
   */
  private depthGroups(): DepthGroup[] {
    const out: DepthGroup[] = [];
    this.groups.forEach((group, g) => {
      if (group.failed) return;
      const positions = group.arrays[group.attributes.findIndex((a) => a.name === "position")];
      out.push({
        label: labelOf(group),
        positions,
        indexBase: group.indexBase,
        indexCount: group.indexCount,
        surfacePasses: group.surfacePasses,
        scatterRange: group.scattered ? g : -1,
        scatterPasses: group.scatterPasses,
      });
    });
    return out;
  }

  /** As the main pass begins: this frame's culls, ahead of the draws. */
  private readonly prepare = (
    frame: FrameUniforms,
    encoder: GPUCommandEncoder,
    timing: PassTiming | null,
  ): void => {
    if (!this.culling) return;
    frameInputs(frame, this.gate, this.inputs);
    this.cull?.dispatch(this.inputs, encoder, timing);
    this.instances?.dispatch(this.inputs, encoder, timing);
  };

  /**
   * Ahead of group 0's alpha-tested meshes: the blocks, the scatter, then the
   * landform, so the floor behind what stands on it fails the depth test
   * before it shades (see the header).
   */
  private readonly draw = (pass: GPURenderPassEncoder, ctx: FrameContext): void => {
    let drawn = 0;
    const view = this.mainView;
    if (this.culling && view) {
      const frame = ctx.frameGroup;
      drawn = this.drawClusters(pass, frame, view, "blocks", true) + this.drawScatter(pass, frame, view);
      drawn += this.drawClusters(pass, frame, view, "landform", true);
    }
    this.drawnLast = drawn;
  };

  /**
   * A second VIEW of the map's culls for a reflection probe's faces, `slots`
   * of them a submit (`render/ProbeBake.ts`, `BABYLON_EXIT.md` X3.6c): every
   * cluster in `PASS_PROBE` — the taken surfaces and the palette held for it
   * — culled for a face and drawn with the main pass's own pipelines and
   * material groups through the face's frame, each scattered group's twin
   * bound to this view's list, then the palette with its own program
   * (`render/emissiveWorld.ts`). Null before the map is cut. Disposed by
   * whoever holds it, and with the map at the latest.
   */
  probeView(slots: number): ProbeWorld | null {
    const main = this.cull;
    const mainView = this.mainView;
    if (!main || !mainView || !this.transforms) return null;
    const device = this.renderer.device;
    const pipelines = this.renderer.pipelines;
    const named = { label: "probes", slots };
    const clusters = new ClusterCull(device, pipelines, main, { ...named, count: this.clusterCount });
    const instances = this.instances ? new InstanceCull(device, pipelines, this.instances, this.stride, named) : null;
    const geometry = this.groups.map((group, g) => {
      const program = group.program;
      if (!group.scattered || !instances || group.failed || !group.material || !program || program.stride === null) {
        return mainView.geometry[g];
      }
      const buffers: Record<string, GPUBuffer> = { transforms: this.transforms!, scatterList: instances.list, scatterSource: instances.source };
      group.attributes.forEach((a, k) => {
        buffers[a.from] = group.arrays[k];
      });
      const bound = new HostBindGroup(
        device,
        `world blocks: ${labelOf(group)} probe geometry`,
        celGeometry(program.stride),
        group.material.recipe.defines,
        buffers,
      );
      bound.refresh(this.renderer.host, {});
      return bound;
    });
    const view: DrawView = { cull: clusters, instances, geometry };
    // The palette's pipeline, by its material's depth bias.
    const emissive = new Map<number, BuiltPipeline | null>();
    const asks: Promise<boolean>[] = [clusters.ready];
    if (instances) asks.push(instances.ready);
    const program = emissiveWorld(FRAME_TARGETS);
    for (const group of this.groups) {
      if (!group.emissive || group.failed) continue;
      const bias = group.emissive.recipe.depthBias;
      if (emissive.has(bias)) continue;
      emissive.set(bias, null);
      asks.push(
        pipelines
          .get({
            vertex: program.vertex,
            vertexEntry: "main",
            fragment: program.fragment,
            fragmentEntry: "main",
            targets: FRAME_TARGETS,
            state: bias === 0 ? undefined : { depthBias: bias },
          })
          .then(
            (built) => {
              emissive.set(bias, built);
              return true;
            },
            (err: unknown) => {
              console.error("world blocks: the emissive palette's pipeline did not build; the probes' bake goes back to Babylon", err);
              return false;
            },
          ),
      );
    }
    let disposed = false;
    const world: ProbeWorld = {
      ready: Promise.all(asks).then(
        (oks) => !disposed && oks.every(Boolean),
        () => false,
      ),
      drawable: (group0) => this.drawableIn(group0, view, emissive),
      cull: (inputs: CullInputs, encoder: GPUCommandEncoder, slot: number) => {
        clusters.dispatch(inputs, encoder, null, slot);
        instances?.dispatch(inputs, encoder, null, slot);
      },
      draw: (pass, group0) => {
        // In the order groups were first added, the biased ones with them —
        // Babylon's bake's order, which a face's far horizon reads: see
        // `drawClusters`.
        this.drawClusters(pass, group0, view, "blocks", false);
        this.drawScatter(pass, group0, view);
        this.drawClusters(pass, group0, view, "landform", false);
        this.drawHeld(pass, group0, view, emissive);
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        this.probeViews.delete(world);
        clusters.dispose();
        instances?.dispose();
      },
    };
    this.probeViews.add(world);
    return world;
  }

  /**
   * Whether every group with something in `PASS_PROBE` can draw in `view`
   * NOW — its pipeline built, its three groups whole — so a face is never
   * recorded with a group missing from it.
   */
  private drawableIn(group0: FrameGroup, view: DrawView, emissive: ReadonlyMap<number, BuiltPipeline | null>): boolean {
    const groups = this.groups;
    for (let g = 0; g < groups.length; g++) {
      const group = groups[g];
      if (group.failed || ((group.surfacePasses | group.scatterPasses) & PASS_PROBE) === 0) continue;
      if (group.emissive) {
        if (group.indexCount === 0) continue;
        const built = emissive.get(group.emissive.recipe.depthBias);
        if (!built || !group0(built.groups[0]) || !group.emissive.group.get(built.groups[1])) return false;
        if (!group.geometry?.get(built.groups[2])) return false;
        continue;
      }
      const material = group.material;
      if (!material) return false;
      if (group.indexCount === 0 && !group.scattered) continue;
      const built = group.built;
      if (!built) return false;
      material.group.refresh(this.renderer.host, material.recipe.textures);
      if (!group0(built.groups[0]) || !material.group.get(built.groups[1])) return false;
      if (!view.geometry[g]?.get(built.groups[2])) return false;
    }
    return true;
  }

  /**
   * Binds `group`'s pipeline and its three groups — `geometry` being its
   * group 2 in the view drawing it; false, binding nothing, while its
   * pipeline is compiling, it failed, or a texture it binds is unpublished.
   */
  private bind(pass: GPURenderPassEncoder, group0: FrameGroup, group: Group, geometry: HostBindGroup | null): boolean {
    const built = group.built;
    const material = group.material;
    if (!built || group.failed || !geometry || !material) return false;
    material.group.refresh(this.renderer.host, material.recipe.textures);
    const frame = group0(built.groups[0]);
    const own = material.group.get(built.groups[1]);
    const bound = geometry.get(built.groups[2]);
    if (!frame || !own || !bound) return false;
    pass.setPipeline(built.pipeline);
    pass.setBindGroup(0, frame);
    pass.setBindGroup(1, own);
    pass.setBindGroup(2, bound);
    return true;
  }

  /**
   * The surfaces of `layer`'s groups in `view`: one plain draw a group over
   * its whole range of the view's indices — with `biasedFirst` the groups
   * whose recipe carries a depth BIAS first (the roads), then the rest in
   * the order first added; without it, all of them in that order.
   *
   * Near the eye the bias decides which surface wins, never the order, so
   * the picture is the same either way and the order decides what is SHADED.
   * Drawn after the floor, every road pixel was the bumped floor shaded and
   * then painted over; drawn first, the floor under a road fails the depth
   * test before it shades. Measured at X3.5 on Cinderhaven
   * (`BABYLON_EXIT.md`): about half the landform's rise at a road crossing,
   * most of it in the town. The main pass draws biased first for that.
   *
   * **At a grazing FAR horizon the bias no longer separates them and the
   * order does decide** — measured in a probe's face on Sarab (X3.6c): 14
   * texels of road at the horizon where Babylon's bake, which drew the floor
   * first, has sand, and 0 with the roads drawn in group order. A bake is a
   * build step, where shading is not what is paid for, so a probe's view
   * draws in group order (`biasedFirst` false) and its horizon is Babylon's.
   */
  private drawClusters(
    pass: GPURenderPassEncoder,
    group0: FrameGroup,
    view: DrawView,
    layer: "blocks" | "landform",
    biasedFirst: boolean,
  ): number {
    let drawn = 0;
    const groups = this.groups;
    const n = groups.length;
    pass.setIndexBuffer(view.cull.indices, "uint32");
    // Twice over the groups: the biased ones on the first lap, the rest on the
    // second — or once, in order.
    for (let lap = biasedFirst ? 0 : n; lap < 2 * n; lap++) {
      const g = lap % n;
      const group = groups[g];
      const material = group.material;
      if (group.layer !== layer || !material) continue;
      if (biasedFirst && (material.recipe.depthBias !== 0) !== (lap < n)) continue;
      // A group whose surfaces were all scatter draws only its list.
      if (group.indexCount === 0 || !this.bind(pass, group0, group, view.geometry[g])) continue;
      pass.drawIndexed(group.indexCount, 1, group.indexBase, 0, 0);
      drawn++;
    }
    return drawn;
  }

  /** The scatter in `view`: one indirect draw a group that has any, over its survivors' runs, unindexed. */
  private drawScatter(pass: GPURenderPassEncoder, group0: FrameGroup, view: DrawView): number {
    const instances = view.instances;
    if (!instances) return 0;
    let drawn = 0;
    const groups = this.groups;
    for (let g = 0; g < groups.length; g++) {
      if (!groups[g].scattered || !this.bind(pass, group0, groups[g], view.geometry[g])) continue;
      pass.drawIndirect(instances.args, g * INDIRECT_BYTES);
      drawn++;
    }
    return drawn;
  }

  /**
   * The emissive palette held for the probes' bake, in `view`: one plain
   * draw a palette group over its range of the view's indices, with its own
   * program (`emissive`, by its material's bias) — drawn by no main pass.
   */
  private drawHeld(
    pass: GPURenderPassEncoder,
    group0: FrameGroup,
    view: DrawView,
    emissive: ReadonlyMap<number, BuiltPipeline | null>,
  ): void {
    const groups = this.groups;
    pass.setIndexBuffer(view.cull.indices, "uint32");
    for (let g = 0; g < groups.length; g++) {
      const group = groups[g];
      const own = group.emissive;
      if (!own || group.failed || group.indexCount === 0) continue;
      const built = emissive.get(own.recipe.depthBias);
      if (!built) continue;
      const frame = group0(built.groups[0]);
      const material = own.group.get(built.groups[1]);
      const geometry = group.geometry?.get(built.groups[2]);
      if (!frame || !material || !geometry) continue;
      pass.setPipeline(built.pipeline);
      pass.setBindGroup(0, frame);
      pass.setBindGroup(1, material);
      pass.setBindGroup(2, geometry);
      pass.drawIndexed(group.indexCount, 1, group.indexBase, 0, 0);
    }
  }
}

/** How a group is named in a label or a message: its recipe's defines, a palette material, or the casters. */
function labelOf(group: Group): string {
  if (group.material) return `[${group.material.recipe.defines.join("+")}]`;
  return group.emissive ? `[emissive, bias ${group.emissive.recipe.depthBias}]` : "[casters]";
}

/** The first attribute `group`'s variant reads that `geometry` lacks, or null; an absent `uv` reads 0. */
function missingAttribute(group: Group, geometry: SurfaceArrays): string | null {
  for (const a of group.attributes) {
    if (!geometry[SOURCE[a.name]] && a.name !== "uv") return a.name;
  }
  return null;
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
  for (const { surface, group, base, c, passes, key } of cut) {
    const block = blockIds.get(blocks[surface])!;
    for (const cl of c) writeCluster(f, u, k++, cl, base + cl.indexStart, [group, block, surface, cl.piece], passes, key);
  }
  return words;
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
