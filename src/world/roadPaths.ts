/**
 * roadPaths.ts — A road laid along a PATH, and the junctions a network of them
 * makes where they meet.
 * Owns: turning a `road` placement's `path` into a curved centreline (the
 * BEND), finding where paths meet — an end arriving at another path, ends
 * arriving together, two paths crossing — and resolving each meeting into one
 * JOIN: a paved patch with a kerb that curves between the carriageways, and a
 * cut on every road that ends in it. Also the footprint of all of it, for the
 * questions `roads.ts` answers. Pure arithmetic — no Babylon, no terrain — so
 * the client's builder, the authority and the grass field resolve the same
 * network off the same placements.
 *
 * **Why a path, when a road used to be a rectangle.** A rectangle is exactly
 * right for a street on a grid and exactly wrong for anything else. A road
 * that follows a shore was a chain of rectangles overlapping by half a width
 * at every leg, so each bend was a notch on the outside and a doubled sheet on
 * the inside; and a road meeting another at forty degrees ran its square end
 * out past the far kerb, because a rectangle has no way to stop along a line
 * that is not across it. Both are what "messy" was on Cinderhaven. A path
 * states the CENTRELINE instead, and both problems turn into arithmetic on it.
 *
 * **The bend is a circular arc tangent to both legs**, not a spline through
 * the points: an arc is how a carriageway is actually set out, it keeps the
 * two straights either side of a corner straight, and its offset — the kerb —
 * is another arc, so the carriageway keeps its width all the way round. Each
 * corner may take up to half of each leg beside it (`radius` caps it lower),
 * which is what a shore traced at thirty-metre intervals needs to read as a
 * curve rather than as a polygon with its corners filed.
 *
 * **A junction is decided by the NETWORK and a layout says nothing about it**,
 * the rule `ROAD_RANK` already holds for a crossing. Three shapes are found:
 *
 * - an end that lands on another path's carriageway (a T, at any angle) —
 *   the arriving road is cut on the other's centreline and the other runs on
 *   through;
 * - ends that land on each other (a corner, a fork, a three-way meeting) —
 *   all are cut at the point their centrelines agree on;
 * - two paths crossing — neither is cut.
 *
 * Each is one JOIN: every carriageway at the meeting is an ARM, and between two
 * neighbouring arms the kerb is a fillet arc (`ROAD_KERB`) where they make an
 * angle, a straight where they run on, and a round where the outside of a
 * corner opens past a half turn. The patch is paved in the surface of the road
 * running THROUGH it if there is one — a track leaving a street leaves from
 * the street's own apron — and in the best surface arriving otherwise.
 *
 * **Rectangles are untouched.** A `road` with no `path` is laid, cut and
 * tested exactly as it always was and is never an arm of anything, which is
 * what keeps every map that states none bit-identical. A path's end inside a
 * rectangle (a street arriving in a paved square) simply overlaps it, as every
 * road always has.
 *
 * Must NOT: read the terrain (a join is a plan; `TerrainField` drapes it),
 * build a mesh, or know which map it is on.
 */
import type { Placement } from "./layout";
import {
  ROAD_RANK,
  ROAD_WIDTH,
  roadFootprint,
  roadRects,
  roadSurface,
  roadTop,
  type RoadFootprint,
  type RoadSurface,
} from "./roads";

/**
 * How far an arc's chords may sag inside the true curve, in metres. A kerb
 * three centimetres off its circle is invisible from anywhere a player stands,
 * and it is what bounds the vertex count on a bend a kilometre round.
 */
export const ROAD_BEND_SAG = 0.03;

/** The largest angle one chord of any arc may turn through: 5 degrees. */
const ROAD_BEND_STEP = (5 * Math.PI) / 180;

/**
 * The tightest a bend may be drawn, as a fraction of the carriageway's width.
 * Under half a width the inner kerb's offset folds back over itself; 0.6 keeps
 * a margin, and a layout asking for less gets this.
 */
export const ROAD_BEND_MIN = 0.6;

/**
 * How far inside the point it rounds a bend may pass, in metres.
 *
 * A path is authored as the points a road goes THROUGH, and whatever stands
 * beside it was placed against those points. Rounded as far as its legs allow,
 * a thirteen-degree corner between two 190 m legs passes five and a half
 * metres inside its point — Cinderhaven's coast road did, onto a barn — while
 * a shore traced at thirty metres passes half a metre inside at most. Two
 * metres leaves the shore as round as it was and keeps a long road where it
 * was put: the same corner is rounded over seventy metres rather than a
 * hundred and ninety. Never tighter than `ROAD_BEND_MIN` for it.
 */
export const ROAD_BEND_CUT = 2;

/**
 * The kerb radius at a junction, as a fraction of the NARROWER of the two
 * carriageways it turns between. Half a width is the bellmouth a lane leaving a
 * road actually has; much more and a town's corner plots are paved over.
 */
