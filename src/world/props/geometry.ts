/**
 * props/geometry.ts — The shapes more than one scatter prop is built
 * from: `tri`, the `V3` arithmetic, the `Sheet` a fine leaf is laid on,
 * a rachis's frames, `prism` (a solid cut from an outline), `loft` (a round
 * member through a run of rings) and the cached `geodesic` sphere.
 * Part of the scatter set: follows the contract in `./index.ts`.
 * Invariants: pure geometry — never makes a material, never draws from a
 * stream, and never imports a prop.
 */
import { Mesh, Scene, VertexData } from "@babylonjs/core";
import { partSurface } from "../parts";

/** A point in a part's own plane — see `prism`. */
export type Flat = readonly [number, number];

/** One cross-section of a `loft`: its centre and its radius. */
export interface Ring {
  x: number;
  y: number;
  z: number;
  r: number;
}

/**
 * One triangle, wound the way Babylon draws a FRONT face: the one whose
 * `(b - a) x (c - a)` points INTO the solid, which is the box's own convention
 * and `convexSolid`'s. Asked of the normal rather than assumed, so no caller
 * has to know which way round its outline runs.
 */
export function tri(
  indices: number[],
  p: readonly number[],
  a: number,
  b: number,
  c: number,
  n: readonly number[],
): void {
  const ux = p[b * 3] - p[a * 3];
  const uy = p[b * 3 + 1] - p[a * 3 + 1];
  const uz = p[b * 3 + 2] - p[a * 3 + 2];
  const vx = p[c * 3] - p[a * 3];
  const vy = p[c * 3 + 1] - p[a * 3 + 1];
  const vz = p[c * 3 + 2] - p[a * 3 + 2];
  const cross =
    (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
  if (cross > 0) indices.push(a, c, b);
  else indices.push(a, b, c);
}

/** A point or a direction in a part's own frame — see `Sheet`. */
export type V3 = readonly [number, number, number];
export const v3add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
export const v3cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const v3unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const v3dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const v3lerp = (p: V3, q: V3, u: number): V3 => [
  p[0] + (q[0] - p[0]) * u,
  p[1] + (q[1] - p[1]) * u,
  p[2] + (q[2] - p[2]) * u,
];

/**
 * A surface laid vertex by vertex, for a builder whose leaf is too fine to be
 * a part per piece — the fern's fronds, the jungle tree's pinnae. One sheet
 * per colour, merged into one part at the end (`sheetData`), so a crown of
 * three hundred leaflets costs the merge two meshes rather than three hundred.
 */
export interface Sheet {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}
export const newSheet = (): Sheet => ({ positions: [], normals: [], uvs: [], indices: [] });
/**
 * A vertex at `p` facing `n` (normalised here); returns its index. `uv` is a
 * sway RIG (`swayRig`) for a sheet on a rigged layer, and filler otherwise.
 */
export function sheetVert(s: Sheet, p: V3, n: V3, uv?: readonly [number, number]): number {
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  s.positions.push(p[0], p[1], p[2]);
  s.normals.push(n[0] / l, n[1] / l, n[2] / l);
  if (uv) s.uvs.push(uv[0], uv[1]);
  else s.uvs.push(p[0], p[1] + p[2]);
  return s.positions.length / 3 - 1;
}
/** A triangle, wound off its first vertex's normal (see `tri`). */
export function sheetFace(s: Sheet, a: number, b: number, c: number): void {
  tri(s.indices, s.positions, a, b, c, s.normals.slice(a * 3, a * 3 + 3));
}
export function sheetData(s: Sheet): VertexData {
  const data = new VertexData();
  data.positions = s.positions;
  data.normals = s.normals;
  data.uvs = s.uvs;
  data.indices = s.indices;
  return data;
}

/** One station of a rachis: along it, across the blade, and out of its face. */
export interface RachisFrame {
  t: V3;
  side: V3;
  up: V3;
}

/**
 * The frames of a rachis heading out on bearing `a`: across the blade is
 * level, rolled by `roll` so one half of the frond faces up more than the
 * other. The fern's fronds and the jungle palm's.
 */
export function rachisFrames(pts: readonly V3[], a: number, roll: number): RachisFrame[] {
  const S = pts.length - 1;
  const flat: V3 = [Math.cos(a), 0, -Math.sin(a)];
  return pts.map((_, i) => {
    const t = v3unit(v3add(pts[Math.min(S, i + 1)], pts[Math.max(0, i - 1)], -1));
    const side = v3unit(v3add(v3add([0, 0, 0], flat, Math.cos(roll)), v3cross(t, flat), Math.sin(roll)));
    return { t, side, up: v3unit(v3cross(t, side)) };
  });
}

/** A point `f` of the way along a rachis, and its frame. */
export function rachisAt(pts: readonly V3[], frames: readonly RachisFrame[], f: number): RachisFrame & { p: V3 } {
  const S = pts.length - 1;
  const x = Math.min(S - 1e-6, f * S);
  const i = Math.floor(x);
  const u = x - i;
  const A = frames[i];
  const B = frames[i + 1];
  return {
    p: v3lerp(pts[i], pts[i + 1], u),
    t: v3unit(v3lerp(A.t, B.t, u)),
    side: v3unit(v3lerp(A.side, B.side, u)),
    up: v3unit(v3lerp(A.up, B.up, u)),
  };
}

/**
 * A flat-sided solid cut from an OUTLINE — a leaf, a frond, a buttress — at a
 * box's price or near it. `outline` lies in the part's own XY plane, stood
 * `thick` deep along Z, or with `plane: "xz"` in its XZ plane, `thick` deep
 * along Y (a leaf plate lies flat, a buttress stands up). `thick` may be one
 * number or one per outline point, so a fin can thin toward its tail.
 *
 * Every face is flat-shaded, which is what lets the bands and the ink find its
 * edges exactly as they find a box's; the point of it is the OUTLINE, which a
 * box can only ever draw as a rectangle. A four-point outline costs exactly
 * the box's 24 vertices. `skip` leaves out the side faces nothing can see — an
 * edge buried in the ground or inside the bole — by the index of the point
 * each starts at. The caps are fanned from the first point, which needs the
 * outline to be star-shaped about it, or from the centroid with `centre`.
 */
export function prism(
  name: string,
  outline: readonly Flat[],
  thick: number | readonly number[],
  scene: Scene,
  opts: { plane?: "xy" | "xz"; centre?: boolean; skip?: readonly number[] } = {},
): Mesh {
  return partSurface(name, prismData(outline, thick, opts), scene);
}

/**
 * `prism`'s geometry without the mesh, for a builder that merges many of them
 * into one part itself (see `buildDeadTree`).
 */
export function prismData(
  outline: readonly Flat[],
  thick: number | readonly number[],
  opts: { plane?: "xy" | "xz"; centre?: boolean; skip?: readonly number[] } = {},
): VertexData {
  const n = outline.length;
  const at = (u: number, v: number, w: number): number[] =>
    opts.plane === "xz" ? [u, w, v] : [u, v, w];
  const half = (i: number) => (typeof thick === "number" ? thick : thick[i]) / 2;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const vert = (p: readonly number[], nrm: readonly number[]): number => {
    positions.push(p[0], p[1], p[2]);
    normals.push(nrm[0], nrm[1], nrm[2]);
    uvs.push(p[0], p[1] + p[2]);
    return positions.length / 3 - 1;
  };
  let cu = 0;
  let cv = 0;
  let ch = 0;
  for (let i = 0; i < n; i++) {
    cu += outline[i][0] / n;
    cv += outline[i][1] / n;
    ch += half(i) / n;
  }
  for (const side of [1, -1]) {
    const nrm = at(0, 0, side);
    const first = positions.length / 3;
    for (let i = 0; i < n; i++) vert(at(outline[i][0], outline[i][1], side * half(i)), nrm);
    if (opts.centre) {
      const c = vert(at(cu, cv, side * ch), nrm);
      for (let i = 0; i < n; i++) tri(indices, positions, c, first + i, first + ((i + 1) % n), nrm);
    } else {
      for (let i = 1; i + 1 < n; i++) tri(indices, positions, first, first + i, first + i + 1, nrm);
    }
  }
  const skip = new Set(opts.skip ?? []);
  for (let i = 0; i < n; i++) {
    if (skip.has(i)) continue;
    const j = (i + 1) % n;
    const [ui, vi] = outline[i];
    const [uj, vj] = outline[j];
    // Square to the edge in the outline's plane, and away from its middle.
    let nu = vj - vi;
    let nv = ui - uj;
    if (nu * ((ui + uj) / 2 - cu) + nv * ((vi + vj) / 2 - cv) < 0) {
      nu = -nu;
      nv = -nv;
    }
    const len = Math.hypot(nu, nv) || 1;
    const nrm = at(nu / len, nv / len, 0);
    const q = [
      vert(at(ui, vi, half(i)), nrm),
      vert(at(uj, vj, half(j)), nrm),
      vert(at(uj, vj, -half(j)), nrm),
      vert(at(ui, vi, -half(i)), nrm),
    ];
    tri(indices, positions, q[0], q[1], q[2], nrm);
    tri(indices, positions, q[0], q[2], q[3], nrm);
  }
  const data = new VertexData();
  data.positions = positions;
  data.normals = normals;
  data.uvs = uvs;
  data.indices = indices;
  return data;
}

/**
 * A round member through a run of `rings` — a bole that wanders, a limb that
 * arches, a vine that winds — smooth round its girth like the cylinders it
 * replaces, and open at both ends, because every caller buries both.
 *
 * The cross-section is carried ring to ring (each ring's first axis is the
 * last one's, squared to the new tangent) so a bend does not twist the mesh.
 * `flute` is a radius scale per SIDE rather than per vertex, the same at every
 * ring: an irregular section held the whole height reads as the ridged,
 * fluted bole of a rainforest hardwood, where noise per vertex reads as a
 * crumpled can.
 */
export function loft(
  name: string,
  rings: readonly Ring[],
  sides: number,
  scene: Scene,
  flute?: readonly number[],
): Mesh {
  return partSurface(name, loftData(rings, sides, flute), scene);
}

/** `loft`'s geometry without the mesh — `prismData`'s twin. */
export function loftData(rings: readonly Ring[], sides: number, flute?: readonly number[]): VertexData {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let ux = 0;
  let uy = 0;
  let uz = 0;
  let run = 0;
  for (let i = 0; i < rings.length; i++) {
    const ring = rings[i];
    const a = rings[Math.max(0, i - 1)];
    const b = rings[Math.min(rings.length - 1, i + 1)];
    let tx = b.x - a.x;
    let ty = b.y - a.y;
    let tz = b.z - a.z;
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    if (i === 0) {
      // Any axis square to the first tangent: up × t, or X × t for a member
      // that starts out vertical.
      const [rx, ry, rz] = Math.abs(ty) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      ux = ry * tz - rz * ty;
      uy = rz * tx - rx * tz;
      uz = rx * ty - ry * tx;
    } else {
      run += Math.hypot(ring.x - a.x, ring.y - a.y, ring.z - a.z);
    }
    const d = ux * tx + uy * ty + uz * tz;
    ux -= tx * d;
    uy -= ty * d;
    uz -= tz * d;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul;
    uy /= ul;
    uz /= ul;
    const vx = ty * uz - tz * uy;
    const vy = tz * ux - tx * uz;
    const vz = tx * uy - ty * ux;
    for (let j = 0; j <= sides; j++) {
      const th = (j / sides) * Math.PI * 2;
      const c = Math.cos(th);
      const s = Math.sin(th);
      const nx = c * ux + s * vx;
      const ny = c * uy + s * vy;
      const nz = c * uz + s * vz;
      const r = ring.r * (1 + (flute?.[j % sides] ?? 0));
      positions.push(ring.x + nx * r, ring.y + ny * r, ring.z + nz * r);
      normals.push(nx, ny, nz);
      uvs.push(j / sides, run);
    }
  }
  const row = sides + 1;
  for (let i = 0; i + 1 < rings.length; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * row + j;
      const b = a + row;
      const na = normals.slice(a * 3, a * 3 + 3);
      tri(indices, positions, a, b, a + 1, na);
      tri(indices, positions, a + 1, b, b + 1, na);
    }
  }
  const data = new VertexData();
  data.positions = positions;
  data.normals = normals;
  data.uvs = uvs;
  data.indices = indices;
  return data;
}

