/**
 * cloudMasses.ts — The SHAPE of the sky's clouds: a ring of faceted cloud
 * banks, each a long, flat-bottomed row of flattened icosphere lumps with a
 * thinner tier slid along its top and a tail off one end, handed back as one
 * triangle soup carrying each facet's normal and its lump's smooth one. Pure arithmetic — no Babylon, no state, no
 * random source of its own — which is `glassFracture.ts`'s shape, and for its
 * reason: the only thing a reader needs to trust about it is its output.
 * Owns: where each cloud stands on the ring, how it is piled, and which way
 * every facet faces. Owns no colour, no light and no drift — `Sky` and
 * `shaders/CloudShader.ts` are those.
 * Invariants: every triangle's winding and its stored normal agree and point
 * OUT of the lump it came from, and its smooth normals ride with its corners
 * through any re-winding; a degenerate facet is dropped rather than
 * emitted with a NaN normal;
 * nothing is placed with its base under `minElevation`, which is the dome's own
 * contract with the valley rim.
 *
 * **WHY GEOMETRY, AND NOT THE NOISE DECKS THIS REPLACED.** The sky used to carry
 * two sphere shells of thresholded fBm, widened on purpose so a magnified alpha
 * contour would not come out as torn paper. What that bought was a soft,
 * continuous-tone smear — exactly the one register this game does not draw in —
 * and a "lit side" that had to be a second additive shell with a per-vertex
 * mask, because a texture has no facets to turn toward the light. A pile of
 * lumps HAS facets, so the light is asked of the shape itself, banded like
 * every wall in the village, and the silhouette is a hard edge the geometry
 * draws rather than a ramp a texture approximates.
 *
 * **A flat BASE per cloud, not per lump.** Every lump is pressed toward the
 * cloud's own base plane after it is built, which is what turns a heap of
 * balls into a cloud: a real cumulus sits on its condensation level, and the
 * flat belly is the single strongest cue that a shape in the sky is a cloud and
 * not a rock. `BELLY_SQUASH` says why it is a press and not a cut.
 */

/** How a ring of clouds is laid out. Every angle is in RADIANS. */
export interface CloudRingOptions {
  /** How many clouds on the ring. */
  count: number;
  /** Distance from the eye to a cloud's base centre. */
  radius: number;
  /** Lowest a cloud's BASE may sit, above the horizon. */
  minElevation: number;
  /** Highest a cloud's base may sit. */
  maxElevation: number;
  /** Bias toward the horizon: 1 is uniform, higher piles clouds low. */
  elevationBias: number;
  /** Angular width of the narrowest and widest cloud. */
  minWidth: number;
  maxWidth: number;
  /** Height as a fraction of width, low and high. */
  minFlatness: number;
  maxFlatness: number;
  /** Depth (along the line of sight) as a fraction of width. */
  depth: number;
  /** Lumps in the base row of a cloud, low and high. */
  minLumps: number;
  maxLumps: number;
  /** Radial jitter on every lump vertex, as a fraction of its radius. */
  jitter: number;
}

/**
 * A flat-shaded triangle soup — three positions and one shared normal per
 * corner — plus where each LUMP is in it. The lumps are what the drawing
 * orders back to front (see `Sky`), so each is a contiguous run of vertices.
 */
export interface CloudGeometry {
  positions: Float32Array;
  normals: Float32Array;
  /**
   * The lump's SMOOTH normal at each corner — the gradient of the ellipsoid it
   * was built from, before the jitter — beside the facet's own in `normals`.
   * The shader lights mostly off this one, so the terminator runs across a
   * lump as one clean cel edge instead of every facet taking a tone of its own.
   */
  smoothNormals: Float32Array;
  /** Each lump's centre, xyz packed, in the same metres as `positions`. */
  lumpCentres: Float32Array;
  /** Each lump's first vertex, and how many vertices it owns (a multiple of 3). */
  lumpFirst: Uint32Array;
  lumpCount: Uint32Array;
}

