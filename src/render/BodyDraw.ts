/**
 * render/BodyDraw.ts — Every BODY as OUR renderer draws it
 * (`BABYLON_EXIT.md` X4.1d): the soldier kits' geometry on the GPU once, each
 * frame's bodies as INSTANCES of it, drawn into the frame's main pass — the
 * matte segments with the cel program, the visor with the emissive palette's
 * — and the visor again into the glow's mask.
 * Owns: `BodyDraw` — the kits' arrays (every segment of every kit end to end,
 * each kit's segment ranges as the matte program and the visor's draw them,
 * and the indices rebased onto the arrays), the instances' kits, segment orders,
 * matrices and bloom colours on the GPU and the staging arrays a frame writes
 * them into (`kits`, `matrices`; the orders and the bloom, which it PULLS),
 * both materials' blocks and groups, the three pipelines (asked once, for the
 * session), the main-pass draw, the mask draw, the prepare that uploads a
 * frame, the refusal listeners it holds while installed (and whether it is,
 * `installed`), and what it drew last (`stats`); `BodyKit`, `BodySegment`,
 * `BodyMaterials`, `BodyPull`.
 * Invariants: it DECIDES NOTHING — which bodies are drawn, in what pose, in
 * what order, at what bloom and with what material are its caller's
 * (`Game.drawBodies`, off `WorldCulling`'s verdict per body, the rigs' own
 * joints, the eye and `GlowRules`), handed over once a frame (`commit`) and
 * pulled once inside the render (`pull`, in the prepare), and drawn on that
 * frame, nothing else; a draw is one RANK of every body at once — each body's
 * `r`th segment in its own order (`bodyProgram.ts`) — the ranks in order, so a
 * body's segments are drawn in the order it hands over, as Babylon's
 * front-to-back queue drew a rig's meshes: the matte segments of a rank one
 * draw, the visor of a rank another and only where some body has its visor
 * at that rank — at most twice the segments a body has, however many bodies;
 * the mask's draws are the visor's ranks again, by the same vertex module; a
 * rank's draw runs to the longest range any body draws at it, the rest of
 * its corners drawn as nothing; the draws go into the main pass at
 * `"beforeAlphaTest"`, where Babylon's opaque queue — the rigs' meshes among
 * it until X4.1d — had already drawn, AHEAD of the world's (installed first),
 * as that queue was; the mask's go into that pass ahead of everything of
 * Babylon's and right after the palette's (`installMask`, asked after the
 * world's: `Renderer.addGlowMask` keeps the order added), as Babylon's
 * visors went, no depth written, LEQUAL against the depth the main pass's
 * visor wrote; the arrays are uploaded as Babylon uploaded a
 * mesh's (float32; `color` and `uv`, which no rig carries, reading what
 * Babylon's one-float empty vertex buffer read, widened: (0, 0, 0, 1) and
 * (0, 0)); a material's block is re-copied from its recipe only when the
 * caller's epoch moves; a frame with a pipeline unbuilt or a texture
 * unpublished draws no body, as a Babylon material not ready drew none; a
 * pipeline that FAILS is the round's failure (`install`'s), told every round
 * after it too, and so is a refused main pass or mask while it is installed
 * — never inside the render's commands (the caller defers it,
 * `Game.worldFailed`); nothing here allocates on a frame.
 * Never: imports Babylon; reads a node, a rig or a material; draws while not
 * installed (an editor build, the menu).
 * Contract: `docs/rendering.md`, "The bodies, ours".
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

/** One segment of a kit: one mesh of the rig it was until X4.1d, in its own frame. */
export interface BodySegment {
  /** xyz a vertex. */
  readonly positions: ArrayLike<number>;
  readonly normals: ArrayLike<number> | null;
  /** The palette slot in x — the kit palette's for a matte segment, the visors' table's for the visor. */
  readonly uvs2: ArrayLike<number> | null;
  readonly indices: ArrayLike<number>;
  /** The visor: drawn by the emissive palette's program, and into the mask. */
  readonly emissive: boolean;
}

/** One side's kit: its segments, in the order a body's matrices are written. */
export interface BodyKit {
  readonly segments: readonly BodySegment[];
}

/** What the bodies are drawn WITH, as the factory states it. */
export interface BodyMaterials {
  /** The matte segments' material: the kit palette its own (`BODY_CEL_DEFINES`). */
  readonly cel: CelRecipe;
  /** The visors': each side's colour a slot, and the fog band. */
  readonly visor: EmissiveRecipe;
}

