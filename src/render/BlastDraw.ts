/**
 * render/BlastDraw.ts — The blast's BILLOWS as OUR renderer draws them
 * (`BABYLON_EXIT.md` X4.4c): every billow of every blast slot and of the
 * shared batch of sparks and trails an instance of one of two icospheres,
 * drawn into the frame's main pass by the billow's program and again into the
 * glow's mask by its twin (`render/blastProgram.ts`) — what each batch's
 * thin-instanced mesh on `BlastShader.ts`'s material drew through Babylon
 * until X4.4c, one draw a batch.
 * Owns: `BlastDraw` — the icospheres' arrays on the GPU (the positions end
 * to end and their indices rebased onto them, each shape's index range), the
 * instances' matrices, `billow`s, warmths and blooms on the GPU and the
 * staging arrays a frame writes them into (`matrices`, `billows`, `warmth`,
 * `glow`), this frame's DRAWS — a batch each: its shape, its first instance
 * and its count, in the main pass's order (`drawShape`, `drawFirst`,
 * `drawCount`, `draws`) and the mask's order of them (`maskOrder`, `masks`) —
 * the billow's block (copied from its recipe every frame it draws: the clock
 * moves every frame), both pipelines, the main-pass draw, the mask draw, the
 * prepare that pulls and uploads a frame, the refusal listeners it holds
 * while installed (and whether it is, `installed`), and what it drew last
 * (`stats`); `BlastShapeArrays`, `BlastPull`.
 * Invariants: it DECIDES NOTHING — which batches are drawn, in what order,
 * which into the mask, each instance's pose and each batch's bloom are its
 * caller's (`Game.drawBlasts` and `Game.blastPull`: the batches `BlastFx`
 * posed, Babylon's frustum test of each batch's sphere, the opaque queue's
 * front-to-back order, the active list's order for the mask, `GlowRules`),
 * pulled once a frame inside the render (`pull`, in the prepare, off the
 * camera the render placed), and drawn on that frame, nothing else; a batch
 * is ONE draw — `pass.draw(its shape's index count, its count, its shape's
 * first index, its first instance)` — so its instances go down in the order
 * `BillowBatch` pushed them, as a thin-instanced mesh's did, and the draws in
 * the order pulled; the main pass's draws are at `"beforeAlphaTest"`, where
 * Babylon's opaque queue — the billows' meshes among it until X4.4c — had
 * already drawn, installed AHEAD of the pools' pieces, the hulls, the bodies
 * and the world; the mask's into that pass after the palette's, the visors'
 * and the pieces' (`installMask`, asked after theirs), as Babylon's mask drew
 * the billows after all of ours — by the same vertex module, no depth written,
 * LEQUAL against the depth the main pass wrote; the arrays are uploaded as
 * Babylon uploaded the mesh's and its thin-instance buffers (float32); a frame
 * with a pipeline unbuilt or a frame texture unpublished draws no billow, as a
 * Babylon material not ready drew none; a pipeline that FAILS is the round's
 * failure (`install`'s), told every round after it too, and so is a refused
 * main pass or mask while it is installed — never inside the render's
 * commands (the caller defers it, `Game.worldFailed`); nothing here allocates
 * on a frame.
 * Never: imports Babylon; reads a batch, a node or a material; draws while not
 * installed (the menu).
 * Contract: `docs/rendering.md`, "The pools, ours".
 */
import { BLAST_BLOCK, BLAST_GEOMETRY, blastPrograms, type BlastRecipe } from "./blastProgram";
import type { PassTargets } from "./frameHost";
import { HostBindGroup } from "./HostBindGroup";
import type { BuiltPipeline, PipelineState } from "./PipelineCache";
import type { FrameContext, Renderer } from "./Renderer";
import { FRAME_TARGETS, GLOW_TARGETS } from "./targets";
import { UniformBlockBuffer } from "./UniformBlockBuffer";
import type { AssembledModule, AssembledVertex } from "./wgsl/assemble";

/** One icosphere a billow is an instance of: its arrays, as its mesh was handed them. */
export interface BlastShapeArrays {
  /** xyz a vertex. */
  readonly positions: ArrayLike<number>;
  readonly indices: ArrayLike<number>;
}

/**
 * What the prepare pulls inside the render: this frame's draws and their
 * instances, written into `into`'s staging arrays and counts (`draws`,
 * `masks`, `instances`) — the blooms (`glow`) only when `glowOn`.
 */
