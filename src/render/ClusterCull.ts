/**
 * render/ClusterCull.ts — The static world's clusters culled on the GPU once
 * a frame, writing each group's surviving indices and its indirect draw
 * (`BABYLON_EXIT.md` X3.3b; the WGSL is `wgsl/clusterCull.ts`).
 * Owns: `ClusterCull` — the three compute passes' bind groups (their
 * pipelines are the renderer's `PipelineCache`'s, shared by every map), the
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
 * so it drops nothing the frustum did not already hide; the work is RECORDED
 * when the frame's main pass begins into the encoder the host submits ahead
 * of the frame's draws (`FrameHost.prepareEncoder`), so it reaches the GPU
 * before the draws that read it and inside the frame's GPU timer — once a
 * submit, because the frame's inputs are a `writeBuffer` the whole submit
 * reads (`FramePrepare`); until the
 * pipelines are built (`ready`) nothing is dispatched and `args` stays the
 * zeros it was made with, so a group draws nothing rather than garbage.
 * Never: imports Babylon; reads a node; submits; allocates on a frame beyond
 * the compute pass WebGPU makes for every pass; sets anything after
 * `dispose`, however late its pipelines arrive.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 */
import { closeness, CullCheck, type CullCheckSpec, type CullReport } from "./CullCheck";
import type { FrameUniforms } from "./frame";
import type { PipelineCache } from "./PipelineCache";
import {
  BLOCK_WORDS,
  CLUSTER_CULL_WGSL,
  CLUSTER_WORDS,
  CULL_UNIFORM_BYTES,
  GROUP_WORDS,
  INDIRECT_BYTES,
  SCAN_SIZE,
} from "./wgsl/clusterCull";
import { CLUSTER_FORMS, CLUSTER_PROBE_WGSL } from "./wgsl/cullProbe";

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

/**
 * Which of a cull's tests run: all of them; the reach and the size gate with
 * the frustum untested (`?nofrustum`); or none, so everything is kept
 * (`?nocull`). A diagnostic for a device nobody here owns (`urlOverrides.ts`),
 * never a setting.
 */
export type CullMode = "full" | "nofrustum" | "none";

/**
 * How the cluster cull's three dispatches are kept apart: in one compute pass
 * (WebGPU orders them; what it always does), each in a pass of its own
 * (`?cullsplit`), or each in an encoder of its own submitted at once, ahead
 * of the frame (`?cullsplit=submits`). A diagnostic for a device whose
 * buildings flicker standing still — the one thing that can differ between
 * two frames with the same inputs is what a dispatch reads of the one before
 * it, half written — never a setting.
 */
export type CullSplit = "none" | "passes" | "submits";

/**
 * What the cluster cull's draws read: the buffers its compute writes (what it
 * always does), or a COPY of them made after the compute by
 * `copyBufferToBuffer` — the indices (`?cullcopy=indices`), the indirect
 * arguments (`?cullcopy=args`), or both (`?cullcopy`). A diagnostic for
 * a device whose buildings flicker standing still: the one thing the blocks'
 * draw does that the scatter's does not is read an INDEX buffer a compute
 * shader wrote, and a copy reaches the draw by another path. Never a setting.
 */
export type CullCopied = "indices" | "args";
export const CULL_COPIED: readonly CullCopied[] = ["indices", "args"];

/** The three buffers of a cull `?cullcheck` copies out, as `?cullflags=` names them. */
export type CullBuffer = "uniform" | "records" | "bands";
export const CULL_BUFFERS: readonly CullBuffer[] = ["uniform", "records", "bands"];

/**
 * A cull's diagnostics, all off the URL (`core/urlOverrides.ts`): which
 * tests run (`CullMode`); which of the buffers `?cullcheck` copies out are
 * made COPY_SRC (`readable`) — the check makes all three so, and
 * `?cullflags` does alone, so a device whose bug the check hides can be
 * asked which buffer's FLAG hides it; and where `?cullcheck` reports its
 * readings (`CullCheck`) — null for no check.
 */
