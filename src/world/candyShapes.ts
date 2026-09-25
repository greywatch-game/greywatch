/**
 * candyShapes.ts — The four shapes a candy kit is made of that a box and a
 * cylinder are not: a surface of REVOLUTION (a gumdrop, a cupcake's frosting,
 * a scoop), a TUBE swept along a line with its stripes wound round it (a candy
 * cane), a bevelled PRISM of any outline (a conversation heart, a star of
 * leaves, a lollipop), and BLOCK LETTERS (the words on a heart and a sign).
 * Owns: vertex data and nothing else — no material, no mesh, no scene. A
 * builder hands what this returns to `Build.surface` (kit/candy.ts) or to
 * `partSurface` (Props.ts), which is what makes it a part.
 * Invariants: every triangle is wound by Babylon's OWN face-normal formula
 * against an outward hint, exactly as `kit/japan.ts`'s roof is, so no loop
 * order here can turn a shape inside out — a left-handed scene and a cross
 * product worked on paper disagree, and the failure is silent (TerrainField's
 * `assertFacesUp`). Every solid is CLOSED, because the world's shadow map
 * records back faces and every caster must be one (`docs/rendering.md`).
 * Deterministic: nothing here draws a random number; a builder that wants a
 * jittered shape passes the jitter in.
 */
import { VertexData } from "@babylonjs/core";

export type V3 = [number, number, number];

/**
 * Triangles collected with their winding decided per triangle, either FLAT
 * (every triangle its own three vertices, so `ComputeNormals` hands back face
 * normals and the cel bands break at every facet) or SMOOTH (vertices shared
 * by index, so a round thing shades round).
 */
export class CandyMesher {
  readonly positions: number[] = [];
  readonly indices: number[] = [];

  /** A shared vertex, for `triIdx`. */
  vertex(p: V3): number {
    this.positions.push(p[0], p[1], p[2]);
    return this.positions.length / 3 - 1;
  }

  /**
   * A triangle of shared vertices, flipped if Babylon's face normal —
   * `(a - b) x (c - b)` — points away from `outward`. Degenerate triangles are
   * dropped: they have no normal to give the shader.
   */
  triIdx(ia: number, ib: number, ic: number, outward: V3): void {
    const P = this.positions;
    const ux = P[ia * 3] - P[ib * 3];
    const uy = P[ia * 3 + 1] - P[ib * 3 + 1];
    const uz = P[ia * 3 + 2] - P[ib * 3 + 2];
    const vx = P[ic * 3] - P[ib * 3];
    const vy = P[ic * 3 + 1] - P[ib * 3 + 1];
    const vz = P[ic * 3 + 2] - P[ib * 3 + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < 1e-14) return;
    if (nx * outward[0] + ny * outward[1] + nz * outward[2] < 0) {
      this.indices.push(ia, ic, ib);
    } else {
      this.indices.push(ia, ib, ic);
    }
  }

  /** A flat triangle: three vertices of its own. */
  tri(a: V3, b: V3, c: V3, outward: V3): void {
    this.triIdx(this.vertex(a), this.vertex(b), this.vertex(c), outward);
  }

  quad(a: V3, b: V3, c: V3, d: V3, outward: V3): void {
    this.tri(a, b, c, outward);
    this.tri(a, c, d, outward);
  }

  data(): VertexData {
    const data = new VertexData();
    data.positions = this.positions;
    data.indices = this.indices;
    const uvs: number[] = [];
    for (let i = 0; i < this.positions.length; i += 3) {
      uvs.push(this.positions[i], this.positions[i + 2]);
    }
    data.uvs = uvs;
    const normals: number[] = [];
    VertexData.ComputeNormals(this.positions, this.indices, normals);
    data.normals = normals;
    return data;
  }
}

/**
 * A surface of revolution about Y: `profile` is `[radius, y]` from the bottom
 * up, swept `seg` times round. A profile that starts or ends off the axis is
 * closed with a flat cap there, on vertices of its own so the rim stays a
 * crisp band rather than a smear.
 *
 * `flutes` ridges the side — a gumdrop's moulding, a cupcake case's pleats —
 * as a cosine on the radius, `fluteDepth` of it, fading out over the top
 * third so a gumdrop's crown is round.
 */
