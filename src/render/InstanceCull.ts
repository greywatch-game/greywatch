/**
 * render/InstanceCull.ts — The scatter's instances culled on the GPU once a
 * frame and EXPANDED into their clusters: each group's surviving
 * (instance, cluster) records written into the scatter's STREAM as indices,
 * and each group's one indirect draw over them (`BABYLON_EXIT.md` X3.4b,
 * X3.5b — the fold; the WGSL is `wgsl/instanceCull.ts`).
 * Owns: `InstanceCull` — the four compute passes' bind groups (their
 * pipelines are the renderer's `PipelineCache`'s), the instance, set,
 * cluster, record and range tables, the source indices, the scan's buffers,
 * the stream the scatter draws (`indices`, each range's survivors from the
 * start of its own region, every index carrying its instance —
 * `render/streamIndex.ts`) and the INDIRECT arguments (`args`, one
 * `drawIndexedIndirect` a range); `InstanceTables`, what a map's scatter
 * hands it.
 * Invariants: ClusterCull's, over instances and then their clusters — every
 * table is uploaded once, when the map is cut; a frame's inputs are numbers
 * only (the frame's view-projection, eye and wind, and the reach and size
 * gate as `ReachGate` holds them), so it never reads a node; an instance is
 * dropped only when its sphere lies past the reach, under the size gate, or
 * wholly outside one of the five planes, and a cluster of a kept instance
 * only when its moved box lies wholly outside one of them; the stream is
 * sized for every record surviving, so no frame can overrun a region, and is
 * never cleared, because a range's draw counts only what its survivors wrote;
 * it is RECORDED into the encoder the host submits ahead of the frame's
 * draws, once a submit; until the pipelines are built nothing is dispatched
 * and `args` stays the zeros it was made with, so every range draws nothing.
 * `?cullcheck` reads the INSTANCES' verdicts (`instanceBand`); a cluster's
 * test is the cluster cull's own box test, over a moved box.
 * Never: imports Babylon; reads a node; submits; allocates on a frame beyond
 * the compute pass WebGPU makes for every pass; sets anything after
 * `dispose`.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 */
import {
  type CullDiagnostics,
  type CullMode,
  type ReachGate,
  NO_DIAGNOSTICS,
  openTests,
  rampReach,
  rigReach,
  writePlanes,
  F32_MAX,
} from "./ClusterCull";
import { closeness, CullCheck, type CullCheckSpec } from "./CullCheck";
import type { FrameUniforms } from "./frame";
import type { PassTiming } from "./PassTimer";
import type { PipelineCache } from "./PipelineCache";
import { INSTANCE_FORMS, INSTANCE_PROBE_WGSL } from "./wgsl/cullProbe";
import {
  INDIRECT_BYTES,
  INSTANCE_CULL_UNIFORM_BYTES,
  INSTANCE_CULL_WGSL,
  INSTANCE_SCAN_SIZE,
  INSTANCE_WORDS,
  RANGE_WORDS,
  RECORD_WORDS,
  SET_WORDS,
} from "./wgsl/instanceCull";

/** What a map's scatter hands the cull — every array in the order it is drawn. */
export interface InstanceTables {
  /** `INSTANCE_WORDS` an instance, laid out as the WGSL's `Instance`, sorted by set. */
  readonly instances: ArrayBuffer;
  readonly instanceCount: number;
  /** Each set's instances `[start, end)`, and how far its vertices can sway. */
  readonly sets: readonly { readonly start: number; readonly end: number; readonly ramp: number; readonly rigged: boolean }[];
  /**
   * `CLUSTER_WORDS` a cluster of an instanced part, laid out as the WGSL's
   * `Cluster` in its set's own frame: its first index into `source` in word
   * 3, its index count in 7, its range in 8, its sway in 12 and 13.
   */
  readonly clusters: ArrayBuffer;
  /** `RECORD_WORDS` a record: its instance, then its cluster — every range's contiguous, in range order. */
  readonly records: Uint32Array;
  /** Each range's records `[start, end)` and where its region of the stream starts. */
  readonly ranges: readonly { readonly start: number; readonly end: number; readonly base: number }[];
  /** Every instanced part's indices, each onto its group's arrays. */
  readonly source: Uint32Array;
  /** The stream's length in indices: every record's, as if every one survived. */
  readonly streamLength: number;
  /** The square of each near-first band's end, metres (three). */
  readonly bands2: readonly number[];
}