/**
 * The ring of clouds, in world metres about the ring's centre. `radius` is a
 * real distance: the ring is laid out as it looks from its CENTRE, and a
 * camera anywhere else sees it from there — which is what parallax is.
 *
 * `rand` is the caller's seeded source, so the sky is the same sky on every
 * boot — `CONFIG.sky.seed`'s argument, which is about being able to say "is that
 * cloud new?" while tuning rather than about anything gameplay reads.
 */
export function buildCloudRing(
  rand: () => number,
  o: CloudRingOptions,
): CloudGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const smooth: number[] = [];
  const centres: number[] = [];
  const firsts: number[] = [];
  const counts: number[] = [];
  const unit = icosphere();

  for (let c = 0; c < o.count; c++) {
    // Stratified around the horizon so the ring never clumps into one side of
    // the sky and leaves the other bare, jittered inside each slot so the
    // stratification is not itself a pattern.
    const az = ((c + 0.15 + rand() * 0.7) / o.count) * Math.PI * 2;
    const el =
      o.minElevation +
      (o.maxElevation - o.minElevation) * Math.pow(rand(), o.elevationBias);
    // Narrower the higher it stands. The ring is a sphere about its centre, so a
    // cloud at 30 degrees is no nearer than one at 6 — but a sky reads the
    // other way, the overhead ones being the ones perspective has shrunk least
    // in DEPTH and most in apparent spread, and a full-width bank near the top
    // of the frame photographed as a hull hanging over the street.
    const high = (el - o.minElevation) / Math.max(1e-6, o.maxElevation - o.minElevation);
    const angW =
      (o.minWidth + (o.maxWidth - o.minWidth) * rand()) * (1 - 0.45 * high);
    const width = angW * o.radius;
    const flat = o.minFlatness + (o.maxFlatness - o.minFlatness) * rand();
    const height = width * flat;
    const depth = width * o.depth;

    // The cloud's frame: T along the horizon, U up, R away from the centre. The
    // base is HORIZONTAL in the world rather than square to the eye, which is
    // what lets a high cloud show its belly and a low one show its flank.
    const cx = Math.cos(el) * Math.cos(az) * o.radius;
    const cy = Math.sin(el) * o.radius;
    const cz = Math.cos(el) * Math.sin(az) * o.radius;
    const tx = -Math.sin(az);
    const tz = Math.cos(az);
    const rx = Math.cos(az);
    const rz = Math.sin(az);

    // Cloud frame -> world, with the base SQUASH applied in the cloud's own
    // frame (see the header).
    const place = (lx: number, ly: number, lz: number): Vec3 => [
      cx + lx * tx + lz * rx,
      cy + (ly < 0 ? ly * BELLY_SQUASH : ly),
      cz + lx * tz + lz * rz,
    ];
    // The same frame for a DIRECTION: no offset, and the squash divides a
    // normal's y rather than multiplying it, because a normal is a gradient.
    const orient = (nx: number, ny: number, nz: number, below: boolean): Vec3 => {
      const y = below ? ny / BELLY_SQUASH : ny;
      const wx = nx * tx + nz * rx;
      const wz = nx * tz + nz * rz;
      const l = Math.hypot(wx, y, wz) || 1;
      return [wx / l, y / l, wz / l];
    };
    for (const lump of pileLumps(rand, o, width, height, depth)) {
      const first = pos.length / 3;
      centres.push(
        ...emitLump(unit, lump, o.jitter, rand, place, orient, pos, nrm, smooth),
      );
      firsts.push(first);
      counts.push(pos.length / 3 - first);
    }
  }

  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(nrm),
    smoothNormals: new Float32Array(smooth),
    lumpCentres: new Float32Array(centres),
    lumpFirst: new Uint32Array(firsts),
    lumpCount: new Uint32Array(counts),
  };
}

type Vec3 = [number, number, number];

/**
 * How much of a lump's depth below the cloud's base survives — the belly is
 * PRESSED toward the base plane rather than cut off at it. A hard clamp was
 * tried first and gave every cloud one smooth slab of a floor, which the haze
 * gradient then shaded like a sheet of metal; a squash keeps the facets on the
 * underside while still reading as flat from any distance a cloud is seen at.
 */
const BELLY_SQUASH = 0.18;

/**
 * The tallest a lump may be against its own half-width. At 0.75 a lump was a
 * faceted ball and a cloud was a pile of them; under half, the icosphere's
 * facets are stretched into the long slabs a cloud's silhouette is cut from.
 */
