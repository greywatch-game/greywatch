/**
 * render/PoolDraw.ts — The effect POOLS' pieces as OUR renderer draws them
 * (`BABYLON_EXIT.md` X4.4b): the tracers, the spent cases, the thrown frags
 * and bottles, the rockets in flight and the laid mines in one draw of these,
 * the bullet marks in another — each pool's kits on the GPU once, each
 * frame's pieces as INSTANCES of them, drawn into the frame's main pass (the
 * cel segments with the cel program, the unlit ones with the emissive
 * palette's) and the unlit ones again into the glow's mask. X4.1d's shape
 * (`BodyDraw`) for things that never fade, by the bodies' own programs.
 * Owns: `PoolDraw` — the kits' arrays (every segment of every kit end to end,
 * each kit's segment ranges as the cel program and the emissive one draw
 * them, and the indices rebased onto the arrays), the instances' kits,
 * segment orders, matrices and bloom colours on the GPU and the staging
 * arrays a frame writes them into (`kits`, `matrices`; the orders and the
 * bloom, which it PULLS), both materials' blocks and groups, the pipelines —
 * the cel one at the cel recipe's depth bias, and the emissive one and its
 * mask twin only for a draw with an unlit segment (asked once, for the
 * session) — the main-pass draw, the mask draw, the prepare that uploads a
 * frame, a DYNAMIC draw's rewrite of a kit's vertices (`rewrite`: the glass
 * shards, each cut afresh, `BABYLON_EXIT.md` X4.4c), the refusal listeners
 * it holds while installed (and whether it is, `installed`), and what it drew
 * last (`stats`); `PoolSegment`, `PoolKit`, `PoolMaterials`, `PoolPull`.
 * Three draws are built of it: the pieces', the marks' (X4.4b) and the
 * DEBRIS's — every glass shard and rubble chunk (X4.4c).
 * Invariants: it DECIDES NOTHING — which pieces are drawn, in what pose, in
 * what order, which of their segments, at what bloom and with what material
 * are its caller's (`Game.drawPieces`, `Game.drawMarks` and
 * `Game.drawDebris`, off the pools' own switches, `WorldCulling`'s size gate per cel segment, the eye and
 * `GlowRules`), handed over once a frame (`commit`) and pulled once inside
 * the render (`pull`, in the prepare: the order and the bloom, off the camera
 * the render placed — and, for a pull that orders the INSTANCES themselves,
 * their matrices and kits, which it may write there), and drawn on that
 * frame, nothing else; a draw is one RANK of every piece at once — each
 * piece's `r`th segment in its own order (`bodyProgram.ts`) — the ranks in
 * order, so a piece's segments are drawn in the order it hands over, as
 * Babylon's front-to-back queue drew a pool's meshes, and within a rank the
 * pieces in instance order — the cel segments of a rank one draw, the unlit
 * segments of a rank another, only where some piece has an unlit segment at
 * that rank; a kit narrower than the widest is the widest with its missing
 * segments empty; a rank's draw runs to the longest range any piece draws at
 * it, the rest of its corners drawn as nothing, and a rank of nothing draws
 * nothing; the mask's draws are the unlit ranks again, by the same vertex
 * module, no depth written, LEQUAL against the depth the main pass wrote; the
 * draws go into the main pass at `"beforeAlphaTest"`, where Babylon's opaque
 * queue — the pools' meshes among it until X4.4b — had already drawn, AHEAD
 * of the hulls', the bodies' and the world's (installed before them), as that
 * queue was; the mask's into
 * that pass ahead of everything of Babylon's and after the palette's and the
 * visors' (`installMask`, asked after theirs: `Renderer.addGlowMask` keeps
 * the order added); the arrays are uploaded as Babylon uploaded a mesh's
 * (float32 — `Float32Array.set` rounds a double to nearest; a `color` or
 * `uv` a segment does not carry reading what Babylon's one-float empty
 * vertex buffer read, widened: (0, 0, 0, 1) and (0, 0)) — and a rewrite as
 * Babylon's `updateVerticesData` wrote a mesh's, the indices untouched; a
 * material's block
 * is re-copied from its recipe only when the caller's epoch moves; a frame
 * with a pipeline unbuilt or a texture unpublished draws no piece, as a
 * Babylon material not ready drew none; a pipeline that FAILS is the round's
 * failure (`install`'s), told every round after it too, and so is a refused
 * main pass or mask while it is installed — never inside the render's
 * commands (the caller defers it, `Game.worldFailed`); nothing here allocates
 * on a frame.
 * Never: imports Babylon; reads a node, a piece or a material; draws while
 * not installed (an editor build, the menu).
 * Contract: `docs/rendering.md`, "The pools, ours".
 */