/** The descriptor a frame's pass is begun with, made once. */
const PASS: GPUComputePassDescriptor = { label: "instance cull" };

export class InstanceCull {
  /** The scatter's stream: each range's surviving indices from the start of its region. */
  readonly indices: GPUBuffer;
  /** Each range's `drawIndexedIndirect` arguments, at `INDIRECT_BYTES` a range. */
  readonly args: GPUBuffer;
  /** Resolves true once the four pipelines are built; false if one failed. */
  readonly ready: Promise<boolean>;
  private built = false;
  private disposed = false;

  private readonly buffers: GPUBuffer[] = [];
  private readonly uniform: GPUBuffer;
  private readonly bytes = new ArrayBuffer(INSTANCE_CULL_UNIFORM_BYTES);
  private readonly f32 = new Float32Array(this.bytes);
  private readonly u32 = new Uint32Array(this.bytes);
  private readonly count: number;
  private readonly instanceWorkgroups: number;
  private readonly recordWorkgroups: number;
  private readonly expandX: number;
  private readonly expandY: number;
  /** The four passes in dispatch order: instances, records, prefix, expand. */
  private readonly passes: { pipeline: GPUComputePipeline; group: GPUBindGroup }[] = [];
  /** Which tests run — `CullMode`; "full" but for a diagnostic. */
  private readonly mode: CullMode;
  /** `?cullcheck`'s reader, or null. */
  private readonly check: CullCheck | null;

  constructor(
    private readonly device: GPUDevice,
    pipelines: PipelineCache,
    tables: InstanceTables,
    private readonly gate: ReachGate,
    diagnostics: CullDiagnostics = NO_DIAGNOSTICS,
  ) {
    this.mode = diagnostics.mode;
    const n = tables.instanceCount;
    const records = tables.records.length / RECORD_WORDS;
    this.count = n;
    this.instanceWorkgroups = Math.max(1, Math.ceil(n / INSTANCE_SCAN_SIZE));
    this.recordWorkgroups = Math.max(1, Math.ceil(records / INSTANCE_SCAN_SIZE));
    const maxX = device.limits.maxComputeWorkgroupsPerDimension;
    this.expandX = Math.max(1, Math.min(records, maxX));
    this.expandY = Math.max(1, Math.ceil(records / this.expandX));

    const storage = GPUBufferUsage.STORAGE;
    // `?cullcheck` copies the uniform block and the verdicts out.
    const read = diagnostics.report ? GPUBufferUsage.COPY_SRC : 0;
    this.uniform = this.make(
      "uniform",
      INSTANCE_CULL_UNIFORM_BYTES,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST | read,
    );
    const instances = this.upload("instances", storage | read, new Uint8Array(tables.instances));
    const instanceBand = this.make("instance bands", n * 4, storage | read);
    const local = this.make("local", records * 16, storage);
    const sums = this.make("sums", (this.recordWorkgroups + 1) * 16, storage);
    const sets = this.upload("sets", storage, setWords(tables.sets));
    const clusters = this.upload("clusters", storage, new Uint8Array(tables.clusters));
    const recordTable = this.upload("records", storage, tables.records);
    const recordBand = this.make("record bands", records * 4, storage);
    const ranges = this.upload("ranges", storage, rangeWords(tables.ranges));
    const source = this.upload("source indices", storage, tables.source);
    this.indices = this.make("stream", tables.streamLength * 4, storage | GPUBufferUsage.INDEX);
    this.args = this.make("args", tables.ranges.length * INDIRECT_BYTES, storage | GPUBufferUsage.INDIRECT);

    // The static half of the uniform block.
    const u = this.u32;
    const f = this.f32;
    f[28] = tables.bands2[0];
    f[29] = tables.bands2[1];
    f[30] = tables.bands2[2];
    u[32] = n;
    u[33] = records;
    u[34] = this.recordWorkgroups;
    u[35] = tables.ranges.length;

    this.check = diagnostics.report
      ? new CullCheck(
          device,
          pipelines,
          {
            label: "instances",
            count: n,
            uniform: this.uniform,
            uniformBytes: INSTANCE_CULL_UNIFORM_BYTES,
            bands: instanceBand,
            probe: INSTANCE_PROBE_WGSL,
            data: instances,
            dataBytes: new Uint8Array(tables.instances),
            probeBind: [[0, this.uniform], [12, this.uniform], [1, instances], [11, instances], [5, sets], [9, sets]],
            forms: INSTANCE_FORMS,
            ...instanceReplay(tables),
          },
          diagnostics.report,
        )
      : null;

    // Each entry point's own bindings: an "auto" layout holds only what its
    // entry point reads, so each pass binds exactly those.
    const entries: { entry: string; bind: readonly [number, GPUBuffer][] }[] = [
      { entry: "cullInstances", bind: [[0, this.uniform], [1, instances], [2, instanceBand], [5, sets]] },
      {
        entry: "cullRecords",
        bind: [[0, this.uniform], [1, instances], [2, instanceBand], [3, local], [4, sums], [6, clusters], [7, recordTable], [8, recordBand]],
      },
      { entry: "prefix", bind: [[0, this.uniform], [3, local], [4, sums], [9, ranges], [12, this.args]] },
      {
        entry: "expand",
        bind: [
          [0, this.uniform], [3, local], [4, sums], [6, clusters], [7, recordTable], [8, recordBand], [9, ranges],
          [10, source], [11, this.indices],
        ],
      },
    ];
    this.ready = Promise.all(
      entries.map(({ entry, bind }) =>
        pipelines
          .compute("instance cull", INSTANCE_CULL_WGSL, entry)
          .then((pipeline) => ({
            pipeline,
            group: device.createBindGroup({
              label: `instance cull: ${entry}`,
              layout: pipeline.getBindGroupLayout(0),
              entries: bind.map(([binding, buffer]) => ({ binding, resource: { buffer } })),
            }),
          })),
      ),
    ).then(
      (passes) => {
        if (this.disposed) return false;
        this.passes.push(...passes);
        this.built = true;
        return true;
      },
      (err: unknown) => {
        if (!this.disposed) console.error("instance cull: a pipeline did not build; the scatter goes back to Babylon", err);
        return false;
      },
    );
  }

