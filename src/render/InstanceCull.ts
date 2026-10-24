/**
 * render/InstanceCull.ts — The scatter's instances culled on the GPU, over
 * their clusters: each group's surviving (instance, cluster) records written
 * into the scatter's LIST as entries, and each group's one indirect draw over
 * them (`BABYLON_EXIT.md` X3.4b, X3.5b — the fold; the WGSL is
 * `wgsl/instanceCull.ts`) — once a frame for the main pass, once a drawn
 * map for each shadow map (X3.6a) and once a face for a reflection probe's
 * bake (X3.6c), each a VIEW of one map's tables.
 * Owns: `InstanceCull` — one view: its four compute passes' bind groups
 * (their pipelines are the renderer's `PipelineCache`'s), its uniform block,
 * the scan's buffers, its range table, the list the vertex stage reads
 * through (`list`, each range's survivors' entries from its first record —
 * `render/scatterList.ts`) and the INDIRECT arguments (`args`, one
 * `drawIndirect` a range), the WORK LIST of surviving records and its
 * length, cleared ahead of each dispatch's pass, and the indirect dispatch
 * `expand` runs over it with — and, for the view that uploaded them, the
 * instance, set, cluster and record tables and the 16-bit source indices
 * (`source`) every view of the map reads; `InstanceTables`, what a map's
 * scatter hands it.
 * Invariants: ClusterCull's, over instances and then their clusters — every
 * table is uploaded once, when the map is cut, by its first view; a
 * dispatch's inputs are numbers only (`CullInputs`), so it never reads a
 * node; an instance is dropped only when its sphere lies past the reach,
 * under the size gate, or wholly outside one of the five planes, and a
 * cluster of a kept instance only when it is not in the view's pass or its
 * moved box lies wholly outside one of them; the list is
 * sized for every record surviving, so no frame can overrun a range's run, and
 * is never cleared, because a range's draw counts only what its survivors
 * wrote;
 * it is RECORDED into the encoder the host submits ahead of the frame's
 * draws, once a submit for the main pass's view and once a slot a submit for
 * another (`CullUniform`); until the pipelines are built nothing is dispatched
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
  type CullInputs,
  type CullMode,
  CullUniform,
  type CullView,
  NO_DIAGNOSTICS,
  rangeWords,
  type ScanRange,
  writeInputs,
} from "./ClusterCull";
import { closeness, CullCheck, type CullCheckSpec } from "./CullCheck";
import type { PassTiming } from "./PassTimer";
import type { PipelineCache } from "./PipelineCache";
import { LIST_WORDS } from "./scatterList";
import { SCAN_SIZE } from "./wgsl/clusterCull";
import { INSTANCE_FORMS, INSTANCE_PROBE_WGSL } from "./wgsl/cullProbe";
import {
  DISPATCH_BYTES,
  INDIRECT_BYTES,
  INSTANCE_CULL_UNIFORM_BYTES,
  instanceCullWgsl,
  INSTANCE_WORDS,
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
   * 3, its index count in 7, its range in 8, its part's first vertex in its
   * group's arrays in 9, its sway in 12 and 13.
   */
  readonly clusters: ArrayBuffer;
  /** `RECORD_WORDS` a record: its instance, then its cluster — every range's contiguous, in range order. */
  readonly records: Uint32Array;
  /** Each range's records `[start, end)` and where its run of the list starts: its first record. */
  readonly ranges: readonly ScanRange[];
  /** Every instanced part's indices, each local to its part (`SOURCE_VERTICES`); its clusters carry where it starts. */
  readonly source: Uint16Array;
  /** The square of each near-first band's end, metres (three). */
  readonly bands2: readonly number[];
}

/** The descriptor a frame's pass is begun with, made once. */
const PASS: GPUComputePassDescriptor = { label: "instance cull" };

/** A map's instance tables as uploaded once, which every view of its cull reads. */
interface InstanceTableBuffers {
  readonly instances: GPUBuffer;
  readonly instanceCount: number;
  readonly sets: GPUBuffer;
  readonly clusters: GPUBuffer;
  readonly records: GPUBuffer;
  readonly recordCount: number;
  readonly source: GPUBuffer;
  /** Each range, as `rangeWords` lays it out: every view uploads its own, which its scan writes. */
  readonly ranges: Uint32Array;
  readonly rangeCount: number;
  readonly bands2: readonly number[];
  readonly buffers: readonly GPUBuffer[];
}

export class InstanceCull {
  /** The scatter's list: each range's survivors' entries, from its first record. */
  readonly list: GPUBuffer;
  /** Every instanced part's 16-bit indices, which the vertex stage reads through the list — the map's, one for every view. */
  readonly source: GPUBuffer;
  /** Each range's `drawIndirect` arguments, at `INDIRECT_BYTES` a range. */
  readonly args: GPUBuffer;
  /** Resolves true once the four pipelines are built; false if one failed. */
  readonly ready: Promise<boolean>;
  private built = false;
  private disposed = false;

