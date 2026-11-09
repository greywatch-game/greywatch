/**
 * render/GrassDraw.ts — The grass field as OUR renderer draws it
 * (`BABYLON_EXIT.md` X4.6c): every blade patch mesh and every turf patch mesh
 * a run of one index buffer, drawn instanced with a patch an instance — the
 * `grass*` and `grassTurf*` meshes on two `ShaderMaterial`s that Babylon drew
 * until X4.6c, one draw for one.
 * Owns: `GrassDraw` — the two pipelines (`grassProgram.ts`), asked once for the
 * session; the field's block and group 1 (`setField`: its values, and the mask
 * on the GPU), each kind's seeds and indices (`setBlades`, `setTurf`) and its
 * patches' buffer, grown as a frame outruns it; the prepare that uploads a
 * frame, the blades' draw (`drawBlades`, which the run calls where they fall), the
 * turf's at `"opaque"`, the refusal listeners it holds while installed, and what
 * it drew last (`stats`); `GrassRun`, `GrassSeeds`.
 * Invariants: it DECIDES NOTHING — which patches are in view and which run each
 * goes on are `GrassSystem`'s, written into the runs from `tick`; whether a frame
 * draws is `Game.drawGrass`'s (`commit`, through the size gate), and where among the
 * rest the blades fall is the one run's (`NearestRun`, X4.6d), since every test is
 * LEQUAL and a depth this far from the near plane ties for real where a blade stands
 * in water; a run draws only with a patch on it, as a patch mesh with none was made
 * invisible, and the runs draw in the order `GrassSystem` built them, the order the
 * meshes were made in, which Babylon's lists kept. The turf is at `"opaque"`, past
 * the clouds and the floor it lands on, and nothing of ours is ahead of it there.
 * A frame with a pipeline unbuilt or no field set draws
 * no grass, as a material not ready drew none; a pipeline that FAILS is the round's
 * failure (`install`'s), told every round after it too, and so is a refused main
 * pass while it is installed — never inside the render's commands (the caller
 * defers it); nothing here allocates on a frame but the frame a patch buffer grows.
 * Never: imports Babylon; reads a node or a camera; casts a shadow, or draws in a
 * bake, the lamps' atlas or the glow's mask (the field was in none of them, read
 * off the BEFORE); draws while not installed.
 * Contract: `docs/rendering.md`, "The grass".
 *
 * WHAT A DRAW BINDS, by group: 0 the frame (`Renderer`'s), 1 the field's block and
 * mask, 2 the kind's seeds and patches, which its stage reads at the vertex the
 * index names and the patch `instance_index` names; a draw is `drawIndexed` over a
 * run's range, its instances a range of the patches.
 */
import {
  BLADE_GEOMETRY,
  BLADE_STATE,
  GRASS_BLOCK,
  GRASS_DEFINES,
  GRASS_MASK,
  grassPrograms,
  PATCH_FLOATS,
  TURF_GEOMETRY,
  TURF_STATE,
  type GrassProgram,
  type GrassValues,
} from "./grassProgram";
import { HostBindGroup, OwnTexture } from "./HostBindGroup";
import type { BuiltPipeline, PipelineState } from "./PipelineCache";
import type { FrameContext, Renderer } from "./Renderer";
import { FRAME_TARGETS } from "./targets";
import { UniformBlockBuffer } from "./UniformBlockBuffer";
import type { Binding } from "./wgsl/assemble";

/** One patch mesh: a range of its kind's indices, and the patches it draws this frame. */
export interface GrassRun {
  readonly firstIndex: number;
  readonly indexCount: number;
  readonly baseVertex: number;
  /** `PATCH_FLOATS` a patch, written by `GrassSystem` from `tick`. */
  patches: Float32Array<ArrayBuffer>;
  /** How many of them this frame. */
  count: number;
  /** Where in the kind's buffer they went up this frame: the prepare's. */
  firstInstance: number;
}