export type BlastPull = (into: BlastDraw, glowOn: boolean) => void;

/** The block's variant: its fields are unguarded. */
const BLOCK_DEFINES: readonly string[] = [];

export class BlastDraw {
  /** The most instances one frame may draw. */
  readonly capacity: number;
  /** The most draws one frame may make: a batch each. */
  readonly maxDraws: number;
  /** This frame's instances' matrices, `Matrix.m`'s layout, 16 floats an instance. */
  readonly matrices: Float32Array<ArrayBuffer>;
  /** Their heat, dissolve, seed and dust, 4 floats an instance. */
  readonly billows: Float32Array<ArrayBuffer>;
  /** Their warmth, one float an instance. */
  readonly warmth: Float32Array<ArrayBuffer>;
  /** Their bloom (rgb, alpha), 4 floats an instance — written only on a frame `glowOn`. */
  readonly glow: Float32Array<ArrayBuffer>;
  /** This frame's draws in the main pass's order: each one's shape, first instance and count. */
  readonly drawShape: Uint32Array;
  readonly drawFirst: Uint32Array;
  readonly drawCount: Uint32Array;
  /** How many draws this frame (the pull's). */
  draws = 0;
  /** The draws the glow's mask makes, in its order: indices into the draws above. */
  readonly maskOrder: Uint32Array;
  /** How many of them this frame (the pull's). */
  masks = 0;
  /** Instances written this frame (the pull's): what is uploaded. */
  instances = 0;
  /** Whether both pipelines built — asked once, for the session; false if one failed. */
  readonly ready: Promise<boolean>;
  /**
   * What the last frame drew: main-pass draws, mask draws, instances. Nothing
   * in the game reads it; a profiler capture does (`ProfileReport.pools`) and
   * the census.
   */
  readonly stats = { drawn: 0, masked: 0, instances: 0 };

  private readonly device: GPUDevice;
  private readonly shapeFirst: Uint32Array;
  private readonly shapeCount: Uint32Array;
  private readonly owned: GPUBuffer[] = [];
  private readonly matrixBuffer: GPUBuffer;
  private readonly billowBuffer: GPUBuffer;
  private readonly warmthBuffer: GPUBuffer;
  private readonly glowBuffer: GPUBuffer;
  private readonly geometry: HostBindGroup;
  private readonly block: UniformBlockBuffer;
  private readonly material: HostBindGroup;
  private main: BuiltPipeline | null = null;
  private mask: BuiltPipeline | null = null;

  private pending = false;
  private glowOn = false;
  /** This frame's verdict: committed, built, pulled with something to draw. */
  private ours = false;

  /** What `install` and `installMask` registered, which `uninstall` takes back. */
  private removes: (() => void)[] = [];
  private isInstalled = false;
  private failed: (reason: string) => void = ignore;
  private generation = 0;

