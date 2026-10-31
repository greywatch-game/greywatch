/**
 * render/HullDraw.ts — Every HULL as OUR renderer draws it
 * (`BABYLON_EXIT.md` X4.2b): the vehicle kits' geometry on the GPU once,
 * each frame's hulls as INSTANCES of it, drawn into the frame's main pass
 * with the cel program — X4.1d's shape (`BodyDraw`) for a thing with no
 * emissive and no fade.
 * Owns: `HullDraw` — the kits' arrays (every segment of every kit end to end,
 * each kit's segment ranges, and the indices rebased onto the arrays), the
 * instances' kit words, segment orders and matrices on the GPU and the
 * staging arrays a frame writes them into (`words`, `matrices`; the orders,
 * which it PULLS), the material's block and group, the one pipeline (asked
 * once, for the session), the main-pass draw, the prepare that uploads a
 * frame, the refusal listener it holds while installed (and whether it is,
 * `installed`), and what it drew last (`stats`); `HullDrawKit`,
 * `HullDrawSegment`, `HullPull`.
 * Invariants: it DECIDES NOTHING — which hulls are drawn, in what pose, in
 * what order, which of their segments, in what paint and with what material
 * are its caller's (`Game.drawHulls`, off each hull's switch, `WorldCulling`'s
 * size gate per segment and the detail tier per hull (X4.2c), the rigs' own
 * joints and the eye), handed over once
 * a frame (`commit`) and pulled once inside the render (`pull`, in the
 * prepare: the order, and the segments outside the frustum switched off),
 * and drawn on that frame, nothing else; a draw is one RANK of
 * every hull at once — each hull's `r`th segment in its own order
 * (`hullProgram.ts`) — the ranks in order, so a hull's segments are drawn in
 * the order it hands over, as Babylon's front-to-back queue drew a hull's
 * meshes: at most one draw a segment of the widest kit, however many hulls;
 * a rank's draw runs to the longest range any hull draws at it, the rest of
 * its corners drawn as nothing; a kit narrower than the widest is the widest
 * with its missing segments empty; the draws go into the main pass at
 * `"beforeAlphaTest"`, where Babylon's opaque queue — the hulls' meshes among
 * it until X4.2b — had already drawn, AHEAD of the bodies' draw and the
 * world's (installed before both), as that queue was; the arrays are
 * uploaded as Babylon uploaded a mesh's (float32; `color`, which no hull
 * carries, reading what Babylon's one-float empty vertex buffer read,
 * widened: (0, 0, 0, 1); `uv` read as (0, 0), which the cel stage reads only
 * under a rigged sway a hull's zero `color` never asks for); the material's
 * block is re-copied from its recipe only when the caller's epoch moves; a
 * frame with the pipeline unbuilt or a texture unpublished draws no hull, as
 * a Babylon material not ready drew none; a pipeline that FAILS is the
 * round's failure (`install`'s), told every round after it too, and so is a
 * refused main pass while it is installed — never inside the render's
 * commands (the caller defers it, `Game.worldFailed`); nothing here
 * allocates on a frame.
 * Never: imports Babylon; reads a node, a rig or a material; draws while not
 * installed (an editor build, the menu).
 * Contract: `docs/rendering.md`, "The hulls, ours".
 */
import { CEL_MATERIAL_BLOCK, CEL_MATERIAL_TEXTURES, type CelRecipe } from "./celMaterial";
import { BODY_GEOMETRY } from "./bodyProgram";
import { HULL_CEL_DEFINES, hullPrograms } from "./hullProgram";
import { HostBindGroup } from "./HostBindGroup";
import type { BuiltPipeline } from "./PipelineCache";
import type { FrameContext, Renderer } from "./Renderer";
import { FRAME_TARGETS } from "./targets";
import { UniformBlockBuffer } from "./UniformBlockBuffer";

/** One segment of a kit: one mesh of the hull it was until X4.2b, in its own frame. */
export interface HullDrawSegment {
  /** xyz a vertex. */
  readonly positions: ArrayLike<number>;
  readonly normals: ArrayLike<number> | null;
  /** The livery's palette slot in x, every vertex the segment's one colour. */
  readonly uvs2: ArrayLike<number>;
  readonly indices: ArrayLike<number>;
}

/** One kind's kit in one view's colours: its segments, in the order a hull's matrices are written. */
export interface HullDrawKit {
  readonly segments: readonly HullDrawSegment[];
}

/**
 * What the prepare pulls inside the render, for this frame's first `n` hulls:
 * each one's segments in the order they are drawn into `order` (a segment
 * index a rank, `segments` a hull) — and, what only the render knows, any
 * segment outside the camera's FRUSTUM switched off for this frame by zeroing
 * its matrix in `matrices`, as Babylon's frustum test left a mesh out.
 */
