/**
 * render/InstanceCull.ts — The scatter's instances culled on the GPU once a
 * frame, writing each set's surviving transforms and every instanced draw's
 * indirect arguments (`BABYLON_EXIT.md` X3.4b; the WGSL is
 * `wgsl/instanceCull.ts`).
 * Owns: `InstanceCull` — the three compute passes' bind groups (their
 * pipelines are the renderer's `PipelineCache`'s), the instance, set and draw
 * tables, the scan's buffers, the INDIRECT arguments (`args`, one
 * `drawIndexedIndirect` a draw) and the transforms they draw (`placed`,
 * written every frame, each set's survivors at the start of its own region);
 * `InstanceTables`, what a map's scatter hands it.
 * Invariants: ClusterCull's, over instances — every table is uploaded once,
 * when the map is cut; a frame's inputs are numbers only (the frame's
 * view-projection, eye and wind, and the reach and size gate as `ReachGate`
 * holds them), so it never reads a node; an instance is dropped only when its
 * sphere lies past the reach, under the size gate, or wholly outside one of
 * the five planes; it is RECORDED into the encoder the host submits ahead of
 * the frame's draws, once a submit; until the pipelines are built nothing is
 * dispatched and `args` stays the zeros it was made with.
 * Never: imports Babylon; reads a node; submits; allocates on a frame beyond
 * the compute pass WebGPU makes for every pass; sets anything after
 * `dispose`.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 */
import {
  type CullBuffer,
  type CullDiagnostics,
  type CullMode,
  type ReachGate,
  NO_DIAGNOSTICS,
  openTests,
  rampReach,
  readUsage,
  rigReach,
  writePlanes,
  F32_MAX,
} from "./ClusterCull";
import { closeness, CullCheck, type CullCheckSpec } from "./CullCheck";
import type { FrameUniforms } from "./frame";
import type { PipelineCache } from "./PipelineCache";
import { INSTANCE_FORMS, INSTANCE_PROBE_WGSL } from "./wgsl/cullProbe";
import {
  DRAW_WORDS,
  INSTANCE_CULL_UNIFORM_BYTES,
  INSTANCE_CULL_WGSL,
  INSTANCE_SCAN_SIZE,
  INSTANCE_WORDS,
  PLACE_SIZE,
  SET_WORDS,
  TRANSFORM_WORDS,
} from "./wgsl/instanceCull";

/** What a map's scatter hands the cull — every array in set order. */
export interface InstanceTables {
  /** `INSTANCE_WORDS` an instance, laid out as the WGSL's `Instance`, sorted by set. */
  readonly instances: ArrayBuffer;
  readonly instanceCount: number;
  /** Each set's instances `[start, end)`, and how far its vertices can sway. */
  readonly sets: readonly { readonly start: number; readonly end: number; readonly ramp: number; readonly rigged: boolean }[];
  /** Each draw's set and its index range in its group's buffers. */
  readonly draws: readonly { readonly set: number; readonly indexCount: number; readonly firstIndex: number; readonly baseVertex: number }[];
  /** The square of each near-first band's end, metres (three). */
  readonly bands2: readonly number[];
}

/** The descriptor a frame's pass is begun with, made once. */
const PASS: GPUComputePassDescriptor = { label: "instance cull" };

export class InstanceCull {
  /** Each draw's `drawIndexedIndirect` arguments, at 20 bytes a draw. */
  readonly args: GPUBuffer;
  /** The surviving transforms, each set's at the start of its own region: a vertex buffer. */
  readonly placed: GPUBuffer;
  /** Resolves true once the three pipelines are built; false if one failed. */
  readonly ready: Promise<boolean>;
  private built = false;
  private disposed = false;