export const ROAD_KERB = 0.5;

/**
 * How far along either carriageway a junction's kerb may run before it meets
 * it, as a multiple of the WIDER. A shallow meeting wants a long fillet and a
 * very shallow one wants an absurd one, so past this the radius is reduced,
 * and past what a sharp corner can reach the two roads are simply left
 * overlapping — which at that angle is what they already do.
 */
export const ROAD_KERB_REACH = 1.5;

/**
 * How far a join rides above a carriageway of its own surface: one millimetre,
 * half a `ROAD_RANK_STEP`. A join paved in the same surface as the road under
 * it is two sheets in one merged mesh, triangulated differently over the same
 * ground, and a tie between them is broken per pixel with slightly different
 * normals either side of it; half a rung settles it without reaching the next
 * surface's rank.
 */
export const ROAD_JOIN_LIFT = 0.001;

/** Within this of a half turn, a gap between two arms is a straight. */
const STRAIGHT = 0.05;

/**
 * The shallowest angle two carriageways are joined at, as its sine (20°).
 * Below it an end running alongside another road is not ARRIVING at it, and
 * cutting it on that road's centreline would cut it lengthways.
 */
const MIN_MEET = Math.sin((20 * Math.PI) / 180);

/** One point of a path, in whichever frame the caller is in. */
export type PathPoint = readonly [number, number];

/**
 * A path's corners rounded into arcs: the centreline a road is actually laid
 * along.
 *
 * Each interior point is replaced by an arc tangent to both legs, taking up to
 * half of each — less when `radius` asks for a tighter bend, or when the arc
 * would pass more than `ROAD_BEND_CUT` inside the point — and not asked for
 * tighter than `ROAD_BEND_MIN` of `width` by either cap. The ends are the
 * path's own.
 *
 * **`scripts/generate-cinderhaven.mjs` carries a twin of this**, because the
 * generator claims ground along the road it is about to emit and cannot import
 * TypeScript. The two must round a corner the same way or the claims sit a
 * metre off the carriageway on a long bend; nothing checks it but the plan.
 */
export function bendPath(
  pts: readonly PathPoint[],
  width: number,
  radius = Infinity,
): [number, number][] {
  const out: [number, number][] = [];
  const push = (x: number, z: number): void => {
    const last = out[out.length - 1];
    if (!last || Math.hypot(x - last[0], z - last[1]) > 1e-6) out.push([x, z]);
  };
  if (pts.length === 0) return out;
  push(pts[0][0], pts[0][1]);
  const rFloor = ROAD_BEND_MIN * width;
  const rCap = Math.max(radius, rFloor);
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, pz] = pts[i - 1];
    const [cx, cz] = pts[i];
    const [nx, nz] = pts[i + 1];
    const l1 = Math.hypot(cx - px, cz - pz);
    const l2 = Math.hypot(nx - cx, nz - cz);
    if (l1 < 1e-6 || l2 < 1e-6) continue;
    const d1x = (cx - px) / l1;
    const d1z = (cz - pz) / l1;
    const d2x = (nx - cx) / l2;
    const d2z = (nz - cz) / l2;
    const turn = Math.acos(Math.max(-1, Math.min(1, d1x * d2x + d1z * d2z)));
    // Straight on needs no arc, and a reversal has no arc that means anything.
    if (turn < 1e-4 || turn > Math.PI - 1e-3) {
      push(cx, cz);
      continue;
    }
    const tan = Math.tan(turn / 2);
    // An arc of radius R passes R * (sec - 1) inside its point, so the
    // tangent length that keeps that under the cut is cut * tan / (sec - 1).
    const byCut = (ROAD_BEND_CUT * tan) / (1 / Math.cos(turn / 2) - 1);
    const t = Math.min(0.5 * Math.min(l1, l2), rCap * tan, Math.max(byCut, rFloor * tan));
    const r = t / tan;
    // Which side the centre is on: the side the path turns toward. Anticlockwise
    // seen from above (+X right, +Z up the page) is a positive cross product,
    // and the left normal of d1 is (-d1z, d1x).
    const side = d1x * d2z - d1z * d2x > 0 ? 1 : -1;
    const ax = cx - d1x * t;
    const az = cz - d1z * t;
    const ox = ax - d1z * r * side;
    const oz = az + d1x * r * side;
    const n = arcSteps(turn, r);
    const a0 = Math.atan2(az - oz, ax - ox);
    push(ax, az);
    for (let k = 1; k < n; k++) {
      const a = a0 + (side * turn * k) / n;
      push(ox + Math.cos(a) * r, oz + Math.sin(a) * r);
    }
    push(cx + d2x * t, cz + d2z * t);
  }
  const last = pts[pts.length - 1];
  push(last[0], last[1]);
  return out;
}