export type HullPull = (order: Uint32Array, matrices: Float32Array, n: number) => void;

/** Floats in one hull's matrices a segment. */
const MATRIX_FLOATS = 16;

export class HullDraw {
  /** Segments a hull: the widest kit's. */
  readonly segments: number;
  /** The most hulls one frame may draw. */
  readonly capacity: number;
  /**
   * This frame's hulls' matrices, written by the caller before `commit`:
   * hull `i`'s segment `s` at `(i * segments + s) * 16`, `Matrix.m`'s
   * layout, all zero for a segment it does not show.
   */
  readonly matrices: Float32Array<ArrayBuffer>;
  /**
   * This frame's hulls' kit WORDS, written before `commit`: the kit (by the
   * order `kits` was handed), and `HULL_CHARRED` for a hull in the charred
   * paint.
   */
  readonly words: Uint32Array<ArrayBuffer>;
  /** Whether the pipeline built — asked once, for the session; false if it failed. */
  readonly ready: Promise<boolean>;
  /**
   * What the last frame drew: main-pass draws, instances. Nothing in the
   * game reads it; a profiler capture does (`ProfileReport.hulls`).
   */
  readonly stats = { drawn: 0, instances: 0 };

  private readonly device: GPUDevice;
  /** Each kit's index count a segment, kit-major: what a rank's span is the longest of. */
  private readonly counts: Uint32Array;
  /** The widest range any kit draws: the program's span, which each rank's `firstVertex` steps by. */
  private readonly span: number;
  private readonly owned: GPUBuffer[] = [];
  private readonly orderBuffer: GPUBuffer;
  private readonly matrixBuffer: GPUBuffer;
  private readonly geometry: HostBindGroup;
  private readonly celBlock: UniformBlockBuffer;
  private readonly celGroup: HostBindGroup;
  private cel: BuiltPipeline | null = null;

  /** The pulled orders, a hull's `segments` ranks apiece. */
  private readonly order: Uint32Array<ArrayBuffer>;
  /** What `bodyOrder` is uploaded from: a hull's kit word, then its order — `segments + 1` apiece. */
  private readonly upload: Uint32Array<ArrayBuffer>;
  /** This frame's draw a rank: its span (0, none). */
  private readonly rankSpan: Uint32Array;

  private pending = false;
  private instances = 0;
  /** The material's epoch as last copied; NaN is never. */
  private epoch = Number.NaN;
  /** This frame's verdict: committed, built, uploaded. */
  private ours = false;

  /** Takes the draw, the prepare and the listener back off the renderer; null while not installed. */
  private unhook: (() => void) | null = null;
  private failed: (reason: string) => void = ignore;
  private generation = 0;

