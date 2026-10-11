/**
 * blocks.ts — `BLOCK_SIZE`: the side of a merge block for a map that states
 * none, and the world layer's fixed unit of LOCALITY.
 * Owns: that one number, and nothing else.
 * Never: import anything. **A file of its own because the authority reads it**
 * — `src/sim/simWorld.ts` defaults a map's `blockSize` and `terrainBlock` to it
 * and `GlassSystem` buckets its pane index by it — and it sat in `merge.ts`, whose readers reached it through
 * `MapBuilder`: one number pulled the whole map builder, every kit builder
 * and Babylon behind them into the server (`BABYLON_EXIT.md` X2.2).
 * `MapBuilder` re-exports it, so a reader that names it from there is
 * unaffected.
 */

/**
 * Side of a merge block, in metres, **for a map that states none** — and the
 * world layer's fixed unit of LOCALITY, which is a second job and the reason
 * this is still a constant at all.
 *
 * 48 m over a 240 m map gives a 5x5 grid of blocks — coarse enough that the
 * whole village collapses into a few dozen draws, fine enough that frustum
 * culling still throws away most of the map. Well under the 78 m fog wall, so
 * a block is never half-visible for long. **Every clause of that is about a
 * 240 m map with a 78 m fog wall**, which is why `MapLayout.blockSize` exists
 * and why this is the default rather than the answer.
 *
 * **The two jobs came apart the moment a map could state its own, and they
 * must stay apart.** What a map states is how the MERGE groups: fewer, larger
 * meshes to walk and to draw, at coarser cull granularity. What stays here is
 * the size of a locality BUCKET — `PhysicsWorld`'s static containers and
 * `GlassSystem`'s pane index — and those two want the opposite thing from a
 * large map. Havok's `HP_Shape_AddChild` is quadratic in a container's children,
 * so a bucket that grew with a map's merge block would
 * hand back most of what S5b bought; a pane bucket is a slab rejection whose
 * only cost is the panes inside it. Neither is an identity — nothing reads
 * either key — so neither has anything to agree with.
 *
 * `terrainPatches` is called with `MapLayout.terrainBlock`, which defaults to
 * this too and moves independently of the merge's.
 */
export const BLOCK_SIZE = 48;