const MAX_LUMP_RISE = 0.38;

/** One ellipsoidal lump in a cloud's own frame: centre and three radii. */
interface Lump {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
}

/**
 * How one cloud is piled: a base row whose lumps swell toward the middle, and
 * a second tier sat on the biggest of them. The profile is what makes a cloud
 * read as a mass with a crown rather than as a row of equal beads.
 */
function pileLumps(
  rand: () => number,
  o: CloudRingOptions,
  width: number,
  height: number,
  depth: number,
): Lump[] {
  const n = o.minLumps + Math.floor(rand() * (o.maxLumps - o.minLumps + 1));
  const out: Lump[] = [];
  const slot = width / n;
  // Which way the upper tier SHEARS: one direction per cloud, so the layers
  // read as a bank that the wind has dragged, not as a heap stacked by hand.
  const shear = rand() < 0.5 ? -1 : 1;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5 + (rand() - 0.5) * 0.6) / n;
    // Swells to the middle and THINS to the ends: a cloud that stops at full
    // height stops like a wall, and one that tapers into a streak is a cloud.
    const swell = Math.pow(Math.sin(Math.PI * Math.min(Math.max(t, 0), 1)), 0.9);
    // Well over its slot, so neighbours merge into one long bank rather than
    // standing as a row of beads — the beads were the popcorn.
    const sx = slot * (1.4 + 0.8 * rand()) * (0.65 + 0.55 * swell);
    // And FLAT against its own width. A lump anywhere near as tall as it is
    // wide is a ball, and a pile of faceted balls is a heap of pale rocks
    // hanging in the sky; the cap is what keeps every facet a long slab.
    const sy = Math.min(
      height * (0.25 + 0.75 * swell) * (0.75 + 0.5 * rand()),
      sx * MAX_LUMP_RISE,
    );
    const lump: Lump = {
      x: (t - 0.5) * width,
      // Centred a quarter of its height ABOVE the base, so the squash takes the
      // bottom of every lump onto the cloud's one flat belly.
      y: sy * 0.25,
      z: (rand() - 0.5) * depth * 0.8,
      sx,
      sy,
      sz: depth * (0.35 + 0.35 * rand()) * (0.6 + 0.4 * swell),
    };
    out.push(lump);
    // The upper tier: a thinner layer riding over the swollen middle and slid
    // one way along the bank, not a crown sat square on top — a crown as tall
    // as its base is where a cloud turns into a peak.
    if (swell > 0.55 && rand() < 0.5) {
      const sxTop = lump.sx * (0.7 + 0.3 * rand());
      out.push({
        x: lump.x + shear * slot * (0.3 + 0.5 * rand()),
        y: lump.y + sy * (0.4 + 0.2 * rand()),
        z: lump.z + (rand() - 0.5) * depth * 0.3,
        sx: sxTop,
        sy: Math.min(sy * (0.5 + 0.15 * rand()), sxTop * MAX_LUMP_RISE),
        sz: lump.sz * 0.7,
      });
    }
  }
  // A TAIL off one end, on most clouds: a long, thin streak at the base,
  // trailing the way the tier shears. It is the one shape a lump pile cannot
  // make on its own, and the one that most says "vapour" rather than "mass".
  // Not much longer than a lump, and not much thinner: an ellipsoid many times
  // longer than it is tall ends in a POINT, and a bank trailing one read as a
  // blade in the sky.
  if (rand() < 0.7) {
    const sx = slot * (1.2 + 0.6 * rand());
    const sy = Math.min(height * (0.2 + 0.1 * rand()), sx * MAX_LUMP_RISE);
    out.push({
      x: shear * (width * 0.5 + sx * 0.2),
      y: sy * 0.25,
      z: (rand() - 0.5) * depth * 0.4,
      sx,
      sy,
      sz: depth * (0.2 + 0.15 * rand()),
    });
  }
  return out;
}

/**
 * Emits one lump as flat triangles and hands back its centre. The vertex
 * jitter is drawn per SHARED vertex before the soup is unwelded, which is what
 * keeps a lump closed — a jitter per corner would open a crack along every edge.
 */