  /** The map's tables: the view that uploaded them owns them, and every view reads them. */
  private readonly tables: InstanceTableBuffers;
  private readonly ownsTables: boolean;
  /** This view's own buffers. */
  private readonly buffers: GPUBuffer[] = [];
  private readonly uniform: CullUniform;
  private readonly bytes = new ArrayBuffer(INSTANCE_CULL_UNIFORM_BYTES);
  private readonly f32 = new Float32Array(this.bytes);
  private readonly u32 = new Uint32Array(this.bytes);
  private readonly count: number;
  private readonly instanceWorkgroups: number;
  private readonly recordWorkgroups: number;
  /** The work list's length, cleared ahead of each dispatch's pass. */
  private readonly survivorCount: GPUBuffer;
  /** `expand`'s workgroups, written by `prefix`: a `dispatchWorkgroupsIndirect`'s arguments, then the count. */
  private readonly expandGroups: GPUBuffer;
  /** The four passes in dispatch order: instances, records, prefix, expand. */
  private readonly passes: { pipeline: GPUComputePipeline; group: GPUBindGroup }[] = [];
  /** The view's name, which every buffer it makes is labelled with — the tables the first view's. */
  private readonly viewLabel: string;
  /** Which tests run — `CullMode`; "full" but for a diagnostic. */
  private readonly mode: CullMode;
  /** `?cullcheck`'s reader, or null. */
  private readonly check: CullCheck | null;

