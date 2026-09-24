/**
 * facet.ts — The faceted LOFT (a solid built by joining a stack of chamfered
 * rectangular cross-sections) and the bevelled SLAB (a side profile extruded
 * and chamfered — `extrude`), both shaded flat, for the parts of a model that
 * a box makes read as a toy.
 * Invariants: every face carries its own normal and its own vertices, so the
 * part shades in flat planes exactly as a `CreateBox` does and a `mergeByColor`
 * beside boxes cannot tell the two apart; positions, normals AND uvs are
 * emitted because `Mesh.MergeMeshes` refuses to merge vertex data whose
 * attribute sets differ, and every box carries uvs. Triangles are wound by the
 * face's OWN outward normal rather than by an assumed convention, so a ring
 * list authored in either order comes out right side out.
 * Never: smooth a normal across a facet (that is a continuous-tone surface in a
 * banded frame), or emit a zero-area face — a ring that collapses to a point is
 * handled, a ring that repeats its predecessor is the caller's mistake.
 *
 * **Why a loft rather than more boxes.** What reads as blocks is not the box
 * count but that every side is PARALLEL to its opposite: a thigh as wide at the
 * knee as at the hip, a chest as wide at the belt as at the shoulders, a helmet
 * that is a cube. The world this stands in is faceted rather than cubic — the
 * trees are lumped polyhedra, the pines are cones, the roofs are gables — and a
 * section that changes size up the part and has its corners cut is the
 * smallest step from a box that joins that vocabulary. It stays LOW-sided on
 * purpose: `CelInk` draws an edge wherever the normal bends, so every facet is
 * a potential pen line, and a round section at range is a scribble.
 */
import { Mesh, Scene, Vector3, VertexData } from "@babylonjs/core";

/**
 * One cross-section of a loft, in the part's own frame: a rectangle `w` by `d`
 * at height `y`, with its four corners cut back by `k` of each half-extent —
 * 0 is a plain rectangle (four sides), 0.5 is close to a regular octagon for a
 * square section. `x`/`z` offset the ring, which is how a part leans or bellies
 * forward without a rotation.
 */
export interface Ring {
  y: number;
  w: number;
  d: number;
  k?: number;
  x?: number;
  z?: number;
}

/** The ring's outline, anticlockwise seen from above; 4 points at k = 0, else 8. */
function outline(r: Ring): Vector3[] {
  const hw = r.w / 2;
  const hd = r.d / 2;
  const k = r.k ?? 0;
  const x = r.x ?? 0;
  const z = r.z ?? 0;
  const p = (px: number, pz: number) => new Vector3(x + px, r.y, z + pz);
  if (k <= 0) return [p(hw, -hd), p(hw, hd), p(-hw, hd), p(-hw, -hd)];
  const cw = hw * (1 - k);
  const cd = hd * (1 - k);
  return [
    p(hw, -cd),
    p(hw, cd),
    p(cw, hd),
    p(-cw, hd),
    p(-hw, cd),
    p(-hw, -cd),
    p(-cw, -hd),
    p(cw, -hd),
  ];
}

/**
 * Builds the loft through `rings`, bottom to top, closing each end that is not
 * already a point. Every ring must have the same side count — mixing `k = 0`
 * with `k > 0` in one loft is refused, because the side walls would have to
 * be re-triangulated and that is not what this primitive is for.
 */
