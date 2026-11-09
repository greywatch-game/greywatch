/**
 * render/WaterDraw.ts — The water as OUR renderer draws it (`BABYLON_EXIT.md`
 * X4.6d): every body of water its grid or its far quad, a range of one index
 * buffer — the `water` and `waterFar` meshes on a `ShaderMaterial` that Babylon's
 * opaque list drew until X4.6d, one draw for one.
 * Owns: `WaterDraw` — the pipeline (`waterProgram.ts`), asked once for the session;
 * the shared block and a group 0 of the water's own (`WATER_FRAME_GROUP`), the grid
 * and the quad on the GPU (`setGeometry`), each body's block, its bed-depth texture
 * and its group 1 (`addBody`), the two samplers, the order this frame draws them in
 * (`order`, `keys`, `draws`, which the run's pull writes), the prepare that uploads
 * a frame, the refusal listeners it holds while installed and what it drew last
 * (`stats`); `WaterSurface`, `WaterShape`, `WaterMirror`.
 * Invariants: it DECIDES NOTHING — which of a body's two shapes is drawn is
 * `WaterSystem`'s (`near`), whether it passes the size gate is `Game.drawWater`'s
 * (`kept`), and where it falls among everything else nearest first is the run's
 * (`NearestRun`); the foam mask stays a texture of Babylon's, read through the seam
 * (`hostTexture`, rule 5), so its decode and its mips are what they were; the
 * bed-depth texture is ours, `r8unorm`, row 0 the min-Z edge, sampled as Babylon
 * sampled it (linear, clamped, anisotropic, whatever its one level); a cube is READ
 * where the bake left it, through a view of its own over all six faces and every
 * level, sampled as `wrapCubeTexture`'s view was; a frame with the pipeline unbuilt
 * draws no water, as a material not ready drew none; a pipeline that FAILS is the
 * round's failure (`install`'s), told every round after it too, and so is a refused
 * main pass while it is installed — never inside the render's commands (the caller
 * defers it); a frame makes nothing here past the first bind of a group.
 * Never: imports Babylon; reads a node or a camera; casts a shadow, or draws in a
 * bake, the lamps' atlas or the glow's mask (the water was in none of them, measured
 * at X4.6d's BEFORE); destroys a cube, which is the bake's pool's; draws while not
 * installed.
 * Contract: `docs/rendering.md`, "The water".
 *
 * WHAT A DRAW BINDS, by group: 0 the frame's block and shadow maps, 1 the shared
 * block, the body's and its three textures, 2 the vertices its stage reads at the
 * index it names; a draw is `drawIndexed` over the grid's or the quad's range.
 */
import type { HostTexture } from "./frameHost";
import { HostBindGroup, OwnTexture } from "./HostBindGroup";
import type { BuiltPipeline } from "./PipelineCache";
import type { Renderer } from "./Renderer";
import { FRAME_TARGETS } from "./targets";
import { UniformBlockBuffer } from "./UniformBlockBuffer";
import {
  WATER_BODY,
  WATER_DEFINES,
  WATER_FRAME_GROUP,
  WATER_GEOMETRY,
  WATER_GROUP,
  WATER_SHARED,
  WATER_STATE,
  waterProgram,
  type WaterBodyValues,
  type WaterShared,
} from "./waterProgram";

/** One range of the grid's and the quad's indices. */
interface Range {
  readonly first: number;
  readonly count: number;
  readonly baseVertex: number;
}

/** A shape's vertices and indices: `position.y` is the cell, the wave's sampling test. */
export interface WaterShape {
  readonly positions: Float32Array<ArrayBuffer>;
  readonly indices: Uint32Array<ArrayBuffer>;
}

/** What a body's mirror is: a cube of the bake's, where it stands, and how much of it shows. */
export interface WaterMirror {
  readonly cube: GPUTexture;
  readonly at: { readonly x: number; readonly y: number; readonly z: number };
  /** 0: the analytic sky alone, what a build that bakes nothing draws over the default cube. */
  readonly strength: number;
}