/**
 * What the prepare pulls inside the render, for this frame's first `n`
 * bodies: each one's segments in the order they are drawn into `order` (a
 * segment index a rank, `segments` a body), and — when `glowOn` — each
 * one's visor's bloom into `glow` (rgb, alpha).
 */
export type BodyPull = (order: Uint32Array, glow: Float32Array, n: number, glowOn: boolean) => void;

/** Floats in one body's matrices a segment. */
const MATRIX_FLOATS = 16;

export class BodyDraw {
  /** Segments a body: every kit's count, which must agree. */
  readonly segments: number;
  /** The most bodies one frame may draw. */
  readonly capacity: number;
  /**
   * This frame's bodies' matrices, written by the caller before `commit`:
   * body `i`'s segment `s` at `(i * segments + s) * 16`, `Matrix.m`'s
   * layout, all zero for a segment it does not show.
   */
  readonly matrices: Float32Array<ArrayBuffer>;
  /** This frame's bodies' kits, by the view (`soldierKits`' order), written before `commit`. */
  readonly kits: Uint32Array<ArrayBuffer>;
  /** Whether every pipeline built — asked once, for the session; false if one failed. */
  readonly ready: Promise<boolean>;
  /**
   * What the last frame drew: main-pass draws, mask draws, instances. Nothing
   * in the game reads it; a profiler capture does (`ProfileReport.bodies`).
   */
  readonly stats = { drawn: 0, masked: 0, instances: 0 };

  private readonly device: GPUDevice;
  /** Which segment of a kit is drawn by the visor's program (one a kit, the same in each). */
  private readonly emissive: readonly boolean[];
  /** Each kit's index count a segment, kit-major: what a rank's span is the longest of. */
  private readonly counts: Uint32Array;
  private readonly celSpan: number;
  private readonly visorSpan: number;
  private readonly owned: GPUBuffer[] = [];
  private readonly orderBuffer: GPUBuffer;
  private readonly matrixBuffer: GPUBuffer;
  private readonly glowBuffer: GPUBuffer;
  private readonly geometry: HostBindGroup;
  private readonly celBlock: UniformBlockBuffer;
  private readonly celGroup: HostBindGroup;
  private readonly visorBlock: UniformBlockBuffer;
  private readonly visorGroup: HostBindGroup;
  private readonly glowGroup: HostBindGroup;
  private cel: BuiltPipeline | null = null;
  private visor: BuiltPipeline | null = null;
  private mask: BuiltPipeline | null = null;

  /** The pulled orders and bloom, a body's `segments` ranks apiece. */
  private readonly order: Uint32Array<ArrayBuffer>;
  /** What `bodyOrder` is uploaded from: a body's kit, then its order — `segments + 1` apiece. */
  private readonly upload: Uint32Array<ArrayBuffer>;
  private readonly glow: Float32Array<ArrayBuffer>;
  /** This frame's draws a rank: the matte span (0, none) and whether the visor is drawn there. */
  private readonly rankSpan: Uint32Array;
  private readonly rankVisor: Uint8Array;

  private pending = false;
  private instances = 0;
  private glowOn = false;
  /** The materials' epoch as last copied; NaN is never. */
  private epoch = Number.NaN;
  /** This frame's verdict: committed, built, uploaded. */
  private ours = false;

  /** Takes the draws, the prepare and the listeners back off the renderer; null while not installed. */
  private unhook: (() => void) | null = null;
  private failed: (reason: string) => void = ignore;
  private generation = 0;

