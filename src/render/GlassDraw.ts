/**
 * render/GlassDraw.ts — A round's GLAZING as OUR renderer draws it
 * (`BABYLON_EXIT.md` X4.6e): every block's merged glass, the `paneblock*`
 * meshes on a `CEL_GLASS` material that Babylon drew until X4.6e, one draw
 * for one — the `backed` sheets nearest first ahead of everything of ours at
 * `"beforeAlphaTest"` (where Babylon's opaque list drew them), the
 * see-through ones in the one back-to-front run (`FarthestRun`).
 * Owns: `GlassDraw` — the four pipelines (backed and see-through, each in
 * either winding), asked once for the session; a round's vertices, indices
 * and each surface's world matrix on the GPU, from `finish` to `clear`; the
 * surfaces (`surfaces`, each a `GlassSurface`), each one's material — its
 * probe's recipe, a block, and a group binding its cube where the bake left
 * it (`point`) — the pull it asks inside the render, the backed sheets' order
 * this frame (`backedOrder`, which the pull writes, as it writes each
 * see-through surface's `kept` and `key`), the CPU copy of every range a break
 * may rewrite and the write of one (`collapse`, `writePositions`), the refusal
 * listeners it holds while installed, and what it drew last (`stats`);
 * `GlassSurface`, `GlassGeometry`.
 * Invariants: it DECIDES NOTHING — which surface is drawn this frame (its
 * block's cell offered, the size gate, the frustum) and in what order are the
 * pull's (`Game.glassPull`, asked once a frame after every prepare that is not
 * late, and ahead of the run's, which files the see-through surfaces it
 * kept: `FarthestRun`), what a group wears is
 * `ReflectionSystem`'s (`point`), and whether a pane is broken is
 * `GlassSystem`'s, told through `GlassFx`; a surface is drawn under its OWN
 * world matrix, as its mesh's `world` uniform held it — a group of one
 * `PaneBlocks` takes as it stands is not at identity, and its positions are
 * local to that matrix — in the winding Babylon gave it (a negative
 * determinant turns the mesh, `PipelineState.reversed`); a vertex's
 * attributes are uploaded as Babylon uploaded a mesh's (float32, a `color` or
 * `uv` a surface does not carry reading what Babylon's one-float empty buffer
 * read, widened: (0, 0, 0, 1) and (0, 0)); the cube is the bake's and is read
 * through a view of its own over every face and level, sampled as
 * `wrapCubeTexture`'s view was (trilinear, anisotropic 4, the wrap its
 * coordinates mode gave: repeat); a pane's depth bias is pipeline state
 * (`GLASS_DEPTH_UNITS`), and a see-through one writes no depth and blends
 * as Babylon's `ALPHA_COMBINE` (colour `SRC_ALPHA, ONE_MINUS_SRC_ALPHA`,
 * alpha `ONE, ONE`), its alpha the coverage the ink reads; a frame with a
 * pipeline unbuilt draws no pane; a pipeline that FAILS is the round's
 * failure (`install`'s), and so is a refused main pass while it is
 * installed — never inside the render's commands (the caller defers it,
 * `Game.worldFailed`); a frame allocates nothing past a group's first bind.
 * Never: imports Babylon; reads a node or a camera; casts a shadow, or draws
 * in a bake, the lamps' atlas or the glow's mask (no pane was in any of
 * them); destroys a cube, which is the bake's; draws while not installed (the
 * menu).
 * Contract: `docs/rendering.md`, "The glazing: the one thing here that is not
 * opaque" and "Our renderer's frame".
 *
 * WHAT A DRAW BINDS, by group: 0 the frame (`Renderer`'s), 1 the surface's
 * material and its cube, 2 the round's arrays through the placed cel stage
 * (`celPlacedVertex`), which reads `world` at the draw's instance — the
 * surface's slot in `transforms`; a draw is `drawIndexed` over the surface's
 * own indices, its first vertex the draw's base vertex.
 */
import { CEL_MATERIAL_BLOCK, CEL_MATERIAL_TEXTURES, type CelRecipe } from "./celMaterial";
import { celFragment } from "./celFragment";
import { CEL_GEOMETRY, celPlacedVertex, PLACED_WORDS } from "./celVertex";
import { HostBindGroup, OwnTexture } from "./HostBindGroup";
import type { BuiltPipeline, PipelineState } from "./PipelineCache";
import type { FrameContext, Renderer } from "./Renderer";
import { FRAME_TARGETS } from "./targets";
import { UniformBlockBuffer } from "./UniformBlockBuffer";

