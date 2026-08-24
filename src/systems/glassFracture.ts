/**
 * glassFracture.ts — How a sheet comes apart: the crack pattern a broken pane
 * is cut into, in the pane's own face coordinates.
 * Owns: the fracture and nothing else — where the cracks run and what the
 * pieces between them are. It knows nothing about meshes, bodies, throwing or
 * drawing; `DebrisSystem` owns all four.
 * Invariants: pure arithmetic, no Babylon, and no state that outlives a call
 * but the scratch buffers. Every random draw comes from the caller's own
 * stream, because a burst may not be allowed to move a shared `Math.random`
 * on — see `DebrisSystem`'s seed.
 *
 * ## Glass does not break into squares
 *
 * This was a GRID. The face was divided into cells of `sqrt(area / shards)`
 * and a piece cut from each, so a window came apart into twelve rectangles of
 * one size, all square to the frame, in rows. Every other rule around it was
 * right — the pieces were cut to the pane, laid out on its face, thrown along
 * its normal — and the shatter still read as a mosaic sliding out of a wall,
 * because the one thing plate glass never does is fail on a grid.
 *
 * A sheet fails from the point the load went into it, in two families of crack
 * at once: RADIALS running out of the hole like spokes, and CONCENTRICS
 * crossing them in rings, closer together near the impact and further apart
 * toward the frame. What falls out is the pieces between them — wedges, narrow
 * at the hole and broad at the edge, each bounded by two cracks and two arcs,
 * no two the same size and none of them square to anything.
 *
 * So that is the whole of this file: `sectors` radials and `rings`
 * concentrics, both jittered, and the piece between each crossing.
 *
 * ## Four details, each of which is what makes it read
 *
 * **The corners are SHARED, so the pieces tile.** A piece's four corners are
 * points on a grid of (angle, radius) that its neighbours read too — one
 * jittered point, four pieces. Draw each piece its own corners instead and the
 * jitter that makes them irregular also opens gaps and overlaps between them,
 * which at t=0 is a heap rather than a pane with cracks in it. The one
 * deliberate departure is `pack`, which shrinks every piece about its own
 * centroid by the same fraction: that opens the cracks themselves, evenly,
 * which is what a sheet an instant after it fails looks like.
 *
 * **There is a hole in the middle.** The innermost ring starts at `HOLE` of
 * the pattern's reach rather than at the impact, so nothing is cut from the
 * few centimetres the round actually went through. That is the one part of a
 * real pane that leaves as dust, and a wedge with its apex at the crossing
 * point is both a sliver Havok would rather not be given and the piece the eye
 * expects to be missing.
 *
 * **The pattern is CLIPPED to the frame, not fitted to it.** The cracks are a
 * disc around the hole; the pane is a rectangle; the pieces that cross its
 * edge are cut off there. That is why a piece may have five corners or eight
 * rather than four, and it is what puts a straight edge — the mullion — down
 * the side of a burst near one. A piece clipped away to nothing is simply not
 * drawn: it was glass that was never in the pane. What the burst does about
 * the budget that leaves it short is REACH FURTHER, which is a re-cut and is
 * argued for in `fracture` itself.
 *
 * **Eight corners is exact, not generous.** A convex quad clipped against four
 * half-planes gains at most one corner per plane. `MAX_CORNERS` is that bound,
 * and `DebrisSystem` builds every shard mesh with exactly that many so a burst
 * rewrites vertices rather than rebuilding topology — a piece with fewer
 * corners repeats its last one, which collapses the spare triangles exactly as
 * `GlassSystem.collapse` collapses a broken pane's.
 */

/**
 * The most corners a piece can have: four from the wedge, one for each of the
 * frame's four edges it may cross. See the header — this is a bound rather
 * than a budget.
 */
export const MAX_CORNERS = 8;

/**
 * One piece of a broken sheet, in the pane's own face coordinates: `u` across
 * the face, `v` up it, both measured from the pane's centre.
 *
 * The corners are stored about the piece's OWN centre rather than the pane's,
 * because that centre is what the mesh is built around and what the body is
 * placed at. `hw`/`hh` are the piece's half extents about the same point,
 * which is what the collision box is cut to.
 */
