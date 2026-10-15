/**
 * render/CullCheck.ts — `?cullcheck`: a cull's verdicts read back off the
 * GPU and replayed on the CPU against the very uniform block the GPU read, for
 * a device nobody here owns — the phone that drops Kurenai's structures by
 * heading, which no desktop reproduces (`core/urlOverrides.ts`).
 * Owns: `CullCheck` — the probe's pipeline and bind group, its verdict
 * buffer, three MAP_READ copies, the throttle and the one readback in flight;
 * `CullReport`, what it hands its lines to.
 * Invariants: recorded into the cull's own encoder right after the cull's
 * pass, so the uniform it copies and the verdicts it reads are that frame's;
 * mapped only a task later, after the frame's submit, and never while a
 * submit could still use one of its copies — at most one readback in flight;
 * the PROBE re-runs the plane test in each of the forms it names
 * (`wgsl/cullProbe.ts`) on the GPU, one bit a form, so one reading on the
 * device says which form its compiler gets wrong; the CPU replay is the WGSL
 * test transcribed, a disagreement within float error of its threshold
 * counted apart as marginal.
 * Never: imports Babylon; changes a verdict; exists without the flag; writes
 * markup — `ui/CullCheckPanel.ts` shows what it reports.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 */
import type { PipelineCache } from "./PipelineCache";
import { PROBE_SIZE } from "./wgsl/cullProbe";

/** Where `?cullcheck` hands a cull's lines, under its label. */
export type CullReport = (label: string, lines: readonly string[]) => void;

/**
 * The CPU's verdict on item `i` under the uniform block `f`/`u`: 0 kept,
 * 1 past the reach, 2 under the size gate, 3 + k outside plane k. Writes into
 * `near[0]` how close the deciding quantity came to its threshold, relative:
 * the smallest over every test it ran.
 */
export type CullReplay = (f: Float32Array, u: Uint32Array, i: number, near: Float64Array) => number;

export interface CullCheckSpec {
  readonly label: string;
  readonly count: number;
  /** The cull's uniform block and its per-item band, `NONE` for dropped. */
  readonly uniform: GPUBuffer;
  readonly uniformBytes: number;
  readonly bands: GPUBuffer;
  /** The probe's WGSL, and what it binds besides its output (binding 15). */
  readonly probe: string;
  readonly probeBind: readonly (readonly [number, GPUBuffer])[];
  /** Each probe bit's form, bit 0 first. */
  readonly forms: readonly string[];
  readonly replay: CullReplay;
  /** One line on item `i`'s tests, for the first disagreement. */
  readonly describe: (f: Float32Array, u: Uint32Array, i: number) => string;
}

/** Dispatches between readings: about once a second at 60 fps. */
const EVERY = 60;
/** A disagreement this close to its threshold, relative, is float error. */
const MARGINAL = 1e-4;
const NONE = 0xffffffff;
const REASONS = ["kept", "reach", "gate", "left", "right", "bottom", "top", "eye"];

export class CullCheck {
  private pipeline: GPUComputePipeline | null = null;
  private group: GPUBindGroup | null = null;
  private readonly mask: GPUBuffer;
  private readonly readUniform: GPUBuffer;
  private readonly readBands: GPUBuffer;
  private readonly readMask: GPUBuffer;
  /** The uniform block as the CPU last wrote it, for the reading in flight. */
  private readonly written: Uint8Array;
  private tick = EVERY - 10;
  private busy = false;
  private disposed = false;
  private readonly x: number;
  private readonly y: number;

