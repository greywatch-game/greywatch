/**
 * Ridge.ts — The valley rim: the landform that closes the map's boundary.
 * Owns: the escarpment's shape, and nothing else. Returns VertexData segments;
 * MapBuilder makes the meshes, the same contract TerrainField states for the
 * floor.
 *
 * This file emits NO collider. The four boundary boxes MapBuilder builds are
 * unchanged and are what actually bounds play, which is why NavGrid, CoverMap,
 * ObstacleField, Minimap and DeployScreen still identify the boundary by
 * `w > 200 || d > 200` and nothing here has to know they exist. If the rim ever
 * gains colliders of its own, that heuristic is the first thing to break.
 *
 * **`size` here is the BOUNDARY's extent, which is the map's only until the map
 * has a `borderland`.** On an open-boundary map the four boxes stand a margin
 * beyond the play square and the rim stands with them, so this file is handed
 * `size + 2 * margin` and every invariant below is measured on that. Nothing in
 * here knows what a borderland is, and it should stay that way: what a rim owes
 * is to close the horizon somewhere outside anything that can be stood on, and
 * where that is has always been its caller's answer.
 *
 * **There are two FORMS and the difference between them is the basal band.**
 * `escarpment` is the shipped one and is a cliff; `downs` is a hill. They share
 * every line of the emit loop and differ in a profile table, the tone split and
 * the two rules called out below.
 *
 * **There is a third that is not a landform: `none` emits nothing**, for a map
 * that has already put something past its own boundary for the horizon to be
 * made of. It is the first line of `ridgeSegments` and the argument for it is
 * there.
 *
 * **And `RidgeSpec.mouth` is that same `none` asked of ONE ARC**, for a map
 * whose horizon is closed by a landform on some bearings and by something it
 * laid out itself on others. It is not a deep pass and could not be one: a
 * pass cuts the crest ANGLE and is re-clamped against `MIN_SLOPE`, which is
 * precisely the clamp that stops a pass opening a hole in the sky. A mouth
 * shrinks the whole landform instead — the crest, the REACH and the shoulder
 * together — so the ring converges onto its own toe and `RingAccum.quad`
 * drops what is left of it. `shrink` is that factor, it is 1 at every station
 * on a map that states no mouth, and that is what keeps this bit-identical
 * for the five maps that do not.
 *
 * Invariants:
 * - **Nothing it emits is inside `±size/2`.** The band runs from the boundary
 *   OUTWARD, where there is no playable space at all, so the whole landform
 *   costs zero playable area. `assertOutsidePlay` checks it in dev.
 * - **The escarpment's basal band is VERTICAL and flush with the collider
 *   plane.** Colliders must line up with the surfaces they stand in for — every
 *   ray test and every spark lands on the box at `±size/2` — and a face that
 *   battered outward from the floor would put visible rock most of a metre in
 *   front of it at chest height, so rounds would spark on air. The variation
 *   goes into that band's TOP EDGE, never its position. This is the one part of
 *   the profile that is not free to be pretty.
 *
 *   **The downs have no band, and that is the same rule rather than an
 *   exception to it.** The band exists to be flush with a plane a player can
 *   stand against; `form: "downs"` is only reachable from a map with a
 *   `borderland`, where the boundary boxes are a margin's width past anywhere a
 *   living player is and there is nothing to be flush with. A map that took this
 *   form without one would be putting a hillside where the wall used to be, and
 *   rounds would spark on air along the whole perimeter.
 * - **The crest is authored as an ANGLE from the map centre, never a height.**
 *   Sky.ts culls stars at dome row 0.46 (7.2 deg above the horizon) and cloud at
 *   0.47 (5.4 deg), and paints the dome flat `fogColor` below the horizon — so a
 *   crest that drops under that exposes a band of sky with nothing in it. A
 *   tangent clamped at `MIN_SLOPE` makes the invariant true by construction
 *   instead of by careful authoring, and it makes the corners rise higher than
 *   the sides for free, which is what a valley looks like where two ranges meet.
 *   The box this replaced subtended 9.46 deg; MIN_SLOPE sits just above it.
 * - **Babylon is LEFT-handed** — a front face is clockwise seen from the front.
 *   The rim is looked at from inside the ring it makes, so its visible faces
 *   point sideways and INWARD; TerrainField's `assertFacesUp` does not apply
 *   and `assertFacesInward` is this file's equivalent. Trust it over your own
 *   derivation of the winding; the failure is silent, and getting the sense of
 *   the check itself backwards is the easy mistake.
 * - **Its own seeded stream, NEVER MapBuilder's.** One stream serves the whole
 *   map build in authored order, so a single draw from it here would reroll
 *   every scatter region on the map — a visible change to the level, with no
 *   error and nothing in the diff to point at it.
 * - No non-uniform scaling: these meshes are outlined, and `renderOutline`
 *   extrudes along normals `VertexData.transform` does not renormalise.
 */
import { VertexData } from "@babylonjs/core";
import type {
  RidgeMouth,
  RidgePass,
  RidgeRolling,
  RidgeSpec,
} from "./layout";
import type { TerrainField } from "./TerrainField";
import { mulberry32 } from "./rng";

/**
 * The rim's tones. The last four are the WOODS, and they are the near trees'
 * own paint (`Props.RIM_WOOD`) rather than colours of the rim's, so a stand on
 * the hill and a stand on the plain in front of it cannot disagree.
 */
export type RidgeTone =
  | "rock"
  | "scree"
  | "needle"
  | "needleLit"
  | "leaf"
  | "bark";

/** One merged run of rim, ready for a mesh. */
export interface RidgeSegment {
  /** Mesh name suffix — `ridge-<key>`. */
  key: string;
  /**
   * Which tone it takes: the rock, the foot that melts into the floor, or —
   * on a rim stating `rolling.woods` — one of the four the trees on it wear.
   * `MapBuilder` owns what each one is painted with.
   */
  tone: RidgeTone;
  data: VertexData;
}

/**
 * The floor under the crest's angle: `tan(7.5 deg)`, just over the 7.2 deg
 * (dome row 0.46) where Sky.ts stops painting stars.
 *
 * It sits barely above the hard limit rather than at the 9.46 deg the old box
 * gave, and that headroom is what makes a pass possible at all. The clamp
 * applies AFTER a pass has cut the slope, so a floor near the general height of
 * the rim would swallow the cut entirely and the cols would be invisible —
 * which is exactly what 0.17 did. The open rim is governed by `slope` in the
 * RidgeSpec (0.205, ~11.6 deg) and never comes near this; only a pass does.
 */
const MIN_SLOPE = 0.132;

/**
 * Shortest the vertical basal band may ever be. See the header: the band is
 * what keeps the visible rock flush with the collider plane at the heights
 * things are shot at, so this is a correctness floor, not a look.
 */
const PLINTH_FLOOR = 1.8;