  constructor(
    private readonly renderer: Renderer,
    kits: readonly BodyKit[],
    private readonly materials: BodyMaterials,
    capacity: number,
    private readonly pull: BodyPull,
  ) {
    const device = renderer.device;
    this.device = device;
    const segments = kits[0]?.segments.length ?? 0;
    for (const kit of kits) {
      if (kit.segments.length !== segments) {
        throw new Error(`BodyDraw: every kit must have ${segments} segments; one has ${kit.segments.length}`);
      }
      kit.segments.forEach((s, i) => {
        if (s.emissive !== kits[0].segments[i].emissive) throw new Error("BodyDraw: the kits' visors are not the same segment");
      });
    }
    this.segments = segments;
    this.emissive = kits[0]?.segments.map((s) => s.emissive) ?? [];
    this.capacity = Math.max(1, capacity);
    this.matrices = new Float32Array(this.capacity * segments * MATRIX_FLOATS);
    this.kits = new Uint32Array(this.capacity);
    this.order = new Uint32Array(this.capacity * segments);
    this.upload = new Uint32Array(this.capacity * (segments + 1));
    this.glow = new Float32Array(this.capacity * 4);
    this.rankSpan = new Uint32Array(segments);
    this.rankVisor = new Uint8Array(segments);

    // The kits' arrays, end to end, and `indexData`: each kit's ranges —
    // (first, count) a segment, kit-major — the matte program's table (the
    // visor's count 0) and then the visor's (only it), and after both every
    // segment's indices rebased onto the arrays.
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
    const indices = new Uint32Array(2 * table + indexTotal);
    this.counts = new Uint32Array(kits.length * segments);
    let v = 0;
    let at = 2 * table;
    let celSpan = 0;
    let visorSpan = 0;
    kits.forEach((kit, k) => {
      kit.segments.forEach((s, i) => {
        const n = s.positions.length / 3;
        // `Float32Array.set` rounds a double to nearest, as Babylon's
        // upload of a mesh's `number[]` did.
        positions.set(s.positions, v * 3);
        if (s.normals) normals.set(s.normals, v * 3);
        if (s.uvs2) uvs2.set(s.uvs2, v * 2);
        const r = (s.emissive ? table : 0) + (k * segments + i) * 2;
        indices[r] = at;
        indices[r + 1] = s.indices.length;
        this.counts[k * segments + i] = s.indices.length;
        if (s.emissive) visorSpan = Math.max(visorSpan, s.indices.length);
        else celSpan = Math.max(celSpan, s.indices.length);
        for (let j = 0; j < s.indices.length; j++) indices[at++] = s.indices[j] + v;
        v += n;
      });
    });
    this.celSpan = celSpan;
    this.visorSpan = visorSpan;

    const storage = (label: string, data: ArrayBufferView<ArrayBuffer>): GPUBuffer => {
      const buffer = device.createBuffer({
        label: `bodies: ${label}`,
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
        label: `bodies: ${label}`,
        size: Math.max(16, bytes),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.owned.push(buffer);
      return buffer;
    };
    // `color` and `uv`, which no rig carries, read what Babylon's empty
    // vertex buffer read for a mesh with none: ONE float32 0
    // (`webgpuEngine`'s `_emptyVertexBuffer`), which WebGPU widens to a
    // shader's vector as (0, 0, 0, 1) — so `uv` is (0, 0) and `color` is
    // (0, 0, 0, 1), the baked occlusion in its alpha UNoccluded.
    const absentColour = new Float32Array(vertices * 4);
    for (let i = 3; i < absentColour.length; i += 4) absentColour[i] = 1;
    this.orderBuffer = frameBuffer("orders", this.upload.byteLength);
    this.matrixBuffer = frameBuffer("matrices", this.matrices.byteLength);
    this.glowBuffer = frameBuffer("bloom", this.glow.byteLength);
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
    this.geometry = new HostBindGroup(device, "bodies: geometry", BODY_GEOMETRY, [], shared);
    // No textures: resolved once, whole for good.
    this.geometry.refresh(host, {});

    this.celBlock = new UniformBlockBuffer(device, CEL_MATERIAL_BLOCK, BODY_CEL_DEFINES, "bodies: material");
    this.celGroup = new HostBindGroup(
      device,
      "bodies: material",
      [CEL_MATERIAL_BLOCK, ...CEL_MATERIAL_TEXTURES],
      BODY_CEL_DEFINES,
      { [CEL_MATERIAL_BLOCK.var]: this.celBlock.buffer },
    );
    // The variant binds no texture of its own.
    this.celGroup.refresh(host, {});
    this.visorBlock = new UniformBlockBuffer(device, EMISSIVE_BLOCK, EMISSIVE_BLOCK_DEFINES, "bodies: visor");
    this.visorGroup = new HostBindGroup(device, "bodies: visor", [EMISSIVE_BLOCK], [], {
      [EMISSIVE_BLOCK.var]: this.visorBlock.buffer,
    });
    this.visorGroup.refresh(host, {});
    this.glowGroup = new HostBindGroup(device, "bodies: bloom", BODY_GLOW, [], { bodyGlow: this.glowBuffer });
    this.glowGroup.refresh(host, {});

    const programs = bodyPrograms(kits.length, segments, celSpan, visorSpan);
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
            console.error(`bodies: the ${program.vertex.label} pipeline did not build; no body of ours can be drawn`, err);
            return false;
          },
        );
    this.ready = Promise.all([
      ask(programs.cel, FRAME_TARGETS, undefined, (b) => (this.cel = b)),
      ask(programs.visor, FRAME_TARGETS, undefined, (b) => (this.visor = b)),
      // No depth written: every pixel's depth is the main pass's, which the
      // visor wrote by this same vertex module.
      ask(programs.mask, GLOW_TARGETS, { depthWrite: false }, (b) => (this.mask = b)),
    ]).then((oks) => oks.every(Boolean));
  }

