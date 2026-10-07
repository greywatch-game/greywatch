/**
 * props/crown.ts — A broadleaf crown of BILLOWS, what the ash and the
 * maple share: the `Billow`, a leaf's stalk and faces, `skinBillows` (the
 * hearts and the leaves over them), `crownPart` and `rigVerts`. The
 * construction is argued in `buildAshTree`'s header; each tree states its own
 * `BillowSkin`. Part of the scatter set: follows the contract in `./index.ts`.
 * Invariants: every leaf is drawn from the billow's own stream, never from the
 * shared scatter stream. Never imports a prop.
 */
import { Material, Mesh, Scene, VertexData } from "@babylonjs/core";
import { CONFIG } from "../../config";
import { partSurface } from "../parts";
import { mulberry32 } from "../rng";
import { marksSway, rigPhase } from "../sway";
import {
  geodesic,
  type Sheet,
  sheetData,
  sheetFace,
  sheetVert,
  tri,
  type V3,
  v3add,
  v3cross,
  v3unit,
} from "./geometry";

/**
 * One billow of a broadleaf crown — see `buildAshTree` and `buildMaple`. `c`
 * is its centre in the trunk's frame, `r` its half-width and `h` its
 * half-height (a clump of leaf is a dome on a flatter belly, never a ball),
 * and `phase` the bough's beat it moves on (`world/sway.ts`).
 */
export interface Billow {
  c: V3;
  r: number;
  h: number;
  phase: number;
}

/**
 * Writes a bough rig over every vertex of `data` — `rig` asked of where the
 * vertex is — for a part the bough carries whole: wood, a heart.
 */
export function rigVerts(data: VertexData, rig: (p: V3) => readonly [number, number]): VertexData {
  const pos = data.positions!;
  const uvs = new Array<number>((pos.length / 3) * 2);
  for (let i = 0; i < pos.length / 3; i++) {
    const [u, v] = rig([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]);
    uvs[i * 2] = u;
    uvs[i * 2 + 1] = v;
  }
  data.uvs = uvs;
  return data;
}

/**
 * One merged part of a broadleaf crown, parented to its `trunk`: `data` is a
 * list of pieces or a laid sheet, and nothing is made of an empty one. `sways`
 * puts it on the rigged `bough` layer.
 */
export function crownPart(
  scene: Scene,
  trunk: Mesh,
  name: string,
  data: VertexData[] | Sheet,
  material: Material,
  sways: boolean,
): void {
  const merged = Array.isArray(data)
    ? data.length
      ? data[0].merge(data.slice(1))
      : null
    : data.indices.length
      ? sheetData(data)
      : null;
  if (!merged) return;
  const mesh = partSurface(name, merged, scene);
  mesh.parent = trunk;
  mesh.material = material;
  if (sways) marksSway(mesh, "bough");
}

/**
 * The STALK of one leaf or leaf cluster laid on a billow, and the frame its
 * rim is drawn in — what `ashCluster` and `mapleLeaf` share, since both are a
 * closed, cupped lens hung down the billow's slope like a fish scale.
 *
 * `m` is the leaf's own face (the billow's `out` tipped down the slope by
 * `lift`), `fwd` down the slope in that face and `side` across it; `cup` is
 * how far the stalk stands proud of the rim (a share of `L` between `cupLo`
 * and `cupLo + cupSpan`), and `top`/`under` are the stalk's two vertices,
 * already laid. `tilt` is where a point sits across the axis the leaf TIPS
 * on as it rustles (`boughRig`), `reach` being the distance that is 1.
 */
export function leafStalk(
  into: Sheet,
  p: V3,
  out: V3,
  L: number,
  lift: number,
  cupLo: number,
  cupSpan: number,
  reach: number,
  rnd: () => number,
  rig: (q: V3, edge: number) => [number, number],
): { m: V3; fwd: V3; side: V3; cup: number; base: V3; top: number; under: number; tilt: (q: V3) => number } {
  // Down the slope: the downward vertical laid into the surface. Near the
  // crest there is no slope to follow, and any heading will do.
  let d = v3add([0, -1, 0], out, out[1]);
  if (Math.hypot(d[0], d[1], d[2]) < 0.3) d = v3cross(out, v3unit([rnd() - 0.5, 0, rnd() - 0.5]));
  d = v3unit(d);
  // The leaf's own face: tipped from the billow's by `lift`, so its lower
  // rim stands off the surface.
  const m = v3unit(v3add(v3add([0, 0, 0], out, Math.cos(lift)), d, -Math.sin(lift)));
  const fwd = v3unit(v3add(d, m, -(d[0] * m[0] + d[1] * m[1] + d[2] * m[2])));
  const side = v3cross(m, fwd);
  // The stalk, proud of the rim by the cup, and a little inside the surface,
  // so the leaf grows out of the billow rather than being stuck on it.
  const cup = L * (cupLo + rnd() * cupSpan);
  const base = v3add(v3add(p, out, -0.04), m, cup);
  // The axis the leaf TIPS across: level and in its own face, so a leaf lying
  // on a billow's crown flips about a line through its stalk and one standing
  // on its flank turns in its face — either way whole, every vertex tipped by
  // how far along this it is from the stalk (`boughRig`). Near the crest,
  // where the face is level, any bearing will do.
  let tip: V3 = v3cross([0, 1, 0], m);
  if (Math.hypot(tip[0], tip[1], tip[2]) < 0.25) tip = side;
  tip = v3unit(tip);
  const tilt = (q: V3): number =>
    ((q[0] - base[0]) * tip[0] + (q[1] - base[1]) * tip[1] + (q[2] - base[2]) * tip[2]) / reach;
  const top = sheetVert(into, base, m, rig(base, 0));
  const ub = v3add(base, m, -Math.min(0.06, cup * 0.6));
  const under = sheetVert(into, ub, v3add([0, 0, 0], m, -1), rig(ub, tilt(ub)));
  return { m, fwd, side, cup, base, top, under, tilt };
}