export interface ShardPiece {
  /** Corners in use, 3..`MAX_CORNERS`, counter-clockwise. */
  n: number;
  /** Corner coordinates about the piece's centre. Only the first `n` are live. */
  x: Float64Array;
  y: Float64Array;
  /** The piece's centre, in the face's own coordinates. */
  u: number;
  v: number;
  /** Half extents about that centre. */
  hw: number;
  hh: number;
  /** The piece's own area, m² — what its mass is drawn from. */
  area: number;
}

/** Rings of concentric cracks, whatever the budget. Three is a lot of glass. */
const RING_CAP = 3;
/**
 * The unbroken hole at the impact: a fraction of the pattern's reach, held
 * between a bullet's own width and a fist. Scaled rather than fixed because a
 * cottage window's pattern is a third of a shopfront's and a fixed hole in it
 * would be most of the burst; capped at both ends because the hole is a real
 * thing of a real size and neither pane changes that.
 */
const HOLE = 0.14;
const HOLE_MIN = 0.03;
const HOLE_MAX = 0.22;
/** How far a radial crack wanders, as a fraction of one sector's width. */
const ANGLE_JITTER = 0.7;
/** How far a concentric crack wanders, as a fraction of its own radius. */
const RADIAL_JITTER = 0.45;
/** m². Under this a clipped piece is a splinter and is not drawn at all. */
const MIN_AREA = 0.004;
/** Metres. Corners closer than this to their neighbour are the same corner. */
const EPS = 1e-4;

const TAU = Math.PI * 2;

/**
 * The (angle, radius) grid the pieces read their corners off, as world-plane
 * points. Module scratch: `fracture` runs on the frame a window breaks, which
 * is the worst frame available to allocate on.
 */
let gridX = new Float64Array(0);
let gridY = new Float64Array(0);
/**
 * Two polygon buffers the clip ping-pongs between. Sized for the bound above
 * with room to spare: a clip pass may hand back one more corner than it was
 * given, and four passes over a quad end at eight.
 */
const polyA = new Float64Array(2 * (MAX_CORNERS + 4));
const polyB = new Float64Array(2 * (MAX_CORNERS + 4));

/** A burst's worth of pieces, allocated once and refilled by `fracture`. */
export function makePieces(count: number): ShardPiece[] {
  const out: ShardPiece[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      n: 0,
      x: new Float64Array(MAX_CORNERS),
      y: new Float64Array(MAX_CORNERS),
      u: 0,
      v: 0,
      hw: 0,
      hh: 0,
      area: 0,
    });
  }
  return out;
}

/**
 * Cracks a `faceW` x `faceH` sheet from a round that crossed it at (`hitU`,
 * `hitV`), and fills `pieces` with what comes out.
 *
 * `reach` is how far from the hole the pattern runs — the caller's budget
 * expressed as a radius, not a property of the sheet, which is why a pane much
 * larger than a burst loses the glass beyond it rather than spreading twelve
 * pieces over the lot. `pack` opens the cracks (see the header). `rand` is the
 * caller's stream, drawn from once per corner of the crack grid — and again
 * for a whole grid on each re-cut, which is why the stream is the seeded one
 * and never `Math.random`.
 *
 * Returns how many pieces were filled: at most `pieces.length`, fewer when the
 * pattern hangs off the edge of the sheet.
 */