/** Stations along each side. Corners get their own fan; see `ringStations`. */
const STATION_SPACING = 2.5;
/**
 * Stations spent sweeping the outward normal through each 90 deg corner.
 *
 * **It is a spacing and not a count, which is why the downs need their own.**
 * The fan is a quarter cone and eight panels across it is what makes the
 * escarpment's corner smooth: its crest stands 14.5 m out, so each panel spans
 * `14.5 * (pi/2) / 8` = 2.85 m of arc — one `STATION_SPACING`, the same as a
 * side. The downs put their crest 150 m out and eight panels there span 29 m
 * apiece, which stops being a facet and becomes a FOLD: a hard vertical crease
 * running the whole height of a ninety-metre hill, one half of it lit and the
 * other not. `cornerStations` is that arithmetic run forwards instead of the
 * number it happened to give, and 8 stays the escarpment's literal so the three
 * shipped maps are untouched to the float.
 */
const CORNER_STATIONS = 8;

/** Stations a fan needs to hold `STATION_SPACING` at a crest `crestOut` out. */
function cornerStations(crestOut: number): number {
  return Math.max(
    CORNER_STATIONS,
    Math.ceil((crestOut * (Math.PI / 2)) / STATION_SPACING),
  );
}
/** Runs the ring is cut into, for frustum culling and outline scaling. */
const SEGMENTS = 10;

/**
 * How far inward a correct front face must lean, as a dot product — the
 * threshold `assertFacesInward` measures against, one per form.
 *
 * The escarpment's front is near vertical and measures about -0.9, so -0.4 is
 * generous. The downs' is a hillside at 20-26 degrees, whose normals are mostly
 * UP: it measures about -0.34, and a pass flattening a third of one segment
 * takes the worst of them to about -0.31. -0.18 leaves both forms room and
 * still catches the thing the check exists for, which is a winding that has
 * flipped the sign of every one of these.
 */
const INWARD_LIMIT = -0.4;
const DOWNS_INWARD_LIMIT = -0.18;

/**
 * The cross-section, foot to back: `[outward offset in metres, height as a
 * fraction of the crest]`. Offsets are scaled per station by `bulge`, which is
 * what stops a swept profile reading as a stage flat.
 *
 * Rings 0 and 1 are both at offset 0 — that is the vertical basal band, and it
 * is load-bearing rather than decorative (see the header). Rings 3, 5 and 7 are
 * the near-flat ledges: they are up-facing, so `band(0.5 + 0.5*n.y, 3.0)` gives
 * them close to full `skyLightColor` while the risers between them sit at half.
 * That banding IS the rim's third tone, and it costs nothing.
 */
const PROFILE: [number, number][] = [
  // The first two heights are placeholders: the toe is buried a fixed 0.4 m
  // under the floor and the plinth's top comes from `plinth`, so neither is a
  // fraction of the crest. The emit loop special-cases both.
  [0, 0], // toe
  [0, 0], // plinth top — vertical band, flush with the collider plane
  [1.6, 0.3],
  [3.4, 0.35], // ledge
  [5.0, 0.62],
  [7.2, 0.66], // ledge
  [9.4, 0.89],
  [11.6, 0.94], // bench
  [14.5, 1.0], // crest
  [21, 0.76],
  [33, 0.32],
  [46, -0.2], // back toe, below the floor — the outside is never seen
];

/**
 * The other landform: `RidgeSpec.form: "downs"`.
 *
 * Same twelve rings and the same emit loop — what changes is the SHAPE, and
 * every difference is one of the two things that make an escarpment an
 * escarpment rather than a hill:
 *
 * - **No vertical basal band.** Rings 0 and 1 are both at offset 0 above, which
 *   is the flush face the boundary colliders need at the player's feet. Here
 *   ring 1 has already moved outward, so the ground leaves the floor on a
 *   shoulder instead of a step. A map only reaches this form through a
 *   `borderland`, where the collider plane is a margin's width further out than
 *   anywhere a living player stands, so there is nothing left for a flush face
 *   to be flush with. `plinth` is still emitted and is still what ring 1's
 *   HEIGHT comes from — the emit loop is shared — but at a fraction of a metre
 *   it reads as the ground swelling rather than as a plinth.
 * - **No ledges, and a rounded crest.** The heights are a smoothstep from foot
 *   to top rather than the riser-and-tread stack, and the offsets run four
 *   times as far for the same rise, so the face lies at 20-25 degrees where the
 *   escarpment's is near 60. The crest ring is not a cap: it is the top of a
 *   curve that carries straight over into the back slope, which is what a
 *   chalk down does and what the flat mesa top most obviously does not.
 */
const DOWNS_PROFILE: [number, number][] = [
  [0, 0], // toe
  [5, 0], // shoulder — the ground leaving the floor, not a plinth
  [20, 0.08],
  [38, 0.2],
  [60, 0.36],
  [84, 0.54],
  [108, 0.71],
  [130, 0.88],
  [150, 1.0], // crest, rounded rather than capped
  [186, 0.9],
  [240, 0.55],
  [310, -0.25], // back toe, below the floor — the outside is never seen
];

/**
 * The tallest the downs' shoulder may be, in metres — the counterpart of
 * `PLINTH_FLOOR`, and its opposite in every sense.
 *
 * The escarpment's band has a FLOOR because it has to clear everything that
 * gets shot at. The downs' has a CEILING because it has to clear nothing: what
 * would be a plinth is a swell in the ground a few tens of centimetres high
 * over the shoulder's five metres of run, which is a gradient of about 0.07 and
 * reads as pasture rather than as a step at the bottom of a hill.
 */
const DOWNS_SHOULDER = 0.6;

/** The last ring still on the visible face; past it is the back slope. */
const CREST_RING = 8;
/** Rings 0..SCREE_RING take the scree tone; the rest take the rock. */
const SCREE_RING = 2;
/**
 * Where the two tones meet on the downs.
 *
 * Further up than the escarpment's, and for a reason that is about what the
 * tones MEAN rather than about the geometry: `ridgeScreeColor` is the rim's
 * foot, the band a low sun rakes and the one that has to melt into
 * `floorColor`. On a cliff that is the couple of metres of talus at the
 * bottom; on a hillside rising over ninety metres of run it is the whole lower
 * pasture, and cutting it at ring 2 would leave a green hem under a grey hill.
 */
const DOWNS_SCREE_RING = 5;

/**
 * How many rings a rolling rim cuts each span of its face into — see where
 * `ridgeSegments` picks its profile.
 */
const ROLL_SPLIT = 4;

/**
 * `profile` with every span from ring 1 up to the back slope cut into `n`,
 * interpolated linearly in both offset and height, so the surface is the
 * same one drawn through more rings. The toe span is left alone (ring 0 to 1
 * is the band, whose heights are special-cased) and so is the last one (the
 * back toe's height is special-cased too, and nobody sees it). Old ring `j`
 * lands at `1 + (j - 1) * n`; at `n = 1` this is the table itself.
 */
function refineProfile(
  profile: [number, number][],
  n: number,
): [number, number][] {
  if (n <= 1) return profile;
  const last = profile.length - 1;
  const out: [number, number][] = [profile[0], profile[1]];
  for (let j = 1; j < last - 1; j++) {
    const [o0, h0] = profile[j];
    const [o1, h1] = profile[j + 1];
    for (let k = 1; k <= n; k++) {
      out.push([o0 + ((o1 - o0) * k) / n, h0 + ((h1 - h0) * k) / n]);
    }
  }
  out.push(profile[last]);
  return out;
}

