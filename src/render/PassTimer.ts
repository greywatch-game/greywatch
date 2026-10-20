/**
 * render/PassTimer.ts — The GPU time of our renderer's compute passes — the
 * culls the frame's prepares record (`FramePrepare`) — read back through
 * timestamp queries under `?gpu`, which a capture files as `gpu.cull`
 * (`docs/profiling.md`, "GPU time, and why it is a BOOT FLAG").
 * Owns: `PassTimer` — a timestamp query set of two stamps a pass, the buffer
 * the stamps resolve into and the one they are read back through, one
 * descriptor a slot (made once), and the last reading (`ms`, `count`,
 * `inFlight`); `PassTiming`, what a prepare is handed on a timed frame.
 * Invariants: ONE reading is in flight at a time, as Babylon's whole-frame
 * counter's is — a frame is timed only while nothing is (`open`), its stamps
 * are resolved and copied into the read-back buffer in the same encoder its
 * passes ran in (`close`), and that buffer is MAPPED only from the next main
 * pass on (`settle`), after the submit that carries the copy, because a
 * buffer mapped or pending a map fails the submit that uses it; a reading is
 * the SUM of its passes' own durations (end stamp minus begin stamp, read as
 * two 32-bit halves so no `BigInt` is made), so the gaps between them are
 * not in it; a frame whose prepares timed no pass records nothing, so a
 * reading is never a zero that means "nothing was timed"; past `SLOTS`
 * passes a frame's further passes run untimed; a reading that cannot be
 * read lands as 0, never as nothing, so whoever waits for one is answered;
 * nothing here allocates on a frame but the read-back — its `mapAsync` and
 * the view of its mapped range, once a READING, which WebGPU has no other
 * way back from.
 * Never: imports Babylon; submits; is built on a device without
 * `timestamp-query` (the `Renderer` asks); keeps a descriptor's label past
 * the pass it was handed for.
 * Contract: `docs/profiling.md`, "GPU time, and why it is a BOOT FLAG".
 */

/** The most passes one frame's prepares may time: two culls today. */
const SLOTS = 4;

/** What a prepare is handed on a frame whose passes are timed. */
export interface PassTiming {
  /**
   * The descriptor to begin a compute pass with: `plain`'s label with the
   * next free slot's timestamp writes, or `plain` itself once every slot is
   * spent. Made once a slot; valid for the one `beginComputePass` it is for.
   */
  pass(plain: GPUComputePassDescriptor): GPUComputePassDescriptor;
}

/** Where a reading is: nothing in flight, stamps recorded, or being read back. */
const IDLE = 0;
const RECORDED = 1;
const MAPPING = 2;

export class PassTimer implements PassTiming {
  /** The last reading's GPU time, milliseconds: the sum of its passes. */
  ms = 0;
  /** Bumped as each reading lands — what says a new one is in `ms`. */
  count = 0;
  private state = IDLE;
  /** Slots handed out on the frame being recorded. */
  private used = 0;
  /** Slots the reading in flight resolved. */
  private recorded = 0;
  private disposed = false;
  private readonly queries: GPUQuerySet;
  private readonly resolved: GPUBuffer;
  private readonly readback: GPUBuffer;
  private readonly descriptors: GPUComputePassDescriptor[] = [];

  constructor(device: GPUDevice) {
    this.queries = device.createQuerySet({ label: "pass timer", type: "timestamp", count: SLOTS * 2 });
    const bytes = SLOTS * 2 * 8;
    this.resolved = device.createBuffer({
      label: "pass timer: resolved",
      size: bytes,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    this.readback = device.createBuffer({
      label: "pass timer: read back",
      size: bytes,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    for (let k = 0; k < SLOTS; k++) {
      this.descriptors.push({
        timestampWrites: {
          querySet: this.queries,
          beginningOfPassWriteIndex: k * 2,
          endOfPassWriteIndex: k * 2 + 1,
        },
      });
    }
  }

  /** Whether a reading has been recorded and not yet landed. */
  get inFlight(): boolean {
    return this.state !== IDLE;
  }

  /**
   * As a main pass begins, before anything is recorded into it: a reading
   * recorded on an earlier frame — whose submit is past by now — starts its
   * read-back.
   */
  settle(): void {
    if (this.state !== RECORDED) return;
    this.state = MAPPING;
    this.readback.mapAsync(GPUMapMode.READ).then(this.landed, this.lost);
  }

  /** Whether this frame's passes are timed; if so, `close` is owed after them. */
  open(): boolean {
    if (this.state !== IDLE || this.disposed) return false;
    this.used = 0;
    return true;
  }

  pass(plain: GPUComputePassDescriptor): GPUComputePassDescriptor {
    if (this.used >= SLOTS) return plain;
    const d = this.descriptors[this.used++];
    d.label = plain.label;
    return d;
  }

  /** After a timed frame's prepares: its stamps resolved and copied out, into `encoder`. */
  close(encoder: GPUCommandEncoder): void {
    const n = this.used;
    if (n === 0) return;
    encoder.resolveQuerySet(this.queries, 0, n * 2, this.resolved, 0);
    encoder.copyBufferToBuffer(this.resolved, 0, this.readback, 0, n * 16);
    this.recorded = n;
    this.state = RECORDED;
  }

  dispose(): void {
    this.disposed = true;
    // A buffer mid-map is unmapped by its destruction, and its map rejects.
    this.queries.destroy();
    this.resolved.destroy();
    this.readback.destroy();
  }

  private readonly landed = (): void => {
    if (this.disposed) return;
    const words = new Uint32Array(this.readback.getMappedRange(0, this.recorded * 16));
    let ns = 0;
    for (let k = 0; k < this.recorded; k++) {
      const o = k * 4;
      // Each stamp is a u64 of nanoseconds; their difference fits a double.
      ns += (words[o + 3] - words[o + 1]) * 4294967296 + (words[o + 2] - words[o]);
    }
    this.readback.unmap();
    this.state = IDLE;
    // A pass the GPU could not stamp resolves to zeros, and a negative is a
    // clock that was reset: neither is a reading, so it lands as 0 — which a
    // capture reads as an unmeasured frame — and still bumps `count`, or the
    // row waiting for it would take the NEXT reading instead.
    this.ms = ns > 0 ? ns / 1e6 : 0;
    this.count++;
  };

  /** A map refused (the device lost, the buffer gone): lands as no reading. */
  private readonly lost = (): void => {
    if (this.disposed) return;
    this.state = IDLE;
    this.ms = 0;
    this.count++;
  };
}
