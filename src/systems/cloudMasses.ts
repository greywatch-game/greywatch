/**
 * cloudMasses.ts — The SHAPE of the sky's clouds: a ring of cumulus heaps,
 * long stratocumulus banks and small puffs, each a pile of overlapping
 * icosphere lobes on one flat base with the facets buried inside a neighbour
 * dropped, handed back as one triangle soup carrying each facet's normal and a
 * smooth one blended between its lobe and its whole cloud. Pure arithmetic — no Babylon, no state, no
 * random source of its own — which is `glassFracture.ts`'s shape, and for its
 * reason: the only thing a reader needs to trust about it is its output.
 * Owns: where each cloud stands on the ring, how it is piled, and which way
 * every facet faces. Owns no colour, no light and no drift — `Sky` and
 * `shaders/CloudShader.ts` are those.
 * Invariants: every triangle's winding and its stored normal agree and point
 * OUT of the lump it came from, and its smooth normals ride with its corners
 * through any re-winding; a degenerate facet is dropped rather than
 * emitted with a NaN normal; a facet is dropped as buried only where no
 * jitter could have brought it back into the open (`emitLump`);
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
  /** Depth (along the line of sight) as a fraction of width. */
  depth: number;
  /** Lobes in the base row of a cloud, low and high. */
  minLumps: number;
  maxLumps: number;
  /** Radial jitter on every lump vertex, as a fraction of its radius. */
  jitter: number;
  /** How many times each lobe's icosahedron is subdivided. */
  subdivisions: number;
  /** A cumulus lobe's height against its own half-width, low and high. */
  minRise: number;
  maxRise: number;
  /** The same for a BANK's lobes, which are the long flat ones. */
  bankRise: number;
  /** Share of the ring that is towering cumulus, and share that is banks; the rest are puffs. */
  cumulusShare: number;
  bankShare: number;
  /** Most tiers a cumulus stacks over its base row. */
  maxTiers: number;
  /**
   * How much of the light's normal is the whole CLOUD's rather than its lobe's
   * — see `CloudGeometry.smoothNormals`.
   */
  proxyShare: number;
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
   * The SMOOTH normal at each corner, beside the facet's own in `normals`: the
   * gradient of the ellipsoid its lobe was built from, before the jitter,
   * turned `proxyShare` of the way toward the gradient of the whole CLOUD's
   * dome. The shader lights mostly off this one, so the terminator runs across
   * the cloud as one clean cel edge — see `emitLump` for why it is the cloud's
   * and not only the lobe's.
   */
  smoothNormals: Float32Array;
  /** Each lump's centre, xyz packed, in the same metres as `positions`. */
  lumpCentres: Float32Array;
  /**
   * Each lump's three radii (along its cloud's horizon tangent, up, and away
   * from the ring's centre), packed, before the jitter and the belly squash —
   * the ellipsoid the ground's cloud shadow is cast from (`cloudShadow.ts`).
   */
  lumpRadii: Float32Array;
  /**
   * Each lump's cloud's horizon TANGENT, x and z packed, in the ring's frame.
   * The radial axis is that turned a quarter about y — (z, -x) — so it is not
   * stored twice.
   */
  lumpTangents: Float32Array;
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
  const out: Soup = { pos: [], nrm: [], smooth: [] };
  const centres: number[] = [];
  const radii: number[] = [];
  const tangents: number[] = [];
  const firsts: number[] = [];
  const counts: number[] = [];
  const unit = icosphere(o.subdivisions);

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
    const kindRoll = rand();
    const kind: CloudKind =
      kindRoll < o.cumulusShare
        ? "cumulus"
        : kindRoll < o.cumulusShare + o.bankShare
          ? "bank"
          : "puff";
    // A puff is a fragment — a third of a cloud's width, the scraps a sky
    // scatters between its big masses.
    const width = angW * o.radius * (kind === "puff" ? 0.35 : 1);
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
    const lumps =
      kind === "bank"
        ? pileBank(rand, o, width, depth)
        : pileCumulus(rand, o, width, depth, kind === "puff");
    const dome = proxyOf(lumps);
    for (const lump of lumps) {
      const first = out.pos.length / 3;
      centres.push(...emitLump(unit, lump, lumps, dome, o, rand, place, orient, out));
      radii.push(lump.sx, lump.sy, lump.sz);
      tangents.push(tx, tz);
      firsts.push(first);
      counts.push(out.pos.length / 3 - first);
    }
  }

  return {
    positions: new Float32Array(out.pos),
    normals: new Float32Array(out.nrm),
    smoothNormals: new Float32Array(out.smooth),
    lumpCentres: new Float32Array(centres),
    lumpRadii: new Float32Array(radii),
    lumpTangents: new Float32Array(tangents),
    lumpFirst: new Uint32Array(firsts),
    lumpCount: new Uint32Array(counts),
  };
}