import { CEL_MATERIAL_BLOCK, CEL_MATERIAL_TEXTURES, type CelRecipe } from "./celMaterial";
import { EMISSIVE_BLOCK, EMISSIVE_BLOCK_DEFINES, type EmissiveRecipe } from "./emissiveWorld";
import { BODY_CEL_DEFINES, BODY_GEOMETRY, BODY_GLOW, bodyPrograms } from "./bodyProgram";
import type { PassTargets } from "./frameHost";
import { HostBindGroup } from "./HostBindGroup";
import type { BuiltPipeline, PipelineState } from "./PipelineCache";
import type { FrameContext, Renderer } from "./Renderer";
import { FRAME_TARGETS, GLOW_TARGETS } from "./targets";
import { UniformBlockBuffer } from "./UniformBlockBuffer";
import type { AssembledModule, AssembledVertex } from "./wgsl/assemble";

/** One segment of a kit: one mesh of the pool it was until X4.4b, in its own frame. */
export interface PoolSegment {
  /** xyz a vertex. */
  readonly positions: ArrayLike<number>;
  readonly normals: ArrayLike<number> | null;
  /** rgba a vertex, or null for a segment that carries none. */
  readonly colors: ArrayLike<number> | null;
  /** uv a vertex, or null. */
  readonly uvs: ArrayLike<number> | null;
  readonly indices: ArrayLike<number>;
  /**
   * Its paint's 1-based slot: in the cel recipe's palette for a cel segment,
   * in the emissive recipe's table for an unlit one.
   */
  readonly slot: number;
  /** Drawn by the emissive palette's program, and into the mask. */
  readonly unlit: boolean;
}

/** One kit: its segments, in the order a piece's matrices are written. */
export interface PoolKit {
  readonly segments: readonly PoolSegment[];
}

/** What a draw's pieces are drawn WITH, as the factory states it. */
export interface PoolMaterials {
  /** The cel segments': the palette its own (`BODY_CEL_DEFINES`), and its depth bias the pipeline's. */
  readonly cel: CelRecipe;
  /** The unlit segments' — each colour a slot — or null for a draw with none. */
  readonly unlit: EmissiveRecipe | null;
}

/**
 * What the prepare pulls inside the render, for this frame's first `n`
 * pieces: each one's segments in the order they are drawn into `order` (a
 * segment index a rank, `segments` a piece), and — when `glowOn` — each
 * piece's unlit segment's bloom into `glow` (rgb, alpha). It may also write
 * the pieces' `matrices` and `kits`, for a caller that orders the INSTANCES
 * off the camera the render placed.
 */
export type PoolPull = (order: Uint32Array, glow: Float32Array, n: number, glowOn: boolean) => void;

/** Floats in one piece's matrices a segment. */
const MATRIX_FLOATS = 16;