/** Unit geodesic spheres by subdivision level, built once and shared. */
const GEODESICS: { pts: number[][]; faces: number[][] }[] = [];

/**
 * An icosahedron subdivided `level` times, pushed out onto the unit sphere.
 * Pure and cached: every boulder on a map is drawn over the same lattice, and
 * nothing of it survives but the directions.
 */
export function geodesic(level: number): { pts: number[][]; faces: number[][] } {
  const hit = GEODESICS[level];
  if (hit) return hit;
  const t = (1 + Math.sqrt(5)) / 2;
  const pts: number[][] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map(([x, y, z]) => {
    const l = Math.hypot(x, y, z);
    return [x / l, y / l, z / l];
  });
  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let l = 0; l < level; l++) {
    const mid = new Map<string, number>();
    const half = (a: number, b: number): number => {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const known = mid.get(key);
      if (known !== undefined) return known;
      const x = pts[a][0] + pts[b][0];
      const y = pts[a][1] + pts[b][1];
      const z = pts[a][2] + pts[b][2];
      const len = Math.hypot(x, y, z);
      pts.push([x / len, y / len, z / len]);
      mid.set(key, pts.length - 1);
      return pts.length - 1;
    };
    const next: number[][] = [];
    for (const [a, b, c] of faces) {
      const ab = half(a, b);
      const bc = half(b, c);
      const ca = half(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  GEODESICS[level] = { pts, faces };
  return GEODESICS[level];
}
