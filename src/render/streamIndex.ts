/**
 * render/streamIndex.ts — How one INDEX of the world's stream names what the
 * vertex stage draws (`BABYLON_EXIT.md` X3.5b, the fold): a vertex, and for
 * the scatter the instance it is drawn at.
 * Owns: the split of the 32 bits (`VERTEX_BITS`, `INSTANCE_BITS`, and the
 * scatter bit above both), the budget a map's cut is held to
 * (`SCATTER_VERTICES`, `SCATTER_INSTANCES`), and the encode and decode as
 * WGSL (`STREAM_INDEX_WGSL`) — the one spelling of each, for the cull that
 * writes an index and the stage that reads one.
 * Invariants: an index with the scatter bit CLEAR is a plain vertex of its
 * group's arrays, drawn at identity — a block's, or the landform's; one with
 * it SET is a scatter vertex: the instance in the next `INSTANCE_BITS`, the
 * vertex in the low `VERTEX_BITS`, counted from the start of the group's
 * arrays, where its instanced parts are laid FIRST (`WorldBlocks`), so no
 * per-group base is added and the decode is shifts and masks; the scatter
 * bit is the one above both fields, so widening either moves it rather than
 * colliding with it, and the whole is held to 32 bits here; a cut whose
 * instances or instanced vertices do not fit is handed back
 * (`WorldBlocks`), never drawn wrapped.
 * Never: imports Babylon.
 *
 * WHY THIS SPLIT. Measured 2026-10-20 at max settings on all seven maps
 * (`BABYLON_EXIT.md` X3.5b): the instance and the vertex of its group's
 * whole buffer need 33 bits on Greyfen and Cinderhaven, so the scatter is
 * addressed in its own region — at most 2,995 instances (Sarab, 12 bits) and
 * 69,007 instanced vertices a group (Cinderhaven, 17 bits). 18 vertex bits
 * and 13 instance bits leave each about three times that.
 */

/** The low bits of a scatter index: its vertex in its group's instanced parts. */
export const VERTEX_BITS = 18;
/** The bits above them: its instance, in the world's one instance table. */
export const INSTANCE_BITS = 13;
/** The most instanced vertices one group may hold. */
export const SCATTER_VERTICES = 2 ** VERTEX_BITS;
/** The most instances a map may hold. */
export const SCATTER_INSTANCES = 2 ** INSTANCE_BITS;

if (VERTEX_BITS + INSTANCE_BITS + 1 > 32) throw new Error("streamIndex: the split does not fit 32 bits");

/**
 * The split as WGSL: `scatterIndex` writes an index (the cull's `expand`),
 * `isScatter`, `scatterInstance` and `scatterVertex` read one (the vertex
 * stage's decode).
 */
export const STREAM_INDEX_WGSL = /* wgsl */ `
const SCATTER_BIT: u32 = ${2 ** (VERTEX_BITS + INSTANCE_BITS)}u;
const VERTEX_MASK: u32 = ${SCATTER_VERTICES - 1}u;
const INSTANCE_MASK: u32 = ${SCATTER_INSTANCES - 1}u;

/** The index of vertex \`vertex\` of a group's instanced parts, drawn at instance \`instance\`. */
fn scatterIndex(instance: u32, vertex: u32) -> u32 {
  return SCATTER_BIT | (instance << ${VERTEX_BITS}u) | vertex;
}
fn isScatter(index: u32) -> bool { return (index & SCATTER_BIT) != 0u; }
fn scatterInstance(index: u32) -> u32 { return (index >> ${VERTEX_BITS}u) & INSTANCE_MASK; }
fn scatterVertex(index: u32) -> u32 { return index & VERTEX_MASK; }
`;
