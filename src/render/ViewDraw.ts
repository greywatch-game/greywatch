/**
 * render/ViewDraw.ts — The player's own WEAPON as OUR renderer draws it
 * (`BABYLON_EXIT.md` X4.3c): every opaque surface of the viewmodel — each
 * rig's colour groups, magazines, bolt, slide and warhead, each optic's
 * housing and reticle, the arms, the fist, its frag and pip, the bottle and
 * its wick, and the muzzle flash — as SEGMENTS of one kit on the GPU once,
 * each frame's drawn segments one draw apiece into the frame's main pass (the
 * cel program, or the emissive palette's for an unlit part), and the lit ones
 * again into the glow's mask.
 * Owns: `ViewDraw` — the kit's arrays (every segment end to end, and the
 * indices rebased onto them), each draw's matrix and bloom on the GPU and the
 * staging arrays a frame writes them into (`matrices`, `segment`, `recipes`;
 * the bloom, which it PULLS), a material block and group per cel recipe it has
 * been handed and the emissive table's, the pipelines (asked once, for the
 * session), the main-pass draw, the mask draw, the prepare that uploads a
 * frame, the refusal listeners, whoever is told of a failure
 * (`onFailed`), and what it drew last (`stats`); `ViewDrawSegment`,
 * `ViewPull`.
 * Invariants: it DECIDES NOTHING — which segments are drawn, in what order,
 * at what matrix, with what material and at what bloom are its caller's
 * (`Game.drawView`, off the tree's own evaluation and Babylon's group-1 sort,
 * `GlowRules`), handed over once a frame (`commit`) and pulled once inside the
 * render (`pull`, in the prepare: the bloom, off the camera the render placed),
 * and drawn on that frame, nothing else; a draw is ONE segment, one instance,
 * as Babylon drew one mesh (`viewProgram.ts`), the draws in the order handed
 * over — which is what settles an equal depth, the later winning, as
 * Babylon's queue settled it; the draws go into the main pass at
 * `"afterGroup"` — after rendering group 0, its blended queue and the kit
 * card last of it, and before group 1, which holds the two glasses — where
 * Babylon drew the weapon as group 1's opaque queue, and the mask's ahead of
 * everything of Babylon's in that pass (`Renderer.addGlowMask`), no depth
 * written, LEQUAL against the depth the main pass's draw wrote by the same
 * vertex module; the arrays are uploaded as Babylon uploaded a mesh's
 * (float32; a `color` or `uv` a segment does not carry reading what
 * Babylon's one-float empty vertex buffer read, widened: (0, 0, 0, 1) and
 * (0, 0)); a material's block is re-copied from its recipe only when the
 * caller's epoch moves; a frame with a texture unpublished draws nothing, and
 * a draw whose pipeline is unbuilt is skipped, as a Babylon material not
 * ready drew nothing; it is INSTALLED FOR THE SESSION, not the round — the kit
 * screen covers `menu`, where no map stands — and a pipeline that FAILS, or a
 * refused pass while something of it would draw, is told to `onFailed`'s
 * listener, never inside the render's commands (the caller defers it,
 * `Game.worldFailed`); nothing here allocates on a frame but the first sight
 * of a recipe (a finish's new material).
 * Never: imports Babylon; reads a node, a joint, a mesh or a material.
 * Contract: `docs/rendering.md`, "The weapon, ours".
 */
import { CEL_MATERIAL_BLOCK, CEL_MATERIAL_TEXTURES, type CelRecipe } from "./celMaterial";
import { EMISSIVE_BLOCK, EMISSIVE_BLOCK_DEFINES, type EmissiveRecipe } from "./emissiveWorld";
import type { PassTargets } from "./frameHost";
import { HostBindGroup } from "./HostBindGroup";
import type { BuiltPipeline, PipelineState } from "./PipelineCache";
import type { FrameContext, Renderer } from "./Renderer";
import { FRAME_TARGETS, GLOW_TARGETS } from "./targets";
import { UniformBlockBuffer } from "./UniformBlockBuffer";
import { VIEW_GEOMETRY, VIEW_GLOW, viewCelProgram, viewEmissivePrograms, type ViewProgram } from "./viewProgram";

