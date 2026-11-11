/**
 * render/FlameDraw.ts — The FIRES as OUR renderer draws them
 * (`BABYLON_EXIT.md` X4.4d): every world fire — a block's merge of
 * `world/flame.ts` surfaces, the fire drums and hearths and candles among
 * them — and every flame of a burning molotov, each drawn as one instance of
 * its surface under its matrix, into the frame's main pass by the fire's
 * program and again into the glow's mask by its twin
 * (`render/flameProgram.ts`) — what a Babylon mesh on `FlameShader.ts`'s
 * material drew until X4.4d, one draw a mesh.
 * Owns: `FlameDraw` — the fire surfaces' arrays on the GPU (the molotov's
 * flame, the session's, first, then the standing map's world fires — their
 * positions, normals and uvs end to end, their indices rebased onto them, and
 * each surface's index range), rebuilt by `setWorld` and let go by
 * `clearWorld`; the draws' matrices and blooms on the GPU and the staging
 * arrays a frame writes them into (`matrices`, `glow`), this frame's DRAWS
 * — a surface each, by its index in that list (`drawShape`), in the main
 * pass's order (`draws`) and the mask's order of them (`maskOrder`,
 * `masks`) — the fire's block (copied from its recipe every frame it draws:
 * the clock moves every frame), both pipelines, the main-pass draw, the mask
 * draw, the prepare that pulls and uploads a frame, the refusal listeners it
 * holds while installed (and whether it is, `installed`), and what it drew
 * last (`stats`); `FlameShapeArrays`, `FlamePull`.
 * Invariants: it DECIDES NOTHING — which fires are drawn, in what order,
 * which into the mask, each one's matrix and bloom are its caller's
 * (`Game.drawFires` and `Game.flamePull`: the flames `GrenadeFx` posed and
 * the fires the handover took, the cull's cells, Babylon's frustum test of
 * each one's sphere, the opaque queue's front-to-back order, the active
 * list's order for the mask, `GlowRules`), pulled once a frame inside the
 * render (`pull`, in the prepare, off the camera the render placed), and
 * drawn on that frame, nothing else; a draw is ONE instance of ONE surface —
 * `pass.draw(its surface's index count, 1, its first index, the draw's
 * index)` — so the draws go down in the order pulled, as Babylon's queue drew
 * the meshes; the main pass's draws are at `"beforeAlphaTest"`, where
 * Babylon's opaque queue — the fires' meshes among it until X4.4d — had
 * already drawn, installed AHEAD of the blasts, the pools' pieces, the hulls,
 * the bodies and the world; the mask's into that pass after the palette's,
 * the visors', the pieces' and the billows' (`installMask`, asked after
 * theirs), as Babylon's mask drew the fires after all of ours — by the same
 * vertex module, no depth written, LEQUAL against the depth the main pass
 * wrote — which puts them, with ours at the mask's open, AHEAD of every mesh
 * Babylon's mask still draws (the sparks, the dust discs) and ahead of the
 * moon's bloom (ours since X4.5c, `addGlowMaskBlended`), where
 * its queue drew them among those: with no depth written and LEQUAL against
 * the frame's, only an exact tie could differ, and the blended sparks and
 * discs went down after the opaque fires before X4.4d and since; the arrays are uploaded as Babylon uploaded a mesh's (float32, a
 * double rounded as Babylon's `Float32Array` of it is); a frame with a
 * pipeline unbuilt, a frame texture unpublished or no world set draws no fire,
 * as a Babylon material not ready drew none; a pipeline that FAILS is the
 * round's failure (`install`'s), told every round after it too, and so is a
 * refused main pass or mask while it is installed — never inside the
 * render's commands (the caller defers it, `Game.worldFailed`); nothing here
 * allocates on a frame.
 * Never: imports Babylon; reads a node, a mesh or a material; draws while not
 * installed (the menu).
 * Contract: `docs/rendering.md`, "The fire".
 */
import { FLAME_BLOCK, FLAME_GEOMETRY, flamePrograms, type FlameRecipe } from "./flameProgram";
import type { PassTargets } from "./frameHost";
import { HostBindGroup } from "./HostBindGroup";
import type { BuiltPipeline, PipelineState } from "./PipelineCache";
import type { FrameContext, Renderer } from "./Renderer";
import { FRAME_TARGETS, GLOW_TARGETS } from "./targets";
import { UniformBlockBuffer } from "./UniformBlockBuffer";
import type { AssembledModule, AssembledVertex } from "./wgsl/assemble";