/** One glazing surface's vertices, as the build holds them. */
export interface GlassGeometry {
  readonly positions: ArrayLike<number>;
  readonly normals: ArrayLike<number>;
  readonly colors: ArrayLike<number> | null;
  readonly uvs: ArrayLike<number> | null;
  readonly indices: ArrayLike<number>;
}

/** A surface's world bounding sphere, its record's: the numbers its mesh's bounding info held. */
export interface GlassSphere {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
}

/** What a pointed surface binds: its probe's block and its group 1. */
interface GlassMaterial {
  readonly block: UniformBlockBuffer;
  readonly group: HostBindGroup;
  readonly handles: { readonly reflectionCube: OwnTexture };
}

/** One draw: a glazing group, its range of the round's arrays, and what it wears. */
export class GlassSurface {
  /** What `point` gave it: null until then, and then it draws nothing. */
  material: GlassMaterial | null = null;
  /**
   * This frame's, for a SEE-THROUGH surface: drawn (`kept`) and its distance
   * from the eye (`key`), which the pull writes and the back-to-front run
   * files it by (`FarthestRun`).
   */
  kept = false;
  key = 0;

  constructor(
    /** What its mesh was called (`paneblock<key>-<material>`): a label. */
    readonly name: string,
    /** Its index in the build's surface list: what names its record and its `PaneGroup`. */
    readonly record: number,
    /** Written depth on Babylon's opaque list, or blended on its transparent one. */
    readonly backed: boolean,
    /** Its world matrix turns it inside out (a negative determinant). */
    readonly reversed: boolean,
    /** Its indices in the round's index buffer, and its first vertex in the arrays. */
    readonly first: number,
    readonly count: number,
    readonly baseVertex: number,
    readonly vertices: number,
    /** Its slot in `transforms`: the draw's instance. */
    readonly slot: number,
    /** The block whose cell offers it (`WorldCulling.offersBlock`). */
    readonly block: string,
    readonly sphere: GlassSphere,
    /** Its positions as uploaded, while a break may rewrite them (`updatable`); else null. */
    readonly positions: Float32Array<ArrayBuffer> | null,
  ) {}
}

/** `ALPHA_COMBINE`'s factors (Babylon's `alphaCullingState`, mode 2): a see-through pane's. */
const SEE_THROUGH_BLEND: GPUBlendState = {
  color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
};

/** The four pipelines: backed or see-through, each in either winding. */
interface Pipelines {
  backed: BuiltPipeline | null;
  backedReversed: BuiltPipeline | null;
  seeThrough: BuiltPipeline | null;
  seeThroughReversed: BuiltPipeline | null;
}

const BACKED_DEFINES = ["CEL_GLASS", "CEL_GLASS_BACKED"] as const;
const SEE_THROUGH_DEFINES = ["CEL_GLASS"] as const;

/** What a pending surface uploads at `finish`. */
interface Pending {
  readonly geometry: GlassGeometry;
  readonly world: Float32Array;
}

export class GlassDraw {
  /** Whether every pipeline built — asked once, for the session; false if one failed. */
  readonly ready: Promise<boolean>;
  /** What the last frame drew: backed sheets, see-through ones. Nothing in the game reads it; a profiler capture does (`ProfileReport.pools.glass`) and the census. */
  readonly stats = { backed: 0, seeThrough: 0 };
  /** The round's surfaces, in the order the build made them: the order their meshes were born in. */
  readonly surfaces: GlassSurface[] = [];
  /** Which backed surfaces this frame draws, nearest first (`surfaces`' indices): the pull writes it. */
  backedOrder = new Int32Array(0);
  /** The pull's scratch: each drawn backed surface's distance from the eye, squared. */
  backedKeys = new Float64Array(0);
  /** How many of `backedOrder` this frame draws: the pull writes it. */
  backedDraws = 0;

  private readonly device: GPUDevice;
  private readonly pipelines: Pipelines = { backed: null, backedReversed: null, seeThrough: null, seeThroughReversed: null };
  /** As `wrapCubeTexture`'s view sampled: trilinear, anisotropic, and the wrap its coordinates mode gives. */
  private readonly cubeSampler: GPUSampler;