/** One segment of the kit: one mesh of the viewmodel it was until X4.3c, in its own frame. */
export interface ViewDrawSegment {
  /** xyz a vertex. */
  readonly positions: ArrayLike<number>;
  readonly normals: ArrayLike<number> | null;
  /** rgba a vertex, or null for a segment that carries none. */
  readonly colors: ArrayLike<number> | null;
  /** uv a vertex, or null. */
  readonly uvs: ArrayLike<number> | null;
  /** The emissive table's 1-based slot for an UNLIT segment; 0 for a cel one. */
  readonly slot: number;
  /** Whether it is drawn into the glow's mask: unlit, a colour above black, and not `noGlow`. */
  readonly glows: boolean;
  readonly indices: ArrayLike<number>;
}

/**
 * What the prepare pulls inside the render, for this frame's first `n` draws:
 * each masked draw's bloom into `glow` at `k * 4` (rgb the colour, a the
 * material's alpha) — read off the camera the render has placed.
 */
export type ViewPull = (glow: Float32Array, n: number) => void;

/** Floats in one draw's matrix. */
const MATRIX_FLOATS = 16;

/** A material's own block and its group, made the first time its recipe is drawn. */
interface MaterialSlot {
  readonly block: UniformBlockBuffer;
  readonly group: HostBindGroup;
  /** The cel pipeline for its variant and bias. */
  readonly pipeline: CelPipeline;
}

/** A cel pipeline, by variant and depth bias: built, or not yet. */
interface CelPipeline {
  built: BuiltPipeline | null;
}

export class ViewDraw {
  /** Segments in the kit — and the most draws one frame may make, each drawn at most once. */
  readonly capacity: number;
  /** This frame's draws' matrices, written by the caller before `commit`: draw `k` at `k * 16`, `Matrix.m`'s layout. */
  readonly matrices: Float32Array<ArrayBuffer>;
  /** This frame's draws' segments, by their place in the kit, written before `commit`. */
  readonly segment: Uint32Array<ArrayBuffer>;
  /** This frame's draws' cel recipes, written before `commit`: null for an unlit segment. */
  readonly recipes: (CelRecipe | null)[];
  /** Whether the pipelines asked at construction built; false if one failed. */
  readonly ready: Promise<boolean>;
  /**
   * What the last frame drew: main-pass draws, mask draws. Nothing in the
   * game reads it; a profiler capture does (`ProfileReport.view`) and the
   * census.
   */
  readonly stats = { drawn: 0, masked: 0 };

  private readonly device: GPUDevice;
  /** Each segment's first index in `indexData`, and its count. */
  private readonly first: Uint32Array;
  private readonly count: Uint32Array;
  private readonly unlit: Uint8Array;
  private readonly glows: Uint8Array;
  private readonly owned: GPUBuffer[] = [];
  private readonly matrixBuffer: GPUBuffer;
  private readonly glowBuffer: GPUBuffer;
  private readonly glow: Float32Array<ArrayBuffer>;
  private readonly geometry: HostBindGroup;
  private readonly emissiveBlock: UniformBlockBuffer;
  private readonly emissiveGroup: HostBindGroup;
  private readonly glowGroup: HostBindGroup;
  private emissive: BuiltPipeline | null = null;
  private mask: BuiltPipeline | null = null;
  /** Every cel pipeline asked, by `celKey`. */
  private readonly cels = new Map<string, CelPipeline>();
  /** Every recipe drawn so far. */
  private readonly materials = new Map<CelRecipe, MaterialSlot>();

  private pending = false;
  private instances = 0;
  private glowOn = false;
  /** This frame's draws include one for the mask. */
  private anyMasked = false;
  /** The materials' epoch as last copied; NaN is never. */
  private epoch = Number.NaN;
  /** This frame's verdict: committed, uploaded. */
  private ours = false;
  private failed: (reason: string) => void;
  private failedPipelines = false;
  private readonly unhook: () => void;

