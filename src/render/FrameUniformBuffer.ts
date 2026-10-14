/**
 * render/FrameUniformBuffer.ts — The frame block's GPU buffer: a
 * `UniformBlockBuffer` of `FRAME_BLOCK`, written from a `FrameUniforms`.
 * Owns: `FrameUniformBuffer`, and the one fact about it that is the frame's
 * rather than any block's — which variant it is laid out for.
 * Invariants: the buffer is laid out for the LONGEST variant (the palette's),
 * which every shorter variant binds a prefix of, because the frame is one
 * layout in every variant but its last field (`frame.ts`); the copy is
 * `UniformBlockBuffer`'s, by the computed layout; `write` allocates nothing.
 * Never: imports Babylon; reads a value from anywhere but the struct it is
 * handed.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 *
 * ONE BUFFER IS ONE PASS'S FRAME. `queue.writeBuffer` lands before the next
 * submit, whichever pass reads it, so two passes in one frame that need
 * different frames — the main pass and a probe's bake, whose eye and
 * `opaqueAlpha` differ — owe a buffer EACH (X3.6c), never two writes to one.
 */
import { FRAME_BLOCK, type FrameUniforms } from "./frame";
import { UniformBlockBuffer } from "./UniformBlockBuffer";

export class FrameUniformBuffer extends UniformBlockBuffer {
  constructor(device: GPUDevice, label: string) {
    super(device, FRAME_BLOCK, ["CEL_PALETTE"], `${label} frame`);
  }

  /** Lays `u` out as WGSL reads it and queues the upload. */
  override write(u: FrameUniforms): void {
    super.write(u);
  }
}