/**
 * `?directdraw`: the blocks drawn with `drawIndexed` at counts the CPU
 * knows — every index of a group, so right only under `?nocull` — rather
 * than `drawIndexedIndirect` at the cull's arguments. `source` reads a
 * STATIC copy of the cut's indices, uploaded once as the scatter's are, and
 * `cull` reads the cull's own index buffer.
 */
export type DirectDraw = "none" | "source" | "cull";

export interface CullDiagnostics {
  readonly mode: CullMode;
  readonly split: CullSplit;
  /**
   * `?cullonce`: the cull is dispatched on the first frame its pipelines
   * are built and never again, so its index buffer and indirect arguments
   * are written ONCE and then only read, as the scatter's index buffers are.
   * With `?nocull` the frame is right from anywhere; without it, right only
   * where the first frame stood.
   */
  readonly once: boolean;
  readonly direct: DirectDraw;
  readonly copied: ReadonlySet<CullCopied>;
  readonly readable: ReadonlySet<CullBuffer>;
  readonly report: CullReport | null;
}

/** Every test, and no check: what a cull runs with but for a diagnostic. */
export const NO_DIAGNOSTICS: CullDiagnostics = {
  mode: "full",
  split: "none",
  once: false,
  direct: "none",
  copied: new Set(),
  readable: new Set(),
  report: null,
};

/** COPY_SRC for `which` when the check copies it out or `?cullflags` names it; else 0. */
export function readUsage(d: CullDiagnostics, which: CullBuffer): number {
  return d.report || d.readable.has(which) ? GPUBufferUsage.COPY_SRC : 0;
}

/**
 * Opens the tests `mode` turns off in a cull's uniform block, after the frame
 * has written it — both culls lay the planes, the reach and the gate out
 * alike (`wgsl/clusterCull.ts`, `wgsl/instanceCull.ts`).
 */