  /**
   * Culls this frame's instances and their clusters against `frame` and the
   * reach and size gate, recording the work into `encoder` — the host's,
   * submitted ahead of the frame's draws. Once a frame, as the main pass
   * begins; its one pass is timed when `timing` is handed (`gpu.cull`).
   */
  dispatch(frame: FrameUniforms, encoder: GPUCommandEncoder, timing: PassTiming | null = null): void {
    if (!this.built || this.count === 0) return;
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
    openTests(this.mode, f, u);
    this.device.queue.writeBuffer(this.uniform, 0, this.bytes);

    const pass = encoder.beginComputePass(timing ? timing.pass(PASS) : PASS);
    const passes = this.passes;
    pass.setPipeline(passes[0].pipeline);
    pass.setBindGroup(0, passes[0].group);
    pass.dispatchWorkgroups(this.instanceWorkgroups);
    pass.setPipeline(passes[1].pipeline);
    pass.setBindGroup(0, passes[1].group);
    pass.dispatchWorkgroups(this.recordWorkgroups);
    pass.setPipeline(passes[2].pipeline);
    pass.setBindGroup(0, passes[2].group);
    pass.dispatchWorkgroups(1);
    pass.setPipeline(passes[3].pipeline);
    pass.setBindGroup(0, passes[3].group);
    pass.dispatchWorkgroups(this.expandX, this.expandY);
    pass.end();
    this.check?.record(encoder, this.bytes);
  }

  dispose(): void {
    this.check?.dispose();
    for (const b of this.buffers) b.destroy();
    this.buffers.length = 0;
    this.passes.length = 0;
    this.built = false;
    this.disposed = true;
  }

  private make(label: string, size: number, usage: number): GPUBuffer {
    const buffer = this.device.createBuffer({
      label: `instance cull: ${label}`,
      size: Math.max(16, Math.ceil(size / 4) * 4),
      usage,
    });
    this.buffers.push(buffer);
    return buffer;
  }