/** A leaf's two faces: a fan from each stalk vertex to every edge of its rim. */
export function leafFaces(into: Sheet, top: number, under: number, rim: readonly number[]): void {
  for (let k = 0; k < rim.length; k++) {
    const a = rim[k];
    const b = rim[(k + 1) % rim.length];
    sheetFace(into, top, a, b);
    sheetFace(into, under, b, a);
  }
}

/**
 * How a crown of billows is skinned in leaf (`skinBillows`) — the numbers that
 * are a TREE's rather than the method's. Every size is a share of the billow
 * but `density`.
 */
export interface BillowSkin {
  /** How far out the dark HEART reaches. */
  heart: number;
  /**
   * Where the leaves' stalks sit — OUTSIDE the heart by most of a leaf's
   * reach, so a leaf never buries its point in it.
   */
  skin: number;
  /** Leaves a square metre of billow carries at full detail. */
  density: number;
  /** How deep the belly is, as a share of the dome over it. */
  belly: number;
  /**
   * Whether the belly is laid with half the leaves — right for a crown held
   * high over the eye, wrong for one a player walks under and looks up into.
   */
  thinBelly: boolean;
  /** Salted into each billow's own stream, so two trees' streams differ. */
  salt: number;
  /** One leaf's reach, stalk to point, drawn from the billow's stream. */
  size: (rnd: () => number) => number;
  /** How far a leaf is tipped down the slope, radians, from the same. */
  lift: (rnd: () => number) => number;
  /** Lays one leaf — `ashCluster` or `mapleLeaf`. */
  leaf: (
    into: Sheet,
    p: V3,
    out: V3,
    L: number,
    lift: number,
    rnd: () => number,
    rig: (q: V3, edge: number) => [number, number],
  ) => void;
}

/**
 * A crown's HEARTS and the LEAVES laid over them, for every billow in
 * `clumps` — the ash's construction (see `buildAshTree`, which argues it), and
 * the maple's. Each billow is a dark geodesic heart under a skin of leaves laid
 * like fish scales; the leaves go into `lit` or `shade` by where on the dome
 * they sit and how high the billow is in the crown, and the hearts come back
 * rigged, one per billow.
 *
 * Every leaf is drawn from a stream of the BILLOW's own, seeded off `seed`, so
 * `detail` (the foliage setting) lays fewer of them, each grown to cover its
 * missing neighbours, without moving a bough. `rigAt` is the tree's bough rig
 * at a point; `rigged` writes it over a whole part.
 */
