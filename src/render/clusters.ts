/**
 * render/clusters.ts — A block surface CUT into clusters: runs of one piece's
 * triangles, each with its box, for the compute cull (`ClusterCull`,
 * `BABYLON_EXIT.md` X3.3b).
 * Owns: `cutClusters` and the `Cluster` it makes.
 * Invariants: a cluster is a run of at most `maxTriangles` CONSECUTIVE
 * triangles of ONE piece, in the surface's own index order, so the clusters
 * of a surface tile its index list in order and a cluster's piece is the
 * X1.4 piece its triangles came from (`PieceRange`); its box is the exact
 * float32 bounds of the vertices its triangles name — the values the device
 * holds — so a cull that tests it drops only what lies wholly outside; its
 * sway is read off the colour buffer's red channel exactly as the vertex
 * stage reads it (`shaders/wgsl/celVertex.ts`): above 0 a RAMP weight,
 * below 0 a RIGGED layer. Cut once per map, never per frame.
 * Never: imports Babylon; reads a node; reorders a triangle.
 */

/** A span of a surface's indices that came from one piece — `PieceRange`'s index half. */
export interface PieceSpan {
  readonly piece: number;
  readonly indexStart: number;
  readonly indexCount: number;
}

/** One cluster of a surface. */
export interface Cluster {
  /** Into the surface's own index list. */
  readonly indexStart: number;
  readonly indexCount: number;
  /** The X1.4 piece (`GameMap.world.pieces`) its triangles came from. */
  readonly piece: number;
  /** The box of its vertices, as the float32 values the device holds. */
  readonly lo: readonly [number, number, number];
  readonly hi: readonly [number, number, number];
  /** The largest RAMP weight a vertex carries: its sway is at most this times the ramp's reach. */
  readonly ramp: number;
  /** Whether any vertex is on a RIGGED layer (a frond or a bough). */
  readonly rigged: boolean;
}

/**
 * Cuts one surface: `positions` as float32 (three a vertex), its `indices`
 * (three a triangle), its `colors` (four a vertex, or null: no sway) and the
 * piece spans that tile its index list.
 */
export function cutClusters(
  positions: Float32Array,
  indices: Uint32Array,
  colors: ArrayLike<number> | null,
  pieces: readonly PieceSpan[],
  maxTriangles: number,
): Cluster[] {
  const out: Cluster[] = [];
  const step = maxTriangles * 3;
  for (const span of pieces) {
    const end = span.indexStart + span.indexCount;
    for (let start = span.indexStart; start < end; start += step) {
      const stop = Math.min(end, start + step);
      let lx = Infinity, ly = Infinity, lz = Infinity;
      let hx = -Infinity, hy = -Infinity, hz = -Infinity;
      let ramp = 0;
      let rigged = false;
      for (let i = start; i < stop; i++) {
        const v = indices[i];
        const x = positions[v * 3];
        const y = positions[v * 3 + 1];
        const z = positions[v * 3 + 2];
        if (x < lx) lx = x;
        if (y < ly) ly = y;
        if (z < lz) lz = z;
        if (x > hx) hx = x;
        if (y > hy) hy = y;
        if (z > hz) hz = z;
        if (colors) {
          const r = colors[v * 4];
          if (r > ramp) ramp = r;
          else if (r < 0) rigged = true;
        }
      }
      out.push({
        indexStart: start,
        indexCount: stop - start,
        piece: span.piece,
        lo: [lx, ly, lz],
        hi: [hx, hy, hz],
        ramp,
        rigged,
      });
    }
  }
  return out;
}