  private readonly buffers: GPUBuffer[] = [];
  private readonly uniform: GPUBuffer;
  private readonly bytes = new ArrayBuffer(INSTANCE_CULL_UNIFORM_BYTES);
  private readonly f32 = new Float32Array(this.bytes);
  private readonly u32 = new Uint32Array(this.bytes);
  private readonly count: number;
  private readonly workgroups: number;
  private readonly placeX: number;
  private readonly placeY: number;
  /** The three passes in dispatch order: cull, prefix, place. */
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
    this.count = n;
    this.workgroups = Math.max(1, Math.ceil(n / INSTANCE_SCAN_SIZE));
    const groups = Math.max(1, Math.ceil(n / PLACE_SIZE));
    const maxX = device.limits.maxComputeWorkgroupsPerDimension;
    this.placeX = Math.min(groups, maxX);
    this.placeY = Math.ceil(groups / this.placeX);

    const storage = GPUBufferUsage.STORAGE;
    // `?cullcheck` copies the uniform block, the records and the verdicts out.
    const read = (which: CullBuffer): number => readUsage(diagnostics, which);
    this.uniform = this.make(
      "uniform",
      INSTANCE_CULL_UNIFORM_BYTES,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST | read("uniform"),
    );
    const instances = this.upload("instances", storage | read("records"), new Uint8Array(tables.instances));
    const bandOf = this.make("bands", n * 4, storage | read("bands"));
    const local = this.make("local", n * 16, storage);
    const sums = this.make("sums", (this.workgroups + 1) * 16, storage);
    const sets = this.upload("sets", storage, setWords(tables.sets));
    const draws = this.upload("draws", storage, drawWords(tables.draws));
    this.args = this.make("args", tables.draws.length * 20, storage | GPUBufferUsage.INDIRECT);
    this.placed = this.make("placed", n * TRANSFORM_WORDS * 4, storage | GPUBufferUsage.VERTEX);

    // The static half of the uniform block.
    const u = this.u32;
    const f = this.f32;
    f[28] = tables.bands2[0];
    f[29] = tables.bands2[1];
    f[30] = tables.bands2[2];
    u[32] = n;
    u[33] = tables.sets.length;
    u[34] = this.workgroups;
    u[35] = tables.draws.length;

    this.check = diagnostics.report
      ? new CullCheck(
          device,
          pipelines,
          {
            label: "instances",
            count: n,
            uniform: this.uniform,
            uniformBytes: INSTANCE_CULL_UNIFORM_BYTES,
            bands: bandOf,
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

    const entries: { entry: string; bind: readonly [number, GPUBuffer][] }[] = [
      {
        entry: "cullInstances",
        bind: [[0, this.uniform], [1, instances], [2, bandOf], [3, local], [4, sums], [5, sets]],
      },
      { entry: "prefix", bind: [[0, this.uniform], [3, local], [4, sums], [5, sets], [6, draws], [7, this.args]] },
      {
        entry: "place",
        bind: [[0, this.uniform], [1, instances], [2, bandOf], [3, local], [4, sums], [5, sets], [8, this.placed]],
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
   * Culls this frame's instances against `frame` and the reach and size gate,
   * recording the work into `encoder` — the host's, submitted ahead of the
   * frame's draws. Once a frame, as the main pass begins.
   */
  dispatch(frame: FrameUniforms, encoder: GPUCommandEncoder): void {
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

    const pass = encoder.beginComputePass(PASS);
    const passes = this.passes;
    pass.setPipeline(passes[0].pipeline);
    pass.setBindGroup(0, passes[0].group);
    pass.dispatchWorkgroups(this.workgroups);
    pass.setPipeline(passes[1].pipeline);
    pass.setBindGroup(0, passes[1].group);
    pass.dispatchWorkgroups(1);
    pass.setPipeline(passes[2].pipeline);
    pass.setBindGroup(0, passes[2].group);
    pass.dispatchWorkgroups(this.placeX, this.placeY);
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

/** The sets as the WGSL's `Set`, the scan's half zero. */
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

/** The draws as the WGSL's `Draw`. */
function drawWords(draws: InstanceTables["draws"]): Uint32Array {
  const out = new Uint32Array(Math.max(1, draws.length) * DRAW_WORDS);
  const i32 = new Int32Array(out.buffer);
  draws.forEach((d, i) => {
    const o = i * DRAW_WORDS;
    out[o] = d.set;
    out[o + 1] = d.indexCount;
    out[o + 2] = d.firstIndex;
    i32[o + 3] = d.baseVertex;
  });
  return out;
}

