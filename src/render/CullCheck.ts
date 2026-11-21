/**
 * render/CullCheck.ts — `?cullcheck`: a cull's verdicts read back off the
 * GPU and replayed on the CPU against the very uniform block the GPU read, for
 * a device nobody here owns — the phone that drops Kurenai's structures by
 * heading, which no desktop reproduces (`core/urlOverrides.ts`).
 * Owns: `CullCheck` — the probe's pipeline and bind group, its mask and echo
 * buffers, their MAP_READ copies, the throttle and the one readback in
 * flight; `CullReport`, what it hands its lines to.
 * Invariants: recorded into the cull's own encoder right after the cull's
 * pass, so the uniform it copies and the verdicts it reads are that frame's;
 * mapped only a task later, after the frame's submit, and never while a
 * submit could still use one of its copies — at most one readback in flight;
 * the PROBE re-runs the test with its inputs read in each of the forms it
 * names (`wgsl/cullProbe.ts`) on the GPU, one bit a form, and ECHOES what it
 * read, so one reading on the device says which of three things differs from
 * the CPU — the bytes the GPU holds (the record table copied back), the
 * numbers the shader reads out of them (the echo), or what it computes from
 * the right numbers (the echoed plane values); the CPU replay is the WGSL
 * test transcribed, a disagreement within float error of its threshold
 * counted apart as marginal; the first line of each block is a SUMMARY short
 * enough to read down a phone call.
 * Never: imports Babylon; changes a verdict; exists without the flag; writes
 * markup — `ui/CullCheckPanel.ts` shows what it reports.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 */
import type { PipelineCache } from "./PipelineCache";
import { ECHO_WORDS, PROBE_SIZE, UNIFORM_ECHO_WORDS } from "./wgsl/cullProbe";

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
  /** The record table as uploaded, and the bytes the CPU uploaded into it. */
  readonly data: GPUBuffer;
  readonly dataBytes: Uint8Array;
  /** The probe's WGSL, and what it binds besides its outputs (bindings 13..15). */
  readonly probe: string;
  readonly probeBind: readonly (readonly [number, GPUBuffer])[];
  /** Each probe bit's form, bit 0 first. */
  readonly forms: readonly string[];
  /** How many words of an item's position the echo carries a read (`wgsl/cullProbe.ts`). */
  readonly positionWords: number;
  /** The position words the CPU uploaded for item `i`, into `out`. */
  readonly expect: (i: number, out: Uint32Array) => void;
  /** The CPU's five plane values for item `i` and its growth (`out[5]`). */
  readonly planes: (f: Float32Array, i: number, out: Float64Array) => void;
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

/** A count of items, and the first and last of them. */
class Tally {
  n = 0;
  first = -1;
  last = -1;
  add(i: number): void {
    if (this.n++ === 0) this.first = i;
    this.last = i;
  }
  toString(): string {
    return this.n === 0 ? "0" : `${this.n} (#${this.first}..#${this.last})`;
  }
}