export class PoolDraw {
  /** Segments a piece: the widest kit's. */
  readonly segments: number;
  /** The most pieces one frame may draw. */
  readonly capacity: number;
  /**
   * This frame's pieces' matrices, written by the caller before `commit` (or
   * in its pull): piece `i`'s segment `s` at `(i * segments + s) * 16`,
   * `Matrix.m`'s layout, all zero for a segment it does not show.
   */
  readonly matrices: Float32Array<ArrayBuffer>;
  /** This frame's pieces' kits, by the order `kits` was handed, written before `commit` (or in the pull). */
  readonly kits: Uint32Array<ArrayBuffer>;
  /** Whether every pipeline built — asked once, for the session; false if one failed. */
  readonly ready: Promise<boolean>;
  /**
   * What the last frame drew: main-pass draws, mask draws, instances. Nothing
   * in the game reads it; a profiler capture does (`ProfileReport.pools`) and
   * the census.
   */
  readonly stats = { drawn: 0, masked: 0, instances: 0 };

  private readonly device: GPUDevice;
  /** Which segment of each kit is unlit, kit-major. */
  private readonly unlit: Uint8Array;
  /** Each kit's index count a segment, kit-major: what a rank's span is the longest of. */
  private readonly counts: Uint32Array;
  /** Each kit's segments' first vertex in the arrays and their vertex counts, kit-major: what `rewrite` writes over. */
  private readonly firstVertex: Uint32Array;
  private readonly vertexCount: Uint32Array;
  private readonly positionBuffer: GPUBuffer;
  private readonly normalBuffer: GPUBuffer;
  /** Whether `rewrite` may write the arrays (the constructor's `dynamic`). */
  private readonly dynamic: boolean;
  private readonly celSpan: number;
  private readonly unlitSpan: number;
  private readonly owned: GPUBuffer[] = [];
  private readonly orderBuffer: GPUBuffer;
  private readonly matrixBuffer: GPUBuffer;
  private readonly glowBuffer: GPUBuffer;
  private readonly geometry: HostBindGroup;
  private readonly celBlock: UniformBlockBuffer;
  private readonly celGroup: HostBindGroup;
  private readonly unlitBlock: UniformBlockBuffer | null;
  private readonly unlitGroup: HostBindGroup | null;
  private readonly glowGroup: HostBindGroup | null;
  private cel: BuiltPipeline | null = null;
  private emissive: BuiltPipeline | null = null;
  private mask: BuiltPipeline | null = null;
  /** Whether any kit has an unlit segment — the emissive pipeline and its mask asked only then. */
  private readonly hasUnlit: boolean;

  /** The pulled orders, a piece's `segments` ranks apiece. */
  private readonly order: Uint32Array<ArrayBuffer>;
  /** What `bodyOrder` is uploaded from: a piece's kit, then its order — `segments + 1` apiece. */
  private readonly upload: Uint32Array<ArrayBuffer>;
  private readonly glow: Float32Array<ArrayBuffer>;
  /** This frame's draws a rank: the cel span (0, none) and whether an unlit segment is drawn there. */
  private readonly rankSpan: Uint32Array;
  private readonly rankUnlit: Uint8Array;

  private pending = false;
  private instances = 0;
  private glowOn = false;
  /** This frame's draws include one for the mask. */
  private anyUnlit = false;
  /** The materials' epoch as last copied; NaN is never. */
  private epoch = Number.NaN;
  /** This frame's verdict: committed, built, uploaded. */
  private ours = false;

  /** What `install` and `installMask` registered, which `uninstall` takes back. */
  private removes: (() => void)[] = [];
  private isInstalled = false;
  private failed: (reason: string) => void = ignore;
  private generation = 0;

