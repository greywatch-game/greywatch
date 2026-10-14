/**
 * render/ClusterCull.ts — The static world's clusters culled on the GPU once
 * a frame, writing each group's surviving indices and its indirect draw
 * (`BABYLON_EXIT.md` X3.3b; the WGSL is `wgsl/clusterCull.ts`).
 * Owns: `ClusterCull` — the three compute pipelines, their bind groups, the
 * cluster, block and sphere tables, the scan's buffers, each group's record,
 * the INDIRECT arguments (`args`, one `drawIndexedIndirect` a group) and the
 * index buffer they draw (`indices`, written every frame); `ReachGate`, what
 * whoever decides the reach and the size gate hands it.
 * Invariants: every table is uploaded once, when the map is cut, and never
 * re-cut; a frame's inputs are numbers only — the frame's own
 * view-projection and eye (`FrameUniforms`), the reach and the size gate as
 * `ReachGate` holds them, and the most the wind can move a vertex, derived
 * from the frame's own wind — so the cull never reads a node; the frustum is
 * the view-projection's four side planes and the eye's own plane, normalised
 * here, and a cluster is dropped only when its box lies wholly outside one,
 * so it drops nothing the frustum did not already hide; the work is SUBMITTED
 * as a command buffer of its own when the frame's main pass begins, which the
 * queue runs ahead of the frame's own (still being recorded); until the
 * pipelines are built (`ready`) nothing is dispatched and `args` stays the
 * zeros it was made with, so a group draws nothing rather than garbage.
 * Never: imports Babylon; reads a node; allocates on a frame beyond the
 * command encoder, pass and buffer WebGPU makes for every submit.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 */
import type { FrameUniforms } from "./frame";
import {
  BLOCK_WORDS,
  CLUSTER_CULL_WGSL,
  CULL_UNIFORM_BYTES,
  GROUP_WORDS,
  INDIRECT_BYTES,
  SCAN_SIZE,
} from "./wgsl/clusterCull";

/**
 * The reach and the size gate as the frame's own mesh walk decides them
 * (`WorldCulling`): written in place by its owner, read here every frame.
 */
export interface ReachGate {
  /** Metres from the eye to a block's box past which it is fog; Infinity is no reach. */
  reach: number;
  /** Whether the size gate applies this frame. */
  sizeGate: boolean;
  /** Pixels per radian of the frame's camera. */
  perRad: number;
  /** The gate's smallest diameter, in pixels, squared. */
  px2: number;
}

/** A block's box, as `WorldCulling` files a cell. */
export interface BlockBox {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

/** What a map's cut hands the cull — every array in the order it is drawn. */
export interface CullTables {
  /** `CLUSTER_WORDS` a cluster, laid out as the WGSL's `Cluster`. */
  readonly clusters: ArrayBuffer;
  readonly clusterCount: number;
  readonly blocks: readonly BlockBox[];
  /** Each surface's bounding sphere, four floats: centre, radius. */
  readonly spheres: Float32Array;
  /** Each group's first cluster, end, and where its indices start. */
  readonly groups: readonly { readonly start: number; readonly end: number; readonly base: number }[];
  /** Every group's indices, rebased onto its own vertex buffers, in group order. */
  readonly indices: Uint32Array;
  /** The square of each near-first band's end, metres (three). */
  readonly bands2: readonly number[];
}

/** The largest `f32` short of infinity — a shader may assume there is none. */
const F32_MAX = 3.0e38;

export class ClusterCull {
  /** Each group's `drawIndexedIndirect` arguments, at `INDIRECT_BYTES` a group. */
  readonly args: GPUBuffer;
  /** What the draws index: each group's surviving clusters, near-first. */
  readonly indices: GPUBuffer;
  /** Resolves true once the three pipelines are built; false if one failed. */
  readonly ready: Promise<boolean>;
  private built = false;

  private readonly buffers: GPUBuffer[] = [];
  private readonly uniform: GPUBuffer;
  private readonly bytes = new ArrayBuffer(CULL_UNIFORM_BYTES);
  private readonly f32 = new Float32Array(this.bytes);
  private readonly u32 = new Uint32Array(this.bytes);
  private readonly clusterCount: number;
  private readonly workgroups: number;
  private readonly scatterX: number;
  private readonly scatterY: number;
  /** The three passes in dispatch order: cull, prefix, scatter. */
  private readonly passes: { pipeline: GPUComputePipeline; group: GPUBindGroup }[] = [];

