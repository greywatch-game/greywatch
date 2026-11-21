/**
 * render/UniformBlockBuffer.ts — One uniform block's GPU buffer, and the one
 * copy that turns its values — a tight `Float32Array` per field, named as
 * the shader names it — into the bytes WGSL reads.
 * Owns: `UniformBlockBuffer` — the buffer (`buffer`), its staging array, and
 * the copy plan computed once from the block's layout for one variant.
 * Invariants: each field is written at the offset and stride `blockLayout`
 * places it at for the variant the buffer was made for, so the copy and the
 * declaration are one statement; a field the values do not carry is left as
 * it was (zero, the first time); `write` allocates nothing.
 * Never: imports Babylon; reads a value from anywhere but the values it is
 * handed.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 */
import type { Binding } from "./wgsl/assemble";
import { blockLayout } from "./wgsl/layout";

interface Copy {
  readonly field: string;
  /** First float of the field in the staging array. */
  readonly at: number;
  readonly count: number;
  readonly components: number;
  /** Floats from one element to the next in the staging array. */
  readonly stride: number;
}

/** A block's values: one tight array per field, by the shader's name. */
export type BlockValues = { readonly [field: string]: Float32Array | undefined };

export class UniformBlockBuffer {
  readonly buffer: GPUBuffer;
  /** Bytes in the buffer: the block's for the variant. */
  readonly size: number;
  private readonly staging: Float32Array<ArrayBuffer>;
  private readonly plan: readonly Copy[];

  constructor(
    private readonly device: GPUDevice,
    block: Extract<Binding, { kind: "uniform" }>,
    defines: Iterable<string>,
    label: string,
  ) {
    const layout = blockLayout(block, defines);
    this.size = layout.size;
    this.staging = new Float32Array(layout.size / 4);
    this.plan = layout.fields.map((f) => ({
      field: f.name,
      at: f.offset / 4,
      count: f.count,
      components: f.components,
      stride: f.stride / 4,
    }));
    this.buffer = device.createBuffer({
      label,
      size: layout.size,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  /** Lays `values` out as WGSL reads them and queues the upload. */
  write(values: BlockValues): void {
    const out = this.staging;
    const plan = this.plan;
    for (let p = 0; p < plan.length; p++) {
      const c = plan[p];
      const src = values[c.field];
      if (src === undefined) continue;
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