  private readonly pending: Pending[] = [];
  private positionBuffer: GPUBuffer | null = null;
  private indexBuffer: GPUBuffer | null = null;
  private owned: GPUBuffer[] = [];
  private geometry: HostBindGroup | null = null;
  private vertexCount = 0;
  private indexCount = 0;

  private committed = false;
  /** This frame's verdict: committed, built, a round loaded. */
  private ours = false;
  /** What the run drew last, so a run of panes binds only what changes. */
  private bound: BuiltPipeline | null = null;
  private worn: GlassMaterial | null = null;

  private removes: (() => void)[] = [];
  private isInstalled = false;
  private failed: (reason: string) => void = ignore;
  private generation = 0;

  constructor(
    private readonly renderer: Renderer,
    /** Asked inside the render, once a frame: writes the backed order and each see-through surface's verdict and key. */
    private readonly pull: (into: GlassDraw) => void,
  ) {
    const device = renderer.device;
    this.device = device;
    this.cubeSampler = device.createSampler({
      label: "glass: mirror",
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "repeat",
      addressModeV: "repeat",
      addressModeW: "repeat",
      maxAnisotropy: 4,
    });
    const ask = (defines: readonly string[], state: PipelineState, put: (b: BuiltPipeline) => void, label: string) =>
      renderer.pipelines
        .get({
          vertex: celPlacedVertex(defines, FRAME_TARGETS),
          vertexEntry: "main",
          fragment: celFragment(defines, FRAME_TARGETS),
          fragmentEntry: "main",
          targets: FRAME_TARGETS,
          state,
        })
        .then(
          (built) => {
            put(built);
            return true;
          },
          (err: unknown) => {
            console.error(`glass: the ${label} pipeline did not build; no pane can be drawn`, err);
            return false;
          },
        );
    // `GLASS_DEPTH_UNITS`, which the factory's recipe states and `point` checks.
    const bias = GLASS_DEPTH_BIAS;
    const backed: PipelineState = { depthBias: bias };
    const seeThrough: PipelineState = { depthBias: bias, depthWrite: false, blend: SEE_THROUGH_BLEND };
    const p = this.pipelines;
    this.ready = Promise.all([
      ask(BACKED_DEFINES, backed, (b) => (p.backed = b), "backed"),
      ask(BACKED_DEFINES, { ...backed, reversed: true }, (b) => (p.backedReversed = b), "backed (reversed)"),
      ask(SEE_THROUGH_DEFINES, seeThrough, (b) => (p.seeThrough = b), "see-through"),
      ask(SEE_THROUGH_DEFINES, { ...seeThrough, reversed: true }, (b) => (p.seeThroughReversed = b), "see-through (reversed)"),
    ]).then((oks) => oks.every(Boolean));
  }

  /** Whether a frame is owed: what the backed draw's and the run's predicates ask. */
  get active(): boolean {
    return this.committed;
  }

  /** Whether this frame draws at all: the prepare's verdict, which the pulls read. */
  get drawing(): boolean {
    return this.ours;
  }

  /** Whether a round's install stands — false on the menu. */
  get installed(): boolean {
    return this.isInstalled;
  }

  /**
   * A surface for the round, its arrays read at `finish`: `world` is its mesh's
   * world matrix (`Matrix.m`, sixteen float32), `sphere` its record's world
   * sphere, `updatable` whether a break may rewrite its positions.
   */
  add(
    name: string,
    record: number,
    geometry: GlassGeometry,
    world: ArrayLike<number>,
    backed: boolean,
    sphere: GlassSphere,
    block: string,
    updatable: boolean,
  ): GlassSurface {
    const m = Float32Array.from(world);
    const vertices = geometry.positions.length / 3;
    const surface = new GlassSurface(
      name,
      record,
      backed,
      determinant(m) < 0,
      this.indexCount,
      geometry.indices.length,
      this.vertexCount,
      vertices,
      this.surfaces.length,
      block,
      sphere,
      updatable ? Float32Array.from(geometry.positions) : null,
    );
    this.pending.push({ geometry, world: m });
    this.vertexCount += vertices;
    this.indexCount += geometry.indices.length;
    this.surfaces.push(surface);
    return surface;
  }