  constructor(
    private readonly renderer: Renderer,
    kits: readonly HullDrawKit[],
    private readonly material: CelRecipe,
    /** The charred paint's slot in the material's palette. */
    charredSlot: number,
    capacity: number,
    private readonly pull: HullPull,
  ) {
    const device = renderer.device;
    this.device = device;
    let segments = 0;
    for (const kit of kits) segments = Math.max(segments, kit.segments.length);
    this.segments = segments;
    this.capacity = Math.max(1, capacity);
    this.matrices = new Float32Array(this.capacity * segments * MATRIX_FLOATS);
    this.words = new Uint32Array(this.capacity);
    this.order = new Uint32Array(this.capacity * segments);
    this.upload = new Uint32Array(this.capacity * (segments + 1));
    this.rankSpan = new Uint32Array(segments);

    // The kits' arrays, end to end, and `indexData`: each kit's ranges —
    // (first, count) a segment, kit-major, a kit narrower than the widest
    // padded with empty ones — and after them every segment's indices
    // rebased onto the arrays.
    let vertices = 0;
    let indexTotal = 0;
    for (const kit of kits) {
      for (const s of kit.segments) {
        vertices += s.positions.length / 3;
        indexTotal += s.indices.length;
      }
    }
    const positions = new Float32Array(vertices * 3);
    const normals = new Float32Array(vertices * 3);
    const uvs2 = new Float32Array(vertices * 2);
    const table = kits.length * segments * 2;
    const indices = new Uint32Array(table + indexTotal);
    this.counts = new Uint32Array(kits.length * segments);
    let v = 0;
    let at = table;
    let span = 0;
    kits.forEach((kit, k) => {
      kit.segments.forEach((s, i) => {
        const n = s.positions.length / 3;
        // `Float32Array.set` rounds a double to nearest, as Babylon's
        // upload of a mesh's `number[]` did.
        positions.set(s.positions, v * 3);
        if (s.normals) normals.set(s.normals, v * 3);
        uvs2.set(s.uvs2, v * 2);
        const r = (k * segments + i) * 2;
        indices[r] = at;
        indices[r + 1] = s.indices.length;
        this.counts[k * segments + i] = s.indices.length;
        span = Math.max(span, s.indices.length);
        for (let j = 0; j < s.indices.length; j++) indices[at++] = s.indices[j] + v;
        v += n;
      });
      // A padded segment's range: (its kit's end, 0), drawn as nothing.
      for (let i = kit.segments.length; i < segments; i++) indices[(k * segments + i) * 2] = at;
    });
    this.span = Math.max(1, span);

    const storage = (label: string, data: ArrayBufferView<ArrayBuffer>): GPUBuffer => {
      const buffer = device.createBuffer({
        label: `hulls: ${label}`,
        size: Math.max(16, Math.ceil(data.byteLength / 4) * 4),
        usage: GPUBufferUsage.STORAGE,
        mappedAtCreation: true,
      });
      new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      buffer.unmap();
      this.owned.push(buffer);
      return buffer;
    };
    const frameBuffer = (label: string, bytes: number): GPUBuffer => {
      const buffer = device.createBuffer({
        label: `hulls: ${label}`,
        size: Math.max(16, bytes),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.owned.push(buffer);
      return buffer;
    };
    // `color` and `uv`, which no hull mesh carried a buffer of or read, as
    // the bodies' (`BodyDraw`): Babylon's one-float empty vertex buffer,
    // which WebGPU widens to (0, 0, 0, 1) — the baked occlusion in its alpha
    // UNoccluded, the sway's red weight 0 — and `uv` (0, 0), which the cel
    // stage reads only under a rigged sway that a zero red never asks for.
    const absentColour = new Float32Array(vertices * 4);
    for (let i = 3; i < absentColour.length; i += 4) absentColour[i] = 1;
    this.orderBuffer = frameBuffer("orders", this.upload.byteLength);
    this.matrixBuffer = frameBuffer("matrices", this.matrices.byteLength);
    const shared = {
      positionData: storage("positions", positions),
      normalData: storage("normals", normals),
      colorData: storage("absent colour", absentColour),
      uvData: storage("absent uv", new Float32Array(vertices * 2)),
      uv2Data: storage("slots", uvs2),
      indexData: storage("ranges and indices", indices),
      bodyOrder: this.orderBuffer,
      bodyMatrices: this.matrixBuffer,
    };
    const host = renderer.host;
    this.geometry = new HostBindGroup(device, "hulls: geometry", BODY_GEOMETRY, [], shared);
    // No textures: resolved once, whole for good.
    this.geometry.refresh(host, {});

    this.celBlock = new UniformBlockBuffer(device, CEL_MATERIAL_BLOCK, HULL_CEL_DEFINES, "hulls: material");
    this.celGroup = new HostBindGroup(
      device,
      "hulls: material",
      [CEL_MATERIAL_BLOCK, ...CEL_MATERIAL_TEXTURES],
      HULL_CEL_DEFINES,
      { [CEL_MATERIAL_BLOCK.var]: this.celBlock.buffer },
    );
    // The variant binds no texture of its own.
    this.celGroup.refresh(host, {});

    const program = hullPrograms(segments, this.span, charredSlot).cel;
    this.ready = renderer.pipelines
      .get({
        vertex: program.vertex,
        vertexEntry: "main",
        fragment: program.fragment,
        fragmentEntry: "main",
        targets: FRAME_TARGETS,
      })
      .then(
        (built) => {
          this.cel = built;
          return true;
        },
        (err: unknown) => {
          console.error(`hulls: the ${program.vertex.label} pipeline did not build; no hull of ours can be drawn`, err);
          return false;
        },
      );
  }

  /**
   * Draws the committed hulls from the next frame on — a ROUND's install —
   * telling `failed` if they cannot be: the pipeline failed (now or for the
   * session already), or the main pass refused. Replaces any earlier
   * install's failure.
   */
  install(failed: (reason: string) => void): void {
    this.uninstall();
    this.failed = failed;
    const generation = ++this.generation;
    void this.ready.then((ok) => {
      if (!ok && generation === this.generation) failed("our hulls cannot draw: their pipeline failed");
    });
    const renderer = this.renderer;
    const removes = [
      renderer.onFrame(this.prepare),
      renderer.add(this.draw, "beforeAlphaTest"),
      renderer.onRefused(this.refused),
    ];
    this.unhook = () => {
      for (const remove of removes) remove();
      removes.length = 0;
    };
  }

  /**
   * Whether a round's install stands — false on the menu and in an editor
   * build, where `commit` takes nothing and the caller need write nothing.
   */
  get installed(): boolean {
    return this.unhook !== null;
  }

  /** Draws no hull again until the next `install`, and tells nobody of anything. */
  uninstall(): void {
    this.generation++;
    this.unhook?.();
    this.unhook = null;
    this.failed = ignore;
    this.pending = false;
    this.ours = false;
    this.stats.drawn = 0;
    this.stats.instances = 0;
  }

  /**
   * This frame's hulls: the first `n`, their matrices and kit words already
   * written into `matrices` and `words` — drawn on the next frame our
   * renderer prepares, their orders pulled then (`pull`). `epoch` is the
   * materials' (`CelMaterialFactory.materialEpoch`): when it moved, the block
   * is copied again from its recipe.
   */
  commit(n: number, epoch: number): void {
    if (!this.unhook) return;
    this.instances = Math.max(0, Math.min(n, this.capacity));
    this.pending = true;
    if (epoch !== this.epoch) {
      this.epoch = epoch;
      this.celBlock.write(this.material.values);
    }
  }

  dispose(): void {
    this.uninstall();
    for (const buffer of this.owned) buffer.destroy();
    this.celBlock.destroy();
  }

  /**
   * As the main pass begins — inside the render, the camera placed: this
   * frame's verdict, the orders pulled, each rank's span worked out, and the
   * hulls uploaded if the frame is ours.
   */
  private readonly prepare = (): void => {
    const pending = this.pending;
    this.pending = false;
    this.stats.drawn = 0;
    this.stats.instances = 0;
    const n = this.instances;
    this.ours = pending && n > 0 && this.cel !== null;
    if (!this.ours) return;
    const segments = this.segments;
    const order = this.order;
    this.pull(order, this.matrices, n);
    // A rank's span: the longest range any hull draws there — a segment
    // switched off (a zero matrix) asking for none, so a rank of nothing but
    // dropped, culled or padded segments is no draw.
    const words = this.words;
    const counts = this.counts;
    const matrices = this.matrices;
    this.rankSpan.fill(0);
    for (let i = 0; i < n; i++) {
      const base = (words[i] & KIT_MASK) * segments;
      for (let r = 0; r < segments; r++) {
        const s = order[i * segments + r];
        if (matrices[(i * segments + s) * MATRIX_FLOATS + 15] === 0) continue;
        if (counts[base + s] > this.rankSpan[r]) this.rankSpan[r] = counts[base + s];
      }
    }
    const upload = this.upload;
    for (let i = 0; i < n; i++) {
      const u = i * (segments + 1);
      upload[u] = words[i];
      for (let r = 0; r < segments; r++) upload[u + 1 + r] = order[i * segments + r];
    }
    const queue = this.device.queue;
    queue.writeBuffer(this.matrixBuffer, 0, this.matrices, 0, n * segments * MATRIX_FLOATS);
    queue.writeBuffer(this.orderBuffer, 0, upload, 0, n * (segments + 1));
    this.stats.instances = n;
  };

  /** The hulls in the main pass, a rank at a time — so every hull's segments land in its own order. */
  private readonly draw = (pass: GPURenderPassEncoder, ctx: FrameContext): void => {
    if (!this.ours) return;
    const cel = this.cel!;
    const frame = ctx.frameGroup(cel.groups[0]);
    const material = this.celGroup.get(cel.groups[1]);
    const geometry = this.geometry.get(cel.groups[2]);
    if (!frame || !material || !geometry) return;
    const n = this.instances;
    let drawn = 0;
    let bound = false;
    for (let r = 0; r < this.segments; r++) {
      const span = this.rankSpan[r];
      if (span === 0) continue;
      if (!bound) {
        pass.setPipeline(cel.pipeline);
        pass.setBindGroup(0, frame);
        pass.setBindGroup(1, material);
        pass.setBindGroup(2, geometry);
        bound = true;
      }
      pass.draw(span, n, r * this.span, 0);
      drawn++;
    }
    this.stats.drawn = drawn;
  };

  /** `Renderer.onRefused`: the main pass drew nothing of ours, hulls included. */
  private readonly refused = (): void => {
    if (this.ours) this.failed("the main pass was refused, so no hull of ours can be drawn");
  };
}

/** The kit word's kit: every bit but `HULL_CHARRED`. */
const KIT_MASK = 0x7fffffff;

/** A failure with nobody to tell: not installed. */
function ignore(): void {}