type Vec3 = [number, number, number];
type CloudKind = "cumulus" | "bank" | "puff";

/** The arrays `emitLump` appends to. */
interface Soup {
  pos: number[];
  nrm: number[];
  smooth: number[];
}

/**
 * How much of a lump's depth below the cloud's base survives — the belly is
 * PRESSED toward the base plane rather than cut off at it. A hard clamp was
 * tried first and gave every cloud one smooth slab of a floor, which the haze
 * gradient then shaded like a sheet of metal; a squash keeps the facets on the
 * underside while still reading as flat from any distance a cloud is seen at.
 */
const BELLY_SQUASH = 0.18;

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
 * A CUMULUS: a row of round lobes on one flat base, swelling toward a peak
 * that stands off-centre, smaller lobes piled on the biggest in tiers that lean
 * the same way, and a CROWN of little billows breaking the top of it all — the
 * cauliflower silhouette every painted sky draws, and the one the old long,
 * flat piles could not make.
 *
 * **What keeps a lobe a BILLOW and not a boulder is that it is never seen
 * whole.** The earlier piles capped a lump at 0.38 of its half-width because a
 * row of separate faceted balls read as a heap of pale rocks. These are
 * rounder, but each overlaps its neighbours by most of its width and every
 * facet buried in another lobe is dropped (`emitLump`), so what reaches the
 * frame is one mass with a scalloped outline. **The crown is what stops a tall
 * one reading as a CLIFF**: without it a tower is two or three smooth domes
 * stacked with straight flanks, which photographed as a sandstone butte.
 *
 * A PUFF is the same pile at a third of the width, with no more than one tier:
 * the scraps between the big masses.
 */