/** How many chords an arc of `sweep` radians at radius `r` is drawn with. */
function arcSteps(sweep: number, r: number): number {
  const bySag = r > ROAD_BEND_SAG ? 2 * Math.acos(1 - ROAD_BEND_SAG / r) : ROAD_BEND_STEP;
  return Math.max(1, Math.ceil(Math.abs(sweep) / Math.min(ROAD_BEND_STEP, bySag)));
}

/** A point on a centreline and the unit tangent there. */
interface Frame {
  x: number;
  z: number;
  tx: number;
  tz: number;
}

/**
 * A centreline in world space, measured by ARC LENGTH — the one parameter a
 * cut, a crossing and a junction can all be stated in.
 */
export class RoadLine {
  readonly x: number[] = [];
  readonly z: number[] = [];
  /** Arc length at each point; `s[0]` is 0 and the last is `len`. */
  readonly s: number[] = [];
  readonly len: number;
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;

  constructor(pts: readonly PathPoint[]) {
    let s = 0;
    for (const [px, pz] of pts) {
      const n = this.x.length;
      if (n > 0) {
        const step = Math.hypot(px - this.x[n - 1], pz - this.z[n - 1]);
        if (step < 1e-6) continue;
        s += step;
      }
      this.x.push(px);
      this.z.push(pz);
      this.s.push(s);
    }
    this.len = s;
    this.minX = Math.min(...this.x);
    this.minZ = Math.min(...this.z);
    this.maxX = Math.max(...this.x);
    this.maxZ = Math.max(...this.z);
  }

