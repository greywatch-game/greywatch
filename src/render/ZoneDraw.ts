/**
 * render/ZoneDraw.ts — The capture zones as OUR renderer draws them
 * (`BABYLON_EXIT.md` X4.6b): each ring's batches of stones and its paint, each
 * flag's pole and the two sheets of its cloth, a field and a band on each —
 * the `zone-*` meshes on cel materials that Babylon's opaque list drew until
 * X4.6b, one draw for one.
 * Owns: `ZoneDraw` — the session's pipelines, one a variant it was handed
 * (`ready`), one block and bind group a recipe worn (`wear`); a round's
 * vertices and indices on the GPU, in one set of arrays with one group 2, from
 * `finish` to `clear`; the surfaces (`surfaces`, each a `ZoneSurface`), and the
 * order this frame draws them in (`order`, `keys`, `draws`), which the run's pull
 * writes;
 * the rewrite of a sheet's vertices (`rewrite`); the refusal listeners it holds
 * while installed, and what it drew last (`stats`). `ZoneGeometry`, `ZoneBox`.
 * Invariants: it DECIDES NOTHING — which surface is on and what it wears are
 * `CaptureZoneSystem`'s and `FlagCloth`'s (`ZoneSurface.on`, `wear`), the size
 * gate, the frustum and the order are `Game`'s (`drawZones`, `nearestPull`, inside
 * the render where the camera and the planes are this frame's), and the
 * cloth's shape is the simulation's, which hands over its own arrays; **where a
 * surface falls among the blades and the water is the one run's** (`NearestRun`,
 * X4.6d), since every test is LEQUAL, so an equal depth goes to the later draw, and
 * a depth this close to the far plane ties for real where a blade grows through a
 * stone; a surface's sphere is the one its mesh held — off its vertices' box (`extractMinAndMax`'s doubles) or the box stated for a sheet,
 * whatever shape the sheet takes, `BoundingSphere.reConstruct` operation for
 * operation — so the size gate, the frustum and the sort read what Babylon read;
 * **a vertex's attributes are uploaded as Babylon uploaded a mesh's** (float32,
 * a `color` or `uv` a surface does not carry reading what its one-float empty
 * vertex buffer read, widened: (0, 0, 0, 1) and (0, 0)); a recipe's depth bias
 * is pipeline state (`get(hex, ROAD_DEPTH_UNITS)`'s), and a recipe whose
 * variant was never handed to the constructor is REFUSED, a compile in play
 * being what the round's declared list exists to forbid; a recipe's block is
 * written once, its values fixed at birth; a frame with a pipeline unbuilt
 * draws no surface, as a material not ready drew none; a pipeline that FAILS is
 * the round's failure (`install`'s), told every round after it too, and so is a
 * refused main pass while it is installed — never inside the render's commands
 * (the caller defers it, `Game.worldFailed`); `rewrite` allocates nothing, and a
 * frame allocates nothing past the first bind of a group.
 * Never: imports Babylon; reads a node or a camera; casts a shadow, or draws in
 * a bake, the lamps' atlas or the glow's mask (no surface here was in any of
 * them); draws while not installed (the menu, an editor build, which has no
 * zones).
 * Contract: `docs/rendering.md`, "The capture zone" and "Our renderer's frame".
 *
 * WHAT A DRAW BINDS, by group: 0 the frame (`Renderer`'s), 1 the worn recipe's
 * material, 2 the round's arrays through the plain cel stage (`celVertex.ts`),
 * which reads each at the vertex the index names; the index buffer is the
 * round's, rebased onto the arrays, and a draw is `drawIndexed` over its range.
 */
import { CEL_MATERIAL_BLOCK, CEL_MATERIAL_TEXTURES, type CelRecipe } from "./celMaterial";
import { celFragment } from "./celFragment";
import { celGeometry, celVertex } from "./celVertex";
import { HostBindGroup } from "./HostBindGroup";
import type { BuiltPipeline } from "./PipelineCache";
import type { FrameContext, Renderer } from "./Renderer";
import { FRAME_TARGETS } from "./targets";
import { UniformBlockBuffer } from "./UniformBlockBuffer";