function pileCumulus(
  rand: () => number,
  o: CloudRingOptions,
  width: number,
  depth: number,
  puff: boolean,
): Lump[] {
  const n = puff
    ? 2 + Math.floor(rand() * 2)
    : o.minLumps + Math.floor(rand() * (o.maxLumps - o.minLumps + 1));
  const slot = width / n;
  const rise = (): number => o.minRise + (o.maxRise - o.minRise) * rand();
  // Which way the tower LEANS: one direction per cloud, so the tiers read as a
  // heap the wind has sheared rather than one stacked square by hand.
  const lean = rand() < 0.5 ? -1 : 1;
  const peak = 0.5 + lean * (0.04 + 0.12 * rand());
  const out: Lump[] = [];
  let row: Lump[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5 + (rand() - 0.5) * 0.5) / n;
    // Swells toward the peak and falls away to the ends, so the base row is
    // already a mound before anything is piled on it.
    const d = (t - peak) / 0.38;
    const swell = Math.exp(-d * d);
    // Well over its slot, so neighbours bury most of each other and the row is
    // one mass with a scalloped top rather than a string of beads.
    const r = slot * (1.0 + 0.35 * rand()) * (0.55 + 0.6 * swell);
    const sy = r * rise() * (0.75 + 0.25 * swell);
    const lump: Lump = {
      x: (t - 0.5) * width,
      // Centred a little ABOVE the base, so the squash takes the bottom of
      // every lobe onto the cloud's one flat belly.
      y: sy * 0.18,
      z: (rand() - 0.5) * depth * 0.35,
      sx: r,
      sy,
      sz: Math.min(r * (0.85 + 0.25 * rand()), depth * 0.6),
    };
    out.push(lump);
    row.push(lump);
    // A lobe in FRONT of or behind the row now and then, lower and smaller: a
    // cloud is a heap in depth too, and seen off its axis a row with nothing
    // beside it is a wall.
    if (!puff && rand() < 0.35) {
      const side = rand() < 0.5 ? -1 : 1;
      const rf = r * (0.55 + 0.2 * rand());
      out.push({
        x: lump.x + (rand() - 0.5) * slot * 0.6,
        y: rf * 0.1,
        z: lump.z + side * lump.sz * (0.55 + 0.2 * rand()),
        sx: rf,
        sy: rf * rise() * 0.85,
        sz: rf * 0.9,
      });
    }
  }
  // The tiers. Each sits on the biggest lobes of the row under it, smaller and
  // slid toward the lean, so the tower is off-centre and narrows as it climbs.
  const tiers = puff ? (rand() < 0.6 ? 1 : 0) : 1 + Math.floor(rand() * o.maxTiers);
  const tops: Lump[] = [...row];
  for (let k = 0; k < tiers && row.length > 0; k++) {
    const keep = Math.max(1, Math.round(row.length * (0.45 + 0.15 * rand())));
    const under = [...row].sort((a, b) => b.sy - a.sy).slice(0, keep);
    row = [];
    for (const u of under) {
      const r = u.sx * (0.6 + 0.2 * rand());
      const lump: Lump = {
        x: u.x + lean * u.sx * (0.12 + 0.25 * rand()),
        // Its centre on the upper half of the lobe beneath, so it rises out of
        // it rather than floating over it or sinking into it.
        y: u.y + u.sy * (0.5 + 0.2 * rand()),
        z: u.z + (rand() - 0.5) * u.sz * 0.4,
        sx: r,
        sy: r * rise(),
        sz: Math.min(u.sz * (0.75 + 0.15 * rand()), r * 1.05),
      };
      out.push(lump);
      row.push(lump);
      tops.push(lump);
    }
  }
  // The CROWN: small billows set into the upper surface of the lobes, each
  // centred most of the way out along a direction in the upper half of its
  // host, so it breaks the outline as a bump rather than sitting on it as a
  // ball. The higher the host, the more it gets — the cauliflower is at the
  // top of a cumulus, and its flanks and base stay smooth.
  const top = tops.reduce((m, l) => Math.max(m, l.y + l.sy), 0) || 1;
  for (const h of tops) {
    const high = (h.y + h.sy) / top;
    const bumps = Math.round((puff ? 1 : 1.5 + 2 * high) * rand() + (high > 0.8 ? 1 : 0));
    for (let b = 0; b < bumps; b++) {
      // An angle off vertical, within the upper sixty degrees, and a bearing
      // weighted toward the eye's side and the outline — the two places a
      // bump can be SEEN.
      const off = (rand() * 2 - 1) * 1.05;
      const across = (rand() - 0.5) * 0.9;
      const ux = Math.sin(off);
      const uy = Math.cos(off);
      const r = h.sx * (0.28 + 0.16 * rand());
      out.push({
        x: h.x + ux * h.sx * 0.78,
        y: h.y + uy * h.sy * 0.72,
        z: h.z + across * h.sz * 0.7,
        sx: r,
        sy: r * rise(),
        sz: r,
      });
    }
  }
  return out;
}

/**
 * A BANK: a long, low row of small round lobes, swelling to the middle and
 * thinning to the ends, with a scatter of billows along its top. It is the
 * stratocumulus between the heaps, and it is what the horizon wants —
 * perspective stacks the far sky into long bands.
 *
 * **It is a ROW OF ROUND LOBES and never a few long ones**, and the long ones
 * shipped: an ellipsoid many times longer than it is tall ends in a POINT, and
 * a bank built of them read as a sheaf of blades across the sky. Many lobes
 * each about as wide as they are deep keep both ends of a bank blunt and its
 * top lumpy.
 */