/** A kind's vertices, as its builder holds them: tight arrays, named as group 2 names them. */
export interface GrassSeeds {
  readonly positions: Float32Array<ArrayBuffer>;
  /** The blades' (side, rank, s0, s1); absent on the turf. */
  readonly blade?: Float32Array<ArrayBuffer>;
  readonly indices: Uint32Array<ArrayBuffer>;
}

/** The patches a kind's buffer starts with room for, across its runs. */
const FIRST_CAPACITY = 2048;

/** One kind of draw: its pipeline, its seeds on the GPU, its runs and its patches. */
class Kind {
  built: BuiltPipeline | null = null;
  runs: readonly GrassRun[] = [];
  index: GPUBuffer | null = null;
  seeds: GPUBuffer[] = [];
  patches: GPUBuffer | null = null;
  capacity = 0;
  arrays: HostBindGroup | null = null;
  /** The buffers by binding name: what `arrays` is remade from as the patches grow. */
  buffers: Record<string, GPUBuffer> = {};

  constructor(
    readonly label: string,
    readonly geometry: readonly Binding[],
  ) {}

  /** Off the GPU. Nothing drawn until the next `set`. */
  clear(): void {
    this.index?.destroy();
    for (const buffer of this.seeds) buffer.destroy();
    this.patches?.destroy();
    this.index = null;
    this.seeds = [];
    this.patches = null;
    this.capacity = 0;
    this.arrays = null;
    this.buffers = {};
    this.runs = [];
  }
}

export class GrassDraw {
  /** Whether both pipelines built — asked once, for the session; false if one failed. */
  readonly ready: Promise<boolean>;
  /** What the last frame drew, a draw a run. Nothing in the game reads it; a profiler capture does (`ProfileReport.pools.grass`) and the census. */
  readonly stats = { blades: 0, turf: 0 };

  private readonly device: GPUDevice;
  private readonly block: UniformBlockBuffer;
  private readonly bladeKind = new Kind("grass: blades", BLADE_GEOMETRY);
  private readonly turfKind = new Kind("grass: turf", TURF_GEOMETRY);

  private values: GrassValues | null = null;
  private mask: GPUTexture | null = null;
  private readonly maskHandle = new OwnTexture();
  private readonly material: HostBindGroup;

  private committed = false;
  /** This frame's verdict: committed, built, a field set. */
  private ours = false;

  private removes: (() => void)[] = [];
  private isInstalled = false;
  private failed: (reason: string) => void = ignore;
  private generation = 0;

  constructor(private readonly renderer: Renderer) {
    const device = renderer.device;
    this.device = device;
    this.block = new UniformBlockBuffer(device, GRASS_BLOCK, GRASS_DEFINES, "grass: field");
    this.material = new HostBindGroup(device, "grass: field", [GRASS_BLOCK, GRASS_MASK], GRASS_DEFINES, {
      [GRASS_BLOCK.var]: this.block.buffer,
    });
    this.maskHandle.sampler = device.createSampler({ label: "grass: mask" });
    const programs = grassPrograms();
    const ask = (program: GrassProgram, state: PipelineState, kind: Kind): Promise<boolean> =>
      renderer.pipelines
        .get({
          vertex: program.vertex,
          vertexEntry: "main",
          fragment: program.fragment,
          fragmentEntry: "main",
          targets: FRAME_TARGETS,
          state,
        })
        .then(
          (built) => {
            kind.built = built;
            return true;
          },
          (err: unknown) => {
            console.error(`grass: the ${kind.label} pipeline did not build; no grass can be drawn`, err);
            return false;
          },
        );
    this.ready = Promise.all([
      ask(programs.blade, BLADE_STATE, this.bladeKind),
      ask(programs.turf, TURF_STATE, this.turfKind),
    ]).then((oks) => oks.every(Boolean));
  }

