/**
 * props/boulder.ts — buildBoulder: the glacial erratic, and the rock it is cut
 * from. Part of the scatter set: follows the contract in `./index.ts`.
 */
import { Matrix, Mesh, Scene, Vector3, VertexData } from "@babylonjs/core";
import type { CelMaterialFactory } from "../../shaders/CelShader";
import { partSurface } from "../parts";
import { type Flat, geodesic, prismData, tri } from "./geometry";

/**
 * The boulder's two stones. `BOULDER` is the weathered skin — the rounded mass
 * and the joint faces the ice broke it along, which are the same rock a few
 * thousand years later and so the same colour. `BOULDER_DARK` is what has not
 * weathered or never sees the sky: the inside of a frost cleft and the spalls
 * lying at the foot. Both are the colours the octahedron wore, so the rework
 * costs no draw call.
 */
const BOULDER = "#565d59";
const BOULDER_DARK = "#474e4a";

/**
 * How many draws `buildBoulder` takes from the shared scatter stream — the
 * number the octahedron it replaced took (its stretch, its tilt and the
 * shoulder stone's three turns), fixed there so redrawing it moved no prop on
 * any map. See its header.
 */
const BOULDER_SHARED_DRAWS = 7;

/**
 * Subdivisions of the geodesic a boulder's mass is drawn over: 162 directions,
 * an edge about a third of a metre round a stone two metres across — fine
 * enough that a joint face's outline wanders and an arris rounds, coarse
 * enough for 414 of them. A split stone draws it twice.
 */
const BOULDER_LEVEL = 2;

/** One flat face cut through a rock: whatever lies past `n·p = c` is laid onto it. */
interface RockCut {
  n: readonly [number, number, number];
  c: number;
  /** Drawn in `BOULDER_DARK` — the inside of a cleft, not a weathered joint. */
  dark?: boolean;
}

/** A rock's geometry in its two colours, either of which may be empty. */
interface RockSheets {
  skin: VertexData[];
  dark: VertexData[];
}

/**
 * A rock: the geodesic at `level` carried out to `place(direction)`, then cut
 * flat by each of `cuts` in turn, then moved by `m` (a rotation and a
 * translation only — `VertexData.transform` does not re-normalise).
 *
 * **Rounded where the ice wore it, flat where it broke.** A face lying wholly
 * on one cut is FLAT-shaded in that cut's normal, so a joint face is one tone
 * with a hard edge the ink draws; every other face shares its vertices and a
 * normal averaged over its neighbours, so the worn surface bands round the
 * stone rather than breaking into facets. It does not hide the lattice
 * entirely: the shadow map tests the real triangles, so where its terminator
 * crosses a broad stretch of skin the triangles show — which is why
 * `buildBoulder` keeps the skin narrow. The ring of faces straddling a cut's
 * edge are the smooth kind, which is the arris rounded off.
 */