  private upload(label: string, usage: number, data: Uint8Array | Uint32Array): GPUBuffer {
    const buffer = this.device.createBuffer({
      label: `instance cull: ${label}`,
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
 * `?cullcheck`'s CPU replay of `wgsl/instanceCull.ts`'s `visible` over
 * `tables`, and its one-line account of an instance.
 */
function instanceReplay(
  tables: InstanceTables,
): Pick<CullCheckSpec, "positionWords" | "expect" | "planes" | "replay" | "describe"> {
  const nf = new Float32Array(tables.instances);
  const nu = new Uint32Array(tables.instances);
  const grow = (f: Float32Array, o: number): number => {
    const s = tables.sets[nu[o + 16]];
    return nf[o + 3] + s.ramp * f[27] + (s.rigged ? f[31] : 0) + 0.05;
  };
  const plane = (f: Float32Array, o: number, k: number): number =>
    f[k * 4] * nf[o] + f[k * 4 + 1] * nf[o + 1] + f[k * 4 + 2] * nf[o + 2] + f[k * 4 + 3];
  const dist2 = (f: Float32Array, o: number): number => {
    const dx = nf[o] - f[20];
    const dy = nf[o + 1] - f[21];
    const dz = nf[o + 2] - f[22];
    return dx * dx + dy * dy + dz * dz;
  };
  return {
    positionWords: 4,
    expect: (i, out) => {
      const o = i * INSTANCE_WORDS;
      for (let a = 0; a < 4; a++) out[a] = nu[o + a];
    },
    planes: (f, i, out) => {
      const o = i * INSTANCE_WORDS;
      for (let k = 0; k < 5; k++) out[k] = plane(f, o, k);
      out[5] = grow(f, o);
    },
    replay: (f, u, i, near) => {
      const o = i * INSTANCE_WORDS;
      const d2 = dist2(f, o);
      const r = nf[o + 3];
      const gap = Math.max(0, Math.sqrt(d2) - r);
      near[0] = closeness(gap * gap, f[23]);
      if (gap * gap > f[23]) return 1;
      if (u[26] !== 0 && d2 > 1) {
        const w = 2 * r * f[24];
        near[0] = Math.min(near[0], closeness(w * w, f[25] * d2));
        if (w * w < f[25] * d2) return 2;
      }
      const g = grow(f, o);
      for (let k = 0; k < 5; k++) {
        const v = plane(f, o, k);
        near[0] = Math.min(near[0], closeness(v, -g));
        if (v < -g) return 3 + k;
      }
      return 0;
    },
    describe: (f, _u, i) => {
      const o = i * INSTANCE_WORDS;
      const d = Math.sqrt(dist2(f, o));
      const planes = [0, 1, 2, 3, 4].map((k) => plane(f, o, k).toFixed(2)).join(" ");
      return (
        `set ${nu[o + 16]} at [${[0, 1, 2].map((a) => nf[o + a].toFixed(1))}] r ${nf[o + 3].toFixed(2)} m · ${d.toFixed(1)} m away` +
        ` · ${((2 * nf[o + 3] * f[24]) / Math.max(d, 1)).toFixed(1)} px · planes ${planes} vs -${grow(f, o).toFixed(2)}`
      );
    },
  };
}

/** The sets as the WGSL's `Set`. */
function setWords(sets: InstanceTables["sets"]): Uint32Array {
  const out = new Uint32Array(Math.max(1, sets.length) * SET_WORDS);
  const f = new Float32Array(out.buffer);
  sets.forEach((s, i) => {
    const o = i * SET_WORDS;
    out[o] = s.start;
    out[o + 1] = s.end;
    f[o + 2] = s.ramp;
    out[o + 3] = s.rigged ? 1 : 0;
  });
  return out;
}

/** The ranges as the WGSL's `Range`, the scan's half zero. */
function rangeWords(ranges: InstanceTables["ranges"]): Uint32Array {
  const out = new Uint32Array(Math.max(1, ranges.length) * RANGE_WORDS);
  ranges.forEach((r, i) => {
    const o = i * RANGE_WORDS;
    out[o] = r.start;
    out[o + 1] = r.end;
    out[o + 2] = r.base;
  });
  return out;
}