export function loft(
  name: string,
  scene: Scene,
  rings: readonly Ring[],
  { capBottom = true, capTop = true } = {},
): Mesh {
  const loops = rings.map(outline);
  const sides = loops[0].length;
  if (loops.some((l) => l.length !== sides)) {
    throw new Error(`loft ${name}: every ring needs the same corner cut state`);
  }
  // A section's own centre, which is what "outward" is measured from — the
  // part is convex per band, so the band's midpoint is inside it.
  const centre = (l: Vector3[]) =>
    l.reduce((a, v) => a.addInPlace(v), Vector3.Zero()).scaleInPlace(1 / l.length);

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  /**
   * Emits one flat polygon (3 or 4 corners, in order around it) whose outward
   * side is the one facing away from `inside`. Babylon's front face is the one
   * `VertexData.ComputeNormals` points out of, `cross(a - b, c - b)`, so each
   * triangle is ordered to agree with the face normal found here.
   */
  const face = (corners: Vector3[], inside: Vector3): void => {
    const n = Vector3.Cross(
      corners[2].subtract(corners[0]),
      corners[corners.length - 1].subtract(corners[1]),
    );
    if (n.lengthSquared() < 1e-14) return;
    n.normalize();
    const mid = centre(corners.map((c) => c.clone()));
    if (Vector3.Dot(n, mid.subtract(inside)) < 0) n.scaleInPlace(-1);
    const base = positions.length / 3;
    for (const c of corners) {
      positions.push(c.x, c.y, c.z);
      normals.push(n.x, n.y, n.z);
      uvs.push(0, 0);
    }
    for (let t = 1; t + 1 < corners.length; t++) {
      const a = corners[0];
      const b = corners[t];
      const c = corners[t + 1];
      const wound = Vector3.Dot(Vector3.Cross(a.subtract(b), c.subtract(b)), n) > 0;
      if (wound) indices.push(base, base + t, base + t + 1);
      else indices.push(base, base + t + 1, base + t);
    }
  };

  for (let r = 0; r + 1 < loops.length; r++) {
    const lo = loops[r];
    const hi = loops[r + 1];
    const inside = centre(lo.map((v) => v.clone())).addInPlace(centre(hi.map((v) => v.clone()))).scaleInPlace(0.5);
    for (let s = 0; s < sides; s++) {
      const s1 = (s + 1) % sides;
      // A collapsed edge (an apex ring) leaves a triangle, not a sliver.
      const poly: Vector3[] = [];
      for (const v of [lo[s], lo[s1], hi[s1], hi[s]]) {
        if (!poly.length || !v.equalsWithEpsilon(poly[poly.length - 1], 1e-6)) poly.push(v);
      }
      if (poly.length > 1 && poly[poly.length - 1].equalsWithEpsilon(poly[0], 1e-6)) poly.pop();
      if (poly.length >= 3) face(poly, inside);
    }
  }
  const allInside = centre(loops.flat().map((v) => v.clone()));
  const isPoint = (l: Vector3[]) => l.every((v) => v.equalsWithEpsilon(l[0], 1e-6));
  if (capBottom && !isPoint(loops[0])) face(loops[0], allInside);
  const top = loops[loops.length - 1];
  if (capTop && !isPoint(top)) face(top, allInside);

  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = positions;
  data.normals = normals;
  data.uvs = uvs;
  data.indices = indices;
  data.applyToMesh(mesh);
  return mesh;
}

/**
 * One point of a side PROFILE: `[z, y]`, in the part's own frame — z along
 * the bore, y up. A profile is drawn the way a gun is drawn on paper, from
 * the side.
 */
export type ProfilePoint = readonly [z: number, y: number];

/**
 * A SLAB: a side profile extruded `width` across x, its long edges bevelled
 * back by `bevel` on both faces — the second faceted primitive, and the one a
 * WEAPON wants.
 *
 * **Why a profile rather than a loft.** A loft is a stack of rectangles, so a
 * part is only ever as interesting as the way its sections change size; a
 * weapon's character is its SILHOUETTE from the side — a stock that sweeps up
 * into a comb, a magwell that flares, a trigger guard that curls into the
 * grip — and that outline, not a section, is what a box cannot draw. The
 * profile may be CONCAVE (a guard is a U, a trigger a hook); it must be a
 * simple polygon and may be wound either way.
 *
 * **Why the bevel.** Two parallel faces meeting a third at a right angle is
 * the whole of what reads as a block. A 45-degree band down every long edge
 * gives the part a lit rim and gives `CelInk` a pair of fine crease strokes
 * inside the contour, which is how a draughtsman shows a chamfer — and it
 * costs one band of quads per edge. `bevel` must stay under half the thinnest
 * wall in the profile, or the inset outline folds through itself.
 *
 * Emitted exactly as `loft` is — flat normals, a vertex set per face, zero
 * uvs — so a slab merges beside boxes and lofts without either knowing.
 */