  constructor(
    private readonly renderer: Renderer,
    segments: readonly ViewDrawSegment[],
    private readonly emissiveRecipe: EmissiveRecipe,
    /** The cel recipes the kit is born wearing: their pipelines are asked here, ahead. */
    celRecipes: readonly CelRecipe[],
    private readonly pull: ViewPull,
    failed: (reason: string) => void,
  ) {
    const device = renderer.device;
    this.device = device;
    this.failed = failed;
    const n = segments.length;
    this.capacity = Math.max(1, n);
    this.matrices = new Float32Array(this.capacity * MATRIX_FLOATS);
    this.segment = new Uint32Array(this.capacity);
    this.recipes = new Array<CelRecipe | null>(this.capacity).fill(null);
    this.glow = new Float32Array(this.capacity * 4);
    this.first = new Uint32Array(this.capacity);
    this.count = new Uint32Array(this.capacity);
    this.unlit = new Uint8Array(this.capacity);
    this.glows = new Uint8Array(this.capacity);

    // The kit's arrays, end to end, and `indexData`: every segment's indices
    // rebased onto them, each segment's run its own.
    let vertices = 0;
    let indexTotal = 0;
    for (const s of segments) {
      vertices += s.positions.length / 3;
      indexTotal += s.indices.length;
    }
    const positions = new Float32Array(vertices * 3);
    const normals = new Float32Array(vertices * 3);
    // `color` and `uv` where a segment carries none read what Babylon's empty
    // vertex buffer read for a mesh with none: ONE float32 0, which WebGPU
    // widens to (0, 0, 0, 1) and (0, 0) — the baked occlusion UNoccluded.
    const colors = new Float32Array(vertices * 4);
    const uvs = new Float32Array(vertices * 2);
    const uvs2 = new Float32Array(vertices * 2);
    const indices = new Uint32Array(Math.max(1, indexTotal));
    let v = 0;
    let at = 0;
    segments.forEach((s, i) => {
      const count = s.positions.length / 3;
      // `Float32Array.set` rounds a double to nearest, as Babylon's upload of
      // a mesh's `number[]` did.
      positions.set(s.positions, v * 3);
      if (s.normals) normals.set(s.normals, v * 3);
      if (s.colors) colors.set(s.colors, v * 4);
      else for (let c = 0; c < count; c++) colors[(v + c) * 4 + 3] = 1;
      if (s.uvs) uvs.set(s.uvs, v * 2);
      if (s.slot > 0) for (let c = 0; c < count; c++) uvs2[(v + c) * 2] = s.slot;
      this.first[i] = at;
      this.count[i] = s.indices.length;
      this.unlit[i] = s.slot > 0 ? 1 : 0;
      this.glows[i] = s.slot > 0 && s.glows ? 1 : 0;
      for (let j = 0; j < s.indices.length; j++) indices[at++] = s.indices[j] + v;
      v += count;
    });

    const storage = (label: string, data: ArrayBufferView<ArrayBuffer>): GPUBuffer => {
      const buffer = device.createBuffer({
        label: `view: ${label}`,
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
        label: `view: ${label}`,
        size: Math.max(16, bytes),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.owned.push(buffer);
      return buffer;
    };
    this.matrixBuffer = frameBuffer("matrices", this.matrices.byteLength);
    this.glowBuffer = frameBuffer("bloom", this.glow.byteLength);
    const host = renderer.host;
    this.geometry = new HostBindGroup(device, "view: geometry", VIEW_GEOMETRY, [], {
      positionData: storage("positions", positions),
      normalData: storage("normals", normals),
      colorData: storage("colours", colors),
      uvData: storage("uvs", uvs),
      uv2Data: storage("slots", uvs2),
      indexData: storage("indices", indices),
      viewMatrices: this.matrixBuffer,
    });
    // No textures: resolved once, whole for good.
    this.geometry.refresh(host, {});
    this.emissiveBlock = new UniformBlockBuffer(device, EMISSIVE_BLOCK, EMISSIVE_BLOCK_DEFINES, "view: emissive");
    this.emissiveGroup = new HostBindGroup(device, "view: emissive", [EMISSIVE_BLOCK], [], {
      [EMISSIVE_BLOCK.var]: this.emissiveBlock.buffer,
    });
    this.emissiveGroup.refresh(host, {});
    this.glowGroup = new HostBindGroup(device, "view: bloom", VIEW_GLOW, [], { viewGlow: this.glowBuffer });
    this.glowGroup.refresh(host, {});

    const emissive = viewEmissivePrograms();
    const asks: Promise<boolean>[] = [
      this.ask(emissive.main, FRAME_TARGETS, undefined, (b) => (this.emissive = b)),
      // No depth written: every pixel's depth is the main pass's, which the
      // same vertex module wrote.
      this.ask(emissive.mask, GLOW_TARGETS, { depthWrite: false }, (b) => (this.mask = b)),
    ];
    for (const recipe of celRecipes) {
      const key = celKey(recipe);
      if (this.cels.has(key)) continue;
      asks.push(this.askCel(recipe, key));
    }
    this.ready = Promise.all(asks).then((oks) => oks.every(Boolean));
    void this.ready.then((ok) => {
      if (ok) return;
      this.failedPipelines = true;
      this.failed("our weapon cannot draw: a pipeline of its failed");
    });

    const removes = [
      renderer.onFrame(this.prepare),
      renderer.add(this.draw, "afterGroup"),
      renderer.onRefused(this.refused),
      renderer.addGlowMask(this.drawMask),
      renderer.onGlowMaskRefused(this.maskRefused),
    ];
    this.unhook = () => {
      for (const remove of removes) remove();
      removes.length = 0;
    };
  }

  /**
   * Whom a failure is told from now on — the round's owner while a map
   * stands (`Game.worldFailed`), the console otherwise — told at once if the
   * pipelines have already failed, as every round after a failed one is.
   */
  onFailed(failed: (reason: string) => void): void {
    this.failed = failed;
    if (this.failedPipelines) failed("our weapon cannot draw: a pipeline of its failed");
  }

  /**
   * This frame's draws: the first `n`, their matrices, segments and recipes
   * already written — drawn on the next frame our renderer prepares, the
   * bloom pulled then when `glowOn`. `epoch` is the materials'
   * (`CelMaterialFactory.materialEpoch`): when it moved, every block is copied
   * again from its recipe.
   */
  commit(n: number, glowOn: boolean, epoch: number): void {
    const count = Math.max(0, Math.min(n, this.capacity));
    this.instances = count;
    this.glowOn = glowOn;
    this.pending = true;
    let anyMasked = false;
    for (let k = 0; k < count; k++) {
      const recipe = this.recipes[k];
      if (recipe && !this.materials.has(recipe)) this.adopt(recipe);
      if (this.glows[this.segment[k]]) anyMasked = true;
    }
    this.anyMasked = anyMasked;
    if (epoch !== this.epoch) {
      this.epoch = epoch;
      this.emissiveBlock.write(this.emissiveRecipe.values);
      for (const [recipe, slot] of this.materials) {
        slot.block.write(recipe.values);
        slot.group.refresh(this.renderer.host, recipe.textures);
      }
    }
  }

  dispose(): void {
    this.unhook();
    for (const buffer of this.owned) buffer.destroy();
    this.emissiveBlock.destroy();
    for (const slot of this.materials.values()) slot.block.destroy();
  }

  /** `recipe`'s block and group, made and filled the first time it is drawn, and its pipeline asked if no recipe of its shape was. */
  private adopt(recipe: CelRecipe): void {
    const key = celKey(recipe);
    if (!this.cels.has(key)) {
      if (import.meta.env.DEV) {
        console.warn(`view: a cel material of a shape not asked at construction (${key}) — compiled now, in the round`);
      }
      void this.askCel(recipe, key);
    }
    const block = new UniformBlockBuffer(this.device, CEL_MATERIAL_BLOCK, recipe.defines, "view: material");
    const group = new HostBindGroup(
      this.device,
      "view: material",
      [CEL_MATERIAL_BLOCK, ...CEL_MATERIAL_TEXTURES],
      recipe.defines,
      { [CEL_MATERIAL_BLOCK.var]: block.buffer },
    );
    block.write(recipe.values);
    group.refresh(this.renderer.host, recipe.textures);
    this.materials.set(recipe, { block, group, pipeline: this.cels.get(key)! });
  }

  /** Asks the cel pipeline for `recipe`'s variant and bias, filed under `key`. */
  private askCel(recipe: CelRecipe, key: string): Promise<boolean> {
    const slot: CelPipeline = { built: null };
    this.cels.set(key, slot);
    const state = recipe.depthBias !== 0 ? { depthBias: recipe.depthBias } : undefined;
    return this.ask(viewCelProgram(recipe.defines), FRAME_TARGETS, state, (b) => (slot.built = b));
  }

  private ask(
    program: ViewProgram,
    targets: PassTargets,
    state: PipelineState | undefined,
    set: (built: BuiltPipeline) => void,
  ): Promise<boolean> {
    return this.renderer.pipelines
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
          console.error(`view: the ${program.vertex.label} pipeline did not build; the weapon cannot be drawn`, err);
          return false;
        },
      );
  }