/** One station on the boundary ring. */
interface Station {
  /** The toe point, exactly on the boundary. */
  x: number;
  z: number;
  /** Outward unit normal in XZ. */
  nx: number;
  nz: number;
  /** Distance from the map centre to the toe. */
  r: number;
}

/**
 * Periodic value noise over the station index, so the ring closes with no wrap
 * seam. The lattice is filled once from the rim's own stream; `noise(u + 1)`
 * equals `noise(u)` by construction.
 */
function periodicNoise(rng: () => number, octaves: number, base: number) {
  const tables: number[][] = [];
  for (let k = 0; k < octaves; k++) {
    const n = base * 2 ** k;
    const t = new Array<number>(n);
    for (let i = 0; i < n; i++) t[i] = rng();
    tables.push(t);
  }
  /** `u` is a fraction of the way round the ring. */
  return (u: number): number => {
    let sum = 0;
    let norm = 0;
    for (let k = 0; k < octaves; k++) {
      const t = tables[k];
      const n = t.length;
      const p = ((u % 1) + 1) % 1;
      const f = p * n;
      const i0 = Math.floor(f) % n;
      const frac = f - Math.floor(f);
      // Smoothstep between lattice points — cheap and C1 enough for a skyline.
      const s = frac * frac * (3 - 2 * frac);
      const amp = 1 / 2 ** k;
      sum += (t[i0] * (1 - s) + t[(i0 + 1) % n] * s) * amp;
      norm += amp;
    }
    return sum / norm;
  };
}

/**
 * Value noise over WORLD XZ, for what varies across the face rather than
 * round the ring — the knolls and the woods' stands. Hashed rather than
 * tabled, because the plane has no period to fill a table over; the seed is
 * the rim's own, so nothing here draws from any stream at all.
 *
 * `cell` is the finest wavelength anybody may see, and the octaves only go UP
 * from it — for the teeth reason `ridgeSegments` gives for the slope noise.
 */