/** One surface's vertices, as its builder holds them. */
export interface ZoneGeometry {
  /** xyz a vertex. */
  readonly positions: ArrayLike<number>;
  readonly normals: ArrayLike<number>;
  /** rgba a vertex, or absent for one that carries none. */
  readonly colors?: ArrayLike<number> | null;
  /** uv a vertex, or absent. */
  readonly uvs?: ArrayLike<number> | null;
}

/** A surface's bounds, stated: min then max. */
export type ZoneBox = readonly [number, number, number, number, number, number];

/** A recipe as it is drawn: its pipeline's variant, its block and its group 1. */
export interface ZoneMaterial {
  readonly variant: Variant;
  readonly block: UniformBlockBuffer;
  readonly group: HostBindGroup;
}

/** One (defines, bias) the session compiles. */
export interface Variant {
  built: BuiltPipeline | null;
}

/** What `finish` uploads: a vertex range, whose arrays may go on being written until then. */
interface Pending {
  readonly geometry: ZoneGeometry;
  readonly first: number;
  readonly count: number;
}

/** One draw: a range of the round's indices, in a recipe. */
export class ZoneSurface {
  /** The switch, which a mesh's `setEnabled` was. */
  on = true;
  /** This frame's: `on`, and through the size gate (`Game.drawZones`). */
  kept = false;

  constructor(
    /** What its mesh was called (`zone-<id>-pole`, ...): a label and the kit hash's. */
    readonly name: string,
    /** First index, and how many. */
    readonly first: number,
    readonly count: number,
    /** Its bounding sphere, as its mesh held it. */
    readonly x: number,
    readonly y: number,
    readonly z: number,
    readonly radius: number,
    /** Set through `ZoneDraw.wear`. */
    public material: ZoneMaterial,
  ) {}
}

/** How `ZoneDraw` names a variant: what makes two pipelines different. */
function variantKey(recipe: CelRecipe): string {
  return `${recipe.defines.join("+")}|${recipe.depthBias}`;
}

const MAX_VALUE = Number.MAX_VALUE;

export class ZoneDraw {
  /** Whether every pipeline built — asked once, for the session; false if one failed. */
  readonly ready: Promise<boolean>;
  /** What the last frame drew. Nothing in the game reads it; a profiler capture does (`ProfileReport.pools`) and the census. */
  readonly stats = { drawn: 0 };
  /** The round's surfaces, in the order they were added: the order their meshes were made in. */
  readonly surfaces: ZoneSurface[] = [];
  /** Which surfaces this frame draws, nearest first (`surfaces`' indices): the pull writes it. */
  order = new Int32Array(0);
  /** The pull's scratch: each drawn surface's distance from the eye, squared. */
  keys = new Float64Array(0);
  /** How many of `order` this frame draws: the pull writes it. */
  draws = 0;

  private readonly device: GPUDevice;
  private readonly variants = new Map<string, Variant>();
  private readonly materials = new Map<CelRecipe, ZoneMaterial>();

  /** The round's vertices as added, until `finish`. */
  private readonly pending: Pending[] = [];
  private vertices = 0;
  /** The round's indices as added, rebased onto the arrays, until `finish`. */
  private indexList: number[] = [];

  private positionBuffer: GPUBuffer | null = null;
  private normalBuffer: GPUBuffer | null = null;
  private indexBuffer: GPUBuffer | null = null;
  private owned: GPUBuffer[] = [];
  private geometry: HostBindGroup | null = null;

  private committed = false;
  /** This frame's verdict: committed, built, a round loaded. */
  private ours = false;

  private removes: (() => void)[] = [];
  private isInstalled = false;
  private failed: (reason: string) => void = ignore;
  private generation = 0;