  /**
   * The standing field: the block's values, read every frame it draws and written
   * in place by their owner, and the mask, uploaded here (row 0 the min-Z edge,
   * which is what the shader's `(xz - origin) / texel` puts at row 0).
   */
  setField(values: GrassValues, mask: Uint8Array<ArrayBuffer>, nx: number, nz: number): void {
    this.mask?.destroy();
    const device = this.device;
    const texture = device.createTexture({
      label: "grass: mask",
      size: { width: nx, height: nz },
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture({ texture }, mask, { bytesPerRow: nx * 4, rowsPerImage: nz }, { width: nx, height: nz });
    this.mask = texture;
    this.maskHandle.view = texture.createView({ label: "grass: mask" });
    this.material.refresh(this.renderer.host, { maskTex: this.maskHandle });
    this.values = values;
  }

  /** The blades' seeds and runs, replacing any before: a rung's. */
  setBlades(seeds: GrassSeeds, runs: readonly GrassRun[]): void {
    this.set(this.bladeKind, seeds, runs);
  }

  /** The turf's grids and runs, replacing any before. */
  setTurf(seeds: GrassSeeds, runs: readonly GrassRun[]): void {
    this.set(this.turfKind, seeds, runs);
  }

  /** The field goes: nothing is drawn or counted until the next `setField`. */
  clear(): void {
    this.bladeKind.clear();
    this.turfKind.clear();
    this.mask?.destroy();
    this.mask = null;
    this.maskHandle.view = null;
    this.material.refresh(this.renderer.host, { maskTex: this.maskHandle });
    this.values = null;
    this.committed = false;
    this.ours = false;
    this.stats.blades = 0;
    this.stats.turf = 0;
  }

  /** Whether a frame is owed: what the run's predicate asks. */
  get active(): boolean {
    return this.committed;
  }

  /** Whether this frame draws at all: the prepare's verdict, which the run reads. */
  get drawing(): boolean {
    return this.ours;
  }

  /**
   * Draws the field from the next frame on, the blades through the run
   * (`NearestRun`) and the turf here, asked ahead of everything else of ours at
   * `"opaque"` — telling `failed` if it cannot: a pipeline that failed (now or for
   * the session already), or the main pass refused. Replaces any earlier install's
   * failure.
   */
  install(failed: (reason: string) => void): void {
    this.uninstall();
    this.failed = failed;
    const generation = ++this.generation;
    void this.ready.then((ok) => {
      if (!ok && generation === this.generation) failed("the grass cannot draw: a pipeline of its failed");
    });
    const renderer = this.renderer;
    this.removes.push(
      renderer.onFrame(this.prepare),
      // Counted only on a frame something was committed (`Renderer.begin`).
      renderer.add(this.drawTurf, "opaque", () => this.committed),
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
    this.committed = false;
    this.ours = false;
    this.stats.blades = 0;
    this.stats.turf = 0;
  }

  /** This frame draws what the runs hold, through the render's prepare. */
  commit(): void {
    if (!this.isInstalled || this.values === null) return;
    this.committed = true;
    // This frame's, from here: a frame `Renderer.begin` skips runs neither the
    // prepare nor the draw that would reset them.
    this.stats.blades = 0;
    this.stats.turf = 0;
  }

  dispose(): void {
    this.uninstall();
    this.clear();
    this.block.destroy();
  }

  private set(kind: Kind, seeds: GrassSeeds, runs: readonly GrassRun[]): void {
    kind.clear();
    const device = this.device;
    const up = (label: string, data: ArrayBufferView<ArrayBuffer>, usage: number): GPUBuffer => {
      const made = device.createBuffer({
        label: `${kind.label}: ${label}`,
        size: Math.max(16, Math.ceil(data.byteLength / 4) * 4),
        usage,
        mappedAtCreation: true,
      });
      new Uint8Array(made.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      made.unmap();
      return made;
    };
    kind.index = up("indices", seeds.indices, GPUBufferUsage.INDEX);
    const positions = up("positions", seeds.positions, GPUBufferUsage.STORAGE);
    kind.seeds.push(positions);
    kind.buffers.positionData = positions;
    if (seeds.blade) {
      const blade = up("seeds", seeds.blade, GPUBufferUsage.STORAGE);
      kind.seeds.push(blade);
      kind.buffers.bladeData = blade;
    }
    kind.runs = runs;
    this.growPatches(kind, FIRST_CAPACITY);
  }

  /** A kind's patches' buffer at `capacity` patches, and group 2 over it. */
  private growPatches(kind: Kind, capacity: number): void {
    kind.patches?.destroy();
    const patches = this.device.createBuffer({
      label: `${kind.label}: patches`,
      size: capacity * PATCH_FLOATS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    kind.patches = patches;
    kind.capacity = capacity;
    kind.buffers.patches = patches;
    kind.arrays = new HostBindGroup(this.device, `${kind.label}: geometry`, kind.geometry, [], kind.buffers);
    // No textures: resolved once, whole for good.
    kind.arrays.refresh(this.renderer.host, {});
  }

  /**
   * A kind's runs up: each one's patches end to end. Inside the render but ahead of
   * every draw of this frame, and the frame before it is submitted, so a buffer
   * outgrown here holds nothing a command still names.
   */
  private upload(kind: Kind): void {
    const runs = kind.runs;
    let total = 0;
    for (let i = 0; i < runs.length; i++) total += runs[i].count;
    if (total > kind.capacity) {
      let capacity = kind.capacity;
      while (total > capacity) capacity *= 2;
      this.growPatches(kind, capacity);
    }
    const queue = this.device.queue;
    const patches = kind.patches!;
    let at = 0;
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i];
      run.firstInstance = at;
      if (run.count === 0) continue;
      queue.writeBuffer(patches, at * PATCH_FLOATS * 4, run.patches, 0, run.count * PATCH_FLOATS);
      at += run.count;
    }
  }

  /** As the main pass begins — inside the render, the camera placed: this frame's verdict and its uploads. */
  private readonly prepare = (): void => {
    const committed = this.committed;
    this.committed = false;
    this.stats.blades = 0;
    this.stats.turf = 0;
    const values = this.values;
    const blades = this.bladeKind;
    const turf = this.turfKind;
    this.ours =
      committed &&
      values !== null &&
      blades.built !== null &&
      turf.built !== null &&
      blades.arrays !== null &&
      turf.arrays !== null;
    if (!this.ours) return;
    this.upload(blades);
    this.upload(turf);
    this.block.write(values!);
  };

  /** The blades, where the run has them fall (`NearestRun`). */
  drawBlades(pass: GPURenderPassEncoder, ctx: FrameContext): void {
    this.stats.blades = this.drawKind(pass, ctx, this.bladeKind);
  }

  private readonly drawTurf = (pass: GPURenderPassEncoder, ctx: FrameContext): void => {
    this.stats.turf = this.drawKind(pass, ctx, this.turfKind);
  };

  /** A kind's runs with a patch on them, in their order: how many it drew. */
  private drawKind(pass: GPURenderPassEncoder, ctx: FrameContext, kind: Kind): number {
    if (!this.ours) return 0;
    const built = kind.built!;
    const frame = ctx.frameGroup(built.groups[0]);
    const material = this.material.get(built.groups[1]);
    const arrays = kind.arrays!.get(built.groups[2]);
    // A texture of the frame's not published: nothing of ours draws.
    if (!frame || !material || !arrays) return 0;
    pass.setPipeline(built.pipeline);
    pass.setBindGroup(0, frame);
    pass.setBindGroup(1, material);
    pass.setBindGroup(2, arrays);
    pass.setIndexBuffer(kind.index!, "uint32");
    const runs = kind.runs;
    let drawn = 0;
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i];
      if (run.count === 0) continue;
      pass.drawIndexed(run.indexCount, run.count, run.firstIndex, run.baseVertex, run.firstInstance);
      drawn++;
    }
    return drawn;
  }

  /** `Renderer.onRefused`: the main pass drew nothing of ours, this included. */
  private readonly refused = (): void => {
    if (this.ours) this.failed("the main pass was refused, so no grass can be drawn");
  };
}

/** A failure with nobody to tell: not installed. */
function ignore(): void {}