  /** The segment holding arc length `s`, clamped to the first and the last. */
  seg(s: number): number {
    let lo = 0;
    let hi = this.s.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.s[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /**
   * Where the line is at arc length `s`, and which way it runs — carried on
   * straight past either end, because a road cut to meet a junction a little
   * beyond where it was authored to stop has to be extended along its own
   * bearing.
   */
  at(s: number): Frame {
    const i = this.seg(s);
    const dx = this.x[i + 1] - this.x[i];
    const dz = this.z[i + 1] - this.z[i];
    const l = this.s[i + 1] - this.s[i];
    const tx = dx / l;
    const tz = dz / l;
    const u = s - this.s[i];
    return { x: this.x[i] + tx * u, z: this.z[i] + tz * u, tx, tz };
  }

  /** The nearest point to (x, z) with arc length inside [sMin, sMax]. */
  nearest(x: number, z: number, sMin = 0, sMax = this.len): { s: number; d: number } {
    let best = { s: sMin, d: Infinity };
    for (let i = 0; i < this.s.length - 1; i++) {
      if (this.s[i + 1] < sMin || this.s[i] > sMax) continue;
      const ax = this.x[i];
      const az = this.z[i];
      const dx = this.x[i + 1] - ax;
      const dz = this.z[i + 1] - az;
      const l = this.s[i + 1] - this.s[i];
      let u = ((x - ax) * dx + (z - az) * dz) / (l * l);
      u = Math.max((sMin - this.s[i]) / l, Math.min((sMax - this.s[i]) / l, u));
      u = Math.max(0, Math.min(1, u));
      const d = Math.hypot(x - ax - dx * u, z - az - dz * u);
      if (d < best.d) best = { s: this.s[i] + l * u, d };
    }
    return best;
  }
}

/** One path road as the network sees it. */
interface PathRoad {
  /** Index of its placement in the layout — its identity for the builder. */
  index: number;
  line: RoadLine;
  width: number;
  hw: number;
  surface: RoadSurface;
  /** Arc lengths the carriageway is drawn between, once junctions have cut it. */
  cut0: number;
  cut1: number;
  /** Whether each end is joined — an unjoined end is a kerb of its own. */
  joined0: boolean;
  joined1: boolean;
}

/** One carriageway at a junction. */
interface Arm {
  road: PathRoad;
  /** Runs on through the junction rather than ending in it. */
  through: boolean;
  /** Which end arrives, for an arm that does not run through. */
  end: 0 | 1;
  /** Arc length on its own line at the junction. */
  s: number;
  /** Unit direction from the junction out along the carriageway. */
  ax: number;
  az: number;
  hw: number;
  /** How far the carriageway runs out from the junction before it stops. */
  avail: number;
  /** How far out the junction's patch reaches along it — resolved last. */
  e: number;
  ang: number;
}

/**
 * The stretch of carriageway one path placement draws: its line between the
 * cuts the network made on it.
 */
export interface RoadStrip {
  index: number;
  surface: RoadSurface;
  top: number;
  hw: number;
  line: RoadLine;
  s0: number;
  s1: number;
  /** Whether each end is its own kerb, rather than abutting a join. */
  free0: boolean;
  free1: boolean;
}

/**
 * One junction's paved patch, in world XZ: a ring anticlockwise seen from
 * above, star-shaped about (x, z), which is what lets it be drawn as a fan.
 */
export interface RoadJoin {
  surface: RoadSurface;
  top: number;
  x: number;
  z: number;
  xs: number[];
  zs: number[];
  /**
   * Per ring segment (k to k+1): whether it borders open GROUND and so owes a
   * skirt. False along a cap the arm's own carriageway continues from, and
   * along a through road's kerb, which that road already skirts.
   */
  kerb: boolean[];
}

/** What a layout's roads resolve to. */
export interface RoadNetwork {
  footprint: RoadFootprint;
  /** Keyed by placement index. A path wholly inside its junctions has none. */
  strips: ReadonlyMap<number, RoadStrip>;
  /** Keyed by the placement index that DRAWS each join. */
  joins: ReadonlyMap<number, readonly RoadJoin[]>;
}

/** A cross-section of a strip, world XZ: centre, left kerb, right kerb. */
export interface RoadSection {
  cx: number;
  cz: number;
  lx: number;
  lz: number;
  rx: number;
  rz: number;
}

/**
 * Every road in a layout: the rectangles as they always were, and the paths
 * with their bends drawn and their junctions resolved.
 */
export function roadNetwork(placements: readonly Placement[]): RoadNetwork {
  const roads = pathRoads(placements);
  const joins = new Map<number, RoadJoin[]>();
  const nodes: { x: number; z: number }[] = [];

  const add = (x: number, z: number, arms: Arm[]): void => {
    const join = resolve(x, z, arms);
    nodes.push({ x, z });
    if (!join) return;
    const owner = ownerOf(arms);
    const list = joins.get(owner) ?? [];
    list.push(join);
    joins.set(owner, list);
  };

  for (const node of endNodes(roads)) add(node.x, node.z, node.arms);
  for (const node of crossings(roads, nodes)) add(node.x, node.z, node.arms);

  const strips = new Map<number, RoadStrip>();
  const polygons: { xs: number[]; zs: number[]; top: number }[] = [];
  for (const r of roads) {
    const s0 = r.joined0 ? r.cut0 : 0;
    const s1 = r.joined1 ? r.cut1 : r.line.len;
    if (s1 - s0 < 0.05) continue;
    const strip: RoadStrip = {
      index: r.index,
      surface: r.surface,
      top: roadTop(r.surface),
      hw: r.hw,
      line: r.line,
      s0,
      s1,
      free0: !r.joined0,
      free1: !r.joined1,
    };
    strips.set(r.index, strip);
    const sec = stripSections(strip);
    for (let k = 0; k + 1 < sec.length; k++) {
      const a = sec[k];
      const b = sec[k + 1];
      polygons.push({ xs: [a.rx, b.rx, b.lx, a.lx], zs: [a.rz, b.rz, b.lz, a.lz], top: strip.top });
    }
  }
  for (const list of joins.values()) {
    for (const j of list) {
      const n = j.xs.length;
      for (let k = 0; k < n; k++) {
        const bx = j.xs[k];
        const bz = j.zs[k];
        const cx = j.xs[(k + 1) % n];
        const cz = j.zs[(k + 1) % n];
        const area = (bx - j.x) * (cz - j.z) - (bz - j.z) * (cx - j.x);
        if (Math.abs(area) < 1e-9) continue;
        polygons.push(
          area > 0
            ? { xs: [j.x, bx, cx], zs: [j.z, bz, cz], top: j.top }
            : { xs: [j.x, cx, bx], zs: [j.z, cz, bz], top: j.top },
        );
      }
    }
  }

  return {
    footprint: roadFootprint(roadRects(placements), polygons),
    strips,
    joins,
  };
}

/**
 * A strip's cross-sections: at its two cuts and at every point of its line
 * between them. At a point the kerbs are MITRED — offset along the bisector of
 * the two chords meeting there, stretched to keep the width — so a carriageway
 * drawn round a bend is its full width the whole way.
 */
export function stripSections(strip: RoadStrip): RoadSection[] {
  const { line, hw, s0, s1 } = strip;
  const out: RoadSection[] = [];
  const section = (x: number, z: number, tx: number, tz: number, stretch: number): void => {
    // Left of the tangent, anticlockwise seen from above.
    const nx = -tz * hw * stretch;
    const nz = tx * hw * stretch;
    out.push({ cx: x, cz: z, lx: x + nx, lz: z + nz, rx: x - nx, rz: z - nz });
  };
  const first = line.at(s0);
  section(first.x, first.z, first.tx, first.tz, 1);
  for (let i = 1; i < line.s.length - 1; i++) {
    if (line.s[i] <= s0 + 1e-6 || line.s[i] >= s1 - 1e-6) continue;
    const ax = line.x[i] - line.x[i - 1];
    const az = line.z[i] - line.z[i - 1];
    const bx = line.x[i + 1] - line.x[i];
    const bz = line.z[i + 1] - line.z[i];
    const la = Math.hypot(ax, az);
    const lb = Math.hypot(bx, bz);
    let tx = ax / la + bx / lb;
    let tz = az / la + bz / lb;
    const lt = Math.hypot(tx, tz);
    if (lt < 1e-9) {
      tx = ax / la;
      tz = az / la;
    } else {
      tx /= lt;
      tz /= lt;
    }
    const cos = (tx * ax + tz * az) / la;
    section(line.x[i], line.z[i], tx, tz, 1 / Math.max(0.5, cos));
  }
  const last = line.at(s1);
  section(last.x, last.z, last.tx, last.tz, 1);
  return out;
}

/** The `road` placements with a usable path, in world space. */
function pathRoads(placements: readonly Placement[]): PathRoad[] {
  const out: PathRoad[] = [];
  placements.forEach((p, index) => {
    const path = p.kind === "road" ? p.params?.path : undefined;
    if (!path || path.length < 2) return;
    const width = p.params?.width ?? ROAD_WIDTH;
    // The placement's own frame into the world: MapBuilder's `rotateY`.
    const rot = p.rotY ?? 0;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const world = path.map(
      ([lx, lz]) => [p.x + lx * c + lz * s, p.z - lx * s + lz * c] as const,
    );
    const line = new RoadLine(bendPath(world, width, p.params?.radius));
    if (line.s.length < 2 || line.len < 1e-3) return;
    out.push({
      index,
      line,
      width,
      hw: width / 2,
      surface: roadSurface(p.params?.surface),
      cut0: 0,
      cut1: line.len,
      joined0: false,
      joined1: false,
    });
  });
  return out;
}

/** One end of a path, with the direction pointing OUT of the carriageway. */
interface End {
  road: PathRoad;
  end: 0 | 1;
  x: number;
  z: number;
  ux: number;
  uz: number;
}

/**
 * The junctions made by ENDS: ends that land on each other, and an end (or a
 * group of them) that lands on another path's carriageway.
 */
function endNodes(roads: readonly PathRoad[]): { x: number; z: number; arms: Arm[] }[] {
  const ends: End[] = [];
  for (const road of roads) {
    const a = road.line.at(0);
    const b = road.line.at(road.line.len);
    ends.push({ road, end: 0, x: a.x, z: a.z, ux: -a.tx, uz: -a.tz });
    ends.push({ road, end: 1, x: b.x, z: b.z, ux: b.tx, uz: b.tz });
  }

  // Ends that land on each other, grouped transitively. Two ends meet when
  // they are within half the sum of their widths — which takes in the corner
  // of a street grid, where the two carriageways' ends sit diagonally apart by
  // 0.7 of a width, and turns away two parallel lanes that merely start level.
  const parent = ends.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      const a = ends[i];
      const b = ends[j];
      if (a.road === b.road) continue;
      if (Math.hypot(a.x - b.x, a.z - b.z) <= (a.road.hw + b.road.hw)) {
        parent[find(i)] = find(j);
      }
    }
  }
  const groups = new Map<number, End[]>();
  ends.forEach((e, i) => {
    const g = groups.get(find(i)) ?? [];
    g.push(e);
    groups.set(find(i), g);
  });

