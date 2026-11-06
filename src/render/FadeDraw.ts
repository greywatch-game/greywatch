/**
 * render/FadeDraw.ts — The FADING pools as OUR renderer draws them
 * (`BABYLON_EXIT.md` X4.6e): an impact's sparks and dust discs, a blast's
 * scorch marks and every body's blob shadow — the `spark*`, `impact*`,
 * `blastScorch*` and `blobShadow` meshes Babylon's transparent list drew until
 * X4.6e, one draw for one, each an instance of its kit — in the one
 * back-to-front run (`FarthestRun`), and a spark's bloom again in the glow's
 * mask, where Babylon's mask list drew it.
 * Owns: `FadeDraw` — the kits' arrays on the GPU (positions and uvs end to
 * end, their indices, each kit's range), this frame's drawn fades' worlds,
 * looks and blooms (`world`, `look`, `glow`, `kit`, which the run's pull
 * writes, and their upload, `upload`), the colours' and fog band's block and
 * the three group 1s (plain, and one a map), the pipelines — the emissive
 * one, the scorch's, the blob's and the mask's, asked once for the session —
 * the refusal listeners it holds while installed, and what it drew last
 * (`stats`).
 * Invariants: it DECIDES NOTHING — which member is drawn this frame (its
 * switch, its visibility over 0, the size gate where its mesh was not
 * emissive, the frustum), in what order, and its world, look and bloom are
 * the pull's (`Game.farthestPull`), the member's transform, fade and paint
 * its pool's; the pipeline state is each mesh's material's, read off the
 * BEFORE's pipelines: blended as Babylon's `ALPHA_COMBINE` (colour
 * `SRC_ALPHA, ONE_MINUS_SRC_ALPHA`, alpha `ONE, ONE`), no depth written,
 * LEQUAL, back faces culled but for the scorch's (none), and the scorch alone
 * biased (`zOffsetUnits` -4 and `zOffset` -2, the bias and its slope); the
 * mask's twin is the spark's, blended as the mask material drew a mesh under
 * `visibility` 1, its colour `GlowRules`' (the pull's `glow`); the two maps
 * stay Babylon's textures, read through the seam (`hostTexture`, rule 5), so
 * their canvases' decode and their samplers are what they were; the arrays
 * are uploaded as Babylon uploaded a mesh's (float32); a frame with a
 * pipeline unbuilt or a map unpublished draws no fade; a pipeline that FAILS
 * is the round's failure (`install`'s), and so is a refused main pass or mask
 * while it is installed — never inside the render's commands (the caller
 * defers it, `Game.worldFailed`); a frame allocates nothing, but a frame
 * drawing more fades than any before it grows the arrays once.
 * Never: imports Babylon; reads a node or a pool; casts a shadow, or draws in
 * a bake or the lamps' atlas (no fade was in either); draws a disc, a scorch
 * or a blob in the mask (each was `noGlow`); draws while not installed (the
 * menu, an editor build, where no pool is ever raised).
 * Contract: `docs/rendering.md`, "The pools, ours".
 *
 * WHAT A DRAW BINDS, by group: 0 the frame (`Renderer`'s), 1 the colours and
 * band — and the scorch's or the blob's map — and 2 the kits' arrays and the
 * drawn fades'; a draw is `drawIndexed` over its kit's range, its instance
 * the fade's index among this frame's drawn ones.
 */
import { PLACED_WORDS } from "./celVertex";
import type { EmissiveRecipe } from "./emissiveWorld";
import { FADE_BLOCK, FADE_GEOMETRY, FADE_TEXTURES, fadeDefines, fadePrograms, type FadeVariant } from "./fadeProgram";
import type { HostTexture } from "./frameHost";
import { HostBindGroup } from "./HostBindGroup";
import type { BuiltPipeline, PipelineState } from "./PipelineCache";
import type { FrameContext, Renderer } from "./Renderer";
import { FRAME_TARGETS, GLOW_TARGETS } from "./targets";
import { UniformBlockBuffer } from "./UniformBlockBuffer";

/** One kit's arrays, as its pool made its meshes of them. */
export interface FadeShape {
  readonly positions: ArrayLike<number>;
  readonly uvs: ArrayLike<number> | null;
  readonly indices: ArrayLike<number>;
}

/** `ALPHA_COMBINE`'s factors (Babylon's `alphaCullingState`, mode 2): every fade's, in both passes. */
const FADE_BLEND: GPUBlendState = {
  color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
};