export function openTests(mode: CullMode, f: Float32Array, u: Uint32Array): void {
  if (mode === "full") return;
  // Every plane 0x + 0y + 0z + 1: nothing lies outside it.
  for (let k = 0; k < 5; k++) {
    f[k * 4] = 0;
    f[k * 4 + 1] = 0;
    f[k * 4 + 2] = 0;
    f[k * 4 + 3] = 1;
  }
  if (mode === "nofrustum") return;
  f[23] = F32_MAX;
  u[26] = 0;
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

/** The descriptor a frame's pass is begun with, made once. */
const PASS: GPUComputePassDescriptor = { label: "cluster cull" };

/** The largest `f32` short of infinity — a shader may assume there is none. */
export const F32_MAX = 3.0e38;

export class ClusterCull {
  /** Each group's `drawIndexedIndirect` arguments, at `INDIRECT_BYTES` a group. */
  readonly args: GPUBuffer;
  /** What the draws index: each group's surviving clusters, near-first. */
  readonly indices: GPUBuffer;
  /** Resolves true once the three pipelines are built; false if one failed. */
  readonly ready: Promise<boolean>;
  private built = false;
  /** Set by `dispose`: pipelines that arrive after it are dropped. */
  private disposed = false;

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
  /** Which tests run — `CullMode`; "full" but for a diagnostic. */
  private readonly mode: CullMode;
  /** How the dispatches are kept apart — `CullSplit`; "none" but for a diagnostic. */
  private readonly split: CullSplit;
  /** `?cullonce`, and whether the one dispatch has been recorded. */
  private readonly once: boolean;
  private dispatched = false;
  /** `?cullcopy`: each buffer the compute writes and the copy the draws read, or none. */
  private readonly copies: { from: GPUBuffer; to: GPUBuffer }[] = [];
  /** `?cullcheck`'s reader, or null. */
  private readonly check: CullCheck | null;

  constructor(
    private readonly device: GPUDevice,
    pipelines: PipelineCache,
    tables: CullTables,
    private readonly gate: ReachGate,
    diagnostics: CullDiagnostics = NO_DIAGNOSTICS,
  ) {
    this.mode = diagnostics.mode;
    this.split = diagnostics.split;
    this.once = diagnostics.once;
    const n = tables.clusterCount;
    this.clusterCount = n;
    this.workgroups = Math.max(1, Math.ceil(n / SCAN_SIZE));
    const maxX = device.limits.maxComputeWorkgroupsPerDimension;
    this.scatterX = Math.max(1, Math.min(n, maxX));
    this.scatterY = Math.max(1, Math.ceil(n / this.scatterX));

    const storage = GPUBufferUsage.STORAGE;
    // `?cullcheck` copies the uniform block, the records and the verdicts out.
    const read = (which: CullBuffer): number => readUsage(diagnostics, which);
    this.uniform = this.make(
      "uniform",
      CULL_UNIFORM_BYTES,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST | read("uniform"),
    );
    const clusters = this.upload("clusters", storage | read("records"), new Uint8Array(tables.clusters));
    const blocks = this.upload("blocks", storage, blockWords(tables.blocks));
    const spheres = this.upload("spheres", storage, tables.spheres);
    const bandOf = this.make("bands", n * 4, storage | read("bands"));
    const local = this.make("local", n * 16, storage);
    const sums = this.make("sums", (this.workgroups + 1) * 16, storage);
    const groups = this.upload("groups", storage, groupWords(tables.groups));
    // `?cullcopy`: the compute writes one buffer and the draws read a copy.
    const copied = diagnostics.copied;
    const copySrc = (which: CullCopied): number => (copied.has(which) ? GPUBufferUsage.COPY_SRC : 0);
    const args = this.make(
      "args",
      tables.groups.length * INDIRECT_BYTES,
      storage | GPUBufferUsage.INDIRECT | copySrc("args"),
    );
    this.args = copied.has("args") ? this.copyOf(args, GPUBufferUsage.INDIRECT) : args;
    const source = this.upload("source indices", storage, tables.indices);
    const written = this.make(
      "indices",
      tables.indices.byteLength,
      storage | GPUBufferUsage.INDEX | copySrc("indices"),
    );
    this.indices = copied.has("indices") ? this.copyOf(written, GPUBufferUsage.INDEX) : written;

    // The static half of the uniform block.
    const u = this.u32;
    const f = this.f32;
    f[28] = tables.bands2[0];
    f[29] = tables.bands2[1];
    f[30] = tables.bands2[2];
    u[32] = n;
    u[33] = tables.groups.length;
    u[34] = this.workgroups;

    this.check = diagnostics.report
      ? new CullCheck(
          device,
          pipelines,
          {
            label: "clusters",
            count: n,
            uniform: this.uniform,
            uniformBytes: CULL_UNIFORM_BYTES,
            bands: bandOf,
            probe: CLUSTER_PROBE_WGSL,
            data: clusters,
            dataBytes: new Uint8Array(tables.clusters),
            probeBind: [[0, this.uniform], [12, this.uniform], [1, clusters], [11, clusters], [2, blocks], [10, blocks], [3, spheres]],
            forms: CLUSTER_FORMS,
            ...clusterReplay(tables),
          },
          diagnostics.report,
        )
      : null;

    // Each entry point's own bindings: an "auto" layout holds only what its
    // entry point reads, so each pass binds exactly those.
    const entries: { entry: string; bind: readonly [number, GPUBuffer][] }[] = [
      {
        entry: "cullClusters",
        bind: [[0, this.uniform], [1, clusters], [2, blocks], [3, spheres], [4, bandOf], [5, local], [6, sums]],
      },
      { entry: "prefix", bind: [[0, this.uniform], [5, local], [6, sums], [7, groups], [8, args]] },
      {
        entry: "scatter",
        bind: [[0, this.uniform], [1, clusters], [4, bandOf], [5, local], [6, sums], [7, groups], [9, source], [10, written]],
      },
    ];
    this.ready = Promise.all(
      entries.map(({ entry, bind }) =>
        pipelines
          .compute("cluster cull", CLUSTER_CULL_WGSL, entry)
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
        if (this.disposed) return false;
        this.passes.push(...passes);
        this.built = true;
        return true;
      },
      (err: unknown) => {
        // A cull disposed with its map has no blocks left to give back.
        if (!this.disposed) {
          console.error("cluster cull: a pipeline did not build; the blocks go back to Babylon", err);
        }
        return false;
      },
    );
  }

  /**
   * Culls this frame's clusters against `frame` (its view-projection, its
   * eye and its wind) and the reach and size gate, recording the work into
   * `encoder` — the host's, submitted ahead of the frame's draws. Called once
   * a frame as the main pass begins (`Renderer.onFrame`).
   */
  dispatch(frame: FrameUniforms, encoder: GPUCommandEncoder): void {
    if (!this.built || this.clusterCount === 0) return;
    if (this.once && this.dispatched) return;
    this.dispatched = true;
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

    if (this.split !== "none") {
      this.dispatchSplit(encoder);
    } else {
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
      pass.dispatchWorkgroups(this.scatterX, this.scatterY);
      pass.end();
    }
    const copies = this.copies;
    for (let i = 0; i < copies.length; i++) {
      encoder.copyBufferToBuffer(copies[i].from, 0, copies[i].to, 0, copies[i].to.size);
    }
    this.check?.record(encoder, this.bytes);
  }

  /**
   * `?cullsplit`: the three dispatches each in a pass of its own in
   * `encoder`, or (`submits`) each in an encoder of its own, submitted here —
   * the one place a cull submits, and only for the diagnostic. Allocates a
   * pass (and an encoder) a dispatch, which is the diagnostic's cost.
   */
  private dispatchSplit(encoder: GPUCommandEncoder): void {
    const sizes: readonly [number, number][] = [[this.workgroups, 1], [1, 1], [this.scatterX, this.scatterY]];
    for (let k = 0; k < 3; k++) {
      const own = this.split === "submits" ? this.device.createCommandEncoder({ label: "cluster cull: split" }) : encoder;
      const pass = own.beginComputePass(PASS);
      pass.setPipeline(this.passes[k].pipeline);
      pass.setBindGroup(0, this.passes[k].group);
      pass.dispatchWorkgroups(sizes[k][0], sizes[k][1]);
      pass.end();
      if (own !== encoder) this.device.queue.submit([own.finish()]);
    }
  }

  dispose(): void {
    this.check?.dispose();
    for (const b of this.buffers) b.destroy();
    this.buffers.length = 0;
    this.passes.length = 0;
    this.built = false;
    this.disposed = true;
  }

  /** `?cullcopy`: a buffer the draws read in place of `from`, copied from it every frame. */
  private copyOf(from: GPUBuffer, usage: number): GPUBuffer {
    const to = this.make(`${from.label.replace("cluster cull: ", "")} copy`, from.size, usage | GPUBufferUsage.COPY_DST);
    this.copies.push({ from, to });
    return to;
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
export function writePlanes(m: Float32Array, out: Float32Array): void {
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
export function rampReach(frame: FrameUniforms): number {
  return 1.5 * Math.abs(frame.windParams[0]);
}

/**
 * The most a RIGGED vertex moves this frame, metres, over both layers: its
 * lean downwind and across (`down`, `across`), its flap (`rig.y`, partials
 * summing to 1.35) and its leaf or pinna (`rig.w`, up to 1 vertically and
 * half that downwind) — each with the bend, edge and pressure factors at
 * their bound of 1 (`celVertex`'s rig).
 */
export function rigReach(frame: FrameUniforms): number {
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

/**
 * `?cullcheck`'s CPU replay of `wgsl/clusterCull.ts`'s `visible` over
 * `tables`, and its one-line account of a cluster.
 */
function clusterReplay(
  tables: CullTables,
): Pick<CullCheckSpec, "positionWords" | "expect" | "planes" | "replay" | "describe"> {
  const cf = new Float32Array(tables.clusters);
  const cu = new Uint32Array(tables.clusters);
  const sp = tables.spheres;
  const grow = (f: Float32Array, o: number): number =>
    cf[o + 12] * f[27] + (cu[o + 13] !== 0 ? f[31] : 0) + 0.05;
  /** Plane k's value at the cluster's far corner. */
  const plane = (f: Float32Array, o: number, k: number): number => {
    let v = f[k * 4 + 3];
    for (let a = 0; a < 3; a++) v += f[k * 4 + a] * (f[k * 4 + a] > 0 ? cf[o + 4 + a] : cf[o + a]);
    return v;
  };
  const boxDist2 = (f: Float32Array, b: BlockBox): number => {
    const dx = Math.max(b.minX - f[20], 0, f[20] - b.maxX);
    const dy = Math.max(b.minY - f[21], 0, f[21] - b.maxY);
    const dz = Math.max(b.minZ - f[22], 0, f[22] - b.maxZ);
    return dx * dx + dy * dy + dz * dz;
  };
  const sphere = (f: Float32Array, s: number): { d2: number; w2: number } => {
    const dx = sp[s * 4] - f[20];
    const dy = sp[s * 4 + 1] - f[21];
    const dz = sp[s * 4 + 2] - f[22];
    const w = 2 * sp[s * 4 + 3] * f[24];
    return { d2: dx * dx + dy * dy + dz * dz, w2: w * w };
  };
  return {
    positionWords: 6,
    expect: (i, out) => {
      const o = i * CLUSTER_WORDS;
      for (let a = 0; a < 3; a++) {
        out[a] = cu[o + a];
        out[3 + a] = cu[o + 4 + a];
      }
    },
    planes: (f, i, out) => {
      const o = i * CLUSTER_WORDS;
      for (let k = 0; k < 5; k++) out[k] = plane(f, o, k);
      out[5] = grow(f, o);
    },
    replay: (f, u, i, near) => {
      const o = i * CLUSTER_WORDS;
      const d2b = boxDist2(f, tables.blocks[cu[o + 9]]);
      near[0] = closeness(d2b, f[23]);
      if (d2b > f[23]) return 1;
      if (u[26] !== 0) {
        const { d2, w2 } = sphere(f, cu[o + 10]);
        if (d2 > 1) {
          near[0] = Math.min(near[0], closeness(w2, f[25] * d2));
          if (w2 < f[25] * d2) return 2;
        }
      }
      const g = grow(f, o);
      for (let k = 0; k < 5; k++) {
        const v = plane(f, o, k);
        near[0] = Math.min(near[0], closeness(v, -g));
        if (v < -g) return 3 + k;
      }
      return 0;
    },
    describe: (f, u, i) => {
      const o = i * CLUSTER_WORDS;
      const { d2, w2 } = sphere(f, cu[o + 10]);
      const planes = [0, 1, 2, 3, 4].map((k) => plane(f, o, k).toFixed(2)).join(" ");
      return (
        `block ${cu[o + 9]} surface ${cu[o + 10]} box [${[0, 1, 2].map((a) => cf[o + a].toFixed(1))}]..[${[4, 5, 6].map((a) => cf[o + a].toFixed(1))}]` +
        ` · to block ${Math.sqrt(boxDist2(f, tables.blocks[cu[o + 9]])).toFixed(1)} m · gate ${u[26] ? (Math.sqrt(w2 / Math.max(d2, 1))).toFixed(1) : "-"} px` +
        ` · planes at far corner ${planes} vs -${grow(f, o).toFixed(2)}`
      );
    },
  };
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