  /**
   * Draws the committed bodies from the next frame on — a ROUND's install —
   * telling `failed` if they cannot be: a pipeline that failed (now or for
   * the session already), or the main pass or the mask refused. Replaces any
   * earlier install's failure.
   */
  install(failed: (reason: string) => void): void {
    this.uninstall();
    this.failed = failed;
    const generation = ++this.generation;
    void this.ready.then((ok) => {
      if (!ok && generation === this.generation) failed("our bodies cannot draw: a pipeline of theirs failed");
    });
    const renderer = this.renderer;
    const removes = [
      renderer.onFrame(this.prepare),
      renderer.add(this.draw, "beforeAlphaTest"),
      renderer.onRefused(this.refused),
    ];
    this.removes = removes;
    this.unhook = () => {
      for (const remove of removes) remove();
      removes.length = 0;
    };
  }

  /**
   * The visors' bloom into the glow's mask from the next frame on, for the
   * install standing — asked AFTER the world's own mask draw is, so the
   * palette goes down first in that pass as it did when Babylon drew the
   * visors behind it (`Renderer.addGlowMask` keeps the order added).
   */
  installMask(): void {
    if (!this.unhook) return;
    const renderer = this.renderer;
    this.removes.push(renderer.addGlowMask(this.drawMask), renderer.onGlowMaskRefused(this.maskRefused));
  }

  /**
   * Whether a round's install stands — false on the menu and in an editor
   * build, where `commit` takes nothing and the caller need write nothing.
   */
  get installed(): boolean {
    return this.unhook !== null;
  }

  /** What `install` and `installMask` registered, which `uninstall` takes back. */
  private removes: (() => void)[] = [];

  /** Draws no body again until the next `install`, and tells nobody of anything. */
  uninstall(): void {
    this.generation++;
    this.unhook?.();
    this.unhook = null;
    this.failed = ignore;
    this.pending = false;
    this.ours = false;
    this.stats.drawn = 0;
    this.stats.masked = 0;
    this.stats.instances = 0;
  }

  /**
   * This frame's bodies: the first `n`, their matrices and kits already
   * written into `matrices` and `kits` — drawn on the next frame our renderer
   * prepares, their orders (and, with `glowOn`, their visors' bloom) pulled
   * then (`pull`). `epoch` is the materials' (`CelMaterialFactory
   * .materialEpoch`): when it moved, both blocks are copied again from their
   * recipes.
   */
  commit(n: number, glowOn: boolean, epoch: number): void {
    if (!this.unhook) return;
    this.instances = Math.max(0, Math.min(n, this.capacity));
    this.glowOn = glowOn;
    this.pending = true;
    if (epoch !== this.epoch) {
      this.epoch = epoch;
      this.celBlock.write(this.materials.cel.values);
      this.visorBlock.write(this.materials.visor.values);
    }
  }

  dispose(): void {
    this.uninstall();
    for (const buffer of this.owned) buffer.destroy();
    this.celBlock.destroy();
    this.visorBlock.destroy();
  }