/** One body of water: its two shapes' one sphere, and what it binds. */
export class WaterSurface {
  /** The grid, for when the eye is near enough to see it move; the quad otherwise (`WaterSystem.follow`). */
  near = true;
  /** This frame's: through the size gate (`Game.drawWater`). */
  kept = false;

  constructor(
    /** Its bounding sphere, as both its meshes held it. */
    readonly x: number,
    readonly y: number,
    readonly z: number,
    readonly radius: number,
    readonly block: UniformBlockBuffer,
    readonly bed: GPUTexture,
    readonly group: HostBindGroup,
    readonly handles: { readonly foamTex: HostTexture; readonly depthTex: OwnTexture; readonly reflectionCube: OwnTexture },
  ) {}
}

export class WaterDraw {
  /** Whether the pipeline built — asked once, for the session; false if it failed. */
  readonly ready: Promise<boolean>;
  /** What the last frame drew, a draw a body. Nothing in the game reads it; a profiler capture does (`ProfileReport.pools.water`) and the census. */
  readonly stats = { drawn: 0 };
  /** The standing map's bodies, in the order of its rects. */
  readonly surfaces: WaterSurface[] = [];
  /** Which surfaces this frame draws, nearest first: the run's pull writes it. */
  order = new Int32Array(0);
  /** Each drawn surface's distance from the eye, squared, in that order. */
  keys = new Float64Array(0);
  /** How many of `order` this frame draws. */
  draws = 0;

  private readonly device: GPUDevice;
  private built: BuiltPipeline | null = null;
  private readonly shared: UniformBlockBuffer;
  private values: WaterShared | null = null;
  private readonly frameGroup: HostBindGroup;
  /** As Babylon's `RawTexture` at `BILINEAR_SAMPLINGMODE` sampled: its anisotropy turns the mip filter on. */
  private readonly bedSampler: GPUSampler;
  /** As `wrapCubeTexture`'s view sampled: trilinear, anisotropic, and the wrap its coordinates mode gives. */
  private readonly cubeSampler: GPUSampler;

  private index: GPUBuffer | null = null;
  private vertices: GPUBuffer | null = null;
  private geometry: HostBindGroup | null = null;
  private grid: Range = { first: 0, count: 0, baseVertex: 0 };
  private quad: Range = { first: 0, count: 0, baseVertex: 0 };

  private committed = false;
  /** This frame's verdict: committed, built, a body standing. */
  private ours = false;

  private removes: (() => void)[] = [];
  private isInstalled = false;
  private failed: (reason: string) => void = ignore;
  private generation = 0;

  constructor(private readonly renderer: Renderer) {
    const device = renderer.device;
    this.device = device;
    this.shared = new UniformBlockBuffer(device, WATER_SHARED, WATER_DEFINES, "water: shared");
    this.frameGroup = new HostBindGroup(device, "water: frame", WATER_FRAME_GROUP, WATER_DEFINES, {
      frame: renderer.frameBuffer.buffer,
    });
    this.bedSampler = device.createSampler({
      label: "water: bed",
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      maxAnisotropy: 4,
    });
    this.cubeSampler = device.createSampler({
      label: "water: mirror",
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "repeat",
      addressModeV: "repeat",
      addressModeW: "repeat",
      maxAnisotropy: 4,
    });
    const program = waterProgram();
    this.ready = renderer.pipelines
      .get({
        vertex: program.vertex,
        vertexEntry: "main",
        fragment: program.fragment,
        fragmentEntry: "main",
        targets: FRAME_TARGETS,
        state: WATER_STATE,
      })
      .then(
        (built) => {
          this.built = built;
          return true;
        },
        (err: unknown) => {
          console.error("water: the pipeline did not build; no water can be drawn", err);
          return false;
        },
      );
  }

  /** Whether a frame is owed: what the run's predicate asks. */
  get active(): boolean {
    return this.committed;
  }