  /**
   * As the main pass begins — inside the render, the camera placed: this
   * frame's verdict, the bloom pulled, and the draws uploaded if the frame is
   * ours.
   */
  private readonly prepare = (): void => {
    const pending = this.pending;
    this.pending = false;
    this.stats.drawn = 0;
    this.stats.masked = 0;
    const n = this.instances;
    this.ours = pending && n > 0;
    if (!this.ours) return;
    const queue = this.device.queue;
    queue.writeBuffer(this.matrixBuffer, 0, this.matrices, 0, n * MATRIX_FLOATS);
    if (this.glowOn && this.anyMasked) {
      this.pull(this.glow, n);
      queue.writeBuffer(this.glowBuffer, 0, this.glow, 0, n * 4);
    }
  };

  /** The weapon in the main pass, one draw a segment in the order handed over. */
  private readonly draw = (pass: GPURenderPassEncoder, ctx: FrameContext): void => {
    if (!this.ours) return;
    const n = this.instances;
    let drawn = 0;
    let bound: BuiltPipeline | null = null;
    let material: HostBindGroup | null = null;
    for (let k = 0; k < n; k++) {
      const s = this.segment[k];
      const recipe = this.recipes[k];
      let built: BuiltPipeline | null;
      let group: HostBindGroup;
      if (recipe === null) {
        // An unlit segment the kit did not slot (a material the caller could
        // not read) draws nothing, as a mesh with no material ready would.
        if (!this.unlit[s]) continue;
        built = this.emissive;
        group = this.emissiveGroup;
      } else {
        const slot = this.materials.get(recipe)!;
        built = slot.pipeline.built;
        group = slot.group;
      }
      if (!built) continue;
      if (built !== bound || group !== material) {
        const frame = ctx.frameGroup(built.groups[0]);
        const own = group.get(built.groups[1]);
        const geometry = this.geometry.get(built.groups[2]);
        // A texture unpublished: nothing of this pipeline can draw this frame.
        if (!frame || !own || !geometry) continue;
        if (built !== bound) {
          pass.setPipeline(built.pipeline);
          pass.setBindGroup(0, frame);
          pass.setBindGroup(2, geometry);
        }
        pass.setBindGroup(1, own);
        bound = built;
        material = group;
      }
      pass.draw(this.count[s], 1, this.first[s], k);
      drawn++;
    }
    this.stats.drawn = drawn;
  };

