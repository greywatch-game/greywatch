/**
 * render/ClusterCull.ts — The static world's clusters culled on the GPU,
 * writing each group's surviving indices at the front of its range and zeros
 * after them (`BABYLON_EXIT.md` X3.3b; the WGSL is `wgsl/clusterCull.ts`) —
 * once a frame for the main pass — whose survivors the glow's mask draws
 * the emissive palette from too (X3.6d) — once a drawn map for each shadow
 * map (X3.6a) and once a face for a reflection probe's bake (X3.6c), each a
 * VIEW of one map's tables.
 * Owns: `ClusterCull` — one view: its three compute passes' bind groups
 * (their pipelines are the renderer's `PipelineCache`'s, shared by every
 * map), its uniform block (`CullUniform`), the scan's buffers, each group's
 * record, and the index buffer its draws index (`indices`, cleared and
 * written every dispatch) — and, for the view that uploaded them, the
 * cluster, block, sphere and source tables every view of the map reads;
 * `CullInputs`, what a view is culled for, and `frameInputs`, the main
 * pass's; `writeInputs`, the uniform block's per-dispatch half as both culls
 * lay it out; `ReachGate`, what whoever decides the reach and the size gate
 * hands it; `rangeWords`, the range record as both culls upload it
 * (`InstanceCull`'s too).
 * Invariants: every table is uploaded once, when the map is cut, and never
 * re-cut, by the map's first view, which every other view of it reads and
 * outlives; a dispatch's inputs are numbers only — a view-projection, an
 * eye, the reach and the size gate, the most the wind moves a vertex, a
 * pass mask and a probe view's two tests (`CullInputs`) — so the cull never
 * reads a node; the size gate never drops a `LIGHT_SOURCE` cluster (the
 * emissive palette's, glowing or `noGlow`, X3.7b), as the frame's mesh walk
 * never gates an emissive; the frustum is
 * the view-projection's four side planes and the eye's own plane, normalised
 * here, and a cluster is dropped only when it is not in the view's pass, or
 * its box lies wholly outside one plane, so it drops nothing the frustum did
 * not already hide; the reach is measured to the box each surface was handed
 * (`BlockBox`), which for the landform is one the reach is never short of —
 * or, in a probe's view, to the near side of the surface's own sphere, as
 * Babylon's bake measured a mesh, and a probe's view leaves out the blocks
 * the probe serves (`ReflectionSystem`'s `exclusionOf`);
 * the work is RECORDED into the encoder the host submits ahead of the
 * frame's draws (`FrameHost.prepareEncoder`), so it reaches the GPU before
 * the draws that read it and inside the frame's GPU timer — the main pass's
 * view once a submit, as the main pass begins, because its inputs are a
 * `writeBuffer` the whole submit reads (`FramePrepare`), and another view
 * once a SLOT a submit, each dispatch's inputs copied into its block in the
 * encoder ahead of its own pass (`CullUniform`); a view's `indices` are
 * CLEARED ahead of each dispatch's scatter, so whatever its survivors do not
 * fill is index 0 three times over — a triangle of no area, which the plain
 * draw over a group's whole range (`WorldBlocks`, `WorldDepth`) hands the
 * GPU to discard — and nothing of the static world is drawn or dispatched
 * INDIRECT, the blocks here nor the scatter (`InstanceCull`, at a bound the
 * CPU computes): an Intel Xe-LPG dropped indirect draws, whatever wrote
 * their arguments — the blocks' (2026-10-18), then the scatter's, every tree
 * at once (2026-10-24, its A/B naming the draws and not `expand`'s indirect
 * dispatch, which is direct anyway to keep the rule one rule —
 * `docs/rendering.md`); until the pipelines are built (`ready`) nothing is
 * dispatched and `indices` stays the zeros it was made with, so a group
 * draws nothing rather than garbage.
 * Never: imports Babylon; reads a node; submits; allocates on a frame beyond
 * the compute pass WebGPU makes for every pass; sets anything after
 * `dispose`, however late its pipelines arrive.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 */