  constructor(
    private readonly renderer: Renderer,
    /** One recipe of each (variant, bias) a surface will wear: their pipelines are asked now, for the session. */
    recipes: readonly CelRecipe[],
  ) {
    this.device = renderer.device;
    const asks: Promise<boolean>[] = [];
    for (const recipe of recipes) {
      const key = variantKey(recipe);
      if (this.variants.has(key)) continue;
      const variant: Variant = { built: null };
      this.variants.set(key, variant);
      asks.push(
        renderer.pipelines
          .get({
            vertex: celVertex(recipe.defines, FRAME_TARGETS),
            vertexEntry: "main",
            fragment: celFragment(recipe.defines, FRAME_TARGETS),
            fragmentEntry: "main",
            targets: FRAME_TARGETS,
            state: recipe.depthBias === 0 ? undefined : { depthBias: recipe.depthBias },
          })
          .then(
            (built) => {
              variant.built = built;
              return true;
            },
            (err: unknown) => {
              console.error(`zones: the [${key}] pipeline did not build; no ring or flag can be drawn`, err);
              return false;
            },
          ),
      );
    }
    this.ready = Promise.all(asks).then((oks) => oks.every(Boolean));
  }

  /** Whether a frame is owed: what the run's predicate asks. */
  get active(): boolean {
    return this.committed;
  }

  /** Whether this frame draws at all: the prepare's verdict, which the run's pull reads. */
  get drawing(): boolean {
    return this.ours;
  }

  /**
   * Draws the round's surfaces from the next frame on, through the run
   * (`NearestRun`) — telling `failed` if they cannot be: a pipeline that failed
   * (now or for the session already), or the main pass refused. Replaces any
   * earlier install's failure.
   */
  install(failed: (reason: string) => void): void {
    this.uninstall();
    this.failed = failed;
    const generation = ++this.generation;
    void this.ready.then((ok) => {
      if (!ok && generation === this.generation) failed("the rings and flags cannot draw: a pipeline of theirs failed");
    });
    const renderer = this.renderer;
    this.removes.push(
      renderer.onFrame(this.prepare),
      renderer.onRefused(this.refused),
    );
    this.isInstalled = true;
  }