/** Each variant's state, off the BEFORE's pipelines (`surfaces.mjs`); `shaders.mjs` builds each in it. */
export const FADE_STATES: Readonly<Record<FadeVariant, PipelineState>> = {
  emissive: { depthWrite: false, blend: FADE_BLEND },
  scorch: { depthWrite: false, blend: FADE_BLEND, cullMode: "none", depthBias: -4, depthBiasSlopeScale: -2 },
  blob: { depthWrite: false, blend: FADE_BLEND },
  mask: { depthWrite: false, blend: FADE_BLEND },
};

/** Which variant draws each kit (`entities/fades.ts`' `FADE_KITS` order) in the main pass. */
const KIT_VARIANT: readonly FadeVariant[] = ["emissive", "emissive", "scorch", "blob"];

/** Floats a drawn fade takes in `look` and `glow`. */
const VEC4 = 4;

export class FadeDraw {
  /** Whether every pipeline built — asked once, for the session; false if one failed. */
  readonly ready: Promise<boolean>;
  /** What the last frame drew: main-pass draws, mask draws. Nothing in the game reads it; a profiler capture does (`ProfileReport.pools.fades`) and the census. */
  readonly stats = { drawn: 0, masked: 0 };
  /** This frame's drawn fades, by their index among them: written by the run's pull. */
  world = new Float32Array(0);
  look = new Float32Array(0);
  glow = new Float32Array(0);
  /** Each drawn fade's kit (`FADE_KITS`' index). */
  kit = new Uint8Array(0);
  /** How many fades the arrays hold room for: `reserve` grows them. */
  capacity = 0;

  private readonly device: GPUDevice;
  private readonly pipelines: Record<FadeVariant, BuiltPipeline | null> = { emissive: null, scorch: null, blob: null, mask: null };
  private readonly block: UniformBlockBuffer;
  /** Group 1: the plain one (the sparks', the discs', the mask's) and one a map. */
  private readonly plain: HostBindGroup;
  private readonly scorchGroup: HostBindGroup;
  private readonly blobGroup: HostBindGroup;
  private readonly scorchHandles: { readonly opacityTex: HostTexture };
  private readonly blobHandles: { readonly opacityTex: HostTexture };
  /** Each kit's indices: first, count, base vertex. */
  private readonly ranges: Uint32Array;
  private readonly index: GPUBuffer;
  private readonly positionBuffer: GPUBuffer;
  private readonly uvBuffer: GPUBuffer;
  private worldBuffer: GPUBuffer | null = null;
  private lookBuffer: GPUBuffer | null = null;
  private glowBuffer: GPUBuffer | null = null;
  private geometry: HostBindGroup | null = null;
  /** The factory's epoch as last copied; NaN is never. */
  private epoch = Number.NaN;

  private committed = false;
  private glowOn = false;
  /** This frame's verdict: committed, built, a map published. */
  private ours = false;
  /** What the run drew last, so a run of fades binds only what changes. */
  private bound: BuiltPipeline | null = null;
  private worn: HostBindGroup | null = null;

  private removes: (() => void)[] = [];
  private isInstalled = false;
  private failed: (reason: string) => void = ignore;
  private generation = 0;