export function extrude(
  name: string,
  scene: Scene,
  profile: readonly ProfilePoint[],
  width: number,
  bevel = 0,
  x = 0,
): Mesh {
  // Anticlockwise in (z, y), so each edge's inward normal is its left one.
  let pts = profile.map(([z, y]) => ({ z, y }));
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area += a.z * b.y - b.z * a.y;
  }
  if (area < 0) pts = pts.reverse();
  const n = pts.length;

  // Each edge's unit inward normal, and the profile pushed in along them by
  // `bevel` — each vertex where its two offset edges cross.
  const inward = pts.map((a, i) => {
    const b = pts[(i + 1) % n];
    const dz = b.z - a.z;
    const dy = b.y - a.y;
    const len = Math.hypot(dz, dy);
    return { z: -dy / len, y: dz / len };
  });
  const inset = pts.map((p, i) => {
    if (bevel <= 0) return p;
    const n0 = inward[(i - 1 + n) % n];
    const n1 = inward[i];
    // The miter: the offset vertex is p + (n0 + n1) * bevel / (1 + n0 . n1).
    const dot = n0.z * n1.z + n0.y * n1.y;
    const s = bevel / Math.max(1 + dot, 1e-4);
    return { z: p.z + (n0.z + n1.z) * s, y: p.y + (n0.y + n1.y) * s };
  });

  const hw = width / 2;
  const wall = hw - Math.max(bevel, 0);
  const v = (px: number, p: { z: number; y: number }) => new Vector3(x + px, p.y, p.z);

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  /** One flat polygon, fanned, its normal turned to agree with `out`. */
  const face = (corners: Vector3[], out: Vector3, tris?: number[]): void => {
    let nrm = Vector3.Cross(
      corners[2].subtract(corners[0]),
      corners[corners.length - 1].subtract(corners[1]),
    );
    if (tris) nrm = out.clone();
    if (nrm.lengthSquared() < 1e-14) return;
    nrm.normalize();
    if (Vector3.Dot(nrm, out) < 0) nrm.scaleInPlace(-1);
    const base = positions.length / 3;
    for (const c of corners) {
      positions.push(c.x, c.y, c.z);
      normals.push(nrm.x, nrm.y, nrm.z);
      uvs.push(0, 0);
    }
    const list = tris ?? corners.slice(2).flatMap((_, t) => [0, t + 1, t + 2]);
    for (let t = 0; t < list.length; t += 3) {
      const [i0, i1, i2] = [list[t], list[t + 1], list[t + 2]];
      const a = corners[i0];
      const b = corners[i1];
      const c = corners[i2];
      const wound = Vector3.Dot(Vector3.Cross(a.subtract(b), c.subtract(b)), nrm) > 0;
      if (wound) indices.push(base + i0, base + i1, base + i2);
      else indices.push(base + i0, base + i2, base + i1);
    }
  };

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const out = new Vector3(0, -inward[i].y, -inward[i].z);
    face([v(-wall, pts[i]), v(-wall, pts[j]), v(wall, pts[j]), v(wall, pts[i])], out);
    if (bevel > 0) {
      for (const side of [-1, 1]) {
        const o = out.add(new Vector3(side, 0, 0));
        face(
          [v(side * wall, pts[i]), v(side * wall, pts[j]), v(side * hw, inset[j]), v(side * hw, inset[i])],
          o,
        );
      }
    }
  }
  const tris = earClip(inset);
  for (const side of [-1, 1]) {
    face(
      inset.map((p) => v(side * hw, p)),
      new Vector3(side, 0, 0),
      tris,
    );
  }

  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = positions;
  data.normals = normals;
  data.uvs = uvs;
  data.indices = indices;
  data.applyToMesh(mesh);
  return mesh;
}

/**
 * Triangulates a simple anticlockwise polygon by ear clipping — index
 * triples into `poly`. O(n^3) and meant for the dozen-point outlines a part is
 * drawn with, not for terrain.
 */
function earClip(poly: readonly { z: number; y: number }[]): number[] {
  const idx = poly.map((_, i) => i);
  const out: number[] = [];
  const cross = (a: number, b: number, c: number) =>
    (poly[b].z - poly[a].z) * (poly[c].y - poly[a].y) -
    (poly[b].y - poly[a].y) * (poly[c].z - poly[a].z);
  const inside = (p: number, a: number, b: number, c: number) =>
    cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  let guard = idx.length * idx.length;
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i - 1 + idx.length) % idx.length];
      const b = idx[i];
      const c = idx[(i + 1) % idx.length];
      if (cross(a, b, c) <= 1e-12) continue;
      if (idx.some((p) => p !== a && p !== b && p !== c && inside(p, a, b, c))) continue;
      out.push(a, b, c);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  return out;
}