function emitLump(
  unit: Icosphere,
  l: Lump,
  jitter: number,
  rand: () => number,
  place: (x: number, y: number, z: number) => Vec3,
  orient: (x: number, y: number, z: number, below: boolean) => Vec3,
  pos: number[],
  nrm: number[],
  smooth: number[],
): Vec3 {
  // A lump's centre is never under the base (see `pileLumps`), so the squash
  // leaves it where it is and it is a sound reference for "out".
  const centre = place(l.x, l.y, l.z);
  const world: Vec3[] = [];
  const soft: Vec3[] = [];
  for (let i = 0; i < unit.verts.length; i += 3) {
    const r = 1 + (rand() * 2 - 1) * jitter;
    const ux = unit.verts[i], uy = unit.verts[i + 1], uz = unit.verts[i + 2];
    const ly = l.y + uy * r * l.sy;
    world.push(place(l.x + ux * r * l.sx, ly, l.z + uz * r * l.sz));
    // The UNJITTERED ellipsoid's gradient: the jitter is what cuts the facets,
    // and it is exactly what the smooth normal is there to look past.
    soft.push(orient(ux / l.sx, uy / l.sy, uz / l.sz, ly < 0));
  }
  for (let f = 0; f < unit.faces.length; f += 3) {
    const a = world[unit.faces[f]];
    let b = world[unit.faces[f + 1]];
    let c = world[unit.faces[f + 2]];
    const sa = soft[unit.faces[f]];
    let sb = soft[unit.faces[f + 1]];
    let sc = soft[unit.faces[f + 2]];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    // The jitter can fold a facet to nothing. A zero-area facet draws no pixel
    // and would carry a NaN normal into the shader, so it is simply not emitted.
    if (len < 1e-3) continue;
    nx /= len;
    ny /= len;
    nz /= len;
    // OUT of the lump, whatever order the icosphere happened to list it in.
    const mx = (a[0] + b[0] + c[0]) / 3 - centre[0];
    const my = (a[1] + b[1] + c[1]) / 3 - centre[1];
    const mz = (a[2] + b[2] + c[2]) / 3 - centre[2];
    if (nx * mx + ny * my + nz * mz < 0) {
      const t = b;
      b = c;
      c = t;
      const st = sb;
      sb = sc;
      sc = st;
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    pos.push(...a, ...b, ...c);
    smooth.push(...sa, ...sb, ...sc);
    for (let k = 0; k < 3; k++) nrm.push(nx, ny, nz);
  }
  return centre;
}

interface Icosphere {
  /** Unit-sphere vertices, xyz packed. */
  verts: number[];
  /** Triangles as vertex indices. */
  faces: number[];
}

/**
 * An icosahedron subdivided once: 42 vertices, 80 faces. One subdivision and
 * not two, because the facet IS the look — at 500 m a lump of this density
 * draws facets a dozen pixels across, which is the low-poly grain of every
 * other shape in the frame, and one more level turns it back into a ball.
 */
function icosphere(): Icosphere {
  const t = (1 + Math.sqrt(5)) / 2;
  const verts: number[] = [];
  const add = (x: number, y: number, z: number): number => {
    const l = Math.hypot(x, y, z);
    verts.push(x / l, y / l, z / l);
    return verts.length / 3 - 1;
  };
  for (const [x, y, z] of [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ]) {
    add(x, y, z);
  }
  const base = [
    0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11,
    1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
    3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9,
    4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
  ];
  const mid = new Map<number, number>();
  const midpoint = (a: number, b: number): number => {
    const key = a < b ? a * 64 + b : b * 64 + a;
    const hit = mid.get(key);
    if (hit !== undefined) return hit;
    const i = add(
      verts[a * 3] + verts[b * 3],
      verts[a * 3 + 1] + verts[b * 3 + 1],
      verts[a * 3 + 2] + verts[b * 3 + 2],
    );
    mid.set(key, i);
    return i;
  };
  const faces: number[] = [];
  for (let f = 0; f < base.length; f += 3) {
    const a = base[f], b = base[f + 1], c = base[f + 2];
    const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
    faces.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
  }
  return { verts, faces };
}