function planeNoise(seed: number, cell: number, octaves: number) {
  const hash = (ix: number, iz: number, k: number): number => {
    let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1);
    h = Math.imul(h ^ (seed + k * 0x9e3779b9), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  return (x: number, z: number): number => {
    let sum = 0;
    let norm = 0;
    for (let k = 0; k < octaves; k++) {
      // Coarsest first: octave k is `cell * 2^(octaves-1-k)` metres.
      const size = cell * 2 ** (octaves - 1 - k);
      const fx = x / size;
      const fz = z / size;
      const ix = Math.floor(fx);
      const iz = Math.floor(fz);
      let tx = fx - ix;
      let tz = fz - iz;
      tx = tx * tx * (3 - 2 * tx);
      tz = tz * tz * (3 - 2 * tz);
      const a = hash(ix, iz, k);
      const b = hash(ix + 1, iz, k);
      const c = hash(ix, iz + 1, k);
      const d = hash(ix + 1, iz + 1, k);
      const amp = 1 / 2 ** k;
      sum += (a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz) * amp;
      norm += amp;
    }
    return sum / norm;
  };
}

/** `smoothstep`, for the woods' ramps. */
function ease(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Ground a tree needs at full cover, in square metres — crowns touching,
 * which is what a wood reads as from three hundred metres off. `woods` spends
 * it as a share of the face, not as a thinner spread: a hillside half wooded
 * is stands and pasture, never every tree half as close.
 */
const TREE_AREA = 40;

/** Sides on a far tree. Six, as on the rim's corner fans, is round at range. */
const TREE_SIDES = 6;

/** Runs the woods are cut into — see where `ridgeSegments` sows them. */
const WOOD_RUNS = 5;

/**
 * The rim's woods, one accumulator per tone. Separate from `RingAccum`
 * because a tree is looked at from every side and faces OUTWARD from its own
 * axis — the rim's inward check means nothing here.
 *
 * **Babylon is left-handed**, and the order used is the one `RingAccum`
 * states run the other way round: round a ring with the angle INCREASING
 * (+X towards +Z), `(lower_k, lower_k+1, upper_k+1)` then `(lower_k,
 * upper_k+1, upper_k)` gives an OUTWARD normal. Checked against
 * `ComputeNormals`' `(p1 - p2) x (p3 - p2)` on the first quad of a cone.
 */
class TreeAccum {
  private readonly positions: number[] = [];
  private readonly indices: number[] = [];

  private ring(
    x: number,
    y: number,
    z: number,
    r: number,
    yaw: number,
    sides = TREE_SIDES,
  ): number {
    const at = this.positions.length / 3;
    for (let k = 0; k < sides; k++) {
      const a = yaw + (k / sides) * Math.PI * 2;
      this.positions.push(x + Math.cos(a) * r, y, z + Math.sin(a) * r);
    }
    return at;
  }

  private point(x: number, y: number, z: number): number {
    this.positions.push(x, y, z);
    return this.positions.length / 3 - 1;
  }

  /** A band between two rings, outward. */
  private band(lo: number, hi: number, sides = TREE_SIDES): void {
    for (let k = 0; k < sides; k++) {
      const k1 = (k + 1) % sides;
      this.indices.push(lo + k, lo + k1, hi + k1, lo + k, hi + k1, hi + k);
    }
  }

  /** A fan from a ring up to an apex, outward. */
  private top(ring: number, apex: number): void {
    for (let k = 0; k < TREE_SIDES; k++) {
      this.indices.push(ring + k, ring + ((k + 1) % TREE_SIDES), apex);
    }
  }

  /** A fan from an apex BELOW a ring up to it, outward and down. */
  private bottom(apex: number, ring: number): void {
    for (let k = 0; k < TREE_SIDES; k++) {
      this.indices.push(apex, ring + ((k + 1) % TREE_SIDES), ring + k);
    }
  }

  /**
   * A bole: four sides, no caps — its foot is sunk and its head is inside
   * the crown, so neither end is ever seen. Without one a tree at 150 m is a
   * crown hanging in the air, which is the first thing that reads as wrong.
   */
  trunk(x: number, y0: number, z: number, r: number, y1: number): void {
    const foot = this.ring(x, y0, z, r, 0, 4);
    const head = this.ring(x, y1, z, r * 0.6, 0, 4);
    this.band(foot, head, 4);
  }

  /**
   * One cone of a conifer, with a CAP under its skirt. The rim is seen from
   * below — a hillside rising from the city — and an open skirt looked up
   * into is a hole showing the hill through the tree.
   */
  cone(
    x: number,
    y0: number,
    z: number,
    r: number,
    y1: number,
    yaw: number,
  ): void {
    const skirt = this.ring(x, y0, z, r, yaw);
    this.top(skirt, this.point(x, y1, z));
    // The cap takes its own ring: sharing the skirt's would average the two
    // normals into a sideways one and light the underside like the flank.
    const cap = this.ring(x, y0, z, r, yaw);
    const centre = this.point(x, y0, z);
    for (let k = 0; k < TREE_SIDES; k++) {
      this.indices.push(centre, cap + ((k + 1) % TREE_SIDES), cap + k);
    }
  }

  /**
   * A broadleaf crown: three rings, each turned half a side on the last, so
   * six sides come out as a faceted ball rather than the diamond two rings
   * make. Broadest a little under halfway, as a hedgerow ash is.
   */
  crown(x: number, y: number, z: number, h: number, yaw: number): void {
    const step = Math.PI / TREE_SIDES;
    const base = this.point(x, y + 0.3 * h, z);
    const a = this.ring(x, y + 0.42 * h, z, 0.3 * h, yaw);
    const b = this.ring(x, y + 0.6 * h, z, 0.37 * h, yaw + step);
    const c = this.ring(x, y + 0.82 * h, z, 0.27 * h, yaw);
    this.bottom(base, a);
    this.band(a, b);
    this.band(b, c);
    this.top(c, this.point(x, y + h, z));
  }

  get empty(): boolean {
    return this.indices.length === 0;
  }

  finish(half: number): VertexData {
    const data = new VertexData();
    data.positions = this.positions;
    data.indices = this.indices;
    const normals: number[] = [];
    VertexData.ComputeNormals(this.positions, this.indices, normals);
    data.normals = normals;
    if (import.meta.env.DEV) assertOutsidePlay(this.positions, half);
    return data;
  }
}

/**
 * Walks the boundary square, inserting a fan of stations at each corner so the
 * outward normal sweeps through the turn. That fan makes the offset curve
 * `square ⊕ disc(t)` — the true outward offset — instead of a mitre that would
 * have to reach further out at the corner than anywhere else.
 *
 * The four corner stations are coincident in XZ, which leaves degenerate quads
 * in the basal band. They are dropped in `buildRing` rather than nudged apart:
 * moving them would mean moving them INWARD, past the boundary.
 */
function ringStations(half: number, corner: number): Station[] {
  const out: Station[] = [];
  // Travel and outward normal per side, in order N, E, S, W.
  const sides: [number, number, number, number, number, number][] = [
    [-half, half, 1, 0, 0, 1], // N: -X to +X, outward +Z
    [half, half, 0, -1, 1, 0], // E: +Z to -Z, outward +X
    [half, -half, -1, 0, 0, -1], // S: +X to -X, outward -Z
    [-half, -half, 0, 1, -1, 0], // W: -Z to +Z, outward -X
  ];
  const perSide = Math.max(2, Math.round((half * 2) / STATION_SPACING));
  for (let s = 0; s < 4; s++) {
    const [sx, sz, tx, tz, nx, nz] = sides[s];
    // The side's own stations, excluding the far end — the corner fan owns it.
    for (let i = 0; i < perSide; i++) {
      const d = (i / perSide) * half * 2;
      const x = sx + tx * d;
      const z = sz + tz * d;
      out.push({ x, z, nx, nz, r: Math.hypot(x, z) });
    }
    // The corner: one point, the normal swept 90 deg onto the next side's.
    const [, , , , mx, mz] = sides[(s + 1) % 4];
    const cx = sx + tx * half * 2;
    const cz = sz + tz * half * 2;
    const a0 = Math.atan2(nz, nx);
    let a1 = Math.atan2(mz, mx);
    // Always the short way round, and always outward.
    while (a1 - a0 > Math.PI) a1 -= Math.PI * 2;
    while (a1 - a0 < -Math.PI) a1 += Math.PI * 2;
    for (let i = 0; i <= corner; i++) {
      const a = a0 + ((a1 - a0) * i) / corner;
      out.push({
        x: cx,
        z: cz,
        nx: Math.cos(a),
        nz: Math.sin(a),
        r: Math.hypot(cx, cz),
      });
    }
  }
  return out;
}

/**
 * A cosine window over the ring for one pass, in station space. Returns a
 * 0..1 weight per station index.
 *
 * **Width is metres of boundary and the conversion assumes stations are
 * `STATION_SPACING` apart, which they are everywhere but a CORNER.** A corner
 * fan is stations at one point with the normal swept through them, so a pass
 * authored within a fan's width of one would be squeezed into that sweep rather
 * than cut into the side — and on the downs, whose fan is ninety-odd stations
 * rather than eight, it would be squeezed hard. Author a pass on a side; there
 * has never been a reason to want one in a corner, where two ranges meet.
 */
function passWindow(
  pass: RidgePass,
  stations: Station[],
  count: number,
): (i: number) => number {
  // Nearest station to the authored point — a pass is placed by where the thing
  // leaving the valley meets the rim, not by an arc length nobody can picture.
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < count; i++) {
    const d = (stations[i].x - pass.x) ** 2 + (stations[i].z - pass.z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  // Width is metres of boundary; stations are roughly STATION_SPACING apart.
  const halfSpan = Math.max(1, pass.width / 2 / STATION_SPACING);
  return (i: number): number => {
    let d = Math.abs(i - best);
    if (d > count / 2) d = count - d; // the ring wraps
    if (d >= halfSpan) return 0;
    return 0.5 + 0.5 * Math.cos((d / halfSpan) * Math.PI);
  };
}

/**
 * How far round the CREST's own curve each station stands, and what that curve
 * measures in total.
 *
 * A mouth's width is stated in these metres rather than in metres of boundary,
 * and the CORNERS are why. The crest stands `crestOut` outboard, so the curve
 * it traces is the boundary square offset outward — four straight sides and a
 * quarter circle at each corner — while a corner fan is stations at ONE point
 * with the normal swept through them, contributing a quarter circle of run
 * that the square itself contributes nothing of. On the downs that is 236 m a
 * corner against a 4 m square edge, so a width authored against the boundary
 * would put the taper most of a side away from where it was meant to be.
 *
 * It is the same offset curve `cornerStations` is derived from, read the other
 * way round — which is why the stations come out ~`STATION_SPACING` apart here
 * as well as along a side.
 */
function crestArc(
  stations: Station[],
  crestOut: number,
): { at: number[]; total: number } {
  const span = (a: Station, b: Station): number =>
    Math.hypot(
      b.x + b.nx * crestOut - (a.x + a.nx * crestOut),
      b.z + b.nz * crestOut - (a.z + a.nz * crestOut),
    );
  const at = new Array<number>(stations.length);
  let run = 0;
  for (let i = 0; i < stations.length; i++) {
    if (i > 0) run += span(stations[i - 1], stations[i]);
    at[i] = run;
  }
  // The ring closes, so the total takes in the step back to station 0.
  return { at, total: run + span(stations[stations.length - 1], stations[0]) };
}

/**
 * How OPEN the boundary is at each station for one mouth: 1 where the landform
 * is not to be drawn at all, 0 where it stands at full height, and smoothed
 * between.
 *
 * Smoothstep rather than `passWindow`'s cosine and rather than a straight
 * ramp, for the reason the borderland eases its own roll: this factor
 * multiplies the crest height and the reach together, so a C0 join would put a
 * crease down the hillside exactly where a headland meets the water, which is
 * the one part of the ramp anybody is looking at.
 */
function mouthWindow(
  mouth: RidgeMouth,
  stations: Station[],
  arc: { at: number[]; total: number },
): (i: number) => number {
  // Placed by the nearest station to the authored point, measured on the TOE —
  // `passWindow`'s convention, so the two fields are authored the same way
  // even though their widths are measured along different curves.
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < stations.length; i++) {
    const d = (stations[i].x - mouth.x) ** 2 + (stations[i].z - mouth.z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  const half = Math.max(0, mouth.width) / 2;
  const ease = Math.max(1e-3, mouth.ease ?? mouth.width / 4);
  const centre = arc.at[best];
  return (i: number): number => {
    let d = Math.abs(arc.at[i] - centre);
    if (d > arc.total / 2) d = arc.total - d; // the ring wraps
    const t = (half + ease - d) / ease;
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return t * t * (3 - 2 * t);
  };
}

/**
 * Accumulates the rim's quad strips.
 *
 * Winding, derived and checked against Babylon's `ComputeNormals`, which uses
 * `n = (p1 - p2) x (p3 - p2)` with a `+1` sign in the left-handed default: for
 * the strip between ring `j` (lower) and ring `j+1` (upper), with stations
 * advancing N -> E -> S -> W, emit `(a, b, c)` then `(a, c, d)` where
 * `a = ring[j][i]`, `b = ring[j][i+1]`, `c = ring[j+1][i+1]`, `d = ring[j+1][i]`.
 * On the north face that gives a normal pointing into the map, which is what we
 * want; the same order is correct on the crest cap and the back slope too.
 *
 * This is deliberately NOT TerrainField's `Accum`. That class states its
 * convention in world axes (-X/-Z, +X/-Z ...), which means something only for a
 * heightfield, and defaults to asserting every normal points up. A ring's
 * corners are (ring, station) pairs and its faces point sideways.
 */
class RingAccum {
  private readonly positions: number[] = [];
  private readonly indices: number[] = [];
  /** Vertices on the face you can actually see — see `assertFacesInward`. */
  private readonly front: number[] = [];

  vertex(x: number, y: number, z: number, front: boolean): number {
    this.positions.push(x, y, z);
    const at = this.positions.length / 3 - 1;
    if (front) this.front.push(at);
    return at;
  }

  /**
   * One quad, dropping degenerate halves. A zero-area triangle gives a zero
   * vertex normal, and `facetNormal()` picks its sign with
   * `dot(n, vNormalW) < 0.0` — which on a zero normal is a per-pixel coin
   * flip, i.e. speckled black facets. The corner fans produce these by
   * construction, so this is not defensive coding.
   */
  quad(a: number, b: number, c: number, d: number): void {
    if (this.area(a, b, c) > 1e-9) this.indices.push(a, b, c);
    if (this.area(a, c, d) > 1e-9) this.indices.push(a, c, d);
  }

  private area(a: number, b: number, c: number): number {
    const p = this.positions;
    const ax = p[a * 3] - p[b * 3];
    const ay = p[a * 3 + 1] - p[b * 3 + 1];
    const az = p[a * 3 + 2] - p[b * 3 + 2];
    const bx = p[c * 3] - p[b * 3];
    const by = p[c * 3 + 1] - p[b * 3 + 1];
    const bz = p[c * 3 + 2] - p[b * 3 + 2];
    const cx = ay * bz - az * by;
    const cy = az * bx - ax * bz;
    const cz = ax * by - ay * bx;
    return Math.hypot(cx, cy, cz) * 0.5;
  }

  get empty(): boolean {
    return this.indices.length === 0;
  }

  /**
   * No UVs: `CelMaterialFactory.get()` declares `["position", "normal"]` only,
   * so a UV buffer here would be uploaded and never read.
   */
  finish(half: number, inwardLimit: number): VertexData {
    const data = new VertexData();
    data.positions = this.positions;
    data.indices = this.indices;
    const normals: number[] = [];
    VertexData.ComputeNormals(this.positions, this.indices, normals);
    data.normals = normals;
    if (import.meta.env.DEV) {
      assertFacesInward(this.positions, normals, this.front, inwardLimit);
      assertOutsidePlay(this.positions, half);
    }
    return data;
  }
}

/**
 * The rim surrounds the map and is looked at from inside it, so its visible
 * faces point INWARD, toward the centre. An inverted winding flips every one of
 * them, and the only symptom is a boundary that is not drawn at all, with a
 * clean console — the same silent failure `assertFacesUp` exists for on the
 * floor.
 *
 * Measured over the FRONT rings only, and that is not a convenience. The back
 * slope legitimately faces outward, and its strips are several times longer
 * than the front's — `ComputeNormals` sums unnormalised face normals, so it is
 * weighted by area and the back outvotes the face over the whole mesh. Checking
 * everything at once would mean asserting a number near zero, which is no
 * assertion at all.
 *
 * **`limit` is the form's, because the number a correct front measures is a
 * statement about how steep the front IS.** A face leans inward by the sine of
 * its own pitch: the escarpment's is near vertical and measures about -0.9,
 * and the downs' is a 23-degree hillside and measures about -0.34, which is
 * exactly as correct and would trip a threshold set for a cliff. What the check
 * is actually for survives either way — an inverted winding flips the SIGN, so
 * a wrong rim of either form measures as positive as a right one measures
 * negative, and any limit between the two catches it.
 */
function assertFacesInward(
  positions: number[],
  normals: number[],
  front: number[],
  limit: number,
): void {
  let sum = 0;
  let n = 0;
  for (const v of front) {
    const x = positions[v * 3];
    const z = positions[v * 3 + 2];
    const len = Math.hypot(x, z);
    if (len < 1e-6) continue;
    sum += (normals[v * 3] * x + normals[v * 3 + 2] * z) / len;
    n++;
  }
  if (n > 0 && sum / n > limit) {
    throw new Error(
      `Ridge winding is inverted (mean outward dot ${(sum / n).toFixed(3)} ` +
        `over the front face, expected under ${limit}). See Ridge.ts — Babylon ` +
        "is left-handed and this failure is otherwise silent.",
    );
  }
}

/**
 * Nothing the rim draws may stand where a player can be. `half` is the MAP's
 * half-extent, handed down from `ridgeSegments` — the same number the boundary
 * boxes are placed at, which is the whole point of the check.
 */
function assertOutsidePlay(positions: number[], half: number): void {
  for (let i = 0; i < positions.length; i += 3) {
    const reach = Math.max(Math.abs(positions[i]), Math.abs(positions[i + 2]));
    if (reach < half - 1e-3) {
      throw new Error(
        `Ridge geometry at ${reach.toFixed(3)} m is inside the boundary ` +
          `(${half} m) — it would be stood inside. See Ridge.ts.`,
      );
    }
  }
}

/**
 * The trees on one segment of a rolling rim, as up to four meshes' worth of
 * geometry — conifer skirts, conifer tops, broadleaf crowns and the boles
 * under all of them.
 *
 * **Sown per QUAD of the face and weighted by its ground area**, never on a
 * grid of stations: a corner fan is ninety-odd stations at one toe point, so
 * anything counted per station would pile a forest into every corner. The
 * area of the quad's plan is what a tree needs, so the density is the same on
 * a side, in a fan and on a headland shrinking into the sea.
 *
 * **What makes it WOODS rather than a pile is the stand mask**: `planeNoise`
 * at a couple of hundred metres, cut at a threshold `woods` moves, so cover
 * comes as stands with pasture between them and raising `woods` grows the
 * stands rather than thinning out a carpet. The tops go bald and the foot
 * thins into the plain; broadleaf holds the lower slopes and conifer the
 * upper, which is what a hill that has never been planted does.
 *
 * Its own stream, seeded per run, so a tree never moves because a different
 * run changed.
 */
function sowWoods(
  rolling: RidgeRolling,
  rimSeed: number,
  s: number,
  from: number,
  to: number,
  count: number,
  surface: (Float64Array | null)[],
  profile: [number, number][],
  crestRing: number,
  half: number,
): RidgeSegment[] {
  const woods = Math.min(1, Math.max(0, rolling.woods ?? 0));
  const shore = rolling.shore ?? -Infinity;
  const rng = mulberry32((rimSeed ^ 0x574f4f44) + s * 0x9e3779b1);
  const stands = planeNoise(rimSeed ^ 0x5354414e, 70, 3);
  // The mask's midpoint moves with `woods`; the band either side of it is the
  // woods' EDGE, where trees come out into the open one at a time rather than
  // stopping at a line.
  const cut = 1 - woods;
  const needle = new TreeAccum();
  const needleLit = new TreeAccum();
  const leaf = new TreeAccum();
  const bark = new TreeAccum();
  const P = (col: Float64Array, j: number, axis: number): number =>
    col[j * 3 + axis];

  for (let k = from; k < to; k++) {
    const a = surface[k];
    const b = surface[(k + 1) % count];
    if (!a || !b) continue;
    // From the shoulder to one strip past the crest: trees standing just over
    // the top are what break the SKYLINE, which is where a wood on a hill is
    // read from furthest away.
    for (let j = 1; j <= crestRing; j++) {
      // The quad's plan area, by the shoelace over a0 b0 b1 a1.
      const xs = [P(a, j, 0), P(b, j, 0), P(b, j + 1, 0), P(a, j + 1, 0)];
      const zs = [P(a, j, 2), P(b, j, 2), P(b, j + 1, 2), P(a, j + 1, 2)];
      let area = 0;
      for (let q = 0; q < 4; q++) {
        area += xs[q] * zs[(q + 1) % 4] - xs[(q + 1) % 4] * zs[q];
      }
      area = Math.abs(area) / 2;
      const expect = area / TREE_AREA;
      let n = Math.floor(expect);
      if (rng() < expect - n) n++;
      for (let t = 0; t < n; t++) {
        const u = rng();
        const v = rng();
        const pick = rng();
        const size = rng();
        const yaw = rng() * Math.PI * 2;
        const at = (axis: number): number => {
          const lo = P(a, j, axis) + (P(b, j, axis) - P(a, j, axis)) * u;
          const hi =
            P(a, j + 1, axis) + (P(b, j + 1, axis) - P(a, j + 1, axis)) * u;
          return lo + (hi - lo) * v;
        };
        const x = at(0);
        const y = at(1);
        const z = at(2);
        if (y < shore) continue;
        // How far up the hill this is, as the profile's own height fraction.
        const f0 = j === 1 ? 0 : profile[j][1];
        const hf = f0 + (profile[j + 1][1] - f0) * v;
        let p = ease(cut - 0.1, cut + 0.1, stands(x, z));
        p *= 0.35 + 0.65 * ease(0, 0.12, hf); // thinning into the plain
        p *= 1 - 0.6 * ease(0.8, 1, hf); // bald tops
        if (rng() >= p) continue;
        const broad = pick < 0.12 + 0.6 * (1 - ease(0.2, 0.65, hf));
        const h = broad ? 8 + 5 * size : 8 + 8 * size * size;
        // Nothing the rim draws may stand where a player can: the crown's
        // reach, not the trunk's foot, is what `assertOutsidePlay` measures.
        const r = (broad ? 0.36 : 0.3) * h;
        if (Math.max(Math.abs(x), Math.abs(z)) - r < half + 0.25) continue;
        const y0 = y - 0.3; // sunk, so no downhill foot floats
        bark.trunk(x, y0, z, 0.035 * h, y0 + (broad ? 0.5 : 0.3) * h);
        if (broad) {
          leaf.crown(x, y0, z, h, yaw);
        } else {
          needle.cone(x, y0 + 0.08 * h, z, 0.3 * h, y0 + 0.72 * h, yaw);
          needleLit.cone(x, y0 + 0.46 * h, z, 0.2 * h, y0 + h, yaw + 0.5);
        }
      }
    }
  }

  const out: RidgeSegment[] = [];
  for (const [tone, acc] of [
    ["needle", needle],
    ["needleLit", needleLit],
    ["leaf", leaf],
    ["bark", bark],
  ] as const) {
    if (!acc.empty) out.push({ key: `${tone}-${s}`, tone, data: acc.finish(half) });
  }
  return out;
}

/**
 * Builds the rim as `SEGMENTS` runs per tone, for frustum culling and for
 * `WorldCulling`'s candidate list, both of which are answered per MESH.
 *
 * It had a second reason that has gone: the ink was a back-face shell whose
 * width was sized per mesh from `distance(boundingSphere.centerWorld, cam) -
 * radiusWorld`, so one mesh spanning the perimeter sat at full width forever
 * and painted a fat line across the horizon. A full-screen ink has no per-mesh
 * width to get wrong, so segmenting no longer defends against that — it is
 * worth keeping on the culling argument alone.
 */
export function ridgeSegments(
  spec: RidgeSpec | undefined,
  size: number,
  terrain: TerrainField,
): RidgeSegment[] {
  const half = size / 2;
  // **`none` is a map saying the horizon is already closed, and it is the one
  // form that emits nothing.** Every other map here needs a landform on its
  // boundary because there is nothing beyond it: the sky dome is flat
  // `fogColor` below the horizon and `paintStars` culls the lowest 7.2 deg
  // outright, so a boundary drawn by nothing shows as a dead band of sky with
  // the star field stopping in a line above it. What buys the exemption is not
  // the absence of a rim but the presence of something else out there — on
  // Cinderhaven a sea laid past `fogEnd` on every bearing, so the lowest
  // degrees of the frame are fogged water rather than empty dome, and the
  // starless band is the one the field's own `altFade` had already faded to
  // nothing before the cull line. A map that takes this form without laying
  // that something owes the picture the other two forms were paying for.
  if (spec?.form === "none") return [];
  // Which landform. Everything below is shared — the stations, the noise, the
  // pass windows, the crest solve and the emit loop are the rim's, not the
  // escarpment's — and the form picks the profile, the tone split and the two
  // places the shapes genuinely disagree: the basal band and the ledges.
  const downs = spec?.form === "downs";
  // A rolling rim cuts its face FINER, and the reason is the shader. A face
  // quad is one station wide (2.5 m) and one ring tall (~22 m), and a knoll
  // TWISTS it — the slope along the ring differs between its lower and upper
  // edge — so its two flat-shaded triangles lean different ways and the face
  // comes out as a row of saw teeth. The twist per quad is the change in the
  // knoll's weight between two rings, so splitting each span in `ROLL_SPLIT`
  // divides it by as much. Every other rim keeps its twelve rings exactly.
  const rolling: RidgeRolling | undefined = downs ? spec?.rolling : undefined;
  const split = rolling ? ROLL_SPLIT : 1;
  const profile = downs
    ? refineProfile(DOWNS_PROFILE, split)
    : PROFILE;
  const ringOf = (j: number): number => (j <= 1 ? j : 1 + (j - 1) * split);
  const crestRing = ringOf(CREST_RING);
  const screeRing = downs ? ringOf(DOWNS_SCREE_RING) : SCREE_RING;

  const reach = spec?.reach ?? 1;
  const stations = ringStations(
    half,
    cornerStations(profile[crestRing][0] * reach),
  );
  const count = stations.length;

  const rng = mulberry32(spec?.seed ?? 0x52494447);
  // **The downs' wander is COARSER, and that is about the shader rather than
  // about the shape.** Cel materials quantise the sky fill by how up-facing a
  // surface is (`band(0.5 + 0.5*n.y, 3.0)`), so a band's terminator lands
  // somewhere on any face whose normal turns gradually — and on the escarpment
  // it never does, because the ledges snap whole rings between bands and that
  // banding IS the rim's third tone. On a smooth hillside it lands mid-face,
  // and then every wobble in the geometry under it shows: the finest octave of
  // a 16-lattice noise repeats every ~9 m round the ring, which is two
  // stations, and a terminator crossing that comes out as a row of square teeth
  // a hundred metres long. A 4-lattice noise puts the same amplitude at four
  // times the wavelength — a gradient of 0.03 against 0.07 — and the line
  // crossing it reads as a contour instead. It is also what downs look like:
  // long broad swells rather than corrugation.
  const slopeNoise = periodicNoise(rng, 5, downs ? 4 : 16);
  const bulgeNoise = periodicNoise(rng, 3, 8);
  const ledgeNoise = periodicNoise(rng, 2, 128);
  const plinthNoise = periodicNoise(rng, 2, 64);

  const baseSlope = spec?.slope ?? 0.205;
  const variance = spec?.slopeVariance ?? 0.04;
  const windows = (spec?.passes ?? []).map((p) =>
    passWindow(p, stations, count),
  );
  const depths = (spec?.passes ?? []).map((p) => p.depth ?? 0.45);
  const arc = crestArc(stations, profile[crestRing][0] * reach);
  const mouths = (spec?.mouth ?? []).map((m) => mouthWindow(m, stations, arc));

  // **Rolling country, and it draws from none of the streams above.** Every
  // table here is filled from a stream of its OWN, seeded off the rim's, so a
  // map that states no `rolling` — every map but one — gets exactly the rim it
  // had, to the float, and one that does can retune it without moving a
  // single station of the slope noise under it.
  const rimSeed = spec?.seed ?? 0x52494447;
  const relief = rolling?.relief ?? 0.3;
  // The summits are measured round the CREST's curve, as a mouth is, so a
  // corner fan — ninety-odd stations at one point — is not a clump of hills.
  // Two octaves and no more: the finest is half a hill, never a ripple.
  const summitNoise = rolling
    ? periodicNoise(mulberry32(rimSeed ^ 0x53554d4d), 2, rolling.summits ?? 16)
    : null;
  const knolls = rolling?.knolls ?? 0.1;
  const knollNoise = rolling
    ? planeNoise(rimSeed ^ 0x4b4e4f4c, rolling.knollSize ?? 110, 2)
    : null;

  // --- per-station profile parameters -------------------------------------
  const crest: number[] = [];
  const bulge: number[] = [];
  const plinth: number[] = [];
  const ledge: number[] = [];
  const groundY: number[] = [];
  /**
   * What is LEFT of the landform at each station — 1 everywhere on a map that
   * states no mouth, and 0 where one is fully open.
   *
   * It multiplies the crest, the REACH and the shoulder rather than any one of
   * them, and that is the whole mechanism. A hill whose height alone went to
   * zero would leave a 310 m sheet of rock lying flat on the floor along the
   * opening; one whose reach alone went to zero would leave a spike. Both
   * together collapse the column onto its own toe, where every quad it makes
   * is degenerate and `RingAccum.quad` already drops those.
   */
  const shrink: number[] = [];
  for (let i = 0; i < count; i++) {
    const u = i / count;
    const st = stations[i];

    let open = 0;
    for (const m of mouths) open = Math.max(open, m(i));
    const left = 1 - open;
    shrink.push(left);

    let pass = 0;
    let slope = baseSlope + variance * (slopeNoise(u) * 2 - 1);
    for (let p = 0; p < windows.length; p++) {
      const w = windows[p](i);
      if (w <= 0) continue;
      pass = Math.max(pass, w);
      slope *= 1 - depths[p] * w;
    }
    // A summit or a saddle. Before the clamp, as a pass is, so the deepest col
    // this can make is still a saddle against the sky and never a hole in it.
    if (summitNoise) {
      slope *= 1 + relief * (summitNoise(arc.at[i] / arc.total) * 2 - 1) * 1.6;
    }
    // The clamp is what makes a pass safe: a saddle, never a hole in the sky.
    slope = Math.max(slope, MIN_SLOPE);

    // The crest sits further out than the toe, so its own radius is what the
    // angle is measured on — solved directly rather than iterated.
    const crestOut = profile[crestRing][0] * reach;
    const rCrest = st.r + crestOut;
    crest.push(rCrest * slope * left);

    // A pass is a SADDLE, not a cutting. Pulling the face in and raising the
    // basal band turns it into a sheer slot at the boundary, which reads as
    // quarrying rather than as a way out of the valley — so the profile is
    // left alone and only the basal band eases down, letting the ground fall
    // away into the gap the crest opens above it.
    // How far the profile's offsets are stretched at this station. The downs'
    // are narrower on purpose: the escarpment's offsets top out at 46 m, where
    // a swing of 0.7 to 1.55 is a face wandering in and out by a few metres,
    // and the same swing on a 310 m profile would put the crest anywhere
    // between 105 and 233 m out — a skyline that reads as damage rather than as
    // country. The rim's variation on this form belongs in the crest's HEIGHT,
    // which `slopeVariance` already owns.
    bulge.push(
      (downs ? 0.88 + 0.26 * bulgeNoise(u) : 0.7 + 0.85 * bulgeNoise(u)) *
        reach *
        left,
    );
    if (downs) {
      // The shoulder, not a plinth: a swell in the pasture. It still eases down
      // through a pass exactly as the band does, which is what lets a col read
      // as the ground falling away rather than as a notch cut in a skyline.
      //
      // Its FLOOR is load-bearing in a small way. `groundY` takes the lower of
      // the ground at the toe and the ground 1.5 m inside it, so on an outward
      // slope the toe sits under the floor's own outer edge — by at most 0.3 m,
      // which is 1.5 m at the steepest gradient the borderland can make. The
      // shoulder has to clear that or the floor overhangs the hill it runs into
      // and leaves a notch along the seam. 0.55 of `DOWNS_SHOULDER` is 0.33.
      const swell = DOWNS_SHOULDER * (0.55 + 0.45 * plinthNoise(u));
      plinth.push(swell * (1 - 0.55 * pass) * left);
      // No ledges: the whole point of this form is a face with nothing
      // horizontal in it, and a wobble of a few centimetres on rings whose
      // normals are already near the sky fill's band edge is the one thing
      // that would put the teeth back.
      ledge.push(0);
    } else {
      // The basal band must stay taller than anything that gets shot at, or the
      // face has already begun to batter outward at the height rounds arrive at
      // and they spark short of the rock you can see. PLINTH_FLOOR clears the
      // standing eye (1.55), the hit sphere's top (1.65) and CoverMap's
      // hard-cover height (1.7). The wander and the pass both ride ABOVE that
      // floor — a col eases the band down toward it, never through it.
      const band = PLINTH_FLOOR + 1.2 + 1.2 * (plinthNoise(u) * 2 - 1);
      plinth.push(
        (PLINTH_FLOOR + (band - PLINTH_FLOOR) * (1 - 0.55 * pass)) * left,
      );
      ledge.push((ledgeNoise(u) * 2 - 1) * 0.06);
    }

    // The toe takes the lower of the ground under it and the ground just
    // inside, so a terrain stroke at the rim cannot open a crack beneath it.
    const inX = st.x - st.nx * 1.5;
    const inZ = st.z - st.nz * 1.5;
    groundY.push(
      Math.min(terrain.heightAt(st.x, st.z), terrain.heightAt(inX, inZ)),
    );
  }

  // --- the surface ---------------------------------------------------------
  //
  // Every vertex the rim will emit, solved ONCE per station rather than once
  // per tone — the two tones share ring `screeRing`, and the woods stand on
  // the same points the faces are drawn through. `null` where a mouth has
  // taken the landform away outright: the column is a fan of degenerate
  // quads, and the strips either side of it have to BREAK rather than bridge
  // across the opening.
  const rings = profile.length;
  const surface: (Float64Array | null)[] = new Array(count);
  for (let i = 0; i < count; i++) {
    if (shrink[i] <= 1e-3) {
      surface[i] = null;
      continue;
    }
    const st = stations[i];
    const col = new Float64Array(rings * 3);
    for (let j = 0; j < rings; j++) {
      const [off, frac] = profile[j];
      let y: number;
      if (j === 0) y = groundY[i] - 0.4;
      else if (j === 1) y = groundY[i] + plinth[i];
      else if (j === rings - 1) y = groundY[i] + frac * 24 * shrink[i];
      else {
        const wob = j === 3 || j === 5 || j === 7 ? ledge[i] : 0;
        y = groundY[i] + (frac + wob) * crest[i];
      }
      // Rings 0 and 1 are the band, and the band is never bulged: on the
      // escarpment it is the vertical face and both offsets are 0, so this
      // changes nothing there; on the downs it keeps the shoulder's five
      // metres the same five metres all the way round, so what varies at
      // the foot of the hill is its height and not where it starts.
      // They are still SHRUNK by a mouth, or the shoulder's five metres would
      // still be five metres after everything above them had gone, and lay a
      // strip of rock along the floor the whole length of the opening.
      const t = off * (j <= 1 ? shrink[i] : bulge[i]);
      const x = st.x + st.nx * t;
      const z = st.z + st.nz * t;
      // A knoll or a hollow. Weighted `4f(1-f)` on the ring's own height
      // fraction, so it is nothing at the toe and nothing at the crest — the
      // seam with the floor and the skyline are where they were — and at its
      // strongest mid-face, where a hill has room to have a shape of its own.
      // `f(1-f)` also keeps the ring under the crest below it at any `knolls`
      // up to 0.25.
      if (knollNoise && j >= 2 && j < crestRing) {
        y += knolls * crest[i] * 4 * frac * (1 - frac) *
          (knollNoise(x, z) * 2 - 1);
      }
      col[j * 3] = x;
      col[j * 3 + 1] = y;
      col[j * 3 + 2] = z;
    }
    surface[i] = col;
  }

  // --- emit ---------------------------------------------------------------
  const out: RidgeSegment[] = [];
  const perSegment = Math.ceil(count / SEGMENTS);
  for (let s = 0; s < SEGMENTS; s++) {
    const from = s * perSegment;
    const to = Math.min(count, from + perSegment);
    if (from >= to) continue;
    for (const tone of ["scree", "rock"] as const) {
      const j0 = tone === "scree" ? 0 : screeRing;
      const j1 = tone === "scree" ? screeRing : profile.length - 1;
      const acc = new RingAccum();
      // One extra station so neighbouring segments share an edge; the ring
      // wraps, so the last segment's overhang is station 0.
      const cols: (number[] | null)[] = [];
      for (let k = from; k <= to; k++) {
        const src = surface[k % count];
        if (!src) {
          cols.push(null);
          continue;
        }
        const col: number[] = [];
        for (let j = j0; j <= j1; j++) {
          // The crest ring is shared with the first back strip, so its normal
          // is a blend — the winding check takes the rings below it only.
          col.push(
            acc.vertex(
              src[j * 3],
              src[j * 3 + 1],
              src[j * 3 + 2],
              j < crestRing,
            ),
          );
        }
        cols.push(col);
      }
      for (let c = 0; c + 1 < cols.length; c++) {
        const a = cols[c];
        const b = cols[c + 1];
        if (!a || !b) continue;
        for (let j = 0; j + 1 < a.length; j++) {
          acc.quad(a[j], b[j], b[j + 1], a[j + 1]);
        }
      }
      if (acc.empty) continue;
      out.push({
        key: `${tone}-${s}`,
        tone,
        data: acc.finish(half, downs ? DOWNS_INWARD_LIMIT : INWARD_LIMIT),
      });
    }
  }
  // The woods are cut COARSER than the rim, and that is the frame's bill: each
  // run is four draws (two needle tones, the leaf and the bark) where a rim
  // run is two, and every draw costs CPU in a frame bound by them. Measured on
  // Coldharbour at ten runs, the woods were 0.13-0.19 ms of the tick from
  // every vantage; at five, each culled as a unit, they are 0.04-0.10, and a
  // frustum looking into the town still drops most of them.
  if (rolling?.woods) {
    const perRun = Math.ceil(count / WOOD_RUNS);
    for (let w = 0; w < WOOD_RUNS; w++) {
      const from = w * perRun;
      const to = Math.min(count, from + perRun);
      if (from >= to) continue;
      out.push(
        ...sowWoods(
          rolling,
          rimSeed,
          w,
          from,
          to,
          count,
          surface,
          profile,
          crestRing,
          half,
        ),
      );
    }
  }
  return out;
}
