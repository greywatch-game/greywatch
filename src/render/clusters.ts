/**
 * render/clusters.ts — A block surface CUT into clusters: runs of one piece's
 * triangles, each with its box, for the compute cull (`ClusterCull`,
 * `BABYLON_EXIT.md` X3.3b).
 * Owns: `cutClusters` and the `Cluster` it makes; `withoutPieces`, a surface
 * with some of its pieces cut out (the scatter's, which our renderer draws
 * as instances instead — `BABYLON_EXIT.md` X3.4b).
 * Invariants: a cluster is a run of at most `maxTriangles` CONSECUTIVE
 * triangles of ONE piece, in the surface's own index order, so the clusters
 * of a surface tile its index list in order and a cluster's piece is the
 * X1.4 piece its triangles came from (`PieceRange`); its box is the exact
 * float32 bounds of the vertices its triangles name — the values the device
 * holds — so a cull that tests it drops only what lies wholly outside; its
 * sway is read off the colour buffer's red channel exactly as the vertex
 * stage reads it (`shaders/wgsl/celVertex.ts`): above 0 a RAMP weight,
 * below 0 a RIGGED layer. Cut once per map, never per frame. A piece's
 * triangles name only its own vertices (`worldGeometry.ts`'s `PieceRange`),
 * so cutting a piece out is dropping its two ranges and moving every later
 * index down by the vertices dropped ahead of it.
 * Never: imports Babylon; reads a node; reorders a triangle.
 */

/** A span of a surface's vertices and indices that came from one piece — `PieceRange`. */
export interface PieceSpan {
  readonly piece: number;
  readonly vertexStart: number;
  readonly vertexCount: number;
  readonly indexStart: number;
  readonly indexCount: number;
}

/** A surface's arrays, as much of `GeometryBuffer` as is read here. */
export interface SurfaceArrays {
  readonly positions: Float32Array | Float64Array;
  readonly normals: Float32Array | Float64Array | null;
  readonly colors: Float32Array | Float64Array | null;
  readonly uvs: Float32Array | Float64Array | null;
  readonly uvs2: Float32Array | Float64Array | null;
  readonly indices: Uint32Array;
}

/**
 * `geometry` without the pieces `cut` names, and the pieces it keeps — or
 * the surface as it is when it cuts none. Each attribute keeps its array's
 * type, so a kept vertex is the bits it was; each kept index moves down by
 * the vertices cut out ahead of its piece.
 */
export function withoutPieces(
  geometry: SurfaceArrays,
  pieces: readonly PieceSpan[],
  cut: (piece: number) => boolean,
): { geometry: SurfaceArrays; pieces: PieceSpan[]; cutIndices: number } {
  const kept = pieces.filter((p) => !cut(p.piece));
  if (kept.length === pieces.length) return { geometry, pieces: [...pieces], cutIndices: 0 };
  let vertices = 0;
  let indexTotal = 0;
  for (const p of kept) {
    vertices += p.vertexCount;
    indexTotal += p.indexCount;
  }
  const take = <T extends Float32Array | Float64Array>(a: T | null, per: number): T | null => {
    if (!a) return null;
    const out = new (a.constructor as { new (n: number): T })(vertices * per);
    let at = 0;
    for (const p of kept) {
      out.set(a.subarray(p.vertexStart * per, (p.vertexStart + p.vertexCount) * per), at);
      at += p.vertexCount * per;
    }
    return out;
  };
  const indices = new Uint32Array(indexTotal);
  const out: PieceSpan[] = [];
  let v = 0;
  let x = 0;
  for (const p of kept) {
    const shift = p.vertexStart - v;
    for (let i = 0; i < p.indexCount; i++) indices[x + i] = geometry.indices[p.indexStart + i] - shift;
    out.push({ piece: p.piece, vertexStart: v, vertexCount: p.vertexCount, indexStart: x, indexCount: p.indexCount });
    v += p.vertexCount;
    x += p.indexCount;
  }
  return {
    geometry: {
      positions: take(geometry.positions, 3)!,
      normals: take(geometry.normals, 3),
      colors: take(geometry.colors, 4),
      uvs: take(geometry.uvs, 2),
      uvs2: take(geometry.uvs2, 2),
      indices,
    },
    pieces: out,
    cutIndices: geometry.indices.length - indexTotal,
  };
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