import { NO_PIECE } from "./clusters";
import { closeness, CullCheck, type CullCheckSpec, type CullReport } from "./CullCheck";
import type { FrameUniforms } from "./frame";
import type { PassTiming } from "./PassTimer";
import type { PipelineCache } from "./PipelineCache";
import {
  BLOCK_WORDS,
  CLUSTER_CULL_WGSL,
  CLUSTER_WORDS,
  CULL_UNIFORM_BYTES,
  LIGHT_SOURCE,
  RANGE_WORDS,
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
 * A cull's two diagnostics, both off the URL (`core/urlOverrides.ts`): which
 * tests run (`CullMode`, per view), and where `?cullcheck` reports its
 * readings (`CullCheck`) — null for no check.
 */
export interface CullDiagnostics {
  readonly mode: CullMode;
  readonly report: CullReport | null;
}

/** Every test, and no check: what a cull runs with but for a diagnostic. */
export const NO_DIAGNOSTICS: CullDiagnostics = { mode: "full", report: null };

/**
 * Opens the tests `mode` turns off in a cull's uniform block, after the frame
 * has written it — both culls lay the planes, the reach and the gate out
 * alike (`wgsl/clusterCull.ts`, `wgsl/instanceCull.ts`).
 */
function openTests(mode: CullMode, f: Float32Array, u: Uint32Array): void {
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

/**
 * A cluster's REACH box: its block's, as `WorldCulling` files a cell — or,
 * for the landform, one every point is inside, from minus to plus `F32_MAX`
 * (`WorldCulling.reachBoxOf`), so the reach never drops it. Finite always:
 * the cull's arithmetic assumes no infinity.
 */
export interface BlockBox {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

/** A RANGE of a cull's items `[start, end)`, and where its region of the output starts (`base`, the WGSL's `outBase`). */
export interface ScanRange {
  readonly start: number;
  readonly end: number;
  readonly base: number;
}

/** What a map's cut hands the cull — every array in the order it is drawn. */
export interface CullTables {
  /** `CLUSTER_WORDS` a cluster, laid out as the WGSL's `Cluster`. */
  readonly clusters: ArrayBuffer;
  readonly clusterCount: number;
  readonly blocks: readonly BlockBox[];
  /** Each surface's bounding sphere, four floats: centre, radius. */
  readonly spheres: Float32Array;
  /** Each group's range: its first cluster, end, and where its indices start. */
  readonly groups: readonly ScanRange[];
  /** Every group's indices, rebased onto its arrays (past its instanced parts), in group order. */
  readonly indices: Uint32Array;
  /** The square of each near-first band's end, metres (three). */
  readonly bands2: readonly number[];
}

/**
 * What ONE cull reads for the view it culls for — the main pass's camera, or
 * a shadow map's light: numbers only, so no cull reads a node. Filled in
 * place by whoever owns the view and handed to `dispatch` (`frameInputs` is
 * the main pass's).
 */
export interface CullInputs {
  /** The view-projection, 16 floats as WGSL's `mat4x4f` reads them: the frustum's planes. */
  readonly viewProjection: Float32Array;
  /** Where distances are measured from: the reach, the size gate and the near-first bands. */
  readonly eye: Float32Array;
  /** The reach squared, metres; `F32_MAX` is no reach. */
  reach2: number;
  /** Whether the size gate applies, and its two numbers (`ReachGate`). */
  sizeGate: boolean;
  perRad: number;
  px2: number;
  /** The most a ramp weight of 1, and a rigged vertex, moves this frame: 0 for a pass that draws no sway. */
  rampReach: number;
  rigReach: number;
  /** The passes a cluster must be drawn in to be kept (`PASS_CASTS`, `PASS_SOLID`, `PASS_PROBE`); 0 keeps every one. */
  mask: number;
  /**
   * A probe view's tests (`PROBE_SPHERE_REACH`, `PROBE_EXCLUDE`) and, from bit
   * 8, its cell's side in blocks; the cell (`blockKey`); and which blocks of
   * the cell it leaves out, a bit each, row by row. 0 for every other view.
   */
  probe: number;
  probeCell: number;
  probeServed: number;
}

/** A `CullInputs` with no reach, no gate, no sway and no mask: what a view fills in place. */
export function createCullInputs(): CullInputs {
  return {
    viewProjection: new Float32Array(16),
    eye: new Float32Array(3),
    reach2: F32_MAX,
    sizeGate: false,
    perRad: 0,
    px2: 0,
    rampReach: 0,
    rigReach: 0,
    mask: 0,
    probe: 0,
    probeCell: 0,
    probeServed: 0,
  };
}

/** The MAIN pass's inputs: the frame's camera and wind, and the reach and size gate as `gate` holds them. */
export function frameInputs(frame: FrameUniforms, gate: ReachGate, out: CullInputs): void {
  out.viewProjection.set(frame.viewProjection);
  out.eye.set(frame.camPos);
  out.reach2 = Math.min(F32_MAX, gate.reach * gate.reach);
  out.sizeGate = gate.sizeGate;
  out.perRad = gate.perRad;
  out.px2 = gate.px2;
  out.rampReach = rampReach(frame);
  out.rigReach = rigReach(frame);
  out.mask = 0;
  out.probe = 0;
  out.probeCell = 0;
  out.probeServed = 0;
}

/**
 * `inputs` into a cull's uniform block — `CULL_DECLARATIONS`' words 0 to 7
 * and 9; word 8 is each cull's own — then the tests `mode` turns off opened.
 * Both culls lay the block out alike.
 */
export function writeInputs(inputs: CullInputs, mode: CullMode, f: Float32Array, u: Uint32Array): void {
  writePlanes(inputs.viewProjection, f);
  f[20] = inputs.eye[0];
  f[21] = inputs.eye[1];
  f[22] = inputs.eye[2];
  f[23] = inputs.reach2;
  f[24] = inputs.perRad;
  f[25] = inputs.px2;
  u[26] = inputs.sizeGate ? 1 : 0;
  f[27] = inputs.rampReach;
  f[31] = inputs.rigReach;
  u[36] = inputs.mask;
  u[37] = inputs.probe;
  u[38] = inputs.probeCell;
  u[39] = inputs.probeServed;
  openTests(mode, f, u);
}

/**
 * How one VIEW of a map's cull is made: what it is called, and how many
 * times it is dispatched in one submit (`slots`), each with inputs of its
 * own.
 */
export interface CullView {
  readonly label: string;
  readonly slots: number;
}

/** A staging slot's stride: past either cull's block. */
const UNIFORM_SLOT = 256;

/**
 * A cull's uniform block, written once per dispatch (`CullView.slots`). A
 * `writeBuffer` lands ahead of the whole submit, so two dispatches through
 * one block written that way would both read the second's inputs: with one
 * slot the block is written in place, and with more each dispatch's inputs
 * go to a staging slot of their own and are COPIED into the block in the
 * encoder, in order, ahead of the pass that reads them.
 */
export class CullUniform {
  /** What the cull's passes bind. */
  readonly buffer: GPUBuffer;
  private readonly staging: GPUBuffer | null;

  constructor(
    private readonly device: GPUDevice,
    label: string,
    private readonly bytes: number,
    slots: number,
    /** Usage beyond a uniform's: `?cullcheck` copies the block out. */
    usage: number,
  ) {
    this.buffer = device.createBuffer({
      label: `${label}: uniform`,
      size: bytes,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST | usage,
    });
    this.staging =
      slots > 1
        ? device.createBuffer({
            label: `${label}: uniform slots`,
            size: slots * UNIFORM_SLOT,
            usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
          })
        : null;
  }

  /** `data` as the block the next pass recorded into `encoder` reads, as dispatch `slot` of this submit. */
  write(data: ArrayBuffer, encoder: GPUCommandEncoder, slot: number): void {
    if (!this.staging) {
      this.device.queue.writeBuffer(this.buffer, 0, data);
      return;
    }
    this.device.queue.writeBuffer(this.staging, slot * UNIFORM_SLOT, data);
    encoder.copyBufferToBuffer(this.staging, slot * UNIFORM_SLOT, this.buffer, 0, this.bytes);
  }

  destroy(): void {
    this.buffer.destroy();
    this.staging?.destroy();
  }
}

/** A map's cluster tables as uploaded once, which every view of its cull reads. */
interface ClusterTableBuffers {
  readonly clusters: GPUBuffer;
  readonly clusterCount: number;
  readonly blocks: GPUBuffer;
  readonly spheres: GPUBuffer;
  readonly source: GPUBuffer;
  /** Each group's range, as `rangeWords` lays it out: every view uploads its own, which its scan writes. */
  readonly ranges: Uint32Array;
  readonly groupCount: number;
  readonly indexBytes: number;
  readonly bands2: readonly number[];
  readonly buffers: readonly GPUBuffer[];
}

/** The descriptor a frame's pass is begun with, made once. */
const PASS: GPUComputePassDescriptor = { label: "cluster cull" };

/** Near the largest `f32`, and short of infinity — a shader may assume there is none. */
export const F32_MAX = 3.0e38;

export class ClusterCull {
  /** What the draws index: each group's surviving clusters, near-first, then zeros. */
  readonly indices: GPUBuffer;
  /** Resolves true once the three pipelines are built; false if one failed. */
  readonly ready: Promise<boolean>;
  private built = false;
  /** Set by `dispose`: pipelines that arrive after it are dropped. */
  private disposed = false;

  /** The map's tables: the view that uploaded them owns them, and every view reads them. */
  private readonly tables: ClusterTableBuffers;
  private readonly ownsTables: boolean;
  /** This view's own buffers. */
  private readonly buffers: GPUBuffer[] = [];
  private readonly uniform: CullUniform;
  private readonly bytes = new ArrayBuffer(CULL_UNIFORM_BYTES);
  private readonly f32 = new Float32Array(this.bytes);
  private readonly u32 = new Uint32Array(this.bytes);
  private readonly clusterCount: number;
  private readonly workgroups: number;
  private readonly scatterX: number;
  private readonly scatterY: number;
  /** The three passes in dispatch order: cull, prefix, scatter. */
  private readonly passes: { pipeline: GPUComputePipeline; group: GPUBindGroup }[] = [];
  /** The view's name, which every buffer it makes is labelled with — the tables the first view's. */
  private readonly viewLabel: string;
  /** Which tests run — `CullMode`; "full" but for a diagnostic. */
  private readonly mode: CullMode;
  /** `?cullcheck`'s reader, or null. */
  private readonly check: CullCheck | null;

  /**
   * The cull of a map's `tables`, which it uploads — or, handed another
   * `ClusterCull`, a second VIEW of that one's tables, which uploads none,
   * writes indices of its own and must be disposed no later than the cull it
   * reads (`WorldDepth`'s, for the shadow maps). Only the first view takes
   * `?cullcheck`'s report.
   */
  constructor(
    private readonly device: GPUDevice,
    pipelines: PipelineCache,
    source: CullTables | ClusterCull,
    /** With the clusters it culls: the first `count`, so a view may leave out a tail no pass of it draws. */
    view: CullView & { readonly count: number },
    diagnostics: CullDiagnostics = NO_DIAGNOSTICS,
  ) {
    this.mode = diagnostics.mode;
    this.viewLabel = view.label;
    const n = view.count;
    this.clusterCount = n;
    this.workgroups = Math.max(1, Math.ceil(n / SCAN_SIZE));
    const maxX = device.limits.maxComputeWorkgroupsPerDimension;
    this.scatterX = Math.max(1, Math.min(n, maxX));
    this.scatterY = Math.max(1, Math.ceil(n / this.scatterX));

    const storage = GPUBufferUsage.STORAGE;
    const shared = source instanceof ClusterCull;
    const report = shared ? null : diagnostics.report;
    // `?cullcheck` copies the uniform block and the verdicts out.
    const read = report ? GPUBufferUsage.COPY_SRC : 0;
    this.ownsTables = !shared;
    this.tables = shared ? source.tables : this.uploadTables(source, read);
    const t = this.tables;
    if (n > t.clusterCount) throw new Error(`cluster cull: ${view.label} culls past its ${t.clusterCount} clusters`);
    this.uniform = new CullUniform(device, `cluster cull: ${view.label}`, CULL_UNIFORM_BYTES, view.slots, read);
    const bandOf = this.make("bands", n * 4, storage | read);
    const local = this.make("local", n * 16, storage);
    const sums = this.make("sums", (this.workgroups + 1) * 16, storage);
    const groups = this.upload("groups", storage, t.ranges);
    // COPY_DST for the clear ahead of each frame's scatter.
    this.indices = this.make("indices", t.indexBytes, storage | GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST);

    // The static half of the uniform block.
    const u = this.u32;
    const f = this.f32;
    f[28] = t.bands2[0];
    f[29] = t.bands2[1];
    f[30] = t.bands2[2];
    u[32] = n;
    u[33] = t.groupCount;
    u[34] = this.workgroups;

    const uniform = this.uniform.buffer;
    this.check =
      report && !shared
        ? new CullCheck(
            device,
            pipelines,
            {
              label: "clusters",
              count: n,
              uniform,
              uniformBytes: CULL_UNIFORM_BYTES,
              bands: bandOf,
              probe: CLUSTER_PROBE_WGSL,
              data: t.clusters,
              dataBytes: new Uint8Array(source.clusters),
              probeBind: [[0, uniform], [12, uniform], [1, t.clusters], [11, t.clusters], [2, t.blocks], [10, t.blocks], [3, t.spheres]],
              forms: CLUSTER_FORMS,
              ...clusterReplay(source),
            },
            report,
          )
        : null;

    // Each entry point's own bindings: an "auto" layout holds only what its
    // entry point reads, so each pass binds exactly those.
    const entries: { entry: string; bind: readonly [number, GPUBuffer][] }[] = [
      {
        entry: "cullClusters",
        bind: [[0, uniform], [1, t.clusters], [2, t.blocks], [3, t.spheres], [4, bandOf], [5, local], [6, sums]],
      },
      { entry: "prefix", bind: [[0, uniform], [5, local], [6, sums], [7, groups]] },
      {
        entry: "scatter",
        bind: [[0, uniform], [1, t.clusters], [4, bandOf], [5, local], [6, sums], [7, groups], [9, t.source], [10, this.indices]],
      },
    ];
    this.ready = Promise.all(
      entries.map(({ entry, bind }) =>
        pipelines
          .compute("cluster cull", CLUSTER_CULL_WGSL, entry)
          .then((pipeline) => ({
            pipeline,
            group: device.createBindGroup({
              label: `cluster cull: ${view.label}: ${entry}`,
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
        // A cull disposed with its map has nothing left to give back.
        if (!this.disposed) console.error(`cluster cull: a pipeline did not build for ${view.label}`, err);
        return false;
      },
    );
  }

  /**
   * Culls the clusters for `inputs` — the view's camera or light, reach,
   * size gate, sway and pass mask — recording the work into `encoder`, the
   * host's, submitted ahead of the frame's draws: once a frame as the main
   * pass begins for the main pass's view (`Renderer.onFrame`), and up to
   * `slots` times a submit for another, each at its own `slot`, so a draw
   * reading `indices` reads the dispatch recorded last before it. Its one
   * pass is timed when `timing` is handed (`gpu.cull`), the index clear
   * ahead of it not.
   */
  dispatch(inputs: CullInputs, encoder: GPUCommandEncoder, timing: PassTiming | null = null, slot = 0): void {
    if (!this.built || this.clusterCount === 0) return;
    writeInputs(inputs, this.mode, this.f32, this.u32);
    this.uniform.write(this.bytes, encoder, slot);

    // What the survivors do not fill is a triangle of no area.
    encoder.clearBuffer(this.indices);
    const pass = encoder.beginComputePass(timing ? timing.pass(PASS) : PASS);
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
  private uploadTables(tables: CullTables, read: number): ClusterTableBuffers {
    const storage = GPUBufferUsage.STORAGE;
    const buffers: GPUBuffer[] = [];
    const up = (label: string, usage: number, data: Uint8Array | Uint32Array | Float32Array): GPUBuffer => {
      const b = this.upload(label, usage, data);
      // Not this view's own: `dispose` destroys the tables apart.
      this.buffers.pop();
      buffers.push(b);
      return b;
    };
    return {
      clusters: up("clusters", storage | read, new Uint8Array(tables.clusters)),
      clusterCount: tables.clusterCount,
      blocks: up("blocks", storage, blockWords(tables.blocks)),
      spheres: up("spheres", storage, tables.spheres),
      source: up("source indices", storage, tables.indices),
      ranges: rangeWords(tables.groups),
      groupCount: tables.groups.length,
      indexBytes: tables.indices.byteLength,
      bands2: tables.bands2,
      buffers,
    };
  }

  private make(label: string, size: number, usage: number): GPUBuffer {
    const buffer = this.device.createBuffer({
      label: `cluster cull: ${this.viewLabel}: ${label}`,
      size: Math.max(16, Math.ceil(size / 4) * 4),
      usage,
    });
    this.buffers.push(buffer);
    return buffer;
  }

  private upload(label: string, usage: number, data: Uint8Array | Uint32Array | Float32Array): GPUBuffer {
    const buffer = this.device.createBuffer({
      label: `cluster cull: ${this.viewLabel}: ${label}`,
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
      // A light source is never size-gated (`LIGHT_SOURCE`, `visible`).
      if (u[26] !== 0 && (cu[o + 14] & LIGHT_SOURCE) === 0) {
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
      const box = tables.blocks[cu[o + 9]];
      // The landform's box, which no reach is short of (`WorldCulling.reachBoxOf`).
      const reach = box.maxX >= F32_MAX ? "no reach" : `to block ${Math.sqrt(boxDist2(f, box)).toFixed(1)} m`;
      const piece = cu[o + 11] === NO_PIECE ? "no piece" : `piece ${cu[o + 11]}`;
      return (
        `block ${cu[o + 9]} surface ${cu[o + 10]} ${piece} box [${[0, 1, 2].map((a) => cf[o + a].toFixed(1))}]..[${[4, 5, 6].map((a) => cf[o + a].toFixed(1))}]` +
        ` · ${reach} · gate ${u[26] ? (Math.sqrt(w2 / Math.max(d2, 1))).toFixed(1) : "-"} px` +
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

/** A cull's ranges as `SCAN_DECLARATIONS`' `Range` — both culls' — the scan's half zero. */
export function rangeWords(ranges: readonly ScanRange[]): Uint32Array {
  const out = new Uint32Array(Math.max(1, ranges.length) * RANGE_WORDS);
  ranges.forEach((g, i) => {
    const o = i * RANGE_WORDS;
    out[o] = g.start;
    out[o + 1] = g.end;
    out[o + 2] = g.base;
  });
  return out;
}