  constructor(
    private readonly device: GPUDevice,
    tables: CullTables,
    private readonly gate: ReachGate,
  ) {
    const n = tables.clusterCount;
    this.clusterCount = n;
    this.workgroups = Math.max(1, Math.ceil(n / SCAN_SIZE));
    const maxX = device.limits.maxComputeWorkgroupsPerDimension;
    this.scatterX = Math.max(1, Math.min(n, maxX));
    this.scatterY = Math.max(1, Math.ceil(n / this.scatterX));

    const storage = GPUBufferUsage.STORAGE;
    this.uniform = this.make("uniform", CULL_UNIFORM_BYTES, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    const clusters = this.upload("clusters", storage, new Uint8Array(tables.clusters));
    const blocks = this.upload("blocks", storage, blockWords(tables.blocks));
    const spheres = this.upload("spheres", storage, tables.spheres);
    const bandOf = this.make("bands", n * 4, storage);
    const local = this.make("local", n * 16, storage);
    const sums = this.make("sums", (this.workgroups + 1) * 16, storage);
    const groups = this.upload("groups", storage, groupWords(tables.groups));
    this.args = this.make("args", tables.groups.length * INDIRECT_BYTES, storage | GPUBufferUsage.INDIRECT);
    const source = this.upload("source indices", storage, tables.indices);
    this.indices = this.make("indices", tables.indices.byteLength, storage | GPUBufferUsage.INDEX);

    // The static half of the uniform block.
    const u = this.u32;
    const f = this.f32;
    f[28] = tables.bands2[0];
    f[29] = tables.bands2[1];
    f[30] = tables.bands2[2];
    u[32] = n;
    u[33] = tables.groups.length;
    u[34] = this.workgroups;

    const module = device.createShaderModule({ label: "cluster cull", code: CLUSTER_CULL_WGSL });
    // Each entry point's own bindings: an "auto" layout holds only what its
    // entry point reads, so each pass binds exactly those.
    const entries: { entry: string; bind: readonly [number, GPUBuffer][] }[] = [
      {
        entry: "cullClusters",
        bind: [[0, this.uniform], [1, clusters], [2, blocks], [3, spheres], [4, bandOf], [5, local], [6, sums]],
      },
      { entry: "prefix", bind: [[0, this.uniform], [5, local], [6, sums], [7, groups], [8, this.args]] },
      {
        entry: "scatter",
        bind: [[0, this.uniform], [1, clusters], [4, bandOf], [5, local], [6, sums], [7, groups], [9, source], [10, this.indices]],
      },
    ];
    this.ready = Promise.all(
      entries.map(({ entry, bind }) =>
        device
          .createComputePipelineAsync({
            label: `cluster cull: ${entry}`,
            layout: "auto",
            compute: { module, entryPoint: entry },
          })
          .then((pipeline) => ({
            pipeline,
            group: device.createBindGroup({
              label: `cluster cull: ${entry}`,
              layout: pipeline.getBindGroupLayout(0),
              entries: bind.map(([binding, buffer]) => ({ binding, resource: { buffer } })),
            }),
          })),
      ),
    ).then(
      (passes) => {
        this.passes.push(...passes);
        this.built = true;
        return true;
      },
      (err: unknown) => {
        console.error("cluster cull: a pipeline did not build; the blocks go back to Babylon", err);
        return false;
      },
    );
  }

  /**
   * Culls this frame's clusters against `frame` (its view-projection, its
   * eye and its wind) and the reach and size gate, and submits the work.
   * Called once a frame as the main pass begins (`Renderer.onFrame`).
   */
  dispatch(frame: FrameUniforms): void {
    if (!this.built || this.clusterCount === 0) return;
    const f = this.f32;
    const u = this.u32;
    writePlanes(frame.viewProjection, f);
    const eye = frame.camPos;
    f[20] = eye[0];
    f[21] = eye[1];
    f[22] = eye[2];
    const g = this.gate;
    f[23] = Math.min(F32_MAX, g.reach * g.reach);
    f[24] = g.perRad;
    f[25] = g.px2;
    u[26] = g.sizeGate ? 1 : 0;
    f[27] = rampReach(frame);
    f[31] = rigReach(frame);
    this.device.queue.writeBuffer(this.uniform, 0, this.bytes);

    const encoder = this.device.createCommandEncoder({ label: "cluster cull" });
    const pass = encoder.beginComputePass({ label: "cluster cull" });
    const passes = this.passes;
    pass.setPipeline(passes[0].pipeline);
    pass.setBindGroup(0, passes[0].group);
    pass.dispatchWorkgroups(this.workgroups);
    pass.setPipeline(passes[1].pipeline);
    pass.setBindGroup(0, passes[1].group);
    pass.dispatchWorkgroups(1);
    pass.setPipeline(passes[2].pipeline);
    pass.setBindGroup(0, passes[2].group);
    pass.dispatchWorkgroups(this.scatterX, this.scatterY);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  dispose(): void {
    for (const b of this.buffers) b.destroy();
    this.buffers.length = 0;
    this.passes.length = 0;
    this.built = false;
  }

  private make(label: string, size: number, usage: number): GPUBuffer {
    const buffer = this.device.createBuffer({
      label: `cluster cull: ${label}`,
      size: Math.max(16, Math.ceil(size / 4) * 4),
      usage,
    });
    this.buffers.push(buffer);
    return buffer;
  }

  private upload(label: string, usage: number, data: Uint8Array | Uint32Array | Float32Array): GPUBuffer {
    const buffer = this.device.createBuffer({
      label: `cluster cull: ${label}`,
      size: Math.max(16, Math.ceil(data.byteLength / 4) * 4),
      usage,
      mappedAtCreation: true,
    });
    new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    buffer.unmap();
    this.buffers.push(buffer);
    return buffer;
  }
}

/**
 * The frustum's four side planes and the eye's own plane (`w >= 0`) out of a
 * view-projection laid out as WGSL's `mat4x4f` reads it (a column every four
 * floats), each normalised so a plane's value is metres — into `out[0..20)`.
 */
function writePlanes(m: Float32Array, out: Float32Array): void {
  for (let k = 0; k < 5; k++) {
    // clip = column0 * x + column1 * y + column2 * z + column3; a side plane
    // is w + x, w - x, w + y, w - y, and the eye's plane w alone.
    const row = k < 2 ? 0 : 1;
    const sign = k === 4 ? 0 : k % 2 === 0 ? 1 : -1;
    const a = m[3] + sign * m[row];
    const b = m[7] + sign * m[4 + row];
    const c = m[11] + sign * m[8 + row];
    const d = m[15] + sign * m[12 + row];
    const len = Math.hypot(a, b, c) || 1;
    out[k * 4] = a / len;
    out[k * 4 + 1] = b / len;
    out[k * 4 + 2] = c / len;
    out[k * 4 + 3] = d / len;
  }
}

/**
 * The most a RAMP weight of 1 moves a vertex this frame, metres: the gust is
 * two sines summing to at most 1.5 (`celVertex`'s ramp).
 */
function rampReach(frame: FrameUniforms): number {
  return 1.5 * Math.abs(frame.windParams[0]);
}

/**
 * The most a RIGGED vertex moves this frame, metres, over both layers: its
 * lean downwind and across (`down`, `across`), its flap (`rig.y`, partials
 * summing to 1.35) and its leaf or pinna (`rig.w`, up to 1 vertically and
 * half that downwind) — each with the bend, edge and pressure factors at
 * their bound of 1 (`celVertex`'s rig).
 */
function rigReach(frame: FrameUniforms): number {
  return Math.max(
    layerReach(frame.windFrond, frame.windFrondRate),
    layerReach(frame.windBough, frame.windBoughRate),
  );
}

/** `rigReach` for one rigged layer: its `rig` vec4 and its `rate` vec4. */
function layerReach(rig: Float32Array, rate: Float32Array): number {
  const across = Math.abs(rig[0]) * Math.max(Math.abs(rate[0]), 1) + Math.abs(rig[2]) + 0.5 * Math.abs(rig[3]);
  const up = 1.35 * Math.abs(rig[1]) + Math.abs(rig[3]);
  return across + up;
}

/** The blocks' boxes as the WGSL's `Box`. */
function blockWords(blocks: readonly BlockBox[]): Float32Array {
  const out = new Float32Array(Math.max(1, blocks.length) * BLOCK_WORDS);
  blocks.forEach((b, i) => {
    const o = i * BLOCK_WORDS;
    out[o] = b.minX;
    out[o + 1] = b.minY;
    out[o + 2] = b.minZ;
    out[o + 4] = b.maxX;
    out[o + 5] = b.maxY;
    out[o + 6] = b.maxZ;
  });
  return out;
}

/** The groups as the WGSL's `Group`, the scan's half zero. */
function groupWords(groups: CullTables["groups"]): Uint32Array {
  const out = new Uint32Array(Math.max(1, groups.length) * GROUP_WORDS);
  groups.forEach((g, i) => {
    const o = i * GROUP_WORDS;
    out[o] = g.start;
    out[o + 1] = g.end;
    out[o + 2] = g.base;
  });
  return out;
}
