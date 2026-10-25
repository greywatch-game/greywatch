/**
 * render/scatterList.ts — How the scatter's draw names what the vertex stage
 * draws (`BABYLON_EXIT.md` X3.5b, the fold): the instance cull writes one
 * ENTRY a surviving cluster into the scatter's LIST, and each vertex index of
 * the scatter's draw names an entry and a corner of its cluster, which the
 * vertex stage reads back through the list and the 16-bit source.
 * Owns: the entry (`LIST_WORDS`), the index's encoding — the scatter bit and
 * the corners beneath it (`SCATTER_CORNERS`), and the corners a survivor
 * takes (`listStride`) — and its WGSL
 * (`scatterListWgsl`), the source's width (`SOURCE_VERTICES`) and its read
 * (`sourceIndexWgsl`): the one spelling of each, for the cull that writes an
 * entry and the stage that reads one.
 * Invariants: an index with the scatter bit CLEAR is a plain vertex of its
 * group's arrays, drawn at identity — a block's, or the landform's; one with
 * it SET is `slot * stride + corner` beneath it, `stride` being a cluster's
 * most indices, so every survivor's run is one length; an entry is the
 * survivor's instance, its cluster's first index into the source, the
 * cluster's index count and its part's first vertex in its group's arrays;
 * a corner past the cluster's count repeats its last, so a short cluster
 * ends in triangles of no area; a ZERO entry — a count of 0, which no
 * cluster has — draws NOTHING, every corner of it clipped before an
 * attribute is read (`celVertex.ts`'s decode), so the list may be cleared
 * and drawn past what the cull wrote (`InstanceCull`); a source index is 16
 * bits, local to its part, two to a word; a cut whose list or part does not
 * fit is handed back
 * (`WorldBlocks`, by `scatterCut.ts`'s `listPast` and `sourcePast`), never
 * drawn wrapped.
 * Never: imports Babylon.
 *
 * WHY A LIST AND NOT A STREAM. The cull used to EXPAND every survivor into
 * an index stream the scatter drew indexed — 2-4 M indices a frame written
 * on the forest maps at the phone's settings, which the phone paid at about
 * 0.25-0.3 ms a million, and a stream sized for every record surviving,
 * 124 MB on Greyfen and 92% of a default storage binding. The list writes 16
 * bytes a survivor and the phone's cull fell 55-70%, about half of it given
 * back to the vertex stage's lost reuse of a shared corner (measured
 * 2026-10-23, `BABYLON_EXIT.md` X3.5b).
 */

/** A survivor's entry in the list, in 32-bit words. */
export const LIST_WORDS = 4;
/** The corners a draw's scatter indices can name: everything beneath the scatter bit. */
export const SCATTER_CORNERS = 2 ** 31;
/** The most vertices one instanced part may hold: its source indices are 16 bits. */
export const SOURCE_VERTICES = 2 ** 16;

/**
 * The corners a survivor's run takes in the scatter's draw, for clusters of
 * at most `triangles` triangles (`CONFIG.graphics.clusters`): a cluster's
 * most indices, so every run is one length — the list's `stride`.
 */
export function listStride(triangles: number): number {
  return triangles * 3;
}

/**
 * The list's encoding as WGSL, for a list whose survivors each take `stride`
 * corners: `listIndex` is where slot `slot`'s run starts (the cull's draw
 * arguments); `isScatter`, `listSlot` and `listCorner` read an index (the
 * vertex stage).
 */
export function scatterListWgsl(stride: number): string {
  return /* wgsl */ `
const SCATTER_BIT: u32 = ${SCATTER_CORNERS}u;
const LIST_STRIDE: u32 = ${stride}u;
fn isScatter(index: u32) -> bool { return (index & SCATTER_BIT) != 0u; }
fn listIndex(slot: u32) -> u32 { return SCATTER_BIT | (slot * LIST_STRIDE); }
fn listSlot(index: u32) -> u32 { return (index & ~SCATTER_BIT) / LIST_STRIDE; }
fn listCorner(index: u32) -> u32 { return (index & ~SCATTER_BIT) % LIST_STRIDE; }
`;
}

/**
 * `sourceIndex(j)`, the `j`th 16-bit index of the source bound as `source`
 * — the low half of its word for an even `j`, the high for an odd (the
 * buffer is little-endian, as WebGPU's are).
 */
export function sourceIndexWgsl(source: string): string {
  return /* wgsl */ `
fn sourceIndex(j: u32) -> u32 {
  return (${source}[j >> 1u] >> ((j & 1u) << 4u)) & 0xffffu;
}
`;
}