  constructor(
    private readonly renderer: Renderer,
    shapes: readonly BlastShapeArrays[],
    private readonly recipe: BlastRecipe,
    capacity: number,
    maxDraws: number,
    private readonly pull: BlastPull,
  ) {
    const device = renderer.device;
    this.device = device;
    this.capacity = Math.max(1, capacity);
    this.maxDraws = Math.max(1, maxDraws);
    this.matrices = new Float32Array(this.capacity * 16);
    this.billows = new Float32Array(this.capacity * 4);
    this.warmth = new Float32Array(this.capacity);
    this.glow = new Float32Array(this.capacity * 4);
    this.drawShape = new Uint32Array(this.maxDraws);
    this.drawFirst = new Uint32Array(this.maxDraws);
    this.drawCount = new Uint32Array(this.maxDraws);
    this.maskOrder = new Uint32Array(this.maxDraws);

    // The shapes' arrays, end to end, and their indices rebased onto them.
    let vertices = 0;
    let indexTotal = 0;
    for (const s of shapes) {
      vertices += s.positions.length / 3;
      indexTotal += s.indices.length;
    }
    const positions = new Float32Array(Math.max(1, vertices) * 3);
    const indices = new Uint32Array(Math.max(1, indexTotal));
    this.shapeFirst = new Uint32Array(shapes.length);
    this.shapeCount = new Uint32Array(shapes.length);
    let v = 0;
    let at = 0;
    shapes.forEach((s, k) => {
      positions.set(s.positions, v * 3);
      this.shapeFirst[k] = at;
      this.shapeCount[k] = s.indices.length;
      for (let j = 0; j < s.indices.length; j++) indices[at++] = s.indices[j] + v;
      v += s.positions.length / 3;
    });

    const storage = (label: string, data: ArrayBufferView<ArrayBuffer>): GPUBuffer => {
      const buffer = device.createBuffer({
        label: `blasts: ${label}`,
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
        label: `blasts: ${label}`,
        size: Math.max(16, bytes),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.owned.push(buffer);
      return buffer;
    };
    this.matrixBuffer = frameBuffer("matrices", this.matrices.byteLength);
    this.billowBuffer = frameBuffer("billows", this.billows.byteLength);
    this.warmthBuffer = frameBuffer("warmth", this.warmth.byteLength);
    this.glowBuffer = frameBuffer("bloom", this.glow.byteLength);
    const host = renderer.host;
    this.geometry = new HostBindGroup(device, "blasts: geometry", BLAST_GEOMETRY, [], {
      positionData: storage("positions", positions),
      indexData: storage("indices", indices),
      blastMatrices: this.matrixBuffer,
      blastBillows: this.billowBuffer,
      blastWarmth: this.warmthBuffer,
      blastGlow: this.glowBuffer,
    });
    // No textures: resolved once, whole for good.
    this.geometry.refresh(host, {});
    this.block = new UniformBlockBuffer(device, BLAST_BLOCK, BLOCK_DEFINES, "blasts: material");
    this.material = new HostBindGroup(device, "blasts: material", [BLAST_BLOCK], BLOCK_DEFINES, {
      [BLAST_BLOCK.var]: this.block.buffer,
    });
    this.material.refresh(host, {});

    const programs = blastPrograms();
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
            console.error(`blasts: the ${program.fragment.label} pipeline did not build; no billow of ours can be drawn`, err);
            return false;
          },
        );
    this.ready = Promise.all([
      ask(programs.main, FRAME_TARGETS, undefined, (b) => (this.main = b)),
      // No depth written: every pixel's depth is the main pass's, which the
      // billow wrote by this same vertex module.
      ask(programs.mask, GLOW_TARGETS, { depthWrite: false }, (b) => (this.mask = b)),
    ]).then((oks) => oks.every(Boolean));
  }

  /**
   * Draws the committed billows from the next frame on — a ROUND's install —
   * telling `failed` if they cannot be: a pipeline that failed (now or for
   * the session already), or the main pass or the mask refused. Replaces any
   * earlier install's failure.
   */
  install(failed: (reason: string) => void): void {
    this.uninstall();
    this.failed = failed;
    const generation = ++this.generation;
    void this.ready.then((ok) => {
      if (!ok && generation === this.generation) failed("our blasts cannot draw: a pipeline of theirs failed");
    });
    const renderer = this.renderer;
    this.removes.push(
      renderer.onFrame(this.prepare),
      // Counted only on a frame something was committed (`Renderer.begin`).
      renderer.add(this.draw, "beforeAlphaTest", () => this.pending),
      renderer.onRefused(this.refused),
    );
    this.isInstalled = true;
  }

  /**
   * The billows' bloom into the glow's mask from the next frame on, for the
   * install standing — asked AFTER the pieces' (`PoolDraw.installMask`), so
   * everything of ours goes down before these in that pass, as it did while
   * Babylon drew the billows' meshes after it.
   */
  installMask(): void {
    if (!this.isInstalled) return;
    const renderer = this.renderer;
    this.removes.push(
      renderer.addGlowMask(this.drawMask, () => this.pending && this.glowOn),
      renderer.onGlowMaskRefused(this.maskRefused),
    );
  }

  /**
   * Whether a round's install stands — false on the menu, where `commit`
   * takes nothing and the caller need write nothing.
   */
  get installed(): boolean {
    return this.isInstalled;
  }

  /** Draws no billow again until the next `install`, and tells nobody of anything. */
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
   * This frame has billows to draw: they are pulled on the next frame our
   * renderer prepares (`pull`), and, with `glowOn`, into the glow's mask.
   */
  commit(glowOn: boolean): void {
    if (!this.isInstalled) return;
    this.glowOn = glowOn;
    this.pending = true;
    // This frame's, from here: a frame `Renderer.begin` skips (nothing
    // committed) runs neither the prepare nor the draw that would reset them.
    this.stats.drawn = 0;
    this.stats.masked = 0;
    this.stats.instances = 0;
  }

