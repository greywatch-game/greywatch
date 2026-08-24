/**
 * boxIndex.ts — A uniform grid over the collider boxes, for build-time queries.
 * Owns: the bucket grid and the "which boxes could reach this point" lookup.
 * Owns no geometry, no Babylon types, and nothing that outlives a build.
 *
 * WHY THIS EXISTS. Three build-time passes ask the same question — which of the
 * ~800 collider boxes could touch this (x, z)? — and two of them used to answer
 * it by walking all of them:
 *
 * - `GrassSystem.scatter` rejects tufts growing inside a collider. At ~11k tufts
 *   against ~800 boxes that is nearly nine million box tests for one field.
 * - `MapBuilder.findSpot` rejects buried props. 425 props, up to 14 attempts
 *   each, same 800 boxes.
 * - `vertexShading` already bucketed, correctly, in a private copy of this
 *   code — which is where the shape below comes from.
 *
 * All three run inside one `installMap`, on the map build the loading card
 * exists to cover. Three indexes get built now where one used to; each is a
 * single pass over the boxes and pays for itself in the first few hundred
 * queries.
 *
 * THE PAD IS PAID AT INSERT, NOT AT QUERY. Each box is stamped into every cell
 * within `pad` of its own footprint, so a query reads exactly ONE cell and is
 * still complete for anything within `pad` of the point. The alternative —
 * stamping tightly and reading a 3x3 neighbourhood — is nine times the work per
 * query for the same answer, and queries outnumber boxes by four orders of
 * magnitude here. A caller that asks about a clearance larger than the `pad` it
 * built with will silently miss boxes, so `pad` is the caller's promise about
 * its own largest query.
 *
 * THE TWO MAP-SIZED BOXES ARE DROPPED — the ground plane's stand-in and the
 * ridge, exactly as `NavGrid` and `ObstacleField` drop them. They are boundary
 * rather than furniture, and a 244 m box in a 4 m bucket is in every cell on
 * the map, which would make the index a slower way of walking the whole list.
 * Callers that care about the floor have `TerrainField`, which answers better.
 */
import { halfDepth } from "./boxGeometry";
import type { WorldBox } from "./MapBuilder";

/**
 * Bucket edge, metres. Sized against the things being indexed rather than the
 * map: a village box is a few metres, so 4 m keeps most cells to a handful of
 * entries without making the grid itself large (a 240 m map is 62x62).
 */
export const BOX_BUCKET = 4;

/** Above this in either footprint axis a box is boundary, not furniture. */
const MAP_SIZED = 200;

export interface BoxIndex {
  /** The indexed boxes — a SUBSET of what was handed in, see the header. */
  readonly boxes: WorldBox[];
  readonly cells: (number[] | null)[];
  readonly dim: number;
  readonly origin: number;
  /** The promise `insertBox` stamped with. See the header. */
  readonly pad: number;
  /**
   * The map-sized boxes the grid refuses, kept rather than dropped.
   *
   * A caller that used to walk every box was testing these too, and for scatter
   * placement that matters: the ridge is what stops a prop being planted inside
   * the valley wall. Dropping them silently moved four props into the rim
   * across the two maps — a small enough number to read as noise, which is
   * exactly why it is worth naming. There are only ever a handful, so a caller
   * that wants them walks this list; `vertexShading` deliberately does not,
   * for the same reason `NavGrid` and `ObstacleField` do not.
   */
  readonly oversized: WorldBox[];
}

/**
 * An empty grid over a map of `size` metres, whose queries will ask about at
 * most `pad` metres beyond a box's own footprint.
 */
export function emptyBoxIndex(size: number, pad: number): BoxIndex {
  const dim = Math.ceil(size / BOX_BUCKET) + 2;
  return {
    boxes: [],
    cells: new Array(dim * dim).fill(null),
    dim,
    origin: -size / 2 - BOX_BUCKET,
    pad,
    oversized: [],
  };
}

/**
 * Adds one box. Silently ignores the map-sized pair, so a caller can hand this
 * every collider it makes without filtering first.
 *
 * Incremental because `MapBuilder` needs it that way: scatter regions place
 * props, props emit colliders, and a later region's burial test has to see an
 * earlier region's props. An index built once before scattering would answer
 * for the buildings and be blind to everything scattered since.
 */
export function insertBox(index: BoxIndex, box: WorldBox): void {
  if (box.w > MAP_SIZED || box.d > MAP_SIZED) {
    index.oversized.push(box);
    return;
  }
  const at = index.boxes.push(box) - 1;
  const { dim, origin, cells } = index;
  const cell = (v: number) =>
    Math.max(0, Math.min(dim - 1, Math.floor((v - origin) / BOX_BUCKET)));
  // THE PAD GOES INSIDE THE DIAGONAL, and getting that backwards is a silent
  // miss rather than an error. What a caller accepts is a RECTANGLE in the
  // box's own frame, grown by `pad` on each axis; the furthest such point from
  // the centre is that rectangle's circumradius, `hypot(w/2 + pad, d/2 + pad)`.
  // Written as `hypot(w, d) / 2 + pad` — the same terms in the other order — it
  // is smaller for every pad above zero, and the corners of the acceptance
  // region fall outside the cells the box was stamped into. Measured on
  // Hollowmere: three props out of 425 changed where they landed, which is the
  // sort of margin that reads as noise and is a bug.
  //
  // `halfDepth` is folded in because a PITCHED slab stands deeper than `d / 2`
  // when it is taller than it is deep — a stair parapet is the case.
  const halfW = box.w / 2 + index.pad;
  const halfD = Math.max(box.d / 2, halfDepth(box)) + index.pad;
  const reach = Math.hypot(halfW, halfD);
  const x0 = cell(box.cx - reach);
  const x1 = cell(box.cx + reach);
  const z0 = cell(box.cz - reach);
  const z1 = cell(box.cz + reach);
  for (let cx = x0; cx <= x1; cx++) {
    for (let cz = z0; cz <= z1; cz++) {
      (cells[cz * dim + cx] ??= []).push(at);
    }
  }
}

/** Builds the grid over a set of boxes that is already complete. */
export function buildBoxIndex(
  boxes: readonly WorldBox[],
  size: number,
  pad: number,
): BoxIndex {
  const index = emptyBoxIndex(size, pad);
  for (const box of boxes) insertBox(index, box);
  return index;
}

/**
 * The boxes that could reach `(x, z)`, as indices into `index.boxes`, or null
 * where nothing is near. ONE cell — see the header on why that is complete.
 */
export function boxesNear(
  index: BoxIndex,
  x: number,
  z: number,
): readonly number[] | null {
  const cx = Math.max(
    0,
    Math.min(index.dim - 1, Math.floor((x - index.origin) / BOX_BUCKET)),
  );
  const cz = Math.max(
    0,
    Math.min(index.dim - 1, Math.floor((z - index.origin) / BOX_BUCKET)),
  );
  return index.cells[cz * index.dim + cx];
}