function pileBank(
  rand: () => number,
  o: CloudRingOptions,
  width: number,
  depth: number,
): Lump[] {
  const n = 2 * o.maxLumps + Math.floor(rand() * 5);
  const slot = width / n;
  const out: Lump[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5 + (rand() - 0.5) * 0.6) / n;
    // Swells to the middle and THINS to the ends: a cloud that stops at full
    // height stops like a wall, and one that tapers into a streak is a cloud.
    const swell = Math.pow(Math.sin(Math.PI * Math.min(Math.max(t, 0), 1)), 0.6);
    // The ends thin, but not to nothing: a row that tapers to its last small
    // lobe is a WEDGE, and seen end-on a wedge of cloud is a blade again.
    const r = slot * (1.3 + 0.6 * rand()) * (0.72 + 0.4 * swell);
    const sy = r * o.bankRise * (0.8 + 0.4 * rand());
    const lump: Lump = {
      x: (t - 0.5) * width,
      y: sy * 0.2,
      z: (rand() - 0.5) * depth * 0.5,
      sx: r,
      sy,
      sz: Math.min(r * (0.9 + 0.3 * rand()), depth * 0.5),
    };
    out.push(lump);
    // Small billows breaking the top, on the fuller middle only.
    if (swell > 0.45 && rand() < 0.5) {
      const rb = r * (0.45 + 0.2 * rand());
      out.push({
        x: lump.x + (rand() - 0.5) * r * 0.6,
        y: lump.y + sy * (0.45 + 0.15 * rand()),
        z: lump.z + (rand() - 0.5) * lump.sz * 0.4,
        sx: rb,
        sy: rb * (o.minRise + (o.maxRise - o.minRise) * rand()),
        sz: rb,
      });
    }
  }
  return out;
}

/**
 * How far out of `l`'s own ellipsoid a point in the cloud's frame is: 1 on its
 * surface, under 1 inside. Asked BEFORE the belly squash, which is one
 * monotonic map of the whole cloud frame and so cannot change the answer.
 */