  /** Uploads what was added: the round's panes draw from the next frame on, each once `point`ed. */
  finish(): void {
    const device = this.device;
    const n = Math.max(1, this.vertexCount);
    const positions = new Float32Array(n * 3);
    const normals = new Float32Array(n * 3);
    // What Babylon's empty vertex buffer read for a mesh with none: ONE
    // float32 0, which WebGPU widens to (0, 0, 0, 1) and (0, 0).
    const colors = new Float32Array(n * 4);
    const uvs = new Float32Array(n * 2);
    const indices = new Uint32Array(Math.max(1, this.indexCount));
    const transforms = new Float32Array(Math.max(1, this.surfaces.length) * PLACED_WORDS);
    for (let i = 0; i < this.pending.length; i++) {
      const { geometry, world } = this.pending[i];
      const s = this.surfaces[i];
      positions.set(geometry.positions, s.baseVertex * 3);
      normals.set(geometry.normals, s.baseVertex * 3);
      if (geometry.colors) colors.set(geometry.colors, s.baseVertex * 4);
      else for (let v = 0; v < s.vertices; v++) colors[(s.baseVertex + v) * 4 + 3] = 1;
      if (geometry.uvs) uvs.set(geometry.uvs, s.baseVertex * 2);
      indices.set(geometry.indices, s.first);
      transforms.set(world, s.slot * PLACED_WORDS);
    }
    this.pending.length = 0;
    const buffer = (label: string, data: ArrayBufferView<ArrayBuffer>, usage: number): GPUBuffer => {
      const made = device.createBuffer({
        label: `glass: ${label}`,
        size: Math.max(16, Math.ceil(data.byteLength / 4) * 4),
        usage,
        mappedAtCreation: true,
      });
      new Uint8Array(made.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      made.unmap();
      this.owned.push(made);
      return made;
    };
    this.positionBuffer = buffer("positions", positions, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.indexBuffer = buffer("indices", indices, GPUBufferUsage.INDEX);
    this.geometry = new HostBindGroup(device, "glass: geometry", CEL_GEOMETRY, SEE_THROUGH_DEFINES, {
      positionData: this.positionBuffer,
      normalData: buffer("normals", normals, GPUBufferUsage.STORAGE),
      colorData: buffer("colours", colors, GPUBufferUsage.STORAGE),
      uvData: buffer("uvs", uvs, GPUBufferUsage.STORAGE),
      transforms: buffer("transforms", transforms, GPUBufferUsage.STORAGE),
    });
    // No textures: resolved once, whole for good.
    this.geometry.refresh({});
    this.backedOrder = new Int32Array(this.surfaces.length);
    this.backedKeys = new Float64Array(this.surfaces.length);
  }

  /**
   * What `surface` wears from the next frame on: `recipe` (a glazing variant
   * whose bias is the panes' — anything else is REFUSED, as a compile in play
   * would be) and `cube`, the bake's, read where it lies. Its block is written
   * once: a probe's values are fixed for the install.
   */
  point(surface: GlassSurface, recipe: CelRecipe, cube: GPUTexture): void {
    const backed = recipe.defines.includes("CEL_GLASS_BACKED");
    if (!recipe.defines.includes("CEL_GLASS") || backed !== surface.backed || recipe.depthBias !== GLASS_DEPTH_BIAS) {
      throw new Error(`GlassDraw: "${surface.name}" was pointed at a recipe of [${recipe.defines.join("+")}] at ${recipe.depthBias}, which no pipeline of the glazing draws`);
    }
    const defines = backed ? BACKED_DEFINES : SEE_THROUGH_DEFINES;
    const old = surface.material;
    if (old) old.block.destroy();
    const label = `glass: ${surface.name}`;
    const block = new UniformBlockBuffer(this.device, CEL_MATERIAL_BLOCK, defines, label);
    block.write(recipe.values);
    const reflectionCube = new OwnTexture();
    reflectionCube.view = cube.createView({ label, dimension: "cube" });
    reflectionCube.sampler = this.cubeSampler;
    const group = new HostBindGroup(this.device, label, [CEL_MATERIAL_BLOCK, ...CEL_MATERIAL_TEXTURES], defines, {
      [CEL_MATERIAL_BLOCK.var]: block.buffer,
    });
    const handles = { reflectionCube };
    group.refresh(handles);
    surface.material = { block, group, handles };
  }

  /**
   * A copy of `count` vertices' positions of `surface` from `first` — what a
   * range held before a break rewrites it (the reference harness's stash):
   * null for a surface no break may write.
   */
  readPositions(surface: GlassSurface, first: number, count: number): Float32Array | null {
    const p = surface.positions;
    return p ? p.slice(first * 3, (first + count) * 3) : null;
  }

  /**
   * Writes `values` over `surface`'s positions from vertex `first`, on the
   * CPU copy and on the GPU — lands before the next submit, so the next frame
   * draws it, as `updateVerticesData` wrote a mesh's. A no-op on a surface no
   * break may write. Allocates nothing.
   */
  writePositions(surface: GlassSurface, first: number, values: Float32Array): void {
    const p = surface.positions;
    const buffer = this.positionBuffer;
    if (!p || !buffer) return;
    p.set(values, first * 3);
    this.device.queue.writeBuffer(buffer, (surface.baseVertex + first) * 12, p, first * 3, values.length);
  }

  /**
   * A pane's `count` vertices from `first` collapsed onto the first of them,
   * so every triangle of it is degenerate and rasterises nothing — `GlassFx`'s
   * break, as its `updateVerticesData` wrote the mesh. Allocates nothing.
   */
  collapse(surface: GlassSurface, first: number, count: number): void {
    const p = surface.positions;
    const buffer = this.positionBuffer;
    if (!p || !buffer || count <= 0) return;
    const base = first * 3;
    const x = p[base];
    const y = p[base + 1];
    const z = p[base + 2];
    for (let v = 1; v < count; v++) {
      const o = base + v * 3;
      p[o] = x;
      p[o + 1] = y;
      p[o + 2] = z;
    }
    this.device.queue.writeBuffer(buffer, (surface.baseVertex + first) * 12, p, base, count * 3);
  }

  /** The round's glazing goes: nothing is drawn or counted until the next `finish`. Every cube stays the bake's. */
  clear(): void {
    for (const buffer of this.owned) buffer.destroy();
    this.owned = [];
    for (const s of this.surfaces) s.material?.block.destroy();
    this.surfaces.length = 0;
    this.pending.length = 0;
    this.positionBuffer = null;
    this.indexBuffer = null;
    this.geometry = null;
    this.vertexCount = 0;
    this.indexCount = 0;
    this.backedDraws = 0;
    this.committed = false;
    this.ours = false;
    this.stats.backed = 0;
    this.stats.seeThrough = 0;
  }

  /**
   * Draws the round's backed sheets from the next frame on, at
   * `"beforeAlphaTest"` — the caller installs this AHEAD of everything else of
   * ours at that point, where Babylon's opaque list drew them — and its
   * see-through ones through the run (`FarthestRun`), telling `failed` if they
   * cannot be: a pipeline that failed (now or for the session already), or
   * the main pass refused. Replaces any earlier install's failure.
   */
  install(failed: (reason: string) => void): void {
    this.uninstall();
    this.failed = failed;
    const generation = ++this.generation;
    void this.ready.then((ok) => {
      if (!ok && generation === this.generation) failed("the glazing cannot draw: a pipeline of its failed");
    });
    const renderer = this.renderer;
    this.removes.push(
      renderer.onFrame(this.prepare),
      // Late, so every draw's prepare has given its verdict on this frame;
      // installed ahead of the run's (`FarthestRun`), which reads `kept`.
      renderer.onFrame(this.late, true),
      renderer.add(this.drawBacked, "beforeAlphaTest", this.hasBacked),
      renderer.onRefused(this.refused),
    );
    this.isInstalled = true;
  }

  /** Draws nothing again until the next `install`, and tells nobody of anything. */
  uninstall(): void {
    this.generation++;
    for (const remove of this.removes) remove();
    this.removes.length = 0;
    this.isInstalled = false;
    this.failed = ignore;
    this.backedDraws = 0;
    this.committed = false;
    this.ours = false;
    this.stats.backed = 0;
    this.stats.seeThrough = 0;
  }

  /** This frame draws: the order asked inside the render. */
  commit(): void {
    if (!this.isInstalled || this.surfaces.length === 0) return;
    this.committed = true;
    // This frame's, from here: a frame `Renderer.begin` skips runs neither the
    // prepare nor the draw that would reset it.
    this.stats.backed = 0;
    this.stats.seeThrough = 0;
  }

  dispose(): void {
    this.uninstall();
    this.clear();
  }

  /**
   * One see-through surface (`surfaces` index `i`) in the run's order; `fresh`
   * when something else of the run drew last, so everything is bound afresh.
   */
  drawSeeThrough(pass: GPURenderPassEncoder, ctx: FrameContext, i: number, fresh: boolean): void {
    if (!this.ours) return;
    if (fresh) {
      this.bound = null;
      this.worn = null;
    }
    const surface = this.surfaces[i];
    const p = this.pipelines;
    if (this.drawOne(pass, ctx, surface, surface.reversed ? p.seeThroughReversed! : p.seeThrough!)) this.stats.seeThrough++;
  }

  private readonly hasBacked = (): boolean => this.committed;

  /** The backed sheets, nearest first, ahead of everything of ours at this point. */
  private readonly drawBacked = (pass: GPURenderPassEncoder, ctx: FrameContext): void => {
    if (!this.ours) return;
    this.bound = null;
    this.worn = null;
    const order = this.backedOrder;
    const surfaces = this.surfaces;
    const p = this.pipelines;
    let drawn = 0;
    for (let d = 0; d < this.backedDraws; d++) {
      const surface = surfaces[order[d]];
      if (this.drawOne(pass, ctx, surface, surface.reversed ? p.backedReversed! : p.backed!)) drawn++;
    }
    this.stats.backed += drawn;
  };

  /** One surface: its pipeline and groups only where they change. False if it could not be drawn. */
  private drawOne(pass: GPURenderPassEncoder, ctx: FrameContext, surface: GlassSurface, built: BuiltPipeline): boolean {
    const material = surface.material;
    if (!material) return false;
    if (built !== this.bound) {
      const frame = ctx.frameGroup(built.groups[0]);
      const arrays = this.geometry!.get(built.groups[2]);
      // A texture of the frame's not published: nothing of ours draws.
      if (!frame || !arrays) return false;
      pass.setPipeline(built.pipeline);
      pass.setBindGroup(0, frame);
      pass.setBindGroup(2, arrays);
      pass.setIndexBuffer(this.indexBuffer!, "uint32");
      this.bound = built;
      this.worn = null;
    }
    if (material !== this.worn) {
      const group = material.group.get(built.groups[1]);
      if (!group) return false;
      pass.setBindGroup(1, group);
      this.worn = material;
    }
    pass.drawIndexed(surface.count, 1, surface.first, surface.baseVertex, surface.slot);
    return true;
  }

  /** As the main pass begins — inside the render, the camera placed: this frame's verdict. */
  private readonly prepare = (): void => {
    const committed = this.committed;
    this.committed = false;
    this.stats.backed = 0;
    this.stats.seeThrough = 0;
    this.backedDraws = 0;
    const surfaces = this.surfaces;
    for (let i = 0; i < surfaces.length; i++) surfaces[i].kept = false;
    const p = this.pipelines;
    this.ours =
      committed &&
      this.geometry !== null &&
      p.backed !== null &&
      p.backedReversed !== null &&
      p.seeThrough !== null &&
      p.seeThroughReversed !== null;
  };

  /** After every prepare: this frame's order and verdicts, asked of the pull. */
  private readonly late = (): void => {
    if (this.ours) this.pull(this);
  };

  /** `Renderer.onRefused`: the main pass drew nothing of ours, these included. */
  private readonly refused = (): void => {
    if (this.ours) this.failed("the main pass was refused, so no pane can be drawn");
  };
}

/**
 * `CelMaterialFactory.GLASS_DEPTH_UNITS`: the panes' bias in the depth
 * buffer's own units — a fact of the glazing's, which the recipe states and
 * `point` refuses any other.
 */
export const GLASS_DEPTH_BIAS = -16;

/** A world matrix's determinant (`Matrix.m`'s layout), whose sign is the mesh's winding. */
function determinant(m: Float32Array): number {
  const a = m[0], b = m[1], c = m[2];
  const d = m[4], e = m[5], f = m[6];
  const g = m[8], h = m[9], i = m[10];
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

/** A failure with nobody to tell: not installed. */
function ignore(): void {}