  constructor(
    private readonly renderer: Renderer,
    /** Names the draw in a failure and its buffers' labels: "pieces", "marks". */
    private readonly name: string,
    kits: readonly PoolKit[],
    private readonly materials: PoolMaterials,
    capacity: number,
    private readonly pull: PoolPull,
    /**
     * Whether a kit's positions and normals may be REWRITTEN after the
     * upload (`rewrite`) — the glass shards, each cut afresh from its pane
     * (`BABYLON_EXIT.md` X4.4c).
     */
    dynamic = false,
  ) {
    const device = renderer.device;
    this.device = device;
    let segments = 0;
    for (const kit of kits) segments = Math.max(segments, kit.segments.length);
    this.segments = Math.max(1, segments);
    this.capacity = Math.max(1, capacity);
    this.matrices = new Float32Array(this.capacity * this.segments * MATRIX_FLOATS);
    this.kits = new Uint32Array(this.capacity);
    this.order = new Uint32Array(this.capacity * this.segments);
    this.upload = new Uint32Array(this.capacity * (this.segments + 1));
    this.glow = new Float32Array(this.capacity * 4);
    this.rankSpan = new Uint32Array(this.segments);
    this.rankUnlit = new Uint8Array(this.segments);
    const S = this.segments;
    this.unlit = new Uint8Array(kits.length * S);
    this.counts = new Uint32Array(kits.length * S);
    this.firstVertex = new Uint32Array(kits.length * S);
    this.vertexCount = new Uint32Array(kits.length * S);

    // The kits' arrays, end to end, and `indexData`: each kit's ranges —
    // (first, count) a segment, kit-major, a kit narrower than the widest
    // padded with empty ones — the cel program's table (an unlit segment's
    // count 0) and then the emissive one's (only the unlit segments), and
    // after both every segment's indices rebased onto the arrays.
    let vertices = 0;
    let indexTotal = 0;
    for (const kit of kits) {
      for (const s of kit.segments) {
        vertices += s.positions.length / 3;
        indexTotal += s.indices.length;
      }
    }
    const positions = new Float32Array(Math.max(1, vertices) * 3);
    const normals = new Float32Array(Math.max(1, vertices) * 3);
    // `color` and `uv` where a segment carries none read what Babylon's empty
    // vertex buffer read for a mesh with none: ONE float32 0, which WebGPU
    // widens to (0, 0, 0, 1) and (0, 0) — the baked occlusion UNoccluded, the
    // sway's red weight 0.
    const colors = new Float32Array(Math.max(1, vertices) * 4);
    const uvs = new Float32Array(Math.max(1, vertices) * 2);
    const uvs2 = new Float32Array(Math.max(1, vertices) * 2);
    const table = kits.length * S * 2;
    const indices = new Uint32Array(2 * table + indexTotal);
    let v = 0;
    let at = 2 * table;
    let celSpan = 0;
    let unlitSpan = 0;
    let hasUnlit = false;
    kits.forEach((kit, k) => {
      kit.segments.forEach((s, i) => {
        const n = s.positions.length / 3;
        this.firstVertex[k * S + i] = v;
        this.vertexCount[k * S + i] = n;
        positions.set(s.positions, v * 3);
        if (s.normals) normals.set(s.normals, v * 3);
        if (s.colors) colors.set(s.colors, v * 4);
        else for (let c = 0; c < n; c++) colors[(v + c) * 4 + 3] = 1;
        if (s.uvs) uvs.set(s.uvs, v * 2);
        for (let c = 0; c < n; c++) uvs2[(v + c) * 2] = s.slot;
        const r = (s.unlit ? table : 0) + (k * S + i) * 2;
        indices[r] = at;
        indices[r + 1] = s.indices.length;
        this.counts[k * S + i] = s.indices.length;
        if (s.unlit) {
          this.unlit[k * S + i] = 1;
          hasUnlit = true;
          unlitSpan = Math.max(unlitSpan, s.indices.length);
        } else {
          celSpan = Math.max(celSpan, s.indices.length);
        }
        for (let j = 0; j < s.indices.length; j++) indices[at++] = s.indices[j] + v;
        v += n;
      });
      // A padded segment's ranges: (its kit's end, 0) in both tables, drawn as nothing.
      for (let i = kit.segments.length; i < S; i++) {
        indices[(k * S + i) * 2] = at;
        indices[table + (k * S + i) * 2] = at;
      }
    });
    this.celSpan = Math.max(1, celSpan);
    this.unlitSpan = Math.max(1, unlitSpan);
    this.hasUnlit = hasUnlit;
    if (hasUnlit && !materials.unlit) throw new Error(`PoolDraw ${name}: a kit has an unlit segment and no emissive recipe was handed`);

    const storage = (label: string, data: ArrayBufferView<ArrayBuffer>, writable = false): GPUBuffer => {
      const buffer = device.createBuffer({
        label: `${name}: ${label}`,
        size: Math.max(16, Math.ceil(data.byteLength / 4) * 4),
        usage: writable ? GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST : GPUBufferUsage.STORAGE,
        mappedAtCreation: true,
      });
      new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      buffer.unmap();
      this.owned.push(buffer);
      return buffer;
    };
    const frameBuffer = (label: string, bytes: number): GPUBuffer => {
      const buffer = device.createBuffer({
        label: `${name}: ${label}`,
        size: Math.max(16, bytes),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.owned.push(buffer);
      return buffer;
    };
    this.orderBuffer = frameBuffer("orders", this.upload.byteLength);
    this.matrixBuffer = frameBuffer("matrices", this.matrices.byteLength);
    this.glowBuffer = frameBuffer("bloom", this.glow.byteLength);
    const host = renderer.host;
    this.positionBuffer = storage("positions", positions, dynamic);
    this.normalBuffer = storage("normals", normals, dynamic);
    this.dynamic = dynamic;
    this.geometry = new HostBindGroup(device, `${name}: geometry`, BODY_GEOMETRY, [], {
      positionData: this.positionBuffer,
      normalData: this.normalBuffer,
      colorData: storage("colours", colors),
      uvData: storage("uvs", uvs),
      uv2Data: storage("slots", uvs2),
      indexData: storage("ranges and indices", indices),
      bodyOrder: this.orderBuffer,
      bodyMatrices: this.matrixBuffer,
    });
    // No textures: resolved once, whole for good.
    this.geometry.refresh(host, {});

    this.celBlock = new UniformBlockBuffer(device, CEL_MATERIAL_BLOCK, BODY_CEL_DEFINES, `${name}: material`);
    this.celGroup = new HostBindGroup(
      device,
      `${name}: material`,
      [CEL_MATERIAL_BLOCK, ...CEL_MATERIAL_TEXTURES],
      BODY_CEL_DEFINES,
      { [CEL_MATERIAL_BLOCK.var]: this.celBlock.buffer },
    );
    // The variant binds no texture of its own.
    this.celGroup.refresh(host, {});
    if (hasUnlit) {
      this.unlitBlock = new UniformBlockBuffer(device, EMISSIVE_BLOCK, EMISSIVE_BLOCK_DEFINES, `${name}: unlit`);
      this.unlitGroup = new HostBindGroup(device, `${name}: unlit`, [EMISSIVE_BLOCK], [], {
        [EMISSIVE_BLOCK.var]: this.unlitBlock.buffer,
      });
      this.unlitGroup.refresh(host, {});
      this.glowGroup = new HostBindGroup(device, `${name}: bloom`, BODY_GLOW, [], { bodyGlow: this.glowBuffer });
      this.glowGroup.refresh(host, {});
    } else {
      this.unlitBlock = null;
      this.unlitGroup = null;
      this.glowGroup = null;
    }

    const programs = bodyPrograms(kits.length, S, this.celSpan, this.unlitSpan, "pool");
    const ask = (
      program: { readonly vertex: AssembledVertex; readonly fragment: AssembledModule },
      targets: PassTargets,
      state: PipelineState | undefined,
      set: (built: BuiltPipeline) => void,
    ): Promise<boolean> =>
      renderer.pipelines
        .get({
          vertex: program.vertex,
          vertexEntry: "main",
          fragment: program.fragment,
          fragmentEntry: "main",
          targets,
          state,
        })
        .then(
          (built) => {
            set(built);
            return true;
          },
          (err: unknown) => {
            console.error(`${name}: the ${program.vertex.label} pipeline did not build; no piece of ours can be drawn`, err);
            return false;
          },
        );
    // The cel recipe's depth bias is pipeline state, as Babylon's
    // `zOffsetUnits` was (the marks' `MARK_DEPTH_UNITS`).
    const bias = materials.cel.depthBias;
    const asks = [ask(programs.cel, FRAME_TARGETS, bias !== 0 ? { depthBias: bias } : undefined, (b) => (this.cel = b))];
    if (hasUnlit) {
      asks.push(
        ask(programs.visor, FRAME_TARGETS, undefined, (b) => (this.emissive = b)),
        // No depth written: every pixel's depth is the main pass's, which the
        // unlit segment wrote by this same vertex module.
        ask(programs.mask, GLOW_TARGETS, { depthWrite: false }, (b) => (this.mask = b)),
      );
    }
    this.ready = Promise.all(asks).then((oks) => oks.every(Boolean));
  }

  /**
   * Draws the committed pieces from the next frame on — a ROUND's install —
   * telling `failed` if they cannot be: a pipeline that failed (now or for
   * the session already), or the main pass or the mask refused. Replaces any
   * earlier install's failure.
   */
  install(failed: (reason: string) => void): void {
    this.uninstall();
    this.failed = failed;
    const generation = ++this.generation;
    void this.ready.then((ok) => {
      if (!ok && generation === this.generation) failed(`our ${this.name} cannot draw: a pipeline of theirs failed`);
    });
    const renderer = this.renderer;
    this.removes.push(
      renderer.onFrame(this.prepare),
      // Counted only on a frame something was committed (`Renderer.begin`).
      renderer.add(this.draw, "beforeAlphaTest", () => this.pending && this.instances > 0),
      renderer.onRefused(this.refused),
    );
    this.isInstalled = true;
  }

  /**
   * The unlit segments' bloom into the glow's mask from the next frame on,
   * for the install standing — asked AFTER the visors' (`BodyDraw.installMask`),
   * so the palette and the visors go down before these in that pass, as they
   * did while Babylon drew the pools' meshes after them.
   */
  installMask(): void {
    if (!this.isInstalled || !this.hasUnlit) return;
    const renderer = this.renderer;
    this.removes.push(
      renderer.addGlowMask(this.drawMask, () => this.pending && this.instances > 0 && this.glowOn),
      renderer.onGlowMaskRefused(this.maskRefused),
    );
  }

  /**
   * Whether a round's install stands — false on the menu and in an editor
   * build, where `commit` takes nothing and the caller need write nothing.
   */
  get installed(): boolean {
    return this.isInstalled;
  }

  /** Draws no piece again until the next `install`, and tells nobody of anything. */
  uninstall(): void {
    this.generation++;
    for (const remove of this.removes) remove();
    this.removes.length = 0;
    this.isInstalled = false;
    this.failed = ignore;
    this.pending = false;
    this.ours = false;
    this.stats.drawn = 0;
    this.stats.masked = 0;
    this.stats.instances = 0;
  }

  /**
   * This frame's pieces: the first `n` — their matrices and kits written into
   * `matrices` and `kits` now, or by the pull — drawn on the next frame our
   * renderer prepares, their orders (and, with `glowOn`, their bloom) pulled
   * then (`pull`). `epoch` is the materials'
   * (`CelMaterialFactory.materialEpoch`): when it moved, both blocks are
   * copied again from their recipes.
   */
  commit(n: number, glowOn: boolean, epoch: number): void {
    if (!this.isInstalled) return;
    this.instances = Math.max(0, Math.min(n, this.capacity));
    this.glowOn = glowOn && this.hasUnlit;
    this.pending = true;
    // This frame's, from here: a frame `Renderer.begin` skips (nothing
    // committed) runs neither the prepare nor the draw that would reset them.
    this.stats.drawn = 0;
    this.stats.masked = 0;
    this.stats.instances = 0;
    if (epoch !== this.epoch) {
      this.epoch = epoch;
      this.celBlock.write(this.materials.cel.values);
      if (this.unlitBlock && this.materials.unlit) this.unlitBlock.write(this.materials.unlit.values);
    }
  }

  /**
   * Writes a segment's positions and normals over what was uploaded — as
   * Babylon's `updateVerticesData` wrote a mesh's: the same counts, as
   * float32 (`positions` and `normals` ARE float32, so nothing rounds), the
   * indices untouched. Lands before the next submit, so the next frame drawn
   * draws it. Only for a draw built `dynamic`.
   */
  rewrite(kit: number, segment: number, positions: Float32Array<ArrayBuffer>, normals: Float32Array<ArrayBuffer>): void {
    if (!this.dynamic) throw new Error(`PoolDraw ${this.name}: rewrite on a draw not built dynamic`);
    const k = kit * this.segments + segment;
    const n = this.vertexCount[k];
    if (positions.length !== n * 3 || normals.length !== n * 3) {
      throw new Error(`PoolDraw ${this.name}: kit ${kit} segment ${segment} holds ${n} vertices, rewritten with ${positions.length / 3}`);
    }
    const queue = this.device.queue;
    queue.writeBuffer(this.positionBuffer, this.firstVertex[k] * 12, positions);
    queue.writeBuffer(this.normalBuffer, this.firstVertex[k] * 12, normals);
  }

  dispose(): void {
    this.uninstall();
    for (const buffer of this.owned) buffer.destroy();
    this.celBlock.destroy();
    this.unlitBlock?.destroy();
  }

  /**
   * As the main pass begins — inside the render, the camera placed: this
   * frame's verdict, the orders and bloom pulled, each rank's draws worked
   * out, and the pieces uploaded if the frame is ours.
   */
  private readonly prepare = (): void => {
    const pending = this.pending;
    this.pending = false;
    this.stats.drawn = 0;
    this.stats.masked = 0;
    this.stats.instances = 0;
    const n = this.instances;
    this.ours =
      pending && n > 0 && this.cel !== null && (!this.hasUnlit || (this.emissive !== null && this.mask !== null));
    if (!this.ours) return;
    const S = this.segments;
    const order = this.order;
    this.pull(order, this.glow, n, this.glowOn);
    // A rank's draws: the longest cel range any piece draws there, and
    // whether any piece's unlit segment is there — a segment switched off (a
    // zero matrix) asking for neither, so a rank of nothing but dropped,
    // switched-off or padded segments is no draw.
    const kits = this.kits;
    const counts = this.counts;
    const unlit = this.unlit;
    const matrices = this.matrices;
    this.rankSpan.fill(0);
    this.rankUnlit.fill(0);
    let anyUnlit = false;
    for (let i = 0; i < n; i++) {
      const base = kits[i] * S;
      for (let r = 0; r < S; r++) {
        const s = order[i * S + r];
        if (matrices[(i * S + s) * MATRIX_FLOATS + 15] === 0) continue;
        if (unlit[base + s]) {
          this.rankUnlit[r] = 1;
          anyUnlit = true;
        } else if (counts[base + s] > this.rankSpan[r]) {
          this.rankSpan[r] = counts[base + s];
        }
      }
    }
    this.anyUnlit = anyUnlit;
    const upload = this.upload;
    for (let i = 0; i < n; i++) {
      const u = i * (S + 1);
      upload[u] = kits[i];
      for (let r = 0; r < S; r++) upload[u + 1 + r] = order[i * S + r];
    }
    const queue = this.device.queue;
    queue.writeBuffer(this.matrixBuffer, 0, this.matrices, 0, n * S * MATRIX_FLOATS);
    queue.writeBuffer(this.orderBuffer, 0, upload, 0, n * (S + 1));
    if (this.glowOn && anyUnlit) queue.writeBuffer(this.glowBuffer, 0, this.glow, 0, n * 4);
    this.stats.instances = n;
  };

  /**
   * The pieces in the main pass, a rank at a time: its cel segments, then its
   * unlit ones where some piece has one there — so every piece's segments
   * land in its own order.
   */
  private readonly draw = (pass: GPURenderPassEncoder, ctx: FrameContext): void => {
    if (!this.ours) return;
    const n = this.instances;
    const cel = this.cel!;
    if (!this.complete(cel, this.celGroup, ctx)) return;
    const emissive = this.emissive;
    // All complete, or no piece at all: never a frag without its pip.
    if (this.anyUnlit && (!emissive || !this.complete(emissive, this.unlitGroup!, ctx))) return;
    let drawn = 0;
    let bound: BuiltPipeline | null = null;
    for (let r = 0; r < this.segments; r++) {
      const span = this.rankSpan[r];
      if (span > 0) {
        if (bound !== cel) this.bind(pass, (bound = cel), this.celGroup, ctx);
        pass.draw(span, n, r * this.celSpan, 0);
        drawn++;
      }
      if (this.rankUnlit[r]) {
        if (bound !== emissive) this.bind(pass, (bound = emissive!), this.unlitGroup!, ctx);
        pass.draw(this.unlitSpan, n, r * this.unlitSpan, 0);
        drawn++;
      }
    }
    this.stats.drawn = drawn;
  };

  /** The unlit segments' bloom, in the glow's mask after the visors': the unlit ranks again. */
  private readonly drawMask = (pass: GPURenderPassEncoder, ctx: FrameContext): void => {
    if (!this.ours || !this.glowOn || !this.anyUnlit) return;
    const mask = this.mask;
    if (!mask || !this.complete(mask, this.glowGroup!, ctx)) return;
    const n = this.instances;
    let masked = 0;
    let bound = false;
    for (let r = 0; r < this.segments; r++) {
      if (!this.rankUnlit[r]) continue;
      if (!bound) {
        this.bind(pass, mask, this.glowGroup!, ctx);
        bound = true;
      }
      pass.draw(this.unlitSpan, n, r * this.unlitSpan, 0);
      masked++;
    }
    this.stats.masked = masked;
  };

  /** Whether `built`'s groups — the frame's, `material` and the geometry — are whole this frame. */
  private complete(built: BuiltPipeline, material: HostBindGroup, ctx: FrameContext): boolean {
    return (
      ctx.frameGroup(built.groups[0]) !== null &&
      material.get(built.groups[1]) !== null &&
      this.geometry.get(built.groups[2]) !== null
    );
  }

  /** `built` and its groups (whole: `complete` said so) set on `pass`. */
  private bind(pass: GPURenderPassEncoder, built: BuiltPipeline, material: HostBindGroup, ctx: FrameContext): void {
    pass.setPipeline(built.pipeline);
    pass.setBindGroup(0, ctx.frameGroup(built.groups[0])!);
    pass.setBindGroup(1, material.get(built.groups[1])!);
    pass.setBindGroup(2, this.geometry.get(built.groups[2])!);
  }

  /** `Renderer.onRefused`: the main pass drew nothing of ours, these pieces included. */
  private readonly refused = (): void => {
    if (this.ours) this.failed(`the main pass was refused, so none of our ${this.name} can be drawn`);
  };

  /** `Renderer.onGlowMaskRefused`: the mask drew nothing of ours, these pieces' bloom included. */
  private readonly maskRefused = (): void => {
    if (this.ours && this.glowOn && this.anyUnlit) this.failed(`the glow's mask pass was refused, so none of our ${this.name} can bloom`);
  };
}

/** A failure with nobody to tell: not installed. */
function ignore(): void {}