  const out: { x: number; z: number; arms: Arm[] }[] = [];
  for (const group of groups.values()) {
    let [x, z] = meetingPoint(group);
    const own = new Set(group.map((e) => e.road));
    // A lone end that lands short of or a little past a carriageway still
    // arrives at it — by up to its own width either side; a group already
    // agrees where it is, and is only drawn onto a road it is standing on.
    const tol =
      group.length === 1 ? group[0].road.width : 0.5 * Math.min(...group.map((e) => e.road.width));
    const host = findHost(roads, own, x, z, tol, group);
    if (group.length === 1 && !host) continue;

    const arms: Arm[] = [];
    if (host) {
      const f = host.road.line.at(host.s);
      x = f.x;
      z = f.z;
      arms.push(throughArm(host.road, host.s, f, 1), throughArm(host.road, host.s, f, -1));
    }
    for (const e of group) arms.push(endArm(e, x, z));
    out.push({ x, z, arms });
  }
  return out;
}

/**
 * Where a group of ends meets: the point nearest, in least squares, to every
 * one of their centrelines carried on — which is the corner of a grid, the
 * fork of a Y, and for one end the end itself. Falls back to the average when
 * the lines are too near parallel to agree on anywhere.
 */
function meetingPoint(group: readonly End[]): [number, number] {
  let mx = 0;
  let mz = 0;
  for (const e of group) {
    mx += e.x / group.length;
    mz += e.z / group.length;
  }
  if (group.length < 2) return [mx, mz];
  let a = 0;
  let b = 0;
  let d = 0;
  let bx = 0;
  let bz = 0;
  for (const e of group) {
    // (I - u u^T), and the same applied to the end point.
    const xx = 1 - e.ux * e.ux;
    const xz = -e.ux * e.uz;
    const zz = 1 - e.uz * e.uz;
    a += xx;
    b += xz;
    d += zz;
    bx += xx * e.x + xz * e.z;
    bz += xz * e.x + zz * e.z;
  }
  const det = a * d - b * b;
  if (det < 0.05 * group.length) return [mx, mz];
  const x = (d * bx - b * bz) / det;
  const z = (a * bz - b * bx) / det;
  const reach = 2 * Math.max(...group.map((e) => e.road.width));
  return Math.hypot(x - mx, z - mz) > reach ? [mx, mz] : [x, z];
}