  /** Whether this frame draws at all: the prepare's verdict, which the run's pull reads. */
  get drawing(): boolean {
    return this.ours;
  }

  /** The standing map's shapes: the grid and the far quad, end to end. Destroys nothing, so a `clear` is owed first (`WaterSystem.build`'s `dispose`). */
  setGeometry(grid: WaterShape, quad: WaterShape, values: WaterShared): void {
    const device = this.device;
    const positions = new Float32Array(grid.positions.length + quad.positions.length);
    positions.set(grid.positions, 0);
    positions.set(quad.positions, grid.positions.length);
    const indices = new Uint32Array(grid.indices.length + quad.indices.length);
    indices.set(grid.indices, 0);
    indices.set(quad.indices, grid.indices.length);
    const up = (label: string, data: ArrayBufferView<ArrayBuffer>, usage: number): GPUBuffer => {
      const made = device.createBuffer({ label: `water: ${label}`, size: data.byteLength, usage, mappedAtCreation: true });
      new Uint8Array(made.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      made.unmap();
      return made;
    };
    this.index = up("indices", indices, GPUBufferUsage.INDEX);
    this.vertices = up("vertices", positions, GPUBufferUsage.STORAGE);
    this.geometry = new HostBindGroup(device, "water: geometry", WATER_GEOMETRY, [], { positionData: this.vertices });
    // No textures: resolved once, whole for good.
    this.geometry.refresh(this.renderer.host, {});
    this.grid = { first: 0, count: grid.indices.length, baseVertex: 0 };
    this.quad = { first: grid.indices.length, count: quad.indices.length, baseVertex: grid.positions.length / 3 };
    this.values = values;
  }

  /**
   * One body: its block written once, its bed-depth map uploaded (one byte a texel,
   * row 0 the min-Z edge, which is what the body's `bedUv` puts at v = 0), a view of
   * its mirror, and its sphere off its box (min then max), as
   * `BoundingSphere.reConstruct` read the box both its meshes held.
   */
  addBody(
    values: WaterBodyValues,
    bed: { readonly data: Uint8Array<ArrayBuffer>; readonly nx: number; readonly nz: number },
    foam: HostTexture,
    mirror: GPUTexture,
    box: readonly [number, number, number, number, number, number],
  ): WaterSurface {
    const device = this.device;
    const label = `water: body ${this.surfaces.length}`;
    const block = new UniformBlockBuffer(device, WATER_BODY, WATER_DEFINES, label);
    block.write(values);
    const texture = device.createTexture({
      label,
      size: { width: bed.nx, height: bed.nz },
      format: "r8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture({ texture }, bed.data, { bytesPerRow: bed.nx, rowsPerImage: bed.nz }, { width: bed.nx, height: bed.nz });
    const depthTex = new OwnTexture();
    depthTex.view = texture.createView({ label });
    depthTex.sampler = this.bedSampler;
    const reflectionCube = new OwnTexture();
    reflectionCube.view = mirror.createView({ label, dimension: "cube" });
    reflectionCube.sampler = this.cubeSampler;
    const group = new HostBindGroup(device, label, WATER_GROUP, WATER_DEFINES, {
      waterShared: this.shared.buffer,
      waterBody: block.buffer,
    });
    const dx = box[3] - box[0];
    const dy = box[4] - box[1];
    const dz = box[5] - box[2];
    const surface = new WaterSurface(
      (box[3] + box[0]) * 0.5,
      (box[4] + box[1]) * 0.5,
      (box[5] + box[2]) * 0.5,
      Math.sqrt(dx * dx + dy * dy + dz * dz) * 0.5,
      block,
      texture,
      group,
      { foamTex: foam, depthTex, reflectionCube },
    );
    this.surfaces.push(surface);
    this.order = new Int32Array(this.surfaces.length);
    this.keys = new Float64Array(this.surfaces.length);
    return surface;
  }

  /** The water goes: nothing is drawn or counted until the next `setGeometry`. Every cube stays the bake's. */
  clear(): void {
    this.index?.destroy();
    this.vertices?.destroy();
    this.index = null;
    this.vertices = null;
    this.geometry = null;
    for (const surface of this.surfaces) {
      surface.block.destroy();
      surface.bed.destroy();
    }
    this.surfaces.length = 0;
    this.values = null;
    this.draws = 0;
    this.committed = false;
    this.ours = false;
    this.stats.drawn = 0;
  }

  /**
   * Draws the water from the next frame on, through the run (`NearestRun`), telling
   * `failed` if it cannot: the pipeline failed (now or for the session already), or
   * the main pass refused. Replaces any earlier install's failure.
   */
  install(failed: (reason: string) => void): void {
    this.uninstall();
    this.failed = failed;
    const generation = ++this.generation;
    void this.ready.then((ok) => {
      if (!ok && generation === this.generation) failed("the water cannot draw: its pipeline failed");
    });
    const renderer = this.renderer;
    this.removes.push(renderer.onFrame(this.prepare), renderer.onRefused(this.refused));
    this.isInstalled = true;
  }

  /** Draws nothing again until the next `install`, and tells nobody of anything. */
  uninstall(): void {
    this.generation++;
    for (const remove of this.removes) remove();
    this.removes.length = 0;
    this.isInstalled = false;
    this.failed = ignore;
    this.draws = 0;
    this.committed = false;
    this.ours = false;
    this.stats.drawn = 0;
  }

  /** This frame draws: the surfaces' `kept` written, the order asked inside the render. */
  commit(): void {
    if (!this.isInstalled || this.surfaces.length === 0) return;
    this.committed = true;
    // This frame's, from here: a frame `Renderer.begin` skips runs neither the
    // prepare nor the draw that would reset it.
    this.stats.drawn = 0;
  }

  dispose(): void {
    this.uninstall();
    this.clear();
    this.shared.destroy();
  }

  /** A run of the order in the main pass: everything bound afresh, whatever drew before it. */
  drawRange(pass: GPURenderPassEncoder, from: number, to: number): void {
    if (!this.ours || from >= to) return;
    const built = this.built!;
    const frame = this.frameGroup.get(built.groups[0]);
    const arrays = this.geometry!.get(built.groups[2]);
    // A texture of the frame's not published: nothing of ours draws.
    if (!frame || !arrays) return;
    pass.setPipeline(built.pipeline);
    pass.setBindGroup(0, frame);
    pass.setBindGroup(2, arrays);
    pass.setIndexBuffer(this.index!, "uint32");
    const order = this.order;
    const surfaces = this.surfaces;
    let drawn = 0;
    for (let d = from; d < to; d++) {
      const surface = surfaces[order[d]];
      const group = surface.group.get(built.groups[1]);
      if (!group) continue;
      pass.setBindGroup(1, group);
      const shape = surface.near ? this.grid : this.quad;
      pass.drawIndexed(shape.count, 1, shape.first, shape.baseVertex, 0);
      drawn++;
    }
    this.stats.drawn += drawn;
  }

  /** As the main pass begins — inside the render: this frame's verdict and its uploads, and the groups' textures asked. */
  private readonly prepare = (): void => {
    const committed = this.committed;
    this.committed = false;
    this.stats.drawn = 0;
    this.draws = 0;
    const values = this.values;
    this.ours = committed && values !== null && this.built !== null && this.geometry !== null;
    if (!this.ours) return;
    this.shared.write(values!);
    const host = this.renderer.host;
    this.frameGroup.refresh(host, this.renderer.textures);
    const surfaces = this.surfaces;
    for (let i = 0; i < surfaces.length; i++) surfaces[i].group.refresh(host, surfaces[i].handles);
  };

  /** `Renderer.onRefused`: the main pass drew nothing of ours, this included. */
  private readonly refused = (): void => {
    if (this.ours) this.failed("the main pass was refused, so no water can be drawn");
  };
}

/** A failure with nobody to tell: not installed. */
function ignore(): void {}