  /** The lit segments' bloom, first in the glow's mask: the same draws, by the same vertex module. */
  private readonly drawMask = (pass: GPURenderPassEncoder, ctx: FrameContext): void => {
    if (!this.ours || !this.glowOn || !this.anyMasked) return;
    const mask = this.mask;
    if (!mask) return;
    const frame = ctx.frameGroup(mask.groups[0]);
    const own = this.glowGroup.get(mask.groups[1]);
    const geometry = this.geometry.get(mask.groups[2]);
    if (!frame || !own || !geometry) return;
    pass.setPipeline(mask.pipeline);
    pass.setBindGroup(0, frame);
    pass.setBindGroup(1, own);
    pass.setBindGroup(2, geometry);
    let masked = 0;
    const n = this.instances;
    for (let k = 0; k < n; k++) {
      const s = this.segment[k];
      if (this.recipes[k] !== null || !this.glows[s]) continue;
      pass.draw(this.count[s], 1, this.first[s], k);
      masked++;
    }
    this.stats.masked = masked;
  };

  /** `Renderer.onRefused`: the main pass drew nothing of ours, the weapon included. */
  private readonly refused = (): void => {
    if (this.ours) this.failed("the main pass was refused, so the weapon cannot be drawn");
  };

  /** `Renderer.onGlowMaskRefused`: the mask drew nothing of ours, the reticles' bloom included. */
  private readonly maskRefused = (): void => {
    if (this.ours && this.glowOn && this.anyMasked) this.failed("the glow's mask pass was refused, so no reticle of ours can bloom");
  };
}

/** A cel pipeline's identity: the variant and the depth bias, which is pipeline state. */
function celKey(recipe: CelRecipe): string {
  return `${[...recipe.defines].sort().join("+")}@${recipe.depthBias}`;
}