  /** Whether a round's install stands — false on the menu and in an editor build. */
  get installed(): boolean {
    return this.isInstalled;
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

  /**
   * A range of vertices for the round, the first of it returned. Read at
   * `finish`, so an array its owner is still writing (a sheet's) goes up as it
   * then stands.
   */
  addVertices(geometry: ZoneGeometry): number {
    const first = this.vertices;
    const count = geometry.positions.length / 3;
    this.pending.push({ geometry, first, count });
    this.vertices += count;
    return first;
  }

  /**
   * A surface over a range of `addVertices`, wearing `recipe`, its bounding
   * sphere that of `box` — or, absent, of the vertices of `geometry` — and its
   * order among the rest the order it was added in, where their meshes'
   * making broke an equal distance.
   */
  addSurface(
    name: string,
    first: number,
    indices: ArrayLike<number>,
    recipe: CelRecipe,
    box: ZoneBox | null,
    geometry: ZoneGeometry | null = null,
  ): ZoneSurface {
    const start = this.indexList.length;
    for (let i = 0; i < indices.length; i++) this.indexList.push(indices[i] + first);
    const b = box ?? boxOf(geometry!.positions);
    // `BoundingSphere.reConstruct`, under the identity a frozen mesh stood at.
    const dx = b[3] - b[0];
    const dy = b[4] - b[1];
    const dz = b[5] - b[2];
    const surface = new ZoneSurface(
      name,
      start,
      indices.length,
      (b[3] + b[0]) * 0.5,
      (b[4] + b[1]) * 0.5,
      (b[5] + b[2]) * 0.5,
      Math.sqrt(dx * dx + dy * dy + dz * dz) * 0.5,
      this.materialOf(recipe),
    );
    this.surfaces.push(surface);
    return surface;
  }

  /** `addVertices` and `addSurface` in one, for a surface with vertices of its own. */
  addStatic(name: string, geometry: ZoneGeometry, indices: ArrayLike<number>, recipe: CelRecipe): ZoneSurface {
    return this.addSurface(name, this.addVertices(geometry), indices, recipe, null, geometry);
  }

  /** What `surface` is drawn in, from the next frame on: a pointer, as a mesh's `material` was. */
  wear(surface: ZoneSurface, recipe: CelRecipe): void {
    surface.material = this.materialOf(recipe);
  }

  /** Uploads what was added: the round's surfaces draw from the next frame on. */
  finish(): void {
    const device = this.device;
    const n = Math.max(1, this.vertices);
    const positions = new Float32Array(n * 3);
    const normals = new Float32Array(n * 3);
    // What Babylon's empty vertex buffer read for a mesh with none: ONE
    // float32 0, which WebGPU widens to (0, 0, 0, 1) and (0, 0) — the baked
    // occlusion UNoccluded, the sway's red weight 0.
    const colors = new Float32Array(n * 4);
    const uvs = new Float32Array(n * 2);
    for (const { geometry, first, count } of this.pending) {
      positions.set(geometry.positions, first * 3);
      normals.set(geometry.normals, first * 3);
      if (geometry.colors) colors.set(geometry.colors, first * 4);
      else for (let c = 0; c < count; c++) colors[(first + c) * 4 + 3] = 1;
      if (geometry.uvs) uvs.set(geometry.uvs, first * 2);
    }
    this.pending.length = 0;
    const buffer = (label: string, data: ArrayBufferView<ArrayBuffer>, usage: number): GPUBuffer => {
      const made = device.createBuffer({
        label: `zones: ${label}`,
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
    this.normalBuffer = buffer("normals", normals, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.indexBuffer = buffer("indices", Uint32Array.from(this.indexList), GPUBufferUsage.INDEX);
    this.indexList = [];
    this.geometry = new HostBindGroup(device, "zones: geometry", celGeometry(null), [], {
      positionData: this.positionBuffer,
      normalData: this.normalBuffer,
      colorData: buffer("colours", colors, GPUBufferUsage.STORAGE),
      uvData: buffer("uvs", uvs, GPUBufferUsage.STORAGE),
      // The plain stage declares it and reads it only for a scattered index,
      // and it has none.
      transforms: buffer("transforms", new Float32Array(4), GPUBufferUsage.STORAGE),
    });
    // No textures: resolved once, whole for good.
    this.geometry.refresh(this.renderer.host, {});
    this.order = new Int32Array(this.surfaces.length);
    this.keys = new Float64Array(this.surfaces.length);
  }

  /**
   * Writes a range of vertices' positions and normals over what was uploaded,
   * as `updateVerticesData` wrote a mesh's: lands before the next submit, so
   * the next frame draws it. Before `finish` there is nothing to write and
   * `finish` reads the arrays then. Allocates nothing.
   */
  rewrite(first: number, positions: Float32Array<ArrayBuffer>, normals: Float32Array<ArrayBuffer>): void {
    if (!this.positionBuffer) return;
    const queue = this.device.queue;
    queue.writeBuffer(this.positionBuffer, first * 12, positions);
    queue.writeBuffer(this.normalBuffer!, first * 12, normals);
  }

  /** The round's geometry goes: nothing is drawn or counted until the next `finish`. */
  clear(): void {
    for (const buffer of this.owned) buffer.destroy();
    this.owned = [];
    this.positionBuffer = null;
    this.normalBuffer = null;
    this.indexBuffer = null;
    this.geometry = null;
    this.surfaces.length = 0;
    this.pending.length = 0;
    this.vertices = 0;
    this.indexList = [];
    this.draws = 0;
    this.committed = false;
    this.ours = false;
    this.stats.drawn = 0;
  }

  /** This frame draws: the surfaces' `kept` written, the order asked inside the render. */
  commit(): void {
    if (!this.isInstalled) return;
    this.committed = this.surfaces.length > 0;
    // This frame's, from here: a frame `Renderer.begin` skips runs neither the
    // prepare nor the draw that would reset it.
    this.stats.drawn = 0;
  }

  dispose(): void {
    this.uninstall();
    this.clear();
    for (const material of this.materials.values()) material.block.destroy();
    this.materials.clear();
  }

  /** A recipe's block and group 1, made once a recipe, written once: its values are fixed at birth. */
  private materialOf(recipe: CelRecipe): ZoneMaterial {
    let material = this.materials.get(recipe);
    if (material) return material;
    const key = variantKey(recipe);
    const variant = this.variants.get(key);
    if (!variant) throw new Error(`ZoneDraw: a surface wears [${key}], which was never asked: it would compile in play`);
    const label = `zones: material [${key}]`;
    const block = new UniformBlockBuffer(this.device, CEL_MATERIAL_BLOCK, recipe.defines, label);
    block.write(recipe.values);
    const group = new HostBindGroup(this.device, label, [CEL_MATERIAL_BLOCK, ...CEL_MATERIAL_TEXTURES], recipe.defines, {
      [CEL_MATERIAL_BLOCK.var]: block.buffer,
    });
    // The variants bind no texture of their own.
    group.refresh(this.renderer.host, {});
    material = { variant, block, group };
    this.materials.set(recipe, material);
    return material;
  }

  /** Whether every variant is built: a surface in one unbuilt would draw out of its order otherwise. */
  private allBuilt(): boolean {
    for (const variant of this.variants.values()) if (!variant.built) return false;
    return true;
  }

  /** As the main pass begins — inside the render, the camera placed: this frame's verdict. */
  private readonly prepare = (): void => {
    const committed = this.committed;
    this.committed = false;
    this.stats.drawn = 0;
    this.draws = 0;
    this.ours = committed && this.geometry !== null && this.allBuilt();
  };

  /** A run of the pull's order in the main pass: a pipeline and its groups only when they change, and everything afresh at its start. */
  drawRange(pass: GPURenderPassEncoder, ctx: FrameContext, from: number, to: number): void {
    if (!this.ours || from >= to) return;
    const geometry = this.geometry!;
    const order = this.order;
    const surfaces = this.surfaces;
    let bound: BuiltPipeline | null = null;
    let worn: ZoneMaterial | null = null;
    let drawn = 0;
    pass.setIndexBuffer(this.indexBuffer!, "uint32");
    for (let d = from; d < to; d++) {
      const surface = surfaces[order[d]];
      const material = surface.material;
      const built = material.variant.built!;
      if (built !== bound) {
        const frame = ctx.frameGroup(built.groups[0]);
        const arrays = geometry.get(built.groups[2]);
        // A texture of the frame's not published: nothing of ours draws.
        if (!frame || !arrays) break;
        pass.setPipeline(built.pipeline);
        pass.setBindGroup(0, frame);
        pass.setBindGroup(2, arrays);
        bound = built;
        worn = null;
      }
      if (material !== worn) {
        const group = material.group.get(built.groups[1]);
        if (!group) break;
        pass.setBindGroup(1, group);
        worn = material;
      }
      pass.drawIndexed(surface.count, 1, surface.first, 0, 0);
      drawn++;
    }
    this.stats.drawn += drawn;
  }

  /** `Renderer.onRefused`: the main pass drew nothing of ours, these included. */
  private readonly refused = (): void => {
    if (this.ours) this.failed("the main pass was refused, so no ring or flag can be drawn");
  };
}

/** `extractMinAndMax` over a whole array: its doubles, as Babylon read a `number[]`. */
function boxOf(positions: ArrayLike<number>): ZoneBox {
  let minX = MAX_VALUE;
  let minY = MAX_VALUE;
  let minZ = MAX_VALUE;
  let maxX = -MAX_VALUE;
  let maxY = -MAX_VALUE;
  let maxZ = -MAX_VALUE;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return [minX, minY, minZ, maxX, maxY, maxZ];
}

/** A failure with nobody to tell: not installed. */
function ignore(): void {}