  /**
   * As the main pass begins — inside the render, the camera placed: this
   * frame's verdict, the orders and bloom pulled, each rank's draws worked
   * out, and the bodies uploaded if the frame is ours.
   */
  private readonly prepare = (): void => {
    const pending = this.pending;
    this.pending = false;
    this.stats.drawn = 0;
    this.stats.masked = 0;
    this.stats.instances = 0;
    const n = this.instances;
    this.ours = pending && n > 0 && this.cel !== null && this.visor !== null && this.mask !== null;
    if (!this.ours) return;
    const segments = this.segments;
    const order = this.order;
    this.pull(order, this.glow, n, this.glowOn);
    // A rank's draws: the longest matte range any body draws there, and
    // whether any body's visor is there — a segment switched off (a zero
    // matrix) asking for neither, so a rank of nothing but slung-off
    // launchers is no draw.
    const kits = this.kits;
    const counts = this.counts;
    const emissive = this.emissive;
    const matrices = this.matrices;
    this.rankSpan.fill(0);
    this.rankVisor.fill(0);
    for (let i = 0; i < n; i++) {
      const base = kits[i] * segments;
      for (let r = 0; r < segments; r++) {
        const s = order[i * segments + r];
        if (matrices[(i * segments + s) * MATRIX_FLOATS + 15] === 0) continue;
        if (emissive[s]) this.rankVisor[r] = 1;
        else if (counts[base + s] > this.rankSpan[r]) this.rankSpan[r] = counts[base + s];
      }
    }
    const upload = this.upload;
    for (let i = 0; i < n; i++) {
      const u = i * (segments + 1);
      upload[u] = kits[i];
      for (let r = 0; r < segments; r++) upload[u + 1 + r] = order[i * segments + r];
    }
    const queue = this.device.queue;
    queue.writeBuffer(this.matrixBuffer, 0, this.matrices, 0, n * segments * MATRIX_FLOATS);
    queue.writeBuffer(this.orderBuffer, 0, upload, 0, n * (segments + 1));
    if (this.glowOn) queue.writeBuffer(this.glowBuffer, 0, this.glow, 0, n * 4);
    this.stats.instances = n;
  };

  /**
   * The bodies in the main pass, a rank at a time: its matte segments, then
   * its visors where some body has its visor there — so every body's
   * segments land in its own order.
   */
  private readonly draw = (pass: GPURenderPassEncoder, ctx: FrameContext): void => {
    if (!this.ours) return;
    const cel = this.cel!;
    const visor = this.visor!;
    // Both whole, or no body at all: never a body without its visor.
    if (!this.whole(cel, this.celGroup, ctx) || !this.whole(visor, this.visorGroup, ctx)) return;
    const n = this.instances;
    let drawn = 0;
    let bound: BuiltPipeline | null = null;
    for (let r = 0; r < this.segments; r++) {
      const span = this.rankSpan[r];
      if (span > 0) {
        if (bound !== cel) this.bind(pass, (bound = cel), this.celGroup, ctx);
        pass.draw(span, n, r * this.celSpan, 0);
        drawn++;
      }
      if (this.rankVisor[r]) {
        if (bound !== visor) this.bind(pass, (bound = visor), this.visorGroup, ctx);
        pass.draw(this.visorSpan, n, r * this.visorSpan, 0);
        drawn++;
      }
    }
    this.stats.drawn = drawn;
  };

  /** The visors' bloom, first in the glow's mask with the palette's: the visor's ranks again. */
  private readonly drawMask = (pass: GPURenderPassEncoder, ctx: FrameContext): void => {
    if (!this.ours || !this.glowOn) return;
    const mask = this.mask!;
    if (!this.whole(mask, this.glowGroup, ctx)) return;
    this.bind(pass, mask, this.glowGroup, ctx);
    const n = this.instances;
    let masked = 0;
    for (let r = 0; r < this.segments; r++) {
      if (!this.rankVisor[r]) continue;
      pass.draw(this.visorSpan, n, r * this.visorSpan, 0);
      masked++;
    }
    this.stats.masked = masked;
  };

  /** Whether `built`'s three groups — the frame's, `material`, the geometry — are whole this frame. */
  private whole(built: BuiltPipeline, material: HostBindGroup, ctx: FrameContext): boolean {
    return (
      ctx.frameGroup(built.groups[0]) !== null &&
      material.get(built.groups[1]) !== null &&
      this.geometry.get(built.groups[2]) !== null
    );
  }

  /** `built` and its three groups (whole: `whole` said so) set on `pass`. */
  private bind(
    pass: GPURenderPassEncoder,
    built: BuiltPipeline,
    material: HostBindGroup,
    ctx: FrameContext,
  ): void {
    pass.setPipeline(built.pipeline);
    pass.setBindGroup(0, ctx.frameGroup(built.groups[0])!);
    pass.setBindGroup(1, material.get(built.groups[1])!);
    pass.setBindGroup(2, this.geometry.get(built.groups[2])!);
  }

  /** `Renderer.onRefused`: the main pass drew nothing of ours, bodies included. */
  private readonly refused = (): void => {
    if (this.ours) this.failed("the main pass was refused, so no body of ours can be drawn");
  };

  /** `Renderer.onGlowMaskRefused`: the mask drew nothing of ours, the visors' bloom included. */
  private readonly maskRefused = (): void => {
    if (this.ours && this.glowOn) this.failed("the glow's mask pass was refused, so no visor of ours can bloom");
  };
}

/** A failure with nobody to tell: not installed. */
function ignore(): void {}