export function revolve(
  profile: readonly (readonly [number, number])[],
  seg: number,
  opts: { flutes?: number; fluteDepth?: number; fluteFade?: boolean } = {},
): VertexData {
  const m = new CandyMesher();
  const flutes = opts.flutes ?? 0;
  const depth = opts.fluteDepth ?? 0;
  const yMin = profile[0][1];
  const yMax = profile[profile.length - 1][1];
  const ring = (k: number): number[] => {
    const [r0, y] = profile[k];
    const t = yMax > yMin ? (y - yMin) / (yMax - yMin) : 0;
    const fade = opts.fluteFade === false ? 1 : Math.max(0, Math.min(1, (1 - t) / 0.35));
    const out: number[] = [];
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const r = r0 * (1 + (flutes ? depth * fade * Math.cos(a * flutes) : 0));
      out.push(m.vertex([Math.cos(a) * r, y, Math.sin(a) * r]));
    }
    return out;
  };
  const rings = profile.map((_, k) => ring(k));
  for (let k = 0; k + 1 < profile.length; k++) {
    const dr = profile[k + 1][0] - profile[k][0];
    const dy = profile[k + 1][1] - profile[k][1];
    for (let j = 0; j < seg; j++) {
      const n = (j + 1) % seg;
      const a = ((j + 0.5) / seg) * Math.PI * 2;
      const out: V3 = [Math.cos(a) * dy, -dr, Math.sin(a) * dy];
      m.triIdx(rings[k][j], rings[k][n], rings[k + 1][n], out);
      m.triIdx(rings[k][j], rings[k + 1][n], rings[k + 1][j], out);
    }
  }
  const cap = (k: number, up: 1 | -1): void => {
    const [r, y] = profile[k];
    if (r < 1e-4) return;
    const centre = m.vertex([0, y, 0]);
    const edge: number[] = [];
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      edge.push(m.vertex([Math.cos(a) * r, y, Math.sin(a) * r]));
    }
    for (let j = 0; j < seg; j++) {
      m.triIdx(centre, edge[j], edge[(j + 1) % seg], [0, up, 0]);
    }
  };
  cap(0, -1);
  cap(profile.length - 1, 1);
  return m.data();
}

/**
 * A tube swept along `path` — a candy cane — with its stripes WOUND round it.
 *
 * The rings are TWISTED along the line (`twist` turns a metre), so a column of
 * quads is a helix, and a stripe is a set of whole columns: `bands` stripes
 * round the circumference, alternating between the two meshes returned. That
 * is what keeps the edge of a stripe a clean spiral rather than a staircase of
 * quads, and it costs nothing — the twist is where the vertices go, not how
 * many there are. Each end is closed with a flat cap in the first colour.
 *
 * Frames are carried along the line by parallel transport, so a bend (the
 * cane's hook) does not spin the stripes round it.
 */
export function stripedTube(
  path: readonly V3[],
  radius: number,
  opts: { seg?: number; bands?: number; twist?: number } = {},
): [VertexData, VertexData] {
  const seg = opts.seg ?? 16;
  const bands = opts.bands ?? 4;
  const twist = opts.twist ?? 1.2;
  const a = new CandyMesher();
  const b = new CandyMesher();
  const n = path.length;
  // Tangents, arc length, and a transported normal.
  const tan: V3[] = [];
  const s: number[] = [0];
  for (let i = 0; i < n; i++) {
    const p = path[Math.max(0, i - 1)];
    const q = path[Math.min(n - 1, i + 1)];
    tan.push(norm([q[0] - p[0], q[1] - p[1], q[2] - p[2]]));
    if (i > 0) s.push(s[i - 1] + dist(path[i], path[i - 1]));
  }
  let nrm: V3 = Math.abs(tan[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  nrm = norm(cross(cross(tan[0], nrm), tan[0]));
  const frames: { n: V3; b: V3 }[] = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      // Project the last normal off the new tangent.
      const d = dot(nrm, tan[i]);
      nrm = norm([nrm[0] - tan[i][0] * d, nrm[1] - tan[i][1] * d, nrm[2] - tan[i][2] * d]);
    }
    frames.push({ n: nrm, b: cross(tan[i], nrm) });
  }
  const point = (i: number, j: number): V3 => {
    const ang = (j / seg) * Math.PI * 2 + s[i] * twist;
    const c = Math.cos(ang) * radius;
    const sn = Math.sin(ang) * radius;
    const f = frames[i];
    return [
      path[i][0] + f.n[0] * c + f.b[0] * sn,
      path[i][1] + f.n[1] * c + f.b[1] * sn,
      path[i][2] + f.n[2] * c + f.b[2] * sn,
    ];
  };
  const per = seg / (bands * 2);
  for (const [mesh, parity] of [[a, 0], [b, 1]] as const) {
    // One ring of shared vertices per mesh, so a stripe shades round.
    const idx: number[][] = [];
    for (let i = 0; i < n; i++) {
      const row: number[] = [];
      for (let j = 0; j < seg; j++) row.push(mesh.vertex(point(i, j)));
      idx.push(row);
    }
    for (let i = 0; i + 1 < n; i++) {
      for (let j = 0; j < seg; j++) {
        if (Math.floor(j / per) % 2 !== parity) continue;
        const k = (j + 1) % seg;
        const pa = point(i, j);
        const centre = path[i];
        const out: V3 = [pa[0] - centre[0], pa[1] - centre[1], pa[2] - centre[2]];
        mesh.triIdx(idx[i][j], idx[i][k], idx[i + 1][k], out);
        mesh.triIdx(idx[i][j], idx[i + 1][k], idx[i + 1][j], out);
      }
    }
  }
  // End caps, in the first colour.
  for (const [i, sign] of [[0, -1], [n - 1, 1]] as const) {
    const out: V3 = [tan[i][0] * sign, tan[i][1] * sign, tan[i][2] * sign];
    const centre = a.vertex(path[i]);
    const edge: number[] = [];
    for (let j = 0; j < seg; j++) edge.push(a.vertex(point(i, j)));
    for (let j = 0; j < seg; j++) a.triIdx(centre, edge[j], edge[(j + 1) % seg], out);
  }
  return [a.data(), b.data()];
}