export function fracture(
  pieces: ShardPiece[],
  faceW: number,
  faceH: number,
  hitU: number,
  hitV: number,
  reach: number,
  pack: number,
  rand: () => number,
): number {
  const budget = pieces.length;
  if (budget < 3 || reach <= 0) return 0;

  // As many rings as the budget affords a sector count worth having: twelve
  // pieces is six radials crossed by two rings, which is the spider a pane
  // actually makes. Rings first, because a burst of one ring is a rosette and
  // reads as a decal.
  const rings = Math.max(1, Math.min(RING_CAP, Math.round(Math.sqrt(budget / 3))));
  const sectors = Math.max(3, Math.floor(budget / rings));

  const hw = faceW / 2;
  const hh = faceH / 2;
  const hu = clamp(hitU, -hw, hw);
  const hv = clamp(hitV, -hh, hh);
  // Past the far corner there is no glass left to crack, whatever the budget.
  const span = Math.hypot(hw + Math.abs(hu), hh + Math.abs(hv));

  // **A pattern that hangs off the frame reaches FURTHER, rather than
  // spending its budget on pieces that were never in the pane.** A round
  // through the corner of a bay puts most of a centred disc outside the glass,
  // and the shards it clips away are gone from the burst — eight pieces over a
  // quarter of the sheet, where a round through the middle of the same pane
  // throws twelve over two thirds of it. Cracks do not stop because the sheet
  // is not centred on them: the energy runs along the glass that IS there. So
  // a short burst is re-cut with the reach it needed, twice at most, which is
  // enough to fill the budget from any point on any pane the maps hold.
  let out = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    out = cutPieces(pieces, hw, hh, hu, hv, reach, pack, rand, rings, sectors);
    if (out >= budget || reach >= span) break;
    reach = Math.min(reach * Math.min(1.7, Math.sqrt(budget / Math.max(out, 1))), span);
  }
  return out;
}

/**
 * One pass of the pattern at a given reach: the crack grid, then the piece
 * between each crossing. Returns how many survived the frame.
 */
function cutPieces(
  pieces: ShardPiece[],
  hw: number,
  hh: number,
  hu: number,
  hv: number,
  reach: number,
  pack: number,
  rand: () => number,
  rings: number,
  sectors: number,
): number {
  const budget = pieces.length;
  const corners = sectors * (rings + 1);
  if (gridX.length < corners) {
    gridX = new Float64Array(corners);
    gridY = new Float64Array(corners);
  }

  // The crack grid. An angle per radial, wandering by less than half a sector
  // so two radials can never cross; a radius per crossing, growing
  // geometrically out of the hole so the rings crowd the impact the way they
  // do in a real sheet, and wandering by less than the gap to the next one.
  const hole = clamp(reach * HOLE, HOLE_MIN, HOLE_MAX);
  const growth = Math.pow(Math.max(reach / hole, 1.2), 1 / rings);
  for (let i = 0; i < sectors; i++) {
    const a = ((i + (rand() - 0.5) * ANGLE_JITTER) * TAU) / sectors;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    let r = hole;
    for (let j = 0; j <= rings; j++) {
      const jitter = r * (1 + (rand() - 0.5) * RADIAL_JITTER);
      const k = j * sectors + i;
      gridX[k] = hu + ca * jitter;
      gridY[k] = hv + sa * jitter;
      r *= growth;
    }
  }

  // One piece per crossing, inner ring first, so a burst that runs out of
  // budget spends what it has on the glass nearest the hole.
  let out = 0;
  for (let j = 0; j < rings && out < budget; j++) {
    for (let i = 0; i < sectors && out < budget; i++) {
      const i2 = (i + 1) % sectors;
      const inner = j * sectors;
      const outer = (j + 1) * sectors;
      // Counter-clockwise: out along one radial, round the outer arc, back
      // down the next radial. `fill` and the mesh built from it both depend on
      // this winding — walk the inner arc first instead and every piece is
      // wound backwards, which is a negative area here and an inside-out
      // prism downstream.
      polyA[0] = gridX[inner + i];
      polyA[1] = gridY[inner + i];
      polyA[2] = gridX[outer + i];
      polyA[3] = gridY[outer + i];
      polyA[4] = gridX[outer + i2];
      polyA[5] = gridY[outer + i2];
      polyA[6] = gridX[inner + i2];
      polyA[7] = gridY[inner + i2];
      const n = clipToFace(4, hw, hh);
      if (n < 3) continue;
      if (fill(pieces[out], n, pack)) out++;
    }
  }
  return out;
}

/**
 * Clips `polyA` to the sheet's own rectangle, in place: four Sutherland-Hodgman
 * passes ping-ponging A -> B -> A -> B -> A, so an even number of them is what
 * leaves the answer back in `polyA`.
 */
