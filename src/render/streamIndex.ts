/**
 * render/streamIndex.ts — How one INDEX of the world's stream names what the
 * vertex stage draws (`BABYLON_EXIT.md` X3.5b, the fold): a vertex, and for
 * the scatter the instance it is drawn at.
 * Owns: the split of the 32 bits (`SCATTER_BIT`, `VERTEX_BITS`,
 * `INSTANCE_BITS`), the budget a map's cut is held to (`SCATTER_VERTICES`,
 * `SCATTER_INSTANCES`), and the same constants as WGSL (`STREAM_INDEX_WGSL`)
 * for the cull that writes an index and the stage that reads one.
 * Invariants: an index with the top bit CLEAR is a plain vertex of its
 * group's arrays, drawn at identity — a block's, or the landform's; one with
 * it SET is a scatter vertex: the instance in the next `INSTANCE_BITS`, the
 * vertex in the low `VERTEX_BITS`, counted from the start of the group's
 * arrays, where its instanced parts are laid FIRST (`WorldBlocks`), so no
 * per-group base is added and the decode is shifts and masks; a cut whose
 * instances or instanced vertices do not fit is handed back (`WorldBlocks`),
 * never drawn wrapped.
 * Never: imports Babylon.
 *
 * WHY THIS SPLIT. Measured 2026-10-20 at max settings on all seven maps
 * (`BABYLON_EXIT.md` X3.5b): the instance and the vertex of its group's
 * whole buffer need 33 bits on Greyfen and Cinderhaven, so the scatter is
 * addressed in its own region — at most 2,995 instances (Sarab, 12 bits) and
 * 69,007 instanced vertices a group (Cinderhaven, 17 bits). 18 vertex bits
 * and 13 instance bits leave each about three times that.
 */

/** Set on a scatter vertex's index; clear on a block's or the landform's. */
export const SCATTER_BIT = 0x80000000;
/** The low bits of a scatter index: its vertex in its group's instanced parts. */
export const VERTEX_BITS = 18;
/** The bits above them: its instance, in the world's one instance table. */
export const INSTANCE_BITS = 13;
/** The most instanced vertices one group may hold. */
export const SCATTER_VERTICES = 2 ** VERTEX_BITS;
/** The most instances a map may hold. */
export const SCATTER_INSTANCES = 2 ** INSTANCE_BITS;

/** The split as WGSL constants, for a module that writes or reads a stream index. */
export const STREAM_INDEX_WGSL = /* wgsl */ `
const SCATTER_BIT: u32 = 0x80000000u;
const VERTEX_BITS: u32 = ${VERTEX_BITS}u;
const VERTEX_MASK: u32 = ${SCATTER_VERTICES - 1}u;
const INSTANCE_MASK: u32 = ${SCATTER_INSTANCES - 1}u;
`;