export function skinBillows(
  clumps: readonly Billow[],
  seed: number,
  detail: number,
  skin: BillowSkin,
  rigAt: (p: V3, phase: number, tilt?: number, leaf?: number) => [number, number],
  rigged: (data: VertexData, phase: number) => VertexData,
  lit: Sheet,
  shade: Sheet,
): VertexData[] {
  const hearts: VertexData[] = [];
  const crestY = Math.max(...clumps.map((k) => k.c[1]));
  const baseY = Math.min(...clumps.map((k) => k.c[1]));
  const sphere = geodesic(1);
  const { heart: HEART, skin: SKIN, density: DENSITY, belly: BELLY } = skin;
  // Is `p` under billow `o`'s skin, near enough — where no leaf can be seen
  // past that billow's own.
  const inside = (o: Billow, p: V3): boolean => {
    const dx = (p[0] - o.c[0]) / (o.r * SKIN);
    const dy = (p[1] - o.c[1]) / (o.h * SKIN * (p[1] < o.c[1] ? BELLY : 1));
    const dz = (p[2] - o.c[2]) / (o.r * SKIN);
    return dx * dx + dy * dy + dz * dz < 0.85;
  };
  clumps.forEach((k, ci) => {
    const [cx, cy, cz] = k.c;
    // The billow's own stream: everything below is drawn from it and nothing
    // else is, so a coarser `detail` re-lays the leaves and moves nothing.
    const leafRng = mulberry32((seed ^ skin.salt) + ci * 7919);
    // The surface a billow's shape is, at direction `u`: the dome over a
    // flatter belly, each billow lumpy in its own way — three slow bumps.
    const lumps = Array.from({ length: 3 }, () => ({
      d: v3unit([leafRng() - 0.5, leafRng() * 0.8 - 0.2, leafRng() - 0.5]),
      k: 0.1 + leafRng() * 0.12,
    }));
    const shape = (u: V3, s: number): V3 => {
      let f = 1;
      for (const { d, k: amp } of lumps) f += amp * Math.max(0, u[0] * d[0] + u[1] * d[1] + u[2] * d[2]) ** 2;
      const belly = u[1] < 0 ? BELLY : 1;
      return [cx + u[0] * k.r * f * s, cy + u[1] * k.h * f * s * belly, cz + u[2] * k.r * f * s];
    };
    // The heart: the geodesic carried out to most of the billow, its
    // vertices SHARED — the cel shader shades the facet, so a shared vertex
    // costs nothing in looks and 4/5 of the vertices.
    const hp: number[] = [];
    const hn: number[] = [];
    for (const u of sphere.pts) {
      const p = shape(u as unknown as V3, HEART);
      hp.push(p[0], p[1], p[2]);
      hn.push(u[0], u[1], u[2]);
    }
    const hi: number[] = [];
    for (const [a, b, c] of sphere.faces) tri(hi, hp, a, b, c, hn.slice(a * 3, a * 3 + 3));
    const hd = new VertexData();
    hd.positions = hp;
    hd.normals = hn;
    hd.indices = hi;
    hd.uvs = [];
    hearts.push(rigged(hd, k.phase));

    // The leaves, sown over the billow on a Fibonacci spiral so they cover it
    // evenly, as many as its area wants at full detail and a share of that
    // below it, each grown to cover the gaps.
    const area = 4 * Math.PI * ((k.r * k.r + 2 * k.r * k.h) / 3);
    const full = Math.round(area * DENSITY);
    const n = Math.max(6, Math.round(full * detail));
    const grow = Math.min(CONFIG.graphics.foliage.maxGrow, Math.sqrt(full / n));
    const turn = leafRng() * Math.PI * 2;
    // How much of the light a billow is in: the crown's top storey most, its
    // skirt least.
    const storey = crestY > baseY ? (cy - baseY) / (crestY - baseY) : 1;
    for (let j = 0; j < n; j++) {
      const y = 1 - (2 * (j + 0.5)) / n;
      const ring = Math.sqrt(Math.max(0, 1 - y * y));
      const th = j * 2.39996 + turn + (leafRng() - 0.5) * 0.5;
      const u = v3unit([Math.cos(th) * ring, y + (leafRng() - 0.5) * 0.12, Math.sin(th) * ring]);
      const L = skin.size(leafRng) * grow;
      const lift = skin.lift(leafRng);
      const tone = leafRng() - 0.5;
      // A thin belly gets half as many: it is mostly in the heart's shade,
      // but a crown seen from under it is leaf, not a dark ball.
      if (skin.thinBelly && u[1] < -0.45 && tone > 0) continue;
      const p = shape(u, SKIN);
      // Under another billow's skin, where nothing can see it.
      if (clumps.some((o, oi) => oi !== ci && inside(o, p))) continue;
      // Outward off the billow's surface: the ellipsoid's gradient, the belly
      // being the flatter half.
      const hb = u[1] < 0 ? k.h * BELLY : k.h;
      const out = v3unit([(p[0] - cx) / (k.r * k.r), (p[1] - cy) / (hb * hb), (p[2] - cz) / (k.r * k.r)]);
      // Laid flatter toward the crest, where a tipped rim stands up against
      // the sky as a plate rather than lying over the leaf below it.
      const crest = Math.max(0, out[1]) ** 2;
      const sunny = out[1] + storey * 0.6 + 0.05 + tone * 0.6 > 0;
      // The leaf's own phase, hashed from where it is rather than drawn, so
      // it re-cuts nothing after it.
      const leaf = rigPhase(p[0] * 3.7 + p[2] * 1.3, p[1] + ci);
      skin.leaf(sunny ? lit : shade, p, out, L, lift * (1 - 0.7 * crest), leafRng, (q, tilt) =>
        rigAt(q, k.phase, tilt, leaf),
      );
    }
  });
  return hearts;
}