  constructor(
    device: GPUDevice,
    pipelines: PipelineCache,
    private readonly spec: CullCheckSpec,
    private readonly report: CullReport,
  ) {
    const n = Math.max(1, spec.count);
    const groups = Math.ceil(n / PROBE_SIZE);
    this.x = Math.min(groups, device.limits.maxComputeWorkgroupsPerDimension);
    this.y = Math.ceil(groups / this.x);
    this.mask = device.createBuffer({
      label: `cull check: ${spec.label} probe`,
      size: n * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const read = (what: string, size: number): GPUBuffer =>
      device.createBuffer({
        label: `cull check: ${spec.label} ${what}`,
        size,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
    this.readUniform = read("uniform", spec.uniformBytes);
    this.readBands = read("bands", n * 4);
    this.readMask = read("probe", n * 4);
    this.written = new Uint8Array(spec.uniformBytes);
    pipelines.compute(`cull check: ${spec.label}`, spec.probe, "probe").then(
      (pipeline) => {
        if (this.disposed) return;
        this.pipeline = pipeline;
        this.group = device.createBindGroup({
          label: `cull check: ${spec.label}`,
          layout: pipeline.getBindGroupLayout(0),
          entries: [...spec.probeBind, [15, this.mask] as const].map(([binding, buffer]) => ({
            binding,
            resource: { buffer },
          })),
        });
      },
      (err: unknown) => console.error(`cull check: the ${spec.label} probe did not build`, err),
    );
    this.report("gpu", [adapterLine(device)]);
  }

  /**
   * After the cull's pass in `encoder`, once every `EVERY` calls: the probe,
   * and the copies the reading compares. `written` is the uniform block as
   * the CPU wrote it this frame.
   */
  record(encoder: GPUCommandEncoder, written: ArrayBuffer): void {
    if (!this.pipeline || !this.group || this.busy || this.spec.count === 0) return;
    if (++this.tick < EVERY) return;
    this.tick = 0;
    this.busy = true;
    const pass = encoder.beginComputePass({ label: `cull check: ${this.spec.label}` });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.group);
    pass.dispatchWorkgroups(this.x, this.y);
    pass.end();
    const n = this.spec.count * 4;
    encoder.copyBufferToBuffer(this.spec.uniform, 0, this.readUniform, 0, this.spec.uniformBytes);
    encoder.copyBufferToBuffer(this.spec.bands, 0, this.readBands, 0, n);
    encoder.copyBufferToBuffer(this.mask, 0, this.readMask, 0, n);
    this.written.set(new Uint8Array(written));
    // A task later the frame has been submitted, so mapping cannot catch a
    // copy still waiting in an unsubmitted encoder.
    setTimeout(this.read, 0);
  }

  dispose(): void {
    this.disposed = true;
    this.pipeline = null;
    this.group = null;
    for (const b of [this.mask, this.readUniform, this.readBands, this.readMask]) b.destroy();
  }

  private readonly read = (): void => {
    const bufs = [this.readUniform, this.readBands, this.readMask];
    Promise.all(bufs.map((b) => b.mapAsync(GPUMapMode.READ)))
      .then(() => {
        if (this.disposed) return;
        this.compare(
          bufs[0].getMappedRange().slice(0),
          new Uint32Array(bufs[1].getMappedRange().slice(0)),
          new Uint32Array(bufs[2].getMappedRange().slice(0)),
        );
      })
      .catch((err: unknown) => {
        if (!this.disposed) console.warn(`cull check: ${this.spec.label} reading failed`, err);
      })
      .finally(() => {
        if (this.disposed) return;
        for (const b of bufs) if (b.mapState === "mapped") b.unmap();
        this.busy = false;
      });
  };

  private compare(uniform: ArrayBuffer, bands: Uint32Array, mask: Uint32Array): void {
    const { spec } = this;
    const f = new Float32Array(uniform);
    const u = new Uint32Array(uniform);
    const near = new Float64Array(1);
    const reasons = new Array<number>(REASONS.length).fill(0);
    const formWrong = new Array<number>(spec.forms.length).fill(0);
    let gpuKept = 0;
    let wrongDrop = 0;
    let wrongKeep = 0;
    let marginal = 0;
    let first = -1;
    for (let i = 0; i < spec.count; i++) {
      const reason = spec.replay(f, u, i, near);
      reasons[reason]++;
      const cpu = reason === 0;
      for (let b = 0; b < spec.forms.length; b++) {
        if (((mask[i] >>> b) & 1) === 1 !== cpu && near[0] >= MARGINAL) formWrong[b]++;
      }
      const gpu = bands[i] !== NONE;
      if (gpu) gpuKept++;
      if (gpu === cpu) continue;
      if (near[0] < MARGINAL) marginal++;
      else if (gpu) wrongKeep++;
      else {
        wrongDrop++;
        if (first < 0) first = i;
      }
    }

    // Every plane of a perspective frustum passes through the eye.
    let throughEye = 0;
    for (let k = 0; k < 5; k++) {
      const o = k * 4;
      throughEye = Math.max(throughEye, Math.abs(f[o] * f[20] + f[o + 1] * f[21] + f[o + 2] * f[22] + f[o + 3]));
    }
    const written = new Uint8Array(this.written.buffer);
    const read = new Uint8Array(uniform);
    let differs = -1;
    for (let w = 0; w < spec.uniformBytes && differs < 0; w++) if (written[w] !== read[w]) differs = w >> 2;
    const writtenF = new Float32Array(this.written.buffer);

    const lines = [
      `${spec.label} ${spec.count}: gpu keeps ${gpuKept}, cpu ${reasons[0]} · gpu drops what cpu keeps ${wrongDrop} · gpu keeps what cpu drops ${wrongKeep} · marginal ${marginal}`,
      `  cpu drops: ${REASONS.slice(1).map((r, k) => `${r} ${reasons[k + 1]}`).join(" ")}`,
      `  probe wrong: ${spec.forms.map((form, b) => `${form} ${formWrong[b]}`).join(" · ")}`,
      `  uniform ${differs < 0 ? "as written" : `word ${differs} wrote ${writtenF[differs]} read ${f[differs]}`} · planes off the eye ${throughEye.toFixed(3)} m · reach ${Math.sqrt(f[23]).toFixed(0)} m · gate ${u[26] ? `on, ${f[24].toFixed(0)} px/rad, ${Math.sqrt(f[25]).toFixed(1)} px` : "off"}`,
    ];
    if (first >= 0) lines.push(`  first: #${first} ${spec.describe(f, u, first)}`);
    this.report(spec.label, lines);
  }
}

/** The GPU as the device states it, as far as it will. */
function adapterLine(device: GPUDevice): string {
  const info = (device as { adapterInfo?: GPUAdapterInfo }).adapterInfo;
  if (!info) return "gpu: the device does not say";
  const parts = [info.vendor, info.architecture, info.device, info.description].filter((s) => s && s.length > 0);
  return `gpu: ${parts.join(" / ") || "unnamed"}`;
}

/** The relative distance of `a` from `b`. */
export function closeness(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-6);
}