/**
 * The centreline of a candy cane standing on local zero: a straight shaft up
 * to `height - hook`, and a half-turn of radius `hook` over toward +X and a
 * little way down again. `step` metres a point.
 */
export function canePath(height: number, hook: number, step = 0.12): V3[] {
  const out: V3[] = [];
  const shaft = height - hook;
  const nShaft = Math.max(2, Math.ceil(shaft / step));
  for (let i = 0; i <= nShaft; i++) out.push([0, (shaft * i) / nShaft, 0]);
  const nArc = Math.max(6, Math.ceil((Math.PI * hook) / step));
  for (let i = 1; i <= nArc; i++) {
    const a = (i / nArc) * Math.PI;
    out.push([hook - Math.cos(a) * hook, shaft + Math.sin(a) * hook, 0]);
  }
  // The hook's tail, hanging a little.
  const tail = hook * 0.5;
  const nTail = Math.max(1, Math.ceil(tail / step));
  for (let i = 1; i <= nTail; i++) out.push([hook * 2, shaft - (tail * i) / nTail, 0]);
  return out;
}

/**
 * A prism of any outline that is STAR-SHAPED about `centre` — a heart, a star,
 * an oval — lying in XZ from `y0` to `y1`, its top and bottom edges bevelled
 * by `bevel` so it reads as a moulded sweet rather than a cut board. Flat
 * shaded: the bevel is a band the cel light breaks across on its own.
 *
 * `outline` is anticlockwise seen from above; the winding does not depend on
 * it (every triangle is checked), but the bevel's inset does.
 */
export function prism(
  outline: readonly (readonly [number, number])[],
  y0: number,
  y1: number,
  bevel = 0,
  centre: readonly [number, number] = [0, 0],
): VertexData {
  const m = new CandyMesher();
  const n = outline.length;
  const [cx, cz] = centre;
  // An inset copy of the outline, toward the centre, for the bevel.
  const inset = outline.map(([x, z]): [number, number] => {
    const dx = x - cx;
    const dz = z - cz;
    const l = Math.hypot(dx, dz);
    const f = l > 1e-6 ? Math.max(0, (l - bevel) / l) : 0;
    return [cx + dx * f, cz + dz * f];
  });
  const b = Math.min(bevel, (y1 - y0) / 2.2);
  const lo = y0 + b;
  const hi = y1 - b;
  for (let k = 0; k < n; k++) {
    const q = (k + 1) % n;
    const [ax, az] = outline[k];
    const [bx, bz] = outline[q];
    const ox = (ax + bx) / 2 - cx;
    const oz = (az + bz) / 2 - cz;
    const side: V3 = [ox, 0, oz];
    m.quad([ax, lo, az], [bx, lo, bz], [bx, hi, bz], [ax, hi, az], side);
    if (b > 0) {
      const [ix, iz] = inset[k];
      const [jx, jz] = inset[q];
      m.quad([ax, hi, az], [bx, hi, bz], [jx, y1, jz], [ix, y1, iz], [ox, 1, oz]);
      m.quad([ax, lo, az], [bx, lo, bz], [jx, y0, jz], [ix, y0, iz], [ox, -1, oz]);
    }
    const top = b > 0 ? inset : outline;
    m.tri([cx, y1, cz], [top[k][0], y1, top[k][1]], [top[q][0], y1, top[q][1]], [0, 1, 0]);
    m.tri([cx, y0, cz], [top[k][0], y0, top[k][1]], [top[q][0], y0, top[q][1]], [0, -1, 0]);
  }
  return m.data();
}

