/**
 * render/FrameUniformBuffer.ts — The frame block's GPU buffer, and the one
 * copy that turns a `FrameUniforms` into the bytes WGSL reads.
 * Owns: the buffer (`buffer`), its staging array, and the copy plan computed
 * once from the block's layout.
 * Invariants: the buffer is laid out for the LONGEST variant (the palette's),
 * which every shorter variant binds a prefix of, because the frame is one
 * layout in every variant but its last field (`frame.ts`); each field is
 * written at the offset and stride `blockLayout` places it at, so the copy
 * and the declaration are one statement; `write` allocates nothing.
 * Never: imports Babylon; reads a value from anywhere but the struct it is
 * handed.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 *
 * ONE BUFFER IS ONE PASS'S FRAME. `queue.writeBuffer` lands before the next
 * submit, whichever pass reads it, so two passes in one frame that need
 * different frames — the main pass and a probe's bake, whose eye and
 * `opaqueAlpha` differ — owe a buffer EACH (X3.6c), never two writes to one.
 */
import { FRAME_BLOCK, type FrameField, type FrameUniforms } from "./frame";
import { blockLayout } from "./wgsl/layout";

interface Copy {
  readonly field: FrameField;
  /** First float of the field in the staging array. */
  readonly at: number;
  readonly count: number;
  readonly components: number;
  /** Floats from one element to the next in the staging array. */
  readonly stride: number;
}

export class FrameUniformBuffer {
  readonly buffer: GPUBuffer;
  /** Bytes in the buffer: the palette variant's block. */
  readonly size: number;
  private readonly staging: Float32Array<ArrayBuffer>;
  private readonly plan: readonly Copy[];

  constructor(
    private readonly device: GPUDevice,
    label: string,
  ) {
    const layout = blockLayout(FRAME_BLOCK, ["CEL_PALETTE"]);
    this.size = layout.size;
    this.staging = new Float32Array(layout.size / 4);
    this.plan = layout.fields.map((f) => ({
      field: f.name as FrameField,
      at: f.offset / 4,
      count: f.count,
      components: f.components,
      stride: f.stride / 4,
    }));
    this.buffer = device.createBuffer({
      label: `${label} frame`,
      size: layout.size,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  /** Lays `u` out as WGSL reads it and queues the upload. */
  write(u: FrameUniforms): void {
    const out = this.staging;
    const plan = this.plan;
    for (let p = 0; p < plan.length; p++) {
      const c = plan[p];
      const src = u[c.field];
      if (c.stride === c.components) {
        out.set(src, c.at);
        continue;
      }
      for (let i = 0, s = 0, d = c.at; i < c.count; i++, d += c.stride) {
        for (let k = 0; k < c.components; k++) out[d + k] = src[s++];
      }
    }
    this.device.queue.writeBuffer(this.buffer, 0, out);
  }

  destroy(): void {
    this.buffer.destroy();
  }
}