/** One fire surface, as its mesh was handed it: xyz positions and normals, uv pairs, triangles. */
export interface FlameShapeArrays {
  readonly positions: ArrayLike<number>;
  readonly normals: ArrayLike<number>;
  readonly uvs: ArrayLike<number>;
  readonly indices: ArrayLike<number>;
}

/**
 * What the prepare pulls inside the render: this frame's draws, written into
 * `into`'s staging arrays and counts (`draws`, `masks`) — the blooms (`glow`)
 * only when `glowOn`.
 */
export type FlamePull = (into: FlameDraw, glowOn: boolean) => void;

/** The block's variant: its fields are unguarded. */
const BLOCK_DEFINES: readonly string[] = [];

/** The standing map's surfaces on the GPU: what `setWorld` made and `clearWorld` lets go. */
interface WorldBuffers {
  readonly owned: GPUBuffer[];
  readonly matrixBuffer: GPUBuffer;
  readonly glowBuffer: GPUBuffer;
  readonly geometry: HostBindGroup;
  /** Each surface's first index and index count, the molotov's flame first. */
  readonly first: Uint32Array;
  readonly count: Uint32Array;
}

export class FlameDraw {
  /** The most draws one frame may make: every surface once — the molotov's flames, then the world's fires. */
  capacity = 0;
  /** This frame's draws' matrices, `Matrix.m`'s layout, 16 floats a draw. */
  matrices = new Float32Array(0);
  /** Their bloom (rgb, alpha), 4 floats a draw — written only on a frame `glowOn`. */
  glow = new Float32Array(0);
  /** Each draw's surface: 0 the molotov's flame, `1 + k` world fire `k` (`setWorld`'s order). */
  drawShape = new Uint32Array(0);
  /** How many draws this frame (the pull's). */
  draws = 0;
  /** The draws the glow's mask makes, in its order: indices into the draws above. */
  maskOrder = new Uint32Array(0);
  /** How many of them this frame (the pull's). */
  masks = 0;
  /** Whether both pipelines built — asked once, for the session; false if one failed. */
  readonly ready: Promise<boolean>;
  /**
   * What the last frame drew: main-pass draws, mask draws. Nothing in the
   * game reads it; a profiler capture does (`ProfileReport.pools.fires`)
   * and the census.
   */
  readonly stats = { drawn: 0, masked: 0 };

  private readonly device: GPUDevice;
  private readonly block: UniformBlockBuffer;
  private readonly material: HostBindGroup;
  private main: BuiltPipeline | null = null;
  private mask: BuiltPipeline | null = null;
  /** The map's surfaces on the GPU; null with no map set. */
  private world: WorldBuffers | null = null;

  private pending = false;
  private glowOn = false;
  /** This frame's verdict: committed, built, a world set, pulled with something to draw. */
  private ours = false;

  /** What `install` and `installMask` registered, which `uninstall` takes back. */
  private removes: (() => void)[] = [];
  private isInstalled = false;
  private failed: (reason: string) => void = ignore;
  private generation = 0;