/**
 * The path whose carriageway (x, z) lands on, within `tol` past its kerb and
 * away from its own ends, and met at no shallower than `MIN_MEET` by every
 * arriving end — the nearest such, or null.
 */
function findHost(
  roads: readonly PathRoad[],
  exclude: ReadonlySet<PathRoad>,
  x: number,
  z: number,
  tol: number,
  arriving: readonly End[],
): { road: PathRoad; s: number } | null {
  let best: { road: PathRoad; s: number; d: number } | null = null;
  for (const road of roads) {
    if (exclude.has(road)) continue;
    const reach = road.hw + tol;
    const l = road.line;
    if (x < l.minX - reach || x > l.maxX + reach || z < l.minZ - reach || z > l.maxZ + reach) {
      continue;
    }
    const near = l.nearest(x, z);
    if (near.d > reach || near.s < 0.5 || near.s > l.len - 0.5) continue;
    const f = l.at(near.s);
    if (arriving.some((e) => Math.abs(e.ux * f.tz - e.uz * f.tx) < MIN_MEET)) continue;
    if (!best || near.d < best.d) best = { road, s: near.s, d: near.d };
  }
  return best;
}

/** The two arms of a road that runs through a junction at arc length `s`. */
function throughArm(road: PathRoad, s: number, f: Frame, dir: 1 | -1): Arm {
  const ax = f.tx * dir;
  const az = f.tz * dir;
  return {
    road,
    through: true,
    end: dir > 0 ? 1 : 0,
    s,
    ax,
    az,
    hw: road.hw,
    avail: dir > 0 ? road.line.len - s : s,
    e: 0,
    ang: Math.atan2(az, ax),
  };
}

/** The arm of a road whose end arrives at (x, z). */
function endArm(e: End, x: number, z: number): Arm {
  const l = e.road.line;
  // Only the last stretch of the road is searched, so a road that curls back
  // past its own junction is not cut in the wrong place.
  const span = 4 * (e.road.width + 8);
  let s: number;
  if (e.end === 1) {
    s = l.nearest(x, z, Math.max(0, l.len - span), l.len).s;
    if (s >= l.len - 1e-6) {
      const f = l.at(l.len);
      s = l.len + Math.max(0, (x - f.x) * f.tx + (z - f.z) * f.tz);
    }
  } else {
    s = l.nearest(x, z, 0, Math.min(l.len, span)).s;
    if (s <= 1e-6) {
      const f = l.at(0);
      s = -Math.max(0, -((x - f.x) * f.tx + (z - f.z) * f.tz));
    }
  }
  const f = l.at(s);
  const dir = e.end === 1 ? -1 : 1;
  const ax = f.tx * dir;
  const az = f.tz * dir;
  return {
    road: e.road,
    through: false,
    end: e.end,
    s,
    ax,
    az,
    hw: e.road.hw,
    avail: e.end === 1 ? s : l.len - s,
    e: 0,
    ang: Math.atan2(az, ax),
  };
}

/**
 * The junctions made where two paths CROSS — neither ending there — away from
 * every junction the ends have already made.
 */
