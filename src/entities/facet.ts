/**
 * facet.ts — The faceted LOFT: a solid built by joining a stack of chamfered
 * rectangular cross-sections, shaded flat, for the parts of a model that a box
 * makes read as a toy.
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
