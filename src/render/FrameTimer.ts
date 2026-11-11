/**
 * render/FrameTimer.ts — The GPU time of the WHOLE frame, read back through
 * timestamp queries of our own under `?gpu`, which a capture files as
 * `gpu.frame` (`docs/profiling.md`, "GPU time, and why it is a BOOT FLAG";
 * `BABYLON_EXIT.md` X5.4g — Babylon's `_timestampQuery` until then, which
 * bracketed its two encoders with `writeTimestamp`).
 * Owns: `FrameTimer` — a timestamp query set of two stamps, the buffer they
 * resolve into and the one they are read back through, the two pass
 * descriptors that write them (made once), and the last reading (`ms`,
 * `count`, `inFlight`).
 * Invariants: the stamps are written by two EMPTY compute passes of this
 * file's own — the first command of the frame's encoder (`open`, the
 * beginning of its pass) and the last (`close`, the end of its pass) — so a
 * reading runs from before the frame's first pass starts to after its last
 * pass ends, every pass of the frame inside it and nothing of the next
 * frame's, whatever pass happens to be first or last; ONE reading is in
 * flight at a time, as Babylon's whole-frame counter's was — a frame is timed
 * only while nothing is (`open` refuses otherwise), its stamps are resolved
 * and copied into the read-back buffer in the same encoder (`close`), and
 * that buffer is MAPPED only after the submit that carries the copy
 * (`submitted`), because a buffer mapped or pending a map fails the submit
 * that uses it; a reading is the end stamp minus the begin stamp, read as two
 * 32-bit halves so no `BigInt` is made; a reading that cannot be read lands
 * as 0, never as nothing, so whoever waits for one is answered; nothing here
 * allocates on a frame but the read-back — its `mapAsync` and the view of its
 * mapped range, once a READING, which WebGPU has no other way back from.
 * Its stamps are pass descriptors' (`timestampWrites`), so it needs the
 * device's `timestamp-query` and no browser flag: the encoder's
 * `writeTimestamp` Babylon's counter used is behind
 * `--enable-unsafe-webgpu` in Chrome, and this is not.
 * Never: imports Babylon; submits; is built on a device without
 * `timestamp-query` (its owner asks); records anything but its two empty
 * passes, the resolve and the copy.
 * Contract: `docs/profiling.md`, "GPU time, and why it is a BOOT FLAG".
 */

/** Where a reading is: nothing in flight, the frame being recorded, its stamps submitted, or being read back. */
const IDLE = 0;
const OPEN = 1;
const RECORDED = 2;
const MAPPING = 3;

export class FrameTimer {
  /** The last reading's GPU time, milliseconds: the frame's last pass's end minus its first's start. */
  ms = 0;
  /** Bumped as each reading lands — what says a new one is in `ms`. */
  count = 0;
  private state = IDLE;
  private disposed = false;
  private readonly queries: GPUQuerySet;
  private readonly resolved: GPUBuffer;
  private readonly readback: GPUBuffer;
  private readonly first: GPUComputePassDescriptor;
  private readonly last: GPUComputePassDescriptor;

  constructor(device: GPUDevice) {
    this.queries = device.createQuerySet({ label: "frame timer", type: "timestamp", count: 2 });
    this.resolved = device.createBuffer({
      label: "frame timer: resolved",
      size: 16,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    this.readback = device.createBuffer({
      label: "frame timer: read back",
      size: 16,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    this.first = {
      label: "frame timer: first",
      timestampWrites: { querySet: this.queries, beginningOfPassWriteIndex: 0 },
    };
    this.last = {
      label: "frame timer: last",
      timestampWrites: { querySet: this.queries, endOfPassWriteIndex: 1 },
    };
  }

  /**
   * Whether a reading is open, recorded or being read back — true from the
   * frame it times opening until its reading lands, which is what files it
   * against the right row (`FrameProfile`'s `pollGpuFrame`).
   */
  get inFlight(): boolean {
    return this.state !== IDLE;
  }

  /**
   * As the frame's encoder is made, before anything is recorded into it: the
   * frame is timed if no reading is in flight, its first stamp written by an
   * empty pass that is the encoder's first command.
   */
  open(encoder: GPUCommandEncoder): void {
    if (this.state !== IDLE || this.disposed) return;
    encoder.beginComputePass(this.first).end();
    this.state = OPEN;
  }

  /**
   * Before the frame's encoder is finished, after everything else recorded
   * into it: the last stamp by an empty pass that is its last pass, both
   * stamps resolved and copied out.
   */
  close(encoder: GPUCommandEncoder): void {
    if (this.state !== OPEN) return;
    encoder.beginComputePass(this.last).end();
    encoder.resolveQuerySet(this.queries, 0, 2, this.resolved, 0);
    encoder.copyBufferToBuffer(this.resolved, 0, this.readback, 0, 16);
    this.state = RECORDED;
  }

  /** After the submit that carried `close`'s copy: the reading starts its read-back. */
  submitted(): void {
    if (this.state !== RECORDED) return;
    this.state = MAPPING;
    this.readback.mapAsync(GPUMapMode.READ).then(this.landed, this.lost);
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
    const words = new Uint32Array(this.readback.getMappedRange(0, 16));
    // Each stamp is a u64 of nanoseconds; their difference fits a double.
    const ns = (words[3] - words[1]) * 4294967296 + (words[2] - words[0]);
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