function crossings(
  roads: readonly PathRoad[],
  taken: readonly { x: number; z: number }[],
): { x: number; z: number; arms: Arm[] }[] {
  const out: { x: number; z: number; arms: Arm[] }[] = [];
  const near = (x: number, z: number, r: number): boolean =>
    taken.some((n) => Math.hypot(n.x - x, n.z - z) < r) ||
    out.some((n) => Math.hypot(n.x - x, n.z - z) < r);
  for (let ia = 0; ia < roads.length; ia++) {
    const a = roads[ia].line;
    for (let ib = ia + 1; ib < roads.length; ib++) {
      const b = roads[ib].line;
      if (a.maxX < b.minX || b.maxX < a.minX || a.maxZ < b.minZ || b.maxZ < a.minZ) continue;
      for (let i = 0; i + 1 < a.s.length; i++) {
        const px = a.x[i];
        const pz = a.z[i];
        const rx = a.x[i + 1] - px;
        const rz = a.z[i + 1] - pz;
        for (let j = 0; j + 1 < b.s.length; j++) {
          const qx = b.x[j];
          const qz = b.z[j];
          const sx = b.x[j + 1] - qx;
          const sz = b.z[j + 1] - qz;
          if (
            Math.max(px, px + rx) < Math.min(qx, qx + sx) ||
            Math.max(qx, qx + sx) < Math.min(px, px + rx) ||
            Math.max(pz, pz + rz) < Math.min(qz, qz + sz) ||
            Math.max(qz, qz + sz) < Math.min(pz, pz + rz)
          ) {
            continue;
          }
          const den = rx * sz - rz * sx;
          const lr = a.s[i + 1] - a.s[i];
          const ls = b.s[j + 1] - b.s[j];
          const sin = Math.abs(den) / (lr * ls);
          if (sin < MIN_MEET) continue;
          const t = ((qx - px) * sz - (qz - pz) * sx) / den;
          const u = ((qx - px) * rz - (qz - pz) * rx) / den;
          // Half-open, so a crossing exactly on a vertex is counted once.
          if (t < 0 || t >= 1 || u < 0 || u >= 1) continue;
          const ra = roads[ia];
          const rb = roads[ib];
          const sa = a.s[i] + lr * t;
          const sb = b.s[j] + ls * u;
          // Near either road's END, this is an end arriving — handled above,
          // or deliberately left alone there — rather than a crossing.
          const endA = (rb.hw + ra.width) / sin + 0.5;
          const endB = (ra.hw + rb.width) / sin + 0.5;
          if (sa < endA || sa > a.len - endA || sb < endB || sb > b.len - endB) continue;
          const x = px + rx * t;
          const z = pz + rz * t;
          if (near(x, z, Math.max(ra.width, rb.width))) continue;
          const fa = a.at(sa);
          const fb = b.at(sb);
          out.push({
            x,
            z,
            arms: [
              throughArm(ra, sa, fa, 1),
              throughArm(ra, sa, fa, -1),
              throughArm(rb, sb, fb, 1),
              throughArm(rb, sb, fb, -1),
            ],
          });
        }
      }
    }
  }
  return out;
}

/** The arm whose placement draws a join, and whose surface it is paved in. */
function best(arms: readonly Arm[]): Arm {
  const through = arms.filter((a) => a.through);
  const pool = through.length > 0 ? through : arms;
  return pool.reduce((m, a) =>
    ROAD_RANK[a.road.surface] > ROAD_RANK[m.road.surface] ||
    (ROAD_RANK[a.road.surface] === ROAD_RANK[m.road.surface] && a.road.index < m.road.index)
      ? a
      : m,
  );
}

function ownerOf(arms: readonly Arm[]): number {
  return best(arms).road.index;
}

/** What lies between two neighbouring arms, going anticlockwise from `i` to `j`. */
type Gap =
  | { kind: "fillet"; ti: number; tj: number; pts: number[] }
  | { kind: "chord" }
  | { kind: "straight" }
  | { kind: "round"; pts: number[] };

/**
 * The kerb between arm `i`'s LEFT edge and arm `j`'s RIGHT edge, `phi` radians
 * anticlockwise apart. See `ROAD_KERB` and `ROAD_KERB_REACH`.
 */
function gapBetween(x: number, z: number, i: Arm, j: Arm, phi: number): Gap {
  const nix = -i.az;
  const niz = i.ax;
  const njx = -j.az;
  const njz = j.ax;
  if (phi > Math.PI + STRAIGHT) {
    // The outside of a corner: round it about the junction itself, from arm
    // i's left kerb to arm j's right kerb.
    const pts: number[] = [];
    const sweep = phi - Math.PI;
    const r = Math.max(i.hw, j.hw);
    const n = arcSteps(sweep, r);
    const a0 = Math.atan2(niz, nix);
    for (let k = 0; k <= n; k++) {
      const f = k / n;
      const rad = i.hw + (j.hw - i.hw) * f;
      const a = a0 + sweep * f;
      pts.push(x + Math.cos(a) * rad, z + Math.sin(a) * rad);
    }
    return { kind: "round", pts };
  }
  if (phi >= Math.PI - STRAIGHT) return { kind: "straight" };

  // Where the two kerbs, each pushed `r` into the gap, cross: the fillet's
  // centre. Linear in r, so solved at 0 and at the full radius and scaled.
  const solve = (r: number): [number, number] => {
    const dx = -njx * (j.hw + r) - nix * (i.hw + r);
    const dz = -njz * (j.hw + r) - niz * (i.hw + r);
    // i.a * t - j.a * u = d
    const det = -i.ax * j.az + j.ax * i.az;
    const t = (-dx * j.az + j.ax * dz) / det;
    const u = (i.ax * dz - dx * i.az) / det;
    return [t, u];
  };
  const reach = ROAD_KERB_REACH * 2 * Math.max(i.hw, j.hw);
  let r = ROAD_KERB * 2 * Math.min(i.hw, j.hw);
  const [t0, u0] = solve(0);
  // Two arms nearly on top of each other have kerbs that never cross, or cross
  // so far out that the carriageways overlap the whole way there: leave them
  // overlapping.
  if (!Number.isFinite(t0) || !Number.isFinite(u0) || Math.max(t0, u0) > reach) {
    return { kind: "chord" };
  }
  let [t, u] = solve(r);
  if (Math.max(t, u) > reach) {
    let scale = 1;
    if (t > reach) scale = Math.min(scale, (reach - t0) / (t - t0));
    if (u > reach) scale = Math.min(scale, (reach - u0) / (u - u0));
    r *= Math.max(0, scale);
    [t, u] = solve(r);
  }
  const ox = x + nix * (i.hw + r) + i.ax * t;
  const oz = z + niz * (i.hw + r) + i.az * t;
  const pts: number[] = [];
  const sweep = -(Math.PI - phi);
  const n = r > 1e-6 ? arcSteps(sweep, r) : 0;
  const a0 = Math.atan2(-niz, -nix);
  for (let k = 0; k <= n; k++) {
    const a = a0 + (sweep * k) / Math.max(1, n);
    pts.push(ox + Math.cos(a) * r, oz + Math.sin(a) * r);
  }
  return { kind: "fillet", ti: t, tj: u, pts };
}