function reach(l: Lump, x: number, y: number, z: number): number {
  const dx = (x - l.x) / l.sx;
  const dy = (y - l.y) / l.sy;
  const dz = (z - l.z) / l.sz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * The whole cloud as ONE shape for the light to be asked of: a dome standing on
 * the cloud's base plane, as wide and deep as its lobes reach and as tall as
 * its highest one. Stated as a `Lump` whose centre is ON the base, so its upper
 * half is the dome and its lower half is the belly the squash flattens.
 */
function proxyOf(lumps: readonly Lump[]): Lump {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, top = 0;
  for (const l of lumps) {
    x0 = Math.min(x0, l.x - l.sx);
    x1 = Math.max(x1, l.x + l.sx);
    z0 = Math.min(z0, l.z - l.sz);
    z1 = Math.max(z1, l.z + l.sz);
    top = Math.max(top, l.y + l.sy);
  }
  return {
    x: (x0 + x1) / 2,
    y: 0,
    z: (z0 + z1) / 2,
    sx: (x1 - x0) / 2,
    sy: Math.max(top, 1),
    sz: (z1 - z0) / 2,
  };
}

/**
 * Emits one lump as flat triangles and hands back its centre. The vertex
 * jitter is drawn per SHARED vertex before the soup is unwelded, which is what
 * keeps a lump closed — a jitter per corner would open a crack along every edge.
 *
 * **A facet BURIED in another lobe of the same cloud is never emitted**, and
 * that is what the tiers needed to stop reading as stacked plates. Every cloud
 * writes one depth (`Sky`), so which lobe covers which is the painter's order
 * alone, and a lobe drawn after the one it rises out of painted its own
 * buried underside over it — a hard shelf across the cloud at every tier.
 * Dropped, the only thing a later lobe can paint is surface that is really
 * outside the one beneath, and the two meet at a seam. The test is against
 * the neighbour's SMALLEST possible surface (`1 - jitter`), so a facet is only
 * dropped where no jitter could have brought it back into the open.
 *
 * **The smooth normal is part LOBE and part CLOUD** (`proxyShare`), and that
 * is the stylised painter's normal transfer. Lit off its own lobe alone, every
 * billow in the crown turned its own small terminator toward the light, and a
 * lit face came out spotted with dark crescents — a heap of stones in
 * sunlight. Turned toward the one dome standing over the whole cloud, the
 * light falls across the mass as one big shape with a gently scalloped edge,
 * and the billows are left to do what only they can: break the silhouette.
 */
function emitLump(
  unit: Icosphere,
  l: Lump,
  all: readonly Lump[],
  dome: Lump,
  o: CloudRingOptions,
  rand: () => number,
  place: (x: number, y: number, z: number) => Vec3,
  orient: (x: number, y: number, z: number, below: boolean) => Vec3,
  out: Soup,
): Vec3 {
  // A lump's centre is never under the base (see the piles), so the squash
  // leaves it where it is and it is a sound reference for "out".
  const centre = place(l.x, l.y, l.z);
  const world: Vec3[] = [];
  const soft: Vec3[] = [];
  const buried: boolean[] = [];
  const hidden = 1 - o.jitter;
  const share = o.proxyShare;
  for (let i = 0; i < unit.verts.length; i += 3) {
    const r = 1 + (rand() * 2 - 1) * o.jitter;
    const ux = unit.verts[i], uy = unit.verts[i + 1], uz = unit.verts[i + 2];
    const lx = l.x + ux * r * l.sx;
    const ly = l.y + uy * r * l.sy;
    const lz = l.z + uz * r * l.sz;
    world.push(place(lx, ly, lz));
    // The UNJITTERED ellipsoid's gradient — the jitter is what cuts the facets,
    // and it is exactly what the smooth normal is there to look past — turned
    // toward the whole cloud's. Both unit length before they are mixed, so the
    // share is a share of DIRECTION and not of whichever gradient is longer.
    const gx = ux / l.sx, gy = uy / l.sy, gz = uz / l.sz;
    const gl = Math.hypot(gx, gy, gz) || 1;
    const px = (lx - dome.x) / (dome.sx * dome.sx);
    const py = (ly - dome.y) / (dome.sy * dome.sy);
    const pz = (lz - dome.z) / (dome.sz * dome.sz);
    const pl = Math.hypot(px, py, pz) || 1;
    soft.push(
      orient(
        (gx / gl) * (1 - share) + (px / pl) * share,
        (gy / gl) * (1 - share) + (py / pl) * share,
        (gz / gl) * (1 - share) + (pz / pl) * share,
        ly < 0,
      ),
    );
    let near = Infinity;
    for (const m of all) {
      if (m !== l) near = Math.min(near, reach(m, lx, ly, lz));
    }
    buried.push(near < hidden);
  }
  for (let f = 0; f < unit.faces.length; f += 3) {
    const ia = unit.faces[f];
    let ib = unit.faces[f + 1];
    let ic = unit.faces[f + 2];
    if (buried[ia] && buried[ib] && buried[ic]) continue;
    const a = world[ia];
    let b = world[ib];
    let c = world[ic];
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
      const t = ib;
      ib = ic;
      ic = t;
      b = world[ib];
      c = world[ic];
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    out.pos.push(...a, ...b, ...c);
    out.smooth.push(...soft[ia], ...soft[ib], ...soft[ic]);
    for (let k = 0; k < 3; k++) out.nrm.push(nx, ny, nz);
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
 * An icosahedron subdivided `levels` times: 42 vertices and 80 faces at one,
 * 162 and 320 at two. The clouds take TWO, and that was a photograph: at one,
 * a lobe round enough to be a billow drew a polygon for a silhouette and a
 * handful of big facets across its face, and a heap of those was a heap of
 * rocks — the one reading a cloud must never have. At two the outline is a
 * curve with a hand-cut edge, like the canopy's, and the key's one cut runs
 * across it cleanly.
 */
function icosphere(levels: number): Icosphere {
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
  let faces = [
    0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11,
    1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
    3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9,
    4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
  ];
  for (let level = 0; level < levels; level++) {
    const mid = new Map<number, number>();
    const midpoint = (a: number, b: number): number => {
      const key = a < b ? a * 65536 + b : b * 65536 + a;
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
    const next: number[] = [];
    for (let f = 0; f < faces.length; f += 3) {
      const a = faces[f], b = faces[f + 1], c = faces[f + 2];
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      next.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
    }
    faces = next;
  }
  return { verts, faces };
}