  constructor(
    private readonly renderer: Renderer,
    /** The four kits' arrays, in `FADE_KITS`' order. */
    kits: readonly FadeShape[],
    /** The sparks' and the discs' colours, a slot each, and the factory's fog band, by reference. */
    private readonly paint: EmissiveRecipe,
    /** The factory's epoch: `paint`'s values are copied again when it moves. */
    private readonly epochOf: () => number,
    /** The scorch's map and the blob's, Babylon's textures through the seam. */
    scorchMap: HostTexture,
    blobMap: HostTexture,
  ) {
    const device = renderer.device;
    this.device = device;
    let vertices = 0;
    let indices = 0;
    this.ranges = new Uint32Array(kits.length * 3);
    kits.forEach((k, i) => {
      this.ranges[i * 3] = indices;
      this.ranges[i * 3 + 1] = k.indices.length;
      this.ranges[i * 3 + 2] = vertices;
      vertices += k.positions.length / 3;
      indices += k.indices.length;
    });
    const positions = new Float32Array(vertices * 3);
    const uvs = new Float32Array(vertices * 2);
    const index = new Uint32Array(indices);
    kits.forEach((k, i) => {
      const base = this.ranges[i * 3 + 2];
      positions.set(k.positions, base * 3);
      if (k.uvs) uvs.set(k.uvs, base * 2);
      index.set(k.indices, this.ranges[i * 3]);
    });
    const up = (label: string, data: ArrayBufferView<ArrayBuffer>, usage: number): GPUBuffer => {
      const made = device.createBuffer({
        label: `fades: ${label}`,
        size: Math.max(16, Math.ceil(data.byteLength / 4) * 4),
        usage,
        mappedAtCreation: true,
      });
      new Uint8Array(made.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      made.unmap();
      return made;
    };
    this.index = up("indices", index, GPUBufferUsage.INDEX);
    this.positionBuffer = up("positions", positions, GPUBufferUsage.STORAGE);
    this.uvBuffer = up("uvs", uvs, GPUBufferUsage.STORAGE);
    this.block = new UniformBlockBuffer(device, FADE_BLOCK, [], "fades: paint");
    const group = (label: string, variant: FadeVariant) =>
      new HostBindGroup(device, `fades: ${label}`, [FADE_BLOCK, ...FADE_TEXTURES], fadeDefines(variant), {
        [FADE_BLOCK.var]: this.block.buffer,
      });
    this.plain = group("paint", "emissive");
    this.plain.refresh(renderer.host, {});
    this.scorchGroup = group("scorch", "scorch");
    this.blobGroup = group("blob", "blob");
    this.scorchHandles = { opacityTex: scorchMap };
    this.blobHandles = { opacityTex: blobMap };
    this.reserve(64);
    const asks = (Object.keys(FADE_STATES) as FadeVariant[]).map((variant) => {
      const program = fadePrograms(variant);
      return renderer.pipelines
        .get({
          vertex: program.vertex,
          vertexEntry: "main",
          fragment: program.fragment,
          fragmentEntry: "main",
          targets: variant === "mask" ? GLOW_TARGETS : FRAME_TARGETS,
          state: FADE_STATES[variant],
        })
        .then(
          (built) => {
            this.pipelines[variant] = built;
            return true;
          },
          (err: unknown) => {
            console.error(`fades: the ${variant} pipeline did not build; no spark, disc, scorch or blob can be drawn`, err);
            return false;
          },
        );
    });
    this.ready = Promise.all(asks).then((oks) => oks.every(Boolean));
  }

  /** Whether a frame is owed: what the run's predicates ask. */
  get active(): boolean {
    return this.committed;
  }

  /** Whether this frame draws at all: the prepare's verdict, which the run's pull reads. */
  get drawing(): boolean {
    return this.ours;
  }

  /** Whether the mask draws this frame: drawing, and the glow admitting. */
  get masking(): boolean {
    return this.ours && this.glowOn;
  }

  /** Whether a round's install stands. */
  get installed(): boolean {
    return this.isInstalled;
  }

  /**
   * Room for `n` drawn fades in the arrays, grown — never shrunk — by
   * doubling: the one allocation a frame may make, and only past the most
   * any frame before it drew. Asked by the pull before it writes.
   */
  reserve(n: number): void {
    if (n <= this.capacity) return;
    let cap = Math.max(64, this.capacity);
    while (cap < n) cap *= 2;
    const world = new Float32Array(cap * PLACED_WORDS);
    const look = new Float32Array(cap * VEC4);
    const glow = new Float32Array(cap * VEC4);
    world.set(this.world);
    look.set(this.look);
    glow.set(this.glow);
    const kit = new Uint8Array(cap);
    kit.set(this.kit);
    this.world = world;
    this.look = look;
    this.glow = glow;
    this.kit = kit;
    this.capacity = cap;
    this.worldBuffer?.destroy();
    this.lookBuffer?.destroy();
    this.glowBuffer?.destroy();
    const device = this.device;
    const storage = (label: string, bytes: number) =>
      device.createBuffer({ label: `fades: ${label}`, size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.worldBuffer = storage("worlds", world.byteLength);
    this.lookBuffer = storage("looks", look.byteLength);
    this.glowBuffer = storage("blooms", glow.byteLength);
    this.geometry = new HostBindGroup(device, "fades: geometry", FADE_GEOMETRY, [], {
      positionData: this.positionBuffer,
      uvData: this.uvBuffer,
      fadeWorld: this.worldBuffer,
      fadeLook: this.lookBuffer,
      fadeGlow: this.glowBuffer,
    });
    this.geometry.refresh(this.renderer.host, {});
  }

  /** The first `n` drawn fades' worlds, looks and blooms queued for this frame: the run's pull, once it has written them. */
  upload(n: number): void {
    if (n === 0 || !this.worldBuffer) return;
    const queue = this.device.queue;
    queue.writeBuffer(this.worldBuffer, 0, this.world, 0, n * PLACED_WORDS);
    queue.writeBuffer(this.lookBuffer!, 0, this.look, 0, n * VEC4);
    queue.writeBuffer(this.glowBuffer!, 0, this.glow, 0, n * VEC4);
  }

  /**
   * Draws from the next frame on, through the run (`FarthestRun`) and its
   * mask, telling `failed` if it cannot: a pipeline that failed (now or for
   * the session already), or a refused main pass or mask. Replaces any
   * earlier install's failure.
   */
  install(failed: (reason: string) => void): void {
    this.uninstall();
    this.failed = failed;
    const generation = ++this.generation;
    void this.ready.then((ok) => {
      if (!ok && generation === this.generation) failed("the sparks, dust, scorch and blobs cannot draw: a pipeline of theirs failed");
    });
    const renderer = this.renderer;
    this.removes.push(
      renderer.onFrame(this.prepare),
      renderer.onRefused(this.refused),
      renderer.onGlowMaskRefused(this.maskRefused),
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
    this.committed = false;
    this.ours = false;
    this.stats.drawn = 0;
    this.stats.masked = 0;
  }

  /** This frame may draw: the members themselves are read inside the render, `glowOn` whether the glow admits. */
  commit(glowOn: boolean): void {
    if (!this.isInstalled) return;
    this.committed = true;
    this.glowOn = glowOn;
    this.stats.drawn = 0;
    this.stats.masked = 0;
  }

  dispose(): void {
    this.uninstall();
    this.index.destroy();
    this.positionBuffer.destroy();
    this.uvBuffer.destroy();
    this.worldBuffer?.destroy();
    this.lookBuffer?.destroy();
    this.glowBuffer?.destroy();
    this.block.destroy();
  }

  /** Drawn fade `k` in the run's order; `fresh` when something else of the run drew last. */
  drawFade(pass: GPURenderPassEncoder, ctx: FrameContext, k: number, fresh: boolean): void {
    if (!this.ours) return;
    if (fresh) {
      this.bound = null;
      this.worn = null;
    }
    const kit = this.kit[k];
    const variant = KIT_VARIANT[kit];
    const group = variant === "scorch" ? this.scorchGroup : variant === "blob" ? this.blobGroup : this.plain;
    if (this.drawOne(pass, ctx, this.pipelines[variant]!, group, kit, k)) this.stats.drawn++;
  }

  /** Drawn fade `k` into the glow's mask, in the run's order: a spark's twin. */
  maskFade(pass: GPURenderPassEncoder, ctx: FrameContext, k: number, fresh: boolean): void {
    if (fresh) {
      this.bound = null;
      this.worn = null;
    }
    if (this.drawOne(pass, ctx, this.pipelines.mask!, this.plain, this.kit[k], k)) this.stats.masked++;
  }

  private drawOne(
    pass: GPURenderPassEncoder,
    ctx: FrameContext,
    built: BuiltPipeline,
    material: HostBindGroup,
    kit: number,
    k: number,
  ): boolean {
    if (built !== this.bound) {
      const frame = ctx.frameGroup(built.groups[0]);
      const arrays = this.geometry!.get(built.groups[2]);
      if (!frame || !arrays) return false;
      pass.setPipeline(built.pipeline);
      pass.setBindGroup(0, frame);
      pass.setBindGroup(2, arrays);
      pass.setIndexBuffer(this.index, "uint32");
      this.bound = built;
      this.worn = null;
    }
    if (material !== this.worn) {
      const group = material.get(built.groups[1]);
      if (!group) return false;
      pass.setBindGroup(1, group);
      this.worn = material;
    }
    const r = this.ranges;
    pass.drawIndexed(r[kit * 3 + 1], 1, r[kit * 3], r[kit * 3 + 2], k);
    return true;
  }

  /** As the main pass begins — inside the render: this frame's verdict, the paint copied when it moved, the maps asked. */
  private readonly prepare = (): void => {
    const committed = this.committed;
    this.committed = false;
    this.stats.drawn = 0;
    this.stats.masked = 0;
    const p = this.pipelines;
    this.ours = committed && p.emissive !== null && p.scorch !== null && p.blob !== null && p.mask !== null;
    if (!this.ours) return;
    const epoch = this.epochOf();
    if (epoch !== this.epoch) {
      this.epoch = epoch;
      this.block.write(this.paint.values);
    }
    const host = this.renderer.host;
    this.scorchGroup.refresh(host, this.scorchHandles);
    this.blobGroup.refresh(host, this.blobHandles);
  };

  /** `Renderer.onRefused`: the main pass drew nothing of ours, these included. */
  private readonly refused = (): void => {
    if (this.ours) this.failed("the main pass was refused, so no spark, disc, scorch or blob can be drawn");
  };

  /** `Renderer.onGlowMaskRefused`: the mask drew nothing of ours, the sparks' bloom included. */
  private readonly maskRefused = (): void => {
    if (this.masking) this.failed("the glow's mask was refused, so no spark can bloom");
  };
}

/** A failure with nobody to tell: not installed. */
function ignore(): void {}