  dispose(): void {
    this.uninstall();
    for (const buffer of this.owned) buffer.destroy();
    this.block.destroy();
  }

  /**
   * As the main pass begins — inside the render, the camera placed: this
   * frame's draws pulled, and uploaded if the frame is ours.
   */
  private readonly prepare = (): void => {
    const pending = this.pending;
    this.pending = false;
    this.stats.drawn = 0;
    this.stats.masked = 0;
    this.stats.instances = 0;
    this.ours = false;
    if (!pending || this.main === null || this.mask === null) return;
    this.draws = 0;
    this.masks = 0;
    this.instances = 0;
    this.pull(this, this.glowOn);
    const n = Math.min(this.instances, this.capacity);
    if (this.draws === 0 || n === 0) return;
    this.ours = true;
    const queue = this.device.queue;
    queue.writeBuffer(this.matrixBuffer, 0, this.matrices, 0, n * 16);
    queue.writeBuffer(this.billowBuffer, 0, this.billows, 0, n * 4);
    queue.writeBuffer(this.warmthBuffer, 0, this.warmth, 0, n);
    if (this.glowOn && this.masks > 0) queue.writeBuffer(this.glowBuffer, 0, this.glow, 0, n * 4);
    // The clock moves every frame, so the block is copied every frame drawn.
    this.block.write(this.recipe.values);
    this.stats.instances = n;
  };

  /** The billows in the main pass: a batch a draw, in the order pulled. */
  private readonly draw = (pass: GPURenderPassEncoder, ctx: FrameContext): void => {
    if (!this.ours) return;
    const main = this.main!;
    if (!this.complete(main, ctx)) return;
    this.bind(pass, main, ctx);
    for (let d = 0; d < this.draws; d++) {
      const shape = this.drawShape[d];
      pass.draw(this.shapeCount[shape], this.drawCount[d], this.shapeFirst[shape], this.drawFirst[d]);
    }
    this.stats.drawn = this.draws;
  };

  /** The billows' bloom, in the glow's mask after the pieces': the mask's draws, in its order. */
  private readonly drawMask = (pass: GPURenderPassEncoder, ctx: FrameContext): void => {
    if (!this.ours || !this.glowOn || this.masks === 0) return;
    const mask = this.mask!;
    if (!this.complete(mask, ctx)) return;
    this.bind(pass, mask, ctx);
    for (let k = 0; k < this.masks; k++) {
      const d = this.maskOrder[k];
      const shape = this.drawShape[d];
      pass.draw(this.shapeCount[shape], this.drawCount[d], this.shapeFirst[shape], this.drawFirst[d]);
    }
    this.stats.masked = this.masks;
  };

  /** Whether `built`'s groups — the frame's, the material's and the geometry — are whole this frame. */
  private complete(built: BuiltPipeline, ctx: FrameContext): boolean {
    return (
      ctx.frameGroup(built.groups[0]) !== null &&
      this.material.get(built.groups[1]) !== null &&
      this.geometry.get(built.groups[2]) !== null
    );
  }

  /** `built` and its groups (whole: `complete` said so) set on `pass`. */
  private bind(pass: GPURenderPassEncoder, built: BuiltPipeline, ctx: FrameContext): void {
    pass.setPipeline(built.pipeline);
    pass.setBindGroup(0, ctx.frameGroup(built.groups[0])!);
    pass.setBindGroup(1, this.material.get(built.groups[1])!);
    pass.setBindGroup(2, this.geometry.get(built.groups[2])!);
  }

  /** `Renderer.onRefused`: the main pass drew nothing of ours, these billows included. */
  private readonly refused = (): void => {
    if (this.ours) this.failed("the main pass was refused, so none of our blasts can be drawn");
  };

  /** `Renderer.onGlowMaskRefused`: the mask drew nothing of ours, these billows' bloom included. */
  private readonly maskRefused = (): void => {
    if (this.ours && this.glowOn && this.masks > 0) this.failed("the glow's mask pass was refused, so none of our blasts can bloom");
  };
}

/** A failure with nobody to tell: not installed. */
function ignore(): void {}