  /**
   * The cull of a map's scatter `tables`, which it uploads — or, handed
   * another `InstanceCull`, a second VIEW of that one's tables, which uploads
   * none, writes a list and arguments of its own and must be disposed no
   * later than the cull it reads (`WorldDepth`'s, for the shadow maps). Only
   * the first view takes `?cullcheck`'s report.
   */
  constructor(
    private readonly device: GPUDevice,
    pipelines: PipelineCache,
    tables: InstanceTables | InstanceCull,
    /** The corners a survivor's run takes in the draw: a cluster's most indices. */
    stride: number,
    view: CullView,
    diagnostics: CullDiagnostics = NO_DIAGNOSTICS,
  ) {
    this.mode = diagnostics.mode;
    this.viewLabel = view.label;
    const shared = tables instanceof InstanceCull;
    const report = shared ? null : diagnostics.report;
    const storage = GPUBufferUsage.STORAGE;
    // `?cullcheck` copies the uniform block and the verdicts out.
    const read = report ? GPUBufferUsage.COPY_SRC : 0;
    this.ownsTables = !shared;
    this.tables = shared ? tables.tables : this.uploadTables(tables, read);
    const t = this.tables;
    const n = t.instanceCount;
    const records = t.recordCount;
    this.count = n;
    this.source = t.source;
    this.instanceWorkgroups = Math.max(1, Math.ceil(n / SCAN_SIZE));
    this.recordWorkgroups = Math.max(1, Math.ceil(records / SCAN_SIZE));

    this.uniform = new CullUniform(device, `instance cull: ${view.label}`, INSTANCE_CULL_UNIFORM_BYTES, view.slots, read);
    const instanceBand = this.make("instance bands", n * 4, storage | read);
    const local = this.make("local", records * 16, storage);
    const sums = this.make("sums", (this.recordWorkgroups + 1) * 16, storage);
    // COPY_DST for the clear ahead of each dispatch's pass.
    this.survivorCount = this.make("survivor count", 4, storage | GPUBufferUsage.COPY_DST);
    const survivors = this.make("survivors", records * 16, storage);
    this.expandGroups = this.make("expand workgroups", DISPATCH_BYTES, storage | GPUBufferUsage.INDIRECT);
    const ranges = this.upload("ranges", storage, t.ranges);
    this.list = this.make("list", records * LIST_WORDS * 4, storage);
    this.args = this.make("args", t.rangeCount * INDIRECT_BYTES, storage | GPUBufferUsage.INDIRECT);

    // The static half of the uniform block.
    const u = this.u32;
    const f = this.f32;
    f[28] = t.bands2[0];
    f[29] = t.bands2[1];
    f[30] = t.bands2[2];
    u[32] = n;
    u[33] = records;
    u[34] = this.recordWorkgroups;
    u[35] = t.rangeCount;

    const uniform = this.uniform.buffer;
    this.check =
      report && !shared
        ? new CullCheck(
            device,
            pipelines,
            {
              label: "instances",
              count: n,
              uniform,
              uniformBytes: INSTANCE_CULL_UNIFORM_BYTES,
              bands: instanceBand,
              probe: INSTANCE_PROBE_WGSL,
              data: t.instances,
              dataBytes: new Uint8Array(tables.instances),
              probeBind: [[0, uniform], [12, uniform], [1, t.instances], [11, t.instances], [5, t.sets], [9, t.sets]],
              forms: INSTANCE_FORMS,
              ...instanceReplay(tables),
            },
            report,
          )
        : null;

    // Each entry point's own bindings: an "auto" layout holds only what its
    // entry point reads, so each pass binds exactly those.
    const code = instanceCullWgsl(stride);
    const entries: { entry: string; bind: readonly (readonly [number, GPUBuffer])[] }[] = [
      { entry: "cullInstances", bind: [[0, uniform], [1, t.instances], [2, instanceBand], [5, t.sets]] },
      {
        entry: "cullRecords",
        bind: [
          [0, uniform], [1, t.instances], [2, instanceBand], [3, local], [4, sums], [6, t.clusters], [7, t.records],
          [13, this.survivorCount], [14, survivors],
        ],
      },
      {
        entry: "prefix",
        bind: [[0, uniform], [3, local], [4, sums], [9, ranges], [12, this.args], [13, this.survivorCount], [15, this.expandGroups]],
      },
      {
        entry: "expand",
        bind: [
          [0, uniform], [3, local], [4, sums], [6, t.clusters], [9, ranges], [11, this.list],
          [14, survivors], [16, this.expandGroups],
        ],
      },
    ];
    this.ready = Promise.all(
      entries.map(({ entry, bind }) =>
        pipelines
          .compute("instance cull", code, entry)
          .then((pipeline) => ({
            pipeline,
            group: device.createBindGroup({
              label: `instance cull: ${view.label}: ${entry}`,
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
        if (!this.disposed) console.error(`instance cull: a pipeline did not build for ${view.label}`, err);
        return false;
      },
    );
  }

  /**
   * Culls the instances and their clusters for `inputs`, recording the work
   * into `encoder` — the host's, submitted ahead of the frame's draws: as
   * `ClusterCull.dispatch`, once a frame for the main pass's view and once a
   * `slot` a submit for another. Its one pass is timed when `timing` is
   * handed (`gpu.cull`).
   */
  dispatch(inputs: CullInputs, encoder: GPUCommandEncoder, timing: PassTiming | null = null, slot = 0): void {
    if (!this.built || this.count === 0) return;
    writeInputs(inputs, this.mode, this.f32, this.u32);
    this.uniform.write(this.bytes, encoder, slot);

    // The work list starts empty: `cullRecords` appends to it.
    encoder.clearBuffer(this.survivorCount);
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
    pass.dispatchWorkgroupsIndirect(this.expandGroups, 0);
    pass.end();
    this.check?.record(encoder, this.bytes);
  }

  /** This view's buffers destroyed — and the tables, if this view uploaded them. */
  dispose(): void {
    this.check?.dispose();
    for (const b of this.buffers) b.destroy();
    this.buffers.length = 0;
    this.uniform.destroy();
    if (this.ownsTables) for (const b of this.tables.buffers) b.destroy();
    this.passes.length = 0;
    this.built = false;
    this.disposed = true;
  }

  /** `tables` uploaded once, for every view of this cull to read. */
  private uploadTables(tables: InstanceTables, read: number): InstanceTableBuffers {
    const storage = GPUBufferUsage.STORAGE;
    const buffers: GPUBuffer[] = [];
    const up = (label: string, usage: number, data: Uint8Array | Uint16Array | Uint32Array): GPUBuffer => {
      const b = this.upload(label, usage, data);
      // Not this view's own: `dispose` destroys the tables apart.
      this.buffers.pop();
      buffers.push(b);
      return b;
    };
    return {
      instances: up("instances", storage | read, new Uint8Array(tables.instances)),
      instanceCount: tables.instanceCount,
      sets: up("sets", storage, setWords(tables.sets)),
      clusters: up("clusters", storage, new Uint8Array(tables.clusters)),
      records: up("records", storage, tables.records),
      recordCount: tables.records.length / RECORD_WORDS,
      source: up("source indices", storage, tables.source),
      ranges: rangeWords(tables.ranges),
      rangeCount: tables.ranges.length,
      bands2: tables.bands2,
      buffers,
    };
  }

  private make(label: string, size: number, usage: number): GPUBuffer {
    const buffer = this.device.createBuffer({
      label: `instance cull: ${this.viewLabel}: ${label}`,
      size: Math.max(16, Math.ceil(size / 4) * 4),
      usage,
    });
    this.buffers.push(buffer);
    return buffer;
  }

  private upload(label: string, usage: number, data: Uint8Array | Uint16Array | Uint32Array): GPUBuffer {
    const buffer = this.device.createBuffer({
      label: `instance cull: ${this.viewLabel}: ${label}`,
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