function rockData(
  level: number,
  place: (u: readonly number[]) => number[],
  cuts: readonly RockCut[],
  m: Matrix,
  out: RockSheets,
): void {
  const g = geodesic(level);
  const P = g.pts.map(place);
  for (const { n, c } of cuts) {
    for (const p of P) {
      const d = n[0] * p[0] + n[1] * p[1] + n[2] * p[2] - c;
      if (d > 0) {
        p[0] -= n[0] * d;
        p[1] -= n[1] * d;
        p[2] -= n[2] * d;
      }
    }
  }
  const onCut = (i: number, k: number): boolean => {
    const { n, c } = cuts[k];
    const p = P[i];
    return Math.abs(n[0] * p[0] + n[1] * p[1] + n[2] * p[2] - c) < 1e-6;
  };

  const acc = new Float64Array(P.length * 3);
  const worn: { f: number[]; nrm: number[] }[] = [];
  const flat: { f: number[]; k: number }[] = [];
  for (const f of g.faces) {
    const [a, b, c] = f;
    const ux = P[b][0] - P[a][0];
    const uy = P[b][1] - P[a][1];
    const uz = P[b][2] - P[a][2];
    const vx = P[c][0] - P[a][0];
    const vy = P[c][1] - P[a][1];
    const vz = P[c][2] - P[a][2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    // A face collapsed onto a cut is a sliver of nothing — skip it.
    if (Math.hypot(nx, ny, nz) < 1e-7) continue;
    let k = -1;
    for (let j = 0; j < cuts.length && k < 0; j++) {
      if (onCut(a, j) && onCut(b, j) && onCut(c, j)) k = j;
    }
    if (k >= 0) {
      flat.push({ f, k });
      continue;
    }
    // Outward is the way the lattice's own directions point.
    const ox = g.pts[a][0] + g.pts[b][0] + g.pts[c][0];
    const oy = g.pts[a][1] + g.pts[b][1] + g.pts[c][1];
    const oz = g.pts[a][2] + g.pts[b][2] + g.pts[c][2];
    if (nx * ox + ny * oy + nz * oz < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    for (const i of f) {
      acc[i * 3] += nx;
      acc[i * 3 + 1] += ny;
      acc[i * 3 + 2] += nz;
    }
    worn.push({ f, nrm: [nx, ny, nz] });
  }

  const sheet = () => ({ positions: [] as number[], normals: [] as number[], uvs: [] as number[], indices: [] as number[] });
  const skin = sheet();
  const dark = sheet();
  const vert = (s: ReturnType<typeof sheet>, p: readonly number[], n: readonly number[]): number => {
    s.positions.push(p[0], p[1], p[2]);
    s.normals.push(n[0], n[1], n[2]);
    s.uvs.push(p[0], p[1] + p[2]);
    return s.positions.length / 3 - 1;
  };
  const shared = new Map<number, number>();
  const smooth = (i: number): number => {
    const known = shared.get(i);
    if (known !== undefined) return known;
    const l = Math.hypot(acc[i * 3], acc[i * 3 + 1], acc[i * 3 + 2]) || 1;
    const at = vert(skin, P[i], [acc[i * 3] / l, acc[i * 3 + 1] / l, acc[i * 3 + 2] / l]);
    shared.set(i, at);
    return at;
  };
  for (const { f, nrm } of worn) {
    const [a, b, c] = f.map(smooth);
    tri(skin.indices, skin.positions, a, b, c, nrm);
  }
  // A joint face shares its vertices too — only across the crease does a
  // corner need a second copy, in the face's own normal. A cleft face is half
  // the lattice laid flat, so a copy per triangle was most of a split stone.
  const onFace = new Map<number, number>();
  for (const { f, k } of flat) {
    const s = cuts[k].dark ? dark : skin;
    const n = cuts[k].n;
    const [a, b, c] = f.map((i) => {
      const key = i * cuts.length + k;
      const known = onFace.get(key);
      if (known !== undefined) return known;
      const at = vert(s, P[i], n);
      onFace.set(key, at);
      return at;
    });
    tri(s.indices, s.positions, a, b, c, n);
  }

  for (const [s, list] of [[skin, out.skin], [dark, out.dark]] as const) {
    if (!s.indices.length) continue;
    const data = new VertexData();
    data.positions = s.positions;
    data.normals = s.normals;
    data.uvs = s.uvs;
    data.indices = s.indices;
    data.transform(m);
    list.push(data);
  }
}

/** A unit vector drawn evenly over the sphere. */
function unitFrom(own: () => number): [number, number, number] {
  const y = own() * 2 - 1;
  const a = own() * Math.PI * 2;
  const r = Math.sqrt(1 - y * y);
  return [Math.cos(a) * r, y, Math.sin(a) * r];
}

/**
 * The far reach of `pts` along `n` — where a cut `depth` into the stone from
 * that side has to be laid.
 */
function reach(pts: readonly number[][], n: readonly number[]): number {
  let h = -Infinity;
  for (const p of pts) h = Math.max(h, n[0] * p[0] + n[1] * p[1] + n[2] * p[2]);
  return h;
}

/**
 * A worn stone's shape over the unit sphere: an egg — `rx`/`rz` round the
 * waist, `top` above it and `bottom` below, its waist `cy` up — swelled and
 * sunk by a few broad LOBES, so no two are the same lump and none is a ball.
 * The lobes are low frequency on purpose: a ripple per lattice edge reads as a
 * crumpled can, a swell a stone wide reads as a stone.
 */
function wornShape(
  own: () => number,
  rx: number,
  rz: number,
  top: number,
  bottom: number,
  cy: number,
  lobes: number,
  swell: number,
): (u: readonly number[]) => number[] {
  const L = Array.from({ length: lobes }, (_, i) => ({
    d: unitFrom(own),
    // The last lobe is the finer one: a knuckle on the swell, not a second swell.
    a: (i === lobes - 1 ? 0.35 : 1) * swell * (0.6 + own() * 0.4),
    f: i === lobes - 1 ? 2.2 + own() * 0.8 : 0.8 + own() * 0.7,
    ph: own() * Math.PI * 2,
  }));
  return (u) => {
    let r = 1;
    for (const l of L) {
      r += l.a * Math.cos(Math.PI * l.f * (u[0] * l.d[0] + u[1] * l.d[1] + u[2] * l.d[2]) + l.ph);
    }
    return [u[0] * r * rx, cy + u[1] * r * (u[1] > 0 ? top : bottom), u[2] * r * rz];
  };
}

/**
 * Glacial erratic: a boulder the ice carried down the valley and left — hard
 * cover in the fields and the woods. A squat mass broken along ten to thirteen
 * JOINT faces, big ones round its waist and small ones over its shoulders,
 * with the worn skin between them left as rounded arrises, sunk into the
 * ground rather than set down on it. Two in five have been split by frost
 * along a joint, the halves wedged a few degrees apart over a dark cleft; half
 * have a shoulder stone at one corner, and flakes spalled off the joints lie
 * at the foot of the faces they came off.
 *
 * **It was an octahedron** — a grey gem stood on its point with a tetrahedron
 * beside it — and read as a pyramid pushed up through the turf: four flat
 * faces meeting at a ridge, the same four from every side. What makes a stone
 * read as one is the pair of surfaces it is made of, the broken and the worn
 * (`rockData`): every joint face FLAT, one tone under one hard edge the ink
 * draws, and the worn skin SMOOTH. The balance between them is the lesson.
 * A first cut was mostly skin with two to four joints and read as an egg — a
 * pebble scaled up — and the smooth normals over a coarse lattice let the
 * lattice through wherever the shadow map's terminator crossed it, a mosaic
 * of faint triangles. So the joints now take nearly the whole surface, as the
 * pines' and the ash's facets do, and the skin is only ever a narrow arris.
 *
 * Three things about it are load-bearing rather than decorative:
 *
 * - **The mass is sized to its collider** (`PROP_BODIES.boulder`, 2.1 x 1.9 x
 *   1.45, oriented with the prop): its waist is on the box's half-widths
 *   along its own X and Z at the median and under 0.16 m past them in nine
 *   stones in ten, and its top is held at or over the box's 1.45 m whatever
 *   the cuts take off it — a round stopping on air over a flat top reads as a
 *   bug. The corners the mass leaves empty are where the shoulder stone goes,
 *   so it is mostly inside the box and under half a metre; the spalls are
 *   outside it and ankle high.
 * - **Its detail comes from `sub`**, the per-prop stream. `rng` is the map's
 *   scatter stream and every draw from it moves every prop sown after this
 *   one, so this takes exactly `BOULDER_SHARED_DRAWS` from it and spends none.
 * - **Nothing is scaled non-uniformly.** The stretch is in the shape, and the
 *   tilt and the wedge are rotations baked into the vertices, so a normal
 *   still says which way the stone faces.
 *
 * Budgeted as DRESSING: 414 stand on Cinderhaven's slopes, so a vertex here is
 * four hundred in the scene. Two parts, one per colour, because a part is a
 * mesh the install pays for (see `buildDeadTree`).
 */
export function buildBoulder(
  scene: Scene,
  mats: CelMaterialFactory,
  rng: () => number,
  sub: () => number,
): Mesh {
  // The octahedron's draws, taken and not spent (see the header).
  for (let i = 0; i < BOULDER_SHARED_DRAWS; i++) rng();
  const own = sub;
  const out: RockSheets = { skin: [], dark: [] };

  // The mass. The waist stands 0.42 m up, so it meets the ground at ~0.9 of
  // its width and sits IN the turf rather than on it, and it carries on down
  // to a flat bed half a metre under — deep enough that the downhill side of
  // one on Cinderhaven's slopes is still stone and not the underside of it.
  const rx = 1.12 + own() * 0.08;
  const rz = 1.02 + own() * 0.08;
  const cy = 0.42;
  const top = 0.95 + own() * 0.15;
  const shape = wornShape(own, rx, rz, top, 0.95, cy, 4, 0.1);
  const lattice = geodesic(BOULDER_LEVEL).pts.map(shape);

  // The joints: ten to thirteen planes the stone broke along, turned round it
  // by the golden angle so they do not stack on one side, from a little under
  // the level to 70 degrees over it, cut deep enough that their faces meet —
  // so the stone is a polytope of big faces with the worn skin left only at
  // the arrises. Two in five have had a shoulder of the crown taken off too,
  // steep and never a table top.
  const cuts: RockCut[] = [];
  const joints = 10 + Math.floor(own() * 4);
  const turn = own() * Math.PI * 2;
  for (let i = 0; i < joints; i++) {
    const az = turn + i * 2.39996 + (own() - 0.5) * 0.5;
    // Even over the band of the sphere from a little under the level to 70
    // degrees over it: a spiral in the SINE of the elevation, as a
    // sunflower's seeds are even over its disc.
    const el = Math.asin(-0.3 + ((i + 0.5 + (own() - 0.5) * 0.6) / joints) * 1.25);
    const n: [number, number, number] = [
      Math.cos(el) * Math.cos(az),
      Math.sin(el),
      Math.cos(el) * Math.sin(az),
    ];
    // Deep round the waist, where a face is a side of the stone; shallow over
    // the shoulder, or the crown goes and the stone is a squat lump.
    const deep = el < 0.6 ? 0.12 + own() * 0.24 : 0.06 + own() * 0.1;
    cuts.push({ n, c: reach(lattice, n) - deep });
  }
  if (own() < 0.4) {
    const az = own() * Math.PI * 2;
    const el = 1.15 + own() * 0.3;
    const n: [number, number, number] = [
      Math.cos(el) * Math.cos(az),
      Math.sin(el),
      Math.cos(el) * Math.sin(az),
    ];
    cuts.push({ n, c: reach(lattice, n) - (0.08 + own() * 0.14) });
  }
  cuts.push({ n: [0, -1, 0], c: 0.5 });

  // The whole stone leans a little off its bed, about a level axis.
  const leanAz = own() * Math.PI * 2;
  const lean = Matrix.RotationAxis(new Vector3(Math.cos(leanAz), 0, Math.sin(leanAz)), own() * 0.09);

  // Held to the collider's top: if the cuts took the crown under 1.47 m, the
  // shape above the ground is stretched back up to it and the cut planes with
  // it. The stretch is applied to the SHAPE, so nothing downstream sees a
  // scaled normal.
  const trial = lattice.map((p) => p.slice());
  for (const { n, c } of cuts) {
    for (const p of trial) {
      const d = n[0] * p[0] + n[1] * p[1] + n[2] * p[2] - c;
      if (d > 0) for (let j = 0; j < 3; j++) p[j] -= n[j] * d;
    }
  }
  let crownY = 0;
  for (const p of trial) crownY = Math.max(crownY, p[1]);
  const lift = crownY < 1.47 ? 1.47 / crownY : 1;
  const place =
    lift === 1
      ? shape
      : (u: readonly number[]) => {
          const p = shape(u);
          if (p[1] > 0) p[1] *= lift;
          return p;
        };
  if (lift !== 1) {
    for (const cut of cuts) {
      if (cut.n[1] < 0) continue;
      // A plane through a point q with normal n, under y -> y * lift, is the
      // plane through (q.x, q.y * lift, q.z) with normal (n.x, n.y / lift, n.z).
      const q = [cut.n[0] * cut.c, cut.n[1] * cut.c * lift, cut.n[2] * cut.c];
      const raw = [cut.n[0], cut.n[1] / lift, cut.n[2]];
      const l = Math.hypot(raw[0], raw[1], raw[2]);
      const n: [number, number, number] = [raw[0] / l, raw[1] / l, raw[2] / l];
      cut.n = n;
      cut.c = n[0] * q[0] + n[1] * q[1] + n[2] * q[2];
    }
  }

  const split = own() < 0.4;
  if (!split) {
    rockData(BOULDER_LEVEL, place, cuts, lean, out);
  } else {
    // A frost cleft along a near-vertical joint, off the middle so the halves
    // are not a matched pair, the far half wedged over about its own foot.
    const sa = own() * Math.PI * 2;
    const s: [number, number, number] = [Math.cos(sa), (own() - 0.5) * 0.2, Math.sin(sa)];
    const sl = Math.hypot(...s);
    for (let j = 0; j < 3; j++) s[j] /= sl;
    const off = (own() - 0.5) * 0.4;
    const gap = 0.025 + own() * 0.02;
    rockData(BOULDER_LEVEL, place, [...cuts, { n: s, c: off - gap, dark: true }], lean, out);
    const pivot = new Vector3(s[0] * off, -0.1, s[2] * off);
    const hinge = Vector3.Cross(new Vector3(s[0], 0, s[2]), Vector3.Up());
    let wedge = 0.04 + own() * 0.05;
    const hinged = (a: number) =>
      Matrix.Translation(-pivot.x, -pivot.y, -pivot.z)
        .multiply(Matrix.RotationAxis(hinge, a))
        .multiply(Matrix.Translation(pivot.x, pivot.y, pivot.z));
    // Whichever sign opens the cleft at the top rather than closing it.
    const up = Vector3.TransformCoordinates(pivot.add(new Vector3(0, 1, 0)), hinged(wedge));
    if ((up.x - pivot.x) * s[0] + (up.z - pivot.z) * s[2] < 0) wedge = -wedge;
    rockData(
      BOULDER_LEVEL,
      place,
      [...cuts, { n: [-s[0], -s[1], -s[2]], c: -(off + gap), dark: true }],
      hinged(wedge).multiply(lean),
      out,
    );
  }

  // How far the mass reaches along a bearing at knee height — where a stone
  // lying against it has to be put.
  const footAt = (a: number): number =>
    Math.hypot(rx * Math.cos(a), rz * Math.sin(a)) * 0.9;

  // The shoulder stone, in a corner of the box the egg leaves empty: a small
  // worn stone of its own, sunk to half its height.
  if (own() < 0.5) {
    const r = 0.28 + own() * 0.14;
    const corner =
      Math.atan2(rz, rx) * (own() < 0.5 ? 1 : -1) + (own() < 0.5 ? 0 : Math.PI) + (own() - 0.5) * 0.3;
    const d = footAt(corner) + r * 0.25;
    const stone = wornShape(own, r, r * (0.8 + own() * 0.3), r * 0.9, r * 0.7, r * 0.2, 2, 0.12);
    const sn = unitFrom(own);
    sn[1] = Math.abs(sn[1]) * 0.8 + 0.2;
    const nl = Math.hypot(...sn);
    const stoneCuts: RockCut[] = [
      { n: [sn[0] / nl, sn[1] / nl, sn[2] / nl], c: r * (0.55 + own() * 0.25) },
      { n: [0, -1, 0], c: r * 0.35 },
    ];
    rockData(
      1,
      stone,
      stoneCuts,
      Matrix.RotationY(own() * Math.PI * 2).multiply(
        Matrix.Translation(Math.cos(corner) * d, 0, Math.sin(corner) * d),
      ),
      out,
    );
  }

  // Spalls: flakes frost has taken off the joint faces, lying at the foot of
  // the side they came off, tipped and half in the turf.
  const sides = cuts.filter((c) => c.n[1] >= 0 && c.n[1] < 0.8);
  const flakes = 2 + Math.floor(own() * 3);
  for (let i = 0; i < flakes; i++) {
    const from = sides.length ? sides[i % sides.length].n : unitFrom(own);
    const a = Math.atan2(from[2], from[0]) + (own() - 0.5) * 0.9;
    const d = footAt(a) + 0.08 + own() * 0.28;
    const size = 0.09 + own() * 0.11;
    const points = 5 + Math.floor(own() * 2);
    const outline: Flat[] = [];
    for (let j = 0; j < points; j++) {
      const t = ((j + (own() - 0.5) * 0.5) / points) * Math.PI * 2;
      const rr = size * (0.6 + own() * 0.5);
      outline.push([Math.cos(t) * rr * 1.4, Math.sin(t) * rr]);
    }
    const thick = 0.04 + own() * 0.05;
    const flake = prismData(outline, thick, { plane: "xz", centre: true });
    flake.transform(
      Matrix.RotationYawPitchRoll(own() * Math.PI * 2, (own() - 0.5) * 0.7, (own() - 0.5) * 0.7).multiply(
        Matrix.Translation(Math.cos(a) * d, thick * 0.15, Math.sin(a) * d),
      ),
    );
    out.dark.push(flake);
  }

  const rock = partSurface("boulder", out.skin[0].merge(out.skin.slice(1)), scene);
  rock.material = mats.get(BOULDER);
  if (out.dark.length) {
    const rest = partSurface("boulder-dark", out.dark[0].merge(out.dark.slice(1)), scene);
    rest.parent = rock;
    rest.material = mats.get(BOULDER_DARK);
  }
  return rock;
}