  constructor(
    private readonly renderer: Renderer,
    /** The molotov's flame: every flame of every fire is an instance of it. */
    private readonly flame: FlameShapeArrays,
    /** How many flames the molotov's pool holds — what a frame may draw of it. */
    private readonly flames: number,
    private readonly recipe: FlameRecipe,
    private readonly pull: FlamePull,
  ) {
    const device = renderer.device;
    this.device = device;
    this.block = new UniformBlockBuffer(device, FLAME_BLOCK, BLOCK_DEFINES, "fires: material");
    this.material = new HostBindGroup(device, "fires: material", [FLAME_BLOCK], BLOCK_DEFINES, {
      [FLAME_BLOCK.var]: this.block.buffer,
    });
    this.material.refresh({});

    const programs = flamePrograms();
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
            console.error(`fires: the ${program.fragment.label} pipeline did not build; no fire of ours can be drawn`, err);
            return false;
          },
        );
    this.ready = Promise.all([
      // Back faces culled and depth written, LEQUAL — `FlameMaterial`'s.
      ask(programs.main, FRAME_TARGETS, undefined, (b) => (this.main = b)),
      // No depth written: every pixel's depth is the main pass's, which the
      // fire wrote by this same vertex module (`FlameMaskMaterial`'s state).
      ask(programs.mask, GLOW_TARGETS, { depthWrite: false }, (b) => (this.mask = b)),
    ]).then((oks) => oks.every(Boolean));
  }

  /**
   * The standing map's world fires (`BlockHandover`, in the order its pull
   * names them: world fire `k` is surface `1 + k`), uploaded beside the
   * molotov's flame, and the staging arrays sized to every surface once —
   * replacing any map set before. Their arrays are read here and never kept.
   */
  setWorld(fires: readonly FlameShapeArrays[]): void {
    this.clearWorld();
    const device = this.device;
    const shapes = [this.flame, ...fires];
    let vertices = 0;
    let indexTotal = 0;
    for (const s of shapes) {
      vertices += s.positions.length / 3;
      indexTotal += s.indices.length;
    }
    const positions = new Float32Array(Math.max(1, vertices) * 3);
    const normals = new Float32Array(Math.max(1, vertices) * 3);
    const uvs = new Float32Array(Math.max(1, vertices) * 2);
    const indices = new Uint32Array(Math.max(1, indexTotal));
    const first = new Uint32Array(shapes.length);
    const count = new Uint32Array(shapes.length);
    let v = 0;
    let at = 0;
    shapes.forEach((s, k) => {
      // `set` rounds a double to float32 as Babylon's `Float32Array` of the
      // same numbers did.
      positions.set(s.positions, v * 3);
      normals.set(s.normals, v * 3);
      uvs.set(s.uvs, v * 2);
      first[k] = at;
      count[k] = s.indices.length;
      for (let j = 0; j < s.indices.length; j++) indices[at++] = s.indices[j] + v;
      v += s.positions.length / 3;
    });

    const owned: GPUBuffer[] = [];
    const storage = (label: string, data: ArrayBufferView<ArrayBuffer>): GPUBuffer => {
      const buffer = device.createBuffer({
        label: `fires: ${label}`,
        size: Math.max(16, Math.ceil(data.byteLength / 4) * 4),
        usage: GPUBufferUsage.STORAGE,
        mappedAtCreation: true,
      });
      new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      buffer.unmap();
      owned.push(buffer);
      return buffer;
    };
    const capacity = this.flames + fires.length;
    const frameBuffer = (label: string, bytes: number): GPUBuffer => {
      const buffer = device.createBuffer({
        label: `fires: ${label}`,
        size: Math.max(16, bytes),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      owned.push(buffer);
      return buffer;
    };
    this.capacity = capacity;
    this.matrices = new Float32Array(capacity * 16);
    this.glow = new Float32Array(capacity * 4);
    this.drawShape = new Uint32Array(capacity);
    this.maskOrder = new Uint32Array(capacity);
    const matrixBuffer = frameBuffer("matrices", this.matrices.byteLength);
    const glowBuffer = frameBuffer("bloom", this.glow.byteLength);
    const geometry = new HostBindGroup(device, "fires: geometry", FLAME_GEOMETRY, [], {
      positionData: storage("positions", positions),
      normalData: storage("normals", normals),
      uvData: storage("uvs", uvs),
      indexData: storage("indices", indices),
      flameMatrices: matrixBuffer,
      flameGlow: glowBuffer,
    });
    // No textures: resolved once, whole for good.
    geometry.refresh({});
    this.world = { owned, matrixBuffer, glowBuffer, geometry, first, count };
  }

  /** The map is going: its surfaces off the GPU, and nothing drawn until the next `setWorld`. */
  clearWorld(): void {
    const world = this.world;
    this.world = null;
    this.ours = false;
    this.draws = 0;
    this.masks = 0;
    if (world) for (const buffer of world.owned) buffer.destroy();
  }

  /**
   * Draws the committed fires from the next frame on — a ROUND's install —
   * telling `failed` if they cannot be: a pipeline that failed (now or for
   * the session already), or the main pass or the mask refused. Replaces any
   * earlier install's failure.
   */
  install(failed: (reason: string) => void): void {
    this.uninstall();
    this.failed = failed;
    const generation = ++this.generation;
    void this.ready.then((ok) => {
      if (!ok && generation === this.generation) failed("our fires cannot draw: a pipeline of theirs failed");
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
   * The fires' bloom into the glow's mask from the next frame on, for the
   * install standing — asked AFTER the billows' (`BlastDraw.installMask`),
   * so everything else of ours goes down before these in that pass, as it
   * did while Babylon drew the fires' meshes after it. Being ours, they go
   * down AHEAD of every mesh Babylon's mask still draws (the sparks, the
   * dust discs), where its queue drew them among those — no depth
   * written and LEQUAL against the frame's, so only an exact tie could
   * differ, and the blended sparks and discs drew after the opaque fires
   * before X4.4d and since.
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

  /** Draws no fire again until the next `install`, and tells nobody of anything. */
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
  }

  /**
   * This frame may have fires to draw: they are pulled on the next frame our
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
  }

  dispose(): void {
    this.uninstall();
    this.clearWorld();
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
    this.ours = false;
    const world = this.world;
    if (!pending || this.main === null || this.mask === null || world === null) return;
    this.draws = 0;
    this.masks = 0;
    this.pull(this, this.glowOn);
    const n = Math.min(this.draws, this.capacity);
    this.draws = n;
    if (n === 0) return;
    this.ours = true;
    const queue = this.device.queue;
    queue.writeBuffer(world.matrixBuffer, 0, this.matrices, 0, n * 16);
    if (this.glowOn && this.masks > 0) queue.writeBuffer(world.glowBuffer, 0, this.glow, 0, n * 4);
    // The clock moves every frame, so the block is copied every frame drawn.
    this.block.write(this.recipe.values);
  };

  /** The fires in the main pass: a surface a draw, in the order pulled. */
  private readonly draw = (pass: GPURenderPassEncoder, ctx: FrameContext): void => {
    const world = this.world;
    if (!this.ours || world === null) return;
    const main = this.main!;
    if (!this.complete(main, world, ctx)) return;
    this.bind(pass, main, world, ctx);
    for (let d = 0; d < this.draws; d++) {
      const s = this.drawShape[d];
      pass.draw(world.count[s], 1, world.first[s], d);
    }
    this.stats.drawn = this.draws;
  };

  /** The fires' bloom, in the glow's mask after the billows': the mask's draws, in its order. */
  private readonly drawMask = (pass: GPURenderPassEncoder, ctx: FrameContext): void => {
    const world = this.world;
    if (!this.ours || !this.glowOn || this.masks === 0 || world === null) return;
    const mask = this.mask!;
    if (!this.complete(mask, world, ctx)) return;
    this.bind(pass, mask, world, ctx);
    for (let k = 0; k < this.masks; k++) {
      const d = this.maskOrder[k];
      const s = this.drawShape[d];
      pass.draw(world.count[s], 1, world.first[s], d);
    }
    this.stats.masked = this.masks;
  };

  /** Whether `built`'s groups — the frame's, the material's and the geometry — are whole this frame. */
  private complete(built: BuiltPipeline, world: WorldBuffers, ctx: FrameContext): boolean {
    return (
      ctx.frameGroup(built.groups[0]) !== null &&
      this.material.get(built.groups[1]) !== null &&
      world.geometry.get(built.groups[2]) !== null
    );
  }

  /** `built` and its groups (whole: `complete` said so) set on `pass`. */
  private bind(pass: GPURenderPassEncoder, built: BuiltPipeline, world: WorldBuffers, ctx: FrameContext): void {
    pass.setPipeline(built.pipeline);
    pass.setBindGroup(0, ctx.frameGroup(built.groups[0])!);
    pass.setBindGroup(1, this.material.get(built.groups[1])!);
    pass.setBindGroup(2, world.geometry.get(built.groups[2])!);
  }

  /** `Renderer.onRefused`: the main pass drew nothing of ours, these fires included. */
  private readonly refused = (): void => {
    if (this.ours) this.failed("the main pass was refused, so none of our fires can be drawn");
  };

  /** `Renderer.onGlowMaskRefused`: the mask drew nothing of ours, these fires' bloom included. */
  private readonly maskRefused = (): void => {
    if (this.ours && this.glowOn && this.masks > 0) this.failed("the glow's mask pass was refused, so none of our fires can bloom");
  };
}

/** A failure with nobody to tell: not installed. */
function ignore(): void {}