export class CullCheck {
  private pipeline: GPUComputePipeline | null = null;
  private group: GPUBindGroup | null = null;
  private readonly mask: GPUBuffer;
  private readonly echo: GPUBuffer;
  private readonly uniformEcho: GPUBuffer;
  private readonly reads: readonly GPUBuffer[];
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
    const out = (what: string, size: number): GPUBuffer =>
      device.createBuffer({
        label: `cull check: ${spec.label} ${what}`,
        size,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });
    this.mask = out("probe", n * 4);
    this.echo = out("echo", n * ECHO_WORDS * 4);
    this.uniformEcho = out("uniform echo", UNIFORM_ECHO_WORDS * 4);
    const read = (what: string, size: number): GPUBuffer =>
      device.createBuffer({
        label: `cull check: ${spec.label} ${what} read`,
        size,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
    // In `compare`'s order, each beside what it copies.
    this.reads = [
      read("uniform", spec.uniformBytes),
      read("bands", n * 4),
      read("probe", n * 4),
      read("echo", n * ECHO_WORDS * 4),
      read("uniform echo", UNIFORM_ECHO_WORDS * 4),
      read("records", spec.data.size),
    ];
    this.written = new Uint8Array(spec.uniformBytes);
    pipelines.compute(`cull check: ${spec.label}`, spec.probe, "probe").then(
      (pipeline) => {
        if (this.disposed) return;
        this.pipeline = pipeline;
        const outputs = [[13, this.uniformEcho], [14, this.echo], [15, this.mask]] as const;
        this.group = device.createBindGroup({
          label: `cull check: ${spec.label}`,
          layout: pipeline.getBindGroupLayout(0),
          entries: [...spec.probeBind, ...outputs].map(([binding, buffer]) => ({ binding, resource: { buffer } })),
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
    const [uniform, bands, mask, echo, uniformEcho, data] = this.reads;
    const n = this.spec.count * 4;
    encoder.copyBufferToBuffer(this.spec.uniform, 0, uniform, 0, this.spec.uniformBytes);
    encoder.copyBufferToBuffer(this.spec.bands, 0, bands, 0, n);
    encoder.copyBufferToBuffer(this.mask, 0, mask, 0, n);
    encoder.copyBufferToBuffer(this.echo, 0, echo, 0, n * ECHO_WORDS);
    encoder.copyBufferToBuffer(this.uniformEcho, 0, uniformEcho, 0, UNIFORM_ECHO_WORDS * 4);
    encoder.copyBufferToBuffer(this.spec.data, 0, data, 0, this.spec.data.size);
    this.written.set(new Uint8Array(written));
    // A task later the frame has been submitted, so mapping cannot catch a
    // copy still waiting in an unsubmitted encoder.
    setTimeout(this.read, 0);
  }

  dispose(): void {
    this.disposed = true;
    this.pipeline = null;
    this.group = null;
    for (const b of [this.mask, this.echo, this.uniformEcho, ...this.reads]) b.destroy();
  }

  private readonly read = (): void => {
    const bufs = this.reads;
    Promise.all(bufs.map((b) => b.mapAsync(GPUMapMode.READ)))
      .then(() => {
        if (this.disposed) return;
        const [uniform, bands, mask, echo, uniformEcho, data] = bufs.map((b) => b.getMappedRange().slice(0));
        this.compare(uniform, new Uint32Array(bands), new Uint32Array(mask), echo, new Uint32Array(uniformEcho), data);
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

  private compare(
    uniform: ArrayBuffer,
    bands: Uint32Array,
    mask: Uint32Array,
    echoBytes: ArrayBuffer,
    uniformEcho: Uint32Array,
    data: ArrayBuffer,
  ): void {
    const { spec } = this;
    const f = new Float32Array(uniform);
    const u = new Uint32Array(uniform);
    const echoU = new Uint32Array(echoBytes);
    const echoF = new Float32Array(echoBytes);
    const near = new Float64Array(1);
    const cpuPlanes = new Float64Array(6);
    const R = spec.positionWords;
    const want = new Uint32Array(R);
    const reasons = new Array<number>(REASONS.length).fill(0);
    const formWrong = new Array<number>(spec.forms.length).fill(0);
    // Why the GPU dropped what the CPU keeps, by the probe's new/new form.
    const why = new Array<number>(REASONS.length).fill(0);
    const oldReads = new Tally();
    const newReads = new Tally();
    const values = new Tally();
    let worstValue = 0;
    let gpuKept = 0;
    let wrongDrop = 0;
    let wrongKeep = 0;
    let marginal = 0;
    let first = -1;
    for (let i = 0; i < spec.count; i++) {
      const reason = spec.replay(f, u, i, near);
      reasons[reason]++;
      const cpu = reason === 0;
      const o = i * ECHO_WORDS;
      spec.expect(i, want);
      let oldOk = true;
      let newOk = true;
      for (let w = 0; w < R; w++) {
        if (echoU[o + w] !== want[w]) oldOk = false;
        if (echoU[o + R + w] !== want[w]) newOk = false;
      }
      if (!oldOk) oldReads.add(i);
      if (!newOk) newReads.add(i);
      else {
        spec.planes(f, i, cpuPlanes);
        let off = 0;
        for (let k = 0; k < 6; k++) {
          const gpu = echoF[o + 2 * R + 1 + k];
          const cpuV = cpuPlanes[k];
          const e = Math.abs(gpu - cpuV) - 1e-4 * Math.abs(cpuV);
          if (!(e <= 0.02)) off = Math.max(off, Number.isFinite(e) ? e : Infinity);
        }
        if (off > 0) {
          values.add(i);
          worstValue = Math.max(worstValue, off);
        }
      }
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
        why[Math.min(echoU[o + 2 * R], REASONS.length - 1)]++;
        if (first < 0) first = i;
      }
    }

    // Every plane of a perspective frustum passes through the eye.
    let throughEye = 0;
    for (let k = 0; k < 5; k++) {
      const o = k * 4;
      throughEye = Math.max(throughEye, Math.abs(f[o] * f[20] + f[o + 1] * f[21] + f[o + 2] * f[22] + f[o + 3]));
    }
    const written = new Uint32Array(this.written.buffer);
    const writtenF = new Float32Array(this.written.buffer);
    let differs = -1;
    for (let w = 0; w < u.length && differs < 0; w++) if (written[w] !== u[w]) differs = w;
    /** How many of the uniform's words the shader read other than written, one way. */
    const uniformRead = (at: number): string => {
      const t = new Tally();
      for (let w = 0; w < 36; w++) if (uniformEcho[at + w] !== written[w]) t.add(w);
      return t.n === 0 ? "0" : `${t.n} (word ${t.first})`;
    };
    const records = new Uint8Array(data);
    const wrote = spec.dataBytes;
    const bytes = new Tally();
    for (let w = 0; w + 3 < wrote.length; w += 4) {
      if (
        records[w] !== wrote[w] || records[w + 1] !== wrote[w + 1] ||
        records[w + 2] !== wrote[w + 2] || records[w + 3] !== wrote[w + 3]
      ) {
        bytes.add(w >> 2);
      }
    }
    const whyText = REASONS.map((r, k) => (why[k] ? `${r} ${why[k]}` : "")).filter(Boolean).join(" ") || "-";

    const lines = [
      `SEND ${spec.label}: ${wrongDrop}/${wrongKeep} · forms ${formWrong.join(" ")} · why ${whyText} · reads ${oldReads.n} ${newReads.n} · values ${values.n} · uniform ${uniformRead(0)} ${uniformRead(36)} · data ${bytes.n}`,
      `${spec.label} ${spec.count}: gpu keeps ${gpuKept}, cpu ${reasons[0]} · gpu drops what cpu keeps ${wrongDrop} · gpu keeps what cpu drops ${wrongKeep} · marginal ${marginal}`,
      `  cpu drops: ${REASONS.slice(1).map((r, k) => `${r} ${reasons[k + 1]}`).join(" ")}`,
      `  probe wrong: ${spec.forms.map((form, b) => `${form} ${formWrong[b]}`).join(" · ")}`,
      `  shader reads off: old ${oldReads} · vec4 ${newReads} · values off ${values}${values.n ? ` by ${worstValue.toFixed(2)}` : ""} · table words off ${bytes}`,
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