function clipToFace(n: number, hw: number, hh: number): number {
  let m = clipHalf(polyA, n, polyB, -1, 0, hw);
  if (m < 3) return 0;
  m = clipHalf(polyB, m, polyA, 1, 0, hw);
  if (m < 3) return 0;
  m = clipHalf(polyA, m, polyB, 0, -1, hh);
  if (m < 3) return 0;
  m = clipHalf(polyB, m, polyA, 0, 1, hh);
  return m < 3 ? 0 : m;
}

/** One half-plane pass: keeps everything where `ax * x + ay * y + c >= 0`. */
function clipHalf(
  src: Float64Array,
  n: number,
  dst: Float64Array,
  ax: number,
  ay: number,
  c: number,
): number {
  let m = 0;
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1;
    const xi = src[i * 2];
    const yi = src[i * 2 + 1];
    const xj = src[j * 2];
    const yj = src[j * 2 + 1];
    const di = ax * xi + ay * yi + c;
    const dj = ax * xj + ay * yj + c;
    if (di >= 0) {
      dst[m * 2] = xi;
      dst[m * 2 + 1] = yi;
      m++;
    }
    if (di >= 0 !== dj >= 0) {
      const t = di / (di - dj);
      dst[m * 2] = xi + (xj - xi) * t;
      dst[m * 2 + 1] = yi + (yj - yi) * t;
      m++;
    }
  }
  return m;
}

/**
 * Measures the polygon standing in `polyA`, shrinks it by `pack` about its own
 * centroid and writes it into `piece`. False for a splinter, which the caller
 * reads as one fewer piece rather than as a failure.
 *
 * The centroid is the area-weighted one and not the corner average: a clipped
 * wedge carries corners that are metres apart on one side and centimetres on
 * the other, and shrinking about the average of those slides the piece out of
 * the hole it was cut from.
 */
function fill(piece: ShardPiece, n: number, pack: number): boolean {
  // Drop a corner that landed on its neighbour — a clip through an existing
  // corner emits both of them, and a zero-length edge is a side quad with no
  // area and a normal of nothing.
  let m = 0;
  for (let i = 0; i < n; i++) {
    const x = polyA[i * 2];
    const y = polyA[i * 2 + 1];
    const px = polyA[((i + n - 1) % n) * 2];
    const py = polyA[((i + n - 1) % n) * 2 + 1];
    if (Math.abs(x - px) < EPS && Math.abs(y - py) < EPS) continue;
    polyB[m * 2] = x;
    polyB[m * 2 + 1] = y;
    m++;
  }
  if (m < 3 || m > MAX_CORNERS) return false;

  let twice = 0;
  let cu = 0;
  let cv = 0;
  for (let i = 0; i < m; i++) {
    const j = i + 1 === m ? 0 : i + 1;
    const xi = polyB[i * 2];
    const yi = polyB[i * 2 + 1];
    const xj = polyB[j * 2];
    const yj = polyB[j * 2 + 1];
    const cross = xi * yj - xj * yi;
    twice += cross;
    cu += (xi + xj) * cross;
    cv += (yi + yj) * cross;
  }
  const area = twice / 2;
  if (area < MIN_AREA) return false;
  cu /= 3 * twice;
  cv /= 3 * twice;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < m; i++) {
    const x = cu + (polyB[i * 2] - cu) * pack;
    const y = cv + (polyB[i * 2 + 1] - cv) * pack;
    polyB[i * 2] = x;
    polyB[i * 2 + 1] = y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const ou = (minX + maxX) / 2;
  const ov = (minY + maxY) / 2;
  for (let i = 0; i < m; i++) {
    piece.x[i] = polyB[i * 2] - ou;
    piece.y[i] = polyB[i * 2 + 1] - ov;
  }
  piece.n = m;
  piece.u = ou;
  piece.v = ov;
  piece.hw = (maxX - minX) / 2;
  piece.hh = (maxY - minY) / 2;
  piece.area = area * pack * pack;
  return true;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