/**
 * A heart's outline, `w` across, anticlockwise seen from above, its point at
 * -Z and its notch at +Z — the classic parametric heart, normalised. The
 * returned centre is a point it is star-shaped about, for `prism`.
 */
export function heartOutline(w: number, n = 40): { pts: [number, number][]; centre: [number, number] } {
  const raw: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const z = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    raw.push([x, z]);
  }
  const k = w / 32;
  const pts = raw.map(([x, z]): [number, number] => [x * k, z * k]);
  // Parametric t runs clockwise seen from above in this frame; reverse it.
  pts.reverse();
  return { pts, centre: [0, 1.5 * k] };
}

/** A star's outline: `points` tips at `outer`, notches at `inner`. */
export function starOutline(points: number, outer: number, inner: number, phase = 0): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = phase + (i / (points * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? outer : inner;
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}

/** An ellipse's outline, `rx` by `rz`. */
export function ovalOutline(rx: number, rz: number, n = 28): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([Math.cos(a) * rx, Math.sin(a) * rz]);
  }
  return out;
}

// --- block letters -------------------------------------------------------------

/**
 * A five-by-five block face, a row per string, top row first. Letters a sign
 * or a sweet says and nothing else; an unknown character is a space.
 */
const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  A: [".###.", "#...#", "#####", "#...#", "#...#"],
  B: ["####.", "#...#", "####.", "#...#", "####."],
  C: [".####", "#....", "#....", "#....", ".####"],
  D: ["####.", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "####.", "#....", "#####"],
  F: ["#####", "#....", "####.", "#....", "#...."],
  G: [".####", "#....", "#..##", "#...#", ".###."],
  H: ["#...#", "#...#", "#####", "#...#", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "#####"],
  J: ["..###", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "###..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "####.", "#....", "#...."],
  Q: [".###.", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "####.", "#..#.", "#...#"],
  S: [".####", "#....", ".###.", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", ".#.#.", "..#..", ".#.#.", "#...#"],
  Y: ["#...#", ".#.#.", "..#..", "..#..", "..#.."],
  Z: ["#####", "...#.", "..#..", ".#...", "#####"],
  "0": [".###.", "#..##", "#.#.#", "##..#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", ".###."],
  "2": ["####.", "....#", ".###.", "#....", "#####"],
  "3": ["####.", "....#", ".###.", "....#", "####."],
  "4": ["#..#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "####."],
  "6": [".###.", "#....", "####.", "#...#", ".###."],
  "7": ["#####", "...#.", "..#..", ".#...", ".#..."],
  "8": [".###.", "#...#", ".###.", "#...#", ".###."],
  "9": [".###.", "#...#", ".####", "....#", ".###."],
  "!": ["..#..", "..#..", "..#..", ".....", "..#.."],
  "<": ["...#.", "..#..", ".#...", "..#..", "...#."],
  "3h": [".#.#.", "#####", "#####", ".###.", "..#.."],
};

/** One run of lit pixels in a line of block text, in PIXELS from its top-left. */
export interface GlyphRun {
  /** Column of the run's first pixel. */
  x: number;
  /** Row, 0 at the top. */
  y: number;
  /** Pixels long. */
  w: number;
}

/**
 * A line of block text as horizontal runs, so a letter is a handful of boxes
 * rather than a box a pixel. `♥` is a heart. A letter is five pixels wide
 * with one between, so a line of `n` characters is `6n - 1` across.
 */
export function blockText(text: string): { runs: GlyphRun[]; width: number } {
  const runs: GlyphRun[] = [];
  const chars = [...text.toUpperCase()];
  chars.forEach((ch, i) => {
    const g = GLYPHS[ch === "♥" ? "3h" : ch];
    if (!g) return;
    for (let y = 0; y < 5; y++) {
      const row = g[y];
      let x = 0;
      while (x < 5) {
        if (row[x] !== "#") {
          x++;
          continue;
        }
        let w = 1;
        while (x + w < 5 && row[x + w] === "#") w++;
        runs.push({ x: i * 6 + x, y, w });
        x += w;
      }
    }
  });
  return { runs, width: Math.max(0, chars.length * 6 - 1) };
}

// --- small vector arithmetic -----------------------------------------------------

function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(a: V3): V3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
function dist(a: V3, b: V3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