/**
 * One junction's patch, and the cuts it makes on every arm that ends in it.
 * Null when the patch has no area — two paths continuing straight into each
 * other need nothing but the two cuts.
 */
function resolve(x: number, z: number, arms: Arm[]): RoadJoin | null {
  if (arms.length < 2) return null;
  arms.sort((a, b) => a.ang - b.ang);
  const n = arms.length;
  const gaps: Gap[] = [];
  for (let k = 0; k < n; k++) {
    const i = arms[k];
    const j = arms[(k + 1) % n];
    let phi = j.ang - i.ang;
    if (phi <= 0) phi += 2 * Math.PI;
    const gap = gapBetween(x, z, i, j, phi);
    gaps.push(gap);
    if (gap.kind === "fillet") {
      i.e = Math.max(i.e, gap.ti);
      j.e = Math.max(j.e, gap.tj);
    }
  }
  // An arm that ends here must end clear of any road running through: its cap
  // may not lie across that road's carriageway.
  for (const arm of arms) {
    if (arm.through) continue;
    for (const host of arms) {
      if (!host.through) continue;
      const sin = Math.max(MIN_MEET, Math.abs(arm.ax * host.az - arm.az * host.ax));
      const cos = Math.abs(arm.ax * host.ax + arm.az * host.az);
      arm.e = Math.max(arm.e, (host.hw + arm.hw * cos) / sin);
    }
  }
  for (const arm of arms) {
    arm.e = Math.max(0, Math.min(arm.e, arm.through ? arm.avail : arm.avail - 0.25));
  }

  const xs: number[] = [];
  const zs: number[] = [];
  const kerb: boolean[] = [];
  const put = (px: number, pz: number, k: boolean): void => {
    xs.push(px);
    zs.push(pz);
    kerb.push(k);
  };
  for (let k = 0; k < n; k++) {
    const i = arms[k];
    const j = arms[(k + 1) % n];
    const gap = gaps[k];
    const nix = -i.az;
    const niz = i.ax;
    // The cap: across the arm at its reach, never a kerb.
    put(x - nix * i.hw + i.ax * i.e, z - niz * i.hw + i.az * i.e, false);
    const lx = x + nix * i.hw + i.ax * i.e;
    const lz = z + niz * i.hw + i.az * i.e;
    switch (gap.kind) {
      case "fillet": {
        put(lx, lz, !i.through);
        for (let p = 0; p < gap.pts.length; p += 2) {
          const lastPt = p + 2 >= gap.pts.length;
          put(gap.pts[p], gap.pts[p + 1], lastPt ? !j.through : true);
        }
        break;
      }
      case "round": {
        put(lx, lz, !i.through);
        for (let p = 0; p < gap.pts.length; p += 2) {
          const lastPt = p + 2 >= gap.pts.length;
          put(gap.pts[p], gap.pts[p + 1], lastPt ? !j.through : true);
        }
        break;
      }
      case "straight":
        put(lx, lz, !(i.through && j.through));
        break;
      case "chord":
        put(lx, lz, false);
        break;
    }
  }

  for (const arm of arms) {
    if (arm.through) continue;
    if (arm.end === 1) {
      arm.road.cut1 = arm.s - arm.e;
      arm.road.joined1 = true;
    } else {
      arm.road.cut0 = arm.s + arm.e;
      arm.road.joined0 = true;
    }
  }

  let area = 0;
  for (let k = 0; k < xs.length; k++) {
    const k1 = (k + 1) % xs.length;
    area += xs[k] * zs[k1] - xs[k1] * zs[k];
  }
  if (area / 2 < 0.01) return null;
  const surface = best(arms).road.surface;
  return { surface, top: roadTop(surface) + ROAD_JOIN_LIFT, x, z, xs, zs, kerb };
}
